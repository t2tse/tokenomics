import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { claudeAgentAdapter } from './claude.js';
import { DEFAULT_AGENT } from '../config.js';

export { claudeAgentAdapter };

/**
 * Registry mapping agent names to their adapter functions.
 */
const agentRegistry = new Map([
  ['claude', claudeAgentAdapter]
]);

/**
 * Registers a new coding agent adapter.
 * @param {string} name - Identifier for the agent (e.g. 'aider', 'cline')
 * @param {function} adapterFn - Function returning process config { command, args, env, displayCmd }
 */
export function registerAgent(name, adapterFn) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Agent name must be a non-empty string.');
  }
  if (typeof adapterFn !== 'function') {
    throw new Error('Agent adapter must be a function.');
  }
  agentRegistry.set(name.toLowerCase().trim(), adapterFn);
}

/**
 * Returns list of all currently registered agent names.
 * @returns {string[]} List of registered agent names
 */
export function getAvailableAgents() {
  return Array.from(agentRegistry.keys());
}

/**
 * Spawns a child process for a coding agent and collects execution metrics.
 * @param {object} options
 * @param {string} options.command - CLI command executable
 * @param {string[]} options.args - CLI arguments
 * @param {string} options.cwd - Working directory
 * @param {object} options.env - Environment variables
 * @param {string} [options.displayCmd] - Human-readable command for log display
 * @returns {Promise<{ code: number, durationMs: number, stdout: string, stderr: string, success: boolean }>}
 */
export function spawnAgentProcess({ command, args, cwd, env, displayCmd, interactive = false }) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    if (displayCmd) {
      console.log(`💻 [EXEC] Running: ${displayCmd}`);
    } else {
      console.log(`💻 [EXEC] Running: ${command} ${args.join(' ')}`);
    }

    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }

    let child;
    let stdout = '';
    let stderr = '';
    let outStream = null;
    let errStream = null;

    if (interactive) {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: 'inherit',
      });
    } else {
      const outPath = path.join(cwd, 'AGENT-OUTPUT.out');
      const errPath = path.join(cwd, 'AGENT-OUTPUT.err');

      outStream = fs.createWriteStream(outPath, { flags: 'a' });
      errStream = fs.createWriteStream(errPath, { flags: 'a' });

      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const str = data.toString();
          stdout += str;
          outStream.write(data);
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const str = data.toString();
          stderr += str;
          errStream.write(data);
        });
      }
    }

    const cleanup = () => {
      if (outStream) outStream.end();
      if (errStream) errStream.end();
    };

    child.on('close', (code) => {
      cleanup();
      const durationMs = Date.now() - startTime;
      resolve({
        code,
        durationMs,
        stdout,
        stderr,
        success: code === 0,
      });
    });

    child.on('error', (err) => {
      cleanup();
      resolve({
        code: -1,
        durationMs: Date.now() - startTime,
        stdout: '',
        stderr: err.message,
        success: false,
      });
    });
  });
}

/**
 * Main entry point to run a coding agent CLI task.
 * Looks up the agent adapter by name and spawns the child process.
 * @param {object} params - Agent execution options
 * @param {string} [params.agent=DEFAULT_AGENT] - Name of coding agent (e.g. DEFAULT_AGENT)
 * @param {string} params.caseDir - Working directory for execution
 * @param {string} params.caseName - Name of the test case
 * @param {string} params.secretKey - LiteLLM auth token key
 * @param {string} params.model - Model name
 * @param {string} params.mode - Permission or run mode
 * @param {string} [params.promptText] - Task prompt string
 * @param {string} params.baseUrl - LiteLLM proxy base URL
 * @param {boolean} [params.interactive=false] - Whether to run agent in interactive terminal mode
 * @returns {Promise<{ code: number, durationMs: number, stdout: string, stderr: string, success: boolean }>}
 */
export function runCodingAgent(params) {
  const agentName = (params.agent || DEFAULT_AGENT).toLowerCase().trim();
  const adapter = agentRegistry.get(agentName);

  if (!adapter) {
    const available = getAvailableAgents().join(', ');
    return Promise.resolve({
      code: -1,
      durationMs: 0,
      stdout: '',
      stderr: `Error: Unknown coding agent "${params.agent}". Available registered agents: [${available}]`,
      success: false,
    });
  }

  const processConfig = adapter(params);
  return spawnAgentProcess({
    command: processConfig.command,
    args: processConfig.args,
    cwd: params.caseDir,
    env: processConfig.env,
    displayCmd: processConfig.displayCmd,
    interactive: processConfig.interactive !== undefined ? processConfig.interactive : (params.interactive || false),
  });
}

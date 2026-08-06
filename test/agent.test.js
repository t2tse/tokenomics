import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCodingAgent,
  registerAgent,
  getAvailableAgents,
  claudeAgentAdapter,
} from '../src/agents/agent.js';

describe('agent module', () => {
  it('should include claude in default available agents', () => {
    const available = getAvailableAgents();
    assert.ok(available.includes('claude'));
  });

  it('claudeAgentAdapter constructs correct command line and environment', () => {
    const config = claudeAgentAdapter({
      secretKey: 'sk-1234567890123456',
      model: 'claude-sonnet',
      mode: 'plan',
      promptText: 'Fix the bug',
      baseUrl: 'http://localhost:4000',
    });

    assert.equal(config.command, 'claude');
    assert.deepEqual(config.args, ['-p', '--output-format', 'text', '--verbose', '--model', 'claude-sonnet', '--permission-mode', 'plan', 'Fix the bug']);
    assert.equal(config.env.ANTHROPIC_BASE_URL, 'http://localhost:4000');
    assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, 'sk-1234567890123456');
    assert.ok(config.displayCmd.includes('claude -p --output-format text --verbose --model claude-sonnet'));

    const interactiveConfig = claudeAgentAdapter({
      secretKey: 'sk-1234567890123456',
      model: 'claude-sonnet',
      mode: 'plan',
      promptText: 'Fix the bug',
      baseUrl: 'http://localhost:4000',
      interactive: true,
    });
    assert.deepEqual(interactiveConfig.args, ['--output-format', 'text', '--verbose', '--model', 'claude-sonnet', 'Fix the bug']);
    assert.equal(interactiveConfig.interactive, true);
  });

  it('registerAgent adds a new agent adapter', () => {
    registerAgent('dummy-agent', (params) => ({
      command: 'echo',
      args: ['hello', params.model],
      env: process.env,
      displayCmd: `echo hello ${params.model}`,
    }));

    const available = getAvailableAgents();
    assert.ok(available.includes('dummy-agent'));
  });

  it('runCodingAgent fails gracefully on unknown agent', async () => {
    const result = await runCodingAgent({
      agent: 'non-existent-agent-engine',
      caseDir: '/tmp',
      secretKey: 'sk-test',
      model: 'claude-sonnet',
      mode: 'auto',
      baseUrl: 'http://localhost:4000',
    });

    assert.equal(result.success, false);
    assert.equal(result.code, -1);
    assert.ok(result.stderr.includes('Unknown coding agent "non-existent-agent-engine"'));
  });

  it('spawnAgentProcess writes stdout and stderr live to AGENT-OUTPUT files', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
    registerAgent('echo-agent', () => ({
      command: 'node',
      args: ['-e', 'console.log("hello stdout"); console.error("hello stderr");'],
      env: process.env,
      displayCmd: 'node test',
    }));

    const result = await runCodingAgent({
      agent: 'echo-agent',
      caseDir: tmpDir,
      secretKey: 'sk-test',
      model: 'test-model',
      mode: 'auto',
      baseUrl: 'http://localhost:4000',
    });

    assert.equal(result.success, true);

    const stdoutFile = fs.readFileSync(path.join(tmpDir, 'AGENT-OUTPUT.out'), 'utf8');
    const stderrFile = fs.readFileSync(path.join(tmpDir, 'AGENT-OUTPUT.err'), 'utf8');

    assert.ok(stdoutFile.includes('hello stdout'));
    assert.ok(stderrFile.includes('hello stderr'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawnAgentProcess executes successfully in interactive mode', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-interactive-'));
    registerAgent('interactive-agent', () => ({
      command: 'node',
      args: ['-e', 'process.exit(0);'],
      env: process.env,
      displayCmd: 'node test interactive',
      interactive: true,
    }));

    const result = await runCodingAgent({
      agent: 'interactive-agent',
      caseDir: tmpDir,
      secretKey: 'sk-test',
      model: 'test-model',
      mode: 'auto',
      baseUrl: 'http://localhost:4000',
      interactive: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.code, 0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

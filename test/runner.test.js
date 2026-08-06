import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('runner & case discovery', () => {
  it('should locate test cases inside use-cases directory', async () => {
    const { runTestCase } = await import('../src/runner.js');
    const options = { mode: 'simple', model: 'claude-sonnet', baseUrl: 'http://localhost:4000', masterKey: 'sk-test' };

    // Expect runTestCase to throw specific error mentioning the caseDir path inside use-cases when case doesn't exist
    await assert.rejects(
      async () => {
        await runTestCase('non-existent-case', options, projectRoot);
      },
      (err) => {
        return err.message.includes(path.join('use-cases', 'non-existent-case'));
      }
    );
  });

  it('should fail in non-interactive simple mode if PROMPT.md is missing or empty', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase } = await import('../src/runner.js');

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'empty-case');
    fs.mkdirSync(caseDir, { recursive: true });

    const options = { mode: 'simple', interactive: false, model: 'claude-sonnet', baseUrl: 'http://localhost:4000', masterKey: 'sk-test' };

    await assert.rejects(
      async () => {
        await runTestCase('empty-case', options, tmpParent);
      },
      (err) => {
        return err.message.includes('PROMPT.md is missing or empty') && err.message.includes(path.join(caseDir, 'PROMPT.md'));
      }
    );

    fs.rmSync(tmpParent, { recursive: true, force: true });
  });

  it('should fail in non-interactive plan-execute mode if PROMPT-PLAN.md / PROMPT-EXEC.md are missing', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase } = await import('../src/runner.js');

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'empty-case');
    fs.mkdirSync(caseDir, { recursive: true });

    const options = { mode: 'plan-execute', interactive: false, modelPlanning: 'claude-sonnet', modelExecution: 'gemini-flash', baseUrl: 'http://localhost:4000', masterKey: 'sk-test' };

    await assert.rejects(
      async () => {
        await runTestCase('empty-case', options, tmpParent);
      },
      (err) => {
        return err.message.includes('Prompt files are missing or empty') &&
               err.message.includes(path.join(caseDir, 'PROMPT-PLAN.md')) &&
               err.message.includes(path.join(caseDir, 'PROMPT-EXEC.md'));
      }
    );

    fs.rmSync(tmpParent, { recursive: true, force: true });
  });

  it('should ignore simple or plan-execute mode in interactive mode', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase } = await import('../src/runner.js');
    const { registerAgent } = await import('../src/agents/agent.js');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/user/new')) {
        return { ok: true, json: async () => ({ user_id: 'test-user-id', key: 'sk-12345678901234' }) };
      }
      if (url.includes('/key/generate')) {
        return { ok: true, json: async () => ({ key: 'sk-virtual-key' }) };
      }
      if (url.includes('/user/info')) {
        return { ok: true, json: async () => ({ user_info: { spend: 0 } }) };
      }
      return { ok: true, json: async () => ({ metadata: {} }) };
    };

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-interactive-mode-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'interactive-case');
    fs.mkdirSync(caseDir, { recursive: true });

    let agentCallCount = 0;
    registerAgent('mock-interactive-agent', () => {
      agentCallCount++;
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node interactive test',
        interactive: true,
      };
    });

    try {
      const options = {
        agent: 'mock-interactive-agent',
        mode: 'plan-execute', // should be ignored!
        interactive: true,
        model: 'claude-sonnet',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('interactive-case', options, tmpParent);
      assert.equal(result.runs.length, 1);
      assert.equal(result.runs[0].phase, 'interactive');
      assert.equal(agentCallCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });
});




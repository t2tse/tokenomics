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

  it('should append WALKTHROUGH_PROMPT to prompts in headless simple mode', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase, WALKTHROUGH_PROMPT } = await import('../src/runner.js');
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

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-headless-mode-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'headless-case');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build a web dashboard.');

    let capturedPrompts = [];
    registerAgent('mock-headless-agent', (params) => {
      capturedPrompts.push(params.promptText);
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node headless test',
        interactive: false,
      };
    });

    try {
      const options = {
        agent: 'mock-headless-agent',
        mode: 'simple',
        interactive: false,
        model: 'claude-sonnet',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('headless-case', options, tmpParent);
      assert.equal(result.success, true);
      assert.equal(capturedPrompts.length, 1);
      assert.ok(capturedPrompts[0].startsWith('Build a web dashboard.'));
      assert.ok(capturedPrompts[0].includes(WALKTHROUGH_PROMPT));
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });

  it('should append WALKTHROUGH_PROMPT only in the execution phase for plan-execute mode', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase, WALKTHROUGH_PROMPT } = await import('../src/runner.js');
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

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-plan-exec-mode-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'plan-exec-case');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'PROMPT-PLAN.md'), 'Plan the architecture.');
    fs.writeFileSync(path.join(caseDir, 'PROMPT-EXEC.md'), 'Execute implementation.');

    let capturedPrompts = [];
    registerAgent('mock-plan-exec-agent', (params) => {
      capturedPrompts.push(params.promptText);
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node plan-exec test',
        interactive: false,
      };
    });

    try {
      const options = {
        agent: 'mock-plan-exec-agent',
        mode: 'plan-execute',
        interactive: false,
        modelPlanning: 'claude-sonnet',
        modelExecution: 'gemini-flash',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('plan-exec-case', options, tmpParent);
      assert.equal(result.success, true);
      assert.equal(capturedPrompts.length, 2);
      // Phase 1 (Planning): should NOT contain WALKTHROUGH_PROMPT
      assert.equal(capturedPrompts[0], 'Plan the architecture.');
      assert.ok(!capturedPrompts[0].includes(WALKTHROUGH_PROMPT));
      // Phase 2 (Execution): MUST contain WALKTHROUGH_PROMPT
      assert.ok(capturedPrompts[1].startsWith('Execute implementation.'));
      assert.ok(capturedPrompts[1].includes(WALKTHROUGH_PROMPT));
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });

  it('should not append WALKTHROUGH_PROMPT when walkthrough is set to false', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase, WALKTHROUGH_PROMPT } = await import('../src/runner.js');
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

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-no-walkthrough-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'no-walkthrough-case');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build simple app.');

    let capturedPrompts = [];
    registerAgent('mock-no-walkthrough-agent', (params) => {
      capturedPrompts.push(params.promptText);
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node no-walkthrough test',
        interactive: false,
      };
    });

    try {
      const options = {
        agent: 'mock-no-walkthrough-agent',
        mode: 'simple',
        interactive: false,
        walkthrough: false,
        model: 'claude-sonnet',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('no-walkthrough-case', options, tmpParent);
      assert.equal(result.success, true);
      assert.equal(capturedPrompts.length, 1);
      assert.equal(capturedPrompts[0], 'Build simple app.');
      assert.ok(!capturedPrompts[0].includes(WALKTHROUGH_PROMPT));
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });

  it('should extract cacheReadTokens and cacheWriteTokens from LiteLLM usage metrics', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const { runTestCase } = await import('../src/runner.js');
    const { registerAgent } = await import('../src/agents/agent.js');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/user/new')) {
        return { ok: true, json: async () => ({ user_id: 'test-cache-user', key: 'sk-12345678901234' }) };
      }
      if (url.includes('/user/info')) {
        return { ok: true, json: async () => ({ user_info: { spend: 0.25 } }) };
      }
      if (url.includes('/user/daily/activity')) {
        return {
          ok: true,
          json: async () => ({
            metadata: {
              total_spend: 0.25,
              total_prompt_tokens: 15000,
              total_completion_tokens: 500,
              total_tokens: 15500,
              total_cache_read_input_tokens: 8000,
              total_cache_creation_input_tokens: 2000,
              total_api_requests: 10,
              total_successful_requests: 10,
              total_failed_requests: 0,
            }
          })
        };
      }
      return { ok: true, json: async () => ({ metadata: {} }) };
    };

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-cache-metrics-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'cache-case');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build cache test app.');

    registerAgent('mock-cache-agent', () => {
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node cache test',
        interactive: false,
      };
    });

    try {
      const options = {
        agent: 'mock-cache-agent',
        mode: 'simple',
        interactive: false,
        model: 'claude-sonnet',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('cache-case', options, tmpParent);
      assert.equal(result.success, true);
      assert.equal(result.metrics.cacheReadTokens, 8000);
      assert.equal(result.metrics.cacheWriteTokens, 2000);
      assert.equal(result.metrics.promptTokens, 15000);
      assert.equal(result.metrics.completionTokens, 500);
      assert.equal(result.metrics.totalTokens, 15500);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });

  it('should pass bypassPermissions mode when yolo is enabled in simple mode', async () => {
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

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-yolo-simple-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'yolo-simple-case');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build yolo app.');

    let capturedMode = null;
    registerAgent('mock-yolo-simple-agent', (params) => {
      capturedMode = params.mode;
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node yolo simple test',
        interactive: false,
      };
    });

    try {
      const options = {
        agent: 'mock-yolo-simple-agent',
        mode: 'simple',
        interactive: false,
        yolo: true,
        model: 'claude-sonnet',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('yolo-simple-case', options, tmpParent);
      assert.equal(result.success, true);
      assert.equal(result.yolo, true);
      assert.equal(capturedMode, 'bypassPermissions');
      assert.equal(result.runs[0].mode, 'bypassPermissions');
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });

  it('should pass plan mode in Phase 1 and bypassPermissions in Phase 2 for plan-execute mode with yolo', async () => {
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

    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-test-yolo-plan-exec-'));
    const useCasesDir = path.join(tmpParent, 'use-cases');
    const caseDir = path.join(useCasesDir, 'yolo-plan-exec-case');
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'PROMPT-PLAN.md'), 'Plan task.');
    fs.writeFileSync(path.join(caseDir, 'PROMPT-EXEC.md'), 'Execute task.');

    const capturedModes = [];
    registerAgent('mock-yolo-plan-exec-agent', (params) => {
      capturedModes.push(params.mode);
      return {
        command: 'node',
        args: ['-e', 'process.exit(0);'],
        env: process.env,
        displayCmd: 'node yolo plan exec test',
        interactive: false,
      };
    });

    try {
      const options = {
        agent: 'mock-yolo-plan-exec-agent',
        mode: 'plan-execute',
        interactive: false,
        yolo: true,
        modelPlanning: 'claude-sonnet',
        modelExecution: 'gemini-flash',
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
        delay: 0,
      };

      const result = await runTestCase('yolo-plan-exec-case', options, tmpParent);
      assert.equal(result.success, true);
      assert.equal(result.yolo, true);
      assert.deepEqual(capturedModes, ['plan', 'bypassPermissions']);
      assert.equal(result.runs[0].mode, 'plan');
      assert.equal(result.runs[1].mode, 'bypassPermissions');
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });
});




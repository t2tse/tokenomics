import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, defaults, resolveCaseOptions, DEFAULT_AGENT } from '../src/config.js';

describe('config module', () => {
  it('should export DEFAULT_AGENT and match defaults.agent', () => {
    assert.ok(typeof DEFAULT_AGENT === 'string' && DEFAULT_AGENT.length > 0);
    assert.equal(defaults.agent, DEFAULT_AGENT);
  });

  it('should return defaults when no flags provided', () => {
    const opts = parseArgs([]);
    assert.deepEqual(opts, defaults);
  });

  it('should parse custom flags correctly', () => {
    const opts = parseArgs([
      '--mode', 'plan-execute',
      '--model', 'gemini-pro',
      '--model-planning', 'claude-opus',
      '--model-execution', 'gemini-flash',
      '--base-url', 'http://127.0.0.1:4000',
      '--master-key', 'sk-custom',
      '--delay', '5000',
      '--case', 'one-to-two-bug-fix',
      '--config', 'custom-plan.json'
    ]);

    assert.equal(opts.mode, 'plan-execute');
    assert.equal(opts.model, 'gemini-pro');
    assert.equal(opts.modelPlanning, 'claude-opus');
    assert.equal(opts.modelExecution, 'gemini-flash');
    assert.equal(opts.baseUrl, 'http://127.0.0.1:4000');
    assert.equal(opts.masterKey, 'sk-custom');
    assert.equal(opts.delay, 5000);
    assert.equal(opts.case, 'one-to-two-bug-fix');
    assert.equal(opts.config, 'custom-plan.json');
  });

  it('should parse --interactive flag correctly', () => {
    const optsDefault = parseArgs([]);
    assert.equal(optsDefault.interactive, false);

    const optsInteractive = parseArgs(['--interactive']);
    assert.equal(optsInteractive.interactive, true);
  });

  it('should parse --no-walkthrough flag correctly', () => {
    const optsDefault = parseArgs([]);
    assert.equal(optsDefault.walkthrough, true);

    const optsNoWalkthrough = parseArgs(['--no-walkthrough']);
    assert.equal(optsNoWalkthrough.walkthrough, false);
  });

  it('resolveCaseOptions merges testPlan settings and CLI overrides', () => {
    const testPlan = {
      defaults: { delay: 4000 },
      runs: [
        { case: 'code-review', mode: 'simple', model: 'claude-sonnet' },
        { case: 'legacy-modernization', mode: 'plan-execute', modelPlanning: 'claude-sonnet', modelExecution: 'gemini-pro' }
      ]
    };

    // No explicit CLI overrides
    const parsedNoOverrides = parseArgs([]);
    const codeReviewOpts = resolveCaseOptions('code-review', parsedNoOverrides, testPlan);
    assert.equal(codeReviewOpts.mode, 'simple');
    assert.equal(codeReviewOpts.model, 'claude-sonnet');
    assert.equal(codeReviewOpts.delay, 4000);

    const legacyOpts = resolveCaseOptions('legacy-modernization', parsedNoOverrides, testPlan);
    assert.equal(legacyOpts.mode, 'plan-execute');
    assert.equal(legacyOpts.modelPlanning, 'claude-sonnet');
    assert.equal(legacyOpts.modelExecution, 'gemini-pro');

    // With explicit CLI overrides
    const parsedWithOverrides = parseArgs(['--model', 'gemini-flash']);
    const overriddenOpts = resolveCaseOptions('code-review', parsedWithOverrides, testPlan);
    assert.equal(overriddenOpts.model, 'gemini-flash');

    // Passing direct run object
    const runObj = { case: 'zero-to-one-vibe-coding', mode: 'simple', model: 'gemini-flash' };
    const runObjOpts = resolveCaseOptions(runObj, parsedNoOverrides, testPlan);
    assert.equal(runObjOpts.case, 'zero-to-one-vibe-coding');
    assert.equal(runObjOpts.mode, 'simple');
    assert.equal(runObjOpts.model, 'gemini-flash');
    assert.equal(runObjOpts.delay, 4000);
  });

  it('should validate missing flag value and exit', () => {
    // Intercept process.exit and console.error
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit:${code}`);
    };

    try {
      assert.throws(() => parseArgs(['--agent']), /process\.exit:1/);
      assert.equal(exitCode, 1);

      assert.throws(() => parseArgs(['--agent', '--mode', 'simple']), /process\.exit:1/);
    } finally {
      process.exit = originalExit;
    }
  });

  it('should validate invalid flag values and exit', () => {
    const originalExit = process.exit;
    process.exit = (code) => {
      throw new Error(`process.exit:${code}`);
    };

    try {
      // Invalid mode
      assert.throws(() => parseArgs(['--mode', 'invalid-mode']), /process\.exit:1/);

      // Invalid delay
      assert.throws(() => parseArgs(['--delay', 'not-a-number']), /process\.exit:1/);
      assert.throws(() => parseArgs(['--delay', '-100']), /process\.exit:1/);

      // Unknown argument
      assert.throws(() => parseArgs(['--unknown-flag']), /process\.exit:1/);
    } finally {
      process.exit = originalExit;
    }
  });
  it('should print test plan table without error', async () => {
    const { printTestPlanTable } = await import('../src/main.js');
    const runsToExecute = [
      { case: 'zero-to-one-vibe-coding', mode: 'simple', model: 'claude-sonnet' },
      { case: 'legacy-modernization', mode: 'plan-execute', modelPlanning: 'claude-sonnet', modelExecution: 'gemini-flash' },
    ];

    let logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      printTestPlanTable(runsToExecute, defaults, null);
      assert.ok(logs.some((l) => l.includes('Scheduled Test Case Runs Table')));
      assert.ok(logs.some((l) => l.includes('zero-to-one-vibe-coding')));
      assert.ok(logs.some((l) => l.includes('claude-sonnet / gemini-flash')));
    } finally {
      console.log = origLog;
    }
  });
});


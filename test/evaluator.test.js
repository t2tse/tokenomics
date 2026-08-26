import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { assembleEvaluationContext, evaluateWalkthrough } from '../src/evaluator.js';

describe('evaluator module', () => {
  it('assembleEvaluationContext correctly extracts prompt, walkthrough, files list, and logs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
    const caseDir = path.join(tmpDir, 'test-case');
    const outputDir = path.join(caseDir, 'output-20260825');
    fs.mkdirSync(outputDir, { recursive: true });

    // Create prompt file
    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build a feature flag service with GET and POST endpoints.');
    // Create walkthrough file
    fs.writeFileSync(path.join(outputDir, 'AGENT-WALKTHROUGH.md'), '# Walkthrough\nTested server with curl.');
    // Create output files
    fs.writeFileSync(path.join(outputDir, 'server.js'), 'console.log("server");');
    fs.writeFileSync(path.join(outputDir, 'package.json'), '{}');
    // Create logs
    fs.writeFileSync(path.join(outputDir, 'AGENT-OUTPUT.out'), 'Build success');
    fs.writeFileSync(path.join(outputDir, 'AGENT-OUTPUT.err'), '');

    const context = assembleEvaluationContext({ caseDir, outputDir });

    assert.ok(context.promptContent.includes('Build a feature flag service'));
    assert.equal(context.walkthroughExists, true);
    assert.ok(context.walkthroughContent.includes('Tested server with curl'));
    assert.ok(context.filesList.includes('server.js'));
    assert.ok(context.filesList.includes('package.json'));
    assert.ok(context.stdoutSnippet.includes('Build success'));

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('assembleEvaluationContext supports plan/exec prompt pairs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-plan-test-'));
    const caseDir = path.join(tmpDir, 'test-case');
    const outputDir = path.join(caseDir, 'output-20260825');
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(caseDir, 'PROMPT-PLAN.md'), 'Plan the refactoring.');
    fs.writeFileSync(path.join(caseDir, 'PROMPT-EXEC.md'), 'Execute the plan.');

    const context = assembleEvaluationContext({ caseDir, outputDir });

    assert.ok(context.promptContent.includes('Plan the refactoring'));
    assert.ok(context.promptContent.includes('Execute the plan'));
    assert.equal(context.walkthroughExists, false);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('evaluateWalkthrough returns 0 score when walkthrough is missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-missing-test-'));
    const caseDir = path.join(tmpDir, 'test-case');
    const outputDir = path.join(caseDir, 'output-20260825');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await evaluateWalkthrough({ caseDir, outputDir, options: { evalModel: 'gemini-pro' } });

    assert.equal(result.evaluation.score, 0);
    assert.equal(result.evaluation.status, 'FAIL');
    assert.ok(result.evaluation.critique.weaknesses.some((w) => w.includes('AGENT-WALKTHROUGH.md was not generated')));
    assert.equal(result.evalMetrics.totalTokens, 0);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('evaluateWalkthrough correctly parses structured JSON response from LiteLLM', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-parse-test-'));
    const caseDir = path.join(tmpDir, 'test-case');
    const outputDir = path.join(caseDir, 'output-20260825');
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build a feature flag server.');
    fs.writeFileSync(path.join(outputDir, 'AGENT-WALKTHROUGH.md'), '# Walkthrough\nAll done.');

    const mockEvaluation = {
      score: 95,
      status: 'PASS',
      pillars: {
        promptCompliance: { score: 38, max: 40 },
        grounding: { score: 25, max: 25 },
        reproducibility: { score: 18, max: 20 },
        hygiene: { score: 14, max: 15 },
      },
      checklist: [
        { requirement: 'Feature flags endpoints', status: 'MET', evidence: 'Implemented in server.js' },
      ],
      critique: {
        strengths: ['Great documentation'],
        weaknesses: [],
        actionableFeedback: 'Add automated curl tests in script.',
      },
    };

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n' + JSON.stringify(mockEvaluation) + '\n```',
            },
          },
        ],
        usage: {
          prompt_tokens: 450,
          completion_tokens: 180,
          total_tokens: 630,
        },
      }),
      text: async () => '',
    });

    try {
      const result = await evaluateWalkthrough({
        caseDir,
        outputDir,
        options: { baseUrl: 'http://127.0.0.1:4000', masterKey: 'sk-test', evalModel: 'gemini-pro' },
      });

      assert.equal(result.evaluation.score, 95);
      assert.equal(result.evaluation.status, 'PASS');
      assert.equal(result.evaluation.pillars.promptCompliance.score, 38);
      assert.equal(result.evalMetrics.promptTokens, 450);
      assert.equal(result.evalMetrics.completionTokens, 180);
      assert.equal(result.evalMetrics.totalTokens, 630);
      assert.equal(result.evalMetrics.model, 'gemini-pro');
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('evaluateWalkthrough gracefully handles LLM error or invalid response', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-err-test-'));
    const caseDir = path.join(tmpDir, 'test-case');
    const outputDir = path.join(caseDir, 'output-20260825');
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build a feature flag server.');
    fs.writeFileSync(path.join(outputDir, 'AGENT-WALKTHROUGH.md'), '# Walkthrough\nAll done.');

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    try {
      const result = await evaluateWalkthrough({
        caseDir,
        outputDir,
        options: { baseUrl: 'http://127.0.0.1:4000', masterKey: 'sk-test', evalModel: 'gemini-pro' },
      });

      assert.equal(result.evaluation.score, 0);
      assert.equal(result.evaluation.status, 'FAIL');
      assert.ok(result.evaluation.critique.weaknesses.some((w) => w.includes('Evaluation failed')));
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runStandaloneEvaluations skips already evaluated runs unless reEvaluate is true', async () => {
    const { runStandaloneEvaluations } = await import('../src/main.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-eval-test-'));
    const useCasesDir = path.join(tmpDir, 'use-cases');
    const caseDir = path.join(useCasesDir, 'sample-case');
    const outputDir = path.join(caseDir, 'output-20260825-120000');
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(caseDir, 'PROMPT.md'), 'Build hello world');
    fs.writeFileSync(path.join(outputDir, 'AGENT-WALKTHROUGH.md'), '# Walkthrough');

    const resultPath = path.join(caseDir, 'test-results-20260825-120000.json');
    fs.writeFileSync(resultPath, JSON.stringify({
      caseName: 'sample-case',
      success: true,
      evaluation: { score: 88, status: 'PASS' },
    }, null, 2));

    let logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    try {
      // Running with reEvaluate: false should skip
      await runStandaloneEvaluations({
        case: 'sample-case',
        evaluate: true,
        reEvaluate: false,
        baseUrl: 'http://127.0.0.1:4000',
        evalModel: 'gemini-pro',
      }, tmpDir);
      assert.ok(logs.some((l) => l.includes('already evaluated: 88/100')));
    } finally {
      console.log = origLog;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

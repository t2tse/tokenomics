import fs from 'fs';
import path from 'path';
import { copyDir } from './utils/fs.js';
import { getFormattedTimestamp, sleep } from './utils/time.js';
import { createTestUser, fetchUserMetrics } from './litellm-client.js';
import { runCodingAgent } from './agents/agent.js';
import { DEFAULT_AGENT } from './config.js';

/**
 * Runs a single benchmark test case.
 * @param {string} caseName - Name of test case directory
 * @param {object} options - Execution options
 * @param {string} parentDir - Root parent directory or use-cases directory containing test case folders
 * @returns {Promise<object>} Test case run result object
 */
export async function runTestCase(caseName, options, parentDir) {
  const useCasesDir = path.basename(parentDir) === 'use-cases'
    ? parentDir
    : path.join(parentDir, 'use-cases');
  const caseDir = path.join(useCasesDir, caseName);
  console.log(`\n======================================================================`);
  console.log(`🚀 [START] Running Test Case: "${caseName}" (Mode: ${options.mode.toUpperCase()})`);
  console.log(`======================================================================`);

  if (!fs.existsSync(caseDir)) {
    throw new Error(`Test case folder does not exist: ${caseDir}`);
  }

  // Define unique timestamp for this test run execution
  const runTimestamp = getFormattedTimestamp();
  const outputDirName = `output-${runTimestamp}`;
  const outputDir = path.join(caseDir, outputDirName);

  console.log(`🛠️ [PREPARE] Creating isolated test run directory: ${outputDirName}`);
  copyDir(caseDir, outputDir);

  // 1. Determine Prompt to use from the original folder
  let promptText = '';
  const promptPath = path.join(caseDir, 'PROMPT.md');

  if (fs.existsSync(promptPath)) {
    promptText = fs.readFileSync(promptPath, 'utf8').trim();
  }

  // If the prompt is missing or completely empty, provide a localized fallback task
  if (!promptText) {
    promptText = `Implement a simple test function in the current folder "${caseName}". For example, create a new file "solution.js" that exports a function sum(a, b) and write a small test.`;
  }

  // 2. Create a view-only internal user and generate a single unique Virtual Key on LiteLLM BEFORE starting the agent
  console.log(`🔐 [LITELLM] Provisioning LiteLLM user and virtual key prior to agent execution...`);
  const { userId, secretKey } = await createTestUser({
    baseUrl: options.baseUrl,
    masterKey: options.masterKey,
    caseName,
    runTimestamp,
  });

  // 3. Run the coding agent based on simple vs plan-execute mode
  let agentRuns = [];

  try {
    if (options.mode === 'simple') {
      // Simple Run
      console.log(`🤖 [AGENT] Starting Simple Phase (${options.agent || DEFAULT_AGENT}) with model: ${options.model} (Interactive: ${Boolean(options.interactive)})`);
      const run = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.model,
        mode: 'auto',
        promptText,
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: options.interactive,
      });
      agentRuns.push({ phase: 'execution', model: options.model, ...run });
    } else {
      // Plan-Execute Run
      // Phase 1: Planning
      console.log(`🤖 [AGENT] Starting Plan-Execute Phase 1 (Planning, ${options.agent || DEFAULT_AGENT}) with model: ${options.modelPlanning} (Interactive: ${Boolean(options.interactive)})`);
      const planRun = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.modelPlanning,
        mode: 'plan',
        promptText,
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: options.interactive,
      });
      agentRuns.push({ phase: 'planning', model: options.modelPlanning, ...planRun });

      // Phase 2: Execution
      console.log(`🤖 [AGENT] Starting Plan-Execute Phase 2 (Execution, ${options.agent || DEFAULT_AGENT}) with model: ${options.modelExecution} (Interactive: ${Boolean(options.interactive)})`);
      const execRun = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.modelExecution,
        mode: 'auto',
        promptText,
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: options.interactive,
      });
      agentRuns.push({ phase: 'execution', model: options.modelExecution, ...execRun });
    }
  } catch (err) {
    console.error(`❌ [AGENT] Execution error during run: ${err.message}`);
    agentRuns.push({ phase: 'error', model: options.model || 'unknown', code: -1, durationMs: 0, stdout: '', stderr: err.message, success: false });
  } finally {
    // 4. Wait for LiteLLM DB metrics to flush
    console.log(`⏳ [METRICS] Waiting ${options.delay}ms for LiteLLM transaction logs to flush...`);
    await sleep(options.delay);

    // 5. Fetch spend and metrics
    console.log(`📊 [METRICS] Fetching LiteLLM metrics for User: ${userId}`);
    let usageData = { metadata: null };
    let userInfo = { user_info: { spend: 0 } };
    try {
      const fetched = await fetchUserMetrics({
        baseUrl: options.baseUrl,
        masterKey: options.masterKey,
        userId,
      });
      usageData = fetched.usageData || usageData;
      userInfo = fetched.userInfo || userInfo;
    } catch (mErr) {
      console.error(`⚠️ [METRICS] Failed to fetch metrics from LiteLLM: ${mErr.message}`);
    }

    const totalWallClockDurationMs = agentRuns.reduce((sum, run) => sum + run.durationMs, 0);
    const success = agentRuns.length > 0 && agentRuns.every((run) => run.success);

    const metrics = usageData.metadata || {
      total_spend: (userInfo.user_info && userInfo.user_info.spend) || 0,
      total_prompt_tokens: 0,
      total_completion_tokens: 0,
      total_tokens: 0,
      total_api_requests: 0,
      total_successful_requests: 0,
      total_failed_requests: 0,
    };

    const testCaseResult = {
      caseName,
      success,
      totalWallClockDurationSeconds: totalWallClockDurationMs / 1000,
      metrics: {
        spendUSD: metrics.total_spend || (userInfo.user_info && userInfo.user_info.spend) || 0,
        promptTokens: metrics.total_prompt_tokens || 0,
        completionTokens: metrics.total_completion_tokens || 0,
        totalTokens: metrics.total_tokens || 0,
        totalRequests: metrics.total_api_requests || 0,
        successfulRequests: metrics.total_successful_requests || 0,
        failedRequests: metrics.total_failed_requests || 0,
      },
      runs: agentRuns.map((run) => ({
        phase: run.phase,
        model: run.model,
        wallClockDurationSeconds: run.durationMs / 1000,
        success: run.success,
        exitCode: run.code,
      })),
    };

    console.log(`🏁 [FINISHED] Test Case: "${caseName}" Result: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   ⏱️ Wall-Clock Duration: ${testCaseResult.totalWallClockDurationSeconds.toFixed(2)}s`);
    console.log(`   💰 Spend: $${testCaseResult.metrics.spendUSD.toFixed(6)}`);
    console.log(`   🪙 Tokens: ${testCaseResult.metrics.totalTokens} (Prompt: ${testCaseResult.metrics.promptTokens}, Completion: ${testCaseResult.metrics.completionTokens})`);
    console.log(`   🌐 API Requests: ${testCaseResult.metrics.totalRequests} (Success: ${testCaseResult.metrics.successfulRequests}, Fail: ${testCaseResult.metrics.failedRequests})`);

    // Write individual test results inside the test case folder
    const resultsFileName = `test-results-${runTimestamp}.json`;
    const resultsFilePath = path.join(caseDir, resultsFileName);
    fs.writeFileSync(resultsFilePath, JSON.stringify(testCaseResult, null, 2), 'utf8');
    console.log(`💾 [RESULTS] Written individual test results JSON to: ${resultsFilePath}`);

    return testCaseResult;
  }
}

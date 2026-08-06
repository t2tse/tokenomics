import fs from 'fs';
import path from 'path';
import { copyDir } from './utils/fs.js';
import { getFormattedTimestamp, sleep } from './utils/time.js';
import { createTestUser, fetchUserMetrics } from './litellm-client.js';
import { runCodingAgent } from './agents/agent.js';
import { DEFAULT_AGENT } from './config.js';
import { generateManifest } from './generate-manifest.js';

export const WALKTHROUGH_PROMPT = `After you finish all the tasks above, focus on the output you produced in the current output folder and do the following before hanging up
1. Test out the app on your own for all functionality and provide a detailed AGENT-WALKTHROUGH.md on how to setup, run, make any further changes and clean up steps.
2. Tell me how to launch the app for me to review. If running the app locally, ensure it only requires packages and runs within the project. Do not install anything globally.
3. If no app is generated, do not tell me any setup steps as these are irrelevant. Just tell me what you did in AGENT-WALKTHROUGH.md`;

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
  const isInteractive = Boolean(options.interactive);
  const isPlanExecute = !isInteractive && options.mode === 'plan-execute';

  console.log(`\n======================================================================`);
  console.log(`🚀 [START] Running Test Case: "${caseName}" (Mode: ${isInteractive ? 'INTERACTIVE' : options.mode.toUpperCase()})`);
  console.log(`======================================================================`);

  if (!fs.existsSync(caseDir)) {
    throw new Error(`Test case folder does not exist: ${caseDir}`);
  }

  // 1. Determine Prompt files and validate prompt availability
  const promptPath = path.join(caseDir, 'PROMPT.md');
  const planPromptPath = path.join(caseDir, 'PROMPT-PLAN.md');
  const execPromptPath = path.join(caseDir, 'PROMPT-EXEC.md');

  const mainPromptText = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8').trim() : '';
  const planPromptText = fs.existsSync(planPromptPath) ? fs.readFileSync(planPromptPath, 'utf8').trim() : '';
  const execPromptText = fs.existsSync(execPromptPath) ? fs.readFileSync(execPromptPath, 'utf8').trim() : '';

  let promptTextSimple = mainPromptText;
  let promptTextPlan = planPromptText || mainPromptText;
  let promptTextExec = execPromptText || mainPromptText;

  const shouldAppendWalkthrough = !isInteractive && options.walkthrough !== false;

  if (isInteractive) {
    // Interactive mode: user prompts directly in agent UI; PROMPT md files are not required or injected
    console.log(`ℹ️ [NOTICE] Running in interactive mode. Please prompt and interact directly with the coding agent to continue the tokenomics measurements.`);
  } else if (isPlanExecute) {
    // Non-interactive headless mode in plan-execute mode
    if (!promptTextPlan || !promptTextExec) {
      throw new Error(
        `Prompt files are missing or empty for test case "${caseName}". Please provide PROMPT-PLAN.md and PROMPT-EXEC.md in: ${planPromptPath} and ${execPromptPath}`
      );
    }
    if (shouldAppendWalkthrough) {
      promptTextExec = `${promptTextExec}\n\n${WALKTHROUGH_PROMPT}`;
    }
  } else {
    // Non-interactive headless mode in simple mode
    if (!promptTextSimple) {
      throw new Error(
        `PROMPT.md is missing or empty for test case "${caseName}". Please provide PROMPT.md in: ${promptPath}`
      );
    }
    if (shouldAppendWalkthrough) {
      promptTextSimple = `${promptTextSimple}\n\n${WALKTHROUGH_PROMPT}`;
    }
  }

  // Define unique timestamp for this test run execution
  const runTimestamp = getFormattedTimestamp();
  const outputDirName = `output-${runTimestamp}`;
  const outputDir = path.join(caseDir, outputDirName);

  console.log(`🛠️ [PREPARE] Creating isolated test run directory: ${outputDirName}`);
  copyDir(caseDir, outputDir);

  // 2. Create a view-only internal user and generate a single unique Virtual Key on LiteLLM BEFORE starting the agent
  console.log(`🔐 [LITELLM] Provisioning LiteLLM user and virtual key prior to agent execution...`);
  const { userId, secretKey } = await createTestUser({
    baseUrl: options.baseUrl,
    masterKey: options.masterKey,
    caseName,
    runTimestamp,
  });

  // 3. Run the coding agent based on interactive vs headless (simple vs plan-execute) mode
  let agentRuns = [];

  try {
    if (isInteractive) {
      // Interactive Mode: simple vs plan-execute mode and prompt files are ignored; user prompts directly
      console.log(`🤖 [AGENT] Starting Interactive Session (${options.agent || DEFAULT_AGENT}) with model: ${options.model}`);
      const run = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.model,
        mode: 'auto',
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: true,
      });
      agentRuns.push({ phase: 'interactive', model: options.model, ...run });
    } else if (isPlanExecute) {
      // Plan-Execute Run (Headless)
      // Phase 1: Planning
      console.log(`🤖 [AGENT] Starting Plan-Execute Phase 1 (Planning, ${options.agent || DEFAULT_AGENT}) with model: ${options.modelPlanning}`);
      const planRun = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.modelPlanning,
        mode: 'plan',
        promptText: promptTextPlan,
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: false,
      });
      agentRuns.push({ phase: 'planning', model: options.modelPlanning, ...planRun });

      // Phase 2: Execution
      console.log(`🤖 [AGENT] Starting Plan-Execute Phase 2 (Execution, ${options.agent || DEFAULT_AGENT}) with model: ${options.modelExecution}`);
      const execRun = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.modelExecution,
        mode: 'auto',
        promptText: promptTextExec,
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: false,
      });
      agentRuns.push({ phase: 'execution', model: options.modelExecution, ...execRun });
    } else {
      // Simple Run (Headless)
      console.log(`🤖 [AGENT] Starting Simple Phase (${options.agent || DEFAULT_AGENT}) with model: ${options.model}`);
      const run = await runCodingAgent({
        agent: options.agent,
        caseDir: outputDir,
        caseName,
        secretKey,
        model: options.model,
        mode: 'auto',
        promptText: promptTextSimple,
        baseUrl: options.baseUrl,
        outputFormat: options.outputFormat,
        interactive: false,
      });
      agentRuns.push({ phase: 'execution', model: options.model, ...run });
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

    try {
      generateManifest();
    } catch (mErr) {
      console.error(`⚠️ [MANIFEST] Failed updating manifest: ${mErr.message}`);
    }

    return testCaseResult;
  }
}

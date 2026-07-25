import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, resolveCaseOptions } from './config.js';
import { getFormattedTimestamp } from './utils/time.js';
import { runTestCase } from './runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parentDir = path.resolve(__dirname, '..');

/**
 * Main application entry point for orchestrating test harness execution.
 * @param {string[]} [cliArgs] - Optional command-line arguments override
 */
export async function main(cliArgs) {
  const options = parseArgs(cliArgs);

  // Determine path to test plan configuration file
  const configPath = path.isAbsolute(options.config)
    ? options.config
    : path.join(parentDir, options.config);

  const configExists = fs.existsSync(configPath);

  // Mandatory requirement: if no --case option provided, test-plan.json (or --config file) is required
  if (!options.case && !configExists) {
    console.error(`❌ Error: Test plan configuration file "${configPath}" not found.`);
    console.error(`When running without --case, supplying a valid test plan configuration file is mandatory.`);
    process.exit(1);
  }

  let testPlan = null;
  if (configExists) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      testPlan = JSON.parse(configContent);
    } catch (err) {
      console.error(`❌ Error parsing test plan configuration file "${configPath}":`, err.message);
      process.exit(1);
    }
  }

  console.log(`======================================================================`);
  console.log(`🚀 Coding Agent Tokenomics Test Harness Initializing...`);
  console.log(`----------------------------------------------------------------------`);
  console.log(`🔗 LiteLLM proxy Base URL:     ${options.baseUrl}`);
  console.log(`📋 Config File:  ${configExists ? path.basename(configPath) : 'None (single case mode)'}`);
  console.log(`======================================================================`);

  // Detect and list all available test cases from the use-cases sub-directory
  const useCasesDir = path.join(parentDir, 'use-cases');
  const dirContents = fs.existsSync(useCasesDir)
    ? fs.readdirSync(useCasesDir, { withFileTypes: true })
    : [];
  const discoveredCases = dirContents
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
    .map((item) => item.name);

  let targetCases = [];
  if (options.case) {
    if (!discoveredCases.includes(options.case)) {
      console.error(`❌ Error: Case "${options.case}" not found. Available cases: ${discoveredCases.join(', ')}`);
      process.exit(1);
    }
    targetCases = [options.case];
  } else {
    targetCases = discoveredCases;
  }

  console.log(`🔍 Discovered ${discoveredCases.length} total test cases in use-cases/ directory.`);
  console.log(`🎯 Targeting test cases: ${targetCases.join(', ')}`);

  const results = [];
  const errors = [];

  for (const caseName of targetCases) {
    try {
      // Resolve per-case mode & model options using test plan config
      const caseOptions = resolveCaseOptions(caseName, options, testPlan);
      const result = await runTestCase(caseName, caseOptions, useCasesDir);
      results.push(result);
    } catch (err) {
      console.error(`❌ [ERROR] Failed running test case "${caseName}":`, err);
      errors.push({ caseName, error: err.message });
    }
  }

  // Calculate statistics
  const summary = {
    timestamp: getFormattedTimestamp(),
    results,
    errors,
    aggregate: {
      totalCasesRun: results.length,
      successfulCases: results.filter((r) => r.success).length,
      failedCases: results.filter((r) => !r.success).length + errors.length,
      totalWallClockDurationSeconds: results.reduce((sum, r) => sum + r.totalWallClockDurationSeconds, 0),
      totalSpendUSD: results.reduce((sum, r) => sum + r.metrics.spendUSD, 0),
      totalTokens: results.reduce((sum, r) => sum + r.metrics.totalTokens, 0),
      totalRequests: results.reduce((sum, r) => sum + r.metrics.totalRequests, 0),
    },
  };

  console.log(`\n======================================================================`);
  console.log(`🎉 Test Runs Completed! Individual results saved inside each case folder.`);
  console.log(`======================================================================`);
  console.log(`📊 Summary Statistics:`);
  console.log(`  📦 Total Cases:               ${summary.aggregate.totalCasesRun}`);
  console.log(`  📈 Success Rate:              ${summary.aggregate.successfulCases} / ${summary.aggregate.totalCasesRun} (${((summary.aggregate.successfulCases / summary.aggregate.totalCasesRun) * 100 || 0).toFixed(1)}%)`);
  console.log(`  ⏱️ Total Wall Clock Duration: ${summary.aggregate.totalWallClockDurationSeconds.toFixed(2)}s`);
  console.log(`  💰 Total Spend:               $${summary.aggregate.totalSpendUSD.toFixed(6)}`);
  console.log(`  🪙 Total Tokens:              ${summary.aggregate.totalTokens} tokens`);
  console.log(`  🌐 Total Requests:            ${summary.aggregate.totalRequests} requests`);
  console.log(`======================================================================\n`);
}

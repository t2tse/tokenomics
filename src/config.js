/**
 * Global default coding agent name.
 * Swap this single variable to change the default agent across the application.
 */
export const DEFAULT_AGENT = 'claude';

/**
 * Default configuration options
 */
export const defaults = {
  agent: DEFAULT_AGENT,
  mode: 'simple',
  interactive: false,
  walkthrough: true,
  yolo: false,
  model: 'claude-sonnet',
  modelPlanning: 'claude-sonnet',
  modelExecution: 'gemini-flash',
  outputFormat: 'text',
  baseUrl: 'http://localhost:4000',
  masterKey: process.env.LITELLM_API_KEY || 'sk-9999',
  delay: 10000,
  case: null,
  config: 'test-plan.json',
};

/**
 * Prints CLI usage help text to stdout.
 */
export function printHelp() {
  console.log(`
LiteLLM Coding Agent Test Harness
=================================
Runs software development tasks through Claude Code CLI or other registered agent engines
using a local LiteLLM proxy, tracking detailed token usage, API request count, duration, and financial cost.

Usage:
  tokenomics [options] (or ./bin/tokenomics [options])

Options:
  --agent <name>           Coding agent engine to run (default: '${DEFAULT_AGENT}')
  --case <name>            Name of specific test case directory to run (e.g. zero-to-one-vibe-coding).
                           If omitted, runs all available test cases using the test plan config file.
  --config <path>          Path to test plan JSON configuration file (default: 'test-plan.json')
  --mode <type>            Run mode override: 'simple' or 'plan-execute' (default: 'simple')
  --interactive            Run coding agent in interactive mode instead of headless mode (default: false)
  --no-walkthrough         Disable appending walkthrough prompt doc instructions in headless mode (default: walkthrough is on)
  --yolo                   Override agent permission mode to 'bypassPermissions' in headless execution (default: false)
  --model <name>           Model override for simple mode (default: 'claude-sonnet')
  --model-planning <name>  Model override for planning phase in plan-execute mode (default: 'claude-sonnet')
  --model-execution <name> Model override for execution phase in plan-execute mode (default: 'gemini-flash')
  --base-url <url>         LiteLLM proxy endpoint (default: 'http://localhost:4000')
  --master-key <key>       LiteLLM master/admin API key (default: env LITELLM_API_KEY or 'sk-9999')
  --delay <ms>             Delay in ms before querying LiteLLM spend APIs after runs (default: 10000)
  --help, -h               Show this help message

Models available in LiteLLM:
  - claude-sonnet
  - gemini-flash
  - gemini-pro
`);
}

const VALID_MODES = ['simple', 'plan-execute'];

/**
 * Parses command-line arguments and returns merged configuration options.
 * @param {string[]} [args=process.argv.slice(2)] - Command line arguments
 * @returns {object} Options object with non-enumerable _explicitFlags property
 */
export function parseArgs(args = process.argv.slice(2)) {
  const options = { ...defaults };
  const explicitFlags = new Set();

  const getValue = (index, flagName) => {
    const nextArg = args[index + 1];
    if (nextArg === undefined || nextArg.startsWith('--')) {
      console.error(`❌ Error: Flag "${flagName}" requires a non-empty value.`);
      printHelp();
      process.exit(1);
    }
    return nextArg;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent') {
      options.agent = getValue(i, arg);
      i++;
      explicitFlags.add('agent');
    } else if (arg === '--mode') {
      const modeVal = getValue(i, arg);
      if (!VALID_MODES.includes(modeVal)) {
        console.error(`❌ Error: Invalid value "${modeVal}" for flag "--mode". Allowed values: ${VALID_MODES.join(', ')}`);
        process.exit(1);
      }
      options.mode = modeVal;
      i++;
      explicitFlags.add('mode');
    } else if (arg === '--interactive') {
      options.interactive = true;
      explicitFlags.add('interactive');
    } else if (arg === '--no-walkthrough') {
      options.walkthrough = false;
      explicitFlags.add('walkthrough');
    } else if (arg === '--yolo') {
      options.yolo = true;
      explicitFlags.add('yolo');
    } else if (arg === '--model') {
      options.model = getValue(i, arg);
      i++;
      explicitFlags.add('model');
    } else if (arg === '--model-planning') {
      options.modelPlanning = getValue(i, arg);
      i++;
      explicitFlags.add('modelPlanning');
    } else if (arg === '--model-execution') {
      options.modelExecution = getValue(i, arg);
      i++;
      explicitFlags.add('modelExecution');
    } else if (arg === '--base-url') {
      options.baseUrl = getValue(i, arg);
      i++;
      explicitFlags.add('baseUrl');
    } else if (arg === '--master-key') {
      options.masterKey = getValue(i, arg);
      i++;
      explicitFlags.add('masterKey');
    } else if (arg === '--delay') {
      const delayStr = getValue(i, arg);
      const delayNum = parseInt(delayStr, 10);
      if (isNaN(delayNum) || delayNum < 0 || String(delayNum) !== delayStr.trim()) {
        console.error(`❌ Error: Invalid value "${delayStr}" for flag "--delay". Must be a non-negative integer.`);
        process.exit(1);
      }
      options.delay = delayNum;
      i++;
      explicitFlags.add('delay');
    } else if (arg === '--case') {
      options.case = getValue(i, arg);
      i++;
      explicitFlags.add('case');
    } else if (arg === '--config') {
      options.config = getValue(i, arg);
      i++;
      explicitFlags.add('config');
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`❌ Error: Unknown argument "${arg}".`);
      printHelp();
      process.exit(1);
    }
  }

  Object.defineProperty(options, '_explicitFlags', {
    value: explicitFlags,
    enumerable: false,
    writable: true,
  });

  return options;
}

/**
 * Merges defaults, test plan config, and CLI overrides for a specific test case or run object.
 * @param {string|object} caseInput - Name of test case directory or run object from testPlan.runs
 * @param {object} globalOptions - Options object returned by parseArgs
 * @param {object|null} testPlan - Parsed test-plan.json object
 * @returns {object} Options for this test case execution
 */
export function resolveCaseOptions(caseInput, globalOptions, testPlan) {
  const explicitFlags = globalOptions._explicitFlags || new Set();
  const caseName = typeof caseInput === 'object' && caseInput !== null
    ? (caseInput.case || caseInput.name || caseInput.caseName)
    : caseInput;

  const resolved = {
    ...defaults,
    agent: globalOptions.agent,
    interactive: globalOptions.interactive,
    walkthrough: globalOptions.walkthrough,
    yolo: globalOptions.yolo,
    baseUrl: globalOptions.baseUrl,
    masterKey: globalOptions.masterKey,
    delay: globalOptions.delay,
  };

  // 1. Apply testPlan defaults if present
  if (testPlan && testPlan.defaults && typeof testPlan.defaults === 'object') {
    Object.assign(resolved, testPlan.defaults);
  }

  // 2. Apply case-specific config from testPlan if present
  let caseConfig = null;
  if (typeof caseInput === 'object' && caseInput !== null) {
    caseConfig = caseInput;
  } else if (testPlan) {
    if (Array.isArray(testPlan.runs)) {
      caseConfig = testPlan.runs.find(
        (r) => r.case === caseName || r.name === caseName || r.caseName === caseName
      );
    } else if (testPlan.cases && typeof testPlan.cases === 'object') {
      caseConfig = testPlan.cases[caseName];
    }
  }

  if (caseConfig) {
    Object.assign(resolved, caseConfig);
  }

  // 3. Apply explicit CLI overrides
  for (const flag of explicitFlags) {
    if (globalOptions[flag] !== undefined) {
      resolved[flag] = globalOptions[flag];
    }
  }

  if (resolved.mode && !VALID_MODES.includes(resolved.mode)) {
    console.error(`❌ Error: Invalid mode "${resolved.mode}" resolved for case "${caseName}". Allowed values: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }

  resolved.case = caseName;
  return resolved;
}

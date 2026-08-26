// Load environment variables from .env file if available (Node.js 20.6+)
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // .env file not found or inaccessible - continue with default fallbacks
  }
}

/**
 * Global default coding agent name.
 * Configured via TOKENOMICS_AGENT or fallback to 'claude'.
 */
export const DEFAULT_AGENT = process.env.TOKENOMICS_AGENT || 'claude';

/**
 * Default configuration options.
 * Note: masterKey, evalModel, model, modelPlanning, and modelExecution do not have
 * hardcoded fallback values and must be provided via environment variables, .env,
 * CLI flags, or test plan configurations.
 */
export const defaults = {
  agent: DEFAULT_AGENT,
  mode: 'simple',
  interactive: false,
  walkthrough: true,
  yolo: false,
  evaluation: process.env.TOKENOMICS_EVALUATION !== undefined ? process.env.TOKENOMICS_EVALUATION !== 'false' : true,
  evalModel: process.env.TOKENOMICS_EVAL_MODEL || null,
  evaluate: false,
  reEvaluate: false,
  model: process.env.TOKENOMICS_MODEL || null,
  modelPlanning: process.env.TOKENOMICS_MODEL_PLANNING || null,
  modelExecution: process.env.TOKENOMICS_MODEL_EXECUTION || null,
  outputFormat: 'text',
  baseUrl: process.env.LITELLM_BASE_URL || 'http://localhost:4000',
  masterKey: process.env.LITELLM_MASTER_KEY || null,
  delay: parseInt(process.env.TOKENOMICS_DELAY || '10000', 10),
  case: null,
  config: process.env.TOKENOMICS_CONFIG || 'test-plan.json',
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
  --config <path>          Path to test plan JSON configuration file (default: '${defaults.config}')
  --mode <type>            Run mode override: 'simple' or 'plan-execute' (default: 'simple')
  --interactive            Run coding agent in interactive mode instead of headless mode (default: false)
  --no-walkthrough         Disable appending walkthrough prompt doc instructions in headless mode (default: walkthrough is on)
  --no-eval                Disable automated walkthrough quality evaluation on successful test runs (default: eval is on)
  --eval-model <name>      Model for judging walkthrough quality and prompt compliance (env: TOKENOMICS_EVAL_MODEL)
  --evaluate               Standalone mode: evaluate un-evaluated successful test run walkthroughs
  --re-evaluate            Standalone mode: re-evaluate all successful test runs (including already evaluated)
  --yolo                   Override agent permission mode to 'bypassPermissions' in headless execution (default: false)
  --model <name>           Model override for simple mode (env: TOKENOMICS_MODEL or test-plan.json)
  --model-planning <name>  Model override for planning phase in plan-execute mode (env: TOKENOMICS_MODEL_PLANNING or test-plan.json)
  --model-execution <name> Model override for execution phase in plan-execute mode (env: TOKENOMICS_MODEL_EXECUTION or test-plan.json)
  --base-url <url>         LiteLLM proxy endpoint (default: '${defaults.baseUrl}')
  --master-key <key>       LiteLLM master/admin API key (env: LITELLM_MASTER_KEY)
  --delay <ms>             Delay in ms before querying LiteLLM spend APIs after runs (default: ${defaults.delay})
  --help, -h               Show this help message
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
    } else if (arg === '--no-eval') {
      options.evaluation = false;
      explicitFlags.add('evaluation');
    } else if (arg === '--eval-model') {
      options.evalModel = getValue(i, arg);
      i++;
      explicitFlags.add('evalModel');
    } else if (arg === '--evaluate') {
      options.evaluate = true;
      explicitFlags.add('evaluate');
    } else if (arg === '--re-evaluate') {
      options.evaluate = true;
      options.reEvaluate = true;
      explicitFlags.add('evaluate');
      explicitFlags.add('reEvaluate');
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
    evaluation: globalOptions.evaluation,
    evalModel: globalOptions.evalModel,
    evaluate: globalOptions.evaluate,
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
  validateCaseOptions(resolved);
  return resolved;
}

/**
 * Validates that all required configuration settings are provided for a test run.
 * Fails fast with clear actionable error messages if any required variable is missing.
 * @param {object} options - Resolved case options
 */
export function validateCaseOptions(options) {
  const caseName = options.case || 'default';

  if (!options.masterKey) {
    console.error(`❌ Configuration Error: LiteLLM master API key is missing.`);
    console.error(`Please provide it by setting LITELLM_MASTER_KEY in your .env or environment variables, or pass the --master-key flag.`);
    process.exit(1);
  }

  const isInteractive = Boolean(options.interactive);
  const mode = options.mode || 'simple';

  if (!isInteractive) {
    if (mode === 'plan-execute') {
      if (!options.modelPlanning) {
        console.error(`❌ Configuration Error: Planning model for test case "${caseName}" (plan-execute mode) is missing.`);
        console.error(`Please provide it by setting TOKENOMICS_MODEL_PLANNING in your .env or environment variables, specifying "modelPlanning" in your test plan, or passing the --model-planning flag.`);
        process.exit(1);
      }
      if (!options.modelExecution) {
        console.error(`❌ Configuration Error: Execution model for test case "${caseName}" (plan-execute mode) is missing.`);
        console.error(`Please provide it by setting TOKENOMICS_MODEL_EXECUTION in your .env or environment variables, specifying "modelExecution" in your test plan, or passing the --model-execution flag.`);
        process.exit(1);
      }
    } else {
      if (!options.model) {
        console.error(`❌ Configuration Error: Model for test case "${caseName}" (simple mode) is missing.`);
        console.error(`Please provide it by setting TOKENOMICS_MODEL in your .env or environment variables, specifying "model" in your test plan, or passing the --model flag.`);
        process.exit(1);
      }
    }
  }

  if (options.evaluation && !options.evalModel) {
    console.error(`❌ Configuration Error: Evaluation model is missing.`);
    console.error(`Please provide it by setting TOKENOMICS_EVAL_MODEL in your .env or environment variables, or pass the --eval-model flag (or disable evaluation with --no-eval).`);
    process.exit(1);
  }
}


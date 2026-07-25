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
  model: 'claude-sonnet',
  modelPlanning: 'claude-sonnet',
  modelExecution: 'gemini-flash',
  outputFormat: 'text',
  baseUrl: 'http://localhost:4000',
  masterKey: process.env.LITELLM_API_KEY || 'sk-9999',
  delay: 3000,
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
  --model <name>           Model override for simple mode (default: 'claude-sonnet')
  --model-planning <name>  Model override for planning phase in plan-execute mode (default: 'claude-sonnet')
  --model-execution <name> Model override for execution phase in plan-execute mode (default: 'gemini-flash')
  --output-format <format> Output format for agent: 'text', 'json', or 'stream-json' (default: 'text')
  --base-url <url>         LiteLLM proxy endpoint (default: 'http://localhost:4000')
  --master-key <key>       LiteLLM master/admin API key (default: env LITELLM_API_KEY or 'sk-9999')
  --delay <ms>             Delay in ms before querying LiteLLM spend APIs after runs (default: 3000)
  --help, -h               Show this help message

Models available in LiteLLM:
  - claude-sonnet
  - gemini-flash
  - gemini-pro
`);
}

/**
 * Parses command-line arguments and returns merged configuration options.
 * @param {string[]} [args=process.argv.slice(2)] - Command line arguments
 * @returns {object} Options object with non-enumerable _explicitFlags property
 */
export function parseArgs(args = process.argv.slice(2)) {
  const options = { ...defaults };
  const explicitFlags = new Set();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--agent' && args[i + 1]) {
      options.agent = args[++i];
      explicitFlags.add('agent');
    } else if (arg === '--mode' && args[i + 1]) {
      options.mode = args[++i];
      explicitFlags.add('mode');
    } else if (arg === '--interactive') {
      options.interactive = true;
      explicitFlags.add('interactive');
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
      explicitFlags.add('model');
    } else if (arg === '--model-planning' && args[i + 1]) {
      options.modelPlanning = args[++i];
      explicitFlags.add('modelPlanning');
    } else if (arg === '--model-execution' && args[i + 1]) {
      options.modelExecution = args[++i];
      explicitFlags.add('modelExecution');
    } else if (arg === '--output-format' && args[i + 1]) {
      options.outputFormat = args[++i];
      explicitFlags.add('outputFormat');
    } else if (arg === '--base-url' && args[i + 1]) {
      options.baseUrl = args[++i];
      explicitFlags.add('baseUrl');
    } else if (arg === '--master-key' && args[i + 1]) {
      options.masterKey = args[++i];
      explicitFlags.add('masterKey');
    } else if (arg === '--delay' && args[i + 1]) {
      options.delay = parseInt(args[++i], 10);
      explicitFlags.add('delay');
    } else if (arg === '--case' && args[i + 1]) {
      options.case = args[++i];
      explicitFlags.add('case');
    } else if (arg === '--config' && args[i + 1]) {
      options.config = args[++i];
      explicitFlags.add('config');
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
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
 * Merges defaults, test plan config, and CLI overrides for a specific test case.
 * @param {string} caseName - Name of test case directory
 * @param {object} globalOptions - Options object returned by parseArgs
 * @param {object|null} testPlan - Parsed test-plan.json object
 * @returns {object} Options for this test case execution
 */
export function resolveCaseOptions(caseName, globalOptions, testPlan) {
  const explicitFlags = globalOptions._explicitFlags || new Set();
  const resolved = {
    ...defaults,
    agent: globalOptions.agent,
    interactive: globalOptions.interactive,
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
  if (testPlan) {
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

  resolved.case = caseName;
  return resolved;
}

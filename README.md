# 🪙 Coding Agent Test Harness for Tokenomics measurements

This repository contains a **Node.js Test Harness** designed to evaluate software development tasks executed by Claude Code CLI agents against a locally running **LiteLLM proxy**. For user to understand the cost impact when choosing different model to plan and execute tasks.

The harness automates isolated user/key provisioning, executes tasks in either simple or multi-phase plan-execute modes, and collects precision token metrics and cost attributes directly from LiteLLM's local PostgreSQL database.

---

## 🔑 LiteLLM Proxy Credentials & Models

*   **LiteLLM Base URL**: `http://localhost:4000` (or `http://0.0.0.0:4000`)
*   **LiteLLM Master Admin Key**: `sk-XXXXX` (pick your own key when setting up LiteLLM)
*   **Available LLM Models**:
    *   `claude-sonnet` (routes to Google Cloud Agent Platform Claude Sonnet model)
    *   `claude-opus` (routes to Google Cloud Agent Platform Claude Opus model)    
    *   `gemini-flash` (routes to Google Cloud Agent Platform Gemini Flash model)
    *   `gemini-pro` (routes to Google Cloud Agent Platform Gemini Pro model)    

Google Cloud Agent Platform formerly known as Vertex AI. Specific model version is mapped within LiteLLM's `config.yaml` file.

---

## 🛠️ System Requirements & Setup

Before running the test harness, ensure you have the following prerequisites installed and active on your system:

1.  **Node.js**: v18.0.0 or higher (fully compatible with v24.16.0)
2.  **LiteLLM Proxy**: Active and running locally on port `4000`
3.  **Claude Code CLI**: Globally installed as the `claude` executable

---

## 🚀 Execution Workflows

The harness supports two distinct execution patterns depending on task complexity:

### 1. Simple Use Case Workflow
Runs the entire task under a single model and tracks costs for that model:
1.  **Run Isolation**: Creates a brand-new sub-folder inside the test case directory named `output-<timestamp>/`.
2.  **Codebase Provisioning**: Copies the test case files into `output-<timestamp>/` dynamically (skipping nested outputs, git files, and `node_modules`).
3.  **User Provisioning**: Registers a brand-new internal, view-only LiteLLM user (e.g., `test_<caseName>_<timestamp>@example.com`) without sending an invitation.
4.  **Key Isolation**: Generates a new LiteLLM Virtual Key owned by the new user. The Key Name matches the test directory (with an automatic unique suffix fallback on name collisions).
5.  **Agent Session**: Spawns the Claude Code CLI inside the isolated `output-<timestamp>/` directory:
    ```bash
    ANTHROPIC_BASE_URL="http://localhost:4000" ANTHROPIC_AUTH_TOKEN="sk-XXXXX" claude --model <MODEL> --permission-mode auto [prompt]
    ```
6.  **Telemetry Collection**: Queries LiteLLM endpoints to obtain real-time cost, request, and token metrics.
7.  **Results Placement**: Saves the run results directly inside the parent test case directory as `test-results-<timestamp>.json`.

### 2. Plan-Execute Use Case Workflow
Divides the task into distinct planning and execution phases using different models to optimize cost-performance:
1.  **Run Isolation**: Creates an isolated `output-<timestamp>/` folder and clones target files as described above.
2.  **User Provisioning & Key Isolation**: Creates a view-only user and unique Virtual Key.
3.  **Planning Phase**: Starts the agent in non-interactive `plan` mode inside `output-<timestamp>/` using `--model-planning`:
    ```bash
    ANTHROPIC_BASE_URL="http://localhost:4000" ANTHROPIC_AUTH_TOKEN="sk-XXXXX" claude --model <MODEL_PLANNING> --permission-mode plan [prompt]
    ```
4.  **Execution Phase**: Resumes execution inside `output-<timestamp>/` to execute the written plan using `--model-execution`:
    ```bash
    ANTHROPIC_BASE_URL="http://localhost:4000" ANTHROPIC_AUTH_TOKEN="sk-XXXXX" claude --model <MODEL_EXECUTION> --permission-mode auto [prompt]
    ```
5.  **Telemetry Collection**: Waits for transaction logs to flush, gathers aggregate API metrics across both phases, and saves them to `test-results-<timestamp>.json` under the parent test case folder.

---

## 💻 CLI Usage Guide

The harness is fully configurable using command-line arguments or a test plan JSON file, and can be invoked directly as a standalone CLI executable (`tokenomics` or `./bin/tokenomics`):

```bash
# Build/bundle src/ into the standalone executable bin/tokenomics
npm run build

# Directly run standalone CLI executable
./bin/tokenomics [options]
```

### Execution Modes & Rules
- **Full Benchmark Suite Run (Default)**: Running without `--case` executes all use cases discovered inside the `use-cases/` directory. When running in this mode, supplying a valid test plan configuration file is **mandatory** (defaults to `test-plan.json` in the root folder, or specified via `--config`).
- **Single Case Execution**: Running with `--case <name>` targets a single use case subdirectory inside `use-cases/`.

| Option | Description | Default |
| :--- | :--- | :--- |
| `--agent <name>` | Coding agent engine to run (e.g. `claude`, `agy`, `codex`) | `claude` |
| `--case <name>` | Run a specific test case subdirectory inside `use-cases/` | *All discovered use cases* |
| `--config <path>` | Path to test plan JSON config file (mandatory when running without `--case`) | `test-plan.json` |
| `--mode <type>` | Run mode override: `simple` or `plan-execute` | `simple` |
| `--interactive` | Run coding agent in interactive mode instead of headless mode | `false` |
| `--model <name>` | Model override for simple mode | `claude-sonnet` |
| `--model-planning <name>`| Model override for planning phase in `plan-execute` mode | `claude-sonnet` |
| `--model-execution <name>`| Model override for execution phase in `plan-execute` mode | `gemini-flash` |
| `--delay <ms>` | Delay (ms) before fetching stats (allows DB logs to flush) | `3000` |
| `--base-url <url>`| Custom base URL of LiteLLM proxy | `http://localhost:4000` |
| `--master-key <key>`| LiteLLM Admin Master Key | `sk-XXXXX` |
| `--help, -h` | Show CLI help message | |

### Headless vs Interactive Execution
- **Headless Mode (Default)**: Executes coding agents headlessly without user intervention (e.g., passing `-p` to Claude Code CLI). All process output is piped directly to log files (`AGENT-OUTPUT.out` / `AGENT-OUTPUT.err`).
- **Interactive Mode (`--interactive`)**: Launches coding agents with terminal `stdio: 'inherit'`, allowing direct user interaction with the agent prompt session while still ensuring LiteLLM user provisioning prior to start and usage metrics capture upon exit.

### Test Plan File Format (`test-plan.json`)

When running across all use cases, the harness reads `test-plan.json` to assign per-case execution modes and models:

```json
{
  "defaults": {
    "baseUrl": "http://localhost:4000",
    "delay": 3000
  },
  "runs": [
    {
      "case": "code-review",
      "mode": "simple",
      "model": "claude-sonnet"
    },
    {
      "case": "legacy-modernization",
      "mode": "plan-execute",
      "modelPlanning": "claude-sonnet",
      "modelExecution": "gemini-flash"
    }
  ]
}
```

### Running Examples

```bash
# 1. Run all use cases using the default root test-plan.json
./bin/tokenomics

# 2. Run all use cases using a custom test plan configuration file
./bin/tokenomics --config custom-plan.json

# 3. Run a single case in Simple mode with Gemini Flash
./bin/tokenomics --case zero-to-one-vibe-coding --mode simple --model gemini-flash

# 4. Run a single case in Plan-Execute mode with custom planning & execution models
./bin/tokenomics --case one-to-two-feature-request --mode plan-execute --model-planning claude-opus --model-execution gemini-flash

# 5. Run a test case in interactive mode
./bin/tokenomics --case legacy-modernization --interactive
```

---

## 📁 Repository & Test Case Directory Structure

The repository contains the standalone binary, modular source files, package configuration, test plan configuration, and benchmark test case directories:

```
tokenomics/
├── bin/
│   └── tokenomics                  <-- Bundled standalone CLI executable (built via esbuild)
├── package.json                     <-- Node.js package manifest and scripts
├── README.md                        <-- Test Harness documentation and setup guide
├── test-plan.json                   <-- Test plan configuration defining modes and models per case
├── src/                             <-- Modular source directory
│   ├── main.js                      <-- Application entry point & case orchestrator
│   ├── config.js                    <-- CLI argument parsing & default settings
│   ├── agents/                      <-- Extensible agent engine adapters & registry directory
│   │   ├── agent.js                 <-- Agent registry & child process spawner
│   │   └── claude.js                <-- Claude Code agent CLI adapter
│   ├── litellm-client.js            <-- LiteLLM proxy REST client & telemetry API
│   ├── runner.js                    <-- Benchmark test case runner & results writer
│   └── utils/                       <-- Helper utilities
│       ├── fs.js                    <-- File system & recursive directory copy
│       └── time.js                  <-- Timestamp formatting & async sleep
├── test/                            <-- Automated unit test suite for the Benchmark test case runner 
└── use-cases/                       <-- Benchmark test cases sub-directory
    ├── zero-to-one-vibe-coding/     <-- Use Case: Greenfield app generation from high level prompt instruction
    │   ├── PROMPT.md                <-- Task prompt / instructions
    │   ├── README.md                <-- Scenario description
    │   ├── test-results-20260722-172349.json   <-- Precision metrics & tokenomics telemetry
    │   └── output-20260722-172349/             <-- Clean agent workspace and generated artifacts
    │       ├── README.md
    │       ├── solution.js
    │       └── test.js
    ├── zero-to-one-spec-driven/     <-- Use Case: Greenfield development guided by detailed PRDs and specs
    ├── one-to-two-feature-request/  <-- Use Case: Feature additions to existing codebases
    ├── one-to-two-bug-fix/          <-- Use Case: Bug identification and resolution tasks
    ├── legacy-modernization/        <-- Use Case: Codebase refactoring and modernization
    └── code-review/                 <-- Use Case: Automated code inspection and review
```

* **`bin/tokenomics`**: Bundled executable generated via `npm run build` using `esbuild`.
* **`src/`**: Source code of this Coding Agent Test Harness 
* **`test/`**: Unit test suite executable for this Coding Agent Test Harness via `npm run test:unit`.
* **`package.json`**: Defines Node module type (`ESM`), build script (`esbuild`), and devDependencies.
* **Benchmark Test Case Directories**: Subdirectories corresponding to different software engineering tasks.

Each test case directory contains prompt instructions and workspace templates. When the harness runs, all test execution artifacts and metrics are isolated inside the target test case folder:

- **Prompt File (`PROMPT.md`)**: Task prompt provided to the agent CLI.
- **Isolated Execution Workspace (`output-<timestamp>/`)**: Created dynamically per run to prevent mutating source templates and ensure reproducibility.
- **Output JSON Results (`test-results-<timestamp>.json`)**: Stores cost, token count, API request volume, execution phase breakdown, and model settings.

The results file contains individual run configurations, phase breakdown metadata, and direct transaction aggregates (`spendUSD`, `promptTokens`, `completionTokens`, `totalTokens`, `totalRequests`, etc.).


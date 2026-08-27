# code-review

This use case provides an automated test setup and prompt instructions for performing multi-language code quality auditing using parallel multi-agent orchestration on the Google Cloud Online Boutique ([`microservices-demo`](https://github.com/GoogleCloudPlatform/microservices-demo)) microservices application.

## Overview & Workflow

The code review task evaluates an agent's ability to plan and execute a multi-service, multi-language static code audit across microservices written in Go, Java, C#, Node.js, and Python.

The prompt definitions for planning and execution are stored in:
- [`PROMPT-PLAN.md`](./PROMPT-PLAN.md): Instructions for service discovery, language identification, and audit plan design.
- [`PROMPT-EXEC.md`](./PROMPT-EXEC.md): Instructions to spawn parallel language-specific subagents to perform the audit and consolidate findings into a structured report.

### 1. Planning Phase (`PROMPT-PLAN.md`)
1. **Service Discovery & Language Mapping**: Identify all microservices located under `src/` and output a clean markdown summary table showing:
   - Service Name
   - Directory Path
   - Primary Programming Language
2. **Audit Plan Design**: Design a structured audit strategy detailing checks for:
   - Code quality and maintainability standards
   - Exception handling and error management patterns
   - Database query formatting and data access practices
3. **Artifact Generation**: Save the strategy as an **Audit Plan** artifact and pause execution for review.

### 2. Execution Phase (`PROMPT-EXEC.md`)
1. **Parallel Multi-Agent Orchestration**: Spawn specialized language subagents to scan microservices concurrently based on language domains.
2. **Consolidated Audit Report**: Gather and aggregate subagent findings into a comprehensive `AUDIT-REPORT.md` artifact, structured as follows:
   - Grouped by programming language and sorted by issue priority (High / Medium / Low).
   - Detailed file paths, line ranges, source code snippets, and rationale for each finding.

## Setup Overview

Running [`test-setup.sh`](./test-setup.sh) initializes the benchmark environment:

1. **Repository Retrieval**: Clones a clean, shallow copy (`--depth 1`) of [`microservices-demo`](https://github.com/GoogleCloudPlatform/microservices-demo) into `microservices-demo/`.
2. **Git Tracking Cleanup**: Removes Git metadata (`.git`) to prepare an unversioned workspace ready for test execution.

## Useful Commands

- **Run Setup Script**:
  ```bash
  ./test-setup.sh
  ```
- **Execute Test Case (Plan-Execute Mode)**:
  ```bash
  ./bin/tokbench --case code-review --mode plan-execute --model-planning claude-sonnet --model-execution gemini-flash
  ```
- **Run in Interactive Mode**:
  ```bash
  ./bin/tokbench --case code-review --interactive
  ```

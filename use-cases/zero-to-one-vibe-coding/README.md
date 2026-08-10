# zero-to-one-vibe-coding

This use case evaluates an AI coding agent's ability to build a complete web application from scratch ("zero-to-one") based on high-level user requirements without a formal plan or detailed step-by-step specification ("vibe coding").

## Overview & Requirements

The goal is to generate an informational website

The prompt definitions and functional requirements stored in [`PROMPT.md`](./PROMPT.md)

## Files

- [`PROMPT.md`](./PROMPT.md): The core requirement prompt supplied to the AI agent.

## Useful Commands

- **Execute Test Case (Simple Mode)**:
  ```bash
  ./bin/tokenomics --case zero-to-one-vibe-coding --mode simple --model claude-sonnet
  ```
- **Run in Interactive Mode**:
  ```bash
  ./bin/tokenomics --case zero-to-one-vibe-coding --interactive
  ```
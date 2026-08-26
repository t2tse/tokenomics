import fs from 'fs';
import path from 'path';
import { litellmRequest } from './litellm-client.js';
import { WALKTHROUGH_PROMPT } from './runner.js';

/**
 * Gathers all relevant files and context needed for evaluating a test run's walkthrough.
 * @param {object} params
 * @param {string} params.caseDir - Base test case directory
 * @param {string} params.outputDir - Specific test run output directory (e.g. output-timestamp)
 * @returns {object} Context object containing prompt, walkthrough, files list, and logs
 */
export function assembleEvaluationContext({ caseDir, outputDir }) {
  // 1. Gather Prompts
  const promptFile = path.join(caseDir, 'PROMPT.md');
  const planPromptFile = path.join(caseDir, 'PROMPT-PLAN.md');
  const execPromptFile = path.join(caseDir, 'PROMPT-EXEC.md');

  const mainPrompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8').trim() : '';
  const planPrompt = fs.existsSync(planPromptFile) ? fs.readFileSync(planPromptFile, 'utf8').trim() : '';
  const execPrompt = fs.existsSync(execPromptFile) ? fs.readFileSync(execPromptFile, 'utf8').trim() : '';

  let promptContent = '';
  if (planPrompt || execPrompt) {
    promptContent = `### Planning Prompt (PROMPT-PLAN.md)\n${planPrompt || '(none)'}\n\n### Execution Prompt (PROMPT-EXEC.md)\n${execPrompt || '(none)'}`;
  } else {
    promptContent = `### Task Prompt (PROMPT.md)\n${mainPrompt || '(none)'}`;
  }

  // 2. Gather Walkthrough
  let walkthroughContent = '';
  const walkthroughPath = path.join(outputDir, 'AGENT-WALKTHROUGH.md');
  if (fs.existsSync(walkthroughPath)) {
    walkthroughContent = fs.readFileSync(walkthroughPath, 'utf8').trim();
  }

  // 3. Gather Agent Logs (truncated to avoid token explosion)
  let stdoutSnippet = '';
  let stderrSnippet = '';
  const stdoutPath = path.join(outputDir, 'AGENT-OUTPUT.out');
  const stderrPath = path.join(outputDir, 'AGENT-OUTPUT.err');

  if (fs.existsSync(stdoutPath)) {
    const rawOut = fs.readFileSync(stdoutPath, 'utf8').trim();
    stdoutSnippet = rawOut.length > 4000 ? rawOut.slice(-4000) : rawOut;
  }
  if (fs.existsSync(stderrPath)) {
    const rawErr = fs.readFileSync(stderrPath, 'utf8').trim();
    stderrSnippet = rawErr.length > 2000 ? rawErr.slice(-2000) : rawErr;
  }

  // 4. Gather list of files inside output directory (excluding node_modules, .git, etc.)
  const filesList = [];
  const scanFiles = (dir, relBase = '') => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name.startsWith('output-')) continue;
      const relPath = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        scanFiles(path.join(dir, ent.name), relPath);
      } else {
        filesList.push(relPath);
      }
    }
  };
  scanFiles(outputDir);

  return {
    promptContent,
    walkthroughContent,
    walkthroughExists: Boolean(walkthroughContent),
    walkthroughRules: WALKTHROUGH_PROMPT,
    filesList,
    stdoutSnippet,
    stderrSnippet,
  };
}

/**
 * Evaluates the quality and prompt compliance of a successful test run's AGENT-WALKTHROUGH.md.
 * @param {object} params
 * @param {string} params.caseDir - Base test case directory
 * @param {string} params.outputDir - Specific test run output directory
 * @param {object} params.options - Execution options (baseUrl, masterKey, evalModel, etc.)
 * @returns {Promise<{ evaluation: object, evalMetrics: object }>} Evaluation report and telemetry
 */
export async function evaluateWalkthrough({ caseDir, outputDir, options = {} }) {
  const context = assembleEvaluationContext({ caseDir, outputDir });

  if (!context.walkthroughExists) {
    return {
      evaluation: {
        score: 0,
        status: 'FAIL',
        pillars: {
          promptCompliance: { score: 0, max: 40 },
          grounding: { score: 0, max: 25 },
          reproducibility: { score: 0, max: 20 },
          hygiene: { score: 0, max: 15 },
        },
        checklist: [],
        critique: {
          strengths: [],
          weaknesses: ['AGENT-WALKTHROUGH.md was not generated or is empty.'],
          actionableFeedback: 'Ensure the agent creates AGENT-WALKTHROUGH.md before completing the task.',
        },
      },
      evalMetrics: {
        model: options.evalModel || 'gemini-pro',
        wallClockDurationSeconds: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }

  const evalModel = options.evalModel || 'gemini-pro';
  const startTime = Date.now();

  const systemInstruction = `You are an expert software engineering judge and quality auditor.
Your job is to evaluate whether an AI coding agent fulfilled the exact requirements in the provided task prompt, and to critique the quality, truthfulness, and actionability of the agent's AGENT-WALKTHROUGH.md documentation.

You will evaluate the walkthrough across 4 scoring pillars (Total Score: 0 to 100):
1. Prompt Compliance & Requirement Coverage (0-40 points):
   - Extract every distinct requirement or constraint from the prompt.
   - For each requirement, determine if the agent actually completed it (MET, PARTIALLY MET, or NOT MET) with concrete evidence from the walkthrough and output files.
2. Technical Grounding & Truthfulness (0-25 points):
   - Are the files, code changes, and test claims in the walkthrough accurate and grounded in reality (matching the files present in the output folder and logs)?
   - Deduct points for hallucinated files or unsupported claims.
3. Reproducibility & Actionability (0-20 points):
   - Does the walkthrough provide clear, self-contained commands to review, launch, or test the solution locally?
   - Ensure it avoids illegal global installations (e.g. \`npm install -g\`).
4. Structure, Hygiene & Cleanup (0-15 points):
   - Does the walkthrough include summary of changes, launch/test instructions, instructions for further changes, and clean up steps?
   - If no app was built (e.g. pure text/analysis task), does it appropriately omit irrelevant setup instructions?

Return ONLY a valid JSON object matching this exact schema:
{
  "score": <number between 0 and 100>,
  "status": "<PASS | PARTIAL | FAIL>",
  "pillars": {
    "promptCompliance": { "score": <number 0-40>, "max": 40 },
    "grounding": { "score": <number 0-25>, "max": 25 },
    "reproducibility": { "score": <number 0-20>, "max": 20 },
    "hygiene": { "score": <number 0-15>, "max": 15 }
  },
  "checklist": [
    {
      "requirement": "<short description of requirement from prompt>",
      "status": "<MET | PARTIALLY_MET | NOT_MET>",
      "evidence": "<brief explanation or citation from walkthrough/files>"
    }
  ],
  "critique": {
    "strengths": ["<key strength 1>", "..."],
    "weaknesses": ["<key weakness or missing item 1>", "..."],
    "actionableFeedback": "<concise feedback on how the agent or walkthrough could improve>"
  }
}
Do not include any markdown formatting or commentary outside the JSON object.`;

  const userMessage = `Here is the test run data to evaluate:

========================================
TASK PROMPTS
========================================
${context.promptContent}

========================================
WALKTHROUGH RULES SPECIFICATION
========================================
${context.walkthroughRules}

========================================
FILES PRESENT IN OUTPUT DIRECTORY
========================================
${context.filesList.length > 0 ? context.filesList.map((f) => `- ${f}`).join('\n') : '(no files found)'}

========================================
AGENT EXECUTION LOG (TAIL SNIPPET)
========================================
STDOUT:
${context.stdoutSnippet || '(empty)'}

STDERR:
${context.stderrSnippet || '(empty)'}

========================================
AGENT-WALKTHROUGH.MD CONTENT
========================================
${context.walkthroughContent}
`;

  console.log(`⚖️ [EVAL] Evaluating walkthrough quality using judge model: ${evalModel}...`);

  let evalResponse = null;
  let parsedEvaluation = null;

  try {
    evalResponse = await litellmRequest('/chat/completions', {
      baseUrl: options.baseUrl,
      masterKey: options.masterKey,
      method: 'POST',
      body: JSON.stringify({
        model: evalModel,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
      }),
    });

    const rawChoice = evalResponse?.choices?.[0]?.message?.content || '';
    // Strip possible markdown fences
    let cleanJson = rawChoice.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    parsedEvaluation = JSON.parse(cleanJson);
  } catch (err) {
    console.error(`⚠️ [EVAL] Evaluation call or parsing failed: ${err.message}`);
    parsedEvaluation = {
      score: 0,
      status: 'FAIL',
      pillars: {
        promptCompliance: { score: 0, max: 40 },
        grounding: { score: 0, max: 25 },
        reproducibility: { score: 0, max: 20 },
        hygiene: { score: 0, max: 15 },
      },
      checklist: [],
      critique: {
        strengths: [],
        weaknesses: [`Evaluation failed: ${err.message}`],
        actionableFeedback: 'Check LiteLLM model routing or credentials.',
      },
    };
  }

  const durationSec = (Date.now() - startTime) / 1000;
  const usage = evalResponse?.usage || {};

  const evalMetrics = {
    model: evalModel,
    wallClockDurationSeconds: durationSec,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  };

  console.log(`⚖️ [EVAL] Score: ${parsedEvaluation.score}/100 [${parsedEvaluation.status}] (Judge: ${evalModel}, Duration: ${durationSec.toFixed(2)}s)`);

  return {
    evaluation: parsedEvaluation,
    evalMetrics,
  };
}


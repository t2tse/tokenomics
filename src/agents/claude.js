/**
 * Adapter function for Claude Code CLI agent.
 * @param {object} params - Execution parameters
 * @param {string} params.secretKey - LiteLLM auth token key
 * @param {string} params.model - Model name
 * @param {string} params.mode - Permission/run mode
 * @param {string} [params.promptText] - Prompt text for task
 * @param {string} params.baseUrl - LiteLLM proxy base URL
 * @returns {{ command: string, args: string[], env: object, displayCmd: string }} Process execution config
 */
export function claudeAgentAdapter({ secretKey, model, mode, promptText, baseUrl, outputFormat = 'text', interactive = false }) {
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: secretKey,
  };

  const args = [];
  if (!interactive) {
    args.push('-p');
  }

  args.push(
    '--output-format', outputFormat || 'text',
    '--verbose',
    '--model', model,
  );

  if (!interactive && mode) {
    args.push('--permission-mode', mode);
  }

  if (promptText) {
    args.push(promptText);
  }

  const maskKey = secretKey && secretKey.length > 12 ? `${secretKey.substring(0, 12)}...` : secretKey;
  const displayCmd = `ANTHROPIC_BASE_URL="${baseUrl}" ANTHROPIC_AUTH_TOKEN="${maskKey}" claude ${args.join(' ')}`;

  return {
    command: 'claude',
    args,
    env,
    displayCmd,
    interactive,
  };
}

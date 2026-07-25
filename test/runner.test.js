import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

describe('runner & case discovery', () => {
  it('should locate test cases inside use-cases directory', async () => {
    const { runTestCase } = await import('../src/runner.js');
    const options = { mode: 'simple', model: 'claude-sonnet', baseUrl: 'http://localhost:4000', masterKey: 'sk-test' };

    // Expect runTestCase to throw specific error mentioning the caseDir path inside use-cases when case doesn't exist
    await assert.rejects(
      async () => {
        await runTestCase('non-existent-case', options, projectRoot);
      },
      (err) => {
        return err.message.includes(path.join('use-cases', 'non-existent-case'));
      }
    );
  });
});

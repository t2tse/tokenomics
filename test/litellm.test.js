import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { litellmRequest } from '../src/litellm-client.js';

describe('litellm module', () => {
  it('litellmRequest formats URL and headers properly', async () => {
    // Intercept global fetch
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders = {};

    globalThis.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        json: async () => ({ status: 'ok' })
      };
    };

    try {
      const res = await litellmRequest('/health', {
        baseUrl: 'http://localhost:4000/',
        masterKey: 'sk-test-key'
      });

      assert.equal(capturedUrl, 'http://localhost:4000/health');
      assert.equal(capturedHeaders['Authorization'], 'Bearer sk-test-key');
      assert.equal(capturedHeaders['Content-Type'], 'application/json');
      assert.deepEqual(res, { status: 'ok' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('litellmRequest throws on non-ok HTTP status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    });

    try {
      await assert.rejects(
        async () => {
          await litellmRequest('/user/info', {
            baseUrl: 'http://localhost:4000',
            masterKey: 'sk-invalid'
          });
        },
        /LiteLLM request failed \[401\]: Unauthorized/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

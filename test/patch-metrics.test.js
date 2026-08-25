import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { extractDateFromTimestamp, extractAllLiteLLMMetrics, buildUserLookupMaps, patchHistoricalResults } from '../src/patch-metrics.js';

describe('patch-metrics module', () => {
  it('buildUserLookupMaps should map emails and key aliases to exact user IDs', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/user/list')) {
        return {
          ok: true,
          json: async () => [
            {
              user_id: 'usr_1',
              user_email: 'test_case1_20260810-100000@example.com',
              keys: [{ key_alias: 'case1_20260810-100000' }]
            },
            {
              user_id: 'usr_2',
              user_email: 'test_case2_20260810-110000@example.com',
              keys: [{ key_alias: 'case2_20260810-110000' }]
            }
          ]
        };
      }
      if (url.includes('/key/list')) {
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => ({}) };
    };

    try {
      const { emailToUserId, aliasToUserId } = await buildUserLookupMaps({
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test'
      });

      assert.equal(emailToUserId.get('test_case1_20260810-100000@example.com'), 'usr_1');
      assert.equal(aliasToUserId.get('case1_20260810-100000'), 'usr_1');
      assert.equal(emailToUserId.get('test_case2_20260810-110000@example.com'), 'usr_2');
      assert.equal(aliasToUserId.get('case2_20260810-110000'), 'usr_2');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('extractDateFromTimestamp should correctly parse YYYY-MM-DD from timestamps', () => {
    assert.equal(extractDateFromTimestamp('20260817-045531'), '2026-08-17');
    assert.equal(extractDateFromTimestamp('20260807-131147'), '2026-08-07');
    assert.equal(extractDateFromTimestamp('20261231-235959'), '2026-12-31');
  });

  it('extractAllLiteLLMMetrics should parse from metadata, results array, and user keys', () => {
    // 1. From metadata
    const metaUsage = {
      metadata: {
        total_spend: 0.15,
        total_prompt_tokens: 10000,
        total_completion_tokens: 500,
        total_tokens: 10500,
        total_cache_read_input_tokens: 1200,
        total_cache_creation_input_tokens: 300,
        total_api_requests: 5,
        total_successful_requests: 5,
        total_failed_requests: 0,
      }
    };
    const extractedMeta = extractAllLiteLLMMetrics(metaUsage, {});
    assert.equal(extractedMeta.spendUSD, 0.15);
    assert.equal(extractedMeta.totalTokens, 10500);
    assert.equal(extractedMeta.cacheReadTokens, 1200);
    assert.equal(extractedMeta.cacheWriteTokens, 300);

    // 2. From results array fallback
    const resultsUsage = {
      results: [
        {
          metrics: {
            spend: 0.05,
            prompt_tokens: 3000,
            completion_tokens: 200,
            total_tokens: 3200,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 100,
            api_requests: 2,
            successful_requests: 2,
            failed_requests: 0,
          }
        },
        {
          metrics: {
            spend: 0.08,
            prompt_tokens: 4000,
            completion_tokens: 300,
            total_tokens: 4300,
            cache_read_input_tokens: 700,
            cache_creation_input_tokens: 200,
            api_requests: 3,
            successful_requests: 3,
            failed_requests: 0,
          }
        },
      ]
    };
    const extractedResults = extractAllLiteLLMMetrics(resultsUsage, {});
    assert.equal(extractedResults.totalTokens, 7500);
    assert.equal(extractedResults.promptTokens, 7000);
    assert.equal(extractedResults.completionTokens, 500);
    assert.equal(extractedResults.cacheReadTokens, 1200);
    assert.equal(extractedResults.cacheWriteTokens, 300);

    // 3. From user keys
    const userInfoKeys = {
      keys: [
        {
          spend: 0.20,
          total_tokens: 5000,
          prompt_tokens: 4800,
          completion_tokens: 200,
          cache_read_input_tokens: 1500,
          cache_creation_input_tokens: 400,
        }
      ]
    };
    const extractedKeys = extractAllLiteLLMMetrics({}, userInfoKeys);
    assert.equal(extractedKeys.spendUSD, 0.20);
    assert.equal(extractedKeys.totalTokens, 5000);
    assert.equal(extractedKeys.cacheReadTokens, 1500);
    assert.equal(extractedKeys.cacheWriteTokens, 400);
  });

  it('patchHistoricalResults should refresh all metrics in test-results JSON files from LiteLLM', async () => {
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-patch-test-'));
    const caseDir = path.join(tmpParent, 'one-to-two-feature-request');
    fs.mkdirSync(caseDir, { recursive: true });

    const initialResult = {
      caseName: 'one-to-two-feature-request',
      mode: 'plan-execute',
      interactive: false,
      success: true,
      totalWallClockDurationSeconds: 207.286,
      metrics: {
        spendUSD: 0.1,
        promptTokens: 1000,
        completionTokens: 100,
        totalTokens: 1100,
        totalRequests: 10,
        successfulRequests: 10,
        failedRequests: 0,
      },
      runs: [
        { phase: 'planning', model: 'gemini-3.7-flash', wallClockDurationSeconds: 50, success: true, exitCode: 0 },
        { phase: 'execution', model: 'gemini-3.7-flash', wallClockDurationSeconds: 157, success: true, exitCode: 0 },
      ]
    };

    const jsonPath = path.join(caseDir, 'test-results-20260817-045531.json');
    fs.writeFileSync(jsonPath, JSON.stringify(initialResult, null, 2), 'utf8');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/user/list')) {
        return {
          ok: true,
          json: async () => [
            {
              user_id: 'usr_test_123',
              user_email: 'test_one-to-two-feature-request_20260817-045531@example.com',
              keys: [{ key_alias: 'one-to-two-feature-request_20260817-045531' }]
            }
          ]
        };
      }
      if (url.includes('/key/list')) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes('/user/info')) {
        return {
          ok: true,
          json: async () => ({
            user_id: 'usr_test_123',
            user_info: { spend: 0.523004 }
          })
        };
      }
      if (url.includes('/user/daily/activity')) {
        return {
          ok: true,
          json: async () => ({
            metadata: {
              total_spend: 0.523004,
              total_prompt_tokens: 1799120,
              total_completion_tokens: 10897,
              total_tokens: 1810017,
              total_cache_read_input_tokens: 450000,
              total_cache_creation_input_tokens: 120000,
              total_api_requests: 60,
              total_successful_requests: 58,
              total_failed_requests: 2,
            }
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    try {
      // 1. Dry run test
      const dryRunRes = await patchHistoricalResults({
        baseDir: tmpParent,
        dryRun: true,
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
      });

      assert.equal(dryRunRes.total, 1);
      assert.equal(dryRunRes.patched, 1);

      // Verify file was NOT modified in dry-run
      const afterDryRun = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      assert.equal(afterDryRun.metrics.cacheReadTokens, undefined);
      assert.equal(afterDryRun.metrics.spendUSD, 0.1);

      // 2. Real patch run
      const realRunRes = await patchHistoricalResults({
        baseDir: tmpParent,
        dryRun: false,
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
      });

      assert.equal(realRunRes.total, 1);
      assert.equal(realRunRes.patched, 1);

      // Verify file WAS updated with all latest fields from LiteLLM
      const afterPatch = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      assert.equal(afterPatch.caseName, 'one-to-two-feature-request');
      assert.equal(afterPatch.mode, 'plan-execute');
      assert.equal(afterPatch.totalWallClockDurationSeconds, 207.286);
      assert.equal(afterPatch.runs.length, 2);

      assert.equal(afterPatch.metrics.spendUSD, 0.523004);
      assert.equal(afterPatch.metrics.promptTokens, 1799120);
      assert.equal(afterPatch.metrics.completionTokens, 10897);
      assert.equal(afterPatch.metrics.totalTokens, 1810017);
      assert.equal(afterPatch.metrics.cacheReadTokens, 450000);
      assert.equal(afterPatch.metrics.cacheWriteTokens, 120000);
      assert.equal(afterPatch.metrics.totalRequests, 60);
      assert.equal(afterPatch.metrics.successfulRequests, 58);
      assert.equal(afterPatch.metrics.failedRequests, 2);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });

  it('patchHistoricalResults should protect existing metrics if LiteLLM returns empty data', async () => {
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenomics-patch-empty-test-'));
    const caseDir = path.join(tmpParent, 'code-review');
    fs.mkdirSync(caseDir, { recursive: true });

    const initialResult = {
      caseName: 'code-review',
      mode: 'simple',
      interactive: false,
      success: true,
      totalWallClockDurationSeconds: 15.2,
      metrics: {
        spendUSD: 0.08,
        promptTokens: 5000,
        completionTokens: 250,
        totalTokens: 5250,
        totalRequests: 3,
        successfulRequests: 3,
        failedRequests: 0,
      },
      runs: []
    };

    const jsonPath = path.join(caseDir, 'test-results-20260807-131147.json');
    fs.writeFileSync(jsonPath, JSON.stringify(initialResult, null, 2), 'utf8');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.includes('/user/list')) {
        return {
          ok: true,
          json: async () => [
            {
              user_id: 'usr_empty',
              user_email: 'test_code-review_20260807-131147@example.com',
            }
          ]
        };
      }
      if (url.includes('/key/list')) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes('/user/info')) {
        return {
          ok: true,
          json: async () => ({
            user_id: 'usr_empty',
            user_info: { spend: 0 }
          })
        };
      }
      if (url.includes('/user/daily/activity')) {
        return {
          ok: true,
          json: async () => ({
            metadata: {
              total_spend: 0,
              total_prompt_tokens: 0,
              total_completion_tokens: 0,
              total_tokens: 0,
            },
            results: []
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    try {
      await patchHistoricalResults({
        baseDir: tmpParent,
        dryRun: false,
        baseUrl: 'http://localhost:4000',
        masterKey: 'sk-test',
      });

      const after = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      // Existing positive tokens and spend must NOT be overwritten with 0
      assert.equal(after.metrics.spendUSD, 0.08);
      assert.equal(after.metrics.promptTokens, 5000);
      assert.equal(after.metrics.completionTokens, 250);
      assert.equal(after.metrics.totalTokens, 5250);
      assert.equal(after.metrics.cacheReadTokens, 0);
      assert.equal(after.metrics.cacheWriteTokens, 0);
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmpParent, { recursive: true, force: true });
    }
  });
});

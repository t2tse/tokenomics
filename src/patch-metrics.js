import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { litellmRequest } from './litellm-client.js';
import { generateManifest } from './generate-manifest.js';
import { defaults } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const useCasesDir = path.join(rootDir, 'use-cases');

/**
 * Extracts date in YYYY-MM-DD format from runTimestamp (e.g. 20260817-045531).
 * @param {string} timestamp 
 * @returns {string|null}
 */
export function extractDateFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const cleaned = timestamp.replace(/[^0-9]/g, '');
  if (cleaned.length >= 8) {
    const yyyy = cleaned.substring(0, 4);
    const mm = cleaned.substring(4, 6);
    const dd = cleaned.substring(6, 8);
    return `${yyyy}-${mm}-${dd}`;
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * Returns date + 2 days in YYYY-MM-DD format to provide buffer for timezone safety.
 * @param {string} dateStr 
 * @returns {string|null}
 */
export function getBufferEndDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 2);
  return d.toISOString().split('T')[0];
}

/**
 * Fetches all items across paginated LiteLLM endpoints to avoid cutoff.
 * @param {string} endpoint 
 * @param {object} options 
 * @param {number} [pageSize=100]
 * @param {number} [maxPages=50]
 * @returns {Promise<any[]>}
 */
export async function fetchAllPaginated(endpoint, { baseUrl, masterKey, pageSize = 100, maxPages = 50 }) {
  const allItems = [];
  const seenIds = new Set();
  const separator = endpoint.includes('?') ? '&' : '?';

  let totalPages = maxPages;
  for (let page = 1; page <= totalPages; page++) {
    const offset = (page - 1) * pageSize;
    const url = `${endpoint}${separator}page=${page}&page_size=${pageSize}&limit=${pageSize}&offset=${offset}`;

    try {
      const res = await litellmRequest(url, { baseUrl, masterKey });
      const items = Array.isArray(res) ? res : (res.users || res.keys || res.data || []);

      if (res && res.total_pages) {
        totalPages = Math.min(res.total_pages, maxPages);
      }

      if (!items || items.length === 0) break;

      let newItemsCount = 0;
      for (const item of items) {
        const idKey = item.user_id || item.token || item.key_alias || JSON.stringify(item);
        if (!seenIds.has(idKey)) {
          seenIds.add(idKey);
          allItems.push(item);
          newItemsCount++;
        }
      }

      if (newItemsCount === 0 || page >= totalPages) break;
    } catch {
      // If paginated query fails on first attempt, try single unpaginated request
      if (page === 1) {
        try {
          const fallbackRes = await litellmRequest(endpoint, { baseUrl, masterKey });
          const items = Array.isArray(fallbackRes) ? fallbackRes : (fallbackRes.users || fallbackRes.keys || fallbackRes.data || []);
          for (const item of items) {
            allItems.push(item);
          }
        } catch {
          // ignore
        }
      }
      break;
    }
  }

  return allItems;
}

/**
 * Pre-fetches registered users and keys from LiteLLM proxy with pagination
 * to build comprehensive, exact lookup maps across all historical runs.
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {string} options.masterKey
 * @returns {Promise<{ emailToUserId: Map<string, string>, aliasToUserId: Map<string, string>, userCache: Map<string, object> }>}
 */
export async function buildUserLookupMaps({ baseUrl, masterKey }) {
  const emailToUserId = new Map();
  const aliasToUserId = new Map();
  const userCache = new Map();

  // 1. Query /user/list across all pages
  try {
    const users = await fetchAllPaginated('/user/list', { baseUrl, masterKey });
    for (const u of users) {
      if (u && u.user_id) {
        userCache.set(u.user_id, u);
        if (u.user_email) {
          emailToUserId.set(u.user_email.trim().toLowerCase(), u.user_id);
        }
        if (Array.isArray(u.keys)) {
          for (const k of u.keys) {
            if (k.key_alias) aliasToUserId.set(k.key_alias.trim(), u.user_id);
            if (k.key_name) aliasToUserId.set(k.key_name.trim(), u.user_id);
          }
        }
      }
    }
  } catch (err) {
    // ignore
  }

  // 2. Query /key/list across all pages
  try {
    const keys = await fetchAllPaginated('/key/list', { baseUrl, masterKey });
    for (const k of keys) {
      if (k && k.user_id) {
        if (k.key_alias) aliasToUserId.set(k.key_alias.trim(), k.user_id);
        if (k.key_name) aliasToUserId.set(k.key_name.trim(), k.user_id);
        if (k.user_email) emailToUserId.set(k.user_email.trim().toLowerCase(), k.user_id);
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback: Query /spend/users across all pages
  if (emailToUserId.size === 0 && aliasToUserId.size === 0) {
    try {
      const spendUsers = await fetchAllPaginated('/spend/users', { baseUrl, masterKey });
      for (const u of spendUsers) {
        if (u && u.user_id) {
          userCache.set(u.user_id, u);
          if (u.user_email) {
            emailToUserId.set(u.user_email.trim().toLowerCase(), u.user_id);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return { emailToUserId, aliasToUserId, userCache };
}

/**
 * Robustly extracts all metrics (spend, tokens, cache read/write tokens, request counts)
 * from LiteLLM usageData (metadata & results & breakdowns) and userInfo (user_info & keys).
 * @param {object} usageData 
 * @param {object} userInfo 
 * @returns {object} Extracted metrics object
 */
export function extractAllLiteLLMMetrics(usageData, userInfo) {
  const meta = (usageData && usageData.metadata) || {};
  const user = (userInfo && (userInfo.user_info || userInfo)) || {};
  const keys = (userInfo && Array.isArray(userInfo.keys)) ? userInfo.keys : [];

  let spendUSD = Number(meta.total_spend ?? user.spend ?? 0);
  let promptTokens = Number(meta.total_prompt_tokens ?? 0);
  let completionTokens = Number(meta.total_completion_tokens ?? 0);
  let totalTokens = Number(meta.total_tokens ?? 0);
  let cacheReadTokens = Number(
    meta.total_cache_read_input_tokens 
    ?? meta.cache_read_input_tokens 
    ?? meta.total_cached_tokens 
    ?? meta.cached_tokens 
    ?? 0
  );
  let cacheWriteTokens = Number(
    meta.total_cache_creation_input_tokens 
    ?? meta.cache_creation_input_tokens 
    ?? meta.total_cache_write_input_tokens 
    ?? meta.cache_write_input_tokens 
    ?? 0
  );
  let totalRequests = Number(meta.total_api_requests ?? 0);
  let successfulRequests = Number(meta.total_successful_requests ?? 0);
  let failedRequests = Number(meta.total_failed_requests ?? 0);

  // 1. Aggregate from usageData.results if available
  if (usageData && Array.isArray(usageData.results) && usageData.results.length > 0) {
    let sumSpend = 0;
    let sumPrompt = 0;
    let sumComp = 0;
    let sumTot = 0;
    let sumCacheRead = 0;
    let sumCacheWrite = 0;
    let sumReq = 0;
    let sumSucc = 0;
    let sumFail = 0;
    let hasResults = false;

    for (const item of usageData.results) {
      const m = item.metrics || item;
      if (m) {
        if (m.spend != null) { sumSpend += Number(m.spend) || 0; hasResults = true; }
        if (m.prompt_tokens != null) { sumPrompt += Number(m.prompt_tokens) || 0; hasResults = true; }
        if (m.completion_tokens != null) { sumComp += Number(m.completion_tokens) || 0; hasResults = true; }
        if (m.total_tokens != null) { sumTot += Number(m.total_tokens) || 0; hasResults = true; }
        if (m.cache_read_input_tokens != null || m.cached_tokens != null) {
          sumCacheRead += Number(m.cache_read_input_tokens || m.cached_tokens) || 0;
          hasResults = true;
        }
        if (m.cache_creation_input_tokens != null || m.cache_write_input_tokens != null) {
          sumCacheWrite += Number(m.cache_creation_input_tokens || m.cache_write_input_tokens) || 0;
          hasResults = true;
        }
        if (m.api_requests != null) { sumReq += Number(m.api_requests) || 0; hasResults = true; }
        if (m.successful_requests != null) { sumSucc += Number(m.successful_requests) || 0; hasResults = true; }
        if (m.failed_requests != null) { sumFail += Number(m.failed_requests) || 0; hasResults = true; }
      }

      // Check model breakdowns
      if (item.breakdown && item.breakdown.models) {
        for (const modKey of Object.keys(item.breakdown.models)) {
          const mod = item.breakdown.models[modKey];
          if (mod) {
            if (mod.cache_read_input_tokens) sumCacheRead = Math.max(sumCacheRead, Number(mod.cache_read_input_tokens) || 0);
            if (mod.cache_creation_input_tokens) sumCacheWrite = Math.max(sumCacheWrite, Number(mod.cache_creation_input_tokens) || 0);
          }
        }
      }
    }

    if (hasResults) {
      if (totalTokens === 0 && sumTot > 0) totalTokens = sumTot;
      if (promptTokens === 0 && sumPrompt > 0) promptTokens = sumPrompt;
      if (completionTokens === 0 && sumComp > 0) completionTokens = sumComp;
      if (spendUSD === 0 && sumSpend > 0) spendUSD = sumSpend;
      if (cacheReadTokens === 0 && sumCacheRead > 0) cacheReadTokens = sumCacheRead;
      if (cacheWriteTokens === 0 && sumCacheWrite > 0) cacheWriteTokens = sumCacheWrite;
      if (totalRequests === 0 && sumReq > 0) totalRequests = sumReq;
      if (successfulRequests === 0 && sumSucc > 0) successfulRequests = sumSucc;
      if (failedRequests === 0 && sumFail > 0) failedRequests = sumFail;
    }
  }

  // 2. Aggregate from user keys if metadata/results had 0 values
  if (keys.length > 0) {
    for (const k of keys) {
      if (spendUSD === 0 && k.spend) spendUSD += Number(k.spend) || 0;
      if (totalTokens === 0 && k.total_tokens) totalTokens += Number(k.total_tokens) || 0;
      if (promptTokens === 0 && k.prompt_tokens) promptTokens += Number(k.prompt_tokens) || 0;
      if (completionTokens === 0 && k.completion_tokens) completionTokens += Number(k.completion_tokens) || 0;
      if (cacheReadTokens === 0 && (k.cache_read_input_tokens || k.cached_tokens)) {
        cacheReadTokens += Number(k.cache_read_input_tokens || k.cached_tokens) || 0;
      }
      if (cacheWriteTokens === 0 && (k.cache_creation_input_tokens || k.cache_write_input_tokens)) {
        cacheWriteTokens += Number(k.cache_creation_input_tokens || k.cache_write_input_tokens) || 0;
      }
    }
  }

  // If totalTokens is 0 but prompt + completion > 0, compute total
  if (totalTokens === 0 && (promptTokens > 0 || completionTokens > 0)) {
    totalTokens = promptTokens + completionTokens;
  }

  return {
    spendUSD,
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalRequests,
    successfulRequests,
    failedRequests,
  };
}

/**
 * Patches and refreshes all test-results-*.json files with data directly from LiteLLM.
 * @param {object} options 
 * @param {string} [options.baseUrl]
 * @param {string} [options.masterKey]
 * @param {boolean} [options.dryRun]
 * @param {string} [options.case]
 * @param {string} [options.baseDir]
 * @returns {Promise<{ total: number, patched: number, skipped: number, errors: number }>}
 */
export async function patchHistoricalResults(options = {}) {
  const baseUrl = options.baseUrl || defaults.baseUrl;
  const masterKey = options.masterKey || defaults.masterKey;
  const isDryRun = Boolean(options.dryRun);
  const targetCase = options.case || null;
  const targetUseCasesDir = options.baseDir || useCasesDir;

  console.log(`\n======================================================================`);
  console.log(`🔄 [PATCH] Refreshing historical test results from LiteLLM${isDryRun ? ' (DRY RUN)' : ''}`);
  console.log(`   LiteLLM Endpoint: ${baseUrl}`);
  console.log(`======================================================================\n`);

  if (!fs.existsSync(targetUseCasesDir)) {
    console.warn(`⚠️ [PATCH] Directory not found: ${targetUseCasesDir}`);
    return { total: 0, patched: 0, skipped: 0, errors: 0 };
  }

  // Pre-fetch LiteLLM user and key registry with pagination across all history
  console.log(`🔍 [LITELLM] Fetching user and key registry from LiteLLM proxy...`);
  const { emailToUserId, aliasToUserId, userCache } = await buildUserLookupMaps({ baseUrl, masterKey });
  console.log(`📊 [LITELLM] Mapped ${emailToUserId.size} user email(s) and ${aliasToUserId.size} key alias(es).\n`);

  const caseEntries = fs.readdirSync(targetUseCasesDir, { withFileTypes: true });
  let totalFound = 0;
  let patchedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const caseEntry of caseEntries) {
    if (!caseEntry.isDirectory() || caseEntry.name.startsWith('.')) continue;
    const caseName = caseEntry.name;

    if (targetCase && caseName !== targetCase) continue;

    const casePath = path.join(targetUseCasesDir, caseName);
    const files = fs.readdirSync(casePath);

    for (const file of files) {
      if (!file.startsWith('test-results-') || !file.endsWith('.json')) continue;

      totalFound++;
      const jsonFilePath = path.join(casePath, file);
      const match = file.match(/^test-results-(.+)\.json$/);
      const runTimestamp = match ? match[1] : '';
      const runDate = extractDateFromTimestamp(runTimestamp);
      const endDate = getBufferEndDate(runDate);
      const userEmail = `test_${caseName}_${runTimestamp}@example.com`.toLowerCase();
      const keyAlias = `${caseName}_${runTimestamp}`;

      try {
        const raw = fs.readFileSync(jsonFilePath, 'utf8');
        const testResult = JSON.parse(raw);
        const existingMetrics = testResult.metrics || {};

        // 1. Resolve exact userId using the pre-fetched lookup maps
        let userId = emailToUserId.get(userEmail) || aliasToUserId.get(keyAlias) || null;
        let userInfo = userId ? userCache.get(userId) : null;

        // If not found in maps, try fetching key info by alias
        if (!userId) {
          try {
            const keyInfo = await litellmRequest(`/key/info?key_alias=${encodeURIComponent(keyAlias)}`, {
              baseUrl,
              masterKey,
            });
            if (keyInfo && keyInfo.info && keyInfo.info.user_id) {
              userId = keyInfo.info.user_id;
              userInfo = keyInfo.info;
            }
          } catch {
            // ignore
          }
        }

        if (!userId) {
          console.warn(`   ⏩ Skipping ${file} (User not found in LiteLLM: ${userEmail})`);
          skippedCount++;
          continue;
        }

        // 2. Fetch specific user info and activity by user_id
        if (!userInfo || !userInfo.keys) {
          try {
            userInfo = await litellmRequest(`/user/info?user_id=${encodeURIComponent(userId)}`, {
              baseUrl,
              masterKey,
            });
          } catch {
            // use cached userInfo if available
          }
        }

        let usageData = null;
        // Query daily activity with wide start_date or without date cutoff
        try {
          usageData = await litellmRequest(
            `/user/daily/activity?user_id=${encodeURIComponent(userId)}&start_date=2020-01-01`,
            { baseUrl, masterKey }
          );
        } catch {
          try {
            usageData = await litellmRequest(
              `/user/daily/activity?user_id=${encodeURIComponent(userId)}`,
              { baseUrl, masterKey }
            );
          } catch {
            try {
              usageData = await litellmRequest(
                `/user/daily/activity?user_id=${encodeURIComponent(userId)}&start_date=${runDate}&end_date=${endDate}`,
                { baseUrl, masterKey }
              );
            } catch {
              usageData = { metadata: {}, results: [] };
            }
          }
        }

        // 3. Extract all refreshed metrics
        const extracted = extractAllLiteLLMMetrics(usageData, userInfo);

        // 4. Safe merge: if LiteLLM returned non-zero metrics, use them.
        // If LiteLLM returned 0 for tokens/spend but existing had positive values, keep existing positive values
        const refreshedMetrics = {
          spendUSD: extracted.spendUSD > 0 ? extracted.spendUSD : (existingMetrics.spendUSD || 0),
          promptTokens: extracted.promptTokens > 0 ? extracted.promptTokens : (existingMetrics.promptTokens || 0),
          completionTokens: extracted.completionTokens > 0 ? extracted.completionTokens : (existingMetrics.completionTokens || 0),
          totalTokens: extracted.totalTokens > 0 ? extracted.totalTokens : (existingMetrics.totalTokens || 0),
          cacheReadTokens: extracted.cacheReadTokens,
          cacheWriteTokens: extracted.cacheWriteTokens,
          totalRequests: extracted.totalRequests > 0 ? extracted.totalRequests : (existingMetrics.totalRequests || 0),
          successfulRequests: extracted.successfulRequests > 0 ? extracted.successfulRequests : (existingMetrics.successfulRequests || 0),
          failedRequests: extracted.failedRequests > 0 ? extracted.failedRequests : (existingMetrics.failedRequests || 0),
        };

        // Recalculate total tokens if needed
        if (refreshedMetrics.totalTokens === 0 && (refreshedMetrics.promptTokens > 0 || refreshedMetrics.completionTokens > 0)) {
          refreshedMetrics.totalTokens = refreshedMetrics.promptTokens + refreshedMetrics.completionTokens;
        }

        testResult.metrics = refreshedMetrics;

        if (!isDryRun) {
          fs.writeFileSync(jsonFilePath, JSON.stringify(testResult, null, 2), 'utf8');
        }

        console.log(`   ✅ [PATCHED] ${caseName}/${file} (User: ${userId})`);
        console.log(`      💰 Spend: $${refreshedMetrics.spendUSD.toFixed(6)} | 🪙 Tokens: ${refreshedMetrics.totalTokens} (Prompt: ${refreshedMetrics.promptTokens}, Completion: ${refreshedMetrics.completionTokens}, Cache Read: ${refreshedMetrics.cacheReadTokens}, Cache Write: ${refreshedMetrics.cacheWriteTokens}) | 🌐 Requests: ${refreshedMetrics.totalRequests} (Success: ${refreshedMetrics.successfulRequests}, Fail: ${refreshedMetrics.failedRequests})`);
        patchedCount++;
      } catch (err) {
        console.error(`   ❌ [ERROR] Failed patching ${caseName}/${file}: ${err.message}`);
        errorCount++;
      }
    }
  }

  console.log(`\n----------------------------------------------------------------------`);
  console.log(`🏁 [SUMMARY] Total: ${totalFound} | Patched: ${patchedCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);
  console.log(`----------------------------------------------------------------------\n`);

  if (!isDryRun && patchedCount > 0) {
    try {
      generateManifest();
    } catch (mErr) {
      console.error(`⚠️ [MANIFEST] Failed regenerating manifest: ${mErr.message}`);
    }
  }

  return { total: totalFound, patched: patchedCount, skipped: skippedCount, errors: errorCount };
}

// CLI execution handler
if (process.argv[1] && process.argv[1].endsWith('patch-metrics.js')) {
  const args = process.argv.slice(2);
  const cliOptions = {
    dryRun: args.includes('--dry-run'),
    case: null,
    baseUrl: defaults.baseUrl,
    masterKey: defaults.masterKey,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--case' && args[i + 1]) {
      cliOptions.case = args[i + 1];
      i++;
    } else if (args[i] === '--base-url' && args[i + 1]) {
      cliOptions.baseUrl = args[i + 1];
      i++;
    } else if (args[i] === '--master-key' && args[i + 1]) {
      cliOptions.masterKey = args[i + 1];
      i++;
    }
  }

  patchHistoricalResults(cliOptions)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`❌ [FATAL] ${err.message}`);
      process.exit(1);
    });
}

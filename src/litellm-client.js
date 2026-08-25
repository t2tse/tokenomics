import { defaults } from './config.js';

/**
 * Makes an authenticated request to the LiteLLM Proxy API.
 * @param {string} endpoint - API endpoint relative path
 * @param {object} [options] - Request options including baseUrl and masterKey
 * @param {string} [options.baseUrl] - LiteLLM proxy base URL
 * @param {string} [options.masterKey] - LiteLLM master/admin API key
 * @param {object} [options.reqOptions] - Additional fetch options (method, body, headers, etc.)
 * @returns {Promise<any>} Response JSON object
 */
export async function litellmRequest(endpoint, { baseUrl = defaults.baseUrl, masterKey = defaults.masterKey, ...reqOptions } = {}) {
  const cleanBaseUrl = (baseUrl || 'http://localhost:4000').replace(/\/+$/, '');
  const url = `${cleanBaseUrl}${endpoint}`;

  const response = await fetch(url, {
    ...reqOptions,
    headers: {
      'Authorization': `Bearer ${masterKey}`,
      'Content-Type': 'application/json',
      ...reqOptions.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LiteLLM request failed [${response.status}]: ${text}`);
  }

  return response.json();
}

/**
 * Creates an internal view-only user and virtual key in LiteLLM.
 * @param {object} config - Configuration parameters
 * @param {string} config.baseUrl - LiteLLM proxy base URL
 * @param {string} config.masterKey - LiteLLM master/admin API key
 * @param {string} config.caseName - Name of the test case
 * @param {string} config.runTimestamp - Formatted run timestamp
 * @returns {Promise<{ userId: string, secretKey: string }>} User ID and key
 */
export async function createTestUser({ baseUrl, masterKey, caseName, runTimestamp }) {
  const email = `test_${caseName}_${runTimestamp}@example.com`;
  const keyAlias = `${caseName}_${runTimestamp}`;

  console.log(`🔑 [USER & KEY] Creating user: ${email} and generating single Virtual Key with alias: ${keyAlias}`);

  const userResult = await litellmRequest('/user/new', {
    baseUrl,
    masterKey,
    method: 'POST',
    body: JSON.stringify({
      user_email: email,
      user_role: 'internal_user_viewer',
      send_invite_email: false,
      key_alias: keyAlias,
    }),
  });

  const userId = userResult.user_id;
  const secretKey = userResult.key;

  console.log(`🔑 [USER & KEY] Successfully registered. User ID: ${userId}, Key: ${secretKey.substring(0, 12)}...`);

  return { userId, secretKey };
}

/**
 * Fetches usage activity and user spend info from LiteLLM.
 * @param {object} config - Configuration parameters
 * @param {string} config.baseUrl - LiteLLM proxy base URL
 * @param {string} config.masterKey - LiteLLM master/admin API key
 * @param {string} config.userId - Target user ID
 * @returns {Promise<object>} Usage data and user info
 */
export async function fetchUserMetrics({ baseUrl, masterKey, userId }) {
  // Query daily activity for the dedicated user. Omit date filter to prevent UTC/local date boundary clipping.
  let usageData = null;
  try {
    usageData = await litellmRequest(`/user/daily/activity?user_id=${encodeURIComponent(userId)}`, {
      baseUrl,
      masterKey,
    });
  } catch {
    const today = new Date().toISOString().split('T')[0];
    usageData = await litellmRequest(
      `/user/daily/activity?user_id=${encodeURIComponent(userId)}&start_date=${today}&end_date=${today}`,
      { baseUrl, masterKey }
    );
  }

  const userInfo = await litellmRequest(`/user/info?user_id=${encodeURIComponent(userId)}`, {
    baseUrl,
    masterKey,
  });

  return { usageData, userInfo };
}

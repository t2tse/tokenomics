/**
 * Formats a date object or current time as YYYYMMDD-HHMMSS string.
 * @param {Date} [date=new Date()] - Date to format
 * @returns {string} Formatted timestamp string
 */
export function getFormattedTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

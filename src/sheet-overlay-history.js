import { google } from 'googleapis';
import { getAuthorizedClient } from './oauth.js';
import { loadSheetSyncTarget } from './config.js';
import { formatGoogleSheetUserMessage } from './sheet-api-errors.js';

/** @param {unknown} v */
function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** @param {string} tabName */
function escapeTabName(tabName) {
  return /[^A-Za-z0-9_]/.test(tabName)
    ? `'${tabName.replace(/'/g, "''")}'`
    : tabName;
}

/** @param {number} daysAgo */
function overlayDailyTabNameDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `COPYHUB-${y}-${m}-${day}`;
}

/**
 * Clipboard rows from one COPYHUB-YYYY-MM-DD tab (newest timestamps first).
 * Reads used cells in A:B from row 2 onward (append puts newer rows at the bottom).
 * @param {number} daysAgo 0 = today
 * @param {number} [maxRowsCap] Keep only this many newest rows (after sort).
 */
export async function fetchOverlayDailyTabRows(daysAgo, maxRowsCap = 500) {
  const day = Math.min(Math.max(Number(daysAgo), 0), 90);
  const cap = Math.min(Math.max(Number(maxRowsCap), 1), 2000);

  const target = await loadSheetSyncTarget();
  if (!target) return [];

  const auth = await getAuthorizedClient();
  if (!auth.credentials.refresh_token && !auth.credentials.access_token) {
    return [];
  }

  const sheets = google.sheets({ version: 'v4', auth });
  const tab = overlayDailyTabNameDaysAgo(day);
  const range = `${escapeTabName(tab)}!A2:B`;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: target.spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const values = res.data.values ?? [];

    /** @type {Array<{ ts: string, text: string, synced: boolean }>} */
    const items = [];
    for (const row of values) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const ts = cellToString(row[0]).trim();
      const text = cellToString(row[1]).trim();
      if (!text) continue;
      if (/^(time|thời gian)$/i.test(ts)) continue;
      items.push({ ts: ts || '', text, synced: true });
    }

    items.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
    return items.slice(0, cap);
  } catch (e) {
    throw new Error(formatGoogleSheetUserMessage(e));
  }
}

import { google } from 'googleapis';
import { getAuthorizedClient } from './oauth.js';
import { loadSheetSyncTarget } from './config.js';
import { dailySheetTabName } from './sheet-daily.js';
import { formatGoogleSheetUserMessage } from './sheet-api-errors.js';

/**
 * @param {string} tabName
 */
function a1RangeForTab(tabName) {
  const escaped = /[^A-Za-z0-9_]/.test(tabName)
    ? `'${tabName.replace(/'/g, "''")}'`
    : tabName;
  return `${escaped}!A:B`;
}

/**
 * @param {import('googleapis').sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} tabName
 * @returns {Promise<boolean>} true if a new tab was created (header row written)
 */
async function ensureDailySheetExists(sheets, spreadsheetId, tabName) {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title)',
  });
  const exists = data.sheets?.some((s) => s.properties?.title === tabName);
  if (exists) return false;

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tabName,
                gridProperties: { rowCount: 5000, columnCount: 4 },
              },
            },
          },
        ],
      },
    });
  } catch (e) {
    const err = /** @type {Error & { code?: number }} */ (e);
    const msg = `${err.message || ''} ${err.code || ''}`;
    if (msg.includes('already exists') || err.code === 400) {
      return false;
    }
    throw e;
  }

  const headerRange = a1RangeForTab(tabName).replace('!A:B', '!A1:B1');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: headerRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Time', 'Content']],
    },
  });
  return true;
}

/**
 * Append one row to the **daily** tab (creates a new tab each day if missing).
 * Column A = ISO timestamp, column B = content (RAW).
 * @param {string} clipboardText
 */
export async function appendClipboardToSheet(clipboardText) {
  try {
    const target = await loadSheetSyncTarget();
    if (!target) {
      throw new Error(
        'No Spreadsheet ID. Run copyhub login (setup page) or copyhub config ... --sheet-id <ID>.',
      );
    }

    const auth = await getAuthorizedClient();
    if (!auth.credentials.refresh_token && !auth.credentials.access_token) {
      throw new Error('Not signed in. Run: copyhub login');
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const tabName = dailySheetTabName();
    await ensureDailySheetExists(sheets, target.spreadsheetId, tabName);

    const range = a1RangeForTab(tabName);
    const ts = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: target.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[ts, clipboardText]],
      },
    });
  } catch (e) {
    throw new Error(formatGoogleSheetUserMessage(e));
  }
}

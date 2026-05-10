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
 * @returns {Promise<boolean>} true nếu vừa tạo tab mới (đã ghi dòng tiêu đề)
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
      values: [['Thời gian', 'Nội dung']],
    },
  });
  return true;
}

/**
 * Ghi một dòng lên tab **theo ngày** (tự tạo tab mới mỗi ngày nếu chưa có).
 * Cột A = ISO timestamp, cột B = nội dung (RAW).
 * @param {string} clipboardText
 */
export async function appendClipboardToSheet(clipboardText) {
  try {
    const target = await loadSheetSyncTarget();
    if (!target) {
      throw new Error(
        'Chưa có Spreadsheet ID. Chạy copyhub login (trang cài đặt) hoặc copyhub config ... --sheet-id <ID>.',
      );
    }

    const auth = await getAuthorizedClient();
    if (!auth.credentials.refresh_token && !auth.credentials.access_token) {
      throw new Error('Chưa đăng nhập. Chạy: copyhub login');
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

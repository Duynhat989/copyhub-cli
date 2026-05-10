import { appendHistory } from './storage.js';
import { startClipboardWatcher } from './clipboard-watcher.js';
import { appendClipboardToSheet } from './sheets.js';
import { loadTokens } from './tokens.js';
import { loadSheetSyncTarget } from './config.js';
import { DIR } from './paths.js';
import { logLinuxClipboardHint } from './platform.js';
import { dailySheetTabName } from './sheet-daily.js';
import { spawnCopyhubOverlay } from './electron-launcher.js';

/**
 * @typedef {{ useSheet: boolean, skipOverlay: boolean }} StartDaemonOptions
 */

/**
 * Chạy watcher (+ overlay tuỳ chọn). Gọi onShutdown khi SIGINT/SIGTERM trước khi thoát.
 * @param {StartDaemonOptions} opts
 * @param {{ log: typeof console.log, warn: typeof console.warn, error: typeof console.error }} io
 */
export async function runCopyhubDaemon(opts, io = console) {
  const useSheet = opts.useSheet;
  const skipOverlay = opts.skipOverlay;

  let tokens = await loadTokens();
  const sheetTarget = await loadSheetSyncTarget();

  if (useSheet && !sheetTarget) {
    io.warn(
      'Chưa có Spreadsheet ID trong ~/.copyhub/config.json — chạy copyhub login hoặc copyhub config ... --sheet-id <ID>',
    );
  }
  if (useSheet && sheetTarget && !tokens?.refresh_token && !tokens?.access_token) {
    io.warn('Chưa có token OAuth — chỉ lưu cục bộ. Chạy copyhub login.');
  }

  io.log('CopyHub daemon đang chạy.');
  io.log('Thư mục dữ liệu:', DIR);
  if (sheetTarget) {
    io.log(`Sheet: tab mỗi ngày "${dailySheetTabName()}".`);
  }

  /** @type {import('node:child_process').ChildProcess | null} */
  let overlayProc = null;
  let overlayStoppingWithCli = false;

  if (!skipOverlay) {
    try {
      overlayProc = spawnCopyhubOverlay({
        stdio: 'ignore',
        envExtra: { COPYHUB_SPAWNED_BY_START: '1' },
      });
      overlayProc.on('error', (err) => {
        io.warn('Không khởi động được overlay Electron:', err.message);
        overlayProc = null;
      });
      overlayProc.on('exit', (code, sig) => {
        if (!overlayStoppingWithCli && code != null && code !== 0) {
          io.warn(
            `Overlay Electron thoát (mã ${code}). Chạy copyhub overlay hoặc khởi động lại copyhub start.`,
          );
        }
        overlayProc = null;
      });
      io.log('Đã khởi động cửa sổ lịch sử (Electron).');
    } catch (e) {
      io.warn('Không khởi động được overlay:', /** @type {Error} */ (e).message);
    }
  }

  logLinuxClipboardHint();

  let lastSheetLogKey = '';
  let lastSheetLogAt = 0;

  const watcher = startClipboardWatcher(async (text) => {
    let synced = false;
    if (useSheet && sheetTarget && (tokens?.refresh_token || tokens?.access_token)) {
      try {
        await appendClipboardToSheet(text);
        synced = true;
        lastSheetLogKey = '';
        io.log(`[${new Date().toISOString()}] Đã ghi dòng lên Google Sheet (tab ngày).`);
      } catch (e) {
        const msg = /** @type {Error} */ (e).message;
        const now = Date.now();
        const key = msg.slice(0, 160);
        if (key !== lastSheetLogKey || now - lastSheetLogAt > 120_000) {
          lastSheetLogKey = key;
          lastSheetLogAt = now;
          io.error(`[${new Date().toISOString()}] Lỗi Google Sheet:`, msg);
        }
      }
    }
    await appendHistory({ text, syncedToSheet: synced });
    const oneLine = text.replace(/\r?\n/g, '\\n').slice(0, 120);
    io.log(
      `[${new Date().toISOString()}] Đã lưu (${text.length} ký tự): ${oneLine}${text.length > 120 ? '…' : ''}`,
    );
  });

  return {
    stopSync() {
      watcher.stop();
      if (overlayProc && !overlayProc.killed) {
        overlayStoppingWithCli = true;
        try {
          overlayProc.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }
    },
  };
}

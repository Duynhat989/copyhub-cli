#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { program } from 'commander';
import { existsSync } from 'node:fs';
import {
  loadConfig,
  saveConfig,
  loadSheetSyncTarget,
  DEFAULT_OAUTH_REDIRECT_PORT,
  describeOAuthCredentialSource,
  ENV_GOOGLE_CLIENT_ID,
  ENV_GOOGLE_CLIENT_SECRET,
  ENV_OAUTH_REDIRECT_PORT,
  loadOverlayAcceleratorFromConfigSync,
  loadOverlayPlatformFromConfigSync,
} from './config.js';
import { runLoginFlow } from './oauth.js';
import { clearTokens, loadTokens } from './tokens.js';
import { spawnCopyhubOverlay } from './electron-launcher.js';
import { CONFIG_PATH, TOKENS_PATH, HISTORY_PATH, DIR } from './paths.js';
import { dailySheetTabName } from './sheet-daily.js';
import {
  readRunState,
  writeRunState,
  clearRunState,
  isPidAlive,
  pruneStaleRunState,
} from './daemon-state.js';
import { killDaemonTree } from './stop-process.js';
import { ensureDir } from './storage.js';
import { runCopyhubDaemon } from './start-daemon-logic.js';

const CLI_JS = fileURLToPath(new URL('./cli.js', import.meta.url));

program.name('copyhub').description(
  'CopyHub — clipboard, lịch sử nổi, đồng bộ Google Sheets (tab COPYHUB-ngày). Windows, macOS, Linux.',
);

program
  .command('config')
  .description('Lưu Client ID / Secret (và tuỳ chọn Sheet ID) vào ~/.copyhub/config.json')
  .requiredOption('--client-id <id>', 'OAuth 2.0 Client ID')
  .requiredOption('--client-secret <secret>', 'OAuth 2.0 Client Secret')
  .option(
    '--redirect-port <port>',
    `Cổng localhost callback OAuth (mặc định ${DEFAULT_OAUTH_REDIRECT_PORT})`,
    (v) => parseInt(v, 10),
  )
  .option('--sheet-id <id>', 'Google Spreadsheet ID (URL .../d/<ID>/edit); có thể nhập sau copyhub login')
  .action(async (opts) => {
    const port =
      typeof opts.redirectPort === 'number' && !Number.isNaN(opts.redirectPort)
        ? opts.redirectPort
        : DEFAULT_OAUTH_REDIRECT_PORT;
    /** @type {Parameters<typeof saveConfig>[0]} */
    const payload = {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      redirectPort: port,
    };
    if (opts.sheetId) payload.googleSheetId = opts.sheetId;
    await saveConfig(payload);
    console.log(`Đã lưu cấu hình: ${CONFIG_PATH}`);
    console.log(
      `Trong Google Cloud Console, thêm URI chuyển hướng: http://127.0.0.1:${port}/oauth2callback`,
    );
    console.log('Bật API: Google Sheets API cho cùng project OAuth.');
  });

program
  .command('login')
  .description(
    `Đăng nhập Google (OAuth Sheets), sau đó mở trang cài đặt Spreadsheet ID — cổng ${DEFAULT_OAUTH_REDIRECT_PORT} hoặc ${ENV_OAUTH_REDIRECT_PORT}`,
  )
  .action(async () => {
    await runLoginFlow();
  });

program
  .command('logout')
  .description('Xóa token đã lưu')
  .action(async () => {
    await clearTokens();
    console.log(`Đã xóa token: ${TOKENS_PATH}`);
  });

program
  .command('overlay')
  .description(
    'Chỉ chạy cửa sổ Electron (khi không dùng copyhub start). macOS: có thể cần quyền Trợ năng.',
  )
  .action(() => {
    try {
      const child = spawnCopyhubOverlay();
      child.on('error', (err) => {
        console.error(err.message);
        process.exit(1);
      });
    } catch (e) {
      console.error(/** @type {Error} */ (e).message);
      process.exitCode = 1;
    }
  });

program
  .command('list')
  .alias('ls')
  .description('Xem tiến trình CopyHub nền (copyhub start) có đang chạy không')
  .action(() => {
    pruneStaleRunState();
    const s = readRunState();
    if (!s) {
      console.log('Không có tiến trình nền CopyHub (không thấy ~/.copyhub/run.json hoặc đã dọn).');
      return;
    }
    if (!isPidAlive(s.pid)) {
      console.log(`PID ${s.pid} không còn sống — đã xóa run.json.`);
      clearRunState();
      return;
    }
    console.log('CopyHub nền đang chạy:');
    console.log(`  PID:        ${s.pid}`);
    console.log(`  Bắt đầu:    ${s.startedAt || '(không rõ)'}`);
    console.log(`  Dừng bằng:  copyhub stop`);
  });

program
  .command('stop')
  .description('Dừng tiến trình nền do copyhub start (và overlay con)')
  .action(() => {
    pruneStaleRunState();
    const s = readRunState();
    if (!s) {
      console.log('Không có tiến trình nền để dừng.');
      return;
    }
    if (!isPidAlive(s.pid)) {
      console.log(`PID ${s.pid} không còn sống — đã dọn run.json.`);
      clearRunState();
      return;
    }
    killDaemonTree(s.pid);
    clearRunState();
    console.log(`Đã dừng tiến trình PID ${s.pid}.`);
  });

program
  .command('status')
  .description('Kiểm tra OAuth, Sheet và token')
  .action(async () => {
    pruneStaleRunState();
    const cfg = await loadConfig();
    const sheet = await loadSheetSyncTarget();
    const tok = await loadTokens();
    const src = describeOAuthCredentialSource();

    if (!cfg) {
      console.log('Cấu hình OAuth: chưa');
      console.log(
        `  Đặt ${ENV_GOOGLE_CLIENT_ID} và ${ENV_GOOGLE_CLIENT_SECRET} trong .env (xem .env.example), hoặc chạy: copyhub config`,
      );
    } else {
      const srcLabel =
        src === 'env' ? 'biến môi trường / .env' : src === 'mixed' ? 'hỗn hợp .env + file config' : CONFIG_PATH;
      console.log('Cấu hình OAuth: có');
      console.log(`  Nguồn Client ID/Secret: ${srcLabel}`);
      console.log(`  Callback: http://127.0.0.1:${cfg.redirectPort}/oauth2callback`);
    }

    if (!sheet) {
      console.log(
        'Google Sheet: chưa — chạy copyhub login (trang cài đặt) hoặc copyhub config ... --sheet-id <ID>',
      );
    } else {
      const todayTab = dailySheetTabName();
      console.log(
        `Google Sheet: có — ID …${sheet.spreadsheetId.slice(-8)} · tab hôm nay: "${todayTab}"`,
      );
    }

    console.log(
      'Token:',
      tok?.refresh_token || tok?.access_token ? `có (${TOKENS_PATH})` : 'chưa (chạy copyhub login)',
    );
    if (existsSync(HISTORY_PATH)) {
      console.log('Lịch sử:', HISTORY_PATH);
    }

    const plat = loadOverlayPlatformFromConfigSync();
    const platLabel =
      plat === 'mac' ? 'macOS' : plat === 'linux' ? 'Linux' : plat === 'win' ? 'Windows' : '(chưa chọn)';
    console.log(`Nền tảng cài đặt overlay: ${platLabel}`);

    const envAccel = process.env.COPYHUB_OVERLAY_ACCELERATOR?.trim();
    const cfgAccel = loadOverlayAcceleratorFromConfigSync();
    if (envAccel) {
      console.log(`Phím overlay (.env): ${envAccel}`);
    } else if (cfgAccel) {
      console.log(`Phím overlay (config): ${cfgAccel}`);
    } else {
      console.log('Phím overlay: (mặc định Ctrl+Shift+H — đặt sau copyhub login hoặc COPYHUB_OVERLAY_ACCELERATOR)');
    }

    const run = readRunState();
    if (run && isPidAlive(run.pid)) {
      console.log(`Tiến trình nền: có (PID ${run.pid}) — copyhub list`);
    } else if (run) {
      console.log('Tiến trình nền: run.json có nhưng PID không sống — chạy copyhub stop để dọn.');
    } else {
      console.log('Tiến trình nền: không — copyhub start để chạy ngầm.');
    }
  });

program
  .command('start')
  .description(
    'Chạy Clipboard + Sheet + overlay nền (đóng CMD vẫn chạy). Chặn nếu đã có PID. --foreground để gắn terminal.',
  )
  .option('--no-sheet', 'Chỉ lưu cục bộ, không ghi Sheet')
  .option('--no-overlay', 'Không mở Electron')
  .option('--foreground', 'Chạy trực tiếp trong terminal (Ctrl+C dừng; không ghi PID nền)')
  .action(async (opts) => {
    pruneStaleRunState();

    const useSheet = opts.sheet !== false;
    const skipOverlay =
      opts.overlay === false || process.env.COPYHUB_START_NO_OVERLAY === '1';

    const existing = readRunState();
    if (existing && isPidAlive(existing.pid)) {
      console.error(
        `CopyHub đã chạy nền (PID ${existing.pid}). Xem: copyhub list — Dừng: copyhub stop`,
      );
      process.exit(1);
    }
    if (existing && !isPidAlive(existing.pid)) {
      clearRunState();
    }

    if (opts.foreground) {
      console.log('CopyHub chế độ foreground. Ctrl+C để dừng.');
      await ensureDir();

      const ctrl = await runCopyhubDaemon({ useSheet, skipOverlay });

      const onStop = () => {
        ctrl.stopSync();
        process.exit(0);
      };
      process.on('SIGINT', onStop);
      process.on('SIGTERM', onStop);
      return;
    }

    await ensureDir();
    const daemonArgs = [CLI_JS, '_daemon'];
    if (!useSheet) daemonArgs.push('--no-sheet');
    if (skipOverlay) daemonArgs.push('--no-overlay');

    const child = spawn(process.execPath, daemonArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();

    if (!child.pid) {
      console.error('Không spawn được tiến trình nền.');
      process.exit(1);
    }

    writeRunState({
      pid: child.pid,
      startedAt: new Date().toISOString(),
      foreground: false,
    });

    console.log(`CopyHub đã chạy nền (PID ${child.pid}). Có thể đóng cửa sổ CMD.`);
    console.log('Xem: copyhub list   |   Dừng: copyhub stop');
    process.exit(0);
  });

program
  .command('_daemon', { hidden: true })
  .option('--no-sheet', 'internal')
  .option('--no-overlay', 'internal')
  .action(async (opts) => {
    const useSheet = opts.sheet !== false;
    const skipOverlay =
      opts.overlay === false || process.env.COPYHUB_START_NO_OVERLAY === '1';

    function clearMyRunState() {
      try {
        const cur = readRunState();
        if (cur && cur.pid === process.pid) {
          clearRunState();
        }
      } catch {
        /* ignore */
      }
    }

    const ctrl = await runCopyhubDaemon({ useSheet, skipOverlay });

    const shutdown = () => {
      ctrl.stopSync();
      clearMyRunState();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('exit', clearMyRunState);
  });

program
  .command('commands')
  .alias('cmds')
  .description('Liệt kê các lệnh CLI')
  .action(() => {
    console.log(`copyhub config [--client-id ID] [--client-secret SEC] [--redirect-port P] [--sheet-id ID]
copyhub login     | copyhub logout | copyhub status
copyhub start [--no-sheet] [--no-overlay] [--foreground]
      Mặc định chạy nền (đóng CMD vẫn chạy). Một instance — đã chạy thì start lại bị chặn.
copyhub list (ls) | copyhub stop
copyhub overlay   | copyhub commands / copyhub --help`);
  });

program.parse();

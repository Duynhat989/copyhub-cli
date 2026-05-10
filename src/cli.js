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
  'CopyHub — clipboard, overlay history, Google Sheets sync (COPYHUB-daily tabs). Windows, macOS, Linux.',
);

program
  .command('config')
  .description('Save Client ID / Secret (optional Sheet ID) to ~/.copyhub/config.json')
  .requiredOption('--client-id <id>', 'OAuth 2.0 Client ID')
  .requiredOption('--client-secret <secret>', 'OAuth 2.0 Client Secret')
  .option(
    '--redirect-port <port>',
    `Localhost OAuth callback port (default ${DEFAULT_OAUTH_REDIRECT_PORT})`,
    (v) => parseInt(v, 10),
  )
  .option('--sheet-id <id>', 'Google Spreadsheet ID (URL .../d/<ID>/edit); can be set later via copyhub login')
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
    console.log(`Saved configuration: ${CONFIG_PATH}`);
    console.log(
      `In Google Cloud Console, add redirect URI: http://127.0.0.1:${port}/oauth2callback`,
    );
    console.log('Enable Google Sheets API for the same OAuth project.');
  });

program
  .command('login')
  .description(
    `Google sign-in (OAuth Sheets), then Spreadsheet ID setup page — port ${DEFAULT_OAUTH_REDIRECT_PORT} or ${ENV_OAUTH_REDIRECT_PORT}`,
  )
  .action(async () => {
    await runLoginFlow();
  });

program
  .command('logout')
  .description('Remove saved tokens')
  .action(async () => {
    await clearTokens();
    console.log(`Removed tokens: ${TOKENS_PATH}`);
  });

program
  .command('overlay')
  .description(
    'Run only the Electron overlay window (without copyhub start). macOS may require Accessibility permissions.',
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
  .description('Show whether the CopyHub background process (copyhub start) is running')
  .action(() => {
    pruneStaleRunState();
    const s = readRunState();
    if (!s) {
      console.log('No CopyHub background process (no ~/.copyhub/run.json or already cleared).');
      return;
    }
    if (!isPidAlive(s.pid)) {
      console.log(`PID ${s.pid} is not running — removed run.json.`);
      clearRunState();
      return;
    }
    console.log('CopyHub background process is running:');
    console.log(`  PID:        ${s.pid}`);
    console.log(`  Started:    ${s.startedAt || '(unknown)'}`);
    console.log(`  Stop with:  copyhub stop`);
  });

program
  .command('stop')
  .description('Stop the background process started by copyhub start (and overlay child)')
  .action(() => {
    pruneStaleRunState();
    const s = readRunState();
    if (!s) {
      console.log('No background process to stop.');
      return;
    }
    if (!isPidAlive(s.pid)) {
      console.log(`PID ${s.pid} is not running — cleared run.json.`);
      clearRunState();
      return;
    }
    killDaemonTree(s.pid);
    clearRunState();
    console.log(`Stopped process PID ${s.pid}.`);
  });

program
  .command('status')
  .description('Check OAuth, Sheet, and tokens')
  .action(async () => {
    pruneStaleRunState();
    const cfg = await loadConfig();
    const sheet = await loadSheetSyncTarget();
    const tok = await loadTokens();
    const src = describeOAuthCredentialSource();

    if (!cfg) {
      console.log('OAuth config: missing');
      console.log(
        `  Set ${ENV_GOOGLE_CLIENT_ID} and ${ENV_GOOGLE_CLIENT_SECRET} in .env (see .env.example), or run: copyhub config`,
      );
    } else {
      const srcLabel =
        src === 'env'
          ? 'environment / .env'
          : src === 'mixed'
            ? 'mixed .env + config file'
            : CONFIG_PATH;
      console.log('OAuth config: ok');
      console.log(`  Client ID/Secret source: ${srcLabel}`);
      console.log(`  Callback: http://127.0.0.1:${cfg.redirectPort}/oauth2callback`);
    }

    if (!sheet) {
      console.log(
        'Google Sheet: not set — run copyhub login (setup page) or copyhub config ... --sheet-id <ID>',
      );
    } else {
      const todayTab = dailySheetTabName();
      console.log(
        `Google Sheet: ok — ID …${sheet.spreadsheetId.slice(-8)} · today's tab: "${todayTab}"`,
      );
    }

    console.log(
      'Token:',
      tok?.refresh_token || tok?.access_token ? `present (${TOKENS_PATH})` : 'missing (run copyhub login)',
    );
    if (existsSync(HISTORY_PATH)) {
      console.log('History:', HISTORY_PATH);
    }

    const plat = loadOverlayPlatformFromConfigSync();
    const platLabel =
      plat === 'mac' ? 'macOS' : plat === 'linux' ? 'Linux' : plat === 'win' ? 'Windows' : '(not set)';
    console.log(`Overlay platform setting: ${platLabel}`);

    const envAccel = process.env.COPYHUB_OVERLAY_ACCELERATOR?.trim();
    const cfgAccel = loadOverlayAcceleratorFromConfigSync();
    if (envAccel) {
      console.log(`Overlay shortcut (.env): ${envAccel}`);
    } else if (cfgAccel) {
      console.log(`Overlay shortcut (config): ${cfgAccel}`);
    } else {
      console.log(
        'Overlay shortcut: (default Ctrl+Shift+H — set after copyhub login or COPYHUB_OVERLAY_ACCELERATOR)',
      );
    }

    const run = readRunState();
    if (run && isPidAlive(run.pid)) {
      console.log(`Background process: yes (PID ${run.pid}) — copyhub list`);
    } else if (run) {
      console.log('Background process: run.json exists but PID is dead — run copyhub stop to clean up.');
    } else {
      console.log('Background process: no — copyhub start to run in background.');
    }
  });

program
  .command('start')
  .description(
    'Run clipboard + Sheet + overlay in background (terminal can close). Blocks if PID already running. Use --foreground to attach to terminal.',
  )
  .option('--no-sheet', 'Local history only, do not write to Sheets')
  .option('--no-overlay', 'Do not launch Electron')
  .option('--foreground', 'Run in foreground (Ctrl+C stops; no background PID file)')
  .action(async (opts) => {
    pruneStaleRunState();

    const useSheet = opts.sheet !== false;
    const skipOverlay =
      opts.overlay === false || process.env.COPYHUB_START_NO_OVERLAY === '1';

    const existing = readRunState();
    if (existing && isPidAlive(existing.pid)) {
      console.error(
        `CopyHub already running in background (PID ${existing.pid}). See: copyhub list — Stop: copyhub stop`,
      );
      process.exit(1);
    }
    if (existing && !isPidAlive(existing.pid)) {
      clearRunState();
    }

    if (opts.foreground) {
      console.log('CopyHub foreground mode. Press Ctrl+C to stop.');
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
      console.error('Could not spawn background process.');
      process.exit(1);
    }

    writeRunState({
      pid: child.pid,
      startedAt: new Date().toISOString(),
      foreground: false,
    });

    console.log(`CopyHub running in background (PID ${child.pid}). You may close this terminal.`);
    console.log('Check: copyhub list   |   Stop: copyhub stop');
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
  .description('List CLI commands')
  .action(() => {
    console.log(`copyhub config [--client-id ID] [--client-secret SEC] [--redirect-port P] [--sheet-id ID]
copyhub login     | copyhub logout | copyhub status
copyhub start [--no-sheet] [--no-overlay] [--foreground]
      Default runs in background (terminal can close). Single instance — second start is blocked.
copyhub list (ls) | copyhub stop
copyhub overlay   | copyhub commands / copyhub --help`);
  });

program.parse();

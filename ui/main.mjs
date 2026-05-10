import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  systemPreferences,
  powerMonitor,
} from 'electron';
import { loadCopyhubEnv } from '../src/load-env.js';
import { readRecentHistorySync } from '../src/storage.js';
import {
  loadOverlayAcceleratorFromConfigSync,
  loadSheetSyncTarget,
} from '../src/config.js';
import { loadTokens } from '../src/tokens.js';
import { fetchOverlayDailyTabRows } from '../src/sheet-overlay-history.js';

loadCopyhubEnv();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Set to 1 so the window does not hide on blur (only Esc / pick row to copy). */
const STICKY_NO_BLUR = process.env.COPYHUB_OVERLAY_STICKY === '1';

/**
 * Electron Accelerator: use `Control`, not `Ctrl`; Unicode ⌃/⌘ → words.
 * See migrateDarwinOverlayAccelerator — `CommandOrControl` is ⌘ on macOS, not ⌃.
 */
function normalizeAccelerator(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim().normalize('NFKC');
  s = s.replace(/\u2303/g, 'Control'); // ⌃
  s = s.replace(/\u2318/g, 'Command'); // ⌘
  s = s.replace(/\u2325/g, 'Alt'); // ⌥
  s = s.replace(/\bCtrl\b/gi, 'Control');
  s = s.replace(/\bCmd\b/gi, 'Command');
  s = s.replace(/\bCmdOrCtrl\b/gi, 'CommandOrControl');
  s = s.replace(/\s*\+\s*/g, '+');
  return s;
}

/**
 * On macOS, Electron maps `CommandOrControl` to ⌘. CopyHub defaults want ⌃ Control + Shift + H.
 * Migrate only this chord so ⌃+Shift+H works if config still has the cross-platform preset.
 * @param {string} normalized output of normalizeAccelerator
 */
function migrateDarwinOverlayAccelerator(normalized) {
  if (process.platform !== 'darwin' || !normalized) return normalized;
  const compact = normalized.replace(/\s+/g, '');
  if (/^commandorcontrol\+shift\+h$/i.test(compact)) return 'Control+Shift+H';
  return normalized;
}

/** Same physical ⌃ / Ctrl key on Mac (Apple & Windows-layout keyboards) and on Win/Linux — one default everywhere. */
const DEFAULT_ACCEL = 'Control+Shift+H';
const HIDE_ON_START = process.env.COPYHUB_OVERLAY_HIDE_ON_START === '1';

/** Overlay size (slightly larger than earlier ~70% width). */
const OVERLAY_WIDTH = Math.round(460 * 0.84);
const OVERLAY_HEIGHT = 590;

/** For UI / IPC: registered shortcut and raw value from .env */
let overlayHotkeyMeta = {
  accelerator: '',
  usedFallback: false,
  requestedRaw: '',
};

let win = null;
let tray = null;
/** Avoid hiding immediately after show (WM quirks). */
let blurHideEnabled = false;

/**
 * After showing the overlay, enable blur→hide after a short grace period so clicks outside close it reliably.
 * @param {BrowserWindow} w
 */
function armBlurHideEnable(w) {
  if (STICKY_NO_BLUR || !w || w.isDestroyed()) return;
  blurHideEnabled = false;
  let armed = false;
  const arm = () => {
    if (armed || !w || w.isDestroyed()) return;
    armed = true;
    setTimeout(() => {
      if (!STICKY_NO_BLUR && w && !w.isDestroyed()) {
        blurHideEnabled = true;
      }
    }, 320);
  };
  w.once('focus', arm);
  setTimeout(arm, 420);
}

/**
 * Stay above other apps: screen-saver level (highest in Electron), moveTop, all workspaces.
 * @param {BrowserWindow} w
 */
function applyAlwaysOnTopStack(w) {
  if (!w || w.isDestroyed()) return;
  try {
    w.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    try {
      w.setAlwaysOnTop(true, 'floating');
    } catch {
      w.setAlwaysOnTop(true);
    }
  }
  try {
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* unsupported on some Linux builds */
  }
  try {
    if (typeof w.moveTop === 'function') {
      w.moveTop();
    }
  } catch {
    /* ignore */
  }
}

/** Bring app + overlay forward (macOS often needs app focus for always-on-top popups after idle). */
function bringOverlayToFront(w) {
  if (!w || w.isDestroyed()) return;
  applyAlwaysOnTopStack(w);
  if (process.platform === 'darwin') {
    try {
      app.focus({ steal: true });
    } catch {
      try {
        app.focus();
      } catch {
        /* ignore */
      }
    }
  }
  try {
    w.focus();
  } catch {
    /* ignore */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    alwaysOnTop: true,
    show: false,
    /** Frameless: no title bar + menu (Windows/macOS). */
    frame: false,
    roundedCorners: true,
    /** Show on taskbar for visibility (COPYHUB_OVERLAY_SKIP_TASKBAR=1 hides from taskbar). */
    skipTaskbar: process.env.COPYHUB_OVERLAY_SKIP_TASKBAR === '1',
    title: 'CopyHub',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[CopyHub overlay] Renderer process ended:', details.reason);
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.reload();
    } catch (e) {
      console.warn(
        '[CopyHub overlay] Reload after renderer exit failed:',
        /** @type {Error} */ (e).message,
      );
    }
  });

  win.on('show', () => {
    applyAlwaysOnTopStack(win);
  });

  if (!STICKY_NO_BLUR) {
    win.on('blur', () => {
      if (!blurHideEnabled) return;
      if (win && !win.webContents.isDevToolsOpened()) {
        win.hide();
      }
    });
  }

  win.on('close', (e) => {
    e.preventDefault();
    win?.hide();
  });

  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      win?.hide();
    }
  });

  win.once('ready-to-show', () => {
    if (HIDE_ON_START) {
      blurHideEnabled = true;
      return;
    }
    placeWindowAtCursor(win);
    win.show();
    bringOverlayToFront(win);
    win.webContents.send('overlay:open');
    setTimeout(() => applyAlwaysOnTopStack(win), 120);
    armBlurHideEnable(win);
  });
}

/**
 * Position window near cursor (display containing pointer).
 * @param {BrowserWindow} w
 */
function placeWindowAtCursor(w) {
  if (!w || w.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const { workArea } = display;
  const { width, height } = w.getBounds();
  const margin = 10;
  let x = Math.round(point.x - width / 2);
  let y = Math.round(point.y - 40);
  x = Math.max(
    workArea.x + margin,
    Math.min(x, workArea.x + workArea.width - width - margin),
  );
  y = Math.max(
    workArea.y + margin,
    Math.min(y, workArea.y + workArea.height - height - margin),
  );
  w.setPosition(x, y);
}

function toggleOverlay() {
  try {
    if (!win || win.isDestroyed()) {
      blurHideEnabled = false;
      createWindow();
      return;
    }
    if (win.isVisible()) {
      win.hide();
      return;
    }
    blurHideEnabled = false;
    placeWindowAtCursor(win);
    win.show();
    bringOverlayToFront(win);
    const wc = win.webContents;
    if (!wc.isDestroyed()) {
      wc.send('overlay:open');
    }
    setTimeout(() => applyAlwaysOnTopStack(win), 120);
    armBlurHideEnable(win);
  } catch (e) {
    const msg = /** @type {Error} */ (e).message || String(e);
    console.warn('[CopyHub overlay] toggle failed:', msg);
    try {
      if (win && !win.isDestroyed()) {
        const wc = win.webContents;
        if (!wc.isDestroyed()) {
          wc.reload();
          return;
        }
      }
    } catch {
      /* recreate below */
    }
    try {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
    } catch {
      /* ignore */
    }
    win = null;
    blurHideEnabled = false;
    createWindow();
  }
}

/**
 * Register global shortcut: try .env / saved config (normalized) then default Control+Shift+H.
 * @returns {{ accelerator: string, usedFallback: boolean }}
 */
function registerHotkeys() {
  const raw =
    process.env.COPYHUB_OVERLAY_ACCELERATOR?.trim() ||
    loadOverlayAcceleratorFromConfigSync();
  const candidates = [];
  if (raw) {
    const n = migrateDarwinOverlayAccelerator(normalizeAccelerator(raw));
    if (n) candidates.push(n);
  }
  candidates.push(DEFAULT_ACCEL);

  let usedFallback = false;
  for (let i = 0; i < candidates.length; i++) {
    const acc = candidates[i];
    try {
      const ok = globalShortcut.register(acc, () => toggleOverlay());
      if (ok) {
        if (i > 0) usedFallback = true;
        return { accelerator: acc, usedFallback };
      }
      console.warn(
        `CopyHub overlay — globalShortcut could not register "${acc}" (in use by another app, or macOS Input Source / permissions).`,
      );
    } catch (e) {
      console.warn('Invalid accelerator:', acc, /** @type {Error} */ (e).message);
    }
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* ignore */
    }
  }
  if (process.platform === 'darwin') {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted) {
      console.error(
        'CopyHub overlay — macOS: enable Accessibility for the app that launches Electron (e.g. Terminal, iTerm, or Node) in System Settings → Privacy & Security → Accessibility.',
      );
      try {
        systemPreferences.isTrustedAccessibilityClient(true);
      } catch {
        /* ignore */
      }
    } else {
      console.error(
        'CopyHub overlay — shortcut still failed: try Input Source US/QWERTY (Electron globalShortcut quirk on macOS), pick another chord in config, or open from the menu bar icon.',
      );
    }
  }
  return { accelerator: '', usedFallback: false };
}

/**
 * macOS often drops Electron globalShortcut listeners (sleep/wake or while running); re-register.
 * @param {{ silentSuccess?: boolean }} [opts] — omit success log for periodic refresh noise
 */
function reregisterOverlayHotkeys(opts = {}) {
  const silentSuccess = Boolean(opts.silentSuccess);
  const prev = overlayHotkeyMeta.accelerator;
  if (prev) {
    try {
      globalShortcut.unregister(prev);
    } catch {
      /* ignore */
    }
  }
  const { accelerator, usedFallback } = registerHotkeys();
  overlayHotkeyMeta = {
    accelerator,
    usedFallback,
    requestedRaw:
      process.env.COPYHUB_OVERLAY_ACCELERATOR?.trim() ||
      loadOverlayAcceleratorFromConfigSync() ||
      '',
  };
  if (accelerator) {
    if (!silentSuccess) {
      console.log('[CopyHub overlay] Shortcut active again:', accelerator);
    }
  } else {
    console.warn(
      '[CopyHub overlay] Shortcut re-registration failed — open from menu bar or restart CopyHub.',
    );
  }
  refreshTrayContextMenu();
}

/** Detect shortcut unregistered while process still runs (common on macOS without sleep). */
function startGlobalShortcutHealthMonitor() {
  const intervalMs = process.platform === 'darwin' ? 45_000 : 120_000;
  setInterval(() => {
    const acc = overlayHotkeyMeta.accelerator;
    if (!acc || !gotLock) return;
    try {
      if (!globalShortcut.isRegistered(acc)) {
        console.warn('[CopyHub overlay] Global shortcut registration lost — repairing.');
        reregisterOverlayHotkeys({ silentSuccess: false });
      }
    } catch (e) {
      console.warn(
        '[CopyHub overlay] Shortcut health check failed:',
        /** @type {Error} */ (e).message,
      );
    }
  }, intervalMs);
}

/** Proactive refresh: Electron/macOS can leave shortcuts broken while isRegistered stays true. */
function startDarwinShortcutKeepalive() {
  if (process.platform !== 'darwin') return;
  const periodMs = 8 * 60 * 1000;
  setInterval(() => {
    reregisterOverlayHotkeys({ silentSuccess: true });
  }, periodMs);
}

function mergeHistoryForOverlay(localItems, sheetItems, cap) {
  const seen = new Set();
  /** @type {typeof localItems} */
  const out = [];
  /** Sheet rows first so duplicates dedupe keeps sheet metadata when timestamps tie. */
  const combined = [...sheetItems, ...localItems];
  combined.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
  for (const it of combined) {
    const key = `${it.ts}\u0000${it.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.slice(0, cap);
}

/** @type {{ merged: Array<{ ts: string, text: string, synced: boolean }> }} */
const historyMergedCache = {
  merged: [],
};

/** Recent local lines only — Sheet supplies older / cross-device rows so they are not crowded out. */
const HISTORY_LOCAL_LINES = 700;
/** Max merged entries after dedupe (pagination slices this list). */
const HISTORY_MERGE_CAP = 4000;

/** @type {{ sheetFetched: number, sheetHint: string }} */
let lastHistorySheetMeta = { sheetFetched: 0, sheetHint: '' };

/** Sequential Sheet fetch: one daily tab per step until overlay has enough merged rows. */
let sheetIncrementalState = {
  accumulatedItems: [],
  nextDaysAgo: 0,
  daysBackLimit: 30,
  exhausted: false,
  maxRowsPerTab: 500,
};

function resetSheetIncrementalState() {
  sheetIncrementalState = {
    accumulatedItems: [],
    nextDaysAgo: 0,
    daysBackLimit: 30,
    exhausted: false,
    maxRowsPerTab: 500,
  };
}

async function fetchNextDailyTabIntoState() {
  if (sheetIncrementalState.exhausted) return;
  if (sheetIncrementalState.nextDaysAgo > sheetIncrementalState.daysBackLimit) {
    sheetIncrementalState.exhausted = true;
    return;
  }
  try {
    const items = await fetchOverlayDailyTabRows(
      sheetIncrementalState.nextDaysAgo,
      sheetIncrementalState.maxRowsPerTab,
    );
    sheetIncrementalState.accumulatedItems.push(...items);
    sheetIncrementalState.accumulatedItems.sort(
      (a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0),
    );
    if (sheetIncrementalState.accumulatedItems.length > HISTORY_MERGE_CAP) {
      sheetIncrementalState.accumulatedItems =
        sheetIncrementalState.accumulatedItems.slice(0, HISTORY_MERGE_CAP);
    }
  } catch (e) {
    const msg = /** @type {Error} */ (e).message || String(e);
    lastHistorySheetMeta.sheetHint = `Google Sheet error: ${msg.slice(0, 140)}`;
    console.warn('[CopyHub overlay]', lastHistorySheetMeta.sheetHint);
    sheetIncrementalState.exhausted = true;
    return;
  }
  sheetIncrementalState.nextDaysAgo += 1;
}

/**
 * Ensure merged history covers at least `page * pageSize` items (capped), fetching extra Sheet tabs only if needed.
 */
async function ensureMergedHistoryCoversPage(page, pageSize) {
  const localItems = buildLocalHistoryItems();
  const sheetTarget = await loadSheetSyncTarget();
  const tok = await loadTokens();
  const sheetOk =
    Boolean(sheetTarget) && Boolean(tok?.refresh_token || tok?.access_token);

  if (!sheetOk) {
    if (!sheetTarget) {
      lastHistorySheetMeta = {
        sheetFetched: 0,
        sheetHint: 'Google Sheet: not configured — run copyhub login',
      };
    } else {
      lastHistorySheetMeta = {
        sheetFetched: 0,
        sheetHint: 'Google Sheet: not signed in — run copyhub login',
      };
    }
    sheetIncrementalState.exhausted = true;
    historyMergedCache.merged = mergeHistoryForOverlay(localItems, [], HISTORY_MERGE_CAP);
    return;
  }

  const targetMin = Math.min(page * pageSize, HISTORY_MERGE_CAP);

  while (true) {
    const merged = mergeHistoryForOverlay(
      localItems,
      sheetIncrementalState.accumulatedItems,
      HISTORY_MERGE_CAP,
    );
    historyMergedCache.merged = merged;

    if (merged.length >= HISTORY_MERGE_CAP) break;
    if (sheetIncrementalState.exhausted) break;
    /** Merge Sheet at least once when configured so dedupe / synced flags match Sheet. */
    if (merged.length >= targetMin && sheetIncrementalState.nextDaysAgo > 0) break;

    await fetchNextDailyTabIntoState();
  }

  const preservedErr =
    typeof lastHistorySheetMeta.sheetHint === 'string' &&
    lastHistorySheetMeta.sheetHint.startsWith('Google Sheet error:');

  lastHistorySheetMeta.sheetFetched = sheetIncrementalState.accumulatedItems.length;

  if (!preservedErr) {
    if (!sheetIncrementalState.exhausted) {
      lastHistorySheetMeta.sheetHint = `Google Sheet: ${sheetIncrementalState.accumulatedItems.length} rows · more when you page`;
    } else if (sheetIncrementalState.accumulatedItems.length === 0) {
      lastHistorySheetMeta.sheetHint =
        'Google Sheet: 0 rows in last 31 days (check COPYHUB-YYYY-MM-DD tabs / timezone)';
    } else {
      lastHistorySheetMeta.sheetHint = `Google Sheet: ${sheetIncrementalState.accumulatedItems.length} rows loaded`;
    }
  }
}

function buildLocalHistoryItems() {
  return readRecentHistorySync(HISTORY_LOCAL_LINES).map((row) => ({
    ts: row.ts || '',
    text: typeof row.text === 'string' ? row.text : '',
    synced: Boolean(row.syncedToSheet || row.syncedToGmail),
  }));
}

/** @param {ReturnType<typeof buildLocalHistoryItems>} items */
function paginateHistoryItems(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  };
}

function registerIpc() {
  ipcMain.handle('overlay:meta', () => ({
    ...overlayHotkeyMeta,
    platform: process.platform,
    defaultAccelerator: DEFAULT_ACCEL,
    sticky: STICKY_NO_BLUR,
  }));

  /** Fast path: local history.jsonl only (overlay shows this while Sheet loads). */
  ipcMain.handle('history:getLocal', (_e, opts = {}) => {
    try {
      const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10, 1), 50);
      let page = Math.max(Number(opts.page) || 1, 1);
      const localItems = buildLocalHistoryItems();
      const paginated = paginateHistoryItems(localItems, page, pageSize);
      return {
        ...paginated,
        provisional: true,
        sheetHint:
          localItems.length > 0
            ? 'Showing local copies · loading Google Sheet…'
            : 'Loading Google Sheet…',
        sheetFetched: 0,
        sheetHasMore: false,
      };
    } catch (e) {
      return {
        error: /** @type {Error} */ (e).message,
        items: [],
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        provisional: true,
        sheetHint: '',
        sheetFetched: 0,
        sheetHasMore: false,
      };
    }
  });

  ipcMain.handle('history:get', async (_e, opts = {}) => {
    try {
      const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10, 1), 50);
      let page = Math.max(Number(opts.page) || 1, 1);
      const refresh = Boolean(opts.refresh);

      if (refresh) {
        resetSheetIncrementalState();
        lastHistorySheetMeta = { sheetFetched: 0, sheetHint: '' };
        historyMergedCache.merged = [];
      }

      await ensureMergedHistoryCoversPage(page, pageSize);

      const total = historyMergedCache.merged.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(page, totalPages);
      const start = (page - 1) * pageSize;
      const items = historyMergedCache.merged.slice(start, start + pageSize);

      return {
        items,
        page,
        pageSize,
        total,
        totalPages,
        sheetHint: lastHistorySheetMeta.sheetHint,
        sheetFetched: lastHistorySheetMeta.sheetFetched,
        sheetHasMore: !sheetIncrementalState.exhausted,
      };
    } catch (e) {
      return {
        error: /** @type {Error} */ (e).message,
        items: [],
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
        sheetHint: '',
        sheetFetched: 0,
        sheetHasMore: false,
      };
    }
  });

  ipcMain.handle('history:copy', (_e, text) => {
    if (typeof text === 'string') {
      clipboard.writeText(text);
    }
    win?.hide();
    return true;
  });
}

function buildTrayMenuTemplate() {
  const accLabel = overlayHotkeyMeta.accelerator
    ? `Shortcut: ${overlayHotkeyMeta.accelerator}`
    : 'Shortcut: (see terminal)';
  return [
    { label: accLabel, enabled: false },
    { label: 'Open history (always on top)', click: () => toggleOverlay() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function refreshTrayContextMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
  } catch (e) {
    console.warn(
      '[CopyHub overlay] Tray menu refresh failed:',
      /** @type {Error} */ (e).message,
    );
  }
}

function registerTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhn1IGOMJoAmBGOSMDEwMmABWDWHJjBCSpBKGBSDjBAAAeoRBIEs/x0AAAAASUVORK5CYII=',
  );
  tray = new Tray(icon);
  tray.setToolTip('CopyHub overlay');
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
  tray.on('click', () => toggleOverlay());
}

if (gotLock) {
  app.on('second-instance', () => {
    toggleOverlay();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    registerIpc();

    const { accelerator, usedFallback } = registerHotkeys();
    overlayHotkeyMeta = {
      accelerator,
      usedFallback,
      requestedRaw:
        process.env.COPYHUB_OVERLAY_ACCELERATOR?.trim() ||
        loadOverlayAcceleratorFromConfigSync() ||
        '',
    };
    if (accelerator) {
      console.log('CopyHub overlay — shortcut in use:', accelerator);
      console.log('Default shortcut: Control+Shift+H (⌃ or Ctrl + Shift + H).');
      if (usedFallback) {
        console.warn(
          'COPYHUB_OVERLAY_ACCELERATOR could not be registered. Using default Control+Shift+H.',
        );
        console.warn('Leave COPYHUB_OVERLAY_ACCELERATOR unset to use the default Control+Shift+H.');
      }
    } else {
      console.error(
        'Could not register a global shortcut. Open history from the tray or taskbar icon.',
      );
    }

    console.log(
      STICKY_NO_BLUR
        ? 'COPYHUB_OVERLAY_STICKY=1 — window does not close on outside click (Esc / row pick only).'
        : 'Overlay: opens near cursor; click outside the window to close. Esc closes too. COPYHUB_OVERLAY_STICKY=1 keeps it open on blur.',
    );
    console.log(
      HIDE_ON_START
        ? 'COPYHUB_OVERLAY_HIDE_ON_START=1 — window opens only via shortcut / tray.'
        : 'Window shows on startup; check taskbar or tray if you do not see it.',
    );

    try {
      registerTray();
    } catch (e) {
      console.warn('Could not create system tray icon:', /** @type {Error} */ (e).message);
    }

    /** Delay slightly so macOS finishes restoring input / accessibility after wake. */
    powerMonitor.on('resume', () => {
      setTimeout(() => reregisterOverlayHotkeys({ silentSuccess: false }), 400);
    });

    startGlobalShortcutHealthMonitor();
    startDarwinShortcutKeepalive();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

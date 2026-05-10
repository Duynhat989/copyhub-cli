import 'dotenv/config';
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
} from 'electron';
import { readRecentHistorySync } from '../src/storage.js';
import { loadOverlayAcceleratorFromConfigSync } from '../src/config.js';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Set to 1 so the window does not hide on blur (only Esc / pick row to copy). */
const STICKY_NO_BLUR = process.env.COPYHUB_OVERLAY_STICKY === '1';

/** Electron Accelerator: use `Control`, not `Ctrl`; `CommandOrControl` = Ctrl (Win) / Cmd (Mac). */
function normalizeAccelerator(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  s = s.replace(/\bCtrl\b/gi, 'Control');
  s = s.replace(/\bCmd\b/gi, 'Command');
  s = s.replace(/\s*\+\s*/g, '+');
  return s;
}

const DEFAULT_ACCEL = 'CommandOrControl+Shift+H';
const HIDE_ON_START = process.env.COPYHUB_OVERLAY_HIDE_ON_START === '1';

/** Overlay width (~70% of 460px baseline). */
const OVERLAY_WIDTH = Math.round(460 * 0.7);

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

function createWindow() {
  win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: 540,
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
    applyAlwaysOnTopStack(win);
    win.focus();
    win.webContents.send('overlay:open');
    setTimeout(() => {
      applyAlwaysOnTopStack(win);
      blurHideEnabled = true;
    }, 800);
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
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    blurHideEnabled = false;
    placeWindowAtCursor(win);
    win.show();
    applyAlwaysOnTopStack(win);
    win.focus();
    win.webContents.send('overlay:open');
    setTimeout(() => {
      applyAlwaysOnTopStack(win);
      blurHideEnabled = true;
    }, 800);
  }
}

/**
 * Register global shortcut: try .env (normalized) then default CommandOrControl+Shift+H.
 * @returns {{ accelerator: string, usedFallback: boolean }}
 */
function registerHotkeys() {
  const raw =
    process.env.COPYHUB_OVERLAY_ACCELERATOR?.trim() ||
    loadOverlayAcceleratorFromConfigSync();
  const candidates = [];
  if (raw) {
    const n = normalizeAccelerator(raw);
    if (n) candidates.push(n);
  }
  candidates.push(DEFAULT_ACCEL);

  let usedFallback = false;
  for (let i = 0; i < candidates.length; i++) {
    const acc = candidates[i];
    try {
      if (globalShortcut.register(acc, () => toggleOverlay())) {
        if (i > 0) usedFallback = true;
        return { accelerator: acc, usedFallback };
      }
    } catch (e) {
      console.warn('Invalid accelerator:', acc, /** @type {Error} */ (e).message);
    }
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* ignore */
    }
  }
  return { accelerator: '', usedFallback: false };
}

function registerIpc() {
  ipcMain.handle('overlay:meta', () => ({
    ...overlayHotkeyMeta,
    platform: process.platform,
    defaultAccelerator: DEFAULT_ACCEL,
    sticky: STICKY_NO_BLUR,
  }));

  ipcMain.handle('history:get', () => {
    try {
      return {
        items: readRecentHistorySync(200).map((row) => ({
          ts: row.ts || '',
          text: typeof row.text === 'string' ? row.text : '',
          synced: Boolean(row.syncedToSheet || row.syncedToGmail),
        })),
      };
    } catch (e) {
      return { error: /** @type {Error} */ (e).message, items: [] };
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

function registerTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhn1IGOMJoAmBGOSMDEwMmABWDWHJjBCSpBKGBSDjBAAAeoRBIEs/x0AAAAASUVORK5CYII=',
  );
  tray = new Tray(icon);
  tray.setToolTip('CopyHub overlay');
  const accLabel = overlayHotkeyMeta.accelerator
    ? `Shortcut: ${overlayHotkeyMeta.accelerator}`
    : 'Shortcut: (see terminal)';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: accLabel, enabled: false },
      { label: 'Open history (always on top)', click: () => toggleOverlay() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
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
      console.log('Windows tip: Ctrl+Shift+H (CommandOrControl+Shift+H).');
      if (usedFallback) {
        console.warn(
          'COPYHUB_OVERLAY_ACCELERATOR could not be registered. Using default CommandOrControl+Shift+H.',
        );
        console.warn('Leave COPYHUB_OVERLAY_ACCELERATOR unset in .env to always use Ctrl+Shift+H.');
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
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

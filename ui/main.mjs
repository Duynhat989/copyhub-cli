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

/** Đặt 1 để cửa sổ không tự ẩn khi click ra ngoài (chỉ Esc / chọn dòng copy). */
const STICKY_NO_BLUR = process.env.COPYHUB_OVERLAY_STICKY === '1';

/** Electron Accelerator: dùng `Control` không viết `Ctrl`; `CommandOrControl` = Ctrl (Win) / Cmd (Mac). */
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

/** Chiều ngang cửa overlay (~70% so với 460px). */
const OVERLAY_WIDTH = Math.round(460 * 0.7);

/** Cho UI / IPC: phím đã đăng ký và phím bạn gõ trong .env */
let overlayHotkeyMeta = {
  accelerator: '',
  usedFallback: false,
  requestedRaw: '',
};

let win = null;
let tray = null;
/** Tránh ẩn ngay khi vừa mở (WM). */
let blurHideEnabled = false;

/**
 * Luôn trên cùng mọi app: mức screen-saver (cao nhất Electron), moveTop, hiện trên mọi workspace.
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
    /* một số bản Linux không hỗ trợ */
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
    /** Không khung: bỏ title bar + menu (Windows/macOS). */
    frame: false,
    roundedCorners: true,
    /** Hiện trên taskbar để dễ tìm cửa sổ (đặt COPYHUB_OVERLAY_SKIP_TASKBAR=1 để ẩn khỏi taskbar). */
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
 * Đặt cửa sổ gần vị trí chuột (màn hình chứa con trỏ).
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
 * Đăng ký phím tắt: thử .env (đã chuẩn hóa) rồi mặc định CommandOrControl+Shift+H.
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
      console.warn('Accelerator không hợp lệ:', acc, /** @type {Error} */ (e).message);
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
    ? `Phím tắt: ${overlayHotkeyMeta.accelerator}`
    : 'Phím tắt: (xem terminal)';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: accLabel, enabled: false },
      { label: 'Mở lịch sử (luôn trên cùng)', click: () => toggleOverlay() },
      { type: 'separator' },
      { label: 'Thoát', click: () => app.quit() },
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
      console.log('CopyHub overlay — phím tắt đang dùng:', accelerator);
      console.log('Gợi ý Windows: Ctrl+Shift+H (CommandOrControl+Shift+H).');
      if (usedFallback) {
        console.warn(
          'Phím COPYHUB_OVERLAY_ACCELERATOR không đăng ký được. Đã dùng mặc định CommandOrControl+Shift+H.',
        );
        console.warn('Để trống COPYHUB_OVERLAY_ACCELERATOR trong .env = luôn dùng Ctrl+Shift+H.');
      }
    } else {
      console.error(
        'Không đăng ký được phím tắt. Mở lịch sử bằng icon khay hoặc taskbar (CopyHub — Lịch sử).',
      );
    }

    console.log(
      STICKY_NO_BLUR
        ? 'COPYHUB_OVERLAY_STICKY=1 — cửa sổ không tự đóng khi click ngoài (chỉ Esc / chọn dòng).'
        : 'Overlay: mở gần chuột; click ra ngoài cửa sổ để đóng. Esc cũng đóng. COPYHUB_OVERLAY_STICKY=1 để bám (không đóng khi blur).',
    );
    console.log(
      HIDE_ON_START
        ? 'COPYHUB_OVERLAY_HIDE_ON_START=1 — cửa sổ chỉ mở bằng phím / khay.'
        : 'Cửa sổ mở khi khởi động; tìm trên taskbar hoặc khay nếu không thấy.',
    );

    try {
      registerTray();
    } catch (e) {
      console.warn('Không tạo được icon khay hệ thống:', /** @type {Error} */ (e).message);
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

import { platform } from 'node:os';

/** Chu kỳ poll clipboard (ms). Ưu tiên biến môi trường COPYHUB_POLL_MS. */
export function clipboardPollIntervalMs() {
  const raw = process.env.COPYHUB_POLL_MS;
  if (!raw) return 400;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 100 && n <= 60_000 ? n : 400;
}

/** In một dòng gợi ý khi chạy trên Linux (clipboard phụ thuộc X11/Wayland). */
export function logLinuxClipboardHint() {
  if (platform() !== 'linux') return;
  console.log(
    'Linux: cần phiên GUI (DISPLAY hoặc WAYLAND_DISPLAY). Nếu không đọc được clipboard, cài xclip, xsel hoặc wl-clipboard (tuỳ X11/Wayland).',
  );
}

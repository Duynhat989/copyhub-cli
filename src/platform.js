import { platform } from 'node:os';

/** Clipboard poll interval (ms). Env COPYHUB_POLL_MS overrides default. */
export function clipboardPollIntervalMs() {
  const raw = process.env.COPYHUB_POLL_MS;
  if (!raw) return 400;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 100 && n <= 60_000 ? n : 400;
}

/** Log a one-line hint on Linux (clipboard depends on X11/Wayland). */
export function logLinuxClipboardHint() {
  if (platform() !== 'linux') return;
  console.log(
    'Linux: needs a GUI session (DISPLAY or WAYLAND_DISPLAY). If clipboard fails, install xclip, xsel, or wl-clipboard (X11 vs Wayland).',
  );
}

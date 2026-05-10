import clipboardy from 'clipboardy';
import { createHash } from 'node:crypto';
import { clipboardPollIntervalMs } from './platform.js';

function hashText(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * @param {(text: string) => void | Promise<void>} onNewCopy
 * @param {{ pollMs?: number }} [options]
 * @returns {{ stop: () => void }}
 */
export function startClipboardWatcher(onNewCopy, options = {}) {
  const pollMs = typeof options.pollMs === 'number' ? options.pollMs : clipboardPollIntervalMs();
  let lastHash = '';
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const text = await clipboardy.read();
      if (typeof text !== 'string' || text.length === 0) return;
      const h = hashText(text);
      if (h === lastHash) return;
      lastHash = h;
      await onNewCopy(text);
    } catch {
      // Bỏ qua lỗi đọc clipboard tạm thời
    }
  };

  const id = setInterval(() => {
    void tick();
  }, pollMs);

  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(id);
    },
  };
}

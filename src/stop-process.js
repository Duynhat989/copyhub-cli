import { execSync } from 'node:child_process';

/**
 * Dừng tiến trình và (Windows) toàn bộ cây con (Electron overlay).
 * @param {number} pid
 */
export function killDaemonTree(pid) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

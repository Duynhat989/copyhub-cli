import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { RUN_STATE_PATH } from './paths.js';

/**
 * @typedef {{ pid: number, startedAt: string, foreground?: boolean }} RunState
 */

/** @returns {RunState | null} */
export function readRunState() {
  if (!existsSync(RUN_STATE_PATH)) return null;
  try {
    const j = JSON.parse(readFileSync(RUN_STATE_PATH, 'utf8'));
    if (typeof j.pid !== 'number' || !Number.isFinite(j.pid)) return null;
    return j;
  } catch {
    return null;
  }
}

/** @param {RunState} state */
export function writeRunState(state) {
  writeFileSync(RUN_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export function clearRunState() {
  if (!existsSync(RUN_STATE_PATH)) return;
  try {
    unlinkSync(RUN_STATE_PATH);
  } catch {
    /* ignore */
  }
}

/** @param {number} pid */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Xóa run.json nếu PID trong file không còn sống (dọn rác). */
export function pruneStaleRunState() {
  const s = readRunState();
  if (!s) return;
  if (!isPidAlive(s.pid)) {
    clearRunState();
  }
}

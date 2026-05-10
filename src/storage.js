import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { DIR, HISTORY_PATH } from './paths.js';

export async function ensureDir() {
  const opts = { recursive: true };
  if (process.platform !== 'win32') {
    Object.assign(opts, { mode: 0o700 });
  }
  await mkdir(DIR, opts);
}

/**
 * @param {{ text: string, syncedToSheet?: boolean }} entry
 */
export async function appendHistory(entry) {
  await ensureDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    text: entry.text,
    syncedToSheet: Boolean(entry.syncedToSheet),
  }) + '\n';
  await appendFile(HISTORY_PATH, line, 'utf8');
}

export async function readRecentHistory(maxLines = 50) {
  if (!existsSync(HISTORY_PATH)) return [];
  const raw = await readFile(HISTORY_PATH, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  return lines.slice(-maxLines).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * Newest items first (for Electron overlay).
 * @param {number} [maxLines]
 * @returns {Array<{ ts?: string, text?: string, syncedToSheet?: boolean }>}
 */
export function readRecentHistorySync(maxLines = 200) {
  if (!existsSync(HISTORY_PATH)) return [];
  const raw = readFileSync(HISTORY_PATH, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const slice = lines.slice(-maxLines);
  /** @type {Array<{ ts?: string, text?: string, syncedToSheet?: boolean }>} */
  const out = [];
  for (const l of slice) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return out.reverse();
}

/**
 * True when `text` equals the latest saved history row (skip consecutive identical copies).
 * @param {string} text
 */
export function isDuplicateOfLatestHistory(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  const recent = readRecentHistorySync(1);
  const last = recent[0];
  return typeof last?.text === 'string' && last.text === text;
}

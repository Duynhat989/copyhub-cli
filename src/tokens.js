import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { TOKENS_PATH } from './paths.js';
import { ensureDir } from './storage.js';

/** @typedef {{ access_token?: string, refresh_token?: string, scope?: string, token_type?: string, expiry_date?: number }} TokenSet */

/** @returns {Promise<TokenSet | null>} */
export async function loadTokens() {
  if (!existsSync(TOKENS_PATH)) return null;
  const raw = await readFile(TOKENS_PATH, 'utf8');
  return JSON.parse(raw);
}

/** @param {TokenSet} tokens */
export async function saveTokens(tokens) {
  await ensureDir();
  await writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

export async function clearTokens() {
  if (!existsSync(TOKENS_PATH)) return;
  await writeFile(TOKENS_PATH, '{}', 'utf8');
}

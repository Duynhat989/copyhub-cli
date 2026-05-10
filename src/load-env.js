import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Merge `.env` files into `process.env` without overwriting shell-exported vars.
 * Order (later wins among files only): package directory → ~/.copyhub/.env → cwd.
 * Fixes global `copyhub login` when cwd has no `.env` (dotenv/config default looks only at cwd).
 */
export function loadCopyhubEnv() {
  const pkgRoot = join(__dirname, '..');
  const paths = [
    join(pkgRoot, '.env'),
    join(DIR, '.env'),
    join(process.cwd(), '.env'),
  ];

  /** @type {Record<string, string>} */
  const merged = {};
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      Object.assign(merged, dotenv.parse(raw));
    } catch {
      /* ignore unreadable or malformed .env */
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

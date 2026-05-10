import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DIR } from './paths.js';

/** Delete the entire ~/.copyhub directory (all local CopyHub data). */
export async function wipeCopyhubDirectory() {
  if (existsSync(DIR)) {
    await rm(DIR, { recursive: true, force: true });
  }
}

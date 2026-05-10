import { homedir } from 'node:os';
import { join } from 'node:path';

export const DIR = join(homedir(), '.copyhub');
export const CONFIG_PATH = join(DIR, 'config.json');
export const TOKENS_PATH = join(DIR, 'tokens.json');
export const HISTORY_PATH = join(DIR, 'history.jsonl');
/** Background copyhub start process state (JSON: pid, startedAt, ...) */
export const RUN_STATE_PATH = join(DIR, 'run.json');

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from './paths.js';
import { ensureDir } from './storage.js';

/**
 * @typedef {{ clientId: string, clientSecret: string, redirectPort: number }} CopyHubConfig
 */

/** Default localhost port for OAuth browser callback. */
export const DEFAULT_OAUTH_REDIRECT_PORT = 19999;

export const ENV_GOOGLE_CLIENT_ID = 'COPYHUB_GOOGLE_CLIENT_ID';
export const ENV_GOOGLE_CLIENT_SECRET = 'COPYHUB_GOOGLE_CLIENT_SECRET';
export const ENV_OAUTH_REDIRECT_PORT = 'COPYHUB_OAUTH_REDIRECT_PORT';

function parseRedirectPortFromEnv() {
  const raw = process.env[ENV_OAUTH_REDIRECT_PORT]?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}

/**
 * Strip invisible / stray characters from pasted OAuth credentials (fixes many Mac copy-paste issues).
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeOAuthCredentialInput(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.replace(/^\uFEFF/, '');
  s = s.replace(/[\u200b-\u200d\u2060]/g, '');
  s = s.replace(/\r/g, '');
  s = s.replace(/[\u00a0\u202f\u2007]/g, ' ');
  s = s.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (
    (s.startsWith('\u201c') && s.endsWith('\u201d')) ||
    (s.startsWith('\u2018') && s.endsWith('\u2019'))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Port for the OAuth HTTP listener (env wins, then saved config, then default).
 * Does not require Client ID / Secret (used before credential bootstrap).
 */
export function resolveOAuthListenPort() {
  const envPort = parseRedirectPortFromEnv();
  if (envPort != null) return envPort;
  if (existsSync(CONFIG_PATH)) {
    try {
      const j = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      if (typeof j.redirectPort === 'number' && Number.isFinite(j.redirectPort)) {
        return j.redirectPort;
      }
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_OAUTH_REDIRECT_PORT;
}

/** Both Client ID and Secret come from environment (or .env). */
export function hasOAuthCredentialsInEnv() {
  const id = sanitizeOAuthCredentialInput(process.env[ENV_GOOGLE_CLIENT_ID]);
  const sec = sanitizeOAuthCredentialInput(process.env[ENV_GOOGLE_CLIENT_SECRET]);
  return Boolean(id && sec);
}

/**
 * Matches {@link loadConfig}: saved config.json pair wins over env when both are complete.
 * @returns {string}
 */
export function describeEffectiveOAuthCredentialSource() {
  let filePair = false;
  if (existsSync(CONFIG_PATH)) {
    try {
      const j = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      const id =
        typeof j.clientId === 'string' ? sanitizeOAuthCredentialInput(j.clientId) : '';
      const sec =
        typeof j.clientSecret === 'string' ? sanitizeOAuthCredentialInput(j.clientSecret) : '';
      filePair = Boolean(id && sec);
    } catch {
      /* ignore */
    }
  }
  const envPair = hasOAuthCredentialsInEnv();

  if (filePair) {
    return envPair
      ? `${CONFIG_PATH} (env COPYHUB_GOOGLE_* ignored for Client ID/Secret)`
      : CONFIG_PATH;
  }
  if (envPair) return 'environment / .env (COPYHUB_GOOGLE_CLIENT_ID + SECRET)';
  return '(none)';
}

/**
 * OAuth credentials: use env pair OR file pair only — never mix ID from one source with secret from another (Google returns invalid_client).
 * @returns {Promise<CopyHubConfig | null>}
 */
export async function loadConfig() {
  /** @type {{ clientId?: string, clientSecret?: string, redirectPort?: number }} */
  const fromFile = {};

  if (existsSync(CONFIG_PATH)) {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const j = JSON.parse(raw);
    if (typeof j.clientId === 'string') {
      const id = sanitizeOAuthCredentialInput(j.clientId);
      if (id) fromFile.clientId = id;
    }
    if (typeof j.clientSecret === 'string') {
      const sec = sanitizeOAuthCredentialInput(j.clientSecret);
      if (sec) fromFile.clientSecret = sec;
    }
    if (typeof j.redirectPort === 'number' && Number.isFinite(j.redirectPort)) {
      fromFile.redirectPort = j.redirectPort;
    }
  }

  const envId = sanitizeOAuthCredentialInput(process.env[ENV_GOOGLE_CLIENT_ID]);
  const envSecret = sanitizeOAuthCredentialInput(process.env[ENV_GOOGLE_CLIENT_SECRET]);
  const envPort = parseRedirectPortFromEnv();

  const filePort =
    typeof fromFile.redirectPort === 'number'
      ? fromFile.redirectPort
      : DEFAULT_OAUTH_REDIRECT_PORT;
  const redirectPort = envPort ?? filePort;

  let clientId;
  let clientSecret;

  /**
   * Prefer ~/.copyhub/config.json when it holds a full OAuth pair (wizard / copyhub config).
   * Otherwise many machines still have COPYHUB_GOOGLE_* in shell or ~/.copyhub/.env from a template —
   * those used to override fresh wizard credentials and caused invalid_client on the callback.
   */
  if (fromFile.clientId && fromFile.clientSecret) {
    clientId = fromFile.clientId;
    clientSecret = fromFile.clientSecret;
  } else if (envId && envSecret) {
    clientId = envId;
    clientSecret = envSecret;
  } else {
    return null;
  }

  return { clientId, clientSecret, redirectPort };
}

/**
 * @typedef {{ spreadsheetId: string }} SheetSyncTarget
 */

/** @returns {Promise<SheetSyncTarget | null>} */
export async function loadSheetSyncTarget() {
  /** @type {{ googleSheetId?: string }} */
  let fromFile = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf8');
      const j = JSON.parse(raw);
      if (typeof j.googleSheetId === 'string' && j.googleSheetId.trim()) {
        fromFile.googleSheetId = j.googleSheetId.trim();
      }
    } catch {
      /* ignore */
    }
  }

  const spreadsheetId = fromFile.googleSheetId;

  if (!spreadsheetId) return null;
  return { spreadsheetId };
}

/**
 * Overlay shortcut (Electron Accelerator). Empty = app default.
 * Env COPYHUB_OVERLAY_ACCELERATOR wins when set, then config.
 */
export function loadOverlayAcceleratorFromConfigSync() {
  if (!existsSync(CONFIG_PATH)) return '';
  try {
    const j = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof j.overlayAccelerator === 'string') {
      return j.overlayAccelerator.trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

/** @returns {'win' | 'mac' | 'linux' | ''} */
export function loadOverlayPlatformFromConfigSync() {
  if (!existsSync(CONFIG_PATH)) return '';
  try {
    const j = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const p = typeof j.overlayPlatform === 'string' ? j.overlayPlatform.trim().toLowerCase() : '';
    if (p === 'win' || p === 'windows') return 'win';
    if (p === 'mac' || p === 'macos' || p === 'darwin') return 'mac';
    if (p === 'linux') return 'linux';
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Merge fields into ~/.copyhub/config.json (keeps existing clientId/secret).
 * @param {Record<string, unknown>} partial
 */
export async function mergeConfigPartial(partial) {
  await ensureDir();
  /** @type {Record<string, unknown>} */
  let existing = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  const out = { ...existing, ...partial };
  delete out.sheetTab;
  delete out.sheetDailyPrefix;
  if (typeof out.clientId === 'string') {
    out.clientId = sanitizeOAuthCredentialInput(out.clientId);
  }
  if (typeof out.clientSecret === 'string') {
    out.clientSecret = sanitizeOAuthCredentialInput(out.clientSecret);
  }
  if (typeof out.googleSheetId === 'string') {
    out.googleSheetId = sanitizeOAuthCredentialInput(out.googleSheetId);
  }
  await writeFile(CONFIG_PATH, JSON.stringify(out, null, 2), 'utf8');
}

/**
 * @param {CopyHubConfig & { googleSheetId?: string }} cfg
 */
export async function saveConfig(cfg) {
  await ensureDir();
  /** @type {Record<string, unknown>} */
  let existing = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
      /* ignore */
    }
  }
  const out = {
    ...existing,
    clientId: sanitizeOAuthCredentialInput(cfg.clientId),
    clientSecret: sanitizeOAuthCredentialInput(cfg.clientSecret),
    redirectPort: cfg.redirectPort ?? DEFAULT_OAUTH_REDIRECT_PORT,
  };
  if (cfg.googleSheetId !== undefined) {
    out.googleSheetId =
      typeof cfg.googleSheetId === 'string'
        ? sanitizeOAuthCredentialInput(cfg.googleSheetId)
        : cfg.googleSheetId;
  }
  delete out.sheetTab;
  delete out.sheetDailyPrefix;
  await writeFile(CONFIG_PATH, JSON.stringify(out, null, 2), 'utf8');
}

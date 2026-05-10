import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from './paths.js';
import { ensureDir } from './storage.js';

/**
 * @typedef {{ clientId: string, clientSecret: string, redirectPort: number }} CopyHubConfig
 */

/** Cổng localhost mặc định cho OAuth (callback trình duyệt). */
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

/** Cả Client ID và Secret đều lấy từ biến môi trường (hoặc .env). */
export function hasOAuthCredentialsInEnv() {
  const id = process.env[ENV_GOOGLE_CLIENT_ID]?.trim();
  const sec = process.env[ENV_GOOGLE_CLIENT_SECRET]?.trim();
  return Boolean(id && sec);
}

/** @returns {'env' | 'file' | 'mixed'} */
export function describeOAuthCredentialSource() {
  const idEnv = Boolean(process.env[ENV_GOOGLE_CLIENT_ID]?.trim());
  const secEnv = Boolean(process.env[ENV_GOOGLE_CLIENT_SECRET]?.trim());
  if (idEnv && secEnv) return 'env';
  if (idEnv || secEnv) return 'mixed';
  return 'file';
}

/** @returns {Promise<CopyHubConfig | null>} */
export async function loadConfig() {
  /** @type {{ clientId?: string, clientSecret?: string, redirectPort?: number }} */
  const fromFile = {};

  if (existsSync(CONFIG_PATH)) {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const j = JSON.parse(raw);
    if (typeof j.clientId === 'string' && j.clientId) fromFile.clientId = j.clientId;
    if (typeof j.clientSecret === 'string' && j.clientSecret) {
      fromFile.clientSecret = j.clientSecret;
    }
    if (typeof j.redirectPort === 'number' && Number.isFinite(j.redirectPort)) {
      fromFile.redirectPort = j.redirectPort;
    }
  }

  const envId = process.env[ENV_GOOGLE_CLIENT_ID]?.trim();
  const envSecret = process.env[ENV_GOOGLE_CLIENT_SECRET]?.trim();
  const envPort = parseRedirectPortFromEnv();

  const clientId = envId || fromFile.clientId;
  const clientSecret = envSecret || fromFile.clientSecret;

  const filePort =
    typeof fromFile.redirectPort === 'number'
      ? fromFile.redirectPort
      : DEFAULT_OAUTH_REDIRECT_PORT;
  const redirectPort = envPort ?? filePort;

  if (!clientId || !clientSecret) return null;

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
 * Phím tắt overlay (Electron Accelerator). Để trống = dùng mặc định trong app.
 * Ưu tiên biến môi trường COPYHUB_OVERLAY_ACCELERATOR (nếu có), sau đó config.
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
 * Gộp một phần vào ~/.copyhub/config.json (giữ clientId/secret hiện có).
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
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    redirectPort: cfg.redirectPort ?? DEFAULT_OAUTH_REDIRECT_PORT,
  };
  if (cfg.googleSheetId !== undefined) out.googleSheetId = cfg.googleSheetId;
  delete out.sheetTab;
  delete out.sheetDailyPrefix;
  await writeFile(CONFIG_PATH, JSON.stringify(out, null, 2), 'utf8');
}

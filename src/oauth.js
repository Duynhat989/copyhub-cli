import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import open from 'open';
import {
  loadConfig,
  DEFAULT_OAUTH_REDIRECT_PORT,
  ENV_GOOGLE_CLIENT_ID,
  ENV_GOOGLE_CLIENT_SECRET,
  ENV_OAUTH_REDIRECT_PORT,
  mergeConfigPartial,
  resolveOAuthListenPort,
  loadSheetSyncTarget,
  loadOverlayAcceleratorFromConfigSync,
  loadOverlayPlatformFromConfigSync,
  sanitizeOAuthCredentialInput,
} from './config.js';
import { saveTokens, loadTokens } from './tokens.js';
import { TOKENS_PATH } from './paths.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

/**
 * @param {import('./config.js').CopyHubConfig} cfg
 */
export function createOAuthClient(cfg) {
  const port = cfg.redirectPort ?? DEFAULT_OAUTH_REDIRECT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  return new OAuth2Client(cfg.clientId, cfg.clientSecret, redirectUri);
}

/**
 * @returns {Promise<import('google-auth-library').OAuth2Client>}
 */
export async function getAuthorizedClient() {
  const cfg = await loadConfig();
  if (!cfg) {
    throw new Error(
      `OAuth is not configured. Set ${ENV_GOOGLE_CLIENT_ID} and ${ENV_GOOGLE_CLIENT_SECRET} (.env or environment), run copyhub config, or copyhub login (browser wizard).`,
    );
  }
  const client = createOAuthClient(cfg);
  const tokens = await loadTokens();
  if (tokens?.refresh_token || tokens?.access_token) {
    client.setCredentials(tokens);
  }
  return client;
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
const MAX_BODY = 32 * 1024;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * User-visible explanation when exchanging auth code for tokens fails (e.g. invalid_client).
 * @param {unknown} err
 */
function formatOAuthTokenExchangeMessage(err) {
  const g = /** @type {{ response?: { data?: { error?: string; error_description?: string } } } } */ (
    err
  );
  const code = g.response?.data?.error;
  const desc = (g.response?.data?.error_description || '').trim();
  const fallback = /** @type {Error} */ (err)?.message || String(err);

  if (code === 'invalid_client') {
    const secretInvalid = /client secret is invalid|invalid_client_secret/i.test(desc);
    const secretHint = secretInvalid
      ? 'Google says the Client Secret is wrong for this Client ID. Open Cloud Console → APIs & Services → Credentials → your Web client → reset secret or download JSON again; paste client_id and client_secret from that JSON into the CopyHub wizard (Safari/Chrome may autofill an old secret — clear fields first). '
      : '';
    return (
      'OAuth invalid_client: Google rejected the Client ID / Client Secret pair. ' +
      secretHint +
      'Use OAuth client type "Web application" and add redirect URI http://127.0.0.1:<port>/oauth2callback (port matches CopyHub). Prefer pasting values from the client\'s Download JSON file to avoid typos. ' +
      'If COPYHUB_GOOGLE_CLIENT_ID / COPYHUB_GOOGLE_CLIENT_SECRET exist in shell or ~/.copyhub/.env, they must match this client or remove both so ~/.copyhub/config.json is used. ' +
      (desc ? `Google says: ${desc}` : `(${fallback})`)
    );
  }

  if (code === 'invalid_grant') {
    return (
      'OAuth invalid_grant: the authorization code expired or was already used. Close extra browser tabs and run copyhub login again.' +
      (desc ? ` ${desc}` : '')
    );
  }

  return desc ? `${code || 'OAuth'}: ${desc}` : fallback;
}

/** @param {string} bodyText */
function oauthTokenExchangeErrorPage(bodyText) {
  const esc = escapeHtml(bodyText);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>CopyHub OAuth error</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f4fa;padding:24px;}
.box{background:#fff;padding:28px 32px;border-radius:14px;max-width:520px;box-shadow:0 4px 24px rgba(20,24,36,.08);line-height:1.55;color:#141824;}
h1{font-size:1.15rem;margin:0 0 12px;}
pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:12px 14px;border-radius:8px;font-size:13px;color:#334155;border:1px solid #e2e8f0;}
code{background:#eff6ff;padding:2px 8px;border-radius:6px;font-size:13px;}
</style></head><body><div class="box"><h1>Could not finish sign-in</h1><pre>${esc}</pre>
<p style="margin-top:16px;color:#64748b;font-size:14px;">Fix the issue, then run <code>copyhub login</code> again.</p></div></body></html>`;
}

/**
 * @param {string} bootstrapToken
 * @param {number} listenPort
 */
function credentialSetupPageHtml(bootstrapToken, listenPort) {
  const tVal = escapeHtml(bootstrapToken);
  const callbackUri = `http://127.0.0.1:${listenPort}/oauth2callback`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CopyHub — Google OAuth credentials</title>
  <style>
    :root {
      --text: #141824;
      --muted: #5a6272;
      --line: #e2e8f1;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --radius: 14px;
      --shadow: 0 4px 24px rgba(20, 24, 36, 0.08), 0 1px 3px rgba(20, 24, 36, 0.04);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(160deg, #e8eef9 0%, #f5f7fb 45%, #eef2f8 100%);
      color: var(--text);
      padding: 32px 16px 48px;
      line-height: 1.55;
    }
    .wrap { max-width: 520px; margin: 0 auto; }
    .brand {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 8px;
    }
    h1 { font-size: 1.55rem; font-weight: 700; margin: 0 0 8px; letter-spacing: -0.02em; }
    .sub { color: var(--muted); font-size: 15px; margin-bottom: 24px; }
    .card {
      background: #fff;
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid rgba(255,255,255,0.8);
      padding: 26px 24px;
      margin-bottom: 18px;
    }
    label.field-label { display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px; }
    input[type="password"], input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      font-size: 15px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fafbfd;
    }
    input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      background: #fff;
    }
    .hint { font-size: 13px; color: var(--muted); margin-top: 10px; line-height: 1.5; }
    .hint code {
      font-size: 12px;
      background: var(--accent-soft);
      color: #1d4ed8;
      padding: 2px 7px;
      border-radius: 6px;
      font-weight: 500;
    }
    button.submit {
      width: 100%;
      margin-top: 20px;
      padding: 14px 20px;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
    }
    button.submit:hover { filter: brightness(1.05); }
    .callback-box {
      font-size: 13px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 10px;
      border: 1px solid var(--line);
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">CopyHub</div>
    <h1>Google Cloud OAuth</h1>
    <p class="sub">Paste your OAuth 2.0 Client ID and Client Secret (same as <code>${ENV_GOOGLE_CLIENT_ID}</code> / <code>${ENV_GOOGLE_CLIENT_SECRET}</code> in <code>.env</code>). Stored in <code>~/.copyhub/config.json</code>. After saving here, CopyHub uses this pair for sign-in — not leftover variables from shell or <code>.env</code>.</p>
    <p class="hint" style="margin-bottom:20px;"><strong>Mac / Safari:</strong> copy from Google Cloud → Credentials → your <strong>Web client</strong> → <strong>Download JSON</strong> and paste <code>client_id</code> / <code>client_secret</code> exactly. Clear both fields if the browser autofills an old secret.</p>

    <div class="card">
      <p class="hint" style="margin-top:0;"><strong>Authorized redirect URI</strong> in Google Cloud Console must include:</p>
      <div class="callback-box"><code>${escapeHtml(callbackUri)}</code></div>
      <p class="hint">Port comes from <code>${ENV_OAUTH_REDIRECT_PORT}</code> (currently <strong>${listenPort}</strong>) or your saved config.</p>
    </div>

    <form method="POST" action="/credentials" autocomplete="off">
      <input type="hidden" name="t" value="${tVal}" />
      <div class="card">
        <label class="field-label" for="cid">Client ID</label>
        <input id="cid" type="text" name="clientId" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" required />
        <label class="field-label" for="csec" style="margin-top:16px;">Client secret</label>
        <input id="csec" type="text" name="clientSecret" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" required placeholder="Usually starts with GOCSPX-" />
      </div>
      <button type="submit" class="submit">Save and continue to Google sign-in</button>
    </form>
  </div>
</body>
</html>`;
}

const credentialSavedHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>CopyHub</title>
<style>
body{font-family:system-ui,sans-serif;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#e8eef9,#f5f7fb);padding:24px;}
.box{background:#fff;padding:32px 36px;border-radius:16px;box-shadow:0 8px 32px rgba(20,24,36,.1);max-width:420px;text-align:center;line-height:1.65;color:#141824;}
.box h2{margin:0 0 12px;font-size:1.25rem;}
.box p{margin:.6rem 0;color:#5a6272;font-size:15px;}
.box code{background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:6px;font-size:13px;}
</style></head>
<body><div class="box"><h2>Credentials saved</h2>
<p>The login flow will open Google next (this tab can stay open).</p></div></body></html>`;

/**
 * Localhost wizard when Client ID / Secret are missing from env and config file.
 * @returns {Promise<void>}
 */
async function runCredentialBootstrap() {
  const listenPort = resolveOAuthListenPort();
  await new Promise((resolve, reject) => {
    /** @type {string | null} */
    let bootstrapToken = randomBytes(24).toString('hex');
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      server.close(() => resolve(undefined));
    };

    const server = createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad request');
          return;
        }
        const u = new URL(req.url, `http://127.0.0.1:${listenPort}`);

        if (u.pathname === '/credentials' && req.method === 'GET') {
          const t = u.searchParams.get('t');
          if (!bootstrapToken || t !== bootstrapToken) {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<p>Invalid session. Run <code>copyhub login</code> again.</p>');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(credentialSetupPageHtml(bootstrapToken, listenPort));
          return;
        }

        if (u.pathname === '/credentials' && req.method === 'POST') {
          let body = '';
          try {
            body = await readRequestBody(req);
          } catch {
            res.writeHead(413);
            res.end('Payload too large');
            return;
          }
          const params = new URLSearchParams(body);
          const t = params.get('t');
          if (!bootstrapToken || t !== bootstrapToken) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }
          const clientId = sanitizeOAuthCredentialInput(params.get('clientId'));
          const clientSecret = sanitizeOAuthCredentialInput(params.get('clientSecret'));
          if (!clientId || !clientSecret) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<p>Client ID and Client secret are required.</p>');
            return;
          }
          try {
            await mergeConfigPartial({ clientId, clientSecret });
          } catch {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<p>Could not write config. Check write permissions on ~/.copyhub/</p>');
            return;
          }
          bootstrapToken = null;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(credentialSavedHtml);
          setTimeout(finish, 400);
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (e) {
        res.writeHead(500);
        res.end('Server error');
        server.close(() => reject(/** @type {Error} */ (e)));
      }
    });

    const idleMs = 20 * 60 * 1000;
    const idleTimer = setTimeout(() => {
      if (!settled) {
        console.warn('Credential setup idle timeout (20 minutes).');
        finish();
      }
    }, idleMs);
    server.on('close', () => clearTimeout(idleTimer));

    server.on('error', (err) => {
      if (!settled) reject(err);
    });

    server.listen(listenPort, '127.0.0.1', async () => {
      const credUrl = `http://127.0.0.1:${listenPort}/credentials?t=${encodeURIComponent(bootstrapToken)}`;
      console.log('Opening browser for Google OAuth credentials (localhost wizard)...');
      console.log(`If it does not open: ${credUrl}`);
      try {
        await open(credUrl);
      } catch {
        console.log('Open this URL manually:');
        console.log(credUrl);
      }
    });
  });
}

/** Shortcut presets (Electron Accelerator) per platform — embedded as JSON in the setup page. */
const PLATFORM_PRESETS = {
  win: [
    { label: 'Ctrl + Shift + H · recommended', value: 'Control+Shift+H' },
    { label: 'Alt + Shift + H', value: 'Alt+Shift+H' },
  ],
  mac: [
    {
      label: '⌃ Control + Shift + H · recommended (Apple & PC keyboards)',
      value: 'Control+Shift+H',
    },
    {
      label: '⌘ Command + Shift + H',
      value: 'Command+Shift+H',
    },
    { label: '⌘ + Shift + V', value: 'Command+Shift+V' },
  ],
  linux: [
    { label: 'Ctrl + Shift + H · recommended', value: 'Control+Shift+H' },
    { label: 'Alt + Shift + H', value: 'Alt+Shift+H' },
  ],
};

/**
 * @param {string} setupToken
 * @param {string} currentSheetId
 * @param {string} currentAccelerator
 * @param {string} currentPlatform win | mac | linux | ''
 */
function setupPageHtml(setupToken, currentSheetId, currentAccelerator, currentPlatform) {
  const idVal = escapeHtml(currentSheetId);
  const accVal = escapeHtml(currentAccelerator);
  const tVal = escapeHtml(setupToken);
  const plat =
    currentPlatform === 'mac' || currentPlatform === 'linux' ? currentPlatform : 'win';
  const platJson = JSON.stringify(plat);
  const presetsJson = JSON.stringify(PLATFORM_PRESETS);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CopyHub — Setup</title>
  <style>
    :root {
      --bg: #f0f4fa;
      --card: #ffffff;
      --text: #141824;
      --muted: #5a6272;
      --line: #e2e8f1;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --radius: 14px;
      --shadow: 0 4px 24px rgba(20, 24, 36, 0.08), 0 1px 3px rgba(20, 24, 36, 0.04);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(160deg, #e8eef9 0%, #f5f7fb 45%, #eef2f8 100%);
      color: var(--text);
      padding: 32px 16px 48px;
      line-height: 1.55;
    }
    .wrap { max-width: 560px; margin: 0 auto; }
    .brand {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 8px;
    }
    h1 {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 8px;
      line-height: 1.25;
    }
    .sub { color: var(--muted); font-size: 15px; margin-bottom: 28px; }
    .card {
      background: var(--card);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      border: 1px solid rgba(255,255,255,0.8);
      padding: 28px 26px 26px;
      margin-bottom: 20px;
    }
    .card h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 0 0 14px;
      font-weight: 600;
    }
    label.field-label {
      display: block;
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 8px;
    }
    input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      font-size: 15px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fafbfd;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      background: #fff;
    }
    .hint {
      font-size: 13px;
      color: var(--muted);
      margin-top: 10px;
      line-height: 1.5;
    }
    .hint code {
      font-size: 12px;
      background: var(--accent-soft);
      color: #1d4ed8;
      padding: 2px 7px;
      border-radius: 6px;
      font-weight: 500;
    }
    .platform-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    @media (max-width: 480px) {
      .platform-row { grid-template-columns: 1fr; }
    }
    .platform-btn {
      appearance: none;
      border: 2px solid var(--line);
      background: #fafbfd;
      border-radius: 12px;
      padding: 14px 12px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .platform-btn:hover {
      border-color: #c7d4ea;
      background: #fff;
    }
    .platform-btn[aria-pressed="true"] {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: #1e40af;
      box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.2);
    }
    .platform-btn .ico { font-size: 22px; line-height: 1; }
    .platform-btn .name { font-size: 13px; }
    .platform-btn .tag { font-size: 11px; font-weight: 500; color: var(--muted); }
    .platform-btn[aria-pressed="true"] .tag { color: #3b82f6; }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      margin-bottom: 6px;
    }
    .chip {
      border: 1px solid var(--line);
      background: #fff;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      color: var(--text);
      transition: background 0.15s, border-color 0.15s;
    }
    .chip:hover {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: #1e40af;
    }
    .sheet-note {
      font-size: 13px;
      color: var(--muted);
      padding: 12px 14px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 10px;
      border: 1px solid var(--line);
      margin-top: 14px;
    }
    .sheet-note strong { color: var(--text); }
    button.submit {
      width: 100%;
      margin-top: 22px;
      padding: 14px 20px;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
      transition: transform 0.1s, box-shadow 0.15s;
    }
    button.submit:hover {
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
      transform: translateY(-1px);
    }
    button.submit:active { transform: translateY(0); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">CopyHub</div>
    <h1>Post-login setup</h1>
    <p class="sub">Saved to <code style="background:#e2e8f0;padding:2px 8px;border-radius:6px;font-size:13px;">~/.copyhub/config.json</code></p>

    <form method="POST" action="/setup">
      <input type="hidden" name="t" value="${tVal}" />
      <input type="hidden" name="overlayPlatform" id="overlayPlatformField" value="${escapeHtml(plat)}" />

      <div class="card">
        <h2>Google Sheet</h2>
        <label class="field-label" for="sid">Spreadsheet ID</label>
        <input id="sid" type="text" name="googleSheetId" value="${idVal}" placeholder="From URL: …/spreadsheets/d/<ID>/edit" autocomplete="off" />
        <p class="hint">Leave blank and fill later if needed. One tab per day named <code>COPYHUB-YYYY-MM-DD</code>.</p>
      </div>

      <div class="card">
        <h2>History overlay shortcut</h2>
        <label class="field-label">Your platform</label>
        <div class="platform-row" role="group" aria-label="Choose operating system">
          <button type="button" class="platform-btn" data-platform="win" aria-pressed="false">
            <span class="ico" aria-hidden="true">⊞</span>
            <span class="name">Windows</span>
            <span class="tag">Electron · Control</span>
          </button>
          <button type="button" class="platform-btn" data-platform="mac" aria-pressed="false">
            <span class="ico" aria-hidden="true">⌘</span>
            <span class="name">macOS</span>
            <span class="tag">⌃ Control default</span>
          </button>
          <button type="button" class="platform-btn" data-platform="linux" aria-pressed="false">
            <span class="ico" aria-hidden="true">🐧</span>
            <span class="name">Linux</span>
            <span class="tag">X11 / Wayland</span>
          </button>
        </div>

        <label class="field-label" for="acc">Accelerator (blank = Control + Shift + H)</label>
        <input id="acc" type="text" name="overlayAccelerator" value="${accVal}" placeholder="Pick a preset below or type your own" autocomplete="off" spellcheck="false" />

        <p class="hint">Default everywhere: <code>Control+Shift+H</code> (⌃ or Ctrl + Shift + H — same key on Mac Apple keyboard & PC keyboard). On Windows type <code>Control</code> in config, not <code>Ctrl</code>. Avoid <code>Control+Alt+…</code> (often grabbed by drivers).</p>
        <p class="hint"><code>COPYHUB_OVERLAY_ACCELERATOR</code> in <code>.env</code>, if set, overrides this value.</p>

        <div id="chipRegion" class="chips" aria-live="polite"></div>
        <p id="platformHint" class="hint" style="margin-top:4px;"></p>

        <div class="sheet-note">
          <strong>Note:</strong> Linux needs a GUI session; you may need <code>xclip</code> / <code>wl-clipboard</code>. macOS may require Accessibility for global shortcuts.
        </div>
      </div>

      <button type="submit" class="submit">Save settings</button>
    </form>
  </div>

  <script>
    (function () {
      var PRESETS = ${presetsJson};
      var initial = ${platJson};
      var field = document.getElementById('overlayPlatformField');
      var acc = document.getElementById('acc');
      var chips = document.getElementById('chipRegion');
      var hintEl = document.getElementById('platformHint');
      var btns = document.querySelectorAll('.platform-btn');

      var hints = {
        win: 'Windows: default Control+Shift+H.',
        mac: 'macOS: default ⌃ Control+Shift+H (same as Ctrl on a PC keyboard). Use a ⌘ preset only if you prefer Command.',
        linux: 'Linux: default Control+Shift+H; clipboard depends on your desktop.'
      };

      function setPlatform(p) {
        field.value = p;
        btns.forEach(function (b) {
          var on = b.getAttribute('data-platform') === p;
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        chips.innerHTML = '';
        (PRESETS[p] || PRESETS.win).forEach(function (item) {
          var el = document.createElement('button');
          el.type = 'button';
          el.className = 'chip';
          el.textContent = item.label;
          el.title = item.value;
          el.addEventListener('click', function () {
            acc.value = item.value;
            acc.focus();
          });
          chips.appendChild(el);
        });
        hintEl.textContent = hints[p] || '';
      }

      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          setPlatform(b.getAttribute('data-platform'));
        });
      });

      setPlatform(initial === 'mac' || initial === 'linux' ? initial : 'win');
    })();
  </script>
</body>
</html>`;
}

const successHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>CopyHub</title>
<style>
body{font-family:system-ui,sans-serif;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#e8eef9,#f5f7fb);padding:24px;}
.box{background:#fff;padding:36px 40px;border-radius:16px;box-shadow:0 8px 32px rgba(20,24,36,.1);max-width:420px;text-align:center;line-height:1.65;color:#141824;}
.box h2{margin:0 0 12px;font-size:1.35rem;}
.box p{margin:.65rem 0;color:#5a6272;font-size:15px;}
.box code{background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:6px;font-size:13px;}
</style></head>
<body><div class="box"><h2>Settings saved</h2>
<p>You can close this tab.</p>
<p>Run <code>copyhub start</code> or restart the overlay to apply the shortcut.</p></div></body></html>`;

/**
 * Open browser for OAuth, then Spreadsheet ID setup page.
 * @returns {Promise<void>}
 */
export async function runLoginFlow() {
  let cfg = await loadConfig();
  if (!cfg) {
    const listenPort = resolveOAuthListenPort();
    try {
      await runCredentialBootstrap();
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e)?.code;
      if (code === 'EADDRINUSE') {
        throw new Error(
          `Port ${listenPort} is already in use. Stop the other process or set ${ENV_OAUTH_REDIRECT_PORT} to a free port.`,
        );
      }
      throw /** @type {Error} */ (e);
    }
    cfg = await loadConfig();
  }
  if (!cfg) {
    throw new Error(
      `OAuth is not configured. Set ${ENV_GOOGLE_CLIENT_ID} and ${ENV_GOOGLE_CLIENT_SECRET} in .env, run copyhub config, or complete the browser credential wizard.`,
    );
  }
  const port = cfg.redirectPort ?? DEFAULT_OAUTH_REDIRECT_PORT;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const oauth2Client = new OAuth2Client(cfg.clientId, cfg.clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  await new Promise((resolve, reject) => {
    /** @type {string | null} */
    let setupToken = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      server.close(() => resolve(undefined));
    };

    const server = createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad request');
          return;
        }
        const u = new URL(req.url, `http://127.0.0.1:${port}`);

        if (u.pathname === '/oauth2callback') {
          const code = u.searchParams.get('code');
          const errParam = u.searchParams.get('error');
          if (errParam) {
            res.writeHead(400);
            res.end(`OAuth error: ${escapeHtml(errParam)}`);
            server.close(() => reject(new Error(errParam)));
            return;
          }
          if (!code) {
            res.writeHead(400);
            res.end('Missing code');
            server.close(() => reject(new Error('Missing authorization code')));
            return;
          }
          let tokens;
          try {
            const exchanged = await oauth2Client.getToken(code);
            tokens = exchanged.tokens;
          } catch (tokenErr) {
            const msg = formatOAuthTokenExchangeMessage(tokenErr);
            console.error('[CopyHub OAuth]', msg);
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(oauthTokenExchangeErrorPage(msg));
            server.close(() => reject(new Error(msg)));
            return;
          }
          oauth2Client.setCredentials(tokens);
          await saveTokens(tokens);
          setupToken = randomBytes(24).toString('hex');
          res.writeHead(302, {
            Location: `http://127.0.0.1:${port}/setup?t=${encodeURIComponent(setupToken)}`,
          });
          res.end();
          return;
        }

        if (u.pathname === '/setup' && req.method === 'GET') {
          const t = u.searchParams.get('t');
          if (!setupToken || t !== setupToken) {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<p>Invalid setup session. Run <code>copyhub login</code> again.</p>');
            return;
          }
          const sheet = await loadSheetSyncTarget();
          const currentId = sheet?.spreadsheetId ?? '';
          const currentAcc = loadOverlayAcceleratorFromConfigSync();
          const currentPlat = loadOverlayPlatformFromConfigSync();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(setupPageHtml(setupToken, currentId, currentAcc, currentPlat));
          return;
        }

        if (u.pathname === '/setup' && req.method === 'POST') {
          let body = '';
          try {
            body = await readRequestBody(req);
          } catch {
            res.writeHead(413);
            res.end('Payload too large');
            return;
          }
          const params = new URLSearchParams(body);
          const t = params.get('t');
          if (!setupToken || t !== setupToken) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }
          const sheetId = (params.get('googleSheetId') || '').trim();
          const overlayAccelerator = (params.get('overlayAccelerator') ?? '').trim();
          let overlayPlatform = (params.get('overlayPlatform') || 'win').trim().toLowerCase();
          if (overlayPlatform === 'windows') overlayPlatform = 'win';
          if (overlayPlatform === 'darwin' || overlayPlatform === 'macos') {
            overlayPlatform = 'mac';
          }
          if (overlayPlatform !== 'win' && overlayPlatform !== 'mac' && overlayPlatform !== 'linux') {
            overlayPlatform = 'win';
          }
          try {
            /** @type {Record<string, unknown>} */
            const partial = { overlayAccelerator, overlayPlatform };
            if (sheetId) partial.googleSheetId = sheetId;
            await mergeConfigPartial(partial);
          } catch {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<p>Could not write config. Check write permissions on ~/.copyhub/</p>');
            return;
          }
          setupToken = null;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(successHtml);
          setTimeout(finish, 400);
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      } catch (e) {
        res.writeHead(500);
        res.end('Server error');
        server.close(() => reject(/** @type {Error} */ (e)));
      }
    });

    const idleMs = 20 * 60 * 1000;
    const idleTimer = setTimeout(() => {
      if (!settled) {
        console.warn('Setup page idle timeout (20 minutes).');
        finish();
      }
    }, idleMs);
    server.on('close', () => clearTimeout(idleTimer));

    server.on('error', reject);
    server.listen(port, '127.0.0.1', async () => {
      console.log(`OAuth: http://127.0.0.1:${port}/oauth2callback → then setup page /setup`);
      console.log('Opening browser for Google sign-in (OAuth — Google Sheets)...');
      try {
        await open(authUrl);
      } catch {
        console.log('Could not open browser. Open this URL manually:');
        console.log(authUrl);
      }
    });
  });

  console.log(`Saved OAuth tokens to ${TOKENS_PATH}`);
}

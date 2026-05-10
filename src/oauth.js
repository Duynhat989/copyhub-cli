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
  mergeConfigPartial,
  loadSheetSyncTarget,
  loadOverlayAcceleratorFromConfigSync,
  loadOverlayPlatformFromConfigSync,
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
      `OAuth is not configured. Set ${ENV_GOOGLE_CLIENT_ID} and ${ENV_GOOGLE_CLIENT_SECRET} (.env or environment), or run: copyhub config --client-id ID --client-secret SECRET`,
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

/** Shortcut presets (Electron Accelerator) per platform — embedded as JSON in the setup page. */
const PLATFORM_PRESETS = {
  win: [
    { label: 'Ctrl + Shift + H · recommended', value: 'CommandOrControl+Shift+H' },
    { label: 'Control + Shift + H', value: 'Control+Shift+H' },
    { label: 'Alt + Shift + H', value: 'Alt+Shift+H' },
  ],
  mac: [
    { label: '⌘ + Shift + H · recommended', value: 'CommandOrControl+Shift+H' },
    { label: 'Command + Shift + H', value: 'Command+Shift+H' },
    { label: '⌘ + Shift + V', value: 'Command+Shift+V' },
  ],
  linux: [
    { label: 'Ctrl + Shift + H · recommended', value: 'CommandOrControl+Shift+H' },
    { label: 'Control + Shift + H', value: 'Control+Shift+H' },
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
            <span class="tag">⌘ Command</span>
          </button>
          <button type="button" class="platform-btn" data-platform="linux" aria-pressed="false">
            <span class="ico" aria-hidden="true">🐧</span>
            <span class="name">Linux</span>
            <span class="tag">X11 / Wayland</span>
          </button>
        </div>

        <label class="field-label" for="acc">Accelerator (blank = default Ctrl/⌘ + Shift + H)</label>
        <input id="acc" type="text" name="overlayAccelerator" value="${accVal}" placeholder="Pick a preset below or type your own" autocomplete="off" spellcheck="false" />

        <p class="hint">On Windows use <code>Control</code> in config, not <code>Ctrl</code>. Avoid <code>Control+Alt+…</code> (often grabbed by drivers).</p>
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
        win: 'Windows: CommandOrControl = Ctrl.',
        mac: 'macOS: CommandOrControl = ⌘ Command.',
        linux: 'Linux: same as Windows with Ctrl; clipboard depends on your desktop.'
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
  const cfg = await loadConfig();
  if (!cfg) {
    throw new Error(
      `Not configured. Set ${ENV_GOOGLE_CLIENT_ID} and ${ENV_GOOGLE_CLIENT_SECRET} in .env, or run: copyhub config --client-id ... --client-secret ...`,
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
          const { tokens } = await oauth2Client.getToken(code);
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

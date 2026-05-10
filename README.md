# CopyHub

CopyHub watches your **clipboard**, stores **local history** (`~/.copyhub/history.jsonl`), optionally syncs to **Google Sheets** (one tab per day), and opens an **Electron overlay** to browse and pick recent copies.

Runs on **Windows**, **macOS**, and **Linux**.

---

## Table of contents

Sections below: **Features** · **Requirements** · **Installation** · **Environment files** · **Google Cloud & OAuth** · **OAuth config vs env** · **First run** · **CLI commands** · **Environment variables** · **Data directory** · **Google Sheets** · **Overlay** · **Clipboard & history** · **Updating** · **Troubleshooting** · **Security** · **License**.

---

## Features

- Clipboard polling (tunable via `COPYHUB_POLL_MS`).
- Skips saving the **same content twice in a row** to `history.jsonl` / Sheets.
- Writes Sheets to tabs named **`COPYHUB-YYYY-MM-DD`** (machine timezone).
- Overlay: paginated history, incremental Sheet sync (not all tabs at once), hints while Sheet data loads.

---

## Requirements

- **Node.js** ≥ 18  
- A **Google Cloud project** with:
  - **Google Sheets API** enabled **on the same project** as the OAuth client  
  - OAuth client type **Web application** and redirect URI configured correctly (see below)

---

## Installation

### Global install (npm)

```bash
npm install -g copyhub-cli
```

Ensure `node` and `copyhub` are on your `PATH`. On Linux/macOS you may need an npm global prefix for your user — see [npm global installation](https://docs.npmjs.com/cli/v10/commands/npm-install#global-installation).

### From source (this repo)

```bash
npm install
npm link
```

Without linking:

```bash
node src/cli.js <command>
```

---

## Environment files

The CLI and Electron overlay call `loadCopyhubEnv()`: each `.env` file is parsed and merged into **one object** — **later files override keys** from earlier ones. Then each key is applied to `process.env` **only if that variable is not already set** in the process environment (values you `export` in the shell before starting Node always win).

File order:

1. `<package>/.env` (installed package directory / repo when developing)  
2. `~/.copyhub/.env`  
3. `./.env` in the **current working directory** (`cwd`)

So after `npm install -g`, variables in `~/.copyhub/.env` still load regardless of `cwd`.

See the template: `.env.example`.

---

## Google Cloud & OAuth

1. Enable **[Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)** for your project.  
2. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.  
3. **Authorized redirect URIs** — add **exactly** (CopyHub uses `127.0.0.1`, not `localhost`, for the default redirect):

   ```text
   http://127.0.0.1:19999/oauth2callback
   ```

   If you change the port (`COPYHUB_OAUTH_REDIRECT_PORT` or `redirectPort` in config), the Console URI must use that port.

4. **Do not** mix Client ID from env with Secret from file (CopyHub refuses mixed half-pairs). Credential precedence — see the next section.

### How to supply Client ID / Secret

| Method | Notes |
|--------|--------|
| **`copyhub login`** | Recommended first time: localhost wizard for ID/Secret → saves `config.json` → Google sign-in → spreadsheet ID / shortcut setup. |
| **`copyhub config --client-id … --client-secret …`** | Writes `config.json` directly. |
| **`.env`** or shell | Use only when **`config.json` does not** contain a full ID+Secret pair, or you intentionally rely on env only (no OAuth in config). |

On the wizard (Mac/Safari): prefer **Download JSON** from the Console and paste `client_id` / `client_secret`; clear the fields before pasting to avoid Keychain filling an old secret.

---

## OAuth: config vs env (important)

- If **`~/.copyhub/config.json` contains both** `clientId` **and** `clientSecret` → CopyHub **always uses the file pair** for OAuth; **`COPYHUB_GOOGLE_*` from env/.env are ignored** for those two fields.  
- If the file **does not** have both → use **`COPYHUB_GOOGLE_CLIENT_ID`** + **`COPYHUB_GOOGLE_CLIENT_SECRET`** from env (merged from `.env`).  
- Never combine ID from env with Secret from file (or the reverse).

ID/Secret values are **sanitized** on read/write (BOM, CRLF, NBSP, zero-width characters, stray brackets around strings).

Check which source is active:

```bash
copyhub status
```

---

## First run

```bash
copyhub login
```

1. If OAuth is not fully configured in config/env → the browser opens **`http://127.0.0.1:<port>/credentials`** to enter Client ID / Secret.  
2. Then Google sign-in; callback **`/oauth2callback`**.  
3. Setup page: **Spreadsheet ID** (from URL `…/d/<ID>/edit`), **platform**, **overlay shortcut** (optional).

Start the daemon (clipboard + Sheet + overlay by default):

```bash
copyhub start
```

You can close the terminal; the process runs in the background. Use `copyhub list`, stop with `copyhub stop`.

After editing `config.json`, `~/.copyhub/.env`, or shell variables that affect the daemon/overlay, **reload** without manual stop/start:

```bash
copyhub restart
```

(Same flags as `start`: `--no-sheet`, `--no-overlay`, `--foreground`.)

Foreground (Ctrl+C stops everything):

```bash
copyhub start --foreground
```

---

## CLI commands

| Command | Description |
|---------|-------------|
| `copyhub config --client-id ID --client-secret SEC [--redirect-port P] [--sheet-id ID]` | Writes OAuth (and optional Sheet ID, port) to `config.json`. |
| `copyhub login` | OAuth flow + browser setup. |
| `copyhub logout` | Deletes `tokens.json` (config unchanged). |
| `copyhub status` | OAuth, Sheet, token, overlay, daemon. |
| `copyhub start [--no-sheet] [--no-overlay] [--foreground]` | Default **background**; single instance. |
| `copyhub restart [--no-sheet] [--no-overlay] [--foreground]` | Stops the daemon if running, then **`start`s again** — reloads config, `.env`, overlay shortcut. |
| `copyhub list` / `copyhub ls` | Daemon PID (if any). |
| `copyhub stop` | Stops daemon and child overlay. |
| `copyhub overlay` | Electron window only (no clipboard daemon). |
| `copyhub reset --yes` | **Deletes all** of `~/.copyhub` (config, tokens, history, run state). `.env` files outside that folder are untouched. |
| `copyhub commands` / `copyhub cmds` | Quick command list. |
| `copyhub --help` | Commander help. |

---

## Environment variables

| Variable | Meaning |
|----------|---------|
| `COPYHUB_GOOGLE_CLIENT_ID` | OAuth Client ID (only used when config **does not** contain a full ID+Secret pair). |
| `COPYHUB_GOOGLE_CLIENT_SECRET` | OAuth Client Secret (same rule). |
| `COPYHUB_OAUTH_REDIRECT_PORT` | Localhost port for OAuth (default `19999`). Must match redirect URI in Google Console. |
| `COPYHUB_OVERLAY_ACCELERATOR` | Electron shortcut ([Accelerator](https://www.electronjs.org/docs/latest/api/accelerator)); **overrides** config when set. |
| `COPYHUB_START_NO_OVERLAY` | `=1` → `copyhub start` does not spawn overlay. |
| `COPYHUB_OVERLAY_STICKY` | `=1` → overlay does not hide on blur (only Esc / picking a row). |
| `COPYHUB_OVERLAY_HIDE_ON_START` | `=1` → do not show window at overlay startup (open via shortcut/tray). |
| `COPYHUB_OVERLAY_SKIP_TASKBAR` | `=1` → hide from taskbar (Windows/Electron). |
| `COPYHUB_POLL_MS` | Clipboard poll interval (ms). |

Electron inherits `process.env` from the daemon/CLI parent, so these apply once present in that environment.

---

## Data directory

Everything lives under **`~/.copyhub/`** (Windows: **`%USERPROFILE%\.copyhub`**):

| File | Contents |
|------|----------|
| `config.json` | OAuth (`clientId`, `clientSecret`, `redirectPort`), `googleSheetId`, `overlayAccelerator`, `overlayPlatform`, … |
| `tokens.json` | OAuth refresh / access tokens |
| `history.jsonl` | Clipboard history (JSON Lines) |
| `run.json` | PID and metadata when `copyhub start` runs in the background |

---

## Google Sheets

- Appends rows when Sheets are enabled and tokens are valid.  
- New tab per **calendar day**: `COPYHUB-YYYY-MM-DD`.  
- The spreadsheet must be shared with the Google account used for OAuth (or owned by that account).  
- If the API reports disabled / permission errors: check logs — some errors include Enable API links from formatted messages in code.

---

## Overlay (Electron)

- Default shortcut (**all platforms**, including macOS): **`Control+Shift+H`** — **⌃ Control** (bottom-left on Apple keyboards) or **Ctrl** on PC layouts — **same physical position**, not ⌘ / Win.
- For **⌘ Command + Shift + H** on Mac: set `overlayAccelerator` to `Command+Shift+H` (avoid `CommandOrControl+…` — on macOS Electron maps that to ⌘, so **⌃ Control** will not trigger the overlay). Legacy preset `CommandOrControl+Shift+H` is migrated to ⌃+Shift+H when the overlay starts.
- **macOS**: you may need **Accessibility** (*Privacy & Security*) for the app that launches Electron (Terminal, iTerm, …). If shortcuts still fail with non-US layouts, try **Input Source QWERTY** (Electron `globalShortcut` limitation).
- Overlay paginates ~10 items; Sheet data loads incrementally (not all tabs at once).  
- Click outside the window usually closes the overlay (unless `COPYHUB_OVERLAY_STICKY=1`). **Esc** closes.

---

## Clipboard & history

- Watcher skips consecutive clipboard duplicates (same hash).  
- Before writing file/Sheet, if content **exactly matches the newest row** in `history.jsonl`, it is **skipped** (avoids re-saving the same string after clipboard churn).

---

## Updating

`~/.copyhub` data is kept when upgrading the package.

```bash
copyhub stop
npm install -g copyhub-cli@latest
copyhub start
```

(If you only changed config / `.env`: `copyhub restart`.)

From source: `git pull`, `npm install`, then `copyhub start` (or `npm link` while developing).

---

## Troubleshooting

### `invalid_client` or “client secret is invalid” after Google sign-in

- Use OAuth client **Web application**, redirect `http://127.0.0.1:<port>/oauth2callback`.  
- Rotate secret or **Download JSON** for a fresh client; enter again via wizard; on Mac **clear fields** before paste.  
- `copyhub status` — verify Client ID/Secret source.  
- CopyHub may show an HTML error page when exchanging the `code` fails.

### OAuth port already in use (`EADDRINUSE`)

Change port: `COPYHUB_OAUTH_REDIRECT_PORT` or `copyhub config … --redirect-port P`, and update the redirect URI in Google Console.

### `copyhub start` says already running

Single background instance: `copyhub list` / `copyhub stop`, then start again.

### Sheet not writing / API errors

- Enable Google Sheets API on the correct project.  
- Check `copyhub status` (token, Sheet ID).  
- Share the spreadsheet with the signed-in account.

### Overlay won’t open / shortcut doesn’t work

- **macOS**: enable **Accessibility** for Terminal / Node / Electron.  
- Default is **Control+Shift+H** (⌃ or Ctrl + Shift + H), not the Win key.  
- Ensure the daemon is running (`copyhub list`) or try `copyhub overlay`.  
- Avoid conflicts with other apps (Spotlight, Alfred, …).

### Reset and start clean

```bash
copyhub stop
copyhub reset --yes
```

Then remove or edit `COPYHUB_GOOGLE_*` in your shell / `~/.copyhub/.env` if you no longer want env-based OAuth. `.env` files are **not** removed by `reset`.

---

## Security notes

- `config.json` and `tokens.json` contain OAuth secrets — standard user-only permissions under `~/.copyhub`.  
- Do not commit `.env` or CopyHub data to public git.

---

## License

MIT — see `package.json`.

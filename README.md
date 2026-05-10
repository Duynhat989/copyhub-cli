# CopyHub

CopyHub watches your **clipboard**, keeps a **local history** under `~/.copyhub/history.jsonl`, optionally syncs copies to **Google Sheets** (one tab per day), and shows an **Electron overlay** so you can browse recent clips quickly.

Runs on **Windows**, **macOS**, and **Linux**.

## Requirements

- **Node.js** ≥ 18
- A **Google Cloud** project with:
  - **Google Sheets API** enabled for the *same* project as your OAuth client
  - **OAuth 2.0 Client** (Desktop app type works well for localhost redirect)

## Installation

From this repository:

```bash
npm install
```

Link the CLI globally (optional):

```bash
npm link
```

Or run commands with:

```bash
node src/cli.js <command>
```

## Google Cloud setup

1. Enable **[Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)** on your OAuth project.
2. Create **OAuth 2.0 credentials** and add this **Authorized redirect URI** (adjust the port if you change it):

   ```text
   http://127.0.0.1:19999/oauth2callback
   ```

3. Copy `.env.example` to `.env` and set:

   - `COPYHUB_GOOGLE_CLIENT_ID`
   - `COPYHUB_GOOGLE_CLIENT_SECRET`
   - Optionally `COPYHUB_OAUTH_REDIRECT_PORT` (default **19999**)

Alternatively, store credentials in `~/.copyhub/config.json` via:

```bash
copyhub config --client-id "<ID>" --client-secret "<SECRET>" [--sheet-id "<SPREADSHEET_ID>"] [--redirect-port 19999]
```

## First run

1. **Login** (opens the browser for OAuth, then a setup page):

   ```bash
   copyhub login
   ```

2. On the setup page, enter your **Spreadsheet ID** (from the URL `…/d/<SPREADSHEET_ID>/edit`), choose **platform** (Windows / macOS / Linux) for shortcut hints, set the **overlay accelerator** if you want, and save.

3. **Start** the background watcher (clipboard + Sheets + overlay by default):

   ```bash
   copyhub start
   ```

   You can close the terminal; the process keeps running. Check with `copyhub list` and stop with `copyhub stop`.

### Useful flags and environment variables

| Action | How |
|--------|-----|
| Run in terminal (Ctrl+C stops everything) | `copyhub start --foreground` |
| No Google Sheets | `copyhub start --no-sheet` |
| No Electron overlay | `copyhub start --no-overlay` or `COPYHUB_START_NO_OVERLAY=1` |
| Override shortcut | `COPYHUB_OVERLAY_ACCELERATOR` in `.env` (overrides saved config) |
| Overlay stays open when clicking outside | `COPYHUB_OVERLAY_STICKY=1` |

Run `copyhub --help` or `copyhub commands` for the full command list.

## CLI overview

| Command | Purpose |
|---------|---------|
| `copyhub config` | Save OAuth client ID/secret (and optional Sheet ID) to `~/.copyhub/config.json` |
| `copyhub login` | OAuth flow + setup page (Sheet ID, platform, overlay shortcut) |
| `copyhub logout` | Remove saved tokens |
| `copyhub status` | OAuth, Sheet, tokens, overlay platform/shortcut, daemon state |
| `copyhub start` | Background daemon: clipboard watcher + optional Sheets + overlay |
| `copyhub list` / `copyhub ls` | Show whether the daemon PID is running |
| `copyhub stop` | Stop daemon and overlay child |
| `copyhub overlay` | Launch only the Electron overlay (no clipboard daemon) |

## Data locations

Everything lives under **`~/.copyhub/`** (or `%USERPROFILE%\.copyhub` on Windows):

| File | Contents |
|------|----------|
| `config.json` | OAuth credentials (if not only in `.env`), `googleSheetId`, `overlayAccelerator`, `overlayPlatform` |
| `tokens.json` | OAuth refresh/access tokens |
| `history.jsonl` | Local clipboard history (JSON Lines) |
| `run.json` | Daemon PID and metadata (when using `copyhub start` without `--foreground`) |

## Google Sheets layout

- Rows are appended when Sheet sync is enabled and you are logged in.
- New tabs are created per **local calendar day**, named: **`COPYHUB-YYYY-MM-DD`**.

## Overlay (Electron)

- Global shortcut defaults to **`CommandOrControl+Shift+H`** if nothing else is set (`Ctrl+Shift+H` on Windows/Linux, `⌘⇧H` on macOS-style wording in Electron).
- **macOS**: you may need to grant **Accessibility** permissions for global shortcuts.
- Some **`Control+Alt+…`** combinations do not register reliably on Windows; prefer alternatives suggested on the setup page.

## License

MIT — see `package.json`.

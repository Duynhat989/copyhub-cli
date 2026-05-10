<div align="center">

# CopyHub

**Clipboard history · optional Google Sheets sync · floating overlay**

[![npm](https://img.shields.io/npm/v/copyhub-cli?label=npm&logo=npm)](https://www.npmjs.com/package/copyhub-cli)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-green?logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](./package.json)

*Watch the clipboard, save **`~/.copyhub/history.jsonl`**, sync daily tabs to Sheets, pick copies from an Electron overlay.*

**Windows · macOS · Linux**

</div>

---

## Contents

| | |
|--|--|
| [Overview](#overview) | [Installation](#installation) |
| [Quick start](#quick-start) | [Environment files](#environment-files) |
| [Google Cloud & OAuth](#google-cloud--oauth) | [Google Cloud setup (step-by-step)](#google-cloud-setup-step-by-step) |
| [OAuth: config vs env](#oauth-config-vs-env-important) | [CLI commands](#cli-commands) |
| [Environment variables](#environment-variables) | [Data directory](#data-directory) |
| [Google Sheets](#google-sheets) | [Overlay (Electron)](#overlay-electron) |
| [Clipboard & history](#clipboard--history) | [Updating (latest version)](#updating-latest-version) |
| [Troubleshooting](#troubleshooting) | [Security](#security) |
| [Tips (PayPal)](#tips-paypal) | [License](#license) |

---

## Overview

| Capability | Details |
|------------|---------|
| **Local history** | JSON Lines under `~/.copyhub/history.jsonl` |
| **Sheets** | Optional sync; one tab per day: `COPYHUB-YYYY-MM-DD` |
| **Overlay** | Electron window: browse history, paginated, incremental Sheet load |

---

## Features

- Clipboard polling — interval via `COPYHUB_POLL_MS`.
- Skips writing the **same content twice in a row** to disk / Sheets.
- Overlay shows hints while Sheet data loads; does not fetch every tab at once.

---

## Requirements

- **Node.js** ≥ 18  
- **Google Cloud project** (same project for everything below):
  - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) **enabled**
  - OAuth client type **Web application** + correct **redirect URI** (see [Google Cloud & OAuth](#google-cloud--oauth))

---

## Installation

<details>
<summary><strong>Global install (npm)</strong></summary>

```bash
npm install -g copyhub-cli
```

Ensure `node` and `copyhub` are on your `PATH`. On Linux/macOS you may need a user-level npm global prefix — see [npm — global installation](https://docs.npmjs.com/cli/v10/commands/npm-install#global-installation).

Đã cài từ npm và muốn **lên bản mới nhất**: [Updating (latest version)](#updating-latest-version).

</details>

<details>
<summary><strong>From source (this repo)</strong></summary>

```bash
npm install
npm link
```

Without linking:

```bash
node src/cli.js <command>
```

</details>

---

## Quick start

```bash
copyhub login      # OAuth + browser setup (Client ID / Secret, Sheet ID, shortcut)
copyhub start      # clipboard + Sheets + overlay (background; close terminal OK)
```

Reload config / `.env` without manual stop:

```bash
copyhub restart
```

Foreground (Ctrl+C stops everything):

```bash
copyhub start --foreground
```

`copyhub stop` stops the daemon and overlay child.

**Đã cài CopyHub rồi?** Cập nhật lên bản mới nhất — xem [Updating (latest version)](#updating-latest-version).

---

## Environment files

`loadCopyhubEnv()` merges several `.env` files into **one object** — **later files override earlier keys**. Each key is applied to `process.env` **only if not already set** in the real environment (shell `export` wins).

**Merge order**

1. `<package>/.env` (npm package dir or repo root when developing)  
2. `~/.copyhub/.env`  
3. `./.env` from the **current working directory**

After `npm install -g`, `~/.copyhub/.env` still applies no matter where you run commands.

Template: [`.env.example`](./.env.example).

---

## Google Cloud & OAuth

CopyHub needs **Google Sheets API** enabled and an **OAuth 2.0 Client ID** (**Web application**) on the **same** Cloud project.

### Console quick links

| Goal | Open |
|------|------|
| Enable **Google Sheets API** | [API Library — Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) |
| Create **Client ID** & **Client Secret** | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) |

### Minimal checklist

1. Enable **[Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)** → pick project → **Enable**.  
2. **[Credentials](https://console.cloud.google.com/apis/credentials)** → **Create credentials** → **OAuth client ID** → **Web application** ([full walkthrough](#google-cloud-setup-step-by-step)).  
3. **Authorized redirect URIs** — add **exactly** (CopyHub uses `127.0.0.1`, not `localhost`):

   ```
   http://127.0.0.1:19999/oauth2callback
   ```

   If you change port (`COPYHUB_OAUTH_REDIRECT_PORT` or `redirectPort` in config), update this URI in Google Console to match.

> **Important:** Do not mix Client ID from env with Secret from `config.json` (or the reverse). CopyHub rejects mixed pairs — see [OAuth: config vs env](#oauth-config-vs-env-important).

### How to supply Client ID / Secret

| Method | When to use |
|--------|-------------|
| `copyhub login` | Best first run: wizard saves `config.json`, then Google sign-in, Sheet ID, shortcut. |
| `copyhub config --client-id … --client-secret …` | Writes OAuth straight into `config.json`. |
| `.env` / shell | Only when **`config.json` does not** hold a full ID+Secret pair, or you intentionally use env-only OAuth. |

**Safari / Mac wizard tip:** Prefer **Download JSON** from Google Console and paste `client_id` / `client_secret`; clear fields before paste so Keychain does not inject an old secret.

---

## Google Cloud setup (step-by-step)

Use this when you or someone you onboard needs **Client ID**, **Client Secret**, and **Spreadsheet ID**.

### 1. Project

1. Open [Google Cloud Console](https://console.cloud.google.com/).  
2. Create or select a **project** (top bar). All steps below use this project.

### 2. Enable Sheets API

1. Open **[Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)** in the API Library.  
2. Confirm project.  
3. Click **Enable** and wait until it finishes.

### 3. OAuth consent screen (first time)

1. **APIs & Services** → **OAuth consent screen**.  
2. **External** (most individuals) or **Internal** (Workspace org only).  
3. Fill **App name**, **User support email**, **Developer contact**.  
4. **Scopes** — can be refined later; CopyHub uses Google APIs as required by the auth libraries.  
5. If status is **Testing**, add **Test users** until you publish.

### 4. OAuth Client ID & Secret

1. **[Credentials](https://console.cloud.google.com/apis/credentials)** → **Create credentials** → **OAuth client ID**.  
2. Type: **Web application** — name e.g. `CopyHub local`.  
3. **Authorized redirect URIs** → **Add URI**:

   ```
   http://127.0.0.1:19999/oauth2callback
   ```

   (Match port to `COPYHUB_OAUTH_REDIRECT_PORT` / `redirectPort` if you customize it.)

4. **Create** → copy **Client ID** and **Client Secret** (or **Download JSON**).

Feed them into `copyhub login`, `copyhub config`, or `COPYHUB_GOOGLE_CLIENT_ID` / `COPYHUB_GOOGLE_CLIENT_SECRET` — see [OAuth: config vs env](#oauth-config-vs-env-important).

### 5. Spreadsheet ID (from the Sheet URL)

Stored as `googleSheetId` in `config.json` (or entered on the setup page after login).

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
```

**`SHEET_ID`** is only the segment **between** `/d/` and **`/edit`** (stop before `?` if present).

| Example path | ID you need |
|--------------|-------------|
| `…/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit` | `1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890` |

**Sharing:** The account used in **`copyhub login`** must **own** the spreadsheet or have **edit** access.

---

## OAuth: config vs env (important)

| Situation | Behavior |
|-----------|----------|
| `~/.copyhub/config.json` has **both** `clientId` and `clientSecret` | CopyHub **always** uses this pair; **`COPYHUB_GOOGLE_*`** from env / `.env` **ignored** for ID & Secret. |
| Config missing a full pair | Uses **`COPYHUB_GOOGLE_CLIENT_ID`** + **`COPYHUB_GOOGLE_CLIENT_SECRET`** from env (after `.env` merge). |

Never pair ID from one source with Secret from another.

Values are **sanitized** on read/write (BOM, CRLF, NBSP, zero-width chars, stray brackets).

```bash
copyhub status    # shows which OAuth source is active
```

---

## CLI commands

| Command | Description |
|---------|-------------|
| `copyhub config --client-id ID --client-secret SEC [--redirect-port P] [--sheet-id ID]` | Write OAuth (+ optional Sheet ID, port) to `config.json`. |
| `copyhub login` | Full OAuth + browser setup flow. |
| `copyhub logout` | Deletes `tokens.json`; config unchanged. |
| `copyhub status` | OAuth source, Sheet, tokens, overlay, daemon. |
| `copyhub start [--no-sheet] [--no-overlay] [--foreground]` | Default **background**; single instance. |
| `copyhub restart [--no-sheet] [--no-overlay] [--foreground]` | Stop daemon if running, then start again (reloads config / `.env` / shortcut). |
| `copyhub list` · `copyhub ls` | Show daemon PID if running. |
| `copyhub stop` | Stop daemon + overlay child. |
| `copyhub overlay` | Electron overlay only (no clipboard daemon). |
| `copyhub reset --yes` | **Delete entire** `~/.copyhub` (config, tokens, history, run state). `.env` elsewhere untouched. |
| `copyhub commands` · `copyhub cmds` | Short command list. |
| `copyhub --help` | Full Commander help. |

---

## Environment variables

| Variable | Meaning |
|----------|---------|
| `COPYHUB_GOOGLE_CLIENT_ID` | OAuth Client ID — only if config **lacks** full ID+Secret pair. |
| `COPYHUB_GOOGLE_CLIENT_SECRET` | OAuth Client Secret — same rule. |
| `COPYHUB_OAUTH_REDIRECT_PORT` | Local OAuth port (default `19999`). Must match Google Console redirect URI. |
| `COPYHUB_OVERLAY_ACCELERATOR` | Electron [Accelerator](https://www.electronjs.org/docs/latest/api/accelerator); env **overrides** config when set. |
| `COPYHUB_START_NO_OVERLAY` | `=1` → `copyhub start` skips spawning overlay. |
| `COPYHUB_OVERLAY_STICKY` | `=1` → overlay stays open on blur (close with Esc or picking a row). |
| `COPYHUB_OVERLAY_HIDE_ON_START` | `=1` → hide overlay window until shortcut / tray. |
| `COPYHUB_OVERLAY_SKIP_TASKBAR` | `=1` → hide from taskbar (Windows / Electron). |
| `COPYHUB_POLL_MS` | Clipboard polling interval (milliseconds). |

The Electron child inherits `process.env` from whatever launched the daemon.

---

## Data directory

All state under **`~/.copyhub/`** — Windows: **`%USERPROFILE%\.copyhub`**.

| File | Purpose |
|------|---------|
| `config.json` | OAuth (`clientId`, `clientSecret`, `redirectPort`), `googleSheetId`, `overlayAccelerator`, `overlayPlatform`, … |
| `tokens.json` | OAuth refresh / access tokens |
| `history.jsonl` | Clipboard history (JSON Lines) |
| `run.json` | PID / metadata when `copyhub start` runs in background |

---

## Google Sheets

- Appends rows when Sheets sync is on and tokens are valid.  
- Daily tab name: **`COPYHUB-YYYY-MM-DD`** (machine timezone).  
- **Spreadsheet ID** — from `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit` ([details](#5-spreadsheet-id-from-the-sheet-url)).  
- Enable **[Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)** on the Cloud project that owns your OAuth client.  
- Sheet must be owned by or shared (**edit**) with the Google account from `copyhub login`.  
- API / permission errors: check logs; some messages include Console links.

---

## Overlay (Electron)

| Topic | Detail |
|-------|--------|
| **Default shortcut** | **`Control+Shift+H`** everywhere — **⌃ Control** (Apple) / **Ctrl** (PC), same physical key — **not** ⌘ Command or Win. |
| **⌘ + Shift + H on Mac** | Set `overlayAccelerator` to `Command+Shift+H`. Avoid `CommandOrControl+…` on macOS (Electron maps it to ⌘). Preset `CommandOrControl+Shift+H` is migrated to ⌃+Shift+H at overlay startup. |
| **macOS** | **Accessibility** may be required for the parent of Electron (Terminal, iTerm, …). Non-US layouts can break `globalShortcut` — try **ABC / US QWERTY**. |
| **Behavior** | ~10 rows per page; Sheet fills in incrementally. Click outside closes (unless `COPYHUB_OVERLAY_STICKY=1`). **Esc** closes. |

---

## Clipboard & history

- Ignores **consecutive** duplicate clipboard content (same hash).  
- Skips a write if new text **equals** the latest line in `history.jsonl` (reduces noise from clipboard churn).

---

## Updating (latest version)

Your **`~/.copyhub`** data (config, tokens, history) is **kept** when you upgrade the CLI/package.

### Already installed — npm global (recommended)

If CopyHub was installed with **`npm install -g copyhub-cli`**, upgrade then restart the daemon:

```bash
copyhub stop
npm install -g copyhub-cli@latest
copyhub start
```

Or bump the global install using npm’s updater (follows semver for whatever range npm recorded):

```bash
copyhub stop
npm update -g copyhub-cli
copyhub start
```

Check what you have installed:

```bash
npm ls -g copyhub-cli
copyhub --help
```

> **Prefer `npm install -g copyhub-cli@latest`** when you want the **newest** tag on npm regardless of range. **`npm update -g copyhub-cli`** updates within the installed semver range (often enough if you originally installed without pinning).  
> If you only changed settings (no package upgrade), use **`copyhub restart`** instead.

### Already installed — from this repo (`git clone`)

```bash
copyhub stop
git pull
npm install
copyhub start
```

While developing with `npm link`, same sequence after `git pull`; ensure `copyhub` on `PATH` points at your linked checkout.

### Summary

| Situation | Command flow |
|-----------|----------------|
| Upgrade CLI from npm (newest tag) | `copyhub stop` → `npm install -g copyhub-cli@latest` → `copyhub start` |
| Upgrade CLI from npm (`npm update`) | `copyhub stop` → `npm update -g copyhub-cli` → `copyhub start` |
| Reload config / `.env` only | `copyhub restart` |
| Upgrade from git checkout | `copyhub stop` → `git pull` → `npm install` → `copyhub start` |

---

## Troubleshooting

<details>
<summary><strong><code>invalid_client</code> / “client secret is invalid”</strong></summary>

- OAuth type **Web application**; redirect `http://127.0.0.1:<port>/oauth2callback`.  
- Rotate secret or paste fresh JSON; on Mac **clear** wizard fields before paste.  
- Run `copyhub status`.  
- Failed token exchange may render an HTML error page.

</details>

<details>
<summary><strong>OAuth port in use (<code>EADDRINUSE</code>)</strong></summary>

Set `COPYHUB_OAUTH_REDIRECT_PORT` or `copyhub config … --redirect-port P`, then mirror the port in Google Console redirect URIs.

</details>

<details>
<summary><strong><code>copyhub start</code> — already running</strong></summary>

Single background instance: `copyhub list` → `copyhub stop` → start again.

</details>

<details>
<summary><strong>Sheet not writing / API errors</strong></summary>

- Sheets API enabled on correct project.  
- `copyhub status` — token + Sheet ID.  
- Share spreadsheet with signed-in Google account.

</details>

<details>
<summary><strong>Overlay / shortcut dead</strong></summary>

- **macOS:** Accessibility for Terminal / Node / Electron.  
- Default **Control+Shift+H** (not Win key).  
- `copyhub list` → running? Try `copyhub overlay`.  
- Shortcut conflicts: Spotlight, Alfred, …  

</details>

<details>
<summary><strong>Factory reset</strong></summary>

```bash
copyhub stop
copyhub reset --yes
```

Remove or edit `COPYHUB_GOOGLE_*` in shell / `~/.copyhub/.env` if you no longer want env OAuth. `reset` does **not** delete unrelated `.env` files.

</details>

---

## Security

- `config.json` and `tokens.json` hold secrets — keep `~/.copyhub` user-private.  
- Never commit `.env` or CopyHub data to public repositories.

---

## Tips (PayPal)

If CopyHub is useful to you, tips are welcome via **PayPal**:

**[vietduy989kc@gmail.com](mailto:vietduy989kc@gmail.com)**

In PayPal, choose **Send** and enter that email as the recipient. Thank you for supporting the project.

---

## License

MIT — see [`package.json`](./package.json).

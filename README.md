# LuantiHub

**The Decentralized Package Registry & Content Hub for Luanti**

[![Luanti Engine](https://img.shields.io/badge/Luanti-5.0+-38bdf8?style=flat-square&logo=lua&logoColor=white)](https://www.luanti.org)
[![Angular 22](https://img.shields.io/badge/Angular-22.2-dd0031?style=flat-square&logo=angular&logoColor=white)](https://angular.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20D1-f38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20First-10b981?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

LuantiHub is a package discovery platform and decentralized content repository for the [Luanti](https://www.luanti.org) voxel game engine (formerly Minetest). It provides a modern, cinematic frosted-glass browsing experience while serving as a direct drop-in replacement for the in-game Luanti **Content** tab.

---

## Key Features

* **Direct In-Game Luanti Compatibility:** Drop-in compatible with the Luanti engine client. Configure `contentdb_url = https://luanti-hub.pages.dev` in your `luanti.conf` (or legacy `minetest.conf`) to search, download, and update decentralized mods directly inside the game.
* **Decentralized Git Ingestion & Static Analysis:** Creators can submit and index their mods directly from **Codeberg**, **GitLab**, or **GitHub** with automated `mod.conf` / `game.conf` / `texture_pack.conf` parsing, SPDX license verification, and Luacheck static code analysis.
* **High-Availability Fallback Mirror:** Automatically fails over between the official ContentDB API (`content.luanti.org`) and the community mirror (`contentdb.milcho.org`), with background sync to Cloudflare D1 so package listings and tags remain available at all times.
* **Full-HD 16:9 Media & README Rendering:** Resolves uncompressed full-HD screenshots (`shot-0.png`) with resilient multi-tier fallback and renders live repository `README.md` documentation inside the package details modal.
* **Genuine Community Star Ratings & Reviews:** Aggregates genuine 1–5 star ratings and verified reviews stored in Cloudflare D1 alongside upstream ContentDB discussions. Unrated packages cleanly hide star badges until rated.
* **Hardened Multi-Provider Auth & Role-Based Moderation:** Supports OAuth 2.0 and Personal Access Token (PAT) verification across GitHub, Codeberg, GitLab, and ContentDB, with cryptographic HMAC-SHA256 sessions (`lh_session`), CSRF state verification, and strict verified-identity checks for admin and moderator roles.
* **Multi-Language Support (i18n):** Fully localized in 6 languages: English (`en`), German (`de`), French (`fr`), Spanish (`es`), Russian (`ru`), and Slovak (`sk`).
* **Offline-First PWA & Edge SSR SEO:** Installable across desktop and mobile with Angular Service Worker (`@angular/pwa`), dynamic OpenGraph/JSON-LD injection at the Cloudflare Edge (`/package/:author/:name`), and dynamic XML sitemaps (`/sitemap.xml`).

---

## In-Game Luanti Configuration

To browse and install mods from LuantiHub directly inside your Luanti client:

### Method 1: Configuration File (`luanti.conf`)

Add the following line to your `luanti.conf` (or `minetest.conf` on older releases):

```ini
contentdb_url = https://luanti-hub.pages.dev
```

> **Where to find `luanti.conf`:**
> - **Linux:** `~/.luanti/luanti.conf` (or `~/.minetest/minetest.conf`)
> - **Windows:** In your Luanti installation folder (or `%APPDATA%\Luanti\luanti.conf`)
> - **macOS:** `~/Library/Application Support/luanti/luanti.conf`

### Method 2: In-Game Settings Menu

1. Launch **Luanti** -> Click **Settings** -> **All Settings**.
2. Search for `contentdb_url`.
3. Set the value to `https://luanti-hub.pages.dev` and click **Save**.
4. Open the **Content** tab in the main menu to browse packages.

---

## Getting Started (Local Development)

### Prerequisites

* **Node.js** `>= 22.0.0` (recommended: `v24.x`)
* **npm** `>= 10.0.0`

### 1. Frontend-Only Development (`ng serve`)

When running `npm start`, Angular serves the frontend on `http://localhost:4200`. Any `/api/*` endpoints (Cloudflare Pages Functions) are not running in this mode, so `PackageService`, `AuthService`, and `SettingsService` automatically detect `localhost` and fall back to direct upstream ContentDB/Mirror queries and `localStorage` without spamming network retries.

```bash
npm install
npm start
```

### 2. Full-Stack Local Development (Cloudflare Pages Functions + Local D1 SQLite)

To test the `/api/*` Cloudflare Pages Functions and local D1 database on `http://localhost:8788`:

```bash
# 1. Initialize the local D1 database schema
npm run db:init:local

# 2. Build the Angular app and start Cloudflare Wrangler Pages Dev
npm run dev:cloudflare
```

---

## Tech Stack & Architecture

| Layer | Technology |
| :--- | :--- |
| **Frontend Framework** | [Angular 22](https://angular.dev) (Signals, Standalone Components, `OnPush` Change Detection) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) with `@tailwindcss/postcss` & frosted-glass design system |
| **Icons & Imagery** | `@lucide/angular` (Lucide Icons) + 2:1 isometric Luanti voxel SVG branding |
| **Hosting & Edge** | [Cloudflare Pages](https://pages.cloudflare.com) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless distributed SQLite) |
| **Edge Functions** | Cloudflare Pages Functions (`/functions/api/...` & `/functions/package/...`) |
| **PWA & Caching** | Angular Service Worker (`@angular/pwa`) + in-memory signal state caching |

---

## Cloudflare Production Deployment Setup

LuantiHub is ready to deploy to **Cloudflare Pages** with **Cloudflare D1**:

### 1. Create & Initialize the Production D1 Database

```bash
# Create the D1 database in your Cloudflare account (if not already created)
npx wrangler d1 create luanti-hub-db

# Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]`

# Apply the production database schema
npm run db:init:remote
```

### 2. Configure Cloudflare Pages Build Settings

In the **Cloudflare Dashboard** -> **Workers & Pages** -> **Create application** -> **Pages**:

* **Framework preset:** Angular (or None)
* **Build command:** `npm run build`
* **Build output directory:** `dist/luanti-hub/browser`
* **Node.js version:** `22` (set `NODE_VERSION = 22` in build environment variables)

### 3. Bind D1 Database to Pages Project

In your Cloudflare Pages project -> **Settings** -> **Bindings**:

* Add a **D1 database** binding with variable name **`DB`** pointing to `luanti-hub-db`.

### 4. Configure Production Environment Variables & Secrets

In your Cloudflare Pages project -> **Settings** -> **Variables and secrets**, you can click **Import .env** and select your `.env` file (or see [`.env.example`](.env.example)):

| Variable Name | Required | Description |
| :--- | :--- | :--- |
| `SESSION_SECRET` | **Yes (Required in Prod)** | Random 32+ byte secret string used to sign HMAC-SHA256 `lh_session` cookies (e.g. `openssl rand -hex 32`). |
| `KILL_SWITCH_SECRET` | Recommended | Bearer secret for emergency CLI/webhook package takedowns (`POST /api/packages/:author/:name/moderate`). |
| `ADMIN_USERS` | Recommended | Comma-separated list of verified admin handles (e.g. `admin_user,github:admin_handle`). |
| `ADMIN_SECRET` | Optional | Secret token that allows an admin to verify their handle directly via the login modal if OAuth is not configured. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` | Optional | GitHub 1-click OAuth redirect credentials (`https://luanti-hub.pages.dev/api/auth/github/callback`). |
| `CODEBERG_CLIENT_ID` / `CODEBERG_CLIENT_SECRET` / `CODEBERG_REDIRECT_URI` | Optional | Codeberg 1-click OAuth redirect credentials (`https://luanti-hub.pages.dev/api/auth/codeberg/callback`). |
| `MESEHUB_CLIENT_ID` / `MESEHUB_CLIENT_SECRET` / `MESEHUB_REDIRECT_URI` | Optional | Mesehub (`https://git.minetest.land`) 1-click OAuth redirect credentials (`https://luanti-hub.pages.dev/api/auth/mesehub/callback`). |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` / `GITLAB_REDIRECT_URI` | Optional | GitLab 1-click OAuth redirect credentials (`https://luanti-hub.pages.dev/api/auth/gitlab/callback`). |
| `CONTENTDB_CLIENT_ID` / `CONTENTDB_CLIENT_SECRET` / `CONTENTDB_REDIRECT_URI` | Optional | ContentDB 1-click OAuth redirect credentials (`https://luanti-hub.pages.dev/api/auth/contentdb/callback`). |

---

## License & Legal

* **LuantiHub Source Code:** Licensed under the [MIT License](LICENSE).
* **Game Packages & Mods:** All indexed packages remain the property of their respective creators under their declared open-source licenses (SPDX).
* **Luanti:** Luanti is an open-source voxel game engine created by Perttu Ahola and contributors. LuantiHub is an independent community project.

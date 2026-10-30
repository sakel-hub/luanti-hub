<p align="center">
  <a href="https://luanti-hub.pages.dev/">
    <img src="public/logo.svg" alt="LuantiHub Logo" width="140" height="140">
  </a>
</p>

<h1 align="center">LuantiHub</h1>

<p align="center">
  <strong>The Decentralized Package Registry, In-Game ContentDB Mirror &amp; Community Content Hub for the Luanti Game Engine</strong>
</p>

<p align="center">
  <a href="https://luanti-hub.pages.dev/"><strong>🚀 Launch Live Web App</strong></a> &bull;
  <a href="#key-features">Key Features</a> &bull;
  <a href="#in-game-luanti-setup">In-Game Setup</a> &bull;
  <a href="#getting-started-local-development">Getting Started</a> &bull;
  <a href="#tech-stack--architecture">Tech Stack</a> &bull;
  <a href="#cloudflare-production-deployment">Deployment</a> &bull;
  <a href="#contributing--translations">Contributing &amp; Translations</a> &bull;
  <a href="#support">Support</a> &bull;
  <a href="#license--legal">License</a>
</p>

<p align="center">
  <a href="https://luanti-hub.pages.dev/">
    <img src="https://img.shields.io/badge/Live_Web_App-luanti--hub.pages.dev-0284c7.svg?style=flat-square&logo=cloudflare&logoColor=white" alt="Live Web App">
  </a>
  <a href="https://www.luanti.org">
    <img src="https://img.shields.io/badge/Luanti_Engine-5.0+-38bdf8.svg?style=flat-square&logo=lua&logoColor=white" alt="Luanti Engine">
  </a>
  <a href="https://angular.dev">
    <img src="https://img.shields.io/badge/Angular-22.2-dd0031.svg?style=flat-square&logo=angular&logoColor=white" alt="Angular 22.2">
  </a>
  <a href="https://tailwindcss.com">
    <img src="https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8.svg?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4">
  </a>
  <a href="https://developers.cloudflare.com/d1/">
    <img src="https://img.shields.io/badge/Cloudflare-Pages_%2B_D1-f38020.svg?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Pages + D1">
  </a>
  <a href="https://web.dev/progressive-web-apps/">
    <img src="https://img.shields.io/badge/PWA-Offline_First-10b981.svg?style=flat-square&logo=pwa&logoColor=white" alt="PWA Offline First">
  </a>
  <a href="#contributing--translations">
    <img src="https://img.shields.io/badge/i18n-6_Languages-8b5cf6.svg?style=flat-square" alt="i18n 6 Languages">
  </a>
  <a href="LICENSE.txt">
    <img src="https://img.shields.io/badge/License-LGPL_2.1+-blue.svg?style=flat-square" alt="License LGPL 2.1+">
  </a>
</p>

<p align="center">
  <a href="https://ko-fi.com/M1E029PWMN">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="ko-fi">
  </a>
</p>

---

**LuantiHub** is a package discovery platform, decentralized content repository, and resilient proxy mirror for the [Luanti](https://www.luanti.org) voxel game engine (formerly Minetest). 

Built with Angular 22 Signals and Cloudflare Edge Workers, LuantiHub acts as a **direct drop-in replacement for the in-game Luanti Content tab** while empowering mod creators to index, audit, and distribute packages directly from **Codeberg**, **GitLab**, or **GitHub**.

---

## ✨ Key Features

### 🎮 In-Game Luanti Client Drop-In Replacement (`contentdb_url`)
- **Native In-Engine Compatibility:** Drop-in replacement for Luanti's built-in ContentDB client. Point your client to `https://luanti-hub.pages.dev` to browse, search, and install mods, games, and texture packs directly inside the game client.
- **Automated Dependency Resolution:** Full support for `/api/packages/` endpoints, enabling the Luanti engine to parse dependencies, download releases as `.zip` packages, and install them into your local worlds with zero manual unzipping.
- **Backward & Forward Compatible:** Works seamlessly with Luanti 5.0+ and legacy Minetest 5.x releases.

### 🌐 Decentralized Git Ingestion & Static Code Audit
- **Multi-Forge Freedom:** Ingest and index mods directly from **Codeberg**, **GitLab**, or **GitHub** without relying on a single centralized repository.
- **Automated Manifest Parsing:** Automatically detects, reads, and validates `mod.conf`, `game.conf`, and `texture_pack.conf` manifests, extracting titles, authors, descriptions, and dependency trees.
- **Static Code Analysis (Luacheck):** Performs automated static linting and safety checks on submitted Lua code to flag fatal syntax errors and undefined global variables before publication.
- **SPDX Open-Source License Verification:** Enforces open-source compliance by validating declared licenses against standard SPDX identifiers (e.g. `MIT`, `LGPL-2.1-or-later`, `GPL-3.0-or-later`, `CC-BY-SA-4.0`).
- **Cryptographic Repo Ownership Proof:** Issues short-lived HMAC-SHA256 audit proof tokens to ensure only authorized repository owners can index or update packages.

### 🪞 Resilient Multi-Tier High-Availability Mirror & Failover
- **Triple-Tier Fallback Architecture:** Automatically queries and fails over between the official ContentDB API (`content.luanti.org`), the community mirror (`contentdb.milcho.org`), and Cloudflare D1 distributed SQLite.
- **Zero-Downtime Package Delivery:** If upstream registries experience rate limits, cloud outages, or connectivity drops, LuantiHub serves cached package listings and downloads without interruption.
- **Background Sync & Tag Harmonization:** Continuously reconciles upstream package metadata, maintainer lists, and topic tags into local D1 storage.

### 🖼️ Screenshots, Media Gallery & Live Markdown Documentation
- **Full-HD Screenshot Gallery:** Resolves uncompressed full-HD screenshots (`shot-0.png`, `shot-1.png`, etc.) with resilient multi-tier fallback chains and an interactive keyboard-navigable image carousel.
- **Live GFM README Viewer:** Renders repository `README.md` files in real-time inside the package detail modal with responsive formatting, code syntax styling, and sanitized HTML.
- **Visual Type Badges:** Color-coded badges for **Mods**, **Games**, and **Texture Packs** with download counters, author handles, and release history.

### ⭐ Genuine Community Ratings, Reviews & Discussions
- **Independent 1–5 Star Rating System:** Users can submit verified ratings and written reviews stored permanently in Cloudflare D1.
- **Unrated Transparency:** Packages without community ratings cleanly suppress star indicators, avoiding misleading "0-star" penalties for brand new mods.
- **Aggregated Discussion Threads:** Links directly to upstream Luanti forum discussion threads and issue trackers alongside native community feedback.

### 🔐 Multi-Provider Authentication & Role-Based Moderation
- **Universal OAuth 2.0 & PAT Support:** One-click OAuth authentication with Codeberg, GitLab, GitHub, and ContentDB, plus Personal Access Token (PAT) verification for developer automation.
- **Cryptographic HTTP-Only Session Security:** Issues stateless HMAC-SHA256 signed `lh_session` cookies with 30-day lifespans and strict `SameSite=Lax` protection against cross-site scripting (XSS) and token theft.
- **Role-Based Moderation:** Built-in moderation queue for administrators and verified moderators with emergency package delisting and takedown capabilities.

### 🛡️ Edge Security, Rate Limiting & Bot Protection
- **Sliding-Window IP Rate Limiter:** Protects mutation and search endpoints from denial-of-service abuse and credential stuffing at the Cloudflare edge.
- **Scraper & Bot Shield:** Mitigates aggressive automated crawlers on `/api/*` while granting unrestricted access to authentic Luanti in-game clients (`User-Agent: Luanti/5.x`).
- **Cross-Origin Hotlink Protection:** Prevents unauthorized third-party frontend scraping while preserving open in-game and API access.

### 🌍 Multi-Language Localization (i18n)
- **6 Supported Languages:** Fully translated in **English (`en`)**, **Slovak (`sk`)**, **German (`de`)**, **French (`fr`)**, **Spanish (`es`)**, and **Russian (`ru`)**.
- **Instant In-App Switching:** Change languages on the fly via the header selector, with automatic detection from browser preferences or deep-link parameter (`?lang=de`).

### ⚡ Offline-First PWA & Edge SSR SEO
- **Installable PWA:** Install LuantiHub as a desktop or mobile application powered by Angular Service Worker (`@angular/pwa`).
- **Edge Dynamic Meta Tags (SSR):** Cloudflare Pages Functions dynamically inject OpenGraph, Twitter Cards, and schema.org JSON-LD structured metadata at `/package/:author/:name` for rich link previews across Discord, Telegram, and social platforms.
- **Automated Dynamic Sitemap:** Dynamically serves an up-to-date XML sitemap at `/sitemap.xml` for search engine indexing.

---

## 🎮 In-Game Luanti Setup

You can browse, install, and update packages from LuantiHub directly inside your Luanti client by changing the `contentdb_url` setting.

### Option 1: Configuration File (`luanti.conf`)

Add the following line to your `luanti.conf` (or `minetest.conf` on older versions):

```ini
contentdb_url = https://luanti-hub.pages.dev
```

#### Where to find `luanti.conf`:
| Platform | Default Path |
| :--- | :--- |
| **Linux** | `~/.luanti/luanti.conf` *(or `~/.minetest/minetest.conf`)* |
| **Windows** | `%APPDATA%\Luanti\luanti.conf` *(or inside your Luanti install folder)* |
| **macOS** | `~/Library/Application Support/luanti/luanti.conf` |
| **Android** | `/sdcard/Android/data/net.minetest.minetest/files/luanti.conf` |

### Option 2: In-Game Settings UI

1. Launch your **Luanti** client.
2. Click **Settings** &rarr; **All Settings**.
3. In the search box, type `contentdb_url`.
4. Double-click the setting and set the value to `https://luanti-hub.pages.dev`.
5. Click **Save**.
6. Switch to the **Content** tab in the main menu &ndash; you are now browsing LuantiHub!

---

## 🛠️ Getting Started (Local Development)

### Prerequisites

* **Node.js**: `>= 22.22.3` or `>= 24.15.0` (LTS recommended: `v24.x`)
* **npm**: `>= 10.0.0`
* **Git**

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/sakel-hub/luanti-hub.git
cd luanti-hub

# 2. Install dependencies
npm install
```

### Running Locally

#### Mode 1: Frontend Development (`ng serve`)
Ideal for rapid UI, styling, and client-side testing. The app runs on `http://localhost:4200` with mock/in-memory data fallback:

```bash
npm start
```

#### Mode 2: Full-Stack Edge Development (Wrangler + Pages Functions + D1)
Runs the full Cloudflare Pages Functions edge runtime alongside the Angular dev server on `http://localhost:8788`:

```bash
# Run local dev server with Cloudflare proxy
npm run dev:cloudflare
```

#### Database Schema Management

```bash
# Initialize schema on remote Cloudflare D1
npm run db:schema:remote

# Apply migrations on remote Cloudflare D1
npm run db:migrate:remote
```

### Automated Testing & Quality Checks

```bash
# Run unit tests (Vitest)
npm test

# Run strict TypeScript compilation check
npx tsc --noEmit

# Production build
npm run build
```

---

## 🏗️ Tech Stack & Architecture

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Frontend Framework** | [Angular 22](https://angular.dev) | Signals, Standalone Components, `OnPush` Change Detection, typed forms |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) | Modern CSS engine with `@tailwindcss/postcss` & custom dark theme |
| **Icons** | [Lucide Angular](https://lucide.dev) | `@lucide/angular` icons + 2:1 isometric Luanti voxel SVG branding |
| **Edge Compute** | [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/platform/functions/) | Serverless Edge Workers (`/functions/api/...`) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) | Distributed serverless SQLite at the edge |
| **Authentication** | OAuth 2.0 & Web Crypto | HMAC-SHA256 sessions, HTTP-only cookies (`lh_session`), CSRF tokens |
| **Markdown Rendering** | [Marked](https://marked.js.org/) | GitHub-Flavored Markdown (GFM) with live sanitization |
| **PWA & Caching** | Angular Service Worker | `@angular/service-worker`, offline manifests, signal caching |
| **Testing** | [Vitest](https://vitest.dev) | High-speed unit testing for client and edge functions |

---

## ☁️ Cloudflare Production Deployment

LuantiHub deploys effortlessly to **Cloudflare Pages** with a **Cloudflare D1** SQLite database:

### 1. Create the D1 Database

```bash
npx wrangler d1 create luanti-registry-db
```

Paste the returned `database_id` into [`wrangler.toml`](wrangler.toml):

```toml
[[d1_databases]]
binding = "DB"
database_name = "luanti-registry-db"
database_id = "your-database-id-here"
```

Apply the database schema:

```bash
npm run db:schema:remote
```

### 2. Configure Cloudflare Pages Project

In the [Cloudflare Dashboard](https://dash.cloudflare.com/) &rarr; **Workers & Pages** &rarr; **Create application** &rarr; **Pages**:

* **Build command:** `npm run build`
* **Build output directory:** `dist/luanti-hub/browser`
* **Environment variables:** Set `NODE_VERSION = 22` or `24`

### 3. Bind D1 Database

In your Cloudflare Pages project &rarr; **Settings** &rarr; **Bindings**:
* Add a **D1 database** binding:
  * Variable name: `DB`
  * Database: `luanti-registry-db`

### 4. Environment Variables & Secrets

Configure the following variables in Pages project &rarr; **Settings** &rarr; **Variables and secrets** (or refer to [`.env.example`](.env.example)):

| Variable Name | Required | Purpose |
| :--- | :---: | :--- |
| `SESSION_SECRET` | **Yes** | 32+ byte cryptographic secret for HMAC-SHA256 session cookies (`openssl rand -hex 32`). |
| `KILL_SWITCH_SECRET` | Recommended | Bearer secret for emergency CLI/webhook package takedowns. |
| `ADMIN_USERS` | Recommended | Comma-separated list of admin handles (e.g. `admin_handle,github:handle,codeberg:handle`). |
| `ADMIN_SECRET` | Optional | Shared fallback secret for manual admin account verification. |
| `GITHUB_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Optional | GitHub 1-click OAuth integration. |
| `CODEBERG_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Optional | Codeberg 1-click OAuth integration. |
| `GITLAB_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Optional | GitLab 1-click OAuth integration. |
| `CONTENTDB_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Optional | ContentDB 1-click OAuth integration. |

---

## 🤝 Contributing & Translations

We welcome contributions of all kinds: bug reports, feature suggestions, UI polish, and especially **translations**! Please check our [Contributing Guidelines](CONTRIBUTING.md) for full details on development setup, code styles, and workflow.

* **Want to contribute code or translations via Git?** See the step-by-step guide below or in [`CONTRIBUTING.md`](CONTRIBUTING.md).
* **Want to translate without coding?** Submit your translations directly via [GitHub Issues](https://github.com/sakel-hub/luanti-hub/issues/new) using our [issue translation table](CONTRIBUTING.md#-option-3-submitting-translations-via-github-issues-no-code-required).

---

### 🌐 Contributing Translations (i18n)

LuantiHub uses a strictly type-safe, compile-time verified localization system located in [`src/app/core/i18n/`](src/app/core/i18n/). Every translation key is verified by TypeScript, so missing keys or typos are caught at build time.

Currently supported languages:
* 🇬🇧 **English** (`en`) &ndash; Default reference dictionary
* 🇸🇰 **Slovak** (`sk`)
* 🇩🇪 **German** (`de`)
* 🇫🇷 **French** (`fr`)
* 🇪🇸 **Spanish** (`es`)
* 🇷🇺 **Russian** (`ru`)

---

#### Adding a New Language (e.g. Italian `it`, Polish `pl`, Japanese `ja`)

**Step 1: Copy the reference dictionary**

Create your locale file by copying `src/app/core/i18n/locales/en.ts` to `src/app/core/i18n/locales/<localeId>.ts` (e.g. `it.ts`):

```bash
cp src/app/core/i18n/locales/en.ts src/app/core/i18n/locales/it.ts
```

**Step 2: Translate the strings**

Open `src/app/core/i18n/locales/it.ts` and translate the values:

```typescript
import { TranslationDictionary } from '../translation.types';

export const it: TranslationDictionary = {
  header: {
    title: 'LuantiHub',
    subtitle: 'Registro Pacchetti & Hub Contenuti',
    // ...
  },
  // ...
};
```

**Step 3: Register the Locale ID and metadata**

In [`src/app/core/i18n/translation.types.ts`](src/app/core/i18n/translation.types.ts), add your locale ID to `LocaleId` and metadata to `SUPPORTED_LOCALES`:

```typescript
export type LocaleId = 'en' | 'sk' | 'de' | 'fr' | 'es' | 'ru' | 'it';

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  // ...
  { id: 'it', label: 'Italian', nativeLabel: 'Italiano' }
];
```

**Step 4: Register the dictionary in the service**

In [`src/app/core/i18n/translation.service.ts`](src/app/core/i18n/translation.service.ts), import your dictionary and add it to `DICTIONARIES`:

```typescript
import { it } from './locales/it';

const DICTIONARIES: Record<LocaleId, TranslationDictionary> = {
  en,
  sk,
  de,
  fr,
  es,
  ru,
  it
};
```

**Step 5: Verify type-safety**

Run the TypeScript compiler to ensure all dictionary keys are fully satisfied:

```bash
npx tsc --noEmit
```

**Step 6: Test in browser**

Start the development server (`npm start`) and navigate to `http://localhost:4200/?lang=it`, or use the header language selector to switch to your new language.

**Step 7: Submit a Pull Request**

Commit your new files and submit a PR titled `i18n: Add Italian (it) translation`.

---

## 💖 Support

If you find LuantiHub useful, consider supporting its continued open-source development and infrastructure:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/M1E029PWMN)

---

## 📄 License & Legal

* **LuantiHub Source Code:** Licensed under the [GNU Lesser General Public License, version 2.1 or later (LGPL-2.1-or-later)](LICENSE.txt).
* **Game Packages & Mods:** All indexed packages, games, and texture packs remain the property of their respective creators under their declared open-source licenses (SPDX).
* **Luanti Trademark:** Luanti is an open-source voxel game engine created by Perttu Ahola and contributors. LuantiHub is an independent community project and is not officially affiliated with or endorsed by the Luanti core development team.

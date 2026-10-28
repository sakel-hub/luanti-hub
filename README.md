# LuantiHub 🎮⚡

**The Package Registry & Content Hub for Luanti**

[![Luanti Engine](https://img.shields.io/badge/Luanti-5.0+-38bdf8?style=flat-square&logo=cube)](https://www.luanti.org)
[![Angular 22](https://img.shields.io/badge/Angular-22.2-dd0031?style=flat-square&logo=angular)](https://angular.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20D1-f38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20First-emerald-500?style=flat-square)](https://web.dev/progressive-web-apps/)

LuantiHub is a next-generation package discovery platform and decentralized content repository for the [Luanti](https://www.luanti.org) voxel game engine (formerly Minetest). It provides a modern, Netflix-style cinematic web browsing experience while serving as a direct drop-in replacement for the in-game Luanti **Content** tab.

---

## 🌟 Key Features

* **Direct In-Game Luanti Compatibility:** Drop-in compatible with the Luanti engine client. Configure `contentdb_url = https://luanti-hub.pages.dev` in your `luanti.conf` (or legacy `minetest.conf`) to search, download, and update decentralized mods directly inside the game.
* **Decentralized Git Ingestion:** Creators can submit and index their mods directly from **Codeberg**, **GitLab**, or **GitHub** without centralized gatekeeping.
* **High-Availability Fallback Mirror:** Automatically fails over between the official ContentDB API (`content.luanti.org`) and the community mirror (`contentdb.milcho.org`), ensuring uninterrupted uptime for players and server operators.
* **1080p High-Resolution Screenshots:** Automatically resolves and upgrades package screenshots to uncompressed full-HD captures (`shot-0.png`) with resilient multi-tier fallback.
* **Mixed Community Reviews:** Aggregates official ContentDB reviews with native LuantiHub 5-star ratings and discussions into a unified thread.
* **SPDX License & Legal Safeguards:** Automated validation checks code and media licenses against recognized Open Source and Free Culture standards (MIT, LGPL, GPL, CC-BY-SA) under DMCA §512 and EU DSA safe harbor provisions.
* **Multi-Language Support (i18n):** Fully localized in 6 languages: English, German, French, Spanish, Russian, and Slovak.
* **Offline-First PWA:** Installable across desktop and mobile, with background update toasts, offline caching of package manifests, and Web Share API integration.
* **Privacy-First Design:** Zero advertising or tracking cookies. Strictly necessary storage only.

---

## 🎮 In-Game Luanti Configuration

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

1. Launch **Luanti** ➔ Click **Settings** ➔ **All Settings**.
2. Search for `contentdb_url`.
3. Set the value to `https://luanti-hub.pages.dev` and click **Save**.
4. Open the **Content** tab in the main menu to browse packages!

---

## 🚀 Getting Started (Local Development)

### Prerequisites

* **Node.js** `>= 22.0.0` (recommended: `v24.x`)
* **npm** `>= 10.0.0`

### Installation & Run

```bash
# Clone the repository
git clone https://github.com/sakel-hub/luanti-hub.git
cd luanti-hub

# Install dependencies
npm install

# Start the local development server
npm start
```

Open your browser and navigate to `http://localhost:4200`.

---

## 🛠️ Tech Stack & Architecture

| Layer | Technology |
| :--- | :--- |
| **Frontend Framework** | [Angular 22](https://angular.dev) (Signals, Standalone Components, zoneless-ready) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) with `@tailwindcss/postcss` |
| **Icons & Imagery** | Lucide Icons + Hand-crafted 2:1 isometric Luanti voxel vector branding |
| **Hosting & Edge** | [Cloudflare Pages](https://pages.cloudflare.com) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless distributed SQLite) |
| **Edge Functions** | Cloudflare Pages Functions (`/functions/api/...`) |
| **PWA & Caching** | Angular Service Worker (`@angular/pwa`) with offline manifest fallback |

---

## ☁️ Deployment

LuantiHub is designed to run serverless on Cloudflare Pages:

1. **Build Command:** `npm run build`
2. **Build Output Directory:** `dist/luanti-hub/browser`
3. **Functions & Database:** The backend API endpoints in `/functions` connect to Cloudflare D1 via the `DB` binding (schema defined in `functions/schema.sql`).

---

## ⚖️ License & Legal

* **LuantiHub Source Code:** Licensed under the [MIT License](LICENSE).
* **Game Packages & Mods:** All indexed packages remain the property of their respective creators under their declared open-source licenses (SPDX).
* **Luanti:** Luanti is an open-source voxel game engine created by Perttu Ahola and contributors. LuantiHub is an independent community project.

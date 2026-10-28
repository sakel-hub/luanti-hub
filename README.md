# LuantiHub 🎮⚡

**The Decentralized Package Registry & Content Hub for Luanti (formerly Minetest)**

[![Luanti Engine](https://img.shields.io/badge/Luanti-5.0+-38bdf8?style=flat-square&logo=cube)](https://www.luanti.org)
[![Angular 22](https://img.shields.io/badge/Angular-22.2-dd0031?style=flat-square&logo=angular)](https://angular.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20D1-f38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20First-emerald-500?style=flat-square)](https://web.dev/progressive-web-apps/)

LuantiHub is a next-generation package discovery platform and decentralized content repository for Luanti voxel game mods, games, and texture packs. It delivers a modern, Netflix-style cinematic browsing experience on the web while serving as a direct drop-in replacement for the in-game Luanti **Content** tab.

---

## 🌟 Key Features

* **In-Game Content Tab Compatibility:** Seamlessly compatible with the Luanti game engine. Simply configure `contentdb_url = https://luanti-hub.pages.dev` in your `minetest.conf` to search, download, and update decentralized mods directly inside the game client.
* **Decentralized Git Ingestion:** Creators can submit and index their mods directly from **GitHub**, **Codeberg**, or **GitLab** without centralized bottlenecks or mod storage costs.
* **High-Availability Fallback Mirror:** Automatically fails over between the official ContentDB API (`content.luanti.org`) and the community mirror (`contentdb.milcho.org`), ensuring 100% uptime for players and server operators.
* **Mixed Community Reviews:** Aggregates official ContentDB reviews with native LuantiHub community comments and star ratings into a unified discussion thread.
* **SPDX License & Legal Protection:** Automated gatekeeping checks code and media licenses against recognized Open Source and Free Culture standards (MIT, LGPL, GPL, CC-BY-SA), maintaining Safe Harbor compliance under DMCA §512 and EU DSA.
* **Netflix-Style UI:** Features an immersive hero billboard, horizontal smooth-scrolling swimlanes, interactive card hover expansions, and detailed mod drawers.
* **Offline-First PWA:** Installable across desktop and mobile, with automatic background update toasts, offline caching of package manifests, and Web Share API integration.

---

## 🚀 Quick Start (Local Development)

### Prerequisites
* **Node.js** >= `v24.0.0`
* **npm** >= `11.0.0`

```bash
# Clone the repository
cd /Users/juraj/Documents/gits/luanti-hub

# Install dependencies
npm install

# Start local Angular development server
npm start
```

Navigate to `http://localhost:4200` to explore the catalog!

---

## ☁️ Free Cloudflare Deployment Guide

LuantiHub runs 100% free on Cloudflare's serverless edge ecosystem:

### 1. Create Cloudflare D1 Database
```bash
# Login to Cloudflare CLI
npx wrangler login

# Create the free D1 database
npx wrangler d1 create luanti-registry-db

# Run schema migrations
npx wrangler d1 execute luanti-registry-db --file=./functions/schema.sql
```

Copy the generated `database_id` into `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "luanti-registry-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 2. Connect to Cloudflare Pages
1. Go to [Cloudflare Dashboard ➔ Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages).
2. Click **Create Application** ➔ **Pages** ➔ **Connect to Git**.
3. Select your GitHub repository.
4. Set build settings:
   * **Framework:** `Angular`
   * **Build command:** `npm run build`
   * **Output directory:** `dist/luanti-hub/browser`
5. Under **Settings ➔ Functions ➔ D1 Database Bindings**, bind `DB` to `luanti-registry-db`.
6. Click **Save and Deploy**!

---

## 🎮 In-Game Luanti Configuration

To browse and install mods from LuantiHub directly inside Luanti:

### Option A: `minetest.conf`
Add this line to your `minetest.conf`:
```ini
contentdb_url = https://luanti-hub.pages.dev
```

### Option B: Settings GUI
1. Launch **Luanti** ➔ Click **Settings** ➔ **All Settings**.
2. Search for `contentdb_url`.
3. Enter `https://luanti-hub.pages.dev` and click **Save**.
4. Open the **Content** tab in-game!

---

## ⚖️ Legal & DMCA Compliance
LuantiHub functions strictly as an information directory and linking platform. Mod archives are downloaded directly from the creator's Git forge release endpoints. For copyright issues or unauthorized asset reports, email `dmca@luantihub.org` for immediate delisting.

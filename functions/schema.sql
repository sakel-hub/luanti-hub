-- LuantiHub Multi-Provider D1 Database Schema
-- Run with: npx wrangler d1 execute luanti-registry-db --remote --file=./functions/schema.sql

-- 1. Core Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                 -- UUID for LuantiHub core account
    username TEXT UNIQUE NOT NULL,       -- Display / Profile handle
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Multi-Provider Linked Identities (Codeberg, GitLab, GitHub, ContentDB)
CREATE TABLE IF NOT EXISTS user_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,               -- Foreign key to users(id)
    provider TEXT NOT NULL,              -- 'codeberg', 'gitlab', 'github', 'contentdb'
    provider_user_id TEXT NOT NULL,      -- Provider's unique account ID
    provider_username TEXT NOT NULL,     -- Username on that platform
    profile_url TEXT,
    avatar_url TEXT,
    verified BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Packages Table (Mods, Games, Texture Packs, Modpacks)
CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,                 -- "author/name" (e.g. "sakel/sky_realm")
    author_id TEXT,                      -- Foreign key to users(id)
    author_name TEXT NOT NULL,
    name TEXT NOT NULL,                  -- Technical name from mod.conf
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('mod', 'game', 'txp', 'modpack')) NOT NULL,
    short_desc TEXT,
    long_desc TEXT,
    repo_url TEXT NOT NULL,
    provider TEXT DEFAULT 'github',      -- 'codeberg', 'gitlab', 'github', 'contentdb'
    default_branch TEXT DEFAULT 'master',
    thumbnail_url TEXT,
    banner_url TEXT,
    license TEXT NOT NULL,
    media_license TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'flagged', 'delisted')),
    downloads_count INTEGER DEFAULT 0,
    score REAL DEFAULT 5.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id)
);

-- 4. Releases Table (Git Release Archives)
CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id TEXT NOT NULL,
    version TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    download_url TEXT NOT NULL,
    min_minetest_version TEXT DEFAULT '5.0.0',
    max_minetest_version TEXT,
    changelog TEXT,
    released_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

-- 5. Community Reviews & Ratings (1 to 5 Stars)
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER CHECK(rating BETWEEN 1 AND 5) NOT NULL,
    title TEXT,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, user_id),
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indices for rapid querying by Luanti game engine and web search
CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_provider ON user_identities(provider, provider_username);
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_author ON packages(author_name);
CREATE INDEX IF NOT EXISTS idx_reviews_pkg ON reviews(package_id);

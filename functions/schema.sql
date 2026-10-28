-- LuantiHub Cloudflare D1 Database Schema
-- Run with: npx wrangler d1 execute luanti-registry-db --file=./functions/schema.sql

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,                -- "author/name"
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    name TEXT NOT NULL,                 -- technical name from mod.conf
    title TEXT NOT NULL,
    type TEXT CHECK(type IN ('mod', 'game', 'txp', 'modpack')) NOT NULL,
    short_desc TEXT,
    long_desc TEXT,
    repo_url TEXT NOT NULL,
    default_branch TEXT DEFAULT 'master',
    thumbnail_url TEXT,
    banner_url TEXT,
    license TEXT NOT NULL,
    media_license TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'flagged', 'delisted')),
    downloads_count INTEGER DEFAULT 0,
    score REAL DEFAULT 5.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

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
    FOREIGN KEY (package_id) REFERENCES packages(id)
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER CHECK(rating BETWEEN 1 AND 5),
    title TEXT,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (package_id) REFERENCES packages(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indices for rapid querying by the in-game Luanti content tab
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);

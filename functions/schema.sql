-- LuantiHub Multi-Provider D1 Database Schema
-- Run locally:  npx wrangler d1 execute luanti-registry-db --local --file=./functions/schema.sql
-- Run remotely: npx wrangler d1 execute luanti-registry-db --remote --file=./functions/schema.sql

-- 1. Core Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                 -- UUID for LuantiHub core account
    username TEXT UNIQUE NOT NULL,       -- Display / Profile handle
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    role TEXT DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin')),
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
    id TEXT PRIMARY KEY,                 -- "author/name" (e.g. "creator/sky_realm")
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
    tags TEXT,                           -- JSON array of tag strings
    dependencies TEXT,                   -- JSON array of required dependency names
    optional_dependencies TEXT,          -- JSON array of optional dependency names
    min_minetest_version TEXT DEFAULT '5.0.0',
    max_minetest_version TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'flagged', 'delisted')),
    status_reason TEXT,                  -- Reason for flag/delist (e.g. DMCA, Malware)
    flagged_at DATETIME,
    downloads_count INTEGER DEFAULT 0,
    contentdb_downloads INTEGER DEFAULT 0,
    luantihub_downloads INTEGER DEFAULT 0,
    download_size INTEGER,
    file_size TEXT,
    donate_url TEXT,
    translation_url TEXT,
    forum_url TEXT,
    issue_tracker TEXT,
    video_url TEXT,
    video_thumbnail_url TEXT,
    dev_state TEXT,
    provides TEXT,
    content_warnings TEXT,               -- JSON array of content warning identifiers
    ai_disclosures TEXT,                 -- JSON array of AI disclosure identifiers
    maintainers TEXT,                    -- JSON array of maintainer handles
    score REAL DEFAULT 0,
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

-- 6. Daily Download Metrics (Top 10 Today & Week Rollups)
CREATE TABLE IF NOT EXISTS package_daily_downloads (
    package_id TEXT NOT NULL,                         -- "author/name"
    download_date DATE NOT NULL DEFAULT (DATE('now')), -- YYYY-MM-DD
    downloads_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (package_id, download_date)
);

-- 7. User Favorites (Synced across devices when logged in)
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, package_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 8. Per-User Package Download History & Counts (For Personalized Match Scoring)
CREATE TABLE IF NOT EXISTS user_downloads (
    user_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 1,
    last_downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, package_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. Moderation & Abuse Reports Queue (Supports Instant Kill Switch, Author Communication & Auto-Healing)
CREATE TABLE IF NOT EXISTS moderation_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id TEXT NOT NULL,
    reporter_user_id TEXT,
    reason TEXT CHECK(reason IN ('dmca', 'malware', 'license', 'broken', 'inappropriate', 'other')) NOT NULL,
    details TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
    resolution_note TEXT,
    resolved_by TEXT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indices for rapid querying by Luanti game engine, web search, moderation, and Top 10 rollups
CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_provider ON user_identities(provider, provider_username);
CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_author ON packages(author_name);
CREATE INDEX IF NOT EXISTS idx_reviews_pkg ON reviews(package_id);
CREATE INDEX IF NOT EXISTS idx_pkg_downloads_date_count ON package_daily_downloads (download_date, downloads_count DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_downloads_user ON user_downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON moderation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_pkg ON moderation_reports(package_id);

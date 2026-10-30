-- =============================================================================
-- LUANTIHUB D1 INCREMENTAL MIGRATION (EXACT DIFF FROM INITIAL SCHEMA)
-- Run with: npm run db:migrate:remote
-- =============================================================================

-- 1. Previously applied column migrations (commented out as SQLite rejects duplicate columns):
-- ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK(role IN ('user', 'moderator', 'admin'));
-- ALTER TABLE packages ADD COLUMN tags TEXT;
-- ALTER TABLE packages ADD COLUMN dependencies TEXT;
-- ALTER TABLE packages ADD COLUMN optional_dependencies TEXT;
-- ALTER TABLE packages ADD COLUMN min_minetest_version TEXT DEFAULT '5.0.0';
-- ALTER TABLE packages ADD COLUMN status_reason TEXT;
-- ALTER TABLE packages ADD COLUMN flagged_at DATETIME;

-- 2. Create Moderation & Abuse Reports Queue table (Idempotent)
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

-- 3. Create indices for moderation_reports
CREATE INDEX IF NOT EXISTS idx_reports_status ON moderation_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_pkg ON moderation_reports(package_id);

-- 4. Create user_downloads table for personalized match scoring & history sync (Idempotent)
CREATE TABLE IF NOT EXISTS user_downloads (
    user_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 1,
    last_downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, package_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_downloads_user ON user_downloads(user_id);

-- 5. Recalculate package scores strictly from actual community reviews (clears legacy DEFAULT 5.0 scores)
UPDATE packages SET score = COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE LOWER(r.package_id) = LOWER(packages.id)), 0);

-- 6. Separate ContentDB vs Luanti Hub download counters and extended ContentDB metadata columns
-- (Also auto-initialized at runtime by the Worker via ensureExtendedPackageColumns if not yet migrated)
-- ALTER TABLE packages ADD COLUMN contentdb_downloads INTEGER DEFAULT 0;
-- ALTER TABLE packages ADD COLUMN luantihub_downloads INTEGER DEFAULT 0;
-- ALTER TABLE packages ADD COLUMN download_size INTEGER;
-- ALTER TABLE packages ADD COLUMN file_size TEXT;
-- ALTER TABLE packages ADD COLUMN donate_url TEXT;
-- ALTER TABLE packages ADD COLUMN translation_url TEXT;
-- ALTER TABLE packages ADD COLUMN forum_url TEXT;
-- ALTER TABLE packages ADD COLUMN issue_tracker TEXT;
-- ALTER TABLE packages ADD COLUMN video_url TEXT;
-- ALTER TABLE packages ADD COLUMN video_thumbnail_url TEXT;
-- ALTER TABLE packages ADD COLUMN dev_state TEXT;
-- ALTER TABLE packages ADD COLUMN provides TEXT;
-- ALTER TABLE packages ADD COLUMN content_warnings TEXT;
-- ALTER TABLE packages ADD COLUMN ai_disclosures TEXT;
-- ALTER TABLE packages ADD COLUMN maintainers TEXT;
-- ALTER TABLE packages ADD COLUMN max_minetest_version TEXT;




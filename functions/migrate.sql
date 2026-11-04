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
-- ALTER TABLE packages ADD COLUMN screenshots TEXT;
-- ALTER TABLE packages ADD COLUMN game_support TEXT;
-- ALTER TABLE packages ADD COLUMN review_thread_counts TEXT;

-- 7. Granular daily download & view telemetry columns for Author Analytics Dashboard
-- (Also auto-initialized at runtime by the Worker via ensureExtendedPackageColumns)
-- ALTER TABLE package_daily_downloads ADD COLUMN platform_luanti INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN platform_web INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN reason_new INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN reason_update INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN reason_dependency INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN reason_web INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN views_luanti INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE package_daily_downloads ADD COLUMN views_web INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE packages ADD COLUMN latest_commit_sha TEXT;

-- 8. Per-User Package View History & Counts (Idempotent)
CREATE TABLE IF NOT EXISTS user_views (
    user_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 1,
    last_viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, package_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_views_user ON user_views(user_id, last_viewed_at DESC);

-- 9. Hero Banner Promotions & Scheduled Community Highlights (+ Promotional Package Row #1) (Idempotent)
CREATE TABLE IF NOT EXISTS promotions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    short_desc TEXT NOT NULL,
    banner_url TEXT NOT NULL DEFAULT '/promo.png',
    badge_text TEXT,
    cta_label TEXT NOT NULL DEFAULT 'Learn More',
    cta_url TEXT NOT NULL DEFAULT '/',
    secondary_cta_label TEXT,
    secondary_cta_url TEXT,
    starts_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    priority INTEGER DEFAULT 100,
    show_in_hero INTEGER DEFAULT 1,
    row_enabled INTEGER DEFAULT 0,
    row_title TEXT,
    row_subtitle TEXT,
    row_icon TEXT DEFAULT 'trophy',
    row_filter_tags TEXT,
    row_filter_type TEXT DEFAULT 'all',
    row_filter_source TEXT DEFAULT 'all',
    row_filter_author TEXT,
    row_filter_query TEXT,
    row_pinned_packages TEXT,
    row_sort_by TEXT DEFAULT 'newest',
    row_show_empty_cta INTEGER DEFAULT 1,
    translations TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promotions_window ON promotions(expires_at, priority DESC);

-- 10. Runtime hero_promotions table & Unified Tags Mirror (Idempotent)
CREATE TABLE IF NOT EXISTS hero_promotions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    short_desc TEXT NOT NULL,
    banner_url TEXT NOT NULL DEFAULT '/promo.png',
    cta_label TEXT NOT NULL DEFAULT 'Learn More',
    cta_url TEXT NOT NULL DEFAULT '/',
    secondary_cta_label TEXT,
    secondary_cta_url TEXT,
    badge_text TEXT NOT NULL DEFAULT 'PROMOTED',
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    show_in_hero INTEGER NOT NULL DEFAULT 1,
    row_enabled INTEGER NOT NULL DEFAULT 0,
    row_title TEXT,
    row_subtitle TEXT,
    row_icon TEXT DEFAULT 'trophy',
    row_filter_tags TEXT,
    row_filter_type TEXT DEFAULT 'all',
    row_filter_source TEXT DEFAULT 'all',
    row_filter_author TEXT,
    row_filter_query TEXT,
    row_pinned_packages TEXT,
    row_sort_by TEXT DEFAULT 'newest',
    row_show_empty_cta INTEGER NOT NULL DEFAULT 1,
    translations TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hero_promotions_window ON hero_promotions(expires_at, priority DESC);

CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT DEFAULT 'contentdb',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_tag_packages (
    tag_name TEXT NOT NULL,
    package_id TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tag_name, package_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_tag_pkgs_tag ON promo_tag_packages(LOWER(tag_name));

-- 11. Sandbox Monthly Quota Circuit Breaker Ledger (Idempotent)
CREATE TABLE IF NOT EXISTS sandbox_quota_usage (
    billing_cycle TEXT PRIMARY KEY,
    awake_seconds INTEGER NOT NULL DEFAULT 0,
    memory_gib_seconds REAL NOT NULL DEFAULT 0,
    disk_gb_seconds REAL NOT NULL DEFAULT 0,
    cpu_vcpu_seconds REAL NOT NULL DEFAULT 0,
    sessions_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);




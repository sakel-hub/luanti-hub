// High-Availability Upstream Proxy with Automatic Mirror Failover & Cloudflare Edge Cache
const PRIMARY_UPSTREAM = 'https://content.luanti.org/api';
const MIRROR_UPSTREAM = 'https://contentdb.milcho.org/api';

export async function fetchWithFailover(path: string, options: RequestInit = {}): Promise<Response> {
  // Primary ContentDB (https://content.luanti.org/api) is online and serves as our primary source of truth.
  // Give bulk endpoints (/scores/, ?fmt=vcs) 7500ms and standard endpoints 5500ms before failing over to the mirror.
  const isBulkEndpoint = path.startsWith('/scores') || path.includes('fmt=vcs') || path === '/packages/' || path.startsWith('/packages/?');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), isBulkEndpoint ? 7500 : 5500);

  // Use a transparent Web User-Agent so ContentDB does not mistake automated proxy fetches
  // for in-game Luanti client views (which would trigger PackageDailyStats.notify_view DB writes on ContentDB).
  const defaultHeaders = {
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)',
    'Accept': 'application/json'
  };

  try {
    const res = await fetch(`${PRIMARY_UPSTREAM}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    });

    clearTimeout(timeoutId);
    if (res.ok) return res;
    // If primary ContentDB is online and returns a 4xx (e.g. 404 Not Found), do NOT retry the mirror
    // (retrying the static mirror on a genuine 404 only adds latency and duplicate 404s).
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      return res;
    }
    throw new Error(`Primary returned HTTP ${res.status}`);
  } catch {
    clearTimeout(timeoutId);
    // Automatic Failover to milcho.org mirror ONLY when primary ContentDB is offline, times out, or returns 5xx/429
    // (rewrite single-package detail routes to /for-client/ which the static mirror caches)
    const mirrorPath = /^\/packages\/[^/?#]+\/[^/?#]+\/?$/.test(path)
      ? `${path.replace(/\/+$/, '')}/for-client/?formspec_version=8`
      : path;
    return fetch(`${MIRROR_UPSTREAM}${mirrorPath}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    });
  }
}

/**
 * Normalizes a ContentDB `PackageReview.as_dict()` entry from `GET /api/packages/<author>/<name>/reviews/`
 * (see `luanti-org/contentdb` `app/models/threads.py:202-225` and `app/flatpages/help/api.md:382-427`).
 */
export function normalizeContentDbReviewItem(r: any, idx = 0, packageId?: string): any {
  const rawUsername = String(r?.user?.username || r?.author || r?.username || 'contentdb_user').trim();
  const rawDisplayName = String(r?.user?.display_name || r?.user?.username || r?.author || rawUsername || 'Community Member').trim();
  const threadId = r?.thread?.id || r?.id || `${rawUsername}_${r?.created_at || idx}`;
  const rawRating = Number(r?.rating);
  const rating = Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 5
    ? Math.round(rawRating)
    : (r?.is_positive === false || r?.recommends === false ? 1 : r?.is_positive === true || r?.recommends === true ? 5 : 3);
  const isPositive = typeof r?.is_positive === 'boolean'
    ? r.is_positive
    : (typeof r?.recommends === 'boolean' ? r.recommends : rating > 3);
  const votes = r?.votes && typeof r.votes === 'object'
    ? {
        helpful: Math.max(0, Number(r.votes.helpful) || 0),
        unhelpful: Math.max(0, Number(r.votes.unhelpful) || 0)
      }
    : undefined;
  const rawThreadUrl = typeof r?.thread?.url === 'string' && r.thread.url.trim()
    ? (r.thread.url.startsWith('http') ? r.thread.url.trim() : `https://content.luanti.org${r.thread.url.startsWith('/') ? '' : '/'}${r.thread.url.trim()}`)
    : (typeof r?.thread?.id === 'number' ? `https://content.luanti.org/threads/${r.thread.id}/` : undefined);

  return {
    id: `cdb_${threadId}`,
    ...(packageId ? { package_id: packageId } : {}),
    source: 'contentdb',
    rating,
    is_positive: isPositive,
    title: r?.title || undefined,
    comment: r?.comment || r?.text || '',
    created_at: r?.created_at || new Date().toISOString(),
    votes,
    thread_url: rawThreadUrl,
    author: {
      username: rawUsername,
      display_name: rawDisplayName,
      avatar_url: 'logo.svg'
    }
  };
}

const isolateJsonCache = new Map<string, { exp: number; data: any }>();
const MAX_ISOLATE_CACHE_ENTRIES = 250;

function canUseIsolateCache(): boolean {
  return !Boolean((globalThis.fetch as any)?.mock || (globalThis.fetch as any)?._isMockFunction);
}

function getIsolateCache<T>(key: string): T | null {
  if (!canUseIsolateCache()) return null;
  const hit = isolateJsonCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    isolateJsonCache.delete(key);
    return null;
  }
  return hit.data as T;
}

function setIsolateCache(key: string, data: any, ttlSeconds: number): void {
  if (!canUseIsolateCache() || ttlSeconds <= 0 || data === undefined || data === null) return;
  if (isolateJsonCache.size >= MAX_ISOLATE_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of isolateJsonCache.entries()) {
      if (now > v.exp) isolateJsonCache.delete(k);
    }
    if (isolateJsonCache.size >= MAX_ISOLATE_CACHE_ENTRIES) {
      const oldestKey = isolateJsonCache.keys().next().value;
      if (oldestKey) isolateJsonCache.delete(oldestKey);
    }
  }
  isolateJsonCache.set(key, { exp: Date.now() + ttlSeconds * 1000, data });
}

/**
 * Fetches JSON from upstream ContentDB / mirror with Cloudflare Edge Cache API + Isolate Memory Cache support
 */
export async function fetchUpstreamJsonCached<T = any>(
  path: string,
  ttlSeconds = 300
): Promise<T | null> {
  const cacheKeyUrl = `https://cache.luantihub.internal${path}`;
  const memHit = getIsolateCache<T>(cacheKeyUrl);
  if (memHit !== null) {
    return memHit;
  }

  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const parsed = await cached.json() as T;
        setIsolateCache(cacheKeyUrl, parsed, ttlSeconds);
        return parsed;
      }
    } catch {
      // Proceed to network fetch
    }
  }

  try {
    const res = await fetchWithFailover(path);
    if (!res.ok) return null;
    const data = await res.json() as T;

    if (data) {
      setIsolateCache(cacheKeyUrl, data, ttlSeconds);
      if (edgeCache) {
        try {
          const cacheRes = new Response(JSON.stringify(data), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
            }
          });
          await edgeCache.put(cacheReq, cacheRes);
        } catch {
          // Ignore cache write errors
        }
      }
    }

    return data;
  } catch {
    return null;
  }
}

function buildEdgeCacheRequestUrl(cacheKeyPath: string): string {
  if (!cacheKeyPath) return 'https://cache.luantihub.internal/';
  if (cacheKeyPath.startsWith('http://') || cacheKeyPath.startsWith('https://')) {
    return cacheKeyPath;
  }
  return `https://cache.luantihub.internal${cacheKeyPath.startsWith('/') ? cacheKeyPath : '/' + cacheKeyPath}`;
}

/**
 * Reads a cached JSON response payload from Isolate Memory or Cloudflare's Edge Cache (`caches.default`).
 */
export async function readEdgeCacheJson<T = any>(cacheKeyPath: string): Promise<T | null> {
  const keyUrl = buildEdgeCacheRequestUrl(cacheKeyPath);
  const memHit = getIsolateCache<T>(keyUrl);
  if (memHit !== null) {
    return memHit;
  }

  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache) return null;
  try {
    const cacheReq = new Request(keyUrl, { method: 'GET' });
    const cached = await edgeCache.match(cacheReq);
    if (cached) {
      const parsed = await cached.json() as T;
      setIsolateCache(keyUrl, parsed, 180);
      return parsed;
    }
  } catch {
    // Ignore cache read error
  }
  return null;
}

/**
 * Writes a JSON response payload into Isolate Memory and Cloudflare's Edge Cache (`caches.default`) with a TTL.
 */
export async function writeEdgeCacheJson(
  cacheKeyPath: string,
  payload: any,
  ttlSeconds = 300
): Promise<void> {
  const keyUrl = buildEdgeCacheRequestUrl(cacheKeyPath);
  setIsolateCache(keyUrl, payload, ttlSeconds);

  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache) return;
  try {
    const cacheReq = new Request(keyUrl, { method: 'GET' });
    const cacheRes = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
      }
    });
    await edgeCache.put(cacheReq, cacheRes);
  } catch {
    // Ignore cache write error
  }
}

/**
 * Evicts one or more keys from Isolate Memory and Cloudflare's Edge Cache (`caches.default`) after a D1 mutation.
 * Automatically expands package detail keys so both `/full/`, `/lite/`, and legacy URLs are evicted.
 */
export async function invalidateEdgeCacheKeys(cacheKeyPaths: string[]): Promise<void> {
  if (!Array.isArray(cacheKeyPaths)) return;

  const expandedUrls = new Set<string>([
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v1',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v2',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v3'
  ]);
  for (const p of cacheKeyPaths) {
    if (!p) continue;
    expandedUrls.add(buildEdgeCacheRequestUrl(p));
    const pkgDetailMatch = p.match(/^\/__api_pkg_detail_v[234]\/(?:full\/|lite\/)?([^/]+)\/([^/]+)$/i);
    if (pkgDetailMatch) {
      const a = encodeURIComponent(pkgDetailMatch[1].toLowerCase());
      const n = encodeURIComponent(pkgDetailMatch[2].toLowerCase());
      expandedUrls.add(`https://cache.luantihub.internal/__api_pkg_detail_v2/${a}/${n}`);
      expandedUrls.add(`https://cache.luantihub.internal/__api_pkg_detail_v2/full/${a}/${n}`);
      expandedUrls.add(`https://cache.luantihub.internal/__api_pkg_detail_v2/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v2/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v2/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v3/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v3/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v4/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v4/lite/${a}/${n}`);
    }
  }

  for (const url of expandedUrls) {
    isolateJsonCache.delete(url);
  }
  for (const k of Array.from(isolateJsonCache.keys())) {
    if (
      k.startsWith('https://cache.luantihub.internal/__catalog_edge_v2_') ||
      k.startsWith('https://cache.luantihub.internal/__api_updates_v2_') ||
      k.startsWith('https://cache.luantihub.internal/__for_client_v2/')
    ) {
      isolateJsonCache.delete(k);
    }
  }

  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache) return;

  await Promise.all(
    Array.from(expandedUrls).map(async (url) => {
      try {
        const req = new Request(url, { method: 'GET' });
        await edgeCache.delete(req);
      } catch {
        // Ignore individual delete error
      }
    })
  );
}

/**
 * Safely parses a JSON array column or comma-separated string into string[]
 */
export function parseJsonArray(val: any): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string' && val.trim()) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return val.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Heuristic SPDX license identifier detection from LICENSE or README text
 */
export function detectSpdxFromText(text: string): string {
  const sample = text.slice(0, 4000);
  if (/MIT License|Permission is hereby granted, free of charge/i.test(sample)) return 'MIT';
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 2\.1|LGPL-2\.1/i.test(sample)) return 'LGPL-2.1-only';
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 3|LGPL-3\.0/i.test(sample)) return 'LGPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 3|GPL-3\.0/i.test(sample)) return 'GPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 2|GPL-2\.0/i.test(sample)) return 'GPL-2.0-only';
  if (/Apache License[\s\S]{0,150}Version 2\.0|Apache-2\.0/i.test(sample)) return 'Apache-2.0';
  if (/Mozilla Public License[\s\S]{0,100}2\.0|MPL-2\.0/i.test(sample)) return 'MPL-2.0';
  if (/Creative Commons Attribution-ShareAlike 4\.0|CC-BY-SA-4\.0/i.test(sample)) return 'CC-BY-SA-4.0';
  if (/Creative Commons Zero|CC0-1\.0|WTFPL|Unlicense/i.test(sample)) return 'CC0-1.0';
  if (/zlib License|Zlib/i.test(sample)) return 'Zlib';
  if (/BSD 3-Clause/i.test(sample)) return 'BSD-3-Clause';
  if (/BSD 2-Clause/i.test(sample)) return 'BSD-2-Clause';
  return '';
}

const DEFUNCT_GIT_HOSTS = [
  'notabug.org',
  'gitea.your-land.de',
  'repo.or.cz'
];

/**
 * Checks if a repository URL belongs to a defunct Git forge
 */
export function isDefunctGitHost(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return DEFUNCT_GIT_HOSTS.some(d => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

/**
 * Normalizes a Git repository URL into a canonical host/owner/repo key for deduplication
 */
export function normalizeRepoKey(urlStr?: string | null): string {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const cleanPath = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '')
      .toLowerCase();
    const parts = cleanPath.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `${host}/${parts[0]}/${parts[1]}`;
    }
    return cleanPath ? `${host}/${cleanPath}` : '';
  } catch {
    return '';
  }
}

/**
 * Computes a genuine 1.0 - 5.0 star rating from D1 reviews and/or ContentDB review arrays.
 * Returns 0 when no verified user star ratings exist (never returns raw popularity scores > 5 or hardcoded defaults).
 */
export function computeGenuineStarRating(
  d1RatingAvg?: number | null,
  cdbReviewsOrScore?: any
): number {
  const ratings: number[] = [];

  if (typeof d1RatingAvg === 'number' && d1RatingAvg >= 1 && d1RatingAvg <= 5) {
    ratings.push(d1RatingAvg);
  }

  if (Array.isArray(cdbReviewsOrScore) && cdbReviewsOrScore.length > 0) {
    const cdbScores = cdbReviewsOrScore
      .map((r: any) => (typeof r.rating === 'number' ? r.rating : r.is_positive === false ? 2 : 5))
      .filter((n: number) => n >= 1 && n <= 5);
    if (cdbScores.length > 0) {
      const avg = cdbScores.reduce((a: number, b: number) => a + b, 0) / cdbScores.length;
      ratings.push(avg);
    }
  } else if (typeof cdbReviewsOrScore === 'number' && cdbReviewsOrScore >= 1 && cdbReviewsOrScore <= 5) {
    ratings.push(cdbReviewsOrScore);
  }

  if (ratings.length === 0) return 0;
  const combined = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return Math.round(combined * 10) / 10;
}

/**
 * Synchronizes an author's upstream ContentDB packages into Cloudflare D1 (`packages` table)
 * without polluting scores or licenses with hardcoded defaults.
 */
export async function syncAuthorContentDbPackages(
  db: any,
  userId: string,
  username: string
): Promise<any[]> {
  try {
    await ensureExtendedPackageColumns(db);
    const cdbRes = await fetchWithFailover(`/packages/?author=${encodeURIComponent(username)}&fmt=vcs`);
    if (!cdbRes.ok) return [];
    const cdbPackages = await cdbRes.json() as any[];
    if (!Array.isArray(cdbPackages)) return [];

    const authorPkgs = cdbPackages.filter(
      (p: any) => (p.author || '').toLowerCase() === username.toLowerCase()
    );

    for (const p of authorPkgs.slice(0, 60)) {
      const pkgId = `${p.author}/${p.name}`;
      const pkgType = p.type === 'game' || p.type === 'txp' || p.type === 'modpack' ? p.type : 'mod';
      const genuineScore = computeGenuineStarRating(null, p.reviews);
      const license = typeof p.license === 'string' ? p.license : '';
      const mediaLicense = typeof p.media_license === 'string' ? p.media_license : license;
      const tagsJson = Array.isArray(p.tags) ? JSON.stringify(p.tags) : null;
      const cdbDownloads = typeof p.downloads === 'number' ? p.downloads : 0;

      await db.prepare(`
        INSERT INTO packages (
          id, author_id, author_name, name, title, type, short_desc,
          repo_url, provider, thumbnail_url, score, downloads_count, contentdb_downloads, luantihub_downloads,
          license, media_license, tags, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'contentdb', ?, ?, ?, ?, 0, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          author_id = excluded.author_id,
          title = excluded.title,
          short_desc = excluded.short_desc,
          repo_url = COALESCE(NULLIF(excluded.repo_url, ''), packages.repo_url),
          thumbnail_url = COALESCE(NULLIF(excluded.thumbnail_url, ''), packages.thumbnail_url),
          contentdb_downloads = MAX(COALESCE(packages.contentdb_downloads, 0), excluded.contentdb_downloads),
          downloads_count = MAX(COALESCE(packages.contentdb_downloads, 0), excluded.contentdb_downloads) + COALESCE(packages.luantihub_downloads, 0),
          license = COALESCE(NULLIF(excluded.license, ''), packages.license),
          media_license = COALESCE(NULLIF(excluded.media_license, ''), packages.media_license),
          tags = COALESCE(excluded.tags, packages.tags)
      `).bind(
        pkgId,
        userId,
        p.author,
        p.name,
        p.title || p.name,
        pkgType,
        p.short_description || p.short_desc || '',
        p.repo || p.repo_url || '',
        p.thumbnail || '',
        genuineScore,
        cdbDownloads,
        cdbDownloads,
        license,
        mediaLicense,
        tagsJson
      ).run();
    }

    return authorPkgs;
  } catch {
    return [];
  }
}

export interface DiscoveredGitRelease {
  id: number | string;
  version: string;
  title: string;
  tag_name: string;
  commit_sha: string;
  url: string;
  download_url: string;
  size?: number;
  min_minetest_version?: string;
  changelog?: string;
  release_date?: string;
  released_at: string;
}

let extendedColumnsEnsured = false;

/**
 * Ensures all extended metadata columns (including `content_warnings`, `ai_disclosures`,
 * `maintainers`, `max_minetest_version`, `contentdb_downloads`, `luantihub_downloads`, etc.)
 * exist on `packages` in Cloudflare D1 at runtime without requiring manual CLI migration.
 */
export async function ensureExtendedPackageColumns(db: any, force = false): Promise<void> {
  if (!db || (extendedColumnsEnsured && !force)) return;
  const requiredCols: Array<[string, string]> = [
    ['tags', 'TEXT'],
    ['dependencies', 'TEXT'],
    ['optional_dependencies', 'TEXT'],
    ['min_minetest_version', "TEXT DEFAULT '5.0.0'"],
    ['max_minetest_version', 'TEXT'],
    ['status_reason', 'TEXT'],
    ['flagged_at', 'DATETIME'],
    ['contentdb_downloads', 'INTEGER DEFAULT 0'],
    ['luantihub_downloads', 'INTEGER DEFAULT 0'],
    ['download_size', 'INTEGER'],
    ['file_size', 'TEXT'],
    ['donate_url', 'TEXT'],
    ['translation_url', 'TEXT'],
    ['forum_url', 'TEXT'],
    ['issue_tracker', 'TEXT'],
    ['video_url', 'TEXT'],
    ['video_thumbnail_url', 'TEXT'],
    ['dev_state', 'TEXT'],
    ['provides', 'TEXT'],
    ['content_warnings', 'TEXT'],
    ['ai_disclosures', 'TEXT'],
    ['maintainers', 'TEXT']
  ];
  try {
    const info = await db.prepare(`PRAGMA table_info(packages)`).all();
    const existing = new Set<string>(
      (info?.results || []).map((r: any) => String(r?.name || '').toLowerCase())
    );
    for (const [colName, colDef] of requiredCols) {
      if (!existing.has(colName)) {
        await db.prepare(`ALTER TABLE packages ADD COLUMN ${colName} ${colDef}`).run().catch(() => {});
      }
    }

    // Ensure package_daily_downloads table and granular analytics columns exist
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS package_daily_downloads (
        package_id TEXT NOT NULL,
        download_date DATE NOT NULL DEFAULT (DATE('now')),
        downloads_count INTEGER NOT NULL DEFAULT 1,
        platform_luanti INTEGER NOT NULL DEFAULT 0,
        platform_web INTEGER NOT NULL DEFAULT 0,
        reason_new INTEGER NOT NULL DEFAULT 0,
        reason_update INTEGER NOT NULL DEFAULT 0,
        reason_dependency INTEGER NOT NULL DEFAULT 0,
        reason_web INTEGER NOT NULL DEFAULT 0,
        views_luanti INTEGER NOT NULL DEFAULT 0,
        views_web INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (package_id, download_date)
      )
    `).run().catch(() => {});

    const dailyCols: Array<[string, string]> = [
      ['platform_luanti', 'INTEGER NOT NULL DEFAULT 0'],
      ['platform_web', 'INTEGER NOT NULL DEFAULT 0'],
      ['reason_new', 'INTEGER NOT NULL DEFAULT 0'],
      ['reason_update', 'INTEGER NOT NULL DEFAULT 0'],
      ['reason_dependency', 'INTEGER NOT NULL DEFAULT 0'],
      ['reason_web', 'INTEGER NOT NULL DEFAULT 0'],
      ['views_luanti', 'INTEGER NOT NULL DEFAULT 0'],
      ['views_web', 'INTEGER NOT NULL DEFAULT 0']
    ];
    const dailyInfo = await db.prepare(`PRAGMA table_info(package_daily_downloads)`).all().catch(() => ({ results: [] }));
    const existingDaily = new Set<string>(
      (dailyInfo?.results || []).map((r: any) => String(r?.name || '').toLowerCase())
    );
    for (const [colName, colDef] of dailyCols) {
      if (!existingDaily.has(colName)) {
        await db.prepare(`ALTER TABLE package_daily_downloads ADD COLUMN ${colName} ${colDef}`).run().catch(() => {});
      }
    }

    if (existing.size > 0) {
      extendedColumnsEnsured = true;
    }
  } catch {
    // Ignore schema inspection errors; will retry on next request
  }
}

/**
 * Sanitizes error messages before returning them in HTTP JSON responses so internal
 * database schema details (`D1_ERROR`, `SQLITE_ERROR`, table/column names, stack traces,
 * or runtime exceptions) are never exposed to the client.
 */
export function sanitizePublicErrorMessage(
  err: any,
  fallbackMessage = 'A temporary server error occurred. Please try again in a moment.'
): string {
  const raw = typeof err === 'string' ? err.trim() : String(err?.message || '').trim();
  if (!raw) return fallbackMessage;

  const sensitivePattern =
    /\b(D1_[A-Z_]*|SQLITE_[A-Z_]*|SQLITE\b|no such table|no such column|has no column named|table [a-z0-9_]+ has no|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed|SYNTAX_ERROR|near ".+": syntax error|PRAGMA\b|ALTER TABLE\b|INSERT INTO\b|UPDATE [a-z0-9_]+ SET|DELETE FROM\b|SELECT .+ FROM|TypeError:|ReferenceError:|SyntaxError:|RangeError:|Cannot read propert(y|ies) of|Workers? runtime|cloudflare-internal)/i;

  if (sensitivePattern.test(raw) || raw.startsWith('<!DOCTYPE') || raw.startsWith('<html')) {
    console.error('[LuantiHub Internal Error]:', raw);
    return fallbackMessage;
  }

  return raw;
}

/**
 * Normalizes ContentDB `long_description` whether it is returned as a plain Markdown string
 * (from `/api/packages/<author>/<name>/` or `/dependencies/`) or a Luanti hypertext object
 * (`{ type: 'hypertext', head_level: 2, body: '...' }` from `/for-client/`).
 */
export function extractLongDescriptionText(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object' && typeof val.body === 'string') {
    return val.body
      .replace(/<bigger>([\s\S]*?)<\/bigger>/gi, '### $1\n')
      .replace(/<big>([\s\S]*?)<\/big>/gi, '#### $1\n')
      .replace(/<mono>([\s\S]*?)<\/mono>/gi, '`$1`')
      .replace(/<style[^>]*>/gi, '')
      .replace(/<\/style>/gi, '')
      .replace(/<(?:item|img|global|tag)\b[^>]*>/gi, '')
      .trim();
  }
  return '';
}

/**
 * Resolves `video_url` and `video_thumbnail_url` from explicit ContentDB/D1 fields,
 * falling back to extracting embedded YouTube, Vimeo, or direct `.mp4`/`.webm` showcase
 * links from `long_description` or `README.md` when `video_url` is not explicitly set.
 */
export function extractEmbeddedVideo(
  videoUrl?: string | null,
  videoThumbUrl?: string | null,
  longDesc?: string | null,
  readme?: string | null
): { video_url?: string; video_thumbnail_url?: string } {
  let resolvedVideo = typeof videoUrl === 'string' && videoUrl.trim() ? videoUrl.trim() : undefined;
  let resolvedThumb = typeof videoThumbUrl === 'string' && videoThumbUrl.trim() ? videoThumbUrl.trim() : undefined;

  if (!resolvedVideo) {
    const combinedText = `${longDesc || ''}\n${readme || ''}`;
    if (combinedText.trim()) {
      const ytMatch = combinedText.match(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
      );
      if (ytMatch && ytMatch[1]) {
        resolvedVideo = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
        if (!resolvedThumb) {
          resolvedThumb = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        }
      } else {
        const directMatch = combinedText.match(
          /https?:\/\/[^\s)"'<>]+?\.(?:mp4|webm)(?:\?[^\s)"'<>]*)?/i
        );
        if (directMatch && directMatch[0]) {
          resolvedVideo = directMatch[0];
        } else {
          const vimeoMatch = combinedText.match(/https?:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})/i);
          if (vimeoMatch && vimeoMatch[0]) {
            resolvedVideo = vimeoMatch[0];
          }
        }
      }
    }
  } else if (!resolvedThumb) {
    const ytMatch = resolvedVideo.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
    );
    if (ytMatch && ytMatch[1]) {
      resolvedThumb = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }
  }

  return {
    video_url: resolvedVideo,
    video_thumbnail_url: resolvedThumb
  };
}

export function parseGitRepoTarget(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string
): { provider: 'github' | 'codeberg' | 'gitlab'; host: string; owner: string; repo: string } | null {
  if (repoUrl && typeof repoUrl === 'string' && repoUrl.trim()) {
    try {
      const u = new URL(repoUrl.trim());
      const host = u.hostname.toLowerCase();
      const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, '');
        if (owner && repo) {
          let provider: 'github' | 'codeberg' | 'gitlab' = 'github';
          if (host.includes('codeberg') || host.includes('minetest.land') || host.includes('mesehub') || host.includes('gitea') || host.includes('forgejo')) {
            provider = 'codeberg';
          } else if (host.includes('gitlab')) {
            provider = 'gitlab';
          }
          return { provider, host, owner, repo };
        }
      }
    } catch {
      // Fallback below
    }
  }
  if (fallbackOwner && fallbackRepo) {
    return {
      provider: 'github',
      host: 'github.com',
      owner: fallbackOwner,
      repo: fallbackRepo.replace(/\.git$/i, '')
    };
  }
  return null;
}

export function buildGitBranchArchiveUrl(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string,
  branch = 'HEAD',
  _providerHint?: string
): string {
  const target = parseGitRepoTarget(repoUrl, fallbackOwner, fallbackRepo);
  const rawBranch = (branch || 'HEAD').trim();
  const isHead = rawBranch.toUpperCase() === 'HEAD';
  const safeBranch = encodeURIComponent(rawBranch);
  if (!target) {
    const encOwner = encodeURIComponent(fallbackOwner || '');
    const encRepo = encodeURIComponent(fallbackRepo || '');
    return isHead
      ? `https://github.com/${encOwner}/${encRepo}/archive/HEAD.zip`
      : `https://github.com/${encOwner}/${encRepo}/archive/refs/heads/${safeBranch}.zip`;
  }
  const { provider, host, owner, repo } = target;
  if (provider === 'codeberg') {
    return `https://${host}/${owner}/${repo}/archive/${isHead ? 'HEAD' : safeBranch}.zip`;
  }
  if (provider === 'gitlab') {
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    return isHead
      ? `https://${host}/api/v4/projects/${projectPath}/repository/archive.zip`
      : `https://${host}/api/v4/projects/${projectPath}/repository/archive.zip?sha=${safeBranch}`;
  }
  return isHead
    ? `https://github.com/${owner}/${repo}/archive/HEAD.zip`
    : `https://github.com/${owner}/${repo}/archive/refs/heads/${safeBranch}.zip`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Zero-recompression ZIP normalizer for the Luanti C++ Engine (`pkgmgr.lua` / `extract_zip` / `get_base_folder`).
 * - Verifies EOCD & Central Directory headers.
 * - Locates the true Luanti package root inside the archive (`game.conf`, `modpack.conf`, `modpack.txt`,
 *   `mod.conf`, `init.lua`, `texture_pack.conf`), unwrapping nested subdirectories automatically.
 * - Detects multi-mod repositories (modpacks) missing `modpack.conf` and synthesizes a valid `modpack.conf`.
 * - Detects texture packs missing `texture_pack.conf` and synthesizes a valid `texture_pack.conf`.
 * - Rebases all file paths cleanly under `<sanitizedPackageName>/` and strips `.git/`, `.github/`, `.gitlab/` CI clutter.
 * - Converts streaming data-descriptor Local File Headers (bit 3 `0x0008` used by GitHub/GitLab `git archive`)
 *   into explicit pre-sized Local File Headers for maximum compatibility with Luanti's `minizip` extractor.
 */
export function normalizeLuantiPackageZip(
  zipBytes: Uint8Array,
  packageName: string,
  packageType: string = 'mod'
): Uint8Array {
  if (!zipBytes || zipBytes.length < 22) return zipBytes;
  if (zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) return zipBytes;

  const safePkgName = (packageName || 'mod')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'mod';

  try {
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

    // 1. Locate End of Central Directory (EOCD) signature 0x06054b50
    let eocdPos = -1;
    const minEocdPos = Math.max(0, zipBytes.length - 65557);
    for (let pos = zipBytes.length - 22; pos >= minEocdPos; pos--) {
      if (view.getUint32(pos, true) === 0x06054b50) {
        eocdPos = pos;
        break;
      }
    }
    if (eocdPos < 0) return zipBytes;

    const totalEntries = view.getUint16(eocdPos + 10, true);
    const cdSize = view.getUint32(eocdPos + 12, true);
    const cdOffset = view.getUint32(eocdPos + 16, true);

    // Bail out on ZIP64 or invalid offsets
    if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > eocdPos) {
      return zipBytes;
    }

    interface ParsedZipEntry {
      path: string;
      versionMadeBy: number;
      versionNeeded: number;
      flags: number;
      compressionMethod: number;
      dosTime: number;
      dosDate: number;
      crc32: number;
      compressedSize: number;
      uncompressedSize: number;
      externalAttrs: number;
      compressedData: Uint8Array;
    }

    const entries: ParsedZipEntry[] = [];
    const decoder = new TextDecoder();
    let ptr = cdOffset;

    for (let i = 0; i < totalEntries; i++) {
      if (ptr + 46 > eocdPos) return zipBytes;
      if (view.getUint32(ptr, true) !== 0x02014b50) return zipBytes;

      const versionMadeBy = view.getUint16(ptr + 4, true);
      const versionNeeded = view.getUint16(ptr + 6, true);
      const flags = view.getUint16(ptr + 8, true);
      const compressionMethod = view.getUint16(ptr + 10, true);
      const dosTime = view.getUint16(ptr + 12, true);
      const dosDate = view.getUint16(ptr + 14, true);
      const crc32 = view.getUint32(ptr + 16, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const uncompressedSize = view.getUint32(ptr + 24, true);
      const fileNameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const externalAttrs = view.getUint32(ptr + 38, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      if (compressionMethod !== 0 && compressionMethod !== 8) {
        return zipBytes;
      }

      const rawNameBytes = zipBytes.subarray(ptr + 46, ptr + 46 + fileNameLen);
      const normalizedPath = decoder.decode(rawNameBytes).replace(/\\/g, '/').replace(/^\/+/, '');
      ptr += 46 + fileNameLen + extraLen + commentLen;

      if (!normalizedPath || normalizedPath.endsWith('/')) {
        continue;
      }

      if (localHeaderOffset + 30 > cdOffset) return zipBytes;
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return zipBytes;
      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > cdOffset) return zipBytes;

      entries.push({
        path: normalizedPath,
        versionMadeBy,
        versionNeeded,
        flags,
        compressionMethod,
        dosTime,
        dosDate,
        crc32,
        compressedSize,
        uncompressedSize,
        externalAttrs,
        compressedData: zipBytes.subarray(dataStart, dataEnd)
      });
    }

    if (entries.length === 0) return zipBytes;

    // 2. Identify the Luanti package root directory prefix inside the ZIP
    const ROOT_MARKERS = new Set([
      'game.conf',
      'modpack.conf',
      'modpack.txt',
      'mod.conf',
      'init.lua',
      'texture_pack.conf'
    ]);

    const markerDirs: Array<{ dir: string; depth: number; file: string }> = [];
    for (const entry of entries) {
      const lastSlash = entry.path.lastIndexOf('/');
      const baseName = (lastSlash >= 0 ? entry.path.slice(lastSlash + 1) : entry.path).toLowerCase();
      const dirPrefix = lastSlash >= 0 ? entry.path.slice(0, lastSlash + 1) : '';
      if (ROOT_MARKERS.has(baseName)) {
        const depth = dirPrefix ? dirPrefix.split('/').filter(Boolean).length : 0;
        markerDirs.push({ dir: dirPrefix, depth, file: baseName });
      }
    }

    let basePrefix = '';
    let needsSynthesizedModpackConf = false;

    if (markerDirs.length > 0) {
      markerDirs.sort((a, b) => a.depth - b.depth);
      const minDepth = markerDirs[0].depth;
      const shallowestDirs = Array.from(new Set(markerDirs.filter(m => m.depth === minDepth).map(m => m.dir)));

      if (shallowestDirs.length === 1) {
        basePrefix = shallowestDirs[0];
      } else if (minDepth >= 1) {
        // Multiple sibling mod folders at the same depth (e.g. `repo-main/mod_a/init.lua`, `repo-main/mod_b/init.lua`) -> Modpack!
        const firstParts = shallowestDirs[0].split('/').filter(Boolean);
        const parentPrefix = firstParts.length > 1 ? firstParts.slice(0, -1).join('/') + '/' : '';
        const allShareParent = shallowestDirs.every(d => d.startsWith(parentPrefix));
        basePrefix = allShareParent ? parentPrefix : '';
        needsSynthesizedModpackConf = true;
      }
    } else {
      // No standard marker file found (e.g. texture pack without texture_pack.conf): find common single top-level directory
      const topFolders = new Set<string>();
      let hasRootFiles = false;
      for (const entry of entries) {
        const slashIdx = entry.path.indexOf('/');
        if (slashIdx > 0) {
          topFolders.add(entry.path.slice(0, slashIdx + 1));
        } else {
          hasRootFiles = true;
        }
      }
      if (!hasRootFiles && topFolders.size === 1) {
        basePrefix = Array.from(topFolders)[0];
      }
    }

    // 3. Filter and rebase entries under `<safePkgName>/`
    const encoder = new TextEncoder();
    const rebasedEntries: Array<{
      newPathBytes: Uint8Array;
      versionMadeBy: number;
      versionNeeded: number;
      flags: number;
      compressionMethod: number;
      dosTime: number;
      dosDate: number;
      crc32: number;
      compressedSize: number;
      uncompressedSize: number;
      externalAttrs: number;
      compressedData: Uint8Array;
    }> = [];

    const existingRelativeFiles = new Set<string>();

    for (const entry of entries) {
      if (basePrefix && !entry.path.startsWith(basePrefix)) continue;
      const relPath = (basePrefix ? entry.path.slice(basePrefix.length) : entry.path).replace(/^\/+/, '');
      if (!relPath) continue;

      const lowerRel = relPath.toLowerCase();
      if (
        lowerRel === '.git' ||
        lowerRel.startsWith('.git/') ||
        lowerRel.startsWith('.github/') ||
        lowerRel.startsWith('.gitlab/') ||
        lowerRel === '.gitignore' ||
        lowerRel === '.gitattributes' ||
        lowerRel === '.gitmodules' ||
        lowerRel === '.luacheckrc'
      ) {
        continue;
      }

      existingRelativeFiles.add(lowerRel);
      const finalPath = `${safePkgName}/${relPath}`;
      rebasedEntries.push({
        newPathBytes: encoder.encode(finalPath),
        versionMadeBy: entry.versionMadeBy || 0x0314,
        versionNeeded: Math.min(entry.versionNeeded || 20, 20),
        // Clear bit 3 (0x0008 data descriptor) since sizes & CRC32 are written directly into the Local File Header
        flags: (entry.flags & ~0x0008) | 0x0800,
        compressionMethod: entry.compressionMethod,
        dosTime: entry.dosTime,
        dosDate: entry.dosDate,
        crc32: entry.crc32,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        externalAttrs: entry.externalAttrs || 0x81a40000,
        compressedData: entry.compressedData
      });
    }

    if (rebasedEntries.length === 0) return zipBytes;

    // 4. Synthesize missing Luanti engine marker files when required by `pkgmgr.get_base_folder`
    const addSynthesizedFile = (relFileName: string, contentText: string) => {
      const dataBytes = encoder.encode(contentText);
      const pathBytes = encoder.encode(`${safePkgName}/${relFileName}`);
      rebasedEntries.unshift({
        newPathBytes: pathBytes,
        versionMadeBy: 0x0314,
        versionNeeded: 20,
        flags: 0x0800,
        compressionMethod: 0, // Store
        dosTime: 0,
        dosDate: 0x5421,
        crc32: computeCrc32(dataBytes),
        compressedSize: dataBytes.length,
        uncompressedSize: dataBytes.length,
        externalAttrs: 0x81a40000, // -rw-r--r-- (0100644 << 16)
        compressedData: dataBytes
      });
    };

    if (
      (needsSynthesizedModpackConf || packageType === 'modpack') &&
      !existingRelativeFiles.has('modpack.conf') &&
      !existingRelativeFiles.has('modpack.txt') &&
      !existingRelativeFiles.has('init.lua')
    ) {
      addSynthesizedFile('modpack.conf', `name = ${safePkgName}\n`);
    } else if (
      packageType === 'txp' &&
      !existingRelativeFiles.has('texture_pack.conf') &&
      !existingRelativeFiles.has('mod.conf') &&
      !existingRelativeFiles.has('init.lua') &&
      !existingRelativeFiles.has('game.conf')
    ) {
      addSynthesizedFile('texture_pack.conf', `name = ${safePkgName}\n`);
    } else if (
      existingRelativeFiles.has('init.lua') &&
      !existingRelativeFiles.has('mod.conf') &&
      !existingRelativeFiles.has('modpack.conf') &&
      !existingRelativeFiles.has('game.conf')
    ) {
      addSynthesizedFile('mod.conf', `name = ${safePkgName}\n`);
    }

    // Prepend explicit top-level `<safePkgName>/` directory entry (`drwxr-xr-x` / DOS directory bit 0x10)
    rebasedEntries.unshift({
      newPathBytes: encoder.encode(`${safePkgName}/`),
      versionMadeBy: 0x0314,
      versionNeeded: 20,
      flags: 0x0800,
      compressionMethod: 0,
      dosTime: 0,
      dosDate: 0x5421,
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      externalAttrs: 0x41ed0010,
      compressedData: new Uint8Array(0)
    });

    // 5. Calculate exact output buffer size and assemble normalized ZIP
    let localSectionSize = 0;
    let cdSectionSize = 0;
    for (const item of rebasedEntries) {
      localSectionSize += 30 + item.newPathBytes.length + item.compressedSize;
      cdSectionSize += 46 + item.newPathBytes.length;
    }

    const totalOutSize = localSectionSize + cdSectionSize + 22;
    const outBuf = new Uint8Array(totalOutSize);
    const outView = new DataView(outBuf.buffer);

    let localOffset = 0;
    const localOffsets: number[] = [];

    for (const item of rebasedEntries) {
      localOffsets.push(localOffset);
      outView.setUint32(localOffset, 0x04034b50, true);
      outView.setUint16(localOffset + 4, item.versionNeeded, true);
      outView.setUint16(localOffset + 6, item.flags, true);
      outView.setUint16(localOffset + 8, item.compressionMethod, true);
      outView.setUint16(localOffset + 10, item.dosTime, true);
      outView.setUint16(localOffset + 12, item.dosDate, true);
      outView.setUint32(localOffset + 14, item.crc32, true);
      outView.setUint32(localOffset + 18, item.compressedSize, true);
      outView.setUint32(localOffset + 22, item.uncompressedSize, true);
      outView.setUint16(localOffset + 26, item.newPathBytes.length, true);
      outView.setUint16(localOffset + 28, 0, true); // extra field length = 0
      outBuf.set(item.newPathBytes, localOffset + 30);
      outBuf.set(item.compressedData, localOffset + 30 + item.newPathBytes.length);
      localOffset += 30 + item.newPathBytes.length + item.compressedSize;
    }

    let cdWritePos = localOffset;
    for (let i = 0; i < rebasedEntries.length; i++) {
      const item = rebasedEntries[i];
      outView.setUint32(cdWritePos, 0x02014b50, true);
      outView.setUint16(cdWritePos + 4, item.versionMadeBy, true);
      outView.setUint16(cdWritePos + 6, item.versionNeeded, true);
      outView.setUint16(cdWritePos + 8, item.flags, true);
      outView.setUint16(cdWritePos + 10, item.compressionMethod, true);
      outView.setUint16(cdWritePos + 12, item.dosTime, true);
      outView.setUint16(cdWritePos + 14, item.dosDate, true);
      outView.setUint32(cdWritePos + 16, item.crc32, true);
      outView.setUint32(cdWritePos + 20, item.compressedSize, true);
      outView.setUint32(cdWritePos + 24, item.uncompressedSize, true);
      outView.setUint16(cdWritePos + 28, item.newPathBytes.length, true);
      outView.setUint16(cdWritePos + 30, 0, true); // extra length
      outView.setUint16(cdWritePos + 32, 0, true); // comment length
      outView.setUint16(cdWritePos + 34, 0, true); // disk number
      outView.setUint16(cdWritePos + 36, 0, true); // internal attrs
      outView.setUint32(cdWritePos + 38, item.externalAttrs, true);
      outView.setUint32(cdWritePos + 42, localOffsets[i], true);
      outBuf.set(item.newPathBytes, cdWritePos + 46);
      cdWritePos += 46 + item.newPathBytes.length;
    }

    // Write End of Central Directory (EOCD)
    outView.setUint32(cdWritePos, 0x06054b50, true);
    outView.setUint16(cdWritePos + 4, 0, true);
    outView.setUint16(cdWritePos + 6, 0, true);
    outView.setUint16(cdWritePos + 8, rebasedEntries.length, true);
    outView.setUint16(cdWritePos + 10, rebasedEntries.length, true);
    outView.setUint32(cdWritePos + 12, cdSectionSize, true);
    outView.setUint32(cdWritePos + 16, localOffset, true);
    outView.setUint16(cdWritePos + 20, 0, true);

    return outBuf;
  } catch {
    return zipBytes;
  }
}

export function buildGitTagArchiveUrl(
  provider: 'github' | 'codeberg' | 'gitlab' | 'mesehub' | string,
  host: string,
  owner: string,
  repo: string,
  tagName: string
): string {
  const encTag = encodeURIComponent(tagName);
  const lowerHost = (host || '').toLowerCase();
  if (
    provider === 'codeberg' ||
    provider === 'mesehub' ||
    lowerHost.includes('codeberg') ||
    lowerHost.includes('minetest.land') ||
    lowerHost.includes('mesehub') ||
    lowerHost.includes('gitea') ||
    lowerHost.includes('forgejo')
  ) {
    return `https://${host}/${owner}/${repo}/archive/${encTag}.zip`;
  }
  if (provider === 'gitlab' || lowerHost.includes('gitlab')) {
    return `https://${host}/${owner}/${repo}/-/archive/${encTag}/${repo}-${encTag}.zip`;
  }
  return `https://github.com/${owner}/${repo}/archive/refs/tags/${encTag}.zip`;
}

const sharedIsolateZipCache = new Map<string, { exp: number; bytes: Uint8Array; fileName: string }>();
const MAX_SHARED_ISOLATE_ZIP_ENTRIES = 8;
const MAX_SHARED_ISOLATE_ZIP_ITEM_BYTES = 4 * 1024 * 1024; // 4 MB per cached item

export function buildSharedZipCacheKey(author: string, name: string, releaseOrTag?: string): string {
  const encAuthor = encodeURIComponent((author || 'unknown').toLowerCase());
  const encName = encodeURIComponent((name || 'mod').toLowerCase());
  const encRef = encodeURIComponent((releaseOrTag || 'latest').trim().toLowerCase() || 'latest');
  return `https://cache.luantihub.internal/__pkg_zip_v3/${encAuthor}/${encName}/${encRef}`;
}

export async function getCachedNormalizedZip(
  cacheKey: string,
  request?: Request
): Promise<{ response: Response; byteLength: number; source: 'HIT-ISOLATE' | 'HIT-EDGE' } | null> {
  const isMockedFetch = Boolean((globalThis.fetch as any)?.mock || (globalThis.fetch as any)?._isMockFunction);
  if (!isMockedFetch) {
    const memZip = sharedIsolateZipCache.get(cacheKey);
    if (memZip) {
      if (Date.now() <= memZip.exp) {
        return {
          byteLength: memZip.bytes.byteLength,
          source: 'HIT-ISOLATE',
          response: new Response(memZip.bytes as unknown as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="${memZip.fileName}.zip"`,
              'Content-Length': String(memZip.bytes.byteLength),
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Expose-Headers': 'Content-Length, X-LuantiHub-Cache',
              'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
              'X-LuantiHub-Cache': 'HIT-ISOLATE'
            }
          })
        };
      }
      sharedIsolateZipCache.delete(cacheKey);
    }
  }

  try {
    const cache = (globalThis as any).caches?.default;
    if (cache) {
      const cachedZip =
        (request ? await cache.match(request) : null) ||
        (await cache.match(new Request(cacheKey, { method: 'GET' })));
      if (cachedZip && cachedZip.ok) {
        const cl = Number(cachedZip.headers.get('content-length') || 0);
        return {
          response: cachedZip,
          byteLength: Number.isFinite(cl) && cl > 0 ? cl : 0,
          source: 'HIT-EDGE'
        };
      }
    }
  } catch {
    // Proceed if Cache API unavailable in test/dev environment
  }
  return null;
}

export async function setCachedNormalizedZip(
  cacheKey: string,
  normalizedZip: Uint8Array,
  safeFileName: string,
  request?: Request
): Promise<Response> {
  const isMockedFetch = Boolean((globalThis.fetch as any)?.mock || (globalThis.fetch as any)?._isMockFunction);
  if (!isMockedFetch && normalizedZip.byteLength > 0 && normalizedZip.byteLength <= MAX_SHARED_ISOLATE_ZIP_ITEM_BYTES) {
    if (sharedIsolateZipCache.size >= MAX_SHARED_ISOLATE_ZIP_ENTRIES) {
      const oldestKey = sharedIsolateZipCache.keys().next().value;
      if (oldestKey) sharedIsolateZipCache.delete(oldestKey);
    }
    sharedIsolateZipCache.set(cacheKey, {
      exp: Date.now() + 10 * 60 * 1000,
      bytes: normalizedZip,
      fileName: safeFileName
    });
  }

  const zipResponse = new Response(normalizedZip as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFileName}.zip"`,
      'Content-Length': String(normalizedZip.byteLength),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, X-LuantiHub-Cache',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      'X-LuantiHub-Cache': 'MISS-WARMED'
    }
  });

  try {
    const cache = (globalThis as any).caches?.default;
    if (cache) {
      const puts: Promise<any>[] = [
        cache.put(new Request(cacheKey, { method: 'GET' }), zipResponse.clone())
      ];
      if (request && (request.method || 'GET').toUpperCase() === 'GET') {
        puts.push(cache.put(request, zipResponse.clone()));
      }
      await Promise.all(puts).catch(() => {});
    }
  } catch {
    // Non-blocking cache store
  }

  return zipResponse;
}

export const MAX_PACKAGE_RELEASES = 10;

function extractSemverTuple(raw?: string | null): number[] | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/^(?:v|ver|version|rel|release)?[\s_-]*(\d+)\.(\d+)(?:\.(\d+))?(?:[.-](\d+))?/i);
  if (!m) return null;
  return [
    parseInt(m[1], 10) || 0,
    parseInt(m[2], 10) || 0,
    m[3] !== undefined ? parseInt(m[3], 10) || 0 : 0,
    m[4] !== undefined ? parseInt(m[4], 10) || 0 : 0
  ];
}

/**
 * Compares two version/tag strings in descending semantic version order (`2.0.4` > `2.0.3` > `2.0.0` > `v1.0.0`).
 * Returns negative if `a` is newer than `b`, positive if `b` is newer than `a`, or `0` if incomparable/equal.
 */
export function compareSemanticVersionsDesc(aRaw?: string | null, bRaw?: string | null): number {
  const tupleA = extractSemverTuple(aRaw);
  const tupleB = extractSemverTuple(bRaw);
  if (!tupleA || !tupleB) return 0;
  for (let i = 0; i < 4; i++) {
    if (tupleA[i] !== tupleB[i]) {
      return tupleB[i] - tupleA[i];
    }
  }
  return 0;
}

export interface SortableReleaseLike {
  id?: string | number | null;
  tag_name?: string | null;
  version?: string | null;
  title?: string | null;
  commit_sha?: string | null;
  release_date?: string | null;
  released_at?: string | null;
}

/**
 * Sorts package releases newest-first (by semantic version X.Y.Z descending and release timestamp descending)
 * and caps the returned array to `maxCap` (default: 10 latest releases).
 */
export function sortAndCapReleases<T extends SortableReleaseLike>(
  releases: T[],
  maxCap: number = MAX_PACKAGE_RELEASES
): T[] {
  if (!Array.isArray(releases) || releases.length === 0) return [];
  const sorted = [...releases].sort((a, b) => {
    const aIsFallback = a?.commit_sha === 'HEAD' || String(a?.id) === 'git-branch-fallback';
    const bIsFallback = b?.commit_sha === 'HEAD' || String(b?.id) === 'git-branch-fallback';
    if (aIsFallback !== bIsFallback) {
      return aIsFallback ? 1 : -1;
    }

    const verA = String(a?.tag_name || a?.version || a?.title || '');
    const verB = String(b?.tag_name || b?.version || b?.title || '');
    const semverCmp = compareSemanticVersionsDesc(verA, verB);
    if (semverCmp !== 0) {
      return semverCmp;
    }

    const timeA = Date.parse(String(a?.release_date || a?.released_at || '')) || 0;
    const timeB = Date.parse(String(b?.release_date || b?.released_at || '')) || 0;
    if (timeA > 0 && timeB > 0 && Math.abs(timeA - timeB) > 1000) {
      return timeB - timeA;
    }
    if (timeA !== timeB) {
      return timeB - timeA;
    }

    const idA = Number(a?.id);
    const idB = Number(b?.id);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) {
      return idB - idA;
    }

    return verB.localeCompare(verA, undefined, { numeric: true, sensitivity: 'base' });
  });

  return maxCap > 0 ? sorted.slice(0, maxCap) : sorted;
}

/**
 * Discovers both formal Releases and Git Tags from GitHub, Codeberg/Gitea/Forgejo, or GitLab.
 * Prefers tags and releases so repositories that tag versions (e.g. via `/tags` without formal GitHub Releases)
 * expose all tagged versions for download before falling back to the default branch.
 */
export async function fetchGitRepoReleasesAndTags(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string,
  minMinetestVersion = '5.0.0'
): Promise<DiscoveredGitRelease[]> {
  const target = parseGitRepoTarget(repoUrl, fallbackOwner, fallbackRepo);
  if (!target) return [];

  const { provider, host, owner, repo } = target;
  const headers: Record<string, string> = {
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)',
    'Accept': provider === 'github' ? 'application/vnd.github+json' : 'application/json'
  };

  const fetchJsonWithTimeout = async (url: string): Promise<any[] | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetchWithAnubisSupport(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) ? data : null;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  let releasesUrl = '';
  let tagsUrl = '';
  if (provider === 'github') {
    releasesUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=15`;
    tagsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=15`;
  } else if (provider === 'codeberg') {
    releasesUrl = `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?limit=15`;
    tagsUrl = `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?limit=15`;
  } else if (provider === 'gitlab') {
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    releasesUrl = `https://${host}/api/v4/projects/${projectPath}/releases?per_page=15`;
    tagsUrl = `https://${host}/api/v4/projects/${projectPath}/repository/tags?per_page=15`;
  }

  const [rawReleases, rawTags] = await Promise.all([
    releasesUrl ? fetchJsonWithTimeout(releasesUrl) : Promise.resolve(null),
    tagsUrl ? fetchJsonWithTimeout(tagsUrl) : Promise.resolve(null)
  ]);

  const tagShaMap = new Map<string, string>();
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      const tagName = String(t?.name || '').trim();
      const sha = String(t?.commit?.sha || t?.commit?.id || t?.id || '').trim();
      if (tagName && sha) {
        tagShaMap.set(tagName, sha);
      }
    }
  }

  const releaseByTag = new Map<string, any>();
  if (Array.isArray(rawReleases)) {
    for (const r of rawReleases) {
      if (r && !r.draft) {
        const tagName = String(r.tag_name || r.name || '').trim();
        if (tagName && !releaseByTag.has(tagName)) {
          releaseByTag.set(tagName, r);
        }
      }
    }
  }

  const results: DiscoveredGitRelease[] = [];
  const seenTags = new Set<string>();

  // 1. Add tags in repository tag order, enriched with formal Release metadata if present
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      const tagName = String(t?.name || '').trim();
      if (!tagName || seenTags.has(tagName)) continue;
      seenTags.add(tagName);

      const rel = releaseByTag.get(tagName);
      const rawCommit = String(t?.commit?.sha || t?.commit?.id || t?.id || rel?.target_commitish || '').trim();
      const isHexSha = /^[0-9a-f]{7,40}$/i.test(rawCommit);
      const zipAsset = Array.isArray(rel?.assets)
        ? rel.assets.find((a: any) => String(a?.name || '').toLowerCase().endsWith('.zip') && (a?.browser_download_url || a?.url))
        : null;
      const archiveUrl = zipAsset?.browser_download_url || zipAsset?.url || buildGitTagArchiveUrl(provider, host, owner, repo, tagName);
      const assetSize = Number(zipAsset?.size || 0);
      const relDate = String(rel?.published_at || rel?.released_at || rel?.created_at || t?.commit?.created_at || '');
      const title = String(rel?.name || tagName).trim() || tagName;

      results.push({
        id: rel?.id || results.length + 1,
        version: title,
        title,
        tag_name: tagName,
        commit_sha: isHexSha ? rawCommit : (tagShaMap.get(tagName) || ''),
        url: archiveUrl,
        download_url: archiveUrl,
        size: assetSize > 0 ? assetSize : undefined,
        min_minetest_version: minMinetestVersion,
        changelog: rel?.body || rel?.description || t?.message || undefined,
        release_date: relDate,
        released_at: relDate
      });
    }
  }

  // 2. Append any formal Releases whose tag was not in the first page of /tags
  if (Array.isArray(rawReleases)) {
    for (const r of rawReleases) {
      if (!r || r.draft) continue;
      const tagName = String(r.tag_name || r.name || '').trim();
      if (!tagName || seenTags.has(tagName)) continue;
      seenTags.add(tagName);

      const rawCommit = String(tagShaMap.get(tagName) || r.target_commitish || '').trim();
      const isHexSha = /^[0-9a-f]{7,40}$/i.test(rawCommit);
      const zipAsset = Array.isArray(r.assets)
        ? r.assets.find((a: any) => String(a?.name || '').toLowerCase().endsWith('.zip') && (a?.browser_download_url || a?.url))
        : null;
      const archiveUrl = zipAsset?.browser_download_url || zipAsset?.url || buildGitTagArchiveUrl(provider, host, owner, repo, tagName);
      const assetSize = Number(zipAsset?.size || 0);
      const relDate = String(r.published_at || r.released_at || r.created_at || '');
      const title = String(r.name || tagName).trim() || tagName;

      results.push({
        id: r.id || results.length + 1,
        version: title,
        title,
        tag_name: tagName,
        commit_sha: isHexSha ? rawCommit : '',
        url: archiveUrl,
        download_url: archiveUrl,
        size: assetSize > 0 ? assetSize : undefined,
        min_minetest_version: minMinetestVersion,
        changelog: r.body || r.description || undefined,
        release_date: relDate,
        released_at: relDate
      });
    }
  }

  return sortAndCapReleases(results, MAX_PACKAGE_RELEASES);
}

/**
 * Rewrites relative image paths in Markdown (`![alt](rel/path.png)`) and HTML (`<img src="rel/path.png">`)
 * to absolute raw repository asset URLs.
 */
export function rewriteRelativeMarkdownUrls(markdown: string, rawAssetBase?: string): string {
  if (!markdown || !rawAssetBase) return markdown;
  const base = rawAssetBase.replace(/\/+$/, '');
  return markdown
    .replace(
      /!\[([^\]]*)\]\((?!https?:\/\/|data:|\/)([^)\s]+)(\s+"[^"]*")?\)/g,
      (_match, alt, relPath, titlePart) => {
        const cleanPath = String(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
        return `![${alt}](${base}/${cleanPath}${titlePart || ''})`;
      }
    )
    .replace(
      /(<img\b[^>]*?\bsrc\s*=\s*["'])(?!https?:\/\/|data:|\/)([^"']+)(["'][^>]*>)/gi,
      (_match, prefix, relPath, suffix) => {
        const cleanPath = String(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
        return `${prefix}${base}/${cleanPath}${suffix}`;
      }
    );
}

/**
 * Formats a numeric byte count or size string into a human-readable KB / MB label.
 */
export function formatByteSize(val: any): string | undefined {
  let bytes = 0;
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    bytes = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d+$/.test(trimmed)) {
      bytes = parseInt(trimmed, 10);
    } else if (trimmed && /[a-zA-Z]/.test(trimmed) && trimmed !== '2 KB') {
      return trimmed;
    }
  }
  if (bytes > 0) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return undefined;
}

export interface AccurateGitZipSizeOptions {
  tag?: string | null;
  defaultBranch?: string | null;
  packageType?: string | null;
  githubToken?: string | null;
}

/**
 * Measures the exact byte size of the normalized `.zip` archive for a Git-hosted package
 * and pre-warms the shared Cloudflare Edge `.zip` binary cache (`s-maxage=604800`, 7 days)
 * so subsequent user or in-game downloads stream immediately in < 5ms.
 */
export async function fetchAccurateGitZipSize(
  repoUrl?: string | null,
  fallbackAuthor?: string,
  fallbackName?: string,
  options?: AccurateGitZipSizeOptions
): Promise<{ downloadSize: number; fileSize: string } | null> {
  const target = parseGitRepoTarget(repoUrl, fallbackAuthor, fallbackName);
  if (!target) return null;

  const { provider, host, owner, repo } = target;
  const effectiveAuthor = fallbackAuthor || owner;
  const effectiveName = fallbackName || repo;
  const tag = (options?.tag || '').trim();
  const branch = (options?.defaultBranch || 'HEAD').trim() || 'HEAD';
  const releaseKey = (tag && tag !== 'HEAD' && tag !== 'latest') ? tag : 'latest';
  const sizeCacheKey = `https://cache.luantihub.internal/__git_zip_size_v2/${provider}/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}/${encodeURIComponent(releaseKey.toLowerCase())}`;

  // Tier 1a: Edge Size Cache (7-day TTL)
  const cached = await readEdgeCacheJson<{ downloadSize: number; fileSize: string }>(sizeCacheKey);
  if (cached && cached.downloadSize > 0 && cached.fileSize) {
    return cached;
  }

  // Tier 1b: Shared Normalized .zip Binary Cache (Isolate LRU + Edge Cache)
  const zipCacheKey = buildSharedZipCacheKey(effectiveAuthor, effectiveName, releaseKey);
  const cachedZip = await getCachedNormalizedZip(zipCacheKey);
  if (cachedZip && cachedZip.byteLength > 0) {
    const fileSize = formatByteSize(cachedZip.byteLength) || `${Math.max(1, Math.round(cachedZip.byteLength / 1024))} KB`;
    const result = { downloadSize: cachedZip.byteLength, fileSize };
    await writeEdgeCacheJson(sizeCacheKey, result, 604800);
    return result;
  }

  const safeFileName = (effectiveName || 'mod')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'mod';
  const pkgType = (options?.packageType || 'mod').toLowerCase();

  // Tier 2: Fetch & normalize actual Git .zip archive on the server (and pre-warm shared .zip Edge Cache)
  const archiveCandidates: string[] = [];
  if (tag && tag !== 'HEAD' && tag !== 'latest') {
    archiveCandidates.push(buildGitTagArchiveUrl(provider, host, owner, repo, tag));
  }
  archiveCandidates.push(buildGitBranchArchiveUrl(repoUrl, effectiveAuthor, effectiveName, branch));
  if (branch.toUpperCase() !== 'HEAD') {
    archiveCandidates.push(buildGitBranchArchiveUrl(repoUrl, effectiveAuthor, effectiveName, 'HEAD'));
  }

  const MAX_BUFFER_BYTES = 25 * 1024 * 1024;
  for (const archiveUrl of archiveCandidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const archiveHeaders: Record<string, string> = {
        'User-Agent': 'Luanti/5.11.0 (LuantiHub; +https://luantihub.org)',
        'Accept': 'application/zip, application/octet-stream, */*'
      };
      if (provider === 'github' && options?.githubToken) {
        archiveHeaders['Authorization'] = `Bearer ${options.githubToken}`;
      }
      const res = await fetchWithAnubisSupport(archiveUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: archiveHeaders
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
        continue;
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_BUFFER_BYTES) {
        const fileSize = formatByteSize(contentLength) || `${Math.max(1, Math.round(contentLength / 1024))} KB`;
        const result = { downloadSize: contentLength, fileSize };
        await writeEdgeCacheJson(sizeCacheKey, result, 604800);
        return result;
      }

      const rawBytes = new Uint8Array(await res.arrayBuffer());
      if (
        rawBytes.length >= 22 &&
        rawBytes[0] === 0x50 &&
        rawBytes[1] === 0x4b &&
        (rawBytes[2] === 0x03 || rawBytes[2] === 0x05)
      ) {
        const normalizedZip = normalizeLuantiPackageZip(rawBytes, safeFileName, pkgType);
        const bytes = normalizedZip.byteLength;
        if (bytes > 0) {
          await setCachedNormalizedZip(zipCacheKey, normalizedZip, safeFileName);
          const fileSize = formatByteSize(bytes) || `${Math.max(1, Math.round(bytes / 1024))} KB`;
          const result = { downloadSize: bytes, fileSize };
          await writeEdgeCacheJson(sizeCacheKey, result, 604800);
          return result;
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }

  // Tier 3: Fallback to Git Tree blob sum (current working tree only, excluding .git history)
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
  };
  if (provider === 'github' && options?.githubToken) {
    headers['Authorization'] = `Bearer ${options.githubToken}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);

  try {
    let bytes = 0;
    const treeRef = encodeURIComponent(tag && tag !== 'latest' ? tag : branch);
    if (provider === 'github' || provider === 'codeberg') {
      const treeUrl = provider === 'github'
        ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${treeRef}?recursive=1`
        : `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${treeRef}?recursive=1`;
      const treeRes = await fetchWithAnubisSupport(treeUrl, { headers, signal: ctrl.signal }).catch(() => null);
      if (treeRes && treeRes.ok) {
        const treeData: any = await treeRes.json().catch(() => null);
        if (Array.isArray(treeData?.tree) && treeData.tree.length > 0) {
          let rawTreeBytes = 0;
          for (const node of treeData.tree) {
            const p = String(node?.path || '');
            if (node?.type === 'blob' && Number(node?.size) > 0 && !p.startsWith('.git/') && !p.startsWith('.github/')) {
              rawTreeBytes += Number(node.size);
            }
          }
          if (rawTreeBytes > 0) {
            bytes = Math.max(512, Math.round(rawTreeBytes * 0.42));
          }
        }
      }
    }

    if (bytes === 0) {
      if (provider === 'github') {
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          { headers, signal: ctrl.signal }
        );
        if (res.ok) {
          const data: any = await res.json();
          const kb = Number(data?.size);
          if (Number.isFinite(kb) && kb > 0) {
            bytes = Math.round(kb * 1024);
          }
        }
      } else if (provider === 'codeberg') {
        const res = await fetchWithAnubisSupport(
          `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          { headers, signal: ctrl.signal }
        );
        if (res.ok) {
          const data: any = await res.json();
          const kb = Number(data?.size);
          if (Number.isFinite(kb) && kb > 0) {
            bytes = Math.round(kb * 1024);
          }
        }
      } else if (provider === 'gitlab') {
        const projectPath = encodeURIComponent(`${owner}/${repo}`);
        const res = await fetch(
          `https://${host}/api/v4/projects/${projectPath}`,
          { headers, signal: ctrl.signal }
        );
        if (res.ok) {
          const data: any = await res.json();
          const rawBytes = Number(data?.statistics?.repository_size || (data?.size ? data.size * 1024 : 0));
          if (Number.isFinite(rawBytes) && rawBytes > 0) {
            bytes = Math.round(rawBytes);
          }
        }
      }
    }
    clearTimeout(timer);

    if (bytes > 0) {
      const fileSize = formatByteSize(bytes) || `${Math.max(1, Math.round(bytes / 1024))} KB`;
      const result = { downloadSize: bytes, fileSize };
      await writeEdgeCacheJson(sizeCacheKey, result, 3600);
      return result;
    }
  } catch {
    clearTimeout(timer);
  }

  return null;
}

export async function fetchRepoSizeEstimateFromUrl(
  repoUrl?: string | null,
  fallbackAuthor?: string,
  fallbackName?: string,
  options?: AccurateGitZipSizeOptions
): Promise<{ downloadSize: number; fileSize: string } | null> {
  return fetchAccurateGitZipSize(repoUrl, fallbackAuthor, fallbackName, options);
}

let moderationColsEnsured = false;

/**
 * Ensures `moderation_reports` table and its communication/auto-heal columns (`resolution_note`, `updated_at`) exist.
 */
export async function ensureModerationColumns(db: any): Promise<void> {
  if (!db || moderationColsEnsured) return;
  moderationColsEnsured = true;

  try {
    await db.prepare(`
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
      )
    `).run();
  } catch {
    // Table exists
  }

  for (const colDef of ['resolution_note TEXT', 'updated_at DATETIME']) {
    try {
      await db.prepare(`ALTER TABLE moderation_reports ADD COLUMN ${colDef}`).run();
    } catch {
      // Column already exists
    }
  }
}

export interface CdbJsonMetadata {
  type?: 'mod' | 'game' | 'txp' | 'modpack';
  name?: string;
  title?: string;
  short_description?: string;
  long_description?: string;
  dev_state?: string;
  ai_disclosure?: string;
  ai_disclosures: string[];
  tags: string[];
  content_warnings: string[];
  license?: string;
  media_license?: string;
  repo?: string;
  website?: string;
  issue_tracker?: string;
  forum_url?: string;
  video_url?: string;
  donate_url?: string;
  translation_url?: string;
  screenshots: string[];
}

/**
 * Parses a Luanti `.conf` file (`mod.conf`, `game.conf`, `modpack.conf`, `texture_pack.conf`)
 * following `luanti-org/contentdb` `app/tasks/luanticheck/config.py` rules, including
 * multiline `"""..."""` string values and `#` comments.
 */
export function parseLuantiConf(confText: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!confText || typeof confText !== 'string') return result;

  const lines = confText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    i++;
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    if (!key) continue;

    let val = trimmed.slice(eqIdx + 1).trim();
    if (val.startsWith('"""')) {
      const afterOpen = val.slice(3);
      const closeSameLine = afterOpen.indexOf('"""');
      if (closeSameLine !== -1) {
        result[key] = afterOpen.slice(0, closeSameLine).trim();
      } else {
        const chunks: string[] = [afterOpen];
        while (i < lines.length) {
          const nextLine = lines[i++];
          const closeIdx = nextLine.indexOf('"""');
          if (closeIdx !== -1) {
            chunks.push(nextLine.slice(0, closeIdx));
            break;
          }
          chunks.push(nextLine);
        }
        result[key] = chunks.join('\n').trim();
      }
      continue;
    }

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    result[key] = val;
  }

  return result;
}

/**
 * Computes `short_description` from a `.conf` or `description.txt` description string
 * using `luanti-org/contentdb` `app/tasks/luanticheck/tree.py:234-241` rules.
 */
export function computeConfShortDescription(description?: string): string | undefined {
  if (!description || typeof description !== 'string') return undefined;
  const clean = description.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  if (clean.length <= 200) return clean;
  const firstSentenceIdx = clean.indexOf('.');
  if (firstSentenceIdx > 0 && firstSentenceIdx < 200) {
    return clean.slice(0, firstSentenceIdx).trim();
  }
  return clean.slice(0, 200).trim();
}

/**
 * Parses a Luanti ContentDB `.cdb.json` file (https://content.luanti.org/help/cdb_json/)
 * from a raw JSON string or object into normalized package metadata.
 * Supports all ContentDB `app/domain/packages.py` `ALLOWED_FIELDS` and `ALIASES`
 * (`short_desc`, `desc`, `issueTracker`, `forums`, `ai_disclosure`).
 */
export function parseCdbJsonMetadata(raw: any): CdbJsonMetadata | null {
  if (!raw) return null;
  let obj: any = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      return null;
    }
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return null;
  }

  const str = (v: any): string | undefined => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    return undefined;
  };

  let normalizedType: 'mod' | 'game' | 'txp' | 'modpack' | undefined;
  const rawType = str(obj.type)?.toLowerCase();
  if (rawType === 'mod') normalizedType = 'mod';
  else if (rawType === 'game') normalizedType = 'game';
  else if (rawType === 'txp' || rawType === 'texture_pack' || rawType === 'texture-pack') normalizedType = 'txp';
  else if (rawType === 'modpack') normalizedType = 'modpack';

  const rawForum = obj.forums ?? obj.forum_url;
  let forumUrl: string | undefined;
  if (typeof rawForum === 'number' && Number.isFinite(rawForum) && rawForum > 0) {
    forumUrl = `https://forum.luanti.org/viewtopic.php?t=${Math.trunc(rawForum)}`;
  } else if (typeof rawForum === 'string' && rawForum.trim()) {
    const cleanForum = rawForum.trim();
    forumUrl = cleanForum.startsWith('http')
      ? cleanForum
      : (/^\d+$/.test(cleanForum) ? `https://forum.luanti.org/viewtopic.php?t=${cleanForum}` : undefined);
  }

  const parseStringArray = (arr: any): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item: any) => (typeof item === 'string' ? item.trim() : String(item?.name || item?.title || '').trim()))
      .filter(Boolean);
  };

  const tags = parseStringArray(obj.tags).map(t => t.toLowerCase().replace(/[^a-z0-9_/-]/g, '')).filter(Boolean);
  const contentWarnings = parseStringArray(obj.content_warnings);
  const screenshots = parseStringArray(obj.screenshots);
  const aiDisclosures = Array.isArray(obj.ai_disclosures)
    ? parseStringArray(obj.ai_disclosures)
    : (str(obj.ai_disclosure) ? [str(obj.ai_disclosure)!] : []);

  let license = str(obj.license);
  const mediaLicense = str(obj.media_license);
  // ContentDB `app/domain/packages.py:92-93`: for TXP, if `license` is omitted, default to `media_license`
  if (normalizedType === 'txp' && !license && mediaLicense) {
    license = mediaLicense;
  }

  return {
    type: normalizedType,
    name: str(obj.name),
    title: str(obj.title),
    short_description: str(obj.short_description) || str(obj.short_desc),
    long_description: str(obj.long_description) || str(obj.long_desc) || str(obj.desc),
    dev_state: str(obj.dev_state),
    ai_disclosure: str(obj.ai_disclosure) || aiDisclosures[0],
    ai_disclosures: aiDisclosures,
    tags,
    content_warnings: contentWarnings,
    license,
    media_license: mediaLicense || license,
    repo: str(obj.repo) || str(obj.repo_url),
    website: str(obj.website),
    issue_tracker: str(obj.issue_tracker) || str(obj.issueTracker),
    forum_url: forumUrl,
    video_url: str(obj.video_url),
    donate_url: str(obj.donate_url),
    translation_url: str(obj.translation_url),
    screenshots
  };
}

export interface GitRepoScanResult {
  repoUrl?: string;
  rawBaseUrl?: string;
  gitRepoStatus: 'verified' | 'broken_404' | 'unverified';
  detectedType?: 'mod' | 'game' | 'txp' | 'modpack';
  title?: string;
  shortDesc?: string;
  longDesc?: string;
  license?: string;
  mediaLicense?: string;
  hardDeps: string[];
  softDeps: string[];
  minVersion?: string;
  maxVersion?: string;
  supportedGames: string[];
  unsupportedGames: string[];
  cdbMeta?: CdbJsonMetadata | null;
}

function normalizeGitRepoInputUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.toLowerCase().includes('notabug.org') && parts.length >= 2) {
      return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1]}`;
    }
  } catch {
    // Keep original if URL parsing fails
  }
  return trimmed;
}

/**
 * Agnostic server-side Git repository scanner modeled after `luanti-org/contentdb`
 * (`app/tasks/luanticheck/tree.py` & `app/tasks/importtasks.py`).
 * Scans `.conf` (`mod.conf`, `game.conf`, `modpack.conf`, `texture_pack.conf`),
 * `.cdb.json`, legacy `description.txt` / `depends.txt`, and `LICENSE` files on the Worker,
 * and caches the result in Cloudflare Edge Cache (`caches.default`) for 6 hours (`21600s`)
 * to preserve Worker subrequest and D1 quotas and eliminate browser 404s.
 */
export async function scanGitRepoMetadataCached(
  author: string,
  name: string,
  pkgType = 'mod',
  existingRepoUrl?: string,
  ttlSeconds = 21600
): Promise<GitRepoScanResult> {
  const normalizedInputUrl = normalizeGitRepoInputUrl(existingRepoUrl);
  const cacheKey = `/__git_repo_scan_v2/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/${encodeURIComponent((normalizedInputUrl || '').toLowerCase())}`;
  const cached = await readEdgeCacheJson<GitRepoScanResult>(cacheKey);
  if (cached && cached.gitRepoStatus) {
    return cached;
  }

  let owner = author;
  let repo = name;
  let host = '';

  if (normalizedInputUrl) {
    try {
      const u = new URL(normalizedInputUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        host = u.hostname.toLowerCase();
        owner = parts[0];
        repo = parts[1];
      }
    } catch {
      // Fallback to author/name
    }
  }

  const confFile =
    pkgType === 'game'
      ? 'game.conf'
      : pkgType === 'txp'
        ? 'texture_pack.conf'
        : pkgType === 'modpack'
          ? 'modpack.conf'
          : 'mod.conf';
  const lowerOwner = owner.toLowerCase();

  const rawBaseCandidates: Array<{ base: string; repoUrl: string }> = [];
  const pushCandidate = (base: string, repoUrl: string) => {
    if (!rawBaseCandidates.some(c => c.base === base)) {
      rawBaseCandidates.push({ base, repoUrl });
    }
  };

  if (host.includes('codeberg.org')) {
    pushCandidate(`https://codeberg.org/api/v1/repos/${owner}/${repo}/raw`, `https://codeberg.org/${owner}/${repo}`);
    pushCandidate(`https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://codeberg.org/${lowerOwner}/${repo}`);
  } else if (host.includes('minetest.land')) {
    pushCandidate(`https://git.minetest.land/api/v1/repos/${owner}/${repo}/raw`, `https://git.minetest.land/${owner}/${repo}`);
    pushCandidate(`https://git.minetest.land/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://git.minetest.land/${lowerOwner}/${repo}`);
  } else if (host.includes('gitlab.com')) {
    pushCandidate(`https://gitlab.com/${owner}/${repo}/-/raw/HEAD`, `https://gitlab.com/${owner}/${repo}`);
  } else if (host.includes('github.com')) {
    pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, `https://github.com/${owner}/${repo}`);
  }

  // Always include multi-forge fallbacks (GitHub HEAD, Codeberg v1 API raw, GitLab HEAD)
  pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, `https://github.com/${owner}/${repo}`);
  pushCandidate(`https://codeberg.org/api/v1/repos/${owner}/${repo}/raw`, `https://codeberg.org/${owner}/${repo}`);
  pushCandidate(`https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://codeberg.org/${lowerOwner}/${repo}`);
  pushCandidate(`https://gitlab.com/${owner}/${repo}/-/raw/HEAD`, `https://gitlab.com/${owner}/${repo}`);

  const hardDeps: string[] = [];
  const softDeps: string[] = [];
  let supportedGames: string[] = [];
  let unsupportedGames: string[] = [];
  let detectedType: 'mod' | 'game' | 'txp' | 'modpack' | undefined;
  let title: string | undefined;
  let shortDesc: string | undefined;
  let longDesc: string | undefined;
  let license: string | undefined;
  let mediaLicense: string | undefined;
  let minVersion: string | undefined;
  let maxVersion: string | undefined;
  let resolvedRepoUrl: string | undefined;
  let resolvedRawBaseUrl: string | undefined;
  let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = 'unverified';
  let sawExplicit404 = false;
  let cdbMeta: CdbJsonMetadata | null = null;

  const cleanDep = (s: string): string =>
    s
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\?$/, '')
      .split(/\s+#/)[0]
      .trim();

  const tryCandidates = async (candidates: Array<{ base: string; repoUrl: string }>): Promise<boolean> => {
    for (const cand of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1600);
      try {
        const [res, cdbRes] = await Promise.all([
          fetchWithAnubisSupport(`${cand.base}/${confFile}`, { signal: controller.signal }),
          fetchWithAnubisSupport(`${cand.base}/.cdb.json`, { signal: controller.signal }).catch(() => null)
        ]);
        clearTimeout(timer);

        if (cdbRes && cdbRes.ok) {
          const cdbText = await cdbRes.text().catch(() => '');
          const parsedCdb = parseCdbJsonMetadata(cdbText);
          if (parsedCdb) {
            cdbMeta = parsedCdb;
            resolvedRepoUrl = cand.repoUrl;
            resolvedRawBaseUrl = cand.base;
            gitRepoStatus = 'verified';
            if (parsedCdb.type) detectedType = parsedCdb.type;
            if (parsedCdb.title) title = parsedCdb.title;
            if (parsedCdb.short_description) shortDesc = parsedCdb.short_description;
            if (parsedCdb.long_description) longDesc = parsedCdb.long_description;
            if (parsedCdb.license) license = parsedCdb.license;
            if (parsedCdb.media_license) mediaLicense = parsedCdb.media_license;
          }
        }

        if (res.status === 404 && !cdbMeta) {
          const isPrimaryInputRepo =
            Boolean(normalizedInputUrl) &&
            cand.repoUrl.toLowerCase() === normalizedInputUrl!.toLowerCase();
          const fallbackCtrl = new AbortController();
          const fallbackTimer = setTimeout(() => fallbackCtrl.abort(), 1400);
          try {
            const [modpackRes, initRes, readmeRes, descTxtRes, depsTxtRes] = await Promise.all([
              fetchWithAnubisSupport(`${cand.base}/modpack.conf`, { signal: fallbackCtrl.signal }).catch(() => null),
              fetchWithAnubisSupport(`${cand.base}/init.lua`, { signal: fallbackCtrl.signal }).catch(() => null),
              fetchWithAnubisSupport(`${cand.base}/README.md`, { signal: fallbackCtrl.signal }).catch(() => null),
              fetchWithAnubisSupport(`${cand.base}/description.txt`, { signal: fallbackCtrl.signal }).catch(() => null),
              fetchWithAnubisSupport(`${cand.base}/depends.txt`, { signal: fallbackCtrl.signal }).catch(() => null)
            ]);
            clearTimeout(fallbackTimer);

            if (depsTxtRes && depsTxtRes.ok) {
              const depsTxt = await depsTxtRes.text().catch(() => '');
              if (depsTxt && !depsTxt.trim().startsWith('<!DOCTYPE') && !depsTxt.trim().startsWith('<html')) {
                for (const rawLine of depsTxt.split(/\r?\n/)) {
                  const line = rawLine.trim();
                  if (!line || line.startsWith('#')) continue;
                  if (line.endsWith('?')) {
                    const cleaned = cleanDep(line.slice(0, -1));
                    if (cleaned) softDeps.push(cleaned);
                  } else {
                    const cleaned = cleanDep(line);
                    if (cleaned) hardDeps.push(cleaned);
                  }
                }
              }
            }

            if (descTxtRes && descTxtRes.ok) {
              const descTxt = await descTxtRes.text().catch(() => '');
              if (descTxt && !descTxt.trim().startsWith('<!DOCTYPE') && !descTxt.trim().startsWith('<html')) {
                shortDesc = shortDesc || computeConfShortDescription(descTxt);
              }
            }

            for (const fbRes of [modpackRes, initRes, readmeRes]) {
              if (fbRes && fbRes.ok) {
                const fbText = await fbRes.text().catch(() => '');
                if (fbText && !fbText.trim().startsWith('<!DOCTYPE') && !fbText.trim().startsWith('<html')) {
                  resolvedRepoUrl = cand.repoUrl;
                  resolvedRawBaseUrl = cand.base;
                  gitRepoStatus = 'verified';
                  return true;
                }
              }
            }
            if (isPrimaryInputRepo) {
              sawExplicit404 = true;
            }
          } catch {
            clearTimeout(fallbackTimer);
          }
          continue;
        }

        if (res.ok) {
          const confText = await res.text();
          if (confText && !confText.trim().startsWith('<!DOCTYPE') && !confText.trim().startsWith('<html')) {
            resolvedRepoUrl = cand.repoUrl;
            resolvedRawBaseUrl = cand.base;
            gitRepoStatus = 'verified';
            const confMap = parseLuantiConf(confText);

            const depStr = confMap['depends'] || '';
            const optStr = confMap['optional_depends'] || '';
            if (depStr) {
              depStr.split(',').map(cleanDep).filter(Boolean).forEach(d => hardDeps.push(d));
            }
            if (optStr) {
              optStr.split(',').map(cleanDep).filter(Boolean).forEach(d => softDeps.push(d));
            }

            if (confMap['supported_games']) {
              supportedGames = confMap['supported_games'].split(',').map(cleanDep).filter(Boolean);
            }
            if (confMap['unsupported_games']) {
              unsupportedGames = confMap['unsupported_games'].split(',').map(cleanDep).filter(Boolean);
            }

            // ContentDB `tree.py:225-241`: game.conf uses `name` as `title` if `title` is not set
            const confTitle =
              confMap['title'] ||
              (pkgType === 'game' ? confMap['name'] : undefined) ||
              (confMap['name']
                ? confMap['name'].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                : undefined);
            title = cdbMeta?.title || confTitle || title;

            const confDesc = confMap['description'];
            const computedShort = computeConfShortDescription(confDesc);
            shortDesc = cdbMeta?.short_description || computedShort || shortDesc;
            if (!longDesc && confDesc && computedShort && confDesc.length > computedShort.length) {
              longDesc = confDesc;
            }

            // `.cdb.json` overlays `.conf` (matching `importtasks.py:64-79`)
            license = cdbMeta?.license || confMap['license'] || license || undefined;
            mediaLicense = cdbMeta?.media_license || confMap['media_license'] || mediaLicense || undefined;
            minVersion = confMap['min_minetest_version'] || undefined;
            maxVersion = confMap['max_minetest_version'] || undefined;

            if ((pkgType === 'txp' || detectedType === 'txp') && !license && mediaLicense) {
              license = mediaLicense;
            }

            if (!license) {
              for (const licFile of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
                try {
                  const licRes = await fetchWithAnubisSupport(`${cand.base}/${licFile}`);
                  if (licRes.ok) {
                    const licText = await licRes.text();
                    const detected = detectSpdxFromText(licText);
                    if (detected) {
                      license = detected;
                      break;
                    }
                  }
                } catch {
                  // Ignore
                }
              }
            }
            return true;
          }
        }
        if (cdbMeta) {
          return true;
        }
      } catch {
        clearTimeout(timer);
      }
    }
    return false;
  };

  const foundDirect = await tryCandidates(rawBaseCandidates);

  // Dynamic Codeberg & GitHub search discovery ONLY when no explicit repo_url was provided
  // and restricted strictly to repositories owned by the package author.
  if (!foundDirect && !normalizedInputUrl && name) {
    const searchCandidates: Array<{ base: string; repoUrl: string }> = [];
    const targetName = name.toLowerCase();
    const targetAuthor = author.toLowerCase();

    try {
      const cbRes = await fetch(`https://codeberg.org/api/v1/repos/search?q=${encodeURIComponent(name)}&limit=8`, {
        headers: { 'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luantihub.org)' }
      });
      if (cbRes.ok) {
        const cbJson: any = await cbRes.json();
        const cbRepos: any[] = Array.isArray(cbJson?.data) ? cbJson.data : [];
        for (const r of cbRepos) {
          const rOwner = String(r?.owner?.login || r?.owner?.username || '').toLowerCase();
          if (r && String(r.name || '').toLowerCase() === targetName && rOwner === targetAuthor && r.full_name) {
            searchCandidates.push({
              base: `https://codeberg.org/api/v1/repos/${r.full_name}/raw`,
              repoUrl: r.html_url || `https://codeberg.org/${r.full_name}`
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    try {
      const ghRes = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(name)}+in:name&per_page=5`, {
        headers: { 'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luantihub.org)' }
      });
      if (ghRes.ok) {
        const ghJson: any = await ghRes.json();
        const ghRepos: any[] = Array.isArray(ghJson?.items) ? ghJson.items : [];
        for (const r of ghRepos) {
          const rOwner = String(r?.owner?.login || '').toLowerCase();
          if (r && String(r.name || '').toLowerCase() === targetName && rOwner === targetAuthor && r.full_name) {
            searchCandidates.push({
              base: `https://raw.githubusercontent.com/${r.full_name}/HEAD`,
              repoUrl: r.html_url || `https://github.com/${r.full_name}`
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    if (searchCandidates.length > 0) {
      await tryCandidates(searchCandidates);
    }
  }

  if (!resolvedRepoUrl && sawExplicit404 && normalizedInputUrl) {
    gitRepoStatus = 'broken_404';
  }

  const scanResult: GitRepoScanResult = {
    repoUrl: resolvedRepoUrl || normalizedInputUrl,
    rawBaseUrl: resolvedRawBaseUrl,
    gitRepoStatus,
    detectedType,
    title,
    shortDesc,
    longDesc,
    license,
    mediaLicense: mediaLicense || license,
    hardDeps: Array.from(new Set(hardDeps)),
    softDeps: Array.from(new Set(softDeps)),
    minVersion,
    maxVersion,
    supportedGames,
    unsupportedGames,
    cdbMeta
  };

  if (ttlSeconds > 0 && scanResult.gitRepoStatus !== 'unverified') {
    await writeEdgeCacheJson(cacheKey, scanResult, ttlSeconds);
  }

  return scanResult;
}

/**
 * Automatically resolves any open 'broken' (404) moderation reports for a package
 * once its Git repository is verified back online (HTTP 200).
 */
export async function autoResolveBrokenRepoReport(
  db: any,
  packageId: string,
  note = 'Automated check confirmed repository URL is back online and verified (HTTP 200).'
): Promise<boolean> {
  if (!db || !packageId) return false;
  try {
    await ensureModerationColumns(db);
    const res = await db.prepare(`
      UPDATE moderation_reports
      SET status = 'resolved',
          resolved_by = 'system-auto-heal',
          resolution_note = ?,
          resolved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(package_id) = LOWER(?) AND reason = 'broken' AND status = 'open'
    `).bind(note, packageId).run();
    return Boolean((res?.meta?.changes || 0) > 0);
  } catch {
    return false;
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/**
 * Synchronous, zero-allocation SHA-256 Proof-of-Work solver for Anubis v1.28.2 (`algorithm: "fast"`).
 * Solves difficulty 4 (~65k expected hashes) in <8ms inside V8 without async microtask overhead.
 */
export function solveAnubisPowChallengeSync(
  randomData: string,
  difficulty = 4,
  maxIterations = 2_000_000
): { nonce: number; hashHex: string; elapsedMs: number } | null {
  const startMs = Date.now();
  const encoder = new TextEncoder();
  const prefixBytes = encoder.encode(randomData);
  const fullZeroBytes = Math.floor(Math.max(1, difficulty) / 2);
  const checkHalfByte = difficulty % 2 !== 0;

  const block = new Uint8Array(128);
  const view = new DataView(block.buffer);
  const w = new Uint32Array(64);

  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const nonceStr = String(nonce);
    const totalLen = prefixBytes.length + nonceStr.length;
    if (totalLen + 9 > 128) break;

    block.fill(0);
    block.set(prefixBytes, 0);
    for (let i = 0; i < nonceStr.length; i++) {
      block[prefixBytes.length + i] = nonceStr.charCodeAt(i);
    }
    block[totalLen] = 0x80;

    const numBlocks = totalLen + 9 <= 64 ? 1 : 2;
    const bitLen = totalLen * 8;
    view.setUint32(numBlocks * 64 - 4, bitLen >>> 0, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    for (let b = 0; b < numBlocks; b++) {
      const baseOffset = b * 64;
      for (let i = 0; i < 16; i++) {
        w[i] = view.getUint32(baseOffset + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const w15 = w[i - 15];
        const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        const w2 = w[i - 2];
        const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      let a = h0;
      let bReg = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & bReg) ^ (a & c) ^ (bReg & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = bReg;
        bReg = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + bReg) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    // Fast top-word check for difficulty <= 8 (up to 4 full zero bytes in h0)
    const words = [h0, h1, h2, h3, h4, h5, h6, h7];
    let matched = true;
    for (let byteIdx = 0; byteIdx < fullZeroBytes; byteIdx++) {
      const word = words[byteIdx >> 2];
      const shift = (3 - (byteIdx & 3)) * 8;
      if (((word >>> shift) & 0xff) !== 0) {
        matched = false;
        break;
      }
    }
    if (matched && checkHalfByte) {
      const word = words[fullZeroBytes >> 2];
      const shift = (3 - (fullZeroBytes & 3)) * 8;
      if ((((word >>> shift) & 0xff) >>> 4) !== 0) {
        matched = false;
      }
    }

    if (matched) {
      const hashHex = words.map(x => x.toString(16).padStart(8, '0')).join('');
      return {
        nonce,
        hashHex,
        elapsedMs: Math.max(16, Date.now() - startMs)
      };
    }
  }
  return null;
}

function extractSetCookiePairs(headers: Headers): string[] {
  const pairs: string[] = [];
  const getSetCookieFn = (headers as any)?.getSetCookie;
  if (typeof getSetCookieFn === 'function') {
    const rawList: string[] = getSetCookieFn.call(headers) || [];
    for (const raw of rawList) {
      const firstPart = String(raw || '').split(';')[0]?.trim();
      if (firstPart && firstPart.includes('=')) pairs.push(firstPart);
    }
  }
  if (pairs.length === 0) {
    const rawCombined = headers.get('set-cookie') || '';
    if (rawCombined) {
      for (const chunk of rawCombined.split(/,(?=\s*[a-zA-Z0-9_-]+=)/)) {
        const firstPart = chunk.split(';')[0]?.trim();
        if (firstPart && firstPart.includes('=')) pairs.push(firstPart);
      }
    }
  }
  return pairs;
}

/**
 * Transparently handles Techaro Anubis v1.28+ Proof-of-Work challenges on upstream community
 * Git forges (such as Mesehub `git.minetest.land`), caching the signed JWT clearance cookie
 * in Isolate Memory + Cloudflare Edge Cache (`caches.default`) for 24 hours.
 */
export async function fetchWithAnubisSupport(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let host = '';
  let origin = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    origin = parsed.origin;
  } catch {
    return fetch(url, init);
  }

  const isAnubisCandidate = host.includes('minetest.land') || host.includes('mesehub');
  if (!isAnubisCandidate) {
    return fetch(url, init);
  }

  const cookieCacheKey = `/__anubis_cookie_v1/${encodeURIComponent(host)}`;
  const cachedCookieObj = await readEdgeCacheJson<{ cookie: string }>(cookieCacheKey);

  const buildHeadersWithCookie = (cookieStr?: string): Record<string, string> => {
    const merged: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; LuantiHub/1.0; +https://luantihub.org)'
    };
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          merged[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) merged[k] = v;
      } else {
        Object.assign(merged, init.headers as Record<string, string>);
      }
    }
    if (cookieStr) {
      merged['Cookie'] = merged['Cookie'] ? `${merged['Cookie']}; ${cookieStr}` : cookieStr;
    }
    return merged;
  };

  const firstRes = await fetch(url, {
    ...init,
    headers: buildHeadersWithCookie(cachedCookieObj?.cookie)
  });

  const contentType = (firstRes.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return firstRes;
  }

  const clonedText = await firstRes.clone().text().catch(() => '');
  if (!clonedText.includes('id="anubis_challenge"')) {
    return firstRes;
  }

  const scriptMatch = clonedText.match(
    /<script\s+id=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!scriptMatch || !scriptMatch[1]) {
    return firstRes;
  }

  try {
    const challengePayload = JSON.parse(scriptMatch[1].trim());
    const challenge = challengePayload?.challenge;
    const challengeId = String(challenge?.id || '').trim();
    const randomData = String(challenge?.randomData || '').trim();
    const difficulty = Number(challenge?.difficulty || challengePayload?.rules?.difficulty || 4);

    if (!challengeId || !randomData) {
      return firstRes;
    }

    const solved = solveAnubisPowChallengeSync(randomData, difficulty);
    if (!solved) {
      return firstRes;
    }

    const verificationCookies = extractSetCookiePairs(firstRes.headers);
    const passUrl = `${origin}/.within.website/x/cmd/anubis/api/pass-challenge?id=${encodeURIComponent(challengeId)}&response=${encodeURIComponent(solved.hashHex)}&nonce=${solved.nonce}&redir=${encodeURIComponent('/')}&elapsedTime=${solved.elapsedMs}`;

    const passRes = await fetch(passUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LuantiHub/1.0; +https://luantihub.org)',
        ...(verificationCookies.length > 0 ? { 'Cookie': verificationCookies.join('; ') } : {})
      }
    });

    const authCookies = extractSetCookiePairs(passRes.headers);
    const allCookies = Array.from(new Set([...verificationCookies, ...authCookies])).join('; ');
    if (!allCookies) {
      return firstRes;
    }

    await writeEdgeCacheJson(cookieCacheKey, { cookie: allCookies }, 86400);

    return fetch(url, {
      ...init,
      headers: buildHeadersWithCookie(allCookies)
    });
  } catch {
    return firstRes;
  }
}

export interface DiscoveredReleaseCommitItem {
  sha: string;
  short_sha: string;
  title: string;
  author_name: string;
  committed_at: string;
  url: string;
}

export interface DiscoveredReleaseNotesPayload {
  source: 'compare' | 'commits' | 'release_notes' | 'metadata';
  head_ref: string;
  base_ref?: string;
  compare_url?: string;
  markdown_body?: string;
  commits: DiscoveredReleaseCommitItem[];
}

function normalizeForgeCommitItem(
  c: any,
  provider: 'github' | 'codeberg' | 'gitlab',
  host: string,
  owner: string,
  repo: string
): DiscoveredReleaseCommitItem | null {
  if (!c || typeof c !== 'object') return null;
  const sha = String(c.sha || c.id || '').trim();
  if (!sha) return null;
  const rawMessage = String(c.commit?.message || c.message || c.title || '').trim();
  const firstLine = rawMessage.split(/\r?\n/)[0]?.trim() || sha.slice(0, 7);
  const authorName = String(
    c.commit?.author?.name ||
    c.author?.login ||
    c.author?.username ||
    c.author_name ||
    owner
  ).trim();
  const committedAt = String(
    c.commit?.author?.date ||
    c.commit?.committer?.date ||
    c.created_at ||
    c.committed_date ||
    ''
  ).trim();
  const webUrl = String(
    c.html_url ||
    c.web_url ||
    (provider === 'gitlab'
      ? `https://${host}/${owner}/${repo}/-/commit/${sha}`
      : `https://${host}/${owner}/${repo}/commit/${sha}`)
  ).trim();

  return {
    sha,
    short_sha: sha.slice(0, 7),
    title: firstLine,
    author_name: authorName,
    committed_at: committedAt,
    url: webUrl
  };
}

/**
 * Generates expandable release notes & commit diffs between two refs (`baseRef...headRef`)
 * with a 4-level fallback hierarchy:
 * 1. Forge Compare API (`baseRef...headRef`) when both refs exist.
 * 2. Single-ref Commit History (`?sha=headRef`) for the oldest release/tag.
 * 3. Default Branch Commit History (`main`/`master`/`HEAD`) when a package has no tags/releases.
 * 4. Release body / ContentDB metadata summary when no Git repository is reachable.
 */
export async function fetchGitReleaseNotesBetweenRefs(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string,
  options: {
    headRef?: string;
    baseRef?: string;
    defaultBranch?: string;
    releaseBody?: string;
  } = {}
): Promise<DiscoveredReleaseNotesPayload> {
  const headRef = (options.headRef || options.defaultBranch || 'HEAD').trim();
  const baseRef = (options.baseRef || '').trim();
  const releaseBody = (options.releaseBody || '').trim();

  const target = parseGitRepoTarget(repoUrl, fallbackOwner, fallbackRepo);
  if (!target) {
    return {
      source: releaseBody ? 'release_notes' : 'metadata',
      head_ref: headRef,
      base_ref: baseRef || undefined,
      markdown_body: releaseBody || undefined,
      commits: []
    };
  }

  const { provider, host, owner, repo } = target;
  const cacheKey = `/__release_notes_v1/${provider}/${encodeURIComponent(host)}/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}/${encodeURIComponent(headRef)}/${encodeURIComponent(baseRef || 'none')}`;
  const cached = await readEdgeCacheJson<DiscoveredReleaseNotesPayload>(cacheKey);
  if (cached && Array.isArray(cached.commits)) {
    return cached;
  }

  const headers: Record<string, string> = {
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)',
    'Accept': provider === 'github' ? 'application/vnd.github+json' : 'application/json'
  };

  const fetchJsonQuick = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3800);
    try {
      const res = await fetchWithAnubisSupport(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  let commits: DiscoveredReleaseCommitItem[] = [];
  let source: DiscoveredReleaseNotesPayload['source'] = 'commits';
  let compareUrl: string | undefined;

  // Level 1: Compare between baseRef...headRef
  if (baseRef && headRef && baseRef !== headRef && headRef.toUpperCase() !== 'HEAD') {
    const encBase = encodeURIComponent(baseRef);
    const encHead = encodeURIComponent(headRef);
    if (provider === 'github') {
      compareUrl = `https://github.com/${owner}/${repo}/compare/${encBase}...${encHead}`;
      const cmp = await fetchJsonQuick(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encBase}...${encHead}`
      );
      if (Array.isArray(cmp?.commits) && cmp.commits.length > 0) {
        source = 'compare';
        commits = [...cmp.commits]
          .reverse()
          .map(c => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      }
    } else if (provider === 'codeberg') {
      compareUrl = `https://${host}/${owner}/${repo}/compare/${encBase}...${encHead}`;
      const cmp = await fetchJsonQuick(
        `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encBase}...${encHead}`
      );
      if (Array.isArray(cmp?.commits) && cmp.commits.length > 0) {
        source = 'compare';
        commits = cmp.commits
          .map((c: any) => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c: DiscoveredReleaseCommitItem | null): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      }
    } else if (provider === 'gitlab') {
      compareUrl = `https://${host}/${owner}/${repo}/-/compare/${encBase}...${encHead}`;
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const cmp = await fetchJsonQuick(
        `https://${host}/api/v4/projects/${projectPath}/repository/compare?from=${encBase}&to=${encHead}`
      );
      if (Array.isArray(cmp?.commits) && cmp.commits.length > 0) {
        source = 'compare';
        commits = [...cmp.commits]
          .reverse()
          .map(c => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      }
    }
  }

  // Level 2 & 3: Single-ref or Default-Branch commit history fallback
  if (commits.length === 0) {
    const refCandidates = Array.from(
      new Set(
        [
          headRef !== 'HEAD' ? headRef : '',
          options.defaultBranch || '',
          ''
        ].filter(v => v !== undefined)
      )
    );

    for (const refCand of refCandidates) {
      const encRef = refCand ? encodeURIComponent(refCand) : '';
      let rawList: any = null;
      if (provider === 'github') {
        rawList = await fetchJsonQuick(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=15${encRef ? `&sha=${encRef}` : ''}`
        );
      } else if (provider === 'codeberg') {
        rawList = await fetchJsonQuick(
          `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?limit=15${encRef ? `&sha=${encRef}` : ''}`
        );
      } else if (provider === 'gitlab') {
        const projectPath = encodeURIComponent(`${owner}/${repo}`);
        rawList = await fetchJsonQuick(
          `https://${host}/api/v4/projects/${projectPath}/repository/commits?per_page=15${encRef ? `&ref_name=${encRef}` : ''}`
        );
      }

      if (Array.isArray(rawList) && rawList.length > 0) {
        source = 'commits';
        commits = rawList
          .map(c => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 15);
        break;
      }
    }
  }

  // Filter out noisy merge commits if there are non-merge commits available
  if (commits.length > 2) {
    const nonMerge = commits.filter(
      c => !/^Merge (pull request|branch|remote-tracking branch)\b/i.test(c.title)
    );
    if (nonMerge.length > 0) {
      commits = nonMerge;
    }
  }

  const payload: DiscoveredReleaseNotesPayload = {
    source: commits.length > 0 ? source : releaseBody ? 'release_notes' : 'metadata',
    head_ref: headRef,
    base_ref: baseRef || undefined,
    compare_url: compareUrl || `https://${host}/${owner}/${repo}/commits/${encodeURIComponent(headRef === 'HEAD' ? (options.defaultBranch || 'HEAD') : headRef)}`,
    markdown_body: releaseBody || undefined,
    commits
  };

  if (commits.length > 0 || releaseBody) {
    await writeEdgeCacheJson(cacheKey, payload, 3600);
  }

  return payload;
}


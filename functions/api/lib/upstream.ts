// High-Availability Upstream Proxy with Automatic Mirror Failover & Cloudflare Edge Cache
const PRIMARY_UPSTREAM = 'https://content.luanti.org/api';
const MIRROR_UPSTREAM = 'https://contentdb.milcho.org/api';

export async function fetchWithFailover(path: string, options: RequestInit = {}): Promise<Response> {
  // Endpoints like /scores/ or ?fmt=vcs do not exist on the static milcho.org mirror, so give primary ContentDB more time (7500ms)
  const isPrimaryOnlyEndpoint = path.startsWith('/scores') || path.includes('fmt=vcs');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), isPrimaryOnlyEndpoint ? 7500 : 3500);

  const defaultHeaders = {
    'User-Agent': 'Luanti/5.11.0 (LuantiHub; +https://luanti-hub.pages.dev)',
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
    throw new Error(`Primary returned HTTP ${res.status}`);
  } catch {
    clearTimeout(timeoutId);
    // Automatic Failover to milcho.org mirror (rewrite single-package detail routes to /for-client/ which the static mirror caches)
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
 * Fetches JSON from upstream ContentDB / mirror with Cloudflare Edge Cache API support
 */
export async function fetchUpstreamJsonCached<T = any>(
  path: string,
  ttlSeconds = 300
): Promise<T | null> {
  const cacheKeyUrl = `https://cache.luantihub.internal${path}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        return await cached.json() as T;
      }
    } catch {
      // Proceed to network fetch
    }
  }

  try {
    const res = await fetchWithFailover(path);
    if (!res.ok) return null;
    const data = await res.json() as T;

    if (edgeCache && data) {
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
 * Reads a cached JSON response payload from Cloudflare's Edge Cache (`caches.default`).
 */
export async function readEdgeCacheJson<T = any>(cacheKeyPath: string): Promise<T | null> {
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache) return null;
  try {
    const cacheReq = new Request(buildEdgeCacheRequestUrl(cacheKeyPath), { method: 'GET' });
    const cached = await edgeCache.match(cacheReq);
    if (cached) {
      return await cached.json() as T;
    }
  } catch {
    // Ignore cache read error
  }
  return null;
}

/**
 * Writes a JSON response payload into Cloudflare's Edge Cache (`caches.default`) with a TTL.
 */
export async function writeEdgeCacheJson(
  cacheKeyPath: string,
  payload: any,
  ttlSeconds = 300
): Promise<void> {
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache) return;
  try {
    const cacheReq = new Request(buildEdgeCacheRequestUrl(cacheKeyPath), { method: 'GET' });
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
 * Evicts one or more keys from Cloudflare's Edge Cache (`caches.default`) after a D1 mutation.
 * Automatically expands package detail keys so both `/full/`, `/lite/`, and legacy URLs are evicted.
 */
export async function invalidateEdgeCacheKeys(cacheKeyPaths: string[]): Promise<void> {
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache || !Array.isArray(cacheKeyPaths)) return;

  const expandedUrls = new Set<string>([
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v1',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v2'
  ]);
  for (const p of cacheKeyPaths) {
    if (!p) continue;
    expandedUrls.add(buildEdgeCacheRequestUrl(p));
    const pkgDetailMatch = p.match(/^\/__api_pkg_detail_v[23]\/(?:full\/|lite\/)?([^/]+)\/([^/]+)$/i);
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
    }
  }

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
          tags = COALESCE(excluded.tags, packages.tags),
          updated_at = CURRENT_TIMESTAMP
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
 * Ensures `contentdb_downloads` and `luantihub_downloads` columns exist on `packages`
 * in Cloudflare D1 at runtime so dual-counter tracking works without manual CLI migration.
 */
export async function ensureExtendedPackageColumns(db: any): Promise<void> {
  if (!db || extendedColumnsEnsured) return;
  extendedColumnsEnsured = true;
  const requiredCols: Array<[string, string]> = [
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
    ['provides', 'TEXT']
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
  } catch {
    // Ignore schema inspection errors
  }
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
  provider: 'github' | 'codeberg' | 'gitlab',
  host: string,
  owner: string,
  repo: string,
  tagName: string
): string {
  const encTag = encodeURIComponent(tagName);
  if (provider === 'codeberg') {
    return `https://${host}/${owner}/${repo}/archive/${encTag}.zip`;
  }
  if (provider === 'gitlab') {
    return `https://${host}/${owner}/${repo}/-/archive/${encTag}/${repo}-${encTag}.zip`;
  }
  return `https://github.com/${owner}/${repo}/archive/refs/tags/${encTag}.zip`;
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
    'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)',
    'Accept': provider === 'github' ? 'application/vnd.github+json' : 'application/json'
  };

  const fetchJsonWithTimeout = async (url: string): Promise<any[] | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
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

  return results;
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
 * Parses a Luanti ContentDB `.cdb.json` file (https://content.luanti.org/help/cdb_json/)
 * from a raw JSON string or object into normalized package metadata.
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
  else if (rawType === 'txp' || rawType === 'texture_pack') normalizedType = 'txp';
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

  return {
    type: normalizedType,
    name: str(obj.name),
    title: str(obj.title),
    short_description: str(obj.short_description) || str(obj.short_desc),
    long_description: str(obj.long_description) || str(obj.long_desc),
    dev_state: str(obj.dev_state),
    tags,
    content_warnings: contentWarnings,
    license: str(obj.license),
    media_license: str(obj.media_license),
    repo: str(obj.repo) || str(obj.repo_url),
    website: str(obj.website),
    issue_tracker: str(obj.issue_tracker),
    forum_url: forumUrl,
    video_url: str(obj.video_url),
    donate_url: str(obj.donate_url),
    translation_url: str(obj.translation_url),
    screenshots
  };
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

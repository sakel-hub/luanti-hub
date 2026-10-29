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
    // Automatic Failover to milcho.org mirror
    return fetch(`${MIRROR_UPSTREAM}${path}`, {
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

/**
 * Reads a cached JSON response payload from Cloudflare's Edge Cache (`caches.default`).
 */
export async function readEdgeCacheJson<T = any>(cacheKeyPath: string): Promise<T | null> {
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache) return null;
  try {
    const cacheReq = new Request(`https://cache.luantihub.internal${cacheKeyPath}`, { method: 'GET' });
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
    const cacheReq = new Request(`https://cache.luantihub.internal${cacheKeyPath}`, { method: 'GET' });
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
 */
export async function invalidateEdgeCacheKeys(cacheKeyPaths: string[]): Promise<void> {
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
  if (!edgeCache || !Array.isArray(cacheKeyPaths)) return;
  await Promise.all(
    cacheKeyPaths.map(async (p) => {
      try {
        const req = new Request(`https://cache.luantihub.internal${p}`, { method: 'GET' });
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
    const cdbRes = await fetchWithFailover(`/packages/?author=${encodeURIComponent(username)}`);
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
  branch = 'main',
  _providerHint?: string
): string {
  const target = parseGitRepoTarget(repoUrl, fallbackOwner, fallbackRepo);
  const safeBranch = encodeURIComponent(branch || 'main');
  if (!target) {
    return `https://github.com/${encodeURIComponent(fallbackOwner || '')}/${encodeURIComponent(fallbackRepo || '')}/archive/refs/heads/${safeBranch}.zip`;
  }
  const { provider, host, owner, repo } = target;
  if (provider === 'codeberg') {
    return `https://${host}/${owner}/${repo}/archive/${safeBranch}.zip`;
  }
  if (provider === 'gitlab') {
    return `https://${host}/${owner}/${repo}/-/archive/${safeBranch}/${repo}-${safeBranch}.zip`;
  }
  return `https://github.com/${owner}/${repo}/archive/refs/heads/${safeBranch}.zip`;
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

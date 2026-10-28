// High-Availability Upstream Proxy with Automatic Mirror Failover & Cloudflare Edge Cache
const PRIMARY_UPSTREAM = 'https://content.luanti.org/api';
const MIRROR_UPSTREAM = 'https://contentdb.milcho.org/api';

export async function fetchWithFailover(path: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s fast timeout

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
  'git.minetest.land',
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

      await db.prepare(`
        INSERT INTO packages (
          id, author_id, author_name, name, title, type, short_desc,
          repo_url, provider, thumbnail_url, score, downloads_count,
          license, media_license, tags, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'contentdb', ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          author_id = excluded.author_id,
          title = excluded.title,
          short_desc = excluded.short_desc,
          thumbnail_url = COALESCE(NULLIF(excluded.thumbnail_url, ''), packages.thumbnail_url),
          downloads_count = MAX(packages.downloads_count, excluded.downloads_count),
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
        typeof p.downloads === 'number' ? p.downloads : 0,
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

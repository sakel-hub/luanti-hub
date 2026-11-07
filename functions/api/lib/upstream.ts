// High-Availability Upstream Proxy with Automatic Mirror Failover & Cloudflare Edge Cache
const PRIMARY_UPSTREAM = 'https://content.luanti.org/api';
const MIRROR_UPSTREAM = 'https://contentdb.milcho.org/api';

/**
 * Safely URL-decodes a Cloudflare Pages `context.params` route segment, iteratively unwrapping
 * nested `%25` double/multi-encoding (e.g. `"LC%252520Creations"` -> `"LC Creations"`) without
 * throwing `URIError` on malformed percent sequences.
 */
export function safeDecodeParam(value: unknown, maxIterations = 16): string {
  let current = String(value ?? '').replace(/%(?:25)+([0-9A-Fa-f]{2})/g, '%$1');
  for (let i = 0; i < maxIterations && current.includes('%'); i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next.replace(/%(?:25)+([0-9A-Fa-f]{2})/g, '%$1');
    } catch {
      break;
    }
  }
  return current;
}

export async function fetchWithFailover(path: string, options: RequestInit = {}): Promise<Response> {
  // Primary ContentDB (https://content.luanti.org/api) is online and serves as our primary source of truth.
  // Give bulk endpoints (/scores/, ?fmt=vcs) and standard endpoints 4500ms before failing over to the mirror.
  const isBulkEndpoint = path.startsWith('/scores') || path.includes('fmt=vcs') || path === '/packages/' || path.startsWith('/packages/?');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), isBulkEndpoint ? 4500 : 4000);

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
    const ct = (res.headers?.get('content-type') || '').toLowerCase();
    if (res.ok && !ct.includes('text/html')) return res;
    // If primary ContentDB is online and returns a genuine 400/404/410, do NOT retry the mirror
    // (retrying the static mirror on a genuine 404 only adds latency, whereas 401/403/429/HTML challenges must fail over).
    if (res.status === 400 || res.status === 404 || res.status === 410) {
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
 * Normalizes naive UTC timestamp strings (e.g. Python's `datetime.utcnow().isoformat()` or SQLite's
 * `YYYY-MM-DD HH:MM:SS` without a timezone suffix) by appending `Z` so `Date.parse()` / `new Date()`
 * always evaluates them in UTC rather than local time.
 */
export function normalizeUtcIsoTimestamp(raw: unknown): string {
  const str = String(raw ?? '').trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
    return `${str.replace(' ', 'T')}Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
    return `${str}Z`;
  }
  return str;
}

/**
 * Normalizes a ContentDB `PackageReview.as_dict()` entry from `GET /api/packages/<author>/<name>/reviews/`
 * or `GET /api/reviews/` (see `luanti-org/contentdb` `app/models/threads.py:202-225` and `app/flatpages/help/api.md:382-427`).
 */
export function normalizeContentDbReviewItem(r: any, idx = 0, packageId?: string): any {
  const rawUsername = String(
    r?.user?.username ||
    r?.author?.username ||
    (typeof r?.author === 'string' ? r.author : '') ||
    r?.reviewer_username ||
    r?.username ||
    'contentdb_user'
  ).trim();
  const rawDisplayName = String(
    r?.user?.display_name ||
    r?.author?.display_name ||
    r?.reviewer_display_name ||
    r?.user?.username ||
    (typeof r?.author === 'string' ? r.author : '') ||
    rawUsername ||
    'Community Member'
  ).trim();
  const resolvedPkgId = String(
    packageId ||
    r?.package_id ||
    r?.packageId ||
    (r?.package?.author && r?.package?.name ? `${r.package.author}/${r.package.name}` : '')
  ).trim();
  const explicitId = r?.thread?.id ?? r?.id;
  const fallbackIdKey = resolvedPkgId
    ? `${resolvedPkgId.toLowerCase()}_${rawUsername}_${r?.created_at || idx}`
    : `${rawUsername}_${r?.created_at || idx}`;
  const rawThreadId =
    explicitId !== undefined && explicitId !== null && String(explicitId).trim() !== ''
      ? String(explicitId).trim()
      : fallbackIdKey;
  const cleanId =
    rawThreadId.startsWith('cdb_') || rawThreadId.startsWith('lh_')
      ? rawThreadId
      : `cdb_${rawThreadId}`;
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
  const rawThreadUrl = typeof r?.thread_url === 'string' && r.thread_url.trim()
    ? r.thread_url.trim()
    : (typeof r?.thread?.url === 'string' && r.thread.url.trim()
        ? (r.thread.url.startsWith('http') ? r.thread.url.trim() : `https://content.luanti.org${r.thread.url.startsWith('/') ? '' : '/'}${r.thread.url.trim()}`)
        : (typeof r?.thread?.id === 'number' ? `https://content.luanti.org/threads/${r.thread.id}/` : undefined));
  const pkgTitle = r?.package_title || r?.package?.title || undefined;
  const rawPkgType = r?.package_type || r?.package?.type || undefined;
  const pkgType = rawPkgType
    ? (String(rawPkgType).toLowerCase() === 'modpack' ? 'mod' : String(rawPkgType).toLowerCase())
    : undefined;
  const pkgThumb = r?.package_thumbnail || r?.package?.thumbnail || undefined;
  const normalizedCreatedAt = normalizeUtcIsoTimestamp(r?.created_at) || new Date().toISOString();

  return {
    id: cleanId,
    ...(resolvedPkgId ? { package_id: resolvedPkgId } : {}),
    ...(pkgTitle ? { package_title: String(pkgTitle) } : {}),
    ...(pkgType ? { package_type: pkgType } : {}),
    ...(pkgThumb ? { package_thumbnail: String(pkgThumb) } : {}),
    source: r?.source === 'luantihub' ? 'luantihub' : 'contentdb',
    rating,
    is_positive: isPositive,
    title: r?.title || undefined,
    comment: r?.comment || r?.text || '',
    created_at: normalizedCreatedAt,
    votes,
    thread_url: rawThreadUrl,
    reviewer_username: rawUsername,
    reviewer_display_name: rawDisplayName,
    author: {
      username: rawUsername,
      display_name: rawDisplayName,
      avatar_url: r?.source === 'luantihub' && r?.author?.avatar_url ? r.author.avatar_url : 'logo.svg'
    }
  };
}

/**
 * Fetches recent global ContentDB reviews (`GET /api/reviews/`) with a 15-minute Edge Cache TTL,
 * normalizes each review entry, and filters to reviews posted within `maxAgeMs` (default 48 hours).
 */
export async function fetchRecentContentDbReviewsCached(
  ttlSeconds = 900,
  maxAgeMs = 48 * 3600 * 1000
): Promise<any[]> {
  try {
    const rawPayload = await fetchUpstreamJsonCached<any>('/reviews/', ttlSeconds);
    const rawItems: any[] = Array.isArray(rawPayload)
      ? rawPayload
      : Array.isArray(rawPayload?.items)
        ? rawPayload.items
        : Array.isArray(rawPayload?.reviews)
          ? rawPayload.reviews
          : [];
    if (rawItems.length === 0) return [];

    const nowMs = Date.now();
    const out: any[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const norm = normalizeContentDbReviewItem(rawItems[i], i);
      if (!norm?.package_id || !norm?.id) continue;
      if (maxAgeMs > 0 && norm.created_at) {
        const createdMs = Date.parse(String(norm.created_at));
        if (Number.isFinite(createdMs) && nowMs - createdMs > maxAgeMs) {
          continue;
        }
      }
      out.push(norm);
      if (out.length >= 15) break;
    }
    return out;
  } catch {
    return [];
  }
}

const isolateJsonCache = new Map<string, { exp: number; data: any }>();
const MAX_ISOLATE_CACHE_ENTRIES = 250;
const NATIVE_FETCH_REF = typeof fetch !== 'undefined' ? fetch : null;

function canUseIsolateCache(): boolean {
  if (typeof fetch !== 'undefined' && NATIVE_FETCH_REF && globalThis.fetch !== NATIVE_FETCH_REF) {
    return false;
  }
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
 * Fetches JSON from upstream ContentDB / mirror with Cloudflare Edge Cache API + Isolate Memory Cache support.
 * Optionally negotiates localized package metadata via `Accept-Language` when `options.lang` is provided.
 */
export async function fetchUpstreamJsonCached<T = any>(
  path: string,
  ttlSeconds = 300,
  options?: { lang?: string }
): Promise<T | null> {
  const cleanLang = String(options?.lang || '').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  const langSegment = cleanLang && cleanLang !== 'en' ? `/__lang_${cleanLang}` : '';
  const cacheKeyUrl = `https://cache.luantihub.internal${langSegment}${path}`;
  const memHit = getIsolateCache<T>(cacheKeyUrl);
  if (memHit !== null) {
    return memHit;
  }

  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache && ttlSeconds > 0) {
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

  const fallbackCacheKeyUrl =
    path === '/packages/?fmt=vcs' && (!cleanLang || cleanLang === 'en')
      ? 'https://cache.luantihub.internal/__upstream_fallback_packages_vcs_v1'
      : null;

  try {
    const fetchOpts: RequestInit =
      cleanLang && cleanLang !== 'en'
        ? { headers: { 'Accept-Language': `${cleanLang}, en;q=0.8` } }
        : {};
    const res = await fetchWithFailover(path, fetchOpts);
    if (!res.ok) {
      if (fallbackCacheKeyUrl) {
        return await readEdgeCacheJson<T>(fallbackCacheKeyUrl);
      }
      return null;
    }
    const data = await res.json() as T;

    if (data) {
      setIsolateCache(cacheKeyUrl, data, ttlSeconds);
      if (fallbackCacheKeyUrl) {
        setIsolateCache(fallbackCacheKeyUrl, data, 86400);
      }
      if (edgeCache) {
        try {
          const bodyStr = JSON.stringify(data);
          const cacheRes = new Response(bodyStr, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
            }
          });
          await edgeCache.put(cacheReq, cacheRes);
          if (fallbackCacheKeyUrl) {
            await edgeCache.put(
              new Request(fallbackCacheKeyUrl, { method: 'GET' }),
              new Response(bodyStr, {
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'public, max-age=86400, s-maxage=86400'
                }
              })
            );
          }
        } catch {
          // Ignore cache write errors
        }
      }
    }

    return data;
  } catch {
    if (fallbackCacheKeyUrl) {
      return await readEdgeCacheJson<T>(fallbackCacheKeyUrl);
    }
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
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v3',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v8',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v9',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v10',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v11',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v12',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v13',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v14',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v15',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v16',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v17',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v18',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v19',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v20',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v21',
    'https://cache.luantihub.internal/__api_boot_catalog_bundle_v22',
    'https://cache.luantihub.internal/__api_boot_recently_added_v1',
    'https://cache.luantihub.internal/__recent_reviews_v1',
    'https://cache.luantihub.internal/__d1_recent_reviews_v1'
  ]);
  for (const p of cacheKeyPaths) {
    if (!p) continue;
    expandedUrls.add(buildEdgeCacheRequestUrl(p));
    const pkgDetailMatch = p.match(
      /(?:\/__api_pkg_detail_v\d+\/|\/pkg-detail-v\d+\/)(?:full-readme\/|full\/|lite\/)?([^/]+)\/([^/]+)$/i
    );
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
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v11/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v11/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v11/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v12/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v12/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v12/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v13/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v13/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v13/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v14/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v14/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v14/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v15/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v15/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v15/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v16/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v16/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v16/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v17/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v17/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v17/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v18/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v18/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v18/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v19/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v19/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v19/lite/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full-readme/${a}/${n}`);
      expandedUrls.add(`https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/lite/${a}/${n}`);
      for (const loc of ['en', 'sk', 'de', 'fr', 'es', 'ru']) {
        expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v19/full/${loc}/${a}/${n}`);
        expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v19/full-readme/${loc}/${a}/${n}`);
        expandedUrls.add(`https://edge-cache.luantihub.local/pkg-detail-v19/lite/${loc}/${a}/${n}`);
        expandedUrls.add(`https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full/${loc}/${a}/${n}`);
        expandedUrls.add(`https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full-readme/${loc}/${a}/${n}`);
        expandedUrls.add(`https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/lite/${loc}/${a}/${n}`);
        expandedUrls.add(`https://cache.luantihub.internal/__for_client_v5/${a}/${n}/${loc}/%3Fformspec_version%3D8`);
        expandedUrls.add(`https://cache.luantihub.internal/__for_client_v5/${a}/${n}/${loc}/`);
      }
      expandedUrls.add(`https://cache.luantihub.internal/__pkg_zip_v3/${a}/${n}/latest`);
      expandedUrls.add(`https://cache.luantihub.internal/__pkg_deps_v2/${a}/${n}/hard`);
      expandedUrls.add(`https://cache.luantihub.internal/__pkg_deps_v2/${a}/${n}/all`);
      const zipPrefix = `https://cache.luantihub.internal/__pkg_zip_v3/${a}/${n}/`;
      for (const zk of Array.from(sharedIsolateZipCache.keys())) {
        if (zk.startsWith(zipPrefix)) {
          sharedIsolateZipCache.delete(zk);
        }
      }
    }
  }

  for (const url of expandedUrls) {
    isolateJsonCache.delete(url);
  }
    for (const k of Array.from(isolateJsonCache.keys())) {
      if (
        k.startsWith('https://cache.luantihub.internal/__catalog_edge_v') ||
        k.startsWith('https://cache.luantihub.internal/__api_updates_v') ||
        k.startsWith('https://cache.luantihub.internal/__for_client_v') ||
        k.startsWith('https://cache.luantihub.internal/__pkg_deps_v') ||
        k.startsWith('https://cache.luantihub.internal/__git_zip_size_v') ||
        k.startsWith('https://cache.luantihub.internal/__promo_row_sync_v1_') ||
        k.startsWith('https://cache.luantihub.internal/__unified_tags_v')
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

export const deleteEdgeCacheKeys = invalidateEdgeCacheKeys;

  let lastKnownActivePromotions: any[] | null = null;

  /**
   * Validates whether a promotion row is currently active and has either Hero slide display or Promotional Package Row #1 enabled.
   */
  export function isValidActivePromotionRow(r: any, nowMs = Date.now()): boolean {
    if (!r || !r.expires_at) return false;
    const showInHero = r.show_in_hero !== false && r.show_in_hero !== 0 && r.show_in_hero !== '0';
    const rowEnabled = Boolean(r.row_enabled === true || r.row_enabled === 1 || r.row_enabled === '1');
    if (!showInHero && !rowEnabled) return false;
    if (showInHero && (!r.title || !r.banner_url)) return false;
    if (!showInHero && rowEnabled && !r.title && !r.row_title) return false;
    const expMs = Date.parse(String(r.expires_at));
    if (!Number.isFinite(expMs) || expMs <= nowMs) return false;
    if (r.starts_at) {
      const startMs = Date.parse(String(r.starts_at));
      if (Number.isFinite(startMs) && startMs > nowMs) return false;
    }
    return true;
  }

  /**
   * Returns the last known active Hero Carousel & Promotional Row promotions in this isolate (filtered by current time),
   * or `null` if promotions have not yet been loaded in this isolate.
   */
  export function getLastKnownActivePromotions(nowMs = Date.now()): any[] | null {
    if (!canUseIsolateCache() || !Array.isArray(lastKnownActivePromotions)) return null;
    return lastKnownActivePromotions.filter((r: any) => isValidActivePromotionRow(r, nowMs));
  }

  /**
   * Updates the isolate-level fallback list of active Hero Carousel & Promotional Row promotions.
   */
  export function setLastKnownActivePromotions(rows: any[] | null): void {
    if (!canUseIsolateCache()) return;
    lastKnownActivePromotions = Array.isArray(rows) ? [...rows] : null;
  }

export const DEFAULT_CONTENTDB_TAGS: Array<{ name: string; title: string }> = [
  { name: 'organic_code', title: '100% Organic Code' },
  { name: 'adventure_and_rpg', title: 'Adventure / RPG' },
  { name: 'building', title: 'Building' },
  { name: 'chat', title: 'Chat / Commands' },
  { name: 'combat', title: 'Combat' },
  { name: 'crafting', title: 'Crafting' },
  { name: 'creative', title: 'Creative' },
  { name: 'custom', title: 'Custom' },
  { name: 'decorative', title: 'Decorative' },
  { name: 'education', title: 'Education' },
  { name: 'environment', title: 'Environment' },
  { name: 'gamejam', title: 'Game Jam' },
  { name: 'gui', title: 'GUI' },
  { name: 'hud', title: 'HUD' },
  { name: 'inventory', title: 'Inventory' },
  { name: 'jam_combat_2022', title: 'Combat Jam 2022' },
  { name: 'jam_game_2021', title: 'Game Jam 2021' },
  { name: 'jam_game_2022', title: 'Game Jam 2022' },
  { name: 'jam_game_2023', title: 'Game Jam 2023' },
  { name: 'jam_game_2024', title: 'Game Jam 2024' },
  { name: 'jam_game_2025', title: 'Game Jam 2025' },
  { name: 'jam_game_2026', title: 'Game Jam 2026' },
  { name: 'library', title: 'Library / API' },
  { name: 'magic', title: 'Magic' },
  { name: 'mapgen', title: 'Mapgen' },
  { name: 'minigame', title: 'Minigame' },
  { name: 'mobs', title: 'Mobs / Animals / NPCs' },
  { name: 'multiplayer', title: 'Multiplayer' },
  { name: 'plants_and_farming', title: 'Plants and Farming' },
  { name: 'player_effects', title: 'Player Effects' },
  { name: 'puzzle', title: 'Puzzle' },
  { name: 'pve', title: 'PvE' },
  { name: 'pvp', title: 'PvP' },
  { name: 'sandbox_game', title: 'Sandbox Game' },
  { name: 'singleplayer', title: 'Singleplayer' },
  { name: 'sound_music', title: 'Sound / Music' },
  { name: 'storage', title: 'Storage' },
  { name: 'survival', title: 'Survival' },
  { name: 'technology', title: 'Technology' },
  { name: 'tools', title: 'Tools / Weapons' },
  { name: 'transport', title: 'Transport' },
  { name: 'voxel', title: 'Voxel' },
  { name: 'world_maintenance', title: 'World Maintenance' }
];

export function formatTagTitle(tagName: string): string {
  const clean = String(tagName || '').trim();
  if (!clean) return '';
  const known = DEFAULT_CONTENTDB_TAGS.find(t => t.name.toLowerCase() === clean.toLowerCase());
  if (known) return known.title;
  const jamMatch = clean.match(/^jam_game_(\d{4})$/i);
  if (jamMatch) return `Game Jam ${jamMatch[1]}`;
  return clean
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

import {
  parseJsonArray,
  extractEngineVersionString,
  parseDownloadSizeBytes,
  formatByteSize,
  parseNonZeroReviewThreadCounts,
  deriveReviewThreadCountsFromList,
  computeGenuineStarRating,
  computeStarRatingFromData,
  extractEmbeddedVideo,
  buildReverseDependencyCountMap,
  isApiOrLibraryPackage,
  computeDependencyPrioritizationMultiplier,
  isPrimarilyDependencyPackage,
  LUANTIHUB_ENGINE_VERSIONS,
  LUANTIHUB_DEV_STATES,
  LUANTIHUB_CONTENT_WARNINGS,
  LUANTIHUB_BADGE_TAGS,
  ORGANIC_CODE_TAG,
  ORGANIC_CODE_LABEL,
  ORGANIC_CODE_TOOLTIP,
  parseBadgeTagsArray,
  hasOrganicCodeTag,
  LUANTIHUB_POPULAR_GAMES,
  parseGameSupportArray,
  inferGameSupportFromDependencies,
  mergeLuantiHubAndContentDbGameSupport,
  computeLuantiHubFrecencyMetrics,
  parsePackageTranslations,
  resolveLocalizedPackageText,
  parseScreenshotMetaArray,
  findReverseDependenciesForPackage
} from '../../../src/app/core/config/package-utils.config';
import {
  normalizeRepoComparisonKey,
  normalizeRepoKey
} from '../../../src/app/core/config/git-providers.config';
export {
  parseJsonArray,
  extractEngineVersionString,
  parseDownloadSizeBytes,
  formatByteSize,
  parseNonZeroReviewThreadCounts,
  deriveReviewThreadCountsFromList,
  computeGenuineStarRating,
  computeStarRatingFromData,
  extractEmbeddedVideo,
  buildReverseDependencyCountMap,
  isApiOrLibraryPackage,
  computeDependencyPrioritizationMultiplier,
  isPrimarilyDependencyPackage,
  LUANTIHUB_ENGINE_VERSIONS,
  LUANTIHUB_DEV_STATES,
  LUANTIHUB_CONTENT_WARNINGS,
  LUANTIHUB_BADGE_TAGS,
  ORGANIC_CODE_TAG,
  ORGANIC_CODE_LABEL,
  ORGANIC_CODE_TOOLTIP,
  parseBadgeTagsArray,
  hasOrganicCodeTag,
  LUANTIHUB_POPULAR_GAMES,
  parseGameSupportArray,
  inferGameSupportFromDependencies,
  mergeLuantiHubAndContentDbGameSupport,
  computeLuantiHubFrecencyMetrics,
  parsePackageTranslations,
  resolveLocalizedPackageText,
  parseScreenshotMetaArray,
  findReverseDependenciesForPackage,
  normalizeRepoComparisonKey,
  normalizeRepoKey
};

export interface SharedEdgeRatingEntry {
  score: number;
  review_thread_counts?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  checked?: boolean;
}

const SHARED_EDGE_RATINGS_CACHE_KEY = '/__pkg_ratings_map_v2';

/**
 * Reads the shared Edge Cache map of hydrated package star ratings & review thread counts (`/__pkg_ratings_map_v2`).
 * Enables upstream ContentDB packages (which may not have a full row in D1 `packages`) to retain their
 * hydrated star ratings across catalog boots with zero D1 row reads.
 */
export async function readSharedEdgeRatingsMap(): Promise<Record<string, SharedEdgeRatingEntry>> {
  const cached = await readEdgeCacheJson<Record<string, SharedEdgeRatingEntry>>(SHARED_EDGE_RATINGS_CACHE_KEY);
  return cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : {};
}

/**
 * Merges newly hydrated package star ratings and review thread counts into `/__pkg_ratings_map_v2`
 * in Isolate Memory + Cloudflare Edge Cache (24h TTL).
 */
export async function mergeSharedEdgeRatingsMap(
  updates: Record<string, SharedEdgeRatingEntry>
): Promise<void> {
  if (!updates || Object.keys(updates).length === 0) return;
  const current = await readSharedEdgeRatingsMap();
  let changed = false;
  for (const [rawKey, entry] of Object.entries(updates)) {
    const k = String(rawKey || '').trim().toLowerCase();
    if (!k || !entry) continue;
    const validCounts = parseNonZeroReviewThreadCounts(entry.review_thread_counts);
    const validScore = typeof entry.score === 'number' && entry.score >= 1 && entry.score <= 5 ? entry.score : 0;
    const isChecked = Boolean(entry.checked || validScore > 0 || validCounts);
    if (validScore <= 0 && !validCounts && !isChecked) continue;
    const prev = current[k];
    const isExplicitZeroReset = Boolean(entry.checked && validScore === 0 && !validCounts);
    const nextScore = isExplicitZeroReset
      ? 0
      : (validScore > 0 ? validScore : (prev?.score || 0));
    const nextCounts = isExplicitZeroReset
      ? undefined
      : (validCounts || prev?.review_thread_counts);
    const nextChecked = isChecked || Boolean(prev?.checked);
    if (
      !prev ||
      prev.score !== nextScore ||
      prev.checked !== nextChecked ||
      JSON.stringify(prev.review_thread_counts) !== JSON.stringify(nextCounts)
    ) {
      current[k] = {
        score: nextScore,
        ...(nextCounts ? { review_thread_counts: nextCounts } : {}),
        ...(nextChecked ? { checked: true } : {})
      };
      changed = true;
    }
  }
  if (changed) {
    await writeEdgeCacheJson(SHARED_EDGE_RATINGS_CACHE_KEY, current, 86400);
  }
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
 * exist on `packages` in Cloudflare D1.
 *
 * Production D1 already has all columns, tables, and indexes migrated. To avoid running
 * 15 `PRAGMA` / `CREATE ... IF NOT EXISTS` read queries on every cold Worker isolate start,
 * this helper is a zero-query no-op unless `force === true` (used only when recovering from
 * a missing-column/table error during a write mutation).
 */
export async function ensureExtendedPackageColumns(db: any, force = false): Promise<void> {
  if (!db || !force || extendedColumnsEnsured) return;
  const requiredCols: Array<[string, string]> = [
    ['tags', 'TEXT'],
    ['badge_tags', 'TEXT'],
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
    ['maintainers', 'TEXT'],
    ['latest_commit_sha', 'TEXT'],
    ['screenshots', 'TEXT'],
    ['screenshot_meta', 'TEXT'],
    ['supports_all_games', 'INTEGER DEFAULT 0'],
    ['game_support', 'TEXT'],
    ['translations', 'TEXT'],
    ['review_thread_counts', 'TEXT']
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

    // Ensure hero_promotions, tags, and promo_tag_packages tables & columns exist
    await ensurePromotionAndTagTables(db, true);

    // Ensure user_views table exists for cross-device view & conversion personalization
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS user_views (
        user_id TEXT NOT NULL,
        package_id TEXT NOT NULL,
        view_count INTEGER NOT NULL DEFAULT 1,
        last_viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, package_id)
      )
    `).run().catch(() => {});

    // Ensure expression indexes on LOWER(...) exist so case-insensitive lookups & joins use B-tree indexes instead of full table scans
    const indexStatements = [
      `CREATE INDEX IF NOT EXISTS idx_packages_lower_id ON packages(LOWER(id))`,
      `CREATE INDEX IF NOT EXISTS idx_packages_lower_author_name ON packages(LOWER(author_name), LOWER(name))`,
      `CREATE INDEX IF NOT EXISTS idx_packages_status_updated ON packages(status, updated_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_packages_status_dl ON packages(status, downloads_count DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_reviews_lower_pkg ON reviews(LOWER(package_id))`,
      `CREATE INDEX IF NOT EXISTS idx_releases_lower_pkg ON releases(LOWER(package_id))`,
      `CREATE INDEX IF NOT EXISTS idx_daily_dl_lower_pkg_date ON package_daily_downloads(LOWER(package_id), download_date)`,
      `CREATE INDEX IF NOT EXISTS idx_favorites_lower_pkg ON user_favorites(LOWER(package_id))`,
      `CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users(LOWER(username))`,
      `CREATE INDEX IF NOT EXISTS idx_identities_lower_prov_user ON user_identities(LOWER(provider_username))`
    ];
    if (typeof db.batch === 'function') {
      await db.batch(indexStatements.map(s => db.prepare(s))).catch(() => {});
    } else {
      for (const stmt of indexStatements) {
        await db.prepare(stmt).run().catch(() => {});
      }
    }

    if (existing.size > 0) {
      extendedColumnsEnsured = true;
    }
  } catch {
    // Ignore schema inspection errors; will retry on next forced request
  }
}

let promotionAndTagTablesEnsured = false;

/**
 * Ensures `hero_promotions`, `tags`, and `promo_tag_packages` tables and all Promotional Package Row
 * & multi-language columns exist in D1.
 *
 * Production D1 already has these tables and columns migrated. To avoid running 5 DDL/PRAGMA queries
 * on every cold Worker isolate, this helper is a zero-query no-op unless `force === true` (invoked
 * automatically when recovering from a missing-table/column error).
 */
export async function ensurePromotionAndTagTables(db: any, force = false): Promise<void> {
  if (!db || !force || promotionAndTagTablesEnsured) return;
  try {
    await db.prepare(`
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
      )
    `).run().catch(() => {});

    const promoCols: Array<[string, string]> = [
      ['show_in_hero', 'INTEGER NOT NULL DEFAULT 1'],
      ['row_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['row_title', 'TEXT'],
      ['row_subtitle', 'TEXT'],
      ['row_icon', "TEXT DEFAULT 'trophy'"],
      ['row_filter_tags', 'TEXT'],
      ['row_filter_type', "TEXT DEFAULT 'all'"],
      ['row_filter_source', "TEXT DEFAULT 'all'"],
      ['row_filter_author', 'TEXT'],
      ['row_filter_query', 'TEXT'],
      ['row_pinned_packages', 'TEXT'],
      ['row_sort_by', "TEXT DEFAULT 'newest'"],
      ['row_show_empty_cta', 'INTEGER NOT NULL DEFAULT 1'],
      ['translations', 'TEXT']
    ];
    const promoInfo = await db.prepare(`PRAGMA table_info(hero_promotions)`).all().catch(() => ({ results: [] }));
    const existingPromo = new Set<string>(
      (promoInfo?.results || []).map((r: any) => String(r?.name || '').toLowerCase())
    );
    for (const [colName, colDef] of promoCols) {
      if (!existingPromo.has(colName)) {
        await db.prepare(`ALTER TABLE hero_promotions ADD COLUMN ${colName} ${colDef}`).run().catch(() => {});
      }
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT DEFAULT 'contentdb',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run().catch(() => {});

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS promo_tag_packages (
        tag_name TEXT NOT NULL,
        package_id TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tag_name, package_id)
      )
    `).run().catch(() => {});

    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_promo_tag_pkgs_tag ON promo_tag_packages(LOWER(tag_name))`).run().catch(() => {});

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS package_metadata_options (
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        extra_json TEXT,
        source TEXT DEFAULT 'luantihub',
        sort_order INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (category, name)
      )
    `).run().catch(() => {});

    await seedDefaultMetadataOptionsInD1(db).catch(() => {});

    promotionAndTagTablesEnsured = true;
  } catch {
    // Non-fatal schema initialization
  }
}

/**
 * Seeds canonical LuantiHub metadata options (`badge_tags`, `dev_states`, `content_warnings`,
 * `engine_versions`, `popular_games`) into D1 `package_metadata_options` so all metadata choices
 * are tracked in D1 without depending on 3rd-party APIs.
 */
export async function seedDefaultMetadataOptionsInD1(db: any): Promise<void> {
  if (!db) return;
  const stmts: any[] = [];
  const pushOption = (
    category: string,
    name: string,
    title: string,
    description: string | null,
    icon: string | null,
    extraJson: string | null,
    sortOrder: number
  ) => {
    stmts.push(
      db.prepare(`
        INSERT INTO package_metadata_options (category, name, title, description, icon, extra_json, source, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'luantihub', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(category, name) DO UPDATE SET
          title = excluded.title,
          description = COALESCE(excluded.description, package_metadata_options.description),
          icon = COALESCE(excluded.icon, package_metadata_options.icon),
          extra_json = COALESCE(excluded.extra_json, package_metadata_options.extra_json),
          sort_order = excluded.sort_order,
          updated_at = CURRENT_TIMESTAMP
      `).bind(category, name, title, description, icon, extraJson, sortOrder)
    );
  };

  LUANTIHUB_BADGE_TAGS.forEach((b, idx) => {
    pushOption('badge_tags', b.name, b.title, b.tooltip, b.icon, null, idx);
    stmts.push(
      db.prepare(`
        INSERT INTO tags (name, title, source, updated_at)
        VALUES (?, ?, 'luantihub', CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
          title = excluded.title,
          source = 'luantihub',
          updated_at = CURRENT_TIMESTAMP
      `).bind(b.name, b.title)
    );
  });
  LUANTIHUB_DEV_STATES.forEach((d, idx) => {
    pushOption('dev_states', d.code, d.label, null, null, null, idx);
  });
  LUANTIHUB_CONTENT_WARNINGS.forEach((w, idx) => {
    pushOption('content_warnings', w.name, w.title, w.description, null, null, idx);
  });
  LUANTIHUB_ENGINE_VERSIONS.forEach((v, idx) => {
    pushOption(
      'engine_versions',
      v.name,
      v.label,
      null,
      null,
      JSON.stringify({ protocol_version: v.protocol_version, is_dev: Boolean(v.is_dev) }),
      idx
    );
  });
  LUANTIHUB_POPULAR_GAMES.forEach((g, idx) => {
    pushOption(
      'popular_games',
      g.name,
      g.title,
      null,
      null,
      JSON.stringify({ id: g.id, author: g.author, aliases: g.aliases }),
      idx
    );
  });

  if (stmts.length === 0) return;
  if (typeof db.batch === 'function') {
    await db.batch(stmts).catch(() => {});
  } else {
    for (const s of stmts) {
      await s.run().catch(() => {});
    }
  }
}

/**
 * Upserts metadata options into D1 `package_metadata_options` so any custom or newly discovered
 * options (badge tags, content warnings, engine versions, etc.) are persisted in our own DB.
 */
export async function upsertMetadataOptions(
  db: any,
  category: 'badge_tags' | 'dev_states' | 'content_warnings' | 'engine_versions' | 'popular_games',
  items: Array<{
    name: string;
    title: string;
    description?: string;
    icon?: string;
    extra_json?: string;
    sort_order?: number;
  }>,
  source: 'luantihub' | 'contentdb' | 'custom' = 'luantihub'
): Promise<void> {
  if (!db || !Array.isArray(items) || items.length === 0) return;
  const runBatch = async () => {
    const stmts = items
      .filter((i) => i && String(i.name || '').trim())
      .map((item, idx) =>
        db.prepare(`
          INSERT INTO package_metadata_options (category, name, title, description, icon, extra_json, source, sort_order, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(category, name) DO UPDATE SET
            title = CASE WHEN package_metadata_options.source = 'luantihub' AND excluded.source = 'contentdb' THEN package_metadata_options.title ELSE excluded.title END,
            description = COALESCE(excluded.description, package_metadata_options.description),
            icon = COALESCE(excluded.icon, package_metadata_options.icon),
            extra_json = COALESCE(excluded.extra_json, package_metadata_options.extra_json),
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          category,
          String(item.name).trim(),
          String(item.title || item.name).trim(),
          item.description ?? null,
          item.icon ?? null,
          item.extra_json ?? null,
          source,
          item.sort_order ?? idx
        )
      );
    if (stmts.length === 0) return;
    if (typeof db.batch === 'function') {
      await db.batch(stmts);
    } else {
      for (const s of stmts) {
        await s.run();
      }
    }
  };

  try {
    try {
      await runBatch();
    } catch (err: any) {
      if (/no such table|no such column|has no column/i.test(String(err?.message || ''))) {
        await ensurePromotionAndTagTables(db, true);
        await runBatch();
      }
    }
    if (category === 'badge_tags') {
      await invalidateEdgeCacheKeys(['/__unified_tags_v1', '/__unified_tags_v2']);
    }
  } catch {
    // Non-blocking option persistence
  }
}

export function resolveBadgeTagItemsForCatalog(
  badgeTagNames: string[]
): Array<{ name: string; title: string }> {
  const knownByLower = new Map(
    LUANTIHUB_BADGE_TAGS.map((b) => [b.name.toLowerCase(), b.title])
  );
  return (Array.isArray(badgeTagNames) ? badgeTagNames : [])
    .map((raw) => String(raw || '').trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      title: knownByLower.get(name.toLowerCase()) || formatTagTitle(name)
    }));
}

/**
 * Registers custom or synced tags in D1 `tags` table so LuantiHub remains ContentDB-agnostic.
 */
export async function upsertCustomAppTags(
  db: any,
  tagItems: Array<string | { name: string; title?: string }>,
  source: 'contentdb' | 'luantihub' | 'custom' = 'custom'
): Promise<void> {
  if (!db || !Array.isArray(tagItems) || tagItems.length === 0) return;
  const systemTags = new Set(['git', 'github', 'codeberg', 'mesehub', 'gitlab', 'bitbucket', 'contentdb', 'mod', 'game', 'txp', 'modpack']);
  const knownBadgeTitles = new Map(
    LUANTIHUB_BADGE_TAGS.map((b) => [b.name.toLowerCase(), b.title])
  );
  const entries: Array<{ name: string; title: string }> = [];
  const seen = new Set<string>();

  for (const item of tagItems) {
    const rawName = typeof item === 'string' ? item : item?.name;
    const cleanName = String(rawName || '').trim();
    if (!cleanName) continue;
    const lower = cleanName.toLowerCase();
    if (systemTags.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    const title =
      (typeof item === 'object' && item?.title ? String(item.title).trim() : '') ||
      knownBadgeTitles.get(lower) ||
      formatTagTitle(cleanName);
    if (title) {
      entries.push({ name: cleanName, title });
    }
  }

  if (entries.length === 0) return;

  const runBatch = async () => {
    const stmts = entries.map((e) =>
      db.prepare(`
        INSERT INTO tags (name, title, source, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
          title = CASE WHEN tags.source IN ('custom', 'luantihub') AND excluded.source = 'contentdb' THEN tags.title ELSE excluded.title END,
          updated_at = CURRENT_TIMESTAMP
      `).bind(e.name, e.title, source)
    );
    if (typeof db.batch === 'function') {
      await db.batch(stmts);
    } else {
      for (const s of stmts) {
        await s.run();
      }
    }
  };

  try {
    try {
      await runBatch();
    } catch (err: any) {
      if (/no such table|no such column|has no column/i.test(String(err?.message || ''))) {
        await ensurePromotionAndTagTables(db, true);
        await runBatch();
      } else {
        throw err;
      }
    }
    await invalidateEdgeCacheKeys(['/__unified_tags_v1', '/__unified_tags_v2']);
  } catch {
    // Non-blocking tag persistence
  }
}

/**
 * Merges ContentDB `/api/tags/`, D1 `tags` mirror, `LUANTIHUB_BADGE_TAGS`, D1 `package_metadata_options`,
 * active D1 `packages` metadata tags, and `DEFAULT_CONTENTDB_TAGS` into a single ContentDB-agnostic tag list.
 * Caches the unified tag list in Edge Cache (`/__unified_tags_v2`) and mirrors newly discovered tags into D1.
 */
export async function getUnifiedCatalogTags(
  db?: any,
  upstreamTagsInput?: any[] | null
): Promise<Array<{ name: string; title: string }>> {
  const cacheKey = '/__unified_tags_v2';
  const cached = await readEdgeCacheJson<Array<{ name: string; title: string }>>(cacheKey);
  if (Array.isArray(cached) && cached.length > 0 && upstreamTagsInput === undefined) {
    return cached;
  }

  const tagMap = new Map<string, { name: string; title: string }>();
  const knownBadgeTitles = new Map(
    LUANTIHUB_BADGE_TAGS.map((b) => [b.name.toLowerCase(), b.title])
  );
  const addTag = (nameRaw: string, titleRaw?: string) => {
    const name = String(nameRaw || '').trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (['git', 'github', 'codeberg', 'mesehub', 'gitlab', 'bitbucket', 'contentdb', 'mod', 'game', 'txp', 'modpack'].includes(lower)) {
      return;
    }
    const title = String(titleRaw || '').trim() || knownBadgeTitles.get(lower) || formatTagTitle(name);
    if (!tagMap.has(lower)) {
      tagMap.set(lower, { name, title });
    } else if (titleRaw && String(titleRaw).trim()) {
      tagMap.set(lower, { name, title: String(titleRaw).trim() });
    }
  };

  for (const badgeTag of LUANTIHUB_BADGE_TAGS) {
    addTag(badgeTag.name, badgeTag.title);
  }

  for (const defTag of DEFAULT_CONTENTDB_TAGS) {
    addTag(defTag.name, defTag.title);
  }

  const existingD1Tags = new Map<string, string>();
  if (Array.isArray(cached) && cached.length > 0) {
    for (const c of cached) {
      if (c?.name) addTag(c.name, c.title);
    }
  } else if (db) {
    try {
      const [d1TagsRes, d1BadgeOptsRes, d1PkgTagsRes] = await Promise.all([
        db.prepare(`SELECT name, title FROM tags ORDER BY name ASC LIMIT 300`).all().catch(() => null),
        db
          .prepare(
            `SELECT name, title FROM package_metadata_options WHERE category = 'badge_tags' ORDER BY sort_order ASC LIMIT 100`
          )
          .all()
          .catch(() => null),
        db
          .prepare(
            `SELECT tags, badge_tags FROM packages WHERE status = 'active' AND ((tags IS NOT NULL AND tags != '' AND tags != '[]') OR (badge_tags IS NOT NULL AND badge_tags != '' AND badge_tags != '[]')) LIMIT 500`
          )
          .all()
          .catch(() => null)
      ]);

      if (Array.isArray(d1BadgeOptsRes?.results)) {
        for (const r of d1BadgeOptsRes.results) {
          if (r?.name) {
            addTag(String(r.name), r.title ? String(r.title) : undefined);
          }
        }
      }

      if (Array.isArray(d1TagsRes?.results)) {
        for (const r of d1TagsRes.results) {
          if (r?.name) {
            const nameStr = String(r.name);
            const titleStr = r.title ? String(r.title) : '';
            existingD1Tags.set(nameStr.toLowerCase(), titleStr);
            addTag(nameStr, titleStr || undefined);
          }
        }
      }

      if (Array.isArray(d1PkgTagsRes?.results)) {
        for (const row of d1PkgTagsRes.results) {
          for (const t of parseJsonArray(row?.tags)) {
            addTag(t);
          }
          for (const bt of parseBadgeTagsArray(row?.badge_tags)) {
            addTag(bt, knownBadgeTitles.get(bt.toLowerCase()));
          }
        }
      }
    } catch {
      // Table may not exist on cold read before migration; ignore
    }
  }

  const upstreamTags =
    upstreamTagsInput !== undefined
      ? upstreamTagsInput
      : await fetchUpstreamJsonCached<any[]>('/tags/', 3600).catch(() => null);

  if (Array.isArray(upstreamTags) && upstreamTags.length > 0) {
    const normalizedUpstream: Array<{ name: string; title: string }> = [];
    for (const t of upstreamTags) {
      const n = String(t?.name || t?.id || '').trim();
      const ti = String(t?.title || t?.name || '').trim();
      if (n && ti) {
        addTag(n, ti);
        normalizedUpstream.push({ name: n, title: ti });
      }
    }

    if (db && normalizedUpstream.length > 0) {
      const mirrorGateKey = 'https://edge-cache.luantihub.local/d1-tags-synced-v1';
      const alreadyMirrored = await readEdgeCacheJson<boolean>(mirrorGateKey).catch(() => false);
      if (!alreadyMirrored) {
        await writeEdgeCacheJson(mirrorGateKey, true, 43200).catch(() => {});
        const deltaToUpsert = normalizedUpstream.filter(
          (t) => existingD1Tags.get(t.name.toLowerCase()) !== t.title
        );
        if (deltaToUpsert.length > 0) {
          await upsertCustomAppTags(db, deltaToUpsert, 'contentdb').catch(() => {});
        }
      }
    }
  }

  const sortedResult = Array.from(tagMap.values()).sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  );
  await writeEdgeCacheJson(cacheKey, sortedResult, 3600);
  return sortedResult;
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
    /\b(D1_[A-Z_]*|SQLITE_[A-Z_]*|SQLITE\b|no such table|no such column|has no column named|table [a-z0-9_]+ has no|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed|SYNTAX_ERROR|near ".+": syntax error|PRAGMA\b|ALTER TABLE\b|INSERT INTO\b|UPDATE [a-z0-9_]+ SET|DELETE FROM\b|SELECT .+ FROM|TypeError:|ReferenceError:|SyntaxError:|RangeError:|Cannot read propert(y|ies) of|Workers? runtime|cloudflare-internal|invalid token payload|token exchange failed|user profile fetch failed|whoami fetch failed|anti-bot challenge|anubis_challenge|Invalid OAuth CSRF state|bad_verification_code|invalid_grant|invalid_client|redirect_uri_mismatch|Unexpected token|JSON\.parse|Failed to fetch|NetworkError|Load failed|AbortError|HTTP [45]\d\d)\b/i;

  const lower = raw.toLowerCase();
  if (
    sensitivePattern.test(raw) ||
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html') ||
    /\bat\s+[a-zA-Z0-9_.$]+\s*\(/.test(raw)
  ) {
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

export function parseGitRepoTarget(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string
): { provider: 'github' | 'codeberg' | 'gitlab' | 'bitbucket'; host: string; owner: string; repo: string } | null {
  if (repoUrl && typeof repoUrl === 'string' && repoUrl.trim()) {
    try {
      const u = new URL(repoUrl.trim());
      let host = u.hostname.toLowerCase();
      // Normalize defunct NotABug URLs to Codeberg
      if (host.includes('notabug.org')) {
        host = 'codeberg.org';
      }
      // Strip deep web UI suffixes (`/-/tree/...`, `/tree/...`, `/src/branch/...`, `/plain/...`, `/log/...`, `/releases`, `/commits`, `/downloads`)
      const cleanedPath = u.pathname
        .replace(/\/-\/(?:tree|blob|commits|releases|tags|archive)(?:\/.*)?$/i, '')
        .replace(/\/(?:tree|blob|src|plain|log|commits|releases|tags|archive|downloads)(?:\/.*)?$/i, '')
        .replace(/^\/+|\/+$/g, '');
      const parts = cleanedPath.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const isGitlabHost =
          host.includes('gitlab') || host === 'framagit.org' || host === 'salsa.debian.org';
        const isBitbucketHost =
          host === 'bitbucket.org' || host.endsWith('.bitbucket.org');
        const isSubpathCustomGit =
          !isGitlabHost && !isBitbucketHost && parts.length > 2 && parts[0].toLowerCase() === 'git';
        const owner = isGitlabHost && parts.length > 2
          ? parts.slice(0, -1).join('/')
          : isSubpathCustomGit
            ? parts.slice(0, -1).join('/')
            : parts[0];
        const repo = (
          (isGitlabHost || isSubpathCustomGit) && parts.length > 2
            ? parts[parts.length - 1]
            : parts[1]
        ).replace(/\.git$/i, '');
        if (owner && repo) {
          let provider: 'github' | 'codeberg' | 'gitlab' | 'bitbucket' = 'codeberg';
          if (host === 'github.com' || host.endsWith('.github.com')) {
            provider = 'github';
          } else if (isGitlabHost) {
            provider = 'gitlab';
          } else if (isBitbucketHost) {
            provider = 'bitbucket';
          } else {
            // Codeberg, Mesehub (git.minetest.land), Gitea, Forgejo, and self-hosted Gitea/Forgejo instances
            provider = 'codeberg';
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
  if (host.includes('bitbucket.org')) {
    return `https://bitbucket.org/${owner}/${repo}/get/${isHead ? 'HEAD' : safeBranch}.zip`;
  }
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
  provider: 'github' | 'codeberg' | 'gitlab' | 'bitbucket' | 'mesehub' | string,
  host: string,
  owner: string,
  repo: string,
  tagName: string
): string {
  const encTag = encodeURIComponent(tagName);
  const lowerHost = (host || '').toLowerCase();
  if (provider === 'bitbucket' || lowerHost.includes('bitbucket.org')) {
    return `https://bitbucket.org/${owner}/${repo}/get/${encTag}.zip`;
  }
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

  try {
    const cache = (globalThis as any).caches?.default;
    if (cache) {
      const isUnversionedLatestKey = cacheKey.endsWith('/latest');
      const isUpdateReq = Boolean(request?.url && /[?&]reason=update\b/i.test(request.url));
      const cachedZip =
        (await cache.match(new Request(cacheKey, { method: 'GET' }))) ||
        (request && isUnversionedLatestKey && !isUpdateReq ? await cache.match(request) : null);
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
  if (normalizedZip.byteLength > 0 && normalizedZip.byteLength <= MAX_SHARED_ISOLATE_ZIP_ITEM_BYTES) {
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

export function sanitizeReleaseNotesText(
  rawNotes?: string | null,
  versionOrTag?: string | null
): string | undefined {
  if (typeof rawNotes !== 'string') return undefined;
  const trimmed = rawNotes.trim();
  if (!trimmed) return undefined;
  if (/^Git Tag \/ Release\s*\([^)]*\)$/i.test(trimmed)) return undefined;
  if (/^Direct source archive from\s+.+$/i.test(trimmed)) return undefined;
  const ver = typeof versionOrTag === 'string' ? versionOrTag.trim() : '';
  if (ver && (trimmed.toLowerCase() === ver.toLowerCase() || trimmed.toLowerCase() === `v${ver.toLowerCase()}`)) {
    return undefined;
  }
  return trimmed;
}

export function abbreviateGitRefLabel(ref?: string | null): string {
  const clean = typeof ref === 'string' ? ref.trim() : '';
  if (!clean) return '';
  if (/^[0-9a-f]{12,40}$/i.test(clean)) {
    return clean.slice(0, 7);
  }
  return clean;
}

export interface GitSmartHttpRefs {
  defaultBranch: string;
  headSha: string;
  branches: Record<string, string>;
  tags: Array<{ tagName: string; commitSha: string }>;
}

/**
 * Pure parser for the universal Git Smart HTTP wire protocol (`GET <repo>.git/info/refs?service=git-upload-pack`).
 * Extracts `HEAD` symref (`defaultBranch`), `headSha`, branch SHAs (`refs/heads/*`), and tag SHAs (`refs/tags/*`),
 * resolving annotated tag peel lines (`refs/tags/<name>^{}`) to their underlying commit SHA.
 */
export function parseGitSmartHttpRefs(rawText: string): GitSmartHttpRefs {
  let defaultBranch = '';
  let headSha = '';
  const branches: Record<string, string> = {};
  const tagMap = new Map<string, string>();

  if (!rawText || typeof rawText !== 'string') {
    return { defaultBranch: 'main', headSha: '', branches, tags: [] };
  }

  const symrefMatch = rawText.match(/symref=HEAD:refs\/heads\/([^\s\0\r\n]+)/);
  if (symrefMatch?.[1]) {
    defaultBranch = symrefMatch[1].trim();
  }

  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    // Strip optional flush packets (`0000`) and single 4-hex pkt-line length prefix (e.g. `003f`, `000000f8`)
    let line = rawLine.replace(/^(?:0000)+/, '');
    if (/^[0-9a-f]{4}(?:[0-9a-f]{40}\s|#)/i.test(line)) {
      line = line.slice(4);
    }
    if (!line || line.startsWith('#')) continue;

    // Strip capabilities after NUL byte (`\0`) on the first ref line
    const nulIdx = line.indexOf('\0');
    const refPart = (nulIdx >= 0 ? line.slice(0, nulIdx) : line).trim();
    const m = refPart.match(/^([0-9a-f]{40})\s+(\S+)$/i);
    if (!m) continue;

    const sha = m[1].toLowerCase();
    const refName = m[2];
    if (refName === 'HEAD') {
      headSha = sha;
    } else if (refName.startsWith('refs/heads/')) {
      const bName = refName.slice('refs/heads/'.length);
      if (bName) {
        branches[bName] = sha;
      }
    } else if (refName.startsWith('refs/tags/')) {
      const rawTag = refName.slice('refs/tags/'.length);
      if (rawTag.endsWith('^{}')) {
        const cleanTag = rawTag.slice(0, -3);
        if (cleanTag) {
          // Peeled annotated tag commit SHA always takes precedence over the tag object SHA
          tagMap.set(cleanTag, sha);
        }
      } else if (rawTag && !tagMap.has(rawTag)) {
        tagMap.set(rawTag, sha);
      }
    }
  }

  if (!defaultBranch) {
    if (headSha) {
      const matchingBranch = Object.entries(branches).find(([, bSha]) => bSha === headSha)?.[0];
      defaultBranch = matchingBranch || (branches['main'] ? 'main' : branches['master'] ? 'master' : 'main');
    } else {
      defaultBranch = branches['main'] ? 'main' : branches['master'] ? 'master' : (Object.keys(branches)[0] || 'main');
    }
  }
  if (!headSha && defaultBranch && branches[defaultBranch]) {
    headSha = branches[defaultBranch];
  }

  const tags = Array.from(tagMap.entries())
    .map(([tagName, commitSha]) => ({ tagName, commitSha }))
    .sort(
      (a, b) =>
        compareSemanticVersionsDesc(a.tagName, b.tagName) ||
        b.tagName.localeCompare(a.tagName, undefined, { numeric: true, sensitivity: 'base' })
    );

  return { defaultBranch, headSha, branches, tags };
}

/**
 * Queries the universal Git Smart HTTP endpoint (`GET <repo>.git/info/refs?service=git-upload-pack`)
 * supported by all Git servers (GitHub, Codeberg, Mesehub, GitLab, Bitbucket, Gitea, Forgejo, cgit)
 * with a 2-minute Edge Cache (or bypassed via `forceRefresh`).
 * Costs 1 lightweight (~2 KB) request and 0 REST API rate-limit quota.
 */
export async function fetchGitSmartHttpRefs(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string,
  forceRefresh = false
): Promise<GitSmartHttpRefs | null> {
  const target = parseGitRepoTarget(repoUrl, fallbackOwner, fallbackRepo);
  if (!target) return null;

  const { host, owner, repo } = target;
  const encOwnerPath = owner.split('/').map(encodeURIComponent).join('/');
  const cacheKey = `/__git_smart_refs_v1/${host}/${encOwnerPath}/${encodeURIComponent(repo.toLowerCase())}`;
  if (!forceRefresh) {
    const cached = await readEdgeCacheJson<GitSmartHttpRefs>(cacheKey);
    if (cached && (cached.headSha || cached.tags.length > 0)) {
      return cached;
    }
  }

  const smartUrls = [
    `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}.git/info/refs?service=git-upload-pack`,
    `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/info/refs?service=git-upload-pack`
  ];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3200);
  try {
    for (const smartUrl of smartUrls) {
      const res = await fetchWithAnubisSupport(smartUrl, {
        headers: {
          'User-Agent': 'git/2.43.0 LuantiHub/1.0 (+https://luantihub.org)',
          'Accept': 'application/x-git-upload-pack-advertisement, */*'
        },
        signal: ctrl.signal
      });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = parseGitSmartHttpRefs(text);
      if (parsed.headSha || parsed.tags.length > 0) {
        clearTimeout(timer);
        await writeEdgeCacheJson(cacheKey, parsed, 120);
        return parsed;
      }
    }
    clearTimeout(timer);
  } catch {
    clearTimeout(timer);
  }
  return null;
}

/**
 * Synchronizes a Git package's latest version fingerprint (`latestTag || headSha`) into D1
 * with a 6-hour trailing-edge debounce window for branch-only commit updates so rapid multi-commit
 * pushes coalesce into a single update notification.
 */
export async function syncDebouncedGitVersionStamp(
  db: any,
  d1Pkg: any,
  latestFingerprint?: string | null,
  isTaggedRelease = false,
  observedReleaseDateIso?: string | null
): Promise<boolean> {
  if (!db || !d1Pkg?.id || !latestFingerprint) return false;
  const cleanNext = String(latestFingerprint).trim();
  if (!cleanNext || cleanNext === 'HEAD' || cleanNext === 'latest') return false;

  await ensureExtendedPackageColumns(db);

  const prev = String(d1Pkg.latest_commit_sha || '').trim();
  if (!prev) {
    // Initial seed: record fingerprint without bumping updated_at to avoid false-positive notifications
    try {
      await db.prepare(`UPDATE packages SET latest_commit_sha = ? WHERE id = ?`).bind(cleanNext, d1Pkg.id).run();
      d1Pkg.latest_commit_sha = cleanNext;
    } catch {
      // Non-fatal
    }
    return false;
  }

  if (prev === cleanNext) return false;

  // Guard against representation switches (e.g. a 7-40 char hex commit SHA vs a non-hex tag label)
  // so switching between a tag name and its underlying commit SHA does not falsely bump updated_at.
  const isHexSha = (s: string) => /^[0-9a-f]{7,40}$/i.test(s);
  const prevIsHex = isHexSha(prev);
  const nextIsHex = isHexSha(cleanNext);
  if (prevIsHex !== nextIsHex) {
    if (nextIsHex) {
      // Normalize stored fingerprint to the concrete hex SHA without bumping updated_at
      try {
        await db.prepare(`UPDATE packages SET latest_commit_sha = ? WHERE id = ?`).bind(cleanNext, d1Pkg.id).run();
        d1Pkg.latest_commit_sha = cleanNext;
      } catch {
        // Non-fatal
      }
    }
    return false;
  }

  const prevUpdatedMs = Date.parse(String(d1Pkg.updated_at || '')) || 0;
  const obsMs = observedReleaseDateIso ? (Date.parse(String(observedReleaseDateIso)) || 0) : 0;

  // If the observed release/tag timestamp is not newer than the package's existing updated_at,
  // record the normalized commit SHA in D1 without bumping updated_at to Date.now().
  if (obsMs > 0 && prevUpdatedMs > 0 && obsMs <= prevUpdatedMs) {
    try {
      await db.prepare(`UPDATE packages SET latest_commit_sha = ? WHERE id = ?`).bind(cleanNext, d1Pkg.id).run();
      d1Pkg.latest_commit_sha = cleanNext;
    } catch {
      // Non-fatal
    }
    return false;
  }

  // For branch-only commit updates (non-tag), enforce a 6-hour server debounce window
  if (!isTaggedRelease) {
    const DEBOUNCE_WINDOW_MS = 6 * 3600 * 1000;
    if (prevUpdatedMs > 0 && Date.now() - prevUpdatedMs < DEBOUNCE_WINDOW_MS) {
      // Hold `latest_commit_sha` at `prev` until the 6h window elapses so trailing-edge coalescing triggers cleanly
      return false;
    }
  }

  try {
    const nextUpdatedIso = obsMs > 0 ? new Date(obsMs).toISOString() : new Date().toISOString();
    await db
      .prepare(`UPDATE packages SET latest_commit_sha = ?, updated_at = ? WHERE id = ?`)
      .bind(cleanNext, nextUpdatedIso, d1Pkg.id)
      .run();
    d1Pkg.latest_commit_sha = cleanNext;
    d1Pkg.updated_at = nextUpdatedIso;
    return true;
  } catch {
    return false;
  }
}

/**
 * Discovers both formal Releases and Git Tags across all Git services (GitHub, Codeberg, Mesehub,
 * Gitea/Forgejo, GitLab, and Bitbucket) using the universal Git Smart HTTP wire protocol
 * (`info/refs?service=git-upload-pack`) combined with Forge Release & Tag REST APIs.
 */
export async function fetchGitRepoReleasesAndTags(
  repoUrl?: string | null,
  fallbackOwner?: string,
  fallbackRepo?: string,
  minMinetestVersion = '5.0.0',
  forceRefresh = false
): Promise<DiscoveredGitRelease[]> {
  let effectiveRepoUrl = repoUrl;
  if (!effectiveRepoUrl && fallbackOwner && fallbackRepo) {
    try {
      const scanned = await scanGitRepoMetadataCached(fallbackOwner, fallbackRepo);
      if (scanned?.repoUrl) {
        effectiveRepoUrl = scanned.repoUrl;
      }
    } catch {
      // Proceed with fallback target
    }
  }

  const target = parseGitRepoTarget(effectiveRepoUrl, fallbackOwner, fallbackRepo);
  if (!target) return [];

  const { provider, host, owner, repo } = target;
  const encOwnerPath = owner.split('/').map(encodeURIComponent).join('/');
  const relCacheKey = `/__git_releases_tags_v3/${host}/${encOwnerPath}/${encodeURIComponent(repo.toLowerCase())}/${encodeURIComponent(minMinetestVersion)}`;
  if (!forceRefresh) {
    const cachedReleases = await readEdgeCacheJson<DiscoveredGitRelease[]>(relCacheKey);
    if (Array.isArray(cachedReleases) && cachedReleases.length > 0) {
      return cachedReleases;
    }
  }

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
      const data: any = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.values)) return data.values;
      return null;
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
    releasesUrl = `https://${host}/api/v1/repos/${encOwnerPath}/${encodeURIComponent(repo)}/releases?limit=15`;
    tagsUrl = `https://${host}/api/v1/repos/${encOwnerPath}/${encodeURIComponent(repo)}/tags?limit=15`;
  } else if (provider === 'gitlab') {
    const projectPath = encodeURIComponent(`${owner}/${repo}`);
    releasesUrl = `https://${host}/api/v4/projects/${projectPath}/releases?per_page=15`;
    tagsUrl = `https://${host}/api/v4/projects/${projectPath}/repository/tags?per_page=15`;
  } else if (provider === 'bitbucket') {
    const bbOwnerPath = owner.toLowerCase().split('/').map(encodeURIComponent).join('/');
    tagsUrl = `https://api.bitbucket.org/2.0/repositories/${bbOwnerPath}/${encodeURIComponent(repo.toLowerCase())}/refs/tags?sort=-target.date&pagelen=20`;
  }

  // Query universal Git Smart HTTP refs + formal Releases + Forge Tags metadata in parallel
  // so plain Git tags across Bitbucket, GitLab, Codeberg/Mesehub/Gitea, and GitHub retain timestamps & messages.
  const [smartRefs, rawReleases, apiTags] = await Promise.all([
    fetchGitSmartHttpRefs(effectiveRepoUrl, fallbackOwner, fallbackRepo, forceRefresh),
    releasesUrl ? fetchJsonWithTimeout(releasesUrl) : Promise.resolve(null),
    tagsUrl && provider !== 'github' ? fetchJsonWithTimeout(tagsUrl) : Promise.resolve(null)
  ]);

  let fallbackApiTags = apiTags;
  if (!fallbackApiTags && (!smartRefs || smartRefs.tags.length === 0) && tagsUrl) {
    fallbackApiTags = await fetchJsonWithTimeout(tagsUrl);
  }

  const apiTagByName = new Map<string, any>();
  if (Array.isArray(fallbackApiTags)) {
    for (const t of fallbackApiTags) {
      const tagName = String(t?.name || '').trim();
      if (tagName && !apiTagByName.has(tagName)) {
        apiTagByName.set(tagName, t);
      }
    }
  }

  const combinedTagsList: any[] = [];
  const addedTagNames = new Set<string>();
  if (Array.isArray(fallbackApiTags)) {
    for (const t of fallbackApiTags) {
      const tagName = String(t?.name || '').trim();
      if (tagName && !addedTagNames.has(tagName)) {
        addedTagNames.add(tagName);
        combinedTagsList.push(t);
      }
    }
  }
  if (smartRefs && smartRefs.tags.length > 0) {
    for (const st of smartRefs.tags) {
      const tagName = String(st.tagName || '').trim();
      if (!tagName) continue;
      if (addedTagNames.has(tagName)) {
        const existing = apiTagByName.get(tagName);
        if (existing && st.commitSha) {
          existing._peeledSha = st.commitSha;
        }
      } else {
        addedTagNames.add(tagName);
        combinedTagsList.push({ name: tagName, commit: { sha: st.commitSha } });
      }
    }
  }
  const rawTags = combinedTagsList.length > 0 ? combinedTagsList : null;

  const extractReleaseZipAsset = (relObj: any): { url?: string; size?: number } => {
    if (!relObj) return {};
    if (Array.isArray(relObj.assets)) {
      const found = relObj.assets.find(
        (a: any) =>
          String(a?.name || a?.browser_download_url || a?.url || '').toLowerCase().endsWith('.zip') &&
          (a?.browser_download_url || a?.url)
      );
      if (found) {
        return {
          url: String(found.browser_download_url || found.url),
          size: Number(found.size || 0) || undefined
        };
      }
    }
    // GitLab release assets (`relObj.assets.links` / `relObj.assets.sources`)
    if (relObj.assets && typeof relObj.assets === 'object') {
      const links = Array.isArray(relObj.assets.links) ? relObj.assets.links : [];
      const linkZip = links.find((l: any) =>
        String(l?.name || l?.direct_asset_url || l?.url || '').toLowerCase().endsWith('.zip')
      );
      if (linkZip && (linkZip.direct_asset_url || linkZip.url)) {
        return { url: String(linkZip.direct_asset_url || linkZip.url) };
      }
    }
    return {};
  };

  const tagShaMap = new Map<string, string>();
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      const tagName = String(t?.name || '').trim();
      const sha = String(
        t?._peeledSha ||
          t?.target?.hash ||
          t?.commit?.sha ||
          t?.commit?.id ||
          t?.id ||
          ''
      ).trim();
      if (tagName && /^[0-9a-f]{7,40}$/i.test(sha)) {
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

  // 1. Add tags in repository tag order, enriched with formal Release & Forge Tag metadata if present
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      const tagName = String(t?.name || '').trim();
      if (!tagName || seenTags.has(tagName)) continue;
      seenTags.add(tagName);

      const rel = releaseByTag.get(tagName);
      const rawCommit = String(
        t?._peeledSha ||
          t?.target?.hash ||
          t?.commit?.sha ||
          t?.commit?.id ||
          rel?.commit?.id ||
          t?.id ||
          rel?.target_commitish ||
          ''
      ).trim();
      const isHexSha = /^[0-9a-f]{7,40}$/i.test(rawCommit);
      const zipAsset = extractReleaseZipAsset(rel);
      const archiveUrl = zipAsset.url || buildGitTagArchiveUrl(provider, host, owner, repo, tagName);
      const assetSize = Number(zipAsset.size || 0);
      const relDate = String(
        rel?.published_at ||
          rel?.released_at ||
          rel?.created_at ||
          t?.target?.date ||
          t?.Date ||
          t?.commit?.committed_date ||
          t?.commit?.created_at ||
          t?.commit?.created ||
          t?.commit?.author?.date ||
          ''
      );
      const title = String(rel?.name || tagName).trim() || tagName;
      const rawNotes =
        rel?.body ||
        rel?.description ||
        t?.message ||
        t?.target?.message ||
        t?.commit?.message;

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
        changelog: sanitizeReleaseNotesText(rawNotes, title),
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

      const rawCommit = String(tagShaMap.get(tagName) || r.commit?.id || r.target_commitish || '').trim();
      const isHexSha = /^[0-9a-f]{7,40}$/i.test(rawCommit);
      const zipAsset = extractReleaseZipAsset(r);
      const archiveUrl = zipAsset.url || buildGitTagArchiveUrl(provider, host, owner, repo, tagName);
      const assetSize = Number(zipAsset.size || 0);
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
        changelog: sanitizeReleaseNotesText(r.body || r.description, title),
        release_date: relDate,
        released_at: relDate
      });
    }
  }

  // 3. Graceful Atom/RSS feed fallback if REST APIs were rate-limited or disabled on the forge
  if (results.length === 0 && provider !== 'bitbucket') {
    const feedUrls =
      provider === 'github'
        ? [
            `https://github.com/${encOwnerPath}/${encodeURIComponent(repo)}/releases.atom`,
            `https://github.com/${encOwnerPath}/${encodeURIComponent(repo)}/tags.atom`
          ]
        : provider === 'gitlab'
          ? [`https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/-/tags?format=atom`]
          : [`https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/releases.rss`];

    for (const feedUrl of feedUrls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3200);
      try {
        const feedRes = await fetchWithAnubisSupport(feedUrl, {
          headers: { 'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)' },
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!feedRes.ok) continue;
        const xml = await feedRes.text();
        const itemRegex = /<(?:entry|item)>([\s\S]*?)<\/(?:entry|item)>/gi;
        let m: RegExpExecArray | null;
        while ((m = itemRegex.exec(xml)) !== null && results.length < MAX_PACKAGE_RELEASES) {
          const block = m[1];
          const linkMatch =
            block.match(/<link[^>]*href=["']([^"']+)["']/i) || block.match(/<link>([\s\S]*?)<\/link>/i);
          const linkHref = (linkMatch?.[1] || '').trim();
          const tagFromLink = linkHref.match(/\/(?:releases\/tag|tags|archive)\/([^/?#"'\s]+)/i)?.[1];
          const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const rawTitle = (titleMatch?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
          const tagName = decodeURIComponent(tagFromLink || rawTitle.split(/\s+/)[0] || '').trim();
          if (!tagName || seenTags.has(tagName)) continue;
          seenTags.add(tagName);
          const dateMatch = block.match(/<(?:updated|pubDate)>([\s\S]*?)<\/(?:updated|pubDate)>/i);
          const archiveUrl = buildGitTagArchiveUrl(provider, host, owner, repo, tagName);
          results.push({
            id: `feed-${results.length + 1}`,
            version: rawTitle || tagName,
            title: rawTitle || tagName,
            tag_name: tagName,
            commit_sha: '',
            url: archiveUrl,
            download_url: archiveUrl,
            min_minetest_version: minMinetestVersion,
            changelog: undefined,
            release_date: (dateMatch?.[1] || '').trim(),
            released_at: (dateMatch?.[1] || '').trim()
          });
        }
        if (results.length > 0) break;
      } catch {
        clearTimeout(timer);
      }
    }
  }

  const sortedResults = sortAndCapReleases(results, MAX_PACKAGE_RELEASES);

  // For GitHub repos where the newest tag is a plain Git tag without a formal GitHub Release object,
  // enrich the top tag with its commit date and commit message so timestamps and sorting are accurate.
  if (
    provider === 'github' &&
    sortedResults.length > 0 &&
    !sortedResults[0].released_at &&
    /^[0-9a-f]{7,40}$/i.test(sortedResults[0].commit_sha)
  ) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const commitRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sortedResults[0].commit_sha)}`,
        { headers, signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (commitRes.ok) {
        const commitData: any = await commitRes.json();
        const commitDate = String(
          commitData?.commit?.committer?.date || commitData?.commit?.author?.date || ''
        ).trim();
        if (commitDate) {
          sortedResults[0].released_at = commitDate;
          sortedResults[0].release_date = commitDate;
        }
        if (!sortedResults[0].changelog && commitData?.commit?.message) {
          sortedResults[0].changelog = sanitizeReleaseNotesText(
            commitData.commit.message,
            sortedResults[0].title
          );
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }

  if (sortedResults.length > 0) {
    await writeEdgeCacheJson(relCacheKey, sortedResults, 120);
  }
  return sortedResults;
}

export function normalizeReleaseTagKey(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(?:release|version|ver|rel)[\s_-]+/i, '')
    .replace(/^v(?=\d)/i, '');
}

/**
 * Merges ContentDB/D1 releases with live Git releases & tags discovered via `fetchGitRepoReleasesAndTags`.
 * - Deduplicates by normalized tag/version/title key and by commit SHA prefix (`7..40` hex chars).
 * - Preserves official ContentDB release IDs, download counts, and sizes when a tag exists in both.
 * - Prepends any newly pushed Git tags from GitHub, Codeberg, Mesehub, GitLab, or Bitbucket that
 *   have not yet been imported into ContentDB or D1.
 */
export function mergeUpstreamAndGitReleases(
  baseReleases: any[],
  gitReleases: DiscoveredGitRelease[],
  author: string,
  name: string,
  options?: { usePackagedDownloadUrls?: boolean; isOfficialContentDbBase?: boolean }
): any[] {
  const usePackaged = options?.usePackagedDownloadUrls ?? false;
  const isOfficialBase = options?.isOfficialContentDbBase ?? false;
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);

  const realBase = (Array.isArray(baseReleases) ? baseReleases : []).filter(
    r => r && r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
  );
  const validGit = (Array.isArray(gitReleases) ? gitReleases : []).filter(
    r => r && r.commit_sha !== 'HEAD' && r.version !== 'latest'
  );

  const formatGitRel = (rel: DiscoveredGitRelease): any => {
    const tag = String(rel.tag_name || rel.version || rel.title || '').trim();
    const packagedUrl = tag
      ? `/api/packages/${encAuthor}/${encName}/download?tag=${encodeURIComponent(tag)}`
      : `/api/packages/${encAuthor}/${encName}/download`;
    const cleanNotes = sanitizeReleaseNotesText(rel.changelog, tag);
    const rawBytes = Number(rel.size || 0);
    return {
      ...rel,
      id: rel.id || `git-${tag}`,
      version: rel.version || tag,
      title: rel.title || rel.version || tag,
      tag_name: tag,
      commit_sha: rel.commit_sha || '',
      url: usePackaged ? packagedUrl : (rel.download_url || rel.url || packagedUrl),
      download_url: usePackaged ? packagedUrl : (rel.download_url || rel.url || packagedUrl),
      upstream_url: rel.download_url || rel.url,
      size: rawBytes > 0 ? rawBytes : undefined,
      file_size: rawBytes > 0 ? formatByteSize(rawBytes) : undefined,
      changelog: cleanNotes,
      release_notes: cleanNotes,
      release_date: rel.released_at || rel.release_date || undefined,
      released_at: rel.released_at || rel.release_date || ''
    };
  };

  if (realBase.length === 0) {
    if (validGit.length > 0) {
      return sortAndCapReleases(validGit.map(formatGitRel), MAX_PACKAGE_RELEASES);
    }
    return sortAndCapReleases(baseReleases || [], MAX_PACKAGE_RELEASES);
  }

  if (validGit.length === 0) {
    return sortAndCapReleases(realBase, MAX_PACKAGE_RELEASES);
  }

  const sortedBase = sortAndCapReleases(realBase, MAX_PACKAGE_RELEASES);
  const newestBase = sortedBase[0];
  const newestBaseVer = String(newestBase?.tag_name || newestBase?.version || newestBase?.title || '');
  const newestBaseTime = Date.parse(String(newestBase?.released_at || newestBase?.release_date || '')) || 0;
  const baseUsesBareSemver = Boolean(
    newestBase?.version && /^\d+\.\d+/.test(String(newestBase.version).trim())
  );

  const formatGitRelAligned = (rel: DiscoveredGitRelease): any => {
    const formatted = formatGitRel(rel);
    if (baseUsesBareSemver) {
      if (typeof formatted.version === 'string' && /^v(?=\d)/i.test(formatted.version)) {
        formatted.version = formatted.version.replace(/^v/i, '');
      }
      if (typeof formatted.title === 'string' && /^v(?=\d)/i.test(formatted.title)) {
        formatted.title = formatted.title.replace(/^v/i, '');
      }
    }
    return formatted;
  };

  const matchedGitIndices = new Set<number>();
  const enrichedBase = sortedBase.map(b => {
    const bKeys = new Set(
      [b.tag_name, b.version, b.title]
        .map(v => normalizeReleaseTagKey(String(v || '')))
        .filter(Boolean)
    );
    const bSha = String(b.commit_sha || '').trim().toLowerCase();
    const bHasHexSha = /^[0-9a-f]{7,40}$/.test(bSha);

    let matchedIdx = -1;
    for (let i = 0; i < validGit.length; i++) {
      const g = validGit[i];
      const gSha = String(g.commit_sha || '').trim().toLowerCase();
      const gHasHexSha = /^[0-9a-f]{7,40}$/.test(gSha);
      if (bHasHexSha && gHasHexSha && (bSha.startsWith(gSha) || gSha.startsWith(bSha))) {
        matchedIdx = i;
        break;
      }
      const gKeys = [g.tag_name, g.version, g.title]
        .map(v => normalizeReleaseTagKey(String(v || '')))
        .filter(Boolean);
      if (gKeys.some(k => bKeys.has(k))) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx >= 0) {
      matchedGitIndices.add(matchedIdx);
      const g = validGit[matchedIdx];
      const cleanNotes =
        b.release_notes ||
        b.changelog ||
        sanitizeReleaseNotesText(g.changelog, String(b.title || b.version || g.tag_name || ''));
      return {
        ...b,
        tag_name: b.tag_name || g.tag_name || b.version,
        commit_sha: b.commit_sha || g.commit_sha || '',
        release_notes: cleanNotes,
        changelog: cleanNotes,
        release_date: b.release_date || b.released_at || g.released_at || g.release_date || undefined,
        released_at: b.released_at || b.release_date || g.released_at || g.release_date || ''
      };
    }
    return b;
  });

  const unmatchedGitToInclude: any[] = [];
  for (let i = 0; i < validGit.length; i++) {
    if (matchedGitIndices.has(i)) continue;
    const g = validGit[i];
    if (!isOfficialBase) {
      unmatchedGitToInclude.push(formatGitRelAligned(g));
      continue;
    }

    // When merging with official ContentDB releases, include any unmatched Git tag that is newer
    // than ContentDB's latest release (by timestamp, semantic version, or top-of-repo tag position).
    const gVer = String(g.tag_name || g.version || g.title || '');
    const gTime = Date.parse(String(g.released_at || g.release_date || '')) || 0;
    const semverVsNewest = compareSemanticVersionsDesc(gVer, newestBaseVer);
    const isNewerBySemver = semverVsNewest < 0;
    const isNewerByTime = gTime > 0 && newestBaseTime > 0 && gTime > newestBaseTime + 1000;
    const isTopUnmatchedTagWithoutTime = i === 0 && gTime === 0 && semverVsNewest <= 0;

    if (isNewerBySemver || isNewerByTime || isTopUnmatchedTagWithoutTime) {
      unmatchedGitToInclude.push(formatGitRelAligned(g));
    }
  }

  return sortAndCapReleases([...unmatchedGitToInclude, ...enrichedBase], MAX_PACKAGE_RELEASES);
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
        const resolved = toProxiedGitImageIfNeeded(`${base}/${cleanPath}`);
        return `![${alt}](${resolved}${titlePart || ''})`;
      }
    )
    .replace(
      /(<img\b[^>]*?\bsrc\s*=\s*["'])(?!https?:\/\/|data:|\/)([^"']+)(["'][^>]*>)/gi,
      (_match, prefix, relPath, suffix) => {
        const cleanPath = String(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
        const resolved = toProxiedGitImageIfNeeded(`${base}/${cleanPath}`);
        return `${prefix}${resolved}${suffix}`;
      }
    );
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
      } else if (provider === 'bitbucket') {
        const res = await fetch(
          `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}`,
          { headers, signal: ctrl.signal }
        );
        if (res.ok) {
          const data: any = await res.json();
          const rawBytes = Number(data?.size || 0);
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
    const trimmed = raw.replace(/^\uFEFF/, '').trim();
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
  defaultBranch?: string;
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
  screenshotUrl?: string;
  screenshots?: string[];
}

export function normalizeGitRepoInputUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const cleanedPath = u.pathname
      .replace(/\/-\/(?:tree|blob|commits|releases|tags|archive)(?:\/.*)?$/i, '')
      .replace(/\/(?:tree|blob|src|plain|log|commits|releases|tags|archive)(?:\/.*)?$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleanedPath.split('/').filter(Boolean);
    if (parts.length === 1) {
      return `${u.origin}/${parts[0].replace(/\.git$/i, '')}`;
    }
    if (parts.length >= 2) {
      if (host.includes('notabug.org')) {
        return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1].replace(/\.git$/i, '')}`;
      }
      const isStandardTwoSegmentForge =
        host === 'github.com' ||
        host.endsWith('.github.com') ||
        host === 'codeberg.org' ||
        host.endsWith('.codeberg.org') ||
        host === 'bitbucket.org' ||
        host.endsWith('.bitbucket.org') ||
        host === 'git.minetest.land';
      const repoPath = !isStandardTwoSegmentForge
        ? parts.map((p, idx) => (idx === parts.length - 1 ? p.replace(/\.git$/i, '') : p)).join('/')
        : `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
      return `${u.origin}/${repoPath}`;
    }
  } catch {
    // Keep original if URL parsing fails
  }
  return trimmed;
}

export function extractGitBranchHint(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  try {
    const u = new URL(rawUrl.trim());
    const m =
      u.pathname.match(/\/-\/(?:tree|blob)\/([^/?#]+)/i) ||
      u.pathname.match(/\/(?:tree|blob|src)\/([^/?#]+)/i);
    if (m && m[1]) {
      const branch = decodeURIComponent(m[1]).trim();
      if (branch && !branch.includes('..')) {
        return branch;
      }
    }
  } catch {
    // Ignore invalid URL
  }
  return undefined;
}

import {
  buildProviderRawBaseCandidates,
  isGitProviderId,
  isAuthLoginGitProvider,
  detectGitProviderFromUrl,
  buildProviderRootListingApiUrl,
  buildProviderRawFileUrl,
  toProxiedGitImageIfNeeded,
  unwrapProxiedImageUrl,
  isGitRepositoryAssetUrl,
  isDeadMirrorScreenshotUrl,
  sanitizePackageImageUrl,
  removeContentDbPngHack,
  toCanonicalContentDbUploadUrl,
  formatContentDbCdnUrl,
  isContentDbThumbnailUrl,
  upgradeContentDbThumbnailUrl,
  toLegacyLuantiClientThumbnailUrl,
  selectSharpPackageBanner,
  getCanonicalScreenshotKey,
  mergeScreenshotsPreferringGit,
  isPackageDeprecated,
  GIT_PROVIDER_CONFIGS,
  ALL_GIT_PROVIDER_IDS,
  AUTH_LOGIN_GIT_PROVIDER_IDS
} from '../../../src/app/core/config/git-providers.config';
export {
  buildProviderRawBaseCandidates,
  isGitProviderId,
  isAuthLoginGitProvider,
  detectGitProviderFromUrl,
  buildProviderRootListingApiUrl,
  buildProviderRawFileUrl,
  toProxiedGitImageIfNeeded,
  unwrapProxiedImageUrl,
  isGitRepositoryAssetUrl,
  isDeadMirrorScreenshotUrl,
  sanitizePackageImageUrl,
  removeContentDbPngHack,
  toCanonicalContentDbUploadUrl,
  formatContentDbCdnUrl,
  isContentDbThumbnailUrl,
  upgradeContentDbThumbnailUrl,
  toLegacyLuantiClientThumbnailUrl,
  selectSharpPackageBanner,
  getCanonicalScreenshotKey,
  mergeScreenshotsPreferringGit,
  isPackageDeprecated,
  GIT_PROVIDER_CONFIGS,
  ALL_GIT_PROVIDER_IDS,
  AUTH_LOGIN_GIT_PROVIDER_IDS
};

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
  const branchHint = extractGitBranchHint(existingRepoUrl);
  const normalizedInputUrl = normalizeGitRepoInputUrl(existingRepoUrl);
  const cacheKey = `/__git_repo_scan_v11/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/${encodeURIComponent((normalizedInputUrl || '').toLowerCase())}`;
  const cached = await readEdgeCacheJson<GitRepoScanResult>(cacheKey);
  if (cached && cached.gitRepoStatus) {
    return cached;
  }

  const confFile =
    pkgType === 'game'
      ? 'game.conf'
      : pkgType === 'txp'
        ? 'texture_pack.conf'
        : pkgType === 'modpack'
          ? 'modpack.conf'
          : 'mod.conf';

  const rawBaseCandidates = buildProviderRawBaseCandidates(
    normalizedInputUrl,
    author,
    name,
    branchHint
  );

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
  let screenshotUrl: string | undefined;
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

  const isValidScreenshotResponse = (res: Response): boolean => {
    const ct = (res.headers?.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
      return false;
    }
    const cl = res.headers?.get('content-length');
    if (cl !== null && cl !== '') {
      const len = Number(cl);
      if (Number.isFinite(len) && len >= 0 && len < 32) {
        return false;
      }
    }
    return !ct || ct.startsWith('image/') || ct.includes('octet-stream') || ct.includes('binary');
  };

  const probeRawScreenshotUrl = async (
    baseUrl: string,
    signal: AbortSignal,
    relativeFile = 'screenshot.png'
  ): Promise<string | undefined> => {
    const cleanRel = relativeFile.replace(/^(?:\.\/+|\/+)+/, '');
    const shotUrl = `${baseUrl.replace(/\/+$/, '')}/${cleanRel}`;
    try {
      const headRes = await fetchWithAnubisSupport(shotUrl, { method: 'HEAD', signal }).catch(() => null);
      if (headRes && headRes.ok && isValidScreenshotResponse(headRes)) {
        return shotUrl;
      }
      const headCt = (headRes?.headers?.get('content-type') || '').toLowerCase();
      if (
        !headRes ||
        headRes.status === 405 ||
        headRes.status === 403 ||
        headRes.status === 501 ||
        (headRes.ok && headCt.includes('text/html'))
      ) {
        const getRes = await fetchWithAnubisSupport(shotUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-63' },
          signal
        }).catch(() => null);
        if (getRes && (getRes.ok || getRes.status === 206) && isValidScreenshotResponse(getRes)) {
          return shotUrl;
        }
      }
    } catch {
      // Ignore screenshot probe error
    }
    return undefined;
  };

  const tryCandidates = async (candidates: Array<{ base: string; repoUrl: string }>): Promise<boolean> => {
    for (const cand of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1600);
      try {
        const [res, cdbRes, probedScreenshotUrl] = await Promise.all([
          fetchWithAnubisSupport(`${cand.base}/${confFile}`, { signal: controller.signal }),
          fetchWithAnubisSupport(`${cand.base}/.cdb.json`, { signal: controller.signal }).catch(() => null),
          probeRawScreenshotUrl(cand.base, controller.signal)
        ]);
        clearTimeout(timer);

        const hasCandidateScreenshot = Boolean(probedScreenshotUrl);

        if (cdbRes && cdbRes.ok) {
          const cdbText = await cdbRes.text().catch(() => '');
          const parsedCdb = parseCdbJsonMetadata(cdbText);
          if (parsedCdb) {
            cdbMeta = parsedCdb;
            resolvedRepoUrl = cand.repoUrl;
            resolvedRawBaseUrl = cand.base;
            if (probedScreenshotUrl) {
              screenshotUrl = probedScreenshotUrl;
            }
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
                  if (hasCandidateScreenshot) {
                    screenshotUrl = `${cand.base}/screenshot.png`;
                  }
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
            if (hasCandidateScreenshot) {
              screenshotUrl = `${cand.base}/screenshot.png`;
            }
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
    // Never flag a repository as broken_404 solely because a guessed raw file endpoint returned 404.
    // Probe the repository root URL itself before declaring broken_404.
    let rootIsOnline = false;
    const rootCtrl = new AbortController();
    const rootTimer = setTimeout(() => rootCtrl.abort(), 1600);
    try {
      let rootRes = await fetchWithAnubisSupport(normalizedInputUrl, {
        method: 'HEAD',
        signal: rootCtrl.signal
      }).catch(() => null);
      if (!rootRes || rootRes.status === 405 || rootRes.status === 403 || rootRes.status === 501) {
        rootRes = await fetchWithAnubisSupport(normalizedInputUrl, {
          method: 'GET',
          signal: rootCtrl.signal
        }).catch(() => null);
      }
      if (rootRes && rootRes.ok) {
        rootIsOnline = true;
      }
    } catch {
      // Ignore probe error
    } finally {
      clearTimeout(rootTimer);
    }

    if (rootIsOnline) {
      resolvedRepoUrl = normalizedInputUrl;
      gitRepoStatus = 'verified';
    } else {
      gitRepoStatus = 'broken_404';
    }
  }

  const cdbScreenshotsRaw = (cdbMeta as CdbJsonMetadata | null)?.screenshots;
  const resolvedCdbScreenshots: string[] = [];
  if (Array.isArray(cdbScreenshotsRaw)) {
    const probeCtrl = new AbortController();
    const probeTimer = setTimeout(() => probeCtrl.abort(), 1400);
    try {
      const verifiedEntries = await Promise.all(
        cdbScreenshotsRaw.slice(0, 12).map(async (s: string) => {
          const clean = String(s || '').trim();
          if (!clean) return '';
          if (/^https?:\/\//i.test(clean)) return clean;
          if (resolvedRawBaseUrl) {
            return (await probeRawScreenshotUrl(resolvedRawBaseUrl, probeCtrl.signal, clean)) || '';
          }
          return '';
        })
      );
      for (const entry of verifiedEntries) {
        if (entry) resolvedCdbScreenshots.push(entry);
      }
    } finally {
      clearTimeout(probeTimer);
    }
  }

  const proxiedScreenshotUrl = screenshotUrl ? toProxiedGitImageIfNeeded(screenshotUrl) : undefined;
  const mergedGitScreenshots = mergeScreenshotsPreferringGit(
    [proxiedScreenshotUrl],
    resolvedCdbScreenshots
  );

  let detectedDefaultBranch = branchHint && branchHint.toUpperCase() !== 'HEAD' ? branchHint : undefined;
  if (!detectedDefaultBranch && resolvedRawBaseUrl) {
    const branchMatch =
      resolvedRawBaseUrl.match(/\/raw\/branch\/([^/?#]+)/i) ||
      resolvedRawBaseUrl.match(/\/-\/raw\/([^/?#]+)/i) ||
      resolvedRawBaseUrl.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/?#]+)/i) ||
      resolvedRawBaseUrl.match(/\/raw\/([^/?#]+)/i);
    const branchCand = branchMatch?.[1] ? decodeURIComponent(branchMatch[1]).trim() : '';
    if (branchCand && branchCand.toUpperCase() !== 'HEAD' && branchCand.toLowerCase() !== 'branch') {
      detectedDefaultBranch = branchCand;
    }
  }

  const scanResult: GitRepoScanResult = {
    repoUrl: resolvedRepoUrl || normalizedInputUrl,
    rawBaseUrl: resolvedRawBaseUrl,
    defaultBranch: detectedDefaultBranch,
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
    cdbMeta,
    screenshotUrl: proxiedScreenshotUrl || mergedGitScreenshots[0],
    screenshots: mergedGitScreenshots.length > 0 ? mergedGitScreenshots : undefined
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

  // Support randomData up to 480 bytes (Anubis v1.18+ uses 128-char hex randomData = 3 SHA-256 blocks)
  const block = new Uint8Array(512);
  const view = new DataView(block.buffer);
  const w = new Uint32Array(64);

  const compressBlock = (
    baseOffset: number,
    state: [number, number, number, number, number, number, number, number]
  ) => {
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

    let a = state[0];
    let bReg = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

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

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + bReg) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  };

  if (prefixBytes.length + 20 > block.length) {
    return null;
  }

  block.set(prefixBytes, 0);
  const fixedBlocks = Math.floor(prefixBytes.length / 64);
  const midState: [number, number, number, number, number, number, number, number] = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ];
  for (let b = 0; b < fixedBlocks; b++) {
    compressBlock(b * 64, midState);
  }

  const tailClearOffset = fixedBlocks * 64;
  const state: [number, number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0, 0];

  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const nonceStr = String(nonce);
    const totalLen = prefixBytes.length + nonceStr.length;
    if (totalLen + 9 > block.length) break;

    const numBlocks = Math.ceil((totalLen + 9) / 64);
    block.fill(0, tailClearOffset, numBlocks * 64);
    if (prefixBytes.length > tailClearOffset) {
      block.set(prefixBytes.subarray(tailClearOffset), tailClearOffset);
    }
    for (let i = 0; i < nonceStr.length; i++) {
      block[prefixBytes.length + i] = nonceStr.charCodeAt(i);
    }
    block[totalLen] = 0x80;

    const bitLen = totalLen * 8;
    view.setUint32(numBlocks * 64 - 4, bitLen >>> 0, false);

    for (let i = 0; i < 8; i++) {
      state[i] = midState[i];
    }
    for (let b = fixedBlocks; b < numBlocks; b++) {
      compressBlock(b * 64, state);
    }

    let matched = true;
    for (let byteIdx = 0; byteIdx < fullZeroBytes; byteIdx++) {
      const word = state[byteIdx >> 2];
      const shift = (3 - (byteIdx & 3)) * 8;
      if (((word >>> shift) & 0xff) !== 0) {
        matched = false;
        break;
      }
    }
    if (matched && checkHalfByte) {
      const word = state[fullZeroBytes >> 2];
      const shift = (3 - (fullZeroBytes & 3)) * 8;
      if ((((word >>> shift) & 0xff) >>> 4) !== 0) {
        matched = false;
      }
    }

    if (matched) {
      const hashHex = state.map(x => x.toString(16).padStart(8, '0')).join('');
      return {
        nonce,
        hashHex,
        elapsedMs: Math.max(16, Date.now() - startMs)
      };
    }
  }
  return null;
}

const ANUBIS_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

function applySetCookieHeaders(cookieMap: Map<string, string>, headers: Headers): void {
  const rawCookies: string[] = [];
  const getSetCookieFn = (headers as any)?.getSetCookie;
  if (typeof getSetCookieFn === 'function') {
    const list: string[] = getSetCookieFn.call(headers) || [];
    for (const item of list) {
      if (item) rawCookies.push(String(item));
    }
  }
  if (rawCookies.length === 0) {
    const rawCombined = headers.get('set-cookie') || '';
    if (rawCombined) {
      // Support dots (.) in cookie names such as `techaro.lol-anubis-auth` and `within.website-x-cmd-anubis-auth`
      for (const chunk of rawCombined.split(/,(?=\s*[a-zA-Z0-9_.-]+=)/)) {
        if (chunk.trim()) rawCookies.push(chunk.trim());
      }
    }
  }

  for (const rawCookie of rawCookies) {
    const parts = rawCookie.split(';').map(p => p.trim());
    const firstPart = parts[0] || '';
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;

    const name = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    const isExpired = parts.slice(1).some(attr => /^max-age\s*=\s*(0|-\d+)$/i.test(attr));
    if (!val || isExpired) {
      cookieMap.delete(name);
    } else {
      cookieMap.set(name, val);
    }
  }
}

function serializeCookieMap(cookieMap: Map<string, string>): string {
  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function extractAnubisChallengeScript(html: string): {
  challengeId: string;
  randomData: string;
  difficulty: number;
  method: string;
} | null {
  if (!html || !html.includes('anubis_challenge')) return null;
  const scriptMatch = html.match(
    /<script\b[^>]*\bid=["']anubis_challenge["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!scriptMatch || !scriptMatch[1]) return null;
  try {
    const challengePayload = JSON.parse(scriptMatch[1].trim());
    const rawChallenge = challengePayload?.challenge ?? challengePayload;
    const isStringChallenge = typeof rawChallenge === 'string';
    const challengeId = isStringChallenge ? '' : String(rawChallenge?.id || '').trim();
    const randomData = isStringChallenge
      ? rawChallenge.trim()
      : String(rawChallenge?.randomData || rawChallenge?.challenge || '').trim();
    const difficulty = Number(
      (typeof rawChallenge === 'object' ? rawChallenge?.difficulty : undefined) ??
        challengePayload?.rules?.difficulty ??
        4
    );
    const method = String(
      (typeof rawChallenge === 'object' ? rawChallenge?.method : undefined) ??
        challengePayload?.rules?.algorithm ??
        'fast'
    ).toLowerCase();

    if (!randomData) return null;
    return { challengeId, randomData, difficulty, method };
  } catch {
    return null;
  }
}

/**
 * Transparently handles Techaro Anubis v1.14–v1.28+ Proof-of-Work challenges on upstream community
 * Git forges (such as Mesehub `git.minetest.land`), caching the signed JWT clearance cookie
 * in Isolate Memory + Cloudflare Edge Cache (`caches.default`) for 24 hours.
 */
export async function fetchWithAnubisSupport(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let host = '';
  let origin = '';
  let pathname = '/';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    origin = parsed.origin;
    pathname = parsed.pathname || '/';
  } catch {
    return fetch(url, init);
  }

  const isAnubisCandidate =
    host.includes('minetest.land') ||
    host.includes('mesehub') ||
    host.includes('gitea') ||
    host.includes('forgejo') ||
    host.includes('codeberg');
  if (!isAnubisCandidate) {
    return fetch(url, init);
  }

  const cookieCacheKey = `/__anubis_cookie_v3/${encodeURIComponent(host)}`;
  const cachedCookieObj = await readEdgeCacheJson<{ cookie: string }>(cookieCacheKey);

  // Enforce a consistent browser User-Agent across the initial request, `/pass-challenge`, and
  // the authenticated retry because Anubis binds its challenge hash and JWT signature to `User-Agent`.
  const buildHeadersWithCookie = (cookieStr?: string): Record<string, string> => {
    const merged: Record<string, string> = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          if (k.toLowerCase() !== 'user-agent' && k.toLowerCase() !== 'cookie') {
            merged[k] = v;
          } else if (k.toLowerCase() === 'cookie') {
            merged['Cookie'] = v;
          }
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) {
          if (k.toLowerCase() !== 'user-agent' && k.toLowerCase() !== 'cookie') {
            merged[k] = v;
          } else if (k.toLowerCase() === 'cookie') {
            merged['Cookie'] = v;
          }
        }
      } else {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          if (k.toLowerCase() !== 'user-agent' && k.toLowerCase() !== 'cookie') {
            merged[k] = v;
          } else if (k.toLowerCase() === 'cookie') {
            merged['Cookie'] = v;
          }
        }
      }
    }
    const acceptKey = Object.keys(merged).find(k => k.toLowerCase() === 'accept');
    if (acceptKey && !merged[acceptKey].toLowerCase().includes('text/html')) {
      merged[acceptKey] = `${merged[acceptKey]},text/html;q=0.1`;
    } else if (!acceptKey) {
      merged['Accept'] = '*/*,text/html;q=0.1';
    }
    merged['User-Agent'] = ANUBIS_BROWSER_UA;
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
  const isPotentialAnubisBlock =
    contentType.includes('text/html') || firstRes.status === 401 || firstRes.status === 403;
  if (!isPotentialAnubisBlock) {
    return firstRes;
  }

  let challengeHtml = contentType.includes('text/html')
    ? await firstRes.clone().text().catch(() => '')
    : '';
  let parsedChallenge = extractAnubisChallengeScript(challengeHtml);
  const cookieMap = new Map<string, string>();
  applySetCookieHeaders(cookieMap, firstRes.headers);

  // If the request was intercepted by Anubis without an inline challenge script (e.g. POST token exchange,
  // 401/403 from a stale cached Anubis cookie, or an Anubis interstitial page), perform a clean GET to the origin root.
  // Never trigger this on normal Gitea 404 HTML pages so missing-file probes cost only 1 subrequest.
  const isLikelyAnubisWithoutInlineScript =
    !parsedChallenge &&
    ((init.method || 'GET').toUpperCase() !== 'GET' ||
      firstRes.status === 401 ||
      firstRes.status === 403 ||
      firstRes.status === 429 ||
      firstRes.status === 503 ||
      challengeHtml.toLowerCase().includes('anubis'));
  if (isLikelyAnubisWithoutInlineScript) {
    try {
      cookieMap.clear();
      const getChallengeRes = await fetch(`${origin}/`, {
        method: 'GET',
        headers: {
          'User-Agent': ANUBIS_BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      applySetCookieHeaders(cookieMap, getChallengeRes.headers);
      const getHtml = await getChallengeRes.text().catch(() => '');
      parsedChallenge = extractAnubisChallengeScript(getHtml);
    } catch {
      // Ignore fallback challenge GET failure
    }
  }

  if (!parsedChallenge) {
    return firstRes;
  }

  try {
    const solved =
      parsedChallenge.method === 'metarefresh'
        ? { nonce: 0, hashHex: parsedChallenge.randomData, elapsedMs: 20 }
        : solveAnubisPowChallengeSync(parsedChallenge.randomData, parsedChallenge.difficulty);
    if (!solved) {
      return firstRes;
    }

    const query = new URLSearchParams();
    if (parsedChallenge.challengeId) {
      query.set('id', parsedChallenge.challengeId);
    }
    query.set('response', solved.hashHex);
    query.set('nonce', String(solved.nonce));
    query.set('redir', pathname);
    query.set('elapsedTime', String(solved.elapsedMs));

    const passUrl = `${origin}/.within.website/x/cmd/anubis/api/pass-challenge?${query.toString()}`;
    const verificationCookieHeader = serializeCookieMap(cookieMap);

    const passRes = await fetch(passUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': ANUBIS_BROWSER_UA,
        'Referer': url,
        ...(verificationCookieHeader ? { 'Cookie': verificationCookieHeader } : {})
      }
    });

    applySetCookieHeaders(cookieMap, passRes.headers);
    const allCookies = serializeCookieMap(cookieMap);
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
  resolved_default_branch?: string;
  markdown_body?: string;
  commits: DiscoveredReleaseCommitItem[];
}

function normalizeForgeCommitItem(
  c: any,
  provider: 'github' | 'codeberg' | 'gitlab' | 'bitbucket',
  host: string,
  owner: string,
  repo: string
): DiscoveredReleaseCommitItem | null {
  if (!c || typeof c !== 'object') return null;
  const sha = String(c.sha || c.id || c.hash || '').trim();
  if (!sha) return null;
  const rawMessage = String(c.commit?.message || c.message || c.summary?.raw || c.title || '').trim();
  const firstLine = rawMessage.split(/\r?\n/)[0]?.trim() || sha.slice(0, 7);
  const rawBitbucketAuthor = String(c.author?.user?.display_name || c.author?.raw || '')
    .replace(/\s*<[^>]+>\s*/g, '')
    .trim();
  const authorName = String(
    c.commit?.author?.name ||
    c.author?.login ||
    c.author?.username ||
    rawBitbucketAuthor ||
    c.author_name ||
    owner
  ).trim();
  const committedAt = String(
    c.commit?.author?.date ||
    c.commit?.committer?.date ||
    c.date ||
    c.created_at ||
    c.committed_date ||
    ''
  ).trim();
  const webUrl = String(
    c.html_url ||
    c.web_url ||
    c.links?.html?.href ||
    (provider === 'gitlab'
      ? `https://${host}/${owner}/${repo}/-/commit/${sha}`
      : provider === 'bitbucket'
        ? `https://bitbucket.org/${owner}/${repo}/commits/${sha}`
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
    untilDate?: string;
  } = {}
): Promise<DiscoveredReleaseNotesPayload> {
  const headRef = (options.headRef || options.defaultBranch || 'HEAD').trim();
  const baseRef = (options.baseRef || '').trim();
  const releaseBody = sanitizeReleaseNotesText(options.releaseBody, headRef) || '';
  const untilDate = (options.untilDate || '').trim();
  const displayHeadRef = abbreviateGitRefLabel(headRef) || headRef;
  const displayBaseRef = abbreviateGitRefLabel(baseRef) || undefined;

  let effectiveRepoUrl = repoUrl ? String(repoUrl).trim() : '';
  if (!effectiveRepoUrl && fallbackOwner && fallbackRepo) {
    try {
      const scanned = await scanGitRepoMetadataCached(fallbackOwner, fallbackRepo);
      if (scanned?.repoUrl && scanned.gitRepoStatus === 'verified') {
        effectiveRepoUrl = scanned.repoUrl;
      }
    } catch {
      // No confirmed Git repository found
    }
  }

  // Only resolve commit logs & compare_url when a confirmed Git repository URL exists
  const target = effectiveRepoUrl ? parseGitRepoTarget(effectiveRepoUrl) : null;
  if (!target) {
    return {
      source: releaseBody ? 'release_notes' : 'metadata',
      head_ref: displayHeadRef,
      base_ref: displayBaseRef,
      markdown_body: releaseBody || undefined,
      commits: []
    };
  }

  const { provider, host, owner, repo } = target;
  const encOwnerPath = owner.split('/').map(encodeURIComponent).join('/');
  const cacheKey = `/__release_notes_v3/${provider}/${encodeURIComponent(host)}/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}/${encodeURIComponent(headRef)}/${encodeURIComponent(baseRef || 'none')}/${encodeURIComponent(untilDate || 'none')}`;
  const cached = await readEdgeCacheJson<DiscoveredReleaseNotesPayload>(cacheKey);
  if (cached && Array.isArray(cached.commits) && (cached.commits.length > 0 || cached.markdown_body)) {
    return cached;
  }

  const smartRefs = await fetchGitSmartHttpRefs(effectiveRepoUrl, owner, repo).catch(() => null);
  const hasSmartBranches = Boolean(smartRefs && Object.keys(smartRefs.branches || {}).length > 0);
  const hasSmartTags = Boolean(smartRefs && Array.isArray(smartRefs.tags) && smartRefs.tags.length > 0);
  const verifiedDefaultBranch =
    smartRefs?.defaultBranch ||
    (smartRefs?.branches?.['master']
      ? 'master'
      : smartRefs?.branches?.['main']
        ? 'main'
        : hasSmartBranches
          ? Object.keys(smartRefs!.branches)[0]
          : undefined);

  const resolveRefInRepo = (
    rawRef: string
  ): { ref: string; kind: 'commit' | 'tag' | 'branch' | 'unknown'; verified: boolean } => {
    const clean = (rawRef || '').trim();
    if (!clean || clean.toUpperCase() === 'HEAD') {
      const br =
        verifiedDefaultBranch ||
        (options.defaultBranch && options.defaultBranch.toUpperCase() !== 'HEAD' ? options.defaultBranch : '') ||
        'main';
      return { ref: br, kind: 'branch', verified: Boolean(verifiedDefaultBranch) };
    }
    if (/^[0-9a-f]{7,40}$/i.test(clean)) {
      return { ref: clean, kind: 'commit', verified: true };
    }
    if (smartRefs && (hasSmartBranches || hasSmartTags)) {
      const branchKeys = Object.keys(smartRefs.branches || {});
      const exactBranch =
        branchKeys.find(b => b === clean) ||
        branchKeys.find(b => b.toLowerCase() === clean.toLowerCase());
      if (exactBranch) {
        return { ref: exactBranch, kind: 'branch', verified: true };
      }
      const cleanNoV = clean.replace(/^v/i, '');
      const exactTag =
        smartRefs.tags.find(t => t.tagName === clean) ||
        smartRefs.tags.find(t => t.tagName.toLowerCase() === clean.toLowerCase()) ||
        smartRefs.tags.find(t => t.tagName.replace(/^v/i, '').toLowerCase() === cleanNoV.toLowerCase());
      if (exactTag) {
        return { ref: exactTag.tagName, kind: 'tag', verified: true };
      }
      if (
        verifiedDefaultBranch &&
        (clean === 'main' || clean === 'master' || clean === options.defaultBranch)
      ) {
        return { ref: verifiedDefaultBranch, kind: 'branch', verified: true };
      }
      return { ref: clean, kind: 'unknown', verified: false };
    }
    const isLikelyBranch =
      clean === 'main' || clean === 'master' || clean === options.defaultBranch;
    return { ref: clean, kind: isLikelyBranch ? 'branch' : 'unknown', verified: false };
  };

  const resolvedHead = resolveRefInRepo(headRef);
  const resolvedBase = baseRef ? resolveRefInRepo(baseRef) : null;
  let effectiveResolvedRef = resolvedHead.ref;
  let effectiveResolvedKind: 'commit' | 'tag' | 'branch' | 'unknown' = resolvedHead.kind;

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

  const canAttemptCompare =
    Boolean(resolvedBase && resolvedBase.ref && resolvedHead.ref) &&
    resolvedBase!.ref !== resolvedHead.ref &&
    resolvedHead.ref.toUpperCase() !== 'HEAD' &&
    (!(hasSmartBranches || hasSmartTags) || (resolvedBase!.verified && resolvedHead.verified));

  // Level 1: Compare between baseRef...headRef
  if (canAttemptCompare && resolvedBase) {
    const encBase = encodeURIComponent(resolvedBase.ref);
    const encHead = encodeURIComponent(resolvedHead.ref);
    if (provider === 'github') {
      const candidateCompareUrl = `https://github.com/${owner}/${repo}/compare/${encBase}...${encHead}`;
      const cmp = await fetchJsonQuick(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encBase}...${encHead}`
      );
      if (Array.isArray(cmp?.commits) && cmp.commits.length > 0) {
        source = 'compare';
        compareUrl = candidateCompareUrl;
        commits = [...cmp.commits]
          .reverse()
          .map(c => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      } else if (resolvedBase.verified && resolvedHead.verified) {
        compareUrl = candidateCompareUrl;
      }
    } else if (provider === 'codeberg') {
      const candidateCompareUrl = `https://${host}/${owner}/${repo}/compare/${encBase}...${encHead}`;
      const cmp = await fetchJsonQuick(
        `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encBase}...${encHead}`
      );
      if (Array.isArray(cmp?.commits) && cmp.commits.length > 0) {
        source = 'compare';
        compareUrl = candidateCompareUrl;
        commits = cmp.commits
          .map((c: any) => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c: DiscoveredReleaseCommitItem | null): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      } else if (resolvedBase.verified && resolvedHead.verified) {
        compareUrl = candidateCompareUrl;
      }
    } else if (provider === 'gitlab') {
      const candidateCompareUrl = `https://${host}/${owner}/${repo}/-/compare/${encBase}...${encHead}`;
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const cmp = await fetchJsonQuick(
        `https://${host}/api/v4/projects/${projectPath}/repository/compare?from=${encBase}&to=${encHead}`
      );
      if (Array.isArray(cmp?.commits) && cmp.commits.length > 0) {
        source = 'compare';
        compareUrl = candidateCompareUrl;
        commits = [...cmp.commits]
          .reverse()
          .map(c => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      } else if (resolvedBase.verified && resolvedHead.verified) {
        compareUrl = candidateCompareUrl;
      }
    } else if (provider === 'bitbucket') {
      const candidateCompareUrl = `https://bitbucket.org/${owner}/${repo}/branches/compare/${encHead}%0D${encBase}`;
      const cmp = await fetchJsonQuick(
        `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}/commits/${encHead}?exclude=${encBase}&pagelen=25`
      );
      if (Array.isArray(cmp?.values) && cmp.values.length > 0) {
        source = 'compare';
        compareUrl = candidateCompareUrl;
        commits = cmp.values
          .map((c: any) => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c: DiscoveredReleaseCommitItem | null): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 25);
      } else if (resolvedBase.verified && resolvedHead.verified) {
        compareUrl = candidateCompareUrl;
      }
    }
  }

  // Level 2 & 3: Single-ref or Default-Branch commit history fallback
  if (commits.length === 0) {
    const rawRefCandidates = Array.from(
      new Set(
        [
          resolvedHead.ref !== 'HEAD' ? resolvedHead.ref : '',
          verifiedDefaultBranch || '',
          options.defaultBranch && options.defaultBranch !== 'HEAD' ? options.defaultBranch : '',
          'main',
          'master',
          ''
        ].filter(v => v !== undefined)
      )
    );
    const refCandidates = rawRefCandidates.filter(cand => {
      if (!cand) return true;
      if (!hasSmartBranches && !hasSmartTags) return true;
      const info = resolveRefInRepo(cand);
      if (info.verified && info.ref === cand) return true;
      if (cand === 'main' || cand === 'master' || cand === options.defaultBranch) return false;
      return true;
    });
    const untilQuery = untilDate ? `&until=${encodeURIComponent(untilDate)}` : '';

    for (const refCand of refCandidates) {
      const encRef = refCand ? encodeURIComponent(refCand) : '';
      let rawList: any = null;
      if (provider === 'github') {
        rawList = await fetchJsonQuick(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=15${encRef ? `&sha=${encRef}` : ''}${!encRef ? untilQuery : ''}`
        );
      } else if (provider === 'codeberg') {
        rawList = await fetchJsonQuick(
          `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?limit=15${encRef ? `&sha=${encRef}` : ''}`
        );
      } else if (provider === 'gitlab') {
        const projectPath = encodeURIComponent(`${owner}/${repo}`);
        rawList = await fetchJsonQuick(
          `https://${host}/api/v4/projects/${projectPath}/repository/commits?per_page=15${encRef ? `&ref_name=${encRef}` : ''}${!encRef ? untilQuery : ''}`
        );
      } else if (provider === 'bitbucket') {
        const bbData = await fetchJsonQuick(
          `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}/commits${encRef ? '/' + encRef : ''}?pagelen=15`
        );
        rawList = Array.isArray(bbData?.values) ? bbData.values : null;
      }

      if (Array.isArray(rawList) && rawList.length > 0) {
        source = 'commits';
        if (refCand) {
          effectiveResolvedRef = refCand;
          const candInfo = resolveRefInRepo(refCand);
          effectiveResolvedKind =
            candInfo.kind !== 'unknown'
              ? candInfo.kind
              : refCand === 'main' ||
                  refCand === 'master' ||
                  refCand === options.defaultBranch ||
                  refCand === verifiedDefaultBranch
                ? 'branch'
                : effectiveResolvedKind;
        } else if (verifiedDefaultBranch) {
          effectiveResolvedRef = verifiedDefaultBranch;
          effectiveResolvedKind = 'branch';
        }
        commits = rawList
          .map(c => normalizeForgeCommitItem(c, provider, host, owner, repo))
          .filter((c): c is DiscoveredReleaseCommitItem => Boolean(c))
          .slice(0, 15);
        break;
      }
    }
  }

  // Level 3b: Atom / RSS feed fallback across GitHub, Codeberg, Mesehub, Gitea/Forgejo, and GitLab
  // when REST API quotas are rate-limited on shared Worker egress IPs or disabled on custom instances
  if (commits.length === 0 && provider !== 'bitbucket') {
    const rawFeedRefs = Array.from(
      new Set(
        [
          resolvedHead.ref !== 'HEAD' ? resolvedHead.ref : '',
          verifiedDefaultBranch || '',
          options.defaultBranch || '',
          'main',
          'master'
        ].filter(Boolean)
      )
    );
    const feedRefs = rawFeedRefs.filter(cand => {
      if (!hasSmartBranches && !hasSmartTags) return true;
      const info = resolveRefInRepo(cand);
      if (info.verified && info.ref === cand) return true;
      if (cand === 'main' || cand === 'master' || cand === options.defaultBranch) return false;
      return true;
    });
    const feedCandidates: Array<{ url: string; ref: string; kind: 'branch' | 'tag' }> = [];
    for (const ref of feedRefs) {
      const encRef = encodeURIComponent(ref);
      const refInfo = resolveRefInRepo(ref);
      const isTagRef = refInfo.kind === 'tag';
      if (provider === 'github') {
        feedCandidates.push({
          url: `https://github.com/${encOwnerPath}/${encodeURIComponent(repo)}/commits/${encRef}.atom`,
          ref,
          kind: isTagRef ? 'tag' : 'branch'
        });
      } else if (provider === 'gitlab') {
        feedCandidates.push({
          url: `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/-/commits/${encRef}?format=atom`,
          ref,
          kind: isTagRef ? 'tag' : 'branch'
        });
      } else if (isTagRef) {
        feedCandidates.push(
          {
            url: `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/commits/tag/${encRef}.rss`,
            ref,
            kind: 'tag'
          },
          {
            url: `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/commits/branch/${encRef}.rss`,
            ref,
            kind: 'branch'
          }
        );
      } else {
        feedCandidates.push(
          {
            url: `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/commits/branch/${encRef}.rss`,
            ref,
            kind: 'branch'
          },
          {
            url: `https://${host}/${encOwnerPath}/${encodeURIComponent(repo)}/commits/tag/${encRef}.rss`,
            ref,
            kind: 'tag'
          }
        );
      }
    }

    for (const feedCand of feedCandidates) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3200);
      try {
        const feedRes = await fetchWithAnubisSupport(feedCand.url, {
          headers: { 'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)' },
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (feedRes.ok) {
          const xml = await feedRes.text();
          const itemRegex = /<(?:entry|item)>([\s\S]*?)<\/(?:entry|item)>/gi;
          const parsedEntries: DiscoveredReleaseCommitItem[] = [];
          let m: RegExpExecArray | null;
          while ((m = itemRegex.exec(xml)) !== null && parsedEntries.length < 15) {
            const block = m[1];
            const shaMatch =
              block.match(/Commit\/([0-9a-f]{7,40})/i) ||
              block.match(/\/-\/commit\/([0-9a-f]{7,40})/i) ||
              block.match(/\/commit\/([0-9a-f]{7,40})/i);
            const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const authorMatch =
              block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i) ||
              block.match(/<author>([\s\S]*?)<\/author>/i) ||
              block.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
            const dateMatch = block.match(/<(?:updated|pubDate)>([\s\S]*?)<\/(?:updated|pubDate)>/i);
            const sha = shaMatch?.[1]?.trim() || '';
            if (!sha) continue;
            const rawTitle = (titleMatch?.[1] || '')
              .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .trim();
            const rawAuthor = (authorMatch?.[1] || owner)
              .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
              .replace(/\s*<[^>]+>\s*/g, '')
              .trim();
            const webUrl =
              provider === 'gitlab'
                ? `https://${host}/${owner}/${repo}/-/commit/${sha}`
                : `https://${host}/${owner}/${repo}/commit/${sha}`;
            parsedEntries.push({
              sha,
              short_sha: sha.slice(0, 7),
              title: rawTitle.split(/\r?\n/)[0]?.trim() || sha.slice(0, 7),
              author_name: rawAuthor || owner,
              committed_at: (dateMatch?.[1] || '').trim(),
              url: webUrl
            });
          }
          if (parsedEntries.length > 0) {
            source = 'commits';
            commits = parsedEntries;
            effectiveResolvedRef = feedCand.ref;
            effectiveResolvedKind = feedCand.kind;
            break;
          }
        }
      } catch {
        clearTimeout(timer);
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

  const finalHeadRef =
    effectiveResolvedRef && effectiveResolvedRef !== 'HEAD'
      ? effectiveResolvedRef
      : verifiedDefaultBranch || options.defaultBranch || 'main';
  const finalHeadKind: 'commit' | 'tag' | 'branch' | 'unknown' = /^[0-9a-f]{7,40}$/i.test(finalHeadRef)
    ? 'commit'
    : effectiveResolvedKind !== 'unknown'
      ? effectiveResolvedKind
      : smartRefs?.tags?.some(t => t.tagName.toLowerCase() === finalHeadRef.toLowerCase()) &&
          !smartRefs?.branches?.[finalHeadRef]
        ? 'tag'
        : 'branch';
  const finalDisplayHeadRef = abbreviateGitRefLabel(finalHeadRef) || finalHeadRef;
  const finalDisplayBaseRef = resolvedBase?.ref
    ? abbreviateGitRefLabel(resolvedBase.ref) || resolvedBase.ref
    : displayBaseRef;
  const effectiveRefForUrl = encodeURIComponent(finalHeadRef);
  const defaultHistoryUrl =
    provider === 'gitlab'
      ? `https://${host}/${owner}/${repo}/-/commits/${effectiveRefForUrl}`
      : provider === 'codeberg'
        ? finalHeadKind === 'commit'
          ? `https://${host}/${owner}/${repo}/commit/${effectiveRefForUrl}`
          : finalHeadKind === 'tag'
            ? `https://${host}/${owner}/${repo}/commits/tag/${effectiveRefForUrl}`
            : `https://${host}/${owner}/${repo}/commits/branch/${effectiveRefForUrl}`
        : finalHeadKind === 'commit'
          ? `https://${host}/${owner}/${repo}/commit/${effectiveRefForUrl}`
          : `https://${host}/${owner}/${repo}/commits/${effectiveRefForUrl}`;
  const resolvedDefaultBranch =
    verifiedDefaultBranch ||
    (finalHeadKind === 'branch' && commits.length > 0 ? finalHeadRef : undefined);

  const payload: DiscoveredReleaseNotesPayload = {
    source: commits.length > 0 ? source : releaseBody ? 'release_notes' : 'metadata',
    head_ref: finalDisplayHeadRef,
    base_ref: finalDisplayBaseRef,
    compare_url: compareUrl || defaultHistoryUrl,
    ...(resolvedDefaultBranch ? { resolved_default_branch: resolvedDefaultBranch } : {}),
    markdown_body: releaseBody || undefined,
    commits
  };

  if (commits.length > 0 || releaseBody) {
    await writeEdgeCacheJson(cacheKey, payload, 3600);
  }

  return payload;
}

import {
  parseLuantiBlogFeed,
  enrichLuantiBlogPostFromArticleHtml,
  LuantiBlogPost
} from '../../../src/app/core/models/package.model';
export { parseLuantiBlogFeed, enrichLuantiBlogPostFromArticleHtml };
export type DiscoveredLuantiBlogPost = LuantiBlogPost;

/**
 * Fetches the latest blog post from `https://blog.luanti.org/feed.rss` (with fallback to `feed.json`),
 * enriches it with the rendered article HTML (`_layouts/post.html` including `Cover image by ...` credits),
 * and caches it in isolate memory + Cloudflare Edge Cache for 30 minutes (1800s).
 */
export async function fetchLatestLuantiBlogPost(): Promise<DiscoveredLuantiBlogPost | null> {
  const cacheKey = 'https://cache.luantihub.internal/__luanti_blog_latest_v4';
  const cached = await readEdgeCacheJson<DiscoveredLuantiBlogPost>(cacheKey);
  if (cached && cached.title && cached.url && cached.content_html) {
    return cached;
  }

  const endpoints = [
    'https://blog.luanti.org/feed.rss',
    'https://blog.luanti.org/feed.json'
  ];

  for (const feedUrl of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(feedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)',
          Accept: 'application/rss+xml, application/xml, application/feed+json, application/json, text/xml;q=0.9, */*;q=0.8'
        }
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      let post = parseLuantiBlogFeed(text);
      if (post) {
        if (post.url && post.url.startsWith('https://blog.luanti.org/')) {
          const pageCtrl = new AbortController();
          const pageTimer = setTimeout(() => pageCtrl.abort(), 3500);
          try {
            const pageRes = await fetch(post.url, {
              signal: pageCtrl.signal,
              headers: {
                'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)',
                Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
              }
            });
            clearTimeout(pageTimer);
            if (pageRes && pageRes.ok) {
              const pageHtml = await pageRes.text();
              post = enrichLuantiBlogPostFromArticleHtml(post, pageHtml);
            }
          } catch {
            clearTimeout(pageTimer);
          }
        }
        await writeEdgeCacheJson(cacheKey, post, 1800);
        return post;
      }
    } catch {
      clearTimeout(timer);
    }
  }

  return null;
}

/**
 * Fetches and parses a Git repository's README file across GitHub, Codeberg, and GitLab,
 * returning sanitized markdown with rewritten relative image URLs, cached at the edge for 1 hour.
 */
export async function fetchRepoReadmeCached(repoUrl?: string): Promise<string | undefined> {
  const normalized = normalizeGitRepoInputUrl(repoUrl);
  if (!normalized) return undefined;
  const candidates: Array<{ url: string; rawBase?: string; headers?: Record<string, string> }> = [];
  const pushCandidate = (url: string, rawBase?: string, headers?: Record<string, string>) => {
    if (!candidates.some(c => c.url === url)) {
      candidates.push({ url, rawBase, headers });
    }
  };

  try {
    const u = new URL(normalized);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return undefined;
    const owner = parts[0];
    const repo = parts[1];
    const host = u.hostname.toLowerCase();

    if (host.includes('github.com')) {
      const ghBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
      for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt', 'README']) {
        pushCandidate(`${ghBase}/${file}`, ghBase);
      }
      pushCandidate(`https://api.github.com/repos/${owner}/${repo}/readme`, ghBase, {
        Accept: 'application/vnd.github.raw+json'
      });
    } else if (host.includes('codeberg.org')) {
      const lowerOwner = owner.toLowerCase();
      const cbApiBase = `https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`;
      for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt', 'README']) {
        pushCandidate(`${cbApiBase}/${file}`, cbApiBase);
      }
      for (const branch of ['main', 'master']) {
        const cbBranchBase = `https://codeberg.org/${lowerOwner}/${repo}/raw/branch/${branch}`;
        pushCandidate(`${cbBranchBase}/README.md`, cbBranchBase);
        pushCandidate(`${cbBranchBase}/readme.md`, cbBranchBase);
      }
    } else if (host.includes('gitlab.com')) {
      const glBase = `https://gitlab.com/${owner}/${repo}/-/raw/HEAD`;
      for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
        pushCandidate(`${glBase}/${file}`, glBase);
      }
    } else if (host.includes('bitbucket.org')) {
      for (const branch of ['HEAD', 'master', 'main']) {
        const bbBase = `https://bitbucket.org/${owner}/${repo}/raw/${branch}`;
        for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt']) {
          pushCandidate(`${bbBase}/${file}`, bbBase);
        }
      }
    } else {
      const canonicalRepoBase = normalized.replace(/\/+$/, '');
      const customRawBases = [
        `${canonicalRepoBase}/plain`,
        `${canonicalRepoBase}/raw/HEAD`,
        `${canonicalRepoBase}/raw/branch/master`,
        `${canonicalRepoBase}/raw/branch/main`,
        `${u.origin}/api/v1/repos/${owner}/${repo}/raw`
      ];
      for (const rawBase of customRawBases) {
        for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
          pushCandidate(`${rawBase}/${file}`, rawBase);
        }
      }
    }
  } catch {
    return undefined;
  }

  if (candidates.length === 0) return undefined;

  const cacheKeyUrl = `https://cache.luantihub.internal/readme?repo=${encodeURIComponent(normalized)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const text = await cached.text();
        return text || undefined;
      }
    } catch {
      // Ignore cache read error
    }
  }

  for (const cand of candidates) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(cand.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luantihub.org)',
          ...(cand.headers || {})
        }
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const rawText = (await res.text()).slice(0, 64000);
        if (
          rawText &&
          rawText.trim().length > 10 &&
          !rawText.trim().startsWith('<!DOCTYPE') &&
          !rawText.trim().startsWith('<html')
        ) {
          const text = rewriteRelativeMarkdownUrls(rawText, cand.rawBase);
          if (edgeCache) {
            try {
              await edgeCache.put(
                cacheReq,
                new Response(text, {
                  headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'public, max-age=3600, s-maxage=86400'
                  }
                })
              );
            } catch {
              // Ignore
            }
          }
          return text;
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }
  return undefined;
}

/**
 * Single source of truth for Cloudflare Edge Cache key versions and builders.
 * Centralizes key construction and mutation invalidation so version bumps never leave stale cache entries.
 */
export const BOOT_CATALOG_EDGE_CACHE_KEY = '/__api_boot_catalog_bundle_v22';
export const PACKAGE_DETAIL_CACHE_VERSION = 'pkg-detail-v21';
export const AUTHOR_PROFILE_CACHE_PREFIX = '/__api_author_profile_v2';
export const PACKAGE_REVIEWS_CACHE_PREFIX = '/__pkg_reviews_v2';

export function buildPackageDetailEdgeCacheKey(
  author: string,
  name: string,
  mode: 'lite' | 'full' | 'full-readme',
  lang = 'en'
): string {
  const normalizedLang = String(lang || 'en').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'en';
  const langKeySegment = normalizedLang && normalizedLang !== 'en' ? `${normalizedLang}/` : '';
  const encA = encodeURIComponent(String(author || '').trim().toLowerCase());
  const encN = encodeURIComponent(String(name || '').trim().toLowerCase());
  return `https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/${mode}/${langKeySegment}${encA}/${encN}`;
}

export function buildPackageReviewsEdgeCacheKey(author: string, name: string): string {
  const encA = encodeURIComponent(String(author || '').trim().toLowerCase());
  const encN = encodeURIComponent(String(name || '').trim().toLowerCase());
  return `${PACKAGE_REVIEWS_CACHE_PREFIX}/${encA}/${encN}`;
}

export function buildAuthorProfileEdgeCacheKey(username: string): string {
  const encU = encodeURIComponent(String(username || '').trim().toLowerCase());
  return `${AUTHOR_PROFILE_CACHE_PREFIX}/${encU}`;
}

export function buildPackageStatsEdgeCacheKey(author: string, name: string, days: number): string {
  const encA = encodeURIComponent(String(author || '').trim().toLowerCase());
  const encN = encodeURIComponent(String(name || '').trim().toLowerCase());
  return `/__pkg_stats_v1/${encA}/${encN}/${Number(days) || 30}`;
}

export function buildAuthorStatsEdgeCacheKey(username: string, days: number): string {
  const encU = encodeURIComponent(String(username || '').trim().toLowerCase());
  return `/__author_stats_v1/${encU}/${Number(days) || 30}`;
}

export interface PackageCacheInvalidationOptions {
  includeBootCatalog?: boolean;
  includeAuthorProfile?: boolean;
  includeGitRepoScan?: boolean;
  extraAuthors?: string[];
}

export function buildPackageCacheInvalidationKeys(
  author: string,
  name: string,
  options?: PackageCacheInvalidationOptions
): string[] {
  const lowerA = String(author || '').trim().toLowerCase();
  const lowerN = String(name || '').trim().toLowerCase();
  const encA = encodeURIComponent(lowerA);
  const encN = encodeURIComponent(lowerN);
  const keys = new Set<string>([
    buildPackageDetailEdgeCacheKey(lowerA, lowerN, 'full', 'en'),
    buildPackageDetailEdgeCacheKey(lowerA, lowerN, 'lite', 'en'),
    buildPackageDetailEdgeCacheKey(lowerA, lowerN, 'full-readme', 'en'),
    buildPackageReviewsEdgeCacheKey(lowerA, lowerN),
    `https://cache.luantihub.internal/__for_client_v5/${encA}/${encN}/en/%3Fformspec_version%3D8`
  ]);

  for (const d of [7, 30, 90, 365]) {
    keys.add(buildPackageStatsEdgeCacheKey(lowerA, lowerN, d));
  }

  if (options?.includeBootCatalog !== false) {
    keys.add(BOOT_CATALOG_EDGE_CACHE_KEY);
    keys.add(`https://cache.luantihub.internal${BOOT_CATALOG_EDGE_CACHE_KEY}`);
  }

  const addAuthorKeys = (handle: string) => {
    const clean = String(handle || '').trim().toLowerCase();
    if (!clean) return;
    keys.add(buildAuthorProfileEdgeCacheKey(clean));
    keys.add(`/__author_sync_status_v1/${encodeURIComponent(clean)}`);
    for (const d of [7, 30, 90, 365]) {
      keys.add(buildAuthorStatsEdgeCacheKey(clean, d));
    }
  };

  if (options?.includeAuthorProfile) {
    addAuthorKeys(lowerA);
  }

  if (Array.isArray(options?.extraAuthors)) {
    for (const extra of options!.extraAuthors) {
      addAuthorKeys(extra);
    }
  }

  if (options?.includeGitRepoScan) {
    keys.add(`/__git_repo_scan_v11/${encA}/${encN}`);
  }

  return Array.from(keys);
}

/**
 * Shared UTC date formatting and daily download/view telemetry series aggregation
 * used by both package analytics (`/api/packages/:author/:name/stats`) and author analytics (`/api/authors/:username/stats`).
 */
export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildUtcDateRange(days: number): { startDateStr: string; endDateStr: string; dates: string[] } {
  const safeDays = Math.max(1, Math.min(365, Math.floor(Number(days) || 30)));
  const now = new Date();
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startUtc = new Date(endUtc.getTime() - (safeDays - 1) * 86400000);
  const dates: string[] = [];
  for (let i = 0; i < safeDays; i++) {
    const dt = new Date(startUtc.getTime() + i * 86400000);
    dates.push(formatUtcDate(dt));
  }
  return {
    startDateStr: formatUtcDate(startUtc),
    endDateStr: formatUtcDate(endUtc),
    dates
  };
}

export function buildDualPeriodDateRange(days: number): {
  dates: string[];
  prevDates: string[];
  allDates: string[];
  startDate: string;
  endDate: string;
  prevStartDate: string;
} {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const totalDays = Math.min(365, Math.max(1, Math.round(days) || 30));

  const allDates: string[] = [];
  for (let i = totalDays * 2 - 1; i >= 0; i--) {
    const dt = new Date(todayUtc.getTime() - i * 86400000);
    allDates.push(formatUtcDate(dt));
  }

  const prevDates = allDates.slice(0, totalDays);
  const dates = allDates.slice(totalDays);
  return {
    dates,
    prevDates,
    allDates,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    prevStartDate: prevDates[0]
  };
}

export function computeCombinedTelemetryArrays(
  dates: string[],
  prevDates: string[],
  d1ByDate: Map<string, any>,
  cdbStats: any
) {
  const cdbPlatformLuanti: number[] = Array.isArray(cdbStats?.downloads?.platform?.minetest)
    ? cdbStats.downloads.platform.minetest
    : [];
  const cdbPlatformOther: number[] = Array.isArray(cdbStats?.downloads?.platform?.other)
    ? cdbStats.downloads.platform.other
    : [];
  const cdbReasonNew: number[] = Array.isArray(cdbStats?.downloads?.reason?.new)
    ? cdbStats.downloads.reason.new
    : [];
  const cdbReasonUpdate: number[] = Array.isArray(cdbStats?.downloads?.reason?.update)
    ? cdbStats.downloads.reason.update
    : [];
  const cdbReasonDep: number[] = Array.isArray(cdbStats?.downloads?.reason?.dependency)
    ? cdbStats.downloads.reason.dependency
    : [];
  const cdbReasonOther: number[] = Array.isArray(cdbStats?.downloads?.reason?.other)
    ? cdbStats.downloads.reason.other
    : [];
  const cdbViews: number[] = Array.isArray(cdbStats?.views) ? cdbStats.views : [];

  let prevPeriodDownloads = 0;
  for (let i = 0; i < prevDates.length; i++) {
    const dt = prevDates[i];
    const d1Row = d1ByDate.get(dt);
    const lhCount = Number(d1Row?.downloads_count) || 0;
    const cdbCount = (Number(cdbPlatformLuanti[i]) || 0) + (Number(cdbPlatformOther[i]) || 0);
    prevPeriodDownloads += lhCount + cdbCount;
  }

  const total: number[] = [];
  const source_contentdb: number[] = [];
  const source_luantihub: number[] = [];
  const platform_luanti: number[] = [];
  const platform_web: number[] = [];
  const reason_new: number[] = [];
  const reason_update: number[] = [];
  const reason_dependency: number[] = [];
  const reason_web: number[] = [];
  const views_luanti: number[] = [];
  const views_web: number[] = [];

  const offset = prevDates.length;
  for (let j = 0; j < dates.length; j++) {
    const dt = dates[j];
    const cdbIdx = offset + j;
    const d1Row = d1ByDate.get(dt);

    const d1Total = Number(d1Row?.downloads_count) || 0;
    const d1PlatLuanti = Number(d1Row?.platform_luanti) || 0;
    const d1PlatWeb = Number(d1Row?.platform_web) || Math.max(0, d1Total - d1PlatLuanti);
    const d1RNew = Number(d1Row?.reason_new) || 0;
    const d1RUpd = Number(d1Row?.reason_update) || 0;
    const d1RDep = Number(d1Row?.reason_dependency) || 0;
    const d1RWeb = Number(d1Row?.reason_web) || Math.max(0, d1Total - (d1RNew + d1RUpd + d1RDep));
    const d1VLuanti = Number(d1Row?.views_luanti) || 0;
    const d1VWeb = Number(d1Row?.views_web) || 0;

    const cdbPlatLuanti = Number(cdbPlatformLuanti[cdbIdx]) || 0;
    const cdbPlatWeb = Number(cdbPlatformOther[cdbIdx]) || 0;
    const cdbTotal = cdbPlatLuanti + cdbPlatWeb;
    const cdbRNew = Number(cdbReasonNew[cdbIdx]) || 0;
    const cdbRUpd = Number(cdbReasonUpdate[cdbIdx]) || 0;
    const cdbRDep = Number(cdbReasonDep[cdbIdx]) || 0;
    const cdbROther =
      cdbReasonOther[cdbIdx] !== undefined
        ? Number(cdbReasonOther[cdbIdx]) || 0
        : Math.max(0, cdbTotal - (cdbRNew + cdbRUpd + cdbRDep));
    const cdbVLuanti = Number(cdbViews[cdbIdx]) || 0;

    const dayTotal = cdbTotal + d1Total;
    total.push(dayTotal);
    source_contentdb.push(cdbTotal);
    source_luantihub.push(d1Total);
    platform_luanti.push(cdbPlatLuanti + d1PlatLuanti);
    platform_web.push(cdbPlatWeb + d1PlatWeb);
    reason_new.push(cdbRNew + d1RNew);
    reason_update.push(cdbRUpd + d1RUpd);
    reason_dependency.push(cdbRDep + d1RDep);
    reason_web.push(cdbROther + d1RWeb);
    views_luanti.push(cdbVLuanti + d1VLuanti);
    views_web.push(d1VWeb);
  }

  const sumArr = (arr: number[]) => arr.reduce((acc, v) => acc + (Number(v) || 0), 0);
  const periodDownloads = sumArr(total);
  const sumNew = sumArr(reason_new);
  const sumUpdate = sumArr(reason_update);
  const sumDep = sumArr(reason_dependency);
  const sumWeb = sumArr(reason_web);
  const sumPlatLuanti = sumArr(platform_luanti);
  const sumPlatWeb = sumArr(platform_web);
  const sumSrcCdb = sumArr(source_contentdb);
  const sumSrcLh = sumArr(source_luantihub);
  const sumViewsLuanti = sumArr(views_luanti);
  const sumViewsWeb = sumArr(views_web);
  const totalViews = sumViewsLuanti + sumViewsWeb;

  const trendPercent =
    prevPeriodDownloads > 0
      ? Number((((periodDownloads - prevPeriodDownloads) / prevPeriodDownloads) * 100).toFixed(1))
      : periodDownloads > 0
        ? 100
        : 0;
  const avgPerDay = Number((periodDownloads / Math.max(1, dates.length)).toFixed(1));
  const conversionRatePercent =
    totalViews > 0
      ? Number(Math.min(100, (periodDownloads / totalViews) * 100).toFixed(1))
      : 0;

  return {
    total,
    source_contentdb,
    source_luantihub,
    platform_luanti,
    platform_web,
    reason_new,
    reason_update,
    reason_dependency,
    reason_web,
    views_luanti,
    views_web,
    summary: {
      periodDownloads,
      prevPeriodDownloads,
      trendPercent,
      avgPerDay,
      totalViews,
      viewsLuanti: sumViewsLuanti,
      viewsWeb: sumViewsWeb,
      conversionRatePercent,
      reasonsTotal: {
        new: sumNew,
        update: sumUpdate,
        dependency: sumDep,
        web: sumWeb
      },
      platformsTotal: {
        luanti: sumPlatLuanti,
        web: sumPlatWeb
      },
      sourcesTotal: {
        contentdb: sumSrcCdb,
        luantihub: sumSrcLh
      }
    }
  };
}

export interface DailyTelemetryPoint {
  date: string;
  downloads: number;
  luanti: number;
  web: number;
  views_web: number;
  reason_new: number;
  reason_update: number;
  reason_dependency: number;
  reason_web: number;
}

export function buildDailyTelemetrySeries(
  dates: string[],
  rows: any[]
): {
  series: DailyTelemetryPoint[];
  windowTotals: { total: number; luanti: number; web: number; views_web: number };
} {
  const rowByDate = new Map<string, any>();
  for (const r of rows || []) {
    if (r?.download_date) {
      rowByDate.set(String(r.download_date).slice(0, 10), r);
    }
  }

  let windowDownloadsSum = 0;
  let windowLuantiSum = 0;
  let windowWebSum = 0;
  let windowViewsSum = 0;

  const series: DailyTelemetryPoint[] = dates.map((d) => {
    const row = rowByDate.get(d);
    const downloads = Number(row?.downloads_count || 0);
    const luanti = Number(row?.platform_luanti || 0);
    const web = Number(row?.platform_web || Math.max(0, downloads - luanti));
    const views_web = Number(row?.views_web || 0);
    const reason_new = Number(row?.reason_new || 0);
    const reason_update = Number(row?.reason_update || 0);
    const reason_dependency = Number(row?.reason_dependency || 0);
    const reason_web = Number(
      row?.reason_web || Math.max(0, downloads - (reason_new + reason_update + reason_dependency))
    );

    windowDownloadsSum += downloads;
    windowLuantiSum += luanti;
    windowWebSum += web;
    windowViewsSum += views_web;

    return {
      date: d,
      downloads,
      luanti,
      web,
      views_web,
      reason_new,
      reason_update,
      reason_dependency,
      reason_web
    };
  });

  return {
    series,
    windowTotals: {
      total: windowDownloadsSum,
      luanti: windowLuantiSum,
      web: windowWebSum,
      views_web: windowViewsSum
    }
  };
}

/**
 * Shared Git organization & repository contributor membership verifier across
 * GitHub, Codeberg, MeseHub, GitLab, and Bitbucket.
 */
export async function verifyGitOrgOrRepoMembership(
  provider: 'github' | 'codeberg' | 'mesehub' | 'gitlab' | 'bitbucket',
  host: string,
  owner: string,
  repo: string,
  verifiedHandle: string
): Promise<boolean> {
  const lowerHandle = String(verifiedHandle || '').trim().toLowerCase();
  if (!lowerHandle) return false;
  if (lowerHandle === String(owner || '').trim().toLowerCase()) return true;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    if (provider === 'github') {
      const orgRes = await fetch(
        `https://api.github.com/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(verifiedHandle)}`,
        { headers, signal: ctrl.signal }
      );
      if (orgRes.status === 204 || orgRes.status === 200) return true;

      const contribRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=30`,
        { headers, signal: ctrl.signal }
      );
      if (contribRes.ok) {
        const list = await contribRes.json();
        if (Array.isArray(list) && list.some((c: any) => String(c?.login || '').toLowerCase() === lowerHandle)) {
          return true;
        }
      }
    } else if (provider === 'codeberg' || provider === 'mesehub') {
      const orgRes = await fetchWithAnubisSupport(
        `https://${host}/api/v1/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(verifiedHandle)}`,
        { headers, signal: ctrl.signal }
      );
      if (orgRes.status === 204 || orgRes.status === 200) return true;

      const repoRes = await fetchWithAnubisSupport(
        `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers, signal: ctrl.signal }
      );
      if (repoRes.ok) {
        const repoData: any = await repoRes.json();
        if (String(repoData?.owner?.login || '').toLowerCase() === lowerHandle) {
          return true;
        }
      }
    } else if (provider === 'gitlab') {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const membersRes = await fetch(
        `https://${host}/api/v4/projects/${projectPath}/members/all?query=${encodeURIComponent(verifiedHandle)}`,
        { headers, signal: ctrl.signal }
      );
      if (membersRes.ok) {
        const list = await membersRes.json();
        if (Array.isArray(list) && list.some((m: any) => String(m?.username || '').toLowerCase() === lowerHandle)) {
          return true;
        }
      }
    } else if (provider === 'bitbucket') {
      const repoRes = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}`,
        { headers, signal: ctrl.signal }
      );
      if (repoRes.ok) {
        const repoData: any = await repoRes.json();
        const ownerCandidates = [
          repoData?.owner?.username,
          repoData?.owner?.nickname,
          repoData?.workspace?.slug
        ]
          .filter(Boolean)
          .map((s: any) => String(s).toLowerCase());
        if (ownerCandidates.includes(lowerHandle)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }

  return false;
}




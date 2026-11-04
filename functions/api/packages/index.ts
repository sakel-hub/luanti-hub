import {
  DEFAULT_CONTENTDB_TAGS,
  fetchUpstreamJsonCached,
  fetchWithAnubisSupport,
  fetchGitRepoReleasesAndTags,
  fetchGitSmartHttpRefs,
  syncDebouncedGitVersionStamp,
  fetchAccurateGitZipSize,
  fetchLatestLuantiBlogPost,
  parseJsonArray,
  normalizeRepoKey,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  ensureExtendedPackageColumns,
  ensurePromotionAndTagTables,
  scanGitRepoMetadataCached,
  extractEmbeddedVideo,
  parseNonZeroReviewThreadCounts,
  deriveReviewThreadCountsFromList,
  computeStarRatingFromData,
  buildReverseDependencyCountMap,
  computeDependencyPrioritizationMultiplier,
  isPrimarilyDependencyPackage,
  readSharedEdgeRatingsMap,
  mergeSharedEdgeRatingsMap,
  SharedEdgeRatingEntry,
  isGitRepositoryAssetUrl,
  isDeadMirrorScreenshotUrl,
  sanitizePackageImageUrl,
  formatContentDbCdnUrl,
  isContentDbThumbnailUrl,
  upgradeContentDbThumbnailUrl,
  selectSharpPackageBanner,
  mergeScreenshotsPreferringGit,
  toProxiedGitImageIfNeeded,
  isPackageDeprecated,
  isGitProviderId,
  detectGitProviderFromUrl,
  getLastKnownActivePromotions,
  setLastKnownActivePromotions,
  getUnifiedCatalogTags,
  isValidActivePromotionRow
} from '../lib/upstream';
import { normalizePromotionRow } from '../promotions/index';

import { parseCookies, verifySessionToken } from '../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

let lastCatalogNoCacheAt = 0;

interface PromoRowDelta {
  tagMap: Record<string, string[]>;
  items: any[];
}

/**
 * Syncs packages matching active Promotional Package Row #1 rules from ContentDB (`GET /api/packages/?tag=<tag>&fmt=vcs`)
 * with a 5-minute (300s) Edge Cache TTL and persists tag-to-package memberships in D1 (`promo_tag_packages`)
 * so LuantiHub remains ContentDB-agnostic even if ContentDB is offline.
 */
export async function syncActivePromotionRowPackages(
  activePromos: any[] | undefined | null,
  db?: any,
  noCache = false
): Promise<PromoRowDelta | null> {
  if (!Array.isArray(activePromos) || activePromos.length === 0) return null;

  const rowPromos = activePromos
    .map((p) => normalizePromotionRow(p))
    .filter((p) => p && p.row_enabled);
  if (rowPromos.length === 0) return null;

  const uniqueTags = Array.from(
    new Set(
      rowPromos
        .flatMap((p) => parseJsonArray(p.row_filter_tags))
        .map((t) => String(t || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 4);

  const uniqueAuthors = Array.from(
    new Set(
      rowPromos
        .filter((p) => parseJsonArray(p.row_filter_tags).length === 0 && p.row_filter_author)
        .map((p) => String(p.row_filter_author || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 2);

  if (uniqueTags.length === 0 && uniqueAuthors.length === 0) return null;

  const cacheSignature = `tags=${uniqueTags.map((t) => t.toLowerCase()).sort().join(',')}|authors=${uniqueAuthors.map((a) => a.toLowerCase()).sort().join(',')}`;
  const syncCacheKey = `/__promo_row_sync_v1_${encodeURIComponent(cacheSignature)}`;

  if (!noCache) {
    const cachedDelta = await readEdgeCacheJson<PromoRowDelta>(syncCacheKey);
    if (cachedDelta && cachedDelta.tagMap && Array.isArray(cachedDelta.items)) {
      return cachedDelta;
    }
  }

  const tagMap: Record<string, string[]> = {};
  const discoveredByKey = new Map<string, any>();
  const addTagStamp = (lowerPkgId: string, tag: string) => {
    if (!lowerPkgId || !tag) return;
    const list = tagMap[lowerPkgId] || [];
    if (!list.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      list.push(tag);
      tagMap[lowerPkgId] = list;
    }
  };

  // 1. Read persisted tag-to-package memberships from D1 `promo_tag_packages` first (offline & custom tag support)
  const existingD1Pairs = new Set<string>();
  if (db && uniqueTags.length > 0) {
    try {
      const lowerTags = uniqueTags.map((t) => t.toLowerCase());
      const placeholders = lowerTags.map(() => '?').join(', ');
      const d1RowsRes = await db
        .prepare(`SELECT tag_name, package_id FROM promo_tag_packages WHERE LOWER(tag_name) IN (${placeholders}) LIMIT 500`)
        .bind(...lowerTags)
        .all()
        .catch(() => null);
      if (Array.isArray(d1RowsRes?.results)) {
        for (const r of d1RowsRes.results) {
          if (r?.package_id && r?.tag_name) {
            const lowerPkgId = String(r.package_id).toLowerCase();
            const rawTagName = String(r.tag_name);
            existingD1Pairs.add(`${rawTagName.toLowerCase()}::${lowerPkgId}`);
            addTagStamp(lowerPkgId, rawTagName);
          }
        }
      }
    } catch {
      // Ignore if table not yet initialized
    }
  }

  // 2. Query ContentDB `/api/packages/?tag=<tag>&fmt=vcs` (300s Edge Cache per tag) and persist new associations to D1
  const d1UpsertPairs: Array<{ tag: string; pkgId: string }> = [];
  const queuedUpsertKeys = new Set<string>();

  await Promise.all([
    ...uniqueTags.map(async (tag) => {
      const list = await fetchUpstreamJsonCached<any[]>(
        `/packages/?tag=${encodeURIComponent(tag)}&fmt=vcs`,
        300
      ).catch(() => null);
      if (!Array.isArray(list)) return;
      const lowerTag = tag.toLowerCase();
      for (const item of list) {
        if (!item?.author || !item?.name) continue;
        const canonicalId = `${item.author}/${item.name}`;
        const lowerId = canonicalId.toLowerCase();
        addTagStamp(lowerId, tag);
        const pairKey = `${lowerTag}::${lowerId}`;
        if (!existingD1Pairs.has(pairKey) && !queuedUpsertKeys.has(pairKey)) {
          queuedUpsertKeys.add(pairKey);
          d1UpsertPairs.push({ tag, pkgId: canonicalId });
        }
        if (!discoveredByKey.has(lowerId)) {
          discoveredByKey.set(lowerId, item);
        }
      }
    }),
    ...uniqueAuthors.map(async (authorName) => {
      const list = await fetchUpstreamJsonCached<any[]>(
        `/packages/?author=${encodeURIComponent(authorName)}&fmt=vcs`,
        300
      ).catch(() => null);
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item?.author || !item?.name) continue;
        const lowerId = `${item.author}/${item.name}`.toLowerCase();
        if (!discoveredByKey.has(lowerId)) {
          discoveredByKey.set(lowerId, item);
        }
      }
    })
  ]);

  if (db && d1UpsertPairs.length > 0) {
    const runTagPkgUpsert = async () => {
      const stmts = d1UpsertPairs.slice(0, 120).map((pair) =>
        db
          .prepare(`
            INSERT INTO promo_tag_packages (tag_name, package_id, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tag_name, package_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
          `)
          .bind(pair.tag, pair.pkgId)
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
      await runTagPkgUpsert();
    } catch (err: any) {
      if (/no such table|no such column/i.test(String(err?.message || ''))) {
        await ensurePromotionAndTagTables(db, true);
        await runTagPkgUpsert().catch(() => {});
      }
    }
  }

  const delta: PromoRowDelta = {
    tagMap,
    items: Array.from(discoveredByKey.values())
  };

  await writeEdgeCacheJson(syncCacheKey, delta, 300);
  return delta;
}

/**
 * Overlays synced promotional tag stamps and any brand-new ContentDB submissions onto the catalog array.
 */
export function overlayPromotionRowDeltaOnCatalog(
  packagesList: any[],
  delta: PromoRowDelta | null,
  blockedIds?: Set<string>
): any[] {
  if (!Array.isArray(packagesList) || !delta) return packagesList;
  const tagMapEntries = Object.entries(delta.tagMap || {});
  const items = Array.isArray(delta.items) ? delta.items : [];
  if (tagMapEntries.length === 0 && items.length === 0) return packagesList;

  let result: any[] | null = null;
  const indexByLowerId = new Map<string, number>();
  for (let i = 0; i < packagesList.length; i++) {
    const pkg = packagesList[i];
    const id = String(pkg?.id || (pkg?.author && pkg?.name ? `${pkg.author}/${pkg.name}` : '')).toLowerCase();
    if (id) indexByLowerId.set(id, i);
  }

  // 1. Stamp promotional tags onto existing catalog items (cloning lazily only if a tag is missing)
  for (const [lowerId, tagsToAdd] of tagMapEntries) {
    const idx = indexByLowerId.get(lowerId);
    if (idx === undefined || !Array.isArray(tagsToAdd) || tagsToAdd.length === 0) continue;
    const existingPkg = (result || packagesList)[idx];
    const existingTags: string[] = Array.isArray(existingPkg.tags) ? existingPkg.tags : [];
    let currentTags: string[] | null = null;
    for (const t of tagsToAdd) {
      if (t && !existingTags.some((ct) => String(ct).toLowerCase() === t.toLowerCase())) {
        if (!currentTags) currentTags = [...existingTags];
        if (!currentTags.some((ct) => String(ct).toLowerCase() === t.toLowerCase())) {
          currentTags.push(t);
        }
      }
    }
    if (currentTags) {
      if (!result) result = [...packagesList];
      result[idx] = {
        ...existingPkg,
        tags: currentTags
      };
    }
  }

  // 2. Inject brand-new ContentDB submissions that arrived after the 30-min catalog bundle was built
  const baseList = result || packagesList;
  const appendedNew: any[] = [];
  for (const item of items) {
    if (!item?.author || !item?.name) continue;
    const canonicalId = `${item.author}/${item.name}`;
    const lowerId = canonicalId.toLowerCase();
    if (blockedIds?.has(lowerId) || indexByLowerId.has(lowerId)) continue;

    const itemTags = Array.from(
      new Set([
        ...(Array.isArray(item.tags)
          ? item.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || '')).filter(Boolean)
          : []),
        ...(delta.tagMap[lowerId] || []),
        item.type || 'mod'
      ])
    ).filter(Boolean);

    const shortDesc = item.short_desc || item.short_description || '';
    const thumb = sanitizePackageImageUrl(item.thumbnail) || null;
    const banner = sanitizePackageImageUrl(item.banner) || thumb;
    const relEpochMs = Number(item.release) > 100000000 ? Number(item.release) * 1000 : Date.now();
    const isoDate = new Date(relEpochMs).toISOString();

    const newCatalogItem = {
      ...item,
      id: canonicalId,
      author: item.author,
      name: item.name,
      title: item.title || item.name,
      type: item.type === 'modpack' ? 'mod' : (item.type || 'mod'),
      short_desc: shortDesc,
      short_description: shortDesc,
      release: Number(item.release) || 1,
      thumbnail: thumb,
      banner,
      tags: itemTags,
      downloads: Number(item.downloads || 0),
      contentdb_downloads: Number(item.downloads || 0),
      luantihub_downloads: 0,
      score: computeCatalogStarRating(item),
      contentdb_score: Number(item.score || 0),
      min_minetest_version: item.min_minetest_version || '5.0.0',
      created_at: item.created_at || isoDate,
      updated_at: item.updated_at || isoDate,
      provider: 'contentdb',
      source: 'official',
      sources: ['official']
    };
    indexByLowerId.set(lowerId, baseList.length + appendedNew.length);
    appendedNew.push(newCatalogItem);
  }

  return appendedNew.length > 0 ? [...appendedNew, ...baseList] : baseList;
}

function computeCatalogStarRating(item: any, d1StarAvg?: number): number {
  return computeStarRatingFromData(item, 0, d1StarAvg);
}

interface PackageVelocityMetrics {
  todayDl: number;
  weekDl: number;
  todayIntentDl: number;
  weekIntentDl: number;
  todayViews: number;
  weekViews: number;
  conversionRate: number;
  dependencyRatio: number;
}

function buildTop10FromCatalog(
  mergedCatalog: any[],
  telemetryMap: Map<string, PackageVelocityMetrics>,
  favoritesMap: Map<string, number>,
  timeframe: 'today' | 'week'
): any[] {
  const activeCatalog = mergedCatalog.filter(item => !isPackageDeprecated(item));
  const catalogByLowerId = new Map<string, any>();
  for (const item of activeCatalog) {
    if (item?.id) {
      catalogByLowerId.set(String(item.id).toLowerCase(), item);
    }
  }

  const authorCounts = new Map<string, number>();
  const canTakeAuthor = (author?: string, maxPerAuthor = 2): boolean => {
    const key = String(author || '').trim().toLowerCase();
    if (!key) return true;
    return (authorCounts.get(key) || 0) < maxPerAuthor;
  };
  const markAuthor = (author?: string): void => {
    const key = String(author || '').trim().toLowerCase();
    if (key) {
      authorCounts.set(key, (authorCounts.get(key) || 0) + 1);
    }
  };

  const top10: any[] = [];
  const deferredSameAuthor: any[] = [];
  const deferredDependencyOnly: any[] = [];
  const nowMs = Date.now();

  const scoredTelemetry: Array<{
    lowerId: string;
    item: any;
    periodDl: number;
    compositeScore: number;
    isPureDep: boolean;
  }> = [];
  for (const [lowerId, m] of telemetryMap.entries()) {
    const match = catalogByLowerId.get(lowerId);
    if (!match) continue;
    const periodDl = timeframe === 'today' ? m.todayDl : m.weekDl;
    const periodIntentDl = timeframe === 'today' ? m.todayIntentDl : m.weekIntentDl;
    const periodViews = timeframe === 'today' ? m.todayViews : m.weekViews;
    if (periodDl <= 0 && periodViews <= 0) continue;

    const depMultiplier = computeDependencyPrioritizationMultiplier(
      match,
      m.dependencyRatio,
      match.reverse_dep_count
    );
    const isPureDep = isPrimarilyDependencyPackage(
      match,
      m.dependencyRatio,
      match.reverse_dep_count
    );

    const favs = favoritesMap.get(lowerId) || Number(match.favorites_count || 0);
    const starMultiplier = match.score >= 1 ? 0.85 + (Number(match.score) / 5) * 0.35 : 1.0;
    let freshnessBonus = 0;
    if (match.updated_at) {
      const updatedMs = Date.parse(String(match.updated_at)) || 0;
      if (updatedMs > 0 && nowMs - updatedMs <= 14 * 86400000) {
        freshnessBonus = timeframe === 'today' ? 1.5 : 1.0;
      }
    }

    const compositeScore =
      (periodIntentDl * (1 + m.conversionRate * 0.5) +
        periodViews * 0.18 +
        Math.min(6, favs * 0.6) +
        freshnessBonus) *
      starMultiplier *
      depMultiplier;

    if (compositeScore > 0) {
      scoredTelemetry.push({ lowerId, item: match, periodDl, compositeScore, isPureDep });
    }
  }

  scoredTelemetry.sort((a, b) => b.compositeScore - a.compositeScore || b.periodDl - a.periodDl);

  for (const entry of scoredTelemetry) {
    if (top10.length >= 10) break;
    const enrichedItem = {
      ...entry.item,
      downloads: Math.max(Number(entry.item.downloads || 0), entry.periodDl)
    };
    if (entry.isPureDep) {
      deferredDependencyOnly.push(enrichedItem);
      continue;
    }
    if (!canTakeAuthor(enrichedItem.author, 2)) {
      deferredSameAuthor.push(enrichedItem);
      continue;
    }
    markAuthor(enrichedItem.author);
    top10.push(enrichedItem);
  }

  if (top10.length < 10) {
    const remaining = [...activeCatalog].sort((a, b) => {
      const favA = favoritesMap.get(String(a.id || '').toLowerCase()) || 0;
      const favB = favoritesMap.get(String(b.id || '').toLowerCase()) || 0;
      const convA = Number(a.conversion_rate || 0);
      const convB = Number(b.conversion_rate || 0);
      const depMultA = computeDependencyPrioritizationMultiplier(
        a,
        a.dependency_ratio,
        a.reverse_dep_count
      );
      const depMultB = computeDependencyPrioritizationMultiplier(
        b,
        b.dependency_ratio,
        b.reverse_dep_count
      );
      if (timeframe === 'today') {
        const updA = Date.parse(String(a.updated_at || '')) || 0;
        const updB = Date.parse(String(b.updated_at || '')) || 0;
        const recencyA = updA > 0 && nowMs - updA <= 30 * 86400000 ? 180 : 0;
        const recencyB = updB > 0 && nowMs - updB <= 30 * 86400000 ? 180 : 0;
        const scoreA =
          ((Number(a.contentdb_score ?? a.score) || 0) * 10 +
            Math.log10((Number(a.downloads) || 1) + 1) * 50 +
            convA * 120 +
            favA * 25 +
            recencyA) *
          depMultA;
        const scoreB =
          ((Number(b.contentdb_score ?? b.score) || 0) * 10 +
            Math.log10((Number(b.downloads) || 1) + 1) * 50 +
            convB * 120 +
            favB * 25 +
            recencyB) *
          depMultB;
        return scoreB - scoreA;
      }
      const scoreA =
        ((Number(a.downloads) || 0) * (1 + convA * 0.25) +
          (Number(a.contentdb_score) || 0) * 3 +
          favA * 150) *
        depMultA;
      const scoreB =
        ((Number(b.downloads) || 0) * (1 + convB * 0.25) +
          (Number(b.contentdb_score) || 0) * 3 +
          favB * 150) *
        depMultB;
      return scoreB - scoreA;
    });

    for (const item of remaining) {
      if (top10.length >= 10) break;
      const lowerId = String(item.id || `${item.author}/${item.name}`).toLowerCase();
      if (top10.some(p => String(p.id).toLowerCase() === lowerId)) continue;
      if (isPrimarilyDependencyPackage(item, item.dependency_ratio, item.reverse_dep_count)) {
        deferredDependencyOnly.push(item);
        continue;
      }
      if (!canTakeAuthor(item.author, 2)) {
        deferredSameAuthor.push(item);
        continue;
      }
      markAuthor(item.author);
      top10.push(item);
    }
  }

  for (const fallback of [...deferredSameAuthor, ...deferredDependencyOnly]) {
    if (top10.length >= 10) break;
    const lowerId = String(fallback.id || `${fallback.author}/${fallback.name}`).toLowerCase();
    if (!top10.some(p => String(p.id).toLowerCase() === lowerId)) {
      top10.push(fallback);
    }
  }

  return top10;
}

const ALLOWED_IMAGE_PROXY_HOSTS = new Set([
  'content.luanti.org',
  'contentdb.milcho.org',
  'blog.luanti.org',
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
  'codeberg.org',
  'gitlab.com',
  'git.minetest.land',
  'mese.hub',
  'bitbucket.org',
  'api.bitbucket.org'
]);

const TRANSPARENT_FALLBACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"/>';

function detectImageMimeType(contentTypeHeader: string, bytes: Uint8Array): string | null {
  const ct = (contentTypeHeader || '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('text/html') || ct.startsWith('application/json') || ct.startsWith('text/plain')) {
    return null;
  }
  if (bytes.length >= 4) {
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif';
    }
    // WEBP: 52 49 46 46 ... 57 45 42 50
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    // Reject HTML documents masquerading as binary/image
    if (bytes[0] === 0x3c && ct !== 'image/svg+xml') {
      return null;
    }
  }
  if (ct.startsWith('image/')) {
    return ct;
  }
  return null;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);

  const proxyImageRaw = (url.searchParams.get('proxy_image') || '').trim();
  if (proxyImageRaw) {
    try {
      const targetUrl = new URL(proxyImageRaw);
      if (
        targetUrl.protocol !== 'https:' ||
        !ALLOWED_IMAGE_PROXY_HOSTS.has(targetUrl.hostname.toLowerCase())
      ) {
        return new Response('Forbidden image host', { status: 403 });
      }
      const proxyCacheKey = `https://cache.luantihub.internal/__proxy_git_img_v4/${encodeURIComponent(targetUrl.toString())}`;
      const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;
      const proxyCacheReq = edgeCache ? new Request(proxyCacheKey, { method: 'GET' }) : null;
      if (edgeCache && proxyCacheReq) {
        try {
          const cachedImgRes = await edgeCache.match(proxyCacheReq);
          if (cachedImgRes) {
            return cachedImgRes;
          }
        } catch {
          // Non-fatal edge cache read error
        }
      }

      const candidateUrls: string[] = [targetUrl.toString()];
      const giteaRawMatch = targetUrl.pathname.match(
        /^\/([^/]+)\/([^/]+)\/raw\/branch\/([^/]+)\/(.+)$/i
      );
      if (giteaRawMatch) {
        const [, owner, repo, branch, filePath] = giteaRawMatch;
        candidateUrls.push(
          `https://${targetUrl.host}/api/v1/repos/${owner}/${repo}/raw/${filePath}?ref=${encodeURIComponent(branch)}`,
          `https://${targetUrl.host}/api/v1/repos/${owner}/${repo}/raw/${filePath}`
        );
      } else {
        const giteaApiRawMatch = targetUrl.pathname.match(
          /^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/raw\/(.+)$/i
        );
        if (giteaApiRawMatch) {
          const [, owner, repo, filePath] = giteaApiRawMatch;
          candidateUrls.push(
            `https://${targetUrl.host}/${owner}/${repo}/raw/branch/main/${filePath}`,
            `https://${targetUrl.host}/${owner}/${repo}/raw/branch/master/${filePath}`
          );
        }
      }

      for (const candUrl of candidateUrls) {
        const upstreamRes = await fetchWithAnubisSupport(candUrl, {
          headers: {
            'Accept': 'image/png,image/jpeg,image/webp,image/*;q=0.8',
            'User-Agent': 'LuantiHub-NotificationImageProxy/1.0 (+https://luantihub.org)'
          }
        });
        if (!upstreamRes.ok) {
          continue;
        }
        const rawContentType = upstreamRes.headers.get('content-type') || '';
        const body = await upstreamRes.arrayBuffer();
        const resolvedMime = detectImageMimeType(rawContentType, new Uint8Array(body));
        if (!resolvedMime) {
          continue;
        }
        const okRes = new Response(body, {
          status: 200,
          headers: {
            'Content-Type': resolvedMime,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800'
          }
        });
        if (edgeCache && proxyCacheReq) {
          await edgeCache.put(proxyCacheReq, okRes.clone()).catch(() => {});
        }
        return okRes;
      }
      return new Response('Upstream image not found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'X-Proxy-Fallback': 'non-image-upstream'
        }
      });
    } catch {
      return new Response('Invalid image URL', { status: 400 });
    }
  }

  const q = (url.searchParams.get('q') || '').trim();
  const types = url.searchParams
    .getAll('type')
    .map(t => t.trim().toLowerCase())
    .filter(t => Boolean(t) && t !== 'all');
  const author = (url.searchParams.get('author') || '').trim();
  const isBootBundle = url.searchParams.get('boot') === '1';
  const requestedNoCache = url.searchParams.get('nocache') === '1';
  let noCache = false;
  if (requestedNoCache) {
    const cookies = parseCookies(request);
    const sessionUserId = cookies['lh_session']
      ? await verifySessionToken(cookies['lh_session'], env.SESSION_SECRET)
      : null;
    const now = Date.now();
    if (sessionUserId && now - lastCatalogNoCacheAt > 60_000) {
      noCache = true;
      lastCatalogNoCacheAt = now;
    }
  }
  const requestedFmt = (url.searchParams.get('fmt') || '').trim().toLowerCase();
  const protocolVersion = (url.searchParams.get('protocol_version') || '').trim();

  const sortedUniqueTypes = Array.from(new Set(types)).sort();
  const isAllStandardTypes =
    sortedUniqueTypes.length === 0 ||
    (sortedUniqueTypes.includes('mod') && sortedUniqueTypes.includes('game') && sortedUniqueTypes.includes('txp'));

  const upstreamParams = new URLSearchParams(url.searchParams);
  upstreamParams.delete('boot');
  upstreamParams.delete('nocache');
  // Always request `fmt=vcs` from upstream ContentDB so fetchUpstreamJsonCached receives a JSON array
  upstreamParams.set('fmt', 'vcs');
  const upstreamQuery = upstreamParams.toString();
  // Reuse the canonical `/packages/?fmt=vcs` upstream cache when fetching the full catalog across all types
  const upstreamPath = (!q && !author && isAllStandardTypes)
    ? '/packages/?fmt=vcs'
    : `/packages/${upstreamQuery ? `?${upstreamQuery}` : ''}`;

  const bootEdgeCacheKey = 'https://cache.luantihub.internal/__api_boot_catalog_bundle_v18';
  const normalizedCatalogKey = `q=${q.toLowerCase()}&a=${author.toLowerCase()}&t=${sortedUniqueTypes.join(',')}&p=${protocolVersion}&fmt=${requestedFmt}`;
  const catalogEdgeCacheKey = isBootBundle
    ? (!q && types.length === 0 && !author ? bootEdgeCacheKey : null)
    : `https://cache.luantihub.internal/__catalog_edge_v9_${encodeURIComponent(normalizedCatalogKey)}`;

  if (catalogEdgeCacheKey && !noCache) {
    const cachedCatalog = await readEdgeCacheJson<any>(catalogEdgeCacheKey);
    if (
      cachedCatalog &&
      (Array.isArray(cachedCatalog) ||
        Array.isArray(cachedCatalog.keys) ||
        (Array.isArray(cachedCatalog.packages) && cachedCatalog.packages.length > 0))
    ) {
      let edgeBody = cachedCatalog;
      if (isBootBundle) {
        const nowMs = Date.now();
        const [cachedActivePromos, sharedRatings] = await Promise.all([
          readEdgeCacheJson<any[]>('/__active_promotions_v1'),
          readSharedEdgeRatingsMap()
        ]);
        const rawPromos =
          Array.isArray(cachedActivePromos)
            ? cachedActivePromos
            : Array.isArray(cachedCatalog.promotions) && cachedCatalog.promotions.length > 0
              ? cachedCatalog.promotions
              : getLastKnownActivePromotions(nowMs);
        let overlaidPackages = Array.isArray(cachedCatalog.packages) ? cachedCatalog.packages : [];
        if (Array.isArray(rawPromos)) {
          const validEdgePromos = rawPromos
            .filter((r: any) => isValidActivePromotionRow(r, nowMs))
            .map((r: any) => normalizePromotionRow(r));
          const promoDelta = await syncActivePromotionRowPackages(validEdgePromos, env.DB, false);
          if (promoDelta && overlaidPackages.length > 0) {
            overlaidPackages = overlayPromotionRowDeltaOnCatalog(overlaidPackages, promoDelta);
          }
          edgeBody = {
            ...cachedCatalog,
            packages: overlaidPackages,
            promotions: validEdgePromos
          };
        }
        if (sharedRatings && Object.keys(sharedRatings).length > 0 && Array.isArray(edgeBody.packages)) {
          const applySharedRating = (pkg: any) => {
            if (!pkg?.id) return pkg;
            const entry = sharedRatings[String(pkg.id).toLowerCase()];
            if (!entry) return pkg;
            const nextScore = entry.score > 0 && !(pkg.score > 0) ? entry.score : pkg.score;
            const nextCounts = entry.review_thread_counts && !pkg.review_thread_counts
              ? entry.review_thread_counts
              : pkg.review_thread_counts;
            if (nextScore !== pkg.score || nextCounts !== pkg.review_thread_counts) {
              return {
                ...pkg,
                score: nextScore,
                ...(nextCounts ? { review_thread_counts: nextCounts, rating_checked: true } : {})
              };
            }
            return pkg;
          };
          edgeBody = {
            ...edgeBody,
            packages: edgeBody.packages.map(applySharedRating),
            ...(Array.isArray(edgeBody.recentlyAdded)
              ? { recentlyAdded: edgeBody.recentlyAdded.map(applySharedRating) }
              : {}),
            ...(Array.isArray(edgeBody.top10Today)
              ? { top10Today: edgeBody.top10Today.map(applySharedRating) }
              : {}),
            ...(Array.isArray(edgeBody.top10Week)
              ? { top10Week: edgeBody.top10Week.map(applySharedRating) }
              : {})
          };
        }
      }
      return new Response(JSON.stringify(edgeBody), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isBootBundle
            ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600'
            : 'public, max-age=120, s-maxage=900, stale-while-revalidate=1800',
          'X-LuantiHub-Cache': 'HIT-EDGE'
        }
      });
    }
  }

  // 1. Fetch Upstream Packages + Bulk Scores/Downloads + Newest ContentDB Packages (with Cloudflare Edge Cache + mirror failover)
  const upstreamPromise = fetchUpstreamJsonCached<any[]>(upstreamPath, 300)
    .then(list => Array.isArray(list) ? list : [])
    .catch(() => []);

  const scoresPromise = fetchUpstreamJsonCached<any[]>('/scores/', 900)
    .then(list => Array.isArray(list) ? list : [])
    .catch(() => []);

  const recentUpstreamPromise = isBootBundle
    ? fetchUpstreamJsonCached<any[]>('/packages/?sort=approved_at&order=desc&limit=24&fmt=vcs', 900)
        .then(list => Array.isArray(list) ? list : [])
        .catch(() => [])
    : Promise.resolve<any[]>([]);

  const tagsPromise = isBootBundle
    ? getUnifiedCatalogTags(env.DB).catch(() => DEFAULT_CONTENTDB_TAGS)
    : Promise.resolve<Array<{ name: string; title: string }> | null>(null);

  const blogPostPromise = isBootBundle
    ? fetchLatestLuantiBlogPost().catch(() => null)
    : Promise.resolve(null);

  // 2. Fetch Decentralized Packages, Review Star Averages, AND Kill-Switch Blacklist from Cloudflare D1
  let d1Promise = Promise.resolve<any[]>([]);
  let blockedPromise = Promise.resolve<Set<string>>(new Set());
  let reviewRatingsPromise = Promise.resolve<Map<string, number>>(new Map());
  let lhDownloadsMapPromise = Promise.resolve<Map<string, number>>(new Map());
  let favoritesMapPromise = Promise.resolve<Map<string, number>>(new Map());
  let velocityPromise = Promise.resolve<Map<string, PackageVelocityMetrics>>(new Map());
  let promotionsPromise = Promise.resolve<any[] | undefined>(undefined);
  let recentReviewsPromise = Promise.resolve<any[]>([]);
  let authorDisplayMapPromise = Promise.resolve<{
    byUserId: Map<string, string>;
    byHandle: Map<string, { userId: string; displayName: string }>;
  }>({
    byUserId: new Map(),
    byHandle: new Map()
  });

  if (env.DB) {
    // One-time automatic purge of legacy unowned mirrored ContentDB rows & dead mirror screenshot/review artifacts
    const cleanupKey = 'https://cache.luantihub.internal/__d1_contentdb_mirror_cleanup_v2';
    readEdgeCacheJson<boolean>(cleanupKey)
      .then(async (done) => {
        if (done) return;
        await writeEdgeCacheJson(cleanupKey, true, 86400 * 30);
        await env.DB.prepare(
          `DELETE FROM packages WHERE provider = 'contentdb' AND author_id IS NULL AND COALESCE(luantihub_downloads, 0) = 0 AND status = 'active'`
        ).run().catch(() => {});
        await env.DB.prepare(
          `DELETE FROM releases WHERE package_id NOT IN (SELECT id FROM packages)`
        ).run().catch(() => {});
        await env.DB.prepare(`
          UPDATE packages
          SET thumbnail_url = CASE
                WHEN thumbnail_url LIKE '%/storage/screenshots/%' OR thumbnail_url LIKE '%/shot-0.png' THEN NULL
                ELSE thumbnail_url
              END,
              banner_url = CASE
                WHEN banner_url LIKE '%/storage/screenshots/%' OR banner_url LIKE '%/shot-0.png' THEN NULL
                ELSE banner_url
              END,
              screenshots = CASE
                WHEN screenshots LIKE '%/storage/screenshots/%' THEN NULL
                ELSE screenshots
              END,
              review_thread_counts = CASE
                WHEN review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN NULL
                ELSE review_thread_counts
              END
          WHERE thumbnail_url LIKE '%/storage/screenshots/%'
             OR thumbnail_url LIKE '%/shot-0.png'
             OR banner_url LIKE '%/storage/screenshots/%'
             OR banner_url LIKE '%/shot-0.png'
             OR screenshots LIKE '%/storage/screenshots/%'
             OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}'
        `).run().catch(() => {});
      })
      .catch(() => {});

    let query = `SELECT * FROM packages WHERE status = 'active' AND (provider != 'contentdb' OR author_id IS NOT NULL OR COALESCE(luantihub_downloads, 0) > 0)`;
    const params: any[] = [];

    if (types.length === 1) {
      query += ` AND type = ?`;
      params.push(types[0]);
    } else if (types.length > 1) {
      const placeholders = types.map(() => '?').join(', ');
      query += ` AND type IN (${placeholders})`;
      params.push(...types);
    }
    if (q) {
      query += ` AND (title LIKE ? OR name LIKE ? OR short_desc LIKE ? OR author_name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (author) {
      query += ` AND LOWER(author_name) = LOWER(?)`;
      params.push(author);
    }

    query += ` ORDER BY downloads_count DESC LIMIT 1000`;

    d1Promise = env.DB.prepare(query).bind(...params).all()
      .then((res: any) => res.results || [])
      .catch(() => []);

    // Instant Kill Switch: fetch any package IDs marked as 'flagged' or 'delisted'
    blockedPromise = env.DB.prepare(
      `SELECT LOWER(id) as id FROM packages WHERE status IN ('flagged', 'delisted')`
    ).all()
      .then((res: any) => new Set<string>((res.results || []).map((r: any) => String(r.id).toLowerCase())))
      .catch(() => new Set<string>());

    // Real Star Review Averages from Cloudflare D1 `reviews` table
    reviewRatingsPromise = env.DB.prepare(
      `SELECT LOWER(package_id) as pkg_id, AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews GROUP BY LOWER(package_id)`
    ).all()
      .then((res: any) => {
        const map = new Map<string, number>();
        for (const r of (res.results || [])) {
          if (r && r.pkg_id && Number(r.cnt) > 0 && r.avg_rating != null) {
            map.set(String(r.pkg_id).toLowerCase(), Number(Number(r.avg_rating).toFixed(1)));
          }
        }
        return map;
      })
      .catch(() => new Map<string, number>());

    // Avoid scanning all historical package_daily_downloads rows on every catalog build;
    // packages.luantihub_downloads already tracks all-time LuantiHub downloads, and velocityPromise covers the 7-day window.
    lhDownloadsMapPromise = Promise.resolve(new Map<string, number>());

    // Community Favorites count per package from `user_favorites`
    favoritesMapPromise = env.DB.prepare(
      `SELECT LOWER(package_id) as pkg_id, COUNT(*) as fav_cnt FROM user_favorites GROUP BY LOWER(package_id)`
    ).all()
      .then((res: any) => {
        const map = new Map<string, number>();
        for (const r of (res.results || [])) {
          if (r?.pkg_id && Number(r.fav_cnt) > 0) {
            map.set(String(r.pkg_id).toLowerCase(), Number(r.fav_cnt));
          }
        }
        return map;
      })
      .catch(() => new Map<string, number>());

    // Registered Creator Display Names & Linked Identities from `users` / `user_identities`
    authorDisplayMapPromise = env.DB.prepare(`
      SELECT u.id AS user_id, u.username, u.display_name, ui.provider_username, ui.verified
      FROM users u
      LEFT JOIN user_identities ui ON ui.user_id = u.id
      WHERE u.display_name IS NOT NULL AND TRIM(u.display_name) != ''
    `).all()
      .then((res: any) => {
        const byUserId = new Map<string, string>();
        const byHandle = new Map<string, { userId: string; displayName: string }>();
        for (const row of (res.results || [])) {
          const userId = String(row?.user_id || '').trim();
          const displayName = String(row?.display_name || '').trim();
          if (!userId || !displayName) continue;
          byUserId.set(userId, displayName);
          const uname = String(row?.username || '').trim().toLowerCase();
          if (uname) {
            byHandle.set(uname, { userId, displayName });
          }
          const displayLower = displayName.toLowerCase();
          if (displayLower && !byHandle.has(displayLower)) {
            byHandle.set(displayLower, { userId, displayName });
          }
          if (row?.verified && row?.provider_username) {
            const provHandle = String(row.provider_username).trim().toLowerCase();
            if (provHandle) {
              byHandle.set(provHandle, { userId, displayName });
            }
          }
        }
        return { byUserId, byHandle };
      })
      .catch(() => ({
        byUserId: new Map<string, string>(),
        byHandle: new Map<string, { userId: string; displayName: string }>()
      }));

    if (isBootBundle) {
      velocityPromise = env.DB.prepare(`
        SELECT
          LOWER(package_id) as pkg_id,
          SUM(CASE WHEN download_date = DATE('now') THEN downloads_count ELSE 0 END) as today_dl,
          SUM(CASE WHEN download_date >= DATE('now', '-7 days') THEN downloads_count ELSE 0 END) as week_dl,
          SUM(CASE WHEN download_date = DATE('now') THEN COALESCE(reason_new, 0) ELSE 0 END) as today_new,
          SUM(CASE WHEN download_date = DATE('now') THEN COALESCE(reason_web, 0) ELSE 0 END) as today_web,
          SUM(CASE WHEN download_date = DATE('now') THEN COALESCE(reason_update, 0) ELSE 0 END) as today_upd,
          SUM(CASE WHEN download_date = DATE('now') THEN COALESCE(reason_dependency, 0) ELSE 0 END) as today_dep,
          SUM(CASE WHEN download_date >= DATE('now', '-7 days') THEN COALESCE(reason_new, 0) ELSE 0 END) as week_new,
          SUM(CASE WHEN download_date >= DATE('now', '-7 days') THEN COALESCE(reason_web, 0) ELSE 0 END) as week_web,
          SUM(CASE WHEN download_date >= DATE('now', '-7 days') THEN COALESCE(reason_update, 0) ELSE 0 END) as week_upd,
          SUM(CASE WHEN download_date >= DATE('now', '-7 days') THEN COALESCE(reason_dependency, 0) ELSE 0 END) as week_dep,
          SUM(COALESCE(reason_new, 0) + COALESCE(reason_web, 0) + COALESCE(reason_update, 0) + COALESCE(reason_dependency, 0)) as month_reason_total,
          SUM(COALESCE(reason_dependency, 0)) as month_dep,
          SUM(CASE WHEN download_date = DATE('now') THEN COALESCE(views_luanti, 0) + COALESCE(views_web, 0) ELSE 0 END) as today_views,
          SUM(CASE WHEN download_date >= DATE('now', '-7 days') THEN COALESCE(views_luanti, 0) + COALESCE(views_web, 0) ELSE 0 END) as week_views
        FROM package_daily_downloads
        WHERE download_date >= DATE('now', '-30 days')
        GROUP BY LOWER(package_id)
      `).all()
        .then((res: any) => {
          const map = new Map<string, PackageVelocityMetrics>();
          for (const row of (res.results || [])) {
            if (!row?.pkg_id) continue;
            const k = String(row.pkg_id).toLowerCase();
            const todayDl = Number(row.today_dl) || 0;
            const weekDl = Number(row.week_dl) || 0;
            const todayReasonSum =
              (Number(row.today_new) || 0) +
              (Number(row.today_web) || 0) +
              (Number(row.today_upd) || 0) +
              (Number(row.today_dep) || 0);
            const weekReasonSum =
              (Number(row.week_new) || 0) +
              (Number(row.week_web) || 0) +
              (Number(row.week_upd) || 0) +
              (Number(row.week_dep) || 0);
            const monthReasonTotal = Number(row.month_reason_total) || weekReasonSum || todayReasonSum || 0;
            const monthDep = Number(row.month_dep) || Number(row.week_dep) || Number(row.today_dep) || 0;
            const dependencyRatio =
              monthReasonTotal > 0 ? Number(Math.min(1, Math.max(0, monthDep / monthReasonTotal)).toFixed(3)) : 0;
            const depWeight = dependencyRatio >= 0.65 ? 0 : 0.02;
            const todayIntentDl =
              todayReasonSum > 0
                ? (Number(row.today_new) || 0) * 1.0 +
                  (Number(row.today_web) || 0) * 1.0 +
                  (Number(row.today_upd) || 0) * 0.6 +
                  (Number(row.today_dep) || 0) * depWeight
                : todayDl * (1 - dependencyRatio * 0.85);
            const weekIntentDl =
              weekReasonSum > 0
                ? (Number(row.week_new) || 0) * 1.0 +
                  (Number(row.week_web) || 0) * 1.0 +
                  (Number(row.week_upd) || 0) * 0.6 +
                  (Number(row.week_dep) || 0) * depWeight
                : weekDl * (1 - dependencyRatio * 0.85);
            const todayViews = Number(row.today_views) || 0;
            const weekViews = Number(row.week_views) || 0;
            const conversionRate = Number(
              Math.min(1.0, (weekIntentDl + 1.5) / (Math.max(weekIntentDl, weekViews) + 10)).toFixed(3)
            );
            map.set(k, {
              todayDl,
              weekDl,
              todayIntentDl,
              weekIntentDl,
              todayViews,
              weekViews,
              conversionRate,
              dependencyRatio
            });
          }
          return map;
        })
        .catch(() => new Map<string, PackageVelocityMetrics>());

      promotionsPromise = (async () => {
        const filterValidPromos = (rows: any[]) => {
          const nowMs = Date.now();
          return rows
            .filter((r: any) => isValidActivePromotionRow(r, nowMs))
            .map((r: any) => normalizePromotionRow(r));
        };

        if (!noCache) {
          const cachedPromos = await readEdgeCacheJson<any[]>('/__active_promotions_v1');
          if (Array.isArray(cachedPromos)) {
            const validCached = filterValidPromos(cachedPromos);
            setLastKnownActivePromotions(validCached);
            return validCached;
          }
        }

        try {
          const res = await env.DB.prepare(
            `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 20`
          ).all();
          const validRows = filterValidPromos(res?.results || []);
          setLastKnownActivePromotions(validRows);
          await writeEdgeCacheJson('/__active_promotions_v1', validRows, 21600);
          return validRows;
        } catch {
          const fallback = getLastKnownActivePromotions();
          return Array.isArray(fallback) ? fallback : undefined;
        }
      })();

      recentReviewsPromise = env.DB.prepare(`
        SELECT
          r.id,
          r.package_id,
          r.rating,
          r.title,
          r.comment,
          r.created_at,
          u.username AS reviewer_username,
          u.display_name AS reviewer_display_name,
          p.title AS package_title,
          p.type AS package_type,
          p.thumbnail_url AS package_thumbnail
        FROM reviews r
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN packages p ON LOWER(p.id) = LOWER(r.package_id)
        WHERE COALESCE(p.status, 'active') = 'active'
          AND r.created_at >= datetime('now', '-2 days')
        ORDER BY r.created_at DESC
        LIMIT 10
      `).all()
        .then((res: any) => res?.results || [])
        .catch(() => []);
    }
  }

  const [
    upstreamList,
    recentUpstreamList,
    scoresList,
    d1List,
    blockedIds,
    d1Ratings,
    lhDownloadsMap,
    favoritesMap,
    rawTags,
    velocity,
    activePromotions,
    latestBlogPost,
    recentReviews,
    authorDisplayMap
  ] = await Promise.all([
    upstreamPromise,
    recentUpstreamPromise,
    scoresPromise,
    d1Promise,
    blockedPromise,
    reviewRatingsPromise,
    lhDownloadsMapPromise,
    favoritesMapPromise,
    tagsPromise,
    velocityPromise,
    promotionsPromise,
    blogPostPromise,
    recentReviewsPromise,
    authorDisplayMapPromise
  ]);

  // Enrich upstreamList with bulk ContentDB /api/scores/ (exact downloads, score, and review counts for all 3,500+ packages in 1 call)
  if (Array.isArray(scoresList) && scoresList.length > 0) {
    const scoresMap = new Map<string, any>();
    for (const s of scoresList) {
      if (s?.author && s?.name) {
        scoresMap.set(`${s.author}/${s.name}`.toLowerCase(), s);
      }
    }
    for (const item of upstreamList) {
      if (!item?.author || !item?.name) continue;
      const s = scoresMap.get(`${item.author}/${item.name}`.toLowerCase());
      if (s) {
        if (typeof s.downloads === 'number') {
          item.downloads = s.downloads;
        }
        if (typeof s.score === 'number') {
          item.score = Math.round(s.score * 10) / 10;
        }
        if (s.reviews && typeof s.reviews === 'object') {
          item.reviews = s.reviews;
        }
      }
    }
  }

  // 3. Build upstream ContentDB index by ID, normalized repo URL, (baseAuthor + name + title), and unambiguous (baseAuthor + name + type) to prevent duplicates
  const upstreamById = new Map<string, any>();
  const upstreamByRepo = new Map<string, any>();
  const upstreamByNameTitle = new Map<string, any>();
  const upstreamByNameTypeCount = new Map<string, number>();
  const upstreamByNameType = new Map<string, any>();
  const upstreamCasingByBaseAuthor = new Map<string, string>();
  const normalizeBaseAuthor = (a: string) =>
    String(a || '').toLowerCase().replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');

  for (const item of upstreamList) {
    if (!item || !item.author || !item.name) continue;
    const uKey = `${item.author}/${item.name}`.toLowerCase();
    upstreamById.set(uKey, item);
    const rKey = normalizeRepoKey(item.repo || item.repo_url);
    if (rKey) upstreamByRepo.set(rKey, item);
    const baseAuthor = normalizeBaseAuthor(item.author);
    if (baseAuthor && !upstreamCasingByBaseAuthor.has(baseAuthor)) {
      upstreamCasingByBaseAuthor.set(baseAuthor, String(item.author));
    }
    const ntKey = `${baseAuthor}::${String(item.name).toLowerCase()}::${String(item.title || '').trim().toLowerCase()}`;
    upstreamByNameTitle.set(ntKey, item);
    const nameTypeKey = `${baseAuthor}::${String(item.name).toLowerCase()}::${String(item.type || 'mod').toLowerCase()}`;
    upstreamByNameTypeCount.set(nameTypeKey, (upstreamByNameTypeCount.get(nameTypeKey) || 0) + 1);
    upstreamByNameType.set(nameTypeKey, item);
  }

  const resolveAuthorMeta = (rawAuthorId: unknown, ...handles: Array<string | undefined | null>) => {
    const cleanId =
      rawAuthorId && !String(rawAuthorId).startsWith('ext_') ? String(rawAuthorId).trim() : '';
    let resolvedUserId = cleanId || undefined;
    let resolvedDisplayName = cleanId ? authorDisplayMap.byUserId.get(cleanId) : undefined;

    for (const h of handles) {
      const lower = String(h || '').trim().toLowerCase();
      if (!lower) continue;
      const match = authorDisplayMap.byHandle.get(lower);
      if (match) {
        if (!resolvedUserId && match.userId) resolvedUserId = match.userId;
        if (!resolvedDisplayName && match.displayName) resolvedDisplayName = match.displayName;
        if (resolvedUserId && resolvedDisplayName) break;
      }
    }

    if (!resolvedDisplayName) {
      for (const h of handles) {
        const raw = String(h || '').trim();
        if (!raw || !/[-_](?:hub|git|dev|lab|mods?)$/i.test(raw)) continue;
        const base = normalizeBaseAuthor(raw);
        if (!base) continue;
        const baseHandleMatch = authorDisplayMap.byHandle.get(base);
        if (baseHandleMatch?.displayName) {
          if (!resolvedUserId && baseHandleMatch.userId) resolvedUserId = baseHandleMatch.userId;
          resolvedDisplayName = baseHandleMatch.displayName;
          break;
        }
        const cdbAuthor = upstreamCasingByBaseAuthor.get(base);
        if (cdbAuthor) {
          resolvedDisplayName = cdbAuthor;
          break;
        }
      }
    }

    return {
      author_id: resolvedUserId,
      author_display_name: resolvedDisplayName
    };
  };

  // 4. Format D1 packages into standard ContentDB-compatible schema (merging with upstream ContentDB if present)
  const seenKeys = new Set<string>();
  const merged: any[] = [];

  for (const p of d1List) {
    const d1Key = `${p.author_name}/${p.name}`.toLowerCase();
    if (blockedIds.has(d1Key)) continue;

    const pRepoKey = normalizeRepoKey(p.repo_url);
    const pBaseAuthor = normalizeBaseAuthor(p.author_name);
    const pNameTitleKey = `${pBaseAuthor}::${String(p.name || '').toLowerCase()}::${String(p.title || '').trim().toLowerCase()}`;
    const pNameTypeKey = `${pBaseAuthor}::${String(p.name || '').toLowerCase()}::${String(p.type || 'mod').toLowerCase()}`;
    const matchedUpstream =
      upstreamById.get(d1Key) ||
      (pRepoKey ? upstreamByRepo.get(pRepoKey) : undefined) ||
      upstreamByNameTitle.get(pNameTitleKey) ||
      (upstreamByNameTypeCount.get(pNameTypeKey) === 1 ? upstreamByNameType.get(pNameTypeKey) : undefined);

    let canonicalAuthor = matchedUpstream?.author || p.author_name;
    let canonicalName = matchedUpstream?.name || p.name;
    const canonicalKey = `${canonicalAuthor}/${canonicalName}`.toLowerCase();
    if (blockedIds.has(canonicalKey) || seenKeys.has(canonicalKey)) continue;

    seenKeys.add(d1Key);
    seenKeys.add(canonicalKey);

    // Ensure strict Luanti client validation regex compliance (contentdb.lua:429-430)
    const aliases: string[] = Array.isArray(matchedUpstream?.aliases) ? [...matchedUpstream.aliases] : [];
    const safeName = String(canonicalName || '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'mod';
    if (safeName !== canonicalName) {
      aliases.push(`${canonicalAuthor}/${canonicalName}`);
      canonicalName = safeName;
    }
    if (p.author_name && p.author_name.toLowerCase() !== canonicalAuthor.toLowerCase()) {
      const aliasEntry = `${p.author_name}/${p.name}`;
      if (!aliases.includes(aliasEntry)) {
        aliases.push(aliasEntry);
      }
    }
    // Provide author variant aliases (e.g. sakel/x_mobs for sakel-hub/x_mobs) so Luanti matches mods with author = SaKeL
    if (canonicalAuthor.includes('-') || canonicalAuthor.includes('_')) {
      const baseAuthor = canonicalAuthor.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
      if (baseAuthor && baseAuthor.toLowerCase() !== canonicalAuthor.toLowerCase()) {
        const baseAlias = `${baseAuthor}/${canonicalName}`;
        if (!aliases.includes(baseAlias)) {
          aliases.push(baseAlias);
        }
      }
    }

    const parsedTags = parseJsonArray(p.tags);
    const rawProvider = String(p.provider || '').toLowerCase();
    const detectedRepoProvider =
      rawProvider !== 'contentdb' && p.repo_url
        ? detectGitProviderFromUrl(p.repo_url)?.provider
        : undefined;
    const isGitSource =
      isGitProviderId(rawProvider) ||
      isGitProviderId(detectedRepoProvider) ||
      parsedTags.includes('git');
    const isAlsoOfficial = Boolean(matchedUpstream) || rawProvider === 'contentdb' || parsedTags.includes('contentdb');

    const sources: Array<'official' | 'git'> = [];
    if (isAlsoOfficial) sources.push('official');
    if (isGitSource) sources.push('git');
    if (sources.length === 0) sources.push('official');

    const d1StarAvg = d1Ratings.get(canonicalKey) ?? d1Ratings.get(d1Key) ?? 0;
    const d1ReviewThreadCounts = parseNonZeroReviewThreadCounts(p.review_thread_counts);
    const effectiveReviewThreadCounts =
      parseNonZeroReviewThreadCounts(matchedUpstream?.reviews) ||
      parseNonZeroReviewThreadCounts(matchedUpstream?.review_thread_counts) ||
      d1ReviewThreadCounts;
    const upstreamTags = Array.isArray(matchedUpstream?.tags)
      ? matchedUpstream.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
      : [];
    const combinedTags = Array.from(new Set([...parsedTags, ...upstreamTags])).filter(Boolean);

    const parsedDeps = parseJsonArray(p.dependencies);
    const parsedOptDeps = parseJsonArray(p.optional_dependencies);

    const sanitizedD1Banner = sanitizePackageImageUrl(p.banner_url);
    const sanitizedD1Thumb = upgradeContentDbThumbnailUrl(p.thumbnail_url);
    const sanitizedUpstreamThumb = upgradeContentDbThumbnailUrl(matchedUpstream?.thumbnail);
    const gitShotD1 = isGitRepositoryAssetUrl(sanitizedD1Banner)
      ? sanitizedD1Banner
      : (isGitRepositoryAssetUrl(sanitizedD1Thumb) ? sanitizedD1Thumb : undefined);
    const mergedCatalogScreenshots = mergeScreenshotsPreferringGit(
      [gitShotD1, sanitizedD1Banner, sanitizedD1Thumb, sanitizedUpstreamThumb],
      parseJsonArray(p.screenshots).filter((s: string) => !isDeadMirrorScreenshotUrl(s)),
      matchedUpstream?.screenshots
    );
    const nonGitThumbCandidate =
      sanitizedUpstreamThumb ||
      (sanitizedD1Thumb && !isGitRepositoryAssetUrl(sanitizedD1Thumb)
        ? sanitizedD1Thumb
        : '') ||
      mergedCatalogScreenshots.find(s => !isGitRepositoryAssetUrl(s)) ||
      '';
    const formattedNonGitThumb = nonGitThumbCandidate
      ? (formatContentDbCdnUrl(nonGitThumbCandidate, 'tile') || nonGitThumbCandidate)
      : '';
    const rawThumbCandidate = formattedNonGitThumb || gitShotD1 || sanitizedD1Banner || '';
    const resolvedThumb = sanitizePackageImageUrl(rawThumbCandidate) || null;
    const resolvedBanner =
      selectSharpPackageBanner(
        gitShotD1,
        mergedCatalogScreenshots,
        sanitizedD1Banner,
        sanitizedUpstreamThumb,
        resolvedThumb
      ) || '';

    const cdbDownloads = Math.max(
      typeof matchedUpstream?.downloads === 'number' ? matchedUpstream.downloads : 0,
      typeof p.contentdb_downloads === 'number' ? p.contentdb_downloads : 0
    );
    const lhDownloads = Math.max(
      typeof p.luantihub_downloads === 'number' ? p.luantihub_downloads : 0,
      lhDownloadsMap.get(canonicalKey) ?? lhDownloadsMap.get(d1Key) ?? 0,
      !isAlsoOfficial && typeof p.downloads_count === 'number' ? p.downloads_count : 0
    );
    const combinedDownloads = Math.max(
      cdbDownloads + lhDownloads,
      typeof p.downloads_count === 'number' ? p.downloads_count : 0
    );
    const shortDescText = p.short_desc || matchedUpstream?.short_desc || matchedUpstream?.short_description || '';
    const releaseId =
      Number(matchedUpstream?.release) > 0
        ? Number(matchedUpstream.release)
        : Math.max(
            1,
            Math.floor(new Date(p.updated_at || p.created_at || '2026-01-01T00:00:00Z').getTime() / 1000) || 1
          );

    const authorMeta = resolveAuthorMeta(
      p.author_id,
      canonicalAuthor,
      p.author_name,
      matchedUpstream?.author
    );

    merged.push({
      ...(matchedUpstream || {}),
      id: `${canonicalAuthor}/${canonicalName}`,
      author: canonicalAuthor,
      ...(authorMeta.author_display_name ? { author_display_name: authorMeta.author_display_name } : {}),
      author_id: authorMeta.author_id,
      name: canonicalName,
      aliases: aliases.length > 0 ? aliases : undefined,
      title: matchedUpstream?.title || p.title || canonicalName,
      type: p.type === 'modpack' ? 'mod' : (p.type || matchedUpstream?.type || 'mod'),
      short_desc: shortDescText,
      short_description: shortDescText,
      release: releaseId,
      latest_commit_sha: p.latest_commit_sha || undefined,
      updated_at: isGitSource
        ? (p.updated_at || matchedUpstream?.updated_at || undefined)
        : (matchedUpstream?.updated_at || undefined),
      created_at: !isAlsoOfficial && isGitSource
        ? (p.created_at || undefined)
        : (matchedUpstream?.created_at || undefined),
      thumbnail: resolvedThumb,
      banner: resolvedBanner,
      screenshots: mergedCatalogScreenshots.length > 0 ? mergedCatalogScreenshots : undefined,
      review_thread_counts: effectiveReviewThreadCounts,
      score: computeCatalogStarRating(
        {
          ...(matchedUpstream || {}),
          review_thread_counts: effectiveReviewThreadCounts,
          score: p.score ?? matchedUpstream?.score
        },
        d1StarAvg
      ),
      contentdb_score: Number(matchedUpstream?.score || 0),
      contentdb_downloads: cdbDownloads,
      luantihub_downloads: lhDownloads,
      downloads: combinedDownloads,
      license: p.license || matchedUpstream?.license || '',
      media_license: p.media_license || matchedUpstream?.media_license || '',
      repo_url: p.repo_url || matchedUpstream?.repo || matchedUpstream?.repo_url || undefined,
      video_url: p.video_url || matchedUpstream?.video_url || undefined,
      video_thumbnail_url: p.video_thumbnail_url || matchedUpstream?.video_thumbnail_url || undefined,
      dev_state: p.dev_state || matchedUpstream?.dev_state || undefined,
      download_size: Number(p.download_size) > 0 ? Number(p.download_size) : undefined,
      file_size: p.file_size || undefined,
      provider: p.provider || (isGitSource ? 'github' : 'contentdb'),
      min_minetest_version: p.min_minetest_version || matchedUpstream?.min_minetest_version || '5.0.0',
      tags: combinedTags.length > 0 ? combinedTags : [p.type || 'mod'],
      dependencies: parsedDeps.length > 0 ? parsedDeps : matchedUpstream?.dependencies,
      optional_dependencies: parsedOptDeps.length > 0 ? parsedOptDeps : matchedUpstream?.optional_dependencies,
      daily_downloads: velocity.get(canonicalKey)?.todayDl ?? velocity.get(d1Key)?.todayDl,
      weekly_downloads: velocity.get(canonicalKey)?.weekDl ?? velocity.get(d1Key)?.weekDl,
      weekly_views: velocity.get(canonicalKey)?.weekViews ?? velocity.get(d1Key)?.weekViews,
      conversion_rate: velocity.get(canonicalKey)?.conversionRate ?? velocity.get(d1Key)?.conversionRate,
      dependency_ratio:
        (velocity.get(canonicalKey)?.dependencyRatio ?? velocity.get(d1Key)?.dependencyRatio) || undefined,
      rating_checked: Boolean(effectiveReviewThreadCounts || d1StarAvg > 0),
      favorites_count: favoritesMap.get(canonicalKey) ?? favoritesMap.get(d1Key),
      url: `/api/packages/${canonicalAuthor}/${canonicalName}/`,
      source: isGitSource ? 'git' : 'official',
      sources
    });
  }

  const sharedEdgeRatings = await readSharedEdgeRatingsMap().catch(() => ({} as Record<string, SharedEdgeRatingEntry>));

  // 5. Append Upstream ContentDB packages (excluding duplicates and D1 Kill-Switch delisted items)
  for (const item of upstreamList) {
    if (!item || !item.author || !item.name) continue;
    const key = `${item.author}/${item.name}`.toLowerCase();
    if (blockedIds.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const d1StarAvg = d1Ratings.get(key);
    const sharedRating = sharedEdgeRatings[key];
    const upstreamRevCounts =
      parseNonZeroReviewThreadCounts(item.reviews) ||
      parseNonZeroReviewThreadCounts(item.review_thread_counts) ||
      sharedRating?.review_thread_counts;
    const cdbDl = Number(item.downloads || 0);
    const vel = velocity.get(key);
    const lhDl = lhDownloadsMap.get(key) || vel?.weekDl || 0;
    const favCnt = favoritesMap.get(key);
    const computedScore = computeCatalogStarRating(
      { ...item, review_thread_counts: upstreamRevCounts },
      d1StarAvg
    );
    const resolvedScore = computedScore > 0 ? computedScore : (sharedRating?.score || 0);
    const sanitizedItemThumb = upgradeContentDbThumbnailUrl(item.thumbnail || item.thumbnail_url);
    const resolvedUpstreamBanner =
      selectSharpPackageBanner(
        undefined,
        item.screenshots,
        item.banner,
        item.banner_url,
        sanitizedItemThumb
      ) || sanitizedItemThumb;
    const upstreamAuthorMeta = resolveAuthorMeta(undefined, item.author);
    merged.push({
      ...item,
      id: `${item.author}/${item.name}`,
      ...(upstreamAuthorMeta.author_display_name
        ? { author_display_name: upstreamAuthorMeta.author_display_name }
        : {}),
      ...(upstreamAuthorMeta.author_id ? { author_id: upstreamAuthorMeta.author_id } : {}),
      ...(sanitizedItemThumb ? { thumbnail: sanitizedItemThumb } : {}),
      ...(resolvedUpstreamBanner ? { banner: resolvedUpstreamBanner } : {}),
      ...(upstreamRevCounts ? { review_thread_counts: upstreamRevCounts, rating_checked: true } : {}),
      score: resolvedScore,
      contentdb_score: Number(item.score || 0),
      contentdb_downloads: cdbDl,
      luantihub_downloads: lhDl,
      downloads: cdbDl + lhDl,
      daily_downloads: vel?.todayDl,
      weekly_downloads: vel?.weekDl,
      weekly_views: vel?.weekViews,
      conversion_rate: vel?.conversionRate,
      dependency_ratio: vel?.dependencyRatio || undefined,
      favorites_count: favCnt,
      min_minetest_version: item.min_minetest_version || '5.0.0',
      provider: 'contentdb',
      source: 'official',
      sources: ['official']
    });
  }

  // Compute reverse-dependency counts across the catalog for dependency-aware Home/Top 10 prioritization
  const reverseDepCountMap = buildReverseDependencyCountMap(merged);
  for (const pkg of merged) {
    const revCnt = reverseDepCountMap.get(String(pkg.name || '').trim().toLowerCase()) || 0;
    if (revCnt > 0) {
      pkg.reverse_dep_count = revCnt;
    }
    const lowerKey = String(pkg.id || '').toLowerCase();
    const sharedEntry = sharedEdgeRatings[lowerKey];
    if (sharedEntry) {
      if (!(pkg.score > 0) && sharedEntry.score > 0) {
        pkg.score = sharedEntry.score;
      }
      if (!pkg.review_thread_counts && sharedEntry.review_thread_counts) {
        pkg.review_thread_counts = sharedEntry.review_thread_counts;
        pkg.rating_checked = true;
      }
    }
  }

  // Promote Top 10 trending packages as featured for in-game Luanti Content tab (renders gold star badge in dlg_contentdb.lua:355)
  let top10Week = buildTop10FromCatalog(merged, velocity, favoritesMap, 'week');
  let top10Today = buildTop10FromCatalog(merged, velocity, favoritesMap, 'today');
  const featuredIds = new Set<string>(
    [...top10Today.slice(0, 5), ...top10Week.slice(0, 10)].map(p => String(p.id || '').toLowerCase())
  );
  for (const pkg of merged) {
    if (featuredIds.has(String(pkg.id || '').toLowerCase())) {
      pkg.featured = true;
    }
  }

  let responsePayload: any = merged;
  if (isBootBundle) {
    const tags = Array.isArray(rawTags) && rawTags.length > 0 ? rawTags : DEFAULT_CONTENTDB_TAGS;
    const promoDelta = await syncActivePromotionRowPackages(activePromotions, env.DB, noCache).catch(() => null);
    const mergedWithPromoOverlay = promoDelta
      ? overlayPromotionRowDeltaOnCatalog(merged, promoDelta, blockedIds)
      : merged;
    if (mergedWithPromoOverlay !== merged) {
      merged.length = 0;
      merged.push(...mergedWithPromoOverlay);
    }

    // Pre-hydrate licenses, tags, Git screenshots & ContentDB downloads on the server for top carousel & Git Community packages (cached in Cloudflare Edge Cache)
    const d1ById = new Map<string, any>();
    for (const row of d1List) {
      if (row?.id) {
        d1ById.set(String(row.id).toLowerCase(), row);
      }
    }

    const recentUpstreamRankById = new Map<string, number>();
    if (Array.isArray(recentUpstreamList) && recentUpstreamList.length <= 100) {
      recentUpstreamList.slice(0, 24).forEach((item: any, idx: number) => {
        if (item?.author && item?.name) {
          recentUpstreamRankById.set(`${item.author}/${item.name}`.toLowerCase(), idx);
        }
      });
    }
    const recentUpstreamMerged = merged
      .filter(p => p?.id && recentUpstreamRankById.has(String(p.id).toLowerCase()) && !isPackageDeprecated(p))
      .sort(
        (a, b) =>
          (recentUpstreamRankById.get(String(a.id).toLowerCase()) ?? 999) -
          (recentUpstreamRankById.get(String(b.id).toLowerCase()) ?? 999)
      );

    const carouselPool: any[] = [];
    const pushPool = (items: any[]) => {
      for (const it of items) {
        if (isPackageDeprecated(it)) continue;
        const needsGitScreenshotScan =
          Boolean(it?.sources?.includes('git')) &&
          (!it?.banner || it?.banner === 'logo.svg' || !isGitRepositoryAssetUrl(it?.banner));
        const needsOfficialFullResBanner =
          Boolean(it?.sources?.includes('official')) &&
          (!it?.banner || it?.banner === 'logo.svg' || isContentDbThumbnailUrl(it?.banner));
        if (
          it &&
          it.author &&
          it.name &&
          (!it.license ||
            !it.created_at ||
            (it.sources?.includes('official') &&
              (!(Number(it.contentdb_downloads || 0) > 0) || !it.review_thread_counts)) ||
            needsGitScreenshotScan ||
            needsOfficialFullResBanner) &&
          !carouselPool.some(x => x.id === it.id)
        ) {
          carouselPool.push(it);
        }
      }
    };
    const byDownloadsDesc = [...merged].sort(
      (a, b) =>
        (Number(b.downloads) || 0) * computeDependencyPrioritizationMultiplier(b) -
        (Number(a.downloads) || 0) * computeDependencyPrioritizationMultiplier(a)
    );
    if (promoDelta && Object.keys(promoDelta.tagMap || {}).length > 0) {
      const promoPkgKeys = new Set(Object.keys(promoDelta.tagMap));
      pushPool(merged.filter(p => promoPkgKeys.has(String(p.id || '').toLowerCase())).slice(0, 8));
    }
    pushPool(recentUpstreamMerged.slice(0, 8));
    pushPool(merged.filter(p => p.sources?.includes('git')));
    pushPool(top10Today);
    pushPool(top10Week);
    pushPool(byDownloadsDesc.filter(p => p.type === 'game').slice(0, 12));
    pushPool(byDownloadsDesc.filter(p => p.type === 'mod').slice(0, 12));
    pushPool(byDownloadsDesc.filter(p => p.type === 'txp').slice(0, 12));

    const batchToHydrate = carouselPool.slice(0, 16);
    if (batchToHydrate.length > 0) {
      let bootRepoScanBudget = 6;
      let bootReviewFetchBudget = 12;
      const bootHydrateStmts: any[] = [];
      const newEdgeRatings: Record<string, SharedEdgeRatingEntry> = {};
      await Promise.all(
        batchToHydrate.map(async (pkg) => {
          const lowerPkgKey = String(pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/`,
            3600
          ).catch(() => null);
          if (!detail && !pkg.repo_url) return;
          const resolvedLic = detail?.license || detail?.media_license || pkg.license || '';
          const resolvedMediaLic = detail?.media_license || detail?.license || pkg.media_license || '';
          const detailTags = Array.isArray(detail?.tags)
            ? detail.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
            : [];
          if (resolvedLic) {
            pkg.license = resolvedLic;
            pkg.media_license = resolvedMediaLic;
          }
          if (detail?.dev_state && !pkg.dev_state) {
            pkg.dev_state = detail.dev_state;
          }
          if ((detail?.created_at || detail?.approved_at) && !pkg.created_at) {
            pkg.created_at = detail.created_at || detail.approved_at;
          }
          if (detailTags.length > 0) {
            pkg.tags = Array.from(new Set([...(pkg.tags || []), ...detailTags])).filter(Boolean);
          }
          let parsedDetailRevCounts =
            parseNonZeroReviewThreadCounts(detail?.reviews) ||
            parseNonZeroReviewThreadCounts(pkg.review_thread_counts);
          let cdbRevList: any[] | null = null;
          if (
            !parsedDetailRevCounts &&
            pkg.sources?.includes('official') &&
            !sharedEdgeRatings[lowerPkgKey]?.checked &&
            bootReviewFetchBudget > 0
          ) {
            bootReviewFetchBudget--;
            cdbRevList = await fetchUpstreamJsonCached<any[]>(
              `/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/reviews/`,
              3600
            ).catch(() => null);
            if (Array.isArray(cdbRevList)) {
              parsedDetailRevCounts = deriveReviewThreadCountsFromList(cdbRevList);
              pkg.rating_checked = true;
            }
          }
          if (parsedDetailRevCounts) {
            pkg.review_thread_counts = parsedDetailRevCounts;
            pkg.rating_checked = true;
          }
          const detailThumbSanitized = upgradeContentDbThumbnailUrl(detail?.thumbnail);
          if (detailThumbSanitized && (!pkg.thumbnail || pkg.thumbnail === 'logo.svg' || isDeadMirrorScreenshotUrl(pkg.thumbnail) || String(pkg.thumbnail).includes('/thumbnails/'))) {
            pkg.thumbnail = detailThumbSanitized;
          }
          if (Array.isArray(detail?.screenshots) && detail.screenshots.length > 0) {
            const mergedDetailShots = mergeScreenshotsPreferringGit(
              [pkg.banner, pkg.thumbnail, detailThumbSanitized],
              pkg.screenshots,
              detail.screenshots
            );
            if (mergedDetailShots.length > 0) {
              pkg.screenshots = mergedDetailShots;
              const firstCdbShot = mergedDetailShots.find(s => !isGitRepositoryAssetUrl(s));
              if (firstCdbShot && (!pkg.thumbnail || pkg.thumbnail === 'logo.svg' || String(pkg.thumbnail).includes('/thumbnails/'))) {
                pkg.thumbnail = formatContentDbCdnUrl(firstCdbShot, 'tile') || pkg.thumbnail;
              }
              const preferredGitExisting = isGitRepositoryAssetUrl(pkg.banner) ? pkg.banner : undefined;
              pkg.banner =
                selectSharpPackageBanner(
                  preferredGitExisting,
                  mergedDetailShots,
                  pkg.banner,
                  detailThumbSanitized,
                  pkg.thumbnail
                ) || mergedDetailShots[0];
            }
          } else {
            const preferredGitExisting = isGitRepositoryAssetUrl(pkg.banner) ? pkg.banner : undefined;
            pkg.banner =
              selectSharpPackageBanner(
                preferredGitExisting,
                pkg.screenshots,
                pkg.banner,
                detailThumbSanitized,
                pkg.thumbnail
              ) || pkg.banner;
          }
          const hydratedScore = computeCatalogStarRating(
            {
              ...detail,
              review_thread_counts: pkg.review_thread_counts,
              reviews_list: cdbRevList,
              score: pkg.score
            },
            d1Ratings.get(lowerPkgKey)
          );
          if (hydratedScore > 0) {
            pkg.score = hydratedScore;
          }
          if (pkg.score > 0 || pkg.review_thread_counts || pkg.rating_checked) {
            newEdgeRatings[lowerPkgKey] = {
              score: pkg.score || 0,
              ...(pkg.review_thread_counts ? { review_thread_counts: pkg.review_thread_counts } : {}),
              checked: true
            };
          }
          if (typeof detail?.downloads === 'number' && detail.downloads > 0) {
            pkg.contentdb_downloads = Math.max(Number(pkg.contentdb_downloads || 0), detail.downloads);
            pkg.downloads = Math.max(
              Number(pkg.downloads || 0),
              pkg.contentdb_downloads + Number(pkg.luantihub_downloads || 0)
            );
          }
          const candidateRepo = pkg.repo_url || detail?.repo || detail?.repo_url || '';
          if (candidateRepo && !pkg.repo_url) {
            pkg.repo_url = candidateRepo;
          }
          let rawVideoUrl = detail?.video_url || pkg.video_url;
          const isGitPkg = Boolean(pkg.sources?.includes('git'));
          const needsGitAssetCheck =
            isGitPkg && (!pkg.banner || pkg.banner === 'logo.svg' || !isGitRepositoryAssetUrl(pkg.banner));
          if ((!rawVideoUrl || needsGitAssetCheck) && candidateRepo && bootRepoScanBudget > 0) {
            bootRepoScanBudget--;
            const gitScan = await scanGitRepoMetadataCached(
              pkg.author,
              pkg.name,
              pkg.type || 'mod',
              candidateRepo,
              21600
            ).catch(() => null);
            if (gitScan?.cdbMeta?.video_url) {
              rawVideoUrl = gitScan.cdbMeta.video_url;
            }
            if (gitScan?.screenshotUrl || (gitScan?.screenshots && gitScan.screenshots.length > 0)) {
              const mergedShots = mergeScreenshotsPreferringGit(
                [gitScan?.screenshotUrl, ...(gitScan?.screenshots || [])],
                pkg.screenshots,
                detail?.screenshots
              );
              const primaryGitShot = sanitizePackageImageUrl(gitScan?.screenshotUrl) || mergedShots[0];
              if (primaryGitShot) {
                if (!pkg.thumbnail || pkg.thumbnail === 'logo.svg' || isGitRepositoryAssetUrl(pkg.thumbnail)) {
                  pkg.thumbnail = detailThumbSanitized || primaryGitShot;
                }
                pkg.banner = primaryGitShot;
              }
              if (mergedShots.length > 0) {
                pkg.screenshots = mergedShots;
              }
            }
          }
          const resolvedVideo = extractEmbeddedVideo(
            rawVideoUrl,
            detail?.video_thumbnail_url || pkg.video_thumbnail_url,
            typeof detail?.long_description === 'string' ? detail.long_description : undefined
          );
          if (resolvedVideo.video_url && !pkg.video_url) {
            pkg.video_url = resolvedVideo.video_url;
          }
          if (resolvedVideo.video_thumbnail_url && !pkg.video_thumbnail_url) {
            pkg.video_thumbnail_url = resolvedVideo.video_thumbnail_url;
          }

          // Only backfill D1 if this package already exists in D1 AND a previously missing field was discovered
          const existingD1 = d1ById.get(String(pkg.id || '').toLowerCase());
          if (env.DB && existingD1) {
            const existingValidRevCounts = parseNonZeroReviewThreadCounts(existingD1.review_thread_counts);
            const newLic = !existingD1.license && resolvedLic ? resolvedLic : null;
            const newVid = !existingD1.video_url && pkg.video_url ? pkg.video_url : null;
            const newRevCounts = !existingValidRevCounts && pkg.review_thread_counts
              ? JSON.stringify(pkg.review_thread_counts)
              : null;
            const newScore =
              !(Number(existingD1.score) >= 1 && Number(existingD1.score) <= 5) &&
              typeof pkg.score === 'number' &&
              pkg.score >= 1 &&
              pkg.score <= 5
                ? pkg.score
                : null;
            const newShot =
              (!sanitizePackageImageUrl(existingD1.banner_url) ||
                (isContentDbThumbnailUrl(existingD1.banner_url) && !isContentDbThumbnailUrl(pkg.banner)) ||
                (!isGitRepositoryAssetUrl(existingD1.banner_url) && isGitRepositoryAssetUrl(pkg.banner))) &&
              sanitizePackageImageUrl(pkg.banner)
                ? sanitizePackageImageUrl(pkg.banner)!
                : null;
            const newThumb =
              (!sanitizePackageImageUrl(existingD1.thumbnail_url) ||
                String(existingD1.thumbnail_url || '').includes('/thumbnails/')) &&
              sanitizePackageImageUrl(pkg.thumbnail)
                ? sanitizePackageImageUrl(pkg.thumbnail)!
                : null;
            if (newLic || newVid || newShot || newThumb || newRevCounts || newScore !== null) {
              bootHydrateStmts.push(
                env.DB.prepare(`
                  UPDATE packages
                  SET thumbnail_url = CASE
                        WHEN COALESCE(thumbnail_url, '') = '' OR thumbnail_url = 'logo.svg' OR thumbnail_url LIKE '%/storage/screenshots/%' OR thumbnail_url LIKE '%/shot-0.png' OR thumbnail_url LIKE '%/thumbnails/%' THEN COALESCE(?, thumbnail_url)
                        ELSE thumbnail_url
                      END,
                      banner_url = CASE
                        WHEN COALESCE(banner_url, '') = '' OR banner_url = 'logo.svg' OR banner_url LIKE '%/storage/screenshots/%' OR banner_url LIKE '%/shot-0.png' OR banner_url LIKE '%/thumbnails/%' THEN COALESCE(?, banner_url)
                        ELSE COALESCE(?, banner_url)
                      END,
                      screenshots = CASE
                        WHEN COALESCE(screenshots, '') = '' OR screenshots LIKE '%/storage/screenshots/%' THEN COALESCE(?, screenshots)
                        ELSE COALESCE(screenshots, ?)
                      END,
                      license = CASE WHEN COALESCE(license, '') = '' THEN COALESCE(?, license) ELSE license END,
                      video_url = COALESCE(video_url, ?),
                      video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
                      review_thread_counts = CASE
                        WHEN COALESCE(review_thread_counts, '') = '' OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN COALESCE(?, review_thread_counts)
                        ELSE review_thread_counts
                      END,
                      score = CASE WHEN ? IS NOT NULL THEN ? ELSE score END
                  WHERE id = ?
                `).bind(
                  sanitizePackageImageUrl(pkg.thumbnail) || newShot,
                  newShot,
                  newShot,
                  Array.isArray(pkg.screenshots) && pkg.screenshots.length > 0 ? JSON.stringify(pkg.screenshots) : null,
                  Array.isArray(pkg.screenshots) && pkg.screenshots.length > 0 ? JSON.stringify(pkg.screenshots) : null,
                  newLic,
                  newVid,
                  pkg.video_thumbnail_url || null,
                  newRevCounts,
                  newScore,
                  newScore,
                  existingD1.id
                )
              );
            }
          }
        })
      );
      if (Object.keys(newEdgeRatings).length > 0) {
        await mergeSharedEdgeRatingsMap(newEdgeRatings).catch(() => {});
      }
      if (env.DB && bootHydrateStmts.length > 0) {
        if (typeof env.DB.batch === 'function') {
          await env.DB.batch(bootHydrateStmts).catch(() => {});
        } else {
          for (const stmt of bootHydrateStmts) {
            stmt.run().catch(() => {});
          }
        }
      }

      // Sync pre-hydrated fields (sharp banner, screenshots, license, score, review_thread_counts) into top10Today & top10Week
      const mergedByLowerId = new Map<string, any>();
      for (const p of merged) {
        if (p?.id) mergedByLowerId.set(String(p.id).toLowerCase(), p);
      }
      const syncPreHydratedToTop10 = (list: any[]) =>
        list.map(item => {
          const updated = item?.id ? mergedByLowerId.get(String(item.id).toLowerCase()) : undefined;
          return updated ? { ...item, ...updated } : item;
        });
      top10Today = syncPreHydratedToTop10(top10Today);
      top10Week = syncPreHydratedToTop10(top10Week);
    }

    // Build Recently Added list (up to 24 active non-deprecated packages across Git + ContentDB)
    let maxRecentCdbMs = 0;
    for (const pkg of recentUpstreamMerged) {
      const parsedMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : NaN;
      if (Number.isFinite(parsedMs) && parsedMs > maxRecentCdbMs) {
        maxRecentCdbMs = parsedMs;
      }
    }
    let anchorMs = (maxRecentCdbMs > 0 ? maxRecentCdbMs : Date.now()) + 60_000;
    for (const pkg of recentUpstreamMerged) {
      const parsedMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : NaN;
      if (Number.isFinite(parsedMs) && parsedMs > 0 && parsedMs < anchorMs) {
        anchorMs = parsedMs;
      } else {
        anchorMs -= 60_000;
        pkg.created_at = new Date(anchorMs).toISOString();
      }
    }
    const recentlyAddedById = new Map<string, any>();
    for (const pkg of recentUpstreamMerged) {
      if (pkg?.id && !isPackageDeprecated(pkg)) {
        recentlyAddedById.set(String(pkg.id).toLowerCase(), pkg);
      }
    }
    for (const pkg of merged) {
      const isPureGit = pkg?.source === 'git' && !pkg?.sources?.includes('official');
      if (pkg?.id && isPureGit && pkg.created_at && !isPackageDeprecated(pkg)) {
        recentlyAddedById.set(String(pkg.id).toLowerCase(), pkg);
      }
    }
    const recentlyAdded = Array.from(recentlyAddedById.values())
      .sort((a, b) => {
        const ta = a.created_at ? Date.parse(String(a.created_at)) : 0;
        const tb = b.created_at ? Date.parse(String(b.created_at)) : 0;
        if (tb !== ta) return tb - ta;
        const rankA = recentUpstreamRankById.get(String(a.id || '').toLowerCase()) ?? 999;
        const rankB = recentUpstreamRankById.get(String(b.id || '').toLowerCase()) ?? 999;
        return rankA - rankB;
      })
      .slice(0, 24);

    responsePayload = {
      packages: merged,
      tags,
      top10Week,
      top10Today,
      recentlyAdded,
      ...(Array.isArray(activePromotions) ? { promotions: activePromotions } : {}),
      latestBlogPost: latestBlogPost || null,
      recentReviews: Array.isArray(recentReviews) ? recentReviews : []
    };

    if (!noCache && !q && types.length === 0 && !author && Array.isArray(activePromotions)) {
      await writeEdgeCacheJson(bootEdgeCacheKey, responsePayload, 1800);
    }
  } else {
    // Compact ContentDB-compatible payload for in-game Luanti C++ client (`contentdb.lua` / `dlg_contentdb.lua`)
    const slimList = merged.map((pkg: any) => {
      const item: Record<string, any> = {
        author: pkg.author,
        name: pkg.name,
        title: pkg.title || pkg.name,
        type: pkg.type === 'modpack' ? 'mod' : (pkg.type || 'mod'),
        short_description: pkg.short_desc || pkg.short_description || '',
        short_desc: pkg.short_desc || pkg.short_description || '',
        release: Number(pkg.release) || 1,
        thumbnail: pkg.thumbnail || null,
        tags: Array.isArray(pkg.tags) ? pkg.tags : []
      };
      if (pkg.aliases) item['aliases'] = pkg.aliases;
      if (pkg.featured) item['featured'] = true;
      if (typeof pkg.score === 'number') item['score'] = pkg.score;
      if (typeof pkg.downloads === 'number') item['downloads'] = pkg.downloads;
      if (pkg.license) item['license'] = pkg.license;
      return item;
    });

    if (requestedFmt === 'keys') {
      const keys = [
        'author',
        'name',
        'title',
        'type',
        'short_description',
        'release',
        'thumbnail',
        'tags',
        'featured'
      ];
      const rows = slimList.map((it: any) => [
        it.author,
        it.name,
        it.title,
        it.type,
        it.short_description,
        it.release,
        it.thumbnail,
        it.tags,
        Boolean(it.featured)
      ]);
      responsePayload = {
        keys,
        pkgs: rows,
        values: rows
      };
    } else {
      responsePayload = slimList;
    }
  }

  if (!isBootBundle && !noCache && catalogEdgeCacheKey) {
    await writeEdgeCacheJson(catalogEdgeCacheKey, responsePayload, 900);
  }

  return new Response(JSON.stringify(responsePayload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': !noCache
        ? (isBootBundle
            ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600'
            : 'public, max-age=120, s-maxage=900, stale-while-revalidate=1800')
        : 'no-cache, no-store, must-revalidate',
      'X-LuantiHub-Cache': !noCache ? 'MISS-EDGE' : 'BYPASS'
    }
  });
}

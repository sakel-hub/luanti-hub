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
  toLegacyLuantiClientThumbnailUrl,
  selectSharpPackageBanner,
  mergeScreenshotsPreferringGit,
  toProxiedGitImageIfNeeded,
  isPackageDeprecated,
  isGitProviderId,
  detectGitProviderFromUrl,
  getLastKnownActivePromotions,
  setLastKnownActivePromotions,
  getUnifiedCatalogTags,
  isValidActivePromotionRow,
  fetchRecentContentDbReviewsCached,
  normalizeUtcIsoTimestamp,
  computeLuantiHubFrecencyMetrics,
  mergeLuantiHubAndContentDbGameSupport,
  parsePackageTranslations,
  parseBadgeTagsArray,
  ORGANIC_CODE_TAG,
  BOOT_CATALOG_EDGE_CACHE_KEY
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
        const velA = Number(a.score_downloads ?? a.luantihub_score_downloads ?? 0);
        const velB = Number(b.score_downloads ?? b.luantihub_score_downloads ?? 0);
        const scoreA =
          ((Number(a.contentdb_score ?? a.score) || 0) * 8 +
            velA * 14 +
            Math.log10((Number(a.downloads) || 1) + 1) * 50 +
            convA * 120 +
            favA * 35 +
            recencyA) *
          depMultA;
        const scoreB =
          ((Number(b.contentdb_score ?? b.score) || 0) * 8 +
            velB * 14 +
            Math.log10((Number(b.downloads) || 1) + 1) * 50 +
            convB * 120 +
            favB * 35 +
            recencyB) *
          depMultB;
        return scoreB - scoreA;
      }
      const velWeekA = Number(a.score_downloads ?? a.luantihub_score_downloads ?? 0);
      const velWeekB = Number(b.score_downloads ?? b.luantihub_score_downloads ?? 0);
      const scoreA =
        ((Number(a.downloads) || 0) * (1 + convA * 0.25) +
          velWeekA * 25 +
          (Number(a.contentdb_score) || 0) * 3 +
          favA * 180) *
        depMultA;
      const scoreB =
        ((Number(b.downloads) || 0) * (1 + convB * 0.25) +
          velWeekB * 25 +
          (Number(b.contentdb_score) || 0) * 3 +
          favB * 180) *
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

  const bootEdgeCacheKey = `https://cache.luantihub.internal${BOOT_CATALOG_EDGE_CACHE_KEY}`;
  const rawHideAndFlags = [
    ...url.searchParams.getAll('hide'),
    ...url.searchParams.getAll('flag')
  ]
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const normalizedHideFlags = new Set<string>();
  for (const f of rawHideAndFlags) {
    if (f === 'nonfree') continue;
    if (f === 'desktop_default') {
      normalizedHideFlags.add('deprecated');
    } else if (f === 'android_default') {
      normalizedHideFlags.add('deprecated');
      normalizedHideFlags.add('*');
    } else {
      normalizedHideFlags.add(f);
    }
  }
  const normalizedHideSig = Array.from(normalizedHideFlags).sort().join(',');
  const tagFilterSig = url.searchParams.getAll('tag').map(s => s.trim().toLowerCase()).filter(Boolean).sort().join(',');
  const gameFilterSig = (url.searchParams.get('game') || '').trim().toLowerCase();
  const sortFilterSig = (url.searchParams.get('sort') || '').trim().toLowerCase();
  const orderFilterSig = (url.searchParams.get('order') || '').trim().toLowerCase();
  const limitFilterSig = (url.searchParams.get('limit') || '').trim();
  const licenseFilterSig = (url.searchParams.get('license') || '').trim().toLowerCase();
  const hasCustomUpstreamFilters = Boolean(
    tagFilterSig || gameFilterSig || sortFilterSig || orderFilterSig || limitFilterSig || licenseFilterSig
  );
  const effectiveEngineSig = hasCustomUpstreamFilters
    ? (url.searchParams.get('engine_version') || '').trim().toLowerCase()
    : '';
  const effectiveProtoSig = hasCustomUpstreamFilters ? protocolVersion : '';
  const effectiveTypesSig = isAllStandardTypes ? 'all' : sortedUniqueTypes.join(',');
  const extraFilterSig = [
    normalizedHideSig,
    tagFilterSig,
    gameFilterSig,
    effectiveEngineSig,
    sortFilterSig,
    orderFilterSig,
    limitFilterSig,
    licenseFilterSig
  ].some(Boolean)
    ? `&h=${normalizedHideSig}&tg=${tagFilterSig}&gm=${gameFilterSig}&ev=${effectiveEngineSig}&s=${sortFilterSig}&o=${orderFilterSig}&lm=${limitFilterSig}&lc=${licenseFilterSig}`
    : '';
  const normalizedCatalogKey = `q=${q.toLowerCase()}&a=${author.toLowerCase()}&t=${effectiveTypesSig}&p=${effectiveProtoSig}&fmt=${requestedFmt}${extraFilterSig}`;
  const catalogEdgeCacheKey = isBootBundle
    ? (!q && types.length === 0 && !author ? bootEdgeCacheKey : null)
    : `https://cache.luantihub.internal/__catalog_edge_v11_${encodeURIComponent(normalizedCatalogKey)}`;

  const lowerQ = q.toLowerCase();
  const lowerAuthor = author.toLowerCase();
  const requestedTagFilters = url.searchParams
    .getAll('tag')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const buildInGameClientCatalogResponse = (packagesList: any[]): any => {
    const filtered = (Array.isArray(packagesList) ? packagesList : []).filter((pkg: any) => {
      if (!pkg || !pkg.author || !pkg.name) return false;
      const pkgType = pkg.type === 'modpack' ? 'mod' : (pkg.type || 'mod');
      if (sortedUniqueTypes.length > 0 && !isAllStandardTypes && !sortedUniqueTypes.includes(pkgType)) {
        return false;
      }
      if (requestedTagFilters.length > 0) {
        const pkgTagsLower = new Set<string>([
          ...parseJsonArray(pkg.tags).map((t: string) => String(t).toLowerCase()),
          ...parseBadgeTagsArray(pkg.badge_tags).map((t: string) => String(t).toLowerCase())
        ]);
        if (!requestedTagFilters.every(reqTag => pkgTagsLower.has(reqTag))) {
          return false;
        }
      }
      if (lowerAuthor) {
        const pkgAuthorLower = String(pkg.author || '').toLowerCase();
        const aliasAuthorMatch = Array.isArray(pkg.aliases)
          ? pkg.aliases.some((al: string) => String(al || '').toLowerCase().startsWith(`${lowerAuthor}/`))
          : false;
        if (pkgAuthorLower !== lowerAuthor && !aliasAuthorMatch) {
          return false;
        }
      }
      if (lowerQ) {
        const haystack = [
          pkg.name,
          pkg.title,
          pkg.short_desc,
          pkg.short_description,
          pkg.author
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(lowerQ)) {
          return false;
        }
      }
      if (normalizedHideFlags.size > 0) {
        if (normalizedHideFlags.has('deprecated') && isPackageDeprecated(pkg)) {
          return false;
        }
        if (normalizedHideFlags.has('wip') && String(pkg.dev_state || '').trim().toUpperCase() === 'WIP') {
          return false;
        }
        const warnings = parseJsonArray(pkg.content_warnings);
        if (warnings.length > 0) {
          if (normalizedHideFlags.has('*')) return false;
          if (warnings.some((w: string) => normalizedHideFlags.has(String(w || '').trim().toLowerCase()))) {
            return false;
          }
        }
      }
      return true;
    });

    const slimList = filtered.map((pkg: any) => {
      const item: Record<string, any> = {
        author: pkg.author,
        name: pkg.name,
        title: pkg.title || pkg.name,
        type: pkg.type === 'modpack' ? 'mod' : (pkg.type || 'mod'),
        short_description: pkg.short_desc || pkg.short_description || '',
        release: Number(pkg.release) || 1,
        thumbnail: toLegacyLuantiClientThumbnailUrl(pkg.thumbnail || pkg.thumbnail_url) || null
      };
      if (pkg.aliases) item['aliases'] = pkg.aliases;
      if (pkg.featured) item['featured'] = true;
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
        Boolean(it.featured)
      ]);
      return {
        keys,
        pkgs: rows,
        values: rows
      };
    }

    return slimList;
  };

  const enrichRecentReviewsWithCatalog = (reviews: any[], catalogPackages: any[]): any[] => {
    if (!Array.isArray(reviews) || reviews.length === 0) return [];
    const pkgByLowerId = new Map<string, any>();
    if (Array.isArray(catalogPackages)) {
      for (const pkg of catalogPackages) {
        if (!pkg) continue;
        if (pkg.id) pkgByLowerId.set(String(pkg.id).toLowerCase(), pkg);
        if (pkg.author && pkg.name) {
          pkgByLowerId.set(`${pkg.author}/${pkg.name}`.toLowerCase(), pkg);
        }
      }
    }
    return reviews.map((r: any) => {
      const rawPkgId =
        r?.package_id ||
        r?.packageId ||
        (r?.package?.author && r?.package?.name ? `${r.package.author}/${r.package.name}` : '');
      const matched = rawPkgId ? pkgByLowerId.get(String(rawPkgId).toLowerCase()) : undefined;
      return {
        ...r,
        package_id: matched?.id || rawPkgId || r?.package_id,
        package_title: r?.package_title || matched?.title || rawPkgId,
        package_type: r?.package_type || matched?.type || 'mod',
        package_thumbnail: r?.package_thumbnail || matched?.thumbnail || undefined
      };
    });
  };

  const fetchMergedRecentReviews = async (db: any, useCache = true): Promise<any[]> => {
    if (useCache) {
      const cached = await readEdgeCacheJson<any[]>('/__recent_reviews_v1');
      if (Array.isArray(cached)) {
        return cached;
      }
    }

    const d1ReviewsPromise = (async () => {
      if (!db) return [];
      if (useCache) {
        const cachedD1 = await readEdgeCacheJson<any[]>('/__d1_recent_reviews_v1');
        if (Array.isArray(cachedD1)) {
          return cachedD1;
        }
      }
      try {
        const res = await db
          .prepare(`
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
          `)
          .all();
        const rows = (res?.results || []).map((row: any) => {
          const rawId = String(row?.id || '');
          return {
            ...row,
            id: rawId.startsWith('lh_') || rawId.startsWith('cdb_') ? rawId : `lh_${rawId}`,
            created_at: normalizeUtcIsoTimestamp(row?.created_at),
            source: 'luantihub'
          };
        });
        if (useCache) {
          // Cache D1 recent reviews for 6 hours (evicted immediately on review POST/DELETE in reviews.ts)
          await writeEdgeCacheJson('/__d1_recent_reviews_v1', rows, 21600);
        }
        return rows;
      } catch {
        return [];
      }
    })();

    const cdbReviewsPromise = fetchRecentContentDbReviewsCached(900).catch(() => []);

    const [d1Rows, cdbRows] = await Promise.all([d1ReviewsPromise, cdbReviewsPromise]);
    const combinedById = new Map<string, any>();
    for (const item of [...d1Rows, ...cdbRows]) {
      if (!item?.id) continue;
      const key = String(item.id);
      if (!combinedById.has(key)) {
        combinedById.set(key, item);
      }
    }

    const mergedReviews = Array.from(combinedById.values())
      .sort((a, b) => {
        const ta = Date.parse(normalizeUtcIsoTimestamp(a?.created_at)) || 0;
        const tb = Date.parse(normalizeUtcIsoTimestamp(b?.created_at)) || 0;
        return tb - ta;
      })
      .slice(0, 15);

    if (useCache) {
      await writeEdgeCacheJson('/__recent_reviews_v1', mergedReviews, 900);
    }
    return mergedReviews;
  };

  const applyApprovalTrackingAndBuildRecentlyAdded = async (
    recentUpstreamMerged: any[],
    catalogPackages: any[],
    recentUpstreamRankById: Map<string, number>,
    useCache = true
  ): Promise<any[]> => {
    const approvedSeenKey = 'https://cache.luantihub.internal/__cdb_approved_seen_v1';
    const prevApprovedSeen = useCache
      ? await readEdgeCacheJson<{ seededAt: number; seen: Record<string, number> }>(approvedSeenKey).catch(() => null)
      : null;
    const nowApprovalMs = Date.now();
    const hasExistingSeed = Boolean(
      prevApprovedSeen &&
        prevApprovedSeen.seededAt > 0 &&
        prevApprovedSeen.seen &&
        typeof prevApprovedSeen.seen === 'object' &&
        Object.keys(prevApprovedSeen.seen).length > 0
    );
    const nextSeenMap: Record<string, number> = hasExistingSeed ? { ...prevApprovedSeen!.seen } : {};
    let seenMapChanged = !hasExistingSeed;

    for (let i = 0; i < recentUpstreamMerged.length; i++) {
      const pkg = recentUpstreamMerged[i];
      const lowerKey = String(pkg?.id || '').toLowerCase();
      if (!lowerKey) continue;
      const parsedCreatedMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : NaN;
      const validCreatedMs = Number.isFinite(parsedCreatedMs) && parsedCreatedMs > 0 ? parsedCreatedMs : 0;
      if (hasExistingSeed) {
        if (nextSeenMap[lowerKey] === undefined) {
          if (i < 12) {
            const discoveredMs = nowApprovalMs - i * 1000;
            nextSeenMap[lowerKey] = Math.max(validCreatedMs, discoveredMs);
          } else {
            nextSeenMap[lowerKey] = validCreatedMs || (nowApprovalMs - (24 + i) * 3600 * 1000);
          }
          seenMapChanged = true;
        }
        const seenMs = nextSeenMap[lowerKey];
        if (Number.isFinite(seenMs) && seenMs > 0) {
          const effectiveMs = Math.max(validCreatedMs, seenMs);
          const effectiveIso = new Date(effectiveMs).toISOString();
          pkg.approved_at = effectiveIso;
          pkg.created_at = effectiveIso;
        }
      } else if (validCreatedMs > 0) {
        nextSeenMap[lowerKey] = validCreatedMs;
      }
    }

    let maxRecentCdbMs = 0;
    const suffixMaxMs = new Array<number>(recentUpstreamMerged.length).fill(0);
    for (let i = recentUpstreamMerged.length - 1; i >= 0; i--) {
      const pkg = recentUpstreamMerged[i];
      const parsedMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : NaN;
      const validMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : 0;
      if (validMs > maxRecentCdbMs) {
        maxRecentCdbMs = validMs;
      }
      const nextSuffixMax = i + 1 < recentUpstreamMerged.length ? suffixMaxMs[i + 1] : 0;
      suffixMaxMs[i] = Math.max(validMs, nextSuffixMax);
    }
    const syntheticFloorCapMs = Date.now() - 24 * 60 * 60 * 1000;
    let anchorMs = (maxRecentCdbMs > 0 ? maxRecentCdbMs : syntheticFloorCapMs) + 60_000;
    for (let i = 0; i < recentUpstreamMerged.length; i++) {
      const pkg = recentUpstreamMerged[i];
      const parsedMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : NaN;
      const floorMs = suffixMaxMs[i];
      if (Number.isFinite(parsedMs) && parsedMs > 0 && parsedMs >= floorMs) {
        if (parsedMs < anchorMs) {
          anchorMs = parsedMs;
        } else {
          anchorMs -= 1_000;
          pkg.created_at = new Date(anchorMs).toISOString();
        }
      } else if (floorMs > 0) {
        const candidateMs = Math.min(
          anchorMs - 1_000,
          floorMs + (recentUpstreamMerged.length - i) * 1_000
        );
        anchorMs = Math.max(floorMs, candidateMs);
        pkg.created_at = new Date(anchorMs).toISOString();
      } else {
        anchorMs = Math.min(anchorMs, syntheticFloorCapMs) - 60_000;
        pkg.created_at = new Date(anchorMs).toISOString();
      }
      const lowerKey = String(pkg?.id || '').toLowerCase();
      if (!hasExistingSeed && lowerKey && !nextSeenMap[lowerKey]) {
        const resolvedMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : 0;
        if (Number.isFinite(resolvedMs) && resolvedMs > 0) {
          nextSeenMap[lowerKey] = resolvedMs;
        }
      }
    }

    if (useCache && seenMapChanged && Object.keys(nextSeenMap).length > 0) {
      const trimmedSeen = Object.fromEntries(
        Object.entries(nextSeenMap)
          .sort((a, b) => (b[1] || 0) - (a[1] || 0))
          .slice(0, 200)
      );
      await writeEdgeCacheJson(
        approvedSeenKey,
        { seededAt: prevApprovedSeen?.seededAt || nowApprovalMs, seen: trimmedSeen },
        86400 * 30
      ).catch(() => {});
    }

    const recentlyAddedById = new Map<string, any>();
    for (const pkg of recentUpstreamMerged) {
      if (pkg?.id && !isPackageDeprecated(pkg)) {
        recentlyAddedById.set(String(pkg.id).toLowerCase(), pkg);
      }
    }
    for (const pkg of catalogPackages) {
      const isPureGit = pkg?.source === 'git' && !pkg?.sources?.includes('official');
      if (pkg?.id && isPureGit && pkg.created_at && !isPackageDeprecated(pkg)) {
        recentlyAddedById.set(String(pkg.id).toLowerCase(), pkg);
      }
    }
    return Array.from(recentlyAddedById.values())
      .sort((a, b) => {
        const ta = a.created_at ? Date.parse(String(a.created_at)) : 0;
        const tb = b.created_at ? Date.parse(String(b.created_at)) : 0;
        if (tb !== ta) return tb - ta;
        const rankA = recentUpstreamRankById.get(String(a.id || '').toLowerCase()) ?? 999;
        const rankB = recentUpstreamRankById.get(String(b.id || '').toLowerCase()) ?? 999;
        return rankA - rankB;
      })
      .slice(0, 24);
  };

  const overlayRecentlyAddedOnPackages = (basePackages: any[], recentlyAdded: any[]): any[] => {
    if (!Array.isArray(recentlyAdded) || recentlyAdded.length === 0) return basePackages;
    const recentByLowerId = new Map<string, any>();
    for (const item of recentlyAdded) {
      if (item?.id) {
        recentByLowerId.set(String(item.id).toLowerCase(), item);
      }
    }
    const seenInBase = new Set<string>();
    const updatedBase = (Array.isArray(basePackages) ? basePackages : []).map((pkg: any) => {
      const lowerId = String(pkg?.id || '').toLowerCase();
      if (!lowerId) return pkg;
      seenInBase.add(lowerId);
      const recentMatch = recentByLowerId.get(lowerId);
      if (!recentMatch) return pkg;
      const baseMs = pkg.created_at ? Date.parse(String(pkg.created_at)) : 0;
      const recentMs = recentMatch.created_at ? Date.parse(String(recentMatch.created_at)) : 0;
      const newerCreatedAt =
        Number.isFinite(recentMs) && recentMs > (Number.isFinite(baseMs) ? baseMs : 0)
          ? recentMatch.created_at
          : pkg.created_at || recentMatch.created_at;
      return {
        ...pkg,
        ...(newerCreatedAt ? { created_at: newerCreatedAt } : {}),
        ...(recentMatch.approved_at ? { approved_at: recentMatch.approved_at } : {}),
        ...(recentMatch.license && !pkg.license ? { license: recentMatch.license } : {}),
        ...(recentMatch.media_license && !pkg.media_license ? { media_license: recentMatch.media_license } : {}),
        ...(recentMatch.banner && (!pkg.banner || pkg.banner === 'logo.svg') ? { banner: recentMatch.banner } : {}),
        ...(recentMatch.thumbnail && (!pkg.thumbnail || pkg.thumbnail === 'logo.svg')
          ? { thumbnail: recentMatch.thumbnail }
          : {}),
        ...(Array.isArray(recentMatch.screenshots) &&
        recentMatch.screenshots.length > 0 &&
        (!Array.isArray(pkg.screenshots) || pkg.screenshots.length === 0)
          ? { screenshots: recentMatch.screenshots }
          : {})
      };
    });
    const missingNewPackages: any[] = [];
    for (const [lowerId, item] of recentByLowerId.entries()) {
      if (!seenInBase.has(lowerId)) {
        missingNewPackages.push(item);
      }
    }
    return missingNewPackages.length > 0 ? [...missingNewPackages, ...updatedBase] : updatedBase;
  };

  const fetchLiveRecentlyAddedOverlay = async (
    basePackages: any[],
    useCache = true
  ): Promise<any[] | null> => {
    if (useCache) {
      const cachedRecent = await readEdgeCacheJson<any[]>('/__api_boot_recently_added_v1');
      if (Array.isArray(cachedRecent) && cachedRecent.length > 0) {
        return cachedRecent;
      }
    }

    const recentUpstreamList = await fetchUpstreamJsonCached<any[]>(
      '/packages/?sort=approved_at&order=desc&limit=24&fmt=vcs',
      300
    )
      .then(list => (Array.isArray(list) ? list : []))
      .catch(() => []);
    if (!Array.isArray(recentUpstreamList) || recentUpstreamList.length === 0 || recentUpstreamList.length > 100) {
      return null;
    }

    const byLowerId = new Map<string, any>();
    for (const pkg of Array.isArray(basePackages) ? basePackages : []) {
      if (pkg?.id) {
        byLowerId.set(String(pkg.id).toLowerCase(), pkg);
      }
    }

    const rankById = new Map<string, number>();
    const recentItems: any[] = [];
    for (const [idx, raw] of recentUpstreamList.slice(0, 24).entries()) {
      if (!raw?.author || !raw?.name) continue;
      const id = `${raw.author}/${raw.name}`;
      const lowerKey = id.toLowerCase();
      rankById.set(lowerKey, idx);
      const existing = byLowerId.get(lowerKey);
      if (existing) {
        if (!isPackageDeprecated(existing)) {
          recentItems.push({ ...existing });
        }
      } else {
        const sanitizedThumb = upgradeContentDbThumbnailUrl(raw.thumbnail || raw.thumbnail_url);
        const resolvedBanner =
          selectSharpPackageBanner(undefined, raw.screenshots, raw.banner, raw.banner_url, sanitizedThumb) ||
          sanitizedThumb;
        const fallbackPkg = {
          ...raw,
          id,
          short_desc: raw.short_desc || raw.short_description || '',
          ...(sanitizedThumb ? { thumbnail: sanitizedThumb } : {}),
          ...(resolvedBanner ? { banner: resolvedBanner } : {}),
          score: 0,
          contentdb_score: Number(raw.contentdb_score ?? raw.score ?? 0),
          contentdb_downloads: Number(raw.downloads || 0),
          luantihub_downloads: 0,
          downloads: Number(raw.downloads || 0),
          min_minetest_version: raw.min_minetest_version || '5.0.0',
          provider: 'contentdb',
          source: 'official',
          sources: ['official']
        };
        if (!isPackageDeprecated(fallbackPkg)) {
          recentItems.push(fallbackPkg);
        }
      }
    }

    const toHydrate = recentItems
      .slice(0, 12)
      .filter(it => !it.created_at || !it.license || !it.banner || isContentDbThumbnailUrl(it.banner));
    if (toHydrate.length > 0) {
      await Promise.all(
        toHydrate.map(async pkg => {
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/`,
            3600
          ).catch(() => null);
          if (!detail) return;
          if (detail.license || detail.media_license) {
            pkg.license = detail.license || detail.media_license || pkg.license || '';
            pkg.media_license = detail.media_license || detail.license || pkg.media_license || '';
          }
          if (detail.created_at || detail.approved_at) {
            const normExisting = pkg.created_at ? normalizeUtcIsoTimestamp(pkg.created_at) : '';
            const normCreated = detail.created_at ? normalizeUtcIsoTimestamp(detail.created_at) : '';
            const normApproved = detail.approved_at ? normalizeUtcIsoTimestamp(detail.approved_at) : '';
            const candidates = [normApproved, normCreated, normExisting]
              .filter(Boolean)
              .map(iso => ({ iso, ms: Date.parse(iso) }))
              .filter(c => Number.isFinite(c.ms) && c.ms > 0);
            if (candidates.length > 0) {
              candidates.sort((a, b) => b.ms - a.ms);
              pkg.created_at = candidates[0].iso;
            }
          }
          const detailThumb = upgradeContentDbThumbnailUrl(detail.thumbnail);
          if (detailThumb && (!pkg.thumbnail || pkg.thumbnail === 'logo.svg')) {
            pkg.thumbnail = detailThumb;
          }
          const detailShots = parseJsonArray(detail.screenshots)
            .map((s: any) => sanitizePackageImageUrl(typeof s === 'string' ? s : s?.url))
            .filter((u): u is string => Boolean(u));
          if (detailShots.length > 0) {
            pkg.screenshots = detailShots;
            pkg.banner =
              selectSharpPackageBanner(undefined, detailShots, pkg.banner, pkg.thumbnail) || pkg.banner;
          }
          if (typeof detail.downloads === 'number' && detail.downloads > (pkg.contentdb_downloads || 0)) {
            pkg.contentdb_downloads = detail.downloads;
            pkg.downloads = detail.downloads + Number(pkg.luantihub_downloads || 0);
          }
        })
      );
    }

    const builtRecentlyAdded = await applyApprovalTrackingAndBuildRecentlyAdded(
      recentItems,
      basePackages,
      rankById,
      useCache
    );
    if (useCache && builtRecentlyAdded.length > 0) {
      await writeEdgeCacheJson('/__api_boot_recently_added_v1', builtRecentlyAdded, 300).catch(() => {});
    }
    return builtRecentlyAdded;
  };

  if (catalogEdgeCacheKey && !noCache) {
    // Share the already-warmed Web Boot Bundle (`bootEdgeCacheKey`) first for standard in-game Luanti C++ client requests
    // (`GET /api/packages/?type=mod&type=game&type=txp...`) so in-game Content tab opens in < 5ms with zero D1 or upstream calls
    // and immediately reflects any newly submitted or synced D1 Git packages whenever `bootEdgeCacheKey` is refreshed.
    if (!isBootBundle && !q && !author && !hasCustomUpstreamFilters) {
      const cachedBoot = await readEdgeCacheJson<any>(bootEdgeCacheKey);
      if (cachedBoot && Array.isArray(cachedBoot.packages) && cachedBoot.packages.length > 0) {
        const sharedClientPayload = buildInGameClientCatalogResponse(cachedBoot.packages);
        await writeEdgeCacheJson(catalogEdgeCacheKey, sharedClientPayload, 1800);
        return new Response(JSON.stringify(sharedClientPayload), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600',
            'X-LuantiHub-Cache': 'HIT-BOOT-SHARED'
          }
        });
      }
    }

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
        // Zero D1 reads and zero upstream subrequests on HIT-EDGE: only read Isolate/Edge Cache overlays
        const [cachedActivePromos, sharedRatings, cachedRecentReviews, liveRecentlyAdded] = await Promise.all([
          readEdgeCacheJson<any[]>('/__active_promotions_v1'),
          readSharedEdgeRatingsMap(),
          readEdgeCacheJson<any[]>('/__recent_reviews_v1'),
          fetchLiveRecentlyAddedOverlay(
            Array.isArray(cachedCatalog.packages) ? cachedCatalog.packages : [],
            true
          ).catch(() => null)
        ]);
        const rawPromos =
          Array.isArray(cachedActivePromos)
            ? cachedActivePromos
            : Array.isArray(cachedCatalog.promotions) && cachedCatalog.promotions.length > 0
              ? cachedCatalog.promotions
              : getLastKnownActivePromotions(nowMs);
        let overlaidPackages = Array.isArray(cachedCatalog.packages) ? cachedCatalog.packages : [];
        if (Array.isArray(liveRecentlyAdded) && liveRecentlyAdded.length > 0) {
          overlaidPackages = overlayRecentlyAddedOnPackages(overlaidPackages, liveRecentlyAdded);
          edgeBody = {
            ...edgeBody,
            packages: overlaidPackages,
            recentlyAdded: liveRecentlyAdded
          };
        }
        if (Array.isArray(rawPromos)) {
          const validEdgePromos = rawPromos
            .filter((r: any) => isValidActivePromotionRow(r, nowMs))
            .map((r: any) => normalizePromotionRow(r));
          const promoDelta = await syncActivePromotionRowPackages(validEdgePromos, env.DB, false);
          if (promoDelta && overlaidPackages.length > 0) {
            overlaidPackages = overlayPromotionRowDeltaOnCatalog(overlaidPackages, promoDelta);
          }
          edgeBody = {
            ...edgeBody,
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
        if (Array.isArray(cachedRecentReviews)) {
          edgeBody = {
            ...edgeBody,
            recentReviews: enrichRecentReviewsWithCatalog(
              cachedRecentReviews,
              Array.isArray(edgeBody.packages) ? edgeBody.packages : []
            )
          };
        }
      }
      return new Response(JSON.stringify(edgeBody), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isBootBundle
            ? 'public, max-age=60, s-maxage=180, stale-while-revalidate=300'
            : 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600',
          'X-LuantiHub-Cache': 'HIT-EDGE'
        }
      });
    }
  }

  // 1. Fetch Upstream Packages + Bulk Scores/Downloads + Newest ContentDB Packages (with Cloudflare Edge Cache + mirror failover)
  // Cache `/packages/?fmt=vcs` for 30 minutes (1800s) and never block non-boot in-game client requests on `/scores/` network fetches
  // (ContentDB's `/api/scores/` runs 3,700+ N+1 SQL queries on cache miss and Luanti's `contentdb.lua` never reads `score` or `downloads`).
  const upstreamTtl = upstreamPath === '/packages/?fmt=vcs' ? 1800 : 300;
  const upstreamPromise: Promise<any[]> = fetchUpstreamJsonCached<any[]>(upstreamPath, upstreamTtl)
    .then((list): any[] => (Array.isArray(list) ? list : []))
    .catch((): any[] => []);

  const scoresPromise = isBootBundle
    ? fetchUpstreamJsonCached<any[]>('/scores/', 900)
        .then(list => Array.isArray(list) ? list : [])
        .catch(() => [])
    : readEdgeCacheJson<any[]>('/scores/')
        .then(list => Array.isArray(list) ? list : [])
        .catch(() => []);

  const recentUpstreamPromise = isBootBundle
    ? fetchUpstreamJsonCached<any[]>('/packages/?sort=approved_at&order=desc&limit=24&fmt=vcs', 300)
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
  const recentReviewsPromise = isBootBundle
    ? fetchMergedRecentReviews(env.DB, !noCache)
    : Promise.resolve<any[]>([]);
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
          `DELETE FROM packages WHERE provider = 'contentdb' AND author_id IS NULL AND COALESCE(luantihub_downloads, 0) = 0 AND (tags IS NULL OR tags = '' OR tags = '[]') AND (badge_tags IS NULL OR badge_tags = '' OR badge_tags = '[]') AND (dev_state IS NULL OR dev_state = '') AND (translations IS NULL OR translations = '' OR translations = '{}') AND status = 'active'`
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

    const selectCols = isBootBundle
      ? '*'
      : 'id, author_id, author_name, name, title, type, short_desc, status, provider, repo_url, thumbnail_url, banner_url, screenshots, updated_at, created_at, dev_state, tags, badge_tags, content_warnings, dependencies, optional_dependencies, game_support, supports_all_games, translations, license, media_license, min_minetest_version, max_minetest_version, downloads_count, contentdb_downloads, luantihub_downloads, score, review_thread_counts, latest_commit_sha';
    let whereClause = `WHERE status = 'active' AND (provider != 'contentdb' OR author_id IS NOT NULL OR COALESCE(luantihub_downloads, 0) > 0 OR (tags IS NOT NULL AND tags != '' AND tags != '[]') OR (badge_tags IS NOT NULL AND badge_tags != '' AND badge_tags != '[]') OR (dev_state IS NOT NULL AND dev_state != '') OR (translations IS NOT NULL AND translations != '' AND translations != '{}'))`;
    const params: any[] = [];

    const d1Types =
      types.includes('mod') && !types.includes('modpack') ? [...types, 'modpack'] : types;

    if (d1Types.length === 1) {
      whereClause += ` AND type = ?`;
      params.push(d1Types[0]);
    } else if (d1Types.length > 1) {
      const placeholders = d1Types.map(() => '?').join(', ');
      whereClause += ` AND type IN (${placeholders})`;
      params.push(...d1Types);
    }
    if (q) {
      whereClause += ` AND (title LIKE ? OR name LIKE ? OR short_desc LIKE ? OR author_name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (author) {
      whereClause += ` AND LOWER(author_name) = LOWER(?)`;
      params.push(author);
    }

    const orderSuffix = ` ORDER BY downloads_count DESC LIMIT 1000`;
    const query = `SELECT ${selectCols} FROM packages ${whereClause}${orderSuffix}`;
    const fallbackStarQuery = `SELECT * FROM packages ${whereClause}${orderSuffix}`;

    d1Promise = env.DB.prepare(query).bind(...params).all()
      .then((res: any) => res.results || [])
      .catch(async () => {
        try {
          const fbRes = await env.DB.prepare(fallbackStarQuery).bind(...params).all();
          return fbRes?.results || [];
        } catch {
          return [];
        }
      });

    // Instant Kill Switch: fetch any package IDs marked as 'flagged' or 'delisted'
    blockedPromise = env.DB.prepare(
      `SELECT LOWER(id) as id FROM packages WHERE status IN ('flagged', 'delisted')`
    ).all()
      .then((res: any) => new Set<string>((res.results || []).map((r: any) => String(r.id).toLowerCase())))
      .catch(() => new Set<string>());

    // Avoid scanning all historical package_daily_downloads rows on every catalog build;
    // packages.luantihub_downloads already tracks all-time LuantiHub downloads, and velocityPromise covers the 7-day window.
    lhDownloadsMapPromise = Promise.resolve(new Map<string, number>());

    if (isBootBundle) {
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

  // Ensure any newly approved ContentDB packages from `recentUpstreamList` (15m cache) are immediately
  // present in `upstreamList` even if the bulk `/packages/?fmt=vcs` snapshot (30m cache) has not expired yet.
  if (Array.isArray(recentUpstreamList) && recentUpstreamList.length > 0 && recentUpstreamList.length <= 100) {
    const existingUpstreamKeys = new Set<string>();
    for (const item of upstreamList) {
      if (item?.author && item?.name) {
        existingUpstreamKeys.add(`${item.author}/${item.name}`.toLowerCase());
      }
    }
    for (const recentItem of recentUpstreamList.slice(0, 24)) {
      if (recentItem?.author && recentItem?.name) {
        const key = `${recentItem.author}/${recentItem.name}`.toLowerCase();
        if (!existingUpstreamKeys.has(key)) {
          existingUpstreamKeys.add(key);
          upstreamList.push({ ...recentItem });
        }
      }
    }
  }

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
          item.contentdb_score = Math.round(s.score * 10) / 10;
        }
        if (typeof s.score_downloads === 'number') {
          item.score_downloads = Math.round(s.score_downloads * 10) / 10;
        }
        if (typeof s.score_reviews === 'number') {
          item.score_reviews = Math.round(s.score_reviews * 10) / 10;
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
    const parsedBadgeTags = parseBadgeTagsArray(p.badge_tags);
    if (parsedTags.includes(ORGANIC_CODE_TAG) && !parsedBadgeTags.includes(ORGANIC_CODE_TAG)) {
      parsedBadgeTags.push(ORGANIC_CODE_TAG);
    }
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

    const itemStarScore = computeCatalogStarRating(
      {
        ...(matchedUpstream || {}),
        review_thread_counts: effectiveReviewThreadCounts,
        score: (!isAlsoOfficial || effectiveReviewThreadCounts) ? (p.score ?? matchedUpstream?.score) : undefined
      },
      d1StarAvg
    );
    const itemDailyDl = velocity.get(canonicalKey)?.todayDl ?? velocity.get(d1Key)?.todayDl;
    const itemWeeklyDl = velocity.get(canonicalKey)?.weekDl ?? velocity.get(d1Key)?.weekDl;
    const itemConvRate = velocity.get(canonicalKey)?.conversionRate ?? velocity.get(d1Key)?.conversionRate;
    const itemFavCount = favoritesMap.get(canonicalKey) ?? favoritesMap.get(d1Key);
    const frecency = computeLuantiHubFrecencyMetrics({
      dailyDownloads: itemDailyDl,
      weeklyDownloads: itemWeeklyDl,
      luantihubDownloads: lhDownloads,
      conversionRate: itemConvRate,
      score: itemStarScore,
      reviewThreadCounts: effectiveReviewThreadCounts,
      favoritesCount: itemFavCount,
      contentdbScore: Number(matchedUpstream?.contentdb_score ?? matchedUpstream?.score ?? 0),
      contentdbScoreDownloads: Number(matchedUpstream?.score_downloads || 0),
      contentdbScoreReviews: Number(matchedUpstream?.score_reviews || 0)
    });
    const mergedGameSupport = mergeLuantiHubAndContentDbGameSupport(
      p.game_support,
      matchedUpstream?.game_support,
      parsedDeps,
      parsedOptDeps
    );
    const mergedContentWarnings = Array.from(
      new Set([
        ...parseJsonArray(p.content_warnings),
        ...parseJsonArray(matchedUpstream?.content_warnings)
      ])
    );
    const parsedTranslations = parsePackageTranslations(p.translations);

    merged.push({
      ...(matchedUpstream || {}),
      id: `${canonicalAuthor}/${canonicalName}`,
      author: canonicalAuthor,
      ...(authorMeta.author_display_name ? { author_display_name: authorMeta.author_display_name } : {}),
      author_id: authorMeta.author_id,
      name: canonicalName,
      aliases: aliases.length > 0 ? aliases : undefined,
      title: p.title || matchedUpstream?.title || canonicalName,
      type: p.type === 'modpack' ? 'mod' : (p.type || matchedUpstream?.type || 'mod'),
      short_desc: shortDescText,
      short_description: shortDescText,
      ...(parsedTranslations ? { translations: parsedTranslations } : {}),
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
      ...(d1StarAvg > 0 ? { review_score: d1StarAvg } : {}),
      score: itemStarScore,
      contentdb_score: Number(matchedUpstream?.contentdb_score ?? matchedUpstream?.score ?? 0),
      luantihub_score_downloads: frecency.luantihub_score_downloads,
      contentdb_score_downloads: frecency.contentdb_score_downloads,
      score_downloads: frecency.score_downloads,
      score_reviews: frecency.score_reviews,
      contentdb_downloads: cdbDownloads,
      luantihub_downloads: lhDownloads,
      downloads: combinedDownloads,
      license: p.license || matchedUpstream?.license || '',
      media_license: p.media_license || matchedUpstream?.media_license || '',
      repo_url: p.repo_url || matchedUpstream?.repo || matchedUpstream?.repo_url || undefined,
      video_url: p.video_url || matchedUpstream?.video_url || undefined,
      video_thumbnail_url: p.video_thumbnail_url || matchedUpstream?.video_thumbnail_url || undefined,
      dev_state: p.dev_state || matchedUpstream?.dev_state || undefined,
      ...(mergedContentWarnings.length > 0 ? { content_warnings: mergedContentWarnings } : {}),
      ...(p.supports_all_games ? { supports_all_games: true } : typeof matchedUpstream?.supports_all_games === 'boolean' ? { supports_all_games: matchedUpstream.supports_all_games } : {}),
      ...(mergedGameSupport.length > 0 ? { game_support: mergedGameSupport } : {}),
      download_size: Number(p.download_size) > 0 ? Number(p.download_size) : undefined,
      file_size: p.file_size || undefined,
      provider: p.provider || (isGitSource ? 'github' : 'contentdb'),
      min_minetest_version: p.min_minetest_version || matchedUpstream?.min_minetest_version || '5.0.0',
      ...(p.max_minetest_version || matchedUpstream?.max_minetest_version ? { max_minetest_version: p.max_minetest_version || matchedUpstream?.max_minetest_version } : {}),
      tags: combinedTags.length > 0 ? combinedTags : [p.type || 'mod'],
      ...(parsedBadgeTags.length > 0 ? { badge_tags: parsedBadgeTags } : {}),
      dependencies: parsedDeps.length > 0 ? parsedDeps : matchedUpstream?.dependencies,
      optional_dependencies: parsedOptDeps.length > 0 ? parsedOptDeps : matchedUpstream?.optional_dependencies,
      daily_downloads: itemDailyDl,
      weekly_downloads: itemWeeklyDl,
      weekly_views: velocity.get(canonicalKey)?.weekViews ?? velocity.get(d1Key)?.weekViews,
      conversion_rate: itemConvRate,
      dependency_ratio:
        (velocity.get(canonicalKey)?.dependencyRatio ?? velocity.get(d1Key)?.dependencyRatio) || undefined,
      rating_checked: Boolean(effectiveReviewThreadCounts || d1StarAvg > 0),
      favorites_count: itemFavCount,
      url: `/api/packages/${canonicalAuthor}/${canonicalName}/`,
      source: isGitSource ? 'git' : 'official',
      sources
    });
  }

  const sharedEdgeRatings = isBootBundle
    ? await readSharedEdgeRatingsMap().catch(() => ({} as Record<string, SharedEdgeRatingEntry>))
    : ({} as Record<string, SharedEdgeRatingEntry>);

  // 5. Append Upstream ContentDB packages (including any newly approved items in `recentUpstreamList` not yet in the 30-min `/packages/?fmt=vcs` cache)
  const combinedUpstreamList =
    isBootBundle && Array.isArray(recentUpstreamList) && recentUpstreamList.length > 0 && recentUpstreamList.length <= 100
      ? [...upstreamList, ...recentUpstreamList]
      : upstreamList;
  for (const item of combinedUpstreamList) {
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
    const hasExplicitZeroUpstreamReviews =
      !upstreamRevCounts &&
      !(d1StarAvg && d1StarAvg > 0) &&
      ((item.reviews &&
        Number(item.reviews.positive || 0) === 0 &&
        Number(item.reviews.neutral || 0) === 0 &&
        Number(item.reviews.negative || 0) === 0) ||
        (item.score_reviews !== undefined && Number(item.score_reviews) <= 0));
    const resolvedScore =
      computedScore > 0
        ? computedScore
        : (!hasExplicitZeroUpstreamReviews && sharedRating?.review_thread_counts ? (sharedRating?.score || 0) : 0);
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
    const upstreamFrecency = computeLuantiHubFrecencyMetrics({
      dailyDownloads: vel?.todayDl,
      weeklyDownloads: vel?.weekDl,
      luantihubDownloads: lhDl,
      conversionRate: vel?.conversionRate,
      score: resolvedScore,
      reviewThreadCounts: upstreamRevCounts,
      favoritesCount: favCnt,
      contentdbScore: Number(item.contentdb_score ?? item.score ?? 0),
      contentdbScoreDownloads: Number(item.score_downloads || 0),
      contentdbScoreReviews: Number(item.score_reviews || 0)
    });
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
      ...(d1StarAvg && d1StarAvg > 0 ? { review_score: d1StarAvg, rating_checked: true } : {}),
      score: resolvedScore,
      contentdb_score: Number(item.contentdb_score ?? item.score ?? 0),
      luantihub_score_downloads: upstreamFrecency.luantihub_score_downloads,
      contentdb_score_downloads: upstreamFrecency.contentdb_score_downloads,
      score_downloads: upstreamFrecency.score_downloads,
      score_reviews: upstreamFrecency.score_reviews,
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
  if (isBootBundle) {
    const reverseDepCountMap = buildReverseDependencyCountMap(merged);
    for (const pkg of merged) {
      const revCnt = reverseDepCountMap.get(String(pkg.name || '').trim().toLowerCase()) || 0;
      if (revCnt > 0) {
        pkg.reverse_dep_count = revCnt;
      }
      const lowerKey = String(pkg.id || '').toLowerCase();
      const sharedEntry = sharedEdgeRatings[lowerKey];
      if (sharedEntry) {
        if (sharedEntry.checked && sharedEntry.score === 0 && !pkg.review_thread_counts && !d1Ratings.get(lowerKey)) {
          pkg.score = 0;
          pkg.rating_checked = true;
        } else if (!(pkg.score > 0) && sharedEntry.score > 0 && (sharedEntry.review_thread_counts || pkg.review_thread_counts)) {
          pkg.score = sharedEntry.score;
        }
        if (!pkg.review_thread_counts && sharedEntry.review_thread_counts) {
          pkg.review_thread_counts = sharedEntry.review_thread_counts;
          pkg.rating_checked = true;
        }
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
    pushPool(recentUpstreamMerged.slice(0, 12));
    if (promoDelta && Object.keys(promoDelta.tagMap || {}).length > 0) {
      const promoPkgKeys = new Set(Object.keys(promoDelta.tagMap));
      pushPool(merged.filter(p => promoPkgKeys.has(String(p.id || '').toLowerCase())).slice(0, 8));
    }
    pushPool(merged.filter(p => p.sources?.includes('git')));
    pushPool(top10Today);
    pushPool(top10Week);
    pushPool(byDownloadsDesc.filter(p => p.type === 'game').slice(0, 12));
    pushPool(byDownloadsDesc.filter(p => p.type === 'mod').slice(0, 12));
    pushPool(byDownloadsDesc.filter(p => p.type === 'txp').slice(0, 12));

    const batchToHydrate = carouselPool.slice(0, 20);
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
          if (detail?.created_at || detail?.approved_at) {
            const normExisting = pkg.created_at ? normalizeUtcIsoTimestamp(pkg.created_at) : '';
            const normCreated = detail?.created_at ? normalizeUtcIsoTimestamp(detail.created_at) : '';
            const normApproved = detail?.approved_at ? normalizeUtcIsoTimestamp(detail.approved_at) : '';
            const candidates = [normApproved, normCreated, normExisting]
              .filter(Boolean)
              .map(iso => ({ iso, ms: Date.parse(iso) }))
              .filter(c => Number.isFinite(c.ms) && c.ms > 0);
            if (candidates.length > 0) {
              candidates.sort((a, b) => b.ms - a.ms);
              pkg.created_at = candidates[0].iso;
            } else if (!pkg.created_at) {
              pkg.created_at = normApproved || normCreated;
            }
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
          const d1PkgRating = d1Ratings.get(lowerPkgKey);
          const hydratedScore = computeCatalogStarRating(
            {
              ...detail,
              review_thread_counts: pkg.review_thread_counts,
              reviews_list: cdbRevList,
              score: pkg.review_thread_counts ? pkg.score : undefined
            },
            d1PkgRating
          );
          if (hydratedScore > 0) {
            pkg.score = hydratedScore;
          } else if (
            Array.isArray(cdbRevList) &&
            cdbRevList.length === 0 &&
            !pkg.review_thread_counts &&
            !(d1PkgRating && d1PkgRating > 0)
          ) {
            pkg.score = 0;
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

    // Build Recently Added list (up to 24 active non-deprecated packages across Git + ContentDB) with live approval timestamp tracking.
    const recentlyAdded = await applyApprovalTrackingAndBuildRecentlyAdded(
      recentUpstreamMerged,
      merged,
      recentUpstreamRankById,
      !noCache
    );
    const finalMergedPackages = overlayRecentlyAddedOnPackages(merged, recentlyAdded);
    if (!noCache && !q && types.length === 0 && !author && recentlyAdded.length > 0) {
      await writeEdgeCacheJson('/__api_boot_recently_added_v1', recentlyAdded, 300).catch(() => {});
    }

    responsePayload = {
      packages: finalMergedPackages,
      tags,
      top10Week,
      top10Today,
      recentlyAdded,
      ...(Array.isArray(activePromotions) ? { promotions: activePromotions } : {}),
      latestBlogPost: latestBlogPost || null,
      recentReviews: enrichRecentReviewsWithCatalog(
        Array.isArray(recentReviews) ? recentReviews : [],
        finalMergedPackages
      )
    };

    if (!noCache && !q && types.length === 0 && !author && Array.isArray(activePromotions)) {
      await writeEdgeCacheJson(bootEdgeCacheKey, responsePayload, 1800);
    }
  } else {
    // Compact ContentDB-compatible payload for in-game Luanti C++ client (`contentdb.lua` / `dlg_contentdb.lua`)
    responsePayload = buildInGameClientCatalogResponse(merged);
  }

  if (!isBootBundle && !noCache && catalogEdgeCacheKey) {
    await writeEdgeCacheJson(catalogEdgeCacheKey, responsePayload, 1800);
  }

  return new Response(JSON.stringify(responsePayload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': !noCache
        ? (isBootBundle
            ? 'public, max-age=60, s-maxage=180, stale-while-revalidate=300'
            : 'public, max-age=120, s-maxage=1800, stale-while-revalidate=3600')
        : 'no-cache, no-store, must-revalidate',
      'X-LuantiHub-Cache': !noCache ? 'MISS-EDGE' : 'BYPASS'
    }
  });
}

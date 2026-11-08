import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  parseJsonArray,
  detectSpdxFromText,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  fetchGitRepoReleasesAndTags,
  fetchGitSmartHttpRefs,
  syncDebouncedGitVersionStamp,
  buildGitBranchArchiveUrl,
  rewriteRelativeMarkdownUrls,
  ensureExtendedPackageColumns,
  extractLongDescriptionText,
  extractEmbeddedVideo,
  ensureModerationColumns,
  autoResolveBrokenRepoReport,
  parseCdbJsonMetadata,
  CdbJsonMetadata,
  scanGitRepoMetadataCached,
  GitRepoScanResult,
  normalizeContentDbReviewItem,
  sanitizePublicErrorMessage,
  fetchAccurateGitZipSize,
  fetchRepoSizeEstimateFromUrl,
  parseDownloadSizeBytes,
  formatByteSize,
  extractEngineVersionString,
  parseNonZeroReviewThreadCounts,
  deriveReviewThreadCountsFromList,
  computeStarRatingFromData,
  normalizeGitRepoInputUrl,
  sortAndCapReleases,
  mergeUpstreamAndGitReleases,
  sanitizeReleaseNotesText,
  fetchRepoReadmeCached,
  MAX_PACKAGE_RELEASES,
  isGitRepositoryAssetUrl,
  isDeadMirrorScreenshotUrl,
  sanitizePackageImageUrl,
  formatContentDbCdnUrl,
  isContentDbThumbnailUrl,
  upgradeContentDbThumbnailUrl,
  selectSharpPackageBanner,
  toProxiedGitImageIfNeeded,
  mergeScreenshotsPreferringGit,
  upsertCustomAppTags,
  upsertMetadataOptions,
  resolveBadgeTagItemsForCatalog,
  LUANTIHUB_DEV_STATES,
  LUANTIHUB_CONTENT_WARNINGS,
  LUANTIHUB_BADGE_TAGS,
  ORGANIC_CODE_TAG,
  parseBadgeTagsArray,
  parseGameSupportArray,
  mergeLuantiHubAndContentDbGameSupport,
  computeLuantiHubFrecencyMetrics,
  parsePackageTranslations,
  resolveLocalizedPackageText,
  parseScreenshotMetaArray,
  buildPackageDetailEdgeCacheKey,
  buildPackageCacheInvalidationKeys,
  BOOT_CATALOG_EDGE_CACHE_KEY
} from '../../../lib/upstream';
import { fetchJam2026FallbackReadme } from '../../../lib/jam-2026';
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount,
  verifyStrictPackageAuthorOwnership,
  shouldHonorAuthenticatedNoCache
} from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

function computeStarRating(upstreamData: any, _d1Score?: number, d1ReviewAvg?: number): number {
  return computeStarRatingFromData(upstreamData, 0, d1ReviewAvg);
}

function extractDependencies(
  upstreamData: any,
  depsPayload: any,
  pkgKey: string
): { hardDeps: string[]; softDeps: string[] } {
  const hardSet = new Set<string>();
  const softSet = new Set<string>();

  const addDep = (target: Set<string>, item: any) => {
    if (!item) return;
    if (typeof item === 'string') {
      const clean = item.trim();
      if (clean) target.add(clean);
    } else if (typeof item === 'object') {
      const depName = item.name || item.id || (Array.isArray(item.packages) && item.packages[0]);
      if (typeof depName === 'string' && depName.trim()) {
        if (item.is_optional) {
          softSet.add(depName.trim());
        } else {
          target.add(depName.trim());
        }
      }
    }
  };

  if (Array.isArray(upstreamData?.hard_dependencies)) {
    upstreamData.hard_dependencies.forEach((d: any) => addDep(hardSet, d));
  } else if (Array.isArray(upstreamData?.dependencies)) {
    upstreamData.dependencies.forEach((d: any) => addDep(hardSet, d));
  }

  if (Array.isArray(upstreamData?.soft_dependencies)) {
    upstreamData.soft_dependencies.forEach((d: any) => addDep(softSet, d));
  } else if (Array.isArray(upstreamData?.optional_dependencies)) {
    upstreamData.optional_dependencies.forEach((d: any) => addDep(softSet, d));
  }

  if (depsPayload) {
    let list: any[] = [];
    if (Array.isArray(depsPayload)) {
      list = depsPayload;
    } else if (typeof depsPayload === 'object') {
      const exact = depsPayload[pkgKey] || depsPayload[pkgKey.toLowerCase()];
      if (Array.isArray(exact)) {
        list = exact;
      } else {
        const lowerKey = pkgKey.toLowerCase();
        const ciMatchKey = Object.keys(depsPayload).find((k) => k.toLowerCase() === lowerKey);
        if (ciMatchKey && Array.isArray(depsPayload[ciMatchKey])) {
          list = depsPayload[ciMatchKey];
        } else {
          const firstArray = Object.values(depsPayload).find((v) => Array.isArray(v)) as any[] | undefined;
          if (firstArray) list = firstArray;
        }
      }
    }
    for (const dep of list) {
      if (dep && typeof dep === 'object') {
        const depName = dep.name || (Array.isArray(dep.packages) && dep.packages[0]);
        if (typeof depName === 'string' && depName.trim()) {
          if (dep.is_optional) {
            softSet.add(depName.trim());
          } else {
            hardSet.add(depName.trim());
          }
        }
      } else if (typeof dep === 'string') {
        hardSet.add(dep.trim());
      }
    }
  }

  // Ensure optional deps don't duplicate required deps
  for (const h of hardSet) {
    softSet.delete(h);
  }

  return {
    hardDeps: Array.from(hardSet),
    softDeps: Array.from(softSet)
  };
}

async function resolveArchiveSizeCached(downloadUrl?: string): Promise<string | undefined> {
  if (!downloadUrl || !downloadUrl.startsWith('http')) return undefined;
  const cacheKeyUrl = `https://cache.luantihub.internal/filesize_v2?url=${encodeURIComponent(downloadUrl)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const data = await cached.json() as { size?: string };
        return data.size;
      }
    } catch {
      // Ignore cache read error
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(downloadUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luantihub.org)'
      }
    });
    clearTimeout(timeoutId);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    // Never accept Content-Length from HTML error pages or JSON responses
    if (!res.ok || contentType.includes('text/') || contentType.includes('json')) {
      return undefined;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (!Number.isFinite(len) || len <= 0) return undefined;
    const formatted = formatByteSize(len);
    if (formatted && edgeCache) {
      try {
        await edgeCache.put(
          cacheReq,
          new Response(JSON.stringify({ size: formatted }), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=86400, s-maxage=86400'
            }
          })
        );
      } catch {
        // Ignore cache write error
      }
    }
    return formatted;
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

function normalizeDefunctGitHost(rawUrl?: string): string | undefined {
  const normalized = normalizeGitRepoInputUrl(rawUrl);
  return normalized || undefined;
}

async function probeGitRepoConfAndLicense(
  author: string,
  name: string,
  pkgType = 'mod',
  existingRepoUrl?: string
): Promise<GitRepoScanResult> {
  return scanGitRepoMetadataCached(author, name, pkgType, existingRepoUrl, 21600);
}

function buildNormalizedReleases(
  author: string,
  name: string,
  d1Releases: any[],
  upstreamReleases: any[] | null,
  gitReleases: any[] = []
): any[] {
  const hasUpstream = Array.isArray(upstreamReleases) && upstreamReleases.length > 0;
  let baseList: any[] = [];

  if (hasUpstream) {
    const encAuthor = encodeURIComponent(author);
    const encName = encodeURIComponent(name);
    baseList = upstreamReleases!.map((r: any) => {
      const rawUrl = r.url || '';
      const fullDownloadUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl
          ? `https://content.luanti.org${rawUrl}`
          : `https://content.luanti.org/packages/${encAuthor}/${encName}/releases/${r.id}/download/`;
      const rawBytes = Number(r.size || r.file_size || r.download_size || 0);

      const cleanNotes = sanitizeReleaseNotesText(r.release_notes, String(r.title || r.name || r.id || ''));

      return {
        id: r.id,
        version: String(r.title || r.name || r.id || 'latest'),
        title: String(r.title || r.name || r.id || 'Release'),
        tag_name: String(r.title || r.name || r.id || 'latest'),
        commit_sha: r.commit || '',
        url: fullDownloadUrl,
        download_url: fullDownloadUrl,
        size: rawBytes > 0 ? rawBytes : undefined,
        file_size: rawBytes > 0 ? formatByteSize(rawBytes) : undefined,
        downloads: typeof r.downloads === 'number' ? r.downloads : undefined,
        release_notes: cleanNotes,
        changelog: cleanNotes,
        sha256: typeof r.sha256 === 'string' && r.sha256.trim() ? r.sha256.trim() : undefined,
        min_minetest_version: extractEngineVersionString(r.min_minetest_version) || r.min_protocol_version || undefined,
        max_minetest_version: extractEngineVersionString(r.max_minetest_version) || r.max_protocol_version || undefined,
        release_date: r.release_date || undefined,
        released_at: r.release_date || ''
      };
    });
  } else if (Array.isArray(d1Releases) && d1Releases.length > 0) {
    baseList = d1Releases.map((r: any) => {
      const cleanNotes = sanitizeReleaseNotesText(r.changelog || r.release_notes, String(r.tag_name || r.version || ''));
      return {
        id: r.id,
        version: r.tag_name || r.version,
        title: r.title || r.tag_name || r.version,
        tag_name: r.tag_name || r.version,
        commit_sha: r.commit_sha,
        url: r.download_url || r.url,
        download_url: r.download_url || r.url,
        size: r.size || r.file_size || undefined,
        file_size: typeof r.file_size === 'string' ? r.file_size : (Number(r.size) > 0 ? formatByteSize(Number(r.size)) : undefined),
        min_minetest_version: r.min_minetest_version,
        max_minetest_version: r.max_minetest_version,
        changelog: cleanNotes,
        release_notes: cleanNotes,
        release_date: r.released_at || r.release_date,
        released_at: r.released_at || r.release_date
      };
    });
  }

  if (Array.isArray(gitReleases) && gitReleases.length > 0) {
    return mergeUpstreamAndGitReleases(baseList, gitReleases, author, name, {
      usePackagedDownloadUrls: false,
      isOfficialContentDbBase: hasUpstream
    });
  }

  return sortAndCapReleases(baseList, MAX_PACKAGE_RELEASES);
}

function buildNormalizedReviews(d1Reviews: any[], upstreamReviews: any[] | null, packageId?: string): any[] {
  const normalizedOfficial = (Array.isArray(upstreamReviews) ? upstreamReviews : []).map((r: any, idx: number) =>
    normalizeContentDbReviewItem(r, idx, packageId)
  );

  const normalizedLocal = (Array.isArray(d1Reviews) ? d1Reviews : []).map((r: any) => ({
    id: `lh_${r.id}`,
    ...(packageId ? { package_id: packageId } : {}),
    source: 'luantihub',
    rating: r.rating || 5,
    title: r.title,
    comment: r.comment,
    created_at: r.created_at,
    author: {
      username: r.username,
      display_name: r.display_name || r.username,
      avatar_url: r.avatar_url || `https://github.com/${r.username}.png`
    }
  }));

  return [...normalizedLocal, ...normalizedOfficial].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

const recentWebViewWrites = new Map<string, number>();
const WEB_VIEW_COOLDOWN_MS = 10 * 60 * 1000;

async function recordWebPackageView(
  db: any,
  request: Request | undefined,
  packageId: string,
  sessionSecret?: string
): Promise<boolean> {
  if (!db || !request || !packageId) return false;
  const purpose = (
    request.headers.get('Sec-Purpose') ||
    request.headers.get('Purpose') ||
    request.headers.get('X-Purpose') ||
    request.headers.get('X-Moz') ||
    ''
  ).toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview') || purpose.includes('prerender')) {
    return false;
  }
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  if (/(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|discordbot|telegrambot|slackbot|whatsapp|headlesschrome|lighthouse)/i.test(ua)) {
    return false;
  }
  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous';
  const normalizedPkg = packageId.toLowerCase();
  const key = `${clientIp}:${normalizedPkg}`;
  const now = Date.now();
  if (recentWebViewWrites.size > 2000) {
    for (const [k, exp] of recentWebViewWrites.entries()) {
      if (exp <= now) recentWebViewWrites.delete(k);
    }
  }
  const exp = recentWebViewWrites.get(key);
  if (exp && exp > now) return false;

  const edgeDedupKey = `/dedup/webview/${encodeURIComponent(clientIp)}/${encodeURIComponent(normalizedPkg)}`;
  const cachedHit = await readEdgeCacheJson<{ ts: number }>(edgeDedupKey);
  if (cachedHit) {
    recentWebViewWrites.set(key, now + WEB_VIEW_COOLDOWN_MS);
    return false;
  }

  recentWebViewWrites.set(key, now + WEB_VIEW_COOLDOWN_MS);
  await writeEdgeCacheJson(edgeDedupKey, { ts: now }, 600);

  try {
    await db.prepare(`
      INSERT INTO package_daily_downloads (package_id, download_date, downloads_count, views_web)
      VALUES (?, DATE('now'), 0, 1)
      ON CONFLICT(package_id, download_date)
      DO UPDATE SET views_web = COALESCE(views_web, 0) + 1
    `).bind(packageId).run();

    const cookies = parseCookies(request);
    const sessionToken = cookies['lh_session'];
    const userId = sessionToken
      ? await verifySessionToken(sessionToken, sessionSecret)
      : null;

    if (userId) {
      await db.prepare(`
        INSERT INTO user_views (user_id, package_id, view_count, last_viewed_at)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, package_id)
        DO UPDATE SET
          view_count = view_count + 1,
          last_viewed_at = CURRENT_TIMESTAMP
      `).bind(userId, packageId).run().catch(() => {});
    }
    return true;
  } catch {
    // Non-blocking view telemetry
    return false;
  }
}

export async function onRequestGet(context: { request?: Request; params: { author: string; name: string }; env: Env }) {
  const author = safeDecodeParam(context.params.author);
  const name = safeDecodeParam(context.params.name);
  const pkgId = `${author}/${name}`;
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const isLite = reqUrl?.searchParams.get('lite') === '1';
  const requestedNoCache =
    reqUrl?.searchParams.get('nocache') === '1' || reqUrl?.searchParams.get('refresh') === '1';
  const noCache = requestedNoCache
    ? await shouldHonorAuthenticatedNoCache(
        context.request,
        context.env.SESSION_SECRET,
        `pkg-detail:${pkgId}`
      )
    : false;
  const wantsReadme = reqUrl?.searchParams.get('readme') === '1';
  const rawLang =
    reqUrl?.searchParams.get('lang') ||
    (context.request?.headers.get('Accept-Language') || '').split(',')[0]?.split('-')[0] ||
    'en';
  const normalizedLang = String(rawLang || 'en').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'en';
  const edgeCacheKey = buildPackageDetailEdgeCacheKey(
    author,
    name,
    isLite ? 'lite' : wantsReadme ? 'full-readme' : 'full',
    normalizedLang
  );

  if (!isLite && context.env.DB) {
    const viewTask = recordWebPackageView(context.env.DB, context.request, pkgId, context.env.SESSION_SECRET);
    if (typeof (context as any).waitUntil === 'function') {
      (context as any).waitUntil(viewTask);
    } else {
      await viewTask;
    }
  }

  if (!noCache) {
    const cachedEdge = await readEdgeCacheJson<any>(edgeCacheKey);
    if (cachedEdge) {
      return new Response(JSON.stringify(cachedEdge), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isLite
            ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
            : 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400'
        }
      });
    }
  }

  // 1. Check Cloudflare D1 (including Instant Kill Switch status check + local D1 reviews, releases & downloads)
  let d1Pkg: any = null;
  let d1ReviewAvg: number | undefined;
  let d1Releases: any[] = [];
  let d1Reviews: any[] = [];
  let d1DailyDownloadsSum = 0;
  let d1FavoritesCount = 0;
  if (context.env.DB) {
    d1Pkg = await context.env.DB.prepare(
      `SELECT * FROM packages WHERE id IN (?, ?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
    ).bind(pkgId, pkgId.toLowerCase(), author, name).first();

    if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
      return Response.json({
        error: 'This package has been delisted or suspended by moderation.',
        status: d1Pkg.status,
        reason: d1Pkg.status_reason || 'Policy / DMCA Compliance'
      }, {
        status: 451,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (d1Pkg) {
      if (isDeadMirrorScreenshotUrl(d1Pkg.thumbnail_url)) {
        d1Pkg.thumbnail_url = null;
      }
      if (isDeadMirrorScreenshotUrl(d1Pkg.banner_url)) {
        d1Pkg.banner_url = null;
      }
      if (typeof d1Pkg.screenshots === 'string' && d1Pkg.screenshots.includes('/storage/screenshots/')) {
        const cleanedShots = parseJsonArray(d1Pkg.screenshots).filter(s => !isDeadMirrorScreenshotUrl(s));
        d1Pkg.screenshots = cleanedShots.length > 0 ? JSON.stringify(cleanedShots) : null;
      }
    }

    const effectivePkgId = d1Pkg?.id || pkgId;
    const effectivePkgIdLower = String(effectivePkgId).toLowerCase();

    // Fast path for ?lite=1 when D1 already holds hydrated ContentDB downloads & license
    const d1TagsFast = d1Pkg ? parseJsonArray(d1Pkg.tags) : [];
    const isGitFast = Boolean(d1Pkg && (d1Pkg.provider !== 'contentdb' || d1TagsFast.includes('git')));
    const isOfficialFast = Boolean(
      d1Pkg && (d1Pkg.provider === 'contentdb' || Number(d1Pkg.contentdb_downloads || 0) > 0 || d1TagsFast.includes('contentdb'))
    );
    const hasHydratedDownloads =
      Number(d1Pkg?.contentdb_downloads || 0) > 0 ||
      (!isOfficialFast && Number(d1Pkg?.downloads_count || 0) > 0);

    const d1ParsedRevCounts = parseNonZeroReviewThreadCounts(d1Pkg?.review_thread_counts);
    if (d1Pkg && !d1ParsedRevCounts && d1Pkg.review_thread_counts) {
      d1Pkg.review_thread_counts = null;
    }
    const hasCdbRevCountsInD1 = Boolean(d1ParsedRevCounts);
    const hasValidD1ThumbOrBanner = Boolean(
      sanitizePackageImageUrl(d1Pkg?.thumbnail_url) || sanitizePackageImageUrl(d1Pkg?.banner_url)
    );

    if (
      isLite &&
      d1Pkg &&
      d1Pkg.license &&
      hasHydratedDownloads &&
      hasValidD1ThumbOrBanner &&
      (!isOfficialFast || hasCdbRevCountsInD1)
    ) {
      const hasStoredGitShotLite =
        isGitRepositoryAssetUrl(d1Pkg.thumbnail_url) || isGitRepositoryAssetUrl(d1Pkg.banner_url);
      const [revAvgFast, liteGitScan] = await Promise.all([
        context.env.DB.prepare(
          `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE package_id IN (?, ?)`
        ).bind(effectivePkgId, effectivePkgIdLower).first().catch(() => null),
        (!d1Pkg.video_url || !hasStoredGitShotLite) && d1Pkg.repo_url
          ? scanGitRepoMetadataCached(
              d1Pkg.author_name || author,
              d1Pkg.name || name,
              d1Pkg.type || 'mod',
              d1Pkg.repo_url,
              21600
            ).catch(() => null)
          : Promise.resolve(null)
      ]);
      const liteVideo = extractEmbeddedVideo(
        d1Pkg.video_url || liteGitScan?.cdbMeta?.video_url,
        d1Pkg.video_thumbnail_url,
        d1Pkg.long_desc
      );
      const liteGitShotRaw =
        liteGitScan?.screenshotUrl ||
        (isGitRepositoryAssetUrl(d1Pkg.banner_url) ? String(d1Pkg.banner_url) : undefined) ||
        (isGitRepositoryAssetUrl(d1Pkg.thumbnail_url) ? String(d1Pkg.thumbnail_url) : undefined);
      const liteGitShot = liteGitShotRaw ? toProxiedGitImageIfNeeded(liteGitShotRaw) : undefined;
      const nonGitLiteThumb =
        d1Pkg.thumbnail_url && d1Pkg.thumbnail_url !== 'logo.svg' && !isGitRepositoryAssetUrl(d1Pkg.thumbnail_url)
          ? upgradeContentDbThumbnailUrl(String(d1Pkg.thumbnail_url))
          : undefined;
      const liteScreenshots = mergeScreenshotsPreferringGit(
        [liteGitShot, nonGitLiteThumb],
        liteGitScan?.screenshots,
        parseJsonArray(d1Pkg.screenshots)
      );
      const nonGitLiteThumbFormatted =
        (liteScreenshots.find(s => !isGitRepositoryAssetUrl(s))
          ? formatContentDbCdnUrl(liteScreenshots.find(s => !isGitRepositoryAssetUrl(s)), 'tile')
          : undefined) ||
        (nonGitLiteThumb ? formatContentDbCdnUrl(nonGitLiteThumb, 'tile') || nonGitLiteThumb : undefined);
      if (
        d1Pkg.provider !== 'contentdb' &&
        ((!d1Pkg.video_url && liteVideo.video_url) || (!hasStoredGitShotLite && liteGitShot))
      ) {
        context.env.DB.prepare(`
          UPDATE packages
          SET video_url = COALESCE(video_url, ?),
              video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
              thumbnail_url = CASE
                WHEN COALESCE(thumbnail_url, '') = '' OR thumbnail_url = 'logo.svg' THEN COALESCE(?, thumbnail_url)
                ELSE thumbnail_url
              END,
              banner_url = COALESCE(?, banner_url),
              screenshots = COALESCE(?, screenshots)
          WHERE id = ?
        `).bind(
          liteVideo.video_url || null,
          liteVideo.video_thumbnail_url || null,
          liteGitShot || null,
          liteGitShot || null,
          liteScreenshots.length > 0 ? JSON.stringify(liteScreenshots) : null,
          d1Pkg.id
        ).run().catch(() => {});
      }
      const fastRevAvgVal =
        revAvgFast && Number(revAvgFast.cnt) > 0 && revAvgFast.avg_rating != null
          ? Number(revAvgFast.avg_rating)
          : undefined;
      const fastStarScore = computeStarRating(
        { review_thread_counts: d1ParsedRevCounts, score: d1Pkg.score },
        d1Pkg.score,
        fastRevAvgVal
      );
      const cdbDl = Number(d1Pkg.contentdb_downloads || 0);
      const lhDl = Number(d1Pkg.luantihub_downloads || 0);
      const totalDl = Math.max(Number(d1Pkg.downloads_count || 0), cdbDl + lhDl);
      const fastSources: Array<'official' | 'git'> = [];
      if (isOfficialFast) fastSources.push('official');
      if (isGitFast) fastSources.push('git');
      if (fastSources.length === 0) fastSources.push('official');

      const fastLitePayload = {
        id: d1Pkg.id,
        author: d1Pkg.author_name || author,
        author_id: d1Pkg.author_id && !String(d1Pkg.author_id).startsWith('ext_') ? String(d1Pkg.author_id) : undefined,
        name: d1Pkg.name || name,
        title: d1Pkg.title || name,
        type: d1Pkg.type || 'mod',
        short_desc: d1Pkg.short_desc || '',
        thumbnail: toProxiedGitImageIfNeeded(
          nonGitLiteThumbFormatted ||
          liteGitShot ||
          (d1Pkg.thumbnail_url && d1Pkg.thumbnail_url !== 'logo.svg' ? upgradeContentDbThumbnailUrl(d1Pkg.thumbnail_url) : undefined)
        ) || undefined,
        banner: selectSharpPackageBanner(
          liteGitShot,
          liteScreenshots,
          d1Pkg.banner_url,
          nonGitLiteThumbFormatted,
          d1Pkg.thumbnail_url
        ) || undefined,
        screenshots: liteScreenshots.length > 0 ? liteScreenshots : undefined,
        license: d1Pkg.license,
        media_license: d1Pkg.media_license || d1Pkg.license,
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        contentdb_downloads: cdbDl,
        luantihub_downloads: lhDl,
        downloads: totalDl,
        score: fastStarScore,
        review_thread_counts: d1ParsedRevCounts,
        download_size: Number(d1Pkg.download_size || 0) > 0 ? Number(d1Pkg.download_size) : undefined,
        file_size: d1Pkg.file_size || formatByteSize(d1Pkg.download_size),
        video_url: liteVideo.video_url || undefined,
        video_thumbnail_url: liteVideo.video_thumbnail_url || undefined,
        tags: d1TagsFast.length > 0 ? d1TagsFast : [d1Pkg.type || 'mod'],
        badge_tags: parseBadgeTagsArray(d1Pkg.badge_tags),
        source: isGitFast ? 'git' : 'official',
        sources: fastSources,
        git_repo_status: d1Pkg.repo_url ? 'verified' : 'unverified'
      };
      await writeEdgeCacheJson(edgeCacheKey, fastLitePayload, 1800);
      return new Response(JSON.stringify(fastLitePayload), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
        }
      });
    }

    try {
      if (isLite) {
        const [revAvgRow, dailyDlRow, favRow] = await Promise.all([
          context.env.DB.prepare(
            `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE package_id IN (?, ?)`
          ).bind(effectivePkgId, effectivePkgIdLower).first().catch(() => null),
          context.env.DB.prepare(
            `SELECT COALESCE(SUM(downloads_count), 0) as total_lh FROM package_daily_downloads WHERE package_id IN (?, ?)`
          ).bind(effectivePkgId, effectivePkgIdLower).first().catch(() => ({ total_lh: 0 })),
          context.env.DB.prepare(
            `SELECT COUNT(*) as cnt FROM user_favorites WHERE LOWER(package_id) IN (?, ?)`
          ).bind(effectivePkgIdLower, pkgId.toLowerCase()).first().catch(() => ({ cnt: 0 }))
        ]);
        if (revAvgRow && Number(revAvgRow.cnt) > 0 && revAvgRow.avg_rating != null) {
          d1ReviewAvg = Number(revAvgRow.avg_rating);
        } else if (d1Pkg && !hasCdbRevCountsInD1 && !isOfficialFast && Number(d1Pkg.score) > 0) {
          d1Pkg.score = 0;
          context.env.DB.prepare(`UPDATE packages SET score = 0 WHERE id = ?`).bind(d1Pkg.id).run().catch(() => {});
        }
        d1DailyDownloadsSum = Number(dailyDlRow?.total_lh || 0);
        d1FavoritesCount = Number(favRow?.cnt || 0);
      } else {
        const [revRowsRes, relRowsRes, dailyDlRow, favRow] = await Promise.all([
          context.env.DB.prepare(`
            SELECT r.id, r.rating, r.title, r.comment, r.created_at,
                   u.username, u.display_name, u.avatar_url
            FROM reviews r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.package_id IN (?, ?)
            ORDER BY r.created_at DESC
          `).bind(effectivePkgId, effectivePkgIdLower).all().catch(() => ({ results: [] })),
          context.env.DB.prepare(
            `SELECT * FROM releases WHERE package_id IN (?, ?) ORDER BY released_at DESC`
          ).bind(effectivePkgId, effectivePkgIdLower).all().catch(() => ({ results: [] })),
          context.env.DB.prepare(
            `SELECT COALESCE(SUM(downloads_count), 0) as total_lh FROM package_daily_downloads WHERE package_id IN (?, ?)`
          ).bind(effectivePkgId, effectivePkgIdLower).first().catch(() => ({ total_lh: 0 })),
          context.env.DB.prepare(
            `SELECT COUNT(*) as cnt FROM user_favorites WHERE LOWER(package_id) IN (?, ?)`
          ).bind(effectivePkgIdLower, pkgId.toLowerCase()).first().catch(() => ({ cnt: 0 }))
        ]);

        d1Reviews = revRowsRes?.results || [];
        if (d1Reviews.length > 0) {
          const sum = d1Reviews.reduce((acc: number, r: any) => acc + (Number(r.rating) || 5), 0);
          d1ReviewAvg = sum / d1Reviews.length;
        } else if (d1Pkg && !hasCdbRevCountsInD1 && !isOfficialFast && Number(d1Pkg.score) > 0) {
          // Heal legacy DEFAULT 5.0 score in D1 when no reviews exist on a pure non-ContentDB package
          d1Pkg.score = 0;
          context.env.DB.prepare(`UPDATE packages SET score = 0 WHERE id = ?`).bind(d1Pkg.id).run().catch(() => {});
        }
        d1Releases = relRowsRes?.results || [];
        d1DailyDownloadsSum = Number(dailyDlRow?.total_lh || 0);
        d1FavoritesCount = Number(favRow?.cnt || 0);

        // D1-First Full Detail Fast Path: when D1 already holds genuinely hydrated full detail metadata + screenshots, serve directly in <15ms
        const d1Screenshots = d1Pkg ? parseJsonArray(d1Pkg.screenshots) : [];
        const hasHydratedFullDetail =
          Boolean(d1Pkg?.long_desc && String(d1Pkg.long_desc).trim().length > 0) ||
          (!isOfficialFast && d1Screenshots.length > 0);

        if (
          !noCache &&
          !wantsReadme &&
          d1Pkg &&
          d1Pkg.license &&
          hasHydratedFullDetail
        ) {
          const d1GameSupport = parseJsonArray(d1Pkg.game_support);
          let parsedRevCounts = d1ParsedRevCounts;
          const expectedCdbCount =
            Number(parsedRevCounts?.positive || 0) +
            Number(parsedRevCounts?.neutral || 0) +
            Number(parsedRevCounts?.negative || 0);
          const hasStoredGitShotFast =
            isGitRepositoryAssetUrl(d1Pkg.thumbnail_url) || isGitRepositoryAssetUrl(d1Pkg.banner_url);
          const nonGitD1Shots = d1Screenshots.filter(
            (s: string) => !isGitRepositoryAssetUrl(s) && !isDeadMirrorScreenshotUrl(s)
          );
          const hasCdbGalleryScreenshots = nonGitD1Shots.length >= 2;
          const shouldFetchCdbReviewsFast = isOfficialFast || expectedCdbCount > 0;
          const [cdbRevPayload, fastGitReleases, fastGitScan, fastCdbDetail, fastCdbReleases] = await Promise.all([
            shouldFetchCdbReviewsFast
              ? fetchUpstreamJsonCached<any[]>(
                  `/packages/${encodeURIComponent(d1Pkg.author_name || author)}/${encodeURIComponent(d1Pkg.name || name)}/reviews/`,
                  600
                ).catch(() => null)
              : Promise.resolve(null),
            d1Pkg.repo_url
              ? fetchGitRepoReleasesAndTags(
                  d1Pkg.repo_url,
                  d1Pkg.author_name || author,
                  d1Pkg.name || name,
                  d1Pkg.min_minetest_version || '5.0.0',
                  false
                ).catch(() => [])
              : Promise.resolve([]),
            (!d1Pkg.video_url || !hasStoredGitShotFast) && d1Pkg.repo_url
              ? scanGitRepoMetadataCached(
                  d1Pkg.author_name || author,
                  d1Pkg.name || name,
                  d1Pkg.type || 'mod',
                  d1Pkg.repo_url,
                  21600
                ).catch(() => null)
              : Promise.resolve(null),
            isOfficialFast && (!hasCdbGalleryScreenshots || !parsedRevCounts || !hasValidD1ThumbOrBanner)
              ? fetchUpstreamJsonCached<any>(
                  `/packages/${encodeURIComponent(d1Pkg.author_name || author)}/${encodeURIComponent(d1Pkg.name || name)}/`,
                  600
                ).catch(() => null)
              : Promise.resolve(null),
            isOfficialFast && d1Releases.length <= 1
              ? fetchUpstreamJsonCached<any[]>(
                  `/packages/${encodeURIComponent(d1Pkg.author_name || author)}/${encodeURIComponent(d1Pkg.name || name)}/releases/`,
                  300
                ).catch(() => null)
              : Promise.resolve(null)
          ]);
          const fastBundledReviews = buildNormalizedReviews(d1Reviews, cdbRevPayload, effectivePkgId);
          if (!parsedRevCounts) {
            parsedRevCounts =
              parseNonZeroReviewThreadCounts(fastCdbDetail?.reviews) ||
              deriveReviewThreadCountsFromList(fastBundledReviews);
          }
          const fastVideo = extractEmbeddedVideo(
            d1Pkg.video_url || fastCdbDetail?.video_url || fastGitScan?.cdbMeta?.video_url,
            d1Pkg.video_thumbnail_url || fastCdbDetail?.video_thumbnail_url,
            d1Pkg.long_desc || extractLongDescriptionText(fastCdbDetail?.long_description)
          );
          const fastGitScanVerified = Boolean(fastGitScan && fastGitScan.gitRepoStatus === 'verified');
          const fastGitShotRaw = fastGitScanVerified
            ? fastGitScan?.screenshotUrl
            : (fastGitScan?.screenshotUrl ||
               (isGitRepositoryAssetUrl(d1Pkg.banner_url) ? String(d1Pkg.banner_url) : undefined) ||
               (isGitRepositoryAssetUrl(d1Pkg.thumbnail_url) ? String(d1Pkg.thumbnail_url) : undefined));
          const fastGitShot = fastGitShotRaw ? sanitizePackageImageUrl(fastGitShotRaw) : undefined;
          const fastFilteredD1Screenshots = fastGitScanVerified
            ? d1Screenshots.filter((s: string) => !isGitRepositoryAssetUrl(s) && !isDeadMirrorScreenshotUrl(s))
            : d1Screenshots.filter((s: string) => !isDeadMirrorScreenshotUrl(s));
          const nonGitFastD1Thumb =
            d1Pkg.thumbnail_url && !isGitRepositoryAssetUrl(d1Pkg.thumbnail_url)
              ? sanitizePackageImageUrl(d1Pkg.thumbnail_url)
              : undefined;
          const nonLogoFastD1Thumb = sanitizePackageImageUrl(d1Pkg.thumbnail_url);
          const nonLogoFastD1Banner = sanitizePackageImageUrl(d1Pkg.banner_url);
          const fastCdbThumb = sanitizePackageImageUrl(fastCdbDetail?.thumbnail);
          const fastMergedScreenshots = mergeScreenshotsPreferringGit(
            [fastGitShot, fastCdbThumb, !fastGitScanVerified ? nonLogoFastD1Thumb : nonGitFastD1Thumb],
            fastGitScan?.screenshots,
            fastFilteredD1Screenshots,
            fastCdbDetail?.screenshots
          );
          const nonGitFastThumb =
            fastCdbThumb ||
            nonGitFastD1Thumb ||
            fastMergedScreenshots.find(s => !isGitRepositoryAssetUrl(s));
          const fastThumb = sanitizePackageImageUrl(
            nonGitFastThumb || fastGitShot || (!fastGitScanVerified ? nonLogoFastD1Thumb : undefined)
          );
          const fastBanner = sanitizePackageImageUrl(
            fastGitShot || fastMergedScreenshots[0] || (!fastGitScanVerified ? nonLogoFastD1Banner : undefined) || fastThumb
          );
          const fastScore = computeStarRating(
            { reviews: parsedRevCounts, reviews_list: fastBundledReviews, score: d1Pkg.score },
            d1Pkg.score,
            d1ReviewAvg
          );
          const newlyDiscoveredRevCountsFast =
            !d1ParsedRevCounts && parsedRevCounts ? JSON.stringify(parsedRevCounts) : null;
          const newlyDiscoveredScoreFast =
            !(Number(d1Pkg.score) >= 1 && Number(d1Pkg.score) <= 5) && fastScore >= 1 && fastScore <= 5
              ? fastScore
              : null;
          const shouldPersistFastShots =
            fastMergedScreenshots.length > 0 &&
            (fastMergedScreenshots.length >= d1Screenshots.length || !d1Pkg.screenshots);
          if (
            (!d1Pkg.video_url && fastVideo.video_url) ||
            (!hasStoredGitShotFast && fastGitShot) ||
            (!d1Pkg.thumbnail_url && fastThumb) ||
            (!d1Pkg.banner_url && fastBanner) ||
            shouldPersistFastShots ||
            newlyDiscoveredRevCountsFast ||
            newlyDiscoveredScoreFast !== null
          ) {
            context.env.DB.prepare(`
              UPDATE packages
              SET video_url = COALESCE(video_url, ?),
                  video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
                  thumbnail_url = CASE
                    WHEN COALESCE(thumbnail_url, '') = '' OR thumbnail_url = 'logo.svg' OR thumbnail_url LIKE '%/storage/screenshots/%' OR thumbnail_url LIKE '%/shot-0.png' THEN COALESCE(?, thumbnail_url)
                    ELSE thumbnail_url
                  END,
                  banner_url = CASE
                    WHEN COALESCE(banner_url, '') = '' OR banner_url = 'logo.svg' OR banner_url LIKE '%/storage/screenshots/%' OR banner_url LIKE '%/shot-0.png' THEN COALESCE(?, banner_url)
                    ELSE COALESCE(?, banner_url)
                  END,
                  screenshots = CASE
                    WHEN ? IS NOT NULL THEN ?
                    ELSE screenshots
                  END,
                  review_thread_counts = CASE
                    WHEN COALESCE(review_thread_counts, '') = '' OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN COALESCE(?, review_thread_counts)
                    ELSE review_thread_counts
                  END,
                  score = CASE WHEN ? IS NOT NULL THEN ? ELSE score END
              WHERE id = ?
            `).bind(
              fastVideo.video_url || null,
              fastVideo.video_thumbnail_url || null,
              fastThumb || null,
              fastBanner || null,
              fastBanner || null,
              shouldPersistFastShots ? JSON.stringify(fastMergedScreenshots) : null,
              shouldPersistFastShots ? JSON.stringify(fastMergedScreenshots) : null,
              newlyDiscoveredRevCountsFast,
              newlyDiscoveredScoreFast,
              newlyDiscoveredScoreFast,
              d1Pkg.id
            ).run().catch(() => {});
          }
          const fastBundledReleases = buildNormalizedReleases(
            d1Pkg.author_name || author,
            d1Pkg.name || name,
            d1Releases,
            fastCdbReleases,
            fastGitReleases
          );
          if (
            context.env.DB &&
            d1Pkg.id &&
            d1Pkg.provider !== 'contentdb' &&
            fastGitReleases.length > 0 &&
            fastBundledReleases.length > d1Releases.length
          ) {
            try {
              const existingTagKeys = new Set(
                d1Releases.map((r: any) => String(r.tag_name || r.version || '').toLowerCase())
              );
              const newRels = fastBundledReleases.filter(
                (r: any) =>
                  r.commit_sha !== 'HEAD' &&
                  r.id !== 'git-branch-fallback' &&
                  !existingTagKeys.has(String(r.tag_name || r.version || '').toLowerCase())
              );
              const insertStmts = newRels.map((rel: any) =>
                context.env.DB.prepare(`
                  INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                  d1Pkg.id,
                  rel.version,
                  rel.tag_name,
                  rel.commit_sha,
                  rel.download_url || rel.url,
                  rel.min_minetest_version || d1Pkg.min_minetest_version || '5.0.0',
                  sanitizeReleaseNotesText(rel.changelog, rel.tag_name) || null,
                  rel.released_at || null
                )
              );
              if (insertStmts.length > 0) {
                if (typeof context.env.DB.batch === 'function') {
                  await context.env.DB.batch(insertStmts);
                } else {
                  for (const stmt of insertStmts) {
                    await stmt.run();
                  }
                }
              }
              if (newRels.length > 0) {
                await syncDebouncedGitVersionStamp(
                  context.env.DB,
                  d1Pkg,
                  fastBundledReleases[0]?.commit_sha || fastBundledReleases[0]?.tag_name,
                  true
                );
              }
            } catch {
              // Non-fatal D1 sync error
            }
          }
          const cdbDl = Math.max(
            Number(d1Pkg.contentdb_downloads || 0),
            Number(fastCdbDetail?.downloads || 0)
          );
          const lhDl = Math.max(Number(d1Pkg.luantihub_downloads || 0), d1DailyDownloadsSum);
          const totalDl = Math.max(Number(d1Pkg.downloads_count || 0), cdbDl + lhDl);
          const fastSources: Array<'official' | 'git'> = [];
          if (isOfficialFast) fastSources.push('official');
          if (isGitFast) fastSources.push('git');
          if (fastSources.length === 0) fastSources.push('official');

          const newestFastReleaseDate = fastBundledReleases[0]?.released_at;
          const resolvedFastCreatedAt = [fastCdbDetail?.approved_at, fastCdbDetail?.created_at, d1Pkg.created_at]
            .filter((d): d is string => typeof d === 'string' && d.trim().length > 0 && Number.isFinite(Date.parse(d)))
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || d1Pkg.created_at || fastCdbDetail?.created_at || undefined;
          const resolvedFastUpdatedAt =
            newestFastReleaseDate &&
            (!d1Pkg.updated_at || new Date(newestFastReleaseDate).getTime() > new Date(d1Pkg.updated_at).getTime())
              ? newestFastReleaseDate
              : (d1Pkg.updated_at || fastCdbDetail?.updated_at || undefined);

          const fastDetailTags = Array.isArray(fastCdbDetail?.tags)
            ? fastCdbDetail.tags
                .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
                .filter(Boolean)
            : [];
          const fastCombinedTags = Array.from(new Set([...d1TagsFast, ...fastDetailTags])).filter(Boolean);
          const fastLongDesc =
            d1Pkg.long_desc ||
            extractLongDescriptionText(fastCdbDetail?.long_description) ||
            d1Pkg.short_desc ||
            '';
          const fastRepoUrl = d1Pkg.repo_url || fastCdbDetail?.repo || fastCdbDetail?.repo_url || undefined;
          const fastHardDeps = parseJsonArray(d1Pkg.dependencies);
          const fastSoftDeps = parseJsonArray(d1Pkg.optional_dependencies);
          const fastMergedGameSupport = mergeLuantiHubAndContentDbGameSupport(
            d1Pkg.game_support,
            fastCdbDetail?.game_support,
            fastHardDeps,
            fastSoftDeps
          );
          const fastTranslations = parsePackageTranslations(d1Pkg.translations);
          const fastLocalized = resolveLocalizedPackageText(
            {
              title: d1Pkg.title || fastCdbDetail?.title || name,
              short_desc: d1Pkg.short_desc || fastCdbDetail?.short_desc || fastCdbDetail?.short_description || '',
              desc: fastLongDesc,
              translations: fastTranslations
            },
            normalizedLang
          );
          const fastScreenshotMeta = parseScreenshotMetaArray(
            d1Pkg.screenshot_meta || fastCdbDetail?.screenshots_dict || fastCdbDetail?.screenshots,
            fastMergedScreenshots
          );
          const fastFrecency = computeLuantiHubFrecencyMetrics({
            luantihubDownloads: lhDl,
            score: fastScore,
            reviewThreadCounts: parsedRevCounts,
            favoritesCount: d1FavoritesCount,
            contentdbScore: Number(fastCdbDetail?.score || 0),
            contentdbScoreDownloads: Number(fastCdbDetail?.score_downloads || 0),
            contentdbScoreReviews: Number(fastCdbDetail?.score_reviews || 0)
          });

          const fastFullPayload = {
            id: effectivePkgId,
            author: d1Pkg.author_name || author,
            author_id: d1Pkg.author_id && !String(d1Pkg.author_id).startsWith('ext_') ? String(d1Pkg.author_id) : undefined,
            name: d1Pkg.name || name,
            title: fastLocalized.title,
            type: d1Pkg.type || fastCdbDetail?.type || 'mod',
            short_desc: fastLocalized.short_desc,
            long_description: fastLocalized.desc || fastLongDesc,
            desc: fastLocalized.desc || fastLongDesc,
            ...(fastTranslations ? { translations: fastTranslations } : {}),
            thumbnail: fastThumb,
            banner: fastBanner,
            screenshots: fastMergedScreenshots,
            ...(fastScreenshotMeta.length > 0 ? { screenshot_meta: fastScreenshotMeta } : {}),
            license: d1Pkg.license || fastCdbDetail?.license,
            media_license: d1Pkg.media_license || d1Pkg.license || fastCdbDetail?.media_license || fastCdbDetail?.license,
            min_minetest_version: d1Pkg.min_minetest_version || extractEngineVersionString(fastCdbDetail?.min_minetest_version) || '5.0.0',
            max_minetest_version: d1Pkg.max_minetest_version || extractEngineVersionString(fastCdbDetail?.max_minetest_version) || undefined,
            repo_url: fastRepoUrl,
            git_repo_status: fastRepoUrl ? 'verified' : 'unverified',
            website: fastCdbDetail?.website || undefined,
            issue_tracker: d1Pkg.issue_tracker || fastCdbDetail?.issue_tracker || undefined,
            forum_url: d1Pkg.forum_url || fastCdbDetail?.forum_url || fastCdbDetail?.forums || undefined,
            forums: d1Pkg.forum_url || fastCdbDetail?.forum_url || fastCdbDetail?.forums || undefined,
            donate_url: d1Pkg.donate_url || fastCdbDetail?.donate_url || undefined,
            translation_url: d1Pkg.translation_url || fastCdbDetail?.translation_url || undefined,
            video_url: fastVideo.video_url || undefined,
            video_thumbnail_url: fastVideo.video_thumbnail_url || undefined,
            dev_state: d1Pkg.dev_state || fastCdbDetail?.dev_state || undefined,
            provides: parseJsonArray(d1Pkg.provides),
            content_warnings: parseJsonArray(d1Pkg.content_warnings),
            ai_disclosures: parseJsonArray(d1Pkg.ai_disclosures),
            maintainers: parseJsonArray(d1Pkg.maintainers),
            review_thread_counts: parsedRevCounts,
            supports_all_games: Boolean(d1Pkg.supports_all_games || fastCdbDetail?.supports_all_games) || undefined,
            game_support: fastMergedGameSupport.length > 0 ? fastMergedGameSupport : undefined,
            created_at: resolvedFastCreatedAt,
            updated_at: resolvedFastUpdatedAt,
            latest_commit_sha: fastBundledReleases[0]?.commit_sha || d1Pkg.latest_commit_sha || undefined,
            tags: fastCombinedTags.length > 0 ? fastCombinedTags : [d1Pkg.type || 'mod'],
            badge_tags: parseBadgeTagsArray(d1Pkg.badge_tags),
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            favorites_count: d1FavoritesCount,
            score: fastScore,
            contentdb_score: Number(fastCdbDetail?.score || 0) || undefined,
            luantihub_score_downloads: fastFrecency.luantihub_score_downloads,
            contentdb_score_downloads: fastFrecency.contentdb_score_downloads,
            score_downloads: fastFrecency.score_downloads,
            score_reviews: fastFrecency.score_reviews,
            download_size: Number(d1Pkg.download_size || 0) > 0 ? Number(d1Pkg.download_size) : undefined,
            file_size: d1Pkg.file_size || formatByteSize(d1Pkg.download_size) || undefined,
            dependencies: fastHardDeps,
            optional_dependencies: fastSoftDeps,
            status: d1Pkg.status || 'active',
            source: isGitFast ? 'git' : 'official',
            sources: fastSources,
            releases_list: fastBundledReleases,
            reviews_list: fastBundledReviews
          };

          await writeEdgeCacheJson(edgeCacheKey, fastFullPayload, 600);
          return new Response(JSON.stringify(fastFullPayload), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400'
            }
          });
        }
      }
    } catch {
      // Ignore if reviews/releases query fails
    }
  }

  // 2. Fetch upstream ContentDB detail, dependencies, releases, and reviews in parallel.
  // Note: ContentDB's `GET /api/packages/:author/:name/` (`Package.as_dict()`) already returns full metadata
  // (license, media_license, downloads, score, screenshots, tags, provides, maintainers, content_warnings,
  // ai_disclosure, forum_url, video_url, donate_url, issue_tracker, translation_url, long_description in clean Markdown).
  // Furthermore, `fetchWithFailover('/packages/:author/:name/')` automatically rewrites to `/for-client/?formspec_version=8`
  // if `content.luanti.org` fails and it has to fall back to `contentdb.milcho.org`!
  // Also note: on `/dependencies/`, do NOT pass `?only_hard=0` because Python Flask treats any non-empty string `"0"` as truthy!
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  let [upstreamData, depsPayload, releasesPayload, upstreamReviewsPayload] = await Promise.all([
    fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 600, { lang: normalizedLang }),
    isLite ? Promise.resolve(null) : fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/dependencies/`, 600),
    isLite ? Promise.resolve(null) : fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/releases/`, 300),
    isLite ? Promise.resolve(null) : fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/reviews/`, 300)
  ]);
  let forClientData: any = null;

  // Ensure Git tags/releases are always discovered & merged alongside ContentDB/D1 releases
  const hasRealTaggedD1Releases = d1Releases.some(
    (r: any) => r.commit_sha !== 'HEAD' && r.version !== 'latest'
  );
  const candidateRepoUrl =
    d1Pkg?.repo_url ||
    (upstreamData && typeof (upstreamData.repo || upstreamData.repo_url) === 'string'
      ? (upstreamData.repo || upstreamData.repo_url)
      : undefined);

  let discoveredGitReleases: any[] = [];
  if (!isLite && candidateRepoUrl) {
    discoveredGitReleases = await fetchGitRepoReleasesAndTags(
      candidateRepoUrl,
      d1Pkg?.author_name || upstreamData?.author || author,
      d1Pkg?.name || upstreamData?.name || name,
      d1Pkg?.min_minetest_version || '5.0.0',
      noCache
    ).catch(() => []);
  }

  if (!isLite && !hasRealTaggedD1Releases && (!Array.isArray(releasesPayload) || releasesPayload.length === 0)) {
    if (discoveredGitReleases.length > 0) {
      d1Releases = sortAndCapReleases(discoveredGitReleases, MAX_PACKAGE_RELEASES);
      if (context.env.DB && d1Pkg) {
        try {
          await context.env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(d1Pkg.id).run();
          for (const rel of d1Releases) {
            await context.env.DB.prepare(`
              INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              d1Pkg.id,
              rel.version,
              rel.tag_name,
              rel.commit_sha,
              rel.download_url,
              rel.min_minetest_version || d1Pkg.min_minetest_version || '5.0.0',
              sanitizeReleaseNotesText(rel.changelog, rel.tag_name) || null,
              rel.released_at || null
            ).run();
          }
          await syncDebouncedGitVersionStamp(
            context.env.DB,
            d1Pkg,
            d1Releases[0]?.commit_sha || d1Releases[0]?.tag_name,
            true,
            d1Releases[0]?.released_at || null
          );
        } catch {
          // Non-fatal D1 sync error
        }
      }
    } else if (d1Releases.length === 0 && d1Pkg?.repo_url) {
      const smartRefs = await fetchGitSmartHttpRefs(
        d1Pkg.repo_url,
        d1Pkg.author_name || author,
        d1Pkg.name || name,
        noCache
      );
      if (context.env.DB && d1Pkg) {
        const latestTagSha = smartRefs?.tags?.[0]?.commitSha || smartRefs?.tags?.[0]?.tagName || '';
        if (latestTagSha) {
          await syncDebouncedGitVersionStamp(
            context.env.DB,
            d1Pkg,
            latestTagSha,
            true,
            d1Pkg.updated_at || d1Pkg.created_at || null
          );
        } else if (smartRefs?.headSha) {
          await syncDebouncedGitVersionStamp(context.env.DB, d1Pkg, smartRefs.headSha, false);
        }
      }
      const branch = d1Pkg.default_branch || smartRefs?.defaultBranch || 'main';
      const fallbackUrl = buildGitBranchArchiveUrl(
        d1Pkg.repo_url,
        d1Pkg.author_name || author,
        d1Pkg.name || name,
        branch,
        d1Pkg.provider
      );
      d1Releases = [{
        id: 'git-branch-fallback',
        version: branch,
        title: `${branch} branch`,
        tag_name: branch,
        commit_sha: smartRefs?.headSha || 'HEAD',
        url: fallbackUrl,
        download_url: fallbackUrl,
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        changelog: undefined,
        released_at: d1Pkg.updated_at || d1Pkg.created_at || new Date().toISOString()
      }];
    }
  }

  let bundledReleases = buildNormalizedReleases(
    author,
    name,
    d1Releases,
    releasesPayload,
    discoveredGitReleases
  );
  if (
    context.env.DB &&
    d1Pkg?.id &&
    discoveredGitReleases.length > 0 &&
    bundledReleases.length > d1Releases.length
  ) {
    try {
      const existingTagKeys = new Set(
        d1Releases.map((r: any) => String(r.tag_name || r.version || '').toLowerCase())
      );
      const newRels = bundledReleases.filter(
        (r: any) =>
          r.commit_sha !== 'HEAD' &&
          r.id !== 'git-branch-fallback' &&
          !existingTagKeys.has(String(r.tag_name || r.version || '').toLowerCase())
      );
      const insertStmts = newRels.map((rel: any) =>
        context.env.DB.prepare(`
          INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          d1Pkg.id,
          rel.version,
          rel.tag_name,
          rel.commit_sha,
          rel.download_url || rel.url,
          rel.min_minetest_version || d1Pkg.min_minetest_version || '5.0.0',
          sanitizeReleaseNotesText(rel.changelog, rel.tag_name) || null,
          rel.released_at || null
        )
      );
      if (insertStmts.length > 0) {
        if (typeof context.env.DB.batch === 'function') {
          await context.env.DB.batch(insertStmts);
        } else {
          for (const stmt of insertStmts) {
            await stmt.run();
          }
        }
      }
      if (newRels.length > 0) {
        await syncDebouncedGitVersionStamp(
          context.env.DB,
          d1Pkg,
          bundledReleases[0]?.commit_sha || bundledReleases[0]?.tag_name,
          true,
          bundledReleases[0]?.released_at || null
        );
      }
    } catch {
      // Non-fatal D1 sync error
    }
  }
  const bundledReviews = buildNormalizedReviews(d1Reviews, upstreamReviewsPayload, pkgId);

  // Merge forClientData into upstreamData if single-package endpoint is missing or partial
  if (!upstreamData && forClientData) {
    upstreamData = forClientData;
  } else if (upstreamData && forClientData) {
    upstreamData = { ...forClientData, ...upstreamData, download_size: forClientData.download_size ?? upstreamData.download_size };
  }

  // Fallback: If single-package endpoint is unavailable on mirror or author differs from ContentDB (e.g. Git username vs ContentDB username), resolve from cached bulk catalog
  if (!upstreamData) {
    const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 600);
    if (Array.isArray(bulkCatalog)) {
      const lowerAuthor = author.toLowerCase();
      const lowerName = name.toLowerCase();
      const lowerTitle = String(d1Pkg?.title || '').trim().toLowerCase();
      const lowerType = String(d1Pkg?.type || 'mod').toLowerCase();
      const d1RepoUrl = String(d1Pkg?.repo_url || '').toLowerCase().replace(/\.git$/i, '').replace(/\/+$/, '');

      const exactOrCaseMatch = bulkCatalog.find(
        (item: any) =>
          item &&
          String(item.author || '').toLowerCase() === lowerAuthor &&
          String(item.name || '').toLowerCase() === lowerName
      ) || null;

      let matchedCandidate = exactOrCaseMatch;
      if (!matchedCandidate) {
        const sameNameItems = bulkCatalog.filter(
          (item: any) => item && String(item.name || '').toLowerCase() === lowerName
        );
        matchedCandidate =
          sameNameItems.find((item: any) => {
            const itemRepo = String(item.repo || item.repo_url || '').toLowerCase().replace(/\.git$/i, '').replace(/\/+$/, '');
            if (d1RepoUrl && itemRepo && itemRepo === d1RepoUrl) return true;
            const itemTitle = String(item.title || '').trim().toLowerCase();
            if (lowerTitle && itemTitle && itemTitle === lowerTitle) return true;
            return false;
          }) ||
          (sameNameItems.length === 1 && String(sameNameItems[0].type || 'mod').toLowerCase() === lowerType
            ? sameNameItems[0]
            : null);
      }

      if (matchedCandidate && matchedCandidate.author && matchedCandidate.name) {
        const encCdbAuthor = encodeURIComponent(matchedCandidate.author);
        const encCdbName = encodeURIComponent(matchedCandidate.name);
        const altDetail =
          matchedCandidate.author !== author || matchedCandidate.name !== name
            ? await fetchUpstreamJsonCached<any>(`/packages/${encCdbAuthor}/${encCdbName}/`, 600).catch(() => null)
            : await fetchUpstreamJsonCached<any>(`/packages/${encCdbAuthor}/${encCdbName}/for-client/?formspec_version=8`, 600).catch(() => null);
        upstreamData = {
          ...matchedCandidate,
          ...(altDetail || {})
        };
      }
    }
  }

  // 3. Agnostic Resolution (Pure Git package OR when both ContentDB & Mirror APIs are offline):
  // Resolve directly from D1 + Server-side Git Repository Scanner (.conf + .cdb.json + README + Git Releases)
  if (!upstreamData) {
    const d1Tags = d1Pkg ? parseJsonArray(d1Pkg.tags) : [];
    const d1HardDeps = d1Pkg ? parseJsonArray(d1Pkg.dependencies) : [];
    const d1SoftDeps = d1Pkg ? parseJsonArray(d1Pkg.optional_dependencies) : [];
    const hasStoredGitShotPure =
      isGitRepositoryAssetUrl(d1Pkg?.thumbnail_url) || isGitRepositoryAssetUrl(d1Pkg?.banner_url);
    const needsAgnosticRepoScan =
      !d1Pkg ||
      !d1Pkg.license ||
      !d1Pkg.short_desc ||
      d1HardDeps.length === 0 ||
      (!hasStoredGitShotPure && Boolean(d1Pkg?.repo_url)) ||
      (!isLite && !d1Pkg.video_url && Boolean(d1Pkg.repo_url));

    const gitScan = needsAgnosticRepoScan
      ? await probeGitRepoConfAndLicense(
          d1Pkg?.author_name || author,
          d1Pkg?.name || name,
          d1Pkg?.type || 'mod',
          d1Pkg?.repo_url
        )
      : null;

    if (d1Pkg || (gitScan && gitScan.gitRepoStatus === 'verified')) {
      const resolvedAuthor = d1Pkg?.author_name || author;
      const resolvedName = d1Pkg?.name || gitScan?.cdbMeta?.name || name;
      const resolvedType = gitScan?.detectedType || d1Pkg?.type || 'mod';
      const resolvedRepo = gitScan?.repoUrl || d1Pkg?.repo_url || '';
      const isGitPkg = !d1Pkg || d1Pkg.provider !== 'contentdb' || d1Tags.includes('git');
      const isAlsoOfficial = Boolean(d1Pkg && (d1Pkg.provider === 'contentdb' || d1Tags.includes('contentdb')));
      const sources: Array<'official' | 'git'> = [];
      if (isAlsoOfficial) sources.push('official');
      if (isGitPkg) sources.push('git');
      if (sources.length === 0) sources.push('git');

      let readme = (!isLite && wantsReadme && resolvedRepo) ? await fetchRepoReadmeCached(resolvedRepo) : undefined;
      if (!readme && !isLite && wantsReadme && resolvedRepo && d1Tags.some((t: string) => String(t).toLowerCase() === 'jam_game_2026')) {
        readme = await fetchJam2026FallbackReadme(resolvedRepo);
      }
      const fallbackRawBase =
        gitScan?.rawBaseUrl ||
        (resolvedRepo
          ? `${String(resolvedRepo).replace(/\.git$/i, '').replace(/\/+$/, '')}/raw/${d1Pkg?.default_branch || 'main'}`
          : undefined);
      const rawLongDesc =
        d1Pkg?.long_desc ||
        gitScan?.cdbMeta?.long_description ||
        gitScan?.longDesc ||
        d1Pkg?.short_desc ||
        gitScan?.shortDesc ||
        '';
      const fallbackReadme =
        rawLongDesc && rawLongDesc !== (d1Pkg?.short_desc || gitScan?.shortDesc)
          ? rewriteRelativeMarkdownUrls(rawLongDesc, fallbackRawBase)
          : undefined;

      if (bundledReleases.length === 0 && !isLite && resolvedRepo) {
        const discoveredGitRels = await fetchGitRepoReleasesAndTags(
          resolvedRepo,
          resolvedAuthor,
          resolvedName,
          d1Pkg?.min_minetest_version || gitScan?.minVersion || '5.0.0'
        );
        if (discoveredGitRels.length > 0) {
          bundledReleases = sortAndCapReleases(discoveredGitRels, MAX_PACKAGE_RELEASES);
        } else {
          const smartRefs = await fetchGitSmartHttpRefs(resolvedRepo, resolvedAuthor, resolvedName);
          const branch = d1Pkg?.default_branch || smartRefs?.defaultBranch || 'main';
          const fallbackUrl = buildGitBranchArchiveUrl(
            resolvedRepo,
            resolvedAuthor,
            resolvedName,
            branch,
            d1Pkg?.provider
          );
          bundledReleases = [{
            id: 'git-branch-fallback',
            version: branch,
            title: `${branch} branch`,
            tag_name: branch,
            commit_sha: smartRefs?.headSha || 'HEAD',
            url: fallbackUrl,
            download_url: fallbackUrl,
            min_minetest_version: d1Pkg?.min_minetest_version || gitScan?.minVersion || '5.0.0',
            changelog: undefined,
            released_at: d1Pkg?.updated_at || d1Pkg?.created_at || new Date().toISOString()
          }];
        }
      }

      const explicitReleaseSize = Number(bundledReleases[0]?.size || 0);
      let firstRelSize = explicitReleaseSize || Number(d1Pkg?.download_size || 0);
      let gitFileSize = firstRelSize > 0
        ? formatByteSize(firstRelSize)
        : (d1Pkg?.file_size || undefined);

      // Verify & self-heal Git .zip archive size (cached for 7 days at Edge + pre-warms .zip download cache).
      // Overwrites legacy inflated `repo.size` estimates (e.g. 18.3 MB full .git history -> 335 KB normalized .zip).
      if (resolvedRepo && !explicitReleaseSize && (!gitFileSize || !isLite)) {
        const repoEst = await fetchAccurateGitZipSize(resolvedRepo, resolvedAuthor, resolvedName, {
          tag: bundledReleases[0]?.tag_name || bundledReleases[0]?.version || null,
          defaultBranch: d1Pkg?.default_branch || 'main',
          packageType: resolvedType
        });
        if (repoEst && repoEst.downloadSize > 0) {
          const prevD1Size = Number(d1Pkg?.download_size || 0);
          firstRelSize = repoEst.downloadSize;
          gitFileSize = repoEst.fileSize;
          if (
            context.env.DB &&
            d1Pkg?.id &&
            (prevD1Size <= 0 || Math.abs(repoEst.downloadSize - prevD1Size) > Math.max(1024, prevD1Size * 0.05))
          ) {
            await context.env.DB.prepare(`
              UPDATE packages
              SET download_size = ?, file_size = ?
              WHERE LOWER(id) = LOWER(?)
            `).bind(repoEst.downloadSize, repoEst.fileSize, d1Pkg.id).run().catch(() => {});
            await invalidateEdgeCacheKeys([BOOT_CATALOG_EDGE_CACHE_KEY]).catch(() => {});
          }
        }
      }

      const cdbDownloads = Number(d1Pkg?.contentdb_downloads || 0);
      const lhDownloads = Math.max(
        Number(d1Pkg?.luantihub_downloads || 0),
        d1DailyDownloadsSum
      );
      const totalDownloads = cdbDownloads + lhDownloads;

      const gitVideoUrl = d1Pkg?.video_url || gitScan?.cdbMeta?.video_url;
      const gitVideoThumb = d1Pkg?.video_thumbnail_url;
      const resolvedGitVideo = extractEmbeddedVideo(
        gitVideoUrl,
        gitVideoThumb,
        rawLongDesc,
        readme || fallbackReadme
      );

      const mergedTags = Array.from(
        new Set([
          ...d1Tags,
          ...(gitScan?.cdbMeta?.tags || []),
          ...(d1Tags.length === 0 && !(gitScan?.cdbMeta?.tags?.length) ? [resolvedType, 'git'] : [])
        ])
      ).filter(Boolean);
      const pureGitBadgeTags = parseBadgeTagsArray(d1Pkg?.badge_tags);
      if (mergedTags.includes(ORGANIC_CODE_TAG) && !pureGitBadgeTags.includes(ORGANIC_CODE_TAG)) {
        pureGitBadgeTags.push(ORGANIC_CODE_TAG);
      }
      const mergedHardDeps = d1HardDeps.length > 0 ? d1HardDeps : (gitScan?.hardDeps || []);
      const mergedSoftDeps = d1SoftDeps.length > 0 ? d1SoftDeps : (gitScan?.softDeps || []);
      const mergedLicense = d1Pkg?.license || gitScan?.license || gitScan?.mediaLicense || '';
      const mergedMediaLicense = d1Pkg?.media_license || gitScan?.mediaLicense || mergedLicense || '';
      const mergedShortDesc = d1Pkg?.short_desc || gitScan?.cdbMeta?.short_description || gitScan?.shortDesc || '';
      const mergedTitle = d1Pkg?.title || gitScan?.cdbMeta?.title || gitScan?.title || resolvedName;
      const resolvedGitScreenshotRaw =
        gitScan?.screenshotUrl ||
        (isGitRepositoryAssetUrl(d1Pkg?.banner_url) ? String(d1Pkg.banner_url) : undefined) ||
        (isGitRepositoryAssetUrl(d1Pkg?.thumbnail_url) ? String(d1Pkg.thumbnail_url) : undefined);
      const resolvedGitScreenshot = resolvedGitScreenshotRaw ? toProxiedGitImageIfNeeded(resolvedGitScreenshotRaw) : undefined;
      const nonGitPureThumb =
        d1Pkg?.thumbnail_url && d1Pkg.thumbnail_url !== 'logo.svg' && !isGitRepositoryAssetUrl(d1Pkg.thumbnail_url)
          ? String(d1Pkg.thumbnail_url)
          : undefined;
      const mergedGitScreenshots = mergeScreenshotsPreferringGit(
        [gitScan?.screenshotUrl, d1Pkg?.banner_url, d1Pkg?.thumbnail_url, resolvedGitScreenshot, nonGitPureThumb],
        gitScan?.screenshots,
        parseJsonArray(d1Pkg?.screenshots)
      );

      // Persist newly scanned Git/.cdb.json metadata back into D1 only when at least one field is missing
      const needsPureGitBackfill =
        Boolean(d1Pkg) &&
        ((!d1Pkg.license && Boolean(mergedLicense)) ||
          (!d1Pkg.short_desc && Boolean(mergedShortDesc)) ||
          ((!d1Pkg.banner_url || d1Pkg.banner_url === 'logo.svg' || !isGitRepositoryAssetUrl(d1Pkg.banner_url)) &&
            Boolean(gitScan?.screenshotUrl)) ||
          (!d1Pkg.screenshots && mergedGitScreenshots.length > 0) ||
          (!d1Pkg.video_url && Boolean(resolvedGitVideo.video_url)) ||
          (!d1Pkg.dependencies && mergedHardDeps.length > 0));
      if (context.env.DB && d1Pkg && gitScan && gitScan.gitRepoStatus === 'verified' && needsPureGitBackfill) {
        context.env.DB.prepare(`
          UPDATE packages SET
            license = CASE WHEN COALESCE(license, '') = '' THEN ? ELSE license END,
            media_license = CASE WHEN COALESCE(media_license, '') = '' THEN ? ELSE media_license END,
            short_desc = CASE WHEN COALESCE(short_desc, '') = '' THEN ? ELSE short_desc END,
            thumbnail_url = CASE
              WHEN COALESCE(thumbnail_url, '') = '' OR thumbnail_url = 'logo.svg' THEN COALESCE(?, thumbnail_url)
              ELSE thumbnail_url
            END,
            banner_url = COALESCE(?, banner_url),
            screenshots = COALESCE(?, screenshots),
            video_url = COALESCE(video_url, ?),
            video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
            dependencies = COALESCE(dependencies, ?),
            optional_dependencies = COALESCE(optional_dependencies, ?)
          WHERE id = ?
        `).bind(
          mergedLicense,
          mergedMediaLicense,
          mergedShortDesc || null,
          gitScan.screenshotUrl || null,
          gitScan.screenshotUrl || null,
          mergedGitScreenshots.length > 0 ? JSON.stringify(mergedGitScreenshots) : null,
          resolvedGitVideo.video_url || null,
          resolvedGitVideo.video_thumbnail_url || null,
          mergedHardDeps.length > 0 ? JSON.stringify(mergedHardDeps) : null,
          mergedSoftDeps.length > 0 ? JSON.stringify(mergedSoftDeps) : null,
          d1Pkg.id
        ).run().catch(() => {});
      }

      const pureGitTranslations = parsePackageTranslations(d1Pkg?.translations);
      const pureGitLocalized = resolveLocalizedPackageText(
        {
          title: mergedTitle,
          short_desc: mergedShortDesc,
          desc: rawLongDesc || mergedShortDesc,
          translations: pureGitTranslations
        },
        normalizedLang
      );
      const pureGitGameSupport = mergeLuantiHubAndContentDbGameSupport(
        d1Pkg?.game_support,
        undefined,
        mergedHardDeps,
        mergedSoftDeps
      );
      const pureGitScreenshotMeta = parseScreenshotMetaArray(
        d1Pkg?.screenshot_meta || gitScan?.cdbMeta?.screenshots,
        mergedGitScreenshots
      );
      const pureGitStarScore = d1ReviewAvg ? Number(d1ReviewAvg.toFixed(1)) : Number(d1Pkg?.score || 0);
      const pureGitFrecency = computeLuantiHubFrecencyMetrics({
        luantihubDownloads: lhDownloads,
        score: pureGitStarScore,
        favoritesCount: d1FavoritesCount
      });

      const pureGitPayload = {
        id: `${resolvedAuthor}/${resolvedName}`,
        author: resolvedAuthor,
        author_id: d1Pkg?.author_id && !String(d1Pkg.author_id).startsWith('ext_') ? String(d1Pkg.author_id) : undefined,
        name: resolvedName,
        title: pureGitLocalized.title,
        type: resolvedType,
        short_desc: pureGitLocalized.short_desc,
        long_description: pureGitLocalized.desc || rawLongDesc || mergedShortDesc,
        desc: pureGitLocalized.desc || rawLongDesc || mergedShortDesc,
        ...(pureGitTranslations ? { translations: pureGitTranslations } : {}),
        readme: readme || fallbackReadme || undefined,
        thumbnail: toProxiedGitImageIfNeeded(
          nonGitPureThumb ||
          resolvedGitScreenshot ||
          (d1Pkg?.thumbnail_url && d1Pkg.thumbnail_url !== 'logo.svg' ? d1Pkg.thumbnail_url : undefined)
        ) || 'logo.svg',
        banner: toProxiedGitImageIfNeeded(
          resolvedGitScreenshot ||
          mergedGitScreenshots[0] ||
          (d1Pkg?.banner_url && d1Pkg.banner_url !== 'logo.svg' ? d1Pkg.banner_url : undefined) ||
          nonGitPureThumb ||
          (d1Pkg?.thumbnail_url && d1Pkg.thumbnail_url !== 'logo.svg' ? d1Pkg.thumbnail_url : undefined)
        ) || 'logo.svg',
        screenshots: mergedGitScreenshots,
        ...(pureGitScreenshotMeta.length > 0 ? { screenshot_meta: pureGitScreenshotMeta } : {}),
        license: mergedLicense,
        media_license: mergedMediaLicense,
        score: pureGitStarScore,
        luantihub_score_downloads: pureGitFrecency.luantihub_score_downloads,
        contentdb_score_downloads: 0,
        score_downloads: pureGitFrecency.score_downloads,
        score_reviews: pureGitFrecency.score_reviews,
        contentdb_downloads: cdbDownloads,
        luantihub_downloads: lhDownloads,
        downloads: totalDownloads,
        favorites_count: d1FavoritesCount,
        repo: resolvedRepo,
        repo_url: resolvedRepo,
        git_repo_status: gitScan?.gitRepoStatus || (resolvedRepo ? 'verified' : 'unverified'),
        website: gitScan?.cdbMeta?.website || undefined,
        issue_tracker: d1Pkg?.issue_tracker || gitScan?.cdbMeta?.issue_tracker || undefined,
        forum_url: d1Pkg?.forum_url || gitScan?.cdbMeta?.forum_url || undefined,
        forums: d1Pkg?.forum_url || gitScan?.cdbMeta?.forum_url || undefined,
        donate_url: d1Pkg?.donate_url || gitScan?.cdbMeta?.donate_url || undefined,
        translation_url: d1Pkg?.translation_url || gitScan?.cdbMeta?.translation_url || undefined,
        video_url: resolvedGitVideo.video_url,
        video_thumbnail_url: resolvedGitVideo.video_thumbnail_url,
        dev_state: d1Pkg?.dev_state || gitScan?.cdbMeta?.dev_state || undefined,
        provides: parseJsonArray(d1Pkg?.provides),
        content_warnings:
          parseJsonArray(d1Pkg?.content_warnings).length > 0
            ? parseJsonArray(d1Pkg?.content_warnings)
            : (gitScan?.cdbMeta?.content_warnings || []),
        ai_disclosures:
          parseJsonArray(d1Pkg?.ai_disclosures).length > 0
            ? parseJsonArray(d1Pkg?.ai_disclosures)
            : (gitScan?.cdbMeta?.ai_disclosures || []),
        maintainers: parseJsonArray(d1Pkg?.maintainers),
        supports_all_games: Boolean(d1Pkg?.supports_all_games) || undefined,
        game_support: pureGitGameSupport.length > 0 ? pureGitGameSupport : undefined,
        created_at: d1Pkg?.created_at || undefined,
        updated_at: d1Pkg?.updated_at || undefined,
        latest_commit_sha: bundledReleases[0]?.commit_sha || d1Pkg?.latest_commit_sha || undefined,
        provider: d1Pkg?.provider || (resolvedRepo.includes('codeberg.org') ? 'codeberg' : resolvedRepo.includes('git.minetest.land') ? 'mesehub' : resolvedRepo.includes('gitlab.com') ? 'gitlab' : resolvedRepo.includes('bitbucket.org') ? 'bitbucket' : 'github'),
        default_branch: d1Pkg?.default_branch || gitScan?.defaultBranch || 'main',
        min_minetest_version: d1Pkg?.min_minetest_version || gitScan?.minVersion || '5.0.0',
        max_minetest_version: d1Pkg?.max_minetest_version || gitScan?.maxVersion || undefined,
        tags: mergedTags,
        ...(pureGitBadgeTags.length > 0 ? { badge_tags: pureGitBadgeTags } : {}),
        dependencies: mergedHardDeps,
        optional_dependencies: mergedSoftDeps,
        download_size: firstRelSize > 0 ? firstRelSize : undefined,
        file_size: gitFileSize,
        status: d1Pkg?.status || 'active',
        source: isGitPkg ? 'git' : 'official',
        sources,
        releases_list: bundledReleases,
        reviews_list: bundledReviews
      };

      return new Response(JSON.stringify(pureGitPayload), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400'
        }
      });
    }
    return Response.json({ error: 'Package not found' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const canonicalId = `${upstreamData.author || author}/${upstreamData.name || name}`;
  const { hardDeps, softDeps } = extractDependencies(upstreamData, depsPayload, canonicalId);

  let finalHardDeps = hardDeps;
  let finalSoftDeps = softDeps;
  let resolvedLicense = d1Pkg?.license || upstreamData.license || upstreamData.media_license || '';
  let resolvedMediaLicense = d1Pkg?.media_license || upstreamData.media_license || upstreamData.license || d1Pkg?.license || '';
  let repoUrl = normalizeDefunctGitHost(upstreamData.repo || upstreamData.repo_url || d1Pkg?.repo_url || undefined);
  let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = repoUrl ? 'verified' : 'unverified';
  let minVersion =
    (d1Pkg?.min_minetest_version && d1Pkg.min_minetest_version !== '5.0.0'
      ? extractEngineVersionString(d1Pkg.min_minetest_version)
      : undefined) ||
    extractEngineVersionString(upstreamData.min_minetest_version) ||
    extractEngineVersionString(forClientData?.min_minetest_version) ||
    extractEngineVersionString(Array.isArray(releasesPayload) && releasesPayload[0]?.min_minetest_version) ||
    extractEngineVersionString(d1Pkg?.min_minetest_version) ||
    undefined;
  let maxVersion =
    extractEngineVersionString(d1Pkg?.max_minetest_version) ||
    extractEngineVersionString(upstreamData.max_minetest_version) ||
    extractEngineVersionString(forClientData?.max_minetest_version) ||
    extractEngineVersionString(Array.isArray(releasesPayload) && releasesPayload[0]?.max_minetest_version) ||
    undefined;

  // Probe Git repository when license, video_url, or Git screenshot is missing on a repository-backed package
  let probedCdbMeta: CdbJsonMetadata | null = null;
  let gitProbeScan: GitRepoScanResult | null = null;
  const hasResolvedVideo = Boolean(upstreamData.video_url || forClientData?.video_url || d1Pkg?.video_url);
  const hasStoredGitScreenshot =
    isGitRepositoryAssetUrl(d1Pkg?.thumbnail_url) || isGitRepositoryAssetUrl(d1Pkg?.banner_url);
  const needsGitProbe = Boolean(repoUrl) && (!resolvedLicense || !hasResolvedVideo || !hasStoredGitScreenshot);
  if (needsGitProbe) {
    const gitProbe = await probeGitRepoConfAndLicense(
      upstreamData.author || author,
      upstreamData.name || name,
      upstreamData.type || 'mod',
      repoUrl
    );
    gitProbeScan = gitProbe;
    gitRepoStatus = gitProbe.gitRepoStatus;
    probedCdbMeta = gitProbe.cdbMeta || null;
    if (finalHardDeps.length === 0 && gitProbe.hardDeps.length > 0) {
      finalHardDeps = gitProbe.hardDeps;
    }
    if (finalSoftDeps.length === 0 && gitProbe.softDeps.length > 0) {
      finalSoftDeps = gitProbe.softDeps;
    }
    if (!resolvedLicense && (gitProbe.license || gitProbe.mediaLicense)) {
      resolvedLicense = gitProbe.license || gitProbe.mediaLicense || '';
    }
    if (!resolvedMediaLicense && (gitProbe.mediaLicense || gitProbe.license)) {
      resolvedMediaLicense = gitProbe.mediaLicense || gitProbe.license || '';
    }
    if (gitProbe.repoUrl) {
      repoUrl = gitProbe.repoUrl;
    }
    if (!minVersion && gitProbe.minVersion) {
      minVersion = gitProbe.minVersion;
    }
    if (!maxVersion && gitProbe.maxVersion) {
      maxVersion = gitProbe.maxVersion;
    }

    // Automated 404 Git Repository Detection & Self-Healing:
    // Report stale/404 Git repos to admins/moderators in D1, or auto-resolve open 'broken' reports once back online
    if (gitRepoStatus === 'broken_404' && context.env.DB) {
      try {
        await ensureModerationColumns(context.env.DB);
        const existingReport = await context.env.DB.prepare(
          `SELECT id FROM moderation_reports WHERE LOWER(package_id) = LOWER(?) AND reason = 'broken' AND status = 'open' LIMIT 1`
        ).bind(canonicalId).first();
        if (!existingReport) {
          const attempted = repoUrl || `https://github.com/${upstreamData.author || author}/${upstreamData.name || name}`;
          await context.env.DB.prepare(
            `INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status) VALUES (?, 'system-git-monitor', 'broken', ?, 'open')`
          ).bind(
            canonicalId,
            `[Automated 404 Git Detection] Repository URL (${attempted}) returned HTTP 404 across GitHub, Codeberg, and GitLab. Flagged for admin/moderator review to prevent stale content packages.`
          ).run();
        }
      } catch {
        // Non-blocking auto-report
      }
    } else if (gitRepoStatus === 'verified' && context.env.DB) {
      await autoResolveBrokenRepoReport(context.env.DB, canonicalId);
    }
  } else if (gitRepoStatus === 'verified' && context.env.DB) {
    await autoResolveBrokenRepoReport(context.env.DB, canonicalId);
  }

  // Normalize tags array
  let normalizedTags: string[] = [];
  const rawTagsSource = Array.isArray(upstreamData.tags)
    ? upstreamData.tags
    : (Array.isArray(forClientData?.tags) ? forClientData.tags : []);
  if (rawTagsSource.length > 0) {
    normalizedTags = rawTagsSource
      .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
      .filter(Boolean);
  }
  if (normalizedTags.length === 0) {
    const fallbackD1Tags = parseJsonArray(d1Pkg?.tags);
    const cdbTags = probedCdbMeta?.tags || [];
    normalizedTags = fallbackD1Tags.length > 0
      ? fallbackD1Tags
      : (cdbTags.length > 0 ? cdbTags : [upstreamData.type || 'mod']);
  } else if (probedCdbMeta?.tags && probedCdbMeta.tags.length > 0) {
    normalizedTags = Array.from(new Set([...normalizedTags, ...probedCdbMeta.tags]));
  }

  // Normalize & merge screenshots array (preferring Git repository screenshot.png / .cdb.json first, followed by ContentDB gallery)
  const gitProbeVerified = Boolean(gitProbeScan && gitProbeScan.gitRepoStatus === 'verified');
  const gitScreenshotRaw = gitProbeVerified
    ? gitProbeScan?.screenshotUrl
    : (gitProbeScan?.screenshotUrl ||
       (isGitRepositoryAssetUrl(d1Pkg?.banner_url) ? String(d1Pkg.banner_url) : undefined) ||
       (isGitRepositoryAssetUrl(d1Pkg?.thumbnail_url) ? String(d1Pkg.thumbnail_url) : undefined));
  const gitScreenshot = gitScreenshotRaw ? sanitizePackageImageUrl(gitScreenshotRaw) : undefined;
  const rawScreenshotsSource = Array.isArray(upstreamData.screenshots)
    ? upstreamData.screenshots
    : (Array.isArray(forClientData?.screenshots) ? forClientData.screenshots : []);
  const d1ParsedShots = parseJsonArray(d1Pkg?.screenshots).filter(
    (s: string) => !isDeadMirrorScreenshotUrl(s)
  );
  const filteredD1Shots = gitProbeVerified
    ? d1ParsedShots.filter((s: string) => !isGitRepositoryAssetUrl(s))
    : d1ParsedShots;
  const nonGitD1Thumb =
    d1Pkg?.thumbnail_url && !isGitRepositoryAssetUrl(d1Pkg.thumbnail_url)
      ? upgradeContentDbThumbnailUrl(d1Pkg.thumbnail_url)
      : undefined;
  const nonLogoD1Thumb = upgradeContentDbThumbnailUrl(d1Pkg?.thumbnail_url);
  const nonLogoD1Banner = sanitizePackageImageUrl(d1Pkg?.banner_url);
  const sanitizedUpstreamThumb = upgradeContentDbThumbnailUrl(upstreamData.thumbnail);
  const screenshots: string[] = mergeScreenshotsPreferringGit(
    [gitScreenshot, sanitizedUpstreamThumb, gitProbeVerified ? nonGitD1Thumb : nonLogoD1Thumb],
    gitProbeScan?.screenshots,
    filteredD1Shots,
    rawScreenshotsSource
  );
  const upgradedUpstreamThumb = upgradeContentDbThumbnailUrl(upstreamData.thumbnail, screenshots);
  const upgradedD1Thumb =
    d1Pkg?.thumbnail_url && !isGitRepositoryAssetUrl(d1Pkg.thumbnail_url)
      ? upgradeContentDbThumbnailUrl(d1Pkg.thumbnail_url, screenshots)
      : undefined;
  const nonGitDetailThumbRaw =
    upgradedUpstreamThumb ||
    upgradedD1Thumb ||
    screenshots.find(s => !isGitRepositoryAssetUrl(s));
  const nonGitDetailThumb = nonGitDetailThumbRaw
    ? (formatContentDbCdnUrl(nonGitDetailThumbRaw, 'tile') || nonGitDetailThumbRaw)
    : undefined;
  const resolvedThumbRaw = nonGitDetailThumb || gitScreenshot || (!gitProbeVerified ? nonLogoD1Thumb : null) || null;
  const resolvedThumb = sanitizePackageImageUrl(resolvedThumbRaw) || null;
  const resolvedBanner =
    selectSharpPackageBanner(
      gitScreenshot,
      screenshots,
      !gitProbeVerified ? nonLogoD1Banner : null,
      resolvedThumb
    ) || null;

  // Resolve download_size & file_size from /for-client/, /packages/:author/:name/, latest release, or Content-Length HEAD check
  const rawSizeSource =
    forClientData?.download_size ??
    upstreamData.download_size ??
    (Array.isArray(releasesPayload) && releasesPayload[0] ? (releasesPayload[0].size || releasesPayload[0].file_size) : undefined) ??
    d1Pkg?.download_size;
  const downloadSizeBytes = parseDownloadSizeBytes(rawSizeSource);
  const fileSize: string | undefined = formatByteSize(rawSizeSource);
  let latestDownloadUrl = `https://content.luanti.org/packages/${encAuthor}/${encName}/download/`;
  if (Array.isArray(releasesPayload) && releasesPayload.length > 0) {
    const firstRel = releasesPayload[0];
    const rawRelUrl = firstRel.url || '';
    if (rawRelUrl) {
      latestDownloadUrl = rawRelUrl.startsWith('http')
        ? rawRelUrl
        : `https://content.luanti.org${rawRelUrl}`;
    }
  }

  const [resolvedHeadSize, readmeText] = await Promise.all([
    fileSize
      ? Promise.resolve(fileSize)
      : (d1Pkg?.file_size || isLite ? Promise.resolve(d1Pkg?.file_size || undefined) : resolveArchiveSizeCached(latestDownloadUrl)),
    (!isLite && wantsReadme) ? fetchRepoReadmeCached(repoUrl) : Promise.resolve<string | undefined>(undefined)
  ]);

  const d1Tags = parseJsonArray(d1Pkg?.tags);
  const d1HardDeps = parseJsonArray(d1Pkg?.dependencies);
  const d1SoftDeps = parseJsonArray(d1Pkg?.optional_dependencies);
  const isRegisteredInGitCommunity = Boolean(
    d1Pkg && (d1Pkg.provider !== 'contentdb' || d1Tags.includes('git'))
  );
  const sources: Array<'official' | 'git'> = isRegisteredInGitCommunity ? ['official', 'git'] : ['official'];

  // Extract long_description (supports plain string or { type: 'hypertext', body: '...' } across detail, for-client, .cdb.json, .conf, and dependencies payloads)
  const extractedLongDesc =
    extractLongDescriptionText(upstreamData.long_description) ||
    extractLongDescriptionText(forClientData?.long_description) ||
    extractLongDescriptionText(depsPayload?.long_description) ||
    extractLongDescriptionText(upstreamData.desc) ||
    probedCdbMeta?.long_description ||
    gitProbeScan?.longDesc ||
    (!readmeText ? d1Pkg?.long_desc : undefined) ||
    '';

  const shortDesc =
    upstreamData.short_desc ||
    upstreamData.short_description ||
    forClientData?.short_desc ||
    probedCdbMeta?.short_description ||
    gitProbeScan?.shortDesc ||
    d1Pkg?.short_desc ||
    '';

  // Dual-counter downloads: contentdb_downloads + luantihub_downloads
  const contentdbDownloads = Math.max(
    Number(upstreamData.downloads || 0),
    Number(forClientData?.downloads || 0),
    Number(d1Pkg?.contentdb_downloads || 0)
  );
  const luantihubDownloads = Math.max(
    Number(d1Pkg?.luantihub_downloads || 0),
    d1DailyDownloadsSum
  );
  const totalDownloads = contentdbDownloads + luantihubDownloads;

  // Normalize URLs & extra ContentDB / .cdb.json metadata
  const rawForum = upstreamData.forum_url || forClientData?.forum_url || upstreamData.forums || forClientData?.forums || probedCdbMeta?.forum_url || d1Pkg?.forum_url;
  const forumUrl = rawForum
    ? (String(rawForum).startsWith('http')
        ? String(rawForum)
        : `https://forum.luanti.org/viewtopic.php?t=${rawForum}`)
    : undefined;
  const donateUrl = upstreamData.donate_url || forClientData?.donate_url || probedCdbMeta?.donate_url || d1Pkg?.donate_url || undefined;
  const issueTrackerUrl = upstreamData.issue_tracker || forClientData?.issue_tracker || probedCdbMeta?.issue_tracker || d1Pkg?.issue_tracker || undefined;
  const translationUrl = upstreamData.translation_url || forClientData?.translation_url || probedCdbMeta?.translation_url || d1Pkg?.translation_url || undefined;
  const resolvedVideo = extractEmbeddedVideo(
    upstreamData.video_url || forClientData?.video_url || probedCdbMeta?.video_url || d1Pkg?.video_url,
    upstreamData.video_thumbnail_url || forClientData?.video_thumbnail_url || d1Pkg?.video_thumbnail_url,
    extractedLongDesc,
    readmeText
  );
  const videoUrl = resolvedVideo.video_url;
  const videoThumbnailUrl = resolvedVideo.video_thumbnail_url;
  const devState = d1Pkg?.dev_state || probedCdbMeta?.dev_state || upstreamData.dev_state || forClientData?.dev_state || undefined;

  const rawProvides = Array.isArray(upstreamData.provides)
    ? upstreamData.provides
    : (Array.isArray(forClientData?.provides) ? forClientData.provides : parseJsonArray(d1Pkg?.provides));
  const providesList = rawProvides
    .map((p: any) => (typeof p === 'string' ? p : p?.name || ''))
    .filter(Boolean);

  const d1Warnings = parseJsonArray(d1Pkg?.content_warnings);
  const rawCdbWarnings = Array.isArray(upstreamData.content_warnings)
    ? upstreamData.content_warnings
    : (Array.isArray(forClientData?.content_warnings)
        ? forClientData.content_warnings
        : (probedCdbMeta?.content_warnings || []));
  const cdbWarnings = rawCdbWarnings
    .map((w: any) => (typeof w === 'string' ? w : w?.name || w?.title || ''))
    .filter(Boolean);
  const contentWarnings = Array.from(new Set([...d1Warnings, ...cdbWarnings]));

  const rawAiDisclosures = Array.isArray(upstreamData.ai_disclosures)
    ? upstreamData.ai_disclosures
    : typeof upstreamData.ai_disclosure === 'string' && upstreamData.ai_disclosure.trim()
      ? [upstreamData.ai_disclosure.trim()]
      : (Array.isArray(forClientData?.ai_disclosures)
          ? forClientData.ai_disclosures
          : typeof forClientData?.ai_disclosure === 'string' && forClientData.ai_disclosure.trim()
            ? [forClientData.ai_disclosure.trim()]
            : (probedCdbMeta?.ai_disclosures?.length ? probedCdbMeta.ai_disclosures : parseJsonArray(d1Pkg?.ai_disclosures)));
  const aiDisclosures = rawAiDisclosures
    .map((a: any) => (typeof a === 'string' ? a : a?.name || a?.title || ''))
    .filter(Boolean);

  const rawMaintainers = Array.isArray(upstreamData.maintainers)
    ? upstreamData.maintainers
    : (Array.isArray(forClientData?.maintainers) ? forClientData.maintainers : parseJsonArray(d1Pkg?.maintainers));
  const maintainersList = rawMaintainers
    .map((m: any) => (typeof m === 'string' ? m : m?.username || m?.name || ''))
    .filter(Boolean);

  const d1ValidRevCounts = parseNonZeroReviewThreadCounts(d1Pkg?.review_thread_counts);
  let reviewThreadCounts =
    parseNonZeroReviewThreadCounts(upstreamData.reviews) ||
    parseNonZeroReviewThreadCounts(forClientData?.reviews) ||
    deriveReviewThreadCountsFromList(bundledReviews) ||
    d1ValidRevCounts;

  if (!reviewThreadCounts && isLite) {
    const cachedScores = await fetchUpstreamJsonCached<any[]>('/scores/', 1800).catch(() => null);
    if (Array.isArray(cachedScores)) {
      const targetScoreEntry = cachedScores.find(
        (s: any) =>
          s &&
          String(s.author || '').toLowerCase() === String(upstreamData.author || author).toLowerCase() &&
          String(s.name || '').toLowerCase() === String(upstreamData.name || name).toLowerCase()
      );
      if (targetScoreEntry?.reviews) {
        reviewThreadCounts = parseNonZeroReviewThreadCounts(targetScoreEntry.reviews);
      }
    }
  }

  const createdAt =
    [upstreamData.approved_at, forClientData?.approved_at, upstreamData.created_at, forClientData?.created_at, d1Pkg?.created_at]
      .filter((d): d is string => typeof d === 'string' && d.trim().length > 0 && Number.isFinite(Date.parse(d)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ||
    upstreamData.created_at ||
    forClientData?.created_at ||
    d1Pkg?.created_at ||
    undefined;
  const candidateUpdatedAt =
    upstreamData.updated_at ||
    forClientData?.updated_at ||
    upstreamData.approved_at ||
    d1Pkg?.updated_at ||
    undefined;
  const latestRelDate = bundledReleases[0]?.release_date || bundledReleases[0]?.released_at;
  const updatedAt =
    latestRelDate &&
    (!candidateUpdatedAt || new Date(latestRelDate).getTime() > new Date(candidateUpdatedAt).getTime())
      ? latestRelDate
      : (candidateUpdatedAt || latestRelDate || undefined);

  const combinedTagsList = Array.from(new Set([...normalizedTags, ...d1Tags])).filter(Boolean);
  const resolvedHardDeps = finalHardDeps.length > 0 ? finalHardDeps : d1HardDeps;
  const resolvedSoftDeps = finalSoftDeps.length > 0 ? finalSoftDeps : d1SoftDeps;

  const rawGameSupport = Array.isArray(upstreamData.game_support)
    ? upstreamData.game_support
    : (Array.isArray(forClientData?.game_support) ? forClientData.game_support : []);
  const gameSupport = mergeLuantiHubAndContentDbGameSupport(
    d1Pkg?.game_support,
    rawGameSupport,
    resolvedHardDeps,
    resolvedSoftDeps
  );
  const supportsAllGames = Boolean(
    d1Pkg?.supports_all_games ||
    (typeof upstreamData.supports_all_games === 'boolean' && upstreamData.supports_all_games)
  ) || undefined;
  const screenshotMeta = parseScreenshotMetaArray(
    d1Pkg?.screenshot_meta ||
      probedCdbMeta?.screenshots ||
      upstreamData.screenshots_dict ||
      upstreamData.screenshots ||
      forClientData?.screenshots,
    screenshots
  );
  const parsedD1Translations = parsePackageTranslations(d1Pkg?.translations);
  const localizedMeta = resolveLocalizedPackageText(
    {
      title: upstreamData.title || d1Pkg?.title || name,
      short_desc: shortDesc,
      desc: extractedLongDesc || shortDesc,
      translations: parsedD1Translations
    },
    normalizedLang
  );

  const mergedTags = d1Tags.length > 0
    ? Array.from(new Set([...d1Tags]))
    : Array.from(new Set([...normalizedTags, ...d1Tags])).filter(Boolean);
  const d1BadgeTags = parseBadgeTagsArray(d1Pkg?.badge_tags);
  if (mergedTags.includes(ORGANIC_CODE_TAG) && !d1BadgeTags.includes(ORGANIC_CODE_TAG)) {
    d1BadgeTags.push(ORGANIC_CODE_TAG);
  }
  const resolvedScore = computeStarRating(
    { ...upstreamData, review_thread_counts: reviewThreadCounts, reviews_list: bundledReviews },
    d1Pkg?.score,
    d1ReviewAvg
  );

  // Only backfill D1 if this package already exists in D1 (never insert new upstream ContentDB packages into D1 on GET reads)
  if (context.env.DB && d1Pkg && !isLite) {
    const targetRowId = d1Pkg.id;
    const newRevCountsJson =
      !d1ValidRevCounts && reviewThreadCounts ? JSON.stringify(reviewThreadCounts) : null;
    const newScoreVal =
      resolvedScore === 0 && Number(d1Pkg.score) > 0
        ? 0
        : !(Number(d1Pkg.score) >= 1 && Number(d1Pkg.score) <= 5) && resolvedScore >= 1 && resolvedScore <= 5
          ? resolvedScore
          : null;
    const newTagsJson = d1Tags.length === 0 && mergedTags.length > 0 ? JSON.stringify(mergedTags) : null;
    const needsMetaBackfill =
      (!d1Pkg.license && resolvedLicense) ||
      (!d1Pkg.video_url && videoUrl) ||
      ((!d1Pkg.thumbnail_url || String(d1Pkg.thumbnail_url).includes('/thumbnails/')) && resolvedThumb) ||
      ((!d1Pkg.banner_url || d1Pkg.banner_url === 'logo.svg' || isContentDbThumbnailUrl(d1Pkg.banner_url) || (!isGitRepositoryAssetUrl(d1Pkg.banner_url) && isGitRepositoryAssetUrl(resolvedBanner))) &&
        resolvedBanner &&
        resolvedBanner !== 'logo.svg') ||
      (!d1Pkg.screenshots && screenshots.length > 0) ||
      (!d1Pkg.long_desc && extractedLongDesc) ||
      Boolean(newRevCountsJson) ||
      newScoreVal !== null ||
      Boolean(newTagsJson);

    if (needsMetaBackfill) {
      context.env.DB.prepare(`
        UPDATE packages
        SET short_desc = COALESCE(short_desc, ?),
            long_desc = COALESCE(long_desc, ?),
            thumbnail_url = CASE
              WHEN COALESCE(thumbnail_url, '') = '' OR thumbnail_url = 'logo.svg' OR thumbnail_url LIKE '%/storage/screenshots/%' OR thumbnail_url LIKE '%/shot-0.png' OR thumbnail_url LIKE '%/thumbnails/%' THEN COALESCE(?, thumbnail_url)
              ELSE thumbnail_url
            END,
            banner_url = CASE
              WHEN COALESCE(banner_url, '') = '' OR banner_url = 'logo.svg' OR banner_url LIKE '%/storage/screenshots/%' OR banner_url LIKE '%/shot-0.png' OR banner_url LIKE '%/thumbnails/%' THEN COALESCE(?, banner_url)
              ELSE COALESCE(?, banner_url)
            END,
            license = CASE WHEN COALESCE(license, '') = '' THEN COALESCE(?, license) ELSE license END,
            media_license = CASE WHEN COALESCE(media_license, '') = '' THEN COALESCE(?, media_license) ELSE media_license END,
            video_url = COALESCE(video_url, ?),
            video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
            screenshots = CASE
              WHEN COALESCE(screenshots, '') = '' OR screenshots LIKE '%/storage/screenshots/%' THEN COALESCE(?, screenshots)
              ELSE COALESCE(screenshots, ?)
            END,
            review_thread_counts = CASE
              WHEN COALESCE(review_thread_counts, '') = '' OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN COALESCE(?, review_thread_counts)
              ELSE review_thread_counts
            END,
            score = CASE WHEN ? IS NOT NULL THEN ? ELSE score END,
            tags = COALESCE(?, tags)
        WHERE id = ?
      `).bind(
        shortDesc || null,
        extractedLongDesc || null,
        resolvedThumb || null,
        resolvedBanner || null,
        resolvedBanner || null,
        resolvedLicense || null,
        resolvedMediaLicense || resolvedLicense || null,
        videoUrl || null,
        videoThumbnailUrl || null,
        screenshots.length > 0 ? JSON.stringify(screenshots) : null,
        screenshots.length > 0 ? JSON.stringify(screenshots) : null,
        newRevCountsJson,
        newScoreVal,
        newScoreVal,
        newTagsJson,
        targetRowId
      ).run().catch(() => {});
    }

    if (d1Pkg.provider !== 'contentdb' && d1Releases.length === 0 && bundledReleases.length > 0) {
      (async () => {
        try {
          const releaseStmts = bundledReleases.slice(0, MAX_PACKAGE_RELEASES).map(rel =>
            context.env.DB.prepare(`
              INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, max_minetest_version, changelog, released_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              targetRowId,
              rel.version || rel.title || 'latest',
              rel.tag_name || rel.version || 'latest',
              rel.commit_sha || 'HEAD',
              rel.download_url || rel.url || '',
              rel.min_minetest_version || minVersion || '5.0.0',
              rel.max_minetest_version || null,
              sanitizeReleaseNotesText(rel.changelog || rel.release_notes, rel.tag_name || rel.version) || null,
              rel.released_at || rel.release_date || null
            )
          );
          if (typeof context.env.DB.batch === 'function') {
            await context.env.DB.batch(releaseStmts);
          } else {
            for (const stmt of releaseStmts) {
              await stmt.run();
            }
          }
        } catch {
          // Non-fatal release cache sync
        }
      })();
    }
  }

  const enrichedFrecency = computeLuantiHubFrecencyMetrics({
    luantihubDownloads,
    score: resolvedScore,
    reviewThreadCounts,
    favoritesCount: d1FavoritesCount,
    contentdbScore: Number(upstreamData.score || 0),
    contentdbScoreDownloads: Number(upstreamData.score_downloads || 0),
    contentdbScoreReviews: Number(upstreamData.score_reviews || 0)
  });

  const enriched = {
    ...upstreamData,
    id: canonicalId,
    title: localizedMeta.title || upstreamData.title || d1Pkg?.title || name,
    author_id: d1Pkg?.author_id && !String(d1Pkg.author_id).startsWith('ext_') ? String(d1Pkg.author_id) : undefined,
    thumbnail: resolvedThumb || sanitizePackageImageUrl(upstreamData.thumbnail) || undefined,
    banner: resolvedBanner || sanitizePackageImageUrl(upstreamData.banner) || undefined,
    license: resolvedLicense,
    media_license: resolvedMediaLicense,
    min_minetest_version: minVersion,
    max_minetest_version: maxVersion,
    short_desc: localizedMeta.short_desc || shortDesc,
    long_description: localizedMeta.desc || extractedLongDesc || shortDesc,
    desc: localizedMeta.desc || extractedLongDesc || shortDesc,
    ...(parsedD1Translations ? { translations: parsedD1Translations } : {}),
    readme: readmeText || undefined,
    repo_url: repoUrl,
    git_repo_status: gitRepoStatus,
    ...(gitProbeScan?.defaultBranch || d1Pkg?.default_branch || upstreamData.default_branch
      ? { default_branch: gitProbeScan?.defaultBranch || d1Pkg?.default_branch || upstreamData.default_branch }
      : {}),
    website: upstreamData.website || forClientData?.website || probedCdbMeta?.website || undefined,
    issue_tracker: issueTrackerUrl,
    forum_url: forumUrl,
    forums: forumUrl,
    donate_url: donateUrl,
    translation_url: translationUrl,
    video_url: videoUrl,
    video_thumbnail_url: videoThumbnailUrl,
    dev_state: devState,
    provides: providesList,
    content_warnings: contentWarnings,
    ai_disclosures: aiDisclosures,
    maintainers: maintainersList,
    review_thread_counts: reviewThreadCounts,
    supports_all_games: supportsAllGames,
    game_support: gameSupport.length > 0 ? gameSupport : undefined,
    created_at: createdAt,
    updated_at: updatedAt,
    latest_commit_sha: bundledReleases[0]?.commit_sha || d1Pkg?.latest_commit_sha || undefined,
    screenshots,
    ...(screenshotMeta.length > 0 ? { screenshot_meta: screenshotMeta } : {}),
    tags: mergedTags,
    ...(d1BadgeTags.length > 0 ? { badge_tags: d1BadgeTags } : {}),
    contentdb_downloads: contentdbDownloads,
    luantihub_downloads: luantihubDownloads,
    downloads: totalDownloads,
    favorites_count: d1FavoritesCount,
    score: resolvedScore,
    contentdb_score: Number(upstreamData.score || 0) || undefined,
    luantihub_score_downloads: enrichedFrecency.luantihub_score_downloads,
    contentdb_score_downloads: enrichedFrecency.contentdb_score_downloads,
    score_downloads: enrichedFrecency.score_downloads,
    score_reviews: enrichedFrecency.score_reviews,
    download_size: downloadSizeBytes > 0 ? downloadSizeBytes : undefined,
    file_size: resolvedHeadSize || undefined,
    dependencies: finalHardDeps.length > 0 ? finalHardDeps : d1HardDeps,
    optional_dependencies: finalSoftDeps.length > 0 ? finalSoftDeps : d1SoftDeps,
    status: d1Pkg?.status || 'active',
    source: isRegisteredInGitCommunity ? 'git' : 'official',
    sources,
    releases_list: bundledReleases,
    reviews_list: bundledReviews
  };

  await writeEdgeCacheJson(edgeCacheKey, enriched, isLite ? 1800 : 600);

  return new Response(JSON.stringify(enriched), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': isLite
        ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
        : 'public, max-age=120, s-maxage=600, stale-while-revalidate=86400'
    }
  });
}

// PATCH /api/packages/:author/:name — Allow package author or admin to edit package metadata & tags (LuantiHub-first)
export async function onRequestPatch(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  try {
    const author = safeDecodeParam(context.params.author);
    const name = safeDecodeParam(context.params.name);
    const pkgId = `${author}/${name}`;

    if (!context.env.DB) {
      return Response.json({ error: 'Database unavailable.' }, { status: 503 });
    }

    await ensureExtendedPackageColumns(context.env.DB);

    const cookies = parseCookies(context.request);
    const sessionToken = cookies['lh_session'];
    if (!sessionToken) {
      return Response.json({ error: 'Authentication required to edit package.' }, { status: 401 });
    }

    const rawUserId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
    if (!rawUserId) {
      return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    const user = await reconcileAndMergeUserAccount(context.env.DB, rawUserId);
    if (!user) {
      return Response.json({ error: 'User account not found.' }, { status: 401 });
    }
    const resolvedUserId = String(user.id);

    let [identitiesRes, pkgRow] = await Promise.all([
      context.env.DB.prepare(
        `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
      ).bind(resolvedUserId).all().catch(() => ({ results: [] })),
      context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      ).bind(pkgId, author, name).first()
    ]);

    const identities = (identitiesRes.results || []).map((id: any) => ({
      provider: String(id.provider || '').toLowerCase(),
      username: String(id.username || ''),
      verified: Boolean(id.verified)
    }));

    const isAdmin = checkIsAdmin(user, identities, context.env.ADMIN_USERS);

    const body = await context.request.json().catch(() => ({})) as {
      tags?: string[];
      badge_tags?: string[];
      dev_state?: string;
      content_warnings?: string[];
      min_minetest_version?: string | null;
      max_minetest_version?: string | null;
      supports_all_games?: boolean;
      game_support?: any[];
      translations?: Record<string, { title?: string; short_desc?: string; desc?: string }>;
      title?: string;
      short_desc?: string;
      type?: string;
      repo_url?: string;
      license?: string;
      media_license?: string;
      thumbnail?: string;
    };

    // If package is not yet in D1 (e.g., ContentDB-sourced package being customized on LuantiHub),
    // verify ownership against upstream metadata or verified identity and seed a D1 row (with offline fallback).
    if (!pkgRow) {
      const encodedAuthor = encodeURIComponent(author);
      const encodedName = encodeURIComponent(name);
      const upstreamPkg = await fetchUpstreamJsonCached(`/api/packages/${encodedAuthor}/${encodedName}/`, 600).catch(() => null);
      const seedPkg: any = upstreamPkg || {
        author,
        name,
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : name,
        type: typeof body.type === 'string' && ['mod', 'game', 'txp', 'modpack'].includes(body.type) ? body.type : 'mod',
        short_description: typeof body.short_desc === 'string' ? body.short_desc.trim() : '',
        long_description: '',
        repo: typeof body.repo_url === 'string' ? body.repo_url.trim() : '',
        license: typeof body.license === 'string' && body.license.trim() ? body.license.trim() : 'MIT',
        media_license: typeof body.media_license === 'string' && body.media_license.trim() ? body.media_license.trim() : 'CC-BY-SA-4.0',
        thumbnail: typeof body.thumbnail === 'string' && body.thumbnail.trim() ? body.thumbnail.trim() : null,
        tags: Array.isArray(body.tags) ? body.tags : []
      };
      const virtualPkgRow = {
        id: `${seedPkg.author || author}/${seedPkg.name || name}`,
        author_name: seedPkg.author || author,
        name: seedPkg.name || name,
        repo_url: seedPkg.repo || '',
        provider: 'contentdb',
        type: seedPkg.type || 'mod',
        tags: JSON.stringify(Array.isArray(seedPkg.tags) ? seedPkg.tags : [])
      };
      const canSeed = isAdmin || verifyStrictPackageAuthorOwnership(user, identities, virtualPkgRow, author);
      if (!canSeed) {
        return Response.json({
          error: 'Forbidden: Only an administrator or the cryptographically verified package author on the hosting Git forge can edit this package.'
        }, { status: 403 });
      }
      await context.env.DB.prepare(
        `INSERT OR IGNORE INTO packages (
          id, author_id, author_name, name, title, type, short_desc, long_desc,
          repo_url, provider, license, media_license, thumbnail_url, tags, badge_tags,
          dev_state, content_warnings, min_minetest_version, max_minetest_version,
          supports_all_games, game_support, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(
        virtualPkgRow.id,
        resolvedUserId,
        virtualPkgRow.author_name,
        virtualPkgRow.name,
        seedPkg.title || virtualPkgRow.name,
        virtualPkgRow.type,
        seedPkg.short_description || '',
        seedPkg.long_description || '',
        virtualPkgRow.repo_url || null,
        'contentdb',
        seedPkg.license || 'MIT',
        seedPkg.media_license || seedPkg.license || 'CC-BY-SA-4.0',
        seedPkg.thumbnail || null,
        virtualPkgRow.tags,
        JSON.stringify(parseBadgeTagsArray(body.badge_tags)),
        seedPkg.dev_state || 'ACTIVELY_DEVELOPED',
        JSON.stringify(Array.isArray(seedPkg.content_warnings) ? seedPkg.content_warnings : []),
        seedPkg.min_minetest_version ? String(seedPkg.min_minetest_version) : null,
        seedPkg.max_minetest_version ? String(seedPkg.max_minetest_version) : null,
        seedPkg.supports_all_games ? 1 : 0,
        JSON.stringify(parseGameSupportArray(seedPkg.game_support))
      ).run();
      pkgRow = await context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) LIMIT 1`
      ).bind(virtualPkgRow.id).first();
    }

    if (!pkgRow) {
      return Response.json({ error: 'Package not found in D1 registry.' }, { status: 404 });
    }

    const isOwner =
      isAdmin ||
      verifyStrictPackageAuthorOwnership(user, identities, pkgRow, author);

    if (!isOwner) {
      return Response.json({
        error: 'Forbidden: Only an administrator or the cryptographically verified package author on the hosting Git forge can edit this package.'
      }, { status: 403 });
    }

    const existingTags = parseJsonArray(pkgRow.tags);
    let finalTags = existingTags;
    let cleanedCustomTags: string[] = [];

    if (Array.isArray(body.tags)) {
      const systemTagSet = new Set(['git', 'github', 'codeberg', 'mesehub', 'gitlab', 'bitbucket', 'contentdb', 'mod', 'game', 'txp', 'modpack']);
      cleanedCustomTags = body.tags
        .map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9_/-]/g, ''))
        .filter(t => Boolean(t) && !systemTagSet.has(t))
        .slice(0, 8);

      const preservedSystemTags = existingTags.filter((t: string) => systemTagSet.has(String(t).toLowerCase()));
      if (pkgRow.provider && pkgRow.provider !== 'contentdb' && !preservedSystemTags.includes('git')) {
        preservedSystemTags.push('git');
      }
      if (pkgRow.provider && !preservedSystemTags.includes(pkgRow.provider)) {
        preservedSystemTags.push(pkgRow.provider);
      }
      if (pkgRow.type && !preservedSystemTags.includes(pkgRow.type)) {
        preservedSystemTags.push(pkgRow.type);
      }

      finalTags = Array.from(new Set([...cleanedCustomTags, ...preservedSystemTags]));
    }

    // Validate badge_tags (e.g. 'organic_code' -> "100% Organic Code")
    let finalBadgeTags = parseBadgeTagsArray(pkgRow.badge_tags);
    if (Array.isArray(body.badge_tags)) {
      finalBadgeTags = parseBadgeTagsArray(body.badge_tags);
    } else if (Array.isArray(body.tags)) {
      if (body.tags.some(t => String(t).trim().toLowerCase() === ORGANIC_CODE_TAG)) {
        if (!finalBadgeTags.includes(ORGANIC_CODE_TAG)) {
          finalBadgeTags.push(ORGANIC_CODE_TAG);
        }
      }
    }

    // Validate dev_state (LuantiHub-first taxonomy)
    const validDevStates = new Set(LUANTIHUB_DEV_STATES.map((d) => d.name));
    let finalDevState = pkgRow.dev_state ? String(pkgRow.dev_state) : 'ACTIVELY_DEVELOPED';
    if (typeof body.dev_state === 'string') {
      const normalizedDevState = body.dev_state.trim().toUpperCase();
      if (validDevStates.has(normalizedDevState)) {
        finalDevState = normalizedDevState;
      }
    }

    // Validate content_warnings (LuantiHub-first taxonomy, excluding AI disclosures)
    const validWarnings = new Set(LUANTIHUB_CONTENT_WARNINGS.map((w) => w.name));
    let finalContentWarnings = parseJsonArray(pkgRow.content_warnings);
    if (Array.isArray(body.content_warnings)) {
      finalContentWarnings = Array.from(
        new Set(
          body.content_warnings
            .map((w) => String(w || '').trim().toLowerCase())
            .filter((w) => (validWarnings.has(w) || /^[a-z0-9_]{2,40}$/.test(w)) && !w.startsWith('ai_'))
        )
      ).slice(0, 12);
    }

    // Validate engine versions
    let finalMinEngine = pkgRow.min_minetest_version ? String(pkgRow.min_minetest_version) : null;
    if (body.min_minetest_version !== undefined) {
      const cleaned = String(body.min_minetest_version || '').trim();
      finalMinEngine = cleaned && /^[0-9]+\.[0-9]+(\.[0-9]+)?(-dev)?$/.test(cleaned) ? cleaned : null;
    }

    let finalMaxEngine = pkgRow.max_minetest_version ? String(pkgRow.max_minetest_version) : null;
    if (body.max_minetest_version !== undefined) {
      const cleaned = String(body.max_minetest_version || '').trim();
      finalMaxEngine = cleaned && /^[0-9]+\.[0-9]+(\.[0-9]+)?(-dev)?$/.test(cleaned) ? cleaned : null;
    }

    // Validate supports_all_games & game_support (including supports: false)
    let finalSupportsAllGames = Boolean(pkgRow.supports_all_games);
    if (typeof body.supports_all_games === 'boolean') {
      finalSupportsAllGames = body.supports_all_games;
    }

    let finalGameSupport = parseGameSupportArray(pkgRow.game_support);
    if (Array.isArray(body.game_support)) {
      finalGameSupport = parseGameSupportArray(body.game_support).slice(0, 20);
    }

    // Validate translations (LuantiHub-first localized title/short_desc/desc)
    let finalTranslations = parsePackageTranslations(pkgRow.translations) || {};
    if (body.translations && typeof body.translations === 'object') {
      const mergedTranslations = { ...finalTranslations };
      for (const [rawLang, rawEntry] of Object.entries(body.translations)) {
        const lang = String(rawLang || '').trim();
        if (!lang || !/^[a-z]{2,3}(?:[_-][a-z0-9]{2,4})?$/i.test(lang)) continue;
        if (!rawEntry || typeof rawEntry !== 'object') {
          delete mergedTranslations[lang];
          delete mergedTranslations[lang.toLowerCase()];
          continue;
        }
        const entryObj = rawEntry as any;
        const title = typeof entryObj.title === 'string' ? entryObj.title.trim().slice(0, 100) : undefined;
        const short_desc = typeof entryObj.short_desc === 'string' ? entryObj.short_desc.trim().slice(0, 260) : undefined;
        const desc = typeof entryObj.desc === 'string' ? entryObj.desc.trim().slice(0, 20000) : undefined;
        if (title || short_desc || desc) {
          mergedTranslations[lang] = {
            ...(title ? { title } : {}),
            ...(short_desc ? { short_desc } : {}),
            ...(desc ? { desc } : {})
          };
        } else {
          delete mergedTranslations[lang];
          delete mergedTranslations[lang.toLowerCase()];
        }
      }
      finalTranslations = mergedTranslations;
    }

    const runUpdatePkg = async () => {
      await context.env.DB.prepare(
        `UPDATE packages SET
          tags = ?,
          badge_tags = ?,
          dev_state = ?,
          content_warnings = ?,
          min_minetest_version = ?,
          max_minetest_version = ?,
          supports_all_games = ?,
          game_support = ?,
          translations = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).bind(
        JSON.stringify(finalTags),
        JSON.stringify(finalBadgeTags),
        finalDevState,
        JSON.stringify(finalContentWarnings),
        finalMinEngine,
        finalMaxEngine,
        finalSupportsAllGames ? 1 : 0,
        JSON.stringify(finalGameSupport),
        Object.keys(finalTranslations).length > 0 ? JSON.stringify(finalTranslations) : null,
        pkgRow.id
      ).run();
    };

    try {
      await runUpdatePkg();
    } catch (updateErr: any) {
      if (/no such column|has no column/i.test(String(updateErr?.message || ''))) {
        await ensureExtendedPackageColumns(context.env.DB, true);
        await runUpdatePkg();
      } else {
        throw updateErr;
      }
    }

    if (cleanedCustomTags.length > 0) {
      await upsertCustomAppTags(context.env.DB, cleanedCustomTags, 'custom');
    }

    if (finalBadgeTags.length > 0) {
      const badgeCatalogTagItems = resolveBadgeTagItemsForCatalog(finalBadgeTags);
      const knownBadgeByLower = new Map(
        LUANTIHUB_BADGE_TAGS.map((b) => [b.name.toLowerCase(), b])
      );
      await Promise.all([
        upsertMetadataOptions(
          context.env.DB,
          'badge_tags',
          badgeCatalogTagItems.map((item, idx) => {
            const known = knownBadgeByLower.get(item.name.toLowerCase());
            return {
              name: item.name,
              title: known?.title || item.title,
              description: known?.tooltip,
              icon: known?.icon,
              sort_order: idx
            };
          }),
          'luantihub'
        ),
        upsertCustomAppTags(context.env.DB, badgeCatalogTagItems, 'luantihub')
      ]);
    }

    await invalidateEdgeCacheKeys(
      buildPackageCacheInvalidationKeys(author, name, {
        includeBootCatalog: true,
        includeAuthorProfile: true
      })
    );

    return Response.json({
      success: true,
      ok: true,
      tags: finalTags,
      badge_tags: finalBadgeTags,
      dev_state: finalDevState,
      content_warnings: finalContentWarnings,
      min_minetest_version: finalMinEngine,
      max_minetest_version: finalMaxEngine,
      supports_all_games: finalSupportsAllGames,
      game_support: finalGameSupport,
      translations: Object.keys(finalTranslations).length > 0 ? finalTranslations : undefined
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Could not update package metadata.') },
      { status: 500 }
    );
  }
}

// POST /api/packages/:author/:name?view=1 — Lightweight non-blocking web view beacon
export async function onRequestPost(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  try {
    const author = safeDecodeParam(context.params.author);
    const name = safeDecodeParam(context.params.name);
    if (!author || !name) {
      return Response.json({ recorded: false }, { status: 400 });
    }
    const pkgId = `${author}/${name}`;
    let recorded = false;
    if (context.env.DB) {
      recorded = await recordWebPackageView(
        context.env.DB,
        context.request,
        pkgId,
        context.env.SESSION_SECRET
      );
    }
    return Response.json(
      { recorded },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'private, no-store'
        }
      }
    );
  } catch {
    return Response.json({ recorded: false }, { status: 200 });
  }
}

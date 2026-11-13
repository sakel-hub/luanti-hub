import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl,
  buildGitTagArchiveUrl,
  parseGitRepoTarget,
  normalizeLuantiPackageZip,
  ensureExtendedPackageColumns,
  formatByteSize,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  fetchWithAnubisSupport,
  buildSharedZipCacheKey,
  getCachedNormalizedZip,
  setCachedNormalizedZip,
  buildPackageCacheInvalidationKeys,
  buildPackageStatsEdgeCacheKey,
  buildAuthorStatsEdgeCacheKey,
  readResponseBytesBounded
} from '../../../lib/upstream';
import { findJam2026BrewRepoBySlug } from '../../../lib/jam-2026';
import { parseCookies, verifySessionToken } from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

const recentDownloadWrites = new Map<string, number>();
const DOWNLOAD_WRITE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per IP + package
const BOOT_CATALOG_EVICT_COOLDOWN_MS = 60_000; // 60s burst guard so download storms do not thrash boot catalog
let lastBootCatalogEvictAtMs = 0;
let userDownloadsSchemaReady = false;

export function resetDownloadTelemetryCooldownForTests(): void {
  recentDownloadWrites.clear();
  lastBootCatalogEvictAtMs = 0;
}

async function shouldRecordDownloadWrite(request: Request, packageId: string): Promise<boolean> {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return false;
  }

  try {
    const reqUrl = new URL(request.url, 'https://luantihub.local');
    const reason = (reqUrl.searchParams.get('reason') || '').trim().toLowerCase();
    const sandboxFlag = (reqUrl.searchParams.get('sandbox') || '').trim().toLowerCase();
    if (reason === 'sandbox' || reason === 'preview' || sandboxFlag === '1' || sandboxFlag === 'true') {
      return false;
    }
  } catch {
    // Proceed with header checks
  }

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
  const dedupKey = `${clientIp}:${normalizedPkg}`;
  const now = Date.now();

  if (recentDownloadWrites.size > 2000) {
    for (const [k, exp] of recentDownloadWrites.entries()) {
      if (exp <= now) recentDownloadWrites.delete(k);
    }
  }

  const memExpiry = recentDownloadWrites.get(dedupKey);
  if (memExpiry && memExpiry > now) {
    return false;
  }

  const edgeCacheKey = `/dedup/download/${encodeURIComponent(clientIp)}/${encodeURIComponent(normalizedPkg)}`;
  const cachedHit = await readEdgeCacheJson<{ ts: number }>(edgeCacheKey);
  if (cachedHit) {
    recentDownloadWrites.set(dedupKey, now + DOWNLOAD_WRITE_COOLDOWN_MS);
    return false;
  }

  recentDownloadWrites.set(dedupKey, now + DOWNLOAD_WRITE_COOLDOWN_MS);
  await writeEdgeCacheJson(edgeCacheKey, { ts: now }, 600);
  return true;
}

export async function onRequest(context: {
  params: { author: string; name: string; release?: string };
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<any>) => void;
}) {
  const author = safeDecodeParam(context.params.author || '');
  const name = safeDecodeParam(context.params.name || '');
  const release = context.params.release ? safeDecodeParam(context.params.release) : undefined;
  const packageId = `${author}/${name}`;
  const { env, request } = context;

  const scheduleBackground = (work: Promise<any>): Promise<void> => {
    if (typeof context.waitUntil === 'function' && request.method !== 'POST') {
      context.waitUntil(work.catch(() => {}));
      return Promise.resolve();
    }
    return work.then(() => {}).catch(() => {});
  };

  let pkgRecord: any = null;

  // 1. Instant Kill Switch Check & Package Metadata Lookup in Cloudflare D1
  if (env.DB) {
    try {
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      pkgRecord = await env.DB.prepare(
        `SELECT id, author_name, name, type, status, status_reason, repo_url, provider, default_branch, min_minetest_version, download_size, file_size, tags, contentdb_downloads, latest_commit_sha, updated_at
         FROM packages
         WHERE LOWER(id) = LOWER(?)
         LIMIT 1`
      ).bind(packageId).first();

      if (!pkgRecord) {
        pkgRecord = await env.DB.prepare(
          `SELECT id, author_name, name, type, status, status_reason, repo_url, provider, default_branch, min_minetest_version, download_size, file_size, tags, contentdb_downloads, latest_commit_sha, updated_at
           FROM packages
           WHERE LOWER(author_name) = LOWER(?) AND LOWER(REPLACE(name, '-', '_')) = ?
           LIMIT 1`
        ).bind(author, sanitizedName).first();
      }

      if (!pkgRecord) {
        const baseAuthor = (author || '').replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
        pkgRecord = await env.DB.prepare(
          `SELECT id, author_name, name, type, status, status_reason, repo_url, provider, default_branch, min_minetest_version, download_size, file_size, tags, contentdb_downloads, latest_commit_sha, updated_at
           FROM packages
           WHERE (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?)
             AND (
               LOWER(REPLACE(REPLACE(author_name, '-hub', ''), '_hub', '')) = LOWER(?)
               OR ? = ''
               OR ? = 'undefined'
             )
           LIMIT 1`
        ).bind(name, sanitizedName, baseAuthor, author || '', author || '').first();
      }

      if (pkgRecord && (pkgRecord.status === 'flagged' || pkgRecord.status === 'delisted')) {
        return new Response(JSON.stringify({
          error: 'Download blocked: This package has been delisted or suspended.',
          status: pkgRecord.status,
          reason: pkgRecord.status_reason || 'Policy / DMCA Takedown'
        }), {
          status: 451,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch {
      // Proceed if table not migrated yet
    }

    const effectivePkgId = pkgRecord?.id || packageId;

    // 2. Record download telemetry in Cloudflare D1 (non-blocking via waitUntil on GET downloads so .zip streams in < 5ms)
    const recordDownloadTelemetry = async () => {
      try {
        const shouldWrite = await shouldRecordDownloadWrite(request, effectivePkgId);
        if (shouldWrite) {
          await ensureExtendedPackageColumns(env.DB);
          const parsedReqUrl = new URL(request.url, 'https://luantihub.local');
          const rawReason = (parsedReqUrl.searchParams.get('reason') || '').trim().toLowerCase();
          const ua = (request.headers.get('User-Agent') || '').trim();
          const isEngineUa = /^(?:luanti|minetest)\b/i.test(ua);
          const isEngineReason = rawReason === 'new' || rawReason === 'update' || rawReason === 'dependency';
          const platformLuanti = isEngineUa || isEngineReason ? 1 : 0;
          const platformWeb = platformLuanti ? 0 : 1;
          const reasonNew = rawReason === 'new' ? 1 : 0;
          const reasonUpdate = rawReason === 'update' ? 1 : 0;
          const reasonDependency = rawReason === 'dependency' ? 1 : 0;
          const reasonWeb = isEngineReason ? 0 : 1;

          await env.DB.prepare(`
            INSERT INTO package_daily_downloads (
              package_id, download_date, downloads_count,
              platform_luanti, platform_web,
              reason_new, reason_update, reason_dependency, reason_web
            )
            VALUES (?, DATE('now'), 1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(package_id, download_date)
            DO UPDATE SET
              downloads_count = downloads_count + 1,
              platform_luanti = COALESCE(platform_luanti, 0) + excluded.platform_luanti,
              platform_web = COALESCE(platform_web, 0) + excluded.platform_web,
              reason_new = COALESCE(reason_new, 0) + excluded.reason_new,
              reason_update = COALESCE(reason_update, 0) + excluded.reason_update,
              reason_dependency = COALESCE(reason_dependency, 0) + excluded.reason_dependency,
              reason_web = COALESCE(reason_web, 0) + excluded.reason_web
          `).bind(
            effectivePkgId,
            platformLuanti,
            platformWeb,
            reasonNew,
            reasonUpdate,
            reasonDependency,
            reasonWeb
          ).run();

          const dailySumRow = await env.DB.prepare(
            `SELECT COALESCE(SUM(downloads_count), 0) as total_lh
             FROM package_daily_downloads
             WHERE LOWER(package_id) IN (LOWER(?), LOWER(?))`
          ).bind(effectivePkgId, packageId).first().catch(() => ({ total_lh: 1 }));
          const authoritativeDailySum = Math.max(1, Number(dailySumRow?.total_lh || 1));

          await env.DB.prepare(`
            UPDATE packages
            SET
              luantihub_downloads = MAX(COALESCE(luantihub_downloads, 0) + 1, ?),
              downloads_count = COALESCE(contentdb_downloads, 0) + MAX(COALESCE(luantihub_downloads, 0) + 1, ?)
            WHERE LOWER(id) IN (LOWER(?), LOWER(?))
          `).bind(authoritativeDailySum, authoritativeDailySum, effectivePkgId, packageId).run();

          const statsAuthor = pkgRecord?.author_name || author;
          const statsName = pkgRecord?.name || name;
          const nowEvictMs = Date.now();
          const shouldEvictBoot =
            lastBootCatalogEvictAtMs === 0 ||
            nowEvictMs - lastBootCatalogEvictAtMs >= BOOT_CATALOG_EVICT_COOLDOWN_MS;
          if (shouldEvictBoot) {
            lastBootCatalogEvictAtMs = nowEvictMs;
          }
          const keysToInvalidate = buildPackageCacheInvalidationKeys(statsAuthor, statsName, {
            includeBootCatalog: shouldEvictBoot,
            includeAuthorProfile: shouldEvictBoot,
            extraAuthors: author && author.toLowerCase() !== String(statsAuthor).toLowerCase() ? [author] : undefined
          });
          if (shouldEvictBoot) {
            keysToInvalidate.push('https://edge-cache.luantihub.local/__pkg_daily_dl_sum_v1');
          }
          await invalidateEdgeCacheKeys(keysToInvalidate).catch(() => {});

          const cookies = parseCookies(request);
          const sessionToken = cookies['lh_session'];
          const userId = sessionToken
            ? await verifySessionToken(sessionToken, env.SESSION_SECRET)
            : null;

          if (userId) {
            const upsertUserDownload = () =>
              env.DB.prepare(`
                INSERT INTO user_downloads (user_id, package_id, download_count, last_downloaded_at)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, package_id)
                DO UPDATE SET
                  download_count = download_count + 1,
                  last_downloaded_at = CURRENT_TIMESTAMP
              `).bind(userId, effectivePkgId).run();

            try {
              await upsertUserDownload();
              userDownloadsSchemaReady = true;
            } catch {
              if (!userDownloadsSchemaReady) {
                await env.DB.prepare(`
                  CREATE TABLE IF NOT EXISTS user_downloads (
                    user_id TEXT NOT NULL,
                    package_id TEXT NOT NULL,
                    download_count INTEGER NOT NULL DEFAULT 1,
                    last_downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, package_id)
                  )
                `).run();
                userDownloadsSchemaReady = true;
                await upsertUserDownload();
              }
            }
          }
        }
      } catch (err) {
        console.warn('D1 download tracking error:', err);
      }
    };

    await scheduleBackground(recordDownloadTelemetry());
  }

  const effectivePkgId = pkgRecord?.id || packageId;
  const effectiveAuthor = pkgRecord?.author_name || author;
  const effectiveName = pkgRecord?.name || name;

  const healPackageDownloadSizeIfChanged = async (zipBytes: number) => {
    if (!env.DB || !pkgRecord?.id || zipBytes <= 0) return;
    const prevSize = Number(pkgRecord.download_size || 0);
    if (prevSize === zipBytes) return;
    const formattedSize = formatByteSize(zipBytes);
    if (!formattedSize) return;
    await env.DB.prepare(`
      UPDATE packages
      SET download_size = ?, file_size = ?
      WHERE LOWER(id) = LOWER(?)
    `).bind(zipBytes, formattedSize, pkgRecord.id).run().catch(() => {});
    await invalidateEdgeCacheKeys(
      buildPackageCacheInvalidationKeys(effectiveAuthor, effectiveName, {
        includeBootCatalog: false
      })
    ).catch(() => {});
  };

  // 3. If it is a background telemetry POST ping
  if (request.method === 'POST') {
    return new Response(JSON.stringify({
      success: true,
      package_id: effectivePkgId,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
      }
    });
  }

  // 4. Resolve, Verify & Normalize Ready-to-Install Luanti Engine .zip Archive
  const reqUrl = new URL(request.url, 'https://luantihub.local');
  const requestedTag = (reqUrl.searchParams.get('tag') || reqUrl.searchParams.get('ref') || '').trim();
  const queryRelease = (reqUrl.searchParams.get('release') || '').trim();
  const rawReason = (reqUrl.searchParams.get('reason') || '').trim().toLowerCase();

  const encAuthor = encodeURIComponent(effectiveAuthor);
  const encName = encodeURIComponent(effectiveName);
  let resolvedReleaseId =
    (release && /^\d+$/.test(String(release)) ? String(release) : '') ||
    (/^\d+$/.test(queryRelease) ? queryRelease : '');
  const isPureGitPkg = Boolean(pkgRecord && pkgRecord.provider && pkgRecord.provider !== 'contentdb');
  const d1VersionFingerprint = isPureGitPkg
    ? String(pkgRecord?.latest_commit_sha || pkgRecord?.updated_at || '').trim()
    : '';

  // Check Shared Isolate Memory & Cloudflare Edge Cache for already-normalized .zip binary.
  // When `reason=update` is passed by the Luanti client for an upstream ContentDB package without an explicit
  // release ID in the URL, resolve the latest upstream release ID first so updates never return a stale `latest` zip.
  const latestEdgeZipCacheKey = buildSharedZipCacheKey(effectiveAuthor, effectiveName, 'latest');
  const initialEdgeZipCacheKey = buildSharedZipCacheKey(
    effectiveAuthor,
    effectiveName,
    requestedTag || resolvedReleaseId || d1VersionFingerprint || 'latest'
  );
  const canUseFastPreResolutionCache =
    rawReason !== 'update' || Boolean(requestedTag || resolvedReleaseId || isPureGitPkg);
  if (canUseFastPreResolutionCache) {
    const cachedZipHit =
      (await getCachedNormalizedZip(initialEdgeZipCacheKey, request)) ||
      (!requestedTag && !resolvedReleaseId && rawReason !== 'update' && initialEdgeZipCacheKey !== latestEdgeZipCacheKey
        ? await getCachedNormalizedZip(latestEdgeZipCacheKey, request)
        : null);
    if (cachedZipHit) {
      if (!requestedTag && cachedZipHit.byteLength > 0) {
        await scheduleBackground(healPackageDownloadSizeIfChanged(cachedZipHit.byteLength));
      }
      return cachedZipHit.response;
    }
  }

  let d1Releases: any[] = [];
  if (env.DB) {
    try {
      const relRes = await env.DB.prepare(
        `SELECT id, version, tag_name, commit_sha, download_url FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY id ASC`
      ).bind(effectivePkgId).all();
      d1Releases = relRes.results || [];
    } catch {
      // Proceed below
    }
  }

  let upstreamReleaseUrl = '';
  let upstreamCommitSha = '';
  let effectiveRepoUrl = String(pkgRecord?.repo_url || '').trim();
  let effectiveType = String(pkgRecord?.type || 'mod').toLowerCase();

  // Fetch ContentDB releases, package metadata & for-client metadata (cached at Edge, with milcho.org JSON failover)
  // to discover `repo_url`, release ID, commit SHA, and fallback `.zip` upload URLs when not already in D1.
  // When `rawReason === 'update'`, bypass the 5-minute `/releases/` cache (ttl=0) so newly published releases are discovered immediately.
  const releaseMetadataTtl = rawReason === 'update' ? 0 : 300;
  const [upstreamReleases, upstreamPkg, forClient] = await Promise.all([
    !isPureGitPkg
      ? fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/releases/`, releaseMetadataTtl).catch(() => null)
      : Promise.resolve(null),
    (!effectiveRepoUrl && !isPureGitPkg)
      ? fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 600).catch(() => null)
      : Promise.resolve(null),
    (!resolvedReleaseId || !effectiveRepoUrl) && !isPureGitPkg
      ? fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/for-client/?formspec_version=8`, releaseMetadataTtl).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (Array.isArray(upstreamReleases) && upstreamReleases.length > 0) {
    const matchedUpstreamRel = resolvedReleaseId
      ? upstreamReleases.find((r: any) => String(r?.id) === resolvedReleaseId) || upstreamReleases[0]
      : upstreamReleases[0];
    if (matchedUpstreamRel) {
      if (!resolvedReleaseId && matchedUpstreamRel.id) {
        resolvedReleaseId = String(matchedUpstreamRel.id);
      }
      if (typeof matchedUpstreamRel.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(matchedUpstreamRel.commit.trim())) {
        upstreamCommitSha = matchedUpstreamRel.commit.trim();
      }
      if (typeof matchedUpstreamRel.url === 'string' && matchedUpstreamRel.url.trim()) {
        const rawUrl = matchedUpstreamRel.url.trim();
        upstreamReleaseUrl = rawUrl.startsWith('http')
          ? rawUrl
          : `https://content.luanti.org${rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl}`;
      }
    }
  }

  const normalizeRepoCandidate = (raw?: any): string => {
    if (typeof raw !== 'string' || !raw.trim()) return '';
    const trimmed = raw.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
    try {
      const u = new URL(trimmed);
      const parts = u.pathname.split('/').filter(Boolean);
      if (u.hostname.toLowerCase().includes('notabug.org') && parts.length >= 2) {
        return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1]}`;
      }
    } catch {
      // Keep original
    }
    return trimmed;
  };

  if (!effectiveRepoUrl) {
    effectiveRepoUrl =
      normalizeRepoCandidate(upstreamPkg?.repo) ||
      normalizeRepoCandidate(upstreamPkg?.repo_url) ||
      normalizeRepoCandidate(forClient?.repo) ||
      normalizeRepoCandidate(forClient?.repo_url) ||
      normalizeRepoCandidate(forClient?.info_hypertext?.links?.repo) ||
      normalizeRepoCandidate(forClient?.info_hypertext?.links?.git_repo);
  }

  const applyUpstreamPackageType = (rawType?: unknown, rawProvides?: unknown) => {
    const normalized = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
    if (normalized === 'game' || normalized === 'txp' || normalized === 'modpack') {
      effectiveType = normalized;
    } else if (normalized === 'mod' && (!pkgRecord?.type || String(pkgRecord.type).toLowerCase() === 'mod')) {
      effectiveType = 'mod';
    }
    // ContentDB represents modpacks as `type: "mod"` with multiple `provides`, whereas multi-mod games
    // (`type: "game"`, e.g. Warr1024/confspace) also list all sub-mods in `provides` (`tree.get_mod_names()`).
    // Only promote `'mod'` to `'modpack'` — never clobber `'game'` or `'txp'`.
    if (effectiveType === 'mod' && Array.isArray(rawProvides) && rawProvides.length > 1) {
      effectiveType = 'modpack';
    }
  };

  if (!effectiveRepoUrl) {
    const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 1800).catch(() => null);
    if (Array.isArray(bulkCatalog)) {
      const lowerA = effectiveAuthor.toLowerCase();
      const lowerN = effectiveName.toLowerCase();
      const found = bulkCatalog.find(
        (item: any) =>
          item &&
          String(item.author || '').toLowerCase() === lowerA &&
          String(item.name || '').toLowerCase() === lowerN
      );
      if (found) {
        effectiveRepoUrl = normalizeRepoCandidate(found.repo || found.repo_url);
        if (!resolvedReleaseId && found.release) {
          resolvedReleaseId = String(found.release);
        }
        applyUpstreamPackageType(found.type, found.provides);
      }
    }
  }

  let matchedJamBrewFallback = false;
  if (!effectiveRepoUrl) {
    const jamRepo = await findJam2026BrewRepoBySlug(effectiveAuthor, effectiveName).catch(() => undefined);
    if (jamRepo) {
      effectiveRepoUrl = normalizeRepoCandidate(jamRepo);
      matchedJamBrewFallback = true;
      if (!pkgRecord?.type || String(pkgRecord.type).toLowerCase() === 'mod') {
        effectiveType = 'game';
      }
    }
  }

  if (effectiveRepoUrl && env.DB && pkgRecord?.id) {
    env.DB.prepare(`UPDATE packages SET repo_url = ? WHERE LOWER(id) = LOWER(?) AND COALESCE(repo_url, '') = ''`)
      .bind(effectiveRepoUrl, pkgRecord.id)
      .run()
      .catch(() => {});
  }

  if (upstreamPkg) {
    applyUpstreamPackageType(upstreamPkg.type, upstreamPkg.provides);
  }

  if (forClient) {
    if (!resolvedReleaseId && forClient.release) {
      resolvedReleaseId = String(forClient.release);
    }
    applyUpstreamPackageType(forClient.type, forClient.provides);
  }

  const edgeZipCacheKey = buildSharedZipCacheKey(
    effectiveAuthor,
    effectiveName,
    requestedTag || resolvedReleaseId || upstreamCommitSha || d1VersionFingerprint || 'latest'
  );
  if (edgeZipCacheKey !== initialEdgeZipCacheKey || !canUseFastPreResolutionCache) {
    const resolvedZipHit = await getCachedNormalizedZip(edgeZipCacheKey);
    if (resolvedZipHit) {
      if (!requestedTag && resolvedZipHit.byteLength > 0) {
        await scheduleBackground(healPackageDownloadSizeIfChanged(resolvedZipHit.byteLength));
      }
      return resolvedZipHit.response;
    }
  }

  const downloadPath = resolvedReleaseId
    ? `/packages/${encAuthor}/${encName}/releases/${encodeURIComponent(resolvedReleaseId)}/download/`
    : `/packages/${encAuthor}/${encName}/download/`;
  const primaryContentDbDownloadUrl = `https://content.luanti.org${downloadPath}`;

  // Build prioritized candidate .zip URLs (Git-hosted archives FIRST, ContentDB as fallback)
  const candidateUrls: string[] = [];
  const seenCandidates = new Set<string>();
  const addCandidate = (url?: string | null) => {
    const clean = typeof url === 'string' ? url.trim() : '';
    if (!clean || !clean.startsWith('http') || seenCandidates.has(clean)) return;
    // Never add contentdb.milcho.org for binary downloads (it is a static SPA that returns 200 OK index.html)
    if (clean.includes('contentdb.milcho.org')) return;
    seenCandidates.add(clean);
    candidateUrls.push(clean);
  };

  // If a specific Git tag or branch ref was requested (e.g. from the Releases tab), prioritize it first
  if (requestedTag) {
    const matchedD1Tag = d1Releases.find(
      (r: any) =>
        r &&
        r.download_url &&
        (String(r.tag_name || '').toLowerCase() === requestedTag.toLowerCase() ||
          String(r.version || '').toLowerCase() === requestedTag.toLowerCase())
    );
    if (matchedD1Tag?.download_url) {
      addCandidate(matchedD1Tag.download_url);
    }
    if (effectiveRepoUrl) {
      const target = parseGitRepoTarget(effectiveRepoUrl, effectiveAuthor, effectiveName);
      if (target) {
        addCandidate(buildGitTagArchiveUrl(target.provider, target.host, target.owner, target.repo, requestedTag));
      }
      addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, requestedTag));
    }
  }

  const taggedRelease = d1Releases.find(
    (r: any) => r && r.download_url && r.commit_sha !== 'HEAD' && r.version !== 'latest'
  );
  if (taggedRelease?.download_url) {
    addCandidate(taggedRelease.download_url);
  }

  if (effectiveRepoUrl) {
    if (requestedTag && !candidateUrls.length) {
      try {
        const gitReleases = await fetchGitRepoReleasesAndTags(
          effectiveRepoUrl,
          effectiveAuthor,
          effectiveName,
          pkgRecord?.min_minetest_version || '5.0.0'
        );
        if (gitReleases.length > 0) {
          const matchedGitRel = gitReleases.find(
            r =>
              r.tag_name.toLowerCase() === requestedTag.toLowerCase() ||
              r.version.toLowerCase() === requestedTag.toLowerCase()
          );
          if (matchedGitRel?.download_url) {
            addCandidate(matchedGitRel.download_url);
          }
        }
      } catch {
        // Proceed to branch archive fallbacks
      }
    }

    for (const r of d1Releases) {
      if (r?.download_url) addCandidate(r.download_url);
    }

    if (upstreamCommitSha) {
      const target = parseGitRepoTarget(effectiveRepoUrl, effectiveAuthor, effectiveName);
      if (target) {
        if (target.provider === 'gitlab') {
          const projectPath = encodeURIComponent(`${target.owner}/${target.repo}`);
          addCandidate(`https://${target.host}/api/v4/projects/${projectPath}/repository/archive.zip?sha=${encodeURIComponent(upstreamCommitSha)}`);
        } else {
          addCandidate(`https://${target.host}/${target.owner}/${target.repo}/archive/${encodeURIComponent(upstreamCommitSha)}.zip`);
        }
      }
    }

    // Always include HEAD.zip (auto-resolves default branch whether `main`, `master`, or custom)
    addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, 'HEAD'));
    if (pkgRecord?.default_branch && pkgRecord.default_branch !== 'HEAD') {
      addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, pkgRecord.default_branch));
    }
    addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, 'main'));
    addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, 'master'));
  }

  // Fallback to ContentDB release/package download URLs when package exists on ContentDB
  const isJamSlugFallbackOnly = Boolean(
    matchedJamBrewFallback && !upstreamPkg && !forClient && !upstreamReleaseUrl
  );
  const hasContentDbMirror =
    (!pkgRecord && !isJamSlugFallbackOnly) ||
    pkgRecord?.provider === 'contentdb' ||
    Number(pkgRecord?.contentdb_downloads) > 0 ||
    String(pkgRecord?.tags || '').includes('"contentdb"') ||
    Boolean(upstreamReleaseUrl);
  if (hasContentDbMirror) {
    addCandidate(upstreamReleaseUrl);
    addCandidate(primaryContentDbDownloadUrl);
  }

  const safeFileName = (effectiveName || 'mod')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'mod';

  const MAX_BUFFER_BYTES = 25 * 1024 * 1024; // 25 MB threshold for in-memory ZIP normalization
  let zipSafetyError: string | null = null;

  for (const candidateUrl of candidateUrls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6500);
    try {
      const res = await fetchWithAnubisSupport(candidateUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Luanti/5.11.0 (LuantiHub; +https://luantihub.org)',
          'Accept': 'application/zip, application/octet-stream, */*'
        }
      });
      clearTimeout(timer);

      if (!res.ok) continue;

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') || ct.includes('text/plain')) {
        continue;
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_BUFFER_BYTES) {
        if (!requestedTag && contentLength > 0) {
          await scheduleBackground(healPackageDownloadSizeIfChanged(contentLength));
        }
        return Response.redirect(res.url || candidateUrl, 302);
      }

      const rawBytes = await readResponseBytesBounded(res, MAX_BUFFER_BYTES);
      if (!rawBytes) {
        return Response.redirect(res.url || candidateUrl, 302);
      }
      if (
        rawBytes.length < 22 ||
        rawBytes[0] !== 0x50 ||
        rawBytes[1] !== 0x4b ||
        (rawBytes[2] !== 0x03 && rawBytes[2] !== 0x05)
      ) {
        continue;
      }

      const normalizedZip = normalizeLuantiPackageZip(rawBytes, safeFileName, effectiveType);
      const zipResponse = await setCachedNormalizedZip(edgeZipCacheKey, normalizedZip, safeFileName, request);
      if (!requestedTag && edgeZipCacheKey !== latestEdgeZipCacheKey) {
        await setCachedNormalizedZip(latestEdgeZipCacheKey, normalizedZip, safeFileName).catch(() => {});
      }

      // Auto-persist exact zip size to packages table in D1 & purge stale detail/boot Edge Caches
      if (!requestedTag && normalizedZip.byteLength > 0) {
        await scheduleBackground(healPackageDownloadSizeIfChanged(normalizedZip.byteLength));
      }

      return zipResponse;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof Error && /Unsafe ZIP archive rejected/i.test(err.message)) {
        zipSafetyError = err.message;
      }
    }
  }

  if (!hasContentDbMirror) {
    return new Response(
      JSON.stringify({
        error: zipSafetyError || 'Package archive could not be retrieved from its Git repository.'
      }),
      {
        status: zipSafetyError ? 422 : 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }

  // Final fallback for ContentDB-backed packages if ContentDB challenged Worker IP
  return Response.redirect(primaryContentDbDownloadUrl, 302);
}

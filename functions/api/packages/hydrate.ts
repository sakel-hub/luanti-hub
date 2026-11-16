import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  parseBadgeTagsArray,
  ensureExtendedPackageColumns,
  scanGitRepoMetadataCached,
  extractEmbeddedVideo,
  parseNonZeroReviewThreadCounts,
  deriveReviewThreadCountsFromList,
  computeStarRatingFromData,
  isGitRepositoryAssetUrl,
  isDeadMirrorScreenshotUrl,
  sanitizePackageImageUrl,
  formatContentDbCdnUrl,
  isContentDbThumbnailUrl,
  upgradeContentDbThumbnailUrl,
  selectSharpPackageBanner,
  mergeScreenshotsPreferringGit,
  toProxiedGitImageIfNeeded,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  readSharedEdgeRatingsMap,
  mergeSharedEdgeRatingsMap,
  SharedEdgeRatingEntry,
  normalizeUtcIsoTimestamp,
  isCreatedIn2026OrUnknown,
  resolveGitProviderFromRepoUrl,
  runWithD1ColumnFallback
} from '../lib/upstream';
import { verifySameOriginMutation } from '../auth/lib/session';
import { reconcilePackageDownloadCounts } from '../../../src/app/core/models/package.model';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const url = new URL(context.request.url, 'https://luantihub.local');
  const idsParam = url.searchParams.get('ids') || '';
  const candidateIds = idsParam ? idsParam.split(',') : [];
  return handleHydrateRequest(candidateIds, context.env, true);
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const csrfBlock = verifySameOriginMutation(context.request);
  if (csrfBlock) return csrfBlock;

  const { request, env } = context;

  let body: { ids?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  return handleHydrateRequest(Array.isArray(body.ids) ? body.ids : [], env, false);
}

async function handleHydrateRequest(
  candidateIds: unknown[],
  env: Env,
  isGetRequest: boolean
): Promise<Response> {
  const hydratedMap: Record<string, any> = {};
  const responseHeaders: Record<string, string> = isGetRequest
    ? {
        'Cache-Control': 'public, max-age=120, s-maxage=600, stale-while-revalidate=600'
      }
    : {};

  // Resolve requested package IDs in batch (D1 lookup + server-side upstream edge cache fallback)
  const seenLower = new Set<string>();
  const rawIds: string[] = [];
  for (const raw of candidateIds) {
    const id = String(raw || '').trim();
    if (!/^[a-zA-Z0-9_.-]{1,64}\/[a-zA-Z0-9_.-]{1,80}$/.test(id)) continue;
    const lower = id.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    rawIds.push(id);
    if (rawIds.length >= 32) break;
  }

  const hydrateCacheKey =
    rawIds.length > 0
      ? `/__api_hydrate_v12_${encodeURIComponent(
          rawIds
            .map(id => id.toLowerCase())
            .sort()
            .join(',')
        )}`
      : null;

  if (hydrateCacheKey) {
    const cachedHydration = await readEdgeCacheJson<Record<string, any>>(hydrateCacheKey);
    if (cachedHydration && typeof cachedHydration === 'object') {
      return Response.json(
        {
          success: true,
          hydrated: cachedHydration
        },
        { headers: responseHeaders }
      );
    }
  }

  if (env.DB) {
    await ensureExtendedPackageColumns(env.DB);
  }

  if (rawIds.length > 0) {
    const missingIds = new Set<string>(rawIds.map(id => id.toLowerCase()));
    const d1ById = new Map<string, any>();
    const dailyDlByLowerId = new Map<string, number>();
    const promoTagsByLowerId = new Map<string, string[]>();

    if (env.DB) {
      try {
        const lowerIds = rawIds.map(id => id.toLowerCase());
        const exactAndLowerIds = Array.from(new Set([...rawIds, ...lowerIds]));
        const placeholders = exactAndLowerIds.map(() => '?').join(', ');
        const lowerPlaceholders = lowerIds.map(() => '?').join(', ');
        const [d1Res, dailyDlRes, promoTagsRes] = await Promise.all([
          env.DB.prepare(
            `SELECT id, author_id, author_name, name, title, type, short_desc, long_desc, status, provider, repo_url, thumbnail_url, banner_url, screenshots, created_at, updated_at, dev_state, tags, badge_tags, license, media_license, min_minetest_version, latest_commit_sha, metadata_synced_at, license_override, downloads_count, contentdb_downloads, luantihub_downloads, score, review_thread_counts, download_size, file_size, video_url, video_thumbnail_url FROM packages WHERE (id IN (${placeholders}) OR LOWER(id) IN (${lowerPlaceholders})) AND status = 'active'`
          ).bind(...exactAndLowerIds, ...lowerIds).all().catch(() =>
            env.DB.prepare(
              `SELECT * FROM packages WHERE (id IN (${placeholders}) OR LOWER(id) IN (${lowerPlaceholders})) AND status = 'active'`
            ).bind(...exactAndLowerIds, ...lowerIds).all()
          ),
          env.DB.prepare(
            `SELECT LOWER(package_id) as pkg_id, SUM(downloads_count) as total_dl
             FROM package_daily_downloads
             WHERE LOWER(package_id) IN (${lowerPlaceholders})
             GROUP BY LOWER(package_id)`
          ).bind(...lowerIds).all().catch(() => ({ results: [] })),
          env.DB.prepare(
            `SELECT LOWER(package_id) as pkg_id, tag_name
             FROM promo_tag_packages
             WHERE LOWER(package_id) IN (${lowerPlaceholders})`
          ).bind(...lowerIds).all().catch(() => ({ results: [] }))
        ]);

        for (const dlRow of (dailyDlRes?.results || [])) {
          if (dlRow?.pkg_id && Number(dlRow.total_dl) > 0) {
            dailyDlByLowerId.set(String(dlRow.pkg_id).toLowerCase(), Number(dlRow.total_dl));
          }
        }

        for (const pRow of (promoTagsRes?.results || [])) {
          const pKey = String(pRow?.pkg_id || '').toLowerCase();
          const tName = String(pRow?.tag_name || '').trim();
          if (!pKey || !tName) continue;
          const arr = promoTagsByLowerId.get(pKey) || [];
          if (!arr.includes(tName)) arr.push(tName);
          promoTagsByLowerId.set(pKey, arr);
        }

        const d1RepoScanRows: any[] = [];
        for (const row of (d1Res?.results || [])) {
          if (!row?.id) continue;
          const lowerKey = String(row.id).toLowerCase();
          d1ById.set(lowerKey, row);
          const d1PromoTags = promoTagsByLowerId.get(lowerKey) || [];
          const parsedTags = Array.from(new Set([...parseJsonArray(row.tags), ...d1PromoTags])).filter(Boolean);
          const parsedBadgeTags = parseBadgeTagsArray(row.badge_tags);
          if (
            (parsedTags.includes('jam_game_2026') || parsedTags.includes('gamejam')) &&
            !parsedBadgeTags.includes('jam_game_2026')
          ) {
            parsedBadgeTags.push('jam_game_2026');
          }
          const hasRealTags = parsedTags.some(
            (t: string) => !['mod', 'game', 'txp', 'texture_pack'].includes(t.toLowerCase())
          );
          const parsedRowRevCounts = parseNonZeroReviewThreadCounts(row.review_thread_counts);
          const isOfficialD1Row =
            row.provider === 'contentdb' ||
            Number(row.contentdb_downloads || 0) > 0 ||
            parsedTags.includes('contentdb');
          const reconciledRowDl = reconcilePackageDownloadCounts({
            contentdbDownloads: Number(row.contentdb_downloads || 0),
            luantihubDownloads: Math.max(Number(row.luantihub_downloads || 0), dailyDlByLowerId.get(lowerKey) || 0),
            reportedTotalDownloads: Number(row.downloads_count || 0),
            hasContentDbSource: isOfficialD1Row,
            isPureGitOnly: !isOfficialD1Row
          });
          const cdbDl = reconciledRowDl.contentdbDownloads;
          const lhDl = reconciledRowDl.luantihubDownloads;
          const totalDl = reconciledRowDl.downloads;
          const rowScore = computeStarRatingFromData({
            review_thread_counts: parsedRowRevCounts,
            score: (!isOfficialD1Row || parsedRowRevCounts) ? row.score : 0
          });
          const sanitizedRowBanner = sanitizePackageImageUrl(row.banner_url);
          const sanitizedRowThumb = upgradeContentDbThumbnailUrl(row.thumbnail_url);
          const gitShotD1 = isGitRepositoryAssetUrl(sanitizedRowBanner)
            ? sanitizedRowBanner
            : (isGitRepositoryAssetUrl(sanitizedRowThumb) ? sanitizedRowThumb : undefined);
          const rowScreenshots = mergeScreenshotsPreferringGit(
            [gitShotD1, sanitizedRowBanner, sanitizedRowThumb],
            parseJsonArray(row.screenshots).filter((s: string) => !isDeadMirrorScreenshotUrl(s))
          );
          const rawNonGitRowThumb =
            (sanitizedRowThumb && !isGitRepositoryAssetUrl(sanitizedRowThumb)
              ? sanitizedRowThumb
              : undefined) ||
            rowScreenshots.find(s => !isGitRepositoryAssetUrl(s));
          const formattedRowThumb = rawNonGitRowThumb
            ? (formatContentDbCdnUrl(rawNonGitRowThumb, 'tile') || rawNonGitRowThumb)
            : (gitShotD1 || sanitizedRowThumb);

          hydratedMap[lowerKey] = {
            id: row.id,
            author_id: row.author_id && !String(row.author_id).startsWith('ext_') ? String(row.author_id) : undefined,
            license: row.license || row.media_license || '',
            media_license: row.media_license || row.license || '',
            min_minetest_version: row.min_minetest_version || '5.0.0',
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            score: rowScore > 0 ? rowScore : undefined,
            review_thread_counts: parsedRowRevCounts,
            rating_checked: Boolean(parsedRowRevCounts || rowScore > 0 || !isOfficialD1Row) || undefined,
            tags: parsedTags.length > 0 ? parsedTags : undefined,
            badge_tags: parsedBadgeTags.length > 0 ? parsedBadgeTags : undefined,
            dev_state: row.dev_state || undefined,
            download_size: typeof row.download_size === 'number' && row.download_size > 0 ? row.download_size : undefined,
            file_size: row.file_size || undefined,
            ...(row.latest_commit_sha ? { latest_commit_sha: String(row.latest_commit_sha).slice(0, 12) } : {}),
            ...(row.updated_at ? { updated_at: row.updated_at } : {}),
            video_url: row.video_url || undefined,
            video_thumbnail_url: row.video_thumbnail_url || undefined,
            repo_url: row.repo_url || undefined,
            thumbnail: formattedRowThumb,
            banner: selectSharpPackageBanner(
              gitShotD1,
              rowScreenshots,
              sanitizedRowBanner,
              sanitizedRowThumb
            ),
            screenshots: rowScreenshots.length > 0 ? rowScreenshots : undefined
          };

          const hasSharpRowBanner =
            Boolean(hydratedMap[lowerKey].banner) && !isContentDbThumbnailUrl(hydratedMap[lowerKey].banner);
          const potentiallyPoisonedCdbRow =
            row.provider === 'contentdb' &&
            Boolean(row.repo_url) &&
            !(Number(row.contentdb_downloads || 0) > 0);
          if (
            row.license &&
            !potentiallyPoisonedCdbRow &&
            (cdbDl > 0 || row.provider !== 'contentdb') &&
            hasRealTags &&
            Boolean(hydratedMap[lowerKey].thumbnail) &&
            hasSharpRowBanner &&
            (!isOfficialD1Row || Boolean(parsedRowRevCounts))
          ) {
            missingIds.delete(lowerKey);
            const needsD1Jam2026GameScan =
              row.type === 'game' &&
              isCreatedIn2026OrUnknown(row.created_at) &&
              !parsedTags.includes('jam_game_2026');
            const needsD1LicenseSync =
              row.provider !== 'contentdb' &&
              !row.metadata_synced_at &&
              Number(row.license_override || 0) !== 1;
            if (
              ((row.provider !== 'contentdb' && (!row.video_url || !gitShotD1)) ||
                needsD1Jam2026GameScan ||
                needsD1LicenseSync) &&
              row.repo_url &&
              d1RepoScanRows.length < 6
            ) {
              d1RepoScanRows.push(row);
            }
          }
        }

        if (d1RepoScanRows.length > 0) {
          const repoUpdateStmts: any[] = [];
          await Promise.all(
            d1RepoScanRows.map(async (row) => {
              const lowerKey = String(row.id).toLowerCase();
              const author = String(row.author_name || String(row.id).split('/')[0] || '');
              const name = String(row.name || String(row.id).split('/')[1] || '');
              if (!author || !name) return;
              const existingRowShots = parseJsonArray(row.screenshots);
              const gitScan = await scanGitRepoMetadataCached(
                author,
                name,
                row.type || 'mod',
                row.repo_url,
                21600,
                { commitSha: row.latest_commit_sha }
              ).catch(() => null);
              const resolvedVid = extractEmbeddedVideo(
                gitScan?.cdbMeta?.video_url,
                row.video_thumbnail_url,
                row.long_desc || gitScan?.cdbMeta?.long_description || gitScan?.longDesc
              );
              const scannedGitShot = gitScan?.screenshotUrl;
              const scannedCdbShots = gitScan?.screenshots || [];
              const mergedRowShots = mergeScreenshotsPreferringGit(
                [scannedGitShot, ...scannedCdbShots],
                hydratedMap[lowerKey]?.screenshots,
                existingRowShots.filter((s: string) => !isGitRepositoryAssetUrl(s))
              );
              const primaryGitShot = scannedGitShot || (isGitRepositoryAssetUrl(mergedRowShots[0]) ? mergedRowShots[0] : undefined);
              const rowLicenseOverridden = Number(row.license_override || 0) === 1;
              const scannedLicense =
                !rowLicenseOverridden && gitScan?.gitRepoStatus === 'verified'
                  ? (gitScan.license || gitScan.mediaLicense || '')
                  : '';
              const scannedMediaLicense =
                !rowLicenseOverridden && gitScan?.gitRepoStatus === 'verified'
                  ? (gitScan.mediaLicense || scannedLicense || '')
                  : '';

              if (hydratedMap[lowerKey]) {
                if (scannedLicense) {
                  hydratedMap[lowerKey].license = scannedLicense;
                }
                if (scannedMediaLicense) {
                  hydratedMap[lowerKey].media_license = scannedMediaLicense;
                }
                if (resolvedVid.video_url) {
                  hydratedMap[lowerKey].video_url = resolvedVid.video_url;
                  hydratedMap[lowerKey].video_thumbnail_url = resolvedVid.video_thumbnail_url;
                }
                if (primaryGitShot) {
                  if (!hydratedMap[lowerKey].thumbnail || isGitRepositoryAssetUrl(hydratedMap[lowerKey].thumbnail)) {
                    hydratedMap[lowerKey].thumbnail = primaryGitShot;
                  }
                  hydratedMap[lowerKey].banner = primaryGitShot;
                }
                if (mergedRowShots.length > 0) {
                  hydratedMap[lowerKey].screenshots = mergedRowShots;
                }
                if (gitScan?.jam2026Tags?.length) {
                  hydratedMap[lowerKey].tags = Array.from(
                    new Set([...(hydratedMap[lowerKey].tags || []), ...gitScan.jam2026Tags])
                  );
                  hydratedMap[lowerKey].badge_tags = Array.from(
                    new Set([...(hydratedMap[lowerKey].badge_tags || []), 'jam_game_2026'])
                  );
                  for (const jt of gitScan.jam2026Tags) {
                    repoUpdateStmts.push(
                      env.DB.prepare(
                        `INSERT INTO promo_tag_packages (tag_name, package_id, updated_at)
                         VALUES (?, ?, CURRENT_TIMESTAMP)
                         ON CONFLICT(tag_name, package_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`
                      ).bind(jt, row.id)
                    );
                  }
                }
              }

              const hadGitShotD1 =
                isGitRepositoryAssetUrl(row.banner_url) || isGitRepositoryAssetUrl(row.thumbnail_url);
              const newlyDiscoveredVid = !row.video_url && Boolean(resolvedVid.video_url);
              const newlyDiscoveredShot = !hadGitShotD1 && Boolean(primaryGitShot);
              const licenseUpdated =
                Boolean(scannedLicense && scannedLicense !== String(row.license || '').trim()) ||
                Boolean(scannedMediaLicense && scannedMediaLicense !== String(row.media_license || '').trim());
              const shouldMarkMetadataSynced =
                gitScan?.gitRepoStatus === 'verified' && !row.metadata_synced_at;
              if (newlyDiscoveredVid || newlyDiscoveredShot || licenseUpdated || shouldMarkMetadataSynced) {
                repoUpdateStmts.push(
                  env.DB.prepare(`
                    UPDATE packages
                    SET video_url = COALESCE(video_url, ?),
                        video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
                        thumbnail_url = CASE
                          WHEN (thumbnail_url IS NULL OR thumbnail_url = '' OR thumbnail_url = 'logo.svg') AND ? IS NOT NULL AND ? != '' THEN ?
                          ELSE thumbnail_url
                        END,
                        banner_url = CASE
                          WHEN ? IS NOT NULL AND ? != '' THEN ?
                          ELSE banner_url
                        END,
                        screenshots = COALESCE(?, screenshots),
                        license = CASE
                          WHEN COALESCE(license_override, 0) = 0 AND ? IS NOT NULL AND ? != '' THEN ?
                          ELSE license
                        END,
                        media_license = CASE
                          WHEN COALESCE(license_override, 0) = 0 AND ? IS NOT NULL AND ? != '' THEN ?
                          ELSE media_license
                        END,
                        metadata_synced_at = CASE
                          WHEN ? = 1 THEN CURRENT_TIMESTAMP
                          ELSE metadata_synced_at
                        END
                    WHERE id = ?
                  `).bind(
                    resolvedVid.video_url || null,
                    resolvedVid.video_thumbnail_url || null,
                    primaryGitShot || null,
                    primaryGitShot || null,
                    primaryGitShot || null,
                    primaryGitShot || null,
                    primaryGitShot || null,
                    primaryGitShot || null,
                    mergedRowShots.length > 0 ? JSON.stringify(mergedRowShots) : null,
                    scannedLicense || null,
                    scannedLicense || null,
                    scannedLicense || null,
                    scannedMediaLicense || null,
                    scannedMediaLicense || null,
                    scannedMediaLicense || null,
                    shouldMarkMetadataSynced || licenseUpdated ? 1 : 0,
                    row.id
                  )
                );
              }
            })
          );
          if (repoUpdateStmts.length > 0) {
            await runWithD1ColumnFallback(env.DB, async () => {
              if (typeof env.DB.batch === 'function') {
                await env.DB.batch(repoUpdateStmts);
              } else {
                for (const stmt of repoUpdateStmts) {
                  await stmt.run();
                }
              }
            }).catch(() => {});
          }
        }
      } catch {
        // Proceed to upstream hydration
      }
    }

    const toFetchUpstream = rawIds.filter(id => missingIds.has(id.toLowerCase())).slice(0, 24);
    if (toFetchUpstream.length > 0) {
      const persistStatements: any[] = [];
      let repoScanBudget = 6; // Cap server-side Git repo scans per batch (6h Edge-cached) to preserve Worker subrequest quota
      let reviewFetchBudget = 24; // Cap upstream /reviews/ fetches per batch (1h Edge-cached)
      const [scoresList, sharedEdgeRatings] = await Promise.all([
        fetchUpstreamJsonCached<any[]>('/scores/', 1800).catch(() => null),
        readSharedEdgeRatingsMap().catch(() => ({} as Record<string, SharedEdgeRatingEntry>))
      ]);
      const scoresByKey = new Map<string, any>();
      if (Array.isArray(scoresList)) {
        for (const s of scoresList) {
          if (s?.author && s?.name) {
            scoresByKey.set(`${s.author}/${s.name}`.toLowerCase(), s);
          }
        }
      }
      let cachedVcsCatalogPromise: Promise<any[] | null> | null = null;
      const getVcsCatalogOnce = () => {
        if (!cachedVcsCatalogPromise) {
          cachedVcsCatalogPromise = fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 1800).catch(() => null);
        }
        return cachedVcsCatalogPromise;
      };
      await Promise.all(
        toFetchUpstream.map(async (rawId) => {
          const [author, name] = rawId.split('/');
          if (!author || !name) return;
          const lowerKey = rawId.toLowerCase();
          const existing = hydratedMap[lowerKey] || {};
          const existingD1Row = d1ById.get(lowerKey);
          const scoreEntry = scoresByKey.get(lowerKey);
          const sharedRating = sharedEdgeRatings[lowerKey];
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
            3600
          ).catch(() => null);

          let isPoisonedHydrateRow = false;
          if (
            !detail &&
            existingD1Row?.provider === 'contentdb' &&
            existingD1Row?.repo_url &&
            !(Number(existingD1Row?.contentdb_downloads || 0) > 0) &&
            !(Number(scoreEntry?.downloads || 0) > 0)
          ) {
            if (Array.isArray(scoresList) && scoresList.length > 0 && !scoreEntry) {
              isPoisonedHydrateRow = true;
            } else {
              const vcsCatalog = await getVcsCatalogOnce();
              if (Array.isArray(vcsCatalog) && vcsCatalog.length > 0) {
                const normTargetName = name.replace(/-/g, '_').toLowerCase();
                const inVcsCatalog = vcsCatalog.some(
                  (p: any) =>
                    String(p?.author || '').trim().toLowerCase() === author.toLowerCase() &&
                    String(p?.name || '').trim().replace(/-/g, '_').toLowerCase() === normTargetName
                );
                if (!inVcsCatalog) {
                  isPoisonedHydrateRow = true;
                }
              }
            }
          }

          const licenseOverridden = Number(existingD1Row?.license_override || 0) === 1;
          let lic = licenseOverridden
            ? (existing.license || detail?.license || detail?.media_license || '')
            : (detail?.license || detail?.media_license || existing.license || '');
          let mediaLic = licenseOverridden
            ? (existing.media_license || existing.license || detail?.media_license || detail?.license || '')
            : (detail?.media_license || detail?.license || existing.media_license || '');
          const rawUpstreamTags = Array.isArray(detail?.tags)
            ? detail.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
            : [];
          const d1PromoTagsForHydrate = promoTagsByLowerId.get(lowerKey) || [];
          let detailTags = Array.from(
            new Set([...(existing.tags || []), ...d1PromoTagsForHydrate, ...rawUpstreamTags])
          ).filter(Boolean);
          if (isPoisonedHydrateRow) {
            detailTags = detailTags.filter(t => String(t || '').trim().toLowerCase() !== 'contentdb');
          }
          let detailRevCounts =
            parseNonZeroReviewThreadCounts(detail?.reviews) ||
            parseNonZeroReviewThreadCounts(scoreEntry?.reviews) ||
            parseNonZeroReviewThreadCounts(existing.review_thread_counts) ||
            sharedRating?.review_thread_counts;
          let cdbRevList: any[] | null = null;
          let ratingChecked = Boolean(detailRevCounts || sharedRating?.checked || (existing.score >= 1 && existing.score <= 5));
          const isNativeGitOnly = Boolean(existingD1Row && existingD1Row.provider !== 'contentdb' && !detail);
          if (!detailRevCounts && !sharedRating?.checked && !isNativeGitOnly && reviewFetchBudget > 0) {
            reviewFetchBudget--;
            cdbRevList = await fetchUpstreamJsonCached<any[]>(
              `/packages/${encodeURIComponent(detail?.author || author)}/${encodeURIComponent(detail?.name || name)}/reviews/`,
              3600
            ).catch(() => null);
            if (Array.isArray(cdbRevList)) {
              detailRevCounts = deriveReviewThreadCountsFromList(cdbRevList);
              ratingChecked = true;
            }
          }
          const hasExplicitZeroReviews =
            (Array.isArray(cdbRevList) && cdbRevList.length === 0 && !detailRevCounts) ||
            (!detailRevCounts &&
              scoreEntry?.reviews &&
              Number(scoreEntry.reviews.positive || 0) === 0 &&
              Number(scoreEntry.reviews.neutral || 0) === 0 &&
              Number(scoreEntry.reviews.negative || 0) === 0);
          const resolvedScore = hasExplicitZeroReviews
            ? 0
            : (computeStarRatingFromData({
                ...(detail || {}),
                review_thread_counts: detailRevCounts,
                reviews_list: cdbRevList,
                score: detailRevCounts ? existing.score : undefined
              }) ||
              (sharedRating?.review_thread_counts ? sharedRating?.score : 0) ||
              0);
          const hasCdbHydrate = Boolean(
            detail ||
            Number(scoreEntry?.downloads || 0) > 0 ||
            (!isPoisonedHydrateRow &&
              (existing?.sources?.includes('official') ||
                existing?.source === 'official' ||
                existing?.provider === 'contentdb' ||
                Number(existing?.contentdb_downloads || 0) > 0))
          );
          const reconciledHydrateDl = reconcilePackageDownloadCounts({
            contentdbDownloads: isPoisonedHydrateRow
              ? 0
              : Math.max(
                  Number(existing.contentdb_downloads || 0),
                  Number(detail?.downloads || 0),
                  Number(scoreEntry?.downloads || 0)
                ),
            luantihubDownloads: Math.max(Number(existing.luantihub_downloads || 0), dailyDlByLowerId.get(lowerKey) || 0),
            reportedTotalDownloads: Number(existing.downloads || 0),
            hasContentDbSource: hasCdbHydrate,
            isPureGitOnly: !hasCdbHydrate
          });
          const cdbDl = reconciledHydrateDl.contentdbDownloads;
          const lhDl = reconciledHydrateDl.luantihubDownloads;
          const totalDl = reconciledHydrateDl.downloads;
          const rawMinVer = detail?.min_minetest_version && typeof detail.min_minetest_version === 'object'
            ? detail.min_minetest_version.name
            : detail?.min_minetest_version;
          let minVer = (rawMinVer && String(rawMinVer).toLowerCase() !== 'none' ? String(rawMinVer) : '') || existing.min_minetest_version || '5.0.0';
          let repoUrl = detail?.repo || detail?.repo_url || existing.repo_url || '';
          let videoUrl = detail?.video_url || existing.video_url || undefined;
          let videoThumbUrl = detail?.video_thumbnail_url || existing.video_thumbnail_url || undefined;
          let shortDesc = detail?.short_desc || detail?.short_description || undefined;
          let title = detail?.title || name;
          let devState = detail?.dev_state || existing.dev_state || undefined;
          let pkgType = ['mod', 'game', 'txp', 'modpack'].includes(detail?.type) ? detail.type : 'mod';

          // Agnostic server-side Git repository scan (.conf + .cdb.json + LICENSE + screenshot.png + JAM2026.md)
          // Cached at Cloudflare Edge (24h commit-keyed / 1h head fallback). Only run for non-ContentDB packages,
          // unsynced license rows, poisoned rows, missing metadata, or 2026 games missing JAM2026.md check.
          let gitScanShot: string | undefined;
          let gitScanCdbShots: string[] = [];
          let discoveredJam2026Tags: string[] = [];
          let gitScanVerified = false;
          const isNativeGitPkg = Boolean(
            isPoisonedHydrateRow || (existingD1Row && existingD1Row.provider !== 'contentdb')
          );
          const hasExistingBanner = Boolean(existing.banner && existing.banner !== 'logo.svg');
          const needsUnsyncedGitLicenseScan = Boolean(
            isNativeGitPkg &&
            !existingD1Row?.metadata_synced_at &&
            !licenseOverridden
          );
          const needsJam2026GameScan =
            pkgType === 'game' &&
            isCreatedIn2026OrUnknown(detail?.created_at || existingD1Row?.created_at) &&
            !detailTags.includes('jam_game_2026');
          if (
            (isPoisonedHydrateRow ||
              !detail ||
              (!lic && !licenseOverridden) ||
              (isNativeGitPkg && !hasExistingBanner) ||
              needsUnsyncedGitLicenseScan ||
              needsJam2026GameScan) &&
            repoUrl &&
            repoScanBudget > 0
          ) {
            repoScanBudget--;
            const gitScan = await scanGitRepoMetadataCached(
              author,
              name,
              pkgType,
              repoUrl || undefined,
              21600,
              { commitSha: existingD1Row?.latest_commit_sha }
            ).catch(() => null);
            if (gitScan && gitScan.gitRepoStatus === 'verified') {
              gitScanVerified = true;
              if (!licenseOverridden) {
                if (!detail && (gitScan.license || gitScan.mediaLicense)) {
                  lic = gitScan.license || gitScan.mediaLicense || lic;
                  mediaLic = gitScan.mediaLicense || lic || mediaLic;
                } else {
                  lic = lic || gitScan.license || gitScan.mediaLicense || '';
                  mediaLic = mediaLic || gitScan.mediaLicense || lic || '';
                }
              }
              repoUrl = repoUrl || gitScan.repoUrl || '';
              minVer = (minVer === '5.0.0' && gitScan.minVersion) ? gitScan.minVersion : minVer;
              shortDesc = shortDesc || gitScan.cdbMeta?.short_description || gitScan.shortDesc;
              devState = devState || gitScan.cdbMeta?.dev_state;
              title = (title === name && (gitScan.cdbMeta?.title || gitScan.title)) ? (gitScan.cdbMeta?.title || gitScan.title)! : title;
              if (gitScan.detectedType) pkgType = gitScan.detectedType;
              if (gitScan.screenshotUrl) gitScanShot = gitScan.screenshotUrl;
              if (gitScan.screenshots?.length) {
                gitScanCdbShots = gitScan.screenshots;
              }
              if (gitScan.cdbMeta?.tags?.length) {
                detailTags = Array.from(new Set([...detailTags, ...gitScan.cdbMeta.tags]));
              }
              if (gitScan.jam2026Tags?.length) {
                discoveredJam2026Tags = gitScan.jam2026Tags;
                detailTags = Array.from(new Set([...detailTags, ...gitScan.jam2026Tags]));
              }
              if (!videoUrl && gitScan.cdbMeta?.video_url) {
                const extractedVid = extractEmbeddedVideo(gitScan.cdbMeta.video_url, videoThumbUrl);
                videoUrl = extractedVid.video_url;
                videoThumbUrl = extractedVid.video_thumbnail_url || videoThumbUrl;
              }
            }
          }

          if (!detail && !lic && !repoUrl && detailTags.length === 0) return;

          const canonicalId = `${detail?.author || author}/${detail?.name || name}`;
          if (env.DB && discoveredJam2026Tags.length > 0) {
            for (const jt of discoveredJam2026Tags) {
              persistStatements.push(
                env.DB.prepare(
                  `INSERT INTO promo_tag_packages (tag_name, package_id, updated_at)
                   VALUES (?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(tag_name, package_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`
                ).bind(jt, canonicalId)
              );
            }
          }
          const sanitizedDetailThumb = upgradeContentDbThumbnailUrl(detail?.thumbnail);
          const mergedHydrateScreenshots = mergeScreenshotsPreferringGit(
            [gitScanShot, existing.banner, existing.thumbnail, sanitizedDetailThumb],
            gitScanCdbShots,
            existing.screenshots,
            detail?.screenshots
          );
          const primaryGitShot =
            sanitizePackageImageUrl(gitScanShot) ||
            (isGitRepositoryAssetUrl(mergedHydrateScreenshots[0]) ? mergedHydrateScreenshots[0] : undefined);
          const upgradedDetailThumb = upgradeContentDbThumbnailUrl(detail?.thumbnail, mergedHydrateScreenshots);
          const upgradedExistingThumb =
            existing.thumbnail && !isGitRepositoryAssetUrl(existing.thumbnail)
              ? upgradeContentDbThumbnailUrl(existing.thumbnail, mergedHydrateScreenshots)
              : undefined;
          const nonGitHydrateThumb =
            upgradedDetailThumb ||
            upgradedExistingThumb ||
            mergedHydrateScreenshots.find(s => !isGitRepositoryAssetUrl(s));
          const formattedNonGitHydrateThumb = nonGitHydrateThumb
            ? (formatContentDbCdnUrl(nonGitHydrateThumb, 'tile') || nonGitHydrateThumb)
            : undefined;
          const resolvedHydrateThumb =
            sanitizePackageImageUrl(formattedNonGitHydrateThumb || primaryGitShot || existing.thumbnail) || null;
          const resolvedHydrateBanner =
            selectSharpPackageBanner(
              primaryGitShot,
              mergedHydrateScreenshots,
              typeof detail?.screenshots?.[0]?.url === 'string'
                ? detail.screenshots[0].url
                : detail?.screenshots?.[0],
              existing.banner,
              resolvedHydrateThumb
            ) || null;
          const normDetailCreated = detail?.created_at ? normalizeUtcIsoTimestamp(detail.created_at) : '';
          const normDetailApproved = detail?.approved_at ? normalizeUtcIsoTimestamp(detail.approved_at) : '';
          const detailCreatedMs = normDetailCreated ? Date.parse(normDetailCreated) : NaN;
          const detailApprovedMs = normDetailApproved ? Date.parse(normDetailApproved) : NaN;
          const resolvedDetailCreatedAt =
            Number.isFinite(detailCreatedMs) && Number.isFinite(detailApprovedMs)
              ? (detailApprovedMs >= detailCreatedMs ? normDetailApproved : normDetailCreated)
              : (normDetailApproved || normDetailCreated || undefined);
          const existingBadgeTags = parseBadgeTagsArray(existingD1Row?.badge_tags);
          if (
            (detailTags.includes('jam_game_2026') || detailTags.includes('gamejam')) &&
            !existingBadgeTags.includes('jam_game_2026')
          ) {
            existingBadgeTags.push('jam_game_2026');
          }
          const healedProvider = isPoisonedHydrateRow
            ? resolveGitProviderFromRepoUrl(repoUrl || existingD1Row?.repo_url, 'github')
            : undefined;
          hydratedMap[lowerKey] = {
            id: canonicalId,
            ...(existing?.author_id ? { author_id: existing.author_id } : {}),
            license: lic,
            media_license: mediaLic,
            min_minetest_version: minVer,
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            ...(healedProvider ? { provider: healedProvider, source: 'git' as const, sources: ['git' as const] } : {}),
            ...(existingD1Row?.latest_commit_sha
              ? { latest_commit_sha: String(existingD1Row.latest_commit_sha).slice(0, 12) }
              : {}),
            ...(existingD1Row?.updated_at ? { updated_at: existingD1Row.updated_at } : {}),
            score: resolvedScore > 0 ? resolvedScore : undefined,
            review_thread_counts: detailRevCounts,
            rating_checked: ratingChecked || undefined,
            tags: detailTags.length > 0 ? detailTags : undefined,
            badge_tags: existingBadgeTags.length > 0 ? existingBadgeTags : undefined,
            dev_state: devState || undefined,
            created_at: resolvedDetailCreatedAt,
            download_size:
              typeof detail?.download_size === 'number'
                ? detail.download_size
                : existing?.download_size,
            ...(existing?.file_size ? { file_size: existing.file_size } : {}),
            video_url: videoUrl,
            video_thumbnail_url: videoThumbUrl,
            repo_url: repoUrl || undefined,
            thumbnail: resolvedHydrateThumb || undefined,
            banner: resolvedHydrateBanner || undefined,
            screenshots: mergedHydrateScreenshots.length > 0 ? mergedHydrateScreenshots : undefined
          };

          // Only backfill D1 if this package already exists in D1 AND a missing/refreshed field was discovered
          if (env.DB && existingD1Row) {
            const existingValidRevCounts = parseNonZeroReviewThreadCounts(existingD1Row.review_thread_counts);
            const newLic =
              !licenseOverridden && lic && lic !== String(existingD1Row.license || '').trim()
                ? lic
                : null;
            const newMediaLic =
              !licenseOverridden && mediaLic && mediaLic !== String(existingD1Row.media_license || '').trim()
                ? mediaLic
                : null;
            const newVid = !existingD1Row.video_url && videoUrl ? videoUrl : null;
            const newRevCounts = !existingValidRevCounts && detailRevCounts
              ? JSON.stringify(detailRevCounts)
              : null;
            const newScore =
              !(Number(existingD1Row.score) >= 1 && Number(existingD1Row.score) <= 5) &&
              resolvedScore >= 1 &&
              resolvedScore <= 5
                ? resolvedScore
                : null;
            const existingD1Tags = parseJsonArray(existingD1Row.tags);
            const cleanedExistingD1Tags = isPoisonedHydrateRow
              ? existingD1Tags.filter(t => String(t || '').trim().toLowerCase() !== 'contentdb')
              : existingD1Tags;
            const mergedD1Tags = Array.from(new Set([...cleanedExistingD1Tags, ...detailTags]))
              .filter(t => !isPoisonedHydrateRow || String(t || '').trim().toLowerCase() !== 'contentdb')
              .filter(Boolean);
            const tagsChanged =
              mergedD1Tags.length > existingD1Tags.length ||
              (isPoisonedHydrateRow && existingD1Tags.some(t => String(t || '').trim().toLowerCase() === 'contentdb'));
            const newTagsJson = tagsChanged ? JSON.stringify(mergedD1Tags) : null;
            const newThumb =
              (!sanitizePackageImageUrl(existingD1Row.thumbnail_url) ||
                String(existingD1Row.thumbnail_url || '').includes('/thumbnails/')) &&
              resolvedHydrateThumb
                ? resolvedHydrateThumb
                : null;
            const newBanner =
              (!sanitizePackageImageUrl(existingD1Row.banner_url) ||
                (isContentDbThumbnailUrl(existingD1Row.banner_url) && !isContentDbThumbnailUrl(resolvedHydrateBanner)) ||
                (!isGitRepositoryAssetUrl(existingD1Row.banner_url) && Boolean(primaryGitShot))) &&
              resolvedHydrateBanner
                ? resolvedHydrateBanner
                : null;
            const shouldMarkMetadataSynced =
              !existingD1Row.metadata_synced_at && Boolean(gitScanVerified || detail);
            if (
              newLic ||
              newMediaLic ||
              newVid ||
              newThumb ||
              newBanner ||
              newRevCounts ||
              newScore !== null ||
              newTagsJson ||
              healedProvider ||
              shouldMarkMetadataSynced
            ) {
              persistStatements.push(
                env.DB.prepare(`
                  UPDATE packages
                  SET provider = COALESCE(?, provider),
                      thumbnail_url = CASE
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
                      license = CASE
                        WHEN COALESCE(license_override, 0) = 0 AND ? IS NOT NULL AND ? != '' THEN ?
                        ELSE license
                      END,
                      media_license = CASE
                        WHEN COALESCE(license_override, 0) = 0 AND ? IS NOT NULL AND ? != '' THEN ?
                        ELSE media_license
                      END,
                      video_url = COALESCE(video_url, ?),
                      video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
                      review_thread_counts = CASE
                        WHEN COALESCE(review_thread_counts, '') = '' OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN COALESCE(?, review_thread_counts)
                        ELSE review_thread_counts
                      END,
                      score = CASE WHEN ? IS NOT NULL THEN ? ELSE score END,
                      metadata_synced_at = CASE
                        WHEN ? = 1 THEN CURRENT_TIMESTAMP
                        ELSE metadata_synced_at
                      END,
                      tags = COALESCE(?, tags)
                  WHERE id = ?
                `).bind(
                  healedProvider || null,
                  newThumb || newBanner,
                  newBanner,
                  newBanner,
                  mergedHydrateScreenshots.length > 0 ? JSON.stringify(mergedHydrateScreenshots) : null,
                  mergedHydrateScreenshots.length > 0 ? JSON.stringify(mergedHydrateScreenshots) : null,
                  newLic,
                  newLic,
                  newLic,
                  newMediaLic,
                  newMediaLic,
                  newMediaLic,
                  newVid,
                  videoThumbUrl || null,
                  newRevCounts,
                  newScore,
                  newScore,
                  shouldMarkMetadataSynced || newLic || newMediaLic ? 1 : 0,
                  newTagsJson,
                  existingD1Row.id
                )
              );
            }
          }
        })
      );

      if (env.DB && persistStatements.length > 0) {
        await runWithD1ColumnFallback(env.DB, async () => {
          if (typeof env.DB.batch === 'function') {
            await env.DB.batch(persistStatements);
          } else {
            for (const stmt of persistStatements) {
              await stmt.run();
            }
          }
        }).catch(() => {});
      }
    }
  }

  if (Object.keys(hydratedMap).length > 0) {
    const edgeRatingUpdates: Record<string, SharedEdgeRatingEntry> = {};
    for (const [pkgId, meta] of Object.entries(hydratedMap)) {
      if ((typeof meta?.score === 'number' && meta.score > 0) || meta?.review_thread_counts || meta?.rating_checked) {
        edgeRatingUpdates[pkgId.toLowerCase()] = {
          score: typeof meta.score === 'number' ? meta.score : 0,
          ...(meta.review_thread_counts ? { review_thread_counts: meta.review_thread_counts } : {}),
          checked: Boolean(meta.rating_checked || meta.score > 0 || meta.review_thread_counts)
        };
      }
    }
    if (Object.keys(edgeRatingUpdates).length > 0) {
      await mergeSharedEdgeRatingsMap(edgeRatingUpdates).catch(() => {});
    }
    if (hydrateCacheKey) {
      await writeEdgeCacheJson(hydrateCacheKey, hydratedMap, 300);
    }
  }

  return Response.json(
    {
      success: true,
      hydrated: hydratedMap
    },
    { headers: responseHeaders }
  );
}

import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  ensureExtendedPackageColumns,
  scanGitRepoMetadataCached,
  extractEmbeddedVideo,
  parseNonZeroReviewThreadCounts,
  computeStarRatingFromData,
  isGitRepositoryAssetUrl,
  isDeadMirrorScreenshotUrl,
  sanitizePackageImageUrl,
  mergeScreenshotsPreferringGit,
  toProxiedGitImageIfNeeded,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  let body: { ids?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const hydratedMap: Record<string, any> = {};

  // Resolve requested package IDs in batch (D1 lookup + server-side upstream edge cache fallback)
  const rawIds = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.map(id => String(id || '').trim()).filter(id => id.includes('/')))).slice(0, 32)
    : [];

  const hydrateCacheKey =
    rawIds.length > 0
      ? `/__api_hydrate_v5_${encodeURIComponent(
          rawIds
            .map(id => id.toLowerCase())
            .sort()
            .join(',')
        )}`
      : null;

  if (hydrateCacheKey) {
    const cachedHydration = await readEdgeCacheJson<Record<string, any>>(hydrateCacheKey);
    if (cachedHydration && typeof cachedHydration === 'object') {
      return Response.json({
        success: true,
        hydrated: cachedHydration
      });
    }
  }

  if (env.DB) {
    await ensureExtendedPackageColumns(env.DB);
  }

  if (rawIds.length > 0) {
    const missingIds = new Set<string>(rawIds.map(id => id.toLowerCase()));
    const d1ById = new Map<string, any>();

    if (env.DB) {
      try {
        const exactAndLowerIds = Array.from(new Set([...rawIds, ...rawIds.map(id => id.toLowerCase())]));
        const placeholders = exactAndLowerIds.map(() => '?').join(', ');
        const d1Res = await env.DB.prepare(
          `SELECT * FROM packages WHERE id IN (${placeholders}) AND status = 'active'`
        ).bind(...exactAndLowerIds).all();

        const d1RepoScanRows: any[] = [];
        for (const row of (d1Res?.results || [])) {
          if (!row?.id) continue;
          const lowerKey = String(row.id).toLowerCase();
          d1ById.set(lowerKey, row);
          const parsedTags = parseJsonArray(row.tags);
          const hasRealTags = parsedTags.some(
            (t: string) => !['mod', 'game', 'txp', 'texture_pack'].includes(t.toLowerCase())
          );
          const parsedRowRevCounts = parseNonZeroReviewThreadCounts(row.review_thread_counts);
          const cdbDl = Number(row.contentdb_downloads || 0);
          const lhDl = Number(row.luantihub_downloads || 0);
          const totalDl = Math.max(Number(row.downloads_count || 0), cdbDl + lhDl);
          const rowScore = computeStarRatingFromData({
            review_thread_counts: parsedRowRevCounts,
            score: row.score
          });
          const sanitizedRowBanner = sanitizePackageImageUrl(row.banner_url);
          const sanitizedRowThumb = sanitizePackageImageUrl(row.thumbnail_url);
          const gitShotD1 = isGitRepositoryAssetUrl(sanitizedRowBanner)
            ? sanitizedRowBanner
            : (isGitRepositoryAssetUrl(sanitizedRowThumb) ? sanitizedRowThumb : undefined);
          const rowScreenshots = mergeScreenshotsPreferringGit(
            [gitShotD1, sanitizedRowBanner, sanitizedRowThumb],
            parseJsonArray(row.screenshots).filter((s: string) => !isDeadMirrorScreenshotUrl(s))
          );

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
            tags: parsedTags.length > 0 ? parsedTags : undefined,
            dev_state: row.dev_state || undefined,
            file_size: row.file_size || undefined,
            video_url: row.video_url || undefined,
            video_thumbnail_url: row.video_thumbnail_url || undefined,
            repo_url: row.repo_url || undefined,
            thumbnail:
              (sanitizedRowThumb && !isGitRepositoryAssetUrl(sanitizedRowThumb)
                ? sanitizedRowThumb
                : undefined) ||
              rowScreenshots.find(s => !isGitRepositoryAssetUrl(s)) ||
              gitShotD1 ||
              sanitizedRowThumb,
            banner: gitShotD1 || sanitizedRowBanner || rowScreenshots[0] || sanitizedRowThumb,
            screenshots: rowScreenshots.length > 0 ? rowScreenshots : undefined
          };

          const isOfficialD1Row = row.provider === 'contentdb' || cdbDl > 0 || parsedTags.includes('contentdb');
          if (
            row.license &&
            (cdbDl > 0 || row.provider !== 'contentdb') &&
            hasRealTags &&
            Boolean(hydratedMap[lowerKey].thumbnail) &&
            (!isOfficialD1Row || Boolean(parsedRowRevCounts))
          ) {
            missingIds.delete(lowerKey);
            if (
              row.provider !== 'contentdb' &&
              (!row.video_url || !gitShotD1) &&
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
                21600
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

              if (hydratedMap[lowerKey]) {
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
              }

              const hadGitShotD1 =
                isGitRepositoryAssetUrl(row.banner_url) || isGitRepositoryAssetUrl(row.thumbnail_url);
              const newlyDiscoveredVid = !row.video_url && Boolean(resolvedVid.video_url);
              const newlyDiscoveredShot = !hadGitShotD1 && Boolean(primaryGitShot);
              if (newlyDiscoveredVid || newlyDiscoveredShot) {
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
                        screenshots = COALESCE(?, screenshots)
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
                    row.id
                  )
                );
              }
            })
          );
          if (repoUpdateStmts.length > 0) {
            if (typeof env.DB.batch === 'function') {
              await env.DB.batch(repoUpdateStmts).catch(() => {});
            } else {
              for (const stmt of repoUpdateStmts) {
                stmt.run().catch(() => {});
              }
            }
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
      const scoresList = await fetchUpstreamJsonCached<any[]>('/scores/', 1800).catch(() => null);
      const scoresByKey = new Map<string, any>();
      if (Array.isArray(scoresList)) {
        for (const s of scoresList) {
          if (s?.author && s?.name) {
            scoresByKey.set(`${s.author}/${s.name}`.toLowerCase(), s);
          }
        }
      }
      await Promise.all(
        toFetchUpstream.map(async (rawId) => {
          const [author, name] = rawId.split('/');
          if (!author || !name) return;
          const lowerKey = rawId.toLowerCase();
          const existing = hydratedMap[lowerKey] || {};
          const existingD1Row = d1ById.get(lowerKey);
          const scoreEntry = scoresByKey.get(lowerKey);
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
            3600
          ).catch(() => null);

          let lic = detail?.license || detail?.media_license || existing.license || '';
          let mediaLic = detail?.media_license || detail?.license || existing.media_license || '';
          const rawUpstreamTags = Array.isArray(detail?.tags)
            ? detail.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
            : [];
          let detailTags = Array.from(new Set([...(existing.tags || []), ...rawUpstreamTags])).filter(Boolean);
          const detailRevCounts =
            parseNonZeroReviewThreadCounts(detail?.reviews) ||
            parseNonZeroReviewThreadCounts(scoreEntry?.reviews) ||
            parseNonZeroReviewThreadCounts(existing.review_thread_counts);
          const resolvedScore = computeStarRatingFromData({
            ...(detail || {}),
            review_thread_counts: detailRevCounts,
            score: existing.score
          });
          const cdbDl = Math.max(
            Number(existing.contentdb_downloads || 0),
            Number(detail?.downloads || 0),
            Number(scoreEntry?.downloads || 0)
          );
          const lhDl = Number(existing.luantihub_downloads || 0);
          const totalDl = Math.max(Number(existing.downloads || 0), cdbDl + lhDl);
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

          // Agnostic server-side Git repository scan (.conf + .cdb.json + LICENSE + screenshot.png)
          // Cached for 6h at Cloudflare Edge. Only run for non-ContentDB packages or packages missing metadata.
          let gitScanShot: string | undefined;
          let gitScanCdbShots: string[] = [];
          const isNativeGitPkg = Boolean(existingD1Row && existingD1Row.provider !== 'contentdb');
          const hasExistingBanner = Boolean(existing.banner && existing.banner !== 'logo.svg');
          if ((!detail || !lic || (isNativeGitPkg && !hasExistingBanner)) && repoUrl && repoScanBudget > 0) {
            repoScanBudget--;
            const gitScan = await scanGitRepoMetadataCached(author, name, pkgType, repoUrl || undefined, 21600).catch(() => null);
            if (gitScan && gitScan.gitRepoStatus === 'verified') {
              lic = lic || gitScan.license || gitScan.mediaLicense || '';
              mediaLic = mediaLic || gitScan.mediaLicense || lic || '';
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
              if (!videoUrl && gitScan.cdbMeta?.video_url) {
                const extractedVid = extractEmbeddedVideo(gitScan.cdbMeta.video_url, videoThumbUrl);
                videoUrl = extractedVid.video_url;
                videoThumbUrl = extractedVid.video_thumbnail_url || videoThumbUrl;
              }
            }
          }

          if (!detail && !lic && !repoUrl && detailTags.length === 0) return;

          const canonicalId = `${detail?.author || author}/${detail?.name || name}`;
          const sanitizedDetailThumb = sanitizePackageImageUrl(detail?.thumbnail);
          const mergedHydrateScreenshots = mergeScreenshotsPreferringGit(
            [gitScanShot, existing.banner, existing.thumbnail, sanitizedDetailThumb],
            gitScanCdbShots,
            existing.screenshots,
            detail?.screenshots
          );
          const primaryGitShot =
            sanitizePackageImageUrl(gitScanShot) ||
            (isGitRepositoryAssetUrl(mergedHydrateScreenshots[0]) ? mergedHydrateScreenshots[0] : undefined);
          const nonGitHydrateThumb =
            sanitizedDetailThumb ||
            (existing.thumbnail && !isGitRepositoryAssetUrl(existing.thumbnail)
              ? sanitizePackageImageUrl(existing.thumbnail)
              : undefined) ||
            mergedHydrateScreenshots.find(s => !isGitRepositoryAssetUrl(s));
          const resolvedHydrateThumb =
            sanitizePackageImageUrl(nonGitHydrateThumb || primaryGitShot || existing.thumbnail) || null;
          const resolvedHydrateBanner =
            sanitizePackageImageUrl(
              primaryGitShot ||
                mergedHydrateScreenshots[0] ||
                (typeof detail?.screenshots?.[0]?.url === 'string' ? detail.screenshots[0].url : detail?.screenshots?.[0]) ||
                existing.banner ||
                resolvedHydrateThumb
            ) || null;
          hydratedMap[lowerKey] = {
            id: canonicalId,
            license: lic,
            media_license: mediaLic,
            min_minetest_version: minVer,
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            score: resolvedScore > 0 ? resolvedScore : undefined,
            review_thread_counts: detailRevCounts,
            tags: detailTags.length > 0 ? detailTags : undefined,
            dev_state: devState || undefined,
            download_size: typeof detail?.download_size === 'number' ? detail.download_size : undefined,
            video_url: videoUrl,
            video_thumbnail_url: videoThumbUrl,
            repo_url: repoUrl || undefined,
            thumbnail: resolvedHydrateThumb || undefined,
            banner: resolvedHydrateBanner || undefined,
            screenshots: mergedHydrateScreenshots.length > 0 ? mergedHydrateScreenshots : undefined
          };

          // Only backfill D1 if this package already exists in D1 AND a missing field was discovered
          if (env.DB && existingD1Row) {
            const existingValidRevCounts = parseNonZeroReviewThreadCounts(existingD1Row.review_thread_counts);
            const newLic = !existingD1Row.license && lic ? lic : null;
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
            const newTagsJson =
              detailTags.length > existingD1Tags.length ? JSON.stringify(detailTags) : null;
            const newThumb =
              !sanitizePackageImageUrl(existingD1Row.thumbnail_url) && resolvedHydrateThumb
                ? resolvedHydrateThumb
                : null;
            const newBanner =
              (!sanitizePackageImageUrl(existingD1Row.banner_url) ||
                (!isGitRepositoryAssetUrl(existingD1Row.banner_url) && Boolean(primaryGitShot))) &&
              resolvedHydrateBanner
                ? resolvedHydrateBanner
                : null;
            if (newLic || newVid || newThumb || newBanner || newRevCounts || newScore !== null || newTagsJson) {
              persistStatements.push(
                env.DB.prepare(`
                  UPDATE packages
                  SET thumbnail_url = CASE
                        WHEN COALESCE(thumbnail_url, '') = '' OR thumbnail_url = 'logo.svg' OR thumbnail_url LIKE '%/storage/screenshots/%' OR thumbnail_url LIKE '%/shot-0.png' THEN COALESCE(?, thumbnail_url)
                        ELSE thumbnail_url
                      END,
                      banner_url = CASE
                        WHEN COALESCE(banner_url, '') = '' OR banner_url = 'logo.svg' OR banner_url LIKE '%/storage/screenshots/%' OR banner_url LIKE '%/shot-0.png' THEN COALESCE(?, banner_url)
                        ELSE COALESCE(?, banner_url)
                      END,
                      screenshots = CASE
                        WHEN COALESCE(screenshots, '') = '' OR screenshots LIKE '%/storage/screenshots/%' THEN COALESCE(?, screenshots)
                        ELSE COALESCE(screenshots, ?)
                      END,
                      license = CASE WHEN COALESCE(license, '') = '' THEN COALESCE(?, license) ELSE license END,
                      media_license = CASE WHEN COALESCE(media_license, '') = '' THEN COALESCE(?, media_license) ELSE media_license END,
                      video_url = COALESCE(video_url, ?),
                      video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
                      review_thread_counts = CASE
                        WHEN COALESCE(review_thread_counts, '') = '' OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN COALESCE(?, review_thread_counts)
                        ELSE review_thread_counts
                      END,
                      score = CASE WHEN ? IS NOT NULL THEN ? ELSE score END,
                      tags = COALESCE(?, tags)
                  WHERE id = ?
                `).bind(
                  newThumb || newBanner,
                  newBanner,
                  newBanner,
                  mergedHydrateScreenshots.length > 0 ? JSON.stringify(mergedHydrateScreenshots) : null,
                  mergedHydrateScreenshots.length > 0 ? JSON.stringify(mergedHydrateScreenshots) : null,
                  newLic,
                  mediaLic || null,
                  newVid,
                  videoThumbUrl || null,
                  newRevCounts,
                  newScore,
                  newScore,
                  newTagsJson,
                  existingD1Row.id
                )
              );
            }
          }
        })
      );

      if (env.DB && persistStatements.length > 0) {
        try {
          if (typeof env.DB.batch === 'function') {
            await env.DB.batch(persistStatements);
          } else {
            for (const stmt of persistStatements) {
              await stmt.run().catch(() => {});
            }
          }
        } catch {
          // Non-fatal persistence error
        }
      }
    }
  }

  if (hydrateCacheKey && Object.keys(hydratedMap).length > 0) {
    await writeEdgeCacheJson(hydrateCacheKey, hydratedMap, 3600);
  }

  return Response.json({
    success: true,
    hydrated: hydratedMap
  });
}

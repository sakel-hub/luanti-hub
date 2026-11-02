import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  ensureExtendedPackageColumns,
  scanGitRepoMetadataCached,
  extractEmbeddedVideo,
  isGitRepositoryAssetUrl,
  mergeScreenshotsPreferringGit,
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
      ? `/__api_hydrate_v2_${encodeURIComponent(
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

    if (env.DB) {
      try {
        const placeholders = rawIds.map(() => '?').join(', ');
        const lowerParams = rawIds.map(id => id.toLowerCase());
        const d1Res = await env.DB.prepare(
          `SELECT * FROM packages WHERE LOWER(id) IN (${placeholders}) AND status = 'active'`
        ).bind(...lowerParams).all();

        const d1RepoScanRows: any[] = [];
        for (const row of (d1Res?.results || [])) {
          if (!row?.id) continue;
          const lowerKey = String(row.id).toLowerCase();
          const parsedTags = parseJsonArray(row.tags);
          const hasRealTags = parsedTags.some(
            (t: string) => !['mod', 'game', 'txp', 'texture_pack'].includes(t.toLowerCase())
          );
          const cdbDl = Number(row.contentdb_downloads || 0);
          const lhDl = Number(row.luantihub_downloads || 0);
          const totalDl = Math.max(Number(row.downloads_count || 0), cdbDl + lhDl);
          const gitShotD1 = isGitRepositoryAssetUrl(row.banner_url)
            ? String(row.banner_url)
            : (isGitRepositoryAssetUrl(row.thumbnail_url) ? String(row.thumbnail_url) : undefined);
          const rowScreenshots = mergeScreenshotsPreferringGit(
            [gitShotD1, row.banner_url, row.thumbnail_url],
            parseJsonArray(row.screenshots)
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
            tags: parsedTags.length > 0 ? parsedTags : undefined,
            file_size: row.file_size || undefined,
            video_url: row.video_url || undefined,
            video_thumbnail_url: row.video_thumbnail_url || undefined,
            repo_url: row.repo_url || undefined,
            thumbnail: gitShotD1 || (row.thumbnail_url && row.thumbnail_url !== 'logo.svg' ? row.thumbnail_url : undefined),
            banner: gitShotD1 || (row.banner_url && row.banner_url !== 'logo.svg' ? row.banner_url : undefined),
            screenshots: rowScreenshots.length > 0 ? rowScreenshots : undefined
          };

          if (row.license && (cdbDl > 0 || row.provider !== 'contentdb') && hasRealTags) {
            missingIds.delete(lowerKey);
            if ((!row.video_url || !gitShotD1) && row.repo_url && d1RepoScanRows.length < 12) {
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
              const needsUpstreamScreenshots =
                row.provider === 'contentdb' &&
                !existingRowShots.some((s: string) => !isGitRepositoryAssetUrl(s));
              const [gitScan, upstreamDetail] = await Promise.all([
                scanGitRepoMetadataCached(
                  author,
                  name,
                  row.type || 'mod',
                  row.repo_url,
                  21600
                ).catch(() => null),
                needsUpstreamScreenshots
                  ? fetchUpstreamJsonCached<any>(
                      `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
                      3600
                    ).catch(() => null)
                  : Promise.resolve(null)
              ]);
              const resolvedVid = extractEmbeddedVideo(
                gitScan?.cdbMeta?.video_url,
                row.video_thumbnail_url,
                row.long_desc || gitScan?.cdbMeta?.long_description || gitScan?.longDesc
              );
              const scannedGitShot = gitScan?.screenshotUrl;
              const scannedCdbShots = gitScan?.cdbMeta?.screenshots || [];
              const mergedRowShots = mergeScreenshotsPreferringGit(
                [scannedGitShot, ...scannedCdbShots],
                hydratedMap[lowerKey]?.screenshots,
                existingRowShots,
                upstreamDetail?.screenshots
              );
              const primaryGitShot = scannedGitShot || (isGitRepositoryAssetUrl(mergedRowShots[0]) ? mergedRowShots[0] : undefined);

              if (hydratedMap[lowerKey]) {
                if (resolvedVid.video_url) {
                  hydratedMap[lowerKey].video_url = resolvedVid.video_url;
                  hydratedMap[lowerKey].video_thumbnail_url = resolvedVid.video_thumbnail_url;
                }
                if (primaryGitShot) {
                  hydratedMap[lowerKey].thumbnail = primaryGitShot;
                  hydratedMap[lowerKey].banner = primaryGitShot;
                }
                if (mergedRowShots.length > 0) {
                  hydratedMap[lowerKey].screenshots = mergedRowShots;
                }
              }

              if (resolvedVid.video_url || primaryGitShot || mergedRowShots.length > 0) {
                repoUpdateStmts.push(
                  env.DB.prepare(`
                    UPDATE packages
                    SET video_url = COALESCE(video_url, ?),
                        video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
                        thumbnail_url = CASE
                          WHEN ? IS NOT NULL AND ? != '' THEN ?
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
      let repoScanBudget = 12; // Cap server-side Git repo scans per batch (6h Edge-cached) to preserve Worker subrequest quota
      await Promise.all(
        toFetchUpstream.map(async (rawId) => {
          const [author, name] = rawId.split('/');
          if (!author || !name) return;
          const lowerKey = rawId.toLowerCase();
          const existing = hydratedMap[lowerKey] || {};
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
            3600
          ).catch(() => null);

          let lic = detail?.license || detail?.media_license || existing.license || '';
          let mediaLic = detail?.media_license || detail?.license || existing.media_license || '';
          let detailTags = Array.isArray(detail?.tags)
            ? detail.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
            : (existing.tags || []);
          const cdbDl = Math.max(Number(existing.contentdb_downloads || 0), Number(detail?.downloads || 0));
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
          let pkgType = ['mod', 'game', 'txp', 'modpack'].includes(detail?.type) ? detail.type : 'mod';

          // Agnostic server-side Git repository scan (.conf + .cdb.json + LICENSE + screenshot.png)
          // Cached for 6h at Cloudflare Edge.
          let gitScanShot: string | undefined;
          let gitScanCdbShots: string[] = [];
          const hasExistingGitShot = isGitRepositoryAssetUrl(existing.banner) || isGitRepositoryAssetUrl(existing.thumbnail);
          if ((!detail || !lic || !videoUrl || !hasExistingGitShot) && repoUrl && repoScanBudget > 0) {
            repoScanBudget--;
            const gitScan = await scanGitRepoMetadataCached(author, name, pkgType, repoUrl || undefined, 21600).catch(() => null);
            if (gitScan && gitScan.gitRepoStatus === 'verified') {
              lic = lic || gitScan.license || gitScan.mediaLicense || '';
              mediaLic = mediaLic || gitScan.mediaLicense || lic || '';
              repoUrl = repoUrl || gitScan.repoUrl || '';
              minVer = (minVer === '5.0.0' && gitScan.minVersion) ? gitScan.minVersion : minVer;
              shortDesc = shortDesc || gitScan.cdbMeta?.short_description || gitScan.shortDesc;
              title = (title === name && (gitScan.cdbMeta?.title || gitScan.title)) ? (gitScan.cdbMeta?.title || gitScan.title)! : title;
              if (gitScan.detectedType) pkgType = gitScan.detectedType;
              if (gitScan.screenshotUrl) gitScanShot = gitScan.screenshotUrl;
              if (gitScan.cdbMeta?.screenshots?.length) {
                gitScanCdbShots = gitScan.cdbMeta.screenshots;
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
          const mergedHydrateScreenshots = mergeScreenshotsPreferringGit(
            [gitScanShot, ...gitScanCdbShots, existing.banner, existing.thumbnail],
            existing.screenshots,
            detail?.screenshots
          );
          const primaryGitShot =
            gitScanShot ||
            (isGitRepositoryAssetUrl(mergedHydrateScreenshots[0]) ? mergedHydrateScreenshots[0] : undefined);
          const resolvedHydrateThumb = primaryGitShot || detail?.thumbnail || existing.thumbnail || null;
          const resolvedHydrateBanner =
            primaryGitShot ||
            mergedHydrateScreenshots[0] ||
            detail?.screenshots?.[0]?.url ||
            detail?.screenshots?.[0] ||
            existing.banner ||
            null;
          hydratedMap[lowerKey] = {
            id: canonicalId,
            license: lic,
            media_license: mediaLic,
            min_minetest_version: minVer,
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            tags: detailTags.length > 0 ? detailTags : undefined,
            download_size: typeof detail?.download_size === 'number' ? detail.download_size : undefined,
            video_url: videoUrl,
            video_thumbnail_url: videoThumbUrl,
            repo_url: repoUrl || undefined,
            thumbnail: primaryGitShot || resolvedHydrateThumb || undefined,
            banner: primaryGitShot || resolvedHydrateBanner || undefined,
            screenshots: mergedHydrateScreenshots.length > 0 ? mergedHydrateScreenshots : undefined
          };

              if (env.DB && (lic || cdbDl > 0 || videoUrl || detailTags.length > 0 || primaryGitShot)) {
                persistStatements.push(
                  env.DB.prepare(`
                    INSERT INTO packages (
                      id, author_name, name, title, type, short_desc, repo_url, provider,
                      thumbnail_url, banner_url, screenshots, license, media_license, min_minetest_version,
                      tags, status, downloads_count, contentdb_downloads, video_url, video_thumbnail_url
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'contentdb', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      thumbnail_url = CASE
                        WHEN excluded.thumbnail_url IS NOT NULL
                          AND excluded.thumbnail_url != ''
                          AND excluded.thumbnail_url != 'logo.svg'
                          AND excluded.thumbnail_url NOT LIKE '%content.luanti.org%'
                          AND excluded.thumbnail_url NOT LIKE '%contentdb.milcho.org%'
                        THEN excluded.thumbnail_url
                        WHEN packages.thumbnail_url IS NOT NULL
                          AND packages.thumbnail_url != ''
                          AND packages.thumbnail_url != 'logo.svg'
                          AND packages.thumbnail_url NOT LIKE '%content.luanti.org%'
                          AND packages.thumbnail_url NOT LIKE '%contentdb.milcho.org%'
                        THEN packages.thumbnail_url
                        ELSE COALESCE(NULLIF(excluded.thumbnail_url, ''), packages.thumbnail_url)
                      END,
                      banner_url = CASE
                        WHEN excluded.banner_url IS NOT NULL
                          AND excluded.banner_url != ''
                          AND excluded.banner_url != 'logo.svg'
                          AND excluded.banner_url NOT LIKE '%content.luanti.org%'
                          AND excluded.banner_url NOT LIKE '%contentdb.milcho.org%'
                        THEN excluded.banner_url
                        WHEN packages.banner_url IS NOT NULL
                          AND packages.banner_url != ''
                          AND packages.banner_url != 'logo.svg'
                          AND packages.banner_url NOT LIKE '%content.luanti.org%'
                          AND packages.banner_url NOT LIKE '%contentdb.milcho.org%'
                        THEN packages.banner_url
                        ELSE COALESCE(NULLIF(excluded.banner_url, ''), packages.banner_url)
                      END,
                      screenshots = COALESCE(excluded.screenshots, packages.screenshots),
                      license = CASE WHEN excluded.license != '' THEN excluded.license ELSE packages.license END,
                      media_license = CASE WHEN excluded.media_license != '' THEN excluded.media_license ELSE packages.media_license END,
                      min_minetest_version = COALESCE(NULLIF(excluded.min_minetest_version, ''), packages.min_minetest_version),
                      tags = COALESCE(excluded.tags, packages.tags),
                      contentdb_downloads = MAX(packages.contentdb_downloads, excluded.contentdb_downloads),
                      downloads_count = MAX(packages.downloads_count, excluded.downloads_count),
                      video_url = COALESCE(excluded.video_url, packages.video_url),
                      video_thumbnail_url = COALESCE(excluded.video_thumbnail_url, packages.video_thumbnail_url),
                      repo_url = CASE WHEN COALESCE(packages.repo_url, '') = '' THEN excluded.repo_url ELSE packages.repo_url END
                  `).bind(
                    canonicalId,
                    String(detail?.author || author).trim(),
                    String(detail?.name || name).trim(),
                    String(title).trim(),
                    pkgType,
                    shortDesc ? String(shortDesc).slice(0, 500) : null,
                    repoUrl,
                    resolvedHydrateThumb,
                    resolvedHydrateBanner,
                    mergedHydrateScreenshots.length > 0 ? JSON.stringify(mergedHydrateScreenshots) : null,
                    lic,
                    mediaLic,
                    minVer,
                    detailTags.length > 0 ? JSON.stringify(detailTags) : null,
                    totalDl,
                    cdbDl,
                    videoUrl || null,
                    videoThumbUrl || null
                  )
                );
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

import {
  fetchUpstreamJsonCached,
  computeGenuineStarRating,
  computeStarRatingFromData,
  computeDependencyPrioritizationMultiplier,
  isPrimarilyDependencyPackage,
  readSharedEdgeRatingsMap,
  ensureExtendedPackageColumns,
  isPackageDeprecated,
  parseJsonArray,
  sanitizePackageImageUrl,
  formatContentDbCdnUrl,
  upgradeContentDbThumbnailUrl,
  selectSharpPackageBanner,
  toProxiedGitImageIfNeeded
} from '../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);
  const timeframe = url.searchParams.get('timeframe') === 'today' ? 'today' : 'week';

  const dateCondition = timeframe === 'today'
    ? "d.download_date = DATE('now')"
    : "d.download_date >= DATE('now', '-7 days')";

  let top10List: any[] = [];
  const blockedIds = new Set<string>();
  const d1Ratings = new Map<string, number>();
  const d1Favorites = new Map<string, number>();
  const authorCounts = new Map<string, number>();
  const canTakeAuthor = (author?: string, maxPerAuthor = 2): boolean => {
    const k = String(author || '').trim().toLowerCase();
    if (!k) return true;
    return (authorCounts.get(k) || 0) < maxPerAuthor;
  };
  const markAuthor = (author?: string): void => {
    const k = String(author || '').trim().toLowerCase();
    if (k) authorCounts.set(k, (authorCounts.get(k) || 0) + 1);
  };

  // 1. Query Cloudflare D1 for intent-weighted download velocity, views, conversion rate, favorites, star ratings & Kill Switch blacklist
  if (env.DB) {
    try {
      await ensureExtendedPackageColumns(env.DB);
      const [blockedRes, ratingsRes, favsRes] = await Promise.all([
        env.DB.prepare(
          `SELECT LOWER(id) as id FROM packages WHERE status IN ('flagged', 'delisted')`
        ).all(),
        env.DB.prepare(
          `SELECT LOWER(package_id) as pkg_id, AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews GROUP BY LOWER(package_id)`
        ).all(),
        env.DB.prepare(
          `SELECT LOWER(package_id) as pkg_id, COUNT(*) as fav_cnt FROM user_favorites GROUP BY LOWER(package_id)`
        ).all().catch(() => ({ results: [] }))
      ]);

      for (const r of (blockedRes.results || [])) {
        blockedIds.add(String(r.id).toLowerCase());
      }
      for (const r of (ratingsRes.results || [])) {
        if (r?.pkg_id && Number(r.cnt) > 0 && r.avg_rating != null) {
          d1Ratings.set(String(r.pkg_id).toLowerCase(), Number(Number(r.avg_rating).toFixed(1)));
        }
      }
      for (const r of (favsRes.results || [])) {
        if (r?.pkg_id && Number(r.fav_cnt) > 0) {
          d1Favorites.set(String(r.pkg_id).toLowerCase(), Number(r.fav_cnt));
        }
      }

      const query = `
        SELECT
          d.package_id,
          SUM(d.downloads_count) AS period_downloads,
          SUM(COALESCE(d.reason_new, 0)) AS r_new,
          SUM(COALESCE(d.reason_web, 0)) AS r_web,
          SUM(COALESCE(d.reason_update, 0)) AS r_upd,
          SUM(COALESCE(d.reason_dependency, 0)) AS r_dep,
          SUM(COALESCE(d.views_luanti, 0) + COALESCE(d.views_web, 0)) AS period_views,
          p.title,
          p.author_name AS author,
          p.name,
          p.type,
          p.short_desc,
          p.thumbnail_url,
          p.banner_url,
          p.screenshots,
          p.score,
          p.license,
          p.provider,
          p.status,
          p.downloads_count,
          p.contentdb_downloads,
          p.luantihub_downloads,
          p.file_size,
          p.dev_state,
          p.tags,
          p.updated_at
        FROM package_daily_downloads d
        LEFT JOIN packages p ON LOWER(p.id) = LOWER(d.package_id)
        WHERE ${dateCondition} AND (p.status IS NULL OR p.status = 'active')
        GROUP BY LOWER(d.package_id)
        LIMIT 40;
      `;

      const res = await env.DB.prepare(query).all();
      const sharedEdgeRatings = await readSharedEdgeRatingsMap().catch(() => ({} as Record<string, any>));
      if (res.results && res.results.length > 0) {
        const candidates: Array<{ item: any; compositeScore: number; periodDownloads: number; isPureDep: boolean }> = [];
        for (const r of res.results) {
          const pkgKey = String(r.package_id || '').toLowerCase();
          if (!pkgKey || blockedIds.has(pkgKey)) continue;
          const rowTags = parseJsonArray(r.tags);
          if (isPackageDeprecated({ ...r, tags: rowTags })) continue;
          const parts = String(r.package_id).split('/');
          const author = r.author || parts[0];
          const name = r.name || parts[1];
          if (!author || !name) continue;

          const periodDl = Number(r.period_downloads || 0);
          const periodViews = Number(r.period_views || 0);
          if (periodDl <= 0 && periodViews <= 0) continue;

          const reasonSum =
            (Number(r.r_new) || 0) +
            (Number(r.r_web) || 0) +
            (Number(r.r_upd) || 0) +
            (Number(r.r_dep) || 0);
          const depRatio =
            reasonSum > 0 ? Math.min(1, Math.max(0, (Number(r.r_dep) || 0) / reasonSum)) : 0;
          const depWeight = depRatio >= 0.65 ? 0 : 0.02;
          const intentDl =
            reasonSum > 0
              ? (Number(r.r_new) || 0) * 1.0 +
                (Number(r.r_web) || 0) * 1.0 +
                (Number(r.r_upd) || 0) * 0.6 +
                (Number(r.r_dep) || 0) * depWeight
              : periodDl * (1 - depRatio * 0.85);
          const conversionRate = Number(
            Math.min(1.0, (intentDl + 1.5) / (Math.max(intentDl, periodViews) + 10)).toFixed(3)
          );
          const favCnt = d1Favorites.get(pkgKey) || 0;
          const sharedRating = sharedEdgeRatings[pkgKey];
          const resolvedScore =
            d1Ratings.get(pkgKey) ??
            (computeGenuineStarRating(null, r.score) || sharedRating?.score || 0);
          const starMultiplier = resolvedScore >= 1 ? 0.85 + (resolvedScore / 5) * 0.35 : 1.0;

          const candidatePkg = {
            id: `${author}/${name}`,
            author,
            name,
            title: r.title || name,
            type: r.type || 'mod',
            short_desc: r.short_desc || '',
            tags: rowTags,
            dependency_ratio: depRatio > 0 ? Number(depRatio.toFixed(3)) : undefined
          };
          const depMultiplier = computeDependencyPrioritizationMultiplier(candidatePkg, depRatio);
          const isPureDep = isPrimarilyDependencyPackage(candidatePkg, depRatio);

          const compositeScore =
            (intentDl * (1 + conversionRate * 0.5) + periodViews * 0.18 + Math.min(6, favCnt * 0.6)) *
            starMultiplier *
            depMultiplier;

          const cdbDl = Number(r.contentdb_downloads || 0);
          const lhDl = Math.max(Number(r.luantihub_downloads || 0), periodDl);
          const totalDl = Math.max(
            Number(r.downloads_count || 0),
            cdbDl + lhDl,
            periodDl || 1
          );

          const rowScreenshots = parseJsonArray(r.screenshots);
          const cleanRowThumb =
            upgradeContentDbThumbnailUrl(r.thumbnail_url) ||
            (rowScreenshots[0] ? formatContentDbCdnUrl(rowScreenshots[0], 'tile') : '') ||
            '';
          const cleanRowBanner =
            selectSharpPackageBanner(undefined, rowScreenshots, r.banner_url, cleanRowThumb) || cleanRowThumb;

          candidates.push({
            periodDownloads: periodDl,
            compositeScore,
            isPureDep,
            item: {
              ...candidatePkg,
              thumbnail: cleanRowThumb,
              banner: cleanRowBanner,
              ...(rowScreenshots.length > 0 ? { screenshots: rowScreenshots } : {}),
              dev_state: r.dev_state || undefined,
              score: resolvedScore,
              review_thread_counts: sharedRating?.review_thread_counts,
              contentdb_downloads: cdbDl,
              luantihub_downloads: lhDl,
              downloads: totalDl,
              weekly_downloads: timeframe === 'week' ? periodDl : undefined,
              daily_downloads: timeframe === 'today' ? periodDl : undefined,
              weekly_views: periodViews > 0 ? periodViews : undefined,
              conversion_rate: conversionRate,
              favorites_count: favCnt > 0 ? favCnt : undefined,
              file_size: r.file_size || undefined,
              license: r.license || '',
              source: r.provider && r.provider !== 'contentdb' ? 'git' : 'official'
            }
          });
        }

        candidates.sort((a, b) => b.compositeScore - a.compositeScore || b.periodDownloads - a.periodDownloads);
        for (const c of candidates) {
          if (top10List.length >= 10) break;
          if (c.isPureDep) continue;
          if (!canTakeAuthor(c.item.author, 2)) continue;
          markAuthor(c.item.author);
          top10List.push(c.item);
        }
      }
    } catch (err) {
      console.warn('D1 Top 10 query failed:', err);
    }
  }

  // 2. Enrich / Fill remaining slots from Upstream ContentDB (real metrics only)
  if (top10List.length < 10) {
    try {
      const sortParam = timeframe === 'today' ? 'last_release' : 'downloads';
      let upstreamData = await fetchUpstreamJsonCached<any[]>(`/packages/?sort=${sortParam}`, 300);
      if (!Array.isArray(upstreamData) || upstreamData.length === 0) {
        upstreamData = await fetchUpstreamJsonCached<any[]>('/packages/', 300);
      }

      if (Array.isArray(upstreamData)) {
        // Fill existing D1 entries that only had package_id recorded via download beacon
        const upstreamMap = new Map<string, any>();
        for (const item of upstreamData) {
          if (item?.author && item?.name) {
            upstreamMap.set(`${item.author}/${item.name}`.toLowerCase(), item);
          }
        }

        top10List = top10List
          .map(entry => {
            const lowerKey = entry.id.toLowerCase();
            const match = upstreamMap.get(lowerKey);
            if (match) {
              const thumb =
                upgradeContentDbThumbnailUrl(entry.thumbnail) ||
                upgradeContentDbThumbnailUrl(match.thumbnail) ||
                'logo.svg';
              const banner =
                selectSharpPackageBanner(
                  undefined,
                  entry.screenshots || match.screenshots,
                  entry.banner,
                  match.banner,
                  thumb
                ) || thumb;
              return {
                ...entry,
                title: entry.title !== entry.name ? entry.title : (match.title || entry.name),
                type: entry.type || match.type || 'mod',
                short_desc: entry.short_desc || match.short_desc || match.short_description || '',
                dev_state: entry.dev_state || match.dev_state || undefined,
                thumbnail: thumb,
                banner: banner || thumb,
                score: d1Ratings.get(lowerKey) ?? computeGenuineStarRating(entry.score, match.reviews),
                license: match.license || entry.license || ''
              };
            }
            const cleanThumb = upgradeContentDbThumbnailUrl(entry.thumbnail) || 'logo.svg';
            const cleanBanner =
              selectSharpPackageBanner(undefined, entry.screenshots, entry.banner, cleanThumb) || cleanThumb;
            return {
              ...entry,
              thumbnail: cleanThumb,
              banner: cleanBanner
            };
          })
          .filter(entry => !isPackageDeprecated(entry) && !isPrimarilyDependencyPackage(entry));

        const sharedEdgeRatings = await readSharedEdgeRatingsMap().catch(() => ({} as Record<string, any>));

        // Sort upstream candidates by real downloads / score (with dependency dampening) for remaining slots
        const sortedUpstream = [...upstreamData].sort((a, b) => {
          const multA = computeDependencyPrioritizationMultiplier(a);
          const multB = computeDependencyPrioritizationMultiplier(b);
          if (timeframe === 'today') {
            const scoreA =
              ((Number(a.score) || 0) * 10 + Math.log10((Number(a.downloads) || 1) + 1) * 50) *
              multA;
            const scoreB =
              ((Number(b.score) || 0) * 10 + Math.log10((Number(b.downloads) || 1) + 1) * 50) *
              multB;
            return scoreB - scoreA;
          }
          return (Number(b.downloads) || 0) * multB - (Number(a.downloads) || 0) * multA;
        });

        for (const item of sortedUpstream) {
          if (top10List.length >= 10) break;
          if (isPackageDeprecated(item) || isPrimarilyDependencyPackage(item)) continue;
          const pkgId = `${item.author}/${item.name}`;
          const lowerId = pkgId.toLowerCase();
          if (blockedIds.has(lowerId)) continue;
          if (top10List.some(p => p.id.toLowerCase() === lowerId)) continue;
          if (!canTakeAuthor(item.author, 2)) continue;
          markAuthor(item.author);

          const thumbnail =
            upgradeContentDbThumbnailUrl(item.thumbnail || item.thumbnail_url) || 'logo.svg';
          const banner =
            selectSharpPackageBanner(
              undefined,
              item.screenshots,
              item.banner,
              item.banner_url,
              thumbnail
            ) || thumbnail;
          const sharedRating = sharedEdgeRatings[lowerId];
          const computedScore =
            d1Ratings.get(lowerId) ??
            (computeStarRatingFromData(item, 0) || sharedRating?.score || 0);

          top10List.push({
            id: pkgId,
            author: item.author,
            name: item.name,
            title: item.title || item.name,
            type: item.type || 'mod',
            short_desc: item.short_desc || item.short_description || '',
            thumbnail,
            banner: banner || thumbnail,
            score: computedScore,
            review_thread_counts: sharedRating?.review_thread_counts,
            downloads: typeof item.downloads === 'number' ? item.downloads : 0,
            license: item.license || '',
            source: 'official'
          });
        }
      }
    } catch {
      // Keep existing top10List
    }
  }

  return new Response(JSON.stringify(top10List), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'
    }
  });
}

import { fetchUpstreamJsonCached, computeGenuineStarRating, ensureExtendedPackageColumns } from '../lib/upstream';

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

  // 1. Query Cloudflare D1 for real download velocity, star ratings & Kill Switch blacklist
  if (env.DB) {
    try {
      await ensureExtendedPackageColumns(env.DB);
      const [blockedRes, ratingsRes] = await Promise.all([
        env.DB.prepare(
          `SELECT LOWER(id) as id FROM packages WHERE status IN ('flagged', 'delisted')`
        ).all(),
        env.DB.prepare(
          `SELECT LOWER(package_id) as pkg_id, AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews GROUP BY LOWER(package_id)`
        ).all()
      ]);

      for (const r of (blockedRes.results || [])) {
        blockedIds.add(String(r.id).toLowerCase());
      }
      for (const r of (ratingsRes.results || [])) {
        if (r?.pkg_id && Number(r.cnt) > 0 && r.avg_rating != null) {
          d1Ratings.set(String(r.pkg_id).toLowerCase(), Number(Number(r.avg_rating).toFixed(1)));
        }
      }

      const query = `
        SELECT
          d.package_id,
          SUM(d.downloads_count) AS period_downloads,
          p.title,
          p.author_name AS author,
          p.name,
          p.type,
          p.short_desc,
          p.thumbnail_url,
          p.banner_url,
          p.score,
          p.license,
          p.provider,
          p.status,
          p.downloads_count,
          p.contentdb_downloads,
          p.luantihub_downloads,
          p.file_size
        FROM package_daily_downloads d
        LEFT JOIN packages p ON LOWER(p.id) = LOWER(d.package_id)
        WHERE ${dateCondition} AND (p.status IS NULL OR p.status = 'active')
        GROUP BY LOWER(d.package_id)
        ORDER BY period_downloads DESC
        LIMIT 10;
      `;

      const res = await env.DB.prepare(query).all();
      if (res.results && res.results.length > 0) {
        for (const r of res.results) {
          const pkgKey = String(r.package_id || '').toLowerCase();
          if (!pkgKey || blockedIds.has(pkgKey)) continue;
          const parts = String(r.package_id).split('/');
          const author = r.author || parts[0];
          const name = r.name || parts[1];
          if (!author || !name) continue;

          const cdbDl = Number(r.contentdb_downloads || 0);
          const lhDl = Math.max(Number(r.luantihub_downloads || 0), Number(r.period_downloads || 0));
          const totalDl = Math.max(
            Number(r.downloads_count || 0),
            cdbDl + lhDl,
            Number(r.period_downloads) || 1
          );

          top10List.push({
            id: `${author}/${name}`,
            author,
            name,
            title: r.title || name,
            type: r.type || 'mod',
            short_desc: r.short_desc || '',
            thumbnail: r.thumbnail_url || '',
            banner: r.banner_url || r.thumbnail_url || '',
            score: d1Ratings.get(pkgKey) ?? computeGenuineStarRating(null, r.score),
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            file_size: r.file_size || undefined,
            license: r.license || '',
            source: r.provider && r.provider !== 'contentdb' ? 'git' : 'official'
          });
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

        top10List = top10List.map(entry => {
          const lowerKey = entry.id.toLowerCase();
          const match = upstreamMap.get(lowerKey);
          if (match) {
            const thumb = entry.thumbnail || match.thumbnail || 'logo.svg';
            let banner = entry.banner || match.banner;
            if (!banner && thumb.includes('thumbnail.png')) {
              banner = thumb.replace('thumbnail.png', 'shot-0.png');
            }
            return {
              ...entry,
              title: entry.title !== entry.name ? entry.title : (match.title || entry.name),
              type: entry.type || match.type || 'mod',
              short_desc: entry.short_desc || match.short_desc || match.short_description || '',
              thumbnail: thumb,
              banner: banner || thumb,
              score: d1Ratings.get(lowerKey) ?? computeGenuineStarRating(entry.score, match.reviews),
              license: match.license || entry.license || ''
            };
          }
          return {
            ...entry,
            thumbnail: entry.thumbnail || 'logo.svg',
            banner: entry.banner || entry.thumbnail || 'logo.svg'
          };
        });

        // Sort upstream candidates by real downloads / score for remaining slots
        const sortedUpstream = [...upstreamData].sort((a, b) => {
          if (timeframe === 'today') {
            const scoreA = (Number(a.score) || 0) * 10 + Math.log10((Number(a.downloads) || 1) + 1) * 50;
            const scoreB = (Number(b.score) || 0) * 10 + Math.log10((Number(b.downloads) || 1) + 1) * 50;
            return scoreB - scoreA;
          }
          return (Number(b.downloads) || 0) - (Number(a.downloads) || 0);
        });

        for (const item of sortedUpstream) {
          if (top10List.length >= 10) break;
          const pkgId = `${item.author}/${item.name}`;
          const lowerId = pkgId.toLowerCase();
          if (blockedIds.has(lowerId)) continue;
          if (top10List.some(p => p.id.toLowerCase() === lowerId)) continue;

          const thumbnail = item.thumbnail || item.thumbnail_url || 'logo.svg';
          let banner = item.banner || item.banner_url;
          if (!banner && thumbnail.includes('thumbnail.png')) {
            banner = thumbnail.replace('thumbnail.png', 'shot-0.png');
          }

          top10List.push({
            id: pkgId,
            author: item.author,
            name: item.name,
            title: item.title || item.name,
            type: item.type || 'mod',
            short_desc: item.short_desc || item.short_description || '',
            thumbnail,
            banner: banner || thumbnail,
            score: d1Ratings.get(lowerId) ?? computeGenuineStarRating(null, item.reviews),
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

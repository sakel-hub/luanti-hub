import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  normalizeRepoKey,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../lib/upstream';

interface Env {
  DB?: any;
}

const DEFAULT_CONTENTDB_TAGS = [
  { name: 'adventure_and_rpg', title: 'Adventure / RPG' },
  { name: 'building', title: 'Building' },
  { name: 'combat', title: 'Combat' },
  { name: 'Crafting', title: 'Crafting' },
  { name: 'decorative', title: 'Decorative' },
  { name: 'environment', title: 'Environment' },
  { name: 'gui', title: 'GUI' },
  { name: 'hud', title: 'HUD' },
  { name: 'inventory', title: 'Inventory' },
  { name: 'magic', title: 'Magic' },
  { name: 'mapgen', title: 'Mapgen' },
  { name: 'mobs', title: 'Mobs / Animals / NPCs' },
  { name: 'multiplayer', title: 'Multiplayer' },
  { name: 'plants_and_farming', title: 'Plants and Farming' },
  { name: 'player_effects', title: 'Player Effects' },
  { name: 'pve', title: 'PvE' },
  { name: 'pvp', title: 'PvP' },
  { name: 'storage', title: 'Storage' },
  { name: 'survival', title: 'Survival' },
  { name: 'technology', title: 'Technology' },
  { name: 'tools', title: 'Tools / Weapons' },
  { name: 'transport', title: 'Transport' },
  { name: 'world_maintenance', title: 'World Maintenance' }
];

function buildTop10FromCatalog(
  mergedCatalog: any[],
  velocityMap: Map<string, number>,
  timeframe: 'today' | 'week'
): any[] {
  const catalogByLowerId = new Map<string, any>();
  for (const item of mergedCatalog) {
    if (item?.id) {
      catalogByLowerId.set(String(item.id).toLowerCase(), item);
    }
  }

  const top10: any[] = [];
  const sortedVelocity = Array.from(velocityMap.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [lowerId, periodDownloads] of sortedVelocity) {
    if (top10.length >= 10) break;
    const match = catalogByLowerId.get(lowerId);
    if (!match) continue;
    top10.push({
      ...match,
      downloads: periodDownloads
    });
  }

  if (top10.length < 10) {
    const remaining = [...mergedCatalog].sort((a, b) => {
      if (timeframe === 'today') {
        const scoreA = (Number(a.score) || 0) * 10 + Math.log10((Number(a.downloads) || 1) + 1) * 50;
        const scoreB = (Number(b.score) || 0) * 10 + Math.log10((Number(b.downloads) || 1) + 1) * 50;
        return scoreB - scoreA;
      }
      return (Number(b.downloads) || 0) - (Number(a.downloads) || 0);
    });

    for (const item of remaining) {
      if (top10.length >= 10) break;
      const lowerId = String(item.id || `${item.author}/${item.name}`).toLowerCase();
      if (top10.some(p => String(p.id).toLowerCase() === lowerId)) continue;
      top10.push(item);
    }
  }

  return top10;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const type = (url.searchParams.get('type') || '').trim();
  const author = (url.searchParams.get('author') || '').trim();
  const isBootBundle = url.searchParams.get('boot') === '1';

  const upstreamParams = new URLSearchParams(url.searchParams);
  upstreamParams.delete('boot');
  upstreamParams.delete('nocache');
  const upstreamQuery = upstreamParams.toString();
  const upstreamPath = `/packages/${upstreamQuery ? `?${upstreamQuery}` : ''}`;

  // 1. Fetch Upstream Packages (with Cloudflare Edge Cache + mirror failover)
  const upstreamPromise = fetchUpstreamJsonCached<any[]>(upstreamPath, 300)
    .then(list => Array.isArray(list) ? list : [])
    .catch(() => []);

  const tagsPromise = isBootBundle
    ? fetchUpstreamJsonCached<any[]>('/tags/', 3600).catch(() => null)
    : Promise.resolve<any[] | null>(null);

  // 2. Fetch Decentralized Packages, Review Star Averages, AND Kill-Switch Blacklist from Cloudflare D1
  let d1Promise = Promise.resolve<any[]>([]);
  let blockedPromise = Promise.resolve<Set<string>>(new Set());
  let reviewRatingsPromise = Promise.resolve<Map<string, number>>(new Map());
  let velocityPromise = Promise.resolve<{ today: Map<string, number>; week: Map<string, number> }>({
    today: new Map(),
    week: new Map()
  });

  if (env.DB) {
    let query = `SELECT * FROM packages WHERE status = 'active'`;
    const params: any[] = [];

    if (type && type !== 'all') {
      query += ` AND type = ?`;
      params.push(type);
    }
    if (q) {
      query += ` AND (title LIKE ? OR name LIKE ? OR short_desc LIKE ? OR author_name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (author) {
      query += ` AND LOWER(author_name) = LOWER(?)`;
      params.push(author);
    }

    query += ` ORDER BY downloads_count DESC LIMIT 200`;

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

    if (isBootBundle) {
      velocityPromise = env.DB.prepare(`
        SELECT
          LOWER(package_id) as pkg_id,
          SUM(CASE WHEN download_date = DATE('now') THEN downloads_count ELSE 0 END) as today_dl,
          SUM(downloads_count) as week_dl
        FROM package_daily_downloads
        WHERE download_date >= DATE('now', '-7 days')
        GROUP BY LOWER(package_id)
      `).all()
        .then((res: any) => {
          const today = new Map<string, number>();
          const week = new Map<string, number>();
          for (const row of (res.results || [])) {
            if (!row?.pkg_id) continue;
            const k = String(row.pkg_id).toLowerCase();
            if (Number(row.today_dl) > 0) today.set(k, Number(row.today_dl));
            if (Number(row.week_dl) > 0) week.set(k, Number(row.week_dl));
          }
          return { today, week };
        })
        .catch(() => ({ today: new Map(), week: new Map() }));
    }
  }

  const [upstreamList, d1List, blockedIds, d1Ratings, rawTags, velocity] = await Promise.all([
    upstreamPromise,
    d1Promise,
    blockedPromise,
    reviewRatingsPromise,
    tagsPromise,
    velocityPromise
  ]);

  // 3. Build upstream ContentDB index by ID, normalized repo URL, and (name + title) to prevent duplicates
  const upstreamById = new Map<string, any>();
  const upstreamByRepo = new Map<string, any>();
  const upstreamByNameTitle = new Map<string, any>();

  for (const item of upstreamList) {
    if (!item || !item.author || !item.name) continue;
    const uKey = `${item.author}/${item.name}`.toLowerCase();
    upstreamById.set(uKey, item);
    const rKey = normalizeRepoKey(item.repo || item.repo_url);
    if (rKey) upstreamByRepo.set(rKey, item);
    const ntKey = `${String(item.name).toLowerCase()}::${String(item.title || '').trim().toLowerCase()}`;
    upstreamByNameTitle.set(ntKey, item);
  }

  // 4. Format D1 packages into standard ContentDB-compatible schema (merging with upstream ContentDB if present)
  const seenKeys = new Set<string>();
  const merged: any[] = [];

  for (const p of d1List) {
    const d1Key = `${p.author_name}/${p.name}`.toLowerCase();
    if (blockedIds.has(d1Key)) continue;

    const pRepoKey = normalizeRepoKey(p.repo_url);
    const pNameTitleKey = `${String(p.name || '').toLowerCase()}::${String(p.title || '').trim().toLowerCase()}`;
    const matchedUpstream =
      upstreamById.get(d1Key) ||
      (pRepoKey ? upstreamByRepo.get(pRepoKey) : undefined) ||
      upstreamByNameTitle.get(pNameTitleKey);

    const canonicalAuthor = matchedUpstream?.author || p.author_name;
    const canonicalName = matchedUpstream?.name || p.name;
    const canonicalKey = `${canonicalAuthor}/${canonicalName}`.toLowerCase();
    if (blockedIds.has(canonicalKey) || seenKeys.has(canonicalKey)) continue;

    seenKeys.add(d1Key);
    seenKeys.add(canonicalKey);

    const parsedTags = parseJsonArray(p.tags);
    const isGitSource = p.provider !== 'contentdb' || parsedTags.includes('git');
    const isAlsoOfficial = Boolean(matchedUpstream) || p.provider === 'contentdb' || parsedTags.includes('contentdb');

    const sources: Array<'official' | 'git'> = [];
    if (isAlsoOfficial) sources.push('official');
    if (isGitSource) sources.push('git');
    if (sources.length === 0) sources.push('official');

    const d1StarAvg = d1Ratings.get(canonicalKey) ?? d1Ratings.get(d1Key) ?? 0;
    const upstreamTags = Array.isArray(matchedUpstream?.tags)
      ? matchedUpstream.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
      : [];
    const combinedTags = Array.from(new Set([...parsedTags, ...upstreamTags])).filter(Boolean);

    const parsedDeps = parseJsonArray(p.dependencies);
    const parsedOptDeps = parseJsonArray(p.optional_dependencies);

    const resolvedThumb = (p.thumbnail_url && p.thumbnail_url !== 'logo.svg')
      ? p.thumbnail_url
      : (matchedUpstream?.thumbnail || p.thumbnail_url || '');
    const resolvedBanner = (p.banner_url && p.banner_url !== 'logo.svg')
      ? p.banner_url
      : (matchedUpstream?.thumbnail ? String(matchedUpstream.thumbnail).replace('thumbnail.png', 'shot-0.png') : resolvedThumb);

    merged.push({
      ...(matchedUpstream || {}),
      id: `${canonicalAuthor}/${canonicalName}`,
      author: canonicalAuthor,
      name: canonicalName,
      title: matchedUpstream?.title || p.title || canonicalName,
      type: p.type || matchedUpstream?.type || 'mod',
      short_desc: p.short_desc || matchedUpstream?.short_desc || matchedUpstream?.short_description || '',
      thumbnail: resolvedThumb,
      banner: resolvedBanner,
      score: d1StarAvg || matchedUpstream?.score || 0,
      contentdb_score: Number(matchedUpstream?.score || 0),
      downloads: Math.max(
        typeof p.downloads_count === 'number' ? p.downloads_count : 0,
        typeof matchedUpstream?.downloads === 'number' ? matchedUpstream.downloads : 0
      ),
      license: p.license || matchedUpstream?.license || '',
      media_license: p.media_license || matchedUpstream?.media_license || '',
      repo_url: p.repo_url || matchedUpstream?.repo || matchedUpstream?.repo_url || undefined,
      provider: p.provider || (isGitSource ? 'github' : 'contentdb'),
      min_minetest_version: p.min_minetest_version || matchedUpstream?.min_minetest_version || '5.0.0',
      tags: combinedTags.length > 0 ? combinedTags : [p.type || 'mod'],
      dependencies: parsedDeps.length > 0 ? parsedDeps : matchedUpstream?.dependencies,
      optional_dependencies: parsedOptDeps.length > 0 ? parsedOptDeps : matchedUpstream?.optional_dependencies,
      url: `/api/packages/${canonicalAuthor}/${canonicalName}/`,
      source: isGitSource ? 'git' : 'official',
      sources
    });
  }

  // 5. Append Upstream ContentDB packages (excluding duplicates and D1 Kill-Switch delisted items)
  for (const item of upstreamList) {
    if (!item || !item.author || !item.name) continue;
    const key = `${item.author}/${item.name}`.toLowerCase();
    if (blockedIds.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const d1StarAvg = d1Ratings.get(key);
    merged.push({
      ...item,
      id: `${item.author}/${item.name}`,
      score: d1StarAvg !== undefined ? d1StarAvg : item.score,
      contentdb_score: Number(item.score || 0),
      source: 'official',
      sources: ['official']
    });
  }

  let responsePayload: any = merged;
  if (isBootBundle) {
    let tags = DEFAULT_CONTENTDB_TAGS;
    if (Array.isArray(rawTags) && rawTags.length > 0) {
      const normalizedTags = rawTags
        .map((t: any) => ({
          name: String(t.name || t.id || '').trim(),
          title: String(t.title || t.name || '').trim()
        }))
        .filter((t) => Boolean(t.name && t.title));
      if (normalizedTags.length > 0) {
        tags = normalizedTags;
      }
    }

    const top10Week = buildTop10FromCatalog(merged, velocity.week, 'week');
    const top10Today = buildTop10FromCatalog(merged, velocity.today, 'today');

    responsePayload = {
      packages: merged,
      tags,
      top10Week,
      top10Today
    };
  }

  return new Response(JSON.stringify(responsePayload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

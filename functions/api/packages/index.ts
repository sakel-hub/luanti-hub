import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  normalizeRepoKey,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  ensureExtendedPackageColumns
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
      downloads: Math.max(Number(match.downloads || 0), periodDownloads)
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
  const types = url.searchParams
    .getAll('type')
    .map(t => t.trim())
    .filter(t => Boolean(t) && t !== 'all');
  const author = (url.searchParams.get('author') || '').trim();
  const isBootBundle = url.searchParams.get('boot') === '1';

  const upstreamParams = new URLSearchParams(url.searchParams);
  upstreamParams.delete('boot');
  upstreamParams.delete('nocache');
  if (!upstreamParams.has('fmt')) {
    upstreamParams.set('fmt', 'vcs');
  }
  const upstreamQuery = upstreamParams.toString();
  const upstreamPath = `/packages/${upstreamQuery ? `?${upstreamQuery}` : ''}`;

  // 1. Fetch Upstream Packages + Bulk Scores/Downloads (with Cloudflare Edge Cache + mirror failover)
  const upstreamPromise = fetchUpstreamJsonCached<any[]>(upstreamPath, 300)
    .then(list => Array.isArray(list) ? list : [])
    .catch(() => []);

  const scoresPromise = fetchUpstreamJsonCached<any[]>('/scores/', 900)
    .then(list => Array.isArray(list) ? list : [])
    .catch(() => []);

  const tagsPromise = isBootBundle
    ? fetchUpstreamJsonCached<any[]>('/tags/', 3600).catch(() => null)
    : Promise.resolve<any[] | null>(null);

  // 2. Fetch Decentralized Packages, Review Star Averages, AND Kill-Switch Blacklist from Cloudflare D1
  let d1Promise = Promise.resolve<any[]>([]);
  let blockedPromise = Promise.resolve<Set<string>>(new Set());
  let reviewRatingsPromise = Promise.resolve<Map<string, number>>(new Map());
  let lhDownloadsMapPromise = Promise.resolve<Map<string, number>>(new Map());
  let velocityPromise = Promise.resolve<{ today: Map<string, number>; week: Map<string, number> }>({
    today: new Map(),
    week: new Map()
  });

  if (env.DB) {
    await ensureExtendedPackageColumns(env.DB);
    let query = `SELECT * FROM packages WHERE status = 'active'`;
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

    // All-time Luanti Hub downloads per package from `package_daily_downloads`
    lhDownloadsMapPromise = env.DB.prepare(
      `SELECT LOWER(package_id) as pkg_id, SUM(downloads_count) as total_lh FROM package_daily_downloads GROUP BY LOWER(package_id)`
    ).all()
      .then((res: any) => {
        const map = new Map<string, number>();
        for (const r of (res.results || [])) {
          if (r?.pkg_id && Number(r.total_lh) > 0) {
            map.set(String(r.pkg_id).toLowerCase(), Number(r.total_lh));
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

  const [upstreamList, scoresList, d1List, blockedIds, d1Ratings, lhDownloadsMap, rawTags, velocity] = await Promise.all([
    upstreamPromise,
    scoresPromise,
    d1Promise,
    blockedPromise,
    reviewRatingsPromise,
    lhDownloadsMapPromise,
    tagsPromise,
    velocityPromise
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

  // 3. Build upstream ContentDB index by ID, normalized repo URL, (name + title), and unambiguous (name + type) to prevent duplicates
  const upstreamById = new Map<string, any>();
  const upstreamByRepo = new Map<string, any>();
  const upstreamByNameTitle = new Map<string, any>();
  const upstreamByNameTypeCount = new Map<string, number>();
  const upstreamByNameType = new Map<string, any>();

  for (const item of upstreamList) {
    if (!item || !item.author || !item.name) continue;
    const uKey = `${item.author}/${item.name}`.toLowerCase();
    upstreamById.set(uKey, item);
    const rKey = normalizeRepoKey(item.repo || item.repo_url);
    if (rKey) upstreamByRepo.set(rKey, item);
    const ntKey = `${String(item.name).toLowerCase()}::${String(item.title || '').trim().toLowerCase()}`;
    upstreamByNameTitle.set(ntKey, item);
    const nameTypeKey = `${String(item.name).toLowerCase()}::${String(item.type || 'mod').toLowerCase()}`;
    upstreamByNameTypeCount.set(nameTypeKey, (upstreamByNameTypeCount.get(nameTypeKey) || 0) + 1);
    upstreamByNameType.set(nameTypeKey, item);
  }

  // 4. Format D1 packages into standard ContentDB-compatible schema (merging with upstream ContentDB if present)
  const seenKeys = new Set<string>();
  const merged: any[] = [];

  for (const p of d1List) {
    const d1Key = `${p.author_name}/${p.name}`.toLowerCase();
    if (blockedIds.has(d1Key)) continue;

    const pRepoKey = normalizeRepoKey(p.repo_url);
    const pNameTitleKey = `${String(p.name || '').toLowerCase()}::${String(p.title || '').trim().toLowerCase()}`;
    const pNameTypeKey = `${String(p.name || '').toLowerCase()}::${String(p.type || 'mod').toLowerCase()}`;
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

    const rawThumbCandidate = (p.thumbnail_url && p.thumbnail_url !== 'logo.svg')
      ? p.thumbnail_url
      : (matchedUpstream?.thumbnail || p.banner_url || '');
    const resolvedThumb = rawThumbCandidate && String(rawThumbCandidate).startsWith('http')
      ? String(rawThumbCandidate)
      : null;
    const resolvedBanner = (p.banner_url && p.banner_url !== 'logo.svg')
      ? p.banner_url
      : (matchedUpstream?.thumbnail ? String(matchedUpstream.thumbnail).replace('thumbnail.png', 'shot-0.png') : (resolvedThumb || ''));

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

    merged.push({
      ...(matchedUpstream || {}),
      id: `${canonicalAuthor}/${canonicalName}`,
      author: canonicalAuthor,
      name: canonicalName,
      aliases: aliases.length > 0 ? aliases : undefined,
      title: matchedUpstream?.title || p.title || canonicalName,
      type: p.type === 'modpack' ? 'mod' : (p.type || matchedUpstream?.type || 'mod'),
      short_desc: shortDescText,
      short_description: shortDescText,
      release: releaseId,
      thumbnail: resolvedThumb,
      banner: resolvedBanner,
      score: d1StarAvg || matchedUpstream?.score || 0,
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
      file_size: p.file_size || undefined,
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
    const cdbDl = Number(item.downloads || 0);
    const lhDl = lhDownloadsMap.get(key) || 0;
    merged.push({
      ...item,
      id: `${item.author}/${item.name}`,
      score: d1StarAvg !== undefined ? d1StarAvg : item.score,
      contentdb_score: Number(item.score || 0),
      contentdb_downloads: cdbDl,
      luantihub_downloads: lhDl,
      downloads: cdbDl + lhDl,
      source: 'official',
      sources: ['official']
    });
  }

  // Promote Top 10 trending packages as featured for in-game Luanti Content tab (renders gold star badge in dlg_contentdb.lua:355)
  const top10Week = buildTop10FromCatalog(merged, velocity.week, 'week');
  const top10Today = buildTop10FromCatalog(merged, velocity.today, 'today');
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

    // Pre-hydrate licenses, tags & ContentDB downloads on the server for top carousel & Git Community packages (cached 1h at Cloudflare Edge + saved to D1)
    const carouselPool: any[] = [];
    const pushPool = (items: any[]) => {
      for (const it of items) {
        if (
          it &&
          it.author &&
          it.name &&
          (!it.license || (it.sources?.includes('official') && !(Number(it.contentdb_downloads || 0) > 0))) &&
          !carouselPool.some(x => x.id === it.id)
        ) {
          carouselPool.push(it);
        }
      }
    };
    const byDownloadsDesc = [...merged].sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0));
    pushPool(merged.filter(p => p.sources?.includes('git')));
    pushPool(top10Today);
    pushPool(top10Week);
    pushPool(byDownloadsDesc.filter(p => p.type === 'game').slice(0, 24));
    pushPool(byDownloadsDesc.filter(p => p.type === 'mod').slice(0, 24));
    pushPool(byDownloadsDesc.filter(p => p.type === 'txp').slice(0, 24));

    const batchToHydrate = carouselPool.slice(0, 32);
    if (batchToHydrate.length > 0) {
      await Promise.all(
        batchToHydrate.map(async (pkg) => {
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/`,
            3600
          ).catch(() => null);
          if (!detail) return;
          const resolvedLic = detail.license || detail.media_license || pkg.license || '';
          const resolvedMediaLic = detail.media_license || detail.license || pkg.media_license || '';
          const detailTags = Array.isArray(detail.tags)
            ? detail.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
            : [];
          if (resolvedLic) {
            pkg.license = resolvedLic;
            pkg.media_license = resolvedMediaLic;
          }
          if (detailTags.length > 0) {
            pkg.tags = Array.from(new Set([...(pkg.tags || []), ...detailTags])).filter(Boolean);
          }
          if (typeof detail.downloads === 'number' && detail.downloads > 0) {
            pkg.contentdb_downloads = Math.max(Number(pkg.contentdb_downloads || 0), detail.downloads);
            pkg.downloads = Math.max(
              Number(pkg.downloads || 0),
              pkg.contentdb_downloads + Number(pkg.luantihub_downloads || 0)
            );
          }
          if (detail.video_url && !pkg.video_url) {
            pkg.video_url = detail.video_url;
          }
          if (detail.video_thumbnail_url && !pkg.video_thumbnail_url) {
            pkg.video_thumbnail_url = detail.video_thumbnail_url;
          }
          if (env.DB && (resolvedLic || Number(pkg.contentdb_downloads || 0) > 0)) {
            env.DB.prepare(`
              INSERT INTO packages (
                id, author_name, name, title, type, short_desc, repo_url, provider,
                thumbnail_url, banner_url, license, media_license, tags, status,
                downloads_count, contentdb_downloads, luantihub_downloads, video_url, video_thumbnail_url
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'contentdb', ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                license = CASE WHEN excluded.license != '' THEN excluded.license ELSE packages.license END,
                media_license = CASE WHEN excluded.media_license != '' THEN excluded.media_license ELSE packages.media_license END,
                tags = COALESCE(excluded.tags, packages.tags),
                contentdb_downloads = MAX(packages.contentdb_downloads, excluded.contentdb_downloads),
                downloads_count = MAX(packages.downloads_count, excluded.downloads_count)
            `).bind(
              pkg.id,
              pkg.author,
              pkg.name,
              pkg.title || pkg.name,
              ['mod', 'game', 'txp', 'modpack'].includes(pkg.type) ? pkg.type : 'mod',
              pkg.short_desc || pkg.short_description || null,
              pkg.repo_url || detail.repo || '',
              pkg.thumbnail || null,
              pkg.banner || null,
              resolvedLic,
              resolvedMediaLic,
              pkg.tags?.length > 0 ? JSON.stringify(pkg.tags) : null,
              Number(pkg.downloads || 0),
              Number(pkg.contentdb_downloads || 0),
              Number(pkg.luantihub_downloads || 0),
              pkg.video_url || null,
              pkg.video_thumbnail_url || null
            ).run().catch(() => {});

            // Also keep any existing D1 Git row with the same technical name & type in sync if its author_name differed from ContentDB
            env.DB.prepare(`
              UPDATE packages
              SET contentdb_downloads = MAX(contentdb_downloads, ?),
                  downloads_count = MAX(downloads_count, ? + COALESCE(luantihub_downloads, 0)),
                  license = CASE WHEN COALESCE(license, '') = '' THEN ? ELSE license END
              WHERE LOWER(name) = LOWER(?) AND LOWER(type) = LOWER(?)
            `).bind(
              Number(pkg.contentdb_downloads || 0),
              Number(pkg.contentdb_downloads || 0),
              resolvedLic,
              pkg.name,
              ['mod', 'game', 'txp', 'modpack'].includes(pkg.type) ? pkg.type : 'mod'
            ).run().catch(() => {});
          }
        })
      );
    }

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

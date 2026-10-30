import { fetchUpstreamJsonCached, readEdgeCacheJson, writeEdgeCacheJson } from './lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const upstreamPath = `/updates/${query ? `?${query}` : ''}`;
  const edgeCacheKey = `https://cache.luantihub.internal/__api_updates_v2_${encodeURIComponent(query)}`;

  const cachedUpdates = await readEdgeCacheJson<Record<string, number>>(edgeCacheKey);
  if (cachedUpdates && typeof cachedUpdates === 'object') {
    return new Response(JSON.stringify(cachedUpdates), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
        'X-LuantiHub-Cache': 'HIT-EDGE'
      }
    });
  }

  const [upstreamUpdates, d1Rows] = await Promise.all([
    fetchUpstreamJsonCached<Record<string, number>>(upstreamPath, 300).catch(() => null),
    env.DB
      ? env.DB.prepare(
          `SELECT author_name, name, type, repo_url, updated_at, created_at FROM packages WHERE status = 'active'`
        )
          .all()
          .then((res: any) => res.results || [])
          .catch(() => [])
      : Promise.resolve<any[]>([])
  ]);

  const merged: Record<string, number> = {};
  const upstreamByName = new Map<string, number>();

  if (upstreamUpdates && typeof upstreamUpdates === 'object') {
    for (const [k, v] of Object.entries(upstreamUpdates)) {
      if (typeof v === 'number' && v > 0) {
        merged[k] = v;
        merged[k.toLowerCase()] = v;
        const slashIdx = k.indexOf('/');
        if (slashIdx > 0) {
          const pkgName = k.slice(slashIdx + 1).toLowerCase();
          if (!upstreamByName.has(pkgName)) {
            upstreamByName.set(pkgName, v);
          }
        }
      }
    }
  }

  for (const row of d1Rows) {
    if (!row?.author_name || !row?.name) continue;
    const authorLower = String(row.author_name).toLowerCase();
    const safeName = String(row.name)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'mod';

    // If package matches an upstream ContentDB package by name or repo, align release ID to ContentDB's release ID
    // so in-game ContentDB client does not see timestamp inflation (e.g. 1.7B > 1824) and loop update prompts
    const matchedUpstreamRel = upstreamByName.get(safeName) ?? upstreamByName.get(String(row.name).toLowerCase());
    const releaseId =
      Number(matchedUpstreamRel) > 0
        ? Number(matchedUpstreamRel)
        : Math.max(
            1,
            Math.floor(new Date(row.updated_at || row.created_at || '2026-01-01T00:00:00Z').getTime() / 1000) || 1
          );

    const baseAuthor = authorLower.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
    const keysToSet = [
      `${row.author_name}/${safeName}`,
      `${row.author_name}/${row.name}`,
      `${authorLower}/${safeName}`,
      `${authorLower}/${String(row.name).toLowerCase()}`,
      ...(baseAuthor && baseAuthor !== authorLower
        ? [`${baseAuthor}/${safeName}`, `${baseAuthor}/${String(row.name).toLowerCase()}`]
        : [])
    ];

    for (const key of keysToSet) {
      if (!merged[key] || Number(merged[key]) <= 0) {
        merged[key] = releaseId;
      }
    }
  }

  await writeEdgeCacheJson(edgeCacheKey, merged, 180);

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
      'X-LuantiHub-Cache': 'MISS-EDGE'
    }
  });
}

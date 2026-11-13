import { fetchUpstreamJsonCached, readEdgeCacheJson, writeEdgeCacheJson } from './lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { env } = context;
  const upstreamPath = '/updates/';
  const edgeCacheKey = 'https://cache.luantihub.internal/__api_updates_v3';

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
  const upstreamByAuthorAndName = new Map<string, { rel: number; canonicalAuthor: string; canonicalName: string }>();

  const normalizeBaseAuthor = (raw: string): string =>
    String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');

  if (upstreamUpdates && typeof upstreamUpdates === 'object') {
    for (const [k, v] of Object.entries(upstreamUpdates)) {
      if (typeof v === 'number' && v > 0) {
        merged[k] = v;
        merged[k.toLowerCase()] = v;
        const slashIdx = k.indexOf('/');
        if (slashIdx > 0) {
          const canonicalAuthor = k.slice(0, slashIdx);
          const canonicalName = k.slice(slashIdx + 1);
          const authorLower = canonicalAuthor.toLowerCase();
          const baseAuthor = normalizeBaseAuthor(authorLower);
          const pkgName = canonicalName.toLowerCase();
          const safePkgName = pkgName.replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || pkgName;
          const entry = { rel: v, canonicalAuthor, canonicalName };
          upstreamByAuthorAndName.set(`${authorLower}/${pkgName}`, entry);
          upstreamByAuthorAndName.set(`${authorLower}/${safePkgName}`, entry);
          if (baseAuthor && baseAuthor !== authorLower) {
            if (!upstreamByAuthorAndName.has(`${baseAuthor}/${pkgName}`)) {
              upstreamByAuthorAndName.set(`${baseAuthor}/${pkgName}`, entry);
            }
            if (!upstreamByAuthorAndName.has(`${baseAuthor}/${safePkgName}`)) {
              upstreamByAuthorAndName.set(`${baseAuthor}/${safePkgName}`, entry);
            }
          }
        }
      }
    }
  }

  for (const row of d1Rows) {
    if (!row?.author_name || !row?.name) continue;
    const authorLower = String(row.author_name).toLowerCase();
    const baseAuthor = normalizeBaseAuthor(authorLower);
    const rawNameLower = String(row.name).toLowerCase();
    const safeName = rawNameLower
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'mod';

    // Match upstream ContentDB package strictly by same author or normalized base-author + technical name
    // (never across unrelated authors who happen to share a technical mod name) so release IDs match /api/packages/
    const matchedUpstream =
      upstreamByAuthorAndName.get(`${authorLower}/${rawNameLower}`) ||
      upstreamByAuthorAndName.get(`${authorLower}/${safeName}`) ||
      (baseAuthor && baseAuthor !== authorLower
        ? upstreamByAuthorAndName.get(`${baseAuthor}/${rawNameLower}`) ||
          upstreamByAuthorAndName.get(`${baseAuthor}/${safeName}`)
        : undefined);

    const releaseId =
      Number(matchedUpstream?.rel) > 0
        ? Number(matchedUpstream!.rel)
        : Math.max(
            1,
            Math.floor(new Date(row.updated_at || row.created_at || '2026-01-01T00:00:00Z').getTime() / 1000) || 1
          );

    const keysToSet = [
      `${row.author_name}/${safeName}`,
      `${row.author_name}/${row.name}`,
      `${authorLower}/${safeName}`,
      `${authorLower}/${rawNameLower}`,
      ...(matchedUpstream
        ? [
            `${matchedUpstream.canonicalAuthor}/${matchedUpstream.canonicalName}`,
            `${matchedUpstream.canonicalAuthor}/${safeName}`
          ]
        : []),
      ...(baseAuthor && baseAuthor !== authorLower
        ? [`${baseAuthor}/${safeName}`, `${baseAuthor}/${rawNameLower}`]
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

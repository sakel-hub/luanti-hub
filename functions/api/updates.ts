import {
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  UPDATES_EDGE_CACHE_KEY,
  computeLuantiClientReleaseId
} from './lib/upstream';
import { overlayJam2026UpdatesMap } from './lib/jam-2026';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { env } = context;
  const upstreamPath = '/updates/';
  const edgeCacheKey = UPDATES_EDGE_CACHE_KEY;
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const noCache =
    reqUrl?.searchParams.get('nocache') === '1' ||
    reqUrl?.searchParams.get('nocache') === 'true' ||
    (context.request?.headers?.get('Cache-Control') || '').toLowerCase().includes('no-cache');

  const cachedUpdates = !noCache
    ? await readEdgeCacheJson<Record<string, number>>(edgeCacheKey)
    : null;
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

  const queryD1Rows = async (): Promise<any[]> => {
    if (!env.DB) return [];
    try {
      const res = await env.DB.prepare(
        `SELECT author_name, name, type, repo_url, updated_at, created_at, latest_commit_sha FROM packages WHERE status = 'active'`
      ).all();
      return res?.results || [];
    } catch {
      try {
        const fallbackRes = await env.DB.prepare(
          `SELECT author_name, name, type, repo_url, updated_at, created_at FROM packages WHERE status = 'active'`
        ).all();
        return fallbackRes?.results || [];
      } catch {
        return [];
      }
    }
  };

  const [upstreamUpdates, d1Rows] = await Promise.all([
    fetchUpstreamJsonCached<Record<string, number>>(upstreamPath, 300).catch(() => null),
    queryD1Rows()
  ]);

  const merged: Record<string, number> = {};
  const officialUpstreamKeysLower = new Set<string>();
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
        officialUpstreamKeysLower.add(k.toLowerCase());
        const slashIdx = k.indexOf('/');
        if (slashIdx > 0) {
          const canonicalAuthor = k.slice(0, slashIdx);
          const canonicalName = k.slice(slashIdx + 1);
          const authorLower = canonicalAuthor.toLowerCase();
          const baseAuthor = normalizeBaseAuthor(authorLower);
          const pkgName = canonicalName.toLowerCase();
          const safePkgName = pkgName.replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || pkgName;
          officialUpstreamKeysLower.add(`${authorLower}/${safePkgName}`);
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

    const releaseId = computeLuantiClientReleaseId(
      { updated_at: row.updated_at, created_at: row.created_at },
      Number(matchedUpstream?.rel) > 0 ? Number(matchedUpstream!.rel) : undefined
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
      if (Number(matchedUpstream?.rel) > 0) {
        officialUpstreamKeysLower.add(key.toLowerCase());
      }
      if (!merged[key] || Number(merged[key]) <= 0 || (!matchedUpstream && releaseId > Number(merged[key]))) {
        merged[key] = releaseId;
      }
    }
  }

  await overlayJam2026UpdatesMap(merged, noCache, env.DB, d1Rows, officialUpstreamKeysLower).catch(() => {});

  if (!noCache) {
    await writeEdgeCacheJson(edgeCacheKey, merged, 300);
  }

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': !noCache
        ? 'public, max-age=120, s-maxage=300, stale-while-revalidate=600'
        : 'no-cache, no-store, must-revalidate',
      'X-LuantiHub-Cache': !noCache ? 'MISS-EDGE' : 'BYPASS'
    }
  });
}

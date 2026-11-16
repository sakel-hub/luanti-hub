/**
 * TEMPORARY LUANTI GAME JAM 2026 ENDPOINT
 *
 * Proxies and caches `https://jam.greenxenith.com/api/brews` for LuantiHub's client fallback
 * because `jam.greenxenith.com` enforces an `Origin` check (`Origin === https://jam.luanti.org`)
 * when an `Origin` header is present (browser CORS requests).
 *
 * Safe to delete after the 2026 Game Jam concludes.
 */

import { fetchJam2026BrewsCached } from './lib/jam-2026';
import { shouldHonorAuthenticatedNoCache } from './auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

export async function onRequestGet(context: { request?: Request; env?: Env }): Promise<Response> {
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const requestedNoCache = reqUrl?.searchParams.get('nocache') === '1';
  const noCache = requestedNoCache
    ? await shouldHonorAuthenticatedNoCache(context.request, context.env?.SESSION_SECRET, 'jam-2026')
    : false;

  const rawBrews = await fetchJam2026BrewsCached(noCache);
  let brews = rawBrews;

  if (context.env?.DB && Array.isArray(rawBrews) && rawBrews.length > 0) {
    try {
      const sample = rawBrews.slice(0, 60);
      const lowerIds = sample.map(b => String(b.id || '').toLowerCase()).filter(Boolean);
      const lowerRepos = sample.map(b => String(b.repo_url || '').trim().toLowerCase()).filter(Boolean);
      const idPh = lowerIds.map(() => '?').join(', ');
      const repoPh = lowerRepos.map(() => '?').join(', ');
      const whereParts: string[] = [];
      const bindArgs: string[] = [];
      if (lowerIds.length > 0) {
        whereParts.push(`LOWER(id) IN (${idPh})`);
        bindArgs.push(...lowerIds);
      }
      if (lowerRepos.length > 0) {
        whereParts.push(`LOWER(repo_url) IN (${repoPh})`);
        bindArgs.push(...lowerRepos);
      }
      if (whereParts.length > 0) {
        const res = await context.env.DB.prepare(
          `SELECT LOWER(id) as lower_id, LOWER(repo_url) as lower_repo, license, media_license, min_minetest_version
           FROM packages
           WHERE status = 'active' AND (${whereParts.join(' OR ')})`
        )
          .bind(...bindArgs)
          .all();
        const byId = new Map<string, any>();
        const byRepo = new Map<string, any>();
        for (const r of res?.results || []) {
          if (r?.lower_id) byId.set(String(r.lower_id).toLowerCase(), r);
          if (r?.lower_repo) byRepo.set(String(r.lower_repo).toLowerCase(), r);
        }
        if (byId.size > 0 || byRepo.size > 0) {
          brews = rawBrews.map(b => {
            const match =
              byId.get(String(b.id || '').toLowerCase()) ||
              (b.repo_url ? byRepo.get(String(b.repo_url).trim().toLowerCase()) : undefined);
            if (!match) return b;
            return {
              ...b,
              ...(match.license ? { license: String(match.license) } : {}),
              ...(match.media_license ? { media_license: String(match.media_license) } : {}),
              ...(match.min_minetest_version ? { min_minetest_version: String(match.min_minetest_version) } : {})
            };
          });
        }
      }
    } catch {
      // Non-fatal D1 metadata overlay error
    }
  }

  return new Response(JSON.stringify({ brews }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=300'
    }
  });
}

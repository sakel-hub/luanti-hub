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
  SESSION_SECRET?: string;
}

export async function onRequestGet(context: { request?: Request; env?: Env }): Promise<Response> {
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const requestedNoCache = reqUrl?.searchParams.get('nocache') === '1';
  const noCache = requestedNoCache
    ? await shouldHonorAuthenticatedNoCache(context.request, context.env?.SESSION_SECRET, 'jam-2026')
    : false;

  const brews = await fetchJam2026BrewsCached(noCache);

  return new Response(JSON.stringify({ brews }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=300'
    }
  });
}

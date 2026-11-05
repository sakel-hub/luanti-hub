import {
  LUANTIHUB_CONTENT_WARNINGS,
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from './lib/upstream';

const CONTENT_WARNINGS_CACHE_KEY = '/__unified_content_warnings_v1';

/**
 * GET /api/content_warnings
 * LuantiHub-first canonical Content Warnings registry, optionally complemented with upstream
 * ContentDB `/api/content_warnings/` when online.
 */
export async function onRequestGet(_context?: any) {
  const cached = await readEdgeCacheJson<Array<{ name: string; title: string; description: string }>>(
    CONTENT_WARNINGS_CACHE_KEY
  );
  if (Array.isArray(cached) && cached.length > 0) {
    return new Response(JSON.stringify(cached), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'
      }
    });
  }

  const byName = new Map<string, { name: string; title: string; description: string }>();
  for (const w of LUANTIHUB_CONTENT_WARNINGS) {
    byName.set(w.name.toLowerCase(), { ...w });
  }

  try {
    const cdbWarnings = await fetchUpstreamJsonCached<any[]>('/content_warnings/', 21600);
    if (Array.isArray(cdbWarnings)) {
      for (const w of cdbWarnings) {
        if (!w || typeof w !== 'object') continue;
        const name = String(w.name || '').trim().toLowerCase();
        if (!name || byName.has(name)) continue;
        byName.set(name, {
          name,
          title: String(w.title || name).trim(),
          description: String(w.description || '').trim()
        });
      }
    }
  } catch {
    // Non-fatal: LuantiHub canonical content warnings remain authoritative
  }

  const merged = Array.from(byName.values());
  await writeEdgeCacheJson(CONTENT_WARNINGS_CACHE_KEY, merged, 21600);

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'
    }
  });
}

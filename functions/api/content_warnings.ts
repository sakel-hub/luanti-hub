import {
  LUANTIHUB_CONTENT_WARNINGS,
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  upsertMetadataOptions
} from './lib/upstream';

const CONTENT_WARNINGS_CACHE_KEY = '/__unified_content_warnings_v1';

/**
 * GET /api/content_warnings
 * LuantiHub-first canonical Content Warnings registry backed by D1 `package_metadata_options`,
 * optionally complemented with upstream ContentDB `/api/content_warnings/` when online.
 */
export async function onRequestGet(context?: { request?: Request; env?: { DB?: any } }) {
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

  const db = context?.env?.DB;
  const byName = new Map<string, { name: string; title: string; description: string }>();
  for (const w of LUANTIHUB_CONTENT_WARNINGS) {
    byName.set(w.name.toLowerCase(), { ...w });
  }

  if (db) {
    try {
      const d1Rows = await db
        .prepare(`SELECT name, title, description FROM package_metadata_options WHERE category = 'content_warnings' ORDER BY sort_order ASC`)
        .all()
        .catch(() => null);
      if (Array.isArray(d1Rows?.results)) {
        for (const r of d1Rows.results) {
          const name = String(r?.name || '').trim().toLowerCase();
          if (!name) continue;
          byName.set(name, {
            name,
            title: String(r?.title || name).trim(),
            description: String(r?.description || '').trim()
          });
        }
      }
    } catch {
      // Ignore if table not yet created
    }
  }

  const newlyDiscoveredForD1: Array<{ name: string; title: string; description: string }> = [];
  try {
    const cdbWarnings = await fetchUpstreamJsonCached<any[]>('/content_warnings/', 21600);
    if (Array.isArray(cdbWarnings)) {
      for (const w of cdbWarnings) {
        if (!w || typeof w !== 'object') continue;
        const name = String(w.name || '').trim().toLowerCase();
        if (!name || byName.has(name)) continue;
        const entry = {
          name,
          title: String(w.title || name).trim(),
          description: String(w.description || '').trim()
        };
        byName.set(name, entry);
        newlyDiscoveredForD1.push(entry);
      }
    }
  } catch {
    // Non-fatal: LuantiHub canonical content warnings in D1 remain authoritative
  }

  if (db && newlyDiscoveredForD1.length > 0) {
    await upsertMetadataOptions(db, 'content_warnings', newlyDiscoveredForD1, 'contentdb').catch(() => {});
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

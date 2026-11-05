import {
  LUANTIHUB_ENGINE_VERSIONS,
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from './lib/upstream';

const MINETEST_VERSIONS_CACHE_KEY = '/__unified_minetest_versions_v1';

/**
 * GET /api/minetest_versions
 * LuantiHub-first canonical Luanti / Minetest engine version registry, optionally synced and enriched
 * with upstream ContentDB `/api/minetest_versions/` when online.
 */
export async function onRequestGet(_context?: any) {
  const cached = await readEdgeCacheJson<Array<{ name: string; label?: string; protocol_version: number; is_dev?: boolean }>>(
    MINETEST_VERSIONS_CACHE_KEY
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

  const byProtocolOrName = new Map<string, { name: string; label: string; protocol_version: number; is_dev: boolean }>();
  for (const v of LUANTIHUB_ENGINE_VERSIONS) {
    byProtocolOrName.set(v.name.toLowerCase(), {
      name: v.name,
      label: v.label,
      protocol_version: v.protocol_version,
      is_dev: Boolean(v.is_dev)
    });
  }

  try {
    const cdbVersions = await fetchUpstreamJsonCached<any[]>('/minetest_versions/', 21600);
    if (Array.isArray(cdbVersions)) {
      for (const item of cdbVersions) {
        if (!item || typeof item !== 'object') continue;
        const rawName = String(item.name || '').trim();
        const proto = Number(item.protocol_version) || 0;
        if (!rawName || proto <= 0) continue;
        const normalizedKey = rawName.toLowerCase();
        const matchingFullKey = Array.from(byProtocolOrName.keys()).find(
          k => k === normalizedKey || k.startsWith(`${normalizedKey}.`)
        );
        if (!matchingFullKey) {
          byProtocolOrName.set(normalizedKey, {
            name: rawName,
            label: `Luanti ${rawName}`,
            protocol_version: proto,
            is_dev: Boolean(item.is_dev)
          });
        }
      }
    }
  } catch {
    // Non-fatal: LuantiHub canonical engine versions remain authoritative
  }

  const merged = Array.from(byProtocolOrName.values()).sort(
    (a, b) => b.protocol_version - a.protocol_version || b.name.localeCompare(a.name)
  );

  await writeEdgeCacheJson(MINETEST_VERSIONS_CACHE_KEY, merged, 21600);

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'
    }
  });
}

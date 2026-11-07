import {
  LUANTIHUB_ENGINE_VERSIONS,
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  upsertMetadataOptions
} from './lib/upstream';

const MINETEST_VERSIONS_CACHE_KEY = '/__unified_minetest_versions_v1';

/**
 * GET /api/minetest_versions
 * LuantiHub-first canonical Luanti / Minetest engine version registry backed by D1 `package_metadata_options`,
 * optionally synced and enriched with upstream ContentDB `/api/minetest_versions/` when online.
 */
export async function onRequestGet(context?: { request?: Request; env?: { DB?: any } }) {
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

  const db = context?.env?.DB;
  const byProtocolOrName = new Map<string, { name: string; label: string; protocol_version: number; is_dev: boolean }>();
  for (const v of LUANTIHUB_ENGINE_VERSIONS) {
    byProtocolOrName.set(v.name.toLowerCase(), {
      name: v.name,
      label: v.label,
      protocol_version: v.protocol_version,
      is_dev: Boolean(v.is_dev)
    });
  }

  if (db) {
    try {
      const d1Rows = await db
        .prepare(`SELECT name, title, extra_json FROM package_metadata_options WHERE category = 'engine_versions' ORDER BY sort_order ASC`)
        .all()
        .catch(() => null);
      if (Array.isArray(d1Rows?.results)) {
        for (const r of d1Rows.results) {
          const rawName = String(r?.name || '').trim();
          if (!rawName) continue;
          let extra: any = {};
          if (typeof r?.extra_json === 'string' && r.extra_json.startsWith('{')) {
            try {
              extra = JSON.parse(r.extra_json);
            } catch {
              extra = {};
            }
          }
          const proto = Number(extra?.protocol_version) || 0;
          if (proto > 0) {
            byProtocolOrName.set(rawName.toLowerCase(), {
              name: rawName,
              label: String(r?.title || `Luanti ${rawName}`),
              protocol_version: proto,
              is_dev: Boolean(extra?.is_dev)
            });
          }
        }
      }
    } catch {
      // Ignore if table not yet created
    }
  }

  const newlyDiscoveredForD1: Array<{ name: string; title: string; extra_json: string }> = [];
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
          const label = `Luanti ${rawName}`;
          byProtocolOrName.set(normalizedKey, {
            name: rawName,
            label,
            protocol_version: proto,
            is_dev: Boolean(item.is_dev)
          });
          newlyDiscoveredForD1.push({
            name: rawName,
            title: label,
            extra_json: JSON.stringify({ protocol_version: proto, is_dev: Boolean(item.is_dev) })
          });
        }
      }
    }
  } catch {
    // Non-fatal: LuantiHub canonical engine versions in D1 remain authoritative
  }

  if (db && newlyDiscoveredForD1.length > 0) {
    await upsertMetadataOptions(db, 'engine_versions', newlyDiscoveredForD1, 'contentdb').catch(() => {});
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

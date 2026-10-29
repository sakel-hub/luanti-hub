import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  ensureExtendedPackageColumns
} from '../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  let body: { ids?: string[]; items?: any[] } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const hydratedMap: Record<string, any> = {};

  if (env.DB) {
    await ensureExtendedPackageColumns(env.DB);
  }

  // 1. Batch-persist client-hydrated ContentDB metadata into D1 so future boots serve it at 0ms
  const incomingItems = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
  if (env.DB && incomingItems.length > 0) {
    const statements: any[] = [];
    for (const item of incomingItems) {
      if (!item || !item.author || !item.name) continue;
      const pkgId = String(item.id || `${item.author}/${item.name}`).trim();
      const lic = String(item.license || item.media_license || '').trim();
      const mediaLic = String(item.media_license || item.license || '').trim();
      const cdbDl = Math.max(0, Number(item.contentdb_downloads ?? item.downloads ?? 0) || 0);
      const totalDl = Math.max(cdbDl, Number(item.downloads || 0) || 0);
      if (!lic && cdbDl <= 0) continue;

      const tagsArr = Array.isArray(item.tags)
        ? item.tags.map((t: any) => String(typeof t === 'string' ? t : t?.name || '').trim()).filter(Boolean)
        : [];
      const pkgType = ['mod', 'game', 'txp', 'modpack'].includes(item.type) ? item.type : 'mod';

      statements.push(
        env.DB.prepare(`
          INSERT INTO packages (
            id, author_name, name, title, type, short_desc, repo_url, provider,
            thumbnail_url, banner_url, license, media_license, min_minetest_version,
            tags, status, downloads_count, contentdb_downloads, video_url, video_thumbnail_url, file_size
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'contentdb', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            license = CASE WHEN excluded.license != '' THEN excluded.license ELSE packages.license END,
            media_license = CASE WHEN excluded.media_license != '' THEN excluded.media_license ELSE packages.media_license END,
            min_minetest_version = COALESCE(NULLIF(excluded.min_minetest_version, ''), packages.min_minetest_version),
            tags = COALESCE(excluded.tags, packages.tags),
            contentdb_downloads = MAX(packages.contentdb_downloads, excluded.contentdb_downloads),
            downloads_count = MAX(packages.downloads_count, excluded.downloads_count),
            video_url = COALESCE(excluded.video_url, packages.video_url),
            video_thumbnail_url = COALESCE(excluded.video_thumbnail_url, packages.video_thumbnail_url),
            file_size = COALESCE(excluded.file_size, packages.file_size)
        `).bind(
          pkgId,
          String(item.author).trim(),
          String(item.name).trim(),
          String(item.title || item.name).trim(),
          pkgType,
          item.short_desc ? String(item.short_desc).slice(0, 500) : null,
          item.repo_url ? String(item.repo_url).trim() : '',
          item.thumbnail && item.thumbnail !== 'logo.svg' ? String(item.thumbnail) : null,
          item.banner && item.banner !== 'logo.svg' ? String(item.banner) : null,
          lic,
          mediaLic,
          item.min_minetest_version ? String(item.min_minetest_version).trim() : '5.0.0',
          tagsArr.length > 0 ? JSON.stringify(tagsArr) : null,
          totalDl,
          cdbDl,
          item.video_url ? String(item.video_url) : null,
          item.video_thumbnail_url ? String(item.video_thumbnail_url) : null,
          item.file_size ? String(item.file_size) : null
        )
      );
    }

    if (statements.length > 0) {
      try {
        if (typeof env.DB.batch === 'function') {
          await env.DB.batch(statements);
        } else {
          for (const stmt of statements) {
            await stmt.run().catch(() => {});
          }
        }
      } catch {
        // Non-fatal batch persistence error
      }
    }
  }

  // 2. Resolve any requested package IDs in batch (D1 lookup + upstream edge cache fallback)
  const rawIds = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.map(id => String(id || '').trim()).filter(id => id.includes('/')))).slice(0, 32)
    : [];

  if (rawIds.length > 0) {
    const missingIds = new Set<string>(rawIds.map(id => id.toLowerCase()));

    if (env.DB) {
      try {
        const placeholders = rawIds.map(() => '?').join(', ');
        const lowerParams = rawIds.map(id => id.toLowerCase());
        const d1Res = await env.DB.prepare(
          `SELECT * FROM packages WHERE LOWER(id) IN (${placeholders}) AND status = 'active'`
        ).bind(...lowerParams).all();

        for (const row of (d1Res?.results || [])) {
          if (!row?.id) continue;
          const lowerKey = String(row.id).toLowerCase();
          const parsedTags = parseJsonArray(row.tags);
          const hasRealTags = parsedTags.some(
            (t: string) => !['mod', 'game', 'txp', 'texture_pack'].includes(t.toLowerCase())
          );
          const cdbDl = Number(row.contentdb_downloads || 0);
          const lhDl = Number(row.luantihub_downloads || 0);
          const totalDl = Math.max(Number(row.downloads_count || 0), cdbDl + lhDl);

          hydratedMap[lowerKey] = {
            id: row.id,
            license: row.license || row.media_license || '',
            media_license: row.media_license || row.license || '',
            min_minetest_version: row.min_minetest_version || '5.0.0',
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            tags: parsedTags.length > 0 ? parsedTags : undefined,
            file_size: row.file_size || undefined,
            video_url: row.video_url || undefined,
            video_thumbnail_url: row.video_thumbnail_url || undefined,
            repo_url: row.repo_url || undefined
          };

          if (row.license && (cdbDl > 0 || row.provider !== 'contentdb') && hasRealTags) {
            missingIds.delete(lowerKey);
          }
        }
      } catch {
        // Proceed to upstream hydration
      }
    }

    const toFetchUpstream = rawIds.filter(id => missingIds.has(id.toLowerCase())).slice(0, 16);
    if (toFetchUpstream.length > 0) {
      await Promise.all(
        toFetchUpstream.map(async (rawId) => {
          const [author, name] = rawId.split('/');
          if (!author || !name) return;
          const lowerKey = rawId.toLowerCase();
          const detail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
            3600
          ).catch(() => null);
          if (!detail) return;

          const existing = hydratedMap[lowerKey] || {};
          const lic = detail.license || detail.media_license || existing.license || '';
          const mediaLic = detail.media_license || detail.license || existing.media_license || '';
          const detailTags = Array.isArray(detail.tags)
            ? detail.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
            : (existing.tags || []);
          const cdbDl = Math.max(Number(existing.contentdb_downloads || 0), Number(detail.downloads || 0));
          const lhDl = Number(existing.luantihub_downloads || 0);
          const totalDl = Math.max(Number(existing.downloads || 0), cdbDl + lhDl);
          const minVer = detail.min_minetest_version || existing.min_minetest_version || '5.0.0';

          hydratedMap[lowerKey] = {
            id: `${detail.author || author}/${detail.name || name}`,
            license: lic,
            media_license: mediaLic,
            min_minetest_version: minVer,
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            tags: detailTags.length > 0 ? detailTags : undefined,
            download_size: typeof detail.download_size === 'number' ? detail.download_size : undefined,
            video_url: detail.video_url || existing.video_url || undefined,
            video_thumbnail_url: detail.video_thumbnail_url || existing.video_thumbnail_url || undefined,
            repo_url: detail.repo || detail.repo_url || existing.repo_url || undefined
          };
        })
      );
    }
  }

  return Response.json({
    success: true,
    hydrated: hydratedMap
  });
}

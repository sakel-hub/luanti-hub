import { fetchUpstreamJsonCached } from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequest(context: { params: { author: string; name: string }; request: Request; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;
  const { env, request } = context;

  // 1. Instant Kill Switch Check in Cloudflare D1
  if (env.DB) {
    try {
      const pkgRecord = await env.DB.prepare(
        `SELECT status, status_reason FROM packages WHERE LOWER(id) = LOWER(?)`
      ).bind(packageId).first();

      if (pkgRecord && (pkgRecord.status === 'flagged' || pkgRecord.status === 'delisted')) {
        return new Response(JSON.stringify({
          error: 'Download blocked: This package has been delisted or suspended.',
          status: pkgRecord.status,
          reason: pkgRecord.status_reason || 'Policy / DMCA Takedown'
        }), {
          status: 451,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch {
      // Proceed if table not migrated yet
    }

    // 2. Atomically record download in Cloudflare D1
    try {
      await env.DB.prepare(`
        INSERT INTO package_daily_downloads (package_id, download_date, downloads_count)
        VALUES (?, DATE('now'), 1)
        ON CONFLICT(package_id, download_date)
        DO UPDATE SET downloads_count = downloads_count + 1
      `).bind(packageId).run();

      await env.DB.prepare(`
        UPDATE packages
        SET downloads_count = downloads_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE LOWER(id) = LOWER(?)
      `).bind(packageId).run();
    } catch (err) {
      console.warn('D1 download tracking error:', err);
    }
  }

  // 3. If it is a background telemetry POST ping
  if (request.method === 'POST') {
    return new Response(JSON.stringify({
      success: true,
      package_id: packageId,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
      }
    });
  }

  // 4. Resolve Out-of-the-Box Ready-to-Drop .zip Release Archive URL
  // Default ContentDB direct .zip endpoint (automatically redirects to the latest <name>.zip archive)
  let targetZipUrl = `https://content.luanti.org/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download/`;

  // Check D1 releases first (for decentralized Git packages)
  if (env.DB) {
    try {
      const latestRelease = await env.DB.prepare(
        `SELECT download_url FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY released_at DESC LIMIT 1`
      ).bind(packageId).first();

      if (latestRelease && latestRelease.download_url) {
        targetZipUrl = latestRelease.download_url;
        return Response.redirect(targetZipUrl, 302);
      }
    } catch {
      // Fallback to ContentDB release lookup
    }
  }

  // Resolve exact latest release .zip URL from ContentDB API if available
  try {
    const releases = await fetchUpstreamJsonCached<any[]>(
      `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/`,
      300
    );
    if (Array.isArray(releases) && releases.length > 0 && releases[0]) {
      const first = releases[0];
      if (first.url) {
        targetZipUrl = first.url.startsWith('http')
          ? first.url
          : `https://content.luanti.org${first.url}`;
      } else if (first.id) {
        targetZipUrl = `https://content.luanti.org/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/${first.id}/download/`;
      }
    }
  } catch {
    // Keep default ContentDB /download/ URL
  }

  return Response.redirect(targetZipUrl, 302);
}

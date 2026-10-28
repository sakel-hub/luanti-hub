interface Env {
  DB?: any;
}

export async function onRequest(context: { params: { author: string; name: string }; request: Request; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;
  const { env, request } = context;

  // 1. Atomically record download in Cloudflare D1
  if (env.DB) {
    try {
      // Upsert daily download counter for today
      await env.DB.prepare(`
        INSERT INTO package_daily_downloads (package_id, download_date, downloads_count)
        VALUES (?, DATE('now'), 1)
        ON CONFLICT(package_id, download_date) 
        DO UPDATE SET downloads_count = downloads_count + 1
      `).bind(packageId).run();

      // Also increment cumulative lifetime downloads on packages table if present
      await env.DB.prepare(`
        UPDATE packages 
        SET downloads_count = downloads_count + 1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(packageId).run();
    } catch (err) {
      console.warn('D1 download tracking error:', err);
    }
  }

  // 2. If it is an API ping or beacon from the frontend Web UI
  if (request.method === 'POST' || request.headers.get('Accept')?.includes('application/json')) {
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

  // 3. For in-game clients or direct browser download links: resolve target release archive URL
  let targetUrl = `https://content.luanti.org/packages/${author}/${name}/releases/latest/download/`;

  if (env.DB) {
    try {
      const latestRelease = await env.DB.prepare(
        `SELECT download_url FROM releases WHERE package_id = ? ORDER BY released_at DESC LIMIT 1`
      ).bind(packageId).first();

      if (latestRelease && latestRelease.download_url) {
        targetUrl = latestRelease.download_url;
      }
    } catch {
      // Fallback kept
    }
  }

  return Response.redirect(targetUrl, 302);
}

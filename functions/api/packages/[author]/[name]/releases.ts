import { fetchUpstreamJsonCached } from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Check D1 Kill Switch & local D1 releases
  if (context.env.DB) {
    const pkgStatus = await context.env.DB.prepare(
      `SELECT status FROM packages WHERE LOWER(id) = LOWER(?)`
    ).bind(packageId).first();

    if (pkgStatus && (pkgStatus.status === 'flagged' || pkgStatus.status === 'delisted')) {
      return Response.json({ error: 'Package is delisted or suspended.' }, { status: 451 });
    }

    const releases = await context.env.DB.prepare(
      `SELECT * FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY released_at DESC`
    ).bind(packageId).all();

    if (releases.results && releases.results.length > 0) {
      return new Response(JSON.stringify(releases.results.map((r: any) => ({
        id: r.id,
        version: r.version,
        title: r.tag_name || r.version,
        tag_name: r.tag_name || r.version,
        commit_sha: r.commit_sha,
        url: r.download_url,
        download_url: r.download_url,
        min_minetest_version: r.min_minetest_version,
        max_minetest_version: r.max_minetest_version,
        changelog: r.changelog,
        release_date: r.released_at,
        released_at: r.released_at
      }))), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  // 2. Fallback to upstream ContentDB / milcho.org
  const data = await fetchUpstreamJsonCached<any[]>(
    `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/`,
    300
  );

  if (Array.isArray(data) && data.length > 0) {
    const normalized = data.map((r: any) => {
      const rawUrl = r.url || '';
      const fullDownloadUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl
          ? `https://content.luanti.org${rawUrl}`
          : `https://content.luanti.org/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/${r.id}/download/`;

      return {
        id: r.id,
        version: String(r.title || r.id || 'latest'),
        title: String(r.title || r.id || 'Release'),
        tag_name: String(r.title || r.id || 'latest'),
        commit_sha: r.commit || '',
        url: fullDownloadUrl,
        download_url: fullDownloadUrl,
        size: r.size || r.file_size || undefined,
        min_minetest_version: r.min_minetest_version || r.min_protocol_version || undefined,
        max_minetest_version: r.max_minetest_version || r.max_protocol_version || undefined,
        released_at: r.release_date || new Date().toISOString()
      };
    });

    return new Response(JSON.stringify(normalized), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, s-maxage=600'
      }
    });
  }

  // 3. Fallback: Discover Releases / Tags from GitHub or Codeberg API
  const ghHeaders = {
    'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)',
    'Accept': 'application/vnd.github+json'
  };

  try {
    const relRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases?per_page=10`, {
      headers: ghHeaders
    });
    if (relRes.ok) {
      const ghReleases = await relRes.json() as any[];
      if (Array.isArray(ghReleases) && ghReleases.length > 0) {
        const mapped = ghReleases.map((r: any, idx: number) => ({
          id: r.id || idx + 1,
          version: r.name || r.tag_name || `Release #${idx + 1}`,
          title: r.name || r.tag_name || `Release #${idx + 1}`,
          tag_name: r.tag_name || '',
          commit_sha: r.target_commitish || '',
          url: `https://github.com/${author}/${name}/archive/refs/tags/${encodeURIComponent(r.tag_name)}.zip`,
          download_url: `https://github.com/${author}/${name}/archive/refs/tags/${encodeURIComponent(r.tag_name)}.zip`,
          released_at: r.published_at || r.created_at || new Date().toISOString()
        }));
        return new Response(JSON.stringify(mapped), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300, s-maxage=600'
          }
        });
      }
    }

    const tagsRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(author)}/${encodeURIComponent(name)}/tags?per_page=10`, {
      headers: ghHeaders
    });
    if (tagsRes.ok) {
      const ghTags = await tagsRes.json() as any[];
      if (Array.isArray(ghTags) && ghTags.length > 0) {
        const mapped = ghTags.map((t: any, idx: number) => ({
          id: idx + 1,
          version: t.name,
          title: t.name,
          tag_name: t.name,
          commit_sha: t.commit?.sha || '',
          url: `https://github.com/${author}/${name}/archive/refs/tags/${encodeURIComponent(t.name)}.zip`,
          download_url: `https://github.com/${author}/${name}/archive/refs/tags/${encodeURIComponent(t.name)}.zip`,
          released_at: ''
        }));
        return new Response(JSON.stringify(mapped), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=300, s-maxage=600'
          }
        });
      }
    }
  } catch {
    // Ignore GitHub discovery error
  }

  return Response.json([], { headers: { 'Access-Control-Allow-Origin': '*' } });
}

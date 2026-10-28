import { fetchWithFailover } from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Check local D1 releases
  if (context.env.DB) {
    const releases = await context.env.DB.prepare(
      `SELECT * FROM releases WHERE package_id = ? ORDER BY released_at DESC`
    ).bind(packageId).all();

    if (releases.results && releases.results.length > 0) {
      return new Response(JSON.stringify(releases.results.map((r: any) => ({
        id: r.id,
        version: r.version,
        title: r.tag_name,
        commit: r.commit_sha,
        url: r.download_url,
        min_minetest_version: r.min_minetest_version,
        max_minetest_version: r.max_minetest_version,
        release_date: r.released_at
      }))), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  // 2. Fallback to upstream ContentDB / milcho.org
  const upstreamRes = await fetchWithFailover(`/packages/${author}/${name}/releases/`);
  const data = await upstreamRes.json();

  return new Response(JSON.stringify(data), {
    status: upstreamRes.status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

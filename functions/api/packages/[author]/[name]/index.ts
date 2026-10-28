import { fetchWithFailover } from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;

  // 1. Check local D1 first
  if (context.env.DB) {
    const pkg = await context.env.DB.prepare(
      `SELECT * FROM packages WHERE author_name = ? AND name = ? AND status = 'active'`
    ).bind(author, name).first();

    if (pkg) {
      return new Response(JSON.stringify({
        author: pkg.author_name,
        name: pkg.name,
        title: pkg.title,
        type: pkg.type,
        short_desc: pkg.short_desc,
        desc: pkg.long_desc || pkg.short_desc,
        thumbnail: pkg.thumbnail_url,
        license: pkg.license,
        media_license: pkg.media_license,
        score: pkg.score,
        downloads: pkg.downloads_count,
        repo_url: pkg.repo_url,
        source: 'git'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  // 2. Fallback to upstream ContentDB / milcho.org
  const upstreamRes = await fetchWithFailover(`/packages/${author}/${name}/`);
  const data = await upstreamRes.json();

  return new Response(JSON.stringify(data), {
    status: upstreamRes.status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

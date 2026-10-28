import { fetchWithFailover } from '../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const type = url.searchParams.get('type') || '';
  const author = url.searchParams.get('author') || '';

  const upstreamPath = `/packages/${url.search}`;

  // 1. Fetch Upstream Packages (with failover to milcho.org)
  const upstreamPromise = fetchWithFailover(upstreamPath)
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);

  // 2. Fetch Decentralized Packages from Cloudflare D1 (if database bound)
  let d1Promise = Promise.resolve([]);
  if (env.DB) {
    let query = `SELECT * FROM packages WHERE status = 'active'`;
    const params: any[] = [];

    if (type && type !== 'all') {
      query += ` AND type = ?`;
      params.push(type);
    }
    if (q) {
      query += ` AND (title LIKE ? OR name LIKE ? OR short_desc LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (author) {
      query += ` AND author_name = ?`;
      params.push(author);
    }

    query += ` ORDER BY downloads_count DESC LIMIT 50`;

    d1Promise = env.DB.prepare(query).bind(...params).all()
      .then((res: any) => res.results || [])
      .catch(() => []);
  }

  const [upstreamList, d1List] = await Promise.all([upstreamPromise, d1Promise]);

  // 3. Format D1 packages into standard ContentDB package schema for Luanti in-game client
  const formattedD1 = d1List.map((p: any) => ({
    author: p.author_name,
    name: p.name,
    title: p.title,
    type: p.type,
    short_desc: p.short_desc,
    thumbnail: p.thumbnail_url,
    score: p.score || 5.0,
    downloads: p.downloads_count || 0,
    url: `/api/packages/${p.author_name}/${p.name}/`,
    source: 'git'
  }));

  // 4. Merge results (D1 community Git mods first, then upstream ContentDB)
  const merged = [...formattedD1, ...(Array.isArray(upstreamList) ? upstreamList : [])];

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60, s-maxage=300'
    }
  });
}

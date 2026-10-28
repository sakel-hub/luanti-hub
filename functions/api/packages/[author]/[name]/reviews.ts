import { fetchWithFailover } from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Fetch Official ContentDB Reviews (with failover)
  const officialPromise = fetchWithFailover(`/packages/${author}/${name}/reviews/`)
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);

  // 2. Fetch Native LuantiHub Community Comments from Cloudflare D1
  let localPromise = Promise.resolve([]);
  if (context.env.DB) {
    localPromise = context.env.DB.prepare(`
      SELECT r.id, r.rating, r.title, r.comment, r.created_at,
             u.username, u.display_name, u.avatar_url
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.package_id = ?
      ORDER BY r.created_at DESC
    `).bind(packageId).all()
      .then((res: any) => res.results || [])
      .catch(() => []);
  }

  const [officialReviews, localReviews] = await Promise.all([officialPromise, localPromise]);

  // 3. Normalize ContentDB Reviews
  const normalizedOfficial = (Array.isArray(officialReviews) ? officialReviews : []).map((r: any) => ({
    id: `cdb_${r.id || Math.random()}`,
    source: 'contentdb',
    rating: r.rating || 5,
    title: r.title,
    comment: r.comment,
    created_at: r.created_at,
    author: {
      username: r.user?.username || 'contentdb_user',
      display_name: r.user?.display_name || r.user?.username,
      avatar_url: `https://github.com/${r.user?.username || 'octocat'}.png`
    }
  }));

  // 4. Normalize LuantiHub Local Reviews
  const normalizedLocal = localReviews.map((r: any) => ({
    id: `lh_${r.id}`,
    source: 'luantihub',
    rating: r.rating || 5,
    title: r.title,
    comment: r.comment,
    created_at: r.created_at,
    author: {
      username: r.username,
      display_name: r.display_name || r.username,
      avatar_url: r.avatar_url || `https://github.com/${r.username}.png`
    }
  }));

  // 5. Merge and sort chronologically (newest first)
  const allReviews = [...normalizedLocal, ...normalizedOfficial].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return new Response(JSON.stringify(allReviews), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

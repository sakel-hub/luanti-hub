import { fetchWithFailover, invalidateEdgeCacheKeys } from '../../../lib/upstream';
import { verifySessionToken, parseCookies } from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

// GET: Mixed Reviews (ContentDB + LuantiHub Native)
export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Fetch Official ContentDB Reviews (with failover)
  const officialPromise = fetchWithFailover(`/packages/${author}/${name}/reviews/`)
    .then(r => r.ok ? r.json() : [])
    .catch(() => []);

  // 2. Fetch Native LuantiHub Community Comments from Cloudflare D1 (case-insensitive package_id match)
  let localPromise = Promise.resolve([]);
  if (context.env.DB) {
    localPromise = context.env.DB.prepare(`
      SELECT r.id, r.rating, r.title, r.comment, r.created_at,
             u.username, u.display_name, u.avatar_url
      FROM reviews r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE LOWER(r.package_id) = LOWER(?)
      ORDER BY r.created_at DESC
    `).bind(packageId).all()
      .then((res: any) => res.results || [])
      .catch(() => []);
  }

  const [officialReviews, localReviews] = await Promise.all([officialPromise, localPromise]);

  // 3. Normalize ContentDB Reviews (recommends: true = 5★, neutral = 3★, false = 1★)
  const normalizedOfficial = (Array.isArray(officialReviews) ? officialReviews : []).map((r: any) => ({
    id: `cdb_${r.id || Math.random()}`,
    source: 'contentdb',
    rating: r.rating ? Math.min(5, Math.max(1, Number(r.rating))) : (r.recommends === false ? 1 : r.recommends === true ? 5 : 3),
    title: r.title,
    comment: r.comment || r.text || '',
    created_at: r.created_at,
    author: {
      username: r.author || r.user?.username || 'contentdb_user',
      display_name: r.author || r.user?.display_name || r.user?.username || 'Community Member',
      avatar_url: `https://github.com/${r.author || r.user?.username || 'octocat'}.png`
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

// POST: Submit a Community Review & Star Rating
export async function onRequestPost(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Verify User Authentication
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Please log in to leave a review.' }, { status: 401 });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const { rating, title, comment } = await context.request.json() as any;
  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5 || !comment?.trim()) {
    return Response.json({ error: 'Rating (1-5) and comment are required.' }, { status: 400 });
  }

  if (context.env.DB) {
    // 1b. Prevent package authors from rating or commenting on their own packages
    const [userRow, identitiesRes, pkgRow] = await Promise.all([
      context.env.DB.prepare(`SELECT id, username FROM users WHERE id = ?`).bind(userId).first(),
      context.env.DB.prepare(`SELECT provider_username FROM user_identities WHERE user_id = ?`).bind(userId).all().catch(() => ({ results: [] })),
      context.env.DB.prepare(`SELECT author_id, author_name, repo_url FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`).bind(packageId, author, name).first()
    ]);

    const userHandles = new Set<string>();
    if (userRow?.username) userHandles.add(String(userRow.username).toLowerCase());
    for (const ident of identitiesRes?.results || []) {
      if (ident?.provider_username) userHandles.add(String(ident.provider_username).toLowerCase());
    }

    let repoOwner = '';
    if (pkgRow?.repo_url) {
      try {
        const parts = new URL(pkgRow.repo_url).pathname.split('/').filter(Boolean);
        if (parts.length >= 2) repoOwner = parts[0].toLowerCase();
      } catch {
        // Ignore invalid URL
      }
    }

    const isPackageAuthor =
      (pkgRow?.author_id && String(pkgRow.author_id) === String(userId)) ||
      userHandles.has(author.toLowerCase()) ||
      (pkgRow?.author_name && userHandles.has(String(pkgRow.author_name).toLowerCase())) ||
      (repoOwner && userHandles.has(repoOwner));

    if (isPackageAuthor) {
      return Response.json(
        { error: 'Authors cannot rate or review their own packages.' },
        { status: 403 }
      );
    }

    // 2. Insert or Update User's Review in D1
    await context.env.DB.prepare(`
      INSERT INTO reviews (package_id, user_id, rating, title, comment)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(package_id, user_id) DO UPDATE SET
        rating = excluded.rating,
        title = excluded.title,
        comment = excluded.comment,
        created_at = CURRENT_TIMESTAMP
    `).bind(packageId, userId, numericRating, title || null, comment.trim()).run();

    // 3. Recalculate Average Package Score
    const avgResult = await context.env.DB.prepare(`
      SELECT AVG(rating) as avg_score, COUNT(*) as total_reviews
      FROM reviews WHERE LOWER(package_id) = LOWER(?)
    `).bind(packageId).first();

    if (avgResult && avgResult.avg_score) {
      const roundedScore = Math.round(avgResult.avg_score * 10) / 10;
      await context.env.DB.prepare(`
        UPDATE packages SET score = ? WHERE LOWER(id) = LOWER(?)
      `).bind(roundedScore, packageId).run();
    }
  }

  await invalidateEdgeCacheKeys([
    '/__api_packages_v2',
    '/__api_packages_v2?boot=1',
    `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
  ]);

  return Response.json({
    success: true,
    review: {
      id: `lh_${Date.now()}`,
      source: 'luantihub',
      rating: numericRating,
      title,
      comment: comment.trim(),
      created_at: new Date().toISOString()
    }
  });
}

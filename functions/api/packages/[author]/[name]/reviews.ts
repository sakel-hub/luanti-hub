import {
  fetchWithFailover,
  invalidateEdgeCacheKeys,
  ensureModerationColumns
} from '../../../lib/upstream';
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount
} from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

// GET: Mixed Reviews (ContentDB + LuantiHub Native)
export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Fetch Official ContentDB Reviews (with failover)
  const officialPromise = fetchWithFailover(`/packages/${author}/${name}/reviews/`)
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);

  // 2. Fetch Native LuantiHub Community Comments from Cloudflare D1 (case-insensitive package_id match)
  let localPromise = Promise.resolve([]);
  if (context.env.DB) {
    localPromise = context.env.DB.prepare(`
      SELECT r.id, r.user_id, r.rating, r.title, r.comment, r.created_at,
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
    package_id: packageId,
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
    package_id: packageId,
    source: 'luantihub',
    rating: r.rating || 5,
    title: r.title,
    comment: r.comment,
    created_at: r.created_at,
    author: {
      username: r.username || 'community_user',
      display_name: r.display_name || r.username || 'Community Member',
      avatar_url: r.avatar_url || `https://github.com/${r.username || 'octocat'}.png`
    }
  }));

  // 5. Merge and sort chronologically (newest first)
  const allReviews = [...normalizedLocal, ...normalizedOfficial].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  return new Response(JSON.stringify(allReviews), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

async function recalculateAndPersistPackageScore(db: any, packageId: string): Promise<number> {
  if (!db) return 0;
  const avgResult = await db.prepare(`
    SELECT AVG(rating) as avg_score, COUNT(*) as total_reviews
    FROM reviews WHERE LOWER(package_id) = LOWER(?)
  `).bind(packageId).first().catch(() => null);

  const count = Number(avgResult?.total_reviews || 0);
  const roundedScore = count > 0 && avgResult?.avg_score != null
    ? Math.round(Number(avgResult.avg_score) * 10) / 10
    : 0;

  const parts = String(packageId).split('/');
  const authorPart = parts[0] || '';
  const namePart = parts[1] || '';

  await db.prepare(`
    UPDATE packages SET score = ?
    WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?))
  `).bind(roundedScore, packageId, authorPart, namePart).run().catch(() => {});

  return roundedScore;
}

// POST: Submit a Community Review, Flag an Inappropriate Comment, or Remove a Comment (Admin/Author)
export async function onRequestPost(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  // 1. Verify User Authentication
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Please log in to continue.' }, { status: 401 });
  }

  const rawUserId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!rawUserId) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const body = (await context.request.json().catch(() => ({}))) as any;
  const action = String(body.action || 'create').toLowerCase();

  let userId = String(rawUserId);
  let reconciledUser: any = null;
  let identities: Array<{ provider: string; username: string; verified: boolean }> = [];

  if (context.env.DB) {
    reconciledUser = await reconcileAndMergeUserAccount(context.env.DB, rawUserId);
    if (reconciledUser?.id) {
      userId = String(reconciledUser.id);
    }
    const identitiesRes = await context.env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(userId).all().catch(() => ({ results: [] }));
    identities = (identitiesRes.results || []).map((id: any) => ({
      provider: String(id.provider || '').toLowerCase(),
      username: String(id.username || ''),
      verified: Boolean(id.verified)
    }));
  }

  const isAdmin = checkIsAdmin(reconciledUser, identities, context.env.ADMIN_USERS);

  // Action A: Flag / Report an inappropriate comment/review to the Moderation Queue
  if (action === 'flag') {
    const rawReviewId = String(body.reviewId || '').trim();
    const cleanNumericId = Number(rawReviewId.replace(/^lh_/i, ''));
    const flagDetails = String(body.details || 'Flagged as inappropriate community comment.').trim().slice(0, 800);
    if (!rawReviewId) {
      return Response.json({ error: 'Review ID is required to flag a comment.' }, { status: 400 });
    }

    if (context.env.DB) {
      await ensureModerationColumns(context.env.DB);
      let reviewExcerpt = '';
      let reviewAuthorHandle = 'user';
      if (Number.isFinite(cleanNumericId) && cleanNumericId > 0) {
        const revRow = await context.env.DB.prepare(`
          SELECT r.id, r.comment, r.title, u.username
          FROM reviews r
          LEFT JOIN users u ON r.user_id = u.id
          WHERE r.id = ? AND LOWER(r.package_id) = LOWER(?)
          LIMIT 1
        `).bind(cleanNumericId, packageId).first().catch(() => null);
        if (revRow) {
          reviewExcerpt = String(revRow.comment || '').slice(0, 240);
          reviewAuthorHandle = String(revRow.username || 'user');
        }
      }

      const reportMessage = reviewExcerpt
        ? `[Flagged Review #${cleanNumericId || rawReviewId} by @${reviewAuthorHandle}]: "${reviewExcerpt}" — ${flagDetails}`
        : `[Flagged Review ${rawReviewId}]: ${flagDetails}`;

      await context.env.DB.prepare(`
        INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status)
        VALUES (?, ?, 'inappropriate', ?, 'open')
      `).bind(packageId, userId, reportMessage).run();
    }

    return Response.json({
      success: true,
      message: 'Comment flagged for moderator review.'
    });
  }

  // Action B: Delete / Remove a Review (Admin/Moderator or the Review Author)
  if (action === 'delete' || action === 'remove') {
    const rawReviewId = String(body.reviewId || '').trim();
    const numericId = Number(rawReviewId.replace(/^lh_/i, ''));
    if (!Number.isFinite(numericId) || numericId <= 0) {
      return Response.json({ error: 'Valid LuantiHub review ID is required.' }, { status: 400 });
    }

    if (!context.env.DB) {
      return Response.json({ error: 'Database unavailable.' }, { status: 503 });
    }

    const revRow = await context.env.DB.prepare(`
      SELECT id, user_id, package_id FROM reviews WHERE id = ? AND LOWER(package_id) = LOWER(?) LIMIT 1
    `).bind(numericId, packageId).first();

    if (!revRow) {
      return Response.json({ error: 'Review not found.' }, { status: 404 });
    }

    const isReviewOwner = String(revRow.user_id) === userId;
    if (!isAdmin && !isReviewOwner) {
      return Response.json({ error: 'Only an administrator or the review author can remove this comment.' }, { status: 403 });
    }

    await context.env.DB.prepare(`DELETE FROM reviews WHERE id = ?`).bind(numericId).run();
    const newScore = await recalculateAndPersistPackageScore(context.env.DB, revRow.package_id || packageId);

    // Auto-resolve any open moderation reports for this flagged review
    await ensureModerationColumns(context.env.DB);
    await context.env.DB.prepare(`
      UPDATE moderation_reports
      SET status = 'resolved',
          resolved_by = ?,
          resolution_note = ?,
          resolved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(package_id) = LOWER(?)
        AND status = 'open'
        AND details LIKE ?
    `).bind(
      reconciledUser?.username || userId,
      `Flagged review #${numericId} was removed by ${isAdmin ? 'moderator' : 'author'}.`,
      packageId,
      `%Review #${numericId}%`
    ).run().catch(() => {});

    await invalidateEdgeCacheKeys([
      '/__api_packages_v2',
      '/__api_packages_v2?boot=1',
      `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
    ]);

    return Response.json({
      success: true,
      removedId: `lh_${numericId}`,
      score: newScore,
      message: 'Review removed.'
    });
  }

  // Action C: Create / Update a Community Review & Star Rating
  const { rating, title, comment } = body;
  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5 || !comment?.trim()) {
    return Response.json({ error: 'Rating (1-5) and comment are required.' }, { status: 400 });
  }

  let savedReviewId = `lh_${Date.now()}`;
  let authorUsername = reconciledUser?.username || 'community_user';
  let authorDisplayName = reconciledUser?.display_name || authorUsername;
  let authorAvatarUrl = reconciledUser?.avatar_url || `https://github.com/${authorUsername}.png`;

  if (context.env.DB) {
    const [userRow, pkgRow] = await Promise.all([
      reconciledUser
        ? Promise.resolve(reconciledUser)
        : context.env.DB.prepare(`SELECT id, username, display_name, avatar_url FROM users WHERE id = ?`).bind(userId).first(),
      context.env.DB.prepare(
        `SELECT id, author_id, author_name, repo_url FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      ).bind(packageId, author, name).first()
    ]);

    if (userRow) {
      authorUsername = userRow.username || authorUsername;
      authorDisplayName = userRow.display_name || authorUsername;
      authorAvatarUrl = userRow.avatar_url || `https://github.com/${authorUsername}.png`;
    } else {
      // Ensure user row exists in D1 so FOREIGN KEY (user_id) REFERENCES users(id) never fails
      await context.env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, username, display_name, avatar_url) VALUES (?, ?, ?, ?)`
      ).bind(userId, authorUsername, authorDisplayName, authorAvatarUrl).run().catch(() => {});
    }

    const userHandles = new Set<string>();
    if (userRow?.username) userHandles.add(String(userRow.username).toLowerCase());
    for (const ident of identities) {
      if (ident?.username) userHandles.add(String(ident.username).toLowerCase());
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

    const effectivePkgId = pkgRow?.id || packageId;

    // Ensure the package record exists in `packages` before inserting into `reviews`
    // so SQLite FOREIGN KEY (package_id) REFERENCES packages(id) never fails for ContentDB packages!
    if (!pkgRow) {
      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO packages (
          id, author_name, name, title, type, repo_url, provider, license, media_license, status
        ) VALUES (?, ?, ?, ?, 'mod', '', 'contentdb', 'MIT', 'MIT', 'active')
      `).bind(effectivePkgId, author, name, name).run().catch(() => {});
    }

    // Check if the user already has a review on this package (case-insensitive package_id match)
    const existingRev = await context.env.DB.prepare(`
      SELECT id, package_id FROM reviews WHERE LOWER(package_id) = LOWER(?) AND user_id = ? LIMIT 1
    `).bind(effectivePkgId, userId).first().catch(() => null);

    if (existingRev?.id) {
      await context.env.DB.prepare(`
        UPDATE reviews
        SET rating = ?, title = ?, comment = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(numericRating, title || null, comment.trim(), existingRev.id).run();
      savedReviewId = `lh_${existingRev.id}`;
    } else {
      const insertRes = await context.env.DB.prepare(`
        INSERT INTO reviews (package_id, user_id, rating, title, comment)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(package_id, user_id) DO UPDATE SET
          rating = excluded.rating,
          title = excluded.title,
          comment = excluded.comment,
          created_at = CURRENT_TIMESTAMP
      `).bind(effectivePkgId, userId, numericRating, title || null, comment.trim()).run();
      if (insertRes?.meta?.last_row_id) {
        savedReviewId = `lh_${insertRes.meta.last_row_id}`;
      }
    }

    // Recalculate Average Package Score
    await recalculateAndPersistPackageScore(context.env.DB, effectivePkgId);
  }

  await invalidateEdgeCacheKeys([
    '/__api_packages_v2',
    '/__api_packages_v2?boot=1',
    `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
  ]);

  return Response.json({
    success: true,
    review: {
      id: savedReviewId,
      package_id: packageId,
      source: 'luantihub',
      rating: numericRating,
      title,
      comment: comment.trim(),
      created_at: new Date().toISOString(),
      author: {
        username: authorUsername,
        display_name: authorDisplayName,
        avatar_url: authorAvatarUrl
      }
    }
  });
}

// DELETE /api/packages/:author/:name/reviews?reviewId=...
export async function onRequestDelete(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  const url = new URL(context.request.url);
  const reviewId = url.searchParams.get('reviewId') || '';
  const syntheticReq = new Request(context.request.url, {
    method: 'POST',
    headers: context.request.headers,
    body: JSON.stringify({ action: 'delete', reviewId })
  });
  return onRequestPost({ ...context, request: syntheticReq });
}

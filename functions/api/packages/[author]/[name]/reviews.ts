import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  ensureModerationColumns,
  ensureExtendedPackageColumns,
  normalizeContentDbReviewItem,
  deriveReviewThreadCountsFromList,
  computeStarRatingFromData,
  mergeSharedEdgeRatingsMap,
  sanitizePublicErrorMessage,
  buildPackageReviewsEdgeCacheKey,
  buildPackageCacheInvalidationKeys
} from '../../../lib/upstream';
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  verifyStrictPackageAuthorOwnership,
  reconcileAndMergeUserAccount,
  shouldHonorAuthenticatedNoCache
} from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

// GET: Mixed Reviews (ContentDB + LuantiHub Native) with Multi-Tier Edge Caching & Optional Pagination
export async function onRequestGet(context: {
  request?: Request;
  params: { author: string; name: string };
  env: Env;
}) {
  const author = safeDecodeParam(context.params.author);
  const name = safeDecodeParam(context.params.name);
  const packageId = `${author}/${name}`;
  const lowerPkgId = packageId.toLowerCase();
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);

  let pageParam = 0;
  let limitParam = 5;
  let noCache = false;
  if (context.request?.url) {
    try {
      const reqUrl = new URL(context.request.url);
      const rawPage = Number(reqUrl.searchParams.get('page'));
      const rawLimit = Number(reqUrl.searchParams.get('limit'));
      if (Number.isFinite(rawPage) && rawPage >= 1) {
        pageParam = Math.floor(rawPage);
      }
      if (Number.isFinite(rawLimit) && rawLimit >= 1) {
        limitParam = Math.min(50, Math.max(1, Math.floor(rawLimit)));
      }
      const requestedNoCache =
        reqUrl.searchParams.get('nocache') === '1' || reqUrl.searchParams.get('refresh') === '1';
      if (requestedNoCache) {
        noCache = await shouldHonorAuthenticatedNoCache(
          context.request,
          context.env.SESSION_SECRET,
          `reviews:${lowerPkgId}`
        );
      }
    } catch {
      // Ignore malformed request URL
    }
  }

  const edgeReviewsCacheKey = buildPackageReviewsEdgeCacheKey(author, name);
  let allReviews: any[] | null = !noCache ? await readEdgeCacheJson<any[]>(edgeReviewsCacheKey) : null;

  if (!Array.isArray(allReviews)) {
    // 1. Fetch Official ContentDB Reviews (with Edge Cache + failover + canonical author/name resolution for dual-source packages)
    const officialPromise = (async () => {
      try {
        const direct = await fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/reviews/`, 300);
        if (Array.isArray(direct)) {
          return direct;
        }
        const strippedAuthor = author.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
        if (strippedAuthor && strippedAuthor.toLowerCase() !== author.toLowerCase()) {
          const strippedRes = await fetchUpstreamJsonCached<any[]>(
            `/packages/${encodeURIComponent(strippedAuthor)}/${encName}/reviews/`,
            300
          );
          if (Array.isArray(strippedRes)) {
            return strippedRes;
          }
        }
        const catalogList = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 300).catch(() => null);
        if (Array.isArray(catalogList)) {
          const lowerName = name.toLowerCase();
          const lowerBaseAuthor = (strippedAuthor || author).toLowerCase();
          const exactBaseMatch = catalogList.find(
            (item) =>
              item?.author &&
              item?.name &&
              String(item.name).toLowerCase() === lowerName &&
              String(item.author).toLowerCase() === lowerBaseAuthor
          );
          const nameMatches = catalogList.filter(
            (item) => item?.author && item?.name && String(item.name).toLowerCase() === lowerName
          );
          const matched = exactBaseMatch || (nameMatches.length === 1 ? nameMatches[0] : null);
          if (matched && (matched.author !== author || matched.name !== name)) {
            const fallbackRes = await fetchUpstreamJsonCached<any[]>(
              `/packages/${encodeURIComponent(matched.author)}/${encodeURIComponent(matched.name)}/reviews/`,
              300
            );
            if (Array.isArray(fallbackRes)) {
              return fallbackRes;
            }
          }
        }
        return [];
      } catch {
        return [];
      }
    })();

    // 2. Fetch Native LuantiHub Community Comments from Cloudflare D1 (case-insensitive package_id match)
    let localPromise = Promise.resolve<any[]>([]);
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

    // 3. Normalize ContentDB Reviews (`PackageReview.as_dict()`)
    const normalizedOfficial = (Array.isArray(officialReviews) ? officialReviews : []).map((r: any, idx: number) =>
      normalizeContentDbReviewItem(r, idx, packageId)
    );

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
    allReviews = [...normalizedLocal, ...normalizedOfficial].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    // Persist derived star rating & review thread counts into shared Edge Cache (and D1 if row exists)
    const derivedCounts = deriveReviewThreadCountsFromList(allReviews);
    const derivedScore = computeStarRatingFromData({
      reviews_list: allReviews,
      review_thread_counts: derivedCounts
    });
    await mergeSharedEdgeRatingsMap({
      [lowerPkgId]: {
        score: derivedScore,
        ...(derivedCounts ? { review_thread_counts: derivedCounts } : {}),
        checked: true
      }
    }).catch(() => {});

    if (context.env.DB && (derivedScore > 0 || derivedCounts)) {
      context.env.DB.prepare(`
        UPDATE packages
        SET score = CASE WHEN ? > 0 THEN ? ELSE score END,
            review_thread_counts = CASE
              WHEN COALESCE(review_thread_counts, '') = '' OR review_thread_counts = '{"positive":0,"neutral":0,"negative":0}' THEN COALESCE(?, review_thread_counts)
              ELSE review_thread_counts
            END
        WHERE LOWER(id) = LOWER(?)
      `).bind(
        derivedScore,
        derivedScore,
        derivedCounts ? JSON.stringify(derivedCounts) : null,
        packageId
      ).run().catch(() => {});
    }

    await writeEdgeCacheJson(edgeReviewsCacheKey, allReviews, allReviews.length > 0 ? 300 : 120);
  }

  const cacheControlHeader =
    allReviews.length > 0
      ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
      : 'public, max-age=30, s-maxage=120, stale-while-revalidate=300';

  if (pageParam >= 1) {
    const start = (pageParam - 1) * limitParam;
    const items = allReviews.slice(start, start + limitParam);
    return new Response(
      JSON.stringify({
        items,
        total: allReviews.length,
        page: pageParam,
        limit: limitParam,
        hasMore: start + limitParam < allReviews.length
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Total-Count': String(allReviews.length),
          'Cache-Control': cacheControlHeader
        }
      }
    );
  }

  return new Response(JSON.stringify(allReviews), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'X-Total-Count': String(allReviews.length),
      'Cache-Control': cacheControlHeader
    }
  });
}

async function recalculateAndPersistPackageScore(db: any, packageId: string): Promise<number> {
  if (!db) return 0;
  const parts = String(packageId).split('/');
  const authorPart = parts[0] || '';
  const namePart = parts[1] || '';

  const [avgResult, pkgRow] = await Promise.all([
    db.prepare(`
      SELECT AVG(rating) as avg_score, COUNT(*) as total_reviews
      FROM reviews WHERE LOWER(package_id) = LOWER(?)
    `).bind(packageId).first().catch(() => null),
    db.prepare(`
      SELECT review_thread_counts FROM packages
      WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?))
      LIMIT 1
    `).bind(packageId, authorPart, namePart).first().catch(() => null)
  ]);

  let parsedRevCounts: any;
  if (typeof pkgRow?.review_thread_counts === 'string' && pkgRow.review_thread_counts.trim()) {
    try {
      parsedRevCounts = JSON.parse(pkgRow.review_thread_counts);
    } catch {
      // ignore
    }
  }

  const count = Number(avgResult?.total_reviews || 0);
  const roundedScore = count > 0 && avgResult?.avg_score != null
    ? Math.round(Number(avgResult.avg_score) * 10) / 10
    : computeStarRatingFromData({ review_thread_counts: parsedRevCounts });

  await db.prepare(`
    UPDATE packages SET score = ?
    WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?))
  `).bind(roundedScore, packageId, authorPart, namePart).run().catch(() => {});

  return roundedScore;
}

// POST: Submit a Community Review, Flag an Inappropriate Comment, or Remove a Comment (Admin/Author)
export async function onRequestPost(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  try {
    const author = safeDecodeParam(context.params.author);
    const name = safeDecodeParam(context.params.name);
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
      await ensureExtendedPackageColumns(context.env.DB);
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
    const flagDetails = String(body.details || 'Flagged as inappropriate community comment.')
      .replace(/\[(?:CLAIM_PACKAGE|ADMIN)[^\]]*\]/gi, '')
      .trim()
      .slice(0, 800);
    if (!rawReviewId) {
      return Response.json({ error: 'Review ID is required to flag a comment.' }, { status: 400 });
    }

    if (context.env.DB) {
      await ensureModerationColumns(context.env.DB);
      let reviewExcerpt = '';
      let reviewAuthorHandle = 'user';
      if (Number.isFinite(cleanNumericId) && cleanNumericId > 0) {
        const revRow = await context.env.DB.prepare(`
          SELECT r.id, r.user_id, r.comment, r.title, u.username
          FROM reviews r
          LEFT JOIN users u ON r.user_id = u.id
          WHERE r.id = ? AND LOWER(r.package_id) = LOWER(?)
          LIMIT 1
        `).bind(cleanNumericId, packageId).first().catch(() => null);
        if (revRow) {
          if (String(revRow.user_id || '') === userId) {
            return Response.json({ error: 'You cannot flag your own review.' }, { status: 403 });
          }
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
      ...buildPackageCacheInvalidationKeys(author, name, { includeBootCatalog: true }),
      '/__recent_reviews_v1',
      '/__d1_recent_reviews_v1'
    ]);
    await mergeSharedEdgeRatingsMap({
      [packageId.toLowerCase()]: {
        score: newScore,
        checked: true
      }
    }).catch(() => {});

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
    await ensureExtendedPackageColumns(context.env.DB);
    const [userRow, pkgRow] = await Promise.all([
      reconciledUser
        ? Promise.resolve(reconciledUser)
        : context.env.DB.prepare(`SELECT id, username, display_name, avatar_url FROM users WHERE id = ?`).bind(userId).first(),
      context.env.DB.prepare(
        `SELECT id, author_id, author_name, repo_url, maintainers FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      ).bind(packageId, author, name).first().catch(() =>
        context.env.DB.prepare(
          `SELECT id, author_id, author_name, repo_url FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
        ).bind(packageId, author, name).first()
      )
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

    const effectiveUserObj = userRow || {
      id: userId,
      username: authorUsername,
      display_name: authorDisplayName
    };

    const isPackageAuthor = verifyStrictPackageAuthorOwnership(effectiveUserObj, identities, pkgRow, author);

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
    const updatedScore = await recalculateAndPersistPackageScore(context.env.DB, effectivePkgId);
    await mergeSharedEdgeRatingsMap({
      [packageId.toLowerCase()]: {
        score: updatedScore || numericRating,
        checked: true
      }
    }).catch(() => {});
  }

  await invalidateEdgeCacheKeys([
    ...buildPackageCacheInvalidationKeys(author, name, { includeBootCatalog: true }),
    '/__recent_reviews_v1',
    '/__d1_recent_reviews_v1'
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
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Could not process review request.') },
      { status: 500 }
    );
  }
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

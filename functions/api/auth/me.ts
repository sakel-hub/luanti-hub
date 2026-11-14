import {
  createSessionToken,
  verifySessionToken,
  verifySessionTokenClaims,
  SessionTokenClaims,
  buildSessionCookie,
  buildClearSessionCookies,
  parseCookies,
  checkIsAdmin,
  verifyProviderToken,
  resolveUniqueCandidateUsername,
  mergeSecondaryUserIntoPrimary,
  reconcileAndMergeUserAccount,
  getCachedAuthMePayload,
  setCachedAuthMePayload,
  invalidateCachedAuthMePayload,
  verifySameOriginMutation,
  cleanEnvValue,
  resolveContentDbOAuthConfig,
  buildProviderFallbackProfileUrls,
  sanitizeStoredAvatarUrl,
  resolveStoredUserAvatarUrl
} from './lib/session';
import {
  ensureModerationColumns,
  ensureExtendedPackageColumns,
  invalidateEdgeCacheKeys,
  sanitizePublicErrorMessage,
  parseBadgeTagsArray,
  isUntrustedTunnelOrPrivateHost
} from '../lib/upstream';
import {
  syncVerifiedAuthorGitPackages,
  runOneTimeExistingUsersGitBackfill
} from '../lib/author-git-sync';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
  ADMIN_SECRET?: string;
  CODEBERG_CLIENT_ID?: string;
  MESEHUB_CLIENT_ID?: string;
  GITLAB_CLIENT_ID?: string;
  GITHUB_CLIENT_ID?: string;
  CONTENTDB_CLIENT_ID?: string;
  CONTENTDB_CLIENT_SECRET?: string;
  CONTENTDB_REDIRECT_URI?: string;
}

function getConfiguredOAuthProviders(env: Env, requestOrigin: string): Record<string, boolean> {
  return {
    codeberg: Boolean(cleanEnvValue(env.CODEBERG_CLIENT_ID)),
    mesehub: Boolean(cleanEnvValue(env.MESEHUB_CLIENT_ID)),
    gitlab: Boolean(cleanEnvValue(env.GITLAB_CLIENT_ID)),
    github: Boolean(cleanEnvValue(env.GITHUB_CLIENT_ID)),
    contentdb: resolveContentDbOAuthConfig(env, requestOrigin).enabled
  };
}

const deletedUserIdsInIsolate = new Set<string>();

function buildFallbackUserFromClaims(
  claims: SessionTokenClaims,
  env: Env
): any | null {
  const cached = getCachedAuthMePayload(claims.userId, true);
  if (cached) {
    return cached;
  }

  const inferredUsername =
    claims.username ||
    (claims.userId.startsWith('usr_') ? claims.userId.slice(4) : '') ||
    (claims.userId.startsWith('oauth:') ? claims.userId.split(':')[2] || '' : '');

  if (!inferredUsername) {
    return null;
  }

  const provider = claims.provider || 'github';
  const fallbackUrls = buildProviderFallbackProfileUrls(provider, inferredUsername);
  const avatarUrl = claims.avatarUrl ?? fallbackUrls.avatarUrl;
  const identities = [
    {
      provider,
      username: inferredUsername,
      profile_url: fallbackUrls.profileUrl,
      avatar_url: avatarUrl,
      verified: claims.verified !== false
    }
  ];
  const isAdmin = Boolean(
    env.ADMIN_USERS &&
    env.ADMIN_USERS.trim() &&
    checkIsAdmin(
      { username: inferredUsername, role: 'user' },
      identities,
      env.ADMIN_USERS
    )
  );

  return {
    id: claims.userId,
    username: inferredUsername,
    display_name: claims.displayName || inferredUsername,
    avatar_url: avatarUrl,
    bio: '',
    role: isAdmin ? 'admin' : 'user',
    is_admin: isAdmin,
    open_reports_count: 0,
    identities,
    packages: [],
    favorites: [],
    downloads: {},
    notification_digest: {
      user_alerts: [],
      my_reports_total: 0,
      admin_latest_open: [],
      latest_git_packages: [],
      recently_updated_packages: [],
      latest_reviews: []
    }
  };
}

// GET /api/auth/me: Fetch current authenticated user profile, linked identities, packages, favorites & admin status
export async function onRequestGet(context: { request: Request; env: Env; waitUntil?: (promise: Promise<any>) => void }) {
  const url = new URL(context.request.url);
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  const oauthProviders = getConfiguredOAuthProviders(context.env, url.origin);

  if (!sessionToken) {
    return Response.json({ user: null, oauthProviders }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const claims = await verifySessionTokenClaims(sessionToken, context.env.SESSION_SECRET);
  const userId = claims?.userId || null;
  if (!userId || !claims) {
    return Response.json({ user: null, oauthProviders }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (!context.env.DB) {
    const fallbackUser = buildFallbackUserFromClaims(claims, context.env);
    return Response.json(
      { user: fallbackUser, oauthProviders, transientDbFallback: Boolean(fallbackUser) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const wantFresh = url.searchParams.get('fresh') === '1';
  if (!wantFresh) {
    const cachedUser = getCachedAuthMePayload(userId, false);
    if (cachedUser) {
      context.waitUntil?.(runOneTimeExistingUsersGitBackfill(context.env));
      return Response.json(
        { user: cachedUser, oauthProviders },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
  }

  try {
    // 1. Reconcile & auto-merge any duplicate suffixed accounts (memoized per user per isolate)
    const user = deletedUserIdsInIsolate.has(userId)
      ? null
      : await reconcileAndMergeUserAccount(context.env.DB, userId);

    if (!user) {
      if (claims.dbPending && !deletedUserIdsInIsolate.has(userId)) {
        const fallbackUser = buildFallbackUserFromClaims(claims, context.env);
        if (fallbackUser) {
          return Response.json(
            { user: fallbackUser, oauthProviders, transientDbFallback: true },
            { headers: { 'Cache-Control': 'no-store' } }
          );
        }
      }
      // D1 succeeded and confirmed no user row exists (deleted or invalidated account).
      // Clear session cookies across all isolates instead of resurrecting from JWT claims.
      const clearHeaders = new Headers({ 'Cache-Control': 'no-store' });
      for (const c of buildClearSessionCookies(context.request.url)) {
        clearHeaders.append('Set-Cookie', c);
      }
      return Response.json({ user: null, sessionCleared: true, oauthProviders }, { headers: clearHeaders });
    }

    const resolvedUserId = String(user.id);

    // 2. Fetch Linked Identities (Codeberg, GitLab, GitHub, ContentDB)
    const identitiesRes = await context.env.DB.prepare(
      `SELECT provider, provider_username as username, profile_url, avatar_url, verified, created_at
       FROM user_identities WHERE user_id = ?`
    ).bind(resolvedUserId).all();
    const identities = (identitiesRes.results || []).map((id: any) => ({
      ...id,
      avatar_url: sanitizeStoredAvatarUrl(id.avatar_url) || undefined,
      verified: Boolean(id.verified)
    }));

    // 3. Evaluate Admin Role (strictly requires verified identity + ADMIN_USERS env variable)
    const isAdmin = checkIsAdmin(user, identities, context.env.ADMIN_USERS);
    const targetRole = isAdmin ? 'admin' : 'user';
    if (user.role !== targetRole) {
      try {
        await context.env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(targetRole, resolvedUserId).run();
        user.role = targetRole;
      } catch {
        // Ignore if role column migration not yet run
      }
    }

    // 4. Fetch User's Published / Claimed Packages (Only match author_id or exact VERIFIED identities)
    const verifiedHandles: string[] = Array.from(
      new Set<string>(
        identities
          .filter((i: any) => Boolean(i.verified))
          .map((i: any) => String(i.username || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const handlePlaceholders = verifiedHandles.map(() => 'LOWER(author_name) = ?').join(' OR ');
    const pkgQuery = handlePlaceholders
      ? `SELECT *,
                author_name AS author,
                COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE LOWER(r.package_id) = LOWER(packages.id)), 0) AS review_score
         FROM packages WHERE author_id = ? OR ${handlePlaceholders}
         ORDER BY downloads_count DESC`
      : `SELECT *,
                author_name AS author,
                COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE LOWER(r.package_id) = LOWER(packages.id)), 0) AS review_score
         FROM packages WHERE author_id = ?
         ORDER BY downloads_count DESC`;
    const packagesRes = await context.env.DB.prepare(pkgQuery)
      .bind(resolvedUserId, ...verifiedHandles)
      .all();
    const userPackages = (packagesRes.results || []).map((p: any) => {
      const parsedBadgeTags = parseBadgeTagsArray(p.badge_tags);
      return {
        ...p,
        author: p.author || p.author_name || user.username,
        author_display_name: user.display_name || user.username,
        score: Number(p.review_score) || 0,
        ...(parsedBadgeTags.length > 0 ? { badge_tags: parsedBadgeTags } : {})
      };
    });

    // 5. Fetch User's Synced Favorites & Per-Package Download Counts
    const favoritesRes = await context.env.DB.prepare(
      `SELECT package_id FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(resolvedUserId).all();
    const favorites = (favoritesRes.results || []).map((r: any) => r.package_id);

    const downloads: Record<string, number> = {};
    try {
      const downloadsRes = await context.env.DB.prepare(
        `SELECT package_id, download_count FROM user_downloads WHERE user_id = ?`
      ).bind(resolvedUserId).all();
      for (const row of (downloadsRes.results || [])) {
        if (row?.package_id && Number(row.download_count) > 0) {
          downloads[String(row.package_id)] = Number(row.download_count);
        }
      }
    } catch {
      // Table may not exist yet before first download
    }

    // 6. Moderation Counts & Zero-Quota Piggybacked Notification Digest
    let openReportsCount = 0;
    let adminLatestOpen: any[] = [];
    let userAlerts: any[] = [];
    let myReportsTotal = 0;
    let latestGitPackages: any[] = [];
    let recentlyUpdatedPackages: any[] = [];
    let latestReviews: any[] = [];

    try {
      await Promise.all([
        ensureModerationColumns(context.env.DB),
        ensureExtendedPackageColumns(context.env.DB)
      ]);
      if (isAdmin) {
        const repCount = await context.env.DB.prepare(
          `SELECT COUNT(*) as cnt FROM moderation_reports WHERE status = 'open'`
        ).first();
        openReportsCount = Number(repCount?.cnt || 0);

        const latestOpenRes = await context.env.DB.prepare(`
          SELECT
            r.id,
            r.package_id,
            r.reason,
            r.details,
            r.status,
            r.created_at,
            r.updated_at,
            p.title AS package_title,
            p.thumbnail_url AS package_thumbnail
          FROM moderation_reports r
          LEFT JOIN packages p ON LOWER(p.id) = LOWER(r.package_id)
          WHERE r.status = 'open'
          ORDER BY r.created_at DESC
          LIMIT 3
        `).all();
        adminLatestOpen = latestOpenRes.results || [];
      }

      // Fetch up to 5 recent reports submitted by this user or targeting packages owned by this user's VERIFIED identities
      const authorPrefixes = verifiedHandles;

      const authorClause = authorPrefixes.length > 0
        ? `OR LOWER(SUBSTR(r.package_id, 1, INSTR(r.package_id, '/') - 1)) IN (${authorPrefixes.map(() => '?').join(', ')})`
        : '';

      const userAlertsCountRes = await context.env.DB.prepare(`
        SELECT COUNT(*) AS cnt
        FROM moderation_reports r
        WHERE r.reporter_user_id = ? ${authorClause}
      `).bind(resolvedUserId, ...authorPrefixes).first();
      myReportsTotal = Number(userAlertsCountRes?.cnt || 0);

      if (!isAdmin) {
        openReportsCount = myReportsTotal;
      }

      const userAlertsRes = await context.env.DB.prepare(`
        SELECT
          r.id,
          r.package_id,
          r.reporter_user_id,
          r.reason,
          r.details,
          r.status,
          r.resolution_note,
          r.resolved_by,
          r.resolved_at,
          r.created_at,
          COALESCE(r.updated_at, r.resolved_at, r.created_at) AS updated_at,
          p.title AS package_title,
          p.thumbnail_url AS package_thumbnail
        FROM moderation_reports r
        LEFT JOIN packages p ON LOWER(p.id) = LOWER(r.package_id)
        WHERE r.reporter_user_id = ? ${authorClause}
        ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, COALESCE(r.updated_at, r.resolved_at, r.created_at) DESC
        LIMIT 5
      `).bind(resolvedUserId, ...authorPrefixes).all();
      userAlerts = userAlertsRes.results || [];
    } catch (err) {
      console.error('[me.ts] Failed to load moderation digest:', err);
    }

    const primaryIdentity = identities.find((i: any) => i.verified) || identities[0];
    const resolvedUserAvatarUrl = resolveStoredUserAvatarUrl(user.avatar_url, identities);
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (resolvedUserId !== userId || !claims.username) {
      const refreshedToken = await createSessionToken(
        resolvedUserId,
        context.env.SESSION_SECRET,
        {
          username: user.username,
          displayName: user.display_name || user.username,
          avatarUrl: resolvedUserAvatarUrl,
          provider: primaryIdentity?.provider || 'github',
          role: isAdmin ? 'admin' : 'user',
          verified: true
        }
      );
      headers['Set-Cookie'] = buildSessionCookie(refreshedToken, context.request.url, 86400 * 30);
    }

    const userPayload = {
      id: resolvedUserId,
      username: user.username,
      display_name: user.display_name || user.username,
      avatar_url: resolvedUserAvatarUrl,
      bio: user.bio || '',
      role: isAdmin ? 'admin' : 'user',
      is_admin: isAdmin,
      open_reports_count: openReportsCount,
      created_at: user.created_at,
      identities,
      packages: userPackages,
      favorites,
      downloads,
      notification_digest: {
        user_alerts: userAlerts,
        my_reports_total: myReportsTotal || userAlerts.length,
        admin_latest_open: adminLatestOpen,
        latest_git_packages: latestGitPackages,
        recently_updated_packages: recentlyUpdatedPackages,
        latest_reviews: latestReviews
      }
    };

    setCachedAuthMePayload(resolvedUserId, userPayload, 120_000);
    if (resolvedUserId !== userId) {
      setCachedAuthMePayload(userId, userPayload, 120_000);
    }

    if (verifiedHandles.length > 0) {
      context.waitUntil?.(
        (async () => {
          const ownRes = await syncVerifiedAuthorGitPackages(context.env, {
            userId: resolvedUserId,
            authorHandles: verifiedHandles
          });
          // Only run the existing-users backfill if this request did not already consume subrequest budget
          if ((ownRes.newlyImportedCount || 0) === 0 && (ownRes.flaggedForReviewCount || 0) === 0) {
            await runOneTimeExistingUsersGitBackfill(context.env);
          }
        })()
      );
    } else {
      context.waitUntil?.(runOneTimeExistingUsersGitBackfill(context.env));
    }

    return Response.json({
      user: userPayload,
      oauthProviders
    }, {
      headers
    });
  } catch (err: any) {
    // NEVER clear the user's session cookie when D1 throws a quota/database error!
    const fallbackUser = buildFallbackUserFromClaims(claims, context.env);
    if (fallbackUser) {
      return Response.json(
        { user: fallbackUser, oauthProviders, transientDbFallback: true },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return Response.json(
      {
        user: null,
        transientDbError: true,
        oauthProviders,
        error: sanitizePublicErrorMessage(err, 'Could not load session.')
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

const NO_STORE_AUTH_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache'
};

// POST /api/auth/me: Direct Handle Sign-In / Ephemeral One-Time PAT Verification
export async function onRequestPost(context: { request: Request; env: Env; waitUntil?: (promise: Promise<any>) => void }) {
  const csrfBlock = verifySameOriginMutation(context.request);
  if (csrfBlock) return csrfBlock;

  try {
    const body = await context.request.json() as {
      provider?: string;
      username?: string;
      token?: string;
    };

    const allowedProviders = ['contentdb', 'codeberg', 'mesehub', 'gitlab', 'github'];
    const rawProvider = (body.provider || 'contentdb').toLowerCase();
    const provider = allowedProviders.includes(rawProvider) ? rawProvider : 'contentdb';
    const rawUsername = (body.username || '').trim();
    const rawToken = (body.token || '').trim();

    if (!rawUsername || !/^[a-zA-Z0-9_.-]{2,39}$/.test(rawUsername)) {
      return Response.json(
        { error: 'Please enter a valid username (2–39 alphanumeric characters).' },
        { status: 400, headers: NO_STORE_AUTH_HEADERS }
      );
    }

    if (!rawToken) {
      return Response.json(
        { error: 'Please sign in via OAuth or provide a read-only Personal Access Token.' },
        { status: 401, headers: NO_STORE_AUTH_HEADERS }
      );
    }

    const tokenCheck = await verifyProviderToken(provider, rawToken, rawUsername, context.env.ADMIN_SECRET);
    if (!tokenCheck.verified) {
      if (tokenCheck.failureReason === 'excessive_scopes') {
        return Response.json(
          {
            error:
              'Security protection: This token has write or repository permissions. LuantiHub only accepts zero-scope / read-only tokens — please revoke this token on your platform and create a read-only token.'
          },
          { status: 400, headers: NO_STORE_AUTH_HEADERS }
        );
      }
      if (tokenCheck.failureReason === 'username_mismatch') {
        return Response.json(
          {
            error:
              'Token verified a different account than the username entered. Please enter the matching username for this token.'
          },
          { status: 401, headers: NO_STORE_AUTH_HEADERS }
        );
      }
      return Response.json(
        { error: 'Invalid or expired read-only Personal Access Token / API key for the selected platform.' },
        { status: 401, headers: NO_STORE_AUTH_HEADERS }
      );
    }

    const isCryptographicallyVerified = true;
    const verifiedUsername = tokenCheck.username || rawUsername;
    const providerUserId = tokenCheck.providerUserId || verifiedUsername.toLowerCase();
    const displayName = tokenCheck.displayName || verifiedUsername;
    const fallbackUrls = buildProviderFallbackProfileUrls(provider, verifiedUsername);
    const avatarUrl = tokenCheck.avatarUrl ?? fallbackUrls.avatarUrl;
    const profileUrl = tokenCheck.profileUrl || fallbackUrls.profileUrl;

    const verifiedFlag = 1;
    const isAdmin = checkIsAdmin(
      { username: verifiedUsername },
      [{ provider, username: verifiedUsername, verified: verifiedFlag }],
      context.env.ADMIN_USERS
    );
    let resolvedRole = isAdmin ? 'admin' : 'user';
    let sessionUsername = verifiedUsername;
    let userId = `usr_${provider}_${verifiedUsername.toLowerCase()}`;
    let dbWriteFailed = !context.env.DB;

    if (context.env.DB) {
      try {
        const cookies = parseCookies(context.request);
        const existingSessionUserId = cookies['lh_session']
          ? await verifySessionToken(cookies['lh_session'], context.env.SESSION_SECRET)
          : null;
        const activeSessionUser = existingSessionUserId
          ? await context.env.DB.prepare(`SELECT id, username, role FROM users WHERE id = ?`).bind(existingSessionUserId).first() as {
              id: string;
              username?: string;
              role: string;
            } | null
          : null;

        // Check if this exact provider identity already exists (by provider_user_id or provider_username)
        const matchedIdentity = await context.env.DB.prepare(
          `SELECT id, user_id, verified, provider_user_id FROM user_identities
           WHERE provider = ? AND (provider_user_id = ? OR LOWER(provider_username) = LOWER(?))
           ORDER BY verified DESC LIMIT 1`
        ).bind(provider, providerUserId, verifiedUsername).first() as {
          id: number;
          user_id: string;
          verified: number;
          provider_user_id: string;
        } | null;

        const rawIdentityUser = matchedIdentity
          ? await context.env.DB.prepare(`SELECT id, username, role FROM users WHERE id = ?`).bind(matchedIdentity.user_id).first() as {
              id: string;
              username?: string;
              role: string;
            } | null
          : null;

        // Guard against legacy unverified identity claims attached to an already-verified user on another forge
        let trustedIdentityUser = rawIdentityUser;
        if (!activeSessionUser && rawIdentityUser && matchedIdentity && Number(matchedIdentity.verified) !== 1) {
          const otherVerified = await context.env.DB.prepare(
            `SELECT id FROM user_identities WHERE user_id = ? AND verified = 1 LIMIT 1`
          ).bind(rawIdentityUser.id).first();
          if (otherVerified || rawIdentityUser.role === 'admin' || rawIdentityUser.role === 'moderator') {
            trustedIdentityUser = null;
          }
        }

        const usernameCollisionUser = (!activeSessionUser && !trustedIdentityUser)
          ? await context.env.DB.prepare(
              `SELECT id, username, role FROM users WHERE LOWER(username) = LOWER(?)`
            ).bind(verifiedUsername).first() as { id: string; username?: string; role: string } | null
          : null;

        // Prevent cross-provider username collision account takeover:
        // Never attach an unauthenticated login on Provider B onto an existing user who owns a verified identity
        // on Provider A (or holds admin/moderator role). Only unverified `ext_*` stubs can be claimed directly.
        let safeExistingUser = activeSessionUser || trustedIdentityUser || null;
        let hasCrossProviderUsernameCollision = false;

        if (!safeExistingUser && usernameCollisionUser) {
          const existingVerifiedIdentity = await context.env.DB.prepare(
            `SELECT id FROM user_identities WHERE user_id = ? AND verified = 1 LIMIT 1`
          ).bind(usernameCollisionUser.id).first();
          const isPrivilegedExisting =
            usernameCollisionUser.role === 'admin' || usernameCollisionUser.role === 'moderator';
          const isUnverifiedExtStub =
            !existingVerifiedIdentity &&
            !isPrivilegedExisting &&
            String(usernameCollisionUser.id).startsWith('ext_');

          if (isUnverifiedExtStub) {
            safeExistingUser = usernameCollisionUser;
          } else {
            hasCrossProviderUsernameCollision = true;
          }
        }

        if (safeExistingUser) {
          userId = safeExistingUser.id;
          if (safeExistingUser.username) {
            sessionUsername = safeExistingUser.username;
          }
          if (safeExistingUser.role === 'admin' || isAdmin) {
            resolvedRole = 'admin';
          } else if (safeExistingUser.role === 'moderator') {
            resolvedRole = 'moderator';
          }
          if (
            matchedIdentity &&
            matchedIdentity.user_id !== userId &&
            (Number(matchedIdentity.verified) === 1 || String(matchedIdentity.user_id).startsWith('ext_'))
          ) {
            await mergeSecondaryUserIntoPrimary(context.env.DB, userId, matchedIdentity.user_id);
          }
          if (isAdmin && safeExistingUser.role !== 'admin') {
            await context.env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(userId).run();
          }
        } else {
          const canReuseOrphanedIdentityUserId =
            matchedIdentity?.user_id && !rawIdentityUser;
          userId = canReuseOrphanedIdentityUserId ? String(matchedIdentity!.user_id) : crypto.randomUUID();
          const candidateUsername = hasCrossProviderUsernameCollision
            ? await resolveUniqueCandidateUsername(context.env.DB, verifiedUsername, provider)
            : verifiedUsername;
          sessionUsername = candidateUsername;

          await context.env.DB.prepare(`
            INSERT INTO users (id, username, display_name, avatar_url, role)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              display_name = excluded.display_name,
              avatar_url = excluded.avatar_url,
              role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE excluded.role END
          `).bind(userId, candidateUsername, displayName, avatarUrl, resolvedRole).run();
        }

        if (matchedIdentity) {
          const nextVerified = Math.max(Number(matchedIdentity.verified) || 0, verifiedFlag);
          const nextProviderUserId =
            isCryptographicallyVerified && providerUserId !== verifiedUsername.toLowerCase()
              ? providerUserId
              : matchedIdentity.provider_user_id;
          await context.env.DB.prepare(
            `DELETE FROM user_identities WHERE provider = ? AND provider_user_id = ? AND id != ?`
          ).bind(provider, nextProviderUserId, matchedIdentity.id).run();
          await context.env.DB.prepare(`
            UPDATE user_identities
            SET user_id = ?, provider_user_id = ?, provider_username = ?, profile_url = ?, avatar_url = ?, verified = ?
            WHERE id = ?
          `).bind(userId, nextProviderUserId, verifiedUsername, profileUrl, avatarUrl, nextVerified, matchedIdentity.id).run();
        } else {
          await context.env.DB.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, provider_user_id) DO UPDATE SET
              user_id = CASE WHEN user_identities.verified = 1 AND excluded.verified = 0 THEN user_identities.user_id ELSE excluded.user_id END,
              provider_username = excluded.provider_username,
              avatar_url = excluded.avatar_url,
              verified = MAX(user_identities.verified, excluded.verified)
          `).bind(
            userId,
            provider,
            providerUserId,
            verifiedUsername,
            profileUrl,
            avatarUrl,
            verifiedFlag
          ).run();
        }

        const reconciledUser = await reconcileAndMergeUserAccount(context.env.DB, userId, true);
        if (reconciledUser?.id) {
          userId = String(reconciledUser.id);
          if (reconciledUser.username) {
            sessionUsername = String(reconciledUser.username);
          }
          if (reconciledUser.role === 'admin') {
            resolvedRole = 'admin';
          } else if (reconciledUser.role === 'moderator' && resolvedRole !== 'admin') {
            resolvedRole = 'moderator';
          }
        }
      } catch (dbErr) {
        dbWriteFailed = true;
        console.error('[me.ts POST] Proceeding with verified token claims fallback due to D1 error:', dbErr);
      }
    }

    deletedUserIdsInIsolate.delete(userId);
    invalidateCachedAuthMePayload(userId);
    if (isCryptographicallyVerified) {
      context.waitUntil?.(
        syncVerifiedAuthorGitPackages(context.env, {
          userId,
          triggerProvider: provider,
          verifiedUsername
        })
      );
    }
    const sessionToken = await createSessionToken(userId, context.env.SESSION_SECRET, {
      username: sessionUsername,
      displayName,
      avatarUrl,
      provider,
      role: resolvedRole,
      verified: isCryptographicallyVerified,
      ...(dbWriteFailed ? { dbPending: true } : {})
    });

    return new Response(JSON.stringify({ success: true, userId, verified: isCryptographicallyVerified }), {
      headers: {
        'Content-Type': 'application/json',
        ...NO_STORE_AUTH_HEADERS,
        'Set-Cookie': buildSessionCookie(sessionToken, context.request.url, 86400 * 30)
      }
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Sign in failed.') },
      { status: 500, headers: NO_STORE_AUTH_HEADERS }
    );
  }
}

// PUT /api/auth/me: Update User Account Information (display_name, bio, avatar_url)
export async function onRequestPut(context: { request: Request; env: Env }) {
  const csrfBlock = verifySameOriginMutation(context.request);
  if (csrfBlock) return csrfBlock;

  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_AUTH_HEADERS });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId || !context.env.DB) {
    return Response.json({ error: 'Invalid session' }, { status: 401, headers: NO_STORE_AUTH_HEADERS });
  }

  try {
    const body = await context.request.json() as {
      display_name?: string;
      bio?: string;
      avatar_url?: string;
    };

    const displayName = (body.display_name || '').trim().slice(0, 60);
    const bio = (body.bio || '').trim().slice(0, 500);
    const rawAvatarUrl = (body.avatar_url || '').trim().slice(0, 500);
    const avatarUrl =
      /^https:\/\//i.test(rawAvatarUrl) && !isUntrustedTunnelOrPrivateHost(rawAvatarUrl)
        ? rawAvatarUrl
        : '';

    await context.env.DB.prepare(`
      UPDATE users
      SET display_name = COALESCE(NULLIF(?, ''), display_name),
          bio = ?,
          avatar_url = COALESCE(NULLIF(?, ''), avatar_url),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(displayName, bio, avatarUrl, userId).run();

    try {
      const uRow = await context.env.DB.prepare(`SELECT username FROM users WHERE id = ?`).bind(userId).first();
      const idRows = await context.env.DB.prepare(`SELECT provider_username FROM user_identities WHERE user_id = ?`).bind(userId).all();
      const keysToEvict: string[] = [
        '/__api_packages_d1_active_v3',
        '/__api_packages_catalog_v22/'
      ];
      if (uRow?.username) {
        const lowerU = encodeURIComponent(String(uRow.username).toLowerCase());
        keysToEvict.push(`/__api_author_profile_v1/${lowerU}`, `/__api_author_profile_v2/${lowerU}`);
      }
      if (displayName) {
        const lowerD = encodeURIComponent(displayName.toLowerCase());
        keysToEvict.push(`/__api_author_profile_v1/${lowerD}`, `/__api_author_profile_v2/${lowerD}`);
      }
      for (const r of (idRows?.results || [])) {
        if (r?.provider_username) {
          const lowerP = encodeURIComponent(String(r.provider_username).toLowerCase());
          keysToEvict.push(`/__api_author_profile_v1/${lowerP}`, `/__api_author_profile_v2/${lowerP}`);
        }
      }
      if (keysToEvict.length > 0) {
        await invalidateEdgeCacheKeys(keysToEvict);
      }
    } catch {
      // Ignore cache eviction errors
    }

    invalidateCachedAuthMePayload(userId);
    return Response.json({ success: true }, { headers: NO_STORE_AUTH_HEADERS });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Failed to update profile.') },
      { status: 500, headers: NO_STORE_AUTH_HEADERS }
    );
  }
}

// DELETE /api/auth/me:
// - ?account=1(&deletePackages=1|0): Permanently delete user profile and all stored personal data (Google Play & GDPR Right to Erasure)
// - ?provider=github&username=sakel: Unlink a specific secondary identity handle
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const csrfBlock = verifySameOriginMutation(context.request);
  if (csrfBlock) return csrfBlock;

  const url = new URL(context.request.url);

  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tokenClaims = await verifySessionTokenClaims(sessionToken, context.env.SESSION_SECRET);
  const userId = tokenClaims?.userId || null;
  if (!userId || !context.env.DB || deletedUserIdsInIsolate.has(userId)) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }

  const isFullAccountDeletion = url.searchParams.get('account') === '1';

  if (isFullAccountDeletion) {
    // Require explicit custom confirmation header (prevents CSRF & accidental/unintended invocation)
    const confirmHeader = (context.request.headers.get('X-Confirm-Account-Delete') || '').trim().toLowerCase();
    if (confirmHeader !== 'permanent') {
      return Response.json(
        { error: 'Explicit account deletion confirmation header (X-Confirm-Account-Delete: permanent) is required.' },
        { status: 403 }
      );
    }

    // Block IDOR attempts trying to target another userId or username via query params
    const targetUserIdParam = (url.searchParams.get('userId') || url.searchParams.get('id') || '').trim();
    if (targetUserIdParam && targetUserIdParam !== userId) {
      return Response.json({ error: 'Forbidden: Cannot delete another user profile.' }, { status: 403 });
    }

    const deleteSubmittedPackages = url.searchParams.get('deletePackages') !== '0';

    try {
      const uRow = await context.env.DB.prepare(`SELECT id, username FROM users WHERE id = ?`).bind(userId).first();
      if (!uRow) {
        deletedUserIdsInIsolate.add(userId);
        return Response.json({ error: 'Account not found or already deleted.' }, { status: 404 });
      }

      const targetUsernameParam = (url.searchParams.get('username') || '').trim();
      if (
        targetUsernameParam &&
        String(uRow.username || '').trim().toLowerCase() !== targetUsernameParam.toLowerCase()
      ) {
        return Response.json({ error: 'Forbidden: Cannot delete another user profile.' }, { status: 403 });
      }

      const keysToEvict: string[] = [];
      const verifiedGitIdentities: { provider: string; username: string }[] = [];
      let hasAnyVerifiedIdentity = Boolean(tokenClaims?.verified);
      try {
        const idRows = await context.env.DB.prepare(
          `SELECT provider, provider_username, verified FROM user_identities WHERE user_id = ?`
        ).bind(userId).all();
        if (uRow?.username) {
          keysToEvict.push(`/__api_author_profile_v1/${encodeURIComponent(String(uRow.username).toLowerCase())}`);
        }
        for (const r of (idRows?.results || [])) {
          const handle = String(r?.provider_username || r?.username || '').trim();
          const prov = String(r?.provider || '').trim().toLowerCase();
          if (Boolean(r?.verified)) {
            hasAnyVerifiedIdentity = true;
          }
          if (handle) {
            keysToEvict.push(`/__api_author_profile_v1/${encodeURIComponent(handle.toLowerCase())}`);
            if (Boolean(r?.verified) && prov && prov !== 'contentdb') {
              verifiedGitIdentities.push({ provider: prov, username: handle.toLowerCase() });
            }
          }
        }
      } catch {
        // Ignore handle lookup errors if table is empty
      }

      // 1. Handle user's packages (delete pure-Git submissions when requested AND user has verified identity; unlink upstream ContentDB mirrors)
      let deletedSubmittedPackagesCount = 0;
      try {
        if (deleteSubmittedPackages && hasAnyVerifiedIdentity) {
          const identityClauses = verifiedGitIdentities
            .map(() => `(LOWER(provider) = ? AND LOWER(author_name) = ?)`)
            .join(' OR ');
          const identityParams = verifiedGitIdentities.flatMap(i => [i.provider, i.username]);
          const gitPkgSql = identityClauses
            ? `SELECT id, provider, author_id FROM packages WHERE (author_id = ? OR ((author_id IS NULL OR author_id = '') AND (${identityClauses}))) AND COALESCE(LOWER(provider), 'github') != 'contentdb'`
            : `SELECT id, provider, author_id FROM packages WHERE author_id = ? AND COALESCE(LOWER(provider), 'github') != 'contentdb'`;

          const gitPkgsRes = await context.env.DB.prepare(gitPkgSql)
            .bind(userId, ...identityParams)
            .all();
          const gitPkgIds = Array.from(
            new Set(
              (gitPkgsRes?.results || [])
                .filter((row: any) => {
                  const prov = String(row?.provider || 'github').trim().toLowerCase();
                  if (prov === 'contentdb') return false;
                  const rowAuthorId = String(row?.author_id || '').trim();
                  if (rowAuthorId && rowAuthorId !== userId) return false;
                  return true;
                })
                .map((row: any) => String(row?.id || '').trim())
                .filter(Boolean)
            )
          );

          for (const pkgId of gitPkgIds) {
            try {
              await context.env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(pkgId).run();
            } catch {
              // Ignore if releases table missing
            }
            try {
              await context.env.DB.prepare(`DELETE FROM package_daily_downloads WHERE LOWER(package_id) = LOWER(?)`).bind(pkgId).run();
            } catch {
              // Ignore if package_daily_downloads table missing
            }
            try {
              await context.env.DB.prepare(`DELETE FROM promo_tag_packages WHERE LOWER(package_id) = LOWER(?)`).bind(pkgId).run();
            } catch {
              // Ignore if promo_tag_packages table missing
            }
            try {
              await context.env.DB.prepare(`DELETE FROM reviews WHERE LOWER(package_id) = LOWER(?)`).bind(pkgId).run();
            } catch {
              // Ignore if reviews table missing
            }
            await context.env.DB.prepare(`DELETE FROM packages WHERE id = ?`).bind(pkgId).run();
          }

          deletedSubmittedPackagesCount = gitPkgIds.length;
          if (gitPkgIds.length > 0) {
            keysToEvict.push('/__api_packages_d1_active_v3');
          }
        }

        // Unlink any remaining packages (e.g. upstream ContentDB mirrors or when deletePackages=0)
        await context.env.DB.prepare(`UPDATE packages SET author_id = NULL WHERE author_id = ?`).bind(userId).run();
      } catch {
        // Ignore if packages table missing
      }

      // 2. Delete user's community reviews & ratings
      try {
        await context.env.DB.prepare(`DELETE FROM reviews WHERE user_id = ?`).bind(userId).run();
      } catch {
        // Ignore if reviews table missing
      }

      // 3. Delete user's synced favorites
      try {
        await context.env.DB.prepare(`DELETE FROM user_favorites WHERE user_id = ?`).bind(userId).run();
      } catch {
        // Ignore if user_favorites table missing
      }

      // 4. Delete user's personal download & view telemetry history
      try {
        await context.env.DB.prepare(`DELETE FROM user_downloads WHERE user_id = ?`).bind(userId).run();
      } catch {
        // Ignore if user_downloads table missing
      }
      try {
        await context.env.DB.prepare(`DELETE FROM user_views WHERE user_id = ?`).bind(userId).run();
      } catch {
        // Ignore if user_views table missing
      }

      // 5. Delete closed moderation reports submitted by user and anonymize open reports
      try {
        await context.env.DB.prepare(
          `DELETE FROM moderation_reports WHERE reporter_user_id = ? AND status IN ('resolved', 'dismissed')`
        ).bind(userId).run();
        await context.env.DB.prepare(
          `UPDATE moderation_reports SET reporter_user_id = NULL WHERE reporter_user_id = ?`
        ).bind(userId).run();
      } catch {
        // Ignore if moderation_reports table missing
      }

      // 6. Delete all linked OAuth/PAT identities and the core user profile row
      try {
        await context.env.DB.prepare(`DELETE FROM user_identities WHERE user_id = ?`).bind(userId).run();
      } catch {
        // Ignore if user_identities table missing
      }
      await context.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();

      deletedUserIdsInIsolate.add(userId);
      invalidateCachedAuthMePayload(userId);

      if (keysToEvict.length > 0) {
        try {
          await invalidateEdgeCacheKeys(keysToEvict);
        } catch {
          // Non-fatal
        }
      }

      const headers = new Headers({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      });
      for (const c of buildClearSessionCookies(context.request.url)) {
        headers.append('Set-Cookie', c);
      }

      return new Response(
        JSON.stringify({
          success: true,
          accountDeleted: true,
          deletedUserId: userId,
          deletedPackages: deleteSubmittedPackages,
          deletedSubmittedPackagesCount
        }),
        { status: 200, headers }
      );
    } catch (err: any) {
      return Response.json(
        { error: sanitizePublicErrorMessage(err, 'Failed to delete account and associated data.') },
        { status: 500 }
      );
    }
  }

  const provider = url.searchParams.get('provider');
  const username = (url.searchParams.get('username') || '').trim();

  if (!provider) {
    return Response.json({ error: 'Provider parameter is required.' }, { status: 400 });
  }

  try {
    const countRes = await context.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM user_identities WHERE user_id = ?`
    ).bind(userId).first();

    if ((countRes?.cnt || 0) <= 1) {
      return Response.json({ error: 'Cannot unlink your only connected identity.' }, { status: 400 });
    }

    if (username) {
      await context.env.DB.prepare(
        `DELETE FROM user_identities WHERE user_id = ? AND provider = ? AND LOWER(provider_username) = LOWER(?)`
      ).bind(userId, provider, username).run();
    } else {
      await context.env.DB.prepare(
        `DELETE FROM user_identities WHERE user_id = ? AND provider = ?`
      ).bind(userId, provider).run();
    }

    invalidateCachedAuthMePayload(userId);
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ error: sanitizePublicErrorMessage(err, 'Failed to unlink account.') }, { status: 500 });
  }
}

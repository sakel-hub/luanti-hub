import {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  isProtectedAdminHandle,
  verifyProviderToken,
  mergeSecondaryUserIntoPrimary,
  reconcileAndMergeUserAccount
} from './lib/session';
import {
  syncAuthorContentDbPackages,
  ensureModerationColumns,
  ensureExtendedPackageColumns,
  invalidateEdgeCacheKeys,
  sanitizePublicErrorMessage
} from '../lib/upstream';

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
}

function getConfiguredOAuthProviders(env: Env): Record<string, boolean> {
  return {
    codeberg: Boolean(env.CODEBERG_CLIENT_ID && env.CODEBERG_CLIENT_ID.trim()),
    mesehub: Boolean(env.MESEHUB_CLIENT_ID && env.MESEHUB_CLIENT_ID.trim()),
    gitlab: Boolean(env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_ID.trim()),
    github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_ID.trim()),
    contentdb: Boolean(env.CONTENTDB_CLIENT_ID && env.CONTENTDB_CLIENT_ID.trim())
  };
}

// GET /api/auth/me: Fetch current authenticated user profile, linked identities, packages, favorites & admin status
export async function onRequestGet(context: { request: Request; env: Env }) {
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  const oauthProviders = getConfiguredOAuthProviders(context.env);

  if (!sessionToken) {
    return Response.json({ user: null, oauthProviders }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId || !context.env.DB) {
    return Response.json({ user: null, oauthProviders }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    // 1. Reconcile & auto-merge any duplicate suffixed accounts
    const user = await reconcileAndMergeUserAccount(context.env.DB, userId);

    if (!user) {
      const isHttps = new URL(context.request.url).protocol === 'https:';
      return Response.json(
        { user: null, oauthProviders },
        {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': `lh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
          }
        }
      );
    }

    const resolvedUserId = String(user.id);

    // 2. Fetch Linked Identities (Codeberg, GitLab, GitHub, ContentDB)
    const identitiesRes = await context.env.DB.prepare(
      `SELECT provider, provider_username as username, profile_url, avatar_url, verified, created_at
       FROM user_identities WHERE user_id = ?`
    ).bind(resolvedUserId).all();
    const identities = (identitiesRes.results || []).map((id: any) => ({
      ...id,
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

    // 4. Fetch User's Published / Claimed Packages (Only match author_name against VERIFIED identities)
    const verifiedHandles = Array.from(
      new Set(
        identities
          .filter((i: any) => Boolean(i.verified))
          .map((i: any) => String(i.username || '').toLowerCase())
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
    const userPackages = (packagesRes.results || []).map((p: any) => ({
      ...p,
      author: p.author || p.author_name || user.username,
      score: Number(p.review_score) || 0
    }));

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

    try {
      await ensureModerationColumns(context.env.DB);
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

      // Fetch up to 5 recent reports submitted by this user or targeting packages owned by this user
      const authorPrefixes = Array.from(new Set([
        String(user.username || '').toLowerCase(),
        ...identityHandles
      ])).filter(Boolean);

      const authorClause = authorPrefixes.length > 0
        ? `OR LOWER(SUBSTR(r.package_id, 1, INSTR(r.package_id, '/') - 1)) IN (${authorPrefixes.map(() => '?').join(', ')})`
        : '';

      const userAlertsCountRes = await context.env.DB.prepare(`
        SELECT COUNT(*) AS cnt
        FROM moderation_reports r
        WHERE r.reporter_user_id = ? ${authorClause}
      `).bind(resolvedUserId, ...authorPrefixes).first();
      myReportsTotal = Number(userAlertsCountRes?.cnt || 0);

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

      const latestGitRes = await context.env.DB.prepare(`
        SELECT
          id,
          author_name AS author,
          name,
          title,
          type,
          short_desc,
          thumbnail_url AS thumbnail,
          source,
          status,
          created_at
        FROM packages
        WHERE source = 'git' AND COALESCE(status, 'active') = 'active'
        ORDER BY COALESCE(created_at, updated_at) DESC
        LIMIT 5
      `).all();
      latestGitPackages = latestGitRes.results || [];
    } catch {
      openReportsCount = 0;
    }

    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (resolvedUserId !== userId) {
      const refreshedToken = await createSessionToken(resolvedUserId, context.env.SESSION_SECRET);
      const isHttps = new URL(context.request.url).protocol === 'https:';
      headers['Set-Cookie'] =
        `lh_session=${refreshedToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 30}${isHttps ? '; Secure' : ''}`;
    }

    return Response.json({
      user: {
        id: resolvedUserId,
        username: user.username,
        display_name: user.display_name || user.username,
        avatar_url: user.avatar_url || `https://github.com/${user.username}.png`,
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
          latest_git_packages: latestGitPackages
        }
      },
      oauthProviders
    }, {
      headers
    });
  } catch (err: any) {
    return Response.json(
      { user: null, oauthProviders, error: sanitizePublicErrorMessage(err, 'Could not load session.') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

// POST /api/auth/me: Direct Handle Sign-In / PAT Verification
export async function onRequestPost(context: { request: Request; env: Env }) {
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
      return Response.json({ error: 'Please enter a valid username (2–39 alphanumeric characters).' }, { status: 400 });
    }

    let verifiedUsername = rawUsername;
    let providerUserId = rawUsername.toLowerCase();
    let displayName = rawUsername;
    let avatarUrl = `https://github.com/${rawUsername}.png`;
    let profileUrl = `https://github.com/${rawUsername}`;
    let isCryptographicallyVerified = false;

    // 1. If a Personal Access Token or Admin Secret was provided, verify it live against the provider API
    if (rawToken) {
      const tokenCheck = await verifyProviderToken(provider, rawToken, rawUsername, context.env.ADMIN_SECRET);
      if (!tokenCheck.verified) {
        return Response.json(
          { error: 'Invalid Personal Access Token or Admin Secret for the selected provider.' },
          { status: 401 }
        );
      }
      isCryptographicallyVerified = true;
      verifiedUsername = tokenCheck.username || rawUsername;
      providerUserId = tokenCheck.providerUserId || verifiedUsername.toLowerCase();
      displayName = tokenCheck.displayName || verifiedUsername;
      if (tokenCheck.avatarUrl) avatarUrl = tokenCheck.avatarUrl;
      if (tokenCheck.profileUrl) profileUrl = tokenCheck.profileUrl;
    } else {
      // 2. Unauthenticated Handle Sign-In: block impersonation of protected Admin handles
      if (isProtectedAdminHandle(rawUsername, provider, context.env.ADMIN_USERS)) {
        return Response.json(
          {
            error: 'This administrator handle is protected. Please sign in via OAuth or provide a Personal Access Token.'
          },
          { status: 403 }
        );
      }

      if (provider === 'contentdb') {
        avatarUrl = `https://content.luanti.org/users/${rawUsername}/avatar/`;
        profileUrl = `https://content.luanti.org/users/${rawUsername}/`;
      } else if (provider === 'codeberg') {
        avatarUrl = `https://codeberg.org/${rawUsername}.png`;
        profileUrl = `https://codeberg.org/${rawUsername}`;
      } else if (provider === 'mesehub') {
        avatarUrl = `https://git.minetest.land/${rawUsername}.png`;
        profileUrl = `https://git.minetest.land/${rawUsername}`;
      } else if (provider === 'gitlab') {
        profileUrl = `https://gitlab.com/${rawUsername}`;
      } else if (provider === 'github') {
        try {
          const ghRes = await fetch(`https://api.github.com/users/${encodeURIComponent(rawUsername)}`, {
            headers: { 'User-Agent': 'LuantiHub' }
          });
          if (ghRes.ok) {
            const ghUser = await ghRes.json() as any;
            verifiedUsername = ghUser.login || rawUsername;
            providerUserId = String(ghUser.id || verifiedUsername.toLowerCase());
            displayName = ghUser.name || verifiedUsername;
            avatarUrl = ghUser.avatar_url || avatarUrl;
            profileUrl = ghUser.html_url || profileUrl;
          }
        } catch {
          // Keep defaults
        }
      }
    }

    const verifiedFlag = isCryptographicallyVerified ? 1 : 0;
    const isAdmin = checkIsAdmin(
      { username: verifiedUsername },
      [{ provider, username: verifiedUsername, verified: verifiedFlag }],
      context.env.ADMIN_USERS
    );
    const role = isAdmin ? 'admin' : 'user';
    let userId = `usr_${verifiedUsername.toLowerCase()}`;

    if (context.env.DB) {
      const cookies = parseCookies(context.request);
      const existingSessionUserId = cookies['lh_session']
        ? await verifySessionToken(cookies['lh_session'], context.env.SESSION_SECRET)
        : null;
      const activeSessionUser = existingSessionUserId
        ? await context.env.DB.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(existingSessionUserId).first() as { id: string; role: string } | null
        : null;

      // First check if this provider identity already exists (by provider_user_id or provider_username)
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

      const identityUser = matchedIdentity
        ? await context.env.DB.prepare(`SELECT id, role FROM users WHERE id = ?`).bind(matchedIdentity.user_id).first() as { id: string; role: string } | null
        : null;

      const usernameUser = (!activeSessionUser && !identityUser)
        ? await context.env.DB.prepare(
            `SELECT id, role FROM users WHERE LOWER(username) = LOWER(?)`
          ).bind(verifiedUsername).first() as { id: string; role: string } | null
        : null;

      const existingUser = activeSessionUser || identityUser || usernameUser;

      if (existingUser) {
        // Check if existing user has any cryptographically verified identity or admin role
        const verifiedIdentity = await context.env.DB.prepare(
          `SELECT id FROM user_identities WHERE user_id = ? AND verified = 1 LIMIT 1`
        ).bind(existingUser.id).first();

        if (!activeSessionUser && !isCryptographicallyVerified && (verifiedIdentity || existingUser.role === 'admin' || existingUser.role === 'moderator')) {
          return Response.json(
            {
              error: 'This creator account is verified and protected. Please sign in via OAuth or provide a Personal Access Token.'
            },
            { status: 403 }
          );
        }

        userId = existingUser.id;
        if (matchedIdentity && matchedIdentity.user_id !== userId && isCryptographicallyVerified) {
          await mergeSecondaryUserIntoPrimary(context.env.DB, userId, matchedIdentity.user_id);
        }
        if (isAdmin) {
          await context.env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(userId).run();
        }
      } else {
        userId = matchedIdentity?.user_id ? String(matchedIdentity.user_id) : crypto.randomUUID();
        await context.env.DB.prepare(`
          INSERT OR REPLACE INTO users (id, username, display_name, avatar_url, role)
          VALUES (?, ?, ?, ?, ?)
        `).bind(userId, verifiedUsername, displayName, avatarUrl, role).run();
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

      const reconciledUser = await reconcileAndMergeUserAccount(context.env.DB, userId);
      if (reconciledUser?.id) {
        userId = String(reconciledUser.id);
      }

      // Auto-sync ContentDB packages for this author only when verified or creating initial portfolio view
      await syncAuthorContentDbPackages(context.env.DB, userId, verifiedUsername);
    }

    const sessionToken = await createSessionToken(userId, context.env.SESSION_SECRET);
    const url = new URL(context.request.url);
    const isHttps = url.protocol === 'https:';

    return new Response(JSON.stringify({ success: true, userId, verified: isCryptographicallyVerified }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `lh_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 30}${isHttps ? '; Secure' : ''}`
      }
    });
  } catch (err: any) {
    return Response.json({ error: sanitizePublicErrorMessage(err, 'Sign in failed.') }, { status: 500 });
  }
}

// PUT /api/auth/me: Update User Account Information (display_name, bio, avatar_url)
export async function onRequestPut(context: { request: Request; env: Env }) {
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId || !context.env.DB) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
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
    const avatarUrl = /^https:\/\//i.test(rawAvatarUrl) ? rawAvatarUrl : '';

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
      const keysToEvict: string[] = [];
      if (uRow?.username) {
        keysToEvict.push(`/__api_author_profile_v1/${encodeURIComponent(String(uRow.username).toLowerCase())}`);
      }
      for (const r of (idRows?.results || [])) {
        if (r?.provider_username) {
          keysToEvict.push(`/__api_author_profile_v1/${encodeURIComponent(String(r.provider_username).toLowerCase())}`);
        }
      }
      if (keysToEvict.length > 0) {
        await invalidateEdgeCacheKeys(keysToEvict);
      }
    } catch {
      // Ignore cache eviction errors
    }

    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ error: sanitizePublicErrorMessage(err, 'Failed to update profile.') }, { status: 500 });
  }
}

// DELETE /api/auth/me?provider=github&username=sakel: Unlink a specific identity handle
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId || !context.env.DB) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }

  const url = new URL(context.request.url);
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

    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json({ error: sanitizePublicErrorMessage(err, 'Failed to unlink account.') }, { status: 500 });
  }
}

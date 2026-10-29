import {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  mergeSecondaryUserIntoPrimary,
  reconcileAndMergeUserAccount
} from '../lib/session';
import { syncAuthorContentDbPackages } from '../../lib/upstream';

interface Env {
  DB?: any;
  CODEBERG_CLIENT_ID?: string;
  CODEBERG_CLIENT_SECRET?: string;
  CODEBERG_REDIRECT_URI?: string;
  MESEHUB_CLIENT_ID?: string;
  MESEHUB_CLIENT_SECRET?: string;
  MESEHUB_REDIRECT_URI?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  GITLAB_REDIRECT_URI?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  CONTENTDB_CLIENT_ID?: string;
  CONTENTDB_CLIENT_SECRET?: string;
  CONTENTDB_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestGet(context: { params: { provider: string }; request: Request; env: Env }) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const defaultRedirectUri = `${url.origin}/api/auth/${provider}/callback`;
  const redirectUriByProvider: Record<string, string | undefined> = {
    codeberg: context.env.CODEBERG_REDIRECT_URI,
    mesehub: context.env.MESEHUB_REDIRECT_URI,
    gitlab: context.env.GITLAB_REDIRECT_URI,
    github: context.env.GITHUB_REDIRECT_URI,
    contentdb: context.env.CONTENTDB_REDIRECT_URI
  };
  const redirectUri = redirectUriByProvider[provider] || defaultRedirectUri;

  if (!code) {
    return Response.redirect(`${url.origin}/?auth_error=No+authorization+code+provided`, 302);
  }

  const cookies = parseCookies(context.request);
  const expectedState = cookies['lh_oauth_state'];
  if (!stateParam || !expectedState || stateParam !== expectedState) {
    return Response.redirect(`${url.origin}/?auth_error=Invalid+OAuth+CSRF+state`, 302);
  }

  try {
    let providerUserId = '';
    let providerUsername = '';
    let displayName = '';
    let avatarUrl = '';
    let profileUrl = '';

    // 1. Exchange OAuth code for Access Token & Profile
    if (provider === 'codeberg') {
      const tokenRes = await fetch('https://codeberg.org/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: context.env.CODEBERG_CLIENT_ID || '',
          client_secret: context.env.CODEBERG_CLIENT_SECRET || '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });
      if (!tokenRes.ok) throw new Error('Codeberg token exchange failed');
      const tokenData = await tokenRes.json() as any;
      const userRes = await fetch('https://codeberg.org/api/v1/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!userRes.ok) throw new Error('Codeberg user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || user.username || '');
      providerUsername = user.username || user.login || '';
      displayName = user.full_name || providerUsername;
      avatarUrl = user.avatar_url || '';
      profileUrl = `https://codeberg.org/${providerUsername}`;

    } else if (provider === 'mesehub') {
      const tokenRes = await fetch('https://git.minetest.land/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: context.env.MESEHUB_CLIENT_ID || '',
          client_secret: context.env.MESEHUB_CLIENT_SECRET || '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });
      if (!tokenRes.ok) throw new Error('Mesehub token exchange failed');
      const tokenData = await tokenRes.json() as any;
      const userRes = await fetch('https://git.minetest.land/api/v1/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!userRes.ok) throw new Error('Mesehub user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || user.username || user.login || '');
      providerUsername = user.username || user.login || '';
      displayName = user.full_name || providerUsername;
      avatarUrl = user.avatar_url || `https://git.minetest.land/${providerUsername}.png`;
      profileUrl = `https://git.minetest.land/${providerUsername}`;

    } else if (provider === 'gitlab') {
      const tokenRes = await fetch('https://gitlab.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: context.env.GITLAB_CLIENT_ID || '',
          client_secret: context.env.GITLAB_CLIENT_SECRET || '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });
      if (!tokenRes.ok) throw new Error('GitLab token exchange failed');
      const tokenData = await tokenRes.json() as any;
      const userRes = await fetch('https://gitlab.com/api/v4/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!userRes.ok) throw new Error('GitLab user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || '');
      providerUsername = user.username || '';
      displayName = user.name || providerUsername;
      avatarUrl = user.avatar_url || '';
      profileUrl = user.web_url || `https://gitlab.com/${providerUsername}`;

    } else if (provider === 'github') {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: new URLSearchParams({
          client_id: context.env.GITHUB_CLIENT_ID || '',
          client_secret: context.env.GITHUB_CLIENT_SECRET || '',
          code,
          redirect_uri: redirectUri
        })
      });
      if (!tokenRes.ok) throw new Error('GitHub token exchange failed');
      const tokenData = await tokenRes.json() as any;
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'GitHub OAuth token missing');
      }
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': 'LuantiHub'
        }
      });
      if (!userRes.ok) throw new Error('GitHub user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || '');
      providerUsername = user.login || '';
      displayName = user.name || providerUsername;
      avatarUrl = user.avatar_url || `https://github.com/${providerUsername}.png`;
      profileUrl = user.html_url || `https://github.com/${providerUsername}`;

    } else if (provider === 'contentdb') {
      const tokenRes = await fetch('https://content.luanti.org/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: context.env.CONTENTDB_CLIENT_ID || '',
          client_secret: context.env.CONTENTDB_CLIENT_SECRET || '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });
      if (!tokenRes.ok) throw new Error('ContentDB token exchange failed');
      const tokenData = await tokenRes.json() as any;
      const whoamiRes = await fetch('https://content.luanti.org/api/whoami/', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!whoamiRes.ok) throw new Error('ContentDB whoami fetch failed');
      const user = await whoamiRes.json() as any;
      providerUserId = user.username || '';
      providerUsername = user.username || '';
      displayName = user.display_name || providerUsername;
      avatarUrl = `https://content.luanti.org/users/${providerUsername}/avatar/`;
      profileUrl = `https://content.luanti.org/users/${providerUsername}/`;
    }

    if (!providerUsername) {
      return Response.redirect(`${url.origin}/?auth_error=Authentication+failed`, 302);
    }

    // 2. Identify or Create User in Cloudflare D1 (with full orphan & duplicate self-healing)
    let userId: string | null = null;
    const existingSessionUserId = cookies['lh_session']
      ? await verifySessionToken(cookies['lh_session'], context.env.SESSION_SECRET)
      : null;

    const isAdmin = checkIsAdmin(
      { username: providerUsername },
      [{ provider, username: providerUsername, verified: 1 }],
      context.env.ADMIN_USERS
    );
    const role = isAdmin ? 'admin' : 'user';

    if (context.env.DB) {
      // Verify whether existingSessionUserId actually resolves to a live row in `users`
      let activeSessionUser: any = null;
      if (existingSessionUserId) {
        activeSessionUser = await reconcileAndMergeUserAccount(context.env.DB, existingSessionUserId);
      }

      // Fetch all existing identity rows matching either canonical provider_user_id or provider_username
      const matchingIdentitiesRes = await context.env.DB.prepare(`
        SELECT id, user_id, provider_user_id, provider_username, verified
        FROM user_identities
        WHERE provider = ? AND (provider_user_id = ? OR LOWER(provider_username) = LOWER(?))
        ORDER BY verified DESC, id ASC
      `).bind(provider, providerUserId, providerUsername).all();
      const matchingIdentities = (matchingIdentitiesRes.results || []) as Array<{
        id: number;
        user_id: string;
        provider_user_id: string;
        provider_username: string;
        verified: number;
      }>;

      if (activeSessionUser?.id) {
        userId = String(activeSessionUser.id);
      } else {
        // Check if any matching identity points to a live row in `users` (preferring unsuffixed canonical username)
        for (const ident of matchingIdentities) {
          const u = await context.env.DB.prepare(
            `SELECT id, username FROM users WHERE id = ?`
          ).bind(ident.user_id).first() as { id: string; username: string } | null;
          if (u) {
            userId = u.id;
            if (String(u.username || '').toLowerCase() === providerUsername.toLowerCase()) {
              break;
            }
          }
        }

        // If no matching identity points to a live user row, check if a user with this username already exists
        if (!userId) {
          const existingUserByUsername = await context.env.DB.prepare(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`
          ).bind(providerUsername).first() as { id: string } | null;

          const conflictingSameProvider = existingUserByUsername
            ? await context.env.DB.prepare(
                `SELECT id FROM user_identities WHERE user_id = ? AND provider = ? AND LOWER(provider_username) != LOWER(?) LIMIT 1`
              ).bind(existingUserByUsername.id, provider, providerUsername).first()
            : null;

          if (existingUserByUsername && !conflictingSameProvider) {
            userId = existingUserByUsername.id;
          } else {
            const candidateUsername = existingUserByUsername
              ? `${providerUsername}_${provider.slice(0, 2)}`
              : providerUsername;

            // Reuse orphaned identity's user_id if present so existing packages/favorites/downloads stay linked
            userId = matchingIdentities.length > 0 && matchingIdentities[0].user_id
              ? String(matchingIdentities[0].user_id)
              : crypto.randomUUID();

            await context.env.DB.prepare(`
              INSERT OR REPLACE INTO users (id, username, display_name, avatar_url, role)
              VALUES (?, ?, ?, ?, ?)
            `).bind(userId, candidateUsername, displayName || providerUsername, avatarUrl, role).run();
          }
        }
      }

      // Merge any secondary or orphaned user_ids referenced by matchingIdentities into the resolved primary userId
      if (userId) {
        const mergedSecondaryIds = new Set<string>();
        for (const ident of matchingIdentities) {
          if (ident.user_id && ident.user_id !== userId && !mergedSecondaryIds.has(ident.user_id)) {
            mergedSecondaryIds.add(ident.user_id);
            await mergeSecondaryUserIntoPrimary(context.env.DB, userId, ident.user_id);
          }
        }

        // Clean up duplicate identity rows for this specific (provider, provider_user_id / provider_username)
        // while preserving any OTHER accounts on the same provider linked to this userId!
        const currentIdentitiesRes = await context.env.DB.prepare(`
          SELECT id FROM user_identities
          WHERE provider = ?
            AND (provider_user_id = ? OR LOWER(provider_username) = LOWER(?))
          ORDER BY verified DESC, id ASC
        `).bind(provider, providerUserId, providerUsername).all();
        const currentIds = (currentIdentitiesRes.results || []) as Array<{ id: number }>;

        if (currentIds.length > 0) {
          const keepId = currentIds[0].id;
          for (const extra of currentIds.slice(1)) {
            await context.env.DB.prepare(`DELETE FROM user_identities WHERE id = ?`).bind(extra.id).run();
          }
          await context.env.DB.prepare(`
            UPDATE user_identities
            SET user_id = ?, provider_user_id = ?, provider_username = ?, profile_url = ?, avatar_url = ?, verified = 1
            WHERE id = ?
          `).bind(userId, providerUserId, providerUsername, profileUrl, avatarUrl, keepId).run();
        } else {
          await context.env.DB.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(provider, provider_user_id) DO UPDATE SET
              user_id = excluded.user_id,
              provider_username = excluded.provider_username,
              profile_url = excluded.profile_url,
              avatar_url = excluded.avatar_url,
              verified = 1
          `).bind(userId, provider, providerUserId, providerUsername, profileUrl, avatarUrl).run();
        }

        // Reconcile & merge any duplicate suffixed accounts
        const reconciledUser = await reconcileAndMergeUserAccount(context.env.DB, userId);
        if (reconciledUser?.id) {
          userId = String(reconciledUser.id);
        }

        if (isAdmin && userId) {
          await context.env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(userId).run();
        }
      }

      // 3. Automatic ContentDB & Git Package Matching (Zero-Click Claiming!)
      if (provider !== 'contentdb' && userId) {
        await context.env.DB.prepare(`
          UPDATE packages SET author_id = ?
          WHERE (author_id IS NULL OR author_id LIKE 'ext_%')
            AND (LOWER(author_name) = LOWER(?) OR LOWER(repo_url) LIKE LOWER(?))
        `).bind(userId, providerUsername, `%/${providerUsername}/%`).run();
      }

      // Sync upstream ContentDB packages authored by this verified username
      if (userId) {
        await syncAuthorContentDbPackages(context.env.DB, userId, providerUsername);
      }
    } else {
      // Fallback userId if D1 binding is not yet initialized locally
      userId = `usr_${provider}_${providerUsername}`;
    }

    if (!userId) {
      return Response.redirect(`${url.origin}/?auth_error=User+creation+failed`, 302);
    }

    // 4. Issue Secure HTTP-Only Session Cookie & Clear OAuth State Cookie
    const sessionToken = await createSessionToken(userId, context.env.SESSION_SECRET);
    const isHttps = url.protocol === 'https:';

    const headers = new Headers();
    headers.set('Location', `${url.origin}/?auth_success=1`);
    headers.append(
      'Set-Cookie',
      `lh_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 30}${isHttps ? '; Secure' : ''}`
    );
    headers.append(
      'Set-Cookie',
      `lh_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
    );

    return new Response(null, {
      status: 302,
      headers
    });

  } catch (err: any) {
    return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent(err.message || 'Auth failure')}`, 302);
  }
}

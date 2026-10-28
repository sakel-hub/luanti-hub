import { createSessionToken, verifySessionToken, parseCookies, checkIsAdmin } from '../lib/session';
import { syncAuthorContentDbPackages } from '../../lib/upstream';

interface Env {
  DB?: any;
  CODEBERG_CLIENT_ID?: string;
  CODEBERG_CLIENT_SECRET?: string;
  CODEBERG_REDIRECT_URI?: string;
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

    // 2. Identify or Create User in Cloudflare D1
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
      if (existingSessionUserId) {
        // User is ALREADY logged in -> LINK IDENTITY to existing user
        userId = existingSessionUserId;
        await context.env.DB.prepare(`
          INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(provider, provider_user_id) DO UPDATE SET
            user_id = excluded.user_id,
            provider_username = excluded.provider_username,
            avatar_url = excluded.avatar_url,
            verified = 1
        `).bind(userId, provider, providerUserId, providerUsername, profileUrl, avatarUrl).run();

        if (isAdmin) {
          await context.env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(userId).run();
        }
      } else {
        // Find existing linked identity
        const existingIdentity = await context.env.DB.prepare(`
          SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?
        `).bind(provider, providerUserId).first() as { user_id: string } | null;

        if (existingIdentity) {
          userId = existingIdentity.user_id;
          await context.env.DB.prepare(`
            UPDATE user_identities SET verified = 1, provider_username = ?, avatar_url = ? WHERE provider = ? AND provider_user_id = ?
          `).bind(providerUsername, avatarUrl, provider, providerUserId).run();
          if (isAdmin) {
            await context.env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(userId).run();
          }
        } else {
          // Ensure unique username in `users` table (avoid UNIQUE constraint failure across providers)
          let candidateUsername = providerUsername;
          const collision = await context.env.DB.prepare(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`
          ).bind(candidateUsername).first();

          if (collision) {
            candidateUsername = `${providerUsername}_${provider.slice(0, 2)}`;
          }

          userId = crypto.randomUUID();
          await context.env.DB.prepare(`
            INSERT INTO users (id, username, display_name, avatar_url, role)
            VALUES (?, ?, ?, ?, ?)
          `).bind(userId, candidateUsername, displayName || providerUsername, avatarUrl, role).run();

          await context.env.DB.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified)
            VALUES (?, ?, ?, ?, ?, ?, 1)
          `).bind(userId, provider, providerUserId, providerUsername, profileUrl, avatarUrl).run();
        }
      }

      // 3. Automatic ContentDB & Git Package Matching (Zero-Click Claiming!)
      if (provider !== 'contentdb') {
        await context.env.DB.prepare(`
          UPDATE packages SET author_id = ?
          WHERE (author_id IS NULL OR author_id LIKE 'ext_%')
            AND (LOWER(author_name) = LOWER(?) OR LOWER(repo_url) LIKE LOWER(?))
        `).bind(userId, providerUsername, `%/${providerUsername}/%`).run();
      }

      // Sync upstream ContentDB packages authored by this verified username
      await syncAuthorContentDbPackages(context.env.DB, userId, providerUsername);
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

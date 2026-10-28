import { createSessionToken, verifySessionToken, parseCookies } from '../lib/session';

interface Env {
  DB?: any;
  CODEBERG_CLIENT_ID?: string;
  CODEBERG_CLIENT_SECRET?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  CONTENTDB_CLIENT_ID?: string;
  CONTENTDB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
}

export async function onRequestGet(context: { params: { provider: string }; request: Request; env: Env }) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const redirectUri = `${url.origin}/api/auth/${provider}/callback`;

  if (!code) {
    return Response.redirect(`${url.origin}/?auth_error=No+code+provided`, 302);
  }

  try {
    let providerUserId = '';
    let providerUsername = '';
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
      const tokenData = await tokenRes.json() as any;
      const userRes = await fetch('https://codeberg.org/api/v1/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json() as any;
      providerUserId = String(user.id);
      providerUsername = user.username;
      avatarUrl = user.avatar_url;
      profileUrl = `https://codeberg.org/${user.username}`;

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
      const tokenData = await tokenRes.json() as any;
      const userRes = await fetch('https://gitlab.com/api/v4/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json() as any;
      providerUserId = String(user.id);
      providerUsername = user.username;
      avatarUrl = user.avatar_url;
      profileUrl = user.web_url;

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
      const tokenData = await tokenRes.json() as any;
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': 'LuantiHub'
        }
      });
      const user = await userRes.json() as any;
      providerUserId = String(user.id);
      providerUsername = user.login;
      avatarUrl = user.avatar_url;
      profileUrl = user.html_url;

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
      const tokenData = await tokenRes.json() as any;
      const whoamiRes = await fetch('https://content.luanti.org/api/whoami/', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await whoamiRes.json() as any;
      providerUserId = user.username;
      providerUsername = user.username;
      avatarUrl = `https://content.luanti.org/users/${user.username}/avatar/`;
      profileUrl = `https://content.luanti.org/users/${user.username}/`;
    }

    if (!providerUsername) {
      return Response.redirect(`${url.origin}/?auth_error=Authentication+failed`, 302);
    }

    // 2. Identify or Create User in Cloudflare D1
    let userId: string | null = null;
    const cookies = parseCookies(context.request);
    const existingSessionUserId = cookies['lh_session'] 
      ? await verifySessionToken(cookies['lh_session'], context.env.SESSION_SECRET)
      : null;

    if (context.env.DB) {
      if (existingSessionUserId) {
        // User is ALREADY logged in -> LINK IDENTITY to existing user!
        userId = existingSessionUserId;
        await context.env.DB.prepare(`
          INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider, provider_user_id) DO UPDATE SET
            user_id = excluded.user_id,
            provider_username = excluded.provider_username,
            avatar_url = excluded.avatar_url
        `).bind(userId, provider, providerUserId, providerUsername, profileUrl, avatarUrl).run();

      } else {
        // Find existing linked identity
        const existingIdentity = await context.env.DB.prepare(`
          SELECT user_id FROM user_identities WHERE provider = ? AND provider_user_id = ?
        `).bind(provider, providerUserId).first();

        if (existingIdentity) {
          userId = existingIdentity.user_id;
        } else {
          // Create brand new core user
          userId = crypto.randomUUID();
          await context.env.DB.prepare(`
            INSERT INTO users (id, username, display_name, avatar_url)
            VALUES (?, ?, ?, ?)
          `).bind(userId, providerUsername, providerUsername, avatarUrl).run();

          // Link first identity
          await context.env.DB.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(userId, provider, providerUserId, providerUsername, profileUrl, avatarUrl).run();
        }
      }

      // 3. Automatic ContentDB Package Matching (Zero-Click Claiming!)
      // If user connects GitHub, Codeberg, or GitLab, link packages whose repo_url points to them
      if (provider !== 'contentdb') {
        await context.env.DB.prepare(`
          UPDATE packages SET author_id = ? 
          WHERE author_id IS NULL AND repo_url LIKE ?
        `).bind(userId, `%${providerUsername}%`).run();
      }
    }

    // 4. Issue Secure HTTP-Only Session Cookie
    const sessionToken = await createSessionToken(userId || 'demo_user', context.env.SESSION_SECRET);
    const isHttps = url.protocol === 'https:';

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/?auth_success=1`,
        'Set-Cookie': `lh_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 30}${isHttps ? '; Secure' : ''}`
      }
    });

  } catch (err: any) {
    return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent(err.message || 'Auth failure')}`, 302);
  }
}

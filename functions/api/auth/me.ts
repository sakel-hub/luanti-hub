import { verifySessionToken, parseCookies } from './lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];

  if (!sessionToken) {
    return Response.json({ user: null });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId) {
    return Response.json({ user: null });
  }

  if (!context.env.DB) {
    // Development fallback
    return Response.json({
      user: {
        id: userId,
        username: 'dev_modder',
        display_name: 'Developer Modder',
        avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
        identities: [
          { provider: 'codeberg', username: 'dev_modder', profile_url: 'https://codeberg.org/dev_modder' },
          { provider: 'github', username: 'dev_modder', profile_url: 'https://github.com/dev_modder' }
        ],
        packages: []
      }
    });
  }

  // 1. Fetch User Record
  const user = await context.env.DB.prepare(
    `SELECT * FROM users WHERE id = ?`
  ).bind(userId).first();

  if (!user) {
    return Response.json({ user: null });
  }

  // 2. Fetch Linked Identities
  const identities = await context.env.DB.prepare(
    `SELECT provider, provider_username as username, profile_url, avatar_url, verified, created_at 
     FROM user_identities WHERE user_id = ?`
  ).bind(userId).all();

  // 3. Fetch User's Packages (both ContentDB claimed & Git)
  const packages = await context.env.DB.prepare(
    `SELECT id, author_name, name, title, type, short_desc, thumbnail_url, score, downloads_count, repo_url, status 
     FROM packages WHERE author_id = ? ORDER BY downloads_count DESC`
  ).bind(userId).all();

  return Response.json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name || user.username,
      avatar_url: user.avatar_url,
      bio: user.bio,
      identities: identities.results || [],
      packages: packages.results || []
    }
  }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}

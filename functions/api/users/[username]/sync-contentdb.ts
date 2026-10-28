// Link ContentDB Account & Sync Packages to LuantiHub Profile
import { verifySessionToken, parseCookies } from '../../auth/lib/session';
import { fetchWithFailover } from '../../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

export async function onRequestPost(context: { params: { username: string }; request: Request; env: Env }) {
  const { username } = context.params;
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];

  if (!sessionToken) {
    return Response.json({ error: 'Please log in to link your ContentDB account.' }, { status: 401 });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  try {
    // 1. Fetch Packages from ContentDB (with mirror failover)
    const cdbRes = await fetchWithFailover(`/packages/?author=${encodeURIComponent(username)}`);
    const packages = await cdbRes.json() as any[];

    if (!Array.isArray(packages)) {
      return Response.json({ error: 'Could not fetch packages from ContentDB.' }, { status: 404 });
    }

    if (context.env.DB) {
      // 2. Link Identity to User
      await context.env.DB.prepare(`
        INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url)
        VALUES (?, 'contentdb', ?, ?, ?, ?)
        ON CONFLICT(provider, provider_user_id) DO UPDATE SET
          user_id = excluded.user_id,
          provider_username = excluded.provider_username
      `).bind(
        userId, 
        username, 
        username, 
        `https://content.luanti.org/users/${username}/`,
        `https://content.luanti.org/users/${username}/avatar/`
      ).run();

      // 3. Upsert packages and associate with user
      for (const p of packages) {
        const pkgId = `${p.author}/${p.name}`;
        await context.env.DB.prepare(`
          INSERT INTO packages (
            id, author_id, author_name, name, title, type, short_desc, 
            repo_url, provider, thumbnail_url, score, downloads_count, 
            license, media_license, status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'contentdb', ?, ?, ?, 'MIT', 'CC-BY-SA-3.0', 'active')
          ON CONFLICT(id) DO UPDATE SET
            author_id = excluded.author_id,
            score = excluded.score,
            downloads_count = excluded.downloads_count
        `).bind(
          pkgId, userId, p.author, p.name, p.title, p.type || 'mod',
          p.short_desc || '', p.repo_url || '', p.thumbnail || '',
          p.score || 5.0, p.downloads || 0
        ).run();
      }
    }

    return Response.json({
      success: true,
      syncedCount: packages.length,
      packages: packages.map(p => ({
        id: `${p.author}/${p.name}`,
        title: p.title,
        type: p.type
      }))
    });

  } catch (err: any) {
    return Response.json({ error: err.message || 'Failed to sync ContentDB account.' }, { status: 500 });
  }
}

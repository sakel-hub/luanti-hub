// Link ContentDB Author Account & Sync Packages to LuantiHub Profile
import { verifySessionToken, parseCookies, checkIsAdmin } from '../../auth/lib/session';
import { syncAuthorContentDbPackages, sanitizePublicErrorMessage } from '../../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestPost(context: { params: { username: string }; request: Request; env: Env }) {
  const rawUsername = (context.params.username || '').trim();
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];

  if (!sessionToken) {
    return Response.json({ error: 'Please sign in to link your ContentDB author account.' }, { status: 401 });
  }

  const userId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!userId) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  if (!rawUsername || !/^[a-zA-Z0-9_.-]{2,39}$/.test(rawUsername)) {
    return Response.json({ error: 'Invalid ContentDB username.' }, { status: 400 });
  }

  try {
    let isVerifiedOwnerOrAdmin = false;

    if (context.env.DB) {
      // Check if another user already owns a verified ContentDB identity for this username
      const existingOwner = await context.env.DB.prepare(`
        SELECT user_id, verified FROM user_identities
        WHERE provider = 'contentdb' AND LOWER(provider_user_id) = LOWER(?)
      `).bind(rawUsername.toLowerCase()).first() as { user_id: string; verified: number } | null;

      if (existingOwner && existingOwner.user_id !== userId && existingOwner.verified === 1) {
        return Response.json(
          { error: `ContentDB author "${rawUsername}" is already claimed by a verified account.` },
          { status: 403 }
        );
      }

      // Check if current user has a verified identity matching this username or is admin
      const userRecord = await context.env.DB.prepare(`SELECT username, role FROM users WHERE id = ?`).bind(userId).first();
      const userIdentitiesRes = await context.env.DB.prepare(
        `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
      ).bind(userId).all();
      const userIdentities = (userIdentitiesRes.results || []) as Array<{ provider: string; username: string; verified: number }>;

      const isAdmin = checkIsAdmin(userRecord, userIdentities, context.env.ADMIN_USERS);
      const hasMatchingVerifiedIdentity = userIdentities.some(
        id => Boolean(id.verified) && id.username.toLowerCase() === rawUsername.toLowerCase()
      );
      isVerifiedOwnerOrAdmin = isAdmin || hasMatchingVerifiedIdentity;
    }

    // 1. Fetch & Sync Packages from ContentDB by author (with mirror failover & clean score/license mapping)
    const authorPackages = context.env.DB
      ? await syncAuthorContentDbPackages(context.env.DB, userId, rawUsername)
      : [];

    const canonicalAuthor = authorPackages[0]?.author || rawUsername;

    if (context.env.DB) {
      // 2. Link ContentDB Identity to User (only mark verified = 1 if user owns matching verified handle)
      await context.env.DB.prepare(`
        INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified)
        VALUES (?, 'contentdb', ?, ?, ?, ?, ?)
        ON CONFLICT(provider, provider_user_id) DO UPDATE SET
          user_id = CASE WHEN user_identities.verified = 1 AND excluded.verified = 0 THEN user_identities.user_id ELSE excluded.user_id END,
          provider_username = excluded.provider_username,
          verified = MAX(user_identities.verified, excluded.verified)
      `).bind(
        userId,
        canonicalAuthor.toLowerCase(),
        canonicalAuthor,
        `https://content.luanti.org/users/${canonicalAuthor}/`,
        `https://content.luanti.org/users/${canonicalAuthor}/avatar/`,
        isVerifiedOwnerOrAdmin ? 1 : 0
      ).run();
    }

    return Response.json({
      success: true,
      syncedCount: authorPackages.length,
      author: canonicalAuthor,
      packages: authorPackages.map((p: any) => ({
        id: `${p.author}/${p.name}`,
        author: p.author,
        name: p.name,
        title: p.title || p.name,
        type: p.type || 'mod',
        downloads: p.downloads || 0
      }))
    });

  } catch (err: any) {
    return Response.json({ error: sanitizePublicErrorMessage(err, 'Failed to sync ContentDB account.') }, { status: 500 });
  }
}

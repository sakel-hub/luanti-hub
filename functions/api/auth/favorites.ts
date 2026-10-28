import { verifySessionToken, parseCookies } from './lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

function sanitizeClientId(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned.length >= 8 ? `anon_${cleaned.replace(/^anon_/, '')}` : null;
}

async function resolveUserOrClientId(
  request: Request,
  env: Env,
  bodyClientId?: string
): Promise<{ userId: string; isGuest: boolean } | null> {
  const cookies = parseCookies(request);
  const sessionToken = cookies['lh_session'];
  if (sessionToken) {
    const verifiedUserId = await verifySessionToken(sessionToken, env.SESSION_SECRET);
    if (verifiedUserId) {
      return { userId: verifiedUserId, isGuest: false };
    }
  }

  const url = new URL(request.url);
  const candidate =
    bodyClientId ||
    request.headers.get('X-Client-Id') ||
    url.searchParams.get('clientId');
  const guestId = sanitizeClientId(candidate);
  if (guestId) {
    return { userId: guestId, isGuest: true };
  }
  return null;
}

// GET /api/auth/favorites: Retrieve user's or guest client's synced favorites from Cloudflare D1
export async function onRequestGet(context: { request: Request; env: Env }) {
  if (!context.env.DB) {
    return Response.json({ favorites: [] });
  }

  const identity = await resolveUserOrClientId(context.request, context.env);
  if (!identity) {
    return Response.json({ favorites: [] });
  }

  try {
    const res = await context.env.DB.prepare(
      `SELECT package_id FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(identity.userId).all();

    return Response.json({
      favorites: (res.results || []).map((r: any) => r.package_id)
    });
  } catch {
    return Response.json({ favorites: [] });
  }
}

// POST /api/auth/favorites: Track add, remove, or bulk-sync user/guest favorites in Cloudflare D1
export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    const body = await context.request.json().catch(() => ({})) as {
      action: 'add' | 'remove' | 'sync';
      packageId?: string;
      packageIds?: string[];
      clientId?: string;
    };

    const identity = await resolveUserOrClientId(context.request, context.env, body.clientId);
    if (!identity) {
      return Response.json({ success: true, favorites: [], persisted: false });
    }

    if (!context.env.DB) {
      return Response.json({
        success: true,
        favorites: body.packageIds || (body.packageId ? [body.packageId] : []),
        persisted: false
      });
    }

    // Ensure foreign-key parent row exists in `users` for anonymous client tracking
    if (identity.isGuest) {
      await context.env.DB.prepare(
        `INSERT OR IGNORE INTO users (id, username, display_name, role) VALUES (?, ?, 'Guest Explorer', 'user')`
      ).bind(identity.userId, identity.userId).run();
    }

    if (body.action === 'add' && body.packageId) {
      await context.env.DB.prepare(
        `INSERT OR IGNORE INTO user_favorites (user_id, package_id) VALUES (?, ?)`
      ).bind(identity.userId, body.packageId).run();
    } else if (body.action === 'remove' && body.packageId) {
      await context.env.DB.prepare(
        `DELETE FROM user_favorites WHERE user_id = ? AND LOWER(package_id) = LOWER(?)`
      ).bind(identity.userId, body.packageId).run();
    } else if (body.action === 'sync' && Array.isArray(body.packageIds)) {
      for (const pkgId of body.packageIds.slice(0, 200)) {
        if (pkgId && typeof pkgId === 'string' && pkgId.includes('/')) {
          await context.env.DB.prepare(
            `INSERT OR IGNORE INTO user_favorites (user_id, package_id) VALUES (?, ?)`
          ).bind(identity.userId, pkgId).run();
        }
      }
    }

    const updated = await context.env.DB.prepare(
      `SELECT package_id FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(identity.userId).all();

    return Response.json({
      success: true,
      persisted: true,
      favorites: (updated.results || []).map((r: any) => r.package_id)
    });
  } catch (err: any) {
    return Response.json({ error: err.message || 'Failed to sync favorites.' }, { status: 500 });
  }
}

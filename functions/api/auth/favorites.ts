import { verifySessionToken, parseCookies } from './lib/session';
import { sanitizePublicErrorMessage } from '../lib/upstream';

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

    const VALID_PKG_ID_RE = /^[a-zA-Z0-9_.-]{1,64}\/[a-zA-Z0-9_.-]{1,100}$/;

    if (body.action === 'add' && body.packageId) {
      const cleanId = String(body.packageId).trim();
      if (!VALID_PKG_ID_RE.test(cleanId)) {
        return Response.json({ error: 'Invalid package identifier.' }, { status: 400 });
      }
      await context.env.DB.prepare(
        `INSERT OR IGNORE INTO user_favorites (user_id, package_id) VALUES (?, ?)`
      ).bind(identity.userId, cleanId).run();
    } else if (body.action === 'remove' && body.packageId) {
      const cleanId = String(body.packageId).trim();
      if (!VALID_PKG_ID_RE.test(cleanId)) {
        return Response.json({ error: 'Invalid package identifier.' }, { status: 400 });
      }
      await context.env.DB.prepare(
        `DELETE FROM user_favorites WHERE user_id = ? AND LOWER(package_id) = LOWER(?)`
      ).bind(identity.userId, cleanId).run();
    } else if (body.action === 'sync' && Array.isArray(body.packageIds)) {
      const validIds = Array.from(
        new Set(
          body.packageIds
            .slice(0, 200)
            .map((p) => (typeof p === 'string' ? p.trim() : ''))
            .filter((p) => VALID_PKG_ID_RE.test(p))
        )
      );
      if (validIds.length > 0) {
        const stmts = validIds.map((pkgId) =>
          context.env.DB.prepare(
            `INSERT OR IGNORE INTO user_favorites (user_id, package_id) VALUES (?, ?)`
          ).bind(identity.userId, pkgId)
        );
        if (typeof context.env.DB.batch === 'function') {
          await context.env.DB.batch(stmts);
        } else {
          for (const stmt of stmts) {
            await stmt.run();
          }
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
    return Response.json({ error: sanitizePublicErrorMessage(err, 'Failed to sync favorites.') }, { status: 500 });
  }
}

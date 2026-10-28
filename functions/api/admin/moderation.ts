// Admin Moderation Queue & Kill Switch Status Dashboard Endpoint
import { verifySessionToken, parseCookies, checkIsAdmin } from '../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json({ reports: [], moderatedPackages: [] });
  }

  const cookies = parseCookies(request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!userId) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }

  const currentUser = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
  const idRes = await env.DB.prepare(
    `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
  ).bind(userId).all();
  const identities = idRes.results || [];

  if (!checkIsAdmin(currentUser, identities, env.ADMIN_USERS)) {
    return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
  }

  try {
    const reportsRes = await env.DB.prepare(`
      SELECT
        r.id,
        r.package_id,
        r.reporter_user_id,
        r.reason,
        r.details,
        r.status,
        r.resolved_by,
        r.resolved_at,
        r.created_at,
        p.title AS package_title,
        p.status AS package_status,
        u.username AS reporter_username
      FROM moderation_reports r
      LEFT JOIN packages p ON LOWER(p.id) = LOWER(r.package_id)
      LEFT JOIN users u ON u.id = r.reporter_user_id
      ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT 100
    `).all();

    const moderatedRes = await env.DB.prepare(`
      SELECT id, author_name AS author, name, title, type, status, status_reason AS moderation_reason, status_reason, flagged_at, updated_at
      FROM packages
      WHERE status IN ('flagged', 'delisted')
      ORDER BY updated_at DESC
    `).all();

    return Response.json({
      reports: reportsRes.results || [],
      moderatedPackages: moderatedRes.results || [],
      delistedPackages: moderatedRes.results || []
    }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (err: any) {
    return Response.json({ reports: [], moderatedPackages: [], error: err.message });
  }
}

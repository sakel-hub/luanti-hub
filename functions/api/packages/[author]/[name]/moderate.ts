// Community Abuse Reporting & Instant Cloudflare D1 Kill Switch Endpoint
import { verifySessionToken, parseCookies, checkIsAdmin } from '../../../auth/lib/session';
import { invalidateEdgeCacheKeys } from '../../../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
  KILL_SWITCH_SECRET?: string;
}

export async function onRequestPost(context: {
  params: { author: string; name: string };
  request: Request;
  env: Env;
}) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;
  const { request, env } = context;

  if (!env.DB) {
    return Response.json({ error: 'Database binding not available.' }, { status: 503 });
  }

  const cookies = parseCookies(request);
  const sessionToken = cookies['lh_session'];
  const userId = sessionToken ? await verifySessionToken(sessionToken, env.SESSION_SECRET) : null;

  let currentUser: any = null;
  let identities: Array<{ provider: string; username: string; verified?: number | boolean }> = [];
  if (userId) {
    currentUser = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
    const idRes = await env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(userId).all();
    identities = idRes.results || [];
  }

  const body = await request.json() as {
    action: 'report' | 'delist' | 'flag' | 'restore';
    reason?: 'dmca' | 'malware' | 'license' | 'broken' | 'inappropriate' | 'other';
    details?: string;
    reportId?: number;
  };

  // Mode 1: Community or Automated Git-404 Report Submission
  if (body.action === 'report') {
    const reason = body.reason || 'other';
    const details = (body.details || '').trim();
    if (!details || details.length < 5) {
      return Response.json({ error: 'Please provide details explaining the issue (at least 5 characters).' }, { status: 400 });
    }

    // Deduplicate open 'broken' reports for the same package so automated 404 Git health checks never spam admins
    if (reason === 'broken') {
      const existingOpen = await env.DB.prepare(`
        SELECT id FROM moderation_reports
        WHERE LOWER(package_id) = LOWER(?) AND reason = 'broken' AND status = 'open'
        LIMIT 1
      `).bind(packageId).first();

      if (existingOpen) {
        return Response.json({
          success: true,
          deduplicated: true,
          message: 'An open broken-repository report already exists in the moderation queue for this package.'
        });
      }
    }

    await env.DB.prepare(`
      INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status)
      VALUES (?, ?, ?, ?, 'open')
    `).bind(packageId, userId || 'system-git-monitor', reason, details.slice(0, 1000)).run();

    return Response.json({
      success: true,
      message: 'Report submitted to the LuantiHub moderation queue.'
    });
  }

  // Mode 2: Instant Kill Switch ('delist' | 'flag' | 'restore')
  const authHeader = request.headers.get('Authorization') || '';
  const hasSecretToken = Boolean(
    env.KILL_SWITCH_SECRET && authHeader === `Bearer ${env.KILL_SWITCH_SECRET}`
  );
  const isAdmin = hasSecretToken || checkIsAdmin(currentUser, identities, env.ADMIN_USERS);

  // Also check if the logged-in user is the verified owner of this package
  const existingPkg = await env.DB.prepare(
    `SELECT * FROM packages WHERE LOWER(id) = LOWER(?)`
  ).bind(packageId).first();

  const hasVerifiedAuthorIdentity = identities.some(
    id => (id.verified === 1 || id.verified === true) && id.username.toLowerCase() === author.toLowerCase()
  );

  const isPackageOwner = Boolean(
    userId && (
      hasVerifiedAuthorIdentity ||
      (existingPkg && existingPkg.author_id === userId && identities.some(id => id.verified === 1 || id.verified === true))
    )
  );

  if (!isAdmin && !isPackageOwner) {
    return Response.json({
      error: 'Forbidden: Only administrators or the verified package author can change package status.'
    }, { status: 403 });
  }

  const newStatus = body.action === 'delist'
    ? 'delisted'
    : body.action === 'flag'
      ? 'flagged'
      : 'active';

  const statusReason = (body.details || body.reason || (newStatus === 'active' ? null : 'Administrative takedown'));

  // Upsert package status in D1 so even upstream ContentDB packages can be immediately delisted via the Kill Switch!
  await env.DB.prepare(`
    INSERT INTO packages (
      id, author_name, name, title, type, repo_url, license, media_license, status, status_reason, flagged_at
    )
    VALUES (?, ?, ?, ?, 'mod', '', 'NONE', 'NONE', ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      status_reason = excluded.status_reason,
      flagged_at = CASE WHEN excluded.status = 'active' THEN NULL ELSE CURRENT_TIMESTAMP END,
      updated_at = CURRENT_TIMESTAMP
  `).bind(packageId, author, name, name, newStatus, statusReason).run();

  // Resolve any open reports for this package
  if (body.reportId) {
    const repStatus = newStatus === 'active' ? 'dismissed' : 'resolved';
    await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(repStatus, currentUser?.username || 'admin', body.reportId).run();
  } else if (newStatus !== 'active') {
    await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE LOWER(package_id) = LOWER(?) AND status = 'open'
    `).bind(currentUser?.username || 'admin', packageId).run();
  }

  await invalidateEdgeCacheKeys([
    '/__api_packages_v2',
    '/__api_packages_v2?boot=1',
    `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
  ]);

  return Response.json({
    success: true,
    package_id: packageId,
    status: newStatus,
    reason: statusReason
  });
}

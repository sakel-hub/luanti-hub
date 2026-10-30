// Community Abuse Reporting, Author Self-Delist/Remove & Instant Cloudflare D1 Kill Switch Endpoint
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount,
  verifyStrictPackageAuthorOwnership
} from '../../../auth/lib/session';
import { invalidateEdgeCacheKeys, ensureModerationColumns } from '../../../lib/upstream';

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
  const rawUserId = sessionToken ? await verifySessionToken(sessionToken, env.SESSION_SECRET) : null;

  let currentUser: any = null;
  let userId: string | null = rawUserId;
  let identities: Array<{ provider: string; username: string; verified?: number | boolean }> = [];
  if (rawUserId) {
    currentUser = (await reconcileAndMergeUserAccount(env.DB, rawUserId)) ||
      (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(rawUserId).first());
    if (currentUser?.id) {
      userId = String(currentUser.id);
    }
    const idRes = await env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(userId).all();
    identities = idRes.results || [];
  }

  const body = await request.json() as {
    action: 'report' | 'delist' | 'flag' | 'restore' | 'remove';
    reason?: 'dmca' | 'malware' | 'license' | 'broken' | 'inappropriate' | 'other';
    details?: string;
    resolutionNote?: string;
    reportId?: number | string;
  };

  await ensureModerationColumns(env.DB);

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

  // Mode 2: Author Self-Delist / Self-Remove or Admin Instant Kill Switch ('delist' | 'flag' | 'restore' | 'remove')
  const authHeader = request.headers.get('Authorization') || '';
  const hasSecretToken = Boolean(
    env.KILL_SWITCH_SECRET && authHeader === `Bearer ${env.KILL_SWITCH_SECRET}`
  );
  const isAdmin = hasSecretToken || checkIsAdmin(currentUser, identities, env.ADMIN_USERS);

  const existingPkg = await env.DB.prepare(
    `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
  ).bind(packageId, author, name).first();

  // Strictly verify cryptographic ownership on the exact forge provider where the package is hosted
  const isPackageOwner = verifyStrictPackageAuthorOwnership(
    currentUser || (userId ? { id: userId } : null),
    identities,
    existingPkg,
    author
  );

  if (!isAdmin && !isPackageOwner) {
    return Response.json({
      error: 'Forbidden: Only administrators or the cryptographically verified package author on the hosting Git forge can delist or remove this package.'
    }, { status: 403 });
  }

  // Prevent non-admin authors from restoring a package that was delisted by an administrator (e.g. DMCA/malware takedown)
  if (body.action === 'restore' && !isAdmin && existingPkg) {
    const existingReason = String(existingPkg.status_reason || '');
    const isAdminTakedown =
      existingReason.startsWith('[ADMIN]') ||
      existingReason.toLowerCase().includes('administrative takedown') ||
      existingReason.toLowerCase().includes('dmca') ||
      existingReason.toLowerCase().includes('malware');
    if (isAdminTakedown) {
      return Response.json({
        error: 'Forbidden: This package was delisted by an administrator and can only be restored by moderation staff.'
      }, { status: 403 });
    }
  }

  // Mode 2A: Permanent Removal of a Submitted Package from Luanti Hub D1 Registry (`action: 'remove'`)
  if (body.action === 'remove') {
    if (!existingPkg) {
      return Response.json({ error: 'Package not found in D1 registry.' }, { status: 404 });
    }
    const canonicalId = String(existingPkg.id || packageId);
    await env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(canonicalId).run().catch(() => {});
    await env.DB.prepare(`DELETE FROM moderation_reports WHERE LOWER(package_id) = LOWER(?)`).bind(canonicalId).run().catch(() => {});
    await env.DB.prepare(`DELETE FROM packages WHERE LOWER(id) = LOWER(?)`).bind(canonicalId).run();

    await invalidateEdgeCacheKeys([
      '/__api_packages_v2',
      '/__api_packages_v2?boot=1',
      `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
    ]);

    return Response.json({
      success: true,
      package_id: canonicalId,
      status: 'removed',
      message: 'Package permanently removed from Luanti Hub.'
    });
  }

  const newStatus = body.action === 'delist'
    ? 'delisted'
    : body.action === 'flag'
      ? 'flagged'
      : 'active';

  const rawReason = (body.details || body.reason || '').trim();
  const statusReason = newStatus === 'active'
    ? null
    : isAdmin && !isPackageOwner
      ? `[ADMIN] ${rawReason || 'Administrative takedown'}`
      : `[AUTHOR] ${rawReason || 'Self-delisted by package author'}`;

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
  const noteToSave = (body.resolutionNote || body.details || statusReason || '').trim() || null;
  if (body.reportId) {
    const repStatus = newStatus === 'active' ? 'dismissed' : 'resolved';
    await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = ?,
          resolution_note = COALESCE(?, resolution_note),
          resolved_by = ?,
          resolved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(repStatus, noteToSave, currentUser?.username || 'admin', body.reportId).run();
  } else {
    await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = 'resolved',
          resolution_note = COALESCE(?, resolution_note),
          resolved_by = ?,
          resolved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(package_id) = LOWER(?) AND status = 'open'
    `).bind(noteToSave, currentUser?.username || 'admin', packageId).run();
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

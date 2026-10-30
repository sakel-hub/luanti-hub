// Admin & Author Moderation Queue, Communication, Pagination & 404 Live Re-Check Endpoint
import { verifySessionToken, parseCookies, checkIsAdmin } from '../auth/lib/session';
import { ensureModerationColumns, fetchUpstreamJsonCached } from '../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

async function probePackageGitOnline(
  db: any,
  packageId: string
): Promise<{ online: boolean; checkedUrl: string }> {
  const [rawAuthor, rawName] = packageId.split('/');
  const author = (rawAuthor || '').trim();
  const name = (rawName || '').trim();

  let repoUrl = '';
  if (db) {
    try {
      const pkgRow = await db.prepare(
        `SELECT repo_url FROM packages WHERE LOWER(id) = LOWER(?) LIMIT 1`
      ).bind(packageId).first();
      if (pkgRow?.repo_url) {
        repoUrl = String(pkgRow.repo_url).trim();
      }
    } catch {
      // ignore
    }
  }

  if (!repoUrl && author && name) {
    const upstream = await fetchUpstreamJsonCached<any>(
      `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
      120
    );
    if (upstream?.repo) {
      repoUrl = String(upstream.repo).trim();
    }
  }

  const candidateUrls: string[] = [];
  if (repoUrl) {
    candidateUrls.push(repoUrl.replace(/\.git$/i, '').replace(/\/+$/, ''));
  }
  if (author && name) {
    candidateUrls.push(
      `https://codeberg.org/${author}/${name}`,
      `https://github.com/${author}/${name}`,
      `https://gitlab.com/${author}/${name}`
    );
  }

  const uniqueUrls = Array.from(new Set(candidateUrls));
  for (const url of uniqueUrls) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)'
        }
      });
      if (res.ok) {
        return { online: true, checkedUrl: url };
      }
      if (res.status === 405) {
        const getRes = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)'
          }
        });
        if (getRes.ok) {
          return { online: true, checkedUrl: url };
        }
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    online: false,
    checkedUrl: uniqueUrls[0] || `https://github.com/${packageId}`
  };
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json({
      reports: [],
      moderatedPackages: [],
      delistedPackages: [],
      openCount: 0,
      closedCount: 0,
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 1
    });
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

  await ensureModerationColumns(env.DB);

  const currentUser = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
  const idRes = await env.DB.prepare(
    `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
  ).bind(userId).all();
  const identities = idRes.results || [];

  const url = new URL(request.url);
  const isMineOnly = url.searchParams.get('mine') === '1';

  // Mode A: Reporter / Package Author fetching their own submitted reports & package alerts (Paginated)
  if (isMineOnly) {
    try {
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const pageSize = Math.min(25, Math.max(1, parseInt(url.searchParams.get('limit') || '5', 10) || 5));
      const offset = (page - 1) * pageSize;

      const verifiedHandles = identities
        .filter((i: any) => Boolean(i.verified))
        .map((i: any) => String(i.username || '').toLowerCase())
        .filter(Boolean);
      const authorHandles = Array.from(
        new Set([String(currentUser?.username || '').toLowerCase(), ...verifiedHandles].filter(Boolean))
      );

      const authorClause = authorHandles.length > 0
        ? `OR LOWER(SUBSTR(r.package_id, 1, INSTR(r.package_id, '/') - 1)) IN (${authorHandles.map(() => '?').join(', ')})`
        : '';

      const totalRes = await env.DB.prepare(`
        SELECT COUNT(*) AS cnt
        FROM moderation_reports r
        WHERE r.reporter_user_id = ? ${authorClause}
      `).bind(userId, ...authorHandles).first();
      const total = Number(totalRes?.cnt || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      const myReportsRes = await env.DB.prepare(`
        SELECT
          r.id,
          r.package_id,
          r.reporter_user_id,
          r.reason,
          r.details,
          r.status,
          r.resolution_note,
          r.resolved_by,
          r.resolved_at,
          r.created_at,
          COALESCE(r.updated_at, r.resolved_at, r.created_at) AS updated_at,
          p.title AS package_title,
          p.status AS package_status,
          u.username AS reporter_username
        FROM moderation_reports r
        LEFT JOIN packages p ON LOWER(p.id) = LOWER(r.package_id)
        LEFT JOIN users u ON u.id = r.reporter_user_id
        WHERE r.reporter_user_id = ? ${authorClause}
        ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, COALESCE(r.updated_at, r.created_at) DESC
        LIMIT ? OFFSET ?
      `).bind(userId, ...authorHandles, pageSize, offset).all();

      return Response.json(
        {
          reports: myReportsRes.results || [],
          total,
          page,
          pageSize,
          totalPages
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    } catch (err: any) {
      return Response.json({
        reports: [],
        total: 0,
        page: 1,
        pageSize: 5,
        totalPages: 1,
        error: err.message
      });
    }
  }

  // Mode B: Admin Paginated Moderation Queue
  if (!checkIsAdmin(currentUser, identities, env.ADMIN_USERS)) {
    return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
  }

  try {
    const statusFilter = (url.searchParams.get('status') || 'open').toLowerCase();
    const reasonFilter = (url.searchParams.get('reason') || 'all').toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(25, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10));
    const offset = (page - 1) * pageSize;

    // 1. Global Open vs Closed Counters
    const countsRes = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_cnt,
        SUM(CASE WHEN status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END) AS closed_cnt
      FROM moderation_reports
    `).first();
    const openCount = Number(countsRes?.open_cnt || 0);
    const closedCount = Number(countsRes?.closed_cnt || 0);

    // 2. Build Filtered Query + Total Count for Pagination
    const whereClauses: string[] = [];
    const bindParams: any[] = [];

    if (statusFilter === 'open') {
      whereClauses.push(`r.status = 'open'`);
    } else if (statusFilter === 'closed' || statusFilter === 'resolved' || statusFilter === 'dismissed') {
      whereClauses.push(`r.status IN ('resolved', 'dismissed')`);
    }

    if (reasonFilter && reasonFilter !== 'all') {
      whereClauses.push(`r.reason = ?`);
      bindParams.push(reasonFilter);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM moderation_reports r ${whereSql}`
    ).bind(...bindParams).first();
    const total = Number(totalRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const reportsRes = await env.DB.prepare(`
      SELECT
        r.id,
        r.package_id,
        r.reporter_user_id,
        r.reason,
        r.details,
        r.status,
        r.resolution_note,
        r.resolved_by,
        r.resolved_at,
        r.created_at,
        COALESCE(r.updated_at, r.resolved_at, r.created_at) AS updated_at,
        p.title AS package_title,
        p.status AS package_status,
        u.username AS reporter_username
      FROM moderation_reports r
      LEFT JOIN packages p ON LOWER(p.id) = LOWER(r.package_id)
      LEFT JOIN users u ON u.id = r.reporter_user_id
      ${whereSql}
      ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindParams, pageSize, offset).all();

    const moderatedRes = await env.DB.prepare(`
      SELECT id, author_name AS author, name, title, type, status, status_reason AS moderation_reason, status_reason, flagged_at, updated_at
      FROM packages
      WHERE status IN ('flagged', 'delisted')
      ORDER BY updated_at DESC
    `).all();

    return Response.json({
      reports: reportsRes.results || [],
      moderatedPackages: moderatedRes.results || [],
      delistedPackages: moderatedRes.results || [],
      openCount,
      closedCount,
      total,
      page,
      pageSize,
      totalPages
    }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (err: any) {
    return Response.json({
      reports: [],
      moderatedPackages: [],
      delistedPackages: [],
      openCount: 0,
      closedCount: 0,
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      error: err.message
    });
  }
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json({ error: 'Database binding not available.' }, { status: 503 });
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

  await ensureModerationColumns(env.DB);

  const currentUser = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first();
  const idRes = await env.DB.prepare(
    `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
  ).bind(userId).all();
  const identities = idRes.results || [];
  const isAdmin = checkIsAdmin(currentUser, identities, env.ADMIN_USERS);
  const actorUsername = currentUser?.username || 'moderator';

  const body = await request.json() as {
    action: 'dismiss' | 'resolve' | 'reopen' | 'reply' | 'recheck' | 'dismiss_all_broken' | 'clear_closed';
    reportId?: number | string;
    note?: string;
  };

  // Bulk Actions (Admin Only)
  if (body.action === 'dismiss_all_broken') {
    if (!isAdmin) {
      return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
    }
    const res = await env.DB.prepare(`
      UPDATE moderation_reports
      SET status = 'dismissed',
          resolution_note = COALESCE(?, 'Bulk dismissed automated 404 reports.'),
          resolved_by = ?,
          resolved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'open' AND reason = 'broken'
    `).bind(body.note?.trim() || null, actorUsername).run();

    return Response.json({
      success: true,
      updatedCount: Number(res?.meta?.changes || 0),
      message: 'All open broken-URL reports have been dismissed.'
    });
  }

  if (body.action === 'clear_closed') {
    if (!isAdmin) {
      return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
    }
    const res = await env.DB.prepare(`
      DELETE FROM moderation_reports WHERE status IN ('resolved', 'dismissed')
    `).run();

    return Response.json({
      success: true,
      deletedCount: Number(res?.meta?.changes || 0),
      message: 'Cleared resolved and dismissed moderation history.'
    });
  }

  // Single-Report Actions
  if (!body.reportId) {
    return Response.json({ error: 'reportId is required.' }, { status: 400 });
  }

  const reportRow = await env.DB.prepare(
    `SELECT * FROM moderation_reports WHERE id = ? LIMIT 1`
  ).bind(body.reportId).first();

  if (!reportRow) {
    return Response.json({ error: 'Moderation report not found.' }, { status: 404 });
  }

  const pkgOwnerPrefix = String(reportRow.package_id || '').split('/')[0]?.toLowerCase() || '';
  const verifiedHandles = identities
    .filter((i: any) => Boolean(i.verified))
    .map((i: any) => String(i.username || '').toLowerCase());
  const isPackageAuthor = Boolean(
    pkgOwnerPrefix && (
      String(currentUser?.username || '').toLowerCase() === pkgOwnerPrefix ||
      verifiedHandles.includes(pkgOwnerPrefix)
    )
  );
  const isReporter = Boolean(reportRow.reporter_user_id && String(reportRow.reporter_user_id) === String(userId));

  // Action: Live Re-Check 404 Repository URL
  if (body.action === 'recheck') {
    if (!isAdmin && !isPackageAuthor && !isReporter) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const probe = await probePackageGitOnline(env.DB, String(reportRow.package_id));
    if (probe.online) {
      const autoNote = `Repository verified online (HTTP 200 at ${probe.checkedUrl}). Report automatically resolved.`;
      await env.DB.prepare(`
        UPDATE moderation_reports
        SET status = 'resolved',
            resolution_note = ?,
            resolved_by = ?,
            resolved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(autoNote, actorUsername, reportRow.id).run();

      return Response.json({
        success: true,
        online: true,
        status: 'resolved',
        resolution_note: autoNote,
        message: autoNote
      });
    }

    const stillDownNote = body.note?.trim()
      ? body.note.trim()
      : `Re-checked ${probe.checkedUrl} — repository still returns HTTP 404.`;
    await env.DB.prepare(`
      UPDATE moderation_reports
      SET resolution_note = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(stillDownNote, reportRow.id).run();

    return Response.json({
      success: true,
      online: false,
      status: reportRow.status,
      resolution_note: stillDownNote,
      message: stillDownNote
    });
  }

  // Action: Reply / Add Communication Note (Admin, Package Author, or Reporter)
  if (body.action === 'reply') {
    if (!isAdmin && !isPackageAuthor && !isReporter) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const cleanNote = (body.note || '').trim();
    if (!cleanNote) {
      return Response.json({ error: 'Note message cannot be empty.' }, { status: 400 });
    }

    const roleTag = isAdmin ? 'Moderator' : isPackageAuthor ? 'Author' : 'Reporter';
    const formattedEntry = `[${roleTag} @${actorUsername}]: ${cleanNote}`;
    const combinedNote = reportRow.resolution_note
      ? `${reportRow.resolution_note}\n${formattedEntry}`
      : formattedEntry;

    await env.DB.prepare(`
      UPDATE moderation_reports
      SET resolution_note = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(combinedNote.slice(0, 2000), reportRow.id).run();

    return Response.json({
      success: true,
      status: reportRow.status,
      resolution_note: combinedNote.slice(0, 2000),
      message: 'Note added to moderation report.'
    });
  }

  // Action: Resolve, Dismiss, or Reopen Report (Admin or Package Author for broken reports)
  if (!isAdmin && !(isPackageAuthor && reportRow.reason === 'broken')) {
    return Response.json({ error: 'Admin privileges required to change report status.' }, { status: 403 });
  }

  const nextStatus =
    body.action === 'dismiss'
      ? 'dismissed'
      : body.action === 'reopen'
        ? 'open'
        : 'resolved';

  const cleanNote = (body.note || '').trim();
  const formattedNote = cleanNote
    ? (reportRow.resolution_note
        ? `${reportRow.resolution_note}\n[Moderator @${actorUsername}]: ${cleanNote}`
        : `[Moderator @${actorUsername}]: ${cleanNote}`)
    : (reportRow.resolution_note || (nextStatus === 'dismissed' ? 'Dismissed by moderator.' : 'Resolved by moderator.'));

  await env.DB.prepare(`
    UPDATE moderation_reports
    SET status = ?,
        resolution_note = ?,
        resolved_by = ?,
        resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE CURRENT_TIMESTAMP END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    nextStatus,
    formattedNote.slice(0, 2000),
    nextStatus === 'open' ? null : actorUsername,
    nextStatus,
    reportRow.id
  ).run();

  return Response.json({
    success: true,
    status: nextStatus,
    resolution_note: formattedNote.slice(0, 2000),
    message: `Report #${reportRow.id} marked as ${nextStatus}.`
  });
}

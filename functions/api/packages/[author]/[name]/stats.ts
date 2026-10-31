import {
  fetchUpstreamJsonCached,
  ensureExtendedPackageColumns,
  sanitizePublicErrorMessage
} from '../../../lib/upstream';
import {
  parseCookies,
  verifySessionToken,
  checkIsAdmin,
  reconcileAndMergeUserAccount,
  verifyStrictPackageAuthorOwnership
} from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildDateRange(days: number): {
  dates: string[];
  prevDates: string[];
  allDates: string[];
  startDate: string;
  endDate: string;
  prevStartDate: string;
} {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const totalDays = Math.min(365, Math.max(1, Math.round(days) || 30));

  const allDates: string[] = [];
  for (let i = totalDays * 2 - 1; i >= 0; i--) {
    const dt = new Date(todayUtc.getTime() - i * 86400000);
    allDates.push(formatUtcDate(dt));
  }

  const prevDates = allDates.slice(0, totalDays);
  const dates = allDates.slice(totalDays);
  return {
    dates,
    prevDates,
    allDates,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    prevStartDate: prevDates[0]
  };
}

export async function onRequestGet(context: {
  request: Request;
  params: { author: string; name: string };
  env: Env;
}) {
  const { request, env } = context;
  const safeDecode = (val: string) => {
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  };
  const author = safeDecode(context.params.author || '').trim();
  const name = safeDecode(context.params.name || '').trim();
  const packageId = `${author}/${name}`;

  if (!author || !name) {
    return Response.json({ error: 'Package author and name are required.' }, { status: 400 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Analytics database unavailable.' }, { status: 503 });
  }

  try {
    // 1. Authenticate caller and enforce strict Author or Admin visibility
    const cookies = parseCookies(request);
    const sessionToken = cookies['lh_session'];
    const sessionUserId = sessionToken
      ? await verifySessionToken(sessionToken, env.SESSION_SECRET)
      : null;

    if (!sessionUserId) {
      return Response.json(
        { error: 'Authentication required to view package analytics.' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const user = await reconcileAndMergeUserAccount(env.DB, sessionUserId);
    if (!user) {
      return Response.json(
        { error: 'User account not found.' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const idRes = await env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(user.id).all().catch(() => ({ results: [] }));
    const identities = (idRes?.results || []) as Array<{
      provider: string;
      username: string;
      verified?: number | boolean;
    }>;

    const isAdmin = checkIsAdmin(user, identities, env.ADMIN_USERS);

    await ensureExtendedPackageColumns(env.DB);
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const pkgRow = await env.DB.prepare(
      `SELECT id, author_id, author_name, name, title, type, provider, repo_url, contentdb_downloads, luantihub_downloads, downloads_count
       FROM packages
       WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?))
       LIMIT 1`
    ).bind(packageId, author, name, sanitizedName).first().catch(() => null);

    if (!isAdmin) {
      const strictOwns = pkgRow
        ? verifyStrictPackageAuthorOwnership(user, identities, pkgRow, author)
        : false;
      const verifiedIdentities = identities.filter(id => id.verified === 1 || id.verified === true);
      const lowerAuthor = author.toLowerCase();
      const baseAuthor = lowerAuthor.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
      const isPureGitInD1 = Boolean(pkgRow && pkgRow.provider && pkgRow.provider !== 'contentdb');
      const hasVerifiedHandleMatch = !isPureGitInD1 && verifiedIdentities.some(id => {
        const h = String(id.username || '').trim().toLowerCase();
        const b = h.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
        return h === lowerAuthor || (b.length > 0 && b === baseAuthor);
      });

      if (!strictOwns && !hasVerifiedHandleMatch) {
        return Response.json(
          { error: 'Access denied: Only the package author or an administrator can view these analytics.' },
          { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
        );
      }
    }

    // 2. Parse requested timeframe
    const reqUrl = new URL(request.url, 'https://luantihub.local');
    const daysParam = Number(reqUrl.searchParams.get('days') || 30);
    const days = [7, 30, 90, 365].includes(daysParam)
      ? daysParam
      : Math.min(365, Math.max(7, Math.round(daysParam) || 30));

    const { dates, prevDates, allDates, prevStartDate, endDate } = buildDateRange(days);
    const effectivePkgId = pkgRow?.id || packageId;
    const encAuthor = encodeURIComponent(pkgRow?.author_name || author);
    const encName = encodeURIComponent(pkgRow?.name || name);
    const isPureGitPkg = Boolean(pkgRow && pkgRow.provider && pkgRow.provider !== 'contentdb');

    // 3. Query D1 package_daily_downloads and upstream ContentDB /stats/ in parallel
    const [d1RowsRes, cdbStats] = await Promise.all([
      env.DB.prepare(`
        SELECT
          download_date,
          COALESCE(SUM(downloads_count), 0) as downloads_count,
          COALESCE(SUM(platform_luanti), 0) as platform_luanti,
          COALESCE(SUM(platform_web), 0) as platform_web,
          COALESCE(SUM(reason_new), 0) as reason_new,
          COALESCE(SUM(reason_update), 0) as reason_update,
          COALESCE(SUM(reason_dependency), 0) as reason_dependency,
          COALESCE(SUM(reason_web), 0) as reason_web,
          COALESCE(SUM(views_luanti), 0) as views_luanti,
          COALESCE(SUM(views_web), 0) as views_web
        FROM package_daily_downloads
        WHERE (LOWER(package_id) = LOWER(?) OR LOWER(package_id) = LOWER(?))
          AND download_date >= ?
          AND download_date <= ?
        GROUP BY download_date
        ORDER BY download_date ASC
      `).bind(effectivePkgId, packageId, prevStartDate, endDate).all().catch(() => ({ results: [] })),
      !isPureGitPkg
        ? fetchUpstreamJsonCached<any>(
            `/packages/${encAuthor}/${encName}/stats/?start=${prevStartDate}&end=${endDate}`,
            300
          ).catch(() => null)
        : Promise.resolve(null)
    ]);

    const d1ByDate = new Map<string, any>();
    for (const row of d1RowsRes?.results || []) {
      const dateKey = String(row.download_date || '').slice(0, 10);
      if (dateKey) d1ByDate.set(dateKey, row);
    }

    const cdbPlatformLuanti: number[] = Array.isArray(cdbStats?.downloads?.platform?.minetest)
      ? cdbStats.downloads.platform.minetest
      : [];
    const cdbPlatformOther: number[] = Array.isArray(cdbStats?.downloads?.platform?.other)
      ? cdbStats.downloads.platform.other
      : [];
    const cdbReasonNew: number[] = Array.isArray(cdbStats?.downloads?.reason?.new)
      ? cdbStats.downloads.reason.new
      : [];
    const cdbReasonUpdate: number[] = Array.isArray(cdbStats?.downloads?.reason?.update)
      ? cdbStats.downloads.reason.update
      : [];
    const cdbReasonDep: number[] = Array.isArray(cdbStats?.downloads?.reason?.dependency)
      ? cdbStats.downloads.reason.dependency
      : [];
    const cdbReasonOther: number[] = Array.isArray(cdbStats?.downloads?.reason?.other)
      ? cdbStats.downloads.reason.other
      : [];
    const cdbViews: number[] = Array.isArray(cdbStats?.views) ? cdbStats.views : [];

    // Compute previous period total downloads for velocity delta %
    let prevPeriodDownloads = 0;
    for (let i = 0; i < prevDates.length; i++) {
      const dt = prevDates[i];
      const d1Row = d1ByDate.get(dt);
      const lhCount = Number(d1Row?.downloads_count) || 0;
      const cdbCount = (Number(cdbPlatformLuanti[i]) || 0) + (Number(cdbPlatformOther[i]) || 0);
      prevPeriodDownloads += lhCount + cdbCount;
    }

    // Build dense daily arrays for the active period [dates[0] .. dates[days - 1]]
    const total: number[] = [];
    const source_contentdb: number[] = [];
    const source_luantihub: number[] = [];
    const platform_luanti: number[] = [];
    const platform_web: number[] = [];
    const reason_new: number[] = [];
    const reason_update: number[] = [];
    const reason_dependency: number[] = [];
    const reason_web: number[] = [];
    const views_luanti: number[] = [];
    const views_web: number[] = [];

    const offset = prevDates.length;
    for (let j = 0; j < dates.length; j++) {
      const dt = dates[j];
      const cdbIdx = offset + j;
      const d1Row = d1ByDate.get(dt);

      const d1Total = Number(d1Row?.downloads_count) || 0;
      const d1PlatLuanti = Number(d1Row?.platform_luanti) || 0;
      const d1PlatWeb = Number(d1Row?.platform_web) || Math.max(0, d1Total - d1PlatLuanti);
      const d1RNew = Number(d1Row?.reason_new) || 0;
      const d1RUpd = Number(d1Row?.reason_update) || 0;
      const d1RDep = Number(d1Row?.reason_dependency) || 0;
      const d1RWeb = Number(d1Row?.reason_web) || Math.max(0, d1Total - (d1RNew + d1RUpd + d1RDep));
      const d1VLuanti = Number(d1Row?.views_luanti) || 0;
      const d1VWeb = Number(d1Row?.views_web) || 0;

      const cdbPlatLuanti = Number(cdbPlatformLuanti[cdbIdx]) || 0;
      const cdbPlatWeb = Number(cdbPlatformOther[cdbIdx]) || 0;
      const cdbTotal = cdbPlatLuanti + cdbPlatWeb;
      const cdbRNew = Number(cdbReasonNew[cdbIdx]) || 0;
      const cdbRUpd = Number(cdbReasonUpdate[cdbIdx]) || 0;
      const cdbRDep = Number(cdbReasonDep[cdbIdx]) || 0;
      const cdbROther =
        cdbReasonOther[cdbIdx] !== undefined
          ? Number(cdbReasonOther[cdbIdx]) || 0
          : Math.max(0, cdbTotal - (cdbRNew + cdbRUpd + cdbRDep));
      const cdbVLuanti = Number(cdbViews[cdbIdx]) || 0;

      const dayTotal = cdbTotal + d1Total;
      total.push(dayTotal);
      source_contentdb.push(cdbTotal);
      source_luantihub.push(d1Total);
      platform_luanti.push(cdbPlatLuanti + d1PlatLuanti);
      platform_web.push(cdbPlatWeb + d1PlatWeb);
      reason_new.push(cdbRNew + d1RNew);
      reason_update.push(cdbRUpd + d1RUpd);
      reason_dependency.push(cdbRDep + d1RDep);
      reason_web.push(cdbROther + d1RWeb);
      views_luanti.push(cdbVLuanti + d1VLuanti);
      views_web.push(d1VWeb);
    }

    const sumArr = (arr: number[]) => arr.reduce((acc, v) => acc + (Number(v) || 0), 0);
    const periodDownloads = sumArr(total);
    const sumNew = sumArr(reason_new);
    const sumUpdate = sumArr(reason_update);
    const sumDep = sumArr(reason_dependency);
    const sumWeb = sumArr(reason_web);
    const sumPlatLuanti = sumArr(platform_luanti);
    const sumPlatWeb = sumArr(platform_web);
    const sumSrcCdb = sumArr(source_contentdb);
    const sumSrcLh = sumArr(source_luantihub);
    const sumViewsLuanti = sumArr(views_luanti);
    const sumViewsWeb = sumArr(views_web);
    const totalViews = sumViewsLuanti + sumViewsWeb;

    const trendPercent =
      prevPeriodDownloads > 0
        ? Number((((periodDownloads - prevPeriodDownloads) / prevPeriodDownloads) * 100).toFixed(1))
        : periodDownloads > 0
          ? 100
          : 0;
    const avgPerDay = Number((periodDownloads / Math.max(1, dates.length)).toFixed(1));
    const conversionRatePercent =
      totalViews > 0
        ? Number(Math.min(100, (periodDownloads / totalViews) * 100).toFixed(1))
        : 0;

    return Response.json(
      {
        package_id: effectivePkgId,
        author: pkgRow?.author_name || author,
        name: pkgRow?.name || name,
        title: pkgRow?.title || name,
        days,
        dates,
        total,
        source_contentdb,
        source_luantihub,
        platform_luanti,
        platform_web,
        reason_new,
        reason_update,
        reason_dependency,
        reason_web,
        views_luanti,
        views_web,
        summary: {
          periodDownloads,
          prevPeriodDownloads,
          trendPercent,
          avgPerDay,
          totalViews,
          viewsLuanti: sumViewsLuanti,
          viewsWeb: sumViewsWeb,
          conversionRatePercent,
          reasonsTotal: {
            new: sumNew,
            update: sumUpdate,
            dependency: sumDep,
            web: sumWeb
          },
          platformsTotal: {
            luanti: sumPlatLuanti,
            web: sumPlatWeb
          },
          sourcesTotal: {
            contentdb: sumSrcCdb,
            luantihub: sumSrcLh
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store'
        }
      }
    );
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Failed to load package analytics.') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

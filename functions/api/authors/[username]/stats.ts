import {
  fetchUpstreamJsonCached,
  ensureExtendedPackageColumns,
  sanitizePublicErrorMessage
} from '../../lib/upstream';
import {
  parseCookies,
  verifySessionToken,
  checkIsAdmin,
  reconcileAndMergeUserAccount
} from '../../auth/lib/session';

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
  params: { username: string };
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
  const requestedUsername = safeDecode(context.params.username || '').trim();
  if (!requestedUsername) {
    return Response.json({ error: 'Author username is required.' }, { status: 400 });
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
        { error: 'Authentication required to view author analytics.' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const callerUser = await reconcileAndMergeUserAccount(env.DB, sessionUserId);
    if (!callerUser) {
      return Response.json(
        { error: 'User account not found.' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const callerIdRes = await env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(callerUser.id).all().catch(() => ({ results: [] }));
    const callerIdentities = (callerIdRes?.results || []) as Array<{
      provider: string;
      username: string;
      verified?: number | boolean;
    }>;

    const isAdmin = checkIsAdmin(callerUser, callerIdentities, env.ADMIN_USERS);
    const lowerReq = requestedUsername.toLowerCase();
    const baseReq = lowerReq.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, '');

    const callerHandles = new Set<string>();
    const hasVerifiedIdentity = callerIdentities.some(
      id => id.verified === 1 || id.verified === true
    );
    if (hasVerifiedIdentity && callerUser.username) {
      const cu = String(callerUser.username).trim().toLowerCase();
      callerHandles.add(cu);
      callerHandles.add(cu.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, ''));
    }
    for (const id of callerIdentities) {
      if ((id.verified === 1 || id.verified === true) && id.username) {
        const h = String(id.username).trim().toLowerCase();
        callerHandles.add(h);
        callerHandles.add(h.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, ''));
      }
    }

    const isOwnAuthorProfile =
      callerHandles.has(lowerReq) || (baseReq.length > 0 && callerHandles.has(baseReq));

    if (!isAdmin && !isOwnAuthorProfile) {
      return Response.json(
        { error: 'Access denied: Only the author or an administrator can view these analytics.' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    await ensureExtendedPackageColumns(env.DB);

    // 2. Gather all linked handles for the target author
    const targetHandles = new Set<string>([lowerReq]);
    if (baseReq) targetHandles.add(baseReq);

    if (isOwnAuthorProfile) {
      for (const h of callerHandles) {
        if (h) targetHandles.add(h);
      }
    } else {
      // Admin inspecting another author: look up their user_identities if registered
      const targetUserRow = await env.DB.prepare(
        `SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
      ).bind(requestedUsername).first().catch(() => null);
      if (targetUserRow?.id) {
        const tIds = await env.DB.prepare(
          `SELECT provider_username as username FROM user_identities WHERE user_id = ?`
        ).bind(targetUserRow.id).all().catch(() => ({ results: [] }));
        for (const r of tIds?.results || []) {
          if (r?.username) {
            targetHandles.add(String(r.username).trim().toLowerCase());
          }
        }
      }
    }

    const handleList = Array.from(targetHandles).filter(Boolean);

    // 3. Parse requested timeframe
    const reqUrl = new URL(request.url, 'https://luantihub.local');
    const daysParam = Number(reqUrl.searchParams.get('days') || 30);
    const days = [7, 30, 90, 365].includes(daysParam)
      ? daysParam
      : Math.min(365, Math.max(7, Math.round(daysParam) || 30));

    const { dates, prevDates, prevStartDate, endDate } = buildDateRange(days);

    // 4. Query D1 packages & daily downloads for this author
    const placeholders = handleList.map(() => 'LOWER(?)').join(', ');
    const d1PkgsRes = await env.DB.prepare(`
      SELECT id, author_name, name, title, type, provider, contentdb_downloads, luantihub_downloads, downloads_count
      FROM packages
      WHERE status = 'active'
        AND (LOWER(author_name) IN (${placeholders}) OR LOWER(SUBSTR(id, 1, INSTR(id, '/') - 1)) IN (${placeholders}))
    `).bind(...handleList, ...handleList).all().catch(() => ({ results: [] }));

    const d1Pkgs: any[] = d1PkgsRes?.results || [];
    const likeConditions = handleList.map(() => `LOWER(package_id) LIKE ?`).join(' OR ');
    const likeBindings = handleList.map(h => `${h}/%`);

    const [d1DailyRes, cdbUserStats] = await Promise.all([
      env.DB.prepare(`
        SELECT
          package_id,
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
        WHERE (${likeConditions})
          AND download_date >= ?
          AND download_date <= ?
        GROUP BY package_id, download_date
        ORDER BY download_date ASC
      `).bind(...likeBindings, prevStartDate, endDate).all().catch(() => ({ results: [] })),
      fetchUpstreamJsonCached<any>(
        `/users/${encodeURIComponent(requestedUsername)}/stats/?start=${prevStartDate}&end=${endDate}`,
        300
      ).catch(() => null)
    ]);

    const d1AggByDate = new Map<string, {
      downloads_count: number;
      platform_luanti: number;
      platform_web: number;
      reason_new: number;
      reason_update: number;
      reason_dependency: number;
      reason_web: number;
      views_luanti: number;
      views_web: number;
    }>();

    const d1PkgDailyMap = new Map<string, Map<string, number>>();
    for (const row of d1DailyRes?.results || []) {
      const dt = String(row.download_date || '').slice(0, 10);
      const pkgId = String(row.package_id || '').trim();
      if (!dt) continue;

      const curr = d1AggByDate.get(dt) || {
        downloads_count: 0,
        platform_luanti: 0,
        platform_web: 0,
        reason_new: 0,
        reason_update: 0,
        reason_dependency: 0,
        reason_web: 0,
        views_luanti: 0,
        views_web: 0
      };
      const dl = Number(row.downloads_count) || 0;
      curr.downloads_count += dl;
      curr.platform_luanti += Number(row.platform_luanti) || 0;
      curr.platform_web += Number(row.platform_web) || 0;
      curr.reason_new += Number(row.reason_new) || 0;
      curr.reason_update += Number(row.reason_update) || 0;
      curr.reason_dependency += Number(row.reason_dependency) || 0;
      curr.reason_web += Number(row.reason_web) || 0;
      curr.views_luanti += Number(row.views_luanti) || 0;
      curr.views_web += Number(row.views_web) || 0;
      d1AggByDate.set(dt, curr);

      if (pkgId && dl > 0) {
        const lowerPkgId = pkgId.toLowerCase();
        if (!d1PkgDailyMap.has(lowerPkgId)) {
          d1PkgDailyMap.set(lowerPkgId, new Map<string, number>());
        }
        const pkgMap = d1PkgDailyMap.get(lowerPkgId)!;
        pkgMap.set(dt, (pkgMap.get(dt) || 0) + dl);
      }
    }

    const cdbPlatformLuanti: number[] = Array.isArray(cdbUserStats?.downloads?.platform?.minetest)
      ? cdbUserStats.downloads.platform.minetest
      : [];
    const cdbPlatformOther: number[] = Array.isArray(cdbUserStats?.downloads?.platform?.other)
      ? cdbUserStats.downloads.platform.other
      : [];
    const cdbReasonNew: number[] = Array.isArray(cdbUserStats?.downloads?.reason?.new)
      ? cdbUserStats.downloads.reason.new
      : [];
    const cdbReasonUpdate: number[] = Array.isArray(cdbUserStats?.downloads?.reason?.update)
      ? cdbUserStats.downloads.reason.update
      : [];
    const cdbReasonDep: number[] = Array.isArray(cdbUserStats?.downloads?.reason?.dependency)
      ? cdbUserStats.downloads.reason.dependency
      : [];
    const cdbReasonOther: number[] = Array.isArray(cdbUserStats?.downloads?.reason?.other)
      ? cdbUserStats.downloads.reason.other
      : [];
    const cdbViews: number[] = Array.isArray(cdbUserStats?.views) ? cdbUserStats.views : [];
    const cdbPkgDownloadsObj: Record<string, number[]> =
      cdbUserStats?.package_downloads && typeof cdbUserStats.package_downloads === 'object'
        ? cdbUserStats.package_downloads
        : {};

    // Previous period total downloads for velocity delta %
    let prevPeriodDownloads = 0;
    for (let i = 0; i < prevDates.length; i++) {
      const dt = prevDates[i];
      const d1Row = d1AggByDate.get(dt);
      const lhCount = Number(d1Row?.downloads_count) || 0;
      const cdbCount = (Number(cdbPlatformLuanti[i]) || 0) + (Number(cdbPlatformOther[i]) || 0);
      prevPeriodDownloads += lhCount + cdbCount;
    }

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
      const d1Row = d1AggByDate.get(dt);

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

    // 5. Build Per-Package Breakdown (merging D1 packages + ContentDB package_downloads)
    const pkgMetaByKey = new Map<string, {
      id: string;
      author: string;
      name: string;
      title: string;
      type: string;
      daily: number[];
    }>();

    for (const p of d1Pkgs) {
      const id = String(p.id || `${p.author_name || requestedUsername}/${p.name}`);
      const lowerId = id.toLowerCase();
      const dMap = d1PkgDailyMap.get(lowerId);
      const daily = dates.map(dt => Number(dMap?.get(dt)) || 0);
      pkgMetaByKey.set(lowerId, {
        id,
        author: String(p.author_name || requestedUsername),
        name: String(p.name || ''),
        title: String(p.title || p.name || id),
        type: String(p.type || 'mod'),
        daily
      });
    }

    // Include any package_id in d1PkgDailyMap not yet in pkgMetaByKey
    for (const [lowerId, dMap] of d1PkgDailyMap.entries()) {
      if (!pkgMetaByKey.has(lowerId)) {
        const parts = lowerId.split('/');
        const pAuthor = parts[0] || requestedUsername;
        const pName = parts[1] || lowerId;
        const daily = dates.map(dt => Number(dMap.get(dt)) || 0);
        pkgMetaByKey.set(lowerId, {
          id: `${pAuthor}/${pName}`,
          author: pAuthor,
          name: pName,
          title: pName.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          type: 'mod',
          daily
        });
      }
    }

    // Merge ContentDB package_downloads (keyed by package title in ContentDB)
    for (const [rawTitle, cdbArr] of Object.entries(cdbPkgDownloadsObj)) {
      if (!Array.isArray(cdbArr)) continue;
      const slicedCdb = dates.map((_, j) => Number(cdbArr[offset + j]) || 0);
      const cleanTitleLower = rawTitle.trim().toLowerCase();
      const slugGuess = cleanTitleLower.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

      let matchedEntry: { id: string; author: string; name: string; title: string; type: string; daily: number[] } | undefined;
      for (const entry of pkgMetaByKey.values()) {
        if (
          entry.title.trim().toLowerCase() === cleanTitleLower ||
          entry.name.trim().toLowerCase() === cleanTitleLower ||
          entry.name.trim().toLowerCase() === slugGuess
        ) {
          matchedEntry = entry;
          break;
        }
      }

      if (matchedEntry) {
        matchedEntry.daily = matchedEntry.daily.map((v, idx) => v + (slicedCdb[idx] || 0));
      } else {
        const syntheticId = `${requestedUsername}/${slugGuess || cleanTitleLower}`;
        pkgMetaByKey.set(syntheticId.toLowerCase(), {
          id: syntheticId,
          author: requestedUsername,
          name: slugGuess || cleanTitleLower,
          title: rawTitle,
          type: 'mod',
          daily: slicedCdb
        });
      }
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

    const package_breakdown = Array.from(pkgMetaByKey.values())
      .map(entry => {
        const totalPeriodDownloads = sumArr(entry.daily);
        const sharePercent =
          periodDownloads > 0
            ? Number(((totalPeriodDownloads / periodDownloads) * 100).toFixed(1))
            : 0;
        return {
          ...entry,
          totalPeriodDownloads,
          sharePercent
        };
      })
      .sort((a, b) => b.totalPeriodDownloads - a.totalPeriodDownloads || a.title.localeCompare(b.title));

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
        username: requestedUsername,
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
        package_breakdown,
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
      { error: sanitizePublicErrorMessage(err, 'Failed to load author analytics.') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

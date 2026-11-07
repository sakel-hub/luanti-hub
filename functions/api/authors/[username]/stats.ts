import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  ensureExtendedPackageColumns,
  sanitizePublicErrorMessage,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  buildAuthorStatsEdgeCacheKey,
  buildDualPeriodDateRange,
  computeCombinedTelemetryArrays
} from '../../lib/upstream';
import { shouldHonorAuthenticatedNoCache } from '../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestGet(context: {
  request: Request;
  params: { username: string };
  env: Env;
}) {
  const { request, env } = context;
  const requestedUsername = safeDecodeParam(context.params.username || '').trim();
  if (!requestedUsername) {
    return Response.json({ error: 'Author username is required.' }, { status: 400 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Analytics database unavailable.' }, { status: 503 });
  }

  try {
    const reqUrl = new URL(request.url, 'https://luantihub.local');
    const daysParam = Number(reqUrl.searchParams.get('days') || 30);
    const days = [7, 30, 90, 365].includes(daysParam)
      ? daysParam
      : Math.min(365, Math.max(7, Math.round(daysParam) || 30));
    const requestedNoCache =
      reqUrl.searchParams.get('nocache') === '1' || reqUrl.searchParams.get('refresh') === '1';
    const noCache = requestedNoCache
      ? await shouldHonorAuthenticatedNoCache(request, env.SESSION_SECRET, `author-stats:${requestedUsername}:${days}`)
      : false;

    const edgeCacheKey = buildAuthorStatsEdgeCacheKey(requestedUsername, days);
    if (!noCache) {
      const cached = await readEdgeCacheJson<any>(edgeCacheKey);
      if (cached) {
        return Response.json(cached, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=180, s-maxage=300, stale-while-revalidate=600'
          }
        });
      }
    }

    await ensureExtendedPackageColumns(env.DB);

    const lowerReq = requestedUsername.toLowerCase();
    const baseReq = lowerReq.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, '');

    // Gather all verified linked handles for the target author
    const targetHandles = new Set<string>([lowerReq]);
    if (baseReq) targetHandles.add(baseReq);

    const targetUserRow = await env.DB.prepare(
      `SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
    ).bind(requestedUsername).first().catch(() => null);
    let targetUserId = targetUserRow?.id;
    if (!targetUserId) {
      const idLookup = await env.DB.prepare(
        `SELECT user_id FROM user_identities WHERE LOWER(provider_username) = LOWER(?) AND verified = 1 LIMIT 1`
      ).bind(requestedUsername).first().catch(() => null);
      targetUserId = idLookup?.user_id;
    }
    if (targetUserId) {
      const tIds = await env.DB.prepare(
        `SELECT provider_username as username FROM user_identities WHERE user_id = ? AND verified = 1`
      ).bind(targetUserId).all().catch(() => ({ results: [] }));
      for (const r of tIds?.results || []) {
        if (r?.username) {
          targetHandles.add(String(r.username).trim().toLowerCase());
        }
      }
    }

    const handleList = Array.from(targetHandles).filter(Boolean);
    const { dates, prevDates, prevStartDate, endDate } = buildDualPeriodDateRange(days);

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

    const cdbPkgDownloadsObj: Record<string, number[]> =
      cdbUserStats?.package_downloads && typeof cdbUserStats.package_downloads === 'object'
        ? cdbUserStats.package_downloads
        : {};

    const telemetry = computeCombinedTelemetryArrays(dates, prevDates, d1AggByDate, cdbUserStats);
    const offset = prevDates.length;

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
    const periodDownloads = telemetry.summary.periodDownloads;

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

    const responsePayload = {
      username: requestedUsername,
      days,
      dates,
      ...telemetry,
      package_breakdown
    };

    await writeEdgeCacheJson(edgeCacheKey, responsePayload, 300);

    return Response.json(
      responsePayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=180, s-maxage=300, stale-while-revalidate=600'
        }
      }
    );
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Failed to load author analytics.') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

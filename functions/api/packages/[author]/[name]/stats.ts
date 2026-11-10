import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  ensureExtendedPackageColumns,
  sanitizePublicErrorMessage,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  buildPackageStatsEdgeCacheKey,
  buildDualPeriodDateRange,
  computeCombinedTelemetryArrays
} from '../../../lib/upstream';
import { shouldHonorAuthenticatedNoCache } from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestGet(context: {
  request: Request;
  params: { author: string; name: string };
  env: Env;
}) {
  const { request, env } = context;
  const author = safeDecodeParam(context.params.author || '').trim();
  const name = safeDecodeParam(context.params.name || '').trim();
  const packageId = `${author}/${name}`;

  if (!author || !name) {
    return Response.json({ error: 'Package author and name are required.' }, { status: 400 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Analytics database unavailable.' }, { status: 503 });
  }

  try {
    // Parse requested timeframe (snap strictly to canonical buckets to prevent Edge Cache fragmentation)
    const reqUrl = new URL(request.url, 'https://luantihub.local');
    const rawDays = Number(reqUrl.searchParams.get('days') || 30);
    const daysParam = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 30;
    const days = daysParam <= 7 ? 7 : daysParam <= 30 ? 30 : daysParam <= 90 ? 90 : 365;
    const requestedNoCache =
      reqUrl.searchParams.get('nocache') === '1' || reqUrl.searchParams.get('refresh') === '1';
    const noCache = requestedNoCache
      ? await shouldHonorAuthenticatedNoCache(request, env.SESSION_SECRET, `pkg-stats:${packageId}:${days}`)
      : false;

    const edgeCacheKey = buildPackageStatsEdgeCacheKey(author, name, days);
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
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    let pkgRow = await env.DB.prepare(
      `SELECT id, author_id, author_name, name, title, type, provider, repo_url, contentdb_downloads, luantihub_downloads, downloads_count
       FROM packages
       WHERE LOWER(id) = LOWER(?)
       LIMIT 1`
    ).bind(packageId).first().catch(() => null);
    if (!pkgRow) {
      pkgRow = await env.DB.prepare(
        `SELECT id, author_id, author_name, name, title, type, provider, repo_url, contentdb_downloads, luantihub_downloads, downloads_count
         FROM packages
         WHERE LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?)
         LIMIT 1`
      ).bind(author, name, sanitizedName).first().catch(() => null);
    }

    const { dates, prevDates, prevStartDate, endDate } = buildDualPeriodDateRange(days);
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

    const telemetry = computeCombinedTelemetryArrays(dates, prevDates, d1ByDate, cdbStats);
    const responsePayload = {
      package_id: effectivePkgId,
      author: pkgRow?.author_name || author,
      name: pkgRow?.name || name,
      title: pkgRow?.title || name,
      days,
      dates,
      ...telemetry
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
      { error: sanitizePublicErrorMessage(err, 'Failed to load package analytics.') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

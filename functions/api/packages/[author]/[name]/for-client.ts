import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  parseJsonArray,
  ensureExtendedPackageColumns,
  formatByteSize,
  fetchRepoSizeEstimateFromUrl,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  readEdgeCacheVariant,
  writeEdgeCacheVariant,
  resolveLocalizedPackageText,
  toLegacyLuantiClientThumbnailUrl,
  getCanonicalScreenshotKey,
  computeLuantiClientReleaseId,
  sanitizeLuantiEngineQueryParams,
  normalizeLuantiBaseAuthor,
  sanitizeLuantiTechnicalName,
  isPureGitD1Package,
  fetchGitSmartHttpRefs,
  syncDebouncedGitVersionStamp,
  invalidateEdgeCacheKeys,
  buildPackageCacheInvalidationKeys,
  FOR_CLIENT_CACHE_PREFIX,
  scanGitRepoMetadataCached,
  resolveGitProviderFromRepoUrl,
  runWithD1ColumnFallback
} from '../../../lib/upstream';
import {
  resolveJam2026SyntheticD1Detail,
  refreshJam2026D1PkgIfStale,
  resolveJam2026ClientScreenshotUrl
} from '../../../lib/jam-2026';
import { reconcilePackageDownloadCounts } from '../../../../../src/app/core/models/package.model';

interface Env {
  DB?: any;
}

const HYPERTEXT_HEAD = '<tag name=code color=#7bf font=mono> <tag name=action color=#4CDAFA hovercolor=#97EAFC>';
const recentClientViewWrites = new Map<string, number>();
const VIEW_WRITE_COOLDOWN_MS = 10 * 60 * 1000;

async function recordLuantiClientView(db: any, request: Request | undefined, packageId: string): Promise<void> {
  if (!db || !request || !packageId) return;
  const ua = (request.headers.get('User-Agent') || '').trim();
  if (!/^(?:luanti|minetest)\b/i.test(ua)) return;

  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous';
  const key = `${clientIp}:${packageId.toLowerCase()}`;
  const now = Date.now();
  const exp = recentClientViewWrites.get(key);
  if (exp && exp > now) return;
  if (recentClientViewWrites.size >= 1000) {
    for (const [k, v] of recentClientViewWrites) {
      if (v <= now || recentClientViewWrites.size >= 800) {
        recentClientViewWrites.delete(k);
      }
      if (recentClientViewWrites.size < 800) break;
    }
  }
  recentClientViewWrites.set(key, now + VIEW_WRITE_COOLDOWN_MS);

  try {
    await ensureExtendedPackageColumns(db);
    await db.prepare(`
      INSERT INTO package_daily_downloads (package_id, download_date, downloads_count, views_luanti)
      VALUES (?, DATE('now'), 0, 1)
      ON CONFLICT(package_id, download_date)
      DO UPDATE SET views_luanti = COALESCE(views_luanti, 0) + 1
    `).bind(packageId).run();
  } catch {
    // Non-blocking view telemetry
  }
}

function escapeHypertext(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

function formatInlineHypertext(line: string, linksMap: Record<string, string>): string {
  // Strip Markdown images ![alt](url) and convert [label](url) to clickable <action name=link_N><u>label</u></action>
  const withoutImages = String(line || '').replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  const tokens: Array<{ key: string; label: string }> = [];
  const withPlaceholders = withoutImages.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, label, url) => {
    const key = `link_${Object.keys(linksMap).length + 1}`;
    linksMap[key] = url;
    const idx = tokens.push({ key, label }) - 1;
    return `@@LH_LINK_${idx}@@`;
  });
  let formatted = escapeHypertext(withPlaceholders)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  formatted = formatted.replace(/@@LH_LINK_(\d+)@@/g, (_m, idxStr) => {
    const t = tokens[Number(idxStr)];
    return t ? `<action name=${t.key}><u>${escapeHypertext(t.label)}</u></action>` : '';
  });
  return formatted;
}

function markdownToLuantiHypertext(md: string, linksMap: Record<string, string>, title?: string): string {
  const raw = (md || '').trim();
  if (!raw) {
    return title ? `<big>${escapeHypertext(title)}</big>\n` : '';
  }

  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      out.push(`<code>${escapeHypertext(rawLine)}</code>`);
      continue;
    }
    const h12 = trimmed.match(/^#{1,2}\s+(.+)$/);
    if (h12) {
      out.push(`<big>${escapeHypertext(h12[1])}</big>`);
      continue;
    }
    const h35 = trimmed.match(/^#{3,5}\s+(.+)$/);
    if (h35) {
      out.push(`<b>${escapeHypertext(h35[1])}</b>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      out.push(`<img name=blank.png width=16 height=1>• ${formatInlineHypertext(bullet[1], linksMap)}`);
      continue;
    }
    out.push(formatInlineHypertext(rawLine, linksMap));
  }

  return out.join('\n') + '\n';
}

export async function onRequestGet(context: {
  request: Request;
  params: { author: string; name: string };
  env: Env;
  waitUntil?: (promise: Promise<any>) => void;
}) {
  const author = safeDecodeParam(context.params.author);
  const name = safeDecodeParam(context.params.name);
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  const pkgId = `${author}/${name}`;

  const reqUrl = context.request ? new URL(context.request.url) : new URL(`https://luantihub.org/api/packages/${encAuthor}/${encName}/for-client/`);
  const noCache =
    reqUrl.searchParams.get('nocache') === '1' ||
    reqUrl.searchParams.get('nocache') === 'true' ||
    (context.request?.headers?.get('Cache-Control') || '').toLowerCase().includes('no-cache');
  const rawLang =
    reqUrl.searchParams.get('lang') ||
    (context.request?.headers.get('Accept-Language') || '').split(',')[0]?.split('-')[0] ||
    'en';
  const normalizedLang = String(rawLang || 'en').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'en';
  const {
    formspecVersion,
    versionQuery,
    forClientQuery
  } = sanitizeLuantiEngineQueryParams(reqUrl.searchParams);
  const querySuffix = `?${forClientQuery}`;
  const variantKey = versionQuery || '__default';
  const edgeCacheKey = `https://cache.luantihub.internal${FOR_CLIENT_CACHE_PREFIX}/${normalizedLang}/${encAuthor.toLowerCase()}/${encName.toLowerCase()}/fsv=${encodeURIComponent(formspecVersion)}`;
  const cachedClient = !noCache
    ? await readEdgeCacheVariant<any>(edgeCacheKey, variantKey, !versionQuery)
    : null;
  if (cachedClient) {
    if (context.env.DB) {
      await recordLuantiClientView(context.env.DB, context.request, pkgId);
    }
    return new Response(JSON.stringify(cachedClient), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
        'X-LuantiHub-Cache': 'HIT-EDGE'
      }
    });
  }

  let d1Pkg: any = null;
  let lhDownloads = 0;
  let d1ReviewsCount = { positive: 0, neutral: 0, negative: 0 };

  if (context.env.DB) {
    try {
      await ensureExtendedPackageColumns(context.env.DB);
      const sanitizedName = sanitizeLuantiTechnicalName(name, name.toLowerCase());
      d1Pkg = await context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) LIMIT 1`
      ).bind(pkgId).first();
      if (!d1Pkg) {
        d1Pkg = await context.env.DB.prepare(
          `SELECT * FROM packages WHERE LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?) LIMIT 1`
        ).bind(author, name, sanitizedName).first();
      }

      if (!d1Pkg) {
        const baseAuthor = normalizeLuantiBaseAuthor(author);
        d1Pkg = await context.env.DB.prepare(
          `SELECT * FROM packages
           WHERE (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?)
             AND LOWER(REPLACE(REPLACE(author_name, '-hub', ''), '_hub', '')) = LOWER(?)
           LIMIT 1`
        ).bind(name, sanitizedName, baseAuthor).first();
      }

      if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
        return Response.json({
          error: 'This package has been delisted or suspended by moderation.',
          status: d1Pkg.status
        }, {
          status: 451,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      await recordLuantiClientView(context.env.DB, context.request, d1Pkg?.id || pkgId);

      const [dailySumRow, reviewRowsRes] = await Promise.all([
        context.env.DB.prepare(
          `SELECT COALESCE(SUM(downloads_count), 0) as total_lh FROM package_daily_downloads WHERE LOWER(package_id) = LOWER(?)`
        ).bind(d1Pkg?.id || pkgId).first().catch(() => null),
        context.env.DB.prepare(
          `SELECT rating FROM reviews WHERE LOWER(package_id) = LOWER(?)`
        ).bind(d1Pkg?.id || pkgId).all().catch(() => ({ results: [] }))
      ]);

      lhDownloads = Math.max(
        Number(d1Pkg?.luantihub_downloads) || 0,
        Number(dailySumRow?.total_lh) || 0
      );

      for (const rev of reviewRowsRes?.results || []) {
        const r = Number(rev.rating || 5);
        if (r >= 4) d1ReviewsCount.positive++;
        else if (r === 3) d1ReviewsCount.neutral++;
        else d1ReviewsCount.negative++;
      }
    } catch {
      // Ignore D1 lookup error
    }
  }

  const isPureGitPkg = isPureGitD1Package(d1Pkg, author);

  const data = !isPureGitPkg
    ? await fetchUpstreamJsonCached<any>(
        `/packages/${encAuthor}/${encName}/for-client/${querySuffix}`,
        300,
        { lang: normalizedLang }
      )
    : null;

  if (data && !Array.isArray(data) && (data.name || data.title)) {
    const recUpstreamClientDl = reconcilePackageDownloadCounts({
      contentdbDownloads: Math.max(Number(data.downloads) || 0, Number(d1Pkg?.contentdb_downloads) || 0),
      luantihubDownloads: lhDownloads,
      reportedTotalDownloads: Number(d1Pkg?.downloads_count) || 0,
      hasContentDbSource: true,
      isPureGitOnly: false
    });
    const cdbDownloads = recUpstreamClientDl.contentdbDownloads;
    const resolvedLhDownloads = recUpstreamClientDl.luantihubDownloads;
    const totalClientDownloads = recUpstreamClientDl.downloads;
    const baseReviews = data.reviews && typeof data.reviews === 'object'
      ? data.reviews
      : { positive: 0, neutral: 0, negative: 0 };
    const mergedReviews = {
      positive: (Number(baseReviews.positive) || 0) + d1ReviewsCount.positive,
      neutral: (Number(baseReviews.neutral) || 0) + d1ReviewsCount.neutral,
      negative: (Number(baseReviews.negative) || 0) + d1ReviewsCount.negative
    };
    const normalizedScreenshots = Array.isArray(data.screenshots)
      ? data.screenshots
          .map((s: any) => {
            const rawObj = typeof s === 'string' ? { url: s } : s;
            if (!rawObj?.url) return null;
            const normalizedUrl =
              toLegacyLuantiClientThumbnailUrl(rawObj.url) ||
              resolveJam2026ClientScreenshotUrl(rawObj.url) ||
              rawObj.url;
            return { ...rawObj, url: normalizedUrl };
          })
          .filter((s: any) => Boolean(s?.url))
      : [];
    const resolvedDownloadSize =
      (typeof data.download_size === 'string' && data.download_size.trim() ? data.download_size.trim() : null) ||
      (typeof data.download_size === 'number' && data.download_size > 0 ? formatByteSize(data.download_size) : null) ||
      (d1Pkg?.download_size && Number(d1Pkg.download_size) > 0 ? formatByteSize(d1Pkg.download_size) : null) ||
      (d1Pkg?.file_size && String(d1Pkg.file_size).trim() ? String(d1Pkg.file_size).trim() : null) ||
      '< 1 MB';
    const d1Warnings = parseJsonArray(d1Pkg?.content_warnings);
    const cdbWarnings = parseJsonArray(data.content_warnings);
    const mergedWarnings = Array.from(new Set([...d1Warnings, ...cdbWarnings]));
    const d1Loc = d1Pkg ? resolveLocalizedPackageText(d1Pkg, normalizedLang) : null;
    const hasD1LocOverride = Boolean(
      normalizedLang !== 'en' &&
      d1Pkg?.translations &&
      d1Loc &&
      (d1Loc.title !== (d1Pkg.title || d1Pkg.name) || d1Loc.short_desc !== (d1Pkg.short_desc || ''))
    );
    const enriched = {
      ...data,
      name: name || data.name,
      ...(hasD1LocOverride && d1Loc?.title ? { title: d1Loc.title } : {}),
      ...(hasD1LocOverride && d1Loc?.short_desc ? { short_description: d1Loc.short_desc } : {}),
      ...(d1Pkg?.dev_state ? { dev_state: d1Pkg.dev_state } : {}),
      content_warnings: mergedWarnings,
      download_size: resolvedDownloadSize,
      contentdb_downloads: cdbDownloads,
      luantihub_downloads: resolvedLhDownloads,
      downloads: totalClientDownloads,
      reviews: mergedReviews,
      screenshots: normalizedScreenshots
    };
    await writeEdgeCacheVariant(edgeCacheKey, variantKey, enriched, 300);
    return new Response(JSON.stringify(enriched), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
        'X-LuantiHub-Cache': 'MISS-EDGE'
      }
    });
  }

  if (!d1Pkg?.repo_url) {
    ({ d1Pkg } = await resolveJam2026SyntheticD1Detail(author, name, d1Pkg, [], noCache));
  } else {
    d1Pkg = await refreshJam2026D1PkgIfStale(d1Pkg, context.env.DB, noCache);
  }

  let healedPoisonedClientRow = false;
  if (
    d1Pkg &&
    d1Pkg.provider === 'contentdb' &&
    d1Pkg.repo_url &&
    !(Number(d1Pkg.contentdb_downloads || 0) > 0)
  ) {
    const vcsCatalog = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 1800).catch(() => null);
    if (Array.isArray(vcsCatalog) && vcsCatalog.length > 0) {
      const normName = String(d1Pkg.name || name).replace(/-/g, '_').toLowerCase();
      const targetAuthor = String(d1Pkg.author_name || author).trim().toLowerCase();
      const inCatalog = vcsCatalog.some(
        (p: any) =>
          String(p?.author || '').trim().toLowerCase() === targetAuthor &&
          String(p?.name || '').trim().replace(/-/g, '_').toLowerCase() === normName
      );
      if (!inCatalog) {
        healedPoisonedClientRow = true;
        const healedProvider = resolveGitProviderFromRepoUrl(d1Pkg.repo_url, 'github');
        const cleanedTags = parseJsonArray(d1Pkg.tags).filter(
          t => String(t || '').trim().toLowerCase() !== 'contentdb'
        );
        d1Pkg = {
          ...d1Pkg,
          provider: healedProvider,
          tags: JSON.stringify(cleanedTags)
        };
        if (context.env.DB && d1Pkg.id) {
          context.env.DB.prepare(
            `UPDATE packages SET provider = ?, tags = ? WHERE id = ?`
          ).bind(healedProvider, JSON.stringify(cleanedTags), d1Pkg.id).run().catch(() => {});
        }
      }
    }
  }

  if (
    d1Pkg &&
    d1Pkg.provider &&
    d1Pkg.provider !== 'contentdb' &&
    d1Pkg.repo_url &&
    !d1Pkg.metadata_synced_at &&
    Number(d1Pkg.license_override || 0) !== 1
  ) {
    const gitScan = await scanGitRepoMetadataCached(
      d1Pkg.author_name || author,
      d1Pkg.name || name,
      d1Pkg.type || 'mod',
      d1Pkg.repo_url,
      21600,
      { commitSha: d1Pkg.latest_commit_sha, bypassCache: noCache }
    ).catch(() => null);
    if (gitScan?.gitRepoStatus === 'verified') {
      const scannedLic = gitScan.license || gitScan.mediaLicense || '';
      const scannedMediaLic = gitScan.mediaLicense || scannedLic || '';
      d1Pkg = {
        ...d1Pkg,
        ...(scannedLic ? { license: scannedLic } : {}),
        ...(scannedMediaLic ? { media_license: scannedMediaLic } : {}),
        metadata_synced_at: new Date().toISOString()
      };
      if (context.env.DB && d1Pkg.id) {
        await runWithD1ColumnFallback(context.env.DB, () =>
          context.env.DB.prepare(
            `UPDATE packages
             SET license = CASE WHEN COALESCE(license_override, 0) = 0 AND ? IS NOT NULL AND ? != '' THEN ? ELSE license END,
                 media_license = CASE WHEN COALESCE(license_override, 0) = 0 AND ? IS NOT NULL AND ? != '' THEN ? ELSE media_license END,
                 metadata_synced_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(
            scannedLic || null,
            scannedLic || null,
            scannedLic || null,
            scannedMediaLic || null,
            scannedMediaLic || null,
            scannedMediaLic || null,
            d1Pkg.id
          ).run()
        ).catch(() => {});
      }
    }
  }

  if (d1Pkg) {
    // Verify & self-heal accurate normalized .zip archive size (7-day Edge cached + pre-warms .zip cache)
    let resolvedSizeLabel =
      (d1Pkg.download_size && Number(d1Pkg.download_size) > 0 ? formatByteSize(d1Pkg.download_size) : null) ||
      (d1Pkg.file_size && String(d1Pkg.file_size).trim() ? String(d1Pkg.file_size).trim() : null);

    if (d1Pkg.repo_url) {
      const repoEstimate = await fetchRepoSizeEstimateFromUrl(
        d1Pkg.repo_url,
        d1Pkg.author_name || author,
        d1Pkg.name || name,
        {
          defaultBranch: d1Pkg.default_branch || 'main',
          packageType: d1Pkg.type || 'mod'
        }
      );
      if (repoEstimate && repoEstimate.downloadSize > 0) {
        const prevSize = Number(d1Pkg.download_size || 0);
        resolvedSizeLabel = repoEstimate.fileSize;
        if (context.env.DB && d1Pkg.id && (prevSize <= 0 || Math.abs(repoEstimate.downloadSize - prevSize) > Math.max(1024, prevSize * 0.05))) {
          context.env.DB.prepare(`
            UPDATE packages
            SET download_size = ?, file_size = ?
            WHERE LOWER(id) = LOWER(?)
          `).bind(repoEstimate.downloadSize, repoEstimate.fileSize, d1Pkg.id).run().catch(() => {});
        }
      }
    }

    const tags = parseJsonArray(d1Pkg.tags);
    const isPureGitFallback = Boolean(
      healedPoisonedClientRow || isPureGitD1Package(d1Pkg)
    );
    const recFallbackDl = reconcilePackageDownloadCounts({
      contentdbDownloads: Number(d1Pkg.contentdb_downloads) || 0,
      luantihubDownloads: lhDownloads,
      reportedTotalDownloads: Number(d1Pkg.downloads_count) || 0,
      hasContentDbSource: !isPureGitFallback,
      isPureGitOnly: isPureGitFallback
    });
    const totalDl = recFallbackDl.downloads;
    const fallbackCdbDl = recFallbackDl.contentdbDownloads;
    const fallbackLhDl = recFallbackDl.luantihubDownloads;
    let releaseId = 1;
    if (isPureGitFallback) {
      releaseId = computeLuantiClientReleaseId(d1Pkg);
    } else {
      // Never synthesize 1.77B epoch timestamps for ContentDB-backed rows when upstream `/for-client/` fails.
      const updatesFallback = await fetchUpstreamJsonCached<Record<string, number>>(
        versionQuery ? `/updates/?${versionQuery}` : '/updates/',
        300
      ).catch(() => null);
      if (updatesFallback && typeof updatesFallback === 'object') {
        const lookupKeysLower = new Set([
          pkgId.toLowerCase(),
          `${d1Pkg.author_name || author}/${d1Pkg.name || name}`.toLowerCase()
        ]);
        for (const [uk, uv] of Object.entries(updatesFallback)) {
          if (lookupKeysLower.has(uk.toLowerCase()) && typeof uv === 'number' && Number.isFinite(uv) && uv > 0) {
            releaseId = Math.floor(uv);
            break;
          }
        }
      }
    }
    const provides = parseJsonArray(d1Pkg.provides);
    const hardDeps = parseJsonArray(d1Pkg.dependencies);
    const softDeps = parseJsonArray(d1Pkg.optional_dependencies);
    const screenshots: Array<{ url: string }> = [];
    const seenScreenshotKeys = new Set<string>();
    for (const rawShot of [
      d1Pkg.banner_url,
      d1Pkg.thumbnail_url,
      ...parseJsonArray(d1Pkg.screenshots)
    ]) {
      const clientShotUrl =
        toLegacyLuantiClientThumbnailUrl(rawShot) || resolveJam2026ClientScreenshotUrl(rawShot);
      if (!clientShotUrl) continue;
      const dedupKey = getCanonicalScreenshotKey(clientShotUrl) || clientShotUrl;
      if (seenScreenshotKeys.has(dedupKey)) continue;
      seenScreenshotKeys.add(dedupKey);
      screenshots.push({ url: clientShotUrl });
    }

    const localizedD1 = resolveLocalizedPackageText(d1Pkg, normalizedLang);
    const descLinksMap: Record<string, string> = {};
    const bodyHypertext = markdownToLuantiHypertext(
      localizedD1.desc || d1Pkg.long_desc || localizedD1.short_desc || d1Pkg.short_desc || '',
      descLinksMap,
      localizedD1.title || d1Pkg.title || d1Pkg.name
    );

    const infoLinksMap: Record<string, string> = {};
    const typeLabel = d1Pkg.type === 'game' ? 'Game' : (d1Pkg.type === 'txp' ? 'Texture Pack' : 'Mod');
    const infoLines: string[] = [
      `Type: <b>${escapeHypertext(typeLabel)}</b>\n`,
      `Tags: ${tags.length > 0 ? tags.map((t: string) => `<b>${escapeHypertext(t)}</b>`).join(', ') : '<i>none</i>'}\n`,
      `Dependencies: ${hardDeps.length > 0 ? hardDeps.map((d: string) => `<b>${escapeHypertext(d)}</b>`).join(', ') : '<i>none</i>'}\n`,
      `Optional dependencies: ${softDeps.length > 0 ? softDeps.map((d: string) => `<b>${escapeHypertext(d)}</b>`).join(', ') : '<i>none</i>'}\n`,
      `License: <b>${escapeHypertext(d1Pkg.license || 'MIT')}</b>\n`,
      `Media License: <b>${escapeHypertext(d1Pkg.media_license || d1Pkg.license || 'MIT')}</b>\n`,
      `Maintenance State: <b>${escapeHypertext(d1Pkg.dev_state || 'ACTIVELY_DEVELOPED')}</b>\n`,
      `Added: <b>${escapeHypertext(d1Pkg.created_at || new Date().toISOString())}</b>\n`,
      `Maintainers: <b>${escapeHypertext(d1Pkg.author_name || author)}</b>\n`,
      `Provides: <b>${escapeHypertext((provides.length > 0 ? provides : [d1Pkg.name || name]).join(', '))}</b>\n`
    ];
    if (d1Pkg.repo_url) {
      infoLinksMap['git_repo'] = d1Pkg.repo_url;
      infoLines.push(`<action name=git_repo><u>Git Repository</u></action>\n`);
    }
    if (d1Pkg.issue_tracker) {
      infoLinksMap['issue_tracker'] = d1Pkg.issue_tracker;
      infoLines.push(`<action name=issue_tracker><u>Issue Tracker</u></action>\n`);
    }

    // Ensure info.name matches the requested parameter so Luanti's assert(data.package.name == info.name) in dlg_package.lua:87 never fails
    const clientPayload = {
      author: d1Pkg.author_name || author,
      name: name || d1Pkg.name,
      title: localizedD1.title || d1Pkg.title || d1Pkg.name || name,
      type: d1Pkg.type === 'modpack' ? 'mod' : (d1Pkg.type || 'mod'),
      short_description: localizedD1.short_desc || d1Pkg.short_desc || '',
      long_description: {
        head: HYPERTEXT_HEAD,
        body: bodyHypertext,
        links: descLinksMap,
        images: {},
        image_tooltips: {}
      },
      info_hypertext: {
        head: HYPERTEXT_HEAD,
        body: infoLines.join('\n'),
        links: infoLinksMap,
        images: {},
        image_tooltips: {}
      },
      release: releaseId,
      license: d1Pkg.license || 'MIT',
      media_license: d1Pkg.media_license || d1Pkg.license || 'MIT',
      repo: d1Pkg.repo_url || null,
      website: null,
      issue_tracker: d1Pkg.issue_tracker || null,
      forum_url: d1Pkg.forum_url || null,
      donate_url: d1Pkg.donate_url || null,
      translation_url: d1Pkg.translation_url || null,
      video_url: d1Pkg.video_url || null,
      video_thumbnail_url: d1Pkg.video_thumbnail_url || null,
      dev_state: d1Pkg.dev_state || 'ACTIVELY_DEVELOPED',
      download_size: resolvedSizeLabel || '< 1 MB',
      downloads: totalDl,
      contentdb_downloads: fallbackCdbDl,
      luantihub_downloads: fallbackLhDl,
      score: Number(d1Pkg.score) || 0,
      reviews: d1ReviewsCount,
      screenshots,
      tags,
      provides: provides.length > 0 ? provides : [d1Pkg.name || name],
      maintainers: [d1Pkg.author_name || author],
      content_warnings: parseJsonArray(d1Pkg.content_warnings),
      ai_disclosures: [],
      created_at: d1Pkg.created_at || new Date().toISOString()
    };

    if (!noCache) {
      await writeEdgeCacheVariant(edgeCacheKey, variantKey, clientPayload, isPureGitFallback ? 300 : 30);
    }

    if (
      typeof context.waitUntil === 'function' &&
      context.env?.DB &&
      d1Pkg?.id &&
      d1Pkg?.repo_url &&
      d1Pkg?.provider &&
      d1Pkg.provider !== 'contentdb' &&
      !String(d1Pkg.tags || '').toLowerCase().includes('jam_game_2026')
    ) {
      const debounceKey = `https://cache.luantihub.internal/__for_client_git_check_v1/${encodeURIComponent(String(d1Pkg.id).toLowerCase())}`;
      context.waitUntil(
        (async () => {
          try {
            const recentlyChecked = await readEdgeCacheJson<number>(debounceKey).catch(() => null);
            if (recentlyChecked) return;
            await writeEdgeCacheJson(debounceKey, Date.now(), 900).catch(() => {});
            const gitRefs = await fetchGitSmartHttpRefs(
              d1Pkg.repo_url,
              d1Pkg.author_name || author,
              d1Pkg.name || name
            ).catch(() => null);
            const liveHeadSha = gitRefs?.headSha;
            if (liveHeadSha && liveHeadSha !== d1Pkg.latest_commit_sha) {
              const bumped = await syncDebouncedGitVersionStamp(
                context.env.DB,
                d1Pkg,
                liveHeadSha,
                false,
                new Date().toISOString()
              ).catch(() => false);
              if (bumped) {
                await invalidateEdgeCacheKeys(
                  buildPackageCacheInvalidationKeys(
                    d1Pkg.author_name || author,
                    d1Pkg.name || name,
                    { includeBootCatalog: true }
                  )
                ).catch(() => {});
              }
            }
          } catch {
            // Best-effort background refresh
          }
        })()
      );
    }

    return new Response(JSON.stringify(clientPayload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': !noCache
          ? 'public, max-age=120, s-maxage=300, stale-while-revalidate=600'
          : 'no-cache, no-store, must-revalidate',
        'X-LuantiHub-Cache': !noCache ? 'MISS-EDGE' : 'BYPASS'
      }
    });
  }

  return Response.json(
    { error: 'Package not found' },
    { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

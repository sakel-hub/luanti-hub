import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  parseJsonArray,
  ensureExtendedPackageColumns,
  formatByteSize,
  fetchRepoSizeEstimateFromUrl,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  resolveLocalizedPackageText,
  toLegacyLuantiClientThumbnailUrl
} from '../../../lib/upstream';
import { resolveJam2026SyntheticD1Detail } from '../../../lib/jam-2026';

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

export async function onRequestGet(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  const author = safeDecodeParam(context.params.author);
  const name = safeDecodeParam(context.params.name);
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  const pkgId = `${author}/${name}`;

  const reqUrl = context.request ? new URL(context.request.url) : new URL(`https://luantihub.org/api/packages/${encAuthor}/${encName}/for-client/`);
  const rawLang =
    reqUrl.searchParams.get('lang') ||
    (context.request?.headers.get('Accept-Language') || '').split(',')[0]?.split('-')[0] ||
    'en';
  const normalizedLang = String(rawLang || 'en').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'en';
  const forwardParams = new URLSearchParams();
  for (const allowedKey of ['protocol_version', 'formspec_version', 'engine_version']) {
    const val = reqUrl.searchParams.get(allowedKey);
    if (val && val.length <= 32 && /^[a-zA-Z0-9._-]+$/.test(val)) {
      forwardParams.set(allowedKey, val);
    }
  }
  if (!forwardParams.has('formspec_version')) {
    forwardParams.set('formspec_version', '8');
  }
  const querySuffix = forwardParams.toString() ? `?${forwardParams.toString()}` : '?formspec_version=8';
  const edgeCacheKey = `https://cache.luantihub.internal/__for_client_v5/${normalizedLang}/${encAuthor.toLowerCase()}/${encName.toLowerCase()}/${encodeURIComponent(querySuffix)}`;
  const cachedClient = await readEdgeCacheJson<any>(edgeCacheKey);
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
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      d1Pkg = await context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) LIMIT 1`
      ).bind(pkgId).first();
      if (!d1Pkg) {
        d1Pkg = await context.env.DB.prepare(
          `SELECT * FROM packages WHERE LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?) LIMIT 1`
        ).bind(author, name, sanitizedName).first();
      }

      if (!d1Pkg) {
        const baseAuthor = (author || '').replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
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

  const isPureGitPkg = Boolean(
    d1Pkg &&
    d1Pkg.provider &&
    d1Pkg.provider !== 'contentdb' &&
    !parseJsonArray(d1Pkg.tags).includes('contentdb')
  );

  const data = !isPureGitPkg
    ? await fetchUpstreamJsonCached<any>(
        `/packages/${encAuthor}/${encName}/for-client/${querySuffix}`,
        300,
        { lang: normalizedLang }
      )
    : null;

  if (data) {
    const cdbDownloads = Math.max(
      Number(data.downloads) || 0,
      Number(d1Pkg?.contentdb_downloads) || 0
    );
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
            const normalizedUrl = toLegacyLuantiClientThumbnailUrl(rawObj.url) || rawObj.url;
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
      luantihub_downloads: lhDownloads,
      downloads: cdbDownloads + lhDownloads,
      reviews: mergedReviews,
      screenshots: normalizedScreenshots
    };
    await writeEdgeCacheJson(edgeCacheKey, enriched, 300);
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
    ({ d1Pkg } = await resolveJam2026SyntheticD1Detail(author, name, d1Pkg, []));
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

    const totalDl = Math.max(Number(d1Pkg.downloads_count) || 0, lhDownloads);
    const releaseId = Math.max(
      1,
      Math.floor(new Date(d1Pkg.updated_at || d1Pkg.created_at || '2026-01-01T00:00:00Z').getTime() / 1000) || 1
    );
    const tags = parseJsonArray(d1Pkg.tags);
    const provides = parseJsonArray(d1Pkg.provides);
    const hardDeps = parseJsonArray(d1Pkg.dependencies);
    const softDeps = parseJsonArray(d1Pkg.optional_dependencies);
    const screenshots: Array<{ url: string }> = [];
    const d1BannerClientUrl = toLegacyLuantiClientThumbnailUrl(d1Pkg.banner_url);
    const d1ThumbClientUrl = toLegacyLuantiClientThumbnailUrl(d1Pkg.thumbnail_url);
    if (d1BannerClientUrl) {
      screenshots.push({ url: d1BannerClientUrl });
    } else if (d1ThumbClientUrl) {
      screenshots.push({ url: d1ThumbClientUrl });
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
      contentdb_downloads: Number(d1Pkg.contentdb_downloads) || 0,
      luantihub_downloads: lhDownloads,
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

    await writeEdgeCacheJson(edgeCacheKey, clientPayload, 300);

    return new Response(JSON.stringify(clientPayload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
        'X-LuantiHub-Cache': 'MISS-EDGE'
      }
    });
  }

  return Response.json(
    { error: 'Package not found' },
    { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

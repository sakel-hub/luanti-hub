import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  ensureExtendedPackageColumns,
  formatByteSize,
  fetchRepoSizeEstimateFromUrl,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../../../lib/upstream';

interface Env {
  DB?: any;
}

const HYPERTEXT_HEAD = '<tag name=code color=#7bf font=mono> <tag name=action color=#4CDAFA hovercolor=#97EAFC>';

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
  const { author, name } = context.params;
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  const pkgId = `${author}/${name}`;

  const reqUrl = context.request ? new URL(context.request.url) : new URL(`https://luanti-hub.pages.dev/api/packages/${encAuthor}/${encName}/for-client/`);
  const forwardParams = new URLSearchParams(reqUrl.searchParams);
  if (!forwardParams.has('formspec_version')) {
    forwardParams.set('formspec_version', '8');
  }
  const querySuffix = forwardParams.toString() ? `?${forwardParams.toString()}` : '?formspec_version=8';
  const edgeCacheKey = `https://cache.luantihub.internal/__for_client_v2/${encAuthor.toLowerCase()}/${encName.toLowerCase()}/${encodeURIComponent(querySuffix)}`;
  const cachedClient = await readEdgeCacheJson<any>(edgeCacheKey);
  if (cachedClient) {
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
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?)) LIMIT 1`
      ).bind(pkgId, author, name, sanitizedName).first();

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
        300
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
      ? data.screenshots.map((s: any) => (typeof s === 'string' ? { url: s } : s)).filter((s: any) => Boolean(s?.url))
      : [];
    const resolvedDownloadSize =
      (typeof data.download_size === 'string' && data.download_size.trim() ? data.download_size.trim() : null) ||
      (typeof data.download_size === 'number' && data.download_size > 0 ? formatByteSize(data.download_size) : null) ||
      (d1Pkg?.download_size && Number(d1Pkg.download_size) > 0 ? formatByteSize(d1Pkg.download_size) : null) ||
      (d1Pkg?.file_size && String(d1Pkg.file_size).trim() ? String(d1Pkg.file_size).trim() : null) ||
      '< 1 MB';
    const enriched = {
      ...data,
      name: name || data.name,
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

  if (d1Pkg) {
    // If download_size and file_size are missing in D1, lazily query the Git forge repository size and persist to D1
    let resolvedSizeLabel =
      (d1Pkg.download_size && Number(d1Pkg.download_size) > 0 ? formatByteSize(d1Pkg.download_size) : null) ||
      (d1Pkg.file_size && String(d1Pkg.file_size).trim() ? String(d1Pkg.file_size).trim() : null);

    if (!resolvedSizeLabel && d1Pkg.repo_url) {
      const repoEstimate = await fetchRepoSizeEstimateFromUrl(
        d1Pkg.repo_url,
        d1Pkg.author_name || author,
        d1Pkg.name || name
      );
      if (repoEstimate) {
        resolvedSizeLabel = repoEstimate.fileSize;
        if (context.env.DB && d1Pkg.id) {
          context.env.DB.prepare(`
            UPDATE packages
            SET download_size = ?, file_size = ?
            WHERE LOWER(id) = LOWER(?) AND (download_size IS NULL OR download_size = 0)
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
    if (d1Pkg.banner_url && String(d1Pkg.banner_url).startsWith('http')) {
      screenshots.push({ url: String(d1Pkg.banner_url) });
    } else if (d1Pkg.thumbnail_url && String(d1Pkg.thumbnail_url).startsWith('http')) {
      screenshots.push({ url: String(d1Pkg.thumbnail_url) });
    }

    const descLinksMap: Record<string, string> = {};
    const bodyHypertext = markdownToLuantiHypertext(
      d1Pkg.long_desc || d1Pkg.short_desc || '',
      descLinksMap,
      d1Pkg.title || d1Pkg.name
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
      title: d1Pkg.title || d1Pkg.name || name,
      type: d1Pkg.type === 'modpack' ? 'mod' : (d1Pkg.type || 'mod'),
      short_description: d1Pkg.short_desc || '',
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
      content_warnings: [],
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

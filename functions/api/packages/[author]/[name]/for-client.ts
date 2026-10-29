import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  ensureExtendedPackageColumns
} from '../../../lib/upstream';

interface Env {
  DB?: any;
}

function markdownToLuantiHypertext(md: string, title?: string): string {
  const raw = (md || '').trim();
  if (!raw) {
    return title ? `<bigger>${escapeHypertext(title)}</bigger>` : '';
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
      out.push(`<mono>${escapeHypertext(rawLine)}</mono>`);
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      out.push(`<bigger><b>${escapeHypertext(h1[1])}</b></bigger>`);
      continue;
    }
    const h2 = trimmed.match(/^#{2,3}\s+(.+)$/);
    if (h2) {
      out.push(`<b>${escapeHypertext(h2[1])}</b>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      out.push(`• ${formatInlineHypertext(bullet[1])}`);
      continue;
    }
    out.push(formatInlineHypertext(rawLine));
  }

  return out.join('\n');
}

function escapeHypertext(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInlineHypertext(line: string): string {
  // Strip Markdown images ![alt](url) and convert [label](url) to label (url)
  const withoutImages = String(line || '').replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  const withLinks = withoutImages.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');
  const escaped = escapeHypertext(withLinks);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<mono>$1</mono>');
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

  let d1Pkg: any = null;
  let lhDownloads = 0;

  if (context.env.DB) {
    try {
      await ensureExtendedPackageColumns(context.env.DB);
      d1Pkg = await context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      ).bind(pkgId, author, name).first();

      if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
        return Response.json({
          error: 'This package has been delisted or suspended by moderation.',
          status: d1Pkg.status
        }, {
          status: 451,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      const dailySumRow = await context.env.DB.prepare(
        `SELECT COALESCE(SUM(downloads_count), 0) as total_lh FROM package_daily_downloads WHERE LOWER(package_id) = LOWER(?)`
      ).bind(d1Pkg?.id || pkgId).first().catch(() => null);

      lhDownloads = Math.max(
        Number(d1Pkg?.luantihub_downloads) || 0,
        Number(dailySumRow?.total_lh) || 0
      );
    } catch {
      // Ignore D1 lookup error
    }
  }

  const data = await fetchUpstreamJsonCached<any>(
    `/packages/${encAuthor}/${encName}/for-client/${querySuffix}`,
    300
  );

  if (data) {
    const cdbDownloads = Math.max(
      Number(data.downloads) || 0,
      Number(d1Pkg?.contentdb_downloads) || 0
    );
    const enriched = {
      ...data,
      contentdb_downloads: cdbDownloads,
      luantihub_downloads: lhDownloads,
      downloads: cdbDownloads + lhDownloads
    };
    return new Response(JSON.stringify(enriched), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, s-maxage=300'
      }
    });
  }

  if (d1Pkg) {
    const totalDl = Math.max(Number(d1Pkg.downloads_count) || 0, lhDownloads);
    const releaseId = Math.max(
      1,
      Math.floor(new Date(d1Pkg.updated_at || d1Pkg.created_at || '2026-01-01T00:00:00Z').getTime() / 1000) || 1
    );
    const tags = parseJsonArray(d1Pkg.tags);
    const provides = parseJsonArray(d1Pkg.provides);
    const hardDeps = parseJsonArray(d1Pkg.dependencies);
    const softDeps = parseJsonArray(d1Pkg.optional_dependencies);
    const screenshots: string[] = [];
    if (d1Pkg.banner_url && String(d1Pkg.banner_url).startsWith('http')) {
      screenshots.push(String(d1Pkg.banner_url));
    } else if (d1Pkg.thumbnail_url && String(d1Pkg.thumbnail_url).startsWith('http')) {
      screenshots.push(String(d1Pkg.thumbnail_url));
    }

    const bodyHypertext = markdownToLuantiHypertext(
      d1Pkg.long_desc || d1Pkg.short_desc || '',
      d1Pkg.title || d1Pkg.name
    );

    const infoLines: string[] = [
      `<b>Author:</b> ${escapeHypertext(d1Pkg.author_name || author)}`,
      `<b>License:</b> ${escapeHypertext(d1Pkg.license || 'MIT')}`,
      `<b>Media License:</b> ${escapeHypertext(d1Pkg.media_license || d1Pkg.license || 'MIT')}`,
      `<b>Downloads:</b> ${totalDl}`,
      `<b>Source:</b> Luanti Hub Git Community`
    ];
    if (tags.length > 0) {
      infoLines.push(`<b>Tags:</b> ${escapeHypertext(tags.join(', '))}`);
    }
    if (hardDeps.length > 0) {
      infoLines.push(`<b>Required Dependencies:</b> ${escapeHypertext(hardDeps.join(', '))}`);
    }
    if (softDeps.length > 0) {
      infoLines.push(`<b>Optional Dependencies:</b> ${escapeHypertext(softDeps.join(', '))}`);
    }

    const linksMap: Record<string, string> = {};
    if (d1Pkg.repo_url) {
      linksMap['git_repo'] = d1Pkg.repo_url;
      infoLines.push(`<action name="git_repo">Git Repository</action>`);
    }
    if (d1Pkg.issue_tracker) {
      linksMap['issue_tracker'] = d1Pkg.issue_tracker;
      infoLines.push(`<action name="issue_tracker">Issue Tracker</action>`);
    }

    const clientPayload = {
      author: d1Pkg.author_name || author,
      name: d1Pkg.name || name,
      title: d1Pkg.title || d1Pkg.name || name,
      type: d1Pkg.type || 'mod',
      short_description: d1Pkg.short_desc || '',
      long_description: {
        head: '<bigger>',
        body: bodyHypertext,
        links: linksMap,
        images: {}
      },
      info_hypertext: {
        head: '',
        body: infoLines.join('\n'),
        links: linksMap,
        images: {}
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
      download_size: d1Pkg.download_size ? Number(d1Pkg.download_size) : 0,
      downloads: totalDl,
      contentdb_downloads: Number(d1Pkg.contentdb_downloads) || 0,
      luantihub_downloads: totalDl,
      score: Number(d1Pkg.score) || 0,
      screenshots,
      tags,
      provides: provides.length > 0 ? provides : [d1Pkg.name || name],
      maintainers: [d1Pkg.author_name || author],
      content_warnings: [],
      ai_disclosures: [],
      created_at: d1Pkg.created_at || new Date().toISOString()
    };

    return new Response(JSON.stringify(clientPayload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120'
      }
    });
  }

  return Response.json(
    { error: 'Package not found' },
    { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

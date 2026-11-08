import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  fetchRepoReadmeCached,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  normalizeGitRepoInputUrl,
  rewriteRelativeMarkdownUrls
} from '../../../lib/upstream';
import { fetchJam2026FallbackReadme } from '../../../lib/jam-2026';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: {
  request?: Request;
  params: { author: string; name: string };
  env: Env;
}) {
  const author = safeDecodeParam(context.params.author);
  const name = safeDecodeParam(context.params.name);
  const pkgId = `${author}/${name}`;
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const noCache = reqUrl?.searchParams.get('nocache') === '1';
  const explicitRepo = reqUrl?.searchParams.get('repo') || undefined;

  const edgeCacheKey = `https://edge-cache.luantihub.local/pkg-readme-v1/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`;

  if (!noCache) {
    const cached = await readEdgeCacheJson<{ readme: string | null; repo_url?: string }>(edgeCacheKey);
    if (cached && typeof cached.readme === 'string') {
      return new Response(JSON.stringify(cached), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
        }
      });
    }
  }

  let repoUrl = normalizeGitRepoInputUrl(explicitRepo) || undefined;
  let d1Pkg: any = null;

  if (context.env.DB) {
    try {
      d1Pkg = await context.env.DB.prepare(
        `SELECT repo_url, default_branch, long_desc, short_desc FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      )
        .bind(pkgId, author, name)
        .first();
      if (!repoUrl && d1Pkg?.repo_url) {
        repoUrl = normalizeGitRepoInputUrl(d1Pkg.repo_url) || undefined;
      }
    } catch {
      // Non-fatal D1 lookup error
    }
  }

  if (!repoUrl) {
    const encAuthor = encodeURIComponent(author);
    const encName = encodeURIComponent(name);
    const upstreamData = await fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 600).catch(() => null);
    if (upstreamData) {
      repoUrl = normalizeGitRepoInputUrl(upstreamData.repo || upstreamData.repo_url) || undefined;
    }
  }

  let readme: string | undefined;
  if (repoUrl) {
    readme = await fetchRepoReadmeCached(repoUrl);
    if (!readme) {
      readme = await fetchJam2026FallbackReadme(repoUrl);
    }
  }

  if (!readme && d1Pkg?.long_desc && d1Pkg.long_desc !== d1Pkg.short_desc && repoUrl) {
    const fallbackRawBase = `${String(repoUrl).replace(/\.git$/i, '').replace(/\/+$/, '')}/raw/${d1Pkg?.default_branch || 'main'}`;
    readme = rewriteRelativeMarkdownUrls(d1Pkg.long_desc, fallbackRawBase);
  }

  const payload = {
    readme: readme || null,
    repo_url: repoUrl || null
  };

  if (readme) {
    await writeEdgeCacheJson(edgeCacheKey, payload, 86400);
  }

  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': readme
        ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
        : 'public, max-age=300, s-maxage=600'
    }
  });
}

import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  fetchRepoReadmeCached,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  normalizeGitRepoInputUrl,
  rewriteRelativeMarkdownUrls
} from '../../../lib/upstream';
import { fetchJam2026FallbackReadme, findJam2026BrewRepoBySlug } from '../../../lib/jam-2026';
import { shouldHonorAuthenticatedNoCache } from '../../../auth/lib/session';
import {
  buildRawDirectoryBaseUrl,
  detectGitProviderFromUrl,
  isUntrustedTunnelOrPrivateHost
} from '../../../../../src/app/core/config/git-providers.config';
import { stripAuthorForgeSuffix } from '../../../../../src/app/core/config/package-utils.config';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

function validateFallbackRepoMatchesSlug(
  rawRepo: string | undefined,
  author: string,
  name: string
): string | undefined {
  const normalized = normalizeGitRepoInputUrl(rawRepo);
  if (!normalized || isUntrustedTunnelOrPrivateHost(normalized)) return undefined;
  const detected = detectGitProviderFromUrl(normalized);
  if (!detected) return undefined;
  const ownerSegments = detected.owner.split('/').filter(Boolean);
  const effectiveOwner = ownerSegments[ownerSegments.length - 1] || detected.owner;
  const ownerMatches =
    stripAuthorForgeSuffix(effectiveOwner).toLowerCase() ===
      stripAuthorForgeSuffix(author).toLowerCase() ||
    stripAuthorForgeSuffix(detected.owner).toLowerCase() ===
      stripAuthorForgeSuffix(author).toLowerCase();
  const repoMatches =
    detected.repo.toLowerCase().replace(/-/g, '_') === name.toLowerCase().replace(/-/g, '_');
  return ownerMatches && repoMatches ? normalized : undefined;
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
  const requestedNoCache = reqUrl?.searchParams.get('nocache') === '1';
  const noCache = requestedNoCache
    ? await shouldHonorAuthenticatedNoCache(
        context.request,
        context.env?.SESSION_SECRET,
        `readme:${pkgId}`
      )
    : false;
  const explicitRepo = reqUrl?.searchParams.get('repo') || undefined;

  const canonicalEdgeCacheKey = `https://edge-cache.luantihub.local/pkg-readme-v1/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`;

  if (!noCache && !explicitRepo) {
    const cached = await readEdgeCacheJson<{ readme: string | null; repo_url?: string }>(canonicalEdgeCacheKey);
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

  let repoUrl: string | undefined;
  let d1Pkg: any = null;
  let usedExplicitRepoFallback = false;

  if (context.env.DB) {
    try {
      d1Pkg = await context.env.DB.prepare(
        `SELECT status, repo_url, default_branch, long_desc, short_desc FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      )
        .bind(pkgId, author, name)
        .first();
      if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
        return Response.json({ error: 'Package is delisted or suspended.' }, { status: 451 });
      }
      if (d1Pkg?.repo_url) {
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

  if (!repoUrl) {
    const jamRepo = await findJam2026BrewRepoBySlug(author, name).catch(() => undefined);
    if (jamRepo) {
      repoUrl = normalizeGitRepoInputUrl(jamRepo) || undefined;
    }
  }

  if (!repoUrl && explicitRepo) {
    const validatedFallback = validateFallbackRepoMatchesSlug(explicitRepo, author, name);
    if (validatedFallback) {
      repoUrl = validatedFallback;
      usedExplicitRepoFallback = true;
    }
  }

  const effectiveEdgeCacheKey = usedExplicitRepoFallback && repoUrl
    ? `${canonicalEdgeCacheKey}?repo=${encodeURIComponent(repoUrl.toLowerCase())}`
    : canonicalEdgeCacheKey;

  if (!noCache && explicitRepo) {
    const cached = await readEdgeCacheJson<{ readme: string | null; repo_url?: string }>(effectiveEdgeCacheKey);
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

  let readme: string | undefined;
  if (repoUrl) {
    readme = await fetchRepoReadmeCached(repoUrl);
    if (!readme) {
      readme = await fetchJam2026FallbackReadme(repoUrl);
    }
  }

  if (!readme && d1Pkg?.long_desc && d1Pkg.long_desc !== d1Pkg.short_desc && repoUrl) {
    const fallbackRawBase =
      buildRawDirectoryBaseUrl(repoUrl, d1Pkg?.default_branch || 'main') ||
      `${String(repoUrl).replace(/\.git$/i, '').replace(/\/+$/, '')}/raw/${d1Pkg?.default_branch || 'main'}`;
    readme = rewriteRelativeMarkdownUrls(d1Pkg.long_desc, fallbackRawBase);
  }

  const payload = {
    readme: readme || null,
    repo_url: repoUrl || null
  };

  if (readme) {
    await writeEdgeCacheJson(effectiveEdgeCacheKey, payload, 86400);
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

import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  detectSpdxFromText,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl,
  rewriteRelativeMarkdownUrls,
  ensureExtendedPackageColumns,
  extractLongDescriptionText,
  extractEmbeddedVideo,
  ensureModerationColumns,
  autoResolveBrokenRepoReport,
  parseCdbJsonMetadata,
  CdbJsonMetadata,
  scanGitRepoMetadataCached,
  GitRepoScanResult,
  normalizeContentDbReviewItem,
  sanitizePublicErrorMessage
} from '../../../lib/upstream';
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount,
  verifyStrictPackageAuthorOwnership
} from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

function parseDownloadSizeBytes(val: any): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    const match = trimmed.match(/^([\d.]+)\s*(gb|mb|kb|b)?$/i);
    if (match) {
      const num = Number(match[1]);
      if (!Number.isFinite(num) || num <= 0) return 0;
      const unit = (match[2] || 'b').toLowerCase();
      if (unit === 'gb') return Math.round(num * 1024 * 1024 * 1024);
      if (unit === 'mb') return Math.round(num * 1024 * 1024);
      if (unit === 'kb') return Math.round(num * 1024);
      return Math.round(num);
    }
  }
  return 0;
}

function formatByteSize(val: any): string | undefined {
  const bytes = parseDownloadSizeBytes(val);
  if (bytes > 0) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed && /[a-zA-Z]/.test(trimmed) && trimmed !== '2 KB') return trimmed;
  }
  return undefined;
}

/**
 * Normalizes ContentDB `min_minetest_version` / `max_minetest_version` fields, which
 * `PackageRelease.as_dict()` returns as `{ name: "5.4", protocol_version: 39, is_dev: false }`
 * and `/for-client/` returns as `"5.4"`.
 */
function extractEngineVersionString(val: any): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed && trimmed.toLowerCase() !== 'none' ? trimmed : undefined;
  }
  if (typeof val === 'object' && typeof val.name === 'string') {
    const trimmed = val.name.trim();
    return trimmed && trimmed.toLowerCase() !== 'none' ? trimmed : undefined;
  }
  return undefined;
}

function computeStarRating(upstreamData: any, _d1Score?: number, d1ReviewAvg?: number): number {
  if (d1ReviewAvg && d1ReviewAvg >= 1 && d1ReviewAvg <= 5) {
    return Number(d1ReviewAvg.toFixed(1));
  }
  const rev = upstreamData?.reviews;
  if (rev && typeof rev === 'object') {
    const pos = Number(rev.positive) || 0;
    const neu = Number(rev.neutral) || 0;
    const neg = Number(rev.negative) || 0;
    const total = pos + neu + neg;
    if (total > 0) {
      const stars = (pos * 5 + neu * 3 + neg * 1) / total;
      return Number(Math.min(5.0, Math.max(1.0, stars)).toFixed(1));
    }
  }
  const rawScore = Number(upstreamData?.score) || 0;
  if (rawScore >= 1.0 && rawScore <= 5.0) {
    return Number(rawScore.toFixed(1));
  }
  return 0;
}

function extractDependencies(
  upstreamData: any,
  depsPayload: any,
  pkgKey: string
): { hardDeps: string[]; softDeps: string[] } {
  const hardSet = new Set<string>();
  const softSet = new Set<string>();

  const addDep = (target: Set<string>, item: any) => {
    if (!item) return;
    if (typeof item === 'string') {
      const clean = item.trim();
      if (clean) target.add(clean);
    } else if (typeof item === 'object') {
      const depName = item.name || item.id || (Array.isArray(item.packages) && item.packages[0]);
      if (typeof depName === 'string' && depName.trim()) {
        if (item.is_optional) {
          softSet.add(depName.trim());
        } else {
          target.add(depName.trim());
        }
      }
    }
  };

  if (Array.isArray(upstreamData?.hard_dependencies)) {
    upstreamData.hard_dependencies.forEach((d: any) => addDep(hardSet, d));
  } else if (Array.isArray(upstreamData?.dependencies)) {
    upstreamData.dependencies.forEach((d: any) => addDep(hardSet, d));
  }

  if (Array.isArray(upstreamData?.soft_dependencies)) {
    upstreamData.soft_dependencies.forEach((d: any) => addDep(softSet, d));
  } else if (Array.isArray(upstreamData?.optional_dependencies)) {
    upstreamData.optional_dependencies.forEach((d: any) => addDep(softSet, d));
  }

  if (depsPayload) {
    let list: any[] = [];
    if (Array.isArray(depsPayload)) {
      list = depsPayload;
    } else if (typeof depsPayload === 'object') {
      const exact = depsPayload[pkgKey] || depsPayload[pkgKey.toLowerCase()];
      if (Array.isArray(exact)) {
        list = exact;
      } else {
        const lowerKey = pkgKey.toLowerCase();
        const ciMatchKey = Object.keys(depsPayload).find((k) => k.toLowerCase() === lowerKey);
        if (ciMatchKey && Array.isArray(depsPayload[ciMatchKey])) {
          list = depsPayload[ciMatchKey];
        } else {
          const firstArray = Object.values(depsPayload).find((v) => Array.isArray(v)) as any[] | undefined;
          if (firstArray) list = firstArray;
        }
      }
    }
    for (const dep of list) {
      if (dep && typeof dep === 'object') {
        const depName = dep.name || (Array.isArray(dep.packages) && dep.packages[0]);
        if (typeof depName === 'string' && depName.trim()) {
          if (dep.is_optional) {
            softSet.add(depName.trim());
          } else {
            hardSet.add(depName.trim());
          }
        }
      } else if (typeof dep === 'string') {
        hardSet.add(dep.trim());
      }
    }
  }

  // Ensure optional deps don't duplicate required deps
  for (const h of hardSet) {
    softSet.delete(h);
  }

  return {
    hardDeps: Array.from(hardSet),
    softDeps: Array.from(softSet)
  };
}

async function resolveArchiveSizeCached(downloadUrl?: string): Promise<string | undefined> {
  if (!downloadUrl || !downloadUrl.startsWith('http')) return undefined;
  const cacheKeyUrl = `https://cache.luantihub.internal/filesize_v2?url=${encodeURIComponent(downloadUrl)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const data = await cached.json() as { size?: string };
        return data.size;
      }
    } catch {
      // Ignore cache read error
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(downloadUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luanti-hub.pages.dev)'
      }
    });
    clearTimeout(timeoutId);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    // Never accept Content-Length from HTML error pages or JSON responses
    if (!res.ok || contentType.includes('text/') || contentType.includes('json')) {
      return undefined;
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (!Number.isFinite(len) || len <= 0) return undefined;
    const formatted = formatByteSize(len);
    if (formatted && edgeCache) {
      try {
        await edgeCache.put(
          cacheReq,
          new Response(JSON.stringify({ size: formatted }), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=86400, s-maxage=86400'
            }
          })
        );
      } catch {
        // Ignore cache write error
      }
    }
    return formatted;
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

async function fetchRepoReadmeCached(repoUrl?: string): Promise<string | undefined> {
  const normalized = normalizeDefunctGitHost(repoUrl);
  if (!normalized) return undefined;
  const candidates: Array<{ url: string; rawBase?: string; headers?: Record<string, string> }> = [];
  const pushCandidate = (url: string, rawBase?: string, headers?: Record<string, string>) => {
    if (!candidates.some(c => c.url === url)) {
      candidates.push({ url, rawBase, headers });
    }
  };

  try {
    const u = new URL(normalized);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return undefined;
    const owner = parts[0];
    const repo = parts[1];
    const host = u.hostname.toLowerCase();

    if (host.includes('github.com')) {
      const ghBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
      for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt', 'README']) {
        pushCandidate(`${ghBase}/${file}`, ghBase);
      }
      pushCandidate(`https://api.github.com/repos/${owner}/${repo}/readme`, ghBase, {
        Accept: 'application/vnd.github.raw+json'
      });
    } else if (host.includes('codeberg.org')) {
      const lowerOwner = owner.toLowerCase();
      const cbApiBase = `https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`;
      for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt', 'README']) {
        pushCandidate(`${cbApiBase}/${file}`, cbApiBase);
      }
      for (const branch of ['main', 'master']) {
        const cbBranchBase = `https://codeberg.org/${lowerOwner}/${repo}/raw/branch/${branch}`;
        pushCandidate(`${cbBranchBase}/README.md`, cbBranchBase);
        pushCandidate(`${cbBranchBase}/readme.md`, cbBranchBase);
      }
    } else if (host.includes('gitlab.com')) {
      const glBase = `https://gitlab.com/${owner}/${repo}/-/raw/HEAD`;
      for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
        pushCandidate(`${glBase}/${file}`, glBase);
      }
    } else {
      const giteaBase = `${u.origin}/api/v1/repos/${owner}/${repo}/raw`;
      for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
        pushCandidate(`${giteaBase}/${file}`, giteaBase);
      }
    }
  } catch {
    return undefined;
  }

  if (candidates.length === 0) return undefined;

  const cacheKeyUrl = `https://cache.luantihub.internal/readme?repo=${encodeURIComponent(normalized)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const text = await cached.text();
        return text || undefined;
      }
    } catch {
      // Ignore cache read error
    }
  }

  for (const cand of candidates) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(cand.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luanti-hub.pages.dev)',
          ...(cand.headers || {})
        }
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const rawText = (await res.text()).slice(0, 64000);
        if (
          rawText &&
          rawText.trim().length > 10 &&
          !rawText.trim().startsWith('<!DOCTYPE') &&
          !rawText.trim().startsWith('<html')
        ) {
          const text = rewriteRelativeMarkdownUrls(rawText, cand.rawBase);
          if (edgeCache) {
            try {
              await edgeCache.put(
                cacheReq,
                new Response(text, {
                  headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'public, max-age=3600, s-maxage=3600'
                  }
                })
              );
            } catch {
              // Ignore
            }
          }
          return text;
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }
  return undefined;
}

function normalizeDefunctGitHost(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.toLowerCase().includes('notabug.org') && parts.length >= 2) {
      // NotABug shut down; Luanti creators (e.g. TenPlus1) migrated repositories to Codeberg
      return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1]}`;
    }
  } catch {
    // Keep original if URL parsing fails
  }
  return trimmed;
}

async function probeGitRepoConfAndLicense(
  author: string,
  name: string,
  pkgType = 'mod',
  existingRepoUrl?: string
): Promise<GitRepoScanResult> {
  return scanGitRepoMetadataCached(author, name, pkgType, existingRepoUrl, 21600);
}

function buildNormalizedReleases(
  author: string,
  name: string,
  d1Releases: any[],
  upstreamReleases: any[] | null
): any[] {
  if (Array.isArray(upstreamReleases) && upstreamReleases.length > 0) {
    const encAuthor = encodeURIComponent(author);
    const encName = encodeURIComponent(name);
    return upstreamReleases.map((r: any) => {
      const rawUrl = r.url || '';
      const fullDownloadUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl
          ? `https://content.luanti.org${rawUrl}`
          : `https://content.luanti.org/packages/${encAuthor}/${encName}/releases/${r.id}/download/`;
      const rawBytes = Number(r.size || r.file_size || r.download_size || 0);

      return {
        id: r.id,
        version: String(r.title || r.name || r.id || 'latest'),
        title: String(r.title || r.name || r.id || 'Release'),
        tag_name: String(r.title || r.name || r.id || 'latest'),
        commit_sha: r.commit || '',
        url: fullDownloadUrl,
        download_url: fullDownloadUrl,
        size: rawBytes > 0 ? rawBytes : undefined,
        file_size: rawBytes > 0 ? formatByteSize(rawBytes) : undefined,
        downloads: typeof r.downloads === 'number' ? r.downloads : undefined,
        release_notes: typeof r.release_notes === 'string' && r.release_notes.trim() ? r.release_notes.trim() : undefined,
        changelog: typeof r.release_notes === 'string' && r.release_notes.trim() ? r.release_notes.trim() : undefined,
        sha256: typeof r.sha256 === 'string' && r.sha256.trim() ? r.sha256.trim() : undefined,
        min_minetest_version: extractEngineVersionString(r.min_minetest_version) || r.min_protocol_version || undefined,
        max_minetest_version: extractEngineVersionString(r.max_minetest_version) || r.max_protocol_version || undefined,
        release_date: r.release_date || undefined,
        released_at: r.release_date || new Date().toISOString()
      };
    });
  }

  if (Array.isArray(d1Releases) && d1Releases.length > 0) {
    return d1Releases.map((r: any) => ({
      id: r.id,
      version: r.tag_name || r.version,
      title: r.title || r.tag_name || r.version,
      tag_name: r.tag_name || r.version,
      commit_sha: r.commit_sha,
      url: r.download_url || r.url,
      download_url: r.download_url || r.url,
      size: r.size || r.file_size || undefined,
      file_size: typeof r.file_size === 'string' ? r.file_size : (Number(r.size) > 0 ? formatByteSize(Number(r.size)) : undefined),
      min_minetest_version: r.min_minetest_version,
      max_minetest_version: r.max_minetest_version,
      changelog: r.changelog,
      release_notes: r.changelog || undefined,
      release_date: r.released_at || r.release_date,
      released_at: r.released_at || r.release_date
    }));
  }

  return [];
}

function buildNormalizedReviews(d1Reviews: any[], upstreamReviews: any[] | null, packageId?: string): any[] {
  const normalizedOfficial = (Array.isArray(upstreamReviews) ? upstreamReviews : []).map((r: any, idx: number) =>
    normalizeContentDbReviewItem(r, idx, packageId)
  );

  const normalizedLocal = (Array.isArray(d1Reviews) ? d1Reviews : []).map((r: any) => ({
    id: `lh_${r.id}`,
    ...(packageId ? { package_id: packageId } : {}),
    source: 'luantihub',
    rating: r.rating || 5,
    title: r.title,
    comment: r.comment,
    created_at: r.created_at,
    author: {
      username: r.username,
      display_name: r.display_name || r.username,
      avatar_url: r.avatar_url || `https://github.com/${r.username}.png`
    }
  }));

  return [...normalizedLocal, ...normalizedOfficial].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export async function onRequestGet(context: { request?: Request; params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const pkgId = `${author}/${name}`;
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const isLite = reqUrl?.searchParams.get('lite') === '1';
  const noCache = reqUrl?.searchParams.get('nocache') === '1';
  const edgeCacheKey = `https://edge-cache.luantihub.local/pkg-detail-v4/${isLite ? 'lite' : 'full'}/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`;

  if (!noCache) {
    const cachedEdge = await readEdgeCacheJson<any>(edgeCacheKey);
    if (cachedEdge) {
      // Always merge fresh D1 reviews on full detail requests so newly posted or moderated reviews appear immediately on refresh
      if (!isLite) {
        try {
          let freshLocalReviews: any[] = [];
          if (context.env.DB) {
            const freshLocalRevRes = await context.env.DB.prepare(`
              SELECT r.id, r.rating, r.title, r.comment, r.created_at,
                     u.username, u.display_name, u.avatar_url
              FROM reviews r
              LEFT JOIN users u ON r.user_id = u.id
              WHERE LOWER(r.package_id) = LOWER(?)
              ORDER BY r.created_at DESC
            `).bind(pkgId).all().catch(() => ({ results: [] }));
            freshLocalReviews = freshLocalRevRes?.results || [];
          }
          let existingOfficialOnly = Array.isArray(cachedEdge.reviews_list)
            ? cachedEdge.reviews_list.filter((r: any) => r && r.source === 'contentdb')
            : [];
          const expectedCdbCount =
            Number(cachedEdge.review_thread_counts?.positive || 0) +
            Number(cachedEdge.review_thread_counts?.neutral || 0) +
            Number(cachedEdge.review_thread_counts?.negative || 0);
          if (existingOfficialOnly.length === 0 && expectedCdbCount > 0) {
            const liveOfficial = await fetchUpstreamJsonCached<any[]>(
              `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/reviews/`,
              300
            ).catch(() => null);
            if (Array.isArray(liveOfficial) && liveOfficial.length > 0) {
              existingOfficialOnly = liveOfficial.map((r: any, idx: number) =>
                normalizeContentDbReviewItem(r, idx, pkgId)
              );
            }
          }
          const normalizedFreshLocal = freshLocalReviews.map((r: any) => ({
            id: `lh_${r.id}`,
            package_id: pkgId,
            source: 'luantihub',
            rating: Number(r.rating) || 5,
            title: r.title || undefined,
            comment: r.comment || '',
            created_at: r.created_at,
            author: {
              username: r.username || 'community_user',
              display_name: r.display_name || r.username || 'Community Member',
              avatar_url: r.avatar_url || `https://github.com/${r.username || 'octocat'}.png`
            }
          }));
          cachedEdge.reviews_list = [...normalizedFreshLocal, ...existingOfficialOnly].sort(
            (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
          );
          if (freshLocalReviews.length > 0) {
            const sum = freshLocalReviews.reduce((acc: number, r: any) => acc + (Number(r.rating) || 5), 0);
            cachedEdge.score = Number((sum / freshLocalReviews.length).toFixed(1));
          } else if (existingOfficialOnly.length > 0) {
            const sum = existingOfficialOnly.reduce((acc: number, r: any) => acc + (Number(r.rating) || 5), 0);
            cachedEdge.score = Number((sum / existingOfficialOnly.length).toFixed(1));
          } else {
            cachedEdge.score = computeStarRating({ reviews: cachedEdge.review_thread_counts }, 0, undefined);
          }
        } catch {
          // Ignore D1 refresh error
        }
      }

      return new Response(JSON.stringify(cachedEdge), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isLite
            ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
            : 'no-cache'
        }
      });
    }
  }

  // 1. Check Cloudflare D1 (including Instant Kill Switch status check + local D1 reviews, releases & downloads)
  let d1Pkg: any = null;
  let d1ReviewAvg: number | undefined;
  let d1Releases: any[] = [];
  let d1Reviews: any[] = [];
  let d1DailyDownloadsSum = 0;
  if (context.env.DB) {
    await ensureExtendedPackageColumns(context.env.DB);
    d1Pkg = await context.env.DB.prepare(
      `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
    ).bind(pkgId, author, name).first();

    if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
      return Response.json({
        error: 'This package has been delisted or suspended by moderation.',
        status: d1Pkg.status,
        reason: d1Pkg.status_reason || 'Policy / DMCA Compliance'
      }, {
        status: 451,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    const effectivePkgId = d1Pkg?.id || pkgId;

    // Fast path for ?lite=1 when D1 already holds hydrated ContentDB downloads & license
    const d1TagsFast = d1Pkg ? parseJsonArray(d1Pkg.tags) : [];
    const isGitFast = Boolean(d1Pkg && (d1Pkg.provider !== 'contentdb' || d1TagsFast.includes('git')));
    const isOfficialFast = Boolean(
      d1Pkg && (d1Pkg.provider === 'contentdb' || Number(d1Pkg.contentdb_downloads || 0) > 0 || d1TagsFast.includes('contentdb'))
    );
    const hasHydratedDownloads =
      Number(d1Pkg?.contentdb_downloads || 0) > 0 ||
      (!isOfficialFast && Number(d1Pkg?.downloads_count || 0) > 0);

    if (isLite && d1Pkg && d1Pkg.license && hasHydratedDownloads) {
      const revAvgFast = await context.env.DB.prepare(
        `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE LOWER(package_id) = LOWER(?)`
      ).bind(effectivePkgId).first().catch(() => null);
      const fastStarScore = revAvgFast && Number(revAvgFast.cnt) > 0 && revAvgFast.avg_rating != null
        ? Number(Number(revAvgFast.avg_rating).toFixed(1))
        : 0;
      const cdbDl = Number(d1Pkg.contentdb_downloads || 0);
      const lhDl = Number(d1Pkg.luantihub_downloads || 0);
      const totalDl = Math.max(Number(d1Pkg.downloads_count || 0), cdbDl + lhDl);
      const fastSources: Array<'official' | 'git'> = [];
      if (isOfficialFast) fastSources.push('official');
      if (isGitFast) fastSources.push('git');
      if (fastSources.length === 0) fastSources.push('official');

      const fastLitePayload = {
        id: d1Pkg.id,
        author: d1Pkg.author_name || author,
        name: d1Pkg.name || name,
        title: d1Pkg.title || name,
        type: d1Pkg.type || 'mod',
        short_desc: d1Pkg.short_desc || '',
        license: d1Pkg.license,
        media_license: d1Pkg.media_license || d1Pkg.license,
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        contentdb_downloads: cdbDl,
        luantihub_downloads: lhDl,
        downloads: totalDl,
        score: fastStarScore,
        download_size: Number(d1Pkg.download_size || 0) > 0 ? Number(d1Pkg.download_size) : undefined,
        file_size: d1Pkg.file_size || formatByteSize(d1Pkg.download_size),
        video_url: d1Pkg.video_url || undefined,
        video_thumbnail_url: d1Pkg.video_thumbnail_url || undefined,
        tags: d1TagsFast.length > 0 ? d1TagsFast : [d1Pkg.type || 'mod'],
        source: isGitFast ? 'git' : 'official',
        sources: fastSources,
        git_repo_status: d1Pkg.repo_url ? 'verified' : 'unverified'
      };
      await writeEdgeCacheJson(edgeCacheKey, fastLitePayload, 1800);
      return new Response(JSON.stringify(fastLitePayload), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
        }
      });
    }

    try {
      if (isLite) {
        const [revAvgRow, dailyDlRow] = await Promise.all([
          context.env.DB.prepare(
            `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE LOWER(package_id) = LOWER(?)`
          ).bind(effectivePkgId).first().catch(() => null),
          context.env.DB.prepare(
            `SELECT COALESCE(SUM(downloads_count), 0) as total_lh FROM package_daily_downloads WHERE LOWER(package_id) = LOWER(?)`
          ).bind(effectivePkgId).first().catch(() => ({ total_lh: 0 }))
        ]);
        if (revAvgRow && Number(revAvgRow.cnt) > 0 && revAvgRow.avg_rating != null) {
          d1ReviewAvg = Number(revAvgRow.avg_rating);
        } else if (d1Pkg && Number(d1Pkg.score) > 0) {
          d1Pkg.score = 0;
          context.env.DB.prepare(`UPDATE packages SET score = 0 WHERE id = ?`).bind(d1Pkg.id).run().catch(() => {});
        }
        d1DailyDownloadsSum = Number(dailyDlRow?.total_lh || 0);
      } else {
        const [revAvgRow, revRowsRes, relRowsRes, dailyDlRow] = await Promise.all([
          context.env.DB.prepare(
            `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE LOWER(package_id) = LOWER(?)`
          ).bind(effectivePkgId).first(),
          context.env.DB.prepare(`
            SELECT r.id, r.rating, r.title, r.comment, r.created_at,
                   u.username, u.display_name, u.avatar_url
            FROM reviews r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE LOWER(r.package_id) = LOWER(?)
            ORDER BY r.created_at DESC
          `).bind(effectivePkgId).all().catch(() => ({ results: [] })),
          context.env.DB.prepare(
            `SELECT * FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY released_at DESC`
          ).bind(effectivePkgId).all().catch(() => ({ results: [] })),
          context.env.DB.prepare(
            `SELECT COALESCE(SUM(downloads_count), 0) as total_lh FROM package_daily_downloads WHERE LOWER(package_id) = LOWER(?)`
          ).bind(effectivePkgId).first().catch(() => ({ total_lh: 0 }))
        ]);

        if (revAvgRow && Number(revAvgRow.cnt) > 0 && revAvgRow.avg_rating != null) {
          d1ReviewAvg = Number(revAvgRow.avg_rating);
        } else if (d1Pkg && Number(d1Pkg.score) > 0) {
          // Heal legacy DEFAULT 5.0 score in D1 when no reviews exist
          d1Pkg.score = 0;
          context.env.DB.prepare(`UPDATE packages SET score = 0 WHERE id = ?`).bind(d1Pkg.id).run().catch(() => {});
        }
        d1Reviews = revRowsRes?.results || [];
        d1Releases = relRowsRes?.results || [];
        d1DailyDownloadsSum = Number(dailyDlRow?.total_lh || 0);
      }
    } catch {
      // Ignore if reviews/releases query fails
    }
  }

  // 2. Fetch upstream ContentDB detail, dependencies, releases, and reviews in parallel.
  // Note: ContentDB's `GET /api/packages/:author/:name/` (`Package.as_dict()`) already returns full metadata
  // (license, media_license, downloads, score, screenshots, tags, provides, maintainers, content_warnings,
  // ai_disclosure, forum_url, video_url, donate_url, issue_tracker, translation_url, long_description in clean Markdown).
  // Furthermore, `fetchWithFailover('/packages/:author/:name/')` automatically rewrites to `/for-client/?formspec_version=8`
  // if `content.luanti.org` fails and it has to fall back to `contentdb.milcho.org`!
  // Also note: on `/dependencies/`, do NOT pass `?only_hard=0` because Python Flask treats any non-empty string `"0"` as truthy!
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  let [upstreamData, depsPayload, releasesPayload, upstreamReviewsPayload] = await Promise.all([
    fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 600),
    isLite ? Promise.resolve(null) : fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/dependencies/`, 600),
    isLite ? Promise.resolve(null) : fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/releases/`, 300),
    isLite ? Promise.resolve(null) : fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/reviews/`, 300)
  ]);
  let forClientData: any = null;

  // Ensure Git tags/releases are discovered before falling back to a default branch ('HEAD') row
  const hasRealTaggedD1Releases = d1Releases.some(
    (r: any) => r.commit_sha !== 'HEAD' && r.version !== 'latest'
  );
  if (!isLite && !hasRealTaggedD1Releases && (!Array.isArray(releasesPayload) || releasesPayload.length === 0)) {
    const discoveredGitReleases = await fetchGitRepoReleasesAndTags(
      d1Pkg?.repo_url,
      d1Pkg?.author_name || author,
      d1Pkg?.name || name,
      d1Pkg?.min_minetest_version || '5.0.0'
    );
    if (discoveredGitReleases.length > 0) {
      d1Releases = discoveredGitReleases;
      if (context.env.DB && d1Pkg) {
        try {
          await context.env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(d1Pkg.id).run();
          for (const rel of discoveredGitReleases.slice(0, 25)) {
            await context.env.DB.prepare(`
              INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              d1Pkg.id,
              rel.version,
              rel.tag_name,
              rel.commit_sha,
              rel.download_url,
              rel.min_minetest_version || d1Pkg.min_minetest_version || '5.0.0',
              rel.changelog || `Git Tag / Release (${rel.tag_name})`,
              rel.released_at || new Date().toISOString()
            ).run();
          }
        } catch {
          // Non-fatal D1 sync error
        }
      }
    } else if (d1Releases.length === 0 && d1Pkg?.repo_url) {
      const branch = d1Pkg.default_branch || 'main';
      const fallbackUrl = buildGitBranchArchiveUrl(
        d1Pkg.repo_url,
        d1Pkg.author_name || author,
        d1Pkg.name || name,
        branch,
        d1Pkg.provider
      );
      d1Releases = [{
        id: 'git-branch-fallback',
        version: branch,
        title: `${branch} branch`,
        tag_name: branch,
        commit_sha: 'HEAD',
        url: fallbackUrl,
        download_url: fallbackUrl,
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        changelog: `Direct source archive from ${branch} branch`,
        released_at: d1Pkg.updated_at || d1Pkg.created_at || new Date().toISOString()
      }];
    }
  }

  let bundledReleases = buildNormalizedReleases(author, name, d1Releases, releasesPayload);
  const bundledReviews = buildNormalizedReviews(d1Reviews, upstreamReviewsPayload, pkgId);

  // Merge forClientData into upstreamData if single-package endpoint is missing or partial
  if (!upstreamData && forClientData) {
    upstreamData = forClientData;
  } else if (upstreamData && forClientData) {
    upstreamData = { ...forClientData, ...upstreamData, download_size: forClientData.download_size ?? upstreamData.download_size };
  }

  // Fallback: If single-package endpoint is unavailable on mirror or author differs from ContentDB (e.g. Git username vs ContentDB username), resolve from cached bulk catalog
  if (!upstreamData) {
    const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 600);
    if (Array.isArray(bulkCatalog)) {
      const lowerAuthor = author.toLowerCase();
      const lowerName = name.toLowerCase();
      const lowerTitle = String(d1Pkg?.title || '').trim().toLowerCase();
      const lowerType = String(d1Pkg?.type || 'mod').toLowerCase();
      const d1RepoUrl = String(d1Pkg?.repo_url || '').toLowerCase().replace(/\.git$/i, '').replace(/\/+$/, '');

      upstreamData = bulkCatalog.find(
        (item: any) =>
          item &&
          String(item.author || '').toLowerCase() === lowerAuthor &&
          String(item.name || '').toLowerCase() === lowerName
      ) || null;

      if (!upstreamData) {
        const sameNameItems = bulkCatalog.filter(
          (item: any) => item && String(item.name || '').toLowerCase() === lowerName
        );
        const matchedCandidate =
          sameNameItems.find((item: any) => {
            const itemRepo = String(item.repo || item.repo_url || '').toLowerCase().replace(/\.git$/i, '').replace(/\/+$/, '');
            if (d1RepoUrl && itemRepo && itemRepo === d1RepoUrl) return true;
            const itemTitle = String(item.title || '').trim().toLowerCase();
            if (lowerTitle && itemTitle && itemTitle === lowerTitle) return true;
            return false;
          }) ||
          (sameNameItems.length === 1 && String(sameNameItems[0].type || 'mod').toLowerCase() === lowerType
            ? sameNameItems[0]
            : null);

        if (matchedCandidate && matchedCandidate.author && matchedCandidate.name) {
          const encCdbAuthor = encodeURIComponent(matchedCandidate.author);
          const encCdbName = encodeURIComponent(matchedCandidate.name);
          const altDetail = await fetchUpstreamJsonCached<any>(`/packages/${encCdbAuthor}/${encCdbName}/`, 600);
          upstreamData = {
            ...matchedCandidate,
            ...(altDetail || {})
          };
        }
      }
    }
  }

  // 3. Agnostic Resolution (Pure Git package OR when both ContentDB & Mirror APIs are offline):
  // Resolve directly from D1 + Server-side Git Repository Scanner (.conf + .cdb.json + README + Git Releases)
  if (!upstreamData) {
    const d1Tags = d1Pkg ? parseJsonArray(d1Pkg.tags) : [];
    const d1HardDeps = d1Pkg ? parseJsonArray(d1Pkg.dependencies) : [];
    const d1SoftDeps = d1Pkg ? parseJsonArray(d1Pkg.optional_dependencies) : [];
    const needsAgnosticRepoScan =
      !d1Pkg ||
      !d1Pkg.license ||
      !d1Pkg.short_desc ||
      d1HardDeps.length === 0 ||
      (!isLite && !d1Pkg.video_url && Boolean(d1Pkg.repo_url));

    const gitScan = needsAgnosticRepoScan
      ? await probeGitRepoConfAndLicense(
          d1Pkg?.author_name || author,
          d1Pkg?.name || name,
          d1Pkg?.type || 'mod',
          d1Pkg?.repo_url
        )
      : null;

    if (d1Pkg || (gitScan && gitScan.gitRepoStatus === 'verified')) {
      const resolvedAuthor = d1Pkg?.author_name || author;
      const resolvedName = d1Pkg?.name || gitScan?.cdbMeta?.name || name;
      const resolvedType = gitScan?.detectedType || d1Pkg?.type || 'mod';
      const resolvedRepo = gitScan?.repoUrl || d1Pkg?.repo_url || '';
      const isGitPkg = !d1Pkg || d1Pkg.provider !== 'contentdb' || d1Tags.includes('git');
      const isAlsoOfficial = Boolean(d1Pkg && (d1Pkg.provider === 'contentdb' || d1Tags.includes('contentdb')));
      const sources: Array<'official' | 'git'> = [];
      if (isAlsoOfficial) sources.push('official');
      if (isGitPkg) sources.push('git');
      if (sources.length === 0) sources.push('git');

      const readme = (!isLite && resolvedRepo) ? await fetchRepoReadmeCached(resolvedRepo) : undefined;
      const fallbackRawBase =
        gitScan?.rawBaseUrl ||
        (resolvedRepo
          ? `${String(resolvedRepo).replace(/\.git$/i, '').replace(/\/+$/, '')}/raw/${d1Pkg?.default_branch || 'main'}`
          : undefined);
      const rawLongDesc =
        d1Pkg?.long_desc ||
        gitScan?.cdbMeta?.long_description ||
        gitScan?.longDesc ||
        d1Pkg?.short_desc ||
        gitScan?.shortDesc ||
        '';
      const fallbackReadme =
        rawLongDesc && rawLongDesc !== (d1Pkg?.short_desc || gitScan?.shortDesc)
          ? rewriteRelativeMarkdownUrls(rawLongDesc, fallbackRawBase)
          : undefined;

      if (bundledReleases.length === 0 && !isLite && resolvedRepo) {
        const discoveredGitRels = await discoverGitReleasesCached(
          resolvedAuthor,
          resolvedName,
          resolvedRepo,
          d1Pkg?.default_branch || 'main',
          d1Pkg?.min_minetest_version || gitScan?.minVersion || '5.0.0'
        );
        if (discoveredGitRels.length > 0) {
          bundledReleases = discoveredGitRels;
        }
      }

      const firstRelSize = Number(bundledReleases[0]?.size || d1Pkg?.download_size || 0);
      const gitFileSize = firstRelSize > 0
        ? formatByteSize(firstRelSize)
        : (d1Pkg?.file_size || undefined);

      const cdbDownloads = Number(d1Pkg?.contentdb_downloads || 0);
      const lhDownloads = Math.max(
        Number(d1Pkg?.luantihub_downloads || 0),
        d1DailyDownloadsSum,
        Math.max(0, Number(d1Pkg?.downloads_count || 0) - cdbDownloads)
      );
      const totalDownloads = cdbDownloads + lhDownloads;

      const gitVideoUrl = d1Pkg?.video_url || gitScan?.cdbMeta?.video_url;
      const gitVideoThumb = d1Pkg?.video_thumbnail_url;
      const resolvedGitVideo = extractEmbeddedVideo(
        gitVideoUrl,
        gitVideoThumb,
        rawLongDesc,
        readme || fallbackReadme
      );

      const mergedTags = Array.from(
        new Set([
          ...d1Tags,
          ...(gitScan?.cdbMeta?.tags || []),
          ...(d1Tags.length === 0 && !(gitScan?.cdbMeta?.tags?.length) ? [resolvedType, 'git'] : [])
        ])
      ).filter(Boolean);
      const mergedHardDeps = d1HardDeps.length > 0 ? d1HardDeps : (gitScan?.hardDeps || []);
      const mergedSoftDeps = d1SoftDeps.length > 0 ? d1SoftDeps : (gitScan?.softDeps || []);
      const mergedLicense = d1Pkg?.license || gitScan?.license || gitScan?.mediaLicense || '';
      const mergedMediaLicense = d1Pkg?.media_license || gitScan?.mediaLicense || mergedLicense || '';
      const mergedShortDesc = d1Pkg?.short_desc || gitScan?.cdbMeta?.short_description || gitScan?.shortDesc || '';
      const mergedTitle = d1Pkg?.title || gitScan?.cdbMeta?.title || gitScan?.title || resolvedName;

      // Persist newly scanned Git/.cdb.json metadata back into D1 if missing
      if (context.env.DB && d1Pkg && gitScan && gitScan.gitRepoStatus === 'verified') {
        context.env.DB.prepare(`
          UPDATE packages SET
            license = CASE WHEN COALESCE(license, '') = '' THEN ? ELSE license END,
            media_license = CASE WHEN COALESCE(media_license, '') = '' THEN ? ELSE media_license END,
            short_desc = CASE WHEN COALESCE(short_desc, '') = '' THEN ? ELSE short_desc END,
            video_url = COALESCE(video_url, ?),
            video_thumbnail_url = COALESCE(video_thumbnail_url, ?),
            dependencies = COALESCE(dependencies, ?),
            optional_dependencies = COALESCE(optional_dependencies, ?)
          WHERE id = ?
        `).bind(
          mergedLicense,
          mergedMediaLicense,
          mergedShortDesc || null,
          resolvedGitVideo.video_url || null,
          resolvedGitVideo.video_thumbnail_url || null,
          mergedHardDeps.length > 0 ? JSON.stringify(mergedHardDeps) : null,
          mergedSoftDeps.length > 0 ? JSON.stringify(mergedSoftDeps) : null,
          d1Pkg.id
        ).run().catch(() => {});
      }

      const pureGitPayload = {
        id: `${resolvedAuthor}/${resolvedName}`,
        author: resolvedAuthor,
        name: resolvedName,
        title: mergedTitle,
        type: resolvedType,
        short_desc: mergedShortDesc,
        long_description: rawLongDesc || mergedShortDesc,
        desc: rawLongDesc || mergedShortDesc,
        readme: readme || fallbackReadme || undefined,
        thumbnail: d1Pkg?.thumbnail_url || (fallbackRawBase ? `${fallbackRawBase}/screenshot.png` : 'logo.svg'),
        banner: d1Pkg?.banner_url || d1Pkg?.thumbnail_url || (fallbackRawBase ? `${fallbackRawBase}/screenshot.png` : 'logo.svg'),
        license: mergedLicense,
        media_license: mergedMediaLicense,
        score: d1ReviewAvg ? Number(d1ReviewAvg.toFixed(1)) : Number(d1Pkg?.score || 0),
        contentdb_downloads: cdbDownloads,
        luantihub_downloads: lhDownloads,
        downloads: totalDownloads,
        repo: resolvedRepo,
        repo_url: resolvedRepo,
        git_repo_status: gitScan?.gitRepoStatus || (resolvedRepo ? 'verified' : 'unverified'),
        website: gitScan?.cdbMeta?.website || undefined,
        issue_tracker: d1Pkg?.issue_tracker || gitScan?.cdbMeta?.issue_tracker || undefined,
        forum_url: d1Pkg?.forum_url || gitScan?.cdbMeta?.forum_url || undefined,
        forums: d1Pkg?.forum_url || gitScan?.cdbMeta?.forum_url || undefined,
        donate_url: d1Pkg?.donate_url || gitScan?.cdbMeta?.donate_url || undefined,
        translation_url: d1Pkg?.translation_url || gitScan?.cdbMeta?.translation_url || undefined,
        video_url: resolvedGitVideo.video_url,
        video_thumbnail_url: resolvedGitVideo.video_thumbnail_url,
        dev_state: d1Pkg?.dev_state || gitScan?.cdbMeta?.dev_state || undefined,
        provides: parseJsonArray(d1Pkg?.provides),
        content_warnings:
          parseJsonArray(d1Pkg?.content_warnings).length > 0
            ? parseJsonArray(d1Pkg?.content_warnings)
            : (gitScan?.cdbMeta?.content_warnings || []),
        ai_disclosures:
          parseJsonArray(d1Pkg?.ai_disclosures).length > 0
            ? parseJsonArray(d1Pkg?.ai_disclosures)
            : (gitScan?.cdbMeta?.ai_disclosures || []),
        maintainers: parseJsonArray(d1Pkg?.maintainers),
        created_at: d1Pkg?.created_at || undefined,
        updated_at: d1Pkg?.updated_at || undefined,
        provider: d1Pkg?.provider || (resolvedRepo.includes('codeberg.org') ? 'codeberg' : resolvedRepo.includes('gitlab.com') ? 'gitlab' : 'github'),
        default_branch: d1Pkg?.default_branch || 'main',
        min_minetest_version: d1Pkg?.min_minetest_version || gitScan?.minVersion || '5.0.0',
        max_minetest_version: d1Pkg?.max_minetest_version || gitScan?.maxVersion || undefined,
        tags: mergedTags,
        dependencies: mergedHardDeps,
        optional_dependencies: mergedSoftDeps,
        download_size: firstRelSize > 0 ? firstRelSize : undefined,
        file_size: gitFileSize,
        status: d1Pkg?.status || 'active',
        source: isGitPkg ? 'git' : 'official',
        sources,
        releases_list: bundledReleases,
        reviews_list: bundledReviews
      };

      return new Response(JSON.stringify(pureGitPayload), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
    }
    return Response.json({ error: 'Package not found' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const canonicalId = `${upstreamData.author || author}/${upstreamData.name || name}`;
  const { hardDeps, softDeps } = extractDependencies(upstreamData, depsPayload, canonicalId);

  let finalHardDeps = hardDeps;
  let finalSoftDeps = softDeps;
  let resolvedLicense = upstreamData.license || upstreamData.media_license || d1Pkg?.license || '';
  let resolvedMediaLicense = upstreamData.media_license || upstreamData.license || d1Pkg?.media_license || '';
  let repoUrl = normalizeDefunctGitHost(upstreamData.repo || upstreamData.repo_url || d1Pkg?.repo_url || undefined);
  let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = repoUrl ? 'verified' : 'unverified';
  let minVersion =
    extractEngineVersionString(upstreamData.min_minetest_version) ||
    extractEngineVersionString(forClientData?.min_minetest_version) ||
    extractEngineVersionString(Array.isArray(releasesPayload) && releasesPayload[0]?.min_minetest_version) ||
    extractEngineVersionString(d1Pkg?.min_minetest_version) ||
    undefined;
  let maxVersion =
    extractEngineVersionString(upstreamData.max_minetest_version) ||
    extractEngineVersionString(forClientData?.max_minetest_version) ||
    extractEngineVersionString(Array.isArray(releasesPayload) && releasesPayload[0]?.max_minetest_version) ||
    extractEngineVersionString(d1Pkg?.max_minetest_version) ||
    undefined;

  // Always probe/verify Git repository when repo_url is missing, migrated, or when mirror lacks dependencies/license/video_url
  let probedCdbMeta: CdbJsonMetadata | null = null;
  let gitProbeScan: GitRepoScanResult | null = null;
  const needsGitProbe = isLite
    ? !resolvedLicense
    : Boolean(repoUrl || !resolvedLicense || !d1Pkg?.video_url);
  if (needsGitProbe) {
    const gitProbe = await probeGitRepoConfAndLicense(
      upstreamData.author || author,
      upstreamData.name || name,
      upstreamData.type || 'mod',
      repoUrl
    );
    gitProbeScan = gitProbe;
    gitRepoStatus = gitProbe.gitRepoStatus;
    probedCdbMeta = gitProbe.cdbMeta || null;
    if (finalHardDeps.length === 0 && gitProbe.hardDeps.length > 0) {
      finalHardDeps = gitProbe.hardDeps;
    }
    if (finalSoftDeps.length === 0 && gitProbe.softDeps.length > 0) {
      finalSoftDeps = gitProbe.softDeps;
    }
    if (!resolvedLicense && (gitProbe.license || gitProbe.mediaLicense)) {
      resolvedLicense = gitProbe.license || gitProbe.mediaLicense || '';
    }
    if (!resolvedMediaLicense && (gitProbe.mediaLicense || gitProbe.license)) {
      resolvedMediaLicense = gitProbe.mediaLicense || gitProbe.license || '';
    }
    if (gitProbe.repoUrl) {
      repoUrl = gitProbe.repoUrl;
    }
    if (!minVersion && gitProbe.minVersion) {
      minVersion = gitProbe.minVersion;
    }
    if (!maxVersion && gitProbe.maxVersion) {
      maxVersion = gitProbe.maxVersion;
    }

    // Automated 404 Git Repository Detection & Self-Healing:
    // Report stale/404 Git repos to admins/moderators in D1, or auto-resolve open 'broken' reports once back online
    if (gitRepoStatus === 'broken_404' && context.env.DB) {
      try {
        await ensureModerationColumns(context.env.DB);
        const existingReport = await context.env.DB.prepare(
          `SELECT id FROM moderation_reports WHERE LOWER(package_id) = LOWER(?) AND reason = 'broken' AND status = 'open' LIMIT 1`
        ).bind(canonicalId).first();
        if (!existingReport) {
          const attempted = repoUrl || `https://github.com/${upstreamData.author || author}/${upstreamData.name || name}`;
          await context.env.DB.prepare(
            `INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status) VALUES (?, 'system-git-monitor', 'broken', ?, 'open')`
          ).bind(
            canonicalId,
            `[Automated 404 Git Detection] Repository URL (${attempted}) returned HTTP 404 across GitHub, Codeberg, and GitLab. Flagged for admin/moderator review to prevent stale content packages.`
          ).run();
        }
      } catch {
        // Non-blocking auto-report
      }
    } else if (gitRepoStatus === 'verified' && context.env.DB) {
      await autoResolveBrokenRepoReport(context.env.DB, canonicalId);
    }
  } else if (gitRepoStatus === 'verified' && context.env.DB) {
    await autoResolveBrokenRepoReport(context.env.DB, canonicalId);
  }

  // Normalize tags array
  let normalizedTags: string[] = [];
  const rawTagsSource = Array.isArray(upstreamData.tags)
    ? upstreamData.tags
    : (Array.isArray(forClientData?.tags) ? forClientData.tags : []);
  if (rawTagsSource.length > 0) {
    normalizedTags = rawTagsSource
      .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
      .filter(Boolean);
  }
  if (normalizedTags.length === 0) {
    const fallbackD1Tags = parseJsonArray(d1Pkg?.tags);
    const cdbTags = probedCdbMeta?.tags || [];
    normalizedTags = fallbackD1Tags.length > 0
      ? fallbackD1Tags
      : (cdbTags.length > 0 ? cdbTags : [upstreamData.type || 'mod']);
  } else if (probedCdbMeta?.tags && probedCdbMeta.tags.length > 0) {
    normalizedTags = Array.from(new Set([...normalizedTags, ...probedCdbMeta.tags]));
  }

  // Normalize screenshots array
  let screenshots: string[] = [];
  const rawScreenshotsSource = Array.isArray(upstreamData.screenshots)
    ? upstreamData.screenshots
    : (Array.isArray(forClientData?.screenshots) ? forClientData.screenshots : []);
  if (rawScreenshotsSource.length > 0) {
    screenshots = rawScreenshotsSource
      .map((s: any) => (typeof s === 'string' ? s : s?.url || ''))
      .filter(Boolean);
  }

  // Resolve download_size & file_size from /for-client/, /packages/:author/:name/, latest release, or Content-Length HEAD check
  const rawSizeSource =
    forClientData?.download_size ??
    upstreamData.download_size ??
    (Array.isArray(releasesPayload) && releasesPayload[0] ? (releasesPayload[0].size || releasesPayload[0].file_size) : undefined) ??
    d1Pkg?.download_size;
  const downloadSizeBytes = parseDownloadSizeBytes(rawSizeSource);
  const fileSize: string | undefined = formatByteSize(rawSizeSource);
  let latestDownloadUrl = `https://content.luanti.org/packages/${encAuthor}/${encName}/download/`;
  if (Array.isArray(releasesPayload) && releasesPayload.length > 0) {
    const firstRel = releasesPayload[0];
    const rawRelUrl = firstRel.url || '';
    if (rawRelUrl) {
      latestDownloadUrl = rawRelUrl.startsWith('http')
        ? rawRelUrl
        : `https://content.luanti.org${rawRelUrl}`;
    }
  }

  const [resolvedHeadSize, readmeText] = await Promise.all([
    fileSize
      ? Promise.resolve(fileSize)
      : (isLite ? Promise.resolve(d1Pkg?.file_size || undefined) : resolveArchiveSizeCached(latestDownloadUrl)),
    isLite ? Promise.resolve<string | null>(null) : fetchRepoReadmeCached(repoUrl)
  ]);

  const d1Tags = parseJsonArray(d1Pkg?.tags);
  const d1HardDeps = parseJsonArray(d1Pkg?.dependencies);
  const d1SoftDeps = parseJsonArray(d1Pkg?.optional_dependencies);
  const isRegisteredInGitCommunity = Boolean(
    d1Pkg && (d1Pkg.provider !== 'contentdb' || d1Tags.includes('git'))
  );
  const sources: Array<'official' | 'git'> = isRegisteredInGitCommunity ? ['official', 'git'] : ['official'];

  // Extract long_description (supports plain string or { type: 'hypertext', body: '...' } across detail, for-client, .cdb.json, .conf, and dependencies payloads)
  const extractedLongDesc =
    extractLongDescriptionText(upstreamData.long_description) ||
    extractLongDescriptionText(forClientData?.long_description) ||
    extractLongDescriptionText(depsPayload?.long_description) ||
    extractLongDescriptionText(upstreamData.desc) ||
    probedCdbMeta?.long_description ||
    gitProbeScan?.longDesc ||
    (!readmeText ? d1Pkg?.long_desc : undefined) ||
    '';

  const shortDesc =
    upstreamData.short_desc ||
    upstreamData.short_description ||
    forClientData?.short_desc ||
    probedCdbMeta?.short_description ||
    gitProbeScan?.shortDesc ||
    d1Pkg?.short_desc ||
    '';

  // Dual-counter downloads: contentdb_downloads + luantihub_downloads
  const contentdbDownloads = Math.max(
    Number(upstreamData.downloads || 0),
    Number(forClientData?.downloads || 0),
    Number(d1Pkg?.contentdb_downloads || 0)
  );
  const luantihubDownloads = Math.max(
    Number(d1Pkg?.luantihub_downloads || 0),
    d1DailyDownloadsSum
  );
  const totalDownloads = contentdbDownloads + luantihubDownloads;

  // Normalize URLs & extra ContentDB / .cdb.json metadata
  const rawForum = upstreamData.forum_url || forClientData?.forum_url || upstreamData.forums || forClientData?.forums || probedCdbMeta?.forum_url || d1Pkg?.forum_url;
  const forumUrl = rawForum
    ? (String(rawForum).startsWith('http')
        ? String(rawForum)
        : `https://forum.luanti.org/viewtopic.php?t=${rawForum}`)
    : undefined;
  const donateUrl = upstreamData.donate_url || forClientData?.donate_url || probedCdbMeta?.donate_url || d1Pkg?.donate_url || undefined;
  const issueTrackerUrl = upstreamData.issue_tracker || forClientData?.issue_tracker || probedCdbMeta?.issue_tracker || d1Pkg?.issue_tracker || undefined;
  const translationUrl = upstreamData.translation_url || forClientData?.translation_url || probedCdbMeta?.translation_url || d1Pkg?.translation_url || undefined;
  const resolvedVideo = extractEmbeddedVideo(
    upstreamData.video_url || forClientData?.video_url || probedCdbMeta?.video_url || d1Pkg?.video_url,
    upstreamData.video_thumbnail_url || forClientData?.video_thumbnail_url || d1Pkg?.video_thumbnail_url,
    extractedLongDesc,
    readmeText
  );
  const videoUrl = resolvedVideo.video_url;
  const videoThumbnailUrl = resolvedVideo.video_thumbnail_url;
  const devState = upstreamData.dev_state || forClientData?.dev_state || probedCdbMeta?.dev_state || d1Pkg?.dev_state || undefined;

  const rawProvides = Array.isArray(upstreamData.provides)
    ? upstreamData.provides
    : (Array.isArray(forClientData?.provides) ? forClientData.provides : parseJsonArray(d1Pkg?.provides));
  const providesList = rawProvides
    .map((p: any) => (typeof p === 'string' ? p : p?.name || ''))
    .filter(Boolean);

  const rawWarnings = Array.isArray(upstreamData.content_warnings)
    ? upstreamData.content_warnings
    : (Array.isArray(forClientData?.content_warnings)
        ? forClientData.content_warnings
        : (probedCdbMeta?.content_warnings?.length ? probedCdbMeta.content_warnings : parseJsonArray(d1Pkg?.content_warnings)));
  const contentWarnings = rawWarnings
    .map((w: any) => (typeof w === 'string' ? w : w?.name || w?.title || ''))
    .filter(Boolean);

  const rawAiDisclosures = Array.isArray(upstreamData.ai_disclosures)
    ? upstreamData.ai_disclosures
    : typeof upstreamData.ai_disclosure === 'string' && upstreamData.ai_disclosure.trim()
      ? [upstreamData.ai_disclosure.trim()]
      : (Array.isArray(forClientData?.ai_disclosures)
          ? forClientData.ai_disclosures
          : typeof forClientData?.ai_disclosure === 'string' && forClientData.ai_disclosure.trim()
            ? [forClientData.ai_disclosure.trim()]
            : (probedCdbMeta?.ai_disclosures?.length ? probedCdbMeta.ai_disclosures : parseJsonArray(d1Pkg?.ai_disclosures)));
  const aiDisclosures = rawAiDisclosures
    .map((a: any) => (typeof a === 'string' ? a : a?.name || a?.title || ''))
    .filter(Boolean);

  const rawMaintainers = Array.isArray(upstreamData.maintainers)
    ? upstreamData.maintainers
    : (Array.isArray(forClientData?.maintainers) ? forClientData.maintainers : parseJsonArray(d1Pkg?.maintainers));
  const maintainersList = rawMaintainers
    .map((m: any) => (typeof m === 'string' ? m : m?.username || m?.name || ''))
    .filter(Boolean);

  const rawReviewCounts = upstreamData.reviews && !Array.isArray(upstreamData.reviews) && typeof upstreamData.reviews === 'object'
    ? upstreamData.reviews
    : (forClientData?.reviews && !Array.isArray(forClientData.reviews) && typeof forClientData.reviews === 'object'
        ? forClientData.reviews
        : undefined);
  const reviewThreadCounts = rawReviewCounts
    ? {
        positive: Number(rawReviewCounts.positive || 0),
        neutral: Number(rawReviewCounts.neutral || 0),
        negative: Number(rawReviewCounts.negative || 0)
      }
    : undefined;

  const createdAt = upstreamData.created_at || forClientData?.created_at || d1Pkg?.created_at || undefined;
  const updatedAt =
    upstreamData.updated_at ||
    forClientData?.updated_at ||
    (bundledReleases[0]?.release_date || bundledReleases[0]?.released_at) ||
    upstreamData.approved_at ||
    d1Pkg?.updated_at ||
    undefined;

  const combinedTagsList = Array.from(new Set([...normalizedTags, ...d1Tags])).filter(Boolean);
  const resolvedHardDeps = finalHardDeps.length > 0 ? finalHardDeps : d1HardDeps;
  const resolvedSoftDeps = finalSoftDeps.length > 0 ? finalSoftDeps : d1SoftDeps;

  // Persist synced ContentDB downloads, license, tags & extended metadata back to D1 (upsert for official ContentDB packages)
  if (context.env.DB) {
    const cdbAuthor = String(upstreamData.author || author).trim();
    const cdbName = String(upstreamData.name || name).trim();
    const cdbTitle = String(upstreamData.title || d1Pkg?.title || cdbName).trim();
    const cdbType = ['mod', 'game', 'txp', 'modpack'].includes(String(upstreamData.type || d1Pkg?.type || 'mod'))
      ? String(upstreamData.type || d1Pkg?.type || 'mod')
      : 'mod';
    const cdbThumb = upstreamData.thumbnail || d1Pkg?.thumbnail_url || null;
    const cdbBanner = screenshots[0] || d1Pkg?.banner_url || (cdbThumb && String(cdbThumb).includes('thumbnail.png') ? String(cdbThumb).replace('thumbnail.png', 'shot-0.png') : cdbThumb);
    const targetRowId = d1Pkg?.id || canonicalId;

    context.env.DB.prepare(`
      INSERT INTO packages (
        id, author_name, name, title, type, short_desc, long_desc, repo_url, provider,
        thumbnail_url, banner_url, license, media_license, tags, dependencies, optional_dependencies,
        min_minetest_version, status, downloads_count, contentdb_downloads, luantihub_downloads,
        download_size, file_size, donate_url, translation_url, forum_url, issue_tracker,
        video_url, video_thumbnail_url, dev_state, provides
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 'contentdb',
        ?, ?, ?, ?, ?, ?, ?,
        ?, 'active', ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        contentdb_downloads = excluded.contentdb_downloads,
        luantihub_downloads = excluded.luantihub_downloads,
        downloads_count = excluded.downloads_count,
        license = CASE WHEN excluded.license != '' THEN excluded.license ELSE packages.license END,
        media_license = CASE WHEN excluded.media_license != '' THEN excluded.media_license ELSE packages.media_license END,
        tags = COALESCE(excluded.tags, packages.tags),
        dependencies = COALESCE(excluded.dependencies, packages.dependencies),
        optional_dependencies = COALESCE(excluded.optional_dependencies, packages.optional_dependencies),
        min_minetest_version = COALESCE(excluded.min_minetest_version, packages.min_minetest_version),
        download_size = COALESCE(excluded.download_size, packages.download_size),
        file_size = COALESCE(excluded.file_size, packages.file_size),
        donate_url = COALESCE(excluded.donate_url, packages.donate_url),
        issue_tracker = COALESCE(excluded.issue_tracker, packages.issue_tracker),
        translation_url = COALESCE(excluded.translation_url, packages.translation_url),
        forum_url = COALESCE(excluded.forum_url, packages.forum_url),
        video_url = COALESCE(excluded.video_url, packages.video_url),
        video_thumbnail_url = COALESCE(excluded.video_thumbnail_url, packages.video_thumbnail_url),
        dev_state = COALESCE(excluded.dev_state, packages.dev_state),
        provides = COALESCE(excluded.provides, packages.provides),
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      targetRowId,
      cdbAuthor,
      cdbName,
      cdbTitle,
      cdbType,
      shortDesc || null,
      extractedLongDesc || null,
      repoUrl || '',
      cdbThumb,
      cdbBanner || null,
      resolvedLicense || '',
      resolvedMediaLicense || resolvedLicense || '',
      combinedTagsList.length > 0 ? JSON.stringify(combinedTagsList) : null,
      resolvedHardDeps.length > 0 ? JSON.stringify(resolvedHardDeps) : null,
      resolvedSoftDeps.length > 0 ? JSON.stringify(resolvedSoftDeps) : null,
      minVersion || '5.0.0',
      totalDownloads,
      contentdbDownloads,
      luantihubDownloads,
      downloadSizeBytes > 0 ? downloadSizeBytes : null,
      resolvedHeadSize || null,
      donateUrl || null,
      translationUrl || null,
      forumUrl || null,
      issueTrackerUrl || null,
      videoUrl || null,
      videoThumbnailUrl || null,
      devState || null,
      providesList.length > 0 ? JSON.stringify(providesList) : null
    ).run().catch(() => {});
  }

  const rawGameSupport = Array.isArray(upstreamData.game_support)
    ? upstreamData.game_support
    : (Array.isArray(forClientData?.game_support) ? forClientData.game_support : []);
  const gameSupport = rawGameSupport
    .filter((gs: any) => gs && gs.game && gs.supports !== false)
    .map((gs: any) => ({
      supports: Boolean(gs.supports ?? true),
      confidence: typeof gs.confidence === 'number' ? gs.confidence : undefined,
      game: {
        id: `${gs.game.author}/${gs.game.name}`,
        author: String(gs.game.author || ''),
        name: String(gs.game.name || ''),
        title: String(gs.game.title || gs.game.name || ''),
        thumbnail: gs.game.thumbnail || undefined,
        short_description: gs.game.short_description || gs.game.short_desc || undefined
      }
    }));

  const enriched = {
    ...upstreamData,
    id: canonicalId,
    license: resolvedLicense,
    media_license: resolvedMediaLicense,
    min_minetest_version: minVersion,
    max_minetest_version: maxVersion,
    short_desc: shortDesc,
    long_description: extractedLongDesc || shortDesc,
    desc: extractedLongDesc || shortDesc,
    readme: readmeText || undefined,
    repo_url: repoUrl,
    git_repo_status: gitRepoStatus,
    website: upstreamData.website || forClientData?.website || probedCdbMeta?.website || undefined,
    issue_tracker: issueTrackerUrl,
    forum_url: forumUrl,
    forums: forumUrl,
    donate_url: donateUrl,
    translation_url: translationUrl,
    video_url: videoUrl,
    video_thumbnail_url: videoThumbnailUrl,
    dev_state: devState,
    provides: providesList,
    content_warnings: contentWarnings,
    ai_disclosures: aiDisclosures,
    maintainers: maintainersList,
    review_thread_counts: reviewThreadCounts,
    supports_all_games: typeof upstreamData.supports_all_games === 'boolean' ? upstreamData.supports_all_games : undefined,
    game_support: gameSupport.length > 0 ? gameSupport : undefined,
    created_at: createdAt,
    updated_at: updatedAt,
    screenshots,
    tags: Array.from(new Set([...normalizedTags, ...d1Tags])).filter(Boolean),
    contentdb_downloads: contentdbDownloads,
    luantihub_downloads: luantihubDownloads,
    downloads: totalDownloads,
    score: computeStarRating(upstreamData, d1Pkg?.score, d1ReviewAvg),
    download_size: downloadSizeBytes > 0 ? downloadSizeBytes : undefined,
    file_size: resolvedHeadSize || undefined,
    dependencies: finalHardDeps.length > 0 ? finalHardDeps : d1HardDeps,
    optional_dependencies: finalSoftDeps.length > 0 ? finalSoftDeps : d1SoftDeps,
    status: d1Pkg?.status || 'active',
    source: isRegisteredInGitCommunity ? 'git' : 'official',
    sources,
    releases_list: bundledReleases,
    reviews_list: bundledReviews
  };

  await writeEdgeCacheJson(edgeCacheKey, enriched, isLite ? 1800 : 300);

  return new Response(JSON.stringify(enriched), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': isLite
        ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=600'
        : 'no-cache'
    }
  });
}

// PATCH /api/packages/:author/:name — Allow package author or admin to edit package tags
export async function onRequestPatch(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  try {
    const { author, name } = context.params;
    const pkgId = `${author}/${name}`;

    if (!context.env.DB) {
      return Response.json({ error: 'Database unavailable.' }, { status: 503 });
    }

    await ensureExtendedPackageColumns(context.env.DB);

  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Authentication required to edit package.' }, { status: 401 });
  }

  const rawUserId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!rawUserId) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const user = await reconcileAndMergeUserAccount(context.env.DB, rawUserId);
  if (!user) {
    return Response.json({ error: 'User account not found.' }, { status: 401 });
  }
  const resolvedUserId = String(user.id);

  const [identitiesRes, pkgRow] = await Promise.all([
    context.env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(resolvedUserId).all().catch(() => ({ results: [] })),
    context.env.DB.prepare(
      `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
    ).bind(pkgId, author, name).first()
  ]);

  if (!pkgRow) {
    return Response.json({ error: 'Package not found in D1 registry.' }, { status: 404 });
  }

  const identities = (identitiesRes.results || []).map((id: any) => ({
    provider: String(id.provider || '').toLowerCase(),
    username: String(id.username || ''),
    verified: Boolean(id.verified)
  }));

  const isAdmin = checkIsAdmin(user, identities, context.env.ADMIN_USERS);
  const isOwner =
    isAdmin ||
    verifyStrictPackageAuthorOwnership(user, identities, pkgRow, author);

  if (!isOwner) {
    return Response.json({
      error: 'Forbidden: Only an administrator or the cryptographically verified package author on the hosting Git forge can edit this package.'
    }, { status: 403 });
  }

  const body = await context.request.json().catch(() => ({})) as { tags?: string[] };
  const rawInputTags = Array.isArray(body.tags) ? body.tags : [];

  const systemTagSet = new Set(['git', 'github', 'codeberg', 'gitlab', 'contentdb', 'mod', 'game', 'txp', 'modpack']);
  const cleanedCustomTags = rawInputTags
    .map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9_/-]/g, ''))
    .filter(t => Boolean(t) && !systemTagSet.has(t))
    .slice(0, 8);

  const existingTags = parseJsonArray(pkgRow.tags);
  const preservedSystemTags = existingTags.filter((t: string) => systemTagSet.has(String(t).toLowerCase()));
  if (pkgRow.provider && pkgRow.provider !== 'contentdb' && !preservedSystemTags.includes('git')) {
    preservedSystemTags.push('git');
  }
  if (pkgRow.provider && !preservedSystemTags.includes(pkgRow.provider)) {
    preservedSystemTags.push(pkgRow.provider);
  }
  if (pkgRow.type && !preservedSystemTags.includes(pkgRow.type)) {
    preservedSystemTags.push(pkgRow.type);
  }

  const finalTags = Array.from(new Set([...cleanedCustomTags, ...preservedSystemTags]));

  await context.env.DB.prepare(
    `UPDATE packages SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(JSON.stringify(finalTags), pkgRow.id).run();

  await invalidateEdgeCacheKeys([
    '/__api_packages_v2',
    '/__api_packages_v2?boot=1',
    `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
  ]);

    return Response.json({
      success: true,
      tags: finalTags
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Could not update package tags.') },
      { status: 500 }
    );
  }
}

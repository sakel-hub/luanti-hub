import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  fetchGitRepoReleasesAndTags,
  fetchGitReleaseNotesBetweenRefs,
  fetchGitSmartHttpRefs,
  syncDebouncedGitVersionStamp,
  ensureExtendedPackageColumns,
  buildGitBranchArchiveUrl,
  sortAndCapReleases,
  mergeUpstreamAndGitReleases,
  sanitizeReleaseNotesText,
  scanGitRepoMetadataCached,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  normalizeGitRepoInputUrl,
  MAX_PACKAGE_RELEASES
} from '../../../lib/upstream';
import { findJam2026BrewRepoBySlug } from '../../../lib/jam-2026';
import { parseCookies, verifySessionToken } from '../../../auth/lib/session';
import {
  detectGitProviderFromUrl,
  isUntrustedTunnelOrPrivateHost
} from '../../../../../src/app/core/config/git-providers.config';
import { stripAuthorForgeSuffix } from '../../../../../src/app/core/config/package-utils.config';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

const releasesRefreshCooldown = new Map<string, number>();

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

export async function onRequestGet(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  const author = safeDecodeParam(context.params.author);
  const name = safeDecodeParam(context.params.name);
  const packageId = `${author}/${name}`;
  const reqUrl = context.request?.url ? new URL(context.request.url) : null;
  const isNotesQuery = reqUrl?.searchParams.get('notes') === '1';
  const requestedForceRefresh =
    reqUrl?.searchParams.get('refresh') === '1' || reqUrl?.searchParams.get('nocache') === '1';
  let forceRefresh = false;
  if (requestedForceRefresh && context.request) {
    const cookies = parseCookies(context.request);
    const sessionUserId = cookies['lh_session']
      ? await verifySessionToken(cookies['lh_session'], context.env.SESSION_SECRET)
      : null;
    const now = Date.now();
    const lowerPkgKey = packageId.toLowerCase();
    const lastRefresh = releasesRefreshCooldown.get(lowerPkgKey) || 0;
    if (sessionUserId && now - lastRefresh > 60_000) {
      forceRefresh = true;
      releasesRefreshCooldown.set(lowerPkgKey, now);
    }
  }

  let d1Pkg: any = null;
  let d1Releases: any[] = [];

  // 1. Check D1 Kill Switch & local D1 releases
  if (context.env.DB) {
    try {
      await ensureExtendedPackageColumns(context.env.DB);
      d1Pkg = await context.env.DB.prepare(
        `SELECT id, status, repo_url, provider, default_branch, min_minetest_version, updated_at, latest_commit_sha
         FROM packages
         WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?))
         LIMIT 1`
      ).bind(packageId, author, name).first().catch(() => null);

      if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
        return Response.json({ error: 'Package is delisted or suspended.' }, { status: 451 });
      }
    } catch {
      // Fallback to upstream when local D1 schema is uninitialized
    }
  }

  const queryRepoParam = (reqUrl?.searchParams.get('repo') || '').trim();
  const canonicalReleasesCacheKey = `https://edge-cache.luantihub.local/pkg-releases-v1/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`;

  if (!isNotesQuery && !forceRefresh && !queryRepoParam) {
    const cachedReleases = await readEdgeCacheJson<any[]>(canonicalReleasesCacheKey);
    if (Array.isArray(cachedReleases)) {
      return new Response(JSON.stringify(cachedReleases), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60, s-maxage=300'
        }
      });
    }
  }

  if (context.env.DB && !isNotesQuery) {
    try {
      const effectivePkgId = d1Pkg?.id || packageId;
      const releases = await context.env.DB.prepare(
        `SELECT * FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY released_at DESC, id DESC`
      ).bind(effectivePkgId).all().catch(() => ({ results: [] }));

      d1Releases = sortAndCapReleases(releases.results || [], MAX_PACKAGE_RELEASES);
    } catch {
      // Fallback to upstream when local D1 schema is uninitialized
    }
  }

  // Handle lazy-loaded expandable Release Notes & Commit Diff request (`?notes=1&head=...&base=...`)
  if (isNotesQuery && reqUrl) {
    const headRef = (reqUrl.searchParams.get('head') || '').trim();
    const baseRef = (reqUrl.searchParams.get('base') || '').trim();
    const rawBranchParam = (reqUrl.searchParams.get('branch') || '').trim();
    let branchParam = (
      d1Pkg?.default_branch ||
      rawBranchParam ||
      'main'
    ).trim();
    const untilParam = (reqUrl.searchParams.get('until') || '').trim();
    const repoParam = (reqUrl.searchParams.get('repo') || '').trim();
    let repoUrl = d1Pkg?.repo_url ? String(d1Pkg.repo_url).trim() : '';
    let usedNotesRepoFallback = false;
    const releaseBody = '';

    let cdbHasNoRepo = false;
    if (!repoUrl) {
      const cdbDetail = await fetchUpstreamJsonCached<any>(
        `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
        600
      );
      if (cdbDetail?.repo) {
        repoUrl = String(cdbDetail.repo).trim();
      } else if (cdbDetail && typeof cdbDetail === 'object' && (cdbDetail.name || cdbDetail.author)) {
        cdbHasNoRepo = true;
      }
    }

    if (!repoUrl) {
      const jamRepo = await findJam2026BrewRepoBySlug(author, name).catch(() => undefined);
      if (jamRepo) {
        repoUrl = jamRepo;
      }
    }

    if (!repoUrl && !cdbHasNoRepo) {
      try {
        const scanned = await scanGitRepoMetadataCached(author, name);
        if (scanned?.repoUrl && scanned.gitRepoStatus === 'verified') {
          repoUrl = scanned.repoUrl;
        }
        if (scanned?.defaultBranch && (!d1Pkg?.default_branch || d1Pkg.default_branch === 'main')) {
          branchParam = scanned.defaultBranch;
        }
      } catch {
        // Non-fatal fallback
      }
    }

    if (!repoUrl && repoParam) {
      const validatedFallback = validateFallbackRepoMatchesSlug(repoParam, author, name);
      if (validatedFallback) {
        repoUrl = validatedFallback;
        usedNotesRepoFallback = true;
      }
    }

    const notesPayload = await fetchGitReleaseNotesBetweenRefs(
      repoUrl || null,
      cdbHasNoRepo ? undefined : author,
      cdbHasNoRepo ? undefined : name,
      {
        headRef: headRef || branchParam || 'HEAD',
        baseRef: baseRef || undefined,
        defaultBranch: branchParam || 'main',
        releaseBody,
        untilDate: untilParam || undefined
      }
    );

    if (
      !usedNotesRepoFallback &&
      context.env.DB &&
      d1Pkg?.id &&
      notesPayload.resolved_default_branch &&
      notesPayload.resolved_default_branch !== d1Pkg.default_branch
    ) {
      context.env.DB.prepare(`UPDATE packages SET default_branch = ? WHERE id = ?`)
        .bind(notesPayload.resolved_default_branch, d1Pkg.id)
        .run()
        .catch(() => {});
    }

    return new Response(JSON.stringify(notesPayload), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, s-maxage=3600'
      }
    });
  }

  // 2. Resolve repository URL & query official ContentDB + live Git repository tags/releases in parallel
  const isPureGitOnly = Boolean(d1Pkg && d1Pkg.provider && d1Pkg.provider !== 'contentdb');
  let resolvedRepoUrl: string = d1Pkg?.repo_url ? String(d1Pkg.repo_url).trim() : '';
  let usedExplicitRepoFallback = false;
  let cdbHasNoRepo = false;

  if (!resolvedRepoUrl && !isPureGitOnly) {
    const cdbDetail = await fetchUpstreamJsonCached<any>(
      `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
      600
    ).catch(() => null);
    if (cdbDetail?.repo || cdbDetail?.repo_url) {
      resolvedRepoUrl = String(cdbDetail.repo || cdbDetail.repo_url).trim();
    } else if (cdbDetail && typeof cdbDetail === 'object') {
      cdbHasNoRepo = true;
    }
  }

  if (!resolvedRepoUrl) {
    const jamRepo = await findJam2026BrewRepoBySlug(author, name).catch(() => undefined);
    if (jamRepo) {
      resolvedRepoUrl = jamRepo;
    }
  }

  if (!resolvedRepoUrl && queryRepoParam) {
    const validatedFallback = validateFallbackRepoMatchesSlug(queryRepoParam, author, name);
    if (validatedFallback) {
      resolvedRepoUrl = validatedFallback;
      usedExplicitRepoFallback = true;
    }
  }

  const effectiveReleasesCacheKey =
    usedExplicitRepoFallback && resolvedRepoUrl
      ? `${canonicalReleasesCacheKey}?repo=${encodeURIComponent(resolvedRepoUrl.toLowerCase())}`
      : canonicalReleasesCacheKey;

  if (!forceRefresh && queryRepoParam) {
    const cachedReleases = await readEdgeCacheJson<any[]>(effectiveReleasesCacheKey);
    if (Array.isArray(cachedReleases)) {
      return new Response(JSON.stringify(cachedReleases), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60, s-maxage=300'
        }
      });
    }
  }

  const [data, discoveredGitReleases] = await Promise.all([
    isPureGitOnly
      ? Promise.resolve(null)
      : fetchUpstreamJsonCached<any[]>(
          `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/`,
          forceRefresh ? 0 : 120
        ),
    resolvedRepoUrl || isPureGitOnly
      ? fetchGitRepoReleasesAndTags(
          resolvedRepoUrl || null,
          author,
          name,
          d1Pkg?.min_minetest_version || '5.0.0',
          forceRefresh
        )
      : Promise.resolve([])
  ]);

  const hasOfficialContentDbReleases = Array.isArray(data) && data.length > 0;
  let baseReleases: any[] = [];

  if (hasOfficialContentDbReleases) {
    baseReleases = data!.map((r: any) => {
      const rawUrl = r.url || '';
      const fullDownloadUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl
          ? `https://content.luanti.org${rawUrl}`
          : `https://content.luanti.org/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/${r.id}/download/`;
      const packagedUrl = r.id
        ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?release=${encodeURIComponent(String(r.id))}`
        : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;

      const rawMinVer = r.min_minetest_version && typeof r.min_minetest_version === 'object'
        ? r.min_minetest_version.name
        : r.min_minetest_version;
      const rawMaxVer = r.max_minetest_version && typeof r.max_minetest_version === 'object'
        ? r.max_minetest_version.name
        : r.max_minetest_version;

      return {
        id: r.id,
        version: String(r.title || r.name || r.id || 'latest'),
        title: String(r.title || r.name || r.id || 'Release'),
        tag_name: String(r.title || r.name || r.id || 'latest'),
        commit_sha: r.commit || '',
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: fullDownloadUrl,
        size: typeof r.size === 'number' && r.size > 0 ? r.size : (r.file_size || undefined),
        downloads: typeof r.downloads === 'number' ? r.downloads : undefined,
        release_notes: sanitizeReleaseNotesText(r.release_notes, String(r.title || r.name || r.id || '')),
        changelog: sanitizeReleaseNotesText(r.release_notes, String(r.title || r.name || r.id || '')),
        sha256: typeof r.sha256 === 'string' && r.sha256.trim() ? r.sha256.trim() : undefined,
        min_minetest_version: (rawMinVer && String(rawMinVer).toLowerCase() !== 'none' ? String(rawMinVer) : undefined) || r.min_protocol_version || undefined,
        max_minetest_version: (rawMaxVer && String(rawMaxVer).toLowerCase() !== 'none' ? String(rawMaxVer) : undefined) || r.max_protocol_version || undefined,
        release_date: r.release_date || undefined,
        released_at: r.release_date || ''
      };
    });
  } else if (d1Releases.length > 0) {
    baseReleases = d1Releases.map((r: any) => {
      const tag = String(r.tag_name || r.version || '').trim();
      const isBranchFallback = r.commit_sha === 'HEAD' || r.version === 'latest';
      const packagedUrl = !isBranchFallback && tag
        ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?tag=${encodeURIComponent(tag)}`
        : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
      return {
        id: r.id,
        version: tag,
        title: tag,
        tag_name: tag,
        commit_sha: r.commit_sha,
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: r.download_url,
        min_minetest_version: r.min_minetest_version,
        max_minetest_version: r.max_minetest_version,
        changelog: sanitizeReleaseNotesText(r.changelog, tag),
        release_notes: sanitizeReleaseNotesText(r.changelog, tag),
        release_date: r.released_at,
        released_at: r.released_at
      };
    });
  }

  // Merge official ContentDB/D1 releases with live Git repository tags across all supported Git services
  const mergedReleases = mergeUpstreamAndGitReleases(
    baseReleases,
    discoveredGitReleases,
    author,
    name,
    {
      usePackagedDownloadUrls: true,
      isOfficialContentDbBase: hasOfficialContentDbReleases
    }
  );

  const hasRealMergedReleases = mergedReleases.some(
    (r: any) => r && r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
  );

  if (hasRealMergedReleases) {
    if (
      !usedExplicitRepoFallback &&
      context.env.DB &&
      d1Pkg?.id &&
      (discoveredGitReleases.length > 0 || forceRefresh)
    ) {
      const topMerged = mergedReleases[0];
      const topD1 = d1Releases[0];
      const topMergedTag = String(topMerged?.tag_name || topMerged?.version || '').trim();
      const topD1Tag = String(topD1?.tag_name || topD1?.version || '').trim();
      const topMergedSha = String(topMerged?.commit_sha || '').trim();
      const topD1Sha = String(topD1?.commit_sha || '').trim();
      const hasNewerRelease =
        d1Releases.length === 0 ||
        topMergedTag !== topD1Tag ||
        (Boolean(topMergedSha) && topMergedSha !== topD1Sha);

      if (hasNewerRelease || forceRefresh) {
        try {
          const releaseStmts: any[] = [
            context.env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(d1Pkg.id)
          ];
          for (const rel of mergedReleases.slice(0, MAX_PACKAGE_RELEASES)) {
            releaseStmts.push(
              context.env.DB.prepare(`
                INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, max_minetest_version, changelog, released_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))
              `).bind(
                d1Pkg.id,
                rel.version || rel.title || 'latest',
                rel.tag_name || rel.version || 'latest',
                rel.commit_sha || '',
                rel.upstream_url || rel.download_url || rel.url || '',
                rel.min_minetest_version || d1Pkg.min_minetest_version || '5.0.0',
                rel.max_minetest_version || null,
                rel.changelog || rel.release_notes || null,
                rel.released_at || rel.release_date || ''
              )
            );
          }
          if (typeof context.env.DB.batch === 'function') {
            await context.env.DB.batch(releaseStmts);
          } else {
            for (const stmt of releaseStmts) {
              await stmt.run();
            }
          }
          const observedRelIso = topMerged?.released_at || topMerged?.release_date || null;
          const newestRelTime = Date.parse(String(observedRelIso || '')) || 0;
          const prevPkgTime = Date.parse(String(d1Pkg.updated_at || '')) || 0;
          await syncDebouncedGitVersionStamp(
            context.env.DB,
            d1Pkg,
            topMerged?.commit_sha || topMerged?.tag_name,
            true,
            observedRelIso
          );
          if (newestRelTime > prevPkgTime) {
            const nextIso = new Date(newestRelTime).toISOString();
            await context.env.DB.prepare(
              `UPDATE packages SET updated_at = ? WHERE id = ?`
            ).bind(nextIso, d1Pkg.id).run();
            d1Pkg.updated_at = nextIso;
          }

          const lowerA = encodeURIComponent(author.toLowerCase());
          const lowerN = encodeURIComponent(name.toLowerCase());
          await invalidateEdgeCacheKeys([
            `https://edge-cache.luantihub.local/pkg-detail-v7/full/${lowerA}/${lowerN}`,
            `https://edge-cache.luantihub.local/pkg-detail-v7/full-readme/${lowerA}/${lowerN}`,
            `https://edge-cache.luantihub.local/pkg-detail-v7/lite/${lowerA}/${lowerN}`
          ]).catch(() => {});
        } catch {
          // Non-blocking D1 sync
        }
      }
    }

    if (!forceRefresh) {
      await writeEdgeCacheJson(effectiveReleasesCacheKey, mergedReleases, 300);
    }

    return new Response(JSON.stringify(mergedReleases), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': forceRefresh ? 'no-store' : 'public, max-age=60, s-maxage=300'
      }
    });
  }

  // 3. Fallback: Discover Git releases/tags by author/name when D1 had no explicit repo_url
  if (!resolvedRepoUrl && !isPureGitOnly && !cdbHasNoRepo) {
    const fallbackGitReleases = await fetchGitRepoReleasesAndTags(
      null,
      author,
      name,
      d1Pkg?.min_minetest_version || '5.0.0',
      forceRefresh
    );
    if (fallbackGitReleases.length > 0) {
      const packagedFallbackReleases = fallbackGitReleases.map(rel => {
        const tag = String(rel.tag_name || rel.version || '').trim();
        const packagedUrl = tag
          ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?tag=${encodeURIComponent(tag)}`
          : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
        return {
          ...rel,
          url: packagedUrl,
          download_url: packagedUrl,
          upstream_url: rel.download_url
        };
      });
      if (!forceRefresh) {
        await writeEdgeCacheJson(effectiveReleasesCacheKey, packagedFallbackReleases, 300);
      }
      return new Response(JSON.stringify(packagedFallbackReleases), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': forceRefresh ? 'no-store' : 'public, max-age=60, s-maxage=300'
        }
      });
    }
  }

  // 4. Final Fallback: Default branch archive from D1 or repository URL when no tags or releases exist
  if (d1Releases.length > 0 && !forceRefresh) {
    const fallbackD1Payload = d1Releases.map((r: any) => {
      const tag = String(r.tag_name || r.version || '').trim();
      const packagedUrl = `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
      return {
        id: r.id,
        version: tag,
        title: tag,
        tag_name: tag,
        commit_sha: r.commit_sha,
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: r.download_url,
        min_minetest_version: r.min_minetest_version,
        max_minetest_version: r.max_minetest_version,
        changelog: sanitizeReleaseNotesText(r.changelog, tag),
        release_notes: sanitizeReleaseNotesText(r.changelog, tag),
        release_date: r.released_at,
        released_at: r.released_at
      };
    });
    await writeEdgeCacheJson(effectiveReleasesCacheKey, fallbackD1Payload, 300);
    return new Response(JSON.stringify(fallbackD1Payload), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (resolvedRepoUrl) {
    const smartRefs = await fetchGitSmartHttpRefs(resolvedRepoUrl, author, name, forceRefresh);
    const branch =
      d1Pkg?.provider === 'contentdb'
        ? (smartRefs?.defaultBranch || 'HEAD')
        : (d1Pkg?.default_branch || smartRefs?.defaultBranch || 'HEAD');
    const resolvedHeadSha = smartRefs?.headSha || 'HEAD';
    if (!usedExplicitRepoFallback && context.env.DB && d1Pkg?.id && smartRefs?.headSha) {
      await syncDebouncedGitVersionStamp(context.env.DB, d1Pkg, smartRefs.headSha, false);
    }
    const branchUrl = buildGitBranchArchiveUrl(resolvedRepoUrl, author, name, branch);
    const packagedUrl = `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
    const branchPayload = [
      {
        id: 1,
        version: branch,
        title: branch,
        tag_name: branch,
        commit_sha: resolvedHeadSha,
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: branchUrl,
        min_minetest_version: d1Pkg?.min_minetest_version || '5.0.0',
        released_at: ''
      }
    ];
    if (!forceRefresh) {
      await writeEdgeCacheJson(effectiveReleasesCacheKey, branchPayload, 300);
    }
    return Response.json(branchPayload, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  return Response.json([], { headers: { 'Access-Control-Allow-Origin': '*' } });
}

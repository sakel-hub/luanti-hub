import {
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  readEdgeCacheJsonSwr,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  UPDATES_EDGE_CACHE_KEY,
  UPDATES_D1_OVERLAY_CACHE_KEY,
  computeLuantiClientReleaseId,
  sanitizeLuantiEngineQueryParams,
  normalizeLuantiBaseAuthor,
  sanitizeLuantiTechnicalName,
  normalizeRepoKey,
  createUpstreamRepoLookup,
  registerUpstreamRepoEntry,
  matchUpstreamRepoEntry,
  hasUpstreamRepoMatch,
  parseJsonArray,
  detectGitProviderFromUrl,
  isGitProviderId
} from './lib/upstream';
import { overlayJam2026UpdatesMap } from './lib/jam-2026';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: {
  request: Request;
  env: Env;
  waitUntil?: (p: Promise<any>) => void;
  _internalSwrRebuild?: boolean;
}) {
  const { env } = context;
  const edgeCacheKey = UPDATES_EDGE_CACHE_KEY;
  const reqUrl = context.request ? new URL(context.request.url) : null;
  const { versionQuery } = sanitizeLuantiEngineQueryParams(reqUrl?.searchParams);
  const hasVersionFilter = Boolean(versionQuery);
  const upstreamPath = hasVersionFilter ? `/updates/?${versionQuery}` : '/updates/';
  const noCache =
    reqUrl?.searchParams.get('nocache') === '1' ||
    reqUrl?.searchParams.get('nocache') === 'true' ||
    (context.request?.headers?.get('Cache-Control') || '').toLowerCase().includes('no-cache');

  if (!hasVersionFilter && !noCache && !context._internalSwrRebuild) {
    const swrUpdates = await readEdgeCacheJsonSwr<Record<string, number>>(
      edgeCacheKey,
      context.waitUntil,
      async () => {
        await onRequestGet({
          request: context.request,
          env,
          waitUntil: context.waitUntil,
          _internalSwrRebuild: true
        });
      }
    );
    if (swrUpdates?.data && typeof swrUpdates.data === 'object') {
      return new Response(JSON.stringify(swrUpdates.data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600',
          'X-LuantiHub-Cache': swrUpdates.hitType
        }
      });
    }
  }

  const queryD1Rows = async (): Promise<any[]> => {
    if (!env.DB) return [];
    try {
      const res = await env.DB.prepare(
        `SELECT author_name, name, type, repo_url, provider, contentdb_downloads, tags, updated_at, created_at, latest_commit_sha FROM packages WHERE status = 'active'`
      ).all();
      return res?.results || [];
    } catch {
      try {
        const fallbackRes = await env.DB.prepare(
          `SELECT author_name, name, type, repo_url, updated_at, created_at FROM packages WHERE status = 'active'`
        ).all();
        return fallbackRes?.results || [];
      } catch {
        return [];
      }
    }
  };

  const cachedD1Overlay = !noCache
    ? await readEdgeCacheJson<{ d1Rows: any[] }>(UPDATES_D1_OVERLAY_CACHE_KEY).catch(() => null)
    : null;

  const [upstreamUpdates, queriedD1Rows, vcsCatalog] = await Promise.all([
    fetchUpstreamJsonCached<Record<string, number>>(upstreamPath, 300).catch(() => null),
    cachedD1Overlay?.d1Rows ? Promise.resolve(cachedD1Overlay.d1Rows) : queryD1Rows(),
    fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 1800).catch(() => null)
  ]);
  const d1Rows = Array.isArray(queriedD1Rows) ? queriedD1Rows : [];

  const merged: Record<string, number> = {};
  const officialUpstreamKeysLower = new Set<string>();
  const upstreamByAuthorAndName = new Map<string, { rel: number; canonicalAuthor: string; canonicalName: string }>();

  if (upstreamUpdates && typeof upstreamUpdates === 'object') {
    for (const [k, v] of Object.entries(upstreamUpdates)) {
      if (typeof v === 'number' && v > 0) {
        merged[k] = v;
        merged[k.toLowerCase()] = v;
        officialUpstreamKeysLower.add(k.toLowerCase());
        const slashIdx = k.indexOf('/');
        if (slashIdx > 0) {
          const canonicalAuthor = k.slice(0, slashIdx);
          const canonicalName = k.slice(slashIdx + 1);
          const authorLower = canonicalAuthor.toLowerCase();
          const baseAuthor = normalizeLuantiBaseAuthor(authorLower);
          const pkgName = canonicalName.toLowerCase();
          const safePkgName = sanitizeLuantiTechnicalName(pkgName, pkgName);
          officialUpstreamKeysLower.add(`${authorLower}/${safePkgName}`);
          const entry = { rel: v, canonicalAuthor, canonicalName };
          upstreamByAuthorAndName.set(`${authorLower}/${pkgName}`, entry);
          upstreamByAuthorAndName.set(`${authorLower}/${safePkgName}`, entry);
          if (baseAuthor && baseAuthor !== authorLower) {
            if (!upstreamByAuthorAndName.has(`${baseAuthor}/${pkgName}`)) {
              upstreamByAuthorAndName.set(`${baseAuthor}/${pkgName}`, entry);
            }
            if (!upstreamByAuthorAndName.has(`${baseAuthor}/${safePkgName}`)) {
              upstreamByAuthorAndName.set(`${baseAuthor}/${safePkgName}`, entry);
            }
          }
        }
      }
    }
  }

  type RepoOfficialEntry = { rel: number; canonicalAuthor: string; canonicalName: string };
  type VcsCatalogEntry = { canonicalAuthor: string; canonicalName: string; vcsRel: number };
  const upstreamVcsById = new Set<string>();
  const upstreamVcsRelById = new Map<string, RepoOfficialEntry>();
  const vcsRepoLookup = createUpstreamRepoLookup<VcsCatalogEntry>();
  const officialUpstreamRepoLookup = createUpstreamRepoLookup<RepoOfficialEntry>();

  if (Array.isArray(vcsCatalog)) {
    for (const item of vcsCatalog) {
      if (!item?.author || !item?.name) continue;
      const canonicalAuthor = String(item.author);
      const canonicalName = String(item.name);
      const authorLower = canonicalAuthor.toLowerCase();
      const nameLower = canonicalName.toLowerCase();
      const safeItemName = sanitizeLuantiTechnicalName(nameLower, nameLower);
      const vcsRel = typeof item.release === 'number' && item.release > 0 ? Math.floor(item.release) : 0;
      const lowerPair = `${authorLower}/${nameLower}`;
      const safePair = `${authorLower}/${safeItemName}`;
      upstreamVcsById.add(lowerPair);
      upstreamVcsById.add(safePair);
      if (vcsRel > 0) {
        const vcsEntry = { rel: vcsRel, canonicalAuthor, canonicalName };
        upstreamVcsRelById.set(lowerPair, vcsEntry);
        upstreamVcsRelById.set(safePair, vcsEntry);
      }
      const repoCandidate = item.repo || item.repo_url;
      registerUpstreamRepoEntry(vcsRepoLookup, repoCandidate, canonicalName, {
        canonicalAuthor,
        canonicalName,
        vcsRel
      });
      const upEntry = upstreamByAuthorAndName.get(lowerPair) || upstreamByAuthorAndName.get(safePair);
      const repoOfficialEntry: RepoOfficialEntry =
        upEntry || {
          rel: !upstreamUpdates && !hasVersionFilter && vcsRel > 0 ? vcsRel : 0,
          canonicalAuthor,
          canonicalName
        };
      registerUpstreamRepoEntry(officialUpstreamRepoLookup, repoCandidate, canonicalName, repoOfficialEntry);
    }
  }

  for (const row of d1Rows) {
    if (!row?.author_name || !row?.name) continue;
    const authorLower = String(row.author_name).toLowerCase();
    const baseAuthor = normalizeLuantiBaseAuthor(authorLower);
    const rawNameLower = String(row.name).toLowerCase();
    const safeName = sanitizeLuantiTechnicalName(rawNameLower);
    const rowRepoKey = normalizeRepoKey(row.repo_url);

    // Match upstream ContentDB package by same author, normalized base-author, or monorepo-safe repository URL
    // so release IDs match /api/packages/ and ContentDB packages never emit epoch timestamps.
    const matchedUpstream =
      upstreamByAuthorAndName.get(`${authorLower}/${rawNameLower}`) ||
      upstreamByAuthorAndName.get(`${authorLower}/${safeName}`) ||
      (baseAuthor && baseAuthor !== authorLower
        ? upstreamByAuthorAndName.get(`${baseAuthor}/${rawNameLower}`) ||
          upstreamByAuthorAndName.get(`${baseAuthor}/${safeName}`)
        : undefined) ||
      (rowRepoKey ? matchUpstreamRepoEntry(officialUpstreamRepoLookup, rowRepoKey, row.name, true) : undefined) ||
      (!upstreamUpdates && !hasVersionFilter
        ? upstreamVcsRelById.get(`${authorLower}/${rawNameLower}`) ||
          upstreamVcsRelById.get(`${authorLower}/${safeName}`)
        : undefined);

    const candidateKeys = [
      `${row.author_name}/${safeName}`,
      `${row.author_name}/${row.name}`,
      `${authorLower}/${safeName}`,
      `${authorLower}/${rawNameLower}`,
      ...(matchedUpstream
        ? [
            `${matchedUpstream.canonicalAuthor}/${matchedUpstream.canonicalName}`,
            `${matchedUpstream.canonicalAuthor}/${safeName}`
          ]
        : []),
      ...(baseAuthor && baseAuthor !== authorLower
        ? [`${baseAuthor}/${safeName}`, `${baseAuthor}/${rawNameLower}`]
        : [])
    ];

    if (matchedUpstream && matchedUpstream.rel === 0) {
      for (const key of candidateKeys) {
        officialUpstreamKeysLower.add(key.toLowerCase());
      }
      continue;
    }

    if (!matchedUpstream) {
      const rowTags = parseJsonArray(row.tags);
      const rawProv = String(row.provider || '').toLowerCase();
      const detectedGitProv = row.repo_url ? detectGitProviderFromUrl(row.repo_url)?.provider : undefined;
      const inVcsCatalog =
        upstreamVcsById.has(`${authorLower}/${rawNameLower}`) ||
        upstreamVcsById.has(`${authorLower}/${safeName}`) ||
        Boolean(
          baseAuthor &&
          (upstreamVcsById.has(`${baseAuthor}/${rawNameLower}`) ||
            upstreamVcsById.has(`${baseAuthor}/${safeName}`))
        ) ||
        Boolean(rowRepoKey && hasUpstreamRepoMatch(vcsRepoLookup, rowRepoKey, row.name, true));
      const isUnhealedPureGitRow =
        Array.isArray(vcsCatalog) &&
        vcsCatalog.length > 0 &&
        !inVcsCatalog &&
        !(Number(row.contentdb_downloads || 0) > 0) &&
        isGitProviderId(detectedGitProv);
      const isOfficialCdbRow =
        inVcsCatalog ||
        (!isUnhealedPureGitRow &&
          (rawProv === 'contentdb' ||
            Number(row.contentdb_downloads || 0) > 0 ||
            rowTags.some((t: string) => String(t).toLowerCase() === 'contentdb')));
      if (isOfficialCdbRow) {
        for (const key of candidateKeys) {
          officialUpstreamKeysLower.add(key.toLowerCase());
        }
        continue;
      }
    }

    const releaseId = computeLuantiClientReleaseId(
      { updated_at: row.updated_at, created_at: row.created_at },
      Number(matchedUpstream?.rel) > 0 ? Number(matchedUpstream!.rel) : undefined
    );

    for (const key of candidateKeys) {
      if (Number(matchedUpstream?.rel) > 0) {
        officialUpstreamKeysLower.add(key.toLowerCase());
      }
      if (!merged[key] || Number(merged[key]) <= 0 || (!matchedUpstream && releaseId > Number(merged[key]))) {
        merged[key] = releaseId;
      }
    }
  }

  const jamDidSyncD1 = await overlayJam2026UpdatesMap(
    merged,
    noCache,
    env.DB,
    d1Rows,
    officialUpstreamKeysLower,
    officialUpstreamRepoLookup
  ).catch(() => false);

  if (jamDidSyncD1) {
    await invalidateEdgeCacheKeys([UPDATES_D1_OVERLAY_CACHE_KEY]).catch(() => {});
  } else if (!noCache && !cachedD1Overlay?.d1Rows && env.DB) {
    await writeEdgeCacheJson(UPDATES_D1_OVERLAY_CACHE_KEY, { d1Rows }, 180).catch(() => {});
  }

  if (!noCache && !hasVersionFilter) {
    if (upstreamUpdates && typeof upstreamUpdates === 'object') {
      await writeEdgeCacheJson(edgeCacheKey, merged, 180, 420);
    } else {
      await writeEdgeCacheJson(edgeCacheKey, merged, 15, 0);
    }
  }

  return new Response(JSON.stringify(merged), {
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

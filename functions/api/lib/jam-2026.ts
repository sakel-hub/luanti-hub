/**
 * Standalone Game Jam 2026 (`jam.luanti.org` / `https://jam.greenxenith.com`) Integration Module.
 *
 * Designed to be 100% self-contained so it can be cleanly removed after the jam closes by deleting:
 * - `functions/api/lib/jam-2026.ts`
 * - `functions/api/jam-2026.ts`
 * - `src/app/core/services/jam-2026-sync.helper.ts`
 * - `src/app/jam-2026.spec.ts`
 */

import {
  normalizeRepoKey,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  buildPackageCacheInvalidationKeys,
  rewriteRelativeMarkdownUrls,
  fetchWithAnubisSupport,
  fetchUpstreamJsonCached,
  ensureExtendedPackageColumns,
  ensurePromotionAndTagTables
} from './upstream';
import { isUntrustedTunnelOrPrivateHost } from '../../../src/app/core/config/git-providers.config';

export const JAM_2026_API_ORIGIN = 'https://jam.greenxenith.com';
export const JAM_2026_BREWS_URL = `${JAM_2026_API_ORIGIN}/api/brews`;
export const JAM_2026_PRIMARY_TAG = 'jam_game_2026';
export const JAM_2026_SECONDARY_TAG = 'gamejam';
export const JAM_2026_TAGS = [JAM_2026_PRIMARY_TAG, JAM_2026_SECONDARY_TAG] as const;

const JAM_2026_EDGE_CACHE_KEY = '/__jam_2026_brews_v2';
const JAM_2026_FALLBACK_CACHE_KEY = '/__jam_2026_brews_fallback_v2';
const JAM_2026_D1_DIGEST_CACHE_KEY = '/__jam_2026_d1_digest_v3';
const JAM_2026_BREWS_TTL_SECONDS = 300; // 5 minutes Edge + Isolate cache (aligned with jam.luanti.org shelfRefreshMs)

const JAM_2026_ALLOWED_IMAGE_HOSTS = new Set<string>([
  'jam.greenxenith.com',
  'gitgud.io',
  'git.gay'
]);

export interface Jam2026BrewEntry {
  id?: string;
  repository: string;
  commit: string;
  title: string;
  description: string;
  commitUrl: string;
  hasScreenshot: boolean;
  publishedAt: string;
}

export interface Jam2026NormalizedPackage {
  id: string;
  jam_entry_id: string;
  author: string;
  name: string;
  aliases?: string[];
  title: string;
  type: 'game';
  short_desc: string;
  short_description: string;
  release: number;
  latest_commit_sha: string;
  commit_url: string;
  download_zip_url: string;
  repo_url: string;
  repo: string;
  provider: string;
  source: 'git';
  sources: ['git'];
  thumbnail: string | null;
  banner: string | null;
  screenshots?: string[];
  tags: string[];
  license: string;
  media_license: string;
  downloads: number;
  contentdb_downloads: number;
  luantihub_downloads: number;
  score: number;
  contentdb_score: number;
  min_minetest_version: string;
  created_at: string;
  updated_at: string;
  approved_at: string;
}

// L1 Isolate Memory Cache for zero-subrequest, zero-Edge-Cache-lookup warm hits
let isolateBrewsCache: { exp: number; data: Jam2026NormalizedPackage[] } | null = null;
let isolateD1SyncedCommits = new Map<string, string>(); // jam_entry_id -> commit

export function resetJam2026IsolateCacheForTests(): void {
  isolateBrewsCache = null;
  isolateD1SyncedCommits.clear();
}

export function isJam2026AllowedImageHost(hostname?: string | null): boolean {
  if (!hostname || typeof hostname !== 'string') return false;
  return JAM_2026_ALLOWED_IMAGE_HOSTS.has(hostname.trim().toLowerCase());
}

export function isJam2026Tag(tag?: string | null): boolean {
  if (!tag || typeof tag !== 'string') return false;
  const lower = tag.trim().toLowerCase();
  return lower === JAM_2026_PRIMARY_TAG || lower === JAM_2026_SECONDARY_TAG || /^jam_game_2026$/i.test(lower);
}

export function isJam2026TagList(tags?: ReadonlyArray<string> | null): boolean {
  if (!Array.isArray(tags) || tags.length === 0) return false;
  return tags.some((t) => isJam2026Tag(t));
}

/**
 * Parses any of the 7 `jam.luanti.org` supported Git hosts (`content/hosts.json`):
 * `github.com`, `gitlab.com`, `codeberg.org`, `git.minetest.land`, `bitbucket.org`, `gitgud.io`, `git.gay`.
 */
export function parseJam2026RepositoryUrl(rawRepoUrl: string): {
  canonicalRepoUrl: string;
  host: string;
  provider: 'github' | 'gitlab' | 'codeberg' | 'mesehub' | 'bitbucket' | 'custom';
  author: string;
  rawRepoName: string;
  safeName: string;
} | null {
  if (!rawRepoUrl || typeof rawRepoUrl !== 'string') return null;
  try {
    const u = new URL(rawRepoUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (isUntrustedTunnelOrPrivateHost(u.toString())) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (isUntrustedTunnelOrPrivateHost(host)) return null;
    const cleanedPath = u.pathname
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+/, '');
    const rawParts = cleanedPath.split('/').filter(Boolean);
    if (rawParts.length < 2) return null;

    const owner = rawParts[0];
    const repoSegments = rawParts.slice(1);
    const stopIdx = repoSegments.findIndex((seg) =>
      ['-', 'tree', 'commit', 'src', 'blob', 'raw', 'archive', 'releases'].includes(seg.toLowerCase())
    );
    const effectiveSegments = stopIdx > 0 ? repoSegments.slice(0, stopIdx) : repoSegments;
    const parts = [owner, ...effectiveSegments];

    const author = parts[0];
    const rawRepoName = parts[parts.length - 1]?.replace(/\.git$/i, '') || '';
    if (!author || !rawRepoName) return null;

    const safeName =
      rawRepoName
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '') || 'jam_game';

    let provider: 'github' | 'gitlab' | 'codeberg' | 'mesehub' | 'bitbucket' | 'custom' = 'custom';
    if (host === 'github.com') {
      provider = 'github';
    } else if (host === 'gitlab.com' || host === 'gitgud.io' || host.includes('gitlab')) {
      provider = 'gitlab';
    } else if (host === 'codeberg.org') {
      provider = 'codeberg';
    } else if (host === 'git.minetest.land' || host.includes('minetest.land')) {
      provider = 'mesehub';
    } else if (host === 'bitbucket.org') {
      provider = 'bitbucket';
    } else {
      provider = 'custom';
    }

    return {
      canonicalRepoUrl: `https://${host}/${parts.join('/')}`,
      host,
      provider,
      author,
      rawRepoName,
      safeName
    };
  } catch {
    return null;
  }
}

export function buildJam2026BrewImageUrl(repository: string, commit: string): string {
  return `${JAM_2026_API_ORIGIN}/api/brews/image?${new URLSearchParams({
    repository: repository.trim(),
    commit: commit.trim().toLowerCase()
  }).toString()}`;
}

export function normalizeJam2026BrewEntry(raw: any): Jam2026NormalizedPackage | null {
  if (!raw || typeof raw !== 'object') return null;
  const legacyId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const repository = typeof raw.repository === 'string' ? raw.repository.trim() : '';
  const commit = typeof raw.commit === 'string' ? raw.commit.trim().toLowerCase() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!repository || !/^[0-9a-f]{7,40}$/.test(commit) || !title) {
    return null;
  }

  const repoInfo = parseJam2026RepositoryUrl(repository);
  if (!repoInfo) return null;
  const jamEntryId = legacyId || repoInfo.canonicalRepoUrl.toLowerCase();

  let downloadZipUrl = `${repoInfo.canonicalRepoUrl}/archive/${commit}.zip`;
  if (repoInfo.host === 'gitlab.com' || repoInfo.host === 'gitgud.io') {
    downloadZipUrl = `${repoInfo.canonicalRepoUrl}/-/archive/${commit}/${repoInfo.rawRepoName}-${commit}.zip`;
  } else if (repoInfo.host === 'bitbucket.org') {
    downloadZipUrl = `${repoInfo.canonicalRepoUrl}/get/${commit}.zip`;
  }

  const publishedIso =
    typeof raw.publishedAt === 'string' && Number.isFinite(Date.parse(raw.publishedAt))
      ? new Date(Date.parse(raw.publishedAt)).toISOString()
      : new Date().toISOString();
  const releaseEpochSec = Math.max(1, Math.floor(Date.parse(publishedIso) / 1000) || 1);

  const hasScreenshot = Boolean(raw.hasScreenshot);
  const rawJamImageUrl = buildJam2026BrewImageUrl(repository, commit);
  const proxiedScreenshotUrl = hasScreenshot
    ? `/api/packages?proxy_image=${encodeURIComponent(rawJamImageUrl)}`
    : null;

  const aliases: string[] = [];
  if (repoInfo.rawRepoName !== repoInfo.safeName) {
    aliases.push(`${repoInfo.author}/${repoInfo.rawRepoName}`);
  }

  const commitUrl =
    typeof raw.commitUrl === 'string' &&
    raw.commitUrl.startsWith('https://') &&
    !isUntrustedTunnelOrPrivateHost(raw.commitUrl)
      ? raw.commitUrl.trim()
      : `${repoInfo.canonicalRepoUrl}/tree/${commit}`;

  return {
    id: `${repoInfo.author}/${repoInfo.safeName}`,
    jam_entry_id: jamEntryId,
    author: repoInfo.author,
    name: repoInfo.safeName,
    ...(aliases.length > 0 ? { aliases } : {}),
    title,
    type: 'game',
    short_desc: description,
    short_description: description,
    release: releaseEpochSec,
    latest_commit_sha: commit,
    commit_url: commitUrl,
    download_zip_url: downloadZipUrl,
    repo_url: repoInfo.canonicalRepoUrl,
    repo: repoInfo.canonicalRepoUrl,
    provider: repoInfo.provider,
    source: 'git',
    sources: ['git'],
    thumbnail: proxiedScreenshotUrl,
    banner: proxiedScreenshotUrl,
    ...(proxiedScreenshotUrl ? { screenshots: [proxiedScreenshotUrl] } : {}),
    tags: [JAM_2026_PRIMARY_TAG, JAM_2026_SECONDARY_TAG, 'git', repoInfo.provider, 'game'],
    license: 'MIT',
    media_license: 'CC-BY-SA-4.0',
    downloads: 0,
    contentdb_downloads: 0,
    luantihub_downloads: 0,
    score: 0,
    contentdb_score: 0,
    min_minetest_version: '5.18.0',
    created_at: publishedIso,
    updated_at: publishedIso,
    approved_at: publishedIso
  };
}

/**
 * Fetches approved Game Jam 2026 submissions from `https://jam.greenxenith.com/api/brews`
 * using 3-tier caching (L1 Isolate Memory -> L2 Cloudflare Edge Cache -> 24h Stale Fallback).
 * Never sends a browser `Origin` header so `jam.greenxenith.com` allows the server-side request.
 */
export async function fetchJam2026BrewsCached(
  noCache = false,
  ttlSeconds = JAM_2026_BREWS_TTL_SECONDS
): Promise<Jam2026NormalizedPackage[]> {
  const now = Date.now();
  if (!noCache && isolateBrewsCache && now < isolateBrewsCache.exp) {
    return isolateBrewsCache.data;
  }

  if (!noCache && ttlSeconds > 0) {
    const cachedEdge = await readEdgeCacheJson<Jam2026NormalizedPackage[]>(JAM_2026_EDGE_CACHE_KEY);
    if (Array.isArray(cachedEdge)) {
      isolateBrewsCache = { exp: now + ttlSeconds * 1000, data: cachedEdge };
      return cachedEdge;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(JAM_2026_BREWS_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
      }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const fallback = await readEdgeCacheJson<Jam2026NormalizedPackage[]>(JAM_2026_FALLBACK_CACHE_KEY);
      return Array.isArray(fallback) ? fallback : [];
    }

    const rawList = await res.json();
    if (!Array.isArray(rawList)) return [];

    const normalized: Jam2026NormalizedPackage[] = [];
    const seenIds = new Set<string>();
    for (const raw of rawList.slice(0, 100)) {
      const pkg = normalizeJam2026BrewEntry(raw);
      if (!pkg) continue;
      const lowerId = pkg.id.toLowerCase();
      if (seenIds.has(lowerId)) continue;
      seenIds.add(lowerId);
      normalized.push(pkg);
    }

    isolateBrewsCache = { exp: Date.now() + ttlSeconds * 1000, data: normalized };
    await Promise.all([
      writeEdgeCacheJson(JAM_2026_EDGE_CACHE_KEY, normalized, ttlSeconds),
      writeEdgeCacheJson(JAM_2026_FALLBACK_CACHE_KEY, normalized, 86400)
    ]).catch(() => {});

    return normalized;
  } catch {
    clearTimeout(timeoutId);
    const fallback = await readEdgeCacheJson<Jam2026NormalizedPackage[]>(JAM_2026_FALLBACK_CACHE_KEY).catch(() => null);
    return Array.isArray(fallback) ? fallback : [];
  }
}

/**
 * Syncs `jam.luanti.org` approved brews into `syncActivePromotionRowPackages` and deduplicates D1 writes
 * using an `id:commit` digest so unchanged brew lists execute 0 D1 reads and 0 D1 writes.
 */
export async function syncJam2026IntoPromoRowDelta(params: {
  uniqueTags: string[];
  addTagStamp: (lowerPkgId: string, tag: string) => void;
  discoveredByKey: Map<string, any>;
  existingD1Pairs: Set<string>;
  queuedUpsertKeys: Set<string>;
  d1UpsertPairs: Array<{ tag: string; pkgId: string }>;
  db?: any;
  noCache?: boolean;
  upstreamCatalog?: any[];
}): Promise<Record<string, string[]> | undefined> {
  const {
    uniqueTags,
    addTagStamp,
    discoveredByKey,
    existingD1Pairs,
    queuedUpsertKeys,
    d1UpsertPairs,
    db,
    noCache = false,
    upstreamCatalog
  } = params;

  if (!isJam2026TagList(uniqueTags)) {
    return undefined;
  }

  const brews = await fetchJam2026BrewsCached(noCache);
  if (!Array.isArray(brews) || brews.length === 0) {
    return undefined;
  }

  const repoTagMap: Record<string, string[]> = {};
  const jamTagsToStamp = Array.from(
    new Set([
      ...JAM_2026_TAGS,
      ...uniqueTags.filter((t) => isJam2026Tag(t))
    ])
  );

  for (const brew of brews) {
    const lowerId = brew.id.toLowerCase();
    for (const tag of jamTagsToStamp) {
      addTagStamp(lowerId, tag);
      const pairKey = `${tag.toLowerCase()}::${lowerId}`;
      if (!existingD1Pairs.has(pairKey) && !queuedUpsertKeys.has(pairKey)) {
        queuedUpsertKeys.add(pairKey);
        d1UpsertPairs.push({ tag, pkgId: brew.id });
      }
    }

    const rKey = normalizeRepoKey(brew.repo_url);
    if (rKey) {
      repoTagMap[rKey] = jamTagsToStamp;
    }

    if (!discoveredByKey.has(lowerId)) {
      discoveredByKey.set(lowerId, brew);
    }
  }

  // Cross-author ContentDB canonical resolution (e.g. Git owner `sztest/confspace` -> ContentDB `Warr1024/confspace`):
  // Bulk ContentDB `/packages/?fmt=vcs` omits `repo`, so when a Jam 2026 game is published on ContentDB under a different
  // username with the same technical `name`, verify its ContentDB `detail.repo` (1h Edge-cached) and stamp the canonical ID.
  await Promise.all(
    brews.slice(0, 30).map(async (brew) => {
      const rKey = normalizeRepoKey(brew.repo_url);
      if (!rKey) return;
      const lowerBrewName = brew.name.toLowerCase();
      const lowerBrewAuthor = brew.author.toLowerCase();

      let candidates: any[] = [];
      if (Array.isArray(upstreamCatalog) && upstreamCatalog.length > 0) {
        candidates = upstreamCatalog.filter(
          (c) =>
            c &&
            String(c.type || 'mod').toLowerCase() === 'game' &&
            String(c.name || '').toLowerCase() === lowerBrewName &&
            String(c.author || '').toLowerCase() !== lowerBrewAuthor
        );
      } else {
        const searchList = await fetchUpstreamJsonCached<any[]>(
          `/packages/?q=${encodeURIComponent(brew.name)}&type=game&fmt=vcs`,
          1800
        ).catch(() => null);
        if (Array.isArray(searchList)) {
          candidates = searchList.filter(
            (c) =>
              c &&
              String(c.type || 'mod').toLowerCase() === 'game' &&
              String(c.name || '').toLowerCase() === lowerBrewName &&
              String(c.author || '').toLowerCase() !== lowerBrewAuthor
          );
        }
      }

      for (const cand of candidates.slice(0, 2)) {
        const detail = await fetchUpstreamJsonCached<any>(
          `/packages/${encodeURIComponent(cand.author)}/${encodeURIComponent(cand.name)}/`,
          3600
        ).catch(() => null);
        const detailRepoKey = normalizeRepoKey(detail?.repo || detail?.repo_url || cand.repo_url || cand.repo);
        if (detailRepoKey && detailRepoKey === rKey) {
          const canonicalId = `${detail?.author || cand.author}/${detail?.name || cand.name}`;
          const canonicalLowerId = canonicalId.toLowerCase();
          for (const tag of jamTagsToStamp) {
            addTagStamp(canonicalLowerId, tag);
            const pairKey = `${tag.toLowerCase()}::${canonicalLowerId}`;
            if (!existingD1Pairs.has(pairKey) && !queuedUpsertKeys.has(pairKey)) {
              queuedUpsertKeys.add(pairKey);
              d1UpsertPairs.push({ tag, pkgId: canonicalId });
            }
          }
        }
      }
    })
  );

  // Quota-Optimized D1 Package Persistence:
  // Only write to D1 `packages` for jam entries whose `jam_entry_id:latest_commit_sha` has not been synced yet.
  if (db) {
    try {
      const persistedDigestMap =
        (await readEdgeCacheJson<Record<string, string>>(JAM_2026_D1_DIGEST_CACHE_KEY).catch(() => null)) || {};
      const unsyncedBrews = brews.filter((b) => {
        const memCommit = isolateD1SyncedCommits.get(b.jam_entry_id);
        const edgeCommit = persistedDigestMap[b.jam_entry_id];
        return memCommit !== b.latest_commit_sha && edgeCommit !== b.latest_commit_sha;
      });

      if (unsyncedBrews.length > 0) {
        const stmts: any[] = [];
        for (const b of unsyncedBrews.slice(0, 40)) {
          // 1. Upsert package into D1 `packages` only if no other D1 package with a different `id` already owns `b.repo_url`
          stmts.push(
            db
              .prepare(`
                INSERT INTO packages (
                  id, author_id, author_name, name, title, type, short_desc, long_desc,
                  repo_url, provider, default_branch, thumbnail_url, banner_url, screenshots,
                  license, media_license, tags, min_minetest_version, latest_commit_sha,
                  status, created_at, updated_at
                )
                SELECT ?, ?, ?, ?, ?, 'game', ?, ?, ?, ?, 'main', ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?
                WHERE NOT EXISTS (
                  SELECT 1 FROM packages p2
                  WHERE LOWER(p2.repo_url) = LOWER(?) AND LOWER(p2.id) != LOWER(?)
                )
                ON CONFLICT(id) DO UPDATE SET
                  title = CASE WHEN packages.author_id LIKE 'ext_jam2026_%' THEN excluded.title ELSE packages.title END,
                  short_desc = CASE WHEN packages.author_id LIKE 'ext_jam2026_%' THEN excluded.short_desc ELSE COALESCE(packages.short_desc, excluded.short_desc) END,
                  repo_url = COALESCE(NULLIF(packages.repo_url, ''), excluded.repo_url),
                  thumbnail_url = CASE
                    WHEN packages.thumbnail_url LIKE '%jam.greenxenith.com%' OR packages.thumbnail_url LIKE '%/api/brews/%' THEN excluded.thumbnail_url
                    WHEN packages.author_id LIKE 'ext_jam2026_%' THEN COALESCE(excluded.thumbnail_url, NULLIF(packages.thumbnail_url, ''))
                    ELSE COALESCE(NULLIF(packages.thumbnail_url, ''), excluded.thumbnail_url)
                  END,
                  banner_url = CASE
                    WHEN packages.banner_url LIKE '%jam.greenxenith.com%' OR packages.banner_url LIKE '%/api/brews/%' THEN excluded.banner_url
                    WHEN packages.author_id LIKE 'ext_jam2026_%' THEN COALESCE(excluded.banner_url, NULLIF(packages.banner_url, ''))
                    ELSE COALESCE(NULLIF(packages.banner_url, ''), excluded.banner_url)
                  END,
                  screenshots = CASE
                    WHEN packages.screenshots LIKE '%jam.greenxenith.com%' OR packages.screenshots LIKE '%/api/brews/%' THEN excluded.screenshots
                    WHEN packages.author_id LIKE 'ext_jam2026_%' THEN COALESCE(excluded.screenshots, NULLIF(packages.screenshots, ''))
                    ELSE COALESCE(NULLIF(packages.screenshots, ''), excluded.screenshots)
                  END,
                  latest_commit_sha = excluded.latest_commit_sha,
                  tags = CASE
                    WHEN packages.tags IS NULL OR packages.tags = '' OR packages.tags = '[]' THEN excluded.tags
                    WHEN INSTR(LOWER(packages.tags), 'jam_game_2026') = 0 THEN json_insert(packages.tags, '$[#]', 'jam_game_2026', '$[#]', 'gamejam')
                    ELSE packages.tags
                  END,
                  updated_at = excluded.updated_at
              `)
              .bind(
                b.id,
                `ext_jam2026_${b.author.toLowerCase()}`,
                b.author,
                b.name,
                b.title,
                b.short_desc,
                b.short_desc,
                b.repo_url,
                b.provider,
                b.thumbnail,
                b.banner,
                b.screenshots ? JSON.stringify(b.screenshots) : null,
                b.license,
                b.media_license,
                JSON.stringify(b.tags),
                b.min_minetest_version,
                b.latest_commit_sha,
                b.created_at,
                b.updated_at,
                b.repo_url,
                b.id
              )
          );

          // 2. Ensure any existing D1 package matching either `b.id` (case-insensitively) or `b.repo_url` has `jam_game_2026` & `gamejam` stamped onto it
          stmts.push(
            db
              .prepare(`
                UPDATE packages
                SET tags = CASE
                  WHEN tags IS NULL OR tags = '' OR tags = '[]' THEN '["jam_game_2026","gamejam"]'
                  WHEN INSTR(LOWER(tags), 'jam_game_2026') = 0 THEN json_insert(tags, '$[#]', 'jam_game_2026', '$[#]', 'gamejam')
                  ELSE tags
                END
                WHERE (LOWER(id) = LOWER(?) OR LOWER(repo_url) = LOWER(?))
                  AND INSTR(LOWER(COALESCE(tags, '')), 'jam_game_2026') = 0
              `)
              .bind(b.id, b.repo_url)
          );

          // 3. Ensure pure-Git `ext_jam2026_` package has its pinned commit release in D1 `releases` for 1-click `.zip` downloads
          const shortSha = b.latest_commit_sha.slice(0, 7);
          stmts.push(
            db
              .prepare(`
                DELETE FROM releases
                WHERE LOWER(package_id) = LOWER(?)
                  AND EXISTS (
                    SELECT 1 FROM packages p WHERE LOWER(p.id) = LOWER(?) AND p.author_id LIKE 'ext_jam2026_%'
                  )
              `)
              .bind(b.id, b.id),
            db
              .prepare(`
                INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, released_at)
                SELECT ?, ?, ?, ?, ?, ?, ?
                WHERE EXISTS (
                  SELECT 1 FROM packages p WHERE LOWER(p.id) = LOWER(?) AND p.author_id LIKE 'ext_jam2026_%'
                )
              `)
              .bind(
                b.id,
                shortSha,
                shortSha,
                b.latest_commit_sha,
                b.download_zip_url,
                b.min_minetest_version,
                b.created_at,
                b.id
              )
          );
        }

        const runBatch = async () => {
          if (typeof db.batch === 'function') {
            await db.batch(stmts);
          } else {
            for (const s of stmts) {
              await s.run();
            }
          }
        };

        try {
          await runBatch();
        } catch (err: any) {
          if (/no such table|no such column/i.test(String(err?.message || ''))) {
            await ensureExtendedPackageColumns(db);
            await ensurePromotionAndTagTables(db, true);
            await runBatch().catch(() => {});
          }
        }

        const nextDigestMap: Record<string, string> = { ...persistedDigestMap };
        const cacheKeysToInvalidate: string[] = [];
        for (const b of unsyncedBrews) {
          nextDigestMap[b.jam_entry_id] = b.latest_commit_sha;
          isolateD1SyncedCommits.set(b.jam_entry_id, b.latest_commit_sha);
          const lowerId = b.id.toLowerCase();
          cacheKeysToInvalidate.push(
            ...buildPackageCacheInvalidationKeys(b.author, b.name, { includeBootCatalog: true }),
            `/__api_hydrate_v9_${lowerId}`,
            `/__api_hydrate_v10_${lowerId}`,
            `/__api_hydrate_v11_${lowerId}`
          );
        }
        await Promise.all([
          writeEdgeCacheJson(JAM_2026_D1_DIGEST_CACHE_KEY, nextDigestMap, 86400).catch(() => {}),
          invalidateEdgeCacheKeys(cacheKeysToInvalidate).catch(() => {})
        ]);
      }
    } catch {
      // Non-fatal D1 sync error; Edge PromoRowDelta still serves all jam entries
    }
  }

  return Object.keys(repoTagMap).length > 0 ? repoTagMap : undefined;
}

/**
 * Matches existing catalog items against `jam.luanti.org` repositories by normalized `repo_url` (`repoTagMap`):
 * - Stamps `jam_game_2026` and `gamejam` onto existing ContentDB/D1 packages sharing the same Git repo URL
 *   (even if their ContentDB author/name differs or they forgot to tag `jam_game_2026` on ContentDB).
 * - Returns the set of matched `normalizeRepoKey` strings so `overlayPromotionRowDeltaOnCatalog` skips
 *   appending a duplicate card for any repository already present in the catalog.
 */
export function applyJam2026RepoOverlayOnCatalog(
  packagesList: any[],
  repoTagMap?: Record<string, string[]> | null,
  discoveredItems?: any[] | null
): { packages: any[]; matchedRepoKeys: Set<string> } {
  const matchedRepoKeys = new Set<string>();
  if (!Array.isArray(packagesList) || !repoTagMap || Object.keys(repoTagMap).length === 0) {
    return { packages: packagesList, matchedRepoKeys };
  }

  const normalizeText = (val: any): string =>
    typeof val === 'string' ? val.trim().replace(/\s+/g, ' ').toLowerCase() : '';

  const discoveredJamByLowerName = new Map<string, any[]>();
  const discoveredJamByRepoKey = new Map<string, any>();
  if (Array.isArray(discoveredItems)) {
    for (const d of discoveredItems) {
      if (!d || String(d.type || '').toLowerCase() !== 'game') continue;
      const dRepoKey = normalizeRepoKey(d.repo_url || d.repo);
      if (!dRepoKey || !repoTagMap[dRepoKey]) continue;
      if (!discoveredJamByRepoKey.has(dRepoKey)) {
        discoveredJamByRepoKey.set(dRepoKey, d);
      }
      const dName = normalizeText(d.name);
      if (!dName) continue;
      const bucket = discoveredJamByLowerName.get(dName);
      if (bucket) {
        bucket.push(d);
      } else {
        discoveredJamByLowerName.set(dName, [d]);
      }
    }
  }

  let clonedList: any[] | null = null;
  for (let i = 0; i < packagesList.length; i++) {
    const pkg = packagesList[i];
    if (!pkg) continue;
    let rKey = normalizeRepoKey(pkg?.repo_url || pkg?.repo);
    let matchedDiscoveredRepoUrl: string | undefined;

    // Fallback for unhydrated ContentDB games whose author handle differs from their Git namespace (e.g. Warr1024/confspace vs sztest/confspace)
    if (!rKey && String(pkg.type || '').toLowerCase() === 'game' && discoveredJamByLowerName.size > 0) {
      const lowerPkgName = normalizeText(pkg.name);
      const jamCandidates = lowerPkgName ? discoveredJamByLowerName.get(lowerPkgName) : undefined;
      if (jamCandidates && jamCandidates.length > 0) {
        const normPkgTitle = normalizeText(pkg.title);
        const normPkgDesc = normalizeText(pkg.short_desc || pkg.short_description);
        const matchedDisc = jamCandidates.find((d) => {
          const normDiscTitle = normalizeText(d.title);
          const normDiscDesc = normalizeText(d.short_desc || d.short_description);
          const titleMatches =
            normPkgTitle.length > 0 &&
            normPkgTitle !== lowerPkgName &&
            normPkgTitle === normDiscTitle;
          const descMatches = normPkgDesc.length >= 15 && normPkgDesc === normDiscDesc;
          return titleMatches || descMatches;
        });
        if (matchedDisc) {
          rKey = normalizeRepoKey(matchedDisc.repo_url || matchedDisc.repo);
          matchedDiscoveredRepoUrl = matchedDisc.repo_url || matchedDisc.repo;
        }
      }
    }

    if (!rKey) continue;
    const tagsToAdd = repoTagMap[rKey];
    if (!Array.isArray(tagsToAdd) || tagsToAdd.length === 0) continue;

    matchedRepoKeys.add(rKey);
    const existingTags: string[] = Array.isArray(pkg.tags) ? pkg.tags : [];
    let nextTags: string[] | null = null;
    for (const t of tagsToAdd) {
      if (t && !existingTags.some((ct) => String(ct).toLowerCase() === t.toLowerCase())) {
        if (!nextTags) nextTags = [...existingTags];
        if (!nextTags.some((ct) => String(ct).toLowerCase() === t.toLowerCase())) {
          nextTags.push(t);
        }
      }
    }

    const existingBadgeTags: string[] = Array.isArray(pkg.badge_tags) ? pkg.badge_tags : [];
    const needsJamBadge = !existingBadgeTags.some(
      (bt) => String(bt).toLowerCase() === JAM_2026_PRIMARY_TAG
    );
    const nextBadgeTags = needsJamBadge
      ? [...existingBadgeTags, JAM_2026_PRIMARY_TAG]
      : existingBadgeTags;

    const baseSources: string[] = Array.isArray(pkg.sources) && pkg.sources.length > 0
      ? pkg.sources
      : [pkg.source || 'official'];
    const needsGitSource = !baseSources.includes('git');
    const nextSources = needsGitSource ? [...baseSources, 'git'] : baseSources;

    const needsRepoBackfill = Boolean(!pkg.repo_url && matchedDiscoveredRepoUrl);

    const matchedJamBrew = discoveredJamByRepoKey.get(rKey);
    const currentThumbStr = String(pkg.thumbnail || '');
    const currentBannerStr = String(pkg.banner || '');
    const stripBypass = (u: string) => u.replace(/&ngsw-bypass=true\b/g, '');
    const hasJamHostedImage =
      currentThumbStr.includes('jam.greenxenith.com') || currentBannerStr.includes('jam.greenxenith.com');
    const rawNextJamShot =
      matchedJamBrew && typeof matchedJamBrew.thumbnail === 'string' && matchedJamBrew.thumbnail
        ? matchedJamBrew.thumbnail
        : null;
    const nextJamShot =
      rawNextJamShot && rawNextJamShot.startsWith('/api/packages?proxy_image=') && !rawNextJamShot.includes('ngsw-bypass=true')
        ? `${rawNextJamShot}&ngsw-bypass=true`
        : rawNextJamShot;
    const needsJamScreenshotRefresh = Boolean(
      matchedJamBrew &&
        ((hasJamHostedImage && stripBypass(currentThumbStr) !== stripBypass(nextJamShot || '')) ||
          ((!currentThumbStr || currentThumbStr === 'logo.svg') && nextJamShot))
    );
    const needsJamCommitRefresh = Boolean(
      matchedJamBrew?.latest_commit_sha &&
        pkg.latest_commit_sha &&
        pkg.latest_commit_sha !== matchedJamBrew.latest_commit_sha
    );

    if (
      nextTags ||
      needsJamBadge ||
      needsGitSource ||
      needsRepoBackfill ||
      needsJamScreenshotRefresh ||
      needsJamCommitRefresh
    ) {
      if (!clonedList) clonedList = [...packagesList];
      clonedList[i] = {
        ...pkg,
        ...(nextTags ? { tags: nextTags } : {}),
        ...(needsJamBadge ? { badge_tags: nextBadgeTags } : {}),
        ...(needsGitSource ? { sources: nextSources } : {}),
        ...(needsRepoBackfill ? { repo_url: matchedDiscoveredRepoUrl } : {}),
        ...(needsJamScreenshotRefresh
          ? {
              thumbnail: nextJamShot,
              banner: nextJamShot,
              screenshots: nextJamShot ? [nextJamShot] : undefined
            }
          : {}),
        ...(needsJamCommitRefresh ? { latest_commit_sha: matchedJamBrew.latest_commit_sha } : {})
      };
    }
  }

  return {
    packages: clonedList || packagesList,
    matchedRepoKeys
  };
}

/**
 * Pure in-memory helper (0 subrequests) that checks if a repository's root directory listing
 * contains `JAM2026.md` (the required participation file in `luanti-org/jam.luanti.org/content/jam.json`).
 */
export function detectJam2026RootParticipationTags(
  rootEntries?: ReadonlyArray<string | { name: string; type?: string }> | null
): string[] {
  if (!Array.isArray(rootEntries) || rootEntries.length === 0) return [];
  const hasJam2026File = rootEntries.some((entry) => {
    const rawName = typeof entry === 'string' ? entry : entry?.name;
    return typeof rawName === 'string' && /^jam2026\.md$/i.test(rawName.trim());
  });
  return hasJam2026File ? [JAM_2026_PRIMARY_TAG, JAM_2026_SECONDARY_TAG] : [];
}

/**
 * Resolves a verified Game Jam 2026 package entry for `author/name` (or normalized underscore/hyphen alias)
 * from the cached `jam.greenxenith.com` brew list.
 */
export async function findJam2026BrewBySlug(
  author: string,
  name: string
): Promise<Jam2026NormalizedPackage | undefined> {
  if (!author || !name) return undefined;
  const targetSlug = `${author}/${name}`.toLowerCase();
  const targetAuthorLower = author.toLowerCase();
  const targetNormName = name.toLowerCase().replace(/-/g, '_');
  const brews = await fetchJam2026BrewsCached(false);
  for (const brew of brews) {
    if (brew.id.toLowerCase() === targetSlug) {
      return brew;
    }
    if (brew.aliases?.some((alias) => alias.toLowerCase() === targetSlug)) {
      return brew;
    }
    if (
      brew.author.toLowerCase() === targetAuthorLower &&
      brew.name.toLowerCase().replace(/-/g, '_') === targetNormName
    ) {
      return brew;
    }
  }
  return undefined;
}

/**
 * Resolves a verified Game Jam 2026 repository URL for `author/name` (or normalized underscore/hyphen alias)
 * from the cached `jam.greenxenith.com` brew list.
 */
export async function findJam2026BrewRepoBySlug(
  author: string,
  name: string
): Promise<string | undefined> {
  const brew = await findJam2026BrewBySlug(author, name);
  return brew?.repo_url;
}

/**
 * Provides an isolated synthetic D1 package + pinned-commit release fallback for `GET /api/packages/[author]/[name]`
 * when a Game Jam 2026 entry is opened before D1 persistence has run.
 */
export async function resolveJam2026SyntheticD1Detail(
  author: string,
  name: string,
  d1Pkg: any,
  bundledReleases: any[]
): Promise<{ d1Pkg: any; bundledReleases: any[] }> {
  if (d1Pkg?.repo_url) {
    return { d1Pkg, bundledReleases };
  }
  const brew = await findJam2026BrewBySlug(author, name).catch(() => undefined);
  if (!brew) {
    return { d1Pkg, bundledReleases };
  }

  const syntheticPkg = {
    id: brew.id,
    author_id: `ext_jam2026_${brew.author.toLowerCase()}`,
    author_name: brew.author,
    name: brew.name,
    title: brew.title,
    type: 'game',
    short_desc: brew.short_desc,
    long_desc: brew.short_desc,
    repo_url: brew.repo_url,
    provider: brew.provider,
    default_branch: 'main',
    thumbnail_url: brew.thumbnail,
    banner_url: brew.banner,
    screenshots: brew.screenshots ? JSON.stringify(brew.screenshots) : null,
    license: brew.license,
    media_license: brew.media_license,
    tags: JSON.stringify(brew.tags),
    badge_tags: JSON.stringify([JAM_2026_PRIMARY_TAG]),
    min_minetest_version: brew.min_minetest_version,
    latest_commit_sha: brew.latest_commit_sha,
    status: 'active',
    created_at: brew.created_at,
    updated_at: brew.updated_at,
    ...(d1Pkg || {})
  };

  const shortSha = brew.latest_commit_sha.slice(0, 7);
  const nextReleases =
    Array.isArray(bundledReleases) && bundledReleases.length > 0
      ? bundledReleases
      : [
          {
            id: `jam2026-${shortSha}`,
            version: shortSha,
            title: `Jam Submission (${shortSha})`,
            tag_name: shortSha,
            commit_sha: brew.latest_commit_sha,
            url: brew.download_zip_url,
            download_url: brew.download_zip_url,
            min_minetest_version: brew.min_minetest_version,
            changelog: undefined,
            released_at: brew.created_at
          }
        ];

  return {
    d1Pkg: syntheticPkg,
    bundledReleases: nextReleases
  };
}

/**
 * Fallback README loader that fetches `JAM2026.md` from a Game Jam repository when `README.md` is absent.
 */
export async function fetchJam2026FallbackReadme(repoUrl?: string | null): Promise<string | undefined> {
  const parsed = repoUrl ? parseJam2026RepositoryUrl(repoUrl) : null;
  if (!parsed) return undefined;

  const { host, author, rawRepoName, canonicalRepoUrl } = parsed;
  const candidates: Array<{ url: string; rawBase: string }> = [];

  if (host === 'github.com') {
    const rawBase = `https://raw.githubusercontent.com/${author}/${rawRepoName}/HEAD`;
    candidates.push(
      { url: `${rawBase}/JAM2026.md`, rawBase },
      { url: `${rawBase}/jam2026.md`, rawBase }
    );
  } else if (host === 'gitlab.com' || host === 'gitgud.io' || host.includes('gitlab')) {
    const repoPath = new URL(canonicalRepoUrl).pathname.replace(/^\/+|\/+$/g, '');
    const rawBase = `https://${host}/${repoPath}/-/raw/HEAD`;
    candidates.push(
      { url: `${rawBase}/JAM2026.md`, rawBase },
      { url: `${rawBase}/jam2026.md`, rawBase }
    );
  } else if (host === 'bitbucket.org') {
    const rawBase = `https://bitbucket.org/${author.toLowerCase()}/${rawRepoName.toLowerCase()}/raw/HEAD`;
    candidates.push(
      { url: `${rawBase}/JAM2026.md`, rawBase },
      { url: `${rawBase}/jam2026.md`, rawBase }
    );
  } else {
    // Codeberg, MeseHub (git.minetest.land), git.gay, Gitea/Forgejo
    const apiBase = `https://${host}/api/v1/repos/${author}/${rawRepoName}/raw`;
    candidates.push(
      { url: `${apiBase}/JAM2026.md`, rawBase: apiBase },
      { url: `${apiBase}/jam2026.md`, rawBase: apiBase }
    );
  }

  for (const cand of candidates) {
    try {
      const res = await fetchWithAnubisSupport(cand.url, {
        headers: {
          Accept: 'text/plain, text/markdown, */*;q=0.8',
          'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
        }
      });
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') || ct.includes('application/json')) continue;
      const text = (await res.text()).trim();
      if (text && !/^<!doctype html/i.test(text)) {
        return rewriteRelativeMarkdownUrls(text, cand.rawBase);
      }
    } catch {
      // Try next candidate
    }
  }
  return undefined;
}

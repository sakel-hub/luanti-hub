/**
 * TEMPORARY LUANTI GAME JAM 2026 CLIENT SYNC HELPER
 *
 * Standalone client-side helper for `PackageService` that syncs submissions from
 * `/api/jam-2026` (which proxies `https://jam.greenxenith.com/api/brews`) whenever
 * Promotional Package Row #1 filters by `jam_game_2026` or `gamejam` and the local
 * catalog does not yet have those entries stamped.
 *
 * Safe to delete after the 2026 Game Jam concludes.
 */

import { WritableSignal } from '@angular/core';
import { LuantiPackage } from '../models/package.model';
import { detectGitProviderFromUrl, normalizeRepoComparisonKey } from '../config/git-providers.config';

export interface Jam2026ClientBrewEntry {
  id: string;
  repository: string;
  commit: string;
  title: string;
  description: string;
  commitUrl: string;
  hasScreenshot: boolean;
  publishedAt: string | null;
}

const JAM_2026_ROW_TAGS = new Set(['jam_game_2026', 'gamejam']);

export function isJam2026PromoTag(tag: string | undefined | null): boolean {
  return JAM_2026_ROW_TAGS.has(String(tag || '').trim().toLowerCase());
}

/**
 * Converts a `jam.luanti.org` brew entry (or already-normalized `/api/jam-2026` item) into a raw
 * package payload compatible with `PackageService.normalizePackage()`.
 */
export function convertJam2026BrewToRawPackage(
  entry: Jam2026ClientBrewEntry | Record<string, any>
): Record<string, any> | null {
  if (!entry || typeof entry !== 'object') return null;

  // If the `/api/jam-2026` Edge endpoint already returned a normalized `Jam2026NormalizedPackage`, preserve it directly
  if (typeof (entry as any).author === 'string' && typeof (entry as any).name === 'string' && typeof (entry as any).repo_url === 'string') {
    return entry as Record<string, any>;
  }

  if (typeof entry.repository !== 'string') return null;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(entry.repository.trim().replace(/\.git$/i, '').replace(/\/+$/, ''));
  } catch {
    return null;
  }

  const parts = parsedUrl.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repoSegments = parts.slice(1);
  const stopIdx = repoSegments.findIndex((seg) =>
    ['-', 'tree', 'commit', 'src', 'blob', 'raw', 'archive', 'releases'].includes(seg.toLowerCase())
  );
  const effectiveSegments = stopIdx > 0 ? repoSegments.slice(0, stopIdx) : repoSegments;
  const repoName = effectiveSegments[effectiveSegments.length - 1]?.replace(/\.git$/i, '') || parts[1];
  const safeName =
    repoName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'jam_game';
  const repoPath = `${owner}/${effectiveSegments.join('/')}`;
  const cleanRepoUrl = `https://${parsedUrl.hostname.toLowerCase()}/${repoPath}`;

  const canonicalId = `${owner}/${safeName}`;
  const commit = String(entry.commit || 'HEAD').trim();
  const detected = detectGitProviderFromUrl(cleanRepoUrl);
  const provider =
    (typeof detected === 'string' ? detected : detected?.provider) || 'github';
  const host = parsedUrl.hostname.toLowerCase();

  let downloadZipUrl = `${cleanRepoUrl}/archive/${commit}.zip`;
  if (host === 'gitlab.com' || host === 'gitgud.io') {
    downloadZipUrl = `${cleanRepoUrl}/-/archive/${commit}/${repoName}-${commit}.zip`;
  } else if (host === 'bitbucket.org') {
    downloadZipUrl = `${cleanRepoUrl}/get/${commit}.zip`;
  }

  const rawScreenshotUrl = entry.hasScreenshot
    ? `https://jam.greenxenith.com/api/brews/${encodeURIComponent(entry.id)}/images/${encodeURIComponent(commit)}`
    : null;
  const proxiedScreenshot = rawScreenshotUrl
    ? `/api/packages?proxy_image=${encodeURIComponent(rawScreenshotUrl)}`
    : null;

  const publishedIso = entry.publishedAt
    ? new Date(entry.publishedAt).toISOString()
    : new Date().toISOString();
  const releaseEpochSec = Math.max(1, Math.floor((Date.parse(publishedIso) || Date.now()) / 1000));

  return {
    id: canonicalId,
    author: owner,
    name: safeName,
    title: String(entry.title || repoName).trim() || safeName,
    type: 'game',
    short_desc: String(entry.description || '').trim(),
    short_description: String(entry.description || '').trim(),
    repo_url: cleanRepoUrl,
    repo: cleanRepoUrl,
    default_branch: commit,
    download_zip_url: downloadZipUrl,
    thumbnail: proxiedScreenshot,
    banner: proxiedScreenshot,
    screenshots: proxiedScreenshot ? [proxiedScreenshot] : [],
    tags: ['jam_game_2026', 'gamejam', 'game', 'git', provider],
    badge_tags: ['jam_game_2026'],
    provider,
    source: 'git',
    sources: ['git'],
    release: releaseEpochSec,
    created_at: publishedIso,
    updated_at: publishedIso,
    approved_at: publishedIso
  };
}

let cachedJam2026RawPackages: { ts: number; items: Record<string, any>[] } | null = null;
const JAM_2026_CLIENT_CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * Syncs `jam.luanti.org` submissions into the client catalog when Promotional Package Row #1
 * uses `jam_game_2026` or `gamejam`.
 */
export async function syncJam2026ClientRowTagIfNeeded(options: {
  tag: string;
  packagesSignal: WritableSignal<LuantiPackage[]>;
  normalizePackage: (raw: any) => LuantiPackage;
  deduplicateCatalog: (pkgs: LuantiPackage[]) => LuantiPackage[];
  buildSearchBlob: (pkg: Partial<LuantiPackage>) => string;
  onPackageStamped?: (lowerId: string, tags: string[], badgeTags: string[]) => void;
  fetchJson?: (url: string) => Promise<any>;
}): Promise<void> {
  const {
    tag,
    packagesSignal,
    normalizePackage,
    deduplicateCatalog,
    buildSearchBlob,
    onPackageStamped,
    fetchJson
  } = options;
  if (!isJam2026PromoTag(tag)) return;

  try {
    const isCustomFetcher = Boolean(fetchJson);
    const now = Date.now();
    let rawPackages: Record<string, any>[] = [];

    if (
      !isCustomFetcher &&
      cachedJam2026RawPackages &&
      now - cachedJam2026RawPackages.ts < JAM_2026_CLIENT_CACHE_TTL_MS &&
      cachedJam2026RawPackages.items.length > 0
    ) {
      rawPackages = cachedJam2026RawPackages.items;
    } else {
      const fetcher =
        fetchJson ||
        (async (url: string) => {
          const bypassUrl = url.includes('?') ? `${url}&ngsw-bypass=true` : `${url}?ngsw-bypass=true`;
          const res = await fetch(bypassUrl, {
            cache: 'no-cache',
            headers: {
              Accept: 'application/json',
              'ngsw-bypass': 'true'
            }
          });
          if (!res.ok) return null;
          return res.json();
        });

      const data = await fetcher('/api/jam-2026');
      const brews: Jam2026ClientBrewEntry[] = Array.isArray(data?.brews)
        ? data.brews
        : Array.isArray(data)
          ? data
          : [];
      if (brews.length === 0) return;

      rawPackages = brews
        .map((b) => convertJam2026BrewToRawPackage(b))
        .filter((p): p is Record<string, any> => Boolean(p));
      if (rawPackages.length === 0) return;

      if (!isCustomFetcher) {
        cachedJam2026RawPackages = { ts: now, items: rawPackages };
      }
    }

    const jamTagsToStamp = ['jam_game_2026', 'gamejam', tag];
    const matchedLowerIds = new Set<string>();
    const matchedRepoKeys = new Set<string>();

    for (const raw of rawPackages) {
      matchedLowerIds.add(String(raw['id']).toLowerCase());
      const rk = normalizeRepoComparisonKey(raw['repo_url']);
      if (rk) matchedRepoKeys.add(rk);
    }

    const stampedPackages: Array<{ lowerId: string; tags: string[]; badgeTags: string[] }> = [];

    packagesSignal.update((currentPkgs) => {
      const existingLowerIds = new Set<string>();
      const existingRepoKeys = new Set<string>();

      const updated = currentPkgs.map((pkg) => {
        const lowerId = pkg.id.toLowerCase();
        const repoKey = normalizeRepoComparisonKey(pkg.repo_url);
        existingLowerIds.add(lowerId);
        if (repoKey) existingRepoKeys.add(repoKey);

        const isMatched =
          matchedLowerIds.has(lowerId) || Boolean(repoKey && matchedRepoKeys.has(repoKey));
        if (!isMatched) return pkg;

        const existingTags = pkg.tags || [];
        const nextTags = [...existingTags];
        let changed = false;
        for (const jt of jamTagsToStamp) {
          if (jt && !nextTags.some((t) => t.toLowerCase() === jt.toLowerCase())) {
            nextTags.push(jt);
            changed = true;
          }
        }
        const existingBadgeTags = pkg.badge_tags || [];
        const nextBadgeTags = [...existingBadgeTags];
        if (!nextBadgeTags.some((bt) => bt.toLowerCase() === 'jam_game_2026')) {
          nextBadgeTags.push('jam_game_2026');
          changed = true;
        }
        stampedPackages.push({ lowerId, tags: nextTags, badgeTags: nextBadgeTags });
        if (!changed) return pkg;

        return {
          ...pkg,
          tags: nextTags,
          badge_tags: nextBadgeTags,
          _searchBlob: buildSearchBlob({ ...pkg, tags: nextTags, badge_tags: nextBadgeTags })
        };
      });

      const newNormalized: LuantiPackage[] = [];
      for (const raw of rawPackages) {
        const lowerId = String(raw['id']).toLowerCase();
        const repoKey = normalizeRepoComparisonKey(raw['repo_url']);
        if (existingLowerIds.has(lowerId) || (repoKey && existingRepoKeys.has(repoKey))) {
          continue;
        }
        existingLowerIds.add(lowerId);
        if (repoKey) existingRepoKeys.add(repoKey);
        const norm = normalizePackage(raw);
        stampedPackages.push({
          lowerId: norm.id.toLowerCase(),
          tags: norm.tags || [],
          badgeTags: norm.badge_tags || ['jam_game_2026']
        });
        newNormalized.push(norm);
      }

      return newNormalized.length > 0
        ? deduplicateCatalog([...newNormalized, ...updated])
        : updated;
    });

    if (onPackageStamped) {
      for (const item of stampedPackages) {
        onPackageStamped(item.lowerId, item.tags, item.badgeTags);
      }
    }
  } catch {
    // Non-fatal fallback
  }
}

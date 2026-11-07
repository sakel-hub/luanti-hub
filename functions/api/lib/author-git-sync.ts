// Automatic Git Repository Discovery, Verification & Dual-Source Import Engine for Verified Authors
import {
  checkIsAdmin,
  reconcileAndMergeUserAccount,
  invalidateCachedAuthMePayload
} from '../auth/lib/session';
import {
  fetchUpstreamJsonCached,
  scanGitRepoMetadataCached,
  fetchGitRepoReleasesAndTags,
  fetchGitSmartHttpRefs,
  buildGitBranchArchiveUrl,
  extractGitBranchHint,
  normalizeGitRepoInputUrl,
  parseGitRepoTarget,
  isGitProviderId,
  isDefunctGitHost,
  parseJsonArray,
  mergeScreenshotsPreferringGit,
  isGitRepositoryAssetUrl,
  upgradeContentDbThumbnailUrl,
  extractEmbeddedVideo,
  ensureExtendedPackageColumns,
  ensureModerationColumns,
  autoResolveBrokenRepoReport,
  invalidateEdgeCacheKeys,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  upsertCustomAppTags,
  fetchWithAnubisSupport
} from './upstream';
import { evaluateRepositoryContentSafety } from './content-safety';

export type AuthorPackageSyncStatus =
  | 'imported'
  | 'already_synced'
  | 'queued'
  | 'skipped_no_repo'
  | 'skipped_non_git'
  | 'failed_broken'
  | 'conflict'
  | 'held_moderation';

export interface AuthorPackageSyncItem {
  packageId: string;
  author: string;
  name: string;
  title: string;
  status: AuthorPackageSyncStatus;
  provider?: string;
  repoUrl?: string;
  message?: string;
}

export interface AuthorGitSyncResult {
  success: boolean;
  userId: string;
  authorHandles: string[];
  totalContentDbPackages: number;
  alreadySyncedCount: number;
  newlyImportedCount: number;
  skippedNoRepoCount: number;
  flaggedForReviewCount: number;
  remainingQueuedCount: number;
  packages: AuthorPackageSyncItem[];
}

export interface AuthorGitSyncOptions {
  userId?: string;
  authorHandles?: string[];
  triggerProvider?: string;
  verifiedUsername?: string;
  maxNewImports?: number;
  forceRescan?: boolean;
  rescanAlreadyTracked?: boolean;
  reportAmbiguousRepos?: boolean;
}

export interface AuthorGitSyncDiagnosticStatus {
  isRegistered: boolean;
  userId: string;
  username: string;
  authorHandles: string[];
  totalContentDbPackages: number;
  alreadySyncedCount: number;
  pendingQueueCount: number;
  skippedNoRepoCount: number;
  brokenReportCount: number;
  conflictCount: number;
  packages: AuthorPackageSyncItem[];
}

const NON_GIT_REPO_HOSTS = new Set([
  'forum.luanti.org',
  'forums.minetest.net',
  'forum.minetest.net',
  'content.luanti.org',
  'content.minetest.net',
  'minetest.net',
  'luanti.org',
  'wiki.luanti.org',
  'wiki.minetest.net',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'dropbox.com',
  'www.dropbox.com',
  'drive.google.com',
  'docs.google.com',
  'mediafire.com',
  'www.mediafire.com',
  'mega.nz',
  'discord.gg',
  'discord.com',
  'reddit.com',
  'www.reddit.com',
  'itch.io',
  'curseforge.com',
  'www.curseforge.com',
  'modrinth.com',
  'planetminecraft.com'
]);

/**
 * Classifies whether a raw ContentDB `repo` string is empty, a non-Git website/forum link,
 * or a valid candidate Git repository URL.
 */
export function classifyCandidateGitRepoUrl(rawRepoUrl?: string | null): {
  kind: 'no_repo' | 'non_git' | 'git_candidate';
  normalizedUrl?: string;
  provider?: 'github' | 'codeberg' | 'mesehub' | 'gitlab' | 'bitbucket';
  host?: string;
  owner?: string;
  repo?: string;
} {
  const trimmed = String(rawRepoUrl || '').trim();
  if (!trimmed) {
    return { kind: 'no_repo' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return { kind: 'non_git' };
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { kind: 'non_git' };
  }

  const lowerHost = parsedUrl.hostname.toLowerCase();
  if (
    NON_GIT_REPO_HOSTS.has(lowerHost) ||
    Array.from(NON_GIT_REPO_HOSTS).some(h => lowerHost.endsWith(`.${h}`))
  ) {
    return { kind: 'non_git' };
  }

  // Direct archive file links on generic hosts (not Git repo roots)
  const lowerPath = parsedUrl.pathname.toLowerCase();
  if (
    /\.(?:zip|tar\.gz|tgz|7z|rar|luac?|png|jpg|ogg)$/i.test(lowerPath) &&
    !lowerPath.includes('/archive/') &&
    !lowerPath.includes('/releases/') &&
    !lowerPath.includes('/-/archive/')
  ) {
    return { kind: 'non_git' };
  }

  // Reject non-repository web pages (/wiki, /issues, /pulls, /blob) and monorepo subdirectory links
  // (e.g. `/tree/<branch>/<subdir>` or `/src/branch/<branch>/<subdir>`), while allowing root branch URLs (`/tree/<branch>`)
  const pathSegments = parsedUrl.pathname
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (pathSegments.length >= 3) {
    const seg2 = pathSegments[2].toLowerCase();
    const seg3 = (pathSegments[3] || '').toLowerCase();
    if (
      ['wiki', 'wikis', 'issues', 'pulls', 'pull', 'merge_requests', 'discussions', 'blob', 'raw'].includes(seg2) ||
      (seg2 === '-' && ['wikis', 'issues', 'merge_requests', 'blob', 'raw'].includes(seg3))
    ) {
      return { kind: 'non_git' };
    }
    if (seg2 === 'tree' && pathSegments.length > 4) {
      return { kind: 'non_git' };
    }
    if (seg2 === '-' && seg3 === 'tree' && pathSegments.length > 5) {
      return { kind: 'non_git' };
    }
    if (seg2 === 'src') {
      if ((seg3 === 'branch' || seg3 === 'commit' || seg3 === 'tag') && pathSegments.length > 5) {
        return { kind: 'non_git' };
      }
      if (seg3 !== 'branch' && seg3 !== 'commit' && seg3 !== 'tag' && pathSegments.length > 4) {
        return { kind: 'non_git' };
      }
    }
  }

  const normalizedUrl = normalizeGitRepoInputUrl(trimmed) || trimmed;
  const target = parseGitRepoTarget(normalizedUrl);
  if (!target || !target.owner || !target.repo) {
    return { kind: 'non_git' };
  }

  let resolvedProvider: 'github' | 'codeberg' | 'mesehub' | 'gitlab' | 'bitbucket' = target.provider;
  if (target.host.includes('git.minetest.land')) {
    resolvedProvider = 'mesehub';
  }

  return {
    kind: 'git_candidate',
    normalizedUrl,
    provider: resolvedProvider,
    host: target.host,
    owner: target.owner,
    repo: target.repo
  };
}

async function verifyOrgOrContributorMatch(
  provider: 'github' | 'codeberg' | 'mesehub' | 'gitlab' | 'bitbucket',
  host: string,
  owner: string,
  repo: string,
  verifiedHandle: string
): Promise<boolean> {
  const lowerHandle = verifiedHandle.trim().toLowerCase();
  if (!lowerHandle) return false;
  if (lowerHandle === owner.trim().toLowerCase()) return true;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2200);
  try {
    if (provider === 'github') {
      const orgRes = await fetch(
        `https://api.github.com/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(verifiedHandle)}`,
        { headers, signal: ctrl.signal }
      );
      if (orgRes.status === 204 || orgRes.status === 200) return true;

      const contribRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=30`,
        { headers, signal: ctrl.signal }
      );
      if (contribRes.ok) {
        const list = await contribRes.json();
        if (Array.isArray(list) && list.some((c: any) => String(c?.login || '').toLowerCase() === lowerHandle)) {
          return true;
        }
      }
    } else if (provider === 'codeberg' || provider === 'mesehub') {
      const orgRes = await fetchWithAnubisSupport(
        `https://${host}/api/v1/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(verifiedHandle)}`,
        { headers, signal: ctrl.signal }
      );
      if (orgRes.status === 204 || orgRes.status === 200) return true;
    } else if (provider === 'gitlab') {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const membersRes = await fetch(
        `https://${host}/api/v4/projects/${projectPath}/members/all?query=${encodeURIComponent(verifiedHandle)}`,
        { headers, signal: ctrl.signal }
      );
      if (membersRes.ok) {
        const list = await membersRes.json();
        if (Array.isArray(list) && list.some((m: any) => String(m?.username || '').toLowerCase() === lowerHandle)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
  return false;
}

async function probeRepoRootOnlineStatus(repoUrl: string): Promise<'online' | 'broken_404' | 'unknown'> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2200);
  try {
    const res = await fetchWithAnubisSupport(repoUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
      }
    });
    if (res.ok) return 'online';
    if (res.status === 404 || res.status === 410) return 'broken_404';
    if (res.status === 405) {
      const getRes = await fetchWithAnubisSupport(repoUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)',
          'Range': 'bytes=0-255'
        }
      });
      if (getRes.ok || getRes.status === 206) return 'online';
      if (getRes.status === 404 || getRes.status === 410) return 'broken_404';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

function buildUserGitSyncCacheKey(userId: string): string {
  return `https://cache.luantihub.internal/__author_git_sync_v1/${encodeURIComponent(userId)}`;
}

/**
 * Discovers, verifies, and imports all ContentDB packages with valid Git repositories
 * belonging to a verified user (via ContentDB identity or Two-Way Git Forge identity matching).
 *
 * Designed for zero wasted Cloudflare Worker subrequests and D1 quota:
 * - Reads `/packages/?fmt=vcs` from Edge Cache / Isolate RAM.
 * - Pre-filters against existing D1 `packages` and open `moderation_reports` in 2 indexed queries.
 * - Skips packages without a Git repository silently (`skipped_no_repo` / `skipped_non_git`).
 * - Supports both modern `.conf`/`.cdb.json` repositories and legacy ContentDB-approved `init.lua` repositories.
 * - Creates deduplicated `moderation_reports` rows when a declared Git repository is broken (404),
 *   hits an ownership conflict, or requires Content Safety moderator review.
 */
export async function syncVerifiedAuthorGitPackages(
  env: { DB?: any; AI?: any; ADMIN_USERS?: string; SESSION_SECRET?: string },
  options: AuthorGitSyncOptions
): Promise<AuthorGitSyncResult> {
  const emptyResult: AuthorGitSyncResult = {
    success: false,
    userId: options.userId || '',
    authorHandles: options.authorHandles || [],
    totalContentDbPackages: 0,
    alreadySyncedCount: 0,
    newlyImportedCount: 0,
    skippedNoRepoCount: 0,
    flaggedForReviewCount: 0,
    remainingQueuedCount: 0,
    packages: []
  };

  if (!env?.DB) {
    return emptyResult;
  }

  const maxNewImports = Math.max(1, Math.min(12, options.maxNewImports ?? 8));
  const forceRescan = Boolean(options.forceRescan);
  const rescanAlreadyTracked = Boolean(options.rescanAlreadyTracked);

  try {
    let targetUserId = String(options.userId || '').trim();
    if (!targetUserId) {
      const lookupUsername = String(options.verifiedUsername || options.authorHandles?.[0] || '').trim();
      if (lookupUsername) {
        const uRow = await env.DB.prepare(
          `SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
        ).bind(lookupUsername).first();
        if (uRow?.id) {
          targetUserId = String(uRow.id);
        } else {
          const idRow = await env.DB.prepare(
            `SELECT u.id FROM user_identities ui JOIN users u ON u.id = ui.user_id WHERE LOWER(ui.provider_username) = LOWER(?) ORDER BY ui.verified DESC, u.created_at ASC LIMIT 1`
          ).bind(lookupUsername).first();
          if (idRow?.id) {
            targetUserId = String(idRow.id);
          }
        }
      }
    }
    if (!targetUserId) {
      return emptyResult;
    }

    const reconciledUser = await reconcileAndMergeUserAccount(env.DB, targetUserId);
    const resolvedUserId = String(reconciledUser?.id || targetUserId);

    // Check fast Edge Cache stamp when triggered passively in the background
    const userSyncCacheKey = buildUserGitSyncCacheKey(resolvedUserId);
    if (!forceRescan && !options.authorHandles?.length) {
      const cachedSync = await readEdgeCacheJson<AuthorGitSyncResult>(userSyncCacheKey);
      if (cachedSync && cachedSync.remainingQueuedCount === 0) {
        return cachedSync;
      }
    }

    await Promise.all([
      ensureExtendedPackageColumns(env.DB),
      ensureModerationColumns(env.DB)
    ]);

    const idRes = await env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(resolvedUserId).all();
    const identities = (idRes?.results || []).map((r: any) => ({
      provider: String(r.provider || '').trim().toLowerCase(),
      username: String(r.username || '').trim(),
      verified: Boolean(r.verified)
    }));

    const isCallerAdmin = checkIsAdmin(reconciledUser || { id: resolvedUserId }, identities, env.ADMIN_USERS);
    const verifiedIdentities = identities.filter((i: any) => i.verified && i.username);
    if (options.triggerProvider && options.verifiedUsername) {
      const tp = options.triggerProvider.trim().toLowerCase();
      const tu = options.verifiedUsername.trim();
      if (!verifiedIdentities.some((i: any) => i.provider === tp && i.username.toLowerCase() === tu.toLowerCase())) {
        verifiedIdentities.push({ provider: tp, username: tu, verified: true });
      }
    }

    const reconciledUsernameLower = String(reconciledUser?.username || '').trim().toLowerCase();
    const isRegisteredNonExtUser = Boolean(
      reconciledUsernameLower && !String(resolvedUserId).toLowerCase().startsWith('ext_')
    );

    if (verifiedIdentities.length === 0 && !isCallerAdmin && !isRegisteredNonExtUser) {
      return { ...emptyResult, userId: resolvedUserId };
    }

    const verifiedCdbHandles = new Set<string>(
      verifiedIdentities
        .filter((i: any) => i.provider === 'contentdb')
        .map((i: any) => i.username.toLowerCase())
    );
    if (isRegisteredNonExtUser && (verifiedIdentities.length === 0 || verifiedCdbHandles.size === 0)) {
      verifiedCdbHandles.add(reconciledUsernameLower);
    }
    const verifiedGitByProvider = new Map<string, Set<string>>();
    for (const id of verifiedIdentities) {
      if (id.provider !== 'contentdb') {
        const set = verifiedGitByProvider.get(id.provider) || new Set<string>();
        set.add(id.username.toLowerCase());
        verifiedGitByProvider.set(id.provider, set);
      }
    }

    // Include explicitly requested authorHandles when caller is admin or when the handle belongs to the user's verified identities
    if (Array.isArray(options.authorHandles)) {
      const ownedHandles = new Set<string>([
        ...(reconciledUsernameLower ? [reconciledUsernameLower] : []),
        ...verifiedIdentities.map((i: any) => i.username.toLowerCase())
      ]);
      for (const h of options.authorHandles) {
        const clean = String(h || '').trim().toLowerCase();
        if (clean && (isCallerAdmin || ownedHandles.has(clean))) {
          verifiedCdbHandles.add(clean);
        }
      }
    }

    const allAuthorHandles = Array.from(
      new Set([
        ...Array.from(verifiedCdbHandles),
        ...verifiedIdentities.map((i: any) => i.username.toLowerCase())
      ])
    );

    // 1. Load cached ContentDB bulk VCS catalog (0 extra subrequests when already cached)
    const bulkCatalog = (await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 600).catch(() => null)) || [];
    const candidateByLowerId = new Map<string, any>();

    for (const item of bulkCatalog) {
      if (!item || !item.author || !item.name) continue;
      const itemAuthorLower = String(item.author).trim().toLowerCase();
      const canonicalId = `${item.author}/${item.name}`;
      const lowerId = canonicalId.toLowerCase();

      // Match A: Verified ContentDB author handle
      if (verifiedCdbHandles.has(itemAuthorLower)) {
        candidateByLowerId.set(lowerId, item);
        continue;
      }

      // Match B: Two-Way Cryptographic Git Repository Owner Match
      if (item.repo) {
        const classified = classifyCandidateGitRepoUrl(item.repo);
        if (classified.kind === 'git_candidate' && classified.provider && classified.owner) {
          const handlesOnForge = verifiedGitByProvider.get(classified.provider);
          if (handlesOnForge && handlesOnForge.has(classified.owner.toLowerCase())) {
            candidateByLowerId.set(lowerId, item);
            continue;
          }
          // Same handle on Git forge as ContentDB author + potential Git organization repo
          if (handlesOnForge && handlesOnForge.has(itemAuthorLower)) {
            candidateByLowerId.set(lowerId, { ...item, __requiresOrgCheck: true });
          }
        }
      }
    }

    // Also query `/packages/?author=<cdbHandle>&fmt=vcs` for verified ContentDB handles if not found in bulk list
    for (const cdbHandle of verifiedCdbHandles) {
      const hasAnyInBulk = Array.from(candidateByLowerId.values()).some(
        p => String(p.author || '').toLowerCase() === cdbHandle
      );
      if (!hasAnyInBulk) {
        const authorList = await fetchUpstreamJsonCached<any[]>(
          `/packages/?author=${encodeURIComponent(cdbHandle)}&fmt=vcs`,
          300
        ).catch(() => null);
        if (Array.isArray(authorList)) {
          for (const item of authorList) {
            if (item?.author && item?.name) {
              candidateByLowerId.set(`${item.author}/${item.name}`.toLowerCase(), item);
            }
          }
        }
      }
    }

    const candidateItems = Array.from(candidateByLowerId.values());
    if (candidateItems.length === 0) {
      const emptyDone: AuthorGitSyncResult = {
        success: true,
        userId: resolvedUserId,
        authorHandles: allAuthorHandles,
        totalContentDbPackages: 0,
        alreadySyncedCount: 0,
        newlyImportedCount: 0,
        skippedNoRepoCount: 0,
        flaggedForReviewCount: 0,
        remainingQueuedCount: 0,
        packages: []
      };
      await writeEdgeCacheJson(userSyncCacheKey, emptyDone, 21600);
      return emptyDone;
    }

    // 2. Pre-fetch existing D1 `packages` and open `moderation_reports` for these authors in 2 indexed queries
    const matchedAuthorsSet = new Set<string>(
      candidateItems.map(it => String(it.author || '').trim().toLowerCase()).filter(Boolean)
    );
    const authorBindList = Array.from(matchedAuthorsSet);
    const existingD1ByLowerId = new Map<string, any>();
    const openBrokenReportsByLowerId = new Set<string>();
    const openClaimReportsByLowerId = new Set<string>();

    if (authorBindList.length > 0) {
      const authorPlaceholders = authorBindList.map(() => '?').join(', ');
      const d1PkgRes = await env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(author_name) IN (${authorPlaceholders})`
      ).bind(...authorBindList).all().catch(() => null);

      for (const row of d1PkgRes?.results || []) {
        if (row?.id) {
          existingD1ByLowerId.set(String(row.id).toLowerCase(), row);
        }
      }

      const reportPrefixClauses = authorBindList
        .map(() => `LOWER(SUBSTR(package_id, 1, INSTR(package_id, '/') - 1)) = ?`)
        .join(' OR ');
      const d1RepRes = await env.DB.prepare(
        `SELECT package_id, reason, details FROM moderation_reports WHERE status = 'open' AND (${reportPrefixClauses})`
      ).bind(...authorBindList).all().catch(() => null);

      for (const rep of d1RepRes?.results || []) {
        const lowerPkgId = String(rep?.package_id || '').toLowerCase();
        if (!lowerPkgId) continue;
        if (rep.reason === 'broken') {
          openBrokenReportsByLowerId.add(lowerPkgId);
        }
        if (String(rep.details || '').includes('[CLAIM_PACKAGE:')) {
          openClaimReportsByLowerId.add(lowerPkgId);
        }
      }
    }

    const syncItems: AuthorPackageSyncItem[] = [];
    const unsyncedGitQueue: Array<{
      item: any;
      canonicalId: string;
      lowerId: string;
      existingD1: any | null;
      classified: ReturnType<typeof classifyCandidateGitRepoUrl>;
    }> = [];
    const claimExistingBatchStmts: any[] = [];
    let alreadySyncedCount = 0;
    let skippedNoRepoCount = 0;
    let flaggedForReviewCount = 0;

    // 3. Classify each candidate package in memory before making any network calls
    for (const item of candidateItems) {
      const canonicalId = `${item.author}/${item.name}`;
      const lowerId = canonicalId.toLowerCase();
      const title = String(item.title || item.name);
      const existingD1 = existingD1ByLowerId.get(lowerId) || null;

      // Check for ownership conflict in D1
      const existingOwnerId = existingD1?.author_id ? String(existingD1.author_id).trim() : '';
      const hasDifferentVerifiedOwner = Boolean(
        existingOwnerId &&
        !existingOwnerId.startsWith('ext_') &&
        existingOwnerId !== resolvedUserId &&
        !isCallerAdmin
      );

      if (hasDifferentVerifiedOwner) {
        flaggedForReviewCount++;
        syncItems.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'conflict',
          repoUrl: existingD1?.repo_url || item.repo,
          message: `Ownership conflict on '${canonicalId}' queued for moderator review.`
        });

        if (!openClaimReportsByLowerId.has(lowerId)) {
          openClaimReportsByLowerId.add(lowerId);
          const claimTag = `[CLAIM_PACKAGE:${canonicalId}:${resolvedUserId}]`;
          const claimDetails =
            `${claimTag} [AUTO-GIT-SYNC] Verified author @${reconciledUser?.username || item.author} authenticated for '${canonicalId}', ` +
            `which is currently linked to another user ID (${existingOwnerId}). Click Resolve to assign ownership to ${resolvedUserId}, or Dismiss.`;
          claimExistingBatchStmts.push(
            env.DB.prepare(
              `INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status) VALUES (?, ?, 'other', ?, 'open')`
            ).bind(canonicalId, resolvedUserId, claimDetails.slice(0, 1000))
          );
        }
        continue;
      }

      // Check if already verified and active as a Git package in D1
      const existingProvider = String(existingD1?.provider || '').trim().toLowerCase();
      const existingTags = parseJsonArray(existingD1?.tags);
      const isAlreadyGitTracked = Boolean(
        existingD1 &&
        existingD1.repo_url &&
        ((existingProvider && existingProvider !== 'contentdb' && isGitProviderId(existingProvider)) ||
          existingTags.includes('git'))
      );

      if (isAlreadyGitTracked && !rescanAlreadyTracked) {
        alreadySyncedCount++;
        // Link author_id if currently unclaimed or ext_*
        const needsAuthorIdLink = !existingOwnerId || existingOwnerId.startsWith('ext_');
        const needsDualTags = !existingTags.includes('git') || !existingTags.includes('contentdb');
        if (needsAuthorIdLink || needsDualTags) {
          const updatedTags = Array.from(
            new Set([...existingTags, 'contentdb', 'git', existingProvider || 'github'])
          );
          claimExistingBatchStmts.push(
            env.DB.prepare(
              `UPDATE packages SET author_id = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(id) = LOWER(?)`
            ).bind(resolvedUserId, JSON.stringify(updatedTags), canonicalId)
          );
        }
        syncItems.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'already_synced',
          provider: existingProvider || 'github',
          repoUrl: existingD1.repo_url
        });
        continue;
      }

      // Classify the ContentDB `repo` URL
      const rawRepo = item.repo || item.repo_url || existingD1?.repo_url || '';
      const classified = classifyCandidateGitRepoUrl(rawRepo);

      if (classified.kind === 'no_repo') {
        skippedNoRepoCount++;
        syncItems.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'skipped_no_repo'
        });
        continue;
      }

      if (classified.kind === 'non_git') {
        skippedNoRepoCount++;
        syncItems.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'skipped_non_git',
          repoUrl: rawRepo
        });
        continue;
      }

      // If this package already has an open 'broken' report in D1 and we are not forcing a rescan, skip network probing
      if (openBrokenReportsByLowerId.has(lowerId) && !forceRescan) {
        flaggedForReviewCount++;
        syncItems.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'failed_broken',
          provider: classified.provider,
          repoUrl: classified.normalizedUrl,
          message: 'Git repository returned HTTP 404 (open report in My Reports).'
        });
        continue;
      }

      unsyncedGitQueue.push({
        item,
        canonicalId,
        lowerId,
        existingD1,
        classified
      });
    }

    if (claimExistingBatchStmts.length > 0) {
      if (typeof env.DB.batch === 'function') {
        await env.DB.batch(claimExistingBatchStmts).catch(() => {});
      } else {
        for (const s of claimExistingBatchStmts) {
          await s.run().catch(() => {});
        }
      }
    }

    const batchToVerify = unsyncedGitQueue.slice(0, maxNewImports);
    const remainingQueuedCount = Math.max(0, unsyncedGitQueue.length - batchToVerify.length);
    let newlyImportedCount = 0;
    const cacheKeysToInvalidate: string[] = [];

    // 4. Verify & Import up to `maxNewImports` packages (concurrency = 3)
    const CONCURRENCY = 3;
    for (let i = 0; i < batchToVerify.length; i += CONCURRENCY) {
      const chunk = batchToVerify.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (entry) => {
          const { item, canonicalId, lowerId, existingD1, classified } = entry;
          const provider = classified.provider || 'github';
          const host = classified.host || 'github.com';
          const owner = classified.owner || item.author;
          const repo = classified.repo || item.name;
          const repoUrl = classified.normalizedUrl || String(item.repo || '').trim();
          const pkgType: 'mod' | 'game' | 'txp' | 'modpack' =
            item.type === 'game'
              ? 'game'
              : item.type === 'txp'
                ? 'txp'
                : item.type === 'modpack'
                  ? 'modpack'
                  : 'mod';

          // If matched via Two-Way Git org check, verify org/contributor membership first
          if (item.__requiresOrgCheck && !verifiedCdbHandles.has(String(item.author).toLowerCase())) {
            const handlesOnForge = Array.from(verifiedGitByProvider.get(provider) || []);
            let orgVerified = false;
            for (const h of handlesOnForge) {
              if (await verifyOrgOrContributorMatch(provider, host, owner, repo, h)) {
                orgVerified = true;
                break;
              }
            }
            if (!orgVerified) {
              skippedNoRepoCount++;
              syncItems.push({
                packageId: canonicalId,
                author: item.author,
                name: item.name,
                title: String(item.title || item.name),
                status: 'skipped_non_git',
                provider,
                repoUrl
              });
              return;
            }
          }

          // Check defunct hosts (NotABug is automatically rewritten to Codeberg by normalizeGitRepoInputUrl)
          const rawOriginalRepoUrl = String(item.repo || item.repo_url || '').trim();
          const isDefunctNonMigrated =
            isDefunctGitHost(rawOriginalRepoUrl) && !rawOriginalRepoUrl.toLowerCase().includes('notabug.org');

          const scan = isDefunctNonMigrated
            ? {
                gitRepoStatus: 'broken_404' as const,
                repoUrl,
                hardDeps: [],
                softDeps: [],
                supportedGames: [],
                unsupportedGames: []
              }
            : await scanGitRepoMetadataCached(item.author, item.name, pkgType, repoUrl, 21600);

          let effectiveStatus = scan.gitRepoStatus;
          let fallbackDefaultBranch = '';
          let fallbackHeadSha = '';
          if (
            effectiveStatus === 'unverified' ||
            (effectiveStatus === 'verified' && !scan.rawBaseUrl && pkgType !== 'txp')
          ) {
            const probeStatus = effectiveStatus === 'verified' ? 'online' : await probeRepoRootOnlineStatus(repoUrl);
            if (probeStatus === 'broken_404') {
              effectiveStatus = 'broken_404';
            } else if (probeStatus === 'online') {
              if (pkgType === 'txp') {
                effectiveStatus = 'verified';
              } else {
                const smartRefs = await fetchGitSmartHttpRefs(repoUrl, owner, repo).catch(() => null);
                if (smartRefs && (smartRefs.headSha || smartRefs.tags.length > 0)) {
                  effectiveStatus = 'verified';
                  fallbackDefaultBranch = smartRefs.defaultBranch || '';
                  fallbackHeadSha = smartRefs.headSha || '';
                } else {
                  effectiveStatus = 'unverified';
                }
              }
            }
          }

          if (effectiveStatus === 'broken_404' || effectiveStatus !== 'verified') {
            if (effectiveStatus === 'broken_404' || options.reportAmbiguousRepos) {
              flaggedForReviewCount++;
              // Ensure placeholder package row exists so moderation_reports foreign key & package title join succeed
              if (!existingD1) {
                await env.DB.prepare(`
                  INSERT OR IGNORE INTO packages (
                    id, author_id, author_name, name, title, type, short_desc, long_desc,
                    repo_url, provider, default_branch, thumbnail_url, banner_url,
                    downloads_count, contentdb_downloads, license, media_license, tags, status
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'contentdb', 'main', ?, ?, ?, ?, ?, ?, ?, 'active')
                `).bind(
                  canonicalId,
                  resolvedUserId,
                  item.author,
                  item.name,
                  item.title || item.name,
                  pkgType === 'modpack' ? 'mod' : pkgType,
                  item.short_desc || item.short_description || '',
                  item.short_desc || item.short_description || '',
                  rawOriginalRepoUrl || repoUrl,
                  upgradeContentDbThumbnailUrl(item.thumbnail) || 'logo.svg',
                  upgradeContentDbThumbnailUrl(item.thumbnail) || 'logo.svg',
                  Number(item.downloads || 0),
                  Number(item.downloads || 0),
                  item.license || 'MIT',
                  item.media_license || item.license || 'CC-BY-SA-4.0',
                  JSON.stringify(['contentdb', pkgType === 'modpack' ? 'mod' : pkgType])
                ).run().catch(() => {});
              }

              if (!openBrokenReportsByLowerId.has(lowerId)) {
                openBrokenReportsByLowerId.add(lowerId);
                const reportDetails =
                  `[AUTO-GIT-SYNC] ContentDB package '${canonicalId}' declares Git repository URL '${rawOriginalRepoUrl || repoUrl}', ` +
                  `which returned HTTP 404 / unreachable during automatic author Git verification. ` +
                  `Please update the repository URL or click Re-Check URL once restored.`;
                await env.DB.prepare(`
                  INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status)
                  VALUES (?, 'system-git-sync', 'broken', ?, 'open')
                `).bind(canonicalId, reportDetails.slice(0, 1000)).run().catch(() => {});
              }

              syncItems.push({
                packageId: canonicalId,
                author: item.author,
                name: item.name,
                title: String(item.title || item.name),
                status: 'failed_broken',
                provider,
                repoUrl: rawOriginalRepoUrl || repoUrl,
                message: `Repository URL (${rawOriginalRepoUrl || repoUrl}) returned HTTP 404.`
              });
            } else {
              skippedNoRepoCount++;
              syncItems.push({
                packageId: canonicalId,
                author: item.author,
                name: item.name,
                title: String(item.title || item.name),
                status: 'skipped_non_git',
                provider,
                repoUrl
              });
            }
            return;
          }

          // Verified Git Repository! Fetch detail & releases to build complete dual-source record
          const verifiedRepoUrl = scan.repoUrl || repoUrl;
          const branch =
            extractGitBranchHint(scan.rawBaseUrl) ||
            extractGitBranchHint(rawOriginalRepoUrl) ||
            fallbackDefaultBranch ||
            existingD1?.default_branch ||
            'main';
          const minVersion = scan.minVersion || item.min_minetest_version || existingD1?.min_minetest_version || '5.0.0';

          const [discoveredReleases, cdbDetail] = await Promise.all([
            fetchGitRepoReleasesAndTags(verifiedRepoUrl, owner, repo, minVersion).catch(() => []),
            fetchUpstreamJsonCached<any>(
              `/packages/${encodeURIComponent(item.author)}/${encodeURIComponent(item.name)}/`,
              3600
            ).catch(() => null)
          ]);

          const resolvedTitle =
            cdbDetail?.title || item.title || scan.title || existingD1?.title || item.name;
          const resolvedShortDesc =
            cdbDetail?.short_desc ||
            cdbDetail?.short_description ||
            item.short_desc ||
            item.short_description ||
            scan.shortDesc ||
            existingD1?.short_desc ||
            'Community package for Luanti.';
          const resolvedLongDesc =
            scan.longDesc ||
            cdbDetail?.long_description ||
            existingD1?.long_desc ||
            resolvedShortDesc;
          const effectiveLicense =
            scan.license || cdbDetail?.license || item.license || existingD1?.license || 'MIT';
          const effectiveMediaLicense =
            scan.mediaLicense ||
            cdbDetail?.media_license ||
            item.media_license ||
            existingD1?.media_license ||
            effectiveLicense;

          const safetyEval = await evaluateRepositoryContentSafety(
            {
              repoOwner: owner,
              repoName: repo,
              confFileName: pkgType === 'game' ? 'game.conf' : 'mod.conf',
              rawConfig: '',
              title: resolvedTitle,
              shortDesc: resolvedShortDesc,
              readmeMarkdown: resolvedLongDesc
            },
            {
              aiBinding: env.AI,
              runAiCheck: false
            }
          );

          const cdbTags = Array.isArray(cdbDetail?.tags || item.tags)
            ? (cdbDetail?.tags || item.tags)
                .map((t: any) => String(typeof t === 'string' ? t : t?.name || '').trim().toLowerCase())
                .filter(Boolean)
            : [];
          const existingTags = parseJsonArray(existingD1?.tags);
          const scanTags = scan.cdbMeta?.tags || [];
          const normalizedType = (scan.detectedType || pkgType) === 'modpack' ? 'mod' : (scan.detectedType || pkgType);

          const mergedTags = Array.from(
            new Set([
              ...existingTags,
              ...cdbTags,
              ...scanTags,
              'contentdb',
              'git',
              provider,
              normalizedType
            ])
          ).slice(0, 14);

          const cdbThumb = upgradeContentDbThumbnailUrl(cdbDetail?.thumbnail || item.thumbnail);
          const mergedScreenshots = mergeScreenshotsPreferringGit(
            [scan.screenshotUrl, cdbThumb],
            scan.screenshots,
            parseJsonArray(existingD1?.screenshots).filter((s: string) => !isGitRepositoryAssetUrl(s)),
            cdbDetail?.screenshots || item.screenshots
          );
          const resolvedThumbnail =
            cdbThumb || scan.screenshotUrl || existingD1?.thumbnail_url || 'logo.svg';
          const resolvedBanner =
            scan.screenshotUrl || mergedScreenshots[0] || resolvedThumbnail;

          const cdbDownloads = Math.max(
            Number(cdbDetail?.downloads || 0),
            Number(item.downloads || 0),
            Number(existingD1?.contentdb_downloads || 0)
          );
          const lhDownloads = Number(existingD1?.luantihub_downloads || 0);
          const totalDownloads = Math.max(cdbDownloads + lhDownloads, Number(existingD1?.downloads_count || 0));

          const resolvedVideo = extractEmbeddedVideo(
            scan.cdbMeta?.video_url || cdbDetail?.video_url || existingD1?.video_url,
            cdbDetail?.video_thumbnail_url || existingD1?.video_thumbnail_url,
            resolvedLongDesc
          );
          const resolvedWarnings = Array.from(
            new Set([
              ...(scan.cdbMeta?.content_warnings || []),
              ...parseJsonArray(cdbDetail?.content_warnings),
              ...parseJsonArray(existingD1?.content_warnings),
              ...safetyEval.autoContentWarnings
            ])
          );
          const resolvedAiDisclosures = Array.from(
            new Set([
              ...(scan.cdbMeta?.ai_disclosures || []),
              ...parseJsonArray(existingD1?.ai_disclosures)
            ])
          );

          const latestCommitSha =
            discoveredReleases[0]?.commit_sha ||
            fallbackHeadSha ||
            existingD1?.latest_commit_sha ||
            null;
          const initialStatus = safetyEval.holdForAdminReview ? 'flagged' : 'active';
          const initialStatusReason = safetyEval.holdForAdminReview
            ? `[ADMIN] Automated Content Safety Hold: ${safetyEval.summary}`.slice(0, 500)
            : null;
          const preservedCreatedAt =
            existingD1?.created_at || cdbDetail?.created_at || item.created_at || null;

          // Ensure user row exists
          await env.DB.prepare(`
            INSERT OR IGNORE INTO users (id, username, display_name, avatar_url)
            VALUES (?, ?, ?, ?)
          `).bind(
            resolvedUserId,
            reconciledUser?.username || item.author,
            reconciledUser?.display_name || item.author,
            reconciledUser?.avatar_url || `https://github.com/${owner}.png`
          ).run().catch(() => {});

          // Upsert D1 package record as verified dual-source Git + ContentDB package
          await env.DB.prepare(`
            INSERT INTO packages (
              id, author_id, author_name, name, title, type, short_desc, long_desc,
              repo_url, provider, default_branch, latest_commit_sha, thumbnail_url, banner_url, screenshots,
              downloads_count, contentdb_downloads, score, license, media_license, tags, dependencies, optional_dependencies,
              min_minetest_version, donate_url, translation_url, forum_url, issue_tracker,
              video_url, video_thumbnail_url, dev_state, content_warnings, ai_disclosures, status, status_reason, flagged_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'flagged' THEN CURRENT_TIMESTAMP ELSE NULL END, COALESCE(?, CURRENT_TIMESTAMP))
            ON CONFLICT(id) DO UPDATE SET
              author_id = CASE
                WHEN packages.author_id IS NULL OR packages.author_id LIKE 'ext_%' THEN excluded.author_id
                ELSE packages.author_id
              END,
              title = excluded.title,
              short_desc = excluded.short_desc,
              long_desc = COALESCE(NULLIF(excluded.long_desc, ''), packages.long_desc),
              repo_url = excluded.repo_url,
              provider = excluded.provider,
              default_branch = excluded.default_branch,
              latest_commit_sha = COALESCE(excluded.latest_commit_sha, packages.latest_commit_sha),
              thumbnail_url = excluded.thumbnail_url,
              banner_url = excluded.banner_url,
              screenshots = COALESCE(excluded.screenshots, packages.screenshots),
              contentdb_downloads = MAX(packages.contentdb_downloads, excluded.contentdb_downloads),
              downloads_count = MAX(packages.downloads_count, excluded.downloads_count),
              license = excluded.license,
              media_license = excluded.media_license,
              tags = excluded.tags,
              dependencies = CASE
                WHEN excluded.dependencies != '[]' THEN excluded.dependencies
                ELSE COALESCE(packages.dependencies, '[]')
              END,
              optional_dependencies = CASE
                WHEN excluded.optional_dependencies != '[]' THEN excluded.optional_dependencies
                ELSE COALESCE(packages.optional_dependencies, '[]')
              END,
              min_minetest_version = excluded.min_minetest_version,
              donate_url = COALESCE(excluded.donate_url, packages.donate_url),
              translation_url = COALESCE(excluded.translation_url, packages.translation_url),
              forum_url = COALESCE(excluded.forum_url, packages.forum_url),
              issue_tracker = COALESCE(excluded.issue_tracker, packages.issue_tracker),
              video_url = COALESCE(excluded.video_url, packages.video_url),
              video_thumbnail_url = COALESCE(excluded.video_thumbnail_url, packages.video_thumbnail_url),
              dev_state = COALESCE(excluded.dev_state, packages.dev_state),
              content_warnings = COALESCE(excluded.content_warnings, packages.content_warnings),
              ai_disclosures = COALESCE(excluded.ai_disclosures, packages.ai_disclosures),
              status = CASE
                WHEN packages.status = 'delisted' THEN 'delisted'
                WHEN excluded.status = 'flagged' THEN 'flagged'
                ELSE COALESCE(packages.status, 'active')
              END,
              status_reason = CASE
                WHEN excluded.status = 'flagged' AND COALESCE(packages.status, 'active') != 'delisted' THEN excluded.status_reason
                ELSE packages.status_reason
              END,
              flagged_at = CASE
                WHEN excluded.status = 'flagged' AND COALESCE(packages.status, 'active') != 'delisted' THEN COALESCE(packages.flagged_at, CURRENT_TIMESTAMP)
                ELSE packages.flagged_at
              END,
              updated_at = CURRENT_TIMESTAMP
          `).bind(
            canonicalId,
            resolvedUserId,
            item.author,
            item.name,
            resolvedTitle,
            normalizedType,
            resolvedShortDesc,
            resolvedLongDesc,
            verifiedRepoUrl,
            provider,
            branch,
            latestCommitSha,
            resolvedThumbnail,
            resolvedBanner,
            mergedScreenshots.length > 0 ? JSON.stringify(mergedScreenshots) : null,
            totalDownloads,
            cdbDownloads,
            Number(existingD1?.score || 0),
            effectiveLicense,
            effectiveMediaLicense,
            JSON.stringify(mergedTags),
            JSON.stringify(scan.hardDeps || []),
            JSON.stringify(scan.softDeps || []),
            minVersion,
            scan.cdbMeta?.donate_url || cdbDetail?.donate_url || existingD1?.donate_url || null,
            scan.cdbMeta?.translation_url || cdbDetail?.translation_url || existingD1?.translation_url || null,
            scan.cdbMeta?.forum_url || cdbDetail?.forum_url || existingD1?.forum_url || null,
            scan.cdbMeta?.issue_tracker || cdbDetail?.issue_tracker || existingD1?.issue_tracker || null,
            resolvedVideo.video_url || null,
            resolvedVideo.video_thumbnail_url || null,
            scan.cdbMeta?.dev_state || cdbDetail?.dev_state || existingD1?.dev_state || null,
            resolvedWarnings.length > 0 ? JSON.stringify(resolvedWarnings) : null,
            resolvedAiDisclosures.length > 0 ? JSON.stringify(resolvedAiDisclosures) : null,
            initialStatus,
            initialStatusReason,
            initialStatus,
            preservedCreatedAt
          ).run();

          if (mergedTags.length > 0) {
            await upsertCustomAppTags(env.DB, mergedTags, 'custom').catch(() => {});
          }

          // Upsert discovered Git releases into D1 `releases`
          const branchArchiveUrl = buildGitBranchArchiveUrl(verifiedRepoUrl, owner, repo, branch);
          const releaseStmts: any[] = [
            env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(canonicalId)
          ];
          if (discoveredReleases.length > 0) {
            for (const rel of discoveredReleases.slice(0, 10)) {
              releaseStmts.push(
                env.DB.prepare(`
                  INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))
                `).bind(
                  canonicalId,
                  rel.version,
                  rel.tag_name,
                  rel.commit_sha || '',
                  rel.download_url,
                  minVersion,
                  rel.changelog || null,
                  rel.released_at || ''
                )
              );
            }
          } else {
            releaseStmts.push(
              env.DB.prepare(`
                INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version)
                VALUES (?, 'latest', ?, 'HEAD', ?, ?)
              `).bind(canonicalId, branch, branchArchiveUrl, minVersion)
            );
          }

          if (typeof env.DB.batch === 'function') {
            await env.DB.batch(releaseStmts).catch(() => {});
          } else {
            for (const stmt of releaseStmts) {
              await stmt.run().catch(() => {});
            }
          }

          if (safetyEval.holdForAdminReview) {
            flaggedForReviewCount++;
            const safetyDetails =
              `[Automated Content Safety Hold] ${safetyEval.summary}. ` +
              `Discovered during automatic ContentDB author Git sync for @${item.author} (${verifiedRepoUrl}).`;
            const existingSafety = await env.DB.prepare(`
              SELECT id FROM moderation_reports
              WHERE LOWER(package_id) = LOWER(?) AND reason = 'inappropriate' AND status = 'open'
              LIMIT 1
            `).bind(canonicalId).first().catch(() => null);
            if (!existingSafety?.id) {
              await env.DB.prepare(`
                INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status)
                VALUES (?, 'system-content-guard', 'inappropriate', ?, 'open')
              `).bind(canonicalId, safetyDetails.slice(0, 1000)).run().catch(() => {});
            }
            syncItems.push({
              packageId: canonicalId,
              author: item.author,
              name: item.name,
              title: resolvedTitle,
              status: 'held_moderation',
              provider,
              repoUrl: verifiedRepoUrl,
              message: 'Queued for administrator content safety review.'
            });
          } else {
            newlyImportedCount++;
            await autoResolveBrokenRepoReport(
              env.DB,
              canonicalId,
              `Repository verified online via Automatic Author Git Sync (${verifiedRepoUrl}).`
            );
            syncItems.push({
              packageId: canonicalId,
              author: item.author,
              name: item.name,
              title: resolvedTitle,
              status: 'imported',
              provider,
              repoUrl: verifiedRepoUrl
            });
          }

          const lowerPkgAuthor = item.author.toLowerCase();
          const lowerPkgName = item.name.toLowerCase();
          cacheKeysToInvalidate.push(
            `/__api_pkg_detail_v2/${lowerPkgAuthor}/${lowerPkgName}`,
            `https://cache.luantihub.internal/pkg-detail-v7:${lowerPkgAuthor}:${lowerPkgName}`,
            `https://cache.luantihub.internal/__for_client_v4/${encodeURIComponent(lowerPkgAuthor)}/${encodeURIComponent(lowerPkgName)}`,
            `/__api_author_profile_v2/${encodeURIComponent(lowerPkgAuthor)}`
          );
        })
      );
    }

    if (newlyImportedCount > 0 || claimExistingBatchStmts.length > 0 || flaggedForReviewCount > 0) {
      invalidateCachedAuthMePayload(resolvedUserId);
      for (const h of allAuthorHandles) {
        cacheKeysToInvalidate.push(`/__api_author_profile_v2/${encodeURIComponent(h.toLowerCase())}`);
      }
      await invalidateEdgeCacheKeys([
        'https://cache.luantihub.internal/__api_boot_catalog_bundle_v19',
        '/__api_boot_catalog_bundle_v19',
        '/__api_packages_v2',
        '/__api_packages_v2?boot=1',
        ...cacheKeysToInvalidate
      ]).catch(() => {});
    }

    const finalResult: AuthorGitSyncResult = {
      success: true,
      userId: resolvedUserId,
      authorHandles: allAuthorHandles,
      totalContentDbPackages: candidateItems.length,
      alreadySyncedCount,
      newlyImportedCount,
      skippedNoRepoCount,
      flaggedForReviewCount,
      remainingQueuedCount,
      packages: syncItems
    };

    if (remainingQueuedCount === 0) {
      await writeEdgeCacheJson(userSyncCacheKey, finalResult, 21600).catch(() => {});
    }

    return finalResult;
  } catch (err) {
    console.error('[author-git-sync] Error syncing verified author Git packages:', err);
    return emptyResult;
  }
}

/**
 * Fast, zero-Git-subrequest diagnostic inspector that reports the live Git sync state
 * for any author handle or userId using cached ContentDB `/packages/?fmt=vcs` and 2 D1 queries.
 */
export async function inspectAuthorGitSyncStatus(
  env: { DB?: any; ADMIN_USERS?: string },
  options: { userId?: string; username?: string; authorHandles?: string[] }
): Promise<AuthorGitSyncDiagnosticStatus> {
  const emptyStatus: AuthorGitSyncDiagnosticStatus = {
    isRegistered: false,
    userId: options.userId || '',
    username: options.username || '',
    authorHandles: options.authorHandles || [],
    totalContentDbPackages: 0,
    alreadySyncedCount: 0,
    pendingQueueCount: 0,
    skippedNoRepoCount: 0,
    brokenReportCount: 0,
    conflictCount: 0,
    packages: []
  };

  if (!env?.DB) {
    return emptyStatus;
  }

  try {
    let resolvedUserId = String(options.userId || '').trim();
    let resolvedUsername = String(options.username || '').trim();

    if (!resolvedUserId && resolvedUsername) {
      const uRow = await env.DB.prepare(
        `SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
      ).bind(resolvedUsername).first().catch(() => null);
      if (uRow?.id) {
        resolvedUserId = String(uRow.id);
        resolvedUsername = String(uRow.username || resolvedUsername);
      } else {
        const idRow = await env.DB.prepare(
          `SELECT u.id, u.username FROM user_identities ui JOIN users u ON u.id = ui.user_id WHERE LOWER(ui.provider_username) = LOWER(?) AND ui.verified = 1 LIMIT 1`
        ).bind(resolvedUsername).first().catch(() => null);
        if (idRow?.id) {
          resolvedUserId = String(idRow.id);
          resolvedUsername = String(idRow.username || resolvedUsername);
        }
      }
    } else if (resolvedUserId && !resolvedUsername) {
      const uRow = await env.DB.prepare(
        `SELECT id, username FROM users WHERE id = ? LIMIT 1`
      ).bind(resolvedUserId).first().catch(() => null);
      if (uRow?.username) {
        resolvedUsername = String(uRow.username);
      }
    }

    const identities: Array<{ provider: string; username: string; verified: boolean }> = [];
    if (resolvedUserId) {
      const idRes = await env.DB.prepare(
        `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
      ).bind(resolvedUserId).all().catch(() => null);
      for (const r of idRes?.results || []) {
        if (r?.provider && r?.username) {
          identities.push({
            provider: String(r.provider).trim().toLowerCase(),
            username: String(r.username).trim(),
            verified: Boolean(r.verified)
          });
        }
      }
    }

    const verifiedIdentities = identities.filter(i => i.verified && i.username);
    const isRegistered = Boolean(resolvedUserId && (verifiedIdentities.length > 0 || resolvedUsername));

    const verifiedCdbHandles = new Set<string>(
      verifiedIdentities
        .filter(i => i.provider === 'contentdb')
        .map(i => i.username.toLowerCase())
    );
    if (resolvedUsername && isRegistered) {
      verifiedCdbHandles.add(resolvedUsername.toLowerCase());
    }
    for (const h of options.authorHandles || []) {
      const clean = String(h || '').trim().toLowerCase();
      if (clean) verifiedCdbHandles.add(clean);
    }

    const verifiedGitByProvider = new Map<string, Set<string>>();
    for (const id of verifiedIdentities) {
      if (id.provider !== 'contentdb') {
        const set = verifiedGitByProvider.get(id.provider) || new Set<string>();
        set.add(id.username.toLowerCase());
        verifiedGitByProvider.set(id.provider, set);
      }
    }

    const allAuthorHandles = Array.from(
      new Set([
        ...Array.from(verifiedCdbHandles),
        ...verifiedIdentities.map(i => i.username.toLowerCase())
      ])
    );

    if (allAuthorHandles.length === 0) {
      return {
        ...emptyStatus,
        isRegistered,
        userId: resolvedUserId,
        username: resolvedUsername
      };
    }

    const bulkCatalog = (await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 600).catch(() => null)) || [];
    const candidateByLowerId = new Map<string, any>();

    for (const item of bulkCatalog) {
      if (!item || !item.author || !item.name) continue;
      const itemAuthorLower = String(item.author).trim().toLowerCase();
      const canonicalId = `${item.author}/${item.name}`;
      const lowerId = canonicalId.toLowerCase();

      if (verifiedCdbHandles.has(itemAuthorLower)) {
        candidateByLowerId.set(lowerId, item);
        continue;
      }
      if (item.repo) {
        const classified = classifyCandidateGitRepoUrl(item.repo);
        if (classified.kind === 'git_candidate' && classified.provider && classified.owner) {
          const handlesOnForge = verifiedGitByProvider.get(classified.provider);
          if (handlesOnForge && handlesOnForge.has(classified.owner.toLowerCase())) {
            candidateByLowerId.set(lowerId, item);
          }
        }
      }
    }

    const candidateItems = Array.from(candidateByLowerId.values());
    if (candidateItems.length === 0) {
      return {
        ...emptyStatus,
        isRegistered,
        userId: resolvedUserId,
        username: resolvedUsername,
        authorHandles: allAuthorHandles
      };
    }

    const authorBindList = Array.from(
      new Set(candidateItems.map(it => String(it.author || '').trim().toLowerCase()).filter(Boolean))
    );
    const existingD1ByLowerId = new Map<string, any>();
    const openBrokenReportsByLowerId = new Set<string>();

    if (authorBindList.length > 0) {
      const authorPlaceholders = authorBindList.map(() => '?').join(', ');
      const d1PkgRes = await env.DB.prepare(
        `SELECT id, author_id, author_name, name, title, provider, repo_url, tags, status FROM packages WHERE LOWER(author_name) IN (${authorPlaceholders})`
      ).bind(...authorBindList).all().catch(() => null);
      for (const row of d1PkgRes?.results || []) {
        if (row?.id) {
          existingD1ByLowerId.set(String(row.id).toLowerCase(), row);
        }
      }

      const reportPrefixClauses = authorBindList
        .map(() => `LOWER(SUBSTR(package_id, 1, INSTR(package_id, '/') - 1)) = ?`)
        .join(' OR ');
      const d1RepRes = await env.DB.prepare(
        `SELECT package_id, reason FROM moderation_reports WHERE status = 'open' AND (${reportPrefixClauses})`
      ).bind(...authorBindList).all().catch(() => null);
      for (const rep of d1RepRes?.results || []) {
        if (rep?.package_id && rep.reason === 'broken') {
          openBrokenReportsByLowerId.add(String(rep.package_id).toLowerCase());
        }
      }
    }

    let alreadySyncedCount = 0;
    let pendingQueueCount = 0;
    let skippedNoRepoCount = 0;
    let brokenReportCount = 0;
    let conflictCount = 0;
    const packages: AuthorPackageSyncItem[] = [];

    for (const item of candidateItems) {
      const canonicalId = `${item.author}/${item.name}`;
      const lowerId = canonicalId.toLowerCase();
      const title = String(item.title || item.name);
      const existingD1 = existingD1ByLowerId.get(lowerId) || null;
      const existingOwnerId = existingD1?.author_id ? String(existingD1.author_id).trim() : '';

      if (
        existingOwnerId &&
        !existingOwnerId.startsWith('ext_') &&
        resolvedUserId &&
        existingOwnerId !== resolvedUserId
      ) {
        conflictCount++;
        packages.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'conflict',
          repoUrl: existingD1?.repo_url || item.repo
        });
        continue;
      }

      const existingProvider = String(existingD1?.provider || '').trim().toLowerCase();
      const existingTags = parseJsonArray(existingD1?.tags);
      const isAlreadyGitTracked = Boolean(
        existingD1 &&
        existingD1.repo_url &&
        ((existingProvider && existingProvider !== 'contentdb' && isGitProviderId(existingProvider)) ||
          existingTags.includes('git'))
      );

      if (isAlreadyGitTracked) {
        alreadySyncedCount++;
        packages.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'already_synced',
          provider: existingProvider || 'github',
          repoUrl: existingD1.repo_url
        });
        continue;
      }

      const rawRepo = item.repo || item.repo_url || existingD1?.repo_url || '';
      const classified = classifyCandidateGitRepoUrl(rawRepo);
      if (classified.kind === 'no_repo') {
        skippedNoRepoCount++;
        packages.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'skipped_no_repo'
        });
        continue;
      }
      if (classified.kind === 'non_git') {
        skippedNoRepoCount++;
        packages.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'skipped_non_git',
          repoUrl: rawRepo
        });
        continue;
      }

      if (openBrokenReportsByLowerId.has(lowerId)) {
        brokenReportCount++;
        packages.push({
          packageId: canonicalId,
          author: item.author,
          name: item.name,
          title,
          status: 'failed_broken',
          provider: classified.provider,
          repoUrl: classified.normalizedUrl
        });
        continue;
      }

      pendingQueueCount++;
      packages.push({
        packageId: canonicalId,
        author: item.author,
        name: item.name,
        title,
        status: 'queued',
        provider: classified.provider,
        repoUrl: classified.normalizedUrl
      });
    }

    return {
      isRegistered,
      userId: resolvedUserId,
      username: resolvedUsername,
      authorHandles: allAuthorHandles,
      totalContentDbPackages: candidateItems.length,
      alreadySyncedCount,
      pendingQueueCount,
      skippedNoRepoCount,
      brokenReportCount,
      conflictCount,
      packages
    };
  } catch {
    return emptyStatus;
  }
}

let isolateBackfillChecked = false;
const EXISTING_USERS_BACKFILL_CACHE_KEY =
  'https://cache.luantihub.internal/__existing_users_git_backfill_v2';

/**
 * Automatic catch-up for existing registered users in D1.
 * Uses `inspectAuthorGitSyncStatus` (0 Git network calls) to locate registered users
 * with `pendingQueueCount > 0`, processes 1 user batch per background invocation to stay
 * well within Cloudflare Workers' 50-subrequest limit, and only marks completion when
 * all registered users have `pendingQueueCount === 0`.
 */
export async function runOneTimeExistingUsersGitBackfill(
  env: {
    DB?: any;
    AI?: any;
    ADMIN_USERS?: string;
    SESSION_SECRET?: string;
  },
  forceRun = false
): Promise<{ completed: boolean; processedUsers: number; anyRemaining: boolean }> {
  if (!env?.DB || (isolateBackfillChecked && !forceRun)) {
    return { completed: false, processedUsers: 0, anyRemaining: false };
  }
  isolateBackfillChecked = true;

  try {
    const alreadyDone = await readEdgeCacheJson<{ completed: boolean }>(EXISTING_USERS_BACKFILL_CACHE_KEY);
    if (alreadyDone?.completed && !forceRun) {
      return { completed: true, processedUsers: 0, anyRemaining: false };
    }

    const verifiedUsersRes = await env.DB.prepare(
      `SELECT DISTINCT user_id FROM user_identities WHERE verified = 1
       UNION
       SELECT id AS user_id FROM users
       LIMIT 100`
    ).all().catch(() => null);
    const userIds = (verifiedUsersRes?.results || [])
      .map((r: any) => String(r?.user_id || '').trim())
      .filter(Boolean);

    let anyRemaining = false;
    let processedActiveBatch = false;
    let processedUsers = 0;

    for (const uid of userIds) {
      const status = await inspectAuthorGitSyncStatus(env, { userId: uid });
      if (status.pendingQueueCount <= 0) {
        continue;
      }
      if (!processedActiveBatch) {
        processedActiveBatch = true;
        processedUsers++;
        const res = await syncVerifiedAuthorGitPackages(env, {
          userId: uid,
          authorHandles: status.authorHandles,
          maxNewImports: 6
        });
        if (!res.success || res.remainingQueuedCount > 0) {
          anyRemaining = true;
        }
      } else {
        anyRemaining = true;
      }
    }

    if (!anyRemaining) {
      await writeEdgeCacheJson(EXISTING_USERS_BACKFILL_CACHE_KEY, { completed: true, ts: Date.now() }, 86400);
      return { completed: true, processedUsers, anyRemaining: false };
    } else {
      isolateBackfillChecked = false;
      return { completed: false, processedUsers, anyRemaining: true };
    }
  } catch {
    isolateBackfillChecked = false;
    return { completed: false, processedUsers: 0, anyRemaining: true };
  }
}

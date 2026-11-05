/**
 * Shared Pure Notification Evaluation Engine for LuantiHub
 * Used by both Angular (`PwaService`) and the Service Worker (`public/custom-sw.js` via `scripts/inject-sw-sync.mjs`).
 *
 * Enforces:
 * - Canonical package & stamp normalization (`release_id|updated_at|latest_commit_sha`)
 * - Strict monotonic version advancement (metadata backfills `"" -> value` never trigger notifications)
 * - Strict 12-hour recency window & baseline watermark guards (prevents yesterday's updates from notifying today)
 * - Unified 12-hour per-package update cooldown across foreground and background contexts
 * - Identical notification titles, bodies (including release/commit `relLabel`), deterministic tags, and timestamps
 * - Conflict-free state merging between `localStorage` and IndexedDB (`lh_pwa_notif_state_db`)
 */

export interface NotificationPrefsState {
  notificationsEnabled?: boolean;
  notifyAppUpdates?: boolean;
  notifyPackageUpdates?: boolean;
  notifyNewGitPackages?: boolean;
  notifyNewReviews?: boolean;
  notifyPromotions?: boolean;
  favorites?: string[];
  downloadedPackages?: Record<string, number>;
}

export interface NotificationPersistenceState {
  prefs?: NotificationPrefsState | null;
  seenTags?: string[];
  knownGitPackages?: string[] | null;
  knownPackageVersions?: Record<string, string> | null;
  seenPromotions?: string[];
  seenBlogPosts?: string[];
  seenReviews?: string[] | null;
  seenReviewIds?: string[] | null;
  packageUpdateCooldown?: Record<string, number>;
  packageUpdateCooldowns?: Record<string, number>;
  bootManifestSignature?: string;
  baselineSeededAt?: number;
  lastBootFetchAt?: number;
  unreadBadgeCount?: number;
}

export interface EvaluatedNotificationSpec {
  title: string;
  body: string;
  tag: string;
  category:
    | 'moderation'
    | 'admin_queue'
    | 'app_update'
    | 'new_git_package'
    | 'package_update'
    | 'new_review'
    | 'promotion';
  variant:
    | 'resolved'
    | 'dismissed'
    | 'moderation'
    | 'admin_queue'
    | 'app_update'
    | 'new_git_package'
    | 'package_update'
    | 'new_review'
    | 'promotion';
  icon?: string;
  image?: string;
  badge: string;
  timestamp: number;
  renotify: boolean;
  data: {
    targetTab?: 'moderation' | 'account' | 'packages' | 'promotions';
    packageId?: string;
    reportId?: string;
    ctaUrl?: string;
    action?: 'reload_update';
    signature?: string;
  };
}

// === BEGIN SHARED NOTIF ENGINE ===

export const NOTIFICATION_MAX_EVENT_AGE_MS = 12 * 3600 * 1000; // 12 hours max age for event notifications
export const NOTIFICATION_PACKAGE_COOLDOWN_MS = 12 * 3600 * 1000; // 12 hours per-package update cooldown
export const NOTIFICATION_BASELINE_SKEW_GRACE_MS = 15 * 60 * 1000; // 15 minutes grace for clock skew on newly seeded baselines
export const MIN_SW_BOOT_FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes minimum interval between SW boot catalog fetches

export function normalizeReleaseStampPart(rawRel: any): string {
  const trimmed = String(rawRel ?? '').trim();
  if (!trimmed || trimmed === '0') return '';
  const num = Number(trimmed);
  // Synthetic Unix epoch timestamps (>= 1_000_000_000, i.e. 10+ digits) are not sequential
  // ContentDB release IDs (~1..99_999_999); normalize them to '' so dual-source packages
  // never oscillate between a 5-digit ContentDB release ID and a 10-digit epoch timestamp.
  if (Number.isFinite(num) && num >= 1000000000) return '';
  return trimmed;
}

export function normalizeCommitShaPart(rawSha: any): string {
  const trimmed = String(rawSha ?? '').trim();
  if (!trimmed || trimmed === 'HEAD' || trimmed === 'latest') return '';
  return trimmed;
}

export function parseNotificationTimestampMs(rawIso: any): number | null {
  if (rawIso === undefined || rawIso === null) return null;
  const rawTrimmed = String(rawIso).trim();
  if (!rawTrimmed) return null;
  const normalizedIso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(rawTrimmed)
    ? `${rawTrimmed.replace(' ', 'T')}Z`
    : rawTrimmed;
  const ms = new Date(normalizedIso).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function computePackageVersionStamp(pkg: any): string {
  if (!pkg || typeof pkg !== 'object') return '||';
  const rel = normalizeReleaseStampPart(pkg.release_id ?? pkg.release ?? '');
  const upd = String(pkg.updated_at || '').trim();
  const sha = normalizeCommitShaPart(pkg.latest_commit_sha || pkg.commit_sha || '');
  return `${rel}|${upd}|${sha}`;
}

export function resolveCanonicalPackageIdentity(pkg: any): {
  author: string;
  name: string;
  resolvedId: string;
  lowerId: string;
} | null {
  if (!pkg || typeof pkg !== 'object') return null;
  const rawId = typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.trim() : '';
  const author = String(
    pkg.author || pkg.author_name || (rawId ? rawId.split('/')[0] : '') || ''
  ).trim();
  const name = String(pkg.name || (rawId ? rawId.split('/')[1] : '') || '').trim();
  if (!author || !name) return null;
  const resolvedId = rawId || `${author}/${name}`;
  return {
    author,
    name,
    resolvedId,
    lowerId: resolvedId.toLowerCase()
  };
}

/**
 * Deduplicates and merges raw or normalized package candidates by canonical `author/name` ID
 * so Angular and the Service Worker evaluate identical package stamps.
 */
export function deduplicateNotificationPackageCandidates(candidates: any[]): any[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const byId = new Map<string, any>();

  for (const pkg of candidates) {
    if (!pkg || pkg.status === 'delisted' || pkg.status === 'flagged') continue;
    const idInfo = resolveCanonicalPackageIdentity(pkg);
    if (!idInfo) continue;

    const existing = byId.get(idInfo.lowerId);
    if (!existing) {
      byId.set(idInfo.lowerId, Object.assign({}, pkg, { id: idInfo.resolvedId, author: idInfo.author, name: idInfo.name }));
      continue;
    }

    const prevRel = normalizeReleaseStampPart(existing.release_id ?? existing.release ?? '');
    const nextRel = normalizeReleaseStampPart(pkg.release_id ?? pkg.release ?? '');
    const prevRelNum = Number(prevRel);
    const nextRelNum = Number(nextRel);
    const chosenRel =
      prevRel && nextRel
        ? Number.isFinite(prevRelNum) && Number.isFinite(nextRelNum)
          ? Math.max(prevRelNum, nextRelNum)
          : nextRel
        : nextRel || prevRel;

    const prevUpdMs = parseNotificationTimestampMs(existing.updated_at) || 0;
    const nextUpdMs = parseNotificationTimestampMs(pkg.updated_at) || 0;
    const chosenUpd =
      nextUpdMs > prevUpdMs
        ? pkg.updated_at
        : existing.updated_at || pkg.updated_at;

    const prevCreatedMs = parseNotificationTimestampMs(existing.created_at) || 0;
    const nextCreatedMs = parseNotificationTimestampMs(pkg.created_at) || 0;
    const chosenCreated =
      nextCreatedMs > prevCreatedMs
        ? pkg.created_at
        : existing.created_at || pkg.created_at;

    const chosenSha =
      normalizeCommitShaPart(pkg.latest_commit_sha || pkg.commit_sha) ||
      normalizeCommitShaPart(existing.latest_commit_sha || existing.commit_sha);

    const existingSources = Array.isArray(existing.sources)
      ? existing.sources
      : existing.source
        ? [existing.source]
        : [];
    const nextSources = Array.isArray(pkg.sources)
      ? pkg.sources
      : pkg.source
        ? [pkg.source]
        : [];
    const mergedSources = Array.from(new Set([...existingSources, ...nextSources]));

    byId.set(
      idInfo.lowerId,
      Object.assign({}, existing, pkg, {
        id: existing.id || idInfo.resolvedId,
        author: existing.author || idInfo.author,
        name: existing.name || idInfo.name,
        release_id: chosenRel || existing.release_id || pkg.release_id,
        updated_at: chosenUpd,
        created_at: chosenCreated,
        latest_commit_sha: chosenSha || undefined,
        banner: existing.banner || pkg.banner || existing.banner_url || pkg.banner_url,
        thumbnail: existing.thumbnail || pkg.thumbnail || existing.thumbnail_url || pkg.thumbnail_url,
        sources: mergedSources.length > 0 ? mergedSources : undefined
      })
    );
  }

  return Array.from(byId.values());
}

/**
 * Merges two `rel|upd|sha` stamps for the same package, preserving non-empty fields
 * so unhydrated catalog polls never wipe out previously hydrated `release_id`, `updated_at`, or `latest_commit_sha`.
 */
export function mergePackageVersionStamps(
  prevStamp: string | undefined,
  newStamp: string,
  preferNewOnConflict = true
): string {
  if (!prevStamp) return newStamp;
  if (prevStamp === newStamp) return newStamp;

  const [rawPrevRel = '', rawPrevUpd = '', rawPrevSha = ''] = String(prevStamp).split('|');
  const [rawNewRel = '', rawNewUpd = '', rawNewSha = ''] = String(newStamp).split('|');

  const prevRel = normalizeReleaseStampPart(rawPrevRel);
  const newRel = normalizeReleaseStampPart(rawNewRel);
  const prevUpd = String(rawPrevUpd).trim();
  const newUpd = String(rawNewUpd).trim();
  const prevSha = normalizeCommitShaPart(rawPrevSha);
  const newSha = normalizeCommitShaPart(rawNewSha);

  let mergedRel = newRel || prevRel;
  if (prevRel && newRel && prevRel !== newRel) {
    const pNum = Number(prevRel);
    const nNum = Number(newRel);
    if (Number.isFinite(pNum) && Number.isFinite(nNum)) {
      mergedRel = String(Math.max(pNum, nNum));
    } else {
      mergedRel = preferNewOnConflict ? newRel : prevRel;
    }
  }

  let mergedUpd = newUpd || prevUpd;
  if (prevUpd && newUpd && prevUpd !== newUpd) {
    const pMs = parseNotificationTimestampMs(prevUpd) || 0;
    const nMs = parseNotificationTimestampMs(newUpd) || 0;
    if (pMs > 0 && nMs > 0) {
      mergedUpd = nMs >= pMs ? newUpd : prevUpd;
    } else {
      mergedUpd = preferNewOnConflict ? newUpd : prevUpd;
    }
  }

  let mergedSha = newSha || prevSha;
  if (prevSha && newSha && prevSha !== newSha) {
    const isHex = (s: string) => /^[0-9a-f]{7,40}$/i.test(s);
    if (isHex(newSha) && !isHex(prevSha)) {
      mergedSha = newSha;
    } else if (isHex(prevSha) && !isHex(newSha)) {
      mergedSha = prevSha;
    } else {
      mergedSha = preferNewOnConflict ? newSha : prevSha;
    }
  }

  return `${mergedRel}|${mergedUpd}|${mergedSha}`;
}

/**
 * Determines whether a package's version stamp strictly and genuinely advanced,
 * while classifying metadata backfills (`"" -> value`) and representation switches as non-notifying.
 */
export function evaluatePackageStampAdvancement(
  prevStamp: string,
  newStamp: string,
  options?: {
    isForced?: boolean;
    nowMs?: number;
    maxAgeMs?: number;
    baselineSeededAt?: number;
  }
): {
  genuinelyAdvanced: boolean;
  isRecent: boolean;
  mergedStamp: string;
  eventTimestampMs: number;
} {
  const nowMs = options?.nowMs ?? Date.now();
  const maxAgeMs = options?.maxAgeMs ?? NOTIFICATION_MAX_EVENT_AGE_MS;
  const isForced = Boolean(options?.isForced);
  const baselineSeededAt = Number(options?.baselineSeededAt || 0);

  const [rawPrevRel = '', rawPrevUpd = '', rawPrevSha = ''] = String(prevStamp || '').split('|');
  const [rawNewRel = '', rawNewUpd = '', rawNewSha = ''] = String(newStamp || '').split('|');

  const prevRel = normalizeReleaseStampPart(rawPrevRel);
  const newRel = normalizeReleaseStampPart(rawNewRel);
  const prevUpd = String(rawPrevUpd).trim();
  const newUpd = String(rawNewUpd).trim();
  const prevSha = normalizeCommitShaPart(rawPrevSha);
  const newSha = normalizeCommitShaPart(rawNewSha);

  const prevRelNum = Number(prevRel);
  const newRelNum = Number(newRel);
  const isHexSha = (s: string) => /^[0-9a-f]{7,40}$/i.test(s);

  let genuinelyAdvanced = isForced;

  if (!genuinelyAdvanced && prevStamp !== newStamp) {
    const hasPrevSha = Boolean(prevSha);
    const hasNewSha = Boolean(newSha);

    if (hasPrevSha && hasNewSha) {
      if (prevSha.toLowerCase() === newSha.toLowerCase()) {
        // Same concrete commit SHA: only advance if both stamps have sequential ContentDB release IDs and newRel > prevRel
        if (
          prevRel &&
          newRel &&
          prevRel !== newRel &&
          Number.isFinite(prevRelNum) &&
          Number.isFinite(newRelNum) &&
          prevRelNum > 0 &&
          newRelNum > 0 &&
          newRelNum > prevRelNum
        ) {
          genuinelyAdvanced = true;
        }
      } else if (isHexSha(prevSha) === isHexSha(newSha)) {
        // Both have concrete SHAs of the same representation (e.g. both hex SHAs) and they differ.
        // Require either release ID to strictly advance OR timestamp to strictly advance (when both timestamps are present).
        const relMovedBackwards =
          Boolean(prevRel && newRel) &&
          Number.isFinite(prevRelNum) &&
          Number.isFinite(newRelNum) &&
          newRelNum < prevRelNum;
        const relStrictlyAdvanced =
          Boolean(prevRel && newRel) &&
          Number.isFinite(prevRelNum) &&
          Number.isFinite(newRelNum) &&
          prevRelNum > 0 &&
          newRelNum > 0 &&
          newRelNum > prevRelNum;
        const prevMs = parseNotificationTimestampMs(prevUpd);
        const newMs = parseNotificationTimestampMs(newUpd);
        const timeDidNotAdvance = prevMs !== null && newMs !== null && newMs <= prevMs;
        if (!relMovedBackwards && (relStrictlyAdvanced || !timeDidNotAdvance)) {
          genuinelyAdvanced = true;
        }
      }
    } else if (prevRel && newRel && !hasPrevSha && !hasNewSha) {
      // Pure release-tracked package (or neither stamp had a commit SHA):
      // Only notify when both stamps already had a release identifier and the new release strictly advanced.
      if (prevRel !== newRel) {
        const prevIsNumeric = Number.isFinite(prevRelNum) && prevRelNum > 0;
        const newIsNumeric = Number.isFinite(newRelNum) && newRelNum > 0;
        if (prevIsNumeric && newIsNumeric) {
          genuinelyAdvanced = newRelNum > prevRelNum;
        } else if (!prevIsNumeric && !newIsNumeric) {
          genuinelyAdvanced = true;
        }
      }
    } else if (prevRel && newRel && prevRel !== newRel) {
      // One stamp had a SHA and the other didn't, but BOTH had numeric ContentDB release IDs and release_id strictly increased
      if (
        Number.isFinite(prevRelNum) &&
        Number.isFinite(newRelNum) &&
        prevRelNum > 0 &&
        newRelNum > 0 &&
        newRelNum > prevRelNum
      ) {
        genuinelyAdvanced = true;
      }
    } else if (!prevRel && !newRel && !hasPrevSha && !hasNewSha && prevUpd && newUpd && prevUpd !== newUpd) {
      // Pure timestamp-tracked package (no release ID and no commit SHA on either stamp):
      // Require both timestamps to be valid and strictly advancing.
      const prevMs = parseNotificationTimestampMs(prevUpd);
      const newMs = parseNotificationTimestampMs(newUpd);
      if (prevMs !== null && newMs !== null && newMs > prevMs) {
        genuinelyAdvanced = true;
      }
    }
  }

  const newUpdMs = parseNotificationTimestampMs(newUpd);
  let isRecent = false;
  if (isForced) {
    isRecent = true;
  } else if (newUpdMs !== null) {
    const withinMaxAge = nowMs - newUpdMs <= maxAgeMs;
    const afterBaseline =
      baselineSeededAt <= 0 || newUpdMs >= baselineSeededAt - NOTIFICATION_BASELINE_SKEW_GRACE_MS;
    isRecent = withinMaxAge && afterBaseline;
  } else if (!newUpd && prevRel && newRel && !prevSha && !newSha) {
    isRecent = true;
  }

  const mergedStamp = mergePackageVersionStamps(prevStamp, newStamp, genuinelyAdvanced);

  return {
    genuinelyAdvanced,
    isRecent,
    mergedStamp,
    eventTimestampMs: newUpdMs ?? nowMs
  };
}

export function buildPackageUpdateNotificationSpec(
  pkg: any,
  resolvedId: string,
  stamp: string,
  eventTimestampMs?: number
): EvaluatedNotificationSpec {
  const idInfo = resolveCanonicalPackageIdentity(pkg) || {
    author: String(pkg?.author || pkg?.author_name || resolvedId.split('/')[0] || 'Creator'),
    name: String(pkg?.name || resolvedId.split('/')[1] || resolvedId),
    resolvedId,
    lowerId: resolvedId.toLowerCase()
  };
  const typeLabel = String(pkg?.type || 'mod').toUpperCase();
  const displayTitle = pkg?.title || idInfo.name;
  const thumb =
    pkg?.banner || pkg?.banner_url || pkg?.thumbnail || pkg?.thumbnail_url || undefined;
  const rawCommitSha = normalizeCommitShaPart(pkg?.latest_commit_sha || pkg?.commit_sha || '');
  const shortCommitLabel = /^[0-9a-f]{7,40}$/i.test(rawCommitSha) ? rawCommitSha.slice(0, 7) : '';
  const cleanRel = normalizeReleaseStampPart(pkg?.release_id ?? pkg?.release ?? '');
  const relLabel = pkg?.release_title
    ? ` (${pkg.release_title})`
    : shortCommitLabel
      ? ` (${shortCommitLabel})`
      : cleanRel
        ? ` (#${cleanRel})`
        : '';

  return {
    title: `Package Updated · [${typeLabel}] ${displayTitle}`,
    body: `by ${idInfo.author}${relLabel} — ${pkg?.short_desc || 'New release available on LuantiHub.'}`,
    icon: thumb,
    image: thumb,
    badge: '/icons/icon-72x72.png',
    tag: `lh-pkg-update-${idInfo.lowerId}-${stamp}`,
    category: 'package_update',
    variant: 'package_update',
    timestamp: eventTimestampMs || parseNotificationTimestampMs(pkg?.updated_at) || Date.now(),
    renotify: false,
    data: {
      packageId: idInfo.resolvedId
    }
  };
}

export function buildNewGitPackageNotificationSpec(
  pkg: any,
  resolvedId: string,
  eventTimestampMs?: number
): EvaluatedNotificationSpec {
  const idInfo = resolveCanonicalPackageIdentity(pkg) || {
    author: String(pkg?.author || pkg?.author_name || resolvedId.split('/')[0] || 'Creator'),
    name: String(pkg?.name || resolvedId.split('/')[1] || resolvedId),
    resolvedId,
    lowerId: resolvedId.toLowerCase()
  };
  const typeLabel = String(pkg?.type || 'mod').toUpperCase();
  const displayTitle = pkg?.title || idInfo.name;
  const thumb =
    pkg?.banner || pkg?.banner_url || pkg?.thumbnail || pkg?.thumbnail_url || undefined;
  const isOfficial = Array.isArray(pkg?.sources)
    ? pkg.sources.includes('official')
    : pkg?.source === 'official';
  const isGit = Array.isArray(pkg?.sources)
    ? pkg.sources.includes('git')
    : pkg?.source === 'git';
  const isContentDbOnly = isOfficial && !isGit;
  const titlePrefix = isContentDbOnly ? 'New Package' : 'New Git Package';
  const defaultDesc = isContentDbOnly
    ? 'New package published on LuantiHub.'
    : 'New community Git repository published on LuantiHub.';

  return {
    title: `${titlePrefix} · [${typeLabel}] ${displayTitle}`,
    body: `by ${idInfo.author} — ${pkg?.short_desc || defaultDesc}`,
    icon: thumb,
    image: thumb,
    badge: '/icons/icon-72x72.png',
    tag: `lh-new-git-pkg-${idInfo.lowerId}`,
    category: 'new_git_package',
    variant: 'new_git_package',
    timestamp:
      eventTimestampMs ||
      parseNotificationTimestampMs(pkg?.created_at || pkg?.updated_at) ||
      Date.now(),
    renotify: false,
    data: {
      packageId: idInfo.resolvedId
    }
  };
}

export function resolveReviewPackageId(rev: any): string {
  return String(
    rev?.package_id ||
      rev?.packageId ||
      (rev?.package?.author && rev?.package?.name ? `${rev.package.author}/${rev.package.name}` : '') ||
      ''
  ).trim();
}

export function resolveReviewCleanId(rev: any): string {
  if (rev?.id !== undefined && rev?.id !== null && String(rev.id).trim() !== '') {
    return String(rev.id).trim().replace(/^lh_/i, '');
  }
  if (rev?.thread?.id !== undefined && rev?.thread?.id !== null && String(rev.thread.id).trim() !== '') {
    return `cdb_${String(rev.thread.id).trim()}`;
  }
  const pkgId = resolveReviewPackageId(rev);
  const uname = String(
    rev?.reviewer_username || rev?.username || rev?.user?.username || rev?.author?.username || ''
  ).trim();
  const created = String(rev?.created_at || rev?.createdAt || '').trim();
  if (pkgId && uname && created) {
    return `cdb_${pkgId.toLowerCase()}_${uname}_${created}`;
  }
  return '';
}

export function buildReviewNotificationSpec(rev: any): EvaluatedNotificationSpec | null {
  const cleanId = resolveReviewCleanId(rev);
  const pkgId = resolveReviewPackageId(rev);
  if (!cleanId || !pkgId) return null;

  const pkgTitle = String(
    rev?.package_title || rev?.packageTitle || rev?.package?.title || pkgId.split('/')[1] || pkgId
  ).trim();
  const rawRating = Number(
    rev?.rating ?? (rev?.is_positive === false || rev?.recommends === false ? 1 : 5)
  );
  const rating = Math.max(1, Math.min(5, Number.isFinite(rawRating) ? Math.round(rawRating) : 5));
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const reviewer =
    String(
      rev?.reviewer_username ||
        rev?.username ||
        rev?.user?.username ||
        rev?.author?.username ||
        rev?.reviewer_display_name ||
        rev?.display_name ||
        rev?.user?.display_name ||
        rev?.author?.display_name ||
        'community'
    ).trim() || 'community';
  const rawComment = String(rev?.comment || rev?.title || '').replace(/\s+/g, ' ').trim();
  const excerpt =
    rawComment.length > 90
      ? `${rawComment.slice(0, 87)}...`
      : rawComment || 'New community review posted on LuantiHub.';
  const thumb =
    rev?.package_thumbnail || rev?.packageThumbnail || rev?.package?.thumbnail || undefined;
  const createdMs = parseNotificationTimestampMs(rev?.created_at || rev?.createdAt) || Date.now();

  return {
    title: `New Review · ${stars} ${pkgTitle}`,
    body: `by @${reviewer} — "${excerpt}"`,
    icon: thumb,
    image: thumb,
    badge: '/icons/icon-72x72.png',
    tag: `lh-review-${cleanId}`,
    category: 'new_review',
    variant: 'new_review',
    timestamp: createdMs,
    renotify: false,
    data: {
      packageId: pkgId
    }
  };
}

/**
 * Merges two notification persistence states (e.g. `localStorage` and Service Worker `IndexedDB`)
 * using set unions and monotonic package stamp merging so neither context ever clobbers the other.
 */
export function mergeNotificationPersistenceStates(
  localState: NotificationPersistenceState,
  remoteState: NotificationPersistenceState
): NotificationPersistenceState {
  const unionStrings = (a: any, b: any, limit: number, lower = false): string[] => {
    const listA = Array.isArray(a) ? a : [];
    const listB = Array.isArray(b) ? b : [];
    const set = new Set<string>();
    for (const item of [...listA, ...listB]) {
      if (typeof item === 'string' && item.trim()) {
        const clean = lower ? item.trim().toLowerCase() : item.trim();
        set.add(clean);
      }
    }
    return Array.from(set).slice(-limit);
  };

  const seenTags = unionStrings(localState.seenTags, remoteState.seenTags, 300);
  const seenPromotions = unionStrings(localState.seenPromotions, remoteState.seenPromotions, 100);
  const seenBlogPosts = unionStrings(localState.seenBlogPosts, remoteState.seenBlogPosts, 100);

  const localReviews = localState.seenReviews ?? localState.seenReviewIds;
  const remoteReviews = remoteState.seenReviewIds ?? remoteState.seenReviews;
  const hasAnyReviews = Array.isArray(localReviews) || Array.isArray(remoteReviews);
  const mergedReviews = hasAnyReviews
    ? unionStrings(
        (Array.isArray(localReviews) ? localReviews : []).map((id: any) =>
          String(id || '').replace(/^lh_/i, '')
        ),
        (Array.isArray(remoteReviews) ? remoteReviews : []).map((id: any) =>
          String(id || '').replace(/^lh_/i, '')
        ),
        500
      )
    : null;

  const hasAnyGit =
    Array.isArray(localState.knownGitPackages) || Array.isArray(remoteState.knownGitPackages);
  const knownGitPackages = hasAnyGit
    ? unionStrings(localState.knownGitPackages, remoteState.knownGitPackages, 10000, true)
    : null;

  const localVersions =
    localState.knownPackageVersions &&
    typeof localState.knownPackageVersions === 'object' &&
    !Array.isArray(localState.knownPackageVersions)
      ? localState.knownPackageVersions
      : null;
  const remoteVersions =
    remoteState.knownPackageVersions &&
    typeof remoteState.knownPackageVersions === 'object' &&
    !Array.isArray(remoteState.knownPackageVersions)
      ? remoteState.knownPackageVersions
      : null;

  let knownPackageVersions: Record<string, string> | null = null;
  if (localVersions || remoteVersions) {
    const mergedMap: Record<string, string> = {};
    const allKeys = new Set([
      ...Object.keys(localVersions || {}),
      ...Object.keys(remoteVersions || {})
    ]);
    for (const rawKey of allKeys) {
      const key = rawKey.toLowerCase();
      const lStamp = localVersions ? localVersions[rawKey] ?? localVersions[key] : undefined;
      const rStamp = remoteVersions ? remoteVersions[rawKey] ?? remoteVersions[key] : undefined;
      if (lStamp && rStamp) {
        mergedMap[key] = mergePackageVersionStamps(lStamp, rStamp, true);
      } else if (rStamp) {
        mergedMap[key] = rStamp;
      } else if (lStamp) {
        mergedMap[key] = lStamp;
      }
    }
    const entries = Object.entries(mergedMap);
    knownPackageVersions =
      entries.length > 10000 ? Object.fromEntries(entries.slice(-10000)) : mergedMap;
  }

  const localCooldown =
    localState.packageUpdateCooldown || localState.packageUpdateCooldowns || {};
  const remoteCooldown =
    remoteState.packageUpdateCooldowns || remoteState.packageUpdateCooldown || {};
  const mergedCooldown: Record<string, number> = {};
  for (const key of new Set([...Object.keys(localCooldown), ...Object.keys(remoteCooldown)])) {
    const lowerKey = key.toLowerCase();
    const lTs = Number(localCooldown[key] || 0);
    const rTs = Number(remoteCooldown[key] || 0);
    const maxTs = Math.max(Number.isFinite(lTs) ? lTs : 0, Number.isFinite(rTs) ? rTs : 0);
    if (maxTs > 0) {
      mergedCooldown[lowerKey] = maxTs;
    }
  }

  const lSeed = Number(localState.baselineSeededAt || 0);
  const rSeed = Number(remoteState.baselineSeededAt || 0);
  const baselineSeededAt =
    lSeed > 0 && rSeed > 0 ? Math.min(lSeed, rSeed) : Math.max(lSeed, rSeed, 0);

  const lastBootFetchAt = Math.max(
    Number(localState.lastBootFetchAt || 0),
    Number(remoteState.lastBootFetchAt || 0)
  );

  return {
    prefs: localState.prefs || remoteState.prefs || null,
    seenTags,
    knownGitPackages,
    knownPackageVersions,
    seenPromotions,
    seenBlogPosts,
    seenReviews: mergedReviews,
    seenReviewIds: mergedReviews,
    packageUpdateCooldown: mergedCooldown,
    packageUpdateCooldowns: mergedCooldown,
    bootManifestSignature:
      localState.bootManifestSignature || remoteState.bootManifestSignature || '',
    baselineSeededAt,
    lastBootFetchAt
  };
}

/**
 * Evaluates an entire `/api/packages/?boot=1` payload against the persisted notification state
 * (used by the Service Worker in `public/custom-sw.js` and testable directly in unit tests).
 */
export function evaluateCatalogNotificationsBatch(
  bootPayload: any,
  state: NotificationPersistenceState,
  nowMs = Date.now()
): {
  notifications: EvaluatedNotificationSpec[];
  stateUpdates: Partial<NotificationPersistenceState>;
} {
  const notifications: EvaluatedNotificationSpec[] = [];
  const stateUpdates: Partial<NotificationPersistenceState> = {};
  const prefs = state?.prefs && typeof state.prefs === 'object' ? state.prefs : null;
  if (!prefs || !prefs.notificationsEnabled) {
    return { notifications, stateUpdates };
  }

  const rawPackages = Array.isArray(bootPayload?.packages) ? bootPayload.packages : [];
  const rawRecentlyAdded = Array.isArray(bootPayload?.recentlyAdded) ? bootPayload.recentlyAdded : [];
  const packages = deduplicateNotificationPackageCandidates([...rawPackages, ...rawRecentlyAdded]);
  const baselineSeededAt = Number(state?.baselineSeededAt || 0);

  // 1. Evaluate New Packages (both ContentDB and Community Git packages)
  if (prefs.notifyNewGitPackages && Array.isArray(state.knownGitPackages)) {
    const knownGitSet = new Set(state.knownGitPackages.map((id: any) => String(id).toLowerCase()));
    let gitChanged = false;
    if (!knownGitSet.has('__cdb_seeded_v1__')) {
      const existingVersionKeys =
        state.knownPackageVersions &&
        typeof state.knownPackageVersions === 'object' &&
        !Array.isArray(state.knownPackageVersions)
          ? Object.keys(state.knownPackageVersions)
              .map(k => k.toLowerCase())
              .filter(Boolean)
          : [];
      if (existingVersionKeys.length > 0) {
        for (const k of existingVersionKeys) {
          knownGitSet.add(k);
        }
        knownGitSet.add('__cdb_seeded_v1__');
        gitChanged = true;
      }
    }
    const newlyDiscoveredGit: Array<{ pkg: any; resolvedId: string; eventTimestampMs: number }> = [];

    for (const pkg of packages) {
      const idInfo = resolveCanonicalPackageIdentity(pkg);
      if (!idInfo) continue;

      if (!knownGitSet.has(idInfo.lowerId)) {
        const isOfficial = Array.isArray(pkg.sources)
          ? pkg.sources.includes('official')
          : pkg.source === 'official';
        const isGit = Array.isArray(pkg.sources)
          ? pkg.sources.includes('git')
          : pkg.source === 'git';
        if (isOfficial && !isGit && !pkg.created_at) {
          // Wait until `recentlyAdded` or detail hydration provides `created_at` before marking a new ContentDB package as known
          continue;
        }
        knownGitSet.add(idInfo.lowerId);
        gitChanged = true;
        const isDualSource = isOfficial && isGit;
        const timeMs = isOfficial
          ? parseNotificationTimestampMs(pkg.created_at)
          : parseNotificationTimestampMs(pkg.created_at || pkg.updated_at);
        const isRecent =
          timeMs !== null
            ? nowMs - timeMs <= NOTIFICATION_MAX_EVENT_AGE_MS &&
              (baselineSeededAt <= 0 || timeMs >= baselineSeededAt - NOTIFICATION_BASELINE_SKEW_GRACE_MS)
            : false;
        if (!isDualSource && isRecent) {
          newlyDiscoveredGit.push({
            pkg,
            resolvedId: idInfo.resolvedId,
            eventTimestampMs: timeMs || nowMs
          });
        }
      }
    }

    if (gitChanged) {
      if (knownGitSet.has('__cdb_seeded_v1__')) {
        knownGitSet.delete('__cdb_seeded_v1__');
        knownGitSet.add('__cdb_seeded_v1__');
      }
      stateUpdates.knownGitPackages = Array.from(knownGitSet).slice(-10000);
    }

    for (const item of newlyDiscoveredGit.slice(0, 3)) {
      notifications.push(
        buildNewGitPackageNotificationSpec(item.pkg, item.resolvedId, item.eventTimestampMs)
      );
    }
  }

  // 2. Evaluate Package Updates
  if (
    prefs.notifyPackageUpdates &&
    state.knownPackageVersions &&
    typeof state.knownPackageVersions === 'object' &&
    Object.keys(state.knownPackageVersions).length > 0
  ) {
    const knownMap: Record<string, string> = Object.assign({}, state.knownPackageVersions);
    const cooldownMap: Record<string, number> = Object.assign(
      {},
      state.packageUpdateCooldowns || state.packageUpdateCooldown || {}
    );
    let mapChanged = false;
    let cooldownChanged = false;
    const updatedList: Array<{
      pkg: any;
      resolvedId: string;
      lowerId: string;
      stamp: string;
      eventTimestampMs: number;
    }> = [];

    for (const pkg of packages) {
      const idInfo = resolveCanonicalPackageIdentity(pkg);
      if (!idInfo) continue;
      const newStamp = computePackageVersionStamp(pkg);
      const prevStamp = knownMap[idInfo.lowerId];

      if (prevStamp === undefined) {
        knownMap[idInfo.lowerId] = newStamp;
        mapChanged = true;
        continue;
      }

      if (prevStamp !== newStamp) {
        const evalRes = evaluatePackageStampAdvancement(prevStamp, newStamp, {
          isForced: false,
          nowMs,
          maxAgeMs: NOTIFICATION_MAX_EVENT_AGE_MS,
          baselineSeededAt
        });

        if (knownMap[idInfo.lowerId] !== evalRes.mergedStamp) {
          knownMap[idInfo.lowerId] = evalRes.mergedStamp;
          mapChanged = true;
        }

        const lastNotifiedAt = Number(cooldownMap[idInfo.lowerId] || 0);
        const withinCooldown =
          lastNotifiedAt > 0 && nowMs - lastNotifiedAt < NOTIFICATION_PACKAGE_COOLDOWN_MS;

        if (evalRes.genuinelyAdvanced && evalRes.isRecent && !withinCooldown) {
          updatedList.push({
            pkg,
            resolvedId: idInfo.resolvedId,
            lowerId: idInfo.lowerId,
            stamp: evalRes.mergedStamp,
            eventTimestampMs: evalRes.eventTimestampMs
          });
        }
      }
    }

    if (mapChanged) {
      const entries = Object.entries(knownMap);
      stateUpdates.knownPackageVersions =
        entries.length > 10000 ? Object.fromEntries(entries.slice(-10000)) : knownMap;
    }

    const favSet = new Set(
      (Array.isArray(prefs.favorites) ? prefs.favorites : []).map((f: any) => String(f).toLowerCase())
    );
    const dlMap =
      prefs.downloadedPackages && typeof prefs.downloadedPackages === 'object'
        ? prefs.downloadedPackages
        : {};
    updatedList.sort((a, b) => {
      const aPriority = (favSet.has(a.lowerId) ? 2 : 0) + ((dlMap[a.lowerId] || 0) > 0 ? 1 : 0);
      const bPriority = (favSet.has(b.lowerId) ? 2 : 0) + ((dlMap[b.lowerId] || 0) > 0 ? 1 : 0);
      return bPriority - aPriority;
    });

    for (const item of updatedList.slice(0, 3)) {
      cooldownMap[item.lowerId] = nowMs;
      cooldownChanged = true;
      notifications.push(
        buildPackageUpdateNotificationSpec(
          item.pkg,
          item.resolvedId,
          item.stamp,
          item.eventTimestampMs
        )
      );
    }

    if (cooldownChanged) {
      const entries = Object.entries(cooldownMap);
      const trimmed =
        entries.length > 2000 ? Object.fromEntries(entries.slice(-2000)) : cooldownMap;
      stateUpdates.packageUpdateCooldown = trimmed;
      stateUpdates.packageUpdateCooldowns = trimmed;
    }
  }

  // 3. Evaluate Active Promotions
  const promotions = Array.isArray(bootPayload?.promotions) ? bootPayload.promotions : [];
  if (prefs.notifyPromotions && promotions.length > 0 && Array.isArray(state.seenPromotions)) {
    const seenPromoSet = new Set(state.seenPromotions.map((id: any) => String(id).trim()));
    let promoChanged = false;
    let firedPromos = 0;

    for (const promo of promotions) {
      if (!promo || !promo.id || !promo.title || !promo.expires_at) continue;
      const expMs = Date.parse(String(promo.expires_at));
      if (!Number.isFinite(expMs) || expMs <= nowMs) continue;
      if (promo.starts_at) {
        const startMs = Date.parse(String(promo.starts_at));
        if (Number.isFinite(startMs) && startMs > nowMs) continue;
      }
      const id = String(promo.id).trim();
      if (!seenPromoSet.has(id)) {
        seenPromoSet.add(id);
        promoChanged = true;
        if (firedPromos < 2) {
          firedPromos++;
          const badge = String(promo.badge_text || 'PROMOTED').trim();
          notifications.push({
            title: `${badge} · ${promo.title}`,
            body: promo.short_desc || 'Check out the featured promotion on LuantiHub.',
            icon: promo.banner_url || '/icons/notif-new-package.png',
            image: promo.banner_url || undefined,
            badge: '/icons/icon-72x72.png',
            tag: `lh-promo-${id}`,
            category: 'promotion',
            variant: 'promotion',
            timestamp: nowMs,
            renotify: false,
            data: { ctaUrl: promo.cta_url }
          });
        }
      }
    }
    if (promoChanged) {
      stateUpdates.seenPromotions = Array.from(seenPromoSet).slice(-100);
    }
  }

  // 4. Evaluate Latest Luanti Blog Post
  const blogPost = bootPayload?.latestBlogPost;
  if (
    prefs.notifyPromotions &&
    blogPost &&
    blogPost.title &&
    blogPost.url &&
    Array.isArray(state.seenBlogPosts)
  ) {
    const seenBlogSet = new Set(state.seenBlogPosts.map((u: any) => String(u).trim()));
    const postKey = String(blogPost.id || blogPost.url || blogPost.title).trim();
    if (postKey && !seenBlogSet.has(postKey)) {
      seenBlogSet.add(postKey);
      stateUpdates.seenBlogPosts = Array.from(seenBlogSet).slice(-100);
      const validImageUrl =
        blogPost.image_url && blogPost.image_url !== '/promo.png' ? blogPost.image_url : undefined;
      notifications.push({
        title: `Luanti Blog · ${blogPost.title}`,
        body: blogPost.summary || 'New official article published on blog.luanti.org.',
        icon: validImageUrl || '/icons/notif-new-package.png',
        image: validImageUrl,
        badge: '/icons/icon-72x72.png',
        tag: `lh-blog-${postKey}`,
        category: 'promotion',
        variant: 'promotion',
        timestamp: parseNotificationTimestampMs(blogPost.published_at) || nowMs,
        renotify: false,
        data: { ctaUrl: blogPost.url }
      });
    }
  }

  // 5. Evaluate New Community Reviews
  const recentReviews = Array.isArray(bootPayload?.recentReviews) ? bootPayload.recentReviews : [];
  const rawSeenReviews = state.seenReviewIds ?? state.seenReviews;
  if (prefs.notifyNewReviews && recentReviews.length > 0 && Array.isArray(rawSeenReviews)) {
    const seenRevSet = new Set(
      rawSeenReviews.map((id: any) => String(id || '').trim().replace(/^lh_/i, '')).filter(Boolean)
    );
    let revChanged = false;
    const newRevs: any[] = [];

    for (const rev of recentReviews) {
      const cleanId = resolveReviewCleanId(rev);
      const pkgId = resolveReviewPackageId(rev);
      if (!cleanId || !pkgId) continue;

      const createdMs = parseNotificationTimestampMs(rev?.created_at || rev?.createdAt);
      const isRecent =
        createdMs !== null
          ? nowMs - createdMs <= NOTIFICATION_MAX_EVENT_AGE_MS &&
            (baselineSeededAt <= 0 || createdMs >= baselineSeededAt - NOTIFICATION_BASELINE_SKEW_GRACE_MS)
          : false;

      if (!seenRevSet.has(cleanId)) {
        seenRevSet.add(cleanId);
        revChanged = true;
        if (isRecent) {
          newRevs.push(rev);
        }
      }
    }

    if (revChanged) {
      const updatedRevList = Array.from(seenRevSet).slice(-500);
      stateUpdates.seenReviews = updatedRevList;
      stateUpdates.seenReviewIds = updatedRevList;
    }

    for (const rev of newRevs.slice(0, 3)) {
      const spec = buildReviewNotificationSpec(rev);
      if (spec) {
        notifications.push(spec);
      }
    }
  }

  return { notifications, stateUpdates };
}

// === END SHARED NOTIF ENGINE ===

/**
 * LuantiHub Service Worker Extension:
 * - W3C Background Sync (`sync`)
 * - W3C Periodic Background Sync (`periodicsync`)
 * - W3C Push Notifications (`push`, `pushsubscriptionchange`, `notificationclick`)
 * - W3C Badging API (`self.navigator.setAppBadge` / `clearAppBadge`)
 * Follows Microsoft Edge PWA & PWABuilder Service Worker best practices.
 */
(function () {
  if (typeof self === 'undefined' || self.__lhCustomSwSyncInstalled) {
    return;
  }
  self.__lhCustomSwSyncInstalled = true;

  const BOOT_SYNC_CACHE_NAME = 'lh-boot-sync-v1';
  const BOOT_SYNC_CACHE_URL = '/api/packages/?boot=1';
  const OUTBOX_DB_NAME = 'lh_sync_outbox_db';
  const OUTBOX_STORE_NAME = 'outbox';
  const NOTIF_STATE_DB_NAME = 'lh_pwa_notif_state_db';
  const NOTIF_STATE_STORE_NAME = 'state';
  const BROADCAST_CHANNEL_NAME = 'lh-pwa-sync';

  function openNotifStateDb() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      try {
        const request = indexedDB.open(NOTIF_STATE_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(NOTIF_STATE_STORE_NAME)) {
            db.createObjectStore(NOTIF_STATE_STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function readAllNotifStateFromSw() {
    const out = {};
    try {
      const db = await openNotifStateDb();
      if (!db) return out;
      await new Promise((resolve) => {
        const tx = db.transaction(NOTIF_STATE_STORE_NAME, 'readonly');
        const store = tx.objectStore(NOTIF_STATE_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? req.result : [];
          for (const row of rows) {
            if (row && typeof row.key === 'string') {
              out[row.key] = row.value;
            }
          }
          resolve(true);
        };
        req.onerror = () => resolve(false);
        tx.oncomplete = () => closeOutboxDb(db);
        tx.onerror = () => closeOutboxDb(db);
      });
    } catch {
      // ignore
    }
    return out;
  }

  async function writeNotifStateFromSw(entries) {
    try {
      const db = await openNotifStateDb();
      if (!db) return;
      await new Promise((resolve) => {
        const tx = db.transaction(NOTIF_STATE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(NOTIF_STATE_STORE_NAME);
        const now = Date.now();
        for (const [key, value] of Object.entries(entries)) {
          store.put({ key, value, updatedAt: now });
        }
        tx.oncomplete = () => {
          closeOutboxDb(db);
          resolve(true);
        };
        tx.onerror = () => {
          closeOutboxDb(db);
          resolve(false);
        };
      });
    } catch {
      // ignore
    }
  }

  async function setSwAppBadge(count) {
    try {
      const nav = self.navigator;
      if (!nav) return;
      if (count > 0 && typeof nav.setAppBadge === 'function') {
        await nav.setAppBadge(count);
      } else if (count <= 0 && typeof nav.clearAppBadge === 'function') {
        await nav.clearAppBadge();
      }
    } catch {
      // Ignore Badging API errors on unsupported platforms
    }
  }

  function openOutboxDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      try {
        const request = indexedDB.open(OUTBOX_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
            db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  function closeOutboxDb(db) {
    try {
      if (db && typeof db.close === 'function') {
        db.close();
      }
    } catch {
      // ignore
    }
  }

  async function readAllOutboxItems() {
    try {
      const db = await openOutboxDb();
      if (!db) return [];
      return await new Promise((resolve) => {
        const tx = db.transaction(OUTBOX_STORE_NAME, 'readonly');
        const store = tx.objectStore(OUTBOX_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = Array.isArray(req.result) ? req.result : [];
          list.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
          resolve(list);
        };
        req.onerror = () => resolve([]);
        tx.oncomplete = () => closeOutboxDb(db);
        tx.onerror = () => closeOutboxDb(db);
      });
    } catch {
      return [];
    }
  }

  async function deleteOutboxItem(id) {
    try {
      const db = await openOutboxDb();
      if (!db || !id) return;
      await new Promise((resolve) => {
        const tx = db.transaction(OUTBOX_STORE_NAME, 'readwrite');
        const store = tx.objectStore(OUTBOX_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => {
          closeOutboxDb(db);
          resolve(true);
        };
        tx.onerror = () => {
          closeOutboxDb(db);
          resolve(false);
        };
      });
    } catch {
      // Ignore IndexedDB delete errors
    }
  }

  async function broadcastSyncMessage(message) {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        bc.postMessage(message);
        bc.close();
      }
    } catch {
      // Ignore BroadcastChannel errors
    }

    try {
      if (self.clients && typeof self.clients.matchAll === 'function') {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList || []) {
          if (client && typeof client.postMessage === 'function') {
            client.postMessage(message);
          }
        }
      }
    } catch {
      // Ignore client postMessage errors
    }
  }

  /**
   * Flushes queued offline mutations (e.g. POST /api/auth/favorites, POST /api/packages/hydrate)
   * stored in IndexedDB (`lh_sync_outbox_db`).
   */
  async function flushQueuedMutationsFromSw() {
    const items = await readAllOutboxItems();
    if (!items.length) return;

    let flushedCount = 0;
    for (const item of items) {
      if (!item || !item.url) {
        if (item?.id) await deleteOutboxItem(item.id);
        continue;
      }
      try {
        const response = await fetch(item.url, {
          method: item.method || 'POST',
          headers: item.headers || { 'Content-Type': 'application/json' },
          body: typeof item.body === 'string' ? item.body : JSON.stringify(item.body || {}),
          credentials: 'same-origin'
        });
        if (response && (response.ok || (response.status >= 400 && response.status < 500))) {
          await deleteOutboxItem(item.id);
          if (response.ok) {
            flushedCount++;
          }
        }
      } catch {
        // Network still unstable; throw so SyncManager retries with backoff
        throw new Error('Background sync network request failed');
      }
    }

    if (flushedCount > 0) {
      await broadcastSyncMessage({
        type: 'LH_OUTBOX_SYNC_COMPLETED',
        flushedCount,
        ts: Date.now()
      });
    }
  }

  // === BEGIN SHARED NOTIF ENGINE ===
  "use strict";
  const NOTIFICATION_MAX_EVENT_AGE_MS = 12 * 3600 * 1000; // 12 hours max age for event notifications
  const NOTIFICATION_PACKAGE_COOLDOWN_MS = 12 * 3600 * 1000; // 12 hours per-package update cooldown
  const NOTIFICATION_BASELINE_SKEW_GRACE_MS = 15 * 60 * 1000; // 15 minutes grace for clock skew on newly seeded baselines
  const MIN_SW_BOOT_FETCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes minimum interval between SW boot catalog fetches
  function normalizeReleaseStampPart(rawRel) {
      const trimmed = String(rawRel ?? '').trim();
      if (!trimmed || trimmed === '0')
          return '';
      const num = Number(trimmed);
      // Synthetic Unix epoch timestamps (>= 1_000_000_000, i.e. 10+ digits) are not sequential
      // ContentDB release IDs (~1..99_999_999); normalize them to '' so dual-source packages
      // never oscillate between a 5-digit ContentDB release ID and a 10-digit epoch timestamp.
      if (Number.isFinite(num) && num >= 1000000000)
          return '';
      return trimmed;
  }
  function normalizeCommitShaPart(rawSha) {
      const trimmed = String(rawSha ?? '').trim();
      if (!trimmed || trimmed === 'HEAD' || trimmed === 'latest')
          return '';
      return trimmed;
  }
  function parseNotificationTimestampMs(rawIso) {
      if (rawIso === undefined || rawIso === null)
          return null;
      const rawTrimmed = String(rawIso).trim();
      if (!rawTrimmed)
          return null;
      const normalizedIso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(rawTrimmed)
          ? `${rawTrimmed.replace(' ', 'T')}Z`
          : rawTrimmed;
      const ms = new Date(normalizedIso).getTime();
      return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  function computePackageVersionStamp(pkg) {
      if (!pkg || typeof pkg !== 'object')
          return '||';
      const rel = normalizeReleaseStampPart(pkg.release_id ?? pkg.release ?? '');
      const upd = String(pkg.updated_at || '').trim();
      const sha = normalizeCommitShaPart(pkg.latest_commit_sha || pkg.commit_sha || '');
      return `${rel}|${upd}|${sha}`;
  }
  function resolveCanonicalPackageIdentity(pkg) {
      if (!pkg || typeof pkg !== 'object')
          return null;
      const rawId = typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.trim() : '';
      const author = String(pkg.author || pkg.author_name || (rawId ? rawId.split('/')[0] : '') || '').trim();
      const name = String(pkg.name || (rawId ? rawId.split('/')[1] : '') || '').trim();
      if (!author || !name)
          return null;
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
  function deduplicateNotificationPackageCandidates(candidates) {
      if (!Array.isArray(candidates) || candidates.length === 0)
          return [];
      const byId = new Map();
      for (const pkg of candidates) {
          if (!pkg || pkg.status === 'delisted' || pkg.status === 'flagged')
              continue;
          const idInfo = resolveCanonicalPackageIdentity(pkg);
          if (!idInfo)
              continue;
          const existing = byId.get(idInfo.lowerId);
          if (!existing) {
              byId.set(idInfo.lowerId, Object.assign({}, pkg, { id: idInfo.resolvedId, author: idInfo.author, name: idInfo.name }));
              continue;
          }
          const prevRel = normalizeReleaseStampPart(existing.release_id ?? existing.release ?? '');
          const nextRel = normalizeReleaseStampPart(pkg.release_id ?? pkg.release ?? '');
          const prevRelNum = Number(prevRel);
          const nextRelNum = Number(nextRel);
          const chosenRel = prevRel && nextRel
              ? Number.isFinite(prevRelNum) && Number.isFinite(nextRelNum)
                  ? Math.max(prevRelNum, nextRelNum)
                  : nextRel
              : nextRel || prevRel;
          const prevUpdMs = parseNotificationTimestampMs(existing.updated_at) || 0;
          const nextUpdMs = parseNotificationTimestampMs(pkg.updated_at) || 0;
          const chosenUpd = nextUpdMs > prevUpdMs
              ? pkg.updated_at
              : existing.updated_at || pkg.updated_at;
          const prevCreatedMs = parseNotificationTimestampMs(existing.created_at) || 0;
          const nextCreatedMs = parseNotificationTimestampMs(pkg.created_at) || 0;
          const chosenCreated = nextCreatedMs > prevCreatedMs
              ? pkg.created_at
              : existing.created_at || pkg.created_at;
          const chosenSha = normalizeCommitShaPart(pkg.latest_commit_sha || pkg.commit_sha) ||
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
          byId.set(idInfo.lowerId, Object.assign({}, existing, pkg, {
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
          }));
      }
      return Array.from(byId.values());
  }
  /**
   * Merges two `rel|upd|sha` stamps for the same package, preserving non-empty fields
   * so unhydrated catalog polls never wipe out previously hydrated `release_id`, `updated_at`, or `latest_commit_sha`.
   */
  function mergePackageVersionStamps(prevStamp, newStamp, preferNewOnConflict = true) {
      if (!prevStamp)
          return newStamp;
      if (prevStamp === newStamp)
          return newStamp;
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
          }
          else {
              mergedRel = preferNewOnConflict ? newRel : prevRel;
          }
      }
      let mergedUpd = newUpd || prevUpd;
      if (prevUpd && newUpd && prevUpd !== newUpd) {
          const pMs = parseNotificationTimestampMs(prevUpd) || 0;
          const nMs = parseNotificationTimestampMs(newUpd) || 0;
          if (pMs > 0 && nMs > 0) {
              mergedUpd = nMs >= pMs ? newUpd : prevUpd;
          }
          else {
              mergedUpd = preferNewOnConflict ? newUpd : prevUpd;
          }
      }
      let mergedSha = newSha || prevSha;
      if (prevSha && newSha && prevSha !== newSha) {
          const isHex = (s) => /^[0-9a-f]{7,40}$/i.test(s);
          if (isHex(newSha) && !isHex(prevSha)) {
              mergedSha = newSha;
          }
          else if (isHex(prevSha) && !isHex(newSha)) {
              mergedSha = prevSha;
          }
          else {
              mergedSha = preferNewOnConflict ? newSha : prevSha;
          }
      }
      return `${mergedRel}|${mergedUpd}|${mergedSha}`;
  }
  /**
   * Determines whether a package's version stamp strictly and genuinely advanced,
   * while classifying metadata backfills (`"" -> value`) and representation switches as non-notifying.
   */
  function evaluatePackageStampAdvancement(prevStamp, newStamp, options) {
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
      const isHexSha = (s) => /^[0-9a-f]{7,40}$/i.test(s);
      let genuinelyAdvanced = isForced;
      if (!genuinelyAdvanced && prevStamp !== newStamp) {
          const hasPrevSha = Boolean(prevSha);
          const hasNewSha = Boolean(newSha);
          if (hasPrevSha && hasNewSha) {
              if (prevSha.toLowerCase() === newSha.toLowerCase()) {
                  // Same concrete commit SHA: only advance if both stamps have sequential ContentDB release IDs and newRel > prevRel
                  if (prevRel &&
                      newRel &&
                      prevRel !== newRel &&
                      Number.isFinite(prevRelNum) &&
                      Number.isFinite(newRelNum) &&
                      prevRelNum > 0 &&
                      newRelNum > 0 &&
                      newRelNum > prevRelNum) {
                      genuinelyAdvanced = true;
                  }
              }
              else if (isHexSha(prevSha) === isHexSha(newSha)) {
                  // Both have concrete SHAs of the same representation (e.g. both hex SHAs) and they differ.
                  // Require either release ID to strictly advance OR timestamp to strictly advance (when both timestamps are present).
                  const relMovedBackwards = Boolean(prevRel && newRel) &&
                      Number.isFinite(prevRelNum) &&
                      Number.isFinite(newRelNum) &&
                      newRelNum < prevRelNum;
                  const relStrictlyAdvanced = Boolean(prevRel && newRel) &&
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
          }
          else if (prevRel && newRel && !hasPrevSha && !hasNewSha) {
              // Pure release-tracked package (or neither stamp had a commit SHA):
              // Only notify when both stamps already had a release identifier and the new release strictly advanced.
              if (prevRel !== newRel) {
                  const prevIsNumeric = Number.isFinite(prevRelNum) && prevRelNum > 0;
                  const newIsNumeric = Number.isFinite(newRelNum) && newRelNum > 0;
                  if (prevIsNumeric && newIsNumeric) {
                      genuinelyAdvanced = newRelNum > prevRelNum;
                  }
                  else if (!prevIsNumeric && !newIsNumeric) {
                      genuinelyAdvanced = true;
                  }
              }
          }
          else if (prevRel && newRel && prevRel !== newRel) {
              // One stamp had a SHA and the other didn't, but BOTH had numeric ContentDB release IDs and release_id strictly increased
              if (Number.isFinite(prevRelNum) &&
                  Number.isFinite(newRelNum) &&
                  prevRelNum > 0 &&
                  newRelNum > 0 &&
                  newRelNum > prevRelNum) {
                  genuinelyAdvanced = true;
              }
          }
          else if (!prevRel && !newRel && !hasPrevSha && !hasNewSha && prevUpd && newUpd && prevUpd !== newUpd) {
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
      }
      else if (newUpdMs !== null) {
          const withinMaxAge = nowMs - newUpdMs <= maxAgeMs;
          const afterBaseline = baselineSeededAt <= 0 || newUpdMs >= baselineSeededAt - NOTIFICATION_BASELINE_SKEW_GRACE_MS;
          isRecent = withinMaxAge && afterBaseline;
      }
      else if (!newUpd && prevRel && newRel && !prevSha && !newSha) {
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
  function buildPackageUpdateNotificationSpec(pkg, resolvedId, stamp, eventTimestampMs) {
      const idInfo = resolveCanonicalPackageIdentity(pkg) || {
          author: String(pkg?.author || pkg?.author_name || resolvedId.split('/')[0] || 'Creator'),
          name: String(pkg?.name || resolvedId.split('/')[1] || resolvedId),
          resolvedId,
          lowerId: resolvedId.toLowerCase()
      };
      const typeLabel = String(pkg?.type || 'mod').toUpperCase();
      const displayTitle = pkg?.title || idInfo.name;
      const thumb = pkg?.banner || pkg?.banner_url || pkg?.thumbnail || pkg?.thumbnail_url || undefined;
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
  function buildNewGitPackageNotificationSpec(pkg, resolvedId, eventTimestampMs) {
      const idInfo = resolveCanonicalPackageIdentity(pkg) || {
          author: String(pkg?.author || pkg?.author_name || resolvedId.split('/')[0] || 'Creator'),
          name: String(pkg?.name || resolvedId.split('/')[1] || resolvedId),
          resolvedId,
          lowerId: resolvedId.toLowerCase()
      };
      const typeLabel = String(pkg?.type || 'mod').toUpperCase();
      const displayTitle = pkg?.title || idInfo.name;
      const thumb = pkg?.banner || pkg?.banner_url || pkg?.thumbnail || pkg?.thumbnail_url || undefined;
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
          timestamp: eventTimestampMs ||
              parseNotificationTimestampMs(pkg?.created_at || pkg?.updated_at) ||
              Date.now(),
          renotify: false,
          data: {
              packageId: idInfo.resolvedId
          }
      };
  }
  function resolveReviewPackageId(rev) {
      return String(rev?.package_id ||
          rev?.packageId ||
          (rev?.package?.author && rev?.package?.name ? `${rev.package.author}/${rev.package.name}` : '') ||
          '').trim();
  }
  function resolveReviewCleanId(rev) {
      if (rev?.id !== undefined && rev?.id !== null && String(rev.id).trim() !== '') {
          return String(rev.id).trim().replace(/^lh_/i, '');
      }
      if (rev?.thread?.id !== undefined && rev?.thread?.id !== null && String(rev.thread.id).trim() !== '') {
          return `cdb_${String(rev.thread.id).trim()}`;
      }
      const pkgId = resolveReviewPackageId(rev);
      const uname = String(rev?.reviewer_username || rev?.username || rev?.user?.username || rev?.author?.username || '').trim();
      const created = String(rev?.created_at || rev?.createdAt || '').trim();
      if (pkgId && uname && created) {
          return `cdb_${pkgId.toLowerCase()}_${uname}_${created}`;
      }
      return '';
  }
  function buildReviewNotificationSpec(rev) {
      const cleanId = resolveReviewCleanId(rev);
      const pkgId = resolveReviewPackageId(rev);
      if (!cleanId || !pkgId)
          return null;
      const pkgTitle = String(rev?.package_title || rev?.packageTitle || rev?.package?.title || pkgId.split('/')[1] || pkgId).trim();
      const rawRating = Number(rev?.rating ?? (rev?.is_positive === false || rev?.recommends === false ? 1 : 5));
      const rating = Math.max(1, Math.min(5, Number.isFinite(rawRating) ? Math.round(rawRating) : 5));
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      const reviewer = String(rev?.reviewer_username ||
          rev?.username ||
          rev?.user?.username ||
          rev?.author?.username ||
          rev?.reviewer_display_name ||
          rev?.display_name ||
          rev?.user?.display_name ||
          rev?.author?.display_name ||
          'community').trim() || 'community';
      const rawComment = String(rev?.comment || rev?.title || '').replace(/\s+/g, ' ').trim();
      const excerpt = rawComment.length > 90
          ? `${rawComment.slice(0, 87)}...`
          : rawComment || 'New community review posted on LuantiHub.';
      const thumb = rev?.package_thumbnail || rev?.packageThumbnail || rev?.package?.thumbnail || undefined;
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
  function mergeNotificationPersistenceStates(localState, remoteState) {
      const unionStrings = (a, b, limit, lower = false) => {
          const listA = Array.isArray(a) ? a : [];
          const listB = Array.isArray(b) ? b : [];
          const set = new Set();
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
          ? unionStrings((Array.isArray(localReviews) ? localReviews : []).map((id) => String(id || '').replace(/^lh_/i, '')), (Array.isArray(remoteReviews) ? remoteReviews : []).map((id) => String(id || '').replace(/^lh_/i, '')), 500)
          : null;
      const hasAnyGit = Array.isArray(localState.knownGitPackages) || Array.isArray(remoteState.knownGitPackages);
      const knownGitPackages = hasAnyGit
          ? unionStrings(localState.knownGitPackages, remoteState.knownGitPackages, 10000, true)
          : null;
      const localVersions = localState.knownPackageVersions &&
          typeof localState.knownPackageVersions === 'object' &&
          !Array.isArray(localState.knownPackageVersions)
          ? localState.knownPackageVersions
          : null;
      const remoteVersions = remoteState.knownPackageVersions &&
          typeof remoteState.knownPackageVersions === 'object' &&
          !Array.isArray(remoteState.knownPackageVersions)
          ? remoteState.knownPackageVersions
          : null;
      let knownPackageVersions = null;
      if (localVersions || remoteVersions) {
          const mergedMap = {};
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
              }
              else if (rStamp) {
                  mergedMap[key] = rStamp;
              }
              else if (lStamp) {
                  mergedMap[key] = lStamp;
              }
          }
          const entries = Object.entries(mergedMap);
          knownPackageVersions =
              entries.length > 10000 ? Object.fromEntries(entries.slice(-10000)) : mergedMap;
      }
      const localCooldown = localState.packageUpdateCooldown || localState.packageUpdateCooldowns || {};
      const remoteCooldown = remoteState.packageUpdateCooldowns || remoteState.packageUpdateCooldown || {};
      const mergedCooldown = {};
      for (const key of new Set([...Object.keys(localCooldown), ...Object.keys(remoteCooldown)])) {
          const lowerKey = key.toLowerCase();
          const lTs = Number(localCooldown[key] || 0);
          const rTs = Number(remoteCooldown[key] || 0);
          const maxTs = Math.max(Number.isFinite(lTs) ? lTs : 0, Number.isFinite(rTs) ? rTs : 0);
          if (maxTs > 0) {
              mergedCooldown[lowerKey] = maxTs;
          }
      }
      const localRecentDiscovered = localState.recentDiscoveredPackages &&
          typeof localState.recentDiscoveredPackages === 'object' &&
          !Array.isArray(localState.recentDiscoveredPackages)
          ? localState.recentDiscoveredPackages
          : {};
      const remoteRecentDiscovered = remoteState.recentDiscoveredPackages &&
          typeof remoteState.recentDiscoveredPackages === 'object' &&
          !Array.isArray(remoteState.recentDiscoveredPackages)
          ? remoteState.recentDiscoveredPackages
          : {};
      const mergedRecentDiscoveredRaw = {};
      for (const key of new Set([
          ...Object.keys(localRecentDiscovered),
          ...Object.keys(remoteRecentDiscovered)
      ])) {
          const lowerKey = key.toLowerCase();
          const lTs = Number(localRecentDiscovered[key] || 0);
          const rTs = Number(remoteRecentDiscovered[key] || 0);
          const maxTs = Math.max(Number.isFinite(lTs) ? lTs : 0, Number.isFinite(rTs) ? rTs : 0);
          if (maxTs > 0) {
              mergedRecentDiscoveredRaw[lowerKey] = Math.max(mergedRecentDiscoveredRaw[lowerKey] || 0, maxTs);
          }
      }
      const mergedRecentDiscoveredEntries = Object.entries(mergedRecentDiscoveredRaw)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 100);
      const mergedRecentDiscovered = Object.fromEntries(mergedRecentDiscoveredEntries);
      const lSeed = Number(localState.baselineSeededAt || 0);
      const rSeed = Number(remoteState.baselineSeededAt || 0);
      const baselineSeededAt = lSeed > 0 && rSeed > 0 ? Math.min(lSeed, rSeed) : Math.max(lSeed, rSeed, 0);
      const lastBootFetchAt = Math.max(Number(localState.lastBootFetchAt || 0), Number(remoteState.lastBootFetchAt || 0));
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
          recentDiscoveredPackages: mergedRecentDiscovered,
          bootManifestSignature: localState.bootManifestSignature || remoteState.bootManifestSignature || '',
          baselineSeededAt,
          lastBootFetchAt
      };
  }
  /**
   * Evaluates an entire `/api/packages/?boot=1` payload against the persisted notification state
   * (used by the Service Worker in `public/custom-sw.js` and testable directly in unit tests).
   */
  function evaluateCatalogNotificationsBatch(bootPayload, state, nowMs = Date.now()) {
      const notifications = [];
      const stateUpdates = {};
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
          const knownGitSet = new Set(state.knownGitPackages.map((id) => String(id).toLowerCase()));
          let gitChanged = false;
          if (!knownGitSet.has('__cdb_seeded_v1__')) {
              const existingVersionKeys = state.knownPackageVersions &&
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
          const newlyDiscoveredGit = [];
          for (const pkg of packages) {
              const idInfo = resolveCanonicalPackageIdentity(pkg);
              if (!idInfo)
                  continue;
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
                  const isRecent = timeMs !== null
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
          if (newlyDiscoveredGit.length > 0) {
              const recentDiscoveredMap = Object.assign({}, state.recentDiscoveredPackages &&
                  typeof state.recentDiscoveredPackages === 'object' &&
                  !Array.isArray(state.recentDiscoveredPackages)
                  ? state.recentDiscoveredPackages
                  : {});
              for (const item of newlyDiscoveredGit) {
                  const lowerId = String(item.resolvedId || '').toLowerCase();
                  if (lowerId) {
                      recentDiscoveredMap[lowerId] = Math.max(Number(recentDiscoveredMap[lowerId] || 0), item.eventTimestampMs || nowMs);
                  }
              }
              const trimmedRecentEntries = Object.entries(recentDiscoveredMap)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 100);
              stateUpdates.recentDiscoveredPackages = Object.fromEntries(trimmedRecentEntries);
          }
          for (const item of newlyDiscoveredGit.slice(0, 3)) {
              notifications.push(buildNewGitPackageNotificationSpec(item.pkg, item.resolvedId, item.eventTimestampMs));
          }
      }
      // 2. Evaluate Package Updates
      if (prefs.notifyPackageUpdates &&
          state.knownPackageVersions &&
          typeof state.knownPackageVersions === 'object' &&
          Object.keys(state.knownPackageVersions).length > 0) {
          const knownMap = Object.assign({}, state.knownPackageVersions);
          const cooldownMap = Object.assign({}, state.packageUpdateCooldowns || state.packageUpdateCooldown || {});
          let mapChanged = false;
          let cooldownChanged = false;
          const updatedList = [];
          for (const pkg of packages) {
              const idInfo = resolveCanonicalPackageIdentity(pkg);
              if (!idInfo)
                  continue;
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
                  const withinCooldown = lastNotifiedAt > 0 && nowMs - lastNotifiedAt < NOTIFICATION_PACKAGE_COOLDOWN_MS;
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
          const favSet = new Set((Array.isArray(prefs.favorites) ? prefs.favorites : []).map((f) => String(f).toLowerCase()));
          const dlMap = prefs.downloadedPackages && typeof prefs.downloadedPackages === 'object'
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
              notifications.push(buildPackageUpdateNotificationSpec(item.pkg, item.resolvedId, item.stamp, item.eventTimestampMs));
          }
          if (cooldownChanged) {
              const entries = Object.entries(cooldownMap);
              const trimmed = entries.length > 2000 ? Object.fromEntries(entries.slice(-2000)) : cooldownMap;
              stateUpdates.packageUpdateCooldown = trimmed;
              stateUpdates.packageUpdateCooldowns = trimmed;
          }
      }
      // 3. Evaluate Active Promotions
      const promotions = Array.isArray(bootPayload?.promotions) ? bootPayload.promotions : [];
      if (prefs.notifyPromotions && promotions.length > 0 && Array.isArray(state.seenPromotions)) {
          const seenPromoSet = new Set(state.seenPromotions.map((id) => String(id).trim()));
          let promoChanged = false;
          let firedPromos = 0;
          for (const promo of promotions) {
              if (!promo || !promo.id || !promo.title || !promo.expires_at)
                  continue;
              const expMs = Date.parse(String(promo.expires_at));
              if (!Number.isFinite(expMs) || expMs <= nowMs)
                  continue;
              if (promo.starts_at) {
                  const startMs = Date.parse(String(promo.starts_at));
                  if (Number.isFinite(startMs) && startMs > nowMs)
                      continue;
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
      if (prefs.notifyPromotions &&
          blogPost &&
          blogPost.title &&
          blogPost.url &&
          Array.isArray(state.seenBlogPosts)) {
          const seenBlogSet = new Set(state.seenBlogPosts.map((u) => String(u).trim()));
          const postKey = String(blogPost.id || blogPost.url || blogPost.title).trim();
          if (postKey && !seenBlogSet.has(postKey)) {
              seenBlogSet.add(postKey);
              stateUpdates.seenBlogPosts = Array.from(seenBlogSet).slice(-100);
              const validImageUrl = blogPost.image_url && blogPost.image_url !== '/promo.png' ? blogPost.image_url : undefined;
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
          const seenRevSet = new Set(rawSeenReviews.map((id) => String(id || '').trim().replace(/^lh_/i, '')).filter(Boolean));
          let revChanged = false;
          const newRevs = [];
          for (const rev of recentReviews) {
              const cleanId = resolveReviewCleanId(rev);
              const pkgId = resolveReviewPackageId(rev);
              if (!cleanId || !pkgId)
                  continue;
              const createdMs = parseNotificationTimestampMs(rev?.created_at || rev?.createdAt);
              const isRecent = createdMs !== null
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

  function extractNgswBundleSignatureInSw(manifest) {
    if (!manifest || typeof manifest !== 'object') return null;
    const hashTable = manifest.hashTable && typeof manifest.hashTable === 'object' ? manifest.hashTable : {};
    const indexHash = hashTable['/index.html'] || hashTable['index.html'] || '';
    const customSwHash = hashTable['/custom-sw.js'] || hashTable['custom-sw.js'] || '';
    const remoteBuildTs = String(
      (manifest.appData && manifest.appData.buildTimestamp) ||
      (typeof manifest.timestamp === 'number' ? manifest.timestamp : '')
    ).trim();

    let remoteMain = '';
    let remoteStyles = '';
    if (Array.isArray(manifest.assetGroups)) {
      const appGroup = manifest.assetGroups.find((g) => g && g.name === 'app') || manifest.assetGroups[0];
      const urls = Array.isArray(appGroup?.urls) ? appGroup.urls : [];
      remoteMain = urls.find((u) => /\/main-[A-Za-z0-9_-]+\.js$/.test(u)) || '';
      remoteStyles = urls.find((u) => /\/styles-[A-Za-z0-9_-]+\.css$/.test(u)) || '';
    }
    if (!remoteMain && !remoteStyles) {
      const keys = Object.keys(hashTable).sort();
      remoteMain = keys.find((k) => /\/main-[A-Za-z0-9_-]+\.js$/.test(k)) || '';
      remoteStyles = keys.find((k) => /\/styles-[A-Za-z0-9_-]+\.css$/.test(k)) || '';
    }

    if (remoteMain || indexHash || remoteBuildTs) {
      return `${remoteMain || ''}|${remoteStyles || ''}|${indexHash}|${customSwHash}|${remoteBuildTs}`;
    }
    return null;
  }

  /**
   * Checks `/ngsw.json` directly inside the Service Worker so app updates are detected
   * and notified even while the PWA window is minimized, unfocused, or closed.
   */
  async function checkNgswAppUpdateInSw(state, prefs, fireSwNotif, stateUpdates) {
    const baselineSig = typeof state.bootManifestSignature === 'string' ? state.bootManifestSignature : '';
    const canFireOsNotif =
      Boolean(prefs && prefs.notificationsEnabled !== false && prefs.notifyAppUpdates !== false) &&
      typeof fireSwNotif === 'function';

    try {
      const res = await fetch(`/ngsw.json?ngsw-bypass=true&ngsw-cache-bust=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });
      if (!res || !res.ok) return false;
      const manifest = await res.json();
      const remoteSig = extractNgswBundleSignatureInSw(manifest);
      if (!remoteSig) return false;

      if (!baselineSig) {
        if (stateUpdates && typeof stateUpdates === 'object') {
          stateUpdates.bootManifestSignature = remoteSig;
        }
        return false;
      }

      if (remoteSig === baselineSig) return false;

      if (stateUpdates && typeof stateUpdates === 'object') {
        stateUpdates.bootManifestSignature = remoteSig;
      }

      const updateTag = `lh-app-update-${remoteSig.slice(0, 48)}`;
      const fired = canFireOsNotif
        ? await fireSwNotif('LuantiHub Updated', {
            body: 'LuantiHub was updated automatically in the background to the latest version.',
            icon: '/icons/notif-app-update.png',
            badge: '/icons/icon-72x72.png',
            tag: updateTag,
            data: { signature: remoteSig }
          })
        : false;

      try {
        if (self.registration && typeof self.registration.update === 'function') {
          await self.registration.update().catch(() => {});
        }
        if (typeof self.skipWaiting === 'function') {
          await self.skipWaiting().catch(() => {});
        }
      } catch {
        // Ignore SW activation errors
      }

      await broadcastSyncMessage({
        type: 'LH_APP_UPDATE_DETECTED',
        signature: remoteSig,
        tag: updateTag,
        notified: fired,
        ts: Date.now()
      });
      return fired;
    } catch {
      return false;
    }
  }
  const evaluateBackgroundManifestUpdateInSw = checkNgswAppUpdateInSw;

  /**
   * Evaluates and displays OS-level notifications directly from the Service Worker
   * whenever no client window is actively focused (minimized, occluded, in a background tab, or closed),
   * and updates the OS taskbar/dock badge count via `self.navigator.setAppBadge()`.
   */
  async function evaluateBackgroundNotificationsInSw(bootPayload) {
    const notifiedTags = [];
    try {
      const state = await readAllNotifStateFromSw();
      const prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : null;
      const canShowNotifications =
        Boolean(self.registration && typeof self.registration.showNotification === 'function') &&
        (typeof Notification === 'undefined' || Notification.permission === 'granted') &&
        Boolean(prefs && prefs.notificationsEnabled);

      const seenTagsList = Array.isArray(state.seenTags) ? state.seenTags.slice() : [];
      const seenTagsSet = new Set(seenTagsList);
      const stateUpdates = {};
      const nowMs = Date.now();

      const fireSwNotif = async (title, options) => {
        if (!canShowNotifications) return false;
        if (!options || !options.tag || seenTagsSet.has(options.tag)) return false;
        seenTagsSet.add(options.tag);
        seenTagsList.push(options.tag);
        notifiedTags.push(options.tag);
        try {
          await self.registration.showNotification(title, options);
          return true;
        } catch {
          return false;
        }
      };

      // 0. Evaluate App Update (`/ngsw.json`) in Service Worker (always checks & broadcasts LH_APP_UPDATE_DETECTED; OS notification gated by canShowNotifications)
      await checkNgswAppUpdateInSw(state, prefs, fireSwNotif, stateUpdates);

      if (!canShowNotifications) {
        if (Object.keys(stateUpdates).length > 0) {
          await writeNotifStateFromSw(stateUpdates);
        }
        return notifiedTags;
      }

      // 1-5. Evaluate Catalog Notifications via Shared DRY Notification Engine (`notification-engine.ts`)
      const batchResult = evaluateCatalogNotificationsBatch(bootPayload, state, nowMs);
      if (batchResult && batchResult.stateUpdates && typeof batchResult.stateUpdates === 'object') {
        Object.assign(stateUpdates, batchResult.stateUpdates);
      }

      const specs = Array.isArray(batchResult?.notifications) ? batchResult.notifications : [];
      for (const spec of specs) {
        const defaultIcon =
          spec.variant === 'package_update'
            ? '/icons/notif-package-update.png'
            : spec.variant === 'new_git_package' || spec.variant === 'new_review' || spec.variant === 'promotion'
              ? '/icons/notif-new-package.png'
              : '/icons/icon-192x192.png';
        await fireSwNotif(spec.title, {
          body: spec.body,
          icon: spec.icon || defaultIcon,
          ...(spec.image ? { image: spec.image } : {}),
          badge: spec.badge || '/icons/icon-72x72.png',
          tag: spec.tag,
          timestamp: spec.timestamp || nowMs,
          renotify: false,
          data: spec.data || {}
        });
      }

      if (notifiedTags.length > 0) {
        stateUpdates.seenTags = seenTagsList.slice(-300);
        const nextBadgeCount = Math.max(0, Number(state.unreadBadgeCount || 0)) + notifiedTags.length;
        stateUpdates.unreadBadgeCount = nextBadgeCount;
        await setSwAppBadge(nextBadgeCount);
      }

      if (Object.keys(stateUpdates).length > 0) {
        await writeNotifStateFromSw(stateUpdates);
      }
    } catch {
      // Ignore background notification evaluation errors
    }
    return notifiedTags;
  }

  const MIN_BG_CATALOG_SYNC_INTERVAL_MS = 15 * 60 * 1000;
  let lastSwBootFetchAt = 0;

  /**
   * Fetches the bundled LuantiHub boot payload (`/api/packages/?boot=1` containing
   * Home Page catalog tiles, Tags, Top 10 Today, Top 10 Week, and Hero Promotions),
   * caches it in CacheStorage (`lh-boot-sync-v1`), and broadcasts it to any open client windows.
   */
  async function fetchAndCacheBootCatalogInSw(forceNetwork = false) {
    try {
      const now = Date.now();
      let cachedBootPayload = null;
      let cachedSyncedAt = lastSwBootFetchAt;

      // Read persistent `lastBootFetchAt` from IndexedDB so Service Worker idle-termination/restart
      // or client handoffs never bypass the 15-minute Cloudflare quota guard.
      try {
        const idbState = await readAllNotifStateFromSw();
        const idbFetchAt = Number(idbState?.lastBootFetchAt || 0);
        if (Number.isFinite(idbFetchAt) && idbFetchAt > cachedSyncedAt) {
          cachedSyncedAt = idbFetchAt;
          lastSwBootFetchAt = idbFetchAt;
        }
      } catch {
        // Ignore IDB read errors
      }

      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(BOOT_SYNC_CACHE_NAME);
          const prevRes = await cache.match(BOOT_SYNC_CACHE_URL);
          if (prevRes) {
            const headerTs = Number(prevRes.headers.get('X-LuantiHub-Synced-At') || 0);
            if (Number.isFinite(headerTs) && headerTs > cachedSyncedAt) {
              cachedSyncedAt = headerTs;
            }
            const prevText = await prevRes.text();
            if (prevText) {
              const parsedPrev = JSON.parse(prevText);
              cachedBootPayload = Array.isArray(parsedPrev) ? { packages: parsedPrev } : parsedPrev;
            }
          }
        } catch {
          // Ignore cache inspection errors
        }
      }

      if (!forceNetwork && cachedSyncedAt > 0 && now - cachedSyncedAt < MIN_BG_CATALOG_SYNC_INTERVAL_MS) {
        let hasFocusedClient = false;
        try {
          if (self.clients && typeof self.clients.matchAll === 'function') {
            const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            hasFocusedClient =
              Array.isArray(clientList) &&
              clientList.some((c) => c && c.focused === true && c.visibilityState === 'visible');
          }
        } catch {
          hasFocusedClient = false;
        }
        if (!hasFocusedClient) {
          // Still evaluate app updates (`/ngsw.json` static CDN) and any pending state in cachedBootPayload
          await evaluateBackgroundNotificationsInSw(cachedBootPayload || {});
        }
        return;
      }

      const response = await fetch('/api/packages/?boot=1&ngsw-bypass=true', {
        headers: {
          Accept: 'application/json',
          'ngsw-bypass': 'true'
        }
      });

      if (!response || !response.ok) {
        return;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        return;
      }

      const rawText = await response.text();
      if (!rawText) return;

      const parsed = JSON.parse(rawText);
      const isValidPayload =
        Array.isArray(parsed) ||
        (parsed && typeof parsed === 'object' && Array.isArray(parsed.packages));
      if (!isValidPayload) return;

      const bootPayload = Array.isArray(parsed) ? { packages: parsed } : parsed;

      // Preserve any previously hydrated star ratings and review_thread_counts from the cached boot snapshot
      if (Array.isArray(cachedBootPayload?.packages) && Array.isArray(bootPayload?.packages)) {
        const prevRatingById = new Map();
        for (const p of cachedBootPayload.packages) {
          if (p && p.id && (Number(p.score) > 0 || p.review_thread_counts)) {
            prevRatingById.set(String(p.id).toLowerCase(), {
              score: Number(p.score) || 0,
              review_thread_counts: p.review_thread_counts,
              rating_checked: Boolean(p.rating_checked || Number(p.score) > 0 || p.review_thread_counts)
            });
          }
        }
        if (prevRatingById.size > 0) {
          const applyPrevRating = (pkg) => {
            if (!pkg || !pkg.id) return pkg;
            const prev = prevRatingById.get(String(pkg.id).toLowerCase());
            if (!prev) return pkg;
            if (!(Number(pkg.score) > 0) && prev.score > 0) {
              pkg.score = prev.score;
            }
            if (!pkg.review_thread_counts && prev.review_thread_counts) {
              pkg.review_thread_counts = prev.review_thread_counts;
            }
            if (prev.rating_checked) {
              pkg.rating_checked = true;
            }
            return pkg;
          };
          bootPayload.packages.forEach(applyPrevRating);
          if (Array.isArray(bootPayload.top10Today)) bootPayload.top10Today.forEach(applyPrevRating);
          if (Array.isArray(bootPayload.top10Week)) bootPayload.top10Week.forEach(applyPrevRating);
        }
      }

      const syncedAt = Date.now();
      lastSwBootFetchAt = syncedAt;
      await writeNotifStateFromSw({ lastBootFetchAt: syncedAt });
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(BOOT_SYNC_CACHE_NAME);
        const cachedResponse = new Response(JSON.stringify(bootPayload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-LuantiHub-Synced-At': String(syncedAt)
          }
        });
        await cache.put(BOOT_SYNC_CACHE_URL, cachedResponse);
      }

      let hasFocusedClient = false;
      try {
        if (self.clients && typeof self.clients.matchAll === 'function') {
          const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          // Only skip SW notifications if a client window is BOTH visible AND actively focused.
          // When minimized or in the background (`c.focused === false`), the Service Worker dispatches notifications immediately.
          hasFocusedClient =
            Array.isArray(clientList) &&
            clientList.some((c) => c && c.focused === true && c.visibilityState === 'visible');
        }
      } catch {
        hasFocusedClient = false;
      }

      let notifiedTags = [];
      if (!hasFocusedClient) {
        notifiedTags = await evaluateBackgroundNotificationsInSw(bootPayload);
      }

      await broadcastSyncMessage({
        type: 'LH_BOOT_SYNC_UPDATED',
        ts: syncedAt,
        payload: bootPayload,
        notifiedTags
      });
    } catch {
      // Ignore background fetch failures during periodic sync
    }
  }

  // 1. W3C One-Off Background Sync (`sync`)
  self.addEventListener('sync', (event) => {
    const tag = (event && event.tag) || '';
    if (
      tag === 'lh-sync-outbox' ||
      tag === 'lh-sync-favorites' ||
      tag === 'sync-favorites' ||
      tag === 'sync-outbox-data'
    ) {
      event.waitUntil(flushQueuedMutationsFromSw());
    } else if (tag === 'lh-sync-catalog' || tag === 'sync-catalog') {
      event.waitUntil(
        Promise.all([
          flushQueuedMutationsFromSw().catch(() => {}),
          fetchAndCacheBootCatalogInSw()
        ])
      );
    }
  });

  // 2. W3C Periodic Background Sync (`periodicsync`)
  self.addEventListener('periodicsync', (event) => {
    const tag = (event && event.tag) || '';
    if (
      tag === 'lh-periodic-catalog-sync' ||
      tag === 'content-sync' ||
      tag === 'fetch-latest-packages'
    ) {
      event.waitUntil(fetchAndCacheBootCatalogInSw());
    }
  });

  // 3. W3C Push API (`push` & `pushsubscriptionchange`) per PWABuilder Push Notifications best practices
  self.addEventListener('push', (event) => {
    event.waitUntil(
      (async () => {
        let payload = null;
        if (event && event.data) {
          try {
            payload = event.data.json();
          } catch {
            try {
              const text = event.data.text();
              if (text) {
                payload = { title: 'LuantiHub', body: text };
              }
            } catch {
              payload = null;
            }
          }
        }

        if (payload && (payload.title || payload.body)) {
          const state = await readAllNotifStateFromSw();
          const prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : null;
          if (!prefs || prefs.notificationsEnabled !== false) {
            const title = String(payload.title || 'LuantiHub');
            const tag = String(payload.tag || `lh-push-${Date.now()}`);
            await self.registration.showNotification(title, {
              body: String(payload.body || ''),
              icon: payload.icon || '/icons/icon-192x192.png',
              badge: payload.badge || '/icons/icon-72x72.png',
              tag,
              data: payload.data || { packageId: payload.packageId, ctaUrl: payload.url }
            });
            const nextBadgeCount = Math.max(0, Number(state.unreadBadgeCount || 0)) + 1;
            await writeNotifStateFromSw({ unreadBadgeCount: nextBadgeCount });
            await setSwAppBadge(nextBadgeCount);
          }
        } else {
          await fetchAndCacheBootCatalogInSw();
        }
      })()
    );
  });

  self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
      broadcastSyncMessage({
        type: 'LH_PUSH_SUBSCRIPTION_CHANGED',
        ts: Date.now()
      })
    );
  });

  // 4. Direct Message Trigger from Backgrounded/Minimized Client Windows
  self.addEventListener('message', (event) => {
    const data = event && event.data;
    if (data && data.type === 'LH_TRIGGER_BG_SYNC') {
      event.waitUntil(fetchAndCacheBootCatalogInSw());
    } else if (data && data.type === 'LH_CLEAR_BADGE') {
      event.waitUntil(
        (async () => {
          await writeNotifStateFromSw({ unreadBadgeCount: 0 });
          await setSwAppBadge(0);
        })()
      );
    } else if (data && data.type === 'LH_UPDATE_SW_RATINGS' && data.ratings && typeof data.ratings === 'object') {
      event.waitUntil(
        (async () => {
          if (typeof caches === 'undefined') return;
          try {
            const cache = await caches.open(BOOT_SYNC_CACHE_NAME);
            const prevRes = await cache.match(BOOT_SYNC_CACHE_URL);
            if (!prevRes) return;
            const prevTs = prevRes.headers.get('X-LuantiHub-Synced-At') || String(Date.now());
            const prevJson = await prevRes.json();
            const payload = Array.isArray(prevJson) ? { packages: prevJson } : prevJson;
            if (!payload || !Array.isArray(payload.packages)) return;
            let updated = false;
            const applyRating = (pkg) => {
              if (!pkg || !pkg.id) return;
              const entry = data.ratings[String(pkg.id).toLowerCase()];
              if (!entry) return;
              if (Number(entry.score) > 0 && pkg.score !== Number(entry.score)) {
                pkg.score = Number(entry.score);
                updated = true;
              }
              if (entry.review_thread_counts && !pkg.review_thread_counts) {
                pkg.review_thread_counts = entry.review_thread_counts;
                updated = true;
              }
              if (entry.rating_checked && !pkg.rating_checked) {
                pkg.rating_checked = true;
                updated = true;
              }
            };
            payload.packages.forEach(applyRating);
            if (Array.isArray(payload.top10Today)) payload.top10Today.forEach(applyRating);
            if (Array.isArray(payload.top10Week)) payload.top10Week.forEach(applyRating);
            if (updated) {
              await cache.put(
                BOOT_SYNC_CACHE_URL,
                new Response(JSON.stringify(payload), {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json',
                    'X-LuantiHub-Synced-At': prevTs
                  }
                })
              );
            }
          } catch {
            // Ignore SW cache update errors
          }
        })()
      );
    }
  });

  // 5. Native OS Notification Click Handler (focuses minimized/background window or opens new window)
  self.addEventListener('notificationclick', (event) => {
    if (!event || !event.notification) return;
    const notifData = event.notification.data || {};
    try {
      event.notification.close();
    } catch {
      // ignore
    }

    let targetPath = '/';
    if (notifData.packageId && typeof notifData.packageId === 'string') {
      const parts = notifData.packageId.split('/');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        targetPath = `/package/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
      }
    } else if (notifData.ctaUrl && typeof notifData.ctaUrl === 'string') {
      targetPath = notifData.ctaUrl;
    } else if (notifData.targetTab) {
      targetPath = '/profile';
    }

    event.waitUntil(
      (async () => {
        try {
          await writeNotifStateFromSw({ unreadBadgeCount: 0 });
          await setSwAppBadge(0);
          if (self.clients && typeof self.clients.matchAll === 'function') {
            const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            if (Array.isArray(clientList) && clientList.length > 0) {
              const targetClient = clientList.find((c) => c && c.focused) || clientList[0];
              if (targetClient) {
                if (typeof targetClient.focus === 'function') {
                  await targetClient.focus().catch(() => {});
                }
                if (typeof targetClient.postMessage === 'function') {
                  targetClient.postMessage({
                    type: 'LH_NOTIFICATION_CLICK',
                    data: notifData,
                    ts: Date.now()
                  });
                }
                return;
              }
            }
          }
          if (self.clients && typeof self.clients.openWindow === 'function') {
            await self.clients.openWindow(targetPath);
          }
        } catch {
          // Ignore focus/openWindow errors
        }
      })()
    );
  });
})();

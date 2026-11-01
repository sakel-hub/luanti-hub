/**
 * LuantiHub Service Worker Extension: Background Sync (`sync`) & Periodic Background Sync (`periodicsync`)
 * Follows W3C Background Synchronization & PWABuilder Service Worker best practices.
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

  function normalizeSwReleaseStampPart(rawRel) {
    const trimmed = String(rawRel ?? '').trim();
    if (!trimmed || trimmed === '0') return '';
    const num = Number(trimmed);
    if (Number.isFinite(num) && num >= 1000000000) return '';
    return trimmed;
  }

  function computeSwPackageStamp(pkg) {
    const rel = normalizeSwReleaseStampPart(pkg.release_id ?? pkg.release ?? '');
    const upd = pkg.updated_at || '';
    const sha = pkg.latest_commit_sha || pkg.commit_sha || '';
    return `${rel}|${String(upd).trim()}|${String(sha).trim()}`;
  }

  /**
   * Evaluates and displays OS-level notifications directly from the Service Worker
   * when all client windows are minimized, occluded, in a background tab, or closed.
   */
  async function evaluateBackgroundNotificationsInSw(bootPayload) {
    const notifiedTags = [];
    try {
      if (!self.registration || typeof self.registration.showNotification !== 'function') {
        return notifiedTags;
      }
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        return notifiedTags;
      }

      const state = await readAllNotifStateFromSw();
      const prefs = state.prefs && typeof state.prefs === 'object' ? state.prefs : null;
      if (!prefs || !prefs.notificationsEnabled) {
        return notifiedTags;
      }

      const seenTagsList = Array.isArray(state.seenTags) ? state.seenTags.slice() : [];
      const seenTagsSet = new Set(seenTagsList);
      const stateUpdates = {};
      const nowMs = Date.now();
      const packages = Array.isArray(bootPayload?.packages) ? bootPayload.packages : [];

      const fireSwNotif = async (title, options) => {
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

      // 1. Evaluate New Git Packages
      if (prefs.notifyNewGitPackages && Array.isArray(state.knownGitPackages) && state.knownGitPackages.length > 0) {
        const knownGitSet = new Set(state.knownGitPackages.map((id) => String(id).toLowerCase()));
        let gitChanged = false;
        const newlyDiscoveredGit = [];

        for (const pkg of packages) {
          if (!pkg || pkg.status === 'delisted' || pkg.status === 'flagged') continue;
          const author = pkg.author || pkg.author_name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
          const name = pkg.name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[1] : '');
          if (!author || !name) continue;
          const isGit = pkg.source === 'git' || (Array.isArray(pkg.sources) && pkg.sources.includes('git'));
          if (!isGit) continue;

          const resolvedId = pkg.id || `${author}/${name}`;
          const lowerId = resolvedId.toLowerCase();
          if (!knownGitSet.has(lowerId)) {
            knownGitSet.add(lowerId);
            gitChanged = true;
            const isOfficial = Array.isArray(pkg.sources) ? pkg.sources.includes('official') : pkg.source === 'official';
            const timeMs = new Date(pkg.created_at || pkg.updated_at || 0).getTime();
            const isRecent = !isNaN(timeMs) && timeMs > 0 ? nowMs - timeMs <= 48 * 3600 * 1000 : true;
            if (!isOfficial && isRecent) {
              newlyDiscoveredGit.push({ pkg, author, name, resolvedId });
            }
          }
        }

        if (gitChanged) {
          stateUpdates.knownGitPackages = Array.from(knownGitSet).slice(-2000);
        }

        for (const item of newlyDiscoveredGit.slice(0, 3)) {
          const typeLabel = String(item.pkg.type || 'mod').toUpperCase();
          const displayTitle = item.pkg.title || item.name;
          const thumb = item.pkg.thumbnail || item.pkg.thumbnail_url || '/icons/icon-192x192.png';
          await fireSwNotif(`New Git Package · [${typeLabel}] ${displayTitle}`, {
            body: `by ${item.author} — ${item.pkg.short_desc || 'New community Git repository published on LuantiHub.'}`,
            icon: thumb,
            badge: '/icons/badge-mono-96x96.png',
            tag: `lh-new-git-pkg-${item.resolvedId.toLowerCase()}`,
            data: { packageId: item.resolvedId }
          });
        }
      }

      // 2. Evaluate Package Updates
      if (
        prefs.notifyPackageUpdates &&
        state.knownPackageVersions &&
        typeof state.knownPackageVersions === 'object' &&
        Object.keys(state.knownPackageVersions).length > 0
      ) {
        const knownMap = Object.assign({}, state.knownPackageVersions);
        const cooldownMap = Object.assign({}, state.packageUpdateCooldowns || {});
        let mapChanged = false;
        let cooldownChanged = false;
        const updatedList = [];

        for (const pkg of packages) {
          if (!pkg || pkg.status === 'delisted' || pkg.status === 'flagged') continue;
          const author = pkg.author || pkg.author_name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
          const name = pkg.name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[1] : '');
          if (!author || !name) continue;
          const resolvedId = pkg.id || `${author}/${name}`;
          const lowerId = resolvedId.toLowerCase();
          const newStamp = computeSwPackageStamp(pkg);
          const prevStamp = knownMap[lowerId];

          if (prevStamp === undefined) {
            knownMap[lowerId] = newStamp;
            mapChanged = true;
            continue;
          }

          if (prevStamp !== newStamp) {
            const [rawPrevRel, prevUpd, prevSha = ''] = String(prevStamp).split('|');
            const [rawNewRel, newUpd, newSha = ''] = String(newStamp).split('|');
            const prevRel = normalizeSwReleaseStampPart(rawPrevRel);
            const newRel = normalizeSwReleaseStampPart(rawNewRel);
            const prevRelNum = Number(prevRel);
            const newRelNum = Number(newRel);
            const hasPrevSha = Boolean(prevSha && prevSha !== 'HEAD' && prevSha !== 'latest');
            const hasNewSha = Boolean(newSha && newSha !== 'HEAD' && newSha !== 'latest');

            let genuinelyAdvanced = false;
            if (hasPrevSha && hasNewSha && prevSha.toLowerCase() === newSha.toLowerCase()) {
              if (prevRel && newRel && prevRel !== newRel && Number.isFinite(prevRelNum) && Number.isFinite(newRelNum) && newRelNum > prevRelNum) {
                genuinelyAdvanced = true;
              }
            } else if (hasPrevSha && hasNewSha && prevSha.toLowerCase() !== newSha.toLowerCase()) {
              genuinelyAdvanced = true;
            } else if (prevRel && newRel && prevRel !== newRel) {
              genuinelyAdvanced = Number.isFinite(prevRelNum) && Number.isFinite(newRelNum) ? newRelNum > prevRelNum : true;
            } else if (!prevRel && !newRel && !hasPrevSha && !hasNewSha && prevUpd && newUpd && prevUpd !== newUpd) {
              const prevMs = new Date(prevUpd).getTime();
              const newMs = new Date(newUpd).getTime();
              if (!isNaN(newMs) && !isNaN(prevMs) && newMs > prevMs) {
                genuinelyAdvanced = true;
              }
            }

            let isRecent = true;
            if (newUpd) {
              const updMs = new Date(newUpd).getTime();
              if (!isNaN(updMs) && nowMs - updMs > 48 * 3600 * 1000) {
                isRecent = false;
              }
            }

            const lastNotifiedAt = Number(cooldownMap[lowerId] || 0);
            const withinCooldown = lastNotifiedAt > 0 && nowMs - lastNotifiedAt < 30 * 60 * 1000;

            knownMap[lowerId] = newStamp;
            mapChanged = true;

            if (genuinelyAdvanced && isRecent && !withinCooldown) {
              updatedList.push({ pkg, author, name, resolvedId, lowerId, stamp: newStamp });
            }
          }
        }

        if (mapChanged) {
          stateUpdates.knownPackageVersions = knownMap;
        }

        for (const item of updatedList.slice(0, 3)) {
          cooldownMap[item.lowerId] = nowMs;
          cooldownChanged = true;
          const typeLabel = String(item.pkg.type || 'mod').toUpperCase();
          const displayTitle = item.pkg.title || item.name;
          const thumb = item.pkg.thumbnail || item.pkg.thumbnail_url || '/icons/icon-192x192.png';
          await fireSwNotif(`Package Updated · [${typeLabel}] ${displayTitle}`, {
            body: `by ${item.author} — ${item.pkg.short_desc || 'New release available on LuantiHub.'}`,
            icon: thumb,
            badge: '/icons/badge-mono-96x96.png',
            tag: `lh-pkg-update-${item.lowerId}-${item.stamp}`,
            data: { packageId: item.resolvedId }
          });
        }

        if (cooldownChanged) {
          stateUpdates.packageUpdateCooldowns = cooldownMap;
        }
      }

      // 3. Evaluate Active Promotions
      const promotions = Array.isArray(bootPayload?.promotions) ? bootPayload.promotions : [];
      if (prefs.notifyPromotions && promotions.length > 0 && Array.isArray(state.seenPromotions)) {
        const seenPromoSet = new Set(state.seenPromotions.map((id) => String(id).trim()));
        let promoChanged = false;
        for (const promo of promotions) {
          if (!promo || !promo.id || !promo.title || !promo.expires_at) continue;
          const expMs = Date.parse(String(promo.expires_at));
          if (!Number.isFinite(expMs) || expMs <= nowMs) continue;
          const id = String(promo.id).trim();
          if (!seenPromoSet.has(id)) {
            seenPromoSet.add(id);
            promoChanged = true;
            const badge = String(promo.badge_text || 'PROMOTED').trim();
            await fireSwNotif(`${badge} · ${promo.title}`, {
              body: promo.short_desc || 'Check out the featured promotion on LuantiHub.',
              icon: promo.banner_url || '/icons/icon-192x192.png',
              badge: '/icons/badge-mono-96x96.png',
              tag: `lh-promo-${id}`,
              data: { ctaUrl: promo.cta_url }
            });
          }
        }
        if (promoChanged) {
          stateUpdates.seenPromotions = Array.from(seenPromoSet).slice(-100);
        }
      }

      if (notifiedTags.length > 0) {
        stateUpdates.seenTags = seenTagsList.slice(-300);
      }

      if (Object.keys(stateUpdates).length > 0) {
        await writeNotifStateFromSw(stateUpdates);
      }
    } catch {
      // Ignore background notification evaluation errors
    }
    return notifiedTags;
  }

  /**
   * Fetches the bundled LuantiHub boot payload (`/api/packages/?boot=1` containing
   * Home Page catalog tiles, Tags, Top 10 Today, Top 10 Week, and Hero Promotions),
   * caches it in CacheStorage (`lh-boot-sync-v1`), and broadcasts it to any open client windows.
   */
  async function fetchAndCacheBootCatalogInSw() {
    try {
      const response = await fetch('/api/packages/?boot=1&ngsw-bypass=true', {
        headers: {
          Accept: 'application/json',
          'ngsw-bypass': 'true'
        },
        cache: 'no-store'
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

      const syncedAt = Date.now();
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(BOOT_SYNC_CACHE_NAME);
        const cachedResponse = new Response(rawText, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-LuantiHub-Synced-At': String(syncedAt)
          }
        });
        await cache.put(BOOT_SYNC_CACHE_URL, cachedResponse);
      }

      const bootPayload = Array.isArray(parsed) ? { packages: parsed } : parsed;

      let hasVisibleClient = false;
      try {
        if (self.clients && typeof self.clients.matchAll === 'function') {
          const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          hasVisibleClient = Array.isArray(clientList) && clientList.some((c) => c && c.visibilityState === 'visible');
        }
      } catch {
        hasVisibleClient = false;
      }

      let notifiedTags = [];
      if (!hasVisibleClient) {
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

  // 3. Direct Message Trigger from Backgrounded/Minimized Client Windows
  self.addEventListener('message', (event) => {
    const data = event && event.data;
    if (data && data.type === 'LH_TRIGGER_BG_SYNC') {
      event.waitUntil(fetchAndCacheBootCatalogInSw());
    }
  });

  // 4. Native OS Notification Click Handler (focuses minimized/background window or opens new window)
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

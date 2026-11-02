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
    if (!prefs || prefs.notifyAppUpdates === false) return false;
    const baselineSig = typeof state.bootManifestSignature === 'string' ? state.bootManifestSignature : '';

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
      const fired = await fireSwNotif('LuantiHub Update Available', {
        body: 'A new version of LuantiHub is ready. Click to reload and update.',
        icon: '/icons/notif-app-update.png',
        badge: '/icons/icon-72x72.png',
        tag: updateTag,
        data: { action: 'reload_update', signature: remoteSig }
      });

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

  /**
   * Evaluates and displays OS-level notifications directly from the Service Worker
   * whenever no client window is actively focused (minimized, occluded, in a background tab, or closed),
   * and updates the OS taskbar/dock badge count via `self.navigator.setAppBadge()`.
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

      // 0. Evaluate App Update (`/ngsw.json`) in Service Worker
      await checkNgswAppUpdateInSw(state, prefs, fireSwNotif, stateUpdates);

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
          const thumb = item.pkg.thumbnail || item.pkg.thumbnail_url || '/icons/notif-new-package.png';
          await fireSwNotif(`New Git Package · [${typeLabel}] ${displayTitle}`, {
            body: `by ${item.author} — ${item.pkg.short_desc || 'New community Git repository published on LuantiHub.'}`,
            icon: thumb,
            badge: '/icons/icon-72x72.png',
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
        const cooldownMap = Object.assign(
          {},
          state.packageUpdateCooldowns || state.packageUpdateCooldown || {}
        );
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
          const thumb = item.pkg.thumbnail || item.pkg.thumbnail_url || '/icons/notif-package-update.png';
          await fireSwNotif(`Package Updated · [${typeLabel}] ${displayTitle}`, {
            body: `by ${item.author} — ${item.pkg.short_desc || 'New release available on LuantiHub.'}`,
            icon: thumb,
            badge: '/icons/icon-72x72.png',
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
              badge: '/icons/icon-72x72.png',
              tag: `lh-promo-${id}`,
              data: { ctaUrl: promo.cta_url }
            });
          }
        }
        if (promoChanged) {
          stateUpdates.seenPromotions = Array.from(seenPromoSet).slice(-100);
        }
      }

      // 4. Evaluate Latest Luanti Blog Post
      const blogPost = bootPayload?.latestBlogPost;
      if (prefs.notifyPromotions && blogPost && blogPost.title && blogPost.url && Array.isArray(state.seenBlogPosts)) {
        const seenBlogSet = new Set(state.seenBlogPosts.map((u) => String(u).trim()));
        const postKey = String(blogPost.url || blogPost.title).trim();
        if (postKey && !seenBlogSet.has(postKey)) {
          seenBlogSet.add(postKey);
          stateUpdates.seenBlogPosts = Array.from(seenBlogSet).slice(-50);
          await fireSwNotif(`Luanti Blog · ${blogPost.title}`, {
            body: blogPost.summary || 'Read the latest official Luanti blog post.',
            icon: blogPost.image_url || '/icons/icon-192x192.png',
            badge: '/icons/icon-72x72.png',
            tag: `lh-blog-${postKey.slice(-48)}`,
            data: { ctaUrl: blogPost.url }
          });
        }
      }

      // 5. Evaluate New Community Reviews
      const recentReviews = Array.isArray(bootPayload?.recentReviews) ? bootPayload.recentReviews : [];
      if (prefs.notifyNewReviews && recentReviews.length > 0 && Array.isArray(state.seenReviewIds) && state.seenReviewIds.length > 0) {
        const seenRevSet = new Set(state.seenReviewIds.map((id) => String(id).trim()));
        let revChanged = false;
        const newRevs = [];
        for (const rev of recentReviews) {
          const revId = String(rev?.id || '').trim();
          const pkgId = String(rev?.package_id || rev?.packageId || '').trim();
          if (!revId || !pkgId) continue;
          if (!seenRevSet.has(revId)) {
            seenRevSet.add(revId);
            revChanged = true;
            newRevs.push({ rev, revId, pkgId });
          }
        }
        if (revChanged) {
          stateUpdates.seenReviewIds = Array.from(seenRevSet).slice(-500);
        }
        for (const item of newRevs.slice(0, 3)) {
          const rating = Math.max(1, Math.min(5, Math.round(Number(item.rev.rating) || 5)));
          const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
          const pkgTitle = item.rev.package_title || item.pkgId.split('/')[1] || item.pkgId;
          const reviewer = item.rev.reviewer_display_name || item.rev.reviewer_username || 'Community Member';
          const thumb = item.rev.package_thumbnail || '/icons/icon-192x192.png';
          await fireSwNotif(`New Review · ${pkgTitle} (${stars})`, {
            body: `${reviewer}: "${String(item.rev.comment || item.rev.title || '').slice(0, 120)}"`,
            icon: thumb,
            badge: '/icons/icon-72x72.png',
            tag: `lh-new-review-${item.revId}`,
            data: { packageId: item.pkgId }
          });
        }
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

      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(BOOT_SYNC_CACHE_NAME);
          const prevRes = await cache.match(BOOT_SYNC_CACHE_URL);
          if (prevRes) {
            const headerTs = Number(prevRes.headers.get('X-LuantiHub-Synced-At') || 0);
            if (Number.isFinite(headerTs) && headerTs > cachedSyncedAt) {
              cachedSyncedAt = headerTs;
            }
            if (!forceNetwork && cachedSyncedAt > 0 && now - cachedSyncedAt < MIN_BG_CATALOG_SYNC_INTERVAL_MS) {
              const prevText = await prevRes.text();
              if (prevText) {
                const parsedPrev = JSON.parse(prevText);
                cachedBootPayload = Array.isArray(parsedPrev) ? { packages: parsedPrev } : parsedPrev;
              }
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

      const syncedAt = Date.now();
      lastSwBootFetchAt = syncedAt;
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

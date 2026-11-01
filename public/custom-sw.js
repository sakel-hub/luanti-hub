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
  const BROADCAST_CHANNEL_NAME = 'lh-pwa-sync';

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
      await broadcastSyncMessage({
        type: 'LH_BOOT_SYNC_UPDATED',
        ts: syncedAt,
        payload: bootPayload
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
})();

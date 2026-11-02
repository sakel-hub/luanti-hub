import { Injectable, effect, inject, signal } from '@angular/core';
import { SwUpdate, SwPush, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { SettingsService } from './settings.service';
import { HeroPromotion, LuantiBlogPost } from '../models/package.model';

export type NotificationVariant =
  | 'resolved'
  | 'dismissed'
  | 'moderation'
  | 'admin_queue'
  | 'app_update'
  | 'new_git_package'
  | 'package_update'
  | 'new_review'
  | 'promotion';

export interface NativeNotificationPayload {
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
  variant?: NotificationVariant;
  icon?: string;
  image?: string;
  data?: {
    targetTab?: 'moderation' | 'account' | 'packages' | 'promotions';
    packageId?: string;
    reportId?: string;
    ctaUrl?: string;
    action?: 'reload_update';
  };
}

const SEEN_NOTIFICATION_TAGS_KEY = 'lh_seen_notification_tags';
const KNOWN_GIT_PACKAGES_KEY = 'lh_known_git_packages_v1';
const KNOWN_PACKAGE_VERSIONS_KEY = 'lh_known_package_versions_v1';
const SEEN_REVIEWS_KEY = 'lh_seen_reviews_v1';
const SEEN_PROMOTIONS_KEY = 'lh_seen_promotions_v1';
const SEEN_BLOG_POSTS_KEY = 'lh_seen_blog_posts_v1';
const PACKAGE_UPDATE_COOLDOWN_KEY = 'luantihub_pkg_notify_cooldown_v1';
const PACKAGE_UPDATE_COOLDOWN_MS = 12 * 3600 * 1000;
const PWA_INSTALLED_STORAGE_KEY = 'lh_pwa_installed';
const MAX_SEEN_TAGS = 100;

export const BOOT_SYNC_CACHE_NAME = 'lh-boot-sync-v1';
export const BOOT_SYNC_CACHE_URL = '/api/packages/?boot=1';
export const PERIODIC_SYNC_TAG = 'lh-periodic-catalog-sync';
export const PERIODIC_SYNC_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours suggested interval
export const ONE_OFF_OUTBOX_SYNC_TAG = 'lh-sync-outbox';
export const ONE_OFF_CATALOG_SYNC_TAG = 'lh-sync-catalog';
export const PWA_SYNC_BROADCAST_CHANNEL = 'lh-pwa-sync';

const OUTBOX_DB_NAME = 'lh_sync_outbox_db';
const OUTBOX_STORE_NAME = 'outbox';
const OUTBOX_FALLBACK_STORAGE_KEY = 'lh_sync_outbox_fallback_v1';
const MAX_OUTBOX_ITEMS = 100;
const NOTIF_STATE_DB_NAME = 'lh_pwa_notif_state_db';
const NOTIF_STATE_STORE_NAME = 'state';

function openNotifStateIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || !indexedDB || typeof indexedDB.open !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
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

async function writeNotifStateEntries(entries: Record<string, any>): Promise<void> {
  const db = await openNotifStateIndexedDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(NOTIF_STATE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(NOTIF_STATE_STORE_NAME);
      for (const [key, value] of Object.entries(entries)) {
        store.put({ key, value, updatedAt: Date.now() });
      }
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
        resolve();
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {}
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve();
    }
  });
}

async function readAllNotifStateEntries(): Promise<Record<string, any>> {
  const db = await openNotifStateIndexedDb();
  if (!db) return {};
  return await new Promise<Record<string, any>>(resolve => {
    try {
      const tx = db.transaction(NOTIF_STATE_STORE_NAME, 'readonly');
      const store = tx.objectStore(NOTIF_STATE_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const out: Record<string, any> = {};
        for (const item of Array.isArray(req.result) ? req.result : []) {
          if (item && typeof item.key === 'string') {
            out[item.key] = item.value;
          }
        }
        resolve(out);
      };
      req.onerror = () => resolve({});
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {}
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {}
      };
    } catch {
      try {
        db.close();
      } catch {}
      resolve({});
    }
  });
}

export interface BackgroundSyncOutboxItem {
  id: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  tag?: string;
  createdAt: number;
}

function openOutboxIndexedDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || !indexedDB || typeof indexedDB.open !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(OUTBOX_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
          db.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function readFallbackOutbox(): BackgroundSyncOutboxItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(OUTBOX_FALLBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x: any) => x && typeof x.id === 'string' && typeof x.url === 'string') : [];
  } catch {
    return [];
  }
}

function writeFallbackOutbox(items: BackgroundSyncOutboxItem[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = items.slice(-MAX_OUTBOX_ITEMS);
    if (trimmed.length === 0) {
      localStorage.removeItem(OUTBOX_FALLBACK_STORAGE_KEY);
    } else {
      localStorage.setItem(OUTBOX_FALLBACK_STORAGE_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function closeOutboxIndexedDb(db: IDBDatabase | null | undefined): void {
  try {
    db?.close();
  } catch {
    // ignore
  }
}

async function saveItemToOutboxStorage(item: BackgroundSyncOutboxItem): Promise<void> {
  const existing = readFallbackOutbox().filter(x => x.id !== item.id);
  existing.push(item);
  writeFallbackOutbox(existing);

  const db = await openOutboxIndexedDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const finish = () => {
      closeOutboxIndexedDb(db);
      resolve();
    };
    try {
      const tx = db.transaction(OUTBOX_STORE_NAME, 'readwrite');
      tx.objectStore(OUTBOX_STORE_NAME).put(item);
      tx.oncomplete = finish;
      tx.onerror = finish;
    } catch {
      finish();
    }
  });
}

async function readAllItemsFromOutboxStorage(): Promise<BackgroundSyncOutboxItem[]> {
  const byId = new Map<string, BackgroundSyncOutboxItem>();
  for (const item of readFallbackOutbox()) {
    byId.set(item.id, item);
  }

  const db = await openOutboxIndexedDb();
  if (db) {
    const idbItems = await new Promise<BackgroundSyncOutboxItem[]>(resolve => {
      try {
        const tx = db.transaction(OUTBOX_STORE_NAME, 'readonly');
        const req = tx.objectStore(OUTBOX_STORE_NAME).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
        tx.oncomplete = () => closeOutboxIndexedDb(db);
        tx.onerror = () => closeOutboxIndexedDb(db);
      } catch {
        closeOutboxIndexedDb(db);
        resolve([]);
      }
    });
    for (const item of idbItems) {
      if (item && typeof item.id === 'string' && typeof item.url === 'string') {
        byId.set(item.id, item);
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function removeItemFromOutboxStorage(id: string): Promise<void> {
  const remaining = readFallbackOutbox().filter(x => x.id !== id);
  writeFallbackOutbox(remaining);

  const db = await openOutboxIndexedDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const finish = () => {
      closeOutboxIndexedDb(db);
      resolve();
    };
    try {
      const tx = db.transaction(OUTBOX_STORE_NAME, 'readwrite');
      tx.objectStore(OUTBOX_STORE_NAME).delete(id);
      tx.oncomplete = finish;
      tx.onerror = finish;
    } catch {
      finish();
    }
  });
}

/**
 * Queues a failed or offline mutation (e.g. `POST /api/auth/favorites` or `POST /api/packages/hydrate`)
 * into IndexedDB (`lh_sync_outbox_db`) + localStorage fallback and registers a W3C Background Sync
 * (`registration.sync.register('lh-sync-outbox')`) so the Service Worker replays it when online.
 */
export async function enqueueBackgroundSyncMutation(
  spec: Omit<BackgroundSyncOutboxItem, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): Promise<boolean> {
  if (!spec?.url) return false;
  const item: BackgroundSyncOutboxItem = {
    id: spec.id || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    url: spec.url,
    method: spec.method || 'POST',
    headers: spec.headers || { 'Content-Type': 'application/json' },
    body: typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? {}),
    tag: spec.tag || ONE_OFF_OUTBOX_SYNC_TAG,
    createdAt: spec.createdAt ?? Date.now()
  };

  await saveItemToOutboxStorage(item);

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'sync' in reg && typeof (reg as any).sync?.register === 'function') {
        await (reg as any).sync.register(item.tag || ONE_OFF_OUTBOX_SYNC_TAG);
        return true;
      }
    } catch {
      // Fallback to online event listener when SyncManager registration is unavailable
    }
  }
  return false;
}

/**
 * Flushes all queued mutations in the Background Sync outbox.
 * Used both as a foreground online fallback (for Safari/Firefox) and in unit tests.
 */
export async function flushBackgroundSyncOutbox(): Promise<number> {
  if (typeof fetch !== 'function') return 0;
  const items = await readAllItemsFromOutboxStorage();
  if (items.length === 0) return 0;

  let flushed = 0;
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method || 'POST',
        headers: item.headers || { 'Content-Type': 'application/json' },
        body: typeof item.body === 'string' ? item.body : JSON.stringify(item.body ?? {}),
        credentials: 'same-origin'
      });
      if (res && (res.ok || (res.status >= 400 && res.status < 500))) {
        await removeItemFromOutboxStorage(item.id);
        if (res.ok) {
          flushed++;
        }
      }
    } catch {
      // Stop on network failure and keep remaining items queued for next sync
      break;
    }
  }
  return flushed;
}

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly settingsService = inject(SettingsService);

  readonly updateAvailable = signal<boolean>(false);
  readonly canInstall = signal<boolean>(false);
  readonly isInstalled = signal<boolean>(this.checkIfInstalled());
  readonly isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  readonly checkingForUpdate = signal<boolean>(false);
  readonly statusMessage = signal<string | null>(null);
  readonly notificationPermission = signal<NotificationPermission>(this.readBrowserNotificationPermission());
  readonly periodicSyncRegistered = signal<boolean>(false);
  readonly backgroundSyncSupported = signal<boolean>(
    typeof window !== 'undefined' && 'SyncManager' in window
  );
  readonly isWcoActive = signal<boolean>(false);
  readonly isWcoCompact = signal<boolean>(false);
  readonly wcoTitlebarRect = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  readonly canNavigateBack = signal<boolean>(false);
  readonly canNavigateForward = signal<boolean>(false);

  private deferredPrompt: any = null;
  private messageClearTimer: any = null;
  private notificationClickHandler: ((data: any) => void) | null = null;
  private readonly catalogSyncHandlers: Array<
    (event: { source: 'sw-broadcast' | 'online' | 'visibility'; payload?: any; ts?: number }) => void
  > = [];
  private syncBroadcastChannel: BroadcastChannel | null = null;
  private latestDetectedUpdateVersion: string | null = null;
  private bootManifestSignature: string | null = null;
  private lastNotificationClickSig = '';
  private lastNotificationClickAt = 0;
  private navHistoryCursor = 0;
  private navHistoryMaxCursor = 0;
  private readonly localAssetDataUrlCache = new Map<string, string>();

  constructor() {
    this.initSwUpdate();
    this.initInstallPrompt();
    this.initWindowControlsOverlay();
    this.initNotificationClickRouting();
    this.initPermissionStatusWatcher();
    this.initNetworkStatusWatcher();
    this.initBroadcastChannelSyncWatcher();
    this.initBackgroundAndPeriodicSync();
    this.initLocalNotificationIconsCache();
    this.reconcileNotifStateFromIndexedDb().catch(() => {});

    effect(() => {
      const prefs = {
        notificationsEnabled: this.settingsService.notificationsEnabled(),
        notifyAppUpdates: this.settingsService.notifyAppUpdates(),
        notifyPackageUpdates: this.settingsService.notifyPackageUpdates(),
        notifyNewGitPackages: this.settingsService.notifyNewGitPackages(),
        notifyNewReviews: this.settingsService.notifyNewReviews(),
        notifyPromotions: this.settingsService.notifyPromotions(),
        favorites: this.settingsService.favorites(),
        downloadedPackages: this.settingsService.downloadedPackages()
      };
      this.syncNotificationStateToIndexedDb(prefs).catch(() => {});
    });
  }

  /**
   * Synchronizes notification preferences and deduplication stamps from `localStorage` into
   * IndexedDB (`lh_pwa_notif_state_db`) so the Service Worker can evaluate and dispatch
   * background notifications when all app windows are minimized, unfocused, or closed.
   */
  async syncNotificationStateToIndexedDb(customPrefs?: Record<string, any>): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const parseJsonSafe = (key: string, fallback: any) => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : fallback;
        } catch {
          return fallback;
        }
      };
      const prefs = customPrefs || {
        notificationsEnabled: this.settingsService.notificationsEnabled(),
        notifyAppUpdates: this.settingsService.notifyAppUpdates(),
        notifyPackageUpdates: this.settingsService.notifyPackageUpdates(),
        notifyNewGitPackages: this.settingsService.notifyNewGitPackages(),
        notifyNewReviews: this.settingsService.notifyNewReviews(),
        notifyPromotions: this.settingsService.notifyPromotions(),
        favorites: this.settingsService.favorites(),
        downloadedPackages: this.settingsService.downloadedPackages()
      };
      const seenReviews = parseJsonSafe(SEEN_REVIEWS_KEY, null);
      const packageUpdateCooldown = parseJsonSafe(PACKAGE_UPDATE_COOLDOWN_KEY, {});
      const entries: Record<string, any> = {
        prefs,
        seenTags: parseJsonSafe(SEEN_NOTIFICATION_TAGS_KEY, []),
        knownGitPackages: parseJsonSafe(KNOWN_GIT_PACKAGES_KEY, null),
        knownPackageVersions: parseJsonSafe(KNOWN_PACKAGE_VERSIONS_KEY, null),
        seenPromotions: parseJsonSafe(SEEN_PROMOTIONS_KEY, []),
        seenBlogPosts: parseJsonSafe(SEEN_BLOG_POSTS_KEY, []),
        seenReviews,
        seenReviewIds: seenReviews,
        packageUpdateCooldown,
        packageUpdateCooldowns: packageUpdateCooldown
      };
      if (this.bootManifestSignature) {
        entries['bootManifestSignature'] = this.bootManifestSignature;
      }
      await writeNotifStateEntries(entries);
    } catch {
      // Ignore IndexedDB sync errors
    }
  }

  /**
   * Reconciles any notification tags or package stamps recorded by the Service Worker in
   * IndexedDB (`lh_pwa_notif_state_db`) back into `localStorage` so focusing/restoring a
   * minimized window never re-fires duplicate notifications.
   */
  async reconcileNotifStateFromIndexedDb(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    try {
      const state = await readAllNotifStateEntries();
      if (!state || Object.keys(state).length === 0) return;

      if (typeof state['bootManifestSignature'] === 'string' && state['bootManifestSignature']) {
        if (!this.bootManifestSignature) {
          this.bootManifestSignature = state['bootManifestSignature'];
        }
      }

      if (Array.isArray(state['seenTags']) && state['seenTags'].length > 0) {
        for (const tag of state['seenTags']) {
          if (typeof tag === 'string' && tag) {
            this.markNotificationTagSeen(tag, false);
          }
        }
      }

      if (Array.isArray(state['seenPromotions']) && state['seenPromotions'].length > 0) {
        try {
          const raw = localStorage.getItem(SEEN_PROMOTIONS_KEY);
          const existing = raw ? JSON.parse(raw) : [];
          const merged = Array.from(
            new Set([
              ...(Array.isArray(existing) ? existing : []),
              ...state['seenPromotions'].filter((id: any) => typeof id === 'string')
            ])
          ).slice(-100);
          localStorage.setItem(SEEN_PROMOTIONS_KEY, JSON.stringify(merged));
        } catch {}
      }

      if (Array.isArray(state['seenBlogPosts']) && state['seenBlogPosts'].length > 0) {
        try {
          const raw = localStorage.getItem(SEEN_BLOG_POSTS_KEY);
          const existing = raw ? JSON.parse(raw) : [];
          const merged = Array.from(
            new Set([
              ...(Array.isArray(existing) ? existing : []),
              ...state['seenBlogPosts'].filter((id: any) => typeof id === 'string')
            ])
          ).slice(-50);
          localStorage.setItem(SEEN_BLOG_POSTS_KEY, JSON.stringify(merged));
        } catch {}
      }

      const swSeenReviews = Array.isArray(state['seenReviewIds'])
        ? state['seenReviewIds']
        : Array.isArray(state['seenReviews'])
          ? state['seenReviews']
          : null;
      if (swSeenReviews && swSeenReviews.length > 0) {
        try {
          const raw = localStorage.getItem(SEEN_REVIEWS_KEY);
          const existing = raw ? JSON.parse(raw) : [];
          const merged = Array.from(
            new Set([
              ...(Array.isArray(existing) ? existing : []),
              ...swSeenReviews.filter((id: any) => typeof id === 'string')
            ])
          ).slice(-500);
          localStorage.setItem(SEEN_REVIEWS_KEY, JSON.stringify(merged));
        } catch {}
      }

      if (Array.isArray(state['knownGitPackages']) && state['knownGitPackages'].length > 0) {
        try {
          const raw = localStorage.getItem(KNOWN_GIT_PACKAGES_KEY);
          const existing = raw ? JSON.parse(raw) : [];
          const merged = Array.from(
            new Set([
              ...(Array.isArray(existing) ? existing : []),
              ...state['knownGitPackages'].filter((id: any) => typeof id === 'string')
            ])
          ).slice(-2000);
          localStorage.setItem(KNOWN_GIT_PACKAGES_KEY, JSON.stringify(merged));
        } catch {}
      }

      if (
        state['knownPackageVersions'] &&
        typeof state['knownPackageVersions'] === 'object' &&
        !Array.isArray(state['knownPackageVersions'])
      ) {
        try {
          const raw = localStorage.getItem(KNOWN_PACKAGE_VERSIONS_KEY);
          const existing = raw ? JSON.parse(raw) : {};
          const merged = {
            ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
            ...state['knownPackageVersions']
          };
          localStorage.setItem(KNOWN_PACKAGE_VERSIONS_KEY, JSON.stringify(merged));
        } catch {}
      }
    } catch {
      // Ignore IndexedDB reconciliation errors
    }
  }

  /**
   * Triggers an unthrottled background catalog fetch inside the Service Worker (`LH_TRIGGER_BG_SYNC`),
   * ensuring catalog updates and native notifications continue smoothly even when the app window is minimized.
   */
  triggerSwBackgroundCatalogCheck(): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) {
      return;
    }
    try {
      const msg = { type: 'LH_TRIGGER_BG_SYNC', ts: Date.now() };
      if (navigator.serviceWorker.controller && typeof navigator.serviceWorker.controller.postMessage === 'function') {
        navigator.serviceWorker.controller.postMessage(msg);
        return;
      }
      navigator.serviceWorker
        .getRegistration()
        .then(reg => {
          if (reg?.active && typeof reg.active.postMessage === 'function') {
            reg.active.postMessage(msg);
          }
        })
        .catch(() => {});
    } catch {
      // Ignore SW postMessage errors
    }
  }

  private initNetworkStatusWatcher(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isOnline.set(true);
      this.showToast('pwa.backOnline', 3000);
      this.flushOutboxMutations().catch(() => {});
      this.notifyCatalogSyncListeners({ source: 'online', ts: Date.now() });
    });

    window.addEventListener('offline', () => {
      this.isOnline.set(false);
      this.showToast('pwa.offlineModeToast', 4000);
    });
  }

  /**
   * Listens for background sync and periodic sync completion messages from the Service Worker
   * via `BroadcastChannel('lh-pwa-sync')` and `navigator.serviceWorker` `message` events.
   */
  private initBroadcastChannelSyncWatcher(): void {
    if (typeof window === 'undefined') return;

    const handleSyncMessage = (data: any) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'LH_BOOT_SYNC_UPDATED' && data.payload) {
        if (Array.isArray(data.notifiedTags)) {
          for (const tag of data.notifiedTags) {
            if (typeof tag === 'string' && tag) {
              this.markNotificationTagSeen(tag, false);
            }
          }
        }
        this.reconcileNotifStateFromIndexedDb().catch(() => {});
        this.notifyCatalogSyncListeners({
          source: 'sw-broadcast',
          payload: data.payload,
          ts: Number(data.ts || Date.now())
        });
      } else if (data.type === 'LH_APP_UPDATE_DETECTED') {
        if (typeof data.tag === 'string' && data.tag) {
          this.markNotificationTagSeen(data.tag, false);
        }
        const sig = String(data.signature || 'ready').trim();
        this.latestDetectedUpdateVersion = sig;
        this.updateAvailable.set(true);
        if (!data.notified) {
          this.notifyAppUpdateAvailable(sig);
        }
      } else if (data.type === 'LH_OUTBOX_SYNC_COMPLETED') {
        writeFallbackOutbox([]);
      } else if (data.type === 'LH_NOTIFICATION_CLICK' && data.data) {
        this.handleNotificationAction(data.data);
      }
    };

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.syncBroadcastChannel = new BroadcastChannel(PWA_SYNC_BROADCAST_CHANNEL);
        this.syncBroadcastChannel.onmessage = (event: MessageEvent) => {
          handleSyncMessage(event?.data);
        };
      }
    } catch {
      // BroadcastChannel not supported in this environment
    }

    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
        if (typeof navigator.serviceWorker.addEventListener === 'function') {
          navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
            handleSyncMessage(event?.data);
          });
        }
      }
    } catch {
      // Ignore SW message listener errors
    }
  }

  /**
   * Registers W3C Periodic Background Sync (`periodicsync`) and detects One-Off Background Sync (`sync`)
   * capabilities on the active ServiceWorkerRegistration.
   */
  async initBackgroundAndPeriodicSync(): Promise<boolean> {
    const reg = await this.resolveActiveSwRegistration(2500);
    if (!reg) return false;

    if ('sync' in reg || (typeof window !== 'undefined' && 'SyncManager' in window)) {
      this.backgroundSyncSupported.set(true);
    }

    return await this.registerPeriodicCatalogSync(reg);
  }

  /**
   * Registers Periodic Background Sync (`lh-periodic-catalog-sync`) so the Service Worker can
   * periodically fetch `/api/packages/?boot=1` in the background when the PWA is not open.
   */
  async registerPeriodicCatalogSync(
    registration?: ServiceWorkerRegistration | null,
    minIntervalMs = PERIODIC_SYNC_MIN_INTERVAL_MS
  ): Promise<boolean> {
    const reg = registration ?? (await this.resolveActiveSwRegistration(2500));
    if (!reg || !('periodicSync' in reg) || typeof (reg as any).periodicSync?.register !== 'function') {
      this.periodicSyncRegistered.set(false);
      return false;
    }

    try {
      const perms = typeof navigator !== 'undefined' ? (navigator as any).permissions : null;
      if (perms && typeof perms.query === 'function') {
        const status = await perms.query({ name: 'periodic-background-sync' as PermissionName });
        if (status && status.state !== 'granted') {
          this.periodicSyncRegistered.set(false);
          return false;
        }
      }

      if (typeof (reg as any).periodicSync.getTags === 'function') {
        const existingTags = await (reg as any).periodicSync.getTags();
        if (Array.isArray(existingTags) && existingTags.includes(PERIODIC_SYNC_TAG)) {
          this.periodicSyncRegistered.set(true);
          return true;
        }
      }

      await (reg as any).periodicSync.register(PERIODIC_SYNC_TAG, {
        minInterval: minIntervalMs
      });
      this.periodicSyncRegistered.set(true);
      return true;
    } catch {
      this.periodicSyncRegistered.set(false);
      return false;
    }
  }

  /**
   * Requests a one-off Service Worker Background Sync (`lh-sync-catalog`) to refresh the catalog
   * and Top 10 rows as soon as network connectivity is restored.
   */
  async requestCatalogBackgroundSync(): Promise<boolean> {
    const reg = await this.resolveActiveSwRegistration(1500);
    if (!reg || !('sync' in reg) || typeof (reg as any).sync?.register !== 'function') {
      return false;
    }
    try {
      await (reg as any).sync.register(ONE_OFF_CATALOG_SYNC_TAG);
      this.backgroundSyncSupported.set(true);
      return true;
    } catch {
      return false;
    }
  }

  async queueBackgroundMutation(
    spec: Omit<BackgroundSyncOutboxItem, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ): Promise<boolean> {
    return await enqueueBackgroundSyncMutation(spec);
  }

  async flushOutboxMutations(): Promise<number> {
    return await flushBackgroundSyncOutbox();
  }

  async getQueuedOutboxMutations(): Promise<BackgroundSyncOutboxItem[]> {
    return await readAllItemsFromOutboxStorage();
  }

  registerCatalogSyncHandler(
    handler: (event: { source: 'sw-broadcast' | 'online' | 'visibility'; payload?: any; ts?: number }) => void
  ): void {
    this.catalogSyncHandlers.push(handler);
  }

  private notifyCatalogSyncListeners(event: {
    source: 'sw-broadcast' | 'online' | 'visibility';
    payload?: any;
    ts?: number;
  }): void {
    for (const handler of this.catalogSyncHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  private initPermissionStatusWatcher(): void {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const perms = (navigator as any).permissions;
    if (!perms || typeof perms.query !== 'function') return;

    try {
      perms
        .query({ name: 'notifications' as PermissionName })
        .then((status: PermissionStatus) => {
          if (!status) return;
          const syncState = () => {
            const currentPerm = this.readBrowserNotificationPermission();
            const mappedPerm: NotificationPermission =
              status.state === 'granted'
                ? 'granted'
                : status.state === 'denied'
                  ? 'denied'
                  : currentPerm === 'granted' && status.state === 'prompt'
                    ? 'default'
                    : currentPerm;
            this.notificationPermission.set(mappedPerm);
            if (mappedPerm !== 'granted' && this.settingsService.notificationsEnabled()) {
              this.settingsService.notificationsEnabled.set(false);
            }
          };
          syncState();
          status.onchange = () => syncState();
        })
        .catch(() => {
          // Permissions API query for notifications not supported
        });
    } catch {
      // Ignore unsupported Permissions API errors
    }
  }

  private readBrowserNotificationPermission(): NotificationPermission {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return 'default';
    }
    return Notification.permission;
  }

  private isStandaloneDisplayMode(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const mm = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
      const isStandaloneMedia = Boolean(
        mm &&
        (mm('(display-mode: standalone)')?.matches ||
         mm('(display-mode: window-controls-overlay)')?.matches ||
         mm('(display-mode: minimal-ui)')?.matches ||
         mm('(display-mode: fullscreen)')?.matches)
      );
      const isNavigatorStandalone = (window.navigator as any)?.standalone === true;
      const isAndroidReferrer = typeof document !== 'undefined' && Boolean(document.referrer?.includes('android-app://'));
      return Boolean(isStandaloneMedia || isNavigatorStandalone || isAndroidReferrer);
    } catch {
      return false;
    }
  }

  private checkIfInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    if (this.isStandaloneDisplayMode()) {
      try {
        localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
      } catch {
        // ignore storage errors
      }
      return true;
    }
    try {
      return localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private notifyAppUpdateAvailable(versionIdentifier?: string): void {
    this.updateAvailable.set(true);
    this.statusMessage.set(null);
    const versionKey = String(versionIdentifier || this.latestDetectedUpdateVersion || 'ready').trim();
    this.latestDetectedUpdateVersion = versionKey;
    this.sendNativeNotification({
      title: 'LuantiHub Update Available',
      body: 'A new version of LuantiHub is ready. Click to reload with the latest features.',
      tag: `lh-app-update-${versionKey}`,
      category: 'app_update',
      variant: 'app_update',
      data: { action: 'reload_update' }
    });
  }

  private initSwUpdate(): void {
    if (this.swUpdate?.isEnabled) {
      // 1. Listen for version ready
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe((evt) => {
          const hash = (evt as any).latestVersion?.hash || this.latestDetectedUpdateVersion || Date.now();
          this.notifyAppUpdateAvailable(String(hash));
        });

      if ((this.swUpdate as any).unrecoverable) {
        (this.swUpdate as any).unrecoverable.subscribe(() => {
          this.notifyAppUpdateAvailable('unrecoverable');
        });
      }

      if (typeof window !== 'undefined') {
        // 2. Startup check shortly after boot (catches new deployments when SW serves cached index.html)
        setTimeout(() => {
          if (this.isOnline()) {
            this.checkForUpdate(false);
          }
        }, 5000);

        // Periodic wakeup check (15-min cadence aligned with Cloudflare Edge Cache TTL):
        // delegates to the Service Worker when minimized/unfocused so update notifications fire in the background without exhausting D1 quota
        setInterval(() => {
          if (!this.isOnline()) return;
          const isHiddenOrUnfocused =
            typeof document !== 'undefined' &&
            (document.visibilityState === 'hidden' ||
              (typeof document.hasFocus === 'function' && !document.hasFocus()));
          if (isHiddenOrUnfocused) {
            this.triggerSwBackgroundCatalogCheck();
          } else {
            this.checkForUpdate(false);
          }
        }, 15 * 60 * 1000);
      }
    }

    // 3. Event-driven background sync & visibility/focus handoff (W3C / Edge / PWABuilder best practices)
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const SW_HANDOFF_COOLDOWN_MS = 15 * 60 * 1000;
      let lastStateSyncAt = 0;
      let lastSwCatalogCheckAt = 0;
      let lastVisibilityCheckAt = Date.now();

      const handoffToServiceWorker = (forceStateSync = false) => {
        const now = Date.now();
        if (!forceStateSync && now - lastStateSyncAt < 3000) return;
        lastStateSyncAt = now;
        this.syncNotificationStateToIndexedDb()
          .catch(() => {})
          .finally(() => {
            this.registerPeriodicCatalogSync().catch(() => {});
            if (now - lastSwCatalogCheckAt >= SW_HANDOFF_COOLDOWN_MS) {
              lastSwCatalogCheckAt = now;
              this.triggerSwBackgroundCatalogCheck();
            }
          });
      };

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          handoffToServiceWorker(true);
        } else if (document.visibilityState === 'visible' && this.isOnline()) {
          this.syncAppBadge(0).catch(() => {});
          this.reconcileNotifStateFromIndexedDb()
            .catch(() => {})
            .finally(() => {
              const now = Date.now();
              if (now - lastVisibilityCheckAt >= SW_HANDOFF_COOLDOWN_MS) {
                lastVisibilityCheckAt = now;
                this.checkForUpdate(false);
                this.notifyCatalogSyncListeners({ source: 'visibility', ts: now });
              }
            });
        }
      });

      window.addEventListener('blur', () => {
        handoffToServiceWorker(false);
      });

      window.addEventListener('focus', () => {
        if (this.isOnline()) {
          this.syncAppBadge(0).catch(() => {});
          this.reconcileNotifStateFromIndexedDb().catch(() => {});
        }
      });

      window.addEventListener('pagehide', () => {
        handoffToServiceWorker(true);
      });
    }
  }

  /**
   * Initializes desktop PWA Window Controls Overlay (`navigator.windowControlsOverlay`)
   * geometry tracking, `.wco-active` root class toggling, and history Back/Forward state tracking.
   */
  initWindowControlsOverlay(): void {
    if (typeof window === 'undefined') return;

    const updateWcoState = () => {
      try {
        const wco = typeof navigator !== 'undefined' ? (navigator as any).windowControlsOverlay : null;
        const mm = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
        const mqlMatches = Boolean(mm && mm('(display-mode: window-controls-overlay)')?.matches);
        const visible = Boolean(wco?.visible || mqlMatches);
        this.isWcoActive.set(visible);

        const docEl = typeof document !== 'undefined' ? document.documentElement : null;
        if (wco && typeof wco.getTitlebarAreaRect === 'function' && visible) {
          const rect = wco.getTitlebarAreaRect();
          if (rect && typeof rect.width === 'number' && rect.width > 0) {
            const x = Math.max(0, Number(rect.x || 0));
            const y = Math.max(0, Number(rect.y || 0));
            const width = Math.max(0, Number(rect.width || 0));
            const height = Math.max(38, Number(rect.height || 38));
            const winW = Number(window.innerWidth || x + width);
            const rightInset = Math.max(0, winW - x - width);
            this.wcoTitlebarRect.set({ x, y, width, height });
            this.isWcoCompact.set(width < 1180);
            if (docEl?.style) {
              docEl.style.setProperty('--wco-titlebar-x', `${x}px`);
              docEl.style.setProperty('--wco-titlebar-width', `${width}px`);
              docEl.style.setProperty('--wco-titlebar-height', `${height}px`);
              docEl.style.setProperty('--wco-right-inset', `${rightInset}px`);
            }
          } else {
            this.wcoTitlebarRect.set(null);
            const estWidth = Math.max(0, Number(window.innerWidth || 1280) - 225);
            this.isWcoCompact.set(estWidth < 1180);
          }
        } else if (visible) {
          this.wcoTitlebarRect.set(null);
          const estWidth = Math.max(0, Number(window.innerWidth || 1280) - 225);
          this.isWcoCompact.set(estWidth < 1180);
        } else {
          this.wcoTitlebarRect.set(null);
          this.isWcoCompact.set(false);
          if (docEl?.style) {
            docEl.style.removeProperty('--wco-titlebar-x');
            docEl.style.removeProperty('--wco-titlebar-width');
            docEl.style.removeProperty('--wco-titlebar-height');
            docEl.style.removeProperty('--wco-right-inset');
          }
        }

        if (docEl?.classList) {
          docEl.classList.toggle('wco-active', visible);
        }
      } catch {
        // Ignore unsupported WCO environments
      }
    };

    updateWcoState();

    try {
      window.addEventListener('resize', () => updateWcoState(), { passive: true });
    } catch {
      // ignore
    }

    try {
      const wco = typeof navigator !== 'undefined' ? (navigator as any).windowControlsOverlay : null;
      if (wco && typeof wco.addEventListener === 'function') {
        let debounceTimer: any = null;
        wco.addEventListener('geometrychange', () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          updateWcoState();
          debounceTimer = setTimeout(() => updateWcoState(), 80);
        });
      }
    } catch {
      // ignore
    }

    try {
      if (typeof window.matchMedia === 'function') {
        const wcoMql = window.matchMedia('(display-mode: window-controls-overlay)');
        if (typeof wcoMql?.addEventListener === 'function') {
          wcoMql.addEventListener('change', () => updateWcoState());
        }
      }
    } catch {
      // ignore
    }

    this.initNavigationHistoryTracker();
  }

  private initNavigationHistoryTracker(): void {
    if (typeof window === 'undefined') return;

    this.updateNavigationHistoryState();

    try {
      const navApi = (window as any).navigation;
      if (navApi && typeof navApi.addEventListener === 'function') {
        navApi.addEventListener('currententrychange', () => {
          this.updateNavigationHistoryState();
        });
      }
    } catch {
      // ignore
    }

    window.addEventListener('popstate', () => {
      this.updateNavigationHistoryState();
    });

    try {
      if (typeof window.history !== 'undefined' && window.history) {
        const currentPush = window.history.pushState;
        const origPushState: typeof window.history.pushState =
          (currentPush as any)?.__lhOrigPushState || currentPush;
        if (typeof origPushState === 'function') {
          const self = this;
          const wrappedPush = function (this: History, data: any, unused: string, url?: string | URL | null) {
            self.navHistoryCursor += 1;
            self.navHistoryMaxCursor = self.navHistoryCursor;
            const nextData =
              data && typeof data === 'object'
                ? { ...data, __lhNavIdx: self.navHistoryCursor }
                : { __lhNavIdx: self.navHistoryCursor };
            const res = origPushState.call(this, nextData, unused, url);
            self.updateNavigationHistoryState(false);
            return res;
          };
          (wrappedPush as any).__lhOrigPushState = origPushState;
          window.history.pushState = wrappedPush;
        }

        const currentReplace = window.history.replaceState;
        const origReplaceState: typeof window.history.replaceState =
          (currentReplace as any)?.__lhOrigReplaceState || currentReplace;
        if (typeof origReplaceState === 'function') {
          const self = this;
          const wrappedReplace = function (this: History, data: any, unused: string, url?: string | URL | null) {
            const nextData =
              data && typeof data === 'object'
                ? { ...data, __lhNavIdx: self.navHistoryCursor }
                : { __lhNavIdx: self.navHistoryCursor };
            const res = origReplaceState.call(this, nextData, unused, url);
            self.updateNavigationHistoryState(false);
            return res;
          };
          (wrappedReplace as any).__lhOrigReplaceState = origReplaceState;
          window.history.replaceState = wrappedReplace;
        }
      }
    } catch {
      // ignore history wrapping errors
    }
  }

  updateNavigationHistoryState(syncFromHistoryState = true): void {
    if (typeof window === 'undefined') return;
    try {
      if (syncFromHistoryState) {
        const state = window.history?.state;
        const idx =
          state && typeof state === 'object' && typeof state.__lhNavIdx === 'number'
            ? state.__lhNavIdx
            : typeof state?.navigationId === 'number'
              ? state.navigationId - 1
              : null;
        if (typeof idx === 'number' && idx >= 0) {
          this.navHistoryCursor = idx;
          if (idx > this.navHistoryMaxCursor) {
            this.navHistoryMaxCursor = idx;
          }
        }
      }

      const navApi = (window as any).navigation;
      const navBack = Boolean(navApi && typeof navApi.canGoBack === 'boolean' && navApi.canGoBack);
      const navForward = Boolean(navApi && typeof navApi.canGoForward === 'boolean' && navApi.canGoForward);
      const historyLen = Number(window.history?.length || 1);

      this.canNavigateBack.set(navBack || this.navHistoryCursor > 0 || historyLen > 1);
      this.canNavigateForward.set(navForward || this.navHistoryCursor < this.navHistoryMaxCursor);
    } catch {
      // ignore
    }
  }

  navigateBack(): void {
    if (typeof window === 'undefined' || !window.history) return;
    try {
      if (this.navHistoryCursor > 0) {
        this.navHistoryCursor -= 1;
      }
      window.history.back();
      this.updateNavigationHistoryState(false);
    } catch {
      // ignore
    }
  }

  navigateForward(): void {
    if (typeof window === 'undefined' || !window.history) return;
    try {
      if (this.navHistoryCursor < this.navHistoryMaxCursor) {
        this.navHistoryCursor += 1;
      }
      window.history.forward();
      this.updateNavigationHistoryState(false);
    } catch {
      // ignore
    }
  }

  private initInstallPrompt(): void {
    if (typeof window !== 'undefined') {
      try {
        if (typeof window.matchMedia === 'function') {
          const standaloneMql = window.matchMedia('(display-mode: standalone)');
          if (typeof standaloneMql?.addEventListener === 'function') {
            standaloneMql.addEventListener('change', (e: MediaQueryListEvent) => {
              if (e.matches) {
                this.canInstall.set(false);
                this.isInstalled.set(true);
                try {
                  localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
                } catch {
                  // ignore
                }
              }
            });
          }
        }
      } catch {
        // ignore matchMedia listener errors
      }

      window.addEventListener('beforeinstallprompt', (e: Event) => {
        if (this.isStandaloneDisplayMode()) {
          this.isInstalled.set(true);
          this.canInstall.set(false);
          return;
        }
        // Store the BeforeInstallPromptEvent without calling e.preventDefault() so Chromium does not log
        // "Banner not shown: beforeinstallpromptevent.preventDefault() called" and preserves the address-bar install chip.
        this.deferredPrompt = e;
        this.isInstalled.set(false);
        this.canInstall.set(true);
        try {
          localStorage.removeItem(PWA_INSTALLED_STORAGE_KEY);
        } catch {
          // ignore
        }
      });

      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        this.canInstall.set(false);
        this.isInstalled.set(true);
        try {
          localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
        } catch {
          // ignore
        }
        this.initBackgroundAndPeriodicSync().catch(() => {});
        this.showToast('pwa.installSuccess');
      });
    }
  }

  private initNotificationClickRouting(): void {
    if (this.swPush?.isEnabled) {
      this.swPush.notificationClicks.subscribe(({ notification }) => {
        this.handleNotificationAction(notification?.data);
      });
    }
  }

  registerNotificationClickHandler(handler: (data: any) => void): void {
    this.notificationClickHandler = handler;
  }

  private handleNotificationAction(data: any): void {
    const sig = JSON.stringify(data || {});
    const now = Date.now();
    if (sig === this.lastNotificationClickSig && now - this.lastNotificationClickAt < 500) {
      return;
    }
    this.lastNotificationClickSig = sig;
    this.lastNotificationClickAt = now;

    if (typeof window !== 'undefined' && typeof window.focus === 'function') {
      try {
        window.focus();
      } catch {
        // ignore
      }
    }
    if (data?.action === 'reload_update') {
      this.activateUpdate();
      return;
    }
    if (this.notificationClickHandler && data) {
      this.notificationClickHandler(data);
    }
  }

  async setNotificationsEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      this.settingsService.notificationsEnabled.set(false);
      await this.teardownBrowserNotifications();
      return false;
    }

    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      this.settingsService.notificationsEnabled.set(false);
      return false;
    }

    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = 'denied';
      }
    }
    this.notificationPermission.set(perm);

    const granted = perm === 'granted';
    this.settingsService.notificationsEnabled.set(granted);
    return granted;
  }

  private async teardownBrowserNotifications(): Promise<void> {
    try {
      await this.syncAppBadge(0);
    } catch {
      // ignore
    }

    if (typeof navigator !== 'undefined') {
      try {
        if (this.swPush?.isEnabled) {
          await this.swPush.unsubscribe().catch(() => {});
        }
      } catch {
        // ignore
      }

      try {
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            if (typeof reg.getNotifications === 'function') {
              const activeNotifs = await reg.getNotifications();
              for (const n of activeNotifs || []) {
                try {
                  n.close();
                } catch {
                  // ignore
                }
              }
            }
            if (reg.pushManager && typeof reg.pushManager.getSubscription === 'function') {
              const sub = await reg.pushManager.getSubscription();
              if (sub && typeof sub.unsubscribe === 'function') {
                await sub.unsubscribe().catch(() => {});
              }
            }
          }
        }
      } catch {
        // ignore service worker teardown errors
      }

      try {
        const perms = (navigator as any).permissions;
        if (perms && typeof perms.revoke === 'function') {
          await perms.revoke({ name: 'notifications' });
        }
      } catch {
        // navigator.permissions.revoke is only supported in select Chromium runtimes
      }
    }

    this.notificationPermission.set(this.readBrowserNotificationPermission());
  }

  hasSeenNotificationTag(tag: string): boolean {
    if (!tag) return false;
    try {
      const raw = localStorage.getItem(SEEN_NOTIFICATION_TAGS_KEY);
      if (!raw) return false;
      const list = JSON.parse(raw);
      return Array.isArray(list) && list.includes(tag);
    } catch {
      return false;
    }
  }

  markNotificationTagSeen(tag: string, syncToIdb = true): void {
    if (!tag) return;
    try {
      const raw = localStorage.getItem(SEEN_NOTIFICATION_TAGS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed.filter((t: any) => typeof t === 'string') : [];
      if (!list.includes(tag)) {
        list.push(tag);
      }
      const trimmed = list.slice(-MAX_SEEN_TAGS);
      localStorage.setItem(SEEN_NOTIFICATION_TAGS_KEY, JSON.stringify(trimmed));
      if (syncToIdb) {
        this.syncNotificationStateToIndexedDb().catch(() => {});
      }
    } catch {
      // ignore storage errors
    }
  }

  private isCategoryEnabled(category: NativeNotificationPayload['category']): boolean {
    if (!this.settingsService.notificationsEnabled()) return false;
    if (category === 'moderation') return this.settingsService.notifyModeration();
    if (category === 'admin_queue') return this.settingsService.notifyAdminQueue();
    if (category === 'app_update') return this.settingsService.notifyAppUpdates();
    if (category === 'new_git_package') return this.settingsService.notifyNewGitPackages();
    if (category === 'package_update') return this.settingsService.notifyPackageUpdates();
    if (category === 'new_review') return this.settingsService.notifyNewReviews();
    if (category === 'promotion') return this.settingsService.notifyPromotions();
    return false;
  }

  /**
   * Notifies users once per active time-bounded Hero Carousel promotion (`lh_seen_promotions_v1`)
   * when `notifyPromotions()` is enabled.
   */
  checkAndNotifyPromotions(
    promotions: HeroPromotion[],
    options?: { forceNotifyIds?: string[] }
  ): number {
    if (!Array.isArray(promotions) || promotions.length === 0) return 0;
    if (typeof localStorage === 'undefined') return 0;
    if (!this.settingsService.notifyPromotions()) return 0;

    const nowMs = Date.now();
    const forceSet = new Set(
      (options?.forceNotifyIds || []).map(id => String(id || '').trim()).filter(Boolean)
    );

    const activePromos = promotions.filter(promo => {
      if (!promo || !promo.id || !promo.title || !promo.expires_at) return false;
      const expMs = Date.parse(String(promo.expires_at));
      if (!Number.isFinite(expMs) || expMs <= nowMs) return false;
      if (promo.starts_at) {
        const startMs = Date.parse(String(promo.starts_at));
        if (Number.isFinite(startMs) && startMs > nowMs) return false;
      }
      return true;
    });

    if (activePromos.length === 0) return 0;

    let seenIds: string[] = [];
    try {
      const rawSeen = localStorage.getItem(SEEN_PROMOTIONS_KEY);
      if (rawSeen) {
        const parsed = JSON.parse(rawSeen);
        if (Array.isArray(parsed)) {
          seenIds = parsed.filter((id): id is string => typeof id === 'string');
        }
      }
    } catch {
      seenIds = [];
    }

    const seenSet = new Set(seenIds);
    const newlyActive: HeroPromotion[] = [];

    for (const promo of activePromos) {
      const id = String(promo.id).trim();
      const isForced = forceSet.has(id);
      if (!seenSet.has(id) || isForced) {
        seenSet.add(id);
        newlyActive.push(promo);
      }
    }

    if (newlyActive.length === 0) return 0;

    try {
      localStorage.setItem(SEEN_PROMOTIONS_KEY, JSON.stringify(Array.from(seenSet).slice(-100)));
      this.syncNotificationStateToIndexedDb().catch(() => {});
    } catch {
      // ignore storage errors
    }

    for (const promo of newlyActive.slice(0, 2)) {
      const badge = (promo.badge_text || 'PROMOTED').trim();
      this.sendNativeNotification({
        title: `${badge} · ${promo.title}`,
        body: promo.short_desc || 'Check out the featured promotion on LuantiHub.',
        icon: promo.banner_url,
        image: promo.banner_url,
        tag: `lh-promo-${promo.id}`,
        category: 'promotion',
        variant: 'promotion',
        data: {
          ctaUrl: promo.cta_url
        }
      });
    }

    return newlyActive.length;
  }

  /**
   * Notifies users once when a new article is published on `https://blog.luanti.org/`
   * (`lh_seen_blog_posts_v1`) when `notifyPromotions()` is enabled.
   */
  checkAndNotifyBlogPost(
    post: LuantiBlogPost | null | undefined,
    options?: { forceNotify?: boolean }
  ): boolean {
    if (!post || !post.title || !post.url) return false;
    if (typeof localStorage === 'undefined') return false;
    if (!this.settingsService.notifyPromotions()) return false;

    const postId = String(post.id || post.url).trim();
    if (!postId) return false;

    let seenIds: string[] = [];
    try {
      const rawSeen = localStorage.getItem(SEEN_BLOG_POSTS_KEY);
      if (rawSeen) {
        const parsed = JSON.parse(rawSeen);
        if (Array.isArray(parsed)) {
          seenIds = parsed.filter((id): id is string => typeof id === 'string');
        }
      }
    } catch {
      seenIds = [];
    }

    const seenSet = new Set(seenIds);
    if (seenSet.has(postId) && !options?.forceNotify) {
      return false;
    }

    seenSet.add(postId);
    try {
      localStorage.setItem(SEEN_BLOG_POSTS_KEY, JSON.stringify(Array.from(seenSet).slice(-100)));
    } catch {
      // ignore storage errors
    }

    const validImageUrl =
      post.image_url && post.image_url !== '/promo.png' ? post.image_url : undefined;

    this.sendNativeNotification({
      title: `Luanti Blog · ${post.title}`,
      body: post.summary || 'New official article published on blog.luanti.org.',
      ...(validImageUrl ? { icon: validImageUrl, image: validImageUrl } : {}),
      tag: `lh-blog-${postId}`,
      category: 'promotion',
      variant: 'promotion',
      data: {
        ctaUrl: post.url
      }
    });

    return true;
  }

  /**
   * Tracks known community Git package IDs in localStorage (`lh_known_git_packages_v1`).
   * On the very first catalog load, seeds the baseline set silently without spamming notifications.
   * On subsequent checks or when `forceNotifyIds` is provided, sends a native PWA notification
   * formatted as `New Git Package · [MOD] Title` for genuinely new community Git packages (published <= 48h).
   */
  checkAndNotifyNewGitPackages(
    candidates: Array<{
      id?: string;
      author?: string;
      author_name?: string;
      name?: string;
      title?: string;
      type?: string;
      short_desc?: string;
      thumbnail?: string;
      thumbnail_url?: string;
      source?: string;
      sources?: string[];
      status?: string;
      created_at?: string;
      updated_at?: string;
    }>,
    options?: { forceNotifyIds?: string[]; isBaselineSeedAllowed?: boolean }
  ): number {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    if (typeof localStorage === 'undefined') return 0;

    const forceSet = new Set(
      (options?.forceNotifyIds || []).map(id => String(id || '').toLowerCase()).filter(Boolean)
    );

    // 1. Identify all eligible Git packages (including dual-indexed ones) for baseline seeding
    const allGitCandidates = candidates.filter(pkg => {
      if (!pkg || pkg.status === 'delisted' || pkg.status === 'flagged') return false;
      const author = pkg.author || pkg.author_name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
      const name = pkg.name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[1] : '');
      if (!author || !name) return false;
      return (
        pkg.source === 'git' ||
        (Array.isArray(pkg.sources) && pkg.sources.includes('git')) ||
        forceSet.has(`${author}/${name}`.toLowerCase())
      );
    });

    if (allGitCandidates.length === 0) return 0;

    let rawKnown: string | null = null;
    try {
      rawKnown = localStorage.getItem(KNOWN_GIT_PACKAGES_KEY);
    } catch {
      return 0;
    }

    // First-time baseline seed: record all existing Git packages silently without notification flood
    if (rawKnown === null && forceSet.size === 0) {
      if (options?.isBaselineSeedAllowed === false) {
        return 0;
      }
      try {
        const initialIds = Array.from(
          new Set(
            allGitCandidates.map(pkg => {
              const author = pkg.author || pkg.author_name || String(pkg.id).split('/')[0];
              const name = pkg.name || String(pkg.id).split('/')[1];
              return (pkg.id || `${author}/${name}`).toLowerCase();
            })
          )
        ).slice(-2000);
        localStorage.setItem(KNOWN_GIT_PACKAGES_KEY, JSON.stringify(initialIds));
        this.syncNotificationStateToIndexedDb().catch(() => {});
      } catch {
        // ignore storage quota errors
      }
      return 0;
    }

    let knownList: string[] = [];
    if (rawKnown) {
      try {
        const parsed = JSON.parse(rawKnown);
        if (Array.isArray(parsed)) {
          knownList = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        knownList = [];
      }
    }

    const knownSet = new Set<string>(knownList.map(id => id.toLowerCase()));

    // 2. Strict Filter for Notifications: Only notify for genuine community Git packages
    // Exclude established ContentDB packages that simply linked a Git repo (dual-indexed: sources.includes('official'))
    // And exclude packages published more than 48 hours ago
    const newlyDiscovered: typeof allGitCandidates = [];

    for (const pkg of allGitCandidates) {
      const author = pkg.author || pkg.author_name || String(pkg.id).split('/')[0];
      const name = pkg.name || String(pkg.id).split('/')[1];
      const resolvedId = pkg.id || `${author}/${name}`;
      const lowerId = resolvedId.toLowerCase();
      const isForced = forceSet.has(lowerId);

      const isOfficial = Array.isArray(pkg.sources) ? pkg.sources.includes('official') : pkg.source === 'official';
      const isPureGit = !isOfficial || isForced;

      // Check recency: must be created within the last 48 hours
      let isRecent = true;
      if (!isForced && (pkg.created_at || pkg.updated_at)) {
        const timeMs = new Date(pkg.created_at || pkg.updated_at!).getTime();
        if (!isNaN(timeMs) && Date.now() - timeMs > 48 * 3600 * 1000) {
          isRecent = false;
        }
      }

      if (!knownSet.has(lowerId)) {
        knownSet.add(lowerId);
        if (isPureGit && isRecent) {
          newlyDiscovered.push(pkg);
        }
      } else if (isForced) {
        newlyDiscovered.push(pkg);
      }
    }

    if (newlyDiscovered.length === 0) return 0;

    try {
      const updatedIds = Array.from(knownSet).slice(-2000);
      localStorage.setItem(KNOWN_GIT_PACKAGES_KEY, JSON.stringify(updatedIds));
      this.syncNotificationStateToIndexedDb().catch(() => {});
    } catch {
      // ignore storage errors
    }

    // Cap to at most 3 notifications per check so bulk imports never flood the OS tray
    for (const pkg of newlyDiscovered.slice(0, 3)) {
      const author = pkg.author || pkg.author_name || String(pkg.id).split('/')[0];
      const name = pkg.name || String(pkg.id).split('/')[1];
      const resolvedId = pkg.id || `${author}/${name}`;
      const typeLabel = String(pkg.type || 'mod').toUpperCase();
      const displayTitle = pkg.title || name;
      const thumb = pkg.thumbnail || pkg.thumbnail_url;

      this.sendNativeNotification({
        title: `New Git Package · [${typeLabel}] ${displayTitle}`,
        body: `by ${author} — ${pkg.short_desc || 'New community Git repository published on LuantiHub.'}`,
        icon: thumb,
        image: thumb,
        tag: `lh-new-git-pkg-${resolvedId.toLowerCase()}`,
        category: 'new_git_package',
        variant: 'new_git_package',
        data: {
          packageId: resolvedId
        }
      });
    }

    return newlyDiscovered.length;
  }

  /**
   * Tracks known package release IDs and `updated_at` timestamps in `localStorage` (`lh_known_package_versions_v1`).
   * On the very first catalog load, seeds the version baseline silently without spamming notifications.
   * On subsequent checks or when `forceNotifyIds` is provided, sends a native PWA notification
   * formatted as `Package Updated · [MOD] Title` with the package thumbnail image when a package's
   * `release_id` or `updated_at` advances (within the last 48h), prioritizing Favorites and Downloaded packages.
   */
  checkAndNotifyUpdatedPackages(
    candidates: Array<{
      id?: string;
      author?: string;
      author_name?: string;
      name?: string;
      title?: string;
      type?: string;
      short_desc?: string;
      thumbnail?: string;
      thumbnail_url?: string;
      source?: string;
      sources?: string[];
      status?: string;
      release?: number | string;
      release_id?: number | string;
      release_title?: string;
      latest_commit_sha?: string;
      commit_sha?: string;
      created_at?: string;
      updated_at?: string;
    }>,
    options?: { forceNotifyIds?: string[]; isBaselineSeedAllowed?: boolean; cooldownMs?: number }
  ): number {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    if (typeof localStorage === 'undefined') return 0;

    const forceSet = new Set(
      (options?.forceNotifyIds || []).map(id => String(id || '').toLowerCase()).filter(Boolean)
    );
    const effectiveCooldownMs = options?.cooldownMs ?? PACKAGE_UPDATE_COOLDOWN_MS;

    const validCandidates = candidates.filter(pkg => {
      if (!pkg || pkg.status === 'delisted' || pkg.status === 'flagged') return false;
      const author = pkg.author || pkg.author_name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
      const name = pkg.name || (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[1] : '');
      if (!author || !name) return false;
      const rel = pkg.release_id ?? pkg.release ?? pkg.latest_commit_sha ?? pkg.commit_sha;
      return Boolean(rel !== undefined && rel !== null && String(rel).trim() !== '') || Boolean(pkg.updated_at);
    });

    if (validCandidates.length === 0) return 0;

    let rawKnown: string | null = null;
    try {
      rawKnown = localStorage.getItem(KNOWN_PACKAGE_VERSIONS_KEY);
    } catch {
      return 0;
    }

    const normalizeReleaseStampPart = (rawRel: unknown): string => {
      const trimmed = String(rawRel ?? '').trim();
      if (!trimmed || trimmed === '0') return '';
      const num = Number(trimmed);
      // Synthetic Unix epoch timestamps (>= 1_000_000_000, i.e. 10+ digits) are not sequential
      // ContentDB release IDs (~1..99_999_999); normalize them to '' so dual-source packages
      // never oscillate between a 5-digit ContentDB release ID and a 10-digit epoch timestamp.
      if (Number.isFinite(num) && num >= 1_000_000_000) return '';
      return trimmed;
    };

    const computeStamp = (pkg: (typeof validCandidates)[number]): string => {
      const rel = normalizeReleaseStampPart(pkg.release_id ?? pkg.release ?? '');
      const upd = pkg.updated_at || '';
      const sha = pkg.latest_commit_sha || pkg.commit_sha || '';
      return `${rel}|${String(upd).trim()}|${String(sha).trim()}`;
    };

    // First-time baseline seed: record current release_id|updated_at stamps silently without notification flood
    if (rawKnown === null && forceSet.size === 0) {
      if (options?.isBaselineSeedAllowed === false) {
        return 0;
      }
      try {
        const initialMap: Record<string, string> = {};
        for (const pkg of validCandidates) {
          const author = pkg.author || pkg.author_name || String(pkg.id).split('/')[0];
          const name = pkg.name || String(pkg.id).split('/')[1];
          const lowerId = (pkg.id || `${author}/${name}`).toLowerCase();
          initialMap[lowerId] = computeStamp(pkg);
        }
        localStorage.setItem(KNOWN_PACKAGE_VERSIONS_KEY, JSON.stringify(initialMap));
        this.syncNotificationStateToIndexedDb().catch(() => {});
      } catch {
        // ignore storage quota errors
      }
      return 0;
    }

    let knownMap: Record<string, string> = {};
    if (rawKnown) {
      try {
        const parsed = JSON.parse(rawKnown);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          knownMap = parsed as Record<string, string>;
        }
      } catch {
        knownMap = {};
      }
    }

    let cooldownMap: Record<string, number> = {};
    try {
      const rawCooldown = localStorage.getItem(PACKAGE_UPDATE_COOLDOWN_KEY);
      if (rawCooldown) {
        const parsedCooldown = JSON.parse(rawCooldown);
        if (parsedCooldown && typeof parsedCooldown === 'object' && !Array.isArray(parsedCooldown)) {
          cooldownMap = parsedCooldown as Record<string, number>;
        }
      }
    } catch {
      cooldownMap = {};
    }

    const updatedPackages: Array<{ pkg: (typeof validCandidates)[number]; resolvedId: string; stamp: string }> = [];
    let mapChanged = false;

    for (const pkg of validCandidates) {
      const author = pkg.author || pkg.author_name || String(pkg.id).split('/')[0];
      const name = pkg.name || String(pkg.id).split('/')[1];
      const resolvedId = pkg.id || `${author}/${name}`;
      const lowerId = resolvedId.toLowerCase();
      const newStamp = computeStamp(pkg);
      const prevStamp = knownMap[lowerId];
      const isForced = forceSet.has(lowerId);

      if (prevStamp === undefined) {
        knownMap[lowerId] = newStamp;
        mapChanged = true;
        if (isForced) {
          updatedPackages.push({ pkg, resolvedId, stamp: newStamp });
        }
        continue;
      }

      if (prevStamp !== newStamp || isForced) {
        const [rawPrevRel, prevUpd, prevSha = ''] = prevStamp.split('|');
        const [rawNewRel, newUpd, newSha = ''] = newStamp.split('|');
        const prevRel = normalizeReleaseStampPart(rawPrevRel);
        const newRel = normalizeReleaseStampPart(rawNewRel);

        let genuinelyAdvanced = isForced;
        if (!genuinelyAdvanced) {
          const prevRelNum = Number(prevRel);
          const newRelNum = Number(newRel);
          const hasConcretePrevSha = Boolean(prevSha && prevSha !== 'HEAD' && prevSha !== 'latest');
          const hasConcreteNewSha = Boolean(newSha && newSha !== 'HEAD' && newSha !== 'latest');
          const sameConcreteSha =
            hasConcretePrevSha && hasConcreteNewSha && prevSha.toLowerCase() === newSha.toLowerCase();
          const shaAdvanced =
            hasConcretePrevSha && hasConcreteNewSha && prevSha.toLowerCase() !== newSha.toLowerCase();

          if (sameConcreteSha) {
            // If both stamps carry the exact same commit SHA, only notify if both also have
            // real ContentDB release IDs (< 100_000_000) and the release ID strictly advanced.
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
          } else if (shaAdvanced) {
            genuinelyAdvanced = true;
          } else if (prevRel && newRel) {
            // Both stamps have a real ContentDB release identifier: only notify when the release ID itself advanced.
            // Never notify if `prevRel === newRel` (e.g. when `updated_at` was merely hydrated from D1 cache).
            if (prevRel !== newRel) {
              if (Number.isFinite(prevRelNum) && Number.isFinite(newRelNum)) {
                genuinelyAdvanced = newRelNum > prevRelNum;
              } else {
                genuinelyAdvanced = true;
              }
            }
          } else if (
            !prevRel &&
            !newRel &&
            !hasConcretePrevSha &&
            !hasConcreteNewSha &&
            prevUpd &&
            newUpd &&
            newUpd !== prevUpd
          ) {
            // Pure timestamp-tracked package (no release ID and no commit SHA): require both timestamps to exist and advance.
            const prevMs = new Date(prevUpd).getTime();
            const newMs = new Date(newUpd).getTime();
            if (!isNaN(newMs) && !isNaN(prevMs) && newMs > prevMs) {
              genuinelyAdvanced = true;
            }
          }
        }

        // Recency guard: if updated_at is present and not forced, ensure it is within the last 48h
        let isRecent = true;
        if (!isForced && newUpd) {
          const updMs = new Date(newUpd).getTime();
          if (!isNaN(updMs) && Date.now() - updMs > 48 * 3600 * 1000) {
            isRecent = false;
          }
        }

        // Per-package debounce cooldown guard: prevent notification spam during rapid multi-commit bursts
        let withinCooldown = false;
        if (!isForced && effectiveCooldownMs > 0) {
          const lastNotifiedAt = Number(cooldownMap[lowerId] || 0);
          if (lastNotifiedAt > 0 && Date.now() - lastNotifiedAt < effectiveCooldownMs) {
            withinCooldown = true;
          }
        }

        knownMap[lowerId] = newStamp;
        mapChanged = true;

        if (genuinelyAdvanced && isRecent && !withinCooldown) {
          updatedPackages.push({ pkg, resolvedId, stamp: newStamp });
        }
      }
    }

    if (mapChanged) {
      try {
        const entries = Object.entries(knownMap);
        const trimmed = entries.length > 4000 ? Object.fromEntries(entries.slice(-4000)) : knownMap;
        localStorage.setItem(KNOWN_PACKAGE_VERSIONS_KEY, JSON.stringify(trimmed));
        this.syncNotificationStateToIndexedDb().catch(() => {});
      } catch {
        // ignore storage errors
      }
    }

    if (updatedPackages.length === 0 || !this.settingsService.notifyPackageUpdates()) return 0;

    // Prioritize user's Favorited and previously Downloaded packages first
    const favSet = new Set(this.settingsService.favorites().map(f => f.toLowerCase()));
    const dlMap = this.settingsService.downloadedPackages();
    updatedPackages.sort((a, b) => {
      const aId = a.resolvedId.toLowerCase();
      const bId = b.resolvedId.toLowerCase();
      const aPriority = (favSet.has(aId) ? 2 : 0) + ((dlMap[aId] || 0) > 0 ? 1 : 0);
      const bPriority = (favSet.has(bId) ? 2 : 0) + ((dlMap[bId] || 0) > 0 ? 1 : 0);
      return bPriority - aPriority;
    });

    // Cap to at most 3 notifications per check so bulk refreshes never flood the OS tray
    let cooldownChanged = false;
    for (const item of updatedPackages.slice(0, 3)) {
      const { pkg, resolvedId, stamp } = item;
      const lowerId = resolvedId.toLowerCase();
      cooldownMap[lowerId] = Date.now();
      cooldownChanged = true;

      const author = pkg.author || pkg.author_name || String(pkg.id).split('/')[0];
      const name = pkg.name || String(pkg.id).split('/')[1];
      const typeLabel = String(pkg.type || 'mod').toUpperCase();
      const displayTitle = pkg.title || name;
      const thumb = pkg.thumbnail || pkg.thumbnail_url;
      const rawCommitSha = String(pkg.latest_commit_sha || pkg.commit_sha || '').trim();
      const shortCommitLabel = /^[0-9a-f]{7,40}$/i.test(rawCommitSha) ? rawCommitSha.slice(0, 7) : '';
      const relLabel = pkg.release_title
        ? ` (${pkg.release_title})`
        : shortCommitLabel
          ? ` (${shortCommitLabel})`
          : pkg.release_id || pkg.release
            ? ` (#${pkg.release_id ?? pkg.release})`
            : '';

      this.sendNativeNotification({
        title: `Package Updated · [${typeLabel}] ${displayTitle}`,
        body: `by ${author}${relLabel} — ${pkg.short_desc || 'New release available on LuantiHub.'}`,
        icon: thumb,
        image: thumb,
        tag: `lh-pkg-update-${resolvedId.toLowerCase()}-${stamp}`,
        category: 'package_update',
        variant: 'package_update',
        data: {
          packageId: resolvedId
        }
      });
    }

    if (cooldownChanged) {
      try {
        const entries = Object.entries(cooldownMap);
        const trimmed = entries.length > 2000 ? Object.fromEntries(entries.slice(-2000)) : cooldownMap;
        localStorage.setItem(PACKAGE_UPDATE_COOLDOWN_KEY, JSON.stringify(trimmed));
        this.syncNotificationStateToIndexedDb().catch(() => {});
      } catch {
        // ignore storage errors
      }
    }

    return updatedPackages.length;
  }

  /**
   * Records a review ID as seen in `lh_seen_reviews_v1` (e.g. immediately when a user submits
   * their own review so they are never notified about it on subsequent catalog syncs).
   */
  markReviewSeen(reviewId: string | number): void {
    if (reviewId === undefined || reviewId === null || typeof localStorage === 'undefined') return;
    const cleanId = String(reviewId).trim().replace(/^lh_/i, '');
    if (!cleanId) return;
    try {
      const raw = localStorage.getItem(SEEN_REVIEWS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
      if (!list.includes(cleanId)) {
        list.push(cleanId);
        localStorage.setItem(SEEN_REVIEWS_KEY, JSON.stringify(list.slice(-500)));
      }
    } catch {
      // ignore storage errors
    }
  }

  /**
   * Tracks known LuantiHub community review IDs in `localStorage` (`lh_seen_reviews_v1`).
   * On the very first catalog load, seeds the baseline set silently without spamming notifications.
   * On subsequent checks or when `forceNotifyIds` is provided, sends a native PWA notification
   * formatted as `New Review · ★★★★★ Title` for newly posted community reviews (within <= 48h).
   */
  checkAndNotifyNewReviews(
    reviews: Array<{
      id?: string | number;
      package_id?: string;
      packageId?: string;
      package_title?: string;
      packageTitle?: string;
      package_type?: string;
      packageType?: string;
      package_thumbnail?: string;
      packageThumbnail?: string;
      rating?: number;
      title?: string;
      comment?: string;
      created_at?: string;
      createdAt?: string;
      reviewer_username?: string;
      username?: string;
      reviewer_display_name?: string;
      display_name?: string;
      author?: {
        username?: string;
        display_name?: string;
      };
    }>,
    options?: {
      forceNotifyIds?: string[];
      isBaselineSeedAllowed?: boolean;
      excludeAuthorUsername?: string;
    }
  ): number {
    if (!Array.isArray(reviews) || reviews.length === 0) return 0;
    if (typeof localStorage === 'undefined') return 0;

    const forceSet = new Set(
      (options?.forceNotifyIds || [])
        .map(id => String(id || '').trim().replace(/^lh_/i, ''))
        .filter(Boolean)
    );
    const excludedUser = String(options?.excludeAuthorUsername || '').trim().toLowerCase();

    const validReviews = reviews.filter(rev => {
      if (!rev || rev.id === undefined || rev.id === null) return false;
      const cleanId = String(rev.id).trim().replace(/^lh_/i, '');
      const pkgId = String(rev.package_id || rev.packageId || '').trim();
      return Boolean(cleanId && pkgId);
    });

    if (validReviews.length === 0) return 0;

    let rawSeen: string | null = null;
    try {
      rawSeen = localStorage.getItem(SEEN_REVIEWS_KEY);
    } catch {
      return 0;
    }

    // First-time baseline seed: record all existing reviews silently without notification flood
    if (rawSeen === null && forceSet.size === 0) {
      if (options?.isBaselineSeedAllowed === false) {
        return 0;
      }
      try {
        const initialIds = Array.from(
          new Set(validReviews.map(rev => String(rev.id).trim().replace(/^lh_/i, '')))
        ).slice(-500);
        localStorage.setItem(SEEN_REVIEWS_KEY, JSON.stringify(initialIds));
      } catch {
        // ignore storage errors
      }
      return 0;
    }

    let seenList: string[] = [];
    if (rawSeen) {
      try {
        const parsed = JSON.parse(rawSeen);
        if (Array.isArray(parsed)) {
          seenList = parsed.filter((id): id is string => typeof id === 'string');
        }
      } catch {
        seenList = [];
      }
    }

    const seenSet = new Set<string>(seenList.map(id => id.replace(/^lh_/i, '')));
    const newlyDiscovered: typeof validReviews = [];
    let seenChanged = false;

    for (const rev of validReviews) {
      const cleanId = String(rev.id).trim().replace(/^lh_/i, '');
      const isForced = forceSet.has(cleanId);
      const reviewerUsername = String(
        rev.reviewer_username || rev.username || rev.author?.username || ''
      ).trim();

      const isSelfReview =
        Boolean(excludedUser) &&
        Boolean(reviewerUsername) &&
        reviewerUsername.toLowerCase() === excludedUser;

      let isRecent = true;
      const createdRaw = rev.created_at || rev.createdAt;
      if (!isForced && createdRaw) {
        const normalizedIso =
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(createdRaw).trim())
            ? `${String(createdRaw).trim().replace(' ', 'T')}Z`
            : String(createdRaw).trim();
        const timeMs = new Date(normalizedIso).getTime();
        if (!isNaN(timeMs) && Date.now() - timeMs > 48 * 3600 * 1000) {
          isRecent = false;
        }
      }

      if (!seenSet.has(cleanId)) {
        seenSet.add(cleanId);
        seenChanged = true;
        if (!isSelfReview && isRecent) {
          newlyDiscovered.push(rev);
        }
      } else if (isForced && !isSelfReview) {
        newlyDiscovered.push(rev);
      }
    }

    if (seenChanged) {
      try {
        localStorage.setItem(SEEN_REVIEWS_KEY, JSON.stringify(Array.from(seenSet).slice(-500)));
        this.syncNotificationStateToIndexedDb().catch(() => {});
      } catch {
        // ignore storage errors
      }
    }

    if (newlyDiscovered.length === 0 || !this.settingsService.notifyNewReviews()) return 0;

    // Cap to at most 3 notifications per check so bulk imports never flood the OS tray
    for (const rev of newlyDiscovered.slice(0, 3)) {
      const cleanId = String(rev.id).trim().replace(/^lh_/i, '');
      const pkgId = String(rev.package_id || rev.packageId || '').trim();
      const pkgTitle = String(
        rev.package_title || rev.packageTitle || pkgId.split('/')[1] || pkgId
      ).trim();
      const rawRating = Number(rev.rating ?? 5);
      const rating = Math.max(1, Math.min(5, Number.isFinite(rawRating) ? Math.round(rawRating) : 5));
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      const reviewer =
        String(
          rev.reviewer_username ||
            rev.username ||
            rev.author?.username ||
            rev.reviewer_display_name ||
            rev.display_name ||
            rev.author?.display_name ||
            'community'
        ).trim() || 'community';
      const rawComment = String(rev.comment || rev.title || '').replace(/\s+/g, ' ').trim();
      const excerpt =
        rawComment.length > 90
          ? `${rawComment.slice(0, 87)}...`
          : rawComment || 'New community review posted on LuantiHub.';
      const thumb = rev.package_thumbnail || rev.packageThumbnail || undefined;

      this.sendNativeNotification({
        title: `New Review · ${stars} ${pkgTitle}`,
        body: `by @${reviewer} — "${excerpt}"`,
        icon: thumb,
        image: thumb,
        tag: `lh-review-${cleanId}`,
        category: 'new_review',
        variant: 'new_review',
        data: {
          packageId: pkgId
        }
      });
    }

    return newlyDiscovered.length;
  }

  /**
   * Pre-warms the in-memory `data:image/png` cache for all semantic notification icons (`/icons/notif-*.png`)
   * and the app badge (`/icons/icon-72x72.png`) shortly after startup so that even when an `app_update`
   * occurs (and the server's `ngsw.json` hash table rotates) or the device goes offline, native
   * notifications always have decoded PNG Data URLs ready in memory.
   */
  private initLocalNotificationIconsCache(): void {
    const isUnitTestEnv =
      typeof (globalThis as any).describe === 'function' &&
      typeof (globalThis as any).it === 'function';
    if (isUnitTestEnv || typeof window === 'undefined' || typeof fetch !== 'function') {
      return;
    }

    setTimeout(() => {
      const origin = window.location?.origin || '';
      const iconPaths = [
        '/icons/icon-72x72.png',
        '/icons/notif-app-update.png',
        '/icons/notif-new-package.png',
        '/icons/notif-package-update.png',
        '/icons/notif-moderation.png',
        '/icons/notif-resolved.png',
        '/icons/notif-dismissed.png',
        '/icons/notif-admin-alert.png'
      ];
      for (const path of iconPaths) {
        this.resolveLocalAssetAsDataUrl(path, origin).catch(() => {});
      }
    }, 1500);
  }

  private async blobToDataUrl(blob: Blob, fallbackMimeType = 'image/png'): Promise<string | null> {
    if (blob && typeof blob.arrayBuffer === 'function') {
      try {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes.length > 0) {
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          const mime = (blob.type || fallbackMimeType || 'image/png').split(';')[0].trim();
          const normalizedMime = mime.startsWith('image/') ? mime : 'image/png';
          return `data:${normalizedMime};base64,${btoa(binary)}`;
        }
      } catch {
        // Fall back to FileReader below
      }
    }
    if (typeof FileReader === 'undefined') {
      return null;
    }
    return new Promise(resolve => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = typeof reader.result === 'string' ? reader.result : null;
          resolve(res && res.startsWith('data:image/') ? res : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      } catch {
        resolve(null);
      }
    });
  }

  private async fetchImageAsDataUrl(
    url: string,
    timeoutMs = 2500,
    cacheMode: RequestCache = 'default'
  ): Promise<string | null> {
    if (typeof fetch !== 'function') return null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: cacheMode,
        signal: controller?.signal
      });
      if (!res || !res.ok) return null;
      const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
      if (contentType && (!contentType.startsWith('image/') || contentType.includes('svg'))) {
        return null;
      }
      if (typeof res.blob !== 'function') return null;
      const blob = await res.blob();
      if (!blob || blob.size === 0 || blob.size > 5 * 1024 * 1024) return null;
      return await this.blobToDataUrl(blob);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Resolves a local static asset (such as `/icons/notif-*.png`, `/icons/icon-72x72.png`, or `/banners/...`)
   * into an in-memory cached `data:image/png` Data URL using `ngsw-bypass=true`.
   */
  private async resolveLocalAssetAsDataUrl(
    assetPath: string,
    origin: string
  ): Promise<string | null> {
    const cleanPath = (assetPath.startsWith('/') ? assetPath : `/${assetPath}`).split('?')[0];
    if (!cleanPath || cleanPath === '/promo.png') return null;

    const cached = this.localAssetDataUrlCache.get(cleanPath);
    if (cached) return cached;

    const baseUrl = origin ? `${origin}${cleanPath}` : cleanPath;
    const dataUrl =
      (await this.fetchImageAsDataUrl(`${baseUrl}?ngsw-bypass=true`, 2000, 'default')) ||
      (await this.fetchImageAsDataUrl(baseUrl, 2000, 'default'));
    if (!dataUrl) return null;

    const pngDataUrl = await this.ensurePngDataUrl(dataUrl);
    this.localAssetDataUrlCache.set(cleanPath, pngDataUrl);
    return pngDataUrl;
  }

  private isCanvas2dSupported(): boolean {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') return false;
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
      return false;
    }
    return true;
  }

  /**
   * Ensures a `data:image/...` URL is encoded as `data:image/png` so native OS notification bridges
   * (such as macOS `UNNotificationAttachment`, which only accepts PNG/JPEG/GIF and rejects WebP)
   * never drop the image attachment.
   */
  private async ensurePngDataUrl(dataUrl: string): Promise<string> {
    if (!dataUrl || dataUrl.startsWith('data:image/png') || !this.isCanvas2dSupported()) {
      return dataUrl;
    }
    try {
      const img = await this.loadImageElement(dataUrl, 1500);
      if (!img) return dataUrl;
      const rawW = img.naturalWidth || 512;
      const rawH = img.naturalHeight || 512;
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
      const width = Math.max(1, Math.round(rawW * scale));
      const height = Math.max(1, Math.round(rawH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL('image/png');
      return out && out.startsWith('data:image/png') ? out : dataUrl;
    } catch {
      return dataUrl;
    }
  }

  /**
   * Resolves an external notification icon/thumbnail into a CORS-safe `data:image/...` URL
   * so Chromium's `NotificationImageLoader` on macOS, Android, Windows, and Linux never
   * drops the notification attachment due to missing `Access-Control-Allow-Origin` headers
   * or cached opaque (`no-cors`) `<img>` responses.
   */
  private async resolveCorsSafeNotificationImage(
    rawUrl: string,
    origin: string
  ): Promise<string | null> {
    try {
      const parsed = new URL(rawUrl, origin || 'https://luantihub.org');
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      const host = parsed.hostname.toLowerCase();
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1');

      // On localhost dev server, blog.luanti.org is proxied directly via /blog-api
      if (isLocalhost && host === 'blog.luanti.org' && origin) {
        const localBlogProxyUrl = `${origin}/blog-api${parsed.pathname}${parsed.search}`;
        const localDataUrl = await this.fetchImageAsDataUrl(localBlogProxyUrl, 2500, 'default');
        if (localDataUrl) return localDataUrl;
      }

      const supportsDirectCors =
        host === 'raw.githubusercontent.com' ||
        host === 'avatars.githubusercontent.com' ||
        host === 'api.bitbucket.org' ||
        host === 'blog.luanti.org';

      if (supportsDirectCors) {
        const directDataUrl =
          (await this.fetchImageAsDataUrl(parsed.toString(), 2500, 'default')) ||
          (await this.fetchImageAsDataUrl(parsed.toString(), 2500, 'reload'));
        if (directDataUrl) return directDataUrl;
      }

      if (origin) {
        const proxyUrl = `${origin}/api/packages?proxy_image=${encodeURIComponent(parsed.toString())}&ngsw-bypass=true`;
        const proxiedDataUrl = await this.fetchImageAsDataUrl(proxyUrl, 2500, 'default');
        if (proxiedDataUrl) return proxiedDataUrl;
      }

      if (!supportsDirectCors) {
        const fallbackDirectDataUrl =
          (await this.fetchImageAsDataUrl(parsed.toString(), 2500, 'default')) ||
          (await this.fetchImageAsDataUrl(parsed.toString(), 2500, 'reload'));
        if (fallbackDirectDataUrl) return fallbackDirectDataUrl;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the semantic custom badged LuantiHub icon path (`/icons/notif-*.png`)
   * for a notification based on its `variant`, `category`, and `title`.
   */
  getNotificationVariantIconPath(payload: NativeNotificationPayload): string {
    const variant: NotificationVariant =
      payload.variant ||
      (payload.category === 'moderation'
        ? /^issue resolved/i.test(payload.title || '')
          ? 'resolved'
          : /^report dismissed/i.test(payload.title || '')
            ? 'dismissed'
            : 'moderation'
        : payload.category);

    switch (variant) {
      case 'resolved':
        return '/icons/notif-resolved.png';
      case 'dismissed':
        return '/icons/notif-dismissed.png';
      case 'moderation':
        return '/icons/notif-moderation.png';
      case 'admin_queue':
        return '/icons/notif-admin-alert.png';
      case 'app_update':
        return '/icons/notif-app-update.png';
      case 'new_git_package':
      case 'new_review':
      case 'promotion':
        return '/icons/notif-new-package.png';
      case 'package_update':
        return '/icons/notif-package-update.png';
      default:
        return '/icons/icon-192x192.png';
    }
  }

  private loadImageElement(src: string, timeoutMs = 1500): Promise<HTMLImageElement | null> {
    if (typeof Image === 'undefined') {
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, timeoutMs);
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(img.naturalWidth > 0 ? img : null);
          }
        };
        img.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        };
        img.src = src;
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }

  /**
   * Composites a package thumbnail (`data:image/...`) with the LuantiHub voxel logo badge
   * in the bottom-right corner on a 192×192 `<canvas>` so that even package-thumbnail
   * notifications retain the LuantiHub PWA logo on macOS.
   */
  private async compositeThumbnailWithPwaBadge(
    thumbnailDataUrl: string,
    origin: string
  ): Promise<string> {
    if (!this.isCanvas2dSupported()) return thumbnailDataUrl;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 192;
      const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!ctx) return thumbnailDataUrl;

      const badgeSrc =
        this.localAssetDataUrlCache.get('/icons/icon-72x72.png') ||
        (await this.resolveLocalAssetAsDataUrl('/icons/icon-72x72.png', origin)) ||
        `${origin}/icons/icon-72x72.png`;

      const [thumbImg, badgeImg] = await Promise.all([
        this.loadImageElement(thumbnailDataUrl, 1500),
        this.loadImageElement(badgeSrc, 1500)
      ]);
      if (!thumbImg) return thumbnailDataUrl;

      // Center-crop package thumbnail into 192×192
      const sw = thumbImg.naturalWidth || 192;
      const sh = thumbImg.naturalHeight || 192;
      const side = Math.min(sw, sh);
      const sx = Math.max(0, Math.floor((sw - side) / 2));
      const sy = Math.max(0, Math.floor((sh - side) / 2));
      ctx.drawImage(thumbImg, sx, sy, side, side, 0, 0, 192, 192);

      // Draw dark circular backing + LuantiHub voxel badge in bottom-right corner
      if (badgeImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(150, 150, 38, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)';
        ctx.stroke();
        ctx.drawImage(badgeImg, 118, 118, 64, 64);
        ctx.restore();
      }

      const out = canvas.toDataURL('image/png');
      return out && out.startsWith('data:image/png') ? out : thumbnailDataUrl;
    } catch {
      return thumbnailDataUrl;
    }
  }

  /**
   * Resolves the active ServiceWorkerRegistration. If the Service Worker is currently
   * installing or waiting on initial page load, waits up to `timeoutMs` for
   * `navigator.serviceWorker.ready` so notifications are dispatched as persistent
   * Service Worker notifications (`reg.showNotification`) eligible for macOS PWA App Shim attribution.
   */
  private async resolveActiveSwRegistration(
    timeoutMs = 2500
  ): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) {
      return null;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return null;

      // If active worker is ready (or a test mock registration without installing/waiting state), return immediately
      if (reg.active || (!reg.installing && !reg.waiting)) {
        return typeof reg.showNotification === 'function' ? reg : null;
      }

      // Worker is actively installing/waiting: wait for navigator.serviceWorker.ready with a bounded timeout
      const readyPromise = navigator.serviceWorker.ready;
      if (readyPromise && typeof readyPromise.then === 'function') {
        const readyReg = await Promise.race([
          readyPromise,
          new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs))
        ]);
        if (readyReg && typeof readyReg.showNotification === 'function') {
          return readyReg;
        }
      }
      return reg.active && typeof reg.showNotification === 'function' ? reg : null;
    } catch {
      return null;
    }
  }

  async sendNativeNotification(payload: NativeNotificationPayload): Promise<boolean> {
    if (!payload?.tag || !this.isCategoryEnabled(payload.category)) {
      return false;
    }
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return false;
    }
    this.notificationPermission.set(Notification.permission);
    if (Notification.permission !== 'granted') {
      return false;
    }
    if (this.hasSeenNotificationTag(payload.tag)) {
      return false;
    }

    this.markNotificationTagSeen(payload.tag);

    const origin = window.location?.origin || '';
    const variantIconPath = this.getNotificationVariantIconPath(payload);
    const [variantIconDataUrl, badgeIconDataUrl] = await Promise.all([
      this.resolveLocalAssetAsDataUrl(variantIconPath, origin),
      this.resolveLocalAssetAsDataUrl('/icons/icon-72x72.png', origin)
    ]);

    const defaultAppIcon = variantIconDataUrl || `${origin}${variantIconPath}`;
    const defaultAppBadge = badgeIconDataUrl || `${origin}/icons/icon-72x72.png`;
    const rawCandidate = (payload.icon || payload.image || '').trim();

    let resolvedIcon = defaultAppIcon;
    let resolvedImage: string | undefined = variantIconDataUrl || undefined;

    if (
      rawCandidate &&
      rawCandidate !== 'logo.svg' &&
      rawCandidate !== '/logo.svg' &&
      !rawCandidate.toLowerCase().endsWith('.svg')
    ) {
      if (rawCandidate.startsWith('data:image/')) {
        const pngDataUrl = await this.ensurePngDataUrl(rawCandidate);
        resolvedIcon = await this.compositeThumbnailWithPwaBadge(pngDataUrl, origin);
        resolvedImage = pngDataUrl;
      } else if (rawCandidate.startsWith('/') || (origin && rawCandidate.startsWith(origin))) {
        const localPath = rawCandidate.startsWith('/')
          ? rawCandidate
          : rawCandidate.slice(origin.length);
        const localDataUrl = await this.resolveLocalAssetAsDataUrl(localPath, origin);
        if (localDataUrl) {
          if (localPath.startsWith('/icons/')) {
            resolvedIcon = localDataUrl;
            resolvedImage = localDataUrl;
          } else {
            resolvedIcon = await this.compositeThumbnailWithPwaBadge(localDataUrl, origin);
            resolvedImage = localDataUrl;
          }
        }
      } else if (/^https?:\/\//i.test(rawCandidate)) {
        const dataUrl = await this.resolveCorsSafeNotificationImage(rawCandidate, origin);
        if (dataUrl) {
          const pngDataUrl = await this.ensurePngDataUrl(dataUrl);
          resolvedIcon = await this.compositeThumbnailWithPwaBadge(pngDataUrl, origin);
          resolvedImage = pngDataUrl;
        }
      }
    }

    const options: NotificationOptions & { image?: string } = {
      body: payload.body,
      icon: resolvedIcon,
      badge: defaultAppBadge,
      tag: payload.tag,
      data: payload.data || {}
    };

    if (resolvedImage) {
      options.image = resolvedImage;
    }

    try {
      const reg = await this.resolveActiveSwRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        try {
          await reg.showNotification(payload.title, options);
          return true;
        } catch {
          // Fall through to window.Notification if SW showNotification rejects
        }
      }

      const notif = new Notification(payload.title, options);
      notif.onclick = () => {
        notif.close();
        this.handleNotificationAction(payload.data);
      };
      return true;
    } catch {
      return false;
    }
  }

  async syncAppBadge(count: number): Promise<void> {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as any;
    try {
      if (count > 0 && typeof nav.setAppBadge === 'function') {
        await nav.setAppBadge(count);
      } else if (count <= 0 && typeof nav.clearAppBadge === 'function') {
        await nav.clearAppBadge();
      }
    } catch {
      // Ignore unsupported badge API errors
    }
  }

  async installPwa(): Promise<void> {
    if (!this.deferredPrompt) {
      if (typeof window !== 'undefined') {
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        if (isIos) {
          this.showToast('To install LuantiHub on iOS: tap Share, then "Add to Home Screen"', 5000);
        } else {
          this.showToast('LuantiHub is ready for offline use. Add it via your browser menu.', 5000);
        }
      }
      return;
    }

    try {
      this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        this.canInstall.set(false);
        this.isInstalled.set(true);
        try {
          localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.warn('Install prompt error:', err);
    } finally {
      this.deferredPrompt = null;
    }
  }

  /**
   * Directly fetches `/ngsw.json` bypassing the Service Worker (`ngsw-bypass=true`) and browser/CDN cache,
   * and checks if the deployed `main-*.js`, `styles-*.css`, or manifest signature differs from the running app.
   */
  private async checkManifestBundleChanged(timeoutMs = 3500): Promise<boolean> {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof fetch !== 'function') {
      return false;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(`/ngsw.json?ngsw-bypass=true&ngsw-cache-bust=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'ngsw-bypass': 'true',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        signal: controller?.signal
      });
      if (!res || !res.ok) return false;
      const manifest = await res.json();
      const appGroup = Array.isArray(manifest?.assetGroups)
        ? manifest.assetGroups.find((g: any) => g.name === 'app')
        : null;
      const urls: string[] = Array.isArray(appGroup?.urls) ? appGroup.urls : [];

      // 1. Compare main-*.js bundle hash against DOM <script src>
      const remoteMain = urls.find((u: string) => /\/main-[A-Za-z0-9]+\.js$/.test(u));
      if (remoteMain) {
        const scripts = Array.from(document.querySelectorAll('script[src]'))
          .map(s => s.getAttribute('src') || '');
        const currentMain = scripts.find(src => /main-[A-Za-z0-9]+\.js/.test(src));
        if (currentMain) {
          const remoteFilename = remoteMain.replace(/^\//, '');
          const currentFilename = currentMain.split('/').pop() || '';
          if (remoteFilename && currentFilename && remoteFilename !== currentFilename) {
            this.latestDetectedUpdateVersion = remoteFilename;
            return true;
          }
        }
      }

      // 2. Compare styles-*.css bundle hash against DOM <link rel="stylesheet" href>
      const remoteStyles = urls.find((u: string) => /\/styles-[A-Za-z0-9]+\.css$/.test(u));
      if (remoteStyles) {
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
          .map(l => l.getAttribute('href') || '');
        const currentStyles = links.find(href => /styles-[A-Za-z0-9]+\.css/.test(href));
        if (currentStyles) {
          const remoteStyleFile = remoteStyles.replace(/^\//, '');
          const currentStyleFile = currentStyles.split('/').pop()?.split('?')[0] || '';
          if (remoteStyleFile && currentStyleFile && remoteStyleFile !== currentStyleFile) {
            this.latestDetectedUpdateVersion = remoteStyleFile;
            return true;
          }
        }
      }

      // 3. Compare DOM <meta name="lh-build-timestamp"> against manifest timestamp / appData.buildTimestamp
      const remoteBuildTs = String(
        manifest?.appData?.buildTimestamp ?? manifest?.timestamp ?? ''
      ).trim();
      const domBuildTsMeta = document
        .querySelector('meta[name="lh-build-timestamp"]')
        ?.getAttribute('content')
        ?.trim();
      if (domBuildTsMeta && remoteBuildTs && domBuildTsMeta !== remoteBuildTs) {
        this.latestDetectedUpdateVersion = remoteBuildTs;
        return true;
      }

      // 4. Compare manifest /index.html hash, /custom-sw.js hash, and build timestamp across checks in the same session
      const indexHash = manifest?.hashTable?.['/index.html'] || '';
      const customSwHash = manifest?.hashTable?.['/custom-sw.js'] || '';
      const signature = `${remoteMain || ''}|${remoteStyles || ''}|${indexHash}|${customSwHash}|${remoteBuildTs}`;
      if (signature !== '||||') {
        if (this.bootManifestSignature === null) {
          this.bootManifestSignature = signature;
          this.syncNotificationStateToIndexedDb().catch(() => {});
        } else if (this.bootManifestSignature !== signature) {
          this.bootManifestSignature = signature;
          this.syncNotificationStateToIndexedDb().catch(() => {});
          this.latestDetectedUpdateVersion =
            remoteBuildTs || indexHash || String(manifest?.timestamp || Date.now());
          return true;
        }
      }

      return false;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Calls `swUpdate.checkForUpdate()` with a strict timeout and controller check.
   * Angular's `NgswCommChannel` waits indefinitely if `navigator.serviceWorker.controller` is `null`
   * (e.g. after a domain migration, cache clear, or hard reload) or if `ngsw-worker.js` is in `SAFE_MODE`.
   */
  private async checkSwUpdateWithTimeout(timeoutMs = 2500): Promise<boolean> {
    if (!this.swUpdate?.isEnabled) {
      return false;
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker) {
      if (!navigator.serviceWorker.controller) {
        navigator.serviceWorker
          .getRegistration()
          .then(reg => reg?.update())
          .catch(() => {});
        return false;
      }
    }
    try {
      return await Promise.race([
        this.swUpdate.checkForUpdate(),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs))
      ]);
    } catch {
      return false;
    }
  }

  async checkForUpdate(interactive = true): Promise<boolean> {
    if (this.updateAvailable()) {
      if (interactive) {
        this.notifyAppUpdateAvailable(this.latestDetectedUpdateVersion || undefined);
      }
      return true;
    }

    try {
      if (interactive) {
        this.checkingForUpdate.set(true);
      }

      const [swDetected, manifestChanged] = await Promise.all([
        this.checkSwUpdateWithTimeout(2500),
        this.checkManifestBundleChanged(3500)
      ]);
      const hasUpdate = Boolean(swDetected || manifestChanged);

      if (hasUpdate) {
        this.notifyAppUpdateAvailable(this.latestDetectedUpdateVersion || undefined);
      } else if (interactive) {
        this.showToast('pwa.upToDate');
      }
      return hasUpdate;
    } catch (err) {
      console.warn('PWA update check failed:', err);
      if (interactive) {
        this.showToast('pwa.upToDate');
      }
      return false;
    } finally {
      if (interactive) {
        this.checkingForUpdate.set(false);
      }
    }
  }

  async activateUpdate(): Promise<void> {
    if (
      this.swUpdate?.isEnabled &&
      typeof navigator !== 'undefined' &&
      navigator.serviceWorker?.controller
    ) {
      try {
        await Promise.race([
          this.swUpdate.activateUpdate(),
          new Promise<void>(resolve => setTimeout(() => resolve(), 1500))
        ]);
      } catch (err) {
        console.warn('Could not activate update via SwUpdate, clearing cache and reloading:', err);
      }
    }
    await this.forceClearCacheAndReload();
  }

  async forceClearCacheAndReload(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      if (typeof window !== 'undefined' && 'caches' in window) {
        const cacheKeys = await caches.keys();
        for (const key of cacheKeys) {
          await caches.delete(key);
        }
      }

      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.clear();
      }
    } catch (err) {
      console.warn('Error clearing caches/service workers:', err);
    } finally {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  }

  applyUpdate(): void {
    this.activateUpdate();
  }

  showToast(msg: string, durationMs = 4000): void {
    this.statusMessage.set(msg);
    if (this.messageClearTimer) {
      clearTimeout(this.messageClearTimer);
    }
    this.messageClearTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.messageClearTimer = null;
    }, durationMs);
  }

  private getCanonicalAppUrl(): string {
    if (
      typeof window !== 'undefined' &&
      window.location?.origin &&
      !window.location.origin.includes('luanti-hub.pages.dev')
    ) {
      return window.location.origin;
    }
    return 'https://luantihub.org';
  }

  async copyAppLink(): Promise<boolean> {
    const url = this.getCanonicalAppUrl();
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        this.showToast('common.copiedToClipboard');
        return true;
      } catch {
        // Ignore clipboard errors
      }
    }
    return false;
  }

  async shareApp(customTitle?: string, customText?: string): Promise<void> {
    const url = this.getCanonicalAppUrl();
    const title = customTitle || 'LuantiHub — Decentralized Package Registry & Content Hub';
    const text = customText || 'Discover, browse, and install mods, games, and texture packs for Luanti (Minetest).';
    await this.sharePackage(title, text, url);
  }

  async sharePackage(title: string, _text: string, url: string): Promise<void> {
    let copied = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        this.showToast('common.copiedToClipboard');
        copied = true;
      } catch {
        // Ignore clipboard errors
      }
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        // Omit `text` when sharing `url` because macOS / Chromium share sheets concatenate `url + text` without a space on Copy
        await navigator.share({ title, url });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return;
        }
        // Fall through to clipboard copy if navigator.share failed for a non-abort reason
      }
    }
    if (!copied && typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(url);
        this.showToast('common.copiedToClipboard');
      } catch {
        // Ignore clipboard errors
      }
    }
  }
}

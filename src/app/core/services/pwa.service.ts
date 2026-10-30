import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate, SwPush, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { SettingsService } from './settings.service';

export interface NativeNotificationPayload {
  title: string;
  body: string;
  tag: string;
  category: 'moderation' | 'admin_queue' | 'app_update' | 'new_git_package';
  icon?: string;
  image?: string;
  data?: {
    targetTab?: 'moderation' | 'account' | 'packages';
    packageId?: string;
    reportId?: string;
    action?: 'reload_update';
  };
}

const SEEN_NOTIFICATION_TAGS_KEY = 'lh_seen_notification_tags';
const KNOWN_GIT_PACKAGES_KEY = 'lh_known_git_packages_v1';
const PWA_INSTALLED_STORAGE_KEY = 'lh_pwa_installed';
const MAX_SEEN_TAGS = 100;

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

  private deferredPrompt: any = null;
  private messageClearTimer: any = null;
  private notificationClickHandler: ((data: any) => void) | null = null;

  constructor() {
    this.initSwUpdate();
    this.initInstallPrompt();
    this.initNotificationClickRouting();
    this.initPermissionStatusWatcher();
    this.initNetworkStatusWatcher();
  }

  private initNetworkStatusWatcher(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isOnline.set(true);
      this.showToast('pwa.backOnline', 3000);
    });

    window.addEventListener('offline', () => {
      this.isOnline.set(false);
      this.showToast('pwa.offlineModeToast', 4000);
    });
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

  private initSwUpdate(): void {
    if (this.swUpdate?.isEnabled) {
      // 1. Listen for version ready
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe((evt) => {
          this.updateAvailable.set(true);
          this.statusMessage.set(null);
          const hash = (evt as any).latestVersion?.hash || Date.now();
          this.sendNativeNotification({
            title: 'LuantiHub Update Available',
            body: 'A new version of LuantiHub is ready. Click to reload with the latest features.',
            tag: `lh-app-update-${hash}`,
            category: 'app_update',
            data: { action: 'reload_update' }
          });
        });

      // 2. Periodic background check every 30 minutes
      if (typeof window !== 'undefined') {
        setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            this.checkForUpdate(false);
          }
        }, 30 * 60 * 1000);

        // 3. Check for updates whenever returning to the tab / PWA
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.checkForUpdate(false);
          }
        });
      }
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
        e.preventDefault();
        if (this.isStandaloneDisplayMode()) {
          this.isInstalled.set(true);
          this.canInstall.set(false);
          return;
        }
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

  markNotificationTagSeen(tag: string): void {
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
    return false;
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
        data: {
          packageId: resolvedId
        }
      });
    }

    return newlyDiscovered.length;
  }

  private blobToDataUrl(blob: Blob): Promise<string | null> {
    if (typeof FileReader === 'undefined') {
      return Promise.resolve(null);
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

  private async fetchImageAsDataUrl(url: string, timeoutMs = 1500): Promise<string | null> {
    if (typeof fetch !== 'function') return null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'reload',
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
      const parsed = new URL(rawUrl, origin || 'https://luanti-hub.pages.dev');
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      const host = parsed.hostname.toLowerCase();
      const supportsDirectCors =
        host === 'raw.githubusercontent.com' || host === 'avatars.githubusercontent.com';

      if (supportsDirectCors) {
        const directDataUrl = await this.fetchImageAsDataUrl(parsed.toString());
        if (directDataUrl) return directDataUrl;
      }

      if (origin) {
        const proxyUrl = `${origin}/api/packages?proxy_image=${encodeURIComponent(parsed.toString())}`;
        const proxiedDataUrl = await this.fetchImageAsDataUrl(proxyUrl);
        if (proxiedDataUrl) return proxiedDataUrl;
      }

      if (!supportsDirectCors) {
        const fallbackDirectDataUrl = await this.fetchImageAsDataUrl(parsed.toString());
        if (fallbackDirectDataUrl) return fallbackDirectDataUrl;
      }

      return null;
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
    const defaultAppIcon = `${origin}/icons/icon-192x192.png`;
    const defaultAppBadge = `${origin}/icons/icon-72x72.png`;
    const rawCandidate = (payload.icon || payload.image || '').trim();

    let resolvedIcon = defaultAppIcon;
    let resolvedImage: string | undefined;

    if (
      rawCandidate &&
      rawCandidate !== 'logo.svg' &&
      rawCandidate !== '/logo.svg' &&
      !rawCandidate.toLowerCase().endsWith('.svg')
    ) {
      if (rawCandidate.startsWith('data:image/')) {
        resolvedIcon = rawCandidate;
        resolvedImage = rawCandidate;
      } else if (rawCandidate.startsWith('/')) {
        resolvedIcon = `${origin}${rawCandidate}`;
      } else if (origin && rawCandidate.startsWith(origin)) {
        resolvedIcon = rawCandidate;
      } else if (/^https?:\/\//i.test(rawCandidate)) {
        const dataUrl = await this.resolveCorsSafeNotificationImage(rawCandidate, origin);
        if (dataUrl) {
          resolvedIcon = dataUrl;
          resolvedImage = dataUrl;
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
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(payload.title, options);
          return true;
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
   * Directly fetches `/ngsw.json` bypassing browser/CDN cache and checks if the deployed
   * `main-*.js` bundle hash differs from the currently running script in the DOM.
   */
  private async checkManifestBundleChanged(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    try {
      const res = await fetch(`/ngsw.json?ngsw-cache-bust=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      if (!res.ok) return false;
      const manifest = await res.json();
      const appGroup = Array.isArray(manifest?.assetGroups)
        ? manifest.assetGroups.find((g: any) => g.name === 'app')
        : null;
      const urls: string[] = Array.isArray(appGroup?.urls) ? appGroup.urls : [];
      const remoteMain = urls.find((u: string) => /\/main-[A-Za-z0-9]+\.js$/.test(u));
      if (!remoteMain) return false;

      const scripts = Array.from(document.querySelectorAll('script[src]'))
        .map(s => s.getAttribute('src') || '');
      const currentMain = scripts.find(src => /main-[A-Za-z0-9]+\.js/.test(src));
      if (!currentMain) return false;

      const remoteFilename = remoteMain.replace(/^\//, '');
      const currentFilename = currentMain.split('/').pop() || '';
      return Boolean(remoteFilename && currentFilename && remoteFilename !== currentFilename);
    } catch {
      return false;
    }
  }

  async checkForUpdate(interactive = true): Promise<boolean> {
    if (this.updateAvailable()) {
      return true;
    }

    try {
      if (interactive) {
        this.checkingForUpdate.set(true);
      }

      let hasUpdate = false;
      if (this.swUpdate?.isEnabled) {
        try {
          hasUpdate = await this.swUpdate.checkForUpdate();
        } catch {
          hasUpdate = false;
        }
      }

      if (!hasUpdate) {
        hasUpdate = await this.checkManifestBundleChanged();
      }

      if (hasUpdate) {
        this.updateAvailable.set(true);
        this.statusMessage.set(null);
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
    if (!this.swUpdate?.isEnabled) {
      await this.forceClearCacheAndReload();
      return;
    }

    try {
      await this.swUpdate.activateUpdate();
    } catch (err) {
      console.warn('Could not activate update via SwUpdate, clearing cache and reloading:', err);
    } finally {
      await this.forceClearCacheAndReload();
    }
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

  dismissBanner(): void {
    this.updateAvailable.set(false);
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
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'https://luanti-hub.pages.dev';
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

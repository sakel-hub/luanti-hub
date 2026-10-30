import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  readonly contentDbUrl = signal<string>(
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://luanti-hub.pages.dev'
  );
  readonly preferredEngine = signal<string>('5.9.0');
  readonly favorites = signal<string[]>([]);
  readonly downloadedPackages = signal<Record<string, number>>({});
  readonly notificationsEnabled = signal<boolean>(false);
  readonly notifyModeration = signal<boolean>(true);
  readonly notifyAdminQueue = signal<boolean>(true);
  readonly notifyAppUpdates = signal<boolean>(true);
  readonly notifyNewGitPackages = signal<boolean>(true);
  readonly isAuthenticatedSession = signal<boolean>(false);
  readonly edgeApiAvailable = signal<boolean>(false);
  readonly clientId = signal<string>('anon_default');

  constructor() {
    this.loadSettings();

    // Auto-persist whenever signals change
    effect(() => {
      try {
        localStorage.setItem('lh_contentdb_url', this.contentDbUrl());
        localStorage.setItem('lh_preferred_engine', this.preferredEngine());
        localStorage.setItem('lh_favorites', JSON.stringify(this.favorites()));
        localStorage.setItem('lh_downloaded_packages', JSON.stringify(this.downloadedPackages()));
        localStorage.setItem(
          'lh_notification_prefs',
          JSON.stringify({
            enabled: this.notificationsEnabled(),
            moderation: this.notifyModeration(),
            adminQueue: this.notifyAdminQueue(),
            appUpdates: this.notifyAppUpdates(),
            newGitPackages: this.notifyNewGitPackages()
          })
        );
        localStorage.setItem('lh_client_id', this.clientId());
      } catch {
        // LocalStorage disabled or quota exceeded
      }
    });
  }

  private loadSettings(): void {
    try {
      let savedClient = localStorage.getItem('lh_client_id');
      if (!savedClient || savedClient.length < 8) {
        const rand = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().replace(/-/g, '')
          : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        savedClient = `anon_${rand}`;
      }
      this.clientId.set(savedClient);

      const savedUrl = localStorage.getItem('lh_contentdb_url');
      if (savedUrl) this.contentDbUrl.set(savedUrl);

      const savedEngine = localStorage.getItem('lh_preferred_engine');
      if (savedEngine) this.preferredEngine.set(savedEngine);

      const savedFavs = localStorage.getItem('lh_favorites');
      if (savedFavs) {
        const parsed = JSON.parse(savedFavs);
        if (Array.isArray(parsed)) {
          // Keep only valid 'author/name' package IDs (filter out any legacy mock IDs like '1' or 'pkg-1')
          const validFavs = Array.from(
            new Set(
              parsed.filter((id: any) => typeof id === 'string' && id.includes('/') && id.trim().length > 2)
            )
          );
          this.favorites.set(validFavs);
        }
      }

      const savedNotifPrefs = localStorage.getItem('lh_notification_prefs');
      if (savedNotifPrefs) {
        const parsedPrefs = JSON.parse(savedNotifPrefs);
        if (parsedPrefs && typeof parsedPrefs === 'object') {
          if (typeof parsedPrefs.enabled === 'boolean') {
            this.notificationsEnabled.set(parsedPrefs.enabled);
          }
          if (typeof parsedPrefs.moderation === 'boolean') {
            this.notifyModeration.set(parsedPrefs.moderation);
          }
          if (typeof parsedPrefs.adminQueue === 'boolean') {
            this.notifyAdminQueue.set(parsedPrefs.adminQueue);
          }
          if (typeof parsedPrefs.appUpdates === 'boolean') {
            this.notifyAppUpdates.set(parsedPrefs.appUpdates);
          }
          if (typeof parsedPrefs.newGitPackages === 'boolean') {
            this.notifyNewGitPackages.set(parsedPrefs.newGitPackages);
          }
        }
      }

      const savedDownloads = localStorage.getItem('lh_downloaded_packages');
      if (savedDownloads) {
        const parsedDl = JSON.parse(savedDownloads);
        if (parsedDl && typeof parsedDl === 'object' && !Array.isArray(parsedDl)) {
          const cleanDl: Record<string, number> = {};
          for (const [k, v] of Object.entries(parsedDl)) {
            const count = Number(v);
            if (k && k.includes('/') && Number.isFinite(count) && count > 0) {
              cleanDl[k.toLowerCase()] = Math.floor(count);
            }
          }
          this.downloadedPackages.set(cleanDl);
        }
      }
    } catch {
      // Defaults kept
    }
  }

  recordLocalDownload(packageId: string): void {
    if (!packageId || !packageId.includes('/')) return;
    const key = packageId.toLowerCase();
    this.downloadedPackages.update(curr => ({
      ...curr,
      [key]: (curr[key] || 0) + 1
    }));
  }

  getDownloadCount(packageId: string): number {
    if (!packageId) return 0;
    return this.downloadedPackages()[packageId.toLowerCase()] || 0;
  }

  mergeServerDownloads(serverDownloads?: Record<string, number>): void {
    if (!serverDownloads || typeof serverDownloads !== 'object') return;
    this.downloadedPackages.update(local => {
      const merged: Record<string, number> = { ...local };
      for (const [pkgId, count] of Object.entries(serverDownloads)) {
        const cleanCount = Number(count);
        if (pkgId && pkgId.includes('/') && Number.isFinite(cleanCount) && cleanCount > 0) {
          const key = pkgId.toLowerCase();
          merged[key] = Math.max(merged[key] || 0, Math.floor(cleanCount));
        }
      }
      return merged;
    });
  }

  toggleFavorite(packageId: string): boolean {
    let added = false;
    const lowerTarget = packageId.toLowerCase();
    this.favorites.update(favs => {
      if (favs.some(id => id.toLowerCase() === lowerTarget)) {
        added = false;
        return favs.filter(id => id.toLowerCase() !== lowerTarget);
      }
      added = true;
      return [...favs, packageId];
    });

    // Track favorite toggle on the server (supports both authenticated and anonymous client IDs)
    this.syncFavoriteAction(added ? 'add' : 'remove', packageId);
    return added;
  }

  removeFavorite(packageId: string): void {
    const lowerTarget = packageId.toLowerCase();
    this.favorites.update(favs => favs.filter(id => id.toLowerCase() !== lowerTarget));
    this.syncFavoriteAction('remove', packageId);
  }

  isFavorite(packageId: string): boolean {
    if (!packageId) return false;
    const lowerTarget = packageId.toLowerCase();
    return this.favorites().some(id => id.toLowerCase() === lowerTarget);
  }

  async mergeServerFavorites(serverFavs?: string[]): Promise<void> {
    const localFavs = this.favorites();
    const validServerFavs = (serverFavs || []).filter(id => typeof id === 'string' && id.includes('/'));
    const serverLowerSet = new Set(validServerFavs.map(id => id.toLowerCase()));
    const hasUnsyncedLocal = localFavs.some(id => !serverLowerSet.has(id.toLowerCase()));

    const seen = new Set<string>();
    const combined: string[] = [];
    for (const id of [...localFavs, ...validServerFavs]) {
      const lower = id.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        combined.push(id);
      }
    }
    this.favorites.set(combined);

    // Only call POST /api/auth/favorites when the browser actually has unsynced local favorites not yet on the server
    if (hasUnsyncedLocal && combined.length > 0 && this.edgeApiAvailable()) {
      try {
        const res = await fetch('/api/auth/favorites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': this.clientId()
          },
          body: JSON.stringify({
            action: 'sync',
            packageIds: combined,
            clientId: this.clientId()
          })
        });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const data = await res.json();
          if (Array.isArray(data.favorites) && data.favorites.length > 0) {
            this.favorites.set(data.favorites.filter((id: any) => typeof id === 'string' && id.includes('/')));
          }
        }
      } catch {
        // Offline or unauthenticated - localStorage keeps state
      }
    }
  }

  private syncFavoriteAction(action: 'add' | 'remove', packageId: string): void {
    if (typeof window === 'undefined' || typeof fetch === 'undefined' || !this.edgeApiAvailable()) return;
    fetch('/api/auth/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': this.clientId()
      },
      body: JSON.stringify({
        action,
        packageId,
        clientId: this.clientId()
      })
    }).catch(() => {
      // Offline - localStorage keeps state
    });
  }
}

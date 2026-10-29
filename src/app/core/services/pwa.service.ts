import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private readonly swUpdate = inject(SwUpdate, { optional: true });

  readonly updateAvailable = signal<boolean>(false);
  readonly canInstall = signal<boolean>(false);
  readonly isInstalled = signal<boolean>(this.checkIfInstalled());
  readonly checkingForUpdate = signal<boolean>(false);
  readonly statusMessage = signal<string | null>(null);

  private deferredPrompt: any = null;
  private messageClearTimer: any = null;

  constructor() {
    this.initSwUpdate();
    this.initInstallPrompt();
  }

  private checkIfInstalled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const isStandaloneMedia = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)')?.matches;
      const isNavigatorStandalone = (window.navigator as any)?.standalone === true;
      const isAndroidReferrer = typeof document !== 'undefined' && document.referrer?.includes('android-app://');
      return Boolean(isStandaloneMedia || isNavigatorStandalone || isAndroidReferrer);
    } catch {
      return false;
    }
  }

  private initSwUpdate(): void {
    if (this.swUpdate?.isEnabled) {
      // 1. Listen for version ready
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          this.updateAvailable.set(true);
          this.statusMessage.set(null);
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
      window.addEventListener('beforeinstallprompt', (e: Event) => {
        e.preventDefault();
        this.deferredPrompt = e;
        this.canInstall.set(true);
      });

      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        this.canInstall.set(false);
        this.isInstalled.set(true);
        this.showToast('pwa.installSuccess');
      });
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
    // If an update was already detected (e.g. by the automatic visibilitychange check when focusing the tab),
    // immediately report true instead of letting a second swUpdate.checkForUpdate() return false.
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

  async sharePackage(title: string, text: string, url: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // User cancelled or unsupported
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      this.showToast('common.copiedToClipboard');
    }
  }
}

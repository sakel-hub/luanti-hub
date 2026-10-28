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
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
    );
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
        this.setStatusMessage('pwa.installSuccess');
      });
    }
  }

  async installPwa(): Promise<void> {
    if (!this.deferredPrompt) {
      // If prompt not natively available (e.g., iOS Safari or already installed), alert instructions
      if (typeof window !== 'undefined') {
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        if (isIos) {
          alert('To install LuantiHub on iOS:\n1. Tap the Share button (square with arrow)\n2. Select "Add to Home Screen"');
        } else {
          alert('LuantiHub is ready for offline use. You can add it to your apps via your browser menu (⋮ or ⊞).');
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
   * Manually check the server for a newer version
   */
  async checkForUpdate(interactive = true): Promise<boolean> {
    if (!this.swUpdate?.isEnabled) {
      if (interactive) {
        this.setStatusMessage('pwa.upToDate');
      }
      return false;
    }

    try {
      if (interactive) {
        this.checkingForUpdate.set(true);
      }

      const hasUpdate = await this.swUpdate.checkForUpdate();
      if (hasUpdate) {
        this.updateAvailable.set(true);
        this.statusMessage.set(null);
      } else if (interactive) {
        this.setStatusMessage('pwa.upToDate');
      }
      return hasUpdate;
    } catch (err) {
      console.warn('PWA update check failed:', err);
      if (interactive) {
        this.setStatusMessage('pwa.upToDate');
      }
      return false;
    } finally {
      if (interactive) {
        this.checkingForUpdate.set(false);
      }
    }
  }

  /**
   * Activates the downloaded version and reloads the browser
   */
  async activateUpdate(): Promise<void> {
    if (!this.swUpdate?.isEnabled) {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
      return;
    }

    try {
      await this.swUpdate.activateUpdate();
    } catch (err) {
      console.warn('Could not activate update via SwUpdate, reloading directly:', err);
    } finally {
      if (typeof document !== 'undefined') {
        document.location.reload();
      }
    }
  }

  /**
   * Complete hard-reset: Unregisters all service workers, clears CacheStorage, clears localStorage cache, and reloads
   */
  async forceClearCacheAndReload(): Promise<void> {
    try {
      // 1. Unregister all service workers
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      // 2. Clear all CacheStorage caches
      if (typeof window !== 'undefined' && 'caches' in window) {
        const cacheKeys = await caches.keys();
        for (const key of cacheKeys) {
          await caches.delete(key);
        }
      }

      // 3. Clean temporary session storage
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

  private setStatusMessage(msg: string): void {
    this.statusMessage.set(msg);
    if (this.messageClearTimer) {
      clearTimeout(this.messageClearTimer);
    }
    this.messageClearTimer = setTimeout(() => {
      this.statusMessage.set(null);
      this.messageClearTimer = null;
    }, 4000);
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
      this.setStatusMessage('common.copiedToClipboard');
    }
  }
}

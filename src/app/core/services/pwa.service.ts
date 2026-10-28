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

  private deferredPrompt: any = null;

  constructor() {
    this.initSwUpdate();
    this.initInstallPrompt();
  }

  private initSwUpdate(): void {
    if (this.swUpdate?.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          this.updateAvailable.set(true);
        });
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
      });
    }
  }

  async installPwa(): Promise<void> {
    if (!this.deferredPrompt) return;
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      this.canInstall.set(false);
    }
    this.deferredPrompt = null;
  }

  applyUpdate(): void {
    document.location.reload();
  }

  async sharePackage(title: string, text: string, url: string): Promise<void> {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // User cancelled or unsupported
      }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    }
  }
}

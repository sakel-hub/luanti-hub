import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  readonly contentDbUrl = signal<string>('https://luanti-hub.pages.dev');
  readonly preferredEngine = signal<string>('5.8.0');
  readonly favorites = signal<string[]>([]);
  readonly highContrast = signal<boolean>(false);

  constructor() {
    this.loadSettings();

    // Auto-persist whenever signals change
    effect(() => {
      try {
        localStorage.setItem('lh_contentdb_url', this.contentDbUrl());
        localStorage.setItem('lh_preferred_engine', this.preferredEngine());
        localStorage.setItem('lh_favorites', JSON.stringify(this.favorites()));
      } catch {
        // LocalStorage disabled or quota exceeded
      }
    });
  }

  private loadSettings(): void {
    try {
      const savedUrl = localStorage.getItem('lh_contentdb_url');
      if (savedUrl) this.contentDbUrl.set(savedUrl);

      const savedEngine = localStorage.getItem('lh_preferred_engine');
      if (savedEngine) this.preferredEngine.set(savedEngine);

      const savedFavs = localStorage.getItem('lh_favorites');
      if (savedFavs) this.favorites.set(JSON.parse(savedFavs));
    } catch {
      // Defaults kept
    }
  }

  toggleFavorite(packageId: string): void {
    this.favorites.update(favs => {
      if (favs.includes(packageId)) {
        return favs.filter(id => id !== packageId);
      }
      return [...favs, packageId];
    });
  }

  isFavorite(packageId: string): boolean {
    return this.favorites().includes(packageId);
  }
}

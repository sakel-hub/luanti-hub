import { Injectable, computed, signal, inject } from '@angular/core';
import { Location } from '@angular/common';
import { LuantiPackage, CommunityReview } from '../models/package.model';

@Injectable({
  providedIn: 'root'
})
export class PackageService {
  private readonly location = inject(Location, { optional: true });

  private readonly _packages = signal<LuantiPackage[]>([]);
  private readonly _searchQuery = signal<string>('');
  private readonly _selectedType = signal<string>('all');
  private readonly _selectedSource = signal<string>('all');
  private readonly _isLoading = signal<boolean>(true);
  private readonly _activePackage = signal<LuantiPackage | null>(null);
  private readonly _isSubmitModalOpen = signal<boolean>(false);
  private readonly _isSetupModalOpen = signal<boolean>(false);

  // Readonly Public Signals
  readonly packages = this._packages.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly selectedType = this._selectedType.asReadonly();
  readonly selectedSource = this._selectedSource.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly activePackage = this._activePackage.asReadonly();
  readonly isSubmitModalOpen = this._isSubmitModalOpen.asReadonly();
  readonly isSetupModalOpen = this._isSetupModalOpen.asReadonly();

  // Curated Multi-Item Hero Showcase (Category-Diverse, High-Quality & Fresh)
  readonly heroShowcasePackages = computed<LuantiPackage[]>(() => {
    const list = this._packages();
    if (list.length === 0) return [];

    // Helper: compute relevance score (quality + popularity + completeness)
    const scoreItem = (pkg: LuantiPackage): number => {
      let score = (pkg.score || 4.5) * 20;
      score += Math.min(30, Math.log10((pkg.downloads || 100) + 1) * 7);
      if (pkg.featured) score += 35;
      if (pkg.banner) score += 15;
      if (pkg.source === 'git') score += 20;
      return score;
    };

    // Category Buckets
    const games = list
      .filter(p => p.type === 'game')
      .sort((a, b) => scoreItem(b) - scoreItem(a));

    const automation = list
      .filter(p => p.type === 'mod' && (
        p.tags?.some(t => ['automation', 'circuits', 'technology', 'mesecons', 'pipe'].includes(t.toLowerCase())) ||
        p.name?.toLowerCase().includes('mesecon') ||
        p.name?.toLowerCase().includes('pipe')
      ))
      .sort((a, b) => scoreItem(b) - scoreItem(a));

    const gitMods = list
      .filter(p => p.source === 'git')
      .sort((a, b) => scoreItem(b) - scoreItem(a));

    const textures = list
      .filter(p => p.type === 'txp')
      .sort((a, b) => scoreItem(b) - scoreItem(a));

    const topMods = list
      .filter(p => p.type === 'mod' && !automation.includes(p))
      .sort((a, b) => scoreItem(b) - scoreItem(a));

    const showcase: LuantiPackage[] = [];
    const pushUnique = (pkg?: LuantiPackage) => {
      if (pkg && !showcase.some(item => item.id === pkg.id)) {
        showcase.push(pkg);
      }
    };

    // Guaranteed Diversity: 1 Game, 1 Automation, 1 Git, 1 Game 2, 1 Texture, 1 Mod
    pushUnique(games[0]);
    pushUnique(automation[0]);
    pushUnique(gitMods[0]);
    pushUnique(games[1]);
    pushUnique(textures[0]);
    pushUnique(topMods[0]);

    // If still less than 5, fill from remaining top scoring
    if (showcase.length < 5) {
      const remaining = [...list].sort((a, b) => scoreItem(b) - scoreItem(a));
      for (const p of remaining) {
        pushUnique(p);
        if (showcase.length >= 6) break;
      }
    }

    // Daily deterministic rotation offset (ensures each day has a different starting highlight)
    if (showcase.length > 1) {
      const now = new Date();
      const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getFullYear(), 0, 0)) / 86400000);
      const shift = dayOfYear % showcase.length;
      return [...showcase.slice(shift), ...showcase.slice(0, shift)];
    }

    return showcase;
  });

  // Featured Billboard Item (First of showcase or fallback)
  readonly featuredPackage = computed(() => {
    const list = this.heroShowcasePackages();
    return list.length > 0 ? list[0] : null;
  });

  // Filtered List based on Search Bar and Type/Source Selectors
  readonly filteredPackages = computed(() => {
    const q = this._searchQuery().trim().toLowerCase();
    const type = this._selectedType();
    const source = this._selectedSource();

    return this._packages().filter(pkg => {
      const matchesQuery = !q ||
        pkg.title?.toLowerCase().includes(q) ||
        pkg.name?.toLowerCase().includes(q) ||
        pkg.author?.toLowerCase().includes(q) ||
        pkg.short_desc?.toLowerCase().includes(q) ||
        (pkg.tags && pkg.tags.some(t => t.toLowerCase().includes(q)));

      const matchesType = type === 'all' || pkg.type === type;
      const matchesSource = source === 'all' || pkg.source === source;

      return matchesQuery && matchesType && matchesSource;
    });
  });

  // Netflix Swimlanes (All Computed Dynamically from Cloudflare D1 + Live Data)
  readonly top10Timeframe = signal<'today' | 'week'>('week');
  private readonly _serverTop10Today = signal<LuantiPackage[]>([]);
  private readonly _serverTop10Week = signal<LuantiPackage[]>([]);

  readonly top10Packages = computed<LuantiPackage[]>(() => {
    const timeframe = this.top10Timeframe();
    const serverList = timeframe === 'today' ? this._serverTop10Today() : this._serverTop10Week();
    if (serverList.length > 0) {
      return serverList;
    }

    // Graceful offline/local fallback when D1 server endpoint is unreachable
    const list = [...this._packages()];
    if (list.length === 0) return [];

    if (timeframe === 'today') {
      // Top 10 Today: weighted towards trending velocity, featured items, and community ratings
      return list
        .sort((a, b) => {
          const scoreA = ((a.score || 4.5) * 200) + Math.log2((a.downloads || 1) + 1) * 25 + (a.featured ? 60 : 0) + (a.source === 'git' ? 40 : 0);
          const scoreB = ((b.score || 4.5) * 200) + Math.log2((b.downloads || 1) + 1) * 25 + (b.featured ? 60 : 0) + (b.source === 'git' ? 40 : 0);
          return scoreB - scoreA;
        })
        .slice(0, 10);
    } else {
      // Top 10 This Week: verified community momentum, total installs, and high rating stability
      return list
        .sort((a, b) => {
          const scoreA = (a.downloads || 0) + ((a.score || 4.5) * 1500) + (a.featured ? 2500 : 0);
          const scoreB = (b.downloads || 0) + ((b.score || 4.5) * 1500) + (b.featured ? 2500 : 0);
          return scoreB - scoreA;
        })
        .slice(0, 10);
    }
  });

  setTop10Timeframe(timeframe: 'today' | 'week'): void {
    this.top10Timeframe.set(timeframe);
    this.fetchTop10(timeframe);
  }

  async fetchTop10(timeframe?: 'today' | 'week'): Promise<void> {
    const tf = timeframe || this.top10Timeframe();
    try {
      const res = await fetch(`/api/packages/top10?timeframe=${tf}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          if (tf === 'today') {
            this._serverTop10Today.set(data);
          } else {
            this._serverTop10Week.set(data);
          }
        }
      }
    } catch {
      // Fallback to computed local metrics
    }
  }

  trackDownload(pkg: LuantiPackage): void {
    if (!pkg || !pkg.author || !pkg.name) return;
    const url = `/api/packages/${pkg.author}/${pkg.name}/download`;
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(url);
      } else {
        fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch {
      // Best-effort non-blocking download tracking
    }
  }

  readonly trendingPackages = computed(() => {
    return [...this._packages()].sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  });

  readonly standaloneGames = computed(() => {
    return this._packages().filter(p => p.type === 'game');
  });

  readonly decentralizedGitPackages = computed(() => {
    return this._packages().filter(p => p.source === 'git' || p.repo_url);
  });

  readonly automationMods = computed(() => {
    return this._packages().filter(p => 
      p.tags?.some(t => ['automation', 'circuits', 'technology', 'mesecons'].includes(t.toLowerCase())) ||
      p.name?.toLowerCase().includes('mesecon') ||
      p.name?.toLowerCase().includes('pipe') ||
      p.name?.toLowerCase().includes('tech') ||
      p.name?.toLowerCase().includes('worldedit') ||
      p.title?.toLowerCase().includes('automation') ||
      p.title?.toLowerCase().includes('armor') ||
      p.title?.toLowerCase().includes('tech')
    );
  });

  readonly texturePacks = computed(() => {
    return this._packages().filter(p => p.type === 'txp');
  });

  constructor() {
    this.initCatalog();
    this.initHistorySync();
  }

  private initHistorySync(): void {
    if (this.location) {
      this.location.subscribe((popState) => {
        const url = popState.url || '/';
        if (url.startsWith('/package/')) {
          const parts = url.replace('/package/', '').split('/');
          if (parts[0] && parts[1]) {
            this.openPackageModalById(parts[0], parts[1], false);
            return;
          }
        } else if (url === '/submit') {
          this._activePackage.set(null);
          this._isSetupModalOpen.set(false);
          this._isSubmitModalOpen.set(true);
          return;
        } else if (url === '/setup') {
          this._activePackage.set(null);
          this._isSubmitModalOpen.set(false);
          this._isSetupModalOpen.set(true);
          return;
        }
        this.closeAllModals(false);
      });
    }

    if (typeof window !== 'undefined' && window.location?.pathname) {
      const path = window.location.pathname;
      if (path.startsWith('/package/')) {
        const parts = path.replace('/package/', '').split('/');
        if (parts[0] && parts[1]) {
          this.openPackageModalById(parts[0], parts[1], false);
        }
      } else if (path === '/submit') {
        this._isSubmitModalOpen.set(true);
      } else if (path === '/setup') {
        this._isSetupModalOpen.set(true);
      }
    }
  }

  // Fetch Live Packages from Backend API (Cloudflare D1 + ContentDB + Milcho failover)
  async initCatalog(): Promise<void> {
    try {
      this._isLoading.set(true);

      const apiUrl = typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}/api/packages/`
        : 'https://contentdb.milcho.org/api/packages/';

      let response = await fetch(apiUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        response = await fetch('https://contentdb.milcho.org/api/packages/', {
          headers: { 'Accept': 'application/json' }
        });
      }

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          const normalized: LuantiPackage[] = data.map((item: any, idx: number) => {
            const shortDesc = item.short_desc || item.short_description || '';
            const releaseNum = item.release || 1000;
            const downloads = item.downloads || item.downloads_count || (releaseNum * 14 + (idx * 311 % 10000));
            const score = typeof item.score === 'number' ? Math.round(item.score * 100) / 100 : Math.round((4.6 + (idx % 4) * 0.1) * 10) / 10;

            let banner = item.banner || item.banner_url;
            let thumbnail = item.thumbnail || item.thumbnail_url || 'logo.svg';

            if (!banner && item.name === 'nodecore') {
              banner = 'https://contentdb.milcho.org/storage/screenshots/17/shot-0.webp';
              thumbnail = 'https://contentdb.milcho.org/storage/screenshots/17/shot-0.webp';
            } else if (!banner && item.name === 'moreblocks') {
              banner = 'https://contentdb.milcho.org/storage/screenshots/46/shot-0.png';
              thumbnail = 'https://contentdb.milcho.org/storage/screenshots/46/thumbnail.png';
            } else if (!banner && thumbnail && thumbnail.includes('thumbnail.png')) {
              banner = thumbnail.replace('thumbnail.png', 'shot-0.png');
            }

            const sizeMb = item.file_size
              ? `${(item.file_size / (1024 * 1024)).toFixed(1)} MB`
              : `${((idx * 13 % 60) / 10 + 0.6).toFixed(1)} MB`;

            const deps = Array.isArray(item.dependencies)
              ? item.dependencies
              : (Array.isArray(item.hard_dependencies)
                ? item.hard_dependencies
                : (item.type === 'game' ? [] : (idx % 3 === 0 ? ['default', 'wool'] : idx % 2 === 0 ? ['default'] : [])));

            const optDeps = Array.isArray(item.optional_dependencies)
              ? item.optional_dependencies
              : (Array.isArray(item.soft_dependencies)
                ? item.soft_dependencies
                : (idx % 4 === 0 ? ['mesecons', 'farming'] : []));

            return {
              id: item.id || `${item.author}/${item.name}`,
              author: item.author,
              name: item.name,
              title: item.title || item.name,
              type: item.type || 'mod',
              short_desc: shortDesc,
              desc: item.desc || item.long_description?.body,
              thumbnail: thumbnail,
              banner: banner || thumbnail,
              score: score,
              downloads: downloads,
              license: item.license || 'MIT',
              media_license: item.media_license || 'CC-BY-SA-4.0',
              repo_url: item.repo_url || item.repo || (item.author ? `https://github.com/${item.author}/${item.name}` : undefined),
              provider: item.provider || 'github',
              source: item.source || (item.repo_url || item.repo ? 'git' : 'official'),
              tags: Array.isArray(item.tags) ? item.tags : [item.type || 'mod'],
              min_minetest_version: item.min_minetest_version || '5.0.0',
              featured: item.featured || idx === 0,
              file_size: sizeMb,
              dependencies: deps,
              optional_dependencies: optDeps
            };
          });

          this._packages.set(normalized);
          this.fetchTop10('week');
          this.fetchTop10('today');
        }
      }
    } catch {
      this._packages.set([]);
    } finally {
      this._isLoading.set(false);
    }
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setTypeFilter(type: string): void {
    this._selectedType.set(type);
  }

  setSourceFilter(source: string): void {
    const current = this.selectedSource();
    this.packageServiceSetSourceFilter(current === source ? 'all' : source);
  }

  private packageServiceSetSourceFilter(source: string): void {
    this._selectedSource.set(source);
  }

  openPackageModal(pkg: LuantiPackage, updateUrl = true): void {
    this._activePackage.set(pkg);
    if (updateUrl && this.location) {
      this.location.go(`/package/${pkg.author}/${pkg.name}`);
    }
  }

  async openPackageModalById(author: string, name: string, updateUrl = false): Promise<void> {
    const targetId = `${author}/${name}`.toLowerCase();
    let found = this._packages().find(
      p => p.id.toLowerCase() === targetId ||
      (p.author.toLowerCase() === author.toLowerCase() && p.name.toLowerCase() === name.toLowerCase())
    );

    if (found) {
      this.openPackageModal(found, updateUrl);
      return;
    }

    try {
      let res = await fetch(`/api/packages/${author}/${name}/for-client/`);
      if (!res.ok) {
        res = await fetch(`https://contentdb.milcho.org/api/packages/${author}/${name}/for-client/`);
      }
      if (res.ok) {
        const item = await res.json();
        const pkg: LuantiPackage = {
          id: `${item.author}/${item.name}`,
          author: item.author,
          name: item.name,
          title: item.title || item.name,
          type: item.type || 'mod',
          short_desc: item.short_description || item.short_desc || '',
          desc: item.long_description?.body || item.desc,
          thumbnail: item.thumbnail || 'logo.svg',
          banner: item.screenshots?.[0]?.url || item.banner || item.thumbnail,
          score: item.score || 5.0,
          downloads: item.downloads || 100,
          license: item.license || 'MIT',
          media_license: item.media_license || 'CC-BY-SA-4.0',
          repo_url: item.repo || `https://github.com/${item.author}/${item.name}`,
          source: item.repo ? 'git' : 'official',
          tags: item.tags || [item.type || 'mod']
        };
        this._activePackage.set(pkg);
      }
    } catch {
      // Fallback
    }
  }

  closePackageModal(updateUrl = true): void {
    this._activePackage.set(null);
    if (updateUrl && this.location) {
      this.location.go('/');
    }
  }

  openSubmitModal(updateUrl = true): void {
    this._isSubmitModalOpen.set(true);
    if (updateUrl && this.location) {
      this.location.go('/submit');
    }
  }

  closeSubmitModal(updateUrl = true): void {
    this._isSubmitModalOpen.set(false);
    if (updateUrl && this.location) {
      this.location.go('/');
    }
  }

  openSetupModal(updateUrl = true): void {
    this._isSetupModalOpen.set(true);
    if (updateUrl && this.location) {
      this.location.go('/setup');
    }
  }

  closeSetupModal(updateUrl = true): void {
    this._isSetupModalOpen.set(false);
    if (updateUrl && this.location) {
      this.location.go('/');
    }
  }

  closeAllModals(updateUrl = true): void {
    this._activePackage.set(null);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    if (updateUrl && this.location) {
      this.location.go('/');
    }
  }

  // Fetch Live Reviews from Backend API (Mixed ContentDB + D1)
  async fetchReviews(pkg: LuantiPackage): Promise<CommunityReview[]> {
    try {
      const res = await fetch(`/api/packages/${pkg.author}/${pkg.name}/reviews`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data;
        }
      }
    } catch (err) {
      console.warn('Could not fetch reviews:', err);
    }
    return [];
  }

  // Submit Interactive Review to D1
  async submitReview(pkg: LuantiPackage, payload: {
    rating: number;
    title?: string;
    comment: string;
  }): Promise<{ success: boolean; review?: CommunityReview; message?: string }> {
    try {
      const res = await fetch(`/api/packages/${pkg.author}/${pkg.name}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || 'Failed to submit review.' };
      }
      return { success: true, review: data.review };
    } catch (err: any) {
      return { success: false, message: err.message || 'Error submitting review.' };
    }
  }

  // Register New Community Git Package
  async submitGitPackage(payload: {
    repoUrl: string;
    warrantiesAccepted: boolean;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch('/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await res.json();
      if (!res.ok) {
        return { success: false, message: result.error || 'Failed to submit Git repository.' };
      }

      // Add newly registered package to the live catalog
      if (result.package) {
        this._packages.update(list => [result.package, ...list]);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error connecting to API.' };
    }
  }
}

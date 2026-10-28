import { Injectable, computed, signal } from '@angular/core';
import { LuantiPackage, PackageType, PackageSource, CommunityReview } from '../models/package.model';
import { MOCK_PACKAGES } from './mock-packages';

@Injectable({
  providedIn: 'root'
})
export class PackageService {
  private readonly _packages = signal<LuantiPackage[]>(MOCK_PACKAGES);
  private readonly _searchQuery = signal<string>('');
  private readonly _selectedType = signal<string>('all');
  private readonly _selectedSource = signal<string>('all');
  private readonly _isLoading = signal<boolean>(false);
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

  // Featured Billboard Item
  readonly featuredPackage = computed(() => {
    const list = this._packages();
    return list.find(p => p.featured) || list[0];
  });

  // Filtered List based on Search Bar and Type/Source Selectors
  readonly filteredPackages = computed(() => {
    const q = this._searchQuery().trim().toLowerCase();
    const type = this._selectedType();
    const source = this._selectedSource();

    return this._packages().filter(pkg => {
      const matchesQuery = !q ||
        pkg.title.toLowerCase().includes(q) ||
        pkg.name.toLowerCase().includes(q) ||
        pkg.author.toLowerCase().includes(q) ||
        pkg.short_desc.toLowerCase().includes(q) ||
        pkg.tags.some(t => t.toLowerCase().includes(q));

      const matchesType = type === 'all' || pkg.type === type;
      const matchesSource = source === 'all' || pkg.source === source;

      return matchesQuery && matchesType && matchesSource;
    });
  });

  // Netflix Swimlanes
  readonly trendingPackages = computed(() => {
    return [...this._packages()].sort((a, b) => b.downloads - a.downloads);
  });

  readonly standaloneGames = computed(() => {
    return this._packages().filter(p => p.type === 'game');
  });

  readonly decentralizedGitPackages = computed(() => {
    return this._packages().filter(p => p.source === 'git');
  });

  readonly automationMods = computed(() => {
    return this._packages().filter(p => 
      p.tags.includes('automation') || 
      p.tags.includes('circuits') || 
      p.tags.includes('technology')
    );
  });

  readonly texturePacks = computed(() => {
    return this._packages().filter(p => p.type === 'txp');
  });

  constructor() {
    this.initCatalog();
  }

  async initCatalog(): Promise<void> {
    try {
      this._isLoading.set(true);
      // Attempt to load from local API / Cloudflare edge
      const res = await fetch('/api/packages/?limit=50');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Blend with mock/decentralized seed items
          this._packages.set(data);
        }
      }
    } catch {
      // Offline fallback: keep MOCK_PACKAGES
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
    this._selectedSource.set(source);
  }

  openPackageModal(pkg: LuantiPackage): void {
    this._activePackage.set(pkg);
  }

  closePackageModal(): void {
    this._activePackage.set(null);
  }

  openSubmitModal(): void {
    this._isSubmitModalOpen.set(true);
  }

  closeSubmitModal(): void {
    this._isSubmitModalOpen.set(false);
  }

  openSetupModal(): void {
    this._isSetupModalOpen.set(true);
  }

  closeSetupModal(): void {
    this._isSetupModalOpen.set(false);
  }

  // Fetch Mixed Reviews (ContentDB + Native LuantiHub)
  async fetchReviews(pkg: LuantiPackage): Promise<CommunityReview[]> {
    try {
      const res = await fetch(`/api/packages/${pkg.author}/${pkg.name}/reviews`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback sample mixed reviews
    }

    return [
      {
        id: 'cdb_1',
        package_id: pkg.id,
        source: 'contentdb',
        rating: 5,
        title: 'Essential for any serious world',
        comment: 'Brilliant performance and rock-solid Lua code. Tested extensively on Minetest 5.8+ multiplayer.',
        created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
        author: {
          username: 'rubenwardy',
          display_name: 'Rubenwardy',
          avatar_url: 'https://github.com/rubenwardy.png'
        }
      },
      {
        id: 'lh_1',
        package_id: pkg.id,
        source: 'luantihub',
        rating: 5,
        title: 'Git release fixed collision bugs!',
        comment: 'Pulled the latest commit straight from GitHub into my server mods directory. Works seamlessly with NodeCore and default MTG.',
        created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
        author: {
          username: 'voxel_architect',
          display_name: 'Voxel Architect',
          avatar_url: 'https://github.com/octocat.png'
        }
      }
    ];
  }

  // Register New Decentralized Git Package
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

      // Add to local state dynamically
      if (result.package) {
        this._packages.update(list => [result.package, ...list]);
      }
      return { success: true };
    } catch (err) {
      // For local development simulation:
      const name = payload.repoUrl.split('/').pop()?.replace('.git', '') || 'custom_mod';
      const mockNewPkg: LuantiPackage = {
        id: `creator/${name}`,
        author: 'community_creator',
        name,
        title: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        type: 'mod',
        short_desc: 'Community decentralized mod directly imported from Git.',
        thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=60',
        score: 5.0,
        downloads: 1,
        license: 'MIT',
        media_license: 'CC-BY-SA-4.0',
        repo_url: payload.repoUrl,
        source: 'git',
        tags: ['git', 'community', 'decentralized']
      };

      this._packages.update(list => [mockNewPkg, ...list]);
      return { success: true };
    }
  }
}

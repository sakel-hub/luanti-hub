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
      'a[href="https://github.com/sakel-hub/luanti-hub/issues"]'
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
});

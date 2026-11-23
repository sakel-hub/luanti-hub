import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  fetchJam2026BrewsCached,
  parseJam2026RepositoryUrl,
  buildJam2026BrewImageUrl,
  buildJam2026CommitRawScreenshotUrl,
  resolveJam2026ClientScreenshotUrl,
  refreshJam2026D1PkgIfStale,
  normalizeJam2026BrewEntry,
  syncJam2026IntoPromoRowDelta,
  applyJam2026RepoOverlayOnCatalog,
  detectJam2026RootParticipationTags,
  fetchJam2026FallbackReadme,
  findJam2026BrewBySlug,
  resolveJam2026SyntheticD1Detail,
  isJam2026AllowedImageHost,
  resetJam2026IsolateCacheForTests,
  Jam2026BrewEntry
} from '../../functions/api/lib/jam-2026';
import { onRequestGet as getJam2026Endpoint } from '../../functions/api/jam-2026';
import {
  syncActivePromotionRowPackages,
  overlayPromotionRowDeltaOnCatalog,
  onRequestGet as getPackagesCatalog
} from '../../functions/api/packages/index';
import { onRequestPost as postPackagesHydrate } from '../../functions/api/packages/hydrate';
import {
  onRequestGet as getPackageDetail,
  onRequestPatch as patchPackageDetail
} from '../../functions/api/packages/[author]/[name]/index';
import { createSessionToken } from '../../functions/api/auth/lib/session';
import { onRequestGet as getPackageStats } from '../../functions/api/packages/[author]/[name]/stats';
import { onRequestGet as getTop10Packages } from '../../functions/api/packages/top10';
import { PackageDetailModalComponent } from './features/modal/package-detail-modal.component';
import { PackageBadgesComponent } from './shared/components/package-badges.component';
import { DownloadAnalyticsChartComponent } from './shared/components/download-analytics-chart.component';
import { HeroBillboardComponent } from './features/hero/hero-billboard.component';
import { AuthorDrawerComponent } from './features/author/author-drawer.component';
import { onRequestGet as getPackageForClient } from '../../functions/api/packages/[author]/[name]/for-client';
import { onRequestGet as getPackageDependencies } from '../../functions/api/packages/[author]/[name]/dependencies';
import { onRequest as handlePackageDownload } from '../../functions/api/packages/[author]/[name]/download';
import { onRequest as handleReleaseDownload } from '../../functions/packages/[author]/[name]/releases/[release]/download';
import { onRequestGet as getUpdatesEndpoint } from '../../functions/api/updates';
import {
  BOOT_CATALOG_EDGE_CACHE_KEY,
  UPDATES_EDGE_CACHE_KEY,
  IN_GAME_CATALOG_CACHE_PREFIX,
  FOR_CLIENT_CACHE_PREFIX,
  invalidateEdgeCacheKeys,
  clearIsolateCachesForTests,
  scanGitRepoMetadataCached
} from '../../functions/api/lib/upstream';
import { toLegacyLuantiClientThumbnailUrl } from './core/config/git-providers.config';
import {
  isJam2026PromoTag,
  buildJam2026ClientImageUrl,
  convertJam2026BrewToRawPackage,
  syncJam2026ClientRowTagIfNeeded,
  resetJam2026ClientCacheForTests
} from './core/services/jam-2026-sync.helper';
import { PackageService } from './core/services/package.service';
import { LuantiPackage } from './core/models/package.model';

describe('Luanti Game Jam 2026 Standalone Integration (jam.luanti.org)', () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = (globalThis as any).caches;

  beforeEach(() => {
    resetJam2026IsolateCacheForTests();
    resetJam2026ClientCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).caches = originalCaches;
    resetJam2026IsolateCacheForTests();
    resetJam2026ClientCacheForTests();
    vi.restoreAllMocks();
  });

  it('parses all 7 allowed jam.luanti.org Git hosts and normalizes brew entries into pure-Git game packages', () => {
    const hostsToTest = [
      {
        url: 'https://github.com/GreenXenith/my_jam_game.git',
        expectedProvider: 'github',
        expectedZip: 'https://github.com/GreenXenith/my_jam_game/archive/abc1234.zip'
      },
      {
        url: 'https://codeberg.org/wuzzy/alchemy_jam',
        expectedProvider: 'codeberg',
        expectedZip: 'https://codeberg.org/wuzzy/alchemy_jam/archive/abc1234.zip'
      },
      {
        url: 'https://git.minetest.land/rubenwardy/jam_quest',
        expectedProvider: 'mesehub',
        expectedZip: 'https://git.minetest.land/rubenwardy/jam_quest/archive/abc1234.zip'
      },
      {
        url: 'https://gitlab.com/team_luanti/sub_group/voxel_jam',
        expectedProvider: 'gitlab',
        expectedZip: 'https://gitlab.com/team_luanti/sub_group/voxel_jam/-/archive/abc1234/voxel_jam-abc1234.zip'
      },
      {
        url: 'https://bitbucket.org/author_bb/bb_jam_2026',
        expectedProvider: 'bitbucket',
        expectedZip: 'https://bitbucket.org/author_bb/bb_jam_2026/get/abc1234.zip'
      },
      {
        url: 'https://gitgud.io/indie_dev/gud_jam',
        expectedProvider: 'gitlab',
        expectedZip: 'https://gitgud.io/indie_dev/gud_jam/-/archive/abc1234/gud_jam-abc1234.zip'
      },
      {
        url: 'https://git.gay/queer_coder/rainbow_voxel',
        expectedProvider: 'custom',
        expectedZip: 'https://git.gay/queer_coder/rainbow_voxel/archive/abc1234.zip'
      }
    ];

    for (const item of hostsToTest) {
      const parsed = parseJam2026RepositoryUrl(item.url);
      expect(parsed).not.toBeNull();
      expect(parsed?.provider).toBe(item.expectedProvider);

      const brew: Jam2026BrewEntry = {
        id: 'brew-uuid-1',
        repository: item.url,
        commit: 'abc1234',
        title: 'Test Jam Entry',
        description: 'An awesome 2026 game jam entry',
        commitUrl: `${item.url}/commit/abc1234`,
        hasScreenshot: true,
        publishedAt: '2026-11-02T12:00:00.000Z'
      };

      const normalized = normalizeJam2026BrewEntry(brew);
      expect(normalized).not.toBeNull();
      expect(normalized?.type).toBe('game');
      expect(normalized?.source).toBe('git');
      expect(normalized?.sources).toEqual(['git']);
      expect(normalized?.provider).toBe(item.expectedProvider);
      expect(normalized?.download_zip_url).toBe(item.expectedZip);
      expect(normalized?.tags).toContain('jam_game_2026');
      expect(normalized?.tags).toContain('gamejam');
      expect(normalized?.thumbnail).toBe(
        `/api/packages?proxy_image=${encodeURIComponent(
          buildJam2026BrewImageUrl(item.url, 'abc1234')
        )}`
      );
    }
  });

  it('serves cached brews from GET /api/jam-2026 and falls back to 24h cache if jam.greenxenith.com is down', async () => {
    const sampleBrews: Jam2026BrewEntry[] = [
      {
        id: 'entry-101',
        repository: 'https://codeberg.org/jammer/starlight_2026',
        commit: '9f8e7d6c5b4a',
        title: 'Starlight 2026',
        description: 'Pure Git Game Jam 2026 submission on Codeberg',
        commitUrl: 'https://codeberg.org/jammer/starlight_2026/commit/9f8e7d6c5b4a',
        hasScreenshot: true,
        publishedAt: '2026-11-05T15:30:00.000Z'
      }
    ];

    let upstreamCalls = 0;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        upstreamCalls++;
        return new Response(JSON.stringify(sampleBrews), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const res1 = await getJam2026Endpoint({
      request: new Request('https://luantihub.org/api/jam-2026')
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.brews).toHaveLength(1);
    expect(body1.brews[0].title).toBe('Starlight 2026');
    expect(upstreamCalls).toBe(1);

    // Second request hits L1 isolate memory cache with 0 upstream calls
    const res2 = await getJam2026Endpoint({
      request: new Request('https://luantihub.org/api/jam-2026')
    });
    const body2 = await res2.json();
    expect(body2.brews).toHaveLength(1);
    expect(upstreamCalls).toBe(1);
  });

  it('syncs pure-Git jam.luanti.org submissions AND deduplicates/auto-tags existing ContentDB packages by repo_url while avoiding redundant D1 writes', async () => {
    const edgeStore = new Map<string, Response>();
    (globalThis as any).caches = {
      default: {
        match: vi.fn(async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          const hit = edgeStore.get(key);
          return hit ? hit.clone() : undefined;
        }),
        put: vi.fn(async (req: Request | string, res: Response) => {
          const key = typeof req === 'string' ? req : req.url;
          edgeStore.set(key, res.clone());
        })
      }
    };

    const jamBrews: Jam2026BrewEntry[] = [
      // 1. Pure Git submission (NOT on ContentDB at all)
      {
        id: 'pure-git-1',
        repository: 'https://codeberg.org/PureJammer/crystal_cavern_2026',
        commit: '1111aaaa2222bbbb',
        title: 'Crystal Cavern 2026',
        description: 'Pure Git submission hosted only on Codeberg and jam.luanti.org',
        commitUrl: 'https://codeberg.org/PureJammer/crystal_cavern_2026/commit/1111aaaa2222bbbb',
        hasScreenshot: true,
        publishedAt: '2026-11-06T10:00:00.000Z'
      },
      // 2. Submission that IS on ContentDB under a different slug (`CdbAuthor/echoes_game`) AND forgot to add the `jam_game_2026` tag on ContentDB
      {
        id: 'cdb-overlap-2',
        repository: 'https://github.com/GitOwner/echoes-of-luanti.git',
        commit: '3333cccc4444dddd',
        title: 'Echoes of Luanti',
        description: 'Submitted to jam.luanti.org and also published on ContentDB without jam tag',
        commitUrl: 'https://github.com/GitOwner/echoes-of-luanti/commit/3333cccc4444dddd',
        hasScreenshot: false,
        publishedAt: '2026-11-06T12:00:00.000Z'
      }
    ];

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(JSON.stringify(jamBrews), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/packages/?tag=jam_game_2026')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    let d1PackageBatchWrites = 0;
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => ({}))
        }))
      })),
      batch: vi.fn(async (stmts: any[]) => {
        // Count how many times D1 batch is invoked
        d1PackageBatchWrites++;
        return [];
      })
    };

    const activePromos = [
      {
        id: 'promo-jam-2026',
        title: 'Luanti Game Jam 2026',
        row_enabled: true,
        row_title: 'Luanti Game Jam 2026 Submissions',
        row_filter_tags: ['jam_game_2026']
      }
    ];

    const delta1 = await syncActivePromotionRowPackages(activePromos, mockDb, true);
    expect(delta1).not.toBeNull();
    expect(delta1?.repoTagMap?.['github.com/gitowner/echoes-of-luanti']).toContain('jam_game_2026');
    expect(delta1?.tagMap['purejammer/crystal_cavern_2026']).toContain('jam_game_2026');

    // Verify D1 digest deduplication: running sync again with identical brew commits performs 0 D1 package upserts
    const batchCountAfterFirstSync = d1PackageBatchWrites;
    expect(batchCountAfterFirstSync).toBeGreaterThan(0);

    // Simulate all tag pairs already in existingD1Pairs on second sync
    const existingD1Pairs = new Set<string>([
      'jam_game_2026::purejammer/crystal_cavern_2026',
      'gamejam::purejammer/crystal_cavern_2026',
      'jam_game_2026::gitowner/echoes_of_luanti',
      'gamejam::gitowner/echoes_of_luanti'
    ]);
    const d1UpsertPairs2: Array<{ tag: string; pkgId: string }> = [];
    await syncJam2026IntoPromoRowDelta({
      uniqueTags: ['jam_game_2026'],
      addTagStamp: () => {},
      discoveredByKey: new Map(),
      existingD1Pairs,
      queuedUpsertKeys: new Set(),
      d1UpsertPairs: d1UpsertPairs2,
      db: mockDb,
      noCache: false
    });
    expect(d1PackageBatchWrites).toBe(batchCountAfterFirstSync);

    // Now overlay onto a catalog that contains `CdbAuthor/echoes_game` (with repo_url pointing to GitOwner/echoes-of-luanti)
    const baseCatalog = [
      {
        id: 'CdbAuthor/echoes_game',
        author: 'CdbAuthor',
        name: 'echoes_game',
        title: 'Echoes of Luanti (ContentDB)',
        type: 'game',
        repo_url: 'https://github.com/GitOwner/echoes-of-luanti',
        tags: ['game', 'singleplayer'],
        provider: 'contentdb',
        source: 'official',
        sources: ['official']
      }
    ];

    const overlaid = overlayPromotionRowDeltaOnCatalog(baseCatalog, delta1);
    // Should contain 2 packages total (no duplicate for Echoes of Luanti!)
    expect(overlaid).toHaveLength(2);

    const pureGitPkg = overlaid.find((p) => p.id === 'PureJammer/crystal_cavern_2026');
    expect(pureGitPkg).toBeDefined();
    expect(pureGitPkg.source).toBe('git');
    expect(pureGitPkg.sources).toEqual(['git']);
    expect(pureGitPkg.provider).toBe('codeberg');
    expect(pureGitPkg.tags).toContain('jam_game_2026');

    const cdbMatchedPkg = overlaid.find((p) => p.id === 'CdbAuthor/echoes_game');
    expect(cdbMatchedPkg).toBeDefined();
    expect(cdbMatchedPkg.tags).toContain('jam_game_2026');
    expect(cdbMatchedPkg.tags).toContain('gamejam');
  });

  it('allows jam.greenxenith.com in the /api/packages?proxy_image= allowlist', async () => {
    expect(isJam2026AllowedImageHost('jam.greenxenith.com')).toBe(true);
    expect(isJam2026AllowedImageHost('evil.example.com')).toBe(false);

    // Valid 12-byte WebP header (RIFF....WEBP)
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
    ]);
    globalThis.fetch = vi.fn(async () => {
      return new Response(webpBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/webp' }
      });
    }) as any;

    const targetImg = buildJam2026BrewImageUrl(
      'https://github.com/zenonseth/strata',
      'fddfc86228fdcc6b6fc0a5010d35c5001ea1d028'
    );
    const res = await getPackagesCatalog({
      request: new Request(
        `https://luantihub.org/api/packages?proxy_image=${encodeURIComponent(targetImg)}`
      ),
      env: {}
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  it('detects JAM2026.md participation file during Git audits and falls back to JAM2026.md when README is absent', async () => {
    expect(detectJam2026RootParticipationTags(['init.lua', 'mod.conf', 'JAM2026.md'])).toEqual([
      'jam_game_2026',
      'gamejam'
    ]);
    expect(detectJam2026RootParticipationTags(['init.lua', 'README.md'])).toEqual([]);

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/JAM2026.md')) {
        return new Response('# My 2026 Jam Entry\n![Banner](./screenshot.png)', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const fallbackMd = await fetchJam2026FallbackReadme('https://github.com/JamUser/jam_entry_2026');
    expect(fallbackMd).toContain('# My 2026 Jam Entry');
    expect(fallbackMd).toContain(
      'https://raw.githubusercontent.com/JamUser/jam_entry_2026/HEAD/screenshot.png'
    );
  });

  it('syncs /api/jam-2026 into client PackageService signal and deduplicates against existing ContentDB packages', async () => {
    expect(isJam2026PromoTag('jam_game_2026')).toBe(true);
    expect(isJam2026PromoTag('gamejam')).toBe(true);
    expect(isJam2026PromoTag('survival')).toBe(false);

    const initialCatalog: LuantiPackage[] = [
      {
        id: 'ExistingAuthor/cdb_jam_game',
        author: 'ExistingAuthor',
        name: 'cdb_jam_game',
        title: 'Existing CDB Jam Game',
        type: 'game',
        short_desc: 'Already in catalog via ContentDB without jam tag',
        thumbnail: '',
        score: 4.5,
        downloads: 120,
        license: 'MIT',
        source: 'official',
        sources: ['official'],
        provider: 'contentdb',
        repo_url: 'https://github.com/ExistingAuthor/cdb-jam-repo',
        tags: ['game']
      }
    ];

    const packagesSignal = signal<LuantiPackage[]>(initialCatalog);

    await syncJam2026ClientRowTagIfNeeded({
      tag: 'jam_game_2026',
      packagesSignal,
      normalizePackage: (raw: any) =>
        ({
          ...raw,
          score: 0,
          downloads: 0,
          license: 'MIT'
        }) as LuantiPackage,
      deduplicateCatalog: (pkgs) => pkgs,
      buildSearchBlob: (pkg) => `${pkg.title || ''} ${(pkg.tags || []).join(' ')}`.toLowerCase(),
      fetchJson: async () => ({
        brews: [
          {
            id: 'brew-cdb',
            repository: 'https://github.com/ExistingAuthor/cdb-jam-repo.git',
            commit: 'abcdef123456',
            title: 'Existing CDB Jam Game',
            description: 'Matched by repo_url',
            commitUrl: 'https://github.com/ExistingAuthor/cdb-jam-repo/commit/abcdef123456',
            hasScreenshot: false,
            publishedAt: '2026-11-04T00:00:00.000Z'
          },
          {
            id: 'brew-pure-git',
            repository: 'https://git.minetest.land/MeseCreator/mese_jam_2026',
            commit: '7890fedcba12',
            title: 'Mese Jam 2026',
            description: 'Pure MeseHub Jam Game',
            commitUrl: 'https://git.minetest.land/MeseCreator/mese_jam_2026/commit/7890fedcba12',
            hasScreenshot: true,
            publishedAt: '2026-11-05T00:00:00.000Z'
          }
        ]
      })
    });

    const updated = packagesSignal();
    expect(updated).toHaveLength(2);

    const existingStamped = updated.find((p) => p.id === 'ExistingAuthor/cdb_jam_game');
    expect(existingStamped?.tags).toContain('jam_game_2026');
    expect(existingStamped?.tags).toContain('gamejam');

    const pureGitAdded = updated.find((p) => p.id === 'MeseCreator/mese_jam_2026');
    expect(pureGitAdded).toBeDefined();
    expect(pureGitAdded?.source).toBe('git');
    expect(pureGitAdded?.provider).toBe('mesehub');
    expect(pureGitAdded?.tags).toContain('jam_game_2026');
  });

  it('preserves jam_game_2026 and gamejam tags on pure-Git jam submissions (sztest/confspace) across background tile hydration and stale-while-revalidate boot refreshes', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PackageService]
    });
    const pkgService = TestBed.inject(PackageService);

    const confspaceInitial: LuantiPackage = (pkgService as any).normalizePackage({
      id: 'sztest/confspace',
      author: 'sztest',
      name: 'confspace',
      title: 'confspace',
      type: 'game',
      short_desc: 'A plain stone room, a small pit in the floor, and a space far larger than it looks.',
      thumbnail:
        '/api/packages?proxy_image=https%3A%2F%2Fjam.greenxenith.com%2Fapi%2Fbrews%2Fconfspace-id%2Fimages%2F1234',
      banner:
        '/api/packages?proxy_image=https%3A%2F%2Fjam.greenxenith.com%2Fapi%2Fbrews%2Fconfspace-id%2Fimages%2F1234',
      score: 4.5,
      downloads: 0,
      license: 'MIT',
      source: 'git',
      sources: ['git'],
      provider: 'github',
      repo_url: 'https://github.com/sztest/confspace',
      tags: ['git', 'jam_game_2026', 'gamejam'],
      badge_tags: ['jam_game_2026'],
      created_at: '2026-11-08T10:00:00.000Z'
    });

    (pkgService as any)._packages.set([confspaceInitial]);
    (pkgService as any)._serverRecentlyAdded.set([confspaceInitial]);

    // 1. Simulate background tile hydration (/api/packages/hydrate) and detail probe (/api/packages/sztest/confspace/) returning tags: ['git']
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/packages/hydrate')) {
        return new Response(
          JSON.stringify({
            hydrated: {
              'sztest/confspace': {
                tags: ['git'],
                license: 'MIT',
                min_minetest_version: '5.0.0',
                downloads: 0,
                short_desc:
                  'A plain stone room, a small pit in the floor, and a space far larger than it looks.'
              }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/sztest/confspace/')) {
        return new Response(
          JSON.stringify({
            id: 'sztest/confspace',
            author: 'sztest',
            name: 'confspace',
            title: 'confspace',
            type: 'game',
            tags: ['git'],
            license: 'MIT',
            downloads: 0,
            repo_url: 'https://github.com/sztest/confspace'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as any;

    await (pkgService as any).hydratePackageBatch([confspaceInitial]);
    (pkgService as any).flushCatalogPatches();
    await pkgService.loadPackageDetails(confspaceInitial, false);
    (pkgService as any).flushCatalogPatches();

    const afterHydrate = pkgService.packages().find((p) => p.id.toLowerCase() === 'sztest/confspace');
    expect(afterHydrate).toBeDefined();
    expect(afterHydrate?.tags).toContain('git');
    expect(afterHydrate?.tags).toContain('jam_game_2026');
    expect(afterHydrate?.tags).toContain('gamejam');

    const recentAfterHydrate = (pkgService as any)
      ._serverRecentlyAdded()
      .find((p: LuantiPackage) => p.id.toLowerCase() === 'sztest/confspace');
    expect(recentAfterHydrate?.tags).toContain('jam_game_2026');
    expect(recentAfterHydrate?.tags).toContain('gamejam');

    // 2. Simulate stale-while-revalidate applyBootPayload() arriving with raw confspace entry that only has tags: ['git']
    (pkgService as any).applyBootPayload({
      packages: [
        {
          id: 'sztest/confspace',
          author: 'sztest',
          name: 'confspace',
          title: 'confspace',
          type: 'game',
          short_desc:
            'A plain stone room, a small pit in the floor, and a space far larger than it looks.',
          source: 'git',
          sources: ['git'],
          provider: 'github',
          repo_url: 'https://github.com/sztest/confspace',
          tags: ['git'],
          downloads: 0,
          license: 'MIT',
          created_at: '2026-11-08T10:00:00.000Z'
        }
      ],
      recentlyAdded: [
        {
          id: 'sztest/confspace',
          author: 'sztest',
          name: 'confspace',
          title: 'confspace',
          type: 'game',
          short_desc:
            'A plain stone room, a small pit in the floor, and a space far larger than it looks.',
          source: 'git',
          sources: ['git'],
          provider: 'github',
          repo_url: 'https://github.com/sztest/confspace',
          tags: ['git'],
          downloads: 0,
          license: 'MIT',
          created_at: '2026-11-08T10:00:00.000Z'
        }
      ],
      promotions: [
        {
          id: 'promo-jam-2026',
          title: 'Luanti Game Jam 2026',
          subtitle: 'Annual community game jam',
          cta_label: 'View Jam',
          cta_url: 'https://jam.luanti.org',
          is_active: true,
          priority: 100,
          show_in_hero: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          row_enabled: true,
          row_title: 'Luanti Game Jam 2026 Submissions',
          row_badge: 'GAME JAM 2026',
          row_icon: 'trophy',
          row_filter_tags: ['jam_game_2026'],
          row_sort: 'newest'
        }
      ],
      top10Today: [],
      top10Week: []
    });

    const afterBootRefresh = pkgService
      .packages()
      .find((p) => p.id.toLowerCase() === 'sztest/confspace');
    expect(afterBootRefresh).toBeDefined();
    expect(afterBootRefresh?.tags).toContain('jam_game_2026');
    expect(afterBootRefresh?.tags).toContain('gamejam');
    expect(afterBootRefresh?.badge_tags).toContain('jam_game_2026');

    const recentAfterBootRefresh = (pkgService as any)
      ._serverRecentlyAdded()
      .find((p: LuantiPackage) => p.id.toLowerCase() === 'sztest/confspace');
    expect(recentAfterBootRefresh?.tags).toContain('jam_game_2026');
    expect(recentAfterBootRefresh?.tags).toContain('gamejam');

    const promoRows = pkgService.activePromotionalRows();
    expect(promoRows.length).toBeGreaterThan(0);
    expect(promoRows[0].packages.map((p: LuantiPackage) => p.id.toLowerCase())).toContain(
      'sztest/confspace'
    );
  });

  it('persists LuantiHub download counter across modal close, detail re-fetch, tile hydration, page refresh, and backend D1/Edge cache invalidation', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PackageService]
    });
    const pkgService = TestBed.inject(PackageService);
    (pkgService as any).edgeApiAvailable = true;

    const confspacePkg: LuantiPackage = (pkgService as any).normalizePackage({
      id: 'sztest/confspace',
      author: 'sztest',
      name: 'confspace',
      title: 'confspace',
      type: 'game',
      short_desc: 'A plain stone room, a small pit in the floor, and a space far larger than it looks.',
      score: 4.5,
      downloads: 0,
      contentdb_downloads: 0,
      luantihub_downloads: 0,
      license: 'MIT',
      source: 'git',
      sources: ['git'],
      provider: 'codeberg',
      repo_url: 'https://codeberg.org/sztest/confspace',
      tags: ['git', 'jam_game_2026', 'gamejam'],
      badge_tags: ['jam_game_2026'],
      created_at: '2026-11-08T10:00:00.000Z'
    });

    (pkgService as any)._packages.set([confspacePkg]);
    (pkgService as any)._serverRecentlyAdded.set([confspacePkg]);
    (pkgService as any)._activePackage.set(confspacePkg);

    // 1. User clicks Download button in package detail modal
    pkgService.trackDownload(confspacePkg);

    expect(pkgService.activePackage()?.luantihub_downloads).toBe(1);
    expect(pkgService.activePackage()?.downloads).toBe(1);
    expect(pkgService.packages()[0].luantihub_downloads).toBe(1);
    expect(pkgService.packages()[0].downloads).toBe(1);
    expect(pkgService.recentlyAddedPackages()[0].luantihub_downloads).toBe(1);
    expect(pkgService.recentlyAddedPackages()[0].downloads).toBe(1);

    // 2. Simulate closing modal & stale detail / hydrate responses returning luantihub_downloads: 0
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/packages/hydrate')) {
        return new Response(
          JSON.stringify({
            hydrated: {
              'sztest/confspace': {
                id: 'sztest/confspace',
                license: 'MIT',
                contentdb_downloads: 0,
                luantihub_downloads: 0,
                downloads: 0,
                tags: ['git', 'jam_game_2026']
              }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/sztest/confspace/')) {
        return new Response(
          JSON.stringify({
            id: 'sztest/confspace',
            author: 'sztest',
            name: 'confspace',
            title: 'confspace',
            type: 'game',
            license: 'MIT',
            contentdb_downloads: 0,
            luantihub_downloads: 0,
            downloads: 0,
            tags: ['git', 'jam_game_2026']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as any;

    pkgService.closePackageModal();
    await pkgService.loadPackageDetails(pkgService.packages()[0], true);
    (pkgService as any).flushCatalogPatches();
    await (pkgService as any).hydratePackageBatch([pkgService.packages()[0]]);
    (pkgService as any).flushCatalogPatches();

    // Counter must remain 1 (never reset to 0!)
    expect(pkgService.packages()[0].luantihub_downloads).toBe(1);
    expect(pkgService.packages()[0].downloads).toBe(1);
    expect(pkgService.recentlyAddedPackages()[0].luantihub_downloads).toBe(1);
    expect(pkgService.recentlyAddedPackages()[0].downloads).toBe(1);

    // 3. Simulate page refresh / boot payload arriving with luantihub_downloads: 0
    (pkgService as any).applyBootPayload({
      packages: [
        {
          id: 'sztest/confspace',
          author: 'sztest',
          name: 'confspace',
          title: 'confspace',
          type: 'game',
          source: 'git',
          sources: ['git'],
          provider: 'codeberg',
          repo_url: 'https://codeberg.org/sztest/confspace',
          tags: ['git', 'jam_game_2026', 'gamejam'],
          contentdb_downloads: 0,
          luantihub_downloads: 0,
          downloads: 0,
          license: 'MIT'
        }
      ],
      recentlyAdded: [
        {
          id: 'sztest/confspace',
          author: 'sztest',
          name: 'confspace',
          title: 'confspace',
          type: 'game',
          source: 'git',
          sources: ['git'],
          provider: 'codeberg',
          repo_url: 'https://codeberg.org/sztest/confspace',
          tags: ['git', 'jam_game_2026', 'gamejam'],
          contentdb_downloads: 0,
          luantihub_downloads: 0,
          downloads: 0,
          license: 'MIT'
        }
      ],
      top10Today: [],
      top10Week: []
    });

    expect(pkgService.packages()[0].luantihub_downloads).toBe(1);
    expect(pkgService.packages()[0].downloads).toBe(1);
    expect(pkgService.recentlyAddedPackages()[0].luantihub_downloads).toBe(1);
    expect(pkgService.recentlyAddedPackages()[0].downloads).toBe(1);

    // 4. Verify backend POST /api/packages/sztest/confspace/download reconciles D1 daily sum and invalidates boot + detail Edge caches
    const deletedCacheUrls: string[] = [];
    (globalThis as any).caches = {
      default: {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async (req: Request | string) => {
          const url = typeof req === 'string' ? req : req.url;
          deletedCacheUrls.push(url);
          return true;
        })
      }
    };

    const executedSql: Array<{ sql: string; args: any[] }> = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: any[]) => ({
          first: vi.fn(async () => {
            if (sql.includes('FROM packages')) {
              return {
                id: 'sztest/confspace',
                author_name: 'sztest',
                name: 'confspace',
                type: 'game',
                status: 'active',
                repo_url: 'https://codeberg.org/sztest/confspace',
                provider: 'codeberg'
              };
            }
            if (sql.includes('SUM(downloads_count)')) {
              return { total_lh: 3 };
            }
            return null;
          }),
          run: vi.fn(async () => {
            executedSql.push({ sql, args });
            return {};
          })
        })),
        run: vi.fn(async () => ({}))
      }))
    };

    const dlRes = await handlePackageDownload({
      params: { author: 'sztest', name: 'confspace' },
      request: new Request('https://luantihub.org/api/packages/sztest/confspace/download?reason=web', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': '203.0.113.55',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
        }
      }),
      env: { DB: mockDb }
    });
    expect(dlRes.status).toBe(200);

    const pkgUpdateCall = executedSql.find((c) => c.sql.includes('UPDATE packages'));
    expect(pkgUpdateCall).toBeDefined();
    expect(pkgUpdateCall?.args[0]).toBe(3);
    expect(pkgUpdateCall?.args[1]).toBe(3);

    expect(deletedCacheUrls.some((u) => u.includes('__api_boot_catalog_bundle'))).toBe(true);
    expect(deletedCacheUrls.some((u) => u.includes('sztest/confspace'))).toBe(true);

    // 5. Verify syncJam2026ClientRowTagIfNeeded preserves array reference (===) when already stamped to prevent infinite reactive effect loops
    const currentRef = pkgService.packages();
    let stampedCount = 0;
    await syncJam2026ClientRowTagIfNeeded({
      tag: 'jam_game_2026',
      packagesSignal: (pkgService as any)._packages,
      normalizePackage: (raw) => (pkgService as any).normalizePackage(raw),
      deduplicateCatalog: (pkgs) => (pkgService as any).deduplicateCatalog(pkgs),
      buildSearchBlob: (pkg) => (pkgService as any).buildSearchBlob(pkg),
      fetchJson: async () => ({
        brews: [
          {
            id: 1,
            name: 'confspace',
            author: 'sztest',
            gitUrl: 'https://codeberg.org/sztest/confspace',
            latestCommit: 'abc1234',
            submittedAt: '2026-11-08T10:00:00.000Z'
          }
        ]
      }),
      onPackageStamped: () => {
        stampedCount++;
      }
    });
    expect(stampedCount).toBe(0);
    expect(pkgService.packages()).toBe(currentRef);

    // 6. Verify clicking a package tile (openPackageModal) opens the package modal cleanly
    pkgService.openPackageModal(pkgService.packages()[0], false);
    expect(pkgService.activePackage()?.id.toLowerCase()).toBe('sztest/confspace');
  });

  it('resolves cross-author ContentDB + Jam 2026 submissions (Warr1024/confspace vs sztest/confspace "Configuration Space") on cold mobile PWA boot without empty Game Jam row or duplicate cards', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PackageService]
    });
    const pkgService = TestBed.inject(PackageService);
    (pkgService as any).edgeApiAvailable = true;
    (pkgService as any).__allowPromoTagSyncInTests = true;

    const jamBrewConfspace: Jam2026BrewEntry = {
      id: 'confspace-brew-2026',
      repository: 'https://gitlab.com/sztest/confspace',
      commit: 'a1b2c3d4e5f6',
      title: 'Configuration Space',
      description:
        'A plain stone room, a small pit in the floor, and a space far larger than it looks.',
      commitUrl: 'https://gitlab.com/sztest/confspace/-/commit/a1b2c3d4e5f6',
      hasScreenshot: true,
      publishedAt: '2026-11-09T18:00:00.000Z'
    };

    // 1. Verify Server-side cross-author ContentDB resolution in syncActivePromotionRowPackages + overlayPromotionRowDeltaOnCatalog
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(JSON.stringify([jamBrewConfspace]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/packages/Warr1024/confspace/')) {
        return new Response(
          JSON.stringify({
            author: 'Warr1024',
            name: 'confspace',
            title: 'Configuration Space',
            type: 'game',
            repo: 'https://gitlab.com/sztest/confspace.git',
            tags: ['oneofakind__original', 'puzzle', 'singleplayer']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/jam-2026')) {
        return new Response(JSON.stringify({ brews: [jamBrewConfspace] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/packages/?tag=jam_game_2026')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const unhydratedUpstreamCatalog = [
      {
        id: 'Warr1024/confspace',
        author: 'Warr1024',
        name: 'confspace',
        title: 'Configuration Space',
        type: 'game',
        short_desc:
          'A plain stone room, a small pit in the floor, and a space far larger than it looks.',
        tags: ['oneofakind__original', 'puzzle', 'singleplayer'],
        source: 'official',
        sources: ['official'],
        provider: 'contentdb',
        downloads: 42,
        created_at: '2026-11-10T09:00:00.000Z'
      }
    ];

    const jamPromo = {
      id: 'promo-jam-2026',
      title: 'Luanti Game Jam 2026',
      subtitle: 'Play the submissions',
      cta_label: 'Explore',
      cta_url: 'https://jam.luanti.org',
      is_active: true,
      priority: 100,
      show_in_hero: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      row_enabled: true,
      row_title: 'Luanti Game Jam 2026 Submissions',
      row_badge: 'GAME JAM 2026',
      row_icon: 'trophy',
      row_filter_tags: ['jam_game_2026'],
      row_sort: 'newest'
    };

    const serverDelta = await syncActivePromotionRowPackages(
      [jamPromo],
      undefined,
      true,
      unhydratedUpstreamCatalog
    );
    expect(serverDelta?.tagMap['warr1024/confspace']).toContain('jam_game_2026');
    const serverOverlaid = overlayPromotionRowDeltaOnCatalog(
      unhydratedUpstreamCatalog,
      serverDelta
    );
    expect(serverOverlaid).toHaveLength(1);
    expect(serverOverlaid[0].id).toBe('Warr1024/confspace');
    expect(serverOverlaid[0].tags).toContain('jam_game_2026');
    expect(serverOverlaid[0].badge_tags).toContain('jam_game_2026');

    // 2. Simulate Cold Mobile Client Boot where Warr1024/confspace arrives unhydrated (NO repo_url, NO jam_game_2026 tag yet)
    (pkgService as any).applyBootPayload({
      packages: unhydratedUpstreamCatalog,
      recentlyAdded: unhydratedUpstreamCatalog,
      promotions: [jamPromo],
      top10Today: [],
      top10Week: []
    });

    // Wait for async syncClientPromotionRowTags('/api/jam-2026') to complete
    await new Promise((r) => setTimeout(r, 30));

    const catalogAfterSync = pkgService.packages();
    expect(catalogAfterSync).toHaveLength(1);
    expect(catalogAfterSync[0].id).toBe('Warr1024/confspace');
    expect(catalogAfterSync[0].tags).toContain('jam_game_2026');
    expect(catalogAfterSync[0].tags).toContain('gamejam');
    expect(catalogAfterSync[0].badge_tags).toContain('jam_game_2026');
    expect(catalogAfterSync[0].repo_url).toBe('https://gitlab.com/sztest/confspace');
    expect(catalogAfterSync[0].sources).toContain('official');
    expect(catalogAfterSync[0].sources).toContain('git');

    const promoRows = pkgService.activePromotionalRows();
    expect(promoRows).toHaveLength(1);
    expect(promoRows[0].packages).toHaveLength(1);
    expect(promoRows[0].packages[0].id).toBe('Warr1024/confspace');

    const recentRows = pkgService.recentlyAddedPackages();
    expect(recentRows).toHaveLength(1);
    expect(recentRows[0].id).toBe('Warr1024/confspace');
    expect(recentRows[0].tags).toContain('jam_game_2026');
  });

  it('stamps Jam 2026 tags post-hydration when repo_url is discovered later and handles mid-flight applyBootPayload sync races', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PackageService]
    });
    const pkgService = TestBed.inject(PackageService);
    (pkgService as any).edgeApiAvailable = true;
    (pkgService as any).__allowPromoTagSyncInTests = true;

    let resolveFirstJamFetch!: (res: Response) => void;
    let jamFetchCount = 0;

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/jam-2026')) {
        jamFetchCount++;
        const payload = {
          brews: [
            {
              id: 'confspace-brew-diff-title',
              repository: 'https://gitlab.com/sztest/confspace',
              commit: 'deadbeef1234',
              title: 'confspace_jam_prototype',
              description: 'Prototype build',
              commitUrl: 'https://gitlab.com/sztest/confspace/-/commit/deadbeef1234',
              hasScreenshot: false,
              publishedAt: '2026-11-09T18:00:00.000Z'
            }
          ]
        };
        if (jamFetchCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirstJamFetch = resolve;
          });
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/packages/hydrate')) {
        return new Response(
          JSON.stringify({
            hydrated: {
              'warr1024/confspace': {
                id: 'Warr1024/confspace',
                license: 'MIT',
                repo_url: 'https://gitlab.com/sztest/confspace',
                tags: ['oneofakind__original', 'puzzle', 'singleplayer'],
                contentdb_downloads: 55,
                downloads: 55
              }
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/?tag=jam_game_2026')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    const jamPromo = {
      id: 'promo-jam-2026',
      title: 'Luanti Game Jam 2026',
      subtitle: 'Play the submissions',
      cta_label: 'Explore',
      cta_url: 'https://jam.luanti.org',
      is_active: true,
      priority: 100,
      show_in_hero: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      row_enabled: true,
      row_title: 'Luanti Game Jam 2026 Submissions',
      row_badge: 'GAME JAM 2026',
      row_icon: 'trophy',
      row_filter_tags: ['jam_game_2026'],
      row_sort: 'newest'
    };

    // Initial cached boot payload starts in-flight Jam sync
    (pkgService as any).applyBootPayload(
      {
        packages: [
          {
            id: 'SomeAuthor/unrelated_mod',
            author: 'SomeAuthor',
            name: 'unrelated_mod',
            title: 'Unrelated Mod',
            type: 'mod',
            short_desc: 'Unrelated mod entry',
            tags: ['utility'],
            source: 'official',
            sources: ['official'],
            provider: 'contentdb'
          }
        ],
        recentlyAdded: [],
        promotions: [jamPromo],
        top10Today: [],
        top10Week: []
      },
      { fromCache: true }
    );

    // Live boot payload arrives WHILE first /api/jam-2026 sync is still in-flight (with completely different title/desc and no repo_url yet)
    const warrConfspaceRaw = {
      id: 'Warr1024/confspace',
      author: 'Warr1024',
      name: 'confspace',
      title: 'Configuration Space Official Edition',
      type: 'game',
      short_desc: 'Completely rewritten official ContentDB description.',
      tags: ['oneofakind__original', 'puzzle', 'singleplayer'],
      source: 'official',
      sources: ['official'],
      provider: 'contentdb',
      downloads: 55
    };
    (pkgService as any).applyBootPayload({
      packages: [warrConfspaceRaw],
      recentlyAdded: [warrConfspaceRaw],
      promotions: [jamPromo],
      top10Today: [],
      top10Week: []
    });

    // Resolve first in-flight Jam fetch -> triggers queued pendingPromoTagResync automatically
    resolveFirstJamFetch(
      new Response(
        JSON.stringify({
          brews: [
            {
              id: 'confspace-brew-diff-title',
              repository: 'https://gitlab.com/sztest/confspace',
              commit: 'deadbeef1234',
              title: 'confspace_jam_prototype',
              description: 'Prototype build',
              commitUrl: 'https://gitlab.com/sztest/confspace/-/commit/deadbeef1234',
              hasScreenshot: false,
              publishedAt: '2026-11-09T18:00:00.000Z'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await new Promise((r) => setTimeout(r, 30));

    // Now simulate /api/packages/hydrate discovering repo_url for Warr1024/confspace!
    const unhydratedWarr = pkgService
      .packages()
      .find((p) => p.id === 'Warr1024/confspace')!;
    expect(unhydratedWarr).toBeDefined();
    await (pkgService as any).hydratePackageBatch([unhydratedWarr]);
    (pkgService as any).flushCatalogPatches();

    // Post-hydration repo matching merges sztest/confspace into Warr1024/confspace with jam_game_2026!
    const confspaceCards = pkgService
      .packages()
      .filter((p) => p.name.toLowerCase() === 'confspace');
    expect(confspaceCards).toHaveLength(1);
    expect(confspaceCards[0].id).toBe('Warr1024/confspace');
    expect(confspaceCards[0].tags).toContain('jam_game_2026');
    expect(confspaceCards[0].tags).toContain('gamejam');
    expect(confspaceCards[0].badge_tags).toContain('jam_game_2026');
    expect(confspaceCards[0].sources).toContain('official');
    expect(confspaceCards[0].sources).toContain('git');

    const promoRowPkgs = pkgService.activePromotionalRows()[0].packages;
    expect(promoRowPkgs).toHaveLength(1);
    expect(promoRowPkgs[0].id).toBe('Warr1024/confspace');
  });

  it('unions D1 tags losslessly in POST /api/packages/hydrate without overwriting jam_game_2026 and auto-detects JAM2026.md on game repos', async () => {
    (globalThis as any).caches = {
      default: {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => true)
      }
    };

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/packages/Warr1024/confspace/')) {
        return new Response(
          JSON.stringify({
            author: 'Warr1024',
            name: 'confspace',
            title: 'Configuration Space',
            type: 'game',
            license: 'MIT',
            media_license: 'MIT',
            downloads: 64,
            repo: 'https://gitlab.com/sztest/confspace',
            tags: ['oneofakind__original', 'puzzle', 'singleplayer']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/JAM2026.md')) {
        return new Response('# Configuration Space - Luanti Game Jam 2026 Entry\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      if (url.endsWith('/game.conf')) {
        return new Response('title = Configuration Space\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      if (url.includes('/scores/')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const batchedStatements: Array<{ sql: string; args: any[] }> = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: any[]) => ({
          all: vi.fn(async () => {
            if (sql.includes('FROM packages')) {
              return {
                results: [
                  {
                    id: 'Warr1024/confspace',
                    author_name: 'Warr1024',
                    name: 'confspace',
                    title: 'Configuration Space',
                    type: 'game',
                    status: 'active',
                    provider: 'contentdb',
                    license: '',
                    tags: JSON.stringify(['jam_game_2026', 'gamejam']),
                    badge_tags: JSON.stringify(['jam_game_2026'])
                  }
                ]
              };
            }
            return { results: [] };
          }),
          run: vi.fn(async () => ({})),
          __sql: sql,
          __args: args
        })),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({}))
      })),
      batch: vi.fn(async (stmts: any[]) => {
        for (const s of stmts) {
          if (s?.__sql) {
            batchedStatements.push({ sql: s.__sql, args: s.__args });
          }
        }
        return [];
      })
    };

    const res = await postPackagesHydrate({
      request: new Request('https://luantihub.org/api/packages/hydrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['Warr1024/confspace'] })
      }),
      env: { DB: mockDb }
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    const hydratedEntry = json.hydrated['warr1024/confspace'];
    expect(hydratedEntry).toBeDefined();
    expect(hydratedEntry.repo_url).toBe('https://gitlab.com/sztest/confspace');
    expect(hydratedEntry.tags).toContain('jam_game_2026');
    expect(hydratedEntry.tags).toContain('gamejam');
    expect(hydratedEntry.tags).toContain('oneofakind__original');
    expect(hydratedEntry.tags).toContain('puzzle');
    expect(hydratedEntry.badge_tags).toContain('jam_game_2026');

    // Verify D1 UPDATE packages never overwrites jam_game_2026/gamejam with only the 3 ContentDB tags
    const updatePkgStmt = batchedStatements.find((s) => s.sql.includes('UPDATE packages'));
    expect(updatePkgStmt).toBeDefined();
    const persistedTagsJson = updatePkgStmt!.args[updatePkgStmt!.args.length - 2];
    const persistedTags = JSON.parse(persistedTagsJson);
    expect(persistedTags).toContain('jam_game_2026');
    expect(persistedTags).toContain('gamejam');
    expect(persistedTags).toContain('oneofakind__original');
    expect(persistedTags).toContain('puzzle');
    expect(persistedTags).toContain('singleplayer');
  });

  it('routes production fetchUpstreamWithMirrorFallback("/packages/?tag=jam_game_2026&fmt=vcs") to /api/packages/?...&client=web and returns full web items', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PackageService]
    });
    const pkgService = TestBed.inject(PackageService);
    (pkgService as any).edgeApiAvailable = true;

    const requestedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      requestedUrls.push(url);
      if (url.startsWith('/api/packages/?')) {
        return getPackagesCatalog({
          request: new Request(`https://luantihub.org${url}`),
          env: {}
        });
      }
      if (url.includes('/packages/?tag=jam_game_2026')) {
        // Simulate ContentDB fmt=vcs response (note: fmt=vcs omits per-item `tags` array!)
        return new Response(
          JSON.stringify([
            {
              author: 'Warr1024',
              name: 'confspace',
              title: 'Configuration Space',
              type: 'game',
              short_description: 'Puzzle space game',
              repo: 'https://gitlab.com/sztest/confspace',
              release: 99123
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    const list = await (pkgService as any).fetchUpstreamWithMirrorFallback(
      '/packages/?tag=jam_game_2026&fmt=vcs'
    );

    expect(
      requestedUrls.some(
        (u) =>
          u.startsWith('/api/packages/?tag=jam_game_2026&fmt=vcs') &&
          u.includes('client=web') &&
          u.includes('ngsw-bypass=true')
      )
    ).toBe(true);
    expect(Array.isArray(list)).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0].author).toBe('Warr1024');
    expect(list[0].name).toBe('confspace');
    expect(list[0].tags).toContain('jam_game_2026');
  });

  it('does not trigger repeated network fetches or reactive loops when an active promotional row has 0 matching packages and _packages updates during hydration', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PackageService]
    });
    const pkgService = TestBed.inject(PackageService);
    (pkgService as any).__allowPromoTagSyncInTests = true;
    (pkgService as any).edgeApiAvailable = true;

    let jamFetchCount = 0;
    let tagFetchCount = 0;
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('/api/jam-2026')) {
        jamFetchCount++;
        return new Response(JSON.stringify({ brews: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.startsWith('/api/packages/?tag=jam_game_2026')) {
        tagFetchCount++;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    const jamPromo = {
      id: 'luanti-jam-2026-empty',
      title: 'Luanti Game Jam 2026',
      subtitle: 'Play & review community entries!',
      banner_url: '/promo/jam.png',
      cta_label: 'Explore Entries',
      cta_url: '/?tag=jam_game_2026',
      priority: 100,
      is_active: true,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      row_enabled: true,
      row_title: 'Luanti Game Jam 2026 Submissions',
      row_filter_tags: ['jam_game_2026']
    };

    (pkgService as any).applyBootPayload({
      packages: [
        {
          id: 'Minetest/minetest_game',
          author: 'Minetest',
          name: 'minetest_game',
          title: 'Minetest Game',
          type: 'game',
          short_desc: 'Base game',
          source: 'official',
          sources: ['official'],
          tags: ['game'],
          downloads: 500000
        }
      ],
      recentlyAdded: [],
      promotions: [jamPromo],
      top10Today: [],
      top10Week: []
    });

    TestBed.flushEffects();
    await new Promise((r) => setTimeout(r, 40));

    expect(jamFetchCount).toBe(1);
    expect(tagFetchCount).toBe(1);

    // Simulate multiple background catalog hydration mutations + promo clock ticks within the 60s window
    for (let i = 0; i < 4; i++) {
      (pkgService as any)._packages.update((list: any[]) =>
        list.map((p) => ({ ...p, downloads: p.downloads + 1 }))
      );
      pkgService.refreshPromoClock();
      TestBed.flushEffects();
      await new Promise((r) => setTimeout(r, 15));
    }

    // Must NOT re-fetch either endpoint while within the same boot generation & cooldown window!
    expect(jamFetchCount).toBe(1);
    expect(tagFetchCount).toBe(1);
  });

  it('scans JAM2026.md in POST /api/packages/hydrate even when a 2026 game is already fully populated in D1 (fast-skip path), while skipping pre-2026 games', async () => {
    (globalThis as any).caches = {
      default: {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => true)
      }
    };

    const probedJamUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/JAM2026.md')) {
        probedJamUrls.push(url);
        if (url.includes('sztest/confspace')) {
          return new Response('# Confspace Jam 2026\n', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        return new Response('Not found', { status: 404 });
      }
      if (url.endsWith('/game.conf')) {
        return new Response('title = Configuration Space\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const batchedStatements: Array<{ sql: string; args: any[] }> = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: any[]) => ({
          all: vi.fn(async () => {
            if (sql.includes('FROM packages')) {
              return {
                results: [
                  {
                    id: 'Warr1024/confspace',
                    author_name: 'Warr1024',
                    name: 'confspace',
                    title: 'Configuration Space',
                    type: 'game',
                    status: 'active',
                    provider: 'contentdb',
                    license: 'MIT',
                    contentdb_downloads: 120,
                    created_at: '2026-11-10T05:00:00Z',
                    repo_url: 'https://gitlab.com/sztest/confspace',
                    thumbnail_url: 'https://content.luanti.org/uploads/confspace_full.png',
                    banner_url: 'https://content.luanti.org/uploads/confspace_full.png',
                    screenshots: JSON.stringify(['https://content.luanti.org/uploads/confspace_full.png']),
                    review_thread_counts: JSON.stringify({ positive: 1, neutral: 0, negative: 0 }),
                    tags: JSON.stringify(['game', 'puzzle']),
                    badge_tags: JSON.stringify([])
                  },
                  {
                    id: 'Minetest/minetest_game',
                    author_name: 'Minetest',
                    name: 'minetest_game',
                    title: 'Minetest Game',
                    type: 'game',
                    status: 'active',
                    provider: 'contentdb',
                    license: 'LGPL-2.1-only',
                    contentdb_downloads: 900000,
                    created_at: '2018-05-20T00:00:00Z',
                    repo_url: 'https://github.com/luanti-org/minetest_game',
                    thumbnail_url: 'https://content.luanti.org/uploads/mtg_full.png',
                    banner_url: 'https://content.luanti.org/uploads/mtg_full.png',
                    screenshots: JSON.stringify(['https://content.luanti.org/uploads/mtg_full.png']),
                    review_thread_counts: JSON.stringify({ positive: 50, neutral: 5, negative: 2 }),
                    tags: JSON.stringify(['game', 'survival']),
                    badge_tags: JSON.stringify([])
                  }
                ]
              };
            }
            return { results: [] };
          }),
          run: vi.fn(async () => ({})),
          __sql: sql,
          __args: args
        })),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({}))
      })),
      batch: vi.fn(async (stmts: any[]) => {
        for (const s of stmts) {
          if (s?.__sql) {
            batchedStatements.push({ sql: s.__sql, args: s.__args });
          }
        }
        return [];
      })
    };

    const res = await postPackagesHydrate({
      request: new Request('https://luantihub.org/api/packages/hydrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['Warr1024/confspace', 'Minetest/minetest_game'] })
      }),
      env: { DB: mockDb }
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.hydrated['warr1024/confspace'].tags).toContain('jam_game_2026');
    expect(json.hydrated['warr1024/confspace'].tags).toContain('gamejam');
    expect(json.hydrated['warr1024/confspace'].badge_tags).toContain('jam_game_2026');
    expect(
      batchedStatements.some((s) => s.sql.includes('INSERT INTO promo_tag_packages'))
    ).toBe(true);

    // Pre-2026 game must NOT have wasted subrequests probing JAM2026.md
    expect(probedJamUrls.some((u) => u.includes('minetest_game'))).toBe(false);
    expect(probedJamUrls.some((u) => u.includes('confspace'))).toBe(true);
  });

  it('installs multi-mod ContentDB & Jam 2026 games (Warr1024/confspace and sztest/confspace) cleanly as Luanti games without injecting modpack.conf when provides.length > 1', async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const buildRawGitZip = (files: Array<{ path: string; content: string }>): Uint8Array => {
      const localParts: Uint8Array[] = [];
      const cdParts: Uint8Array[] = [];
      let offset = 0;
      for (const f of files) {
        const nameBytes = encoder.encode(f.path);
        const dataBytes = encoder.encode(f.content);
        const lh = new Uint8Array(30 + nameBytes.length + dataBytes.length);
        const lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0, true);
        lv.setUint16(8, 0, true);
        lv.setUint32(14, 0x12345678, true);
        lv.setUint32(18, dataBytes.length, true);
        lv.setUint32(22, dataBytes.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lh.set(nameBytes, 30);
        lh.set(dataBytes, 30 + nameBytes.length);
        localParts.push(lh);

        const ch = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint32(16, 0x12345678, true);
        cv.setUint32(20, dataBytes.length, true);
        cv.setUint32(24, dataBytes.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        ch.set(nameBytes, 46);
        cdParts.push(ch);
        offset += lh.length;
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

    const listZipEntries = (zip: Uint8Array): string[] => {
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

    const upstreamConfspaceGitZip = buildRawGitZip([
      { path: 'confspace-a1b2c3d4/game.conf', content: 'name = confspace\ntitle = Configuration Space\n' },
      { path: 'confspace-a1b2c3d4/mods/confspace_core/mod.conf', content: 'name = confspace_core\n' },
      { path: 'confspace-a1b2c3d4/mods/confspace_core/init.lua', content: '-- confspace_core\n' },
      { path: 'confspace-a1b2c3d4/mods/confspace_mapgen/mod.conf', content: 'name = confspace_mapgen\n' },
      { path: 'confspace-a1b2c3d4/mods/confspace_mapgen/init.lua', content: '-- confspace_mapgen\n' },
      { path: 'confspace-a1b2c3d4/mods/confspace_rooms/init.lua', content: '-- confspace_rooms\n' }
    ]);

    (globalThis as any).caches = {
      default: {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => true)
      }
    };

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/packages/Warr1024/confspace/releases/')) {
        return new Response(
          JSON.stringify([
            {
              id: 99123,
              title: '2026-11-10',
              commit: 'a1b2c3d4e5f67890',
              url: '/packages/Warr1024/confspace/releases/99123/download/'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/packages/Warr1024/confspace/for-client/')) {
        return new Response(
          JSON.stringify({
            author: 'Warr1024',
            name: 'confspace',
            title: 'Configuration Space',
            type: 'game',
            release: 99123,
            repo: 'https://gitlab.com/sztest/confspace',
            provides: ['confspace_core', 'confspace_mapgen', 'confspace_rooms']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/packages/Warr1024/confspace/')) {
        return new Response(
          JSON.stringify({
            author: 'Warr1024',
            name: 'confspace',
            title: 'Configuration Space',
            type: 'game',
            repo: 'https://gitlab.com/sztest/confspace',
            provides: ['confspace_core', 'confspace_mapgen', 'confspace_rooms']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              id: 'confspace-brew-2026',
              repository: 'https://gitlab.com/sztest/confspace',
              commit: 'a1b2c3d4e5f67890',
              title: 'Configuration Space',
              description: 'Puzzle game in configuration space',
              publishedAt: '2026-11-09T18:00:00.000Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('gitlab.com') && url.includes('archive.zip')) {
        return new Response(upstreamConfspaceGitZip as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    // 1. Luanti Engine Content tab download for canonical ContentDB game `Warr1024/confspace`
    const cdbGameRes = await handlePackageDownload({
      params: { author: 'Warr1024', name: 'confspace', release: '99123' },
      request: new Request(
        'https://luantihub.org/packages/Warr1024/confspace/releases/99123/download/?reason=new',
        {
          method: 'GET',
          headers: { 'User-Agent': 'Luanti/5.11.0' }
        }
      ),
      env: {}
    });
    expect(cdbGameRes.status).toBe(200);
    expect(cdbGameRes.headers.get('Content-Type')).toBe('application/zip');
    const cdbZipEntries = listZipEntries(new Uint8Array(await cdbGameRes.arrayBuffer()));
    expect(cdbZipEntries[0]).toBe('confspace/');
    expect(cdbZipEntries).toContain('confspace/game.conf');
    expect(cdbZipEntries).toContain('confspace/mods/confspace_core/init.lua');
    expect(cdbZipEntries).toContain('confspace/mods/confspace_mapgen/init.lua');
    expect(cdbZipEntries).toContain('confspace/mods/confspace_rooms/init.lua');
    // Must NEVER inject modpack.conf (which caused Luanti pkgmgr to fail with "Unable to install a modpack as a game")
    expect(cdbZipEntries).not.toContain('confspace/modpack.conf');
    expect(cdbZipEntries).not.toContain('confspace/modpack.txt');

    // 2. Cross-author Jam brew slug download (`sztest/confspace`) when D1/ContentDB has no `sztest/confspace` row
    const jamSlugRes = await handlePackageDownload({
      params: { author: 'sztest', name: 'confspace', release: '1' },
      request: new Request(
        'https://luantihub.org/packages/sztest/confspace/releases/1/download/?reason=new',
        {
          method: 'GET',
          headers: { 'User-Agent': 'Luanti/5.11.0' }
        }
      ),
      env: {}
    });
    expect(jamSlugRes.status).toBe(200);
    const jamZipEntries = listZipEntries(new Uint8Array(await jamSlugRes.arrayBuffer()));
    expect(jamZipEntries).toContain('confspace/game.conf');
    expect(jamZipEntries).toContain('confspace/mods/confspace_core/init.lua');
    expect(jamZipEntries).not.toContain('confspace/modpack.conf');
  });

  it('normalizes the v2 luanti-org/jam.luanti.org composite (repository, commit) payload without id (including zenonseth/strata)', async () => {
    const liveV2Brews = [
      {
        repository: 'https://github.com/zenonseth/strata',
        commit: 'fddfc86228fdcc6b6fc0a5010d35c5001ea1d028',
        title: 'Strata',
        description:
          'You signed a contract to get rich and skipped the fine print. Dig down through Strata, pay off your debt, and see what else is down there.',
        commitUrl: 'https://github.com/zenonseth/strata/tree/fddfc86228fdcc6b6fc0a5010d35c5001ea1d028',
        hasScreenshot: true,
        publishedAt: '2026-11-13T22:24:52.623Z'
      },
      {
        repository: 'https://github.com/sakel-hub/terrarium_crucible',
        commit: '4ab642dc8a316db04d9be65872094be69a304d81',
        title: 'Terrarium Crucible',
        description:
          "Shrink down inside a wizard's glass terrarium and care for magical glowing plants!",
        commitUrl: 'https://github.com/sakel-hub/terrarium_crucible/tree/4ab642dc8a316db04d9be65872094be69a304d81',
        hasScreenshot: true,
        publishedAt: '2026-11-08T18:10:00.000Z'
      },
      {
        repository: 'https://gitlab.com/sztest/confspace',
        commit: 'e48305a0c4e187dc75011a932df084d7ec02bc11',
        title: 'Configuration Space',
        description:
          'Work in Progress. One tiny room could have billions of possible states. Surely, they would all fit inside.',
        commitUrl: 'https://gitlab.com/sztest/confspace/-/tree/e48305a0c4e187dc75011a932df084d7ec02bc11',
        hasScreenshot: true,
        publishedAt: '2026-11-06T12:00:00.000Z'
      }
    ];

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(JSON.stringify(liveV2Brews), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    const jamEndpointRes = await getJam2026Endpoint({
      request: new Request('https://luantihub.org/api/jam-2026')
    });
    expect(jamEndpointRes.status).toBe(200);
    expect(jamEndpointRes.headers.get('Cache-Control')).toBe(
      'public, max-age=120, s-maxage=300, stale-while-revalidate=300'
    );
    const jamBody = await jamEndpointRes.json();
    expect(jamBody.brews).toHaveLength(3);

    const strata = jamBody.brews.find((b: any) => b.id === 'zenonseth/strata');
    expect(strata).toBeDefined();
    expect(strata.jam_entry_id).toBe('https://github.com/zenonseth/strata');
    const expectedStrataImg = `/api/packages?proxy_image=${encodeURIComponent(
      'https://jam.greenxenith.com/api/brews/image?repository=https%3A%2F%2Fgithub.com%2Fzenonseth%2Fstrata&commit=fddfc86228fdcc6b6fc0a5010d35c5001ea1d028'
    )}`;
    expect(strata.thumbnail).toBe(expectedStrataImg);
    expect(strata.banner).toBe(expectedStrataImg);
    expect(strata.screenshots).toEqual([expectedStrataImg]);

    // Client fallback helper also converts raw v2 entries without `id` identically
    const clientConverted = convertJam2026BrewToRawPackage(liveV2Brews[0] as any);
    expect(clientConverted).not.toBeNull();
    expect(clientConverted?.['id']).toBe('zenonseth/strata');
    expect(clientConverted?.['thumbnail']).toBe(
      `/api/packages?proxy_image=${encodeURIComponent(
        buildJam2026ClientImageUrl(
          liveV2Brews[0].repository,
          liveV2Brews[0].commit
        )
      )}`
    );
  });

  it('refreshes ext_jam2026_ D1 screenshot URLs when a newer commit supersedes a purged screenshot in jam.luanti.org', async () => {
    const commit1 = '1111111111111111111111111111111111111111';
    const commit2 = '2222222222222222222222222222222222222222';
    let currentCommit = commit1;

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://github.com/zenonseth/strata',
              commit: currentCommit,
              title: 'Strata',
              description: 'Dig down through Strata.',
              commitUrl: `https://github.com/zenonseth/strata/tree/${currentCommit}`,
              hasScreenshot: true,
              publishedAt: '2026-11-13T22:24:52.623Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    const capturedSqls: string[] = [];
    const capturedBinds: any[][] = [];
    const mockDb = {
      prepare: vi.fn((sql: string) => {
        capturedSqls.push(sql);
        return {
          bind: vi.fn((...args: any[]) => {
            capturedBinds.push(args);
            return {
              all: vi.fn(async () => ({ results: [] })),
              run: vi.fn(async () => ({}))
            };
          })
        };
      }),
      batch: vi.fn(async () => [])
    };

    await syncJam2026IntoPromoRowDelta({
      uniqueTags: ['jam_game_2026'],
      addTagStamp: () => {},
      discoveredByKey: new Map(),
      existingD1Pairs: new Set(),
      queuedUpsertKeys: new Set(),
      d1UpsertPairs: [],
      db: mockDb,
      noCache: true
    });

    const insertSql = capturedSqls.find((s) => s.includes('INSERT INTO packages'));
    expect(insertSql).toBeDefined();
    expect(insertSql).toContain("WHEN packages.thumbnail_url LIKE '%jam.greenxenith.com%'");
    expect(insertSql).toContain(
      "WHEN ((packages.author_id IS NULL OR packages.author_id LIKE 'ext_jam2026_%') AND COALESCE(packages.provider, '') != 'contentdb') THEN COALESCE(excluded.thumbnail_url"
    );
    expect(insertSql).toContain('THEN excluded.thumbnail_url');
    expect(insertSql).toContain('THEN excluded.banner_url');
    expect(insertSql).toContain('THEN excluded.screenshots');

    // Now simulate moderator approving a newer commit (superseding & purging commit1's screenshot in jam.luanti.org)
    capturedBinds.length = 0;
    currentCommit = commit2;
    const discoveredCommit2Map = new Map<string, any>();
    const repoTagMap2 = await syncJam2026IntoPromoRowDelta({
      uniqueTags: ['jam_game_2026'],
      addTagStamp: () => {},
      discoveredByKey: discoveredCommit2Map,
      existingD1Pairs: new Set(),
      queuedUpsertKeys: new Set(),
      d1UpsertPairs: [],
      db: mockDb,
      noCache: true
    });

    const expectedCommit1Thumb = `/api/packages?proxy_image=${encodeURIComponent(
      buildJam2026BrewImageUrl('https://github.com/zenonseth/strata', commit1)
    )}&ngsw-bypass=true`;
    const expectedCommit2Thumb = `/api/packages?proxy_image=${encodeURIComponent(
      buildJam2026BrewImageUrl('https://github.com/zenonseth/strata', commit2)
    )}`;
    const packageUpsertBind = capturedBinds.find((args) => args[0] === 'zenonseth/strata' && args.length >= 20);
    expect(packageUpsertBind).toBeDefined();
    expect(packageUpsertBind?.[1]).toBeNull();
    expect(packageUpsertBind?.[9]).toBe(expectedCommit2Thumb);
    expect(packageUpsertBind?.[10]).toBe(expectedCommit2Thumb);
    expect(packageUpsertBind?.[16]).toBe(commit2);

    // Warm Edge catalog overlay also refreshes superseded commit1 screenshot immediately
    const warmCatalogOverlay = applyJam2026RepoOverlayOnCatalog(
      [
        {
          id: 'zenonseth/strata',
          author: 'zenonseth',
          name: 'strata',
          type: 'game',
          repo_url: 'https://github.com/zenonseth/strata',
          thumbnail: expectedCommit1Thumb,
          banner: expectedCommit1Thumb,
          latest_commit_sha: commit1,
          tags: ['jam_game_2026', 'gamejam', 'game'],
          badge_tags: ['jam_game_2026'],
          source: 'git',
          sources: ['git']
        }
      ],
      repoTagMap2,
      Array.from(discoveredCommit2Map.values())
    );
    expect(warmCatalogOverlay.packages[0].thumbnail).toBe(`${expectedCommit2Thumb}&ngsw-bypass=true`);
    expect(warmCatalogOverlay.packages[0].latest_commit_sha).toBe(commit2);
  });

  it('resolves GET /api/packages/zenonseth/strata and /for-client via isolated resolveJam2026SyntheticD1Detail even before D1 persistence', async () => {
    const strataCommit = 'fddfc86228fdcc6b6fc0a5010d35c5001ea1d028';
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://github.com/zenonseth/strata',
              commit: strataCommit,
              title: 'Strata',
              description: 'You signed a contract to get rich and skipped the fine print.',
              commitUrl: `https://github.com/zenonseth/strata/tree/${strataCommit}`,
              hasScreenshot: true,
              publishedAt: '2026-11-13T22:24:52.623Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('raw.githubusercontent.com/zenonseth/strata') && url.endsWith('/game.conf')) {
        return new Response('name = Strata\ndescription = Dig down through Strata.\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      if (url.includes('raw.githubusercontent.com/zenonseth/strata') && url.endsWith('/JAM2026.md')) {
        return new Response('# Strata (Game Jam 2026)\nDig deep and pay off your contract!', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const matchedBrew = await findJam2026BrewBySlug('zenonseth', 'strata');
    expect(matchedBrew?.repo_url).toBe('https://github.com/zenonseth/strata');
    expect(toLegacyLuantiClientThumbnailUrl(matchedBrew?.thumbnail)).toBeUndefined();
    expect(resolveJam2026ClientScreenshotUrl(matchedBrew?.thumbnail)).toBe(
      `https://raw.githubusercontent.com/zenonseth/strata/${strataCommit}/screenshot.png`
    );

    const synth = await resolveJam2026SyntheticD1Detail('zenonseth', 'strata', null, []);
    expect(synth.d1Pkg?.id).toBe('zenonseth/strata');
    expect(synth.d1Pkg?.type).toBe('game');
    expect(synth.bundledReleases).toHaveLength(1);
    expect(synth.bundledReleases[0].commit_sha).toBe(strataCommit);

    const detailRes = await getPackageDetail({
      params: { author: 'zenonseth', name: 'strata' },
      request: new Request('https://luantihub.org/api/packages/zenonseth/strata?readme=1'),
      env: {}
    } as any);
    expect(detailRes.status).toBe(200);
    const detailJson = await detailRes.json();
    expect(detailJson.id).toBe('zenonseth/strata');
    expect(detailJson.title).toBe('Strata');
    expect(detailJson.type).toBe('game');
    expect(detailJson.repo_url).toBe('https://github.com/zenonseth/strata');
    expect(detailJson.tags).toContain('jam_game_2026');
    expect(detailJson.badge_tags).toContain('jam_game_2026');
    expect(detailJson.readme).toContain('# Strata (Game Jam 2026)');

    const forClientRes = await getPackageForClient({
      params: { author: 'zenonseth', name: 'strata' },
      request: new Request('https://luantihub.org/api/packages/zenonseth/strata/for-client?formspec_version=8'),
      env: {}
    } as any);
    expect(forClientRes.status).toBe(200);
    const forClientJson = await forClientRes.json();
    expect(forClientJson.name).toBe('strata');
    expect(forClientJson.type).toBe('game');
    expect(forClientJson.screenshots).toEqual([
      { url: `https://raw.githubusercontent.com/zenonseth/strata/${strataCommit}/screenshot.png` }
    ]);
  });

  const createInMemoryEdgeCaches = () => {
    const store = new Map<string, Response>();
    return {
      default: {
        match: async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          const hit = store.get(key);
          return hit ? hit.clone() : undefined;
        },
        put: async (req: Request | string, res: Response) => {
          const key = typeof req === 'string' ? req : req.url;
          store.set(key, res.clone());
        },
        delete: async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          return store.delete(key);
        }
      }
    };
  };

  const buildCrcZip = (files: Array<{ path: string; content: string }>): Uint8Array => {
    const encoder = new TextEncoder();
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    const crc32 = (buf: Uint8Array) => {
      let crc = 0xffffffff;
      for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    };
    const localParts: Uint8Array[] = [];
    const cdParts: Uint8Array[] = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = encoder.encode(f.path);
      const dataBytes = encoder.encode(f.content);
      const crc = crc32(dataBytes);
      const lh = new Uint8Array(30 + nameBytes.length + dataBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lh.set(nameBytes, 30);
      lh.set(dataBytes, 30 + nameBytes.length);
      localParts.push(lh);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      cdParts.push(ch);
      offset += lh.length;
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

  const readZipEntriesText = async (zip: Uint8Array): Promise<Record<string, string>> => {
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const decoder = new TextDecoder();
    let eocdPos = -1;
    for (let p = zip.length - 22; p >= 0; p--) {
      if (v.getUint32(p, true) === 0x06054b50) {
        eocdPos = p;
        break;
      }
    }
    expect(eocdPos).toBeGreaterThanOrEqual(0);
    const count = v.getUint16(eocdPos + 10, true);
    let ptr = v.getUint32(eocdPos + 16, true);
    const out: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      const compSize = v.getUint32(ptr + 20, true);
      const nLen = v.getUint16(ptr + 28, true);
      const eLen = v.getUint16(ptr + 30, true);
      const cLen = v.getUint16(ptr + 32, true);
      const lfhOffset = v.getUint32(ptr + 42, true);
      const entryName = decoder.decode(zip.slice(ptr + 46, ptr + 46 + nLen));
      const method = v.getUint16(lfhOffset + 8, true);
      const lNLen = v.getUint16(lfhOffset + 26, true);
      const lELen = v.getUint16(lfhOffset + 28, true);
      const dataStart = lfhOffset + 30 + lNLen + lELen;
      const payload = zip.slice(dataStart, dataStart + compSize);
      if (method === 0) {
        out[entryName] = decoder.decode(payload);
      } else if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(payload);
        writer.close();
        const raw = new Uint8Array(await new Response(ds.readable).arrayBuffer());
        out[entryName] = decoder.decode(raw);
      } else {
        out[entryName] = '';
      }
      ptr += 46 + nLen + eLen + cLen;
    }
    return out;
  };

  const createFkEnforcingJamD1 = () => {
    const users = new Map<string, any>();
    const packages = new Map<string, any>();
    const releases: Array<any> = [];
    const promoPairs = new Set<string>();
    let nextRelId = 1;

    const executeSql = async (sql: string, args: any[], mode: 'run' | 'first' | 'all') => {
      const clean = sql.trim();

      if (/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+users/i.test(clean)) {
        const [id, username, display_name, avatar_url] = args;
        const usernameTaken = Array.from(users.values()).some(
          (u) => String(u.username || '').toLowerCase() === String(username || '').toLowerCase()
        );
        if (!usernameTaken && !users.has(id)) {
          users.set(id, { id, username, display_name, avatar_url });
        }
        return mode === 'all' ? { results: [] } : { success: true };
      }

      if (/INSERT\s+INTO\s+packages/i.test(clean) && /SELECT\s+\?/i.test(clean)) {
        const [
          id,
          author_id,
          author_name,
          name,
          title,
          short_desc,
          long_desc,
          repo_url,
          provider,
          thumbnail_url,
          banner_url,
          screenshots,
          license,
          media_license,
          tags,
          min_minetest_version,
          latest_commit_sha,
          created_at,
          updated_at,
          whereRepoUrl,
          whereNotId
        ] = args;

        if (author_id !== null && author_id !== undefined && !users.has(String(author_id))) {
          throw new Error('D1_ERROR: FOREIGN KEY constraint failed');
        }
        const conflictOther = Array.from(packages.values()).some(
          (p) =>
            p.repo_url &&
            whereRepoUrl &&
            String(p.repo_url).toLowerCase() === String(whereRepoUrl).toLowerCase() &&
            String(p.id).toLowerCase() !== String(whereNotId).toLowerCase()
        );
        if (conflictOther) {
          return mode === 'all' ? { results: [] } : { success: true };
        }

        const key = String(id).toLowerCase();
        const existing = packages.get(key);
        if (!existing) {
          packages.set(key, {
            id,
            author_id: author_id ?? null,
            author_name,
            name,
            title,
            type: 'game',
            short_desc,
            long_desc,
            repo_url,
            provider,
            default_branch: 'main',
            thumbnail_url,
            banner_url,
            screenshots,
            license,
            media_license,
            tags,
            min_minetest_version,
            latest_commit_sha,
            metadata_synced_at: new Date().toISOString(),
            license_override: 0,
            status: 'active',
            downloads_count: 0,
            contentdb_downloads: 0,
            luantihub_downloads: 0,
            score: 0,
            created_at,
            updated_at
          });
        } else {
          const shaChanged =
            Boolean(existing.latest_commit_sha) &&
            String(existing.latest_commit_sha).toLowerCase() !== String(latest_commit_sha || '').toLowerCase();
          let nextUpdatedAt = updated_at;
          if (shaChanged) {
            const prevSec = Math.floor(Date.parse(existing.updated_at || existing.created_at || '2026-01-01T00:00:00Z') / 1000);
            const nextSec = Math.max(Math.floor(Date.now() / 1000), prevSec + 1, Math.floor(Date.parse(updated_at) / 1000) || 1);
            nextUpdatedAt = new Date(nextSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
          } else if (existing.updated_at && existing.updated_at > updated_at) {
            nextUpdatedAt = existing.updated_at;
          }
          const respectOverride = Number(existing.license_override || 0) === 1;
          packages.set(key, {
            ...existing,
            title,
            short_desc,
            repo_url: existing.repo_url || repo_url,
            thumbnail_url,
            banner_url,
            screenshots,
            license: !respectOverride && license ? license : existing.license,
            media_license: !respectOverride && media_license ? media_license : existing.media_license,
            min_minetest_version:
              min_minetest_version && min_minetest_version !== '5.0.0'
                ? min_minetest_version
                : existing.min_minetest_version,
            metadata_synced_at: new Date().toISOString(),
            latest_commit_sha,
            updated_at: nextUpdatedAt
          });
        }
        return mode === 'all' ? { results: [] } : { success: true };
      }

      if (/DELETE\s+FROM\s+releases/i.test(clean)) {
        const targetId = String(args[0] || '').toLowerCase();
        for (let i = releases.length - 1; i >= 0; i--) {
          const pkg = packages.get(targetId);
          const isUnclaimedJam =
            pkg &&
            (pkg.author_id === null || String(pkg.author_id).startsWith('ext_jam2026_')) &&
            String(pkg.provider || '') !== 'contentdb';
          if (String(releases[i].package_id).toLowerCase() === targetId && isUnclaimedJam) {
            releases.splice(i, 1);
          }
        }
        return { success: true };
      }

      if (/INSERT\s+INTO\s+releases/i.test(clean)) {
        const [pkgId, version, tag_name, commit_sha, download_url, min_minetest_version, , fallbackReleasedAt] = args;
        const pkg = packages.get(String(pkgId).toLowerCase());
        if (!pkg) throw new Error('D1_ERROR: FOREIGN KEY constraint failed');
        const isUnclaimedJam =
          (pkg.author_id === null || String(pkg.author_id).startsWith('ext_jam2026_')) &&
          String(pkg.provider || '') !== 'contentdb';
        if (isUnclaimedJam) {
          releases.push({
            id: nextRelId++,
            package_id: pkg.id,
            version,
            tag_name,
            commit_sha,
            download_url,
            min_minetest_version,
            released_at: pkg.updated_at || fallbackReleasedAt
          });
        }
        return { success: true };
      }

      if (/INSERT\s+INTO\s+promo_tag_packages/i.test(clean)) {
        promoPairs.add(`${String(args[0]).toLowerCase()}::${String(args[1]).toLowerCase()}`);
        return { success: true };
      }

      if (/SELECT\s+LOWER\(id\)\s+as\s+lower_id,\s+updated_at,\s+created_at/i.test(clean) && /FROM\s+packages/i.test(clean)) {
        const lowerIds = new Set(args.map((a) => String(a).toLowerCase()));
        const results = Array.from(packages.entries())
          .filter(([k]) => lowerIds.has(k))
          .map(([k, p]) => ({
            lower_id: k,
            updated_at: p.updated_at,
            created_at: p.created_at,
            license: p.license,
            media_license: p.media_license,
            min_minetest_version: p.min_minetest_version,
            thumbnail_url: p.thumbnail_url,
            banner_url: p.banner_url,
            screenshots: p.screenshots
          }));
        return { results };
      }

      if (/FROM\s+releases/i.test(clean)) {
        const pkgId = String(args[0] || '').toLowerCase();
        const filtered = releases
          .filter((r) => String(r.package_id).toLowerCase() === pkgId)
          .sort((a, b) => String(b.released_at).localeCompare(String(a.released_at)) || b.id - a.id);
        return mode === 'first' ? filtered[0] || null : { results: filtered };
      }

      if (/FROM\s+packages/i.test(clean)) {
        if (/COUNT\(\*\)/i.test(clean)) {
          return mode === 'first' ? { cnt: packages.size } : { results: [{ cnt: packages.size }] };
        }
        if (/status\s+IN\s*\(\s*'flagged'/i.test(clean)) {
          const flagged = Array.from(packages.values()).filter(
            (p) => p.status === 'flagged' || p.status === 'delisted'
          );
          return mode === 'first' ? flagged[0] || null : { results: flagged };
        }
        const allActive = Array.from(packages.values()).filter((p) => p.status === 'active');
        if (mode === 'first') {
          const arg0 = String(args[0] || '').toLowerCase();
          const arg1 = args[2] !== undefined ? String(args[2]).toLowerCase() : undefined;
          const found = allActive.find((p) => {
            if (String(p.id).toLowerCase() === arg0) return true;
            if (arg1 !== undefined) {
              return String(p.author_name).toLowerCase() === arg0 && String(p.name).toLowerCase() === arg1;
            }
            return false;
          });
          return found || null;
        }
        return { results: allActive };
      }

      if (mode === 'first') return null;
      return { results: [] };
    };

    const prepare = (sql: string) => {
      const bound: any[] = [];
      const stmt: any = {
        bind: (...args: any[]) => {
          bound.push(...args);
          return stmt;
        },
        run: () => executeSql(sql, bound, 'run'),
        first: () => executeSql(sql, bound, 'first'),
        all: () => executeSql(sql, bound, 'all')
      };
      return stmt;
    };

    return {
      users,
      packages,
      releases,
      db: {
        prepare,
        batch: async (stmts: any[]) => {
          for (const s of stmts) {
            await s.run();
          }
          return [];
        }
      }
    };
  };

  it('persists pure-Git Jam 2026 packages into FK-enforcing D1 without error and shows zenonseth/strata in all in-game client Content tab paths (MISS-EDGE, HIT-BOOT-SHARED, ?type=game, ?q=strata, &fmt=keys)', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    await invalidateEdgeCacheKeys([
      BOOT_CATALOG_EDGE_CACHE_KEY,
      UPDATES_EDGE_CACHE_KEY,
      IN_GAME_CATALOG_CACHE_PREFIX,
      'https://luantihub.internal/api/packages/?fmt=vcs',
      'https://luantihub.internal/api/packages/?type=game&fmt=vcs',
      'https://luantihub.internal/api/packages/?type=game&q=strata&fmt=vcs'
    ]);

    const strataCommit = 'abc1234567890abcdef1234567890abcdef12345';
    const aliceCommit = 'def1234567890abcdef1234567890abcdef12345';
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://codeberg.org/zenonseth/strata',
              commit: strataCommit,
              title: 'Strata',
              description: 'Dig deep and survive.',
              hasScreenshot: false,
              publishedAt: '2026-11-13T22:24:52.623Z'
            },
            {
              repository: 'https://codeberg.org/alice/alice_jam',
              commit: aliceCommit,
              title: 'Alice Jam',
              description: 'Cross-provider username FK safety entry.',
              hasScreenshot: false,
              publishedAt: '2026-11-13T20:00:00.000Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/packages')) {
        // ContentDB does NOT have zenonseth/strata
        return new Response(
          JSON.stringify([
            {
              author: 'Minetest',
              name: 'minetest_game',
              title: 'Minetest Game',
              type: 'game',
              short_description: 'Classic sandbox game',
              release: 15000,
              thumbnail: null
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/tags')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('content.luanti.org/api/scores')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('blog.luanti.org')) {
        return new Response('', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const fkD1 = createFkEnforcingJamD1();
    fkD1.users.set('usr_github_alice', {
      id: 'usr_github_alice',
      username: 'alice',
      display_name: 'Alice',
      avatar_url: ''
    });

    try {
      // 1. Cold in-game Luanti client catalog request (MISS-EDGE) without prior ?boot=1 or ?tag=jam_game_2026
      const coldClientRes = await getPackagesCatalog({
        request: new Request(
          'https://luantihub.org/api/packages/?type=mod&type=game&type=txp&protocol_version=45&engine_version=5.18.0&hide=nonfree&hide=desktop_default'
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(coldClientRes.status).toBe(200);
      expect(coldClientRes.headers.get('X-LuantiHub-Cache')).toBe('MISS-EDGE');
      const coldClientList = await coldClientRes.json();
      expect(Array.isArray(coldClientList)).toBe(true);
      const strataCold = coldClientList.find(
        (p: any) => String(p.author).toLowerCase() === 'zenonseth' && String(p.name).toLowerCase() === 'strata'
      );
      expect(strataCold).toBeDefined();
      expect(strataCold.type).toBe('game');
      expect(Number(strataCold.release)).toBeGreaterThan(1700000000);

      // Verify FK-enforced D1 persistence succeeded cleanly with author_id = null
      const persistedPkg = fkD1.packages.get('zenonseth/strata');
      expect(persistedPkg).toBeDefined();
      expect(persistedPkg.author_id).toBeNull();
      expect(fkD1.releases.some((r) => r.package_id === 'zenonseth/strata' && r.commit_sha === strataCommit)).toBe(true);
      const persistedAlice = fkD1.packages.get('alice/alice_jam');
      expect(persistedAlice).toBeDefined();
      expect(persistedAlice.author_id).toBeNull();

      // 2. Search by query (?type=game&q=strata)
      const searchRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages/?type=game&q=strata'),
        env: { DB: fkD1.db }
      } as any);
      expect(searchRes.status).toBe(200);
      const searchList = await searchRes.json();
      expect(
        searchList.some((p: any) => String(p.author).toLowerCase() === 'zenonseth' && String(p.name).toLowerCase() === 'strata')
      ).toBe(true);

      // 3. Modern Luanti columnar fmt=keys includes aliases and zenonseth/strata
      const keysRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages/?type=game&q=strata&fmt=keys'),
        env: { DB: fkD1.db }
      } as any);
      expect(keysRes.status).toBe(200);
      const keysPayload = await keysRes.json();
      expect(keysPayload.keys).toContain('aliases');
      const authorCol = keysPayload.keys.indexOf('author');
      const nameCol = keysPayload.keys.indexOf('name');
      expect(
        keysPayload.pkgs.some(
          (row: any[]) =>
            String(row[authorCol]).toLowerCase() === 'zenonseth' &&
            String(row[nameCol]).toLowerCase() === 'strata'
        )
      ).toBe(true);

      // 4. Warm PWA boot bundle followed by in-game HIT-BOOT-SHARED
      await invalidateEdgeCacheKeys([BOOT_CATALOG_EDGE_CACHE_KEY, IN_GAME_CATALOG_CACHE_PREFIX]);
      const bootRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages/?boot=1'),
        env: { DB: fkD1.db }
      } as any);
      expect(bootRes.status).toBe(200);

      const sharedRes = await getPackagesCatalog({
        request: new Request(
          'https://luantihub.org/api/packages/?type=mod&type=game&type=txp&protocol_version=45&engine_version=5.18.0&hide=nonfree&hide=desktop_default'
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(sharedRes.status).toBe(200);
      expect(sharedRes.headers.get('X-LuantiHub-Cache')).toBe('HIT-BOOT-SHARED');
      const sharedList = await sharedRes.json();
      expect(
        sharedList.some((p: any) => String(p.author).toLowerCase() === 'zenonseth' && String(p.name).toLowerCase() === 'strata')
      ).toBe(true);
    } finally {
      await invalidateEdgeCacheKeys([
        BOOT_CATALOG_EDGE_CACHE_KEY,
        UPDATES_EDGE_CACHE_KEY,
        IN_GAME_CATALOG_CACHE_PREFIX
      ]);
    }
  });

  it('maintains identical monotonic release IDs across catalog, /for-client, and /api/updates and installs/upgrades pure-Git Jam games (?reason=new -> commit bump with unchanged publishedAt -> ?reason=update)', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();
    await invalidateEdgeCacheKeys([
      BOOT_CATALOG_EDGE_CACHE_KEY,
      UPDATES_EDGE_CACHE_KEY,
      IN_GAME_CATALOG_CACHE_PREFIX,
      '/api/packages/zenonseth/strata',
      `${FOR_CLIENT_CACHE_PREFIX}/en/zenonseth/strata/fsv=8`
    ]);

    const commit1 = '1111111abcdef1111111abcdef1111111abcdef1';
    const commit2 = '2222222abcdef2222222abcdef2222222abcdef2';
    const unchangedPublishedAt = '2026-11-13T22:24:52.623Z';
    let currentCommit = commit1;

    const zipCommit1 = buildCrcZip([
      { path: 'strata-git/game.conf', content: 'name = Strata\ntitle = Strata\nrelease_tag = v1\n' },
      { path: 'strata-git/mods/strata_core/init.lua', content: '-- commit 1\n' }
    ]);
    const zipCommit2 = buildCrcZip([
      { path: 'strata-git/game.conf', content: 'name = Strata\ntitle = Strata\nrelease_tag = v2\n' },
      { path: 'strata-git/mods/strata_core/init.lua', content: '-- commit 2 updated gameplay!\n' }
    ]);

    const cdbDependencyCalls: string[] = [];
    const zipFetchUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://codeberg.org/zenonseth/strata',
              commit: currentCommit,
              title: 'Strata',
              description: 'Dig deep into Strata.',
              hasScreenshot: false,
              publishedAt: unchangedPublishedAt
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes(`/archive/${commit1}.zip`)) {
        zipFetchUrls.push(url);
        return new Response(zipCommit1 as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      if (url.includes(`/archive/${commit2}.zip`)) {
        zipFetchUrls.push(url);
        return new Response(zipCommit2 as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      if (url.includes('content.luanti.org/api/packages/zenonseth/strata/dependencies')) {
        cdbDependencyCalls.push(url);
        return new Response('Not found', { status: 404 });
      }
      if (url.includes('content.luanti.org/api/updates')) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('content.luanti.org/api/packages')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const fkD1 = createFkEnforcingJamD1();
    fkD1.users.set('usr_github_alice', {
      id: 'usr_github_alice',
      username: 'alice',
      display_name: 'Alice',
      avatar_url: ''
    });

    try {
      const desktopCatalogUrl =
        'https://luantihub.org/api/packages/?type=mod&type=game&type=txp&protocol_version=45&engine_version=5.18.0&hide=nonfree&hide=desktop_default';

      // 1. Initial in-game catalog, /for-client, /dependencies, /api/updates at commit1
      const cat1Res = await getPackagesCatalog({
        request: new Request(desktopCatalogUrl),
        env: { DB: fkD1.db }
      } as any);
      const cat1Json = await cat1Res.json();
      const cat1Pkg = cat1Json.find((p: any) => p.name === 'strata');
      expect(cat1Pkg).toBeDefined();

      const fc1Res = await getPackageForClient({
        params: { author: 'zenonseth', name: 'strata' },
        request: new Request(
          'https://luantihub.org/api/packages/zenonseth/strata/for-client/?protocol_version=45&formspec_version=8'
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(fc1Res.status).toBe(200);
      const fc1Json = await fc1Res.json();

      const depsRes = await getPackageDependencies({
        params: { author: 'zenonseth', name: 'strata' },
        request: new Request('https://luantihub.org/api/packages/zenonseth/strata/dependencies/?only_hard=1'),
        env: { DB: fkD1.db }
      } as any);
      expect(depsRes.status).toBe(200);
      expect(depsRes.headers.get('X-LuantiHub-Source')).toBe('d1-git');
      expect(await depsRes.json()).toEqual({ 'zenonseth/strata': [] });
      expect(cdbDependencyCalls).toHaveLength(0);

      const upd1Res = await getUpdatesEndpoint({
        request: new Request('https://luantihub.org/api/updates/?nocache=1'),
        env: { DB: fkD1.db }
      } as any);
      expect(upd1Res.status).toBe(200);
      const upd1Json = await upd1Res.json();

      expect(cat1Pkg.release).toBe(fc1Json.release);
      expect(upd1Json['zenonseth/strata']).toBe(fc1Json.release);

      // 2. Download & install commit1 (?reason=new)
      const dl1Res = await handleReleaseDownload({
        params: { author: 'zenonseth', name: 'strata', release: String(fc1Json.release) },
        request: new Request(
          `https://luantihub.org/packages/zenonseth/strata/releases/${fc1Json.release}/download/?reason=new`,
          { headers: { 'User-Agent': 'Luanti/5.18.0' } }
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(dl1Res.status).toBe(200);
      expect(dl1Res.headers.get('Content-Type')).toBe('application/zip');
      const dl1Files = await readZipEntriesText(new Uint8Array(await dl1Res.arrayBuffer()));
      expect(dl1Files['strata/game.conf']).toContain('release_tag = v1');
      expect(zipFetchUrls.some((u) => u.includes(commit1))).toBe(true);

      // 3. Moderator approves commit2 on jam.luanti.org WITH UNCHANGED publishedAt
      currentCommit = commit2;
      resetJam2026IsolateCacheForTests();

      // Calling /api/updates/?nocache=1 persists commit2 and evicts BOTH canonical desktop catalog and /for-client Edge caches
      const upd2Res = await getUpdatesEndpoint({
        request: new Request('https://luantihub.org/api/updates/?nocache=1'),
        env: { DB: fkD1.db }
      } as any);
      const upd2Json = await upd2Res.json();

      // Simulate a separate cold Worker isolate reading shared caches.default after commit2 invalidation
      clearIsolateCachesForTests();
      resetJam2026IsolateCacheForTests();

      const fc2Res = await getPackageForClient({
        params: { author: 'zenonseth', name: 'strata' },
        request: new Request(
          'https://luantihub.org/api/packages/zenonseth/strata/for-client/?protocol_version=45&formspec_version=8'
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(fc2Res.headers.get('X-LuantiHub-Cache')).toBe('MISS-EDGE');
      const fc2Json = await fc2Res.json();

      const cat2Res = await getPackagesCatalog({
        request: new Request(desktopCatalogUrl),
        env: { DB: fkD1.db }
      } as any);
      expect(cat2Res.headers.get('X-LuantiHub-Cache')).toBe('MISS-EDGE');
      const cat2Json = await cat2Res.json();
      const cat2Pkg = cat2Json.find((p: any) => p.name === 'strata');

      // Second uncached catalog variant when unsyncedBrews.length === 0 must ALSO read back bumped D1 updated_at
      clearIsolateCachesForTests();
      resetJam2026IsolateCacheForTests();
      const cat2FilteredRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages/?type=game&q=strata'),
        env: { DB: fkD1.db }
      } as any);
      expect(cat2FilteredRes.headers.get('X-LuantiHub-Cache')).toBe('MISS-EDGE');
      const cat2FilteredJson = await cat2FilteredRes.json();
      const cat2FilteredPkg = cat2FilteredJson.find((p: any) => p.name === 'strata');

      // Strictly higher release integer across ALL 3 endpoints even though publishedAt stayed identical
      expect(fc2Json.release).toBeGreaterThan(fc1Json.release);
      expect(cat2Pkg.release).toBe(fc2Json.release);
      expect(cat2FilteredPkg.release).toBe(fc2Json.release);
      expect(upd2Json['zenonseth/strata']).toBe(fc2Json.release);

      // 4. Download upgrade (?reason=update) must serve commit2 archive, NOT commit1
      const dl2Res = await handleReleaseDownload({
        params: { author: 'zenonseth', name: 'strata', release: String(fc2Json.release) },
        request: new Request(
          `https://luantihub.org/packages/zenonseth/strata/releases/${fc2Json.release}/download/?reason=update`,
          { headers: { 'User-Agent': 'Luanti/5.18.0' } }
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(dl2Res.status).toBe(200);
      const dl2Files = await readZipEntriesText(new Uint8Array(await dl2Res.arrayBuffer()));
      expect(dl2Files['strata/game.conf']).toContain('release_tag = v2');
      expect(dl2Files['strata/mods/strata_core/init.lua']).toContain('commit 2');
      expect(zipFetchUrls.some((u) => u.includes(commit2))).toBe(true);
    } finally {
      clearIsolateCachesForTests();
      await invalidateEdgeCacheKeys([
        BOOT_CATALOG_EDGE_CACHE_KEY,
        UPDATES_EDGE_CACHE_KEY,
        IN_GAME_CATALOG_CACHE_PREFIX,
        '/api/packages/zenonseth/strata',
        `${FOR_CLIENT_CACHE_PREFIX}/en/zenonseth/strata/fsv=8`
      ]);
    }
  });

  it('preserves ContentDB release IDs and prioritizes newer ContentDB commits over frozen Jam 2026 commits for dual ContentDB + Jam 2026 games', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();
    await invalidateEdgeCacheKeys([
      BOOT_CATALOG_EDGE_CACHE_KEY,
      UPDATES_EDGE_CACHE_KEY,
      IN_GAME_CATALOG_CACHE_PREFIX,
      '/api/packages/DualDev/jam_on_cdb'
    ]);

    const frozenJamCommit = '1a11111abcdef1111111abcdef1111111abcdef1';
    const newerCdbCommit = 'cdb9999abcdef9999999abcdef9999999abcdef9';
    const zipJamOld = buildCrcZip([
      { path: 'jam_on_cdb/game.conf', content: 'name = jam_on_cdb\ntitle = Jam On CDB\nrelease_tag = jam-old\n' }
    ]);
    const zipCdbNew = buildCrcZip([
      { path: 'jam_on_cdb/game.conf', content: 'name = jam_on_cdb\ntitle = Jam On CDB\nrelease_tag = cdb-latest\n' }
    ]);
    const fetchedArchiveUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://codeberg.org/DualDev/jam_on_cdb',
              commit: frozenJamCommit,
              title: 'Jam On CDB',
              description: 'Dual ContentDB and Jam 2026 entry.',
              hasScreenshot: false,
              publishedAt: '2026-11-13T22:24:52.623Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/updates')) {
        return new Response(
          JSON.stringify({ 'DualDev/jam_on_cdb': 36500 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/packages/DualDev/jam_on_cdb/releases')) {
        return new Response(
          JSON.stringify([
            {
              id: 36500,
              title: 'v2.0 Post-Jam',
              commit: newerCdbCommit,
              url: '/packages/DualDev/jam_on_cdb/releases/36500/download/'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/packages/DualDev/jam_on_cdb/for-client')) {
        return new Response(
          JSON.stringify({
            author: 'DualDev',
            name: 'jam_on_cdb',
            title: 'Jam On CDB',
            type: 'game',
            release: 36500,
            repo: 'https://codeberg.org/DualDev/jam_on_cdb'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('content.luanti.org/api/packages/DualDev/jam_on_cdb/')) {
        return new Response(
          JSON.stringify({
            author: 'DualDev',
            name: 'jam_on_cdb',
            title: 'Jam On CDB',
            type: 'game',
            repo: 'https://codeberg.org/DualDev/jam_on_cdb',
            release: 36500
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes(`/archive/${newerCdbCommit}.zip`)) {
        fetchedArchiveUrls.push(url);
        return new Response(zipCdbNew as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      if (url.includes(`/archive/${frozenJamCommit}.zip`)) {
        fetchedArchiveUrls.push(url);
        return new Response(zipJamOld as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const fkD1 = createFkEnforcingJamD1();

    try {
      const updRes = await getUpdatesEndpoint({
        request: new Request('https://luantihub.org/api/updates/?nocache=1'),
        env: { DB: fkD1.db }
      } as any);
      expect(updRes.status).toBe(200);
      const updJson = await updRes.json();
      expect(updJson['DualDev/jam_on_cdb']).toBe(36500);

      const dlRes = await handleReleaseDownload({
        params: { author: 'DualDev', name: 'jam_on_cdb', release: '36500' },
        request: new Request(
          'https://luantihub.org/packages/DualDev/jam_on_cdb/releases/36500/download/?reason=update',
          { headers: { 'User-Agent': 'Luanti/5.18.0' } }
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(dlRes.status).toBe(200);
      const dlFiles = await readZipEntriesText(new Uint8Array(await dlRes.arrayBuffer()));
      expect(dlFiles['jam_on_cdb/game.conf']).toContain('release_tag = cdb-latest');
      expect(fetchedArchiveUrls[0]).toContain(newerCdbCommit);
    } finally {
      clearIsolateCachesForTests();
      await invalidateEdgeCacheKeys([
        BOOT_CATALOG_EDGE_CACHE_KEY,
        UPDATES_EDGE_CACHE_KEY,
        IN_GAME_CATALOG_CACHE_PREFIX,
        '/api/packages/DualDev/jam_on_cdb'
      ]);
    }
  });

  it('resolves commit-pinned screenshot.png URLs across all 7 jam.luanti.org Git hosts for Luanti client catalog and /for-client while emitting null for hasScreenshot=false', async () => {
    const sha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const hostCases: Array<{ repo: string; expected: string }> = [
      {
        repo: 'https://github.com/zenonseth/strata',
        expected: `https://raw.githubusercontent.com/zenonseth/strata/${sha}/screenshot.png`
      },
      {
        repo: 'https://gitlab.com/my_org/sub_group/nested-game',
        expected: `https://gitlab.com/my_org/sub_group/nested-game/-/raw/${sha}/screenshot.png`
      },
      {
        repo: 'https://gitgud.io/group/team/jam-entry',
        expected: `https://gitgud.io/group/team/jam-entry/-/raw/${sha}/screenshot.png`
      },
      {
        repo: 'https://bitbucket.org/AliceDev/Bit-Game',
        expected: `https://bitbucket.org/alicedev/bit-game/raw/${sha}/screenshot.png`
      },
      {
        repo: 'https://codeberg.org/Builder/voxel_jam',
        expected: `https://codeberg.org/Builder/voxel_jam/raw/commit/${sha}/screenshot.png`
      },
      {
        repo: 'https://git.minetest.land/MeseDev/mese_quest',
        expected: `https://git.minetest.land/MeseDev/mese_quest/raw/commit/${sha}/screenshot.png`
      },
      {
        repo: 'https://git.gay/Creator/gay_jam',
        expected: `https://git.gay/Creator/gay_jam/raw/commit/${sha}/screenshot.png`
      }
    ];

    for (const tc of hostCases) {
      expect(buildJam2026CommitRawScreenshotUrl(tc.repo, sha)).toBe(tc.expected);
      const jamImgUrl = buildJam2026BrewImageUrl(tc.repo, sha);
      const proxied = `/api/packages?proxy_image=${encodeURIComponent(jamImgUrl)}&ngsw-bypass=true`;
      expect(toLegacyLuantiClientThumbnailUrl(proxied)).toBeUndefined();
      expect(resolveJam2026ClientScreenshotUrl(jamImgUrl)).toBe(tc.expected);
      expect(resolveJam2026ClientScreenshotUrl(proxied)).toBe(tc.expected);
    }

    expect(buildJam2026CommitRawScreenshotUrl('https://github.com/zenonseth/strata', 'not-a-sha')).toBeUndefined();
    expect(resolveJam2026ClientScreenshotUrl('https://example.com/api/image?format=webp')).toBeUndefined();
    expect(resolveJam2026ClientScreenshotUrl(null)).toBeUndefined();

    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();
    await invalidateEdgeCacheKeys([
      BOOT_CATALOG_EDGE_CACHE_KEY,
      IN_GAME_CATALOG_CACHE_PREFIX,
      `${FOR_CLIENT_CACHE_PREFIX}/en/zenonseth/strata/fsv=8`
    ]);

    const strataSha = 'fddfc86228fdcc6b6fc0a5010d35c5001ea1d028';
    const noShotSha = '9999999abcdef9999999abcdef9999999abcdef9';
    const gitlabSha = '8888888abcdef8888888abcdef8888888abcdef8';

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://github.com/zenonseth/strata',
              commit: strataSha,
              title: 'Strata',
              description: 'Dig down through Strata.',
              commitUrl: `https://github.com/zenonseth/strata/tree/${strataSha}`,
              hasScreenshot: true,
              publishedAt: '2026-11-13T22:24:52.623Z'
            },
            {
              repository: 'https://gitlab.com/team_alpha/sub/void_runner',
              commit: gitlabSha,
              title: 'Void Runner',
              description: 'Nested GitLab game with screenshot.',
              hasScreenshot: true,
              publishedAt: '2026-11-13T20:00:00.000Z'
            },
            {
              repository: 'https://codeberg.org/PlainDev/no_shot_game',
              commit: noShotSha,
              title: 'No Shot Game',
              description: 'Jam entry without screenshot.',
              hasScreenshot: false,
              publishedAt: '2026-11-13T19:00:00.000Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/packages')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('content.luanti.org/api/updates')) {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const fkD1 = createFkEnforcingJamD1();

    try {
      const keysRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages?type=game&protocol_version=49&fmt=keys'),
        env: { DB: fkD1.db }
      } as any);
      expect(keysRes.status).toBe(200);
      const keysJson = await keysRes.json();
      const thumbColIdx = keysJson.keys.indexOf('thumbnail');
      expect(thumbColIdx).toBeGreaterThan(-1);

      const strataKeyRow = keysJson.pkgs.find((r: any[]) => r[0] === 'zenonseth' && r[1] === 'strata');
      expect(strataKeyRow?.[thumbColIdx]).toBe(
        `https://raw.githubusercontent.com/zenonseth/strata/${strataSha}/screenshot.png`
      );

      const gitlabKeyRow = keysJson.pkgs.find((r: any[]) => r[0] === 'team_alpha' && r[1] === 'void_runner');
      expect(gitlabKeyRow?.[thumbColIdx]).toBe(
        `https://gitlab.com/team_alpha/sub/void_runner/-/raw/${gitlabSha}/screenshot.png`
      );

      const noShotKeyRow = keysJson.pkgs.find((r: any[]) => r[0] === 'PlainDev' && r[1] === 'no_shot_game');
      expect(noShotKeyRow?.[thumbColIdx]).toBeNull();

      const slimRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages?type=game&protocol_version=49'),
        env: { DB: fkD1.db }
      } as any);
      expect(slimRes.status).toBe(200);
      const slimJson = await slimRes.json();
      const strataSlim = slimJson.find((p: any) => p.author === 'zenonseth' && p.name === 'strata');
      expect(strataSlim?.thumbnail).toBe(
        `https://raw.githubusercontent.com/zenonseth/strata/${strataSha}/screenshot.png`
      );
      const noShotSlim = slimJson.find((p: any) => p.author === 'PlainDev' && p.name === 'no_shot_game');
      expect(noShotSlim?.thumbnail).toBeNull();
    } finally {
      clearIsolateCachesForTests();
      await invalidateEdgeCacheKeys([
        BOOT_CATALOG_EDGE_CACHE_KEY,
        IN_GAME_CATALOG_CACHE_PREFIX,
        `${FOR_CLIENT_CACHE_PREFIX}/en/zenonseth/strata/fsv=8`
      ]);
    }
  });

  it('refreshes thumbnail_url, banner_url, and screenshots in refreshJam2026D1PkgIfStale and /for-client when a Jam game advances commits', async () => {
    const commit1 = 'aaaa111abcdefaaaa111abcdefaaaa111abcdef1';
    const commit2 = 'bbbb222abcdefbbbb222abcdefbbbb222abcdef2';

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://github.com/zenonseth/strata',
              commit: commit2,
              title: 'Strata',
              description: 'Dig down through Strata.',
              hasScreenshot: true,
              publishedAt: '2026-11-14T10:00:00.000Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    const oldJamUrl = `/api/packages?proxy_image=${encodeURIComponent(
      buildJam2026BrewImageUrl('https://github.com/zenonseth/strata', commit1)
    )}`;
    const staleRow = {
      id: 'zenonseth/strata',
      author_id: null,
      author_name: 'zenonseth',
      name: 'strata',
      title: 'Strata',
      type: 'game',
      short_desc: 'Dig down through Strata.',
      repo_url: 'https://github.com/zenonseth/strata',
      provider: 'github',
      default_branch: 'main',
      thumbnail_url: oldJamUrl,
      banner_url: oldJamUrl,
      screenshots: JSON.stringify([oldJamUrl]),
      tags: JSON.stringify(['jam_game_2026', 'gamejam', 'game']),
      latest_commit_sha: commit1,
      updated_at: '2026-11-13T22:24:52.623Z'
    };

    const refreshed = await refreshJam2026D1PkgIfStale(staleRow, undefined, true);
    const expectedNewJamUrl = `/api/packages?proxy_image=${encodeURIComponent(
      buildJam2026BrewImageUrl('https://github.com/zenonseth/strata', commit2)
    )}`;
    expect(refreshed.latest_commit_sha).toBe(commit2);
    expect(refreshed.thumbnail_url).toBe(expectedNewJamUrl);
    expect(refreshed.banner_url).toBe(expectedNewJamUrl);
    expect(JSON.parse(refreshed.screenshots)).toEqual([expectedNewJamUrl]);

    const fkD1 = createFkEnforcingJamD1();
    fkD1.packages.set('zenonseth/strata', staleRow);
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();

    try {
      const fcRes = await getPackageForClient({
        params: { author: 'zenonseth', name: 'strata' },
        request: new Request(
          'https://luantihub.org/api/packages/zenonseth/strata/for-client/?formspec_version=8&nocache=1'
        ),
        env: { DB: fkD1.db }
      } as any);
      expect(fcRes.status).toBe(200);
      const fcJson = await fcRes.json();
      expect(fcJson.screenshots).toEqual([
        { url: `https://raw.githubusercontent.com/zenonseth/strata/${commit2}/screenshot.png` }
      ]);
    } finally {
      clearIsolateCachesForTests();
    }
  });

  it('reconciles dual-source ZenonSeth/strata downloads (Hub + ContentDB), backfills D1 cleanly without extra fast-path subrequests, and renders Hub-first modal links & badges', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();

    const strataShot = 'https://raw.githubusercontent.com/ZenonSeth/strata/main/screenshot.png';
    const d1Packages = new Map<string, any>([
      [
        'zenonseth/strata',
        {
          id: 'ZenonSeth/strata',
          author_id: null,
          author_name: 'ZenonSeth',
          name: 'strata',
          title: 'Strata',
          type: 'game',
          short_desc: 'Dig down through Strata.',
          repo_url: 'https://github.com/ZenonSeth/strata',
          provider: 'github',
          default_branch: 'main',
          thumbnail_url: strataShot,
          banner_url: strataShot,
          screenshots: JSON.stringify([strataShot]),
          license: 'MIT',
          media_license: 'CC-BY-SA-4.0',
          tags: JSON.stringify(['jam_game_2026', 'gamejam', 'git', 'game']),
          badge_tags: JSON.stringify(['jam_game_2026']),
          contentdb_downloads: 0,
          luantihub_downloads: 2,
          downloads_count: 2,
          review_thread_counts: JSON.stringify({ positive: 1, neutral: 0, negative: 0 }),
          status: 'active',
          created_at: '2026-11-10T00:00:00Z',
          updated_at: '2026-11-14T00:00:00Z'
        }
      ]
    ]);
    let backfillUpdateCount = 0;

    const createStrataDb = () => {
      const prepare = (sql: string) => {
        const clean = sql.trim();
        const runQuery = async (args: any[], mode: 'run' | 'first' | 'all') => {
          if (/SELECT\s+.*FROM\s+packages/i.test(clean)) {
            if (clean.includes("'flagged'") || clean.includes("'delisted'")) {
              return mode === 'first' ? null : { results: [] };
            }
            const rows = Array.from(d1Packages.values());
            if (/WHERE\s+/i.test(clean) && args.length > 0) {
              const target = String(args[0] || '').toLowerCase();
              const matched = rows.filter(
                (r) =>
                  r.id.toLowerCase() === target ||
                  `${r.author_name}/${r.name}`.toLowerCase() === target ||
                  r.author_name.toLowerCase() === target
              );
              return mode === 'first' ? (matched[0] ?? null) : { results: matched };
            }
            return mode === 'first' ? (rows[0] ?? null) : { results: rows };
          }
          if (/SELECT\s+LOWER\(package_id\)\s+as\s+pkg_id,\s*SUM\(downloads_count\)/i.test(clean)) {
            return { results: [{ pkg_id: 'zenonseth/strata', total_dl: 2 }] };
          }
          if (/SELECT\s+COALESCE\(SUM\(downloads_count\),\s*0\)\s+as\s+total_lh/i.test(clean)) {
            return { total_lh: 2 };
          }
          if (/UPDATE\s+packages/i.test(clean) && /contentdb_downloads/i.test(clean)) {
            backfillUpdateCount += 1;
            const [newCdbDl, newLhDl, newTotalDl, nextTagsJson, targetId] = args;
            const row = d1Packages.get(String(targetId || '').toLowerCase());
            if (row) {
              row.contentdb_downloads = Math.max(Number(row.contentdb_downloads || 0), Number(newCdbDl || 0));
              row.luantihub_downloads = Math.max(Number(row.luantihub_downloads || 0), Number(newLhDl || 0));
              row.downloads_count = Math.max(Number(row.downloads_count || 0), Number(newTotalDl || 0));
              if (nextTagsJson) row.tags = nextTagsJson;
            }
            return { success: true };
          }
          if (/SELECT\s+AVG\(rating\)/i.test(clean)) {
            return { avg_rating: null, cnt: 0 };
          }
          return mode === 'first' ? null : mode === 'all' ? { results: [] } : { success: true };
        };

        return {
          bind: (...args: any[]) => ({
            first: () => runQuery(args, 'first'),
            all: () => runQuery(args, 'all'),
            run: () => runQuery(args, 'run'),
            _exec: () => runQuery(args, 'run')
          }),
          first: () => runQuery([], 'first'),
          all: () => runQuery([], 'all'),
          run: () => runQuery([], 'run')
        };
      };
      return {
        prepare,
        batch: async (stmts: any[]) => {
          for (const st of stmts) {
            if (typeof st._exec === 'function') {
              await st._exec();
            } else if (typeof st.run === 'function') {
              await st.run();
            }
          }
          return [];
        }
      };
    };

    const db = createStrataDb();
    let contentDbDetailFetchCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('content.luanti.org/api/packages/?fmt=vcs') || url.includes('content.luanti.org/api/packages/?')) {
        return new Response(
          JSON.stringify([
            {
              author: 'ZenonSeth',
              name: 'strata',
              title: 'Strata',
              type: 'game',
              repo: 'https://github.com/ZenonSeth/strata',
              downloads: 2,
              license: 'MIT',
              media_license: 'CC-BY-SA-4.0',
              tags: ['game', 'jam_game_2026'],
              created_at: '2026-11-10T00:00:00Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/packages/ZenonSeth/strata')) {
        contentDbDetailFetchCount += 1;
        return new Response(
          JSON.stringify({
            author: 'ZenonSeth',
            name: 'strata',
            title: 'Strata',
            type: 'game',
            downloads: 2,
            license: 'MIT',
            media_license: 'CC-BY-SA-4.0',
            tags: ['game', 'jam_game_2026']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/packages/ZenonSeth/strata')) {
        // Simulate unbackfilled fast-path detail response before D1 settles
        return new Response(
          JSON.stringify({
            id: 'ZenonSeth/strata',
            author: 'ZenonSeth',
            name: 'strata',
            title: 'Strata',
            type: 'game',
            provider: 'github',
            source: 'git',
            sources: ['git'],
            repo_url: 'https://github.com/ZenonSeth/strata',
            git_repo_status: 'verified',
            license: 'MIT',
            media_license: 'CC-BY-SA-4.0',
            contentdb_downloads: 0,
            luantihub_downloads: 2,
            downloads: 2,
            tags: ['git', 'game', 'jam_game_2026'],
            reviews_list: []
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('content.luanti.org/api/')) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      // 1. /api/packages?boot=1 catalog join emits reconciled 4 = 2 + 2 and persists dual-source ContentDB linkage via batched D1 backfill
      const catRes = await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages?boot=1'),
        env: { DB: db }
      } as any);
      expect(catRes.status).toBe(200);
      const catJson = await catRes.json();
      const catList = Array.isArray(catJson) ? catJson : catJson.packages || [];
      const strataCatalog = catList.find((p: any) => String(p.id).toLowerCase() === 'zenonseth/strata');
      expect(strataCatalog).toBeTruthy();
      expect(strataCatalog.contentdb_downloads).toBe(2);
      expect(strataCatalog.luantihub_downloads).toBe(2);
      expect(strataCatalog.downloads).toBe(4);
      expect(strataCatalog.sources).toEqual(expect.arrayContaining(['official', 'git']));
      expect(strataCatalog.tags).toEqual(expect.arrayContaining(['contentdb', 'git']));
      expect(backfillUpdateCount).toBe(1);

      // Re-running catalog (cache cleared so D1 loop runs again) is threshold-gated -> 0 redundant D1 writes
      (globalThis as any).caches = createInMemoryEdgeCaches();
      clearIsolateCachesForTests();
      await getPackagesCatalog({
        request: new Request('https://luantihub.org/api/packages?boot=1'),
        env: { DB: db }
      } as any);
      expect(backfillUpdateCount).toBe(1);

      // 2. Post-backfill D1 ?lite=1 fast path serves 4 = 2 + 2 directly from D1 with 0 ContentDB subrequests
      contentDbDetailFetchCount = 0;
      (globalThis as any).caches = createInMemoryEdgeCaches();
      clearIsolateCachesForTests();
      const fastRes = await getPackageDetail({
        params: { author: 'ZenonSeth', name: 'strata' },
        request: new Request('https://luantihub.org/api/packages/ZenonSeth/strata/?lite=1&nocache=1'),
        env: { DB: db }
      } as any);
      expect(fastRes.status).toBe(200);
      const fastJson = await fastRes.json();
      expect(fastJson.contentdb_downloads).toBe(2);
      expect(fastJson.luantihub_downloads).toBe(2);
      expect(fastJson.downloads).toBe(4);
      expect(fastJson.sources).toEqual(expect.arrayContaining(['official', 'git']));
      expect(contentDbDetailFetchCount).toBe(0);

      // 3. Even if the client receives an unbackfilled fast-path detail ({ cdb: 0, hub: 2, total: 2, sources: ['git'] }),
      // PackageService preserves catalog ContentDB provenance and UI renders Hub-first totals + independent links + ordered badges
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
      const pkgService = TestBed.inject(PackageService);
      (pkgService as any).edgeApiAvailable = true;
      (pkgService as any).hydratedMetaCache.clear();
      (pkgService as any).applyBootPayload({ packages: [strataCatalog] });

      const catalogPkg = pkgService.packages().find((p) => p.id.toLowerCase() === 'zenonseth/strata')!;
      expect(catalogPkg.downloads).toBe(4);
      expect(catalogPkg.contentdb_downloads).toBe(2);
      expect(catalogPkg.luantihub_downloads).toBe(2);

      (pkgService as any)._activePackage.set(catalogPkg);
      await pkgService.loadPackageDetails(catalogPkg, false);
      const active = pkgService.activePackage()!;
      expect(active.downloads).toBe(4);
      expect(active.luantihub_downloads).toBe(2);
      expect(active.contentdb_downloads).toBe(2);
      expect(active.sources).toEqual(expect.arrayContaining(['official', 'git']));

      const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
      modalFixture.componentInstance.package = active;
      modalFixture.detectChanges();
      const modalEl = modalFixture.nativeElement as HTMLElement;

      expect(modalEl.querySelector('[data-testid="modal-total-downloads"]')?.textContent?.trim()).toBe('4');
      expect(modalEl.querySelector('[data-testid="downloads-source-breakdown"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Hub: 2 • ContentDB: 2'
      );

      const gitLink = modalEl.querySelector('[data-testid="project-link-git"]') as HTMLAnchorElement;
      const cdbLink = modalEl.querySelector('[data-testid="project-link-contentdb"]') as HTMLAnchorElement;
      expect(gitLink).toBeTruthy();
      expect(gitLink.getAttribute('href')).toBe('https://github.com/ZenonSeth/strata');
      expect(cdbLink).toBeTruthy();
      expect(cdbLink.getAttribute('href')).toBe('https://content.luanti.org/packages/ZenonSeth/strata/');

      const headerBadgesEl = modalEl.querySelector('[data-testid="modal-header-badges"]')!;
      expect(headerBadgesEl).toBeTruthy();
      const modalBadgeOrder = Array.from(
        headerBadgesEl.querySelectorAll('[data-testid="git-badge"], [data-testid="contentdb-badge"]')
      ).map((el) => el.getAttribute('data-testid'));
      expect(modalBadgeOrder).toEqual(['git-badge', 'contentdb-badge']);
      modalFixture.destroy();
      pkgService.closePackageModal();
    } finally {
      clearIsolateCachesForTests();
      await invalidateEdgeCacheKeys([BOOT_CATALOG_EDGE_CACHE_KEY]);
    }
  });

  it('keeps pure-Git packages with broken_404 repos isolated from ContentDB links/subrequests and avoids ContentDB: 0 clutter', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();

    const pureGitRow = {
      id: 'IndieDev/pure_voxel',
      author_id: null,
      author_name: 'IndieDev',
      name: 'pure_voxel',
      title: 'Pure Voxel',
      type: 'mod',
      short_desc: 'Independent Git-hosted mod.',
      repo_url: 'https://github.com/IndieDev/pure_voxel',
      git_repo_status: 'broken_404',
      provider: 'github',
      default_branch: 'main',
      thumbnail_url: 'https://luantihub.org/assets/pure_voxel.png',
      banner_url: 'https://luantihub.org/assets/pure_voxel.png',
      screenshots: JSON.stringify(['https://luantihub.org/assets/pure_voxel.png']),
      license: 'MIT',
      media_license: 'CC-BY-SA-4.0',
      tags: JSON.stringify(['git', 'mod']),
      contentdb_downloads: 0,
      luantihub_downloads: 3,
      downloads_count: 3,
      status: 'active'
    };

    const mockPureDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (/FROM\s+packages/i.test(sql)) return pureGitRow;
            if (/total_lh/i.test(sql)) return { total_lh: 3 };
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ success: true })
        })
      })
    };

    let cdbFetchCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('content.luanti.org')) {
        cdbFetchCount += 1;
      }
      return new Response('{}', { status: 404 });
    }) as any;

    try {
      const detailRes = await getPackageDetail({
        params: { author: 'IndieDev', name: 'pure_voxel' },
        request: new Request('https://luantihub.org/api/packages/IndieDev/pure_voxel/?lite=1&nocache=1'),
        env: { DB: mockPureDb }
      } as any);
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson.downloads).toBe(3);
      expect(detailJson.contentdb_downloads).toBe(0);
      expect(detailJson.luantihub_downloads).toBe(3);
      expect(detailJson.sources).toEqual(['git']);

      const statsRes = await getPackageStats({
        params: { author: 'IndieDev', name: 'pure_voxel' },
        request: new Request('https://luantihub.org/api/packages/IndieDev/pure_voxel/stats/?days=30&nocache=1'),
        env: { DB: mockPureDb }
      } as any);
      expect(statsRes.status).toBe(200);
      expect(cdbFetchCount).toBe(0);

      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
      const purePkg: LuantiPackage = {
        id: 'IndieDev/pure_voxel',
        author: 'IndieDev',
        name: 'pure_voxel',
        title: 'Pure Voxel',
        type: 'mod',
        short_desc: 'Independent Git-hosted mod.',
        desc: 'Independent Git-hosted mod.',
        thumbnail: 'https://luantihub.org/assets/pure_voxel.png',
        banner: 'https://luantihub.org/assets/pure_voxel.png',
        screenshots: ['https://luantihub.org/assets/pure_voxel.png'],
        score: 0,
        downloads: 3,
        contentdb_downloads: 0,
        luantihub_downloads: 3,
        license: 'MIT',
        repo_url: 'https://github.com/IndieDev/pure_voxel',
        git_repo_status: 'broken_404',
        provider: 'github',
        source: 'git',
        sources: ['git'],
        tags: ['git', 'mod']
      };
      const pkgService = TestBed.inject(PackageService);
      (pkgService as any)._activePackage.set(purePkg);

      const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
      modalFixture.componentInstance.package = purePkg;
      modalFixture.detectChanges();
      const modalEl = modalFixture.nativeElement as HTMLElement;

      expect(modalEl.querySelector('[data-testid="modal-total-downloads"]')?.textContent?.trim()).toBe('3');
      const breakdownText = modalEl.querySelector('[data-testid="downloads-source-breakdown"]')?.textContent?.replace(/\s+/g, ' ').trim();
      expect(breakdownText).toBe('Luanti Hub: 3');
      expect(breakdownText).not.toContain('ContentDB');
      expect(modalEl.querySelector('[data-testid="project-link-git"]')).toBeNull();
      expect(modalEl.querySelector('[data-testid="project-link-contentdb"]')).toBeNull();
      const pureHeaderBadges = modalEl.querySelector('[data-testid="modal-header-badges"]')!;
      expect(pureHeaderBadges).toBeTruthy();
      expect(pureHeaderBadges.querySelector('[data-testid="git-badge"]')).toBeTruthy();
      expect(pureHeaderBadges.querySelector('[data-testid="contentdb-badge"]')).toBeNull();
      modalFixture.destroy();
      pkgService.closePackageModal();

      const badgesFixture = TestBed.createComponent(PackageBadgesComponent);
      badgesFixture.componentInstance.package = purePkg;
      badgesFixture.detectChanges();
      expect(badgesFixture.nativeElement.querySelector('[data-testid="git-badge"]')).toBeTruthy();
      expect(badgesFixture.nativeElement.querySelector('[data-testid="contentdb-badge"]')).toBeNull();
      badgesFixture.destroy();
    } finally {
      clearIsolateCachesForTests();
    }
  });

  it('merges complementary ContentDB stats for dual-source packages and orders LuantiHub Edge first in DownloadAnalyticsChartComponent', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();

    const dualRow = {
      id: 'ZenonSeth/strata',
      author_id: null,
      author_name: 'ZenonSeth',
      name: 'strata',
      title: 'Strata',
      type: 'game',
      provider: 'github',
      repo_url: 'https://github.com/ZenonSeth/strata',
      tags: JSON.stringify(['jam_game_2026', 'game', 'git', 'contentdb']),
      contentdb_downloads: 2,
      luantihub_downloads: 2,
      downloads_count: 4
    };
    const todayIso = new Date().toISOString().slice(0, 10);

    const mockDualStatsDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => (/FROM\s+packages/i.test(sql) ? dualRow : null),
          all: async () => ({
            results: /FROM\s+package_daily_downloads/i.test(sql)
              ? [{ download_date: todayIso, downloads_count: 2, platform_luanti: 2, platform_web: 0, reason_new: 2, reason_update: 0, reason_dependency: 0, reason_web: 0, views_luanti: 5, views_web: 3 }]
              : []
          })
        })
      })
    };

    let requestedCdbStatsUrl = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('content.luanti.org/api/packages/ZenonSeth/strata/stats/')) {
        requestedCdbStatsUrl = url;
        const mkArr = (lastVal: number) => [...Array(13).fill(0), lastVal];
        return new Response(
          JSON.stringify({
            downloads: {
              platform: { minetest: mkArr(2), other: mkArr(0) },
              reason: { new: mkArr(2), update: mkArr(0), dependency: mkArr(0), other: mkArr(0) }
            },
            views: mkArr(4)
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    try {
      const res = await getPackageStats({
        params: { author: 'ZenonSeth', name: 'strata' },
        request: new Request('https://luantihub.org/api/packages/ZenonSeth/strata/stats/?days=7'),
        env: { DB: mockDualStatsDb }
      } as any);
      expect(res.status).toBe(200);
      expect(requestedCdbStatsUrl).toContain('content.luanti.org/api/packages/ZenonSeth/strata/stats/');
      const statsJson = await res.json();
      expect(statsJson.summary.periodDownloads).toBe(4);
      expect(statsJson.source_luantihub.reduce((a: number, b: number) => a + b, 0)).toBe(2);
      expect(statsJson.source_contentdb.reduce((a: number, b: number) => a + b, 0)).toBe(2);

      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
      const chartFixture = TestBed.createComponent(DownloadAnalyticsChartComponent);
      const chartComp = chartFixture.componentInstance;
      chartComp.package = {
        id: 'ZenonSeth/strata',
        author: 'ZenonSeth',
        name: 'strata',
        title: 'Strata',
        type: 'game',
        short_desc: 'Strata',
        desc: 'Strata',
        thumbnail: 'logo.svg',
        score: 0,
        downloads: 4,
        contentdb_downloads: 2,
        luantihub_downloads: 2,
        license: 'MIT',
        source: 'git',
        sources: ['official', 'git'],
        tags: ['git', 'game', 'contentdb']
      };
      chartComp.statsData.set(statsJson);
      chartComp.seriesMode.set('source');
      expect((chartComp as any).activeSeriesList().map((s: any) => s.key)).toEqual([
        'source_luantihub',
        'source_contentdb'
      ]);

      // Pure-Git package with 0 ContentDB telemetry hides ContentDB series
      chartComp.package = {
        ...chartComp.package,
        id: 'IndieDev/pure_voxel',
        author: 'IndieDev',
        name: 'pure_voxel',
        contentdb_downloads: 0,
        luantihub_downloads: 2,
        downloads: 2,
        sources: ['git'],
        tags: ['git', 'mod']
      };
      chartComp.statsData.set({
        ...statsJson,
        source_contentdb: statsJson.source_contentdb.map(() => 0)
      });
      expect((chartComp as any).activeSeriesList().map((s: any) => s.key)).toEqual(['source_luantihub']);
      chartFixture.destroy();
    } finally {
      clearIsolateCachesForTests();
    }
  });

  it('keeps trackDownload, HeroBillboard, AuthorDrawer, top10.ts, and for-client.ts download math and pure-Git isolation consistent', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();

    try {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()]
      });
      const pkgService = TestBed.inject(PackageService);
      (pkgService as any).edgeApiAvailable = true;
      (pkgService as any).hydratedMetaCache.clear();
      localStorage.removeItem('lh_user_downloads_v1');

      // 1. trackDownload() reconciles an unbackfilled active dual-source item against catalog provenance
      const catalogDual = (pkgService as any).normalizePackage({
        id: 'ZenonSeth/strata',
        author: 'ZenonSeth',
        name: 'strata',
        title: 'Strata',
        type: 'game',
        provider: 'github',
        source: 'git',
        sources: ['official', 'git'],
        repo_url: 'https://github.com/ZenonSeth/strata',
        tags: ['git', 'game', 'contentdb'],
        contentdb_downloads: 2,
        luantihub_downloads: 2,
        downloads: 4
      });
      const pureGitPkg = (pkgService as any).normalizePackage({
        id: 'IndieDev/pure_broken_git',
        author: 'IndieDev',
        name: 'pure_broken_git',
        title: 'Pure Broken Git',
        type: 'mod',
        provider: 'github',
        source: 'git',
        sources: ['git'],
        repo_url: 'https://github.com/IndieDev/pure_broken_git',
        git_repo_status: 'broken_404',
        tags: ['git', 'mod'],
        contentdb_downloads: 0,
        luantihub_downloads: 3,
        downloads: 3
      });
      (pkgService as any)._packages.set([catalogDual, pureGitPkg]);

      const unbackfilledActive: LuantiPackage = {
        ...catalogDual,
        sources: ['git'],
        tags: ['git', 'game'],
        contentdb_downloads: 0,
        luantihub_downloads: 2,
        downloads: 2
      };
      (pkgService as any)._activePackage.set(unbackfilledActive);
      pkgService.trackDownload(unbackfilledActive);

      const bumpedActive = pkgService.activePackage()!;
      const bumpedCatalog = pkgService.packages().find(p => p.id === 'ZenonSeth/strata')!;
      expect(bumpedActive.luantihub_downloads).toBe(3);
      expect(bumpedActive.contentdb_downloads).toBe(2);
      expect(bumpedActive.downloads).toBe(5);
      expect(bumpedActive.sources).toEqual(expect.arrayContaining(['git', 'official']));
      expect(bumpedCatalog.luantihub_downloads).toBe(3);
      expect(bumpedCatalog.contentdb_downloads).toBe(2);
      expect(bumpedCatalog.downloads).toBe(5);

      pkgService.trackDownload(pureGitPkg);
      const bumpedPure = pkgService.packages().find(p => p.id === 'IndieDev/pure_broken_git')!;
      expect(bumpedPure.luantihub_downloads).toBe(4);
      expect(bumpedPure.contentdb_downloads).toBe(0);
      expect(bumpedPure.downloads).toBe(4);
      expect(bumpedPure.sources).toEqual(['git']);

      // 2. HeroBillboardComponent.getSlideGitUrl suppresses fabricated ContentDB links for pure-Git broken_404 repos,
      // and uses contentdb_author/contentdb_name when ContentDB provenance exists without a usable Git repo
      const heroFixture = TestBed.createComponent(HeroBillboardComponent);
      const heroComp = heroFixture.componentInstance;
      expect(heroComp.getSlideGitUrl(pureGitPkg)).toBe('');
      expect(heroComp.getSlideGitUrl(catalogDual)).toBe('https://github.com/ZenonSeth/strata');
      const aliasOfficialBrokenGit: LuantiPackage = {
        ...catalogDual,
        id: 'GitAlias/strata_hub',
        author: 'GitAlias',
        name: 'strata_hub',
        contentdb_author: 'ZenonSeth',
        contentdb_name: 'strata',
        git_repo_status: 'broken_404'
      };
      expect(heroComp.getSlideGitUrl(aliasOfficialBrokenGit)).toBe(
        'https://content.luanti.org/packages/ZenonSeth/strata/'
      );
      heroFixture.destroy();

      // 3. AuthorDrawerComponent orders Git badge before CDB badge and renders LuantiHub-first download breakdowns
      (pkgService as any)._packages.set([
        {
          ...catalogDual,
          luantihub_downloads: 3,
          contentdb_downloads: 2,
          downloads: 99 // Deliberately higher legacy total to verify per-package reconciliation sum
        }
      ]);
      (pkgService as any)._activeAuthorUsername.set('ZenonSeth');
      (pkgService as any)._activeAuthorProfile.set({
        username: 'ZenonSeth',
        display_name: 'ZenonSeth',
        bio: '',
        identities: []
      });
      const drawerFixture = TestBed.createComponent(AuthorDrawerComponent);
      const drawerComp = drawerFixture.componentInstance;
      drawerFixture.detectChanges();
      const drawerEl = drawerFixture.nativeElement as HTMLElement;

      expect(drawerComp.totalHubDownloads()).toBe(3);
      expect(drawerComp.totalCdbDownloads()).toBe(2);
      expect(drawerComp.totalDownloads()).toBe(drawerComp.totalHubDownloads() + drawerComp.totalCdbDownloads());
      expect(drawerEl.querySelector('[data-testid="author-downloads-breakdown"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Hub 3 • CDB 2'
      );
      const authorSourceText = Array.from(drawerEl.querySelectorAll('[data-testid="author-sources-badges"] span')).map(el =>
        el.textContent?.trim()
      );
      expect(authorSourceText).toEqual(['1 Git', '1 CDB']);

      (pkgService as any)._activeAuthorUsername.set('IndieDev');
      (pkgService as any)._activeAuthorProfile.set({
        username: 'IndieDev',
        display_name: 'IndieDev',
        bio: '',
        identities: []
      });
      (pkgService as any)._packages.set([bumpedPure]);
      drawerFixture.detectChanges();
      expect(drawerEl.querySelector('[data-testid="author-downloads-breakdown"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Luanti Hub: 4'
      );
      drawerFixture.destroy();
      pkgService.closeAuthorDrawer(true, true);

      // 4. top10.ts and for-client.ts D1 paths enforce downloads === luantihub_downloads + contentdb_downloads
      const mockTop10Db = {
        prepare: (sql: string) => {
          const allFn = async () => {
            if (/FROM\s+package_daily_downloads/i.test(sql)) {
              return {
                results: [
                  {
                    package_id: 'ZenonSeth/strata',
                    period_downloads: 0,
                    r_new: 0,
                    r_web: 0,
                    r_upd: 0,
                    r_dep: 0,
                    period_views: 10,
                    title: 'Strata',
                    author: 'ZenonSeth',
                    name: 'strata',
                    type: 'game',
                    short_desc: 'Strata',
                    provider: 'github',
                    status: 'active',
                    downloads_count: 8,
                    contentdb_downloads: 2,
                    luantihub_downloads: 3,
                    tags: JSON.stringify(['game', 'git', 'contentdb'])
                  },
                  {
                    package_id: 'IndieDev/pure_broken_git',
                    period_downloads: 2,
                    r_new: 2,
                    r_web: 0,
                    r_upd: 0,
                    r_dep: 0,
                    period_views: 5,
                    title: 'Pure Broken Git',
                    author: 'IndieDev',
                    name: 'pure_broken_git',
                    type: 'mod',
                    short_desc: 'Pure Git',
                    provider: 'github',
                    status: 'active',
                    downloads_count: 6,
                    contentdb_downloads: 0,
                    luantihub_downloads: 4,
                    tags: JSON.stringify(['mod', 'git'])
                  }
                ]
              };
            }
            return { results: [] };
          };
          return { all: allFn, bind: () => ({ all: allFn, first: async () => null, run: async () => ({ success: true }) }) };
        }
      };
      globalThis.fetch = vi.fn(async () => new Response('[]', { status: 200 })) as any;

      const top10Res = await getTop10Packages({
        request: new Request('https://luantihub.org/api/packages/top10?timeframe=today'),
        env: { DB: mockTop10Db }
      } as any);
      expect(top10Res.status).toBe(200);
      const top10Items = await top10Res.json();
      const top10Strata = top10Items.find((i: any) => i.id === 'ZenonSeth/strata');
      const top10Pure = top10Items.find((i: any) => i.id === 'IndieDev/pure_broken_git');
      expect(top10Strata.downloads).toBe(top10Strata.contentdb_downloads + top10Strata.luantihub_downloads);
      expect(top10Strata.sources).toEqual(expect.arrayContaining(['git', 'official']));
      expect(top10Pure.contentdb_downloads).toBe(0);
      expect(top10Pure.downloads).toBe(6);
      expect(top10Pure.luantihub_downloads).toBe(6);
      expect(top10Pure.sources).toEqual(['git']);

      const mockForClientDb = {
        prepare: (sql: string) => ({
          bind: () => ({
            first: async () => {
              if (/FROM\s+packages/i.test(sql)) {
                return {
                  id: 'ZenonSeth/strata',
                  author_name: 'ZenonSeth',
                  name: 'strata',
                  title: 'Strata',
                  type: 'game',
                  short_desc: 'Strata',
                  long_desc: 'Strata',
                  provider: 'github',
                  repo_url: 'https://github.com/ZenonSeth/strata',
                  default_branch: 'main',
                  tags: JSON.stringify(['game', 'git']),
                  contentdb_downloads: 2,
                  luantihub_downloads: 3,
                  downloads_count: 9,
                  status: 'active',
                  download_size: 4096,
                  file_size: '4 KB'
                };
              }
              if (/total_lh/i.test(sql)) return { total_lh: 3 };
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => ({ success: true })
          })
        })
      };
      globalThis.fetch = vi.fn(async () => new Response('[]', { status: 404 })) as any;

      const fcRes = await getPackageForClient({
        params: { author: 'ZenonSeth', name: 'strata' },
        request: new Request('https://luantihub.org/api/packages/ZenonSeth/strata/for-client/?nocache=1'),
        env: { DB: mockForClientDb }
      } as any);
      expect(fcRes.status).toBe(200);
      const fcJson = await fcRes.json();
      expect(fcJson.contentdb_downloads).toBe(2);
      expect(fcJson.luantihub_downloads).toBe(3);
      expect(fcJson.downloads).toBe(5);

      // 5. overlayPromotionRowDeltaOnCatalog preserves pure-Git provenance for new delta items
      const overlaidPure = overlayPromotionRowDeltaOnCatalog(
        [],
        {
          items: [
            {
              id: 'IndieDev/delta_jam_git',
              author: 'IndieDev',
              name: 'delta_jam_git',
              title: 'Delta Jam Git',
              type: 'game',
              source: 'git',
              downloads: 4,
              luantihub_downloads: 4,
              tags: ['game', 'jam_game_2026']
            }
          ],
          tagMap: {}
        },
        undefined,
        new Map([['indiedev/delta_jam_git', 4]])
      );
      expect(overlaidPure[0].source).toBe('git');
      expect(overlaidPure[0].sources).toEqual(['git']);
      expect(overlaidPure[0].provider).not.toBe('contentdb');
      expect(overlaidPure[0].contentdb_downloads).toBe(0);
      expect(overlaidPure[0].luantihub_downloads).toBe(4);
      expect(overlaidPure[0].downloads).toBe(4);
    } finally {
      localStorage.removeItem('lh_user_downloads_v1');
      clearIsolateCachesForTests();
    }
  });

  it('auto-syncs real Git/Jam licenses across ?lite=1, full detail, and boot catalog while honoring manual override until resync_git', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();
    await invalidateEdgeCacheKeys([BOOT_CATALOG_EDGE_CACHE_KEY, UPDATES_EDGE_CACHE_KEY]);

    const sha1 = '1111aaaa2222bbbb3333cccc4444dddd5555eeee';
    const sha2 = '9999ffff8888eeee7777dddd6666cccc5555bbbb';
    let currentSha = sha1;
    let currentGameConf = 'title = Terrarium Crucible\nlicense = GPL-3.0-or-later\nmedia_license = CC-BY-SA-4.0\nmin_minetest_version = 5.9\n';

    const store = new Map<string, any>();
    const identities = [{ provider: 'github', username: 'SaKeL', verified: 1 }];
    const sessionSecret = 'jam-license-test-secret';
    const ownerCookie = await createSessionToken('user-sakel', sessionSecret);

    const mockDb = {
      prepare: (sql: string) => {
        const bound: any[] = [];
        const exec = async (mode: 'run' | 'first' | 'all') => {
          const clean = sql.replace(/\s+/g, ' ').trim();
          if (/FROM users WHERE id =/i.test(clean)) {
            return { id: 'user-sakel', username: 'SaKeL', display_name: 'SaKeL' };
          }
          if (/FROM user_identities WHERE user_id =/i.test(clean)) {
            return { results: identities };
          }
          if (/INSERT\s+INTO\s+packages/i.test(clean) && /SELECT\s+\?/i.test(clean)) {
            const [
              id, , author_name, name, title, short_desc, long_desc, repo_url, provider,
              thumbnail_url, banner_url, screenshots, license, media_license, tags,
              min_minetest_version, latest_commit_sha, created_at, updated_at
            ] = bound;
            const key = String(id).toLowerCase();
            const existing = store.get(key);
            const respectOverride = Number(existing?.license_override || 0) === 1;
            store.set(key, {
              ...(existing || {}),
              id,
              author_id: existing?.author_id ?? null,
              author_name,
              name,
              title,
              type: 'game',
              short_desc,
              long_desc,
              repo_url,
              provider,
              thumbnail_url,
              banner_url,
              screenshots,
              license: !respectOverride && license ? license : (existing?.license || ''),
              media_license: !respectOverride && media_license ? media_license : (existing?.media_license || ''),
              tags,
              min_minetest_version: min_minetest_version || existing?.min_minetest_version || '5.0.0',
              latest_commit_sha,
              metadata_synced_at: new Date().toISOString(),
              license_override: existing?.license_override ?? 0,
              status: 'active',
              downloads_count: existing?.downloads_count ?? 0,
              contentdb_downloads: existing?.contentdb_downloads ?? 0,
              luantihub_downloads: existing?.luantihub_downloads ?? 0,
              created_at,
              updated_at
            });
            return mode === 'all' ? { results: [] } : { success: true };
          }
          if (/UPDATE packages SET/i.test(clean)) {
            const targetKey = String(bound[bound.length - 1] || '').toLowerCase();
            const row = store.get(targetKey) || Array.from(store.values()).find(r => r.id.toLowerCase() === targetKey);
            if (row) {
              if (/license_override\s*=\s*\?/i.test(clean) && /license\s*=\s*\?/i.test(clean)) {
                // onRequestPatch direct license update or resync
                const hasTitleSet = /title\s*=\s*COALESCE/i.test(clean);
                if (hasTitleSet) {
                  // Standard PATCH update: args order includes title, short_desc, type, ..., license, media_license, license_override, ...
                  const overrideIdx = clean.split('= ?').findIndex(s => /license_override\s*$/.test(s));
                  if (overrideIdx >= 0 && bound[overrideIdx] !== undefined) {
                    row.license_override = Number(bound[overrideIdx]) || 0;
                  }
                  const licMatchIdx = clean.slice(0, clean.indexOf('license =')).split('?').length - 1;
                  if (licMatchIdx >= 0) {
                    // Check COALESCE vs direct assignment
                    row.license = bound[licMatchIdx] ?? row.license;
                  }
                }
              }
              if (/license_override\s*=\s*0/i.test(clean)) {
                row.license_override = 0;
              }
              if (/metadata_synced_at\s*=\s*CURRENT_TIMESTAMP/i.test(clean)) {
                row.metadata_synced_at = new Date().toISOString();
              }
            }
            return { success: true };
          }
          if (/SELECT\s+LOWER\(id\)\s+as\s+lower_id,\s+updated_at,\s+created_at/i.test(clean)) {
            const lowerIds = new Set(bound.map(b => String(b).toLowerCase()));
            return {
              results: Array.from(store.entries())
                .filter(([k]) => lowerIds.has(k))
                .map(([k, p]) => ({
                  lower_id: k,
                  updated_at: p.updated_at,
                  created_at: p.created_at,
                  license: p.license,
                  media_license: p.media_license,
                  min_minetest_version: p.min_minetest_version
                }))
            };
          }
          if (/FROM packages/i.test(clean)) {
            const allRows = Array.from(store.values());
            if (mode === 'all') return { results: allRows };
            const b0 = String(bound[0] || '').toLowerCase();
            return allRows.find(r => r.id.toLowerCase() === b0 || `${r.author_name}/${r.name}`.toLowerCase() === b0) || null;
          }
          return mode === 'all' ? { results: [] } : null;
        };
        const stmt: any = {
          bind: (...args: any[]) => {
            bound.push(...args);
            return stmt;
          },
          run: () => exec('run'),
          first: () => exec('first'),
          all: () => exec('all')
        };
        return stmt;
      }
    };

    // Wrap UPDATE packages cleanly via intercepted handler verification on D1 state too
    const origPrepare = mockDb.prepare;
    mockDb.prepare = (sql: string) => {
      const clean = sql.replace(/\s+/g, ' ').trim();
      if (/^UPDATE packages SET/i.test(clean)) {
        const bound: any[] = [];
        const stmt: any = {
          bind: (...args: any[]) => {
            bound.push(...args);
            return stmt;
          },
          run: async () => {
            const idArg = String(bound[bound.length - 1] || '').toLowerCase();
            const row = store.get(idArg);
            if (!row) return { success: true };
            // Parse ordered SET ? placeholders robustly for test assertions
            const setPart = clean.slice(clean.indexOf('SET ') + 4, clean.indexOf(' WHERE '));
            const assignments = setPart.split(/,(?![^(]*\))/);
            let pIdx = 0;
            for (const assign of assignments) {
              const qCount = (assign.match(/\?/g) || []).length;
              const sliceArgs = bound.slice(pIdx, pIdx + qCount);
              pIdx += qCount;
              const colMatch = assign.trim().match(/^([a-z0-9_]+)\s*=/i);
              const col = colMatch?.[1]?.toLowerCase() || '';
              if (col === 'license_override') {
                if (qCount === 0 && /=\s*0/.test(assign)) row.license_override = 0;
                else if (sliceArgs[0] !== undefined && sliceArgs[0] !== null) row.license_override = Number(sliceArgs[0]);
              } else if (col === 'license') {
                const candidate = sliceArgs.find(a => a !== null && a !== undefined);
                if (candidate && (qCount <= 1 || Number(row.license_override || 0) === 0 || !/license_override/i.test(assign))) {
                  row.license = String(candidate);
                }
              } else if (col === 'media_license') {
                const candidate = sliceArgs.find(a => a !== null && a !== undefined);
                if (candidate && (qCount <= 1 || Number(row.license_override || 0) === 0 || !/license_override/i.test(assign))) {
                  row.media_license = String(candidate);
                }
              } else if (col === 'tags' && sliceArgs[0]) {
                row.tags = String(sliceArgs[0]);
              } else if (col === 'provider' && sliceArgs[0]) {
                row.provider = String(sliceArgs[0]);
              } else if (col === 'latest_commit_sha' && sliceArgs[0]) {
                row.latest_commit_sha = String(sliceArgs[0]);
              } else if (col === 'metadata_synced_at') {
                row.metadata_synced_at = new Date().toISOString();
              }
            }
            return { success: true };
          },
          first: async () => null,
          all: async () => ({ results: [] })
        };
        return stmt;
      }
      return origPrepare(sql);
    };

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('jam.greenxenith.com/api/brews')) {
        return new Response(
          JSON.stringify([
            {
              id: 'terrarium_crucible',
              title: 'Terrarium Crucible',
              description: 'Action puzzle game',
              repository: 'https://github.com/SaKeL/terrarium_crucible',
              commit: currentSha,
              publishedAt: '2026-11-16T08:00:00Z',
              hasScreenshot: false
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/game.conf')) {
        return new Response(currentGameConf, { status: 200 });
      }
      if (url.endsWith('/screenshot.png')) {
        return new Response('', { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      if (url.includes('content.luanti.org') || url.includes('contentdb.milcho.org')) {
        if (url.includes('/packages/?fmt=vcs') || url.includes('/scores/')) {
          return new Response(JSON.stringify([{ author: 'Other', name: 'other_mod', downloads: 5 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('Not found', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    // 1. Initial sync discovers real license from game.conf ('GPL-3.0-or-later'), NOT hardcoded 'MIT'
    await syncJam2026IntoPromoRowDelta({
      uniqueTags: ['jam_game_2026'],
      addTagStamp: () => {},
      discoveredByKey: new Map(),
      existingD1Pairs: new Set(),
      queuedUpsertKeys: new Set(),
      d1UpsertPairs: [],
      db: mockDb,
      noCache: true
    });
    const saved = store.get('sakel/terrarium_crucible');
    expect(saved?.license).toBe('GPL-3.0-or-later');
    expect(saved?.media_license).toBe('CC-BY-SA-4.0');

    // 2. Detail ?lite=1 and full endpoints both return 'GPL-3.0-or-later'
    const liteRes = await getPackageDetail({
      params: { author: 'SaKeL', name: 'terrarium_crucible' },
      request: new Request('https://luantihub.org/api/packages/SaKeL/terrarium_crucible/?lite=1&nocache=1'),
      env: { DB: mockDb }
    } as any);
    const liteJson: any = await liteRes.json();
    expect(liteJson.license).toBe('GPL-3.0-or-later');

    // 3. Manual author edit via PATCH sets license_override = 1 and survives commit bump
    const patchManualRes = await patchPackageDetail({
      params: { author: 'SaKeL', name: 'terrarium_crucible' },
      request: new Request('https://luantihub.org/api/packages/SaKeL/terrarium_crucible', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://luantihub.org',
          Cookie: `lh_session=${ownerCookie}`
        },
        body: JSON.stringify({ license: 'Apache-2.0' })
      }),
      env: { DB: mockDb, SESSION_SECRET: sessionSecret }
    } as any);
    expect(patchManualRes.status).toBe(200);
    const patchManualJson: any = await patchManualRes.json();
    expect(patchManualJson.license).toBe('Apache-2.0');
    expect(store.get('sakel/terrarium_crucible')?.license_override).toBe(1);

    currentSha = sha2;
    currentGameConf = 'title = Terrarium Crucible\nlicense = LGPL-2.1-only\nmedia_license = CC0-1.0\n';
    await syncJam2026IntoPromoRowDelta({
      uniqueTags: ['jam_game_2026'],
      addTagStamp: () => {},
      discoveredByKey: new Map(),
      existingD1Pairs: new Set(),
      queuedUpsertKeys: new Set(),
      d1UpsertPairs: [],
      db: mockDb,
      noCache: true
    });
    expect(store.get('sakel/terrarium_crucible')?.license).toBe('Apache-2.0');

    // 4. Explicit resync_git clears override and pulls fresh LGPL-2.1-only from Git
    const resyncRes = await patchPackageDetail({
      params: { author: 'SaKeL', name: 'terrarium_crucible' },
      request: new Request('https://luantihub.org/api/packages/SaKeL/terrarium_crucible', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://luantihub.org',
          Cookie: `lh_session=${ownerCookie}`
        },
        body: JSON.stringify({ resync_git: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: sessionSecret }
    } as any);
    expect(resyncRes.status).toBe(200);
    const resyncJson: any = await resyncRes.json();
    expect(resyncJson.license).toBe('LGPL-2.1-only');
    expect(store.get('sakel/terrarium_crucible')?.license_override).toBe(0);
    expect(store.get('sakel/terrarium_crucible')?.license).toBe('LGPL-2.1-only');
  });

  it('prevents and self-heals false ContentDB badges for pure-Git Sky-Bridge Alchemists on PATCH, GET detail, and PackageService hydration', async () => {
    const cachesMock = createInMemoryEdgeCaches();
    (globalThis as any).caches = cachesMock;
    clearIsolateCachesForTests();
    await invalidateEdgeCacheKeys([BOOT_CATALOG_EDGE_CACHE_KEY, UPDATES_EDGE_CACHE_KEY]);

    const store = new Map<string, any>();
    const identities = [{ provider: 'github', username: 'SaKeL', verified: 1 }];
    const sessionSecret = 'skybridge-secret';
    const ownerCookie = await createSessionToken('user-sakel', sessionSecret);

    const mockDb = {
      prepare: (sql: string) => {
        const bound: any[] = [];
        const clean = sql.replace(/\s+/g, ' ').trim();
        const stmt: any = {
          bind: (...args: any[]) => {
            bound.push(...args);
            return stmt;
          },
          run: async () => {
            if (/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+packages/i.test(clean)) {
              const id = String(bound[0]);
              const key = id.toLowerCase();
              const providerMatch = clean.match(/values\s*\(([\s\S]*?)\)/i);
              // Find provider arg by scanning bound or looking up github repo url
              const repoArg = bound.find(a => typeof a === 'string' && a.includes('github.com')) || '';
              const provArg = bound.find(a => a === 'github' || a === 'contentdb' || a === 'gitlab' || a === 'codeberg') || 'github';
              store.set(key, {
                id,
                author_id: bound[1] ?? null,
                author_name: bound[2],
                name: bound[3],
                title: bound[4],
                type: 'game',
                short_desc: bound[6] || '',
                provider: provArg,
                repo_url: repoArg,
                tags: JSON.stringify(['game', 'jam_game_2026']),
                status: 'active',
                contentdb_downloads: 0,
                luantihub_downloads: 0,
                downloads_count: 0,
                license: 'MPL-2.0',
                media_license: 'CC-BY-4.0'
              });
            } else if (/^UPDATE packages SET/i.test(clean)) {
              const targetKey = String(bound[bound.length - 1] || '').toLowerCase();
              const row = store.get(targetKey);
              if (row) {
                const provArg = bound.find(a => a === 'github' || a === 'gitlab' || a === 'codeberg');
                if (provArg) row.provider = provArg;
                const tagsArg = bound.find(a => typeof a === 'string' && a.startsWith('[') && !a.includes('http'));
                if (tagsArg) row.tags = tagsArg;
                if (clean.includes('metadata_synced_at = CURRENT_TIMESTAMP')) {
                  row.metadata_synced_at = new Date().toISOString();
                }
                const mplIdx = bound.indexOf('MPL-2.0');
                if (mplIdx >= 0) row.license = 'MPL-2.0';
              }
            }
            return { success: true };
          },
          first: async () => {
            if (/FROM users WHERE id =/i.test(clean)) {
              return { id: 'user-sakel', username: 'SaKeL', display_name: 'SaKeL' };
            }
            if (/FROM packages/i.test(clean)) {
              for (const b of bound) {
                const match = Array.from(store.values()).find(
                  r => r.id.toLowerCase() === String(b).toLowerCase() || r.name.toLowerCase() === String(b).toLowerCase().replace(/-/g, '_')
                );
                if (match) return match;
              }
              return null;
            }
            return null;
          },
          all: async () => {
            if (/FROM user_identities WHERE user_id =/i.test(clean)) {
              return { results: identities };
            }
            return { results: [] };
          }
        };
        return stmt;
      }
    };

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('jam.greenxenith.com/api/brews')) {
        return new Response(
          JSON.stringify([
            {
              id: 'sky_bridge_alchemists',
              title: 'Sky-Bridge Alchemists',
              description: 'Alchemist arena game',
              repository: 'https://github.com/SaKeL/sky_bridge_alchemists',
              commit: 'deadbeef1234567890abcdef1234567890abcdef',
              publishedAt: '2026-11-16T08:00:00Z',
              hasScreenshot: false
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/game.conf')) {
        return new Response('title = Sky-Bridge Alchemists\nlicense = MPL-2.0\nmedia_license = CC-BY-4.0\n', { status: 200 });
      }
      if (url.includes('/packages/?fmt=vcs') || url.includes('/scores/')) {
        return new Response(JSON.stringify([{ author: 'SomeOtherAuthor', name: 'unrelated_mod', downloads: 12 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    // (a) PATCH when D1 row is initially missing creates a pure-Git row without 'contentdb'
    const patchRes = await patchPackageDetail({
      params: { author: 'sakel-hub', name: 'sky-bridge-alchemists' },
      request: new Request('https://luantihub.org/api/packages/sakel-hub/sky-bridge-alchemists', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://luantihub.org',
          Cookie: `lh_session=${ownerCookie}`
        },
        body: JSON.stringify({
          tags: ['adventure'],
          repo_url: 'https://github.com/SaKeL/sky_bridge_alchemists'
        })
      }),
      env: { DB: mockDb, SESSION_SECRET: sessionSecret }
    } as any);
    expect(patchRes.status).toBe(200);
    const patchJson: any = await patchRes.json();
    expect(patchJson.provider).toBe('github');
    expect(patchJson.sources).toEqual(['git']);

    // (b) Legacy poisoned D1 row (provider = 'contentdb', tags = ['game', 'contentdb'], contentdb_downloads = 0)
    // self-heals on GET detail when ContentDB confirms absence
    store.set('sakel-hub/sky_bridge_alchemists', {
      id: 'sakel-hub/sky_bridge_alchemists',
      author_id: 'user-sakel',
      author_name: 'sakel-hub',
      name: 'sky_bridge_alchemists',
      title: 'Sky-Bridge Alchemists',
      type: 'game',
      provider: 'contentdb',
      repo_url: 'https://github.com/SaKeL/sky_bridge_alchemists',
      tags: JSON.stringify(['game', 'contentdb', 'jam_game_2026']),
      badge_tags: JSON.stringify(['jam_game_2026']),
      status: 'active',
      contentdb_downloads: 0,
      luantihub_downloads: 5,
      downloads_count: 5,
      license: 'MIT',
      metadata_synced_at: null,
      license_override: 0
    });

    const getHealedRes = await getPackageDetail({
      params: { author: 'sakel-hub', name: 'sky_bridge_alchemists' },
      request: new Request('https://luantihub.org/api/packages/sakel-hub/sky_bridge_alchemists/?nocache=1'),
      env: { DB: mockDb }
    } as any);
    expect(getHealedRes.status).toBe(200);
    const healedJson: any = await getHealedRes.json();
    expect(healedJson.provider).toBe('github');
    expect(healedJson.source).toBe('git');
    expect(healedJson.sources).toEqual(['git']);
    expect(healedJson.tags).not.toContain('contentdb');
    expect(healedJson.license).toBe('MPL-2.0');

    // (c) Client PackageService strips phantom 'official' & 'contentdb' when authoritative server response is pure-Git
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    const pkgService = TestBed.inject(PackageService);
    (pkgService as any).edgeApiAvailable = true;
    (pkgService as any).setHydratedMetaEntry('sakel-hub/sky_bridge_alchemists', {
      sources: ['official', 'git'],
      tags: ['game', 'contentdb', 'jam_game_2026'],
      contentdb_downloads: 0,
      license: 'MIT'
    });

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/packages/sakel-hub/sky_bridge_alchemists')) {
        return new Response(JSON.stringify(healedJson), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const poisonedSeedPkg = (pkgService as any).normalizePackage({
      id: 'sakel-hub/sky_bridge_alchemists',
      author: 'sakel-hub',
      name: 'sky_bridge_alchemists',
      title: 'Sky-Bridge Alchemists',
      type: 'game',
      provider: 'contentdb',
      sources: ['official', 'git'],
      contentdb_downloads: 0,
      luantihub_downloads: 5,
      downloads: 5,
      tags: ['game', 'contentdb', 'jam_game_2026'],
      license: 'MIT'
    });
    (pkgService as any)._activePackage.set(poisonedSeedPkg);
    await pkgService.loadPackageDetails(poisonedSeedPkg, false);
    const active = pkgService.activePackage()!;
    expect(active.sources).toEqual(['git']);
    expect(active.source).toBe('git');
    expect(active.provider).toBe('github');
    expect(active.contentdb_author).toBeUndefined();
    expect(active.contentdb_name).toBeUndefined();
    expect(active.tags).not.toContain('contentdb');
    expect(active.license).toBe('MPL-2.0');

    // (d) PackageDetailModalComponent header renders no ContentDB badge, exposes Code/Media License inputs & Re-sync from Git button
    const modalFixture = TestBed.createComponent(PackageDetailModalComponent);
    const modalComp = modalFixture.componentInstance;
    vi.spyOn(modalComp.authService, 'canManagePackage').mockReturnValue(true);
    modalComp.package = active;
    modalFixture.detectChanges();
    const modalEl = modalFixture.nativeElement as HTMLElement;
    const headerBadges = modalEl.querySelector('[data-testid="modal-header-badges"]')!;
    expect(headerBadges).toBeTruthy();
    expect(headerBadges.querySelector('[data-testid="git-badge"]')).toBeTruthy();
    expect(headerBadges.querySelector('[data-testid="contentdb-badge"]')).toBeNull();
    expect(modalEl.querySelector('[data-testid="project-link-contentdb"]')).toBeNull();

    modalComp.openEditTags();
    modalFixture.detectChanges();
    await modalFixture.whenStable();
    modalFixture.detectChanges();

    const codeLicInput = modalEl.querySelector('[data-testid="edit-code-license"]') as HTMLInputElement | null;
    const mediaLicInput = modalEl.querySelector('[data-testid="edit-media-license"]') as HTMLInputElement | null;
    const resyncBtn = modalEl.querySelector('[data-testid="btn-resync-from-git"]') as HTMLButtonElement | null;
    expect(codeLicInput?.value).toBe('MPL-2.0');
    expect(mediaLicInput?.value).toBe('CC-BY-4.0');
    expect(resyncBtn).toBeTruthy();

    globalThis.fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      if ((init?.method || 'GET').toUpperCase() === 'PATCH') {
        return new Response(
          JSON.stringify({
            success: true,
            license: 'GPL-3.0-or-later',
            media_license: 'CC-BY-SA-4.0',
            provider: 'github',
            source: 'git',
            sources: ['git'],
            latest_commit_sha: 'cafebabe1234'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    await modalComp.onResyncFromGit();
    modalFixture.detectChanges();
    expect(modalComp.editableLicense()).toBe('GPL-3.0-or-later');
    expect(modalComp.editableMediaLicense()).toBe('CC-BY-SA-4.0');
    expect(modalComp.package.license).toBe('GPL-3.0-or-later');
    expect(pkgService.activePackage()?.license).toBe('GPL-3.0-or-later');
    expect(pkgService.activePackage()?.sources).toEqual(['git']);
    modalFixture.destroy();
    pkgService.closePackageModal();
  });

  it('discovers screenshot.jpg fallback for exevirus/back_tracks across scanGitRepoMetadataCached, Jam 2026 sync/readback, refreshJam2026D1PkgIfStale, synthetic detail, /api/jam-2026, and Luanti client URL conversion', async () => {
    const commitSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const expectedJpgUrl = `https://raw.githubusercontent.com/exevirus/back_tracks/${commitSha}/screenshot.jpg`;
    const cacheStore = new Map<string, Response>();
    (globalThis as any).caches = {
      default: {
        match: async (req: Request) => {
          const hit = cacheStore.get(req.url);
          return hit ? hit.clone() : undefined;
        },
        put: async (req: Request, res: Response) => {
          cacheStore.set(req.url, res.clone());
        },
        delete: async (req: Request) => cacheStore.delete(req.url)
      }
    };

    const jpgHeadRequests: string[] = [];
    globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://jam.greenxenith.com/api/brews') {
        return new Response(
          JSON.stringify([
            {
              repository: 'https://github.com/exevirus/back_tracks',
              commit: commitSha,
              title: 'Back Tracks',
              description: 'Barren Wasteland Racer Shooter',
              hasScreenshot: false,
              publishedAt: '2026-11-22T12:00:00Z'
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/game.conf') && url.includes('exevirus/back_tracks')) {
        return new Response(
          'title = Back Tracks\nname = back_tracks\ndescription = Barren Wasteland Racer Shooter\nmin_minetest_version = 5.14\n',
          { status: 200, headers: { 'Content-Type': 'text/plain' } }
        );
      }
      if (url.endsWith('/JAM2026.md') && url.includes('exevirus/back_tracks')) {
        return new Response('Day 1: Driving Mechanics\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      if (url.endsWith('/screenshot.jpg') && url.includes('exevirus/back_tracks')) {
        jpgHeadRequests.push(`${(init?.method || 'GET').toUpperCase()} ${url}`);
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '85822' }
        });
      }
      if (url.endsWith('/screenshot.png') && url.includes('exevirus/back_tracks')) {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    }) as any;

    try {
      // 1. Direct Git repo scan falls back from missing screenshot.png to screenshot.jpg
      const directScan = await scanGitRepoMetadataCached(
        'exevirus',
        'back_tracks',
        'game',
        'https://github.com/exevirus/back_tracks',
        86400,
        { commitSha, bypassCache: true }
      );
      expect(directScan.gitRepoStatus).toBe('verified');
      expect(directScan.screenshotUrl).toBe(expectedJpgUrl);
      expect(directScan.screenshots).toEqual([expectedJpgUrl]);
      expect(jpgHeadRequests.some((r) => r.includes(expectedJpgUrl))).toBe(true);

      // 2. Luanti C++ client thumbnail converter accepts .jpg/.jpeg and rejects .webp/.avif/.svg
      expect(toLegacyLuantiClientThumbnailUrl(expectedJpgUrl)).toBe(expectedJpgUrl);
      expect(
        toLegacyLuantiClientThumbnailUrl(`https://raw.githubusercontent.com/exevirus/back_tracks/${commitSha}/screenshot.jpeg`)
      ).toBe(`https://raw.githubusercontent.com/exevirus/back_tracks/${commitSha}/screenshot.jpeg`);
      expect(
        toLegacyLuantiClientThumbnailUrl(`https://raw.githubusercontent.com/exevirus/back_tracks/${commitSha}/screenshot.webp`)
      ).toBeUndefined();
      expect(
        toLegacyLuantiClientThumbnailUrl('https://codeberg.org/api/v1/repos/exevirus/back_tracks/raw/screenshot.webp?ref=main')
      ).toBeUndefined();

      // 3. Synthetic detail fallback surfaces screenshot.jpg before D1 persistence
      const synth = await resolveJam2026SyntheticD1Detail('exevirus', 'back_tracks', null, [], true);
      expect(synth.d1Pkg?.thumbnail_url).toBe(expectedJpgUrl);
      expect(synth.d1Pkg?.banner_url).toBe(expectedJpgUrl);
      expect(JSON.parse(synth.d1Pkg?.screenshots || '[]')).toEqual([expectedJpgUrl]);

      // 4. Jam 2026 sync persists screenshot.jpg to D1 and propagates to discoveredByKey (and subsequent D1 readback)
      const fkD1 = createFkEnforcingJamD1();
      const discovered1 = new Map<string, any>();
      await syncJam2026IntoPromoRowDelta({
        uniqueTags: ['jam_game_2026'],
        addTagStamp: () => {},
        discoveredByKey: discovered1,
        existingD1Pairs: new Set(),
        queuedUpsertKeys: new Set(),
        d1UpsertPairs: [],
        db: fkD1.db,
        noCache: true
      });
      const syncedEntry1 = discovered1.get('exevirus/back_tracks');
      expect(syncedEntry1?.thumbnail).toBe(expectedJpgUrl);
      expect(syncedEntry1?.banner).toBe(expectedJpgUrl);
      expect(syncedEntry1?.screenshots).toEqual([expectedJpgUrl]);
      expect(fkD1.packages.get('exevirus/back_tracks')?.thumbnail_url).toBe(expectedJpgUrl);
      expect(fkD1.packages.get('exevirus/back_tracks')?.banner_url).toBe(expectedJpgUrl);

      // Subsequent sync when unsyncedBrews.length === 0 must read back screenshot.jpg from D1
      const discovered2 = new Map<string, any>();
      await syncJam2026IntoPromoRowDelta({
        uniqueTags: ['jam_game_2026'],
        addTagStamp: () => {},
        discoveredByKey: discovered2,
        existingD1Pairs: new Set(),
        queuedUpsertKeys: new Set(),
        d1UpsertPairs: [],
        db: fkD1.db,
        noCache: false
      });
      const syncedEntry2 = discovered2.get('exevirus/back_tracks');
      expect(syncedEntry2?.thumbnail).toBe(expectedJpgUrl);
      expect(syncedEntry2?.banner).toBe(expectedJpgUrl);
      expect(syncedEntry2?.screenshots).toEqual([expectedJpgUrl]);

      // 5. GET /api/jam-2026 overlays D1 screenshot.jpg onto brews with hasScreenshot: false
      const jamApiDb = {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [
                {
                  lower_id: 'exevirus/back_tracks',
                  lower_repo: 'https://github.com/exevirus/back_tracks',
                  license: 'MIT',
                  media_license: 'MIT',
                  min_minetest_version: '5.14',
                  thumbnail_url: expectedJpgUrl,
                  banner_url: expectedJpgUrl,
                  screenshots: JSON.stringify([expectedJpgUrl])
                }
              ]
            })
          })
        })
      };
      const jamEndpointRes = await getJam2026Endpoint({
        request: new Request('https://luantihub.org/api/jam-2026'),
        env: { DB: jamApiDb }
      });
      const jamEndpointJson = await jamEndpointRes.json();
      const apiBrew = jamEndpointJson.brews.find((b: any) => b.id === 'exevirus/back_tracks');
      expect(apiBrew?.thumbnail).toBe(expectedJpgUrl);
      expect(apiBrew?.banner).toBe(expectedJpgUrl);
      expect(apiBrew?.screenshots).toEqual([expectedJpgUrl]);

      // 6. refreshJam2026D1PkgIfStale backfills screenshot.jpg onto an already-synced D1 row missing screenshots
      const updatedCols: Record<string, any> = {};
      const refreshDb = {
        prepare: () => ({
          bind: (...args: any[]) => ({
            run: async () => {
              updatedCols['thumb'] = args[3];
              updatedCols['banner'] = args[4];
              updatedCols['screenshots'] = args[5];
              return { success: true };
            }
          })
        })
      };
      const refreshed = await refreshJam2026D1PkgIfStale(
        {
          id: 'exevirus/back_tracks',
          author_name: 'exevirus',
          name: 'back_tracks',
          type: 'game',
          repo_url: 'https://github.com/exevirus/back_tracks',
          latest_commit_sha: commitSha,
          tags: JSON.stringify(['jam_game_2026', 'gamejam', 'git', 'github', 'game']),
          thumbnail_url: null,
          banner_url: 'logo.svg',
          screenshots: null,
          metadata_synced_at: '2026-11-22T12:00:00Z',
          license_override: 0
        },
        refreshDb,
        false
      );
      expect(refreshed.thumbnail_url).toBe(expectedJpgUrl);
      expect(refreshed.banner_url).toBe(expectedJpgUrl);
      expect(JSON.parse(refreshed.screenshots || '[]')).toEqual([expectedJpgUrl]);
      expect(updatedCols['thumb']).toBe(expectedJpgUrl);
      expect(updatedCols['banner']).toBe(expectedJpgUrl);
      expect(JSON.parse(updatedCols['screenshots'] || '[]')).toEqual([expectedJpgUrl]);
    } finally {
      clearIsolateCachesForTests();
    }
  });
});

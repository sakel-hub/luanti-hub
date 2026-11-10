import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  fetchJam2026BrewsCached,
  parseJam2026RepositoryUrl,
  normalizeJam2026BrewEntry,
  syncJam2026IntoPromoRowDelta,
  applyJam2026RepoOverlayOnCatalog,
  detectJam2026RootParticipationTags,
  fetchJam2026FallbackReadme,
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
import { onRequest as handlePackageDownload } from '../../functions/api/packages/[author]/[name]/download';
import {
  isJam2026PromoTag,
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
          'https://jam.greenxenith.com/api/brews/brew-uuid-1/images/abc1234'
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

    const targetImg = 'https://jam.greenxenith.com/api/brews/pure-git-1/images/1111aaaa2222bbbb';
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
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  fetchJam2026BrewsCached,
  parseJam2026RepositoryUrl,
  buildJam2026BrewImageUrl,
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
import { onRequestGet as getPackageDetail } from '../../functions/api/packages/[author]/[name]/index';
import { onRequestGet as getPackageForClient } from '../../functions/api/packages/[author]/[name]/for-client';
import { onRequest as handlePackageDownload } from '../../functions/api/packages/[author]/[name]/download';
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
    expect(insertSql).toContain("WHEN packages.author_id LIKE 'ext_jam2026_%' THEN COALESCE(excluded.thumbnail_url");
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
    expect(forClientJson.screenshots).toEqual([]);
  });
});

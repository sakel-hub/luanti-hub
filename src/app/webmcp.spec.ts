import { EnvironmentInjector, ErrorHandler, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LuantiPackage } from './core/models/package.model';
import {
  CHUNK_RELOAD_FN,
  CHUNK_RELOAD_STORAGE_KEY,
  GlobalErrorHandler
} from './core/services/global-error-handler.service';
import { PackageService } from './core/services/package.service';
import { provideLuantiWebMcpTools } from './core/services/webmcp.tools';

interface RegisteredToolRecord {
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: {
      readOnlyHint?: boolean;
      untrustedContentHint?: boolean;
      consequentialHint?: boolean;
    };
    execute: (args: Record<string, unknown>, client: { signal: AbortSignal }) => unknown;
  };
  signal?: AbortSignal;
}

describe('GlobalErrorHandler', () => {
  let reloadSpy: ReturnType<typeof vi.fn<() => void>>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    reloadSpy = vi.fn<() => void>();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    TestBed.configureTestingModule({
      providers: [
        { provide: ErrorHandler, useExisting: GlobalErrorHandler },
        { provide: CHUNK_RELOAD_FN, useValue: reloadSpy }
      ]
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    window.sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('suppresses direct and promise-wrapped AbortError without logging', () => {
    const handler = TestBed.inject(ErrorHandler);
    const abortErr = new DOMException('The user aborted a request.', 'AbortError');

    handler.handleError(abortErr);
    handler.handleError({ rejection: abortErr });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('redacts sensitive query and hash parameters before logging errors', () => {
    const handler = TestBed.inject(ErrorHandler);
    const leaked = new Error(
      'Auth failed at https://luantihub.org/callback?code=secret_code_123&state=csrf99&session=sess42#access_token=gho_topsecret&token=tok999'
    );

    handler.handleError(leaked);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[1] ?? '');
    expect(logged).toContain('[REDACTED]');
    expect(logged).not.toContain('secret_code_123');
    expect(logged).not.toContain('csrf99');
    expect(logged).not.toContain('sess42');
    expect(logged).not.toContain('gho_topsecret');
    expect(logged).not.toContain('tok999');
  });

  it('reloads once on stale dynamic-chunk errors and skips repeat reloads within cooldown', () => {
    const handler = TestBed.inject(ErrorHandler);
    const chunkError = new TypeError(
      'Failed to fetch dynamically imported module: https://luantihub.org/chunk-ABC123.js'
    );

    handler.handleError(chunkError);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)).toBeTruthy();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    // Second immediate chunk error falls back to logging rather than looping reloads
    handler.handleError(chunkError);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('provideLuantiWebMcpTools', () => {
  const catalogFixtures: LuantiPackage[] = [
    {
      id: 'Wuzzy/mineclonia',
      author: 'Wuzzy',
      author_display_name: 'Wuzzy',
      name: 'mineclonia',
      title: 'Mineclonia',
      type: 'game',
      short_desc: 'Unofficial MineClone2 fork focused on survival gameplay.',
      thumbnail: '/logo.svg',
      score: 4.9,
      downloads: 420000,
      license: 'GPL-3.0-or-later',
      media_license: 'CC-BY-SA-4.0',
      repo_url: 'https://codeberg.org/mineclonia/mineclonia',
      source: 'official',
      sources: ['official', 'git'],
      tags: ['survival', 'sandbox_game'],
      badge_tags: ['organic_code'],
      min_minetest_version: '5.8.0',
      status: 'active'
    },
    {
      id: 'zenonseth/strata',
      author: 'zenonseth',
      name: 'strata',
      title: 'Strata',
      type: 'game',
      short_desc: 'Subterranean excavation jam entry.',
      thumbnail: '/logo.svg',
      score: 4.5,
      downloads: 1200,
      license: 'MIT',
      media_license: 'CC-BY-SA-4.0',
      repo_url: 'https://codeberg.org/zenonseth/strata',
      source: 'git',
      sources: ['git'],
      tags: ['jam_game_2026', 'gamejam', 'game'],
      badge_tags: ['jam_game_2026'],
      min_minetest_version: '5.18.0',
      status: 'active'
    },
    {
      id: 'Jeija/mesecons',
      author: 'Jeija',
      name: 'mesecons',
      title: 'Mesecons',
      type: 'modpack',
      short_desc: 'Digital circuitry and automation modpack.',
      thumbnail: '/logo.svg',
      score: 4.8,
      downloads: 500000,
      license: 'LGPL-2.1-or-later',
      source: 'official',
      sources: ['official'],
      tags: ['technology', 'library'],
      status: 'active'
    },
    {
      id: 'spammer/delisted_pkg',
      author: 'spammer',
      name: 'delisted_pkg',
      title: 'Hidden Delisted Package',
      type: 'mod',
      short_desc: 'Should never be returned to WebMCP clients.',
      thumbnail: '/logo.svg',
      score: 1,
      downloads: 999999,
      license: 'MIT',
      source: 'git',
      sources: ['git'],
      tags: ['survival'],
      status: 'delisted'
    }
  ];

  let registered: Map<string, RegisteredToolRecord>;
  let selectPrimaryNavTabSpy: ReturnType<typeof vi.fn>;
  let setTagFilterSpy: ReturnType<typeof vi.fn>;
  let setSearchQuerySpy: ReturnType<typeof vi.fn>;
  let openPackageModalByIdSpy: ReturnType<typeof vi.fn>;
  let resetFiltersSpy: ReturnType<typeof vi.fn>;

  function setupTestBedWithPackageStub() {
    const selectedType = signal('all');
    const selectedSource = signal('all');
    const selectedTag = signal('all');
    const searchInput = signal('');

    selectPrimaryNavTabSpy = vi.fn((tab: string) => {
      if (tab === 'git') {
        selectedSource.set('git');
        selectedType.set('all');
      } else {
        selectedType.set(tab);
        selectedSource.set('all');
      }
    });
    setTagFilterSpy = vi.fn((tag: string) => selectedTag.set(tag));
    setSearchQuerySpy = vi.fn((q: string) => searchInput.set(q));
    openPackageModalByIdSpy = vi.fn(async () => {});
    resetFiltersSpy = vi.fn(() => {
      selectedType.set('all');
      selectedSource.set('all');
      selectedTag.set('all');
      searchInput.set('');
    });

    const packageServiceStub = {
      packages: signal(catalogFixtures).asReadonly(),
      selectedType: selectedType.asReadonly(),
      selectedSource: selectedSource.asReadonly(),
      selectedTag: selectedTag.asReadonly(),
      searchInput: searchInput.asReadonly(),
      selectPrimaryNavTab: selectPrimaryNavTabSpy,
      setTagFilter: setTagFilterSpy,
      setSearchQuery: setSearchQuerySpy,
      openPackageModalById: openPackageModalByIdSpy,
      resetFilters: resetFiltersSpy
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: PackageService, useValue: packageServiceStub },
        provideLuantiWebMcpTools()
      ]
    });

    return TestBed.inject(EnvironmentInjector);
  }

  beforeEach(() => {
    registered = new Map<string, RegisteredToolRecord>();
  });

  afterEach(() => {
    try {
      delete (navigator as unknown as { modelContext?: unknown }).modelContext;
    } catch {
      // Ignore if non-configurable in environment
    }
    TestBed.resetTestingModule();
  });

  it('acts as a safe no-op when navigator.modelContext is unavailable', () => {
    delete (navigator as unknown as { modelContext?: unknown }).modelContext;
    expect(() => setupTestBedWithPackageStub()).not.toThrow();
    expect(registered.size).toBe(0);
  });

  it('registers tools with expected safety annotations and aborts signals on injector destroy', () => {
    const registerTool = vi.fn(
      (
        tool: RegisteredToolRecord['tool'],
        options?: { signal?: AbortSignal }
      ) => {
        registered.set(tool.name, { tool, signal: options?.signal });
        return Promise.resolve();
      }
    );

    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: { registerTool }
    });

    setupTestBedWithPackageStub();

    expect(Array.from(registered.keys())).toEqual([
      'search_luanti_packages',
      'get_luanti_package_details',
      'navigate_luanti_catalog'
    ]);

    expect(registered.get('search_luanti_packages')?.tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true
    });
    expect(registered.get('get_luanti_package_details')?.tool.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true
    });
    expect(registered.get('navigate_luanti_catalog')?.tool.annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: false
    });

    const signals = Array.from(registered.values()).map((entry) => entry.signal);
    expect(signals.every((sig) => sig && !sig.aborted)).toBe(true);

    TestBed.resetTestingModule();
    expect(signals.every((sig) => sig?.aborted === true)).toBe(true);
  });

  it('filters packages accurately in search_luanti_packages and respects AbortSignal', () => {
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool: (tool: RegisteredToolRecord['tool'], options?: { signal?: AbortSignal }) => {
          registered.set(tool.name, { tool, signal: options?.signal });
          return Promise.resolve();
        }
      }
    });

    setupTestBedWithPackageStub();
    const searchTool = registered.get('search_luanti_packages')!.tool;

    // Exclude delisted entries and sort by downloads descending
    const allGames = JSON.parse(
      String(searchTool.execute({ type: 'game', limit: 10 }, { signal: new AbortController().signal }))
    );
    expect(allGames.totalMatches).toBe(2);
    expect(allGames.packages.map((p: { id: string }) => p.id)).toEqual([
      'Wuzzy/mineclonia',
      'zenonseth/strata'
    ]);

    // Filter by tag + git source
    const jamGit = JSON.parse(
      String(
        searchTool.execute(
          { tag: 'JAM_GAME_2026', source: 'git', limit: 50 },
          { signal: new AbortController().signal }
        )
      )
    );
    expect(jamGit.count).toBe(1);
    expect(jamGit.packages[0].id).toBe('zenonseth/strata');

    // Treat modpack as mod filter match + free-text query
    const modMatches = JSON.parse(
      String(
        searchTool.execute(
          { type: 'mod', query: 'circuitry' },
          { signal: new AbortController().signal }
        )
      )
    );
    expect(modMatches.count).toBe(1);
    expect(modMatches.packages[0].id).toBe('Jeija/mesecons');

    // Aborted client signal short-circuits
    const abortedCtrl = new AbortController();
    abortedCtrl.abort();
    const abortedResult = JSON.parse(
      String(searchTool.execute({ query: 'mineclonia' }, { signal: abortedCtrl.signal }))
    );
    expect(abortedResult.aborted).toBe(true);
    expect(abortedResult.packages).toEqual([]);
  });

  it('resolves package details case-insensitively with hyphen/underscore normalization', () => {
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool: (tool: RegisteredToolRecord['tool'], options?: { signal?: AbortSignal }) => {
          registered.set(tool.name, { tool, signal: options?.signal });
          return Promise.resolve();
        }
      }
    });

    setupTestBedWithPackageStub();
    const detailTool = registered.get('get_luanti_package_details')!.tool;
    const signalOk = new AbortController().signal;

    const hit = JSON.parse(
      String(detailTool.execute({ author: 'ZENONSETH', name: 'strata' }, { signal: signalOk }))
    );
    expect(hit.found).toBe(true);
    expect(hit.package.url).toBe('/package/zenonseth/strata');
    expect(hit.package.min_minetest_version).toBe('5.18.0');

    const miss = JSON.parse(
      String(detailTool.execute({ author: 'spammer', name: 'delisted-pkg' }, { signal: signalOk }))
    );
    expect(miss.found).toBe(false);
  });

  it('forwards UI navigation actions to PackageService in navigate_luanti_catalog', async () => {
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool: (tool: RegisteredToolRecord['tool'], options?: { signal?: AbortSignal }) => {
          registered.set(tool.name, { tool, signal: options?.signal });
          return Promise.resolve();
        }
      }
    });

    setupTestBedWithPackageStub();
    const navTool = registered.get('navigate_luanti_catalog')!.tool;
    const signalOk = new AbortController().signal;

    const filterRes = JSON.parse(
      String(
        await navTool.execute(
          { action: 'filter_catalog', tab: 'game', tag: 'jam_game_2026', query: 'strata' },
          { signal: signalOk }
        )
      )
    );
    expect(filterRes).toMatchObject({
      ok: true,
      action: 'filter_catalog',
      selectedType: 'game',
      selectedTag: 'jam_game_2026',
      searchInput: 'strata'
    });
    expect(selectPrimaryNavTabSpy).toHaveBeenCalledWith('game');
    expect(setTagFilterSpy).toHaveBeenCalledWith('jam_game_2026');
    expect(setSearchQuerySpy).toHaveBeenCalledWith('strata');

    const openRes = JSON.parse(
      String(
        await navTool.execute(
          { action: 'open_package', author: 'zenonseth', name: 'strata' },
          { signal: signalOk }
        )
      )
    );
    expect(openRes).toEqual({
      ok: true,
      action: 'open_package',
      packageId: 'zenonseth/strata'
    });
    expect(openPackageModalByIdSpy).toHaveBeenCalledWith('zenonseth', 'strata', true);

    const resetRes = JSON.parse(
      String(await navTool.execute({ action: 'reset_filters' }, { signal: signalOk }))
    );
    expect(resetRes).toEqual({ ok: true, action: 'reset_filters' });
    expect(resetFiltersSpy).toHaveBeenCalledWith(true, true);
  });
});

import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  provideExperimentalWebMcpTools
} from '@angular/core';
import { LuantiPackage } from '../models/package.model';
import { PackageService } from './package.service';

const MIN_SEARCH_LIMIT = 1;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;

function clampLimit(rawLimit: number | undefined): number {
  if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
    return DEFAULT_SEARCH_LIMIT;
  }
  return Math.max(MIN_SEARCH_LIMIT, Math.min(MAX_SEARCH_LIMIT, Math.trunc(rawLimit)));
}

function normalizeSlugName(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_');
}

function matchesPackageType(pkg: LuantiPackage, requestedType: string): boolean {
  if (!requestedType || requestedType === 'all') {
    return true;
  }
  const normalizedPkgType = pkg.type === 'modpack' ? 'mod' : pkg.type;
  return normalizedPkgType === requestedType;
}

const searchLuantiPackagesSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Free-text search term matched against package title, technical name, author, description, and tags.'
    },
    type: {
      type: 'string',
      enum: ['all', 'game', 'mod', 'txp'],
      description: 'Optional package category filter (game, mod, txp, or all).'
    },
    tag: {
      type: 'string',
      description: 'Optional ContentDB or LuantiHub badge tag name (e.g. survival, magic, jam_game_2026).'
    },
    source: {
      type: 'string',
      enum: ['all', 'official', 'git'],
      description: 'Optional distribution source filter (official ContentDB, decentralized git, or all).'
    },
    limit: {
      type: 'integer',
      description: 'Maximum number of matching packages to return (1 to 25, defaults to 10).'
    }
  },
  additionalProperties: false
} as const;

const getLuantiPackageDetailsSchema = {
  type: 'object',
  properties: {
    author: {
      type: 'string',
      description: 'Package author handle (for example "Wuzzy" or "zenonseth").'
    },
    name: {
      type: 'string',
      description: 'Technical package name (for example "mineclonia" or "strata").'
    }
  },
  required: ['author', 'name'],
  additionalProperties: false
} as const;

const navigateLuantiCatalogSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['open_package', 'filter_catalog', 'reset_filters'],
      description: 'UI navigation action to perform in the active LuantiHub view.'
    },
    author: {
      type: 'string',
      description: 'Package author handle (required when action is "open_package").'
    },
    name: {
      type: 'string',
      description: 'Technical package name (required when action is "open_package").'
    },
    query: {
      type: 'string',
      description: 'Search query to apply in the catalog UI (used when action is "filter_catalog").'
    },
    tab: {
      type: 'string',
      enum: ['all', 'game', 'mod', 'txp', 'git'],
      description: 'Primary category tab to select (used when action is "filter_catalog").'
    },
    tag: {
      type: 'string',
      description: 'Tag filter to apply in the catalog UI (used when action is "filter_catalog").'
    }
  },
  required: ['action'],
  additionalProperties: false
} as const;

/**
 * Registers LuantiHub catalog discovery & navigation tools for WebMCP-enabled browser AI agents
 * (`navigator.modelContext`). Safely acts as a zero-overhead no-op in browsers without WebMCP support.
 */
export function provideLuantiWebMcpTools(): EnvironmentProviders {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') {
    return makeEnvironmentProviders([]);
  }

  return makeEnvironmentProviders([
    provideExperimentalWebMcpTools([
      {
        name: 'search_luanti_packages',
        description:
          'Search and filter LuantiHub mods, games, and texture packs from the loaded catalog without scraping the DOM.',
        inputSchema: searchLuantiPackagesSchema,
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true
        },
        execute: (args, client) => {
          if (client.signal.aborted) {
            return JSON.stringify({ aborted: true, totalMatches: 0, count: 0, packages: [] });
          }
          const packageService = inject(PackageService);
          const lowerQuery = String(args.query || '').trim().toLowerCase();
          const requestedType = String(args.type || 'all').trim().toLowerCase();
          const lowerTag = String(args.tag || '').trim().toLowerCase();
          const requestedSource = String(args.source || 'all').trim().toLowerCase();
          const limit = clampLimit(args.limit);

          const matches = packageService
            .packages()
            .filter((pkg) => {
              if (!pkg || pkg.status === 'delisted') {
                return false;
              }
              if (!matchesPackageType(pkg, requestedType)) {
                return false;
              }
              if (requestedSource !== 'all') {
                const hasSource =
                  pkg.source === requestedSource ||
                  (Array.isArray(pkg.sources) &&
                    pkg.sources.includes(requestedSource as 'official' | 'git' | 'mirror'));
                if (!hasSource) {
                  return false;
                }
              }
              if (lowerTag && lowerTag !== 'all') {
                const allTags = [...(pkg.tags || []), ...(pkg.badge_tags || [])].map((t) =>
                  t.toLowerCase()
                );
                if (!allTags.includes(lowerTag)) {
                  return false;
                }
              }
              if (lowerQuery) {
                const haystack = [
                  pkg.id,
                  pkg.name,
                  pkg.title,
                  pkg.author,
                  pkg.author_display_name,
                  pkg.short_desc,
                  ...(pkg.tags || []),
                  ...(pkg.badge_tags || [])
                ]
                  .filter(Boolean)
                  .join(' ')
                  .toLowerCase();
                if (!haystack.includes(lowerQuery)) {
                  return false;
                }
              }
              return true;
            })
            .sort((a, b) => (b.downloads || 0) - (a.downloads || 0));

          const sliced = matches.slice(0, limit).map((pkg) => ({
            id: pkg.id,
            author: pkg.author,
            name: pkg.name,
            title: pkg.title,
            type: pkg.type,
            short_desc: pkg.short_desc,
            downloads: pkg.downloads,
            score: pkg.score,
            source: pkg.source,
            tags: pkg.tags,
            url: `/package/${pkg.author}/${pkg.name}`
          }));

          return JSON.stringify({
            totalMatches: matches.length,
            count: sliced.length,
            packages: sliced
          });
        }
      }
    ]),
    provideExperimentalWebMcpTools([
      {
        name: 'get_luanti_package_details',
        description:
          'Retrieve detailed metadata, licenses, dependencies, engine compatibility, and repository links for a specific LuantiHub package.',
        inputSchema: getLuantiPackageDetailsSchema,
        annotations: {
          readOnlyHint: true,
          untrustedContentHint: true
        },
        execute: (args, client) => {
          if (client.signal.aborted) {
            return JSON.stringify({ aborted: true, found: false });
          }
          const author = String(args.author || '').trim();
          const name = String(args.name || '').trim();
          if (!author || !name) {
            return JSON.stringify({ found: false, error: 'Both author and name are required.' });
          }
          const lowerAuthor = author.toLowerCase();
          const normName = normalizeSlugName(name);
          const packageService = inject(PackageService);
          const pkg = packageService.packages().find(
            (candidate) =>
              candidate.status !== 'delisted' &&
              candidate.author.toLowerCase() === lowerAuthor &&
              normalizeSlugName(candidate.name) === normName
          );

          if (!pkg) {
            return JSON.stringify({
              found: false,
              error: `Package "${author}/${name}" was not found in the loaded catalog.`
            });
          }

          return JSON.stringify({
            found: true,
            package: {
              id: pkg.id,
              author: pkg.author,
              author_display_name: pkg.author_display_name || pkg.author,
              name: pkg.name,
              title: pkg.title,
              type: pkg.type,
              short_desc: pkg.short_desc,
              license: pkg.license,
              media_license: pkg.media_license || pkg.license,
              downloads: pkg.downloads,
              score: pkg.score,
              source: pkg.source,
              sources: pkg.sources || [pkg.source],
              repo_url: pkg.repo_url || null,
              issue_tracker: pkg.issue_tracker || null,
              min_minetest_version: pkg.min_minetest_version || null,
              max_minetest_version: pkg.max_minetest_version || null,
              dependencies: pkg.dependencies || [],
              optional_dependencies: pkg.optional_dependencies || [],
              tags: pkg.tags || [],
              badge_tags: pkg.badge_tags || [],
              url: `/package/${pkg.author}/${pkg.name}`
            }
          });
        }
      }
    ]),
    provideExperimentalWebMcpTools([
      {
        name: 'navigate_luanti_catalog',
        description:
          'Update the live LuantiHub catalog filters or open a specific package detail modal for the user.',
        inputSchema: navigateLuantiCatalogSchema,
        annotations: {
          readOnlyHint: false,
          consequentialHint: false
        },
        execute: async (args, client) => {
          if (client.signal.aborted) {
            return JSON.stringify({ ok: false, aborted: true });
          }
          const packageService = inject(PackageService);

          if (args.action === 'reset_filters') {
            packageService.resetFilters(true, true);
            return JSON.stringify({ ok: true, action: 'reset_filters' });
          }

          if (args.action === 'open_package') {
            const author = String(args.author || '').trim();
            const name = String(args.name || '').trim();
            if (!author || !name) {
              return JSON.stringify({
                ok: false,
                error: 'Both author and name are required when action is "open_package".'
              });
            }
            await packageService.openPackageModalById(author, name, true);
            return JSON.stringify({
              ok: true,
              action: 'open_package',
              packageId: `${author}/${name}`
            });
          }

          if (args.tab) {
            packageService.selectPrimaryNavTab(args.tab);
          }
          if (args.tag !== undefined) {
            const cleanTag = String(args.tag).trim() || 'all';
            if (packageService.selectedTag().toLowerCase() !== cleanTag.toLowerCase()) {
              packageService.setTagFilter(cleanTag);
            }
          }
          if (args.query !== undefined) {
            packageService.setSearchQuery(String(args.query));
          }

          return JSON.stringify({
            ok: true,
            action: 'filter_catalog',
            selectedType: packageService.selectedType(),
            selectedSource: packageService.selectedSource(),
            selectedTag: packageService.selectedTag(),
            searchInput: packageService.searchInput()
          });
        }
      }
    ])
  ]);
}

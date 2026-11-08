import {
  safeDecodeParam,
  parseJsonArray,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  buildSandboxManifestEdgeCacheKey,
  isDefunctGitHost
} from '../lib/upstream';
import { mergeLuantiHubAndContentDbGameSupport } from '../../../src/app/core/config/package-utils.config';
import { getSandboxQuotaStatus, SandboxQuotaStatus } from './quota';

interface Env {
  DB?: any;
  SANDBOX_BILLING_RESET_DAY?: string;
  SANDBOX_FORCE_QUOTA_EXHAUSTED?: string;
}

export interface SandboxBundleItem {
  id: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  isPrimary: boolean;
  downloadUrl: string;
  mountPath: string;
  estimatedBytes: number;
}

export interface SandboxTargetGame {
  id: string;
  author: string;
  name: string;
  title: string;
}

export interface SandboxManifestResponse {
  packageId: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  baseEnvironment: 'devtest' | 'minetest_game_lite' | 'native_game' | 'texture_showcase';
  targetGame?: SandboxTargetGame | null;
  incompatibleReason?: string;
  estimatedTotalBytes: number;
  maxAllowedArchiveBytes: number;
  maxAllowedUncompressedBytes: number;
  compatible: boolean;
  quotaExhausted: boolean;
  quota: SandboxQuotaStatus;
  engineConfig: Record<string, string | number | boolean>;
  bundles: SandboxBundleItem[];
}

const BUILTIN_BASE_MODS = new Set([
  'default',
  'doors',
  'dye',
  'farming',
  'fire',
  'flowers',
  'screwdriver',
  'sfinv',
  'stairs',
  'tnt',
  'vessels',
  'walls',
  'wool',
  'xpanes',
  'beds',
  'boats',
  'bones',
  'bucket',
  'butterflies',
  'carts',
  'creative',
  'dungeon_loot',
  'env_sounds',
  'fireflies',
  'game_commands',
  'give_initial_stuff',
  'keys',
  'map',
  'mtl',
  'player_api',
  'sethome',
  'spawn',
  'weather',
  'basenodes',
  'testnodes',
  'testtools'
]);

const MAX_HARD_DEPENDENCIES = 6;
const MAX_ALLOWED_ARCHIVE_BYTES = 512 * 1024 * 1024; // 512 MB container disk archive ceiling
const MAX_ALLOWED_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 GB container VFS ceiling

function normalizePackageType(raw?: string): 'mod' | 'game' | 'txp' | 'modpack' {
  const lower = String(raw || 'mod').trim().toLowerCase();
  if (lower === 'game') return 'game';
  if (lower === 'txp' || lower === 'texture_pack') return 'txp';
  if (lower === 'modpack') return 'modpack';
  return 'mod';
}

async function resolveStandaloneModCandidate(
  depModName: string,
  env?: Env
): Promise<{ author: string; name: string; title: string; estimatedBytes: number } | null> {
  if (!env?.DB) return null;

  const cleanDep = String(depModName || '').trim();
  if (!cleanDep) return null;

  // 1. If dependency specifies "author/name", check D1 package record by ID
  const slashIdx = cleanDep.indexOf('/');
  if (slashIdx > 0) {
    const candAuthor = cleanDep.slice(0, slashIdx);
    const candName = cleanDep.slice(slashIdx + 1);
    try {
      const d1Row = await env.DB.prepare(
        `SELECT author_name, name, title, type, download_size FROM packages WHERE status = 'active' AND LOWER(id) = LOWER(?) LIMIT 1`
      )
        .bind(cleanDep)
        .first();
      if (d1Row?.type) {
        const pkgType = normalizePackageType(d1Row.type);
        if (pkgType === 'mod' || pkgType === 'modpack') {
          const resolvedName = d1Row.name || candName;
          return {
            author: d1Row.author_name || candAuthor,
            name: resolvedName,
            title: d1Row.title || resolvedName,
            estimatedBytes: Number(d1Row.download_size || 0)
          };
        }
        return null;
      }
    } catch {
      // Fall through to technical mod name lookup
    }
  }

  // 2. Look up standalone mod/modpack by technical mod name in D1
  try {
    const row = await env.DB.prepare(
      `SELECT author_name, name, title, type, download_size FROM packages WHERE status = 'active' AND LOWER(type) IN ('mod', 'modpack') AND LOWER(name) = LOWER(?) ORDER BY downloads_count DESC LIMIT 1`
    )
      .bind(cleanDep)
      .first();
    if (row?.author_name && row?.name) {
      return {
        author: row.author_name,
        name: row.name,
        title: row.title || row.name,
        estimatedBytes: Number(row.download_size || 0)
      };
    }
  } catch {
    // Ignore D1 lookup error
  }

  return null;
}

export async function onRequestGet(context: {
  request: Request;
  env?: Env;
}) {
  const reqUrl = new URL(context.request.url, 'https://luantihub.org');
  const rawAuthor = (reqUrl.searchParams.get('author') || '').trim();
  const rawName = (reqUrl.searchParams.get('name') || '').trim();
  const rawRelease = (reqUrl.searchParams.get('release') || reqUrl.searchParams.get('tag') || '').trim();

  if (!rawAuthor || !rawName) {
    return Response.json(
      { error: 'Missing required query parameters: author and name.' },
      { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const author = safeDecodeParam(rawAuthor);
  const name = safeDecodeParam(rawName);
  const pkgId = `${author}/${name}`;

  const quota = await getSandboxQuotaStatus(context.env);

  const edgeCacheKey = buildSandboxManifestEdgeCacheKey(author, name, rawRelease || 'latest');
  const cachedManifest = await readEdgeCacheJson<SandboxManifestResponse>(edgeCacheKey);
  if (cachedManifest) {
    const hasSupportedGame = cachedManifest.incompatibleReason !== 'NO_SUPPORTED_GAME';
    const compatible =
      hasSupportedGame &&
      !quota.exhausted &&
      (cachedManifest.estimatedTotalBytes === 0 ||
        cachedManifest.estimatedTotalBytes <= MAX_ALLOWED_ARCHIVE_BYTES);
    return Response.json(
      {
        ...cachedManifest,
        compatible,
        quotaExhausted: quota.exhausted,
        quota
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'X-LuantiHub-Cache': 'HIT-EDGE'
        }
      }
    );
  }

  let d1Pkg: any = null;
  let hasVerifiedAuthor = false;
  if (context.env?.DB) {
    try {
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      d1Pkg = await context.env.DB.prepare(
        `SELECT id, author_id, author_name, name, title, type, status, status_reason, provider, repo_url, tags, dependencies, optional_dependencies, supports_all_games, game_support, download_size
         FROM packages
         WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?))
         LIMIT 1`
      ).bind(pkgId, author, name, sanitizedName).first();

      if (d1Pkg) {
        const rawAuthorId = String(d1Pkg.author_id || '').trim();
        if (rawAuthorId && !rawAuthorId.startsWith('ext_')) {
          hasVerifiedAuthor = true;
        } else if (d1Pkg.author_name) {
          const verifiedUser = await context.env.DB.prepare(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?)
             UNION
             SELECT user_id AS id FROM user_identities WHERE LOWER(provider_username) = LOWER(?)
             LIMIT 1`
          )
            .bind(d1Pkg.author_name, d1Pkg.author_name)
            .first();
          hasVerifiedAuthor = Boolean(verifiedUser?.id);
        }
      }
    } catch {
      // D1 lookup failed
    }
  }

  if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
    return Response.json(
      {
        error: 'Sandbox blocked: This package has been delisted or suspended.',
        status: d1Pkg.status,
        reason: d1Pkg.status_reason || 'Policy / DMCA Takedown'
      },
      { status: 451, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const d1Tags = parseJsonArray(d1Pkg?.tags).map((t: any) => String(t || '').toLowerCase());
  const hasValidRepoUrl = Boolean(d1Pkg?.repo_url && !isDefunctGitHost(String(d1Pkg.repo_url)));
  const isGitPkg =
    Boolean(d1Pkg?.provider && String(d1Pkg.provider).toLowerCase() !== 'contentdb') ||
    d1Tags.includes('git') ||
    hasValidRepoUrl;

  if (!d1Pkg || !hasVerifiedAuthor || !isGitPkg) {
    return Response.json(
      {
        error: 'Live preview is restricted to LuantiHub verified Git packages.',
        compatible: false,
        incompatibleReason: 'UNVERIFIED_PACKAGE'
      },
      { status: 403, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const effectiveAuthor = d1Pkg.author_name || author;
  const effectiveName = d1Pkg.name || name;
  const effectiveTitle = d1Pkg.title || effectiveName;
  const effectiveType = normalizePackageType(d1Pkg.type);
  const primaryBytes = Number(d1Pkg.download_size || 0);

  const safeModDir = effectiveName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'mod';

  const releaseQuery = rawRelease ? `&tag=${encodeURIComponent(rawRelease)}` : '';
  const primaryMountPath =
    effectiveType === 'game'
      ? `/games/${safeModDir}`
      : effectiveType === 'txp'
        ? `/textures/${safeModDir}`
        : `/mods/${safeModDir}`;

  const bundles: SandboxBundleItem[] = [
    {
      id: `${effectiveAuthor}/${effectiveName}`,
      author: effectiveAuthor,
      name: effectiveName,
      title: effectiveTitle,
      type: effectiveType,
      isPrimary: true,
      downloadUrl: `/api/packages/${encodeURIComponent(effectiveAuthor)}/${encodeURIComponent(effectiveName)}/download?sandbox=1${releaseQuery}`,
      mountPath: primaryMountPath,
      estimatedBytes: primaryBytes
    }
  ];

  let needsMtgBase = false;
  let targetGame: SandboxTargetGame | null = null;
  let hasSupportedGame = true;
  let incompatibleReason: string | undefined;

  // Resolve hard dependencies and compatible game for mods/modpacks
  if (effectiveType === 'mod' || effectiveType === 'modpack') {
    const rawHardDeps = new Set<string>();
    for (const dep of parseJsonArray(d1Pkg.dependencies)) {
      if (typeof dep === 'string' && dep.trim()) {
        rawHardDeps.add(dep.trim().toLowerCase());
      }
    }

    // Resolve compatible game ecosystem for this mod/modpack directly from D1
    const supportsAllGames = Boolean(d1Pkg.supports_all_games);
    const mergedGameSupport = mergeLuantiHubAndContentDbGameSupport(
      d1Pkg.game_support,
      undefined,
      Array.from(rawHardDeps),
      parseJsonArray(d1Pkg.optional_dependencies)
    );
    const compatibleGames = mergedGameSupport.filter(gs => gs.supports !== false);

    if (!supportsAllGames && compatibleGames.length === 0) {
      hasSupportedGame = false;
      incompatibleReason = 'NO_SUPPORTED_GAME';
    } else if (
      supportsAllGames ||
      compatibleGames.some(gs => gs.game.name.toLowerCase() === 'minetest_game')
    ) {
      targetGame = {
        id: 'Luanti/minetest_game',
        author: 'Luanti',
        name: 'minetest_game',
        title: 'Minetest Game'
      };
      needsMtgBase = true;
    } else {
      const pickedGame = compatibleGames[0].game;
      targetGame = {
        id: pickedGame.id,
        author: pickedGame.author,
        name: pickedGame.name,
        title: pickedGame.title
      };
      const safeGameDir =
        pickedGame.name
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/^_+|_+$/g, '') || 'game';
      bundles.unshift({
        id: `${pickedGame.author}/${pickedGame.name}`,
        author: pickedGame.author,
        name: pickedGame.name,
        title: pickedGame.title,
        type: 'game',
        isPrimary: false,
        downloadUrl: `/api/packages/${encodeURIComponent(pickedGame.author)}/${encodeURIComponent(pickedGame.name)}/download?sandbox=1`,
        mountPath: `/games/${safeGameDir}`,
        estimatedBytes: 0
      });
    }

    let addedModDeps = 0;
    for (const depName of rawHardDeps) {
      if (BUILTIN_BASE_MODS.has(depName)) {
        needsMtgBase = true;
        continue;
      }
      if (addedModDeps >= MAX_HARD_DEPENDENCIES) break;

      const candidate = await resolveStandaloneModCandidate(depName, context.env);

      if (!candidate) {
        // Provided by a game (e.g., Mineclonia / VoxeLibre / Repixture) rather than a standalone mod
        needsMtgBase = true;
        continue;
      }

      const depId = `${candidate.author}/${candidate.name}`;
      if (!bundles.some(b => b.id.toLowerCase() === depId.toLowerCase())) {
        const safeDepDir = candidate.name
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/^_+|_+$/g, '') || depName;
        bundles.push({
          id: depId,
          author: candidate.author,
          name: candidate.name,
          title: candidate.title || candidate.name,
          type: 'mod',
          isPrimary: false,
          downloadUrl: `/api/packages/${encodeURIComponent(candidate.author)}/${encodeURIComponent(candidate.name)}/download?sandbox=1`,
          mountPath: `/mods/${safeDepDir}`,
          estimatedBytes: candidate.estimatedBytes || 0
        });
        addedModDeps++;
      }
    }
  } else if (effectiveType === 'game') {
    targetGame = {
      id: `${effectiveAuthor}/${effectiveName}`,
      author: effectiveAuthor,
      name: effectiveName,
      title: effectiveTitle
    };
  } else if (effectiveType === 'txp') {
    targetGame = {
      id: 'Luanti/minetest_game',
      author: 'Luanti',
      name: 'minetest_game',
      title: 'Minetest Game'
    };
  }

  const baseEnvironment: SandboxManifestResponse['baseEnvironment'] =
    effectiveType === 'game' || (targetGame && targetGame.name.toLowerCase() !== 'minetest_game')
      ? 'native_game'
      : effectiveType === 'txp'
        ? 'texture_showcase'
        : needsMtgBase
          ? 'minetest_game_lite'
          : 'devtest';

  const estimatedTotalBytes = bundles.reduce((sum, b) => sum + (b.estimatedBytes || 0), 0);
  const compatible =
    hasSupportedGame &&
    !quota.exhausted &&
    (estimatedTotalBytes === 0 || estimatedTotalBytes <= MAX_ALLOWED_ARCHIVE_BYTES);

  const manifest: SandboxManifestResponse = {
    packageId: `${effectiveAuthor}/${effectiveName}`,
    author: effectiveAuthor,
    name: effectiveName,
    title: effectiveTitle,
    type: effectiveType,
    baseEnvironment,
    targetGame,
    ...(incompatibleReason ? { incompatibleReason } : {}),
    estimatedTotalBytes,
    maxAllowedArchiveBytes: MAX_ALLOWED_ARCHIVE_BYTES,
    maxAllowedUncompressedBytes: MAX_ALLOWED_UNCOMPRESSED_BYTES,
    compatible,
    quotaExhausted: quota.exhausted,
    quota,
    engineConfig: {
      creative_mode: true,
      enable_damage: false,
      default_privs: 'interact,shout,fly,fast,noclip,teleport,give,creative,bring,settime',
      viewing_range: 60,
      max_block_generate_distance: 4,
      client_unload_unused_data_timeout: 5,
      client_mapblock_limit: 250,
      enable_shaders: false,
      enable_particles: true,
      fps_max: 60
    },
    bundles
  };

  await writeEdgeCacheJson(edgeCacheKey, manifest, 300);

  return Response.json(manifest, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

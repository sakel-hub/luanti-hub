import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  parseJsonArray,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../lib/upstream';

interface Env {
  DB?: any;
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

export interface SandboxManifestResponse {
  packageId: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  baseEnvironment: 'devtest' | 'minetest_game_lite' | 'native_game' | 'texture_showcase';
  estimatedTotalBytes: number;
  maxAllowedArchiveBytes: number;
  maxAllowedUncompressedBytes: number;
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
  ' fireflies',
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
const MAX_ALLOWED_ARCHIVE_BYTES = 25 * 1024 * 1024; // 25 MB compressed ceiling
const MAX_ALLOWED_UNCOMPRESSED_BYTES = 64 * 1024 * 1024; // 64 MB VFS ceiling

function normalizePackageType(raw?: string): 'mod' | 'game' | 'txp' | 'modpack' {
  const lower = String(raw || 'mod').trim().toLowerCase();
  if (lower === 'game') return 'game';
  if (lower === 'txp' || lower === 'texture_pack') return 'txp';
  if (lower === 'modpack') return 'modpack';
  return 'mod';
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
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  const pkgId = `${author}/${name}`;

  const edgeCacheKey = `https://cache.luantihub.internal/__sandbox_manifest_v1/${encAuthor.toLowerCase()}/${encName.toLowerCase()}/${encodeURIComponent(rawRelease || 'latest')}`;
  const cachedManifest = await readEdgeCacheJson<SandboxManifestResponse>(edgeCacheKey);
  if (cachedManifest) {
    return Response.json(cachedManifest, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=180, s-maxage=300',
        'X-LuantiHub-Cache': 'HIT-EDGE'
      }
    });
  }

  let d1Pkg: any = null;
  if (context.env?.DB) {
    try {
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      d1Pkg = await context.env.DB.prepare(
        `SELECT id, author_name, name, title, type, status, status_reason, dependencies, download_size
         FROM packages
         WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?))
         LIMIT 1`
      ).bind(pkgId, author, name, sanitizedName).first();
    } catch {
      // Proceed to upstream lookup
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

  const [upstreamPkg, upstreamDeps] = await Promise.all([
    !d1Pkg
      ? fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 600).catch(() => null)
      : Promise.resolve(null),
    fetchUpstreamJsonCached<Record<string, Array<{ name: string; is_optional: boolean; packages: string[] }>>>(
      `/packages/${encAuthor}/${encName}/dependencies/?only_hard=1`,
      600
    ).catch(() => null)
  ]);

  const effectiveAuthor = d1Pkg?.author_name || upstreamPkg?.author || author;
  const effectiveName = d1Pkg?.name || upstreamPkg?.name || name;
  const effectiveTitle = d1Pkg?.title || upstreamPkg?.title || effectiveName;
  const effectiveType = normalizePackageType(d1Pkg?.type || upstreamPkg?.type);
  const primaryBytes = Number(d1Pkg?.download_size || upstreamPkg?.download_size || 0);

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

  // Resolve hard dependencies for mods/modpacks
  if (effectiveType === 'mod' || effectiveType === 'modpack') {
    const rawHardDeps = new Set<string>();
    for (const dep of parseJsonArray(d1Pkg?.dependencies)) {
      if (typeof dep === 'string' && dep.trim()) {
        rawHardDeps.add(dep.trim().toLowerCase());
      }
    }

    const resolvedPackages = new Map<string, { author: string; name: string }>();
    if (upstreamDeps && typeof upstreamDeps === 'object') {
      const rootKey =
        Object.keys(upstreamDeps).find(
          k => k.toLowerCase() === `${effectiveAuthor}/${effectiveName}`.toLowerCase()
        ) || Object.keys(upstreamDeps)[0];
      const entries = rootKey ? upstreamDeps[rootKey] : [];
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!entry || entry.is_optional || !entry.name) continue;
          const depModName = String(entry.name).trim().toLowerCase();
          rawHardDeps.add(depModName);
          if (BUILTIN_BASE_MODS.has(depModName)) {
            needsMtgBase = true;
            continue;
          }
          if (Array.isArray(entry.packages) && entry.packages.length > 0) {
            const firstCandidate = String(entry.packages[0] || '');
            const slashIdx = firstCandidate.indexOf('/');
            if (slashIdx > 0) {
              resolvedPackages.set(depModName, {
                author: firstCandidate.slice(0, slashIdx),
                name: firstCandidate.slice(slashIdx + 1)
              });
            }
          }
        }
      }
    }

    for (const depName of rawHardDeps) {
      if (BUILTIN_BASE_MODS.has(depName)) {
        needsMtgBase = true;
        continue;
      }
      if (bundles.length - 1 >= MAX_HARD_DEPENDENCIES) break;

      let candidate = resolvedPackages.get(depName);
      if (!candidate && context.env?.DB) {
        try {
          const row = await context.env.DB.prepare(
            `SELECT author_name, name, download_size FROM packages WHERE status = 'active' AND LOWER(name) = LOWER(?) ORDER BY downloads_count DESC LIMIT 1`
          ).bind(depName).first();
          if (row?.author_name && row?.name) {
            candidate = { author: row.author_name, name: row.name };
          }
        } catch {
          // Ignore D1 lookup error
        }
      }

      if (candidate) {
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
            title: candidate.name,
            type: 'mod',
            isPrimary: false,
            downloadUrl: `/api/packages/${encodeURIComponent(candidate.author)}/${encodeURIComponent(candidate.name)}/download?sandbox=1`,
            mountPath: `/mods/${safeDepDir}`,
            estimatedBytes: 0
          });
        }
      }
    }
  }

  const baseEnvironment: SandboxManifestResponse['baseEnvironment'] =
    effectiveType === 'game'
      ? 'native_game'
      : effectiveType === 'txp'
        ? 'texture_showcase'
        : needsMtgBase
          ? 'minetest_game_lite'
          : 'devtest';

  const estimatedTotalBytes = bundles.reduce((sum, b) => sum + (b.estimatedBytes || 0), 0);

  const manifest: SandboxManifestResponse = {
    packageId: `${effectiveAuthor}/${effectiveName}`,
    author: effectiveAuthor,
    name: effectiveName,
    title: effectiveTitle,
    type: effectiveType,
    baseEnvironment,
    estimatedTotalBytes,
    maxAllowedArchiveBytes: MAX_ALLOWED_ARCHIVE_BYTES,
    maxAllowedUncompressedBytes: MAX_ALLOWED_UNCOMPRESSED_BYTES,
    engineConfig: {
      creative_mode: true,
      enable_damage: false,
      default_privs: 'interact,shout,fly,fast,noclip,teleport,give',
      viewing_range: 45,
      max_block_generate_distance: 3,
      client_unload_unused_data_timeout: 5,
      client_mapblock_limit: 250,
      enable_shaders: false,
      enable_particles: false,
      fps_max: 60
    },
    bundles
  };

  await writeEdgeCacheJson(edgeCacheKey, manifest, 300);

  return Response.json(manifest, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=180, s-maxage=300'
    }
  });
}

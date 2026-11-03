/**
 * Single Source of Truth for Decentralized Git Providers across Frontend & Cloudflare Pages Functions.
 *
 * Centralizes provider identifiers, host patterns, capability flags (such as `supportsAuthLogin`),
 * raw asset URL resolution, and repository root directory listing APIs so adding or maintaining a
 * Git forge never requires duplicating provider lists across services or endpoints.
 */

/**
 * Providers that support OAuth / Personal Access Token user sign-in in LuantiHub.
 * Note: `bitbucket` is intentionally excluded from `AuthGitProviderId` so it never appears as a login option.
 */
export type AuthGitProviderId = 'codeberg' | 'mesehub' | 'gitlab' | 'github';

/**
 * All recognized Git repository providers for package hosting, metadata scanning, and asset resolution.
 */
export type GitProviderId = AuthGitProviderId | 'bitbucket' | 'custom';

export type ForgePlatformFamily = 'gitea' | 'gitlab' | 'github' | 'bitbucket';

export interface GitProviderDefinition {
  readonly id: GitProviderId;
  readonly label: string;
  readonly platformFamily: ForgePlatformFamily;
  readonly primaryHost: string;
  readonly hostSubstrings: readonly string[];
  /** Whether this provider is offered as an interactive user login / authentication option. */
  readonly supportsAuthLogin: boolean;
  /** Whether packages from this provider can be scanned for `.conf`, `.cdb.json`, and `screenshot.png`. */
  readonly supportsMetadataScan: boolean;
  /** Whether this provider supports direct repository submission / import. */
  readonly supportsSubmission: boolean;
  /** Whether this provider uses Anubis Proof-of-Work challenge protection on API/raw endpoints. */
  readonly usesAnubisPow: boolean;
}

export const GIT_PROVIDER_CONFIGS: Readonly<Record<GitProviderId, GitProviderDefinition>> = {
  codeberg: {
    id: 'codeberg',
    label: 'Codeberg',
    platformFamily: 'gitea',
    primaryHost: 'codeberg.org',
    hostSubstrings: ['codeberg.org'],
    supportsAuthLogin: true,
    supportsMetadataScan: true,
    supportsSubmission: true,
    usesAnubisPow: true
  },
  mesehub: {
    id: 'mesehub',
    label: 'MeseHub',
    platformFamily: 'gitea',
    primaryHost: 'git.minetest.land',
    hostSubstrings: ['git.minetest.land', 'minetest.land', 'mesehub'],
    supportsAuthLogin: true,
    supportsMetadataScan: true,
    supportsSubmission: true,
    usesAnubisPow: true
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    platformFamily: 'gitlab',
    primaryHost: 'gitlab.com',
    hostSubstrings: ['gitlab.com', 'gitlab.', 'framagit.org', 'salsa.debian.org'],
    supportsAuthLogin: true,
    supportsMetadataScan: true,
    supportsSubmission: true,
    usesAnubisPow: false
  },
  github: {
    id: 'github',
    label: 'GitHub',
    platformFamily: 'github',
    primaryHost: 'github.com',
    hostSubstrings: ['github.com', 'raw.githubusercontent.com'],
    supportsAuthLogin: true,
    supportsMetadataScan: true,
    supportsSubmission: true,
    usesAnubisPow: false
  },
  bitbucket: {
    id: 'bitbucket',
    label: 'Bitbucket',
    platformFamily: 'bitbucket',
    primaryHost: 'bitbucket.org',
    hostSubstrings: ['bitbucket.org', 'api.bitbucket.org'],
    // Explicitly false: Bitbucket is supported for repository metadata/screenshot scanning, NOT as a login option
    supportsAuthLogin: false,
    supportsMetadataScan: true,
    supportsSubmission: true,
    usesAnubisPow: false
  },
  custom: {
    id: 'custom',
    label: 'Git',
    platformFamily: 'gitea',
    primaryHost: '',
    hostSubstrings: ['gitea', 'forgejo', 'notabug.org'],
    supportsAuthLogin: false,
    supportsMetadataScan: true,
    supportsSubmission: true,
    usesAnubisPow: true
  }
} as const;

export const ALL_GIT_PROVIDER_IDS: readonly GitProviderId[] = Object.keys(
  GIT_PROVIDER_CONFIGS
) as GitProviderId[];

export const AUTH_LOGIN_GIT_PROVIDER_IDS: readonly AuthGitProviderId[] = ALL_GIT_PROVIDER_IDS.filter(
  (id): id is AuthGitProviderId => GIT_PROVIDER_CONFIGS[id].supportsAuthLogin
);

/**
 * Returns true if the given provider string is any recognized Git provider (`codeberg`, `mesehub`, `gitlab`, `github`, `bitbucket`, `custom`).
 */
export function isGitProviderId(provider?: string | null): provider is GitProviderId {
  if (!provider || typeof provider !== 'string') return false;
  const normalized = provider.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(GIT_PROVIDER_CONFIGS, normalized);
}

/**
 * Returns true ONLY if the given provider is enabled for user authentication / login (`supportsAuthLogin === true`).
 */
export function isAuthLoginGitProvider(provider?: string | null): provider is AuthGitProviderId {
  if (!isGitProviderId(provider)) return false;
  return GIT_PROVIDER_CONFIGS[provider].supportsAuthLogin;
}

/**
 * Detects the Git provider config from a repository URL or hostname.
 */
export function detectGitProviderFromUrl(
  repoUrl?: string | null
): { provider: GitProviderId; config: GitProviderDefinition; host: string; owner: string; repo: string } | null {
  if (!repoUrl || typeof repoUrl !== 'string') return null;
  try {
    const u = new URL(repoUrl.trim());
    const host = u.hostname.toLowerCase();
    const cleanedPath = u.pathname
      .replace(/\/-\/(?:tree|blob|commits|releases|tags|archive)(?:\/.*)?$/i, '')
      .replace(/\/(?:tree|blob|src|commits|releases|tags|archive)(?:\/.*)?$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleanedPath.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');

    for (const id of ALL_GIT_PROVIDER_IDS) {
      if (id === 'custom') continue;
      const cfg = GIT_PROVIDER_CONFIGS[id];
      if (cfg.hostSubstrings.some(sub => host === sub || host.includes(sub))) {
        return { provider: id, config: cfg, host, owner, repo };
      }
    }

    return {
      provider: 'custom',
      config: GIT_PROVIDER_CONFIGS.custom,
      host,
      owner,
      repo
    };
  } catch {
    return null;
  }
}

export interface RawBaseCandidate {
  base: string;
  repoUrl: string;
  provider: GitProviderId;
}

/**
 * Builds ordered raw file base URL candidates for a repository (or fallback multi-forge candidates when no explicit URL is known).
 */
export function buildProviderRawBaseCandidates(
  normalizedInputUrl: string | undefined,
  author: string,
  name: string,
  branchHint?: string
): RawBaseCandidate[] {
  const candidates: RawBaseCandidate[] = [];
  const pushCandidate = (base: string, repoUrl: string, provider: GitProviderId) => {
    if (!candidates.some(c => c.base === base)) {
      candidates.push({ base, repoUrl, provider });
    }
  };

  let owner = author;
  let repo = name;
  let host = '';
  let detectedProvider: GitProviderId = 'github';

  if (normalizedInputUrl) {
    const detected = detectGitProviderFromUrl(normalizedInputUrl);
    if (detected) {
      host = detected.host;
      owner = detected.owner;
      repo = detected.repo;
      detectedProvider = detected.provider;
    }
  }

  const lowerOwner = owner.toLowerCase();
  const lowerRepo = repo.toLowerCase();

  if (detectedProvider === 'codeberg' || host.includes('codeberg.org')) {
    pushCandidate(`https://codeberg.org/api/v1/repos/${owner}/${repo}/raw`, `https://codeberg.org/${owner}/${repo}`, 'codeberg');
    pushCandidate(`https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://codeberg.org/${lowerOwner}/${repo}`, 'codeberg');
  } else if (detectedProvider === 'mesehub' || host.includes('minetest.land')) {
    pushCandidate(`https://git.minetest.land/api/v1/repos/${owner}/${repo}/raw`, `https://git.minetest.land/${owner}/${repo}`, 'mesehub');
    pushCandidate(`https://git.minetest.land/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://git.minetest.land/${lowerOwner}/${repo}`, 'mesehub');
  } else if (detectedProvider === 'gitlab' || host.includes('gitlab')) {
    const effectiveHost = host || 'gitlab.com';
    if (branchHint) {
      pushCandidate(`https://${effectiveHost}/${owner}/${repo}/-/raw/${branchHint}`, `https://${effectiveHost}/${owner}/${repo}`, 'gitlab');
    }
    pushCandidate(`https://${effectiveHost}/${owner}/${repo}/-/raw/HEAD`, `https://${effectiveHost}/${owner}/${repo}`, 'gitlab');
  } else if (detectedProvider === 'github' && host.includes('github.com')) {
    if (branchHint) {
      pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/${branchHint}`, `https://github.com/${owner}/${repo}`, 'github');
    }
    pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, `https://github.com/${owner}/${repo}`, 'github');
  } else if (detectedProvider === 'bitbucket' || host.includes('bitbucket.org')) {
    const canonicalRepoUrl = `https://bitbucket.org/${owner}/${repo}`;
    if (branchHint) {
      pushCandidate(`https://bitbucket.org/${owner}/${repo}/raw/${branchHint}`, canonicalRepoUrl, 'bitbucket');
      pushCandidate(`https://api.bitbucket.org/2.0/repositories/${lowerOwner}/${lowerRepo}/src/${branchHint}`, canonicalRepoUrl, 'bitbucket');
    }
    pushCandidate(`https://bitbucket.org/${owner}/${repo}/raw/master`, canonicalRepoUrl, 'bitbucket');
    pushCandidate(`https://bitbucket.org/${owner}/${repo}/raw/main`, canonicalRepoUrl, 'bitbucket');
    pushCandidate(`https://bitbucket.org/${owner}/${repo}/raw/HEAD`, canonicalRepoUrl, 'bitbucket');
    pushCandidate(`https://api.bitbucket.org/2.0/repositories/${lowerOwner}/${lowerRepo}/src/master`, canonicalRepoUrl, 'bitbucket');
    pushCandidate(`https://api.bitbucket.org/2.0/repositories/${lowerOwner}/${lowerRepo}/src/main`, canonicalRepoUrl, 'bitbucket');
  } else if (host) {
    // Self-hosted Gitea / Forgejo instance
    pushCandidate(`https://${host}/api/v1/repos/${owner}/${repo}/raw`, `https://${host}/${owner}/${repo}`, 'custom');
  }

  if (!normalizedInputUrl) {
    pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, `https://github.com/${owner}/${repo}`, 'github');
    pushCandidate(`https://codeberg.org/api/v1/repos/${owner}/${repo}/raw`, `https://codeberg.org/${owner}/${repo}`, 'codeberg');
    pushCandidate(`https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://codeberg.org/${lowerOwner}/${repo}`, 'codeberg');
    pushCandidate(`https://gitlab.com/${owner}/${repo}/-/raw/HEAD`, `https://gitlab.com/${owner}/${repo}`, 'gitlab');
  }

  return candidates;
}

/**
 * Builds the REST API URL for listing files in the root directory of a repository on any supported Git provider.
 */
export function buildProviderRootListingApiUrl(
  provider: GitProviderId,
  host: string,
  owner: string,
  repo: string,
  branch: string
): string {
  const encOwner = encodeURIComponent(owner);
  const encRepo = encodeURIComponent(repo);
  const encBranch = encodeURIComponent(branch);

  switch (provider) {
    case 'github':
      return `https://api.github.com/repos/${encOwner}/${encRepo}/contents?ref=${encBranch}`;
    case 'gitlab': {
      const effectiveHost = host || 'gitlab.com';
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      return `https://${effectiveHost}/api/v4/projects/${projectPath}/repository/tree?ref=${encBranch}&per_page=100`;
    }
    case 'bitbucket':
      return `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}/src/${encBranch}/?pagelen=100`;
    case 'codeberg':
      return `https://codeberg.org/api/v1/repos/${encOwner}/${encRepo}/contents?ref=${encBranch}`;
    case 'mesehub':
      return `https://git.minetest.land/api/v1/repos/${encOwner}/${encRepo}/contents?ref=${encBranch}`;
    default:
      return `https://${host || 'codeberg.org'}/api/v1/repos/${encOwner}/${encRepo}/contents?ref=${encBranch}`;
  }
}

/**
 * Builds the raw file download URL for a specific file path in a repository on any supported Git provider.
 */
export function buildProviderRawFileUrl(
  provider: GitProviderId,
  host: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): string {
  const cleanFile = filePath.replace(/^\/+/, '');
  switch (provider) {
    case 'github':
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanFile}`;
    case 'gitlab':
      return `https://${host || 'gitlab.com'}/${owner}/${repo}/-/raw/${branch}/${cleanFile}`;
    case 'bitbucket':
      return `https://api.bitbucket.org/2.0/repositories/${owner.toLowerCase()}/${repo.toLowerCase()}/src/${branch}/${cleanFile}`;
    case 'codeberg':
      return `https://codeberg.org/${owner}/${repo}/raw/branch/${branch}/${cleanFile}`;
    case 'mesehub':
      return `https://git.minetest.land/${owner}/${repo}/raw/branch/${branch}/${cleanFile}`;
    default:
      return `https://${host || 'codeberg.org'}/${owner}/${repo}/raw/branch/${branch}/${cleanFile}`;
  }
}

/**
 * Rewrites raw image URLs hosted on Anubis PoW-protected MeseHub (`git.minetest.land`)
 * through `/api/packages?proxy_image=...` so browsers can render them without failing the PoW challenge.
 */
export function toProxiedGitImageIfNeeded(url?: string | null): string {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('/api/packages?proxy_image=')) {
    return trimmed.includes('ngsw-bypass=true') ? trimmed : `${trimmed}&ngsw-bypass=true`;
  }
  if (!trimmed.startsWith('http')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (host === 'git.minetest.land' || host.endsWith('.minetest.land')) {
      return `/api/packages?proxy_image=${encodeURIComponent(trimmed)}&ngsw-bypass=true`;
    }
  } catch {
    // Ignore malformed URLs
  }
  return trimmed;
}

/**
 * Checks whether an asset URL (screenshot/thumbnail/banner) originates from a Git repository
 * or independent CDN rather than ContentDB (`content.luanti.org` / `contentdb.milcho.org`).
 */
export function isGitRepositoryAssetUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'logo.svg') return false;
  if (trimmed.startsWith('/api/packages?proxy_image=')) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes('content.luanti.org') || lower.includes('contentdb.milcho.org')) {
    return false;
  }
  return true;
}

/**
 * Single source of truth for determining whether a package is deprecated, abandoned, or unmaintained.
 * Used across both Cloudflare Pages Functions (Top 10, catalog normalization) and Angular client
 * (Hero Banner, Home dashboard swimlane rows, Top 10, and personalized taste scoring).
 */
export function isPackageDeprecated(pkg?: {
  dev_state?: string | null;
  tags?: readonly any[] | string | null;
  title?: string | null;
  short_desc?: string | null;
  short_description?: string | null;
} | null): boolean {
  if (!pkg || typeof pkg !== 'object') return false;
  const devState = String(pkg.dev_state ?? '').trim().toUpperCase();
  if (devState === 'DEPRECATED' || devState === 'ABANDONED' || devState === 'OBSOLETE') {
    return true;
  }

  let tags: readonly any[] = [];
  if (Array.isArray(pkg.tags)) {
    tags = pkg.tags;
  } else if (typeof pkg.tags === 'string' && pkg.tags.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(pkg.tags);
      if (Array.isArray(parsed)) tags = parsed;
    } catch {
      // Ignore malformed JSON tags
    }
  }
  for (const rawTag of tags) {
    const lower = (typeof rawTag === 'string' ? rawTag : String(rawTag?.name ?? rawTag?.title ?? '')).trim().toLowerCase();
    if (
      lower === 'deprecated' ||
      lower === 'abandoned' ||
      lower === 'obsolete' ||
      lower === 'unmaintained'
    ) {
      return true;
    }
  }

  const title = String(pkg.title ?? '').trim();
  const shortDesc = String(pkg.short_desc ?? pkg.short_description ?? '').trim();
  const combined = `${title} ${shortDesc}`;
  if (/\b(?:deprecated|abandoned|obsolete|unmaintained|discontinued)\b/i.test(combined)) {
    return true;
  }
  if (
    /\bnot\s+worked\s+on\s+anymore\b/i.test(combined) ||
    /\b(?:do\s+not|don't)\s+recommend\s+using\s+it\s+anymore\b/i.test(combined) ||
    /\bno\s+longer\s+(?:maintained|supported|updated|developed)\b/i.test(combined)
  ) {
    return true;
  }
  return false;
}


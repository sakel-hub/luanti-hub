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
 * Rewrites raw image URLs hosted on Anubis PoW-protected Git forges (`git.minetest.land`, `mese.hub`)
 * through `/api/packages?proxy_image=...` so browsers receive verified `image/*` MIME headers
 * and edge-cached responses without failing PoW challenges.
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
    if (
      host === 'git.minetest.land' ||
      host.endsWith('.minetest.land') ||
      host === 'mese.hub'
    ) {
      return `/api/packages?proxy_image=${encodeURIComponent(trimmed)}&ngsw-bypass=true`;
    }
  } catch {
    // Ignore malformed URLs
  }
  return trimmed;
}

/**
 * Unwraps `/api/packages?proxy_image=<encoded>` URLs back to the underlying raw image URL.
 */
export function unwrapProxiedImageUrl(rawUrl?: string | null): string {
  const trimmed = rawUrl?.trim() ?? '';
  if (!trimmed) return '';
  const proxyIdx = trimmed.indexOf('proxy_image=');
  if (proxyIdx !== -1 && (trimmed.startsWith('/api/packages') || trimmed.includes('/api/packages?'))) {
    const queryPart = trimmed.slice(proxyIdx + 'proxy_image='.length);
    const ampIdx = queryPart.indexOf('&');
    const encodedTarget = ampIdx !== -1 ? queryPart.slice(0, ampIdx) : queryPart;
    try {
      return decodeURIComponent(encodedTarget).trim();
    } catch {
      return encodedTarget.trim();
    }
  }
  return trimmed;
}

function isContentDbHost(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes('content.luanti.org') ||
    lower.includes('contentdb.milcho.org') ||
    lower.includes('content.minetest.net')
  );
}

/**
 * Checks whether an asset URL (screenshot/thumbnail/banner) originates from a Git repository
 * or independent CDN rather than ContentDB (`content.luanti.org` / `contentdb.milcho.org` / `content.minetest.net`).
 */
export function isGitRepositoryAssetUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'logo.svg') return false;
  if (trimmed.startsWith('/api/packages?proxy_image=')) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return !isContentDbHost(trimmed);
}

/**
 * Computes a provider- and branch-agnostic canonical identity key for a screenshot URL so that:
 * - `/main/screenshot.png` and `/HEAD/screenshot.png` (GitHub / GitLab / Bitbucket)
 * - `/raw/branch/main/screenshot.png` and `/api/v1/repos/<owner>/<repo>/raw/screenshot.png` (Codeberg / MeseHub / Gitea)
 * - Proxied MeseHub URLs with or without `&ngsw-bypass=true`
 * - ContentDB URLs across `content.luanti.org`, `contentdb.milcho.org`, and `content.minetest.net`
 * all map to the exact same canonical key.
 */
export function getCanonicalScreenshotKey(rawUrl?: string | null): string {
  const target = unwrapProxiedImageUrl(rawUrl);
  if (!target || target === 'logo.svg') return '';
  try {
    const u = new URL(target);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = u.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep raw pathname if percent-decoding fails
    }
    pathname = pathname.replace(/\/+/g, '/').replace(/\/+(\.\/+)+/g, '/');

    if (isContentDbHost(host)) {
      return `cdb:${pathname.toLowerCase()}`;
    }

    const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

    // 1. GitHub (`raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` or `github.com/<owner>/<repo>/(raw|blob)/<ref>/<path>`)
    if (host === 'raw.githubusercontent.com' && parts.length >= 4) {
      const owner = parts[0].toLowerCase();
      const repo = parts[1].replace(/\.git$/i, '').toLowerCase();
      const fileStartIdx =
        parts[2] === 'refs' && (parts[3] === 'heads' || parts[3] === 'tags') && parts.length >= 6
          ? 5
          : 3;
      const filePath = parts.slice(fileStartIdx).join('/').toLowerCase();
      if (filePath) {
        return `git:github.com/${owner}/${repo}/${filePath}`;
      }
    }
    if (host === 'github.com' && parts.length >= 5 && (parts[2] === 'raw' || parts[2] === 'blob')) {
      const owner = parts[0].toLowerCase();
      const repo = parts[1].replace(/\.git$/i, '').toLowerCase();
      const fileStartIdx =
        parts[3] === 'refs' && (parts[4] === 'heads' || parts[4] === 'tags') && parts.length >= 7
          ? 6
          : 4;
      const filePath = parts.slice(fileStartIdx).join('/').toLowerCase();
      if (filePath) {
        return `git:github.com/${owner}/${repo}/${filePath}`;
      }
    }

    // 2. GitLab (`<host>/<group...>/<repo>/-/(raw|blob)/<ref>/<path>` or `<host>/<owner>/<repo>/(raw|blob)/<ref>/<path>`)
    if (host.includes('gitlab') || host === 'framagit.org' || host === 'salsa.debian.org') {
      const glDashMatch = pathname.match(
        /^\/(.+?)\/-\/(?:raw|blob)\/(?:refs\/(?:heads|tags)\/[^/]+|[^/]+)\/(.+)$/i
      );
      if (glDashMatch) {
        const repoPath = glDashMatch[1].replace(/\.git$/i, '').toLowerCase();
        const filePath = glDashMatch[2].replace(/^\/+/, '').toLowerCase();
        return `git:${host}/${repoPath}/${filePath}`;
      }
      const glLegacyMatch = pathname.match(
        /^\/([^/]+\/[^/]+)\/(?:raw|blob)\/(?:refs\/(?:heads|tags)\/[^/]+|[^/]+)\/(.+)$/i
      );
      if (glLegacyMatch) {
        const repoPath = glLegacyMatch[1].replace(/\.git$/i, '').toLowerCase();
        const filePath = glLegacyMatch[2].replace(/^\/+/, '').toLowerCase();
        return `git:${host}/${repoPath}/${filePath}`;
      }
    }

    // 3. Bitbucket (`bitbucket.org/<owner>/<repo>/(raw|src)/<ref>/<path>` or `api.bitbucket.org/2.0/repositories/<owner>/<repo>/src/<ref>/<path>`)
    if (host === 'api.bitbucket.org') {
      const bbApiMatch = pathname.match(/^\/2\.0\/repositories\/([^/]+)\/([^/]+)\/src\/[^/]+\/(.+)$/i);
      if (bbApiMatch) {
        const owner = bbApiMatch[1].toLowerCase();
        const repo = bbApiMatch[2].replace(/\.git$/i, '').toLowerCase();
        const filePath = bbApiMatch[3].replace(/^\/+/, '').toLowerCase();
        return `git:bitbucket.org/${owner}/${repo}/${filePath}`;
      }
    }
    if (host === 'bitbucket.org') {
      const bbWebMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/(?:raw|src)\/[^/]+\/(.+)$/i);
      if (bbWebMatch) {
        const owner = bbWebMatch[1].toLowerCase();
        const repo = bbWebMatch[2].replace(/\.git$/i, '').toLowerCase();
        const filePath = bbWebMatch[3].replace(/^\/+/, '').toLowerCase();
        return `git:bitbucket.org/${owner}/${repo}/${filePath}`;
      }
    }

    // 4. Gitea / Forgejo / Codeberg / MeseHub
    // - `/api/v1/repos/<owner>/<repo>/(raw|media)/<path>`
    // - `/<owner>/<repo>/(raw|media|src)/(branch|commit|tag)/<ref>/<path>`
    // - `/<owner>/<repo>/(raw|media|src)/<ref>/<path>`
    const giteaApiMatch = pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/(?:raw|media)\/(.+)$/i);
    if (giteaApiMatch) {
      const owner = giteaApiMatch[1].toLowerCase();
      const repo = giteaApiMatch[2].replace(/\.git$/i, '').toLowerCase();
      const filePath = giteaApiMatch[3].replace(/^\/+/, '').toLowerCase();
      return `git:${host}/${owner}/${repo}/${filePath}`;
    }
    const giteaBranchMatch = pathname.match(
      /^\/([^/]+)\/([^/]+)\/(?:raw|media|src)\/(?:branch|commit|tag)\/[^/]+\/(.+)$/i
    );
    if (giteaBranchMatch) {
      const owner = giteaBranchMatch[1].toLowerCase();
      const repo = giteaBranchMatch[2].replace(/\.git$/i, '').toLowerCase();
      const filePath = giteaBranchMatch[3].replace(/^\/+/, '').toLowerCase();
      return `git:${host}/${owner}/${repo}/${filePath}`;
    }
    const giteaDirectMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/(?:raw|media|src)\/[^/]+\/(.+)$/i);
    if (giteaDirectMatch) {
      const owner = giteaDirectMatch[1].toLowerCase();
      const repo = giteaDirectMatch[2].replace(/\.git$/i, '').toLowerCase();
      const filePath = giteaDirectMatch[3].replace(/^\/+/, '').toLowerCase();
      return `git:${host}/${owner}/${repo}/${filePath}`;
    }

    return `${host}${pathname.toLowerCase()}${u.search.toLowerCase()}`;
  } catch {
    return target.toLowerCase();
  }
}

/**
 * Detects legacy static mirror screenshot/thumbnail paths (`/storage/screenshots/...`)
 * and synthetic `shot-0.png` banner replacements.
 * Official ContentDB (`content.luanti.org` / `cdn.content.luanti.org`) does NOT serve
 * `/storage/screenshots/...` (it returns HTTP 404); official assets use `/thumbnails/...`
 * and `/uploads/...`.
 */
export function isDeadMirrorScreenshotUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const lower = rawUrl.trim().toLowerCase();
  if (!lower || lower === 'logo.svg') return true;
  return (
    lower.includes('/storage/screenshots/') ||
    (lower.includes('/thumbnails/') && lower.endsWith('/shot-0.png'))
  );
}

/**
 * Sanitizes a single package image URL (`thumbnail` or `banner`):
 * - Rejects `'logo.svg'` and dead mirror `/storage/screenshots/...` or `/shot-0.png` URLs (returning `undefined`).
 * - Rewrites legacy `content.minetest.net` or `contentdb.milcho.org` hosts to `https://content.luanti.org/`
 *   only for valid ContentDB paths (`/thumbnails/`, `/uploads/`).
 * - Applies `toProxiedGitImageIfNeeded` for MeseHub & Codeberg raw assets.
 */
export function sanitizePackageImageUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === 'logo.svg' || isDeadMirrorScreenshotUrl(trimmed)) {
    return undefined;
  }
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/api/packages?proxy_image=')) {
    return undefined;
  }
  let normalized = toProxiedGitImageIfNeeded(trimmed);
  if (/^https?:\/\/(?:contentdb\.milcho\.org|content\.minetest\.net)\//i.test(normalized)) {
    normalized = normalized.replace(
      /^https?:\/\/(?:contentdb\.milcho\.org|content\.minetest\.net)\//i,
      'https://content.luanti.org/'
    );
  }
  if (/^https?:\/\/(?:cdn\.)?content\.luanti\.org\/thumbnails\/3\//i.test(normalized)) {
    normalized = normalized.replace(/(\/thumbnails\/)3\//i, '$11/');
  }
  return normalized;
}

/**
 * Checks whether an image URL is a ContentDB `/thumbnails/<level>/<filename>` URL.
 * ContentDB `/api/packages/` returns `/thumbnails/1/<filename>` (140×93 px), whereas
 * `/uploads/<filename>` (from `screenshots[0]`) is full original resolution.
 */
export function isContentDbThumbnailUrl(rawUrl?: string | null): boolean {
  const sanitized = sanitizePackageImageUrl(rawUrl);
  if (!sanitized) return false;
  const lower = sanitized.toLowerCase();
  return isContentDbHost(lower) && lower.includes('/thumbnails/');
}

/**
 * Sanitizes a ContentDB thumbnail URL without rewriting `/thumbnails/1/` to `/thumbnails/3/`
 * (since full-resolution ContentDB artwork is served from `/uploads/...` via `screenshots[0]`).
 */
export function upgradeContentDbThumbnailUrl(rawUrl?: string | null): string | undefined {
  return sanitizePackageImageUrl(rawUrl);
}

/**
 * Single source of truth for selecting the sharpest valid banner image across backend and frontend:
 * 1. Verified Git repository screenshot (`preferredGitShot`, e.g. `screenshot.png` / `.cdb.json`)
 * 2. First full-resolution screenshot from `screenshots` (`https://cdn.content.luanti.org/uploads/...` or Git screenshot)
 * 3. Any candidate in `bannerAndThumbCandidates` that is NOT a `/thumbnails/` URL (e.g. custom promo or `/uploads/` banner)
 * 4. First valid fallback candidate in `bannerAndThumbCandidates`
 */
export function selectSharpPackageBanner(
  preferredGitShot?: string | null,
  screenshots?: ReadonlyArray<string | { url?: string } | null | undefined> | null,
  ...bannerAndThumbCandidates: Array<string | null | undefined>
): string | undefined {
  const cleanGit = sanitizePackageImageUrl(preferredGitShot);
  if (cleanGit) {
    return cleanGit;
  }

  if (Array.isArray(screenshots)) {
    for (const entry of screenshots) {
      const raw = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.url : undefined);
      const cleanShot = sanitizePackageImageUrl(raw);
      if (cleanShot && !isContentDbThumbnailUrl(cleanShot)) {
        return cleanShot;
      }
    }
  }

  const sanitizedCandidates: string[] = [];
  for (const raw of bannerAndThumbCandidates) {
    const clean = sanitizePackageImageUrl(raw);
    if (clean) {
      sanitizedCandidates.push(clean);
    }
  }

  const nonThumbnailBanner = sanitizedCandidates.find(u => !isContentDbThumbnailUrl(u));
  if (nonThumbnailBanner) {
    return nonThumbnailBanner;
  }

  if (sanitizedCandidates.length > 0) {
    return sanitizedCandidates[0];
  }

  return undefined;
}

/**
 * Single source of truth for merging and deduplicating package screenshots across backend and frontend:
 * - Always places Git repository screenshots (`screenshot.png` / `.cdb.json`) first (`gitUrls`),
 *   followed by complementary ContentDB gallery screenshots (`otherUrls`).
 * - Normalizes MeseHub & Codeberg proxy URLs (`&ngsw-bypass=true`) and ContentDB mirror hosts (`content.luanti.org`).
 * - Rejects dead mirror `/storage/screenshots/...` and synthetic `/shot-0.png` URLs.
 * - Deduplicates Git raw URLs across branch/API variants (`/main/`, `/HEAD/`, `/raw/branch/`, `/api/v1/repos/.../raw/`)
 *   using `getCanonicalScreenshotKey`.
 * - When both a Git screenshot and multiple ContentDB gallery screenshots exist, deduplicates ContentDB's
 *   `/uploads/<hash>` copy that matches the package's `/thumbnails/<n>/<hash>` primary thumbnail.
 */
export function mergeScreenshotsPreferringGit(
  preferredGitUrls: Array<string | null | undefined>,
  ...screenshotLists: any[]
): string[] {
  const cdbThumbnailFileNames = new Set<string>();

  const extractUrl = (entry: any): string => {
    if (!entry) return '';
    if (typeof entry === 'string') return entry.trim();
    if (typeof entry === 'object' && typeof entry.url === 'string') return entry.url.trim();
    return '';
  };

  const normalizeCandidateUrl = (rawExtracted: string): string => {
    return sanitizePackageImageUrl(rawExtracted) || '';
  };

  const inspectForThumbnailHash = (raw: any) => {
    const rawUrl = extractUrl(raw);
    if (!rawUrl || isDeadMirrorScreenshotUrl(rawUrl)) return;
    const lower = rawUrl.toLowerCase();
    if (isContentDbHost(lower) && lower.includes('/thumbnails/')) {
      const m = lower.match(/\/thumbnails\/[^/]+\/([^/?#]+)/);
      if (m?.[1]) {
        cdbThumbnailFileNames.add(m[1]);
      }
    }
  };

  if (Array.isArray(preferredGitUrls)) {
    for (const u of preferredGitUrls) {
      inspectForThumbnailHash(u);
    }
  }
  for (const list of screenshotLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      inspectForThumbnailHash(item);
    }
  }

  const isFilteredThumbnailOrSyntheticBanner = (url: string): boolean => {
    const lower = url.toLowerCase();
    return (
      isDeadMirrorScreenshotUrl(lower) ||
      lower.endsWith('/shot-0.png') ||
      (isContentDbHost(lower) && lower.includes('/thumbnails/'))
    );
  };

  const gitUrls: string[] = [];
  const otherUrls: string[] = [];
  const seenKeys = new Set<string>();

  const addCandidate = (raw: any, forceGitPriority = false) => {
    const url = normalizeCandidateUrl(extractUrl(raw));
    if (!url || isFilteredThumbnailOrSyntheticBanner(url)) return;
    const key = getCanonicalScreenshotKey(url);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);

    if (forceGitPriority || isGitRepositoryAssetUrl(url)) {
      gitUrls.push(url);
    } else {
      otherUrls.push(url);
    }
  };

  if (Array.isArray(preferredGitUrls)) {
    for (const raw of preferredGitUrls) {
      const extracted = extractUrl(raw);
      if (extracted && isGitRepositoryAssetUrl(extracted)) {
        addCandidate(extracted, true);
      }
    }
  }

  for (const list of screenshotLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      addCandidate(item, false);
    }
  }

  if (gitUrls.length === 0) {
    return otherUrls;
  }

  // When a Git screenshot is present alongside a multi-image ContentDB gallery (`otherUrls.length > 1`),
  // remove ContentDB's `/uploads/<filename>` entry if it is just the primary `/thumbnails/<n>/<filename>` duplicate.
  // Keep `otherUrls` intact when `otherUrls.length === 1` so single-image packages always retain a fallback screenshot.
  const filteredOtherUrls =
    otherUrls.length > 1 && cdbThumbnailFileNames.size > 0
      ? otherUrls.filter(u => {
          const m = u.toLowerCase().match(/\/uploads\/([^/?#]+)/);
          return !(m?.[1] && cdbThumbnailFileNames.has(m[1]));
        })
      : otherUrls;

  return [...gitUrls, ...filteredOtherUrls];
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

/**
 * Normalizes a Git repository URL into a canonical `host/owner/repo` key for deduplication
 * across ContentDB and D1 Git packages.
 */
export function normalizeRepoComparisonKey(urlStr?: string | null): string {
  if (!urlStr || typeof urlStr !== 'string') return '';
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const cleanPath = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '')
      .toLowerCase();
    const parts = cleanPath.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `${host}/${parts[0]}/${parts[1]}`;
    }
    return cleanPath ? `${host}/${cleanPath}` : '';
  } catch {
    return '';
  }
}

export const normalizeRepoKey = normalizeRepoComparisonKey;



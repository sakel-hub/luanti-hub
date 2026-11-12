// Secure session cookie & admin role management using Web Crypto API
import { fetchWithAnubisSupport } from '../../lib/upstream';

async function getKey(secret?: string): Promise<CryptoKey> {
  const normalizedSecret = typeof secret === 'string' ? secret.trim() : '';
  if (!normalizedSecret) {
    throw new Error('SESSION_SECRET environment variable is required for cryptographic token operations');
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(normalizedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export interface SessionTokenClaims {
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  provider?: string;
  role?: string;
  verified?: boolean;
  dbPending?: boolean;
  exp?: number;
}

const reconciledUserIdsInIsolate = new Set<string>();
const isolateUserProfileCache = new Map<string, { exp: number; payload: any }>();

export function getCachedAuthMePayload(userId: string, allowStaleOnError = false): any | null {
  if (!userId) return null;
  const entry = isolateUserProfileCache.get(userId);
  if (!entry) return null;
  if (!allowStaleOnError && Date.now() > entry.exp) {
    return null;
  }
  return entry.payload;
}

export function setCachedAuthMePayload(userId: string, payload: any, ttlMs = 300_000): void {
  if (!userId || !payload) return;
  if (isolateUserProfileCache.size > 200) {
    const oldest = isolateUserProfileCache.keys().next().value;
    if (oldest) isolateUserProfileCache.delete(oldest);
  }
  isolateUserProfileCache.set(userId, {
    exp: Date.now() + ttlMs,
    payload
  });
}

export function invalidateCachedAuthMePayload(userId?: string): void {
  if (!userId) {
    isolateUserProfileCache.clear();
    return;
  }
  isolateUserProfileCache.delete(userId);
}

function encodeUtf8Base64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(str);
  }
}

function decodeUtf8Base64(b64: string): string {
  const raw = atob(b64);
  try {
    return decodeURIComponent(escape(raw));
  } catch {
    return raw;
  }
}

export async function createSessionToken(
  userId: string,
  secret?: string,
  claims?: Partial<SessionTokenClaims>
): Promise<string> {
  const payloadObj: Record<string, any> = {
    userId,
    exp: Date.now() + 86400000 * 30 // 30 days
  };
  if (claims?.username) payloadObj['u'] = String(claims.username).slice(0, 64);
  if (claims?.displayName) payloadObj['d'] = String(claims.displayName).slice(0, 80);
  if (claims?.avatarUrl) payloadObj['a'] = String(claims.avatarUrl).slice(0, 250);
  if (claims?.provider) payloadObj['p'] = String(claims.provider).slice(0, 24);
  if (claims?.role) payloadObj['r'] = String(claims.role).slice(0, 20);
  if (typeof claims?.verified === 'boolean') payloadObj['v'] = claims.verified ? 1 : 0;
  if (claims?.dbPending) payloadObj['dp'] = 1;

  const payload = JSON.stringify(payloadObj);
  const enc = new TextEncoder();
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const b64Payload = encodeUtf8Base64(payload);
  const b64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${b64Payload}.${b64Sig}`;
}

export async function verifySessionTokenClaims(
  token: string,
  secret?: string
): Promise<SessionTokenClaims | null> {
  try {
    const [b64Payload, b64Sig] = token.split('.');
    if (!b64Payload || !b64Sig) return null;

    const payload = decodeUtf8Base64(b64Payload);
    const data = JSON.parse(payload);
    if (!data?.userId) return null;
    if (data.exp && Date.now() > data.exp) return null;

    const key = await getKey(secret);
    const enc = new TextEncoder();
    const sigBytes = Uint8Array.from(atob(b64Sig), c => c.charCodeAt(0));

    let isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    if (!isValid) {
      // Fallback for legacy ASCII-only payloads
      const rawPayload = atob(b64Payload);
      isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(rawPayload));
    }
    if (!isValid) return null;

    return {
      userId: String(data.userId),
      username: typeof data.u === 'string' && data.u ? data.u : undefined,
      displayName: typeof data.d === 'string' && data.d ? data.d : undefined,
      avatarUrl: typeof data.a === 'string' && data.a ? data.a : undefined,
      provider: typeof data.p === 'string' && data.p ? data.p : undefined,
      role: typeof data.r === 'string' && data.r ? data.r : undefined,
      verified: data.v !== undefined ? Boolean(data.v) : undefined,
      dbPending: data.dp === 1 ? true : undefined,
      exp: typeof data.exp === 'number' ? data.exp : undefined
    };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string, secret?: string): Promise<string | null> {
  const claims = await verifySessionTokenClaims(token, secret);
  return claims ? claims.userId : null;
}

export async function createAuditProofToken(repoKey: string, secret?: string): Promise<string> {
  const payload = JSON.stringify({
    repoKey: repoKey.trim().toLowerCase(),
    exp: Date.now() + 15 * 60 * 1000 // 15 minutes
  });
  const enc = new TextEncoder();
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const b64Payload = btoa(payload);
  const b64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${b64Payload}.${b64Sig}`;
}

export async function verifyAuditProofToken(
  token: string | undefined,
  expectedRepoKey: string,
  secret?: string
): Promise<boolean> {
  try {
    if (!token) return false;
    const [b64Payload, b64Sig] = token.split('.');
    if (!b64Payload || !b64Sig) return false;

    const payload = atob(b64Payload);
    const data = JSON.parse(payload);
    if (!data?.repoKey || data.repoKey !== expectedRepoKey.trim().toLowerCase()) return false;
    if (!data?.exp || Date.now() > data.exp) return false;

    const key = await getKey(secret);
    const enc = new TextEncoder();
    const sigBytes = Uint8Array.from(atob(b64Sig), c => c.charCodeAt(0));

    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  } catch {
    return false;
  }
}

function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64Url: string): string {
  let b64 = b64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  return atob(b64);
}

export function isTrustedLuantiHubOrigin(rawOrigin?: string | null): boolean {
  if (!rawOrigin || typeof rawOrigin !== 'string') return false;
  try {
    const parsed = new URL(rawOrigin.trim());
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === 'https:') {
      return (
        host === 'luantihub.org' ||
        host === 'www.luantihub.org' ||
        host.endsWith('.luantihub.org') ||
        host === 'luanti-hub.pages.dev' ||
        host.endsWith('.luanti-hub.pages.dev')
      );
    }
    if (parsed.protocol === 'http:') {
      return host === 'localhost' || host === '127.0.0.1';
    }
    return false;
  } catch {
    return false;
  }
}

const CSRF_REJECT_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache'
};

function isMatchingRequestHost(candidateUrl: string, requestHost: string): boolean {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const candidateHost = parsed.host.toLowerCase();
    if (candidateHost === requestHost) {
      return true;
    }
    const candidateHostname = parsed.hostname.toLowerCase();
    const requestHostname = requestHost.split(':')[0].toLowerCase();
    if (
      (candidateHostname === 'localhost' || candidateHostname === '127.0.0.1') &&
      (requestHostname === 'localhost' || requestHostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Unified CSRF & Cross-Origin Mutation Guard for state-changing Edge API routes.
 * Blocks cross-site / cross-subdomain Fetch Metadata (`Sec-Fetch-Site`), HTML `<form>` navigation
 * submissions (`Sec-Fetch-Mode: navigate` or form-encoded `Content-Type`), opaque `Origin: null`,
 * and cross-origin `Origin` / `Referer` headers.
 */
export function verifySameOriginMutation(
  request: Request,
  options?: { allowSimpleBeacon?: boolean }
): Response | null {
  let requestHost = '';
  try {
    requestHost = new URL(request.url).host.toLowerCase();
  } catch {
    return Response.json(
      { error: 'Forbidden: Malformed request URL.' },
      { status: 403, headers: CSRF_REJECT_HEADERS }
    );
  }

  const allowSimpleBeacon = Boolean(options?.allowSimpleBeacon);

  const secFetchSite = (request.headers.get('Sec-Fetch-Site') || '').trim().toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return Response.json(
      { error: 'Forbidden: Cross-site mutation requests are blocked.' },
      { status: 403, headers: CSRF_REJECT_HEADERS }
    );
  }

  const secFetchMode = (request.headers.get('Sec-Fetch-Mode') || '').trim().toLowerCase();
  if (secFetchMode === 'navigate' || (secFetchMode === 'no-cors' && !allowSimpleBeacon)) {
    return Response.json(
      { error: 'Forbidden: Browser navigation or opaque mutation requests are blocked.' },
      { status: 403, headers: CSRF_REJECT_HEADERS }
    );
  }

  const contentType = (request.headers.get('Content-Type') || '').trim().toLowerCase();
  if (
    contentType.startsWith('application/x-www-form-urlencoded') ||
    contentType.startsWith('multipart/form-data') ||
    (contentType.startsWith('text/plain') && !allowSimpleBeacon)
  ) {
    return Response.json(
      { error: 'Forbidden: HTML form content types are not accepted on JSON API endpoints.' },
      { status: 403, headers: CSRF_REJECT_HEADERS }
    );
  }

  const originHeader = request.headers.get('Origin');
  if (originHeader !== null) {
    const trimmedOrigin = originHeader.trim();
    if (!trimmedOrigin || trimmedOrigin.toLowerCase() === 'null' || !isMatchingRequestHost(trimmedOrigin, requestHost)) {
      return Response.json(
        { error: 'Forbidden: Invalid request origin.' },
        { status: 403, headers: CSRF_REJECT_HEADERS }
      );
    }
  }

  const refererHeader = request.headers.get('Referer');
  if (refererHeader !== null && refererHeader.trim() !== '') {
    if (!isMatchingRequestHost(refererHeader.trim(), requestHost)) {
      return Response.json(
        { error: 'Forbidden: Invalid request referer.' },
        { status: 403, headers: CSRF_REJECT_HEADERS }
      );
    }
  }

  return null;
}

export function getSharedCookieDomain(requestUrl: URL | string): string | null {
  try {
    const u = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
    const host = u.hostname.toLowerCase();
    if (host === 'luantihub.org' || host.endsWith('.luantihub.org')) {
      return '.luantihub.org';
    }
    return null;
  } catch {
    return null;
  }
}

export function buildSessionCookie(
  token: string,
  requestUrl: URL | string,
  maxAgeSeconds = 86400 * 30
): string {
  const u = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
  const isHttps = u.protocol === 'https:';
  const domain = getSharedCookieDomain(u);
  return `lh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${domain ? `; Domain=${domain}` : ''}${isHttps ? '; Secure' : ''}`;
}

export function buildClearSessionCookies(requestUrl: URL | string): string[] {
  const u = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
  const isHttps = u.protocol === 'https:';
  const domain = getSharedCookieDomain(u);
  const cookies = [
    `lh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
  ];
  if (domain) {
    cookies.push(
      `lh_session=; Path=/; Domain=${domain}; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
    );
  }
  return cookies;
}

export function buildOAuthStateCookie(
  state: string,
  requestUrl: URL | string,
  maxAgeSeconds = 600
): string {
  const u = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
  const isHttps = u.protocol === 'https:';
  const domain = getSharedCookieDomain(u);
  return `lh_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${domain ? `; Domain=${domain}` : ''}${isHttps ? '; Secure' : ''}`;
}

export function buildClearOAuthStateCookies(requestUrl: URL | string): string[] {
  const u = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
  const isHttps = u.protocol === 'https:';
  const domain = getSharedCookieDomain(u);
  const cookies = [
    `lh_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
  ];
  if (domain) {
    cookies.push(
      `lh_oauth_state=; Path=/; Domain=${domain}; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
    );
  }
  return cookies;
}

export function sanitizeRelativeReturnPath(rawPath?: string | null): string | undefined {
  if (!rawPath || typeof rawPath !== 'string') return undefined;
  const trimmed = rawPath.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    /[\r\n\0]/.test(trimmed) ||
    trimmed.length > 240
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed, 'https://luantihub.org');
    if (parsed.origin !== 'https://luantihub.org') return undefined;
    parsed.searchParams.delete('auth_success');
    parsed.searchParams.delete('auth_error');
    parsed.searchParams.delete('provider');
    const qs = parsed.searchParams.toString();
    return `${parsed.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return undefined;
  }
}

export async function createOAuthStateToken(
  provider: string,
  secret?: string,
  options?: { origin?: string; returnTo?: string }
): Promise<string> {
  const trustedOrigin =
    options?.origin && isTrustedLuantiHubOrigin(options.origin)
      ? new URL(options.origin.trim()).origin
      : undefined;
  const safeReturnTo = sanitizeRelativeReturnPath(options?.returnTo);
  const payload = JSON.stringify({
    p: provider.trim().toLowerCase(),
    n: crypto.randomUUID().slice(0, 8),
    ...(trustedOrigin ? { o: trustedOrigin } : {}),
    ...(safeReturnTo && safeReturnTo !== '/' ? { r: safeReturnTo } : {}),
    exp: Date.now() + 15 * 60 * 1000 // 15 minutes
  });
  const enc = new TextEncoder();
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const b64Payload = toBase64Url(payload);
  const b64Sig = toBase64Url(String.fromCharCode(...new Uint8Array(signature)));
  return `${b64Payload}.${b64Sig}`;
}

export async function parseOAuthStateToken(
  token: string | undefined | null,
  expectedProvider: string,
  secret?: string
): Promise<{ valid: boolean; origin?: string; returnTo?: string }> {
  try {
    if (!token) return { valid: false };
    const [b64Payload, b64Sig] = token.split('.');
    if (!b64Payload || !b64Sig) return { valid: false };

    const payload = fromBase64Url(b64Payload);
    const data = JSON.parse(payload);
    if (!data?.p || data.p !== expectedProvider.trim().toLowerCase()) return { valid: false };
    if (!data?.exp || Date.now() > data.exp) return { valid: false };

    const key = await getKey(secret);
    const enc = new TextEncoder();
    const sigStr = fromBase64Url(b64Sig);
    const sigBytes = Uint8Array.from(sigStr, c => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    if (!isValid) return { valid: false };

    return {
      valid: true,
      origin: data.o && isTrustedLuantiHubOrigin(data.o) ? new URL(data.o).origin : undefined,
      returnTo: typeof data.r === 'string' ? sanitizeRelativeReturnPath(data.r) : undefined
    };
  } catch {
    return { valid: false };
  }
}

export async function verifyOAuthStateToken(
  token: string | undefined | null,
  expectedProvider: string,
  secret?: string
): Promise<boolean> {
  const parsed = await parseOAuthStateToken(token, expectedProvider, secret);
  return parsed.valid;
}

function extractTokenExp(token: string): number {
  try {
    const [b64Payload] = token.split('.');
    if (!b64Payload) return 0;
    const data = JSON.parse(atob(b64Payload));
    return typeof data?.exp === 'number' ? data.exp : 0;
  } catch {
    return 0;
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies: Record<string, string> = {};
  for (const cookie of cookieHeader.split(';')) {
    const idx = cookie.indexOf('=');
    if (idx > 0) {
      const k = cookie.slice(0, idx).trim();
      const v = cookie.slice(idx + 1).trim();
      if (k && v) {
        const decoded = decodeURIComponent(v);
        if (k === 'lh_session' && cookies[k]) {
          // If both a legacy host-only and a shared .luantihub.org cookie exist, prefer the newest token
          if (extractTokenExp(decoded) >= extractTokenExp(cookies[k])) {
            cookies[k] = decoded;
          }
        } else {
          cookies[k] = decoded;
        }
      }
    }
  }
  return cookies;
}

/**
 * Determines whether a user qualifies as an Admin by matching a VERIFIED identity
 * against the `ADMIN_USERS` environment variable (or D1 `role` if `ADMIN_USERS` is not set).
 */
export function checkIsAdmin(
  user: { username?: string; role?: string } | null,
  identities: Array<{ provider: string; username: string; verified?: number | boolean }> = [],
  adminUsersEnv?: string
): boolean {
  if (!user) return false;

  const verifiedIdentities = identities.filter(id => id.verified === 1 || id.verified === true);
  const hasVerifiedIdentity = verifiedIdentities.length > 0;

  if (!hasVerifiedIdentity) {
    return false;
  }

  const rawList = (adminUsersEnv || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  if (rawList.length > 0) {
    for (const id of verifiedIdentities) {
      const handle = (id.username || (id as any).provider_username || '').trim().toLowerCase();
      if (!handle) continue;
      const qualified = `${(id.provider || '').toLowerCase()}:${handle}`;
      if (rawList.includes(handle) || rawList.includes(qualified)) {
        return true;
      }
    }

    return false;
  }

  return user.role === 'admin' || user.role === 'moderator';
}

/**
 * Checks whether a username is listed in the protected `ADMIN_USERS` environment variable
 */
export function isProtectedAdminHandle(username: string, provider?: string, adminUsersEnv?: string): boolean {
  const rawList = (adminUsersEnv || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (rawList.length === 0) return false;
  const lower = (username || '').trim().toLowerCase();
  const baseLower = lower.replace(/_(gi|gl|co|cd|me)$/i, '');
  if (!lower) return false;
  if (rawList.includes(lower) || rawList.includes(baseLower)) return true;
  if (provider && (rawList.includes(`${provider.toLowerCase()}:${lower}`) || rawList.includes(`${provider.toLowerCase()}:${baseLower}`))) {
    return true;
  }
  return false;
}

function inferRepoForgeProvider(repoUrlRaw?: string): string {
  const repoUrl = String(repoUrlRaw || '').trim();
  if (!repoUrl) return '';
  try {
    const host = new URL(repoUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
    if (host === 'codeberg.org' || host.endsWith('.codeberg.org')) return 'codeberg';
    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return 'gitlab';
    if (host === 'git.minetest.land' || host === 'mese.hub') return 'mesehub';
    if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) return 'bitbucket';
    return 'custom';
  } catch {
    const lower = repoUrl.toLowerCase();
    if (lower.includes('github.com')) return 'github';
    if (lower.includes('codeberg.org')) return 'codeberg';
    if (lower.includes('gitlab.com')) return 'gitlab';
    if (lower.includes('minetest.land') || lower.includes('mese.hub')) return 'mesehub';
    if (lower.includes('bitbucket.org')) return 'bitbucket';
    return 'custom';
  }
}

export function inferPackageProvider(pkgRow?: { provider?: string; repo_url?: string } | null): string {
  const explicit = String(pkgRow?.provider || '').trim().toLowerCase();
  if (
    explicit &&
    ['github', 'codeberg', 'gitlab', 'mesehub', 'contentdb', 'bitbucket', 'custom'].includes(explicit)
  ) {
    return explicit;
  }
  const fromRepo = inferRepoForgeProvider(pkgRow?.repo_url);
  return fromRepo || 'contentdb';
}

/**
 * Cryptographically strict package author ownership verification.
 * Prevents cross-forge username spoofing and rejects unverified direct-handle sessions:
 * - Requires at least one verified identity (`verified === 1 | true`)
 * - Requires the verified identity to be on the EXACT forge provider where the package is hosted
 *   (or verified ContentDB ownership when the package is published on ContentDB).
 */
export function verifyStrictPackageAuthorOwnership(
  user: { id?: string; username?: string } | null,
  identities: Array<{ provider?: string; username?: string; provider_username?: string; verified?: number | boolean }> = [],
  pkgRow: {
    author_id?: string;
    author_name?: string;
    provider?: string;
    repo_url?: string;
    tags?: string | string[];
    contentdb_downloads?: number;
    has_contentdb?: boolean;
  } | null,
  fallbackAuthor?: string
): boolean {
  if (!user || !user.id || !pkgRow) return false;

  // 1. Explicitly verified & claimed package ownership in D1 (via Git submission OAuth check or Admin/Moderator approval)
  const pkgAuthorId = String(pkgRow.author_id || '').trim();
  if (pkgAuthorId && !pkgAuthorId.startsWith('ext_') && pkgAuthorId === String(user.id)) {
    return true;
  }

  const verifiedIdentities = identities.filter(id => id.verified === 1 || id.verified === true);
  if (verifiedIdentities.length === 0) {
    return false;
  }

  const pkgProvider = inferPackageProvider(pkgRow);
  const repoForgeProvider = inferRepoForgeProvider(pkgRow.repo_url);
  const pkgAuthor = String(pkgRow.author_name || fallbackAuthor || '').trim().toLowerCase();
  let repoOwner = '';
  if (pkgRow.repo_url) {
    try {
      const parts = new URL(pkgRow.repo_url).pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        repoOwner = parts[0].trim().toLowerCase();
      }
    } catch {
      // ignore
    }
  }

  const rawTags = typeof pkgRow.tags === 'string' ? pkgRow.tags.toLowerCase() : Array.isArray(pkgRow.tags) ? pkgRow.tags.join(',').toLowerCase() : '';
  const isDualOrOfficialContentDb =
    pkgProvider === 'contentdb' ||
    pkgRow.has_contentdb === true ||
    Number(pkgRow.contentdb_downloads || 0) > 0 ||
    rawTags.includes('"contentdb"') ||
    rawTags.includes('"official"');

  // 2. Verified identity on the exact package forge provider (never `'custom'`), or verified ContentDB/repo-forge identity on official ContentDB packages
  return verifiedIdentities.some(id => {
    const idProvider = String(id.provider || '').trim().toLowerCase();
    const idUsername = String(id.username || id.provider_username || '').trim().toLowerCase();
    if (!idProvider || !idUsername) return false;

    if (pkgProvider !== 'custom' && idProvider === pkgProvider) {
      if ((pkgAuthor && idUsername === pkgAuthor) || (repoOwner && idUsername === repoOwner)) {
        return true;
      }
    }

    if (isDualOrOfficialContentDb) {
      if (idProvider === 'contentdb' && pkgAuthor && idUsername === pkgAuthor) {
        return true;
      }
      if (
        repoForgeProvider &&
        repoForgeProvider !== 'custom' &&
        idProvider === repoForgeProvider &&
        repoOwner &&
        idUsername === repoOwner
      ) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Cryptographically strict author portfolio ownership verification for author-wide analytics.
 * Requires at least one verified identity (`verified === 1 | true`) matching the target author handle.
 */
export function verifyStrictAuthorPortfolioOwnership(
  user: { id?: string; username?: string } | null,
  identities: Array<{ provider?: string; username?: string; provider_username?: string; verified?: number | boolean }> = [],
  targetUsername?: string | null
): boolean {
  if (!user || !user.id || !targetUsername) return false;
  const targetLower = targetUsername.trim().toLowerCase();
  if (!targetLower) return false;

  const verifiedIdentities = identities.filter(id => id.verified === 1 || id.verified === true);
  if (verifiedIdentities.length === 0) return false;

  const userLower = String(user.username || '').trim().toLowerCase();
  if (userLower === targetLower) {
    return true;
  }

  return verifiedIdentities.some(id => {
    const idUsername = String(id.username || id.provider_username || '').trim().toLowerCase();
    return idUsername === targetLower;
  });
}

/**
 * Deduplicates `user_identities` rows for the same (user_id, provider, LOWER(provider_username))
 * and automatically merges duplicate suffixed accounts (e.g. `username_gi` -> `username`)
 * or orphaned `user_identities` rows whose parent `users` row was deleted.
 */
async function canSafelyAutoMergeAccounts(db: any, primaryId: string, secondaryId: string): Promise<boolean> {
  if (!db || !primaryId || !secondaryId || primaryId === secondaryId) return false;
  try {
    if (String(secondaryId).startsWith('ext_')) {
      const secVerified = await db.prepare(
        `SELECT COUNT(*) as cnt FROM user_identities WHERE user_id = ? AND verified = 1`
      ).bind(secondaryId).first();
      if (!secVerified || Number(secVerified.cnt) === 0) {
        return true;
      }
    }
    const sharedIdentity = await db.prepare(
      `SELECT 1 as ok
       FROM user_identities p
       JOIN user_identities s
         ON LOWER(p.provider) = LOWER(s.provider)
        AND p.provider_user_id = s.provider_user_id
       WHERE p.user_id = ?
         AND s.user_id = ?
         AND p.verified = 1
         AND s.verified = 1
       LIMIT 1`
    ).bind(primaryId, secondaryId).first();
    return Boolean(sharedIdentity?.ok);
  } catch {
    return false;
  }
}

export async function reconcileAndMergeUserAccount(
  db: any,
  currentUserId: string,
  forceReconcile = false
): Promise<any | null> {
  if (!db || !currentUserId) return null;

  let user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(currentUserId).first();

  if (user && !forceReconcile && reconciledUserIdsInIsolate.has(String(user.id))) {
    const rawU = String(user.username || '').trim();
    const baseU = rawU.replace(/_(gi|gl|co|cd|me)$/i, '');
    if (rawU && rawU.toLowerCase() === baseU.toLowerCase()) {
      return user;
    }
  }

  // Self-heal if currentUserId was deleted from `users` while `lh_session` or `user_identities` still references it
  if (!user) {
    try {
      const orphanedIdentity = await db.prepare(
        `SELECT * FROM user_identities WHERE user_id = ? AND verified = 1 ORDER BY id ASC LIMIT 1`
      ).bind(currentUserId).first();

      if (orphanedIdentity && orphanedIdentity.provider_username) {
        const orphanedUsername = String(orphanedIdentity.provider_username).trim();
        const orphanedBase = orphanedUsername.replace(/_(gi|gl|co|cd|me)$/i, '');

        const existingBySameProviderId = await db.prepare(
          `SELECT u.*
           FROM users u
           JOIN user_identities ui ON ui.user_id = u.id
           WHERE LOWER(ui.provider) = LOWER(?)
             AND ui.provider_user_id = ?
             AND ui.verified = 1
             AND u.id != ?
           LIMIT 1`
        ).bind(orphanedIdentity.provider, orphanedIdentity.provider_user_id, currentUserId).first();

        if (existingBySameProviderId) {
          await mergeSecondaryUserIntoPrimary(db, existingBySameProviderId.id, currentUserId);
          user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(existingBySameProviderId.id).first();
        } else {
          const conflictingUser = await db.prepare(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
          ).bind(orphanedBase).first();
          const safeUsername = conflictingUser
            ? await resolveUniqueCandidateUsername(db, orphanedBase, String(orphanedIdentity.provider || 'github'))
            : orphanedBase;
          const avatarUrl = orphanedIdentity.avatar_url || `https://github.com/${orphanedBase}.png`;
          await db.prepare(
            `INSERT INTO users (id, username, display_name, avatar_url, role) VALUES (?, ?, ?, ?, 'user')`
          ).bind(currentUserId, safeUsername, orphanedBase, avatarUrl).run();
          user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(currentUserId).first();
        }
      }
    } catch {
      // Non-fatal if self-heal fails
    }
  }

  if (!user) return null;

  const rawUsername = String(user.username || '').trim();
  const baseUsername = rawUsername.replace(/_(gi|gl|co|cd|me)$/i, '');
  const hasProviderSuffix = baseUsername.toLowerCase() !== rawUsername.toLowerCase();

  try {
    if (hasProviderSuffix) {
      // Check if the canonical base user exists
      const canonicalUser = await db.prepare(
        `SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1`
      ).bind(baseUsername, user.id).first();

      if (canonicalUser) {
        if (await canSafelyAutoMergeAccounts(db, canonicalUser.id, user.id)) {
          await mergeSecondaryUserIntoPrimary(db, canonicalUser.id, user.id);
          user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(canonicalUser.id).first();
        }
      } else {
        // No other user owns the base username — rename suffixed username back to baseUsername
        await db.prepare(`UPDATE users SET username = ? WHERE id = ?`).bind(baseUsername, user.id).run();
        user.username = baseUsername;
      }
    } else {
      // Current user is the canonical base user.
      // Only merge suffixed duplicates (`_gi`, `_gl`, `_co`, `_cd`, `_me`) if they are unverified `ext_*` stubs
      // or share a verified `(provider, provider_user_id)` with this user.
      const suffixedDuplicates = await db.prepare(
        `SELECT id, username FROM users
         WHERE id != ?
           AND (
             LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
           )`
      ).bind(
        user.id,
        `${baseUsername}_gi`,
        `${baseUsername}_gl`,
        `${baseUsername}_co`,
        `${baseUsername}_cd`,
        `${baseUsername}_me`
      ).all();

      for (const dup of suffixedDuplicates.results || []) {
        if (dup?.id && (await canSafelyAutoMergeAccounts(db, user.id, String(dup.id)))) {
          await mergeSecondaryUserIntoPrimary(db, user.id, String(dup.id));
        }
      }
    }

    // Reattach orphaned user_identities only when they share a verified `(provider, provider_user_id)`
    if (user?.id && baseUsername) {
      const orphanedIdentities = await db.prepare(
        `SELECT DISTINCT ui.user_id
         FROM user_identities ui
         LEFT JOIN users u ON u.id = ui.user_id
         WHERE ui.user_id != ?
           AND LOWER(ui.provider_username) = LOWER(?)
           AND u.id IS NULL`
      ).bind(user.id, baseUsername).all();

      for (const row of orphanedIdentities.results || []) {
        if (row?.user_id && (await canSafelyAutoMergeAccounts(db, user.id, String(row.user_id)))) {
          await mergeSecondaryUserIntoPrimary(db, user.id, String(row.user_id));
        }
      }
    }

    // Deduplicate any multiple user_identities rows for the same provider on the resolved user
    if (user?.id) {
      await deduplicateUserIdentities(db, user.id);
    }
  } catch {
    // Non-fatal if a table is missing in local dev
  }

  if (user?.id) {
    reconciledUserIdsInIsolate.add(String(user.id));
  }

  return user;
}

export async function mergeSecondaryUserIntoPrimary(db: any, primaryId: string, secondaryId: string): Promise<void> {
  if (!db || !primaryId || !secondaryId || primaryId === secondaryId) return;

  // Never merge into a primaryId that does not exist in the `users` table
  const primaryUser = await db.prepare(`SELECT id FROM users WHERE id = ?`).bind(primaryId).first();
  if (!primaryUser) return;

  try {
    const secondaryIdentities = await db.prepare(
      `SELECT * FROM user_identities WHERE user_id = ?`
    ).bind(secondaryId).all();

    for (const secId of secondaryIdentities.results || []) {
      const existingPrimaryId = await db.prepare(
        `SELECT * FROM user_identities
         WHERE user_id = ? AND provider = ? AND LOWER(provider_username) = LOWER(?)
         LIMIT 1`
      ).bind(primaryId, secId.provider, secId.provider_username).first();

      if (existingPrimaryId) {
        const mergedVerified = Math.max(Number(existingPrimaryId.verified) || 0, Number(secId.verified) || 0);
        // Prefer OAuth numeric/canonical provider_user_id over lowercase username string
        const preferredProviderUserId =
          secId.verified && secId.provider_user_id !== String(secId.provider_username || '').toLowerCase()
            ? secId.provider_user_id
            : existingPrimaryId.provider_user_id;

        await db.prepare(`DELETE FROM user_identities WHERE id = ?`).bind(secId.id).run();
        await db.prepare(
          `DELETE FROM user_identities WHERE provider = ? AND provider_user_id = ? AND id != ?`
        ).bind(secId.provider, preferredProviderUserId, existingPrimaryId.id).run();
        await db.prepare(
          `UPDATE user_identities
           SET verified = ?, provider_user_id = ?, avatar_url = COALESCE(NULLIF(?, ''), avatar_url)
           WHERE id = ?`
        ).bind(mergedVerified, preferredProviderUserId, secId.avatar_url || '', existingPrimaryId.id).run();
      } else {
        await db.prepare(
          `UPDATE OR IGNORE user_identities SET user_id = ? WHERE id = ?`
        ).bind(primaryId, secId.id).run();
        await db.prepare(`DELETE FROM user_identities WHERE id = ? AND user_id = ?`).bind(secId.id, secondaryId).run();
      }
    }
  } catch {
    // Ignore identity merge error
  }

  try {
    await db.prepare(`UPDATE packages SET author_id = ? WHERE author_id = ?`).bind(primaryId, secondaryId).run();
  } catch {
    // Ignore if packages table missing
  }

  try {
    await db.prepare(`UPDATE OR IGNORE user_favorites SET user_id = ? WHERE user_id = ?`).bind(primaryId, secondaryId).run();
    await db.prepare(`DELETE FROM user_favorites WHERE user_id = ?`).bind(secondaryId).run();
  } catch {
    // Ignore if user_favorites table missing
  }

  try {
    await db.prepare(`
      INSERT INTO user_downloads (user_id, package_id, download_count, last_downloaded_at)
      SELECT ?, package_id, download_count, last_downloaded_at FROM user_downloads WHERE user_id = ?
      ON CONFLICT(user_id, package_id)
      DO UPDATE SET
        download_count = user_downloads.download_count + excluded.download_count,
        last_downloaded_at = MAX(user_downloads.last_downloaded_at, excluded.last_downloaded_at)
    `).bind(primaryId, secondaryId).run();
    await db.prepare(`DELETE FROM user_downloads WHERE user_id = ?`).bind(secondaryId).run();
  } catch {
    // Ignore if user_downloads table not yet initialized
  }

  try {
    await db.prepare(`UPDATE OR IGNORE reviews SET user_id = ? WHERE user_id = ?`).bind(primaryId, secondaryId).run();
    await db.prepare(`DELETE FROM reviews WHERE user_id = ?`).bind(secondaryId).run();
  } catch {
    // Ignore if reviews table missing
  }

  try {
    const secUser = await db.prepare(`SELECT role FROM users WHERE id = ?`).bind(secondaryId).first();
    if (secUser?.role === 'admin') {
      await db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(primaryId).run();
    }
    await db.prepare(`DELETE FROM users WHERE id = ?`).bind(secondaryId).run();
  } catch {
    // Ignore if secondary user row already deleted
  }
}

async function deduplicateUserIdentities(db: any, userId: string): Promise<void> {
  const allRes = await db.prepare(
    `SELECT * FROM user_identities WHERE user_id = ? ORDER BY verified DESC, created_at DESC`
  ).bind(userId).all();
  const seenByProvider = new Map<string, any>();

  for (const row of allRes.results || []) {
    const key = `${String(row.provider).toLowerCase()}::${String(row.provider_username).toLowerCase()}`;
    const existing = seenByProvider.get(key);
    if (!existing) {
      seenByProvider.set(key, row);
    } else {
      const mergedVerified = Math.max(Number(existing.verified) || 0, Number(row.verified) || 0);
      await db.prepare(`UPDATE user_identities SET verified = ? WHERE id = ?`).bind(mergedVerified, existing.id).run();
      await db.prepare(`DELETE FROM user_identities WHERE id = ?`).bind(row.id).run();
    }
  }
}

export type ProviderTokenFailureReason =
  | 'invalid_token'
  | 'username_mismatch'
  | 'excessive_scopes'
  | 'upstream_error';

export interface ProviderTokenVerificationResult {
  verified: boolean;
  failureReason?: ProviderTokenFailureReason;
  providerUserId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  bio?: string;
}

export function getProviderCollisionSuffix(provider: string): 'gi' | 'gl' | 'co' | 'cd' | 'me' {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'gitlab') return 'gl';
  if (p === 'codeberg') return 'co';
  if (p === 'contentdb') return 'cd';
  if (p === 'mesehub') return 'me';
  return 'gi';
}

export async function resolveUniqueCandidateUsername(
  db: any,
  baseUsername: string,
  provider: string
): Promise<string> {
  const suffix = getProviderCollisionSuffix(provider);
  const cleanBase = String(baseUsername || '').trim().slice(0, 32);
  const preferred = `${cleanBase}_${suffix}`;
  if (!db) return preferred;
  try {
    const taken = await db
      .prepare(`SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`)
      .bind(preferred)
      .first();
    if (!taken) {
      return preferred;
    }
  } catch {
    return preferred;
  }
  return `${cleanBase.slice(0, 27)}_${suffix}_${crypto.randomUUID().slice(0, 4)}`;
}

/**
 * Inspects upstream OAuth/PAT scope response headers (`X-OAuth-Scopes`, `X-Gitea-Scopes`)
 * and returns `true` when any write, repository-mutation, or administrative scope is present.
 * Zero-scope (`""`) and strictly read-only scopes (`read:*`, `user:email`, `read_user`) are permitted.
 */
export function hasExcessiveTokenScopes(headers?: Headers | null, provider?: string): boolean {
  if (!headers || typeof headers.get !== 'function') return false;
  const rawScopes = [headers.get('x-oauth-scopes'), headers.get('x-gitea-scopes')]
    .filter(Boolean)
    .join(',');
  if (!rawScopes.trim()) return false;

  const p = String(provider || '').trim().toLowerCase();
  const scopes = rawScopes
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  for (const scope of scopes) {
    const isReadColonScope = /^read:[a-z0-9_-]+$/.test(scope);
    const isGitHubEmailRead = p === 'github' && scope === 'user:email';
    const isGitLabSafeRead =
      p === 'gitlab' &&
      (scope === 'read_user' || scope === 'read_repository' || scope === 'read_registry');

    if (!isReadColonScope && !isGitHubEmailRead && !isGitLabSafeRead) {
      return true;
    }
  }
  return false;
}

const PROVIDER_VERIFY_TIMEOUT_MS = 5000;

/**
 * Verifies a Personal Access Token (PAT) against GitHub, Codeberg, Mesehub, GitLab, or ContentDB API,
 * or against a configured Cloudflare `ADMIN_SECRET`.
 * Never logs, caches, or echoes the token value.
 */
export async function verifyProviderToken(
  provider: string,
  token: string,
  expectedUsername: string,
  adminSecret?: string
): Promise<ProviderTokenVerificationResult> {
  const cleanToken = (token || '').trim();
  const cleanExpectedUsername = (expectedUsername || '').trim();

  // Reject empty, malformed, oversized, or header-injectable tokens before any outbound call
  if (
    !cleanToken ||
    cleanToken.length < 8 ||
    cleanToken.length > 512 ||
    /[\r\n\0]/.test(cleanToken)
  ) {
    return { verified: false, failureReason: 'invalid_token' };
  }

  // 1. Check Cloudflare ADMIN_SECRET override if configured (constant-time)
  if (
    cleanExpectedUsername &&
    adminSecret &&
    adminSecret.length >= 12 &&
    timingSafeEqualStrings(cleanToken, adminSecret)
  ) {
    return {
      verified: true,
      providerUserId: `${provider}:${cleanExpectedUsername.toLowerCase()}`,
      username: cleanExpectedUsername,
      displayName: cleanExpectedUsername
    };
  }

  const baseHeaders: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luantihub.org)'
  };

  const fetchStrictProviderEndpoint = async (
    url: string,
    authHeaderValue: string,
    useAnubisBridge = false
  ): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_VERIFY_TIMEOUT_MS);
    try {
      const reqInit: RequestInit = {
        method: 'GET',
        headers: { ...baseHeaders, Authorization: authHeaderValue },
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal
      };
      const res = useAnubisBridge
        ? await fetchWithAnubisSupport(url, reqInit, {
            maxRedirects: 0,
            allowHost: h => h === 'git.minetest.land'
          })
        : await fetch(url, reqInit);
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  const matchesExpectedHandle = (actualUsername: string): boolean => {
    if (!cleanExpectedUsername) return true;
    return actualUsername.trim().toLowerCase() === cleanExpectedUsername.toLowerCase();
  };

  try {
    if (provider === 'github') {
      const res = await fetchStrictProviderEndpoint('https://api.github.com/user', `Bearer ${cleanToken}`);
      if (res.redirected || (res.status >= 300 && res.status < 400)) {
        return { verified: false, failureReason: 'upstream_error' };
      }
      if (!res.ok) return { verified: false, failureReason: 'invalid_token' };
      if (hasExcessiveTokenScopes(res.headers, 'github')) {
        return { verified: false, failureReason: 'excessive_scopes' };
      }
      const profile: any = await res.json();
      const login = typeof profile?.login === 'string' ? profile.login.trim() : '';
      if (!login) return { verified: false, failureReason: 'invalid_token' };
      if (!matchesExpectedHandle(login)) {
        return { verified: false, failureReason: 'username_mismatch' };
      }
      return {
        verified: true,
        providerUserId: String(profile.id || login),
        username: login,
        displayName: profile.name || login,
        avatarUrl: profile.avatar_url,
        profileUrl: profile.html_url || `https://github.com/${login}`,
        bio: profile.bio || ''
      };
    }

    if (provider === 'codeberg') {
      const res = await fetchStrictProviderEndpoint('https://codeberg.org/api/v1/user', `token ${cleanToken}`);
      if (res.redirected || (res.status >= 300 && res.status < 400)) {
        return { verified: false, failureReason: 'upstream_error' };
      }
      if (!res.ok) return { verified: false, failureReason: 'invalid_token' };
      if (hasExcessiveTokenScopes(res.headers, 'codeberg')) {
        return { verified: false, failureReason: 'excessive_scopes' };
      }
      const profile: any = await res.json();
      const rawLogin = profile?.login || profile?.username;
      const login = typeof rawLogin === 'string' ? rawLogin.trim() : '';
      if (!login) return { verified: false, failureReason: 'invalid_token' };
      if (!matchesExpectedHandle(login)) {
        return { verified: false, failureReason: 'username_mismatch' };
      }
      return {
        verified: true,
        providerUserId: String(profile.id || login),
        username: login,
        displayName: profile.full_name || login,
        avatarUrl: profile.avatar_url,
        profileUrl: profile.html_url || `https://codeberg.org/${login}`,
        bio: profile.description || ''
      };
    }

    if (provider === 'mesehub') {
      const res = await fetchStrictProviderEndpoint(
        'https://git.minetest.land/api/v1/user',
        `token ${cleanToken}`,
        true
      );
      if (res.redirected || (res.status >= 300 && res.status < 400)) {
        return { verified: false, failureReason: 'upstream_error' };
      }
      if (!res.ok) return { verified: false, failureReason: 'invalid_token' };
      if (hasExcessiveTokenScopes(res.headers, 'mesehub')) {
        return { verified: false, failureReason: 'excessive_scopes' };
      }
      const profile: any = await res.json();
      const rawLogin = profile?.login || profile?.username;
      const login = typeof rawLogin === 'string' ? rawLogin.trim() : '';
      if (!login) return { verified: false, failureReason: 'invalid_token' };
      if (!matchesExpectedHandle(login)) {
        return { verified: false, failureReason: 'username_mismatch' };
      }
      return {
        verified: true,
        providerUserId: String(profile.id || login),
        username: login,
        displayName: profile.full_name || login,
        avatarUrl: profile.avatar_url || `https://git.minetest.land/${login}.png`,
        profileUrl: profile.html_url || `https://git.minetest.land/${login}`,
        bio: profile.description || ''
      };
    }

    if (provider === 'gitlab') {
      const res = await fetchStrictProviderEndpoint('https://gitlab.com/api/v4/user', `Bearer ${cleanToken}`);
      if (res.redirected || (res.status >= 300 && res.status < 400)) {
        return { verified: false, failureReason: 'upstream_error' };
      }
      if (!res.ok) return { verified: false, failureReason: 'invalid_token' };
      if (hasExcessiveTokenScopes(res.headers, 'gitlab')) {
        return { verified: false, failureReason: 'excessive_scopes' };
      }
      const profile: any = await res.json();
      const login = typeof profile?.username === 'string' ? profile.username.trim() : '';
      if (!login) return { verified: false, failureReason: 'invalid_token' };
      if (!matchesExpectedHandle(login)) {
        return { verified: false, failureReason: 'username_mismatch' };
      }
      return {
        verified: true,
        providerUserId: String(profile.id || login),
        username: login,
        displayName: profile.name || login,
        avatarUrl: profile.avatar_url,
        profileUrl: profile.web_url || `https://gitlab.com/${login}`,
        bio: profile.bio || ''
      };
    }

    if (provider === 'contentdb') {
      const res = await fetchStrictProviderEndpoint(
        'https://content.luanti.org/api/whoami/',
        `Bearer ${cleanToken}`
      );
      if (res.redirected || (res.status >= 300 && res.status < 400)) {
        return { verified: false, failureReason: 'upstream_error' };
      }
      if (!res.ok) return { verified: false, failureReason: 'invalid_token' };
      const profile: any = await res.json();
      const login = typeof profile?.username === 'string' ? profile.username.trim() : '';
      if (!profile?.is_authenticated || !login) {
        return { verified: false, failureReason: 'invalid_token' };
      }
      if (!matchesExpectedHandle(login)) {
        return { verified: false, failureReason: 'username_mismatch' };
      }
      return {
        verified: true,
        providerUserId: login,
        username: login,
        displayName: profile.display_name || login,
        profileUrl: `https://content.luanti.org/users/${login}/`
      };
    }
  } catch {
    return { verified: false, failureReason: 'upstream_error' };
  }

  return { verified: false, failureReason: 'invalid_token' };
}

/**
 * Constant-time string equality check (including padded constant-time length XOR)
 * to prevent timing side-channels when comparing secrets.
 */
export function timingSafeEqualStrings(a?: string | null, b?: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const enc = new TextEncoder();
  const bytesA = enc.encode(a);
  const bytesB = enc.encode(b);
  const maxLen = Math.max(256, bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < bytesA.length ? bytesA[i] : 0;
    const byteB = i < bytesB.length ? bytesB[i] : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

const authenticatedRefreshCooldown = new Map<string, number>();

/**
 * Verifies that a request asking for `?nocache=1` / `?refresh=1` / `?sync=1` carries a valid
 * authenticated `lh_session` cookie and respects a per-resource cooldown window (default 60s),
 * preventing unauthenticated actors from bypassing Edge Cache and exhausting D1/upstream quotas.
 */
export async function shouldHonorAuthenticatedNoCache(
  request: Request | undefined,
  sessionSecret: string | undefined,
  resourceKey: string,
  cooldownMs = 60_000
): Promise<boolean> {
  if (!request) return false;
  const cookies = parseCookies(request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) return false;

  const sessionUserId = await verifySessionToken(sessionToken, sessionSecret);
  if (!sessionUserId) return false;

  const now = Date.now();
  if (authenticatedRefreshCooldown.size > 1000) {
    for (const [k, ts] of authenticatedRefreshCooldown.entries()) {
      if (now - ts > cooldownMs) authenticatedRefreshCooldown.delete(k);
    }
  }

  const normalizedKey = String(resourceKey || '').trim().toLowerCase();
  const lastRefresh = authenticatedRefreshCooldown.get(normalizedKey) || 0;
  if (now - lastRefresh <= cooldownMs) {
    return false;
  }

  authenticatedRefreshCooldown.set(normalizedKey, now);
  return true;
}


import {
  createSessionToken,
  verifySessionToken,
  verifyOAuthStateToken,
  parseCookies,
  checkIsAdmin,
  mergeSecondaryUserIntoPrimary,
  reconcileAndMergeUserAccount
} from '../lib/session';
import { syncAuthorContentDbPackages, fetchWithAnubisSupport } from '../../lib/upstream';

interface Env {
  DB?: any;
  CODEBERG_CLIENT_ID?: string;
  CODEBERG_CLIENT_SECRET?: string;
  CODEBERG_REDIRECT_URI?: string;
  MESEHUB_CLIENT_ID?: string;
  MESEHUB_CLIENT_SECRET?: string;
  MESEHUB_REDIRECT_URI?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  GITLAB_REDIRECT_URI?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  CONTENTDB_CLIENT_ID?: string;
  CONTENTDB_CLIENT_SECRET?: string;
  CONTENTDB_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

const USER_AGENT = 'LuantiHub/1.0 (+https://luantihub.org)';

// Deduplicate concurrent/retried OAuth callback requests within the same Worker isolate
const inFlightOAuthCodes = new Map<string, Promise<string>>();
const completedOAuthCodes = new Map<string, { userId: string; expiresAt: number }>();

function cleanEnvValue(val?: string): string {
  return (val || '').trim().replace(/^["']|["']$/g, '').trim();
}

function resolveRedirectUri(envValue: string | undefined, requestOrigin: string, provider: string): string {
  const fallback = `${requestOrigin}/api/auth/${provider}/callback`;
  const cleaned = cleanEnvValue(envValue);
  if (!cleaned) return fallback;
  if (
    cleaned.includes('luanti-hub.pages.dev') &&
    !requestOrigin.includes('luanti-hub.pages.dev') &&
    !requestOrigin.includes('localhost') &&
    !requestOrigin.includes('127.0.0.1')
  ) {
    return fallback;
  }
  return cleaned;
}

function getOAuthCodeEdgeCacheUrl(provider: string, code: string): string {
  return `https://cache.luantihub.internal/__oauth_code/${encodeURIComponent(provider)}/${encodeURIComponent(code)}`;
}

async function readCompletedOAuthCodeFromEdgeCache(provider: string, code: string): Promise<string | null> {
  const cachedCodeKey = `${provider}:${code}`;
  const inMemory = completedOAuthCodes.get(cachedCodeKey);
  if (inMemory && Date.now() < inMemory.expiresAt) {
    return inMemory.userId;
  }
  try {
    const cacheStorage = (globalThis as any).caches?.default;
    if (!cacheStorage) return null;
    const cachedRes = await cacheStorage.match(new Request(getOAuthCodeEdgeCacheUrl(provider, code)));
    if (!cachedRes || !cachedRes.ok) return null;
    const data = await cachedRes.json() as { userId?: string };
    if (data?.userId) {
      completedOAuthCodes.set(cachedCodeKey, {
        userId: data.userId,
        expiresAt: Date.now() + 90_000
      });
      return data.userId;
    }
  } catch {
    // Ignore Cache API errors in local/non-Worker environments
  }
  return null;
}

async function writeCompletedOAuthCodeToEdgeCache(provider: string, code: string, userId: string): Promise<void> {
  const cachedCodeKey = `${provider}:${code}`;
  completedOAuthCodes.set(cachedCodeKey, {
    userId,
    expiresAt: Date.now() + 90_000
  });
  try {
    const cacheStorage = (globalThis as any).caches?.default;
    if (!cacheStorage) return;
    const res = new Response(JSON.stringify({ userId }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=90'
      }
    });
    await cacheStorage.put(new Request(getOAuthCodeEdgeCacheUrl(provider, code)), res);
  } catch {
    // Ignore Cache API errors in local/non-Worker environments
  }
}

function computeOAuthRetryDelayMs(attempt: number, status: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(Math.max(Math.round(seconds * 1000), 1000), 5500);
    }
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const deltaMs = parsedDate - Date.now();
      if (deltaMs > 0) {
        return Math.min(Math.max(deltaMs, 1000), 5500);
      }
    }
  }

  const jitter = Math.floor(Math.random() * 250);
  if (status === 429 || status === 503) {
    // GitHub's web front-end `/login/oauth/access_token` per-IP burst window requires >1s cooldown
    const schedule = [1200, 2300, 3600, 5000];
    const base = schedule[Math.min(attempt, schedule.length - 1)];
    return base + jitter;
  }

  return 300 * (attempt + 1) + jitter;
}

async function exchangeOAuthTokenWithRetry(
  tokenUrl: string,
  params: Record<string, string>,
  providerLabel: string,
  allowJsonRetry = false,
  onBeforeRetry?: () => Promise<string | null>
): Promise<any> {
  const formBody = new URLSearchParams(params).toString();
  let lastStatus = 0;
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0 && onBeforeRetry) {
      const alreadyResolvedUserId = await onBeforeRetry();
      if (alreadyResolvedUserId) {
        return { __resolvedUserId: alreadyResolvedUserId };
      }
    }

    try {
      // Only switch to JSON body if a previous attempt failed with a non-rate-limit format error (e.g. 400/415)
      const useJson = allowJsonRetry && attempt === 1 && lastStatus !== 429 && lastStatus !== 503;
      const res = await fetchWithAnubisSupport(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': useJson ? 'application/json' : 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': USER_AGENT
        },
        body: useJson ? JSON.stringify(params) : formBody
      });

      lastStatus = res.status;
      if (res.ok) {
        const rawText = await res.text();
        if (rawText.includes('id="anubis_challenge"') || rawText.trim().startsWith('<!DOCTYPE')) {
          throw new Error(`${providerLabel} returned an anti-bot challenge page instead of OAuth token JSON`);
        }
        try {
          return JSON.parse(rawText);
        } catch {
          const parsedForm = new URLSearchParams(rawText);
          if (parsedForm.has('access_token') || parsedForm.has('error')) {
            return {
              access_token: parsedForm.get('access_token') || undefined,
              error: parsedForm.get('error') || undefined,
              error_description: parsedForm.get('error_description') || undefined
            };
          }
          throw new Error(`${providerLabel} returned invalid token payload`);
        }
      }

      // Retry on 429 Too Many Requests, 403/408/5xx, or transient upstream proxy errors
      if (attempt < maxAttempts - 1) {
        const delayMs = computeOAuthRetryDelayMs(attempt, lastStatus, res.headers?.get?.('Retry-After') || null);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
    } catch (err: any) {
      if (attempt === maxAttempts - 1) {
        throw err;
      }
      const delayMs = computeOAuthRetryDelayMs(attempt, lastStatus, null);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  const rateLimitError: any = new Error(`${providerLabel} token exchange failed (HTTP ${lastStatus || 'network error'})`);
  rateLimitError.httpStatus = lastStatus;
  throw rateLimitError;
}

async function buildSuccessRedirectResponse(
  origin: string,
  isHttps: boolean,
  userId: string,
  sessionSecret?: string
): Promise<Response> {
  const sessionToken = await createSessionToken(userId, sessionSecret);
  const headers = new Headers();
  headers.set('Location', `${origin}/?auth_success=1`);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.append(
    'Set-Cookie',
    `lh_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 30}${isHttps ? '; Secure' : ''}`
  );
  headers.append(
    'Set-Cookie',
    `lh_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
  );
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet(context: {
  params: { provider: string };
  request: Request;
  env: Env;
  waitUntil?: (promise: Promise<any>) => void;
}) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const isHttps = url.protocol === 'https:';
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const sessionSecret = cleanEnvValue(context.env.SESSION_SECRET) || undefined;
  const defaultRedirectUri = `${url.origin}/api/auth/${provider}/callback`;
  const redirectUriByProvider: Record<string, string | undefined> = {
    codeberg: resolveRedirectUri(context.env.CODEBERG_REDIRECT_URI, url.origin, 'codeberg'),
    mesehub: resolveRedirectUri(context.env.MESEHUB_REDIRECT_URI, url.origin, 'mesehub'),
    gitlab: resolveRedirectUri(context.env.GITLAB_REDIRECT_URI, url.origin, 'gitlab'),
    github: resolveRedirectUri(context.env.GITHUB_REDIRECT_URI, url.origin, 'github'),
    contentdb: resolveRedirectUri(context.env.CONTENTDB_REDIRECT_URI, url.origin, 'contentdb')
  };
  const redirectUri = redirectUriByProvider[provider] || defaultRedirectUri;

  if (!code) {
    return Response.redirect(
      `${url.origin}/?auth_error=No+authorization+code+provided&provider=${encodeURIComponent(provider)}`,
      302
    );
  }

  const cookies = parseCookies(context.request);
  const expectedState = cookies['lh_oauth_state'];
  const isCookieStateValid = Boolean(stateParam && expectedState && stateParam === expectedState);
  const isHmacStateValid = await verifyOAuthStateToken(stateParam, provider, sessionSecret);

  if (!isCookieStateValid && !isHmacStateValid) {
    return Response.redirect(
      `${url.origin}/?auth_error=Invalid+OAuth+CSRF+state&provider=${encodeURIComponent(provider)}`,
      302
    );
  }

  const existingSessionUserId = cookies['lh_session']
    ? await verifySessionToken(cookies['lh_session'], sessionSecret)
    : null;

  // Fast-path: If this exact authorization code already completed moments ago (in-memory or Cloudflare Edge Cache)
  const cachedCodeKey = `${provider}:${code}`;
  const completedUserId = await readCompletedOAuthCodeFromEdgeCache(provider, code);
  if (completedUserId) {
    return buildSuccessRedirectResponse(url.origin, isHttps, completedUserId, sessionSecret);
  }

  // Fast-path: If this exact authorization code is currently being processed by a concurrent request
  const existingInFlight = inFlightOAuthCodes.get(cachedCodeKey);
  if (existingInFlight) {
    try {
      const resolvedUserId = await existingInFlight;
      return buildSuccessRedirectResponse(url.origin, isHttps, resolvedUserId, sessionSecret);
    } catch {
      // Fall through to standard flow if in-flight promise failed
    }
  }

  const checkEdgeCacheBeforeRetry = () => readCompletedOAuthCodeFromEdgeCache(provider, code);

  const processOAuthCallback = async (): Promise<string> => {
    let providerUserId = '';
    let providerUsername = '';
    let displayName = '';
    let avatarUrl = '';
    let profileUrl = '';

    // 1. Exchange OAuth code for Access Token & Profile
    if (provider === 'codeberg') {
      const tokenData = await exchangeOAuthTokenWithRetry(
        'https://codeberg.org/login/oauth/access_token',
        {
          client_id: cleanEnvValue(context.env.CODEBERG_CLIENT_ID),
          client_secret: cleanEnvValue(context.env.CODEBERG_CLIENT_SECRET),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        },
        'Codeberg',
        false,
        checkEdgeCacheBeforeRetry
      );
      if (tokenData?.__resolvedUserId) return tokenData.__resolvedUserId;
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Codeberg token exchange failed');
      }
      const userRes = await fetch('https://codeberg.org/api/v1/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json'
        }
      });
      if (!userRes.ok) throw new Error('Codeberg user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || user.username || '');
      providerUsername = user.username || user.login || '';
      displayName = user.full_name || providerUsername;
      avatarUrl = user.avatar_url || '';
      profileUrl = `https://codeberg.org/${providerUsername}`;

    } else if (provider === 'mesehub') {
      const tokenData = await exchangeOAuthTokenWithRetry(
        'https://git.minetest.land/login/oauth/access_token',
        {
          client_id: cleanEnvValue(context.env.MESEHUB_CLIENT_ID),
          client_secret: cleanEnvValue(context.env.MESEHUB_CLIENT_SECRET),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        },
        'Mesehub',
        false,
        checkEdgeCacheBeforeRetry
      );
      if (tokenData?.__resolvedUserId) return tokenData.__resolvedUserId;
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Mesehub token exchange failed');
      }
      const userRes = await fetchWithAnubisSupport('https://git.minetest.land/api/v1/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json'
        }
      });
      if (!userRes.ok) throw new Error('Mesehub user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || user.username || user.login || '');
      providerUsername = user.username || user.login || '';
      displayName = user.full_name || providerUsername;
      avatarUrl = user.avatar_url || `https://git.minetest.land/${providerUsername}.png`;
      profileUrl = `https://git.minetest.land/${providerUsername}`;

    } else if (provider === 'gitlab') {
      const tokenData = await exchangeOAuthTokenWithRetry(
        'https://gitlab.com/oauth/token',
        {
          client_id: cleanEnvValue(context.env.GITLAB_CLIENT_ID),
          client_secret: cleanEnvValue(context.env.GITLAB_CLIENT_SECRET),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        },
        'GitLab',
        false,
        checkEdgeCacheBeforeRetry
      );
      if (tokenData?.__resolvedUserId) return tokenData.__resolvedUserId;
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'GitLab token exchange failed');
      }
      const userRes = await fetch('https://gitlab.com/api/v4/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json'
        }
      });
      if (!userRes.ok) throw new Error('GitLab user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || '');
      providerUsername = user.username || '';
      displayName = user.name || providerUsername;
      avatarUrl = user.avatar_url || '';
      profileUrl = user.web_url || `https://gitlab.com/${providerUsername}`;

    } else if (provider === 'github') {
      const tokenData = await exchangeOAuthTokenWithRetry(
        'https://github.com/login/oauth/access_token',
        {
          client_id: cleanEnvValue(context.env.GITHUB_CLIENT_ID),
          client_secret: cleanEnvValue(context.env.GITHUB_CLIENT_SECRET),
          code,
          redirect_uri: redirectUri
        },
        'GitHub',
        true,
        checkEdgeCacheBeforeRetry
      );
      if (tokenData?.__resolvedUserId) return tokenData.__resolvedUserId;
      if (tokenData.error || !tokenData.access_token) {
        // If a duplicate request hit another Worker isolate milliseconds after the code was already consumed,
        // check cross-isolate edge cache first, then fall back to existingSessionUserId if present
        if (tokenData.error === 'bad_verification_code') {
          await new Promise(resolve => setTimeout(resolve, 250));
          const cachedFromOtherIsolate = await readCompletedOAuthCodeFromEdgeCache(provider, code);
          if (cachedFromOtherIsolate) {
            return cachedFromOtherIsolate;
          }
          if (existingSessionUserId) {
            return existingSessionUserId;
          }
        }
        throw new Error(tokenData.error_description || tokenData.error || 'GitHub OAuth token missing');
      }
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json'
        }
      });
      if (!userRes.ok) throw new Error('GitHub user profile fetch failed');
      const user = await userRes.json() as any;
      providerUserId = String(user.id || '');
      providerUsername = user.login || '';
      displayName = user.name || providerUsername;
      avatarUrl = user.avatar_url || `https://github.com/${providerUsername}.png`;
      profileUrl = user.html_url || `https://github.com/${providerUsername}`;

    } else if (provider === 'contentdb') {
      const tokenData = await exchangeOAuthTokenWithRetry(
        'https://content.luanti.org/oauth/token/',
        {
          client_id: cleanEnvValue(context.env.CONTENTDB_CLIENT_ID),
          client_secret: cleanEnvValue(context.env.CONTENTDB_CLIENT_SECRET),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        },
        'ContentDB',
        false,
        checkEdgeCacheBeforeRetry
      );
      if (tokenData?.__resolvedUserId) return tokenData.__resolvedUserId;
      if (tokenData.error || !tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'ContentDB token exchange failed');
      }
      const whoamiRes = await fetch('https://content.luanti.org/api/whoami/', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/json'
        }
      });
      if (!whoamiRes.ok) throw new Error('ContentDB whoami fetch failed');
      const user = await whoamiRes.json() as any;
      providerUserId = user.username || '';
      providerUsername = user.username || '';
      displayName = user.display_name || providerUsername;
      avatarUrl = `https://content.luanti.org/users/${providerUsername}/avatar/`;
      profileUrl = `https://content.luanti.org/users/${providerUsername}/`;
    }

    if (!providerUsername) {
      throw new Error('Authentication failed');
    }

    // 2. Identify or Create User in Cloudflare D1 (with full orphan & duplicate self-healing)
    let userId: string | null = null;

    const isAdmin = checkIsAdmin(
      { username: providerUsername },
      [{ provider, username: providerUsername, verified: 1 }],
      context.env.ADMIN_USERS
    );
    const role = isAdmin ? 'admin' : 'user';

    if (context.env.DB) {
      // Verify whether existingSessionUserId actually resolves to a live row in `users`
      let activeSessionUser: any = null;
      if (existingSessionUserId) {
        activeSessionUser = await reconcileAndMergeUserAccount(context.env.DB, existingSessionUserId);
      }

      // Fetch all existing identity rows matching either canonical provider_user_id or provider_username
      const matchingIdentitiesRes = await context.env.DB.prepare(`
        SELECT id, user_id, provider_user_id, provider_username, verified
        FROM user_identities
        WHERE provider = ? AND (provider_user_id = ? OR LOWER(provider_username) = LOWER(?))
        ORDER BY verified DESC, id ASC
      `).bind(provider, providerUserId, providerUsername).all();
      const matchingIdentities = (matchingIdentitiesRes.results || []) as Array<{
        id: number;
        user_id: string;
        provider_user_id: string;
        provider_username: string;
        verified: number;
      }>;

      // Determine whether this OAuth login should link to activeSessionUser (connecting a new forge)
      // or switch accounts (when activeSessionUser already has a DIFFERENT account on this same provider)
      let shouldLinkToActiveSession = Boolean(activeSessionUser?.id);
      if (activeSessionUser?.id) {
        const existingSameProviderIdentity = await context.env.DB.prepare(`
          SELECT provider_user_id, provider_username
          FROM user_identities
          WHERE user_id = ? AND provider = ?
          LIMIT 1
        `).bind(activeSessionUser.id, provider).first() as {
          provider_user_id?: string;
          provider_username?: string;
        } | null;

        if (
          existingSameProviderIdentity &&
          String(existingSameProviderIdentity.provider_user_id || '') !== providerUserId &&
          String(existingSameProviderIdentity.provider_username || '').toLowerCase() !== providerUsername.toLowerCase()
        ) {
          shouldLinkToActiveSession = false;
        }
      }

      if (shouldLinkToActiveSession && activeSessionUser?.id) {
        userId = String(activeSessionUser.id);
      } else {
        // Check if any matching identity points to a live row in `users` (preferring unsuffixed canonical username)
        for (const ident of matchingIdentities) {
          const u = await context.env.DB.prepare(
            `SELECT id, username FROM users WHERE id = ?`
          ).bind(ident.user_id).first() as { id: string; username: string } | null;
          if (u) {
            userId = u.id;
            if (String(u.username || '').toLowerCase() === providerUsername.toLowerCase()) {
              break;
            }
          }
        }

        // If no matching identity points to a live user row, check if a user with this username already exists
        if (!userId) {
          const existingUserByUsername = await context.env.DB.prepare(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?)`
          ).bind(providerUsername).first() as { id: string } | null;

          const conflictingSameProvider = existingUserByUsername
            ? await context.env.DB.prepare(
                `SELECT id FROM user_identities WHERE user_id = ? AND provider = ? AND LOWER(provider_username) != LOWER(?) LIMIT 1`
              ).bind(existingUserByUsername.id, provider, providerUsername).first()
            : null;

          if (existingUserByUsername && !conflictingSameProvider) {
            userId = existingUserByUsername.id;
          } else {
            const candidateUsername = existingUserByUsername
              ? `${providerUsername}_${provider.slice(0, 2)}`
              : providerUsername;

            // Reuse orphaned identity's user_id if present so existing packages/favorites/downloads stay linked
            userId = matchingIdentities.length > 0 && matchingIdentities[0].user_id
              ? String(matchingIdentities[0].user_id)
              : crypto.randomUUID();

            await context.env.DB.prepare(`
              INSERT OR REPLACE INTO users (id, username, display_name, avatar_url, role)
              VALUES (?, ?, ?, ?, ?)
            `).bind(userId, candidateUsername, displayName || providerUsername, avatarUrl, role).run();
          }
        }
      }

      // Merge any secondary or orphaned user_ids referenced by matchingIdentities into the resolved primary userId
      if (userId) {
        const mergedSecondaryIds = new Set<string>();
        for (const ident of matchingIdentities) {
          if (ident.user_id && ident.user_id !== userId && !mergedSecondaryIds.has(ident.user_id)) {
            mergedSecondaryIds.add(ident.user_id);
            await mergeSecondaryUserIntoPrimary(context.env.DB, userId, ident.user_id);
          }
        }

        // Clean up duplicate identity rows for this specific (provider, provider_user_id / provider_username)
        // while preserving any OTHER accounts on the same provider linked to this userId!
        const currentIdentitiesRes = await context.env.DB.prepare(`
          SELECT id FROM user_identities
          WHERE provider = ?
            AND (provider_user_id = ? OR LOWER(provider_username) = LOWER(?))
          ORDER BY verified DESC, id ASC
        `).bind(provider, providerUserId, providerUsername).all();
        const currentIds = (currentIdentitiesRes.results || []) as Array<{ id: number }>;

        if (currentIds.length > 0) {
          const keepId = currentIds[0].id;
          for (const extra of currentIds.slice(1)) {
            await context.env.DB.prepare(`DELETE FROM user_identities WHERE id = ?`).bind(extra.id).run();
          }
          await context.env.DB.prepare(`
            UPDATE user_identities
            SET user_id = ?, provider_user_id = ?, provider_username = ?, profile_url = ?, avatar_url = ?, verified = 1
            WHERE id = ?
          `).bind(userId, providerUserId, providerUsername, profileUrl, avatarUrl, keepId).run();
        } else {
          await context.env.DB.prepare(`
            INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url, avatar_url, verified)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(provider, provider_user_id) DO UPDATE SET
              user_id = excluded.user_id,
              provider_username = excluded.provider_username,
              profile_url = excluded.profile_url,
              avatar_url = excluded.avatar_url,
              verified = 1
          `).bind(userId, provider, providerUserId, providerUsername, profileUrl, avatarUrl).run();
        }

        // Reconcile & merge any duplicate suffixed accounts
        const reconciledUser = await reconcileAndMergeUserAccount(context.env.DB, userId);
        if (reconciledUser?.id) {
          userId = String(reconciledUser.id);
        }

        if (isAdmin && userId) {
          await context.env.DB.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(userId).run();
        }
      }

      // 3. Automatic ContentDB & Git Package Matching (Zero-Click Claiming!)
      if (provider !== 'contentdb' && userId) {
        await context.env.DB.prepare(`
          UPDATE packages SET author_id = ?
          WHERE (author_id IS NULL OR author_id LIKE 'ext_%')
            AND (LOWER(author_name) = LOWER(?) OR LOWER(repo_url) LIKE LOWER(?))
        `).bind(userId, providerUsername, `%/${providerUsername}/%`).run();
      }

      // Sync upstream ContentDB packages authored by this verified username in background
      if (userId) {
        const syncPromise = syncAuthorContentDbPackages(context.env.DB, userId, providerUsername).catch(() => {});
        if (typeof context.waitUntil === 'function') {
          context.waitUntil(syncPromise);
        } else {
          await syncPromise;
        }
      }
    } else {
      // Fallback userId if D1 binding is not yet initialized locally
      userId = `usr_${provider}_${providerUsername}`;
    }

    if (!userId) {
      throw new Error('User creation failed');
    }

    return userId;
  };

  const inFlightPromise = processOAuthCallback();
  inFlightOAuthCodes.set(cachedCodeKey, inFlightPromise);

  try {
    const resolvedUserId = await inFlightPromise;
    await writeCompletedOAuthCodeToEdgeCache(provider, code, resolvedUserId);
    return await buildSuccessRedirectResponse(url.origin, isHttps, resolvedUserId, sessionSecret);
  } catch (err: any) {
    // 1. Check if a concurrent Worker isolate completed the token exchange in Edge Cache
    const edgeResolvedUserId = await readCompletedOAuthCodeFromEdgeCache(provider, code);
    if (edgeResolvedUserId) {
      return await buildSuccessRedirectResponse(url.origin, isHttps, edgeResolvedUserId, sessionSecret);
    }

    // 2. If GitHub's front-end load balancer returned HTTP 429, the authorization code is still unconsumed.
    // Perform up to 2 automatic callback self-retry redirects after a cooldown window so switching accounts succeeds seamlessly.
    const errMsg = String(err?.message || 'Auth failure');
    const isRateLimited429 = err?.httpStatus === 429 || errMsg.includes('HTTP 429');
    const retry429Count = Number(url.searchParams.get('retry_429') || '0');
    if (isRateLimited429 && retry429Count < 2) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const retryUrl = new URL(url.toString());
      retryUrl.searchParams.set('retry_429', String(retry429Count + 1));
      return Response.redirect(retryUrl.toString(), 302);
    }

    // 3. If another isolate consumed the code and the user already has a valid session cookie, redirect to success
    if (existingSessionUserId && !isRateLimited429) {
      return await buildSuccessRedirectResponse(url.origin, isHttps, existingSessionUserId, sessionSecret);
    }

    return Response.redirect(
      `${url.origin}/?auth_error=${encodeURIComponent(errMsg)}&provider=${encodeURIComponent(provider)}`,
      302
    );
  } finally {
    inFlightOAuthCodes.delete(cachedCodeKey);
  }
}

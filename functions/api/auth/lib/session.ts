// Secure session cookie & admin role management using Web Crypto API
const DEFAULT_SECRET = 'luantihub-super-secret-session-key-change-in-env-32bytes';

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret || DEFAULT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(userId: string, secret: string = DEFAULT_SECRET): Promise<string> {
  const payload = JSON.stringify({ userId, exp: Date.now() + 86400000 * 30 }); // 30 days
  const enc = new TextEncoder();
  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const b64Payload = btoa(payload);
  const b64Sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${b64Payload}.${b64Sig}`;
}

export async function verifySessionToken(token: string, secret: string = DEFAULT_SECRET): Promise<string | null> {
  try {
    const [b64Payload, b64Sig] = token.split('.');
    if (!b64Payload || !b64Sig) return null;

    const payload = atob(b64Payload);
    const data = JSON.parse(payload);
    if (data.exp && Date.now() > data.exp) return null;

    const key = await getKey(secret);
    const enc = new TextEncoder();
    const sigBytes = Uint8Array.from(atob(b64Sig), c => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    return isValid ? data.userId : null;
  } catch {
    return null;
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
      if (k && v) cookies[k] = decodeURIComponent(v);
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
    const userHandle = (user.username || '').trim().toLowerCase();
    const baseUserHandle = userHandle.replace(/_(gi|gl|co|cd)$/i, '');
    if ((userHandle && rawList.includes(userHandle)) || (baseUserHandle && rawList.includes(baseUserHandle))) {
      return true;
    }

    for (const id of verifiedIdentities) {
      const handle = (id.username || '').trim().toLowerCase();
      const baseHandle = handle.replace(/_(gi|gl|co|cd)$/i, '');
      const qualified = `${(id.provider || '').toLowerCase()}:${handle}`;
      if (rawList.includes(handle) || rawList.includes(baseHandle) || rawList.includes(qualified)) {
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
  const baseLower = lower.replace(/_(gi|gl|co|cd)$/i, '');
  if (!lower) return false;
  if (rawList.includes(lower) || rawList.includes(baseLower)) return true;
  if (provider && (rawList.includes(`${provider.toLowerCase()}:${lower}`) || rawList.includes(`${provider.toLowerCase()}:${baseLower}`))) {
    return true;
  }
  return false;
}

/**
 * Deduplicates `user_identities` rows for the same (user_id, provider, LOWER(provider_username))
 * and automatically merges duplicate suffixed accounts (e.g. `username_gi` -> `username`)
 * caused by signing in via both Handle/PAT and 1-Click OAuth.
 */
export async function reconcileAndMergeUserAccount(db: any, currentUserId: string): Promise<any | null> {
  if (!db || !currentUserId) return null;

  let user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(currentUserId).first();
  if (!user) return null;

  const rawUsername = String(user.username || '').trim();
  const baseUsername = rawUsername.replace(/_(gi|gl|co|cd)$/i, '');
  const hasProviderSuffix = baseUsername.toLowerCase() !== rawUsername.toLowerCase();

  try {
    if (hasProviderSuffix) {
      // Check if the canonical base user exists
      const canonicalUser = await db.prepare(
        `SELECT * FROM users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1`
      ).bind(baseUsername, user.id).first();

      if (canonicalUser) {
        await mergeSecondaryUserIntoPrimary(db, canonicalUser.id, user.id);
        user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(canonicalUser.id).first();
      } else {
        // No other user owns the base username — rename suffixed username back to baseUsername
        await db.prepare(`UPDATE users SET username = ? WHERE id = ?`).bind(baseUsername, user.id).run();
        user.username = baseUsername;
      }
    } else {
      // Current user is the canonical base user.
      // Check if any suffixed duplicate accounts (`_gi`, `_gl`, `_co`, `_cd`) exist for the same creator.
      const suffixedDuplicates = await db.prepare(
        `SELECT id, username FROM users
         WHERE id != ?
           AND (
             LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
             OR LOWER(username) = LOWER(?)
           )`
      ).bind(
        user.id,
        `${baseUsername}_gi`,
        `${baseUsername}_gl`,
        `${baseUsername}_co`,
        `${baseUsername}_cd`
      ).all();

      for (const dup of suffixedDuplicates.results || []) {
        await mergeSecondaryUserIntoPrimary(db, user.id, dup.id);
      }
    }

    // Deduplicate any multiple user_identities rows for the same provider on the resolved user
    await deduplicateUserIdentities(db, user.id);
  } catch {
    // Non-fatal if a table is missing in local dev
  }

  return user;
}

export async function mergeSecondaryUserIntoPrimary(db: any, primaryId: string, secondaryId: string): Promise<void> {
  if (!primaryId || !secondaryId || primaryId === secondaryId) return;

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

  await db.prepare(`UPDATE packages SET author_id = ? WHERE author_id = ?`).bind(primaryId, secondaryId).run();
  await db.prepare(`UPDATE OR IGNORE user_favorites SET user_id = ? WHERE user_id = ?`).bind(primaryId, secondaryId).run();
  await db.prepare(`DELETE FROM user_favorites WHERE user_id = ?`).bind(secondaryId).run();
  await db.prepare(`UPDATE OR IGNORE package_reviews SET user_id = ? WHERE user_id = ?`).bind(primaryId, secondaryId).run();
  await db.prepare(`DELETE FROM package_reviews WHERE user_id = ?`).bind(secondaryId).run();

  const secUser = await db.prepare(`SELECT role FROM users WHERE id = ?`).bind(secondaryId).first();
  if (secUser?.role === 'admin') {
    await db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).bind(primaryId).run();
  }

  await db.prepare(`DELETE FROM users WHERE id = ?`).bind(secondaryId).run();
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

/**
 * Verifies a Personal Access Token (PAT) against GitHub, Codeberg, GitLab, or ContentDB API,
 * or against a configured Cloudflare `ADMIN_SECRET`.
 */
export async function verifyProviderToken(
  provider: string,
  token: string,
  expectedUsername: string,
  adminSecret?: string
): Promise<{
  verified: boolean;
  providerUserId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  bio?: string;
}> {
  const cleanToken = (token || '').trim();
  if (!cleanToken) return { verified: false };

  // 1. Check Cloudflare ADMIN_SECRET override if configured
  if (adminSecret && adminSecret.length >= 12 && cleanToken === adminSecret) {
    return {
      verified: true,
      providerUserId: `${provider}:${expectedUsername.toLowerCase()}`,
      username: expectedUsername,
      displayName: expectedUsername
    };
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)'
  };

  try {
    if (provider === 'github') {
      const res = await fetch('https://api.github.com/user', {
        headers: { ...headers, Authorization: `Bearer ${cleanToken}` }
      });
      if (!res.ok) return { verified: false };
      const profile: any = await res.json();
      if (!profile?.login) return { verified: false };
      return {
        verified: true,
        providerUserId: String(profile.id || profile.login),
        username: profile.login,
        displayName: profile.name || profile.login,
        avatarUrl: profile.avatar_url,
        profileUrl: profile.html_url || `https://github.com/${profile.login}`,
        bio: profile.bio || ''
      };
    }

    if (provider === 'codeberg') {
      const res = await fetch('https://codeberg.org/api/v1/user', {
        headers: { ...headers, Authorization: `token ${cleanToken}` }
      });
      if (!res.ok) return { verified: false };
      const profile: any = await res.json();
      const login = profile?.login || profile?.username;
      if (!login) return { verified: false };
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

    if (provider === 'gitlab') {
      const res = await fetch('https://gitlab.com/api/v4/user', {
        headers: { ...headers, Authorization: `Bearer ${cleanToken}` }
      });
      if (!res.ok) return { verified: false };
      const profile: any = await res.json();
      if (!profile?.username) return { verified: false };
      return {
        verified: true,
        providerUserId: String(profile.id || profile.username),
        username: profile.username,
        displayName: profile.name || profile.username,
        avatarUrl: profile.avatar_url,
        profileUrl: profile.web_url || `https://gitlab.com/${profile.username}`,
        bio: profile.bio || ''
      };
    }

    if (provider === 'contentdb') {
      const res = await fetch('https://content.luanti.org/api/whoami/', {
        headers: { ...headers, Authorization: `Bearer ${cleanToken}` }
      });
      if (!res.ok) return { verified: false };
      const profile: any = await res.json();
      if (!profile?.is_authenticated || !profile?.username) return { verified: false };
      return {
        verified: true,
        providerUserId: String(profile.username),
        username: profile.username,
        displayName: profile.display_name || profile.username,
        profileUrl: `https://content.luanti.org/users/${profile.username}/`
      };
    }
  } catch {
    return { verified: false };
  }

  return { verified: false };
}

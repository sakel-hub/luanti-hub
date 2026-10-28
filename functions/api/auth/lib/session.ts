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
 * Determines whether a user qualifies as an Admin via either:
 * 1. Their D1 database `role` column ('admin' or 'moderator'), provided they have a verified identity
 * 2. Matching a VERIFIED identity against the `ADMIN_USERS` environment variable (e.g. "sakel,github:sakel-hub")
 */
export function checkIsAdmin(
  user: { username?: string; role?: string } | null,
  identities: Array<{ provider: string; username: string; verified?: number | boolean }> = [],
  adminUsersEnv?: string
): boolean {
  if (!user) return false;

  const verifiedIdentities = identities.filter(id => id.verified === 1 || id.verified === true);
  const hasVerifiedIdentity = verifiedIdentities.length > 0;

  if ((user.role === 'admin' || user.role === 'moderator') && hasVerifiedIdentity) {
    return true;
  }

  if (!hasVerifiedIdentity) {
    return false;
  }

  const rawList = (adminUsersEnv || 'sakel,sakel-hub').split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  for (const id of verifiedIdentities) {
    const handle = (id.username || '').toLowerCase();
    const qualified = `${(id.provider || '').toLowerCase()}:${handle}`;
    if (rawList.includes(handle) || rawList.includes(qualified)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a username is listed in the protected `ADMIN_USERS` list
 */
export function isProtectedAdminHandle(username: string, provider?: string, adminUsersEnv?: string): boolean {
  const rawList = (adminUsersEnv || 'sakel,sakel-hub').split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const lower = (username || '').trim().toLowerCase();
  if (!lower) return false;
  if (rawList.includes(lower)) return true;
  if (provider && rawList.includes(`${provider.toLowerCase()}:${lower}`)) return true;
  return false;
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

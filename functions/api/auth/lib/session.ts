// Secure session cookie management using Web Crypto API
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
    const [k, v] = cookie.trim().split('=');
    if (k && v) cookies[k] = decodeURIComponent(v);
  }
  return cookies;
}

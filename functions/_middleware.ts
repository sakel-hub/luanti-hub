// Global Edge Security, Origin Guard & Per-IP Quota Protection Middleware

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateBucket>();
const MAX_STORE_ENTRIES = 5000;

const BLOCKED_BOT_PATTERN =
  /\b(GPTBot|ChatGPT-User|CCBot|ClaudeBot|anthropic-ai|Bytespider|PetalBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|BLEXBot|DataForSeoBot|Scrapy)\b/i;

function pruneRateLimitStore(now: number): void {
  if (rateLimitStore.size <= MAX_STORE_ENTRIES) return;
  for (const [key, bucket] of rateLimitStore.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
  if (rateLimitStore.size > MAX_STORE_ENTRIES) {
    const keysToDelete = Array.from(rateLimitStore.keys()).slice(0, 1000);
    for (const k of keysToDelete) {
      rateLimitStore.delete(k);
    }
  }
}

export function checkEdgeRateLimit(
  ip: string,
  bucketType: 'mutation' | 'download' | 'api_read',
  limit: number,
  windowMs: number,
  now = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  pruneRateLimitStore(now);
  const key = `${bucketType}:${ip}`;
  const existing = rateLimitStore.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function isSameHostOrigin(headerValue: string | null, requestHost: string): boolean {
  if (!headerValue) return true;
  try {
    const parsed = new URL(headerValue);
    const originHost = parsed.hostname.toLowerCase();
    const targetHost = requestHost.split(':')[0].toLowerCase();
    if (originHost === targetHost) return true;
    if (
      (originHost === 'localhost' || originHost === '127.0.0.1') &&
      (targetHost === 'localhost' || targetHost === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
  env: Record<string, any>;
}): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const method = request.method.toUpperCase();

  const isApiRoute = pathname.startsWith('/api/');
  const isDownloadRoute = pathname.endsWith('/download') || pathname.endsWith('/download/');

  if (!isApiRoute && !isDownloadRoute) {
    return next();
  }

  // 1. Block known aggressive AI scrapers & automated SEO crawlers from burning Function/D1 quotas
  const userAgent = request.headers.get('User-Agent') || '';
  if (BLOCKED_BOT_PATTERN.test(userAgent)) {
    return Response.json(
      { error: 'Automated scraping of API and download endpoints is not permitted.' },
      { status: 403 }
    );
  }

  // 2. Cross-Origin & Hotlink Protection
  // In-game Luanti C++ clients do not send `Origin` or `Sec-Fetch-Site`, so they remain unaffected.
  // Browsers on third-party websites DO send `Origin` and `Sec-Fetch-Site: cross-site`.
  // Note: OAuth 2.0 authorization and callback redirects inherently cross origins between LuantiHub
  // and third-party identity providers (GitHub, Codeberg, Mesehub, GitLab, ContentDB) and are
  // cryptographically protected by signed HMAC state tokens in the callback handler.
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  const secFetchSite = (request.headers.get('Sec-Fetch-Site') || '').toLowerCase();
  const requestHost = url.host;

  const isOAuthFlow =
    pathname.startsWith('/api/auth/') &&
    (pathname.includes('/callback') || pathname.includes('/login'));

  if (!isOAuthFlow && origin && !isSameHostOrigin(origin, requestHost)) {
    return Response.json(
      { error: 'Forbidden: Cross-origin API hotlinking is not allowed.' },
      { status: 403 }
    );
  }

  const isStateMutating = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
  const isInternalWebEndpoint =
    (pathname.startsWith('/api/auth/') && !isOAuthFlow) ||
    pathname.startsWith('/api/packages/git') ||
    pathname.startsWith('/api/packages/top10') ||
    pathname.startsWith('/api/users/') ||
    pathname.startsWith('/api/admin/') ||
    pathname.endsWith('/moderate');

  if (isStateMutating || isInternalWebEndpoint) {
    if (secFetchSite === 'cross-site') {
      return Response.json(
        { error: 'Forbidden: Cross-site requests are blocked.' },
        { status: 403 }
      );
    }
    if (referer && !isSameHostOrigin(referer, requestHost)) {
      return Response.json(
        { error: 'Forbidden: Invalid request referer.' },
        { status: 403 }
      );
    }
  }

  // 3. Per-IP Sliding-Window Edge Rate Limiting (protects Worker & D1 quotas before hitting DB/upstreams)
  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous';

  const isHydrateEndpoint = pathname.startsWith('/api/packages/hydrate');
  const isHeavyEndpoint =
    !isHydrateEndpoint && (
      isStateMutating ||
      pathname.startsWith('/api/packages/git') ||
      pathname.startsWith('/api/users/') ||
      pathname.startsWith('/api/admin/')
    );

  const rateCheck = isHeavyEndpoint
    ? checkEdgeRateLimit(clientIp, 'mutation', 15, 60_000)
    : isDownloadRoute
      ? checkEdgeRateLimit(clientIp, 'download', 30, 60_000)
      : checkEdgeRateLimit(clientIp, 'api_read', 120, 60_000);

  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded. Please wait a moment before making more requests.'
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateCheck.retryAfterSeconds)
        }
      }
    );
  }

  return next();
}

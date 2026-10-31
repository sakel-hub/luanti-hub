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
    const originHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const targetHost = requestHost.split(':')[0].toLowerCase().replace(/^www\./, '');
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

const SECTION_HUB_SEO_MAP: Record<
  string,
  { title: string; breadcrumbName: string; description: string }
> = {
  '/games': {
    title: 'Luanti Games — Open-Source Voxel Games | Luanti Hub',
    breadcrumbName: 'Games',
    description:
      'Discover and download full open-source voxel games for Luanti (formerly Minetest), from survival sandboxes to RPGs and puzzle adventures.'
  },
  '/mods': {
    title: 'Luanti Mods — Gameplay, Worldgen & Mobs | Luanti Hub',
    breadcrumbName: 'Mods',
    description:
      'Browse thousands of open-source Luanti mods for mapgen, technology, magic, mobs, and multiplayer servers with 1-click install.'
  },
  '/texture-packs': {
    title: 'Luanti Texture Packs — HD & Pixel Art Resource Packs | Luanti Hub',
    breadcrumbName: 'Texture Packs',
    description:
      'Customize your Luanti visual style with community pixel-art, HD, and stylized voxel texture packs.'
  },
  '/git': {
    title: 'Decentralized Git Community Packages | Luanti Hub',
    breadcrumbName: 'Git Community',
    description:
      'Direct Git repository releases from Codeberg, Mesehub, GitLab, and GitHub packaged automatically for the Luanti engine.'
  },
  '/setup': {
    title: 'In-Game Repository Setup — Connect Luanti to LuantiHub | Luanti Hub',
    breadcrumbName: 'In-Game Setup',
    description:
      'Configure your Luanti client in 30 seconds to browse and install LuantiHub packages directly inside the in-game Content tab.'
  },
  '/submit': {
    title: 'Submit Git Mod — Publish to LuantiHub | Luanti Hub',
    breadcrumbName: 'Submit Git Mod',
    description:
      'Publish your Luanti mod, game, or texture pack directly from GitHub, Codeberg, Mesehub, or GitLab with instant automated verification.'
  },
  '/legal': {
    title: 'Legal, DMCA & Safe Harbor — SPDX Open-Source Governance | Luanti Hub',
    breadcrumbName: 'Terms & Privacy',
    description:
      'Official Luanti trademark disclaimer, SPDX open-source license enforcement, and DMCA / EU DSA Safe Harbor policy.'
  }
};

function escapeHtmlAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectSectionSeoIntoHtml(
  html: string,
  sectionPath: string,
  meta: { title: string; breadcrumbName: string; description: string }
): string {
  const canonicalUrl = `https://luantihub.org${sectionPath}`;
  const safeTitle = escapeHtmlAttr(meta.title);
  const safeDesc = escapeHtmlAttr(meta.description);
  const breadcrumbJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: meta.breadcrumbName,
    description: meta.description,
    url: canonicalUrl,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Luanti Hub',
          item: 'https://luantihub.org/'
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: meta.breadcrumbName,
          item: canonicalUrl
        }
      ]
    }
  });

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${safeDesc}" />`
    )
    .replace(
      /<link\s+rel="canonical"[^>]*?>/i,
      `<link rel="canonical" id="canonical-link" href="${canonicalUrl}" />`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:url" content="${canonicalUrl}" />`
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${safeDesc}" />`
    )
    .replace(
      '</head>',
      `<script type="application/ld+json" id="luanti-pkg-jsonld">${breadcrumbJsonLd}</script></head>`
    );
}

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
  env: Record<string, any>;
}): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  const isApiRoute = pathname.startsWith('/api/');
  const isDownloadRoute = pathname.endsWith('/download') || pathname.endsWith('/download/');

  // Redirect legacy *.pages.dev web/crawler requests to canonical https://luantihub.org
  // while keeping /api/* and /download endpoints active for legacy in-game Luanti clients.
  if (url.hostname.toLowerCase() === 'luanti-hub.pages.dev' && !isApiRoute && !isDownloadRoute) {
    return Response.redirect(`https://luantihub.org${url.pathname}${url.search}`, 301);
  }

  if (!isApiRoute && !isDownloadRoute) {
    const sectionMeta = SECTION_HUB_SEO_MAP[pathname];
    const res = await next();
    const assetsBinding = context.env?.['ASSETS'];
    if (res.status === 404 && method === 'GET' && !pathname.includes('.') && assetsBinding && typeof assetsBinding.fetch === 'function') {
      const rootUrl = new URL('/', url.origin);
      const spaRes = await assetsBinding.fetch(
        new Request(rootUrl.toString(), {
          method: 'GET',
          headers: { Accept: 'text/html,application/xhtml+xml' }
        })
      );
      if (sectionMeta) {
        const rawHtml = await spaRes.text();
        return new Response(injectSectionSeoIntoHtml(rawHtml, pathname, sectionMeta), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300, s-maxage=900'
          }
        });
      }
      return new Response(spaRes.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        }
      });
    }
    if (sectionMeta && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      const rawHtml = await res.text();
      return new Response(injectSectionSeoIntoHtml(rawHtml, pathname, sectionMeta), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300, s-maxage=900'
        }
      });
    }
    return res;
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

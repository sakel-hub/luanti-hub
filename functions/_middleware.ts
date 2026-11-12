// Global Edge Security, Origin Guard & Per-IP Quota Protection Middleware
import {
  EPHEMERAL_TUNNEL_HOST_PATTERN,
  INBOUND_TUNNEL_SUBSTRING_PATTERN
} from '../src/app/core/config/git-providers.config';

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateBucket>();
const MAX_STORE_ENTRIES = 5000;

const BLOCKED_BOT_PATTERN =
  /\b(GPTBot|ChatGPT-User|CCBot|ClaudeBot|anthropic-ai|Bytespider|PetalBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|BLEXBot|DataForSeoBot|Scrapy|sqlmap|nuclei|nikto|ffuf|gobuster|dirbuster|feroxbuster|wfuzz|masscan|zgrab|nmap|acunetix|nessus|metasploit|dalfox|commix)\b/i;

const SCANNER_PROBE_PATTERN =
  /^\/(?:\.env|\.git|\.aws|\.docker|\.ssh|\.kube|wp-admin|wp-login|wp-content|wp-includes|phpmyadmin|xmlrpc\.php|vendor\/phpunit|actuator|server-status|cgi-bin|_ignition|cloudflared|etc\/passwd)(?:\/|$|\.)/i;

export function detectInboundEphemeralTunnelHeader(
  request: Request
): { header: string; value: string } | null {
  const candidateHeaders = [
    'Origin',
    'Referer',
    'X-Forwarded-Host',
    'Forwarded',
    'X-Original-Host',
    'X-Host',
    'X-Forwarded-Server',
    'X-HTTP-Host-Override',
    'True-Client-IP',
    'Cf-Worker',
    'Via'
  ];
  for (const headerName of candidateHeaders) {
    const raw = request.headers.get(headerName);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      if (trimmed.includes('://')) {
        const parsed = new URL(trimmed);
        if (EPHEMERAL_TUNNEL_HOST_PATTERN.test(parsed.hostname.toLowerCase())) {
          return { header: headerName, value: trimmed.slice(0, 200) };
        }
        continue;
      }
    } catch {
      // Fall through to substring inspection
    }
    if (
      EPHEMERAL_TUNNEL_HOST_PATTERN.test(trimmed.toLowerCase()) ||
      INBOUND_TUNNEL_SUBSTRING_PATTERN.test(trimmed)
    ) {
      return { header: headerName, value: trimmed.slice(0, 200) };
    }
  }
  return null;
}

export const ENFORCING_CSP_HEADER =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self' https://content.luanti.org https://github.com https://codeberg.org https://git.minetest.land https://gitlab.com; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' data:; media-src 'self' https: blob:; connect-src 'self' https:; frame-src https:; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests";

function applyEdgeSecurityHeaders(res: Response, requestUrl?: URL): Response {
  try {
    const isLocalHttpDev =
      requestUrl?.protocol === 'http:' &&
      (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1');
    const headers = new Headers(res.headers);
    if (!headers.has('X-Content-Type-Options')) {
      headers.set('X-Content-Type-Options', 'nosniff');
    }
    if (!headers.has('X-Frame-Options')) {
      headers.set('X-Frame-Options', 'SAMEORIGIN');
    }
    if (!headers.has('Referrer-Policy')) {
      headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }
    if (!headers.has('Permissions-Policy')) {
      headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    }
    if (!isLocalHttpDev && !headers.has('Strict-Transport-Security')) {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (!headers.has('Cross-Origin-Opener-Policy')) {
      headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    }
    if (!headers.has('X-Permitted-Cross-Domain-Policies')) {
      headers.set('X-Permitted-Cross-Domain-Policies', 'none');
    }
    if (!headers.has('Content-Security-Policy')) {
      const cspValue = isLocalHttpDev
        ? ENFORCING_CSP_HEADER
            .replace('; upgrade-insecure-requests', '')
            .replace(
              "connect-src 'self' https:;",
              "connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;"
            )
        : ENFORCING_CSP_HEADER;
      headers.set('Content-Security-Policy', cspValue);
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  } catch {
    return res;
  }
}

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
  bucketType:
    | 'auth_verify'
    | 'mutation'
    | 'download'
    | 'hydrate'
    | 'api_read'
    | 'git_audit'
    | 'sync'
    | 'ssr'
    | 'proxy_image',
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

function isTrustedLuantiHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return (
    h === 'luantihub.org' ||
    h.endsWith('.luantihub.org') ||
    h === 'luanti-hub.pages.dev'
  );
}

function isSameHostOrigin(headerValue: string | null, requestHost: string): boolean {
  if (!headerValue) return true;
  try {
    const parsed = new URL(headerValue);
    const originHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const targetHost = requestHost.split(':')[0].toLowerCase().replace(/^www\./, '');
    if (originHost === targetHost) return true;
    if (isTrustedLuantiHost(originHost) && isTrustedLuantiHost(targetHost)) return true;
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
    title: 'Legal, Privacy Policy, DMCA Safe Harbor & Account Deletion | Luanti Hub',
    breadcrumbName: 'Terms, Privacy & Data Deletion',
    description:
      'Official LuantiHub Privacy Policy, Google Play & GDPR Account & Data Deletion instructions, Luanti trademark disclaimer, and DMCA / EU DSA Safe Harbor policy.'
  },
  '/blog': {
    title: 'Official Luanti Blog — Engine News & Updates | Luanti Hub',
    breadcrumbName: 'Luanti Blog',
    description:
      'Read the latest official Luanti (formerly Minetest) engine announcements, security updates, and community news on Luanti Hub.'
  }
};

function escapeHtmlAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const SUPPORTED_NON_EN_LOCALES: Record<
  string,
  { ogLocale: string; homeTitle: string; homeDesc: string }
> = {
  sk: {
    ogLocale: 'sk_SK',
    homeTitle: 'Luanti Hub (LuantiHub) — Mody, hry a textúry pre Luanti',
    homeDesc:
      'Luanti Hub (LuantiHub) je otvorený katalóg balíčkov pre engine Luanti (bývalý Minetest). Stiahnite si tisíce hier, modov a textúr priamo ako .zip, z Gitu alebo priamo v hre.'
  },
  de: {
    ogLocale: 'de_DE',
    homeTitle: 'Luanti Hub (LuantiHub) — Mods, Spiele & Texturpakete für Luanti',
    homeDesc:
      'Luanti Hub (LuantiHub) ist das offene Paketverzeichnis für die Voxel-Engine Luanti (ehemals Minetest). Tausende Spiele, Mods und Texturpakete als .zip, Git-Paket oder per 1-Klick im Spiel.'
  },
  fr: {
    ogLocale: 'fr_FR',
    homeTitle: 'Luanti Hub (LuantiHub) — Mods, Jeux et Packs de Textures pour Luanti',
    homeDesc:
      'Luanti Hub (LuantiHub) est le registre ouvert de paquets pour le moteur voxel Luanti (anciennement Minetest). Téléchargez des milliers de jeux, mods et packs de textures en .zip, Git ou en jeu.'
  },
  es: {
    ogLocale: 'es_ES',
    homeTitle: 'Luanti Hub (LuantiHub) — Mods, Juegos y Paquetes de Texturas para Luanti',
    homeDesc:
      'Luanti Hub (LuantiHub) es el registro abierto de paquetes para el motor voxel Luanti (antes Minetest). Descarga miles de juegos, mods y paquetes de texturas en .zip, Git o con 1 clic en el juego.'
  },
  ru: {
    ogLocale: 'ru_RU',
    homeTitle: 'Luanti Hub (LuantiHub) — Моды, игры и текстурпаки для Luanti',
    homeDesc:
      'Luanti Hub (LuantiHub) — открытый каталог пакетов для воксельного движка Luanti (ранее Minetest). Тысячи игр, модов и текстурпаков в формате .zip, из Git или в 1 клик прямо в игре.'
  }
};

function resolveNonEnLocale(searchParams: URLSearchParams): string | null {
  const raw = (searchParams.get('lang') || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUPPORTED_NON_EN_LOCALES, raw) ? raw : null;
}

function buildHreflangLinksHtml(baseCanonicalUrl: string): string {
  const locales = ['en', 'sk', 'de', 'fr', 'es', 'ru'];
  const lines = [
    `<link rel="alternate" hreflang="x-default" href="${escapeHtmlAttr(baseCanonicalUrl)}" />`
  ];
  for (const loc of locales) {
    const href = loc === 'en' ? baseCanonicalUrl : `${baseCanonicalUrl}?lang=${loc}`;
    lines.push(`<link rel="alternate" hreflang="${loc}" href="${escapeHtmlAttr(href)}" />`);
  }
  return lines.join('\n    ');
}

function replaceHreflangBlock(html: string, baseCanonicalUrl: string): string {
  const newBlock = buildHreflangLinksHtml(baseCanonicalUrl);
  if (/<link\s+rel="alternate"\s+hreflang="/i.test(html)) {
    let inserted = false;
    return html.replace(/\s*<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*?>/gi, () => {
      if (!inserted) {
        inserted = true;
        return `\n    ${newBlock}`;
      }
      return '';
    });
  }
  return html.replace(
    /(<link\s+rel="canonical"[^>]*?>)/i,
    `$1\n    ${newBlock}`
  );
}

function injectHomeLocaleSeoIntoHtml(html: string, locale: string): string {
  const locMeta = SUPPORTED_NON_EN_LOCALES[locale];
  if (!locMeta) return html;
  const canonicalUrl = `https://luantihub.org/?lang=${locale}`;
  const safeTitle = escapeHtmlAttr(locMeta.homeTitle);
  const safeDesc = escapeHtmlAttr(locMeta.homeDesc);

  return html
    .replace(/<html\s+lang="en"/i, `<html lang="${escapeHtmlAttr(locale)}"`)
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
      /<meta\s+property="og:locale"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:locale" content="${locMeta.ogLocale}" />`
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${safeDesc}" />`
    );
}

function injectSectionSeoIntoHtml(
  html: string,
  sectionPath: string,
  meta: { title: string; breadcrumbName: string; description: string },
  nonEnLocale: string | null = null
): string {
  const baseCanonicalUrl = `https://luantihub.org${sectionPath}`;
  const canonicalUrl = nonEnLocale ? `${baseCanonicalUrl}?lang=${nonEnLocale}` : baseCanonicalUrl;
  const locMeta = nonEnLocale ? SUPPORTED_NON_EN_LOCALES[nonEnLocale] : null;
  const safeTitle = escapeHtmlAttr(meta.title);
  const safeDesc = escapeHtmlAttr(meta.description);
  const safeBreadcrumb = escapeHtmlAttr(meta.breadcrumbName);
  const breadcrumbJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: meta.breadcrumbName,
    description: meta.description,
    url: canonicalUrl,
    inLanguage: nonEnLocale || 'en',
    isPartOf: {
      '@type': 'WebSite',
      '@id': 'https://luantihub.org/#website',
      name: 'Luanti Hub'
    },
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
          item: baseCanonicalUrl
        }
      ]
    }
  });

  let transformed = html
    .replace(/\s*<script[^>]*id="home-faq-jsonld"[^>]*>[\s\S]*?<\/script>/gi, '')
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
      /<h1>[\s\S]*?<\/h1>/i,
      `<h1>Luanti ${safeBreadcrumb} — ${safeTitle}</h1><p>${safeDesc}</p>`
    )
    .replace(
      '</head>',
      `<script type="application/ld+json" id="luanti-pkg-jsonld">${breadcrumbJsonLd}</script></head>`
    );

  transformed = replaceHreflangBlock(transformed, baseCanonicalUrl);

  if (nonEnLocale && locMeta) {
    transformed = transformed
      .replace(/<html\s+lang="en"/i, `<html lang="${escapeHtmlAttr(nonEnLocale)}"`)
      .replace(
        /<meta\s+property="og:locale"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:locale" content="${locMeta.ogLocale}" />`
      );
  }

  return transformed;
}

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
  env: Record<string, any>;
}): Promise<Response> {
  const { request, next } = context;
  const url = new URL(request.url);
  const withSecurityHeaders = (res: Response): Response => applyEdgeSecurityHeaders(res, url);
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous';
  const userAgent = request.headers.get('User-Agent') || '';

  const isApiRoute = pathname.startsWith('/api/');
  const isDownloadRoute = pathname.endsWith('/download');
  const isDynamicSsrRoute =
    !isDownloadRoute &&
    (pathname.startsWith('/package/') ||
      pathname.startsWith('/packages/') ||
      pathname.startsWith('/author/') ||
      pathname === '/sitemap.xml');

  // 0. Detect & block inbound Cloudflare Quick Tunnel (*.trycloudflare.com) or disposable reverse-tunnel proxying / spoofed forwarding headers
  // (Allow normal top-level GET/HEAD HTML link clicks where only `Referer` came from a dev preview page)
  const matchedTunnelHeader = detectInboundEphemeralTunnelHeader(request);
  const isSafeTopLevelLinkNavigation =
    !isApiRoute &&
    !isDownloadRoute &&
    (method === 'GET' || method === 'HEAD') &&
    matchedTunnelHeader?.header === 'Referer' &&
    request.headers.get('Sec-Fetch-Mode') === 'navigate';
  if (matchedTunnelHeader && !isSafeTopLevelLinkNavigation) {
    console.warn(
      JSON.stringify({
        event: 'SECURITY_ALERT:EPHEMERAL_TUNNEL_BLOCKED',
        clientIp,
        method,
        pathname,
        matchedHeader: matchedTunnelHeader.header,
        matchedValue: matchedTunnelHeader.value,
        userAgent: userAgent.slice(0, 160),
        timestamp: new Date().toISOString()
      })
    );
    return withSecurityHeaders(
      Response.json(
        { error: 'Forbidden: Requests proxied or originated through ephemeral tunnels are blocked.' },
        { status: 403 }
      )
    );
  }

  // Immediately block automated vulnerability scanner probes (/.env, /wp-admin/*, /.git/*, etc.)
  // with an edge-cached 404 Not Found so they do not fall through to the SPA 200 OK shell.
  if (SCANNER_PROBE_PATTERN.test(pathname)) {
    return withSecurityHeaders(
      new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400'
        }
      })
    );
  }

  // Redirect legacy *.pages.dev and www.luantihub.org web/crawler requests to canonical https://luantihub.org
  // while keeping /api/* and /download endpoints active for legacy in-game Luanti clients.
  const lowerHost = url.hostname.toLowerCase();
  const isLegacyWebHost = lowerHost === 'luanti-hub.pages.dev' || lowerHost === 'www.luantihub.org';

  // Redirect /privacy and /delete-account to canonical /legal route in a single hop (for Google Play Console & GDPR compliance)
  if ((pathname === '/privacy' || pathname === '/delete-account') && !isApiRoute) {
    const targetOrigin = isLegacyWebHost ? 'https://luantihub.org' : url.origin;
    return Response.redirect(`${targetOrigin}/legal${url.search}`, 301);
  }

  if (isLegacyWebHost && !isApiRoute && !isDownloadRoute) {
    return Response.redirect(`https://luantihub.org${url.pathname}${url.search}`, 301);
  }

  // Block known aggressive AI scrapers, automated SEO crawlers & offensive scanners across API, download, and dynamic SSR/D1 routes
  if ((isApiRoute || isDownloadRoute || isDynamicSsrRoute) && BLOCKED_BOT_PATTERN.test(userAgent)) {
    return withSecurityHeaders(
      Response.json(
        { error: 'Automated scraping of API and download endpoints is not permitted.' },
        { status: 403 }
      )
    );
  }

  if (!isApiRoute && !isDownloadRoute) {
    if (isDynamicSsrRoute) {
      const ssrRateCheck = checkEdgeRateLimit(clientIp, 'ssr', 90, 60_000);
      if (!ssrRateCheck.allowed) {
        return withSecurityHeaders(
          new Response('Rate limit exceeded. Please wait a moment before making more requests.', {
            status: 429,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Retry-After': String(ssrRateCheck.retryAfterSeconds)
            }
          })
        );
      }
    }
    const sectionMeta = SECTION_HUB_SEO_MAP[pathname];
    const nonEnLocale = resolveNonEnLocale(url.searchParams);
    const isKnownSpaRoute =
      pathname === '/' ||
      Boolean(sectionMeta) ||
      pathname === '/profile' ||
      pathname === '/analytics' ||
      pathname.startsWith('/analytics/');
    const assetsBinding = context.env?.['ASSETS'];
    try {
      const res = await next();
      if (res.status === 404 && method === 'GET' && !pathname.includes('.') && assetsBinding && typeof assetsBinding.fetch === 'function') {
        if (!isKnownSpaRoute) {
          return withSecurityHeaders(
            new Response(
              '<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="robots" content="noindex" /><title>404 Not Found | Luanti Hub</title></head><body><h1>404 Not Found</h1><p><a href="/">Return to Luanti Hub</a></p></body></html>',
              {
                status: 404,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'X-Robots-Tag': 'noindex',
                  'Cache-Control': 'public, max-age=300, s-maxage=600'
                }
              }
            )
          );
        }
        const rootUrl = new URL('/', url.origin);
        const spaRes = await assetsBinding.fetch(
          new Request(rootUrl.toString(), {
            method: 'GET',
            headers: { Accept: 'text/html,application/xhtml+xml' }
          })
        );
        if (sectionMeta) {
          const rawHtml = await spaRes.text();
          return withSecurityHeaders(
            new Response(injectSectionSeoIntoHtml(rawHtml, pathname, sectionMeta, nonEnLocale), {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=300, s-maxage=900'
              }
            })
          );
        }
        if (pathname === '/' && nonEnLocale) {
          const rawHtml = await spaRes.text();
          return withSecurityHeaders(
            new Response(injectHomeLocaleSeoIntoHtml(rawHtml, nonEnLocale), {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=300, s-maxage=900'
              }
            })
          );
        }
        return withSecurityHeaders(
          new Response(spaRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate'
            }
          })
        );
      }
      if (sectionMeta && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
        const rawHtml = await res.text();
        return withSecurityHeaders(
          new Response(injectSectionSeoIntoHtml(rawHtml, pathname, sectionMeta, nonEnLocale), {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300, s-maxage=900'
            }
          })
        );
      }
      if (pathname === '/' && nonEnLocale && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
        const rawHtml = await res.text();
        return withSecurityHeaders(
          new Response(injectHomeLocaleSeoIntoHtml(rawHtml, nonEnLocale), {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300, s-maxage=900'
            }
          })
        );
      }
      return withSecurityHeaders(res);
    } catch (err: any) {
      console.error('[Edge Navigation Error]', {
        method,
        url: request.url,
        error: err?.stack || String(err)
      });
      if (method === 'GET' && assetsBinding && typeof assetsBinding.fetch === 'function') {
        const rootUrl = new URL('/', url.origin);
        const spaRes = await assetsBinding.fetch(
          new Request(rootUrl.toString(), {
            method: 'GET',
            headers: { Accept: 'text/html,application/xhtml+xml' }
          })
        );
        const rawHtml = await spaRes.text();
        const fallbackHtml = sectionMeta
          ? injectSectionSeoIntoHtml(rawHtml, pathname, sectionMeta, nonEnLocale)
          : pathname === '/' && nonEnLocale
            ? injectHomeLocaleSeoIntoHtml(rawHtml, nonEnLocale)
            : rawHtml;
        return withSecurityHeaders(
          new Response(fallbackHtml, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store, no-cache, must-revalidate'
            }
          })
        );
      }
      throw err;
    }
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
    return withSecurityHeaders(
      Response.json(
        { error: 'Forbidden: Cross-origin API hotlinking is not allowed.' },
        { status: 403 }
      )
    );
  }

  const isStateMutating = method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
  const isReadOnlyAuthStatus = pathname === '/api/auth/me' && (method === 'GET' || method === 'HEAD');
  const isInternalWebEndpoint =
    (pathname.startsWith('/api/auth/') && !isOAuthFlow && !isReadOnlyAuthStatus) ||
    pathname.startsWith('/api/packages/git') ||
    pathname.startsWith('/api/packages/top10') ||
    pathname.startsWith('/api/users/') ||
    pathname.startsWith('/api/admin/') ||
    pathname.startsWith('/api/promotions') ||
    pathname.endsWith('/moderate');

  if (isStateMutating || isInternalWebEndpoint) {
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return withSecurityHeaders(
        Response.json(
          { error: 'Forbidden: Cross-site requests are blocked.' },
          { status: 403 }
        )
      );
    }
    const secFetchMode = (request.headers.get('Sec-Fetch-Mode') || '').toLowerCase();
    if (isStateMutating && !isOAuthFlow && secFetchMode === 'navigate') {
      return withSecurityHeaders(
        Response.json(
          { error: 'Forbidden: Top-level navigation mutations are blocked.' },
          { status: 403 }
        )
      );
    }
    if (referer && !isSameHostOrigin(referer, requestHost)) {
      return withSecurityHeaders(
        Response.json(
          { error: 'Forbidden: Invalid request referer.' },
          { status: 403 }
        )
      );
    }
  }

  // 3. Per-IP Sliding-Window Edge Rate Limiting (protects Worker & D1 quotas before hitting DB/upstreams)
  const isAuthTokenVerifyEndpoint = pathname === '/api/auth/me' && method === 'POST';
  const isGitAuditEndpoint = pathname.startsWith('/api/packages/git');
  const isSyncContentDbEndpoint =
    pathname.startsWith('/api/users/') && pathname.includes('/sync-contentdb');
  const isHydrateEndpoint = pathname.startsWith('/api/packages/hydrate');
  const isProxyImageEndpoint = pathname === '/api/packages' && url.searchParams.has('proxy_image');
  const isHeavyEndpoint =
    !isAuthTokenVerifyEndpoint &&
    !isGitAuditEndpoint &&
    !isSyncContentDbEndpoint &&
    !isHydrateEndpoint &&
    (isStateMutating ||
      pathname.startsWith('/api/users/') ||
      pathname.startsWith('/api/admin/') ||
      pathname.startsWith('/api/promotions'));

  const rateCheck = isAuthTokenVerifyEndpoint
    ? checkEdgeRateLimit(clientIp, 'auth_verify', 5, 60_000)
    : isGitAuditEndpoint
      ? checkEdgeRateLimit(clientIp, 'git_audit', 10, 60_000)
      : isSyncContentDbEndpoint
        ? checkEdgeRateLimit(clientIp, 'sync', 6, 60_000)
        : isHeavyEndpoint
          ? checkEdgeRateLimit(clientIp, 'mutation', 15, 60_000)
          : isHydrateEndpoint
            ? checkEdgeRateLimit(clientIp, 'hydrate', 30, 60_000)
            : isDownloadRoute
              ? checkEdgeRateLimit(clientIp, 'download', 120, 60_000)
              : isProxyImageEndpoint
                ? checkEdgeRateLimit(clientIp, 'proxy_image', 120, 60_000)
                : checkEdgeRateLimit(clientIp, 'api_read', 120, 60_000);

  if (!rateCheck.allowed) {
    return withSecurityHeaders(
      new Response(
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
      )
    );
  }

  try {
    const res = await next();
    return withSecurityHeaders(res);
  } catch (err: any) {
    console.error('[Edge API Unhandled Error]', {
      method,
      url: request.url,
      error: err?.stack || String(err)
    });
    return withSecurityHeaders(
      Response.json(
        { error: 'Internal server error.' },
        { status: 500 }
      )
    );
  }
}

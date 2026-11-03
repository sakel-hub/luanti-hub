import {
  fetchUpstreamJsonCached,
  computeGenuineStarRating,
  safeDecodeParam,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../../api/lib/upstream';

interface Env {
  DB?: any;
  ASSETS?: { fetch: (req: Request | URL | string) => Promise<Response> };
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeInlineScriptJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function fetchSpaShellHtml(
  assets: Env['ASSETS'],
  origin: string
): Promise<string> {
  if (!assets || typeof assets.fetch !== 'function') {
    return '<!doctype html><html lang="en"><head><title>Luanti Hub</title><meta name="description" content="" /><meta name="keywords" content="" /><link rel="canonical" id="canonical-link" href="https://luantihub.org/" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:url" content="" /><meta property="og:image" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta name="twitter:image" content="" /></head><body><app-root><main class="sr-only"></main></app-root></body></html>';
  }
  const assetUrl = new URL('/', origin);
  let assetRes = await assets.fetch(
    new Request(assetUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' }
    })
  );
  if (assetRes.status >= 300 && assetRes.status < 400) {
    const redirectLoc = assetRes.headers.get('Location') || '/';
    assetRes = await assets.fetch(
      new Request(new URL(redirectLoc, origin).toString(), {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      })
    );
  }
  return await assetRes.text();
}

export function injectPackageSeoIntoHtml(
  html: string,
  opts: {
    fullTitle: string;
    pkgDesc: string;
    keywordsContent: string;
    canonicalUrl: string;
    pkgThumb: string;
    semanticBodyHtml: string;
    jsonLd: string;
    initialPkgScript: string;
  }
): string {
  const safeTitle = escapeHtml(opts.fullTitle);
  const safeDesc = escapeHtml(opts.pkgDesc);
  const safeKeywords = escapeHtml(opts.keywordsContent);
  const safeCanonical = escapeHtml(opts.canonicalUrl);
  const safeThumb = escapeHtml(opts.pkgThumb);
  const scriptBlock = `<script id="luanti-pkg-jsonld" type="application/ld+json">${opts.jsonLd}</script><script id="luanti-initial-pkg">window.__LUANTI_INITIAL_PACKAGE__=${opts.initialPkgScript};</script>`;

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${safeTitle}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+name="keywords"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="keywords" content="${safeKeywords}" />`
    )
    .replace(
      /<link\s+rel="canonical"[^>]*?>/i,
      () => `<link rel="canonical" id="canonical-link" href="${safeCanonical}" />`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:url" content="${safeCanonical}" />`
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:image" content="${safeThumb}" />`
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:image" content="${safeThumb}" />`
    )
    .replace(
      /<main\s+class="sr-only">[\s\S]*?<\/main>/i,
      () => `<main class="sr-only">${opts.semanticBodyHtml}</main>`
    )
    .replace(/<\/head>/i, () => `${scriptBlock}</head>`);
}

export async function onRequestGet(context: {
  request: Request;
  params: { author: string; name: string };
  env: Env;
}) {
  const rawAuthor = String(context.params?.author || '');
  const rawName = String(context.params?.name || '');
  const author = safeDecodeParam(rawAuthor).trim() || rawAuthor;
  const name = safeDecodeParam(rawName).trim() || rawName;

  const reqUrl = new URL(context.request.url);
  const origin = reqUrl.origin || 'https://luantihub.org';
  const canonicalOrigin = origin.includes('luanti-hub.pages.dev') ? 'https://luantihub.org' : origin;
  const canonicalUrl = `${canonicalOrigin}/package/${encodeURIComponent(author)}/${encodeURIComponent(name)}`;

  // If the incoming URL contains nested/double percent-encoding (e.g. `%2520` from crawler loops),
  // immediately issue a 301 Permanent Redirect to the clean canonical URL.
  if (/%25[0-9A-Fa-f]{2}/.test(rawAuthor) || /%25[0-9A-Fa-f]{2}/.test(rawName)) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${canonicalUrl}${reqUrl.search}`,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }

  let pkgCleanTitle = name;
  let pkgDesc = `Download and install ${name} by ${author} for Luanti (Minetest) on Luanti Hub.`;
  let pkgLongDesc = '';
  let pkgThumb = `${canonicalOrigin}/icons/icon-512x512.png`;
  let pkgBanner = '';
  let pkgType = 'mod';
  let pkgLicense = 'Open Source';
  let pkgDownloads = 0;
  let pkgScore = 0;
  let pkgReviewCount = 0;
  let pkgTags: string[] = [];
  let pkgDeps: string[] = [];

  const toAbsoluteSeoImageUrl = (rawImg?: string | null): string => {
    const trimmed = String(rawImg || '').trim();
    if (!trimmed || trimmed === 'logo.svg' || trimmed === '/logo.svg') {
      return `${canonicalOrigin}/icons/icon-512x512.png`;
    }
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `${canonicalOrigin}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
  };

  const ssrMetaCacheKey = `https://cache.luantihub.internal/ssr-pkg-meta-v2/${encodeURIComponent(author.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`;

  const lookupMetadata = async () => {
    try {
      const cachedMeta = await readEdgeCacheJson<any>(ssrMetaCacheKey);
      if (cachedMeta && typeof cachedMeta === 'object' && cachedMeta.pkgCleanTitle) {
        pkgCleanTitle = cachedMeta.pkgCleanTitle;
        pkgDesc = cachedMeta.pkgDesc || pkgDesc;
        pkgLongDesc = cachedMeta.pkgLongDesc || pkgDesc;
        pkgThumb = cachedMeta.pkgThumb || pkgThumb;
        pkgBanner = cachedMeta.pkgBanner || '';
        pkgType = cachedMeta.pkgType || 'mod';
        pkgLicense = cachedMeta.pkgLicense || pkgLicense;
        pkgDownloads = Number(cachedMeta.pkgDownloads) || 0;
        pkgScore = Number(cachedMeta.pkgScore) || 0;
        pkgReviewCount = Number(cachedMeta.pkgReviewCount) || 0;
        pkgTags = Array.isArray(cachedMeta.pkgTags) ? cachedMeta.pkgTags : [];
        pkgDeps = Array.isArray(cachedMeta.pkgDeps) ? cachedMeta.pkgDeps : [];
        return;
      }

      let pkgData: any = null;
      let d1RatingAvg: number | null = null;

      if (context.env?.DB) {
        const [pkgRow, ratingRow] = await Promise.all([
          context.env.DB.prepare(
            `SELECT * FROM packages WHERE LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)`
          ).bind(author, name).first(),
          context.env.DB.prepare(
            `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE LOWER(package_id) = LOWER(?)`
          ).bind(`${author}/${name}`).first()
        ]);
        pkgData = pkgRow;
        if (ratingRow && Number(ratingRow.cnt) > 0 && ratingRow.avg_rating != null) {
          d1RatingAvg = Number(ratingRow.avg_rating);
          pkgReviewCount += Number(ratingRow.cnt);
        }
      }

      if (pkgData && (pkgData.provider !== 'contentdb' || pkgData.long_desc || pkgData.short_desc || pkgData.banner_url)) {
        pkgCleanTitle = pkgData.title || name;
        pkgDesc = pkgData.short_desc || pkgDesc;
        pkgLongDesc = pkgData.long_desc || pkgDesc;
        if (pkgData.banner_url && pkgData.banner_url !== 'logo.svg') {
          pkgBanner = String(pkgData.banner_url);
        }
        pkgThumb = pkgBanner || pkgData.thumbnail_url || pkgThumb;
        pkgType = pkgData.type || 'mod';
        pkgLicense = pkgData.license || pkgLicense;
        pkgDownloads = Number(pkgData.downloads_count) || 0;
        pkgScore = computeGenuineStarRating(d1RatingAvg, pkgData.score);
        try {
          if (pkgData.tags) pkgTags = JSON.parse(pkgData.tags);
        } catch {
          // ignore
        }
        try {
          if (pkgData.dependencies) pkgDeps = JSON.parse(pkgData.dependencies);
        } catch {
          // ignore
        }
      }

      if (!pkgData || pkgData.provider === 'contentdb') {
        const upstream = await fetchUpstreamJsonCached<any>(
          `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
          600
        );
        if (upstream) {
          pkgCleanTitle = upstream.title || pkgCleanTitle;
          pkgDesc = upstream.short_desc || upstream.short_description || pkgDesc;
          pkgLongDesc = upstream.long_description || pkgLongDesc || pkgDesc;
          const upstreamThumb =
            upstream.thumbnail ||
            (Array.isArray(upstream.screenshots) && (upstream.screenshots[0]?.url || upstream.screenshots[0]));
          pkgThumb = pkgBanner || upstreamThumb || pkgThumb;
          pkgType = upstream.type || pkgType || 'mod';
          pkgLicense = upstream.license || pkgLicense;
          pkgDownloads = Math.max(pkgDownloads, Number(upstream.downloads) || 0);
          if (Array.isArray(upstream.tags)) {
            pkgTags = upstream.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title)).filter(Boolean);
          }
          if (Array.isArray(upstream.reviews)) {
            pkgReviewCount += upstream.reviews.length;
          }
          pkgScore = computeGenuineStarRating(d1RatingAvg, upstream.reviews);
        }
      }

      pkgThumb = toAbsoluteSeoImageUrl(pkgBanner || pkgThumb);
      if (pkgBanner) {
        pkgBanner = toAbsoluteSeoImageUrl(pkgBanner);
      }

      await writeEdgeCacheJson(
        ssrMetaCacheKey,
        {
          pkgCleanTitle,
          pkgDesc,
          pkgLongDesc,
          pkgThumb,
          pkgBanner,
          pkgType,
          pkgLicense,
          pkgDownloads,
          pkgScore,
          pkgReviewCount,
          pkgTags,
          pkgDeps
        },
        600
      );
    } catch (err: any) {
      console.error('[Package Metadata Lookup Error]', {
        author,
        name,
        error: err?.stack || String(err)
      });
    }
  };

  try {
    const [rawHtml] = await Promise.all([
      fetchSpaShellHtml(context.env?.ASSETS, origin),
      lookupMetadata()
    ]);

    const typeLabel = pkgType === 'game' ? 'Game' : pkgType === 'txp' ? 'Texture Pack' : 'Mod';
    const sectionPath = pkgType === 'game' ? '/games' : pkgType === 'txp' ? '/texture-packs' : '/mods';
    const sectionLabel = pkgType === 'game' ? 'Luanti Games' : pkgType === 'txp' ? 'Luanti Texture Packs' : 'Luanti Mods';
    const fullTitle = `${pkgCleanTitle} by ${author} — Luanti ${typeLabel} | Luanti Hub`;
    const keywordsContent = [
      'luanti',
      `luanti ${pkgType === 'txp' ? 'texture pack' : pkgType}`,
      pkgCleanTitle,
      name,
      author,
      'luanti hub',
      'luantihub',
      'minetest',
      ...pkgTags.slice(0, 8)
    ].join(', ');

    const softwareAppSchema: Record<string, any> = {
      '@type': 'SoftwareApplication',
      '@id': `${canonicalUrl}#software`,
      name: pkgCleanTitle,
      alternateName: `${name} (Luanti ${typeLabel})`,
      applicationCategory: 'GameApplication',
      applicationSubCategory: `Luanti ${typeLabel}`,
      operatingSystem: 'Windows, macOS, Linux, Android, iOS',
      description: pkgDesc,
      url: canonicalUrl,
      image: pkgThumb,
      license: pkgLicense,
      isPartOf: {
        '@type': 'WebSite',
        '@id': 'https://luantihub.org/#website',
        name: 'Luanti Hub'
      },
      author: {
        '@type': 'Person',
        name: author
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      }
    };

    if (pkgScore >= 1 && pkgScore <= 5) {
      softwareAppSchema['aggregateRating'] = {
        '@type': 'AggregateRating',
        ratingValue: String(pkgScore),
        bestRating: '5',
        worstRating: '1',
        ratingCount: String(Math.max(1, pkgReviewCount))
      };
    }

    const breadcrumbSchema = {
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
          name: sectionLabel,
          item: `https://luantihub.org${sectionPath}`
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: pkgCleanTitle,
          item: canonicalUrl
        }
      ]
    };

    const jsonLd = serializeInlineScriptJson({
      '@context': 'https://schema.org',
      '@graph': [softwareAppSchema, breadcrumbSchema]
    });
    const initialPkgScript = serializeInlineScriptJson({
      author,
      name,
      title: pkgCleanTitle,
      short_desc: pkgDesc,
      thumbnail: pkgThumb,
      ...(pkgBanner ? { banner: pkgBanner } : {}),
      type: pkgType,
      downloads: pkgDownloads,
      score: pkgScore
    });

    const cleanLongDescSnippet = escapeHtml((pkgLongDesc || pkgDesc).slice(0, 1800));
    const semanticBodyHtml = `
    <nav aria-label="Breadcrumb">
      <a href="/">Luanti Hub</a> &rsaquo;
      <a href="${escapeHtml(sectionPath)}">${escapeHtml(sectionLabel)}</a> &rsaquo;
      <span>${escapeHtml(pkgCleanTitle)}</span>
    </nav>
    <article>
      <h1>${escapeHtml(pkgCleanTitle)} — Luanti ${escapeHtml(typeLabel)} by ${escapeHtml(author)}</h1>
      <p><strong>${escapeHtml(pkgDesc)}</strong></p>
      <div>${cleanLongDescSnippet}</div>
      <ul>
        <li><strong>Engine:</strong> Luanti (formerly Minetest)</li>
        <li><strong>Package Type:</strong> Luanti ${escapeHtml(typeLabel)}</li>
        <li><strong>Author:</strong> ${escapeHtml(author)}</li>
        <li><strong>Technical Name:</strong> <code>${escapeHtml(name)}</code></li>
        <li><strong>License:</strong> ${escapeHtml(pkgLicense)}</li>
        ${pkgTags.length > 0 ? `<li><strong>Tags:</strong> ${escapeHtml(pkgTags.join(', '))}</li>` : ''}
        ${pkgDeps.length > 0 ? `<li><strong>Dependencies:</strong> ${escapeHtml(pkgDeps.join(', '))}</li>` : ''}
      </ul>
      <p>
        Download <strong>${escapeHtml(pkgCleanTitle)}</strong> as a ready-to-drop <code>.zip</code> archive or install directly inside the Luanti client via Luanti Hub.
        Explore more <a href="/games">Luanti Games</a>, <a href="/mods">Luanti Mods</a>, and <a href="/texture-packs">Luanti Texture Packs</a> on <a href="/">Luanti Hub (LuantiHub)</a>.
      </p>
    </article>
  `;

    const transformedHtml = injectPackageSeoIntoHtml(rawHtml, {
      fullTitle,
      pkgDesc,
      keywordsContent,
      canonicalUrl,
      pkgThumb,
      semanticBodyHtml,
      jsonLd,
      initialPkgScript
    });

    return new Response(transformedHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
      }
    });
  } catch (err: any) {
    console.error('[Package SSR Handler Error]', {
      author,
      name,
      error: err?.stack || String(err)
    });
    const fallbackHtml = await fetchSpaShellHtml(context.env?.ASSETS, origin).catch(
      () => '<!doctype html><html lang="en"><head><title>Luanti Hub</title></head><body><app-root></app-root></body></html>'
    );
    return new Response(fallbackHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  }
}

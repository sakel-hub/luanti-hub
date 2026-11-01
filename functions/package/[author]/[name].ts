import { fetchUpstreamJsonCached, computeGenuineStarRating } from '../../api/lib/upstream';

interface Env {
  DB?: any;
  ASSETS: { fetch: (req: Request | URL | string) => Promise<Response> };
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function onRequestGet(context: {
  request: Request;
  params: { author: string; name: string };
  env: Env;
}) {
  const { author, name } = context.params;
  const reqUrl = new URL(context.request.url);
  const origin = reqUrl.origin || 'https://luantihub.org';
  const canonicalOrigin = origin.includes('luanti-hub.pages.dev') ? 'https://luantihub.org' : origin;
  const canonicalUrl = `${canonicalOrigin}/package/${encodeURIComponent(author)}/${encodeURIComponent(name)}`;

  // Fetch SPA shell from Cloudflare Pages static assets using '/' (not '/index.html', which triggers a 308 redirect to '/' on Cloudflare Pages)
  const assetUrl = new URL('/', origin);
  let assetRes = await context.env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' }
    })
  );
  if (assetRes.status >= 300 && assetRes.status < 400) {
    const redirectLoc = assetRes.headers.get('Location') || '/';
    assetRes = await context.env.ASSETS.fetch(
      new Request(new URL(redirectLoc, origin).toString(), {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      })
    );
  }
  const baseResponse = new Response(assetRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    }
  });

  let pkgCleanTitle = name;
  let pkgTitle = `${name} by ${author}`;
  let pkgDesc = `Download and install ${name} by ${author} for Luanti (Minetest) on Luanti Hub.`;
  let pkgLongDesc = '';
  let pkgThumb = `${canonicalOrigin}/icons/icon-512x512.png`;
  let pkgType = 'mod';
  let pkgLicense = 'Open Source';
  let pkgDownloads = 0;
  let pkgScore = 0;
  let pkgReviewCount = 0;
  let pkgTags: string[] = [];
  let pkgDeps: string[] = [];

  try {
    let pkgData: any = null;
    let d1RatingAvg: number | null = null;

    if (context.env.DB) {
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

    if (pkgData && (pkgData.provider !== 'contentdb' || pkgData.long_desc || pkgData.short_desc)) {
      pkgCleanTitle = pkgData.title || name;
      pkgTitle = `${pkgCleanTitle} by ${pkgData.author_name || author}`;
      pkgDesc = pkgData.short_desc || pkgDesc;
      pkgLongDesc = pkgData.long_desc || pkgDesc;
      pkgThumb = pkgData.thumbnail_url || pkgThumb;
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
        pkgTitle = `${pkgCleanTitle} by ${upstream.author || author}`;
        pkgDesc = upstream.short_desc || upstream.short_description || pkgDesc;
        pkgLongDesc = upstream.long_description || pkgLongDesc || pkgDesc;
        pkgThumb = upstream.thumbnail || (Array.isArray(upstream.screenshots) && upstream.screenshots[0]?.url) || pkgThumb;
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
  } catch {
    // Fallback to default derived metadata if lookup fails
  }

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

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [softwareAppSchema, breadcrumbSchema]
  });
  const initialPkgScript = JSON.stringify({
    author,
    name,
    title: pkgCleanTitle,
    short_desc: pkgDesc,
    thumbnail: pkgThumb,
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

  if (typeof (globalThis as any).HTMLRewriter === 'undefined') {
    return baseResponse;
  }

  const rewriter = new (globalThis as any).HTMLRewriter()
    .on('title', {
      element(el: any) {
        el.setInnerContent(escapeHtml(fullTitle));
      }
    })
    .on('meta[name="description"]', {
      element(el: any) {
        el.setAttribute('content', pkgDesc);
      }
    })
    .on('meta[name="keywords"]', {
      element(el: any) {
        el.setAttribute('content', keywordsContent);
      }
    })
    .on('link[rel="canonical"]', {
      element(el: any) {
        el.setAttribute('href', canonicalUrl);
      }
    })
    .on('meta[property="og:title"]', {
      element(el: any) {
        el.setAttribute('content', fullTitle);
      }
    })
    .on('meta[property="og:description"]', {
      element(el: any) {
        el.setAttribute('content', pkgDesc);
      }
    })
    .on('meta[property="og:url"]', {
      element(el: any) {
        el.setAttribute('content', canonicalUrl);
      }
    })
    .on('meta[property="og:image"]', {
      element(el: any) {
        el.setAttribute('content', pkgThumb);
      }
    })
    .on('meta[name="twitter:title"]', {
      element(el: any) {
        el.setAttribute('content', fullTitle);
      }
    })
    .on('meta[name="twitter:description"]', {
      element(el: any) {
        el.setAttribute('content', pkgDesc);
      }
    })
    .on('meta[name="twitter:image"]', {
      element(el: any) {
        el.setAttribute('content', pkgThumb);
      }
    })
    .on('main.sr-only', {
      element(el: any) {
        el.setInnerContent(semanticBodyHtml, { html: true });
      }
    })
    .on('head', {
      element(el: any) {
        el.append(
          `<script id="luanti-pkg-jsonld" type="application/ld+json">${jsonLd}</script><script id="luanti-initial-pkg">window.__LUANTI_INITIAL_PACKAGE__=${initialPkgScript};</script>`,
          { html: true }
        );
      }
    });

  return rewriter.transform(baseResponse);
}

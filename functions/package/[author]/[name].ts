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
  const origin = reqUrl.origin || 'https://luanti-hub.pages.dev';
  const canonicalUrl = `${origin}/package/${encodeURIComponent(author)}/${encodeURIComponent(name)}`;

  // Fetch SPA shell from Cloudflare Pages static assets
  const assetUrl = new URL('/index.html', origin);
  const baseResponse = await context.env.ASSETS.fetch(new Request(assetUrl.toString(), context.request));

  let pkgTitle = `${name} by ${author}`;
  let pkgDesc = `Download and install ${name} by ${author} for Luanti (Minetest) on Luanti Hub.`;
  let pkgThumb = `${origin}/icons/icon-512x512.png`;
  let pkgType = 'mod';
  let pkgDownloads = 0;
  let pkgScore = 0;
  let pkgReviewCount = 0;

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

    if (pkgData && pkgData.provider !== 'contentdb') {
      pkgTitle = `${pkgData.title || name} by ${pkgData.author_name || author}`;
      pkgDesc = pkgData.short_desc || pkgDesc;
      pkgThumb = pkgData.thumbnail_url || pkgThumb;
      pkgType = pkgData.type || 'mod';
      pkgDownloads = Number(pkgData.downloads_count) || 0;
      pkgScore = computeGenuineStarRating(d1RatingAvg, pkgData.score);
    } else {
      const upstream = await fetchUpstreamJsonCached<any>(
        `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/`,
        600
      );
      if (upstream) {
        pkgTitle = `${upstream.title || name} by ${upstream.author || author}`;
        pkgDesc = upstream.short_desc || upstream.short_description || pkgDesc;
        pkgThumb = upstream.thumbnail || (Array.isArray(upstream.screenshots) && upstream.screenshots[0]?.url) || pkgThumb;
        pkgType = upstream.type || 'mod';
        pkgDownloads = Number(upstream.downloads) || 0;
        if (Array.isArray(upstream.reviews)) {
          pkgReviewCount += upstream.reviews.length;
        }
        pkgScore = computeGenuineStarRating(d1RatingAvg, upstream.reviews);
      }
    }
  } catch {
    // Fallback to default derived metadata if lookup fails
  }

  const fullTitle = `${pkgTitle} — Luanti Hub (${pkgType.toUpperCase()})`;
  const jsonLdObj: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: pkgTitle,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Windows, macOS, Linux, Android',
    description: pkgDesc,
    url: canonicalUrl,
    image: pkgThumb,
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
    jsonLdObj['aggregateRating'] = {
      '@type': 'AggregateRating',
      ratingValue: String(pkgScore),
      bestRating: '5',
      worstRating: '1',
      ratingCount: String(Math.max(1, pkgReviewCount))
    };
  }

  const jsonLd = JSON.stringify(jsonLdObj);

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
    .on('head', {
      element(el: any) {
        el.append(`<script id="luanti-pkg-jsonld" type="application/ld+json">${jsonLd}</script>`, {
          html: true
        });
      }
    });

  return rewriter.transform(baseResponse);
}

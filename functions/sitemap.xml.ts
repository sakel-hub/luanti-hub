import {
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from './api/lib/upstream';

interface Env {
  DB?: any;
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const origin = 'https://luantihub.org';
  const today = new Date().toISOString().split('T')[0];
  const sitemapCacheKey = `https://cache.luantihub.internal/sitemap-xml-v2/${today}`;

  const cachedXml = await readEdgeCacheJson<{ xml: string }>(sitemapCacheKey);
  if (cachedXml && typeof cachedXml.xml === 'string' && cachedXml.xml.startsWith('<?xml')) {
    return new Response(cachedXml.xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'
      }
    });
  }

  const staticUrls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'hourly' },
    { loc: `${origin}/games`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/mods`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/texture-packs`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/git`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/blog`, priority: '0.8', changefreq: 'daily' },
    { loc: `${origin}/setup`, priority: '0.9', changefreq: 'monthly' },
    { loc: `${origin}/submit`, priority: '0.9', changefreq: 'weekly' },
    { loc: `${origin}/legal`, priority: '0.8', changefreq: 'monthly' }
  ];

  const packageLastModByUrl = new Map<string, string>();
  const normalizeIsoDate = (raw: unknown): string => {
    if (!raw || typeof raw !== 'string') return today;
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : today;
  };

  // 1. Add active packages from Cloudflare D1
  if (context.env.DB) {
    try {
      const d1Rows = await context.env.DB.prepare(
        `SELECT author_name, name, updated_at, created_at FROM packages WHERE status = 'active' LIMIT 1000`
      ).all();
      for (const r of d1Rows.results || []) {
        if (r.author_name && r.name) {
          const pkgUrl = `${origin}/package/${encodeURIComponent(r.author_name)}/${encodeURIComponent(r.name)}`;
          packageLastModByUrl.set(pkgUrl, normalizeIsoDate(r.updated_at || r.created_at));
        }
      }
    } catch {
      // Ignore D1 errors
    }
  }

  // 2. Add top 1,500 packages from upstream ContentDB (cached for 6 hours at Edge)
  try {
    const upstreamList = await fetchUpstreamJsonCached<any[]>('/packages/?limit=1500', 21600);
    if (Array.isArray(upstreamList)) {
      for (const p of upstreamList.slice(0, 1500)) {
        if (p.author && p.name) {
          const pkgUrl = `${origin}/package/${encodeURIComponent(p.author)}/${encodeURIComponent(p.name)}`;
          if (!packageLastModByUrl.has(pkgUrl)) {
            packageLastModByUrl.set(pkgUrl, normalizeIsoDate(p.updated_at || p.created_at));
          }
        }
      }
    }
  } catch {
    // Ignore upstream errors
  }

  const locales = ['en', 'sk', 'de', 'fr', 'es', 'ru'];

  const urlEntries: string[] = [];

  for (const s of staticUrls) {
    const hreflangLinks = locales
      .map(
        (lang) =>
          `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(
            s.loc.includes('?') ? `${s.loc}&lang=${lang}` : `${s.loc}?lang=${lang}`
          )}" />`
      )
      .join('\n');

    urlEntries.push(`  <url>
    <loc>${escapeXml(s.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${s.changefreq}</changefreq>
    <priority>${s.priority}</priority>
${hreflangLinks}
  </url>`);
  }

  for (const [pkgLoc, lastmod] of packageLastModByUrl.entries()) {
    urlEntries.push(`  <url>
    <loc>${escapeXml(pkgLoc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries.join('\n')}
</urlset>`;

  await writeEdgeCacheJson(sitemapCacheKey, { xml }, 21600);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'
    }
  });
}

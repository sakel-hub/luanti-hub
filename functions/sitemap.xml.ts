import { fetchUpstreamJsonCached } from './api/lib/upstream';

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

  const staticUrls = [
    { loc: `${origin}/`, priority: '1.0', changefreq: 'hourly' },
    { loc: `${origin}/submit`, priority: '0.8', changefreq: 'weekly' },
    { loc: `${origin}/setup`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${origin}/analytics`, priority: '0.8', changefreq: 'daily' },
    { loc: `${origin}/?type=game`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/?type=mod`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/?type=txp`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/?source=git`, priority: '0.8', changefreq: 'daily' }
  ];

  const packageUrls = new Set<string>();

  // 1. Add active packages from Cloudflare D1
  if (context.env.DB) {
    try {
      const d1Rows = await context.env.DB.prepare(
        `SELECT author_name, name FROM packages WHERE status = 'active' LIMIT 250`
      ).all();
      for (const r of d1Rows.results || []) {
        if (r.author_name && r.name) {
          packageUrls.add(`${origin}/package/${encodeURIComponent(r.author_name)}/${encodeURIComponent(r.name)}`);
        }
      }
    } catch {
      // Ignore D1 errors
    }
  }

  // 2. Add top packages from upstream ContentDB
  try {
    const upstreamList = await fetchUpstreamJsonCached<any[]>('/packages/?limit=150', 3600);
    if (Array.isArray(upstreamList)) {
      for (const p of upstreamList.slice(0, 150)) {
        if (p.author && p.name) {
          packageUrls.add(`${origin}/package/${encodeURIComponent(p.author)}/${encodeURIComponent(p.name)}`);
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

  for (const pkgLoc of packageUrls) {
    urlEntries.push(`  <url>
    <loc>${escapeXml(pkgLoc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}

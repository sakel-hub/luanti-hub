import {
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from './api/lib/upstream';
import { resolveCanonicalAuthorDisplay } from './author/[username]';

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

const FLAGSHIP_SAKEL_PACKAGES: Array<{ author: string; name: string }> = [
  { author: 'SaKeL', name: 'everness' },
  { author: 'SaKeL', name: 'x_farming' },
  { author: 'SaKeL', name: 'x_bows' },
  { author: 'SaKeL', name: 'x_enchanting' },
  { author: 'SaKeL', name: 'x_tumbleweed' },
  { author: 'SaKeL', name: 'mcl_decor' },
  { author: 'SaKeL', name: 'pixie' },
  { author: 'SaKeL', name: 'rhotator' },
  { author: 'sakel-hub', name: 'x_mobs' },
  { author: 'sakel-hub', name: 'waysigns' }
];

export async function onRequestGet(context: { request: Request; env: Env }) {
  const isHead = context.request.method.toUpperCase() === 'HEAD';
  const origin = 'https://luantihub.org';
  const today = new Date().toISOString().split('T')[0];
  const sitemapCacheKey = `https://cache.luantihub.internal/sitemap-xml-v4/${today}`;

  const cachedXml = await readEdgeCacheJson<{ xml: string }>(sitemapCacheKey);
  if (cachedXml && typeof cachedXml.xml === 'string' && cachedXml.xml.startsWith('<?xml')) {
    return new Response(isHead ? null : cachedXml.xml, {
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
    { loc: `${origin}/author/SaKeL`, priority: '0.9', changefreq: 'daily' },
    { loc: `${origin}/blog`, priority: '0.8', changefreq: 'daily' },
    { loc: `${origin}/setup`, priority: '0.9', changefreq: 'monthly' },
    { loc: `${origin}/submit`, priority: '0.9', changefreq: 'weekly' },
    { loc: `${origin}/legal`, priority: '0.8', changefreq: 'monthly' }
  ];

  const normalizeIsoDate = (raw: unknown): string => {
    if (!raw || typeof raw !== 'string') return today;
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : today;
  };

  // Keyed by `<baseAuthorLower>/<nameLower>` so dual-source packages (e.g. `sakel-hub/everness` and `SaKeL/everness`)
  // emit a single canonical URL in sitemap.xml without splitting SEO authority.
  const packageEntriesByCanonicalKey = new Map<
    string,
    { author: string; name: string; lastmod: string; priority: string; isOfficialCdb: boolean }
  >();

  const upsertSitemapPackage = (
    rawAuthor: string,
    rawName: string,
    rawDate: unknown,
    isOfficialCdb: boolean
  ) => {
    const author = String(rawAuthor || '').trim();
    const name = String(rawName || '').trim();
    if (!author || !name) return;
    const identity = resolveCanonicalAuthorDisplay(author);
    const dedupKey = `${identity.baseAuthor.toLowerCase()}/${name.toLowerCase()}`;
    const lastmod = normalizeIsoDate(rawDate);
    const priority = identity.isSakel ? '0.9' : '0.8';
    const existing = packageEntriesByCanonicalKey.get(dedupKey);
    if (!existing) {
      packageEntriesByCanonicalKey.set(dedupKey, {
        author: isOfficialCdb && identity.isSakel ? 'SaKeL' : author,
        name,
        lastmod,
        priority,
        isOfficialCdb
      });
      return;
    }
    // Prefer official ContentDB canonical casing (e.g. `SaKeL` over `sakel-hub`) when available
    if (isOfficialCdb && !existing.isOfficialCdb) {
      existing.author = identity.isSakel ? 'SaKeL' : author;
      existing.isOfficialCdb = true;
    }
    if (lastmod > existing.lastmod) {
      existing.lastmod = lastmod;
    }
  };

  // Seed flagship SaKeL packages first so they are always guaranteed in sitemap.xml
  for (const pkg of FLAGSHIP_SAKEL_PACKAGES) {
    upsertSitemapPackage(pkg.author, pkg.name, today, pkg.author === 'SaKeL');
  }

  const authorUrls = new Set<string>();

  // 1. Add active packages and verified creators from Cloudflare D1
  if (context.env.DB) {
    try {
      const d1Rows = await context.env.DB.prepare(
        `SELECT author_name, name, provider, updated_at, created_at FROM packages WHERE status = 'active' LIMIT 1000`
      ).all();
      for (const r of d1Rows.results || []) {
        if (r.author_name && r.name) {
          upsertSitemapPackage(
            r.author_name,
            r.name,
            r.updated_at || r.created_at,
            String(r.provider || '').toLowerCase() === 'contentdb'
          );
        }
      }
    } catch {
      // Ignore D1 package errors
    }

    try {
      const userRows = await context.env.DB.prepare(
        `SELECT username, display_name FROM users LIMIT 100`
      ).all();
      for (const u of userRows.results || []) {
        if (u.username) {
          const resolved = resolveCanonicalAuthorDisplay(u.username, u.display_name);
          if (resolved.canonicalSlug && resolved.canonicalSlug.toLowerCase() !== 'sakel') {
            authorUrls.add(`${origin}/author/${encodeURIComponent(resolved.canonicalSlug)}`);
          }
        }
      }
    } catch {
      // Ignore D1 user errors
    }
  }

  // 2. Add all SaKeL packages + top 1,500 packages from upstream ContentDB (cached for 6 hours at Edge)
  try {
    const [sakelUpstreamList, upstreamList] = await Promise.all([
      fetchUpstreamJsonCached<any[]>('/packages/?author=SaKeL&limit=200', 21600).catch(() => null),
      fetchUpstreamJsonCached<any[]>('/packages/?limit=1500', 21600).catch(() => null)
    ]);
    if (Array.isArray(sakelUpstreamList)) {
      for (const p of sakelUpstreamList) {
        if (p?.author && p?.name) {
          upsertSitemapPackage(p.author, p.name, p.updated_at || p.created_at, true);
        }
      }
    }
    if (Array.isArray(upstreamList)) {
      for (const p of upstreamList.slice(0, 1500)) {
        if (p?.author && p?.name) {
          upsertSitemapPackage(p.author, p.name, p.updated_at || p.created_at, true);
        }
      }
    }
  } catch {
    // Ignore upstream errors
  }

  const locales = ['en', 'sk', 'de', 'fr', 'es', 'ru'];

  const urlEntries: string[] = [];

  for (const s of staticUrls) {
    const xDefaultLink = `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(s.loc)}" />`;
    const hreflangLinks = [
      xDefaultLink,
      ...locales.map(
        (lang) =>
          `    <xhtml:link rel="alternate" hreflang="${lang}" href="${escapeXml(
            s.loc.includes('?') ? `${s.loc}&lang=${lang}` : `${s.loc}?lang=${lang}`
          )}" />`
      )
    ].join('\n');

    urlEntries.push(`  <url>
    <loc>${escapeXml(s.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${s.changefreq}</changefreq>
    <priority>${s.priority}</priority>
${hreflangLinks}
  </url>`);
  }

  for (const authorLoc of authorUrls) {
    urlEntries.push(`  <url>
    <loc>${escapeXml(authorLoc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
  }

  for (const entry of packageEntriesByCanonicalKey.values()) {
    const pkgLoc = `${origin}/package/${encodeURIComponent(entry.author)}/${encodeURIComponent(entry.name)}`;
    urlEntries.push(`  <url>
    <loc>${escapeXml(pkgLoc)}</loc>
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${entry.priority}</priority>
  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntries.join('\n')}
</urlset>`;

  await writeEdgeCacheJson(sitemapCacheKey, { xml }, 21600);

  return new Response(isHead ? null : xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'
    }
  });
}

export async function onRequestHead(context: { request: Request; env: Env }) {
  return onRequestGet(context);
}

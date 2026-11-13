import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../api/lib/upstream';

interface Env {
  DB?: any;
  ASSETS?: { fetch: (req: Request | URL | string) => Promise<Response> };
}

export interface AuthorSsrPackageItem {
  author: string;
  name: string;
  title: string;
  short_desc: string;
  type: 'game' | 'mod' | 'txp';
  license?: string;
  downloads?: number;
  tags?: string[];
}

const SAKEL_FALLBACK_PACKAGES: AuthorSsrPackageItem[] = [
  {
    author: 'SaKeL',
    name: 'everness',
    title: 'Everness',
    short_desc: 'Explore new custom biomes, structures, dungeons, dimensions, blocks, and mobs in Luanti.',
    type: 'mod',
    license: 'LGPL-2.1-only',
     tags: ['mapgen', 'biomes', 'dungeons', 'environment']
  },
  {
    author: 'SaKeL',
    name: 'x_farming',
    title: 'X Farming',
    short_desc: 'Extensive farming mod adding new crops, trees, foods, crates, bees, and cooking recipes for Luanti.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['plants_and_farming', 'food', 'crafting']
  },
  {
    author: 'SaKeL',
    name: 'x_bows',
    title: 'X Bows',
    short_desc: 'Bows, quivers, and custom arrows with particle effects and enchantments for Luanti.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['combat', 'tools', 'pvp']
  },
  {
    author: 'SaKeL',
    name: 'x_enchanting',
    title: 'X Enchanting',
    short_desc: 'Enchanting table, bookshelves, and custom tool/weapon/armor enchantments for Luanti.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['magic', 'tools', 'combat']
  },
  {
    author: 'SaKeL',
    name: 'x_tumbleweed',
    title: 'X Tumbleweed',
    short_desc: 'Rolling desert tumbleweeds that blow with the wind and drop useful survival items.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['environment', 'mobs', 'survival']
  },
  {
    author: 'SaKeL',
    name: 'mcl_decor',
    title: 'MineClone2 Decor (mcl_decor)',
    short_desc: 'Decorative blocks, furniture, and building elements tailored for voxel survival games.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['decorative', 'building']
  },
  {
    author: 'SaKeL',
    name: 'pixie',
    title: 'Pixie',
    short_desc: 'Magical glowing pixie entities and ambient forest atmosphere for Luanti.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['mobs', 'magic', 'environment']
  },
  {
    author: 'SaKeL',
    name: 'rhotator',
    title: 'Rhotator',
    short_desc: 'Intuitive multi-axis screwdriver and node rotation utility with visual HUD feedback.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['tools', 'building', 'creative']
  },
  {
    author: 'sakel-hub',
    name: 'x_mobs',
    title: 'X Mobs',
    short_desc: 'Community Git mob collection and AI behaviors built for the Luanti voxel engine.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['mobs', 'animals_and_monsters', 'git']
  },
  {
    author: 'sakel-hub',
    name: 'waysigns',
    title: 'Waysigns',
    short_desc: 'Directional signposts and wayfinding markers for roads, villages, and trails in Luanti.',
    type: 'mod',
    license: 'LGPL-2.1-only',
    tags: ['decorative', 'building', 'transport']
  }
];

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
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function normalizeBaseAuthorHandle(rawAuthor: string): string {
  return String(rawAuthor || '')
    .trim()
    .replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
}

export function resolveCanonicalAuthorDisplay(rawAuthor: string, explicitDisplay?: string | null): {
  canonicalSlug: string;
  displayName: string;
  baseAuthor: string;
  isSakel: boolean;
} {
  const trimmed = String(rawAuthor || '').trim();
  const baseAuthor = normalizeBaseAuthorHandle(trimmed) || trimmed;
  const isSakel = baseAuthor.toLowerCase() === 'sakel';
  if (isSakel) {
    return {
      canonicalSlug: 'SaKeL',
      displayName: 'SaKeL',
      baseAuthor: 'sakel',
      isSakel: true
    };
  }
  const cleanExplicit = String(explicitDisplay || '').trim();
  const displayName = cleanExplicit || baseAuthor || trimmed;
  const canonicalSlug = !/\s/.test(displayName) ? displayName : trimmed;
  return {
    canonicalSlug,
    displayName,
    baseAuthor: baseAuthor.toLowerCase(),
    isSakel: false
  };
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

export function injectAuthorSeoIntoHtml(
  html: string,
  opts: {
    fullTitle: string;
    description: string;
    keywordsContent: string;
    canonicalUrl: string;
    avatarUrl: string;
    semanticBodyHtml: string;
    jsonLd: string;
  }
): string {
  const safeTitle = escapeHtml(opts.fullTitle);
  const safeDesc = escapeHtml(opts.description);
  const safeKeywords = escapeHtml(opts.keywordsContent);
  const safeCanonical = escapeHtml(opts.canonicalUrl);
  const safeAvatar = escapeHtml(opts.avatarUrl);
  const scriptBlock = `<script id="luanti-pkg-jsonld" type="application/ld+json">${opts.jsonLd}</script>`;

  return html
    .replace(/\s*<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*?>/gi, '')
    .replace(/\s*<script[^>]*id="home-faq-jsonld"[^>]*>[\s\S]*?<\/script>/gi, '')
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
      () => `<meta property="og:image" content="${safeAvatar}" />`
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
      () => `<meta name="twitter:image" content="${safeAvatar}" />`
    )
    .replace(
      /<main\s+class="sr-only">[\s\S]*?<\/main>/i,
      () => `<main class="sr-only">${opts.semanticBodyHtml}</main>`
    )
    .replace(/<\/head>/i, () => `${scriptBlock}</head>`);
}

export async function onRequestGet(context: {
  request: Request;
  params: { username: string };
  env: Env;
}) {
  const rawUsername = String(context.params?.username || '');
  const decodedUsername = safeDecodeParam(rawUsername).trim() || rawUsername;

  const reqUrl = new URL(context.request.url);
  const origin = reqUrl.origin || 'https://luantihub.org';
  const canonicalOrigin = origin.includes('luanti-hub.pages.dev') ? 'https://luantihub.org' : origin;

  const initialIdentity = resolveCanonicalAuthorDisplay(decodedUsername);

  // Immediately 301-redirect double-encoded %25 URLs to the clean canonical URL
  if (/%25[0-9A-Fa-f]{2}/.test(rawUsername)) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${canonicalOrigin}/author/${encodeURIComponent(initialIdentity.canonicalSlug)}${reqUrl.search}`,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }

  let displayName = initialIdentity.displayName;
  let canonicalSlug = initialIdentity.canonicalSlug;
  let bio = initialIdentity.isSakel
    ? 'Creator of Everness, X Farming, X Bows, X Enchanting, X Mobs, Waysigns, and open-source Luanti (Minetest) mods, games, and texture packs on Luanti Hub.'
    : `Discover and download open-source Luanti (formerly Minetest) mods, games, and texture packs created by ${displayName} on Luanti Hub.`;
  let avatarUrl = `${canonicalOrigin}/icons/icon-512x512.png`;
  const sameAsSet = new Set<string>();
  if (initialIdentity.isSakel) {
    sameAsSet.add('https://content.luanti.org/users/SaKeL/');
    sameAsSet.add('https://codeberg.org/SaKeL');
    sameAsSet.add('https://github.com/sakel-hub');
    sameAsSet.add('https://ko-fi.com/sakel');
  }

  const packagesMap = new Map<string, AuthorSsrPackageItem>();
  if (initialIdentity.isSakel) {
    for (const item of SAKEL_FALLBACK_PACKAGES) {
      packagesMap.set(item.name.toLowerCase(), { ...item });
    }
  }

  const ssrAuthorCacheKey = `https://cache.luantihub.internal/ssr-author-meta-v1/${encodeURIComponent(initialIdentity.baseAuthor)}`;

  const lookupAuthorData = async () => {
    try {
      const cached = await readEdgeCacheJson<any>(ssrAuthorCacheKey);
      if (cached && typeof cached === 'object' && cached.displayName) {
        displayName = cached.displayName;
        canonicalSlug = cached.canonicalSlug || canonicalSlug;
        bio = cached.bio || bio;
        avatarUrl = cached.avatarUrl || avatarUrl;
        if (Array.isArray(cached.sameAs)) {
          cached.sameAs.forEach((u: string) => sameAsSet.add(u));
        }
        if (Array.isArray(cached.packages)) {
          packagesMap.clear();
          for (const p of cached.packages) {
            if (p?.name) packagesMap.set(String(p.name).toLowerCase(), p);
          }
        }
        return;
      }

      const handleCandidates = Array.from(
        new Set([
          decodedUsername.toLowerCase(),
          initialIdentity.baseAuthor.toLowerCase(),
          `${initialIdentity.baseAuthor.toLowerCase()}-hub`
        ])
      );

      if (context.env?.DB && typeof context.env.DB.prepare === 'function') {
        try {
          const userStmt = context.env.DB.prepare(
            `SELECT id, username, display_name, avatar_url, bio FROM users WHERE LOWER(username) IN (?, ?, ?) OR LOWER(TRIM(display_name)) = ? LIMIT 1`
          ).bind(
            handleCandidates[0] || '',
            handleCandidates[1] || handleCandidates[0] || '',
            handleCandidates[2] || handleCandidates[0] || '',
            initialIdentity.baseAuthor.toLowerCase()
          );
          const userRow = typeof userStmt.first === 'function' ? await userStmt.first() : null;
          if (userRow) {
            const resolved = resolveCanonicalAuthorDisplay(userRow.username || decodedUsername, userRow.display_name);
            displayName = resolved.displayName;
            canonicalSlug = resolved.canonicalSlug;
            if (userRow.bio && String(userRow.bio).trim()) {
              bio = String(userRow.bio).trim();
            }
            if (userRow.avatar_url && String(userRow.avatar_url).startsWith('http')) {
              avatarUrl = String(userRow.avatar_url);
            }
          }
        } catch {
          // Non-fatal D1 user lookup error
        }

        try {
          const pkgStmt = context.env.DB.prepare(
            `SELECT author_name, name, title, short_desc, type, license, downloads_count, tags FROM packages WHERE status = 'active' AND LOWER(author_name) IN (?, ?, ?) ORDER BY downloads_count DESC LIMIT 100`
          ).bind(
            handleCandidates[0] || '',
            handleCandidates[1] || handleCandidates[0] || '',
            handleCandidates[2] || handleCandidates[0] || ''
          );
          const pkgRes = typeof pkgStmt.all === 'function' ? await pkgStmt.all() : null;
          for (const row of pkgRes?.results || []) {
            if (!row?.name) continue;
            let parsedTags: string[] = [];
            try {
              if (row.tags) parsedTags = JSON.parse(row.tags);
            } catch {
              // ignore
            }
            const key = String(row.name).toLowerCase();
            const existing = packagesMap.get(key);
            packagesMap.set(key, {
              author: existing?.author === 'SaKeL' ? 'SaKeL' : (row.author_name || canonicalSlug),
              name: String(row.name),
              title: String(row.title || existing?.title || row.name),
              short_desc: String(row.short_desc || existing?.short_desc || `Download ${row.title || row.name} by ${displayName} for Luanti.`),
              type: row.type === 'game' || row.type === 'txp' ? row.type : 'mod',
              license: String(row.license || existing?.license || 'Open Source'),
              downloads: Number(row.downloads_count) || existing?.downloads || 0,
              tags: parsedTags.length > 0 ? parsedTags : existing?.tags
            });
          }
        } catch {
          // Non-fatal D1 package lookup error
        }
      }

      const cdbTarget = initialIdentity.isSakel ? 'SaKeL' : canonicalSlug;
      const [cdbUser, cdbPackages] = await Promise.all([
        fetchUpstreamJsonCached<any>(`/users/${encodeURIComponent(cdbTarget)}/`, 1800).catch(() => null),
        fetchUpstreamJsonCached<any[]>(`/packages/?author=${encodeURIComponent(cdbTarget)}&limit=100`, 1800).catch(() => null)
      ]);

      if (cdbUser && typeof cdbUser === 'object') {
        const resolved = resolveCanonicalAuthorDisplay(cdbUser.username || cdbTarget, cdbUser.display_name);
        displayName = resolved.displayName;
        canonicalSlug = resolved.canonicalSlug;
        sameAsSet.add(`https://content.luanti.org/users/${encodeURIComponent(cdbUser.username || cdbTarget)}/`);
        if (cdbUser.website_url && String(cdbUser.website_url).startsWith('http')) {
          sameAsSet.add(String(cdbUser.website_url));
        }
        if (cdbUser.donate_url && String(cdbUser.donate_url).startsWith('http')) {
          sameAsSet.add(String(cdbUser.donate_url));
        }
        if (cdbUser.connections?.github) {
          sameAsSet.add(`https://github.com/${cdbUser.connections.github}`);
        }
        if (cdbUser.profile_pic_url) {
          const rawPic = String(cdbUser.profile_pic_url);
          avatarUrl = rawPic.startsWith('http')
            ? rawPic
            : `https://content.luanti.org${rawPic.startsWith('/') ? '' : '/'}${rawPic}`;
        }
      }

      if (Array.isArray(cdbPackages)) {
        for (const p of cdbPackages) {
          if (!p?.name) continue;
          const key = String(p.name).toLowerCase();
          const existing = packagesMap.get(key);
          const tagsList = Array.isArray(p.tags)
            ? p.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title)).filter(Boolean)
            : existing?.tags;
          packagesMap.set(key, {
            author: String(p.author || canonicalSlug),
            name: String(p.name),
            title: String(p.title || existing?.title || p.name),
            short_desc: String(p.short_desc || p.short_description || existing?.short_desc || `Download ${p.title || p.name} by ${displayName} for Luanti.`),
            type: p.type === 'game' || p.type === 'txp' ? p.type : 'mod',
            license: String(p.license || existing?.license || 'Open Source'),
            downloads: Math.max(Number(p.downloads) || 0, existing?.downloads || 0),
            tags: tagsList
          });
        }
      }

      await writeEdgeCacheJson(
        ssrAuthorCacheKey,
        {
          displayName,
          canonicalSlug,
          bio,
          avatarUrl,
          sameAs: Array.from(sameAsSet),
          packages: Array.from(packagesMap.values())
        },
        1800
      );
    } catch {
      // Fall back to resolved defaults
    }
  };

  try {
    const [rawHtml] = await Promise.all([
      fetchSpaShellHtml(context.env?.ASSETS, origin),
      lookupAuthorData()
    ]);

    const canonicalUrl = `${canonicalOrigin}/author/${encodeURIComponent(canonicalSlug)}`;
    const packageList = Array.from(packagesMap.values());
    const topPkgTitles = packageList.slice(0, 6).map(p => p.title);
    const fullTitle = `${displayName} — Luanti Mods, Games & Texture Packs by ${displayName} | Luanti Hub`;
    const keywordsContent = [
      displayName,
      ...(initialIdentity.isSakel ? ['SaKeL', 'sakel-hub', 'SaKeL Luanti mods', 'SaKeL Minetest mods'] : []),
      `${displayName} luanti`,
      `${displayName} mods`,
      'luanti',
      'luanti hub',
      'luantihub',
      'minetest',
      ...topPkgTitles
    ].join(', ');

    const alternateNames = new Set<string>();
    if (decodedUsername.toLowerCase() !== displayName.toLowerCase()) {
      alternateNames.add(decodedUsername);
    }
    if (initialIdentity.isSakel) {
      alternateNames.add('sakel-hub');
      alternateNames.add('sakel');
    }

    const personEntity: Record<string, any> = {
      '@type': 'Person',
      '@id': `${canonicalUrl}#person`,
      name: displayName,
      ...(alternateNames.size > 0 ? { alternateName: Array.from(alternateNames) } : {}),
      description: bio,
      url: canonicalUrl,
      image: avatarUrl,
      ...(sameAsSet.size > 0 ? { sameAs: Array.from(sameAsSet) } : {})
    };

    const profilePageSchema: Record<string, any> = {
      '@type': 'ProfilePage',
      '@id': `${canonicalUrl}#profile`,
      name: `${displayName} Creator Profile — Luanti Hub`,
      description: bio,
      url: canonicalUrl,
      mainEntity: personEntity,
      isPartOf: {
        '@type': 'WebSite',
        '@id': 'https://luantihub.org/#website',
        name: 'Luanti Hub'
      }
    };

    const itemListSchema: Record<string, any> = {
      '@type': 'ItemList',
      '@id': `${canonicalUrl}#packages`,
      name: `Luanti Packages by ${displayName}`,
      numberOfItems: packageList.length,
      itemListElement: packageList.slice(0, 50).map((pkg, idx) => {
        const pkgUrl = `${canonicalOrigin}/package/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}`;
        const typeLabel = pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
        return {
          '@type': 'ListItem',
          position: idx + 1,
          item: {
            '@type': 'SoftwareApplication',
            '@id': `${pkgUrl}#software`,
            name: pkg.title,
            alternateName: `${pkg.name} (Luanti ${typeLabel} by ${displayName})`,
            applicationCategory: 'GameApplication',
            applicationSubCategory: `Luanti ${typeLabel}`,
            operatingSystem: 'Windows, macOS, Linux, Android, iOS',
            description: pkg.short_desc,
            url: pkgUrl,
            author: {
              '@type': 'Person',
              name: displayName,
              url: canonicalUrl
            },
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD'
            }
          }
        };
      })
    };

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
          name: `${displayName} Packages`,
          item: canonicalUrl
        }
      ]
    };

    const jsonLd = serializeInlineScriptJson({
      '@context': 'https://schema.org',
      '@graph': [profilePageSchema, itemListSchema, breadcrumbSchema]
    });

    const packagesListHtml = packageList
      .map(pkg => {
        const pkgUrl = `/package/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}`;
        const typeLabel = pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
        return `<li><a href="${escapeHtml(pkgUrl)}"><strong>${escapeHtml(pkg.title)}</strong> (${escapeHtml(pkg.name)})</a> — Luanti ${escapeHtml(typeLabel)} by ${escapeHtml(displayName)}: ${escapeHtml(pkg.short_desc)}</li>`;
      })
      .join('\n        ');

    const semanticBodyHtml = `
    <nav aria-label="Breadcrumb">
      <a href="/">Luanti Hub</a> &rsaquo;
      <span>${escapeHtml(displayName)}</span>
    </nav>
    <article>
      <h1>${escapeHtml(displayName)} — Luanti Mods, Games &amp; Texture Packs by ${escapeHtml(displayName)}</h1>
      <p><strong>${escapeHtml(bio)}</strong></p>
      <section>
        <h2>Open-Source Luanti Packages by ${escapeHtml(displayName)} (${packageList.length})</h2>
        <ul class="author-packages-seo-list">
        ${packagesListHtml}
        </ul>
      </section>
      <p>
        Browse and download all packages by <strong>${escapeHtml(displayName)}</strong> as ready-to-drop <code>.zip</code> archives or install directly in-game via <a href="/">Luanti Hub (LuantiHub)</a>.
      </p>
    </article>
  `;

    const transformedHtml = injectAuthorSeoIntoHtml(rawHtml, {
      fullTitle,
      description: bio,
      keywordsContent,
      canonicalUrl,
      avatarUrl,
      semanticBodyHtml,
      jsonLd
    });

    return new Response(transformedHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
      }
    });
  } catch (err: any) {
    console.error('[Author SSR Handler Error]', {
      username: decodedUsername,
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

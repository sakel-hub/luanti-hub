import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { LuantiPackage, PublicAuthorProfile } from '../models/package.model';

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  private readonly defaultTitle =
    'Luanti Hub (LuantiHub) — Mods, Games & Texture Packs for Luanti';
  private readonly defaultDesc =
    'Luanti Hub (LuantiHub) is the open package registry and content hub for Luanti (formerly Minetest). Discover and download thousands of games, mods, and texture packs via .zip, Git, or 1-click in-game setup.';
  private readonly baseUrl = 'https://luantihub.org';
  private readonly defaultBannerUrl = 'https://luantihub.org/screenshot-desktop.png';
  private readonly supportedHreflangLocales = ['en', 'sk', 'de', 'fr', 'es', 'ru'] as const;
  private readonly publicSectionPaths = new Set([
    '/',
    '/games',
    '/mods',
    '/texture-packs',
    '/git',
    '/blog',
    '/setup',
    '/submit',
    '/legal'
  ]);
  private cachedHomeFaqJsonLd: string | null = null;

  private resolveAuthorIdentity(rawAuthor: string, explicitDisplayName?: string | null): {
    displayName: string;
    canonicalSlug: string;
    isSakel: boolean;
  } {
    const trimmed = String(rawAuthor || '').trim();
    const base = trimmed.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
    if (base.toLowerCase() === 'sakel') {
      return {
        displayName: 'SaKeL',
        canonicalSlug: 'SaKeL',
        isSakel: true
      };
    }
    const cleanDisplay = String(explicitDisplayName || '').trim();
    const displayName = cleanDisplay || base || trimmed;
    const canonicalSlug = !/\s/.test(displayName) ? displayName : trimmed;
    return {
      displayName,
      canonicalSlug,
      isSakel: false
    };
  }

  updateForPackage(pkg: LuantiPackage): void {
    const typeLabel =
      pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
    const { displayName, canonicalSlug } = this.resolveAuthorIdentity(
      pkg.author,
      pkg.author_display_name
    );
    const pageTitle = `${pkg.title} by ${displayName} — Luanti ${typeLabel} | Luanti Hub`;
    const pageDesc =
      pkg.short_desc ||
      `Download ${pkg.title} by ${displayName} (${typeLabel}) for Luanti / Minetest on Luanti Hub.`;
    const canonicalUrl = `${this.baseUrl}/package/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}`;
    const imageUrl = this.toAbsoluteImageUrl(pkg.banner || pkg.thumbnail);
    const keywordTokens = Array.from(
      new Set([
        'luanti',
        `luanti ${pkg.type === 'txp' ? 'texture pack' : pkg.type}`,
        pkg.title,
        pkg.name,
        displayName,
        pkg.author,
        'luanti hub',
        'luantihub',
        'minetest',
        ...(Array.isArray(pkg.tags) ? pkg.tags.slice(0, 8) : [])
      ].filter(Boolean))
    );
    const keywords = keywordTokens.join(', ');

    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: pageDesc });
    this.meta.updateTag({ name: 'keywords', content: keywords });
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:description', content: pageDesc });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
    this.meta.updateTag({ property: 'og:image', content: imageUrl });
    this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    this.meta.updateTag({ name: 'twitter:description', content: pageDesc });
    this.meta.updateTag({ name: 'twitter:image', content: imageUrl });

    this.setCanonicalUrl(canonicalUrl);
    this.removeHreflangLinks();
    this.toggleHomeFaqJsonLd(false);
    this.setPackageJsonLd(pkg, canonicalUrl, imageUrl, pageDesc, displayName, canonicalSlug, keywords);
  }

  updateForAuthor(profile: PublicAuthorProfile, packages: LuantiPackage[] = []): void {
    const { displayName, canonicalSlug, isSakel } = this.resolveAuthorIdentity(
      profile.username,
      profile.display_name
    );
    const canonicalUrl = `${this.baseUrl}/author/${encodeURIComponent(canonicalSlug)}`;
    const pageTitle = `${displayName} — Luanti Mods, Games & Texture Packs by ${displayName} | Luanti Hub`;
    const pageDesc =
      profile.bio?.trim() ||
      (isSakel
        ? 'Creator of Everness, X Farming, X Bows, X Enchanting, X Mobs, Waysigns, and open-source Luanti (Minetest) mods, games, and texture packs on Luanti Hub.'
        : `Browse Luanti mods, games, and texture packs by ${displayName} on Luanti Hub.`);
    const imageUrl = this.toAbsoluteImageUrl(profile.avatar_url);
    const topPkgTitles = packages.slice(0, 6).map(p => p.title);
    const keywords = Array.from(
      new Set([
        displayName,
        profile.username,
        ...(isSakel ? ['SaKeL', 'sakel-hub', 'SaKeL Luanti mods'] : []),
        `${displayName} luanti`,
        'luanti',
        'luanti hub',
        'luantihub',
        'minetest',
        ...topPkgTitles
      ].filter(Boolean))
    ).join(', ');

    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: pageDesc });
    this.meta.updateTag({ name: 'keywords', content: keywords });
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:description', content: pageDesc });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
    this.meta.updateTag({ property: 'og:image', content: imageUrl });
    this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    this.meta.updateTag({ name: 'twitter:description', content: pageDesc });
    this.meta.updateTag({ name: 'twitter:image', content: imageUrl });

    this.setCanonicalUrl(canonicalUrl);
    this.removeHreflangLinks();
    this.toggleHomeFaqJsonLd(false);
    this.setAuthorJsonLd(profile, packages, displayName, canonicalUrl, imageUrl, pageDesc, isSakel);
  }

  updateStaticRoute(routeTitle: string, routeDesc: string, path = '/'): void {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fullTitle = `${routeTitle} | Luanti Hub`;
    const baseCanonicalUrl = `${this.baseUrl}${normalizedPath}`;
    const nonEnQueryLocale = this.getActiveNonEnQueryLocale();
    const canonicalUrl =
      nonEnQueryLocale && this.publicSectionPaths.has(normalizedPath)
        ? `${baseCanonicalUrl}?lang=${nonEnQueryLocale}`
        : baseCanonicalUrl;
    this.title.setTitle(fullTitle);
    this.meta.updateTag({ name: 'description', content: routeDesc });
    this.meta.updateTag({ property: 'og:title', content: fullTitle });
    this.meta.updateTag({ property: 'og:description', content: routeDesc });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
    this.meta.updateTag({ property: 'og:image', content: this.defaultBannerUrl });
    this.meta.updateTag({ name: 'twitter:title', content: fullTitle });
    this.meta.updateTag({ name: 'twitter:description', content: routeDesc });
    this.meta.updateTag({ name: 'twitter:image', content: this.defaultBannerUrl });
    this.setCanonicalUrl(canonicalUrl);
    if (this.publicSectionPaths.has(normalizedPath)) {
      this.setHreflangLinks(baseCanonicalUrl);
    } else {
      this.removeHreflangLinks();
    }
    if (normalizedPath !== '/') {
      this.toggleHomeFaqJsonLd(false);
      this.setBreadcrumbJsonLd(routeTitle, routeDesc, canonicalUrl);
    } else {
      this.toggleHomeFaqJsonLd(true);
      this.removePackageJsonLd();
    }
  }

  resetToHome(): void {
    const baseHomeUrl = `${this.baseUrl}/`;
    const nonEnQueryLocale = this.getActiveNonEnQueryLocale();
    const canonicalUrl = nonEnQueryLocale ? `${baseHomeUrl}?lang=${nonEnQueryLocale}` : baseHomeUrl;
    this.title.setTitle(this.defaultTitle);
    this.meta.updateTag({ name: 'description', content: this.defaultDesc });
    this.meta.updateTag({ property: 'og:title', content: this.defaultTitle });
    this.meta.updateTag({ property: 'og:description', content: this.defaultDesc });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
    this.meta.updateTag({
      property: 'og:image',
      content: this.defaultBannerUrl
    });
    this.meta.updateTag({ name: 'twitter:title', content: this.defaultTitle });
    this.meta.updateTag({ name: 'twitter:description', content: this.defaultDesc });
    this.meta.updateTag({
      name: 'twitter:image',
      content: this.defaultBannerUrl
    });
    this.setCanonicalUrl(canonicalUrl);
    this.setHreflangLinks(baseHomeUrl);
    this.toggleHomeFaqJsonLd(true);
    this.removePackageJsonLd();
  }

  private toAbsoluteImageUrl(rawUrl?: string | null): string {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed || trimmed === 'logo.svg' || trimmed === '/logo.svg') {
      return `${this.baseUrl}/icons/icon-512x512.png`;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `${this.baseUrl}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
  }

  private setCanonicalUrl(url: string): void {
    if (!this.doc?.head) return;
    let link = this.doc.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private setPackageJsonLd(
    pkg: LuantiPackage,
    canonicalUrl: string,
    imageUrl: string,
    description: string,
    displayName: string,
    canonicalAuthorSlug: string,
    keywords: string
  ): void {
    if (!this.doc?.head) return;
    let scriptEl = this.doc.getElementById('luanti-pkg-jsonld') as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = this.doc.createElement('script');
      scriptEl.id = 'luanti-pkg-jsonld';
      scriptEl.type = 'application/ld+json';
      this.doc.head.appendChild(scriptEl);
    }

    const typeLabel =
      pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
    const sectionPath =
      pkg.type === 'game' ? '/games' : pkg.type === 'txp' ? '/texture-packs' : '/mods';
    const sectionLabel =
      pkg.type === 'game' ? 'Luanti Games' : pkg.type === 'txp' ? 'Luanti Texture Packs' : 'Luanti Mods';
    const authorProfileUrl = `${this.baseUrl}/author/${encodeURIComponent(canonicalAuthorSlug)}`;

    const softwareAppSchema: Record<string, any> = {
      '@type': 'SoftwareApplication',
      '@id': `${canonicalUrl}#software`,
      name: pkg.title,
      alternateName: `${pkg.name} (Luanti ${typeLabel})`,
      applicationCategory: 'GameApplication',
      applicationSubCategory: `Luanti ${typeLabel}`,
      operatingSystem: 'Windows, macOS, Linux, Android, iOS',
      description,
      url: canonicalUrl,
      downloadUrl: `${canonicalUrl}/download`,
      image: imageUrl,
      license: pkg.license,
      keywords,
      isPartOf: {
        '@type': 'WebSite',
        '@id': `${this.baseUrl}/#website`,
        name: 'Luanti Hub'
      },
      author: {
        '@type': 'Person',
        name: displayName,
        ...(displayName.toLowerCase() !== pkg.author.toLowerCase() ? { alternateName: pkg.author } : {}),
        url: authorProfileUrl
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      }
    };

    if (pkg.score > 0) {
      const threadCounts = pkg.review_thread_counts;
      const realReviewCount = threadCounts
        ? (threadCounts.positive || 0) + (threadCounts.neutral || 0) + (threadCounts.negative || 0)
        : 0;
      if (realReviewCount > 0) {
        softwareAppSchema['aggregateRating'] = {
          '@type': 'AggregateRating',
          ratingValue: String(pkg.score),
          bestRating: '5',
          worstRating: '1',
          ratingCount: String(realReviewCount)
        };
      }
    }

    const breadcrumbSchema = {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Luanti Hub',
          item: `${this.baseUrl}/`
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: sectionLabel,
          item: `${this.baseUrl}${sectionPath}`
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: pkg.title,
          item: canonicalUrl
        }
      ]
    };

    scriptEl.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [softwareAppSchema, breadcrumbSchema]
    });
  }

  private setAuthorJsonLd(
    profile: PublicAuthorProfile,
    packages: LuantiPackage[],
    displayName: string,
    canonicalUrl: string,
    imageUrl: string,
    description: string,
    isSakel: boolean
  ): void {
    if (!this.doc?.head) return;
    let scriptEl = this.doc.getElementById('luanti-pkg-jsonld') as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = this.doc.createElement('script');
      scriptEl.id = 'luanti-pkg-jsonld';
      scriptEl.type = 'application/ld+json';
      this.doc.head.appendChild(scriptEl);
    }

    const sameAs = new Set<string>();
    if (profile.contentdb_url) sameAs.add(profile.contentdb_url);
    if (profile.website_url) sameAs.add(profile.website_url);
    if (profile.donate_url) sameAs.add(profile.donate_url);
    for (const id of profile.identities || []) {
      if (id.profile_url) sameAs.add(id.profile_url);
    }
    if (isSakel) {
      sameAs.add('https://content.luanti.org/users/SaKeL/');
      sameAs.add('https://codeberg.org/SaKeL');
      sameAs.add('https://github.com/sakel-hub');
      sameAs.add('https://ko-fi.com/sakel');
    }

    const profilePageSchema: Record<string, any> = {
      '@type': 'ProfilePage',
      '@id': `${canonicalUrl}#profile`,
      name: `${displayName} Creator Profile — Luanti Hub`,
      description,
      url: canonicalUrl,
      mainEntity: {
        '@type': 'Person',
        '@id': `${canonicalUrl}#person`,
        name: displayName,
        ...(isSakel ? { alternateName: ['sakel-hub', 'sakel'] } : {}),
        description,
        url: canonicalUrl,
        image: imageUrl,
        ...(sameAs.size > 0 ? { sameAs: Array.from(sameAs) } : {})
      },
      isPartOf: {
        '@type': 'WebSite',
        '@id': `${this.baseUrl}/#website`,
        name: 'Luanti Hub'
      }
    };

    const effectivePackages: Array<Pick<LuantiPackage, 'author' | 'name' | 'title' | 'type' | 'short_desc'>> =
      packages.length > 0
        ? packages
        : isSakel
          ? [
              { author: 'SaKeL', name: 'everness', title: 'Everness', type: 'mod', short_desc: 'Custom biomes, structures, dungeons, and dimensions in Luanti.' },
              { author: 'SaKeL', name: 'x_farming', title: 'X Farming', type: 'mod', short_desc: 'Crops, trees, farming, bees, and food recipes for Luanti.' },
              { author: 'SaKeL', name: 'x_bows', title: 'X Bows', type: 'mod', short_desc: 'Bows, quivers, and custom arrows for Luanti.' },
              { author: 'SaKeL', name: 'x_enchanting', title: 'X Enchanting', type: 'mod', short_desc: 'Enchanting table and custom enchantments for Luanti.' },
              { author: 'sakel-hub', name: 'x_mobs', title: 'X Mobs', type: 'mod', short_desc: 'Community Git mob collection for Luanti.' },
              { author: 'sakel-hub', name: 'waysigns', title: 'Waysigns', type: 'mod', short_desc: 'Directional signposts and wayfinding markers for Luanti.' }
            ]
          : [];

    const itemListSchema: Record<string, any> = {
      '@type': 'ItemList',
      '@id': `${canonicalUrl}#packages`,
      name: `Luanti Packages by ${displayName}`,
      numberOfItems: effectivePackages.length,
      itemListElement: effectivePackages.slice(0, 30).map((pkg, idx) => {
        const pkgUrl = `${this.baseUrl}/package/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}`;
        const typeLabel = pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
        return {
          '@type': 'ListItem',
          position: idx + 1,
          item: {
            '@type': 'SoftwareApplication',
            '@id': `${pkgUrl}#software`,
            name: pkg.title,
            applicationCategory: 'GameApplication',
            applicationSubCategory: `Luanti ${typeLabel}`,
            url: pkgUrl,
            description: pkg.short_desc
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
          item: `${this.baseUrl}/`
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: `${displayName} Packages`,
          item: canonicalUrl
        }
      ]
    };

    scriptEl.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [profilePageSchema, itemListSchema, breadcrumbSchema]
    });
  }

  private setBreadcrumbJsonLd(routeTitle: string, routeDesc: string, canonicalUrl: string): void {
    if (!this.doc?.head) return;
    let scriptEl = this.doc.getElementById('luanti-pkg-jsonld') as HTMLScriptElement | null;
    if (!scriptEl) {
      scriptEl = this.doc.createElement('script');
      scriptEl.id = 'luanti-pkg-jsonld';
      scriptEl.type = 'application/ld+json';
      this.doc.head.appendChild(scriptEl);
    }
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: routeTitle,
      description: routeDesc,
      url: canonicalUrl,
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Luanti Hub',
            item: `${this.baseUrl}/`
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: routeTitle,
            item: canonicalUrl
          }
        ]
      }
    };
    scriptEl.textContent = JSON.stringify(schema);
  }

  private getActiveNonEnQueryLocale(): string | null {
    try {
      const search = this.doc?.defaultView?.location?.search || '';
      if (!search) return null;
      const raw = (new URLSearchParams(search).get('lang') || '').trim().toLowerCase();
      return ['sk', 'de', 'fr', 'es', 'ru'].includes(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  private setHreflangLinks(baseCanonicalUrl: string): void {
    if (!this.doc?.head) return;
    this.removeHreflangLinks();
    const entries: Array<{ hreflang: string; href: string }> = [
      { hreflang: 'x-default', href: baseCanonicalUrl },
      ...this.supportedHreflangLocales.map(loc => ({
        hreflang: loc,
        href: loc === 'en' ? baseCanonicalUrl : `${baseCanonicalUrl}?lang=${loc}`
      }))
    ];
    for (const entry of entries) {
      const link = this.doc.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', entry.hreflang);
      link.setAttribute('href', entry.href);
      this.doc.head.appendChild(link);
    }
  }

  private removeHreflangLinks(): void {
    if (!this.doc?.head) return;
    const links = this.doc.head.querySelectorAll('link[rel="alternate"][hreflang]');
    links.forEach(el => el.remove());
  }

  private toggleHomeFaqJsonLd(enabled: boolean): void {
    if (!this.doc?.head) return;
    const existing = this.doc.getElementById('home-faq-jsonld') as HTMLScriptElement | null;
    if (!enabled) {
      if (existing) {
        this.cachedHomeFaqJsonLd = existing.textContent;
        existing.remove();
      }
      return;
    }
    if (!existing && this.cachedHomeFaqJsonLd) {
      const scriptEl = this.doc.createElement('script');
      scriptEl.id = 'home-faq-jsonld';
      scriptEl.type = 'application/ld+json';
      scriptEl.textContent = this.cachedHomeFaqJsonLd;
      this.doc.head.appendChild(scriptEl);
    }
  }

  private removePackageJsonLd(): void {
    if (!this.doc) return;
    const scriptEl = this.doc.getElementById('luanti-pkg-jsonld');
    if (scriptEl) {
      scriptEl.remove();
    }
  }
}

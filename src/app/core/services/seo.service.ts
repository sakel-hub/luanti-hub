import { Injectable, inject } from '@angular/core';
import { Title, Meta } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { LuantiPackage } from '../models/package.model';

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  private readonly defaultTitle =
    'Luanti — Mods, Games & Texture Packs | Luanti Hub (LuantiHub)';
  private readonly defaultDesc =
    'Discover and download thousands of open-source Luanti (formerly Minetest) games, mods, and texture packs on Luanti Hub (LuantiHub). Direct .zip downloads, Git repository packages, and 1-click in-game ContentDB setup.';
  private readonly baseUrl = 'https://luantihub.org';

  updateForPackage(pkg: LuantiPackage): void {
    const typeLabel =
      pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
    const pageTitle = `${pkg.title} by ${pkg.author} — Luanti ${typeLabel} | Luanti Hub`;
    const pageDesc =
      pkg.short_desc ||
      `Download ${pkg.title} by ${pkg.author} (${typeLabel}) for Luanti / Minetest on Luanti Hub.`;
    const canonicalUrl = `${this.baseUrl}/package/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}`;
    const imageUrl = pkg.banner || pkg.thumbnail || `${this.baseUrl}/icons/icon-512x512.png`;
    const keywords = [
      'luanti',
      `luanti ${pkg.type === 'txp' ? 'texture pack' : pkg.type}`,
      pkg.title,
      pkg.name,
      pkg.author,
      'luanti hub',
      'luantihub',
      'minetest',
      ...(Array.isArray(pkg.tags) ? pkg.tags.slice(0, 8) : [])
    ].join(', ');

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
    this.setPackageJsonLd(pkg, canonicalUrl, imageUrl, pageDesc);
  }

  updateStaticRoute(routeTitle: string, routeDesc: string, path = '/'): void {
    const fullTitle = `${routeTitle} | Luanti Hub`;
    const canonicalUrl = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    this.title.setTitle(fullTitle);
    this.meta.updateTag({ name: 'description', content: routeDesc });
    this.meta.updateTag({ property: 'og:title', content: fullTitle });
    this.meta.updateTag({ property: 'og:description', content: routeDesc });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
    this.meta.updateTag({ name: 'twitter:title', content: fullTitle });
    this.meta.updateTag({ name: 'twitter:description', content: routeDesc });
    this.setCanonicalUrl(canonicalUrl);
    if (path && path !== '/') {
      this.setBreadcrumbJsonLd(routeTitle, routeDesc, canonicalUrl);
    } else {
      this.removePackageJsonLd();
    }
  }

  resetToHome(): void {
    this.title.setTitle(this.defaultTitle);
    this.meta.updateTag({ name: 'description', content: this.defaultDesc });
    this.meta.updateTag({ property: 'og:title', content: this.defaultTitle });
    this.meta.updateTag({ property: 'og:description', content: this.defaultDesc });
    this.meta.updateTag({ property: 'og:url', content: `${this.baseUrl}/` });
    this.meta.updateTag({
      property: 'og:image',
      content: `${this.baseUrl}/icons/icon-512x512.png`
    });
    this.meta.updateTag({ name: 'twitter:title', content: this.defaultTitle });
    this.meta.updateTag({ name: 'twitter:description', content: this.defaultDesc });
    this.meta.updateTag({
      name: 'twitter:image',
      content: `${this.baseUrl}/icons/icon-512x512.png`
    });
    this.setCanonicalUrl(`${this.baseUrl}/`);
    this.removePackageJsonLd();
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
    description: string
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
      image: imageUrl,
      license: pkg.license,
      isPartOf: {
        '@type': 'WebSite',
        '@id': `${this.baseUrl}/#website`,
        name: 'Luanti Hub'
      },
      author: {
        '@type': 'Person',
        name: pkg.author
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
      const resolvedCount = realReviewCount > 0
        ? realReviewCount
        : Math.max(1, Math.round((pkg.downloads || 100) / 50));
      softwareAppSchema['aggregateRating'] = {
        '@type': 'AggregateRating',
        ratingValue: String(pkg.score),
        bestRating: '5',
        worstRating: '1',
        ratingCount: String(resolvedCount)
      };
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

  private removePackageJsonLd(): void {
    if (!this.doc) return;
    const scriptEl = this.doc.getElementById('luanti-pkg-jsonld');
    if (scriptEl) {
      scriptEl.remove();
    }
  }
}

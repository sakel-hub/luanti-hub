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
    'Luanti Hub (LuantiHub) – Mods & Packages for Luanti (Minetest)';
  private readonly defaultDesc =
    'Luanti Hub (LuantiHub) is the open package registry and mod repository for Luanti (Minetest). Discover, search, and download mods, games, and texture packs directly from Git repositories and ContentDB with instant failover.';
  private readonly baseUrl = 'https://luanti-hub.pages.dev';

  updateForPackage(pkg: LuantiPackage): void {
    const typeLabel =
      pkg.type === 'game' ? 'Game' : pkg.type === 'txp' ? 'Texture Pack' : 'Mod';
    const pageTitle = `${pkg.title} by ${pkg.author} — Luanti ${typeLabel} | Luanti Hub`;
    const pageDesc =
      pkg.short_desc ||
      `Download ${pkg.title} by ${pkg.author} (${typeLabel}) for Luanti / Minetest on Luanti Hub.`;
    const canonicalUrl = `${this.baseUrl}/package/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}`;
    const imageUrl = pkg.banner || pkg.thumbnail || `${this.baseUrl}/icons/icon-512x512.png`;

    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: pageDesc });
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
    this.setCanonicalUrl(canonicalUrl);
    this.removePackageJsonLd();
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

    const schema: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: pkg.title,
      applicationCategory: 'GameApplication',
      operatingSystem: 'Windows, macOS, Linux, Android',
      description,
      url: canonicalUrl,
      image: imageUrl,
      license: pkg.license,
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
      schema['aggregateRating'] = {
        '@type': 'AggregateRating',
        ratingValue: String(pkg.score),
        bestRating: '5',
        worstRating: '1',
        ratingCount: String(resolvedCount)
      };
    }

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

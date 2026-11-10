import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  AfterViewInit,
  OnDestroy,
  NgZone,
  ViewChild,
  ViewChildren,
  ElementRef,
  QueryList
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PackageService } from '../../core/services/package.service';
import { LuantiPackage } from '../../core/models/package.model';
import { selectSharpPackageBanner } from '../../core/config/git-providers.config';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { PackageBadgesComponent } from '../../shared/components/package-badges.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideInfo,
  LucideStar,
  LucideGitBranch,
  LucideDownload,
  LucideExternalLink
} from '@lucide/angular';

@Component({
  selector: 'app-hero-billboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    CompactNumberPipe,
    PackageBadgesComponent,
    TranslatePipe,
    LucideChevronLeft,
    LucideChevronRight,
    LucideInfo,
    LucideStar,
    LucideGitBranch,
    LucideDownload,
    LucideExternalLink
  ],
  template: `
    <div class="relative w-full max-w-[1760px] mx-auto px-2 sm:px-8 lg:px-12 xl:px-14 mt-2 sm:mt-4">
      <div class="relative w-full">
        <!-- Rectangular Ambient Backlight Glow Derived from Active Hero Artwork (LCP-Safe 32x18 Dual-Canvas Crossfade — All Viewports, Zero Extra Network Requests & Never Flagged as LCP) -->
        <div
          aria-hidden="true"
          data-testid="hero-ambient-glow"
          style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.20) 0%, rgba(99, 102, 241, 0.14) 50%, rgba(14, 165, 233, 0.18) 100%);"
          class="block pointer-events-none select-none absolute inset-0 sm:-inset-1.5 lg:-inset-3 z-0 rounded-2xl sm:rounded-3xl overflow-visible blur-[22px] sm:blur-[36px] lg:blur-[48px] xl:blur-[60px] saturate-[1.85]">
          <canvas
            #glowCanvasA
            width="32"
            height="18"
            [class]="activeGlowBuffer() === 0 ? 'opacity-60' : 'opacity-0'"
            class="absolute inset-0 w-full h-full rounded-2xl sm:rounded-3xl transform-gpu will-change-[opacity] transition-opacity duration-700 ease-out"
          ></canvas>
          <canvas
            #glowCanvasB
            width="32"
            height="18"
            [class]="activeGlowBuffer() === 1 ? 'opacity-60' : 'opacity-0'"
            class="absolute inset-0 w-full h-full rounded-2xl sm:rounded-3xl transform-gpu will-change-[opacity] transition-opacity duration-700 ease-out"
          ></canvas>
        </div>

        <div
          (mouseenter)="onMouseEnter()"
        (mouseleave)="onMouseLeave()"
        (touchstart)="onTouchStart($event)"
        (touchend)="onTouchEnd($event)"
        (keydown.arrowleft)="prev()"
        (keydown.arrowright)="next()"
        tabindex="0"
        role="region"
        aria-roledescription="carousel"
        [attr.aria-label]="currentPkg()?.title || 'Featured showcase'"
        class="relative z-10 w-full aspect-video min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] max-h-[820px] xl:max-h-[860px] rounded-2xl sm:rounded-3xl overflow-hidden select-none bg-slate-950 shadow-[0_28px_80px_-15px_rgba(0,0,0,0.85)] border border-white/15 focus:outline-none focus:ring-2 focus:ring-sky-500/50">

        @if (showcase().length > 0 && currentPkg(); as pkg) {
          <!-- Hardware-Accelerated Horizontal Slide Track (Smooth Slide-In/Out without Image Flash) -->
          <div
            class="relative z-10 flex w-full h-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
            [style.transform]="'translate3d(-' + (currentIndex() * 100) + '%, 0, 0)'">
            @for (slidePkg of showcase(); track slidePkg.id; let idx = $index) {
              <div
                class="w-full h-full flex-shrink-0 relative overflow-hidden bg-slate-950"
                [attr.aria-hidden]="idx !== currentIndex()"
                [attr.inert]="idx !== currentIndex() ? '' : null">

                <!-- Slide Background Image with Subtle Ken-Burns Scale Transition -->
                <div class="absolute inset-0 bg-slate-950">
                  <img
                    #slideImg
                    [src]="getSlideBanner(slidePkg)"
                    [fallbackThumbnail]="slidePkg.thumbnail"
                    appImgFallback
                    [alt]="slidePkg.title"
                    [attr.fetchpriority]="idx === 0 ? 'high' : 'low'"
                    loading="eager"
                    [attr.decoding]="idx === 0 ? 'sync' : 'async'"
                    (load)="onSlideImageLoad($event, idx)"
                    [class]="idx === currentIndex() ? 'w-full h-full object-cover object-center scale-100 transition-transform duration-1000 ease-out' : 'w-full h-full object-cover object-center scale-105 transition-transform duration-1000 ease-out'"
                  />
                  <div class="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/40 to-transparent w-full md:w-3/5"></div>
                  <div class="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/25 to-transparent"></div>
                </div>

                <!-- Slide Foreground Content with Staggered Fade + Slide-Up Reveal -->
                <div class="relative w-full px-6 sm:px-10 lg:px-14 h-full flex flex-col justify-end pb-16 sm:pb-20 lg:pb-24 z-10 pointer-events-none">
                  <div
                    [class]="idx === currentIndex() ? 'max-w-2xl lg:max-w-3xl space-y-4 pointer-events-auto opacity-100 translate-y-0 transition-all duration-700 delay-100 ease-out' : 'max-w-2xl lg:max-w-3xl space-y-4 pointer-events-none opacity-0 translate-y-4 transition-all duration-500 ease-out'">

                    <!-- Category & Source Badges (or Promotional / Luanti Blog Badge Pill) -->
                    @if (slidePkg._promo; as promo) {
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          [class]="promo.id.startsWith('blog:')
                            ? 'px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider glass-badge-sky shadow-[0_0_16px_rgba(56,189,248,0.25)]'
                            : 'px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider glass-badge-amber shadow-[0_0_16px_rgba(245,158,11,0.25)]'">
                          {{ promo.badge_text || ('hero.promoted' | translate) }}
                        </span>
                      </div>
                    } @else {
                      <app-package-badges [package]="slidePkg">
                        <button
                          type="button"
                          (click)="$event.stopPropagation()"
                          [attr.tabindex]="idx === currentIndex() ? null : -1"
                          [appTooltip]="'carousel.infoHero' | translate"
                          [appTooltipMultiline]="true"
                          appTooltipPlacement="right"
                          aria-label="How this showcase is curated"
                          class="w-6 h-6 rounded-full glass-pill text-slate-300 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                          <svg lucideInfo class="w-3.5 h-3.5"></svg>
                        </button>
                      </app-package-badges>
                    }

                    <!-- Title -->
                    <h2 class="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white drop-shadow-md">
                      @if (!slidePkg._promo) {
                        <a
                          [href]="getPackageUrl(slidePkg)"
                          (click)="onSlideTitleClick($event, slidePkg)"
                          [attr.tabindex]="idx === currentIndex() ? null : -1"
                          class="text-inherit hover:text-sky-300 transition-colors no-underline focus:outline-none">
                          {{ slidePkg.title }}
                        </a>
                      } @else {
                        {{ slidePkg.title }}
                      }
                    </h2>

                    <!-- Description -->
                    <p class="text-sm sm:text-base lg:text-lg text-slate-200 line-clamp-3 leading-relaxed drop-shadow max-w-2xl">
                      {{ slidePkg.short_desc }}
                    </p>

                    <!-- Stats & Meta (Organic Packages Only) -->
                    @if (!slidePkg._promo) {
                      <div class="flex items-center gap-3 sm:gap-4 text-xs text-slate-300 flex-wrap">
                        @if (slidePkg.score > 0) {
                          <div class="flex items-center gap-1 text-amber-400 font-bold">
                            <svg lucideStar class="w-4 h-4 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
                            <span>{{ slidePkg.score }}</span>
                          </div>
                          <span>•</span>
                        }
                        <span>{{ slidePkg.downloads | compactNumber }} {{ 'hero.downloads' | translate | lowercase }}</span>
                        @if (slidePkg.license || slidePkg.media_license) {
                          <span>•</span>
                          <span class="text-slate-400 font-mono">License: {{ slidePkg.license || slidePkg.media_license }}</span>
                        }
                      </div>
                    }

                    <!-- Frosted Glass & High-Contrast CTA Buttons -->
                    @if (slidePkg._promo; as promo) {
                      <div class="flex items-center gap-3 pt-2 flex-wrap">
                        @if (promo.id.startsWith('blog:') || isInternalPromoUrl(promo.cta_url)) {
                          <button
                            type="button"
                            (click)="onPromoCtaClick(promo.cta_url, $event)"
                            [attr.tabindex]="idx === currentIndex() ? null : -1"
                            class="h-11 px-6 sm:px-7 rounded-xl glass-btn-primary text-white font-black text-xs sm:text-sm flex items-center gap-2.5 hover:scale-[1.03] transition-all whitespace-nowrap cursor-pointer">
                            <span>{{ promo.cta_label || ('hero.learnMore' | translate) }}</span>
                            <svg lucideChevronRight class="w-4 h-4 text-sky-300 flex-shrink-0"></svg>
                          </button>
                        } @else {
                          <a
                            [href]="promo.cta_url"
                            target="_blank"
                            rel="noopener noreferrer"
                            [attr.tabindex]="idx === currentIndex() ? null : -1"
                            class="h-11 px-6 sm:px-7 rounded-xl glass-btn-primary text-white font-black text-xs sm:text-sm flex items-center gap-2.5 hover:scale-[1.03] transition-all whitespace-nowrap cursor-pointer">
                            <span>{{ promo.cta_label || ('hero.learnMore' | translate) }}</span>
                            <svg lucideExternalLink class="w-4 h-4 text-sky-300 flex-shrink-0"></svg>
                          </a>
                        }

                        @if (promo.secondary_cta_label && promo.secondary_cta_url) {
                          @if (isInternalPromoUrl(promo.secondary_cta_url)) {
                            <button
                              type="button"
                              (click)="onPromoCtaClick(promo.secondary_cta_url, $event)"
                              [attr.tabindex]="idx === currentIndex() ? null : -1"
                              class="h-11 px-5 sm:px-6 rounded-xl glass-btn text-white font-bold text-xs sm:text-sm flex items-center gap-2.5 transition whitespace-nowrap cursor-pointer">
                              <span>{{ promo.secondary_cta_label }}</span>
                            </button>
                          } @else {
                            <a
                              [href]="promo.secondary_cta_url"
                              target="_blank"
                              rel="noopener noreferrer"
                              [attr.tabindex]="idx === currentIndex() ? null : -1"
                              class="h-11 px-5 sm:px-6 rounded-xl glass-btn text-white font-bold text-xs sm:text-sm flex items-center gap-2.5 transition whitespace-nowrap cursor-pointer">
                              <span>{{ promo.secondary_cta_label }}</span>
                              <svg lucideExternalLink class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                            </a>
                          }
                        }
                      </div>
                    } @else {
                      <div class="flex items-center gap-3 pt-2 flex-wrap">
                        <!-- Primary Direct .zip Download Button with File Size -->
                        <button
                          type="button"
                          (click)="onDownload(slidePkg)"
                          [attr.tabindex]="idx === currentIndex() ? null : -1"
                          [appTooltip]="('card.quickInstall' | translate) + (slidePkg.file_size ? ' (' + slidePkg.file_size + ')' : '')"
                          class="h-11 px-6 sm:px-7 rounded-xl glass-btn-primary text-white font-black text-xs sm:text-sm flex items-center gap-2.5 hover:scale-[1.03] transition-all whitespace-nowrap cursor-pointer">
                          <svg lucideDownload class="w-5 h-5 text-sky-300 flex-shrink-0"></svg>
                          <span>{{ 'hero.downloadZip' | translate }}</span>
                          @if (slidePkg.file_size) {
                            <span class="text-slate-200 font-bold text-xs">({{ slidePkg.file_size }})</span>
                          }
                        </button>

                        <!-- Secondary Frosted Glass More Info Button -->
                        <button
                          type="button"
                          (click)="packageService.openPackageModal(slidePkg)"
                          [attr.tabindex]="idx === currentIndex() ? null : -1"
                          [appTooltip]="'hero.viewDetails' | translate"
                          class="h-11 px-5 sm:px-6 rounded-xl glass-btn text-white font-bold text-xs sm:text-sm flex items-center gap-2.5 transition whitespace-nowrap cursor-pointer">
                          <svg lucideInfo class="w-5 h-5 text-sky-400 flex-shrink-0"></svg>
                          <span>{{ 'hero.viewDetails' | translate }}</span>
                        </button>

                        <a
                          [href]="getSlideGitUrl(slidePkg)"
                          target="_blank"
                          rel="noopener noreferrer"
                          [attr.tabindex]="idx === currentIndex() ? null : -1"
                          [appTooltip]="'hero.viewGit' | translate"
                          class="h-11 w-11 rounded-xl glass-btn text-amber-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                          [attr.aria-label]="'hero.viewGit' | translate">
                          <svg lucideGitBranch class="w-5 h-5"></svg>
                        </a>
                      </div>
                    }

                  </div>
                </div>

              </div>
            }
          </div>

          <!-- Carousel Navigation Controls -->
          <div class="absolute bottom-5 right-6 sm:right-8 z-40 pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              (click)="prev($event)"
              [appTooltip]="'hero.prevSlide' | translate"
              aria-label="Previous slide"
              class="p-2.5 rounded-xl glass-btn text-slate-200 hover:text-white transition hover:scale-105 active:scale-95 cursor-pointer">
              <svg lucideChevronLeft class="w-4 h-4"></svg>
            </button>

            <button
              type="button"
              (click)="next($event)"
              [appTooltip]="'hero.nextSlide' | translate"
              aria-label="Next slide"
              class="p-2.5 rounded-xl glass-btn text-slate-200 hover:text-white transition hover:scale-105 active:scale-95 cursor-pointer">
              <svg lucideChevronRight class="w-4 h-4"></svg>
            </button>
          </div>

          <!-- Slide Indicators / Frosted Pill Dock (WCAG 2.2 AA 24x24px Hit Targets) -->
          <div class="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto hidden md:flex items-center gap-1 px-2.5 py-0.5 rounded-full glass-pill">
            @for (item of showcase(); track item.id; let idx = $index) {
              <button
                type="button"
                (click)="goTo(idx, $event)"
                [appTooltip]="item.title"
                [attr.aria-label]="'Go to slide ' + (idx + 1) + ': ' + item.title"
                class="min-w-6 min-h-6 flex items-center justify-center cursor-pointer group focus:outline-none">
                <span
                  class="h-2 rounded-full transition-all duration-500 ease-out overflow-hidden block"
                  [class.w-8]="idx === currentIndex()"
                  [class.bg-sky-400]="idx === currentIndex()"
                  [class.shadow-\[0_0_8px_rgba\(56\,189\,248\,0\.6\)\]]="idx === currentIndex()"
                  [class.w-2.5]="idx !== currentIndex()"
                  [class.bg-white/35]="idx !== currentIndex()"
                  [class.group-hover:bg-white/60]="idx !== currentIndex()">
                </span>
              </button>
            }
          </div>

        } @else {
          <!-- Professional 16:9 Hero Billboard Skeleton Preloader Overlay -->
          <div class="relative z-10 w-full h-full" aria-busy="true">
            <div class="absolute inset-0 skeleton-shimmer opacity-30"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent"></div>

            <div class="relative w-full px-6 sm:px-10 lg:px-14 h-full flex flex-col justify-end pb-16 sm:pb-20 lg:pb-24 z-10">
              <div class="max-w-2xl space-y-4">
                <div class="flex items-center gap-2">
                  <div class="h-5 w-14 rounded-md skeleton-shimmer"></div>
                  <div class="h-5 w-24 rounded-md skeleton-shimmer"></div>
                </div>
                <div class="h-10 sm:h-14 w-3/4 sm:w-2/3 rounded-2xl skeleton-shimmer"></div>
                <div class="space-y-2">
                  <div class="h-4 w-full rounded-lg skeleton-shimmer"></div>
                  <div class="h-4 w-5/6 rounded-lg skeleton-shimmer"></div>
                </div>
                <div class="flex items-center gap-3 pt-1">
                  <div class="h-4 w-16 rounded-md skeleton-shimmer"></div>
                  <div class="h-4 w-28 rounded-md skeleton-shimmer"></div>
                </div>
                <div class="flex items-center gap-3 pt-2">
                  <div class="h-11 w-44 rounded-xl skeleton-shimmer border border-white/15"></div>
                  <div class="h-11 w-36 rounded-xl skeleton-shimmer border border-white/10"></div>
                  <div class="h-11 w-11 rounded-xl skeleton-shimmer border border-white/10"></div>
                </div>
              </div>
            </div>
          </div>
        }
        </div>
      </div>
    </div>
  `
})
export class HeroBillboardComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly packageService = inject(PackageService);
  private readonly router = inject(Router, { optional: true });
  private readonly ngZone = inject(NgZone);

  @ViewChild('glowCanvasA') glowCanvasARef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('glowCanvasB') glowCanvasBRef?: ElementRef<HTMLCanvasElement>;
  @ViewChildren('slideImg') slideImgRefs?: QueryList<ElementRef<HTMLImageElement>>;

  readonly showcase = this.packageService.heroShowcasePackages;
  readonly currentIndex = signal<number>(0);
  readonly isPaused = signal<boolean>(false);
  readonly activeGlowBuffer = signal<0 | 1>(0);

  readonly currentPkg = computed<LuantiPackage | null>(() => {
    const list = this.showcase();
    if (list.length === 0) return null;
    const idx = this.currentIndex() % list.length;
    return list[idx];
  });

  private activeSlidePkgId: string | null = null;
  private seenPromoIds = new Set<string>();
  private intervalTimer: any = null;
  private touchStartX = 0;
  private lastTouchTime = 0;
  private lastGlowSrc = '';

  constructor() {
    effect(() => {
      const list = this.showcase();
      if (list.length === 0) {
        this.activeSlidePkgId = null;
        return;
      }
      const firstSlide = list[0];
      if (firstSlide?._promo && !this.seenPromoIds.has(firstSlide.id)) {
        for (const item of list) {
          if (item._promo) this.seenPromoIds.add(item.id);
        }
        this.activeSlidePkgId = firstSlide.id;
        if (this.currentIndex() !== 0) {
          this.currentIndex.set(0);
        }
        return;
      }
      for (const item of list) {
        if (item._promo) this.seenPromoIds.add(item.id);
      }
      if (this.activeSlidePkgId) {
        const foundIdx = list.findIndex(p => p.id.toLowerCase() === this.activeSlidePkgId!.toLowerCase());
        if (foundIdx >= 0 && foundIdx !== this.currentIndex()) {
          this.currentIndex.set(foundIdx);
          return;
        }
      }
      const safeIdx = this.currentIndex() % list.length;
      if (safeIdx !== this.currentIndex()) {
        this.currentIndex.set(safeIdx);
      }
      this.activeSlidePkgId = list[safeIdx]?.id || null;
    });

    effect(() => {
      // Track active slide index and showcase list to synchronize the 32x18 ambient backlight canvas
      this.currentIndex();
      this.showcase();
      queueMicrotask(() => this.syncActiveSlideGlow());
    });
  }

  ngAfterViewInit(): void {
    this.syncActiveSlideGlow();
  }

  onSlideImageLoad(event: Event, idx: number): void {
    if (idx === this.currentIndex()) {
      this.paintGlowFromImage(event.target as HTMLImageElement | null);
    }
  }

  syncActiveSlideGlow(): void {
    const slides = this.slideImgRefs?.toArray() || [];
    const activeIdx = this.currentIndex();
    const activeSlideImg = slides[activeIdx]?.nativeElement;
    if (activeSlideImg) {
      this.paintGlowFromImage(activeSlideImg);
    }
  }

  paintGlowFromImage(img: HTMLImageElement | null | undefined): boolean {
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    const src = img.currentSrc || img.src || '';
    if (!src || src === this.lastGlowSrc) return false;
    const isFirstPaint = this.lastGlowSrc === '';
    const targetBuffer: 0 | 1 = isFirstPaint ? 0 : (this.activeGlowBuffer() === 0 ? 1 : 0);
    const canvas = targetBuffer === 0
      ? this.glowCanvasARef?.nativeElement
      : this.glowCanvasBRef?.nativeElement;
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      this.lastGlowSrc = src;
      this.activeGlowBuffer.set(targetBuffer);
      return true;
    } catch {
      return false;
    }
  }

  isInternalPromoUrl(url?: string | null): boolean {
    const raw = (url || '').trim();
    if (!raw) return false;
    if (raw.startsWith('/') && !raw.startsWith('//')) return true;
    if (typeof window !== 'undefined' && (raw.startsWith('https://') || raw.startsWith('http://'))) {
      try {
        const parsed = new URL(raw);
        return parsed.origin === window.location.origin;
      } catch {
        return false;
      }
    }
    return false;
  }

  getSlideBanner(pkg: LuantiPackage): string {
    if (pkg?._promo?.banner_url) {
      return pkg._promo.banner_url;
    }
    const preferredGit = this.packageService.isGitScreenshotUrl(pkg?.banner)
      ? pkg.banner
      : (this.packageService.isGitScreenshotUrl(pkg?.thumbnail) ? pkg.thumbnail : undefined);
    return (
      selectSharpPackageBanner(preferredGit, pkg?.screenshots, pkg?.banner, pkg?.thumbnail) ||
      pkg?.banner ||
      pkg?.thumbnail ||
      'logo.svg'
    );
  }

  onPromoCtaClick(url?: string | null, event?: Event): void {
    if (event) event.stopPropagation();
    const raw = (url || '').trim();
    const activePromo = this.currentPkg()?._promo;
    const activePromoId = activePromo?.id || '';
    if (raw === '/blog/latest' || activePromoId.startsWith('blog:')) {
      const current = this.currentPkg();
      const slideBanner = activePromo?.banner_url || (current ? this.getSlideBanner(current) : undefined);
      this.packageService.openBlogArticleModal(undefined, slideBanner);
      return;
    }
    if (!raw) return;

    let targetPath = raw;
    if (typeof window !== 'undefined' && (raw.startsWith('https://') || raw.startsWith('http://'))) {
      try {
        const parsed = new URL(raw);
        if (parsed.origin === window.location.origin) {
          targetPath = parsed.pathname + parsed.search + parsed.hash;
        } else {
          window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
          return;
        }
      } catch {
        return;
      }
    }

    if (!targetPath.startsWith('/')) {
      targetPath = `/${targetPath}`;
    }

    if (this.router) {
      this.router.navigateByUrl(targetPath).catch(() => {});
    } else if (typeof window !== 'undefined') {
      window.location.href = targetPath;
    }
  }

  ngOnInit(): void {
    this.startAutoSlide();
  }

  ngOnDestroy(): void {
    this.stopAutoSlide();
  }

  private startAutoSlide(): void {
    if (typeof window === 'undefined') return;
    this.stopAutoSlide();
    this.ngZone.runOutsideAngular(() => {
      this.intervalTimer = setInterval(() => {
        if (!this.isPaused() && typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.ngZone.run(() => this.next());
        }
      }, 12000);
    });
  }

  private stopAutoSlide(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  next(event?: Event): void {
    if (event) event.stopPropagation();
    this.packageService.refreshPromoClock();
    const list = this.showcase();
    const total = list.length;
    if (total <= 1) return;
    const nextIdx = (this.currentIndex() + 1) % total;
    this.activeSlidePkgId = list[nextIdx]?.id || null;
    this.currentIndex.set(nextIdx);
    this.restartAutoSlide();
  }

  prev(event?: Event): void {
    if (event) event.stopPropagation();
    this.packageService.refreshPromoClock();
    const list = this.showcase();
    const total = list.length;
    if (total <= 1) return;
    const prevIdx = (this.currentIndex() - 1 + total) % total;
    this.activeSlidePkgId = list[prevIdx]?.id || null;
    this.currentIndex.set(prevIdx);
    this.restartAutoSlide();
  }

  onDownload(pkg: LuantiPackage): void {
    this.packageService.downloadPackage(pkg);
  }

  getSlideGitUrl(pkg: LuantiPackage): string {
    const normalized = this.packageService.normalizeGitRepoUrl(pkg.repo_url);
    if (normalized && pkg.git_repo_status !== 'broken_404') {
      return normalized;
    }
    return `https://content.luanti.org/packages/${encodeURIComponent(pkg.author)}/${encodeURIComponent(pkg.name)}/`;
  }

  getPackageUrl(pkg: LuantiPackage): string {
    return `/package/${encodeURIComponent(pkg?.author || '')}/${encodeURIComponent(pkg?.name || '')}`;
  }

  onSlideTitleClick(event: MouseEvent, pkg: LuantiPackage): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.packageService.openPackageModal(pkg);
  }

  goTo(index: number, event?: Event): void {
    if (event) event.stopPropagation();
    const list = this.showcase();
    if (index >= 0 && index < list.length) {
      this.activeSlidePkgId = list[index]?.id || null;
    }
    this.currentIndex.set(index);
    this.restartAutoSlide();
  }

  private restartAutoSlide(): void {
    this.startAutoSlide();
  }

  onMouseEnter(): void {
    if (Date.now() - this.lastTouchTime < 800) return;
    this.isPaused.set(true);
  }

  onMouseLeave(): void {
    if (Date.now() - this.lastTouchTime < 800) return;
    this.isPaused.set(false);
    this.startAutoSlide();
  }

  onTouchStart(e: TouchEvent): void {
    this.lastTouchTime = Date.now();
    this.touchStartX = e.changedTouches[0]?.screenX ?? 0;
    this.isPaused.set(true);
  }

  onTouchEnd(e: TouchEvent): void {
    this.lastTouchTime = Date.now();
    const touchEndX = e.changedTouches[0]?.screenX ?? this.touchStartX;
    const diff = touchEndX - this.touchStartX;
    this.isPaused.set(false);
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        this.prev();
      } else {
        this.next();
      }
    } else {
      this.startAutoSlide();
    }
  }
}

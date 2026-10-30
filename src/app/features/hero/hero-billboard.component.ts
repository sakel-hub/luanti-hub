import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PackageService } from '../../core/services/package.service';
import { LuantiPackage } from '../../core/models/package.model';
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
  LucideDownload
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
    LucideDownload
  ],
  template: `
    @if (showcase().length > 0 && currentPkg(); as pkg) {
      <div class="relative w-full max-w-[1760px] mx-auto px-2 sm:px-8 lg:px-12 xl:px-14 mt-2 sm:mt-4">
        <!-- Netflix-Style Natural Ambient Backlight Glow Derived from Active Hero Artwork (Per-Slide Opacity Crossfade to Prevent [src] Swap Flicker) -->
        <div
          aria-hidden="true"
          class="hidden sm:block pointer-events-none select-none absolute -inset-x-10 sm:-inset-x-20 -top-12 -bottom-20 z-0 overflow-visible blur-[80px] sm:blur-[110px] saturate-[1.85]">
          @for (glowPkg of showcase(); track glowPkg.id; let idx = $index) {
            <img
              [src]="glowPkg.banner || glowPkg.thumbnail"
              [fallbackThumbnail]="glowPkg.thumbnail"
              appImgFallback
              alt=""
              decoding="async"
              style="-webkit-mask-image: radial-gradient(ellipse 68% 64% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0.6) 65%, rgba(0,0,0,0) 100%); mask-image: radial-gradient(ellipse 68% 64% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0.6) 65%, rgba(0,0,0,0) 100%);"
              [class]="idx === currentIndex() ? 'opacity-55' : 'opacity-0'"
              class="absolute inset-0 w-full h-full object-cover object-center rounded-[4rem] transform-gpu will-change-[opacity] transition-opacity duration-700 ease-out"
            />
          }
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
          [attr.aria-label]="pkg.title"
          class="relative z-10 w-full aspect-video min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] max-h-[820px] xl:max-h-[860px] rounded-2xl sm:rounded-3xl overflow-hidden select-none bg-slate-950 shadow-[0_28px_80px_-15px_rgba(0,0,0,0.85)] border border-white/15 focus:outline-none focus:ring-2 focus:ring-sky-500/50">

          <!-- Hardware-Accelerated Horizontal Slide Track (Smooth Slide-In/Out without Image Flash) -->
          <div
            class="flex w-full h-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
            [style.transform]="'translate3d(-' + (currentIndex() * 100) + '%, 0, 0)'">
            @for (slidePkg of showcase(); track slidePkg.id; let idx = $index) {
              <div
                class="w-full h-full flex-shrink-0 relative overflow-hidden"
                [attr.aria-hidden]="idx !== currentIndex()">

                <!-- Slide Background Image with Subtle Ken-Burns Scale Transition -->
                <div class="absolute inset-0">
                  <img
                    [src]="slidePkg.banner || slidePkg.thumbnail"
                    [fallbackThumbnail]="slidePkg.thumbnail"
                    appImgFallback
                    [alt]="slidePkg.title"
                    [attr.fetchpriority]="idx === 0 ? 'high' : 'auto'"
                    decoding="async"
                    [class]="idx === currentIndex() ? 'w-full h-full object-cover object-center scale-100 transition-transform duration-1000 ease-out' : 'w-full h-full object-cover object-center scale-105 transition-transform duration-1000 ease-out'"
                  />
                  <div class="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/40 to-transparent w-full md:w-3/5"></div>
                  <div class="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/25 to-transparent"></div>
                </div>

                <!-- Slide Foreground Content with Staggered Fade + Slide-Up Reveal -->
                <div class="relative w-full px-6 sm:px-10 lg:px-14 h-full flex flex-col justify-end pb-16 sm:pb-20 lg:pb-24 z-10 pointer-events-none">
                  <div
                    [class]="idx === currentIndex() ? 'max-w-2xl lg:max-w-3xl space-y-4 pointer-events-auto opacity-100 translate-y-0 transition-all duration-700 delay-100 ease-out' : 'max-w-2xl lg:max-w-3xl space-y-4 pointer-events-none opacity-0 translate-y-4 transition-all duration-500 ease-out'">

                    <!-- Category & Source Badges (Consistent with Package Tiles & Detail Modal) -->
                    <app-package-badges [package]="slidePkg">
                      <button
                        type="button"
                        (click)="$event.stopPropagation()"
                        [appTooltip]="'carousel.infoHero' | translate"
                        [appTooltipMultiline]="true"
                        appTooltipPlacement="right"
                        aria-label="How this showcase is curated"
                        class="w-5 h-5 rounded-full glass-pill text-slate-300 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                        <svg lucideInfo class="w-3 h-3"></svg>
                      </button>
                    </app-package-badges>

                    <!-- Title -->
                    <h2 class="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white drop-shadow-md">
                      {{ slidePkg.title }}
                    </h2>

                    <!-- Description -->
                    <p class="text-sm sm:text-base lg:text-lg text-slate-200 line-clamp-3 leading-relaxed drop-shadow max-w-2xl">
                      {{ slidePkg.short_desc }}
                    </p>

                    <!-- Stats & Meta -->
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

                    <!-- Frosted Glass & High-Contrast CTA Buttons -->
                    <div class="flex items-center gap-3 pt-2 flex-wrap">
                      <!-- Primary Direct .zip Download Button with File Size -->
                      <button
                        type="button"
                        (click)="onDownload(slidePkg)"
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
                        [appTooltip]="'hero.viewDetails' | translate"
                        class="h-11 px-5 sm:px-6 rounded-xl glass-btn text-white font-bold text-xs sm:text-sm flex items-center gap-2.5 transition whitespace-nowrap cursor-pointer">
                        <svg lucideInfo class="w-5 h-5 text-sky-400 flex-shrink-0"></svg>
                        <span>{{ 'hero.viewDetails' | translate }}</span>
                      </button>

                      <a
                        [href]="getSlideGitUrl(slidePkg)"
                        target="_blank"
                        rel="noopener noreferrer"
                        [appTooltip]="'hero.viewGit' | translate"
                        class="h-11 w-11 rounded-xl glass-btn text-amber-300 hover:text-white flex items-center justify-center transition cursor-pointer"
                        [attr.aria-label]="'hero.viewGit' | translate">
                        <svg lucideGitBranch class="w-5 h-5"></svg>
                      </a>
                    </div>

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

          <!-- Slide Indicators / Frosted Pill Dock -->
          <div class="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-950/50 backdrop-blur-md border border-white/10 shadow-lg">
            @for (item of showcase(); track item.id; let idx = $index) {
              <button
                type="button"
                (click)="goTo(idx, $event)"
                [appTooltip]="item.title"
                [attr.aria-label]="'Go to slide ' + (idx + 1) + ': ' + item.title"
                class="h-2 rounded-full transition-all duration-500 ease-out overflow-hidden cursor-pointer"
                [class.w-8]="idx === currentIndex()"
                [class.bg-sky-400]="idx === currentIndex()"
                [class.shadow-\[0_0_8px_rgba\(56\,189\,248\,0\.6\)\]]="idx === currentIndex()"
                [class.w-2.5]="idx !== currentIndex()"
                [class.bg-white/35]="idx !== currentIndex()"
                [class.hover:bg-white/60]="idx !== currentIndex()">
              </button>
            }
          </div>

        </div>
      </div>
    } @else {
      <!-- Professional 16:9 Hero Billboard Skeleton Preloader -->
      <div class="relative w-full max-w-[1760px] mx-auto px-2 sm:px-8 lg:px-12 xl:px-14 mt-2 sm:mt-4" aria-busy="true" aria-label="Loading featured showcase">
        <div class="relative w-full aspect-video min-h-[400px] sm:min-h-[500px] lg:min-h-[600px] max-h-[820px] xl:max-h-[860px] rounded-2xl sm:rounded-3xl overflow-hidden glass-panel border border-white/10">
          <div class="absolute inset-0 skeleton-shimmer opacity-40"></div>
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
      </div>
    }
  `
})
export class HeroBillboardComponent implements OnInit, OnDestroy {
  readonly packageService = inject(PackageService);
  private readonly ngZone = inject(NgZone);

  readonly showcase = this.packageService.heroShowcasePackages;
  readonly currentIndex = signal<number>(0);
  readonly isPaused = signal<boolean>(false);

  readonly currentPkg = computed<LuantiPackage | null>(() => {
    const list = this.showcase();
    if (list.length === 0) return null;
    const idx = this.currentIndex() % list.length;
    return list[idx];
  });

  private intervalTimer: any = null;
  private touchStartX = 0;

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
      }, 6500);
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
    const total = this.showcase().length;
    if (total <= 1) return;
    this.currentIndex.update(idx => (idx + 1) % total);
    this.restartAutoSlide();
  }

  prev(event?: Event): void {
    if (event) event.stopPropagation();
    const total = this.showcase().length;
    if (total <= 1) return;
    this.currentIndex.update(idx => (idx - 1 + total) % total);
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

  goTo(index: number, event?: Event): void {
    if (event) event.stopPropagation();
    this.currentIndex.set(index);
    this.restartAutoSlide();
  }

  private restartAutoSlide(): void {
    if (!this.isPaused()) {
      this.startAutoSlide();
    }
  }

  onMouseEnter(): void {
    this.isPaused.set(true);
  }

  onMouseLeave(): void {
    this.isPaused.set(false);
  }

  onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.changedTouches[0].screenX;
    this.isPaused.set(true);
  }

  onTouchEnd(e: TouchEvent): void {
    const touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - this.touchStartX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) {
        this.prev();
      } else {
        this.next();
      }
    }
    this.isPaused.set(false);
  }
}

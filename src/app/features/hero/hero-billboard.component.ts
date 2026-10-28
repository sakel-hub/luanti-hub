import {
  Component,
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
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucidePlay,
  LucidePause,
  LucideChevronLeft,
  LucideChevronRight,
  LucideInfo,
  LucideStar,
  LucideGitBranch
} from '@lucide/angular';

@Component({
  selector: 'app-hero-billboard',
  standalone: true,
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    TranslatePipe,
    LucidePlay,
    LucidePause,
    LucideChevronLeft,
    LucideChevronRight,
    LucideInfo,
    LucideStar,
    LucideGitBranch
  ],
  template: `
    @if (showcase().length > 0 && currentPkg(); as pkg) {
      <div class="relative w-full max-w-7xl mx-auto sm:px-4 lg:px-8 mt-1 sm:mt-3">
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
          class="relative w-full h-[540px] sm:h-[620px] lg:h-[680px] sm:rounded-3xl overflow-hidden select-none bg-slate-950 shadow-2xl border border-slate-800/80 focus:outline-none focus:ring-2 focus:ring-sky-500/50">
          
          <!-- Hardware-Accelerated Single Active Slide Background (Clear & Vivid) -->
          <div class="absolute inset-0">
            <img 
              [src]="pkg.banner || pkg.thumbnail" 
              [fallbackThumbnail]="pkg.thumbnail"
              appImgFallback
              [alt]="pkg.title"
              fetchpriority="high"
              decoding="async"
              class="w-full h-full object-cover object-center filter brightness-100 transition-opacity duration-300"
            />
            <!-- High-Visibility Directional Gradients for Netflix Look -->
            <div class="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/30 to-transparent w-full md:w-3/5"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/20 to-transparent"></div>
          </div>

        <!-- Foreground Content -->
        <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex flex-col justify-end pb-16 sm:pb-20 z-10 pointer-events-none">
          <div class="max-w-2xl space-y-4 pointer-events-auto">
            
            <!-- Category & Source Badges -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-slate-800/90 text-slate-200 border border-slate-700/80 shadow">
                @if (pkg.type === 'game') {
                  {{ 'hero.categoryGame' | translate }}
                } @else if (pkg.type === 'txp') {
                  {{ 'hero.categoryTxp' | translate }}
                } @else if (pkg.source === 'git') {
                  {{ 'hero.categoryGit' | translate }}
                } @else {
                  {{ 'hero.categoryMod' | translate }}
                }
              </span>

              @if (pkg.source === 'git') {
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <svg lucideGitBranch class="w-3 h-3 text-amber-400"></svg>
                  <span>{{ 'header.filterGit' | translate }}</span>
                </span>
              }
            </div>

            <!-- Title -->
            <h1 class="text-3xl sm:text-5xl font-black tracking-tight text-white drop-shadow-md">
              {{ pkg.title }}
            </h1>

            <!-- Description -->
            <p class="text-sm sm:text-base text-slate-300 line-clamp-3 leading-relaxed drop-shadow">
              {{ pkg.short_desc }}
            </p>

            <!-- Stats & Meta -->
            <div class="flex items-center gap-3 sm:gap-4 text-xs text-slate-300 flex-wrap">
              <div class="flex items-center gap-1 text-amber-400 font-bold">
                <svg lucideStar class="w-4 h-4 fill-amber-400 text-amber-400"></svg>
                <span>{{ pkg.score }}</span>
              </div>
              <span>•</span>
              <span>{{ pkg.downloads | number }} {{ 'hero.downloads' | translate | lowercase }}</span>
              <span>•</span>
              <span class="text-slate-400 font-mono">License: {{ pkg.license }}</span>
            </div>

            <!-- Netflix CTA Buttons -->
            <div class="flex items-center gap-3 pt-2">
              <!-- Primary White Play/Install Button -->
              <button 
                (click)="onDownload(pkg)"
                [appTooltip]="'hero.playInstall' | translate"
                class="h-11 px-6 sm:px-8 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-black text-xs sm:text-sm flex items-center gap-2.5 shadow-2xl hover:scale-105 transition-all whitespace-nowrap">
                <svg lucidePlay class="w-5 h-5 fill-slate-950 text-slate-950"></svg>
                <span>{{ 'hero.playInstall' | translate }}</span>
              </button>

              <!-- Secondary Translucent More Info Button -->
              <button 
                (click)="packageService.openPackageModal(pkg)"
                [appTooltip]="'hero.viewDetails' | translate"
                class="h-11 px-5 sm:px-6 rounded-lg bg-slate-600/70 hover:bg-slate-600/90 text-white font-bold text-xs sm:text-sm backdrop-blur-md border border-white/20 flex items-center gap-2.5 transition whitespace-nowrap">
                <svg lucideInfo class="w-5 h-5 text-white"></svg>
                <span>{{ 'hero.viewDetails' | translate }}</span>
              </button>

              @if (pkg.repo_url) {
                <a 
                  [href]="pkg.repo_url" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  [appTooltip]="'hero.viewGit' | translate"
                  class="h-11 w-11 rounded-lg bg-slate-700/60 hover:bg-slate-700/90 text-white backdrop-blur-md border border-white/20 flex items-center justify-center transition"
                  [attr.aria-label]="'hero.viewGit' | translate">
                  <svg lucideGitBranch class="w-5 h-5"></svg>
                </a>
              }
            </div>

          </div>
        </div>

        <!-- Carousel Navigation Controls & Indicators -->
        <div class="absolute bottom-5 right-6 sm:right-8 z-40 pointer-events-auto flex items-center gap-2.5">
          
          <!-- Slide Number Indicator -->
          <span class="text-xs font-mono text-slate-300 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-700/80 shadow">
            {{ currentIndex() + 1 }} / {{ showcase().length }}
          </span>

          <!-- Left Prev Button -->
          <button 
            (click)="prev($event)"
            [appTooltip]="'hero.prevSlide' | translate"
            aria-label="Previous slide"
            class="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition shadow hover:scale-105 active:scale-95">
            <svg lucideChevronLeft class="w-4 h-4"></svg>
          </button>

          <!-- Right Next Button -->
          <button 
            (click)="next($event)"
            [appTooltip]="'hero.nextSlide' | translate"
            aria-label="Next slide"
            class="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition shadow hover:scale-105 active:scale-95">
            <svg lucideChevronRight class="w-4 h-4"></svg>
          </button>

          <!-- Auto-Play Pause / Resume Button -->
          <button 
            (click)="togglePause($event)"
            [appTooltip]="isPaused() ? ('hero.resumeAutoPlay' | translate) : ('hero.pauseAutoPlay' | translate)"
            [attr.aria-label]="isPaused() ? 'Resume carousel' : 'Pause carousel'"
            class="p-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition shadow hover:scale-105 active:scale-95">
            @if (isPaused()) {
              <svg lucidePlay class="w-4 h-4 text-emerald-400"></svg>
            } @else {
              <svg lucidePause class="w-4 h-4 text-sky-400"></svg>
            }
          </button>

        </div>

        <!-- Slide Indicators / Dots -->
        <div class="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto hidden md:flex items-center gap-2">
          @for (item of showcase(); track item.id; let idx = $index) {
            <button 
              (click)="goTo(idx, $event)"
              [appTooltip]="item.title"
              [attr.aria-label]="'Go to slide ' + (idx + 1) + ': ' + item.title"
              class="h-2 rounded-full transition-all duration-300 overflow-hidden cursor-pointer"
              [class.w-8]="idx === currentIndex()"
              [class.bg-white]="idx === currentIndex()"
              [class.w-3]="idx !== currentIndex()"
              [class.bg-slate-600/80]="idx !== currentIndex()"
              [class.hover:bg-slate-400]="idx !== currentIndex()">
            </button>
          }
        </div>

      </div>
    </div>
    } @else {
      <!-- Dynamic Skeleton / Loading State -->
      <div class="relative w-full h-[400px] sm:h-[480px] bg-slate-950 flex items-center justify-center p-6 border-b border-slate-900">
        <div class="flex flex-col items-center gap-3 text-center">
          <div class="w-10 h-10 border-3 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-xs text-slate-400 font-medium tracking-wide">
            {{ 'common.loading' | translate }}
          </p>
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
    this.packageService.trackDownload(pkg);
    this.packageService.openSetupModal();
  }

  goTo(index: number, event?: Event): void {
    if (event) event.stopPropagation();
    this.currentIndex.set(index);
    this.restartAutoSlide();
  }

  togglePause(event?: Event): void {
    if (event) event.stopPropagation();
    this.isPaused.update(val => !val);
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

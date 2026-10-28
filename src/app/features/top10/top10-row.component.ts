import {
  Component,
  inject,
  ViewChild,
  ElementRef,
  AfterViewInit,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { LuantiPackage } from '../../core/models/package.model';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideHeart,
  LucideTrophy
} from '@lucide/angular';

@Component({
  selector: 'app-top10-row',
  standalone: true,
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    TranslatePipe,
    LucideChevronLeft,
    LucideChevronRight,
    LucideHeart,
    LucideTrophy
  ],
  template: `
    @if (packageService.top10Packages().length > 0) {
      <section class="py-6 space-y-3 select-none" aria-label="Top 10 Packages Row">

        <!-- Row Header: Title & Timeframe Toggle (Today vs This Week) -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <svg lucideTrophy class="w-4 h-4"></svg>
            </div>
            <div>
              <h2 class="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>{{ 'carousel.top10Title' | translate }}</span>
                <span class="text-xs font-semibold text-rose-400 bg-rose-950/60 border border-rose-800/80 px-2 py-0.5 rounded-full">
                  {{ packageService.top10Timeframe() === 'today' ? ('carousel.top10Today' | translate) : ('carousel.top10Week' | translate) }}
                </span>
              </h2>
            </div>
          </div>

          <!-- Controls: Timeframe Toggle & Carousel Scroll Arrows -->
          <div class="flex items-center gap-2.5">
            <!-- Toggle: Today vs This Week -->
            <div class="p-0.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center text-xs font-semibold">
              <button
                (click)="setTimeframe('today')"
                [class]="packageService.top10Timeframe() === 'today' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'"
                class="px-2.5 py-1 rounded-md transition text-[11px] whitespace-nowrap">
                {{ 'carousel.top10Today' | translate }}
              </button>
              <button
                (click)="setTimeframe('week')"
                [class]="packageService.top10Timeframe() === 'week' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'"
                class="px-2.5 py-1 rounded-md transition text-[11px] whitespace-nowrap">
                {{ 'carousel.top10Week' | translate }}
              </button>
            </div>

            <!-- Scroll Buttons (Only visible if scrollable) -->
            @if (isScrollable()) {
              <div class="hidden sm:flex items-center gap-1.5">
                <button
                  (click)="scrollLeft()"
                  [disabled]="!canScrollLeft()"
                  [class.opacity-30]="!canScrollLeft()"
                  [class.pointer-events-none]="!canScrollLeft()"
                  [attr.aria-label]="'carousel.scrollLeft' | translate"
                  [appTooltip]="'carousel.scrollLeft' | translate"
                  class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition">
                  <svg lucideChevronLeft class="w-4 h-4"></svg>
                </button>
                <button
                  (click)="scrollRight()"
                  [disabled]="!canScrollRight()"
                  [class.opacity-30]="!canScrollRight()"
                  [class.pointer-events-none]="!canScrollRight()"
                  [attr.aria-label]="'carousel.scrollRight' | translate"
                  [appTooltip]="'carousel.scrollRight' | translate"
                  class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition">
                  <svg lucideChevronRight class="w-4 h-4"></svg>
                </button>
              </div>
            }
          </div>
        </div>

        <!-- Scrollable Track with Netflix Numerals + Portrait Cards -->
        <div
          #trackRef
          (scroll)="onTrackScroll()"
          tabindex="0"
          role="region"
          aria-label="Top 10 packages list"
          class="flex items-end gap-2 sm:gap-4 overflow-x-auto snap-x snap-mandatory px-4 sm:px-6 lg:px-8 py-4 no-scrollbar scroll-smooth">
          @for (pkg of packageService.top10Packages(); track pkg.id; let idx = $index) {
            <div
              (click)="openDetails(pkg)"
              role="button"
              tabindex="0"
              (keydown.enter)="openDetails(pkg)"
              (keydown.space)="openDetails(pkg)"
              [attr.aria-label]="'#' + (idx + 1) + ' ' + pkg.title"
              class="relative flex items-end flex-shrink-0 group cursor-pointer snap-start transition-transform duration-300 hover:-translate-y-2 focus:outline-none">

              <!-- Iconic Netflix Style SVG Stroked Rank Numeral (Height matches tile, transparent fill, zero broken lines) -->
              <svg
                [attr.viewBox]="idx === 9 ? '0 0 170 160' : '0 0 100 160'"
                class="h-48 sm:h-60 md:h-64 w-auto -mr-4 sm:-mr-6 md:-mr-8 z-0 pointer-events-none select-none overflow-visible flex-shrink-0">
                <text
                  x="50%"
                  y="86%"
                  text-anchor="middle"
                  font-family="Impact, Haettenschweiler, 'Arial Black', sans-serif"
                  font-weight="900"
                  font-size="150"
                  fill="transparent"
                  stroke="#52525b"
                  stroke-width="5"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  class="group-hover:stroke-slate-300 transition-colors">
                  {{ idx + 1 }}
                </text>
              </svg>

              <!-- Portrait Poster Card -->
              <div class="relative w-32 h-48 sm:w-40 sm:h-60 md:w-44 md:h-64 rounded-xl bg-slate-900 border border-slate-800 group-hover:border-rose-500/70 shadow-2xl overflow-hidden z-10 flex flex-col justify-end transition-all">

                <!-- High-Resolution Poster Image -->
                <img
                  [src]="pkg.banner || pkg.thumbnail"
                  [fallbackThumbnail]="pkg.thumbnail"
                  appImgFallback
                  [alt]="pkg.title"
                  loading="lazy"
                  decoding="async"
                  class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />

                <!-- Top Red Netflix Badge -->
                <div class="absolute top-2 left-2 z-20">
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-600 text-white shadow-md">
                    {{ 'carousel.top10Badge' | translate }}
                  </span>
                </div>

                <!-- Favorite Quick Button -->
                <button
                  (click)="onFavoriteClick($event, pkg)"
                  [attr.aria-label]="settingsService.isFavorite(pkg.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                  class="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-slate-950/70 hover:bg-slate-950 text-slate-300 hover:text-rose-400 transition">
                  <svg
                    lucideHeart
                    class="w-3.5 h-3.5 transition-colors"
                    [class.fill-rose-500]="settingsService.isFavorite(pkg.id)"
                    [class.text-rose-500]="settingsService.isFavorite(pkg.id)">
                  </svg>
                </button>

                <!-- Gradient Vignette at Bottom -->
                <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent z-10 pointer-events-none"></div>

                <!-- Info Overlay at Bottom -->
                <div class="relative p-2.5 sm:p-3 z-20 space-y-1">
                  <span class="text-[9px] uppercase font-bold text-rose-400 block tracking-wider">
                    #{{ idx + 1 }} {{ pkg.type }}
                  </span>
                  <h3 class="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-rose-300 transition-colors">
                    {{ pkg.title }}
                  </h3>
                  <div class="flex items-center justify-between text-[10px] text-slate-400">
                    <span class="text-emerald-400 font-semibold">{{ ((pkg.score || 4.5) * 20) | number:'1.0-0' }}% Match</span>
                    <span>{{ pkg.downloads | number }} dl</span>
                  </div>
                </div>

              </div>

            </div>
          }
        </div>

      </section>
    }
  `
})
export class Top10RowComponent implements AfterViewInit {
  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);

  @ViewChild('trackRef') trackRef!: ElementRef<HTMLDivElement>;

  readonly isScrollable = signal<boolean>(false);
  readonly canScrollLeft = signal<boolean>(false);
  readonly canScrollRight = signal<boolean>(false);

  ngAfterViewInit(): void {
    setTimeout(() => this.updateScrollState(), 100);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this.updateScrollState();
      }, { passive: true });
    }
  }

  onTrackScroll(): void {
    this.updateScrollState();
  }

  private updateScrollState(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const scrollable = el.scrollWidth > el.clientWidth + 5;
    this.isScrollable.set(scrollable);
    this.canScrollLeft.set(el.scrollLeft > 10);
    this.canScrollRight.set(el.scrollLeft < (el.scrollWidth - el.clientWidth - 10));
  }

  setTimeframe(timeframe: 'today' | 'week'): void {
    this.packageService.setTop10Timeframe(timeframe);
    setTimeout(() => this.updateScrollState(), 100);
  }

  openDetails(pkg: LuantiPackage): void {
    this.packageService.openPackageModal(pkg);
  }

  onFavoriteClick(event: MouseEvent, pkg: LuantiPackage): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(pkg.id);
  }

  scrollLeft(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const distance = Math.max(300, el.clientWidth * 0.75);
    el.scrollBy({ left: -distance, behavior: 'smooth' });
  }

  scrollRight(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const distance = Math.max(300, el.clientWidth * 0.75);
    el.scrollBy({ left: distance, behavior: 'smooth' });
  }
}

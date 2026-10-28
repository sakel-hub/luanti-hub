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
          class="flex items-end gap-2 sm:gap-4 overflow-x-auto px-6 sm:px-10 lg:px-14 py-6 no-scrollbar scroll-smooth">
          @for (pkg of packageService.top10Packages(); track pkg.id; let idx = $index) {
            <div
              (click)="openDetails(pkg)"
              role="button"
              tabindex="0"
              (keydown.enter)="openDetails(pkg)"
              (keydown.space)="openDetails(pkg)"
              [attr.aria-label]="'#' + (idx + 1) + ' ' + pkg.title"
              class="relative flex items-end flex-shrink-0 group cursor-pointer transition-transform duration-300 hover:-translate-y-2 focus:outline-none">

              <!-- Iconic Netflix Style SVG Stroked Rank Numeral (Height matches tile, transparent fill, zero broken lines) -->
              <svg
                [attr.viewBox]="rankPaths[idx]?.vb || '0 0 105 200'"
                class="h-48 sm:h-60 md:h-64 w-auto -mr-4 sm:-mr-6 md:-mr-8 z-0 pointer-events-none select-none flex-shrink-0 overflow-visible">
                <path
                  fill-rule="evenodd"
                  [attr.d]="rankPaths[idx]?.d"
                  fill="transparent"
                  stroke="#52525b"
                  stroke-width="5"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  class="group-hover:stroke-slate-200 transition-colors duration-300">
                </path>
              </svg>

              <!-- Portrait Poster Card -->
              <div class="relative w-32 h-48 sm:w-40 sm:h-60 md:w-44 md:h-64 rounded-xl bg-slate-900 border border-slate-800 group-hover:border-rose-500/70 shadow-2xl overflow-hidden z-10 flex flex-col justify-end transition-all">

                <!-- High-Resolution Poster Image -->
                <img
                  [src]="getHighResImage(pkg)"
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

  readonly rankPaths: Array<{ vb: string; d: string }> = [
    // 1
    { vb: '0 0 75 200', d: 'M 70 8 L 70 192 L 34 192 L 34 56 L 10 74 L 6 50 L 42 8 Z' },
    // 2
    { vb: '0 0 105 200', d: 'M 10 192 L 98 192 L 98 158 L 48 158 L 96 90 C 102 80, 100 35, 75 14 C 52 -3, 22 8, 12 40 L 40 50 C 46 32, 60 26, 70 34 C 78 40, 80 60, 74 72 L 10 162 Z' },
    // 3
    { vb: '0 0 105 200', d: 'M 15 10 L 95 10 L 95 38 L 56 82 C 78 82, 98 96, 98 134 C 98 172, 76 192, 48 192 C 22 192, 10 176, 8 150 L 38 144 C 40 156, 46 166, 54 166 C 66 166, 72 154, 72 134 C 72 114, 64 102, 50 102 L 36 102 L 36 74 L 62 38 L 15 38 Z' },
    // 4
    { vb: '0 0 105 200', d: 'M 62 8 L 94 8 L 94 116 L 102 116 L 102 146 L 94 146 L 94 192 L 62 192 L 62 146 L 6 146 L 6 116 L 62 8 Z M 62 52 L 32 116 L 62 116 Z' },
    // 5
    { vb: '0 0 105 200', d: 'M 18 10 L 94 10 L 94 38 L 48 38 L 42 80 C 52 74, 68 74, 78 78 C 92 84, 98 102, 98 132 C 98 168, 78 192, 48 192 C 22 192, 10 174, 8 148 L 38 142 C 40 156, 46 166, 54 166 C 66 166, 72 154, 72 132 C 72 112, 64 102, 50 102 C 40 102, 32 108, 24 116 L 12 108 L 18 10 Z' },
    // 6
    { vb: '0 0 105 200', d: 'M 84 10 L 58 10 C 26 28, 10 74, 10 134 C 10 172, 30 192, 58 192 C 84 192, 98 170, 98 132 C 98 94, 82 74, 56 74 C 42 74, 30 82, 22 94 C 26 56, 42 38, 64 36 L 84 36 Z M 56 102 C 68 102, 74 114, 74 133 C 74 152, 68 164, 56 164 C 44 164, 38 152, 38 133 C 38 114, 44 102, 56 102 Z' },
    // 7
    { vb: '0 0 105 200', d: 'M 10 10 L 98 10 L 98 38 L 56 192 L 24 192 L 66 38 L 10 38 Z' },
    // 8
    { vb: '0 0 105 200', d: 'M 54 8 C 76 8, 92 24, 92 50 C 92 70, 80 84, 68 94 C 84 104, 96 122, 96 148 C 96 176, 78 192, 54 192 C 30 192, 12 176, 12 148 C 12 122, 24 104, 40 94 C 28 84, 16 70, 16 50 C 16 24, 32 8, 54 8 Z M 54 34 C 44 34, 38 42, 38 52 C 38 64, 44 72, 54 72 C 64 72, 70 64, 70 52 C 70 42, 64 34, 54 34 Z M 54 116 C 42 116, 36 128, 36 148 C 36 164, 42 170, 54 170 C 66 170, 72 164, 72 148 C 72 128, 66 116, 54 116 Z' },
    // 9
    { vb: '0 0 105 200', d: 'M 22 190 L 48 190 C 80 172, 96 126, 96 66 C 96 28, 76 8, 48 8 C 22 8, 8 30, 8 68 C 8 106, 24 126, 50 126 C 64 126, 76 118, 84 106 C 80 144, 64 162, 42 164 L 22 164 Z M 50 98 C 38 98, 32 86, 32 67 C 32 48, 38 36, 50 36 C 62 36, 68 48, 68 67 C 68 86, 62 98, 50 98 Z' },
    // 10
    { vb: '0 0 175 200', d: 'M 60 8 L 60 192 L 28 192 L 28 56 L 8 74 L 4 50 L 36 8 Z M 122 8 C 150 8, 170 32, 170 100 C 170 168, 150 192, 122 192 C 94 192, 74 168, 74 100 C 74 32, 94 8, 122 8 Z M 122 38 C 138 38, 144 58, 144 100 C 144 142, 138 162, 122 162 C 106 162, 100 142, 100 100 C 100 58, 106 38, 122 38 Z' }
  ];

  getHighResImage(pkg: LuantiPackage): string {
    if (pkg.banner && !pkg.banner.includes('thumbnail.png')) {
      return pkg.banner;
    }
    if (pkg.thumbnail && pkg.thumbnail.includes('thumbnail.png')) {
      return pkg.thumbnail.replace('thumbnail.png', 'shot-0.png');
    }
    return pkg.banner || pkg.thumbnail || 'logo.svg';
  }

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

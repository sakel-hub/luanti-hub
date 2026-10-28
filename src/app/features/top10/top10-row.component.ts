import {
  Component,
  ChangeDetectionStrategy,
  Input,
  inject,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed
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
  LucideTrophy,
  LucideDownload,
  LucideInfo
} from '@lucide/angular';

@Component({
  selector: 'app-top10-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    TranslatePipe,
    LucideChevronLeft,
    LucideChevronRight,
    LucideHeart,
    LucideTrophy,
    LucideDownload,
    LucideInfo
  ],
  template: `
    @if (rowPackages().length > 0) {
      <section class="py-6 space-y-3 select-none overflow-hidden max-w-full" [attr.aria-label]="'Top 10 Packages (' + timeframe + ')'">

        <!-- Row Header: Dedicated Timeframe Title & Carousel Scroll Arrows (No Pill Switch) -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-3">
            <div
              [class]="timeframe === 'today' ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-rose-500/20 border-rose-500/30 text-rose-400'"
              class="w-8 h-8 rounded-lg border backdrop-blur-md flex items-center justify-center">
              <svg lucideTrophy class="w-4 h-4"></svg>
            </div>
            <div>
              <h2 class="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2.5">
                <span>{{ 'carousel.top10Title' | translate }}</span>
                <span
                  [class]="timeframe === 'today' ? 'text-amber-300 bg-amber-500/20 border-amber-400/30' : 'text-rose-300 bg-rose-500/20 border-rose-400/30'"
                  class="text-xs font-semibold border backdrop-blur-md px-2.5 py-0.5 rounded-full">
                  {{ timeframe === 'today' ? ('carousel.top10Today' | translate) : ('carousel.top10Week' | translate) }}
                </span>
                <button
                  type="button"
                  (click)="$event.stopPropagation()"
                  [appTooltip]="timeframe === 'today' ? ('carousel.infoTop10Today' | translate) : ('carousel.infoTop10Week' | translate)"
                  [appTooltipMultiline]="true"
                  appTooltipPlacement="top"
                  aria-label="How this Top 10 ranking is built"
                  class="w-5 h-5 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                  <svg lucideInfo class="w-3 h-3"></svg>
                </button>
              </h2>
            </div>
          </div>

          <!-- Controls: Carousel Scroll Arrows -->
          <div class="flex items-center gap-2.5">
            @if (isScrollable()) {
              <div class="hidden sm:flex items-center gap-1.5">
                <button
                  type="button"
                  (click)="scrollLeft()"
                  [disabled]="!canScrollLeft()"
                  [class.opacity-30]="!canScrollLeft()"
                  [class.pointer-events-none]="!canScrollLeft()"
                  [attr.aria-label]="'carousel.scrollLeft' | translate"
                  [appTooltip]="'carousel.scrollLeft' | translate"
                  class="p-1.5 rounded-lg glass-btn text-slate-300 hover:text-white transition cursor-pointer">
                  <svg lucideChevronLeft class="w-4 h-4"></svg>
                </button>
                <button
                  type="button"
                  (click)="scrollRight()"
                  [disabled]="!canScrollRight()"
                  [class.opacity-30]="!canScrollRight()"
                  [class.pointer-events-none]="!canScrollRight()"
                  [attr.aria-label]="'carousel.scrollRight' | translate"
                  [appTooltip]="'carousel.scrollRight' | translate"
                  class="p-1.5 rounded-lg glass-btn text-slate-300 hover:text-white transition cursor-pointer">
                  <svg lucideChevronRight class="w-4 h-4"></svg>
                </button>
              </div>
            }
          </div>
        </div>

        <!-- Scrollable Track with Straight Geometric Netflix Numerals + Portrait Cards -->
        <div
          #trackRef
          (scroll)="onTrackScroll()"
          tabindex="0"
          role="region"
          [attr.aria-label]="'Top 10 packages list (' + timeframe + ')'"
          class="flex items-end gap-3 sm:gap-5 overflow-x-auto px-6 sm:px-10 lg:px-14 py-6 no-scrollbar scroll-smooth">
          @for (pkg of rowPackages(); track pkg.id; let idx = $index) {
            <div
              (click)="openDetails(pkg)"
              role="button"
              tabindex="0"
              (keydown.enter)="openDetails(pkg)"
              (keydown.space)="openDetails(pkg)"
              [attr.aria-label]="'#' + (idx + 1) + ' ' + pkg.title"
              class="relative flex items-end flex-shrink-0 group cursor-pointer transition-transform duration-300 hover:-translate-y-2 focus:outline-none">

              <!-- Precision Geometric Netflix Rank Numeral -->
              <svg
                [attr.viewBox]="rankNumerals[idx]?.vb || '0 0 120 200'"
                aria-hidden="true"
                class="h-44 sm:h-56 md:h-60 w-auto -mr-5 sm:-mr-7 md:-mr-8 z-0 pointer-events-none select-none flex-shrink-0 overflow-visible">
                <defs>
                  <linearGradient [attr.id]="'rank-grad-' + timeframe + '-' + idx" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#1e293b" />
                    <stop offset="100%" stop-color="#020617" />
                  </linearGradient>
                </defs>
                <path
                  fill-rule="evenodd"
                  [attr.d]="rankNumerals[idx]?.d"
                  [attr.fill]="'url(#rank-grad-' + timeframe + '-' + idx + ')'"
                  stroke="#64748b"
                  stroke-width="8"
                  stroke-linejoin="miter"
                  stroke-miterlimit="10"
                  style="paint-order: stroke fill;"
                  class="group-hover:stroke-rose-500 transition-colors duration-300 drop-shadow-2xl">
                </path>
              </svg>

              <!-- Portrait Poster Card -->
              <div class="relative w-32 h-48 sm:w-40 sm:h-60 md:w-44 md:h-64 rounded-2xl glass-card group-hover:border-rose-500/70 shadow-2xl overflow-hidden z-10 flex flex-col justify-end transition-all">

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
                  <span class="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-rose-600/90 backdrop-blur-md text-white shadow-md">
                    {{ 'carousel.top10Badge' | translate }}
                  </span>
                </div>

                <!-- Quick Action Buttons (Download .zip + Favorite) -->
                <div class="absolute top-2 right-2 z-20 flex items-center gap-1">
                  <button
                    type="button"
                    (click)="onDownloadClick($event, pkg)"
                    [attr.aria-label]="'card.quickInstall' | translate"
                    [appTooltip]="('card.quickInstall' | translate) + (pkg.file_size ? ' (' + pkg.file_size + ')' : '')"
                    class="p-1.5 rounded-full glass-btn-primary text-white transition shadow cursor-pointer">
                    <svg lucideDownload class="w-3.5 h-3.5 text-white"></svg>
                  </button>
                  <button
                    type="button"
                    (click)="onFavoriteClick($event, pkg)"
                    [attr.aria-label]="settingsService.isFavorite(pkg.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                    [appTooltip]="settingsService.isFavorite(pkg.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                    class="p-1.5 rounded-full glass-icon-btn text-slate-200 hover:text-rose-400 transition shadow cursor-pointer">
                    <svg
                      lucideHeart
                      [class]="settingsService.isFavorite(pkg.id) ? 'w-3.5 h-3.5 fill-rose-500 text-rose-500 transition-colors' : 'w-3.5 h-3.5 transition-colors'"
                      [style.fill]="settingsService.isFavorite(pkg.id) ? '#f43f5e' : 'none'"
                      [color]="settingsService.isFavorite(pkg.id) ? '#f43f5e' : 'currentColor'">
                    </svg>
                  </button>
                </div>

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
                    <span class="text-emerald-400 font-semibold">{{ packageService.getMatchScore(pkg) }}% {{ 'card.match' | translate }}</span>
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
export class Top10RowComponent implements AfterViewInit, OnDestroy {
  @Input() timeframe: 'today' | 'week' = 'today';

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);

  readonly rowPackages = computed<LuantiPackage[]>(() => {
    return this.timeframe === 'today'
      ? this.packageService.top10TodayPackages()
      : this.packageService.top10WeekPackages();
  });

  @ViewChild('trackRef') trackRef!: ElementRef<HTMLDivElement>;

  readonly isScrollable = signal<boolean>(false);
  readonly canScrollLeft = signal<boolean>(false);
  readonly canScrollRight = signal<boolean>(false);

  readonly rankNumerals: Array<{ vb: string; d: string }> = [
    {
      vb: '0 0 96 200',
      d: 'M 42 12 L 78 12 L 78 188 L 42 188 L 42 46 L 14 46 L 14 18 L 42 12 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 114 L 48 114 L 48 156 L 102 156 L 102 188 L 14 188 L 14 84 L 68 84 L 68 44 L 14 44 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 188 L 14 188 L 14 156 L 68 156 L 68 114 L 24 114 L 24 84 L 68 84 L 68 44 L 14 44 Z'
    },
    {
      vb: '0 0 120 200',
      d: 'M 12 12 L 46 12 L 46 88 L 70 88 L 70 12 L 104 12 L 104 188 L 70 188 L 70 120 L 12 120 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 44 L 48 44 L 48 84 L 102 84 L 102 188 L 14 188 L 14 156 L 68 156 L 68 114 L 14 114 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 44 L 48 44 L 48 84 L 102 84 L 102 188 L 14 188 Z M 48 114 L 48 156 L 68 156 L 68 114 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 48 L 62 188 L 26 188 L 66 44 L 14 44 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 188 L 14 188 Z M 48 44 L 48 84 L 68 84 L 68 44 Z M 48 114 L 48 156 L 68 156 L 68 114 Z'
    },
    {
      vb: '0 0 116 200',
      d: 'M 14 12 L 102 12 L 102 188 L 14 188 L 14 156 L 68 156 L 68 116 L 14 116 Z M 48 44 L 48 84 L 68 84 L 68 44 Z'
    },
    {
      vb: '0 0 176 200',
      d: 'M 30 12 L 64 12 L 64 188 L 30 188 L 30 46 L 8 46 L 8 18 Z M 82 12 L 166 12 L 166 188 L 82 188 Z M 114 44 L 114 156 L 134 156 L 134 44 Z'
    }
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

  private readonly resizeHandler = () => this.updateScrollState();

  ngAfterViewInit(): void {
    setTimeout(() => this.updateScrollState(), 100);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler, { passive: true });
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
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

  onDownloadClick(event: MouseEvent, pkg: LuantiPackage): void {
    event.stopPropagation();
    this.packageService.downloadPackage(pkg);
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

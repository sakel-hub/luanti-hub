import {
  Component,
  ChangeDetectionStrategy,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageCardComponent } from '../card/package-card.component';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ThemeIconComponent } from '../../shared/components/theme-icon.component';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideArrowRight,
  LucideInfo
} from '@lucide/angular';

@Component({
  selector: 'app-package-carousel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    PackageCardComponent,
    TooltipDirective,
    TranslatePipe,
    ThemeIconComponent,
    LucideChevronLeft,
    LucideChevronRight,
    LucideArrowRight,
    LucideInfo
  ],
  template: `
    @if (packages.length > 0 || showWhenEmpty) {
      <section
        [style.content-visibility]="'auto'"
        [style.contain-intrinsic-size]="'auto 340px'"
        class="py-2 sm:py-3 space-y-2.5 select-none overflow-hidden max-w-full">

        <!-- Section Header -->
        <div class="max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            @if (icon) {
              <app-theme-icon [name]="icon" sizeClass="w-5 h-5"></app-theme-icon>
            }
            <h2 class="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2 flex-wrap">
              @if (promoBadge) {
                <span class="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-wider">
                  {{ promoBadge }}
                </span>
              }
              <span>{{ title }}</span>
              <span class="text-xs font-medium text-slate-400">({{ packages.length }})</span>
              @if (infoTooltip) {
                <button
                  type="button"
                  (click)="$event.stopPropagation()"
                  [appTooltip]="infoTooltip"
                  [appTooltipMultiline]="true"
                  appTooltipPlacement="top"
                  [attr.aria-label]="'How ' + title + ' is built'"
                  class="w-6 h-6 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                  <svg lucideInfo class="w-3.5 h-3.5"></svg>
                </button>
              }
            </h2>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            @if (packages.length > 0) {
              <button
                type="button"
                (click)="viewAll.emit()"
                class="text-xs font-semibold text-sky-400 hover:text-sky-300 transition px-2.5 py-1 rounded-lg hover:bg-white/5 flex items-center gap-1 cursor-pointer">
                <span>{{ 'carousel.viewAll' | translate }}</span>
                <svg lucideArrowRight class="w-3.5 h-3.5"></svg>
              </button>
            }

            @if (isScrollable()) {
              <div class="hidden sm:flex items-center gap-1.5">
                @if (canScrollLeft()) {
                  <button
                    type="button"
                    (click)="scrollLeft()"
                    [attr.aria-label]="'carousel.scrollLeft' | translate"
                    [appTooltip]="'carousel.scrollLeft' | translate"
                    class="p-1.5 rounded-lg glass-btn text-slate-200 hover:text-white transition hover:scale-105 active:scale-95 cursor-pointer">
                    <svg lucideChevronLeft class="w-4 h-4"></svg>
                  </button>
                }
                @if (canScrollRight()) {
                  <button
                    type="button"
                    (click)="scrollRight()"
                    [attr.aria-label]="'carousel.scrollRight' | translate"
                    [appTooltip]="'carousel.scrollRight' | translate"
                    class="p-1.5 rounded-lg glass-btn text-slate-200 hover:text-white transition hover:scale-105 active:scale-95 cursor-pointer">
                    <svg lucideChevronRight class="w-4 h-4"></svg>
                  </button>
                }
              </div>
            }
          </div>
        </div>

        @if (packages.length > 0) {
          <!-- Scrollable Track with Equal Height Stretch & Hover Breathing Room -->
          <div
            #carouselTrack
            (scroll)="onTrackScroll()"
            (mouseenter)="expandFullRow()"
            (touchstart)="expandFullRow()"
            (focusin)="expandFullRow()"
            tabindex="0"
            role="region"
            [attr.aria-label]="title + ' carousel'"
            class="flex items-stretch gap-4 sm:gap-5 overflow-x-auto px-6 sm:px-10 lg:px-14 py-8 -my-6 no-scrollbar scroll-smooth">
            @for (pkg of renderedPackages; track pkg.id; let first = $first; let last = $last) {
              <div class="flex-shrink-0 flex self-stretch">
                <app-package-card [package]="pkg" [isFirst]="first" [isLast]="last && renderedPackages.length === packages.length" class="flex-shrink-0 w-60 sm:w-68 block"></app-package-card>
              </div>
            }
          </div>
        } @else if (showWhenEmpty) {
          <!-- Promotional Empty-State Callout (e.g. Game Jam Kickoff before 1st submission) -->
          <div class="max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 pt-1">
            <div class="p-5 sm:p-6 rounded-2xl glass-panel border-amber-400/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div class="space-y-1 max-w-2xl">
                <h3 class="text-sm sm:text-base font-bold text-white">
                  {{ emptyStateTitle || ('carousel.promoEmptyTitle' | translate) }}
                </h3>
                <p class="text-xs text-slate-300 leading-relaxed">
                  {{ emptyStateDesc || ('carousel.promoEmptyDesc' | translate) }}
                </p>
              </div>
              @if (promoCtaUrl) {
                <div class="flex items-center gap-2.5 flex-wrap flex-shrink-0">
                  <button
                    type="button"
                    (click)="promoCtaClicked.emit(promoCtaUrl)"
                    class="px-4 py-2.5 rounded-xl glass-btn-amber text-white font-bold text-xs flex items-center gap-2 whitespace-nowrap transition cursor-pointer">
                    <span>{{ promoCtaLabel || ('hero.learnMore' | translate) }}</span>
                    <svg lucideArrowRight class="w-3.5 h-3.5"></svg>
                  </button>
                </div>
              }
            </div>
          </div>
        }

      </section>
    }
  `
})
export class PackageCarouselComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) title!: string;
  @Input() icon?: 'flame' | 'git' | 'zap' | 'gamepad' | 'cpu' | 'palette' | 'trophy' | 'sparkles' | 'star' | 'rocket';
  @Input() infoTooltip?: string;
  @Input() promoBadge?: string;
  @Input() promoCtaLabel?: string;
  @Input() promoCtaUrl?: string;
  @Input() showWhenEmpty = false;
  @Input() emptyStateTitle?: string;
  @Input() emptyStateDesc?: string;
  @Input({ required: true }) packages: LuantiPackage[] = [];
  @Output() viewAll = new EventEmitter<void>();
  @Output() promoCtaClicked = new EventEmitter<string>();

  @ViewChild('carouselTrack') trackRef!: ElementRef<HTMLDivElement>;

  readonly isScrollable = signal<boolean>(false);
  readonly canScrollLeft = signal<boolean>(false);
  readonly canScrollRight = signal<boolean>(false);
  readonly renderedLimit = signal<number>(7);

  get renderedPackages(): LuantiPackage[] {
    const limit = this.renderedLimit();
    return this.packages.length > limit ? this.packages.slice(0, limit) : this.packages;
  }

  expandFullRow(): void {
    if (this.renderedLimit() < this.packages.length) {
      this.renderedLimit.set(Math.max(24, this.packages.length));
      setTimeout(() => this.updateScrollState(), 50);
    }
  }

  private scrollRafId: number | null = null;
  private readonly resizeHandler = () => this.updateScrollState();

  ngAfterViewInit(): void {
    setTimeout(() => this.updateScrollState(), 100);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler, { passive: true });
    }
  }

  ngOnDestroy(): void {
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeHandler);
    }
  }

  ngOnChanges(): void {
    setTimeout(() => this.updateScrollState(), 100);
  }

  onTrackScroll(): void {
    this.expandFullRow();
    if (typeof window !== 'undefined' && window.innerWidth < 640) return;
    if (this.scrollRafId !== null) return;
    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = null;
      this.updateScrollState();
    });
  }

  private updateScrollState(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const hasUnrendered = this.packages.length > this.renderedLimit();
    const scrollable = hasUnrendered || el.scrollWidth > el.clientWidth + 10;
    this.isScrollable.set(scrollable);
    this.canScrollLeft.set(el.scrollLeft > 15);
    this.canScrollRight.set(hasUnrendered || el.scrollLeft < (el.scrollWidth - el.clientWidth - 15));
  }

  scrollLeft(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const distance = Math.max(320, el.clientWidth * 0.7);
    el.scrollBy({ left: -distance, behavior: 'smooth' });
    setTimeout(() => this.updateScrollState(), 350);
  }

  scrollRight(): void {
    this.expandFullRow();
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const distance = Math.max(320, el.clientWidth * 0.7);
    el.scrollBy({ left: distance, behavior: 'smooth' });
    setTimeout(() => this.updateScrollState(), 350);
  }
}

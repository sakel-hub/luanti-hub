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
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideArrowRight,
  LucideFlame,
  LucideZap,
  LucideGamepad2,
  LucideCpu,
  LucidePalette,
  LucideGitBranch,
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
    LucideChevronLeft,
    LucideChevronRight,
    LucideArrowRight,
    LucideFlame,
    LucideZap,
    LucideGamepad2,
    LucideCpu,
    LucidePalette,
    LucideGitBranch,
    LucideInfo
  ],
  template: `
    @if (packages.length > 0) {
      <section class="py-4 space-y-3 select-none overflow-hidden max-w-full">

        <!-- Section Header -->
        <div class="max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            @if (icon === 'flame') {
              <svg lucideFlame class="w-5 h-5 text-amber-500 flex-shrink-0"></svg>
            } @else if (icon === 'git') {
              <svg lucideGitBranch class="w-5 h-5 text-amber-400 flex-shrink-0"></svg>
            } @else if (icon === 'zap') {
              <svg lucideZap class="w-5 h-5 text-amber-400 flex-shrink-0"></svg>
            } @else if (icon === 'gamepad') {
              <svg lucideGamepad2 class="w-5 h-5 text-emerald-400 flex-shrink-0"></svg>
            } @else if (icon === 'cpu') {
              <svg lucideCpu class="w-5 h-5 text-sky-400 flex-shrink-0"></svg>
            } @else if (icon === 'palette') {
              <svg lucidePalette class="w-5 h-5 text-purple-400 flex-shrink-0"></svg>
            }
            <h2 class="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span>{{ title }}</span>
              <span class="text-xs font-medium text-slate-500">({{ packages.length }})</span>
              @if (infoTooltip) {
                <button
                  type="button"
                  (click)="$event.stopPropagation()"
                  [appTooltip]="infoTooltip"
                  [appTooltipMultiline]="true"
                  appTooltipPlacement="top"
                  [attr.aria-label]="'How ' + title + ' is built'"
                  class="w-5 h-5 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                  <svg lucideInfo class="w-3 h-3"></svg>
                </button>
              }
            </h2>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="viewAll.emit()"
              class="text-xs font-semibold text-sky-400 hover:text-sky-300 transition px-2.5 py-1 rounded-lg hover:bg-white/5 flex items-center gap-1 cursor-pointer">
              <span>{{ 'carousel.viewAll' | translate }}</span>
              <svg lucideArrowRight class="w-3.5 h-3.5"></svg>
            </button>

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

        <!-- Scrollable Track with Equal Height Stretch & Hover Breathing Room -->
        <div
          #carouselTrack
          (scroll)="onTrackScroll()"
          tabindex="0"
          role="region"
          [attr.aria-label]="title + ' carousel'"
          class="flex items-stretch gap-4 sm:gap-5 overflow-x-auto px-6 sm:px-10 lg:px-14 py-8 -my-6 no-scrollbar scroll-smooth">
          @for (pkg of packages; track pkg.id; let first = $first; let last = $last) {
            <div class="flex-shrink-0 flex self-stretch">
              <app-package-card [package]="pkg" [isFirst]="first" [isLast]="last" class="flex-shrink-0 w-60 sm:w-68 block"></app-package-card>
            </div>
          }
        </div>

      </section>
    }
  `
})
export class PackageCarouselComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) title!: string;
  @Input() icon?: 'flame' | 'git' | 'zap' | 'gamepad' | 'cpu' | 'palette';
  @Input() infoTooltip?: string;
  @Input({ required: true }) packages: LuantiPackage[] = [];
  @Output() viewAll = new EventEmitter<void>();

  @ViewChild('carouselTrack') trackRef!: ElementRef<HTMLDivElement>;

  readonly isScrollable = signal<boolean>(false);
  readonly canScrollLeft = signal<boolean>(false);
  readonly canScrollRight = signal<boolean>(false);

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

  ngOnChanges(): void {
    setTimeout(() => this.updateScrollState(), 100);
  }

  onTrackScroll(): void {
    this.updateScrollState();
  }

  private updateScrollState(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const scrollable = el.scrollWidth > el.clientWidth + 10;
    this.isScrollable.set(scrollable);
    this.canScrollLeft.set(el.scrollLeft > 15);
    this.canScrollRight.set(el.scrollLeft < (el.scrollWidth - el.clientWidth - 15));
  }

  scrollLeft(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const distance = Math.max(320, el.clientWidth * 0.7);
    el.scrollBy({ left: -distance, behavior: 'smooth' });
    setTimeout(() => this.updateScrollState(), 350);
  }

  scrollRight(): void {
    if (!this.trackRef?.nativeElement) return;
    const el = this.trackRef.nativeElement;
    const distance = Math.max(320, el.clientWidth * 0.7);
    el.scrollBy({ left: distance, behavior: 'smooth' });
    setTimeout(() => this.updateScrollState(), 350);
  }
}

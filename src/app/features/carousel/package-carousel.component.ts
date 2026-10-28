import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnChanges,
  signal,
  NgZone,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageCardComponent } from '../card/package-card.component';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideFlame,
  LucideZap,
  LucideGamepad2,
  LucideCpu,
  LucidePalette,
  LucideGitBranch
} from '@lucide/angular';

@Component({
  selector: 'app-package-carousel',
  standalone: true,
  imports: [
    CommonModule,
    PackageCardComponent,
    TooltipDirective,
    TranslatePipe,
    LucideChevronLeft,
    LucideChevronRight,
    LucideFlame,
    LucideZap,
    LucideGamepad2,
    LucideCpu,
    LucidePalette,
    LucideGitBranch
  ],
  template: `
    @if (packages.length > 0) {
      <section class="py-4 space-y-3 select-none">
        
        <!-- Section Header -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div class="flex items-center gap-2">
            @if (icon === 'flame') {
              <svg lucideFlame class="w-5 h-5 text-amber-500"></svg>
            } @else if (icon === 'git') {
              <svg lucideGitBranch class="w-5 h-5 text-amber-400"></svg>
            } @else if (icon === 'zap') {
              <svg lucideZap class="w-5 h-5 text-amber-400"></svg>
            } @else if (icon === 'gamepad') {
              <svg lucideGamepad2 class="w-5 h-5 text-emerald-400"></svg>
            } @else if (icon === 'cpu') {
              <svg lucideCpu class="w-5 h-5 text-sky-400"></svg>
            } @else if (icon === 'palette') {
              <svg lucidePalette class="w-5 h-5 text-purple-400"></svg>
            }
            <h2 class="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              <span>{{ title }}</span>
              <span class="text-xs font-medium text-slate-500">({{ packages.length }})</span>
            </h2>
          </div>

          <!-- Scroll Arrows (Only Rendered if Content is Scrollable) -->
          @if (isScrollable()) {
            <div class="hidden sm:flex items-center gap-1.5">
              @if (canScrollLeft()) {
                <button 
                  (click)="scrollLeft()"
                  [attr.aria-label]="'carousel.scrollLeft' | translate"
                  [appTooltip]="'carousel.scrollLeft' | translate"
                  class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition shadow hover:scale-105 active:scale-95">
                  <svg lucideChevronLeft class="w-4 h-4"></svg>
                </button>
              }
              @if (canScrollRight()) {
                <button 
                  (click)="scrollRight()"
                  [attr.aria-label]="'carousel.scrollRight' | translate"
                  [appTooltip]="'carousel.scrollRight' | translate"
                  class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition shadow hover:scale-105 active:scale-95">
                  <svg lucideChevronRight class="w-4 h-4"></svg>
                </button>
              }
            </div>
          }
        </div>

        <!-- Scrollable Track with Hover Expansion Breathing Room (Zero Snap Lock Jank) -->
        <div 
          #carouselTrack
          (scroll)="onTrackScroll()"
          tabindex="0"
          role="region"
          [attr.aria-label]="title + ' carousel'"
          class="flex items-center gap-4 sm:gap-5 overflow-x-auto px-6 sm:px-10 lg:px-14 py-8 -my-6 no-scrollbar scroll-smooth">
          @for (pkg of packages; track pkg.id; let first = $first; let last = $last) {
            <div class="flex-shrink-0">
              <app-package-card [package]="pkg" [isFirst]="first" [isLast]="last"></app-package-card>
            </div>
          }
        </div>

      </section>
    }
  `
})
export class PackageCarouselComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) title!: string;
  @Input() icon?: 'flame' | 'git' | 'zap' | 'gamepad' | 'cpu' | 'palette';
  @Input({ required: true }) packages: LuantiPackage[] = [];

  @ViewChild('carouselTrack') trackRef!: ElementRef<HTMLDivElement>;

  private readonly ngZone = inject(NgZone);

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

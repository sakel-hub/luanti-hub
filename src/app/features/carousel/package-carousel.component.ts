import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageCardComponent } from '../card/package-card.component';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';

@Component({
  selector: 'app-package-carousel',
  standalone: true,
  imports: [
    CommonModule,
    PackageCardComponent,
    TooltipDirective,
    TranslatePipe,
    LucideChevronLeft,
    LucideChevronRight
  ],
  template: `
    @if (packages.length > 0) {
      <section class="py-4 space-y-3 select-none">
        
        <!-- Section Header -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div class="flex items-center gap-2">
            @if (icon) {
              <span class="text-lg">{{ icon }}</span>
            }
            <h2 class="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              {{ title }}
              <span class="text-xs font-medium text-slate-500">({{ packages.length }})</span>
            </h2>
          </div>

          <!-- Scroll Arrows with Lucide Icons -->
          <div class="hidden sm:flex items-center gap-1.5">
            <button 
              (click)="scrollLeft()"
              [attr.aria-label]="'carousel.scrollLeft' | translate"
              [appTooltip]="'carousel.scrollLeft' | translate"
              class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition">
              <svg lucideChevronLeft class="w-4 h-4"></svg>
            </button>
            <button 
              (click)="scrollRight()"
              [attr.aria-label]="'carousel.scrollRight' | translate"
              [appTooltip]="'carousel.scrollRight' | translate"
              class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition">
              <svg lucideChevronRight class="w-4 h-4"></svg>
            </button>
          </div>
        </div>

        <!-- Scrollable Track -->
        <div 
          #carouselTrack
          tabindex="0"
          role="region"
          [attr.aria-label]="title + ' carousel'"
          class="flex items-center gap-4 overflow-x-auto snap-x snap-mandatory px-4 sm:px-6 lg:px-8 py-2 no-scrollbar scroll-smooth">
          @for (pkg of packages; track pkg.id) {
            <div class="snap-start">
              <app-package-card [package]="pkg"></app-package-card>
            </div>
          }
        </div>

      </section>
    }
  `
})
export class PackageCarouselComponent {
  @Input({ required: true }) title!: string;
  @Input() icon?: string;
  @Input({ required: true }) packages: LuantiPackage[] = [];

  @ViewChild('carouselTrack') trackRef!: ElementRef<HTMLDivElement>;

  scrollLeft(): void {
    if (!this.trackRef?.nativeElement) return;
    this.trackRef.nativeElement.scrollBy({ left: -640, behavior: 'smooth' });
  }

  scrollRight(): void {
    if (!this.trackRef?.nativeElement) return;
    this.trackRef.nativeElement.scrollBy({ left: 640, behavior: 'smooth' });
  }
}

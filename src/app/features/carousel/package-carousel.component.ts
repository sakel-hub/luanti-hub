import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageCardComponent } from '../card/package-card.component';

@Component({
  selector: 'app-package-carousel',
  standalone: true,
  imports: [CommonModule, PackageCardComponent],
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

          <!-- Scroll Arrows -->
          <div class="hidden sm:flex items-center gap-1.5">
            <button 
              (click)="scrollLeft()"
              aria-label="Scroll left"
              class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
            <button 
              (click)="scrollRight()"
              aria-label="Scroll right"
              class="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
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
    if (this.trackRef) {
      this.trackRef.nativeElement.scrollBy({ left: -400, behavior: 'smooth' });
    }
  }

  scrollRight(): void {
    if (this.trackRef) {
      this.trackRef.nativeElement.scrollBy({ left: 400, behavior: 'smooth' });
    }
  }
}

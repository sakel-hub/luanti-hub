import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeroBillboardComponent } from '../hero/hero-billboard.component';
import { PackageCarouselComponent } from '../carousel/package-carousel.component';
import { PackageCardComponent } from '../card/package-card.component';
import { Top10RowComponent } from '../top10/top10-row.component';
import { PackageService } from '../../core/services/package.service';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LucideSearchX } from '@lucide/angular';

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [
    CommonModule,
    HeroBillboardComponent,
    PackageCarouselComponent,
    PackageCardComponent,
    Top10RowComponent,
    TooltipDirective,
    TranslatePipe,
    LucideSearchX
  ],
  template: `
    @if (packageService.searchQuery()) {
      <!-- Active Search Grid View -->
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-in fade-in duration-200">
        <div class="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h1 class="text-xl font-bold text-white flex items-center gap-2">
              <span>Results for "{{ packageService.searchQuery() }}"</span>
              <span class="text-xs font-normal text-slate-400">
                ({{ 'common.resultsCount' | translate: { count: packageService.filteredPackages().length } }})
              </span>
            </h1>
            <p class="text-xs text-slate-400">Showing packages across ContentDB and Git community</p>
          </div>

          <button 
            (click)="packageService.setSearchQuery('')"
            class="text-xs text-sky-400 hover:text-sky-300 font-medium">
            Clear Search
          </button>
        </div>

        @if (packageService.filteredPackages().length === 0) {
          <div class="py-16 text-center space-y-3">
            <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
              <svg lucideSearchX class="w-6 h-6"></svg>
            </div>
            <h3 class="text-sm font-semibold text-slate-300">{{ 'common.noResults' | translate }}</h3>
            <p class="text-xs text-slate-500 max-w-sm mx-auto">
              {{ 'common.noResultsDesc' | translate }}
            </p>
            <button 
              (click)="packageService.openSubmitModal()"
              [appTooltip]="'header.submitRepoTooltip' | translate"
              class="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow transition">
              {{ 'header.submitRepo' | translate }}
            </button>
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            @for (pkg of packageService.filteredPackages(); track pkg.id) {
              <div class="flex justify-center">
                <app-package-card [package]="pkg" class="w-full"></app-package-card>
              </div>
            }
          </div>
        }
      </div>

    } @else {
      <!-- Netflix Home Experience (Billboard + Horizontal Swimlanes) -->
      <app-hero-billboard></app-hero-billboard>

      <div class="relative z-20 -mt-10 sm:-mt-14 space-y-6">
        
        <!-- Swimlane 1: Trending Today -->
        <app-package-carousel 
          icon="flame"
          [title]="'carousel.trending' | translate" 
          [packages]="packageService.trendingPackages()">
        </app-package-carousel>

        <!-- Netflix Featured: Top 10 Packages Row (Today / This Week Toggle) -->
        <app-top10-row></app-top10-row>

        <!-- Swimlane 2: Decentralized Git Community Packages -->
        <app-package-carousel 
          icon="git"
          [title]="'carousel.freshGit' | translate" 
          [packages]="packageService.decentralizedGitPackages()">
        </app-package-carousel>

        <!-- Swimlane 3: Standalone Voxel Games -->
        <app-package-carousel 
          icon="gamepad"
          [title]="'carousel.standaloneGames' | translate" 
          [packages]="packageService.standaloneGames()">
        </app-package-carousel>

        <!-- Swimlane 4: High-Tech Automation & Machinery -->
        <app-package-carousel 
          icon="cpu"
          [title]="'carousel.automation' | translate" 
          [packages]="packageService.automationMods()">
        </app-package-carousel>

        <!-- Swimlane 5: High-Definition Texture Packs -->
        <app-package-carousel 
          icon="palette"
          [title]="'carousel.texturePacks' | translate" 
          [packages]="packageService.texturePacks()">
        </app-package-carousel>

      </div>
    }
  `
})
export class CatalogComponent {
  readonly packageService = inject(PackageService);
}

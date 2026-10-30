import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HeroBillboardComponent } from '../hero/hero-billboard.component';
import { PackageCarouselComponent } from '../carousel/package-carousel.component';
import { PackageCardComponent } from '../card/package-card.component';
import { Top10RowComponent } from '../top10/top10-row.component';
import { PackageService } from '../../core/services/package.service';
import { SortOption } from '../../core/models/package.model';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideSearchX,
  LucideX,
  LucideSlidersHorizontal,
  LucideChevronDown,
  LucideChevronUp,
  LucideTag,
  LucideGitBranch,
  LucidePlus,
  LucideInfo
} from '@lucide/angular';

@Component({
  selector: 'app-catalog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    HeroBillboardComponent,
    PackageCarouselComponent,
    PackageCardComponent,
    Top10RowComponent,
    TooltipDirective,
    TranslatePipe,
    LucideSearchX,
    LucideX,
    LucideSlidersHorizontal,
    LucideChevronDown,
    LucideChevronUp,
    LucideTag,
    LucideGitBranch,
    LucidePlus,
    LucideInfo
  ],
  template: `
    @if (packageService.isLoading() && packageService.packages().length === 0) {
      <!-- Initial Page Load Skeleton Preloader (Hero + Tags + Swimlane Tiles) -->
      @if (!packageService.hasActiveFilters()) {
        <app-hero-billboard></app-hero-billboard>

        <!-- Skeleton Tags Bar -->
        <div class="max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 mt-5">
          <div class="flex items-center gap-2 flex-wrap py-1">
            @for (pill of [1, 2, 3, 4, 5, 6, 7, 8, 9]; track pill) {
              <div class="h-7 w-24 rounded-full skeleton-shimmer border border-white/10"></div>
            }
          </div>
        </div>

        <!-- Skeleton Swimlanes & Package Tiles -->
        <div class="relative z-10 mt-6 sm:mt-8 space-y-10 pb-16" aria-busy="true">
          @for (lane of [1, 2, 3]; track lane) {
            <section class="max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-7 h-7 rounded-lg skeleton-shimmer"></div>
                  <div class="h-6 w-48 rounded-lg skeleton-shimmer"></div>
                </div>
                <div class="h-7 w-24 rounded-lg skeleton-shimmer"></div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                @for (tile of [1, 2, 3, 4]; track tile) {
                  <div class="h-[344px] w-full rounded-2xl glass-card overflow-hidden flex flex-col">
                    <div class="h-40 w-full skeleton-shimmer relative">
                      <div class="absolute top-2.5 right-2.5 h-5 w-12 rounded-full bg-slate-800/80"></div>
                    </div>
                    <div class="p-3.5 flex-1 flex flex-col justify-between">
                      <div class="space-y-2.5">
                        <div class="flex items-center gap-2">
                          <div class="w-8 h-8 rounded-full skeleton-shimmer"></div>
                          <div class="w-8 h-8 rounded-full skeleton-shimmer"></div>
                          <div class="w-8 h-8 rounded-full skeleton-shimmer ml-auto"></div>
                        </div>
                        <div class="flex items-center gap-2">
                          <div class="h-3.5 w-20 rounded skeleton-shimmer"></div>
                          <div class="h-3.5 w-14 rounded skeleton-shimmer"></div>
                        </div>
                        <div class="h-4 w-3/4 rounded skeleton-shimmer"></div>
                        <div class="space-y-1.5">
                          <div class="h-3 w-full rounded skeleton-shimmer"></div>
                          <div class="h-3 w-4/5 rounded skeleton-shimmer"></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 pt-2">
                        <div class="h-3 w-16 rounded skeleton-shimmer"></div>
                        <div class="h-3 w-14 rounded skeleton-shimmer"></div>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </section>
          }
        </div>
      } @else {
        <!-- Skeleton Filtered Grid View -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6" aria-busy="true">
          <div class="flex items-center gap-2 flex-wrap">
            @for (pill of [1, 2, 3, 4, 5, 6, 7, 8]; track pill) {
              <div class="h-7 w-24 rounded-full skeleton-shimmer border border-white/10"></div>
            }
          </div>
          <div class="flex items-center justify-between border-b border-white/10 pb-4">
            <div class="space-y-2">
              <div class="h-6 w-56 rounded-lg skeleton-shimmer"></div>
              <div class="h-3.5 w-72 rounded skeleton-shimmer"></div>
            </div>
            <div class="h-8 w-36 rounded-xl skeleton-shimmer"></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            @for (tile of [1, 2, 3, 4, 5, 6, 7, 8]; track tile) {
              <div class="h-[344px] w-full rounded-2xl glass-card overflow-hidden flex flex-col">
                <div class="h-40 w-full skeleton-shimmer"></div>
                <div class="p-3.5 flex-1 flex flex-col justify-between">
                  <div class="space-y-2.5">
                    <div class="flex items-center gap-2">
                      <div class="w-8 h-8 rounded-full skeleton-shimmer"></div>
                      <div class="w-8 h-8 rounded-full skeleton-shimmer"></div>
                      <div class="w-8 h-8 rounded-full skeleton-shimmer ml-auto"></div>
                    </div>
                    <div class="h-3.5 w-24 rounded skeleton-shimmer"></div>
                    <div class="h-4 w-3/4 rounded skeleton-shimmer"></div>
                    <div class="space-y-1.5">
                      <div class="h-3 w-full rounded skeleton-shimmer"></div>
                      <div class="h-3 w-4/5 rounded skeleton-shimmer"></div>
                    </div>
                  </div>
                  <div class="h-3 w-28 rounded skeleton-shimmer"></div>
                </div>
              </div>
            }
          </div>
        </div>
      }
    } @else if (packageService.hasActiveFilters()) {
      <!-- Active Search / Filtered Grid View (Paginated for 60fps Performance) -->
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-in fade-in duration-200">

        <!-- Curated ContentDB & Custom Git Tags Filter Bar + Expandable Drawer -->
        <div class="space-y-2.5">
          <div class="flex items-center gap-2 flex-wrap">
            <div class="flex items-center gap-1.5 text-xs font-bold text-slate-400 pr-1 flex-shrink-0">
              <svg lucideTag class="w-3.5 h-3.5 text-sky-400"></svg>
              <span>{{ 'catalog.filterByTag' | translate }}</span>
            </div>
            <button
              type="button"
              (click)="packageService.setTagFilter('all')"
              [class]="packageService.selectedTag() === 'all' ? 'bg-sky-500/25 text-sky-300 border-sky-400/40' : 'glass-pill text-slate-300 hover:text-white'"
              class="px-3 py-1 rounded-full border text-xs font-semibold transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              {{ 'catalog.allTags' | translate }}
            </button>
            @for (tag of primaryTags(); track tag.name) {
              <button
                type="button"
                (click)="packageService.setTagFilter(tag.name)"
                [class]="packageService.selectedTag().toLowerCase() === tag.name.toLowerCase() ? 'bg-sky-500/25 text-sky-300 border-sky-400/40 shadow-sm' : 'glass-pill text-slate-300 hover:text-white'"
                class="px-3 py-1 rounded-full border text-xs font-medium transition whitespace-nowrap flex-shrink-0 cursor-pointer">
                #{{ tag.title }}
              </button>
            }
            @if (extraTags().length > 0) {
              <button
                type="button"
                (click)="toggleTagsDrawer()"
                [class]="isTagsExpanded() ? 'bg-sky-500/20 text-sky-300 border-sky-400/40' : 'glass-pill text-sky-400 hover:text-sky-300'"
                class="px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-1 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
                @if (isTagsExpanded()) {
                  <span>{{ 'catalog.lessTags' | translate }}</span>
                  <svg lucideChevronUp class="w-3.5 h-3.5"></svg>
                } @else {
                  <span>{{ 'catalog.moreTags' | translate: { count: extraTags().length } }}</span>
                  <svg lucideChevronDown class="w-3.5 h-3.5"></svg>
                }
              </button>
            }
          </div>

          @if (isTagsExpanded() && extraTags().length > 0) {
            <div class="p-3.5 rounded-2xl glass-panel flex items-center gap-1.5 flex-wrap animate-in fade-in duration-150">
              @for (tag of extraTags(); track tag.name) {
                <button
                  type="button"
                  (click)="packageService.setTagFilter(tag.name)"
                  [class]="packageService.selectedTag().toLowerCase() === tag.name.toLowerCase() ? 'bg-sky-500/25 text-sky-300 border-sky-400/40 shadow-sm' : 'glass-pill text-slate-300 hover:text-white'"
                  class="px-2.5 py-1 rounded-full border text-xs font-medium transition whitespace-nowrap cursor-pointer">
                  #{{ tag.title }}
                </button>
              }
            </div>
          }
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div class="space-y-1">
            <h2 class="text-lg sm:text-xl font-bold text-white flex items-center gap-2 flex-wrap">
              @if (packageService.searchQuery()) {
                <span>{{ 'catalog.resultsFor' | translate: { query: packageService.searchQuery() } }}</span>
              } @else {
                <span>{{ 'catalog.filteredTitle' | translate }}</span>
              }
              <span class="text-xs font-normal text-slate-400">
                ({{ 'common.resultsCount' | translate: { count: packageService.filteredPackages().length } }})
              </span>
            </h2>
            <p class="text-xs text-slate-400">{{ 'catalog.resultsSubtitle' | translate }}</p>
          </div>

          <!-- Sort Selector & Clear Filters -->
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex items-center gap-2 glass-panel rounded-xl px-3 py-1.5 text-xs">
              <svg lucideSlidersHorizontal class="w-3.5 h-3.5 text-sky-400"></svg>
              <span class="text-slate-400 font-medium">{{ 'catalog.sortBy' | translate }}:</span>
              <select
                [ngModel]="packageService.sortBy()"
                (ngModelChange)="onSortChange($event)"
                aria-label="Sort packages"
                class="bg-transparent text-white font-bold focus:outline-none cursor-pointer">
                <option value="downloads" class="bg-slate-900 text-white">{{ 'catalog.sortDownloads' | translate }}</option>
                <option value="score" class="bg-slate-900 text-white">{{ 'catalog.sortScore' | translate }}</option>
                <option value="updated" class="bg-slate-900 text-white">{{ 'catalog.sortUpdated' | translate }}</option>
                <option value="title" class="bg-slate-900 text-white">{{ 'catalog.sortTitle' | translate }}</option>
              </select>
            </div>

            <button
              type="button"
              (click)="packageService.resetFilters()"
              class="px-3 py-1.5 rounded-xl glass-btn text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1.5 transition cursor-pointer">
              <svg lucideX class="w-3.5 h-3.5"></svg>
              <span>{{ 'catalog.resetFilters' | translate }}</span>
            </button>
          </div>
        </div>

        @if (packageService.filteredPackages().length === 0) {
          <div class="py-16 text-center space-y-3">
            <div class="w-12 h-12 rounded-2xl glass-panel flex items-center justify-center mx-auto text-slate-400">
              <svg lucideSearchX class="w-6 h-6"></svg>
            </div>
            <h3 class="text-sm font-semibold text-slate-300">{{ 'common.noResults' | translate }}</h3>
            <p class="text-xs text-slate-500 max-w-sm mx-auto">
              {{ 'common.noResultsDesc' | translate }}
            </p>
            <div class="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                (click)="packageService.resetFilters()"
                class="px-4 py-2 rounded-xl glass-btn text-slate-200 font-bold text-xs transition cursor-pointer">
                {{ 'catalog.resetFilters' | translate }}
              </button>
              <button
                type="button"
                (click)="packageService.openSubmitModal()"
                [appTooltip]="'header.submitRepoTooltip' | translate"
                class="px-4 py-2 rounded-xl glass-btn-sky text-white font-bold text-xs transition cursor-pointer">
                {{ 'header.submitRepo' | translate }}
              </button>
            </div>
          </div>
        } @else {
          <!-- Equalized Height Fluid Responsive Grid (Mobile-First: 1 col mobile, 2 cols tablet, 3 cols iPad Pro/laptop, 4-5 cols desktop) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5 sm:gap-6 items-stretch">
            @for (pkg of packageService.visiblePackages(); track pkg.id) {
              <div class="flex justify-center self-stretch w-full min-w-0">
                <app-package-card [package]="pkg" class="w-full flex justify-center h-full min-w-0"></app-package-card>
              </div>
            }
          </div>

          <!-- Pagination Footer ("Load More") -->
          <div class="pt-6 flex flex-col items-center gap-3">
            <p class="text-xs text-slate-400">
              {{ 'catalog.showingCount' | translate: { visible: packageService.visiblePackages().length, shown: packageService.visiblePackages().length, total: packageService.filteredPackages().length } }}
            </p>
            @if (packageService.hasMorePackages()) {
              <button
                type="button"
                (click)="packageService.loadMore()"
                class="px-6 py-2.5 rounded-xl glass-btn text-white font-bold text-xs flex items-center gap-2 transition hover:scale-105 cursor-pointer">
                <span>{{ 'catalog.loadMore' | translate }}</span>
                <svg lucideChevronDown class="w-4 h-4 text-sky-400"></svg>
              </button>
            }
          </div>
        }
      </div>

    } @else {
      <!-- Netflix Home Experience (Billboard + ContentDB Tags Bar + Capped 24-Item Horizontal Swimlanes) -->
      <app-hero-billboard></app-hero-billboard>

      <!-- ContentDB & Custom Git Tags Quick-Filter Bar + Expandable Drawer -->
      <div class="relative z-10 max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 mt-5 space-y-2.5">
        <div class="flex items-center gap-2 flex-wrap py-1">
          <div class="flex items-center gap-1.5 text-xs font-bold text-slate-400 pr-1 flex-shrink-0">
            <svg lucideTag class="w-3.5 h-3.5 text-sky-400"></svg>
            <span>{{ 'catalog.filterByTag' | translate }}</span>
            <button
              type="button"
              (click)="$event.stopPropagation()"
              [appTooltip]="'carousel.infoTags' | translate"
              [appTooltipMultiline]="true"
              appTooltipPlacement="top"
              aria-label="How tags are curated"
              class="w-4 h-4 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
              <svg lucideInfo class="w-2.5 h-2.5"></svg>
            </button>
          </div>
          @for (tag of primaryTags(); track tag.name) {
            <button
              type="button"
              (click)="packageService.setTagFilter(tag.name)"
              class="px-3 py-1 rounded-full glass-pill hover:border-sky-400/40 text-slate-300 hover:text-white text-xs font-medium transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              #{{ tag.title }}
            </button>
          }
          @if (extraTags().length > 0) {
            <button
              type="button"
              (click)="toggleTagsDrawer()"
              [class]="isTagsExpanded() ? 'bg-sky-500/20 text-sky-300 border-sky-400/40' : 'glass-pill text-sky-400 hover:text-sky-300'"
              class="px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-1 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              @if (isTagsExpanded()) {
                <span>Less</span>
                <svg lucideChevronUp class="w-3.5 h-3.5"></svg>
              } @else {
                <span>+{{ extraTags().length }} More</span>
                <svg lucideChevronDown class="w-3.5 h-3.5"></svg>
              }
            </button>
          }
        </div>

        @if (isTagsExpanded() && extraTags().length > 0) {
          <div class="p-3.5 rounded-2xl glass-panel flex items-center gap-1.5 flex-wrap animate-in fade-in duration-150">
            @for (tag of extraTags(); track tag.name) {
              <button
                type="button"
                (click)="packageService.setTagFilter(tag.name)"
                class="px-2.5 py-1 rounded-full glass-pill hover:border-sky-400/40 text-slate-300 hover:text-white text-xs font-medium transition whitespace-nowrap cursor-pointer">
                #{{ tag.title }}
              </button>
            }
          </div>
        }
      </div>

      <div class="relative z-10 mt-6 sm:mt-8 space-y-8 sm:space-y-10 pb-16">

        <!-- Swimlane 1: Trending Engine Mods -->
        <app-package-carousel
          class="luanti-swimlane-row block"
          icon="flame"
          [title]="'carousel.trending' | translate"
          [infoTooltip]="'carousel.infoTrending' | translate"
          [packages]="packageService.trendingPackages()"
          (viewAll)="packageService.selectPrimaryNavTab('mod')">
        </app-package-carousel>

        <!-- Netflix Featured Row 1: Top 10 Packages (Today) -->
        <app-top10-row class="luanti-swimlane-row block" timeframe="today"></app-top10-row>

        <!-- Swimlane 2: Standalone Voxel Games -->
        <app-package-carousel
          class="luanti-swimlane-row block"
          icon="gamepad"
          [title]="'carousel.standaloneGames' | translate"
          [infoTooltip]="'carousel.infoGames' | translate"
          [packages]="packageService.standaloneGames()"
          (viewAll)="packageService.selectPrimaryNavTab('game')">
        </app-package-carousel>

        <!-- Swimlane 3: Community Git Packages (Only shows real Git Community submissions, or a clean CTA when none submitted yet) -->
        @if (packageService.decentralizedGitPackages().length > 0) {
          <app-package-carousel
            class="luanti-swimlane-row block"
            icon="git"
            [title]="'carousel.freshGit' | translate"
            [infoTooltip]="'carousel.infoGit' | translate"
            [packages]="packageService.decentralizedGitPackages()"
            (viewAll)="packageService.selectPrimaryNavTab('git')">
          </app-package-carousel>
        } @else {
          <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 luanti-swimlane-row block">
            <div class="p-5 sm:p-6 rounded-2xl glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div class="flex items-start sm:items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400 flex-shrink-0">
                  <svg lucideGitBranch class="w-5 h-5"></svg>
                </div>
                <div class="space-y-0.5">
                  <h2 class="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                    <span>{{ 'carousel.freshGit' | translate }}</span>
                    <button
                      type="button"
                      (click)="$event.stopPropagation()"
                      [appTooltip]="'carousel.infoGit' | translate"
                      [appTooltipMultiline]="true"
                      appTooltipPlacement="top"
                      aria-label="How Git Community Releases are built"
                      class="w-5 h-5 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                      <svg lucideInfo class="w-3 h-3"></svg>
                    </button>
                  </h2>
                  <p class="text-xs text-slate-400">
                    {{ 'catalog.emptyGitDesc' | translate }}
                  </p>
                </div>
              </div>
              <button
                type="button"
                (click)="packageService.openSubmitModal()"
                class="px-4 py-2.5 rounded-xl glass-btn-sky text-white font-bold text-xs flex items-center gap-2 whitespace-nowrap self-start sm:self-auto transition cursor-pointer">
                <svg lucidePlus class="w-4 h-4 text-amber-400"></svg>
                <span>{{ 'header.submitRepo' | translate }}</span>
              </button>
            </div>
          </section>
        }

        <!-- Swimlane 4: High-Tech Automation & Machinery (Interleaved before Top 10 This Week) -->
        <app-package-carousel
          class="luanti-swimlane-row block"
          icon="cpu"
          [title]="'carousel.automation' | translate"
          [infoTooltip]="'carousel.infoAutomation' | translate"
          [packages]="packageService.automationMods()"
          (viewAll)="packageService.setTagFilter('technology')">
        </app-package-carousel>

        <!-- Netflix Featured Row 2: Top 10 Packages (This Week) -->
        <app-top10-row class="luanti-swimlane-row block" timeframe="week"></app-top10-row>

        <!-- Swimlane 5: High-Definition Texture Packs -->
        <app-package-carousel
          class="luanti-swimlane-row block"
          icon="palette"
          [title]="'carousel.texturePacks' | translate"
          [infoTooltip]="'carousel.infoTextures' | translate"
          [packages]="packageService.texturePacks()"
          (viewAll)="packageService.selectPrimaryNavTab('txp')">
        </app-package-carousel>

      </div>
    }
  `
})
export class CatalogComponent {
  readonly packageService = inject(PackageService);
  readonly isTagsExpanded = signal(false);

  private readonly PRIMARY_TAG_LIMIT = 8;

  readonly primaryTags = computed(() => {
    const all = this.packageService.availableTags();
    const top = all.slice(0, this.PRIMARY_TAG_LIMIT);
    const active = this.packageService.selectedTag().toLowerCase();
    if (active !== 'all' && !top.some(t => t.name.toLowerCase() === active)) {
      const activeObj = all.find(t => t.name.toLowerCase() === active);
      if (activeObj) {
        return [...top.slice(0, this.PRIMARY_TAG_LIMIT - 1), activeObj];
      }
    }
    return top;
  });

  readonly extraTags = computed(() => {
    const primaryNames = new Set(this.primaryTags().map(t => t.name.toLowerCase()));
    return this.packageService.availableTags().filter(t => !primaryNames.has(t.name.toLowerCase()));
  });

  toggleTagsDrawer(): void {
    this.isTagsExpanded.update(v => !v);
  }

  onSortChange(sort: SortOption): void {
    this.packageService.setSortBy(sort);
  }
}

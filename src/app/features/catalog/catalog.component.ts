import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HeroBillboardComponent } from '../hero/hero-billboard.component';
import { PackageCarouselComponent } from '../carousel/package-carousel.component';
import { PackageCardComponent } from '../card/package-card.component';
import { Top10RowComponent } from '../top10/top10-row.component';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { SortOption } from '../../core/models/package.model';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ORGANIC_CODE_TAG } from '../../core/config/package-utils.config';
import {
  LucideSearchX,
  LucideX,
  LucideSlidersHorizontal,
  LucideChevronDown,
  LucideChevronUp,
  LucideTag,
  LucideGitBranch,
  LucidePlus,
  LucideInfo,
  LucideLeaf
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
    LucideInfo,
    LucideLeaf
  ],
  template: `
    @if (!packageService.hasActiveFilters()) {
      <app-hero-billboard></app-hero-billboard>
    }

    @if (packageService.isLoading() && packageService.packages().length === 0) {
      <!-- Initial Page Load Skeleton Preloader (Hero + Tags + Swimlane Tiles) -->
      @if (!packageService.hasActiveFilters()) {
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
                [appTooltip]="isOrganicCodeTag(tag.name) ? ('card.organicCodeTooltip' | translate) : ('modal.filterByTagTooltip' | translate:{ tag: tag.title })"
                [class]="packageService.selectedTag().toLowerCase() === tag.name.toLowerCase() ? (isOrganicCodeTag(tag.name) ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/50 shadow-sm' : 'bg-sky-500/25 text-sky-300 border-sky-400/40 shadow-sm') : 'glass-pill text-slate-300 hover:text-white'"
                class="px-3 py-1 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
                @if (isOrganicCodeTag(tag.name)) {
                  <svg lucideLeaf class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"></svg>
                  <span>#{{ 'card.organicCodeLabel' | translate }}</span>
                } @else {
                  <span>#{{ tag.title }}</span>
                }
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
                  [appTooltip]="isOrganicCodeTag(tag.name) ? ('card.organicCodeTooltip' | translate) : ('modal.filterByTagTooltip' | translate:{ tag: tag.title })"
                  [class]="packageService.selectedTag().toLowerCase() === tag.name.toLowerCase() ? (isOrganicCodeTag(tag.name) ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/50 shadow-sm' : 'bg-sky-500/25 text-sky-300 border-sky-400/40 shadow-sm') : 'glass-pill text-slate-300 hover:text-white'"
                  class="px-2.5 py-1 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer">
                  @if (isOrganicCodeTag(tag.name)) {
                    <svg lucideLeaf class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"></svg>
                    <span>#{{ 'card.organicCodeLabel' | translate }}</span>
                  } @else {
                    <span>#{{ tag.title }}</span>
                  }
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

          <!-- Game Ecosystem Filter, Sort Selector & Clear Filters -->
          <div class="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              (click)="settingsService.hideWipDeprecated.set(!settingsService.hideWipDeprecated())"
              [class]="settingsService.hideWipDeprecated() ? 'px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-200 text-xs font-bold transition cursor-pointer' : 'px-3 py-1.5 rounded-xl glass-panel text-slate-400 hover:text-white text-xs font-medium transition cursor-pointer'"
              title="Hide Work-in-Progress & Deprecated packages">
              Hide WIP/Deprecated
            </button>

            <button
              type="button"
              (click)="settingsService.hideContentWarnings.set(!settingsService.hideContentWarnings())"
              [class]="settingsService.hideContentWarnings() ? 'px-3 py-1.5 rounded-xl bg-rose-500/20 border border-rose-400/50 text-rose-200 text-xs font-bold transition cursor-pointer' : 'px-3 py-1.5 rounded-xl glass-panel text-slate-400 hover:text-white text-xs font-medium transition cursor-pointer'"
              title="Hide packages with mature content warnings">
              Safe Filter
            </button>

            <div class="flex items-center gap-2 glass-panel rounded-xl px-3 py-1.5 text-xs">
              <span class="text-slate-400 font-medium">Game:</span>
              <select
                [ngModel]="packageService.selectedGame()"
                (ngModelChange)="packageService.setGameFilter($event)"
                aria-label="Filter by compatible game"
                class="bg-transparent text-white font-bold focus:outline-none cursor-pointer">
                <option value="all" class="bg-slate-900 text-white">All Games</option>
                @for (g of packageService.availableGames(); track g.name) {
                  <option [value]="g.name" class="bg-slate-900 text-white">{{ g.title }}</option>
                }
              </select>
            </div>

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
                <option value="created" class="bg-slate-900 text-white">{{ 'catalog.sortCreated' | translate }}</option>
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
            <p class="text-xs text-slate-400 max-w-sm mx-auto">
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

      <!-- ContentDB & Custom Git Tags Quick-Filter Bar + Expandable Drawer -->
      <div class="relative z-10 max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 mt-2.5 sm:mt-3 space-y-2">
        <div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-0.5">
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
              class="w-6 h-6 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
              <svg lucideInfo class="w-3 h-3"></svg>
            </button>
          </div>
          @for (tag of primaryTags(); track tag.name) {
            <button
              type="button"
              (click)="packageService.setTagFilter(tag.name)"
              [appTooltip]="isOrganicCodeTag(tag.name) ? ('card.organicCodeTooltip' | translate) : ('modal.filterByTagTooltip' | translate:{ tag: tag.title })"
              class="px-3 py-1 rounded-full glass-pill hover:border-sky-400/40 text-slate-300 hover:text-white text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              @if (isOrganicCodeTag(tag.name)) {
                <svg lucideLeaf class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"></svg>
                <span>#{{ 'card.organicCodeLabel' | translate }}</span>
              } @else {
                <span>#{{ tag.title }}</span>
              }
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
                [appTooltip]="isOrganicCodeTag(tag.name) ? ('card.organicCodeTooltip' | translate) : ('modal.filterByTagTooltip' | translate:{ tag: tag.title })"
                class="px-2.5 py-1 rounded-full glass-pill hover:border-sky-400/40 text-slate-300 hover:text-white text-xs font-medium inline-flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer">
                @if (isOrganicCodeTag(tag.name)) {
                  <svg lucideLeaf class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"></svg>
                  <span>#{{ 'card.organicCodeLabel' | translate }}</span>
                } @else {
                  <span>#{{ tag.title }}</span>
                }
              </button>
            }
          </div>
        }
      </div>

      <div class="relative z-10 mt-2 sm:mt-3 space-y-5 sm:space-y-8 pb-16">

        <!-- Promotional Package Row(s) in 1st Place (e.g. Luanti Game Jam 2026 / Tag Showcase / Curated Spotlight) -->
        @for (promoRow of packageService.activePromotionalRows(); track promoRow.promotion.id) {
          <app-package-carousel
            [icon]="promoRow.icon"
            [title]="promoRow.title"
            [infoTooltip]="promoRow.subtitle"
            [promoBadge]="promoRow.badgeText"
            [promoCtaLabel]="promoRow.ctaLabel"
            [promoCtaUrl]="promoRow.ctaUrl"
            [showWhenEmpty]="promoRow.showEmptyCta"
            [packages]="promoRow.packages"
            (viewAll)="packageService.explorePromotionalRow(promoRow)"
            (promoCtaClicked)="onPromoRowCtaClick($event)">
          </app-package-carousel>
        }

        <!-- Swimlane: Recently Added (Git + ContentDB) -->
        <app-package-carousel
          icon="sparkles"
          [title]="'carousel.recentlyAdded' | translate"
          [infoTooltip]="'carousel.infoRecentlyAdded' | translate"
          [packages]="packageService.recentlyAddedPackages()"
          (viewAll)="packageService.viewAllRecentlyAdded()">
        </app-package-carousel>

        <!-- Personalized Swimlane: Recommended From Your Favorites (LuantiHub-First Favorites Integration) -->
        @if (packageService.recommendedFromFavorites().length > 0) {
          <app-package-carousel
            icon="sparkles"
            title="Recommended From Your Favorites"
            infoTooltip="Personalized recommendations based on your Luanti Hub Favorites, shared tags, dependencies, and compatible games."
            [packages]="packageService.recommendedFromFavorites()"
            (viewAll)="packageService.selectPrimaryNavTab('favorites')">
          </app-package-carousel>
        }

        <!-- Swimlane 1: Trending Engine Mods -->
        <app-package-carousel
          icon="flame"
          [title]="'carousel.trending' | translate"
          [infoTooltip]="'carousel.infoTrending' | translate"
          [packages]="packageService.trendingPackages()"
          (viewAll)="packageService.selectPrimaryNavTab('mod')">
        </app-package-carousel>

        <!-- Netflix Featured Row 1: Top 10 Packages (Today) -->
        <app-top10-row timeframe="today"></app-top10-row>

        <!-- Swimlane 2: Standalone Voxel Games -->
        <app-package-carousel
          icon="gamepad"
          [title]="'carousel.standaloneGames' | translate"
          [infoTooltip]="'carousel.infoGames' | translate"
          [packages]="packageService.standaloneGames()"
          (viewAll)="packageService.selectPrimaryNavTab('game')">
        </app-package-carousel>

        <!-- Swimlane 3: Community Git Packages (Only shows real Git Community submissions, or a clean CTA when none submitted yet) -->
        @if (packageService.decentralizedGitPackages().length > 0) {
          <app-package-carousel
            icon="git"
            [title]="'carousel.freshGit' | translate"
            [infoTooltip]="'carousel.infoGit' | translate"
            [packages]="packageService.decentralizedGitPackages()"
            (viewAll)="packageService.selectPrimaryNavTab('git')">
          </app-package-carousel>
        } @else {
          <section class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
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
                      class="w-6 h-6 rounded-full glass-pill text-slate-400 hover:text-sky-300 hover:border-sky-400/50 flex items-center justify-center transition cursor-help">
                      <svg lucideInfo class="w-3.5 h-3.5"></svg>
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

        <!-- Netflix Featured Row 2: Top 10 Packages (This Week) -->
        <app-top10-row timeframe="week"></app-top10-row>

        <!-- Swimlane 4: Essential Mods & Addons -->
        <app-package-carousel
          icon="cpu"
          [title]="'carousel.automation' | translate"
          [infoTooltip]="'carousel.infoAutomation' | translate"
          [packages]="packageService.automationMods()"
          (viewAll)="packageService.setTagFilter('technology')">
        </app-package-carousel>

        <!-- Swimlane 5: High-Definition Texture Packs -->
        <app-package-carousel
          icon="palette"
          [title]="'carousel.texturePacks' | translate"
          [infoTooltip]="'carousel.infoTextures' | translate"
          [packages]="packageService.texturePacks()"
          (viewAll)="packageService.selectPrimaryNavTab('txp')">
        </app-package-carousel>

      </div>
    }

    <!-- Semantic Luanti Ecosystem Guide, Internal Pillar Links & FAQ Section (SEO & User Discovery) -->
    <section
      aria-labelledby="luanti-ecosystem-guide-heading"
      class="max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-12 xl:px-14 pt-6 pb-8">
      <div class="p-6 sm:p-8 rounded-3xl glass-panel space-y-6 text-slate-300">
        <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-6 border-b border-white/10 pb-6">
          <div class="space-y-2.5 max-w-3xl">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-300 text-[11px] font-bold uppercase tracking-wider">
              Open-Source Voxel Engine Ecosystem
            </span>
            @if (hasEntityOverlay()) {
              <h2 id="luanti-ecosystem-guide-heading" class="text-lg sm:text-2xl font-black text-white tracking-tight">
                {{ primarySeoHeading() }}
              </h2>
            } @else {
              <h1 id="luanti-ecosystem-guide-heading" class="text-lg sm:text-2xl font-black text-white tracking-tight">
                {{ primarySeoHeading() }}
              </h1>
            }
            <p class="text-xs sm:text-sm text-slate-300 leading-relaxed">
              <strong>Luanti</strong> (formerly known as <strong>Minetest</strong>) is a free, open-source C++ voxel game engine for Windows, Linux, macOS, Android, and iOS.
              <strong>Luanti Hub (LuantiHub)</strong> is the high-availability package registry and discovery hub where players and server administrators can explore, preview, and install thousands of community
              <a href="/games" (click)="onSeoNavClick($event, 'game')" class="text-sky-400 hover:text-sky-300 font-semibold underline decoration-sky-400/40">Luanti games</a>,
              <a href="/mods" (click)="onSeoNavClick($event, 'mod')" class="text-sky-400 hover:text-sky-300 font-semibold underline decoration-sky-400/40">Luanti mods</a>, and
              <a href="/texture-packs" (click)="onSeoNavClick($event, 'txp')" class="text-sky-400 hover:text-sky-300 font-semibold underline decoration-sky-400/40">Luanti texture packs</a>.
            </p>
          </div>

          <!-- Crawlable Pillar Category Cards -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 lg:w-[440px] flex-shrink-0 text-xs">
            <a
              href="/games"
              (click)="onSeoNavClick($event, 'game')"
              class="p-3 rounded-2xl glass-btn hover:border-sky-400/50 flex flex-col justify-between gap-1 no-underline transition cursor-pointer">
              <span class="font-bold text-white">Luanti Games</span>
              <span class="text-[11px] text-slate-400">Voxel sandboxes &amp; RPGs</span>
            </a>
            <a
              href="/mods"
              (click)="onSeoNavClick($event, 'mod')"
              class="p-3 rounded-2xl glass-btn hover:border-sky-400/50 flex flex-col justify-between gap-1 no-underline transition cursor-pointer">
              <span class="font-bold text-white">Luanti Mods</span>
              <span class="text-[11px] text-slate-400">Worldgen, tech &amp; mobs</span>
            </a>
            <a
              href="/texture-packs"
              (click)="onSeoNavClick($event, 'txp')"
              class="p-3 rounded-2xl glass-btn hover:border-sky-400/50 flex flex-col justify-between gap-1 no-underline transition cursor-pointer">
              <span class="font-bold text-white">Texture Packs</span>
              <span class="text-[11px] text-slate-400">HD &amp; pixel-art packs</span>
            </a>
            <a
              href="/git"
              (click)="onSeoNavClick($event, 'git')"
              class="p-3 rounded-2xl glass-btn hover:border-sky-400/50 flex flex-col justify-between gap-1 no-underline transition cursor-pointer">
              <span class="font-bold text-white">Git Packages</span>
              <span class="text-[11px] text-slate-400">Direct Git repo releases</span>
            </a>
            <a
              href="/setup"
              (click)="onSeoNavClick($event, 'setup')"
              class="p-3 rounded-2xl glass-btn hover:border-sky-400/50 flex flex-col justify-between gap-1 no-underline transition cursor-pointer">
              <span class="font-bold text-white">In-Game Setup</span>
              <span class="text-[11px] text-slate-400">1-click client config</span>
            </a>
            <a
              href="/submit"
              (click)="onSeoNavClick($event, 'submit')"
              class="p-3 rounded-2xl glass-btn hover:border-sky-400/50 flex flex-col justify-between gap-1 no-underline transition cursor-pointer">
              <span class="font-bold text-white">Submit Mod</span>
              <span class="text-[11px] text-slate-400">Publish from Git</span>
            </a>
          </div>
        </div>

        <!-- Frequently Asked Questions About Luanti Hub & Luanti -->
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 text-xs">
          <div class="space-y-1.5">
            <h2 class="text-sm font-bold text-white">What is Luanti Hub (LuantiHub)?</h2>
            <p class="text-slate-400 leading-relaxed">
              Luanti Hub (<strong>LuantiHub</strong>, at <code>luantihub.org</code>) is an open-source package registry, ContentDB mirror, and community discovery platform for the Luanti voxel engine, offering direct <code>.zip</code> downloads, automated Git repository packaging, and 1-click in-game installation.
            </p>
          </div>
          <div class="space-y-1.5">
            <h2 class="text-sm font-bold text-white">What is Luanti (formerly Minetest)?</h2>
            <p class="text-slate-400 leading-relaxed">
              Luanti is the official new name of the open-source Minetest voxel engine. Rather than locking players into a single game, Luanti provides a lightweight C++ engine and Lua API that powers standalone voxel games like VoxeLibre, Mineclonia, and NodeCore alongside thousands of community mods.
            </p>
          </div>
          <div class="space-y-1.5">
            <h2 class="text-sm font-bold text-white">How do I install Luanti mods and games?</h2>
            <p class="text-slate-400 leading-relaxed">
              Every package on Luanti Hub can be downloaded directly as a ready-to-drop <code>.zip</code> archive for your Luanti <code>mods/</code>, <code>games/</code>, or <code>textures/</code> directory, or installed with one click inside the Luanti client by setting <code>contentdb_url = https://luantihub.org</code> in <code>luanti.conf</code>.
            </p>
          </div>
          <div class="space-y-1.5">
            <h2 class="text-sm font-bold text-white">How does Luanti Hub work with ContentDB &amp; Git?</h2>
            <p class="text-slate-400 leading-relaxed">
              Luanti Hub unifies the official Luanti ContentDB catalog (backed by automatic mirror failover) with decentralized community Git repositories hosted on GitHub, Codeberg, Mesehub, and GitLab, complete with automated <code>mod.conf</code> and SPDX license verification.
            </p>
          </div>
        </div>
      </div>
    </section>
  `
})
export class CatalogComponent {
  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  private readonly router = inject(Router, { optional: true });
  readonly isTagsExpanded = signal(false);

  readonly hasEntityOverlay = computed(() =>
    Boolean(this.packageService.activePackage() || this.packageService.activeAuthorUsername())
  );

  readonly primarySeoHeading = computed(() => {
    if (this.packageService.selectedSource() === 'git') {
      return 'Decentralized Git Community Packages — Luanti Hub';
    }
    const type = this.packageService.selectedType();
    if (type === 'game') {
      return 'Luanti Games — Open-Source Voxel Games on Luanti Hub';
    }
    if (type === 'mod') {
      return 'Luanti Mods — Gameplay, Worldgen & Mobs on Luanti Hub';
    }
    if (type === 'txp') {
      return 'Luanti Texture Packs — HD & Pixel Art Resource Packs on Luanti Hub';
    }
    return 'Luanti Hub (LuantiHub) — Open-Source Voxel Games, Mods & Texture Packs for Luanti';
  });

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

  isOrganicCodeTag(tagName: string): boolean {
    return String(tagName || '').trim().toLowerCase() === ORGANIC_CODE_TAG;
  }

  onSortChange(sort: SortOption): void {
    this.packageService.setSortBy(sort);
  }

  onPromoRowCtaClick(url: string): void {
    const raw = (url || '').trim();
    if (!raw) return;
    if (raw === '/submit') {
      this.packageService.openSubmitModal();
      return;
    }
    if (raw === '/setup') {
      this.packageService.openSetupModal();
      return;
    }
    if (raw === '/blog' || raw === '/blog/latest') {
      this.packageService.openBlogArticleModal();
      return;
    }

    let targetPath = raw;
    if (raw.startsWith('//') || raw.startsWith('/\\') || /^(?:javascript|data|vbscript):/i.test(raw)) {
      return;
    }
    if (typeof window !== 'undefined' && (raw.startsWith('https://') || raw.startsWith('http://'))) {
      try {
        const parsed = new URL(raw);
        if (parsed.origin === window.location.origin) {
          targetPath = parsed.pathname + parsed.search + parsed.hash;
        } else if (parsed.protocol === 'https:') {
          window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
          return;
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    if (!targetPath.startsWith('/')) {
      targetPath = `/${targetPath}`;
    }
    if (targetPath.startsWith('//') || targetPath.startsWith('/\\')) {
      return;
    }

    if (this.router) {
      this.router.navigateByUrl(targetPath).catch(() => {});
    } else if (typeof window !== 'undefined') {
      window.location.href = targetPath;
    }
  }

  onSeoNavClick(event: MouseEvent, target: 'game' | 'mod' | 'txp' | 'git' | 'setup' | 'submit'): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) {
      return;
    }
    event.preventDefault();
    if (target === 'setup') {
      this.packageService.openSetupModal();
    } else if (target === 'submit') {
      this.packageService.openSubmitModal();
    } else {
      this.packageService.selectPrimaryNavTab(target);
    }
  }
}

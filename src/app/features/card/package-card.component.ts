import { Component, ChangeDetectionStrategy, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideStar,
  LucideHeart,
  LucideGitBranch,
  LucideGlobe,
  LucideChevronDown,
  LucideDownload
} from '@lucide/angular';

@Component({
  selector: 'app-package-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: flex; height: 100%; }'],
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    TranslatePipe,
    LucideStar,
    LucideHeart,
    LucideGitBranch,
    LucideGlobe,
    LucideChevronDown,
    LucideDownload
  ],
  template: `
    <div
      (click)="openDetails()"
      role="button"
      tabindex="0"
      (keydown.enter)="openDetails()"
      (keydown.space)="openDetails()"
      [attr.aria-label]="package.title + ' ' + ('card.byAuthor' | translate) + ' ' + package.author"
      [appTooltip]="'card.clickToOpen' | translate"
      [class.origin-left]="isFirst"
      [class.origin-right]="isLast"
      [class.origin-center]="!isFirst && !isLast"
      class="group relative flex flex-col h-full min-h-[304px] max-h-[332px] flex-shrink-0 w-60 sm:w-68 rounded-2xl glass-card cursor-pointer transition-all duration-300 ease-out hover:scale-105 sm:hover:scale-[1.06] hover:-translate-y-1.5 hover:z-30 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden">

      <!-- Thumbnail with True 16:9 Widescreen Aspect Ratio -->
      <div class="relative w-full aspect-video flex-shrink-0 bg-slate-950 overflow-hidden">
        <img
          [src]="package.banner || package.thumbnail"
          [fallbackThumbnail]="package.thumbnail"
          appImgFallback
          [alt]="package.title"
          loading="lazy"
          decoding="async"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent"></div>

        <!-- Badges on image -->
        <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span
            [class]="package.type === 'game' ? 'bg-emerald-500/90 text-white' : package.type === 'txp' ? 'bg-purple-500/90 text-white' : 'bg-sky-500/90 text-white'"
            class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider backdrop-blur-md shadow">
            {{ package.type }}
          </span>

          @if (package.sources?.includes('official') && (package.sources?.includes('git') || package.source === 'git')) {
            <span
              class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 backdrop-blur-md flex items-center gap-1 shadow">
              <svg lucideGlobe class="w-3 h-3 text-emerald-300"></svg>
              <span>ContentDB</span>
            </span>
          }

          @if (package.sources?.includes('git') || package.source === 'git') {
            <span
              [appTooltip]="'card.gitSourceTooltip' | translate"
              class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-slate-950 flex items-center gap-1 shadow">
              <svg lucideGitBranch class="w-3 h-3 text-slate-950"></svg>
              <span>Git</span>
            </span>
          }
        </div>

        <!-- Rating pill on top right -->
        @if (package.score > 0) {
          <div class="absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold text-amber-400 glass-pill px-2 py-0.5 rounded-full">
            <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
            <span>{{ package.score }}</span>
          </div>
        }
      </div>

      <!-- Content Details with Equalized Flex Layout -->
      <div class="p-3.5 flex flex-col flex-1 justify-between min-h-0">

        <div class="space-y-2">
          <!-- Action Buttons Row (Direct .zip Download, Favorite, Details) -->
          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="onDownload($event)"
              [appTooltip]="('card.quickInstall' | translate) + (package.file_size ? ' (' + package.file_size + ')' : '')"
              [attr.aria-label]="'card.downloadZip' | translate"
              class="w-8 h-8 rounded-full glass-btn-primary text-white flex items-center justify-center transition hover:scale-105 cursor-pointer">
              <svg lucideDownload class="w-4 h-4 text-white"></svg>
            </button>

            <button
              type="button"
              (click)="onFavoriteClick($event)"
              [attr.aria-label]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
              [appTooltip]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
              class="w-8 h-8 rounded-full glass-icon-btn text-white flex items-center justify-center transition hover:scale-105 cursor-pointer">
              <svg
                lucideHeart
                [class]="settingsService.isFavorite(package.id) ? 'w-3.5 h-3.5 fill-rose-500 text-rose-500 transition-colors' : 'w-3.5 h-3.5 transition-colors'"
                [style.fill]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'none'"
                [color]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'currentColor'">
              </svg>
            </button>

            @if (package.downloads > 0) {
              <span class="text-[10px] font-mono text-slate-400 ml-1">
                {{ package.downloads | number }} dl
              </span>
            }

            <button
              type="button"
              (click)="openDetails($event)"
              [appTooltip]="'card.moreInfo' | translate"
              aria-label="More Information"
              class="w-8 h-8 rounded-full glass-icon-btn text-white flex items-center justify-center ml-auto transition hover:scale-105 cursor-pointer">
              <svg lucideChevronDown class="w-4 h-4"></svg>
            </button>
          </div>

          <!-- Key Metrics: Match %, Real Engine Compatibility & License -->
          <div class="flex items-center gap-2 text-xs overflow-hidden whitespace-nowrap">
            <span class="text-emerald-400 font-bold text-[11px] flex-shrink-0">
              {{ packageService.getMatchScore(package) }}% {{ 'card.match' | translate }}
            </span>
            @if (package.min_minetest_version) {
              <span class="text-[10px] font-mono px-1.5 py-0.2 rounded glass-pill text-slate-300 flex-shrink-0">
                {{ package.min_minetest_version }}+
              </span>
            }
            @if (package.license || package.media_license) {
              <span class="text-[10px] font-mono text-slate-400 uppercase truncate">
                {{ package.license || package.media_license }}
              </span>
            }
          </div>

          <!-- Title (Fixed 1 line) & Short Description (Fixed 2-line height) -->
          <div>
            <h3 class="text-xs sm:text-sm font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1">
              {{ package.title }}
            </h3>
            <p class="text-[11px] text-slate-400 line-clamp-2 min-h-[2.25rem] leading-relaxed mt-0.5">
              {{ package.short_desc }}
            </p>
          </div>
        </div>

        <!-- Bottom Capped Single-Line Tags / Author Footer -->
        <div class="mt-auto pt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400 overflow-hidden whitespace-nowrap min-h-[22px]">
          @if (displayTags.length > 0) {
            @for (t of displayTags; track t; let last = $last) {
              <button
                type="button"
                (click)="onTagClick($event, t)"
                class="hover:text-sky-300 transition truncate max-w-[90px] cursor-pointer">
                #{{ t }}
              </button>
              @if (!last) {
                <span class="text-slate-600 flex-shrink-0">•</span>
              }
            }
          } @else {
            <span class="text-slate-500 truncate">{{ 'card.byAuthor' | translate }} {{ package.author }}</span>
          }
        </div>

      </div>

    </div>
  `
})
export class PackageCardComponent {
  @Input({ required: true }) package!: LuantiPackage;
  @Input() isFirst = false;
  @Input() isLast = false;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);

  get displayTags(): string[] {
    const pkgType = this.package.type?.toLowerCase();
    return (this.package.tags || []).filter(t => {
      const lower = t.toLowerCase();
      return lower !== pkgType && lower !== 'mod' && lower !== 'game' && lower !== 'txp' && lower !== 'texture_pack';
    }).slice(0, 3);
  }

  openDetails(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.packageService.openPackageModal(this.package);
  }

  onDownload(event: MouseEvent): void {
    event.stopPropagation();
    this.packageService.downloadPackage(this.package);
  }

  onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(this.package.id);
  }

  onTagClick(event: MouseEvent, tag: string): void {
    event.stopPropagation();
    this.packageService.setTagFilter(tag);
  }
}

import { Component, Input, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideStar,
  LucideHeart,
  LucideGitBranch,
  LucideChevronDown,
  LucideDownload
} from '@lucide/angular';

@Component({
  selector: 'app-package-card',
  standalone: true,
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    TranslatePipe,
    LucideStar,
    LucideHeart,
    LucideGitBranch,
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
      [class.hover:origin-left]="isFirst"
      [class.hover:origin-right]="isLast"
      [class.hover:origin-center]="!isFirst && !isLast"
      class="group relative flex-shrink-0 w-60 sm:w-68 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-slate-700 shadow-xl hover:shadow-2xl hover:shadow-black/95 cursor-pointer transition-all duration-300 ease-out hover:scale-105 sm:hover:scale-[1.07] hover:-translate-y-2 hover:z-30 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden">
      
      <!-- Thumbnail with 16:9 Aspect Ratio & Lazy Loading -->
      <div class="relative w-full h-36 sm:h-40 bg-slate-950 overflow-hidden">
        <img 
          [src]="package.banner || package.thumbnail" 
          [fallbackThumbnail]="package.thumbnail"
          appImgFallback
          [alt]="package.title"
          loading="lazy"
          decoding="async"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent"></div>

        <!-- Badges on image (Standardized Consistent Colors) -->
        <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span 
            [class]="package.type === 'game' ? 'bg-emerald-500 text-white' : package.type === 'txp' ? 'bg-purple-500 text-white' : 'bg-sky-500 text-white'"
            class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider shadow">
            {{ package.type }}
          </span>

          @if (package.source === 'git') {
            <span 
              [appTooltip]="'card.gitSourceTooltip' | translate"
              class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-slate-950 flex items-center gap-1 shadow">
              <svg lucideGitBranch class="w-3 h-3 text-slate-950"></svg>
              <span>Git</span>
            </span>
          }
        </div>

        <!-- Rating pill on top right -->
        <div class="absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-slate-950/80 px-2 py-0.5 rounded-full border border-slate-800 shadow">
          <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400"></svg>
          <span>{{ package.score }}</span>
        </div>
      </div>

      <!-- Content Details with Netflix Hover Expanded Actions -->
      <div class="p-3.5 space-y-2.5 bg-slate-900">
        
        <!-- Netflix Action Buttons Row (Clean 3-Button Layout) -->
        <div class="flex items-center gap-2 pt-0.5">
          <!-- Primary Download Button -->
          <button 
            (click)="openSetup($event)"
            [appTooltip]="'card.quickInstall' | translate"
            aria-label="Download Package"
            class="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-slate-950 flex items-center justify-center shadow-lg transition hover:scale-105">
            <svg lucideDownload class="w-4 h-4 text-slate-950"></svg>
          </button>

          <!-- Add to Favorites / My List -->
          <button 
            (click)="onFavoriteClick($event)"
            [attr.aria-label]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
            [appTooltip]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
            class="w-8 h-8 rounded-full border border-slate-600 bg-slate-800/80 hover:border-white text-white flex items-center justify-center transition hover:scale-105">
            <svg 
              lucideHeart 
              class="w-3.5 h-3.5 transition-colors"
              [class.fill-rose-500]="settingsService.isFavorite(package.id)"
              [class.text-rose-500]="settingsService.isFavorite(package.id)">
            </svg>
          </button>

          <!-- More Details Chevron Button (Far Right) -->
          <button 
            (click)="openDetails($event)"
            [appTooltip]="'card.moreInfo' | translate"
            aria-label="More Information"
            class="w-8 h-8 rounded-full border border-slate-600 bg-slate-800/80 hover:border-white text-white flex items-center justify-center ml-auto transition hover:scale-105">
            <svg lucideChevronDown class="w-4 h-4"></svg>
          </button>
        </div>

        <!-- Key Metrics: Match % & Engine Compatibility -->
        <div class="flex items-center gap-2 text-xs">
          <span class="text-emerald-400 font-bold text-[11px]">
            {{ ((package.score || 4.5) * 20) | number:'1.0-0' }}% Match
          </span>
          <span class="text-[10px] font-mono px-1 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
            5.8+
          </span>
          <span class="text-[10px] font-mono text-slate-400 uppercase truncate">
            {{ package.license }}
          </span>
        </div>

        <!-- Title & Short Description -->
        <div>
          <h3 class="text-xs sm:text-sm font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1">
            {{ package.title }}
          </h3>
          <p class="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mt-0.5">
            {{ package.short_desc }}
          </p>
        </div>

        <!-- Tags / Genres Bullet List (Type tags excluded to avoid duplication) -->
        @if (displayTags.length > 0) {
          <div class="flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
            @for (t of displayTags; track t; let last = $last) {
              <span>{{ t }}</span>
              @if (!last) {
                <span class="text-slate-600">•</span>
              }
            }
          </div>
        }

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
  readonly pwaService = inject(PwaService);

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

  openSetup(event: MouseEvent): void {
    event.stopPropagation();
    this.packageService.trackDownload(this.package);
    this.packageService.openSetupModal();
  }

  onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(this.package.id);
  }
}

import { Component, Input, inject } from '@angular/core';
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
  LucidePlay,
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
    LucidePlay,
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
      class="group relative flex-shrink-0 w-64 sm:w-72 rounded-xl bg-slate-900 border border-slate-800/80 hover:border-slate-700/90 shadow-xl hover:shadow-2xl hover:shadow-black/95 cursor-pointer transition-all duration-300 ease-out lg:hover:scale-115 lg:hover:z-30 origin-center focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden">
      
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

        <!-- Badges on image -->
        <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
          <span 
            [class]="package.type === 'game' ? 'bg-emerald-500/90 text-white' : package.type === 'txp' ? 'bg-purple-500/90 text-white' : 'bg-sky-500/90 text-white'"
            class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider shadow">
            {{ package.type }}
          </span>

          @if (package.source === 'git') {
            <span 
              [appTooltip]="'card.gitSourceTooltip' | translate"
              class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/90 text-slate-950 flex items-center gap-1 shadow">
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
        
        <!-- Netflix Circular Action Buttons Row -->
        <div class="flex items-center gap-2 pt-0.5">
          <!-- Play / Quick In-Game Setup -->
          <button 
            (click)="openSetup($event)"
            [appTooltip]="'card.quickInstall' | translate"
            aria-label="Install In-Game"
            class="w-8 h-8 rounded-full bg-white hover:bg-slate-200 text-slate-950 flex items-center justify-center shadow-lg transition hover:scale-105">
            <svg lucidePlay class="w-4 h-4 fill-slate-950 text-slate-950 ml-0.5"></svg>
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

          <!-- Download / Terminal In-Game Guide -->
          <button 
            (click)="openSetup($event)"
            [appTooltip]="'setup.title' | translate"
            aria-label="In-Game Configuration"
            class="w-8 h-8 rounded-full border border-slate-600 bg-slate-800/80 hover:border-white text-sky-400 flex items-center justify-center transition hover:scale-105">
            <svg lucideDownload class="w-3.5 h-3.5"></svg>
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

        <!-- Key Metrics: Match % & Tags -->
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

        <!-- Tags / Genres Bullet List -->
        @if (package.tags && package.tags.length > 0) {
          <div class="flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
            @for (t of package.tags.slice(0, 3); track t; let last = $last) {
              <span>{{ t }}</span>
              @if (!last) {
                <span class="text-slate-600">•</span>
              }
            }
          </div>
        }

        <!-- Bottom Red Progress Accent Line -->
        <div class="h-0.5 w-full bg-rose-600 rounded-full opacity-60 group-hover:opacity-100 transition-opacity"></div>

      </div>

    </div>
  `
})
export class PackageCardComponent {
  @Input({ required: true }) package!: LuantiPackage;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);

  openDetails(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.packageService.openPackageModal(this.package);
  }

  openSetup(event: MouseEvent): void {
    event.stopPropagation();
    this.packageService.openSetupModal();
  }

  onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(this.package.id);
  }
}

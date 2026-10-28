import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LucideStar, LucideHeart, LucideGitBranch } from '@lucide/angular';

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
    LucideGitBranch
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
      class="group relative flex-shrink-0 w-64 sm:w-72 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-sky-500/50 shadow-lg hover:shadow-sky-500/10 overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-sky-500">
      
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
        <div class="absolute top-2.5 left-2.5 flex items-center gap-1.5">
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

        <!-- Favorite Quick Button -->
        <button 
          (click)="onFavoriteClick($event)"
          [attr.aria-label]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
          [appTooltip]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
          class="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-slate-950/70 hover:bg-slate-950 text-slate-300 hover:text-rose-400 transition">
          <svg 
            lucideHeart 
            class="w-3.5 h-3.5 transition-colors"
            [class.fill-rose-500]="settingsService.isFavorite(package.id)"
            [class.text-rose-500]="settingsService.isFavorite(package.id)">
          </svg>
        </button>
      </div>

      <!-- Content Details -->
      <div class="p-3.5 space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-bold text-white group-hover:text-sky-400 transition-colors line-clamp-1">
            {{ package.title }}
          </h3>
          
          <!-- Star Rating with Lucide Icon -->
          <div class="flex items-center gap-1 text-[11px] font-bold text-amber-400 flex-shrink-0">
            <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400"></svg>
            <span>{{ package.score }}</span>
          </div>
        </div>

        <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed">
          {{ package.short_desc }}
        </p>

        <!-- Meta Footer -->
        <div class="pt-1 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800">
          <span class="truncate max-w-[130px]">
            {{ 'card.byAuthor' | translate }} <strong class="text-slate-300 font-medium">{{ package.author }}</strong>
          </span>
          <span class="font-mono text-[10px] text-slate-400">{{ package.license }}</span>
        </div>
      </div>

    </div>
  `
})
export class PackageCardComponent {
  @Input({ required: true }) package!: LuantiPackage;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);

  openDetails(): void {
    this.packageService.openPackageModal(this.package);
  }

  onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(this.package.id);
  }
}

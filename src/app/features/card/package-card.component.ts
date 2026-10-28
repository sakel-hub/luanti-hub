import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';

@Component({
  selector: 'app-package-card',
  standalone: true,
  imports: [CommonModule, ImgFallbackDirective],
  template: `
    <div 
      (click)="packageService.openPackageModal(package)"
      role="button"
      tabindex="0"
      (keydown.enter)="packageService.openPackageModal(package)"
      (keydown.space)="packageService.openPackageModal(package)"
      [attr.aria-label]="package.title + ' by ' + package.author"
      class="group relative flex-shrink-0 w-64 sm:w-72 rounded-xl bg-slate-900/90 border border-slate-800/80 hover:border-sky-500/50 shadow-lg hover:shadow-sky-500/10 overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500">
      
      <!-- Thumbnail with 16:9 Aspect Ratio & High-Res Auto-Upgrade -->
      <div class="relative w-full h-36 sm:h-40 bg-slate-950 overflow-hidden">
        <img 
          [src]="package.banner || package.thumbnail" 
          [fallbackThumbnail]="package.thumbnail"
          appImgFallback
          [alt]="package.title"
          loading="lazy"
          class="w-full h-full object-cover group-hover:scale-108 transition-transform duration-500"
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
            <span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/90 text-slate-950 flex items-center gap-0.5 shadow">
              <span>⚡ Git</span>
            </span>
          }
        </div>

        <!-- Favorite Quick Button -->
        <button 
          (click)="onFavoriteClick($event)"
          [attr.aria-label]="settingsService.isFavorite(package.id) ? 'Remove from favorites' : 'Add to favorites'"
          class="absolute top-2.5 right-2.5 p-1.5 rounded-full bg-slate-950/70 hover:bg-slate-950 text-slate-300 hover:text-rose-400 transition">
          <svg 
            class="w-3.5 h-3.5" 
            [class.fill-rose-500]="settingsService.isFavorite(package.id)"
            [class.text-rose-500]="settingsService.isFavorite(package.id)"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
          </svg>
        </button>
      </div>

      <!-- Card Details Body -->
      <div class="p-3.5 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold text-white group-hover:text-sky-400 transition-colors truncate">
            {{ package.title }}
          </h3>
          <div class="flex items-center gap-1 text-[11px] font-bold text-amber-400 flex-shrink-0">
            <svg class="w-3 h-3 fill-current" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
            </svg>
            <span>{{ package.score }}</span>
          </div>
        </div>

        <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed">
          {{ package.short_desc }}
        </p>

        <!-- Meta Footer -->
        <div class="pt-1 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800">
          <span class="truncate max-w-[120px]">by <strong class="text-slate-300 font-medium">{{ package.author }}</strong></span>
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

  onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(this.package.id);
  }
}

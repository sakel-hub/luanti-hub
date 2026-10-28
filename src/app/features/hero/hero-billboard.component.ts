import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-hero-billboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (featured(); as pkg) {
      <div class="relative w-full h-[480px] sm:h-[560px] overflow-hidden select-none bg-slate-950">
        
        <!-- Backdrop Image with Ken Burns subtle zoom -->
        <div class="absolute inset-0">
          <img 
            [src]="pkg.banner || pkg.thumbnail" 
            [alt]="pkg.title"
            class="w-full h-full object-cover object-center filter brightness-60 scale-105 transition-transform duration-1000"
          />
          <!-- Multi-Directional Gradient Mask for Netflix Look -->
          <div class="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/70 to-transparent"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
          <div class="absolute inset-0 bg-radial-at-c from-transparent via-slate-950/40 to-slate-950"></div>
        </div>

        <!-- Foreground Content -->
        <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex flex-col justify-end pb-16 sm:pb-20 z-10">
          <div class="max-w-2xl space-y-4">
            
            <!-- Category & Verification Pill -->
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-400 border border-sky-500/30">
                #1 Featured Package
              </span>
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                {{ pkg.type }}
              </span>
              @if (pkg.source === 'git') {
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  ⚡ Decentralized Git
                </span>
              } @else {
                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  🌐 ContentDB Verified
                </span>
              }
            </div>

            <!-- Title -->
            <h1 class="text-3xl sm:text-5xl font-black tracking-tight text-white drop-shadow-md">
              {{ pkg.title }}
            </h1>

            <!-- Description -->
            <p class="text-sm sm:text-base text-slate-300 line-clamp-3 leading-relaxed drop-shadow">
              {{ pkg.short_desc }}
            </p>

            <!-- Stats & Meta -->
            <div class="flex items-center gap-4 text-xs text-slate-300">
              <div class="flex items-center gap-1 text-amber-400 font-bold">
                <svg class="w-4 h-4 fill-current" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
                <span>{{ pkg.score }}</span>
              </div>
              <span>•</span>
              <span>{{ pkg.downloads | number }} downloads</span>
              <span>•</span>
              <span class="text-slate-400 font-mono">License: {{ pkg.license }}</span>
            </div>

            <!-- CTA Buttons -->
            <div class="flex items-center gap-3 pt-2">
              <button 
                (click)="packageService.openPackageModal(pkg)"
                class="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-xl hover:scale-105 transition-all">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span>Inspect &amp; Reviews</span>
              </button>

              <button 
                (click)="packageService.openSetupModal()"
                class="px-5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/90 text-white font-medium text-xs sm:text-sm border border-slate-700/80 flex items-center gap-2 transition">
                <svg class="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                <span>Install In-Game</span>
              </button>

              @if (pkg.repo_url) {
                <a 
                  [href]="pkg.repo_url" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  class="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition"
                  title="View Git Repository">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                </a>
              }
            </div>

          </div>
        </div>

      </div>
    }
  `
})
export class HeroBillboardComponent {
  readonly packageService = inject(PackageService);
  readonly featured = this.packageService.featuredPackage;
}

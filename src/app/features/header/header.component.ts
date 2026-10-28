import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PackageService } from '../../core/services/package.service';
import { PwaService } from '../../core/services/pwa.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="sticky top-0 z-40 w-full glass-panel border-b border-slate-800/80 transition-colors duration-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        <!-- Left: Logo & Nav Links -->
        <div class="flex items-center gap-6">
          <a href="#" class="flex items-center gap-3 group focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-lg p-1">
            <img src="logo.svg" alt="LuantiHub" width="36" height="36" class="w-9 h-9 rounded-xl shadow-md group-hover:scale-105 transition-transform" />
            <div class="flex flex-col">
              <span class="text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                Luanti<span class="text-sky-400">Hub</span>
                <span class="text-[9px] uppercase tracking-wider font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded-full">
                  Decentralized
                </span>
              </span>
            </div>
          </a>

          <!-- Category Nav Tabs -->
          <nav class="hidden md:flex items-center gap-1 text-xs font-semibold">
            <button 
              (click)="setTypeFilter('all')" 
              [class]="selectedType() === 'all' ? 'text-sky-400 bg-sky-950/60 border-sky-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              All Content
            </button>
            <button 
              (click)="setTypeFilter('game')" 
              [class]="selectedType() === 'game' ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              Games
            </button>
            <button 
              (click)="setTypeFilter('mod')" 
              [class]="selectedType() === 'mod' ? 'text-sky-400 bg-sky-950/60 border-sky-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              Mods
            </button>
            <button 
              (click)="setTypeFilter('txp')" 
              [class]="selectedType() === 'txp' ? 'text-purple-400 bg-purple-950/60 border-purple-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              Textures
            </button>
            <button 
              (click)="setSourceFilter('git')" 
              [class]="selectedSource() === 'git' ? 'text-amber-400 bg-amber-950/60 border-amber-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition flex items-center gap-1">
              <span>⚡ Git Only</span>
            </button>
          </nav>
        </div>

        <!-- Center: Search Input -->
        <div class="flex-1 max-w-md relative">
          <div class="relative">
            <input 
              type="text" 
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              placeholder="Search mods, games, authors... (Press / to focus)"
              aria-label="Search mods, games, and packages"
              id="main-search-input"
              class="w-full bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-400 text-xs sm:text-sm rounded-xl pl-9 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition shadow-inner"
            />
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </div>
            @if (searchQuery()) {
              <button 
                (click)="clearSearch()" 
                class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                title="Clear search">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            }
          </div>
        </div>

        <!-- Right: Actions & User Profile -->
        <div class="flex items-center gap-2.5">
          
          <!-- In-Game Setup Button -->
          <button 
            (click)="packageService.openSetupModal()"
            title="In-Game Luanti Setup"
            class="px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-sky-400 border border-slate-700/80 text-xs font-medium flex items-center gap-1.5 transition">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            <span class="hidden sm:inline">In-Game URL</span>
          </button>

          <!-- Submit Mod Button -->
          <button 
            (click)="packageService.openSubmitModal()"
            class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center gap-1.5 shadow-md shadow-sky-600/20 transition">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            <span class="hidden sm:inline">Submit Mod</span>
          </button>

          <!-- User Authentication Section -->
          @if (authService.currentUser(); as user) {
            <!-- Logged In: Avatar button -->
            <button 
              (click)="authService.openProfileDrawer()"
              class="flex items-center gap-2 p-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition">
              <img [src]="user.avatar_url" [alt]="user.username" class="w-7 h-7 rounded-lg object-cover" />
              <span class="hidden lg:inline text-xs font-bold text-white pr-2 max-w-[100px] truncate">
                {{ user.display_name || user.username }}
              </span>
            </button>
          } @else {
            <!-- Not Logged In: Sign In button -->
            <button 
              (click)="authService.openAuthModal()"
              class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs flex items-center gap-1.5 transition">
              <svg class="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
              </svg>
              <span>Sign In</span>
            </button>
          }

        </div>

      </div>
    </header>
  `
})
export class HeaderComponent {
  readonly packageService = inject(PackageService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);

  readonly searchQuery = this.packageService.searchQuery;
  readonly selectedType = this.packageService.selectedType;
  readonly selectedSource = this.packageService.selectedSource;

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.packageService.setSearchQuery(input.value);
  }

  clearSearch(): void {
    this.packageService.setSearchQuery('');
  }

  setTypeFilter(type: string): void {
    this.packageService.setTypeFilter(type);
  }

  setSourceFilter(source: string): void {
    const current = this.selectedSource();
    this.packageService.setSourceFilter(current === source ? 'all' : source);
  }
}

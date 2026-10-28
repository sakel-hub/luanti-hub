import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PackageService } from '../../core/services/package.service';
import { PwaService } from '../../core/services/pwa.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/i18n/translation.service';
import { LocaleId } from '../../core/i18n/translation.types';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective, TranslatePipe],
  template: `
    <header class="sticky top-0 z-40 w-full glass-panel border-b border-slate-800/80 transition-colors duration-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 sm:gap-4">
        
        <!-- Left: Logo & Nav Links -->
        <div class="flex items-center gap-4 sm:gap-6">
          <a href="#" class="flex items-center gap-2.5 group focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-lg p-1">
            <img src="logo.svg" alt="LuantiHub" width="36" height="36" class="w-9 h-9 rounded-xl shadow-md group-hover:scale-105 transition-transform" />
            <div class="flex flex-col">
              <span class="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                Luanti<span class="text-sky-400">Hub</span>
                <span class="text-[9px] uppercase tracking-wider font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded-full hidden sm:inline">
                  Decentralized
                </span>
              </span>
            </div>
          </a>

          <!-- Category Nav Tabs -->
          <nav class="hidden md:flex items-center gap-1 text-xs font-semibold" aria-label="Category navigation">
            <button 
              (click)="setTypeFilter('all')" 
              [appTooltip]="'header.filterAll' | translate"
              [class]="selectedType() === 'all' && selectedSource() === 'all' ? 'text-sky-400 bg-sky-950/60 border-sky-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              {{ 'header.filterAll' | translate }}
            </button>
            <button 
              (click)="setTypeFilter('game')" 
              [appTooltip]="'header.filterGames' | translate"
              [class]="selectedType() === 'game' ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              {{ 'header.filterGames' | translate }}
            </button>
            <button 
              (click)="setTypeFilter('mod')" 
              [appTooltip]="'header.filterMods' | translate"
              [class]="selectedType() === 'mod' ? 'text-sky-400 bg-sky-950/60 border-sky-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              {{ 'header.filterMods' | translate }}
            </button>
            <button 
              (click)="setTypeFilter('txp')" 
              [appTooltip]="'header.filterTxp' | translate"
              [class]="selectedType() === 'txp' ? 'text-purple-400 bg-purple-950/60 border-purple-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition">
              {{ 'header.filterTxp' | translate }}
            </button>
            <button 
              (click)="setSourceFilter('git')" 
              [appTooltip]="'header.filterGit' | translate"
              [class]="selectedSource() === 'git' ? 'text-amber-400 bg-amber-950/60 border-amber-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-3 py-1.5 rounded-lg border transition flex items-center gap-1">
              <span>{{ 'header.filterGit' | translate }}</span>
            </button>
          </nav>
        </div>

        <!-- Center: Search Input -->
        <div class="flex-1 max-w-xs sm:max-w-md relative">
          <div class="relative">
            <input 
              type="text" 
              [value]="searchQuery()"
              (input)="onSearchInput($event)"
              [placeholder]="'header.searchPlaceholder' | translate"
              [attr.aria-label]="'header.searchPlaceholder' | translate"
              [appTooltip]="'header.searchTooltip' | translate"
              appTooltipShortcut="/"
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
                aria-label="Clear search">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            }
          </div>
        </div>

        <!-- Right: Actions, Language & Prominent Install Button -->
        <div class="flex items-center gap-2">
          
          <!-- Prominent "Install App" Button -->
          <button 
            (click)="pwaService.installPwa()"
            [appTooltip]="'header.installAppTooltip' | translate"
            [class]="pwaService.canInstall() ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/30 animate-pulse' : 'bg-slate-800/90 hover:bg-slate-700 text-sky-400 border border-slate-700/80'"
            class="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            <span class="hidden sm:inline">{{ 'header.installApp' | translate }}</span>
          </button>

          <!-- In-Game Setup Button -->
          <button 
            (click)="packageService.openSetupModal()"
            [appTooltip]="'header.inGameSetupTooltip' | translate"
            class="hidden md:flex px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-medium items-center gap-1.5 transition">
            <svg class="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            <span>{{ 'header.inGameSetup' | translate }}</span>
          </button>

          <!-- Submit Mod Button -->
          <button 
            (click)="packageService.openSubmitModal()"
            [appTooltip]="'header.submitRepoTooltip' | translate"
            class="hidden lg:flex px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-white font-medium text-xs items-center gap-1.5 transition">
            <svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            <span>{{ 'header.submitRepo' | translate }}</span>
          </button>

          <!-- Language Selector Dropdown Toggle -->
          <div class="relative">
            <button 
              (click)="toggleLanguageMenu()"
              [appTooltip]="'header.languageTooltip' | translate"
              aria-label="Change language"
              class="px-2 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-medium flex items-center gap-1 transition">
              <span class="text-sm leading-none">{{ currentLocaleMeta().flag }}</span>
              <span class="text-[11px] font-bold uppercase tracking-wider hidden sm:inline">{{ currentLocaleMeta().id }}</span>
              <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>

            <!-- Language Menu Dropdown -->
            @if (isLanguageMenuOpen()) {
              <div 
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-50 animate-in fade-in duration-150">
                <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 mb-1">
                  {{ 'header.language' | translate }}
                </div>
                @for (loc of supportedLocales; track loc.id) {
                  <button 
                    (click)="selectLanguage(loc.id)"
                    class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition text-left"
                    [class.bg-sky-600]="loc.id === currentLocale()"
                    [class.text-white]="loc.id === currentLocale()"
                    [class.hover:bg-slate-800]="loc.id !== currentLocale()"
                    [class.text-slate-300]="loc.id !== currentLocale()">
                    <span class="flex items-center gap-2">
                      <span>{{ loc.flag }}</span>
                      <span>{{ loc.nativeLabel }}</span>
                    </span>
                    @if (loc.id === currentLocale()) {
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                      </svg>
                    }
                  </button>
                }
              </div>
            }
          </div>

          <!-- Dynamic Updates / Clear Cache Dropdown Toggle -->
          <div class="relative">
            <button 
              (click)="toggleSettingsMenu()"
              [appTooltip]="'header.checkForUpdates' | translate"
              aria-label="Application options and update"
              class="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 transition relative">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              @if (pwaService.updateAvailable()) {
                <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full animate-ping"></span>
                <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-500 rounded-full"></span>
              }
            </button>

            @if (isSettingsMenuOpen()) {
              <div 
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-2 z-50 animate-in fade-in duration-150 space-y-1">
                
                <button 
                  (click)="onCheckUpdates()"
                  [disabled]="pwaService.checkingForUpdate()"
                  class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 transition text-left">
                  <svg 
                    class="w-4 h-4 text-sky-400" 
                    [class.animate-spin]="pwaService.checkingForUpdate()"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  <span>{{ 'header.checkForUpdates' | translate }}</span>
                </button>

                <button 
                  (click)="onClearCache()"
                  class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 transition text-left">
                  <svg class="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                  <span>{{ 'header.clearCache' | translate }}</span>
                </button>
              </div>
            }
          </div>

          <!-- User Authentication Section -->
          @if (authService.currentUser(); as user) {
            <button 
              (click)="authService.openProfileDrawer()"
              class="flex items-center gap-2 p-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition">
              <img [src]="user.avatar_url" [alt]="user.username" class="w-7 h-7 rounded-lg object-cover" />
              <span class="hidden lg:inline text-xs font-bold text-white pr-2 max-w-[90px] truncate">
                {{ user.display_name || user.username }}
              </span>
            </button>
          } @else {
            <button 
              (click)="authService.openAuthModal()"
              class="px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs flex items-center gap-1.5 transition">
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
  readonly translationService = inject(TranslationService);

  readonly searchQuery = this.packageService.searchQuery;
  readonly selectedType = this.packageService.selectedType;
  readonly selectedSource = this.packageService.selectedSource;
  readonly currentLocale = this.translationService.currentLocale;
  readonly supportedLocales = this.translationService.supportedLocales;

  readonly isLanguageMenuOpen = signal<boolean>(false);
  readonly isSettingsMenuOpen = signal<boolean>(false);

  currentLocaleMeta() {
    return this.supportedLocales.find(l => l.id === this.currentLocale()) || this.supportedLocales[0];
  }

  toggleLanguageMenu(): void {
    this.isLanguageMenuOpen.update(v => !v);
    this.isSettingsMenuOpen.set(false);
  }

  toggleSettingsMenu(): void {
    this.isSettingsMenuOpen.update(v => !v);
    this.isLanguageMenuOpen.set(false);
  }

  selectLanguage(locale: LocaleId): void {
    this.translationService.setLocale(locale);
    this.isLanguageMenuOpen.set(false);
  }

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

  onCheckUpdates(): void {
    this.pwaService.checkForUpdate(true);
    this.isSettingsMenuOpen.set(false);
  }

  onClearCache(): void {
    if (confirm('Clear all cached files, service workers, and reload LuantiHub?')) {
      this.pwaService.forceClearCacheAndReload();
    }
    this.isSettingsMenuOpen.set(false);
  }
}

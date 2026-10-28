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
import {
  LucideDownload,
  LucideSearch,
  LucideX,
  LucideTerminal,
  LucidePlus,
  LucideSettings,
  LucideUser,
  LucideChevronDown,
  LucideRefreshCw,
  LucideTrash,
  LucideLayers,
  LucideGamepad2,
  LucideCpu,
  LucidePalette,
  LucideZap
} from '@lucide/angular';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TooltipDirective,
    TranslatePipe,
    LucideDownload,
    LucideSearch,
    LucideX,
    LucideTerminal,
    LucidePlus,
    LucideSettings,
    LucideUser,
    LucideChevronDown,
    LucideRefreshCw,
    LucideTrash,
    LucideLayers,
    LucideGamepad2,
    LucideCpu,
    LucidePalette,
    LucideZap
  ],
  template: `
    <header class="sticky top-0 z-40 w-full bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 transition-colors duration-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 lg:gap-4">
        
        <!-- Left: Logo & Category Tabs -->
        <div class="flex items-center gap-3 xl:gap-5 flex-shrink-0">
          <a href="#" class="flex items-center gap-2.5 group focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-lg p-1 flex-shrink-0">
            <img src="logo.svg" alt="LuantiHub" width="32" height="32" class="w-8 h-8 rounded-xl shadow-md group-hover:scale-105 transition-transform flex-shrink-0" />
            <div class="flex items-center gap-2">
              <span class="text-base sm:text-lg font-black tracking-tight text-white whitespace-nowrap">
                Luanti<span class="text-sky-400">Hub</span>
              </span>
              <span class="text-[9px] uppercase tracking-wider font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded-full hidden 2xl:inline-flex whitespace-nowrap">
                Decentralized
              </span>
            </div>
          </a>

          <!-- Category Nav Tabs (Visible on large screens) -->
          <nav class="hidden xl:flex items-center gap-1 text-xs font-semibold flex-shrink-0" aria-label="Category navigation">
            <button 
              (click)="setTypeFilter('all')" 
              [appTooltip]="'header.filterAll' | translate"
              [class]="selectedType() === 'all' && selectedSource() === 'all' ? 'text-sky-400 bg-sky-950/60 border-sky-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap">
              <svg lucideLayers class="w-3.5 h-3.5"></svg>
              <span>{{ 'header.filterAll' | translate }}</span>
            </button>

            <button 
              (click)="setTypeFilter('game')" 
              [appTooltip]="'header.filterGames' | translate"
              [class]="selectedType() === 'game' ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap">
              <svg lucideGamepad2 class="w-3.5 h-3.5"></svg>
              <span>{{ 'header.filterGames' | translate }}</span>
            </button>

            <button 
              (click)="setTypeFilter('mod')" 
              [appTooltip]="'header.filterMods' | translate"
              [class]="selectedType() === 'mod' ? 'text-sky-400 bg-sky-950/60 border-sky-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap">
              <svg lucideCpu class="w-3.5 h-3.5"></svg>
              <span>{{ 'header.filterMods' | translate }}</span>
            </button>

            <button 
              (click)="setTypeFilter('txp')" 
              [appTooltip]="'header.filterTxp' | translate"
              [class]="selectedType() === 'txp' ? 'text-purple-400 bg-purple-950/60 border-purple-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap">
              <svg lucidePalette class="w-3.5 h-3.5"></svg>
              <span>{{ 'header.filterTxp' | translate }}</span>
            </button>

            <button 
              (click)="setSourceFilter('git')" 
              [appTooltip]="'header.filterGit' | translate"
              [class]="selectedSource() === 'git' ? 'text-amber-400 bg-amber-950/60 border-amber-800/80' : 'text-slate-400 hover:text-white border-transparent'"
              class="px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap">
              <svg lucideZap class="w-3.5 h-3.5 text-amber-400"></svg>
              <span>{{ 'header.filterGit' | translate }}</span>
            </button>
          </nav>
        </div>

        <!-- Center: Search Input -->
        <div class="flex-1 max-w-xs md:max-w-sm lg:max-w-md relative min-w-[120px]">
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
              <svg lucideSearch class="w-4 h-4"></svg>
            </div>
            @if (searchQuery()) {
              <button 
                (click)="clearSearch()" 
                class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white"
                aria-label="Clear search">
                <svg lucideX class="w-4 h-4"></svg>
              </button>
            }
          </div>
        </div>

        <!-- Right: Actions, Language & Prominent Install Button -->
        <div class="flex items-center gap-2 flex-shrink-0">
          
          <!-- Prominent "Install App" Button (Always Single Line) -->
          <button 
            (click)="pwaService.installPwa()"
            [appTooltip]="'header.installAppTooltip' | translate"
            [class]="pwaService.canInstall() ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/30 animate-pulse' : 'bg-slate-800/90 hover:bg-slate-700 text-sky-400 border border-slate-700/80'"
            class="h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0">
            <svg lucideDownload class="w-4 h-4 flex-shrink-0"></svg>
            <span class="whitespace-nowrap">{{ 'header.installApp' | translate }}</span>
          </button>

          <!-- In-Game Setup Button -->
          <button 
            (click)="packageService.openSetupModal()"
            [appTooltip]="'header.inGameSetupTooltip' | translate"
            class="hidden md:flex h-9 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-medium items-center gap-1.5 transition whitespace-nowrap flex-shrink-0">
            <svg lucideTerminal class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
            <span class="whitespace-nowrap">{{ 'header.inGameSetup' | translate }}</span>
          </button>

          <!-- Submit Mod Button -->
          <button 
            (click)="packageService.openSubmitModal()"
            [appTooltip]="'header.submitRepoTooltip' | translate"
            class="hidden lg:flex h-9 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-white font-medium text-xs items-center gap-1.5 transition whitespace-nowrap flex-shrink-0">
            <svg lucidePlus class="w-4 h-4 text-amber-400 flex-shrink-0"></svg>
            <span class="whitespace-nowrap">{{ 'header.submitRepo' | translate }}</span>
          </button>

          <!-- Language Selector Dropdown -->
          <div class="relative flex-shrink-0">
            <button 
              (click)="toggleLanguageMenu()"
              [appTooltip]="'header.languageTooltip' | translate"
              aria-label="Change language"
              class="h-9 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-medium flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0">
              <span class="text-sm leading-none">{{ currentLocaleMeta().flag }}</span>
              <span class="text-[11px] font-bold uppercase tracking-wider hidden sm:inline">{{ currentLocaleMeta().id }}</span>
              <svg lucideChevronDown class="w-3.5 h-3.5 text-slate-400"></svg>
            </button>

            <!-- Language Menu Dropdown -->
            @if (isLanguageMenuOpen()) {
              <div 
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                @for (loc of supportedLocales; track loc.id) {
                  <button
                    (click)="selectLanguage(loc.id)"
                    [class.bg-sky-600]="loc.id === currentLocale()"
                    [class.text-white]="loc.id === currentLocale()"
                    [class.text-slate-300]="loc.id !== currentLocale()"
                    class="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium hover:bg-slate-800 transition text-left">
                    <span class="text-base">{{ loc.flag }}</span>
                    <span class="flex-1">{{ loc.nativeLabel }}</span>
                    @if (loc.id === currentLocale()) {
                      <span class="text-[10px] font-bold">✓</span>
                    }
                  </button>
                }
              </div>
            }
          </div>

          <!-- PWA & Cache Settings Menu Toggle -->
          <div class="relative flex-shrink-0">
            <button 
              (click)="toggleSettingsMenu()"
              [appTooltip]="'pwa.clearCacheTitle' | translate"
              aria-label="PWA and Cache Settings"
              class="h-9 w-9 flex items-center justify-center rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/80 transition flex-shrink-0">
              <svg lucideSettings class="w-4 h-4"></svg>
            </button>

            <!-- Settings Menu Dropdown -->
            @if (isSettingsMenuOpen()) {
              <div 
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl p-1.5 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                <button 
                  (click)="onCheckUpdates()"
                  class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 transition text-left">
                  <svg 
                    lucideRefreshCw 
                    class="w-4 h-4 text-sky-400" 
                    [class.animate-spin]="pwaService.checkingForUpdate()">
                  </svg>
                  <span>{{ 'header.checkForUpdates' | translate }}</span>
                </button>

                <button 
                  (click)="onClearCache()"
                  class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 transition text-left">
                  <svg lucideTrash class="w-4 h-4 text-rose-400"></svg>
                  <span>{{ 'header.clearCache' | translate }}</span>
                </button>
              </div>
            }
          </div>

          <!-- User Authentication Section -->
          @if (authService.currentUser(); as user) {
            <button 
              (click)="authService.openProfileDrawer()"
              class="h-9 flex items-center gap-2 p-1 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition flex-shrink-0">
              <img [src]="user.avatar_url" [alt]="user.username" class="w-7 h-7 rounded-lg object-cover" />
              <span class="hidden lg:inline text-xs font-bold text-white pr-2 max-w-[90px] truncate">
                {{ user.display_name || user.username }}
              </span>
            </button>
          } @else {
            <button 
              (click)="authService.openAuthModal()"
              class="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0">
              <svg lucideUser class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
              <span class="whitespace-nowrap">Sign In</span>
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
    const current = this.selectedType();
    this.packageService.setTypeFilter(current === type ? 'all' : type);
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

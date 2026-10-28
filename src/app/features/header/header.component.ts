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
  LucideCheck,
  LucideGitBranch,
  LucideLanguages
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
    LucideCheck,
    LucideGitBranch,
    LucideLanguages
  ],
  template: `
    <header class="sticky top-0 z-40 w-full bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 transition-colors duration-200">
      <div class="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3 lg:gap-6">

        <!-- Left: Logo & Category Tabs (Aligned to Left Corner) -->
        <div class="flex items-center gap-3 xl:gap-5 flex-shrink-0 justify-start">
          <a href="#" class="flex items-center gap-2.5 group focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-lg p-1 flex-shrink-0">
            <img src="logo.svg" alt="LuantiHub" width="32" height="32" class="w-8 h-8 rounded-xl shadow-md group-hover:scale-105 transition-transform flex-shrink-0" />
            <div class="flex items-center gap-2">
              <span class="text-base sm:text-lg font-black tracking-tight text-white whitespace-nowrap">
                Luanti<span class="text-sky-400">Hub</span>
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
              <svg lucideGitBranch class="w-3.5 h-3.5 text-amber-400"></svg>
              <span>{{ 'header.filterGit' | translate }}</span>
            </button>
          </nav>
        </div>

        <!-- Center: Expanded Search Input -->
        <div class="flex-1 max-w-xl mx-2 sm:mx-4 relative min-w-[140px]">
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

        <!-- Right: Actions, Language & Prominent Install Button (Aligned to Right Corner) -->
        <div class="flex items-center gap-2 flex-shrink-0 justify-end">

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
              <svg lucideLanguages class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
              <span class="text-[11px] font-bold uppercase tracking-wider font-mono">{{ currentLocaleMeta().id }}</span>
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
                    <span class="text-xs font-mono font-bold text-sky-400 w-5 uppercase">{{ loc.id }}</span>
                    <span class="flex-1">{{ loc.nativeLabel }}</span>
                    @if (loc.id === currentLocale()) {
                      <svg lucideCheck class="w-3.5 h-3.5 text-white"></svg>
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
                class="absolute right-0 mt-2 w-64 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl p-2 z-50 space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
                <button
                  (click)="onCheckUpdates()"
                  [disabled]="pwaService.checkingForUpdate()"
                  class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 transition text-left">
                  <svg
                    lucideRefreshCw
                    class="w-4 h-4 text-sky-400"
                    [class.animate-spin]="pwaService.checkingForUpdate()">
                  </svg>
                  <span>{{ 'header.checkForUpdates' | translate }}</span>
                </button>

                @if (updateFeedback()) {
                  <div class="px-2.5 py-2 rounded-lg text-[11px] font-medium transition flex items-center gap-2"
                    [class.bg-sky-950/60]="pwaService.checkingForUpdate()"
                    [class.text-sky-300]="pwaService.checkingForUpdate()"
                    [class.bg-emerald-950/60]="!pwaService.checkingForUpdate() && !pwaService.updateAvailable()"
                    [class.text-emerald-300]="!pwaService.checkingForUpdate() && !pwaService.updateAvailable()"
                    [class.bg-amber-950/60]="pwaService.updateAvailable()"
                    [class.text-amber-300]="pwaService.updateAvailable()">
                    @if (pwaService.checkingForUpdate()) {
                      <svg lucideRefreshCw class="w-3.5 h-3.5 animate-spin flex-shrink-0 text-sky-400"></svg>
                    } @else if (pwaService.updateAvailable()) {
                      <svg lucideDownload class="w-3.5 h-3.5 flex-shrink-0 text-amber-400"></svg>
                    } @else {
                      <svg lucideCheck class="w-3.5 h-3.5 flex-shrink-0 text-emerald-400"></svg>
                    }
                    <span class="flex-1">{{ updateFeedback() }}</span>
                    @if (pwaService.updateAvailable()) {
                      <button 
                        (click)="pwaService.activateUpdate()"
                        class="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] whitespace-nowrap">
                        Reload
                      </button>
                    }
                  </div>
                }

                <div class="h-px bg-slate-800 my-1"></div>

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
  readonly updateFeedback = signal<string | null>(null);

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

  async onCheckUpdates(): Promise<void> {
    this.updateFeedback.set('Checking for updates...');
    const hasUpdate = await this.pwaService.checkForUpdate(true);
    if (hasUpdate) {
      this.updateFeedback.set('New update available!');
    } else {
      this.updateFeedback.set('You are on the latest version.');
      setTimeout(() => {
        if (this.updateFeedback() === 'You are on the latest version.') {
          this.updateFeedback.set(null);
        }
      }, 4000);
    }
  }

  onClearCache(): void {
    if (confirm('Clear all cached files, service workers, and reload LuantiHub?')) {
      this.pwaService.forceClearCacheAndReload();
    }
    this.isSettingsMenuOpen.set(false);
  }
}

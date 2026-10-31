import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  ElementRef,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/i18n/translation.service';
import { LocaleId } from '../../core/i18n/translation.types';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { FrostedPreloaderComponent } from '../../shared/components/frosted-preloader.component';
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
  LucideHouse,
  LucideGamepad2,
  LucideCpu,
  LucidePalette,
  LucideCheck,
  LucideGitBranch,
  LucideLanguages,
  LucideHeart,
  LucideShieldAlert,
  LucideMenu,
  LucideShare2,
  LucideCopy,
  LucideExternalLink
} from '@lucide/angular';

@Component({
  selector: 'app-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; position: sticky; top: 0; z-index: 40; width: 100%; }'],
  imports: [
    CommonModule,
    FormsModule,
    TooltipDirective,
    FrostedPreloaderComponent,
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
    LucideHouse,
    LucideGamepad2,
    LucideCpu,
    LucidePalette,
    LucideCheck,
    LucideGitBranch,
    LucideLanguages,
    LucideHeart,
    LucideShieldAlert,
    LucideMenu,
    LucideShare2,
    LucideCopy,
    LucideExternalLink
  ],
  template: `
    <!-- Reusable Standard Modal/Sidebar Backdrop Blur for Mobile Hamburger Menu -->
    @if (isMobileMenuOpen()) {
      <div
        (click)="closeMobileMenu($event)"
        class="lg:hidden z-30 luanti-modal-backdrop cursor-pointer"
        aria-hidden="true">
      </div>
    }

    <header class="sticky top-0 z-40 w-full max-w-[100vw] glass-header luanti-wco-header transition-colors duration-200">
      <div class="w-full px-3 sm:px-6 lg:px-8 h-13 sm:h-15 flex items-center justify-between gap-2 lg:gap-4">

        <!-- Left: Logo & Category Tabs -->
        <div class="flex items-center gap-2.5 2xl:gap-4 flex-shrink-0 justify-start">
          <button
            type="button"
            (click)="onHomeClick()"
            class="flex items-center gap-2 group focus:outline-none focus:ring-2 focus:ring-sky-500 rounded-lg p-1 flex-shrink-0 cursor-pointer">
            <img src="/logo.svg" alt="Luanti Hub" width="32" height="32" class="w-7 h-7 sm:w-8 sm:h-8 rounded-xl shadow-md group-hover:scale-105 transition-transform flex-shrink-0" />
            <h1 class="text-sm sm:text-lg font-black tracking-tight text-white whitespace-nowrap m-0 inline-block">
              Luanti<span class="text-sky-400">Hub</span>
            </h1>
          </button>

          <!-- Category Nav Tabs (Wide Desktop 2xl+) -->
          <nav class="hidden 2xl:flex items-center gap-1.5 text-xs font-semibold flex-shrink-0" aria-label="Category navigation">
            <button
              type="button"
              (click)="selectNavTab('all')"
              [appTooltip]="'header.filterAll' | translate"
              [class]="!packageService.hasActiveFilters() ? 'glass-btn-sky text-sky-200' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <svg lucideHouse class="w-3.5 h-3.5 text-sky-400"></svg>
              <span>{{ 'header.filterAll' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="selectNavTab('game')"
              [appTooltip]="'header.filterGames' | translate"
              [class]="selectedType() === 'game' ? 'glass-btn-emerald text-emerald-200' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <svg lucideGamepad2 class="w-3.5 h-3.5 text-emerald-400"></svg>
              <span>{{ 'header.filterGames' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="selectNavTab('mod')"
              [appTooltip]="'header.filterMods' | translate"
              [class]="selectedType() === 'mod' ? 'glass-btn-sky text-sky-200' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <svg lucideCpu class="w-3.5 h-3.5 text-sky-400"></svg>
              <span>{{ 'header.filterMods' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="selectNavTab('txp')"
              [appTooltip]="'header.filterTxp' | translate"
              [class]="selectedType() === 'txp' ? 'glass-btn-purple text-purple-200' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <svg lucidePalette class="w-3.5 h-3.5 text-purple-400"></svg>
              <span>{{ 'header.filterTxp' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="selectNavTab('git')"
              [appTooltip]="'header.filterGit' | translate"
              [class]="selectedSource() === 'git' ? 'glass-btn-amber text-amber-200' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <svg lucideGitBranch class="w-3.5 h-3.5 text-amber-400"></svg>
              <span>{{ 'header.filterGit' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="selectNavTab('favorites')"
              [appTooltip]="'header.favoritesFilter' | translate"
              [class]="packageService.showFavoritesOnly() ? 'glass-btn-rose text-rose-200' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-2.5 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer">
              <svg
                lucideHeart
                class="w-3.5 h-3.5 text-rose-400"
                [style.fill]="packageService.showFavoritesOnly() ? '#f43f5e' : 'none'"
                [color]="'#fb7185'">
              </svg>
              <span>{{ 'header.favoritesFilter' | translate }}</span>
              @if (settingsService.favorites().length > 0) {
                <span class="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold">
                  {{ settingsService.favorites().length }}
                </span>
              }
            </button>
          </nav>
        </div>

        <!-- Center: Elastic Debounced Search Input -->
        <div class="flex-1 min-w-[140px] sm:min-w-[220px] md:min-w-[260px] max-w-xl mx-1.5 sm:mx-3 relative">
          <div class="relative">
            <input
              type="search"
              [value]="searchInput()"
              (input)="onSearchInput($event)"
              [placeholder]="'header.searchPlaceholder' | translate"
              [attr.aria-label]="'header.searchPlaceholder' | translate"
              [appTooltip]="'header.searchTooltip' | translate"
              appTooltipShortcut="/"
              id="main-search-input"
              class="w-full glass-input text-white placeholder-slate-400 text-xs sm:text-sm rounded-xl pl-8 sm:pl-9 pr-7 sm:pr-8 py-1.5 sm:py-2 focus:outline-none transition"
            />
            <div class="absolute inset-y-0 left-0 pl-2.5 sm:pl-3 flex items-center pointer-events-none text-slate-400">
              <svg lucideSearch class="w-3.5 h-3.5 sm:w-4 sm:h-4"></svg>
            </div>
            @if (searchInput()) {
              <button
                type="button"
                (click)="clearSearch()"
                class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-white cursor-pointer"
                aria-label="Clear search">
                <svg lucideX class="w-3.5 h-3.5 sm:w-4 sm:h-4"></svg>
              </button>
            }
          </div>
        </div>

        <!-- Right: Actions, Language, Profile & Mobile Hamburger Toggle -->
        <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 justify-end">

          <!-- Prominent "Install App" Button (lg+, hidden when already installed or running in standalone PWA) -->
          @if (!pwaService.isInstalled()) {
            <button
              type="button"
              (click)="pwaService.installPwa()"
              [appTooltip]="'header.installAppTooltip' | translate"
              [class]="pwaService.canInstall() ? 'glass-btn-sky text-white animate-pulse' : 'glass-btn text-sky-400'"
              class="hidden lg:flex h-9 px-3 rounded-lg text-xs font-bold items-center gap-1.5 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              <svg lucideDownload class="w-4 h-4 flex-shrink-0"></svg>
              <span class="whitespace-nowrap">{{ 'header.installApp' | translate }}</span>
            </button>
          }

          <!-- Submit Mod Button (lg+) -->
          <button
            type="button"
            (click)="packageService.openSubmitModal()"
            [appTooltip]="'header.submitRepoTooltip' | translate"
            class="hidden lg:flex h-9 px-3 rounded-lg glass-btn text-white font-medium text-xs items-center gap-1.5 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
            <svg lucidePlus class="w-4 h-4 text-amber-400 flex-shrink-0"></svg>
            <span class="whitespace-nowrap">{{ 'header.submitRepo' | translate }}</span>
          </button>

          <!-- Language Selector Dropdown (lg+) -->
          <div #langMenuContainer class="hidden lg:block relative flex-shrink-0">
            <button
              type="button"
              (click)="toggleLanguageMenu($event)"
              [appTooltip]="'header.languageTooltip' | translate"
              aria-label="Change language"
              [attr.aria-expanded]="isLanguageMenuOpen()"
              class="h-9 px-2.5 rounded-lg glass-btn text-slate-200 hover:text-white text-xs font-medium flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              <svg lucideLanguages class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
              <span class="text-[11px] font-bold uppercase tracking-wider font-mono">{{ currentLocaleMeta().id }}</span>
              <svg lucideChevronDown [class]="isLanguageMenuOpen() ? 'w-3.5 h-3.5 text-slate-400 transition-transform rotate-180' : 'w-3.5 h-3.5 text-slate-400 transition-transform'"></svg>
            </button>

            @if (isLanguageMenuOpen()) {
              <div
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-44 rounded-xl glass-dropdown py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                @for (loc of supportedLocales; track loc.id) {
                  <button
                    type="button"
                    (click)="selectLanguage(loc.id)"
                    [class.bg-sky-500/25]="loc.id === currentLocale()"
                    [class.text-white]="loc.id === currentLocale()"
                    [class.text-slate-300]="loc.id !== currentLocale()"
                    class="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium hover:bg-white/10 transition text-left cursor-pointer">
                    <span class="text-xs font-mono font-bold text-sky-400 w-5 uppercase">{{ loc.id }}</span>
                    <span class="flex-1">{{ loc.nativeLabel }}</span>
                    @if (loc.id === currentLocale()) {
                      <svg lucideCheck class="w-3.5 h-3.5 text-sky-400"></svg>
                    }
                  </button>
                }
              </div>
            }
          </div>

          <!-- Ko-fi Support Menu Toggle (lg+) -->
          <div #kofiMenuContainer class="hidden lg:block relative flex-shrink-0">
            <button
              type="button"
              (click)="toggleKofiMenu($event)"
              [appTooltip]="'header.supportKofiTooltip' | translate"
              [attr.aria-label]="'header.supportKofi' | translate"
              [attr.aria-expanded]="isKofiMenuOpen()"
              [class.border-rose-500/40]="isKofiMenuOpen()"
              class="h-9 w-9 flex items-center justify-center rounded-lg glass-btn text-slate-300 hover:border-rose-500/30 transition flex-shrink-0 cursor-pointer">
              <svg class="w-5 h-5 flex-shrink-0" viewBox="15 18 292 222" fill="none" aria-hidden="true">
                <path fill="#202020" d="M66 25 H242 C278 25 301 51 301 89 C301 127 278 153 242 153 H238 C227 202 187 234 134 234 C72 234 21 190 21 118 V70 C21 41 38 25 66 25 Z"/>
                <path fill="#FFFFFF" d="M66 47 H240 C263 47 278 64 278 89 C278 114 263 131 240 131 H219 C215 178 181 211 134 211 C84 211 44 176 44 118 V70 C44 54 52 47 66 47 Z"/>
                <path fill="#202020" d="M222 69 H236 C246 69 253 77 253 89 C253 101 246 109 236 109 H222 V69 Z"/>
                <path fill="#FF5A16" d="M134.5 91 C126 77 114 72 102 72 C84 72 73 86 73 105 C73 134 106 160 128 176 C132 179 137 179 141 176 C163 160 196 134 196 105 C196 86 185 72 167 72 C155 72 143 77 134.5 91 Z"/>
              </svg>
            </button>

            @if (isKofiMenuOpen()) {
              <div
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-[340px] sm:w-[360px] rounded-2xl glass-dropdown p-2.5 z-50 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                <div class="flex items-center justify-between px-1.5 py-0.5">
                  <div class="flex items-center gap-2 text-xs font-bold text-white">
                    <svg class="w-4 h-4 flex-shrink-0" viewBox="15 18 292 222" fill="none" aria-hidden="true">
                      <path fill="#202020" d="M66 25 H242 C278 25 301 51 301 89 C301 127 278 153 242 153 H238 C227 202 187 234 134 234 C72 234 21 190 21 118 V70 C21 41 38 25 66 25 Z"/>
                      <path fill="#FFFFFF" d="M66 47 H240 C263 47 278 64 278 89 C278 114 263 131 240 131 H219 C215 178 181 211 134 211 C84 211 44 176 44 118 V70 C44 54 52 47 66 47 Z"/>
                      <path fill="#202020" d="M222 69 H236 C246 69 253 77 253 89 C253 101 246 109 236 109 H222 V69 Z"/>
                      <path fill="#FF5A16" d="M134.5 91 C126 77 114 72 102 72 C84 72 73 86 73 105 C73 134 106 160 128 176 C132 179 137 179 141 176 C163 160 196 134 196 105 C196 86 185 72 167 72 C155 72 143 77 134.5 91 Z"/>
                    </svg>
                    <span>{{ 'header.supportKofi' | translate }}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <a
                      href="https://ko-fi.com/sakel"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open Ko-fi in new tab"
                      class="p-1.5 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer">
                      <svg lucideExternalLink class="w-3.5 h-3.5"></svg>
                    </a>
                    <button
                      type="button"
                      (click)="isKofiMenuOpen.set(false)"
                      aria-label="Close Ko-fi panel"
                      class="p-1.5 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer">
                      <svg lucideX class="w-3.5 h-3.5"></svg>
                    </button>
                  </div>
                </div>

                <div class="rounded-xl overflow-hidden bg-[#0f172a]">
                  <iframe
                    id="kofiframe"
                    src="https://ko-fi.com/sakel/?hidefeed=true&widget=true&embed=true&preview=true"
                    style="border:none;width:100%;padding:4px;background:#0f172a;color-scheme:normal;"
                    height="620"
                    loading="lazy"
                    title="sakel">
                  </iframe>
                </div>
              </div>
            }
          </div>

          <!-- PWA & Cache Settings Menu Toggle (lg+) -->
          <div #settingsMenuContainer class="hidden lg:block relative flex-shrink-0">
            <button
              type="button"
              (click)="toggleSettingsMenu($event)"
              [appTooltip]="'pwa.clearCacheTitle' | translate"
              aria-label="PWA and Cache Settings"
              [attr.aria-expanded]="isSettingsMenuOpen()"
              class="h-9 w-9 flex items-center justify-center rounded-lg glass-btn text-slate-300 hover:text-white transition flex-shrink-0 cursor-pointer">
              <svg lucideSettings class="w-4 h-4"></svg>
            </button>

            @if (isSettingsMenuOpen()) {
              <div
                (click)="$event.stopPropagation()"
                class="absolute right-0 mt-2 w-72 rounded-xl glass-dropdown p-2.5 z-50 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                <button
                  type="button"
                  (click)="packageService.openSetupModal(); isSettingsMenuOpen.set(false)"
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-white/10 transition text-left cursor-pointer">
                  <svg lucideTerminal class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                  <span>{{ 'header.inGameSetup' | translate }}</span>
                </button>

                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    (click)="onShareApp()"
                    [appTooltip]="'header.shareAppTooltip' | translate"
                    class="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-white/10 transition text-left cursor-pointer">
                    <svg lucideShare2 class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                    <span>{{ 'header.shareApp' | translate }}</span>
                  </button>
                  <button
                    type="button"
                    (click)="onCopyAppLink($event)"
                    [appTooltip]="'modal.copyConfig' | translate"
                    aria-label="Copy app link"
                    class="h-8 w-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition flex-shrink-0 cursor-pointer">
                    <svg lucideCopy class="w-3.5 h-3.5 text-sky-400"></svg>
                  </button>
                </div>

                <div class="h-px bg-white/10 my-1"></div>

                <button
                  type="button"
                  (click)="onCheckUpdates($event)"
                  [disabled]="isCheckingUpdates()"
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50 transition text-left cursor-pointer">
                  <svg
                    lucideRefreshCw
                    [class]="isCheckingUpdates() ? 'w-4 h-4 text-sky-400 flex-shrink-0 animate-spin' : 'w-4 h-4 text-sky-400 flex-shrink-0'">
                  </svg>
                  <span>{{ 'header.checkForUpdates' | translate }}</span>
                </button>

                @if (updateFeedback()) {
                  <div class="px-3 py-2 rounded-lg text-[11px] font-medium transition flex items-center gap-2 border bg-slate-950/80 border-white/10 text-slate-300">
                    <span class="flex-1">{{ updateFeedback() }}</span>
                    @if (pwaService.updateAvailable()) {
                      <button
                        type="button"
                        (click)="pwaService.activateUpdate()"
                        class="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] whitespace-nowrap cursor-pointer">
                        {{ 'pwa.updateReload' | translate }}
                      </button>
                    }
                  </div>
                }

                <div class="h-px bg-white/10 my-1"></div>

                <a
                  href="https://github.com/sakel-hub/luanti-hub/issues/new/choose"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200 hover:bg-white/10 transition text-left cursor-pointer">
                  <svg class="w-4 h-4 fill-current text-sky-400 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"></path>
                  </svg>
                  <span>{{ 'header.reportIssue' | translate }}</span>
                </a>

                <div class="h-px bg-white/10 my-1"></div>

                <button
                  type="button"
                  (click)="onClearCache($event)"
                  [class]="confirmingClearCache() ? 'glass-btn-rose text-rose-100' : 'text-rose-300 hover:bg-rose-500/20 hover:text-rose-200'"
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition text-left cursor-pointer">
                  <svg lucideTrash class="w-4 h-4 text-rose-400 flex-shrink-0"></svg>
                  <span>{{ (confirmingClearCache() ? 'header.clearCacheConfirm' : 'header.clearCache') | translate }}</span>
                </button>
              </div>
            }
          </div>

          <!-- User Authentication Section -->
          @if (authService.currentUser(); as user) {
            <button
              type="button"
              (click)="authService.openProfileDrawer()"
              class="relative h-9 flex items-center gap-2 p-1 rounded-xl glass-btn transition flex-shrink-0 cursor-pointer">
              <img [src]="user.avatar_url" [alt]="user.username" class="w-7 h-7 rounded-lg object-cover" />
              <span class="hidden lg:inline text-xs font-bold text-white pr-2 max-w-[96px] truncate">
                {{ user.display_name || user.username }}
              </span>
              @if (authService.isAdmin()) {
                <span class="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[9px] font-black uppercase mr-1">
                  <svg lucideShieldAlert class="w-2.5 h-2.5"></svg>
                  Admin
                </span>
              }
              @if (authService.openReportsCount() > 0) {
                <span class="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full glass-badge glass-badge-rose text-[10px] font-black flex items-center justify-center shadow">
                  {{ authService.openReportsCount() }}
                </span>
              }
            </button>
          } @else if (authService.isLoading() || authService.isBusyAuthenticating()) {
            <app-frosted-preloader
              variant="pill"
              size="sm"
              [label]="(authService.isBusyAuthenticating() ? 'auth.signingIn' : 'auth.loading') | translate">
            </app-frosted-preloader>
          } @else {
            <button
              type="button"
              (click)="authService.openAuthModal()"
              [attr.aria-label]="'header.signIn' | translate"
              class="h-9 px-2.5 sm:px-3 rounded-lg glass-btn text-white font-semibold text-xs flex items-center gap-1.5 transition whitespace-nowrap flex-shrink-0 cursor-pointer">
              <svg lucideUser class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
              <span class="hidden sm:inline whitespace-nowrap">{{ 'header.signIn' | translate }}</span>
            </button>
          }

          <!-- Hamburger Menu Button for Small / Tablet Screens (< lg) -->
          <button
            type="button"
            (click)="toggleMobileMenu($event)"
            [attr.aria-expanded]="isMobileMenuOpen()"
            aria-label="Toggle navigation menu"
            class="lg:hidden h-9 w-9 flex items-center justify-center rounded-lg glass-btn text-slate-200 hover:text-white transition flex-shrink-0 cursor-pointer">
            @if (isMobileMenuOpen()) {
              <svg lucideX class="w-5 h-5 text-sky-400"></svg>
            } @else {
              <svg lucideMenu class="w-5 h-5"></svg>
            }
          </button>

        </div>

      </div>

      <!-- Translucent Frosted-Glass Category Navigation Strip (< 2xl) -->
      <div class="2xl:hidden border-t border-white/10 bg-white/[0.02] px-3 sm:px-6 lg:px-8 py-1.5 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar max-w-full">
        <button
          type="button"
          (click)="selectNavTab('all')"
          [class]="!packageService.hasActiveFilters() ? 'glass-btn-sky text-sky-200' : 'glass-btn text-slate-300 hover:text-white'"
          class="px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer">
          <svg lucideHouse class="w-3.5 h-3.5 text-sky-400"></svg>
          <span>{{ 'header.filterAll' | translate }}</span>
        </button>

        <button
          type="button"
          (click)="selectNavTab('game')"
          [class]="selectedType() === 'game' ? 'glass-btn-emerald text-emerald-200' : 'glass-btn text-slate-300 hover:text-white'"
          class="px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer">
          <svg lucideGamepad2 class="w-3.5 h-3.5 text-emerald-400"></svg>
          <span>{{ 'header.filterGames' | translate }}</span>
        </button>

        <button
          type="button"
          (click)="selectNavTab('mod')"
          [class]="selectedType() === 'mod' ? 'glass-btn-sky text-sky-200' : 'glass-btn text-slate-300 hover:text-white'"
          class="px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer">
          <svg lucideCpu class="w-3.5 h-3.5 text-sky-400"></svg>
          <span>{{ 'header.filterMods' | translate }}</span>
        </button>

        <button
          type="button"
          (click)="selectNavTab('txp')"
          [class]="selectedType() === 'txp' ? 'glass-btn-purple text-purple-200' : 'glass-btn text-slate-300 hover:text-white'"
          class="px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer">
          <svg lucidePalette class="w-3.5 h-3.5 text-purple-400"></svg>
          <span>{{ 'header.filterTxp' | translate }}</span>
        </button>

        <button
          type="button"
          (click)="selectNavTab('git')"
          [class]="selectedSource() === 'git' ? 'glass-btn-amber text-amber-200' : 'glass-btn text-slate-300 hover:text-white'"
          class="px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer">
          <svg lucideGitBranch class="w-3.5 h-3.5 text-amber-400"></svg>
          <span>{{ 'header.filterGit' | translate }}</span>
        </button>

        <button
          type="button"
          (click)="selectNavTab('favorites')"
          [class]="packageService.showFavoritesOnly() ? 'glass-btn-rose text-rose-200' : 'glass-btn text-slate-300 hover:text-white'"
          class="px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 cursor-pointer">
          <svg
            lucideHeart
            class="w-3.5 h-3.5 text-rose-400"
            [style.fill]="packageService.showFavoritesOnly() ? '#f43f5e' : 'none'"
            [color]="'#fb7185'">
          </svg>
          <span>{{ 'header.favoritesFilter' | translate }} ({{ settingsService.favorites().length }})</span>
        </button>
      </div>

      <!-- Mobile / Tablet Hamburger Drawer Menu (< lg) -->
      @if (isMobileMenuOpen()) {
        <div
          (click)="$event.stopPropagation()"
          class="lg:hidden border-t border-white/10 glass-dropdown px-4 py-4 space-y-4 animate-in fade-in duration-150 max-h-[80vh] overflow-y-auto">

          <!-- Quick Actions Grid -->
          <div [class]="pwaService.isInstalled() ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'grid grid-cols-1 sm:grid-cols-3 gap-2'">
            <button
              type="button"
              (click)="packageService.openSubmitModal(); isMobileMenuOpen.set(false)"
              class="px-3.5 py-2.5 rounded-xl glass-btn text-amber-300 font-semibold text-xs flex items-center gap-2 cursor-pointer">
              <svg lucidePlus class="w-4 h-4 text-amber-400 flex-shrink-0"></svg>
              <span>{{ 'header.submitRepo' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="packageService.openSetupModal(); isMobileMenuOpen.set(false)"
              class="px-3.5 py-2.5 rounded-xl glass-btn text-sky-300 font-semibold text-xs flex items-center gap-2 cursor-pointer">
              <svg lucideTerminal class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
              <span>{{ 'header.inGameSetup' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="onShareApp()"
              class="px-3.5 py-2.5 rounded-xl glass-btn text-slate-200 hover:text-white font-semibold text-xs flex items-center gap-2 cursor-pointer">
              <svg lucideShare2 class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
              <span>{{ 'header.shareApp' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="toggleMobileKofi()"
              class="px-3.5 py-2.5 rounded-xl glass-btn text-slate-200 hover:text-white font-semibold text-xs flex items-center gap-2 cursor-pointer">
              <svg class="w-4 h-4 flex-shrink-0" viewBox="15 18 292 222" fill="none" aria-hidden="true">
                <path fill="#202020" d="M66 25 H242 C278 25 301 51 301 89 C301 127 278 153 242 153 H238 C227 202 187 234 134 234 C72 234 21 190 21 118 V70 C21 41 38 25 66 25 Z"/>
                <path fill="#FFFFFF" d="M66 47 H240 C263 47 278 64 278 89 C278 114 263 131 240 131 H219 C215 178 181 211 134 211 C84 211 44 176 44 118 V70 C44 54 52 47 66 47 Z"/>
                <path fill="#202020" d="M222 69 H236 C246 69 253 77 253 89 C253 101 246 109 236 109 H222 V69 Z"/>
                <path fill="#FF5A16" d="M134.5 91 C126 77 114 72 102 72 C84 72 73 86 73 105 C73 134 106 160 128 176 C132 179 137 179 141 176 C163 160 196 134 196 105 C196 86 185 72 167 72 C155 72 143 77 134.5 91 Z"/>
              </svg>
              <span>{{ 'header.supportKofi' | translate }}</span>
            </button>

            @if (!pwaService.isInstalled()) {
              <button
                type="button"
                (click)="pwaService.installPwa(); isMobileMenuOpen.set(false)"
                class="px-3.5 py-2.5 rounded-xl glass-btn text-emerald-300 font-semibold text-xs flex items-center gap-2 cursor-pointer">
                <svg lucideDownload class="w-4 h-4 text-emerald-400 flex-shrink-0"></svg>
                <span>{{ 'header.installApp' | translate }}</span>
              </button>
            }
          </div>

          @if (isMobileKofiOpen()) {
            <div class="rounded-2xl overflow-hidden bg-[#0f172a]">
              <iframe
                src="https://ko-fi.com/sakel/?hidefeed=true&widget=true&embed=true&preview=true"
                style="border:none;width:100%;padding:4px;background:#0f172a;color-scheme:normal;"
                height="580"
                loading="lazy"
                title="sakel">
              </iframe>
            </div>
          }

          <!-- GitHub Issues & Feedback Quick Link (Mobile) -->
          <a
            href="https://github.com/sakel-hub/luanti-hub/issues/new/choose"
            target="_blank"
            rel="noopener noreferrer"
            class="w-full px-3.5 py-2.5 rounded-xl glass-btn text-slate-200 hover:text-white font-semibold text-xs flex items-center justify-between cursor-pointer">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 fill-current text-sky-400 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"></path>
              </svg>
              <span>{{ 'header.reportIssue' | translate }}</span>
            </div>
            <span class="text-[10px] text-slate-400 font-mono">github.com</span>
          </a>

          <!-- Language Selector Pills -->
          <div class="space-y-1.5 pt-2 border-t border-white/10">
            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <svg lucideLanguages class="w-3.5 h-3.5 text-sky-400"></svg>
              <span>{{ 'header.languageTooltip' | translate }}</span>
            </span>
            <div class="flex flex-wrap gap-1.5">
              @for (loc of supportedLocales; track loc.id) {
                <button
                  type="button"
                  (click)="selectLanguage(loc.id)"
                  [class]="loc.id === currentLocale() ? 'bg-sky-500/25 text-white border-sky-400/50' : 'glass-pill text-slate-300 hover:text-white'"
                  class="px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 cursor-pointer">
                  <span class="font-mono font-bold text-sky-400 uppercase text-[11px]">{{ loc.id }}</span>
                  <span>{{ loc.nativeLabel }}</span>
                </button>
              }
            </div>
          </div>

          <!-- App Updates & Offline Cache Controls -->
          <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              (click)="onCheckUpdates($event)"
              [disabled]="isCheckingUpdates()"
              class="px-3 py-1.5 rounded-lg glass-btn text-xs font-semibold text-slate-200 flex items-center gap-2 cursor-pointer">
              <svg lucideRefreshCw [class]="isCheckingUpdates() ? 'w-3.5 h-3.5 text-sky-400 animate-spin' : 'w-3.5 h-3.5 text-sky-400'"></svg>
              <span>{{ 'header.checkForUpdates' | translate }}</span>
            </button>

            <button
              type="button"
              (click)="onClearCache($event)"
              [class]="confirmingClearCache() ? 'glass-btn-rose text-rose-100' : 'glass-btn text-rose-300'"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer">
              <svg lucideTrash class="w-3.5 h-3.5 text-rose-400"></svg>
              <span>{{ (confirmingClearCache() ? 'header.clearCacheConfirm' : 'header.clearCache') | translate }}</span>
            </button>
          </div>
        </div>
      }
    </header>
  `
})
export class HeaderComponent {
  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);
  readonly translationService = inject(TranslationService);
  private readonly hostEl = inject(ElementRef<HTMLElement>);

  readonly searchInput = this.packageService.searchInput;
  readonly selectedType = this.packageService.selectedType;
  readonly selectedSource = this.packageService.selectedSource;
  readonly currentLocale = this.translationService.currentLocale;
  readonly supportedLocales = this.translationService.supportedLocales;

  readonly isLanguageMenuOpen = signal<boolean>(false);
  readonly isSettingsMenuOpen = signal<boolean>(false);
  readonly isKofiMenuOpen = signal<boolean>(false);
  readonly isMobileMenuOpen = signal<boolean>(false);
  readonly isMobileKofiOpen = signal<boolean>(false);
  readonly isCheckingUpdates = signal<boolean>(false);
  readonly updateFeedback = signal<string | null>(null);
  readonly confirmingClearCache = signal<boolean>(false);
  private clearCacheConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isLanguageMenuOpen() && !this.isSettingsMenuOpen() && !this.isKofiMenuOpen() && !this.isMobileMenuOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.hostEl.nativeElement.contains(target)) {
      this.isLanguageMenuOpen.set(false);
      this.isSettingsMenuOpen.set(false);
      this.isKofiMenuOpen.set(false);
      this.isMobileMenuOpen.set(false);
      this.confirmingClearCache.set(false);
    } else {
      this.isLanguageMenuOpen.set(false);
      this.isSettingsMenuOpen.set(false);
      this.isKofiMenuOpen.set(false);
      this.confirmingClearCache.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.isLanguageMenuOpen.set(false);
    this.isSettingsMenuOpen.set(false);
    this.isKofiMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
    this.confirmingClearCache.set(false);
  }

  currentLocaleMeta() {
    return this.supportedLocales.find(l => l.id === this.currentLocale()) || this.supportedLocales[0];
  }

  onHomeClick(): void {
    this.isMobileMenuOpen.set(false);
    this.packageService.resetFilters(true);
  }

  selectNavTab(tab: 'all' | 'game' | 'mod' | 'txp' | 'git' | 'favorites'): void {
    this.isMobileMenuOpen.set(false);
    if (tab === 'all') {
      this.onHomeClick();
      return;
    }
    this.packageService.closeAllModals(false);
    this.packageService.selectPrimaryNavTab(tab);
  }

  toggleMobileMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.isMobileMenuOpen.update(v => !v);
    this.isLanguageMenuOpen.set(false);
    this.isSettingsMenuOpen.set(false);
    this.isKofiMenuOpen.set(false);
  }

  closeMobileMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.isMobileMenuOpen.set(false);
    this.isMobileKofiOpen.set(false);
  }

  toggleLanguageMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.isLanguageMenuOpen.update(v => !v);
    this.isSettingsMenuOpen.set(false);
    this.isKofiMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
  }

  toggleSettingsMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.isSettingsMenuOpen.update(v => !v);
    this.isLanguageMenuOpen.set(false);
    this.isKofiMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
  }

  toggleKofiMenu(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.isKofiMenuOpen.update(v => !v);
    this.isLanguageMenuOpen.set(false);
    this.isSettingsMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
  }

  toggleMobileKofi(): void {
    this.isMobileKofiOpen.update(v => !v);
  }

  selectLanguage(locale: LocaleId): void {
    this.translationService.setLocale(locale);
    this.isLanguageMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
  }

  onSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.packageService.setSearchQuery(input.value);
  }

  clearSearch(): void {
    this.packageService.setSearchQuery('');
  }

  async onCheckUpdates(event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    this.isCheckingUpdates.set(true);
    this.updateFeedback.set(this.translationService.translate('pwa.checking'));

    await new Promise(resolve => setTimeout(resolve, 600));

    const hasUpdate = await this.pwaService.checkForUpdate(true);
    this.isCheckingUpdates.set(false);

    if (hasUpdate) {
      this.updateFeedback.set(this.translationService.translate('pwa.updateAvailable'));
    } else {
      this.updateFeedback.set(this.translationService.translate('pwa.upToDate'));
      setTimeout(() => {
        this.updateFeedback.set(null);
      }, 4000);
    }
  }

  async onShareApp(): Promise<void> {
    this.isSettingsMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
    const title = `${this.translationService.translate('header.title')} — ${this.translationService.translate('header.subtitle')}`;
    await this.pwaService.shareApp(title);
  }

  async onCopyAppLink(event?: MouseEvent): Promise<void> {
    if (event) event.stopPropagation();
    await this.pwaService.copyAppLink();
    this.isSettingsMenuOpen.set(false);
  }

  onClearCache(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    if (!this.confirmingClearCache()) {
      this.confirmingClearCache.set(true);
      if (this.clearCacheConfirmTimer) {
        clearTimeout(this.clearCacheConfirmTimer);
      }
      this.clearCacheConfirmTimer = setTimeout(() => {
        this.confirmingClearCache.set(false);
        this.clearCacheConfirmTimer = null;
      }, 4500);
      return;
    }
    if (this.clearCacheConfirmTimer) {
      clearTimeout(this.clearCacheConfirmTimer);
      this.clearCacheConfirmTimer = null;
    }
    this.confirmingClearCache.set(false);
    this.isSettingsMenuOpen.set(false);
    this.isMobileMenuOpen.set(false);
    this.pwaService.forceClearCacheAndReload();
  }
}

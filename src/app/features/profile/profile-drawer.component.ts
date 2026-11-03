import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import {
  GitProvider,
  HeroPromotion,
  LuantiPackage,
  ModerationReport,
  PackageSource,
  PackageType,
  PromotionLocaleOverride,
  PromoRowIcon,
  PromoRowSortOption
} from '../../core/models/package.model';
import { LocaleId } from '../../core/i18n/translation.types';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { PackageBadgesComponent } from '../../shared/components/package-badges.component';
import { PROMO_ROW_ICON_OPTIONS, ThemeIconComponent } from '../../shared/components/theme-icon.component';
import {
  LucideX,
  LucideCheck,
  LucideGitBranch,
  LucideGlobe,
  LucidePlus,
  LucideHeart,
  LucideDownload,
  LucideTrash,
  LucideUser,
  LucideShieldAlert,
  LucideLayers,
  LucideTag,
  LucideRefreshCw,
  LucideMessageSquare,
  LucideChevronLeft,
  LucideChevronRight,
  LucideChevronDown,
  LucideChevronUp,
  LucideTrendingUp,
  LucideStar
} from '@lucide/angular';

@Component({
  selector: 'app-profile-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    CompactNumberPipe,
    TranslatePipe,
    ImgFallbackDirective,
    PackageBadgesComponent,
    ThemeIconComponent,
    LucideX,
    LucideCheck,
    LucideGitBranch,
    LucideGlobe,
    LucidePlus,
    LucideHeart,
    LucideDownload,
    LucideTrash,
    LucideUser,
    LucideShieldAlert,
    LucideLayers,
    LucideTag,
    LucideRefreshCw,
    LucideMessageSquare,
    LucideChevronLeft,
    LucideChevronRight,
    LucideChevronDown,
    LucideChevronUp,
    LucideTrendingUp,
    LucideStar
  ],
  template: `
    @if (authService.currentUser(); as user) {
      <div
        (click)="authService.closeProfileDrawer()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-drawer-title"
        class="z-50 flex justify-end luanti-modal-backdrop">

        <div
          (click)="$event.stopPropagation(); isPromoIconMenuOpen.set(false)"
          class="w-full max-w-2xl h-full glass-drawer flex flex-col p-5 sm:p-6 space-y-5 overflow-y-auto luanti-drawer-panel">

          <!-- Drawer Header -->
          <div class="flex items-center justify-between border-b border-white/10 pb-4">
            <div class="flex items-center gap-3.5 min-w-0">
              <div class="relative flex-shrink-0">
                <img [src]="user.avatar_url || 'logo.svg'" appImgFallback [alt]="user.username" class="w-12 h-12 rounded-2xl border border-white/20 shadow-lg object-cover bg-slate-900" />
                <span class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-slate-950"></span>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 id="profile-drawer-title" class="text-base sm:text-lg font-extrabold text-white truncate">
                    {{ user.display_name || user.username }}
                  </h2>
                  @if (authService.isAdmin()) {
                    <span class="glass-badge glass-badge-rose font-black uppercase tracking-wider">
                      Admin
                    </span>
                  }
                </div>
                <span class="text-xs text-sky-400 font-mono block truncate">&#64;{{ user.username }}</span>
                @if (user.bio) {
                  <p class="text-[11px] text-slate-300 line-clamp-1 mt-0.5">{{ user.bio }}</p>
                }
              </div>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                (click)="onPreviewPublicProfile()"
                class="px-2.5 py-1.5 rounded-xl glass-btn text-sky-300 hover:text-white text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer">
                <svg lucideUser class="w-3.5 h-3.5 text-sky-400"></svg>
                <span class="hidden sm:inline">{{ 'author.viewPublicProfile' | translate }}</span>
              </button>

              <button
                type="button"
                (click)="authService.closeProfileDrawer()"
                aria-label="Close profile drawer"
                class="p-2 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 flex-shrink-0 cursor-pointer">
                <svg lucideX class="w-4 h-4 sm:w-5 sm:h-5"></svg>
              </button>
            </div>
          </div>

          <!-- Adaptive Non-Truncating Navigation Tabs (My Packages, Favorites, Account, + Admin Moderation) -->
          <div
            role="tablist"
            class="flex flex-wrap gap-1.5 glass-panel p-1.5 rounded-2xl text-xs font-bold">
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === 'packages'"
              (click)="activeTab.set('packages')"
              [class]="activeTab() === 'packages' ? 'bg-sky-500/30 border border-sky-400/50 text-white shadow-sm' : 'border border-transparent text-slate-400 hover:text-white hover:bg-white/5'"
              class="flex-1 min-w-[130px] py-2 px-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer">
              <svg lucideLayers class="w-3.5 h-3.5 text-sky-400 flex-shrink-0"></svg>
              <span>{{ 'profile.tabPackages' | translate }}</span>
              <span class="glass-badge glass-badge-sky font-mono font-bold px-1.5 py-0">
                {{ userPackages().length }}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === 'favorites'"
              (click)="activeTab.set('favorites')"
              [class]="activeTab() === 'favorites' ? 'bg-rose-500/25 border border-rose-400/50 text-white shadow-sm' : 'border border-transparent text-slate-400 hover:text-white hover:bg-white/5'"
              class="flex-1 min-w-[125px] py-2 px-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer">
              <svg lucideHeart class="w-3.5 h-3.5 text-rose-400 flex-shrink-0"></svg>
              <span>{{ 'profile.tabFavorites' | translate }}</span>
              <span class="glass-badge glass-badge-rose font-mono font-bold px-1.5 py-0">
                {{ favoritePackages().length }}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === 'account'"
              (click)="onSelectAccountTab()"
              [class]="activeTab() === 'account' ? 'bg-sky-500/30 border border-sky-400/50 text-white shadow-sm' : 'border border-transparent text-slate-400 hover:text-white hover:bg-white/5'"
              class="flex-1 min-w-[120px] py-2 px-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer">
              <svg lucideUser class="w-3.5 h-3.5 text-sky-400 flex-shrink-0"></svg>
              <span>{{ 'profile.tabAccount' | translate }}</span>
            </button>

            @if (authService.isAdmin()) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="activeTab() === 'moderation'"
                (click)="onSelectModerationTab()"
                [class]="activeTab() === 'moderation' ? 'bg-rose-500/25 border border-rose-400/50 text-white shadow-sm' : 'border border-transparent text-rose-300/90 hover:text-rose-200 hover:bg-rose-500/10'"
                class="flex-1 min-w-[135px] py-2 px-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer">
                <svg lucideShieldAlert class="w-3.5 h-3.5 text-rose-400 flex-shrink-0"></svg>
                <span>{{ 'profile.tabModeration' | translate }}</span>
                @if (authService.openReportsCount() > 0) {
                  <span class="glass-badge glass-badge-rose font-black px-1.5 py-0">
                    {{ authService.openReportsCount() }}
                  </span>
                }
              </button>

              <button
                type="button"
                role="tab"
                [attr.aria-selected]="activeTab() === 'promotions'"
                (click)="onSelectPromotionsTab()"
                [class]="activeTab() === 'promotions' ? 'bg-amber-500/25 border border-amber-400/50 text-white shadow-sm' : 'border border-transparent text-amber-300/90 hover:text-amber-200 hover:bg-amber-500/10'"
                class="flex-1 min-w-[135px] py-2 px-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer">
                <svg lucideStar class="w-3.5 h-3.5 text-amber-400 flex-shrink-0"></svg>
                <span>{{ 'profile.tabPromotions' | translate }}</span>
                @if (packageService.activePromotions().length > 0) {
                  <span class="glass-badge glass-badge-amber font-black px-1.5 py-0">
                    {{ packageService.activePromotions().length }}
                  </span>
                }
              </button>
            }
          </div>

          <!-- TAB 1: MY PACKAGES -->
          @if (activeTab() === 'packages') {
            <div class="space-y-4 flex-1 luanti-tab-enter">
              <!-- User's Published Packages -->
              <div class="space-y-2.5">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {{ 'profile.myPackages' | translate }} ({{ userPackages().length }})
                  </h3>
                  <div class="flex items-center gap-2">
                    @if (canOpenAnalyticsDashboard()) {
                      <button
                        type="button"
                        (click)="onOpenAnalyticsDashboard()"
                        class="px-2.5 py-1 rounded-lg glass-btn-sky text-white text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer">
                        <svg lucideTrendingUp class="w-3.5 h-3.5"></svg>
                        <span>{{ 'analytics.openDashboardBtn' | translate }}</span>
                      </button>
                    }
                    <button
                      type="button"
                      (click)="onOpenSubmitModal()"
                      class="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition cursor-pointer">
                      <svg lucidePlus class="w-3.5 h-3.5"></svg>
                      <span>{{ 'profile.submitGitBtn' | translate }}</span>
                    </button>
                  </div>
                </div>

                @if (userPackages().length === 0) {
                  <div class="p-6 rounded-2xl glass-panel text-center space-y-3">
                    <p class="text-xs text-slate-400">{{ 'profile.noPackages' | translate }}</p>
                    <button
                      type="button"
                      (click)="onOpenSubmitModal()"
                      class="px-4 py-2 rounded-xl glass-btn-sky text-white text-xs font-bold transition cursor-pointer">
                      {{ 'profile.submitGitBtn' | translate }}
                    </button>
                  </div>
                } @else {
                  <div class="space-y-2">
                    @for (pkg of userPackages(); track pkg.id) {
                      <div class="p-3 rounded-2xl glass-panel space-y-2.5 text-xs hover:border-sky-400/40 transition">
                        <div class="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            (click)="openPackage(pkg)"
                            class="flex items-center gap-3 text-left flex-1 min-w-0 group cursor-pointer">
                            <img [src]="pkg.banner || pkg.thumbnail || 'logo.svg'" [fallbackThumbnail]="pkg.thumbnail || ''" appImgFallback [alt]="pkg.title" loading="lazy" decoding="async" class="w-10 h-10 rounded-xl object-cover bg-slate-900 flex-shrink-0 border border-white/10" />
                            <div class="min-w-0 flex-1">
                              <h4 class="font-bold text-white group-hover:text-sky-400 transition truncate">{{ pkg.title }}</h4>
                              <div class="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                                <span>{{ (pkg.downloads || 0) | compactNumber }} dl</span>
                                <span>•</span>
                                <app-package-badges
                                  [package]="pkg"
                                  [compact]="true"
                                  [showOfficial]="false"
                                  [showFeatured]="false">
                                </app-package-badges>
                                @if (pkg.status === 'delisted' || pkg.status === 'flagged') {
                                  <span class="glass-badge glass-badge-amber font-black uppercase tracking-wider text-[9px] px-1.5 py-0">
                                    {{ pkg.status }}
                                  </span>
                                }
                              </div>
                            </div>
                          </button>

                          <div class="flex items-center gap-1.5 flex-shrink-0">
                            @if (authService.canManagePackage(pkg)) {
                              <button
                                type="button"
                                (click)="onOpenPackageAnalytics(pkg)"
                                class="p-2 rounded-xl glass-icon-btn text-emerald-400 hover:text-white transition cursor-pointer"
                                [attr.title]="'modal.tabAnalytics' | translate"
                                [attr.aria-label]="'modal.tabAnalytics' | translate">
                                <svg lucideTrendingUp class="w-3.5 h-3.5"></svg>
                              </button>
                              <button
                                type="button"
                                (click)="openPackageAndEditTags(pkg)"
                                class="p-2 rounded-xl glass-icon-btn text-sky-400 hover:text-white transition cursor-pointer"
                                title="Edit Tags"
                                aria-label="Edit package tags">
                                <svg lucideTag class="w-3.5 h-3.5"></svg>
                              </button>
                            }
                            <button
                              type="button"
                              (click)="packageService.downloadPackage(pkg)"
                              class="p-2 rounded-xl glass-icon-btn text-slate-200 hover:text-white transition cursor-pointer"
                              [attr.aria-label]="'card.downloadZip' | translate">
                              <svg lucideDownload class="w-3.5 h-3.5"></svg>
                            </button>
                            @if (authService.canManagePackage(pkg)) {
                              <button
                                type="button"
                                (click)="toggleConfirmManagePackage(pkg.id)"
                                class="p-2 rounded-xl glass-icon-btn text-slate-400 hover:text-rose-400 transition cursor-pointer"
                                title="Delist or remove package"
                                aria-label="Delist or remove package">
                                <svg lucideTrash class="w-3.5 h-3.5"></svg>
                              </button>
                            }
                          </div>
                        </div>

                        @if (confirmingPackageId() === pkg.id) {
                          <div class="pt-2.5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                            <span class="text-slate-300 font-medium">
                              Manage <strong class="text-white font-mono">{{ pkg.id }}</strong>:
                            </span>
                            <div class="flex items-center gap-1.5 flex-wrap justify-end">
                              <button
                                type="button"
                                (click)="confirmingPackageId.set(null)"
                                [disabled]="managingPackageId() === pkg.id"
                                class="px-2.5 py-1 rounded-lg glass-btn text-slate-300 hover:text-white font-semibold cursor-pointer">
                                {{ 'profile.cancel' | translate }}
                              </button>
                              @if (pkg.status === 'delisted' || pkg.status === 'flagged') {
                                <button
                                  type="button"
                                  (click)="onAuthorManagePackage(pkg, 'restore')"
                                  [disabled]="managingPackageId() === pkg.id"
                                  class="px-2.5 py-1 rounded-lg glass-btn-emerald font-bold text-white cursor-pointer">
                                  {{ 'modal.killSwitchRestore' | translate }}
                                </button>
                              } @else {
                                <button
                                  type="button"
                                  (click)="onAuthorManagePackage(pkg, 'delist')"
                                  [disabled]="managingPackageId() === pkg.id"
                                  class="px-2.5 py-1 rounded-lg glass-btn-amber font-bold cursor-pointer">
                                  {{ 'modal.killSwitchDelist' | translate }}
                                </button>
                              }
                              @if (pkg.source === 'git' || (pkg.provider && pkg.provider !== 'contentdb')) {
                                <button
                                  type="button"
                                  (click)="onAuthorManagePackage(pkg, 'remove')"
                                  [disabled]="managingPackageId() === pkg.id"
                                  class="px-2.5 py-1 rounded-lg glass-btn-rose font-black text-white cursor-pointer">
                                  Remove Permanently
                                </button>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- TAB 2: FAVORITES LIST -->
          @if (activeTab() === 'favorites') {
            <div class="space-y-3 flex-1 luanti-tab-enter">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                {{ 'profile.tabFavorites' | translate }} ({{ favoritePackages().length }})
              </h3>

              @if (favoritePackages().length === 0) {
                <div class="p-6 rounded-2xl glass-panel text-center space-y-2.5">
                  <svg lucideHeart class="w-6 h-6 text-slate-500 mx-auto"></svg>
                  <p class="text-xs text-slate-400">{{ 'profile.noFavorites' | translate }}</p>
                </div>
              } @else {
                <div class="space-y-2">
                  @for (pkg of favoritePackages(); track pkg.id) {
                    <div class="p-3 rounded-2xl glass-panel flex items-center justify-between gap-3 text-xs hover:border-sky-400/40 transition">
                      <button
                        type="button"
                        (click)="openPackage(pkg)"
                        class="flex items-center gap-3 text-left flex-1 min-w-0 group cursor-pointer">
                        <img [src]="pkg.banner || pkg.thumbnail || 'logo.svg'" [fallbackThumbnail]="pkg.thumbnail || ''" appImgFallback [alt]="pkg.title" loading="lazy" decoding="async" class="w-10 h-10 rounded-xl object-cover bg-slate-900 flex-shrink-0 border border-white/10" />
                        <div class="min-w-0 flex-1">
                          <h4 class="font-bold text-white group-hover:text-sky-400 transition truncate">{{ pkg.title }}</h4>
                          <span class="text-[11px] text-slate-400 truncate block">by {{ pkg.author }}</span>
                        </div>
                      </button>

                      <div class="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          (click)="packageService.downloadPackage(pkg)"
                          class="p-2 rounded-xl glass-icon-btn text-slate-200 hover:text-white transition cursor-pointer"
                          [attr.aria-label]="'card.downloadZip' | translate">
                          <svg lucideDownload class="w-3.5 h-3.5"></svg>
                        </button>
                        <button
                          type="button"
                          (click)="settingsService.removeFavorite(pkg.id)"
                          class="p-2 rounded-xl glass-icon-btn text-slate-400 hover:text-rose-400 transition cursor-pointer"
                          aria-label="Remove from favorites">
                          <svg lucideTrash class="w-3.5 h-3.5"></svg>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <!-- TAB 3: ACCOUNT INFORMATION, NOTIFICATIONS, REPORTS & CONNECTED FORGES -->
          @if (activeTab() === 'account') {
            <div class="space-y-5 flex-1 text-xs luanti-tab-enter">
              <!-- Edit Account Form -->
              <form (ngSubmit)="onSaveAccount()" class="p-4 rounded-2xl glass-panel space-y-3">
                <h3 class="font-bold uppercase tracking-wider text-slate-400 text-[10px]">
                  {{ 'profile.accountInfoTitle' | translate }}
                </h3>

                <div>
                  <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                    {{ 'profile.displayNameLabel' | translate }}
                  </label>
                  <input
                    type="text"
                    [(ngModel)]="editDisplayName"
                    name="editDisplayName"
                    class="w-full glass-input rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                    {{ 'profile.bioLabel' | translate }}
                  </label>
                  <textarea
                    [(ngModel)]="editBio"
                    name="editBio"
                    rows="2"
                    class="w-full glass-input rounded-xl p-3 text-xs text-white focus:outline-none"></textarea>
                </div>

                <div class="flex justify-end pt-1">
                  <button
                    type="submit"
                    [disabled]="isSavingProfile()"
                    class="px-4 py-2 rounded-xl glass-btn-sky disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer">
                    {{ 'profile.saveChanges' | translate }}
                  </button>
                </div>
              </form>

              <!-- Native PWA Notification Preferences -->
              <div class="p-4 rounded-2xl glass-panel space-y-3">
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <h3 class="font-bold uppercase tracking-wider text-sky-400 text-[10px]">
                      {{ 'profile.notificationsTitle' | translate }}
                    </h3>
                    <p class="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      {{ 'profile.notificationsDesc' | translate }}
                    </p>
                  </div>
                  @if (pwaService.notificationPermission() === 'denied') {
                    <span class="glass-badge glass-badge-rose font-bold whitespace-nowrap">
                      {{ 'profile.permissionBlocked' | translate }}
                    </span>
                  } @else if (settingsService.notificationsEnabled() && pwaService.notificationPermission() === 'granted') {
                    <span class="glass-badge glass-badge-emerald font-bold whitespace-nowrap">
                      {{ 'profile.permissionGranted' | translate }}
                    </span>
                  }
                </div>

                <div class="space-y-2 pt-1 border-t border-white/10">
                  <label class="flex items-center justify-between gap-3 cursor-pointer text-slate-200 font-semibold py-1">
                    <span>{{ 'profile.enableNotifications' | translate }}</span>
                    <input
                      type="checkbox"
                      [ngModel]="settingsService.notificationsEnabled()"
                      (ngModelChange)="onToggleMasterNotifications($event)"
                      class="rounded border-slate-700 bg-slate-900 text-sky-500"
                    />
                  </label>

                  @if (settingsService.notificationsEnabled()) {
                    <div class="pl-3 border-l border-white/10 space-y-2 text-[11px] text-slate-300">
                      <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span>{{ 'profile.notifyNewGitPackagesLabel' | translate }}</span>
                        <input
                          type="checkbox"
                          [ngModel]="settingsService.notifyNewGitPackages()"
                          (ngModelChange)="settingsService.notifyNewGitPackages.set($event)"
                          class="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                      </label>

                      <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span>{{ 'profile.notifyPromotionsLabel' | translate }}</span>
                        <input
                          type="checkbox"
                          [ngModel]="settingsService.notifyPromotions()"
                          (ngModelChange)="settingsService.notifyPromotions.set($event)"
                          class="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                      </label>

                      <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span>{{ 'profile.notifyPackageUpdatesLabel' | translate }}</span>
                        <input
                          type="checkbox"
                          [ngModel]="settingsService.notifyPackageUpdates()"
                          (ngModelChange)="settingsService.notifyPackageUpdates.set($event)"
                          class="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                      </label>

                      <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span>{{ 'profile.notifyNewReviewsLabel' | translate }}</span>
                        <input
                          type="checkbox"
                          [ngModel]="settingsService.notifyNewReviews()"
                          (ngModelChange)="settingsService.notifyNewReviews.set($event)"
                          class="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                      </label>

                      <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span>{{ 'profile.notifyModerationLabel' | translate }}</span>
                        <input
                          type="checkbox"
                          [ngModel]="settingsService.notifyModeration()"
                          (ngModelChange)="settingsService.notifyModeration.set($event)"
                          class="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                      </label>

                      @if (authService.isAdmin()) {
                        <label class="flex items-center justify-between gap-3 cursor-pointer">
                          <span>{{ 'profile.notifyAdminQueueLabel' | translate }}</span>
                          <input
                            type="checkbox"
                            [ngModel]="settingsService.notifyAdminQueue()"
                            (ngModelChange)="settingsService.notifyAdminQueue.set($event)"
                            class="rounded border-slate-700 bg-slate-900 text-sky-500"
                          />
                        </label>
                      }

                      <label class="flex items-center justify-between gap-3 cursor-pointer">
                        <span>{{ 'profile.notifyAppUpdatesLabel' | translate }}</span>
                        <input
                          type="checkbox"
                          [ngModel]="settingsService.notifyAppUpdates()"
                          (ngModelChange)="settingsService.notifyAppUpdates.set($event)"
                          class="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                      </label>
                    </div>
                  } @else if (pwaService.notificationPermission() === 'granted') {
                    <p class="text-[10px] text-slate-400 leading-relaxed pt-1">
                      {{ 'profile.permissionResetHint' | translate }}
                    </p>
                  }
                </div>
              </div>

              <!-- My Submitted Reports & Author Package Alerts (Collapsible + Paginated) -->
              <div class="space-y-2.5">
                <button
                  type="button"
                  (click)="toggleMyReports()"
                  [attr.aria-expanded]="isMyReportsOpen()"
                  class="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl glass-panel hover:border-white/20 transition cursor-pointer text-left">
                  <span class="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <svg lucideMessageSquare class="w-3.5 h-3.5 text-sky-400"></svg>
                    <span>{{ 'profile.myReportsTitle' | translate }} ({{ myReportsCount() }})</span>
                  </span>
                  <svg
                    lucideChevronRight
                    class="w-4 h-4 text-slate-400 transition-transform duration-200"
                    [class.rotate-90]="isMyReportsOpen()">
                  </svg>
                </button>

                @if (isMyReportsOpen()) {
                  @if (myReportsCount() === 0) {
                    <div class="p-4 rounded-2xl glass-panel text-slate-400 text-[11px]">
                      {{ 'profile.noMyReports' | translate }}
                    </div>
                  } @else {
                    <div class="space-y-2.5">
                      @for (rep of paginatedMyReports(); track rep.id) {
                        <div class="p-3.5 rounded-2xl glass-panel space-y-2.5">
                          <div class="flex items-center justify-between gap-2 flex-wrap">
                            <button
                              type="button"
                              (click)="openPackageById(rep.package_id)"
                              class="font-bold text-white hover:text-sky-400 transition text-left truncate cursor-pointer">
                              {{ rep.package_title || rep.package_id }}
                              <span class="text-[10px] font-mono text-slate-400 ml-1">({{ rep.package_id }})</span>
                            </button>

                            <div class="flex items-center gap-1.5 flex-shrink-0">
                              <span
                                [class]="rep.reason === 'broken' ? 'glass-badge-amber' : 'glass-badge-rose'"
                                class="glass-badge font-black uppercase">
                                {{ rep.reason }}
                              </span>
                              <span
                                [class]="rep.status === 'resolved' ? 'glass-badge-emerald' : rep.status === 'dismissed' ? 'glass-badge-sky' : 'glass-badge-rose'"
                                class="glass-badge font-bold uppercase">
                                {{ rep.status }}
                              </span>
                            </div>
                          </div>

                          @if (rep.details) {
                            <p class="text-[11px] text-slate-300 leading-relaxed">{{ rep.details }}</p>
                          }

                          @if (rep.resolution_note) {
                            <div class="p-2.5 rounded-xl bg-slate-950/75 border border-sky-500/25 text-[11px] text-sky-200 whitespace-pre-line leading-relaxed">
                              {{ rep.resolution_note }}
                            </div>
                          }

                          <!-- Author / Reporter Reply & Live 404 Re-Check -->
                          <div class="flex flex-col sm:flex-row gap-2 pt-1">
                            <input
                              type="text"
                              [ngModel]="getNoteInput(rep.id)"
                              (ngModelChange)="setNoteInput(rep.id, $event)"
                              [placeholder]="'profile.notePlaceholder' | translate"
                              class="flex-1 glass-input rounded-xl px-3 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                            />
                            <div class="flex items-center gap-1.5 flex-shrink-0">
                              @if (rep.reason === 'broken' && rep.status === 'open') {
                                <button
                                  type="button"
                                  [disabled]="isActingOnReport(rep.id)"
                                  (click)="onRecheckReport(rep)"
                                  class="px-2.5 py-1.5 rounded-xl glass-btn-amber font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                                  <svg lucideRefreshCw class="w-3 h-3" [class.animate-spin]="isActingOnReport(rep.id)"></svg>
                                  <span>{{ 'profile.recheckUrlBtn' | translate }}</span>
                                </button>
                              }
                              <button
                                type="button"
                                [disabled]="isActingOnReport(rep.id) || !getNoteInput(rep.id).trim()"
                                (click)="onReplyToReport(rep)"
                                class="px-3 py-1.5 rounded-xl glass-btn-sky disabled:opacity-50 text-white font-bold text-[11px] transition cursor-pointer">
                                {{ 'profile.sendNoteBtn' | translate }}
                              </button>
                            </div>
                          </div>
                        </div>
                      }

                      @if (myReportsTotalPages() > 1) {
                        <div class="pt-1 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            [disabled]="authService.myReportsPage() <= 1"
                            (click)="onChangeMyReportsPage(authService.myReportsPage() - 1)"
                            class="px-3 py-1.5 rounded-xl glass-btn disabled:opacity-40 text-slate-200 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                            <svg lucideChevronLeft class="w-3.5 h-3.5"></svg>
                            <span>{{ 'profile.prevPage' | translate }}</span>
                          </button>

                          <span class="text-[11px] font-mono text-slate-300">
                            {{ 'profile.pageLabel' | translate }} {{ authService.myReportsPage() }} / {{ myReportsTotalPages() }}
                          </span>

                          <button
                            type="button"
                            [disabled]="authService.myReportsPage() >= myReportsTotalPages()"
                            (click)="onChangeMyReportsPage(authService.myReportsPage() + 1)"
                            class="px-3 py-1.5 rounded-xl glass-btn disabled:opacity-40 text-slate-200 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                            <span>{{ 'profile.nextPage' | translate }}</span>
                            <svg lucideChevronRight class="w-3.5 h-3.5"></svg>
                          </button>
                        </div>
                      }
                    </div>
                  }
                }
              </div>

              <!-- Connected Accounts & Forges -->
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {{ 'profile.connectedAccounts' | translate }}
                  </h3>
                  <span class="text-[11px] text-slate-500">{{ user.identities.length }} linked</span>
                </div>

                <div class="space-y-2">
                  @for (id of user.identities; track id.provider + ':' + id.username) {
                    <div class="p-3 rounded-2xl glass-panel flex items-center justify-between text-xs">
                      <div class="flex items-center gap-2 min-w-0">
                        @if (id.provider === 'contentdb') {
                          <svg lucideGlobe class="w-4 h-4 text-emerald-400 flex-shrink-0"></svg>
                        } @else {
                          <svg lucideGitBranch class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                        }
                        <span class="capitalize font-semibold text-white">{{ id.provider }}:</span>
                        <span class="text-slate-300 font-mono truncate">&#64;{{ id.username }}</span>
                      </div>
                      <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="glass-badge glass-badge-emerald font-bold flex items-center gap-1">
                          <svg lucideCheck class="w-3 h-3 text-emerald-400"></svg>
                          <span>{{ 'profile.verified' | translate }}</span>
                        </span>
                        @if (user.identities.length > 1) {
                          <button
                            type="button"
                            (click)="authService.unlinkIdentity(id.provider, id.username)"
                            class="text-[10px] text-rose-400 hover:text-rose-300 font-semibold cursor-pointer">
                            {{ 'profile.unlinkBtn' | translate }}
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>

                <div class="pt-1 flex flex-wrap gap-2">
                  @if (!hasProvider('github')) {
                    <button type="button" (click)="authService.loginWith('github', undefined, true)" class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white text-xs transition flex items-center gap-1.5 cursor-pointer">
                      <svg lucidePlus class="w-3.5 h-3.5 text-slate-200"></svg>
                      <span>{{ 'profile.linkGithub' | translate }}</span>
                    </button>
                  }
                  @if (!hasProvider('codeberg')) {
                    <button type="button" (click)="authService.loginWith('codeberg', undefined, true)" class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white text-xs transition flex items-center gap-1.5 cursor-pointer">
                      <svg lucidePlus class="w-3.5 h-3.5 text-indigo-400"></svg>
                      <span>{{ 'profile.linkCodeberg' | translate }}</span>
                    </button>
                  }
                  @if (!hasProvider('gitlab')) {
                    <button type="button" (click)="authService.loginWith('gitlab', undefined, true)" class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white text-xs transition flex items-center gap-1.5 cursor-pointer">
                      <svg lucidePlus class="w-3.5 h-3.5 text-orange-400"></svg>
                      <span>{{ 'profile.linkGitlab' | translate }}</span>
                    </button>
                  }
                  @if (!hasProvider('mesehub')) {
                    <button type="button" (click)="authService.loginWith('mesehub', undefined, true)" class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white text-xs transition flex items-center gap-1.5 cursor-pointer">
                      <svg lucidePlus class="w-3.5 h-3.5 text-emerald-400"></svg>
                      <span>{{ 'profile.linkMesehub' | translate }}</span>
                    </button>
                  }
                  <button type="button" (click)="onOpenLinkAccountModal()" class="px-3 py-1.5 rounded-xl glass-btn text-sky-300 hover:text-white text-xs transition flex items-center gap-1.5 cursor-pointer">
                    <svg lucidePlus class="w-3.5 h-3.5 text-sky-400"></svg>
                    <span>{{ 'auth.directLoginTitle' | translate }}</span>
                  </button>
                </div>
              </div>

              <!-- Collapsible Account Removal Section (Neutral when collapsed, Red Danger Box when expanded) -->
              <div
                data-testid="delete-account-section"
                class="p-4 rounded-2xl glass-panel space-y-3">
                <button
                  type="button"
                  data-testid="toggle-delete-account-section-btn"
                  (click)="toggleDeleteSection()"
                  [attr.aria-expanded]="isDeleteSectionExpanded()"
                  class="w-full flex items-center justify-between gap-3 text-left group cursor-pointer">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300 group-hover:text-white flex items-center gap-2 transition">
                    <svg lucideTrash class="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-400 shrink-0 transition"></svg>
                    <span>{{ 'profile.deleteAccountTitle' | translate }}</span>
                  </h3>
                  <svg
                    lucideChevronDown
                    class="w-4 h-4 text-slate-400 group-hover:text-white transition-transform duration-200 shrink-0"
                    [class.rotate-180]="isDeleteSectionExpanded()">
                  </svg>
                </button>

                @if (isDeleteSectionExpanded()) {
                  <div
                    data-testid="delete-account-danger-box"
                    class="p-4 rounded-xl bg-rose-950/20 border border-rose-500/30 space-y-3">
                    <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <p class="text-[11px] text-slate-300 leading-relaxed">
                        {{ 'profile.deleteAccountDesc' | translate }}
                      </p>
                      @if (!isConfirmingAccountDelete()) {
                        <button
                          type="button"
                          data-testid="open-delete-account-confirm-btn"
                          (click)="onOpenDeleteAccountConfirm()"
                          class="px-3.5 py-2 rounded-xl glass-btn-rose text-white text-xs font-bold whitespace-nowrap transition cursor-pointer shrink-0 self-start">
                          {{ 'profile.deleteAccountBtn' | translate }}
                        </button>
                      }
                    </div>

                    @if (isConfirmingAccountDelete()) {
                      <div
                        data-testid="delete-account-confirm-box"
                        class="p-3.5 rounded-xl bg-slate-950/80 border border-rose-500/40 space-y-3">
                        <div class="flex items-start gap-2 text-[11px] text-rose-200 leading-relaxed">
                          <svg lucideShieldAlert class="w-4 h-4 text-rose-400 shrink-0 mt-0.5"></svg>
                          <p>{{ 'profile.deleteAccountConfirmWarning' | translate }}</p>
                        </div>

                        @if (userPackages().length > 0) {
                          <label class="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/10 cursor-pointer">
                            <input
                              type="checkbox"
                              data-testid="delete-account-include-packages-checkbox"
                              [ngModel]="deleteAccountIncludePackages()"
                              (ngModelChange)="deleteAccountIncludePackages.set($event)"
                              name="deleteAccountIncludePackages"
                              class="mt-0.5 w-3.5 h-3.5 rounded accent-rose-500 cursor-pointer shrink-0"
                            />
                            <span class="text-[11px] text-slate-200 leading-snug">
                              {{ 'profile.deleteAccountIncludePackagesLabel' | translate }}
                            </span>
                          </label>
                        }

                        @if (deleteAccountError()) {
                          <p class="text-[11px] font-semibold text-rose-400">
                            {{ deleteAccountError() }}
                          </p>
                        }

                        <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            data-testid="cancel-delete-account-btn"
                            [disabled]="isDeletingAccount()"
                            (click)="onCancelDeleteAccountConfirm()"
                            class="px-3.5 py-2 rounded-xl glass-btn text-slate-300 hover:text-white text-xs font-semibold transition cursor-pointer">
                            {{ 'common.close' | translate }}
                          </button>
                          <button
                            type="button"
                            data-testid="confirm-delete-account-btn"
                            [disabled]="isDeletingAccount()"
                            (click)="onConfirmDeleteAccount()"
                            class="px-4 py-2 rounded-xl glass-btn-rose disabled:opacity-50 text-white text-xs font-black transition flex items-center gap-1.5 cursor-pointer">
                            <svg lucideTrash class="w-3.5 h-3.5"></svg>
                            <span>
                              {{ (isDeletingAccount() ? 'profile.deletingAccountBtn' : 'profile.deleteAccountConfirmBtn') | translate }}
                            </span>
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- TAB 4: ADMIN MODERATION QUEUE, COMMUNICATION, AUTO-HEAL & PAGINATION -->
          @if (activeTab() === 'moderation' && authService.isAdmin()) {
            <div class="space-y-4 flex-1 text-xs luanti-tab-enter">

              <!-- Moderation Status Sub-Tabs + Reason Filter + Batch Actions -->
              <div class="p-3 rounded-2xl glass-panel space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      (click)="onFilterModerationStatus('open')"
                      [class]="authService.moderationStatusFilter() === 'open' ? 'glass-btn-rose font-black' : 'glass-btn text-slate-300'"
                      class="px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 transition cursor-pointer">
                      <span>{{ 'profile.filterOpen' | translate }}</span>
                      <span class="glass-badge glass-badge-rose font-mono px-1.5 py-0">{{ authService.openReportsCount() }}</span>
                    </button>

                    <button
                      type="button"
                      (click)="onFilterModerationStatus('closed')"
                      [class]="authService.moderationStatusFilter() === 'closed' ? 'glass-btn-emerald font-black' : 'glass-btn text-slate-300'"
                      class="px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 transition cursor-pointer">
                      <span>{{ 'profile.filterClosed' | translate }}</span>
                      <span class="glass-badge glass-badge-emerald font-mono px-1.5 py-0">{{ authService.closedReportsCount() }}</span>
                    </button>

                    <button
                      type="button"
                      (click)="onFilterModerationStatus('delisted')"
                      [class]="authService.moderationStatusFilter() === 'delisted' ? 'glass-btn-amber font-black' : 'glass-btn text-slate-300'"
                      class="px-3 py-1.5 rounded-xl text-[11px] flex items-center gap-1.5 transition cursor-pointer">
                      <span>{{ 'profile.filterDelisted' | translate }}</span>
                      <span class="glass-badge glass-badge-amber font-mono px-1.5 py-0">{{ authService.delistedPackages().length }}</span>
                    </button>
                  </div>

                  @if (authService.moderationStatusFilter() !== 'delisted') {
                    <div class="flex items-center gap-2">
                      <select
                        [ngModel]="authService.moderationReasonFilter()"
                        (ngModelChange)="onFilterModerationReason($event)"
                        aria-label="Filter moderation reports by reason"
                        class="glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none">
                        <option value="all" class="bg-slate-900">{{ 'profile.reasonAll' | translate }}</option>
                        <option value="broken" class="bg-slate-900">{{ 'profile.reasonBroken' | translate }}</option>
                        <option value="dmca" class="bg-slate-900">{{ 'profile.reasonDmca' | translate }}</option>
                        <option value="malware" class="bg-slate-900">{{ 'profile.reasonMalware' | translate }}</option>
                        <option value="license" class="bg-slate-900">{{ 'profile.reasonLicense' | translate }}</option>
                        <option value="inappropriate" class="bg-slate-900">{{ 'profile.reasonInappropriate' | translate }}</option>
                      </select>

                      @if (authService.moderationStatusFilter() === 'open' && authService.openReportsCount() > 0) {
                        <button
                          type="button"
                          (click)="onBulkDismissBroken()"
                          class="px-2.5 py-1.5 rounded-xl glass-btn text-[11px] font-semibold text-amber-300 hover:text-white transition whitespace-nowrap cursor-pointer">
                          {{ 'profile.dismissAllBrokenBtn' | translate }}
                        </button>
                      }

                      @if (authService.moderationStatusFilter() === 'closed' && authService.closedReportsCount() > 0) {
                        <button
                          type="button"
                          (click)="onBulkClearClosed()"
                          class="px-2.5 py-1.5 rounded-xl glass-btn text-[11px] font-semibold text-rose-300 hover:text-white transition whitespace-nowrap cursor-pointer">
                          {{ 'profile.clearClosedBtn' | translate }}
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>

              <!-- View A: Delisted / Flagged Packages List -->
              @if (authService.moderationStatusFilter() === 'delisted') {
                <div class="space-y-2.5">
                  <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {{ 'profile.moderatedPackagesTitle' | translate }} ({{ authService.delistedPackages().length }})
                  </h4>
                  @if (authService.delistedPackages().length === 0) {
                    <div class="p-6 rounded-2xl glass-panel text-center text-slate-400">
                      {{ 'profile.noReports' | translate }}
                    </div>
                  } @else {
                    @for (dPkg of authService.delistedPackages(); track dPkg.id) {
                      <div class="p-3.5 rounded-2xl glass-panel flex items-center justify-between gap-3">
                        <button
                          type="button"
                          (click)="openPackage(dPkg)"
                          class="text-left min-w-0 flex-1 group cursor-pointer">
                          <span class="font-bold text-white group-hover:text-sky-400 transition block truncate">{{ dPkg.id }}</span>
                          <span class="text-[10px] text-rose-300 uppercase font-mono block truncate">{{ dPkg.status }} — {{ dPkg.moderation_reason }}</span>
                        </button>
                        <button
                          type="button"
                          (click)="onRestorePackage(dPkg)"
                          class="px-3.5 py-1.5 rounded-xl glass-btn-emerald font-bold text-[11px] transition flex-shrink-0 cursor-pointer">
                          {{ 'modal.killSwitchRestore' | translate }}
                        </button>
                      </div>
                    }
                  }
                </div>
              } @else {
                <!-- View B: Paginated Open or Closed Moderation Reports (Max 10 in DOM) -->
                <div class="space-y-2.5">
                  <div class="flex items-center justify-between">
                    <h3 class="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                      <svg lucideShieldAlert class="w-4 h-4 text-rose-400"></svg>
                      <span>{{ 'profile.moderationQueueTitle' | translate }} ({{ authService.moderationTotal() }})</span>
                    </h3>
                  </div>

                  @if (authService.moderationReports().length === 0) {
                    <div class="p-6 rounded-2xl glass-panel text-center text-slate-400">
                      {{ 'profile.noReports' | translate }}
                    </div>
                  } @else {
                    <div class="space-y-2.5">
                      @for (rep of authService.moderationReports(); track rep.id) {
                        <div class="p-4 rounded-2xl glass-panel border-rose-500/25 space-y-2.5">
                          <div class="flex items-center justify-between gap-2 flex-wrap">
                            <button
                              type="button"
                              (click)="openPackageById(rep.package_id)"
                              class="font-bold text-white hover:text-sky-400 transition text-left truncate cursor-pointer">
                              {{ rep.package_title || rep.package_id }}
                              <span class="text-[10px] font-mono text-slate-400 ml-1">({{ rep.package_id }})</span>
                            </button>

                            <div class="flex items-center gap-1.5 flex-shrink-0">
                              <span
                                [class]="rep.reason === 'broken' ? 'glass-badge-amber' : 'glass-badge-rose'"
                                class="glass-badge font-black uppercase">
                                {{ rep.reason }}
                              </span>
                              <span
                                [class]="rep.status === 'resolved' ? 'glass-badge-emerald' : rep.status === 'dismissed' ? 'glass-badge-sky' : 'glass-badge-rose'"
                                class="glass-badge font-bold uppercase">
                                {{ rep.status }}
                              </span>
                            </div>
                          </div>

                          @if (rep.details) {
                            <p class="text-slate-300 text-[11px] leading-relaxed">{{ rep.details }}</p>
                          }

                          @if (rep.resolution_note) {
                            <div class="p-2.5 rounded-xl bg-slate-950/75 border border-sky-500/25 text-[11px] text-sky-200 whitespace-pre-line leading-relaxed">
                              {{ rep.resolution_note }}
                            </div>
                          }

                          <!-- Moderator Note / Author Reply Input -->
                          <div class="flex flex-col sm:flex-row gap-2 pt-0.5">
                            <input
                              type="text"
                              [ngModel]="getNoteInput(rep.id)"
                              (ngModelChange)="setNoteInput(rep.id, $event)"
                              [placeholder]="'profile.notePlaceholder' | translate"
                              class="flex-1 glass-input rounded-xl px-3 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              [disabled]="isActingOnReport(rep.id) || !getNoteInput(rep.id).trim()"
                              (click)="onReplyToReport(rep)"
                              class="px-3 py-1.5 rounded-xl glass-btn-sky disabled:opacity-50 text-white font-bold text-[11px] whitespace-nowrap transition cursor-pointer">
                              {{ 'profile.sendNoteBtn' | translate }}
                            </button>
                          </div>

                          <!-- Report Footer Metadata & Frosted Action Bar -->
                          <div class="flex flex-wrap items-center justify-between pt-1.5 border-t border-white/10 gap-2">
                            <span class="text-[10px] text-slate-400">
                              By {{ rep.reporter_username || rep.reporter_user_id || 'Anonymous' }} • {{ rep.created_at | date:'short' }}
                              @if (rep.resolved_by) {
                                • Handled by {{ rep.resolved_by }}
                              }
                            </span>

                            <div class="flex flex-wrap items-center gap-1.5">
                              @if (rep.reason === 'broken' && rep.status === 'open') {
                                <button
                                  type="button"
                                  [disabled]="isActingOnReport(rep.id)"
                                  (click)="onRecheckReport(rep)"
                                  class="px-2.5 py-1 rounded-lg glass-btn-amber font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                                  <svg lucideRefreshCw class="w-3 h-3" [class.animate-spin]="isActingOnReport(rep.id)"></svg>
                                  <span>{{ 'profile.recheckUrlBtn' | translate }}</span>
                                </button>
                              }

                              @if (rep.status === 'open') {
                                <button
                                  type="button"
                                  [disabled]="isActingOnReport(rep.id)"
                                  (click)="onResolveReport(rep)"
                                  class="px-2.5 py-1 rounded-lg glass-btn-emerald font-bold text-[11px] transition cursor-pointer">
                                  {{ 'profile.resolveBtn' | translate }}
                                </button>

                                <button
                                  type="button"
                                  [disabled]="isActingOnReport(rep.id)"
                                  (click)="onDismissReport(rep)"
                                  class="px-2.5 py-1 rounded-lg glass-btn text-slate-200 hover:text-white font-semibold text-[11px] transition cursor-pointer">
                                  {{ 'profile.dismissBtn' | translate }}
                                </button>

                                <button
                                  type="button"
                                  [disabled]="isActingOnReport(rep.id)"
                                  (click)="onAdminKillSwitch(rep)"
                                  class="px-2.5 py-1 rounded-lg glass-btn-rose font-black text-[11px] transition cursor-pointer">
                                  {{ 'modal.killSwitchDelist' | translate }}
                                </button>
                              } @else {
                                <button
                                  type="button"
                                  [disabled]="isActingOnReport(rep.id)"
                                  (click)="onReopenReport(rep)"
                                  class="px-2.5 py-1 rounded-lg glass-btn text-slate-300 hover:text-white font-semibold text-[11px] transition cursor-pointer">
                                  {{ 'profile.reopenBtn' | translate }}
                                </button>
                              }
                            </div>
                          </div>
                        </div>
                      }
                    </div>

                    <!-- Server-Backed Pagination Controls (10 items/page) -->
                    @if (authService.moderationTotalPages() > 1) {
                      <div class="pt-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          [disabled]="authService.moderationPage() <= 1"
                          (click)="onChangeModerationPage(authService.moderationPage() - 1)"
                          class="px-3 py-1.5 rounded-xl glass-btn disabled:opacity-40 text-slate-200 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                          <svg lucideChevronLeft class="w-3.5 h-3.5"></svg>
                          <span>{{ 'profile.prevPage' | translate }}</span>
                        </button>

                        <span class="text-[11px] font-mono text-slate-300">
                          {{ 'profile.pageLabel' | translate }} {{ authService.moderationPage() }} / {{ authService.moderationTotalPages() }}
                        </span>

                        <button
                          type="button"
                          [disabled]="authService.moderationPage() >= authService.moderationTotalPages()"
                          (click)="onChangeModerationPage(authService.moderationPage() + 1)"
                          class="px-3 py-1.5 rounded-xl glass-btn disabled:opacity-40 text-slate-200 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                          <span>{{ 'profile.nextPage' | translate }}</span>
                          <svg lucideChevronRight class="w-3.5 h-3.5"></svg>
                        </button>
                      </div>
                    }
                  }
                </div>
              }
            </div>
          }

          <!-- TAB 5: ADMIN HERO CAROUSEL & PROMOTIONAL PACKAGE ROW #1 CONFIGURATION -->
          @if (activeTab() === 'promotions' && authService.isAdmin()) {
            <div class="space-y-4 flex-1 text-xs luanti-tab-enter">
              <!-- Collapsible Create / Edit Promotion Panel (Collapsed by Default) -->
              <div class="rounded-2xl glass-panel border-amber-500/25 overflow-hidden">
                <div
                  role="button"
                  tabindex="0"
                  data-testid="promo-form-toggle"
                  [attr.aria-expanded]="showPromoForm()"
                  (click)="showPromoForm.update(v => !v)"
                  (keydown.enter)="showPromoForm.update(v => !v)"
                  (keydown.space)="$event.preventDefault(); showPromoForm.update(v => !v)"
                  class="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-white/5 transition cursor-pointer select-none">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <svg lucideStar class="w-4 h-4 text-amber-400 flex-shrink-0"></svg>
                    <div class="min-w-0">
                      <h3 class="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                        {{ promoEditingId() ? 'Edit Promotional Campaign' : 'Create Promotional Campaign (Hero Slide & Package Row #1)' }}
                      </h3>
                      <p class="text-[11px] text-slate-400 truncate">
                        Configure multiple Hero Carousel slides (by priority) and/or a ContentDB-synced Package Row in 1st place below the Hero Banner.
                      </p>
                    </div>
                  </div>

                  <div class="flex items-center gap-2 flex-shrink-0">
                    @if (promoEditingId()) {
                      <button
                        type="button"
                        (click)="$event.stopPropagation(); resetPromotionForm()"
                        class="px-2.5 py-1 rounded-lg glass-btn text-slate-300 hover:text-white text-[11px] font-semibold cursor-pointer">
                        Cancel Edit
                      </button>
                    } @else if (!showPromoForm()) {
                      <span class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/35 text-amber-200 text-[10px] font-bold inline-flex items-center gap-1">
                        <svg lucidePlus class="w-3 h-3"></svg>
                        <span>New Campaign</span>
                      </span>
                    }
                    @if (showPromoForm()) {
                      <svg lucideChevronUp class="w-4 h-4 text-slate-400 flex-shrink-0"></svg>
                    } @else {
                      <svg lucideChevronDown class="w-4 h-4 text-slate-400 flex-shrink-0"></svg>
                    }
                  </div>
                </div>

                @if (promoFeedback() && !showPromoForm()) {
                  <div class="px-4 pb-3 -mt-1">
                    <p [class]="promoFeedbackIsError() ? 'text-rose-400' : 'text-emerald-400'" class="text-[11px] font-semibold">
                      {{ promoFeedback() }}
                    </p>
                  </div>
                }

                @if (showPromoForm()) {
                  <form (ngSubmit)="onSubmitPromotion()" class="px-4 pb-4 pt-3 border-t border-white/10 space-y-3.5">

                <!-- 1-Click Campaign Quick-Fill Presets -->
                <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <span class="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Quick-Fill Presets:
                  </span>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      (click)="applyPromoPreset('gamejam2026')"
                      class="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-amber-200 font-bold text-[10px] transition cursor-pointer inline-flex items-center gap-1.5">
                      <app-theme-icon name="trophy" sizeClass="w-3.5 h-3.5"></app-theme-icon>
                      <span>Luanti Game Jam 2026</span>
                    </button>
                    <button
                      type="button"
                      (click)="applyPromoPreset('tagshowcase')"
                      class="px-2.5 py-1 rounded-lg glass-btn text-sky-300 hover:text-white font-bold text-[10px] transition cursor-pointer inline-flex items-center gap-1.5">
                      <app-theme-icon name="tag" sizeClass="w-3.5 h-3.5"></app-theme-icon>
                      <span>Tag Showcase Row</span>
                    </button>
                    <button
                      type="button"
                      (click)="applyPromoPreset('curated')"
                      class="px-2.5 py-1 rounded-lg glass-btn text-emerald-300 hover:text-white font-bold text-[10px] transition cursor-pointer inline-flex items-center gap-1.5">
                      <app-theme-icon name="sparkles" sizeClass="w-3.5 h-3.5"></app-theme-icon>
                      <span>Curated Spotlight Row</span>
                    </button>
                  </div>
                </div>

                <!-- Placement Toggles: Hero Slide vs Package Row #1 (or Both) + Priority -->
                <div class="p-3 rounded-xl bg-slate-950/50 border border-white/10 space-y-2.5">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <label class="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        [ngModel]="promoShowInHero()"
                        (ngModelChange)="promoShowInHero.set($event)"
                        name="promoShowInHero"
                        class="w-4 h-4 rounded accent-amber-400 cursor-pointer"
                      />
                      <span class="text-[11px] font-bold text-white">
                        Show in Hero Banner Carousel
                      </span>
                    </label>

                    <label class="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        [ngModel]="promoRowEnabled()"
                        (ngModelChange)="promoRowEnabled.set($event)"
                        name="promoRowEnabled"
                        class="w-4 h-4 rounded accent-sky-400 cursor-pointer"
                      />
                      <span class="text-[11px] font-bold text-sky-300">
                        Pin Promotional Package Row in 1st Place (Below Hero Banner)
                      </span>
                    </label>
                  </div>

                  <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
                    <span class="text-[10px] text-slate-400">
                      Multiple Hero slides and Promotional Rows can run simultaneously, ordered by Priority (higher = earlier).
                    </span>
                    <div class="flex items-center gap-1.5">
                      <label class="text-[10px] font-bold text-slate-300">Priority:</label>
                      <input
                        type="number"
                        [(ngModel)]="promoPriority"
                        name="promoPriority"
                        min="1"
                        max="1000"
                        class="w-16 glass-input rounded-lg px-2 py-1 text-[11px] text-white font-mono text-center focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div class="sm:col-span-2">
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Title {{ promoShowInHero() ? '*' : '(optional if Row Title is set)' }}
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoTitle"
                      name="promoTitle"
                      placeholder="e.g. Luanti Game Jam 2026"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Badge Label
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoBadgeText"
                      name="promoBadgeText"
                      placeholder="PROMOTED or GAME JAM 2026"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                @if (promoShowInHero()) {
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Short Description *
                    </label>
                    <textarea
                      [(ngModel)]="promoShortDesc"
                      name="promoShortDesc"
                      rows="2"
                      placeholder="Concise description shown on the Hero Carousel banner..."
                      class="w-full glass-input rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none"></textarea>
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Banner Image URL * <span class="text-[10px] font-normal text-slate-400">(supports relative /promo.png or external https://...)</span>
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoBannerUrl"
                      name="promoBannerUrl"
                      placeholder="/promo.png or https://example.com/banner.webp"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                    />
                  </div>
                }

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Primary CTA Label
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoCtaLabel"
                      name="promoCtaLabel"
                      placeholder="Learn More"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Primary CTA URL {{ promoShowInHero() ? '*' : '(optional)' }} <span class="text-[10px] font-normal text-slate-400">(/submit, /?tag=gamejam, https://...)</span>
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoCtaUrl"
                      name="promoCtaUrl"
                      placeholder="/submit or https://..."
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Secondary CTA Label <span class="text-[10px] font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoSecondaryCtaLabel"
                      name="promoSecondaryCtaLabel"
                      placeholder="Rules & Prizes"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Secondary CTA URL <span class="text-[10px] font-normal text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      [(ngModel)]="promoSecondaryCtaUrl"
                      name="promoSecondaryCtaUrl"
                      placeholder="/setup or https://..."
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <!-- PROMOTIONAL PACKAGE ROW #1 CONFIGURATION PANEL -->
                @if (promoRowEnabled()) {
                  <div class="p-3.5 rounded-2xl bg-sky-950/25 border border-sky-400/30 space-y-3">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                      <div class="flex items-center gap-2">
                        <svg lucideLayers class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                        <div>
                          <h4 class="text-[11px] font-extrabold uppercase tracking-wider text-sky-300">
                            Promotional Package Row #1 (Below Hero Banner)
                          </h4>
                          <p class="text-[10px] text-slate-400">
                            Synced with ContentDB every 5 minutes (Edge-cached + D1 fallback) and unified with custom LuantiHub tags.
                          </p>
                        </div>
                      </div>
                      <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-bold text-[10px]">
                        Matching packages right now: {{ previewPromoRowMatchCount() }}
                      </span>
                    </div>

                    <div>
                      <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                        Row Heading Title <span class="text-[10px] font-normal text-slate-400">(supports i18n:carousel.promoGameJamTitle|year=2026)</span>
                      </label>
                      <input
                        type="text"
                        [ngModel]="promoRowTitle()"
                        (ngModelChange)="promoRowTitle.set($event)"
                        name="promoRowTitle"
                        placeholder="Luanti Game Jam 2026 Submissions"
                        class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                      />
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div class="relative" data-testid="promo-row-icon-picker">
                        <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                          Row Icon
                        </label>
                        <button
                          type="button"
                          (click)="togglePromoIconMenu($event)"
                          aria-label="Promotional Row Icon"
                          [attr.aria-expanded]="isPromoIconMenuOpen()"
                          class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white focus:outline-none flex items-center justify-between gap-2 cursor-pointer">
                          <span class="inline-flex items-center gap-2 min-w-0">
                            <app-theme-icon [name]="promoRowIcon()" sizeClass="w-4 h-4"></app-theme-icon>
                            <span class="font-medium whitespace-nowrap">{{ selectedPromoIconLabel() }}</span>
                          </span>
                          <svg
                            lucideChevronDown
                            class="w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform duration-150"
                            [class.rotate-180]="isPromoIconMenuOpen()"></svg>
                        </button>

                        @if (isPromoIconMenuOpen()) {
                          <div
                            role="listbox"
                            aria-label="Select Promotional Row Icon"
                            (click)="$event.stopPropagation()"
                            class="absolute left-0 right-0 min-w-[11rem] mt-1.5 rounded-xl glass-dropdown p-1.5 z-50 space-y-0.5 shadow-2xl border border-white/15">
                            @for (opt of promoRowIconOptions; track opt.value) {
                              <button
                                type="button"
                                role="option"
                                [attr.aria-selected]="promoRowIcon() === opt.value"
                                (click)="selectPromoRowIcon(opt.value)"
                                [class]="promoRowIcon() === opt.value ? 'bg-amber-500/20 text-white border-amber-400/40 font-bold' : 'text-slate-200 hover:bg-white/10 border-transparent font-medium'"
                                class="w-full px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2.5 transition cursor-pointer">
                                <span class="inline-flex items-center gap-2.5">
                                  <app-theme-icon [name]="opt.value" sizeClass="w-4 h-4"></app-theme-icon>
                                  <span class="whitespace-nowrap">{{ opt.label }}</span>
                                </span>
                                @if (promoRowIcon() === opt.value) {
                                  <svg lucideCheck class="w-3.5 h-3.5 text-amber-400 flex-shrink-0"></svg>
                                }
                              </button>
                            }
                          </div>
                        }
                      </div>

                      <div>
                        <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                          Sort Order
                        </label>
                        <select
                          [ngModel]="promoRowSortBy()"
                          (ngModelChange)="promoRowSortBy.set($event)"
                          name="promoRowSortBy"
                          aria-label="Promotional Row Sort Order"
                          class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                          <option value="newest" class="bg-slate-900">Newest First</option>
                          <option value="downloads" class="bg-slate-900">Most Downloads</option>
                          <option value="rating" class="bg-slate-900">Highest Rated</option>
                          <option value="trending" class="bg-slate-900">Trending</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                        Row Info Tooltip / Subtitle <span class="text-[10px] font-normal text-slate-400">(optional)</span>
                      </label>
                      <input
                        type="text"
                        [ngModel]="promoRowSubtitle()"
                        (ngModelChange)="promoRowSubtitle.set($event)"
                        name="promoRowSubtitle"
                        placeholder="Live submissions tagged for the annual Luanti Game Jam..."
                        class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                      />
                    </div>

                    <!-- Unified Tag Filter Picker (ContentDB + Custom App Tags) -->
                    <div class="space-y-2">
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <label class="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                          <svg lucideTag class="w-3.5 h-3.5 text-sky-400"></svg>
                          <span>Filter by Tag(s) (OR match — e.g. <code>jam_game_2026</code>, <code>gamejam</code>)</span>
                        </label>
                        <div class="flex items-center gap-1.5">
                          <input
                            type="text"
                            [(ngModel)]="promoCustomTagInput"
                            name="promoCustomTagInput"
                            (keydown.enter)="$event.preventDefault(); addPromoCustomTag()"
                            placeholder="Add custom/ContentDB tag..."
                            class="glass-input rounded-lg px-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none font-mono"
                          />
                          <button
                            type="button"
                            (click)="addPromoCustomTag()"
                            class="px-2.5 py-1 rounded-lg glass-btn-sky text-white font-bold text-[10px] cursor-pointer">
                            + Add Tag
                          </button>
                        </div>
                      </div>

                      @if (promoRowFilterTags().length > 0) {
                        <div class="flex items-center gap-1.5 flex-wrap">
                          @for (tag of promoRowFilterTags(); track tag) {
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-sky-500/25 border border-sky-400/50 text-sky-200 text-[11px] font-mono">
                              <span>#{{ tag }}</span>
                              <button
                                type="button"
                                (click)="togglePromoRowTag(tag)"
                                class="text-sky-300 hover:text-white cursor-pointer"
                                [attr.aria-label]="'Remove tag ' + tag">
                                <svg lucideX class="w-3 h-3"></svg>
                              </button>
                            </span>
                          }
                        </div>
                      }

                      <div class="max-h-28 overflow-y-auto p-2 rounded-xl bg-slate-950/60 border border-white/10 flex items-center gap-1.5 flex-wrap">
                        @for (t of packageService.availableTags(); track t.name) {
                          <button
                            type="button"
                            (click)="togglePromoRowTag(t.name)"
                            [class]="promoRowFilterTags().includes(t.name.toLowerCase()) ? 'bg-sky-500/30 text-sky-200 border-sky-400/50 font-bold' : 'glass-pill text-slate-400 hover:text-white'"
                            class="px-2 py-0.5 rounded-full border text-[10px] transition cursor-pointer">
                            #{{ t.title }} <span class="opacity-60 font-mono">({{ t.name }})</span>
                          </button>
                        }
                      </div>
                    </div>

                    <!-- Additional Optional Filters: Package Type, Source, Author, Keyword -->
                    <div class="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <div>
                        <label class="block text-[10px] font-semibold text-slate-400 mb-1">Category Filter</label>
                        <select
                          [ngModel]="promoRowFilterType()"
                          (ngModelChange)="promoRowFilterType.set($event)"
                          name="promoRowFilterType"
                          class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white focus:outline-none">
                          <option value="all" class="bg-slate-900">All Categories</option>
                          <option value="game" class="bg-slate-900">Games Only</option>
                          <option value="mod" class="bg-slate-900">Mods Only</option>
                          <option value="txp" class="bg-slate-900">Texture Packs Only</option>
                        </select>
                      </div>

                      <div>
                        <label class="block text-[10px] font-semibold text-slate-400 mb-1">Source Filter</label>
                        <select
                          [ngModel]="promoRowFilterSource()"
                          (ngModelChange)="promoRowFilterSource.set($event)"
                          name="promoRowFilterSource"
                          class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white focus:outline-none">
                          <option value="all" class="bg-slate-900">All Sources (ContentDB + Git)</option>
                          <option value="official" class="bg-slate-900">Official ContentDB Only</option>
                          <option value="git" class="bg-slate-900">Community Git Only</option>
                        </select>
                      </div>

                      <div>
                        <label class="block text-[10px] font-semibold text-slate-400 mb-1">Author Username</label>
                        <input
                          type="text"
                          [ngModel]="promoRowFilterAuthor()"
                          (ngModelChange)="promoRowFilterAuthor.set($event)"
                          name="promoRowFilterAuthor"
                          placeholder="e.g. rubenwardy"
                          class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none font-mono"
                        />
                      </div>

                      <div>
                        <label class="block text-[10px] font-semibold text-slate-400 mb-1">Keyword Match</label>
                        <input
                          type="text"
                          [ngModel]="promoRowFilterQuery()"
                          (ngModelChange)="promoRowFilterQuery.set($event)"
                          name="promoRowFilterQuery"
                          placeholder="e.g. jam 2026"
                          class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <!-- Pinned / Hand-Picked Package IDs (author/name) -->
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <label class="text-[10px] font-semibold text-slate-300">
                          Pinned Packages (Hand-picked <code>author/name</code> always shown first in the row)
                        </label>
                        <div class="flex items-center gap-1.5">
                          <input
                            type="text"
                            [(ngModel)]="promoPinnedPkgInput"
                            name="promoPinnedPkgInput"
                            (keydown.enter)="$event.preventDefault(); addPromoPinnedPackage()"
                            placeholder="author/name"
                            class="glass-input rounded-lg px-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:outline-none font-mono"
                          />
                          <button
                            type="button"
                            (click)="addPromoPinnedPackage()"
                            class="px-2.5 py-1 rounded-lg glass-btn text-sky-300 hover:text-white font-bold text-[10px] cursor-pointer">
                            + Pin Package
                          </button>
                        </div>
                      </div>

                      @if (promoRowPinnedPackages().length > 0) {
                        <div class="flex items-center gap-1.5 flex-wrap">
                          @for (pkgId of promoRowPinnedPackages(); track pkgId) {
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-200 text-[10px] font-mono">
                              <app-theme-icon name="pin" sizeClass="w-3 h-3"></app-theme-icon>
                              <span>{{ pkgId }}</span>
                              <button
                                type="button"
                                (click)="removePromoPinnedPackage(pkgId)"
                                class="text-amber-300 hover:text-white cursor-pointer"
                                [attr.aria-label]="'Unpin ' + pkgId">
                                <svg lucideX class="w-3 h-3"></svg>
                              </button>
                            </span>
                          }
                        </div>
                      }
                    </div>

                    <label class="flex items-center gap-2 cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        [ngModel]="promoRowShowEmptyCta()"
                        (ngModelChange)="promoRowShowEmptyCta.set($event)"
                        name="promoRowShowEmptyCta"
                        class="w-3.5 h-3.5 rounded accent-amber-400 cursor-pointer"
                      />
                      <span class="text-[11px] text-slate-300">
                        Show Empty-State Call-to-Action Card when 0 packages match (e.g. during Game Jam kickoff before first submission)
                      </span>
                    </label>
                  </div>
                }

                <!-- MULTI-LANGUAGE TRANSLATIONS SECTION (EN, SK, DE, FR, ES, RU) -->
                <div class="rounded-2xl bg-slate-950/60 border border-white/10 overflow-hidden">
                  <button
                    type="button"
                    (click)="showPromoTranslations.update(v => !v)"
                    class="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition cursor-pointer">
                    <div class="flex items-center gap-2">
                      <svg lucideGlobe class="w-4 h-4 text-sky-400"></svg>
                      <span class="text-[11px] font-bold text-slate-200">
                        Multi-Language Translations (EN · SK · DE · FR · ES · RU)
                      </span>
                      @if (configuredTranslationCount() > 0) {
                        <span class="glass-badge glass-badge-sky font-mono text-[9px] px-1.5 py-0">
                          {{ configuredTranslationCount() }} locale(s)
                        </span>
                      }
                    </div>
                    @if (showPromoTranslations()) {
                      <svg lucideChevronUp class="w-4 h-4 text-slate-400"></svg>
                    } @else {
                      <svg lucideChevronDown class="w-4 h-4 text-slate-400"></svg>
                    }
                  </button>

                  @if (showPromoTranslations()) {
                    <div class="p-3.5 border-t border-white/10 space-y-2.5">
                      <p class="text-[10px] text-slate-400">
                         Campaign Presets automatically translate into all 6 languages via <code>i18n:</code> keys. Optionally provide custom per-language overrides below:
                      </p>
                      <div class="flex items-center gap-1.5 flex-wrap">
                        @for (loc of supportedPromoLocales; track loc.id) {
                          <button
                            type="button"
                            (click)="activeTranslationLocale.set(loc.id)"
                            [class]="activeTranslationLocale() === loc.id ? 'bg-sky-500/30 text-sky-200 border-sky-400/50 font-black' : 'glass-btn text-slate-400 hover:text-white'"
                            class="px-2.5 py-1 rounded-lg border text-[10px] uppercase transition cursor-pointer">
                            {{ loc.label }}
                          </button>
                        }
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Hero Title Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'title')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'title', $event)"
                            [name]="'tr_title_' + activeTranslationLocale()"
                            placeholder="Leave blank to use default / i18n template"
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Badge Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'badge_text')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'badge_text', $event)"
                            [name]="'tr_badge_' + activeTranslationLocale()"
                            placeholder="e.g. GAME JAM 2026"
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Row #1 Title Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'row_title')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'row_title', $event)"
                            [name]="'tr_row_title_' + activeTranslationLocale()"
                            placeholder="Localized Row #1 heading..."
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Row #1 Subtitle Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'row_subtitle')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'row_subtitle', $event)"
                            [name]="'tr_row_sub_' + activeTranslationLocale()"
                            placeholder="Localized Row #1 tooltip/subtitle..."
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <div class="sm:col-span-2">
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Hero Short Description Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'short_desc')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'short_desc', $event)"
                            [name]="'tr_desc_' + activeTranslationLocale()"
                            placeholder="Localized Hero description..."
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Primary CTA Label Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'cta_label')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'cta_label', $event)"
                            [name]="'tr_cta_' + activeTranslationLocale()"
                            placeholder="Localized primary button text..."
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-[10px] font-semibold text-slate-400 mb-1">
                            [{{ activeTranslationLocale() | uppercase }}] Secondary CTA Label Override
                          </label>
                          <input
                            type="text"
                            [ngModel]="getPromoLocaleField(activeTranslationLocale(), 'secondary_cta_label')"
                            (ngModelChange)="setPromoLocaleField(activeTranslationLocale(), 'secondary_cta_label', $event)"
                            [name]="'tr_cta2_' + activeTranslationLocale()"
                            placeholder="Localized secondary button text..."
                            class="w-full glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  }
                </div>

                <!-- Date & Time UI Pickers + Quick Presets -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Starts At (Local Date & Time)
                    </label>
                    <input
                      type="datetime-local"
                      [(ngModel)]="promoStartsAtLocal"
                      name="promoStartsAtLocal"
                      aria-label="Starts At Local Date and Time"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white focus:outline-none [color-scheme:dark]"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Expires At (Local Date & Time) *
                    </label>
                    <input
                      type="datetime-local"
                      [(ngModel)]="promoExpiresAtLocal"
                      name="promoExpiresAtLocal"
                      aria-label="Expires At Local Date and Time"
                      class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white focus:outline-none [color-scheme:dark]"
                    />
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Quick Duration:</span>
                    <button type="button" (click)="setPromoPresetDays(1)" class="px-2 py-1 rounded-lg glass-btn text-[10px] font-bold text-amber-300 hover:text-white cursor-pointer">+24h</button>
                    <button type="button" (click)="setPromoPresetDays(3)" class="px-2 py-1 rounded-lg glass-btn text-[10px] font-bold text-amber-300 hover:text-white cursor-pointer">+3 Days</button>
                    <button type="button" (click)="setPromoPresetDays(7)" class="px-2 py-1 rounded-lg glass-btn text-[10px] font-bold text-amber-300 hover:text-white cursor-pointer">+7 Days</button>
                    <button type="button" (click)="setPromoPresetDays(14)" class="px-2 py-1 rounded-lg glass-btn text-[10px] font-bold text-amber-300 hover:text-white cursor-pointer">+14 Days</button>
                    <button type="button" (click)="setPromoPresetDays(30)" class="px-2 py-1 rounded-lg glass-btn text-[10px] font-bold text-amber-300 hover:text-white cursor-pointer">+30 Days</button>
                  </div>

                  <button
                    type="submit"
                    [disabled]="isSavingPromo() || !isPromoFormValid()"
                    class="px-4 py-2 rounded-xl glass-btn-amber disabled:opacity-50 text-white font-black text-xs transition cursor-pointer">
                    {{ isSavingPromo() ? 'Saving...' : (promoEditingId() ? 'Update Promotion' : 'Publish Promotion') }}
                  </button>
                </div>

                  @if (promoFeedback()) {
                    <p [class]="promoFeedbackIsError() ? 'text-rose-400' : 'text-emerald-400'" class="text-[11px] font-semibold">
                      {{ promoFeedback() }}
                    </p>
                  }
                  </form>
                }
              </div>

              <!-- Existing Promotions List -->
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Configured Promotions ({{ packageService.adminPromotions().length }})
                  </h3>
                  <button
                    type="button"
                    (click)="packageService.fetchAdminPromotions()"
                    class="px-2.5 py-1 rounded-lg glass-btn text-slate-300 hover:text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer">
                    <svg lucideRefreshCw class="w-3 h-3"></svg>
                    <span>Refresh</span>
                  </button>
                </div>

                @if (packageService.adminPromotions().length === 0) {
                  <div class="p-6 rounded-2xl glass-panel text-center text-slate-400">
                    No promotional campaigns configured yet.
                  </div>
                } @else {
                  <div class="space-y-2.5">
                    @for (promo of packageService.adminPromotions(); track promo.id) {
                      <div class="p-3.5 rounded-2xl glass-panel space-y-2.5">
                        <div class="flex items-start justify-between gap-3">
                          <div class="flex items-center gap-3 min-w-0 flex-1">
                            <img
                              [src]="promo.banner_url || 'logo.svg'"
                              appImgFallback
                              [alt]="promo.title || promo.row_title || 'Promotion'"
                              loading="lazy"
                              decoding="async"
                              class="w-16 h-10 rounded-xl object-cover bg-slate-900 border border-white/15 flex-shrink-0"
                            />
                            <div class="min-w-0 flex-1">
                              <div class="flex items-center gap-1.5 flex-wrap">
                                <h4 class="font-bold text-white truncate">{{ promo.title || promo.row_title }}</h4>
                                <span class="glass-badge glass-badge-amber font-black uppercase text-[9px] px-1.5 py-0">
                                  {{ promo.badge_text || 'PROMOTED' }}
                                </span>
                                @if (promo.show_in_hero !== false) {
                                  <span class="glass-badge glass-badge-sky font-bold uppercase text-[9px] px-1.5 py-0">
                                    HERO SLIDE (P{{ promo.priority || 100 }})
                                  </span>
                                }
                                @if (promo.row_enabled) {
                                  <span class="glass-badge glass-badge-emerald font-bold uppercase text-[9px] px-1.5 py-0 inline-flex items-center gap-1">
                                    <app-theme-icon [name]="promo.row_icon || 'trophy'" sizeClass="w-3 h-3"></app-theme-icon>
                                    <span>ROW #1 ({{ getPromotionRowMatchCount(promo) }} pkgs)</span>
                                  </span>
                                }
                                @if (getPromotionStatus(promo) === 'active') {
                                  <span class="glass-badge glass-badge-emerald font-black uppercase text-[9px] px-1.5 py-0">
                                    ACTIVE
                                  </span>
                                } @else if (getPromotionStatus(promo) === 'scheduled') {
                                  <span class="glass-badge glass-badge-sky font-black uppercase text-[9px] px-1.5 py-0">
                                    SCHEDULED
                                  </span>
                                } @else {
                                  <span class="glass-badge glass-badge-rose font-black uppercase text-[9px] px-1.5 py-0">
                                    EXPIRED
                                  </span>
                                }
                              </div>
                              <p class="text-[11px] text-slate-300 line-clamp-1 mt-0.5">
                                {{ promo.short_desc || promo.row_subtitle || promo.row_title }}
                              </p>
                              @if (promo.row_enabled && promo.row_filter_tags && promo.row_filter_tags.length > 0) {
                                <div class="flex items-center gap-1 flex-wrap mt-1">
                                  @for (tag of promo.row_filter_tags; track tag) {
                                    <span class="px-1.5 py-0 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300 text-[9px] font-mono">
                                      #{{ tag }}
                                    </span>
                                  }
                                </div>
                              }
                            </div>
                          </div>

                          <div class="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              type="button"
                              (click)="onEditPromotion(promo)"
                              class="px-2.5 py-1 rounded-lg glass-btn text-sky-300 hover:text-white text-[11px] font-bold cursor-pointer">
                              Edit
                            </button>
                            <button
                              type="button"
                              [disabled]="deletingPromoId() === promo.id"
                              (click)="onDeletePromotion(promo.id)"
                              class="px-2.5 py-1 rounded-lg glass-btn-rose text-white text-[11px] font-bold cursor-pointer">
                              {{ getPromotionStatus(promo) === 'active' ? 'End Now' : 'Delete' }}
                            </button>
                          </div>
                        </div>

                        <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-[10px] text-slate-400 font-mono">
                          <span class="truncate max-w-full">
                            CTA: <strong class="text-slate-200">{{ promo.cta_label }}</strong> → {{ promo.cta_url || '—' }}
                          </span>
                          <span>
                            {{ promo.starts_at | date:'short' }} → {{ promo.expires_at | date:'short' }}
                          </span>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- Footer Actions -->
          <div class="pt-4 border-t border-white/10 flex items-center justify-between">
            <button
              type="button"
              (click)="authService.logout()"
              class="px-3.5 py-2 rounded-xl glass-btn hover:border-rose-500/40 hover:text-rose-300 text-slate-300 text-xs font-semibold transition cursor-pointer">
              {{ 'profile.signOut' | translate }}
            </button>
          </div>

        </div>

      </div>
    }
  `
})
export class ProfileDrawerComponent implements OnInit {
  readonly authService = inject(AuthService);
  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);

  readonly activeTab = signal<'packages' | 'favorites' | 'account' | 'moderation' | 'promotions'>('packages');

  // Admin Promotional Slide & Package Row #1 Form State
  readonly showPromoForm = signal(false);
  readonly promoEditingId = signal<string | null>(null);
  promoTitle = '';
  promoShortDesc = '';
  promoBannerUrl = '';
  promoBadgeText = 'PROMOTED';
  promoCtaLabel = 'Learn More';
  promoCtaUrl = '';
  promoSecondaryCtaLabel = '';
  promoSecondaryCtaUrl = '';
  promoStartsAtLocal = '';
  promoExpiresAtLocal = '';
  promoPriority = 100;
  readonly promoShowInHero = signal(true);
  readonly promoRowEnabled = signal(false);
  readonly promoRowTitle = signal('');
  readonly promoRowSubtitle = signal('');
  readonly promoRowIcon = signal<PromoRowIcon>('trophy');
  readonly promoRowIconOptions = PROMO_ROW_ICON_OPTIONS;
  readonly isPromoIconMenuOpen = signal(false);
  readonly selectedPromoIconLabel = computed(() => {
    const current = this.promoRowIcon();
    return this.promoRowIconOptions.find(opt => opt.value === current)?.label ?? 'Trophy';
  });
  readonly promoRowFilterTags = signal<string[]>([]);
  readonly promoRowFilterType = signal<'all' | 'game' | 'mod' | 'txp'>('all');
  readonly promoRowFilterSource = signal<'all' | 'official' | 'git'>('all');
  readonly promoRowFilterAuthor = signal('');
  readonly promoRowFilterQuery = signal('');
  readonly promoRowPinnedPackages = signal<string[]>([]);
  readonly promoRowSortBy = signal<PromoRowSortOption>('newest');
  readonly promoRowShowEmptyCta = signal(false);
  promoCustomTagInput = '';
  promoPinnedPkgInput = '';

  readonly showPromoTranslations = signal(false);
  readonly activeTranslationLocale = signal<LocaleId>('en');
  readonly promoTranslations = signal<Partial<Record<LocaleId, PromotionLocaleOverride>>>({});
  readonly supportedPromoLocales: { id: LocaleId; label: string }[] = [
    { id: 'en', label: 'EN' },
    { id: 'sk', label: 'SK' },
    { id: 'de', label: 'DE' },
    { id: 'fr', label: 'FR' },
    { id: 'es', label: 'ES' },
    { id: 'ru', label: 'RU' }
  ];

  readonly configuredTranslationCount = computed(() => {
    const map = this.promoTranslations();
    let count = 0;
    for (const loc of Object.keys(map) as LocaleId[]) {
      const ov = map[loc];
      if (ov && Object.values(ov).some(v => typeof v === 'string' && v.trim().length > 0)) {
        count++;
      }
    }
    return count;
  });

  readonly previewPromoRowMatchCount = computed<number>(() => {
    if (!this.promoRowEnabled()) return 0;
    const draftPromo: Partial<HeroPromotion> = {
      row_enabled: true,
      row_filter_tags: this.promoRowFilterTags(),
      row_filter_type: this.promoRowFilterType(),
      row_filter_source: this.promoRowFilterSource(),
      row_filter_author: this.promoRowFilterAuthor(),
      row_filter_query: this.promoRowFilterQuery(),
      row_pinned_packages: this.promoRowPinnedPackages()
    };
    return this.getPromotionRowMatchCount(draftPromo);
  });

  readonly isSavingPromo = signal(false);
  readonly deletingPromoId = signal<string | null>(null);
  readonly promoFeedback = signal<string | null>(null);
  readonly promoFeedbackIsError = signal(false);

  editDisplayName = '';
  editBio = '';
  readonly isSavingProfile = signal(false);
  readonly isDeleteSectionExpanded = signal(false);
  readonly isConfirmingAccountDelete = signal(false);
  readonly deleteAccountIncludePackages = signal(true);
  readonly isDeletingAccount = signal(false);
  readonly deleteAccountError = signal<string | null>(null);

  private readonly noteInputs = signal<Record<string, string>>({});
  private readonly actingReportIds = signal<Record<string, boolean>>({});
  readonly myReportsManualOpen = signal<boolean | null>(null);
  readonly confirmingPackageId = signal<string | null>(null);
  readonly managingPackageId = signal<string | null>(null);

  readonly myReportsCount = computed<number>(() => {
    return Math.max(this.authService.myReportsTotal(), this.authService.myReports().length);
  });

  // Open by default when <= 5 alerts, collapsed by default when > 5 alerts (unless manually toggled)
  readonly isMyReportsOpen = computed<boolean>(() => {
    const manual = this.myReportsManualOpen();
    if (manual !== null) return manual;
    return this.myReportsCount() <= 5;
  });

  readonly myReportsTotalPages = computed<number>(() => {
    const pageSize = this.authService.myReportsPageSize();
    return Math.max(
      this.authService.myReportsTotalPages(),
      Math.ceil(this.myReportsCount() / pageSize),
      1
    );
  });

  readonly paginatedMyReports = computed<ModerationReport[]>(() => {
    const list = this.authService.myReports();
    const pageSize = this.authService.myReportsPageSize();
    if (list.length <= pageSize) {
      return list;
    }
    const page = Math.min(Math.max(1, this.authService.myReportsPage()), this.myReportsTotalPages());
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  });

  constructor() {
    this.resetPromotionForm();
    effect(() => {
      const requestedTab = this.authService.requestedDrawerTab();
      if (requestedTab) {
        this.authService.consumeRequestedDrawerTab();
        if (requestedTab === 'moderation' && this.authService.isAdmin()) {
          this.onSelectModerationTab();
        } else if (requestedTab === 'promotions' && this.authService.isAdmin()) {
          this.onSelectPromotionsTab();
        } else if (requestedTab === 'account') {
          this.onSelectAccountTab();
        } else {
          this.activeTab.set(requestedTab);
        }
      }
      if (this.authService.requestAccountDeleteConfirm()) {
        this.authService.requestAccountDeleteConfirm.set(false);
        this.onSelectAccountTab();
        this.isDeleteSectionExpanded.set(true);
        this.isConfirmingAccountDelete.set(true);
        this.deleteAccountError.set(null);
      }
    });
  }

  // Merge D1 user.packages with catalog packages matching the user's claimed author_id or verified identities
  readonly userPackages = computed<LuantiPackage[]>(() => {
    const user = this.authService.currentUser();
    if (!user) return [];

    const verifiedHandles = new Set<string>(
      (user.identities || [])
        .filter(i => Boolean(i.verified) && Boolean(i.username))
        .map(i => i.username.toLowerCase())
    );
    if (verifiedHandles.size > 0 && user.username) {
      verifiedHandles.add(user.username.toLowerCase());
    }

    const fromCatalog = this.packageService.packages().filter(
      p =>
        (p.author_id && !String(p.author_id).startsWith('ext_') && String(p.author_id) === String(user.id)) ||
        verifiedHandles.has(p.author.toLowerCase())
    );
    const parseTagsOrDeps = (raw: any, fallback: string[] = []): string[] => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string' && raw.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // ignore
        }
      }
      return fallback;
    };

    const fromD1: LuantiPackage[] = (user.packages || []).map((p: any) => {
      const resolvedAuthor = p.author || p.author_name || (typeof p.id === 'string' && p.id.includes('/') ? p.id.split('/')[0] : user.username);
      const isGitSource = p.source === 'git' || (p.provider && p.provider !== 'contentdb');
      return {
        id: p.id || `${resolvedAuthor}/${p.name}`,
        author: resolvedAuthor,
        author_id: p.author_id || user.id,
        name: p.name,
        title: p.title || p.name,
        type: p.type || 'mod',
        short_desc: p.short_desc || '',
        thumbnail: this.packageService.toProxiedGitImageIfNeeded(p.thumbnail_url ?? p.thumbnail) || 'logo.svg',
        banner: this.packageService.toProxiedGitImageIfNeeded(p.banner_url ?? p.banner ?? p.thumbnail_url ?? p.thumbnail) || 'logo.svg',
        score: (typeof p.score === 'number' && p.score >= 1 && p.score <= 5) ? p.score : 0,
        downloads: p.downloads_count ?? p.downloads ?? 0,
        license: p.license || '',
        media_license: p.media_license || p.license || '',
        repo_url: p.repo_url || p.repo || undefined,
        provider: p.provider || (isGitSource ? 'github' : 'contentdb'),
        default_branch: p.default_branch || 'main',
        min_minetest_version: p.min_minetest_version || '5.0.0',
        source: isGitSource ? 'git' : 'official',
        sources: isGitSource ? ['git'] : ['official'],
        status: p.status || 'active',
        moderation_reason: p.status_reason || p.moderation_reason || undefined,
        tags: parseTagsOrDeps(p.tags, [p.type || 'mod']),
        dependencies: parseTagsOrDeps(p.dependencies),
        optional_dependencies: parseTagsOrDeps(p.optional_dependencies)
      };
    });

    const byKey = new Map<string, LuantiPackage>();
    for (const pkg of fromCatalog) {
      byKey.set(pkg.id.toLowerCase(), pkg);
    }
    for (const pkg of fromD1) {
      const key = pkg.id.toLowerCase();
      const existing = byKey.get(key);
      if (existing) {
        const merged = this.packageService.mergeDualSourcePackage(existing, pkg);
        byKey.set(key, {
          ...merged,
          status: pkg.status || merged.status,
          moderation_reason: pkg.moderation_reason || merged.moderation_reason
        });
      } else {
        byKey.set(key, pkg);
      }
    }
    return Array.from(byKey.values());
  });

  // Resolve favorite package IDs to full LuantiPackage items
  readonly favoritePackages = computed<LuantiPackage[]>(() => {
    const favIds = new Set(this.settingsService.favorites().map(id => id.toLowerCase()));
    return this.packageService.packages().filter(p => favIds.has(p.id.toLowerCase()));
  });

  ngOnInit(): void {
    const user = this.authService.currentUser();
    if (user) {
      this.editDisplayName = user.display_name || user.username;
      this.editBio = user.bio || '';
    }
  }

  hasProvider(provider: GitProvider): boolean {
    return this.authService.linkedIdentities().some(id => id.provider === provider);
  }

  onSelectAccountTab(): void {
    this.activeTab.set('account');
    this.myReportsManualOpen.set(null);
    this.isDeleteSectionExpanded.set(false);
    this.isConfirmingAccountDelete.set(false);
    this.deleteAccountError.set(null);
    this.authService.fetchMyReports(false, 1);
  }

  toggleDeleteSection(): void {
    const next = !this.isDeleteSectionExpanded();
    this.isDeleteSectionExpanded.set(next);
    if (!next) {
      this.isConfirmingAccountDelete.set(false);
      this.deleteAccountError.set(null);
    }
  }

  onOpenDeleteAccountConfirm(): void {
    this.deleteAccountError.set(null);
    this.isDeleteSectionExpanded.set(true);
    this.isConfirmingAccountDelete.set(true);
  }

  onCancelDeleteAccountConfirm(): void {
    this.deleteAccountError.set(null);
    this.isConfirmingAccountDelete.set(false);
  }

  async onConfirmDeleteAccount(): Promise<void> {
    if (this.isDeletingAccount()) return;
    this.isDeletingAccount.set(true);
    this.deleteAccountError.set(null);
    const currentUser = this.authService.currentUser();
    const userId = currentUser?.id || '';
    const handles = [
      currentUser?.username || '',
      ...(currentUser?.identities || []).filter(i => Boolean(i.verified)).map(i => i.username)
    ].filter(Boolean);
    try {
      const includePackages = this.deleteAccountIncludePackages();
      const res = await this.authService.deleteAccount({
        deleteSubmittedPackages: includePackages
      });
      if (!res.success) {
        this.deleteAccountError.set(res.message || 'Could not delete account right now.');
        return;
      }
      this.isConfirmingAccountDelete.set(false);
      this.packageService.removeDeletedUserPackagesFromCatalog(userId, handles, includePackages);
      if (includePackages) {
        this.packageService.initCatalog(true);
      }
    } finally {
      this.isDeletingAccount.set(false);
    }
  }

  toggleMyReports(): void {
    this.myReportsManualOpen.set(!this.isMyReportsOpen());
  }

  onChangeMyReportsPage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.myReportsTotalPages()) return;
    this.authService.fetchMyReports(true, nextPage);
  }

  onSelectModerationTab(): void {
    this.activeTab.set('moderation');
    this.authService.fetchModerationQueue(true);
  }

  onSelectPromotionsTab(): void {
    if (!this.authService.isAdmin()) return;
    this.activeTab.set('promotions');
    this.promoFeedback.set(null);
    if (!this.promoExpiresAtLocal) {
      this.resetPromotionForm();
    }
    this.packageService.fetchAdminPromotions();
  }

  private toLocalDatetimeInput(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private fromLocalDatetimeInput(localValue: string): string {
    const parsed = new Date(localValue);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '';
  }

  resetPromotionForm(): void {
    this.promoEditingId.set(null);
    this.showPromoForm.set(false);
    this.isPromoIconMenuOpen.set(false);
    this.promoTitle = '';
    this.promoShortDesc = '';
    this.promoBannerUrl = '';
    this.promoBadgeText = 'PROMOTED';
    this.promoCtaLabel = 'Learn More';
    this.promoCtaUrl = '';
    this.promoSecondaryCtaLabel = '';
    this.promoSecondaryCtaUrl = '';
    this.promoPriority = 100;
    this.promoShowInHero.set(true);
    this.promoRowEnabled.set(false);
    this.promoRowTitle.set('');
    this.promoRowSubtitle.set('');
    this.promoRowIcon.set('trophy');
    this.promoRowFilterTags.set([]);
    this.promoRowFilterType.set('all');
    this.promoRowFilterSource.set('all');
    this.promoRowFilterAuthor.set('');
    this.promoRowFilterQuery.set('');
    this.promoRowPinnedPackages.set([]);
    this.promoRowSortBy.set('newest');
    this.promoRowShowEmptyCta.set(false);
    this.promoCustomTagInput = '';
    this.promoPinnedPkgInput = '';
    this.promoTranslations.set({});
    this.showPromoTranslations.set(false);
    const now = new Date();
    const plus7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    this.promoStartsAtLocal = this.toLocalDatetimeInput(now);
    this.promoExpiresAtLocal = this.toLocalDatetimeInput(plus7d);
  }

  applyPromoPreset(preset: 'gamejam2026' | 'tagshowcase' | 'curated'): void {
    if (preset === 'gamejam2026') {
      this.promoShowInHero.set(true);
      this.promoRowEnabled.set(true);
      this.promoPriority = 200;
      this.promoTitle = 'Luanti Game Jam 2026';
      this.promoBadgeText = 'GAME JAM 2026';
      this.promoShortDesc = 'Play and rate brand-new voxel games submitted for the annual Luanti Game Jam 2026! Synced live with ContentDB and community Git repositories.';
      if (!this.promoBannerUrl) {
        this.promoBannerUrl = '/promo.png';
      }
      this.promoCtaLabel = 'Explore Submissions';
      this.promoCtaUrl = '/?tag=jam_game_2026';
      this.promoSecondaryCtaLabel = 'Submit Package';
      this.promoSecondaryCtaUrl = '/submit';
      this.promoRowTitle.set('i18n:carousel.promoGameJamTitle|year=2026');
      this.promoRowSubtitle.set('i18n:carousel.promoGameJamSubtitle|year=2026');
      this.promoRowIcon.set('trophy');
      this.promoRowFilterTags.set(['jam_game_2026', 'gamejam']);
      this.promoRowFilterType.set('all');
      this.promoRowFilterSource.set('all');
      this.promoRowSortBy.set('newest');
      this.promoRowShowEmptyCta.set(true);
      this.packageService.registerCustomTag('jam_game_2026', 'Game Jam 2026');
      this.packageService.registerCustomTag('gamejam', 'Game Jam');
      this.setPromoPresetDays(30);
    } else if (preset === 'tagshowcase') {
      this.promoShowInHero.set(false);
      this.promoRowEnabled.set(true);
      this.promoPriority = 150;
      if (!this.promoTitle) {
        this.promoTitle = 'Featured Tag Showcase';
      }
      this.promoBadgeText = 'FEATURED TAG';
      this.promoRowTitle.set('i18n:carousel.promoTagShowcaseTitle|tag=Magic & Enchanting');
      this.promoRowSubtitle.set('i18n:carousel.promoTagShowcaseSubtitle');
      this.promoRowIcon.set('sparkles');
      this.promoRowFilterTags.set(['magic']);
      this.promoRowSortBy.set('trending');
      this.promoRowShowEmptyCta.set(false);
    } else if (preset === 'curated') {
      this.promoShowInHero.set(false);
      this.promoRowEnabled.set(true);
      this.promoPriority = 150;
      if (!this.promoTitle) {
        this.promoTitle = 'Community Spotlight';
      }
      this.promoBadgeText = 'SPOTLIGHT';
      this.promoRowTitle.set('i18n:carousel.promoCuratedTitle');
      this.promoRowSubtitle.set('i18n:carousel.promoCuratedSubtitle');
      this.promoRowIcon.set('star');
      this.promoRowSortBy.set('rating');
      this.promoRowShowEmptyCta.set(false);
    }
  }

  togglePromoRowTag(tagName: string): void {
    const clean = String(tagName || '').trim().toLowerCase();
    if (!clean) return;
    this.promoRowFilterTags.update(curr => {
      if (curr.includes(clean)) {
        return curr.filter(t => t !== clean);
      }
      return [...curr, clean];
    });
  }

  addPromoCustomTag(): void {
    const raw = (this.promoCustomTagInput || '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '_');
    if (!raw) return;
    this.packageService.registerCustomTag(raw);
    if (!this.promoRowFilterTags().includes(raw)) {
      this.promoRowFilterTags.update(curr => [...curr, raw]);
    }
    this.promoCustomTagInput = '';
  }

  addPromoPinnedPackage(): void {
    const raw = (this.promoPinnedPkgInput || '').trim();
    if (!raw || !raw.includes('/')) return;
    const exists = this.promoRowPinnedPackages().some(p => p.toLowerCase() === raw.toLowerCase());
    if (!exists) {
      this.promoRowPinnedPackages.update(curr => [...curr, raw]);
    }
    this.promoPinnedPkgInput = '';
  }

  removePromoPinnedPackage(pkgId: string): void {
    this.promoRowPinnedPackages.update(curr => curr.filter(p => p !== pkgId));
  }

  getPromoLocaleField(locale: LocaleId, field: keyof PromotionLocaleOverride): string {
    return this.promoTranslations()[locale]?.[field] || '';
  }

  setPromoLocaleField(locale: LocaleId, field: keyof PromotionLocaleOverride, value: string): void {
    this.promoTranslations.update(curr => {
      const prevLocale = curr[locale] || {};
      return {
        ...curr,
        [locale]: {
          ...prevLocale,
          [field]: value
        }
      };
    });
  }

  isPromoFormValid(): boolean {
    if (!this.promoExpiresAtLocal) return false;
    const showHero = this.promoShowInHero();
    const showRow = this.promoRowEnabled();
    if (!showHero && !showRow) return false;
    const hasTitle = Boolean(this.promoTitle.trim() || this.promoRowTitle().trim());
    if (!hasTitle) return false;
    if (showHero) {
      if (!this.promoShortDesc.trim() || !this.promoBannerUrl.trim() || !this.promoCtaUrl.trim()) {
        return false;
      }
    }
    if (showRow) {
      const hasRowCriteria =
        this.promoRowFilterTags().length > 0 ||
        this.promoRowPinnedPackages().length > 0 ||
        (this.promoRowFilterType() && this.promoRowFilterType() !== 'all') ||
        (this.promoRowFilterSource() && this.promoRowFilterSource() !== 'all') ||
        Boolean(this.promoRowFilterAuthor().trim()) ||
        Boolean(this.promoRowFilterQuery().trim());
      if (!hasRowCriteria) return false;
    }
    return true;
  }

  getPromotionRowMatchCount(promo: Partial<HeroPromotion>): number {
    return this.packageService.getMatchingPackagesForPromotionRow(promo).length;
  }

  togglePromoIconMenu(event: Event): void {
    event.stopPropagation();
    this.isPromoIconMenuOpen.update(v => !v);
  }

  selectPromoRowIcon(icon: PromoRowIcon): void {
    this.promoRowIcon.set(icon);
    this.isPromoIconMenuOpen.set(false);
  }

  setPromoPresetDays(days: number): void {
    const startBase = this.promoStartsAtLocal ? new Date(this.promoStartsAtLocal) : new Date();
    const baseMs = Number.isFinite(startBase.getTime()) ? startBase.getTime() : Date.now();
    if (!this.promoStartsAtLocal) {
      this.promoStartsAtLocal = this.toLocalDatetimeInput(new Date(baseMs));
    }
    const target = new Date(baseMs + days * 24 * 60 * 60 * 1000);
    this.promoExpiresAtLocal = this.toLocalDatetimeInput(target);
  }

  onEditPromotion(promo: HeroPromotion): void {
    if (!this.authService.isAdmin()) return;
    this.showPromoForm.set(true);
    this.promoEditingId.set(promo.id);
    this.promoTitle = promo.title || '';
    this.promoShortDesc = promo.short_desc || '';
    this.promoBannerUrl = promo.banner_url || '';
    this.promoBadgeText = promo.badge_text || 'PROMOTED';
    this.promoCtaLabel = promo.cta_label || 'Learn More';
    this.promoCtaUrl = promo.cta_url || '';
    this.promoSecondaryCtaLabel = promo.secondary_cta_label || '';
    this.promoSecondaryCtaUrl = promo.secondary_cta_url || '';
    this.promoPriority = typeof promo.priority === 'number' ? promo.priority : 100;
    this.promoShowInHero.set(promo.show_in_hero !== false);
    this.promoRowEnabled.set(Boolean(promo.row_enabled));
    this.promoRowTitle.set(promo.row_title || '');
    this.promoRowSubtitle.set(promo.row_subtitle || '');
    this.promoRowIcon.set(promo.row_icon || 'trophy');
    this.promoRowFilterTags.set(Array.isArray(promo.row_filter_tags) ? [...promo.row_filter_tags] : []);
    this.promoRowFilterType.set((promo.row_filter_type as any) || 'all');
    this.promoRowFilterSource.set((promo.row_filter_source as any) || 'all');
    this.promoRowFilterAuthor.set(promo.row_filter_author || '');
    this.promoRowFilterQuery.set(promo.row_filter_query || '');
    this.promoRowPinnedPackages.set(Array.isArray(promo.row_pinned_packages) ? [...promo.row_pinned_packages] : []);
    this.promoRowSortBy.set(promo.row_sort_by || 'newest');
    this.promoRowShowEmptyCta.set(Boolean(promo.row_show_empty_cta));
    const parsedTr = this.packageService.parsePromotionTranslations(promo.translations);
    this.promoTranslations.set(parsedTr ? { ...parsedTr } : {});
    const startsDate = new Date(promo.starts_at);
    const expiresDate = new Date(promo.expires_at);
    this.promoStartsAtLocal = Number.isFinite(startsDate.getTime())
      ? this.toLocalDatetimeInput(startsDate)
      : this.toLocalDatetimeInput(new Date());
    this.promoExpiresAtLocal = Number.isFinite(expiresDate.getTime())
      ? this.toLocalDatetimeInput(expiresDate)
      : this.toLocalDatetimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    this.promoFeedback.set(null);
  }

  getPromotionStatus(promo: HeroPromotion): 'active' | 'scheduled' | 'expired' {
    const now = Date.now();
    const startsMs = Date.parse(promo.starts_at || '');
    const expiresMs = Date.parse(promo.expires_at || '');
    if (!Number.isFinite(expiresMs) || expiresMs <= now) {
      return 'expired';
    }
    if (Number.isFinite(startsMs) && startsMs > now) {
      return 'scheduled';
    }
    return 'active';
  }

  async onSubmitPromotion(): Promise<void> {
    if (!this.authService.isAdmin()) return;
    const startsAtIso = this.promoStartsAtLocal
      ? this.fromLocalDatetimeInput(this.promoStartsAtLocal)
      : new Date().toISOString();
    const expiresAtIso = this.fromLocalDatetimeInput(this.promoExpiresAtLocal);
    if (!expiresAtIso) {
      this.promoFeedbackIsError.set(true);
      this.promoFeedback.set('Please select a valid expiration date and time.');
      return;
    }

    this.isSavingPromo.set(true);
    this.promoFeedback.set(null);
    const effectiveTitle = this.promoTitle.trim() || this.promoRowTitle().trim();
    const res = await this.packageService.savePromotion({
      id: this.promoEditingId() || undefined,
      title: effectiveTitle,
      short_desc: this.promoShortDesc.trim(),
      banner_url: this.promoBannerUrl.trim(),
      badge_text: this.promoBadgeText.trim() || 'PROMOTED',
      cta_label: this.promoCtaLabel.trim() || 'Learn More',
      cta_url: this.promoCtaUrl.trim(),
      secondary_cta_label: this.promoSecondaryCtaLabel.trim() || null,
      secondary_cta_url: this.promoSecondaryCtaUrl.trim() || null,
      starts_at: startsAtIso,
      expires_at: expiresAtIso,
      priority: Number(this.promoPriority) || 100,
      show_in_hero: this.promoShowInHero(),
      row_enabled: this.promoRowEnabled(),
      row_title: this.promoRowTitle().trim(),
      row_subtitle: this.promoRowSubtitle().trim(),
      row_icon: this.promoRowIcon(),
      row_filter_tags: this.promoRowFilterTags(),
      row_filter_type: this.promoRowFilterType(),
      row_filter_source: this.promoRowFilterSource(),
      row_filter_author: this.promoRowFilterAuthor().trim(),
      row_filter_query: this.promoRowFilterQuery().trim(),
      row_pinned_packages: this.promoRowPinnedPackages(),
      row_sort_by: this.promoRowSortBy(),
      row_show_empty_cta: this.promoRowShowEmptyCta(),
      translations: this.promoTranslations()
    });
    this.isSavingPromo.set(false);

    if (res.success) {
      this.promoFeedbackIsError.set(false);
      this.promoFeedback.set(
        this.promoEditingId() ? 'Promotion updated!' : 'Promotional campaign published!'
      );
      this.resetPromotionForm();
    } else {
      this.promoFeedbackIsError.set(true);
      this.promoFeedback.set(res.error || 'Failed to save promotion.');
    }
  }

  async onDeletePromotion(id: string): Promise<void> {
    if (!this.authService.isAdmin() || !id) return;
    this.deletingPromoId.set(id);
    const res = await this.packageService.deletePromotion(id);
    this.deletingPromoId.set(null);
    if (res.success && this.promoEditingId() === id) {
      this.resetPromotionForm();
    }
  }

  onFilterModerationStatus(status: 'open' | 'closed' | 'delisted'): void {
    this.authService.fetchModerationQueue(true, 1, status, this.authService.moderationReasonFilter());
  }

  onFilterModerationReason(reason: string): void {
    this.authService.fetchModerationQueue(true, 1, this.authService.moderationStatusFilter(), reason);
  }

  onChangeModerationPage(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.authService.moderationTotalPages()) return;
    this.authService.fetchModerationQueue(true, nextPage);
  }

  getNoteInput(reportId: string | number): string {
    return this.noteInputs()[String(reportId)] || '';
  }

  setNoteInput(reportId: string | number, val: string): void {
    this.noteInputs.update(curr => ({ ...curr, [String(reportId)]: val }));
  }

  isActingOnReport(reportId: string | number): boolean {
    return Boolean(this.actingReportIds()[String(reportId)]);
  }

  private setActingOnReport(reportId: string | number, active: boolean): void {
    this.actingReportIds.update(curr => ({ ...curr, [String(reportId)]: active }));
  }

  async onToggleMasterNotifications(enabled: boolean): Promise<void> {
    await this.pwaService.setNotificationsEnabled(enabled);
  }

  async onReplyToReport(rep: ModerationReport): Promise<void> {
    const note = this.getNoteInput(rep.id).trim();
    if (!note) return;
    this.setActingOnReport(rep.id, true);
    const res = await this.authService.actOnModerationReport(rep.id, 'reply', note);
    this.setActingOnReport(rep.id, false);
    if (res.success) {
      this.setNoteInput(rep.id, '');
    }
  }

  async onRecheckReport(rep: ModerationReport): Promise<void> {
    this.setActingOnReport(rep.id, true);
    await this.authService.actOnModerationReport(rep.id, 'recheck', this.getNoteInput(rep.id).trim() || undefined);
    this.setActingOnReport(rep.id, false);
  }

  async onResolveReport(rep: ModerationReport): Promise<void> {
    this.setActingOnReport(rep.id, true);
    const res = await this.authService.actOnModerationReport(rep.id, 'resolve', this.getNoteInput(rep.id).trim() || undefined);
    this.setActingOnReport(rep.id, false);
    if (res.success) {
      this.setNoteInput(rep.id, '');
    }
  }

  async onDismissReport(rep: ModerationReport): Promise<void> {
    this.setActingOnReport(rep.id, true);
    const res = await this.authService.actOnModerationReport(rep.id, 'dismiss', this.getNoteInput(rep.id).trim() || undefined);
    this.setActingOnReport(rep.id, false);
    if (res.success) {
      this.setNoteInput(rep.id, '');
    }
  }

  async onReopenReport(rep: ModerationReport): Promise<void> {
    this.setActingOnReport(rep.id, true);
    await this.authService.actOnModerationReport(rep.id, 'reopen', this.getNoteInput(rep.id).trim() || undefined);
    this.setActingOnReport(rep.id, false);
  }

  async onBulkDismissBroken(): Promise<void> {
    await this.authService.bulkModerationAction('dismiss_all_broken');
  }

  async onBulkClearClosed(): Promise<void> {
    await this.authService.bulkModerationAction('clear_closed');
  }

  openPackage(pkg: LuantiPackage): void {
    this.authService.closeProfileDrawer(false);
    this.packageService.openPackageModal(pkg);
  }

  openPackageById(packageId: string): void {
    if (!packageId) return;
    this.authService.closeProfileDrawer(false);
    const existing = this.packageService.packages().find(
      p => p.id.toLowerCase() === packageId.toLowerCase()
    );
    if (existing) {
      this.packageService.openPackageModal(existing);
    } else {
      const [author, name] = packageId.split('/');
      if (author && name) {
        this.packageService.openPackageModalById(author, name, true);
      }
    }
  }

  openPackageAndEditTags(pkg: LuantiPackage): void {
    this.authService.closeProfileDrawer(false);
    this.packageService.openPackageModal(pkg, true, true);
  }

  toggleConfirmManagePackage(pkgId: string): void {
    this.confirmingPackageId.update(curr => (curr === pkgId ? null : pkgId));
  }

  async onAuthorManagePackage(pkg: LuantiPackage, action: 'delist' | 'restore' | 'remove'): Promise<void> {
    const [author, name] = (pkg.id || `${pkg.author}/${pkg.name}`).split('/');
    if (!author || !name) return;
    this.managingPackageId.set(pkg.id);
    await this.packageService.moderatePackage(
      { author, name, id: pkg.id },
      action,
      `Author ${action} action from Profile Drawer`
    );
    this.managingPackageId.set(null);
    this.confirmingPackageId.set(null);
  }

  async onSaveAccount(): Promise<void> {
    this.isSavingProfile.set(true);
    await this.authService.updateProfile({
      display_name: this.editDisplayName.trim(),
      bio: this.editBio.trim()
    });
    this.isSavingProfile.set(false);
  }

  async onAdminKillSwitch(rep: ModerationReport): Promise<void> {
    const [author, name] = rep.package_id.split('/');
    if (!author || !name) return;
    const note = this.getNoteInput(rep.id).trim();
    this.setActingOnReport(rep.id, true);
    await this.packageService.moderatePackage(
      { author, name, id: rep.package_id },
      'delist',
      note || `Delisted via Admin Report #${rep.id} (${rep.reason})`,
      rep.id
    );
    this.setActingOnReport(rep.id, false);
    this.setNoteInput(rep.id, '');
  }

  async onRestorePackage(pkg: LuantiPackage): Promise<void> {
    const [author, name] = (pkg.id || `${pkg.author}/${pkg.name}`).split('/');
    if (!author || !name) return;
    await this.packageService.moderatePackage(
      { author, name, id: pkg.id },
      'restore',
      'Restored by Admin'
    );
  }

  onOpenSubmitModal(): void {
    this.authService.closeProfileDrawer(false);
    this.packageService.openSubmitModal();
  }

  onOpenLinkAccountModal(): void {
    this.authService.closeProfileDrawer(false);
    this.authService.openAuthModal();
  }

  onPreviewPublicProfile(): void {
    const user = this.authService.currentUser();
    if (!user) return;
    this.authService.closeProfileDrawer(false);
    this.packageService.openAuthorDrawer(user.username, true, null);
  }

  canOpenAnalyticsDashboard(): boolean {
    if (this.authService.isAdmin()) return true;
    const user = this.authService.currentUser();
    if (!user) return false;
    return (
      this.authService.canViewAuthorAnalytics(user.username) ||
      this.userPackages().some(p => this.authService.canManagePackage(p))
    );
  }

  onOpenAnalyticsDashboard(): void {
    const user = this.authService.currentUser();
    if (!user || !this.canOpenAnalyticsDashboard()) return;
    this.packageService.openAnalyticsPage(user.username);
  }

  onOpenPackageAnalytics(pkg: LuantiPackage): void {
    if (!pkg || !this.authService.canManagePackage(pkg)) return;
    this.packageService.openAnalyticsPage(pkg.author, pkg.name);
  }
}

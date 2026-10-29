import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { GitProvider, LuantiPackage, ModerationReport } from '../../core/models/package.model';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
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
  LucideChevronRight
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
    LucideChevronRight
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
          (click)="$event.stopPropagation()"
          class="w-full max-w-2xl h-full glass-drawer flex flex-col p-5 sm:p-6 space-y-5 overflow-y-auto luanti-drawer-panel">

          <!-- Drawer Header -->
          <div class="flex items-center justify-between border-b border-white/10 pb-4">
            <div class="flex items-center gap-3.5 min-w-0">
              <div class="relative flex-shrink-0">
                <img [src]="user.avatar_url" [alt]="user.username" class="w-12 h-12 rounded-2xl border border-white/20 shadow-lg object-cover bg-slate-900" />
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
              </div>
            </div>

            <button
              type="button"
              (click)="authService.closeProfileDrawer()"
              aria-label="Close profile drawer"
              class="w-9 h-9 rounded-full glass-icon-btn text-slate-300 hover:text-white flex items-center justify-center transition flex-shrink-0 cursor-pointer">
              <svg lucideX class="w-4 h-4"></svg>
            </button>
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
            }
          </div>

          <!-- TAB 1: MY PACKAGES & CONTENTDB PORTFOLIO SYNC -->
          @if (activeTab() === 'packages') {
            <div class="space-y-4 flex-1 luanti-tab-enter">
              <!-- ContentDB Importer / Sync -->
              <div class="p-4 rounded-2xl glass-panel space-y-3">
                <div class="flex items-center gap-2">
                  <svg lucideGlobe class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                  <h4 class="text-xs font-bold text-sky-400 uppercase tracking-wider">
                    {{ 'profile.syncTitle' | translate }}
                  </h4>
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">
                  {{ 'profile.syncDesc' | translate }}
                </p>
                <div class="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    [(ngModel)]="cdbUsernameInput"
                    [placeholder]="'profile.syncPlaceholder' | translate"
                    class="flex-1 glass-input rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    (click)="onSyncContentDb()"
                    [disabled]="isSyncing() || !cdbUsernameInput.trim()"
                    class="px-4 py-2 rounded-xl glass-btn-sky disabled:opacity-50 text-white font-bold text-xs transition whitespace-nowrap cursor-pointer">
                    {{ isSyncing() ? ('profile.syncing' | translate) : ('profile.syncBtn' | translate) }}
                  </button>
                </div>
                @if (syncFeedback()) {
                  <p class="text-xs text-emerald-400 font-medium">{{ syncFeedback() }}</p>
                }
              </div>

              <!-- User's Published Packages -->
              <div class="space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {{ 'profile.myPackages' | translate }} ({{ userPackages().length }})
                  </h3>
                  <button
                    type="button"
                    (click)="onOpenSubmitModal()"
                    class="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition cursor-pointer">
                    <svg lucidePlus class="w-3.5 h-3.5"></svg>
                    <span>{{ 'profile.submitGitBtn' | translate }}</span>
                  </button>
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
                      <div class="p-3 rounded-2xl glass-panel flex items-center justify-between gap-3 text-xs hover:border-sky-400/40 transition">
                        <button
                          type="button"
                          (click)="openPackage(pkg)"
                          class="flex items-center gap-3 text-left flex-1 min-w-0 group cursor-pointer">
                          <img [src]="pkg.thumbnail || 'logo.svg'" [alt]="pkg.title" loading="lazy" decoding="async" class="w-10 h-10 rounded-xl object-cover bg-slate-900 flex-shrink-0 border border-white/10" />
                          <div class="min-w-0 flex-1">
                            <h4 class="font-bold text-white group-hover:text-sky-400 transition truncate">{{ pkg.title }}</h4>
                            <div class="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                              <span>{{ (pkg.downloads || 0) | compactNumber }} dl</span>
                              <span>•</span>
                              <span
                                [class]="pkg.type === 'game' ? 'glass-badge-emerald' : pkg.type === 'txp' ? 'glass-badge-purple' : 'glass-badge-sky'"
                                class="glass-badge font-black uppercase tracking-wider text-[9px] px-1.5 py-0">
                                {{ pkg.type }}
                              </span>
                            </div>
                          </div>
                        </button>

                        <div class="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            (click)="openPackageAndEditTags(pkg)"
                            class="p-2 rounded-xl glass-icon-btn text-sky-400 hover:text-white transition cursor-pointer"
                            title="Edit Tags"
                            aria-label="Edit package tags">
                            <svg lucideTag class="w-3.5 h-3.5"></svg>
                          </button>
                          <button
                            type="button"
                            (click)="packageService.downloadPackage(pkg)"
                            class="p-2 rounded-xl glass-icon-btn text-slate-200 hover:text-white transition cursor-pointer"
                            [attr.aria-label]="'card.downloadZip' | translate">
                            <svg lucideDownload class="w-3.5 h-3.5"></svg>
                          </button>
                        </div>
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
                        <img [src]="pkg.thumbnail || 'logo.svg'" [alt]="pkg.title" loading="lazy" decoding="async" class="w-10 h-10 rounded-xl object-cover bg-slate-900 flex-shrink-0 border border-white/10" />
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
                  }
                </div>
              </div>

              <!-- My Submitted Reports & Author Package Alerts -->
              <div class="space-y-2.5">
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <svg lucideMessageSquare class="w-3.5 h-3.5 text-sky-400"></svg>
                  <span>{{ 'profile.myReportsTitle' | translate }} ({{ authService.myReports().length }})</span>
                </h3>

                @if (authService.myReports().length === 0) {
                  <div class="p-4 rounded-2xl glass-panel text-slate-400 text-[11px]">
                    {{ 'profile.noMyReports' | translate }}
                  </div>
                } @else {
                  <div class="space-y-2.5">
                    @for (rep of authService.myReports(); track rep.id) {
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
                  </div>
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

  readonly activeTab = signal<'packages' | 'favorites' | 'account' | 'moderation'>('packages');

  cdbUsernameInput = '';
  readonly isSyncing = signal(false);
  readonly syncFeedback = signal<string | null>(null);

  editDisplayName = '';
  editBio = '';
  readonly isSavingProfile = signal(false);

  private readonly noteInputs = signal<Record<string, string>>({});
  private readonly actingReportIds = signal<Record<string, boolean>>({});

  constructor() {
    effect(() => {
      const requestedTab = this.authService.requestedDrawerTab();
      if (requestedTab) {
        this.authService.consumeRequestedDrawerTab();
        if (requestedTab === 'moderation' && this.authService.isAdmin()) {
          this.onSelectModerationTab();
        } else if (requestedTab === 'account') {
          this.onSelectAccountTab();
        } else {
          this.activeTab.set(requestedTab);
        }
      }
    });
  }

  // Merge D1 user.packages with catalog packages matching the user's username or linked identities
  readonly userPackages = computed<LuantiPackage[]>(() => {
    const user = this.authService.currentUser();
    if (!user) return [];

    const handles = new Set<string>([
      user.username.toLowerCase(),
      ...user.identities.map(i => i.username.toLowerCase())
    ]);

    const fromCatalog = this.packageService.packages().filter(p => handles.has(p.author.toLowerCase()));
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
        name: p.name,
        title: p.title || p.name,
        type: p.type || 'mod',
        short_desc: p.short_desc || '',
        thumbnail: p.thumbnail_url || p.thumbnail || 'logo.svg',
        banner: p.banner_url || p.banner || p.thumbnail_url || p.thumbnail || 'logo.svg',
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
        byKey.set(key, this.packageService.mergeDualSourcePackage(existing, pkg));
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
    this.authService.fetchMyReports();
  }

  onSelectModerationTab(): void {
    this.activeTab.set('moderation');
    this.authService.fetchModerationQueue(true);
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

  async onSyncContentDb(): Promise<void> {
    if (!this.cdbUsernameInput.trim()) return;
    this.isSyncing.set(true);
    this.syncFeedback.set(null);

    const res = await this.authService.syncContentDbAccount(this.cdbUsernameInput.trim());
    this.isSyncing.set(false);

    if (res.success) {
      this.syncFeedback.set(`Synchronized ${res.count || 0} packages from ContentDB!`);
      this.cdbUsernameInput = '';
    } else {
      this.syncFeedback.set(res.message || 'Could not find ContentDB packages.');
    }
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
}

import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { GitProvider, LuantiPackage, ModerationReport } from '../../core/models/package.model';
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
  LucideLayers
} from '@lucide/angular';

@Component({
  selector: 'app-profile-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
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
    LucideLayers
  ],
  template: `
    @if (authService.currentUser(); as user) {
      <div
        (click)="authService.closeProfileDrawer()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-drawer-title"
        class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">

        <div
          (click)="$event.stopPropagation()"
          class="w-full max-w-lg h-full glass-modal border-l border-white/10 shadow-2xl flex flex-col p-5 sm:p-6 space-y-5 overflow-y-auto animate-in slide-in-from-right duration-300">

          <!-- Drawer Header -->
          <div class="flex items-center justify-between border-b border-white/10 pb-4">
            <div class="flex items-center gap-3">
              <img [src]="user.avatar_url" [alt]="user.username" class="w-12 h-12 rounded-xl border border-slate-700 shadow object-cover" />
              <div>
                <div class="flex items-center gap-2">
                  <h2 id="profile-drawer-title" class="text-base font-bold text-white">
                    {{ user.display_name || user.username }}
                  </h2>
                  @if (authService.isAdmin()) {
                    <span class="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-black uppercase">
                      Admin
                    </span>
                  }
                </div>
                <span class="text-xs text-sky-400 font-mono">&#64;{{ user.username }}</span>
              </div>
            </div>

            <button
              (click)="authService.closeProfileDrawer()"
              aria-label="Close profile drawer"
              class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
              <svg lucideX class="w-5 h-5"></svg>
            </button>
          </div>

          <!-- Navigation Tabs (My Packages, Favorites, Account Info, + Admin Moderation) -->
          <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold overflow-x-auto no-scrollbar">
            <button
              (click)="activeTab.set('packages')"
              [class]="activeTab() === 'packages' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'"
              class="flex-1 py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap">
              <svg lucideLayers class="w-3.5 h-3.5"></svg>
              <span>{{ 'profile.tabPackages' | translate }} ({{ userPackages().length }})</span>
            </button>

            <button
              (click)="activeTab.set('favorites')"
              [class]="activeTab() === 'favorites' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-white'"
              class="flex-1 py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap">
              <svg lucideHeart class="w-3.5 h-3.5"></svg>
              <span>{{ 'profile.tabFavorites' | translate }} ({{ favoritePackages().length }})</span>
            </button>

            <button
              (click)="activeTab.set('account')"
              [class]="activeTab() === 'account' ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-white'"
              class="flex-1 py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap">
              <svg lucideUser class="w-3.5 h-3.5"></svg>
              <span>{{ 'profile.tabAccount' | translate }}</span>
            </button>

            @if (authService.isAdmin()) {
              <button
                (click)="onSelectModerationTab()"
                [class]="activeTab() === 'moderation' ? 'bg-rose-600 text-white shadow' : 'text-rose-400 hover:text-rose-200'"
                class="flex-1 py-2 px-2.5 rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap">
                <svg lucideShieldAlert class="w-3.5 h-3.5"></svg>
                <span>{{ 'profile.tabModeration' | translate }}</span>
                @if (authService.openReportsCount() > 0) {
                  <span class="px-1.5 py-0.2 rounded-full bg-white text-rose-700 text-[10px] font-black">
                    {{ authService.openReportsCount() }}
                  </span>
                }
              </button>
            }
          </div>

          <!-- TAB 1: MY PACKAGES & CONTENTDB PORTFOLIO SYNC -->
          @if (activeTab() === 'packages') {
            <div class="space-y-4 flex-1">
              <!-- ContentDB Importer / Sync -->
              <div class="p-4 rounded-xl bg-sky-950/30 border border-sky-800/40 space-y-3">
                <div class="flex items-center gap-2">
                  <svg lucideGlobe class="w-4 h-4 text-sky-400"></svg>
                  <h4 class="text-xs font-bold text-sky-400 uppercase tracking-wider">
                    {{ 'profile.syncTitle' | translate }}
                  </h4>
                </div>
                <p class="text-xs text-slate-300 leading-relaxed">
                  {{ 'profile.syncDesc' | translate }}
                </p>
                <div class="flex gap-2">
                  <input
                    type="text"
                    [(ngModel)]="cdbUsernameInput"
                    [placeholder]="'profile.syncPlaceholder' | translate"
                    class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <button
                    (click)="onSyncContentDb()"
                    [disabled]="isSyncing() || !cdbUsernameInput.trim()"
                    class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs transition whitespace-nowrap">
                    {{ isSyncing() ? ('profile.syncing' | translate) : ('profile.syncBtn' | translate) }}
                  </button>
                </div>
                @if (syncFeedback()) {
                  <p class="text-xs text-emerald-400">{{ syncFeedback() }}</p>
                }
              </div>

              <!-- User's Published Packages -->
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {{ 'profile.myPackages' | translate }} ({{ userPackages().length }})
                  </h3>
                  <button
                    (click)="onOpenSubmitModal()"
                    class="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1">
                    <svg lucidePlus class="w-3.5 h-3.5"></svg>
                    <span>{{ 'profile.submitGitBtn' | translate }}</span>
                  </button>
                </div>

                @if (userPackages().length === 0) {
                  <div class="p-6 rounded-xl bg-slate-950/40 border border-slate-800 text-center space-y-2">
                    <p class="text-xs text-slate-400">{{ 'profile.noPackages' | translate }}</p>
                    <button
                      (click)="onOpenSubmitModal()"
                      class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition">
                      {{ 'profile.submitGitBtn' | translate }}
                    </button>
                  </div>
                } @else {
                  <div class="space-y-2">
                    @for (pkg of userPackages(); track pkg.id) {
                      <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs">
                        <button
                          type="button"
                          (click)="openPackage(pkg)"
                          class="flex items-center gap-3 text-left flex-1 min-w-0 group">
                          <img [src]="pkg.thumbnail || 'logo.svg'" [alt]="pkg.title" loading="lazy" decoding="async" class="w-10 h-10 rounded-lg object-cover bg-slate-900 flex-shrink-0" />
                          <div class="min-w-0 flex-1">
                            <h4 class="font-bold text-white group-hover:text-sky-400 transition truncate">{{ pkg.title }}</h4>
                            <div class="flex items-center gap-1.5 text-[11px] text-slate-400">
                              <span>{{ (pkg.downloads || 0) | number }} dl</span>
                              <span>•</span>
                              <span class="uppercase font-mono text-[10px] text-sky-400">{{ pkg.type }}</span>
                            </div>
                          </div>
                        </button>

                        <div class="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            (click)="packageService.downloadPackage(pkg)"
                            class="p-2 rounded-lg bg-slate-800 hover:bg-white text-slate-200 hover:text-slate-950 transition"
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
            <div class="space-y-3 flex-1">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                {{ 'profile.tabFavorites' | translate }} ({{ favoritePackages().length }})
              </h3>

              @if (favoritePackages().length === 0) {
                <div class="p-6 rounded-xl bg-slate-950/40 border border-slate-800 text-center space-y-2">
                  <svg lucideHeart class="w-6 h-6 text-slate-600 mx-auto"></svg>
                  <p class="text-xs text-slate-400">{{ 'profile.noFavorites' | translate }}</p>
                </div>
              } @else {
                <div class="space-y-2">
                  @for (pkg of favoritePackages(); track pkg.id) {
                    <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs">
                      <button
                        type="button"
                        (click)="openPackage(pkg)"
                        class="flex items-center gap-3 text-left flex-1 min-w-0 group">
                        <img [src]="pkg.thumbnail || 'logo.svg'" [alt]="pkg.title" loading="lazy" decoding="async" class="w-10 h-10 rounded-lg object-cover bg-slate-900 flex-shrink-0" />
                        <div class="min-w-0 flex-1">
                          <h4 class="font-bold text-white group-hover:text-sky-400 transition truncate">{{ pkg.title }}</h4>
                          <span class="text-[11px] text-slate-400 truncate block">by {{ pkg.author }}</span>
                        </div>
                      </button>

                      <div class="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          (click)="packageService.downloadPackage(pkg)"
                          class="p-2 rounded-lg bg-slate-800 hover:bg-white text-slate-200 hover:text-slate-950 transition"
                          [attr.aria-label]="'card.downloadZip' | translate">
                          <svg lucideDownload class="w-3.5 h-3.5"></svg>
                        </button>
                        <button
                          (click)="settingsService.removeFavorite(pkg.id)"
                          class="p-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 transition"
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

          <!-- TAB 3: ACCOUNT INFORMATION & CONNECTED FORGES -->
          @if (activeTab() === 'account') {
            <div class="space-y-5 flex-1 text-xs">
              <!-- Edit Account Form -->
              <form (ngSubmit)="onSaveAccount()" class="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
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
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
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
                    class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-sky-500"></textarea>
                </div>

                <div class="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      {{ 'profile.preferredEngine' | translate }}
                    </label>
                    <select
                      [ngModel]="settingsService.preferredEngine()"
                      (ngModelChange)="settingsService.preferredEngine.set($event)"
                      name="preferredEngine"
                      class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white">
                      <option value="5.10.0">Luanti 5.10.0+</option>
                      <option value="5.9.0">Luanti 5.9.0</option>
                      <option value="5.8.0">Minetest 5.8.0</option>
                    </select>
                  </div>
                  <div class="flex items-end pb-1">
                    <label class="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        [ngModel]="settingsService.highContrast()"
                        (ngModelChange)="settingsService.highContrast.set($event)"
                        name="highContrast"
                        class="rounded border-slate-700 bg-slate-900 text-sky-500"
                      />
                      <span>{{ 'profile.highContrast' | translate }}</span>
                    </label>
                  </div>
                </div>

                <div class="flex justify-end pt-1">
                  <button
                    type="submit"
                    [disabled]="isSavingProfile()"
                    class="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs transition">
                    {{ 'profile.saveChanges' | translate }}
                  </button>
                </div>
              </form>

              <!-- Connected Accounts & Forges -->
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {{ 'profile.connectedAccounts' | translate }}
                  </h3>
                  <span class="text-[11px] text-slate-500">{{ user.identities.length }} linked</span>
                </div>

                <div class="space-y-2">
                  @for (id of user.identities; track id.provider) {
                    <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
                      <div class="flex items-center gap-2">
                        @if (id.provider === 'contentdb') {
                          <svg lucideGlobe class="w-4 h-4 text-emerald-400"></svg>
                        } @else {
                          <svg lucideGitBranch class="w-4 h-4 text-sky-400"></svg>
                        }
                        <span class="capitalize font-semibold text-white">{{ id.provider }}:</span>
                        <span class="text-slate-300 font-mono">&#64;{{ id.username }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] font-bold text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <svg lucideCheck class="w-3 h-3 text-emerald-400"></svg>
                          <span>{{ 'profile.verified' | translate }}</span>
                        </span>
                        @if (user.identities.length > 1) {
                          <button
                            type="button"
                            (click)="authService.unlinkIdentity(id.provider)"
                            class="text-[10px] text-rose-400 hover:text-rose-300 font-semibold">
                            {{ 'profile.unlinkBtn' | translate }}
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>

                <!-- Connect Other Forges -->
                <div class="pt-1 flex flex-wrap gap-2">
                  @if (!hasProvider('codeberg')) {
                    <button (click)="authService.loginWith('codeberg')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition flex items-center gap-1">
                      <svg lucidePlus class="w-3 h-3 text-sky-400"></svg>
                      <span>{{ 'profile.linkCodeberg' | translate }}</span>
                    </button>
                  }
                  @if (!hasProvider('gitlab')) {
                    <button (click)="authService.loginWith('gitlab')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition flex items-center gap-1">
                      <svg lucidePlus class="w-3 h-3 text-sky-400"></svg>
                      <span>{{ 'profile.linkGitlab' | translate }}</span>
                    </button>
                  }
                  @if (!hasProvider('github')) {
                    <button (click)="authService.loginWith('github')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition flex items-center gap-1">
                      <svg lucidePlus class="w-3 h-3 text-sky-400"></svg>
                      <span>{{ 'profile.linkGithub' | translate }}</span>
                    </button>
                  }
                </div>
              </div>
            </div>
          }

          <!-- TAB 4: ADMIN MODERATION & KILL SWITCH QUEUE -->
          @if (activeTab() === 'moderation' && authService.isAdmin()) {
            <div class="space-y-5 flex-1 text-xs">
              <div class="space-y-2.5">
                <h3 class="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                  <svg lucideShieldAlert class="w-4 h-4"></svg>
                  <span>{{ 'profile.moderationQueueTitle' | translate }} ({{ authService.moderationReports().length }})</span>
                </h3>

                @if (authService.moderationReports().length === 0) {
                  <div class="p-5 rounded-xl bg-slate-950/50 border border-slate-800 text-center text-slate-400">
                    {{ 'profile.noReports' | translate }}
                  </div>
                } @else {
                  <div class="space-y-2.5">
                    @for (rep of authService.moderationReports(); track rep.id) {
                      <div class="p-3.5 rounded-xl bg-rose-950/25 border border-rose-800/70 space-y-2">
                        <div class="flex items-center justify-between">
                          <span class="font-bold text-white">{{ rep.package_id }}</span>
                          <span class="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black uppercase">
                            {{ rep.reason }}
                          </span>
                        </div>
                        @if (rep.details) {
                          <p class="text-slate-300 text-[11px]">{{ rep.details }}</p>
                        }
                        <div class="flex items-center justify-between pt-1">
                          <span class="text-[10px] text-slate-500">
                            By {{ rep.reporter_username || 'Anonymous' }} • {{ rep.created_at | date:'short' }}
                          </span>
                          <button
                            (click)="onAdminKillSwitch(rep)"
                            class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-black text-[11px] transition">
                            {{ 'modal.killSwitchDelist' | translate }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- Delisted / Flagged Packages (With 1-Click Restore) -->
              @if (authService.delistedPackages().length > 0) {
                <div class="space-y-2 pt-2 border-t border-slate-800">
                  <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Delisted / Flagged Packages ({{ authService.delistedPackages().length }})
                  </h4>
                  @for (dPkg of authService.delistedPackages(); track dPkg.id) {
                    <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                      <div>
                        <span class="font-bold text-white block">{{ dPkg.id }}</span>
                        <span class="text-[10px] text-rose-400 uppercase font-mono">{{ dPkg.status }} — {{ dPkg.moderation_reason }}</span>
                      </div>
                      <button
                        (click)="onRestorePackage(dPkg)"
                        class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition">
                        {{ 'modal.killSwitchRestore' | translate }}
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <!-- Footer Actions -->
          <div class="pt-4 border-t border-slate-800 flex items-center justify-between">
            <button
              (click)="authService.logout()"
              class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-400 text-slate-300 text-xs font-semibold transition">
              {{ 'profile.signOut' | translate }}
            </button>
            <span class="text-[10px] text-slate-500">LuantiHub Creator ID</span>
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

  readonly activeTab = signal<'packages' | 'favorites' | 'account' | 'moderation'>('packages');

  cdbUsernameInput = '';
  readonly isSyncing = signal(false);
  readonly syncFeedback = signal<string | null>(null);

  editDisplayName = '';
  editBio = '';
  readonly isSavingProfile = signal(false);

  // Merge D1 user.packages with catalog packages matching the user's username or linked identities
  readonly userPackages = computed<LuantiPackage[]>(() => {
    const user = this.authService.currentUser();
    if (!user) return [];

    const handles = new Set<string>([
      user.username.toLowerCase(),
      ...user.identities.map(i => i.username.toLowerCase())
    ]);

    const fromCatalog = this.packageService.packages().filter(p => handles.has(p.author.toLowerCase()));
    const fromD1: LuantiPackage[] = (user.packages || []).map((p: any) => ({
      id: p.id || `${p.author}/${p.name}`,
      author: p.author,
      name: p.name,
      title: p.title || p.name,
      type: p.type || 'mod',
      short_desc: p.short_desc || '',
      thumbnail: p.thumbnail_url || p.thumbnail || 'logo.svg',
      score: (typeof p.score === 'number' && p.score >= 1 && p.score <= 5) ? p.score : 0,
      downloads: p.downloads_count ?? p.downloads ?? 0,
      license: p.license || '',
      source: p.source || (p.provider && p.provider !== 'contentdb' ? 'git' : 'official'),
      tags: p.tags || [p.type || 'mod']
    }));

    const seen = new Set<string>();
    const combined: LuantiPackage[] = [];
    for (const pkg of [...fromD1, ...fromCatalog]) {
      const key = pkg.id.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(pkg);
      }
    }
    return combined;
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

  onSelectModerationTab(): void {
    this.activeTab.set('moderation');
    this.authService.fetchModerationQueue();
  }

  openPackage(pkg: LuantiPackage): void {
    this.authService.closeProfileDrawer(false);
    this.packageService.openPackageModal(pkg);
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
    await this.packageService.moderatePackage(
      { author, name, id: rep.package_id },
      'delist',
      `Delisted via Admin Report #${rep.id} (${rep.reason})`,
      rep.id
    );
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
}

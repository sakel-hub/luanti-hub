import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  ElementRef,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PackageService } from '../../core/services/package.service';
import { AuthService } from '../../core/services/auth.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { LuantiPackage, SortOption, UserIdentity } from '../../core/models/package.model';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import {
  LucideX,
  LucideCheck,
  LucideStar,
  LucideDownload,
  LucideHeart,
  LucideGitBranch,
  LucideGlobe,
  LucideShare2,
  LucideExternalLink,
  LucideUser,
  LucideSlidersHorizontal,
  LucideChevronLeft,
  LucideChevronRight,
  LucideTag
} from '@lucide/angular';

const AUTHOR_PACKAGES_PAGE_SIZE = 8;

@Component({
  selector: 'app-author-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    CompactNumberPipe,
    TranslatePipe,
    TooltipDirective,
    LucideX,
    LucideCheck,
    LucideStar,
    LucideDownload,
    LucideHeart,
    LucideGitBranch,
    LucideGlobe,
    LucideShare2,
    LucideExternalLink,
    LucideUser,
    LucideSlidersHorizontal,
    LucideChevronLeft,
    LucideChevronRight,
    LucideTag
  ],
  template: `
    @if (packageService.activeAuthorProfile(); as author) {
      <div
        (click)="packageService.closeAuthorDrawer()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="author-drawer-title"
        class="z-50 flex justify-end luanti-modal-backdrop">

        <div
          #drawerScrollContainer
          (click)="$event.stopPropagation()"
          class="w-full max-w-2xl h-full glass-drawer flex flex-col p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto luanti-drawer-panel">

          <!-- Sticky Mobile-First Creator Header -->
          <div class="sticky -top-4 sm:-top-6 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-4 sm:pt-5 pb-3.5 bg-slate-950/85 backdrop-blur-xl border-b border-white/10 flex items-start justify-between gap-3">
            <div class="flex items-center gap-3 sm:gap-3.5 min-w-0">
              <div class="relative flex-shrink-0">
                @if (!avatarFailed()) {
                  <img
                    [src]="author.avatar_url"
                    [alt]="author.username"
                    (error)="avatarFailed.set(true)"
                    class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border border-white/20 shadow-lg object-cover bg-slate-900"
                  />
                } @else {
                  <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-300 font-black text-lg sm:text-xl shadow-lg">
                    {{ author.username.charAt(0).toUpperCase() }}
                  </div>
                }
                @if (author.is_registered) {
                  <span
                    [appTooltip]="'author.verifiedCreator' | translate"
                    class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center ring-2 ring-slate-950 shadow">
                    <svg lucideCheck class="w-2.5 h-2.5 stroke-[3]"></svg>
                  </span>
                }
              </div>

              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 id="author-drawer-title" class="text-base sm:text-lg font-extrabold text-white truncate">
                    {{ author.display_name || author.username }}
                  </h2>
                  @if (author.is_registered) {
                    <span class="glass-badge glass-badge-emerald font-bold text-[10px]">
                      {{ 'author.verifiedCreator' | translate }}
                    </span>
                  }
                </div>
                <span class="text-xs text-sky-400 font-mono block truncate">&#64;{{ author.username }}</span>
              </div>
            </div>

            <div class="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                (click)="shareAuthorProfile()"
                [appTooltip]="copiedShareUrl() ? ('modal.copied' | translate) : ('author.shareProfile' | translate)"
                [attr.aria-label]="'author.shareProfile' | translate"
                class="p-2 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer">
                @if (copiedShareUrl()) {
                  <svg lucideCheck class="w-4 h-4 text-emerald-400"></svg>
                } @else {
                  <svg lucideShare2 class="w-4 h-4 text-sky-400"></svg>
                }
              </button>

              <button
                type="button"
                (click)="packageService.closeAuthorDrawer()"
                aria-label="Close author profile drawer"
                class="p-2 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer">
                <svg lucideX class="w-4 h-4 sm:w-5 sm:h-5"></svg>
              </button>
            </div>
          </div>

          <!-- Creator Bio & Quick Actions Card -->
          <div class="p-4 rounded-2xl glass-panel space-y-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <svg lucideUser class="w-3.5 h-3.5 text-sky-400"></svg>
                <span>{{ 'author.aboutCreator' | translate }}</span>
              </span>

              <div class="flex items-center gap-2 flex-wrap">
                @if (isOwnProfile()) {
                  <button
                    type="button"
                    (click)="openOwnAccountSettings()"
                    class="px-2.5 py-1 rounded-lg glass-btn text-sky-300 hover:text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer">
                    <span>{{ 'author.editMyBio' | translate }}</span>
                  </button>
                }
                <button
                  type="button"
                  (click)="filterCatalogByAuthor()"
                  class="px-2.5 py-1 rounded-lg glass-btn text-slate-200 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer">
                  <span>{{ 'author.filterAllCatalog' | translate }}</span>
                  <svg lucideExternalLink class="w-3 h-3 text-sky-400"></svg>
                </button>
              </div>
            </div>

            <p class="text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-line break-words">
              {{ author.bio || ('author.noBioFallback' | translate) }}
            </p>

            <!-- Verified Forges, ContentDB Link & Support Creator CTA -->
            @if (author.identities.length > 0 || author.contentdb_url || author.donate_url) {
              <div class="pt-2 border-t border-white/10 flex items-center gap-1.5 flex-wrap">
                @for (id of author.identities; track id.provider + ':' + id.username) {
                  <a
                    [href]="getIdentityUrl(id)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-2.5 py-1 rounded-xl glass-pill text-slate-200 hover:text-white hover:border-sky-400/50 text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer">
                    <span class="uppercase text-[9px] font-black text-sky-400">{{ id.provider }}</span>
                    <span class="font-mono">&#64;{{ id.username }}</span>
                    <svg lucideExternalLink class="w-2.5 h-2.5 text-slate-400"></svg>
                  </a>
                }

                @if (author.contentdb_url && !hasContentDbIdentity(author.identities)) {
                  <a
                    [href]="author.contentdb_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-2.5 py-1 rounded-xl glass-pill text-slate-200 hover:text-white hover:border-sky-400/50 text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer">
                    <svg lucideGlobe class="w-3 h-3 text-sky-400"></svg>
                    <span>ContentDB</span>
                    <svg lucideExternalLink class="w-2.5 h-2.5 text-slate-400"></svg>
                  </a>
                }

                @if (author.donate_url) {
                  <a
                    [href]="author.donate_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ml-auto px-3 py-1 rounded-xl glass-btn-rose text-rose-100 text-[11px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer">
                    <svg lucideHeart class="w-3 h-3 text-rose-300 fill-rose-400" [style.fill]="'#fb7185'"></svg>
                    <span>{{ 'author.supportCreator' | translate }}</span>
                    <svg lucideExternalLink class="w-2.5 h-2.5"></svg>
                  </a>
                }
              </div>
            }
          </div>

          <!-- 4-Card Creator Impact Scorecard (Mobile-First 2x2 Grid -> 4-Col on sm+) -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div class="p-3 rounded-2xl glass-panel flex flex-col justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {{ 'author.totalPackages' | translate }}
              </span>
              <span class="text-base sm:text-lg font-black text-white mt-1">
                {{ authorPackages().length }}
              </span>
              <span class="text-[10px] text-slate-400 mt-0.5 truncate">
                {{ typeBreakdownSummary() }}
              </span>
            </div>

            <div class="p-3 rounded-2xl glass-panel flex flex-col justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {{ 'author.totalDownloads' | translate }}
              </span>
              <span class="text-base sm:text-lg font-black text-emerald-400 mt-1">
                {{ totalDownloads() | compactNumber }}
              </span>
              <span class="text-[10px] text-slate-400 mt-0.5 truncate">
                CDB {{ totalCdbDownloads() | compactNumber }} • Hub {{ totalHubDownloads() | compactNumber }}
              </span>
            </div>

            <div class="p-3 rounded-2xl glass-panel flex flex-col justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {{ 'author.avgRating' | translate }}
              </span>
              <div class="flex items-center gap-1 text-base sm:text-lg font-black text-amber-400 mt-1">
                <svg lucideStar class="w-4 h-4 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
                <span>{{ averageRating() > 0 ? averageRating() : '—' }}</span>
              </div>
              <span class="text-[10px] text-slate-400 mt-0.5 truncate">
                {{ ratedCount() }} rated
              </span>
            </div>

            <div class="p-3 rounded-2xl glass-panel flex flex-col justify-between">
              <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {{ 'author.sourcesLabel' | translate }}
              </span>
              <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                @if (officialCount() > 0) {
                  <span class="glass-badge glass-badge-sky font-bold text-[10px]">
                    {{ officialCount() }} CDB
                  </span>
                }
                @if (gitCount() > 0) {
                  <span class="glass-badge glass-badge-amber font-bold text-[10px]">
                    {{ gitCount() }} Git
                  </span>
                }
              </div>
              <span class="text-[10px] text-slate-400 mt-0.5 truncate">
                Open-source
              </span>
            </div>
          </div>

          <!-- Top Specialties & Tags (Interactive Filter Pills) -->
          @if (topAuthorTags().length > 0) {
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <svg lucideTag class="w-3 h-3 text-sky-400"></svg>
                  <span>{{ 'author.topTags' | translate }}</span>
                </span>
                @if (selectedTag() !== 'all') {
                  <button
                    type="button"
                    (click)="selectTag('all')"
                    class="text-[10px] font-semibold text-sky-400 hover:text-sky-300 transition cursor-pointer">
                    {{ 'catalog.allTags' | translate }}
                  </button>
                }
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                @for (tag of topAuthorTags(); track tag.name) {
                  <button
                    type="button"
                    (click)="selectTag(selectedTag() === tag.name ? 'all' : tag.name)"
                    [class]="selectedTag() === tag.name ? 'bg-sky-500/25 text-sky-300 border-sky-400/50 shadow-sm' : 'glass-pill text-slate-300 hover:text-white'"
                    class="px-2.5 py-0.5 rounded-full border text-[11px] font-medium transition cursor-pointer">
                    #{{ tag.name }} <span class="text-slate-400 font-mono text-[10px]">({{ tag.count }})</span>
                  </button>
                }
              </div>
            </div>
          }

          <!-- Author's Packages Section (Filterable, Sortable & Paginated 8/page) -->
          <div #packagesSectionTop class="space-y-3 flex-1 flex flex-col">
            <!-- Category Filter Pills + Sort Controls -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 border-t border-white/10">
              <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                <button
                  type="button"
                  (click)="selectCategory('all')"
                  [class]="selectedCategory() === 'all' ? 'bg-sky-500/25 text-sky-300 border-sky-400/50' : 'glass-pill text-slate-400 hover:text-white'"
                  class="px-2.5 py-1 rounded-xl border text-[11px] font-bold whitespace-nowrap flex-shrink-0 transition cursor-pointer">
                  {{ 'header.filterAll' | translate }} ({{ authorPackages().length }})
                </button>
                @if (gameCount() > 0) {
                  <button
                    type="button"
                    (click)="selectCategory('game')"
                    [class]="selectedCategory() === 'game' ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/50' : 'glass-pill text-slate-400 hover:text-white'"
                    class="px-2.5 py-1 rounded-xl border text-[11px] font-bold whitespace-nowrap flex-shrink-0 transition cursor-pointer">
                    {{ 'header.filterGames' | translate }} ({{ gameCount() }})
                  </button>
                }
                @if (modCount() > 0) {
                  <button
                    type="button"
                    (click)="selectCategory('mod')"
                    [class]="selectedCategory() === 'mod' ? 'bg-sky-500/25 text-sky-300 border-sky-400/50' : 'glass-pill text-slate-400 hover:text-white'"
                    class="px-2.5 py-1 rounded-xl border text-[11px] font-bold whitespace-nowrap flex-shrink-0 transition cursor-pointer">
                    {{ 'header.filterMods' | translate }} ({{ modCount() }})
                  </button>
                }
                @if (txpCount() > 0) {
                  <button
                    type="button"
                    (click)="selectCategory('txp')"
                    [class]="selectedCategory() === 'txp' ? 'bg-purple-500/25 text-purple-300 border-purple-400/50' : 'glass-pill text-slate-400 hover:text-white'"
                    class="px-2.5 py-1 rounded-xl border text-[11px] font-bold whitespace-nowrap flex-shrink-0 transition cursor-pointer">
                    {{ 'header.filterTxp' | translate }} ({{ txpCount() }})
                  </button>
                }
                @if (gitCount() > 0) {
                  <button
                    type="button"
                    (click)="selectCategory('git')"
                    [class]="selectedCategory() === 'git' ? 'bg-amber-500/25 text-amber-300 border-amber-400/50' : 'glass-pill text-slate-400 hover:text-white'"
                    class="px-2.5 py-1 rounded-xl border text-[11px] font-bold whitespace-nowrap flex-shrink-0 transition cursor-pointer">
                    {{ 'header.filterGit' | translate }} ({{ gitCount() }})
                  </button>
                }
              </div>

              <div class="flex items-center gap-1.5 glass-panel rounded-xl px-2.5 py-1 text-[11px] self-start sm:self-auto flex-shrink-0">
                <svg lucideSlidersHorizontal class="w-3 h-3 text-sky-400"></svg>
                <select
                  [ngModel]="sortBy()"
                  (ngModelChange)="onSortChange($event)"
                  aria-label="Sort author packages"
                  class="bg-transparent text-white font-bold focus:outline-none cursor-pointer">
                  <option value="downloads" class="bg-slate-900 text-white">{{ 'catalog.sortDownloads' | translate }}</option>
                  <option value="score" class="bg-slate-900 text-white">{{ 'catalog.sortScore' | translate }}</option>
                  <option value="updated" class="bg-slate-900 text-white">{{ 'catalog.sortUpdated' | translate }}</option>
                  <option value="title" class="bg-slate-900 text-white">{{ 'catalog.sortTitle' | translate }}</option>
                </select>
              </div>
            </div>

            <!-- Inline Quick Search when author has > 5 packages -->
            @if (authorPackages().length > 5) {
              <div>
                <input
                  type="text"
                  [ngModel]="searchTerm()"
                  (ngModelChange)="onSearchInput($event)"
                  [placeholder]="'author.searchAuthorPackages' | translate"
                  class="w-full glass-input rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
              </div>
            }

            <!-- Paginated Package List -->
            @if (filteredAuthorPackages().length === 0) {
              <div class="p-6 rounded-2xl glass-panel text-center space-y-2">
                <p class="text-xs text-slate-400">{{ 'common.noResults' | translate }}</p>
              </div>
            } @else {
              <div class="space-y-2">
                @for (pkg of pagedAuthorPackages(); track pkg.id) {
                  <div class="p-3 rounded-2xl glass-panel flex items-center justify-between gap-3 text-xs hover:border-sky-400/40 transition">
                    <button
                      type="button"
                      (click)="openPackage(pkg)"
                      class="flex items-center gap-3 text-left flex-1 min-w-0 group cursor-pointer">
                      <img
                        [src]="pkg.thumbnail || 'logo.svg'"
                        [alt]="pkg.title"
                        loading="lazy"
                        decoding="async"
                        class="w-11 h-11 rounded-xl object-cover bg-slate-900 flex-shrink-0 border border-white/10"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <h4 class="font-bold text-white group-hover:text-sky-400 transition truncate">
                            {{ pkg.title }}
                          </h4>
                          @if (pkg.score > 0) {
                            <span class="flex items-center gap-0.5 text-[10px] font-bold text-amber-400 flex-shrink-0">
                              <svg lucideStar class="w-2.5 h-2.5 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
                              {{ pkg.score }}
                            </span>
                          }
                        </div>
                        <p class="text-[11px] text-slate-400 truncate mt-0.5">
                          {{ pkg.short_desc || pkg.name }}
                        </p>
                        <div class="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1 flex-wrap">
                          <span
                            [class]="pkg.type === 'game' ? 'glass-badge-emerald' : pkg.type === 'txp' ? 'glass-badge-purple' : 'glass-badge-sky'"
                            class="glass-badge font-black uppercase tracking-wider text-[9px] px-1.5 py-0">
                            {{ pkg.type }}
                          </span>
                          @if (pkg.sources?.includes('git') || pkg.source === 'git') {
                            <span class="glass-badge glass-badge-amber font-bold text-[9px] px-1.5 py-0 flex items-center gap-0.5">
                              <svg lucideGitBranch class="w-2.5 h-2.5"></svg>
                              Git
                            </span>
                          }
                          <span>•</span>
                          <span class="font-mono">{{ (pkg.downloads || 0) | compactNumber }} dl</span>
                        </div>
                      </div>
                    </button>

                    <div class="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        (click)="settingsService.toggleFavorite(pkg.id)"
                        [attr.aria-label]="settingsService.isFavorite(pkg.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                        class="p-2 rounded-xl glass-icon-btn text-white transition cursor-pointer">
                        <svg
                          lucideHeart
                          [class]="settingsService.isFavorite(pkg.id) ? 'w-3.5 h-3.5 fill-rose-500 text-rose-500' : 'w-3.5 h-3.5'"
                          [style.fill]="settingsService.isFavorite(pkg.id) ? '#f43f5e' : 'none'"
                          [color]="settingsService.isFavorite(pkg.id) ? '#f43f5e' : 'currentColor'">
                        </svg>
                      </button>

                      <button
                        type="button"
                        (click)="packageService.downloadPackage(pkg)"
                        [attr.aria-label]="'card.downloadZip' | translate"
                        class="p-2 rounded-xl glass-btn-primary text-white transition cursor-pointer">
                        <svg lucideDownload class="w-3.5 h-3.5"></svg>
                      </button>
                    </div>
                  </div>
                }
              </div>

              <!-- Pagination Bar (8 per page) -->
              @if (totalPages() > 1) {
                <div class="pt-2 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    (click)="setPage(currentPage() - 1)"
                    [disabled]="currentPage() <= 1"
                    class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 font-semibold flex items-center gap-1 transition cursor-pointer">
                    <svg lucideChevronLeft class="w-3.5 h-3.5"></svg>
                    <span>{{ 'profile.prevPage' | translate }}</span>
                  </button>

                  <span class="text-slate-400 font-mono text-[11px]">
                    {{ 'profile.pageLabel' | translate }} {{ currentPage() }} / {{ totalPages() }}
                    ({{ filteredAuthorPackages().length }})
                  </span>

                  <button
                    type="button"
                    (click)="setPage(currentPage() + 1)"
                    [disabled]="currentPage() >= totalPages()"
                    class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 font-semibold flex items-center gap-1 transition cursor-pointer">
                    <span>{{ 'profile.nextPage' | translate }}</span>
                    <svg lucideChevronRight class="w-3.5 h-3.5"></svg>
                  </button>
                </div>
              }
            }
          </div>

        </div>
      </div>
    }
  `
})
export class AuthorDrawerComponent {
  readonly packageService = inject(PackageService);
  readonly authService = inject(AuthService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);

  @ViewChild('packagesSectionTop') packagesSectionTop?: ElementRef<HTMLElement>;

  readonly avatarFailed = signal(false);
  readonly copiedShareUrl = signal(false);
  readonly selectedCategory = signal<'all' | 'game' | 'mod' | 'txp' | 'git'>('all');
  readonly selectedTag = signal<string>('all');
  readonly sortBy = signal<SortOption>('downloads');
  readonly searchTerm = signal<string>('');
  readonly currentPage = signal<number>(1);

  constructor() {
    effect(() => {
      const username = this.packageService.activeAuthorUsername();
      if (username) {
        this.avatarFailed.set(false);
        this.selectedCategory.set('all');
        this.selectedTag.set('all');
        this.sortBy.set('downloads');
        this.searchTerm.set('');
        this.currentPage.set(1);
      }
    });
  }

  readonly isOwnProfile = computed(() => {
    const user = this.authService.currentUser();
    const author = this.packageService.activeAuthorProfile();
    if (!user || !author) return false;
    const authorLower = author.username.toLowerCase();
    return (
      user.username.toLowerCase() === authorLower ||
      (user.identities || []).some(i => (i.username || '').toLowerCase() === authorLower)
    );
  });

  readonly authorPackages = computed<LuantiPackage[]>(() => {
    const username = this.packageService.activeAuthorUsername();
    if (!username) return [];
    return this.packageService.getAuthorPackages(username);
  });

  readonly gameCount = computed(() => this.authorPackages().filter(p => p.type === 'game').length);
  readonly modCount = computed(() => this.authorPackages().filter(p => p.type === 'mod').length);
  readonly txpCount = computed(() => this.authorPackages().filter(p => p.type === 'txp').length);
  readonly gitCount = computed(() =>
    this.authorPackages().filter(p => p.sources?.includes('git') || p.source === 'git').length
  );
  readonly officialCount = computed(() =>
    this.authorPackages().filter(p => p.sources?.includes('official') || p.source === 'official').length
  );

  readonly typeBreakdownSummary = computed(() => {
    const parts: string[] = [];
    if (this.gameCount() > 0) parts.push(`${this.gameCount()}G`);
    if (this.modCount() > 0) parts.push(`${this.modCount()}M`);
    if (this.txpCount() > 0) parts.push(`${this.txpCount()}T`);
    return parts.join(' • ') || '0';
  });

  readonly totalDownloads = computed(() =>
    this.authorPackages().reduce((sum, p) => sum + (p.downloads || 0), 0)
  );
  readonly totalCdbDownloads = computed(() =>
    this.authorPackages().reduce((sum, p) => sum + (p.contentdb_downloads || 0), 0)
  );
  readonly totalHubDownloads = computed(() =>
    this.authorPackages().reduce((sum, p) => sum + (p.luantihub_downloads || 0), 0)
  );

  readonly ratedCount = computed(() =>
    this.authorPackages().filter(p => (p.score || 0) > 0).length
  );

  readonly averageRating = computed(() => {
    const rated = this.authorPackages().filter(p => (p.score || 0) > 0);
    if (rated.length === 0) return 0;
    const sum = rated.reduce((acc, p) => acc + (p.score || 0), 0);
    return Math.round((sum / rated.length) * 10) / 10;
  });

  readonly topAuthorTags = computed<Array<{ name: string; count: number }>>(() => {
    const counts = new Map<string, number>();
    const ignored = new Set(['mod', 'game', 'txp', 'texture_pack', 'git', 'contentdb']);
    for (const pkg of this.authorPackages()) {
      for (const rawTag of pkg.tags || []) {
        const clean = String(rawTag || '').trim().toLowerCase();
        if (!clean || ignored.has(clean)) continue;
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6);
  });

  readonly filteredAuthorPackages = computed<LuantiPackage[]>(() => {
    const cat = this.selectedCategory();
    const tag = this.selectedTag().toLowerCase();
    const q = this.searchTerm().trim().toLowerCase();
    const sort = this.sortBy();

    const filtered = this.authorPackages().filter(pkg => {
      if (cat === 'git') {
        if (!pkg.sources?.includes('git') && pkg.source !== 'git') return false;
      } else if (cat !== 'all' && pkg.type !== cat) {
        return false;
      }

      if (tag !== 'all') {
        const hasTag = (pkg.tags || []).some(t => t.toLowerCase() === tag);
        if (!hasTag) return false;
      }

      if (q) {
        const hay = `${pkg.title} ${pkg.name} ${pkg.short_desc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'score') {
        return (b.score || 0) - (a.score || 0) || (b.downloads || 0) - (a.downloads || 0);
      }
      if (sort === 'updated') {
        const tB = b.updated_at || b.created_at ? new Date(b.updated_at || b.created_at!).getTime() || 0 : Number(b.release_id || 0);
        const tA = a.updated_at || a.created_at ? new Date(a.updated_at || a.created_at!).getTime() || 0 : Number(a.release_id || 0);
        return tB - tA || (b.downloads || 0) - (a.downloads || 0);
      }
      if (sort === 'title') {
        return (a.title || a.name).localeCompare(b.title || b.name);
      }
      return (b.downloads || 0) - (a.downloads || 0);
    });
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredAuthorPackages().length / AUTHOR_PACKAGES_PAGE_SIZE))
  );

  readonly pagedAuthorPackages = computed<LuantiPackage[]>(() => {
    const page = Math.min(Math.max(1, this.currentPage()), this.totalPages());
    const start = (page - 1) * AUTHOR_PACKAGES_PAGE_SIZE;
    return this.filteredAuthorPackages().slice(start, start + AUTHOR_PACKAGES_PAGE_SIZE);
  });

  selectCategory(cat: 'all' | 'game' | 'mod' | 'txp' | 'git'): void {
    this.selectedCategory.set(cat);
    this.currentPage.set(1);
  }

  selectTag(tag: string): void {
    this.selectedTag.set(tag);
    this.currentPage.set(1);
  }

  onSortChange(nextSort: SortOption): void {
    this.sortBy.set(nextSort);
    this.currentPage.set(1);
  }

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
    this.currentPage.set(1);
  }

  setPage(nextPage: number): void {
    const clamped = Math.min(Math.max(1, nextPage), this.totalPages());
    this.currentPage.set(clamped);
    try {
      this.packagesSectionTop?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {
      // Ignore scrollIntoView errors in headless tests
    }
  }

  openPackage(pkg: LuantiPackage): void {
    this.packageService.openPackageFromAuthorDrawer(pkg, true);
  }

  filterCatalogByAuthor(): void {
    const author = this.packageService.activeAuthorProfile();
    if (!author) return;
    this.packageService.searchByTermFromModal(author.username);
  }

  openOwnAccountSettings(): void {
    this.packageService.closeAuthorDrawer(false, false);
    this.authService.openProfileDrawer(true);
  }

  getIdentityUrl(id: UserIdentity): string {
    if (id.profile_url && id.profile_url.startsWith('http')) return id.profile_url;
    switch (id.provider) {
      case 'codeberg':
        return `https://codeberg.org/${encodeURIComponent(id.username)}`;
      case 'mesehub':
        return `https://git.minetest.land/${encodeURIComponent(id.username)}`;
      case 'gitlab':
        return `https://gitlab.com/${encodeURIComponent(id.username)}`;
      case 'contentdb':
        return `https://content.luanti.org/users/${encodeURIComponent(id.username)}/`;
      default:
        return `https://github.com/${encodeURIComponent(id.username)}`;
    }
  }

  hasContentDbIdentity(identities: UserIdentity[]): boolean {
    return (identities || []).some(i => i.provider === 'contentdb');
  }

  async shareAuthorProfile(): Promise<void> {
    const author = this.packageService.activeAuthorProfile();
    if (!author || typeof window === 'undefined') return;
    const shareUrl = `${window.location.origin}/author/${encodeURIComponent(author.username)}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
      this.copiedShareUrl.set(true);
      this.pwaService.showToast('common.copiedToClipboard');
      setTimeout(() => this.copiedShareUrl.set(false), 2000);
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: `${author.display_name} (@${author.username}) — LuantiHub`,
          url: shareUrl
        });
      }
    } catch {
      // Ignore user cancellation of native share sheet
    }
  }
}

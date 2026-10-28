import { Component, Input, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LuantiPackage, CommunityReview } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { AuthService } from '../../core/services/auth.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideX,
  LucideShare2,
  LucideHeart,
  LucideCopy,
  LucideCheck,
  LucideStar,
  LucideShieldCheck,
  LucideGitBranch,
  LucideGlobe,
  LucideDownload
} from '@lucide/angular';

@Component({
  selector: 'app-package-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ImgFallbackDirective,
    TooltipDirective,
    TranslatePipe,
    LucideX,
    LucideShare2,
    LucideHeart,
    LucideCopy,
    LucideCheck,
    LucideStar,
    LucideShieldCheck,
    LucideGitBranch,
    LucideGlobe,
    LucideDownload
  ],
  template: `
    @if (package) {
      <div 
        (click)="onBackdropClick($event)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-package-title"
        class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
        
        <div 
          (click)="$event.stopPropagation()"
          class="relative w-full max-w-4xl max-h-screen sm:max-h-[92vh] bg-slate-900 border-0 sm:border border-slate-700/80 rounded-none sm:rounded-2xl shadow-2xl overflow-y-auto flex flex-col animate-in zoom-in-95 duration-200 my-auto">
          
          <!-- Top Banner Hero (Clear & High Visibility) -->
          <div class="relative w-full h-64 sm:h-80 md:h-96 bg-slate-950 flex-shrink-0 overflow-hidden">
            <img 
              [src]="bannerImage" 
              [fallbackThumbnail]="package.thumbnail"
              appImgFallback
              [alt]="package.title"
              class="w-full h-full object-cover object-center filter brightness-100"
            />
            <div class="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/25 to-transparent w-full sm:w-2/3"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-slate-900/95 via-transparent to-transparent"></div>

            <!-- Floating Round Close Button (Top Right) -->
            <button 
              (click)="packageService.closePackageModal()"
              [attr.aria-label]="'modal.close' | translate"
              [appTooltip]="'modal.close' | translate"
              class="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 flex items-center justify-center transition z-30 shadow-lg">
              <svg lucideX class="w-5 h-5"></svg>
            </button>

            <!-- Foreground Hero Content & Actions -->
            <div class="absolute bottom-5 left-5 sm:left-8 right-5 sm:right-8 flex flex-col justify-end gap-3 z-20">
              
              <!-- Badges (Consistent with Cards) -->
              <div class="flex items-center gap-2 flex-wrap">
                <span 
                  [class]="package.type === 'game' ? 'bg-emerald-500 text-white' : package.type === 'txp' ? 'bg-purple-500 text-white' : 'bg-sky-500 text-white'"
                  class="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider shadow">
                  {{ package.type }}
                </span>

                @if (package.source === 'git') {
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-slate-950 flex items-center gap-1 shadow">
                    <svg lucideGitBranch class="w-3 h-3 text-slate-950"></svg>
                    <span>Git</span>
                  </span>
                } @else {
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                    <svg lucideGlobe class="w-3 h-3 text-emerald-300"></svg>
                    <span>ContentDB</span>
                  </span>
                }

                @if (package.featured) {
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                    Featured
                  </span>
                }
              </div>

              <!-- Title -->
              <h2 id="modal-package-title" class="text-2xl sm:text-4xl lg:text-5xl font-black text-white drop-shadow-2xl">
                {{ package.title }}
              </h2>

              <!-- Action Buttons Row -->
              <div class="flex items-center gap-3 pt-1 flex-wrap">
                <!-- Primary Download Button with File Size -->
                <button 
                  (click)="openSetupModal()"
                  class="h-10 sm:h-11 px-6 sm:px-7 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-black text-xs sm:text-sm flex items-center gap-2 shadow-2xl hover:scale-105 transition whitespace-nowrap">
                  <svg lucideDownload class="w-4 h-4 text-slate-950"></svg>
                  <span>Download ({{ package.file_size || '1.8 MB' }})</span>
                </button>

                <!-- Add to Favorites / My List Button -->
                <button 
                  (click)="onFavoriteClick()"
                  [appTooltip]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full border border-slate-500 bg-slate-900/80 hover:border-white text-white flex items-center justify-center transition shadow hover:scale-105">
                  <svg 
                    lucideHeart 
                    class="w-4 h-4 transition-colors"
                    [class.fill-rose-500]="settingsService.isFavorite(package.id)"
                    [class.text-rose-500]="settingsService.isFavorite(package.id)">
                  </svg>
                </button>

                <!-- Share Button -->
                <button 
                  (click)="pwaService.sharePackage(package.title, package.short_desc, shareUrl)"
                  [appTooltip]="'modal.shareTooltip' | translate"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full border border-slate-500 bg-slate-900/80 hover:border-white text-white flex items-center justify-center transition shadow hover:scale-105">
                  <svg lucideShare2 class="w-4 h-4"></svg>
                </button>

                <!-- Git Repository Link Button -->
                @if (package.repo_url) {
                  <a 
                    [href]="package.repo_url" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    [appTooltip]="'modal.viewGitRepo' | translate"
                    class="w-10 sm:w-11 h-10 sm:h-11 rounded-full border border-slate-500 bg-slate-900/80 hover:border-white text-white flex items-center justify-center transition shadow hover:scale-105"
                    [attr.aria-label]="'modal.viewGitRepo' | translate">
                    <svg lucideGitBranch class="w-4 h-4"></svg>
                  </a>
                }
              </div>

            </div>

          </div>

          <!-- Netflix 2-Column Details Body -->
          <div class="p-5 sm:p-8 space-y-6">
            
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
              
              <!-- Left Column: Synopsis, Engine Compatibility & 1-Click Setup -->
              <div class="lg:col-span-2 space-y-4">
                
                <!-- Metrics Bar -->
                <div class="flex items-center gap-3 text-xs sm:text-sm flex-wrap">
                  <span class="text-emerald-400 font-bold">
                    {{ ((package.score || 4.5) * 20) | number:'1.0-0' }}% Match
                  </span>
                  <span class="text-slate-400 font-mono">Luanti {{ package.min_minetest_version || '5.8+' }}</span>
                  <span class="text-slate-400 font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                    License: {{ package.license }}
                  </span>
                  <span class="text-rose-400 font-semibold bg-rose-950/60 border border-rose-800/80 px-2 py-0.5 rounded text-[11px]">
                    #1 in {{ package.type | uppercase }} Today
                  </span>
                </div>

                <!-- Description / Synopsis -->
                <p class="text-slate-200 text-sm sm:text-base leading-relaxed">
                  {{ package.desc || package.short_desc }}
                </p>

                <!-- Dependencies Section (ContentDB parity) -->
                @if ((package.dependencies && package.dependencies.length > 0) || (package.optional_dependencies && package.optional_dependencies.length > 0)) {
                  <div class="space-y-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                    <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider">Package Dependencies</h3>
                    
                    @if (package.dependencies && package.dependencies.length > 0) {
                      <div>
                        <span class="text-slate-400 font-semibold text-[11px] block mb-1">Required:</span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (dep of package.dependencies; track dep) {
                            <span class="px-2 py-0.5 rounded-md bg-sky-950/80 text-sky-300 font-mono text-[11px] border border-sky-800/80">
                              {{ dep }}
                            </span>
                          }
                        </div>
                      </div>
                    }

                    @if (package.optional_dependencies && package.optional_dependencies.length > 0) {
                      <div>
                        <span class="text-slate-400 font-semibold text-[11px] block mb-1">Optional:</span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (opt of package.optional_dependencies; track opt) {
                            <span class="px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 font-mono text-[11px] border border-slate-700/80">
                              {{ opt }}
                            </span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }

                <!-- 1-Click In-Game Setup Snippet Box -->
                <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-sky-400 uppercase tracking-wider">
                      In-Game Registry Configuration
                    </span>
                    <button 
                      (click)="copyRegistryConfig()"
                      class="text-[11px] font-semibold text-sky-400 hover:text-white flex items-center gap-1 transition">
                      @if (copied()) {
                        <svg lucideCheck class="w-3.5 h-3.5 text-emerald-400"></svg>
                        <span class="text-emerald-400">Copied!</span>
                      } @else {
                        <svg lucideCopy class="w-3.5 h-3.5"></svg>
                        <span>Copy luanti.conf</span>
                      }
                    </button>
                  </div>
                  <code class="block text-xs font-mono text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800 break-all select-all">
                    contentdb_url = https://luanti-hub.pages.dev
                  </code>
                  <p class="text-[11px] text-slate-400">
                    Paste into your <code class="text-slate-300">luanti.conf</code> (or legacy <code class="text-slate-300">minetest.conf</code>) to browse and install this package directly inside the Luanti client!
                  </p>
                </div>

              </div>

              <!-- Right Column: Author, Tags, License & Source Forge Info -->
              <div class="space-y-4 text-xs text-slate-300 border-t lg:border-t-0 lg:border-l border-slate-800 lg:pl-6 pt-4 lg:pt-0">
                
                <!-- Author & Maintainer -->
                <div>
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    Author
                  </span>
                  <div class="flex items-center gap-2 mt-1">
                    <div class="w-6 h-6 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold text-xs">
                      {{ package.author.charAt(0).toUpperCase() }}
                    </div>
                    <span class="font-bold text-white text-sm">{{ package.author }}</span>
                  </div>
                </div>

                <!-- Technical ID -->
                <div>
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    Technical Identifier
                  </span>
                  <code class="text-sky-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono text-xs mt-1 inline-block">
                    {{ package.name }}
                  </code>
                </div>

                <!-- Downloads & Community Score -->
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      Downloads
                    </span>
                    <span class="font-bold text-white text-xs mt-0.5 block">
                      {{ package.downloads | number }}
                    </span>
                  </div>
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      Rating
                    </span>
                    <div class="flex items-center gap-1 text-amber-400 font-bold text-xs mt-0.5">
                      <svg lucideStar class="w-3.5 h-3.5 fill-amber-400 text-amber-400"></svg>
                      <span>{{ package.score }} / 5.0</span>
                    </div>
                  </div>
                </div>

                <!-- SPDX License -->
                <div>
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    License
                  </span>
                  <p class="font-mono text-xs text-slate-300 mt-0.5">
                    Code: {{ package.license }}
                    @if (package.media_license) {
                      <br>Media: {{ package.media_license }}
                    }
                  </p>
                </div>

                <!-- Tags Pills -->
                @if (package.tags && package.tags.length > 0) {
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px] mb-1.5">
                      Genres &amp; Tags
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      @for (tag of package.tags; track tag) {
                        <span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-medium border border-slate-700/80">
                          {{ tag }}
                        </span>
                      }
                    </div>
                  </div>
                }

              </div>

            </div>

            <!-- Tabbed Navigation: Reviews & SPDX Legal Compliance -->
            <div class="pt-4 border-t border-slate-800">
              <div class="flex items-center gap-4 border-b border-slate-800 text-xs font-semibold">
                <button 
                  (click)="activeTab.set('reviews')"
                  [class]="activeTab() === 'reviews' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold' : 'text-slate-400 hover:text-white py-2.5'">
                  {{ 'modal.tabReviews' | translate }} ({{ reviews().length }})
                </button>
                <button 
                  (click)="activeTab.set('compliance')"
                  [class]="activeTab() === 'compliance' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold' : 'text-slate-400 hover:text-white py-2.5'">
                  {{ 'modal.tabCompliance' | translate }}
                </button>
              </div>

              <!-- Reviews Content -->
              @if (activeTab() === 'reviews') {
                <div class="pt-4 space-y-4">
                  <!-- Write Review Box -->
                  @if (authService.currentUser(); as user) {
                    <form (ngSubmit)="onSubmitReview()" class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-200">Leave a Review</span>
                        <div class="flex items-center gap-1">
                          @for (star of [1, 2, 3, 4, 5]; track star) {
                            <button 
                              type="button" 
                              (click)="userRating.set(star)"
                              class="focus:outline-none">
                              <svg 
                                lucideStar 
                                class="w-4 h-4 transition-colors"
                                [class.fill-amber-400]="userRating() >= star"
                                [class.text-amber-400]="userRating() >= star"
                                [class.text-slate-600]="userRating() < star">
                              </svg>
                            </button>
                          }
                        </div>
                      </div>
                      <input 
                        type="text" 
                        [(ngModel)]="reviewTitle" 
                        name="reviewTitle" 
                        placeholder="Review title (optional)" 
                        class="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500" 
                      />
                      <textarea 
                        [(ngModel)]="reviewComment" 
                        name="reviewComment" 
                        required 
                        rows="2" 
                        placeholder="What do you think of this package? Share your thoughts..." 
                        class="w-full bg-slate-900 border border-slate-700/80 rounded-lg p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"></textarea>
                      <div class="flex justify-end">
                        <button 
                          type="submit" 
                          [disabled]="isSubmittingReview() || !reviewComment.trim()" 
                          class="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs disabled:opacity-50 transition">
                          Post Review
                        </button>
                      </div>
                    </form>
                  }

                  <!-- Reviews List -->
                  @if (reviews().length === 0) {
                    <p class="text-xs text-slate-500 text-center py-4">{{ 'modal.noReviews' | translate }}</p>
                  } @else {
                    <div class="space-y-3">
                      @for (rev of reviews(); track rev.id) {
                        <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                              <span class="font-bold text-white">{{ rev.author.display_name || rev.author.username }}</span>
                              <div class="flex items-center gap-0.5 text-amber-400">
                                <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400"></svg>
                                <span class="font-bold text-[11px]">{{ rev.rating }}/5</span>
                              </div>
                            </div>
                            <span class="text-[10px] text-slate-500">{{ rev.created_at | date }}</span>
                          </div>
                          @if (rev.title) {
                            <h4 class="font-bold text-slate-200 text-xs">{{ rev.title }}</h4>
                          }
                          <p class="text-slate-300 leading-relaxed">{{ rev.comment }}</p>
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Compliance Content -->
              @if (activeTab() === 'compliance') {
                <div class="pt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
                  <div class="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300">
                    <svg lucideShieldCheck class="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-400"></svg>
                    <span>{{ 'modal.spdxNotice' | translate }}</span>
                  </div>
                  <p class="text-slate-400 text-[11px]">
                    {{ 'modal.safeHarborNotice' | translate }}
                  </p>
                </div>
              }
            </div>

          </div>

        </div>

      </div>
    }
  `
})
export class PackageDetailModalComponent implements OnInit {
  @Input({ required: true }) package!: LuantiPackage;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);

  readonly activeTab = signal<'reviews' | 'compliance'>('reviews');
  readonly reviews = signal<CommunityReview[]>([]);
  readonly copied = signal(false);

  // Review Form state
  readonly userRating = signal(5);
  reviewTitle = '';
  reviewComment = '';
  readonly isSubmittingReview = signal(false);

  get shareUrl(): string {
    return typeof window !== 'undefined' ? `${window.location.origin}/#${this.package.id}` : '';
  }

  get bannerImage(): string {
    if (this.package.banner && !this.package.banner.includes('thumbnail.png')) {
      return this.package.banner;
    }
    if (this.package.thumbnail && this.package.thumbnail.includes('thumbnail.png')) {
      return this.package.thumbnail.replace('thumbnail.png', 'shot-0.png');
    }
    return this.package.banner || this.package.thumbnail || 'logo.svg';
  }

  ngOnInit(): void {
    this.packageService.fetchReviews(this.package).then(res => this.reviews.set(res));
  }

  onBackdropClick(event: MouseEvent): void {
    this.packageService.closePackageModal();
  }

  openSetupModal(): void {
    this.packageService.trackDownload(this.package);
    this.packageService.openSetupModal();
  }

  onFavoriteClick(): void {
    this.settingsService.toggleFavorite(this.package.id);
  }

  copyRegistryConfig(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText('contentdb_url = https://luanti-hub.pages.dev');
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  async onSubmitReview(): Promise<void> {
    if (!this.reviewComment.trim()) return;

    this.isSubmittingReview.set(true);
    const res = await this.packageService.submitReview(this.package, {
      rating: this.userRating(),
      title: this.reviewTitle.trim() || undefined,
      comment: this.reviewComment.trim()
    });

    this.isSubmittingReview.set(false);

    if (res.success && res.review) {
      const newReview: CommunityReview = {
        ...res.review,
        author: {
          username: this.authService.currentUser()?.username || 'user',
          display_name: this.authService.currentUser()?.display_name,
          avatar_url: this.authService.currentUser()?.avatar_url || 'https://github.com/octocat.png'
        }
      };
      this.reviews.update(list => [newReview, ...list]);
      this.reviewTitle = '';
      this.reviewComment = '';
    } else {
      alert(res.message || 'Failed to post review.');
    }
  }
}

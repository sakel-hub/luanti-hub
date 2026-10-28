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
  LucideDownload,
  LucideShare2,
  LucideExternalLink,
  LucideStar,
  LucideShieldCheck,
  LucideGitBranch,
  LucideGlobe
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
    LucideDownload,
    LucideShare2,
    LucideExternalLink,
    LucideStar,
    LucideShieldCheck,
    LucideGitBranch,
    LucideGlobe
  ],
  template: `
    @if (package) {
      <div 
        (click)="onBackdropClick($event)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-package-title"
        class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
        
        <div 
          (click)="$event.stopPropagation()"
          class="relative w-full max-w-4xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
          
          <!-- Top Banner Hero -->
          <div class="relative w-full h-56 sm:h-72 bg-slate-950 flex-shrink-0 overflow-hidden">
            <img 
              [src]="package.banner || package.thumbnail" 
              [fallbackThumbnail]="package.thumbnail"
              appImgFallback
              [alt]="package.title"
              class="w-full h-full object-cover object-center filter brightness-60"
            />
            <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent"></div>

            <!-- Close Button -->
            <button 
              (click)="packageService.closePackageModal()"
              [attr.aria-label]="'modal.close' | translate"
              [appTooltip]="'modal.close' | translate"
              class="absolute top-4 right-4 p-2 rounded-full bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition z-20">
              <svg lucideX class="w-5 h-5"></svg>
            </button>

            <!-- Foreground Title & Actions -->
            <div class="absolute bottom-4 left-6 right-6 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
              <div class="space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-sky-500 text-white">
                    {{ package.type }}
                  </span>
                  @if (package.source === 'git') {
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-slate-950 flex items-center gap-1">
                      <svg lucideGitBranch class="w-3 h-3 text-slate-950"></svg>
                      <span>Decentralized Git</span>
                    </span>
                  } @else {
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                      <svg lucideGlobe class="w-3 h-3 text-emerald-300"></svg>
                      <span>ContentDB</span>
                    </span>
                  }
                </div>
                <h2 id="modal-package-title" class="text-2xl sm:text-3xl font-extrabold text-white">
                  {{ package.title }}
                </h2>
                <p class="text-xs text-slate-300">
                  By <strong class="text-white">{{ package.author }}</strong> • Technical ID: <code class="text-sky-300 bg-slate-950/60 px-1 py-0.5 rounded font-mono">{{ package.name }}</code>
                </p>
              </div>

              <!-- Action Buttons -->
              <div class="flex items-center gap-2">
                <button 
                  (click)="packageService.openSetupModal()"
                  class="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-sky-600/30 transition whitespace-nowrap">
                  <svg lucideDownload class="w-4 h-4"></svg>
                  <span>{{ 'modal.installInGame' | translate }}</span>
                </button>

                <button 
                  (click)="pwaService.sharePackage(package.title, package.short_desc, shareUrl)"
                  [appTooltip]="'modal.shareTooltip' | translate"
                  [attr.aria-label]="'modal.sharePackage' | translate"
                  class="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 transition">
                  <svg lucideShare2 class="w-4 h-4"></svg>
                </button>
              </div>
            </div>

          </div>

          <!-- Navigation Tabs -->
          <div class="flex items-center gap-4 px-6 border-b border-slate-800 bg-slate-950/40 text-xs font-semibold">
            <button 
              (click)="activeTab.set('overview')"
              [class]="activeTab() === 'overview' ? 'text-sky-400 border-b-2 border-sky-400 py-3' : 'text-slate-400 hover:text-white py-3'">
              {{ 'modal.tabOverview' | translate }}
            </button>
            <button 
              (click)="activeTab.set('reviews')"
              [class]="activeTab() === 'reviews' ? 'text-sky-400 border-b-2 border-sky-400 py-3' : 'text-slate-400 hover:text-white py-3'">
              {{ 'modal.tabReviews' | translate }} ({{ reviews().length }})
            </button>
            <button 
              (click)="activeTab.set('compliance')"
              [class]="activeTab() === 'compliance' ? 'text-sky-400 border-b-2 border-sky-400 py-3' : 'text-slate-400 hover:text-white py-3'">
              {{ 'modal.tabCompliance' | translate }}
            </button>
          </div>

          <!-- Scrollable Body Content -->
          <div class="p-6 overflow-y-auto space-y-6 text-sm flex-1">
            
            <!-- Tab 1: Overview -->
            @if (activeTab() === 'overview') {
              <div class="space-y-4">
                <p class="text-slate-200 leading-relaxed text-sm sm:text-base">
                  {{ package.desc || package.short_desc }}
                </p>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span class="text-xs text-slate-400 font-medium">Compatible Luanti Engines</span>
                    <p class="font-bold text-white text-xs sm:text-sm">
                      {{ package.min_minetest_version || '5.0.0' }} and newer
                    </p>
                  </div>
                  <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span class="text-xs text-slate-400 font-medium">Total Downloads</span>
                    <p class="font-bold text-white text-xs sm:text-sm">
                      {{ package.downloads | number }}
                    </p>
                  </div>
                </div>

                @if (package.repo_url) {
                  <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span class="text-xs text-slate-400">Git Source Repository</span>
                      <p class="font-mono text-xs text-sky-400 truncate max-w-sm sm:max-w-md">
                        {{ package.repo_url }}
                      </p>
                    </div>
                    <a 
                      [href]="package.repo_url" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap">
                      <span>Open Git</span>
                      <svg lucideExternalLink class="w-3.5 h-3.5"></svg>
                    </a>
                  </div>
                }
              </div>
            }

            <!-- Tab 2: Reviews & Discussion -->
            @if (activeTab() === 'reviews') {
              <div class="space-y-6">
                
                <!-- Add Review Form -->
                <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                  <h4 class="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Leave a Community Review
                  </h4>

                  @if (authService.currentUser(); as user) {
                    <form (ngSubmit)="onSubmitReview()" class="space-y-3">
                      <!-- Star Rating Selector -->
                      <div class="flex items-center gap-2">
                        <span class="text-xs text-slate-400">Your Rating:</span>
                        <div class="flex items-center gap-1 text-amber-400">
                          @for (star of [1, 2, 3, 4, 5]; track star) {
                            <button 
                              type="button"
                              (click)="userRating.set(star)"
                              class="p-0.5 hover:scale-125 transition-transform focus:outline-none">
                              <svg 
                                lucideStar 
                                class="w-5 h-5" 
                                [class.fill-amber-400]="userRating() >= star" 
                                [class.text-amber-400]="userRating() >= star"
                                [class.text-slate-600]="userRating() < star">
                              </svg>
                            </button>
                          }
                        </div>
                        <span class="text-xs font-bold text-amber-400">{{ userRating() }} / 5 Stars</span>
                      </div>

                      <input 
                        type="text" 
                        [(ngModel)]="reviewTitle" 
                        name="reviewTitle"
                        placeholder="Review Headline (e.g. Works great on Luanti 5.8!)" 
                        class="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />

                      <textarea 
                        [(ngModel)]="reviewComment" 
                        name="reviewComment"
                        required
                        rows="3" 
                        placeholder="Share your experience, tips, or compatibility notes with the community..."
                        class="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500">
                      </textarea>

                      <div class="flex items-center justify-between">
                        <span class="text-[11px] text-slate-500">Posting as <strong class="text-slate-300">&#64;{{ user.username }}</strong></span>
                        <button 
                          type="submit" 
                          [disabled]="isSubmittingReview() || !reviewComment.trim()"
                          class="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs shadow transition">
                          {{ isSubmittingReview() ? 'Posting...' : 'Post Review' }}
                        </button>
                      </div>
                    </form>
                  } @else {
                    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-2">
                      <p class="text-xs text-slate-400">
                        Sign in with Codeberg, GitLab, or GitHub to post a review.
                      </p>
                      <button 
                        (click)="authService.openAuthModal()"
                        class="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition">
                        Sign In to Review
                      </button>
                    </div>
                  }
                </div>

                <!-- Reviews Thread -->
                <div class="space-y-3">
                  @for (rev of reviews(); track rev.id) {
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2.5">
                          <img [src]="rev.author.avatar_url" [alt]="rev.author.username" class="w-6 h-6 rounded-full" />
                          <span class="font-semibold text-xs text-slate-200">{{ rev.author.display_name || rev.author.username }}</span>
                          
                          @if (rev.source === 'contentdb') {
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                              ContentDB Official
                            </span>
                          } @else {
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              LuantiHub Verified
                            </span>
                          }
                        </div>
                        <div class="flex items-center gap-2">
                        <div class="flex items-center gap-1 text-amber-400 text-xs font-bold">
                          <svg lucideStar class="w-3.5 h-3.5 fill-amber-400 text-amber-400"></svg>
                          <span>{{ rev.rating }}/5</span>
                        </div>
                          <span class="text-[11px] text-slate-500">{{ rev.created_at | date }}</span>
                        </div>
                      </div>

                      @if (rev.title) {
                        <h4 class="text-xs font-bold text-white">{{ rev.title }}</h4>
                      }
                      <p class="text-xs text-slate-300 leading-relaxed">{{ rev.comment }}</p>
                    </div>
                  }
                </div>

              </div>
            }

            <!-- Tab 3: Compliance & Legal -->
            @if (activeTab() === 'compliance') {
              <div class="space-y-4 text-xs">
                <div class="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 space-y-1">
                  <h4 class="font-bold text-emerald-400 flex items-center gap-1.5">
                    <svg lucideShieldCheck class="w-4 h-4"></svg>
                    <span>SPDX Open-Source Verified</span>
                  </h4>
                  <p class="text-slate-300 leading-relaxed">
                    This package has been audited against our open source whitelist. Code and media adhere to recognized Free/Libre Open Source licenses.
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span class="text-slate-500">Code License:</span>
                    <p class="font-mono font-bold text-sky-400">{{ package.license }}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                    <span class="text-slate-500">Media License:</span>
                    <p class="font-mono font-bold text-sky-400">{{ package.media_license || 'CC-BY-SA-3.0' }}</p>
                  </div>
                </div>

                <div class="p-3.5 rounded-lg bg-slate-950/40 border border-slate-800/80 text-slate-400">
                  <p>
                    Suspect a copyright infringement or unauthorized asset rip? 
                    <a href="mailto:dmca@luantihub.org" class="text-sky-400 underline">Report this package for immediate DMCA review</a>.
                  </p>
                </div>
              </div>
            }

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

  readonly activeTab = signal<'overview' | 'reviews' | 'compliance'>('overview');
  readonly reviews = signal<CommunityReview[]>([]);

  // Review Form state
  readonly userRating = signal(5);
  reviewTitle = '';
  reviewComment = '';
  readonly isSubmittingReview = signal(false);

  get shareUrl(): string {
    return typeof window !== 'undefined' ? `${window.location.origin}/#${this.package.id}` : '';
  }

  ngOnInit(): void {
    this.packageService.fetchReviews(this.package).then(res => this.reviews.set(res));
  }

  onBackdropClick(event: MouseEvent): void {
    this.packageService.closePackageModal();
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
      // Optimistic update
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

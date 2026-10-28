import {
  Component,
  ChangeDetectionStrategy,
  Input,
  inject,
  signal,
  computed,
  OnInit,
  OnChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { LuantiPackage, CommunityReview, PackageRelease } from '../../core/models/package.model';
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
  LucideShieldAlert,
  LucideFlag,
  LucideGitBranch,
  LucideGlobe,
  LucideDownload,
  LucideTerminal,
  LucideBookOpen,
  LucideExternalLink,
  LucideMessageSquare,
  LucideAlertCircle,
  LucideImage,
  LucideUser
} from '@lucide/angular';

@Component({
  selector: 'app-package-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    LucideShieldAlert,
    LucideFlag,
    LucideGitBranch,
    LucideGlobe,
    LucideDownload,
    LucideTerminal,
    LucideBookOpen,
    LucideExternalLink,
    LucideMessageSquare,
    LucideAlertCircle,
    LucideImage,
    LucideUser
  ],
  template: `
    @if (package) {
      <div
        (click)="onBackdropClick($event)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-package-title"
        class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200">

        <div
          (click)="$event.stopPropagation()"
          class="relative w-full max-w-4xl max-h-screen sm:max-h-[92vh] glass-modal rounded-none sm:rounded-3xl overflow-y-auto flex flex-col animate-in zoom-in-95 duration-200 my-auto">

          <!-- Admin / Author Instant Kill Switch Control Bar -->
          @if (canModerate()) {
            <div class="px-5 py-2.5 bg-rose-950/85 border-b border-rose-500/30 flex items-center justify-between gap-3 flex-wrap text-xs">
              <div class="flex items-center gap-2 text-rose-200 font-bold">
                <svg lucideShieldAlert class="w-4 h-4 text-rose-400 flex-shrink-0"></svg>
                <span>{{ 'modal.adminModeration' | translate }}</span>
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="onKillSwitch('delist')"
                  [disabled]="isModerating()"
                  class="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-[11px] transition shadow cursor-pointer">
                  {{ 'modal.killSwitchDelist' | translate }}
                </button>
                <button
                  type="button"
                  (click)="onKillSwitch('restore')"
                  [disabled]="isModerating()"
                  class="px-2.5 py-1 rounded-lg glass-btn disabled:opacity-50 text-emerald-300 font-bold text-[11px] transition cursor-pointer">
                  {{ 'modal.killSwitchRestore' | translate }}
                </button>
              </div>
            </div>
          }

          <!-- Top Banner Hero (True 16:9 Widescreen Aspect Ratio for HD Screenshots) -->
          <div class="relative w-full aspect-video min-h-[240px] max-h-[504px] bg-slate-950 flex-shrink-0 overflow-hidden">
            <img
              [src]="activeBannerUrl() || bannerImage"
              [fallbackThumbnail]="package.thumbnail"
              appImgFallback
              [alt]="package.title"
              class="w-full h-full object-cover object-center filter brightness-100 transition-all duration-300"
            />
            <div class="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/30 to-transparent w-full sm:w-2/3"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/20 to-transparent"></div>

            <!-- Floating Round Close Button (Top Right) -->
            <button
              type="button"
              (click)="packageService.closePackageModal()"
              [attr.aria-label]="'modal.close' | translate"
              [appTooltip]="'modal.close' | translate"
              class="absolute top-4 right-4 w-9 h-9 rounded-full glass-icon-btn text-slate-200 hover:text-white flex items-center justify-center transition z-30 shadow-lg cursor-pointer">
              <svg lucideX class="w-5 h-5"></svg>
            </button>

            <!-- Foreground Hero Content & Actions -->
            <div class="absolute bottom-5 left-5 sm:left-8 right-5 sm:right-8 flex flex-col justify-end gap-3 z-20">

              <!-- Badges -->
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  [class]="package.type === 'game' ? 'bg-emerald-500/90 text-white' : package.type === 'txp' ? 'bg-purple-500/90 text-white' : 'bg-sky-500/90 text-white'"
                  class="px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider backdrop-blur-md shadow">
                  {{ package.type }}
                </span>

                @if (package.sources?.includes('official') || package.source === 'official' || package.source === 'mirror') {
                  <span class="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 backdrop-blur-md flex items-center gap-1">
                    <svg lucideGlobe class="w-3 h-3 text-emerald-300"></svg>
                    <span>ContentDB</span>
                  </span>
                }

                @if (package.sources?.includes('git') || package.source === 'git') {
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-slate-950 flex items-center gap-1 shadow">
                    <svg lucideGitBranch class="w-3 h-3 text-slate-950"></svg>
                    <span>Git</span>
                  </span>
                }

                @if (package.featured) {
                  <span class="px-2.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/40 backdrop-blur-md">
                    Featured
                  </span>
                }
              </div>

              <!-- Title -->
              <h2 id="modal-package-title" class="text-2xl sm:text-4xl lg:text-5xl font-black text-white drop-shadow-2xl">
                {{ package.title }}
              </h2>

              <!-- Action Buttons Row -->
              <div class="flex items-center gap-2.5 sm:gap-3 pt-1 flex-wrap">
                <!-- Primary Direct ZIP Download Button with File Size -->
                <button
                  type="button"
                  (click)="onDownloadClick()"
                  class="h-10 sm:h-11 px-5 sm:px-7 rounded-xl glass-btn-primary text-white font-black text-xs sm:text-sm flex items-center gap-2 hover:scale-[1.03] transition whitespace-nowrap cursor-pointer">
                  <svg lucideDownload class="w-4 h-4 text-sky-300 flex-shrink-0"></svg>
                  <span>{{ 'modal.downloadZip' | translate }}</span>
                  @if (package.file_size) {
                    <span class="text-slate-200 font-bold text-xs">({{ package.file_size }})</span>
                  }
                </button>

                <!-- In-Game Setup Guide Button -->
                <button
                  type="button"
                  (click)="openSetupModal()"
                  [appTooltip]="'modal.setupGuideTooltip' | translate"
                  class="h-10 sm:h-11 px-4 sm:px-5 rounded-xl glass-btn text-slate-100 hover:text-white font-semibold text-xs sm:text-sm flex items-center gap-2 transition hover:scale-[1.03] whitespace-nowrap cursor-pointer">
                  <svg lucideTerminal class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                  <span>{{ 'modal.setupGuide' | translate }}</span>
                </button>

                <!-- Add to Favorites / My List Button -->
                <button
                  type="button"
                  (click)="onFavoriteClick()"
                  [appTooltip]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                  [attr.aria-label]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn text-white flex items-center justify-center transition hover:scale-105 cursor-pointer">
                  <svg
                    lucideHeart
                    [class]="settingsService.isFavorite(package.id) ? 'w-4 h-4 fill-rose-500 text-rose-500 transition-colors' : 'w-4 h-4 transition-colors'"
                    [style.fill]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'none'"
                    [color]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'currentColor'">
                  </svg>
                </button>

                <!-- Share Button -->
                <button
                  type="button"
                  (click)="pwaService.sharePackage(package.title, package.short_desc, shareUrl)"
                  [appTooltip]="'modal.shareTooltip' | translate"
                  [attr.aria-label]="'modal.shareTooltip' | translate"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn text-white flex items-center justify-center transition hover:scale-105 cursor-pointer">
                  <svg lucideShare2 class="w-4 h-4"></svg>
                </button>

                <!-- Git Repository or ContentDB Link Button (Adapts icon & label to target destination) -->
                <a
                  [href]="gitRepoUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  [appTooltip]="hasValidGitRepo ? ('modal.viewGitRepo' | translate) : ('modal.viewOnContentDb' | translate)"
                  [class]="hasValidGitRepo ? 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn text-amber-300 hover:text-white flex items-center justify-center transition hover:scale-105 cursor-pointer' : 'relative w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn text-emerald-300 hover:text-white flex items-center justify-center transition hover:scale-105 cursor-pointer'"
                  [attr.aria-label]="hasValidGitRepo ? ('modal.viewGitRepo' | translate) : ('modal.viewOnContentDb' | translate)">
                  @if (hasValidGitRepo) {
                    <svg lucideGitBranch class="w-4 h-4"></svg>
                  } @else {
                    <svg lucideGlobe class="w-4 h-4"></svg>
                  }
                  @if (package.git_repo_status === 'broken_404') {
                    <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-slate-950"></span>
                  }
                </a>

                <!-- Report / Flag Button -->
                <button
                  type="button"
                  (click)="isReportOpen.set(!isReportOpen())"
                  [appTooltip]="'modal.reportPackage' | translate"
                  [attr.aria-label]="'modal.reportPackage' | translate"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn text-slate-300 hover:text-rose-400 flex items-center justify-center transition hover:scale-105 cursor-pointer">
                  <svg lucideFlag class="w-4 h-4"></svg>
                </button>
              </div>

            </div>

          </div>

          <!-- Inline Community Report Form -->
          @if (isReportOpen()) {
            <form (ngSubmit)="onSubmitReport()" class="mx-5 sm:mx-8 mt-5 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 backdrop-blur-md space-y-3 text-xs">
              <div class="flex items-center justify-between">
                <h3 class="font-bold text-rose-300 flex items-center gap-1.5">
                  <svg lucideFlag class="w-4 h-4 text-rose-400"></svg>
                  <span>{{ 'modal.reportPackage' | translate }}</span>
                </h3>
                <button type="button" (click)="isReportOpen.set(false)" class="text-slate-400 hover:text-white cursor-pointer">
                  <svg lucideX class="w-4 h-4"></svg>
                </button>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-semibold text-slate-300 mb-1">{{ 'modal.reportReason' | translate }}</label>
                  <select
                    [(ngModel)]="reportReason"
                    name="reportReason"
                    class="w-full glass-input rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                    <option value="dmca" class="bg-slate-900">DMCA / Copyright Violation</option>
                    <option value="malware" class="bg-slate-900">Malicious Code / Sandbox Escape</option>
                    <option value="broken" class="bg-slate-900">Broken Archive / Missing mod.conf</option>
                    <option value="inappropriate" class="bg-slate-900">Inappropriate Content</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] font-semibold text-slate-300 mb-1">{{ 'modal.reportDetails' | translate }}</label>
                  <input
                    type="text"
                    [(ngModel)]="reportDetails"
                    name="reportDetails"
                    required
                    placeholder="Provide URL or evidence details..."
                    class="w-full glass-input rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              <div class="flex justify-end gap-2">
                <button
                  type="submit"
                  [disabled]="isReporting() || !reportDetails.trim()"
                  class="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer">
                  {{ 'modal.reportSubmit' | translate }}
                </button>
              </div>
            </form>
          }

          <!-- 2-Column Details Body -->
          <div class="p-5 sm:p-8 space-y-6">

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">

              <!-- Left Column: Synopsis, Screenshots, Dependencies, README & 1-Click Setup -->
              <div class="lg:col-span-2 space-y-5">

                <!-- Metrics Bar -->
                <div class="flex items-center gap-3 text-xs sm:text-sm flex-wrap">
                  <span class="text-emerald-400 font-bold">
                    {{ packageService.getMatchScore(package) }}% {{ 'card.match' | translate }}
                  </span>
                  @if (package.min_minetest_version) {
                    <span class="text-slate-300 font-mono px-2 py-0.5 rounded glass-pill text-xs">
                      Luanti {{ package.min_minetest_version }}+
                    </span>
                  }
                  @if (package.license || package.media_license) {
                    <span class="text-slate-300 font-mono uppercase px-2 py-0.5 rounded glass-pill text-xs">
                      License: {{ package.license || package.media_license }}
                    </span>
                  }
                  @if (package.file_size) {
                    <span class="text-sky-300 font-mono px-2 py-0.5 rounded glass-pill text-xs">
                      {{ package.file_size }}
                    </span>
                  }
                  @if (topRank(); as rank) {
                    <span class="text-rose-300 font-semibold bg-rose-500/20 border border-rose-400/30 px-2.5 py-0.5 rounded-full text-[11px] flex items-center gap-1">
                      <span class="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                      #{{ rank }} in Top 10 ({{ packageService.getTop10TimeframeForPackage(package) === 'today' ? ('carousel.top10Today' | translate) : ('carousel.top10Week' | translate) }})
                    </span>
                  }
                </div>

                <!-- Markdown Description / Synopsis -->
                <div
                  class="luanti-markdown text-slate-200 text-sm sm:text-base leading-relaxed space-y-3 break-words"
                  [innerHTML]="renderedDescription()">
                </div>

                <!-- Screenshots Gallery (When multiple screenshots exist) -->
                @if (package.screenshots && package.screenshots.length > 1) {
                  <div class="space-y-2.5">
                    <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <svg lucideImage class="w-3.5 h-3.5 text-sky-400"></svg>
                      <span>{{ 'modal.screenshots' | translate }} ({{ package.screenshots.length }})</span>
                    </h3>
                    <div class="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-1">
                      @for (shot of package.screenshots; track shot) {
                        <button
                          type="button"
                          (click)="activeBannerUrl.set(shot)"
                          [class.ring-2]="activeBannerUrl() === shot"
                          [class.ring-sky-400]="activeBannerUrl() === shot"
                          class="relative w-28 h-16 sm:w-36 sm:h-20 rounded-xl overflow-hidden flex-shrink-0 border border-white/10 hover:border-sky-400/60 transition cursor-pointer">
                          <img [src]="shot" [alt]="package.title" loading="lazy" class="w-full h-full object-cover" />
                        </button>
                      }
                    </div>
                  </div>
                }

                <!-- Dependencies Section (Always visible so dependency status is clear) -->
                <div class="space-y-3 p-4 rounded-2xl glass-panel">
                  <h3 class="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    {{ 'modal.dependencies' | translate }}
                  </h3>

                  @if ((package.dependencies && package.dependencies.length > 0) || (package.optional_dependencies && package.optional_dependencies.length > 0)) {
                    @if (package.dependencies && package.dependencies.length > 0) {
                      <div>
                        <span class="text-slate-400 font-semibold text-[11px] block mb-1.5">{{ 'modal.requiredDeps' | translate }} ({{ package.dependencies.length }})</span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (dep of package.dependencies; track dep) {
                            <button
                              type="button"
                              (click)="filterByTerm(dep)"
                              class="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-mono text-[11px] border border-sky-400/30 transition cursor-pointer">
                              {{ dep }}
                            </button>
                          }
                        </div>
                      </div>
                    }

                    @if (package.optional_dependencies && package.optional_dependencies.length > 0) {
                      <div>
                        <span class="text-slate-400 font-semibold text-[11px] block mb-1.5">{{ 'modal.optionalDeps' | translate }} ({{ package.optional_dependencies.length }})</span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (opt of package.optional_dependencies; track opt) {
                            <button
                              type="button"
                              (click)="filterByTerm(opt)"
                              class="px-2.5 py-1 rounded-lg glass-pill hover:border-white/30 text-slate-300 hover:text-white font-mono text-[11px] transition cursor-pointer">
                              {{ opt }}
                            </button>
                          }
                        </div>
                      </div>
                    }
                  } @else {
                    <p class="text-xs text-slate-400">
                      {{ 'modal.noDependencies' | translate }}
                    </p>
                  }
                </div>

                <!-- Repository README.md Markdown Section -->
                @if (renderedReadme(); as readmeHtml) {
                  <div class="p-5 rounded-2xl glass-panel space-y-3">
                    <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <h3 class="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                        <svg lucideBookOpen class="w-4 h-4 text-sky-400"></svg>
                        <span>{{ 'modal.readmeTitle' | translate }}</span>
                      </h3>
                      <a
                        [href]="gitRepoUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[11px] font-semibold text-slate-400 hover:text-sky-300 flex items-center gap-1 transition cursor-pointer">
                        <span>{{ (hasValidGitRepo ? 'modal.viewGitRepo' : 'modal.viewOnContentDb') | translate }}</span>
                        <svg lucideExternalLink class="w-3 h-3"></svg>
                      </a>
                    </div>
                    <div
                      class="luanti-markdown text-slate-200 text-xs sm:text-sm leading-relaxed max-h-[28rem] overflow-y-auto pr-1.5 break-words"
                      [innerHTML]="readmeHtml">
                    </div>
                  </div>
                } @else if (packageService.isLoadingDetails()) {
                  <div class="p-5 rounded-2xl glass-panel space-y-3" aria-busy="true">
                    <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <h3 class="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                        <svg lucideBookOpen class="w-4 h-4 text-sky-400"></svg>
                        <span>{{ 'modal.readmeTitle' | translate }}</span>
                      </h3>
                      <div class="w-20 h-3.5 rounded skeleton-shimmer"></div>
                    </div>
                    <div class="space-y-2.5 py-1">
                      <div class="w-2/5 h-4 rounded skeleton-shimmer"></div>
                      <div class="w-full h-3 rounded skeleton-shimmer"></div>
                      <div class="w-11/12 h-3 rounded skeleton-shimmer"></div>
                      <div class="w-4/5 h-3 rounded skeleton-shimmer"></div>
                    </div>
                  </div>
                }

                <!-- 1-Click In-Game Setup Snippet Box -->
                <div class="p-4 rounded-2xl glass-panel space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-sky-400 uppercase tracking-wider">
                      {{ 'modal.registryConfig' | translate }}
                    </span>
                    <button
                      type="button"
                      (click)="copyRegistryConfig()"
                      class="text-[11px] font-semibold text-sky-400 hover:text-white flex items-center gap-1 transition cursor-pointer">
                      @if (copied()) {
                        <svg lucideCheck class="w-3.5 h-3.5 text-emerald-400"></svg>
                        <span class="text-emerald-400">{{ 'common.copiedToClipboard' | translate }}</span>
                      } @else {
                        <svg lucideCopy class="w-3.5 h-3.5"></svg>
                        <span>{{ 'modal.copyConfig' | translate }}</span>
                      }
                    </button>
                  </div>
                  <code class="block text-xs font-mono text-slate-200 bg-slate-950/80 p-2.5 rounded-xl border border-white/10 break-all select-all">
                    contentdb_url = {{ settingsService.contentDbUrl() }}
                  </code>
                  <p class="text-[11px] text-slate-400">
                    {{ 'modal.registryConfigDesc' | translate }}
                  </p>
                </div>

              </div>

              <!-- Right Column: Author, Downloads, Score, Tags, License & External Links -->
              <div class="space-y-4 text-xs text-slate-300 border-t lg:border-t-0 lg:border-l border-white/10 lg:pl-6 pt-4 lg:pt-0">

                <!-- Author (Clickable to filter by author) -->
                <div>
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    {{ 'modal.author' | translate }}
                  </span>
                  <button
                    type="button"
                    (click)="filterByTerm(package.author)"
                    class="flex items-center gap-2 mt-1 group text-left cursor-pointer">
                    <div class="w-6 h-6 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold text-xs">
                      {{ package.author.charAt(0).toUpperCase() }}
                    </div>
                    <span class="font-bold text-white group-hover:text-sky-400 transition text-sm">{{ package.author }}</span>
                  </button>
                </div>

                <!-- Technical ID -->
                <div>
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    {{ 'modal.technicalId' | translate }}
                  </span>
                  <code class="text-sky-300 bg-slate-950/80 border border-white/10 px-2 py-0.5 rounded-md font-mono text-xs mt-1 inline-block">
                    {{ package.name }}
                  </code>
                </div>

                <!-- Downloads & Community Score -->
                <div
                  [class.grid-cols-2]="package.score > 0"
                  [class.grid-cols-1]="package.score <= 0"
                  class="grid gap-2 p-3 rounded-xl glass-panel">
                  <div>
                    <span class="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.downloads' | translate }}
                    </span>
                    <span class="font-black text-white text-sm mt-0.5 block">
                      {{ package.downloads | number }}
                    </span>
                  </div>
                  @if (package.score > 0) {
                    <div>
                      <span class="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">
                        {{ 'modal.rating' | translate }}
                      </span>
                      <div class="flex items-center gap-1 text-amber-400 font-black text-sm mt-0.5">
                        <svg lucideStar class="w-4 h-4 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
                        <span>{{ package.score }} / 5.0</span>
                      </div>
                    </div>
                  }
                </div>

                <!-- License Information (Only shown when license or media_license is available) -->
                @if (package.license || package.media_license) {
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.license' | translate }}
                    </span>
                    <p class="font-mono text-xs text-slate-300 mt-1 space-y-0.5">
                      @if (package.license) {
                        <span class="block">{{ 'modal.codeLicense' | translate }}: <strong class="text-white">{{ package.license }}</strong></span>
                      }
                      @if (package.media_license) {
                        <span class="block">{{ 'modal.mediaLicense' | translate }}: <strong class="text-white">{{ package.media_license }}</strong></span>
                      }
                    </p>
                  </div>
                }

                <!-- External Project Links -->
                <div class="space-y-1.5">
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    {{ 'modal.linksTitle' | translate }}
                  </span>
                  <div class="flex flex-col gap-1.5">
                    <a
                      [href]="gitRepoUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="px-2.5 py-1.5 rounded-lg glass-btn text-slate-200 hover:text-white flex items-center justify-between text-xs transition cursor-pointer">
                      <span class="flex items-center gap-2">
                        @if (hasValidGitRepo) {
                          <svg lucideGitBranch class="w-3.5 h-3.5 text-amber-400"></svg>
                          <span>{{ 'modal.viewGitRepo' | translate }}</span>
                        } @else {
                          <svg lucideGlobe class="w-3.5 h-3.5 text-emerald-400"></svg>
                          <span>{{ 'modal.viewOnContentDb' | translate }}</span>
                        }
                      </span>
                      <svg lucideExternalLink class="w-3 h-3 text-slate-400"></svg>
                    </a>
                    @if (package.git_repo_status === 'broken_404') {
                      <div class="px-2.5 py-1.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[11px] flex items-start gap-2 leading-snug">
                        <svg lucideAlertCircle class="w-3.5 h-3.5 text-rose-400 flex-shrink-0 mt-0.5"></svg>
                        <span>404 Git repository detected and automatically reported to moderators.</span>
                      </div>
                    }
                    @if (package.website) {
                        <a
                          [href]="package.website"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="px-2.5 py-1.5 rounded-lg glass-btn text-slate-200 hover:text-white flex items-center justify-between text-xs transition cursor-pointer">
                          <span class="flex items-center gap-2">
                            <svg lucideGlobe class="w-3.5 h-3.5 text-sky-400"></svg>
                            <span>{{ 'modal.website' | translate }}</span>
                          </span>
                          <svg lucideExternalLink class="w-3 h-3 text-slate-400"></svg>
                        </a>
                      }
                      @if (package.issue_tracker) {
                        <a
                          [href]="package.issue_tracker"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="px-2.5 py-1.5 rounded-lg glass-btn text-slate-200 hover:text-white flex items-center justify-between text-xs transition cursor-pointer">
                          <span class="flex items-center gap-2">
                            <svg lucideAlertCircle class="w-3.5 h-3.5 text-rose-400"></svg>
                            <span>{{ 'modal.issueTracker' | translate }}</span>
                          </span>
                          <svg lucideExternalLink class="w-3 h-3 text-slate-400"></svg>
                        </a>
                      }
                      @if (package.forums) {
                        <a
                          [href]="package.forums"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="px-2.5 py-1.5 rounded-lg glass-btn text-slate-200 hover:text-white flex items-center justify-between text-xs transition cursor-pointer">
                          <span class="flex items-center gap-2">
                            <svg lucideMessageSquare class="w-3.5 h-3.5 text-emerald-400"></svg>
                            <span>{{ 'modal.forums' | translate }}</span>
                          </span>
                          <svg lucideExternalLink class="w-3 h-3 text-slate-400"></svg>
                        </a>
                      }
                  </div>
                </div>

                <!-- Tags Pills (Clickable to filter by ContentDB Tag) -->
                @if (package.tags && package.tags.length > 0) {
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px] mb-1.5">
                      {{ 'modal.tags' | translate }}
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      @for (tag of package.tags; track tag) {
                        <button
                          type="button"
                          (click)="filterByTag(tag)"
                          class="px-2.5 py-0.5 rounded-full glass-pill hover:border-sky-400/50 text-slate-200 hover:text-white text-[10px] font-medium transition cursor-pointer">
                          #{{ tag }}
                        </button>
                      }
                    </div>
                  </div>
                }

              </div>

            </div>

            <!-- Tabbed Navigation: Reviews, Releases & Legal License -->
            <div class="pt-4 border-t border-white/10">
              <div class="flex items-center gap-5 border-b border-white/10 text-xs font-semibold overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  (click)="activeTab.set('reviews')"
                  [class]="activeTab() === 'reviews' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabReviews' | translate }} ({{ reviews().length }})
                </button>
                <button
                  type="button"
                  (click)="activeTab.set('releases')"
                  [class]="activeTab() === 'releases' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabReleases' | translate }} ({{ releases().length }})
                </button>
                <button
                  type="button"
                  (click)="activeTab.set('compliance')"
                  [class]="activeTab() === 'compliance' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabCompliance' | translate }}
                </button>
              </div>

              <!-- Reviews Content (Always shows interactive Rate & Review box!) -->
              @if (activeTab() === 'reviews') {
                <div class="pt-4 space-y-4">
                  <div class="p-4 rounded-2xl glass-panel space-y-3">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span class="text-xs font-bold text-white block">{{ 'modal.rateAndReviewTitle' | translate }}</span>
                        <span class="text-[11px] text-slate-400">{{ 'modal.leaveReview' | translate }}</span>
                      </div>
                      @if (authService.currentUser()) {
                        <div class="flex items-center gap-1 bg-slate-950/70 px-3 py-1.5 rounded-xl border border-white/10">
                          @for (star of [1, 2, 3, 4, 5]; track star) {
                            <button
                              type="button"
                              (click)="userRating.set(star)"
                              [attr.aria-label]="'Rate ' + star + ' stars'"
                              class="focus:outline-none p-0.5 hover:scale-110 transition cursor-pointer">
                              <svg
                                lucideStar
                                [class]="userRating() >= star ? 'w-5 h-5 fill-amber-400 text-amber-400 transition-colors' : 'w-5 h-5 text-slate-500 transition-colors'"
                                [style.fill]="userRating() >= star ? '#fbbf24' : 'none'"
                                [color]="userRating() >= star ? '#fbbf24' : '#64748b'">
                              </svg>
                            </button>
                          }
                          <span class="ml-1.5 text-xs font-bold text-amber-400">{{ userRating() }}.0</span>
                        </div>
                      } @else if (package.score > 0) {
                        <div
                          [appTooltip]="'modal.signInToReviewPrompt' | translate"
                          aria-disabled="true"
                          class="flex items-center gap-1 bg-slate-950/50 px-3 py-1.5 rounded-xl border border-white/10 opacity-55 cursor-not-allowed select-none">
                          @for (star of [1, 2, 3, 4, 5]; track star) {
                            <span class="p-0.5">
                              <svg
                                lucideStar
                                [class]="package.score >= star - 0.25 ? 'w-4 h-4 fill-amber-400/70 text-amber-400/70' : 'w-4 h-4 text-slate-600'"
                                [style.fill]="package.score >= star - 0.25 ? '#fbbf24' : 'none'"
                                [color]="package.score >= star - 0.25 ? '#fbbf24' : '#475569'">
                              </svg>
                            </span>
                          }
                          <span class="ml-1.5 text-xs font-bold text-slate-400">{{ package.score }}</span>
                        </div>
                      }
                    </div>

                    @if (authService.currentUser()) {
                      <form (ngSubmit)="onSubmitReview()" class="space-y-3 pt-1">
                        <input
                          type="text"
                          [(ngModel)]="reviewTitle"
                          name="reviewTitle"
                          [placeholder]="'modal.reviewTitlePlaceholder' | translate"
                          class="w-full glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none"
                        />
                        <textarea
                          [(ngModel)]="reviewComment"
                          name="reviewComment"
                          required
                          rows="2"
                          [placeholder]="'modal.reviewBodyPlaceholder' | translate"
                          class="w-full glass-input rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none"></textarea>
                        <div class="flex justify-end">
                          <button
                            type="submit"
                            [disabled]="isSubmittingReview() || !reviewComment.trim()"
                            class="px-5 py-2 rounded-xl glass-btn-sky text-white font-bold text-xs disabled:opacity-50 transition cursor-pointer">
                            {{ 'modal.postReview' | translate }}
                          </button>
                        </div>
                      </form>
                    } @else {
                      <div class="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-white/10">
                        <p class="text-xs text-slate-300">
                          {{ 'modal.signInToReviewPrompt' | translate }}
                        </p>
                        <button
                          type="button"
                          (click)="openSignInForReview()"
                          class="px-4 py-2 rounded-xl glass-btn-sky text-white font-bold text-xs flex items-center gap-2 whitespace-nowrap transition cursor-pointer self-start sm:self-auto">
                          <svg lucideUser class="w-3.5 h-3.5"></svg>
                          <span>{{ 'modal.signInToReviewBtn' | translate }}</span>
                        </button>
                      </div>
                    }
                  </div>

                  @if (reviews().length === 0) {
                    <p class="text-xs text-slate-500 text-center py-4">{{ 'modal.noReviews' | translate }}</p>
                  } @else {
                    <div class="space-y-3">
                      @for (rev of reviews(); track rev.id) {
                        <div class="p-3.5 rounded-2xl glass-panel space-y-1.5 text-xs">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                              <span class="font-bold text-white">{{ rev.author.display_name || rev.author.username }}</span>
                              <div class="flex items-center gap-0.5 text-amber-400">
                                <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
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

              <!-- Releases Content -->
              @if (activeTab() === 'releases') {
                <div class="pt-4 space-y-2.5">
                  @if (releases().length === 0) {
                    <div class="p-4 rounded-2xl glass-panel flex items-center justify-between text-xs">
                      <div>
                        <span class="font-bold text-white">Latest Archive ({{ package.default_branch || 'main' }})</span>
                        <span class="block text-[11px] text-slate-400">Ready-to-drop Luanti .zip archive</span>
                      </div>
                      <button
                        type="button"
                        (click)="onDownloadClick()"
                        class="px-3.5 py-1.5 rounded-xl glass-btn-primary text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
                        <svg lucideDownload class="w-3.5 h-3.5 text-sky-300"></svg>
                        <span>.zip @if (package.file_size) { ({{ package.file_size }}) }</span>
                      </button>
                    </div>
                  } @else {
                    @for (rel of releases(); track rel.id) {
                      <div class="p-3.5 rounded-2xl glass-panel flex items-center justify-between gap-3 text-xs">
                        <div class="space-y-0.5">
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-white">{{ rel.version }}</span>
                            @if (rel.commit_sha) {
                              <code class="text-[10px] text-sky-400 bg-slate-950/80 px-1.5 py-0.5 rounded font-mono border border-white/10">
                                {{ rel.commit_sha | slice:0:8 }}
                              </code>
                            }
                          </div>
                          @if (rel.released_at) {
                            <span class="text-[10px] text-slate-500 block">{{ rel.released_at | date }}</span>
                          }
                        </div>

                        <button
                          type="button"
                          (click)="onDownloadRelease(rel)"
                          class="px-3.5 py-1.5 rounded-xl glass-btn hover:bg-white text-white hover:text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
                          <svg lucideDownload class="w-3.5 h-3.5"></svg>
                          <span>
                            {{ 'card.downloadZip' | translate }}
                            @if (rel.file_size || package.file_size) {
                              ({{ rel.file_size || package.file_size }})
                            }
                          </span>
                        </button>
                      </div>
                    }
                  }
                </div>
              }

              <!-- Compliance Content -->
              @if (activeTab() === 'compliance') {
                <div class="pt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
                  <div class="flex items-start gap-2.5 p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
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
export class PackageDetailModalComponent implements OnInit, OnChanges {
  @Input({ required: true }) package!: LuantiPackage;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly activeTab = signal<'reviews' | 'releases' | 'compliance'>('reviews');
  readonly reviews = signal<CommunityReview[]>([]);
  readonly releases = signal<PackageRelease[]>([]);
  readonly copied = signal(false);
  readonly activeBannerUrl = signal<string | null>(null);

  // Review Form state
  readonly userRating = signal(5);
  reviewTitle = '';
  reviewComment = '';
  readonly isSubmittingReview = signal(false);

  // Report & Moderation state
  readonly isReportOpen = signal(false);
  reportReason = 'dmca';
  reportDetails = '';
  readonly isReporting = signal(false);
  readonly isModerating = signal(false);

  readonly canModerate = computed(() => {
    const user = this.authService.currentUser();
    if (!user || !this.package) return false;
    if (this.authService.isAdmin()) return true;
    const lowerAuthor = this.package.author.toLowerCase();
    return user.identities.some(
      id => Boolean(id.verified) && id.username.toLowerCase() === lowerAuthor
    );
  });

  private parseSafeMarkdown(markdownText: string): SafeHtml {
    try {
      const rawHtml = marked.parse(markdownText, { async: false }) as string;
      const sanitizedHtml = rawHtml
        .replace(/<(script|iframe|object|embed|style|form)[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(script|iframe|object|embed|style|form)[^>]*\/?>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"')
        .replace(
          /<a\s+href="(https?:\/\/[^"]+)"/gi,
          '<a href="$1" target="_blank" rel="noopener noreferrer"'
        );
      return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtml);
    } catch {
      return markdownText;
    }
  }

  readonly renderedDescription = computed<SafeHtml>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const rawDesc = (pkg?.desc || '').trim();
    const rawReadme = (pkg?.readme || '').trim();
    const shortDesc = (pkg?.short_desc || '').trim();

    // If readme is present and identical to desc, show short_desc as the top synopsis
    // and let the dedicated README panel display the full Markdown documentation
    const raw = (rawReadme && rawDesc === rawReadme && shortDesc)
      ? shortDesc
      : (rawDesc || shortDesc);
    return this.parseSafeMarkdown(raw);
  });

  readonly renderedReadme = computed<SafeHtml | null>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const rawReadme = (pkg?.readme || '').trim();
    if (!rawReadme) return null;
    return this.parseSafeMarkdown(rawReadme);
  });

  get shareUrl(): string {
    return typeof window !== 'undefined'
      ? `${window.location.origin}/package/${encodeURIComponent(this.package.author)}/${encodeURIComponent(this.package.name)}`
      : '';
  }

  get hasValidGitRepo(): boolean {
    const pkg = this.packageService.activePackage() || this.package;
    const normalized = this.packageService.normalizeGitRepoUrl(pkg?.repo_url);
    return Boolean(normalized && pkg?.git_repo_status !== 'broken_404');
  }

  get gitRepoUrl(): string {
    const pkg = this.packageService.activePackage() || this.package;
    const normalized = this.packageService.normalizeGitRepoUrl(pkg?.repo_url);
    if (normalized && pkg?.git_repo_status !== 'broken_404') {
      return normalized;
    }
    return `https://content.luanti.org/packages/${encodeURIComponent(this.package.author)}/${encodeURIComponent(this.package.name)}/`;
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
    this.loadExtraData();
  }

  ngOnChanges(): void {
    this.activeBannerUrl.set(null);
    this.loadExtraData();
  }

  private loadExtraData(): void {
    if (!this.package) return;
    this.packageService.fetchReviews(this.package).then(res => this.reviews.set(res));
    this.packageService.fetchPackageReleases(this.package).then(res => this.releases.set(res));
  }

  readonly topRank = computed(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return null;
    return this.packageService.getTop10Rank(pkg);
  });

  onDownloadClick(): void {
    this.packageService.downloadPackage(this.package);
  }

  onDownloadRelease(rel: PackageRelease): void {
    this.packageService.downloadPackage(this.package, rel.download_url);
  }

  onBackdropClick(_event: MouseEvent): void {
    this.packageService.closePackageModal();
  }

  openSetupModal(): void {
    this.packageService.trackDownload(this.package);
    this.packageService.closePackageModal(false);
    this.packageService.openSetupModal();
  }

  openSignInForReview(): void {
    this.packageService.closePackageModal();
    this.authService.openAuthModal();
  }

  onFavoriteClick(): void {
    this.settingsService.toggleFavorite(this.package.id);
  }

  filterByTerm(term: string): void {
    this.packageService.searchByTermFromModal(term);
  }

  filterByTag(tag: string): void {
    this.packageService.filterByTagFromModal(tag);
  }

  copyRegistryConfig(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(`contentdb_url = ${this.settingsService.contentDbUrl()}`);
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
          avatar_url: this.authService.currentUser()?.avatar_url || 'logo.svg'
        }
      };
      const updatedList = [newReview, ...this.reviews()];
      this.reviews.set(updatedList);
      this.packageService.applyReviewAverageToPackage(this.package, updatedList);
      this.reviewTitle = '';
      this.reviewComment = '';
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  async onSubmitReport(): Promise<void> {
    if (!this.reportDetails.trim()) return;
    this.isReporting.set(true);
    const res = await this.packageService.reportPackage(this.package, this.reportReason, this.reportDetails.trim());
    this.isReporting.set(false);
    if (res.success) {
      this.reportDetails = '';
      this.isReportOpen.set(false);
    }
  }

  async onKillSwitch(action: 'delist' | 'flag' | 'restore'): Promise<void> {
    this.isModerating.set(true);
    await this.packageService.moderatePackage(this.package, action, `Executed ${action} from Package Detail Modal`);
    this.isModerating.set(false);
  }
}

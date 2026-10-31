import {
  Component,
  ChangeDetectionStrategy,
  Input,
  ViewChild,
  ElementRef,
  inject,
  signal,
  computed,
  HostListener,
  OnInit,
  OnChanges,
  AfterViewInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { marked } from 'marked';
import { LuantiPackage, CommunityReview, PackageRelease, ReleaseNotesPayload } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { PwaService } from '../../core/services/pwa.service';
import { AuthService } from '../../core/services/auth.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { PackageBadgesComponent } from '../../shared/components/package-badges.component';
import { DownloadAnalyticsChartComponent } from '../../shared/components/download-analytics-chart.component';
import { PackageCardComponent } from '../card/package-card.component';
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
  LucideUser,
  LucideChevronDown,
  LucideChevronLeft,
  LucideChevronRight,
  LucideTag,
  LucideTrash2,
  LucideTrendingUp
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
    CompactNumberPipe,
    PackageBadgesComponent,
    DownloadAnalyticsChartComponent,
    PackageCardComponent,
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
    LucideUser,
    LucideChevronDown,
    LucideChevronLeft,
    LucideChevronRight,
    LucideTag,
    LucideTrash2,
    LucideTrendingUp
  ],
  template: `
    @if (package) {
      <div
        (click)="onBackdropClick($event)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-package-title"
        class="z-50 flex items-center justify-center p-0 sm:p-4 overflow-y-auto luanti-modal-backdrop">

        <div
          (click)="$event.stopPropagation()"
          class="relative w-full max-w-5xl xl:max-w-[1120px] max-h-screen sm:max-h-[94vh] glass-modal rounded-none sm:rounded-3xl overflow-hidden flex flex-col luanti-dialog-panel my-auto">

          <div
            #modalScrollContainer
            (scroll)="onModalContainerScroll()"
            class="overflow-y-auto flex-1 flex flex-col">

            <!-- Admin-Only Package Moderation Bar (Delist, Restore & Safe Permanent Removal) -->
            @if (authService.isAdmin()) {
              <div
                [class]="isPackageDelisted() ? 'bg-amber-950/75 border-amber-500/30 text-amber-200' : 'bg-rose-950/75 border-rose-500/30 text-rose-200'"
                class="px-5 py-2.5 backdrop-blur-md border-b flex flex-col gap-2 text-xs flex-shrink-0">
                <div class="flex items-center justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-2 font-bold">
                    <svg lucideShieldAlert class="w-4 h-4 flex-shrink-0" [class]="isPackageDelisted() ? 'text-amber-400' : 'text-rose-400'"></svg>
                    <span>{{ 'modal.adminModeration' | translate }}</span>
                  </div>
                  <div class="flex items-center gap-2 flex-wrap">
                    @if (isPackageDelisted()) {
                      <button
                        type="button"
                        (click)="onKillSwitch('restore')"
                        [disabled]="isModerating()"
                        class="px-3.5 py-1.5 rounded-xl glass-btn-emerald disabled:opacity-50 font-black text-[11px] transition cursor-pointer">
                        {{ 'modal.killSwitchRestore' | translate }}
                      </button>
                    } @else {
                      <button
                        type="button"
                        (click)="onKillSwitch('delist')"
                        [disabled]="isModerating()"
                        class="px-3.5 py-1.5 rounded-xl glass-btn-rose disabled:opacity-50 font-black text-[11px] transition cursor-pointer">
                        {{ 'modal.killSwitchDelist' | translate }}
                      </button>
                    }
                  </div>
                </div>
              </div>
            }

          <!-- Top Banner Hero (True 16:9 Widescreen Aspect Ratio for HD Screenshots, Netflix-Matched Proportions) -->
          <div class="relative w-full aspect-video min-h-[260px] sm:min-h-[380px] lg:min-h-[480px] max-h-[630px] bg-slate-950 flex-shrink-0 overflow-hidden">
            <img
              [src]="activeBannerUrl() || bannerImage"
              [fallbackThumbnail]="package.thumbnail"
              appImgFallback
              [alt]="package.title"
              class="w-full h-full object-cover object-center filter brightness-100 transition-all duration-300"
            />
            <div class="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/30 to-transparent w-full sm:w-2/3"></div>
            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/20 to-transparent"></div>

            <!-- Floating Frosted Glass Close Button (Top Right) -->
            <button
              type="button"
              (click)="packageService.closePackageModal()"
              [attr.aria-label]="'modal.close' | translate"
              [appTooltip]="'modal.close' | translate"
              class="absolute top-4 right-4 p-2 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 z-30 cursor-pointer">
              <svg lucideX class="w-4 h-4 sm:w-5 sm:h-5"></svg>
            </button>

            <!-- Foreground Hero Content & Actions -->
            <div class="absolute bottom-5 left-5 sm:left-8 right-5 sm:right-8 flex flex-col justify-end gap-3 z-20">

              <!-- Badges -->
              <app-package-badges
                [package]="package"
                [showFeatured]="true">
              </app-package-badges>

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
                  [class]="settingsService.isFavorite(package.id)
                    ? 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-rose-active text-rose-300 hover:text-rose-200 flex items-center justify-center transition hover:scale-105 cursor-pointer'
                    : 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-rose text-rose-200/90 hover:text-rose-300 flex items-center justify-center transition hover:scale-105 cursor-pointer'">
                  <svg
                    lucideHeart
                    [class]="settingsService.isFavorite(package.id) ? 'w-4 h-4 fill-rose-500 text-rose-400 transition-colors' : 'w-4 h-4 transition-colors'"
                    [style.fill]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'none'"
                    [color]="settingsService.isFavorite(package.id) ? '#fb7185' : 'currentColor'">
                  </svg>
                </button>

                <!-- Share Button -->
                <button
                  type="button"
                  (click)="pwaService.sharePackage(package.title, package.short_desc, shareUrl)"
                  [appTooltip]="'modal.shareTooltip' | translate"
                  [attr.aria-label]="'modal.shareTooltip' | translate"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-sky text-sky-200/90 hover:text-sky-300 flex items-center justify-center transition hover:scale-105 cursor-pointer">
                  <svg lucideShare2 class="w-4 h-4"></svg>
                </button>

                <!-- Report / Flag Button -->
                <button
                  type="button"
                  (click)="toggleReportForm()"
                  [appTooltip]="'modal.reportPackage' | translate"
                  [attr.aria-label]="'modal.reportPackage' | translate"
                  [class]="isReportOpen()
                    ? 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-amber-active text-amber-300 flex items-center justify-center transition hover:scale-105 cursor-pointer'
                    : 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-amber text-amber-200/90 hover:text-amber-300 flex items-center justify-center transition hover:scale-105 cursor-pointer'">
                  <svg lucideFlag class="w-4 h-4"></svg>
                </button>

                <!-- Author / Admin Package Analytics Button -->
                @if (canModerate()) {
                  <button
                    type="button"
                    (click)="onOpenPackageAnalytics()"
                    [appTooltip]="'modal.viewAnalyticsTooltip' | translate"
                    [attr.aria-label]="'modal.viewAnalyticsTooltip' | translate"
                    class="w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-sky text-sky-200/90 hover:text-sky-300 flex items-center justify-center transition hover:scale-105 cursor-pointer">
                    <svg lucideTrendingUp class="w-4 h-4"></svg>
                  </button>
                }

                <!-- Author / Admin Delete Git Package Button (With Confirmation Prompt) -->
                @if (canModerate() && isGitSubmittedPackage()) {
                  <button
                    type="button"
                    (click)="toggleConfirmRemove()"
                    [disabled]="isModerating()"
                    appTooltip="Remove Package"
                    aria-label="Remove Package"
                    [class]="isConfirmingRemove()
                      ? 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-rose-active text-white flex items-center justify-center transition hover:scale-105 cursor-pointer disabled:opacity-50'
                      : 'w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-btn-rose text-rose-200 hover:text-white flex items-center justify-center transition hover:scale-105 cursor-pointer disabled:opacity-50'">
                    <svg lucideTrash2 class="w-4 h-4"></svg>
                  </button>
                }
              </div>

            </div>

          </div>

          <!-- Inline Package Removal Confirmation Banner (Prevent Accidental Removals) -->
          @if (isConfirmingRemove()) {
            <div class="mx-5 sm:mx-8 mt-5 p-4 rounded-2xl bg-rose-950/45 border border-rose-500/35 backdrop-blur-md flex items-center justify-between gap-3 flex-wrap text-xs luanti-tab-enter">
              <div class="flex items-center gap-2 text-rose-200 font-semibold">
                <svg lucideTrash2 class="w-4 h-4 text-rose-400 flex-shrink-0"></svg>
                <span>
                  Permanently remove <strong class="text-white font-mono">{{ package.author }}/{{ package.name }}</strong> from Luanti Hub?
                </span>
              </div>
              <div class="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  (click)="isConfirmingRemove.set(false)"
                  [disabled]="isModerating()"
                  class="px-3 py-1.5 rounded-xl glass-btn text-slate-300 hover:text-white font-semibold cursor-pointer">
                  {{ 'profile.cancel' | translate }}
                </button>
                <button
                  type="button"
                  (click)="onKillSwitch('remove')"
                  [disabled]="isModerating()"
                  class="px-3.5 py-1.5 rounded-xl glass-btn-rose font-black text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                  <svg lucideTrash2 class="w-3.5 h-3.5"></svg>
                  <span>Confirm Permanent Removal</span>
                </button>
              </div>
            </div>
          }

          <!-- Inline Community Report Form -->
          @if (isReportOpen()) {
            <form (ngSubmit)="onSubmitReport()" class="mx-5 sm:mx-8 mt-5 p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 backdrop-blur-md space-y-3 text-xs luanti-tab-enter">
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
                  class="px-4 py-1.5 rounded-lg glass-btn-rose disabled:opacity-50 font-bold text-xs transition cursor-pointer">
                  {{ 'modal.reportSubmit' | translate }}
                </button>
              </div>
            </form>
          }

          <!-- 2-Column Details Body -->
          <div class="p-6 sm:p-8 lg:p-10 space-y-7">

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-10">

              <!-- Left Column: Synopsis, Screenshots, Dependencies, README & 1-Click Setup -->
              <div class="lg:col-span-2 space-y-6">

                <!-- Metrics Bar -->
                <div class="flex items-center gap-3 text-xs sm:text-sm flex-wrap">
                  <span class="text-emerald-400 font-bold">
                    {{ packageService.getMatchScore(package) }}% {{ 'card.match' | translate }}
                  </span>
                  @if (devStateBadge(); as devBadge) {
                    <span
                      [class]="devBadge.classes"
                      class="px-2 py-0.5 rounded font-semibold text-xs border">
                      {{ devBadge.label }}
                    </span>
                  }
                  @if (package.min_minetest_version || package.max_minetest_version) {
                    <span class="text-slate-300 font-mono px-2 py-0.5 rounded glass-pill text-xs">
                      @if (package.min_minetest_version && package.max_minetest_version && package.min_minetest_version !== package.max_minetest_version) {
                        Luanti {{ package.min_minetest_version }} – {{ package.max_minetest_version }}
                      } @else {
                        Luanti {{ package.min_minetest_version || package.max_minetest_version }}+
                      }
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
                @if (renderedDescription(); as descHtml) {
                  <div
                    class="luanti-markdown text-slate-200 text-sm sm:text-base leading-relaxed space-y-3 break-words"
                    [innerHTML]="descHtml">
                  </div>
                }

                <!-- Media & Screenshots Carousel (Consistent with HeroBillboardComponent + Click-to-Zoom Lightbox) -->
                @if (mediaSlides().length > 0) {
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <svg lucideImage class="w-3.5 h-3.5 text-sky-400"></svg>
                        <span>{{ 'modal.screenshots' | translate }} ({{ mediaSlides().length }})</span>
                      </h3>
                      @if (currentMediaSlide()?.type === 'image') {
                        <button
                          type="button"
                          (click)="openLightbox(currentMediaSlide()!.url)"
                          class="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition cursor-pointer">
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            <line x1="11" y1="8" x2="11" y2="14"></line>
                            <line x1="8" y1="11" x2="14" y2="11"></line>
                          </svg>
                          <span>{{ 'modal.enlargeImage' | translate }}</span>
                        </button>
                      }
                    </div>

                    <div
                      (keydown.arrowleft)="prevMediaSlide($event)"
                      (keydown.arrowright)="nextMediaSlide($event)"
                      (touchstart)="onMediaTouchStart($event)"
                      (touchend)="onMediaTouchEnd($event)"
                      tabindex="0"
                      role="region"
                      aria-roledescription="carousel"
                      [attr.aria-label]="package.title + ' media gallery'"
                      class="relative w-full aspect-video rounded-2xl overflow-hidden select-none bg-slate-950 border border-white/10 shadow-xl focus:outline-none focus:ring-2 focus:ring-sky-500/50">

                      <!-- Hardware-Accelerated Horizontal Slide Track (Matching HeroBillboardComponent) -->
                      <div
                        class="flex w-full h-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
                        [style.transform]="'translate3d(-' + (mediaCarouselIndex() * 100) + '%, 0, 0)'">
                        @for (slide of mediaSlides(); track slide.url; let idx = $index) {
                          <div
                            class="w-full h-full flex-shrink-0 relative overflow-hidden bg-slate-950"
                            [attr.aria-hidden]="idx !== mediaCarouselIndex()">
                            @if (slide.type === 'video') {
                              @if (isVideoPlaying() && idx === mediaCarouselIndex()) {
                                @if (isDirectVideoUrl(slide.url)) {
                                  <video
                                    [src]="slide.url"
                                    [poster]="slide.thumbnail"
                                    controls
                                    autoplay
                                    playsinline
                                    class="w-full h-full object-contain bg-black">
                                  </video>
                                } @else if (safeVideoEmbedUrl(); as embedUrl) {
                                  <iframe
                                    [src]="embedUrl"
                                    [title]="package.title + ' video'"
                                    class="w-full h-full border-0 bg-black"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowfullscreen>
                                  </iframe>
                                }
                              } @else {
                                <div
                                  (click)="playModalVideo()"
                                  class="relative w-full h-full cursor-pointer group">
                                  <img
                                    [src]="slide.thumbnail"
                                    [fallbackThumbnail]="package.thumbnail"
                                    appImgFallback
                                    [alt]="package.title + ' video preview'"
                                    class="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                                  />
                                  <div class="absolute inset-0 bg-slate-950/35 group-hover:bg-slate-950/20 transition-colors flex items-center justify-center">
                                    <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl glass-btn text-slate-100 group-hover:text-white flex items-center justify-center shadow-2xl group-hover:scale-105 active:scale-95 transition-all duration-300">
                                      <svg class="w-6 h-6 sm:w-7 sm:h-7 ml-0.5 text-sky-300 group-hover:text-white fill-current transition-colors" viewBox="0 0 24 24">
                                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                      </svg>
                                    </div>
                                  </div>
                                  <span class="absolute top-3 left-3 px-3 py-1.5 rounded-xl glass-btn text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 pointer-events-none">
                                    <svg class="w-3 h-3 text-sky-400 fill-current" viewBox="0 0 24 24">
                                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                    </svg>
                                    <span>{{ 'modal.videoPreview' | translate }}</span>
                                  </span>
                                  <button
                                    type="button"
                                    (click)="enlargeModalVideo($event)"
                                    [appTooltip]="'card.enlargeVideo' | translate"
                                    [attr.aria-label]="'card.enlargeVideo' | translate"
                                    class="absolute top-3 right-3 p-2 rounded-xl glass-btn text-slate-200 hover:text-white opacity-85 group-hover:opacity-100 transition cursor-pointer z-20">
                                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <polyline points="15 3 21 3 21 9"></polyline>
                                      <polyline points="9 21 3 21 3 15"></polyline>
                                      <line x1="21" y1="3" x2="14" y2="10"></line>
                                      <line x1="3" y1="21" x2="10" y2="14"></line>
                                    </svg>
                                  </button>
                                </div>
                              }
                            } @else {
                              <div
                                (click)="openLightbox(slide.url)"
                                class="relative w-full h-full cursor-zoom-in group">
                                <img
                                  [src]="slide.url"
                                  [fallbackThumbnail]="package.thumbnail"
                                  appImgFallback
                                  [alt]="package.title + ' screenshot ' + (idx + 1)"
                                  loading="lazy"
                                  class="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-500"
                                />
                                <button
                                  type="button"
                                  (click)="openLightbox(slide.url, $event)"
                                  [appTooltip]="'modal.enlargeImage' | translate"
                                  [attr.aria-label]="'modal.enlargeImage' | translate"
                                  class="absolute top-3 right-3 p-2 rounded-xl glass-btn text-slate-200 hover:text-white opacity-85 group-hover:opacity-100 transition cursor-pointer z-20">
                                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="15 3 21 3 21 9"></polyline>
                                    <polyline points="9 21 3 21 3 15"></polyline>
                                    <line x1="21" y1="3" x2="14" y2="10"></line>
                                    <line x1="3" y1="21" x2="10" y2="14"></line>
                                  </svg>
                                </button>
                              </div>
                            }
                          </div>
                        }
                      </div>

                      @if (mediaSlides().length > 1) {
                        <!-- Carousel Navigation Controls (Matching HeroBillboardComponent) -->
                        <div class="absolute bottom-3 right-4 z-30 pointer-events-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            (click)="prevMediaSlide($event)"
                            [appTooltip]="'hero.prevSlide' | translate"
                            aria-label="Previous slide"
                            class="p-2 rounded-xl glass-btn text-slate-200 hover:text-white transition hover:scale-105 active:scale-95 cursor-pointer">
                            <svg lucideChevronLeft class="w-4 h-4"></svg>
                          </button>

                          <button
                            type="button"
                            (click)="nextMediaSlide($event)"
                            [appTooltip]="'hero.nextSlide' | translate"
                            aria-label="Next slide"
                            class="p-2 rounded-xl glass-btn text-slate-200 hover:text-white transition hover:scale-105 active:scale-95 cursor-pointer">
                            <svg lucideChevronRight class="w-4 h-4"></svg>
                          </button>
                        </div>

                        <!-- Frosted Pill Indicator Dock (Matching HeroBillboardComponent, no 1/N text counter) -->
                        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-950/55 backdrop-blur-md border border-white/10 shadow-lg">
                          @for (slide of mediaSlides(); track slide.url; let idx = $index) {
                            <button
                              type="button"
                              (click)="goToMediaSlide(idx, $event)"
                              [attr.aria-label]="'Go to media slide ' + (idx + 1)"
                              class="h-1.5 rounded-full transition-all duration-500 ease-out overflow-hidden cursor-pointer"
                              [class.w-6]="idx === mediaCarouselIndex()"
                              [class.bg-sky-400]="idx === mediaCarouselIndex()"
                              [class.shadow-\[0_0_8px_rgba\(56\,189\,248\,0\.6\)\]]="idx === mediaCarouselIndex()"
                              [class.w-2]="idx !== mediaCarouselIndex()"
                              [class.bg-white/35]="idx !== mediaCarouselIndex()"
                              [class.hover:bg-white/60]="idx !== mediaCarouselIndex()">
                            </button>
                          }
                        </div>
                      }
                    </div>

                    @if (mediaSlides().length > 1) {
                      <div
                        #mediaThumbStrip
                        class="flex items-center gap-3 overflow-x-auto no-scrollbar p-1 -mx-1 scroll-smooth">
                        @for (slide of mediaSlides(); track slide.url; let idx = $index) {
                          <button
                            type="button"
                            [attr.data-thumb-idx]="idx"
                            (click)="goToMediaSlide(idx)"
                            [class.ring-2]="mediaCarouselIndex() === idx"
                            [class.ring-sky-400]="mediaCarouselIndex() === idx"
                            [class.opacity-100]="mediaCarouselIndex() === idx"
                            [class.opacity-65]="mediaCarouselIndex() !== idx"
                            class="relative w-24 h-14 sm:w-28 sm:h-16 rounded-xl overflow-hidden flex-shrink-0 border border-white/10 hover:border-sky-400/60 hover:opacity-100 transition cursor-pointer">
                            <img [src]="slide.thumbnail" [alt]="package.title" loading="lazy" class="w-full h-full object-cover" />
                            @if (slide.type === 'video') {
                              <div class="absolute inset-0 bg-slate-950/35 flex items-center justify-center">
                                <div class="w-7 h-7 rounded-lg glass-btn flex items-center justify-center text-slate-100">
                                  <svg class="w-3.5 h-3.5 ml-0.5 text-sky-300 fill-current" viewBox="0 0 24 24">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                  </svg>
                                </div>
                              </div>
                            }
                          </button>
                        }
                      </div>
                    }
                  </div>
                }

                <!-- Dependencies & Provided Mods Section (Always visible so dependency status is clear) -->
                <div class="space-y-3 p-4 rounded-2xl glass-panel">
                  <h3 class="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    {{ 'modal.dependencies' | translate }}
                  </h3>

                  @if ((package.dependencies && package.dependencies.length > 0) || (package.optional_dependencies && package.optional_dependencies.length > 0) || (package.provides && package.provides.length > 0)) {
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

                    @if (package.provides && package.provides.length > 0) {
                      <div>
                        <span class="text-slate-400 font-semibold text-[11px] block mb-1.5">{{ 'modal.providesMods' | translate }} ({{ package.provides.length }})</span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (prov of package.provides; track prov) {
                            <button
                              type="button"
                              (click)="filterByTerm(prov)"
                              class="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-mono text-[11px] border border-emerald-400/30 transition cursor-pointer">
                              {{ prov }}
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
                      class="luanti-markdown text-slate-200 text-sm leading-relaxed max-h-[32rem] overflow-y-auto pr-1.5 break-words"
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
                <div class="p-4 rounded-2xl glass-panel space-y-3">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <span class="text-xs font-bold text-sky-400 uppercase tracking-wider">
                      {{ 'modal.registryConfig' | translate }}
                    </span>
                    <div class="flex items-center gap-3">
                      <button
                        type="button"
                        (click)="copyRegistryUrl()"
                        class="text-[11px] font-semibold text-emerald-400 hover:text-white flex items-center gap-1 transition cursor-pointer">
                        @if (copiedUrl()) {
                          <svg lucideCheck class="w-3.5 h-3.5 text-emerald-400"></svg>
                          <span class="text-emerald-400">{{ 'common.copiedToClipboard' | translate }}</span>
                        } @else {
                          <svg lucideCopy class="w-3.5 h-3.5"></svg>
                          <span>{{ 'setup.copyUrl' | translate }}</span>
                        }
                      </button>
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
                  </div>

                  <!-- Option A (Preferred): In-Game Settings UI -->
                  <div class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1.5">
                    <p class="text-[11px] text-emerald-200 font-medium leading-relaxed">
                      {{ 'modal.optionASettingsHint' | translate }}
                    </p>
                    <code class="block text-xs font-mono text-emerald-300 bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-emerald-500/20 break-all select-all">
                      {{ settingsService.contentDbUrl() }}
                    </code>
                  </div>

                  <!-- Option B: Direct luanti.conf / .zip -->
                  <div class="space-y-1.5">
                    <p class="text-[11px] text-slate-400 leading-relaxed">
                      {{ 'modal.registryConfigDesc' | translate }}
                    </p>
                    <code class="block text-xs font-mono text-slate-200 bg-slate-950/80 p-2.5 rounded-xl border border-white/10 break-all select-all">
                      contentdb_url = {{ settingsService.contentDbUrl() }}
                    </code>
                  </div>

                  <!-- Expandable (collapsed by default) luanti.conf / minetest.conf locations -->
                  <div class="pt-1 border-t border-white/10">
                    <button
                      type="button"
                      (click)="toggleConfLocations()"
                      [attr.aria-expanded]="showConfLocations()"
                      class="w-full flex items-center justify-between text-left text-[11px] font-semibold text-sky-400 hover:text-sky-300 py-1 transition cursor-pointer">
                      <span>{{ 'setup.whereToFindConf' | translate }}</span>
                      <svg
                        lucideChevronDown
                        class="w-4 h-4 flex-shrink-0 transition-transform duration-200"
                        [class.rotate-180]="showConfLocations()"></svg>
                    </button>

                    @if (showConfLocations()) {
                      <div class="mt-2 p-3 rounded-xl bg-slate-950/80 border border-white/10 space-y-2 text-[11px] text-slate-300">
                        <p class="text-sky-300 font-medium leading-relaxed">
                          💡 {{ 'setup.confShortcutTip' | translate }}
                        </p>
                        <div class="space-y-1.5">
                          <div>
                            <span class="font-bold text-white">{{ 'setup.confWindowsLabel' | translate }}:</span>
                            <code class="block text-[10px] font-mono text-slate-300 bg-slate-900/90 px-2 py-1 rounded border border-white/5 mt-0.5 break-all select-all">{{ 'setup.confWindowsPath' | translate }}</code>
                          </div>
                          <div>
                            <span class="font-bold text-white">{{ 'setup.confLinuxLabel' | translate }}:</span>
                            <code class="block text-[10px] font-mono text-slate-300 bg-slate-900/90 px-2 py-1 rounded border border-white/5 mt-0.5 break-all select-all">{{ 'setup.confLinuxPath' | translate }}</code>
                          </div>
                          <div>
                            <span class="font-bold text-white">{{ 'setup.confMacLabel' | translate }}:</span>
                            <code class="block text-[10px] font-mono text-slate-300 bg-slate-900/90 px-2 py-1 rounded border border-white/5 mt-0.5 break-all select-all">{{ 'setup.confMacPath' | translate }}</code>
                          </div>
                          <div>
                            <span class="font-bold text-white">{{ 'setup.confAndroidLabel' | translate }}:</span>
                            <code class="block text-[10px] font-mono text-slate-300 bg-slate-900/90 px-2 py-1 rounded border border-white/5 mt-0.5 break-all select-all">{{ 'setup.confAndroidPath' | translate }}</code>
                          </div>
                          <div>
                            <span class="font-bold text-white">{{ 'setup.confIosLabel' | translate }}:</span>
                            <code class="block text-[10px] font-mono text-slate-300 bg-slate-900/90 px-2 py-1 rounded border border-white/5 mt-0.5 break-all select-all">{{ 'setup.confIosPath' | translate }}</code>
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                </div>

              </div>

              <!-- Right Column: Author, Downloads, Score, Tags, License & External Links -->
              <div class="space-y-4 text-xs text-slate-300 border-t lg:border-t-0 lg:border-l border-white/10 lg:pl-6 pt-4 lg:pt-0">

                <!-- Author & Maintainers -->
                <div class="space-y-2">
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.author' | translate }}
                    </span>
                    <div class="flex items-center justify-between gap-2 mt-1">
                      <button
                        type="button"
                        (click)="filterByTerm(package.author)"
                        class="flex items-center gap-2 group text-left min-w-0 cursor-pointer">
                        <div class="w-6 h-6 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold text-xs flex-shrink-0">
                          {{ package.author.charAt(0).toUpperCase() }}
                        </div>
                        <span class="font-bold text-white group-hover:text-sky-400 transition text-sm truncate">{{ package.author }}</span>
                      </button>

                      <button
                        type="button"
                        (click)="openAuthorProfile(package.author)"
                        [appTooltip]="'author.viewProfile' | translate"
                        [attr.aria-label]="'author.viewProfile' | translate"
                        class="px-2 py-1 rounded-lg glass-btn text-sky-300 hover:text-white text-[11px] font-bold flex items-center gap-1 flex-shrink-0 transition cursor-pointer">
                        <svg lucideUser class="w-3 h-3 text-sky-400"></svg>
                        <span>{{ 'author.viewProfile' | translate }}</span>
                      </button>
                    </div>
                  </div>

                  @if (extraMaintainers().length > 0) {
                    <div>
                      <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                        {{ 'modal.maintainers' | translate }}
                      </span>
                      <div class="flex flex-wrap gap-1.5 mt-1">
                        @for (m of extraMaintainers(); track m) {
                          <div class="inline-flex items-center rounded-md glass-pill overflow-hidden">
                            <button
                              type="button"
                              (click)="filterByTerm(m)"
                              class="px-2 py-0.5 text-slate-300 hover:text-sky-300 font-medium text-[11px] transition cursor-pointer">
                              @{{ m }}
                            </button>
                            <button
                              type="button"
                              (click)="openAuthorProfile(m)"
                              [appTooltip]="'author.viewProfile' | translate"
                              [attr.aria-label]="'author.viewProfile' | translate"
                              class="px-1.5 py-0.5 border-l border-white/10 text-sky-400 hover:text-white hover:bg-white/10 transition cursor-pointer">
                              <svg lucideUser class="w-2.5 h-2.5"></svg>
                            </button>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>

                <!-- Technical ID & Published/Updated Dates -->
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.technicalId' | translate }}
                    </span>
                    <button
                      type="button"
                      (click)="copyTechnicalId()"
                      [appTooltip]="copiedTechId() ? ('modal.copied' | translate) : package.name"
                      class="text-sky-300 hover:text-white bg-slate-950/80 hover:bg-slate-900 border border-white/10 hover:border-sky-400/40 px-2 py-0.5 rounded-md font-mono text-xs mt-1 inline-flex items-center gap-1.5 transition cursor-pointer group">
                      <span>{{ package.name }}</span>
                      @if (copiedTechId()) {
                        <svg lucideCheck class="w-3 h-3 text-emerald-400"></svg>
                      } @else {
                        <svg lucideCopy class="w-3 h-3 text-slate-500 group-hover:text-sky-300 transition-colors"></svg>
                      }
                    </button>
                  </div>

                  @if (package.updated_at || package.created_at) {
                    <div class="text-right">
                      <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                        {{ (package.updated_at ? 'modal.lastUpdated' : 'modal.published') | translate }}
                      </span>
                      <span class="text-slate-300 font-medium text-[11px] mt-1 inline-block">
                        {{ (package.updated_at || package.created_at) | date:'mediumDate' }}
                      </span>
                    </div>
                  }
                </div>

                <!-- Downloads & Community Score (With ContentDB + Luanti Hub Dual-Counter Breakdown & Review Sentiment) -->
                <div
                  [class.grid-cols-2]="package.score > 0"
                  [class.grid-cols-1]="package.score <= 0"
                  class="grid gap-2 p-3 rounded-xl glass-panel">
                  <div>
                    <span class="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.downloads' | translate }}
                    </span>
                    <span class="font-black text-white text-sm mt-0.5 block">
                      {{ package.downloads | compactNumber }}
                    </span>
                    @if ((package.contentdb_downloads || 0) > 0 || (package.luantihub_downloads || 0) > 0) {
                      <span class="text-[10px] text-slate-400 block mt-0.5 leading-tight">
                        ContentDB: {{ (package.contentdb_downloads || 0) | compactNumber }} • Hub: {{ (package.luantihub_downloads || 0) | compactNumber }}
                      </span>
                    }
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
                      @if (package.review_thread_counts; as revCounts) {
                        @if (revCounts.positive + revCounts.neutral + revCounts.negative > 0) {
                          <div class="flex items-center gap-2 text-[10px] mt-0.5 font-semibold">
                            <span class="text-emerald-400">+{{ revCounts.positive }}</span>
                            @if (revCounts.neutral > 0) {
                              <span class="text-slate-400">~{{ revCounts.neutral }}</span>
                            }
                            @if (revCounts.negative > 0) {
                              <span class="text-rose-400">-{{ revCounts.negative }}</span>
                            }
                          </div>
                        }
                      }
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

                <!-- External Project Links & Resources -->
                <div class="space-y-1.5">
                  <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                    {{ 'modal.linksTitle' | translate }}
                  </span>
                  <div class="flex flex-col gap-1.5">
                    @if (package.donate_url) {
                      <a
                        [href]="package.donate_url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="px-2.5 py-2 rounded-lg bg-gradient-to-r from-rose-500/20 via-amber-500/15 to-rose-500/20 border border-rose-400/40 hover:border-rose-400/70 text-rose-200 hover:text-white flex items-center justify-between text-xs font-bold transition shadow-sm cursor-pointer">
                        <span class="flex items-center gap-2">
                          <svg lucideHeart class="w-3.5 h-3.5 fill-rose-400 text-rose-400" [style.fill]="'#fb7185'" [color]="'#fb7185'"></svg>
                          <span>{{ 'modal.donate' | translate }}</span>
                        </span>
                        <svg lucideExternalLink class="w-3 h-3 text-rose-300"></svg>
                      </a>
                    }

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
                    @if (package.forum_url || package.forums) {
                      <a
                        [href]="package.forum_url || package.forums"
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
                    @if (package.translation_url) {
                      <a
                        [href]="package.translation_url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="px-2.5 py-1.5 rounded-lg glass-btn text-slate-200 hover:text-white flex items-center justify-between text-xs transition cursor-pointer">
                        <span class="flex items-center gap-2">
                          <svg lucideGlobe class="w-3.5 h-3.5 text-purple-400"></svg>
                          <span>{{ 'modal.translations' | translate }}</span>
                        </span>
                        <svg lucideExternalLink class="w-3 h-3 text-slate-400"></svg>
                      </a>
                    }
                  </div>
                </div>

                <!-- Supported Games (from ContentDB game_support) -->
                @if (package.game_support && package.game_support.length > 0) {
                  <div class="space-y-1.5">
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      Supported Games
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      @for (gs of package.game_support.slice(0, 6); track gs.game.id) {
                        <button
                          type="button"
                          (click)="packageService.openPackageModalById(gs.game.author, gs.game.name, true)"
                          class="px-2 py-1 rounded-lg glass-pill hover:border-sky-400/50 text-slate-200 hover:text-white text-[10px] font-semibold flex items-center gap-1.5 transition cursor-pointer">
                          @if (gs.game.thumbnail) {
                            <img [src]="gs.game.thumbnail" [alt]="gs.game.title" class="w-3.5 h-3.5 rounded object-cover" />
                          }
                          <span class="truncate max-w-[130px]">{{ gs.game.title }}</span>
                        </button>
                      }
                    </div>
                  </div>
                }

                <!-- Content Warnings (When present on ContentDB / D1) -->
                @if (package.content_warnings && package.content_warnings.length > 0) {
                  <div class="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-2 text-[11px]">
                    <div>
                      <span class="text-amber-300 font-bold uppercase tracking-wider block text-[10px]">
                        {{ 'modal.contentWarnings' | translate }}
                      </span>
                      <div class="flex flex-wrap gap-1 mt-1">
                        @for (w of package.content_warnings; track w) {
                          <span class="glass-badge glass-badge-amber font-medium">
                            {{ w }}
                          </span>
                        }
                      </div>
                    </div>
                  </div>
                }

                <!-- Tags Pills (Clickable to filter by ContentDB Tag, with inline Tag Editor for Author/Admin) -->
                @if ((package.tags && package.tags.length > 0) || canModerate()) {
                  <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                        {{ 'modal.tags' | translate }}
                      </span>
                      @if (canModerate() && !isEditingTags()) {
                        <button
                          type="button"
                          (click)="openEditTags()"
                          class="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition cursor-pointer">
                          <svg lucideTag class="w-3 h-3"></svg>
                          <span>Edit Tags</span>
                        </button>
                      }
                    </div>

                    @if (isEditingTags()) {
                      <div class="p-3 rounded-xl bg-slate-950/85 border border-sky-500/30 space-y-2.5 text-xs">
                        <div class="flex items-center justify-between">
                          <span class="text-[11px] font-semibold text-sky-300">
                            Select Tags ({{ editableTags().length }}/5)
                          </span>
                          <button
                            type="button"
                            (click)="editableTags.set([])"
                            class="text-[10px] text-slate-400 hover:text-white transition cursor-pointer">
                            Clear
                          </button>
                        </div>
                        <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                          @for (t of packageService.availableTags(); track t.name) {
                            <button
                              type="button"
                              (click)="toggleEditableTag(t.name)"
                              [class]="isEditableTagSelected(t.name) ? 'bg-sky-500/25 text-sky-300 border-sky-400/60' : 'glass-pill text-slate-300 hover:text-white'"
                              class="px-2 py-0.5 rounded-full border text-[10px] font-medium transition cursor-pointer">
                              #{{ t.title }}
                            </button>
                          }
                        </div>
                        <div class="flex items-center justify-end gap-2 pt-1 border-t border-white/10">
                          <button
                            type="button"
                            (click)="cancelEditTags()"
                            class="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white transition cursor-pointer">
                            Cancel
                          </button>
                          <button
                            type="button"
                            [disabled]="isSavingTags()"
                            (click)="onSaveTags()"
                            class="px-3 py-1 rounded-lg glass-btn-sky text-white font-bold text-[11px] disabled:opacity-50 transition cursor-pointer">
                            {{ isSavingTags() ? 'Saving...' : 'Save Tags' }}
                          </button>
                        </div>
                      </div>
                    } @else if (package.tags && package.tags.length > 0) {
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
                    }
                  </div>
                }

              </div>

            </div>

            <!-- Lazy-Loaded "Similar Packages" Recommendation Row (Hydrated & Rendered When Close to Viewport) -->
            <section
              #similarSectionSentinel
              aria-labelledby="modal-similar-packages-heading"
              class="pt-6 border-t border-white/10 space-y-4">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 id="modal-similar-packages-heading" class="text-sm sm:text-base font-black text-white tracking-tight">
                    {{ 'modal.similarPackagesTitle' | translate }}
                  </h3>
                  <p class="text-[11px] text-slate-400">
                    {{ 'modal.similarPackagesSubtitle' | translate }}
                  </p>
                </div>
              </div>

              @if (isSimilarNearViewport()) {
                @if (similarPackages().length > 0) {
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 luanti-tab-enter">
                    @for (simPkg of similarPackages(); track simPkg.id; let first = $first; let last = $last) {
                      <app-package-card
                        [package]="simPkg"
                        [isFirst]="first"
                        [isLast]="last">
                      </app-package-card>
                    }
                  </div>
                }
              } @else {
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
                  @for (placeholder of [1, 2, 3, 4]; track placeholder) {
                    <div class="h-64 rounded-2xl glass-panel p-3.5 flex flex-col justify-between">
                      <div class="w-full aspect-video rounded-xl skeleton-shimmer"></div>
                      <div class="space-y-2 mt-3">
                        <div class="w-3/4 h-3.5 rounded skeleton-shimmer"></div>
                        <div class="w-full h-2.5 rounded skeleton-shimmer"></div>
                        <div class="w-2/3 h-2.5 rounded skeleton-shimmer"></div>
                      </div>
                    </div>
                  }
                </div>
              }
            </section>

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
                  {{ 'modal.tabReleases' | translate }} ({{ cappedReleases().length }})
                </button>
                <button
                  type="button"
                  (click)="activeTab.set('compliance')"
                  [class]="activeTab() === 'compliance' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabCompliance' | translate }}
                </button>
                @if (authService.canManagePackage(package) || authService.isAdmin()) {
                  <button
                    type="button"
                    (click)="activeTab.set('analytics')"
                    [class]="activeTab() === 'analytics' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap flex items-center gap-1.5' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap flex items-center gap-1.5'"
                    class="cursor-pointer">
                    <svg lucideTrendingUp class="w-3.5 h-3.5 text-sky-400"></svg>
                    <span>{{ 'modal.tabAnalytics' | translate }}</span>
                  </button>
                }
              </div>

              <!-- Reviews Content (Always shows interactive Rate & Review box!) -->
              @if (activeTab() === 'reviews') {
                <div class="pt-4 space-y-4 luanti-tab-enter">
                  <div class="p-4 rounded-2xl glass-panel space-y-3">
                    <div class="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span class="text-xs font-bold text-white block">{{ 'modal.rateAndReviewTitle' | translate }}</span>
                        <span class="text-[11px] text-slate-400">{{ 'modal.leaveReview' | translate }}</span>
                      </div>
                      @if (authService.currentUser() && !isPackageAuthor()) {
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
                          [appTooltip]="(isPackageAuthor() ? 'Authors cannot rate their own packages' : ('modal.signInToReviewPrompt' | translate))"
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

                    @if (isPackageAuthor()) {
                      <div class="pt-2 border-t border-white/10 flex items-center gap-2 text-xs text-amber-300/90">
                        <svg lucideAlertCircle class="w-4 h-4 text-amber-400 flex-shrink-0"></svg>
                        <span>Authors cannot star-rate or comment on their own packages.</span>
                      </div>
                    } @else if (authService.currentUser()) {
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
                    <!-- Reviews Source Summary Bar (Luanti Hub vs. ContentDB) -->
                    <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-[11px]">
                      <span class="text-slate-400 font-semibold">
                        Showing <span class="text-white font-bold">{{ reviews().length }}</span> community {{ reviews().length === 1 ? 'review' : 'reviews' }}
                      </span>
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          [appTooltip]="'Reviews submitted directly on Luanti Hub'"
                          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 font-bold text-[10px]">
                          <img src="logo.svg" alt="Luanti Hub" class="w-3.5 h-3.5 object-contain flex-shrink-0" />
                          <span>Luanti Hub ({{ luantiHubReviewsCount() }})</span>
                        </span>
                        <span
                          [appTooltip]="'Reviews synced from the official Luanti ContentDB registry'"
                          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-sky-500/15 border border-sky-400/35 text-sky-300 font-bold text-[10px]">
                          <svg lucideGlobe class="w-3 h-3 text-sky-300 flex-shrink-0"></svg>
                          <span>ContentDB ({{ contentDbReviewsCount() }})</span>
                        </span>
                      </div>
                    </div>

                    <div class="space-y-3">
                      @for (rev of reviews(); track rev.id) {
                        <div
                          [class]="rev.source === 'contentdb' ? 'border-l-2 border-l-sky-400/60' : 'border-l-2 border-l-emerald-400/60'"
                          class="p-3.5 rounded-2xl glass-panel space-y-2 text-xs">
                          <div class="flex items-start justify-between gap-2">
                            <div class="flex items-center gap-2.5 min-w-0 flex-wrap">
                              <!-- Reviewer Avatar + Platform Corner Badge -->
                              <div class="relative flex-shrink-0">
                                @if (rev.source === 'contentdb') {
                                  <div class="w-7 h-7 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-[11px] font-black text-sky-300 uppercase select-none">
                                    {{ (rev.author.display_name || rev.author.username || 'C').slice(0, 1) }}
                                  </div>
                                  <span
                                    [appTooltip]="'Official ContentDB Review'"
                                    class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-950 border border-sky-400/50 flex items-center justify-center shadow">
                                    <svg lucideGlobe class="w-2.5 h-2.5 text-sky-300"></svg>
                                  </span>
                                } @else {
                                  <img
                                    [src]="rev.author.avatar_url || 'logo.svg'"
                                    appImgFallback="logo.svg"
                                    [alt]="rev.author.display_name || rev.author.username"
                                    class="w-7 h-7 rounded-xl object-cover bg-slate-900 border border-emerald-400/30" />
                                  <span
                                    [appTooltip]="'Verified Luanti Hub Review'"
                                    class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-950 border border-emerald-400/50 flex items-center justify-center p-0.5 shadow">
                                    <img src="logo.svg" alt="" class="w-full h-full object-contain" />
                                  </span>
                                }
                              </div>

                              <button
                                type="button"
                                (click)="openAuthorProfile(rev.author.username)"
                                class="font-bold text-white hover:text-sky-300 transition truncate cursor-pointer">
                                {{ rev.author.display_name || rev.author.username }}
                              </button>
                              <div class="flex items-center gap-0.5 text-amber-400 flex-shrink-0">
                                <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
                                <span class="font-bold text-[11px]">{{ rev.rating }}/5</span>
                              </div>

                              <!-- Distinct Platform Source Badge with Logo / Icon -->
                              @if (rev.source === 'contentdb') {
                                <span
                                  [appTooltip]="'Synced from Official Luanti ContentDB'"
                                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-sky-500/15 text-sky-300 border-sky-400/35 text-[9px] font-bold uppercase tracking-wider">
                                  <svg lucideGlobe class="w-2.5 h-2.5 text-sky-300 flex-shrink-0"></svg>
                                  <span>ContentDB</span>
                                </span>
                                @if (rev.is_positive !== undefined) {
                                  <span
                                    [class]="rev.is_positive ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25' : 'bg-rose-500/10 text-rose-300 border-rose-400/25'"
                                    class="px-1.5 py-0.5 rounded-md border text-[9px] font-semibold">
                                    {{ rev.is_positive ? '👍 Recommended' : '👎 Not Recommended' }}
                                  </span>
                                }
                              } @else {
                                <span
                                  [appTooltip]="'Submitted directly on Luanti Hub'"
                                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-emerald-500/15 text-emerald-300 border-emerald-400/35 text-[9px] font-bold uppercase tracking-wider">
                                  <img src="logo.svg" alt="" class="w-3 h-3 object-contain flex-shrink-0" />
                                  <span>Luanti Hub</span>
                                </span>
                              }

                              @if (rev.votes && rev.votes.helpful > 0) {
                                <span class="text-[10px] text-slate-400 font-medium">
                                  • {{ rev.votes.helpful }} helpful
                                </span>
                              }
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                              @if (rev.thread_url) {
                                <a
                                  [href]="rev.thread_url"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  [appTooltip]="'View review thread on ContentDB'"
                                  class="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5 transition">
                                  <svg lucideExternalLink class="w-2.5 h-2.5"></svg>
                                </a>
                              }
                              <span class="text-[10px] text-slate-500">{{ rev.created_at | date }}</span>
                              @if (authService.currentUser() && !isOwnReview(rev)) {
                                @if (flaggedReviewIds().has(rev.id)) {
                                  <span class="px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-[10px] font-semibold text-amber-300 flex items-center gap-1">
                                    <svg lucideFlag class="w-2.5 h-2.5"></svg>
                                    <span>{{ 'modal.reviewFlagged' | translate }}</span>
                                  </span>
                                } @else {
                                  <button
                                    type="button"
                                    (click)="toggleFlagReviewPrompt(rev.id)"
                                    [appTooltip]="'modal.flagReview' | translate"
                                    [attr.aria-label]="'modal.flagReview' | translate"
                                    class="p-1.5 rounded-lg glass-icon-btn-amber text-amber-200/80 hover:text-amber-300 transition cursor-pointer">
                                    <svg lucideFlag class="w-3 h-3"></svg>
                                  </button>
                                }
                              }
                              @if (canDeleteReview(rev)) {
                                <button
                                  type="button"
                                  (click)="onDeleteReview(rev)"
                                  [disabled]="deletingReviewId() === rev.id"
                                  [appTooltip]="'modal.removeReview' | translate"
                                  [attr.aria-label]="'modal.removeReview' | translate"
                                  class="px-2 py-0.5 rounded-lg glass-btn-rose text-[10px] font-bold flex items-center gap-1 disabled:opacity-50 transition cursor-pointer">
                                  <svg lucideTrash2 class="w-3 h-3"></svg>
                                  <span class="hidden sm:inline">{{ 'modal.removeReview' | translate }}</span>
                                </button>
                              }
                            </div>
                          </div>
                          @if (rev.title) {
                            <h4 class="font-bold text-slate-200 text-xs">{{ rev.title }}</h4>
                          }
                          <p class="text-slate-300 leading-relaxed">{{ rev.comment }}</p>

                          @if (flaggingReviewId() === rev.id) {
                            <div class="pt-2 mt-2 border-t border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <input
                                type="text"
                                [(ngModel)]="flagReviewReason"
                                [placeholder]="'modal.flagReviewPrompt' | translate"
                                class="flex-1 glass-input rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none" />
                              <div class="flex items-center gap-1.5 justify-end">
                                <button
                                  type="button"
                                  (click)="flaggingReviewId.set(null)"
                                  class="px-2.5 py-1 rounded-lg glass-pill text-[10px] text-slate-300 hover:text-white transition cursor-pointer">
                                  {{ 'profile.cancel' | translate }}
                                </button>
                                <button
                                  type="button"
                                  (click)="onConfirmFlagReview(rev)"
                                  [disabled]="isSubmittingReviewFlag()"
                                  class="px-2.5 py-1 rounded-lg glass-btn-amber text-[10px] font-bold flex items-center gap-1 disabled:opacity-50 transition cursor-pointer">
                                  <svg lucideFlag class="w-3 h-3"></svg>
                                  <span>{{ 'modal.flagReview' | translate }}</span>
                                </button>
                              </div>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              }

              <!-- Releases Content (Sorted Newest-First, Capped at 10, Paginated 5 per Page) -->
              @if (activeTab() === 'releases') {
                <div class="pt-4 space-y-2.5 luanti-tab-enter">
                  @if (cappedReleases().length === 0) {
                    <div class="p-4 rounded-2xl glass-panel flex flex-col gap-2.5 text-xs">
                      <div class="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <span class="font-bold text-white">Latest Archive ({{ package.default_branch || 'main' }})</span>
                          <span class="block text-[11px] text-slate-400">Ready-to-drop Luanti .zip archive</span>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            (click)="toggleBranchFallbackNotes()"
                            [attr.aria-expanded]="isReleaseNotesExpanded('branch-fallback')"
                            class="px-3 py-1.5 rounded-xl glass-pill hover:border-sky-400/50 text-slate-200 hover:text-white font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer">
                            <svg
                              lucideChevronDown
                              [class]="isReleaseNotesExpanded('branch-fallback') ? 'w-3.5 h-3.5 text-sky-400 rotate-180 transition-transform' : 'w-3.5 h-3.5 text-slate-400 transition-transform'">
                            </svg>
                            <span>{{ (isReleaseNotesExpanded('branch-fallback') ? 'modal.hideReleaseNotes' : 'modal.viewReleaseNotes') | translate }}</span>
                          </button>
                          <button
                            type="button"
                            (click)="onDownloadClick()"
                            class="px-3.5 py-1.5 rounded-xl glass-btn-primary text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
                            <svg lucideDownload class="w-3.5 h-3.5 text-sky-300"></svg>
                            <span>.zip @if (package.file_size) { ({{ package.file_size }}) }</span>
                          </button>
                        </div>
                      </div>

                      @if (isReleaseNotesExpanded('branch-fallback')) {
                        <div class="border-t border-white/10 pt-3 mt-1 space-y-2.5">
                          @if (loadingReleaseNotesKey() === 'branch-fallback') {
                            <div class="flex items-center gap-2 text-[11px] text-slate-400 py-1">
                              <span class="w-3.5 h-3.5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin"></span>
                              <span>{{ 'modal.loadingReleaseNotes' | translate }}</span>
                            </div>
                          } @else if (getReleaseNotesPayload('branch-fallback'); as payload) {
                            <div class="flex items-center justify-between gap-2 flex-wrap">
                              <span class="text-[10px] font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                                <svg lucideGitBranch class="w-3 h-3 text-sky-400"></svg>
                                <span>{{ 'modal.recentBranchCommits' | translate:{ branch: payload.head_ref || package.default_branch || 'main' } }}</span>
                              </span>
                              @if (payload.compare_url) {
                                <a
                                  [href]="payload.compare_url"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="text-[10px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition">
                                  <span>{{ 'modal.viewFullDiffOnGit' | translate }}</span>
                                  <svg lucideExternalLink class="w-2.5 h-2.5"></svg>
                                </a>
                              }
                            </div>
                            @if (payload.commits && payload.commits.length > 0) {
                              <ul class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                @for (commit of payload.commits; track commit.sha) {
                                  <li class="p-2 rounded-xl bg-slate-950/60 border border-white/5 flex items-start justify-between gap-2 text-[11px]">
                                    <div class="min-w-0 space-y-0.5">
                                      <p class="text-slate-200 font-medium break-words">{{ commit.title }}</p>
                                      <div class="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                                        @if (commit.author_name) {
                                          <span>{{ commit.author_name }}</span>
                                        }
                                        @if (commit.committed_at) {
                                          <span>• {{ commit.committed_at | date:'mediumDate' }}</span>
                                        }
                                      </div>
                                    </div>
                                    @if (commit.url) {
                                      <a
                                        [href]="commit.url"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="px-1.5 py-0.5 rounded bg-slate-900 border border-white/10 font-mono text-[10px] text-sky-400 hover:text-sky-300 flex-shrink-0 transition">
                                        {{ commit.short_sha }}
                                      </a>
                                    } @else {
                                      <code class="px-1.5 py-0.5 rounded bg-slate-900 border border-white/10 font-mono text-[10px] text-sky-400 flex-shrink-0">
                                        {{ commit.short_sha }}
                                      </code>
                                    }
                                  </li>
                                }
                              </ul>
                            } @else if (payload.markdown_body) {
                              <p class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">
                                {{ payload.markdown_body }}
                              </p>
                            } @else {
                              <p class="text-[11px] text-slate-500 italic">{{ 'modal.noReleaseNotesFallback' | translate }}</p>
                            }
                          } @else {
                            <p class="text-[11px] text-slate-500 italic">{{ 'modal.noReleaseNotesFallback' | translate }}</p>
                          }
                        </div>
                      }
                    </div>
                  } @else {
                    @for (rel of paginatedReleases(); track rel.id; let idx = $index) {
                      <div class="p-3.5 rounded-2xl glass-panel flex flex-col gap-2 text-xs">
                        <div class="flex items-center justify-between gap-3 flex-wrap">
                          <div class="space-y-0.5 min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="font-bold text-white">{{ rel.version }}</span>
                              @if (releasesPage() === 1 && idx === 0 && rel.commit_sha !== 'HEAD') {
                                <span class="px-1.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-bold text-[10px] uppercase tracking-wider">
                                  {{ 'modal.latestRelease' | translate }}
                                </span>
                              }
                              @if (rel.commit_sha) {
                                <code class="text-[10px] text-sky-400 bg-slate-950/80 px-1.5 py-0.5 rounded font-mono border border-white/10">
                                  {{ rel.commit_sha | slice:0:8 }}
                                </code>
                              }
                              @if (rel.min_minetest_version) {
                                <span class="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-slate-300">
                                  Engine {{ rel.min_minetest_version }}+
                                </span>
                              }
                            </div>
                            <div class="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                              @if (rel.released_at) {
                                <span>{{ rel.released_at | date }}</span>
                              }
                              @if (rel.downloads !== undefined && rel.downloads > 0) {
                                <span>• {{ rel.downloads | compactNumber }} downloads</span>
                              }
                            </div>
                          </div>

                          <div class="flex items-center gap-2 flex-wrap ml-auto">
                            <button
                              type="button"
                              (click)="toggleReleaseNotes(rel, idx)"
                              [attr.aria-expanded]="isReleaseNotesExpanded(getReleaseNotesKey(rel, idx))"
                              class="px-2.5 py-1.5 rounded-xl glass-pill hover:border-sky-400/50 text-slate-200 hover:text-white font-semibold text-[11px] flex items-center gap-1.5 flex-shrink-0 transition cursor-pointer">
                              <svg
                                lucideChevronDown
                                [class]="isReleaseNotesExpanded(getReleaseNotesKey(rel, idx)) ? 'w-3.5 h-3.5 text-sky-400 rotate-180 transition-transform' : 'w-3.5 h-3.5 text-slate-400 transition-transform'">
                              </svg>
                              <span>{{ (isReleaseNotesExpanded(getReleaseNotesKey(rel, idx)) ? 'modal.hideReleaseNotes' : 'modal.viewReleaseNotes') | translate }}</span>
                            </button>

                            <button
                              type="button"
                              (click)="onDownloadRelease(rel)"
                              class="px-3.5 py-1.5 rounded-xl glass-btn hover:bg-white text-white hover:text-slate-950 font-bold text-xs flex items-center gap-1.5 flex-shrink-0 transition cursor-pointer">
                              <svg lucideDownload class="w-3.5 h-3.5"></svg>
                              <span>
                                {{ 'card.downloadZip' | translate }}
                                @if (rel.file_size || package.file_size) {
                                  ({{ rel.file_size || package.file_size }})
                                }
                              </span>
                            </button>
                          </div>
                        </div>

                        @if ((rel.release_notes || rel.changelog) && !isReleaseNotesExpanded(getReleaseNotesKey(rel, idx))) {
                          <p class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line border-t border-white/10 pt-2 line-clamp-2">
                            {{ rel.release_notes || rel.changelog }}
                          </p>
                        }

                        @if (isReleaseNotesExpanded(getReleaseNotesKey(rel, idx))) {
                          <div class="border-t border-white/10 pt-3 mt-1 space-y-2.5">
                            @if (rel.release_notes || rel.changelog) {
                              <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/10">
                                <p class="text-[11px] text-slate-200 leading-relaxed whitespace-pre-line">
                                  {{ rel.release_notes || rel.changelog }}
                                </p>
                              </div>
                            }

                            @if (loadingReleaseNotesKey() === getReleaseNotesKey(rel, idx)) {
                              <div class="flex items-center gap-2 text-[11px] text-slate-400 py-1">
                                <span class="w-3.5 h-3.5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin"></span>
                                <span>{{ 'modal.loadingReleaseNotes' | translate }}</span>
                              </div>
                            } @else if (getReleaseNotesPayload(getReleaseNotesKey(rel, idx)); as payload) {
                              <div class="flex items-center justify-between gap-2 flex-wrap">
                                <span class="text-[10px] font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                                  <svg lucideGitBranch class="w-3 h-3 text-sky-400"></svg>
                                  @if (payload.source === 'compare' && payload.base_ref) {
                                    <span>{{ 'modal.commitsBetween' | translate:{ base: payload.base_ref, head: payload.head_ref } }}</span>
                                  } @else {
                                    <span>{{ 'modal.recentBranchCommits' | translate:{ branch: payload.head_ref || package.default_branch || 'main' } }}</span>
                                  }
                                </span>
                                @if (payload.compare_url) {
                                  <a
                                    [href]="payload.compare_url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-[10px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 transition">
                                    <span>{{ 'modal.viewFullDiffOnGit' | translate }}</span>
                                    <svg lucideExternalLink class="w-2.5 h-2.5"></svg>
                                  </a>
                                }
                              </div>

                              @if (payload.commits && payload.commits.length > 0) {
                                <ul class="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                  @for (commit of payload.commits; track commit.sha) {
                                    <li class="p-2 rounded-xl bg-slate-950/60 border border-white/5 flex items-start justify-between gap-2 text-[11px]">
                                      <div class="min-w-0 space-y-0.5">
                                        <p class="text-slate-200 font-medium break-words">{{ commit.title }}</p>
                                        <div class="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                                          @if (commit.author_name) {
                                            <span>{{ commit.author_name }}</span>
                                          }
                                          @if (commit.committed_at) {
                                            <span>• {{ commit.committed_at | date:'mediumDate' }}</span>
                                          }
                                        </div>
                                      </div>
                                      @if (commit.url) {
                                        <a
                                          [href]="commit.url"
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          class="px-1.5 py-0.5 rounded bg-slate-900 border border-white/10 font-mono text-[10px] text-sky-400 hover:text-sky-300 flex-shrink-0 transition">
                                          {{ commit.short_sha }}
                                        </a>
                                      } @else {
                                        <code class="px-1.5 py-0.5 rounded bg-slate-900 border border-white/10 font-mono text-[10px] text-sky-400 flex-shrink-0">
                                          {{ commit.short_sha }}
                                        </code>
                                      }
                                    </li>
                                  }
                                </ul>
                              } @else if (!rel.release_notes && !rel.changelog) {
                                <p class="text-[11px] text-slate-500 italic">{{ 'modal.noReleaseNotesFallback' | translate }}</p>
                              }
                            } @else if (!rel.release_notes && !rel.changelog) {
                              <p class="text-[11px] text-slate-500 italic">{{ 'modal.noReleaseNotesFallback' | translate }}</p>
                            }
                          </div>
                        }
                      </div>
                    }

                    @if (totalReleasePages() > 1) {
                      <div class="pt-2 flex items-center justify-between gap-3 flex-wrap text-xs">
                        <span class="text-[11px] text-slate-400 font-medium">
                          {{ 'modal.showingLatestReleases' | translate:{ count: cappedReleases().length } }}
                        </span>
                        <div class="flex items-center gap-2 ml-auto">
                          <button
                            type="button"
                            (click)="prevReleasesPage()"
                            [disabled]="releasesPage() <= 1"
                            aria-label="Previous releases page"
                            class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 disabled:pointer-events-none font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                            <svg lucideChevronLeft class="w-3.5 h-3.5"></svg>
                            <span>{{ 'profile.prevPage' | translate }}</span>
                          </button>
                          <span class="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-white/10 text-[11px] font-mono text-slate-300">
                            {{ 'profile.pageLabel' | translate }} {{ releasesPage() }} / {{ totalReleasePages() }}
                          </span>
                          <button
                            type="button"
                            (click)="nextReleasesPage()"
                            [disabled]="releasesPage() >= totalReleasePages()"
                            aria-label="Next releases page"
                            class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 disabled:pointer-events-none font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                            <span>{{ 'profile.nextPage' | translate }}</span>
                            <svg lucideChevronRight class="w-3.5 h-3.5"></svg>
                          </button>
                        </div>
                      </div>
                    }
                  }
                </div>
              }

              <!-- Compliance Content -->
              @if (activeTab() === 'compliance') {
                <div class="pt-4 space-y-3 text-xs text-slate-300 leading-relaxed luanti-tab-enter">
                  @if (package.content_warnings && package.content_warnings.length > 0) {
                    <div class="p-3.5 rounded-2xl bg-amber-950/35 border border-amber-500/30 space-y-2">
                      <div>
                        <span class="font-bold text-amber-300 block mb-1">{{ 'modal.contentWarnings' | translate }}</span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (w of package.content_warnings; track w) {
                            <span class="px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-200 border border-amber-400/30 text-[11px] font-medium">
                              {{ w }}
                            </span>
                          }
                        </div>
                      </div>
                    </div>
                  }
                  <div class="flex items-start gap-2.5 p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                    <svg lucideShieldCheck class="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-400"></svg>
                    <span>{{ 'modal.spdxNotice' | translate }}</span>
                  </div>
                  <p class="text-slate-400 text-[11px]">
                    {{ 'modal.safeHarborNotice' | translate }}
                  </p>
                </div>
              }

              <!-- Author / Admin Package Download Analytics Tab -->
              @if (activeTab() === 'analytics' && (authService.canManagePackage(package) || authService.isAdmin())) {
                <div class="pt-4 luanti-tab-enter">
                  <app-download-analytics-chart
                    [package]="package"
                    [showExpandButton]="true">
                  </app-download-analytics-chart>
                </div>
              }
            </div>

          </div>

          </div>

        </div>

        <!-- Fullscreen Screenshot Zoom Lightbox (z-[70]) -->
        @if (lightboxImageUrl(); as zoomImg) {
          <div
            (click)="closeLightbox($event)"
            (keydown.escape)="closeLightbox($event)"
            (keydown.arrowleft)="prevLightboxImage($event)"
            (keydown.arrowright)="nextLightboxImage($event)"
            (touchstart)="onLightboxTouchStart($event)"
            (touchend)="onLightboxTouchEnd($event)"
            tabindex="0"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="package.title + ' enlarged screenshot'"
            class="fixed inset-0 z-[70] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-3 sm:p-6 select-none">

            <!-- Lightbox Top Controls -->
            <div
              (click)="$event.stopPropagation()"
              class="absolute top-4 right-4 z-30 flex items-center gap-2">
              <button
                type="button"
                (click)="toggleLightboxZoom($event)"
                class="px-3.5 py-2 rounded-xl glass-btn text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  @if (!isLightboxZoomed()) {
                    <line x1="11" y1="8" x2="11" y2="14"></line>
                  }
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
                <span>{{ isLightboxZoomed() ? '1x' : '2x' }}</span>
              </button>

              <button
                type="button"
                (click)="closeLightbox($event)"
                [attr.aria-label]="'modal.close' | translate"
                class="p-2 rounded-xl glass-btn text-slate-200 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer">
                <svg lucideX class="w-4 h-4 sm:w-5 sm:h-5"></svg>
              </button>
            </div>

            <!-- Lightbox Image Viewport -->
            <div
              (click)="$event.stopPropagation()"
              class="relative max-w-6xl max-h-[86vh] w-full h-full flex items-center justify-center overflow-auto">
              <img
                [src]="zoomImg"
                [alt]="package.title + ' full resolution screenshot'"
                (click)="toggleLightboxZoom($event)"
                [class]="isLightboxZoomed() ? 'max-w-none w-[165%] sm:w-[150%] h-auto object-contain cursor-zoom-out transition-transform duration-300' : 'max-w-full max-h-[84vh] object-contain rounded-xl shadow-2xl cursor-zoom-in transition-transform duration-300'"
              />
            </div>

            @if (activeScreenshots().length > 1) {
              <!-- Lightbox Prev / Next Navigation Controls -->
              <div
                (click)="$event.stopPropagation()"
                class="absolute bottom-5 right-6 z-30 flex items-center gap-2">
                <button
                  type="button"
                  (click)="prevLightboxImage($event)"
                  aria-label="Previous screenshot"
                  class="p-2.5 rounded-xl glass-btn text-slate-200 hover:text-white transition hover:scale-105 cursor-pointer">
                  <svg lucideChevronLeft class="w-5 h-5"></svg>
                </button>
                <button
                  type="button"
                  (click)="nextLightboxImage($event)"
                  aria-label="Next screenshot"
                  class="p-2.5 rounded-xl glass-btn text-slate-200 hover:text-white transition hover:scale-105 cursor-pointer">
                  <svg lucideChevronRight class="w-5 h-5"></svg>
                </button>
              </div>
            }
          </div>
        }

      </div>
    }
  `
})
export class PackageDetailModalComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) package!: LuantiPackage;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly activeTab = signal<'reviews' | 'releases' | 'compliance' | 'analytics'>('reviews');
  readonly reviews = signal<CommunityReview[]>([]);
  readonly luantiHubReviewsCount = computed(() =>
    this.reviews().filter(r => r.source !== 'contentdb').length
  );
  readonly contentDbReviewsCount = computed(() =>
    this.reviews().filter(r => r.source === 'contentdb').length
  );
  readonly releases = signal<PackageRelease[]>([]);
  readonly RELEASES_PAGE_SIZE = 5;
  readonly MAX_RELEASES_CAP = 10;
  readonly releasesPage = signal<number>(1);
  readonly cappedReleases = computed<PackageRelease[]>(() =>
    this.packageService.sortAndCapReleases(this.releases(), this.MAX_RELEASES_CAP)
  );
  readonly totalReleasePages = computed<number>(() =>
    Math.max(1, Math.ceil(this.cappedReleases().length / this.RELEASES_PAGE_SIZE))
  );
  readonly paginatedReleases = computed<PackageRelease[]>(() => {
    const list = this.cappedReleases();
    const page = Math.min(Math.max(1, this.releasesPage()), this.totalReleasePages());
    const start = (page - 1) * this.RELEASES_PAGE_SIZE;
    return list.slice(start, start + this.RELEASES_PAGE_SIZE);
  });

  // Lazy-Loaded "Similar Packages" state (triggered when within 240px of viewport)
  @ViewChild('modalScrollContainer') modalScrollContainerRef?: ElementRef<HTMLDivElement>;
  @ViewChild('similarSectionSentinel') similarSentinelRef?: ElementRef<HTMLElement>;
  readonly isSimilarNearViewport = signal<boolean>(false);
  private similarObserver: IntersectionObserver | null = null;
  readonly similarPackages = computed<LuantiPackage[]>(() => {
    if (!this.isSimilarNearViewport()) return [];
    const pkg = this.packageService.activePackage() || this.package;
    return this.packageService.getSimilarPackages(pkg, 4);
  });

  readonly copied = signal(false);
  readonly copiedUrl = signal(false);
  readonly copiedTechId = signal(false);
  readonly showConfLocations = signal(false);
  readonly activeBannerUrl = signal<string | null>(null);

  // Media Carousel, Video Player & Zoom Lightbox state
  @ViewChild('mediaThumbStrip') mediaThumbStripRef?: ElementRef<HTMLDivElement>;
  readonly mediaCarouselIndex = signal<number>(0);
  readonly isVideoPlaying = signal<boolean>(false);
  readonly lightboxImageUrl = signal<string | null>(null);
  readonly isLightboxZoomed = signal<boolean>(false);
  private mediaTouchStartX = 0;
  private mediaTouchStartY = 0;
  private lightboxTouchStartX = 0;
  private lightboxTouchStartY = 0;

  readonly activeScreenshots = computed<string[]>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg || !Array.isArray(pkg.screenshots)) return [];
    return pkg.screenshots.filter(Boolean);
  });

  readonly mediaSlides = computed<Array<{ type: 'video' | 'image'; url: string; thumbnail: string }>>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return [];
    const slides: Array<{ type: 'video' | 'image'; url: string; thumbnail: string }> = [];
    if (pkg.video_url) {
      slides.push({
        type: 'video',
        url: pkg.video_url,
        thumbnail: pkg.video_thumbnail_url || this.bannerImage
      });
    }
    const shots = Array.isArray(pkg.screenshots) ? pkg.screenshots.filter(Boolean) : [];
    for (const shot of shots) {
      slides.push({
        type: 'image',
        url: shot,
        thumbnail: shot
      });
    }
    return slides;
  });

  readonly currentMediaSlide = computed(() => {
    const slides = this.mediaSlides();
    if (slides.length === 0) return null;
    const idx = Math.min(Math.max(0, this.mediaCarouselIndex()), slides.length - 1);
    return slides[idx];
  });

  readonly safeVideoEmbedUrl = computed<SafeResourceUrl | null>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const rawUrl = pkg?.video_url;
    if (!rawUrl || this.isDirectVideoUrl(rawUrl)) return null;
    const embedUrl = this.buildVideoEmbedUrl(rawUrl);
    if (!embedUrl) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  });

  readonly devStateBadge = computed<{ label: string; classes: string } | null>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const raw = (pkg?.dev_state || '').trim().toUpperCase();
    if (!raw) return null;
    switch (raw) {
      case 'ACTIVELY_DEVELOPED':
        return { label: 'Actively Developed', classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40' };
      case 'MAINTENANCE_ONLY':
        return { label: 'Maintenance Only', classes: 'bg-sky-500/20 text-sky-300 border-sky-400/40' };
      case 'WIP':
        return { label: 'Work in Progress', classes: 'bg-amber-500/20 text-amber-300 border-amber-400/40' };
      case 'AS_IS':
        return { label: 'Provided As-Is', classes: 'bg-slate-500/20 text-slate-300 border-slate-400/40' };
      case 'DEPRECATED':
        return { label: 'Deprecated', classes: 'bg-rose-500/20 text-rose-300 border-rose-400/40' };
      case 'LOOKING_FOR_MAINTAINER':
        return { label: 'Needs Maintainer', classes: 'bg-purple-500/20 text-purple-300 border-purple-400/40' };
      default:
        return {
          label: raw.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
          classes: 'bg-slate-500/20 text-slate-300 border-slate-400/40'
        };
    }
  });

  readonly extraMaintainers = computed<string[]>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg || !Array.isArray(pkg.maintainers)) return [];
    const authorLower = (pkg.author || '').toLowerCase();
    return pkg.maintainers.filter(m => Boolean(m) && m.toLowerCase() !== authorLower);
  });

  // Review Form state
  readonly userRating = signal(5);
  reviewTitle = '';
  reviewComment = '';
  readonly isSubmittingReview = signal(false);
  readonly flaggingReviewId = signal<string | null>(null);
  flagReviewReason = '';
  readonly isSubmittingReviewFlag = signal(false);
  readonly flaggedReviewIds = signal<Set<string>>(new Set());
  readonly deletingReviewId = signal<string | null>(null);

  // Report & Moderation state
  readonly isReportOpen = signal(false);
  reportReason = 'dmca';
  reportDetails = '';
  readonly isReporting = signal(false);
  readonly isModerating = signal(false);
  readonly isConfirmingRemove = signal(false);

  // Author Tag Editing state
  readonly isEditingTags = signal(false);
  readonly editableTags = signal<string[]>([]);
  readonly isSavingTags = signal(false);

  // Expandable Release Notes state
  readonly expandedReleaseKeys = signal<Set<string>>(new Set());
  readonly loadingReleaseNotesKey = signal<string | null>(null);
  readonly releaseNotesByKey = signal<Map<string, ReleaseNotesPayload>>(new Map());

  readonly canModerate = computed(() => {
    const pkg = this.packageService.activePackage() || this.package;
    return this.authService.canManagePackage(pkg);
  });

  readonly isGitSubmittedPackage = computed(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return false;
    return (
      pkg.source === 'git' ||
      (Array.isArray(pkg.sources) && pkg.sources.includes('git')) ||
      Boolean(pkg.provider && pkg.provider !== 'contentdb')
    );
  });

  readonly isPackageAuthor = computed(() => {
    const user = this.authService.currentUser();
    const pkg = this.packageService.activePackage() || this.package;
    if (!user || !pkg) return false;

    const handles = new Set<string>();
    if (user.username) handles.add(user.username.toLowerCase());
    for (const id of user.identities || []) {
      if (id?.username) handles.add(id.username.toLowerCase());
    }

    const pkgAuthor = (pkg.author || (pkg as any).author_name || '').toLowerCase();
    if (pkgAuthor && handles.has(pkgAuthor)) return true;

    const pkgId = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
    if ((user.packages || []).some((up: any) => {
      const upAuthor = up.author || up.author_name || user.username;
      const upId = String(up.id || `${upAuthor}/${up.name}`).toLowerCase();
      return upId === pkgId;
    })) {
      return true;
    }

    if (pkg.repo_url) {
      try {
        const parts = new URL(pkg.repo_url).pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && handles.has(parts[0].toLowerCase())) {
          return true;
        }
      } catch {
        // ignore
      }
    }

    return false;
  });

  readonly isPackageDelisted = computed(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return false;
    if (pkg.status === 'delisted' || pkg.status === 'flagged') return true;
    const targetId = (pkg.id || `${pkg.author}/${pkg.name}`).toLowerCase();
    return this.authService
      .delistedPackages()
      .some(d => (d.id || `${d.author}/${d.name}`).toLowerCase() === targetId);
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

  private normalizeTextForDedup(text: string): string {
    return (text || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_`~>-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private getRawAssetBase(pkg: LuantiPackage): string | undefined {
    const repoUrl = this.packageService.normalizeGitRepoUrl(pkg?.repo_url);
    if (!repoUrl) return undefined;
    const branch = pkg.default_branch || 'main';
    try {
      const u = new URL(repoUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, '');
        if (u.hostname === 'github.com') {
          return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
        }
        if (u.hostname === 'codeberg.org') {
          return `https://codeberg.org/${owner}/${repo}/raw/branch/${branch}`;
        }
        if (u.hostname === 'git.minetest.land') {
          return `https://git.minetest.land/${owner}/${repo}/raw/branch/${branch}`;
        }
        if (u.hostname === 'gitlab.com') {
          return `https://gitlab.com/${owner}/${repo}/-/raw/${branch}`;
        }
      }
    } catch {
      // ignore
    }
    return `${repoUrl.replace(/\.git$/i, '').replace(/\/+$/, '')}/raw/${branch}`;
  }

  readonly renderedDescription = computed<SafeHtml | null>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return null;
    const rawDesc = (pkg.desc || '').trim();
    const rawReadme = (pkg.readme || '').trim();
    const shortDesc = (pkg.short_desc || '').trim();
    const isPureGit = pkg.source === 'git' && (!pkg.sources || !pkg.sources.includes('official'));

    if (rawReadme) {
      const normDesc = this.normalizeTextForDedup(rawDesc);
      const normReadme = this.normalizeTextForDedup(rawReadme);
      const isDescDuplicateOfReadme =
        isPureGit ||
        !normDesc ||
        normDesc === normReadme ||
        (normDesc.length > 40 && (normReadme.includes(normDesc) || normDesc.includes(normReadme)));

      if (isDescDuplicateOfReadme) {
        const normShort = this.normalizeTextForDedup(shortDesc);
        if (!shortDesc || normShort === normReadme) {
          return null;
        }
        const rewrittenShort = this.packageService.rewriteRelativeMarkdownUrls(shortDesc, this.getRawAssetBase(pkg));
        return this.parseSafeMarkdown(rewrittenShort);
      }
    }

    const raw = rawDesc || shortDesc;
    if (!raw) return null;
    const rewritten = this.packageService.rewriteRelativeMarkdownUrls(raw, this.getRawAssetBase(pkg));
    return this.parseSafeMarkdown(rewritten);
  });

  readonly renderedReadme = computed<SafeHtml | null>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const rawReadme = (pkg?.readme || '').trim();
    if (!rawReadme) return null;
    const rewritten = this.packageService.rewriteRelativeMarkdownUrls(rawReadme, this.getRawAssetBase(pkg));
    return this.parseSafeMarkdown(rewritten);
  });

  get shareUrl(): string {
    const pkg = this.packageService.activePackage() || this.package;
    if (typeof window === 'undefined' || !pkg) return '';
    const resolvedAuthor =
      pkg.author ||
      (pkg as any).author_name ||
      (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
    return `${window.location.origin}/package/${encodeURIComponent(resolvedAuthor)}/${encodeURIComponent(pkg.name)}`;
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

  private static readonly savedViewStateByPkg = new Map<string, {
    scrollTop: number;
    isSimilarNearViewport: boolean;
    activeTab: 'reviews' | 'releases' | 'compliance' | 'analytics';
    releasesPage: number;
  }>();

  private loadedPackageKey = '';
  private lastKnownScrollTop = 0;

  private persistCurrentViewState(): void {
    if (!this.loadedPackageKey) return;
    PackageDetailModalComponent.savedViewStateByPkg.set(this.loadedPackageKey, {
      scrollTop: this.lastKnownScrollTop,
      isSimilarNearViewport: this.isSimilarNearViewport(),
      activeTab: this.activeTab(),
      releasesPage: this.releasesPage()
    });
  }

  private restoreSavedScrollPosition(targetScrollTop: number): void {
    this.lastKnownScrollTop = targetScrollTop;
    const applyScroll = () => {
      const scrollEl = this.modalScrollContainerRef?.nativeElement;
      if (scrollEl && targetScrollTop > 0) {
        scrollEl.scrollTop = targetScrollTop;
      }
    };
    applyScroll();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => applyScroll());
    }
    setTimeout(() => applyScroll(), 0);
    setTimeout(() => applyScroll(), 60);
  }

  ngOnInit(): void {
    this.packageService.registerModalSubOverlayCloser(() => {
      if (this.lightboxImageUrl()) {
        this.closeLightbox();
        return true;
      }
      if (this.isConfirmingRemove()) {
        this.isConfirmingRemove.set(false);
        return true;
      }
      if (this.isReportOpen()) {
        this.isReportOpen.set(false);
        return true;
      }
      if (this.isEditingTags()) {
        this.isEditingTags.set(false);
        return true;
      }
      return false;
    });
    this.ensureExtraDataLoaded();
  }

  ngOnChanges(): void {
    this.ensureExtraDataLoaded();
  }

  ngAfterViewInit(): void {
    const savedState = this.loadedPackageKey
      ? PackageDetailModalComponent.savedViewStateByPkg.get(this.loadedPackageKey)
      : undefined;
    if (savedState && savedState.scrollTop > 0) {
      this.restoreSavedScrollPosition(savedState.scrollTop);
    }
    this.setupSimilarIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.persistCurrentViewState();
    this.disconnectSimilarObserver();
    this.packageService.registerModalSubOverlayCloser(null);
  }

  prevReleasesPage(): void {
    this.releasesPage.update(p => Math.max(1, p - 1));
    this.persistCurrentViewState();
  }

  nextReleasesPage(): void {
    this.releasesPage.update(p => Math.min(this.totalReleasePages(), p + 1));
    this.persistCurrentViewState();
  }

  onModalContainerScroll(): void {
    const container = this.modalScrollContainerRef?.nativeElement;
    if (container) {
      this.lastKnownScrollTop = container.scrollTop;
      this.persistCurrentViewState();
    }
    if (this.isSimilarNearViewport()) return;
    const sentinel = this.similarSentinelRef?.nativeElement;
    if (!container || !sentinel) return;
    const containerRect = container.getBoundingClientRect();
    const sentinelRect = sentinel.getBoundingClientRect();
    if (sentinelRect.top - containerRect.bottom <= 240) {
      this.triggerSimilarPackagesLoad();
    }
  }

  private disconnectSimilarObserver(): void {
    if (this.similarObserver) {
      this.similarObserver.disconnect();
      this.similarObserver = null;
    }
  }

  private setupSimilarIntersectionObserver(): void {
    this.disconnectSimilarObserver();
    if (this.isSimilarNearViewport()) return;

    const sentinel = this.similarSentinelRef?.nativeElement;
    if (!sentinel) return;

    if (typeof IntersectionObserver === 'undefined') {
      this.triggerSimilarPackagesLoad();
      return;
    }

    const rootEl = this.modalScrollContainerRef?.nativeElement || null;
    this.similarObserver = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting || e.intersectionRatio > 0)) {
          this.triggerSimilarPackagesLoad();
        }
      },
      {
        root: rootEl,
        rootMargin: '240px 0px',
        threshold: 0.01
      }
    );
    this.similarObserver.observe(sentinel);
  }

  triggerSimilarPackagesLoad(): void {
    if (this.isSimilarNearViewport()) return;
    this.isSimilarNearViewport.set(true);
    this.persistCurrentViewState();
    this.disconnectSimilarObserver();
    const recs = this.similarPackages();
    if (recs.length > 0) {
      this.packageService.prioritizeVisiblePackages(recs);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleWindowKeyDown(event: KeyboardEvent): void {
    if (!this.lightboxImageUrl()) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.prevLightboxImage(event);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextLightboxImage(event);
    }
  }

  private async ensureExtraDataLoaded(): Promise<void> {
    if (!this.package) return;
    if (this.packageService.startInEditTagsMode()) {
      this.packageService.startInEditTagsMode.set(false);
      this.openEditTags();
    }
    const resolvedAuthor = this.package.author || (this.package as any).author_name || '';
    const key = (this.package.id || `${resolvedAuthor}/${this.package.name}`).toLowerCase();
    if (this.loadedPackageKey === key) return;
    const isSwitchingPackage = Boolean(this.loadedPackageKey && this.loadedPackageKey !== key);
    if (isSwitchingPackage) {
      this.persistCurrentViewState();
    }
    this.loadedPackageKey = key;
    this.activeBannerUrl.set(null);
    this.mediaCarouselIndex.set(0);
    this.isVideoPlaying.set(false);
    this.lightboxImageUrl.set(null);
    this.isLightboxZoomed.set(false);
    this.expandedReleaseKeys.set(new Set());
    this.loadingReleaseNotesKey.set(null);

    const savedState = PackageDetailModalComponent.savedViewStateByPkg.get(key);
    if (savedState) {
      this.isSimilarNearViewport.set(savedState.isSimilarNearViewport);
      this.activeTab.set(savedState.activeTab);
      this.releasesPage.set(savedState.releasesPage);
      this.restoreSavedScrollPosition(savedState.scrollTop);
    } else if (isSwitchingPackage) {
      this.lastKnownScrollTop = 0;
      this.isSimilarNearViewport.set(false);
      this.activeTab.set('reviews');
      this.releasesPage.set(1);
      const scrollEl = this.modalScrollContainerRef?.nativeElement;
      if (scrollEl) {
        if (typeof scrollEl.scrollTo === 'function') {
          scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          scrollEl.scrollTop = 0;
        }
      }
      setTimeout(() => this.setupSimilarIntersectionObserver(), 0);
    }

    // Wait for bundled package details first (which populates reviewsCache & releasesCache in 1 request)
    await this.packageService.loadPackageDetails(this.package, true);
    if (this.loadedPackageKey !== key) return;

    this.packageService.fetchReviews(this.package, false).then(res => {
      this.reviews.set(res);
      if (savedState && savedState.scrollTop > 0) {
        this.restoreSavedScrollPosition(savedState.scrollTop);
      }
    });
    this.packageService.fetchPackageReleases(this.package).then(res => {
      this.releases.set(res);
      if (savedState && savedState.scrollTop > 0) {
        this.restoreSavedScrollPosition(savedState.scrollTop);
      }
    });
  }

  isDirectVideoUrl(url?: string): boolean {
    return this.packageService.isDirectVideoUrl(url);
  }

  private buildVideoEmbedUrl(rawUrl: string): string | null {
    return this.packageService.buildVideoEmbedUrl(rawUrl, {
      autoplay: true,
      mute: false,
      minimalControls: false
    });
  }

  playModalVideo(): void {
    this.isVideoPlaying.set(true);
  }

  enlargeModalVideo(event?: Event): void {
    if (event) event.stopPropagation();
    this.isVideoPlaying.set(false);
    const pkg = this.packageService.activePackage() || this.package;
    if (pkg) {
      this.packageService.openVideoTheater(pkg, 0);
    }
  }

  private scrollActiveThumbnailIntoView(idx: number): void {
    const strip = this.mediaThumbStripRef?.nativeElement;
    if (!strip) return;
    const btn = strip.querySelector(`[data-thumb-idx="${idx}"]`) as HTMLElement | null;
    if (!btn) return;
    const targetLeft = Math.max(0, btn.offsetLeft - strip.clientWidth / 2 + btn.clientWidth / 2);
    if (typeof strip.scrollTo === 'function') {
      strip.scrollTo({
        left: targetLeft,
        behavior: 'smooth'
      });
    } else {
      strip.scrollLeft = targetLeft;
    }
  }

  prevMediaSlide(event?: Event): void {
    if (event) event.stopPropagation();
    const slides = this.mediaSlides();
    if (slides.length <= 1) return;
    this.isVideoPlaying.set(false);
    const nextIdx = (this.mediaCarouselIndex() - 1 + slides.length) % slides.length;
    this.mediaCarouselIndex.set(nextIdx);
    this.scrollActiveThumbnailIntoView(nextIdx);
    if (slides[nextIdx]?.type === 'image') {
      this.activeBannerUrl.set(slides[nextIdx].url);
    }
  }

  nextMediaSlide(event?: Event): void {
    if (event) event.stopPropagation();
    const slides = this.mediaSlides();
    if (slides.length <= 1) return;
    this.isVideoPlaying.set(false);
    const nextIdx = (this.mediaCarouselIndex() + 1) % slides.length;
    this.mediaCarouselIndex.set(nextIdx);
    this.scrollActiveThumbnailIntoView(nextIdx);
    if (slides[nextIdx]?.type === 'image') {
      this.activeBannerUrl.set(slides[nextIdx].url);
    }
  }

  goToMediaSlide(idx: number, event?: Event): void {
    if (event) event.stopPropagation();
    const slides = this.mediaSlides();
    if (idx < 0 || idx >= slides.length) return;
    if (idx !== this.mediaCarouselIndex()) {
      this.isVideoPlaying.set(false);
    }
    this.mediaCarouselIndex.set(idx);
    this.scrollActiveThumbnailIntoView(idx);
    if (slides[idx]?.type === 'image') {
      this.activeBannerUrl.set(slides[idx].url);
    }
  }

  openLightbox(imageUrl: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!imageUrl) return;
    this.lightboxImageUrl.set(imageUrl);
    this.isLightboxZoomed.set(false);
  }

  closeLightbox(event?: Event): void {
    if (event) event.stopPropagation();
    this.lightboxImageUrl.set(null);
    this.isLightboxZoomed.set(false);
  }

  toggleLightboxZoom(event?: Event): void {
    if (event) event.stopPropagation();
    this.isLightboxZoomed.update(v => !v);
  }

  prevLightboxImage(event?: Event): void {
    if (event) event.stopPropagation();
    const shots = this.activeScreenshots();
    const current = this.lightboxImageUrl();
    if (shots.length <= 1 || !current) return;
    const idx = shots.indexOf(current);
    const prevIdx = ((idx >= 0 ? idx : 0) - 1 + shots.length) % shots.length;
    const nextShot = shots[prevIdx];
    this.lightboxImageUrl.set(nextShot);
    this.isLightboxZoomed.set(false);
    const slideIdx = this.mediaSlides().findIndex(s => s.url === nextShot);
    if (slideIdx >= 0) {
      this.mediaCarouselIndex.set(slideIdx);
      this.scrollActiveThumbnailIntoView(slideIdx);
    }
  }

  nextLightboxImage(event?: Event): void {
    if (event) event.stopPropagation();
    const shots = this.activeScreenshots();
    const current = this.lightboxImageUrl();
    if (shots.length <= 1 || !current) return;
    const idx = shots.indexOf(current);
    const nextIdx = ((idx >= 0 ? idx : 0) + 1) % shots.length;
    const nextShot = shots[nextIdx];
    this.lightboxImageUrl.set(nextShot);
    this.isLightboxZoomed.set(false);
    const slideIdx = this.mediaSlides().findIndex(s => s.url === nextShot);
    if (slideIdx >= 0) {
      this.mediaCarouselIndex.set(slideIdx);
      this.scrollActiveThumbnailIntoView(slideIdx);
    }
  }

  onMediaTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    this.mediaTouchStartX = touch.clientX;
    this.mediaTouchStartY = touch.clientY;
  }

  onMediaTouchEnd(event: TouchEvent): void {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - this.mediaTouchStartX;
    const dy = touch.clientY - this.mediaTouchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        this.nextMediaSlide();
      } else {
        this.prevMediaSlide();
      }
    }
  }

  onLightboxTouchStart(event: TouchEvent): void {
    if (this.isLightboxZoomed()) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    this.lightboxTouchStartX = touch.clientX;
    this.lightboxTouchStartY = touch.clientY;
  }

  onLightboxTouchEnd(event: TouchEvent): void {
    if (this.isLightboxZoomed()) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - this.lightboxTouchStartX;
    const dy = touch.clientY - this.lightboxTouchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        this.nextLightboxImage();
      } else {
        this.prevLightboxImage();
      }
    }
  }

  copyTechnicalId(): void {
    const pkg = this.packageService.activePackage() || this.package;
    const techId = pkg?.name || '';
    if (!techId) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(techId).catch(() => {});
    }
    this.copiedTechId.set(true);
    setTimeout(() => this.copiedTechId.set(false), 2000);
  }

  openEditTags(): void {
    if (!this.canModerate()) return;
    const pkg = this.packageService.activePackage() || this.package;
    const systemTagSet = new Set(['git', 'github', 'codeberg', 'gitlab', 'contentdb', 'mod', 'game', 'txp', 'modpack']);
    const currentCustom = (Array.isArray(pkg?.tags) ? pkg.tags : [])
      .map(t => String(t).toLowerCase())
      .filter(t => Boolean(t) && !systemTagSet.has(t));
    this.editableTags.set(currentCustom.slice(0, 5));
    this.isEditingTags.set(true);
  }

  cancelEditTags(): void {
    this.isEditingTags.set(false);
  }

  isEditableTagSelected(tagName: string): boolean {
    return this.editableTags().includes(tagName.toLowerCase());
  }

  toggleEditableTag(tagName: string): void {
    const normalized = tagName.toLowerCase();
    const current = this.editableTags();
    if (current.includes(normalized)) {
      this.editableTags.set(current.filter(t => t !== normalized));
    } else if (current.length < 5) {
      this.editableTags.set([...current, normalized]);
    }
  }

  async onSaveTags(): Promise<void> {
    if (!this.canModerate()) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;
    this.isSavingTags.set(true);
    const res = await this.packageService.updatePackageTags(pkg, this.editableTags());
    this.isSavingTags.set(false);
    if (res.success) {
      if (res.tags) {
        this.package = { ...this.package, tags: res.tags };
      }
      this.isEditingTags.set(false);
      this.pwaService.showToast('Package tags updated!');
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  onOpenPackageAnalytics(): void {
    if (!this.canModerate()) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;
    const resolvedAuthor =
      pkg.author ||
      (pkg as any).author_name ||
      (typeof pkg.id === 'string' && pkg.id.includes('/') ? pkg.id.split('/')[0] : '');
    if (!resolvedAuthor || !pkg.name) return;
    this.packageService.openAnalyticsPage({
      author: resolvedAuthor,
      name: pkg.name
    });
  }

  getReleaseNotesKey(rel: PackageRelease, pageIdx: number): string {
    return String(rel.id || `${rel.version || 'rel'}-${pageIdx}`);
  }

  isReleaseNotesExpanded(key: string): boolean {
    return this.expandedReleaseKeys().has(key);
  }

  getReleaseNotesPayload(key: string): ReleaseNotesPayload | undefined {
    return this.releaseNotesByKey().get(key);
  }

  async toggleBranchFallbackNotes(): Promise<void> {
    const key = 'branch-fallback';
    const nextExpanded = new Set(this.expandedReleaseKeys());
    if (nextExpanded.has(key)) {
      nextExpanded.delete(key);
      this.expandedReleaseKeys.set(nextExpanded);
      return;
    }
    nextExpanded.add(key);
    this.expandedReleaseKeys.set(nextExpanded);

    if (this.releaseNotesByKey().has(key)) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;

    this.loadingReleaseNotesKey.set(key);
    const headRef = pkg.default_branch || 'main';
    const payload = await this.packageService.fetchReleaseNotesForRelease(pkg, headRef, undefined);
    if (this.loadingReleaseNotesKey() === key) {
      this.loadingReleaseNotesKey.set(null);
    }
    if (payload) {
      const nextMap = new Map(this.releaseNotesByKey());
      nextMap.set(key, payload);
      this.releaseNotesByKey.set(nextMap);
    }
  }

  async toggleReleaseNotes(rel: PackageRelease, pageIdx: number): Promise<void> {
    const key = this.getReleaseNotesKey(rel, pageIdx);
    const nextExpanded = new Set(this.expandedReleaseKeys());
    if (nextExpanded.has(key)) {
      nextExpanded.delete(key);
      this.expandedReleaseKeys.set(nextExpanded);
      return;
    }
    nextExpanded.add(key);
    this.expandedReleaseKeys.set(nextExpanded);

    if (this.releaseNotesByKey().has(key)) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;

    const allCapped = this.cappedReleases();
    const globalIdx = (this.releasesPage() - 1) * this.RELEASES_PAGE_SIZE + pageIdx;
    const olderRelease = globalIdx >= 0 && globalIdx + 1 < allCapped.length ? allCapped[globalIdx + 1] : undefined;

    const extractRef = (r?: PackageRelease): string | undefined => {
      if (!r) return undefined;
      if (r.commit_sha && r.commit_sha !== 'HEAD') return r.commit_sha;
      const ver = (r.version || '').trim();
      if (!ver || ver.toLowerCase().startsWith('branch')) return undefined;
      return ver.split(/\s+/)[0];
    };

    const headRef = extractRef(rel) || pkg.default_branch || 'main';
    const baseRef = extractRef(olderRelease);

    this.loadingReleaseNotesKey.set(key);
    const payload = await this.packageService.fetchReleaseNotesForRelease(pkg, headRef, baseRef);
    if (this.loadingReleaseNotesKey() === key) {
      this.loadingReleaseNotesKey.set(null);
    }
    if (payload) {
      const nextMap = new Map(this.releaseNotesByKey());
      nextMap.set(key, payload);
      this.releaseNotesByKey.set(nextMap);
    }
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
    const pkg = this.packageService.activePackage() || this.package;
    this.packageService.closePackageModal(false);
    this.packageService.openSetupModal(true, pkg);
  }

  openSignInForReview(): void {
    this.authService.openAuthModal(true);
  }

  onFavoriteClick(): void {
    this.settingsService.toggleFavorite(this.package.id);
  }

  filterByTerm(term: string): void {
    this.packageService.searchByTermFromModal(term);
  }

  openAuthorProfile(username: string): void {
    this.packageService.openAuthorDrawer(username, true, this.package);
  }

  filterByTag(tag: string): void {
    this.packageService.filterByTagFromModal(tag);
  }

  copyRegistryUrl(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(this.settingsService.contentDbUrl());
      this.copiedUrl.set(true);
      setTimeout(() => this.copiedUrl.set(false), 2000);
    }
  }

  toggleConfLocations(): void {
    this.showConfLocations.update(v => !v);
  }

  copyRegistryConfig(): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(`contentdb_url = ${this.settingsService.contentDbUrl()}`);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  async onSubmitReview(): Promise<void> {
    if (this.isPackageAuthor() || !this.reviewComment.trim()) return;

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
          username: res.review.author?.username || this.authService.currentUser()?.username || 'user',
          display_name: res.review.author?.display_name || this.authService.currentUser()?.display_name,
          avatar_url: res.review.author?.avatar_url || this.authService.currentUser()?.avatar_url || 'logo.svg'
        }
      };
      const existingFiltered = this.reviews().filter(
        r => r.id !== newReview.id && r.author.username.toLowerCase() !== newReview.author.username.toLowerCase()
      );
      const updatedList = [newReview, ...existingFiltered];
      this.reviews.set(updatedList);
      this.packageService.applyReviewAverageToPackage(this.package, updatedList);
      this.reviewTitle = '';
      this.reviewComment = '';
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  isOwnReview(rev: CommunityReview): boolean {
    const user = this.authService.currentUser();
    if (!user || !rev?.author?.username) return false;
    const revAuthor = rev.author.username.toLowerCase();
    if (user.username && user.username.toLowerCase() === revAuthor) return true;
    return (user.identities || []).some(id => (id.username || '').toLowerCase() === revAuthor);
  }

  canDeleteReview(rev: CommunityReview): boolean {
    if (!rev || rev.source === 'contentdb') return false;
    if (this.authService.isAdmin()) return true;
    return this.isOwnReview(rev);
  }

  toggleFlagReviewPrompt(reviewId: string): void {
    if (this.flaggingReviewId() === reviewId) {
      this.flaggingReviewId.set(null);
      this.flagReviewReason = '';
    } else {
      this.flaggingReviewId.set(reviewId);
      this.flagReviewReason = '';
    }
  }

  async onConfirmFlagReview(rev: CommunityReview): Promise<void> {
    this.isSubmittingReviewFlag.set(true);
    const res = await this.packageService.flagReview(this.package, rev.id, this.flagReviewReason);
    this.isSubmittingReviewFlag.set(false);
    if (res.success) {
      const nextSet = new Set(this.flaggedReviewIds());
      nextSet.add(rev.id);
      this.flaggedReviewIds.set(nextSet);
      this.flaggingReviewId.set(null);
      this.flagReviewReason = '';
      this.pwaService.showToast(res.message || 'Review flagged for moderation.');
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  async onDeleteReview(rev: CommunityReview): Promise<void> {
    if (!this.canDeleteReview(rev)) return;
    this.deletingReviewId.set(rev.id);
    const res = await this.packageService.deleteReview(this.package, rev.id);
    this.deletingReviewId.set(null);
    if (res.success) {
      const updatedList = this.reviews().filter(r => r.id !== rev.id);
      this.reviews.set(updatedList);
      this.packageService.applyReviewAverageToPackage(this.package, updatedList);
      this.pwaService.showToast(res.message || 'Review removed.');
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  toggleReportForm(): void {
    const next = !this.isReportOpen();
    this.isReportOpen.set(next);
    if (next) {
      this.isConfirmingRemove.set(false);
    }
  }

  toggleConfirmRemove(): void {
    if (!this.canModerate()) return;
    const next = !this.isConfirmingRemove();
    this.isConfirmingRemove.set(next);
    if (next) {
      this.isReportOpen.set(false);
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

  async onKillSwitch(action: 'delist' | 'flag' | 'restore' | 'remove'): Promise<void> {
    if (!this.canModerate()) return;
    if ((action === 'delist' || action === 'flag' || action === 'restore') && !this.authService.isAdmin()) {
      return;
    }
    this.isModerating.set(true);
    this.isConfirmingRemove.set(false);
    await this.packageService.moderatePackage(this.package, action, `Executed ${action} from Package Detail Modal`);
    this.isModerating.set(false);
  }
}

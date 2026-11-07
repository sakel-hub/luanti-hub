import {
  Component,
  ChangeDetectionStrategy,
  Input,
  ViewChild,
  ElementRef,
  NgZone,
  inject,
  signal,
  computed,
  effect,
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
import {
  LuantiPackage,
  CommunityReview,
  PackageRelease,
  ReleaseNotesPayload,
  PackageModalFocusRequest
} from '../../core/models/package.model';
import {
  formatContentDbCdnUrl,
  isContentDbThumbnailUrl,
  upgradeContentDbThumbnailUrl
} from '../../core/config/git-providers.config';
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
import { BackToTopComponent } from '../../shared/components/back-to-top.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ThemeIconComponent } from '../../shared/components/theme-icon.component';
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
  LucideTrendingUp,
  LucideRefreshCw,
  LucidePlay,
  LucideMaximize2,
  LucideZoomIn,
  LucideZoomOut
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
    BackToTopComponent,
    TranslatePipe,
    ThemeIconComponent,
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
    LucideTrendingUp,
    LucideRefreshCw,
    LucidePlay,
    LucideMaximize2,
    LucideZoomIn,
    LucideZoomOut
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
            class="overflow-y-auto flex-1 flex flex-col luanti-modal-scroll">

            <!-- Admin-Only Package Moderation Bar (Delist, Restore & Safe Permanent Removal) -->
            @if (authService.isAdmin()) {
              <div
                [class]="isPackageDelisted() ? 'bg-amber-950/85 border-amber-500/30 text-amber-200' : 'bg-rose-950/85 border-rose-500/30 text-rose-200'"
                class="px-5 py-2.5 border-b flex flex-col gap-2 text-xs flex-shrink-0">
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
              [src]="modalHeaderBannerUrl"
              [fallbackThumbnail]="fallbackBannerThumbnail"
              (load)="onScreenshotLoad($event)"
              (error)="onScreenshotError(undefined, $event)"
              appImgFallback
              [alt]="package.title"
              decoding="async"
              class="w-full h-full object-cover object-center"
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
                {{ packageService.getLocalizedPackageText(package).title || package.title }}
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

                <!-- Report / Flag Button (Hidden for the package's own author) -->
                @if (!isPackageAuthor()) {
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
                }

                <!-- Package Analytics Button (Public, matching ContentDB) -->
                <button
                  type="button"
                  (click)="onOpenPackageAnalytics()"
                  [appTooltip]="'modal.viewAnalyticsTooltip' | translate"
                  [attr.aria-label]="'modal.viewAnalyticsTooltip' | translate"
                  class="w-10 sm:w-11 h-10 sm:h-11 rounded-full glass-icon-btn-sky text-sky-200/90 hover:text-sky-300 flex items-center justify-center transition hover:scale-105 cursor-pointer">
                  <svg lucideTrendingUp class="w-4 h-4"></svg>
                </button>

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
            <div class="mx-5 sm:mx-8 mt-5 p-4 rounded-2xl bg-rose-950/60 border border-rose-500/35 flex items-center justify-between gap-3 flex-wrap text-xs luanti-tab-enter">
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
          @if (isReportOpen() && !isPackageAuthor()) {
            <form (ngSubmit)="onSubmitReport()" class="mx-5 sm:mx-8 mt-5 p-4 rounded-2xl bg-rose-950/55 border border-rose-500/30 space-y-3 text-xs luanti-tab-enter">
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
          <div class="p-6 sm:p-8 lg:p-10 pb-16 sm:pb-20 lg:pb-20 space-y-7">

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-10">

              <!-- Left Column: Screenshots, Synopsis, Dependencies, Collapsible README & 1-Click Setup -->
              <div class="lg:col-span-2 space-y-6">

                <!-- Metrics Bar -->
                <div class="flex items-center gap-3 text-xs sm:text-sm flex-wrap">
                  <span
                    class="text-emerald-400 font-bold cursor-help"
                    [appTooltip]="'card.matchTooltip' | translate">
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
                  } @else if (isHydratingDetails()) {
                    <span class="w-24 h-5 rounded glass-pill skeleton-shimmer inline-block" aria-hidden="true"></span>
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

                <!-- LuantiHub-First Author Metadata & Tags Editor (Placed above Screenshots & Media for wider layout) -->
                @if (canModerate()) {
                  <div>
                    @if (!isEditingTags()) {
                      <button
                        type="button"
                        (click)="openEditTags()"
                        class="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1.5 transition cursor-pointer">
                        <svg lucideTag class="w-3.5 h-3.5"></svg>
                        <span>Edit Metadata &amp; Tags</span>
                      </button>
                    } @else {
                      <div class="p-4 sm:p-5 rounded-2xl bg-slate-950/90 border border-sky-500/30 space-y-4 text-xs luanti-tab-enter">
                        <div class="flex items-center justify-between border-b border-white/10 pb-2.5">
                          <h3 class="font-bold text-sky-300 flex items-center gap-1.5 text-xs uppercase tracking-wider">
                            <svg lucideTag class="w-3.5 h-3.5 text-sky-400"></svg>
                            <span>Edit Metadata &amp; Tags</span>
                          </h3>
                          <button
                            type="button"
                            (click)="cancelEditTags()"
                            class="text-slate-400 hover:text-white transition cursor-pointer">
                            <svg lucideX class="w-4 h-4"></svg>
                          </button>
                        </div>

                        <!-- 1. Tags (up to 5) -->
                        <div class="space-y-1.5">
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
                          <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
                            @for (t of packageService.availableTags(); track t.name) {
                              <button
                                type="button"
                                (click)="toggleEditableTag(t.name)"
                                [class]="isEditableTagSelected(t.name) ? 'bg-sky-500/25 text-sky-300 border-sky-400/60' : 'glass-pill text-slate-300 hover:text-white'"
                                class="px-2.5 py-1 rounded-full border text-[11px] font-medium transition cursor-pointer">
                                #{{ t.title }}
                              </button>
                            }
                          </div>
                        </div>

                        <!-- 2. Development Status & Engine Versions -->
                        <div class="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                              Development Status
                            </label>
                            <select
                              [ngModel]="editableDevState()"
                              (ngModelChange)="editableDevState.set($event)"
                              class="w-full glass-input rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none">
                              <option value="" class="bg-slate-900">Auto / Default</option>
                              @for (ds of packageService.availableDevStates(); track ds.code) {
                                <option [value]="ds.code" class="bg-slate-900">{{ ds.label }}</option>
                              }
                            </select>
                          </div>

                          <div>
                            <label class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                              Min Engine
                            </label>
                            <select
                              [ngModel]="editableMinEngineVersion()"
                              (ngModelChange)="editableMinEngineVersion.set($event)"
                              class="w-full glass-input rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none">
                              <option value="" class="bg-slate-900">Any</option>
                              @for (ev of packageService.availableEngineVersions(); track ev.name) {
                                <option [value]="ev.name" class="bg-slate-900">{{ ev.label }}</option>
                              }
                            </select>
                          </div>

                          <div>
                            <label class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                              Max Engine
                            </label>
                            <select
                              [ngModel]="editableMaxEngineVersion()"
                              (ngModelChange)="editableMaxEngineVersion.set($event)"
                              class="w-full glass-input rounded-lg px-2.5 py-1.5 text-[11px] text-white focus:outline-none">
                              <option value="" class="bg-slate-900">Latest</option>
                              @for (ev of packageService.availableEngineVersions(); track ev.name) {
                                <option [value]="ev.name" class="bg-slate-900">{{ ev.label }}</option>
                              }
                            </select>
                          </div>
                        </div>

                        <!-- 3. Game Support (Universal + Compatible / Incompatible Games) -->
                        <div class="pt-3 border-t border-white/10 space-y-2">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                              Game Support (Click to cycle ✓ / ✕)
                            </span>
                            <label class="inline-flex items-center gap-1.5 text-[10px] text-emerald-300 font-semibold cursor-pointer">
                              <input
                                type="checkbox"
                                [checked]="editableSupportsAllGames()"
                                (change)="editableSupportsAllGames.set(!editableSupportsAllGames())"
                                class="rounded border-white/20 bg-slate-900 text-emerald-500" />
                              <span>All Games</span>
                            </label>
                          </div>
                          <div class="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                            @for (g of packageService.availableGames(); track g.name) {
                              <button
                                type="button"
                                (click)="cycleEditableGameSupport(g)"
                                [class]="getEditableGameState(g.name) === 'compatible'
                                  ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/60'
                                  : getEditableGameState(g.name) === 'incompatible'
                                    ? 'bg-rose-500/25 text-rose-300 border-rose-400/60'
                                    : 'glass-pill text-slate-400 hover:text-white'"
                                class="px-2.5 py-1 rounded-full border text-[11px] font-medium transition cursor-pointer">
                                @if (getEditableGameState(g.name) === 'compatible') { ✓ }
                                @if (getEditableGameState(g.name) === 'incompatible') { ✕ }
                                {{ g.title }}
                              </button>
                            }
                          </div>
                        </div>

                        <!-- 4. Content Warnings -->
                        <div class="pt-3 border-t border-white/10 space-y-2">
                          <span class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Content Warnings
                          </span>
                          <div class="flex flex-wrap gap-1.5">
                            @for (cw of packageService.availableContentWarnings(); track cw.name) {
                              <button
                                type="button"
                                (click)="toggleEditableContentWarning(cw.name)"
                                [class]="isEditableContentWarningSelected(cw.name) ? 'bg-amber-500/25 text-amber-300 border-amber-400/60' : 'glass-pill text-slate-400 hover:text-white'"
                                class="px-2.5 py-1 rounded-full border text-[11px] font-medium transition cursor-pointer">
                                {{ cw.title }}
                              </button>
                            }
                          </div>
                        </div>

                        <!-- 5. Multi-Language Translations (Title & Short Description) -->
                        <div class="pt-3 border-t border-white/10 space-y-2">
                          <div class="flex items-center justify-between gap-2">
                            <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                              Localized Text
                            </span>
                            <select
                              [ngModel]="editableTranslationLang()"
                              (ngModelChange)="onChangeEditableTranslationLang($event)"
                              class="glass-input rounded px-2 py-1 text-[11px] text-white focus:outline-none">
                              <option value="de" class="bg-slate-900">Deutsch (de)</option>
                              <option value="fr" class="bg-slate-900">Français (fr)</option>
                              <option value="es" class="bg-slate-900">Español (es)</option>
                              <option value="it" class="bg-slate-900">Italiano (it)</option>
                              <option value="pt" class="bg-slate-900">Português (pt)</option>
                              <option value="pl" class="bg-slate-900">Polski (pl)</option>
                              <option value="ru" class="bg-slate-900">Русский (ru)</option>
                              <option value="uk" class="bg-slate-900">Українська (uk)</option>
                              <option value="sk" class="bg-slate-900">Slovenčina (sk)</option>
                              <option value="cs" class="bg-slate-900">Čeština (cs)</option>
                              <option value="ja" class="bg-slate-900">日本語 (ja)</option>
                              <option value="zh_CN" class="bg-slate-900">中文 (zh_CN)</option>
                            </select>
                          </div>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <input
                              type="text"
                              [ngModel]="editableTranslatedTitle()"
                              (ngModelChange)="editableTranslatedTitle.set($event)"
                              [placeholder]="'Localized title (' + editableTranslationLang() + ')...'"
                              class="w-full glass-input rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none" />
                            <input
                              type="text"
                              [ngModel]="editableTranslatedShortDesc()"
                              (ngModelChange)="editableTranslatedShortDesc.set($event)"
                              [placeholder]="'Localized summary (' + editableTranslationLang() + ')...'"
                              class="w-full glass-input rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none" />
                          </div>
                        </div>

                        <div class="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
                          <button
                            type="button"
                            (click)="cancelEditTags()"
                            class="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white transition cursor-pointer">
                            Cancel
                          </button>
                          <button
                            type="button"
                            [disabled]="isSavingTags()"
                            (click)="onSaveTags()"
                            class="px-3.5 py-1.5 rounded-lg glass-btn-sky text-white font-bold text-[11px] disabled:opacity-50 transition cursor-pointer">
                            {{ isSavingTags() ? 'Saving...' : 'Save Metadata' }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }

                <!-- Media & Screenshots Carousel (Placed above Description, with Skeleton Preloader) -->
                @if (mediaSlides().length > 0) {
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <svg lucideImage class="w-3.5 h-3.5 text-sky-400"></svg>
                        <span>{{ 'modal.screenshots' | translate }} ({{ mediaSlides().length }})</span>
                      </h3>
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
                            [attr.aria-hidden]="idx !== mediaCarouselIndex()"
                            [attr.inert]="idx !== mediaCarouselIndex() ? '' : null">
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
                                    decoding="async"
                                    class="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                                  />
                                  <div class="absolute inset-0 bg-slate-950/35 group-hover:bg-slate-950/20 transition-colors flex items-center justify-center">
                                    <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl glass-btn text-slate-100 group-hover:text-white flex items-center justify-center shadow-2xl group-hover:scale-105 active:scale-95 transition-all duration-300">
                                      <svg lucidePlay class="w-6 h-6 sm:w-7 sm:h-7 ml-0.5 text-sky-300 group-hover:text-white fill-current transition-colors"></svg>
                                    </div>
                                  </div>
                                  <span class="absolute top-3 left-3 px-3 py-1.5 rounded-xl glass-btn text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 pointer-events-none">
                                    <svg lucidePlay class="w-3 h-3 text-sky-400 fill-current"></svg>
                                    <span>{{ 'modal.videoPreview' | translate }}</span>
                                  </span>
                                  <button
                                    type="button"
                                    (click)="enlargeModalVideo($event)"
                                    [appTooltip]="'card.enlargeVideo' | translate"
                                    [attr.aria-label]="'card.enlargeVideo' | translate"
                                    class="absolute top-3 right-3 p-2 rounded-xl glass-btn text-slate-200 hover:text-white opacity-85 group-hover:opacity-100 transition cursor-pointer z-20">
                                    <svg lucideMaximize2 class="w-4 h-4"></svg>
                                  </button>
                                </div>
                              }
                            } @else {
                              <div
                                (click)="openLightbox(slide.url)"
                                class="relative w-full h-full cursor-zoom-in group">
                                <img
                                  [src]="getSlideDisplayUrl(slide.url)"
                                  (load)="onScreenshotLoad($event, slide.url)"
                                  (error)="onScreenshotError(slide.url)"
                                  [alt]="package.title + ' screenshot ' + (idx + 1)"
                                  [attr.loading]="idx <= mediaCarouselIndex() + 2 ? 'eager' : 'lazy'"
                                  decoding="async"
                                  class="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-500"
                                />
                                <button
                                  type="button"
                                  (click)="openLightbox(slide.url, $event)"
                                  [appTooltip]="'modal.enlargeImage' | translate"
                                  [attr.aria-label]="'modal.enlargeImage' | translate"
                                  class="absolute top-3 right-3 p-2 rounded-xl glass-btn text-slate-200 hover:text-white opacity-85 group-hover:opacity-100 transition cursor-pointer z-20">
                                  <svg lucideMaximize2 class="w-4 h-4"></svg>
                                </button>
                                @if (slide.caption) {
                                  <div class="absolute bottom-11 left-3 right-3 sm:right-auto sm:max-w-[75%] px-3 py-1 rounded-xl bg-slate-950/80 backdrop-blur-md border border-white/10 text-[11px] font-medium text-slate-200 truncate pointer-events-none z-20">
                                    {{ slide.caption }}
                                  </div>
                                }
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

                        <!-- Frosted Pill Indicator Dock (Sliding 9-Dot Window with Tapered Edge Dots for Large Galleries) -->
                        <div class="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-full glass-pill max-w-[calc(100%-7.5rem)]">
                          @for (dot of visibleMediaDots(); track dot.index) {
                            <button
                              type="button"
                              (click)="goToMediaSlide(dot.index, $event)"
                              [attr.aria-label]="'Go to media slide ' + (dot.index + 1)"
                              class="rounded-full transition-all duration-300 ease-out overflow-hidden flex-shrink-0 cursor-pointer"
                              [class.w-6]="dot.index === mediaCarouselIndex()"
                              [class.bg-sky-400]="dot.index === mediaCarouselIndex()"
                              [class.shadow-\[0_0_8px_rgba\(56\,189\,248\,0\.6\)\]]="dot.index === mediaCarouselIndex()"
                              [class.w-2]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'normal'"
                              [class.bg-white/40]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'normal'"
                              [class.w-1.5]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'sm'"
                              [class.bg-white/25]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'sm'"
                              [class.w-1]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'xs'"
                              [class.bg-white/15]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'xs'"
                              [class.h-1.5]="dot.index === mediaCarouselIndex() || dot.edgeScale !== 'xs'"
                              [class.h-1]="dot.index !== mediaCarouselIndex() && dot.edgeScale === 'xs'"
                              [class.hover:bg-white/60]="dot.index !== mediaCarouselIndex()">
                            </button>
                          }
                          @if (mediaSlides().length > MAX_VISIBLE_DOTS) {
                            <span class="pl-1 ml-0.5 border-l border-white/15 text-[10px] font-mono font-semibold text-slate-300 leading-none whitespace-nowrap select-none">
                              {{ mediaCarouselIndex() + 1 }}/{{ mediaSlides().length }}
                            </span>
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
                            <img
                              [src]="slide.thumbnail"
                              [alt]="package.title"
                              (load)="slide.type === 'image' ? onScreenshotLoad($event, slide.url) : null"
                              (error)="slide.type === 'image' ? onScreenshotError(slide.url) : null"
                              [attr.loading]="idx < 8 ? 'eager' : 'lazy'"
                              decoding="async"
                              class="w-full h-full object-cover" />
                            @if (slide.type === 'video') {
                              <div class="absolute inset-0 bg-slate-950/35 flex items-center justify-center">
                                <div class="w-7 h-7 rounded-lg glass-btn flex items-center justify-center text-slate-100">
                                  <svg lucidePlay class="w-3.5 h-3.5 ml-0.5 text-sky-300 fill-current"></svg>
                                </div>
                              </div>
                            }
                          </button>
                        }
                      </div>
                    }
                  </div>
                } @else if (isHydratingDetails()) {
                  <!-- Screenshots Skeleton Preloader -->
                  <div class="space-y-3" aria-busy="true" aria-label="Loading screenshots">
                    <div class="flex items-center justify-between">
                      <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <svg lucideImage class="w-3.5 h-3.5 text-sky-400"></svg>
                        <span>{{ 'modal.screenshots' | translate }}</span>
                      </h3>
                    </div>
                    <div class="w-full aspect-video rounded-2xl skeleton-shimmer border border-white/10 shadow-xl"></div>
                    <div class="flex items-center gap-3 overflow-hidden p-1 -mx-1">
                      <div class="w-24 h-14 sm:w-28 sm:h-16 rounded-xl skeleton-shimmer flex-shrink-0 border border-white/10"></div>
                      <div class="w-24 h-14 sm:w-28 sm:h-16 rounded-xl skeleton-shimmer flex-shrink-0 border border-white/10"></div>
                      <div class="w-24 h-14 sm:w-28 sm:h-16 rounded-xl skeleton-shimmer flex-shrink-0 border border-white/10"></div>
                    </div>
                  </div>
                }

                <!-- Markdown Description / Synopsis (Placed below Screenshots, with Skeleton Preloader before long_description arrives) -->
                @if (isHydratingDetails() && !package.desc) {
                  <div class="p-5 rounded-2xl glass-panel space-y-2.5" aria-busy="true" aria-label="Loading package description">
                    <div class="w-1/3 h-4 rounded skeleton-shimmer"></div>
                    <div class="w-full h-3.5 rounded skeleton-shimmer"></div>
                    <div class="w-11/12 h-3.5 rounded skeleton-shimmer"></div>
                    <div class="w-4/5 h-3.5 rounded skeleton-shimmer"></div>
                  </div>
                } @else if (renderedDescription(); as descHtml) {
                  <div
                    class="luanti-markdown text-slate-200 text-sm sm:text-base leading-relaxed space-y-3 break-words"
                    [innerHTML]="descHtml">
                  </div>
                }

                <!-- Dependencies & Provided Mods Section (Collapsible, collapsed by default when > 20 items) -->
                <div class="space-y-3 p-4 rounded-2xl glass-panel" data-testid="package-dependencies-section">
                  @if (getTotalDependenciesCount(package) > 0) {
                    <button
                      type="button"
                      data-testid="toggle-dependencies-btn"
                      (click)="toggleDependencies()"
                      [attr.aria-expanded]="isDependenciesExpanded()"
                      class="w-full flex items-center justify-between gap-2 text-left group cursor-pointer">
                      <div class="flex items-center gap-2 min-w-0">
                        <h3 class="text-xs font-bold text-slate-200 group-hover:text-sky-300 uppercase tracking-wider truncate transition">
                          {{ 'modal.dependencies' | translate }}
                        </h3>
                        <span class="px-2 py-0.5 rounded-md glass-pill text-[10px] font-semibold text-slate-300 flex-shrink-0">
                          {{ getTotalDependenciesCount(package) }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 flex-shrink-0">
                        @if (!isDependenciesExpanded()) {
                          <div class="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                            @if (package.dependencies?.length) {
                              <span class="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-400/20">
                                {{ package.dependencies!.length }} req
                              </span>
                            }
                            @if (package.optional_dependencies?.length) {
                              <span class="px-1.5 py-0.5 rounded glass-pill text-slate-300">
                                {{ package.optional_dependencies!.length }} opt
                              </span>
                            }
                            @if (package.provides?.length) {
                              <span class="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                                {{ package.provides!.length }} sub
                              </span>
                            }
                          </div>
                        }
                        <svg
                          lucideChevronDown
                          class="w-4 h-4 text-slate-400 group-hover:text-sky-300 transition-transform duration-200 flex-shrink-0"
                          [class.rotate-180]="isDependenciesExpanded()">
                        </svg>
                      </div>
                    </button>

                    @if (isDependenciesExpanded()) {
                      <div class="space-y-3 pt-2 border-t border-white/10">
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
                      </div>
                    }
                  } @else if (isHydratingDetails()) {
                    <h3 class="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      {{ 'modal.dependencies' | translate }}
                    </h3>
                    <div class="space-y-2 py-0.5" aria-busy="true" aria-label="Loading dependencies">
                      <div class="w-28 h-3 rounded skeleton-shimmer"></div>
                      <div class="flex flex-wrap gap-1.5">
                        <div class="w-20 h-6 rounded-lg skeleton-shimmer"></div>
                        <div class="w-24 h-6 rounded-lg skeleton-shimmer"></div>
                        <div class="w-16 h-6 rounded-lg skeleton-shimmer"></div>
                      </div>
                    </div>
                  } @else {
                    <h3 class="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      {{ 'modal.dependencies' | translate }}
                    </h3>
                    <p class="text-xs text-slate-400">
                      {{ 'modal.noDependencies' | translate }}
                    </p>
                  }
                </div>

                <!-- Source-Agnostic Reverse Dependencies ("Used By / Ecosystem Add-ons") -->
                @if (reverseDependencies().totalCount > 0) {
                  <div class="space-y-3 p-4 rounded-2xl glass-panel" data-testid="package-reverse-dependencies-section">
                    <button
                      type="button"
                      (click)="toggleReverseDependencies()"
                      [attr.aria-expanded]="isReverseDepsExpanded()"
                      class="w-full flex items-center justify-between gap-2 text-left group cursor-pointer">
                      <div class="flex items-center gap-2 min-w-0">
                        <h3 class="text-xs font-bold text-slate-200 group-hover:text-sky-300 uppercase tracking-wider truncate transition">
                          Used By &amp; Ecosystem Add-ons
                        </h3>
                        <span class="px-2 py-0.5 rounded-md glass-pill text-[10px] font-semibold text-emerald-300 flex-shrink-0">
                          {{ reverseDependencies().totalCount }}
                        </span>
                      </div>
                      <div class="flex items-center gap-2 flex-shrink-0">
                        @if (!isReverseDepsExpanded()) {
                          <div class="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                            @if (reverseDependencies().requiredBy.length > 0) {
                              <span class="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                                {{ reverseDependencies().requiredBy.length }} req
                              </span>
                            }
                            @if (reverseDependencies().optionalFor.length > 0) {
                              <span class="px-1.5 py-0.5 rounded glass-pill text-slate-300">
                                {{ reverseDependencies().optionalFor.length }} opt
                              </span>
                            }
                          </div>
                        }
                        <svg
                          lucideChevronDown
                          class="w-4 h-4 text-slate-400 group-hover:text-sky-300 transition-transform duration-200 flex-shrink-0"
                          [class.rotate-180]="isReverseDepsExpanded()">
                        </svg>
                      </div>
                    </button>

                    @if (isReverseDepsExpanded()) {
                      <div class="space-y-3 pt-2 border-t border-white/10">
                        @if (reverseDependencies().requiredBy.length > 0) {
                          <div>
                            <span class="text-slate-400 font-semibold text-[11px] block mb-1.5">
                              Required By ({{ reverseDependencies().requiredBy.length }})
                            </span>
                            <div class="flex flex-wrap gap-1.5">
                              @for (depPkg of reverseDependencies().requiredBy; track depPkg.id) {
                                <button
                                  type="button"
                                  (click)="packageService.openPackageModal(depPkg, true)"
                                  class="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 hover:text-white text-[11px] font-medium border border-emerald-400/30 flex items-center gap-1.5 transition cursor-pointer">
                                  <span class="truncate max-w-[160px]">{{ depPkg.title }}</span>
                                  <span class="text-[10px] font-mono text-emerald-300/75">({{ depPkg.name }})</span>
                                </button>
                              }
                            </div>
                          </div>
                        }

                        @if (reverseDependencies().optionalFor.length > 0) {
                          <div>
                            <span class="text-slate-400 font-semibold text-[11px] block mb-1.5">
                              Optional Integration In ({{ reverseDependencies().optionalFor.length }})
                            </span>
                            <div class="flex flex-wrap gap-1.5">
                              @for (optPkg of reverseDependencies().optionalFor; track optPkg.id) {
                                <button
                                  type="button"
                                  (click)="packageService.openPackageModal(optPkg, true)"
                                  class="px-2.5 py-1 rounded-lg glass-pill hover:border-sky-400/40 text-slate-300 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer">
                                  <span class="truncate max-w-[160px]">{{ optPkg.title }}</span>
                                  <span class="text-[10px] font-mono text-slate-400">({{ optPkg.name }})</span>
                                </button>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }

                <!-- Collapsible Repository README.md Markdown Section (Collapsed by Default, Fetched on Demand) -->
                @if (hasValidGitRepo || renderedReadme() || isHydratingDetails()) {
                  <div class="p-4 sm:p-5 rounded-2xl glass-panel space-y-3">
                    <div class="flex items-center justify-between gap-2 min-w-0">
                      <button
                        type="button"
                        (click)="toggleReadme()"
                        [attr.aria-expanded]="isReadmeExpanded()"
                        class="flex items-center gap-2 text-left group cursor-pointer flex-1 min-w-0">
                        <svg lucideBookOpen class="w-4 h-4 text-sky-400 flex-shrink-0"></svg>
                        <span class="text-xs font-bold text-sky-400 group-hover:text-sky-300 uppercase tracking-wider truncate transition">
                          {{ 'modal.readmeTitle' | translate }}
                        </span>
                        <span class="hidden sm:inline-flex px-2 py-0.5 rounded-md glass-pill text-[10px] font-semibold text-slate-300 group-hover:text-white flex-shrink-0 transition">
                          {{ isReadmeExpanded() ? 'Hide' : 'Show' }}
                        </span>
                        <svg
                          lucideChevronDown
                          class="w-4 h-4 text-slate-400 group-hover:text-sky-300 transition-transform duration-200 flex-shrink-0"
                          [class.rotate-180]="isReadmeExpanded()">
                        </svg>
                      </button>

                      <a
                        [href]="gitRepoUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        (click)="$event.stopPropagation()"
                        class="text-[11px] font-semibold text-slate-400 hover:text-sky-300 flex items-center gap-1 transition cursor-pointer flex-shrink-0 whitespace-nowrap">
                        <span class="sm:hidden">{{ hasValidGitRepo ? 'Git' : 'ContentDB' }}</span>
                        <span class="hidden sm:inline">{{ (hasValidGitRepo ? 'modal.viewGitRepo' : 'modal.viewOnContentDb') | translate }}</span>
                        <svg lucideExternalLink class="w-3 h-3 flex-shrink-0"></svg>
                      </a>
                    </div>

                    @if (isReadmeExpanded()) {
                      <div class="border-t border-white/10 pt-3">
                        @if (isLoadingReadme()) {
                          <div class="space-y-2.5 py-1" aria-busy="true" aria-label="Loading repository README">
                            <div class="w-2/5 h-4 rounded skeleton-shimmer"></div>
                            <div class="w-full h-3 rounded skeleton-shimmer"></div>
                            <div class="w-11/12 h-3 rounded skeleton-shimmer"></div>
                            <div class="w-4/5 h-3 rounded skeleton-shimmer"></div>
                            <div class="w-3/5 h-3 rounded skeleton-shimmer"></div>
                          </div>
                        } @else if (renderedReadme(); as readmeHtml) {
                          <div
                            class="luanti-markdown text-slate-200 text-sm leading-relaxed max-h-[32rem] overflow-y-auto pr-1.5 break-words"
                            [innerHTML]="readmeHtml">
                          </div>
                        } @else {
                          <p class="text-xs text-slate-400 italic py-1">
                            No README.md file found in the repository.
                          </p>
                        }
                      </div>
                    }
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
                        <p class="text-sky-300 font-medium leading-relaxed flex items-start gap-1.5">
                          <app-theme-icon name="lightbulb" sizeClass="w-3.5 h-3.5 mt-0.5"></app-theme-icon>
                          <span>{{ 'setup.confShortcutTip' | translate }}</span>
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
              <div class="border-t lg:border-t-0 lg:border-l border-white/10 lg:pl-6 pt-4 lg:pt-0">
                <div
                  data-testid="modal-sticky-sidebar"
                  class="lg:sticky lg:top-6 space-y-4 text-xs text-slate-300">

                <!-- Author & Maintainers -->
                <div class="space-y-2">
                  <div>
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.author' | translate }}
                    </span>
                    <div class="flex items-center justify-between gap-2 mt-1">
                      <button
                        type="button"
                        (click)="filterByTerm(packageService.getAuthorDisplayName(package))"
                        class="flex items-center gap-2 group text-left min-w-0 cursor-pointer">
                        <div class="w-6 h-6 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 font-bold text-xs flex-shrink-0">
                          {{ packageService.getAuthorDisplayName(package).charAt(0).toUpperCase() }}
                        </div>
                        <span class="font-bold text-white group-hover:text-sky-400 transition text-sm truncate">{{ packageService.getAuthorDisplayName(package) }}</span>
                      </button>

                      <button
                        type="button"
                        (click)="openAuthorProfile(packageService.getAuthorDisplayName(package))"
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

                <!-- Downloads, Community Score & LuantiHub Favorites Counter -->
                <div
                  [class.grid-cols-2]="package.score > 0 || (package.favorites_count || 0) > 0 || settingsService.isFavorite(package.id)"
                  [class.grid-cols-1]="package.score <= 0 && (package.favorites_count || 0) <= 0 && !settingsService.isFavorite(package.id)"
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
                    @if ((package.favorites_count || 0) > 0 || settingsService.isFavorite(package.id)) {
                      <span class="text-[10px] text-rose-300 font-semibold flex items-center gap-1 mt-1 leading-tight">
                        <svg lucideHeart class="w-2.5 h-2.5 fill-rose-400 text-rose-400"></svg>
                        <span>{{ (package.favorites_count || 1) | compactNumber }} Favorites</span>
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

                <!-- License Information (Only shown when license or media_license is available, with skeleton while hydrating) -->
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
                } @else if (isHydratingDetails()) {
                  <div class="space-y-1.5" aria-busy="true">
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      {{ 'modal.license' | translate }}
                    </span>
                    <div class="w-36 h-4 rounded skeleton-shimmer"></div>
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

                <!-- Supported & Incompatible Games (LuantiHub-First + ContentDB Game Support) -->
                @if (package.supports_all_games || compatibleGames().length > 0 || incompatibleGames().length > 0) {
                  <div class="space-y-2">
                    <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                      Supported Games
                    </span>
                    <div class="flex flex-wrap gap-1.5">
                      @if (package.supports_all_games) {
                        <span class="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 text-[10px] font-semibold flex items-center gap-1">
                          <span>Universal (All Games)</span>
                        </span>
                      }
                      @for (gs of compatibleGames().slice(0, 6); track gs.game.id) {
                        <button
                          type="button"
                          (click)="gs.game.author ? packageService.openPackageModalById(gs.game.author, gs.game.name, true) : packageService.filterByGameFromModal(gs.game.name)"
                          class="px-2 py-1 rounded-lg glass-pill hover:border-sky-400/50 text-slate-200 hover:text-white text-[10px] font-semibold flex items-center gap-1.5 transition cursor-pointer">
                          @if (gs.game.thumbnail) {
                            <img [src]="gs.game.thumbnail" appImgFallback [alt]="gs.game.title" class="w-3.5 h-3.5 rounded object-cover" />
                          }
                          <span class="truncate max-w-[130px]">{{ gs.game.title }}</span>
                        </button>
                      }
                    </div>
                    @if (incompatibleGames().length > 0) {
                      <div class="pt-1 space-y-1">
                        <span class="text-rose-400 font-semibold uppercase tracking-wider block text-[9px]">
                          Incompatible With
                        </span>
                        <div class="flex flex-wrap gap-1.5">
                          @for (gs of incompatibleGames(); track gs.game.id) {
                            <span
                              class="px-2 py-0.5 rounded-lg bg-rose-500/15 border border-rose-400/35 text-rose-300 text-[10px] font-semibold flex items-center gap-1">
                              <span>✕ {{ gs.game.title }}</span>
                            </span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }

                <!-- Content Warnings (When present on LuantiHub D1 / ContentDB) -->
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

                <!-- Tags -->
                @if ((package.tags && package.tags.length > 0) || isHydratingDetails()) {
                  <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-slate-500 font-semibold uppercase tracking-wider block text-[10px]">
                        {{ 'modal.tags' | translate }}
                      </span>
                    </div>

                    @if (isHydratingDetails() && (!package.tags || package.tags.length <= 1)) {
                      <div class="flex flex-wrap gap-1.5" aria-busy="true">
                        <div class="w-14 h-5 rounded-full skeleton-shimmer"></div>
                        <div class="w-20 h-5 rounded-full skeleton-shimmer"></div>
                        <div class="w-16 h-5 rounded-full skeleton-shimmer"></div>
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
            <div #reviewsSectionSentinel class="pt-4 border-t border-white/10">
              <div class="flex items-center gap-5 border-b border-white/10 text-xs font-semibold overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  (click)="onSelectReviewsTab()"
                  [class]="activeTab() === 'reviews' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabReviews' | translate }}@if (!isLoadingReviews() || totalReviewCount() > 0) { ({{ totalReviewCount() }}) }
                </button>
                <button
                  type="button"
                  (click)="activeTab.set('releases')"
                  [class]="activeTab() === 'releases' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabReleases' | translate }}@if (!isLoadingReleases() || cappedReleases().length > 0) { ({{ cappedReleases().length }}) }
                </button>
                <button
                  type="button"
                  (click)="activeTab.set('compliance')"
                  [class]="activeTab() === 'compliance' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap'"
                  class="cursor-pointer">
                  {{ 'modal.tabCompliance' | translate }}
                </button>
                <button
                  type="button"
                  (click)="activeTab.set('analytics')"
                  [class]="activeTab() === 'analytics' ? 'text-sky-400 border-b-2 border-sky-400 py-2.5 font-bold whitespace-nowrap flex items-center gap-1.5' : 'text-slate-400 hover:text-white py-2.5 whitespace-nowrap flex items-center gap-1.5'"
                  class="cursor-pointer">
                  <svg lucideTrendingUp class="w-3.5 h-3.5 text-sky-400"></svg>
                  <span>{{ 'modal.tabAnalytics' | translate }}</span>
                </button>
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

                  @if (isLoadingReviews() && reviews().length === 0) {
                    <div class="space-y-3" aria-busy="true" aria-label="Loading community reviews">
                      @for (placeholder of [1, 2]; track placeholder) {
                        <div class="p-3.5 rounded-2xl glass-panel space-y-2.5">
                          <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-2.5">
                              <div class="w-7 h-7 rounded-xl skeleton-shimmer flex-shrink-0"></div>
                              <div class="w-24 h-3.5 rounded skeleton-shimmer"></div>
                              <div class="w-12 h-3.5 rounded skeleton-shimmer"></div>
                              <div class="w-16 h-4 rounded-md skeleton-shimmer"></div>
                            </div>
                            <div class="w-16 h-3 rounded skeleton-shimmer"></div>
                          </div>
                          <div class="w-1/3 h-3.5 rounded skeleton-shimmer"></div>
                          <div class="space-y-1.5">
                            <div class="w-full h-3 rounded skeleton-shimmer"></div>
                            <div class="w-4/5 h-3 rounded skeleton-shimmer"></div>
                          </div>
                        </div>
                      }
                    </div>
                  } @else if (reviews().length === 0) {
                    <p class="text-xs text-slate-500 text-center py-4">{{ 'modal.noReviews' | translate }}</p>
                  } @else {
                    <!-- Reviews Source Summary Bar (Luanti Hub vs. ContentDB) -->
                    <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950/40 border border-white/10 text-[11px]">
                      <span class="text-slate-400 font-semibold">
                        @if (totalReviewPages() > 1) {
                          Showing <span class="text-white font-bold">{{ reviewsRangeStart() }}–{{ reviewsRangeEnd() }}</span> of <span class="text-white font-bold">{{ reviews().length }}</span> community {{ reviews().length === 1 ? 'review' : 'reviews' }}
                        } @else {
                          Showing <span class="text-white font-bold">{{ reviews().length }}</span> community {{ reviews().length === 1 ? 'review' : 'reviews' }}
                        }
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
                      @for (rev of paginatedReviews(); track rev.id) {
                        <div
                          [attr.data-review-id]="rev.id"
                          [class]="(rev.source === 'contentdb' ? 'border-l-2 border-l-sky-400/60' : 'border-l-2 border-l-emerald-400/60') + (highlightedReviewId() === rev.id ? ' ring-2 ring-sky-400/80 bg-sky-500/10' : '')"
                          class="p-3.5 rounded-2xl glass-panel space-y-2 text-xs transition-all duration-300">
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
                                    class="px-1.5 py-0.5 rounded-md border text-[9px] font-semibold inline-flex items-center gap-1">
                                    <app-theme-icon [name]="rev.is_positive ? 'thumbs-up' : 'thumbs-down'" sizeClass="w-2.5 h-2.5" [useThemeColor]="false"></app-theme-icon>
                                    <span>{{ rev.is_positive ? 'Recommended' : 'Not Recommended' }}</span>
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

                    @if (totalReviewPages() > 1) {
                      <div class="pt-2 flex items-center justify-between gap-3 flex-wrap text-xs" data-testid="reviews-pagination-bar">
                        <span class="text-[11px] text-slate-400 font-medium">
                          {{ 'modal.reviewsShowingRange' | translate:{ start: reviewsRangeStart(), end: reviewsRangeEnd(), total: reviews().length } }}
                        </span>
                        <div class="flex items-center gap-2 ml-auto">
                          <button
                            type="button"
                            (click)="prevReviewsPage()"
                            [disabled]="reviewsPage() <= 1"
                            aria-label="Previous reviews page"
                            class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 disabled:pointer-events-none font-bold text-[11px] flex items-center gap-1 transition cursor-pointer">
                            <svg lucideChevronLeft class="w-3.5 h-3.5"></svg>
                            <span>{{ 'profile.prevPage' | translate }}</span>
                          </button>
                          <span class="px-2.5 py-1 rounded-lg bg-slate-950/60 border border-white/10 text-[11px] font-mono text-slate-300">
                            {{ 'profile.pageLabel' | translate }} {{ reviewsPage() }} / {{ totalReviewPages() }}
                          </span>
                          <button
                            type="button"
                            (click)="nextReviewsPage()"
                            [disabled]="reviewsPage() >= totalReviewPages()"
                            aria-label="Next reviews page"
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

              <!-- Releases Content (Sorted Newest-First, Capped at 10, Paginated 5 per Page) -->
              @if (activeTab() === 'releases') {
                <div class="pt-4 space-y-2.5 luanti-tab-enter">
                  @if (hasValidGitRepo) {
                    <div class="flex items-center justify-between gap-2 pb-1">
                      <span class="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <svg lucideGitBranch class="w-3.5 h-3.5 text-sky-400"></svg>
                        <span>Synced with live Git tags &amp; releases</span>
                      </span>
                      <button
                        type="button"
                        (click)="onSyncGitReleases()"
                        [disabled]="isSyncingReleases() || isLoadingReleases()"
                        class="px-2.5 py-1 rounded-xl glass-pill hover:border-sky-400/50 text-slate-200 hover:text-white disabled:opacity-50 font-semibold text-[11px] flex items-center gap-1.5 transition cursor-pointer">
                        <svg
                          lucideRefreshCw
                          [class]="isSyncingReleases() ? 'w-3 h-3 text-sky-400 animate-spin' : 'w-3 h-3 text-sky-400'">
                        </svg>
                        <span>{{ isSyncingReleases() ? 'Syncing Git tags...' : 'Sync Git Tags' }}</span>
                      </button>
                    </div>
                  }
                  @if (isLoadingReleases() && cappedReleases().length === 0) {
                    <div class="space-y-2.5" aria-busy="true" aria-label="Loading releases">
                      @for (placeholder of [1, 2, 3]; track placeholder) {
                        <div class="p-3.5 rounded-2xl glass-panel flex items-center justify-between gap-3 flex-wrap">
                          <div class="space-y-2 min-w-[180px] flex-1">
                            <div class="flex items-center gap-2">
                              <div class="w-16 h-4 rounded skeleton-shimmer"></div>
                              <div class="w-14 h-4 rounded-md skeleton-shimmer"></div>
                              <div class="w-20 h-4 rounded skeleton-shimmer"></div>
                            </div>
                            <div class="w-28 h-3 rounded skeleton-shimmer"></div>
                          </div>
                          <div class="flex items-center gap-2 ml-auto">
                            <div class="w-36 h-7 rounded-xl skeleton-shimmer"></div>
                            <div class="w-32 h-7 rounded-xl skeleton-shimmer"></div>
                          </div>
                        </div>
                      }
                    </div>
                  } @else if (cappedReleases().length === 0) {
                    <div data-release-idx="branch-fallback" class="p-4 rounded-2xl glass-panel flex flex-col gap-2.5 text-xs">
                      <div class="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <span class="font-bold text-white">Latest Archive ({{ package.default_branch || 'main' }})</span>
                          <span class="block text-[11px] text-slate-400">Ready-to-drop Luanti .zip archive</span>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap">
                          @if (hasValidGitRepo) {
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
                          }
                          <button
                            type="button"
                            (click)="onDownloadClick()"
                            class="px-3.5 py-1.5 rounded-xl glass-btn-primary text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
                            <svg lucideDownload class="w-3.5 h-3.5 text-sky-300"></svg>
                            <span>.zip @if (package.file_size) { ({{ package.file_size }}) }</span>
                          </button>
                        </div>
                      </div>

                      @if (hasValidGitRepo && isReleaseNotesExpanded('branch-fallback')) {
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
                                <span>{{ 'modal.recentBranchCommits' | translate:{ branch: formatRefLabel(payload.head_ref || package.default_branch || 'main') } }}</span>
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
                      <div [attr.data-release-idx]="idx" class="p-3.5 rounded-2xl glass-panel flex flex-col gap-2 text-xs">
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
                                <code
                                  [appTooltip]="'Git Commit: ' + rel.commit_sha"
                                  class="text-[10px] text-sky-400 bg-slate-950/80 px-1.5 py-0.5 rounded font-mono border border-white/10">
                                  {{ rel.commit_sha | slice:0:8 }}
                                </code>
                              }
                              @if (rel.sha256) {
                                <code
                                  [appTooltip]="'SHA-256: ' + rel.sha256"
                                  class="text-[10px] text-emerald-300 bg-emerald-950/50 px-1.5 py-0.5 rounded font-mono border border-emerald-400/25">
                                  sha256:{{ rel.sha256 | slice:0:8 }}
                                </code>
                              }
                              @if (rel.min_minetest_version || rel.max_minetest_version) {
                                <span class="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-slate-300">
                                  @if (rel.min_minetest_version && rel.max_minetest_version && rel.min_minetest_version !== rel.max_minetest_version) {
                                    Engine {{ rel.min_minetest_version }}–{{ rel.max_minetest_version }}
                                  } @else {
                                    Engine {{ rel.min_minetest_version || rel.max_minetest_version }}+
                                  }
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
                            @if (hasValidGitRepo || getCleanReleaseNotes(rel)) {
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
                            }

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

                        @if (getCleanReleaseNotes(rel); as cleanNotes) {
                          @if (!isReleaseNotesExpanded(getReleaseNotesKey(rel, idx))) {
                            <p class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line border-t border-white/10 pt-2 line-clamp-2">
                              {{ cleanNotes }}
                            </p>
                          }
                        }

                        @if (isReleaseNotesExpanded(getReleaseNotesKey(rel, idx))) {
                          <div class="border-t border-white/10 pt-3 mt-1 space-y-2.5">
                            @if (getCleanReleaseNotes(rel); as cleanNotes) {
                              <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/10">
                                <p class="text-[11px] text-slate-200 leading-relaxed whitespace-pre-line">
                                  {{ cleanNotes }}
                                </p>
                              </div>
                            }

                            @if (hasValidGitRepo) {
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
                                      <span>{{ 'modal.commitsBetween' | translate:{ base: formatRefLabel(payload.base_ref), head: formatRefLabel(payload.head_ref) } }}</span>
                                    } @else {
                                      <span>{{ 'modal.recentBranchCommits' | translate:{ branch: formatRefLabel(payload.head_ref || package.default_branch || 'main') } }}</span>
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
                                } @else if (!getCleanReleaseNotes(rel) && payload.markdown_body) {
                                  <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/10">
                                    <p class="text-[11px] text-slate-200 leading-relaxed whitespace-pre-line">
                                      {{ payload.markdown_body }}
                                    </p>
                                  </div>
                                } @else if (!getCleanReleaseNotes(rel)) {
                                  <p class="text-[11px] text-slate-500 italic">{{ 'modal.noReleaseNotesFallback' | translate }}</p>
                                }
                              } @else if (!getCleanReleaseNotes(rel)) {
                                <p class="text-[11px] text-slate-500 italic">{{ 'modal.noReleaseNotesFallback' | translate }}</p>
                              }
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

              <!-- Package Download Analytics Tab -->
              @if (activeTab() === 'analytics') {
                <div class="pt-4 luanti-tab-enter">
                  @defer (on immediate) {
                    <app-download-analytics-chart
                      [package]="package"
                      [showExpandButton]="true">
                    </app-download-analytics-chart>
                  }
                </div>
              }
            </div>

          </div>

          </div>

          <!-- Unobtrusive Frosted-Glass Back-to-Top Button inside Package Detail Dialog (Visible past 100vh) -->
          <app-back-to-top
            position="absolute"
            testId="modal-back-to-top-btn"
            [visible]="showModalBackToTop()"
            (scrollToTop)="scrollModalToTop()">
          </app-back-to-top>

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
              style="top: max(3.5rem, calc(env(titlebar-area-height, 0px) + env(safe-area-inset-top, 0px) + 1rem))"
              class="absolute top-14 sm:top-16 right-4 sm:right-6 z-30 flex items-center gap-2 luanti-wco-no-drag">
              <button
                type="button"
                (click)="toggleLightboxZoom($event)"
                class="px-3.5 py-2 rounded-xl glass-btn text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer">
                @if (isLightboxZoomed()) {
                  <svg lucideZoomOut class="w-4 h-4"></svg>
                } @else {
                  <svg lucideZoomIn class="w-4 h-4"></svg>
                }
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
                [src]="getLightboxDisplayUrl(zoomImg)"
                [alt]="package.title + ' full resolution screenshot'"
                (click)="toggleLightboxZoom($event)"
                [class]="isLightboxZoomed() ? 'max-w-none w-[165%] sm:w-[150%] h-auto object-contain cursor-zoom-out transition-transform duration-300' : 'max-w-full max-h-[84vh] object-contain rounded-xl shadow-2xl cursor-zoom-in transition-transform duration-300'"
              />
              @if (getScreenshotCaption(zoomImg); as lbCaption) {
                <div class="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-white/15 text-xs font-medium text-slate-200 max-w-[85%] truncate pointer-events-none">
                  {{ lbCaption }}
                </div>
              }
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
  private readonly ngZone = inject(NgZone);

  readonly activeTab = signal<'reviews' | 'releases' | 'compliance' | 'analytics'>('reviews');
  readonly reviews = signal<CommunityReview[]>([]);
  readonly isLoadingReviews = signal<boolean>(true);
  readonly luantiHubReviewsCount = computed(() =>
    this.reviews().filter(r => r.source !== 'contentdb').length
  );
  readonly contentDbReviewsCount = computed(() =>
    this.reviews().filter(r => r.source === 'contentdb').length
  );
  readonly releases = signal<PackageRelease[]>([]);
  readonly isLoadingReleases = signal<boolean>(true);
  readonly isReadmeExpanded = signal<boolean>(false);
  readonly isLoadingReadme = signal<boolean>(false);
  readonly dependenciesManualOverride = signal<boolean | null>(null);
  readonly DEPENDENCIES_COLLAPSE_THRESHOLD = 20;

  getTotalDependenciesCount(pkg?: LuantiPackage | null): number {
    const target = pkg ?? this.packageService.activePackage() ?? this.package;
    if (!target) return 0;
    return (
      (target.dependencies?.length ?? 0) +
      (target.optional_dependencies?.length ?? 0) +
      (target.provides?.length ?? 0)
    );
  }

  readonly isDependenciesExpanded = computed<boolean>(() => {
    const manual = this.dependenciesManualOverride();
    if (manual !== null) return manual;
    const pkg = this.packageService.activePackage() ?? this.package;
    return this.getTotalDependenciesCount(pkg) <= this.DEPENDENCIES_COLLAPSE_THRESHOLD;
  });

  toggleDependencies(): void {
    this.dependenciesManualOverride.set(!this.isDependenciesExpanded());
  }

  readonly reverseDepsManualOverride = signal<boolean | null>(null);
  readonly reverseDependencies = computed(() => {
    const pkg = this.packageService.activePackage() ?? this.package;
    return this.packageService.getReverseDependencies(pkg, 24);
  });

  readonly isReverseDepsExpanded = computed<boolean>(() => {
    const manual = this.reverseDepsManualOverride();
    if (manual !== null) return manual;
    return this.reverseDependencies().totalCount <= 12;
  });

  toggleReverseDependencies(): void {
    this.reverseDepsManualOverride.set(!this.isReverseDepsExpanded());
  }

  readonly compatibleGames = computed(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const gsList = Array.isArray(pkg?.game_support) ? pkg.game_support : [];
    return gsList.filter(gs => gs && gs.game && gs.supports !== false);
  });

  readonly incompatibleGames = computed(() => {
    const pkg = this.packageService.activePackage() || this.package;
    const gsList = Array.isArray(pkg?.game_support) ? pkg.game_support : [];
    return gsList.filter(gs => gs && gs.game && gs.supports === false);
  });
  readonly isHydratingDetails = computed<boolean>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return false;
    if (this.packageService.isPackageDeepHydrated(pkg)) return false;
    return this.packageService.isLoadingDetails();
  });
  readonly RELEASES_PAGE_SIZE = 5;
  readonly MAX_RELEASES_CAP = 10;
  readonly releasesPage = signal<number>(1);
  readonly cappedReleases = computed<PackageRelease[]>(() => {
    const realReleases = this.releases().filter(
      r => r && r.commit_sha !== 'HEAD' && r.version !== 'latest' && String(r.id) !== 'git-branch-fallback'
    );
    return this.packageService.sortAndCapReleases(realReleases, this.MAX_RELEASES_CAP);
  });
  readonly totalReleasePages = computed<number>(() =>
    Math.max(1, Math.ceil(this.cappedReleases().length / this.RELEASES_PAGE_SIZE))
  );
  readonly paginatedReleases = computed<PackageRelease[]>(() => {
    const list = this.cappedReleases();
    const page = Math.min(Math.max(1, this.releasesPage()), this.totalReleasePages());
    const start = (page - 1) * this.RELEASES_PAGE_SIZE;
    return list.slice(start, start + this.RELEASES_PAGE_SIZE);
  });

  // Paginated & Lazy-Loaded "Community Reviews" state (5 per page, triggered within 280px of viewport)
  readonly REVIEWS_PAGE_SIZE = 5;
  readonly reviewsPage = signal<number>(1);
  readonly totalReviewPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.reviews().length / this.REVIEWS_PAGE_SIZE))
  );
  readonly paginatedReviews = computed<CommunityReview[]>(() => {
    const list = this.reviews();
    const page = Math.min(Math.max(1, this.reviewsPage()), this.totalReviewPages());
    const start = (page - 1) * this.REVIEWS_PAGE_SIZE;
    return list.slice(start, start + this.REVIEWS_PAGE_SIZE);
  });
  readonly reviewsRangeStart = computed<number>(() => {
    const total = this.reviews().length;
    if (total === 0) return 0;
    const page = Math.min(Math.max(1, this.reviewsPage()), this.totalReviewPages());
    return (page - 1) * this.REVIEWS_PAGE_SIZE + 1;
  });
  readonly reviewsRangeEnd = computed<number>(() => {
    const total = this.reviews().length;
    if (total === 0) return 0;
    return Math.min(total, this.reviewsRangeStart() + this.REVIEWS_PAGE_SIZE - 1);
  });
  readonly totalReviewCount = computed<number>(() => {
    const loaded = this.reviews().length;
    const pkg = this.packageService.activePackage() || this.package;
    const tc = pkg?.review_thread_counts;
    const threadSum = tc
      ? Number(tc.positive || 0) + Number(tc.neutral || 0) + Number(tc.negative || 0)
      : 0;
    return Math.max(loaded, threadSum);
  });

  // Lazy-Loaded "Similar Packages" & "Community Reviews" sentinels
  @ViewChild('modalScrollContainer') modalScrollContainerRef?: ElementRef<HTMLDivElement>;
  @ViewChild('similarSectionSentinel') similarSentinelRef?: ElementRef<HTMLElement>;
  @ViewChild('reviewsSectionSentinel') reviewsSentinelRef?: ElementRef<HTMLElement>;
  readonly isSimilarNearViewport = signal<boolean>(false);
  readonly isReviewsNearViewport = signal<boolean>(false);
  private similarObserver: IntersectionObserver | null = null;
  private reviewsObserver: IntersectionObserver | null = null;
  private reviewsFetchTriggeredForKey = '';
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
  readonly failedScreenshotUrls = signal<Set<string>>(new Set());
  private mediaTouchStartX = 0;
  private mediaTouchStartY = 0;
  private lightboxTouchStartX = 0;
  private lightboxTouchStartY = 0;

  onScreenshotLoad(event: Event, url?: string | null): void {
    const img = event?.target as HTMLImageElement | null;
    if (!img) return;
    const failed1x1 = img.getAttribute('data-lh-failed-1x1');
    if (failed1x1) {
      img.removeAttribute('data-lh-failed-1x1');
      this.onScreenshotError(url || failed1x1);
      return;
    }
    if (img.naturalWidth > 0 && img.naturalWidth <= 1 && img.naturalHeight > 0 && img.naturalHeight <= 1) {
      this.onScreenshotError(url, event);
    }
  }

  onScreenshotError(url?: string | null, event?: Event): void {
    const img = event?.target as HTMLImageElement | null;
    const failedAttr = img?.getAttribute('data-lh-failed-src') || '';
    if (failedAttr && img) {
      img.removeAttribute('data-lh-failed-src');
    }
    const domSrc = img ? (failedAttr || img.getAttribute('src') || img.currentSrc || img.src || '') : '';
    const rawCandidate = (url?.trim() || domSrc).trim();
    const clean = this.packageService.toProxiedGitImageIfNeeded(rawCandidate) || rawCandidate;
    if (!clean || clean === 'logo.svg' || clean.endsWith('/logo.svg')) return;
    if (this.activeBannerUrl() === clean || this.activeBannerUrl() === rawCandidate) {
      this.activeBannerUrl.set(null);
    }
    const currentFailed = this.failedScreenshotUrls();
    if (!currentFailed.has(clean)) {
      const next = new Set(currentFailed);
      next.add(clean);
      if (rawCandidate && rawCandidate !== clean) {
        next.add(rawCandidate);
      }
      this.failedScreenshotUrls.set(next);
    }
    const totalAfter = this.mediaSlides().length;
    if (totalAfter > 0 && this.mediaCarouselIndex() >= totalAfter) {
      this.mediaCarouselIndex.set(Math.max(0, totalAfter - 1));
    }
  }

  readonly activeScreenshots = computed<string[]>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return [];
    const failed = this.failedScreenshotUrls();
    const merged = this.packageService.mergePackageScreenshots(
      [pkg.banner, pkg.thumbnail],
      pkg.screenshots
    );
    return merged.filter(u => !failed.has(u));
  });

  getScreenshotCaption(url?: string | null): string | undefined {
    if (!url) return undefined;
    const pkg = this.packageService.activePackage() || this.package;
    const metaList = Array.isArray(pkg?.screenshot_meta) ? pkg.screenshot_meta : [];
    if (metaList.length === 0) return undefined;
    const direct = metaList.find(m => m && m.url === url && m.title);
    if (direct?.title) return direct.title;
    const shots = this.activeScreenshots();
    const idx = shots.indexOf(url);
    if (idx >= 0 && idx < metaList.length && metaList[idx]?.title) {
      return metaList[idx].title;
    }
    return undefined;
  }

  readonly mediaSlides = computed<Array<{ type: 'video' | 'image'; url: string; thumbnail: string; caption?: string }>>(() => {
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return [];
    const slides: Array<{ type: 'video' | 'image'; url: string; thumbnail: string; caption?: string }> = [];
    if (pkg.video_url) {
      slides.push({
        type: 'video',
        url: pkg.video_url,
        thumbnail: pkg.video_thumbnail_url || this.bannerImage
      });
    }
    const shots = this.activeScreenshots();
    const metaList = Array.isArray(pkg.screenshot_meta) ? pkg.screenshot_meta : [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const matchedMeta = metaList.find(m => m && m.url === shot && m.title) || metaList[i];
      slides.push({
        type: 'image',
        url: shot,
        thumbnail: formatContentDbCdnUrl(shot, 'tile') || shot,
        caption: matchedMeta?.title || undefined
      });
    }
    return slides;
  });

  readonly MAX_VISIBLE_DOTS = 9;

  readonly visibleMediaDots = computed<Array<{ index: number; url: string; edgeScale: 'normal' | 'sm' | 'xs' }>>(() => {
    const slides = this.mediaSlides();
    const total = slides.length;
    const maxDots = this.MAX_VISIBLE_DOTS;
    if (total <= maxDots) {
      return slides.map((s, index) => ({ index, url: s.url, edgeScale: 'normal' }));
    }

    const current = Math.min(Math.max(0, this.mediaCarouselIndex()), total - 1);
    const half = Math.floor(maxDots / 2);
    let start = Math.max(0, current - half);
    let end = start + maxDots - 1;
    if (end >= total) {
      end = total - 1;
      start = Math.max(0, end - maxDots + 1);
    }

    const hasMoreLeft = start > 0;
    const hasMoreRight = end < total - 1;
    const result: Array<{ index: number; url: string; edgeScale: 'normal' | 'sm' | 'xs' }> = [];

    for (let idx = start; idx <= end; idx++) {
      const offsetFromLeft = idx - start;
      const offsetFromRight = end - idx;
      let edgeScale: 'normal' | 'sm' | 'xs' = 'normal';

      if (idx !== current) {
        if ((hasMoreLeft && offsetFromLeft === 0) || (hasMoreRight && offsetFromRight === 0)) {
          edgeScale = 'xs';
        } else if ((hasMoreLeft && offsetFromLeft === 1) || (hasMoreRight && offsetFromRight === 1)) {
          edgeScale = 'sm';
        }
      }
      result.push({ index: idx, url: slides[idx].url, edgeScale });
    }
    return result;
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

  // Author Metadata & Tag Editing state (LuantiHub-First)
  readonly isEditingTags = signal(false);
  readonly editableTags = signal<string[]>([]);
  readonly editableDevState = signal<string>('');
  readonly editableMinEngineVersion = signal<string>('');
  readonly editableMaxEngineVersion = signal<string>('');
  readonly editableSupportsAllGames = signal<boolean>(false);
  readonly editableGameSupportMap = signal<Record<string, 'compatible' | 'incompatible'>>({});
  readonly editableContentWarnings = signal<string[]>([]);
  readonly editableTranslationLang = signal<string>('de');
  readonly editableTranslatedTitle = signal<string>('');
  readonly editableTranslatedShortDesc = signal<string>('');
  readonly editableTranslationsMap = signal<Record<string, { title?: string; short_desc?: string; desc?: string }>>({});
  readonly isSavingTags = signal(false);

  // Expandable Release Notes & Live Git Tag Sync state
  readonly expandedReleaseKeys = signal<Set<string>>(new Set());
  readonly loadingReleaseNotesKey = signal<string | null>(null);
  readonly releaseNotesByKey = signal<Map<string, ReleaseNotesPayload>>(new Map());
  readonly isSyncingReleases = signal(false);

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
    const pkg = this.packageService.activePackage() || this.package;
    return this.authService.isPackageAuthor(pkg);
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
        if (u.hostname.includes('bitbucket.org')) {
          return `https://bitbucket.org/${owner}/${repo}/raw/${branch}`;
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
    const localized = this.packageService.getLocalizedPackageText(pkg);
    const rawDesc = (localized.desc || pkg.desc || '').trim();
    const rawReadme = (pkg.readme || '').trim();
    const shortDesc = (localized.short_desc || pkg.short_desc || '').trim();
    const isPureGit = pkg.source === 'git' && (!pkg.sources || !pkg.sources.includes('official'));

    // Only deduplicate description against README when the README accordion is actively expanded
    if (rawReadme && this.isReadmeExpanded()) {
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
    const rawReadme = (pkg?.readme || this.packageService.getCachedReadme(pkg) || '').trim();
    if (!rawReadme) return null;
    const rewritten = this.packageService.rewriteRelativeMarkdownUrls(rawReadme, this.getRawAssetBase(pkg));
    return this.parseSafeMarkdown(rewritten);
  });

  async toggleReadme(): Promise<void> {
    const nextExpanded = !this.isReadmeExpanded();
    this.isReadmeExpanded.set(nextExpanded);
    if (!nextExpanded) return;

    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;

    const existingReadme = (pkg.readme || this.packageService.getCachedReadme(pkg) || '').trim();
    if (existingReadme || this.isLoadingReadme()) return;

    const targetKey = this.loadedPackageKey;
    this.isLoadingReadme.set(true);
    try {
      await this.packageService.fetchPackageReadme(pkg);
    } finally {
      if (this.loadedPackageKey === targetKey) {
        this.isLoadingReadme.set(false);
      }
    }
  }

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
    const pkg = this.packageService.activePackage() || this.package;
    const failed = this.failedScreenshotUrls();
    const preferredGitShot = [pkg?.banner, pkg?.thumbnail, this.package?.banner, this.package?.thumbnail]
      .map(u => this.packageService.toProxiedGitImageIfNeeded(u))
      .find(u => Boolean(u) && u !== 'logo.svg' && !failed.has(u) && this.packageService.isGitScreenshotUrl(u));
    if (preferredGitShot) {
      return preferredGitShot;
    }
    const shots = this.activeScreenshots();
    if (shots.length > 0) {
      return shots[0];
    }
    for (const rawBanner of [pkg?.banner, this.package?.banner]) {
      const candidateBanner = this.packageService.toProxiedGitImageIfNeeded(rawBanner);
      if (
        candidateBanner &&
        candidateBanner !== 'logo.svg' &&
        !candidateBanner.includes('/storage/screenshots/') &&
        !isContentDbThumbnailUrl(candidateBanner) &&
        !failed.has(candidateBanner)
      ) {
        return candidateBanner;
      }
    }
    for (const rawCandidate of [pkg?.banner, this.package?.banner, pkg?.thumbnail, this.package?.thumbnail]) {
      const candidate = this.packageService.toProxiedGitImageIfNeeded(rawCandidate);
      const upgraded = upgradeContentDbThumbnailUrl(candidate) || candidate;
      if (
        upgraded &&
        upgraded !== 'logo.svg' &&
        !upgraded.includes('/storage/screenshots/') &&
        !failed.has(upgraded)
      ) {
        return upgraded;
      }
    }
    for (const rawThumb of [pkg?.thumbnail, this.package?.thumbnail]) {
      const candidateThumb = this.packageService.toProxiedGitImageIfNeeded(rawThumb);
      const upgradedThumb = upgradeContentDbThumbnailUrl(candidateThumb) || candidateThumb;
      if (
        upgradedThumb &&
        upgradedThumb !== 'logo.svg' &&
        !upgradedThumb.includes('/storage/screenshots/') &&
        !this.packageService.isGitScreenshotUrl(upgradedThumb)
      ) {
        return upgradedThumb;
      }
    }
    return 'logo.svg';
  }

  get modalHeaderBannerUrl(): string {
    const raw = this.activeBannerUrl() || this.bannerImage;
    if (!raw || raw === 'logo.svg' || this.packageService.isGitScreenshotUrl(raw)) {
      return raw || 'logo.svg';
    }
    return formatContentDbCdnUrl(raw, 'banner') || raw;
  }

  getSlideDisplayUrl(url: string): string {
    if (!url || url === 'logo.svg' || this.packageService.isGitScreenshotUrl(url)) {
      return url || 'logo.svg';
    }
    return formatContentDbCdnUrl(url, 'gallery') || url;
  }

  getLightboxDisplayUrl(url: string): string {
    if (!url || url === 'logo.svg' || this.packageService.isGitScreenshotUrl(url)) {
      return url || 'logo.svg';
    }
    return formatContentDbCdnUrl(url, 'original') || url;
  }

  get fallbackBannerThumbnail(): string | undefined {
    const pkg = this.packageService.activePackage() || this.package;
    const currentBanner = this.activeBannerUrl() || this.bannerImage;
    const failed = this.failedScreenshotUrls();
    const pkgThumb = this.packageService.toProxiedGitImageIfNeeded(pkg?.thumbnail);
    const inputThumb = this.packageService.toProxiedGitImageIfNeeded(this.package?.thumbnail);
    const candidates = [
      ...(this.activeScreenshots() || []),
      pkgThumb,
      inputThumb
    ];
    return (
      candidates.find(u => Boolean(u) && u !== 'logo.svg' && u !== currentBanner && !failed.has(u)) ||
      [pkgThumb, inputThumb].find(u => Boolean(u) && u !== 'logo.svg' && !failed.has(u))
    );
  }

  private static readonly savedViewStateByPkg = new Map<string, {
    scrollTop: number;
    isSimilarNearViewport: boolean;
    isReviewsNearViewport: boolean;
    activeTab: 'reviews' | 'releases' | 'compliance' | 'analytics';
    releasesPage: number;
    reviewsPage: number;
  }>();

  private loadedPackageKey = '';
  private lastKnownScrollTop = 0;
  private scrollRafId: number | null = null;
  private cleanupScrollListener: (() => void) | null = null;
  readonly showModalBackToTop = signal<boolean>(false);
  readonly highlightedReviewId = signal<string | null>(null);
  private activeFocusRequest: PackageModalFocusRequest | null = null;
  private highlightReviewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const pending = this.packageService.pendingModalFocus();
      if (pending && this.loadedPackageKey) {
        this.consumeAndApplyPendingFocus();
      }
    });
  }

  private scrollElementIntoModalContainer(
    targetOrSelector: HTMLElement | string | null | undefined,
    block: ScrollLogicalPosition = 'start'
  ): void {
    const apply = () => {
      const container = this.modalScrollContainerRef?.nativeElement;
      const targetEl =
        typeof targetOrSelector === 'string'
          ? (container?.querySelector(targetOrSelector) as HTMLElement | null)
          : (targetOrSelector ?? null);
      if (!targetEl) return;
      if (container) {
        const cRect = container.getBoundingClientRect?.();
        const tRect = targetEl.getBoundingClientRect?.();
        if (cRect && tRect && (cRect.height > 0 || tRect.top !== 0 || targetEl.offsetTop > 0)) {
          const relativeTop =
            cRect.height > 0 && (tRect.top !== 0 || tRect.bottom !== 0)
              ? container.scrollTop + (tRect.top - cRect.top) - 16
              : Math.max(0, targetEl.offsetTop - 16);
          const nextTop = Math.max(0, relativeTop);
          this.lastKnownScrollTop = nextTop;
          if (typeof container.scrollTo === 'function') {
            container.scrollTo({ top: nextTop, behavior: 'smooth' });
          } else {
            container.scrollTop = nextTop;
          }
        }
      }
      if (typeof targetEl.scrollIntoView === 'function') {
        try {
          targetEl.scrollIntoView({ behavior: 'smooth', block });
        } catch {
          targetEl.scrollIntoView();
        }
      }
    };
    apply();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => apply());
    }
    setTimeout(() => apply(), 40);
  }

  private hasMatchingReviewInList(reviewId: string | undefined, list: CommunityReview[]): boolean {
    if (!reviewId || !Array.isArray(list) || list.length === 0) return false;
    const rawTarget = reviewId.trim().toLowerCase();
    const cleanTarget = rawTarget.replace(/^(lh_|cdb_)/i, '');
    return list.some(r => {
      const rId = String(r?.id || '').trim().toLowerCase();
      const rClean = rId.replace(/^(lh_|cdb_)/i, '');
      return rId === rawTarget || (cleanTarget.length > 0 && rClean === cleanTarget);
    });
  }

  private consumeAndApplyPendingFocus(): boolean {
    if (!this.loadedPackageKey) return false;
    const req = this.packageService.consumeModalSectionFocus(this.loadedPackageKey);
    if (req) {
      this.activeFocusRequest = req;
      PackageDetailModalComponent.savedViewStateByPkg.delete(this.loadedPackageKey);
      if (req.section === 'reviews') {
        this.activeTab.set('reviews');
        this.isReviewsNearViewport.set(true);
        const needsFreshReviewFetch = Boolean(
          req.reviewId && !this.hasMatchingReviewInList(req.reviewId, this.reviews())
        );
        if (needsFreshReviewFetch) {
          this.isLoadingReviews.set(true);
          this.reviewsFetchTriggeredForKey = '';
          this.triggerReviewsLoad(true);
        } else {
          this.triggerReviewsLoad();
        }
      } else if (req.section === 'releases') {
        this.activeTab.set('releases');
        this.releasesPage.set(1);
      }
      this.scrollElementIntoModalContainer(this.reviewsSentinelRef?.nativeElement, 'start');
    }
    if (this.activeFocusRequest) {
      this.fulfillActiveFocusRequest();
      return true;
    }
    return false;
  }

  private fulfillActiveFocusRequest(): void {
    const req = this.activeFocusRequest;
    if (!req) return;

    if (req.section === 'reviews') {
      if (this.activeTab() !== 'reviews') {
        this.activeTab.set('reviews');
      }
      const list = this.reviews();
      if (list.length > 0) {
        if (req.reviewId) {
          const rawTarget = req.reviewId.trim().toLowerCase();
          const cleanTarget = rawTarget.replace(/^(lh_|cdb_)/i, '');
          const matchIdx = list.findIndex(r => {
            const rId = String(r.id || '').trim().toLowerCase();
            const rClean = rId.replace(/^(lh_|cdb_)/i, '');
            return rId === rawTarget || (cleanTarget.length > 0 && rClean === cleanTarget);
          });
          if (matchIdx >= 0) {
            const matched = list[matchIdx];
            const targetPage = Math.floor(matchIdx / this.REVIEWS_PAGE_SIZE) + 1;
            if (this.reviewsPage() !== targetPage) {
              this.reviewsPage.set(targetPage);
            }
            this.highlightedReviewId.set(matched.id);
            if (this.highlightReviewTimer) {
              clearTimeout(this.highlightReviewTimer);
            }
            this.highlightReviewTimer = setTimeout(() => {
              this.highlightedReviewId.set(null);
            }, 4500);
            this.activeFocusRequest = null;
            const safeSelector = `[data-review-id="${String(matched.id).replace(/"/g, '\\"')}"]`;
            this.scrollElementIntoModalContainer(safeSelector, 'center');
            return;
          }
        }
        if (!req.reviewId || !this.isLoadingReviews()) {
          this.activeFocusRequest = null;
          this.scrollElementIntoModalContainer(this.reviewsSentinelRef?.nativeElement, 'start');
        }
      } else if (!this.isLoadingReviews()) {
        this.activeFocusRequest = null;
        this.scrollElementIntoModalContainer(this.reviewsSentinelRef?.nativeElement, 'start');
      }
      return;
    }

    if (req.section === 'releases') {
      if (this.activeTab() !== 'releases') {
        this.activeTab.set('releases');
      }
      if (this.releasesPage() !== 1) {
        this.releasesPage.set(1);
      }
      const pageRels = this.paginatedReleases();
      if (pageRels.length > 0) {
        const firstRel = pageRels[0];
        if (req.expandReleaseNotes) {
          const relKey = this.getReleaseNotesKey(firstRel, 0);
          if (!this.isReleaseNotesExpanded(relKey)) {
            void this.toggleReleaseNotes(firstRel, 0);
          } else if (
            this.hasValidGitRepo &&
            !this.releaseNotesByKey().has(relKey) &&
            this.loadingReleaseNotesKey() !== relKey
          ) {
            const nextExpanded = new Set(this.expandedReleaseKeys());
            nextExpanded.delete(relKey);
            this.expandedReleaseKeys.set(nextExpanded);
            void this.toggleReleaseNotes(firstRel, 0);
          }
          if (this.hasValidGitRepo || !this.isHydratingDetails()) {
            this.activeFocusRequest = null;
          }
        } else {
          this.activeFocusRequest = null;
        }
        this.scrollElementIntoModalContainer('[data-release-idx="0"]', 'nearest');
      } else if (!this.isLoadingReleases()) {
        if (this.hasValidGitRepo || !this.isHydratingDetails()) {
          this.activeFocusRequest = null;
        }
        if (req.expandReleaseNotes && this.cappedReleases().length === 0 && this.hasValidGitRepo) {
          if (!this.isReleaseNotesExpanded('branch-fallback')) {
            void this.toggleBranchFallbackNotes();
          }
          this.scrollElementIntoModalContainer('[data-release-idx="branch-fallback"]', 'nearest');
        } else {
          this.scrollElementIntoModalContainer(this.reviewsSentinelRef?.nativeElement, 'start');
        }
      }
    }
  }

  private computeModalScrollThreshold(container?: HTMLElement | null): number {
    if (container && container.clientHeight > 0) {
      return container.clientHeight;
    }
    if (typeof window !== 'undefined' && window.innerHeight > 0) {
      return window.innerHeight;
    }
    return 800;
  }

  private updateModalBackToTopState(scrollTop: number, container?: HTMLElement | null): void {
    const nextVisible = scrollTop > this.computeModalScrollThreshold(container);
    if (this.showModalBackToTop() !== nextVisible) {
      this.ngZone.run(() => {
        this.showModalBackToTop.set(nextVisible);
      });
    }
  }

  scrollModalToTop(): void {
    const scrollEl = this.modalScrollContainerRef?.nativeElement;
    this.lastKnownScrollTop = 0;
    this.showModalBackToTop.set(false);
    this.persistCurrentViewState();
    if (scrollEl) {
      if (typeof scrollEl.scrollTo === 'function') {
        scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        scrollEl.scrollTop = 0;
      }
    }
  }

  private persistCurrentViewState(): void {
    if (!this.loadedPackageKey) return;
    PackageDetailModalComponent.savedViewStateByPkg.set(this.loadedPackageKey, {
      scrollTop: this.lastKnownScrollTop,
      isSimilarNearViewport: this.isSimilarNearViewport(),
      isReviewsNearViewport: this.isReviewsNearViewport(),
      activeTab: this.activeTab(),
      releasesPage: this.releasesPage(),
      reviewsPage: this.reviewsPage()
    });
  }

  private restoreSavedScrollPosition(targetScrollTop: number): void {
    this.lastKnownScrollTop = targetScrollTop;
    const applyScroll = () => {
      const scrollEl = this.modalScrollContainerRef?.nativeElement;
      if (scrollEl && targetScrollTop > 0) {
        scrollEl.scrollTop = targetScrollTop;
      }
      this.updateModalBackToTopState(targetScrollTop, scrollEl);
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
    const hasFocusReq = this.consumeAndApplyPendingFocus();
    const savedState =
      !hasFocusReq && this.loadedPackageKey
        ? PackageDetailModalComponent.savedViewStateByPkg.get(this.loadedPackageKey)
        : undefined;
    if (savedState && savedState.scrollTop > 0) {
      this.restoreSavedScrollPosition(savedState.scrollTop);
    }
    this.setupPassiveScrollListener();
    this.setupSimilarIntersectionObserver();
    this.setupReviewsIntersectionObserver();
  }

  ngOnDestroy(): void {
    if (this.highlightReviewTimer) {
      clearTimeout(this.highlightReviewTimer);
      this.highlightReviewTimer = null;
    }
    this.teardownPassiveScrollListener();
    this.persistCurrentViewState();
    this.disconnectSimilarObserver();
    this.disconnectReviewsObserver();
    this.packageService.registerModalSubOverlayCloser(null);
  }

  onSelectReviewsTab(): void {
    this.activeTab.set('reviews');
    this.persistCurrentViewState();
    this.triggerReviewsLoad();
  }

  prevReviewsPage(): void {
    this.reviewsPage.update(p => Math.max(1, p - 1));
    this.persistCurrentViewState();
  }

  nextReviewsPage(): void {
    this.reviewsPage.update(p => Math.min(this.totalReviewPages(), p + 1));
    this.persistCurrentViewState();
  }

  prevReleasesPage(): void {
    this.releasesPage.update(p => Math.max(1, p - 1));
    this.persistCurrentViewState();
  }

  nextReleasesPage(): void {
    this.releasesPage.update(p => Math.min(this.totalReleasePages(), p + 1));
    this.persistCurrentViewState();
  }

  private setupPassiveScrollListener(): void {
    this.teardownPassiveScrollListener();
    const container = this.modalScrollContainerRef?.nativeElement;
    if (!container) return;

    this.ngZone.runOutsideAngular(() => {
      const onScroll = () => {
        if (this.scrollRafId !== null) return;
        if (typeof requestAnimationFrame === 'function') {
          this.scrollRafId = requestAnimationFrame(() => {
            this.scrollRafId = null;
            this.onModalContainerScroll();
          });
        } else {
          this.onModalContainerScroll();
        }
      };
      container.addEventListener('scroll', onScroll, { passive: true });
      this.cleanupScrollListener = () => {
        container.removeEventListener('scroll', onScroll);
      };
    });
  }

  private teardownPassiveScrollListener(): void {
    if (this.scrollRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
    if (this.cleanupScrollListener) {
      this.cleanupScrollListener();
      this.cleanupScrollListener = null;
    }
  }

  onModalContainerScroll(): void {
    const container = this.modalScrollContainerRef?.nativeElement;
    if (container) {
      this.lastKnownScrollTop = container.scrollTop;
      this.updateModalBackToTopState(container.scrollTop, container);
      this.persistCurrentViewState();
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

  private disconnectReviewsObserver(): void {
    if (this.reviewsObserver) {
      this.reviewsObserver.disconnect();
      this.reviewsObserver = null;
    }
  }

  private setupReviewsIntersectionObserver(): void {
    this.disconnectReviewsObserver();
    if (this.isReviewsNearViewport()) {
      this.triggerReviewsLoad();
      return;
    }

    const sentinel = this.reviewsSentinelRef?.nativeElement;
    if (!sentinel) return;

    if (typeof IntersectionObserver === 'undefined') {
      this.triggerReviewsLoad();
      return;
    }

    const rootEl = this.modalScrollContainerRef?.nativeElement || null;
    try {
      const sentinelRect = sentinel.getBoundingClientRect();
      const rootRect = rootEl ? rootEl.getBoundingClientRect() : null;
      const isLayoutlessTestEnv = sentinelRect.height === 0 && (!rootRect || rootRect.height === 0);
      const isAlreadyWithinMargin =
        rootRect && rootRect.height > 0 && sentinelRect.top <= rootRect.bottom + 280;
      if (isLayoutlessTestEnv || isAlreadyWithinMargin) {
        this.triggerReviewsLoad();
        return;
      }
    } catch {
      // Fall through to IntersectionObserver
    }

    this.reviewsObserver = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting || e.intersectionRatio > 0)) {
          this.triggerReviewsLoad();
        }
      },
      {
        root: rootEl,
        rootMargin: '280px 0px',
        threshold: 0.01
      }
    );
    this.reviewsObserver.observe(sentinel);
  }

  triggerReviewsLoad(forceRefresh = false): void {
    if (!this.isReviewsNearViewport()) {
      this.isReviewsNearViewport.set(true);
      this.persistCurrentViewState();
    }
    this.disconnectReviewsObserver();

    const key = this.loadedPackageKey;
    if (!key || (!forceRefresh && this.reviewsFetchTriggeredForKey === key)) return;
    this.reviewsFetchTriggeredForKey = key;

    const latestPkg = this.packageService.activePackage() || this.package;
    if (!latestPkg) return;

    const savedState = PackageDetailModalComponent.savedViewStateByPkg.get(key);
    if (this.reviews().length === 0 || forceRefresh) {
      this.isLoadingReviews.set(true);
    }

    this.packageService
      .fetchReviews(latestPkg, forceRefresh)
      .then(res => {
        if (this.loadedPackageKey !== key) return;
        if (res.length > 0 || this.reviews().length === 0) {
          this.reviews.set(res);
        }
        this.isLoadingReviews.set(false);
        if (this.activeFocusRequest) {
          this.fulfillActiveFocusRequest();
        } else {
          const currentSaved = PackageDetailModalComponent.savedViewStateByPkg.get(key);
          if (currentSaved && currentSaved.scrollTop > 0) {
            this.restoreSavedScrollPosition(currentSaved.scrollTop);
          }
        }
      })
      .catch(() => {
        if (this.loadedPackageKey === key) {
          this.isLoadingReviews.set(false);
          if (this.activeFocusRequest) {
            this.fulfillActiveFocusRequest();
          }
        }
      });
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
    this.failedScreenshotUrls.set(new Set());
    this.mediaCarouselIndex.set(0);
    this.isVideoPlaying.set(false);
    this.lightboxImageUrl.set(null);
    this.isLightboxZoomed.set(false);
    this.expandedReleaseKeys.set(new Set());
    this.loadingReleaseNotesKey.set(null);
    this.isReadmeExpanded.set(false);
    this.isLoadingReadme.set(false);
    this.dependenciesManualOverride.set(null);
    this.reverseDepsManualOverride.set(null);

    const initialCachedReviews = this.packageService.getCachedReviews(this.package);
    if (initialCachedReviews !== undefined && initialCachedReviews.length > 0) {
      this.reviews.set(initialCachedReviews);
      this.isLoadingReviews.set(false);
    } else if (isSwitchingPackage || this.reviews().length === 0) {
      this.reviews.set([]);
      this.isLoadingReviews.set(true);
    } else {
      this.isLoadingReviews.set(false);
    }

    const initialCachedReleases = this.packageService.getCachedReleases(this.package);
    if (initialCachedReleases) {
      this.releases.set(initialCachedReleases);
      this.isLoadingReleases.set(false);
    } else if (isSwitchingPackage || this.releases().length === 0) {
      this.releases.set([]);
      this.isLoadingReleases.set(true);
    } else {
      this.isLoadingReleases.set(false);
    }

    const savedState = PackageDetailModalComponent.savedViewStateByPkg.get(key);
    this.reviewsFetchTriggeredForKey = '';
    this.highlightedReviewId.set(null);
    const hasInitialFocusReq = this.consumeAndApplyPendingFocus();
    if (!hasInitialFocusReq && savedState) {
      this.isSimilarNearViewport.set(savedState.isSimilarNearViewport);
      this.isReviewsNearViewport.set(savedState.isReviewsNearViewport);
      this.activeTab.set(savedState.activeTab);
      this.releasesPage.set(savedState.releasesPage);
      this.reviewsPage.set(savedState.reviewsPage || 1);
      this.restoreSavedScrollPosition(savedState.scrollTop);
    } else if (!hasInitialFocusReq && isSwitchingPackage) {
      this.lastKnownScrollTop = 0;
      this.showModalBackToTop.set(false);
      this.isSimilarNearViewport.set(false);
      this.isReviewsNearViewport.set(false);
      this.activeTab.set('reviews');
      this.releasesPage.set(1);
      this.reviewsPage.set(1);
      const scrollEl = this.modalScrollContainerRef?.nativeElement;
      if (scrollEl) {
        if (typeof scrollEl.scrollTo === 'function') {
          scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          scrollEl.scrollTop = 0;
        }
      }
      setTimeout(() => {
        this.setupSimilarIntersectionObserver();
        this.setupReviewsIntersectionObserver();
      }, 0);
    } else if (!hasInitialFocusReq) {
      this.reviewsPage.set(1);
    }

    // Wait for bundled package details first (which populates reviewsCache & releasesCache in 1 request)
    await this.packageService.loadPackageDetails(this.package, true);
    if (this.loadedPackageKey !== key) return;

    const latestPkg = this.packageService.activePackage() || this.package;
    const bundledCachedReviews = this.packageService.getCachedReviews(latestPkg);
    if (bundledCachedReviews !== undefined && bundledCachedReviews.length > 0) {
      this.reviews.set(bundledCachedReviews);
      this.isLoadingReviews.set(false);
    }

    const bundledCachedReleases = this.packageService.getCachedReleases(latestPkg);
    if (bundledCachedReleases && bundledCachedReleases.length > 0) {
      this.releases.set(bundledCachedReleases);
      this.isLoadingReleases.set(false);
    }

    if (this.activeFocusRequest) {
      this.fulfillActiveFocusRequest();
    }

    if (this.isReviewsNearViewport() || !this.reviewsSentinelRef?.nativeElement) {
      this.triggerReviewsLoad();
    } else {
      this.setupReviewsIntersectionObserver();
    }

    this.packageService
      .fetchPackageReleases(this.package)
      .then(res => {
        if (this.loadedPackageKey !== key) return;
        if (res.length > 0 || this.releases().length === 0 || isSwitchingPackage) {
          this.releases.set(res);
        }
        this.isLoadingReleases.set(false);
        if (this.activeFocusRequest) {
          this.fulfillActiveFocusRequest();
        } else {
          const currentSaved = PackageDetailModalComponent.savedViewStateByPkg.get(key);
          if (currentSaved && currentSaved.scrollTop > 0) {
            this.restoreSavedScrollPosition(currentSaved.scrollTop);
          }
        }
      })
      .catch(() => {
        if (this.loadedPackageKey === key) {
          this.isLoadingReleases.set(false);
          if (this.activeFocusRequest) {
            this.fulfillActiveFocusRequest();
          }
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
  }

  nextMediaSlide(event?: Event): void {
    if (event) event.stopPropagation();
    const slides = this.mediaSlides();
    if (slides.length <= 1) return;
    this.isVideoPlaying.set(false);
    const nextIdx = (this.mediaCarouselIndex() + 1) % slides.length;
    this.mediaCarouselIndex.set(nextIdx);
    this.scrollActiveThumbnailIntoView(nextIdx);
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
    this.editableDevState.set((pkg?.dev_state || '').trim().toUpperCase());
    this.editableMinEngineVersion.set((pkg?.min_minetest_version || '').trim());
    this.editableMaxEngineVersion.set((pkg?.max_minetest_version || '').trim());
    this.editableSupportsAllGames.set(Boolean(pkg?.supports_all_games));

    const gameMap: Record<string, 'compatible' | 'incompatible'> = {};
    for (const gs of Array.isArray(pkg?.game_support) ? pkg.game_support : []) {
      const gName = (gs?.game?.name || '').trim().toLowerCase();
      if (!gName) continue;
      gameMap[gName] = gs.supports === false ? 'incompatible' : 'compatible';
    }
    this.editableGameSupportMap.set(gameMap);
    this.editableContentWarnings.set(
      (Array.isArray(pkg?.content_warnings) ? pkg.content_warnings : []).map(w => String(w).trim().toLowerCase())
    );

    const translationsClone: Record<string, { title?: string; short_desc?: string; desc?: string }> = {};
    if (pkg?.translations && typeof pkg.translations === 'object') {
      for (const [lang, entry] of Object.entries(pkg.translations)) {
        if (entry && typeof entry === 'object') {
          translationsClone[lang] = { ...entry };
        }
      }
    }
    this.editableTranslationsMap.set(translationsClone);
    const defaultLang = this.editableTranslationLang() || 'de';
    const currentLangEntry = translationsClone[defaultLang] || {};
    this.editableTranslatedTitle.set(currentLangEntry.title || '');
    this.editableTranslatedShortDesc.set(currentLangEntry.short_desc || '');
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

  getEditableGameState(gameName: string): 'compatible' | 'incompatible' | 'none' {
    return this.editableGameSupportMap()[gameName.toLowerCase()] || 'none';
  }

  cycleEditableGameSupport(game: { name: string; title: string; author?: string }): void {
    const key = game.name.toLowerCase();
    const current = { ...this.editableGameSupportMap() };
    const state = current[key];
    if (!state) {
      current[key] = 'compatible';
    } else if (state === 'compatible') {
      current[key] = 'incompatible';
    } else {
      delete current[key];
    }
    this.editableGameSupportMap.set(current);
  }

  isEditableContentWarningSelected(warningName: string): boolean {
    return this.editableContentWarnings().includes(warningName.toLowerCase());
  }

  toggleEditableContentWarning(warningName: string): void {
    const key = warningName.toLowerCase();
    const current = this.editableContentWarnings();
    if (current.includes(key)) {
      this.editableContentWarnings.set(current.filter(w => w !== key));
    } else {
      this.editableContentWarnings.set([...current, key]);
    }
  }

  onChangeEditableTranslationLang(nextLang: string): void {
    const prevLang = this.editableTranslationLang();
    const map = { ...this.editableTranslationsMap() };
    const prevTitle = this.editableTranslatedTitle().trim();
    const prevShortDesc = this.editableTranslatedShortDesc().trim();
    if (prevTitle || prevShortDesc) {
      map[prevLang] = {
        ...(map[prevLang] || {}),
        ...(prevTitle ? { title: prevTitle } : {}),
        ...(prevShortDesc ? { short_desc: prevShortDesc } : {})
      };
    } else {
      delete map[prevLang];
    }
    this.editableTranslationsMap.set(map);
    this.editableTranslationLang.set(nextLang);
    const nextEntry = map[nextLang] || {};
    this.editableTranslatedTitle.set(nextEntry.title || '');
    this.editableTranslatedShortDesc.set(nextEntry.short_desc || '');
  }

  async onSaveTags(): Promise<void> {
    if (!this.canModerate()) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;

    // Persist current translation inputs into map before saving
    const currentLang = this.editableTranslationLang();
    const translationsPayload = { ...this.editableTranslationsMap() };
    const cleanTitle = this.editableTranslatedTitle().trim();
    const cleanShortDesc = this.editableTranslatedShortDesc().trim();
    if (cleanTitle || cleanShortDesc) {
      translationsPayload[currentLang] = {
        ...(translationsPayload[currentLang] || {}),
        ...(cleanTitle ? { title: cleanTitle } : {}),
        ...(cleanShortDesc ? { short_desc: cleanShortDesc } : {})
      };
    } else {
      delete translationsPayload[currentLang];
    }

    // Build game_support array from editableGameSupportMap
    const availableGames = this.packageService.availableGames();
    const existingGames = Array.isArray(pkg.game_support) ? pkg.game_support : [];
    const gameSupportPayload: Array<{
      confidence: number;
      supports: boolean;
      game: { id: string; author: string; name: string; title: string; thumbnail?: string };
    }> = [];
    for (const [gName, status] of Object.entries(this.editableGameSupportMap())) {
      const existing = existingGames.find(gs => gs?.game?.name?.toLowerCase() === gName);
      const popular = availableGames.find(g => g.name.toLowerCase() === gName);
      const author = existing?.game?.author || popular?.author || '';
      const name = existing?.game?.name || popular?.name || gName;
      const title = existing?.game?.title || popular?.title || gName;
      gameSupportPayload.push({
        confidence: 11,
        supports: status === 'compatible',
        game: {
          id: existing?.game?.id || (author ? `${author}/${name}` : name),
          author,
          name,
          title,
          thumbnail: existing?.game?.thumbnail
        }
      });
    }

    this.isSavingTags.set(true);
    const res = await this.packageService.updatePackageMetadata(pkg, {
      tags: this.editableTags(),
      dev_state: this.editableDevState() || undefined,
      content_warnings: this.editableContentWarnings(),
      min_minetest_version: this.editableMinEngineVersion() || null,
      max_minetest_version: this.editableMaxEngineVersion() || null,
      supports_all_games: this.editableSupportsAllGames(),
      game_support: gameSupportPayload,
      translations: translationsPayload
    });
    this.isSavingTags.set(false);
    if (res.success) {
      this.package = {
        ...this.package,
        tags: res.tags ?? this.package.tags,
        dev_state: res.dev_state ?? this.package.dev_state,
        content_warnings: res.content_warnings ?? this.package.content_warnings,
        min_minetest_version: res.min_minetest_version ?? undefined,
        max_minetest_version: res.max_minetest_version ?? undefined,
        supports_all_games: res.supports_all_games ?? this.package.supports_all_games,
        game_support: res.game_support ?? this.package.game_support,
        translations: res.translations ?? this.package.translations
      };
      this.isEditingTags.set(false);
      this.pwaService.showToast('Package metadata updated!');
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  onOpenPackageAnalytics(): void {
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

  async onSyncGitReleases(): Promise<void> {
    if (this.isSyncingReleases()) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;

    const targetKey = this.loadedPackageKey;
    const prevLatestVersion = this.cappedReleases()[0]?.version || this.cappedReleases()[0]?.tag_name || '';
    this.isSyncingReleases.set(true);
    try {
      const freshReleases = await this.packageService.fetchPackageReleases(pkg, true);
      if (this.loadedPackageKey === targetKey) {
        this.releases.set(freshReleases);
        this.releasesPage.set(1);
        this.releaseNotesByKey.set(new Map());
        const nextLatestVersion = freshReleases[0]?.version || freshReleases[0]?.tag_name || '';
        if (nextLatestVersion && nextLatestVersion !== prevLatestVersion) {
          this.pwaService.showToast(`Synced new Git release: ${nextLatestVersion}`);
        } else {
          this.pwaService.showToast('Synced latest Git tags & releases');
        }
      }
    } finally {
      if (this.loadedPackageKey === targetKey) {
        this.isSyncingReleases.set(false);
      }
    }
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

  getCleanReleaseNotes(rel?: PackageRelease | null): string | undefined {
    if (!rel) return undefined;
    return this.packageService.sanitizeReleaseNotesText(
      rel.release_notes || rel.changelog,
      rel.version || rel.tag_name
    );
  }

  formatRefLabel(ref?: string | null): string {
    return this.packageService.abbreviateGitRefLabel(ref);
  }

  async toggleBranchFallbackNotes(): Promise<void> {
    if (!this.hasValidGitRepo) return;
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
    const cleanNotes = this.getCleanReleaseNotes(rel);
    if (!this.hasValidGitRepo && !cleanNotes) return;

    const key = this.getReleaseNotesKey(rel, pageIdx);
    const nextExpanded = new Set(this.expandedReleaseKeys());
    if (nextExpanded.has(key)) {
      nextExpanded.delete(key);
      this.expandedReleaseKeys.set(nextExpanded);
      return;
    }
    nextExpanded.add(key);
    this.expandedReleaseKeys.set(nextExpanded);

    if (!this.hasValidGitRepo || this.releaseNotesByKey().has(key)) return;
    const pkg = this.packageService.activePackage() || this.package;
    if (!pkg) return;

    const allCapped = this.cappedReleases();
    const globalIdx = (this.releasesPage() - 1) * this.RELEASES_PAGE_SIZE + pageIdx;
    const olderRelease = globalIdx >= 0 && globalIdx + 1 < allCapped.length ? allCapped[globalIdx + 1] : undefined;

    const extractRef = (r?: PackageRelease): string | undefined => {
      if (!r) return undefined;
      if (r.commit_sha && r.commit_sha !== 'HEAD') return r.commit_sha;
      const candidate = (r.tag_name || r.version || '').trim();
      if (
        !candidate ||
        candidate.toLowerCase().startsWith('branch') ||
        candidate.toLowerCase().startsWith('release') ||
        candidate.startsWith('#') ||
        /^\d{4}-\d{2}-\d{2}$/.test(candidate) ||
        /^\d+$/.test(candidate)
      ) {
        return undefined;
      }
      return candidate.split(/\s+/)[0];
    };

    const headRef = extractRef(rel) || pkg.default_branch || 'main';
    const baseRef = extractRef(olderRelease);

    this.loadingReleaseNotesKey.set(key);
    const payload = await this.packageService.fetchReleaseNotesForRelease(
      pkg,
      headRef,
      baseRef,
      this.getCleanReleaseNotes(rel),
      rel.released_at
    );
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
    this.packageService.togglePackageFavorite(this.package);
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
    if (!this.authService.isLoggedIn() || this.isPackageAuthor() || !this.reviewComment.trim()) return;

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
      this.reviewsPage.set(1);
      this.persistCurrentViewState();
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
    if (!this.authService.isLoggedIn()) {
      this.openSignInForReview();
      return;
    }
    const targetRev = this.reviews().find(r => r.id === reviewId);
    if (targetRev && this.isOwnReview(targetRev)) return;
    if (this.flaggingReviewId() === reviewId) {
      this.flaggingReviewId.set(null);
      this.flagReviewReason = '';
    } else {
      this.flaggingReviewId.set(reviewId);
      this.flagReviewReason = '';
    }
  }

  async onConfirmFlagReview(rev: CommunityReview): Promise<void> {
    if (!this.authService.isLoggedIn() || !rev || this.isOwnReview(rev)) return;
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
      if (this.reviewsPage() > this.totalReviewPages()) {
        this.reviewsPage.set(this.totalReviewPages());
      }
      this.persistCurrentViewState();
      this.packageService.applyReviewAverageToPackage(this.package, updatedList);
      this.pwaService.showToast(res.message || 'Review removed.');
    } else if (res.message) {
      this.pwaService.showToast(res.message);
    }
  }

  toggleReportForm(): void {
    if (this.isPackageAuthor()) return;
    if (!this.authService.isLoggedIn()) {
      this.openSignInForReview();
      return;
    }
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
    if (!this.authService.isLoggedIn() || this.isPackageAuthor() || !this.reportDetails.trim()) return;
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

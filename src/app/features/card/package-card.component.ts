import {
  Component,
  ChangeDetectionStrategy,
  Input,
  inject,
  signal,
  ElementRef,
  ViewChild,
  HostListener,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { ImgFallbackDirective } from '../../shared/directives/img-fallback.directive';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { PackageBadgesComponent } from '../../shared/components/package-badges.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideStar,
  LucideHeart,
  LucideChevronDown,
  LucideDownload,
  LucideUser,
  LucideMaximize2
} from '@lucide/angular';

export const HOVER_VIDEO_INTENT_MS = 180;
export const HOVER_EMBED_FALLBACK_READY_MS = 320;

@Component({
  selector: 'app-package-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: flex; height: 100%; }'],
  imports: [
    CommonModule,
    ImgFallbackDirective,
    TooltipDirective,
    CompactNumberPipe,
    PackageBadgesComponent,
    TranslatePipe,
    LucideStar,
    LucideHeart,
    LucideChevronDown,
    LucideDownload,
    LucideUser,
    LucideMaximize2
  ],
  template: `
    <div
      (click)="openDetails()"
      (mouseenter)="onCardMouseEnter()"
      (mouseleave)="onCardMouseLeave()"
      role="button"
      tabindex="0"
      (keydown.enter)="openDetails()"
      (keydown.space)="openDetails()"
      [attr.aria-label]="package.title + ' ' + ('card.byAuthor' | translate) + ' ' + package.author"
      [class.origin-left]="isFirst"
      [class.origin-right]="isLast"
      [class.origin-center]="!isFirst && !isLast"
      class="group relative flex flex-col h-full min-h-[352px] w-full max-w-sm rounded-2xl glass-card cursor-pointer transition-all duration-300 ease-out hover:scale-105 sm:hover:scale-[1.06] hover:-translate-y-1.5 hover:z-30 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden">

      <!-- Thumbnail with True 16:9 Widescreen Aspect Ratio + Desktop Hover Video Preview -->
      <div class="relative w-full aspect-video flex-shrink-0 bg-slate-950">
        <!-- Isolated inner clip ends 1px above the bottom edge so the scaled <img> can never bleed past the vignette -->
        <div class="absolute inset-x-0 top-0 bottom-px overflow-hidden">
          <img
            [src]="package.banner || package.video_thumbnail_url || package.thumbnail"
            [fallbackThumbnail]="package.thumbnail"
            appImgFallback
            [alt]="package.title"
            loading="lazy"
            class="w-full h-full object-cover block group-hover:scale-105 transition-transform duration-300"
          />
        </div>

        <!-- Netflix-Style Desktop Hover Video Player (Muted by Default with Mute/Unmute & Enlarge Controls + Obstruction-Free Crop) -->
        @if (isHoverVideoActive() && package.video_url) {
          <div class="absolute -inset-px z-20 bg-black overflow-hidden animate-fade-in">
            @if (isDirectVideo(package.video_url)) {
              <video
                #hoverVideoEl
                [src]="package.video_url"
                [poster]="package.video_thumbnail_url || package.banner || package.thumbnail"
                [muted]="isHoverMuted()"
                preload="auto"
                autoplay
                loop
                playsinline
                disablePictureInPicture
                (timeupdate)="onDirectVideoTimeUpdate()"
                controlsList="nodownload nofullscreen noremoteplayback"
                class="w-full h-full object-cover pointer-events-none">
              </video>
            } @else if (hoverEmbedSafeUrl(); as safeEmbed) {
              <!-- Vertical aspect-ratio letterbox crop pushes YouTube top title/avatar bar and bottom watermark/controls outside overflow-hidden while keeping the 16:9 video centered -->
              <iframe
                #hoverIframeEl
                [src]="safeEmbed"
                [title]="package.title + ' preview'"
                (load)="onHoverIframeLoad()"
                tabindex="-1"
                aria-hidden="true"
                class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[106%] h-[240%] border-0 pointer-events-none select-none"
                allow="autoplay; encrypted-media">
              </iframe>
              <!-- Smooth thumbnail curtain hides initial YouTube buffer & center play/pause icon flash -->
              <img
                [src]="package.banner || package.video_thumbnail_url || package.thumbnail || 'logo.svg'"
                [fallbackThumbnail]="package.thumbnail"
                appImgFallback
                alt=""
                aria-hidden="true"
                [class]="'absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-200 ' + (isEmbedVideoReady() ? 'opacity-0' : 'opacity-100')"
              />
            }

            <!-- Subtle edge vignette to mask any residual player chrome -->
            <div class="absolute -inset-x-px -bottom-1 -top-px bg-gradient-to-b from-slate-950/35 via-transparent to-slate-950 to-95% pointer-events-none"></div>

            <!-- Floating Enlarge & Mute/Unmute Action Buttons -->
            <div class="absolute bottom-2 right-2 z-30 flex items-center gap-1.5">
              <button
                type="button"
                (click)="enlargeHoverVideo($event)"
                [appTooltip]="'card.enlargeVideo' | translate"
                [attr.aria-label]="'card.enlargeVideo' | translate"
                class="w-7 h-7 rounded-xl glass-btn text-slate-100 hover:text-sky-300 flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer shadow-lg">
                <svg lucideMaximize2 class="w-3.5 h-3.5"></svg>
              </button>

              <button
                type="button"
                (click)="toggleHoverMute($event)"
                [appTooltip]="(isHoverMuted() ? 'card.unmuteVideo' : 'card.muteVideo') | translate"
                [attr.aria-label]="(isHoverMuted() ? 'card.unmuteVideo' : 'card.muteVideo') | translate"
                class="w-7 h-7 rounded-xl glass-btn text-slate-100 hover:text-white flex items-center justify-center transition hover:scale-105 active:scale-95 cursor-pointer shadow-lg">
                @if (isHoverMuted()) {
                  <svg class="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                  </svg>
                } @else {
                  <svg class="w-3.5 h-3.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                  </svg>
                }
              </button>
            </div>
          </div>
        }

        <!-- Unclipped z-10 vignette overlaps the inner image clip boundary with a solid 5% base band -->
        <div class="absolute -inset-x-px -bottom-0.5 top-0 z-10 bg-gradient-to-t from-slate-950 from-5% via-slate-950/20 to-transparent pointer-events-none"></div>

        <!-- Rating pill on top right -->
        @if (package.score > 0) {
          <div class="absolute top-2.5 right-2.5 z-20 flex items-center gap-1 text-[11px] font-bold text-amber-400 glass-pill px-2 py-0.5 rounded-full">
            <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
            <span>{{ package.score }}</span>
          </div>
        }
      </div>

      <!-- Content Details with Equalized Flex Layout -->
      <div class="px-3.5 pt-3.5 pb-4 flex flex-col flex-1 justify-between min-h-0">

        <div class="space-y-2.5">
          <!-- Action Buttons Row (Direct .zip Download, Favorite, Details) -->
          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="onDownload($event)"
              [appTooltip]="('card.quickInstall' | translate) + (package.file_size ? ' (' + package.file_size + ')' : '')"
              [attr.aria-label]="'card.downloadZip' | translate"
              class="w-8 h-8 rounded-full glass-btn-primary text-white flex items-center justify-center transition hover:scale-105 cursor-pointer">
              <svg lucideDownload class="w-4 h-4 text-white"></svg>
            </button>

            <button
              type="button"
              (click)="onFavoriteClick($event)"
              [attr.aria-label]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
              [appTooltip]="settingsService.isFavorite(package.id) ? ('card.unfavoriteTooltip' | translate) : ('card.favoriteTooltip' | translate)"
              [class]="settingsService.isFavorite(package.id)
                ? 'w-8 h-8 rounded-full glass-icon-btn-rose-active text-rose-300 flex items-center justify-center transition hover:scale-105 cursor-pointer'
                : 'w-8 h-8 rounded-full glass-icon-btn-rose text-rose-200/90 hover:text-rose-300 flex items-center justify-center transition hover:scale-105 cursor-pointer'">
              <svg
                lucideHeart
                [class]="settingsService.isFavorite(package.id) ? 'w-3.5 h-3.5 fill-rose-500 text-rose-500 transition-colors' : 'w-3.5 h-3.5 transition-colors'"
                [style.fill]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'none'"
                [color]="settingsService.isFavorite(package.id) ? '#f43f5e' : 'currentColor'">
              </svg>
            </button>

            @if (package.downloads > 0) {
              <span class="text-[10px] font-mono text-slate-400 ml-1">
                {{ package.downloads | compactNumber }} dl
              </span>
            }

            <button
              type="button"
              (click)="openDetails($event)"
              [appTooltip]="'card.moreInfo' | translate"
              aria-label="More Information"
              class="w-8 h-8 rounded-full glass-icon-btn-sky text-sky-200/90 hover:text-white flex items-center justify-center ml-auto transition hover:scale-105 cursor-pointer">
              <svg lucideChevronDown class="w-4 h-4"></svg>
            </button>
          </div>

          <!-- Category & Source Badges Row in Content Section -->
          <app-package-badges
            [package]="package"
            [showGitTooltip]="true">
          </app-package-badges>

          <!-- Key Metrics: Match %, Real Engine Compatibility & License -->
          <div class="flex items-center gap-2 text-xs overflow-hidden whitespace-nowrap">
            <span class="text-emerald-400 font-bold text-[11px] flex-shrink-0">
              {{ packageService.getMatchScore(package) }}% {{ 'card.match' | translate }}
            </span>
            @if (package.min_minetest_version) {
              <span class="text-[10px] font-mono px-1.5 py-0.2 rounded glass-pill text-slate-300 flex-shrink-0">
                {{ package.min_minetest_version }}+
              </span>
            }
            @if (package.license || package.media_license) {
              <span class="text-[10px] font-mono text-slate-400 uppercase truncate">
                {{ package.license || package.media_license }}
              </span>
            }
          </div>

          <!-- Title (Fixed 1 line) & Short Description (Fixed 2-line height) -->
          <div>
            <h3 class="text-xs sm:text-sm font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1">
              {{ package.title }}
            </h3>
            <p class="text-[11px] text-slate-400 line-clamp-2 min-h-[2.25rem] leading-relaxed mt-0.5">
              {{ package.short_desc }}
            </p>
          </div>
        </div>

        <!-- Bottom Capped Single-Line Tags / Author Footer -->
        <div class="mt-auto pt-2 pb-0.5 flex items-center justify-between gap-1.5 text-[10px] text-slate-400 whitespace-nowrap min-h-[28px]">
          <div class="flex items-center gap-1.5 overflow-hidden min-w-0">
            @if (displayTags.length > 0) {
              @for (t of displayTags; track t; let last = $last) {
                <button
                  type="button"
                  (click)="onTagClick($event, t)"
                  class="hover:text-sky-300 transition truncate max-w-[78px] cursor-pointer">
                  #{{ t }}
                </button>
                @if (!last) {
                  <span class="text-slate-600 flex-shrink-0">•</span>
                }
              }
            } @else {
              <span class="text-slate-500 truncate">{{ 'card.byAuthor' | translate }} {{ package.author }}</span>
            }
          </div>

          <button
            type="button"
            (click)="onAuthorClick($event)"
            [appTooltip]="('author.viewProfile' | translate) + ' (@' + package.author + ')'"
            [attr.aria-label]="('author.viewProfile' | translate) + ' ' + package.author"
            class="px-1.5 py-0.5 rounded-md glass-pill text-slate-300 hover:text-sky-300 hover:border-sky-400/40 inline-flex items-center gap-1 flex-shrink-0 max-w-[110px] transition cursor-pointer">
            <svg lucideUser class="w-2.5 h-2.5 text-sky-400 flex-shrink-0"></svg>
            <span class="truncate font-medium">{{ package.author }}</span>
          </button>
        </div>

      </div>

    </div>
  `
})
export class PackageCardComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) package!: LuantiPackage;
  @Input() isFirst = false;
  @Input() isLast = false;

  @ViewChild('hoverVideoEl') hoverVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('hoverIframeEl') hoverIframeRef?: ElementRef<HTMLIFrameElement>;

  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly isHoverVideoActive = signal<boolean>(false);
  readonly isHoverMuted = signal<boolean>(true);
  readonly isEmbedVideoReady = signal<boolean>(false);
  readonly hoverEmbedSafeUrl = signal<SafeResourceUrl | null>(null);

  private hoverIntentTimer: any = null;
  private embedReadyTimer: any = null;
  private isPointerHovering = false;
  currentHoverSeconds = 0;

  ngOnChanges(): void {
    if (this.package && (!this.package.license || !this.package.downloads)) {
      this.packageService.ensurePackageHydrated(this.package);
    }
    if (this.package?.video_url && this.isDesktopHoverViewport()) {
      this.packageService.warmUpVideoPreview(this.package.video_url, this.package.video_thumbnail_url, false);
    }
  }

  ngOnDestroy(): void {
    this.clearHoverVideo();
  }

  get displayTags(): string[] {
    const pkgType = this.package.type?.toLowerCase();
    return (this.package.tags || []).filter(t => {
      const lower = t.toLowerCase();
      return lower !== pkgType && lower !== 'mod' && lower !== 'game' && lower !== 'txp' && lower !== 'texture_pack';
    }).slice(0, 3);
  }

  isDirectVideo(url?: string): boolean {
    return this.packageService.isDirectVideoUrl(url);
  }

  private isDesktopHoverViewport(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
  }

  private buildHoverEmbedUrl(rawUrl: string): string | null {
    return this.packageService.buildVideoEmbedUrl(rawUrl, {
      autoplay: true,
      mute: true,
      minimalControls: true
    });
  }

  private markEmbedVideoReady(): void {
    if (this.embedReadyTimer) {
      clearTimeout(this.embedReadyTimer);
      this.embedReadyTimer = null;
    }
    if (this.isHoverVideoActive() && !this.isEmbedVideoReady()) {
      this.isEmbedVideoReady.set(true);
    }
  }

  onDirectVideoTimeUpdate(): void {
    const videoEl = this.hoverVideoRef?.nativeElement;
    if (videoEl && Number.isFinite(videoEl.currentTime) && videoEl.currentTime > 0) {
      this.currentHoverSeconds = videoEl.currentTime;
    }
  }

  onHoverIframeLoad(): void {
    const iframeWin = this.hoverIframeRef?.nativeElement?.contentWindow;
    if (iframeWin) {
      try {
        iframeWin.postMessage(JSON.stringify({ event: 'listening' }), '*');
        iframeWin.postMessage(JSON.stringify({ method: 'addEventListener', value: 'play' }), '*');
        iframeWin.postMessage(JSON.stringify({ method: 'addEventListener', value: 'playProgress' }), '*');
      } catch {
        // Ignore cross-origin postMessage restrictions
      }
    }

    if (this.embedReadyTimer) {
      clearTimeout(this.embedReadyTimer);
    }
    this.embedReadyTimer = setTimeout(() => {
      this.embedReadyTimer = null;
      if (this.isHoverVideoActive()) {
        this.isEmbedVideoReady.set(true);
      }
    }, HOVER_EMBED_FALLBACK_READY_MS);
  }

  @HostListener('window:message', ['$event'])
  onWindowMessage(event: MessageEvent): void {
    if (!this.isHoverVideoActive()) return;
    const iframeWin = this.hoverIframeRef?.nativeElement?.contentWindow;
    if (iframeWin && event.source && event.source !== window && event.source !== iframeWin) {
      return;
    }
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (!data || typeof data !== 'object') return;

      // YouTube IFrame API events (onStateChange / infoDelivery)
      if (data.event === 'onStateChange' && Number(data.info) === 1) {
        this.markEmbedVideoReady();
        return;
      }
      if (data.event === 'infoDelivery' && data.info && typeof data.info === 'object') {
        if (typeof data.info.currentTime === 'number' && data.info.currentTime > 0) {
          this.currentHoverSeconds = data.info.currentTime;
        }
        if (Number(data.info.playerState) === 1 || Number(data.info.currentTime) > 0.05) {
          this.markEmbedVideoReady();
        }
        return;
      }

      // Vimeo player events (play / playProgress)
      if (data.event === 'play' || data.event === 'playProgress') {
        if (typeof data.data?.seconds === 'number' && data.data.seconds > 0) {
          this.currentHoverSeconds = data.data.seconds;
        }
        this.markEmbedVideoReady();
      }
    } catch {
      // Ignore non-JSON messages
    }
  }

  onCardMouseEnter(): void {
    if (!this.isDesktopHoverViewport()) return;
    this.isPointerHovering = true;
    this.packageService.ensurePackageHydrated(this.package, true);

    // Zero-delay T=0ms pre-warming (preconnect, video thumbnail, and direct MP4/WebM preload)
    if (this.package?.video_url) {
      this.packageService.warmUpVideoPreview(this.package.video_url, this.package.video_thumbnail_url, true);
    }

    // Start package detail hydration immediately at T=0ms in parallel with hover-intent timer
    const preloadDetailsPromise = (!this.package?.video_url && this.package)
      ? this.packageService.loadPackageDetails(this.package, false)
      : null;

    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
    }
    this.hoverIntentTimer = setTimeout(async () => {
      this.hoverIntentTimer = null;
      if (!this.isPointerHovering) return;

      let rawUrl = this.package?.video_url;
      if (!rawUrl && this.package) {
        if (preloadDetailsPromise) {
          await preloadDetailsPromise;
        } else {
          await this.packageService.loadPackageDetails(this.package, false);
        }
        if (!this.isPointerHovering) return;
        const hydrated = this.packageService.packages().find(
          p => p.id.toLowerCase() === this.package.id.toLowerCase()
        );
        rawUrl = hydrated?.video_url || this.package?.video_url;
      }
      if (!rawUrl || !this.isPointerHovering) return;

      this.packageService.warmUpVideoPreview(rawUrl, this.package?.video_thumbnail_url, true);
      this.currentHoverSeconds = 0;
      this.isHoverMuted.set(true);
      this.isEmbedVideoReady.set(false);
      if (!this.isDirectVideo(rawUrl)) {
        const embed = this.buildHoverEmbedUrl(rawUrl);
        if (!embed) return;
        this.hoverEmbedSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(embed));
      } else {
        this.hoverEmbedSafeUrl.set(null);
      }
      this.isHoverVideoActive.set(true);
    }, HOVER_VIDEO_INTENT_MS);
  }

  onCardMouseLeave(): void {
    this.clearHoverVideo();
  }

  private clearHoverVideo(): void {
    this.isPointerHovering = false;
    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
      this.hoverIntentTimer = null;
    }
    if (this.embedReadyTimer) {
      clearTimeout(this.embedReadyTimer);
      this.embedReadyTimer = null;
    }
    this.currentHoverSeconds = 0;
    if (this.isHoverVideoActive()) {
      this.isHoverVideoActive.set(false);
      this.isEmbedVideoReady.set(false);
      this.hoverEmbedSafeUrl.set(null);
      this.isHoverMuted.set(true);
    }
  }

  enlargeHoverVideo(event: MouseEvent): void {
    event.stopPropagation();
    const videoEl = this.hoverVideoRef?.nativeElement;
    const startSec =
      videoEl && Number.isFinite(videoEl.currentTime) && videoEl.currentTime > 0
        ? Math.floor(videoEl.currentTime)
        : Math.floor(this.currentHoverSeconds || 0);
    const targetPkg = this.package;
    this.clearHoverVideo();
    this.packageService.openVideoTheater(targetPkg, startSec);
  }

  toggleHoverMute(event: MouseEvent): void {
    event.stopPropagation();
    const nextMuted = !this.isHoverMuted();
    this.isHoverMuted.set(nextMuted);

    const videoEl = this.hoverVideoRef?.nativeElement;
    if (videoEl) {
      videoEl.muted = nextMuted;
      if (!nextMuted) {
        videoEl.volume = 0.75;
      }
      return;
    }

    const iframeEl = this.hoverIframeRef?.nativeElement;
    if (iframeEl?.contentWindow) {
      try {
        iframeEl.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: nextMuted ? 'mute' : 'unMute',
            args: []
          }),
          '*'
        );
      } catch {
        // Ignore cross-origin postMessage restrictions
      }
    }
  }

  openDetails(event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.packageService.openPackageModal(this.package);
  }

  onDownload(event: MouseEvent): void {
    event.stopPropagation();
    this.packageService.downloadPackage(this.package);
  }

  onFavoriteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.settingsService.toggleFavorite(this.package.id);
  }

  onTagClick(event: MouseEvent, tag: string): void {
    event.stopPropagation();
    if (this.packageService.activePackage()) {
      this.packageService.filterByTagFromModal(tag);
    } else {
      this.packageService.setTagFilter(tag);
    }
  }

  onAuthorClick(event: MouseEvent): void {
    event.stopPropagation();
    this.packageService.openAuthorDrawer(this.package.author, true, this.packageService.activePackage());
  }
}

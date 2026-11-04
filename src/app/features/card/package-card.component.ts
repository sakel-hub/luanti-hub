import {
  Component,
  ChangeDetectionStrategy,
  Input,
  inject,
  signal,
  ElementRef,
  ViewChild,
  NgZone,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LuantiPackage } from '../../core/models/package.model';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { formatContentDbCdnUrl, isContentDbThumbnailUrl } from '../../core/config/git-providers.config';
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
  LucideMaximize2,
  LucideVolume2,
  LucideVolumeX
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
    LucideMaximize2,
    LucideVolume2,
    LucideVolumeX
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
      [attr.aria-label]="package.title + ' ' + ('card.byAuthor' | translate) + ' ' + authorDisplayName"
      [class.origin-left]="isFirst"
      [class.origin-right]="isLast"
      [class.origin-center]="!isFirst && !isLast"
      class="group relative flex flex-col h-full min-h-[352px] w-full max-w-sm rounded-2xl glass-card cursor-pointer transition-all duration-300 ease-out hover:scale-105 sm:hover:scale-[1.06] hover:-translate-y-1.5 hover:z-30 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden">

      <!-- Thumbnail with True 16:9 Widescreen Aspect Ratio + Desktop Hover Video Preview -->
      <div class="relative w-full aspect-video flex-shrink-0">
        <!-- Isolated inner clip ends 1px above the bottom edge with a multi-stop alpha feather mask so the scaled <img> blends seamlessly into glass-card without a solid dark bar or zoom seam -->
        <div class="absolute inset-x-0 top-0 bottom-px overflow-hidden card-thumbnail-mask">
          <img
            [src]="cardBannerUrl"
            [fallbackThumbnail]="cardFallbackThumbnail"
            appImgFallback
            (error)="onCardBannerError(cardBannerUrl, $event)"
            [alt]="seoImageAlt"
            loading="lazy"
            class="w-full h-full object-cover block group-hover:scale-105 transition-transform duration-300"
          />
        </div>

        <!-- Netflix-Style Desktop Hover Video Player (Muted by Default with Mute/Unmute & Enlarge Controls + Obstruction-Free Crop) -->
        @if (isHoverVideoActive() && package.video_url) {
          <div class="absolute inset-0 z-20 bg-slate-950 overflow-hidden animate-fade-in">
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
                class="w-full h-full object-cover block pointer-events-none">
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
                class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[108%] h-[240%] border-0 pointer-events-none select-none"
                allow="autoplay; encrypted-media">
              </iframe>
              <!-- Smooth thumbnail curtain hides initial YouTube buffer & center play/pause icon flash -->
              <img
                [src]="cardBannerUrl"
                [fallbackThumbnail]="cardFallbackThumbnail"
                appImgFallback
                alt=""
                aria-hidden="true"
                [class]="'absolute inset-0 w-full h-full object-cover block pointer-events-none transition-opacity duration-200 ' + (isEmbedVideoReady() ? 'opacity-0' : 'opacity-100')"
              />
            }

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
                  <svg lucideVolumeX class="w-3.5 h-3.5 text-slate-300"></svg>
                } @else {
                  <svg lucideVolume2 class="w-3.5 h-3.5 text-sky-400"></svg>
                }
              </button>
            </div>
          </div>
        }

        <!-- Soft feathered z-10 vignette blends the bottom of the thumbnail into glass-card without a solid dark bar (removed while hover video plays and restored on mouse leave) -->
        @if (!(isHoverVideoActive() && package.video_url)) {
          <div
            data-testid="card-thumbnail-vignette"
            class="absolute inset-x-0 bottom-0 top-0 z-10 card-thumbnail-vignette pointer-events-none">
          </div>
        }

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
            <span
              class="text-emerald-400 font-bold text-[11px] flex-shrink-0 cursor-help"
              [appTooltip]="'card.matchTooltip' | translate">
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

          <!-- Title (Fixed 1 line with Crawlable Internal Package Link) & Short Description (Fixed 2-line height) -->
          <div>
            <h3 class="text-xs sm:text-sm font-bold text-white group-hover:text-sky-300 transition-colors line-clamp-1">
              <a
                [href]="packageUrl"
                (click)="onTitleLinkClick($event)"
                class="text-inherit hover:text-sky-300 no-underline focus:outline-none">
                {{ package.title }}
              </a>
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
              <span class="text-slate-500 truncate">{{ 'card.byAuthor' | translate }} {{ authorDisplayName }}</span>
            }
          </div>

          <button
            type="button"
            (click)="onAuthorClick($event)"
            [appTooltip]="('author.viewProfile' | translate) + ' (@' + authorDisplayName + ')'"
            [attr.aria-label]="('author.viewProfile' | translate) + ' ' + authorDisplayName"
            class="px-1.5 py-0.5 rounded-md glass-pill text-slate-300 hover:text-sky-300 hover:border-sky-400/40 inline-flex items-center gap-1 flex-shrink-0 max-w-[110px] transition cursor-pointer">
            <svg lucideUser class="w-2.5 h-2.5 text-sky-400 flex-shrink-0"></svg>
            <span class="truncate font-medium">{{ authorDisplayName }}</span>
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
  private readonly ngZone = inject(NgZone);

  readonly isHoverVideoActive = signal<boolean>(false);
  readonly isHoverMuted = signal<boolean>(true);
  readonly isEmbedVideoReady = signal<boolean>(false);
  readonly hoverEmbedSafeUrl = signal<SafeResourceUrl | null>(null);
  readonly failedBannerUrls = signal<Set<string>>(new Set());

  private hoverIntentTimer: any = null;
  private embedReadyTimer: any = null;
  private isPointerHovering = false;
  private isMessageListenerAttached = false;
  private readonly boundWindowMessageHandler = (event: MessageEvent) => this.onWindowMessage(event);
  currentHoverSeconds = 0;

  ngOnChanges(): void {
    if (this.package && this.packageService.needsTileHydration(this.package)) {
      this.packageService.ensurePackageHydrated(this.package);
    }
    if (this.package?.video_url && this.isDesktopHoverViewport()) {
      this.packageService.warmUpVideoPreview(this.package.video_url, this.package.video_thumbnail_url, false);
    }
  }

  ngOnDestroy(): void {
    this.clearHoverVideo();
  }

  onCardBannerError(url: string, event?: Event): void {
    const imgEl = event?.target as HTMLImageElement | null;
    const actualFailedSrc =
      imgEl?.getAttribute('data-lh-failed-src')?.trim() ||
      url;
    const normalized = this.packageService.toProxiedGitImageIfNeeded(actualFailedSrc) ?? actualFailedSrc;
    this.failedBannerUrls.update(prev => {
      const next = new Set(prev);
      if (actualFailedSrc && actualFailedSrc !== 'logo.svg') next.add(actualFailedSrc);
      if (normalized && normalized !== 'logo.svg') next.add(normalized);
      return next;
    });
  }

  get cardBannerUrl(): string {
    const failed = this.failedBannerUrls();
    const gitCandidates = [
      this.package?.banner,
      ...(this.package?.screenshots ?? []),
      this.package?.thumbnail
    ].filter(u => Boolean(u) && this.packageService.isGitScreenshotUrl(u));
    const nonThumbBanner =
      this.package?.banner && !isContentDbThumbnailUrl(this.package.banner)
        ? this.package.banner
        : undefined;
    const nonThumbScreenshots = (this.package?.screenshots ?? []).filter(
      u => Boolean(u) && !isContentDbThumbnailUrl(u)
    );
    const rawCandidates = [
      ...gitCandidates,
      nonThumbBanner,
      ...nonThumbScreenshots,
      this.package?.video_thumbnail_url,
      this.package?.banner,
      ...(this.package?.screenshots ?? []),
      this.package?.thumbnail
    ];
    const candidates = rawCandidates
      .map(u => {
        if (typeof u !== 'string' || !u.trim()) return undefined;
        const proxied = this.packageService.toProxiedGitImageIfNeeded(u) ?? u;
        if (this.packageService.isGitScreenshotUrl(proxied)) return proxied;
        return formatContentDbCdnUrl(proxied, 'tile') || proxied;
      })
      .filter((u): u is string => Boolean(u) && u !== 'logo.svg');
    return (
      candidates.find(u => !failed.has(u)) ||
      candidates.find(u => !this.packageService.isGitScreenshotUrl(u)) ||
      'logo.svg'
    );
  }

  get cardFallbackThumbnail(): string | undefined {
    const primary = this.cardBannerUrl;
    const failed = this.failedBannerUrls();
    const rawThumb = this.package?.thumbnail;
    const proxiedThumbRaw = this.packageService.toProxiedGitImageIfNeeded(rawThumb) ?? rawThumb;
    const proxiedThumb =
      proxiedThumbRaw && !this.packageService.isGitScreenshotUrl(proxiedThumbRaw)
        ? formatContentDbCdnUrl(proxiedThumbRaw, 'tile') || proxiedThumbRaw
        : proxiedThumbRaw;
    if (proxiedThumb && proxiedThumb !== 'logo.svg' && proxiedThumb !== primary && !failed.has(proxiedThumb)) {
      return proxiedThumb;
    }
    const distinctShot = (this.package?.screenshots ?? [])
      .map(url => {
        const p = this.packageService.toProxiedGitImageIfNeeded(url) ?? url;
        return p && !this.packageService.isGitScreenshotUrl(p)
          ? formatContentDbCdnUrl(p, 'tile') || p
          : p;
      })
      .find(url => Boolean(url) && url !== 'logo.svg' && url !== primary && !failed.has(url));
    if (distinctShot) {
      return distinctShot;
    }
    if (proxiedThumb && proxiedThumb !== 'logo.svg' && !this.packageService.isGitScreenshotUrl(proxiedThumb)) {
      return proxiedThumb;
    }
    return undefined;
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
      this.ngZone.run(() => {
        this.isEmbedVideoReady.set(true);
      });
    }
  }

  private attachHoverMessageListener(): void {
    if (this.isMessageListenerAttached || typeof window === 'undefined') return;
    this.isMessageListenerAttached = true;
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('message', this.boundWindowMessageHandler);
    });
  }

  private detachHoverMessageListener(): void {
    if (!this.isMessageListenerAttached || typeof window === 'undefined') return;
    this.isMessageListenerAttached = false;
    window.removeEventListener('message', this.boundWindowMessageHandler);
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

    const rawUrl = this.package?.video_url;
    if (!rawUrl) return;

    const rawThumbUrl = this.package?.video_thumbnail_url;
    // Pre-warm existing video preview URL if already present on the package object (zero D1/API cost)
    this.packageService.warmUpVideoPreview(rawUrl, rawThumbUrl, true);

    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
    }
    this.hoverIntentTimer = setTimeout(() => {
      this.hoverIntentTimer = null;
      if (!this.isPointerHovering || !this.package) return;

      const activeVideoUrl = this.package?.video_url;
      if (!activeVideoUrl) return;

      this.packageService.warmUpVideoPreview(activeVideoUrl, this.package?.video_thumbnail_url, true);
      this.currentHoverSeconds = 0;
      this.isHoverMuted.set(true);
      this.isEmbedVideoReady.set(false);
      if (!this.isDirectVideo(activeVideoUrl)) {
        const embed = this.buildHoverEmbedUrl(activeVideoUrl);
        if (!embed) return;
        this.hoverEmbedSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(embed));
        this.attachHoverMessageListener();
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
    this.detachHoverMessageListener();
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

  get packageUrl(): string {
    const author = this.package?.author || '';
    const name = this.package?.name || '';
    return `/package/${encodeURIComponent(author)}/${encodeURIComponent(name)}`;
  }

  get authorDisplayName(): string {
    return this.packageService.getAuthorDisplayName(this.package);
  }

  get seoImageAlt(): string {
    if (!this.package) return 'Luanti Package';
    const typeLabel =
      this.package.type === 'game'
        ? 'Game'
        : this.package.type === 'txp'
          ? 'Texture Pack'
          : 'Mod';
    return `${this.package.title} – Luanti ${typeLabel} by ${this.authorDisplayName}`;
  }

  onTitleLinkClick(event: MouseEvent): void {
    // Allow Cmd+Click / Ctrl+Click / Middle-Click / Shift+Click to open in a new tab naturally
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.openDetails();
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
    this.packageService.openAuthorDrawer(this.authorDisplayName || this.package.author, true, this.packageService.activePackage());
  }
}

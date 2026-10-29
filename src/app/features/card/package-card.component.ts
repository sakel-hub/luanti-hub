import {
  Component,
  ChangeDetectionStrategy,
  Input,
  inject,
  signal,
  ElementRef,
  ViewChild,
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
  LucideDownload
} from '@lucide/angular';

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
    LucideDownload
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
      class="group relative flex flex-col h-full min-h-[336px] max-h-[364px] flex-shrink-0 w-60 sm:w-68 rounded-2xl glass-card cursor-pointer transition-all duration-300 ease-out hover:scale-105 sm:hover:scale-[1.06] hover:-translate-y-1.5 hover:z-30 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden">

      <!-- Thumbnail with True 16:9 Widescreen Aspect Ratio + Desktop Hover Video Preview -->
      <div class="relative w-full aspect-video flex-shrink-0 bg-slate-950 overflow-hidden">
        <img
          [src]="package.banner || package.video_thumbnail_url || package.thumbnail"
          [fallbackThumbnail]="package.thumbnail"
          appImgFallback
          [alt]="package.title"
          loading="lazy"
          decoding="async"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />

        <!-- Netflix-Style Desktop Hover Video Player (Muted by Default with Mute/Unmute Toggle) -->
        @if (isHoverVideoActive() && package.video_url) {
          <div class="absolute inset-0 z-10 bg-black animate-fade-in">
            @if (isDirectVideo(package.video_url)) {
              <video
                #hoverVideoEl
                [src]="package.video_url"
                [poster]="package.video_thumbnail_url || package.banner || package.thumbnail"
                [muted]="isHoverMuted()"
                autoplay
                loop
                playsinline
                class="w-full h-full object-cover">
              </video>
            } @else if (hoverEmbedSafeUrl(); as safeEmbed) {
              <iframe
                #hoverIframeEl
                [src]="safeEmbed"
                [title]="package.title + ' preview'"
                class="w-full h-full border-0 pointer-events-none scale-[1.04]"
                allow="autoplay; encrypted-media">
              </iframe>
            }

            <!-- Floating Mute / Unmute Toggle Button -->
            <button
              type="button"
              (click)="toggleHoverMute($event)"
              [attr.aria-label]="(isHoverMuted() ? 'card.unmuteVideo' : 'card.muteVideo') | translate"
              class="absolute bottom-2 right-2 z-20 w-7 h-7 rounded-full bg-slate-950/80 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-md flex items-center justify-center transition hover:scale-110 cursor-pointer shadow-lg">
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
        }

        <div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent pointer-events-none"></div>

        <!-- Rating pill on top right -->
        @if (package.score > 0) {
          <div class="absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold text-amber-400 glass-pill px-2 py-0.5 rounded-full">
            <svg lucideStar class="w-3 h-3 fill-amber-400 text-amber-400" [style.fill]="'#fbbf24'" [color]="'#fbbf24'"></svg>
            <span>{{ package.score }}</span>
          </div>
        }
      </div>

      <!-- Content Details with Equalized Flex Layout -->
      <div class="p-3.5 flex flex-col flex-1 justify-between min-h-0">

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
              class="w-8 h-8 rounded-full glass-icon-btn text-white flex items-center justify-center transition hover:scale-105 cursor-pointer">
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
              class="w-8 h-8 rounded-full glass-icon-btn text-white flex items-center justify-center ml-auto transition hover:scale-105 cursor-pointer">
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
        <div class="mt-auto pt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400 overflow-hidden whitespace-nowrap min-h-[22px]">
          @if (displayTags.length > 0) {
            @for (t of displayTags; track t; let last = $last) {
              <button
                type="button"
                (click)="onTagClick($event, t)"
                class="hover:text-sky-300 transition truncate max-w-[90px] cursor-pointer">
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

      </div>

    </div>
  `
})
export class PackageCardComponent implements OnDestroy {
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
  readonly hoverEmbedSafeUrl = signal<SafeResourceUrl | null>(null);

  private hoverIntentTimer: any = null;

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
    if (!url) return false;
    const clean = url.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.ogg') || clean.endsWith('.ogv');
  }

  private isDesktopHoverViewport(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches;
  }

  private buildHoverEmbedUrl(rawUrl: string): string | null {
    try {
      const u = new URL(rawUrl);
      const host = u.hostname.toLowerCase();
      if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
        const v = u.searchParams.get('v') || (u.pathname.startsWith('/embed/') ? u.pathname.split('/embed/')[1]?.split('/')[0] : null);
        if (v) {
          return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v)}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&loop=1&playlist=${encodeURIComponent(v)}&enablejsapi=1&playsinline=1`;
        }
      }
      if (host === 'youtu.be') {
        const id = u.pathname.split('/').filter(Boolean)[0];
        if (id) {
          return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&loop=1&playlist=${encodeURIComponent(id)}&enablejsapi=1&playsinline=1`;
        }
      }
      if (host.includes('vimeo.com')) {
        const id = u.pathname.split('/').filter(Boolean).pop();
        if (id && /^\d+$/.test(id)) {
          return `https://player.vimeo.com/video/${id}?autoplay=1&muted=1&background=1`;
        }
      }
      if (u.pathname.includes('/videos/watch/')) {
        return rawUrl.replace('/videos/watch/', '/videos/embed/') + (rawUrl.includes('?') ? '&autoplay=1&muted=1&controls=0' : '?autoplay=1&muted=1&controls=0');
      }
      return null;
    } catch {
      return null;
    }
  }

  onCardMouseEnter(): void {
    this.packageService.ensurePackageHydrated(this.package);
    if (!this.isDesktopHoverViewport()) return;

    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
    }
    this.hoverIntentTimer = setTimeout(async () => {
      this.hoverIntentTimer = null;
      let rawUrl = this.package?.video_url;
      if (!rawUrl && this.package) {
        await this.packageService.loadPackageDetails(this.package, false);
        const hydrated = this.packageService.packages().find(
          p => p.id.toLowerCase() === this.package.id.toLowerCase()
        );
        rawUrl = hydrated?.video_url || this.package?.video_url;
      }
      if (!rawUrl) return;
      this.isHoverMuted.set(true);
      if (!this.isDirectVideo(rawUrl)) {
        const embed = this.buildHoverEmbedUrl(rawUrl);
        if (!embed) return;
        this.hoverEmbedSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(embed));
      } else {
        this.hoverEmbedSafeUrl.set(null);
      }
      this.isHoverVideoActive.set(true);
    }, 380);
  }

  onCardMouseLeave(): void {
    this.clearHoverVideo();
  }

  private clearHoverVideo(): void {
    if (this.hoverIntentTimer) {
      clearTimeout(this.hoverIntentTimer);
      this.hoverIntentTimer = null;
    }
    if (this.isHoverVideoActive()) {
      this.isHoverVideoActive.set(false);
      this.hoverEmbedSafeUrl.set(null);
      this.isHoverMuted.set(true);
    }
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
    this.packageService.setTagFilter(tag);
  }
}

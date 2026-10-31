import { Component, ChangeDetectionStrategy, inject, HostListener, effect, signal, computed, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HeaderComponent } from './features/header/header.component';
import { PackageDetailModalComponent } from './features/modal/package-detail-modal.component';
import { SubmitModalComponent } from './features/submit/submit-modal.component';
import { SetupGuideModalComponent } from './features/setup-guide/setup-guide-modal.component';
import { AuthModalComponent } from './features/auth/auth-modal.component';
import { ProfileDrawerComponent } from './features/profile/profile-drawer.component';
import { AuthorDrawerComponent } from './features/author/author-drawer.component';
import { FrostedPreloaderComponent } from './shared/components/frosted-preloader.component';
import { PackageService } from './core/services/package.service';
import { PwaService } from './core/services/pwa.service';
import { AuthService } from './core/services/auth.service';
import { LuantiPackage } from './core/models/package.model';
import { TranslatePipe } from './core/i18n/translate.pipe';
import { LucideX, LucideShieldCheck, LucideCheck, LucideDownload, LucideInfo } from '@lucide/angular';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    TranslatePipe,
    HeaderComponent,
    PackageDetailModalComponent,
    SubmitModalComponent,
    SetupGuideModalComponent,
    AuthModalComponent,
    ProfileDrawerComponent,
    AuthorDrawerComponent,
    FrostedPreloaderComponent,
    LucideX,
    LucideShieldCheck,
    LucideCheck,
    LucideDownload,
    LucideInfo
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  readonly packageService = inject(PackageService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly currentYear = new Date().getFullYear();

  // Animated enter/exit state for all dialogs & drawers
  readonly displayedPackage = signal<LuantiPackage | null>(null);
  readonly isClosingPackageModal = signal(false);

  readonly displayedVideoTheater = signal<{ pkg: LuantiPackage; startSeconds: number } | null>(null);
  readonly isClosingVideoTheater = signal(false);

  readonly theaterSafeEmbedUrl = computed<SafeResourceUrl | null>(() => {
    const state = this.displayedVideoTheater();
    const rawUrl = state?.pkg?.video_url;
    if (!rawUrl || this.packageService.isDirectVideoUrl(rawUrl)) return null;
    const embedUrl = this.packageService.buildVideoEmbedUrl(rawUrl, {
      autoplay: true,
      mute: false,
      minimalControls: false,
      startSeconds: state.startSeconds
    });
    if (!embedUrl) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  });

  readonly renderSubmitModal = signal(false);
  readonly isClosingSubmitModal = signal(false);

  readonly renderSetupModal = signal(false);
  readonly isClosingSetupModal = signal(false);

  readonly renderAuthModal = signal(false);
  readonly isClosingAuthModal = signal(false);

  readonly renderProfileDrawer = signal(false);
  readonly isClosingProfileDrawer = signal(false);

  readonly renderAuthorDrawer = signal(false);
  readonly isClosingAuthorDrawer = signal(false);

  readonly renderLegalModal = signal(false);
  readonly isClosingLegalModal = signal(false);

  private pkgCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private videoTheaterCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private savedScrollY = 0;
  private wasModalOpen = false;

  constructor() {
    // Smooth enter + exit transitions for Package Detail Modal
    effect(() => {
      const pkg = this.packageService.activePackage();
      if (pkg) {
        if (this.pkgCloseTimer) {
          clearTimeout(this.pkgCloseTimer);
          this.pkgCloseTimer = null;
        }
        this.isClosingPackageModal.set(false);
        this.displayedPackage.set(pkg);
      } else if (this.displayedPackage() && !this.isClosingPackageModal()) {
        this.isClosingPackageModal.set(true);
        this.pkgCloseTimer = setTimeout(() => {
          this.displayedPackage.set(null);
          this.isClosingPackageModal.set(false);
          this.pkgCloseTimer = null;
        }, 200);
      }
    });

    // Smooth enter + exit transitions for Cinema Video Theater Dialog
    effect(() => {
      const vt = this.packageService.activeVideoTheater();
      if (vt) {
        if (this.videoTheaterCloseTimer) {
          clearTimeout(this.videoTheaterCloseTimer);
          this.videoTheaterCloseTimer = null;
        }
        this.isClosingVideoTheater.set(false);
        this.displayedVideoTheater.set(vt);
      } else if (this.displayedVideoTheater() && !this.isClosingVideoTheater()) {
        this.isClosingVideoTheater.set(true);
        this.videoTheaterCloseTimer = setTimeout(() => {
          this.displayedVideoTheater.set(null);
          this.isClosingVideoTheater.set(false);
          this.videoTheaterCloseTimer = null;
        }, 200);
      }
    });

    this.bindAnimatedOverlay(() => this.packageService.isSubmitModalOpen(), this.renderSubmitModal, this.isClosingSubmitModal, 200);
    this.bindAnimatedOverlay(() => this.packageService.isSetupModalOpen(), this.renderSetupModal, this.isClosingSetupModal, 200);
    this.bindAnimatedOverlay(() => this.authService.isAuthModalOpen(), this.renderAuthModal, this.isClosingAuthModal, 200);
    this.bindAnimatedOverlay(() => this.authService.isProfileDrawerOpen(), this.renderProfileDrawer, this.isClosingProfileDrawer, 220);
    this.bindAnimatedOverlay(() => Boolean(this.packageService.activeAuthorUsername()), this.renderAuthorDrawer, this.isClosingAuthorDrawer, 220);
    this.bindAnimatedOverlay(() => this.packageService.isLegalModalOpen(), this.renderLegalModal, this.isClosingLegalModal, 200);

    // Lock background scroll whenever a modal or drawer is open while preserving scroll position
    effect(() => {
      if (typeof document === 'undefined' || typeof window === 'undefined') return;
      const anyModalOpen = Boolean(
        this.packageService.activePackage() ||
        this.packageService.activeVideoTheater() ||
        this.packageService.activeAuthorUsername() ||
        this.packageService.isSubmitModalOpen() ||
        this.packageService.isSetupModalOpen() ||
        this.packageService.isLegalModalOpen() ||
        this.authService.isAuthModalOpen() ||
        (this.authService.isProfileDrawerOpen() && this.authService.currentUser())
      );
      if (anyModalOpen && !this.wasModalOpen) {
        this.savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        this.wasModalOpen = true;
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        if (this.savedScrollY > 0 && window.scrollY !== this.savedScrollY) {
          window.scrollTo({ top: this.savedScrollY, behavior: 'instant' as ScrollBehavior });
        }
      } else if (!anyModalOpen && this.wasModalOpen) {
        const restoreY = this.savedScrollY;
        this.wasModalOpen = false;
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        if (restoreY > 0 && window.scrollY !== restoreY) {
          window.scrollTo({ top: restoreY, behavior: 'instant' as ScrollBehavior });
        }
      }
    });
  }

  private bindAnimatedOverlay(
    source: () => boolean,
    rendered: WritableSignal<boolean>,
    closing: WritableSignal<boolean>,
    durationMs: number
  ): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const isOpen = source();
      if (isOpen) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        closing.set(false);
        rendered.set(true);
      } else if (rendered() && !closing()) {
        closing.set(true);
        timer = setTimeout(() => {
          rendered.set(false);
          closing.set(false);
          timer = null;
        }, durationMs);
      }
    });
  }

  onFooterNavClick(
    event: MouseEvent,
    target: 'game' | 'mod' | 'txp' | 'git' | 'setup' | 'submit' | 'legal'
  ): void {
    if (event && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
    }
    if (target === 'setup') {
      this.packageService.openSetupModal();
    } else if (target === 'submit') {
      this.packageService.openSubmitModal();
    } else if (target === 'legal') {
      this.packageService.openLegalModal();
    } else {
      this.packageService.closeAllModals(false);
      this.packageService.selectPrimaryNavTab(target);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  onTheaterVideoLoadedMetadata(event: Event, startSeconds: number): void {
    if (!startSeconds || startSeconds <= 0) return;
    const videoEl = event.target as HTMLVideoElement | null;
    if (videoEl && Number.isFinite(startSeconds)) {
      try {
        videoEl.currentTime = startSeconds;
      } catch {
        // Ignore seek errors before stream is seekable
      }
    }
  }

  // Keyboard Shortcuts: '/' to search, 'Escape' to close modals
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    const activeTag = document.activeElement?.tagName;
    if (event.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
      event.preventDefault();
      document.getElementById('main-search-input')?.focus();
    } else if (event.key === 'Escape') {
      if (this.packageService.activeVideoTheater()) {
        this.packageService.closeVideoTheater();
      } else if (this.authService.isAuthModalOpen()) {
        this.authService.closeAuthModal();
      } else if (this.authService.isProfileDrawerOpen()) {
        this.authService.closeProfileDrawer();
      } else if (this.packageService.activeAuthorUsername()) {
        this.packageService.closeAuthorDrawer();
      } else if (this.packageService.activePackage()) {
        if (this.packageService.tryCloseModalSubOverlay()) {
          return;
        }
        this.packageService.closePackageModal();
      } else if (this.packageService.isSubmitModalOpen()) {
        this.packageService.closeSubmitModal();
      } else if (this.packageService.isSetupModalOpen()) {
        this.packageService.closeSetupModal();
      } else if (this.packageService.isLegalModalOpen()) {
        this.packageService.closeLegalModal();
      }
    }
  }
}

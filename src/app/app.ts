import { Component, ChangeDetectionStrategy, inject, HostListener, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HeaderComponent } from './features/header/header.component';
import { PackageDetailModalComponent } from './features/modal/package-detail-modal.component';
import { SubmitModalComponent } from './features/submit/submit-modal.component';
import { SetupGuideModalComponent } from './features/setup-guide/setup-guide-modal.component';
import { AuthModalComponent } from './features/auth/auth-modal.component';
import { ProfileDrawerComponent } from './features/profile/profile-drawer.component';
import { PackageService } from './core/services/package.service';
import { PwaService } from './core/services/pwa.service';
import { AuthService } from './core/services/auth.service';
import { TranslatePipe } from './core/i18n/translate.pipe';
import { LucideX, LucideShieldCheck, LucideCheck } from '@lucide/angular';

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
    LucideX,
    LucideShieldCheck,
    LucideCheck
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  readonly packageService = inject(PackageService);
  readonly pwaService = inject(PwaService);
  readonly authService = inject(AuthService);

  constructor() {
    // Lock background body scroll whenever a modal or drawer is open
    effect(() => {
      if (typeof document === 'undefined') return;
      const anyModalOpen = Boolean(
        this.packageService.activePackage() ||
        this.packageService.isSubmitModalOpen() ||
        this.packageService.isSetupModalOpen() ||
        this.packageService.isLegalModalOpen() ||
        this.authService.isAuthModalOpen() ||
        this.authService.isProfileDrawerOpen()
      );
      document.body.style.overflow = anyModalOpen ? 'hidden' : '';
    });
  }

  // Keyboard Shortcuts: '/' to search, 'Escape' to close modals
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    const activeTag = document.activeElement?.tagName;
    if (event.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
      event.preventDefault();
      document.getElementById('main-search-input')?.focus();
    } else if (event.key === 'Escape') {
      if (this.authService.isAuthModalOpen()) {
        this.authService.closeAuthModal();
      } else if (this.authService.isProfileDrawerOpen()) {
        this.authService.closeProfileDrawer();
      } else if (this.packageService.activePackage()) {
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

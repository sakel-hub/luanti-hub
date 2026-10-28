import { Component, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeaderComponent } from './features/header/header.component';
import { HeroBillboardComponent } from './features/hero/hero-billboard.component';
import { PackageCarouselComponent } from './features/carousel/package-carousel.component';
import { PackageCardComponent } from './features/card/package-card.component';
import { PackageDetailModalComponent } from './features/modal/package-detail-modal.component';
import { SubmitModalComponent } from './features/submit/submit-modal.component';
import { SetupGuideModalComponent } from './features/setup-guide/setup-guide-modal.component';
import { PackageService } from './core/services/package.service';
import { PwaService } from './core/services/pwa.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    HeroBillboardComponent,
    PackageCarouselComponent,
    PackageCardComponent,
    PackageDetailModalComponent,
    SubmitModalComponent,
    SetupGuideModalComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  readonly packageService = inject(PackageService);
  readonly pwaService = inject(PwaService);

  // Keyboard Shortcuts: '/' to search, 'Escape' to close modals
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      document.getElementById('main-search-input')?.focus();
    } else if (event.key === 'Escape') {
      if (this.packageService.activePackage()) {
        this.packageService.closePackageModal();
      } else if (this.packageService.isSubmitModalOpen()) {
        this.packageService.closeSubmitModal();
      } else if (this.packageService.isSetupModalOpen()) {
        this.packageService.closeSetupModal();
      }
    }
  }
}

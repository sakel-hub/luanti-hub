import { Directive, HostListener, ElementRef, Input } from '@angular/core';
import { toProxiedGitImageIfNeeded } from '../../core/config/git-providers.config';

@Directive({
  selector: 'img[appImgFallback]',
  standalone: true
})
export class ImgFallbackDirective {
  @Input() fallbackThumbnail?: string;
  private triedFallbackThumbnail = false;

  constructor(private el: ElementRef<HTMLImageElement>) {}

  @HostListener('error')
  onError(): void {
    const img = this.el.nativeElement;
    const currentSrc = img.getAttribute('src') ?? img.src ?? '';

    // Step 1: If high-res PNG failed, try high-res JPG
    if (currentSrc.includes('shot-0.png')) {
      img.src = img.src.replace('shot-0.png', 'shot-0.jpg');
      return;
    }

    // Step 2: Try the package's fallbackThumbnail (normalized through Git proxy if needed) once
    const candidateFallback = toProxiedGitImageIfNeeded(this.fallbackThumbnail);
    if (
      !this.triedFallbackThumbnail &&
      candidateFallback &&
      candidateFallback !== 'logo.svg' &&
      !currentSrc.endsWith(candidateFallback) &&
      img.src !== candidateFallback
    ) {
      this.triedFallbackThumbnail = true;
      img.src = candidateFallback;
      return;
    }

    // Step 3: If fallback thumbnail also failed, fallback to LuantiHub SVG logo
    if (!img.src.endsWith('logo.svg')) {
      img.src = 'logo.svg';
    }
  }
}

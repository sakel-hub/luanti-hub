import { Directive, HostListener, ElementRef, Input, OnChanges, SimpleChanges } from '@angular/core';
import { toProxiedGitImageIfNeeded } from '../../core/config/git-providers.config';

@Directive({
  selector: 'img[appImgFallback]',
  standalone: true
})
export class ImgFallbackDirective implements OnChanges {
  @Input() fallbackThumbnail?: string;
  private failedFallbackSrc = '';
  private lastPrimarySrc = '';

  constructor(private el: ElementRef<HTMLImageElement>) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['fallbackThumbnail']) {
      this.failedFallbackSrc = '';
    }
  }

  @HostListener('load')
  onLoad(): void {
    const img = this.el.nativeElement;
    const currentSrc = img.getAttribute('src') ?? img.src ?? '';
    if (
      currentSrc.includes('proxy_image=') &&
      img.naturalWidth === 1 &&
      img.naturalHeight === 1
    ) {
      img.setAttribute('data-lh-failed-1x1', currentSrc);
      this.onError();
      return;
    }
    this.failedFallbackSrc = '';
    img.removeAttribute('data-lh-failed-src');
  }

  @HostListener('error')
  onError(): void {
    const img = this.el.nativeElement;
    const currentSrc = img.getAttribute('src') ?? img.src ?? '';
    if (currentSrc && !currentSrc.endsWith('logo.svg')) {
      img.setAttribute('data-lh-failed-src', currentSrc);
    }

    // Step 1: If high-res PNG failed, try high-res JPG
    if (currentSrc.includes('shot-0.png')) {
      img.src = img.src.replace('shot-0.png', 'shot-0.jpg');
      return;
    }

    // Step 2: Try the package's fallbackThumbnail (normalized through Git proxy if needed).
    // Always fall back to fallbackThumbnail when a primary [src] fails, unless the URL that
    // just failed IS fallbackThumbnail itself (recorded in failedFallbackSrc).
    const candidateFallback = toProxiedGitImageIfNeeded(this.fallbackThumbnail);
    const isCurrentlyOnFallback =
      Boolean(candidateFallback) &&
      (currentSrc === candidateFallback ||
        currentSrc.endsWith(candidateFallback) ||
        img.src === candidateFallback ||
        img.src.endsWith(candidateFallback));

    if (!isCurrentlyOnFallback && currentSrc && !currentSrc.endsWith('logo.svg') && currentSrc !== this.lastPrimarySrc) {
      this.lastPrimarySrc = currentSrc;
      this.failedFallbackSrc = '';
    }

    if (isCurrentlyOnFallback && candidateFallback) {
      this.failedFallbackSrc = candidateFallback;
    }

    if (
      candidateFallback &&
      candidateFallback !== 'logo.svg' &&
      !isCurrentlyOnFallback &&
      this.failedFallbackSrc !== candidateFallback
    ) {
      img.src = candidateFallback;
      return;
    }

    // Step 3: If fallback thumbnail also failed, fallback to LuantiHub SVG logo
    if (!img.src.endsWith('logo.svg')) {
      img.src = 'logo.svg';
    }
  }
}

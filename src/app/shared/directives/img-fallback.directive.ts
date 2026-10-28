import { Directive, HostListener, ElementRef, Input } from '@angular/core';

@Directive({
  selector: 'img[appImgFallback]',
  standalone: true
})
export class ImgFallbackDirective {
  @Input() fallbackThumbnail?: string;

  constructor(private el: ElementRef<HTMLImageElement>) {}

  @HostListener('error')
  onError(): void {
    const img = this.el.nativeElement;
    // Step 1: If high-res PNG failed, try high-res JPG
    if (img.src.includes('shot-0.png')) {
      img.src = img.src.replace('shot-0.png', 'shot-0.jpg');
    } 
    // Step 2: If high-res JPG failed, try the original thumbnail
    else if (img.src.includes('shot-0.jpg')) {
      img.src = this.fallbackThumbnail || 'logo.svg';
    } 
    // Step 3: If thumbnail failed, fallback to LuantiHub SVG logo
    else if (!img.src.endsWith('logo.svg')) {
      img.src = 'logo.svg';
    }
  }
}

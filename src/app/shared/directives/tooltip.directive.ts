import {
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  NgZone,
  inject
} from '@angular/core';
import { TranslationService } from '../../core/i18n/translation.service';
import { TranslationKey } from '../../core/i18n/translation.types';

@Directive({
  selector: '[appTooltip]',
  standalone: true
})
export class TooltipDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef, { optional: true });
  private readonly translationService = inject(TranslationService, { optional: true });
  private readonly ngZone = inject(NgZone);

  @Input() appTooltip: string = '';
  @Input() appTooltipKey?: TranslationKey;
  @Input() appTooltipShortcut?: string;
  @Input() appTooltipPlacement: 'top' | 'bottom' | 'left' | 'right' = 'bottom';
  @Input('tooltipPosition')
  set tooltipPositionAlias(pos: 'top' | 'bottom' | 'left' | 'right' | undefined) {
    if (pos) {
      this.appTooltipPlacement = pos;
    }
  }
  @Input() appTooltipDelay: number = 180;
  @Input() appTooltipMultiline: boolean = false;
  @Input() appTooltipTap: boolean = false;

  private tooltipEl: HTMLElement | null = null;
  private currentTooltipId: string | null = null;
  private showTimeout: any = null;
  private lastTouchTime = 0;
  private cleanups: (() => void)[] = [];
  private escapeCleanup: (() => void) | null = null;
  private outsideTapCleanup: (() => void) | null = null;

  private static activeInstance: TooltipDirective | null = null;
  private static globalListenersInitialized = false;

  private static initGlobalListeners(ngZone: NgZone): void {
    if (this.globalListenersInitialized || typeof window === 'undefined') return;
    this.globalListenersInitialized = true;

    ngZone.runOutsideAngular(() => {
      const dismissActive = () => {
        if (TooltipDirective.activeInstance) {
          TooltipDirective.activeInstance.hide();
        }
      };

      // Immediately dismiss any active tooltip when scrolling occurs on window, carousels, or containers
      window.addEventListener('scroll', dismissActive, { capture: true, passive: true });
      window.addEventListener('wheel', dismissActive, { passive: true });
      window.addEventListener('touchmove', dismissActive, { passive: true });
      window.addEventListener('visibilitychange', () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          dismissActive();
        }
      });
    });
  }

  private isInteractiveTapTarget(native: HTMLElement): boolean {
    if (this.appTooltipTap || this.appTooltipMultiline) return true;
    if (!native) return false;
    if (
      native.classList?.contains('cursor-help') ||
      native.hasAttribute?.('data-tooltip-tap') ||
      native.getAttribute?.('aria-disabled') === 'true'
    ) {
      return true;
    }
    if (native.tagName === 'SPAN') {
      return true;
    }
    if (typeof native.querySelector === 'function') {
      if (native.querySelector('[lucideInfo], [lucideAlertCircle], [lucideHelpCircle]')) {
        return true;
      }
    }
    return false;
  }

  ngOnInit(): void {
    if (typeof window === 'undefined' || !this.el?.nativeElement) return;
    const native = this.el.nativeElement as HTMLElement;

    TooltipDirective.initGlobalListeners(this.ngZone);

    // Attach listeners OUTSIDE Angular zone to avoid triggering change detection on hover
    this.ngZone.runOutsideAngular(() => {
      const onMouseEnter = () => {
        if (Date.now() - this.lastTouchTime < 800) return;
        this.scheduleShow();
      };

      const onMouseLeave = () => {
        if (Date.now() - this.lastTouchTime < 800) return;
        this.hide();
      };

      const onTouchStart = () => {
        this.lastTouchTime = Date.now();
        if (!this.isInteractiveTapTarget(native)) {
          this.hide();
        }
      };

      const onFocusIn = () => {
        if (Date.now() - this.lastTouchTime < 800) return;
        this.scheduleShow();
      };

      const onFocusOut = () => {
        this.hide();
      };

      const onClick = (e: MouseEvent) => {
        if (this.isInteractiveTapTarget(native)) {
          const isAriaDisabled = native.getAttribute?.('aria-disabled') === 'true';
          if (
            native.classList?.contains('cursor-help') ||
            this.appTooltipMultiline ||
            this.appTooltipTap ||
            isAriaDisabled
          ) {
            e.stopPropagation();
            if (isAriaDisabled) {
              e.preventDefault();
            }
          }
          if (TooltipDirective.activeInstance === this && this.tooltipEl) {
            this.hide();
          } else {
            this.clearTimeout();
            this.show(true);
          }
          return;
        }
        this.hide();
      };

      native.addEventListener('mouseenter', onMouseEnter, { passive: true });
      native.addEventListener('mouseleave', onMouseLeave, { passive: true });
      native.addEventListener('touchstart', onTouchStart, { passive: true });
      native.addEventListener('focusin', onFocusIn, { passive: true });
      native.addEventListener('focusout', onFocusOut, { passive: true });
      native.addEventListener('click', onClick);

      this.cleanups.push(
        () => native.removeEventListener('mouseenter', onMouseEnter),
        () => native.removeEventListener('mouseleave', onMouseLeave),
        () => native.removeEventListener('touchstart', onTouchStart),
        () => native.removeEventListener('focusin', onFocusIn),
        () => native.removeEventListener('focusout', onFocusOut),
        () => native.removeEventListener('click', onClick)
      );
    });
  }

  ngOnDestroy(): void {
    this.hide();
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
  }

  private scheduleShow(): void {
    this.clearTimeout();
    if (!this.appTooltip && !this.appTooltipKey) return;

    if (TooltipDirective.activeInstance && TooltipDirective.activeInstance !== this) {
      TooltipDirective.activeInstance.hide();
    }

    this.showTimeout = setTimeout(() => {
      this.show();
    }, this.appTooltipDelay);
  }

  private clearTimeout(): void {
    if (this.showTimeout) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }
  }

  private resolveTooltipText(): string {
    if (this.appTooltipKey && this.translationService) {
      return this.translationService.t(this.appTooltipKey);
    }

    const text = this.appTooltip;
    if (this.translationService && text && !text.includes(' ') && text.includes('.')) {
      const translated = this.translationService.t(text as TranslationKey);
      if (translated !== text) {
        return translated;
      }
    }

    return text;
  }

  private show(forceShow = false): void {
    if (this.tooltipEl || typeof document === 'undefined' || !this.el?.nativeElement) return;
    const native = this.el.nativeElement as HTMLElement;

    // Element must still be connected to DOM and actively hovered/focused (unless triggered by tap)
    if (!native.isConnected) return;
    if (
      !forceShow &&
      typeof native.matches === 'function' &&
      !native.matches(':hover, :focus-visible, :focus-within')
    ) {
      return;
    }

    // Dismiss any previously active tooltip instance
    if (TooltipDirective.activeInstance && TooltipDirective.activeInstance !== this) {
      TooltipDirective.activeInstance.hide();
    }

    // Clean up any orphaned tooltip elements in the DOM
    document.querySelectorAll('.luanti-tooltip').forEach(node => node.remove());

    let text = this.resolveTooltipText();
    if (!text) return;

    let shortcut = this.appTooltipShortcut;
    if (!shortcut && text.includes('|')) {
      const parts = text.split('|');
      text = parts[0].trim();
      shortcut = parts[1].trim();
    }

    const tipId = `luanti-tip-${Math.random().toString(36).substring(2, 9)}`;
    this.currentTooltipId = tipId;

    const isMultiline = this.appTooltipMultiline || text.length > 52;
    const tip = document.createElement('div');
    tip.id = tipId;
    tip.className = isMultiline
      ? 'luanti-tooltip fixed z-[9999] max-w-xs sm:max-w-sm px-3.5 py-2.5 text-xs font-medium leading-relaxed border rounded-xl shadow-2xl backdrop-blur-xl pointer-events-none whitespace-normal text-left transition-opacity duration-150'
      : 'luanti-tooltip fixed z-[9999] px-2.5 py-1 text-xs font-medium border rounded-lg shadow-2xl backdrop-blur-md pointer-events-none flex items-center gap-1.5 whitespace-nowrap transition-opacity duration-150';
    tip.style.opacity = '0';
    tip.setAttribute('role', 'tooltip');

    const span = document.createElement('span');
    span.textContent = text;
    tip.appendChild(span);

    if (shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'px-1.5 py-0.5 text-[10px] font-mono font-semibold border rounded shadow-sm';
      kbd.textContent = shortcut;
      tip.appendChild(kbd);
    }

    document.body.appendChild(tip);
    this.tooltipEl = tip;
    TooltipDirective.activeInstance = this;

    if (this.el.nativeElement && typeof this.el.nativeElement.setAttribute === 'function') {
      this.el.nativeElement.setAttribute('aria-describedby', tipId);
    }

    this.positionTooltip();
    tip.style.opacity = '1';

    // Single escape handler only while tooltip is active
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', onDocKey, { capture: true });
    this.escapeCleanup = () => document.removeEventListener('keydown', onDocKey, { capture: true } as EventListenerOptions);

    // Dismiss when tapping/clicking anywhere outside the trigger element
    const onOutsidePointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (target && native.contains(target)) {
        return;
      }
      this.hide();
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, { capture: true, passive: true });
    document.addEventListener('touchstart', onOutsidePointerDown, { capture: true, passive: true });
    this.outsideTapCleanup = () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown, { capture: true } as EventListenerOptions);
      document.removeEventListener('touchstart', onOutsidePointerDown, { capture: true } as EventListenerOptions);
    };
  }

  private positionTooltip(): void {
    if (!this.tooltipEl || !this.el) return;

    const hostRect = this.el.nativeElement.getBoundingClientRect();
    const tipRect = this.tooltipEl.getBoundingClientRect();
    const gap = 6;

    let top = 0;
    let left = 0;

    switch (this.appTooltipPlacement) {
      case 'top':
        top = hostRect.top - tipRect.height - gap;
        left = hostRect.left + (hostRect.width - tipRect.width) / 2;
        break;
      case 'left':
        top = hostRect.top + (hostRect.height - tipRect.height) / 2;
        left = hostRect.left - tipRect.width - gap;
        break;
      case 'right':
        top = hostRect.top + (hostRect.height - tipRect.height) / 2;
        left = hostRect.right + gap;
        break;
      case 'bottom':
      default:
        top = hostRect.bottom + gap;
        left = hostRect.left + (hostRect.width - tipRect.width) / 2;
        break;
    }

    const padding = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (
      (this.appTooltipPlacement === 'right' && left + tipRect.width > viewportWidth - padding) ||
      (this.appTooltipPlacement === 'left' && left < padding)
    ) {
      top = hostRect.bottom + gap;
      if (top + tipRect.height > viewportHeight - padding) {
        top = hostRect.top - tipRect.height - gap;
      }
      left = hostRect.left + (hostRect.width - tipRect.width) / 2;
    } else if (top < padding && this.appTooltipPlacement === 'top') {
      top = hostRect.bottom + gap;
    } else if (top + tipRect.height > viewportHeight - padding && this.appTooltipPlacement === 'bottom') {
      top = hostRect.top - tipRect.height - gap;
    }

    if (left < padding) {
      left = padding;
    } else if (left + tipRect.width > viewportWidth - padding) {
      left = viewportWidth - tipRect.width - padding;
    }

    if (top < padding) {
      top = padding;
    } else if (top + tipRect.height > viewportHeight - padding) {
      top = viewportHeight - tipRect.height - padding;
    }

    this.tooltipEl.style.top = `${Math.round(top)}px`;
    this.tooltipEl.style.left = `${Math.round(left)}px`;
  }

  public hide(): void {
    this.clearTimeout();
    if (TooltipDirective.activeInstance === this) {
      TooltipDirective.activeInstance = null;
    }
    if (this.escapeCleanup) {
      this.escapeCleanup();
      this.escapeCleanup = null;
    }
    if (this.outsideTapCleanup) {
      this.outsideTapCleanup();
      this.outsideTapCleanup = null;
    }
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
    if (
      this.currentTooltipId &&
      this.el &&
      this.el.nativeElement &&
      typeof this.el.nativeElement.getAttribute === 'function'
    ) {
      if (this.el.nativeElement.getAttribute('aria-describedby') === this.currentTooltipId) {
        this.el.nativeElement.removeAttribute('aria-describedby');
      }
      this.currentTooltipId = null;
    }
  }
}

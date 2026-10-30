import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type FrostedPreloaderVariant = 'overlay' | 'card' | 'pill' | 'inline';
export type FrostedPreloaderSize = 'sm' | 'md' | 'lg';
export type FrostedPreloaderAccent = 'sky' | 'emerald' | 'amber' | 'rose';

@Component({
  selector: 'app-frosted-preloader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @switch (variant) {
      @case ('overlay') {
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          class="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md luanti-backdrop">
          <div class="glass-preloader-card rounded-3xl px-7 py-6 flex flex-col items-center justify-center gap-3.5 max-w-xs w-full text-center luanti-dialog-panel">
            <ng-container *ngTemplateOutlet="orbitalSpinner"></ng-container>
            @if (label) {
              <div class="space-y-1">
                <p class="text-sm font-bold text-white tracking-tight">{{ label }}</p>
                @if (sublabel) {
                  <p class="text-xs text-slate-400 leading-relaxed">{{ sublabel }}</p>
                }
              </div>
            }
          </div>
        </div>
      }

      @case ('card') {
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          class="glass-preloader-card rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-center w-full">
          <ng-container *ngTemplateOutlet="orbitalSpinner"></ng-container>
          @if (label) {
            <div class="space-y-1">
              <p class="text-xs sm:text-sm font-bold text-white">{{ label }}</p>
              @if (sublabel) {
                <p class="text-[11px] text-slate-400 leading-relaxed">{{ sublabel }}</p>
              }
            </div>
          }
        </div>
      }

      @case ('pill') {
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          [attr.aria-label]="label || 'Loading'"
          class="h-9 px-2.5 sm:px-3 rounded-lg glass-btn border-sky-400/35 bg-sky-950/35 text-sky-200 font-semibold text-xs inline-flex items-center gap-2 whitespace-nowrap flex-shrink-0 select-none cursor-wait shadow-sm">
          <ng-container *ngTemplateOutlet="orbitalSpinner"></ng-container>
          @if (label) {
            <span class="hidden sm:inline whitespace-nowrap">{{ label }}</span>
          }
        </div>
      }

      @case ('inline') {
        <span
          role="status"
          aria-live="polite"
          aria-busy="true"
          class="inline-flex items-center justify-center gap-2 select-none">
          <ng-container *ngTemplateOutlet="orbitalSpinner"></ng-container>
          @if (label) {
            <span class="text-xs font-semibold">{{ label }}</span>
          }
        </span>
      }
    }

    <ng-template #orbitalSpinner>
      <div
        class="relative inline-flex items-center justify-center flex-shrink-0"
        [ngClass]="spinnerContainerClass">
        <!-- Soft Ambient Frosted Glow -->
        <span
          class="absolute inset-0 rounded-full blur-md opacity-60 pointer-events-none"
          [ngClass]="ambientGlowClass">
        </span>

        <!-- Outer Orbital Ring -->
        <span
          class="absolute inset-0 rounded-full border-2 border-white/10 luanti-orbital-ring"
          [ngClass]="outerRingAccentClass">
        </span>

        <!-- Inner Counter-Rotating Orbital Ring -->
        @if (size !== 'sm') {
          <span
            class="absolute rounded-full border border-white/10 luanti-orbital-ring-reverse"
            [ngClass]="innerRingSizeAndAccentClass">
          </span>
        }

        <!-- Pulsing Luanti Voxel/Crystal Core -->
        <span
          class="relative rounded-sm rotate-45 luanti-core-pulse"
          [ngClass]="coreSizeAndAccentClass">
        </span>
      </div>
    </ng-template>
  `
})
export class FrostedPreloaderComponent {
  @Input() variant: FrostedPreloaderVariant = 'card';
  @Input() size: FrostedPreloaderSize = 'md';
  @Input() label = '';
  @Input() sublabel = '';
  @Input() accent: FrostedPreloaderAccent = 'sky';

  get spinnerContainerClass(): string {
    switch (this.size) {
      case 'sm':
        return 'w-4 h-4';
      case 'lg':
        return 'w-12 h-12';
      case 'md':
      default:
        return 'w-9 h-9';
    }
  }

  get ambientGlowClass(): string {
    switch (this.accent) {
      case 'emerald':
        return 'bg-emerald-400/25';
      case 'amber':
        return 'bg-amber-400/25';
      case 'rose':
        return 'bg-rose-400/25';
      case 'sky':
      default:
        return 'bg-sky-400/30';
    }
  }

  get outerRingAccentClass(): string {
    switch (this.accent) {
      case 'emerald':
        return 'border-t-emerald-400 border-r-emerald-400/35';
      case 'amber':
        return 'border-t-amber-400 border-r-amber-400/35';
      case 'rose':
        return 'border-t-rose-400 border-r-rose-400/35';
      case 'sky':
      default:
        return 'border-t-sky-400 border-r-sky-400/35';
    }
  }

  get innerRingSizeAndAccentClass(): string {
    const dim = this.size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';
    switch (this.accent) {
      case 'emerald':
        return `${dim} border-b-sky-300/80 border-l-emerald-300/40`;
      case 'amber':
        return `${dim} border-b-amber-300/80 border-l-sky-300/40`;
      case 'rose':
        return `${dim} border-b-rose-300/80 border-l-amber-300/40`;
      case 'sky':
      default:
        return `${dim} border-b-emerald-300/80 border-l-sky-300/40`;
    }
  }

  get coreSizeAndAccentClass(): string {
    const dim = this.size === 'sm' ? 'w-1.5 h-1.5' : this.size === 'lg' ? 'w-3 h-3' : 'w-2 h-2';
    switch (this.accent) {
      case 'emerald':
        return `${dim} bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)]`;
      case 'amber':
        return `${dim} bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.9)]`;
      case 'rose':
        return `${dim} bg-rose-300 shadow-[0_0_12px_rgba(251,113,133,0.9)]`;
      case 'sky':
      default:
        return `${dim} bg-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.9)]`;
    }
  }
}

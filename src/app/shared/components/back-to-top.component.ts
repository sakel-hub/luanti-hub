import {
  Component,
  ChangeDetectionStrategy,
  Input,
  Output,
  EventEmitter
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipDirective } from '../directives/tooltip.directive';
import { LucideArrowUp } from '@lucide/angular';

@Component({
  selector: 'app-back-to-top',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TooltipDirective, LucideArrowUp],
  template: `
    <button
      type="button"
      (click)="onClick($event)"
      [appTooltip]="visible ? label : ''"
      [attr.aria-label]="label"
      [inert]="!visible"
      [attr.data-testid]="testId"
      [class]="buttonClasses">
      <svg lucideArrowUp class="w-4 h-4 text-sky-300 transition-transform duration-200 group-hover:-translate-y-0.5"></svg>
    </button>
  `
})
export class BackToTopComponent {
  @Input() visible = false;
  @Input() position: 'fixed' | 'absolute' = 'fixed';
  @Input() offsetBottomClass = '';
  @Input() label = 'Back to top';
  @Input() testId = 'back-to-top-btn';

  @Output() readonly scrollToTop = new EventEmitter<void>();

  get buttonClasses(): string {
    const posClass =
      this.position === 'absolute'
        ? 'absolute right-4 sm:right-5 z-30'
        : 'fixed right-4 sm:right-5 z-30';
    const bottomClass =
      this.offsetBottomClass ||
      (this.position === 'absolute'
        ? 'bottom-4 sm:bottom-5'
        : 'bottom-[max(1rem,env(safe-area-inset-bottom,1rem))] sm:bottom-5');
    const stateClass = this.visible
      ? 'opacity-60 hover:opacity-100 focus-visible:opacity-100 translate-y-0 hover:-translate-y-0.5 active:scale-95 pointer-events-auto cursor-pointer'
      : 'opacity-0 translate-y-2 pointer-events-none';

    return `${posClass} ${bottomClass} ${stateClass} group w-9 h-9 sm:w-10 sm:h-10 rounded-full glass-back-to-top text-slate-200 hover:text-white flex items-center justify-center`;
  }

  onClick(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.visible) return;
    (event.currentTarget as HTMLElement | null)?.blur?.();
    this.scrollToTop.emit();
  }
}

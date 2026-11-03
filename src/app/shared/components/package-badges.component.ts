import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { TooltipDirective } from '../directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LucideGitBranch, LucideGlobe } from '@lucide/angular';

@Component({
  selector: 'app-package-badges',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; }'],
  imports: [
    CommonModule,
    TooltipDirective,
    TranslatePipe,
    LucideGitBranch,
    LucideGlobe
  ],
  template: `
    <div [class]="compact ? 'inline-flex items-center gap-1 flex-wrap' : 'flex items-center gap-1.5 flex-wrap'">
      <!-- Category Type Badge (MOD / GAME / TXP) -->
      <span
        [class]="typeBadgeClass + (compact ? ' text-[9px] px-1.5 py-0' : '')"
        class="glass-badge font-black uppercase tracking-wider">
        {{ package.type }}
      </span>

      <!-- Official ContentDB Source Badge -->
      @if (showOfficial && isOfficialSource) {
        <span [class]="compact ? 'glass-badge glass-badge-emerald font-bold text-[9px] px-1.5 py-0' : 'glass-badge glass-badge-emerald font-bold'">
          <svg lucideGlobe [class]="compact ? 'w-2.5 h-2.5 text-emerald-300 flex-shrink-0' : 'w-3 h-3 text-emerald-300 flex-shrink-0'"></svg>
          <span>ContentDB</span>
        </span>
      }

      <!-- Decentralized Git Source Badge -->
      @if (isGitSource) {
        <span
          [appTooltip]="showGitTooltip ? ('card.gitSourceTooltip' | translate) : ''"
          [class]="compact ? 'glass-badge glass-badge-amber font-bold text-[9px] px-1.5 py-0' : 'glass-badge glass-badge-amber font-bold'">
          <svg lucideGitBranch [class]="compact ? 'w-2.5 h-2.5 text-amber-300 flex-shrink-0' : 'w-3 h-3 text-amber-300 flex-shrink-0'"></svg>
          <span>Git</span>
        </span>
      }

      <!-- Featured Badge (Detail Modal) -->
      @if (showFeatured && package.featured) {
        <span [class]="compact ? 'glass-badge glass-badge-sky font-bold text-[9px] px-1.5 py-0' : 'glass-badge glass-badge-sky font-bold'">
          Featured
        </span>
      }

      <ng-content></ng-content>
    </div>
  `
})
export class PackageBadgesComponent {
  @Input({ required: true }) package!: LuantiPackage;
  @Input() showFeatured = false;
  @Input() showGitTooltip = false;
  @Input() showOfficial = true;
  @Input() compact = false;

  get typeBadgeClass(): string {
    if (this.package?.type === 'game') {
      return 'glass-badge-emerald';
    }
    if (this.package?.type === 'txp') {
      return 'glass-badge-purple';
    }
    return 'glass-badge-sky';
  }

  get isOfficialSource(): boolean {
    return Boolean(
      this.package?.sources?.includes('official') ||
      this.package?.source === 'official' ||
      this.package?.source === 'mirror'
    );
  }

  get isGitSource(): boolean {
    return Boolean(
      this.package?.sources?.includes('git') ||
      this.package?.source === 'git'
    );
  }
}

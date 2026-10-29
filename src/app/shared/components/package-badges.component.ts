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
    <div class="flex items-center gap-1.5 flex-wrap">
      <!-- Category Type Badge (MOD / GAME / TXP) -->
      <span
        [class]="typeBadgeClass"
        class="glass-badge font-black uppercase tracking-wider">
        {{ package.type }}
      </span>

      <!-- Official ContentDB Source Badge -->
      @if (isOfficialSource) {
        <span class="glass-badge glass-badge-emerald font-bold">
          <svg lucideGlobe class="w-3 h-3 text-emerald-300 flex-shrink-0"></svg>
          <span>ContentDB</span>
        </span>
      }

      <!-- Decentralized Git Source Badge -->
      @if (isGitSource) {
        <span
          [appTooltip]="showGitTooltip ? ('card.gitSourceTooltip' | translate) : ''"
          class="glass-badge glass-badge-amber font-bold">
          <svg lucideGitBranch class="w-3 h-3 text-amber-300 flex-shrink-0"></svg>
          <span>Git</span>
        </span>
      }

      <!-- Featured Badge (Detail Modal) -->
      @if (showFeatured && package.featured) {
        <span class="glass-badge glass-badge-sky font-bold">
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

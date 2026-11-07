import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage } from '../../core/models/package.model';
import { hasOrganicCodeTag } from '../../core/config/package-utils.config';
import { TooltipDirective } from '../directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LucideGitBranch, LucideGlobe, LucideLeaf } from '@lucide/angular';

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
    LucideGlobe,
    LucideLeaf
  ],
  template: `
    <div [class]="compact ? 'inline-flex items-center gap-1 flex-wrap' : 'flex items-center gap-1.5 flex-wrap'">
      <!-- Optional Top 10 Rank Badge -->
      @if (top10Label) {
        <span
          data-testid="top10-badge"
          (click)="$event.stopPropagation()"
          [appTooltip]="'card.top10BadgeTooltip' | translate"
          [appTooltipTap]="true"
          [class]="badgePillClass('glass-badge-rose font-black uppercase tracking-wider')">
          {{ top10Label }}
        </span>
      }

      <!-- Category Type Badge (MOD / GAME / TXP) -->
      @if (showType) {
        <span
          data-testid="type-badge"
          (click)="$event.stopPropagation()"
          [appTooltip]="typeTooltipKey | translate"
          [appTooltipTap]="true"
          [class]="badgePillClass(typeBadgeClass + ' font-black uppercase tracking-wider')">
          {{ package.type }}
        </span>
      }

      <!-- Official ContentDB Source Badge -->
      @if (showOfficial && isOfficialSource) {
        <span
          data-testid="contentdb-badge"
          (click)="$event.stopPropagation()"
          [appTooltip]="'card.contentDbSourceTooltip' | translate"
          [appTooltipTap]="true"
          [class]="badgePillClass('glass-badge-emerald font-bold')">
          <svg lucideGlobe [class]="iconClass('text-emerald-300')"></svg>
          <span>ContentDB</span>
        </span>
      }

      <!-- Decentralized Git Source Badge -->
      @if (showGit && isGitSource) {
        <span
          data-testid="git-badge"
          (click)="$event.stopPropagation()"
          [appTooltip]="showGitTooltip ? ('card.gitSourceTooltip' | translate) : ''"
          [appTooltipTap]="true"
          [class]="badgePillClass('glass-badge-amber font-bold')">
          <svg lucideGitBranch [class]="iconClass('text-amber-300')"></svg>
          <span>Git</span>
        </span>
      }

      <!-- 100% Organic Code Badge (LuantiHub Custom Badge Tag) -->
      @if (isOrganicCode) {
        <span
          data-testid="organic-code-badge"
          (click)="$event.stopPropagation()"
          [appTooltip]="'card.organicCodeTooltip' | translate"
          [appTooltipTap]="true"
          [attr.aria-label]="'card.organicCodeLabel' | translate"
          [class]="badgePillClass('glass-badge-emerald font-bold')">
          <svg lucideLeaf [class]="iconClass('text-emerald-400')"></svg>
        </span>
      }

      <!-- Featured Badge (Detail Modal) -->
      @if (showFeatured && package.featured) {
        <span
          data-testid="featured-badge"
          (click)="$event.stopPropagation()"
          [appTooltip]="'card.featuredBadgeTooltip' | translate"
          [appTooltipTap]="true"
          [class]="badgePillClass('glass-badge-sky font-bold')">
          Featured
        </span>
      }

      <ng-content></ng-content>
    </div>
  `
})
export class PackageBadgesComponent {
  @Input({ required: true }) package!: LuantiPackage;
  @Input() showType = true;
  @Input() showFeatured = false;
  @Input() showGitTooltip = true;
  @Input() showOfficial = true;
  @Input() showGit = true;
  @Input() top10Label = '';
  @Input() compact = false;

  badgePillClass(variantClasses: string): string {
    return `glass-badge ${variantClasses} cursor-default select-none${this.compact ? ' glass-badge-compact' : ''}`;
  }

  iconClass(colorClass: string): string {
    return `${this.compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} ${colorClass} flex-shrink-0`;
  }

  get typeBadgeClass(): string {
    if (this.package?.type === 'game') {
      return 'glass-badge-emerald';
    }
    if (this.package?.type === 'txp') {
      return 'glass-badge-purple';
    }
    return 'glass-badge-sky';
  }

  get typeTooltipKey(): string {
    if (this.package?.type === 'game') {
      return 'card.typeGameTooltip';
    }
    if (this.package?.type === 'txp') {
      return 'card.typeTxpTooltip';
    }
    return 'card.typeModTooltip';
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

  get isOrganicCode(): boolean {
    return hasOrganicCodeTag(this.package);
  }
}

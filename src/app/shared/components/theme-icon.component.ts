import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideTrophy,
  LucideGamepad2,
  LucideSparkles,
  LucideFlame,
  LucideStar,
  LucideRocket,
  LucideGitBranch,
  LucideZap,
  LucideCpu,
  LucidePalette,
  LucideTag,
  LucidePin,
  LucideGlobe,
  LucideLightbulb,
  LucideThumbsUp,
  LucideThumbsDown
} from '@lucide/angular';
import { PromoRowIcon } from '../../core/models/package.model';

export type ThemeIconName =
  | PromoRowIcon
  | 'git'
  | 'zap'
  | 'cpu'
  | 'palette'
  | 'tag'
  | 'pin'
  | 'globe'
  | 'lightbulb'
  | 'thumbs-up'
  | 'thumbs-down';

export interface ThemeIconOption {
  readonly value: PromoRowIcon;
  readonly label: string;
  readonly colorClass: string;
}

/**
 * Centralized icon options for Promotional Package Rows & Swimlanes.
 * Uses consistent Lucide vector icons and semantic glassmorphic accent tokens
 * across Carousels, Admin Promotions UI, and Badges (no OS emojis or one-off SVGs).
 */
export const PROMO_ROW_ICON_OPTIONS: readonly ThemeIconOption[] = [
  { value: 'trophy', label: 'Trophy', colorClass: 'text-amber-400' },
  { value: 'gamepad', label: 'Gamepad', colorClass: 'text-emerald-400' },
  { value: 'sparkles', label: 'Sparkles', colorClass: 'text-amber-400' },
  { value: 'flame', label: 'Flame', colorClass: 'text-amber-500' },
  { value: 'star', label: 'Star', colorClass: 'text-amber-400' },
  { value: 'rocket', label: 'Rocket', colorClass: 'text-sky-400' }
] as const;

export const THEME_ICON_COLORS: Readonly<Record<ThemeIconName, string>> = {
  trophy: 'text-amber-400',
  gamepad: 'text-emerald-400',
  sparkles: 'text-amber-400',
  flame: 'text-amber-500',
  star: 'text-amber-400',
  rocket: 'text-sky-400',
  git: 'text-amber-400',
  zap: 'text-amber-400',
  cpu: 'text-sky-400',
  palette: 'text-purple-400',
  tag: 'text-sky-400',
  pin: 'text-amber-400',
  globe: 'text-sky-400',
  lightbulb: 'text-amber-400',
  'thumbs-up': 'text-emerald-400',
  'thumbs-down': 'text-rose-400'
};

@Component({
  selector: 'app-theme-icon',
  standalone: true,
  imports: [
    CommonModule,
    LucideTrophy,
    LucideGamepad2,
    LucideSparkles,
    LucideFlame,
    LucideStar,
    LucideRocket,
    LucideGitBranch,
    LucideZap,
    LucideCpu,
    LucidePalette,
    LucideTag,
    LucidePin,
    LucideGlobe,
    LucideLightbulb,
    LucideThumbsUp,
    LucideThumbsDown
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex items-center justify-center flex-shrink-0'
  },
  template: `
    @switch (name) {
      @case ('trophy') {
        <svg lucideTrophy [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('gamepad') {
        <svg lucideGamepad2 [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('sparkles') {
        <svg lucideSparkles [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('flame') {
        <svg lucideFlame [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('star') {
        <svg lucideStar [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('rocket') {
        <svg lucideRocket [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('git') {
        <svg lucideGitBranch [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('zap') {
        <svg lucideZap [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('cpu') {
        <svg lucideCpu [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('palette') {
        <svg lucidePalette [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('tag') {
        <svg lucideTag [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('pin') {
        <svg lucidePin [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('globe') {
        <svg lucideGlobe [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('lightbulb') {
        <svg lucideLightbulb [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('thumbs-up') {
        <svg lucideThumbsUp [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
      @case ('thumbs-down') {
        <svg lucideThumbsDown [ngClass]="resolvedClasses" aria-hidden="true"></svg>
      }
    }
  `
})
export class ThemeIconComponent {
  @Input({ required: true }) name: ThemeIconName = 'trophy';
  @Input() sizeClass = 'w-4 h-4';
  @Input() useThemeColor = true;

  get resolvedClasses(): string {
    const color = this.useThemeColor ? (THEME_ICON_COLORS[this.name] ?? 'text-sky-400') : '';
    return `${this.sizeClass} ${color} flex-shrink-0`.trim();
  }
}

import { Component, ChangeDetectionStrategy, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { GitProvider } from '../../core/models/package.model';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { LucideX, LucideChevronRight, LucideGitBranch, LucideGlobe, LucideUser, LucideInfo, LucideKeyRound } from '@lucide/angular';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    TooltipDirective,
    LucideX,
    LucideChevronRight,
    LucideGitBranch,
    LucideGlobe,
    LucideUser,
    LucideInfo,
    LucideKeyRound
  ],
  template: `
    <div
      (click)="authService.closeAuthModal()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto luanti-backdrop">

      <div
        (click)="$event.stopPropagation()"
        class="w-full max-w-md glass-modal rounded-3xl p-6 sm:p-7 space-y-5 luanti-dialog-panel my-auto">

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div class="flex items-center gap-3">
            <img src="logo.svg" alt="LuantiHub" width="36" height="36" class="w-9 h-9 rounded-xl shadow" />
            <div>
              <h2 id="auth-modal-title" class="text-lg font-bold text-white">
                {{ 'auth.title' | translate }}
              </h2>
              <p class="text-xs text-slate-400">
                {{ 'auth.subtitle' | translate }}
              </p>
            </div>
          </div>

          <button
            type="button"
            (click)="authService.closeAuthModal()"
            aria-label="Close sign in dialog"
            class="p-1.5 rounded-lg glass-icon-btn text-slate-400 hover:text-white transition cursor-pointer">
            <svg lucideX class="w-5 h-5"></svg>
          </button>
        </div>

        @if (authService.authError() || localError()) {
          <div class="p-3 rounded-xl bg-amber-950/50 border border-amber-800/80 text-amber-300 text-xs">
            @if (authService.authError() === 'oauth_not_configured') {
              OAuth Client ID is not configured on this server yet. Use Direct Author / Community Sign-In below!
            } @else {
              {{ localError() || authService.authError() }}
            }
          </div>
        }

        <!-- Direct Author / Community Handle Sign-In (Works Out of the Box + Auto-Syncs ContentDB) -->
        <form (ngSubmit)="onDirectSignIn()" class="p-4 rounded-2xl glass-panel space-y-3.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-bold text-sky-400">
              <svg lucideUser class="w-4 h-4 flex-shrink-0"></svg>
              <span>{{ 'auth.directLoginTitle' | translate }}</span>
            </div>
            <button
              type="button"
              [appTooltip]="'auth.directLoginDesc' | translate"
              aria-label="About direct sign-in"
              class="text-slate-400 hover:text-sky-300 transition cursor-pointer">
              <svg lucideInfo class="w-3.5 h-3.5"></svg>
            </button>
          </div>

          <!-- Field 1: Provider & Username -->
          <div class="space-y-1.5">
            <label for="auth-handle-input" class="block text-[11px] font-semibold text-slate-300">
              Platform &amp; {{ 'auth.usernamePlaceholder' | translate }}
            </label>
            <div class="flex gap-2">
              <select
                [ngModel]="authService.selectedProvider()"
                (ngModelChange)="authService.setSelectedProvider($event)"
                name="selectedProvider"
                aria-label="Select forge provider"
                class="glass-input rounded-xl px-2.5 py-2 text-xs text-white font-semibold focus:outline-none cursor-pointer">
                <option value="contentdb" class="bg-slate-900">ContentDB</option>
                <option value="github" class="bg-slate-900">GitHub</option>
                <option value="codeberg" class="bg-slate-900">Codeberg</option>
                <option value="gitlab" class="bg-slate-900">GitLab</option>
              </select>
              <input
                #handleInputEl
                id="auth-handle-input"
                type="text"
                [(ngModel)]="handleInput"
                name="handleInput"
                required
                [placeholder]="'auth.usernamePlaceholder' | translate"
                class="flex-1 min-w-0 glass-input rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
              />
            </div>
          </div>

          <!-- Field 2: Optional Access Token / API Key with Tooltip Explanation -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <label for="auth-token-input" class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <svg lucideKeyRound class="w-3 h-3 text-slate-400"></svg>
                <span>Access Token / API Key</span>
                <span class="text-[10px] font-normal text-slate-500">(Optional)</span>
              </label>
              <button
                type="button"
                appTooltip="Optional: Provide a read-only Personal Access Token or API key from your selected platform (or your Admin Secret) to verify creator ownership or sign in as an Administrator."
                aria-label="Why provide an access token?"
                class="text-slate-400 hover:text-sky-300 transition flex items-center gap-1 text-[10px] cursor-pointer">
                <svg lucideInfo class="w-3.5 h-3.5"></svg>
              </button>
            </div>
            <input
              id="auth-token-input"
              type="password"
              [(ngModel)]="tokenInput"
              name="tokenInput"
              autocomplete="off"
              placeholder="Access token or API key"
              class="w-full glass-input rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
            />
          </div>

          <button
            type="submit"
            [disabled]="authService.isLoading() || !handleInput.trim()"
            class="w-full py-2.5 rounded-xl glass-btn-sky disabled:opacity-50 text-white font-bold text-xs transition cursor-pointer">
            {{ 'auth.directLoginBtn' | translate }}
          </button>
        </form>

        <!-- OAuth / Provider Selection Buttons -->
        <div class="space-y-2.5">
          <!-- Codeberg -->
          <button
            type="button"
            (click)="signIn('codeberg')"
            [class.ring-2]="authService.selectedProvider() === 'codeberg'"
            [class.ring-teal-400]="authService.selectedProvider() === 'codeberg'"
            class="w-full p-3 rounded-xl bg-teal-950/40 hover:bg-teal-900/50 border border-teal-500/30 backdrop-blur-md text-white font-bold text-xs flex items-center justify-between transition shadow group cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
                <svg lucideGitBranch class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-teal-200 group-hover:text-white transition-colors">{{ 'auth.codebergTitle' | translate }}</span>
                <span class="block text-[10px] text-teal-400 font-normal">{{ 'auth.codebergDesc' | translate }}</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-teal-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

          <!-- GitLab -->
          <button
            type="button"
            (click)="signIn('gitlab')"
            [class.ring-2]="authService.selectedProvider() === 'gitlab'"
            [class.ring-amber-400]="authService.selectedProvider() === 'gitlab'"
            class="w-full p-3 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/30 backdrop-blur-md text-white font-bold text-xs flex items-center justify-between transition shadow group cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <svg lucideGitBranch class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-amber-200 group-hover:text-white transition-colors">{{ 'auth.gitlabTitle' | translate }}</span>
                <span class="block text-[10px] text-amber-400 font-normal">{{ 'auth.gitlabDesc' | translate }}</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

          <!-- GitHub -->
          <button
            type="button"
            (click)="signIn('github')"
            [class.ring-2]="authService.selectedProvider() === 'github'"
            [class.ring-sky-400]="authService.selectedProvider() === 'github'"
            class="w-full p-3 rounded-xl glass-btn text-white font-bold text-xs flex items-center justify-between transition shadow group cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-slate-200">
                <svg lucideGitBranch class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-slate-200 group-hover:text-white transition-colors">{{ 'auth.githubTitle' | translate }}</span>
                <span class="block text-[10px] text-slate-400 font-normal">{{ 'auth.githubDesc' | translate }}</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

          <!-- ContentDB Official -->
          <button
            type="button"
            (click)="signIn('contentdb')"
            [class.ring-2]="authService.selectedProvider() === 'contentdb'"
            [class.ring-sky-400]="authService.selectedProvider() === 'contentdb'"
            class="w-full p-3 rounded-xl bg-sky-950/40 hover:bg-sky-900/50 border border-sky-500/30 backdrop-blur-md text-white font-bold text-xs flex items-center justify-between transition shadow group cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <svg lucideGlobe class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-sky-200 group-hover:text-white transition-colors">{{ 'auth.contentdbTitle' | translate }}</span>
                <span class="block text-[10px] text-sky-400 font-normal">{{ 'auth.contentdbDesc' | translate }}</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-sky-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>
        </div>

        <p class="text-center text-[11px] text-slate-500">
          {{ 'auth.footerNote' | translate }}
        </p>

      </div>

    </div>
  `
})
export class AuthModalComponent {
  readonly authService = inject(AuthService);

  @ViewChild('handleInputEl') handleInputEl?: ElementRef<HTMLInputElement>;

  handleInput = '';
  tokenInput = '';
  readonly localError = signal<string | null>(null);

  async signIn(provider: GitProvider): Promise<void> {
    this.authService.setSelectedProvider(provider);
    this.localError.set(null);

    // If OAuth Client ID is configured on Cloudflare for this provider, redirect to 1-click OAuth
    if (this.authService.isOAuthConfigured(provider)) {
      this.authService.loginWith(provider);
      return;
    }

    // If OAuth Client ID is not configured, seamlessly use Direct Provider Sign-In without a broken redirect:
    // If the user already typed their handle, sign in immediately; otherwise focus the username field for that provider.
    if (this.handleInput.trim()) {
      await this.onDirectSignIn();
    } else {
      this.handleInputEl?.nativeElement?.focus({ preventScroll: true });
    }
  }

  async onDirectSignIn(): Promise<void> {
    if (!this.handleInput.trim()) return;
    this.localError.set(null);
    const res = await this.authService.loginWithHandle(
      this.authService.selectedProvider(),
      this.handleInput.trim(),
      this.tokenInput.trim() || undefined
    );
    if (!res.success && res.message) {
      this.localError.set(res.message);
    }
  }
}

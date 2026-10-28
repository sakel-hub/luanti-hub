import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { GitProvider } from '../../core/models/package.model';
import { LucideX, LucideChevronRight, LucideGitBranch, LucideGlobe } from '@lucide/angular';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, LucideX, LucideChevronRight, LucideGitBranch, LucideGlobe],
  template: `
    <div 
      (click)="authService.closeAuthModal()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      
      <div 
        (click)="$event.stopPropagation()"
        class="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <img src="logo.svg" alt="LuantiHub" width="36" height="36" class="w-9 h-9 rounded-xl shadow" />
            <div>
              <h2 id="auth-modal-title" class="text-lg font-bold text-white">
                Sign in to LuantiHub
              </h2>
              <p class="text-xs text-slate-400">
                Publish Git mods, sync releases, and review packages.
              </p>
            </div>
          </div>

          <button 
            (click)="authService.closeAuthModal()"
            aria-label="Close sign in dialog"
            class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg lucideX class="w-5 h-5"></svg>
          </button>
        </div>

        <!-- Provider Buttons -->
        <div class="space-y-3">
          
          <!-- Codeberg (Featured FOSS Forge) -->
          <button 
            (click)="signIn('codeberg')"
            class="w-full p-3 rounded-xl bg-teal-950/40 hover:bg-teal-900/50 border border-teal-700/60 text-white font-bold text-xs sm:text-sm flex items-center justify-between transition shadow group">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
                <svg lucideGitBranch class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-teal-200 group-hover:text-white transition-colors">Continue with Codeberg</span>
                <span class="block text-[10px] text-teal-400 font-normal">Forgejo / FOSS Favorite for Luanti</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-teal-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

          <!-- GitLab -->
          <button 
            (click)="signIn('gitlab')"
            class="w-full p-3 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 border border-amber-700/60 text-white font-bold text-xs sm:text-sm flex items-center justify-between transition shadow group">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <svg lucideGitBranch class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-amber-200 group-hover:text-white transition-colors">Continue with GitLab</span>
                <span class="block text-[10px] text-amber-400 font-normal">GitLab.com or Custom Projects</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

          <!-- GitHub -->
          <button 
            (click)="signIn('github')"
            class="w-full p-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-white font-bold text-xs sm:text-sm flex items-center justify-between transition shadow group">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-slate-700/50 border border-slate-600 flex items-center justify-center text-slate-300">
                <svg lucideGitBranch class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-slate-200 group-hover:text-white transition-colors">Continue with GitHub</span>
                <span class="block text-[10px] text-slate-400 font-normal">Standard Community Repositories</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

          <!-- ContentDB Official -->
          <button 
            (click)="signIn('contentdb')"
            class="w-full p-3 rounded-xl bg-sky-950/40 hover:bg-sky-900/50 border border-sky-700/60 text-white font-bold text-xs sm:text-sm flex items-center justify-between transition shadow group">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <svg lucideGlobe class="w-4 h-4"></svg>
              </div>
              <div class="text-left">
                <span class="block text-sky-200 group-hover:text-white transition-colors">Sign in with ContentDB</span>
                <span class="block text-[10px] text-sky-400 font-normal">Auto-Import Your Official Packages</span>
              </div>
            </div>
            <svg lucideChevronRight class="w-4 h-4 text-sky-400 group-hover:translate-x-0.5 transition-transform"></svg>
          </button>

        </div>

        <p class="text-center text-[11px] text-slate-500">
          Once signed in, you can link all your other Git and ContentDB accounts to your profile so everything stays synchronized under one identity.
        </p>

      </div>

    </div>
  `
})
export class AuthModalComponent {
  readonly authService = inject(AuthService);

  signIn(provider: GitProvider): void {
    this.authService.loginWith(provider);
  }
}

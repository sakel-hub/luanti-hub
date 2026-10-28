import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { PackageService } from '../../core/services/package.service';
import { GitProvider } from '../../core/models/package.model';

@Component({
  selector: 'app-profile-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (authService.currentUser(); as user) {
      <div 
        (click)="authService.closeProfileDrawer()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-drawer-title"
        class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
        
        <div 
          (click)="$event.stopPropagation()"
          class="w-full max-w-md h-full bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col p-6 space-y-6 overflow-y-auto animate-in slide-in-from-right duration-300">
          
          <!-- Drawer Header -->
          <div class="flex items-center justify-between border-b border-slate-800 pb-4">
            <div class="flex items-center gap-3">
              <img [src]="user.avatar_url" [alt]="user.username" class="w-12 h-12 rounded-xl border border-slate-700 shadow" />
              <div>
                <h2 id="profile-drawer-title" class="text-base font-bold text-white">
                  {{ user.display_name || user.username }}
                </h2>
                <span class="text-xs text-sky-400 font-mono">&#64;{{ user.username }}</span>
              </div>
            </div>

            <button 
              (click)="authService.closeProfileDrawer()"
              class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <!-- Section: Connected Accounts & Forges -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                Connected Accounts
              </h3>
              <span class="text-[11px] text-slate-500">{{ user.identities.length }} linked</span>
            </div>

            <div class="space-y-2">
              @for (id of user.identities; track id.provider) {
                <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2">
                    <span>{{ getProviderIcon(id.provider) }}</span>
                    <span class="capitalize font-semibold text-white">{{ id.provider }}:</span>
                    <span class="text-slate-300 font-mono">&#64;{{ id.username }}</span>
                  </div>
                  <span class="text-[10px] font-bold text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-1.5 py-0.5 rounded flex items-center gap-1">
                    ✓ Verified
                  </span>
                </div>
              }
            </div>

            <!-- Connect Other Forges -->
            <div class="pt-1 flex flex-wrap gap-2">
              @if (!hasProvider('codeberg')) {
                <button (click)="authService.loginWith('codeberg')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition">
                  + Link Codeberg
                </button>
              }
              @if (!hasProvider('gitlab')) {
                <button (click)="authService.loginWith('gitlab')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition">
                  + Link GitLab
                </button>
              }
              @if (!hasProvider('github')) {
                <button (click)="authService.loginWith('github')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition">
                  + Link GitHub
                </button>
              }
            </div>
          </div>

          <!-- Section: ContentDB Importer / Sync -->
          <div class="p-4 rounded-xl bg-sky-950/30 border border-sky-800/40 space-y-3">
            <div class="flex items-center gap-2">
              <span class="text-base">🌐</span>
              <h4 class="text-xs font-bold text-sky-400 uppercase tracking-wider">
                Sync ContentDB Portfolio
              </h4>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed">
              Have packages already on ContentDB? Enter your ContentDB username to auto-sync them into your LuantiHub dashboard:
            </p>
            <div class="flex gap-2">
              <input 
                type="text" 
                [(ngModel)]="cdbUsernameInput" 
                placeholder="ContentDB username..."
                class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button 
                (click)="onSyncContentDb()" 
                [disabled]="isSyncing() || !cdbUsernameInput"
                class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs transition">
                {{ isSyncing() ? 'Syncing...' : 'Sync' }}
              </button>
            </div>
            @if (syncFeedback()) {
              <p class="text-xs text-emerald-400">{{ syncFeedback() }}</p>
            }
          </div>

          <!-- Section: My Packages -->
          <div class="space-y-3 flex-1">
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>My Published Packages</span>
              <span class="text-[11px] text-slate-500">({{ user.packages?.length || 0 }})</span>
            </h3>

            @if (!user.packages || user.packages.length === 0) {
              <div class="p-6 rounded-xl bg-slate-950/40 border border-slate-800 text-center space-y-2">
                <p class="text-xs text-slate-400">You haven't submitted any packages yet.</p>
                <button 
                  (click)="onOpenSubmitModal()"
                  class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition">
                  Submit a Git Repository
                </button>
              </div>
            } @else {
              <div class="space-y-2">
                @for (pkg of user.packages; track pkg.id) {
                  <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <h4 class="font-bold text-white">{{ pkg.title }}</h4>
                      <p class="text-[11px] text-slate-400">{{ pkg.downloads_count }} downloads • ⭐ {{ pkg.score }}</p>
                    </div>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                      {{ pkg.type }}
                    </span>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Footer Actions -->
          <div class="pt-4 border-t border-slate-800 flex items-center justify-between">
            <button 
              (click)="authService.logout()"
              class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 hover:text-rose-400 text-slate-300 text-xs font-semibold transition">
              Sign Out
            </button>
            <span class="text-[10px] text-slate-500">LuantiHub Account</span>
          </div>

        </div>

      </div>
    }
  `
})
export class ProfileDrawerComponent {
  readonly authService = inject(AuthService);
  readonly packageService = inject(PackageService);

  cdbUsernameInput = '';
  readonly isSyncing = signal(false);
  readonly syncFeedback = signal<string | null>(null);

  hasProvider(provider: GitProvider): boolean {
    return this.authService.linkedIdentities().some(id => id.provider === provider);
  }

  getProviderIcon(provider: string): string {
    switch (provider) {
      case 'codeberg': return '🏔️';
      case 'gitlab': return '🦊';
      case 'github': return '🐙';
      case 'contentdb': return '🌐';
      default: return '🔗';
    }
  }

  async onSyncContentDb(): Promise<void> {
    if (!this.cdbUsernameInput) return;
    this.isSyncing.set(true);
    this.syncFeedback.set(null);

    const res = await this.authService.syncContentDbAccount(this.cdbUsernameInput.trim());
    this.isSyncing.set(false);

    if (res.success) {
      this.syncFeedback.set(`Successfully synchronized ${res.count} packages from ContentDB!`);
      this.cdbUsernameInput = '';
    } else {
      this.syncFeedback.set(res.message || 'Could not find ContentDB packages.');
    }
  }

  onOpenSubmitModal(): void {
    this.authService.closeProfileDrawer();
    this.packageService.openSubmitModal();
  }
}

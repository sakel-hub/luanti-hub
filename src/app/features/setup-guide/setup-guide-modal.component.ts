import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';

@Component({
  selector: 'app-setup-guide-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div 
      (click)="packageService.closeSetupModal()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-modal-title"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      
      <div 
        (click)="$event.stopPropagation()"
        class="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
            </div>
            <div>
              <h2 id="setup-modal-title" class="text-lg font-bold text-white">
                Use LuantiHub Inside Your Game
              </h2>
              <p class="text-xs text-slate-400">
                Browse and install decentralized mods directly in the Luanti "Content" tab.
              </p>
            </div>
          </div>

          <button 
            (click)="packageService.closeSetupModal()"
            class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Copyable Config Snippet -->
        <div class="space-y-2">
          <span class="text-xs font-semibold text-slate-300">
            Option A: Quick Configuration in <code>minetest.conf</code>
          </span>
          <div class="relative flex items-center">
            <pre class="w-full p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-sky-400 font-mono text-xs overflow-x-auto select-all">contentdb_url = {{ settingsService.contentDbUrl() }}</pre>
            <button 
              (click)="copyConfig()"
              class="absolute right-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow transition">
              {{ copied() ? 'Copied!' : 'Copy' }}
            </button>
          </div>
        </div>

        <!-- Step-by-step instructions -->
        <div class="space-y-3 text-xs text-slate-300">
          <span class="font-semibold text-white block">Option B: In-Game Settings Menu</span>
          <ol class="list-decimal list-inside space-y-1.5 leading-relaxed text-slate-300">
            <li>Launch <strong>Luanti</strong> (or Minetest).</li>
            <li>Click <strong>Settings</strong> ➔ <strong>All Settings</strong>.</li>
            <li>In the search box, type <code class="text-sky-300 bg-slate-950 px-1 py-0.5 rounded">contentdb_url</code>.</li>
            <li>Paste <code class="text-sky-300 bg-slate-950 px-1 py-0.5 rounded font-mono">{{ settingsService.contentDbUrl() }}</code> into the field.</li>
            <li>Click <strong>Save</strong> and navigate to the <strong>Content</strong> tab.</li>
          </ol>
        </div>

        <!-- High-Availability Fallback Info -->
        <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-xs text-slate-400">
          <svg class="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
          </svg>
          <span>
            <strong>Failover Enabled:</strong> LuantiHub automatically bridges requests to official ContentDB and the <code>contentdb.milcho.org</code> mirror, ensuring your in-game content browser never goes down.
          </span>
        </div>

        <!-- Close Button -->
        <div class="flex justify-end pt-2">
          <button 
            (click)="packageService.closeSetupModal()"
            class="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition">
            Got it, thanks!
          </button>
        </div>

      </div>

    </div>
  `
})
export class SetupGuideModalComponent {
  readonly packageService = inject(PackageService);
  readonly settingsService = inject(SettingsService);

  readonly copied = signal(false);

  copyConfig(): void {
    const text = `contentdb_url = ${this.settingsService.contentDbUrl()}`;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}

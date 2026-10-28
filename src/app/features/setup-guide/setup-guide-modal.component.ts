import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import {
  LucideTerminal,
  LucideX,
  LucideCopy,
  LucideCheck,
  LucideShieldCheck,
  LucideChevronRight
} from '@lucide/angular';

@Component({
  selector: 'app-setup-guide-modal',
  standalone: true,
  imports: [
    CommonModule,
    LucideTerminal,
    LucideX,
    LucideCopy,
    LucideCheck,
    LucideShieldCheck,
    LucideChevronRight
  ],
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
              <svg lucideTerminal class="w-5 h-5"></svg>
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
            aria-label="Close setup dialog"
            class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg lucideX class="w-5 h-5"></svg>
          </button>
        </div>

        <!-- Copyable Config Snippet -->
        <div class="space-y-2">
          <span class="text-xs font-semibold text-slate-300">
            Option A: Quick Configuration in <code>luanti.conf</code> (or <code>minetest.conf</code>)
          </span>
          <div class="relative flex items-center">
            <pre class="w-full p-3.5 bg-slate-950 border border-slate-800 rounded-xl text-sky-400 font-mono text-xs overflow-x-auto select-all">contentdb_url = {{ settingsService.contentDbUrl() }}</pre>
            <button 
              (click)="copyConfig()"
              class="absolute right-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow transition flex items-center gap-1.5">
              @if (copied()) {
                <svg lucideCheck class="w-3.5 h-3.5"></svg>
                <span>Copied!</span>
              } @else {
                <svg lucideCopy class="w-3.5 h-3.5"></svg>
                <span>Copy</span>
              }
            </button>
          </div>
        </div>

        <!-- Step-by-step instructions -->
        <div class="space-y-3 text-xs text-slate-300">
          <span class="font-semibold text-white block">Option B: In-Game Settings Menu</span>
          <ol class="list-decimal list-inside space-y-1.5 leading-relaxed text-slate-300">
            <li>Launch <strong>Luanti</strong> (or Minetest).</li>
            <li>Click <strong>Settings</strong> <svg lucideChevronRight class="w-3.5 h-3.5 inline text-slate-500 mx-0.5"></svg> <strong>All Settings</strong>.</li>
            <li>In the search box, type <code class="text-sky-300 bg-slate-950 px-1 py-0.5 rounded">contentdb_url</code>.</li>
            <li>Paste <code class="text-sky-300 bg-slate-950 px-1 py-0.5 rounded font-mono">{{ settingsService.contentDbUrl() }}</code> into the field.</li>
            <li>Click <strong>Save</strong> and navigate to the <strong>Content</strong> tab.</li>
          </ol>
        </div>

        <!-- High-Availability Fallback Info -->
        <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-xs text-slate-400">
          <svg lucideShieldCheck class="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5"></svg>
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

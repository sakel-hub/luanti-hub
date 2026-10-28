import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PackageService } from '../../core/services/package.service';
import { SettingsService } from '../../core/services/settings.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideTerminal,
  LucideX,
  LucideCopy,
  LucideCheck,
  LucideShieldCheck
} from '@lucide/angular';

@Component({
  selector: 'app-setup-guide-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    TranslatePipe,
    LucideTerminal,
    LucideX,
    LucideCopy,
    LucideCheck,
    LucideShieldCheck
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
        class="w-full max-w-xl glass-modal rounded-3xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-200">

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
              <svg lucideTerminal class="w-5 h-5"></svg>
            </div>
            <div>
              <h2 id="setup-modal-title" class="text-lg font-bold text-white">
                {{ 'setup.title' | translate }}
              </h2>
              <p class="text-xs text-slate-400">
                {{ 'setup.subtitle' | translate }}
              </p>
            </div>
          </div>

          <button
            type="button"
            (click)="packageService.closeSetupModal()"
            aria-label="Close setup dialog"
            class="p-1.5 rounded-lg glass-icon-btn text-slate-400 hover:text-white transition cursor-pointer">
            <svg lucideX class="w-5 h-5"></svg>
          </button>
        </div>

        <!-- Copyable Config Snippet -->
        <div class="space-y-2">
          <span class="text-xs font-semibold text-slate-300">
            {{ 'setup.optionA' | translate }}
          </span>
          <div class="relative flex items-center">
            <pre class="w-full p-3.5 bg-slate-950/85 border border-white/10 rounded-xl text-sky-400 font-mono text-xs overflow-x-auto select-all">contentdb_url = {{ settingsService.contentDbUrl() }}</pre>
            <button
              type="button"
              (click)="copyConfig()"
              class="absolute right-2 px-3 py-1.5 rounded-lg glass-btn-sky text-white text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer">
              @if (copied()) {
                <svg lucideCheck class="w-3.5 h-3.5"></svg>
                <span>{{ 'setup.copied' | translate }}</span>
              } @else {
                <svg lucideCopy class="w-3.5 h-3.5"></svg>
                <span>{{ 'setup.copy' | translate }}</span>
              }
            </button>
          </div>
        </div>

        <!-- Step-by-step instructions -->
        <div class="space-y-3 text-xs text-slate-300 p-4 rounded-2xl glass-panel">
          <span class="font-semibold text-white block">{{ 'setup.optionB' | translate }}</span>
          <ol class="list-decimal list-inside space-y-1.5 leading-relaxed text-slate-300">
            <li>{{ 'setup.step1' | translate }}</li>
            <li>{{ 'setup.step2' | translate }}</li>
            <li>{{ 'setup.step3' | translate }}</li>
            <li>{{ 'setup.step4' | translate }} (<code class="text-sky-300 bg-slate-950/90 px-1.5 py-0.5 rounded font-mono border border-white/10">{{ settingsService.contentDbUrl() }}</code>)</li>
            <li>{{ 'setup.step5' | translate }}</li>
          </ol>
        </div>

        <!-- High-Availability Fallback Info -->
        <div class="p-3.5 rounded-2xl glass-panel flex items-start gap-2.5 text-xs text-slate-300">
          <svg lucideShieldCheck class="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5"></svg>
          <span>{{ 'setup.failoverNote' | translate }}</span>
        </div>

        <!-- Close Button -->
        <div class="flex justify-end pt-2">
          <button
            type="button"
            (click)="packageService.closeSetupModal()"
            class="px-5 py-2.5 rounded-xl glass-btn text-white font-bold text-xs transition cursor-pointer">
            {{ 'setup.doneBtn' | translate }}
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

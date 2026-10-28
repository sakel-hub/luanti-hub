import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PackageService } from '../../core/services/package.service';

@Component({
  selector: 'app-submit-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div 
      (click)="packageService.closeSubmitModal()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-modal-title"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      
      <div 
        (click)="$event.stopPropagation()"
        class="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 duration-200">
        
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </div>
            <div>
              <h2 id="submit-modal-title" class="text-lg font-bold text-white">
                Submit Decentralized Git Package
              </h2>
              <p class="text-xs text-slate-400">
                Index your mod, game, or texture pack directly from GitHub, Codeberg, or GitLab.
              </p>
            </div>
          </div>

          <button 
            (click)="packageService.closeSubmitModal()"
            class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Form Body -->
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          
          <!-- Git URL Input -->
          <div class="space-y-1.5">
            <label for="git-url" class="block text-xs font-semibold text-slate-300">
              Git Repository HTTPS URL <span class="text-rose-400">*</span>
            </label>
            <input 
              id="git-url"
              type="url"
              [(ngModel)]="repoUrl"
              name="repoUrl"
              required
              placeholder="https://github.com/your-username/my_awesome_mod"
              class="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 font-mono transition"
            />
            <span class="text-[11px] text-slate-500 block">
              Must contain a valid <code class="text-slate-400">mod.conf</code> or <code class="text-slate-400">game.conf</code> and an open-source license.
            </span>
          </div>

          <!-- Legal & Compliance Checkboxes -->
          <div class="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3 text-xs">
            <h3 class="font-bold text-sky-400 uppercase tracking-wider text-[10px]">
              Legal Warranties &amp; Safe Harbor Compliance
            </h3>

            <label class="flex items-start gap-2.5 cursor-pointer text-slate-300">
              <input 
                type="checkbox" 
                [(ngModel)]="warrantyOwnership" 
                name="warrantyOwnership"
                required
                class="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500" 
              />
              <span>I confirm I am the author or have full rights to distribute this repository.</span>
            </label>

            <label class="flex items-start gap-2.5 cursor-pointer text-slate-300">
              <input 
                type="checkbox" 
                [(ngModel)]="warrantyAssets" 
                name="warrantyAssets"
                required
                class="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500" 
              />
              <span>I certify all textures, audio, and meshes are Free/Open Source and contain no ripped Minecraft or copyrighted assets.</span>
            </label>

            <label class="flex items-start gap-2.5 cursor-pointer text-slate-300">
              <input 
                type="checkbox" 
                [(ngModel)]="warrantyTakedown" 
                name="warrantyTakedown"
                required
                class="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500" 
              />
              <span>I understand that any DMCA copyright violation will result in immediate delisting.</span>
            </label>
          </div>

          <!-- Status / Error Message -->
          @if (statusMessage()) {
            <div 
              [class]="statusSuccess() ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800' : 'bg-rose-950/60 text-rose-400 border-rose-800'"
              class="p-3 rounded-xl border text-xs leading-relaxed">
              {{ statusMessage() }}
            </div>
          }

          <!-- Submit Buttons -->
          <div class="flex items-center justify-end gap-3 pt-2">
            <button 
              type="button" 
              (click)="packageService.closeSubmitModal()"
              class="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold transition">
              Cancel
            </button>

            <button 
              type="submit"
              [disabled]="isSubmitting() || !isFormValid"
              class="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs shadow-lg shadow-sky-600/30 flex items-center gap-2 transition">
              @if (isSubmitting()) {
                <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Auditing &amp; Ingesting...</span>
              } @else {
                <span>Publish to LuantiHub</span>
              }
            </button>
          </div>

        </form>

      </div>

    </div>
  `
})
export class SubmitModalComponent {
  readonly packageService = inject(PackageService);

  repoUrl = '';
  warrantyOwnership = false;
  warrantyAssets = false;
  warrantyTakedown = false;

  readonly isSubmitting = signal(false);
  readonly statusMessage = signal<string | null>(null);
  readonly statusSuccess = signal(false);

  get isFormValid(): boolean {
    return Boolean(this.repoUrl && this.warrantyOwnership && this.warrantyAssets && this.warrantyTakedown);
  }

  async onSubmit(): Promise<void> {
    if (!this.isFormValid) return;

    this.isSubmitting.set(true);
    this.statusMessage.set(null);

    const res = await this.packageService.submitGitPackage({
      repoUrl: this.repoUrl.trim(),
      warrantiesAccepted: true
    });

    this.isSubmitting.set(false);

    if (res.success) {
      this.statusSuccess.set(true);
      this.statusMessage.set('Package successfully audited and indexed! It is now live in the catalog and available in-game.');
      setTimeout(() => {
        this.packageService.closeSubmitModal();
      }, 1500);
    } else {
      this.statusSuccess.set(false);
      this.statusMessage.set(res.message || 'Failed to validate repository.');
    }
  }
}

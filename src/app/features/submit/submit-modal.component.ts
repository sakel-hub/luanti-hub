import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PackageService } from '../../core/services/package.service';
import { AuthService } from '../../core/services/auth.service';
import { GitAuditReport, GitProvider } from '../../core/models/package.model';
import { TooltipDirective } from '../../shared/directives/tooltip.directive';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucidePlus,
  LucideX,
  LucideCheck,
  LucideCopy,
  LucideShieldCheck,
  LucideShieldAlert,
  LucideTerminal,
  LucideLoader2,
  LucideTag,
  LucideKeyRound,
  LucideAlertCircle
} from '@lucide/angular';

@Component({
  selector: 'app-submit-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TooltipDirective,
    TranslatePipe,
    LucidePlus,
    LucideX,
    LucideCheck,
    LucideCopy,
    LucideShieldCheck,
    LucideShieldAlert,
    LucideTerminal,
    LucideLoader2,
    LucideTag,
    LucideKeyRound,
    LucideAlertCircle
  ],
  template: `
    <div
      (click)="packageService.closeSubmitModal()"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-modal-title"
      class="z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto luanti-modal-backdrop">

      <div
        (click)="$event.stopPropagation()"
        class="w-full max-w-2xl max-h-[92vh] overflow-y-auto glass-modal rounded-3xl p-5 sm:p-7 space-y-5 luanti-dialog-panel my-auto">

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <svg lucidePlus class="w-5 h-5"></svg>
            </div>
            <div>
              <h2 id="submit-modal-title" class="text-lg font-bold text-white">
                {{ 'submit.title' | translate }}
              </h2>
              <p class="text-xs text-slate-400">
                {{ 'submit.subtitle' | translate }}
              </p>
            </div>
          </div>

          <button
            type="button"
            (click)="packageService.closeSubmitModal()"
            aria-label="Close submit dialog"
            class="p-1.5 rounded-lg glass-icon-btn text-slate-400 hover:text-white transition cursor-pointer">
            <svg lucideX class="w-5 h-5"></svg>
          </button>
        </div>

        <!-- Guest Sign-In Required Notice -->
        @if (!authService.isLoggedIn()) {
          <div class="p-4 rounded-2xl bg-amber-950/35 border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div class="flex items-start gap-2.5">
              <svg lucideShieldAlert class="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5"></svg>
              <div class="space-y-0.5">
                <span class="font-bold text-amber-200 block">
                  {{ 'submit.guestNoticeTitle' | translate }}
                </span>
                <p class="text-[11px] text-amber-300/90 leading-relaxed">
                  {{ 'submit.guestNoticeDesc' | translate }}
                </p>
              </div>
            </div>
            <button
              type="button"
              (click)="onSignInFromSubmit()"
              class="px-4 py-2 rounded-xl glass-btn-sky text-white font-bold text-xs whitespace-nowrap transition cursor-pointer flex-shrink-0">
              {{ 'header.signIn' | translate }}
            </button>
          </div>
        }

        <!-- Form Body -->
        <form (ngSubmit)="onPublish()" class="space-y-4">

          <!-- Git URL Input + Run Audit Button -->
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <label for="git-url" class="block text-xs font-semibold text-slate-300">
                  {{ 'submit.repoUrlLabel' | translate }} <span class="text-rose-400">*</span>
                </label>
                <span
                  tabindex="0"
                  [appTooltip]="'submit.repoUrlTooltip' | translate"
                  [attr.aria-label]="'submit.repoUrlTooltip' | translate"
                  class="inline-flex items-center justify-center w-4 h-4 rounded-full glass-pill text-amber-300 hover:text-white transition cursor-help">
                  <svg lucideAlertCircle class="w-3 h-3"></svg>
                </span>
              </div>
              <span class="text-[10px] font-mono text-slate-400 hidden sm:inline">
                Codeberg · Mesehub · GitLab · GitHub
              </span>
            </div>
            <div class="flex flex-col sm:flex-row gap-2">
              <input
                id="git-url"
                type="url"
                [(ngModel)]="repoUrl"
                (ngModelChange)="onUrlChange()"
                name="repoUrl"
                required
                [placeholder]="'submit.repoUrlPlaceholder' | translate"
                [appTooltip]="'submit.repoUrlTooltip' | translate"
                class="flex-1 glass-input rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none font-mono transition"
              />
              <button
                type="button"
                (click)="onRunAudit()"
                [disabled]="isAuditing() || !repoUrl.trim() || !authService.isLoggedIn()"
                [appTooltip]="'submit.runAuditTooltip' | translate"
                class="px-4 py-2.5 rounded-xl glass-btn-amber disabled:opacity-50 font-black text-xs flex items-center justify-center gap-2 hover:scale-[1.02] transition whitespace-nowrap cursor-pointer">
                @if (isAuditing()) {
                  <svg lucideLoader2 class="w-4 h-4 text-amber-300 animate-spin"></svg>
                  <span>{{ 'submit.runningAudit' | translate }}</span>
                } @else {
                  <svg lucideTerminal class="w-4 h-4 text-amber-300 flex-shrink-0"></svg>
                  <span>{{ 'submit.runAuditBtn' | translate }}</span>
                }
              </button>
            </div>
            <span class="text-[11px] text-slate-400 block">
              {{ 'submit.repoUrlHint' | translate }}
            </span>
          </div>

          <!-- Pre-Flight Audit & Luacheck Static Analysis Report -->
          @if (auditReport(); as report) {
            <div class="p-4 rounded-2xl glass-panel space-y-3 text-xs">
              <div class="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 pb-2.5">
                <div class="flex items-center gap-2">
                  @if (report.valid) {
                    <svg lucideShieldCheck class="w-4 h-4 text-emerald-400"></svg>
                    <span class="font-bold text-emerald-400">{{ 'submit.auditPassed' | translate }}</span>
                  } @else {
                    <svg lucideShieldAlert class="w-4 h-4 text-rose-400"></svg>
                    <span class="font-bold text-rose-400">{{ 'submit.auditFailed' | translate }}</span>
                  }
                </div>

                <!-- Summary Pills -->
                <div class="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
                  <span
                    [class]="report.configFound ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800' : 'bg-rose-950/70 text-rose-300 border-rose-800'"
                    class="px-2 py-0.5 rounded border">
                    {{ report.configFound || 'Missing *.conf' }}
                  </span>
                  <span
                    [class]="report.licenseValid ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800' : 'bg-amber-950/70 text-amber-300 border-amber-800'"
                    class="px-2 py-0.5 rounded border">
                    SPDX License
                  </span>
                  <span
                    [class]="report.luacheckPassed ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800' : 'bg-rose-950/70 text-rose-300 border-rose-800'"
                    class="px-2 py-0.5 rounded border">
                    Luacheck
                  </span>
                  <span
                    [class]="isOwnershipVerified() ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800' : 'bg-amber-950/70 text-amber-300 border-amber-800'"
                    class="px-2 py-0.5 rounded border">
                    {{ isOwnershipVerified() ? 'Owner Verified' : 'Verify Owner' }}
                  </span>
                </div>
              </div>

              <!-- Detected Metadata Preview -->
              @if (report.metadata; as meta) {
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-xl bg-slate-950/70 border border-white/10 text-[11px]">
                  <div>
                    <span class="text-slate-500 block text-[10px]">ID</span>
                    <code class="text-sky-300 font-mono font-bold">{{ meta.author }}/{{ meta.name }}</code>
                  </div>
                  <div>
                    <span class="text-slate-500 block text-[10px]">Title</span>
                    <span class="text-white font-semibold truncate block">{{ meta.title }}</span>
                  </div>
                  <div>
                    <span class="text-slate-500 block text-[10px]">Type</span>
                    <span class="text-emerald-400 font-bold uppercase">{{ meta.type }}</span>
                  </div>
                  <div>
                    <span class="text-slate-500 block text-[10px]">License</span>
                    <span class="text-slate-300 font-mono">{{ meta.license }}</span>
                  </div>
                </div>
              }

              <!-- Diagnostics List -->
              <div class="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                @for (diag of report.diagnostics; track diag.code + (diag.line || 0)) {
                  <div
                    [class]="diag.severity === 'error' ? 'bg-rose-950/35 border-rose-800/80' : diag.severity === 'warning' ? 'bg-amber-950/30 border-amber-800/70' : 'bg-emerald-950/25 border-emerald-800/60'"
                    class="p-3 rounded-xl border space-y-2">
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span
                          [class]="diag.severity === 'error' ? 'glass-badge glass-badge-rose' : diag.severity === 'warning' ? 'glass-badge glass-badge-amber' : 'glass-badge glass-badge-emerald'"
                          class="font-black font-mono uppercase">
                          {{ diag.code }}
                        </span>
                        <span class="font-bold text-white">{{ diag.title }}</span>
                      </div>
                      <code class="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                        {{ diag.file }}{{ diag.line ? ':' + diag.line : '' }}
                      </code>
                    </div>

                    <p class="text-slate-300 leading-relaxed text-[11px]">{{ diag.message }}</p>

                    @if (diag.howToFix) {
                      <div class="p-2.5 rounded-lg bg-slate-950/80 border border-white/10 space-y-1.5">
                        <div class="flex items-center justify-between">
                          <span class="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                            {{ 'submit.howToFix' | translate }}
                          </span>
                          @if (diag.snippet) {
                            <button
                              type="button"
                              (click)="copySnippet(diag.snippet, diag.code)"
                              class="text-[10px] font-semibold text-sky-400 hover:text-white flex items-center gap-1 transition cursor-pointer">
                              @if (copiedCode() === diag.code) {
                                <svg lucideCheck class="w-3 h-3 text-emerald-400"></svg>
                                <span class="text-emerald-400">{{ 'common.copiedToClipboard' | translate }}</span>
                              } @else {
                                <svg lucideCopy class="w-3 h-3"></svg>
                                <span>{{ 'submit.copySnippet' | translate }}</span>
                              }
                            </button>
                          }
                        </div>
                        <p class="text-[11px] text-slate-300">{{ diag.howToFix }}</p>
                        @if (diag.snippet) {
                          <pre class="p-2 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto select-all">{{ diag.snippet }}</pre>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- Repository Ownership Verification (Required to Publish) -->
          @if (parsedRepoTarget(); as target) {
            <div
              [class]="isOwnershipVerified() ? 'bg-emerald-950/25 border-emerald-500/30' : 'bg-amber-950/25 border-amber-500/35'"
              class="p-4 rounded-2xl border space-y-3 text-xs">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-2">
                  @if (isOwnershipVerified()) {
                    <svg lucideShieldCheck class="w-4 h-4 text-emerald-400 flex-shrink-0"></svg>
                    <span class="font-bold text-emerald-300">
                      Repository Ownership Verified ({{ target.provider | uppercase }}: {{ target.owner }})
                    </span>
                  } @else {
                    <svg lucideKeyRound class="w-4 h-4 text-amber-400 flex-shrink-0"></svg>
                    <span class="font-bold text-amber-300">
                      Verify {{ target.provider | uppercase }} Ownership for "{{ target.owner }}/{{ target.repo }}"
                    </span>
                  }
                </div>
              </div>

              @if (!isOwnershipVerified()) {
                <p class="text-[11px] text-slate-300 leading-relaxed">
                  Only the verified repository owner or organization member on <strong class="text-white uppercase">{{ target.provider }}</strong> can publish this repository. Your token is verified once on the server and is <strong class="text-emerald-300">never stored in the browser</strong>.
                </p>

                @if (authService.isOAuthConfigured(target.provider)) {
                  <button
                    type="button"
                    (click)="authService.loginWith(target.provider)"
                    class="w-full py-2 px-3 rounded-xl glass-btn-sky text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer">
                    <span>Connect {{ target.provider | uppercase }} via 1-Click OAuth</span>
                  </button>
                }

                <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    [(ngModel)]="verifyUsername"
                    name="verifyUsername"
                    [placeholder]="target.owner"
                    [appTooltip]="target.provider + ' username (e.g. ' + target.owner + ')'"
                    autocomplete="username"
                    class="sm:col-span-4 glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  />
                  <input
                    type="password"
                    [(ngModel)]="verifyToken"
                    name="verifyToken"
                    placeholder="Personal Access Token"
                    [appTooltip]="'Read-only ' + (target.provider | uppercase) + ' Personal Access Token (verified once on server, never stored)'"
                    autocomplete="off"
                    class="sm:col-span-5 glass-input rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  />
                  <button
                    type="button"
                    (click)="onVerifyOwnershipInline()"
                    [disabled]="isVerifyingOwner() || !verifyToken.trim()"
                    class="sm:col-span-3 px-3 py-2 rounded-xl glass-btn-primary disabled:opacity-50 text-white font-black text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                    @if (isVerifyingOwner()) {
                      <svg lucideLoader2 class="w-3.5 h-3.5 text-sky-300 animate-spin"></svg>
                      <span>Verifying...</span>
                    } @else {
                      <svg lucideShieldCheck class="w-3.5 h-3.5 text-sky-300"></svg>
                      <span>Verify Owner</span>
                    }
                  </button>
                </div>

                @if (verifyOwnerMessage()) {
                  <p [class]="verifyOwnerSuccess() ? 'text-emerald-400' : 'text-rose-400'" class="text-[11px] font-medium">
                    {{ verifyOwnerMessage() }}
                  </p>
                }
              }
            </div>
          }

          <!-- Custom Git Package Tags Selector (Optional, up to 5) -->
          <div class="p-4 rounded-2xl glass-panel space-y-2.5 text-xs">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 font-bold text-sky-400 uppercase tracking-wider text-[10px]">
                <svg lucideTag class="w-3.5 h-3.5"></svg>
                <span>Package Tags (Optional — {{ selectedTags().length }}/5)</span>
              </div>
              @if (selectedTags().length > 0) {
                <button
                  type="button"
                  (click)="selectedTags.set([])"
                  class="text-[10px] text-slate-400 hover:text-white transition cursor-pointer">
                  Clear tags
                </button>
              }
            </div>
            <p class="text-[11px] text-slate-400">
              Select up to 5 ContentDB-compatible tags to categorize your package in the catalog.
            </p>
            <div class="flex items-center gap-1.5 flex-wrap max-h-32 overflow-y-auto pr-1 pt-0.5">
              @for (tag of packageService.availableTags(); track tag.name) {
                <button
                  type="button"
                  (click)="toggleTag(tag.name)"
                  [class]="isTagSelected(tag.name) ? 'bg-sky-500/25 text-sky-300 border-sky-400/50 shadow-sm' : 'glass-pill text-slate-300 hover:text-white'"
                  class="px-2.5 py-1 rounded-full border text-[11px] font-medium transition whitespace-nowrap cursor-pointer">
                  #{{ tag.title }}
                </button>
              }
            </div>
          </div>

          <!-- Legal & Compliance Checkboxes -->
          <div class="p-4 rounded-2xl glass-panel space-y-3 text-xs">
            <h3 class="font-bold text-sky-400 uppercase tracking-wider text-[10px]">
              {{ 'submit.warrantiesTitle' | translate }}
            </h3>

            <label class="flex items-start gap-2.5 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                [(ngModel)]="warrantyOwnership"
                name="warrantyOwnership"
                required
                class="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 cursor-pointer"
              />
              <span>{{ 'submit.warrantyOwnership' | translate }}</span>
            </label>

            <label class="flex items-start gap-2.5 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                [(ngModel)]="warrantyAssets"
                name="warrantyAssets"
                required
                class="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 cursor-pointer"
              />
              <span>{{ 'submit.warrantyLicense' | translate }}</span>
            </label>

            <label class="flex items-start gap-2.5 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                [(ngModel)]="warrantyTakedown"
                name="warrantyTakedown"
                required
                class="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 cursor-pointer"
              />
              <span>{{ 'submit.warrantyTakedown' | translate }}</span>
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
              class="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold transition cursor-pointer">
              {{ 'submit.cancel' | translate }}
            </button>

            <button
              type="submit"
              [disabled]="isSubmitting() || !canPublish()"
              class="px-5 py-2.5 rounded-xl glass-btn-sky disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center gap-2 transition cursor-pointer">
              @if (isSubmitting()) {
                <svg lucideLoader2 class="w-4 h-4 text-white animate-spin"></svg>
                <span>{{ 'submit.submitting' | translate }}</span>
              } @else {
                <span>{{ 'submit.submitBtn' | translate }}</span>
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
  readonly authService = inject(AuthService);

  repoUrl = '';
  warrantyOwnership = false;
  warrantyAssets = false;
  warrantyTakedown = false;

  verifyUsername = '';
  verifyToken = '';
  readonly isVerifyingOwner = signal(false);
  readonly verifyOwnerMessage = signal<string | null>(null);
  readonly verifyOwnerSuccess = signal(false);

  readonly isAuditing = signal(false);
  readonly isSubmitting = signal(false);
  readonly auditReport = signal<GitAuditReport | null>(null);
  readonly statusMessage = signal<string | null>(null);
  readonly statusSuccess = signal(false);
  readonly copiedCode = signal<string | null>(null);
  readonly selectedTags = signal<string[]>([]);
  private readonly repoUrlSignal = signal('');

  readonly parsedRepoTarget = computed<{ provider: GitProvider; owner: string; repo: string } | null>(() => {
    const raw = this.repoUrlSignal().trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const parts = u.pathname.replace(/^\/|\/$/g, '').split('/');
      if (parts.length < 2) return null;
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, '');
      if (!owner || !repo) return null;
      let provider: GitProvider = 'github';
      if (host.includes('minetest.land') || host.includes('mesehub')) {
        provider = 'mesehub';
      } else if (host.includes('codeberg') || host.includes('gitea') || host.includes('forgejo')) {
        provider = 'codeberg';
      } else if (host.includes('gitlab')) {
        provider = 'gitlab';
      }
      return { provider, owner, repo };
    } catch {
      return null;
    }
  });

  isOwnershipVerified(): boolean {
    if (this.auditReport()?.ownershipVerified) {
      return true;
    }
    const target = this.parsedRepoTarget();
    if (!target) return false;
    return this.authService.hasVerifiedProviderOwnership(target.provider, target.owner);
  }

  onSignInFromSubmit(): void {
    this.packageService.closeSubmitModal();
    this.authService.openAuthModal();
  }

  isTagSelected(tagName: string): boolean {
    return this.selectedTags().includes(tagName.toLowerCase());
  }

  toggleTag(tagName: string): void {
    const normalized = tagName.toLowerCase();
    const current = this.selectedTags();
    if (current.includes(normalized)) {
      this.selectedTags.set(current.filter(t => t !== normalized));
    } else if (current.length < 5) {
      this.selectedTags.set([...current, normalized]);
    }
  }

  onUrlChange(): void {
    this.repoUrlSignal.set(this.repoUrl);
    this.auditReport.set(null);
    this.statusMessage.set(null);
    this.verifyOwnerMessage.set(null);
    const target = this.parsedRepoTarget();
    if (target && !this.verifyUsername.trim()) {
      this.verifyUsername = target.owner;
    }
  }

  async onVerifyOwnershipInline(): Promise<void> {
    const target = this.parsedRepoTarget();
    if (!target || !this.verifyToken.trim()) return;

    const handleToVerify = (this.verifyUsername || target.owner).trim();
    const oneTimeToken = this.verifyToken.trim();
    // Immediately wipe token from component memory so it never lingers
    this.verifyToken = '';

    this.isVerifyingOwner.set(true);
    this.verifyOwnerMessage.set(null);

    const res = await this.authService.verifyProviderOwnershipInline(
      target.provider,
      handleToVerify,
      oneTimeToken
    );

    this.isVerifyingOwner.set(false);
    if (res.success) {
      this.verifyOwnerSuccess.set(true);
      this.verifyOwnerMessage.set(`Verified ${target.provider} account '${handleToVerify}'.`);
      // Refresh pre-flight audit so server-side ownership check updates too
      await this.onRunAudit();
    } else {
      this.verifyOwnerSuccess.set(false);
      this.verifyOwnerMessage.set(res.message || 'Could not verify token.');
    }
  }

  canPublish(): boolean {
    const report = this.auditReport();
    return Boolean(
      this.repoUrl.trim() &&
      this.warrantyOwnership &&
      this.warrantyAssets &&
      this.warrantyTakedown &&
      this.isOwnershipVerified() &&
      report?.valid &&
      report?.auditToken
    );
  }

  copySnippet(snippet: string, code: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(snippet);
      this.copiedCode.set(code);
      setTimeout(() => this.copiedCode.set(null), 2000);
    }
  }

  async onRunAudit(): Promise<void> {
    if (!this.repoUrl.trim()) return;
    this.isAuditing.set(true);
    this.statusMessage.set(null);

    const res = await this.packageService.auditOrSubmitGitPackage({
      repoUrl: this.repoUrl.trim(),
      warrantiesAccepted: true,
      dryRun: true,
      tags: this.selectedTags()
    });

    this.isAuditing.set(false);
    if (res.audit) {
      this.auditReport.set(res.audit);
    }
    if (!res.success && !res.audit) {
      this.statusSuccess.set(false);
      this.statusMessage.set(res.message || 'Could not reach repository.');
    }
  }

  async onPublish(): Promise<void> {
    const report = this.auditReport();
    if (!this.canPublish() || !report?.auditToken) return;

    this.isSubmitting.set(true);
    this.statusMessage.set(null);

    const res = await this.packageService.auditOrSubmitGitPackage({
      repoUrl: this.repoUrl.trim(),
      warrantiesAccepted: true,
      dryRun: false,
      tags: this.selectedTags(),
      auditToken: report.auditToken
    });

    this.isSubmitting.set(false);

    if (res.audit) {
      this.auditReport.set(res.audit);
    }

    if (res.success) {
      this.statusSuccess.set(true);
      this.statusMessage.set(res.message || 'Package successfully audited and indexed! It is now live in the catalog.');
      setTimeout(() => {
        this.packageService.closeSubmitModal();
      }, 1500);
    } else {
      this.statusSuccess.set(false);
      this.statusMessage.set(res.message || 'Pre-flight audit found blocking issues. Please fix the errors above and try again.');
    }
  }
}

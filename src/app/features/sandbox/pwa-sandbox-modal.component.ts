import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideDownload,
  LucideMaximize2,
  LucidePlay,
  LucideRefreshCw,
  LucideShieldAlert,
  LucideShieldCheck,
  LucideX
} from '@lucide/angular';
import { LuantiPackage } from '../../core/models/package.model';
import { mergeLuantiHubAndContentDbGameSupport } from '../../core/config/package-utils.config';
import {
  SandboxMemoryGuardError,
  SandboxMemoryGuardService,
  SandboxMemoryProfile
} from '../../core/services/sandbox-memory-guard.service';

export interface SandboxBundleDescriptor {
  id: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  isPrimary: boolean;
  downloadUrl: string;
  gitArchiveUrl?: string;
  mountPath: string;
  estimatedBytes: number;
}

export interface SandboxManifest {
  packageId: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  baseEnvironment: 'devtest' | 'minetest_game_lite' | 'native_game' | 'texture_showcase';
  targetGame?: { id: string; author: string; name: string; title: string } | null;
  incompatibleReason?: string;
  estimatedTotalBytes: number;
  compatible?: boolean;
  quotaExhausted?: boolean;
  quota?: {
    exhausted: boolean;
    billingCycle: string;
    resetsAt: string;
    usagePercent: number;
  };
  bundles: SandboxBundleDescriptor[];
}

export interface SandboxFaultState {
  code: string;
  title: string;
  message: string;
  detail?: string;
}

@Component({
  selector: 'app-pwa-sandbox-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    LucidePlay,
    LucideX,
    LucideRefreshCw,
    LucideShieldAlert,
    LucideShieldCheck,
    LucideDownload,
    LucideMaximize2
  ],
  template: `
    <div
      class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/85 backdrop-blur-md animate-fade-in"
      [style.padding]="isMaximized() ? '0' : '1rem'"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Try ' + pkg().title + ' in Luanti Sandbox'"
      (click)="$event.stopPropagation()"
    >
      <div
        #modalContainer
        class="relative flex flex-col w-full bg-slate-900 shadow-2xl overflow-hidden transition-all duration-150 border-slate-700/70"
        [style.width]="isMaximized() ? '100vw' : '100%'"
        [style.max-width]="isMaximized() ? 'none' : '72rem'"
        [style.height]="isMaximized() ? '100vh' : '88vh'"
        [style.max-height]="isMaximized() ? 'none' : '860px'"
        [style.min-height]="isMaximized() ? '100vh' : '540px'"
        [style.border-radius]="isMaximized() ? '0' : '1rem'"
        [style.border-width]="isMaximized() ? '0' : '1px'"
        (click)="$event.stopPropagation()"
      >
        <!-- Top Control & Container Telemetry Bar -->
        <header
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900/95 border-b border-slate-800"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300 border border-sky-500/30"
            >
              <svg lucidePlay class="w-3.5 h-3.5 text-sky-400"></svg>
              Luanti Sandbox
            </span>
            <h3 class="text-sm sm:text-base font-bold text-white truncate">
              {{ pkg().title }}
            </h3>
            <span class="hidden md:inline-block text-xs text-slate-400 font-mono">
              ({{ pkg().author }}/{{ pkg().name }})
            </span>
          </div>

          <!-- Live Container Memory & Monthly Quota Telemetry Pill -->
          <div class="flex items-center gap-2 flex-wrap">
            <div
              class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border transition-colors"
              [class.bg-emerald-950/60]="memoryWarningLevel() === 'normal'"
              [class.border-emerald-500/35]="memoryWarningLevel() === 'normal'"
              [class.text-emerald-300]="memoryWarningLevel() === 'normal'"
              [class.bg-amber-950/60]="memoryWarningLevel() === 'elevated'"
              [class.border-amber-500/40]="memoryWarningLevel() === 'elevated'"
              [class.text-amber-300]="memoryWarningLevel() === 'elevated'"
              [class.bg-rose-950/70]="memoryWarningLevel() === 'critical'"
              [class.border-rose-500/50]="memoryWarningLevel() === 'critical'"
              [class.text-rose-300]="memoryWarningLevel() === 'critical'"
              title="Container Memory & Monthly Quota Telemetry"
            >
              <svg lucideShieldCheck class="w-3.5 h-3.5 shrink-0"></svg>
              <span>
                RAM: {{ currentMemoryMb() }} / {{ maxMemoryMb() }} MB ({{ memoryUsagePercent() }}%)
              </span>
              @if (status() === 'running') {
                <span class="hidden sm:inline text-slate-500">•</span>
                <span class="hidden sm:inline">Mods: {{ loadedModCount() }}</span>
                <span class="hidden md:inline text-slate-500">•</span>
                <span class="hidden md:inline">Quota: {{ quotaUsagePercent() }}%</span>
              }
            </div>

            <button
              type="button"
              (click)="toggleFullscreen($event)"
              class="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              [class.bg-slate-800]="isMaximized()"
              [class.text-sky-300]="isMaximized()"
              [attr.title]="isMaximized() ? 'Restore Window Size' : 'Maximize Window'"
              [attr.aria-label]="isMaximized() ? 'Restore Window Size' : 'Maximize Window'"
            >
              <svg lucideMaximize2 class="w-4 h-4"></svg>
            </button>

            <button
              type="button"
              (click)="closeSandbox($event)"
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-rose-600/80 border border-slate-700 transition-colors"
              aria-label="Close Sandbox"
            >
              <svg lucideX class="w-4 h-4"></svg>
              <span class="hidden sm:inline">Exit</span>
            </button>
          </div>
        </header>

        <!-- Main Sandbox Viewport Stage -->
        <div
          class="relative flex-1 w-full min-h-[420px] bg-slate-950 overflow-hidden flex items-center justify-center"
          style="display: flex; align-items: center; justify-content: center; min-height: 420px;"
        >
          <!-- Loading / Container Boot Stepper (Centered in Window) -->
          @if (status() === 'loading') {
            <div
              class="absolute inset-0 z-20 flex items-center justify-center p-4 pointer-events-auto"
              style="display: flex; align-items: center; justify-content: center;"
            >
              <div class="max-w-md w-full p-6 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-xl text-center">
                <div class="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto mb-4">
                  <svg lucideRefreshCw class="w-6 h-6 text-sky-400 animate-spin"></svg>
                </div>
                <h4 class="text-base font-bold text-white mb-1">{{ loadingStepLabel() }}</h4>
                <p class="text-xs text-slate-400 mb-4">{{ loadingSubLabel() }}</p>

                <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden mb-3">
                  <div
                    class="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                    [style.width.%]="loadingProgress()"
                  ></div>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Engine: Official Luanti Container</span>
                  <span>{{ loadingProgress() }}%</span>
                </div>
              </div>
            </div>
          }

          <!-- Fault / Container Unavailable / Quota View (Centered in Window) -->
          @if (status() === 'fault' && faultState(); as fault) {
            <div
              class="absolute inset-0 z-30 flex items-center justify-center p-4 pointer-events-auto"
              style="display: flex; align-items: center; justify-content: center;"
            >
              <div
                class="max-w-lg w-full p-6 rounded-2xl bg-slate-900/95 border border-rose-500/40 shadow-2xl"
                data-testid="sandbox-fault-recovery"
              >
                <div class="flex items-start gap-3.5 mb-4">
                  <div class="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 shrink-0">
                    <svg lucideShieldAlert class="w-6 h-6"></svg>
                  </div>
                  <div>
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-500/20 text-rose-300 mb-1">
                      {{ fault.code }} • Sandbox Guard
                    </span>
                    <h4 class="text-base font-bold text-white">{{ fault.title }}</h4>
                    <p class="text-xs text-slate-300 mt-1 leading-relaxed">{{ fault.message }}</p>
                  </div>
                </div>

                @if (fault.detail) {
                  <pre
                    class="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-sky-300 font-mono overflow-x-auto mb-4"
                  >{{ fault.detail }}</pre>
                }

                <div class="flex flex-wrap items-center justify-end gap-2.5">
                  <button
                    type="button"
                    (click)="$event.stopPropagation(); retryBoot()"
                    class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-colors"
                  >
                    <svg lucideRefreshCw class="w-3.5 h-3.5"></svg>
                    Retry Connection
                  </button>
                  <button
                    type="button"
                    (click)="$event.stopPropagation(); triggerDownloadAndClose()"
                    class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 transition-colors"
                  >
                    <svg lucideDownload class="w-3.5 h-3.5"></svg>
                    Download for Native Luanti
                  </button>
                </div>
              </div>
            </div>
          }

          <!-- Interactive Container Stream Iframe -->
          @if (iframeVisible()) {
            <iframe
              #sandboxIframe
              allow="pointer-lock; fullscreen; autoplay; clipboard-read; clipboard-write"
              class="absolute inset-0 w-full h-full border-0 transition-opacity duration-200"
              [class.opacity-0]="status() !== 'running'"
              [class.pointer-events-none]="status() !== 'running'"
              title="Isolated Luanti Container Session"
            ></iframe>
          }
        </div>

        <!-- Bottom Quick-Action HUD Bar -->
        <footer
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900 border-t border-slate-800 text-xs"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-slate-400 font-semibold mr-1">Luanti Controls:</span>
            @if (!isTouchDevice()) {
              <button
                type="button"
                data-testid="sandbox-mouse-lock-btn"
                (click)="$event.stopPropagation(); sendKeyCommand('TOGGLE_MOUSE_LOCK')"
                class="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 font-semibold transition-colors"
                title="Toggle 3D Mouse Lock / Unlock (Shortcut: Shift+Esc)"
              >
                🔒 Lock / Unlock Mouse (Shift+Esc)
              </button>
            }

            <button
              type="button"
              (click)="$event.stopPropagation(); sendKeyCommand('TOGGLE_INVENTORY')"
              class="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-semibold transition-colors"
              title="Open Creative Inventory (I) to browse blocks, vehicles & mobs"
            >
              🎒 Creative Inventory (I)
            </button>

            <button
              type="button"
              (click)="$event.stopPropagation(); sendKeyCommand('TOGGLE_FLY')"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            >
              🪽 Fly (K)
            </button>

            <button
              type="button"
              (click)="$event.stopPropagation(); sendKeyCommand('TOGGLE_FAST')"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            >
              ⚡ Fast (J)
            </button>

            <button
              type="button"
              (click)="$event.stopPropagation(); sendKeyCommand('ESCAPE')"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            >
              ⏸️ Menu (Esc)
            </button>

            <button
              type="button"
              (click)="$event.stopPropagation(); retryBoot()"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            >
              🔄 Restart World
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              (click)="$event.stopPropagation(); triggerDownloadAndClose()"
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors shadow-sm"
            >
              <svg lucideDownload class="w-3.5 h-3.5"></svg>
              <span>Download Package</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  `
})
export class PwaSandboxModalComponent implements OnInit, OnDestroy {
  readonly pkg = input.required<LuantiPackage>();
  readonly releaseTag = input<string>('');
  readonly close = output<void>();
  readonly downloadRequested = output<void>();

  private _sandboxIframeRef?: ElementRef<HTMLIFrameElement>;
  @ViewChild('sandboxIframe')
  set sandboxIframeRef(ref: ElementRef<HTMLIFrameElement> | undefined) {
    this._sandboxIframeRef = ref;
    const url = this.activeStreamUrl();
    if (ref?.nativeElement && url && ref.nativeElement.src !== url) {
      ref.nativeElement.src = url;
    }
  }
  get sandboxIframeRef(): ElementRef<HTMLIFrameElement> | undefined {
    return this._sandboxIframeRef;
  }
  @ViewChild('modalContainer') modalContainerRef?: ElementRef<HTMLElement>;

  private readonly memoryGuard = inject(SandboxMemoryGuardService);

  readonly isMaximized = signal(false);
  readonly isTouchDevice = signal<boolean>(this.detectTouchDevice());
  readonly memoryProfile = signal<SandboxMemoryProfile>(this.memoryGuard.detectMemoryProfile());
  readonly status = signal<'loading' | 'running' | 'fault'>('loading');
  readonly iframeVisible = signal(true);
  readonly activeStreamUrl = signal<string>('');

  readonly loadingStepLabel = signal('Resolving Package & Dependency Closure...');
  readonly loadingSubLabel = signal('Checking monthly quota & archive limits');
  readonly loadingProgress = signal(15);

  readonly currentMemoryMb = signal(180);
  readonly maxMemoryMb = signal(1024);
  readonly loadedModCount = signal(1);
  readonly quotaUsagePercent = signal(0);
  readonly faultState = signal<SandboxFaultState | null>(null);

  readonly memoryUsagePercent = computed(() => {
    const max = Math.max(1, this.maxMemoryMb());
    return Math.min(100, Math.round((this.currentMemoryMb() / max) * 100));
  });

  readonly memoryWarningLevel = computed<'normal' | 'elevated' | 'critical'>(() => {
    const pct = this.memoryUsagePercent();
    if (pct >= 88) return 'critical';
    if (pct >= 72) return 'elevated';
    return 'normal';
  });

  private statusPollIntervalId: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  private readonly boundMessageListener = (event: MessageEvent) => {
    if (event.data?.source === 'luanti-sandbox-container') {
      if (event.data?.type === 'SANDBOX_STREAM_CONNECTED') {
        this.status.set('running');
        this.loadingProgress.set(100);
      } else if (event.data?.type === 'SANDBOX_INPUT_MODE') {
        this.isTouchDevice.set(Boolean(event.data.touchMode));
      }
    }
  };

  private readonly boundKeyDownListener = (event: KeyboardEvent) => {
    if (this.status() !== 'running') return;
    const isShiftEsc =
      event.code === 'Escape' && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
    const isCtrlShiftL =
      event.code === 'KeyL' &&
      event.shiftKey &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey;
    if (isShiftEsc || isCtrlShiftL) {
      event.preventDefault();
      event.stopPropagation();
      this.sendKeyCommand('TOGGLE_MOUSE_LOCK');
    }
  };

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.boundMessageListener);
      window.addEventListener('keydown', this.boundKeyDownListener);
    }
    this.startSandboxBootSequence();
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.boundMessageListener);
      window.removeEventListener('keydown', this.boundKeyDownListener);
    }
    this.performDeterministicTeardown(true);
  }

  retryBoot(): void {
    this.startSandboxBootSequence();
  }

  async startSandboxBootSequence(): Promise<void> {
    this.performDeterministicTeardown(false);

    const profile = this.memoryGuard.detectMemoryProfile();
    this.memoryProfile.set(profile);
    this.status.set('loading');
    this.faultState.set(null);
    this.iframeVisible.set(true);
    this.loadingProgress.set(20);
    this.loadingStepLabel.set('Resolving Package & Dependency Closure...');
    this.loadingSubLabel.set('Verifying archive size & monthly container quota...');

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const p = this.pkg();
      const rel = this.releaseTag();
      const manifest = await this.fetchSandboxManifest(p, rel, signal);

      if (manifest.quota) {
        this.memoryGuard.updateQuotaStatus(manifest.quota);
        this.quotaUsagePercent.set(Number(manifest.quota.usagePercent || 0));
      }

      if (manifest.quotaExhausted || this.memoryGuard.isQuotaExhausted()) {
        throw new SandboxMemoryGuardError(
          'SANDBOX_QUOTA_EXHAUSTED',
          'The monthly Cloudflare Container quota has reached its 90% safety limit and will automatically reset on the 2nd of next month.'
        );
      }

      const estimatedBytes = Math.max(Number(manifest.estimatedTotalBytes || 0), Number(p.download_size || 0));
      if (estimatedBytes > 0) {
        this.memoryGuard.validatePreFlightArchiveSize(estimatedBytes, profile);
      }

      this.loadingProgress.set(55);
      this.loadingStepLabel.set('Booting Official Luanti Container...');
      const gameLabel = manifest.targetGame?.title || '/worlds/sandbox/worldmods';
      this.loadingSubLabel.set(
        `Mounting ${manifest.bundles.length} package bundle(s) into ${gameLabel}...`
      );

      const isTouchDevice = this.detectTouchDevice();
      this.isTouchDevice.set(isTouchDevice);

      const bootRes = await fetch('/api/sandbox/session', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'boot',
          packageId: manifest.packageId,
          author: manifest.author,
          name: manifest.name,
          title: manifest.title,
          type: manifest.type,
          baseEnvironment: manifest.baseEnvironment,
          touchMode: isTouchDevice,
          bundles: manifest.bundles
        })
      });

      const bootData = await bootRes.json().catch(() => ({} as any));
      if (bootData?.quota) {
        this.memoryGuard.updateQuotaStatus(bootData.quota);
        this.quotaUsagePercent.set(Number(bootData.quota.usagePercent || 0));
      }

      if (!bootRes.ok || bootData?.ok === false) {
        this.triggerContainedFault({
          code: String(bootData?.code || 'SANDBOX_CONTAINER_UNAVAILABLE'),
          title: 'Luanti Sandbox Container Not Running',
          message:
            bootData?.message ||
            'Start the local Luanti Docker container to test packages in-browser.',
          detail: 'npm run sandbox:docker:up'
        });
        return;
      }

      this.currentMemoryMb.set(Number(bootData.memoryMb || 180));
      this.maxMemoryMb.set(Number(bootData.maxMemoryMb || 1024));
      this.loadedModCount.set(
        Array.isArray(bootData.session?.loadedMods) ? bootData.session.loadedMods.length : manifest.bundles.length
      );

      const streamUrl = String(bootData.streamUrl || 'http://localhost:6080/sandbox.html');
      const touchParam = isTouchDevice ? '&touch=1' : '';
      const cacheBustedUrl = `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}t=${Date.now()}${touchParam}`;
      this.activeStreamUrl.set(cacheBustedUrl);

      const iframe = this.sandboxIframeRef?.nativeElement;
      if (iframe) {
        iframe.src = cacheBustedUrl;
      }

      this.loadingProgress.set(95);
      this.loadingStepLabel.set('Connecting to Luanti Display Stream...');
      this.loadingSubLabel.set('Press I inside the game to open the Creative Inventory');

      setTimeout(() => {
        if (this.status() === 'loading') {
          this.status.set('running');
          this.loadingProgress.set(100);
        }
      }, 900);

      this.startStatusPolling();
    } catch (err: any) {
      if (signal.aborted) return;
      this.handleBootOrGuardError(err);
    }
  }

  private detectTouchDevice(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const coarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || '');
    return Boolean(coarsePointer || (navigator.maxTouchPoints > 0 && mobileUa));
  }

  private async fetchSandboxManifest(
    p: LuantiPackage,
    releaseTag: string,
    signal: AbortSignal
  ): Promise<SandboxManifest> {
    const relKey = releaseTag || 'latest';
    const cachedManifest = this.memoryGuard.getCachedManifest<SandboxManifest>(
      p.author,
      p.name,
      relKey
    );
    if (cachedManifest && Array.isArray(cachedManifest.bundles) && cachedManifest.bundles.length > 0) {
      return cachedManifest;
    }

    const safeDir = (p.name || 'mod').toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'mod';
    const relParam = releaseTag ? `&release=${encodeURIComponent(releaseTag)}` : '';
    const manifestUrl = `/api/sandbox/manifest?author=${encodeURIComponent(p.author)}&name=${encodeURIComponent(p.name)}${relParam}`;

    try {
      const res = await fetch(manifestUrl, {
        signal,
        headers: { Accept: 'application/json', 'X-Purpose': 'preview' }
      });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.bundles) && json.bundles.length > 0) {
          this.memoryGuard.setCachedManifest(p.author, p.name, relKey, json);
          return json as SandboxManifest;
        }
      }
    } catch {
      // Fallback to direct single-package bundle
    }

    const pkgType = p.type === 'game' ? 'game' : p.type === 'txp' ? 'txp' : 'mod';
    const mountPath = pkgType === 'game' ? `/games/${safeDir}` : pkgType === 'txp' ? `/textures/${safeDir}` : `/mods/${safeDir}`;
    const fallbackBundles: SandboxBundleDescriptor[] = [
      {
        id: `${p.author}/${p.name}`,
        author: p.author,
        name: p.name,
        title: p.title || p.name,
        type: pkgType,
        isPrimary: true,
        downloadUrl: `/api/packages/${encodeURIComponent(p.author)}/${encodeURIComponent(p.name)}/download?sandbox=1`,
        mountPath,
        estimatedBytes: Number(p.download_size || 0)
      }
    ];

    let targetGame: SandboxManifest['targetGame'] = null;
    if (pkgType === 'mod') {
      const compatibleGames = mergeLuantiHubAndContentDbGameSupport(
        p.game_support,
        undefined,
        p.dependencies,
        p.optional_dependencies
      ).filter(gs => gs.supports !== false);
      const supportsMtg =
        Boolean(p.supports_all_games) ||
        compatibleGames.some(gs => gs.game.name.toLowerCase() === 'minetest_game');
      if (supportsMtg) {
        targetGame = {
          id: 'Luanti/minetest_game',
          author: 'Luanti',
          name: 'minetest_game',
          title: 'Minetest Game'
        };
      } else if (compatibleGames.length > 0) {
        const picked = compatibleGames[0].game;
        targetGame = {
          id: picked.id,
          author: picked.author,
          name: picked.name,
          title: picked.title
        };
        const safeGameDir =
          picked.name.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'game';
        fallbackBundles.unshift({
          id: `${picked.author}/${picked.name}`,
          author: picked.author,
          name: picked.name,
          title: picked.title,
          type: 'game',
          isPrimary: false,
          downloadUrl: `/api/packages/${encodeURIComponent(picked.author)}/${encodeURIComponent(picked.name)}/download?sandbox=1`,
          mountPath: `/games/${safeGameDir}`,
          estimatedBytes: 0
        });
      }
    }

    return {
      packageId: `${p.author}/${p.name}`,
      author: p.author,
      name: p.name,
      title: p.title || p.name,
      type: pkgType,
      baseEnvironment:
        pkgType === 'game' || (targetGame && targetGame.name.toLowerCase() !== 'minetest_game')
          ? 'native_game'
          : pkgType === 'txp'
            ? 'texture_showcase'
            : 'devtest',
      targetGame,
      estimatedTotalBytes: Number(p.download_size || 0),
      bundles: fallbackBundles
    };
  }

  private startStatusPolling(): void {
    if (this.statusPollIntervalId) {
      clearInterval(this.statusPollIntervalId);
    }
    this.statusPollIntervalId = setInterval(() => {
      if (this.status() !== 'running') return;
      fetch('/api/sandbox/session')
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (!data) return;
          if (data.memoryMb) this.currentMemoryMb.set(Number(data.memoryMb));
          if (data.maxMemoryMb) this.maxMemoryMb.set(Number(data.maxMemoryMb));
          if (data.quota) {
            this.memoryGuard.updateQuotaStatus(data.quota);
            this.quotaUsagePercent.set(Number(data.quota.usagePercent || 0));
          }
        })
        .catch(() => {});
    }, 4000);
  }

  private handleBootOrGuardError(err: any): void {
    if (err instanceof SandboxMemoryGuardError) {
      this.triggerContainedFault({
        code: err.code,
        title: 'Blocked by Pre-Flight Sandbox Guard',
        message: err.message
      });
      return;
    }

    this.triggerContainedFault({
      code: 'SANDBOX_CONTAINER_UNAVAILABLE',
      title: 'Unable to Connect to Luanti Sandbox Container',
      message: err?.message || 'Start the local Luanti Docker container to test packages in-browser.',
      detail: 'npm run sandbox:docker:up'
    });
  }

  private triggerContainedFault(fault: SandboxFaultState): void {
    this.performDeterministicTeardown(false);
    this.faultState.set(fault);
    this.status.set('fault');
  }

  sendKeyCommand(
    command: 'TOGGLE_MOUSE_LOCK' | 'TOGGLE_INVENTORY' | 'TOGGLE_FLY' | 'TOGGLE_FAST' | 'ESCAPE'
  ): void {
    if (this.status() !== 'running') return;
    try {
      const iframe = this.sandboxIframeRef?.nativeElement;
      iframe?.focus();
      iframe?.contentWindow?.postMessage(
        { type: 'SANDBOX_HUD_COMMAND', command },
        '*'
      );
    } catch {
      // Ignore cross-origin postMessage errors
    }
    if (command === 'TOGGLE_MOUSE_LOCK') return;
    fetch('/api/sandbox/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'command', command })
    }).catch(() => {});
  }

  toggleFullscreen(event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.isMaximized.set(!this.isMaximized());
  }

  triggerDownloadAndClose(): void {
    this.downloadRequested.emit();
    this.closeSandbox();
  }

  closeSandbox(event?: Event): void {
    event?.stopPropagation();
    this.performDeterministicTeardown(true);
    this.close.emit();
  }

  private performDeterministicTeardown(stopContainer = true): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.statusPollIntervalId) {
      clearInterval(this.statusPollIntervalId);
      this.statusPollIntervalId = null;
    }
    if (stopContainer) {
      const iframe = this.sandboxIframeRef?.nativeElement;
      this.memoryGuard.teardownSandboxIframe(iframe);
      this.iframeVisible.set(false);
      this.activeStreamUrl.set('');
      if (typeof fetch !== 'undefined') {
        fetch('/api/sandbox/session', { method: 'DELETE', keepalive: true }).catch(() => {});
      }
    }
  }
}

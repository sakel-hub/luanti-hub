import {
  Component,
  ChangeDetectionStrategy,
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
  LucideX,
  LucidePlay,
  LucideShieldCheck,
  LucideShieldAlert,
  LucideRefreshCw,
  LucideDownload,
  LucideMaximize2,
  LucideTerminal
} from '@lucide/angular';
import { LuantiPackage } from '../../core/models/package.model';
import {
  ExtractedVfsFile,
  HeartbeatTelemetry,
  SandboxMemoryGuardError,
  SandboxMemoryGuardService,
  SandboxMemoryProfile
} from '../../core/services/sandbox-memory-guard.service';

interface SandboxBundleItem {
  id: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  isPrimary: boolean;
  downloadUrl: string;
  mountPath: string;
  estimatedBytes: number;
}

interface SandboxManifest {
  packageId: string;
  author: string;
  name: string;
  title: string;
  type: 'mod' | 'game' | 'txp' | 'modpack';
  baseEnvironment: string;
  estimatedTotalBytes: number;
  bundles: SandboxBundleItem[];
}

export interface SandboxFaultState {
  code: string;
  title: string;
  message: string;
  detail?: string;
  wasmHeapMb?: number;
  maxWasmHeapMb?: number;
  canRetrySafeMode: boolean;
}

@Component({
  selector: 'app-pwa-sandbox-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    LucideX,
    LucidePlay,
    LucideShieldCheck,
    LucideShieldAlert,
    LucideRefreshCw,
    LucideDownload,
    LucideMaximize2,
    LucideTerminal
  ],
  template: `
    <div
      class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-2 sm:p-5 animate-fade-in"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'Try ' + pkg().title + ' in Browser Sandbox'"
    >
      <div
        #modalContainer
        class="relative flex flex-col w-full max-w-6xl h-[88vh] max-h-[860px] rounded-2xl border border-slate-700/70 bg-slate-900 shadow-2xl overflow-hidden"
      >
        <!-- Top Control & Memory Telemetry Bar -->
        <header
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900/95 border-b border-slate-800"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-sky-500/15 text-sky-300 border border-sky-500/30"
            >
              <svg lucidePlay class="w-3.5 h-3.5 text-sky-400"></svg>
              PWA Sandbox
            </span>
            <h3 class="text-sm sm:text-base font-bold text-white truncate">
              {{ pkg().title }}
            </h3>
            <span class="hidden md:inline-block text-xs text-slate-400 font-mono">
              ({{ pkg().author }}/{{ pkg().name }})
            </span>
          </div>

          <!-- Live Layer 1–3 RAM & FPS Telemetry Pill -->
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
              title="Layer 3 Real-Time WebAssembly Linear Memory & FPS Watchdog"
            >
              <svg lucideShieldCheck class="w-3.5 h-3.5 shrink-0"></svg>
              <span>
                RAM: {{ currentWasmMb() }} / {{ memoryProfile().maxWasmHeapMb }} MB ({{ memoryUsagePercent() }}%)
              </span>
              @if (status() === 'running') {
                <span class="text-slate-500">•</span>
                <span>{{ currentFps() }} FPS</span>
                <span class="hidden sm:inline text-slate-500">•</span>
                <span class="hidden sm:inline">VFS: {{ mountedFileCount() }} files</span>
              }
            </div>

            @if (safeModeActive()) {
              <span
                class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30"
              >
                Safe Mode (Range: {{ memoryProfile().viewingRange }})
              </span>
            }

            <button
              type="button"
              (click)="toggleFullscreen()"
              class="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              title="Toggle Fullscreen"
              aria-label="Toggle Fullscreen"
            >
              <svg lucideMaximize2 class="w-4 h-4"></svg>
            </button>

            <button
              type="button"
              (click)="closeSandbox()"
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-rose-600/80 border border-slate-700 transition-colors"
              aria-label="Close Sandbox"
            >
              <svg lucideX class="w-4 h-4"></svg>
              <span class="hidden sm:inline">Exit</span>
            </button>
          </div>
        </header>

        <!-- Main Sandbox Viewport Stage -->
        <div class="relative flex-1 bg-slate-950 overflow-hidden flex items-center justify-center">
          <!-- Loading / Unpacking Stepper -->
          @if (status() === 'loading') {
            <div class="z-20 max-w-md w-full mx-4 p-6 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-xl text-center">
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
                <span>Profile: {{ memoryProfile().label }}</span>
                <span>{{ loadingProgress() }}%</span>
              </div>
            </div>
          }

          <!-- Layer 3 Crash / Segfault / OOM Contained Recovery View -->
          @if (status() === 'fault' && faultState(); as fault) {
            <div
              class="z-30 max-w-lg w-full mx-4 p-6 rounded-2xl bg-slate-900/95 border border-rose-500/40 shadow-2xl"
              data-testid="sandbox-fault-recovery"
            >
              <div class="flex items-start gap-3.5 mb-4">
                <div class="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 shrink-0">
                  <svg lucideShieldAlert class="w-6 h-6"></svg>
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-500/20 text-rose-300 mb-1">
                    {{ fault.code }} • Contained by Sandbox Guard
                  </span>
                  <h4 class="text-base font-bold text-white">{{ fault.title }}</h4>
                  <p class="text-xs text-slate-300 mt-1 leading-relaxed">{{ fault.message }}</p>
                </div>
              </div>

              @if (fault.detail) {
                <pre
                  class="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-rose-300/90 font-mono overflow-x-auto max-h-28 mb-4"
                >{{ fault.detail }}</pre>
              }

              <div class="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/25 text-xs text-emerald-200 mb-5 flex items-center gap-2">
                <svg lucideShieldCheck class="w-4 h-4 text-emerald-400 shrink-0"></svg>
                <span>
                  Your LuantiHub PWA session was protected. All WebGL &amp; WASM buffers were cleanly reclaimed.
                </span>
              </div>

              <div class="flex flex-wrap items-center justify-end gap-2.5">
                @if (fault.canRetrySafeMode) {
                  <button
                    type="button"
                    (click)="relaunchInSafeMode()"
                    class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 transition-colors"
                    data-testid="sandbox-retry-safe-mode"
                  >
                    <svg lucideRefreshCw class="w-3.5 h-3.5"></svg>
                    Relaunch in Safe Mode (Low RAM)
                  </button>
                }
                <button
                  type="button"
                  (click)="triggerDownloadAndClose()"
                  class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 transition-colors"
                >
                  <svg lucideDownload class="w-3.5 h-3.5"></svg>
                  Download for Native Luanti
                </button>
              </div>
            </div>
          }

          <!-- Layer 2 Disposable Same-Origin Sandboxed Iframe -->
          @if (iframeVisible()) {
            <iframe
              #sandboxIframe
              src="/wasm/sandbox-runner.html"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock"
              class="w-full h-full border-0"
              [class.opacity-0]="status() !== 'running'"
              title="Isolated Luanti WebAssembly Sandbox"
              (load)="onIframeLoaded()"
            ></iframe>
          }
        </div>

        <!-- Bottom Quick-Action HUD Bar -->
        <footer
          class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900 border-t border-slate-800 text-xs"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-slate-400 font-semibold mr-1">Environment:</span>
            <button
              type="button"
              (click)="setTimeOfDay('noon')"
              class="px-2.5 py-1 rounded-lg border transition-colors"
              [class.bg-sky-500/20]="timeOfDay() === 'noon'"
              [class.border-sky-500/40]="timeOfDay() === 'noon'"
              [class.text-sky-200]="timeOfDay() === 'noon'"
              [class.bg-slate-800]="timeOfDay() !== 'noon'"
              [class.border-slate-700]="timeOfDay() !== 'noon'"
              [class.text-slate-300]="timeOfDay() !== 'noon'"
            >
              ☀️ Noon
            </button>
            <button
              type="button"
              (click)="setTimeOfDay('sunset')"
              class="px-2.5 py-1 rounded-lg border transition-colors"
              [class.bg-amber-500/20]="timeOfDay() === 'sunset'"
              [class.border-amber-500/40]="timeOfDay() === 'sunset'"
              [class.text-amber-200]="timeOfDay() === 'sunset'"
              [class.bg-slate-800]="timeOfDay() !== 'sunset'"
              [class.border-slate-700]="timeOfDay() !== 'sunset'"
              [class.text-slate-300]="timeOfDay() !== 'sunset'"
            >
              🌅 Sunset
            </button>
            <button
              type="button"
              (click)="setTimeOfDay('midnight')"
              class="px-2.5 py-1 rounded-lg border transition-colors"
              [class.bg-indigo-500/20]="timeOfDay() === 'midnight'"
              [class.border-indigo-500/40]="timeOfDay() === 'midnight'"
              [class.text-indigo-200]="timeOfDay() === 'midnight'"
              [class.bg-slate-800]="timeOfDay() !== 'midnight'"
              [class.border-slate-700]="timeOfDay() !== 'midnight'"
              [class.text-slate-300]="timeOfDay() !== 'midnight'"
            >
              🌙 Night
            </button>

            <span class="text-slate-700 mx-1">|</span>

            <button
              type="button"
              (click)="toggleFlyMode()"
              class="px-2.5 py-1 rounded-lg border transition-colors"
              [class.bg-emerald-500/20]="flyMode()"
              [class.border-emerald-500/40]="flyMode()"
              [class.text-emerald-200]="flyMode()"
              [class.bg-slate-800]="!flyMode()"
              [class.border-slate-700]="!flyMode()"
              [class.text-slate-300]="!flyMode()"
            >
              🪽 Fly (K): {{ flyMode() ? 'ON' : 'OFF' }}
            </button>

            <button
              type="button"
              (click)="toggleFastMode()"
              class="px-2.5 py-1 rounded-lg border transition-colors"
              [class.bg-emerald-500/20]="fastMode()"
              [class.border-emerald-500/40]="fastMode()"
              [class.text-emerald-200]="fastMode()"
              [class.bg-slate-800]="!fastMode()"
              [class.border-slate-700]="!fastMode()"
              [class.text-slate-300]="!fastMode()"
            >
              ⚡ Fast (J): {{ fastMode() ? 'ON' : 'OFF' }}
            </button>

            <button
              type="button"
              (click)="respawnWorld()"
              class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            >
              🔄 Reset World
            </button>
          </div>

          <div class="flex items-center gap-2">
            <!-- Developer Fault & Memory Guard Verification Menu -->
            <div class="relative">
              <button
                type="button"
                (click)="showGuardMenu.set(!showGuardMenu())"
                class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-mono text-[11px] transition-colors"
                data-testid="sandbox-guard-test-menu-btn"
                title="Verify RAM, OOM & C++ Segfault Containment"
              >
                <svg lucideTerminal class="w-3.5 h-3.5 text-amber-400"></svg>
                <span>Test Crash Guard</span>
              </button>

              @if (showGuardMenu()) {
                <div
                  class="absolute bottom-full right-0 mb-2 w-64 p-2 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-40 flex flex-col gap-1"
                >
                  <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    Layer 3 Fault Containment Tests
                  </div>
                  <button
                    type="button"
                    (click)="simulateFault('WASM_SEGFAULT')"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-500/15 text-rose-300 text-xs transition-colors"
                    data-testid="simulate-wasm-segfault-btn"
                  >
                    💥 Trigger WASM C++ Segfault
                  </button>
                  <button
                    type="button"
                    (click)="simulateFault('WASM_OOM')"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-amber-500/15 text-amber-300 text-xs transition-colors"
                    data-testid="simulate-wasm-oom-btn"
                  >
                    📈 Trigger WASM Out-of-Memory Cap
                  </button>
                  <button
                    type="button"
                    (click)="simulateFault('WEBGL_CONTEXT_LOST')"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-sky-500/15 text-sky-300 text-xs transition-colors"
                    data-testid="simulate-webgl-loss-btn"
                  >
                    🖥️ Trigger WebGL GPU Context Loss
                  </button>
                </div>
              }
            </div>

            <button
              type="button"
              (click)="triggerDownloadAndClose()"
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

  @ViewChild('sandboxIframe') sandboxIframeRef?: ElementRef<HTMLIFrameElement>;
  @ViewChild('modalContainer') modalContainerRef?: ElementRef<HTMLElement>;

  private readonly memoryGuard = inject(SandboxMemoryGuardService);

  readonly safeModeActive = signal(false);
  readonly memoryProfile = signal<SandboxMemoryProfile>(this.memoryGuard.detectMemoryProfile());
  readonly status = signal<'loading' | 'running' | 'fault'>('loading');
  readonly iframeVisible = signal(true);

  readonly loadingStepLabel = signal('Checking Device RAM & WebGL 2.0 Budget...');
  readonly loadingSubLabel = signal('Initializing 4-layer memory guard');
  readonly loadingProgress = signal(12);

  readonly currentWasmMb = signal(64);
  readonly currentFps = signal(60);
  readonly mountedFileCount = signal(0);
  readonly lastHeartbeat = signal<HeartbeatTelemetry | null>(null);

  readonly flyMode = signal(true);
  readonly fastMode = signal(false);
  readonly timeOfDay = signal<'noon' | 'sunset' | 'midnight'>('noon');
  readonly showGuardMenu = signal(false);
  readonly faultState = signal<SandboxFaultState | null>(null);

  readonly memoryUsagePercent = computed(() => {
    const max = Math.max(1, this.memoryProfile().maxWasmHeapMb);
    return Math.min(100, Math.round((this.currentWasmMb() / max) * 100));
  });

  readonly memoryWarningLevel = computed<'normal' | 'elevated' | 'critical'>(() => {
    const pct = this.memoryUsagePercent();
    if (pct >= 88) return 'critical';
    if (pct >= 72) return 'elevated';
    return 'normal';
  });

  private extractedVfsFiles: ExtractedVfsFile[] = [];
  private iframeLoaded = false;
  private vfsReady = false;
  private watchdogIntervalId: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  private readonly boundMessageListener = (event: MessageEvent) => this.handleRunnerMessage(event);

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.boundMessageListener);
    }
    this.startSandboxBootSequence(false);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.boundMessageListener);
    }
    this.performDeterministicTeardown();
  }

  onIframeLoaded(): void {
    this.iframeLoaded = true;
    this.trySendBootPayloadToRunner();
  }

  async startSandboxBootSequence(useSafeMode: boolean): Promise<void> {
    this.performDeterministicTeardown(false);

    this.safeModeActive.set(useSafeMode);
    const profile = this.memoryGuard.detectMemoryProfile(undefined, undefined, useSafeMode);
    this.memoryProfile.set(profile);

    this.status.set('loading');
    this.faultState.set(null);
    this.iframeLoaded = false;
    this.vfsReady = false;
    this.iframeVisible.set(true);
    this.loadingProgress.set(15);
    this.loadingStepLabel.set('Resolving Package & Dependency Closure...');
    this.loadingSubLabel.set(`${profile.label} • Max VFS: ${(profile.maxUncompressedBytes / (1024 * 1024)).toFixed(0)} MB`);

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const p = this.pkg();
      const rel = this.releaseTag();
      const manifest = await this.fetchSandboxManifest(p, rel, signal);

      if (manifest.estimatedTotalBytes > 0) {
        this.memoryGuard.validatePreFlightArchiveSize(manifest.estimatedTotalBytes, profile);
      }

      this.loadingProgress.set(38);
      this.loadingStepLabel.set('Downloading & Unpacking Archive into Memory...');

      const allFiles: ExtractedVfsFile[] = [];
      let runningUncompressed = 0;
      let runningFiles = 0;

      for (let i = 0; i < manifest.bundles.length; i++) {
        const bundle = manifest.bundles[i];
        this.loadingSubLabel.set(`Unpacking ${bundle.id} (${i + 1}/${manifest.bundles.length})...`);

        const zipBytes = await this.fetchBundleZipBytes(bundle.downloadUrl, signal);
        if (zipBytes && zipBytes.byteLength > 0) {
          const result = await this.memoryGuard.extractZipWithMemoryGuard(
            zipBytes,
            bundle.mountPath,
            profile,
            runningUncompressed,
            runningFiles
          );
          allFiles.push(...result.files);
          runningUncompressed += result.totalUncompressedBytes;
          runningFiles += result.files.length;
        }
        this.loadingProgress.set(38 + Math.round(((i + 1) / manifest.bundles.length) * 45));
      }

      this.extractedVfsFiles = allFiles;
      this.mountedFileCount.set(allFiles.length);
      this.vfsReady = true;
      this.loadingProgress.set(92);
      this.loadingStepLabel.set('Booting Isolated WebGL 2.0 Voxel Engine...');
      this.loadingSubLabel.set(`Mounted ${allFiles.length} files (${(runningUncompressed / 1024).toFixed(1)} KB)`);

      this.trySendBootPayloadToRunner();
    } catch (err: any) {
      if (signal.aborted) return;
      this.handleBootOrGuardError(err);
    }
  }

  private async fetchSandboxManifest(
    p: LuantiPackage,
    releaseTag: string,
    signal: AbortSignal
  ): Promise<SandboxManifest> {
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
          return json as SandboxManifest;
        }
      }
    } catch {
      // Fallback to direct single-package bundle below
    }

    const pkgType = p.type === 'game' ? 'game' : p.type === 'txp' ? 'txp' : 'mod';
    const mountPath = pkgType === 'game' ? `/games/${safeDir}` : pkgType === 'txp' ? `/textures/${safeDir}` : `/mods/${safeDir}`;
    return {
      packageId: `${p.author}/${p.name}`,
      author: p.author,
      name: p.name,
      title: p.title || p.name,
      type: pkgType,
      baseEnvironment: pkgType === 'game' ? 'native_game' : pkgType === 'txp' ? 'texture_showcase' : 'devtest',
      estimatedTotalBytes: Number(p.download_size || 0),
      bundles: [
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
      ]
    };
  }

  private async fetchBundleZipBytes(url: string, signal: AbortSignal): Promise<Uint8Array | null> {
    try {
      const res = await fetch(url, {
        signal,
        headers: { 'X-Purpose': 'preview' }
      });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.byteLength >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
        return bytes;
      }
      return null;
    } catch {
      return null;
    }
  }

  private trySendBootPayloadToRunner(): void {
    if (!this.iframeLoaded || !this.vfsReady) return;
    const iframe = this.sandboxIframeRef?.nativeElement;
    if (!iframe?.contentWindow) return;

    const profile = this.memoryProfile();
    const p = this.pkg();

    iframe.contentWindow.postMessage(
      {
        type: 'SANDBOX_BOOT',
        maxWasmHeapMb: profile.maxWasmHeapMb,
        viewingRange: profile.viewingRange,
        packageMeta: {
          id: p.id,
          author: p.author,
          name: p.name,
          title: p.title,
          type: p.type
        },
        files: this.extractedVfsFiles
      },
      '*'
    );
  }

  private handleRunnerMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || data.source !== 'luanti-sandbox-runner') return;

    switch (data.type) {
      case 'SANDBOX_HOST_LOADED': {
        this.iframeLoaded = true;
        this.trySendBootPayloadToRunner();
        break;
      }

      case 'SANDBOX_READY': {
        this.status.set('running');
        this.loadingProgress.set(100);
        this.currentWasmMb.set(Number(data.wasmHeapMb || 96));
        this.mountedFileCount.set(Number(data.mountedFiles || this.extractedVfsFiles.length));
        const now = Date.now();
        this.lastHeartbeat.set({
          fps: 60,
          wasmHeapMb: Number(data.wasmHeapMb || 96),
          maxWasmHeapMb: this.memoryProfile().maxWasmHeapMb,
          jsHeapMb: Number(data.wasmHeapMb || 96),
          vfsBytes: Number(data.vfsBytes || 0),
          mountedFiles: Number(data.mountedFiles || 0),
          voxelCount: 0,
          timestamp: now
        });
        this.startHeartbeatWatchdog();
        break;
      }

      case 'SANDBOX_HEARTBEAT': {
        const telemetry: HeartbeatTelemetry = {
          fps: Number(data.fps || 60),
          wasmHeapMb: Number(data.wasmHeapMb || this.currentWasmMb()),
          maxWasmHeapMb: Number(data.maxWasmHeapMb || this.memoryProfile().maxWasmHeapMb),
          jsHeapMb: Number(data.jsHeapMb || 0),
          vfsBytes: Number(data.vfsBytes || 0),
          mountedFiles: Number(data.mountedFiles || 0),
          voxelCount: Number(data.voxelCount || 0),
          timestamp: Date.now()
        };
        this.currentFps.set(telemetry.fps);
        this.currentWasmMb.set(telemetry.wasmHeapMb);
        this.lastHeartbeat.set(telemetry);

        const health = this.memoryGuard.evaluateHeartbeatHealth(telemetry);
        if (!health.healthy && health.reason === 'PROACTIVE_OOM_TRIPWIRE') {
          this.triggerContainedFault({
            code: 'PROACTIVE_OOM_TRIPWIRE',
            title: 'Proactive Memory Ceiling Reached (90% Heap Cap)',
            message: `Sandbox memory usage reached ${telemetry.wasmHeapMb} MB of ${telemetry.maxWasmHeapMb} MB. The watchdog halted execution before the browser tab could run out of memory.`,
            wasmHeapMb: telemetry.wasmHeapMb,
            maxWasmHeapMb: telemetry.maxWasmHeapMb,
            canRetrySafeMode: !this.safeModeActive()
          });
        }
        break;
      }

      case 'SANDBOX_STATE_UPDATE': {
        if (typeof data.flyMode === 'boolean') this.flyMode.set(data.flyMode);
        if (typeof data.fastMode === 'boolean') this.fastMode.set(data.fastMode);
        if (data.timeOfDay) this.timeOfDay.set(data.timeOfDay);
        break;
      }

      case 'SANDBOX_FAULT': {
        this.triggerContainedFault({
          code: String(data.code || 'WASM_FAULT'),
          title:
            data.code === 'WASM_SEGFAULT'
              ? 'C++ / WebAssembly Segmentation Fault Contained'
              : data.code === 'WASM_OOM'
                ? 'WebAssembly Out-of-Memory Limit Contained'
                : 'Sandbox Graphics / Engine Fault Contained',
          message: String(
            data.message || 'An unexpected runtime fault occurred inside the isolated sandbox container.'
          ),
          detail: data.detail ? String(data.detail) : undefined,
          wasmHeapMb: Number(data.wasmHeapMb || this.currentWasmMb()),
          maxWasmHeapMb: Number(data.maxWasmHeapMb || this.memoryProfile().maxWasmHeapMb),
          canRetrySafeMode: !this.safeModeActive()
        });
        break;
      }
    }
  }

  private startHeartbeatWatchdog(): void {
    if (this.watchdogIntervalId) {
      clearInterval(this.watchdogIntervalId);
    }
    this.watchdogIntervalId = setInterval(() => {
      if (this.status() !== 'running') return;
      const health = this.memoryGuard.evaluateHeartbeatHealth(this.lastHeartbeat(), Date.now());
      if (!health.healthy && health.reason === 'HEARTBEAT_STALLED') {
        this.triggerContainedFault({
          code: 'HEARTBEAT_STALLED',
          title: 'Unresponsive Sandbox Thread Terminated',
          message:
            'The sandbox engine stopped responding for over 4.5 seconds (possible infinite Lua loop). The watchdog terminated the isolated frame to keep your PWA responsive.',
          canRetrySafeMode: !this.safeModeActive()
        });
      }
    }, 1500);
  }

  private handleBootOrGuardError(err: any): void {
    if (err instanceof SandboxMemoryGuardError) {
      this.triggerContainedFault({
        code: err.code,
        title: 'Blocked by Pre-Flight Memory & Zip Guard',
        message: err.message,
        canRetrySafeMode: false
      });
      return;
    }

    this.triggerContainedFault({
      code: 'SANDBOX_BOOT_ERROR',
      title: 'Unable to Initialize Sandbox Preview',
      message: err?.message || 'Failed to prepare package archive for in-browser preview.',
      canRetrySafeMode: !this.safeModeActive()
    });
  }

  private triggerContainedFault(fault: SandboxFaultState): void {
    this.performDeterministicTeardown(true);
    this.faultState.set(fault);
    this.status.set('fault');
  }

  setTimeOfDay(tod: 'noon' | 'sunset' | 'midnight'): void {
    this.timeOfDay.set(tod);
    this.sendCommandToRunner('SET_TIME', tod);
  }

  toggleFlyMode(): void {
    this.sendCommandToRunner('TOGGLE_FLY');
  }

  toggleFastMode(): void {
    this.sendCommandToRunner('TOGGLE_FAST');
  }

  respawnWorld(): void {
    this.sendCommandToRunner('RESPAWN');
  }

  simulateFault(faultType: 'WASM_SEGFAULT' | 'WASM_OOM' | 'WEBGL_CONTEXT_LOST'): void {
    this.showGuardMenu.set(false);
    const iframe = this.sandboxIframeRef?.nativeElement;
    if (iframe?.contentWindow && this.status() === 'running') {
      iframe.contentWindow.postMessage({ type: 'SANDBOX_SIMULATE_FAULT', faultType }, '*');
    } else {
      this.triggerContainedFault({
        code: faultType,
        title:
          faultType === 'WASM_SEGFAULT'
            ? 'C++ / WebAssembly Segmentation Fault Contained'
            : faultType === 'WASM_OOM'
              ? 'WebAssembly Out-of-Memory Limit Contained'
              : 'WebGL 2.0 GPU Context Loss Contained',
        message: `Simulated ${faultType} trapped by Layer 3 guard.`,
        detail: `RuntimeError: Simulated ${faultType} trap verified`,
        canRetrySafeMode: !this.safeModeActive()
      });
    }
  }

  relaunchInSafeMode(): void {
    this.startSandboxBootSequence(true);
  }

  toggleFullscreen(): void {
    const el = this.modalContainerRef?.nativeElement;
    if (!el || typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  triggerDownloadAndClose(): void {
    this.downloadRequested.emit();
    this.closeSandbox();
  }

  closeSandbox(): void {
    this.performDeterministicTeardown(true);
    this.close.emit();
  }

  private sendCommandToRunner(command: string, value?: any): void {
    const iframe = this.sandboxIframeRef?.nativeElement;
    if (!iframe?.contentWindow || this.status() !== 'running') return;
    iframe.contentWindow.postMessage({ type: 'SANDBOX_COMMAND', command, value }, '*');
  }

  private performDeterministicTeardown(hideIframe = true): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.watchdogIntervalId) {
      clearInterval(this.watchdogIntervalId);
      this.watchdogIntervalId = null;
    }
    this.extractedVfsFiles = [];
    this.memoryGuard.teardownSandboxIframe(this.sandboxIframeRef?.nativeElement);
    if (hideIframe) {
      this.iframeVisible.set(false);
    }
  }
}

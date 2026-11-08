import { Injectable, signal } from '@angular/core';
import { parseDownloadSizeBytes } from '../config/package-utils.config';
import { isUntrustedTunnelOrPrivateHost } from '../config/git-providers.config';

export type SandboxMemoryTier = 'constrained' | 'standard' | 'desktop';

export interface SandboxMemoryProfile {
  tier: SandboxMemoryTier;
  label: string;
  deviceMemoryGb: number;
  maxWasmHeapMb: number;
  maxArchiveBytes: number;
  maxUncompressedBytes: number;
  maxFileCount: number;
  viewingRange: number;
  safeModeViewingRange: number;
}

export interface SandboxQuotaClientState {
  exhausted: boolean;
  billingCycle: string;
  resetsAt: string;
  usagePercent: number;
}

export type SandboxGuardErrorCode =
  | 'SANDBOX_ARCHIVE_TOO_LARGE'
  | 'SANDBOX_QUOTA_EXHAUSTED'
  | 'SANDBOX_CONTAINER_UNAVAILABLE';

export class SandboxMemoryGuardError extends Error {
  constructor(
    public readonly code: SandboxGuardErrorCode,
    message: string,
    public readonly measuredBytes = 0,
    public readonly limitBytes = 0
  ) {
    super(message);
    this.name = 'SandboxMemoryGuardError';
  }
}

export interface HeartbeatTelemetry {
  fps: number;
  wasmHeapMb: number;
  maxWasmHeapMb: number;
  jsHeapMb: number;
  vfsBytes: number;
  mountedFiles: number;
  voxelCount: number;
  timestamp: number;
}

export interface HeartbeatHealthStatus {
  healthy: boolean;
  reason?: 'PROACTIVE_OOM_TRIPWIRE' | 'HEARTBEAT_STALLED';
  usagePercent: number;
  warningLevel: 'normal' | 'elevated' | 'critical';
}

@Injectable({
  providedIn: 'root'
})
export class SandboxMemoryGuardService {
  public static readonly MAX_ARCHIVE_BYTES = 512 * 1024 * 1024; // 512 MB container disk archive ceiling
  private static readonly HEARTBEAT_TIMEOUT_MS = 10000;
  private static readonly OOM_TRIPWIRE_RATIO = 0.9;
  private static readonly ELEVATED_MEMORY_RATIO = 0.75;
  private static readonly MANIFEST_CACHE_TTL_MS = 120_000;
  private static readonly MAX_MANIFEST_CACHE_ENTRIES = 60;

  readonly quotaState = signal<SandboxQuotaClientState | null>(null);
  private readonly manifestCache = new Map<string, { exp: number; data: any }>();

  private buildManifestCacheKey(author: string, name: string, release = 'latest'): string {
    return `${String(author || '').trim().toLowerCase()}/${String(name || '').trim().toLowerCase()}@${String(release || 'latest').trim().toLowerCase()}`;
  }

  getCachedManifest<T = any>(author: string, name: string, release = 'latest', nowMs = Date.now()): T | null {
    const key = this.buildManifestCacheKey(author, name, release);
    const entry = this.manifestCache.get(key);
    if (!entry) return null;
    if (nowMs > entry.exp) {
      this.manifestCache.delete(key);
      return null;
    }
    const currentQuota = this.quotaState();
    if (currentQuota && entry.data && typeof entry.data === 'object') {
      return {
        ...entry.data,
        quota: currentQuota,
        quotaExhausted: this.isQuotaExhausted(nowMs)
      } as T;
    }
    return entry.data as T;
  }

  setCachedManifest(
    author: string,
    name: string,
    release = 'latest',
    data: any,
    ttlMs = SandboxMemoryGuardService.MANIFEST_CACHE_TTL_MS,
    nowMs = Date.now()
  ): void {
    if (!data || typeof data !== 'object') return;
    if (this.manifestCache.size >= SandboxMemoryGuardService.MAX_MANIFEST_CACHE_ENTRIES) {
      for (const [k, v] of this.manifestCache.entries()) {
        if (nowMs > v.exp) this.manifestCache.delete(k);
      }
      if (this.manifestCache.size >= SandboxMemoryGuardService.MAX_MANIFEST_CACHE_ENTRIES) {
        const oldestKey = this.manifestCache.keys().next().value;
        if (oldestKey) this.manifestCache.delete(oldestKey);
      }
    }
    const key = this.buildManifestCacheKey(author, name, release);
    this.manifestCache.set(key, { exp: nowMs + ttlMs, data });
  }

  clearManifestCache(): void {
    this.manifestCache.clear();
  }

  /**
   * Determines whether the "Try in Browser" PWA Sandbox feature is enabled
   * for the current host, query string, or developer localStorage toggle.
   * Production (luantihub.org) remains gated unless `?sandbox=1` or `lh_enable_sandbox=1` is active.
   */
  isSandboxFeatureEnabled(
    hostname?: string,
    search?: string,
    storageFlag?: string | null
  ): boolean {
    const win = typeof window !== 'undefined' ? window : undefined;
    const host = (hostname ?? win?.location?.hostname ?? '').toLowerCase();
    const query = search ?? win?.location?.search ?? '';
    let localToggle = storageFlag;
    if (localToggle === undefined && typeof localStorage !== 'undefined') {
      try {
        localToggle =
          localStorage.getItem('lh_enable_sandbox') ||
          localStorage.getItem('lh_enable_pwa_sandbox');
      } catch {
        localToggle = null;
      }
    }

    if (localToggle === '1' || localToggle === 'true') {
      return true;
    }

    if (query) {
      const params = new URLSearchParams(query.startsWith('?') ? query : `?${query}`);
      const sb = (params.get('sandbox') || params.get('try_sandbox') || '').toLowerCase();
      if (sb === '1' || sb === 'true') {
        return true;
      }
      if (sb === '0' || sb === 'false') {
        return false;
      }
    }

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host.endsWith('.pages.dev') ||
      host.endsWith('.local')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Updates the cached monthly Cloudflare Container quota status.
   */
  updateQuotaStatus(quota: Partial<SandboxQuotaClientState> | null | undefined): void {
    if (!quota) return;
    this.quotaState.set({
      exhausted: Boolean(quota.exhausted),
      billingCycle: String(quota.billingCycle || ''),
      resetsAt: String(quota.resetsAt || ''),
      usagePercent: Number(quota.usagePercent || 0)
    });
  }

  /**
   * Returns true if the monthly $5 Cloudflare Container quota circuit breaker (>=90%) has tripped,
   * and automatically resets to false as soon as the billing period reset timestamp (`resetsAt`) is reached.
   */
  isQuotaExhausted(nowMs = Date.now()): boolean {
    const state = this.quotaState();
    if (!state || !state.exhausted) return false;

    if (state.resetsAt) {
      const resetTime = Date.parse(state.resetsAt);
      if (Number.isFinite(resetTime) && nowMs >= resetTime) {
        this.quotaState.set({
          ...state,
          exhausted: false,
          usagePercent: 0
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Parses human-readable byte strings (e.g. "93.1 MB", "420 KB", "1.2 GB") into raw bytes.
   * Delegates to shared `parseDownloadSizeBytes` in `package-utils.config.ts`.
   */
  parseByteString(raw?: string | number | null): number {
    return parseDownloadSizeBytes(raw);
  }

  /**
   * Returns true if the package is a LuantiHub Verified Git package claimed by a verified OAuth author account in D1
   * and its Git repository is not flagged as broken (`broken_404`).
   */
  isVerifiedGitPackage(
    pkg:
      | {
          author_id?: string | null;
          source?: string;
          sources?: string[];
          provider?: string;
          repo_url?: string;
          git_repo_status?: 'verified' | 'broken_404' | 'unverified';
        }
      | null
      | undefined
  ): boolean {
    if (!pkg) return false;
    if (pkg.git_repo_status === 'broken_404') return false;
    if (pkg.repo_url && isUntrustedTunnelOrPrivateHost(pkg.repo_url)) return false;
    const rawAuthorId = typeof pkg.author_id === 'string' ? pkg.author_id.trim() : '';
    const hasVerifiedAuthor = Boolean(rawAuthorId && !rawAuthorId.startsWith('ext_'));
    const isGitPkg =
      pkg.source === 'git' ||
      (Array.isArray(pkg.sources) && pkg.sources.includes('git')) ||
      Boolean(pkg.provider && pkg.provider !== 'contentdb');
    return hasVerifiedAuthor && isGitPkg;
  }

  /**
   * Pre-Flight Eligibility Check: determines whether the "Try in Browser" button should be shown
   * for a given package based on verified Git package ownership, moderation status, and monthly $5 quota circuit breaker.
   * Since packages are downloaded and unpacked inside the isolated Luanti container (4 GB disk),
   * large packages (e.g. 93 MB texture packs or games) are supported without browser RAM limits.
   */
  isPackageEligibleForSandbox(
    pkg:
      | {
          status?: string;
          download_size?: number;
          file_size?: string;
          author_id?: string | null;
          source?: string;
          sources?: string[];
          provider?: string;
          git_repo_status?: 'verified' | 'broken_404' | 'unverified';
        }
      | null
      | undefined,
    _releases?: Array<{ size?: number | string }> | null,
    nowMs = Date.now()
  ): boolean {
    if (!pkg) return false;
    if (pkg.status === 'delisted' || pkg.status === 'flagged') return false;
    if (!this.isVerifiedGitPackage(pkg)) return false;
    if (this.isQuotaExhausted(nowMs)) return false;

    return true;
  }

  /**
   * Detects device RAM & mobile constraints to assign sandbox limits.
   */
  detectMemoryProfile(
    overrideDeviceMemoryGb?: number,
    overrideUserAgent?: string,
    safeMode = false
  ): SandboxMemoryProfile {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
    const rawMem = Number(overrideDeviceMemoryGb ?? nav.deviceMemory ?? 8);
    const deviceMemoryGb = Number.isFinite(rawMem) && rawMem > 0 ? rawMem : 8;
    const ua = String(overrideUserAgent ?? nav.userAgent ?? '');
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    if (safeMode || deviceMemoryGb <= 2 || isMobile) {
      return {
        tier: 'constrained',
        label: safeMode ? 'Safe Mode (Low RAM)' : 'Constrained RAM Profile',
        deviceMemoryGb,
        maxWasmHeapMb: 384,
        maxArchiveBytes: 512 * 1024 * 1024,
        maxUncompressedBytes: 1024 * 1024 * 1024,
        maxFileCount: 20000,
        viewingRange: safeMode ? 25 : 30,
        safeModeViewingRange: 20
      };
    }

    if (deviceMemoryGb <= 4) {
      return {
        tier: 'standard',
        label: 'Standard PWA Profile (512 MB Cap)',
        deviceMemoryGb,
        maxWasmHeapMb: 512,
        maxArchiveBytes: 512 * 1024 * 1024,
        maxUncompressedBytes: 1024 * 1024 * 1024,
        maxFileCount: 20000,
        viewingRange: 45,
        safeModeViewingRange: 25
      };
    }

    return {
      tier: 'desktop',
      label: 'Desktop Container Profile (1 GiB Cap)',
      deviceMemoryGb,
      maxWasmHeapMb: 1024,
      maxArchiveBytes: 512 * 1024 * 1024,
      maxUncompressedBytes: 1024 * 1024 * 1024,
      maxFileCount: 20000,
      viewingRange: 65,
      safeModeViewingRange: 30
    };
  }

  /**
   * Validates that estimated or downloaded archive bytes fit within the pre-flight budget.
   */
  validatePreFlightArchiveSize(bytes: number, profile: SandboxMemoryProfile): void {
    if (bytes > profile.maxArchiveBytes) {
      const measuredMb = (bytes / (1024 * 1024)).toFixed(1);
      const limitMb = (profile.maxArchiveBytes / (1024 * 1024)).toFixed(0);
      throw new SandboxMemoryGuardError(
        'SANDBOX_ARCHIVE_TOO_LARGE',
        `Package archive (${measuredMb} MB) exceeds the ${limitMb} MB sandbox limit.`,
        bytes,
        profile.maxArchiveBytes
      );
    }
  }

  /**
   * Evaluates live heartbeat & memory telemetry from the sandbox session.
   */
  evaluateHeartbeatHealth(
    lastHeartbeat: HeartbeatTelemetry | null,
    now = Date.now()
  ): HeartbeatHealthStatus {
    if (!lastHeartbeat) {
      return { healthy: true, usagePercent: 0, warningLevel: 'normal' };
    }

    if (now - lastHeartbeat.timestamp > SandboxMemoryGuardService.HEARTBEAT_TIMEOUT_MS) {
      return {
        healthy: false,
        reason: 'HEARTBEAT_STALLED',
        usagePercent: 100,
        warningLevel: 'critical'
      };
    }

    const maxMb = Math.max(1, lastHeartbeat.maxWasmHeapMb || 1024);
    const usedMb = Math.max(0, lastHeartbeat.wasmHeapMb || 0);
    const ratio = usedMb / maxMb;
    const usagePercent = Math.min(100, Math.round(ratio * 100));

    if (ratio >= SandboxMemoryGuardService.OOM_TRIPWIRE_RATIO) {
      return {
        healthy: false,
        reason: 'PROACTIVE_OOM_TRIPWIRE',
        usagePercent,
        warningLevel: 'critical'
      };
    }

    return {
      healthy: true,
      usagePercent,
      warningLevel: ratio >= SandboxMemoryGuardService.ELEVATED_MEMORY_RATIO ? 'elevated' : 'normal'
    };
  }

  /**
   * Deterministic Zero-Leak Teardown of the Sandbox Iframe.
   */
  teardownSandboxIframe(iframe: HTMLIFrameElement | null | undefined): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore
      }
    }

    if (typeof navigator !== 'undefined' && (navigator as any).keyboard?.unlock) {
      try {
        (navigator as any).keyboard.unlock();
      } catch {
        // Ignore
      }
    }

    if (!iframe) return;

    try {
      iframe.contentWindow?.postMessage({ type: 'SANDBOX_DISPOSE' }, '*');
    } catch {
      // Ignore
    }

    try {
      iframe.removeAttribute?.('srcdoc');
      iframe.src = 'about:blank';
    } catch {
      // Ignore
    }
  }
}

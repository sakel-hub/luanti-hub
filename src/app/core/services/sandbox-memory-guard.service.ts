import { Injectable, signal } from '@angular/core';

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

  readonly quotaState = signal<SandboxQuotaClientState | null>(null);

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
   */
  parseByteString(raw?: string | number | null): number {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    }
    if (typeof raw !== 'string' || !raw.trim()) return 0;
    const match = raw.trim().match(/^([\d.]+)\s*(B|KB|KIB|MB|MIB|GB|GIB)?$/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    if (!Number.isFinite(val) || val <= 0) return 0;
    const unit = (match[2] || 'B').toUpperCase();
    if (unit === 'GB' || unit === 'GIB') return Math.round(val * 1024 * 1024 * 1024);
    if (unit === 'MB' || unit === 'MIB') return Math.round(val * 1024 * 1024);
    if (unit === 'KB' || unit === 'KIB') return Math.round(val * 1024);
    return Math.round(val);
  }

  /**
   * Pre-Flight Eligibility Check: determines whether the "Try in Browser" button should be shown
   * for a given package based on feature flag, moderation status, and monthly $5 quota circuit breaker.
   * Since packages are downloaded and unpacked inside the isolated Luanti container (4 GB disk),
   * large packages (e.g. 93 MB texture packs or games) are supported without browser RAM limits.
   */
  isPackageEligibleForSandbox(
    pkg: { status?: string; download_size?: number; file_size?: string } | null | undefined,
    _releases?: Array<{ size?: number | string }> | null,
    nowMs = Date.now()
  ): boolean {
    if (!pkg) return false;
    if (pkg.status === 'delisted' || pkg.status === 'flagged') return false;
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

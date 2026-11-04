import { Injectable } from '@angular/core';

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

export interface ExtractedVfsFile {
  path: string;
  bytes: Uint8Array;
}

export interface ZipExtractionResult {
  files: ExtractedVfsFile[];
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
}

export type SandboxGuardErrorCode =
  | 'SANDBOX_ARCHIVE_TOO_LARGE'
  | 'SANDBOX_UNCOMPRESSED_SIZE_EXCEEDED'
  | 'SANDBOX_FILE_COUNT_EXCEEDED'
  | 'SANDBOX_ZIP_BOMB_DETECTED'
  | 'SANDBOX_INVALID_ZIP'
  | 'WEBGL2_UNSUPPORTED';

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
  private static readonly HEARTBEAT_TIMEOUT_MS = 4500;
  private static readonly OOM_TRIPWIRE_RATIO = 0.9;
  private static readonly ELEVATED_MEMORY_RATIO = 0.75;

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
        localToggle = localStorage.getItem('lh_enable_sandbox');
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
   * Layer 1: Detects device RAM & mobile constraints to assign strict memory ceilings.
   */
  detectMemoryProfile(
    overrideDeviceMemoryGb?: number,
    overrideUserAgent?: string,
    safeMode = false
  ): SandboxMemoryProfile {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : {};
    const rawMem = Number(overrideDeviceMemoryGb ?? nav.deviceMemory ?? 4);
    const deviceMemoryGb = Number.isFinite(rawMem) && rawMem > 0 ? rawMem : 4;
    const ua = String(overrideUserAgent ?? nav.userAgent ?? '');
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    if (safeMode || deviceMemoryGb <= 2 || isMobile) {
      return {
        tier: 'constrained',
        label: safeMode ? 'Safe Mode (Low RAM)' : 'Constrained RAM Profile',
        deviceMemoryGb,
        maxWasmHeapMb: 384,
        maxArchiveBytes: 12 * 1024 * 1024, // 12 MB
        maxUncompressedBytes: 32 * 1024 * 1024, // 32 MB
        maxFileCount: 2000,
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
        maxArchiveBytes: 20 * 1024 * 1024, // 20 MB
        maxUncompressedBytes: 48 * 1024 * 1024, // 48 MB
        maxFileCount: 3000,
        viewingRange: 45,
        safeModeViewingRange: 25
      };
    }

    return {
      tier: 'desktop',
      label: 'Desktop High-Safety Profile (768 MB Cap)',
      deviceMemoryGb,
      maxWasmHeapMb: 768,
      maxArchiveBytes: 25 * 1024 * 1024, // 25 MB
      maxUncompressedBytes: 64 * 1024 * 1024, // 64 MB
      maxFileCount: 4000,
      viewingRange: 65,
      safeModeViewingRange: 30
    };
  }

  /**
   * Validates that estimated or downloaded archive bytes fit within the Layer 1 profile budget.
   */
  validatePreFlightArchiveSize(bytes: number, profile: SandboxMemoryProfile): void {
    if (bytes > profile.maxArchiveBytes) {
      const measuredMb = (bytes / (1024 * 1024)).toFixed(1);
      const limitMb = (profile.maxArchiveBytes / (1024 * 1024)).toFixed(0);
      throw new SandboxMemoryGuardError(
        'SANDBOX_ARCHIVE_TOO_LARGE',
        `Package archive (${measuredMb} MB) exceeds the ${limitMb} MB in-browser sandbox memory budget for your device profile.`,
        bytes,
        profile.maxArchiveBytes
      );
    }
  }

  /**
   * Layer 1 Dual-Stage Zip-Bomb & Memory-Guarded ZIP Extractor.
   * 1. Inspects Central Directory headers BEFORE decompressing any bytes to verify file counts & declared sizes.
   * 2. Streams decompression with a strict byte counter so forged headers / zip bombs abort immediately.
   */
  async extractZipWithMemoryGuard(
    zipBytes: Uint8Array,
    mountPrefix: string,
    profile: SandboxMemoryProfile,
    runningUncompressedTotal = 0,
    runningFileCount = 0
  ): Promise<ZipExtractionResult> {
    this.validatePreFlightArchiveSize(zipBytes.byteLength, profile);

    if (!zipBytes || zipBytes.byteLength < 22 || zipBytes[0] !== 0x50 || zipBytes[1] !== 0x4b) {
      throw new SandboxMemoryGuardError(
        'SANDBOX_INVALID_ZIP',
        'Invalid or corrupted package archive (missing PK zip signature).'
      );
    }

    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

    // Locate End of Central Directory (0x06054b50)
    let eocdPos = -1;
    const minEocdPos = Math.max(0, zipBytes.byteLength - 65557);
    for (let pos = zipBytes.byteLength - 22; pos >= minEocdPos; pos--) {
      if (view.getUint32(pos, true) === 0x06054b50) {
        eocdPos = pos;
        break;
      }
    }

    if (eocdPos < 0) {
      throw new SandboxMemoryGuardError(
        'SANDBOX_INVALID_ZIP',
        'Unable to locate ZIP Central Directory in package archive.'
      );
    }

    const totalEntries = view.getUint16(eocdPos + 10, true);
    const cdSize = view.getUint32(eocdPos + 12, true);
    const cdOffset = view.getUint32(eocdPos + 16, true);

    if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > eocdPos) {
      throw new SandboxMemoryGuardError(
        'SANDBOX_INVALID_ZIP',
        'ZIP64 or malformed Central Directory offsets are not permitted in the sandbox.'
      );
    }

    if (runningFileCount + totalEntries > profile.maxFileCount) {
      throw new SandboxMemoryGuardError(
        'SANDBOX_FILE_COUNT_EXCEEDED',
        `Archive contains ${runningFileCount + totalEntries} files, exceeding the ${profile.maxFileCount}-file sandbox safety limit.`,
        runningFileCount + totalEntries,
        profile.maxFileCount
      );
    }

    interface CdEntry {
      normalizedPath: string;
      compressionMethod: number;
      compressedSize: number;
      uncompressedSize: number;
      compressedData: Uint8Array;
    }

    const parsedEntries: CdEntry[] = [];
    const decoder = new TextDecoder();
    let ptr = cdOffset;
    let declaredUncompressedSum = runningUncompressedTotal;

    for (let i = 0; i < totalEntries; i++) {
      if (ptr + 46 > eocdPos || view.getUint32(ptr, true) !== 0x02014b50) {
        throw new SandboxMemoryGuardError(
          'SANDBOX_INVALID_ZIP',
          'Corrupted Central Directory entry header in package archive.'
        );
      }

      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const uncompressedSize = view.getUint32(ptr + 24, true);
      const fileNameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      const rawName = decoder.decode(zipBytes.subarray(ptr + 46, ptr + 46 + fileNameLen));
      ptr += 46 + fileNameLen + extraLen + commentLen;

      const cleanRelPath = rawName
        .replace(/\\/g, '/')
        .split('/')
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .join('/');

      if (!cleanRelPath || rawName.endsWith('/')) {
        continue;
      }

      declaredUncompressedSum += uncompressedSize;
      if (declaredUncompressedSum > profile.maxUncompressedBytes) {
        const mb = (declaredUncompressedSum / (1024 * 1024)).toFixed(1);
        const maxMb = (profile.maxUncompressedBytes / (1024 * 1024)).toFixed(0);
        throw new SandboxMemoryGuardError(
          'SANDBOX_UNCOMPRESSED_SIZE_EXCEEDED',
          `Uncompressed package size (${mb} MB) exceeds the ${maxMb} MB VFS memory safety ceiling.`,
          declaredUncompressedSum,
          profile.maxUncompressedBytes
        );
      }

      if (localHeaderOffset + 30 > cdOffset || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new SandboxMemoryGuardError('SANDBOX_INVALID_ZIP', 'Invalid local file header in ZIP.');
      }

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > cdOffset) {
        throw new SandboxMemoryGuardError('SANDBOX_INVALID_ZIP', 'ZIP entry data extends past Central Directory.');
      }

      parsedEntries.push({
        normalizedPath: cleanRelPath,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        compressedData: zipBytes.subarray(dataStart, dataEnd)
      });
    }

    // Strip single common top-level directory if present so files mount cleanly under mountPrefix
    const topFolders = new Set<string>();
    let hasRootFiles = false;
    for (const entry of parsedEntries) {
      const slashIdx = entry.normalizedPath.indexOf('/');
      if (slashIdx > 0) {
        topFolders.add(entry.normalizedPath.slice(0, slashIdx + 1));
      } else {
        hasRootFiles = true;
      }
    }
    const stripPrefix = !hasRootFiles && topFolders.size === 1 ? Array.from(topFolders)[0] : '';
    const cleanMount = '/' + mountPrefix.replace(/^\/+|\/+$/g, '');

    const files: ExtractedVfsFile[] = [];
    let actualUncompressedTotal = runningUncompressedTotal;

    for (const entry of parsedEntries) {
      const subPath = stripPrefix && entry.normalizedPath.startsWith(stripPrefix)
        ? entry.normalizedPath.slice(stripPrefix.length)
        : entry.normalizedPath;
      if (!subPath) continue;

      const remainingBudget = profile.maxUncompressedBytes - actualUncompressedTotal;
      if (remainingBudget <= 0) {
        throw new SandboxMemoryGuardError(
          'SANDBOX_ZIP_BOMB_DETECTED',
          'Decompression aborted: VFS memory safety ceiling reached.',
          actualUncompressedTotal,
          profile.maxUncompressedBytes
        );
      }

      let fileBytes: Uint8Array;
      if (entry.compressionMethod === 0) {
        if (entry.compressedData.byteLength > remainingBudget) {
          throw new SandboxMemoryGuardError(
            'SANDBOX_ZIP_BOMB_DETECTED',
            'Stored ZIP entry exceeded remaining VFS memory budget.',
            actualUncompressedTotal + entry.compressedData.byteLength,
            profile.maxUncompressedBytes
          );
        }
        fileBytes = new Uint8Array(entry.compressedData);
      } else if (entry.compressionMethod === 8) {
        fileBytes = await this.inflateRawWithByteCap(entry.compressedData, remainingBudget, profile.maxUncompressedBytes);
      } else {
        continue;
      }

      actualUncompressedTotal += fileBytes.byteLength;
      files.push({
        path: `${cleanMount}/${subPath}`,
        bytes: fileBytes
      });
    }

    return {
      files,
      totalCompressedBytes: zipBytes.byteLength,
      totalUncompressedBytes: actualUncompressedTotal - runningUncompressedTotal
    };
  }

  /**
   * Streams raw DEFLATE decompression with a strict byte ceiling to defeat zip bombs
   * that forge smaller `uncompressedSize` values in Central Directory headers.
   */
  private async inflateRawWithByteCap(
    compressed: Uint8Array,
    maxRemainingBytes: number,
    profileCeilingBytes: number
  ): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
      throw new SandboxMemoryGuardError(
        'SANDBOX_INVALID_ZIP',
        'Browser DecompressionStream API is required for in-PWA archive unpacking.'
      );
    }

    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const writePromise = writer
      .write(new Uint8Array(compressed))
      .then(() => writer.close())
      .catch(() => {});

    const chunks: Uint8Array[] = [];
    let totalRead = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalRead += value.byteLength;
          if (totalRead > maxRemainingBytes) {
            await reader.cancel('Zip bomb ceiling exceeded').catch(() => {});
            throw new SandboxMemoryGuardError(
              'SANDBOX_ZIP_BOMB_DETECTED',
              'Decompression halted: actual decompressed stream exceeded VFS memory ceiling (potential zip bomb).',
              totalRead,
              profileCeilingBytes
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      await writePromise;
    }

    const out = new Uint8Array(totalRead);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  /**
   * Layer 3: Evaluates live heartbeat & WASM heap telemetry from the sandbox runner.
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

    const maxMb = Math.max(1, lastHeartbeat.maxWasmHeapMb || 512);
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
   * Layer 4: Deterministic Zero-Leak Teardown of the Sandbox Iframe.
   * Releases Pointer/Keyboard locks, sends SANDBOX_DISPOSE, navigates to about:blank,
   * and detaches the iframe element so browser GC immediately reclaims WASM & WebGL memory.
   */
  teardownSandboxIframe(iframe: HTMLIFrameElement | null | undefined): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore if already unlocked
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
      // Ignore cross-frame error if already detached
    }

    try {
      iframe.src = 'about:blank';
    } catch {
      // Ignore
    }
  }
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SandboxMemoryGuardError,
  SandboxMemoryGuardService
} from './sandbox-memory-guard.service';

/**
 * Helper to construct a valid stored (method=0) PKZIP archive in-memory for testing
 * Central Directory pre-flight checks, path traversal sanitization, and zip-bomb limits.
 */
function buildTestStoredZip(
  entries: Array<{ name: string; content: Uint8Array; declaredUncompressedSize?: number }>
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.content;
    const declaredSize = entry.declaredUncompressedSize ?? data.byteLength;

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // method 0 = stored
    lv.setUint32(18, data.byteLength, true);
    lv.setUint32(22, declaredSize, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    localHeader.set(nameBytes, 30);

    const cdHeader = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true); // method 0 = stored
    cv.setUint32(20, data.byteLength, true);
    cv.setUint32(24, declaredSize, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint32(42, offset, true);
    cdHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    cdParts.push(cdHeader);
    offset += localHeader.byteLength + data.byteLength;
  }

  const cdSize = cdParts.reduce((s, p) => s + p.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const totalLen = offset + cdSize + eocd.byteLength;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  for (const p of cdParts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  out.set(eocd, pos);
  return out;
}

describe('SandboxMemoryGuardService (4-Layer RAM, OOM & Segfault Protection)', () => {
  let service: SandboxMemoryGuardService;

  beforeEach(() => {
    service = new SandboxMemoryGuardService();
  });

  describe('Feature Flag & Hostname Gate', () => {
    it('enables sandbox on localhost and Cloudflare Pages preview domains (*.pages.dev)', () => {
      expect(service.isSandboxFeatureEnabled('localhost', '', null)).toBe(true);
      expect(service.isSandboxFeatureEnabled('127.0.0.1', '', null)).toBe(true);
      expect(service.isSandboxFeatureEnabled('feat-pwa-try-sandbox.luanti-hub.pages.dev', '', null)).toBe(true);
    });

    it('keeps production luantihub.org disabled by default unless ?sandbox=1 or localStorage flag is set', () => {
      expect(service.isSandboxFeatureEnabled('luantihub.org', '', null)).toBe(false);
      expect(service.isSandboxFeatureEnabled('luantihub.org', '?sandbox=1', null)).toBe(true);
      expect(service.isSandboxFeatureEnabled('luantihub.org', '', '1')).toBe(true);
      expect(service.isSandboxFeatureEnabled('localhost', '?sandbox=0', null)).toBe(false);
    });
  });

  describe('Layer 1: Device Memory Profile Classification', () => {
    it('assigns Constrained profile for <=2 GB RAM or mobile user agents', () => {
      const lowRam = service.detectMemoryProfile(2, 'Mozilla/5.0 X11 Linux x86_64', false);
      expect(lowRam.tier).toBe('constrained');
      expect(lowRam.maxWasmHeapMb).toBe(384);
      expect(lowRam.viewingRange).toBe(30);

      const mobile = service.detectMemoryProfile(8, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', false);
      expect(mobile.tier).toBe('constrained');
      expect(mobile.maxWasmHeapMb).toBe(384);
    });

    it('assigns Standard profile for 4 GB RAM and Desktop profile for >=8 GB RAM', () => {
      const std = service.detectMemoryProfile(4, 'Mozilla/5.0 Macintosh', false);
      expect(std.tier).toBe('standard');
      expect(std.maxWasmHeapMb).toBe(512);

      const desktop = service.detectMemoryProfile(8, 'Mozilla/5.0 Macintosh', false);
      expect(desktop.tier).toBe('desktop');
      expect(desktop.maxWasmHeapMb).toBe(768);
    });

    it('forces Safe Mode profile with reduced viewing range when safeMode=true', () => {
      const safe = service.detectMemoryProfile(16, 'Mozilla/5.0 Macintosh', true);
      expect(safe.tier).toBe('constrained');
      expect(safe.viewingRange).toBe(25);
    });
  });

  describe('Layer 1: Pre-Flight Archive & Dual-Stage Zip-Bomb Guard', () => {
    it('extracts valid package ZIP entries, strips single root folder, and mounts into VFS path', async () => {
      const encoder = new TextEncoder();
      const zip = buildTestStoredZip([
        { name: 'mesecons-main/mod.conf', content: encoder.encode('name = mesecons\n') },
        { name: 'mesecons-main/init.lua', content: encoder.encode('minetest.register_node("mesecons:wire", {})\n') }
      ]);

      const profile = service.detectMemoryProfile(8, 'Mozilla/5.0 Macintosh');
      const res = await service.extractZipWithMemoryGuard(zip, '/mods/mesecons', profile);

      expect(res.files.length).toBe(2);
      expect(res.files[0].path).toBe('/mods/mesecons/mod.conf');
      expect(res.files[1].path).toBe('/mods/mesecons/init.lua');
      expect(res.totalUncompressedBytes).toBeGreaterThan(20);
    });

    it('blocks archives exceeding maxUncompressedBytes in Central Directory before decompressing', async () => {
      const zip = buildTestStoredZip([
        {
          name: 'giant_mod/huge.bin',
          content: new Uint8Array([1, 2, 3, 4]),
          declaredUncompressedSize: 90 * 1024 * 1024 // 90 MB declared
        }
      ]);

      const profile = service.detectMemoryProfile(4, 'Mozilla/5.0 Macintosh'); // 48 MB limit
      await expect(
        service.extractZipWithMemoryGuard(zip, '/mods/giant_mod', profile)
      ).rejects.toThrowError(SandboxMemoryGuardError);
    });

    it('blocks archives exceeding maxFileCount limit', async () => {
      const profile = {
        ...service.detectMemoryProfile(4, 'Mozilla/5.0 Macintosh'),
        maxFileCount: 2
      };
      const zip = buildTestStoredZip([
        { name: 'm/a.lua', content: new Uint8Array([1]) },
        { name: 'm/b.lua', content: new Uint8Array([2]) },
        { name: 'm/c.lua', content: new Uint8Array([3]) }
      ]);

      await expect(
        service.extractZipWithMemoryGuard(zip, '/mods/m', profile)
      ).rejects.toMatchObject({ code: 'SANDBOX_FILE_COUNT_EXCEEDED' });
    });
  });

  describe('Layer 3: Heartbeat & Proactive OOM Watchdog', () => {
    it('triggers PROACTIVE_OOM_TRIPWIRE when WASM linear memory reaches >=90% of cap', () => {
      const now = Date.now();
      const status = service.evaluateHeartbeatHealth(
        {
          fps: 55,
          wasmHeapMb: 470,
          maxWasmHeapMb: 512,
          jsHeapMb: 480,
          vfsBytes: 1024,
          mountedFiles: 12,
          voxelCount: 100,
          timestamp: now
        },
        now
      );

      expect(status.healthy).toBe(false);
      expect(status.reason).toBe('PROACTIVE_OOM_TRIPWIRE');
      expect(status.warningLevel).toBe('critical');
    });

    it('triggers HEARTBEAT_STALLED when sandbox frame stops responding for >4.5s', () => {
      const now = Date.now();
      const status = service.evaluateHeartbeatHealth(
        {
          fps: 60,
          wasmHeapMb: 128,
          maxWasmHeapMb: 512,
          jsHeapMb: 140,
          vfsBytes: 1024,
          mountedFiles: 12,
          voxelCount: 100,
          timestamp: now - 5000
        },
        now
      );

      expect(status.healthy).toBe(false);
      expect(status.reason).toBe('HEARTBEAT_STALLED');
    });
  });

  describe('Layer 4: Deterministic Zero-Leak Iframe Teardown', () => {
    it('dispatches SANDBOX_DISPOSE to runner frame and resets src to about:blank', () => {
      const postMessageSpy = vi.fn();
      const fakeIframe = {
        src: '/wasm/sandbox-runner.html',
        contentWindow: {
          postMessage: postMessageSpy
        }
      } as unknown as HTMLIFrameElement;

      service.teardownSandboxIframe(fakeIframe);

      expect(postMessageSpy).toHaveBeenCalledWith({ type: 'SANDBOX_DISPOSE' }, '*');
      expect(fakeIframe.src).toBe('about:blank');
    });
  });
});

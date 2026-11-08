import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SandboxMemoryGuardService } from './sandbox-memory-guard.service';

describe('SandboxMemoryGuardService (Eligibility, Monthly $5 Quota Circuit Breaker & Teardown)', () => {
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

  describe('Pre-Flight Package Eligibility (Verified Git, Status & Quota Gate)', () => {
    it('allows active LuantiHub verified Git packages including large texture packs and games', () => {
      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          author_id: 'usr_verified_1',
          source: 'git',
          download_size: 4 * 1024 * 1024 // 4 MB
        })
      ).toBe(true);

      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          author_id: 'usr_verified_1',
          sources: ['official', 'git'],
          download_size: 93.1 * 1024 * 1024
        })
      ).toBe(true);

      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          author_id: 'usr_verified_1',
          provider: 'github',
          file_size: '93.1 MB'
        })
      ).toBe(true);
    });

    it('hides Try in Browser for unverified or ContentDB-only packages', () => {
      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          source: 'official',
          sources: ['official'],
          download_size: 1024 * 1024
        })
      ).toBe(false);

      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          author_id: 'ext_12345',
          source: 'git',
          download_size: 1024 * 1024
        })
      ).toBe(false);

      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          author_id: 'usr_verified_1',
          source: 'official',
          sources: ['official'],
          provider: 'contentdb',
          download_size: 1024 * 1024
        })
      ).toBe(false);
    });

    it('hides Try in Browser for delisted or flagged packages', () => {
      expect(
        service.isPackageEligibleForSandbox({
          status: 'delisted',
          author_id: 'usr_verified_1',
          source: 'git',
          download_size: 1024
        })
      ).toBe(false);
      expect(
        service.isPackageEligibleForSandbox({
          status: 'flagged',
          author_id: 'usr_verified_1',
          source: 'git',
          download_size: 1024
        })
      ).toBe(false);
    });

    it('hides Try in Browser when git_repo_status is broken_404', () => {
      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          author_id: 'usr_verified_1',
          source: 'git',
          provider: 'github',
          git_repo_status: 'broken_404',
          download_size: 1024
        })
      ).toBe(false);
    });

    it('parses human-readable byte strings including MB and MiB via shared parseDownloadSizeBytes', () => {
      expect(service.parseByteString('2 MB')).toBe(2 * 1024 * 1024);
      expect(service.parseByteString('1.5 MiB')).toBe(Math.round(1.5 * 1024 * 1024));
      expect(service.parseByteString('512 KB')).toBe(512 * 1024);
    });

    it('caches pre-fetched sandbox manifests with TTL so modal boot avoids duplicate API calls', () => {
      const dummyManifest: any = {
        compatible: true,
        targetId: 'author/mod',
        targetType: 'mod',
        baseEnvironment: 'minetest_game',
        totalEstimatedBytes: 4096,
        bundles: []
      };
      expect(service.getCachedManifest('Author', 'Mod')).toBeNull();
      service.setCachedManifest('Author', 'Mod', 'latest', dummyManifest, 120_000, 1000);
      expect(service.getCachedManifest('author', 'mod', 'latest', 1000 + 60_000)).toEqual(dummyManifest);
      // Expired after 2 minutes (120_000ms)
      expect(service.getCachedManifest('author', 'mod', 'latest', 1000 + 125_000)).toBeNull();
    });
  });

  describe('Monthly $5 Quota Circuit Breaker & Billing Cycle Auto-Reset', () => {
    it('hides Try in Browser when monthly quota reaches >=90% and restores it automatically after resetsAt', () => {
      const cycleReset = '2026-12-02T00:00:00.000Z';
      service.updateQuotaStatus({
        exhausted: true,
        billingCycle: '2026-11-02',
        resetsAt: cycleReset,
        usagePercent: 92.5
      });

      const beforeReset = Date.parse('2026-11-28T12:00:00.000Z');
      expect(service.isQuotaExhausted(beforeReset)).toBe(true);
      expect(
        service.isPackageEligibleForSandbox(
          { status: 'active', author_id: 'usr_verified_1', source: 'git', download_size: 1024 * 1024 },
          null,
          beforeReset
        )
      ).toBe(false);

      // Once Dec 2, 00:00 UTC arrives, quota automatically resets and Try in Browser reappears
      const afterReset = Date.parse('2026-12-02T00:00:01.000Z');
      expect(service.isQuotaExhausted(afterReset)).toBe(false);
      expect(
        service.isPackageEligibleForSandbox(
          { status: 'active', author_id: 'usr_verified_1', source: 'git', download_size: 1024 * 1024 },
          null,
          afterReset
        )
      ).toBe(true);
    });
  });

  describe('Deterministic Zero-Leak Iframe Teardown', () => {
    it('dispatches SANDBOX_DISPOSE to runner frame and resets src to about:blank', () => {
      const postMessageSpy = vi.fn();
      const fakeIframe = {
        src: 'http://localhost:8089/stream',
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

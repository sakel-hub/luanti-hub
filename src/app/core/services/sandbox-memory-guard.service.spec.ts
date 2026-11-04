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

  describe('Pre-Flight Package Eligibility (Status & Quota Gate)', () => {
    it('allows active packages including large texture packs and games (e.g. Realism 512 at 93.1 MB) in the container sandbox', () => {
      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          download_size: 4 * 1024 * 1024 // 4 MB
        })
      ).toBe(true);

      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          download_size: 93.1 * 1024 * 1024
        })
      ).toBe(true);

      expect(
        service.isPackageEligibleForSandbox({
          status: 'active',
          file_size: '93.1 MB'
        })
      ).toBe(true);
    });

    it('hides Try in Browser for delisted or flagged packages', () => {
      expect(service.isPackageEligibleForSandbox({ status: 'delisted', download_size: 1024 })).toBe(false);
      expect(service.isPackageEligibleForSandbox({ status: 'flagged', download_size: 1024 })).toBe(false);
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
          { status: 'active', download_size: 1024 * 1024 },
          null,
          beforeReset
        )
      ).toBe(false);

      // Once Dec 2, 00:00 UTC arrives, quota automatically resets and Try in Browser reappears
      const afterReset = Date.parse('2026-12-02T00:00:01.000Z');
      expect(service.isQuotaExhausted(afterReset)).toBe(false);
      expect(
        service.isPackageEligibleForSandbox(
          { status: 'active', download_size: 1024 * 1024 },
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

import { readEdgeCacheJson, writeEdgeCacheJson } from '../lib/upstream';

export interface SandboxQuotaStatus {
  exhausted: boolean;
  billingCycle: string;
  periodStart: string;
  resetsAt: string;
  awakeSeconds: number;
  memoryGibSeconds: number;
  maxMemoryGibSeconds: number;
  cpuVcpuSeconds: number;
  maxCpuVcpuSeconds: number;
  diskGbSeconds: number;
  maxDiskGbSeconds: number;
  usagePercent: number;
  sessionsCount: number;
}

// Cloudflare Workers Paid ($5/month) Included Monthly Container Quotas:
// - Memory: 25 GiB-hours = 90,000 GiB-seconds
// - Active CPU: 375 vCPU-minutes = 22,500 vCPU-seconds
// - Disk: 200 GB-hours = 720,000 GB-seconds
// We enforce a strict 90% circuit breaker so overage charges are never incurred.
export const INCLUDED_MEMORY_GIB_SECONDS = 25 * 3600; // 90,000 GiB-s
export const INCLUDED_CPU_VCPU_SECONDS = 375 * 60; // 22,500 vCPU-s
export const INCLUDED_DISK_GB_SECONDS = 200 * 3600; // 720,000 GB-s

export const SAFETY_RATIO = 0.9; // Hide "Try in Browser" at 90% of monthly included quota
export const MAX_SAFE_MEMORY_GIB_SECONDS = INCLUDED_MEMORY_GIB_SECONDS * SAFETY_RATIO; // 81,000 GiB-s (22.5 GiB-h)
export const MAX_SAFE_CPU_VCPU_SECONDS = INCLUDED_CPU_VCPU_SECONDS * SAFETY_RATIO; // 20,250 vCPU-s (337.5 vCPU-m)
export const MAX_SAFE_DISK_GB_SECONDS = INCLUDED_DISK_GB_SECONDS * SAFETY_RATIO; // 648,000 GB-s (180 GB-h)

// Resource rates per awake second for Cloudflare Container `basic` (1 GiB RAM, 0.25 vCPU, 4 GB Disk)
export const CONTAINER_RATES = {
  basic: { memoryGibPerSec: 1.0, cpuVcpuPerSec: 0.25, diskGbPerSec: 4.0 },
  lite: { memoryGibPerSec: 0.25, cpuVcpuPerSec: 0.0625, diskGbPerSec: 2.0 }
};

/**
 * Computes the active billing cycle key and reset timestamp based on the billing reset day of month
 * (defaults to the 2nd of each month at 00:00:00 UTC to match Nov 2 – Dec 1 Workers Paid cycles).
 */
export function resolveBillingCycleWindow(
  now: Date = new Date(),
  resetDayOfMonth = 2
): { billingCycle: string; periodStart: string; resetsAt: string } {
  const day = Math.min(28, Math.max(1, Math.floor(resetDayOfMonth)));
  let startYear = now.getUTCFullYear();
  let startMonth = now.getUTCMonth(); // 0-indexed

  const currentMonthAnchor = Date.UTC(startYear, startMonth, day, 0, 0, 0, 0);
  if (now.getTime() < currentMonthAnchor) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  let endYear = startYear;
  let endMonth = startMonth + 1;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }

  const startDate = new Date(Date.UTC(startYear, startMonth, day, 0, 0, 0, 0));
  const resetDate = new Date(Date.UTC(endYear, endMonth, day, 0, 0, 0, 0));
  const yyyy = startDate.getUTCFullYear();
  const mm = String(startDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(startDate.getUTCDate()).padStart(2, '0');

  return {
    billingCycle: `${yyyy}-${mm}-${dd}`,
    periodStart: startDate.toISOString(),
    resetsAt: resetDate.toISOString()
  };
}

let quotaTableEnsured = false;

async function ensureQuotaTable(db: any, force = false): Promise<void> {
  if (!db || (!force && quotaTableEnsured)) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS sandbox_quota_usage (
          billing_cycle TEXT PRIMARY KEY,
          awake_seconds INTEGER NOT NULL DEFAULT 0,
          memory_gib_seconds REAL NOT NULL DEFAULT 0,
          disk_gb_seconds REAL NOT NULL DEFAULT 0,
          cpu_vcpu_seconds REAL NOT NULL DEFAULT 0,
          sessions_count INTEGER NOT NULL DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();
    quotaTableEnsured = true;
  } catch {
    // Ignore if read-only
  }
}

export function buildSandboxQuotaEdgeCacheKey(billingCycle: string): string {
  return `https://cache.luantihub.internal/__sandbox_quota_v1/${encodeURIComponent(billingCycle)}`;
}

export async function getSandboxQuotaStatus(
  env?: { DB?: any; SANDBOX_BILLING_RESET_DAY?: string; SANDBOX_FORCE_QUOTA_EXHAUSTED?: string },
  now: Date = new Date(),
  skipCache = false
): Promise<SandboxQuotaStatus> {
  const resetDay = Number(env?.SANDBOX_BILLING_RESET_DAY || 2) || 2;
  const { billingCycle, periodStart, resetsAt } = resolveBillingCycleWindow(now, resetDay);
  const forcedExhausted =
    env?.SANDBOX_FORCE_QUOTA_EXHAUSTED === 'true' || env?.SANDBOX_FORCE_QUOTA_EXHAUSTED === '1';

  const quotaCacheKey = buildSandboxQuotaEdgeCacheKey(billingCycle);
  if (!skipCache && !forcedExhausted && env?.DB) {
    const cached = await readEdgeCacheJson<SandboxQuotaStatus>(quotaCacheKey);
    if (cached && cached.billingCycle === billingCycle) {
      return cached;
    }
  }

  let awakeSeconds = 0;
  let memoryGibSeconds = 0;
  let cpuVcpuSeconds = 0;
  let diskGbSeconds = 0;
  let sessionsCount = 0;

  if (env?.DB) {
    try {
      const selectQuery = `SELECT awake_seconds, memory_gib_seconds, disk_gb_seconds, cpu_vcpu_seconds, sessions_count
         FROM sandbox_quota_usage
         WHERE billing_cycle = ?
         LIMIT 1`;
      let row = await env.DB.prepare(selectQuery)
        .bind(billingCycle)
        .first()
        .catch(async (err: any) => {
          if (/no such table/i.test(String(err?.message || err || ''))) {
            await ensureQuotaTable(env.DB, true);
            return env.DB.prepare(selectQuery).bind(billingCycle).first().catch(() => null);
          }
          return null;
        });

      if (row) {
        quotaTableEnsured = true;
        awakeSeconds = Number(row.awake_seconds || 0);
        memoryGibSeconds = Number(row.memory_gib_seconds || 0);
        diskGbSeconds = Number(row.disk_gb_seconds || 0);
        cpuVcpuSeconds = Number(row.cpu_vcpu_seconds || 0);
        sessionsCount = Number(row.sessions_count || 0);
      }
    } catch {
      // Fallback to 0 if D1 unavailable
    }
  }

  const memPct = (memoryGibSeconds / MAX_SAFE_MEMORY_GIB_SECONDS) * 100;
  const cpuPct = (cpuVcpuSeconds / MAX_SAFE_CPU_VCPU_SECONDS) * 100;
  const diskPct = (diskGbSeconds / MAX_SAFE_DISK_GB_SECONDS) * 100;
  const usagePercent = Math.min(100, Math.round(Math.max(memPct, cpuPct, diskPct) * 10) / 10);

  const exhausted =
    forcedExhausted ||
    memoryGibSeconds >= MAX_SAFE_MEMORY_GIB_SECONDS ||
    cpuVcpuSeconds >= MAX_SAFE_CPU_VCPU_SECONDS ||
    diskGbSeconds >= MAX_SAFE_DISK_GB_SECONDS;

  const statusPayload: SandboxQuotaStatus = {
    exhausted,
    billingCycle,
    periodStart,
    resetsAt,
    awakeSeconds,
    memoryGibSeconds: Math.round(memoryGibSeconds * 100) / 100,
    maxMemoryGibSeconds: MAX_SAFE_MEMORY_GIB_SECONDS,
    cpuVcpuSeconds: Math.round(cpuVcpuSeconds * 100) / 100,
    maxCpuVcpuSeconds: MAX_SAFE_CPU_VCPU_SECONDS,
    diskGbSeconds: Math.round(diskGbSeconds * 100) / 100,
    maxDiskGbSeconds: MAX_SAFE_DISK_GB_SECONDS,
    usagePercent,
    sessionsCount
  };

  if (!forcedExhausted && env?.DB) {
    await writeEdgeCacheJson(quotaCacheKey, statusPayload, 60);
  }

  return statusPayload;
}

export async function recordSandboxSessionUsage(
  env: { DB?: any; SANDBOX_BILLING_RESET_DAY?: string; SANDBOX_INSTANCE_TYPE?: string } | undefined,
  durationSeconds: number,
  incrementSessionCount = false,
  now: Date = new Date()
): Promise<SandboxQuotaStatus> {
  const clampedSeconds = Math.max(0, Math.min(3600, Math.round(durationSeconds)));
  const resetDay = Number(env?.SANDBOX_BILLING_RESET_DAY || 2) || 2;
  const { billingCycle } = resolveBillingCycleWindow(now, resetDay);
  const instanceType = env?.SANDBOX_INSTANCE_TYPE === 'lite' ? 'lite' : 'basic';
  const rates = CONTAINER_RATES[instanceType];

  const deltaMem = clampedSeconds * rates.memoryGibPerSec;
  const deltaCpu = clampedSeconds * rates.cpuVcpuPerSec;
  const deltaDisk = clampedSeconds * rates.diskGbPerSec;
  const deltaSessions = incrementSessionCount ? 1 : 0;

  if (env?.DB && (clampedSeconds > 0 || incrementSessionCount)) {
    try {
      await ensureQuotaTable(env.DB);
      await env.DB.prepare(
        `INSERT INTO sandbox_quota_usage (
           billing_cycle, awake_seconds, memory_gib_seconds, disk_gb_seconds, cpu_vcpu_seconds, sessions_count, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(billing_cycle) DO UPDATE SET
           awake_seconds = sandbox_quota_usage.awake_seconds + excluded.awake_seconds,
           memory_gib_seconds = sandbox_quota_usage.memory_gib_seconds + excluded.memory_gib_seconds,
           disk_gb_seconds = sandbox_quota_usage.disk_gb_seconds + excluded.disk_gb_seconds,
           cpu_vcpu_seconds = sandbox_quota_usage.cpu_vcpu_seconds + excluded.cpu_vcpu_seconds,
           sessions_count = sandbox_quota_usage.sessions_count + excluded.sessions_count,
           updated_at = CURRENT_TIMESTAMP`
      )
        .bind(billingCycle, clampedSeconds, deltaMem, deltaDisk, deltaCpu, deltaSessions)
        .run();
    } catch {
      // Ignore write failure on read-only local state
    }
  }

  return getSandboxQuotaStatus(env, now, true);
}

export async function onRequestGet(context: { env?: any }) {
  const status = await getSandboxQuotaStatus(context.env);
  return Response.json(status, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}


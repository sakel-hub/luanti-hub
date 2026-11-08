import { getSandboxQuotaStatus, recordSandboxSessionUsage } from './quota';

interface Env {
  DB?: any;
  SANDBOX_SESSION?: any;
  SANDBOX_CONTAINER_URL?: string;
  SANDBOX_BILLING_RESET_DAY?: string;
  SANDBOX_INSTANCE_TYPE?: string;
  SANDBOX_FORCE_QUOTA_EXHAUSTED?: string;
}

const DEFAULT_LOCAL_CONTAINER_URL = 'http://127.0.0.1:8089';
const DEFAULT_LOCAL_STREAM_URL = 'http://127.0.0.1:6080/sandbox.html';

function resolveContainerEndpoint(request: Request, env?: Env): {
  controlBaseUrl: string;
  streamUrl: string;
} {
  if (env?.SANDBOX_CONTAINER_URL) {
    const base = env.SANDBOX_CONTAINER_URL.replace(/\/+$/, '');
    return {
      controlBaseUrl: base,
      streamUrl: `${base}/sandbox.html`
    };
  }
  const reqUrl = new URL(request.url, 'http://localhost:8788');
  const host = reqUrl.hostname || '127.0.0.1';
  if (host === 'localhost' || host === '127.0.0.1') {
    return {
      controlBaseUrl: DEFAULT_LOCAL_CONTAINER_URL,
      streamUrl: `http://${host}:6080/sandbox.html`
    };
  }
  return {
    controlBaseUrl: '',
    streamUrl: ''
  };
}

export async function onRequestGet(context: { request: Request; env?: Env }) {
  const quota = await getSandboxQuotaStatus(context.env);
  if (quota.exhausted) {
    return Response.json(
      {
        status: 'quota_exhausted',
        quota
      },
      { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const { controlBaseUrl, streamUrl } = resolveContainerEndpoint(context.request, context.env);
  if (!controlBaseUrl && !context.env?.SANDBOX_SESSION) {
    return Response.json(
      {
        status: 'unavailable',
        message: 'Sandbox container service is not configured for this environment.',
        quota
      },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = context.env?.SANDBOX_SESSION
      ? await context.env.SANDBOX_SESSION.get(
          context.env.SANDBOX_SESSION.idFromName('active')
        ).fetch('http://container/status')
      : await fetch(`${controlBaseUrl}/status`, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Container returned ${res.status}`);
    }
    const data = await res.json();
    return Response.json(
      {
        ...data,
        streamUrl: data.streamUrl || streamUrl,
        quota
      },
      { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } }
    );
  } catch {
    return Response.json(
      {
        status: 'offline',
        message: 'Local Luanti sandbox container is not running. Start it with: npm run sandbox:docker:up',
        quota
      },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

export async function onRequestPost(context: { request: Request; env?: Env }) {
  const quota = await getSandboxQuotaStatus(context.env);
  if (quota.exhausted) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_QUOTA_EXHAUSTED',
        message: `Monthly Cloudflare Container quota safety threshold (${quota.usagePercent}%) reached. Resets on ${quota.resetsAt.slice(0, 10)}.`,
        quota
      },
      { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const body = await context.request.json().catch(() => ({} as any));
  const action = String(body.action || 'boot');
  const { controlBaseUrl, streamUrl } = resolveContainerEndpoint(context.request, context.env);

  if (!controlBaseUrl && !context.env?.SANDBOX_SESSION) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_CONTAINER_UNAVAILABLE',
        message: 'Sandbox container service is not configured.',
        quota
      },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const targetPath = action === 'command' ? '/command' : action === 'stop' ? '/stop' : '/boot';

  try {
    const reqOrigin = new URL(context.request.url, 'http://localhost:8788').origin;
    const forwardPayload = {
      ...body,
      originUrl: body.originUrl || reqOrigin.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal')
    };

    const ctrl = new AbortController();
    const timeoutMs = action === 'boot' ? 60000 : 10000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = context.env?.SANDBOX_SESSION
      ? await context.env.SANDBOX_SESSION.get(
          context.env.SANDBOX_SESSION.idFromName('active')
        ).fetch(`http://container${targetPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(forwardPayload)
        })
      : await fetch(`${controlBaseUrl}${targetPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(forwardPayload),
          signal: ctrl.signal
        });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return Response.json(
        {
          ok: false,
          code: 'SANDBOX_BOOT_ERROR',
          message: `Container boot failed (${res.status}): ${errText}`
        },
        { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const data = await res.json();
    let updatedQuota = quota;
    if (action === 'boot') {
      // Pre-record initial 5s boot + session count
      updatedQuota = await recordSandboxSessionUsage(context.env, 5, true);
    } else if (action === 'stop' && Number(data?.awakeSeconds) > 0) {
      updatedQuota = await recordSandboxSessionUsage(context.env, Number(data.awakeSeconds), false);
    }

    return Response.json(
      {
        ...data,
        streamUrl: data.streamUrl || streamUrl,
        quota: updatedQuota
      },
      { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError' || String(err?.message || '').includes('aborted');
    return Response.json(
      {
        ok: false,
        code: isTimeout ? 'SANDBOX_BOOT_TIMEOUT' : 'SANDBOX_CONTAINER_UNAVAILABLE',
        message: isTimeout
          ? 'Container boot timed out while downloading package archives. Please click Retry Connection.'
          : 'Luanti Sandbox Docker container is not running on port 8089. Run `npm run sandbox:docker:up` to start the local Luanti container.',
        quota
      },
      { status: isTimeout ? 504 : 503, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

export async function onRequestDelete(context: { request: Request; env?: Env }) {
  const { controlBaseUrl } = resolveContainerEndpoint(context.request, context.env);
  let awakeSeconds = 0;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = context.env?.SANDBOX_SESSION
      ? await context.env.SANDBOX_SESSION.get(
          context.env.SANDBOX_SESSION.idFromName('active')
        ).fetch('http://container/stop', { method: 'POST' })
      : controlBaseUrl
        ? await fetch(`${controlBaseUrl}/stop`, { method: 'POST', signal: ctrl.signal })
        : null;
    clearTimeout(timer);
    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      awakeSeconds = Number(data?.awakeSeconds || 0);
    }
  } catch {
    // Container already stopped
  }

  const quota = await recordSandboxSessionUsage(context.env, awakeSeconds, false);
  return Response.json(
    { ok: true, stopped: true, awakeSeconds, quota },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}


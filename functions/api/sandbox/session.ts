import { verifySameOriginMutation } from '../auth/lib/session';
import { getSandboxQuotaStatus, recordSandboxSessionUsage } from './quota';
import {
  EPHEMERAL_TUNNEL_HOST_PATTERN,
  isUntrustedTunnelOrPrivateHost,
  sanitizePublicErrorMessage
} from '../lib/upstream';

const SANDBOX_JSON_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

const ALLOWED_SANDBOX_ACTIONS = new Set(['boot', 'command', 'stop']);
const ALLOWED_SANDBOX_COMMANDS = new Set([
  'TOGGLE_MOUSE_LOCK',
  'TOGGLE_INVENTORY',
  'TOGGLE_FLY',
  'TOGGLE_FAST',
  'ESCAPE'
]);

function isLocalhostRequest(request: Request): boolean {
  try {
    const reqUrl = new URL(request.url, 'http://localhost:8788');
    const host = (reqUrl.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function isDisallowedSandboxBundleUrl(
  rawUrl: unknown,
  options: { allowRelativeApiPath?: boolean; allowLocalDockerHost?: boolean } = {}
): boolean {
  if (rawUrl === undefined || rawUrl === null || rawUrl === '') return false;
  if (typeof rawUrl !== 'string') return true;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f\\]/.test(trimmed)) return true;

  if (EPHEMERAL_TUNNEL_HOST_PATTERN.test(trimmed.toLowerCase())) {
    return true;
  }

  if (trimmed.startsWith('/')) {
    if (!options.allowRelativeApiPath) return true;
    if (trimmed.startsWith('//') || trimmed.includes('..')) return true;
    return !trimmed.startsWith('/api/packages/');
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return true;
    const host = parsed.hostname.toLowerCase();
    if (EPHEMERAL_TUNNEL_HOST_PATTERN.test(host)) return true;

    if (
      options.allowLocalDockerHost &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1' || host === 'host.docker.internal')
    ) {
      return false;
    }

    if (parsed.protocol !== 'https:') return true;
    return isUntrustedTunnelOrPrivateHost(trimmed);
  } catch {
    return true;
  }
}

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
    if (isUntrustedTunnelOrPrivateHost(env.SANDBOX_CONTAINER_URL)) {
      return {
        controlBaseUrl: '',
        streamUrl: ''
      };
    }
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
      { status: 429, headers: SANDBOX_JSON_HEADERS }
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
      { status: 503, headers: SANDBOX_JSON_HEADERS }
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
      { headers: SANDBOX_JSON_HEADERS }
    );
  } catch {
    return Response.json(
      {
        status: 'offline',
        message: 'Local Luanti sandbox container is not running. Start it with: npm run sandbox:docker:up',
        quota
      },
      { status: 503, headers: SANDBOX_JSON_HEADERS }
    );
  }
}

export async function onRequestPost(context: { request: Request; env?: Env }) {
  const csrfBlock = verifySameOriginMutation(context.request);
  if (csrfBlock) return csrfBlock;

  const quota = await getSandboxQuotaStatus(context.env);
  if (quota.exhausted) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_QUOTA_EXHAUSTED',
        message: `Monthly Cloudflare Container quota safety threshold (${quota.usagePercent}%) reached. Resets on ${quota.resetsAt.slice(0, 10)}.`,
        quota
      },
      { status: 429, headers: SANDBOX_JSON_HEADERS }
    );
  }

  const body = await context.request.json().catch(() => ({} as any));
  const action = String(body.action || 'boot');
  if (!ALLOWED_SANDBOX_ACTIONS.has(action)) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_INVALID_ACTION',
        message: 'Unsupported sandbox session action.',
        quota
      },
      { status: 400, headers: SANDBOX_JSON_HEADERS }
    );
  }

  if (action === 'command' && !ALLOWED_SANDBOX_COMMANDS.has(String(body.command || ''))) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_INVALID_COMMAND',
        message: 'Unsupported sandbox HUD command.',
        quota
      },
      { status: 400, headers: SANDBOX_JSON_HEADERS }
    );
  }

  const allowLocalDocker = isLocalhostRequest(context.request);
  if (
    isDisallowedSandboxBundleUrl(body?.originUrl, { allowLocalDockerHost: allowLocalDocker }) ||
    (Array.isArray(body?.bundles) &&
      body.bundles.some(
        (b: any) =>
          isDisallowedSandboxBundleUrl(b?.downloadUrl, {
            allowRelativeApiPath: true,
            allowLocalDockerHost: allowLocalDocker
          }) ||
          isDisallowedSandboxBundleUrl(b?.gitArchiveUrl, {
            allowRelativeApiPath: false,
            allowLocalDockerHost: false
          })
      ))
  ) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_UNTRUSTED_TUNNEL_URL',
        message: 'Untrusted, private, or ephemeral tunnel URLs are not permitted in sandbox session requests.',
        quota
      },
      { status: 403, headers: SANDBOX_JSON_HEADERS }
    );
  }
  const { controlBaseUrl, streamUrl } = resolveContainerEndpoint(context.request, context.env);

  if (!controlBaseUrl && !context.env?.SANDBOX_SESSION) {
    return Response.json(
      {
        ok: false,
        code: 'SANDBOX_CONTAINER_UNAVAILABLE',
        message: 'Sandbox container service is not configured.',
        quota
      },
      { status: 503, headers: SANDBOX_JSON_HEADERS }
    );
  }

  const targetPath = action === 'command' ? '/command' : action === 'stop' ? '/stop' : '/boot';

  try {
    const reqOrigin = new URL(context.request.url, 'http://localhost:8788').origin;
    const normalizedDockerOrigin = reqOrigin
      .replace('localhost:4200', 'host.docker.internal:8788')
      .replace('127.0.0.1:4200', 'host.docker.internal:8788')
      .replace('localhost', 'host.docker.internal')
      .replace('127.0.0.1', 'host.docker.internal');
    const forwardPayload = {
      ...body,
      originUrl: normalizedDockerOrigin
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
      const safeDetail = sanitizePublicErrorMessage(errText, 'Container returned an unexpected error.');
      return Response.json(
        {
          ok: false,
          code: 'SANDBOX_BOOT_ERROR',
          message: `Container boot failed (${res.status}): ${safeDetail}`
        },
        { status: 502, headers: SANDBOX_JSON_HEADERS }
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
      { headers: SANDBOX_JSON_HEADERS }
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
      { status: isTimeout ? 504 : 503, headers: SANDBOX_JSON_HEADERS }
    );
  }
}

export async function onRequestDelete(context: { request: Request; env?: Env }) {
  const csrfBlock = verifySameOriginMutation(context.request, { allowSimpleBeacon: true });
  if (csrfBlock) return csrfBlock;

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
    { headers: SANDBOX_JSON_HEADERS }
  );
}


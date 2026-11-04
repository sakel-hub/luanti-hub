export interface Env {
  SANDBOX_SESSION: any;
}

const IDLE_TIMEOUT_MS = 90 * 1000; // Stop container after 90s without heartbeat
const MAX_SESSION_TTL_MS = 10 * 60 * 1000; // Hard 10-minute session cap

export class SandboxSessionDO {
  private startedAt = 0;

  constructor(
    private readonly ctx: any,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Ensure container is awake and reset idle alarm
    if (request.method === 'DELETE' || url.pathname === '/stop') {
      await this.stopContainer();
      return Response.json({ ok: true, stopped: true });
    }

    if (!this.startedAt) {
      this.startedAt = Date.now();
    }
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);

    const container = this.ctx.container;
    if (container && !container.running) {
      await container.start();
    }

    // Route /sandbox.html and /websockify to container port 6080 (noVNC stream), control plane to 8089
    const isStreamPath =
      url.pathname === '/sandbox.html' ||
      url.pathname === '/websockify' ||
      url.pathname.startsWith('/core/') ||
      url.pathname.startsWith('/vendor/');
    const targetPort = isStreamPath ? 6080 : 8089;

    if (container?.getTcpPort) {
      const portObj = container.getTcpPort(targetPort);
      return portObj.fetch(request);
    }

    return Response.json({ error: 'Container runtime binding unavailable' }, { status: 503 });
  }

  async alarm(): Promise<void> {
    await this.stopContainer();
  }

  private async stopContainer(): Promise<void> {
    this.startedAt = 0;
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {}
    try {
      if (this.ctx.container?.running) {
        await this.ctx.container.stop();
      }
    } catch {}
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sessionKey = url.searchParams.get('session') || 'default-sandbox';
    const id = env.SANDBOX_SESSION.idFromName(sessionKey);
    const stub = env.SANDBOX_SESSION.get(id);
    return stub.fetch(request);
  }
};


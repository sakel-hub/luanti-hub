import { fetchUpstreamJsonCached } from './lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const upstreamPath = `/updates/${query ? `?${query}` : ''}`;

  const [upstreamUpdates, d1Rows] = await Promise.all([
    fetchUpstreamJsonCached<Record<string, number>>(upstreamPath, 300).catch(() => null),
    env.DB
      ? env.DB.prepare(
          `SELECT author_name, name, updated_at, created_at FROM packages WHERE status = 'active'`
        )
          .all()
          .then((res: any) => res.results || [])
          .catch(() => [])
      : Promise.resolve<any[]>([])
  ]);

  const merged: Record<string, number> = {
    ...(upstreamUpdates && typeof upstreamUpdates === 'object' ? upstreamUpdates : {})
  };

  for (const row of d1Rows) {
    if (!row?.author_name || !row?.name) continue;
    const key = `${row.author_name}/${row.name}`;
    if (merged[key] && Number(merged[key]) > 0) continue;
    const releaseId = Math.max(
      1,
      Math.floor(new Date(row.updated_at || row.created_at || '2026-01-01T00:00:00Z').getTime() / 1000) || 1
    );
    merged[key] = releaseId;
  }

  return new Response(JSON.stringify(merged), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=180'
    }
  });
}

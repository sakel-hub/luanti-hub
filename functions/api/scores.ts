import { fetchUpstreamJsonCached } from './lib/upstream';

export async function onRequestGet() {
  const scores = (await fetchUpstreamJsonCached<any[]>('/scores/', 1800).catch(() => null)) || [];

  return new Response(JSON.stringify(scores), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600'
    }
  });
}

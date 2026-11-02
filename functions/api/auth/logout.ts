import { buildClearSessionCookies } from './lib/session';

export async function onRequestPost(context: { request: Request }) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  for (const cookie of buildClearSessionCookies(context.request.url)) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify({ success: true }), { headers });
}

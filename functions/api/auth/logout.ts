export async function onRequestPost(context: { request: Request }) {
  const url = new URL(context.request.url);
  const isHttps = url.protocol === 'https:';
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Set-Cookie': `lh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps ? '; Secure' : ''}`
    }
  });
}

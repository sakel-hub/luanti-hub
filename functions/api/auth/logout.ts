export async function onRequestPost() {
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'lh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    }
  });
}

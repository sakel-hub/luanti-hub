import { safeDecodeParam } from '../../../api/lib/upstream';

export async function onRequestGet(context: {
  request: Request;
  params: { author: string; name: string };
}): Promise<Response> {
  const rawAuthor = String(context.params?.author || '');
  const rawName = String(context.params?.name || '');
  const author = safeDecodeParam(rawAuthor).trim() || rawAuthor;
  const name = safeDecodeParam(rawName).trim() || rawName;
  const reqUrl = new URL(context.request.url);
  const origin = reqUrl.origin.includes('luanti-hub.pages.dev') ? 'https://luantihub.org' : reqUrl.origin;
  const targetUrl = `${origin}/package/${encodeURIComponent(author)}/${encodeURIComponent(name)}${reqUrl.search}`;

  return new Response(null, {
    status: 301,
    headers: {
      Location: targetUrl,
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

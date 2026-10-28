import { fetchUpstreamJsonCached } from '../../../lib/upstream';

export async function onRequestGet(context: { params: { author: string; name: string } }) {
  const { author, name } = context.params;
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);

  const data = await fetchUpstreamJsonCached<any>(
    `/packages/${encAuthor}/${encName}/dependencies/?only_hard=0`,
    600
  );

  if (!data) {
    return Response.json({}, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=600'
    }
  });
}

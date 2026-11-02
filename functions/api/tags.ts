import { getUnifiedCatalogTags } from './lib/upstream';

export async function onRequestGet(context?: { env?: { DB?: any } }) {
  const tags = await getUnifiedCatalogTags(context?.env?.DB);

  return new Response(JSON.stringify(tags), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=1800, s-maxage=3600'
    }
  });
}

import { fetchUpstreamJsonCached } from '../../../../lib/upstream';

interface Env {
  DB?: any;
}

const HYPERTEXT_HEAD = '<tag name=code color=#7bf font=mono> <tag name=action color=#4CDAFA hovercolor=#97EAFC>';

function escapeHypertext(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

export async function onRequestGet(context: {
  request?: Request;
  params: { author: string; name: string };
  env?: Env;
}) {
  const { author, name } = context.params;
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  const pkgId = `${author}/${name}`;

  const reqUrl = context.request
    ? new URL(context.request.url)
    : new URL(`https://luantihub.org/api/packages/${encAuthor}/${encName}/for-client/reviews/`);
  const forwardParams = new URLSearchParams(reqUrl.searchParams);
  if (!forwardParams.has('formspec_version')) {
    forwardParams.set('formspec_version', '8');
  }
  const querySuffix = `?${forwardParams.toString()}`;

  const [upstreamReviews, d1Rows] = await Promise.all([
    fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/for-client/reviews/${querySuffix}`, 300).catch(() => null),
    context.env?.DB
      ? context.env.DB.prepare(`
          SELECT r.rating, r.title, r.comment, r.created_at,
                 u.username, u.display_name
          FROM reviews r
          LEFT JOIN users u ON r.user_id = u.id
          WHERE LOWER(r.package_id) = LOWER(?)
          ORDER BY r.created_at DESC
        `).bind(pkgId).all().then((res: any) => res.results || []).catch(() => [])
      : Promise.resolve<any[]>([])
  ]);

  const localBlocks: string[] = [];
  for (const r of d1Rows) {
    const rating = Math.max(1, Math.min(5, Number(r.rating || 5)));
    const icon = ['<thumbsdown>', '<thumbsdown>', '<neutral>', '<thumbsup>', '<thumbsup>'][rating - 1];
    const userLabel = escapeHypertext(r.display_name || r.username || 'Community Member');
    const titleLine = r.title ? `\n<big>${escapeHypertext(r.title)}</big>` : '';
    const commentBody = escapeHypertext(r.comment || '');
    localBlocks.push(`<b>${userLabel}</b> ${icon}${titleLine}\n${commentBody}`);
  }

  const links: Record<string, string> = {
    link_review: `https://luantihub.org/package/${encAuthor}/${encName}`
  };
  const leaveReviewAction = `<action name=link_review>Leave a review on Luanti Hub</action>\n\n`;

  if (upstreamReviews && typeof upstreamReviews === 'object' && typeof upstreamReviews.body === 'string') {
    const mergedLinks = { ...(upstreamReviews.links || {}), ...links };
    const mergedBody = localBlocks.length > 0
      ? `${leaveReviewAction}${localBlocks.join('\n\n')}\n\n${upstreamReviews.body}`
      : upstreamReviews.body;
    return new Response(
      JSON.stringify({
        head: upstreamReviews.head || HYPERTEXT_HEAD,
        body: mergedBody,
        links: mergedLinks,
        images: upstreamReviews.images || {},
        image_tooltips: upstreamReviews.image_tooltips || {}
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=180, s-maxage=300'
        }
      }
    );
  }

  const fallbackBody = localBlocks.length > 0
    ? `${leaveReviewAction}${localBlocks.join('\n\n')}`
    : `${leaveReviewAction}No reviews available.`;

  return new Response(
    JSON.stringify({
      head: HYPERTEXT_HEAD,
      body: fallbackBody,
      links,
      images: {},
      image_tooltips: {}
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=180, s-maxage=300'
      }
    }
  );
}

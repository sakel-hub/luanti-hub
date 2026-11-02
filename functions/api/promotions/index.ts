import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount
} from '../auth/lib/session';
import {
  ensureExtendedPackageColumns,
  invalidateEdgeCacheKeys,
  sanitizePublicErrorMessage,
  setLastKnownActivePromotions,
  writeEdgeCacheJson
} from '../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

async function resolveAdminSession(
  request: Request,
  env: Env
): Promise<{ isAdmin: boolean; username: string | null }> {
  if (!env.DB) return { isAdmin: false, username: null };
  const cookies = parseCookies(request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) return { isAdmin: false, username: null };

  const userId = await verifySessionToken(sessionToken, env.SESSION_SECRET);
  if (!userId) return { isAdmin: false, username: null };

  try {
    const user = await reconcileAndMergeUserAccount(env.DB, userId);
    if (!user) return { isAdmin: false, username: null };

    const identitiesRes = await env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(String(user.id)).all();
    const identities = (identitiesRes?.results || []).map((id: any) => ({
      ...id,
      verified: Boolean(id.verified)
    }));

    const isAdmin = checkIsAdmin(user, identities, env.ADMIN_USERS);
    return {
      isAdmin,
      username: user.username ? String(user.username) : null
    };
  } catch {
    return { isAdmin: false, username: null };
  }
}

/**
 * Normalizes a promotional banner URL or CTA URL.
 * Supports:
 * - Relative local asset paths or in-app SPA routes (e.g. `/promo.png`, `promo.png`, `/submit`, `/?tag=game`, `/package/author/name`)
 * - External `https://` or `http://` URLs
 * Rejects dangerous schemes (`javascript:`, `data:`, `vbscript:`).
 */
export function normalizePromoUrl(raw: string, allowBareRelativeAsset = true): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.toString();
      }
    } catch {
      return null;
    }
    return null;
  }

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return null;
    return trimmed;
  }

  if (allowBareRelativeAsset && /^[a-zA-Z0-9_./?=&%-]+$/.test(trimmed)) {
    return `/${trimmed.replace(/^\/+/, '')}`;
  }

  return null;
}

export function filterActivePromotions(rows: any[], nowMs = Date.now()): any[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => {
    if (!r || !r.title || !r.banner_url || !r.expires_at) return false;
    const expMs = Date.parse(String(r.expires_at));
    if (!Number.isFinite(expMs) || expMs <= nowMs) return false;
    if (r.starts_at) {
      const startMs = Date.parse(String(r.starts_at));
      if (Number.isFinite(startMs) && startMs > nowMs) return false;
    }
    return true;
  });
}

// GET /api/promotions: Strictly Admin-only management list (public users receive active promotions via Edge-cached /api/packages/?boot=1)
export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const { isAdmin } = await resolveAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
  }
  if (!env.DB) {
    return Response.json({ promotions: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    await ensureExtendedPackageColumns(env.DB);
    const url = new URL(request.url);
    const wantAdminList = url.searchParams.get('admin') !== '0';

    const res = await env.DB.prepare(
      `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
    ).all();
    const allRows = Array.isArray(res?.results) ? res.results : [];
    const promotions = wantAdminList ? allRows : filterActivePromotions(allRows);

    return Response.json(
      { promotions },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Unable to load promotions.') },
      { status: 500 }
    );
  }
}

// POST /api/promotions: Create or update a Hero Carousel promotion (Admin-only)
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const { isAdmin, username } = await resolveAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
  }
  if (!env.DB) {
    return Response.json({ error: 'Database not available.' }, { status: 503 });
  }

  try {
    await ensureExtendedPackageColumns(env.DB);
    const body: any = await request.json();

    const id = String(body?.id || '').trim() || `promo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const title = String(body?.title || '').trim().slice(0, 120);
    const shortDesc = String(body?.short_desc || '').trim().slice(0, 400);
    const bannerUrl = normalizePromoUrl(body?.banner_url);
    const ctaLabel = (String(body?.cta_label || '').trim() || 'Learn More').slice(0, 50);
    const ctaUrl = normalizePromoUrl(body?.cta_url);
    const secondaryCtaLabelRaw = String(body?.secondary_cta_label || '').trim().slice(0, 50);
    const secondaryCtaUrlRaw = String(body?.secondary_cta_url || '').trim();
    const secondaryCtaUrl = secondaryCtaUrlRaw ? normalizePromoUrl(secondaryCtaUrlRaw) : null;
    const badgeText = (String(body?.badge_text || '').trim() || 'PROMOTED').slice(0, 40);
    const priority = Number.isFinite(Number(body?.priority)) ? Math.round(Number(body.priority)) : 100;

    if (!title) {
      return Response.json({ error: 'Promotion title is required.' }, { status: 400 });
    }
    if (!shortDesc) {
      return Response.json({ error: 'Promotion description is required.' }, { status: 400 });
    }
    if (!bannerUrl) {
      return Response.json(
        { error: 'Valid banner image URL is required (e.g. /promo.png or https://...).' },
        { status: 400 }
      );
    }
    if (!ctaUrl) {
      return Response.json(
        { error: 'Valid primary CTA link URL is required (e.g. /submit or https://...).' },
        { status: 400 }
      );
    }
    if (secondaryCtaUrlRaw && !secondaryCtaUrl) {
      return Response.json(
        { error: 'Secondary CTA URL must be a valid relative path (/...) or https:// URL.' },
        { status: 400 }
      );
    }

    const startsAtMs = body?.starts_at ? Date.parse(String(body.starts_at)) : Date.now();
    const expiresAtMs = Date.parse(String(body?.expires_at || ''));

    if (!Number.isFinite(startsAtMs)) {
      return Response.json({ error: 'Invalid start date/time.' }, { status: 400 });
    }
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= startsAtMs) {
      return Response.json(
        { error: 'Expiration date/time is required and must be after the start date/time.' },
        { status: 400 }
      );
    }

    const startsAtIso = new Date(startsAtMs).toISOString();
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    await env.DB.prepare(`
      INSERT INTO hero_promotions (
        id, title, short_desc, banner_url, cta_label, cta_url,
        secondary_cta_label, secondary_cta_url, badge_text,
        starts_at, expires_at, priority, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        short_desc = excluded.short_desc,
        banner_url = excluded.banner_url,
        cta_label = excluded.cta_label,
        cta_url = excluded.cta_url,
        secondary_cta_label = excluded.secondary_cta_label,
        secondary_cta_url = excluded.secondary_cta_url,
        badge_text = excluded.badge_text,
        starts_at = excluded.starts_at,
        expires_at = excluded.expires_at,
        priority = excluded.priority
    `).bind(
      id,
      title,
      shortDesc,
      bannerUrl,
      ctaLabel,
      ctaUrl,
      secondaryCtaLabelRaw || null,
      secondaryCtaUrl || null,
      badgeText,
      startsAtIso,
      expiresAtIso,
      priority,
      username
    ).run();

    const res = await env.DB.prepare(
      `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
    ).all();
    const allRows = Array.isArray(res?.results) ? res.results : [];
    const activePromotions = filterActivePromotions(allRows);
    setLastKnownActivePromotions(activePromotions);
    await writeEdgeCacheJson('/__active_promotions_v1', activePromotions, 21600);
    await invalidateEdgeCacheKeys([
      '/__api_boot_catalog_bundle_v3',
      '/__api_boot_catalog_bundle_v8',
      '/__api_boot_catalog_bundle_v9',
      '/__api_packages_v2?boot=1'
    ]);

    return Response.json({
      success: true,
      promotion: allRows.find((r: any) => r.id === id) || null,
      promotions: allRows,
      activePromotions
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Unable to save promotion.') },
      { status: 500 }
    );
  }
}

// DELETE /api/promotions: Delete or end a promotion (Admin-only)
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const { isAdmin } = await resolveAdminSession(request, env);
  if (!isAdmin) {
    return Response.json({ error: 'Admin privileges required.' }, { status: 403 });
  }
  if (!env.DB) {
    return Response.json({ error: 'Database not available.' }, { status: 503 });
  }

  try {
    await ensureExtendedPackageColumns(env.DB);
    const url = new URL(request.url);
    let id = (url.searchParams.get('id') || '').trim();
    if (!id) {
      const body: any = await request.json().catch(() => null);
      id = String(body?.id || '').trim();
    }
    if (!id) {
      return Response.json({ error: 'Promotion ID is required.' }, { status: 400 });
    }

    await env.DB.prepare(`DELETE FROM hero_promotions WHERE id = ?`).bind(id).run();

    const res = await env.DB.prepare(
      `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
    ).all();
    const allRows = Array.isArray(res?.results) ? res.results : [];
    const activePromotions = filterActivePromotions(allRows);
    setLastKnownActivePromotions(activePromotions);
    await writeEdgeCacheJson('/__active_promotions_v1', activePromotions, 21600);
    await invalidateEdgeCacheKeys([
      '/__api_boot_catalog_bundle_v3',
      '/__api_boot_catalog_bundle_v8',
      '/__api_boot_catalog_bundle_v9',
      '/__api_packages_v2?boot=1'
    ]);

    return Response.json({
      success: true,
      promotions: allRows,
      activePromotions
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Unable to delete promotion.') },
      { status: 500 }
    );
  }
}

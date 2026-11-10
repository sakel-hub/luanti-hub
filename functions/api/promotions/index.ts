import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount
} from '../auth/lib/session';
import {
  ensureExtendedPackageColumns,
  ensurePromotionAndTagTables,
  invalidateEdgeCacheKeys,
  isUntrustedTunnelOrPrivateHost,
  isValidActivePromotionRow,
  parseJsonArray,
  sanitizePublicErrorMessage,
  setLastKnownActivePromotions,
  upsertCustomAppTags,
  writeEdgeCacheJson,
  BOOT_CATALOG_EDGE_CACHE_KEY
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
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !isUntrustedTunnelOrPrivateHost(parsed.hostname)
      ) {
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

const VALID_PROMO_ICONS = new Set(['trophy', 'sparkles', 'flame', 'gamepad', 'star', 'rocket']);
const VALID_PROMO_TYPES = new Set(['all', 'game', 'mod', 'txp']);
const VALID_PROMO_SOURCES = new Set(['all', 'official', 'git']);
const VALID_PROMO_SORTS = new Set(['newest', 'downloads', 'rating', 'trending']);
const SUPPORTED_LOCALES = ['en', 'sk', 'de', 'fr', 'es', 'ru'] as const;

export function sanitizePromotionTranslations(raw: any): Record<string, Record<string, string>> | null {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const cleaned: Record<string, Record<string, string>> = {};
  const allowedFields: Array<[string, number]> = [
    ['title', 120],
    ['short_desc', 400],
    ['badge_text', 40],
    ['cta_label', 50],
    ['secondary_cta_label', 50],
    ['row_title', 140],
    ['row_subtitle', 300]
  ];

  for (const loc of SUPPORTED_LOCALES) {
    const entry = obj[loc];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const locObj: Record<string, string> = {};
    for (const [field, maxLen] of allowedFields) {
      if (typeof entry[field] === 'string' && entry[field].trim()) {
        locObj[field] = entry[field].trim().slice(0, maxLen);
      }
    }
    if (Object.keys(locObj).length > 0) {
      cleaned[loc] = locObj;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export function normalizePromotionRow(r: any): any {
  if (!r || typeof r !== 'object') return r;
  const bannerUrl = String(r.banner_url || '').trim();
  const isRetiredHeroBanner = bannerUrl.includes('luanti-5-18-0');
  const showInHero =
    !isRetiredHeroBanner &&
    r.show_in_hero !== false &&
    r.show_in_hero !== 0 &&
    r.show_in_hero !== '0';
  const rowEnabled = Boolean(r.row_enabled === true || r.row_enabled === 1 || r.row_enabled === '1');
  const rowShowEmptyCta = r.row_show_empty_cta !== false && r.row_show_empty_cta !== 0 && r.row_show_empty_cta !== '0';
  const rowFilterTags = parseJsonArray(r.row_filter_tags);
  const rowPinnedPackages = parseJsonArray(r.row_pinned_packages);
  const translations = sanitizePromotionTranslations(r.translations);

  return {
    ...r,
    show_in_hero: showInHero,
    row_enabled: rowEnabled,
    row_icon: VALID_PROMO_ICONS.has(String(r.row_icon || '')) ? String(r.row_icon) : 'trophy',
    row_filter_tags: rowFilterTags,
    row_filter_type: VALID_PROMO_TYPES.has(String(r.row_filter_type || '')) ? String(r.row_filter_type) : 'all',
    row_filter_source: VALID_PROMO_SOURCES.has(String(r.row_filter_source || '')) ? String(r.row_filter_source) : 'all',
    row_pinned_packages: rowPinnedPackages,
    row_sort_by: VALID_PROMO_SORTS.has(String(r.row_sort_by || '')) ? String(r.row_sort_by) : 'newest',
    row_show_empty_cta: rowShowEmptyCta,
    translations: translations || undefined
  };
}

export function filterActivePromotions(rows: any[], nowMs = Date.now()): any[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => isValidActivePromotionRow(r, nowMs))
    .map((r) => normalizePromotionRow(r));
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
    const url = new URL(request.url);
    const wantAdminList = url.searchParams.get('admin') !== '0';

    let res: any;
    try {
      res = await env.DB.prepare(
        `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
      ).all();
    } catch (readErr: any) {
      if (/no such table|no such column/i.test(String(readErr?.message || ''))) {
        await ensurePromotionAndTagTables(env.DB, true);
        res = await env.DB.prepare(
          `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
        ).all();
      } else {
        throw readErr;
      }
    }
    const allRows = (Array.isArray(res?.results) ? res.results : []).map((r: any) => normalizePromotionRow(r));
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

// POST /api/promotions: Create or update a Hero Carousel slide and/or Promotional Package Row #1 (Admin-only)
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
    const body: any = await request.json();

    const id = String(body?.id || '').trim() || `promo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const showInHero = body?.show_in_hero !== false && body?.show_in_hero !== 0 && body?.show_in_hero !== '0';
    const rowEnabled = Boolean(body?.row_enabled === true || body?.row_enabled === 1 || body?.row_enabled === '1');

    if (!showInHero && !rowEnabled) {
      return Response.json(
        { error: 'At least one display surface must be enabled (Hero Banner Slide or Promotional Package Row #1).' },
        { status: 400 }
      );
    }

    const rowTitle = String(body?.row_title || '').trim().slice(0, 140);
    const rowSubtitle = String(body?.row_subtitle || '').trim().slice(0, 300);
    const rowIcon = VALID_PROMO_ICONS.has(String(body?.row_icon || '').trim())
      ? String(body.row_icon).trim()
      : 'trophy';

    const rawFilterTags = parseJsonArray(body?.row_filter_tags);
    const rowFilterTags = Array.from(
      new Set(
        rawFilterTags
          .map((t) => String(t || '').trim().replace(/^#+/, '').replace(/[^a-zA-Z0-9_/-]/g, ''))
          .filter(Boolean)
      )
    ).slice(0, 8);

    const rowFilterType = VALID_PROMO_TYPES.has(String(body?.row_filter_type || '').trim().toLowerCase())
      ? String(body.row_filter_type).trim().toLowerCase()
      : 'all';
    const rowFilterSource = VALID_PROMO_SOURCES.has(String(body?.row_filter_source || '').trim().toLowerCase())
      ? String(body.row_filter_source).trim().toLowerCase()
      : 'all';
    const rowFilterAuthor = String(body?.row_filter_author || '').trim().replace(/^@+/, '').slice(0, 60);
    const rowFilterQuery = String(body?.row_filter_query || '').trim().slice(0, 80);

    const rawPinned = parseJsonArray(body?.row_pinned_packages);
    const rowPinnedPackages = Array.from(
      new Set(
        rawPinned
          .map((p) => String(p || '').trim())
          .filter((p) => /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(p))
      )
    ).slice(0, 20);

    const rowSortBy = VALID_PROMO_SORTS.has(String(body?.row_sort_by || '').trim().toLowerCase())
      ? String(body.row_sort_by).trim().toLowerCase()
      : 'newest';
    const rowShowEmptyCta =
      body?.row_show_empty_cta !== false && body?.row_show_empty_cta !== 0 && body?.row_show_empty_cta !== '0';

    const translationsObj = sanitizePromotionTranslations(body?.translations);
    const translationsJson = translationsObj ? JSON.stringify(translationsObj) : null;

    if (rowEnabled) {
      const hasRowCriteria =
        rowFilterTags.length > 0 ||
        rowPinnedPackages.length > 0 ||
        Boolean(rowFilterAuthor) ||
        Boolean(rowFilterQuery) ||
        rowFilterType !== 'all' ||
        rowFilterSource !== 'all';
      if (!hasRowCriteria) {
        return Response.json(
          { error: 'Promotional Package Row requires at least one filter criterion (e.g. a tag like jam_game_2026, pinned package, author, or type).' },
          { status: 400 }
        );
      }
    }

    const rawTitle = String(body?.title || '').trim().slice(0, 120);
    const title = rawTitle || rowTitle.replace(/^i18n:[^|]+\|?/, '') || 'Community Promotion';
    const rawShortDesc = String(body?.short_desc || '').trim().slice(0, 400);
    const shortDesc = rawShortDesc || rowSubtitle || title;
    const rawBannerInput = String(body?.banner_url || '').trim();
    const bannerUrl = normalizePromoUrl(rawBannerInput || (!showInHero ? '/promo.png' : ''));
    const ctaLabel = (String(body?.cta_label || '').trim() || 'Learn More').slice(0, 50);
    const defaultRowCtaUrl = rowFilterTags[0] ? `/?tag=${encodeURIComponent(rowFilterTags[0])}` : '/submit';
    const rawCtaInput = String(body?.cta_url || '').trim();
    const ctaUrl = normalizePromoUrl(rawCtaInput || (!showInHero ? defaultRowCtaUrl : ''));
    const secondaryCtaLabelRaw = String(body?.secondary_cta_label || '').trim().slice(0, 50);
    const secondaryCtaUrlRaw = String(body?.secondary_cta_url || '').trim();
    const secondaryCtaUrl = secondaryCtaUrlRaw ? normalizePromoUrl(secondaryCtaUrlRaw) : null;
    const badgeText = (String(body?.badge_text || '').trim() || 'PROMOTED').slice(0, 40);
    const priority = Number.isFinite(Number(body?.priority))
      ? Math.max(1, Math.min(1000, Math.round(Number(body.priority))))
      : 100;

    if (showInHero && !rawTitle) {
      return Response.json({ error: 'Promotion title is required when Hero Banner Slide is enabled.' }, { status: 400 });
    }
    if (!showInHero && !rawTitle && !rowTitle) {
      return Response.json({ error: 'Row title (or promotion title) is required.' }, { status: 400 });
    }
    if (showInHero && !rawShortDesc) {
      return Response.json({ error: 'Promotion description is required when Hero Banner Slide is enabled.' }, { status: 400 });
    }
    if (showInHero && !bannerUrl) {
      return Response.json(
        { error: 'Valid banner image URL is required (e.g. /promo.png or https://...).' },
        { status: 400 }
      );
    }
    if (showInHero && !ctaUrl) {
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

    const runPromoUpsert = () =>
      env.DB.prepare(`
        INSERT INTO hero_promotions (
          id, title, short_desc, banner_url, cta_label, cta_url,
          secondary_cta_label, secondary_cta_url, badge_text,
          starts_at, expires_at, priority,
          show_in_hero, row_enabled, row_title, row_subtitle, row_icon,
          row_filter_tags, row_filter_type, row_filter_source, row_filter_author,
          row_filter_query, row_pinned_packages, row_sort_by, row_show_empty_cta,
          translations, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
          priority = excluded.priority,
          show_in_hero = excluded.show_in_hero,
          row_enabled = excluded.row_enabled,
          row_title = excluded.row_title,
          row_subtitle = excluded.row_subtitle,
          row_icon = excluded.row_icon,
          row_filter_tags = excluded.row_filter_tags,
          row_filter_type = excluded.row_filter_type,
          row_filter_source = excluded.row_filter_source,
          row_filter_author = excluded.row_filter_author,
          row_filter_query = excluded.row_filter_query,
          row_pinned_packages = excluded.row_pinned_packages,
          row_sort_by = excluded.row_sort_by,
          row_show_empty_cta = excluded.row_show_empty_cta,
          translations = excluded.translations
      `).bind(
        id,
        title,
        shortDesc,
        bannerUrl || '/promo.png',
        ctaLabel,
        ctaUrl || defaultRowCtaUrl,
        secondaryCtaLabelRaw || null,
        secondaryCtaUrl || null,
        badgeText,
        startsAtIso,
        expiresAtIso,
        priority,
        showInHero ? 1 : 0,
        rowEnabled ? 1 : 0,
        rowTitle || null,
        rowSubtitle || null,
        rowIcon,
        rowFilterTags.length > 0 ? JSON.stringify(rowFilterTags) : null,
        rowFilterType,
        rowFilterSource,
        rowFilterAuthor || null,
        rowFilterQuery || null,
        rowPinnedPackages.length > 0 ? JSON.stringify(rowPinnedPackages) : null,
        rowSortBy,
        rowShowEmptyCta ? 1 : 0,
        translationsJson,
        username
      ).run();

    try {
      await runPromoUpsert();
    } catch (upsertErr: any) {
      if (/has no column named|no such column|no such table/i.test(String(upsertErr?.message || ''))) {
        await ensurePromotionAndTagTables(env.DB, true);
        await runPromoUpsert();
      } else {
        throw upsertErr;
      }
    }

    if (rowFilterTags.length > 0) {
      await upsertCustomAppTags(env.DB, rowFilterTags, 'custom');
    }

    const res = await env.DB.prepare(
      `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
    ).all();
    const allRows = (Array.isArray(res?.results) ? res.results : []).map((r: any) => normalizePromotionRow(r));
    const activePromotions = filterActivePromotions(allRows);
    setLastKnownActivePromotions(activePromotions);
    await writeEdgeCacheJson('/__active_promotions_v1', activePromotions, 21600);
    await invalidateEdgeCacheKeys([
      '/__active_promotions_v1',
      '/__unified_tags_v1',
      BOOT_CATALOG_EDGE_CACHE_KEY
    ]);

    return Response.json(
      {
        success: true,
        promotion: allRows.find((r: any) => r.id === id) || null,
        promotions: allRows,
        activePromotions
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Unable to save promotion.') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

// DELETE /api/promotions: Delete or end a promotion (Admin-only)
export async function onRequestDelete(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const { isAdmin } = await resolveAdminSession(request, env);
  if (!isAdmin) {
    return Response.json(
      { error: 'Admin privileges required.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!env.DB) {
    return Response.json(
      { error: 'Database not available.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const url = new URL(request.url);
    let id = (url.searchParams.get('id') || '').trim();
    if (!id) {
      const body: any = await request.json().catch(() => null);
      id = String(body?.id || '').trim();
    }
    if (!id) {
      return Response.json(
        { error: 'Promotion ID is required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    try {
      await env.DB.prepare(`DELETE FROM hero_promotions WHERE id = ?`).bind(id).run();
    } catch (delErr: any) {
      if (/no such table|no such column/i.test(String(delErr?.message || ''))) {
        await ensurePromotionAndTagTables(env.DB, true);
        await env.DB.prepare(`DELETE FROM hero_promotions WHERE id = ?`).bind(id).run();
      } else {
        throw delErr;
      }
    }

    const res = await env.DB.prepare(
      `SELECT * FROM hero_promotions ORDER BY priority DESC, created_at DESC LIMIT 50`
    ).all();
    const allRows = (Array.isArray(res?.results) ? res.results : []).map((r: any) => normalizePromotionRow(r));
    const activePromotions = filterActivePromotions(allRows);
    setLastKnownActivePromotions(activePromotions);
    await writeEdgeCacheJson('/__active_promotions_v1', activePromotions, 21600);
    await invalidateEdgeCacheKeys([
      '/__active_promotions_v1',
      BOOT_CATALOG_EDGE_CACHE_KEY
    ]);

    return Response.json(
      {
        success: true,
        promotions: allRows,
        activePromotions
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Unable to delete promotion.') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

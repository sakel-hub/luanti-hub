export type PackageType = 'mod' | 'game' | 'txp' | 'modpack';
export type PackageSource = 'official' | 'git' | 'mirror';
export type GitProvider = 'codeberg' | 'mesehub' | 'gitlab' | 'github' | 'bitbucket' | 'contentdb' | 'forums' | 'custom';
export type SortOption = 'downloads' | 'score' | 'created' | 'updated' | 'title';

export interface ContentDbTag {
  name: string;
  title: string;
}

export interface LuantiHubBadgeTagOption {
  name: string;
  title: string;
  tooltip: string;
  icon: 'leaf';
}

export type PromoRowIcon = 'trophy' | 'sparkles' | 'flame' | 'gamepad' | 'star' | 'rocket';
export type PromoRowSortOption = 'newest' | 'downloads' | 'rating' | 'trending';

export interface PromotionLocaleOverride {
  title?: string;
  short_desc?: string;
  badge_text?: string;
  cta_label?: string;
  secondary_cta_label?: string;
  row_title?: string;
  row_subtitle?: string;
}

export interface HeroPromotion {
  id: string;
  title: string;
  short_desc: string;
  banner_url: string;
  cta_label: string;
  cta_url: string;
  secondary_cta_label?: string | null;
  secondary_cta_url?: string | null;
  badge_text: string;
  starts_at: string; // ISO-8601 UTC timestamp
  expires_at: string; // ISO-8601 UTC timestamp
  priority?: number;
  show_in_hero?: boolean | number; // Defaults to true; when false, only renders as Promotional Package Row #1
  row_enabled?: boolean | number; // When true, renders as Swimlane Row #1 below Hero Banner
  row_title?: string | null;
  row_subtitle?: string | null;
  row_icon?: PromoRowIcon | null;
  row_filter_tags?: string[] | string | null;
  row_filter_type?: 'all' | 'game' | 'mod' | 'txp' | null;
  row_filter_source?: 'all' | 'official' | 'git' | null;
  row_filter_author?: string | null;
  row_filter_query?: string | null;
  row_pinned_packages?: string[] | string | null;
  row_sort_by?: PromoRowSortOption | null;
  row_show_empty_cta?: boolean | number;
  translations?: Record<string, PromotionLocaleOverride> | string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface PromotionalPackageRow {
  promotion: HeroPromotion;
  title: string;
  subtitle: string;
  badgeText: string;
  icon: PromoRowIcon;
  packages: LuantiPackage[];
  filterTags: string[];
  ctaLabel: string;
  ctaUrl: string;
  secondaryCtaLabel?: string | null;
  secondaryCtaUrl?: string | null;
  showEmptyCta: boolean;
}

export interface LuantiBlogPost {
  id: string;
  title: string;
  summary: string;
  content_html?: string;
  url: string;
  image_url: string;
  published_at: string;
  author?: string;
}

export interface LuantiPackage {
  id: string; // "author/name"
  author: string;
  author_display_name?: string; // Creator profile display name when registered or linked across ContentDB/Git handles
  author_id?: string; // Verified D1 user ID when claimed by a registered author
  name: string; // technical name from mod.conf
  title: string; // Display title
  type: PackageType;
  short_desc: string;
  desc?: string;
  readme?: string;
  thumbnail: string;
  banner?: string;
  screenshots?: string[];
  screenshot_meta?: Array<{
    url: string;
    title?: string;
    width?: number;
    height?: number;
    is_cover_image?: boolean;
  }>;
  score: number; // 1.0 - 5.0 star rating (when reviews exist)
  contentdb_score?: number; // Raw ContentDB composite popularity + review score (e.g. 15 - 4000+)
  luantihub_score_downloads?: number; // Native Luanti Hub rolling download velocity/frecency score
  contentdb_score_downloads?: number; // Upstream ContentDB 15-day frecency download velocity (complementary)
  score_downloads?: number; // Unified Luanti Hub + ContentDB rolling download velocity score
  score_reviews?: number; // Unified Luanti Hub + ContentDB review & favorites sentiment score
  downloads: number; // Total aggregated downloads (contentdb_downloads + luantihub_downloads)
  contentdb_downloads?: number; // Upstream ContentDB downloads count
  luantihub_downloads?: number; // Native Luanti Hub downloads count
  daily_downloads?: number; // 24-hour download velocity (in-game + web)
  weekly_downloads?: number; // 7-day download velocity (in-game + web)
  weekly_views?: number; // 7-day package views (in-game + web)
  conversion_rate?: number; // Smoothed view-to-download conversion rate (0.0 - 1.0)
  dependency_ratio?: number; // Share of tracked downloads triggered as a dependency (0.0 - 1.0)
  reverse_dep_count?: number; // Number of other catalog packages listing this package as a hard dependency
  rating_checked?: boolean; // True when star rating / review thread counts have been verified
  favorites_count?: number; // Community favorites count in D1
  license: string;
  media_license?: string;
  repo_url?: string;
  git_repo_status?: 'verified' | 'broken_404' | 'unverified';
  website?: string;
  issue_tracker?: string;
  forums?: string;
  forum_url?: string;
  donate_url?: string;
  translation_url?: string;
  video_url?: string;
  video_thumbnail_url?: string;
  provider?: GitProvider;
  default_branch?: string;
  source: PackageSource;
  sources?: PackageSource[];
  tags: string[];
  badge_tags?: string[];
  maintainers?: string[];
  provides?: string[];
  dev_state?: string;
  content_warnings?: string[];
  ai_disclosures?: string[];
  review_thread_counts?: {
    positive: number;
    neutral: number;
    negative: number;
  };
  reviews_list?: CommunityReview[];
  supports_all_games?: boolean;
  game_support?: Array<{
    supports: boolean;
    confidence?: number;
    game: {
      id: string;
      author: string;
      name: string;
      title: string;
      thumbnail?: string;
      short_description?: string;
    };
  }>;
  min_minetest_version?: string;
  max_minetest_version?: string;
  translations?: Record<string, {
    title?: string;
    short_desc?: string;
    desc?: string;
  }>;
  featured?: boolean;
  dependencies?: string[];
  optional_dependencies?: string[];
  download_size?: number;
  file_size?: string;
  download_url?: string;
  release_id?: number | string;
  latest_commit_sha?: string;
  created_at?: string;
  updated_at?: string;
  status?: 'active' | 'flagged' | 'delisted';
  moderation_reason?: string;
  _searchBlob?: string; // Pre-computed lowercase search string for O(1) filtering
  _promo?: HeroPromotion; // Attached when synthetic Hero Carousel slide represents an active promotion
  _unhydratedSeed?: boolean; // True on synthetic 0ms route placeholders before catalog/API hydration
}

export interface PackageRelease {
  id: number | string;
  version: string;
  tag_name: string;
  commit_sha: string;
  download_url: string;
  file_size?: string;
  size?: number | string;
  downloads?: number;
  release_notes?: string;
  sha256?: string;
  min_minetest_version?: string;
  max_minetest_version?: string;
  changelog?: string;
  released_at: string;
}

export interface ReleaseCommitItem {
  sha: string;
  short_sha: string;
  title: string;
  message?: string;
  author_name: string;
  committed_at: string;
  url?: string;
}

export interface ReleaseNotesPayload {
  source: 'compare' | 'commits' | 'release_notes' | 'metadata';
  head_ref: string;
  base_ref?: string;
  compare_url?: string;
  resolved_default_branch?: string;
  markdown_body?: string;
  commits: ReleaseCommitItem[];
}

export interface PackageModalFocusRequest {
  packageId: string;
  section: 'reviews' | 'releases';
  reviewId?: string;
  expandReleaseNotes?: boolean;
  ts: number;
}

export interface CommunityReview {
  id: string;
  package_id: string;
  source: 'contentdb' | 'luantihub';
  rating: number; // 1 to 5
  is_positive?: boolean;
  title?: string;
  comment: string;
  created_at: string;
  votes?: {
    helpful: number;
    unhelpful: number;
  };
  thread_url?: string;
  author: {
    username: string;
    display_name?: string;
    avatar_url: string;
  };
}

export interface UserIdentity {
  provider: GitProvider;
  username: string;
  profile_url?: string;
  avatar_url?: string;
  verified?: boolean;
}

export interface AuthorGitSyncSummary {
  totalContentDbPackages: number;
  alreadySyncedCount: number;
  pendingQueueCount: number;
  skippedNoRepoCount: number;
  brokenReportCount: number;
  conflictCount?: number;
}

export interface PublicAuthorProfile {
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  rank?: string;
  website_url?: string;
  forums_username?: string;
  created_at?: string;
  is_registered?: boolean;
  identities: UserIdentity[];
  donate_url?: string;
  contentdb_url?: string;
  git_sync?: AuthorGitSyncSummary;
}

export interface AuthUser {
  id: string;
  username: string;
  display_name?: string;
  avatar_url: string;
  bio?: string;
  role?: 'user' | 'admin';
  is_admin?: boolean;
  open_reports_count?: number;
  created_at?: string;
  identities: UserIdentity[];
  packages?: LuantiPackage[];
  favorites?: string[];
  downloads?: Record<string, number>;
  notification_digest?: {
    user_alerts?: ModerationReport[];
    my_reports_total?: number;
    admin_latest_open?: ModerationReport[];
    latest_git_packages?: Array<Partial<LuantiPackage>>;
    recently_updated_packages?: Array<Partial<LuantiPackage>>;
    latest_reviews?: Array<{
      id: string | number;
      package_id: string;
      package_title?: string;
      package_type?: string;
      package_thumbnail?: string;
      rating: number;
      comment: string;
      created_at: string;
      reviewer_username?: string;
      reviewer_display_name?: string;
    }>;
  };
}

export interface GitAuditDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'pass';
  file: string;
  line?: number;
  title: string;
  message: string;
  howToFix?: string;
  snippet?: string;
}

export interface GitAuditReport {
  valid: boolean;
  auditToken?: string;
  ownershipVerified?: boolean;
  pendingAdminClaim?: boolean;
  requiredProvider?: GitProvider;
  repoOwner?: string;
  configFound: string | null;
  luacheckPassed: boolean;
  licenseValid: boolean;
  contentSafetyHold?: boolean;
  diagnostics: GitAuditDiagnostic[];
  metadata?: {
    author: string;
    name: string;
    title: string;
    type: PackageType;
    short_desc: string;
    license: string;
    media_license: string;
    min_minetest_version: string;
    max_minetest_version?: string;
    supported_games?: string[];
    unsupported_games?: string[];
    tags?: string[];
    badge_tags?: string[];
    dependencies: string[];
    optional_dependencies: string[];
    provider: GitProvider;
    default_branch: string;
  };
}

export interface ModerationReport {
  id: string;
  package_id: string;
  reporter_id?: string | null;
  reporter_user_id?: string | null;
  reporter_username?: string | null;
  reason: string;
  details?: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  package_title?: string;
  package_thumbnail?: string | null;
  package_author?: string;
  package_name?: string;
  package_status?: 'active' | 'flagged' | 'delisted';
}

export interface AnalyticsSummary {
  periodDownloads: number;
  prevPeriodDownloads: number;
  trendPercent: number;
  avgPerDay: number;
  totalViews: number;
  viewsLuanti: number;
  viewsWeb: number;
  conversionRatePercent: number;
  reasonsTotal: {
    new: number;
    update: number;
    dependency: number;
    web: number;
  };
  platformsTotal: {
    luanti: number;
    web: number;
  };
  sourcesTotal: {
    contentdb: number;
    luantihub: number;
  };
}

export interface AuthorPackageBreakdownItem {
  id: string;
  author: string;
  name: string;
  title: string;
  type: string;
  totalPeriodDownloads: number;
  sharePercent: number;
  daily: number[];
}

export interface DownloadAnalyticsData {
  package_id?: string;
  username?: string;
  author?: string;
  name?: string;
  title?: string;
  days: number;
  dates: string[];
  total: number[];
  source_contentdb: number[];
  source_luantihub: number[];
  platform_luanti: number[];
  platform_web: number[];
  reason_new: number[];
  reason_update: number[];
  reason_dependency: number[];
  reason_web: number[];
  views_luanti: number[];
  views_web: number[];
  package_breakdown?: AuthorPackageBreakdownItem[];
  summary: AnalyticsSummary;
}

function decodeHtmlAndXmlEntities(input: string): string {
  if (!input) return '';
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”'
  };
  let out = input;
  for (let pass = 0; pass < 2; pass++) {
    const next = out.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z0-9]+));/g, (full, dec, hex, name) => {
      if (dec) {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
      }
      if (hex) {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : full;
      }
      if (name && name in named) {
        return named[name];
      }
      return full;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function resolveBlogAssetUrl(rawUrl?: string | null): string | null {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  try {
    const resolved = new URL(trimmed, 'https://blog.luanti.org');
    if (resolved.protocol === 'https:' || resolved.protocol === 'http:') {
      return resolved.toString();
    }
  } catch {
    // ignore malformed URL
  }
  return null;
}

function extractCleanBlogSummary(rawHtmlOrText: string, maxLength = 220): string {
  if (!rawHtmlOrText) return '';
  const unescapedHtml = decodeHtmlAndXmlEntities(rawHtmlOrText);
  const withoutBlocks = unescapedHtml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|figure|figcaption|pre|code|svg|table)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const cleanText = decodeHtmlAndXmlEntities(withoutBlocks)
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanText.length <= maxLength) {
    return cleanText;
  }
  const sliced = cleanText.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? sliced.slice(0, lastSpace) : sliced).replace(/[.,;:!?-]+$/, '')}…`;
}

function extractFirstImageFromHtml(rawHtml: string): string | null {
  if (!rawHtml) return null;
  const unescaped = decodeHtmlAndXmlEntities(rawHtml);
  const imgMatch = unescaped.match(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/i);
  return imgMatch?.[1] ? resolveBlogAssetUrl(imgMatch[1]) : null;
}

/**
 * Sanitizes and formats raw HTML from the official Luanti Blog feed (`feed.json` / `feed.rss`)
 * for safe, styled rendering inside the in-app Luanti Blog Article Dialog.
 */
export function sanitizeAndFormatBlogHtml(rawHtml?: string | null, heroImageUrl?: string | null): string {
  if (!rawHtml) return '';
  let html = String(rawHtml)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .trim();
  if (!html) return '';

  // Decode entity-escaped HTML tags when coming from XML-escaped RSS <description>
  if (!/<[a-zA-Z]/.test(html) && /&lt;[a-zA-Z]/.test(html)) {
    html = decodeHtmlAndXmlEntities(html);
  }

  // Strip dangerous elements and inline event handlers
  html = html
    .replace(/<(script|style|iframe|object|embed|applet|form|input|button|textarea|select|meta|link|base)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|applet|form|input|button|textarea|select|meta|link|base)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Rewrite relative src/poster URLs on media elements and add lazy loading to images
  html = html.replace(/<img\b([^>]*)>/gi, (_full, attrs: string) => {
    let updatedAttrs = attrs.replace(
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
      (srcFull, d, s, u) => {
        const rawSrc = d ?? s ?? u ?? '';
        const resolved = resolveBlogAssetUrl(decodeHtmlAndXmlEntities(rawSrc));
        return resolved ? `src="${resolved}"` : srcFull;
      }
    );
    if (!/\bloading\s*=/i.test(updatedAttrs)) {
      updatedAttrs += ' loading="lazy" decoding="async"';
    }
    return `<img${updatedAttrs}>`;
  });

  // Rewrite relative href URLs on anchor tags and ensure external links open safely in a new tab
  html = html.replace(/<a\b([^>]*)>/gi, (_full, attrs: string) => {
    let resolvedHref = '';
    let updatedAttrs = attrs.replace(
      /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
      (_hrefFull, d, s, u) => {
        const rawHref = (d ?? s ?? u ?? '').trim();
        if (!rawHref || /^(javascript|data|vbscript):/i.test(rawHref)) {
          return 'href="#"';
        }
        if (rawHref.startsWith('#') || /^mailto:/i.test(rawHref)) {
          resolvedHref = rawHref;
          return `href="${rawHref}"`;
        }
        const resolved = resolveBlogAssetUrl(decodeHtmlAndXmlEntities(rawHref));
        resolvedHref = resolved || '#';
        return `href="${resolvedHref}"`;
      }
    );
    if (resolvedHref && !resolvedHref.startsWith('#')) {
      updatedAttrs = updatedAttrs
        .replace(/\btarget\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\brel\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      updatedAttrs += ' target="_blank" rel="noopener noreferrer"';
    }
    return `<a${updatedAttrs}>`;
  });

  // Strip duplicate leading hero banner image/figure if it matches the dialog cover image
  if (heroImageUrl) {
    const normalizedHero = resolveBlogAssetUrl(heroImageUrl) || heroImageUrl;
    const leadingFigureMatch = html.match(/^\s*<figure\b[^>]*>[\s\S]*?<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/figure>\s*/i);
    if (leadingFigureMatch?.[1] && leadingFigureMatch[1] === normalizedHero) {
      html = html.slice(leadingFigureMatch[0].length).trim();
    } else {
      const leadingImgMatch = html.match(/^\s*(?:<p>\s*)?<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:\s*<\/p>)?\s*/i);
      if (leadingImgMatch?.[1] && leadingImgMatch[1] === normalizedHero) {
        html = html.slice(leadingImgMatch[0].length).trim();
      }
    }
  }

  return html.trim();
}

/**
 * Parses either the official Luanti Blog RSS 2.0 feed (`https://blog.luanti.org/feed.rss`)
 * or JSON Feed (`https://blog.luanti.org/feed.json`) and returns the latest article metadata.
 */
export function parseLuantiBlogFeed(rawText: string): LuantiBlogPost | null {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;

  // 1. JSON Feed (`feed.json`) format
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const first = items[0];
      if (!first) return null;
      const url = resolveBlogAssetUrl(first.url || first.external_url || first.id);
      const title = decodeHtmlAndXmlEntities(String(first.title || '').trim());
      if (!url || !title) return null;

      const rawHtml = String(first.content_html || first.summary || first.content_text || '');
      const summary =
        extractCleanBlogSummary(first.summary || first.content_text || rawHtml) ||
        'Read the latest official announcement and development update on the Luanti Blog.';
      const attachmentImg = Array.isArray(first.attachments)
        ? first.attachments.find(
            (a: any) =>
              String(a?.mime_type || '').toLowerCase().startsWith('image/') ||
              /\.(webp|png|jpe?g|gif|avif)$/i.test(String(a?.url || ''))
          )?.url
        : undefined;
      const imageUrl =
        resolveBlogAssetUrl(first.image || first.banner_image || attachmentImg) ||
        extractFirstImageFromHtml(rawHtml) ||
        '/screenshot-desktop.png';
      const contentHtml = sanitizeAndFormatBlogHtml(rawHtml, imageUrl);
      const pubTime = Date.parse(String(first.date_published || first.date_modified || ''));
      const publishedAt = Number.isFinite(pubTime) && pubTime > 0
        ? new Date(pubTime).toISOString()
        : new Date().toISOString();
      const authorName =
        typeof first.author?.name === 'string'
          ? first.author.name.trim()
          : Array.isArray(first.authors) && typeof first.authors[0]?.name === 'string'
            ? first.authors[0].name.trim()
            : undefined;

      return {
        id: String(first.id || url).trim(),
        title,
        summary,
        ...(contentHtml ? { content_html: contentHtml } : {}),
        url,
        image_url: imageUrl,
        published_at: publishedAt,
        ...(authorName ? { author: authorName } : {})
      };
    } catch {
      return null;
    }
  }

  // 2. RSS 2.0 XML (`feed.rss`) format
  const itemMatch = trimmed.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  if (!itemMatch?.[1]) return null;
  const itemXml = itemMatch[1];

  const extractTag = (tag: string): string => {
    const m = itemXml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m?.[1]) return '';
    return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1').trim();
  };

  const rawTitle = extractTag('title');
  const rawLink = extractTag('link') || extractTag('guid');
  const rawGuid = extractTag('guid') || rawLink;
  const rawDesc = extractTag('content:encoded') || extractTag('description');
  const rawPubDate = extractTag('pubDate') || extractTag('dc:date');
  const rawAuthor = extractTag('dc:creator') || extractTag('author');

  const title = decodeHtmlAndXmlEntities(rawTitle).trim();
  const url = resolveBlogAssetUrl(decodeHtmlAndXmlEntities(rawLink));
  if (!title || !url) return null;

  const enclosureMatch =
    itemXml.match(/<enclosure\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i) ||
    itemXml.match(/<media:content\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i);
  const enclosureUrl = enclosureMatch?.[1] ? resolveBlogAssetUrl(decodeHtmlAndXmlEntities(enclosureMatch[1])) : null;
  const imageUrl = enclosureUrl || extractFirstImageFromHtml(rawDesc) || '/screenshot-desktop.png';

  const summary =
    extractCleanBlogSummary(rawDesc) ||
    'Read the latest official announcement and development update on the Luanti Blog.';
  const contentHtml = sanitizeAndFormatBlogHtml(rawDesc, imageUrl);

  const pubTime = Date.parse(rawPubDate);
  const publishedAt = Number.isFinite(pubTime) && pubTime > 0
    ? new Date(pubTime).toISOString()
    : new Date().toISOString();

  const cleanAuthor = decodeHtmlAndXmlEntities(rawAuthor).trim();

  return {
    id: decodeHtmlAndXmlEntities(rawGuid || url).trim(),
    title,
    summary,
    ...(contentHtml ? { content_html: contentHtml } : {}),
    url,
    image_url: imageUrl,
    published_at: publishedAt,
    ...(cleanAuthor ? { author: cleanAuthor } : {})
  };
}

/**
 * Enriches a parsed `LuantiBlogPost` with the full rendered `<article class="content">` HTML
 * from the article webpage on `blog.luanti.org` (`_layouts/post.html`), which includes
 * Jekyll frontmatter footers (`Cover image by ...` and `Thanks to our post contributors this month: ...`)
 * as well as `Written by ...` author attribution and hero cover image metadata that are omitted from `feed.rss` / `feed.json`.
 */
export function enrichLuantiBlogPostFromArticleHtml(
  post: LuantiBlogPost,
  articlePageHtml?: string | null
): LuantiBlogPost {
  if (!post || !articlePageHtml || typeof articlePageHtml !== 'string') {
    return post;
  }

  let bestImageUrl = post.image_url;
  const isFallbackImg =
    !bestImageUrl ||
    bestImageUrl === '/screenshot-desktop.png' ||
    bestImageUrl === '/promo.png' ||
    bestImageUrl.includes('luanti-5-18-0');
  if (isFallbackImg) {
    const heroBgMatch = articlePageHtml.match(/class=["'][^"']*\bhero-image\b[^"']*["'][^>]*style=["'][^"']*url\((?:['"]?)([^'")]+)(?:['"]?)\)/i);
    const jsonLdImgMatch = articlePageHtml.match(/"@type"\s*:\s*"BlogPosting"[\s\S]*?"image"\s*:\s*"([^"]+)"/i);
    const extractedImg = resolveBlogAssetUrl(heroBgMatch?.[1] || jsonLdImgMatch?.[1]);
    if (extractedImg) {
      bestImageUrl = extractedImg;
    }
  }

  let bestAuthor = post.author;
  if (!bestAuthor) {
    const subtitleMatch = articlePageHtml.match(/<header\b[^>]*class=["'][^"']*\bhero\b[\s\S]*?<p\b[^>]*class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    if (subtitleMatch?.[1]) {
      const subtitleText = decodeHtmlAndXmlEntities(
        subtitleMatch[1]
          .replace(/<br\b[^>]*>[\s\S]*$/i, '')
          .replace(/<[^>]+>/g, ' ')
      )
        .replace(/\s+/g, ' ')
        .trim();
      const writtenByMatch = subtitleText.match(/^Written by\s+(.+)$/i);
      if (writtenByMatch?.[1]) {
        bestAuthor = writtenByMatch[1].trim();
      }
    }
  }

  const articleMatch =
    articlePageHtml.match(/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i) ||
    articlePageHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);

  let enrichedContentHtml = post.content_html;
  if (articleMatch?.[1]) {
    const sanitizedArticle = sanitizeAndFormatBlogHtml(articleMatch[1], bestImageUrl);
    if (sanitizedArticle) {
      enrichedContentHtml = sanitizedArticle;
    }
  } else {
    const creditMatch = articlePageHtml.match(/<p\b[^>]*class=["'][^"']*\bhas-text-grey\b[^"']*["'][^>]*>[\s\S]*?Cover image by[\s\S]*?<\/p>/i);
    if (creditMatch?.[0] && enrichedContentHtml && !enrichedContentHtml.includes('Cover image by')) {
      const sanitizedCredit = sanitizeAndFormatBlogHtml(creditMatch[0], bestImageUrl);
      if (sanitizedCredit) {
        enrichedContentHtml = `${enrichedContentHtml}\n${sanitizedCredit}`;
      }
    }
  }

  return {
    ...post,
    image_url: bestImageUrl,
    ...(enrichedContentHtml ? { content_html: enrichedContentHtml } : {}),
    ...(bestAuthor ? { author: bestAuthor } : {})
  };
}



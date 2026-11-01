export type PackageType = 'mod' | 'game' | 'txp' | 'modpack';
export type PackageSource = 'official' | 'git' | 'mirror';
export type GitProvider = 'codeberg' | 'mesehub' | 'gitlab' | 'github' | 'contentdb' | 'forums' | 'custom';
export type SortOption = 'downloads' | 'score' | 'updated' | 'title';

export interface ContentDbTag {
  name: string;
  title: string;
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
  created_by?: string | null;
  created_at?: string;
}

export interface LuantiBlogPost {
  id: string;
  title: string;
  summary: string;
  url: string;
  image_url: string;
  published_at: string;
  author?: string;
}

export interface LuantiPackage {
  id: string; // "author/name"
  author: string;
  name: string; // technical name from mod.conf
  title: string; // Display title
  type: PackageType;
  short_desc: string;
  desc?: string;
  readme?: string;
  thumbnail: string;
  banner?: string;
  screenshots?: string[];
  score: number; // 1.0 - 5.0 star rating (when reviews exist)
  contentdb_score?: number; // Raw ContentDB composite popularity + review score (e.g. 15 - 4000+)
  downloads: number; // Total aggregated downloads (contentdb_downloads + luantihub_downloads)
  contentdb_downloads?: number; // Upstream ContentDB downloads count
  luantihub_downloads?: number; // Native Luanti Hub downloads count
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
  markdown_body?: string;
  commits: ReleaseCommitItem[];
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
      const imageUrl =
        resolveBlogAssetUrl(first.image || first.banner_image) ||
        extractFirstImageFromHtml(rawHtml) ||
        '/banners/luanti-5-18-0.png';
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
  const rawDesc = extractTag('description') || extractTag('content:encoded');
  const rawPubDate = extractTag('pubDate') || extractTag('dc:date');
  const rawAuthor = extractTag('dc:creator') || extractTag('author');

  const title = decodeHtmlAndXmlEntities(rawTitle).trim();
  const url = resolveBlogAssetUrl(decodeHtmlAndXmlEntities(rawLink));
  if (!title || !url) return null;

  const enclosureMatch =
    itemXml.match(/<enclosure\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i) ||
    itemXml.match(/<media:content\b[^>]*?\burl=["']([^"']+)["'][^>]*>/i);
  const enclosureUrl = enclosureMatch?.[1] ? resolveBlogAssetUrl(decodeHtmlAndXmlEntities(enclosureMatch[1])) : null;
  const imageUrl = enclosureUrl || extractFirstImageFromHtml(rawDesc) || '/banners/luanti-5-18-0.png';

  const summary =
    extractCleanBlogSummary(rawDesc) ||
    'Read the latest official announcement and development update on the Luanti Blog.';

  const pubTime = Date.parse(rawPubDate);
  const publishedAt = Number.isFinite(pubTime) && pubTime > 0
    ? new Date(pubTime).toISOString()
    : new Date().toISOString();

  const cleanAuthor = decodeHtmlAndXmlEntities(rawAuthor).trim();

  return {
    id: decodeHtmlAndXmlEntities(rawGuid || url).trim(),
    title,
    summary,
    url,
    image_url: imageUrl,
    published_at: publishedAt,
    ...(cleanAuthor ? { author: cleanAuthor } : {})
  };
}


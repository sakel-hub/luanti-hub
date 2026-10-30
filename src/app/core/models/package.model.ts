export type PackageType = 'mod' | 'game' | 'txp' | 'modpack';
export type PackageSource = 'official' | 'git' | 'mirror';
export type GitProvider = 'codeberg' | 'mesehub' | 'gitlab' | 'github' | 'contentdb' | 'custom';
export type SortOption = 'downloads' | 'score' | 'updated' | 'title';

export interface ContentDbTag {
  name: string;
  title: string;
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
  min_minetest_version?: string;
  max_minetest_version?: string;
  featured?: boolean;
  dependencies?: string[];
  optional_dependencies?: string[];
  download_size?: number;
  file_size?: string;
  download_url?: string;
  release_id?: number | string;
  created_at?: string;
  updated_at?: string;
  status?: 'active' | 'flagged' | 'delisted';
  moderation_reason?: string;
  _searchBlob?: string; // Pre-computed lowercase search string for O(1) filtering
}

export interface PackageRelease {
  id: number | string;
  version: string;
  tag_name: string;
  commit_sha: string;
  download_url: string;
  file_size?: string;
  size?: number | string;
  min_minetest_version?: string;
  max_minetest_version?: string;
  changelog?: string;
  released_at: string;
}

export interface CommunityReview {
  id: string;
  package_id: string;
  source: 'contentdb' | 'luantihub';
  rating: number; // 1 to 5
  title?: string;
  comment: string;
  created_at: string;
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

export type PackageType = 'mod' | 'game' | 'txp' | 'modpack';
export type PackageSource = 'official' | 'git' | 'mirror';
export type GitProvider = 'codeberg' | 'gitlab' | 'github' | 'contentdb';
export type SortOption = 'downloads' | 'score' | 'title';

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
  downloads: number;
  license: string;
  media_license?: string;
  repo_url?: string;
  git_repo_status?: 'verified' | 'broken_404' | 'unverified';
  website?: string;
  issue_tracker?: string;
  forums?: string;
  provider?: GitProvider;
  default_branch?: string;
  source: PackageSource;
  sources?: PackageSource[];
  tags: string[];
  maintainers?: string[];
  min_minetest_version?: string;
  max_minetest_version?: string;
  featured?: boolean;
  dependencies?: string[];
  optional_dependencies?: string[];
  file_size?: string;
  download_url?: string;
  release_id?: number | string;
  created_at?: string;
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
  reporter_username?: string | null;
  reason: string;
  details?: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
  package_title?: string;
  package_author?: string;
  package_name?: string;
  package_status?: 'active' | 'flagged' | 'delisted';
}

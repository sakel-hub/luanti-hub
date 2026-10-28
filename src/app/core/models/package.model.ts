export type PackageType = 'mod' | 'game' | 'txp' | 'modpack';
export type PackageSource = 'official' | 'git' | 'mirror';
export type GitProvider = 'codeberg' | 'gitlab' | 'github' | 'contentdb';

export interface LuantiPackage {
  id: string; // "author/name"
  author: string;
  name: string; // technical name from mod.conf
  title: string; // Display title
  type: PackageType;
  short_desc: string;
  desc?: string;
  thumbnail: string;
  banner?: string;
  score: number; // e.g. 4.8
  downloads: number;
  license: string;
  media_license?: string;
  repo_url?: string;
  provider?: GitProvider;
  default_branch?: string;
  source: PackageSource;
  tags: string[];
  maintainers?: string[];
  min_minetest_version?: string;
  max_minetest_version?: string;
  featured?: boolean;
  dependencies?: string[];
  optional_dependencies?: string[];
  file_size?: string;
}

export interface PackageRelease {
  id: number | string;
  version: string;
  tag_name: string;
  commit_sha: string;
  download_url: string;
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
  identities: UserIdentity[];
  packages?: any[];
}

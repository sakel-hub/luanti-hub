/**
 * Shared pure package normalization, sizing, rating, and video extraction utilities
 * used across both Cloudflare Pages Edge Functions (`functions/`) and Angular (`src/app/`).
 */

/**
 * Safely parses a JSON array column or comma-separated string into `string[]`.
 */
export function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string' && val.trim()) {
    const trimmed = val.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch {
        return [];
      }
      return [];
    }
    return trimmed
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Normalizes ContentDB `min_minetest_version` / `max_minetest_version` fields, which
 * `PackageRelease.as_dict()` returns as `{ name: "5.4", protocol_version: 39, is_dev: false }`
 * and `/for-client/` returns as `"5.4"`.
 */
export function extractEngineVersionString(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed && trimmed.toLowerCase() !== 'none' ? trimmed : undefined;
  }
  if (typeof val === 'object' && val !== null && typeof (val as any).name === 'string') {
    const trimmed = String((val as any).name).trim();
    return trimmed && trimmed.toLowerCase() !== 'none' ? trimmed : undefined;
  }
  return undefined;
}

/**
 * Parses a numeric byte count or human-readable size string (e.g. `"1.4 MB"`, `"350 KB"`) into integer bytes.
 */
export function parseDownloadSizeBytes(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.round(val) : 0;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    const match = trimmed.match(/^([\d.]+)\s*(gb|mb|kb|b)?$/i);
    if (match) {
      const num = Number(match[1]);
      if (!Number.isFinite(num) || num <= 0) return 0;
      const unit = (match[2] || 'b').toLowerCase();
      if (unit === 'gb') return Math.round(num * 1024 * 1024 * 1024);
      if (unit === 'mb') return Math.round(num * 1024 * 1024);
      if (unit === 'kb') return Math.round(num * 1024);
      return Math.round(num);
    }
  }
  return 0;
}

/**
 * Formats a numeric byte count or size string into a human-readable KB / MB label.
 */
export function formatByteSize(val: unknown): string | undefined {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '2 KB') return undefined;
    if (trimmed && /[a-zA-Z]/.test(trimmed) && !/^([\d.]+)\s*(gb|mb|kb|b)$/i.test(trimmed)) {
      return trimmed;
    }
  }
  const bytes = parseDownloadSizeBytes(val);
  if (bytes > 0) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return undefined;
}

export interface ReviewThreadCounts {
  positive: number;
  neutral: number;
  negative: number;
}

/**
 * Parses a `review_thread_counts` JSON string or object and returns it ONLY if it has at least one
 * non-zero thread count (`positive + neutral + negative > 0`).
 * Note: `{ positive: 0, neutral: 0, negative: 0 }` was injected by the static mirror `contentdb.milcho.org`
 * for all packages during failover and must never suppress live ContentDB review fetching or D1 backfill.
 */
export function parseNonZeroReviewThreadCounts(val: unknown): ReviewThreadCounts | undefined {
  if (!val) return undefined;
  let obj: any = val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed.startsWith('{')) return undefined;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const positive = Math.max(0, Number(obj.positive) || 0);
  const neutral = Math.max(0, Number(obj.neutral) || 0);
  const negative = Math.max(0, Number(obj.negative) || 0);
  if (positive + neutral + negative <= 0) return undefined;
  return { positive, neutral, negative };
}

/**
 * Derives `{ positive, neutral, negative }` thread counts from a normalized `reviews_list` array
 * when `Package.as_dict()` (`GET /api/packages/:author/:name/`) does not include a `reviews` summary object.
 */
export function deriveReviewThreadCountsFromList(
  reviewsList?: any[] | null
): ReviewThreadCounts | undefined {
  if (!Array.isArray(reviewsList) || reviewsList.length === 0) return undefined;
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const r of reviewsList) {
    if (!r || typeof r !== 'object') continue;
    const rating = Number(r.rating);
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      if (rating > 3) positive++;
      else if (rating === 3) neutral++;
      else negative++;
    } else if (r.is_positive === true || r.recommends === true) {
      positive++;
    } else if (r.is_positive === false || r.recommends === false) {
      negative++;
    } else {
      neutral++;
    }
  }
  if (positive + neutral + negative <= 0) return undefined;
  return { positive, neutral, negative };
}

/**
 * Computes a genuine 1.0 - 5.0 star rating from D1 reviews and/or ContentDB review arrays.
 * Returns 0 when no verified user star ratings exist.
 */
export function computeGenuineStarRating(
  d1RatingAvg?: number | null,
  cdbReviewsOrScore?: any
): number {
  const ratings: number[] = [];

  if (typeof d1RatingAvg === 'number' && d1RatingAvg >= 1 && d1RatingAvg <= 5) {
    ratings.push(d1RatingAvg);
  }

  if (Array.isArray(cdbReviewsOrScore) && cdbReviewsOrScore.length > 0) {
    const cdbScores = cdbReviewsOrScore
      .map((r: any) => (typeof r.rating === 'number' ? r.rating : r.is_positive === false ? 2 : 5))
      .filter((n: number) => n >= 1 && n <= 5);
    if (cdbScores.length > 0) {
      const avg = cdbScores.reduce((a: number, b: number) => a + b, 0) / cdbScores.length;
      ratings.push(avg);
    }
  } else if (typeof cdbReviewsOrScore === 'number' && cdbReviewsOrScore >= 1 && cdbReviewsOrScore <= 5) {
    ratings.push(cdbReviewsOrScore);
  }

  if (ratings.length === 0) return 0;
  const combined = ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length;
  return Math.round(combined * 10) / 10;
}

/**
 * Computes a 1.0 - 5.0 star rating from a package object (`reviews` thread counts or `score`),
 * optionally preferring an explicit D1 review average (`d1ReviewAvg`) or falling back to `fallbackScore`.
 */
export function computeStarRatingFromData(
  item: any,
  fallbackScore = 0,
  d1ReviewAvg?: number | null
): number {
  if (typeof d1ReviewAvg === 'number' && d1ReviewAvg >= 1 && d1ReviewAvg <= 5) {
    return Number(d1ReviewAvg.toFixed(1));
  }
  const explicitReviewScore = Number(item?.review_score ?? item?.luantihub_score ?? 0);
  if (Number.isFinite(explicitReviewScore) && explicitReviewScore >= 1 && explicitReviewScore <= 5) {
    return Number(explicitReviewScore.toFixed(1));
  }
  const rev = item?.reviews ?? item?.review_thread_counts;
  let hasExplicitZeroRevCounts = false;
  if (rev && typeof rev === 'object' && !Array.isArray(rev)) {
    const pos = Number(rev.positive) || 0;
    const neu = Number(rev.neutral) || 0;
    const neg = Number(rev.negative) || 0;
    const total = pos + neu + neg;
    if (total > 0) {
      const stars = (pos * 5 + neu * 3 + neg * 1) / total;
      return Number(Math.min(5.0, Math.max(1.0, stars)).toFixed(1));
    }
    if (rev.positive !== undefined || rev.neutral !== undefined || rev.negative !== undefined) {
      hasExplicitZeroRevCounts = true;
    }
  }
  const revList = Array.isArray(item?.reviews_list)
    ? item.reviews_list
    : Array.isArray(rev)
      ? rev
      : null;
  if (revList) {
    if (revList.length > 0) {
      let sum = 0;
      let count = 0;
      for (const r of revList) {
        if (!r || typeof r !== 'object') continue;
        const explicitRating = Number(r.rating);
        if (Number.isFinite(explicitRating) && explicitRating >= 1 && explicitRating <= 5) {
          sum += explicitRating;
          count++;
        } else if (typeof r.is_positive === 'boolean' || typeof r.recommends === 'boolean') {
          const pos = r.is_positive ?? r.recommends;
          sum += pos ? 5 : 1;
          count++;
        }
      }
      if (count > 0) {
        return Number(Math.min(5.0, Math.max(1.0, sum / count)).toFixed(1));
      }
    }
    return 0;
  }
  if (hasExplicitZeroRevCounts) {
    return 0;
  }
  // ContentDB payloads (`/api/scores/` and `/api/packages/<author>/<name>/`) expose `score = score_downloads + score_reviews`
  // (popularity points, NOT a 1-5 star rating). For brand-new packages with a few downloads and 0 reviews,
  // `score` falls in `[1.0, 5.0]` (e.g. `1` or `2`). Never mistake ContentDB popularity points or zero-review items for stars.
  const isRawCdbPayload =
    item?.contentdb_score === undefined &&
    (item?.score_downloads !== undefined ||
      item?.score_reviews !== undefined ||
      item?.short_description !== undefined);
  const hasZeroReviewScore =
    item?.score_reviews !== undefined && Number(item.score_reviews) <= 0;
  const isEchoingCdbScore =
    item?.contentdb_score !== undefined &&
    Number(item.contentdb_score) > 0 &&
    Number(item?.score) === Number(item.contentdb_score);
  if (isRawCdbPayload || hasZeroReviewScore || isEchoingCdbScore) {
    return hasZeroReviewScore ? 0 : fallbackScore;
  }
  if (item?.score !== undefined && item?.score !== null) {
    const rawScore = Number(item.score);
    if (rawScore === 0) {
      return 0;
    }
    if (rawScore >= 1.0 && rawScore <= 5.0) {
      return Number(rawScore.toFixed(1));
    }
  }
  return fallbackScore;
}

/**
 * Resolves `video_url` and `video_thumbnail_url` from explicit ContentDB/D1 fields,
 * falling back to extracting embedded YouTube, Vimeo, or direct `.mp4`/`.webm` showcase
 * links from `long_description` or `README.md` when `video_url` is not explicitly set.
 */
export function extractEmbeddedVideo(
  videoUrl?: string | null,
  videoThumbUrl?: string | null,
  longDesc?: string | null,
  readme?: string | null
): { video_url?: string; video_thumbnail_url?: string } {
  let resolvedVideo = typeof videoUrl === 'string' && videoUrl.trim() ? videoUrl.trim() : undefined;
  let resolvedThumb =
    typeof videoThumbUrl === 'string' && videoThumbUrl.trim() ? videoThumbUrl.trim() : undefined;

  if (!resolvedVideo) {
    const combinedText = `${longDesc || ''}\n${readme || ''}`;
    if (combinedText.trim()) {
      const ytMatch = combinedText.match(
        /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
      );
      if (ytMatch && ytMatch[1]) {
        resolvedVideo = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
        if (!resolvedThumb) {
          resolvedThumb = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        }
      } else {
        const directMatch = combinedText.match(
          /https?:\/\/[^\s"'<>)\]]+\.(?:mp4|webm)(?:\?[^\s"'<>)\]]*)?/i
        );
        if (directMatch && directMatch[0]) {
          resolvedVideo = directMatch[0];
        } else {
          const vimeoMatch = combinedText.match(
            /https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})/i
          );
          if (vimeoMatch && vimeoMatch[1]) {
            resolvedVideo = `https://vimeo.com/${vimeoMatch[1]}`;
          }
        }
      }
    }
  } else if (!resolvedThumb) {
    const ytMatch = resolvedVideo.match(
      /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/i
    );
    if (ytMatch && ytMatch[1]) {
      resolvedThumb = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }
  }

  return {
    video_url: resolvedVideo,
    video_thumbnail_url: resolvedThumb
  };
}

/**
 * Builds a map of technical package name (`lowercase`) -> count of other catalog packages
 * that list it as a hard dependency in `dependencies`.
 */
export function buildReverseDependencyCountMap(packages: Iterable<any>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    if (!pkg || typeof pkg !== 'object') continue;
    const selfName = String(pkg.name || '').trim().toLowerCase();
    const rawDeps = Array.isArray(pkg.dependencies)
      ? pkg.dependencies
      : parseJsonArray(pkg.dependencies);
    if (rawDeps.length === 0) continue;
    const seenInPkg = new Set<string>();
    for (const rawDep of rawDeps) {
      const depStr = String(rawDep || '').trim().toLowerCase();
      if (!depStr) continue;
      const depTechName = depStr.includes('/') ? depStr.split('/').pop()!.trim() : depStr;
      if (!depTechName || depTechName === selfName || seenInPkg.has(depTechName)) continue;
      seenInPkg.add(depTechName);
      counts.set(depTechName, (counts.get(depTechName) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Detects whether a package's tags, title, or description identify it as a developer API,
 * shared library, or pure dependency mod that does not add standalone gameplay on its own
 * (e.g. `TenPlus1/mobs` "Mobs Redo API", `modlib`, `futil`, `signs_lib`, `biome_lib`).
 */
export function isApiOrLibraryPackage(pkg: any): boolean {
  if (!pkg || typeof pkg !== 'object') return false;
  const type = String(pkg.type || 'mod').toLowerCase();
  if (type === 'game' || type === 'txp') return false;

  const rawTags = Array.isArray(pkg.tags) ? pkg.tags : parseJsonArray(pkg.tags);
  for (const t of rawTags) {
    const tagLower = String(t || '').trim().toLowerCase();
    if (tagLower === 'library' || tagLower === 'api' || tagLower === 'dev_tools') {
      return true;
    }
  }

  const title = String(pkg.title || '').trim();
  const shortDesc = String(pkg.short_desc || pkg.short_description || '').trim();
  const desc = String(pkg.desc || pkg.long_description || '').trim();
  const combinedDesc = `${shortDesc}\n${desc.slice(0, 600)}`;

  // Title explicitly ends with or features standalone API / Library / Lib indicator
  if (/\b(?:api|library|modlib|futil)\b/i.test(title)) {
    return true;
  }
  if (/(?:^|[\s_-])lib(?:$|[\s_-])/i.test(title) || /(?:^|_)(?:api|lib)$/i.test(String(pkg.name || ''))) {
    return true;
  }

  // Description explicitly states the mod is an API/library or requires other mods to do anything
  if (
    /\byou\s+need\s+to\s+install\s+some\s+other\s+mods\b/i.test(combinedDesc) ||
    /\bdoes\s+nothing\s+(?:on\s+its\s+own|by\s+itself)\b/i.test(combinedDesc) ||
    /\b(?:simple\s+and\s+feature[- ]rich|lightweight|shared|helper|utility|modding)\s+(?:api|library)\b/i.test(combinedDesc) ||
    /\bapi\s+(?:to\s+add|for\s+adding|for\s+other\s+mods|used\s+by\s+other\s+mods)\b/i.test(combinedDesc) ||
    /\b(?:library|framework)\s+(?:for|used\s+by)\s+(?:other\s+)?mods\b/i.test(combinedDesc)
  ) {
    return true;
  }

  return false;
}

/**
 * Computes a prioritization multiplier (`0.08` .. `1.0`) for Home package swimlanes,
 * Hero Showcase, and Top 10 rankings.
 *
 * Packages downloaded mostly or purely as dependencies (`dependency_ratio >= 0.5`) or
 * identified as underlying API/library mods receive a dampened multiplier so player-facing
 * games, mods, and texture packs take priority on the Home screen and Top 10.
 */
export function computeDependencyPrioritizationMultiplier(
  pkg: any,
  overrideDepRatio?: number,
  overrideReverseDepCount?: number
): number {
  if (!pkg || typeof pkg !== 'object') return 1.0;

  const depRatioRaw =
    typeof overrideDepRatio === 'number' && Number.isFinite(overrideDepRatio)
      ? overrideDepRatio
      : Number(pkg.dependency_ratio);
  const depRatio =
    Number.isFinite(depRatioRaw) && depRatioRaw > 0 ? Math.min(1, Math.max(0, depRatioRaw)) : 0;

  const reverseDepsRaw =
    typeof overrideReverseDepCount === 'number' && Number.isFinite(overrideReverseDepCount)
      ? overrideReverseDepCount
      : Number(pkg.reverse_dep_count);
  const reverseDeps =
    Number.isFinite(reverseDepsRaw) && reverseDepsRaw > 0 ? Math.floor(reverseDepsRaw) : 0;

  let multiplier = 1.0;

  // 1. Download-reason telemetry signal (package_daily_downloads.reason_dependency share)
  if (depRatio >= 0.75) {
    multiplier = Math.min(multiplier, 0.12);
  } else if (depRatio >= 0.5) {
    // Smoothly interpolate from 0.55 at depRatio=0.50 down to 0.15 at depRatio=0.75
    const t = (depRatio - 0.5) / 0.25;
    multiplier = Math.min(multiplier, Number((0.55 - t * 0.4).toFixed(3)));
  } else if (depRatio >= 0.3) {
    // Mild dampening from 0.90 at depRatio=0.30 down to 0.55 at depRatio=0.50
    const t = (depRatio - 0.3) / 0.2;
    multiplier = Math.min(multiplier, Number((0.9 - t * 0.35).toFixed(3)));
  }

  // 2. API / Library metadata & tag signal
  const isApiLib = isApiOrLibraryPackage(pkg);
  if (isApiLib) {
    if (reverseDeps >= 3 || depRatio >= 0.4) {
      multiplier = Math.min(multiplier, 0.1);
    } else {
      multiplier = Math.min(multiplier, 0.18);
    }
  } else if (reverseDeps >= 30 && String(pkg.type || 'mod').toLowerCase() === 'mod') {
    // High reverse-dependency foundational mod (e.g. basic_materials)
    multiplier = Math.min(multiplier, 0.45);
  }

  return multiplier;
}

/**
 * Returns `true` when a package is primarily a dependency or API/library mod
 * (`multiplier <= 0.25`) that should not occupy Hero Showcase or Top 10 slots
 * when standalone player-facing packages are available.
 */
export function isPrimarilyDependencyPackage(
  pkg: any,
  overrideDepRatio?: number,
  overrideReverseDepCount?: number
): boolean {
  return (
    computeDependencyPrioritizationMultiplier(pkg, overrideDepRatio, overrideReverseDepCount) <=
    0.25
  );
}

/**
 * Canonical LuantiHub Engine Versions registry (LuantiHub-first source of truth,
 * optionally enriched by ContentDB `/api/minetest_versions/` when online).
 */
export interface LuantiEngineVersionDef {
  name: string;
  label: string;
  title?: string;
  protocol_version: number;
  is_dev?: boolean;
}

export const LUANTIHUB_ENGINE_VERSIONS: LuantiEngineVersionDef[] = [
  { name: '5.12.0-dev', label: 'Luanti 5.12-dev', title: 'Luanti 5.12-dev', protocol_version: 48, is_dev: true },
  { name: '5.11.0', label: 'Luanti 5.11.0 (Latest)', title: 'Luanti 5.11.0 (Latest)', protocol_version: 47, is_dev: false },
  { name: '5.10.0', label: 'Luanti 5.10.0', title: 'Luanti 5.10.0', protocol_version: 46, is_dev: false },
  { name: '5.9.1', label: 'Luanti 5.9.1', title: 'Luanti 5.9.1', protocol_version: 45, is_dev: false },
  { name: '5.9.0', label: 'Luanti 5.9.0', title: 'Luanti 5.9.0', protocol_version: 44, is_dev: false },
  { name: '5.8.0', label: 'Minetest 5.8.0', title: 'Minetest 5.8.0', protocol_version: 43, is_dev: false },
  { name: '5.7.0', label: 'Minetest 5.7.0', title: 'Minetest 5.7.0', protocol_version: 42, is_dev: false },
  { name: '5.6.1', label: 'Minetest 5.6.1', title: 'Minetest 5.6.1', protocol_version: 41, is_dev: false },
  { name: '5.6.0', label: 'Minetest 5.6.0', title: 'Minetest 5.6.0', protocol_version: 41, is_dev: false },
  { name: '5.5.0', label: 'Minetest 5.5.0', title: 'Minetest 5.5.0', protocol_version: 40, is_dev: false },
  { name: '5.4.0', label: 'Minetest 5.4.0', title: 'Minetest 5.4.0', protocol_version: 39, is_dev: false },
  { name: '5.3.0', label: 'Minetest 5.3.0', title: 'Minetest 5.3.0', protocol_version: 39, is_dev: false },
  { name: '5.2.0', label: 'Minetest 5.2.0', title: 'Minetest 5.2.0', protocol_version: 38, is_dev: false },
  { name: '5.1.0', label: 'Minetest 5.1.0', title: 'Minetest 5.1.0', protocol_version: 38, is_dev: false },
  { name: '5.0.0', label: 'Minetest 5.0.0', title: 'Minetest 5.0.0', protocol_version: 37, is_dev: false },
  { name: '0.4.17', label: 'Minetest 0.4.17 (Legacy)', title: 'Minetest 0.4.17 (Legacy)', protocol_version: 32, is_dev: false }
];

/**
 * Canonical LuantiHub Development States (editable by package authors in D1).
 */
export const LUANTIHUB_DEV_STATES: Array<{ code: string; label: string; name: string; title: string }> = [
  { code: 'ACTIVELY_DEVELOPED', label: 'Actively Developed', name: 'ACTIVELY_DEVELOPED', title: 'Actively Developed' },
  { code: 'BETA', label: 'Beta / Playable', name: 'BETA', title: 'Beta / Playable' },
  { code: 'WIP', label: 'Work in Progress (WIP)', name: 'WIP', title: 'Work in Progress (WIP)' },
  { code: 'MAINTENANCE_ONLY', label: 'Maintenance Only', name: 'MAINTENANCE_ONLY', title: 'Maintenance Only' },
  { code: 'AS_IS', label: 'Released As-Is', name: 'AS_IS', title: 'Released As-Is' },
  { code: 'LOOKING_FOR_MAINTAINER', label: 'Looking for Maintainer', name: 'LOOKING_FOR_MAINTAINER', title: 'Looking for Maintainer' },
  { code: 'DEPRECATED', label: 'Deprecated', name: 'DEPRECATED', title: 'Deprecated' }
];

/**
 * Canonical LuantiHub Content Warnings (editable by package authors in D1; no AI disclosures).
 */
export const LUANTIHUB_CONTENT_WARNINGS: Array<{ name: string; title: string; description: string }> = [
  { name: 'violence', title: 'Violence', description: 'Contains combat, weapons, or non-graphic violence' },
  { name: 'gore', title: 'Gore / Blood', description: 'Contains blood or graphic violence' },
  { name: 'horror', title: 'Horror / Jumpscares', description: 'Contains scary themes, dark atmosphere, or jumpscares' },
  { name: 'spiders_and_insects', title: 'Spiders & Insects', description: 'Contains realistic or prominent spiders and insects' },
  { name: 'flashing_lights', title: 'Flashing Lights', description: 'Contains bright flashing lights or patterns' },
  { name: 'alcohol_tobacco', title: 'Alcohol / Tobacco', description: 'References or depicts alcohol, smoking, or substances' },
  { name: 'bad_language', title: 'Strong Language', description: 'Contains profanity or mature language' },
  { name: 'gambling', title: 'Gambling', description: 'Contains simulated betting, casinos, or loot-box mechanics' }
];

/**
 * Canonical LuantiHub Special Badge Tags (rendered on package tiles & headers with rich tooltips).
 */
export const ORGANIC_CODE_TAG = 'organic_code';
export const ORGANIC_CODE_LABEL = '100% Organic Code';
export const ORGANIC_CODE_TOOLTIP = 'Zero artificial additives. Grown with sunlight, coffee, and patience.';

export const LUANTIHUB_BADGE_TAGS: Array<{
  name: string;
  title: string;
  tooltip: string;
  icon: 'sprout';
}> = [
  {
    name: ORGANIC_CODE_TAG,
    title: ORGANIC_CODE_LABEL,
    tooltip: ORGANIC_CODE_TOOLTIP,
    icon: 'sprout'
  }
];

/**
 * Normalizes a `badge_tags` column/array into canonical lowercase badge tag IDs.
 */
export function parseBadgeTagsArray(val: unknown): string[] {
  const raw = parseJsonArray(val);
  const validSet = new Set(LUANTIHUB_BADGE_TAGS.map(b => b.name.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const clean = String(item || '').trim().toLowerCase();
    if (!clean) continue;
    const normalized =
      clean === '100% organic code' || clean === '100_organic_code' || clean === 'organic-code'
        ? ORGANIC_CODE_TAG
        : clean;
    if (validSet.has(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/**
 * Returns true if the package has the "100% Organic Code" badge tag enabled (either in `badge_tags` or `tags`).
 */
export function hasOrganicCodeTag(pkg?: { badge_tags?: unknown; tags?: unknown } | null): boolean {
  if (!pkg) return false;
  const badgeTags = parseBadgeTagsArray(pkg.badge_tags);
  if (badgeTags.includes(ORGANIC_CODE_TAG)) return true;
  const regularTags = parseJsonArray(pkg.tags).map(t => String(t || '').trim().toLowerCase());
  return (
    regularTags.includes(ORGANIC_CODE_TAG) ||
    regularTags.includes('100% organic code') ||
    regularTags.includes('organic-code')
  );
}

/**
 * Canonical LuantiHub Game Ecosystems used for author Game Support selection,
 * catalog filtering, and Preferred Game personalization.
 */
export interface CanonicalGameEcosystem {
  id: string;
  author: string;
  name: string;
  title: string;
  aliases: string[];
}

export const LUANTIHUB_POPULAR_GAMES: CanonicalGameEcosystem[] = [
  { id: 'Luanti/minetest_game', author: 'Luanti', name: 'minetest_game', title: 'Minetest Game', aliases: ['minetest_game', 'mtg', 'default'] },
  { id: 'Wuzzy/mineclone2', author: 'Wuzzy', name: 'mineclone2', title: 'VoxeLibre (MineClone2)', aliases: ['mineclone2', 'voxelibre', 'mcl'] },
  { id: 'ryvnf/mineclonia', author: 'ryvnf', name: 'mineclonia', title: 'Mineclonia', aliases: ['mineclonia', 'mcl_core'] },
  { id: 'Warr1024/nodecore', author: 'Warr1024', name: 'nodecore', title: 'NodeCore', aliases: ['nodecore', 'nc_api_all'] },
  { id: 'EmptyStar/asuna', author: 'EmptyStar', name: 'asuna', title: 'Asuna', aliases: ['asuna'] },
  { id: 'Wuzzy/repixture', author: 'Wuzzy', name: 'repixture', title: 'Repixture', aliases: ['repixture', 'rp_default'] },
  { id: 'Mantar/exile', author: 'Mantar', name: 'exile', title: 'Exile', aliases: ['exile'] },
  { id: 'rubenwardy/capturetheflag', author: 'rubenwardy', name: 'capturetheflag', title: 'Capture the Flag', aliases: ['capturetheflag', 'ctf'] }
];

export interface NormalizedGameSupportItem {
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
}

/**
 * Safely parses and normalizes a `game_support` JSON column or array, preserving both
 * compatible (`supports: true`) and explicitly incompatible (`supports: false`) entries.
 */
export function parseGameSupportArray(val: unknown): NormalizedGameSupportItem[] {
  if (!val) return [];
  let rawList: any[] = [];
  if (Array.isArray(val)) {
    rawList = val;
  } else if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed.startsWith('[')) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) rawList = parsed;
    } catch {
      return [];
    }
  }
  const out: NormalizedGameSupportItem[] = [];
  const seen = new Set<string>();
  for (const gs of rawList) {
    if (!gs || typeof gs !== 'object') continue;
    const g = gs.game && typeof gs.game === 'object' ? gs.game : gs;
    const rawAuthor = String(g.author || '').trim();
    const rawName = String(g.name || '').trim();
    const rawTitle = String(g.title || rawName || '').trim();
    if (!rawName && !rawTitle) continue;
    const canonical = LUANTIHUB_POPULAR_GAMES.find(
      cg =>
        cg.name.toLowerCase() === rawName.toLowerCase() ||
        cg.title.toLowerCase() === rawTitle.toLowerCase() ||
        cg.id.toLowerCase() === `${rawAuthor}/${rawName}`.toLowerCase()
    );
    const author = rawAuthor || canonical?.author || 'Luanti';
    const name = rawName || canonical?.name || rawTitle.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const title = rawTitle || canonical?.title || name;
    const id = String(g.id || `${author}/${name}`);
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      supports: gs.supports !== false,
      ...(typeof gs.confidence === 'number' ? { confidence: gs.confidence } : {}),
      game: {
        id,
        author,
        name,
        title,
        ...(typeof g.thumbnail === 'string' && g.thumbnail.trim() ? { thumbnail: g.thumbnail.trim() } : {}),
        ...(typeof g.short_description === 'string' && g.short_description.trim()
          ? { short_description: g.short_description.trim() }
          : typeof g.short_desc === 'string' && g.short_desc.trim()
            ? { short_description: g.short_desc.trim() }
            : {})
      }
    });
  }
  return out;
}

/**
 * Infers game ecosystem compatibility directly from a package's `mod.conf` dependencies
 * (LuantiHub-first heuristic for Git repositories without explicit `game_support` metadata).
 */
export function inferGameSupportFromDependencies(
  dependencies?: string[] | null,
  optionalDependencies?: string[] | null
): NormalizedGameSupportItem[] {
  const allDeps = [
    ...(Array.isArray(dependencies) ? dependencies : parseJsonArray(dependencies)),
    ...(Array.isArray(optionalDependencies) ? optionalDependencies : parseJsonArray(optionalDependencies))
  ].map(d => String(d || '').trim().toLowerCase());
  if (allDeps.length === 0) return [];

  const matchedGames = new Set<string>();
  for (const dep of allDeps) {
    if (dep === 'default' || dep === 'doors' || dep === 'farming' || dep === 'dye' || dep === 'wool' || dep === 'vessels' || dep === 'xpanes') {
      matchedGames.add('minetest_game');
    }
    if (dep.startsWith('mcl_')) {
      matchedGames.add('mineclone2');
      matchedGames.add('mineclonia');
    }
    if (dep.startsWith('nc_')) {
      matchedGames.add('nodecore');
    }
    if (dep.startsWith('rp_')) {
      matchedGames.add('repixture');
    }
    if (dep.startsWith('ctf_')) {
      matchedGames.add('capturetheflag');
    }
  }

  const out: NormalizedGameSupportItem[] = [];
  for (const gameName of matchedGames) {
    const canonical = LUANTIHUB_POPULAR_GAMES.find(g => g.name === gameName);
    if (canonical) {
      out.push({
        supports: true,
        confidence: 8,
        game: {
          id: canonical.id,
          author: canonical.author,
          name: canonical.name,
          title: canonical.title
        }
      });
    }
  }
  return out;
}

/**
 * Merges LuantiHub D1 `game_support` (primary source of truth) with ContentDB `game_support`
 * (complementary enrichment) and dependency-inferred games, preserving `supports: false` entries.
 */
export function mergeLuantiHubAndContentDbGameSupport(
  luantiHubSupport: unknown,
  contentDbSupport: unknown,
  dependencies?: string[] | null,
  optionalDependencies?: string[] | null
): NormalizedGameSupportItem[] {
  const primary = parseGameSupportArray(luantiHubSupport);
  const complement = parseGameSupportArray(contentDbSupport);
  const inferred = inferGameSupportFromDependencies(dependencies, optionalDependencies);

  const byGameName = new Map<string, NormalizedGameSupportItem>();
  for (const item of primary) {
    byGameName.set(item.game.name.toLowerCase(), item);
  }
  for (const item of complement) {
    const key = item.game.name.toLowerCase();
    const existing = byGameName.get(key);
    if (!existing) {
      byGameName.set(key, item);
    } else if (!existing.game.thumbnail && item.game.thumbnail) {
      byGameName.set(key, {
        ...existing,
        game: {
          ...existing.game,
          thumbnail: item.game.thumbnail,
          short_description: existing.game.short_description || item.game.short_description
        }
      });
    }
  }
  for (const item of inferred) {
    const key = item.game.name.toLowerCase();
    if (!byGameName.has(key)) {
      byGameName.set(key, item);
    }
  }
  return Array.from(byGameName.values());
}

/**
 * Computes LuantiHub-first velocity & frecency metrics (`luantihub_score_downloads`, `luantihub_score_reviews`)
 * directly from LuantiHub's native D1 telemetry and merges ContentDB `/api/scores/` (`score_downloads`, `score_reviews`)
 * as complementary signals when available.
 */
export function computeLuantiHubFrecencyMetrics(params: {
  dailyDownloads?: number;
  weeklyDownloads?: number;
  luantihubDownloads?: number;
  conversionRate?: number;
  score?: number;
  reviewThreadCounts?: ReviewThreadCounts | null;
  favoritesCount?: number;
  contentdbScore?: number;
  contentdbScoreDownloads?: number;
  contentdbScoreReviews?: number;
}): {
  luantihub_score_downloads: number;
  contentdb_score_downloads: number;
  score_downloads: number;
  score_reviews: number;
} {
  const daily = Math.max(0, Number(params.dailyDownloads) || 0);
  const weekly = Math.max(0, Number(params.weeklyDownloads) || 0);
  const lhTotal = Math.max(0, Number(params.luantihubDownloads) || 0);
  const conv = Math.max(0, Math.min(1, Number(params.conversionRate) || 0));
  const favs = Math.max(0, Number(params.favoritesCount) || 0);
  const stars = Number(params.score) || 0;

  // 1. LuantiHub Native Rolling Download Velocity Score (15-day / 7-day weighted frecency)
  const lhVelocityRaw =
    daily * 14 +
    weekly * 4.5 +
    Math.min(120, Math.sqrt(lhTotal) * 2.2) +
    conv * 35;
  const luantihubScoreDownloads = Math.round(lhVelocityRaw * 10) / 10;

  // 2. LuantiHub Native Review & Favorites Sentiment Score
  let lhReviewScore = 0;
  if (params.reviewThreadCounts) {
    const pos = Math.max(0, Number(params.reviewThreadCounts.positive) || 0);
    const neu = Math.max(0, Number(params.reviewThreadCounts.neutral) || 0);
    const neg = Math.max(0, Number(params.reviewThreadCounts.negative) || 0);
    lhReviewScore += pos * 20 + neu * 2 - neg * 15;
  } else if (stars >= 1 && stars <= 5) {
    lhReviewScore += (stars - 3.0) * 25;
  }
  if (favs > 0) {
    lhReviewScore += favs * 12;
  }

  // 3. Complementary ContentDB Metrics (if available)
  const cdbScoreDownloads = Math.max(0, Math.round((Number(params.contentdbScoreDownloads) || 0) * 10) / 10);
  const cdbScoreReviews = Number.isFinite(Number(params.contentdbScoreReviews))
    ? Math.round(Number(params.contentdbScoreReviews) * 10) / 10
    : 0;

  // 4. Unified Metrics (LuantiHub primary + ContentDB complement)
  const unifiedScoreDownloads = Math.round((luantihubScoreDownloads + cdbScoreDownloads) * 10) / 10;
  const unifiedScoreReviews = Math.round((lhReviewScore + cdbScoreReviews) * 10) / 10;

  return {
    luantihub_score_downloads: luantihubScoreDownloads,
    contentdb_score_downloads: cdbScoreDownloads,
    score_downloads: unifiedScoreDownloads,
    score_reviews: unifiedScoreReviews
  };
}

export interface PackageTranslationEntry {
  title?: string;
  short_desc?: string;
  desc?: string;
}

/**
 * Safely parses a `translations` JSON map (`Record<string, { title?: string; short_desc?: string; desc?: string }>`)
 * from D1 `packages.translations` or `.cdb.json`.
 */
export function parsePackageTranslations(
  val: unknown
): Record<string, PackageTranslationEntry> | undefined {
  if (!val) return undefined;
  let obj: any = val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed.startsWith('{')) return undefined;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const out: Record<string, PackageTranslationEntry> = {};
  for (const [rawLang, rawEntry] of Object.entries(obj)) {
    const trimmedLang = String(rawLang || '').trim();
    if (!trimmedLang || !/^[a-z]{2,3}(?:[_-][a-z0-9]{2,4})?$/i.test(trimmedLang)) continue;
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as any;
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : undefined;
    const shortDesc =
      typeof entry.short_desc === 'string' && entry.short_desc.trim()
        ? entry.short_desc.trim()
        : typeof entry.short_description === 'string' && entry.short_description.trim()
          ? entry.short_description.trim()
          : undefined;
    const desc =
      typeof entry.desc === 'string' && entry.desc.trim()
        ? entry.desc.trim()
        : typeof entry.long_description === 'string' && entry.long_description.trim()
          ? entry.long_description.trim()
          : undefined;
    if (title || shortDesc || desc) {
      const normalizedEntry = {
        ...(title ? { title } : {}),
        ...(shortDesc ? { short_desc: shortDesc } : {}),
        ...(desc ? { desc } : {})
      };
      out[trimmedLang] = normalizedEntry;
      const lowerLang = trimmedLang.toLowerCase();
      if (!out[lowerLang]) {
        out[lowerLang] = normalizedEntry;
      }
      const shortCode = lowerLang.slice(0, 2);
      if (!out[shortCode]) {
        out[shortCode] = normalizedEntry;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Resolves localized `title`, `short_desc`, and `desc` for a package using LuantiHub D1 `translations` first,
 * falling back to the package's default fields.
 */
export function resolveLocalizedPackageText(
  pkg: any,
  langOrTranslations?: any,
  maybeLang?: string | null
): { title: string; short_desc: string; desc?: string } {
  const isSecondArgLang = typeof langOrTranslations === 'string' || langOrTranslations === null;
  const rawLang = isSecondArgLang ? langOrTranslations : maybeLang;
  const rawTranslations = isSecondArgLang ? pkg?.translations : (langOrTranslations ?? pkg?.translations);

  const fullLang = String(rawLang || 'en').trim();
  const lowerLang = fullLang.toLowerCase();
  const shortLang = lowerLang.slice(0, 2);
  const baseTitle = String(pkg?.title || pkg?.name || '');
  const baseShort = String(pkg?.short_desc || pkg?.short_description || '');
  const baseDesc = typeof pkg?.desc === 'string' && pkg.desc ? pkg.desc : (typeof pkg?.long_description === 'string' ? pkg.long_description : undefined);

  if (!shortLang || shortLang === 'en') {
    return { title: baseTitle, short_desc: baseShort, desc: baseDesc };
  }
  const map = parsePackageTranslations(rawTranslations);
  const localized = map?.[fullLang] || map?.[lowerLang] || map?.[shortLang];
  if (!localized) {
    return { title: baseTitle, short_desc: baseShort, desc: baseDesc };
  }
  return {
    title: localized.title || baseTitle,
    short_desc: localized.short_desc || baseShort,
    desc: localized.desc || baseDesc
  };
}

/**
 * Parses `screenshot_meta` from D1 / `.cdb.json` / ContentDB `screenshots_dict`, preserving
 * caption `title` and dimensions (`width`, `height`) while ordering repository screenshots first.
 */
export function parseScreenshotMetaArray(
  rawMeta: unknown,
  fallbackUrls?: string[]
): Array<{ url: string; title?: string; width?: number; height?: number; is_cover_image?: boolean }> {
  const byUrl = new Map<string, { url: string; title?: string; width?: number; height?: number; is_cover_image?: boolean }>();
  let list: any[] = [];
  if (Array.isArray(rawMeta)) {
    list = rawMeta;
  } else if (typeof rawMeta === 'string' && rawMeta.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawMeta);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '').trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : undefined;
    const width = Number(item.width) > 0 ? Math.round(Number(item.width)) : undefined;
    const height = Number(item.height) > 0 ? Math.round(Number(item.height)) : undefined;
    const isCover = typeof item.is_cover_image === 'boolean' ? item.is_cover_image : undefined;
    byUrl.set(url, {
      url,
      ...(title ? { title } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(isCover !== undefined ? { is_cover_image: isCover } : {})
    });
  }
  if (Array.isArray(fallbackUrls)) {
    for (const u of fallbackUrls) {
      const clean = String(u || '').trim();
      if (!clean) continue;
      if (!byUrl.has(clean)) {
        byUrl.set(clean, { url: clean });
      }
    }
  }
  return Array.from(byUrl.values());
}

/**
 * Resolves all catalog packages that depend on `targetPkg` (either by `targetPkg.name` or any mod in `targetPkg.provides`)
 * across LuantiHub's unified Git + D1 + ContentDB catalog.
 */
export function findReverseDependenciesForPackage<T extends { id?: string; name?: string; provides?: string[]; dependencies?: string[]; optional_dependencies?: string[]; downloads?: number; score?: number }>(
  targetPkg: T | null | undefined,
  allPackages: Iterable<T>,
  limit = 24
): {
  hardDependents: T[];
  optionalDependents: T[];
  requiredBy: T[];
  optionalFor: T[];
  totalCount: number;
} {
  if (!targetPkg || !targetPkg.name) {
    return { hardDependents: [], optionalDependents: [], requiredBy: [], optionalFor: [], totalCount: 0 };
  }
  const selfIdLower = String(targetPkg.id || '').toLowerCase();
  const providedModNames = new Set<string>([
    String(targetPkg.name).trim().toLowerCase(),
    ...parseJsonArray(targetPkg.provides).map(p => p.trim().toLowerCase())
  ].filter(Boolean));

  const hardDependents: T[] = [];
  const optionalDependents: T[] = [];

  for (const candidate of allPackages) {
    if (!candidate || typeof candidate !== 'object') continue;
    const candIdLower = String(candidate.id || '').toLowerCase();
    if (candIdLower && candIdLower === selfIdLower) continue;

    const hardDeps = parseJsonArray(candidate.dependencies).map(d =>
      (d.includes('/') ? d.split('/').pop()! : d).trim().toLowerCase()
    );
    if (hardDeps.some(d => providedModNames.has(d))) {
      hardDependents.push(candidate);
      continue;
    }

    const optDeps = parseJsonArray(candidate.optional_dependencies).map(d =>
      (d.includes('/') ? d.split('/').pop()! : d).trim().toLowerCase()
    );
    if (optDeps.some(d => providedModNames.has(d))) {
      optionalDependents.push(candidate);
    }
  }

  const sortByPopularity = (a: T, b: T) =>
    (Number(b.downloads) || 0) - (Number(a.downloads) || 0) ||
    (Number(b.score) || 0) - (Number(a.score) || 0);

  hardDependents.sort(sortByPopularity);
  optionalDependents.sort(sortByPopularity);

  const cappedHard = limit > 0 ? hardDependents.slice(0, limit) : hardDependents;
  const cappedOpt = limit > 0 ? optionalDependents.slice(0, limit) : optionalDependents;

  return {
    hardDependents: cappedHard,
    optionalDependents: cappedOpt,
    requiredBy: cappedHard,
    optionalFor: cappedOpt,
    totalCount: hardDependents.length + optionalDependents.length
  };
}



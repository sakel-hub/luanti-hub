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
  const rev = item?.reviews ?? item?.review_thread_counts;
  if (rev && typeof rev === 'object' && !Array.isArray(rev)) {
    const pos = Number(rev.positive) || 0;
    const neu = Number(rev.neutral) || 0;
    const neg = Number(rev.negative) || 0;
    const total = pos + neu + neg;
    if (total > 0) {
      const stars = (pos * 5 + neu * 3 + neg * 1) / total;
      return Number(Math.min(5.0, Math.max(1.0, stars)).toFixed(1));
    }
  }
  const revList = Array.isArray(item?.reviews_list)
    ? item.reviews_list
    : Array.isArray(rev)
      ? rev
      : null;
  if (revList && revList.length > 0) {
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


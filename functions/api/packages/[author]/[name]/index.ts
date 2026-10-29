import {
  fetchUpstreamJsonCached,
  parseJsonArray,
  detectSpdxFromText,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl,
  rewriteRelativeMarkdownUrls
} from '../../../lib/upstream';
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount
} from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

function formatByteSize(bytes: number): string | undefined {
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function computeStarRating(upstreamData: any, _d1Score?: number, d1ReviewAvg?: number): number {
  if (d1ReviewAvg && d1ReviewAvg >= 1 && d1ReviewAvg <= 5) {
    return Number(d1ReviewAvg.toFixed(1));
  }
  const rev = upstreamData?.reviews;
  if (rev && typeof rev === 'object') {
    const pos = Number(rev.positive) || 0;
    const neu = Number(rev.neutral) || 0;
    const neg = Number(rev.negative) || 0;
    const total = pos + neu + neg;
    if (total > 0) {
      const stars = (pos * 5 + neu * 3 + neg * 1) / total;
      return Number(Math.min(5.0, Math.max(1.0, stars)).toFixed(1));
    }
  }
  const rawScore = Number(upstreamData?.score) || 0;
  if (rawScore >= 1.0 && rawScore <= 5.0) {
    return Number(rawScore.toFixed(1));
  }
  return 0;
}

function extractDependencies(
  upstreamData: any,
  depsPayload: any,
  pkgKey: string
): { hardDeps: string[]; softDeps: string[] } {
  const hardSet = new Set<string>();
  const softSet = new Set<string>();

  const addDep = (target: Set<string>, item: any) => {
    if (!item) return;
    if (typeof item === 'string') {
      const clean = item.trim();
      if (clean) target.add(clean);
    } else if (typeof item === 'object') {
      const depName = item.name || item.id || (Array.isArray(item.packages) && item.packages[0]);
      if (typeof depName === 'string' && depName.trim()) {
        if (item.is_optional) {
          softSet.add(depName.trim());
        } else {
          target.add(depName.trim());
        }
      }
    }
  };

  if (Array.isArray(upstreamData?.hard_dependencies)) {
    upstreamData.hard_dependencies.forEach((d: any) => addDep(hardSet, d));
  } else if (Array.isArray(upstreamData?.dependencies)) {
    upstreamData.dependencies.forEach((d: any) => addDep(hardSet, d));
  }

  if (Array.isArray(upstreamData?.soft_dependencies)) {
    upstreamData.soft_dependencies.forEach((d: any) => addDep(softSet, d));
  } else if (Array.isArray(upstreamData?.optional_dependencies)) {
    upstreamData.optional_dependencies.forEach((d: any) => addDep(softSet, d));
  }

  if (depsPayload) {
    let list: any[] = [];
    if (Array.isArray(depsPayload)) {
      list = depsPayload;
    } else if (typeof depsPayload === 'object') {
      const exact = depsPayload[pkgKey] || depsPayload[pkgKey.toLowerCase()];
      if (Array.isArray(exact)) {
        list = exact;
      } else {
        const firstArray = Object.values(depsPayload).find((v) => Array.isArray(v)) as any[] | undefined;
        if (firstArray) list = firstArray;
      }
    }
    for (const dep of list) {
      if (dep && typeof dep === 'object') {
        const depName = dep.name || (Array.isArray(dep.packages) && dep.packages[0]);
        if (typeof depName === 'string' && depName.trim()) {
          if (dep.is_optional) {
            softSet.add(depName.trim());
          } else {
            hardSet.add(depName.trim());
          }
        }
      } else if (typeof dep === 'string') {
        hardSet.add(dep.trim());
      }
    }
  }

  // Ensure optional deps don't duplicate required deps
  for (const h of hardSet) {
    softSet.delete(h);
  }

  return {
    hardDeps: Array.from(hardSet),
    softDeps: Array.from(softSet)
  };
}

async function resolveArchiveSizeCached(downloadUrl?: string): Promise<string | undefined> {
  if (!downloadUrl || !downloadUrl.startsWith('http')) return undefined;
  const cacheKeyUrl = `https://cache.luantihub.internal/filesize?url=${encodeURIComponent(downloadUrl)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const data = await cached.json() as { size?: string };
        return data.size;
      }
    } catch {
      // Ignore cache read error
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(downloadUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luanti-hub.pages.dev)'
      }
    });
    clearTimeout(timeoutId);
    const len = Number(res.headers.get('content-length') || 0);
    const formatted = formatByteSize(len);
    if (formatted && edgeCache) {
      try {
        await edgeCache.put(
          cacheReq,
          new Response(JSON.stringify({ size: formatted }), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=86400, s-maxage=86400'
            }
          })
        );
      } catch {
        // Ignore cache write error
      }
    }
    return formatted;
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

async function fetchRepoReadmeCached(repoUrl?: string): Promise<string | undefined> {
  const normalized = normalizeDefunctGitHost(repoUrl);
  if (!normalized) return undefined;
  const candidates: Array<{ url: string; rawBase?: string; headers?: Record<string, string> }> = [];
  const pushCandidate = (url: string, rawBase?: string, headers?: Record<string, string>) => {
    if (!candidates.some(c => c.url === url)) {
      candidates.push({ url, rawBase, headers });
    }
  };

  try {
    const u = new URL(normalized);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return undefined;
    const owner = parts[0];
    const repo = parts[1];
    const host = u.hostname.toLowerCase();

    if (host.includes('github.com')) {
      const ghBase = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
      for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt', 'README']) {
        pushCandidate(`${ghBase}/${file}`, ghBase);
      }
      pushCandidate(`https://api.github.com/repos/${owner}/${repo}/readme`, ghBase, {
        Accept: 'application/vnd.github.raw+json'
      });
    } else if (host.includes('codeberg.org')) {
      const lowerOwner = owner.toLowerCase();
      const cbApiBase = `https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`;
      for (const file of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'readme.txt', 'README']) {
        pushCandidate(`${cbApiBase}/${file}`, cbApiBase);
      }
      for (const branch of ['main', 'master']) {
        const cbBranchBase = `https://codeberg.org/${lowerOwner}/${repo}/raw/branch/${branch}`;
        pushCandidate(`${cbBranchBase}/README.md`, cbBranchBase);
        pushCandidate(`${cbBranchBase}/readme.md`, cbBranchBase);
      }
    } else if (host.includes('gitlab.com')) {
      const glBase = `https://gitlab.com/${owner}/${repo}/-/raw/HEAD`;
      for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
        pushCandidate(`${glBase}/${file}`, glBase);
      }
    } else {
      const giteaBase = `${u.origin}/api/v1/repos/${owner}/${repo}/raw`;
      for (const file of ['README.md', 'readme.md', 'README.txt', 'readme.txt']) {
        pushCandidate(`${giteaBase}/${file}`, giteaBase);
      }
    }
  } catch {
    return undefined;
  }

  if (candidates.length === 0) return undefined;

  const cacheKeyUrl = `https://cache.luantihub.internal/readme?repo=${encodeURIComponent(normalized)}`;
  const cacheReq = new Request(cacheKeyUrl, { method: 'GET' });
  const edgeCache = typeof caches !== 'undefined' ? (caches as any).default : null;

  if (edgeCache) {
    try {
      const cached = await edgeCache.match(cacheReq);
      if (cached) {
        const text = await cached.text();
        return text || undefined;
      }
    } catch {
      // Ignore cache read error
    }
  }

  for (const cand of candidates) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(cand.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luanti-hub.pages.dev)',
          ...(cand.headers || {})
        }
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const rawText = (await res.text()).slice(0, 64000);
        if (
          rawText &&
          rawText.trim().length > 10 &&
          !rawText.trim().startsWith('<!DOCTYPE') &&
          !rawText.trim().startsWith('<html')
        ) {
          const text = rewriteRelativeMarkdownUrls(rawText, cand.rawBase);
          if (edgeCache) {
            try {
              await edgeCache.put(
                cacheReq,
                new Response(text, {
                  headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'public, max-age=3600, s-maxage=3600'
                  }
                })
              );
            } catch {
              // Ignore
            }
          }
          return text;
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }
  }
  return undefined;
}

function normalizeDefunctGitHost(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.toLowerCase().includes('notabug.org') && parts.length >= 2) {
      // NotABug shut down; Luanti creators (e.g. TenPlus1) migrated repositories to Codeberg
      return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1]}`;
    }
  } catch {
    // Keep original if URL parsing fails
  }
  return trimmed;
}

async function probeGitRepoConfAndLicense(
  author: string,
  name: string,
  pkgType = 'mod',
  existingRepoUrl?: string
): Promise<{
  repoUrl?: string;
  gitRepoStatus: 'verified' | 'broken_404' | 'unverified';
  license?: string;
  mediaLicense?: string;
  hardDeps: string[];
  softDeps: string[];
  minVersion?: string;
}> {
  const normalizedInputUrl = normalizeDefunctGitHost(existingRepoUrl);
  let owner = author;
  let repo = name;
  let host = '';

  if (normalizedInputUrl) {
    try {
      const u = new URL(normalizedInputUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        host = u.hostname.toLowerCase();
        owner = parts[0];
        repo = parts[1];
      }
    } catch {
      // Fallback to author/name
    }
  }

  const confFile = pkgType === 'game' ? 'game.conf' : pkgType === 'txp' ? 'texture_pack.conf' : 'mod.conf';
  const lowerOwner = owner.toLowerCase();

  const rawBaseCandidates: Array<{ base: string; repoUrl: string }> = [];
  const pushCandidate = (base: string, repoUrl: string) => {
    if (!rawBaseCandidates.some(c => c.base === base)) {
      rawBaseCandidates.push({ base, repoUrl });
    }
  };

  if (host.includes('codeberg.org')) {
    pushCandidate(`https://codeberg.org/api/v1/repos/${owner}/${repo}/raw`, `https://codeberg.org/${owner}/${repo}`);
    pushCandidate(`https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://codeberg.org/${lowerOwner}/${repo}`);
  } else if (host.includes('gitlab.com')) {
    pushCandidate(`https://gitlab.com/${owner}/${repo}/-/raw/HEAD`, `https://gitlab.com/${owner}/${repo}`);
  } else if (host.includes('github.com')) {
    pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, `https://github.com/${owner}/${repo}`);
  }

  // Always include multi-forge fallbacks (GitHub HEAD, Codeberg v1 API raw, GitLab HEAD)
  pushCandidate(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD`, `https://github.com/${owner}/${repo}`);
  pushCandidate(`https://codeberg.org/api/v1/repos/${owner}/${repo}/raw`, `https://codeberg.org/${owner}/${repo}`);
  pushCandidate(`https://codeberg.org/api/v1/repos/${lowerOwner}/${repo}/raw`, `https://codeberg.org/${lowerOwner}/${repo}`);
  pushCandidate(`https://gitlab.com/${owner}/${repo}/-/raw/HEAD`, `https://gitlab.com/${owner}/${repo}`);

  const hardDeps: string[] = [];
  const softDeps: string[] = [];
  let license: string | undefined;
  let mediaLicense: string | undefined;
  let minVersion: string | undefined;
  let resolvedRepoUrl: string | undefined;
  let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = 'unverified';
  let sawExplicit404 = false;

  const tryCandidates = async (candidates: Array<{ base: string; repoUrl: string }>): Promise<boolean> => {
    for (const cand of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1600);
      try {
        const res = await fetch(`${cand.base}/${confFile}`, { signal: controller.signal });
        clearTimeout(timer);
        if (res.status === 404) {
          sawExplicit404 = true;
          const fallbackCtrl = new AbortController();
          const fallbackTimer = setTimeout(() => fallbackCtrl.abort(), 1200);
          try {
            const initRes = await fetch(`${cand.base}/init.lua`, { signal: fallbackCtrl.signal });
            clearTimeout(fallbackTimer);
            if (initRes.ok) {
              const initText = await initRes.text();
              if (initText && !initText.trim().startsWith('<!DOCTYPE') && !initText.trim().startsWith('<html')) {
                resolvedRepoUrl = cand.repoUrl;
                gitRepoStatus = 'verified';
                return true;
              }
            }
          } catch {
            clearTimeout(fallbackTimer);
          }
          continue;
        }
        if (res.ok) {
          const confText = await res.text();
          if (confText && !confText.trim().startsWith('<!DOCTYPE') && !confText.trim().startsWith('<html')) {
            resolvedRepoUrl = cand.repoUrl;
            gitRepoStatus = 'verified';
            const getVal = (key: string) => {
              const m = confText.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'));
              return m ? m[1].trim() : '';
            };
            const depStr = getVal('depends');
            const optStr = getVal('optional_depends');
            if (depStr) {
              depStr.split(',').map(s => s.trim()).filter(Boolean).forEach(d => hardDeps.push(d));
            }
            if (optStr) {
              optStr.split(',').map(s => s.trim()).filter(Boolean).forEach(d => softDeps.push(d));
            }
            license = getVal('license') || undefined;
            mediaLicense = getVal('media_license') || undefined;
            minVersion = getVal('min_minetest_version') || undefined;

            if (!license) {
              for (const licFile of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
                try {
                  const licRes = await fetch(`${cand.base}/${licFile}`);
                  if (licRes.ok) {
                    const licText = await licRes.text();
                    const detected = detectSpdxFromText(licText);
                    if (detected) {
                      license = detected;
                      break;
                    }
                  }
                } catch {
                  // Ignore
                }
              }
            }
            return true;
          }
        }
      } catch {
        clearTimeout(timer);
      }
    }
    return false;
  };

  const foundDirect = await tryCandidates(rawBaseCandidates);

  // Dynamic Codeberg & GitHub search discovery when ContentDB is offline or repo owner differs from author
  if (!foundDirect && name) {
    const searchCandidates: Array<{ base: string; repoUrl: string }> = [];
    const targetName = name.toLowerCase();

    try {
      const cbRes = await fetch(`https://codeberg.org/api/v1/repos/search?q=${encodeURIComponent(name)}&limit=8`, {
        headers: { 'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luanti-hub.pages.dev)' }
      });
      if (cbRes.ok) {
        const cbJson: any = await cbRes.json();
        const cbRepos: any[] = Array.isArray(cbJson?.data) ? cbJson.data : [];
        for (const r of cbRepos) {
          if (r && String(r.name || '').toLowerCase() === targetName && r.full_name) {
            searchCandidates.push({
              base: `https://codeberg.org/api/v1/repos/${r.full_name}/raw`,
              repoUrl: r.html_url || `https://codeberg.org/${r.full_name}`
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    try {
      const ghRes = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(name)}+in:name&per_page=5`, {
        headers: { 'User-Agent': 'LuantiHub-Proxy/1.0 (+https://luanti-hub.pages.dev)' }
      });
      if (ghRes.ok) {
        const ghJson: any = await ghRes.json();
        const ghRepos: any[] = Array.isArray(ghJson?.items) ? ghJson.items : [];
        for (const r of ghRepos) {
          if (r && String(r.name || '').toLowerCase() === targetName && r.full_name) {
            searchCandidates.push({
              base: `https://raw.githubusercontent.com/${r.full_name}/HEAD`,
              repoUrl: r.html_url || `https://github.com/${r.full_name}`
            });
          }
        }
      }
    } catch {
      // Ignore
    }

    if (searchCandidates.length > 0) {
      await tryCandidates(searchCandidates);
    }
  }

  if (!resolvedRepoUrl && sawExplicit404 && normalizedInputUrl) {
    gitRepoStatus = 'broken_404';
  }

  return {
    repoUrl: resolvedRepoUrl || normalizedInputUrl,
    gitRepoStatus,
    license,
    mediaLicense,
    hardDeps,
    softDeps,
    minVersion
  };
}

function buildNormalizedReleases(
  author: string,
  name: string,
  d1Releases: any[],
  upstreamReleases: any[] | null
): any[] {
  if (Array.isArray(d1Releases) && d1Releases.length > 0) {
    return d1Releases.map((r: any) => ({
      id: r.id,
      version: r.tag_name || r.version,
      title: r.title || r.tag_name || r.version,
      tag_name: r.tag_name || r.version,
      commit_sha: r.commit_sha,
      url: r.download_url || r.url,
      download_url: r.download_url || r.url,
      min_minetest_version: r.min_minetest_version,
      max_minetest_version: r.max_minetest_version,
      changelog: r.changelog,
      release_date: r.released_at || r.release_date,
      released_at: r.released_at || r.release_date
    }));
  }

  if (Array.isArray(upstreamReleases) && upstreamReleases.length > 0) {
    const encAuthor = encodeURIComponent(author);
    const encName = encodeURIComponent(name);
    return upstreamReleases.map((r: any) => {
      const rawUrl = r.url || '';
      const fullDownloadUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl
          ? `https://content.luanti.org${rawUrl}`
          : `https://content.luanti.org/packages/${encAuthor}/${encName}/releases/${r.id}/download/`;

      return {
        id: r.id,
        version: String(r.title || r.id || 'latest'),
        title: String(r.title || r.id || 'Release'),
        tag_name: String(r.title || r.id || 'latest'),
        commit_sha: r.commit || '',
        url: fullDownloadUrl,
        download_url: fullDownloadUrl,
        size: r.size || r.file_size || undefined,
        min_minetest_version: r.min_minetest_version || r.min_protocol_version || undefined,
        max_minetest_version: r.max_minetest_version || r.max_protocol_version || undefined,
        released_at: r.release_date || new Date().toISOString()
      };
    });
  }

  return [];
}

function buildNormalizedReviews(d1Reviews: any[], upstreamReviews: any[] | null): any[] {
  const normalizedOfficial = (Array.isArray(upstreamReviews) ? upstreamReviews : []).map((r: any, idx: number) => ({
    id: `cdb_${r.id || idx}`,
    source: 'contentdb',
    rating: r.rating ? Math.min(5, Math.max(1, Number(r.rating))) : (r.recommends === false ? 1 : r.recommends === true ? 5 : 3),
    title: r.title,
    comment: r.comment || r.text || '',
    created_at: r.created_at,
    author: {
      username: r.author || r.user?.username || 'contentdb_user',
      display_name: r.author || r.user?.display_name || r.user?.username || 'Community Member',
      avatar_url: `https://github.com/${r.author || r.user?.username || 'octocat'}.png`
    }
  }));

  const normalizedLocal = (Array.isArray(d1Reviews) ? d1Reviews : []).map((r: any) => ({
    id: `lh_${r.id}`,
    source: 'luantihub',
    rating: r.rating || 5,
    title: r.title,
    comment: r.comment,
    created_at: r.created_at,
    author: {
      username: r.username,
      display_name: r.display_name || r.username,
      avatar_url: r.avatar_url || `https://github.com/${r.username}.png`
    }
  }));

  return [...normalizedLocal, ...normalizedOfficial].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export async function onRequestGet(context: { request?: Request; params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const pkgId = `${author}/${name}`;

  // 1. Check Cloudflare D1 (including Instant Kill Switch status check + local D1 reviews & releases)
  let d1Pkg: any = null;
  let d1ReviewAvg: number | undefined;
  let d1Releases: any[] = [];
  let d1Reviews: any[] = [];
  if (context.env.DB) {
    d1Pkg = await context.env.DB.prepare(
      `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
    ).bind(pkgId, author, name).first();

    if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
      return Response.json({
        error: 'This package has been delisted or suspended by moderation.',
        status: d1Pkg.status,
        reason: d1Pkg.status_reason || 'Policy / DMCA Compliance'
      }, {
        status: 451,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    const effectivePkgId = d1Pkg?.id || pkgId;

    try {
      const [revAvgRow, revRowsRes, relRowsRes] = await Promise.all([
        context.env.DB.prepare(
          `SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE LOWER(package_id) = LOWER(?)`
        ).bind(effectivePkgId).first(),
        context.env.DB.prepare(`
          SELECT r.id, r.rating, r.title, r.comment, r.created_at,
                 u.username, u.display_name, u.avatar_url
          FROM reviews r
          LEFT JOIN users u ON r.user_id = u.id
          WHERE LOWER(r.package_id) = LOWER(?)
          ORDER BY r.created_at DESC
        `).bind(effectivePkgId).all().catch(() => ({ results: [] })),
        context.env.DB.prepare(
          `SELECT * FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY released_at DESC`
        ).bind(effectivePkgId).all().catch(() => ({ results: [] }))
      ]);

      if (revAvgRow && Number(revAvgRow.cnt) > 0 && revAvgRow.avg_rating != null) {
        d1ReviewAvg = Number(revAvgRow.avg_rating);
      } else if (d1Pkg && Number(d1Pkg.score) > 0) {
        // Heal legacy DEFAULT 5.0 score in D1 when no reviews exist
        d1Pkg.score = 0;
        context.env.DB.prepare(`UPDATE packages SET score = 0 WHERE id = ?`).bind(d1Pkg.id).run().catch(() => {});
      }
      d1Reviews = revRowsRes?.results || [];
      d1Releases = relRowsRes?.results || [];
    } catch {
      // Ignore if reviews/releases query fails
    }
  }

  // 2. Fetch upstream ContentDB detail, dependencies, releases, and reviews in parallel
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  let [upstreamData, depsPayload, releasesPayload, upstreamReviewsPayload] = await Promise.all([
    fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 300),
    fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/dependencies/?only_hard=0`, 600),
    fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/releases/`, 300),
    fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/reviews/`, 300)
  ]);

  // Ensure Git tags/releases are discovered before falling back to a default branch ('HEAD') row
  const hasRealTaggedD1Releases = d1Releases.some(
    (r: any) => r.commit_sha !== 'HEAD' && r.version !== 'latest'
  );
  if (!hasRealTaggedD1Releases && (!Array.isArray(releasesPayload) || releasesPayload.length === 0)) {
    const discoveredGitReleases = await fetchGitRepoReleasesAndTags(
      d1Pkg?.repo_url,
      d1Pkg?.author_name || author,
      d1Pkg?.name || name,
      d1Pkg?.min_minetest_version || '5.0.0'
    );
    if (discoveredGitReleases.length > 0) {
      d1Releases = discoveredGitReleases;
      if (context.env.DB && d1Pkg) {
        try {
          await context.env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(d1Pkg.id).run();
          for (const rel of discoveredGitReleases.slice(0, 25)) {
            await context.env.DB.prepare(`
              INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              d1Pkg.id,
              rel.version,
              rel.tag_name,
              rel.commit_sha,
              rel.download_url,
              rel.min_minetest_version || d1Pkg.min_minetest_version || '5.0.0',
              rel.changelog || `Git Tag / Release (${rel.tag_name})`,
              rel.released_at || new Date().toISOString()
            ).run();
          }
        } catch {
          // Non-fatal D1 sync error
        }
      }
    } else if (d1Releases.length === 0 && d1Pkg?.repo_url) {
      const branch = d1Pkg.default_branch || 'main';
      const fallbackUrl = buildGitBranchArchiveUrl(
        d1Pkg.repo_url,
        d1Pkg.author_name || author,
        d1Pkg.name || name,
        branch,
        d1Pkg.provider
      );
      d1Releases = [{
        id: 'git-branch-fallback',
        version: branch,
        title: `${branch} branch`,
        tag_name: branch,
        commit_sha: 'HEAD',
        url: fallbackUrl,
        download_url: fallbackUrl,
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        changelog: `Direct source archive from ${branch} branch`,
        released_at: d1Pkg.updated_at || d1Pkg.created_at || new Date().toISOString()
      }];
    }
  }

  const bundledReleases = buildNormalizedReleases(author, name, d1Releases, releasesPayload);
  const bundledReviews = buildNormalizedReviews(d1Reviews, upstreamReviewsPayload);

  // Fallback: If single-package endpoint is unavailable on mirror, resolve from cached bulk catalog (/packages/)
  if (!upstreamData) {
    const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/', 600);
    if (Array.isArray(bulkCatalog)) {
      const lowerAuthor = author.toLowerCase();
      const lowerName = name.toLowerCase();
      upstreamData = bulkCatalog.find(
        (item: any) =>
          item &&
          String(item.author || '').toLowerCase() === lowerAuthor &&
          String(item.name || '').toLowerCase() === lowerName
      ) || null;
    }
  }

  // 3. If it is a pure Git package in D1 (not present on ContentDB), return D1 metadata enriched with README
  if (!upstreamData) {
    if (d1Pkg) {
      const d1Tags = parseJsonArray(d1Pkg.tags);
      const isGitPkg = d1Pkg.provider !== 'contentdb' || d1Tags.includes('git');
      const isAlsoOfficial = d1Pkg.provider === 'contentdb' || d1Tags.includes('contentdb');
      const sources: Array<'official' | 'git'> = [];
      if (isAlsoOfficial) sources.push('official');
      if (isGitPkg) sources.push('git');
      if (sources.length === 0) sources.push('git');

      const readme = isGitPkg ? await fetchRepoReadmeCached(d1Pkg.repo_url) : undefined;
      const fallbackRawBase = d1Pkg.repo_url
        ? `${String(d1Pkg.repo_url).replace(/\.git$/i, '').replace(/\/+$/, '')}/raw/${d1Pkg.default_branch || 'main'}`
        : undefined;
      const fallbackReadme = d1Pkg.long_desc && d1Pkg.long_desc !== d1Pkg.short_desc
        ? rewriteRelativeMarkdownUrls(d1Pkg.long_desc, fallbackRawBase)
        : undefined;

      const pureGitPayload = {
        id: `${d1Pkg.author_name}/${d1Pkg.name}`,
        author: d1Pkg.author_name,
        name: d1Pkg.name,
        title: d1Pkg.title,
        type: d1Pkg.type,
        short_desc: d1Pkg.short_desc,
        long_description: d1Pkg.short_desc,
        desc: d1Pkg.short_desc,
        readme: readme || fallbackReadme || undefined,
        thumbnail: d1Pkg.thumbnail_url,
        banner: d1Pkg.banner_url || d1Pkg.thumbnail_url,
        license: d1Pkg.license,
        media_license: d1Pkg.media_license,
        score: d1ReviewAvg ? Number(d1ReviewAvg.toFixed(1)) : 0,
        downloads: Number(d1Pkg.downloads_count) || 0,
        repo: d1Pkg.repo_url,
        repo_url: d1Pkg.repo_url,
        provider: d1Pkg.provider,
        default_branch: d1Pkg.default_branch || 'main',
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        tags: d1Tags.length > 0 ? d1Tags : [d1Pkg.type || 'mod'],
        dependencies: parseJsonArray(d1Pkg.dependencies),
        optional_dependencies: parseJsonArray(d1Pkg.optional_dependencies),
        file_size: d1Pkg.file_size || undefined,
        status: d1Pkg.status || 'active',
        source: isGitPkg ? 'git' : 'official',
        sources,
        releases_list: bundledReleases,
        reviews_list: bundledReviews
      };

      return new Response(JSON.stringify(pureGitPayload), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
    }
    return Response.json({ error: 'Package not found' }, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const canonicalId = `${upstreamData.author || author}/${upstreamData.name || name}`;
  const { hardDeps, softDeps } = extractDependencies(upstreamData, depsPayload, canonicalId);

  let finalHardDeps = hardDeps;
  let finalSoftDeps = softDeps;
  let resolvedLicense = upstreamData.license || upstreamData.media_license || d1Pkg?.license || '';
  let resolvedMediaLicense = upstreamData.media_license || upstreamData.license || d1Pkg?.media_license || '';
  let repoUrl = normalizeDefunctGitHost(upstreamData.repo || upstreamData.repo_url || d1Pkg?.repo_url || undefined);
  let gitRepoStatus: 'verified' | 'broken_404' | 'unverified' = repoUrl ? 'verified' : 'unverified';
  let minVersion = upstreamData.min_minetest_version || d1Pkg?.min_minetest_version || undefined;

  // Always probe/verify Git repository when repo_url is missing, migrated, or when mirror lacks dependencies/license
  if (!repoUrl || (finalHardDeps.length === 0 && finalSoftDeps.length === 0) || !resolvedLicense) {
    const gitProbe = await probeGitRepoConfAndLicense(
      upstreamData.author || author,
      upstreamData.name || name,
      upstreamData.type || 'mod',
      repoUrl
    );
    gitRepoStatus = gitProbe.gitRepoStatus;
    if (finalHardDeps.length === 0 && gitProbe.hardDeps.length > 0) {
      finalHardDeps = gitProbe.hardDeps;
    }
    if (finalSoftDeps.length === 0 && gitProbe.softDeps.length > 0) {
      finalSoftDeps = gitProbe.softDeps;
    }
    if (!resolvedLicense && (gitProbe.license || gitProbe.mediaLicense)) {
      resolvedLicense = gitProbe.license || gitProbe.mediaLicense || '';
    }
    if (!resolvedMediaLicense && (gitProbe.mediaLicense || gitProbe.license)) {
      resolvedMediaLicense = gitProbe.mediaLicense || gitProbe.license || '';
    }
    if (gitProbe.repoUrl) {
      repoUrl = gitProbe.repoUrl;
    }
    if (!minVersion && gitProbe.minVersion) {
      minVersion = gitProbe.minVersion;
    }

    // Automated 404 Git Repository Detection: report stale/404 Git repos to admins/moderators in D1
    if (gitRepoStatus === 'broken_404' && context.env.DB) {
      try {
        const existingReport = await context.env.DB.prepare(
          `SELECT id FROM moderation_reports WHERE LOWER(package_id) = LOWER(?) AND reason = 'broken' AND status = 'open' LIMIT 1`
        ).bind(canonicalId).first();
        if (!existingReport) {
          const attempted = repoUrl || `https://github.com/${upstreamData.author || author}/${upstreamData.name || name}`;
          await context.env.DB.prepare(
            `INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status) VALUES (?, 'system-git-monitor', 'broken', ?, 'open')`
          ).bind(
            canonicalId,
            `[Automated 404 Git Detection] Repository URL (${attempted}) returned HTTP 404 across GitHub, Codeberg, and GitLab. Flagged for admin/moderator review to prevent stale content packages.`
          ).run();
        }
      } catch {
        // Non-blocking auto-report
      }
    }
  }

  // Normalize tags array
  let normalizedTags: string[] = [];
  if (Array.isArray(upstreamData.tags)) {
    normalizedTags = upstreamData.tags
      .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.title || ''))
      .filter(Boolean);
  }
  if (normalizedTags.length === 0) {
    const fallbackD1Tags = parseJsonArray(d1Pkg?.tags);
    normalizedTags = fallbackD1Tags.length > 0 ? fallbackD1Tags : [upstreamData.type || 'mod'];
  }

  // Normalize screenshots array
  let screenshots: string[] = [];
  if (Array.isArray(upstreamData.screenshots)) {
    screenshots = upstreamData.screenshots
      .map((s: any) => (typeof s === 'string' ? s : s?.url || ''))
      .filter(Boolean);
  }

  // Resolve file_size from latest release or Content-Length HEAD check
  let fileSize: string | undefined;
  let latestDownloadUrl = `https://content.luanti.org/packages/${encAuthor}/${encName}/download/`;
  if (Array.isArray(releasesPayload) && releasesPayload.length > 0) {
    const firstRel = releasesPayload[0];
    const rawBytes = Number(firstRel.size || firstRel.file_size || 0);
    if (rawBytes > 0) {
      fileSize = formatByteSize(rawBytes);
    }
    const rawRelUrl = firstRel.url || '';
    if (rawRelUrl) {
      latestDownloadUrl = rawRelUrl.startsWith('http')
        ? rawRelUrl
        : `https://content.luanti.org${rawRelUrl}`;
    }
  }

  const [resolvedHeadSize, readmeText] = await Promise.all([
    fileSize ? Promise.resolve(fileSize) : resolveArchiveSizeCached(latestDownloadUrl),
    fetchRepoReadmeCached(repoUrl)
  ]);

  const d1Tags = parseJsonArray(d1Pkg?.tags);
  const d1HardDeps = parseJsonArray(d1Pkg?.dependencies);
  const d1SoftDeps = parseJsonArray(d1Pkg?.optional_dependencies);
  const isRegisteredInGitCommunity = Boolean(
    d1Pkg && (d1Pkg.provider !== 'contentdb' || d1Tags.includes('git'))
  );
  const sources: Array<'official' | 'git'> = isRegisteredInGitCommunity ? ['official', 'git'] : ['official'];

  const enriched = {
    ...upstreamData,
    id: canonicalId,
    license: resolvedLicense,
    media_license: resolvedMediaLicense,
    min_minetest_version: minVersion,
    short_desc: upstreamData.short_desc || upstreamData.short_description || d1Pkg?.short_desc || '',
    desc: upstreamData.long_description || upstreamData.desc || (!readmeText ? d1Pkg?.long_desc : undefined) || upstreamData.short_desc || d1Pkg?.short_desc || '',
    readme: readmeText || undefined,
    repo_url: repoUrl,
    git_repo_status: gitRepoStatus,
    website: upstreamData.website || undefined,
    issue_tracker: upstreamData.issue_tracker || undefined,
    forums: upstreamData.forums
      ? (String(upstreamData.forums).startsWith('http')
          ? String(upstreamData.forums)
          : `https://forum.luanti.org/viewtopic.php?t=${upstreamData.forums}`)
      : undefined,
    screenshots,
    tags: Array.from(new Set([...normalizedTags, ...d1Tags])).filter(Boolean),
    downloads: Math.max(Number(upstreamData.downloads) || 0, Number(d1Pkg?.downloads_count) || 0),
    score: computeStarRating(upstreamData, d1Pkg?.score, d1ReviewAvg),
    file_size: resolvedHeadSize || undefined,
    dependencies: finalHardDeps.length > 0 ? finalHardDeps : d1HardDeps,
    optional_dependencies: finalSoftDeps.length > 0 ? finalSoftDeps : d1SoftDeps,
    status: d1Pkg?.status || 'active',
    source: isRegisteredInGitCommunity ? 'git' : 'official',
    sources,
    releases_list: bundledReleases,
    reviews_list: bundledReviews
  };

  return new Response(JSON.stringify(enriched), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }
  });
}

// PATCH /api/packages/:author/:name — Allow package author or admin to edit package tags
export async function onRequestPatch(context: { request: Request; params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const pkgId = `${author}/${name}`;

  if (!context.env.DB) {
    return Response.json({ error: 'Database unavailable.' }, { status: 503 });
  }

  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Authentication required to edit package.' }, { status: 401 });
  }

  const rawUserId = await verifySessionToken(sessionToken, context.env.SESSION_SECRET);
  if (!rawUserId) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const user = await reconcileAndMergeUserAccount(context.env.DB, rawUserId);
  if (!user) {
    return Response.json({ error: 'User account not found.' }, { status: 401 });
  }
  const resolvedUserId = String(user.id);

  const [identitiesRes, pkgRow] = await Promise.all([
    context.env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(resolvedUserId).all().catch(() => ({ results: [] })),
    context.env.DB.prepare(
      `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
    ).bind(pkgId, author, name).first<any>()
  ]);

  if (!pkgRow) {
    return Response.json({ error: 'Package not found in D1 registry.' }, { status: 404 });
  }

  const identities = (identitiesRes.results || []).map((id: any) => ({
    provider: String(id.provider || '').toLowerCase(),
    username: String(id.username || ''),
    verified: Boolean(id.verified)
  }));

  const isAdmin = checkIsAdmin(user, identities, context.env.ADMIN_USERS);
  const userHandles = new Set<string>([
    String(user.username || '').toLowerCase(),
    ...identities.map((i: any) => String(i.username || '').toLowerCase())
  ].filter(Boolean));

  let repoOwner = '';
  if (pkgRow.repo_url) {
    try {
      const parts = new URL(pkgRow.repo_url).pathname.split('/').filter(Boolean);
      if (parts.length >= 2) repoOwner = parts[0].toLowerCase();
    } catch {
      // ignore
    }
  }

  const isOwner =
    isAdmin ||
    (pkgRow.author_id && String(pkgRow.author_id) === resolvedUserId) ||
    userHandles.has(String(pkgRow.author_name || author).toLowerCase()) ||
    (repoOwner && userHandles.has(repoOwner));

  if (!isOwner) {
    return Response.json({ error: 'Only the package author or an administrator can edit this package.' }, { status: 403 });
  }

  const body = await context.request.json().catch(() => ({})) as { tags?: string[] };
  const rawInputTags = Array.isArray(body.tags) ? body.tags : [];

  const systemTagSet = new Set(['git', 'github', 'codeberg', 'gitlab', 'contentdb', 'mod', 'game', 'txp', 'modpack']);
  const cleanedCustomTags = rawInputTags
    .map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9_/-]/g, ''))
    .filter(t => Boolean(t) && !systemTagSet.has(t))
    .slice(0, 8);

  const existingTags = parseJsonArray(pkgRow.tags);
  const preservedSystemTags = existingTags.filter((t: string) => systemTagSet.has(String(t).toLowerCase()));
  if (pkgRow.provider && pkgRow.provider !== 'contentdb' && !preservedSystemTags.includes('git')) {
    preservedSystemTags.push('git');
  }
  if (pkgRow.provider && !preservedSystemTags.includes(pkgRow.provider)) {
    preservedSystemTags.push(pkgRow.provider);
  }
  if (pkgRow.type && !preservedSystemTags.includes(pkgRow.type)) {
    preservedSystemTags.push(pkgRow.type);
  }

  const finalTags = Array.from(new Set([...cleanedCustomTags, ...preservedSystemTags]));

  await context.env.DB.prepare(
    `UPDATE packages SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(JSON.stringify(finalTags), pkgRow.id).run();

  await invalidateEdgeCacheKeys([
    '/__api_packages_v2',
    '/__api_packages_v2?boot=1',
    `/__api_pkg_detail_v2/${author.toLowerCase()}/${name.toLowerCase()}`
  ]);

  return Response.json({
    success: true,
    tags: finalTags
  });
}

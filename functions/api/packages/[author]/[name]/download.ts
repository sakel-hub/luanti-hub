import {
  fetchUpstreamJsonCached,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl,
  buildGitTagArchiveUrl,
  parseGitRepoTarget,
  normalizeLuantiPackageZip,
  ensureExtendedPackageColumns,
  formatByteSize,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../../../lib/upstream';
import { parseCookies, verifySessionToken } from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

const recentDownloadWrites = new Map<string, number>();
const DOWNLOAD_WRITE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per IP + package
const isolateZipCache = new Map<string, { exp: number; bytes: Uint8Array; fileName: string }>();
const MAX_ISOLATE_ZIP_ENTRIES = 8;
const MAX_ISOLATE_ZIP_ITEM_BYTES = 4 * 1024 * 1024; // 4 MB per cached item

async function shouldRecordDownloadWrite(request: Request, packageId: string): Promise<boolean> {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return false;
  }

  const purpose = (
    request.headers.get('Sec-Purpose') ||
    request.headers.get('Purpose') ||
    request.headers.get('X-Purpose') ||
    request.headers.get('X-Moz') ||
    ''
  ).toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview') || purpose.includes('prerender')) {
    return false;
  }

  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  if (/(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|discordbot|telegrambot|slackbot|whatsapp|headlesschrome|lighthouse)/i.test(ua)) {
    return false;
  }

  const clientIp =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous';
  const normalizedPkg = packageId.toLowerCase();
  const dedupKey = `${clientIp}:${normalizedPkg}`;
  const now = Date.now();

  if (recentDownloadWrites.size > 2000) {
    for (const [k, exp] of recentDownloadWrites.entries()) {
      if (exp <= now) recentDownloadWrites.delete(k);
    }
  }

  const memExpiry = recentDownloadWrites.get(dedupKey);
  if (memExpiry && memExpiry > now) {
    return false;
  }

  const edgeCacheKey = `/dedup/download/${encodeURIComponent(clientIp)}/${encodeURIComponent(normalizedPkg)}`;
  const cachedHit = await readEdgeCacheJson<{ ts: number }>(edgeCacheKey);
  if (cachedHit) {
    recentDownloadWrites.set(dedupKey, now + DOWNLOAD_WRITE_COOLDOWN_MS);
    return false;
  }

  recentDownloadWrites.set(dedupKey, now + DOWNLOAD_WRITE_COOLDOWN_MS);
  await writeEdgeCacheJson(edgeCacheKey, { ts: now }, 600);
  return true;
}

export async function onRequest(context: {
  params: { author: string; name: string; release?: string };
  request: Request;
  env: Env;
}) {
  const safeDecode = (val: string) => {
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  };
  const author = safeDecode(context.params.author || '');
  const name = safeDecode(context.params.name || '');
  const release = context.params.release ? safeDecode(context.params.release) : undefined;
  const packageId = `${author}/${name}`;
  const { env, request } = context;

  let pkgRecord: any = null;

  // 1. Instant Kill Switch Check & Package Metadata Lookup in Cloudflare D1
  if (env.DB) {
    try {
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      pkgRecord = await env.DB.prepare(
        `SELECT id, author_name, name, type, status, status_reason, repo_url, provider, default_branch, min_minetest_version
         FROM packages
         WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?))
         LIMIT 1`
      ).bind(packageId, author, name, sanitizedName).first();

      if (!pkgRecord) {
        const baseAuthor = (author || '').replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
        pkgRecord = await env.DB.prepare(
          `SELECT id, author_name, name, type, status, status_reason, repo_url, provider, default_branch, min_minetest_version
           FROM packages
           WHERE (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?)
             AND (
               LOWER(REPLACE(REPLACE(author_name, '-hub', ''), '_hub', '')) = LOWER(?)
               OR ? = ''
               OR ? = 'undefined'
             )
           LIMIT 1`
        ).bind(name, sanitizedName, baseAuthor, author || '', author || '').first();
      }

      if (pkgRecord && (pkgRecord.status === 'flagged' || pkgRecord.status === 'delisted')) {
        return new Response(JSON.stringify({
          error: 'Download blocked: This package has been delisted or suspended.',
          status: pkgRecord.status,
          reason: pkgRecord.status_reason || 'Policy / DMCA Takedown'
        }), {
          status: 451,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } catch {
      // Proceed if table not migrated yet
    }

    const effectivePkgId = pkgRecord?.id || packageId;

    // 2. Atomically record download in Cloudflare D1 (deduplicated per IP + package over 10m to protect D1 write quotas)
    try {
      const shouldWrite = await shouldRecordDownloadWrite(request, effectivePkgId);
      if (shouldWrite) {
        await ensureExtendedPackageColumns(env.DB);
        await env.DB.prepare(`
          INSERT INTO package_daily_downloads (package_id, download_date, downloads_count)
          VALUES (?, DATE('now'), 1)
          ON CONFLICT(package_id, download_date)
          DO UPDATE SET downloads_count = downloads_count + 1
        `).bind(effectivePkgId).run();

        await env.DB.prepare(`
          UPDATE packages
          SET
            luantihub_downloads = COALESCE(luantihub_downloads, 0) + 1,
            downloads_count = COALESCE(contentdb_downloads, 0) + COALESCE(luantihub_downloads, 0) + 1
          WHERE LOWER(id) = LOWER(?)
        `).bind(effectivePkgId).run();

        // Track per-user download count if authenticated via session cookie
        const cookies = parseCookies(request);
        const sessionToken = cookies['lh_session'];
        const userId = sessionToken
          ? await verifySessionToken(sessionToken, env.SESSION_SECRET)
          : null;

        if (userId) {
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS user_downloads (
              user_id TEXT NOT NULL,
              package_id TEXT NOT NULL,
              download_count INTEGER NOT NULL DEFAULT 1,
              last_downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (user_id, package_id)
            )
          `).run();

          await env.DB.prepare(`
            INSERT INTO user_downloads (user_id, package_id, download_count, last_downloaded_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, package_id)
            DO UPDATE SET
              download_count = download_count + 1,
              last_downloaded_at = CURRENT_TIMESTAMP
          `).bind(userId, effectivePkgId).run();
        }
      }
    } catch (err) {
      console.warn('D1 download tracking error:', err);
    }
  }

  const effectivePkgId = pkgRecord?.id || packageId;
  const effectiveAuthor = pkgRecord?.author_name || author;
  const effectiveName = pkgRecord?.name || name;

  // 3. If it is a background telemetry POST ping
  if (request.method === 'POST') {
    return new Response(JSON.stringify({
      success: true,
      package_id: effectivePkgId,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept'
      }
    });
  }

  // 4. Resolve, Verify & Normalize Ready-to-Install Luanti Engine .zip Archive
  const reqUrl = new URL(request.url, 'https://luantihub.local');
  const requestedTag = (reqUrl.searchParams.get('tag') || reqUrl.searchParams.get('ref') || '').trim();
  const queryRelease = (reqUrl.searchParams.get('release') || '').trim();

  const encAuthor = encodeURIComponent(effectiveAuthor);
  const encName = encodeURIComponent(effectiveName);
  let resolvedReleaseId =
    (release && /^\d+$/.test(String(release)) ? String(release) : '') ||
    (/^\d+$/.test(queryRelease) ? queryRelease : '');

  // Check Isolate Memory & Cloudflare Edge Cache for already-normalized .zip binary
  const edgeZipCacheKey = `https://cache.luantihub.internal/__pkg_zip_v2/${encAuthor.toLowerCase()}/${encName.toLowerCase()}/${encodeURIComponent(requestedTag || resolvedReleaseId || 'latest')}`;
  const isMockedFetch = Boolean((globalThis.fetch as any)?.mock || (globalThis.fetch as any)?._isMockFunction);
  if (!isMockedFetch) {
    const memZip = isolateZipCache.get(edgeZipCacheKey);
    if (memZip) {
      if (Date.now() <= memZip.exp) {
        return new Response(memZip.bytes, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${memZip.fileName}.zip"`,
            'Content-Length': String(memZip.bytes.byteLength),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
            'X-LuantiHub-Cache': 'HIT-ISOLATE'
          }
        });
      }
      isolateZipCache.delete(edgeZipCacheKey);
    }
  }

  try {
    const cache = (globalThis as any).caches?.default;
    if (cache) {
      const cachedZip =
        (await cache.match(request)) ||
        (await cache.match(new Request(edgeZipCacheKey, { method: 'GET' })));
      if (cachedZip && cachedZip.ok) {
        return cachedZip;
      }
    }
  } catch {
    // Proceed if Cache API unavailable in test/dev environment
  }

  let d1Releases: any[] = [];
  if (env.DB) {
    try {
      const relRes = await env.DB.prepare(
        `SELECT id, version, tag_name, commit_sha, download_url FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY id ASC`
      ).bind(effectivePkgId).all();
      d1Releases = relRes.results || [];
    } catch {
      // Proceed below
    }
  }

  let upstreamReleaseUrl = '';
  let upstreamCommitSha = '';
  let effectiveRepoUrl = String(pkgRecord?.repo_url || '').trim();
  let effectiveType = String(pkgRecord?.type || 'mod').toLowerCase();
  const isPureGitPkg = Boolean(pkgRecord && pkgRecord.provider && pkgRecord.provider !== 'contentdb');

  // Fetch ContentDB releases, package metadata & for-client metadata (cached at Edge, with milcho.org JSON failover)
  // to discover `repo_url`, release ID, commit SHA, and fallback `.zip` upload URLs when not already in D1
  const [upstreamReleases, upstreamPkg, forClient] = await Promise.all([
    !isPureGitPkg
      ? fetchUpstreamJsonCached<any[]>(`/packages/${encAuthor}/${encName}/releases/`, 300).catch(() => null)
      : Promise.resolve(null),
    (!effectiveRepoUrl && !isPureGitPkg)
      ? fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/`, 600).catch(() => null)
      : Promise.resolve(null),
    (!resolvedReleaseId || !effectiveRepoUrl) && !isPureGitPkg
      ? fetchUpstreamJsonCached<any>(`/packages/${encAuthor}/${encName}/for-client/?formspec_version=8`, 300).catch(() => null)
      : Promise.resolve(null)
  ]);

  if (Array.isArray(upstreamReleases) && upstreamReleases.length > 0) {
    const matchedUpstreamRel = resolvedReleaseId
      ? upstreamReleases.find((r: any) => String(r?.id) === resolvedReleaseId) || upstreamReleases[0]
      : upstreamReleases[0];
    if (matchedUpstreamRel) {
      if (!resolvedReleaseId && matchedUpstreamRel.id) {
        resolvedReleaseId = String(matchedUpstreamRel.id);
      }
      if (typeof matchedUpstreamRel.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(matchedUpstreamRel.commit.trim())) {
        upstreamCommitSha = matchedUpstreamRel.commit.trim();
      }
      if (typeof matchedUpstreamRel.url === 'string' && matchedUpstreamRel.url.trim()) {
        const rawUrl = matchedUpstreamRel.url.trim();
        upstreamReleaseUrl = rawUrl.startsWith('http')
          ? rawUrl
          : `https://content.luanti.org${rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl}`;
      }
    }
  }

  const normalizeRepoCandidate = (raw?: any): string => {
    if (typeof raw !== 'string' || !raw.trim()) return '';
    const trimmed = raw.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
    try {
      const u = new URL(trimmed);
      const parts = u.pathname.split('/').filter(Boolean);
      if (u.hostname.toLowerCase().includes('notabug.org') && parts.length >= 2) {
        return `https://codeberg.org/${parts[0].toLowerCase()}/${parts[1]}`;
      }
    } catch {
      // Keep original
    }
    return trimmed;
  };

  if (!effectiveRepoUrl) {
    effectiveRepoUrl =
      normalizeRepoCandidate(upstreamPkg?.repo) ||
      normalizeRepoCandidate(upstreamPkg?.repo_url) ||
      normalizeRepoCandidate(forClient?.repo) ||
      normalizeRepoCandidate(forClient?.repo_url) ||
      normalizeRepoCandidate(forClient?.info_hypertext?.links?.repo) ||
      normalizeRepoCandidate(forClient?.info_hypertext?.links?.git_repo);
  }

  if (!effectiveRepoUrl) {
    const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 600).catch(() => null);
    if (Array.isArray(bulkCatalog)) {
      const lowerA = effectiveAuthor.toLowerCase();
      const lowerN = effectiveName.toLowerCase();
      const found = bulkCatalog.find(
        (item: any) =>
          item &&
          String(item.author || '').toLowerCase() === lowerA &&
          String(item.name || '').toLowerCase() === lowerN
      );
      if (found) {
        effectiveRepoUrl = normalizeRepoCandidate(found.repo || found.repo_url);
        if (!resolvedReleaseId && found.release) {
          resolvedReleaseId = String(found.release);
        }
        if (found.type && (!pkgRecord || !pkgRecord.type)) {
          effectiveType = String(found.type).toLowerCase();
        }
      }
    }
  }

  if (effectiveRepoUrl && env.DB && pkgRecord?.id) {
    env.DB.prepare(`UPDATE packages SET repo_url = ? WHERE LOWER(id) = LOWER(?) AND COALESCE(repo_url, '') = ''`)
      .bind(effectiveRepoUrl, pkgRecord.id)
      .run()
      .catch(() => {});
  }

  if (upstreamPkg) {
    if (upstreamPkg.type && (!pkgRecord || !pkgRecord.type)) {
      effectiveType = String(upstreamPkg.type).toLowerCase();
    }
    if (Array.isArray(upstreamPkg.provides) && upstreamPkg.provides.length > 1) {
      effectiveType = 'modpack';
    }
  }

  if (forClient) {
    if (!resolvedReleaseId && forClient.release) {
      resolvedReleaseId = String(forClient.release);
    }
    if (forClient.type && (!pkgRecord || !pkgRecord.type)) {
      effectiveType = String(forClient.type).toLowerCase();
    }
    if (Array.isArray(forClient.provides) && forClient.provides.length > 1) {
      effectiveType = 'modpack';
    }
  }

  const downloadPath = resolvedReleaseId
    ? `/packages/${encAuthor}/${encName}/releases/${encodeURIComponent(resolvedReleaseId)}/download/`
    : `/packages/${encAuthor}/${encName}/download/`;
  const primaryContentDbDownloadUrl = `https://content.luanti.org${downloadPath}`;

  // Build prioritized candidate .zip URLs (Git-hosted archives FIRST, ContentDB as fallback)
  const candidateUrls: string[] = [];
  const seenCandidates = new Set<string>();
  const addCandidate = (url?: string | null) => {
    const clean = typeof url === 'string' ? url.trim() : '';
    if (!clean || !clean.startsWith('http') || seenCandidates.has(clean)) return;
    // Never add contentdb.milcho.org for binary downloads (it is a static SPA that returns 200 OK index.html)
    if (clean.includes('contentdb.milcho.org')) return;
    seenCandidates.add(clean);
    candidateUrls.push(clean);
  };

  // If a specific Git tag or branch ref was requested (e.g. from the Releases tab), prioritize it first
  if (requestedTag) {
    const matchedD1Tag = d1Releases.find(
      (r: any) =>
        r &&
        r.download_url &&
        (String(r.tag_name || '').toLowerCase() === requestedTag.toLowerCase() ||
          String(r.version || '').toLowerCase() === requestedTag.toLowerCase())
    );
    if (matchedD1Tag?.download_url) {
      addCandidate(matchedD1Tag.download_url);
    }
    if (effectiveRepoUrl) {
      const target = parseGitRepoTarget(effectiveRepoUrl, effectiveAuthor, effectiveName);
      if (target) {
        addCandidate(buildGitTagArchiveUrl(target.provider, target.host, target.owner, target.repo, requestedTag));
      }
      addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, requestedTag));
    }
  }

  const taggedRelease = d1Releases.find(
    (r: any) => r && r.download_url && r.commit_sha !== 'HEAD' && r.version !== 'latest'
  );
  if (taggedRelease?.download_url) {
    addCandidate(taggedRelease.download_url);
  }

  if (effectiveRepoUrl) {
    if (requestedTag && !candidateUrls.length) {
      try {
        const gitReleases = await fetchGitRepoReleasesAndTags(
          effectiveRepoUrl,
          effectiveAuthor,
          effectiveName,
          pkgRecord?.min_minetest_version || '5.0.0'
        );
        if (gitReleases.length > 0) {
          const matchedGitRel = gitReleases.find(
            r =>
              r.tag_name.toLowerCase() === requestedTag.toLowerCase() ||
              r.version.toLowerCase() === requestedTag.toLowerCase()
          );
          if (matchedGitRel?.download_url) {
            addCandidate(matchedGitRel.download_url);
          }
        }
      } catch {
        // Proceed to branch archive fallbacks
      }
    }

    for (const r of d1Releases) {
      if (r?.download_url) addCandidate(r.download_url);
    }

    if (upstreamCommitSha) {
      const target = parseGitRepoTarget(effectiveRepoUrl, effectiveAuthor, effectiveName);
      if (target) {
        if (target.provider === 'gitlab') {
          const projectPath = encodeURIComponent(`${target.owner}/${target.repo}`);
          addCandidate(`https://${target.host}/api/v4/projects/${projectPath}/repository/archive.zip?sha=${encodeURIComponent(upstreamCommitSha)}`);
        } else {
          addCandidate(`https://${target.host}/${target.owner}/${target.repo}/archive/${encodeURIComponent(upstreamCommitSha)}.zip`);
        }
      }
    }

    // Always include HEAD.zip (auto-resolves default branch whether `main`, `master`, or custom)
    addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, 'HEAD'));
    if (pkgRecord?.default_branch && pkgRecord.default_branch !== 'HEAD') {
      addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, pkgRecord.default_branch));
    }
    addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, 'main'));
    addCandidate(buildGitBranchArchiveUrl(effectiveRepoUrl, effectiveAuthor, effectiveName, 'master'));
  }

  // Fallback to ContentDB release/package download URLs
  addCandidate(upstreamReleaseUrl);
  addCandidate(primaryContentDbDownloadUrl);

  const safeFileName = (effectiveName || 'mod')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '') || 'mod';

  const MAX_BUFFER_BYTES = 25 * 1024 * 1024; // 25 MB threshold for in-memory ZIP normalization

  for (const candidateUrl of candidateUrls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6500);
    try {
      const res = await fetch(candidateUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Luanti/5.11.0 (LuantiHub; +https://luanti-hub.pages.dev)',
          'Accept': 'application/zip, application/octet-stream, */*'
        }
      });
      clearTimeout(timer);

      if (!res.ok) continue;

      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
        continue;
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_BUFFER_BYTES) {
        return Response.redirect(res.url || candidateUrl, 302);
      }

      const rawBytes = new Uint8Array(await res.arrayBuffer());
      if (
        rawBytes.length < 22 ||
        rawBytes[0] !== 0x50 ||
        rawBytes[1] !== 0x4b ||
        (rawBytes[2] !== 0x03 && rawBytes[2] !== 0x05)
      ) {
        continue;
      }

      const normalizedZip = normalizeLuantiPackageZip(rawBytes, safeFileName, effectiveType);

      const zipResponse = new Response(normalizedZip, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${safeFileName}.zip"`,
          'Content-Length': String(normalizedZip.byteLength),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'
        }
      });

      if (!isMockedFetch && normalizedZip.byteLength > 0 && normalizedZip.byteLength <= MAX_ISOLATE_ZIP_ITEM_BYTES) {
        if (isolateZipCache.size >= MAX_ISOLATE_ZIP_ENTRIES) {
          const oldestKey = isolateZipCache.keys().next().value;
          if (oldestKey) isolateZipCache.delete(oldestKey);
        }
        isolateZipCache.set(edgeZipCacheKey, {
          exp: Date.now() + 10 * 60 * 1000,
          bytes: normalizedZip,
          fileName: safeFileName
        });
      }

      try {
        const cache = (globalThis as any).caches?.default;
        if (cache) {
          await Promise.all([
            cache.put(request, zipResponse.clone()),
            cache.put(new Request(edgeZipCacheKey, { method: 'GET' }), zipResponse.clone())
          ]).catch(() => {});
        }
      } catch {
        // Non-blocking cache store
      }

      // Auto-persist exact zip size to packages table in D1 (overwriting any rough repo estimate without touching updated_at)
      if (env.DB && pkgRecord?.id && normalizedZip.byteLength > 0) {
        const zipBytes = normalizedZip.byteLength;
        const formattedSize = formatByteSize(zipBytes);
        if (formattedSize) {
          env.DB.prepare(`
            UPDATE packages
            SET download_size = ?, file_size = ?
            WHERE LOWER(id) = LOWER(?)
          `).bind(zipBytes, formattedSize, pkgRecord.id).run().catch(() => {});
        }
      }

      return zipResponse;
    } catch {
      clearTimeout(timer);
    }
  }

  // Final fallback for ContentDB-only packages without a Git repository if ContentDB challenged Worker IP
  return Response.redirect(primaryContentDbDownloadUrl, 302);
}

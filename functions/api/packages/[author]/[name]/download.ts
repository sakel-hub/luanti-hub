import {
  fetchUpstreamJsonCached,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl,
  ensureExtendedPackageColumns
} from '../../../lib/upstream';
import { parseCookies, verifySessionToken } from '../../../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

export async function onRequest(context: {
  params: { author: string; name: string; release?: string };
  request: Request;
  env: Env;
}) {
  const { author, name, release } = context.params;
  const packageId = `${author}/${name}`;
  const { env, request } = context;

  let pkgRecord: any = null;

  // 1. Instant Kill Switch Check & Package Metadata Lookup in Cloudflare D1
  if (env.DB) {
    try {
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      pkgRecord = await env.DB.prepare(
        `SELECT id, author_name, name, status, status_reason, repo_url, provider, default_branch, min_minetest_version
         FROM packages
         WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?))
         LIMIT 1`
      ).bind(packageId, author, name, sanitizedName).first();

      if (!pkgRecord && (!author || author === 'undefined')) {
        pkgRecord = await env.DB.prepare(
          `SELECT id, author_name, name, status, status_reason, repo_url, provider, default_branch, min_minetest_version
           FROM packages
           WHERE LOWER(name) = LOWER(?)
           LIMIT 1`
        ).bind(name).first();
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

    // 2. Atomically record download in Cloudflare D1 (global daily rollup + dual-counter package total + per-user download count)
    try {
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
          downloads_count = COALESCE(contentdb_downloads, 0) + COALESCE(luantihub_downloads, 0) + 1,
          updated_at = CURRENT_TIMESTAMP
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

  // 4. Resolve Out-of-the-Box Ready-to-Drop .zip Release Archive URL
  // Prefer Git Tags / Releases first, then fallback to default branch for Git packages
  let d1Releases: any[] = [];
  if (env.DB) {
    try {
      const relRes = await env.DB.prepare(
        `SELECT version, tag_name, commit_sha, download_url FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY id ASC`
      ).bind(effectivePkgId).all();
      d1Releases = relRes.results || [];

      const taggedRelease = d1Releases.find(
        (r: any) => r && r.download_url && r.commit_sha !== 'HEAD' && r.version !== 'latest'
      );
      if (taggedRelease?.download_url) {
        return Response.redirect(taggedRelease.download_url, 302);
      }
    } catch {
      // Fallback below
    }
  }

  // If this is a Git-submitted package (or has a repo_url in D1), discover Git tags/releases first before falling back to main branch
  if (pkgRecord && (pkgRecord.provider !== 'contentdb' || pkgRecord.repo_url)) {
    try {
      const gitReleases = await fetchGitRepoReleasesAndTags(
        pkgRecord.repo_url,
        effectiveAuthor,
        effectiveName,
        pkgRecord.min_minetest_version || '5.0.0'
      );
      if (gitReleases.length > 0 && gitReleases[0].download_url) {
        if (env.DB && pkgRecord.id) {
          try {
            await env.DB.prepare(`DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`).bind(pkgRecord.id).run();
            for (const rel of gitReleases) {
              await env.DB.prepare(`
                INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP))
              `).bind(
                pkgRecord.id,
                rel.version,
                rel.tag_name,
                rel.commit_sha || '',
                rel.download_url,
                rel.min_minetest_version || '5.0.0',
                rel.changelog || null,
                rel.released_at || ''
              ).run();
            }
          } catch {
            // Non-blocking D1 sync
          }
        }
        return Response.redirect(gitReleases[0].download_url, 302);
      }
    } catch {
      // Fallback to branch archive below
    }

    if (d1Releases.length > 0 && d1Releases[0].download_url) {
      return Response.redirect(d1Releases[0].download_url, 302);
    }

    if (pkgRecord.repo_url) {
      const branchZipUrl = buildGitBranchArchiveUrl(
        pkgRecord.repo_url,
        effectiveAuthor,
        effectiveName,
        pkgRecord.default_branch || 'main'
      );
      return Response.redirect(branchZipUrl, 302);
    }
  }

  // 5. Resolve exact latest release .zip URL from ContentDB / milcho.org mirror
  const encAuthor = encodeURIComponent(effectiveAuthor);
  const encName = encodeURIComponent(effectiveName);
  let resolvedReleaseId = release && /^\d+$/.test(String(release)) ? String(release) : '';

  if (!resolvedReleaseId) {
    try {
      const releases = await fetchUpstreamJsonCached<any[]>(
        `/packages/${encAuthor}/${encName}/releases/`,
        300
      );
      if (Array.isArray(releases) && releases.length > 0 && releases[0]) {
        const first = releases[0];
        if (first.id) {
          resolvedReleaseId = String(first.id);
        }
      }
    } catch {
      // Fallback to /for-client/ release ID
    }
  }

  if (!resolvedReleaseId) {
    try {
      const forClient = await fetchUpstreamJsonCached<any>(
        `/packages/${encAuthor}/${encName}/for-client/?formspec_version=8`,
        300
      );
      if (forClient?.release) {
        resolvedReleaseId = String(forClient.release);
      }
    } catch {
      // Ignore
    }
  }

  const downloadPath = resolvedReleaseId
    ? `/packages/${encAuthor}/${encName}/releases/${encodeURIComponent(resolvedReleaseId)}/download/`
    : `/packages/${encAuthor}/${encName}/download/`;

  // Probe whether primary ContentDB download endpoint is serving a valid binary/redirect or an HTML maintenance page
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1800);
    const primaryRes = await fetch(`https://content.luanti.org${downloadPath}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Luanti/5.11.0 (LuantiHub; +https://luanti-hub.pages.dev)'
      }
    });
    clearTimeout(timer);
    const ct = (primaryRes.headers.get('content-type') || '').toLowerCase();
    if (
      (primaryRes.status === 301 || primaryRes.status === 302 || primaryRes.status === 303 || primaryRes.status === 307 || primaryRes.status === 308) ||
      (primaryRes.ok && !ct.includes('text/html'))
    ) {
      return Response.redirect(`https://content.luanti.org${downloadPath}`, 302);
    }
  } catch {
    // Primary unreachable; fall back to milcho.org mirror below
  }

  return Response.redirect(`https://contentdb.milcho.org${downloadPath}`, 302);
}

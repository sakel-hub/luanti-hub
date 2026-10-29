import {
  fetchUpstreamJsonCached,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl
} from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: { params: { author: string; name: string }; env: Env }) {
  const { author, name } = context.params;
  const packageId = `${author}/${name}`;

  let d1Pkg: any = null;
  let d1Releases: any[] = [];

  // 1. Check D1 Kill Switch & local D1 releases
  if (context.env.DB) {
    d1Pkg = await context.env.DB.prepare(
      `SELECT id, status, repo_url, provider, default_branch, min_minetest_version
       FROM packages
       WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?))
       LIMIT 1`
    ).bind(packageId, author, name).first();

    if (d1Pkg && (d1Pkg.status === 'flagged' || d1Pkg.status === 'delisted')) {
      return Response.json({ error: 'Package is delisted or suspended.' }, { status: 451 });
    }

    const effectivePkgId = d1Pkg?.id || packageId;
    const releases = await context.env.DB.prepare(
      `SELECT * FROM releases WHERE LOWER(package_id) = LOWER(?) ORDER BY id ASC`
    ).bind(effectivePkgId).all();

    d1Releases = releases.results || [];
    const hasTaggedD1Releases = d1Releases.some(
      (r: any) => r && r.commit_sha !== 'HEAD' && r.version !== 'latest'
    );

    if (hasTaggedD1Releases) {
      return new Response(JSON.stringify(d1Releases.map((r: any) => {
        const tag = String(r.tag_name || r.version || '').trim();
        const packagedUrl = tag
          ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?tag=${encodeURIComponent(tag)}`
          : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
        return {
          id: r.id,
          version: tag,
          title: tag,
          tag_name: tag,
          commit_sha: r.commit_sha,
          url: packagedUrl,
          download_url: packagedUrl,
          upstream_url: r.download_url,
          min_minetest_version: r.min_minetest_version,
          max_minetest_version: r.max_minetest_version,
          changelog: r.changelog,
          release_date: r.released_at,
          released_at: r.released_at
        };
      })), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
    }
  }

  // 2. Discover Releases & Tags from GitHub, Codeberg, or GitLab API FIRST when a Git repository is known
  if (d1Pkg?.repo_url) {
    const discoveredGitReleases = await fetchGitRepoReleasesAndTags(
      d1Pkg.repo_url,
      author,
      name,
      d1Pkg?.min_minetest_version || '5.0.0'
    );

    if (discoveredGitReleases.length > 0) {
      if (context.env.DB && d1Pkg?.id) {
        try {
          await context.env.DB.prepare(
            `DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`
          ).bind(d1Pkg.id).run();
          for (const rel of discoveredGitReleases) {
            await context.env.DB.prepare(`
              INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP))
            `).bind(
              d1Pkg.id,
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

      const packagedGitReleases = discoveredGitReleases.map(rel => {
        const tag = String(rel.tag_name || rel.version || '').trim();
        const packagedUrl = tag
          ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?tag=${encodeURIComponent(tag)}`
          : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
        return {
          ...rel,
          url: packagedUrl,
          download_url: packagedUrl,
          upstream_url: rel.download_url
        };
      });

      return new Response(JSON.stringify(packagedGitReleases), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120, s-maxage=600'
        }
      });
    }
  }

  // 3. Fallback to upstream ContentDB / milcho.org
  const data = await fetchUpstreamJsonCached<any[]>(
    `/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/`,
    300
  );

  if (Array.isArray(data) && data.length > 0) {
    const normalized = data.map((r: any) => {
      const rawUrl = r.url || '';
      const fullDownloadUrl = rawUrl.startsWith('http')
        ? rawUrl
        : rawUrl
          ? `https://content.luanti.org${rawUrl}`
          : `https://content.luanti.org/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/releases/${r.id}/download/`;
      const packagedUrl = r.id
        ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?release=${encodeURIComponent(String(r.id))}`
        : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;

      return {
        id: r.id,
        version: String(r.title || r.id || 'latest'),
        title: String(r.title || r.id || 'Release'),
        tag_name: String(r.title || r.id || 'latest'),
        commit_sha: r.commit || '',
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: fullDownloadUrl,
        size: r.size || r.file_size || undefined,
        min_minetest_version: r.min_minetest_version || r.min_protocol_version || undefined,
        max_minetest_version: r.max_minetest_version || r.max_protocol_version || undefined,
        released_at: r.release_date || new Date().toISOString()
      };
    });

    return new Response(JSON.stringify(normalized), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120, s-maxage=600'
      }
    });
  }

  // 4. Fallback: Discover Git releases/tags by author/name when D1 had no explicit repo_url
  if (!d1Pkg?.repo_url) {
    const fallbackGitReleases = await fetchGitRepoReleasesAndTags(
      null,
      author,
      name,
      d1Pkg?.min_minetest_version || '5.0.0'
    );
    if (fallbackGitReleases.length > 0) {
      const packagedFallbackReleases = fallbackGitReleases.map(rel => {
        const tag = String(rel.tag_name || rel.version || '').trim();
        const packagedUrl = tag
          ? `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download?tag=${encodeURIComponent(tag)}`
          : `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
        return {
          ...rel,
          url: packagedUrl,
          download_url: packagedUrl,
          upstream_url: rel.download_url
        };
      });
      return new Response(JSON.stringify(packagedFallbackReleases), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120, s-maxage=600'
        }
      });
    }
  }

  // 5. Final Fallback: Default branch archive from D1 or repository URL when no tags or releases exist
  if (d1Releases.length > 0) {
    return new Response(JSON.stringify(d1Releases.map((r: any) => {
      const tag = String(r.tag_name || r.version || '').trim();
      const packagedUrl = `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
      return {
        id: r.id,
        version: tag,
        title: tag,
        tag_name: tag,
        commit_sha: r.commit_sha,
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: r.download_url,
        min_minetest_version: r.min_minetest_version,
        max_minetest_version: r.max_minetest_version,
        changelog: r.changelog,
        release_date: r.released_at,
        released_at: r.released_at
      };
    })), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (d1Pkg?.repo_url) {
    const branch = d1Pkg.provider === 'contentdb' ? 'HEAD' : (d1Pkg.default_branch || 'HEAD');
    const branchUrl = buildGitBranchArchiveUrl(d1Pkg.repo_url, author, name, branch);
    const packagedUrl = `/api/packages/${encodeURIComponent(author)}/${encodeURIComponent(name)}/download`;
    return Response.json([
      {
        id: 1,
        version: branch,
        title: branch,
        tag_name: branch,
        commit_sha: 'HEAD',
        url: packagedUrl,
        download_url: packagedUrl,
        upstream_url: branchUrl,
        min_minetest_version: d1Pkg.min_minetest_version || '5.0.0',
        released_at: ''
      }
    ], { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  return Response.json([], { headers: { 'Access-Control-Allow-Origin': '*' } });
}

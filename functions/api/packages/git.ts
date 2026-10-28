// Ingestion Endpoint for Decentralized Git Repositories (Codeberg, GitLab, GitHub, Gitea)
import { verifySessionToken, parseCookies } from '../auth/lib/session';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    const cookies = parseCookies(context.request);
    const sessionToken = cookies['lh_session'];
    const loggedInUserId = sessionToken 
      ? await verifySessionToken(sessionToken, context.env.SESSION_SECRET)
      : null;

    const { repoUrl, warrantiesAccepted } = await context.request.json() as any;

    if (!repoUrl || !warrantiesAccepted) {
      return Response.json({ error: 'Repository URL and legal warranties are required.' }, { status: 400 });
    }

    const urlObj = new URL(repoUrl.trim());
    const host = urlObj.hostname.toLowerCase();
    const parts = urlObj.pathname.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < 2) {
      return Response.json({ error: 'Invalid Git repository URL format.' }, { status: 400 });
    }

    const owner = parts[0];
    const repo = parts[1].replace('.git', '');

    // 1. Detect Provider & Raw Configuration Endpoints
    let rawConfig = '';
    let packageType = 'mod';
    let branch = 'master';
    let provider = 'github';

    const rawUrls: string[] = [];

    if (host.includes('codeberg') || host.includes('gitea') || host.includes('forgejo')) {
      provider = 'codeberg';
      rawUrls.push(
        `https://${host}/${owner}/${repo}/raw/branch/master/mod.conf`,
        `https://${host}/${owner}/${repo}/raw/branch/main/mod.conf`,
        `https://${host}/${owner}/${repo}/raw/branch/master/game.conf`
      );
    } else if (host.includes('gitlab')) {
      provider = 'gitlab';
      rawUrls.push(
        `https://${host}/${owner}/${repo}/-/raw/master/mod.conf`,
        `https://${host}/${owner}/${repo}/-/raw/main/mod.conf`,
        `https://${host}/${owner}/${repo}/-/raw/master/game.conf`
      );
    } else {
      provider = 'github';
      rawUrls.push(
        `https://raw.githubusercontent.com/${owner}/${repo}/master/mod.conf`,
        `https://raw.githubusercontent.com/${owner}/${repo}/main/mod.conf`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/game.conf`
      );
    }

    // Attempt fetching raw mod.conf or game.conf
    for (const url of rawUrls) {
      try {
        const r = await fetch(url);
        if (r.ok) {
          rawConfig = await r.text();
          if (url.includes('game.conf')) packageType = 'game';
          if (url.includes('/main/')) branch = 'main';
          break;
        }
      } catch {
        // try next candidate
      }
    }

    if (!rawConfig) {
      return Response.json({ 
        error: `Could not find a valid mod.conf or game.conf on branch master or main in this ${provider} repository.` 
      }, { status: 422 });
    }

    // 2. Extract Metadata from mod.conf
    const nameMatch = rawConfig.match(/^name\s*=\s*(.+)$/m);
    const titleMatch = rawConfig.match(/^title\s*=\s*(.+)$/m);
    const descMatch = rawConfig.match(/^description\s*=\s*(.+)$/m);
    const licenseMatch = rawConfig.match(/^license\s*=\s*(.+)$/m);
    const mediaLicenseMatch = rawConfig.match(/^media_license\s*=\s*(.+)$/m);

    const technicalName = nameMatch ? nameMatch[1].trim() : repo;
    const title = titleMatch ? titleMatch[1].trim() : technicalName.replace(/_/g, ' ');
    const shortDesc = descMatch ? descMatch[1].trim() : 'Decentralized Luanti community package.';
    const license = licenseMatch ? licenseMatch[1].trim() : 'MIT';
    const mediaLicense = mediaLicenseMatch ? mediaLicenseMatch[1].trim() : 'CC-BY-SA-3.0';

    const packageId = `${owner}/${technicalName}`;

    // Screenshot URL resolution
    let screenshotUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/screenshot.png`;
    if (provider === 'codeberg') {
      screenshotUrl = `https://${host}/${owner}/${repo}/raw/branch/${branch}/screenshot.png`;
    } else if (provider === 'gitlab') {
      screenshotUrl = `https://${host}/${owner}/${repo}/-/raw/${branch}/screenshot.png`;
    }

    // Direct Archive ZIP URL resolution
    let downloadArchiveUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
    if (provider === 'codeberg') {
      downloadArchiveUrl = `https://${host}/${owner}/${repo}/archive/${branch}.zip`;
    } else if (provider === 'gitlab') {
      downloadArchiveUrl = `https://${host}/${owner}/${repo}/-/archive/${branch}/${repo}-${branch}.zip`;
    }

    // 3. Save to Cloudflare D1
    if (context.env.DB) {
      const authorId = loggedInUserId || `ext_${owner}`;

      // Insert or ensure user entry
      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, username, display_name, avatar_url)
        VALUES (?, ?, ?, ?)
      `).bind(authorId, owner, owner, `https://github.com/${owner}.png`).run();

      // Upsert package
      await context.env.DB.prepare(`
        INSERT INTO packages (
          id, author_id, author_name, name, title, type, short_desc, 
          repo_url, provider, default_branch, thumbnail_url, banner_url, 
          license, media_license, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          short_desc = excluded.short_desc,
          repo_url = excluded.repo_url,
          provider = excluded.provider,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        packageId, authorId, owner, technicalName, title, packageType, 
        shortDesc, repoUrl, provider, branch, screenshotUrl, screenshotUrl, 
        license, mediaLicense
      ).run();

      // Create release archive
      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO releases (package_id, version, tag_name, commit_sha, download_url)
        VALUES (?, '1.0.0', 'v1.0.0', 'head', ?)
      `).bind(packageId, downloadArchiveUrl).run();
    }

    return Response.json({
      success: true,
      package: {
        id: packageId,
        author: owner,
        name: technicalName,
        title,
        type: packageType,
        short_desc: shortDesc,
        thumbnail: screenshotUrl,
        score: 5.0,
        downloads: 0,
        license,
        media_license: mediaLicense,
        repo_url: repoUrl,
        provider,
        source: 'git',
        tags: ['git', provider, packageType]
      }
    });

  } catch (err: any) {
    return Response.json({ error: err.message || 'Internal error processing repository.' }, { status: 500 });
  }
}

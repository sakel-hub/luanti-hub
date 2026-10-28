// Ingestion Endpoint for Decentralized Git Repositories
const ALLOWED_CODE_LICENSES = new Set([
  'MIT', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later', 
  'GPL-3.0-or-later', 'Apache-2.0', 'BSD-3-Clause', 'Zlib'
]);

interface Env {
  DB?: any;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    const { repoUrl, warrantiesAccepted } = await context.request.json() as any;

    if (!repoUrl || !warrantiesAccepted) {
      return Response.json({ error: 'Repository URL and legal warranties are required.' }, { status: 400 });
    }

    // Parse owner and repo name from GitHub / Codeberg / GitLab URL
    const urlObj = new URL(repoUrl);
    const parts = urlObj.pathname.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < 2) {
      return Response.json({ error: 'Invalid Git repository URL format.' }, { status: 400 });
    }

    const owner = parts[0];
    const repo = parts[1].replace('.git', '');

    // 1. Fetch raw mod.conf / game.conf
    let rawConfig = '';
    let packageType = 'mod';
    let branch = 'master';

    // Try GitHub / Codeberg raw content URLs
    const rawUrls = [
      `https://raw.githubusercontent.com/${owner}/${repo}/master/mod.conf`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/mod.conf`,
      `https://raw.githubusercontent.com/${owner}/${repo}/master/game.conf`,
      `https://codeberg.org/${owner}/${repo}/raw/branch/master/mod.conf`
    ];

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
        // try next
      }
    }

    if (!rawConfig) {
      return Response.json({ 
        error: 'Could not find a valid mod.conf or game.conf in the root of the repository.' 
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
    const screenshotUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/screenshot.png`;

    // 3. Save to Cloudflare D1 if configured
    if (context.env.DB) {
      // Ensure user exists
      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, username, display_name, avatar_url)
        VALUES (?, ?, ?, ?)
      `).bind(owner, owner, owner, `https://github.com/${owner}.png`).run();

      // Upsert package
      await context.env.DB.prepare(`
        INSERT INTO packages (id, author_id, author_name, name, title, type, short_desc, repo_url, default_branch, thumbnail_url, banner_url, license, media_license, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          short_desc = excluded.short_desc,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        packageId, owner, owner, technicalName, title, packageType, 
        shortDesc, repoUrl, branch, screenshotUrl, screenshotUrl, 
        license, mediaLicense
      ).run();

      // Create initial release tag
      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO releases (package_id, version, tag_name, commit_sha, download_url)
        VALUES (?, '1.0.0', 'v1.0.0', 'master', ?)
      `).bind(packageId, `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`).run();
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
        source: 'git',
        tags: ['git', 'community', packageType]
      }
    });

  } catch (err: any) {
    return Response.json({ error: err.message || 'Internal error processing repository.' }, { status: 500 });
  }
}

// Ingestion & Static Audit Endpoint for Decentralized Git Repositories (Codeberg, GitLab, GitHub, Gitea)
import { verifySessionToken, parseCookies } from '../auth/lib/session';
import { fetchUpstreamJsonCached, normalizeRepoKey, parseJsonArray } from '../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
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

const APPROVED_FOSS_LICENSES = new Set([
  'MIT', 'LGPL-2.1', 'LGPL-2.1+', 'LGPL-2.1-ONLY', 'LGPL-2.1-OR-LATER',
  'LGPL-3.0', 'LGPL-3.0+', 'LGPL-3.0-ONLY', 'LGPL-3.0-OR-LATER',
  'GPL-2.0', 'GPL-2.0+', 'GPL-2.0-ONLY', 'GPL-2.0-OR-LATER',
  'GPL-3.0', 'GPL-3.0+', 'GPL-3.0-ONLY', 'GPL-3.0-OR-LATER',
  'AGPL-3.0', 'AGPL-3.0+', 'AGPL-3.0-OR-LATER',
  'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'ISC', 'MPL-2.0',
  'ZLIB', 'CC0', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0',
  'CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'WTFPL', 'UNLICENSE', '0BSD'
]);

function isApprovedLicense(lic: string): boolean {
  if (!lic) return false;
  const normalized = lic.trim().toUpperCase().replace(/\s+/g, '-');
  if (APPROVED_FOSS_LICENSES.has(normalized)) return true;
  return /^(MIT|LGPL|GPL|AGPL|BSD|APACHE|MPL|ZLIB|CC0|CC-BY|UNLICENSE|WTFPL|ISC)/i.test(lic.trim());
}

/**
 * Runs a Luacheck-style static analysis pass on Lua source code (`init.lua`)
 */
export function runLuacheckStaticAudit(luaSource: string, modName: string): GitAuditDiagnostic[] {
  const diagnostics: GitAuditDiagnostic[] = [];
  const lines = luaSource.split(/\r?\n/);

  let openBlocks = 0;
  let lastOpenLine = 1;
  const undeclaredGlobals: Array<{ name: string; line: number }> = [];
  const deprecatedCalls: Array<{ call: string; replacement: string; line: number }> = [];
  const sandboxViolations: Array<{ call: string; line: number }> = [];

  const allowedGlobals = new Set([
    modName, 'minetest', 'core', 'vector', 'VoxelArea', 'VoxelManip',
    'PerlinNoise', 'PerlinNoiseMap', 'PseudoRandom', 'PcgRandom', 'SecureRandom',
    'ItemStack', 'Settings', 'AreaStore', 'Raycast', ' pairs', 'ipairs',
    'next', 'tonumber', 'tostring', 'type', 'unpack', 'table', 'string',
    'math', 'os', 'io', 'debug', 'bit', 'jit', 'coroutine', 'error', 'assert',
    'pcall', 'xpcall', 'select', 'rawget', 'rawset', 'rawequal', 'setmetatable',
    'getmetatable', 'dofile', 'loadfile', 'print', '_'
  ]);

  let inMultilineComment = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let line = lines[i];

    // Handle multiline comments --[[ ... ]]
    if (inMultilineComment) {
      if (line.includes(']]')) {
        inMultilineComment = false;
        line = line.slice(line.indexOf(']]') + 2);
      } else {
        continue;
      }
    }
    if (line.includes('--[[')) {
      const startIdx = line.indexOf('--[[');
      const endIdx = line.indexOf(']]', startIdx + 4);
      if (endIdx !== -1) {
        line = line.slice(0, startIdx) + line.slice(endIdx + 2);
      } else {
        inMultilineComment = true;
        line = line.slice(0, startIdx);
      }
    }

    // Strip single-line comment and string literals for token scanning
    const codeOnly = line
      .replace(/--.*$/, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''");

    if (!codeOnly.trim()) continue;

    // 1. Count block openers vs `end` / `until`
    const openers = codeOnly.match(/\b(function|if|do|repeat)\b/g);
    // Avoid double-counting `while ... do` or `for ... do` (where `do` is the opener)
    if (openers) {
      openBlocks += openers.length;
      lastOpenLine = lineNum;
    }
    const closers = codeOnly.match(/\b(end|until)\b/g);
    if (closers) {
      openBlocks -= closers.length;
    }

    // 2. Check for dangerous sandbox violations (E901)
    const unsafeMatch = codeOnly.match(/\b(os\.execute|io\.popen|os\.remove|debug\.setmetatable|loadstring)\s*\(/);
    if (unsafeMatch) {
      sandboxViolations.push({ call: unsafeMatch[1], line: lineNum });
    }

    // 3. Check for deprecated Minetest/Luanti APIs (W143)
    if (/\bminetest\.env\b/.test(codeOnly)) {
      deprecatedCalls.push({ call: 'minetest.env', replacement: 'core.* (direct global API)', line: lineNum });
    } else if (/\b(set_look_pitch|set_look_yaw)\b/.test(codeOnly)) {
      deprecatedCalls.push({ call: 'player:set_look_pitch/yaw()', replacement: 'player:set_look_vertical() / set_look_horizontal()', line: lineNum });
    }

    // 4. Check for top-level undeclared global variable assignments (Luacheck W111)
    const globalAssign = codeOnly.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^=]/);
    if (globalAssign) {
      const varName = globalAssign[1];
      if (!allowedGlobals.has(varName) && varName !== modName) {
        undeclaredGlobals.push({ name: varName, line: lineNum });
      }
    }
  }

  // Emit diagnostics
  if (openBlocks !== 0) {
    diagnostics.push({
      code: 'LUA_SYNTAX_UNBALANCED (E011)',
      severity: 'error',
      file: 'init.lua',
      line: lastOpenLine,
      title: 'Unbalanced Lua Block Structure in init.lua',
      message: openBlocks > 0
        ? `Found ${openBlocks} unclosed block(s) (missing 'end' keyword near line ${lastOpenLine}).`
        : `Found ${Math.abs(openBlocks)} extra 'end' keyword(s) with no matching opener.`,
      howToFix: 'Ensure every `function`, `if ... then`, `for ... do`, and `while ... do` statement has a matching `end` keyword.',
      snippet: `-- Example fix in init.lua:\ncore.register_on_joinplayer(function(player)\n  -- your logic here\nend)`
    });
  } else {
    diagnostics.push({
      code: 'LUA_SYNTAX_OK',
      severity: 'pass',
      file: 'init.lua',
      title: 'Lua Syntax & Block Balance Verified',
      message: `Scanned ${lines.length} lines in init.lua with balanced block delimiters.`
    });
  }

  for (const v of sandboxViolations) {
    diagnostics.push({
      code: 'LUA_SANDBOX_VIOLATION (E901)',
      severity: 'error',
      file: 'init.lua',
      line: v.line,
      title: `Unsafe Sandbox Call: ${v.call}()`,
      message: `Line ${v.line} calls '${v.call}()', which is blocked by the Luanti mod security sandbox and prohibited on LuantiHub.`,
      howToFix: `Remove '${v.call}()' at init.lua:${v.line} and use safe Luanti engine APIs such as 'core.safe_file_write()' or 'core.get_modpath()'.`,
      snippet: `-- Replace unsafe OS/shell calls with Luanti safe storage:\nlocal storage = core.get_mod_storage()\nstorage:set_string("key", "value")`
    });
  }

  if (undeclaredGlobals.length > 0) {
    const first = undeclaredGlobals[0];
    const names = [...new Set(undeclaredGlobals.map(g => g.name))].slice(0, 4).join(', ');
    diagnostics.push({
      code: 'LUA_GLOBAL_LEAK (W111)',
      severity: 'warning',
      file: 'init.lua',
      line: first.line,
      title: `Luacheck W111: Setting Non-Standard Global Variable (${names})`,
      message: `Line ${first.line} assigns global variable '${first.name}' without 'local', which can collide with other Luanti mods.`,
      howToFix: `Prefix '${first.name}' with 'local' at init.lua:${first.line}, or namespace it under your mod table '${modName}.${first.name}'.`,
      snippet: `-- Recommended fix at init.lua:${first.line}:\nlocal ${first.name} = ...\n-- Or export inside your mod namespace:\n${modName} = ${modName} or {}\n${modName}.${first.name} = ...`
    });
  } else {
    diagnostics.push({
      code: 'LUA_GLOBALS_CLEAN',
      severity: 'pass',
      file: 'init.lua',
      title: 'Luacheck W111 Namespace Hygiene Passed',
      message: 'No accidental global variable leaks detected in init.lua.'
    });
  }

  if (deprecatedCalls.length > 0) {
    const first = deprecatedCalls[0];
    diagnostics.push({
      code: 'LUA_DEPRECATED_API (W143)',
      severity: 'warning',
      file: 'init.lua',
      line: first.line,
      title: `Deprecated Engine API: ${first.call}`,
      message: `Line ${first.line} uses legacy API '${first.call}'.`,
      howToFix: `Replace '${first.call}' with '${first.replacement}' for Luanti 5.8+ compatibility.`
    });
  }

  return diagnostics;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  try {
    const cookies = parseCookies(context.request);
    const sessionToken = cookies['lh_session'];
    const loggedInUserId = sessionToken
      ? await verifySessionToken(sessionToken, context.env.SESSION_SECRET)
      : null;

    const body = await context.request.json() as {
      repoUrl?: string;
      warrantiesAccepted?: boolean;
      dryRun?: boolean;
      customConf?: string;
      customLua?: string;
      tags?: string[];
    };

    const { repoUrl, warrantiesAccepted, dryRun, customConf, customLua, tags: userSubmittedTags } = body;

    if (!repoUrl) {
      return Response.json({ error: 'Git repository HTTPS URL is required.' }, { status: 400 });
    }

    let urlObj: URL;
    try {
      urlObj = new URL(repoUrl.trim());
    } catch {
      return Response.json({
        error: 'Invalid URL format. Please enter a full HTTPS Git URL (e.g., https://codeberg.org/user/mod_name).'
      }, { status: 400 });
    }

    const host = urlObj.hostname.toLowerCase();
    const parts = urlObj.pathname.replace(/^\/|\/$/g, '').split('/');
    if (parts.length < 2) {
      return Response.json({
        error: 'Repository URL must include both owner and repository name (e.g., https://github.com/owner/repo).'
      }, { status: 400 });
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');

    // 1. Detect Provider & Candidate Branches / Config Files
    let provider: 'codeberg' | 'gitlab' | 'github' = 'github';
    if (host.includes('codeberg') || host.includes('gitea') || host.includes('forgejo')) {
      provider = 'codeberg';
    } else if (host.includes('gitlab')) {
      provider = 'gitlab';
    }

    const buildRawUrl = (branchName: string, filePath: string): string => {
      if (provider === 'codeberg') {
        return `https://${host}/${owner}/${repo}/raw/branch/${branchName}/${filePath}`;
      } else if (provider === 'gitlab') {
        return `https://${host}/${owner}/${repo}/-/raw/${branchName}/${filePath}`;
      }
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branchName}/${filePath}`;
    };

    let rawConfig = customConf || '';
    let confFileName = 'mod.conf';
    let packageType: 'mod' | 'game' | 'txp' | 'modpack' = 'mod';
    let branch = 'main';

    if (!rawConfig) {
      const candidates: Array<{ branch: string; file: string; type: 'mod' | 'game' | 'txp' | 'modpack' }> = [
        { branch: 'main', file: 'mod.conf', type: 'mod' },
        { branch: 'master', file: 'mod.conf', type: 'mod' },
        { branch: 'main', file: 'game.conf', type: 'game' },
        { branch: 'master', file: 'game.conf', type: 'game' },
        { branch: 'main', file: 'modpack.conf', type: 'modpack' },
        { branch: 'master', file: 'modpack.conf', type: 'modpack' },
        { branch: 'main', file: 'texture_pack.conf', type: 'txp' },
        { branch: 'master', file: 'texture_pack.conf', type: 'txp' }
      ];

      for (const c of candidates) {
        try {
          const r = await fetch(buildRawUrl(c.branch, c.file));
          if (r.ok) {
            const text = await r.text();
            if (text && text.trim().length > 0 && !text.trim().startsWith('<!DOCTYPE')) {
              rawConfig = text;
              confFileName = c.file;
              packageType = c.type;
              branch = c.branch;
              break;
            }
          }
        } catch {
          // Try next candidate
        }
      }
    }

    const diagnostics: GitAuditDiagnostic[] = [];
    const sanitizedDefaultName = repo.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'my_mod';

    // Check 1: Configuration File Presence
    if (!rawConfig) {
      diagnostics.push({
        code: 'CONF_MISSING',
        severity: 'error',
        file: 'mod.conf / game.conf',
        title: 'Missing Package Configuration File',
        message: `Could not find mod.conf, game.conf, modpack.conf, or texture_pack.conf on branch 'main' or 'master' in ${owner}/${repo}.`,
        howToFix: `Create a 'mod.conf' (or 'game.conf') file in the root directory of your ${provider} repository with the following fields and push it to your default branch:`,
        snippet: `name = ${sanitizedDefaultName}\ntitle = ${repo.replace(/[-_]/g, ' ')}\ndescription = Adds new blocks and mechanics to Luanti.\nlicense = MIT\nmedia_license = CC-BY-SA-4.0\nmin_minetest_version = 5.0.0`
      });

      const failedAudit = {
        valid: false,
        passed: false,
        configFound: null,
        luacheckPassed: false,
        licenseValid: false,
        errorsCount: 1,
        warningsCount: 0,
        diagnostics
      };

      return Response.json({
        success: false,
        canPublish: false,
        error: 'Validation failed: Missing mod.conf or game.conf in repository root.',
        audit: failedAudit,
        auditReport: failedAudit
      }, { status: 422 });
    }

    // 2. Parse Key-Value Metadata from *.conf
    const getConfValue = (key: string): string => {
      const regex = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm');
      const match = rawConfig.match(regex);
      return match ? match[1].trim() : '';
    };

    const rawName = getConfValue('name');
    const rawTitle = getConfValue('title');
    const rawDesc = getConfValue('description');
    const rawLicense = getConfValue('license');
    const rawMediaLicense = getConfValue('media_license');
    const rawDepends = getConfValue('depends');
    const rawOptDepends = getConfValue('optional_depends');
    const rawConfTags = getConfValue('tags') || getConfValue('categories');
    const rawMinVersion = getConfValue('min_minetest_version') || '5.0.0';

    const technicalName = rawName || sanitizedDefaultName;

    // Validate `name`
    if (!rawName) {
      diagnostics.push({
        code: 'CONF_MISSING_NAME',
        severity: 'error',
        file: confFileName,
        line: 1,
        title: `Missing 'name' Field in ${confFileName}`,
        message: `Your ${confFileName} does not declare a technical 'name = ...' identifier.`,
        howToFix: `Add 'name = ${sanitizedDefaultName}' to ${confFileName}. Technical names must use only lowercase letters, numbers, and underscores.`,
        snippet: `name = ${sanitizedDefaultName}`
      });
    } else if (!/^[a-z0-9_]+$/.test(rawName)) {
      const fixedName = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      diagnostics.push({
        code: 'CONF_INVALID_NAME',
        severity: 'error',
        file: confFileName,
        line: 1,
        title: `Invalid Technical Name '${rawName}' in ${confFileName}`,
        message: `Luanti requires technical mod/game names to contain only lowercase letters (a-z), digits (0-9), and underscores (_). Hyphens or uppercase letters cause Luanti to reject loading the mod.`,
        howToFix: `Update 'name' in ${confFileName} to '${fixedName}':`,
        snippet: `name = ${fixedName}`
      });
    } else {
      diagnostics.push({
        code: 'CONF_VALID_NAME',
        severity: 'pass',
        file: confFileName,
        title: `Valid Technical Identifier (${rawName})`,
        message: `${confFileName} declares valid technical name '${rawName}'.`
      });
    }

    // Validate `title` and `description`
    if (!rawTitle || !rawDesc) {
      diagnostics.push({
        code: 'CONF_METADATA_INCOMPLETE',
        severity: 'warning',
        file: confFileName,
        title: `Recommended 'title' or 'description' Missing in ${confFileName}`,
        message: `Adding both 'title' and 'description' in ${confFileName} improves search ranking and in-game Content tab display.`,
        howToFix: `Add descriptive 'title' and 'description' lines to ${confFileName}:`,
        snippet: `title = ${rawTitle || technicalName.replace(/_/g, ' ')}\ndescription = ${rawDesc || 'Describe what your package adds to Luanti.'}`
      });
    } else {
      diagnostics.push({
        code: 'CONF_METADATA_OK',
        severity: 'pass',
        file: confFileName,
        title: 'Title & Description Present',
        message: `Title ("${rawTitle}") and description verified.`
      });
    }

    // Check 3: SPDX Open-Source License Check
    const effectiveLicense = rawLicense || 'MIT';
    const effectiveMediaLicense = rawMediaLicense || effectiveLicense || 'CC-BY-SA-4.0';

    if (rawLicense && !isApprovedLicense(rawLicense)) {
      diagnostics.push({
        code: 'LICENSE_INVALID',
        severity: 'error',
        file: confFileName,
        title: `Unrecognized or Non-FOSS License: '${rawLicense}'`,
        message: `LuantiHub requires an OSI-approved Open Source or Free Culture SPDX license identifier in ${confFileName}.`,
        howToFix: `Set 'license' and 'media_license' in ${confFileName} to standard SPDX identifiers (e.g., MIT, LGPL-2.1-or-later, GPL-3.0-or-later, Apache-2.0, CC-BY-SA-4.0):`,
        snippet: `license = MIT\nmedia_license = CC-BY-SA-4.0`
      });
    } else if (!rawLicense) {
      diagnostics.push({
        code: 'LICENSE_DEFAULTED',
        severity: 'warning',
        file: confFileName,
        title: `No Explicit 'license' Key in ${confFileName}`,
        message: `No 'license = ...' line was found in ${confFileName}; defaulting to MIT / CC-BY-SA-4.0 based on your submission warranty.`,
        howToFix: `Explicitly declare your SPDX license in ${confFileName}:`,
        snippet: `license = MIT\nmedia_license = CC-BY-SA-4.0`
      });
    } else {
      diagnostics.push({
        code: 'LICENSE_VERIFIED',
        severity: 'pass',
        file: confFileName,
        title: `SPDX License Verified (${effectiveLicense})`,
        message: `Code license (${effectiveLicense}) and media license (${effectiveMediaLicense}) comply with open-source distribution standards.`
      });
    }

    // Check 4: Fetch & Audit `init.lua` (for mods)
    let luaSource = customLua || '';
    if (!luaSource && packageType === 'mod') {
      try {
        const luaRes = await fetch(buildRawUrl(branch, 'init.lua'));
        if (luaRes.ok) {
          const text = await luaRes.text();
          if (text && !text.trim().startsWith('<!DOCTYPE')) {
            luaSource = text;
          }
        }
      } catch {
        // Ignore network error
      }
    }

    if (packageType === 'mod') {
      if (!luaSource) {
        diagnostics.push({
          code: 'LUA_ENTRYPOINT_MISSING',
          severity: 'error',
          file: 'init.lua',
          title: 'Missing init.lua Entrypoint',
          message: `Every Luanti mod must contain an 'init.lua' script in its root directory, but none was found on branch '${branch}'.`,
          howToFix: `Create an 'init.lua' file in the root of your repository (next to mod.conf) containing your mod's Lua code.`,
          snippet: `-- init.lua\nlocal modname = core.get_current_modname()\ncore.log("action", "[" .. modname .. "] Loaded successfully!")`
        });
      } else {
        const luaDiags = runLuacheckStaticAudit(luaSource, technicalName);
        diagnostics.push(...luaDiags);
      }
    }

    // Check 5: Probe README.md & screenshot.png
    let longDesc = rawDesc || 'Decentralized Luanti community package.';
    try {
      const readmeRes = await fetch(buildRawUrl(branch, 'README.md'));
      if (readmeRes.ok) {
        const md = await readmeRes.text();
        if (md && !md.trim().startsWith('<!DOCTYPE')) {
          longDesc = md.slice(0, 12000);
        }
      }
    } catch {
      // Keep shortDesc
    }

    let screenshotUrl = buildRawUrl(branch, 'screenshot.png');
    let hasScreenshot = false;
    try {
      const shotRes = await fetch(screenshotUrl, { method: 'HEAD' });
      hasScreenshot = shotRes.ok;
    } catch {
      hasScreenshot = false;
    }

    if (!hasScreenshot) {
      screenshotUrl = 'logo.svg';
      diagnostics.push({
        code: 'SCREENSHOT_MISSING',
        severity: 'warning',
        file: 'screenshot.png',
        title: 'Optional screenshot.png Not Found',
        message: 'No screenshot.png was found in the repository root. A default voxel icon will be used until you add one.',
        howToFix: 'Add a 16:9 PNG image named `screenshot.png` (e.g. 1280×720) to the root of your repository.'
      });
    } else {
      diagnostics.push({
        code: 'SCREENSHOT_FOUND',
        severity: 'pass',
        file: 'screenshot.png',
        title: 'Repository Screenshot Verified',
        message: 'Found screenshot.png in repository root.'
      });
    }

    const errorsCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningsCount = diagnostics.filter(d => d.severity === 'warning').length;
    const canPublish = errorsCount === 0;

    const dependencies = rawDepends
      ? rawDepends.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const optionalDependencies = rawOptDepends
      ? rawOptDepends.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const confTags = rawConfTags
      ? rawConfTags.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9_/-]/g, '')).filter(Boolean)
      : [];
    const customTags = Array.isArray(userSubmittedTags)
      ? userSubmittedTags.map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9_/-]/g, '')).filter(Boolean)
      : [];

    const title = rawTitle || technicalName.replace(/_/g, ' ');
    const shortDesc = rawDesc || 'Community package for Luanti.';

    // Check if this package already exists on ContentDB or in Cloudflare D1 to prevent duplicates
    // and link both ContentDB + Git Community badges onto the single canonical package!
    const submittedRepoKey = normalizeRepoKey(repoUrl);
    let matchedContentDbPkg: any = null;
    try {
      const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/', 600);
      if (Array.isArray(bulkCatalog)) {
        const lowerOwner = owner.toLowerCase();
        const lowerName = technicalName.toLowerCase();
        const lowerTitle = title.trim().toLowerCase();
        matchedContentDbPkg = bulkCatalog.find((item: any) => {
          if (!item || !item.author || !item.name) return false;
          const itemAuthor = String(item.author).toLowerCase();
          const itemName = String(item.name).toLowerCase();
          if (itemAuthor === lowerOwner && itemName === lowerName) return true;
          const itemRepoKey = normalizeRepoKey(item.repo || item.repo_url);
          if (submittedRepoKey && itemRepoKey && itemRepoKey === submittedRepoKey) return true;
          const itemTitle = String(item.title || '').trim().toLowerCase();
          if (itemName === lowerName && itemTitle && itemTitle === lowerTitle) return true;
          return false;
        }) || null;
      }
    } catch {
      matchedContentDbPkg = null;
    }

    let existingD1Pkg: any = null;
    if (context.env.DB) {
      try {
        existingD1Pkg = await context.env.DB.prepare(
          `SELECT * FROM packages WHERE (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) OR (LOWER(name) = LOWER(?) AND LOWER(title) = LOWER(?)) LIMIT 1`
        ).bind( matchedContentDbPkg?.author || owner, technicalName, technicalName, title ).first();
      } catch {
        existingD1Pkg = null;
      }
    }

    const isAlsoOnContentDb = Boolean(
      matchedContentDbPkg ||
      existingD1Pkg?.provider === 'contentdb' ||
      parseJsonArray(existingD1Pkg?.tags).includes('contentdb')
    );

    const canonicalAuthor = matchedContentDbPkg?.author || existingD1Pkg?.author_name || owner;
    const packageId = `${canonicalAuthor}/${technicalName}`;

    const upstreamTags = Array.isArray(matchedContentDbPkg?.tags)
      ? matchedContentDbPkg.tags.map((t: any) => String(typeof t === 'string' ? t : t?.name || '').toLowerCase()).filter(Boolean)
      : parseJsonArray(existingD1Pkg?.tags);

    const mergedTags = Array.from(
      new Set([
        ...customTags,
        ...confTags,
        ...upstreamTags,
        ...(isAlsoOnContentDb ? ['contentdb'] : []),
        'git',
        provider,
        packageType
      ])
    ).slice(0, 14);

    // Direct Archive .zip URL resolution
    let downloadArchiveUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
    if (provider === 'codeberg') {
      downloadArchiveUrl = `https://${host}/${owner}/${repo}/archive/${branch}.zip`;
    } else if (provider === 'gitlab') {
      downloadArchiveUrl = `https://${host}/${owner}/${repo}/-/archive/${branch}/${repo}-${branch}.zip`;
    }

    const resolvedThumbnail = hasScreenshot
      ? screenshotUrl
      : (matchedContentDbPkg?.thumbnail || existingD1Pkg?.thumbnail_url || screenshotUrl);
    const resolvedBanner = hasScreenshot
      ? screenshotUrl
      : (matchedContentDbPkg?.thumbnail ? String(matchedContentDbPkg.thumbnail).replace('thumbnail.png', 'shot-0.png') : resolvedThumbnail);
    const resolvedDownloads = Math.max(
      Number(matchedContentDbPkg?.downloads) || 0,
      Number(existingD1Pkg?.downloads_count) || 0
    );
    const sources: Array<'official' | 'git'> = isAlsoOnContentDb ? ['official', 'git'] : ['git'];

    const packagePayload = {
      id: packageId,
      author: canonicalAuthor,
      name: technicalName,
      title: matchedContentDbPkg?.title || title,
      type: packageType,
      short_desc: shortDesc,
      desc: longDesc,
      thumbnail: resolvedThumbnail,
      banner: resolvedBanner,
      score: Number(existingD1Pkg?.score) || 0,
      downloads: resolvedDownloads,
      license: effectiveLicense,
      media_license: effectiveMediaLicense,
      repo_url: repoUrl.trim(),
      provider,
      default_branch: branch,
      min_minetest_version: rawMinVersion,
      dependencies,
      optional_dependencies: optionalDependencies,
      source: 'git' as const,
      sources,
      tags: mergedTags
    };

    const licenseValid = !diagnostics.some(d => d.code === 'LICENSE_INVALID');
    const luacheckPassed = !diagnostics.some(d => d.code.startsWith('LUA_') && d.severity === 'error');

    const auditReport = {
      valid: canPublish,
      passed: canPublish,
      configFound: confFileName,
      confFile: confFileName,
      licenseValid,
      luacheckPassed,
      errorsCount,
      warningsCount,
      branch,
      provider,
      diagnostics,
      metadata: packagePayload,
      packageMeta: packagePayload
    };

    // If blocking errors exist, return 422 with the full guided audit report
    if (!canPublish) {
      return Response.json({
        success: false,
        canPublish: false,
        error: `Found ${errorsCount} blocking issue(s) that must be fixed before publishing.`,
        audit: auditReport,
        auditReport
      }, { status: 422 });
    }

    // If dryRun (Pre-Flight Check button in UI), return the passing audit report without writing to D1 yet
    if (dryRun) {
      return Response.json({
        success: true,
        canPublish: true,
        dryRun: true,
        audit: auditReport,
        auditReport,
        package: packagePayload
      });
    }

    if (!warrantiesAccepted) {
      return Response.json({
        success: false,
        canPublish: true,
        error: 'Please accept the open-source legal warranties before publishing.',
        audit: auditReport,
        auditReport
      }, { status: 400 });
    }

    // 6. Save to Cloudflare D1 (merging onto existing ContentDB record if present to prevent duplicates)
    if (context.env.DB) {
      const authorId = loggedInUserId || existingD1Pkg?.author_id || `ext_${canonicalAuthor}`;

      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, username, display_name, avatar_url)
        VALUES (?, ?, ?, ?)
      `).bind(authorId, canonicalAuthor, canonicalAuthor, `https://github.com/${owner}.png`).run();

      await context.env.DB.prepare(`
        INSERT INTO packages (
          id, author_id, author_name, name, title, type, short_desc, long_desc,
          repo_url, provider, default_branch, thumbnail_url, banner_url,
          downloads_count, license, media_license, tags, dependencies, optional_dependencies,
          min_minetest_version, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          short_desc = excluded.short_desc,
          long_desc = excluded.long_desc,
          repo_url = excluded.repo_url,
          provider = excluded.provider,
          default_branch = excluded.default_branch,
          thumbnail_url = excluded.thumbnail_url,
          banner_url = excluded.banner_url,
          downloads_count = MAX(packages.downloads_count, excluded.downloads_count),
          license = excluded.license,
          media_license = excluded.media_license,
          tags = excluded.tags,
          dependencies = excluded.dependencies,
          optional_dependencies = excluded.optional_dependencies,
          min_minetest_version = excluded.min_minetest_version,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        packageId,
        authorId,
        canonicalAuthor,
        technicalName,
        packagePayload.title,
        packageType,
        shortDesc,
        longDesc,
        repoUrl.trim(),
        provider,
        branch,
        resolvedThumbnail,
        resolvedBanner,
        resolvedDownloads,
        effectiveLicense,
        effectiveMediaLicense,
        JSON.stringify(mergedTags),
        JSON.stringify(dependencies),
        JSON.stringify(optionalDependencies),
        rawMinVersion
      ).run();

      await context.env.DB.prepare(`
        INSERT OR REPLACE INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version)
        VALUES (?, 'latest', ?, 'HEAD', ?, ?)
      `).bind(packageId, branch, downloadArchiveUrl, rawMinVersion).run();
    }

    return Response.json({
      success: true,
      canPublish: true,
      audit: auditReport,
      auditReport,
      package: packagePayload
    });

  } catch (err: any) {
    return Response.json({ error: err.message || 'Internal error auditing repository.' }, { status: 500 });
  }
}

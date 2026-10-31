// Ingestion & Static Audit Endpoint for Decentralized Git Repositories (Codeberg, GitLab, GitHub, Gitea)
import {
  verifySessionToken,
  parseCookies,
  checkIsAdmin,
  reconcileAndMergeUserAccount,
  createAuditProofToken,
  verifyAuditProofToken
} from '../auth/lib/session';
import {
  fetchUpstreamJsonCached,
  normalizeRepoKey,
  parseJsonArray,
  invalidateEdgeCacheKeys,
  fetchGitRepoReleasesAndTags,
  buildGitBranchArchiveUrl,
  rewriteRelativeMarkdownUrls,
  autoResolveBrokenRepoReport,
  parseCdbJsonMetadata,
  CdbJsonMetadata,
  ensureExtendedPackageColumns,
  extractEmbeddedVideo,
  ensureModerationColumns,
  formatByteSize,
  sanitizePublicErrorMessage
} from '../lib/upstream';
import { evaluateRepositoryContentSafety } from '../lib/content-safety';

interface Env {
  DB?: any;
  AI?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

interface RepoEntry {
  name: string;
  type: 'file' | 'dir';
}

async function fetchRepoRootEntries(
  provider: 'codeberg' | 'mesehub' | 'gitlab' | 'github',
  host: string,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoEntry[] | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)'
  };
  try {
    if (provider === 'github') {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`,
        { headers }
      );
      if (!res.ok) return null;
      const items = await res.json();
      if (!Array.isArray(items)) return null;
      return items.map((it: any) => ({
        name: String(it.name || ''),
        type: it.type === 'dir' ? 'dir' : 'file'
      }));
    }
    if (provider === 'codeberg' || provider === 'mesehub') {
      const res = await fetch(
        `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`,
        { headers }
      );
      if (!res.ok) return null;
      const items = await res.json();
      if (!Array.isArray(items)) return null;
      return items.map((it: any) => ({
        name: String(it.name || ''),
        type: it.type === 'dir' || it.type === 'submodule' ? 'dir' : 'file'
      }));
    }
    if (provider === 'gitlab') {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const res = await fetch(
        `https://${host}/api/v4/projects/${projectPath}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100`,
        { headers }
      );
      if (!res.ok) return null;
      const items = await res.json();
      if (!Array.isArray(items)) return null;
      return items.map((it: any) => ({
        name: String(it.name || ''),
        type: it.type === 'tree' || it.type === 'commit' ? 'dir' : 'file'
      }));
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchRepoSizeEstimate(
  provider: 'codeberg' | 'mesehub' | 'gitlab' | 'github',
  host: string,
  owner: string,
  repo: string
): Promise<{ downloadSize: number; fileSize: string } | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)'
  };
  try {
    if (provider === 'github') {
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
      if (res.ok) {
        const data: any = await res.json();
        const kb = Number(data?.size);
        if (Number.isFinite(kb) && kb > 0) {
          const bytes = Math.round(kb * 1024);
          return { downloadSize: bytes, fileSize: formatByteSize(bytes) || `${kb} KB` };
        }
      }
    } else if (provider === 'codeberg' || provider === 'mesehub') {
      const res = await fetch(`https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
      if (res.ok) {
        const data: any = await res.json();
        const kb = Number(data?.size);
        if (Number.isFinite(kb) && kb > 0) {
          const bytes = Math.round(kb * 1024);
          return { downloadSize: bytes, fileSize: formatByteSize(bytes) || `${kb} KB` };
        }
      }
    } else if (provider === 'gitlab') {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const res = await fetch(`https://${host}/api/v4/projects/${projectPath}`, { headers });
      if (res.ok) {
        const data: any = await res.json();
        const bytes = Number(data?.statistics?.repository_size || (data?.size ? data.size * 1024 : 0));
        if (Number.isFinite(bytes) && bytes > 0) {
          return { downloadSize: Math.round(bytes), fileSize: formatByteSize(bytes) || `${Math.round(bytes / 1024)} KB` };
        }
      }
    }
  } catch {
    // Non-blocking estimate
  }
  return null;
}

async function verifyOrgOrRepoMembership(
  provider: 'codeberg' | 'mesehub' | 'gitlab' | 'github',
  host: string,
  owner: string,
  repo: string,
  verifiedHandle: string
): Promise<boolean> {
  const lowerHandle = verifiedHandle.trim().toLowerCase();
  if (!lowerHandle) return false;
  if (lowerHandle === owner.trim().toLowerCase()) return true;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'LuantiHub/1.0 (+https://luanti-hub.pages.dev)'
  };

  try {
    if (provider === 'github') {
      const orgRes = await fetch(
        `https://api.github.com/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(verifiedHandle)}`,
        { headers }
      );
      if (orgRes.status === 204 || orgRes.status === 200) return true;

      const contribRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?per_page=30`,
        { headers }
      );
      if (contribRes.ok) {
        const list = await contribRes.json();
        if (Array.isArray(list) && list.some((c: any) => String(c?.login || '').toLowerCase() === lowerHandle)) {
          return true;
        }
      }
    } else if (provider === 'codeberg' || provider === 'mesehub') {
      const orgRes = await fetch(
        `https://${host}/api/v1/orgs/${encodeURIComponent(owner)}/members/${encodeURIComponent(verifiedHandle)}`,
        { headers }
      );
      if (orgRes.status === 204 || orgRes.status === 200) return true;

      const repoRes = await fetch(
        `https://${host}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers }
      );
      if (repoRes.ok) {
        const repoData: any = await repoRes.json();
        if (String(repoData?.owner?.login || '').toLowerCase() === lowerHandle) {
          return true;
        }
      }
    } else if (provider === 'gitlab') {
      const projectPath = encodeURIComponent(`${owner}/${repo}`);
      const membersRes = await fetch(
        `https://${host}/api/v4/projects/${projectPath}/members/all?query=${encodeURIComponent(verifiedHandle)}`,
        { headers }
      );
      if (membersRes.ok) {
        const list = await membersRes.json();
        if (Array.isArray(list) && list.some((m: any) => String(m?.username || '').toLowerCase() === lowerHandle)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }

  return false;
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

function detectSpdxFromLicenseText(raw: string): string | undefined {
  if (!raw) return undefined;
  const text = raw.slice(0, 4000);
  if (/MIT License|Permission is hereby granted, free of charge|\bMIT\b/i.test(text)) return 'MIT';
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 2\.1|\bLGPL-2\.1/i.test(text)) return 'LGPL-2.1-only';
  if (/GNU LESSER GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3|\bLGPL-3\.0/i.test(text)) return 'LGPL-3.0-only';
  if (/GNU AFFERO GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3|\bAGPL-3\.0/i.test(text)) return 'AGPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 3|\bGPL-3\.0/i.test(text)) return 'GPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,120}Version 2|\bGPL-2\.0/i.test(text)) return 'GPL-2.0-only';
  if (/Apache License[\s\S]{0,80}Version 2\.0|\bApache-2\.0\b/i.test(text)) return 'Apache-2.0';
  if (/Mozilla Public License[\s\S]{0,60}2\.0|\bMPL-2\.0\b/i.test(text)) return 'MPL-2.0';
  if (/Creative Commons Attribution-ShareAlike 4\.0|CC-BY-SA-4\.0/i.test(text)) return 'CC-BY-SA-4.0';
  if (/Creative Commons Attribution-ShareAlike 3\.0|CC-BY-SA-3\.0/i.test(text)) return 'CC-BY-SA-3.0';
  if (/Creative Commons Attribution 4\.0|CC-BY-4\.0/i.test(text)) return 'CC-BY-4.0';
  if (/CC0 1\.0 Universal|Public Domain Dedication|\bCC0-1\.0\b/i.test(text)) return 'CC0-1.0';
  if (/The Unlicense|unlicense\.org|\bUnlicense\b/i.test(text)) return 'Unlicense';
  if (/DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE|\bWTFPL\b/i.test(text)) return 'WTFPL';
  if (/zlib License|altered source versions must be plainly marked|\bZlib\b/i.test(text)) return 'Zlib';
  if (/Redistribution and use in source and binary forms/i.test(text)) {
    return /Neither the name of/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  return undefined;
}

/**
 * Runs a Luacheck-style static analysis pass on Lua source code (`init.lua`)
 */
export function runLuacheckStaticAudit(luaSource: string, modName: string): GitAuditDiagnostic[] {
  const diagnostics: GitAuditDiagnostic[] = [];
  const lines = luaSource.split(/\r?\n/);

  let openBlocks = 0;
  let lastOpenLine = 1;
  let hasLuantiEngineApi = false;
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

    // 1. Detect positive Luanti Engine API usage (core.*, minetest.*, vector.*, ItemStack, VoxelArea, etc.)
    if (
      /\b(core|minetest|vector|VoxelArea|VoxelManip|PerlinNoise|PerlinNoiseMap|PseudoRandom|PcgRandom|SecureRandom|ItemStack|Settings|AreaStore|Raycast)\b/.test(
        codeOnly
      )
    ) {
      hasLuantiEngineApi = true;
    }

    // 2. Count block openers vs `end` / `until`
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
  if (!hasLuantiEngineApi) {
    diagnostics.push({
      code: 'LUA_NO_ENGINE_API',
      severity: 'error',
      file: 'init.lua',
      line: 1,
      title: 'No Luanti Engine API Usage Detected in init.lua',
      message: 'init.lua does not reference any Luanti engine APIs (e.g. core.*, minetest.*, vector.*, ItemStack, VoxelArea). Unrelated repositories or placeholder Lua scripts cannot be indexed.',
      howToFix: 'Ensure init.lua registers nodes, items, callbacks, or loads mod scripts using Luanti engine APIs (such as core.register_node or core.get_modpath):',
      snippet: `local modname = core.get_current_modname()\nlocal modpath = core.get_modpath(modname)\ncore.log("action", "[" .. modname .. "] Loaded")`
    });
  } else {
    diagnostics.push({
      code: 'LUA_ENGINE_API_OK',
      severity: 'pass',
      file: 'init.lua',
      title: 'Luanti Engine API Signatures Verified',
      message: 'Detected valid Luanti (core.* / minetest.*) engine API references in init.lua.'
    });
  }

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

    if (!loggedInUserId) {
      return Response.json(
        {
          success: false,
          canPublish: false,
          error: 'Authentication required. Only signed-in users can audit or submit Git packages.'
        },
        { status: 401 }
      );
    }

    const body = await context.request.json() as {
      repoUrl?: string;
      warrantiesAccepted?: boolean;
      dryRun?: boolean;
      auditToken?: string;
      customConf?: string;
      customLua?: string;
      tags?: string[];
    };

    const { repoUrl, warrantiesAccepted, dryRun, auditToken, customConf, customLua, tags: userSubmittedTags } = body;

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
    let provider: 'codeberg' | 'mesehub' | 'gitlab' | 'github' = 'github';
    if (host.includes('git.minetest.land')) {
      provider = 'mesehub';
    } else if (host.includes('codeberg') || host.includes('gitea') || host.includes('forgejo')) {
      provider = 'codeberg';
    } else if (host.includes('gitlab')) {
      provider = 'gitlab';
    }

    const buildRawUrl = (branchName: string, filePath: string): string => {
      if (provider === 'codeberg' || provider === 'mesehub') {
        return `https://${host}/${owner}/${repo}/raw/branch/${branchName}/${filePath}`;
      } else if (provider === 'gitlab') {
        return `https://${host}/${owner}/${repo}/-/raw/${branchName}/${filePath}`;
      }
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branchName}/${filePath}`;
    };

    // Only allow customConf / customLua overrides during dryRun preview;
    // when publishing (dryRun: false), always fetch committed files from the live Git repository.
    let rawConfig = dryRun ? (customConf || '') : '';
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
        snippet: `name = ${sanitizedDefaultName}\ntitle = ${repo.replace(/[-_]/g, ' ')}\ndescription = Adds new blocks and mechanics to Luanti.\nmin_minetest_version = 5.0.0`
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
      for (const rawLine of rawConfig.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const k = line.slice(0, eqIdx).trim();
        if (k.toLowerCase() === key.toLowerCase()) {
          let val = line.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1).trim();
          }
          return val;
        }
      }
      return '';
    };

    const cleanDep = (s: string): string => {
      return s
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\?$/, '') // Strip legacy optional modifier
        .split(/\s+#/)[0]   // Strip inline comment if preceded by space
        .trim();
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

    // Optional: Probe `.cdb.json` (Luanti ContentDB repository metadata specification)
    let cdbMeta: CdbJsonMetadata | null = null;
    let rawCdbJsonText = '';
    try {
      const cdbRes = await fetch(buildRawUrl(branch, '.cdb.json'));
      if (cdbRes.ok) {
        const cdbText = await cdbRes.text();
        rawCdbJsonText = cdbText;
        cdbMeta = parseCdbJsonMetadata(cdbText);
        if (cdbMeta) {
          diagnostics.push({
            code: 'CDB_JSON_DETECTED',
            severity: 'pass',
            file: '.cdb.json',
            title: 'Luanti .cdb.json Metadata Detected',
            message: `Parsed ContentDB schema from .cdb.json (${[
              cdbMeta.license ? `license: ${cdbMeta.license}` : '',
              cdbMeta.tags.length > 0 ? `${cdbMeta.tags.length} tags` : '',
              cdbMeta.dev_state ? `state: ${cdbMeta.dev_state}` : ''
            ].filter(Boolean).join(', ') || 'extended metadata'}).`
          });
        }
      }
    } catch {
      // Optional .cdb.json not present
    }

    const technicalName = rawName || cdbMeta?.name || sanitizedDefaultName;

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

    // Validate `title` and `description` (allowing .cdb.json to satisfy missing mod.conf fields)
    const effectiveRawTitle = rawTitle || cdbMeta?.title || '';
    const effectiveRawDesc = rawDesc || cdbMeta?.short_description || '';
    if (!effectiveRawTitle || !effectiveRawDesc) {
      diagnostics.push({
        code: 'CONF_METADATA_INCOMPLETE',
        severity: 'warning',
        file: confFileName,
        title: `Recommended 'title' or 'description' Missing in ${confFileName}`,
        message: `Adding both 'title' and 'description' in ${confFileName} (or .cdb.json) improves search ranking and in-game Content tab display.`,
        howToFix: `Add descriptive 'title' and 'description' lines to ${confFileName}:`,
        snippet: `title = ${effectiveRawTitle || technicalName.replace(/_/g, ' ')}\ndescription = ${effectiveRawDesc || 'Describe what your package adds to Luanti.'}`
      });
    } else {
      diagnostics.push({
        code: 'CONF_METADATA_OK',
        severity: 'pass',
        file: rawTitle && rawDesc ? confFileName : '.cdb.json',
        title: 'Title & Description Present',
        message: `Title ("${effectiveRawTitle}") and description verified.`
      });
    }

    // Check 3: Detect SPDX Open-Source License from mod.conf, .cdb.json, or LICENSE / COPYING / README.md
    let detectedLicense = rawLicense || cdbMeta?.license || '';
    let detectedLicenseFile = rawLicense ? confFileName : (cdbMeta?.license ? '.cdb.json' : 'LICENSE');

    if (!detectedLicense) {
      const licenseCandidates = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'COPYING', 'COPYING.txt'];
      for (const licFile of licenseCandidates) {
        try {
          const licRes = await fetch(buildRawUrl(branch, licFile));
          if (licRes.ok) {
            const licText = await licRes.text();
            if (licText && !licText.trim().startsWith('<!DOCTYPE')) {
              const spdx = detectSpdxFromLicenseText(licText);
              if (spdx) {
                detectedLicense = spdx;
                detectedLicenseFile = licFile;
                break;
              }
            }
          }
        } catch {
          // Try next candidate
        }
      }
    }

    const effectiveLicense = detectedLicense || 'MIT';
    const effectiveMediaLicense = rawMediaLicense || cdbMeta?.media_license || detectedLicense || 'CC-BY-SA-4.0';

    if ((rawLicense || cdbMeta?.license) && !isApprovedLicense(rawLicense || cdbMeta?.license || '')) {
      diagnostics.push({
        code: 'LICENSE_INVALID',
        severity: 'error',
        file: detectedLicenseFile,
        title: `Unrecognized or Non-FOSS License: '${rawLicense || cdbMeta?.license}'`,
        message: `LuantiHub requires an OSI-approved Open Source or Free Culture SPDX license.`,
        howToFix: `Include a standard open-source LICENSE file (e.g., MIT, LGPL-2.1-only, GPL-3.0-only, Apache-2.0, CC-BY-SA-4.0) in the root of your repository.`
      });
    } else {
      diagnostics.push({
        code: 'LICENSE_VERIFIED',
        severity: 'pass',
        file: detectedLicenseFile,
        title: `Open-Source License Verified (${effectiveLicense})`,
        message: detectedLicense
          ? `Detected ${effectiveLicense} license from ${detectedLicenseFile}.`
          : `Verified open-source distribution under submission warranty (${effectiveLicense} / ${effectiveMediaLicense}).`
      });
    }

    // Check 4: Fetch & Audit `init.lua` (for mods) or Directory Structure (for games / modpacks / texture packs)
    let luaSource = dryRun ? (customLua || '') : '';
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

    let discoveredRootEntries: RepoEntry[] | null = null;
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
    } else {
      // Verify repository directory structure for game.conf, modpack.conf, or texture_pack.conf
      const rootEntries = await fetchRepoRootEntries(provider, host, owner, repo, branch);
      discoveredRootEntries = rootEntries;
      if (rootEntries && rootEntries.length > 0) {
        const hasGitmodules = rootEntries.some(e => e.name.toLowerCase() === '.gitmodules');
        if (packageType === 'game') {
          const hasModsDir = rootEntries.some(e => e.type === 'dir' && e.name.toLowerCase() === 'mods');
          if (!hasModsDir && !hasGitmodules) {
            diagnostics.push({
              code: 'GAME_STRUCTURE_INVALID',
              severity: 'error',
              file: 'mods/',
              title: 'Missing mods/ Directory for Luanti Game',
              message: `Repository declares game.conf, but no 'mods/' directory was found in the root of ${owner}/${repo}.`,
              howToFix: `Create a 'mods/' directory in the root of your game repository containing the game's base mods.`
            });
          } else {
            diagnostics.push({
              code: 'GAME_STRUCTURE_OK',
              severity: 'pass',
              file: 'mods/',
              title: 'Luanti Game Directory Structure Verified',
              message: `Found required 'mods/' directory structure for game package.`
            });
          }
        } else if (packageType === 'modpack') {
          const subDirs = rootEntries.filter(e => e.type === 'dir' && !e.name.startsWith('.'));
          if (subDirs.length === 0 && !hasGitmodules) {
            diagnostics.push({
              code: 'MODPACK_STRUCTURE_INVALID',
              severity: 'error',
              file: confFileName,
              title: 'No Sub-Mod Directories Found in Modpack',
              message: `Repository declares modpack.conf, but contains no mod subdirectories in the root of ${owner}/${repo}.`,
              howToFix: `Place at least one mod subfolder (each with its own mod.conf and init.lua) inside the modpack repository.`
            });
          } else {
            diagnostics.push({
              code: 'MODPACK_STRUCTURE_OK',
              severity: 'pass',
              file: confFileName,
              title: 'Modpack Directory Structure Verified',
              message: `Found ${subDirs.length || 1} sub-directory entry(s) in modpack root.`
            });
          }
        } else if (packageType === 'txp') {
          const hasPngFiles = rootEntries.some(
            e => e.type === 'file' && /\.(png|jpg|tga)$/i.test(e.name) && e.name.toLowerCase() !== 'screenshot.png'
          );
          const hasAssetSubdirs = rootEntries.some(e => e.type === 'dir' && !e.name.startsWith('.'));
          if (!hasPngFiles && !hasAssetSubdirs) {
            diagnostics.push({
              code: 'TXP_STRUCTURE_INVALID',
              severity: 'error',
              file: confFileName,
              title: 'No Texture Files Found in Texture Pack',
              message: `Repository declares texture_pack.conf, but no .png texture files or texture subdirectories were found in ${owner}/${repo}.`,
              howToFix: `Add your .png node/item texture files to the repository root or texture subdirectories.`
            });
          } else {
            diagnostics.push({
              code: 'TXP_STRUCTURE_OK',
              severity: 'pass',
              file: confFileName,
              title: 'Texture Pack Assets Verified',
              message: 'Detected texture files/directories in repository.'
            });
          }
        }
      }
    }

    // Optional Dependency Syntax Check (only if depends / optional_depends are specified; empty is 100% valid)
    const rawDepList = [
      ...(rawDepends ? rawDepends.split(',').map(cleanDep).filter(Boolean) : []),
      ...(rawOptDepends ? rawOptDepends.split(',').map(cleanDep).filter(Boolean) : [])
    ];
    const invalidDeps = rawDepList.filter(d => !/^[a-z0-9_]+$/.test(d));
    if (invalidDeps.length > 0) {
      diagnostics.push({
        code: 'CONF_INVALID_DEPENDS',
        severity: 'error',
        file: confFileName,
        title: `Invalid Dependency Identifier: '${invalidDeps[0]}'`,
        message: `Luanti dependency names in 'depends' / 'optional_depends' must use only lowercase letters, numbers, and underscores (found '${invalidDeps.join(', ')}').`,
        howToFix: `Ensure all comma-separated mod names in 'depends' and 'optional_depends' are valid snake_case technical mod names.`
      });
    }

    // Check 5: Probe README.md & screenshot.png
    const rawAssetBase = buildRawUrl(branch, '').replace(/\/+$/, '');
    let readmeMarkdown = '';
    try {
      const readmeRes = await fetch(buildRawUrl(branch, 'README.md'));
      if (readmeRes.ok) {
        const md = await readmeRes.text();
        if (md && !md.trim().startsWith('<!DOCTYPE')) {
          readmeMarkdown = rewriteRelativeMarkdownUrls(md.slice(0, 64000), rawAssetBase);
        }
      }
    } catch {
      // Keep shortDesc
    }
    const longDesc = readmeMarkdown ? readmeMarkdown.slice(0, 12000) : (rawDesc || 'Decentralized Luanti community package.');

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

    // Check 5B: Automated Content Safety Audit (4-Layer Static + Optional Cloudflare Workers AI on Publish)
    const preliminaryTitle = rawTitle || cdbMeta?.title || technicalName.replace(/_/g, ' ');
    const preliminaryShortDesc = rawDesc || cdbMeta?.short_description || 'Community package for Luanti.';
    const safetyEval = await evaluateRepositoryContentSafety(
      {
        repoOwner: owner,
        repoName: repo,
        confFileName,
        rawConfig,
        title: preliminaryTitle,
        shortDesc: preliminaryShortDesc,
        cdbJsonText: rawCdbJsonText || undefined,
        readmeMarkdown: readmeMarkdown || undefined,
        luaSource: luaSource || undefined,
        rootFileNames: discoveredRootEntries ? discoveredRootEntries.map(e => e.name) : undefined
      },
      {
        aiBinding: context.env.AI,
        runAiCheck: !dryRun
      }
    );

    if (safetyEval.holdForAdminReview) {
      const firstMatch = safetyEval.matches[0];
      diagnostics.push({
        code: 'CONTENT_SAFETY_HOLD',
        severity: 'warning',
        file: firstMatch?.file || confFileName,
        line: firstMatch?.line,
        title: 'Content Safety Review Required (Queued for Admin Approval)',
        message: `${safetyEval.summary}. If published as-is, this package will be held for administrator review before appearing in the public catalog.`,
        howToFix: 'If this match was unintentional, remove the flagged wording from your repository and re-run Pre-Flight Check. If your package is a legitimate horror/mature mod, you may still click Publish and a moderator will review and approve it.',
        snippet: firstMatch?.snippet
      });
    } else if (safetyEval.autoContentWarnings.length > 0) {
      diagnostics.push({
        code: 'CONTENT_WARNING_AUTO_TAGGED',
        severity: 'warning',
        file: confFileName,
        title: `Content Warning Badge Attached (${safetyEval.autoContentWarnings.join(', ')})`,
        message: `Detected mature thematic terms (${safetyEval.autoContentWarnings.join(', ')}). Package can be published immediately with an automatic Content Warning badge.`
      });
    }

    const errorsCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningsCount = diagnostics.filter(d => d.severity === 'warning').length;
    const canPublish = errorsCount === 0;

    // Check 6: Verify Cryptographic Repository Ownership (prevents posting someone else's Git repository)
    let ownershipVerified = false;
    let verifiedProviderUsername: string | null = null;
    let resolvedUserId: string | null = loggedInUserId;

    if (context.env.DB && loggedInUserId) {
      try {
        const reconciledUser = await reconcileAndMergeUserAccount(context.env.DB, loggedInUserId);
        if (reconciledUser?.id) {
          resolvedUserId = String(reconciledUser.id);
        }
        const identitiesRes = await context.env.DB.prepare(
          `SELECT provider, provider_username as username, verified
           FROM user_identities WHERE user_id = ?`
        ).bind(resolvedUserId).all();
        const identities: Array<{ provider: string; username: string; verified: boolean }> = (identitiesRes.results || []).map((id: any) => ({
          provider: String(id.provider || '').toLowerCase(),
          username: String(id.username || ''),
          verified: Boolean(id.verified)
        }));

        if (checkIsAdmin(reconciledUser, identities, context.env.ADMIN_USERS)) {
          ownershipVerified = true;
          verifiedProviderUsername = reconciledUser?.username || owner;
        } else {
          const verifiedForProvider = identities.filter(id => id.provider === provider && id.verified);
          for (const id of verifiedForProvider) {
            if (id.username.trim().toLowerCase() === owner.trim().toLowerCase()) {
              ownershipVerified = true;
              verifiedProviderUsername = id.username;
              break;
            }
            const isOrgOrRepoMember = await verifyOrgOrRepoMembership(provider, host, owner, repo, id.username);
            if (isOrgOrRepoMember) {
              ownershipVerified = true;
              verifiedProviderUsername = id.username;
              break;
            }
          }
        }
      } catch {
        ownershipVerified = false;
      }
    }

    if (ownershipVerified) {
      diagnostics.push({
        code: 'REPO_OWNERSHIP_VERIFIED',
        severity: 'pass',
        file: `${provider}:${owner}/${repo}`,
        title: `Repository Ownership Verified (${verifiedProviderUsername || owner})`,
        message: `Verified that your ${provider} account owns or maintains ${owner}/${repo}.`
      });
    } else if (!dryRun) {
      diagnostics.push({
        code: 'REPO_OWNERSHIP_REQUIRED',
        severity: 'error',
        file: `${provider}:${owner}/${repo}`,
        title: `Repository Ownership Verification Required (${provider})`,
        message: `To prevent unauthorized third-party submissions, only the verified owner or maintainer of '${owner}/${repo}' on ${provider} can publish this repository.`,
        howToFix: `Verify your '${owner}' account on ${provider} below using 1-Click OAuth or a read-only Personal Access Token.`
      });
    } else {
      diagnostics.push({
        code: 'REPO_OWNERSHIP_REQUIRED',
        severity: 'warning',
        file: `${provider}:${owner}/${repo}`,
        title: `Verify '${owner}' on ${provider} Before Publishing`,
        message: `Pre-flight checks passed, but publishing requires verifying that you own or maintain '${owner}/${repo}' on ${provider}.`,
        howToFix: `Use the inline ${provider} verification box below (OAuth or read-only Personal Access Token) to unlock publishing.`
      });
    }

    const dependencies = rawDepends
      ? rawDepends.split(',').map(cleanDep).filter(Boolean)
      : [];
    const optionalDependencies = rawOptDepends
      ? rawOptDepends.split(',').map(cleanDep).filter(Boolean)
      : [];

    const confTags = rawConfTags
      ? rawConfTags.split(',').map(s => s.trim().toLowerCase().replace(/[^a-z0-9_/-]/g, '')).filter(Boolean)
      : [];
    const cdbTags = cdbMeta?.tags || [];
    const customTags = Array.isArray(userSubmittedTags)
      ? userSubmittedTags.map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9_/-]/g, '')).filter(Boolean)
      : [];

    const title = rawTitle || cdbMeta?.title || technicalName.replace(/_/g, ' ');
    const shortDesc = rawDesc || cdbMeta?.short_description || 'Community package for Luanti.';

    // Check if this package already exists on ContentDB or in Cloudflare D1 to prevent duplicates
    // and link both ContentDB + Git Community badges onto the single canonical package!
    const submittedRepoKey = normalizeRepoKey(repoUrl);
    let matchedContentDbPkg: any = null;
    try {
      const bulkCatalog = await fetchUpstreamJsonCached<any[]>('/packages/?fmt=vcs', 600);
      if (Array.isArray(bulkCatalog)) {
        const lowerOwner = owner.toLowerCase();
        const lowerName = technicalName.toLowerCase();
        const lowerTitle = title.trim().toLowerCase();
        const lowerType = String(packageType || 'mod').toLowerCase();
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

        if (!matchedContentDbPkg) {
          const sameNameType = bulkCatalog.filter(
            (item: any) =>
              item &&
              String(item.name || '').toLowerCase() === lowerName &&
              String(item.type || 'mod').toLowerCase() === lowerType
          );
          if (sameNameType.length === 1) {
            matchedContentDbPkg = sameNameType[0];
          }
        }

        if (matchedContentDbPkg?.author && matchedContentDbPkg?.name && !(Number(matchedContentDbPkg.downloads) > 0)) {
          const cdbDetail = await fetchUpstreamJsonCached<any>(
            `/packages/${encodeURIComponent(matchedContentDbPkg.author)}/${encodeURIComponent(matchedContentDbPkg.name)}/`,
            600
          ).catch(() => null);
          if (cdbDetail) {
            matchedContentDbPkg = { ...matchedContentDbPkg, ...cdbDetail };
          }
        }
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
      : (customTags.length > 0 ? [] : parseJsonArray(existingD1Pkg?.tags));

    const mergedTags = Array.from(
      new Set([
        ...customTags,
        ...confTags,
        ...cdbTags,
        ...upstreamTags,
        ...(isAlsoOnContentDb ? ['contentdb'] : []),
        'git',
        provider,
        packageType
      ])
    ).slice(0, 14);

    // Discover Git Tags & Releases first, falling back to default branch only when no tags/releases exist
    const discoveredReleases = await fetchGitRepoReleasesAndTags(
      repoUrl.trim(),
      owner,
      repo,
      rawMinVersion
    );
    const branchArchiveUrl = buildGitBranchArchiveUrl(repoUrl.trim(), owner, repo, branch);
    const downloadArchiveUrl = discoveredReleases.length > 0
      ? discoveredReleases[0].download_url
      : branchArchiveUrl;

    const resolvedThumbnail = hasScreenshot
      ? screenshotUrl
      : (matchedContentDbPkg?.thumbnail || existingD1Pkg?.thumbnail_url || screenshotUrl);
    const resolvedBanner = hasScreenshot
      ? screenshotUrl
      : (matchedContentDbPkg?.thumbnail ? String(matchedContentDbPkg.thumbnail).replace('thumbnail.png', 'shot-0.png') : resolvedThumbnail);
    const resolvedCdbDownloads = Math.max(
      Number(matchedContentDbPkg?.downloads) || 0,
      Number(existingD1Pkg?.contentdb_downloads) || 0
    );
    const resolvedLhDownloads = Number(existingD1Pkg?.luantihub_downloads) || 0;
    const resolvedDownloads = Math.max(
      resolvedCdbDownloads + resolvedLhDownloads,
      Number(existingD1Pkg?.downloads_count) || 0
    );
    const sources: Array<'official' | 'git'> = isAlsoOnContentDb ? ['official', 'git'] : ['git'];

    const resolvedLongDesc = cdbMeta?.long_description || matchedContentDbPkg?.long_description || longDesc || shortDesc;
    const resolvedVideo = extractEmbeddedVideo(
      cdbMeta?.video_url || matchedContentDbPkg?.video_url || existingD1Pkg?.video_url,
      matchedContentDbPkg?.video_thumbnail_url || existingD1Pkg?.video_thumbnail_url,
      resolvedLongDesc,
      readmeMarkdown
    );
    const resolvedDonateUrl = cdbMeta?.donate_url || matchedContentDbPkg?.donate_url || existingD1Pkg?.donate_url || undefined;
    const resolvedIssueTracker = cdbMeta?.issue_tracker || matchedContentDbPkg?.issue_tracker || existingD1Pkg?.issue_tracker || undefined;
    const resolvedForumUrl = cdbMeta?.forum_url || matchedContentDbPkg?.forum_url || existingD1Pkg?.forum_url || undefined;
    const resolvedTranslationUrl = cdbMeta?.translation_url || matchedContentDbPkg?.translation_url || existingD1Pkg?.translation_url || undefined;
    const resolvedWebsite = cdbMeta?.website || matchedContentDbPkg?.website || undefined;
    const resolvedDevState = cdbMeta?.dev_state || matchedContentDbPkg?.dev_state || existingD1Pkg?.dev_state || undefined;
    const baseWarnings = (cdbMeta?.content_warnings && cdbMeta.content_warnings.length > 0)
      ? cdbMeta.content_warnings
      : parseJsonArray(existingD1Pkg?.content_warnings);
    const resolvedWarnings = Array.from(
      new Set([...baseWarnings, ...safetyEval.autoContentWarnings])
    );
    const resolvedAiDisclosures = (cdbMeta?.ai_disclosures && cdbMeta.ai_disclosures.length > 0)
      ? cdbMeta.ai_disclosures
      : parseJsonArray(existingD1Pkg?.ai_disclosures);

    const packagePayload = {
      id: packageId,
      author: canonicalAuthor,
      name: technicalName,
      title: matchedContentDbPkg?.title || title,
      type: packageType,
      short_desc: shortDesc,
      desc: resolvedLongDesc,
      readme: readmeMarkdown || undefined,
      thumbnail: resolvedThumbnail,
      banner: resolvedBanner,
      score: Number(existingD1Pkg?.score) || 0,
      contentdb_downloads: resolvedCdbDownloads,
      luantihub_downloads: resolvedLhDownloads,
      downloads: resolvedDownloads,
      license: effectiveLicense,
      media_license: effectiveMediaLicense,
      repo_url: repoUrl.trim(),
      website: resolvedWebsite,
      issue_tracker: resolvedIssueTracker,
      forum_url: resolvedForumUrl,
      donate_url: resolvedDonateUrl,
      translation_url: resolvedTranslationUrl,
      video_url: resolvedVideo.video_url,
      video_thumbnail_url: resolvedVideo.video_thumbnail_url,
      dev_state: resolvedDevState,
      content_warnings: resolvedWarnings.length > 0 ? resolvedWarnings : undefined,
      provider,
      default_branch: branch,
      min_minetest_version: rawMinVersion,
      dependencies,
      optional_dependencies: optionalDependencies,
      source: 'git' as const,
      sources,
      tags: mergedTags,
      releases_list: discoveredReleases.length > 0 ? discoveredReleases : [
        {
          id: 1,
          version: branch,
          title: branch,
          tag_name: branch,
          commit_sha: 'HEAD',
          url: branchArchiveUrl,
          download_url: branchArchiveUrl,
          min_minetest_version: rawMinVersion,
          released_at: new Date().toISOString()
        }
      ]
    };

    const licenseValid = !diagnostics.some(d => d.code === 'LICENSE_INVALID');
    const luacheckPassed = !diagnostics.some(d => d.code.startsWith('LUA_') && d.severity === 'error');
    const canonicalRepoKey = `${provider}:${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const issuedAuditToken = canPublish
      ? await createAuditProofToken(canonicalRepoKey, context.env.SESSION_SECRET)
      : undefined;

    const auditReport = {
      valid: canPublish,
      passed: canPublish,
      auditToken: issuedAuditToken,
      ownershipVerified,
      requiredProvider: provider,
      repoOwner: owner,
      configFound: confFileName,
      confFile: confFileName,
      licenseValid,
      luacheckPassed,
      contentSafetyHold: safetyEval.holdForAdminReview,
      errorsCount,
      warningsCount,
      branch,
      provider,
      diagnostics,
      metadata: packagePayload,
      packageMeta: packagePayload
    };

    // If blocking technical errors exist, return 422 with the full guided audit report
    if (!canPublish) {
      return Response.json({
        success: false,
        canPublish: false,
        ownershipVerified,
        requiredProvider: provider,
        repoOwner: owner,
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
        auditToken: issuedAuditToken,
        ownershipVerified,
        requiredProvider: provider,
        repoOwner: owner,
        dryRun: true,
        audit: auditReport,
        auditReport,
        package: packagePayload
      });
    }

    // Require cryptographic proof that Pre-Flight Check was actually executed and passed before publishing
    const hasValidAuditProof = await verifyAuditProofToken(
      auditToken,
      canonicalRepoKey,
      context.env.SESSION_SECRET
    );
    if (!hasValidAuditProof) {
      return Response.json({
        success: false,
        canPublish: false,
        error: 'Pre-flight check required: Please run the Pre-Flight & Luacheck Audit and ensure it passes before publishing.',
        audit: auditReport,
        auditReport
      }, { status: 400 });
    }

    // Enforce verified repository ownership on actual publish (dryRun: false)
    if (!ownershipVerified) {
      return Response.json({
        success: false,
        canPublish: false,
        ownershipVerified: false,
        requiresOwnershipVerification: true,
        requiredProvider: provider,
        repoOwner: owner,
        error: `Ownership verification required: Only the verified owner or maintainer of '${owner}/${repo}' on ${provider} can publish this repository.`,
        audit: auditReport,
        auditReport
      }, { status: 403 });
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
      await ensureExtendedPackageColumns(context.env.DB);
      const authorId = resolvedUserId || existingD1Pkg?.author_id || `ext_${canonicalAuthor}`;

      await context.env.DB.prepare(`
        INSERT OR IGNORE INTO users (id, username, display_name, avatar_url)
        VALUES (?, ?, ?, ?)
      `).bind(authorId, canonicalAuthor, canonicalAuthor, `https://github.com/${owner}.png`).run();

      const existingReviewAvgRow = await context.env.DB.prepare(
        `SELECT ROUND(AVG(rating), 1) as avg_rating, COUNT(*) as cnt FROM reviews WHERE LOWER(package_id) = LOWER(?)`
      ).bind(packageId).first().catch(() => null);
      const actualReviewScore = (existingReviewAvgRow && Number(existingReviewAvgRow.cnt) > 0 && existingReviewAvgRow.avg_rating != null)
        ? Number(existingReviewAvgRow.avg_rating)
        : 0;
      packagePayload.score = actualReviewScore;

      const initialStatus = safetyEval.holdForAdminReview ? 'flagged' : 'active';
      const initialStatusReason = safetyEval.holdForAdminReview
        ? `[ADMIN] Automated Content Safety Hold: ${safetyEval.summary}`.slice(0, 500)
        : null;

      const sizeEstimate = await fetchRepoSizeEstimate(provider, host, owner, repo);
      const estDownloadSize = sizeEstimate?.downloadSize || null;
      const estFileSize = sizeEstimate?.fileSize || null;

      const runPackageUpsert = () => context.env.DB.prepare(`
        INSERT INTO packages (
          id, author_id, author_name, name, title, type, short_desc, long_desc,
          repo_url, provider, default_branch, thumbnail_url, banner_url,
          downloads_count, contentdb_downloads, score, license, media_license, tags, dependencies, optional_dependencies,
          min_minetest_version, donate_url, translation_url, forum_url, issue_tracker,
          video_url, video_thumbnail_url, dev_state, content_warnings, ai_disclosures, download_size, file_size, status, status_reason, flagged_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'flagged' THEN CURRENT_TIMESTAMP ELSE NULL END)
        ON CONFLICT(id) DO UPDATE SET
          author_id = excluded.author_id,
          title = excluded.title,
          short_desc = excluded.short_desc,
          long_desc = excluded.long_desc,
          repo_url = excluded.repo_url,
          provider = excluded.provider,
          default_branch = excluded.default_branch,
          thumbnail_url = excluded.thumbnail_url,
          banner_url = excluded.banner_url,
          contentdb_downloads = MAX(packages.contentdb_downloads, excluded.contentdb_downloads),
          downloads_count = MAX(packages.downloads_count, excluded.downloads_count),
          score = excluded.score,
          license = excluded.license,
          media_license = excluded.media_license,
          tags = excluded.tags,
          dependencies = excluded.dependencies,
          optional_dependencies = excluded.optional_dependencies,
          min_minetest_version = excluded.min_minetest_version,
          donate_url = COALESCE(excluded.donate_url, packages.donate_url),
          translation_url = COALESCE(excluded.translation_url, packages.translation_url),
          forum_url = COALESCE(excluded.forum_url, packages.forum_url),
          issue_tracker = COALESCE(excluded.issue_tracker, packages.issue_tracker),
          video_url = COALESCE(excluded.video_url, packages.video_url),
          video_thumbnail_url = COALESCE(excluded.video_thumbnail_url, packages.video_thumbnail_url),
          dev_state = COALESCE(excluded.dev_state, packages.dev_state),
          content_warnings = COALESCE(excluded.content_warnings, packages.content_warnings),
          ai_disclosures = COALESCE(excluded.ai_disclosures, packages.ai_disclosures),
          download_size = COALESCE(packages.download_size, excluded.download_size),
          file_size = COALESCE(packages.file_size, excluded.file_size),
          status = CASE
            WHEN excluded.status = 'flagged' THEN 'flagged'
            WHEN packages.status_reason LIKE '[ADMIN]%' THEN packages.status
            ELSE 'active'
          END,
          status_reason = CASE
            WHEN excluded.status = 'flagged' THEN excluded.status_reason
            WHEN packages.status_reason LIKE '[ADMIN]%' THEN packages.status_reason
            ELSE NULL
          END,
          flagged_at = CASE
            WHEN excluded.status = 'flagged' THEN CURRENT_TIMESTAMP
            WHEN packages.status_reason LIKE '[ADMIN]%' THEN packages.flagged_at
            ELSE NULL
          END,
          updated_at = CURRENT_TIMESTAMP
      `).bind(
        packageId,
        authorId,
        canonicalAuthor,
        technicalName,
        packagePayload.title,
        packageType,
        shortDesc,
        resolvedLongDesc,
        repoUrl.trim(),
        provider,
        branch,
        resolvedThumbnail,
        resolvedBanner,
        resolvedDownloads,
        resolvedCdbDownloads,
        actualReviewScore,
        effectiveLicense,
        effectiveMediaLicense,
        JSON.stringify(mergedTags),
        JSON.stringify(dependencies),
        JSON.stringify(optionalDependencies),
        rawMinVersion,
        resolvedDonateUrl || null,
        resolvedTranslationUrl || null,
        resolvedForumUrl || null,
        resolvedIssueTracker || null,
        resolvedVideo.video_url || null,
        resolvedVideo.video_thumbnail_url || null,
        resolvedDevState || null,
        resolvedWarnings.length > 0 ? JSON.stringify(resolvedWarnings) : null,
        resolvedAiDisclosures.length > 0 ? JSON.stringify(resolvedAiDisclosures) : null,
        estDownloadSize,
        estFileSize,
        initialStatus,
        initialStatusReason,
        initialStatus
      ).run();

      try {
        await runPackageUpsert();
      } catch (upsertErr: any) {
        if (/has no column named|no such column/i.test(String(upsertErr?.message || ''))) {
          await ensureExtendedPackageColumns(context.env.DB, true);
          await runPackageUpsert();
        } else {
          throw upsertErr;
        }
      }

      await context.env.DB.prepare(
        `DELETE FROM releases WHERE LOWER(package_id) = LOWER(?)`
      ).bind(packageId).run();

      if (discoveredReleases.length > 0) {
        for (const rel of discoveredReleases.slice(0, 10)) {
          await context.env.DB.prepare(`
            INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version, changelog, released_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))
          `).bind(
            packageId,
            rel.version,
            rel.tag_name,
            rel.commit_sha || '',
            rel.download_url,
            rawMinVersion,
            rel.changelog || null,
            rel.released_at || ''
          ).run();
        }
      } else {
        await context.env.DB.prepare(`
          INSERT INTO releases (package_id, version, tag_name, commit_sha, download_url, min_minetest_version)
          VALUES (?, 'latest', ?, 'HEAD', ?, ?)
        `).bind(packageId, branch, downloadArchiveUrl, rawMinVersion).run();
      }

      if (safetyEval.holdForAdminReview) {
        await ensureModerationColumns(context.env.DB);
        const reportDetails =
          `[Automated Content Safety Hold] ${safetyEval.summary}. ` +
          `Submitted by @${canonicalAuthor} (${repoUrl.trim()}). ` +
          `Click Restore (or Dismiss) to approve and publish to the catalog, or Delist to keep blocked.`;
        const existingSafetyReport = await context.env.DB.prepare(`
          SELECT id FROM moderation_reports
          WHERE LOWER(package_id) = LOWER(?) AND reason = 'inappropriate' AND status = 'open'
          LIMIT 1
        `).bind(packageId).first().catch(() => null);

        if (existingSafetyReport?.id) {
          await context.env.DB.prepare(`
            UPDATE moderation_reports
            SET details = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(reportDetails.slice(0, 1000), existingSafetyReport.id).run();
        } else {
          await context.env.DB.prepare(`
            INSERT INTO moderation_reports (package_id, reporter_user_id, reason, details, status)
            VALUES (?, 'system-content-guard', 'inappropriate', ?, 'open')
          `).bind(packageId, reportDetails.slice(0, 1000)).run();
        }
      } else {
        // Auto-resolve any open 'broken' (404) moderation reports for this package now that its Git repo passed audit
        await autoResolveBrokenRepoReport(
          context.env.DB,
          packageId,
          `Repository verified and updated via Git Pre-Flight Audit (${repoUrl.trim()}).`
        );
      }
    }

    await invalidateEdgeCacheKeys([
      '/__api_packages_v2',
      '/__api_packages_v2?boot=1',
      `/__api_pkg_detail_v2/${canonicalAuthor.toLowerCase()}/${technicalName.toLowerCase()}`
    ]);

    if (safetyEval.holdForAdminReview) {
      return Response.json({
        success: true,
        canPublish: true,
        pendingModeration: true,
        status: 'flagged',
        message:
          `Your package was flagged by automated content safety checks (${safetyEval.summary}) and has been submitted to administrators for review before appearing in the public catalog.`,
        audit: auditReport,
        auditReport,
        package: packagePayload
      });
    }

    return Response.json({
      success: true,
      canPublish: true,
      pendingModeration: false,
      status: 'active',
      audit: auditReport,
      auditReport,
      package: packagePayload
    });

  } catch (err: any) {
    return Response.json(
      {
        error: sanitizePublicErrorMessage(
          err,
          'We encountered a temporary server error while processing your repository. Please try again in a moment.'
        )
      },
      { status: 500 }
    );
  }
}

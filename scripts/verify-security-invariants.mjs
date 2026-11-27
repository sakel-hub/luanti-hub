#!/usr/bin/env node
/**
 * Verifies LuantiHub security, PWA, i18n, and repository hygiene invariants
 * in local development, Antigravity Stop hooks, and CI (`npm run check:security`):
 *
 * 1. Exact CSP & security header parity between `public/_headers` and `functions/_middleware.ts`
 * 2. No-cache headers for PWA boot/worker assets in `public/_headers`
 * 3. Strict `DomSanitizer.bypassSecurityTrust*` discipline across `src/`
 * 4. Shared SW notification engine markers intact in `notification-engine.ts` and `public/custom-sw.js`
 * 5. 6-locale (`en`, `sk`, `de`, `fr`, `es`, `ru`) translation key parity
 * 6. `.gitignore` protects `.agents/` and `.vscode/`, and MCP configs contain no embedded secrets
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(scriptDir, '..');
const errors = [];

function fail(message) {
  errors.push(message);
}

// ---------------------------------------------------------------------------
// 1. CSP & Security Header Parity (`public/_headers` <-> `functions/_middleware.ts`)
// ---------------------------------------------------------------------------
const headersPath = join(root, 'public', '_headers');
const middlewarePath = join(root, 'functions', '_middleware.ts');

const headersRaw = readFileSync(headersPath, 'utf8');
const middlewareRaw = readFileSync(middlewarePath, 'utf8');

function parseStaticHeaders(raw) {
  const blocks = new Map();
  let currentPath = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      currentPath = line.trim();
      if (!blocks.has(currentPath)) blocks.set(currentPath, new Map());
      continue;
    }
    if (!currentPath) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const name = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    blocks.get(currentPath).set(name, value);
  }
  return blocks;
}

const staticHeaderBlocks = parseStaticHeaders(headersRaw);
const globalStaticHeaders = staticHeaderBlocks.get('/*');

if (!globalStaticHeaders) {
  fail('Missing `/*` header block in public/_headers');
} else {
  const staticCsp = globalStaticHeaders.get('Content-Security-Policy');
  const cspMatch = middlewareRaw.match(/export const ENFORCING_CSP_HEADER\s*=\s*\n?\s*"([^"]+)"/);
  if (!staticCsp) {
    fail('Missing Content-Security-Policy under `/*` in public/_headers');
  } else if (!cspMatch) {
    fail('Could not parse ENFORCING_CSP_HEADER in functions/_middleware.ts');
  } else if (staticCsp !== cspMatch[1]) {
    fail(
      `CSP mismatch between public/_headers and functions/_middleware.ts:\n  public/_headers: ${staticCsp}\n  _middleware.ts : ${cspMatch[1]}`
    );
  }

  const mirroredHeaders = [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Strict-Transport-Security',
    'Cross-Origin-Opener-Policy',
    'X-Permitted-Cross-Domain-Policies'
  ];

  for (const headerName of mirroredHeaders) {
    const expectedValue = globalStaticHeaders.get(headerName);
    if (!expectedValue) {
      fail(`Missing ${headerName} under /* in public/_headers`);
      continue;
    }
    const escapedName = headerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedVal = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const middlewareHeaderRe = new RegExp(
      `headers\\.set\\(['"]${escapedName}['"],\\s*['"]${escapedVal}['"]\\)`
    );
    if (!middlewareHeaderRe.test(middlewareRaw)) {
      fail(
        `Header parity drift for ${headerName}: expected "${expectedValue}" in functions/_middleware.ts`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. PWA Boot & Service Worker No-Cache Headers
// ---------------------------------------------------------------------------
const requiredNoCacheRoutes = [
  '/ngsw.json',
  '/ngsw-worker.js',
  '/sw.js',
  '/custom-sw.js',
  '/index.html',
  '/manifest.webmanifest'
];

for (const route of requiredNoCacheRoutes) {
  const block = staticHeaderBlocks.get(route);
  const cc = block?.get('Cache-Control') || '';
  if (!/no-cache/i.test(cc) || !/no-store/i.test(cc) || !/must-revalidate/i.test(cc)) {
    fail(
      `PWA route ${route} in public/_headers must emit Cache-Control: no-cache, no-store, must-revalidate (found: "${cc}")`
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Angular Sanitizer Discipline (`src/`)
// ---------------------------------------------------------------------------
const ALLOWED_RESOURCE_URL_FILES = new Set([
  'src/app/app.ts',
  'src/app/features/card/package-card.component.ts',
  'src/app/features/modal/package-detail-modal.component.ts'
]);

const FORBIDDEN_BYPASS_PATTERN =
  /\bbypassSecurityTrust(?:Html|Script|Style|Url)\s*\(/;
const RESOURCE_BYPASS_PATTERN = /\bbypassSecurityTrustResourceUrl\s*\(/;

function walkSourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSourceFiles(full, acc);
    } else if (/\.(ts|html)$/.test(entry) && !entry.endsWith('.spec.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function stripComments(source, isHtml) {
  if (isHtml) {
    return source.replace(/<!--[\s\S]*?-->/g, '');
  }
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

for (const file of walkSourceFiles(join(root, 'src'))) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const content = readFileSync(file, 'utf8');
  const stripped = stripComments(content, rel.endsWith('.html'));

  if (FORBIDDEN_BYPASS_PATTERN.test(stripped)) {
    fail(`Forbidden DomSanitizer bypassSecurityTrustHtml/Script/Style/Url call in ${rel}`);
  }

  if (RESOURCE_BYPASS_PATTERN.test(stripped)) {
    if (!ALLOWED_RESOURCE_URL_FILES.has(rel)) {
      fail(
        `Unauthorized bypassSecurityTrustResourceUrl() in ${rel} (only allowed in vetted video-embed components using buildSafeVideoEmbedUrl)`
      );
    } else if (!/\b(buildSafeVideoEmbedUrl|buildVideoEmbedUrl|buildHoverEmbedUrl)\b/.test(stripped)) {
      fail(
        `Vetted file ${rel} uses bypassSecurityTrustResourceUrl() without a canonical video embed builder`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Shared SW Notification Engine Sync Markers
// ---------------------------------------------------------------------------
const BEGIN_MARKER = '// === BEGIN SHARED NOTIF ENGINE ===';
const END_MARKER = '// === END SHARED NOTIF ENGINE ===';

for (const relPath of ['src/app/core/utils/notification-engine.ts', 'public/custom-sw.js']) {
  const full = join(root, relPath);
  if (!existsSync(full)) {
    fail(`Missing required SW sync file: ${relPath}`);
    continue;
  }
  const content = readFileSync(full, 'utf8');
  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    fail(`Missing or malformed shared notification engine markers in ${relPath}`);
  }
}

// ---------------------------------------------------------------------------
// 5. 6-Locale Translation Parity (`en`, `sk`, `de`, `fr`, `es`, `ru`)
// ---------------------------------------------------------------------------
const LOCALES = ['en', 'sk', 'de', 'fr', 'es', 'ru'];

let ts = null;
try {
  const mod = await import('typescript');
  ts = mod.default || mod;
} catch {
  ts = null;
}

function extractLocaleKeys(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const keys = new Set();

  if (ts) {
    const sf = ts.createSourceFile(filePath, raw, ts.ScriptTarget.ES2022, true);
    function visitObj(objLit, prefix) {
      for (const prop of objLit.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
          ? prop.name.text
          : prop.name.getText(sf);
        const fullKey = prefix ? `${prefix}.${name}` : name;
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          visitObj(prop.initializer, fullKey);
        } else {
          keys.add(fullKey);
        }
      }
    }
    function walk(node) {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        visitObj(node.initializer, '');
        return;
      }
      ts.forEachChild(node, walk);
    }
    walk(sf);
  }

  return keys;
}

const baseLocalePath = join(root, 'src', 'app', 'core', 'i18n', 'locales', 'en.ts');
if (!ts) {
  fail('TypeScript compiler package is required to verify 6-locale AST key parity');
} else if (!existsSync(baseLocalePath)) {
  fail('Missing base English locale file: src/app/core/i18n/locales/en.ts');
} else {
  const baseKeys = extractLocaleKeys(baseLocalePath);
  if (baseKeys.size === 0) {
    fail('Extracted 0 translation keys from src/app/core/i18n/locales/en.ts (unexpected AST format)');
  } else {
    for (const locale of LOCALES) {
      const localePath = join(root, 'src', 'app', 'core', 'i18n', 'locales', `${locale}.ts`);
      if (!existsSync(localePath)) {
        fail(`Missing locale file: src/app/core/i18n/locales/${locale}.ts`);
        continue;
      }
      if (locale === 'en') continue;
      const localeKeys = extractLocaleKeys(localePath);
      const missing = [...baseKeys].filter((k) => !localeKeys.has(k));
      const extra = [...localeKeys].filter((k) => !baseKeys.has(k));
      if (missing.length > 0) {
        fail(
          `Locale ${locale}.ts is missing ${missing.length} key(s) present in en.ts: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' ...' : ''}`
        );
      }
      if (extra.length > 0) {
        fail(
          `Locale ${locale}.ts has ${extra.length} extra key(s) absent from en.ts: ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ' ...' : ''}`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Git Ignore & Secret-Free MCP Config Hygiene
// ---------------------------------------------------------------------------
const gitignorePath = join(root, '.gitignore');
if (existsSync(gitignorePath)) {
  const gitignoreLines = readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim());
  for (const requiredIgnore of ['.agents/', '.vscode/']) {
    if (!gitignoreLines.includes(requiredIgnore)) {
      fail(`.gitignore must keep ${requiredIgnore} ignored`);
    }
  }
}

const SECRET_TOKEN_PATTERN =
  /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,})/i;

const mcpPaths = [
  '.agents/plugins/luanti-hub/mcp_config.json',
  '.vscode/mcp.json'
];

for (const relPath of mcpPaths) {
  const full = join(root, relPath);
  if (!existsSync(full)) continue;
  const content = readFileSync(full, 'utf8');
  if (SECRET_TOKEN_PATTERN.test(content)) {
    fail(`Potential hardcoded secret token detected in ${relPath}`);
  }
}

// ---------------------------------------------------------------------------
// Final Report
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  for (const err of errors) {
    console.error(`[security-check] FAIL: ${err}`);
  }
  process.exit(1);
}

console.log(
  '[security-check] OK — CSP/header parity, PWA no-cache, sanitizer discipline, SW markers, 6-locale parity, and repo hygiene verified.'
);

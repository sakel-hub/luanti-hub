import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB_NAME = 'luanti-registry-db';
const WRANGLER_JS = path.resolve(process.cwd(), 'node_modules/wrangler/bin/wrangler.js');
const D1_DIR = path.resolve(process.cwd(), '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const DEFAULT_SQLITE_FILENAME = '2ad3e76d2676be53c3403e89e0a1d6a6744e9df202368bb9f98c68e4681c481f.sqlite';

function resolveLocalSqlitePath() {
  fs.mkdirSync(D1_DIR, { recursive: true });
  const entries = fs
    .readdirSync(D1_DIR)
    .filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (entries.length > 0) {
    return path.join(D1_DIR, entries[0]);
  }
  return path.join(D1_DIR, DEFAULT_SQLITE_FILENAME);
}

function runLocalSqlFile(sqlFilePath) {
  const sqlitePath = resolveLocalSqlitePath();
  try {
    const sqlText = fs.readFileSync(sqlFilePath, 'utf8');
    execFileSync('sqlite3', [sqlitePath], {
      input: sqlText,
      stdio: ['pipe', 'inherit', 'inherit']
    });
    return;
  } catch {
    execFileSync(
      process.execPath,
      [WRANGLER_JS, 'd1', 'execute', DB_NAME, '--local', `--file=${sqlFilePath}`],
      { stdio: 'inherit' }
    );
  }
}

function queryLocalSqliteJson(sqlCommand) {
  const sqlitePath = resolveLocalSqlitePath();
  try {
    const out = execFileSync('sqlite3', ['-json', sqlitePath, sqlCommand], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!out) return [];
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function ensureLocalExtendedColumns() {
  const existingCols = getLocalTableColumns('packages');
  if (!existingCols) return;
  const requiredExtraCols = [
    ['badge_tags', 'TEXT'],
    ['screenshot_meta', 'TEXT'],
    ['supports_all_games', 'INTEGER DEFAULT 0'],
    ['translations', 'TEXT'],
    ['latest_commit_sha', 'TEXT'],
    ['contentdb_downloads', 'INTEGER DEFAULT 0'],
    ['luantihub_downloads', 'INTEGER DEFAULT 0'],
    ['download_size', 'INTEGER'],
    ['file_size', 'TEXT'],
    ['game_support', 'TEXT'],
    ['review_thread_counts', 'TEXT']
  ];
  const sqlitePath = resolveLocalSqlitePath();
  for (const [colName, colDef] of requiredExtraCols) {
    if (!existingCols.has(colName)) {
      try {
        execFileSync(
          'sqlite3',
          [sqlitePath, `ALTER TABLE packages ADD COLUMN ${colName} ${colDef};`],
          { stdio: 'ignore' }
        );
      } catch {
        // Ignore if already exists
      }
    }
  }
}

function queryWranglerRemoteJson(sqlCommand) {
  try {
    const out = execFileSync(
      process.execPath,
      [WRANGLER_JS, 'd1', 'execute', DB_NAME, '--remote', `--command=${sqlCommand}`, '--json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15000
      }
    );
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed) && parsed[0]?.results) {
      return parsed[0].results;
    }
    return null;
  } catch {
    return null;
  }
}

function sqlLiteral(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  if (typeof val === 'boolean') {
    return val ? '1' : '0';
  }
  if (typeof val === 'object') {
    const json = JSON.stringify(val).replace(/'/g, "''");
    return `'${json}'`;
  }
  const escaped = String(val).replace(/'/g, "''");
  return `'${escaped}'`;
}

function buildInsertStatements(tableName, rows, allowedCols) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const statements = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const cols = Object.keys(row).filter(c => !allowedCols || allowedCols.has(c));
    if (cols.length === 0) continue;
    const colList = cols.map(c => `"${c}"`).join(', ');
    const valList = cols.map(c => sqlLiteral(row[c])).join(', ');
    statements.push(`INSERT OR REPLACE INTO "${tableName}" (${colList}) VALUES (${valList});`);
  }
  return statements;
}

function getLocalTableColumns(tableName) {
  const rows = queryLocalSqliteJson(`PRAGMA table_info("${tableName}");`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return new Set(rows.map(r => r.name).filter(Boolean));
}

async function syncFromProductionCatalogApi() {
  console.log('[db:sync:local] Fetching current Git repositories from https://luantihub.org/api/packages...');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://luantihub.org/api/packages?boot=1&limit=1000', {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LuantiHub-LocalDevSync/1.0' }
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const payload = await res.json();
    const list = Array.isArray(payload) ? payload : Array.isArray(payload?.packages) ? payload.packages : [];
    const gitPkgs = list.filter(p => {
      if (!p || !p.author || !p.name) return false;
      const isGitSource =
        p.source === 'git' ||
        (Array.isArray(p.sources) && p.sources.includes('git')) ||
        (p.provider && p.provider !== 'contentdb');
      const hasVerifiedAuthor =
        typeof p.author_id === 'string' && p.author_id.trim() !== '' && !p.author_id.startsWith('ext_');
      return isGitSource || hasVerifiedAuthor;
    });

    if (gitPkgs.length === 0) return false;

    const usersRows = [];
    const identitiesRows = [];
    const packageRows = [];
    const seenUsers = new Set();

    for (const p of gitPkgs) {
      const authorName = String(p.author || p.author_name || '').trim();
      const name = String(p.name || '').trim();
      if (!authorName || !name) continue;

      const authorId =
        typeof p.author_id === 'string' && p.author_id.trim() && !p.author_id.startsWith('ext_')
          ? p.author_id.trim()
          : `usr_${authorName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_verified`;

      const repoUrl = String(
        p.repo_url || p.repo || `https://github.com/${authorName}/${name}`
      ).trim();

      const provider =
        p.provider && p.provider !== 'contentdb'
          ? String(p.provider).toLowerCase()
          : repoUrl.includes('codeberg.org')
            ? 'codeberg'
            : repoUrl.includes('gitlab')
              ? 'gitlab'
              : repoUrl.includes('bitbucket.org')
                ? 'bitbucket'
                : 'github';

      if (!seenUsers.has(authorId)) {
        seenUsers.add(authorId);
        usersRows.push({
          id: authorId,
          username: authorName,
          display_name: p.author_display_name || authorName,
          avatar_url: p.author_avatar || null,
          role: 'user'
        });
        identitiesRows.push({
          user_id: authorId,
          provider,
          provider_user_id: `${provider}_${authorName.toLowerCase()}`,
          provider_username: authorName,
          verified: 1
        });
      }

      const tagsArr = Array.isArray(p.tags) ? [...p.tags] : [];
      if (!tagsArr.map(t => String(t).toLowerCase()).includes('git')) {
        tagsArr.push('git');
      }

      const rawType = String(p.type || 'mod').toLowerCase();
      const normalizedType =
        rawType === 'game'
          ? 'game'
          : rawType === 'txp' || rawType === 'texture_pack'
            ? 'txp'
            : rawType === 'modpack'
              ? 'modpack'
              : 'mod';

      packageRows.push({
        id: `${authorName}/${name}`,
        author_id: authorId,
        author_name: authorName,
        name,
        title: p.title || name,
        type: normalizedType,
        short_desc: p.short_desc || p.short_description || '',
        long_desc: p.desc || p.long_desc || p.short_desc || '',
        repo_url: repoUrl,
        provider,
        default_branch: p.default_branch || 'master',
        thumbnail_url: p.thumbnail || p.thumbnail_url || null,
        banner_url: p.banner || p.banner_url || p.thumbnail || null,
        license: p.license || 'MIT',
        media_license: p.media_license || p.license || 'CC-BY-SA-4.0',
        tags: JSON.stringify(tagsArr),
        badge_tags: JSON.stringify(Array.isArray(p.badge_tags) ? p.badge_tags : []),
        dependencies: JSON.stringify(Array.isArray(p.dependencies) ? p.dependencies : []),
        optional_dependencies: JSON.stringify(
          Array.isArray(p.optional_dependencies) ? p.optional_dependencies : []
        ),
        min_minetest_version: p.min_minetest_version || '5.0.0',
        status: 'active',
        downloads_count: Number(p.downloads || p.downloads_count || 0),
        contentdb_downloads: Number(p.contentdb_downloads || p.downloads || 0),
        luantihub_downloads: Number(p.luantihub_downloads || 0),
        download_size: Number(p.download_size || 0) || null,
        file_size: p.file_size || null,
        supports_all_games: p.supports_all_games ? 1 : 0,
        game_support: JSON.stringify(Array.isArray(p.game_support) ? p.game_support : []),
        score: Number(p.score || 4.8)
      });
    }

    const pkgCols = getLocalTableColumns('packages');
    const usersCols = getLocalTableColumns('users');
    const idCols = getLocalTableColumns('user_identities');

    const sqlLines = [
      'PRAGMA foreign_keys = OFF;',
      ...buildInsertStatements('users', usersRows, usersCols),
      ...buildInsertStatements('user_identities', identitiesRows, idCols),
      ...buildInsertStatements('packages', packageRows, pkgCols),
      'PRAGMA foreign_keys = ON;'
    ];

    const tmpSqlPath = path.join(os.tmpdir(), `luantihub_api_sync_${Date.now()}.sql`);
    fs.writeFileSync(tmpSqlPath, sqlLines.join('\n') + '\n', 'utf8');
    try {
      runLocalSqlFile(tmpSqlPath);
    } finally {
      fs.rmSync(tmpSqlPath, { force: true });
    }

    console.log(
      `[db:sync:local] Synced ${packageRows.length} Git repository package(s) from production catalog API.`
    );
    return true;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function syncFromRemoteD1() {
  console.log('[db:sync:local] Checking remote Cloudflare D1 for verified Git repositories...');
  const remotePackages = queryWranglerRemoteJson(
    "SELECT * FROM packages WHERE status = 'active' AND (provider != 'contentdb' OR author_id IS NOT NULL OR (tags IS NOT NULL AND tags LIKE '%git%')) LIMIT 1000;"
  );
  if (!Array.isArray(remotePackages) || remotePackages.length === 0) {
    return false;
  }

  const remoteUsers = queryWranglerRemoteJson('SELECT * FROM users LIMIT 1000;') || [];
  const remoteIdentities = queryWranglerRemoteJson('SELECT * FROM user_identities LIMIT 2000;') || [];
  const remoteReleases = queryWranglerRemoteJson('SELECT * FROM releases LIMIT 2000;') || [];
  const remotePromos = queryWranglerRemoteJson('SELECT * FROM hero_promotions LIMIT 50;') || [];

  const usersCols = getLocalTableColumns('users');
  const idCols = getLocalTableColumns('user_identities');
  const pkgCols = getLocalTableColumns('packages');
  const relCols = getLocalTableColumns('releases');
  const promoCols = getLocalTableColumns('hero_promotions');

  const sqlLines = [
    'PRAGMA foreign_keys = OFF;',
    ...buildInsertStatements('users', remoteUsers, usersCols),
    ...buildInsertStatements('user_identities', remoteIdentities, idCols),
    ...buildInsertStatements('packages', remotePackages, pkgCols),
    ...buildInsertStatements('releases', remoteReleases, relCols),
    ...buildInsertStatements('hero_promotions', remotePromos, promoCols),
    'PRAGMA foreign_keys = ON;'
  ];

  const tmpSqlPath = path.join(os.tmpdir(), `luantihub_remote_sync_${Date.now()}.sql`);
  fs.writeFileSync(tmpSqlPath, sqlLines.join('\n') + '\n', 'utf8');
  try {
    runLocalSqlFile(tmpSqlPath);
  } finally {
    fs.rmSync(tmpSqlPath, { force: true });
  }

  console.log(
    `[db:sync:local] Synced ${remotePackages.length} Git/verified package(s) and ${remoteUsers.length} user(s) from remote Cloudflare D1.`
  );
  return true;
}

async function main() {
  console.log('[db:sync:local] Initializing local D1 schema and baseline Git repository seed...');
  runLocalSqlFile('functions/schema.sql');
  ensureLocalExtendedColumns();
  runLocalSqlFile('functions/seed-git-local.sql');

  const syncedApi = await syncFromProductionCatalogApi();
  if (!syncedApi) {
    await syncFromRemoteD1();
  }

  const countRows = queryLocalSqliteJson(
    "SELECT COUNT(*) AS total FROM packages WHERE status = 'active';"
  );
  const total = countRows?.[0]?.total ?? 0;
  console.log(`[db:sync:local] Local D1 database ready with ${total} active verified Git package(s).`);
}

main().catch(err => {
  console.error('[db:sync:local] Error:', err);
  process.exit(1);
});

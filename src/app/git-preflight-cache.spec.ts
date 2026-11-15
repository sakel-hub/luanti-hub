import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  onRequestPost as gitOnRequestPost,
  resetGitAuditCachesForTests,
  GIT_SMART_REFS_REFRESH_COOLDOWN_MS
} from '../../functions/api/packages/git';
import { createSessionToken } from '../../functions/api/auth/lib/session';
import { clearIsolateCachesForTests } from '../../functions/api/lib/upstream';

function buildSmartRefsAdvertisement(
  headSha: string,
  defaultBranch: string,
  branches: Record<string, string>,
  tags: Array<{ name: string; sha: string; peeledSha?: string }> = []
): string {
  const lines = [
    '001e# service=git-upload-pack',
    `00000100${headSha} HEAD\0multi_ack thin-pack symref=HEAD:refs/heads/${defaultBranch} agent=git/test`,
    ...Object.entries(branches).map(([b, s]) => `003f${s} refs/heads/${b}`),
    ...tags.flatMap((t) =>
      t.peeledSha
        ? [`003f${t.sha} refs/tags/${t.name}`, `0042${t.peeledSha} refs/tags/${t.name}^{}`]
        : [`003f${t.sha} refs/tags/${t.name}`]
    ),
    '0000'
  ];
  return lines.join('\n');
}

function createMockDb(userIdentities: Record<string, Array<{ provider: string; username: string; verified: number }>>) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          if (sql.includes('FROM users WHERE id =')) {
            const uid = String(args[0] || '');
            return { id: uid, username: uid, display_name: uid };
          }
          return null;
        },
        all: async () => {
          if (sql.includes('FROM user_identities WHERE user_id =')) {
            const uid = String(args[0] || '');
            return { results: userIdentities[uid] || [] };
          }
          return { results: [] };
        },
        run: async () => ({ meta: { changes: 1 } })
      }),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1 } })
    })
  };
}

function createMockEdgeCache() {
  const store = new Map<string, Response>();
  return {
    store,
    cachesObj: {
      default: {
        match: vi.fn(async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          const hit = store.get(key);
          return hit ? hit.clone() : undefined;
        }),
        put: vi.fn(async (req: Request | string, res: Response) => {
          const key = typeof req === 'string' ? req : req.url;
          store.set(key, res.clone());
        }),
        delete: vi.fn(async (req: Request | string) => {
          const key = typeof req === 'string' ? req : req.url;
          return store.delete(key);
        })
      }
    }
  };
}

describe('Git Pre-Flight Check Commit-SHA Caching & Quota Protection', () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = (globalThis as any).caches;

  beforeEach(() => {
    clearIsolateCachesForTests();
    resetGitAuditCachesForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).caches = originalCaches;
    clearIsolateCachesForTests();
    resetGitAuditCachesForTests();
    vi.restoreAllMocks();
  });

  it('picks up newly pushed commits immediately via commit-SHA raw URLs even when branch CDN serves stale files', async () => {
    const sha1 = '6e4f87a111111111111111111111111111111111';
    const sha2 = 'e728b2f222222222222222222222222222222222';
    let currentSha = sha1;
    let fakeNowMs = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);

    const mockCache = createMockEdgeCache();
    (globalThis as any).caches = mockCache.cachesObj;

    const brokenGameConf = 'author = SaKeL\ndescription = Alchemist arena\n';
    const fixedGameConf = 'title = Sky-Bridge Alchemists\nauthor = SaKeL\ndescription = Alchemist arena\n';
    const requestedUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      requestedUrls.push(url);

      if (url.includes('/info/refs?service=git-upload-pack')) {
        return new Response(
          buildSmartRefsAdvertisement(currentSha, 'main', { main: currentSha }),
          { status: 200 }
        );
      }
      // Deliberately serve stale broken game.conf on branch ref (`main`) forever
      if (url === 'https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/main/game.conf') {
        return new Response(brokenGameConf, { status: 200 });
      }
      if (url === `https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/${sha1}/game.conf`) {
        return new Response(brokenGameConf, { status: 200 });
      }
      if (url === `https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/${sha2}/game.conf`) {
        return new Response(fixedGameConf, { status: 200 });
      }
      if (
        url === `https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/${sha1}/LICENSE` ||
        url === `https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/${sha2}/LICENSE`
      ) {
        return new Response('MIT License\nPermission is hereby granted, free of charge...', { status: 200 });
      }
      if (
        url === `https://api.github.com/repos/sakel-hub/skybridge_alchemists/contents?ref=${sha1}` ||
        url === `https://api.github.com/repos/sakel-hub/skybridge_alchemists/contents?ref=${sha2}`
      ) {
        return new Response(
          JSON.stringify([
            { name: 'game.conf', type: 'file' },
            { name: 'mods', type: 'dir' }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const sessionCookie = await createSessionToken('user-sakel', 'test-secret');
    const mockDb = createMockDb({
      'user-sakel': [{ provider: 'github', username: 'sakel-hub', verified: 1 }]
    });
    const repoUrl = 'https://github.com/sakel-hub/skybridge_alchemists';

    // 1. First Pre-Flight Check on broken commit sha1 -> fails with CONF_MISSING_TITLE (422)
    const res1 = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(res1.status).toBe(422);
    const body1: any = await res1.json();
    expect(body1.canPublish).toBe(false);
    expect(body1.audit.diagnostics.some((d: any) => d.code === 'CONF_MISSING_TITLE')).toBe(true);
    expect(requestedUrls).toContain(
      `https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/${sha1}/game.conf`
    );

    // 2. User pushes sha2 fixing game.conf and re-runs Pre-Flight Check after > 10s cooldown
    currentSha = sha2;
    fakeNowMs += GIT_SMART_REFS_REFRESH_COOLDOWN_MS + 1000;
    requestedUrls.length = 0;

    const res2 = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(res2.status).toBe(200);
    const body2: any = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.canPublish).toBe(true);
    expect(body2.package.name).toBe('skybridge_alchemists');
    expect(body2.audit.diagnostics.some((d: any) => d.code === 'CONF_VALID_NAME')).toBe(true);
    expect(body2.audit.diagnostics.some((d: any) => d.code === 'CONF_MISSING_NAME' || d.code === 'CONF_DEPRECATED_NAME')).toBe(false);
    expect(requestedUrls).toContain(
      `https://raw.githubusercontent.com/sakel-hub/skybridge_alchemists/${sha2}/game.conf`
    );
    expect(requestedUrls).toContain(
      `https://api.github.com/repos/sakel-hub/skybridge_alchemists/contents?ref=${sha2}`
    );
    // Must not call GitHub releases API when info/refs confirmed 0 tags
    expect(requestedUrls.some((u) => u.includes('api.github.com/repos/sakel-hub/skybridge_alchemists/releases'))).toBe(false);
    expect(requestedUrls.some((u) => u.includes('api.github.com/repos/sakel-hub/skybridge_alchemists/tags'))).toBe(false);
  });

  it('throttles spam-clicks within 10s cooldown and isolates per-caller ownership on 300s SHA audit snapshots', async () => {
    const sha1 = '1111111111111111111111111111111111111111';
    let fakeNowMs = 1_700_000_500_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);

    const mockCache = createMockEdgeCache();
    (globalThis as any).caches = mockCache.cachesObj;

    let smartRefsCalls = 0;
    let confFetchCalls = 0;
    let initLuaFetchCalls = 0;

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/info/refs?service=git-upload-pack')) {
        smartRefsCalls++;
        return new Response(
          buildSmartRefsAdvertisement(sha1, 'main', { main: sha1 }),
          { status: 200 }
        );
      }
      if (url === `https://raw.githubusercontent.com/owner-a/spam_mod/${sha1}/mod.conf`) {
        confFetchCalls++;
        return new Response('name = spam_mod\ntitle = Spam Mod\ndescription = Safe\nlicense = MIT\n', { status: 200 });
      }
      if (url === `https://raw.githubusercontent.com/owner-a/spam_mod/${sha1}/init.lua`) {
        initLuaFetchCalls++;
        return new Response('local n = core.get_current_modname()\ncore.log("action", n)\n', { status: 200 });
      }
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const ownerCookie = await createSessionToken('user-owner-a', 'test-secret');
    const strangerCookie = await createSessionToken('user-stranger-b', 'test-secret');
    const mockDb = createMockDb({
      'user-owner-a': [{ provider: 'github', username: 'owner-a', verified: 1 }],
      'user-stranger-b': [{ provider: 'github', username: 'other-user', verified: 1 }]
    });
    const repoUrl = 'https://github.com/owner-a/spam_mod';

    // Click 1: Cold check fetches info/refs + commit-pinned files
    const r1 = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${ownerCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(r1.status).toBe(200);
    const b1: any = await r1.json();
    expect(b1.ownershipVerified).toBe(true);
    expect(smartRefsCalls).toBe(1);
    expect(confFetchCalls).toBe(1);
    expect(initLuaFetchCalls).toBe(1);

    // Clicks 2-4 within < 10s: 0 info/refs requests, 0 raw file fetches
    for (let i = 0; i < 3; i++) {
      fakeNowMs += 2_000;
      const rSpam = await gitOnRequestPost({
        request: new Request('https://luantihub.org/api/packages/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${ownerCookie}` },
          body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
        }),
        env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
      });
      expect(rSpam.status).toBe(200);
    }
    expect(smartRefsCalls).toBe(1);
    expect(confFetchCalls).toBe(1);
    expect(initLuaFetchCalls).toBe(1);

    // Click 5 after > 10s by a DIFFERENT caller (unverified non-owner):
    // Refreshes info/refs once (same sha1), hits 300s SHA audit snapshot (0 file fetches),
    // and computes caller-specific ownershipVerified = false without mutating owner-a's cached snapshot.
    fakeNowMs += GIT_SMART_REFS_REFRESH_COOLDOWN_MS + 1000;
    const rStranger = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${strangerCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(rStranger.status).toBe(200);
    const bStranger: any = await rStranger.json();
    expect(bStranger.ownershipVerified).toBe(false);
    expect(
      bStranger.audit.diagnostics.some((d: any) => d.code === 'REPO_OWNERSHIP_REQUIRED')
    ).toBe(true);
    expect(smartRefsCalls).toBe(2);
    expect(confFetchCalls).toBe(1);
    expect(initLuaFetchCalls).toBe(1);
  });

  it('uses /raw/commit/<sha>/ for Codeberg audits while storing branch URLs for package screenshots', async () => {
    const sha1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const mockCache = createMockEdgeCache();
    (globalThis as any).caches = mockCache.cachesObj;
    const requestedUrls: Array<{ url: string; method: string }> = [];

    globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = (init?.method || 'GET').toUpperCase();
      requestedUrls.push({ url, method });

      if (url.includes('/info/refs?service=git-upload-pack')) {
        return new Response(
          buildSmartRefsAdvertisement(sha1, 'main', { main: sha1 }),
          { status: 200 }
        );
      }
      if (url === `https://codeberg.org/wuzzy/test_mod/raw/commit/${sha1}/mod.conf`) {
        return new Response('name = test_mod\ntitle = Test Mod\ndescription = Codeberg mod\nlicense = MIT\n', { status: 200 });
      }
      if (url === `https://codeberg.org/wuzzy/test_mod/raw/commit/${sha1}/init.lua`) {
        return new Response('core.register_node("test_mod:stone", { description = "Stone" })\n', { status: 200 });
      }
      if (url === `https://codeberg.org/wuzzy/test_mod/raw/commit/${sha1}/screenshot.png` && method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const sessionCookie = await createSessionToken('user-wuzzy', 'test-secret');
    const mockDb = createMockDb({
      'user-wuzzy': [{ provider: 'codeberg', username: 'wuzzy', verified: 1 }]
    });

    const res = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({
          repoUrl: 'https://codeberg.org/wuzzy/test_mod',
          dryRun: true,
          warrantiesAccepted: true
        })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.canPublish).toBe(true);
    expect(
      requestedUrls.some(
        (r) => r.url === `https://codeberg.org/wuzzy/test_mod/raw/commit/${sha1}/mod.conf`
      )
    ).toBe(true);
    expect(
      requestedUrls.some(
        (r) => r.url === `https://codeberg.org/wuzzy/test_mod/raw/commit/${sha1}/screenshot.png` && r.method === 'HEAD'
      )
    ).toBe(true);
    expect(body.package.thumbnail).toBe(
      'https://codeberg.org/wuzzy/test_mod/raw/branch/main/screenshot.png'
    );
  });

  it('reuses cached releases when smartRefs tags are unchanged and refreshes immediately when a new tag is pushed', async () => {
    const commitSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const tag1Sha = 'cccccccccccccccccccccccccccccccccccccccc';
    const tag2Sha = 'dddddddddddddddddddddddddddddddddddddddd';
    let fakeNowMs = 1_700_001_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);

    const mockCache = createMockEdgeCache();
    (globalThis as any).caches = mockCache.cachesObj;

    let liveTags: Array<{ name: string; sha: string }> = [{ name: 'v1.0.0', sha: tag1Sha }];
    let releaseApiCalls = 0;

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/info/refs?service=git-upload-pack')) {
        return new Response(
          buildSmartRefsAdvertisement(commitSha, 'main', { main: commitSha }, liveTags),
          { status: 200 }
        );
      }
      if (url === `https://raw.githubusercontent.com/tagger/rel_mod/${commitSha}/mod.conf`) {
        return new Response('name = rel_mod\ntitle = Release Mod\ndescription = Has releases\nlicense = MIT\n', { status: 200 });
      }
      if (url === `https://raw.githubusercontent.com/tagger/rel_mod/${commitSha}/init.lua`) {
        return new Response('core.log("action", "rel_mod loaded")\n', { status: 200 });
      }
      if (url === 'https://api.github.com/repos/tagger/rel_mod/releases?per_page=15') {
        releaseApiCalls++;
        return new Response(
          JSON.stringify(
            liveTags.map((t, idx) => ({
              id: idx + 1,
              tag_name: t.name,
              name: t.name,
              draft: false,
              published_at: `2026-11-1${idx + 1}T00:00:00Z`
            }))
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('https://api.github.com/repos/tagger/rel_mod/commits/')) {
        return new Response(
          JSON.stringify({ commit: { committer: { date: '2026-11-12T00:00:00Z' } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const sessionCookie = await createSessionToken('user-tagger', 'test-secret');
    const mockDb = createMockDb({
      'user-tagger': [{ provider: 'github', username: 'tagger', verified: 1 }]
    });
    const repoUrl = 'https://github.com/tagger/rel_mod';

    // 1. Initial audit fetches releases once (v1.0.0)
    const r1 = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(r1.status).toBe(200);
    const b1: any = await r1.json();
    expect(b1.package.releases_list.map((r: any) => r.tag_name)).toEqual(['v1.0.0']);
    expect(releaseApiCalls).toBe(1);

    // 2. Re-check after > 10s with unchanged tags: 0 additional releases API calls
    fakeNowMs += GIT_SMART_REFS_REFRESH_COOLDOWN_MS + 1000;
    const r2 = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(r2.status).toBe(200);
    expect(releaseApiCalls).toBe(1);

    // 3. Push v1.1.0 and re-check after > 10s: detects changed smartRefs.tags and refreshes releases
    liveTags = [
      { name: 'v1.1.0', sha: tag2Sha },
      { name: 'v1.0.0', sha: tag1Sha }
    ];
    fakeNowMs += GIT_SMART_REFS_REFRESH_COOLDOWN_MS + 1000;
    const r3 = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(r3.status).toBe(200);
    const b3: any = await r3.json();
    expect(releaseApiCalls).toBe(2);
    expect(b3.package.releases_list[0].tag_name).toBe('v1.1.0');
  });

  it('falls back cleanly to unpinned /plain/ URLs with Cache-Control: no-cache when cgit info/refs is unavailable', async () => {
    const requestedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url === 'https://cheapiesystems.com/git/celevator/plain/mod.conf') {
        const hdrs = new Headers(init?.headers);
        requestedHeaders['cacheControl'] = hdrs.get('Cache-Control') || '';
        return new Response('name = celevator\ntitle = C-Elevator\ndescription = Elevators\nlicense = Unlicense\n', { status: 200 });
      }
      if (url === 'https://cheapiesystems.com/git/celevator/plain/init.lua') {
        return new Response('core.log("action", "celevator loaded")\n', { status: 200 });
      }
      if (url.includes('/packages/?fmt=vcs')) {
        return new Response(
          JSON.stringify([
            {
              author: 'cheapie',
              name: 'celevator',
              title: 'C-Elevator',
              type: 'mod',
              repo: 'https://cheapiesystems.com/git/celevator',
              downloads: 4200
            }
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const sessionCookie = await createSessionToken('user-cheapie', 'test-secret');
    const mockDb = createMockDb({
      'user-cheapie': [{ provider: 'contentdb', username: 'cheapie', verified: 1 }]
    });

    const res = await gitOnRequestPost({
      request: new Request('https://luantihub.org/api/packages/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
        body: JSON.stringify({
          repoUrl: 'https://cheapiesystems.com/git/celevator',
          dryRun: true,
          warrantiesAccepted: true
        })
      }),
      env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.canPublish).toBe(true);
    expect(body.ownershipVerified).toBe(true);
    expect(requestedHeaders['cacheControl']).toBe('no-cache');
  });

  it('validates game.conf required title & deprecated name vs mod.conf required snake_case name', async () => {
    const fileMap: Record<string, string> = {
      'https://cheapiesystems.com/git/game_clean/plain/game.conf':
        'title = Clean Game\nauthor = SaKeL\ndescription = Pure game config without name\nlicense = MIT\n',
      'https://cheapiesystems.com/git/game_clean/plain/.cdb.json':
        '{"type":"GAME","name":"game_clean","title":"Clean Game"}\n',
      'https://cheapiesystems.com/git/skybridge_alchemists/plain/game.conf':
        'title = Sky-Bridge Alchemists\nauthor = SaKeL\nname = Sky-Bridge Alchemists\ndescription = Alchemist arena\nlicense = MIT\n',
      'https://cheapiesystems.com/git/mod_missing_name/plain/mod.conf':
        'title = Missing Name Mod\ndescription = Mod config missing technical name\nlicense = MIT\n',
      'https://cheapiesystems.com/git/mod_missing_name/plain/init.lua':
        'core.log("action", "broken")\n'
    };

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url in fileMap) {
        return new Response(fileMap[url], { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as any;

    const sessionCookie = await createSessionToken('user-sakel', 'test-secret');
    const mockDb = createMockDb({
      'user-sakel': [{ provider: 'github', username: 'SaKeL', verified: 1 }]
    });

    const runAudit = (repoUrl: string) =>
      gitOnRequestPost({
        request: new Request('https://luantihub.org/api/packages/git', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: `lh_session=${sessionCookie}` },
          body: JSON.stringify({ repoUrl, dryRun: true, warrantiesAccepted: true })
        }),
        env: { DB: mockDb, SESSION_SECRET: 'test-secret' }
      });

    // (a) game.conf with title + .cdb.json name and NO deprecated name key -> clean pass
    const cleanGameRes = await runAudit('https://cheapiesystems.com/git/game_clean');
    expect(cleanGameRes.status).toBe(200);
    const cleanGameBody: any = await cleanGameRes.json();
    expect(cleanGameBody.canPublish).toBe(true);
    expect(cleanGameBody.package.name).toBe('game_clean');
    expect(cleanGameBody.audit.diagnostics.some((d: any) => d.code === 'CONF_VALID_NAME')).toBe(true);
    expect(
      cleanGameBody.audit.diagnostics.some(
        (d: any) => d.code === 'CONF_MISSING_NAME' || d.code === 'CONF_DEPRECATED_NAME' || d.code === 'CONF_MISSING_TITLE'
      )
    ).toBe(false);

    // (b) game.conf with title AND deprecated name = Sky-Bridge Alchemists on line 3 -> 200 warning, preserves technical gameid
    const deprecatedGameRes = await runAudit('https://cheapiesystems.com/git/skybridge_alchemists');
    expect(deprecatedGameRes.status).toBe(200);
    const deprecatedGameBody: any = await deprecatedGameRes.json();
    expect(deprecatedGameBody.canPublish).toBe(true);
    expect(deprecatedGameBody.package.name).toBe('skybridge_alchemists');
    const deprecatedDiag = deprecatedGameBody.audit.diagnostics.find((d: any) => d.code === 'CONF_DEPRECATED_NAME');
    expect(deprecatedDiag).toBeTruthy();
    expect(deprecatedDiag.severity).toBe('warning');
    expect(deprecatedDiag.line).toBe(3);
    expect(deprecatedGameBody.audit.diagnostics.some((d: any) => d.code === 'CONF_INVALID_NAME')).toBe(false);

    // (c) mod.conf omitting required technical name -> 422 CONF_MISSING_NAME
    const brokenModRes = await runAudit('https://cheapiesystems.com/git/mod_missing_name');
    expect(brokenModRes.status).toBe(422);
    const brokenModBody: any = await brokenModRes.json();
    expect(brokenModBody.canPublish).toBe(false);
    expect(brokenModBody.audit.diagnostics.some((d: any) => d.code === 'CONF_MISSING_NAME')).toBe(true);
  });
});

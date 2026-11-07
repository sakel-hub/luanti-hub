import {
  fetchUpstreamJsonCached,
  safeDecodeParam,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys,
  sanitizePublicErrorMessage
} from '../lib/upstream';
import { parseCookies, verifySessionToken } from '../auth/lib/session';
import {
  inspectAuthorGitSyncStatus,
  syncVerifiedAuthorGitPackages
} from '../lib/author-git-sync';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
}

const authorRefreshCooldown = new Map<string, number>();

export async function onRequestGet(context: {
  request: Request;
  env: Env;
  params: { username: string };
  waitUntil?: (promise: Promise<any>) => void;
}) {
  const rawUsername = safeDecodeParam(context.params?.username || '').trim();
  if (!rawUsername) {
    return Response.json({ error: 'Username is required.' }, { status: 400 });
  }

  const lowerUsername = rawUsername.toLowerCase();
  const cacheKey = `/__api_author_profile_v2/${encodeURIComponent(lowerUsername)}`;
  const url = new URL(context.request.url);
  const requestedNoCache = url.searchParams.get('nocache') === '1';
  let noCache = false;
  if (requestedNoCache) {
    const cookies = parseCookies(context.request);
    const sessionUserId = cookies['lh_session']
      ? await verifySessionToken(cookies['lh_session'], context.env.SESSION_SECRET)
      : null;
    const now = Date.now();
    const lastRefresh = authorRefreshCooldown.get(lowerUsername) || 0;
    if (sessionUserId && now - lastRefresh > 60_000) {
      noCache = true;
      authorRefreshCooldown.set(lowerUsername, now);
    }
  }

    if (!noCache) {
      const cached = await readEdgeCacheJson<any>(cacheKey);
      if (cached) {
        const cachedPending = Number(cached?.author?.git_sync?.pendingQueueCount || 0);
        if (cached?.author?.is_registered && cachedPending > 0 && context.env.DB && context.waitUntil) {
          context.waitUntil(
            syncVerifiedAuthorGitPackages(context.env, {
              authorHandles: [lowerUsername],
              verifiedUsername: String(cached.author.username || rawUsername),
              maxNewImports: 6
            })
              .then(res => {
                if (res && (res.newlyImportedCount > 0 || res.flaggedForReviewCount > 0)) {
                  return invalidateEdgeCacheKeys([cacheKey]);
                }
                return null;
              })
              .catch(() => null)
          );
        }
        return Response.json(cached, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
            'X-LuantiHub-Cache': 'HIT-EDGE'
          }
        });
      }
    }

  // Query ContentDB User API (`GET /api/users/<username>/`) in parallel with D1 lookup
  const cdbUserPromise = fetchUpstreamJsonCached<any>(
    `/users/${encodeURIComponent(rawUsername)}/`,
    600
  ).catch(() => null);

  if (!context.env.DB) {
    const cdbUser = await cdbUserPromise;
    const cdbAvatar = cdbUser?.profile_pic_url
      ? (String(cdbUser.profile_pic_url).startsWith('http')
          ? String(cdbUser.profile_pic_url)
          : `https://content.luanti.org${String(cdbUser.profile_pic_url).startsWith('/') ? '' : '/'}${cdbUser.profile_pic_url}`)
      : (cdbUser?.connections?.github ? `https://github.com/${cdbUser.connections.github}.png` : '');
    const cdbIdentities: any[] = [];
    if (cdbUser?.connections?.github) {
      cdbIdentities.push({
        provider: 'github',
        username: String(cdbUser.connections.github),
        profile_url: `https://github.com/${cdbUser.connections.github}`,
        verified: true
      });
    }
    if (cdbUser?.connections?.forums) {
      cdbIdentities.push({
        provider: 'forums',
        username: String(cdbUser.connections.forums),
        profile_url: `https://forum.luanti.org/memberlist.php?mode=viewprofile&un=${encodeURIComponent(String(cdbUser.connections.forums))}`,
        verified: true
      });
    }
    return Response.json({
      author: {
        username: cdbUser?.username || rawUsername,
        display_name: cdbUser?.display_name || cdbUser?.username || rawUsername,
        avatar_url: cdbAvatar,
        bio: '',
        rank: cdbUser?.rank || undefined,
        website_url: cdbUser?.website_url || undefined,
        donate_url: cdbUser?.donate_url || undefined,
        forums_username: cdbUser?.connections?.forums || undefined,
        contentdb_url: cdbUser?.links?.profile || (cdbUser?.username ? `https://content.luanti.org/users/${encodeURIComponent(cdbUser.username)}/` : undefined),
        is_registered: false,
        identities: cdbIdentities
      }
    });
  }

  try {
    let userRow = await context.env.DB.prepare(`
      SELECT id, username, display_name, avatar_url, bio, created_at
      FROM users
      WHERE LOWER(username) = LOWER(?)
      LIMIT 1
    `).bind(rawUsername).first();

    if (!userRow) {
      const identityMatch = await context.env.DB.prepare(`
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.created_at
        FROM user_identities ui
        JOIN users u ON u.id = ui.user_id
        WHERE LOWER(ui.provider_username) = LOWER(?)
        ORDER BY ui.verified DESC, u.created_at ASC
        LIMIT 1
      `).bind(rawUsername).first();
      if (identityMatch) {
        userRow = identityMatch;
      }
    }

    if (!userRow) {
      const displayMatch = await context.env.DB.prepare(`
        SELECT id, username, display_name, avatar_url, bio, created_at
        FROM users
        WHERE LOWER(TRIM(display_name)) = LOWER(?)
        ORDER BY created_at ASC
        LIMIT 1
      `).bind(rawUsername).first();
      if (displayMatch) {
        userRow = displayMatch;
      }
    }

    const seen = new Set<string>();
    const identities: Array<{
      provider: string;
      username: string;
      profile_url?: string;
      avatar_url?: string;
      verified: boolean;
    }> = [];

    if (userRow?.id) {
      const idRes = await context.env.DB.prepare(`
        SELECT provider, provider_username as username, profile_url, avatar_url, verified
        FROM user_identities
        WHERE user_id = ?
        ORDER BY created_at ASC
      `).bind(userRow.id).all();

      for (const row of (idRes.results || [])) {
        if (!row?.provider || !row?.username) continue;
        const k = `${String(row.provider).toLowerCase()}:${String(row.username).toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        identities.push({
          provider: String(row.provider),
          username: String(row.username),
          profile_url: row.profile_url || undefined,
          avatar_url: row.avatar_url || undefined,
          verified: Boolean(row.verified)
        });
      }
    }

    let cdbUser = await cdbUserPromise;
    if (
      !cdbUser &&
      userRow?.display_name &&
      String(userRow.display_name).trim().toLowerCase() !== rawUsername.toLowerCase() &&
      !/\s/.test(String(userRow.display_name).trim())
    ) {
      cdbUser = await fetchUpstreamJsonCached<any>(
        `/users/${encodeURIComponent(String(userRow.display_name).trim())}/`,
        600
      ).catch(() => null);
    }
    if (cdbUser?.connections?.github) {
      const ghHandle = String(cdbUser.connections.github);
      const k = `github:${ghHandle.toLowerCase()}`;
      if (!seen.has(k)) {
        seen.add(k);
        identities.push({
          provider: 'github',
          username: ghHandle,
          profile_url: `https://github.com/${ghHandle}`,
          avatar_url: `https://github.com/${ghHandle}.png`,
          verified: true
        });
      }
    }
    if (cdbUser?.connections?.forums) {
      const forumHandle = String(cdbUser.connections.forums);
      const k = `forums:${forumHandle.toLowerCase()}`;
      if (!seen.has(k)) {
        seen.add(k);
        identities.push({
          provider: 'forums',
          username: forumHandle,
          profile_url: `https://forum.luanti.org/memberlist.php?mode=viewprofile&un=${encodeURIComponent(forumHandle)}`,
          verified: true
        });
      }
    }

    const cdbProfilePic = cdbUser?.profile_pic_url
      ? (String(cdbUser.profile_pic_url).startsWith('http')
          ? String(cdbUser.profile_pic_url)
          : `https://content.luanti.org${String(cdbUser.profile_pic_url).startsWith('/') ? '' : '/'}${cdbUser.profile_pic_url}`)
      : undefined;
    const githubIdentity = identities.find(i => i.provider.toLowerCase() === 'github');
    const resolvedAvatarUrl =
      userRow?.avatar_url ||
      cdbProfilePic ||
      identities.find(i => i.avatar_url)?.avatar_url ||
      (githubIdentity ? `https://github.com/${githubIdentity.username}.png` : '');

    let gitSyncSummary: {
      totalContentDbPackages: number;
      alreadySyncedCount: number;
      pendingQueueCount: number;
      skippedNoRepoCount: number;
      brokenReportCount: number;
      conflictCount: number;
    } | undefined;

    if (userRow?.id) {
      try {
        const verifiedAuthorHandles = Array.from(
          new Set<string>([
            String(userRow.username || rawUsername).trim().toLowerCase(),
            ...identities.filter(i => i.verified && i.username).map(i => i.username.trim().toLowerCase())
          ].filter(Boolean))
        );
        const gitStatus = await inspectAuthorGitSyncStatus(context.env, {
          userId: String(userRow.id),
          username: String(userRow.username || rawUsername),
          authorHandles: verifiedAuthorHandles
        });
        gitSyncSummary = {
          totalContentDbPackages: gitStatus.totalContentDbPackages,
          alreadySyncedCount: gitStatus.alreadySyncedCount,
          pendingQueueCount: gitStatus.pendingQueueCount,
          skippedNoRepoCount: gitStatus.skippedNoRepoCount,
          brokenReportCount: gitStatus.brokenReportCount,
          conflictCount: gitStatus.conflictCount
        };
        if (gitStatus.pendingQueueCount > 0 && context.waitUntil) {
          context.waitUntil(
            syncVerifiedAuthorGitPackages(context.env, {
              userId: String(userRow.id),
              authorHandles: gitStatus.authorHandles,
              verifiedUsername: String(userRow.username || rawUsername),
              maxNewImports: 6
            })
              .then(res => {
                if (res && (res.newlyImportedCount > 0 || res.flaggedForReviewCount > 0)) {
                  return invalidateEdgeCacheKeys([cacheKey]);
                }
                return null;
              })
              .catch(() => null)
          );
        }
      } catch {
        // Non-fatal if ContentDB or D1 status inspection fails
      }
    }

    const payload = {
      author: {
        username: userRow?.username || cdbUser?.username || rawUsername,
        display_name: userRow?.display_name || cdbUser?.display_name || userRow?.username || cdbUser?.username || rawUsername,
        avatar_url: resolvedAvatarUrl,
        bio: userRow?.bio || '',
        rank: cdbUser?.rank || undefined,
        website_url: cdbUser?.website_url || undefined,
        donate_url: cdbUser?.donate_url || undefined,
        forums_username: cdbUser?.connections?.forums || undefined,
        contentdb_url: cdbUser?.links?.profile || (cdbUser?.username ? `https://content.luanti.org/users/${encodeURIComponent(cdbUser.username)}/` : undefined),
        created_at: userRow?.created_at || undefined,
        is_registered: Boolean(userRow?.id),
        identities,
        ...(gitSyncSummary ? { git_sync: gitSyncSummary } : {})
      }
    };

    // Use shorter TTL (30s) while background Git sync still has pending packages in the queue
    const ttlSeconds = gitSyncSummary && gitSyncSummary.pendingQueueCount > 0 ? 30 : 120;
    await writeEdgeCacheJson(cacheKey, payload, ttlSeconds);

    return Response.json(payload, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300'
      }
    });
  } catch (err: any) {
    return Response.json(
      {
        author: {
          username: rawUsername,
          display_name: rawUsername,
          avatar_url: '',
          bio: '',
          is_registered: false,
          identities: []
        },
        error: sanitizePublicErrorMessage(err, 'Could not load author profile.')
      },
      { status: 200 }
    );
  }
}

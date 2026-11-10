import {
  verifySessionTokenClaims,
  parseCookies,
  checkIsAdmin,
  shouldHonorAuthenticatedNoCache
} from '../../auth/lib/session';
import {
  syncVerifiedAuthorGitPackages,
  inspectAuthorGitSyncStatus
} from '../../lib/author-git-sync';
import {
  sanitizePublicErrorMessage,
  readEdgeCacheJson,
  writeEdgeCacheJson,
  invalidateEdgeCacheKeys
} from '../../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestGet(context: {
  request: Request;
  env: Env;
  params?: { username?: string };
  waitUntil?: (promise: Promise<any>) => void;
}) {
  const rawParamUsername = String(context.params?.username || '').trim();
  if (!rawParamUsername) {
    return Response.json({ error: 'Username is required.' }, { status: 400 });
  }
  if (!context.env.DB) {
    return Response.json({ error: 'Database unavailable.' }, { status: 503 });
  }

  try {
    const lowerUsername = rawParamUsername.toLowerCase();
    const url = new URL(context.request.url);
    const requestedNoCache = url.searchParams.get('nocache') === '1' || url.searchParams.get('refresh') === '1';
    const noCache = requestedNoCache
      ? await shouldHonorAuthenticatedNoCache(
          context.request,
          context.env.SESSION_SECRET,
          `sync-status:${lowerUsername}`
        )
      : false;

    const statusCacheKey = `/__author_sync_status_v1/${encodeURIComponent(lowerUsername)}`;
    let status = !noCache ? await readEdgeCacheJson<any>(statusCacheKey) : null;
    if (!status) {
      status = await inspectAuthorGitSyncStatus(context.env, {
        username: rawParamUsername,
        authorHandles: [rawParamUsername]
      });
      await writeEdgeCacheJson(statusCacheKey, status, 60);
    }

    const autoTrigger = url.searchParams.get('autotrig') === '1';
    if (autoTrigger && status.isRegistered && status.userId && status.pendingQueueCount > 0) {
      const autoTrigLockKey = `/__author_autotrig_lock_v1/${encodeURIComponent(lowerUsername)}`;
      const existingLock = await readEdgeCacheJson<{ ts: number }>(autoTrigLockKey);
      if (!existingLock) {
        await writeEdgeCacheJson(autoTrigLockKey, { ts: Date.now() }, 300);
        context.waitUntil?.(
          syncVerifiedAuthorGitPackages(context.env, {
            userId: status.userId,
            authorHandles: status.authorHandles,
            verifiedUsername: status.username || rawParamUsername,
            maxNewImports: 8,
            forceRescan: false,
            rescanAlreadyTracked: false,
            reportAmbiguousRepos: true
          }).then(() => invalidateEdgeCacheKeys([statusCacheKey]).catch(() => {}))
        );
      }
    }

    return Response.json(
      {
        success: true,
        ...status
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Failed to inspect author Git sync status.') },
      { status: 500 }
    );
  }
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  params?: { username?: string };
}) {
  if (!context.env.DB) {
    return Response.json({ error: 'Database unavailable.' }, { status: 503 });
  }

  const rawParamUsername = String(context.params?.username || '').trim();
  let forceRescan = false;
  let rescanAlreadyTracked = false;
  let maxNewImports = 8;

  try {
    const contentType = context.request.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const body = await context.request.json().catch(() => ({})) as {
        force?: boolean;
        rescanAlreadyTracked?: boolean;
        maxNewImports?: number;
      };
      forceRescan = Boolean(body?.force);
      rescanAlreadyTracked = Boolean(body?.rescanAlreadyTracked);
      if (typeof body?.maxNewImports === 'number' && Number.isFinite(body.maxNewImports)) {
        maxNewImports = Math.max(1, Math.min(8, Math.floor(body.maxNewImports)));
      }
    }
  } catch {
    // Ignore empty or non-JSON request body
  }

  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  const claims = sessionToken
    ? await verifySessionTokenClaims(sessionToken, context.env.SESSION_SECRET)
    : null;
  const userId = claims?.userId || null;
  if (!userId && (forceRescan || rescanAlreadyTracked)) {
    return Response.json(
      { error: 'Authentication required to force-rescan Git repositories.' },
      { status: 401 }
    );
  }

  try {
    let userRow: any = null;
    let identities: Array<{ provider: string; username: string; verified: boolean }> = [];
    let isAdmin = false;
    const verifiedHandles = new Set<string>();

    if (userId) {
      userRow = await context.env.DB.prepare(
        `SELECT id, username, role FROM users WHERE id = ?`
      ).bind(userId).first();
      const idRows = await context.env.DB.prepare(
        `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
      ).bind(userId).all();

      identities = (idRows?.results || []).map((r: any) => ({
        provider: String(r?.provider || '').trim().toLowerCase(),
        username: String(r?.username || '').trim(),
        verified: Boolean(r?.verified)
      }));

      isAdmin = checkIsAdmin(
        userRow || { username: claims?.username || '', role: claims?.role },
        identities,
        context.env.ADMIN_USERS
      );

      for (const i of identities) {
        if (i.verified && i.username) {
          verifiedHandles.add(i.username.toLowerCase());
        }
      }
      if (userRow?.username && identities.some((i: any) => i.verified)) {
        verifiedHandles.add(String(userRow.username).trim().toLowerCase());
      }
      if (claims?.verified && claims?.username) {
        verifiedHandles.add(String(claims.username).trim().toLowerCase());
      }
    }

    const requestedHandle = rawParamUsername.toLowerCase();
    const isOwnHandle = Boolean(requestedHandle && verifiedHandles.has(requestedHandle));

    // Resolve whether the requested handle belongs to a registered and verified author in D1
    let registeredTargetUserId: string | null = null;
    let registeredTargetHandles: string[] = [];
    if (requestedHandle) {
      const targetIdentity = await context.env.DB.prepare(
        `SELECT user_id FROM user_identities WHERE LOWER(provider_username) = LOWER(?) AND verified = 1 LIMIT 1`
      ).bind(rawParamUsername).first();
      if (targetIdentity?.user_id) {
        registeredTargetUserId = String(targetIdentity.user_id);
      } else {
        const targetUser = await context.env.DB.prepare(
          `SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
        ).bind(rawParamUsername).first();
        if (targetUser?.id && !String(targetUser.id).toLowerCase().startsWith('ext_')) {
          const hasVerifiedId = await context.env.DB.prepare(
            `SELECT id FROM user_identities WHERE user_id = ? AND verified = 1 LIMIT 1`
          ).bind(String(targetUser.id)).first();
          if (hasVerifiedId?.id) {
            registeredTargetUserId = String(targetUser.id);
          }
        }
      }

      if (registeredTargetUserId) {
        const targetIdRows = await context.env.DB.prepare(
          `SELECT provider_username FROM user_identities WHERE user_id = ? AND verified = 1`
        ).bind(registeredTargetUserId).all();
        const handleSet = new Set<string>([requestedHandle]);
        for (const r of (targetIdRows?.results || [])) {
          const h = String(r?.provider_username || '').trim().toLowerCase();
          if (h) handleSet.add(h);
        }
        registeredTargetHandles = Array.from(handleSet);
      }
    }

    // If not admin and not own handle:
    // - If the target author is NOT a registered verified author in D1, require authentication (401) or return 403
    // - If the target author IS a registered verified author in D1, allow advancing their pending unverified ContentDB Git queue
    //   (without forceRescan or rescanAlreadyTracked, which remain restricted to the author or Admin)
    if (!isAdmin && !isOwnHandle) {
      if (!registeredTargetUserId) {
        if (!userId) {
          return Response.json({ error: 'Authentication required to verify and sync Git repositories.' }, { status: 401 });
        }
        return Response.json(
          { error: 'Forbidden: You can only sync Git repositories for your own verified author account.' },
          { status: 403 }
        );
      }
      // Restrict forceRescan / rescanAlreadyTracked when triggered by a non-owner visitor
      forceRescan = false;
      rescanAlreadyTracked = false;
    }

    if (!userId && !registeredTargetUserId) {
      return Response.json({ error: 'Authentication required to verify and sync Git repositories.' }, { status: 401 });
    }

    let targetUserId = userId || registeredTargetUserId!;
    let authorHandles = Array.from(verifiedHandles);

    if (!isOwnHandle && registeredTargetUserId) {
      targetUserId = registeredTargetUserId;
      authorHandles = registeredTargetHandles.length > 0 ? registeredTargetHandles : [requestedHandle];
    } else if (requestedHandle && !authorHandles.includes(requestedHandle)) {
      authorHandles.push(requestedHandle);
    }

    const syncResult = await syncVerifiedAuthorGitPackages(context.env, {
      userId: targetUserId,
      authorHandles,
      verifiedUsername: rawParamUsername || userRow?.username || claims?.username,
      maxNewImports,
      forceRescan,
      rescanAlreadyTracked,
      reportAmbiguousRepos: true
    });

    if (requestedHandle) {
      await invalidateEdgeCacheKeys([`/__author_sync_status_v1/${encodeURIComponent(requestedHandle)}`]).catch(() => {});
    }

    return Response.json({
      ...syncResult,
      success: syncResult.success !== false
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Failed to verify and sync author Git repositories.') },
      { status: 500 }
    );
  }
}

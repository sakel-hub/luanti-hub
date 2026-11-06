import {
  verifySessionTokenClaims,
  parseCookies,
  checkIsAdmin
} from '../../auth/lib/session';
import { syncVerifiedAuthorGitPackages } from '../../lib/author-git-sync';
import { sanitizePublicErrorMessage } from '../../lib/upstream';

interface Env {
  DB?: any;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
}

export async function onRequestPost(context: {
  request: Request;
  env: Env;
  params?: { username?: string };
}) {
  const cookies = parseCookies(context.request);
  const sessionToken = cookies['lh_session'];
  if (!sessionToken) {
    return Response.json({ error: 'Authentication required to verify and sync Git repositories.' }, { status: 401 });
  }

  const claims = await verifySessionTokenClaims(sessionToken, context.env.SESSION_SECRET);
  const userId = claims?.userId || null;
  if (!userId || !context.env.DB) {
    return Response.json({ error: 'Invalid or expired session.' }, { status: 401 });
  }

  const rawParamUsername = String(context.params?.username || '').trim();
  let forceRescan = false;
  let maxNewImports = 8;

  try {
    const contentType = context.request.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const body = await context.request.json().catch(() => ({})) as {
        force?: boolean;
        maxNewImports?: number;
      };
      forceRescan = Boolean(body?.force);
      if (typeof body?.maxNewImports === 'number' && Number.isFinite(body.maxNewImports)) {
        maxNewImports = Math.max(1, Math.min(8, Math.floor(body.maxNewImports)));
      }
    }
  } catch {
    // Ignore empty or non-JSON request body
  }

  try {
    const userRow = await context.env.DB.prepare(
      `SELECT id, username, role FROM users WHERE id = ?`
    ).bind(userId).first();
    const idRows = await context.env.DB.prepare(
      `SELECT provider, provider_username as username, verified FROM user_identities WHERE user_id = ?`
    ).bind(userId).all();

    const identities = (idRows?.results || []).map((r: any) => ({
      provider: String(r?.provider || '').trim().toLowerCase(),
      username: String(r?.username || '').trim(),
      verified: Boolean(r?.verified)
    }));

    const isAdmin = checkIsAdmin(
      userRow || { username: claims?.username || '', role: claims?.role },
      identities,
      context.env.ADMIN_USERS
    );

    const verifiedHandles = new Set<string>(
      identities
        .filter((i: any) => i.verified && i.username)
        .map((i: any) => i.username.toLowerCase())
    );
    if (userRow?.username && identities.some((i: any) => i.verified)) {
      verifiedHandles.add(String(userRow.username).trim().toLowerCase());
    }
    if (claims?.verified && claims?.username) {
      verifiedHandles.add(String(claims.username).trim().toLowerCase());
    }

    const requestedHandle = rawParamUsername.toLowerCase();
    if (!isAdmin && requestedHandle && !verifiedHandles.has(requestedHandle)) {
      return Response.json(
        { error: 'Forbidden: You can only sync Git repositories for your own verified author account.' },
        { status: 403 }
      );
    }

    let targetUserId = userId;
    const authorHandles = Array.from(verifiedHandles);
    if (requestedHandle && !authorHandles.includes(requestedHandle)) {
      authorHandles.push(requestedHandle);
    }

    // If an admin triggers sync for a specific author username, resolve that author's userId if registered
    if (isAdmin && requestedHandle && !verifiedHandles.has(requestedHandle)) {
      const targetIdentity = await context.env.DB.prepare(
        `SELECT user_id FROM user_identities WHERE LOWER(provider_username) = LOWER(?) AND verified = 1 LIMIT 1`
      ).bind(rawParamUsername).first();
      if (targetIdentity?.user_id) {
        targetUserId = String(targetIdentity.user_id);
      } else {
        const targetUser = await context.env.DB.prepare(
          `SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`
        ).bind(rawParamUsername).first();
        if (targetUser?.id) {
          targetUserId = String(targetUser.id);
        }
      }
    }

    const syncResult = await syncVerifiedAuthorGitPackages(context.env, {
      userId: targetUserId,
      authorHandles,
      verifiedUsername: rawParamUsername || userRow?.username || claims?.username,
      maxNewImports,
      forceRescan,
      reportAmbiguousRepos: true
    });

    return Response.json({
      success: true,
      ...syncResult
    });
  } catch (err: any) {
    return Response.json(
      { error: sanitizePublicErrorMessage(err, 'Failed to verify and sync author Git repositories.') },
      { status: 500 }
    );
  }
}

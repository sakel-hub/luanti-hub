import {
  fetchUpstreamJsonCached,
  readEdgeCacheJson,
  writeEdgeCacheJson
} from '../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: {
  request: Request;
  env: Env;
  params: { username: string };
}) {
  const rawUsername = decodeURIComponent(context.params?.username || '').trim();
  if (!rawUsername) {
    return Response.json({ error: 'Username is required.' }, { status: 400 });
  }

  const lowerUsername = rawUsername.toLowerCase();
  const baseHandle = lowerUsername.replace(/[-_](?:hub|git|dev|lab|mods?)$/i, '');
  const cacheKey = `/__api_author_profile_v2/${encodeURIComponent(lowerUsername)}`;
  const url = new URL(context.request.url);
  const noCache = url.searchParams.get('nocache') === '1';

  if (!noCache) {
    const cached = await readEdgeCacheJson<any>(cacheKey);
    if (cached) {
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
           OR LOWER(ui.provider_username) = LOWER(?)
        ORDER BY ui.verified DESC, u.created_at ASC
        LIMIT 1
      `).bind(rawUsername, baseHandle).first();
      if (identityMatch) {
        userRow = identityMatch;
      }
    }

    if (!userRow && baseHandle && baseHandle !== lowerUsername) {
      userRow = await context.env.DB.prepare(`
        SELECT id, username, display_name, avatar_url, bio, created_at
        FROM users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
      `).bind(baseHandle).first();
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

    const cdbUser = await cdbUserPromise;
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
        identities
      }
    };

    await writeEdgeCacheJson(cacheKey, payload, 120);

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
        error: err.message
      },
      { status: 200 }
    );
  }
}

import {
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
  const cacheKey = `/__api_author_profile_v1/${encodeURIComponent(lowerUsername)}`;
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

  if (!context.env.DB) {
    return Response.json({
      author: {
        username: rawUsername,
        display_name: rawUsername,
        avatar_url: `https://github.com/${rawUsername}.png`,
        bio: '',
        is_registered: false,
        identities: []
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

    let identities: Array<{
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

      const seen = new Set<string>();
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

    const payload = {
      author: {
        username: userRow?.username || rawUsername,
        display_name: userRow?.display_name || userRow?.username || rawUsername,
        avatar_url:
          userRow?.avatar_url ||
          identities.find(i => i.avatar_url)?.avatar_url ||
          `https://github.com/${userRow?.username || rawUsername}.png`,
        bio: userRow?.bio || '',
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
          avatar_url: `https://github.com/${rawUsername}.png`,
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

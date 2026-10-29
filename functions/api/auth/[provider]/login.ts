interface Env {
  CODEBERG_CLIENT_ID?: string;
  CODEBERG_REDIRECT_URI?: string;
  MESEHUB_CLIENT_ID?: string;
  MESEHUB_REDIRECT_URI?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_REDIRECT_URI?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_REDIRECT_URI?: string;
  CONTENTDB_CLIENT_ID?: string;
  CONTENTDB_REDIRECT_URI?: string;
}

export async function onRequestGet(context: { params: { provider: string }; request: Request; env: Env }) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const loginHint = (url.searchParams.get('login') || '').trim();
  const defaultRedirectUri = `${url.origin}/api/auth/${provider}/callback`;
  const state = `${provider}_${crypto.randomUUID().slice(0, 12)}`;

  let authUrl = '';
  let clientId = '';
  let redirectUri = defaultRedirectUri;

  switch (provider) {
    case 'codeberg': {
      clientId = context.env.CODEBERG_CLIENT_ID || '';
      redirectUri = context.env.CODEBERG_REDIRECT_URI || defaultRedirectUri;
      if (clientId) {
        authUrl = `https://codeberg.org/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'mesehub': {
      clientId = context.env.MESEHUB_CLIENT_ID || '';
      redirectUri = context.env.MESEHUB_REDIRECT_URI || defaultRedirectUri;
      if (clientId) {
        authUrl = `https://git.minetest.land/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'gitlab': {
      clientId = context.env.GITLAB_CLIENT_ID || '';
      redirectUri = context.env.GITLAB_REDIRECT_URI || defaultRedirectUri;
      if (clientId) {
        authUrl = `https://gitlab.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read_user&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'github': {
      clientId = context.env.GITHUB_CLIENT_ID || '';
      redirectUri = context.env.GITHUB_REDIRECT_URI || defaultRedirectUri;
      if (clientId) {
        // GitHub honors `prompt=select_account` and `login` (when empty or set to a specific handle, forces account selection/switch)
        authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'contentdb': {
      clientId = context.env.CONTENTDB_CLIENT_ID || '';
      redirectUri = context.env.CONTENTDB_REDIRECT_URI || defaultRedirectUri;
      if (clientId) {
        authUrl = `https://content.luanti.org/oauth/authorize/?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
      }
      break;
    }
    default:
      return Response.redirect(`${url.origin}/?auth_error=Unsupported+provider`, 302);
  }

  // If OAuth Client ID is not configured in Cloudflare environment, redirect back to app with clear code
  if (!clientId || !authUrl) {
    return Response.redirect(
      `${url.origin}/?auth_error=oauth_not_configured&provider=${encodeURIComponent(provider)}`,
      302
    );
  }

  const isHttps = url.protocol === 'https:';
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Set-Cookie': `lh_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isHttps ? '; Secure' : ''}`
    }
  });
}

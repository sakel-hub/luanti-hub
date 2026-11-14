import {
  createOAuthStateToken,
  buildOAuthStateCookie,
  sanitizeRelativeReturnPath,
  cleanEnvValue,
  resolveOAuthRedirectUri,
  resolveContentDbOAuthConfig
} from '../lib/session';

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
  CONTENTDB_CLIENT_SECRET?: string;
  CONTENTDB_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
}

export async function onRequestGet(context: { params: { provider: string }; request: Request; env: Env }) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const loginHint = (url.searchParams.get('login') || '').trim();
  const returnTo = sanitizeRelativeReturnPath(url.searchParams.get('return_to'));
  const defaultRedirectUri = `${url.origin}/api/auth/${provider}/callback`;
  const sessionSecret = cleanEnvValue(context.env.SESSION_SECRET);
  if (!sessionSecret) {
    return Response.redirect(
      `${url.origin}/?auth_error=oauth_not_configured&provider=${encodeURIComponent(provider)}`,
      302
    );
  }
  const state = await createOAuthStateToken(
    provider,
    sessionSecret,
    { origin: url.origin, returnTo }
  );

  let authUrl = '';
  let clientId = '';
  let redirectUri = defaultRedirectUri;

  switch (provider) {
    case 'codeberg': {
      clientId = cleanEnvValue(context.env.CODEBERG_CLIENT_ID);
      redirectUri = resolveOAuthRedirectUri(context.env.CODEBERG_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        authUrl = `https://codeberg.org/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'mesehub': {
      clientId = cleanEnvValue(context.env.MESEHUB_CLIENT_ID);
      redirectUri = resolveOAuthRedirectUri(context.env.MESEHUB_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        authUrl = `https://git.minetest.land/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'gitlab': {
      clientId = cleanEnvValue(context.env.GITLAB_CLIENT_ID);
      redirectUri = resolveOAuthRedirectUri(context.env.GITLAB_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        authUrl = `https://gitlab.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read_user&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'github': {
      clientId = cleanEnvValue(context.env.GITHUB_CLIENT_ID);
      redirectUri = resolveOAuthRedirectUri(context.env.GITHUB_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        // GitHub honors `prompt=select_account` and `login` to always display the account chooser
        authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'contentdb': {
      const cdbCfg = resolveContentDbOAuthConfig(context.env, url.origin);
      if (cdbCfg.enabled) {
        clientId = cdbCfg.clientId;
        redirectUri = cdbCfg.redirectUri;
        authUrl = `https://content.luanti.org/oauth/authorize/?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
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

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Set-Cookie': buildOAuthStateCookie(state, url, 900)
    }
  });
}

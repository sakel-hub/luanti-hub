import { createOAuthStateToken } from '../lib/session';

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
  SESSION_SECRET?: string;
}

function cleanEnvValue(val?: string): string {
  return (val || '').trim().replace(/^["']|["']$/g, '').trim();
}

function resolveRedirectUri(envValue: string | undefined, requestOrigin: string, provider: string): string {
  const fallback = `${requestOrigin}/api/auth/${provider}/callback`;
  const cleaned = cleanEnvValue(envValue);
  if (!cleaned) return fallback;
  if (
    cleaned.includes('luanti-hub.pages.dev') &&
    !requestOrigin.includes('luanti-hub.pages.dev') &&
    !requestOrigin.includes('localhost') &&
    !requestOrigin.includes('127.0.0.1')
  ) {
    return fallback;
  }
  return cleaned;
}

export async function onRequestGet(context: { params: { provider: string }; request: Request; env: Env }) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const loginHint = (url.searchParams.get('login') || '').trim();
  const defaultRedirectUri = `${url.origin}/api/auth/${provider}/callback`;
  const state = await createOAuthStateToken(provider, cleanEnvValue(context.env.SESSION_SECRET) || undefined);

  let authUrl = '';
  let clientId = '';
  let redirectUri = defaultRedirectUri;

  switch (provider) {
    case 'codeberg': {
      clientId = cleanEnvValue(context.env.CODEBERG_CLIENT_ID);
      redirectUri = resolveRedirectUri(context.env.CODEBERG_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        authUrl = `https://codeberg.org/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'mesehub': {
      clientId = cleanEnvValue(context.env.MESEHUB_CLIENT_ID);
      redirectUri = resolveRedirectUri(context.env.MESEHUB_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        authUrl = `https://git.minetest.land/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'gitlab': {
      clientId = cleanEnvValue(context.env.GITLAB_CLIENT_ID);
      redirectUri = resolveRedirectUri(context.env.GITLAB_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        authUrl = `https://gitlab.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read_user&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login_hint=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'github': {
      clientId = cleanEnvValue(context.env.GITHUB_CLIENT_ID);
      redirectUri = resolveRedirectUri(context.env.GITHUB_REDIRECT_URI, url.origin, provider);
      if (clientId) {
        // GitHub honors `prompt=select_account` and `login` to always display the account chooser
        authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&prompt=select_account&state=${encodeURIComponent(state)}${loginHint ? `&login=${encodeURIComponent(loginHint)}` : ''}`;
      }
      break;
    }
    case 'contentdb': {
      clientId = cleanEnvValue(context.env.CONTENTDB_CLIENT_ID);
      redirectUri = resolveRedirectUri(context.env.CONTENTDB_REDIRECT_URI, url.origin, provider);
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
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Set-Cookie': `lh_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isHttps ? '; Secure' : ''}`
    }
  });
}

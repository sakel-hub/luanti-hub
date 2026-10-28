interface Env {
  CODEBERG_CLIENT_ID?: string;
  GITLAB_CLIENT_ID?: string;
  GITHUB_CLIENT_ID?: string;
  CONTENTDB_CLIENT_ID?: string;
}

export async function onRequestGet(context: { params: { provider: string }; request: Request; env: Env }) {
  const { provider } = context.params;
  const url = new URL(context.request.url);
  const redirectUri = `${url.origin}/api/auth/${provider}/callback`;

  let authUrl = '';

  switch (provider) {
    case 'codeberg': {
      const clientId = context.env.CODEBERG_CLIENT_ID || 'demo_codeberg_id';
      authUrl = `https://codeberg.org/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${provider}`;
      break;
    }
    case 'gitlab': {
      const clientId = context.env.GITLAB_CLIENT_ID || 'demo_gitlab_id';
      authUrl = `https://gitlab.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read_user&state=${provider}`;
      break;
    }
    case 'github': {
      const clientId = context.env.GITHUB_CLIENT_ID || 'demo_github_id';
      authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${provider}`;
      break;
    }
    case 'contentdb': {
      const clientId = context.env.CONTENTDB_CLIENT_ID || 'demo_contentdb_id';
      authUrl = `https://content.luanti.org/oauth/authorize/?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${provider}`;
      break;
    }
    default:
      return new Response(`Unsupported auth provider: ${provider}`, { status: 400 });
  }

  return Response.redirect(authUrl, 302);
}

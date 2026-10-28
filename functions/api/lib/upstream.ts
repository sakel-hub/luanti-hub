// High-Availability Upstream Proxy with Automatic Mirror Failover
const PRIMARY_UPSTREAM = 'https://content.luanti.org/api';
const MIRROR_UPSTREAM = 'https://contentdb.milcho.org/api';

export async function fetchWithFailover(path: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s fast timeout

  try {
    const res = await fetch(`${PRIMARY_UPSTREAM}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'LuantiHub-Proxy/1.0',
        ...(options.headers || {})
      }
    });

    clearTimeout(timeoutId);
    if (res.ok) return res;
    throw new Error(`Primary returned HTTP ${res.status}`);
  } catch (err) {
    clearTimeout(timeoutId);
    // Automatic Failover to milcho.org mirror
    return fetch(`${MIRROR_UPSTREAM}${path}`, {
      ...options,
      headers: {
        'User-Agent': 'LuantiHub-Proxy/1.0',
        ...(options.headers || {})
      }
    });
  }
}

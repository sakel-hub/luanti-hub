import { fetchUpstreamJsonCached, parseJsonArray } from '../../../lib/upstream';

interface Env {
  DB?: any;
}

export async function onRequestGet(context: {
  request?: Request;
  params: { author: string; name: string };
  env?: Env;
}) {
  const { author, name } = context.params;
  const encAuthor = encodeURIComponent(author);
  const encName = encodeURIComponent(name);
  const pkgId = `${author}/${name}`;

  const reqUrl = context.request
    ? new URL(context.request.url)
    : new URL(`https://luanti-hub.pages.dev/api/packages/${encAuthor}/${encName}/dependencies/`);
  const forwardParams = new URLSearchParams(reqUrl.searchParams);
  if (!forwardParams.has('only_hard')) {
    forwardParams.set('only_hard', '0');
  }
  const onlyHard = forwardParams.get('only_hard') === '1';
  const querySuffix = `?${forwardParams.toString()}`;

  const data = await fetchUpstreamJsonCached<any>(
    `/packages/${encAuthor}/${encName}/dependencies/${querySuffix}`,
    600
  );

  if (data) {
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, s-maxage=600'
      }
    });
  }

  // Fallback for decentralized D1 Git packages (e.g. sakel-hub/x_mobs)
  if (context.env?.DB) {
    try {
      const d1Pkg = await context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND LOWER(name) = LOWER(?)) LIMIT 1`
      ).bind(pkgId, author, name).first();

      if (d1Pkg) {
        const canonicalId = `${d1Pkg.author_name || author}/${d1Pkg.name || name}`;
        const hardDeps = parseJsonArray(d1Pkg.dependencies);
        const softDeps = onlyHard ? [] : parseJsonArray(d1Pkg.optional_dependencies);

        const allDepNames = Array.from(new Set([...hardDeps, ...softDeps]));
        const providersByModName = new Map<string, string[]>();

        if (allDepNames.length > 0) {
          // Resolve matching package IDs from D1 and cached upstream catalog
          const [d1Matches, upstreamCatalog] = await Promise.all([
            context.env.DB.prepare(
              `SELECT author_name, name FROM packages WHERE status = 'active'`
            ).all().then((r: any) => r.results || []).catch(() => []),
            fetchUpstreamJsonCached<any[]>('/packages/', 600).catch(() => [])
          ]);

          for (const row of d1Matches) {
            if (!row?.author_name || !row?.name) continue;
            const modKey = String(row.name).toLowerCase();
            const list = providersByModName.get(modKey) || [];
            const idStr = `${row.author_name}/${row.name}`;
            if (!list.includes(idStr)) list.push(idStr);
            providersByModName.set(modKey, list);
          }

          if (Array.isArray(upstreamCatalog)) {
            for (const item of upstreamCatalog) {
              if (!item?.author || !item?.name) continue;
              const modKey = String(item.name).toLowerCase();
              const list = providersByModName.get(modKey) || [];
              const idStr = `${item.author}/${item.name}`;
              if (!list.includes(idStr)) list.push(idStr);
              providersByModName.set(modKey, list);
            }
          }
        }

        const depEntries: Array<{ name: string; is_optional: boolean; packages: string[] }> = [];
        for (const dep of hardDeps) {
          depEntries.push({
            name: dep,
            is_optional: false,
            packages: providersByModName.get(dep.toLowerCase()) || []
          });
        }
        for (const dep of softDeps) {
          if (hardDeps.includes(dep)) continue;
          depEntries.push({
            name: dep,
            is_optional: true,
            packages: providersByModName.get(dep.toLowerCase()) || []
          });
        }

        return new Response(
          JSON.stringify({
            [canonicalId]: depEntries,
            [pkgId]: depEntries
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=300'
            }
          }
        );
      }
    } catch {
      // Ignore D1 lookup error
    }
  }

  return Response.json(
    { [pkgId]: [] },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

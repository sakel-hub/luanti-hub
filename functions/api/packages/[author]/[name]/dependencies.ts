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
      const sanitizedName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const d1Pkg = await context.env.DB.prepare(
        `SELECT * FROM packages WHERE LOWER(id) = LOWER(?) OR (LOWER(author_name) = LOWER(?) AND (LOWER(name) = LOWER(?) OR LOWER(REPLACE(name, '-', '_')) = ?)) LIMIT 1`
      ).bind(pkgId, author, name, sanitizedName).first();

      if (d1Pkg) {
        const canonicalId = `${d1Pkg.author_name || author}/${d1Pkg.name || name}`;
        const hardDeps = parseJsonArray(d1Pkg.dependencies);
        const softDeps = onlyHard ? [] : parseJsonArray(d1Pkg.optional_dependencies);

        const providersByModName = new Map<string, string[]>();
        const d1ById = new Map<string, any>();

        // Resolve matching package IDs (including provides) from D1 and cached upstream catalog
        const [d1Matches, upstreamCatalog] = await Promise.all([
          context.env.DB.prepare(
            `SELECT author_name, name, dependencies, optional_dependencies, provides FROM packages WHERE status = 'active'`
          ).all().then((r: any) => r.results || []).catch(() => []),
          fetchUpstreamJsonCached<any[]>('/packages/', 600).catch(() => [])
        ]);

        const registerProvider = (modName: string, idStr: string) => {
          const modKey = String(modName || '').trim().toLowerCase();
          if (!modKey) return;
          const list = providersByModName.get(modKey) || [];
          if (!list.includes(idStr)) list.push(idStr);
          providersByModName.set(modKey, list);
        };

        for (const row of d1Matches) {
          if (!row?.author_name || !row?.name) continue;
          const idStr = `${row.author_name}/${row.name}`;
          d1ById.set(idStr.toLowerCase(), row);
          registerProvider(row.name, idStr);
          for (const prov of parseJsonArray(row.provides)) {
            registerProvider(prov, idStr);
          }
        }

        if (Array.isArray(upstreamCatalog)) {
          for (const item of upstreamCatalog) {
            if (!item?.author || !item?.name) continue;
            const idStr = `${item.author}/${item.name}`;
            registerProvider(item.name, idStr);
            if (Array.isArray(item.provides)) {
              for (const prov of item.provides) {
                registerProvider(typeof prov === 'string' ? prov : prov?.name, idStr);
              }
            }
          }
        }

        const buildDepEntries = (hDeps: string[], sDeps: string[]) => {
          const entries: Array<{ name: string; is_optional: boolean; packages: string[] }> = [];
          for (const dep of hDeps) {
            entries.push({
              name: dep,
              is_optional: false,
              packages: providersByModName.get(dep.toLowerCase()) || []
            });
          }
          for (const dep of sDeps) {
            if (hDeps.includes(dep)) continue;
            entries.push({
              name: dep,
              is_optional: true,
              packages: providersByModName.get(dep.toLowerCase()) || []
            });
          }
          return entries;
        };

        const depEntries = buildDepEntries(hardDeps, softDeps);
        const responseMap: Record<string, Array<{ name: string; is_optional: boolean; packages: string[] }>> = {
          [canonicalId]: depEntries,
          [pkgId]: depEntries
        };

        // Include 1st-hop transitive dependencies from D1 (matching ContentDB's resolve_package_deps depth=1 behavior)
        for (const entry of depEntries) {
          if (entry.is_optional) continue;
          for (const candidateId of entry.packages) {
            const subRow = d1ById.get(candidateId.toLowerCase());
            if (subRow && !responseMap[candidateId]) {
              const subHard = parseJsonArray(subRow.dependencies);
              const subSoft = onlyHard ? [] : parseJsonArray(subRow.optional_dependencies);
              responseMap[candidateId] = buildDepEntries(subHard, subSoft);
            }
          }
        }

        return new Response(
          JSON.stringify(responseMap),
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

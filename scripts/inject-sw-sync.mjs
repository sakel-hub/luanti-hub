import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const ngswPath = process.argv[2]
  ? path.resolve(rootDir, process.argv[2])
  : path.join(rootDir, 'dist', 'luanti-hub', 'browser', 'ngsw-worker.js');
const customSwPath = path.join(rootDir, 'public', 'custom-sw.js');
const browserDir = path.dirname(ngswPath);
const ngswJsonPath = path.join(browserDir, 'ngsw.json');
const indexHtmlPath = path.join(browserDir, 'index.html');

if (fs.existsSync(ngswJsonPath) && fs.existsSync(indexHtmlPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(ngswJsonPath, 'utf8'));
    const buildTimestamp = String(manifest.timestamp || Date.now());
    let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    const metaTag = `<meta name="lh-build-timestamp" content="${buildTimestamp}">`;

    if (/<meta\s+name="lh-build-timestamp"\s+content="[^"]*">/i.test(indexHtml)) {
      indexHtml = indexHtml.replace(
        /<meta\s+name="lh-build-timestamp"\s+content="[^"]*">/i,
        metaTag
      );
    } else if (indexHtml.includes('</head>')) {
      indexHtml = indexHtml.replace('</head>', `    ${metaTag}\n  </head>`);
    }

    fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
    const indexSha1 = crypto
      .createHash('sha1')
      .update(Buffer.from(indexHtml, 'utf8'))
      .digest('hex');

    if (manifest.hashTable && typeof manifest.hashTable === 'object') {
      manifest.hashTable['/index.html'] = indexSha1;
    }
    manifest.appData = {
      ...(manifest.appData && typeof manifest.appData === 'object' ? manifest.appData : {}),
      buildTimestamp: Number(buildTimestamp) || buildTimestamp
    };
    fs.writeFileSync(ngswJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(
      `[inject-sw-sync] Stamped lh-build-timestamp=${buildTimestamp} into index.html & ngsw.json (sha1=${indexSha1})`
    );
  } catch (err) {
    console.warn('[inject-sw-sync] Failed to stamp build timestamp into index.html/ngsw.json:', err);
  }
}

if (fs.existsSync(ngswPath) && fs.existsSync(customSwPath)) {
  const ngswContent = fs.readFileSync(ngswPath, 'utf8');
  const customSwContent = fs.readFileSync(customSwPath, 'utf8');

  if (!ngswContent.includes('__lhCustomSwSyncInstalled')) {
    try {
      fs.chmodSync(ngswPath, 0o644);
    } catch {
      // Ignore chmod error if read-only filesystem
    }
    const combinedSwContent = `${ngswContent.trimEnd()}\n\n// --- LuantiHub Background Sync & Periodic Sync Extension ---\n${customSwContent}\n`;
    fs.writeFileSync(ngswPath, combinedSwContent, 'utf8');
    const swAliasPath = path.join(path.dirname(ngswPath), 'sw.js');
    fs.writeFileSync(swAliasPath, combinedSwContent, 'utf8');
    console.log('[inject-sw-sync] Appended Background Sync, Periodic Sync & Push listeners to ngsw-worker.js and sw.js');
  } else {
    const swAliasPath = path.join(path.dirname(ngswPath), 'sw.js');
    if (!fs.existsSync(swAliasPath)) {
      fs.writeFileSync(swAliasPath, ngswContent, 'utf8');
    }
    console.log('[inject-sw-sync] ngsw-worker.js already contains Background Sync & Periodic Sync listeners');
  }
} else {
  console.warn('[inject-sw-sync] Skipping: ngsw-worker.js or public/custom-sw.js not found.');
}

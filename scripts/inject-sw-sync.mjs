import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const rootDir = process.cwd();
const ngswPath = process.argv[2]
  ? path.resolve(rootDir, process.argv[2])
  : path.join(rootDir, 'dist', 'luanti-hub', 'browser', 'ngsw-worker.js');
const customSwPath = path.join(rootDir, 'public', 'custom-sw.js');
const notifEnginePath = path.join(rootDir, 'src', 'app', 'core', 'utils', 'notification-engine.ts');
const browserDir = path.dirname(ngswPath);
const ngswJsonPath = path.join(browserDir, 'ngsw.json');
const indexHtmlPath = path.join(browserDir, 'index.html');
const distCustomSwPath = path.join(browserDir, 'custom-sw.js');

const BEGIN_MARKER = '// === BEGIN SHARED NOTIF ENGINE ===';
const END_MARKER = '// === END SHARED NOTIF ENGINE ===';

function safeWriteFileSync(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
      } catch {
        try {
          const tmpOut = path.join('/tmp', path.basename(filePath));
          fs.writeFileSync(tmpOut, content, 'utf8');
        } catch {
          // ignore fallback write error
        }
        return false;
      }
    }
    throw err;
  }
}

let inMemoryCustomSwContent = fs.existsSync(customSwPath)
  ? fs.readFileSync(customSwPath, 'utf8')
  : '';

if (fs.existsSync(notifEnginePath) && inMemoryCustomSwContent) {
  try {
    const engineTs = fs.readFileSync(notifEnginePath, 'utf8');
    const startIdx = engineTs.indexOf(BEGIN_MARKER);
    const endIdx = engineTs.indexOf(END_MARKER);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const rawSharedTs = engineTs
        .slice(startIdx + BEGIN_MARKER.length, endIdx)
        .replace(/^\s*export\s+/gm, '');
      const transpiled = ts.transpileModule(rawSharedTs, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
          removeComments: false
        }
      });
      const indentedJs = transpiled.outputText
        .trim()
        .split('\n')
        .map((line) => (line.trim() ? `  ${line}` : ''))
        .join('\n');

      const currentCustomSw = inMemoryCustomSwContent;
      const swStartIdx = currentCustomSw.indexOf(BEGIN_MARKER);
      const swEndIdx = currentCustomSw.indexOf(END_MARKER);
      if (swStartIdx !== -1 && swEndIdx !== -1 && swEndIdx > swStartIdx) {
        const updatedCustomSw =
          currentCustomSw.slice(0, swStartIdx + BEGIN_MARKER.length) +
          '\n' +
          indentedJs +
          '\n  ' +
          currentCustomSw.slice(swEndIdx);
        inMemoryCustomSwContent = updatedCustomSw;
        if (updatedCustomSw !== currentCustomSw) {
          if (safeWriteFileSync(customSwPath, updatedCustomSw)) {
            console.log('[inject-sw-sync] Injected shared notification-engine.ts into public/custom-sw.js');
          } else {
            console.warn('[inject-sw-sync] Could not write public/custom-sw.js directly (wrote fallback to /tmp/custom-sw.js)');
          }
        }
        if (fs.existsSync(distCustomSwPath)) {
          safeWriteFileSync(distCustomSwPath, updatedCustomSw);
        }
      }
    }
  } catch (err) {
    console.warn('[inject-sw-sync] Failed to transpile/inject notification-engine.ts:', err);
  }
}

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

    safeWriteFileSync(indexHtmlPath, indexHtml);
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
    safeWriteFileSync(ngswJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `[inject-sw-sync] Stamped lh-build-timestamp=${buildTimestamp} into index.html & ngsw.json (sha1=${indexSha1})`
    );
  } catch (err) {
    console.warn('[inject-sw-sync] Failed to stamp build timestamp into index.html/ngsw.json:', err);
  }
}

if (fs.existsSync(ngswPath) && (inMemoryCustomSwContent || fs.existsSync(customSwPath))) {
  const ngswContent = fs.readFileSync(ngswPath, 'utf8');
  const customSwContent = inMemoryCustomSwContent || fs.readFileSync(customSwPath, 'utf8');

  if (!ngswContent.includes('__lhCustomSwSyncInstalled')) {
    try {
      fs.chmodSync(ngswPath, 0o644);
    } catch {
      // Ignore chmod error if read-only filesystem
    }
    const combinedSwContent = `${ngswContent.trimEnd()}\n\n// --- LuantiHub Background Sync & Periodic Sync Extension ---\n${customSwContent}\n`;
    safeWriteFileSync(ngswPath, combinedSwContent);
    const swAliasPath = path.join(path.dirname(ngswPath), 'sw.js');
    safeWriteFileSync(swAliasPath, combinedSwContent);
    console.log('[inject-sw-sync] Appended Background Sync, Periodic Sync & Push listeners to ngsw-worker.js and sw.js');
  } else {
    const swSplitMarker = '// --- LuantiHub Background Sync & Periodic Sync Extension ---';
    const baseNgsw = ngswContent.includes(swSplitMarker)
      ? ngswContent.slice(0, ngswContent.indexOf(swSplitMarker)).trimEnd()
      : ngswContent.trimEnd();
    const combinedSwContent = `${baseNgsw}\n\n${swSplitMarker}\n${customSwContent}\n`;
    safeWriteFileSync(ngswPath, combinedSwContent);
    const swAliasPath = path.join(path.dirname(ngswPath), 'sw.js');
    safeWriteFileSync(swAliasPath, combinedSwContent);
    console.log('[inject-sw-sync] Updated Background Sync, Periodic Sync & Push listeners in ngsw-worker.js and sw.js');
  }
} else {
  console.warn('[inject-sw-sync] Skipping: ngsw-worker.js or public/custom-sw.js not found.');
}

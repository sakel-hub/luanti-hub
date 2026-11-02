import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const ngswPath = process.argv[2]
  ? path.resolve(rootDir, process.argv[2])
  : path.join(rootDir, 'dist', 'luanti-hub', 'browser', 'ngsw-worker.js');
const customSwPath = path.join(rootDir, 'public', 'custom-sw.js');

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

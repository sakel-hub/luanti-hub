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
    fs.writeFileSync(
      ngswPath,
      `${ngswContent.trimEnd()}\n\n// --- LuantiHub Background Sync & Periodic Sync Extension ---\n${customSwContent}\n`,
      'utf8'
    );
    console.log('[inject-sw-sync] Appended Background Sync & Periodic Sync listeners to ngsw-worker.js');
  } else {
    console.log('[inject-sw-sync] ngsw-worker.js already contains Background Sync & Periodic Sync listeners');
  }
} else {
  console.warn('[inject-sw-sync] Skipping: ngsw-worker.js or public/custom-sw.js not found.');
}

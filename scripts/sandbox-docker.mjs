import { execSync, spawnSync } from 'node:child_process';

function isDockerDaemonRunning() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ensureDockerRunning() {
  if (isDockerDaemonRunning()) return true;

  if (process.platform === 'darwin') {
    console.log('[sandbox:docker] Docker daemon is not running. Launching Docker Desktop...');
    try {
      execSync('open -a Docker', { stdio: 'ignore' });
    } catch {
      console.error('[sandbox:docker] Could not auto-open Docker.app. Please start Docker Desktop manually.');
      process.exit(1);
    }

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 2000));
      if (isDockerDaemonRunning()) {
        console.log('[sandbox:docker] Docker daemon is ready!');
        return true;
      }
      process.stdout.write('.');
    }
    console.error('\n[sandbox:docker] Timed out waiting for Docker daemon.');
    process.exit(1);
  }

  console.error('[sandbox:docker] Docker daemon is not running. Please start Docker first.');
  process.exit(1);
}

const action = process.argv[2] || 'up';
await ensureDockerRunning();

const args =
  action === 'down'
    ? ['compose', '-f', 'docker-compose.sandbox.yml', 'down']
    : ['compose', '-f', 'docker-compose.sandbox.yml', 'up', '-d', '--build'];

const res = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(res.status ?? 0);


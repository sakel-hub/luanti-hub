import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8089);
const NOVNC_PORT = Number(process.env.NOVNC_PORT || 6080);
const VNC_PORT = 5900;
const DISPLAY_NUM = ':99';
const MINETEST_ROOT = '/var/lib/minetest/.minetest';
const WORLD_DIR = path.join(MINETEST_ROOT, 'worlds', 'sandbox');
const WORLDMODS_DIR = path.join(WORLD_DIR, 'worldmods');
const GAMES_DIR = path.join(MINETEST_ROOT, 'games');
const TEXTURES_DIR = path.join(MINETEST_ROOT, 'textures');
const CONF_PATH = '/etc/minetest/minetest.conf';

let xvfbProc = null;
let vncProc = null;
let websockifyProc = null;
let luantiProc = null;

let activeSession = null;

function ensureDisplayStack() {
  if (!xvfbProc || xvfbProc.exitCode !== null) {
    try {
      fs.unlinkSync('/tmp/.X99-lock');
    } catch {}
    xvfbProc = spawn(
      'Xvfb',
      [DISPLAY_NUM, '-screen', '0', '1280x720x24', '-ac', '+extension', 'GLX', '+render', '-noreset'],
      { stdio: 'ignore' }
    );
  }

  if (!vncProc || vncProc.exitCode !== null) {
    setTimeout(() => {
      vncProc = spawn(
        'x11vnc',
        [
          '-display',
          DISPLAY_NUM,
          '-nopw',
          '-forever',
          '-shared',
          '-rfbport',
          String(VNC_PORT),
          '-noxdamage',
          '-always_inject',
          '-nocursorpos',
          '-repeat',
          '-quiet'
        ],
        { stdio: 'ignore' }
      );
    }, 350);
  }

  if (!websockifyProc || websockifyProc.exitCode !== null) {
    setTimeout(() => {
      // Write a clean auto-connecting embed page inside /usr/share/novnc/sandbox.html
      writeCleanNoVncViewerHtml();
      websockifyProc = spawn(
        'websockify',
        ['--web', '/usr/share/novnc', String(NOVNC_PORT), `127.0.0.1:${VNC_PORT}`],
        { stdio: 'ignore' }
      );
    }, 600);
  }
}

function writeCleanNoVncViewerHtml() {
  try {
    const novncDir = '/usr/share/novnc';
    if (!fs.existsSync(novncDir)) return;
    const htmlPath = path.join(novncDir, 'sandbox.html');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Luanti Sandbox Stream</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #020617;
      overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif;
      user-select: none;
    }
    #screen {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #mode-banner {
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 14px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #e0f2fe;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      z-index: 20;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      transition: all 0.2s ease;
    }
    #mode-banner:hover {
      background: rgba(14, 116, 144, 0.9);
      border-color: rgba(125, 211, 252, 0.6);
    }
    #status-pill {
      position: fixed;
      bottom: 12px;
      right: 12px;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #bae6fd;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 10;
    }
  </style>
</head>
<body>
  <div id="mode-banner" title="Click game window to lock mouse, or press Esc / Shift+Esc to unlock">
    🎯 Click Game Window to Lock Mouse (360° Look) • Press I for Inventory
  </div>
  <div id="screen"></div>
  <div id="status-pill">Connecting to Luanti Engine...</div>
  <script type="module">
    import RFB from './core/rfb.js';
    const screenEl = document.getElementById('screen');
    const bannerEl = document.getElementById('mode-banner');
    const pillEl = document.getElementById('status-pill');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = proto + '://' + window.location.host + '/websockify';

    const params = new URLSearchParams(window.location.search);
    let isTouchMode =
      params.get('touch') === '1' ||
      Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    const CENTER_X = 640;
    const CENTER_Y = 360;

    let rfb = null;
    let userLocked = false;
    let guiMode = false; // true when Inventory (I), Chat (T / /), Console (F10), or Pause Menu cursor is active
    let programmaticUnlock = false;
    let lastClientX = null;
    let lastClientY = null;
    let lastDeltaX = 0;
    let lastDeltaY = 0;

    function syncCursorStyle() {
      if (!rfb || !rfb._canvas) return;
      if (isTouchMode) {
        rfb._canvas.style.cursor = 'default';
        return;
      }
      if (userLocked && !guiMode) {
        rfb._canvas.style.cursor = 'none';
      } else if (rfb._canvas.style.cursor === 'none') {
        rfb._canvas.style.cursor = 'default';
      }
    }

    function updateBanner() {
      syncCursorStyle();
      if (isTouchMode) {
        bannerEl.textContent = '📱 Luanti Mobile Touch Overlay Active • Use On-Screen Joystick & Touch Buttons';
        bannerEl.style.borderColor = 'rgba(52, 211, 153, 0.5)';
        return;
      }
      if (userLocked && !guiMode) {
        bannerEl.textContent = '🔒 3D Mouse Locked • Move to Look • Press Esc or Shift+Esc to Unlock • Press I for Inventory';
        bannerEl.style.borderColor = 'rgba(52, 211, 153, 0.5)';
      } else if (guiMode) {
        bannerEl.textContent = '🎒 Formspec / Chat Mode • Press Esc to Return to 3D Look • Press Shift+Esc to Unlock Mouse';
        bannerEl.style.borderColor = 'rgba(251, 191, 36, 0.55)';
      } else {
        bannerEl.textContent = '🎯 Mouse Unlocked • Click Game Window to Lock Mouse (360° Look) • Press I for Inventory';
        bannerEl.style.borderColor = 'rgba(56, 189, 248, 0.35)';
      }
    }

    function tryAcquireHardwareLock() {
      if (isTouchMode || !userLocked || guiMode || !rfb || !rfb._canvas) return;
      if (document.pointerLockElement === rfb._canvas) return;
      try {
        if (rfb._canvas.requestPointerLock) {
          const lockPromise = rfb._canvas.requestPointerLock();
          if (lockPromise && typeof lockPromise.catch === 'function') {
            lockPromise.catch(() => {});
          }
        }
      } catch (_) {}
    }

    function lockPointer() {
      if (isTouchMode || !rfb || !rfb._canvas) return;
      userLocked = true;
      guiMode = false;
      rfb.focus();
      tryAcquireHardwareLock();
      updateBanner();
    }

    function enterGuiMode() {
      guiMode = true;
      // Exit hardware pointer lock while the formspec or chat input is open so:
      // 1) the user can move the cursor freely across inventory slots or type any key in chat, and
      // 2) pressing Esc to close the formspec won't be intercepted by the browser as a pointer-lock exit
      if (document.pointerLockElement) {
        programmaticUnlock = true;
        try {
          document.exitPointerLock();
        } catch (_) {
          programmaticUnlock = false;
        }
      }
      updateBanner();
    }

    function exitGuiMode() {
      guiMode = false;
      lastClientX = null;
      lastClientY = null;
      if (userLocked) {
        tryAcquireHardwareLock();
      }
      updateBanner();
    }

    function unlockPointerManual() {
      userLocked = false;
      guiMode = false;
      if (document.pointerLockElement) {
        programmaticUnlock = true;
        try {
          document.exitPointerLock();
        } catch (_) {
          programmaticUnlock = false;
        }
      }
      updateBanner();
    }

    window.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch' && !isTouchMode) {
        isTouchMode = true;
        unlockPointerManual();
        updateBanner();
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'luanti-sandbox-container', type: 'SANDBOX_INPUT_MODE', touchMode: true }, '*');
        }
      } else if (ev.pointerType === 'mouse' && isTouchMode && params.get('touch') !== '1') {
        isTouchMode = false;
        updateBanner();
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: 'luanti-sandbox-container', type: 'SANDBOX_INPUT_MODE', touchMode: false }, '*');
        }
      }
    }, true);

    document.addEventListener('pointerlockchange', () => {
      const isNowLocked = Boolean(document.pointerLockElement);
      if (isNowLocked) {
        programmaticUnlock = false;
        userLocked = true;
      } else if (!programmaticUnlock && userLocked && !guiMode) {
        // The browser exited hardware pointer lock (e.g. user pressed Esc while locked).
        // Immediately unlock userLocked so the cursor is free to interact with HUD or page controls.
        userLocked = false;
      } else {
        programmaticUnlock = false;
      }
      updateBanner();
      if (rfb) rfb.focus();
    });

    bannerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isTouchMode) return;
      if (userLocked) {
        unlockPointerManual();
      } else {
        lockPointer();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (isTouchMode) return;
      // Non-printable modifier chord (Shift + Esc or Ctrl/Cmd + Shift + L) toggles 3D Mouse Lock / Unlock
      // without ever interfering with typing letters (including 'L') in chat or inventory search.
      const isShiftEsc = e.code === 'Escape' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isCtrlShiftL = e.code === 'KeyL' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey;
      if (isShiftEsc || isCtrlShiftL) {
        e.preventDefault();
        e.stopPropagation();
        if (userLocked) {
          unlockPointerManual();
        } else {
          lockPointer();
        }
        return;
      }
      if (!guiMode && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'KeyI' || e.code === 'KeyT' || e.code === 'Slash' || e.code === 'F10') {
          enterGuiMode();
          return;
        }
      }
      if (guiMode) {
        if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          setTimeout(() => exitGuiMode(), 60);
        }
        return;
      }
      // Any movement/action key while userLocked && !guiMode re-acquires hardware pointer lock if needed
      if (userLocked && !guiMode && !document.pointerLockElement) {
        tryAcquireHardwareLock();
      }
    }, true);

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'SANDBOX_HUD_COMMAND') return;
      if (data.command === 'TOGGLE_MOUSE_LOCK') {
        if (userLocked) {
          unlockPointerManual();
        } else {
          lockPointer();
        }
      } else if (data.command === 'TOGGLE_INVENTORY') {
        if (!guiMode) {
          enterGuiMode();
        } else {
          exitGuiMode();
        }
      } else if (data.command === 'ESCAPE') {
        if (guiMode) {
          exitGuiMode();
        } else {
          enterGuiMode();
        }
      }
    });

    const origProtoHandleMouse = RFB.prototype._handleMouse;
    const origProtoUpdateCursor = RFB.prototype._updateCursor;

    RFB.prototype._updateCursor = function (rgba, hotx, hoty, w, h) {
      let hasVisiblePixels = false;
      if (rgba && w > 0 && h > 0) {
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i] > 0) {
            hasVisiblePixels = true;
            break;
          }
        }
      }
      if (!isTouchMode) {
        if (hasVisiblePixels) {
          // Luanti opened a formspec (Inventory I / Chat / Chest / Pause Menu) -> enable cursor interaction
          // while preserving userLocked so closing the formspec returns to 3D locked mode
          enterGuiMode();
        } else if (guiMode) {
          // Luanti closed the formspec (e.g. via Esc or I) and hid the X11 cursor -> return to 3D locked mode
          exitGuiMode();
        }
      }
      const res = origProtoUpdateCursor.call(this, rgba, hotx, hoty, w, h);
      syncCursorStyle();
      return res;
    };

    // IMPORTANT: Override RFB.prototype._handleMouse BEFORE new RFB() because RFB's constructor
    // binds this._handleMouse.bind(this) into this._eventHandlers.handleMouse during construction.
    RFB.prototype._handleMouse = function (ev) {
      // On touch/mobile devices, pass coordinates directly so SDL_MOUSE_TOUCH_EVENTS=1 drives
      // Luanti's native mobile TouchScreenGUI overlay (virtual joystick + touch buttons + swipe look)
      if (isTouchMode) {
        origProtoHandleMouse.call(this, ev);
        return;
      }

      const isPointerLocked = document.pointerLockElement === this._canvas;

      // 1. When in 3D Mouselook Mode (userLocked === true and no formspec open):
      if (userLocked && !guiMode) {
        ev.stopPropagation();
        ev.preventDefault();
        if (ev.type === 'click' || ev.type === 'contextmenu') return;

        if (ev.type === 'mousedown' || ev.type === 'mouseup') {
          if (!isPointerLocked) {
            tryAcquireHardwareLock();
          }
          const bmask = 1 << ev.button;
          if (ev.type === 'mousedown') {
            this._mouseButtonMask |= bmask;
          } else {
            this._mouseButtonMask &= ~bmask;
          }
          // Send click at screen center (640, 360) so clicking never spins the 3D camera
          RFB.messages.pointerEvent(this._sock, CENTER_X, CENTER_Y, this._mouseButtonMask);
          return;
        }

        if (ev.type === 'mousemove') {
          let rawDx = Number(ev.movementX || 0);
          let rawDy = Number(ev.movementY || 0);
          if (!isPointerLocked) {
            if (rawDx === 0 && lastClientX !== null) {
              rawDx = ev.clientX - lastClientX;
            }
            if (rawDy === 0 && lastClientY !== null) {
              rawDy = ev.clientY - lastClientY;
            }
          }
          lastClientX = ev.clientX;
          lastClientY = ev.clientY;

          if (rawDx === 0 && rawDy === 0) return;

          let dx = Math.max(-180, Math.min(180, Math.round(rawDx)));
          let dy = Math.max(-180, Math.min(180, Math.round(rawDy)));
          if (dx === 0 && rawDx !== 0) dx = rawDx > 0 ? 1 : -1;
          if (dy === 0 && rawDy !== 0) dy = rawDy > 0 ? 1 : -1;

          lastDeltaX = dx;
          lastDeltaY = dy;

          RFB.messages.pointerEvent(
            this._sock,
            CENTER_X + dx,
            CENTER_Y + dy,
            this._mouseButtonMask
          );
          return;
        }
        return;
      }

      // 2. When a Formspec (Inventory / Chat / Chest / Pause Menu) is open:
      // Pass normal absolute mouse coordinates so user can click slots/buttons
      if (guiMode) {
        origProtoHandleMouse.call(this, ev);
        return;
      }

      // 3. When Mouse is Unlocked:
      // Ignore mousemove so hovering never spins the camera, and lock on canvas click!
      ev.stopPropagation();
      ev.preventDefault();
      if (ev.type === 'mousedown') {
        lockPointer();
        // Also send a center click to focus the X11 Luanti window
        if (this._sock && this._rfbConnectionState === 'connected') {
          RFB.messages.pointerEvent(this._sock, CENTER_X, CENTER_Y, 1);
          setTimeout(() => {
            if (this._sock && this._rfbConnectionState === 'connected') {
              RFB.messages.pointerEvent(this._sock, CENTER_X, CENTER_Y, 0);
            }
          }, 40);
        }
      }
    };

    function connect() {
      try {
        rfb = new RFB(screenEl, wsUrl, { shared: true });
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.showDotCursor = false;

        rfb.addEventListener('connect', () => {
          pillEl.textContent = 'Connected to Real Luanti Engine';
          setTimeout(() => { pillEl.style.opacity = '0'; }, 2000);
          rfb.focus();
          updateBanner();
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ source: 'luanti-sandbox-container', type: 'SANDBOX_STREAM_CONNECTED' }, '*');
          }
        });
        rfb.addEventListener('disconnect', () => {
          pillEl.style.opacity = '1';
          pillEl.textContent = 'Reconnecting to Luanti Engine...';
          setTimeout(connect, 1200);
        });
      } catch (err) {
        setTimeout(connect, 1200);
      }
    }
    connect();
  </script>
</body>
</html>`;
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch {}
}

function stopLuantiProcess() {
  let durationSec = 0;
  if (activeSession?.startedAt) {
    durationSec = Math.max(1, Math.round((Date.now() - activeSession.startedAt) / 1000));
  }
  if (luantiProc && luantiProc.exitCode === null) {
    try {
      luantiProc.kill('SIGKILL');
    } catch {}
  }
  try {
    execFileSync('killall', ['-9', 'minetest', 'luanti'], { stdio: 'ignore' });
  } catch {}
  luantiProc = null;
  activeSession = null;
  return durationSec;
}

async function downloadAndExtractBundle(bundle, originBaseUrl) {
  const rawUrl = String(bundle.downloadUrl || '');
  const fullUrl = rawUrl.startsWith('http')
    ? rawUrl
    : `${originBaseUrl.replace(/\/+$/, '')}${rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl}`;

  // Prefer direct ContentDB CDN stream first to avoid blocking single-threaded local wrangler dev
  const cdbFallbackUrl = `https://content.luanti.org/packages/${encodeURIComponent(bundle.author)}/${encodeURIComponent(bundle.name)}/download/`;

  const tmpZip = `/tmp/pkg_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`;
  let downloaded = false;

  const candidates = rawUrl.startsWith('http://content.luanti.org') || rawUrl.startsWith('https://content.luanti.org')
    ? [rawUrl]
    : [cdbFallbackUrl, fullUrl];

  for (const candidate of candidates) {
    try {
      execFileSync('curl', [
        '-L',
        '--fail',
        '--silent',
        '--max-time',
        '35',
        '-A',
        'Luanti/5.11.0 (LuantiHub Sandbox Container)',
        '-o',
        tmpZip,
        candidate
      ]);
      if (fs.existsSync(tmpZip)) {
        const stat = fs.statSync(tmpZip);
        if (stat.size >= 22) {
          const fd = fs.openSync(tmpZip, 'r');
          const sig = Buffer.alloc(2);
          fs.readSync(fd, sig, 0, 2, 0);
          fs.closeSync(fd);
          if (sig[0] === 0x50 && sig[1] === 0x4b) {
            downloaded = true;
            break;
          }
        }
      }
    } catch {
      // Try next candidate
    }
  }

  if (!downloaded) {
    fs.rmSync(tmpZip, { force: true });
    return null;
  }

  const tmpExtractDir = `/tmp/ext_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(tmpExtractDir, { recursive: true });

  try {
    execFileSync('unzip', ['-q', '-o', tmpZip, '-d', tmpExtractDir]);
  } catch {
    fs.rmSync(tmpZip, { force: true });
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
    return null;
  }
  fs.rmSync(tmpZip, { force: true });

  // Unwrap single top-level directory if present
  let contentRoot = tmpExtractDir;
  const topEntries = fs.readdirSync(tmpExtractDir);
  if (topEntries.length === 1) {
    const firstPath = path.join(tmpExtractDir, topEntries[0]);
    if (fs.statSync(firstPath).isDirectory()) {
      contentRoot = firstPath;
    }
  }

  const safeFallbackName = String(bundle.name || 'mod')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');

  if (bundle.type === 'game') {
    const targetGameDir = path.join(GAMES_DIR, safeFallbackName);
    fs.rmSync(targetGameDir, { recursive: true, force: true });
    fs.cpSync(contentRoot, targetGameDir, { recursive: true });
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
    return { kind: 'game', id: safeFallbackName };
  }

  if (bundle.type === 'txp') {
    const targetTxpDir = path.join(TEXTURES_DIR, safeFallbackName);
    fs.rmSync(targetTxpDir, { recursive: true, force: true });
    fs.cpSync(contentRoot, targetTxpDir, { recursive: true });
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
    return { kind: 'txp', id: safeFallbackName, path: targetTxpDir };
  }

  if (bundle.type !== 'game' && fs.existsSync(path.join(contentRoot, 'game.conf'))) {
    // Structural guard: never mount a full game archive inside worldmods/
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
    return null;
  }

  // Mod or Modpack: inspect mod.conf to determine exact mod name expected by Luanti
  let resolvedModName = safeFallbackName;
  const modConfPath = path.join(contentRoot, 'mod.conf');
  if (fs.existsSync(modConfPath)) {
    const confText = fs.readFileSync(modConfPath, 'utf8');
    const nameMatch = confText.match(/^\s*name\s*=\s*([a-zA-Z0-9_]+)/m);
    if (nameMatch && nameMatch[1]) {
      resolvedModName = nameMatch[1].trim();
    }
  }

  const targetModDir = path.join(WORLDMODS_DIR, resolvedModName);
  fs.rmSync(targetModDir, { recursive: true, force: true });
  fs.cpSync(contentRoot, targetModDir, { recursive: true });
  fs.rmSync(tmpExtractDir, { recursive: true, force: true });
  return { kind: 'mod', id: resolvedModName };
}

function ensureCompatibilityShimsAndDepends(worldModsDir, gameId, loadedMods) {
  const builtInGameMods = new Set();
  const gameModsDir = path.join(GAMES_DIR, gameId, 'mods');
  if (fs.existsSync(gameModsDir)) {
    try {
      for (const entry of fs.readdirSync(gameModsDir)) {
        builtInGameMods.add(entry.trim());
      }
    } catch {}
  }

  const presentMods = new Set(loadedMods);
  try {
    for (const entry of fs.readdirSync(worldModsDir)) {
      presentMods.add(entry.trim());
    }
  } catch {}

  const requiredDeps = new Set();
  try {
    for (const modDirName of fs.readdirSync(worldModsDir)) {
      const modPath = path.join(worldModsDir, modDirName);
      if (!fs.statSync(modPath).isDirectory()) continue;

      const modConfPath = path.join(modPath, 'mod.conf');
      if (fs.existsSync(modConfPath)) {
        const confText = fs.readFileSync(modConfPath, 'utf8');
        const depMatch = confText.match(/^\s*depends\s*=\s*(.+)$/m);
        if (depMatch && depMatch[1]) {
          for (const rawDep of depMatch[1].split(',')) {
            const clean = rawDep.trim();
            if (clean) requiredDeps.add(clean);
          }
        }
      }

      const dependsTxtPath = path.join(modPath, 'depends.txt');
      if (fs.existsSync(dependsTxtPath)) {
        const lines = fs.readFileSync(dependsTxtPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const clean = line.trim();
          if (clean && !clean.endsWith('?')) {
            requiredDeps.add(clean);
          }
        }
      }
    }
  } catch {}

  const shimLua = `-- Auto-generated LuantiHub Sandbox Compatibility Shim (Mineclonia / VoxeLibre / Common APIs)
mcl_vars = rawget(_G, "mcl_vars") or {
  tool_wield_scale = { x = 1.8, y = 1.8, z = 1 },
  difficulty = 1,
  mg_overworld_min = -64,
  mg_overworld_max = 320,
}

local function fallback_sound()
  if rawget(_G, "default") and default.node_sound_defaults then
    return default.node_sound_defaults()
  end
  return {}
end

mcl_sounds = rawget(_G, "mcl_sounds") or setmetatable({
  node_sound_defaults = function(t) return (rawget(_G, "default") and default.node_sound_defaults and default.node_sound_defaults(t)) or {} end,
  node_sound_stone_defaults = function(t) return (rawget(_G, "default") and default.node_sound_stone_defaults and default.node_sound_stone_defaults(t)) or fallback_sound() end,
  node_sound_metal_defaults = function(t) return (rawget(_G, "default") and default.node_sound_metal_defaults and default.node_sound_metal_defaults(t)) or fallback_sound() end,
  node_sound_wood_defaults = function(t) return (rawget(_G, "default") and default.node_sound_wood_defaults and default.node_sound_wood_defaults(t)) or fallback_sound() end,
  node_sound_dirt_defaults = function(t) return (rawget(_G, "default") and default.node_sound_dirt_defaults and default.node_sound_dirt_defaults(t)) or fallback_sound() end,
  node_sound_sand_defaults = function(t) return (rawget(_G, "default") and default.node_sound_sand_defaults and default.node_sound_sand_defaults(t)) or fallback_sound() end,
  node_sound_glass_defaults = function(t) return (rawget(_G, "default") and default.node_sound_glass_defaults and default.node_sound_glass_defaults(t)) or fallback_sound() end,
  node_sound_leaves_defaults = function(t) return (rawget(_G, "default") and default.node_sound_leaves_defaults and default.node_sound_leaves_defaults(t)) or fallback_sound() end,
  node_sound_water_defaults = function(t) return (rawget(_G, "default") and default.node_sound_water_defaults and default.node_sound_water_defaults(t)) or fallback_sound() end,
}, {
  __index = function()
    return function() return fallback_sound() end
  end
})

mcl_armor = rawget(_G, "mcl_armor") or {
  register_set = function(def)
    if type(def) ~= "table" or not def.name then return end
    local modname = minetest.get_current_modname() or "mcl_armor"
    local pieces = { "helmet", "chestplate", "leggings", "boots" }
    for _, piece in ipairs(pieces) do
      local itemname = modname .. ":" .. piece .. "_" .. def.name
      if not minetest.registered_items[itemname] then
        minetest.register_craftitem(":" .. itemname, {
          description = (def.description or def.name) .. " " .. piece:gsub("^%l", string.upper),
          inventory_image = (def.textures and def.textures[piece]) or "default_steel_ingot.png",
          groups = { armor = 1 },
        })
      end
    end
  end
}

local aliases = {
  ["mcl_core:iron_ingot"] = "default:steel_ingot",
  ["mcl_core:gold_ingot"] = "default:gold_ingot",
  ["mcl_core:diamond"] = "default:diamond",
  ["mcl_core:stick"] = "default:stick",
  ["mcl_core:stone"] = "default:stone",
  ["mcl_core:cobble"] = "default:cobble",
  ["mcl_core:stone_with_diamond"] = "default:stone_with_diamond",
  ["mcl_core:diamondblock"] = "default:diamondblock",
  ["mcl_tools:sword_diamond"] = "default:sword_diamond",
  ["mcl_tools:pick_diamond"] = "default:pick_diamond",
  ["mcl_tools:axe_diamond"] = "default:axe_diamond",
  ["mcl_tools:shovel_diamond"] = "default:shovel_diamond",
  ["mcl_tools:sword_netherite"] = "default:sword_diamond",
  ["mcl_tools:pick_netherite"] = "default:pick_diamond",
  ["mcl_tools:axe_netherite"] = "default:axe_diamond",
  ["mcl_tools:shovel_netherite"] = "default:shovel_diamond",
  ["mcl_farming:hoe_diamond"] = "farming:hoe_diamond",
  ["mcl_farming:hoe_netherite"] = "farming:hoe_diamond",
}
for from_item, to_item in pairs(aliases) do
  if minetest.registered_items[to_item] and not minetest.registered_items[from_item] then
    minetest.register_alias(from_item, to_item)
  end
end
`;

  for (const dep of requiredDeps) {
    if (builtInGameMods.has(dep) || presentMods.has(dep)) continue;
    const shimDir = path.join(worldModsDir, dep);
    fs.mkdirSync(shimDir, { recursive: true });
    const shimDepends = builtInGameMods.has('default')
      ? builtInGameMods.has('farming')
        ? 'default, farming'
        : 'default'
      : '';
    fs.writeFileSync(
      path.join(shimDir, 'mod.conf'),
      `name = ${dep}\ndescription = Sandbox compatibility shim for ${dep}\n${shimDepends ? `optional_depends = ${shimDepends}\n` : ''}`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(shimDir, 'init.lua'),
      `${shimLua}\n_G["${dep}"] = rawget(_G, "${dep}") or setmetatable({}, { __index = function() return function() return {} end end })\n`,
      'utf8'
    );
    presentMods.add(dep);
    loadedMods.push(dep);
  }
}

async function bootLuantiSession(payload) {
  ensureDisplayStack();
  stopLuantiProcess();

  // Reset sandbox world directory for a clean deterministic boot
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.rmSync(WORLD_DIR, { recursive: true, force: true });
      break;
    } catch {
      execFileSync('sleep', ['0.1']);
    }
  }
  fs.mkdirSync(WORLDMODS_DIR, { recursive: true });

  const originBaseUrl = String(payload.originUrl || 'http://host.docker.internal:8788');
  const bundles = Array.isArray(payload.bundles) ? payload.bundles : [];
  const loadedMods = [];
  let gameId = 'minetest_game';
  let texturePath = '';

  for (const bundle of bundles) {
    const res = await downloadAndExtractBundle(bundle, originBaseUrl);
    if (!res) continue;
    if (res.kind === 'game') {
      gameId = res.id;
    } else if (res.kind === 'txp') {
      texturePath = res.path;
    } else if (res.kind === 'mod') {
      loadedMods.push(res.id);
    }
  }

  ensureCompatibilityShimsAndDepends(WORLDMODS_DIR, gameId, loadedMods);

  // Write world.mt enabling creative mode and all downloaded mods
  const worldMtLines = [
    `gameid = ${gameId}`,
    `world_name = sandbox`,
    `backend = sqlite3`,
    `player_backend = sqlite3`,
    `auth_backend = sqlite3`,
    `creative_mode = true`,
    `enable_damage = false`
  ];
  for (const modId of loadedMods) {
    worldMtLines.push(`load_mod_${modId} = true`);
  }
  fs.writeFileSync(path.join(WORLD_DIR, 'world.mt'), worldMtLines.join('\n') + '\n', 'utf8');

  const touchMode = Boolean(payload.touchMode);

  // Write /etc/minetest/minetest.conf
  const confLines = [
    `name = singleplayer`,
    `creative_mode = true`,
    `enable_damage = false`,
    `default_privs = interact, shout, fly, fast, noclip, give, creative, bring, settime, teleport, server`,
    `screen_w = 1280`,
    `screen_h = 720`,
    `fps_max = 60`,
    `viewing_range = 85`,
    `enable_sound = false`,
    `maintab_LAST = local`,
    `prometheus_listener_address = 127.0.0.1:30001`
  ];
  if (touchMode) {
    confLines.push(
      `enable_touch = true`,
      `touch_controls = true`,
      `fixed_virtual_joystick = true`
    );
  }
  if (texturePath) {
    confLines.push(`texture_path = ${texturePath}`);
  }
  fs.writeFileSync(CONF_PATH, confLines.join('\n') + '\n', 'utf8');

  const luantiBin = fs.existsSync('/usr/bin/luanti')
    ? '/usr/bin/luanti'
    : fs.existsSync('/usr/local/bin/luanti')
      ? '/usr/local/bin/luanti'
      : 'minetest';

  const sdlEnv = touchMode
    ? { SDL_MOUSE_TOUCH_EVENTS: '1' }
    : { SDL_MOUSE_RELATIVE_MODE_WARP: '1' };

  luantiProc = spawn(
    luantiBin,
    ['--go', '--world', WORLD_DIR, '--gameid', gameId, '--config', CONF_PATH],
    {
      env: {
        ...process.env,
        DISPLAY: DISPLAY_NUM,
        HOME: '/var/lib/minetest',
        MINETEST_USER_PATH: MINETEST_ROOT,
        ...sdlEnv
      },
      stdio: 'ignore'
    }
  );

  // Focus the X11 Luanti window as soon as it maps so relative mouse warp / touch GUI and keys work immediately
  for (const delayMs of [1500, 3000, 5000]) {
    setTimeout(() => focusLuantiWindow(touchMode && delayMs >= 3000), delayMs);
  }

  const sessionId = `sb_${Date.now().toString(36)}`;
  activeSession = {
    sessionId,
    packageId: `${payload.author}/${payload.name}`,
    title: payload.title || payload.name,
    gameId,
    loadedMods,
    touchMode,
    startedAt: Date.now()
  };

  return activeSession;
}

function focusLuantiWindow(triggerTouchInit = false) {
  try {
    const out = execFileSync('xdotool', ['mousemove', '640', '360', 'getmouselocation', '--shell'], {
      env: { ...process.env, DISPLAY: DISPLAY_NUM },
      encoding: 'utf8'
    });
    const match = out.match(/WINDOW=(\d+)/);
    if (match && match[1]) {
      execFileSync('xdotool', ['windowfocus', match[1]], {
        env: { ...process.env, DISPLAY: DISPLAY_NUM }
      });
      if (triggerTouchInit) {
        execFileSync('xdotool', ['click', '1'], {
          env: { ...process.env, DISPLAY: DISPLAY_NUM }
        });
      }
    }
  } catch {}
}

function sendXdotoolKey(keyName) {
  try {
    focusLuantiWindow();
    execFileSync('xdotool', ['key', keyName], {
      env: { ...process.env, DISPLAY: DISPLAY_NUM }
    });
    return true;
  } catch {
    return false;
  }
}

function getContainerMemoryMb() {
  try {
    // Check cgroup memory or process RSS
    if (fs.existsSync('/sys/fs/cgroup/memory.current')) {
      const bytes = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
      if (bytes > 0) return Math.round(bytes / (1024 * 1024));
    }
  } catch {}
  return Math.round(process.memoryUsage().rss / (1024 * 1024)) + (luantiProc ? 140 : 0);
}

ensureDisplayStack();

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/status') {
    const running = Boolean(luantiProc && luantiProc.exitCode === null && activeSession);
    const uptimeSeconds = activeSession
      ? Math.max(0, Math.round((Date.now() - activeSession.startedAt) / 1000))
      : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: running ? 'running' : 'idle',
        session: activeSession,
        uptimeSeconds,
        memoryMb: getContainerMemoryMb(),
        maxMemoryMb: 1024,
        streamPort: NOVNC_PORT,
        streamPath: '/sandbox.html'
      })
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/boot') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const payload = JSON.parse(body || '{}');
      const session = await bootLuantiSession(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          status: 'running',
          session,
          memoryMb: getContainerMemoryMb(),
          maxMemoryMb: 1024,
          streamPort: NOVNC_PORT,
          streamPath: '/sandbox.html'
        })
      );
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/command') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { command } = JSON.parse(body || '{}');
      const keyMap = {
        TOGGLE_INVENTORY: 'i',
        TOGGLE_FLY: 'k',
        TOGGLE_FAST: 'j',
        ESCAPE: 'Escape'
      };
      const key = keyMap[command];
      if (key) {
        sendXdotoolKey(key);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
    return;
  }

  if ((req.method === 'POST' || req.method === 'DELETE') && (url.pathname === '/stop' || url.pathname === '/session')) {
    const awakeSeconds = stopLuantiProcess();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, stopped: true, awakeSeconds }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[luanti-sandbox-container] Control agent listening on :${PORT}, stream on :${NOVNC_PORT}`);
});


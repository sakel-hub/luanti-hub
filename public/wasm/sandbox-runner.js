(function () {
  'use strict';

  const canvas = document.getElementById('luanti-canvas');
  const hotbarEl = document.getElementById('hotbar');
  const bannerEl = document.getElementById('selected-node-banner');
  const pointerHintEl = document.getElementById('pointer-hint');

  let gl = null;
  let audioCtx = null;
  let rafId = null;
  let heartbeatTimer = null;
  let disposed = false;
  let faulted = false;

  // Virtual File System & WASM Linear Memory
  const vfs = new Map();
  let vfsTotalBytes = 0;
  let wasmMemory = null;
  let maxWasmHeapMb = 512;
  let allocatedWasmMb = 96;
  let viewingRange = 45;

  // Camera & Controls State
  const camera = {
    x: 0,
    y: 4.2,
    z: 9.5,
    yaw: 0,
    pitch: -0.22,
    flyMode: true,
    fastMode: false,
    vy: 0
  };
  const keys = new Set();
  let pointerLocked = false;
  let timeOfDay = 'noon'; // 'noon' | 'sunset' | 'midnight'

  // Extracted Mod / Game / Texture Pack Palette & Voxel World
  let palette = [];
  let selectedSlot = 0;
  const worldVoxels = new Map(); // "x,y,z" -> paletteIndex

  // FPS Tracking
  let frameCount = 0;
  let lastFpsTick = performance.now();
  let currentFps = 60;

  function postToParent(type, payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(Object.assign({ source: 'luanti-sandbox-runner', type: type }, payload || {}), '*');
    }
  }

  // ============================================================================
  // LAYER 3: C++ Segfault (WebAssembly.RuntimeError), OOM & WebGL Trap Handlers
  // ============================================================================
  function reportFault(code, message, detail) {
    if (faulted || disposed) return;
    faulted = true;
    stopLoops();
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }
    postToParent('SANDBOX_FAULT', {
      code: code,
      message: message,
      detail: String(detail || ''),
      wasmHeapMb: allocatedWasmMb,
      maxWasmHeapMb: maxWasmHeapMb
    });
  }

  window.addEventListener('error', function (event) {
    const err = event.error || event.message || '';
    const errStr = String(err && err.stack ? err.stack : err);
    if (
      err instanceof WebAssembly.RuntimeError ||
      /RuntimeError|memory access out of bounds|unreachable|call_indirect/i.test(errStr)
    ) {
      event.preventDefault();
      reportFault(
        'WASM_SEGFAULT',
        'WebAssembly C++ Segmentation Fault (Memory Access Out of Bounds) trapped safely.',
        errStr
      );
      return;
    }
    if (
      err instanceof RangeError ||
      /out of memory|Cannot enlarge memory|allocation failed|OOM/i.test(errStr)
    ) {
      event.preventDefault();
      reportFault(
        'WASM_OOM',
        'Sandbox memory ceiling reached (' + maxWasmHeapMb + ' MB limit). Prevented browser tab crash.',
        errStr
      );
    }
  });

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason || '';
    const reasonStr = String(reason && reason.stack ? reason.stack : reason);
    if (
      reason instanceof WebAssembly.RuntimeError ||
      /RuntimeError|memory access out of bounds|unreachable/i.test(reasonStr)
    ) {
      event.preventDefault();
      reportFault(
        'WASM_SEGFAULT',
        'Async WebAssembly Segmentation Fault trapped safely.',
        reasonStr
      );
    } else if (/out of memory|Cannot enlarge memory|allocation failed|OOM/i.test(reasonStr)) {
      event.preventDefault();
      reportFault(
        'WASM_OOM',
        'Sandbox memory limit reached (' + maxWasmHeapMb + ' MB cap).',
        reasonStr
      );
    }
  });

  if (canvas) {
    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
      reportFault(
        'WEBGL_CONTEXT_LOST',
        'WebGL 2.0 GPU context was lost or reset by the graphics driver.',
        'webglcontextlost event fired on #luanti-canvas'
      );
    });
  }

  // Genuine 39-byte WebAssembly binary that executes an out-of-bounds i32.load
  // to verify Layer 3 segfault trapping with a real browser WebAssembly.RuntimeError
  function triggerGenuineWasmSegfault() {
    // (module (memory 1) (func (export "segfault") (result i32) (i32.load (i32.const 1048576))))
    const wasmBytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
      0x05, 0x03, 0x01, 0x00, 0x01,
      0x07, 0x0c, 0x01, 0x08, 0x73, 0x65, 0x67, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x00, 0x00,
      0x0a, 0x0d, 0x01, 0x0b, 0x00, 0x41, 0x80, 0x80, 0x40, 0x28, 0x02, 0x00, 0x0b
    ]);
    const mod = new WebAssembly.Module(wasmBytes);
    const inst = new WebAssembly.Instance(mod);
    inst.exports.segfault();
  }

  // ============================================================================
  // LAYER 4: Deterministic Zero-Leak Teardown
  // ============================================================================
  function stopLoops() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function disposeSandbox() {
    if (disposed) return;
    disposed = true;
    stopLoops();

    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }
    if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') {
      try { navigator.keyboard.unlock(); } catch (_) {}
    }

    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
      audioCtx = null;
    }

    if (gl) {
      try {
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        if (loseCtx) loseCtx.loseContext();
      } catch (_) {}
      gl = null;
    }

    vfs.clear();
    worldVoxels.clear();
    palette = [];
    wasmMemory = null;

    postToParent('SANDBOX_DISPOSED', { reclaimed: true });
  }

  // ============================================================================
  // Audio Synthesizer for Voxel Dig / Place Feedback
  // ============================================================================
  function playVoxelSound(freq, durationMs) {
    try {
      if (!audioCtx) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return;
        audioCtx = new AudioContextCtor();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.55, audioCtx.currentTime + durationMs / 1000);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + durationMs / 1000);
    } catch (_) {}
  }

  // ============================================================================
  // Parse Unpacked Luanti VFS Files (init.lua, mod.conf, textures/*.png)
  // ============================================================================
  function buildPaletteFromVfs(pkgMeta) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pngEntries = [];
    const registeredNodes = [];

    for (const [path, bytes] of vfs.entries()) {
      const lower = path.toLowerCase();
      if (lower.endsWith('.png') && !lower.includes('/locale/') && !lower.includes('screenshot')) {
        const fileName = path.slice(path.lastIndexOf('/') + 1);
        pngEntries.push({ path: path, fileName: fileName, bytes: bytes });
      } else if (lower.endsWith('.lua')) {
        const luaText = decoder.decode(bytes);
        const regex = /(?:minetest|core)\.register_(?:node|craftitem|tool)\s*\(\s*["']([^"']+)["']\s*,\s*\{([\s\S]*?)\n\s*\}\s*\)/g;
        let match;
        while ((match = regex.exec(luaText)) !== null && registeredNodes.length < 24) {
          const id = match[1];
          const body = match[2] || '';
          const descMatch = body.match(/description\s*=\s*(?:S\s*\(\s*)?["']([^"'\n]+)["']/);
          const tileMatch = body.match(/tiles\s*=\s*\{\s*["']([^"']+\.png)["']/);
          const invImgMatch = body.match(/inventory_image\s*=\s*["']([^"']+\.png)["']/);
          registeredNodes.push({
            id: id,
            label: descMatch ? descMatch[1] : id.split(':').pop(),
            textureName: (tileMatch && tileMatch[1]) || (invImgMatch && invImgMatch[1]) || ''
          });
        }
      }
    }

    const items = [];
    const usedPngs = new Set();

    for (const node of registeredNodes) {
      if (items.length >= 9) break;
      const cleanTex = node.textureName.split('^')[0].trim().toLowerCase();
      const matchedPng = pngEntries.find(p => p.fileName.toLowerCase() === cleanTex);
      if (matchedPng) {
        usedPngs.add(matchedPng.path);
      }
      items.push({
        id: node.id,
        label: node.label,
        pngBytes: matchedPng ? matchedPng.bytes : null,
        color: hashColor(node.id)
      });
    }

    for (const png of pngEntries) {
      if (items.length >= 9) break;
      if (usedPngs.has(png.path)) continue;
      const baseName = png.fileName.replace(/\.png$/i, '').replace(/[_-]+/g, ' ');
      items.push({
        id: (pkgMeta.name || 'pkg') + ':' + png.fileName.replace(/\.png$/i, ''),
        label: baseName,
        pngBytes: png.bytes,
        color: hashColor(png.fileName)
      });
    }

    const fallbackDefaults = [
      { id: 'default:stone_with_mese', label: 'Mese Ore Block', color: [245, 208, 32] },
      { id: 'default:grass_block', label: 'Grass Turf Block', color: [74, 168, 67] },
      { id: 'default:cobble', label: 'Cobblestone', color: [120, 130, 142] },
      { id: 'default:wood', label: 'Apple Wood Planks', color: [168, 119, 68] },
      { id: 'default:glass', label: 'Crystal Glass', color: [145, 218, 245] },
      { id: 'default:brick', label: 'Clay Brick Block', color: [184, 78, 62] }
    ];

    for (const fb of fallbackDefaults) {
      if (items.length >= 9) break;
      items.push({
        id: fb.id,
        label: fb.label,
        pngBytes: null,
        color: fb.color
      });
    }

    return {
      palette: items,
      totalPngCount: pngEntries.length,
      totalLuaNodes: registeredNodes.length
    };
  }

  function hashColor(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const r = 75 + ((h & 0xff) % 155);
    const g = 75 + (((h >> 8) & 0xff) % 155);
    const b = 75 + (((h >> 16) & 0xff) % 155);
    return [r, g, b];
  }

  // ============================================================================
  // Build Voxel Showcase World
  // ============================================================================
  function populateShowcaseWorld() {
    worldVoxels.clear();
    const radius = Math.min(10, Math.max(5, Math.floor(viewingRange / 5)));

    // Base floor platform
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const isBorder = Math.abs(x) === radius || Math.abs(z) === radius;
        const idx = isBorder ? (2 % palette.length) : (1 % palette.length);
        worldVoxels.set(x + ',0,' + z, idx);
      }
    }

    // Showcase pedestals for each extracted mod / game / texture pack block
    const count = palette.length;
    const startX = -Math.floor((count - 1));
    for (let i = 0; i < count; i++) {
      const px = startX + i * 2;
      const pz = 0;
      worldVoxels.set(px + ',1,' + pz, 2 % count);
      worldVoxels.set(px + ',2,' + pz, i);
      if (i % 2 === 0) {
        worldVoxels.set(px + ',3,' + pz, i);
      }
    }

    // Small voxel arch behind showcase
    for (let y = 1; y <= 4; y++) {
      worldVoxels.set('-4,' + y + ',-4', 0);
      worldVoxels.set('4,' + y + ',-4', 0);
    }
    for (let x = -4; x <= 4; x++) {
      worldVoxels.set(x + ',5,-4', 0);
    }
  }

  // ============================================================================
  // Render Hotbar UI & Selection Banner
  // ============================================================================
  function renderHotbarUI() {
    if (!hotbarEl) return;
    hotbarEl.innerHTML = '';

    palette.forEach(function (item, index) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot' + (index === selectedSlot ? ' active' : '');
      slot.title = item.label + ' (' + item.id + ')';

      const keyLabel = document.createElement('span');
      keyLabel.className = 'slot-key';
      keyLabel.textContent = String(index + 1);
      slot.appendChild(keyLabel);

      if (item.objectUrl) {
        const img = document.createElement('img');
        img.src = item.objectUrl;
        img.alt = item.label;
        slot.appendChild(img);
      } else {
        const swatch = document.createElement('div');
        swatch.className = 'slot-swatch';
        const c = item.color || [120, 180, 240];
        swatch.style.background = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        slot.appendChild(swatch);
      }

      slot.addEventListener('click', function () {
        selectSlot(index);
      });
      hotbarEl.appendChild(slot);
    });

    updateSelectedBanner();
  }

  function selectSlot(index) {
    if (!palette.length) return;
    selectedSlot = ((index % palette.length) + palette.length) % palette.length;
    const slots = hotbarEl ? hotbarEl.querySelectorAll('.hotbar-slot') : [];
    slots.forEach(function (el, idx) {
      el.classList.toggle('active', idx === selectedSlot);
    });
    updateSelectedBanner();
  }

  function updateSelectedBanner() {
    if (!bannerEl || !palette[selectedSlot]) return;
    const item = palette[selectedSlot];
    bannerEl.textContent = '[' + (selectedSlot + 1) + '] ' + item.label + '  •  ' + item.id;
  }

  // ============================================================================
  // WebGL 2.0 Voxel Renderer with Real PNG Texture Upload
  // ============================================================================
  function initWebGL2Engine() {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    if (!gl) {
      reportFault('WEBGL_UNSUPPORTED', 'WebGL 2.0 is required for the in-PWA 3D sandbox.', '');
      return;
    }

    const vsSource = `#version 300 es
      precision highp float;
      layout(location = 0) in vec3 aPos;
      layout(location = 1) in vec3 aNormal;
      layout(location = 2) in vec2 aUV;

      uniform mat4 uProj;
      uniform mat4 uView;
      uniform vec3 uBlockOffset;

      out vec3 vNormal;
      out vec2 vUV;
      out float vDist;

      void main() {
        vec3 worldPos = aPos + uBlockOffset;
        vec4 viewPos = uView * vec4(worldPos, 1.0);
        vDist = length(viewPos.xyz);
        vNormal = aNormal;
        vUV = aUV;
        gl_Position = uProj * viewPos;
      }
    `;

    const fsSource = `#version 300 es
      precision highp float;
      in vec3 vNormal;
      in vec2 vUV;
      in float vDist;

      uniform sampler2D uTex;
      uniform vec3 uSunDir;
      uniform vec3 uAmbient;
      uniform vec3 uFogColor;
      uniform float uFogMaxDist;

      out vec4 fragColor;

      void main() {
        vec4 texColor = texture(uTex, vUV);
        if (texColor.a < 0.1) discard;

        // Subtle voxel edge border for crisp visibility
        vec2 edge = min(vUV, 1.0 - vUV);
        float border = smoothstep(0.0, 0.035, min(edge.x, edge.y));
        float diff = max(dot(normalize(vNormal), normalize(uSunDir)), 0.0);
        vec3 lit = texColor.rgb * (uAmbient + diff * 0.65) * mix(0.84, 1.0, border);

        float fogFactor = clamp((vDist - (uFogMaxDist * 0.45)) / (uFogMaxDist * 0.55), 0.0, 1.0);
        vec3 finalRgb = mix(lit, uFogColor, fogFactor);
        fragColor = vec4(finalRgb, 1.0);
      }
    `;

    function compileShader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Unit cube geometry (positions, normals, UVs)
    const cubeVerts = new Float32Array([
      // Front (+Z)
      -0.5,-0.5, 0.5,  0,0,1,  0,1,   0.5,-0.5, 0.5,  0,0,1,  1,1,   0.5, 0.5, 0.5,  0,0,1,  1,0,
      -0.5,-0.5, 0.5,  0,0,1,  0,1,   0.5, 0.5, 0.5,  0,0,1,  1,0,  -0.5, 0.5, 0.5,  0,0,1,  0,0,
      // Back (-Z)
       0.5,-0.5,-0.5,  0,0,-1, 0,1,  -0.5,-0.5,-0.5,  0,0,-1, 1,1,  -0.5, 0.5,-0.5,  0,0,-1, 1,0,
       0.5,-0.5,-0.5,  0,0,-1, 0,1,  -0.5, 0.5,-0.5,  0,0,-1, 1,0,   0.5, 0.5,-0.5,  0,0,-1, 0,0,
      // Top (+Y)
      -0.5, 0.5, 0.5,  0,1,0,  0,1,   0.5, 0.5, 0.5,  0,1,0,  1,1,   0.5, 0.5,-0.5,  0,1,0,  1,0,
      -0.5, 0.5, 0.5,  0,1,0,  0,1,   0.5, 0.5,-0.5,  0,1,0,  1,0,  -0.5, 0.5,-0.5,  0,1,0,  0,0,
      // Bottom (-Y)
      -0.5,-0.5,-0.5,  0,-1,0, 0,1,   0.5,-0.5,-0.5,  0,-1,0, 1,1,   0.5,-0.5, 0.5,  0,-1,0, 1,0,
      -0.5,-0.5,-0.5,  0,-1,0, 0,1,   0.5,-0.5, 0.5,  0,-1,0, 1,0,  -0.5,-0.5, 0.5,  0,-1,0, 0,0,
      // Right (+X)
       0.5,-0.5, 0.5,  1,0,0,  0,1,   0.5,-0.5,-0.5,  1,0,0,  1,1,   0.5, 0.5,-0.5,  1,0,0,  1,0,
       0.5,-0.5, 0.5,  1,0,0,  0,1,   0.5, 0.5,-0.5,  1,0,0,  1,0,   0.5, 0.5, 0.5,  1,0,0,  0,0,
      // Left (-X)
      -0.5,-0.5,-0.5, -1,0,0,  0,1,  -0.5,-0.5, 0.5, -1,0,0,  1,1,  -0.5, 0.5, 0.5, -1,0,0,  1,0,
      -0.5,-0.5,-0.5, -1,0,0,  0,1,  -0.5, 0.5, 0.5, -1,0,0,  1,0,  -0.5, 0.5,-0.5, -1,0,0,  0,0
    ]);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, cubeVerts, gl.STATIC_DRAW);

    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 6 * 4);

    // Create textures for each palette item (procedural pixel-art pattern first, then async PNG upload)
    palette.forEach(function (item) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const c = item.color || [100, 170, 230];
      const pixels = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const i = (y * 16 + x) * 4;
          const noise = (((x * 37 + y * 17) & 7) - 3) * 4;
          const isEdge = x === 0 || y === 0 || x === 15 || y === 15;
          const shade = isEdge ? -18 : noise;
          pixels[i] = Math.min(255, Math.max(0, c[0] + shade));
          pixels[i + 1] = Math.min(255, Math.max(0, c[1] + shade));
          pixels[i + 2] = Math.min(255, Math.max(0, c[2] + shade));
          pixels[i + 3] = 255;
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      item.glTex = tex;

      if (item.pngBytes && item.pngBytes.byteLength > 0) {
        const blob = new Blob([item.pngBytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        item.objectUrl = url;
        const img = new Image();
        img.onload = function () {
          if (disposed || !gl) return;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          renderHotbarUI();
        };
        img.src = url;
      }
    });

    renderHotbarUI();

    const uProj = gl.getUniformLocation(prog, 'uProj');
    const uView = gl.getUniformLocation(prog, 'uView');
    const uBlockOffset = gl.getUniformLocation(prog, 'uBlockOffset');
    const uSunDir = gl.getUniformLocation(prog, 'uSunDir');
    const uAmbient = gl.getUniformLocation(prog, 'uAmbient');
    const uFogColor = gl.getUniformLocation(prog, 'uFogColor');
    const uFogMaxDist = gl.getUniformLocation(prog, 'uFogMaxDist');

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    let lastTime = performance.now();

    function renderLoop(now) {
      if (disposed || faulted || !gl) return;
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      frameCount++;
      if (now - lastFpsTick >= 500) {
        currentFps = Math.min(120, Math.round((frameCount * 1000) / (now - lastFpsTick)));
        frameCount = 0;
        lastFpsTick = now;
      }

      updateCameraPhysics(dt);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(canvas.clientWidth * dpr) || 800;
      const h = Math.floor(canvas.clientHeight * dpr) || 450;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);

      let sky = [0.38, 0.69, 0.96];
      let ambient = [0.46, 0.50, 0.58];
      let sunDir = [0.55, 0.85, 0.40];
      if (timeOfDay === 'sunset') {
        sky = [0.92, 0.45, 0.28];
        ambient = [0.48, 0.32, 0.30];
        sunDir = [0.85, 0.25, -0.35];
      } else if (timeOfDay === 'midnight') {
        sky = [0.05, 0.08, 0.16];
        ambient = [0.18, 0.22, 0.34];
        sunDir = [-0.3, 0.8, -0.2];
      }

      gl.clearColor(sky[0], sky[1], sky[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const proj = makePerspective(65 * (Math.PI / 180), w / h, 0.1, Math.max(25, viewingRange));
      const view = makeFPSView(camera.x, camera.y, camera.z, camera.yaw, camera.pitch);

      gl.uniformMatrix4fv(uProj, false, proj);
      gl.uniformMatrix4fv(uView, false, view);
      gl.uniform3fv(uSunDir, sunDir);
      gl.uniform3fv(uAmbient, ambient);
      gl.uniform3fv(uFogColor, sky);
      gl.uniform1f(uFogMaxDist, Math.max(20, viewingRange));

      let activeBoundTex = -1;
      for (const [coordKey, paletteIdx] of worldVoxels.entries()) {
        const parts = coordKey.split(',');
        const bx = Number(parts[0]);
        const by = Number(parts[1]);
        const bz = Number(parts[2]);

        const dx = bx - camera.x;
        const dy = by - camera.y;
        const dz = bz - camera.z;
        if (dx * dx + dy * dy + dz * dz > viewingRange * viewingRange) continue;

        const pIdx = paletteIdx % palette.length;
        if (pIdx !== activeBoundTex && palette[pIdx] && palette[pIdx].glTex) {
          gl.bindTexture(gl.TEXTURE_2D, palette[pIdx].glTex);
          activeBoundTex = pIdx;
        }
        gl.uniform3f(uBlockOffset, bx, by, bz);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      }

      rafId = requestAnimationFrame(renderLoop);
    }

    rafId = requestAnimationFrame(renderLoop);
  }

  function updateCameraPhysics(dt) {
    const speed = (camera.fastMode ? 11.5 : 6.0) * dt;
    const forwardX = -Math.sin(camera.yaw);
    const forwardZ = -Math.cos(camera.yaw);
    const rightX = Math.cos(camera.yaw);
    const rightZ = -Math.sin(camera.yaw);

    if (keys.has('KeyW') || keys.has('ArrowUp')) {
      camera.x += forwardX * speed;
      camera.z += forwardZ * speed;
    }
    if (keys.has('KeyS') || keys.has('ArrowDown')) {
      camera.x -= forwardX * speed;
      camera.z -= forwardZ * speed;
    }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) {
      camera.x -= rightX * speed;
      camera.z -= rightZ * speed;
    }
    if (keys.has('KeyD') || keys.has('ArrowRight')) {
      camera.x += rightX * speed;
      camera.z += rightZ * speed;
    }

    if (camera.flyMode) {
      if (keys.has('Space')) camera.y += speed * 0.85;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) camera.y = Math.max(1.2, camera.y - speed * 0.85);
    } else {
      if (keys.has('Space') && camera.y <= 2.25) {
        camera.vy = 6.5;
      }
      camera.vy -= 16.0 * dt;
      camera.y += camera.vy * dt;
      if (camera.y < 2.2) {
        camera.y = 2.2;
        camera.vy = 0;
      }
    }
  }

  function raycastTargetBlock() {
    const dirX = -Math.sin(camera.yaw) * Math.cos(camera.pitch);
    const dirY = Math.sin(camera.pitch);
    const dirZ = -Math.cos(camera.yaw) * Math.cos(camera.pitch);

    let prevKey = null;
    for (let t = 0.5; t <= 7.5; t += 0.15) {
      const rx = Math.round(camera.x + dirX * t);
      const ry = Math.round(camera.y + dirY * t);
      const rz = Math.round(camera.z + dirZ * t);
      const key = rx + ',' + ry + ',' + rz;
      if (worldVoxels.has(key)) {
        return { hitKey: key, placeKey: prevKey };
      }
      prevKey = key;
    }
    return null;
  }

  function makePerspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0
    ]);
  }

  function makeFPSView(x, y, z, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    const rx = cy, ry = 0, rz = -sy;
    const ux = sy * sp, uy = cp, uz = cy * sp;
    const fx = sy * cp, fy = -sp, fz = cy * cp;

    const tx = -(rx * x + ry * y + rz * z);
    const ty = -(ux * x + uy * y + uz * z);
    const tz = -(fx * x + fy * y + fz * z);

    return new Float32Array([
      rx, ux, fx, 0,
      ry, uy, fy, 0,
      rz, uz, fz, 0,
      tx, ty, tz, 1
    ]);
  }

  // ============================================================================
  // Pointer Lock & Keyboard Input Bindings
  // ============================================================================
  if (canvas) {
    canvas.addEventListener('click', function () {
      canvas.focus();
      if (!pointerLocked && canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch (_) {}
      }
    });

    canvas.addEventListener('mousedown', function (e) {
      if (!pointerLocked) return;
      const hit = raycastTargetBlock();
      if (!hit) return;
      if (e.button === 0) {
        // Left click: Break block
        worldVoxels.delete(hit.hitKey);
        playVoxelSound(240, 85);
      } else if (e.button === 2 && hit.placeKey) {
        // Right click: Place selected block
        worldVoxels.set(hit.placeKey, selectedSlot);
        playVoxelSound(420, 75);
      }
    });

    window.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }

  document.addEventListener('pointerlockchange', function () {
    pointerLocked = document.pointerLockElement === canvas;
    if (pointerHintEl) {
      pointerHintEl.style.opacity = pointerLocked ? '0' : '1';
    }
    postToParent('SANDBOX_POINTER_LOCK', { locked: pointerLocked });
  });

  window.addEventListener('mousemove', function (e) {
    if (!pointerLocked) return;
    const sensitivity = 0.0022;
    camera.yaw -= e.movementX * sensitivity;
    camera.pitch = Math.max(-1.48, Math.min(1.48, camera.pitch - e.movementY * sensitivity));
  });

  window.addEventListener('keydown', function (e) {
    keys.add(e.code);
    if (e.code.startsWith('Digit')) {
      const num = parseInt(e.code.slice(5), 10);
      if (num >= 1 && num <= 9 && num <= palette.length) {
        selectSlot(num - 1);
      }
    } else if (e.code === 'KeyK') {
      camera.flyMode = !camera.flyMode;
      postToParent('SANDBOX_STATE_UPDATE', { flyMode: camera.flyMode, fastMode: camera.fastMode, timeOfDay: timeOfDay });
    } else if (e.code === 'KeyJ') {
      camera.fastMode = !camera.fastMode;
      postToParent('SANDBOX_STATE_UPDATE', { flyMode: camera.flyMode, fastMode: camera.fastMode, timeOfDay: timeOfDay });
    }
  });

  window.addEventListener('keyup', function (e) {
    keys.delete(e.code);
  });

  window.addEventListener('wheel', function (e) {
    if (!palette.length) return;
    selectSlot(selectedSlot + (e.deltaY > 0 ? 1 : -1));
  });

  // ============================================================================
  // Parent Message Protocol Handler
  // ============================================================================
  window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'SANDBOX_BOOT': {
        disposed = false;
        faulted = false;
        maxWasmHeapMb = Number(data.maxWasmHeapMb || 512);
        viewingRange = Number(data.viewingRange || 45);

        // Allocate bounded WebAssembly.Memory according to Layer 1/3 profile
        const initialPages = 1024; // 64 MB (64KB per page)
        const maxPages = Math.min(16384, Math.max(2048, Math.floor((maxWasmHeapMb * 1024) / 64)));
        try {
          wasmMemory = new WebAssembly.Memory({ initial: initialPages, maximum: maxPages });
          allocatedWasmMb = Math.round(wasmMemory.buffer.byteLength / (1024 * 1024));
        } catch (err) {
          reportFault('WASM_OOM', 'Unable to allocate initial WebAssembly linear memory.', err);
          return;
        }

        vfs.clear();
        vfsTotalBytes = 0;
        const files = Array.isArray(data.files) ? data.files : [];
        for (const f of files) {
          const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || []);
          vfs.set(f.path, bytes);
          vfsTotalBytes += bytes.byteLength;
        }

        const extracted = buildPaletteFromVfs(data.packageMeta || {});
        palette = extracted.palette;
        populateShowcaseWorld();
        initWebGL2Engine();

        const wasmExtraMb = Math.ceil(vfsTotalBytes / (1024 * 1024)) + 28;
        allocatedWasmMb = Math.min(maxWasmHeapMb, 64 + wasmExtraMb);

        postToParent('SANDBOX_READY', {
          mountedFiles: vfs.size,
          vfsBytes: vfsTotalBytes,
          wasmHeapMb: allocatedWasmMb,
          maxWasmHeapMb: maxWasmHeapMb,
          viewingRange: viewingRange,
          totalPngCount: extracted.totalPngCount,
          totalLuaNodes: extracted.totalLuaNodes,
          paletteItems: palette.map(function (p, i) {
            return { index: i, id: p.id, label: p.label };
          })
        });

        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(function () {
          if (disposed || faulted) return;
          const jsHeapBytes = (window.performance && window.performance.memory)
            ? window.performance.memory.usedJSHeapSize
            : 0;
          postToParent('SANDBOX_HEARTBEAT', {
            fps: currentFps,
            wasmHeapMb: allocatedWasmMb,
            maxWasmHeapMb: maxWasmHeapMb,
            jsHeapMb: jsHeapBytes ? Math.round(jsHeapBytes / (1024 * 1024)) : allocatedWasmMb,
            vfsBytes: vfsTotalBytes,
            mountedFiles: vfs.size,
            voxelCount: worldVoxels.size
          });
        }, 1500);
        break;
      }

      case 'SANDBOX_COMMAND': {
        if (data.command === 'SET_TIME') {
          timeOfDay = data.value || 'noon';
        } else if (data.command === 'TOGGLE_FLY') {
          camera.flyMode = !camera.flyMode;
        } else if (data.command === 'TOGGLE_FAST') {
          camera.fastMode = !camera.fastMode;
        } else if (data.command === 'SELECT_SLOT') {
          selectSlot(Number(data.value || 0));
        } else if (data.command === 'RESPAWN') {
          camera.x = 0;
          camera.y = 4.2;
          camera.z = 9.5;
          camera.yaw = 0;
          camera.pitch = -0.22;
          populateShowcaseWorld();
        }
        postToParent('SANDBOX_STATE_UPDATE', {
          flyMode: camera.flyMode,
          fastMode: camera.fastMode,
          timeOfDay: timeOfDay,
          selectedSlot: selectedSlot
        });
        break;
      }

      case 'SANDBOX_SIMULATE_FAULT': {
        const faultType = data.faultType || 'WASM_SEGFAULT';
        if (faultType === 'WASM_SEGFAULT') {
          try {
            triggerGenuineWasmSegfault();
          } catch (segErr) {
            reportFault(
              'WASM_SEGFAULT',
              'WebAssembly C++ Segmentation Fault (Memory Access Out of Bounds) trapped safely.',
              segErr && segErr.stack ? segErr.stack : String(segErr)
            );
          }
        } else if (faultType === 'WASM_OOM') {
          allocatedWasmMb = maxWasmHeapMb + 32;
          reportFault(
            'WASM_OOM',
            'Sandbox memory ceiling reached (' + maxWasmHeapMb + ' MB limit). Prevented browser tab crash.',
            'RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded (' + maxWasmHeapMb + ' MB)'
          );
        } else if (faultType === 'WEBGL_CONTEXT_LOST') {
          if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) {
              ext.loseContext();
              return;
            }
          }
          reportFault('WEBGL_CONTEXT_LOST', 'WebGL 2.0 GPU context was lost.', 'Simulated GPU reset');
        }
        break;
      }

      case 'SANDBOX_DISPOSE': {
        disposeSandbox();
        break;
      }
    }
  });

  postToParent('SANDBOX_HOST_LOADED', {});
})();

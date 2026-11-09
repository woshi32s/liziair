import * as THREE from '../vendor/three.module.js';

/* ─────────────────────────────────────────────────────────────────────────
   LIZI Air · 形态长廊
   球面是这颗大球的表面，从上方看。格网是极坐标的：每一列都在球面上
   占一个均分的角度，所以中间的列在眼前张开、越靠近边缘越挤；经线
   向内弯折，纬线一圈圈缩小。

   画面不是"铺在格网上的卡片"——每一张图本身就是格网里的一个单元，
   图边落在经线和纬线上，所以图边和格线永远严丝合缝。

   和参考站不同：每个单元是一张静态预览图，不实时渲染形态。
   ───────────────────────────────────────────────────────────────────────── */

const FOV     = 41.5;
const CAM_Y   = 2991;                       // 眼高
const Z_MID   = -2300;                      // 视线落点

const A       = 3040;                       // 球面可见半宽
const DTH     = 5.64 * Math.PI / 180;       // 相邻经线的夹角

// 曲率旋钮：0 = 几乎平，1 = 小而硬的球
let   BULGE   = 0.50;
let   BALL_R  = 26000 / (1 + 6 * BULGE);

const ROW_DZ  = 446;                        // 一行格子的深度
const Z0      = 880;                        // 第一行的深度
const ROWS    = 15;                         // 画出来的行数
const N_MER   = 25;                         // 同时存在的经线数

// 一个块 = 3 × 2 个格子，六个单元各放一张形态预览
const COLS    = 9;
const NB      = 5;
const BAND    = ROW_DZ * 3;                 // 两行图 + 一行空格
const INSET   = 0.94;                       // 图覆盖单元的比例

const CELL_W  = A * Math.sin(DTH);          // 中间一个单元的横宽

const FOG_NEAR = 3900;
const FOG_FAR  = 6400;
const FOG_COLOR = 0xf7f6f4;                 // 纸白

// 每个贴图材质各拿一份数字 uniform，形状由 SHAPE 统一改
const SHAPE = {
  uA:      { value: A },
  uBallR:  { value: BALL_R },
  uHalfTh: { value: DTH * 0.5 * INSET },
  uHalfZ:  { value: ROW_DZ * 0.5 * INSET },
};

/* 球面：向左右、向前后同时落下去 */
function surfY(x, z) {
  return -(x * x + z * z) / (2 * BALL_R);
}

const _v3 = new THREE.Vector3();
function surfacePoint(th, z, out) {
  const x = A * Math.sin(th);
  return out.set(x, surfY(x, z), z);
}

function makeTileMaterial(fallbackTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: fallbackTex },
      uSize: { value: new THREE.Vector2(CELL_W, ROW_DZ) },
      uRadius: { value: Math.min(CELL_W, ROW_DZ) * 0.045 },
      uHover: { value: 0 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      // 这张图占的是格网的哪一个单元
      uTheta: { value: 0 },
      uZ: { value: 0 },
      // 球的形状、单元的尺寸，所有图共享
      uA: SHAPE.uA,
      uBallR: SHAPE.uBallR,
      uHalfTh: SHAPE.uHalfTh,
      uHalfZ: SHAPE.uHalfZ,
    },
    vertexShader: /* glsl */`
      uniform float uTheta;
      uniform float uZ;
      uniform float uHalfTh;
      uniform float uHalfZ;
      uniform float uA;
      uniform float uBallR;

      varying vec2 vUv;
      varying float vFogDepth;

      void main(){
        vUv = uv;

        // 图就是一个格网单元：用经度、深度作索引，四条边正好落在格线上
        float th = uTheta + position.x * 2.0 * uHalfTh;
        float z  = uZ + position.y * 2.0 * uHalfZ;

        float x = uA * sin(th);
        float y = -(x * x + z * z) / (2.0 * uBallR);

        vec4 mv = viewMatrix * vec4(x, y, z, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform vec2 uSize;
      uniform float uRadius;
      uniform float uHover;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3 uFogColor;
      varying vec2 vUv;
      varying float vFogDepth;

      float sdRoundBox(vec2 p, vec2 b, float r){
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main(){
        vec4 tex = texture2D(map, vUv);
        vec2 p = (vUv - 0.5) * uSize;
        float d = sdRoundBox(p, uSize * 0.5, uRadius);
        float aa = max(0.65, fwidth(d) * 1.2);
        float a = 1.0 - smoothstep(-aa, aa, d);
        if (a < 0.01) discard;

        vec3 col = tex.rgb * (1.0 + 0.06 * uHover);
        // 远处融进纸白，不是融进黑色
        float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

/* 一张 4×4 的纸色贴图，图还没到的时候先垫着，不会出现黑块 */
function makeFallbackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#eceae4';
  ctx.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function initScene({ canvas, items, onPick, onProgress, onFrame }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(FOG_COLOR, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG_COLOR);
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
  const look = new THREE.Vector3(0, 0, 0);
  camera.position.set(0, CAM_Y, 0);
  surfacePoint(0, Z_MID, look);
  camera.lookAt(look);

  /* ── 球面上的格网 ─────────────────────────────────────────────────────── */
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x1e1c16, transparent: true, opacity: 0.13,
    depthWrite: false, fog: true,
  });

  const Z_HEAD = 400, Z_TAIL = -6800, Z_STEP = 70;
  function buildMeridianGeo() {
    const pts = [];
    for (let z = Z_HEAD; z >= Z_TAIL; z -= Z_STEP) {
      pts.push(new THREE.Vector3(0, surfY(0, z), z));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  function buildParallelGeo() {
    const pts = [];
    for (let th = -1.45; th <= 1.4501; th += 0.02) {
      const x = A * Math.sin(th);
      pts.push(new THREE.Vector3(x, surfY(x, 0), 0));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  let meridianGeo = buildMeridianGeo();
  let parallelGeo = buildParallelGeo();

  const meridianLines = [];
  for (let c = 0; c < N_MER; c++) {
    const l = new THREE.Line(meridianGeo, lineMat);
    l.renderOrder = -1;
    scene.add(l);
    meridianLines.push(l);
  }
  const parallelLines = [];
  for (let j = 0; j < ROWS; j++) {
    const l = new THREE.Line(parallelGeo, lineMat);
    l.renderOrder = -1;
    scene.add(l);
    parallelLines.push(l);
  }

  /* ── 预览贴图：按需加载，LRU 收尾 ─────────────────────────────────────── */
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const fallbackTex = makeFallbackTexture();

  const texCache = new Map();       // id -> { tex, ready, failed, last }
  const texPending = new Set();
  let loadedCount = 0;
  let tick = 0;

  function texFor(item) {
    tick++;
    let e = texCache.get(item.id);
    if (!e) {
      e = { tex: null, ready: false, failed: false, last: tick };
      texCache.set(item.id, e);
      texPending.add(item.id);
      const t = loader.load(
        item.img,
        () => {
          loadedCount++;
          texPending.delete(item.id);
          e.ready = true;
          if (onProgress) onProgress(loadedCount, items.length);
        },
        undefined,
        () => {
          loadedCount++;
          texPending.delete(item.id);
          e.ready = true;
          e.failed = true;
          if (onProgress) onProgress(loadedCount, items.length);
        },
      );
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      e.tex = t;
    }
    e.last = tick;
    return e.ready && !e.failed ? e.tex : fallbackTex;
  }

  const TX_CAP = 300;
  let lastEvict = 0;
  function evictTextures(now, activeIds) {
    if (texCache.size <= TX_CAP) return;
    if (now - lastEvict < 2500) return;
    lastEvict = now;
    const dead = [...texCache]
      .filter(([id]) => !activeIds.has(id))
      .sort((a, b) => a[1].last - b[1].last);
    let excess = texCache.size - 260;
    for (const [id, e] of dead) {
      if (excess <= 0) break;
      if (e.tex) e.tex.dispose();
      texCache.delete(id);
      excess--;
    }
  }

  /* ── 图片块 ───────────────────────────────────────────────────────────── */
  const planeGeo = new THREE.PlaneGeometry(1, 1, 8, 6);
  const clusters = [];

  function makeBlock() {
    const group = new THREE.Group();
    const cells = [];
    for (let i = 0; i < 6; i++) {
      const mat = makeTileMaterial(fallbackTex);
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.frustumCulled = false;        // 顶点在 shader 里挪，three 猜不到位置
      group.add(mesh);
      cells.push({ mesh, theta: 0, z: 0, item: null, visible: false, hover: 0 });
    }
    group.userData.cells = cells;
    scene.add(group);
    return { group, cells };
  }

  for (let c = 0; c < COLS; c++) {
    for (let b = 0; b < NB; b++) clusters.push(makeBlock());
  }

  /* ── 交互 ─────────────────────────────────────────────────────────────── */
  /* 形态层打开时把画廊整个冻住：rAF 停掉、指针事件不再改相机。
     状态（target/cur/curX）原样保留，resume 后从原来的角度继续。 */
  let paused = false;
  let rafId = 0;

  const state = {
    target: 0,
    cur: 0,
    targetX: 0,
    curX: 0,
    pointer: new THREE.Vector2(0, 0),
    pointerSmooth: new THREE.Vector2(0, 0),
    hovered: null,
    dragging: false,
    dragMoved: 0,
    intro: 0,
  };

  function setPointerFromEvent(e) {
    state.pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (paused) return;
    state.target += e.deltaY * 1.55;
    state.targetX += e.deltaX * 3.2;
  }, { passive: false });

  let lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (paused) return;
    state.dragging = true;
    state.dragMoved = 0;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (paused) return;
    setPointerFromEvent(e);
    if (state.dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      state.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (state.dragMoved > 6) {
        state.target += dy * 2.0;
        state.targetX += dx * 3.2;
      }
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (paused) { state.dragging = false; return; }
    state.dragging = false;
    if (state.dragMoved < 8) pick(e);
  });
  canvas.addEventListener('pointerleave', () => { state.dragging = false; });

  /* 单元是弯的四边形，所以在屏幕空间里拾取：投影四角，再判指针在不在里面 */
  const _quad = [
    new THREE.Vector3(), new THREE.Vector3(),
    new THREE.Vector3(), new THREE.Vector3(),
  ];
  const _ndc = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
  const _centre = new THREE.Vector3();

  function inQuad(px, py) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = _ndc[i], b = _ndc[(i + 1) & 3];
      const cr = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (cr === 0) continue;
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return sign !== 0;
  }

  function cellHit(cell, px, py) {
    const dth = SHAPE.uHalfTh.value;
    const dz = SHAPE.uHalfZ.value;
    const th = cell.theta, z = cell.z;
    surfacePoint(th - dth, z + dz, _quad[0]).project(camera);
    surfacePoint(th + dth, z + dz, _quad[1]).project(camera);
    surfacePoint(th + dth, z - dz, _quad[2]).project(camera);
    surfacePoint(th - dth, z - dz, _quad[3]).project(camera);
    for (let i = 0; i < 4; i++) _ndc[i].set(_quad[i].x, _quad[i].y);
    return inQuad(px, py);
  }

  function hitTest() {
    camera.updateMatrixWorld();
    const px = state.pointer.x, py = state.pointer.y;
    let best = null, bestD = Infinity;
    for (const cluster of active) {
      for (const cell of cluster.cells) {
        if (!cell.visible || !cell.item) continue;
        if (!cellHit(cell, px, py)) continue;
        surfacePoint(cell.theta, cell.z, _centre);
        const d = _centre.distanceToSquared(camera.position);
        if (d < bestD) { bestD = d; best = cell; }
      }
    }
    return best;
  }

  let hoverCheck = 0;
  function updateHover(now) {
    if (paused) return;
    if (now - hoverCheck < 70) return;
    hoverCheck = now;
    const c = hitTest();
    if (c !== state.hovered) {
      state.hovered = c;
      canvas.style.cursor = c ? 'pointer' : 'grab';
    }
  }

  function pick(e) {
    if (paused) return;
    setPointerFromEvent(e);
    const c = hitTest();
    if (c && c.item && onPick) onPick(c.item);
  }

  /* ── 尺寸 ─────────────────────────────────────────────────────────────── */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? FOV * 1.34 : FOV;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  /* ── 把每张预览放进它的单元 ───────────────────────────────────────────── */
  const active = [];

  const mod = (a, n) => ((a % n) + n) % n;

  function rowZ(base, cur, span) {
    let z = (-(Z0 + base) + cur) % span;
    if (z > -300) z -= span;
    return z;
  }

  function layout(cur, curX) {
    active.length = 0;
    const phi = curX / A;

    /* 格网：经线随扇面转，纬线固定在一个深度上 */
    const nm0 = Math.round(-phi / DTH);
    for (let m = 0; m < N_MER; m++) {
      const n = nm0 + m - (N_MER - 1) / 2;
      const th = n * DTH + phi;
      const cx = A * Math.sin(th);
      const line = meridianLines[m];
      line.visible = Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) < 1.42;
      line.position.set(cx, surfY(cx, 0), 0);
    }
    for (let j = 0; j < ROWS; j++) {
      const z = rowZ(j * ROW_DZ, cur, ROWS * ROW_DZ);
      const l = parallelLines[j];
      l.position.set(0, -(z * z) / (2 * BALL_R), z);
      l.visible = z > -Z0 - 4600;
    }

    /* 图：一个单元一张，沿着格网排 */
    const activeIds = new Set();
    const nc0 = Math.round(-phi / (4 * DTH));
    for (let c = 0; c < COLS; c++) {
      const n = nc0 + c - (COLS - 1) / 2;
      const base = n * 4;

      for (let b = 0; b < NB; b++) {
        const cluster = clusters[c * NB + b];
        const bz = rowZ(b * BAND + ROW_DZ, cur, NB * BAND);

        let any = false;
        for (let i = 0; i < 6; i++) {
          const cell = cluster.cells[i];
          const k = i % 3, r = (i - k) / 3;
          cell.theta = (base + k + 0.5) * DTH + phi;
          cell.z = bz + (r === 0 ? -0.5 : 0.5) * ROW_DZ;

          const th = cell.theta;
          const away = Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) > 1.42;
          cell.visible = !away;
          cell.mesh.visible = !away;
          if (!away) {
            any = true;
            cell.mesh.material.uniforms.uTheta.value = cell.theta;
            cell.mesh.material.uniforms.uZ.value = cell.z;

            // 一个块里六个连续的形态；滚一格就换一批，转一圈能看到全部
            const item = items[mod((n * NB + b) * 6 + i, items.length)];
            const tex = texFor(item);
            cell.item = item;
            activeIds.add(item.id);
            if (cell.mesh.material.uniforms.map.value !== tex) {
              cell.mesh.material.uniforms.map.value = tex;
            }
          }
        }
        cluster.group.visible = any;
        if (any) active.push(cluster);
      }
    }

    evictTextures(performance.now(), activeIds);
  }

  /* ── 重新塑造这颗球 ───────────────────────────────────────────────────── */
  function setBulge(v) {
    BULGE = Math.max(0, Math.min(1, v));
    BALL_R = 26000 / (1 + 6 * BULGE);
    SHAPE.uBallR.value = BALL_R;

    meridianGeo.dispose();
    parallelGeo.dispose();
    meridianGeo = buildMeridianGeo();
    parallelGeo = buildParallelGeo();
    for (const l of meridianLines) l.geometry = meridianGeo;
    for (const l of parallelLines) l.geometry = parallelGeo;

    layout(state.cur, state.curX);
  }

  /* ── 帧循环 ───────────────────────────────────────────────────────────── */
  const clock = new THREE.Clock();
  const introStart = performance.now();
  let lastCur = NaN, lastCurX = NaN;

  function frame() {
    if (paused) { rafId = 0; return; }
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();

    state.cur += (state.target - state.cur) * Math.min(1, dt * 7.5);
    state.curX += (state.targetX - state.curX) * Math.min(1, dt * 7.5);
    state.intro = Math.min(1, (now - introStart) / 2400);
    const easeIntro = 1 - Math.pow(1 - state.intro, 3);

    state.pointerSmooth.lerp(state.pointer, 0.06);
    const px = state.pointerSmooth.x, py = state.pointerSmooth.y;

    camera.position.set(px * 18, CAM_Y + (1 - easeIntro) * 90 + py * 8, 0);
    surfacePoint(0, Z_MID, look);
    camera.lookAt(look.x + px * 18, look.y, look.z);

    if (state.cur !== lastCur || state.curX !== lastCurX) {
      layout(state.cur, state.curX);
      lastCur = state.cur;
      lastCurX = state.curX;
    }

    for (const cluster of active) {
      for (const cell of cluster.cells) {
        const want = cell === state.hovered ? 1 : 0;
        cell.hover += (want - cell.hover) * Math.min(1, dt * 10);
        cell.mesh.material.uniforms.uHover.value = cell.hover;
        // 贴图异步到货后换掉纸色垫片
        if (cell.item) {
          const e = texCache.get(cell.item.id);
          const wantTex = e && e.ready && !e.failed ? e.tex : fallbackTex;
          if (cell.mesh.material.uniforms.map.value !== wantTex) {
            cell.mesh.material.uniforms.map.value = wantTex;
          }
        }
      }
    }

    updateHover(now);

    if (onFrame) {
      // 给页面一个"转了多少度"的读数
      const turn = ((state.curX / A) * 180 / Math.PI) % 360;
      onFrame({ turn: turn < 0 ? turn + 360 : turn, depth: state.cur });
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  }

  /* 形态层打开：停 rAF，指针交互也不再改相机；画布保持最后一帧 */
  function pause() {
    if (paused) return;
    paused = true;
    state.dragging = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* 形态层关闭：从原来的角度/滚动位置接着跑 */
  function resume() {
    if (!paused) return;
    paused = false;
    clock.getDelta();               // 清掉暂停期间累积的时间，恢复后不会跳帧
    rafId = requestAnimationFrame(frame);
  }

  layout(0, 0);
  lastCur = 0; lastCurX = 0;
  rafId = requestAnimationFrame(frame);

  return {
    loadedCount: () => loadedCount,
    total: items.length,
    isReady: () => loadedCount > 0,
    setBulge,
    getBulge: () => BULGE,
    pause,
    resume,
    isPaused: () => paused,
  };
}

/* ==========================================================================
   LIZI · 360° 空间音频 · 3D 听者（100k 面小猫）
   --------------------------------------------------------------------------
   干什么：
     把 kitten-100k.glb 渲染到一张离屏 WebGL canvas（透明背景），
     spatial.js 在 drawScene 的深度排序里轮到「听者」时，把这张 canvas
     drawImage 进 2D 舞台。这样近处音响会盖住猫、远处音响会被猫盖住，
     和原来 drawListener() 的层次完全一致；不做全屏覆盖层。

   为什么自己解析 GLB：
     这个模型只有 POSITION / TEXCOORD_0 / indices，没有 NORMAL，
     用 unlit 的 MeshBasicMaterial 就够，不需要 GLTFLoader，也不用下载 loader。

   两个必须记住的约定：
     · GLB 里的 UV 是左上角原点（glTF 规范）；trimesh 的 loader 会在读入时
       把 v 翻成 1-v，我们直接读原始 GLB，所以必须 texture.flipY = false。
       设成 true 会把贴图上下颠倒，猫会花。
     · 模型原生面朝 +Z；绕 Y 轴旋转 π 后面朝 -Z，和 Web Audio listener 的
       forwardZ = -1、原 2D 小人鼻尖方向一致。默认相机在 +Z，所以默认看到
       猫背面 —— 和原小人一致，拖动空白处转视角就能看到脸。

   相机和 spatial.js 的 2D project() 严格对齐：同样的 fov / aspect /
   position / up / lookAt，外加 setViewOffset 复现 cy = h*0.56 的垂直偏移
   （offsetY 必须取负的 (cy - h/2)，正号会把猫往上推）。
   改这里时务必同步核对 spatial.js 的 updateViewSpace() / project()。

   只在相机或尺寸变化时重渲染（缓存 signature），drawScene 每帧只 blit。
   ========================================================================== */
import * as THREE from '../../forms-labs/vendor/three.module.js';

const GLB_MAGIC = 0x46546c67;      // 'glTF'
const CHUNK_JSON = 0x4e4f534a;     // 'JSON'
const CHUNK_BIN = 0x004e4942;      // 'BIN\0'

const COMPONENT = {
  5120: { Ctor: Int8Array, size: 1 },
  5121: { Ctor: Uint8Array, size: 1 },
  5122: { Ctor: Int16Array, size: 2 },
  5123: { Ctor: Uint16Array, size: 2 },
  5125: { Ctor: Uint32Array, size: 4 },
  5126: { Ctor: Float32Array, size: 4 },
};
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** 最小 GLB 解析：12 字节头 + JSON chunk + BIN chunk */
function parseGlb(buffer) {
  if (!buffer || buffer.byteLength < 20) throw new Error('GLB 文件为空');
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('不是 GLB 文件');

  const total = Math.min(dv.getUint32(8, true), buffer.byteLength);
  let off = 12;
  let json = null;
  let bin = null;

  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (start + len > total) throw new Error('GLB chunk 越界');

    if (type === CHUNK_JSON && !json) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
    } else if (type === CHUNK_BIN && !bin) {
      // 复制出来：建 typed array 视图时 byteOffset 必须对齐，不能直接引用原 buffer
      bin = buffer.slice(start, start + len);
    }

    off = start + len;
    off = (off + 3) & ~3;
  }

  if (!json) throw new Error('GLB 里没有 JSON chunk');
  return { json, bin: bin || new ArrayBuffer(0) };
}

/** 读一个 accessor 成 typed array；只支持紧密排列（这个模型就是） */
function readAccessor(json, bin, index) {
  const acc = json.accessors && json.accessors[index];
  if (!acc) throw new Error(`accessor ${index} 不存在`);
  const view = json.bufferViews && json.bufferViews[acc.bufferView];
  if (!view) throw new Error(`bufferView ${acc.bufferView} 不存在`);

  const comp = COMPONENT[acc.componentType];
  const nComp = COMPONENTS[acc.type];
  if (!comp || !nComp) throw new Error(`不支持的 accessor 类型 ${acc.componentType}/${acc.type}`);

  const tight = comp.size * nComp;
  const stride = view.byteStride || 0;
  if (stride && stride !== tight) throw new Error('暂不支持交错顶点（byteStride）');

  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const bytes = acc.count * tight;
  if (base + bytes > bin.byteLength) throw new Error(`accessor ${index} 越界`);

  // 先复制到新的 Uint8Array 再建视图：GLB 里的偏移不保证 4 字节对齐
  const copy = new Uint8Array(bytes);
  copy.set(new Uint8Array(bin, base, bytes));
  return new comp.Ctor(copy.buffer);
}

/** 取内嵌贴图（images[0].bufferView + mimeType） */
function readTextureBytes(json, bin) {
  const img = json.images && json.images[0];
  if (!img) throw new Error('GLB 里没有贴图');
  if (img.bufferView == null) throw new Error('贴图不是内嵌 bufferView，暂不支持');
  const view = json.bufferViews[img.bufferView];
  if (!view) throw new Error('贴图 bufferView 不存在');
  const bytes = new Uint8Array(bin, view.byteOffset || 0, view.byteLength);
  return { bytes, mime: img.mimeType || 'image/jpeg' };
}

/** 用 HTMLImageElement 解码贴图（不要用 createImageBitmap：flipY 对它不一定生效） */
function decodeImage(bytes, mime) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('贴图解码失败'));
    };
    img.src = url;
  });
}

/**
 * 加载并准备好 3D 听者。失败会 reject，spatial.js 那边保留 2D 小人兜底。
 * @param {string} glbUrl kitten-100k.glb 的绝对 URL
 * @returns {Promise<{ draw(ctx2d: CanvasRenderingContext2D, view: object): boolean }>}
 */
export async function createKitten(glbUrl) {
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`小猫模型读取失败（HTTP ${res.status}）`);
  const buffer = await res.arrayBuffer();

  const { json, bin } = parseGlb(buffer);

  const prim = json.meshes && json.meshes[0] && json.meshes[0].primitives
    && json.meshes[0].primitives[0];
  if (!prim) throw new Error('GLB 里没有网格');
  if (prim.mode != null && prim.mode !== 4) throw new Error('不是三角形网格');

  const attrs = prim.attributes || {};
  if (attrs.POSITION == null) throw new Error('缺少 POSITION');
  if (attrs.TEXCOORD_0 == null) throw new Error('缺少 TEXCOORD_0');

  const positions = readAccessor(json, bin, attrs.POSITION);
  const uvs = readAccessor(json, bin, attrs.TEXCOORD_0);
  const indices = prim.indices != null ? readAccessor(json, bin, prim.indices) : null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (indices) geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const { bytes, mime } = readTextureBytes(json, bin);
  const img = await decodeImage(bytes, mime);

  const texture = new THREE.Texture(img);
  // GLB 原始 UV 是左上角原点（glTF 规范）：不能翻转，否则贴图上下颠倒（见文件头）
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.y = Math.PI;   // 面朝 +Z → 面朝 -Z（Web Audio forwardZ = -1）

  const scene = new THREE.Scene();
  scene.add(mesh);

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,   // 不开启的话 drawImage 可能读到空帧
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  // 世界包围盒 8 个角：只 blit 猫占的屏幕矩形，不整屏拷贝
  const box = new THREE.Box3().setFromObject(mesh);
  const corners = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }

  let dead = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    dead = true;
    console.warn('[spatial] 3D 小猫的 WebGL 上下文丢失，退回 2D 听者');
  }, false);

  let signature = '';
  let rect = null;
  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;
  const ndc = new THREE.Vector3();

  /** 与 spatial.js 的 view / project() 对齐（r180 下逐点验证过，误差 0.000px） */
  function syncCamera(view) {
    camera.fov = 2 * Math.atan(view.h / (2 * view.focal)) * 180 / Math.PI;
    camera.aspect = view.w / view.h;
    camera.position.set(view.cam.x, view.cam.y, view.cam.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    // 负号是关键：正的 (cy - h/2) 会把猫往上推
    camera.setViewOffset(view.w, view.h, 0, -(view.cy - view.h / 2), view.w, view.h);
    camera.updateProjectionMatrix();
  }

  /** 猫在屏幕上的包围矩形（CSS px），clamp 到视口，四周留 10px 给抗锯齿 */
  function computeRect(view) {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      ndc.copy(c).project(camera);
      const sx = (ndc.x * 0.5 + 0.5) * view.w;
      const sy = (0.5 - ndc.y * 0.5) * view.h;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    const pad = 10;
    const x0 = Math.max(0, Math.floor(minX - pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const x1 = Math.min(view.w, Math.ceil(maxX + pad));
    const y1 = Math.min(view.h, Math.ceil(maxY + pad));
    if (!(x1 > x0 && y1 > y0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * 画到 2D 舞台。返回 false 表示这一帧没画（还没视图 / 上下文丢了），
   * spatial.js 会退回原来的 drawListener()。
   */
  function draw(ctx2d, view) {
    if (dead) return false;
    if (!ctx2d || !view || !view.cam || !view.focal || !view.w || !view.h) return false;

    // 移动端 DPR 上限 2，省显存；离屏 canvas 不进 DOM，不跟随 CSS
    const dpr = Math.min(2, view.dpr || 1);
    const sig = `${view.cam.x}|${view.cam.y}|${view.cam.z}|${view.focal}`
      + `|${view.w}|${view.h}|${dpr}`;

    if (sig !== signature) {
      if (view.w !== lastW || view.h !== lastH || dpr !== lastDpr) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(view.w, view.h, false);
        lastW = view.w;
        lastH = view.h;
        lastDpr = dpr;
      }
      syncCamera(view);
      renderer.render(scene, camera);
      rect = computeRect(view);
      signature = sig;
    }

    if (!rect) return false;

    // 源矩形用实际 drawingBuffer 像素（canvas.width 可能因取整和 w*dpr 差 1px），
    // 目标矩形用 CSS px —— 2D context 已经有 setTransform(dpr, …)
    const sx = (rect.x / view.w) * canvas.width;
    const sy = (rect.y / view.h) * canvas.height;
    const sw = (rect.w / view.w) * canvas.width;
    const sh = (rect.h / view.h) * canvas.height;
    ctx2d.drawImage(canvas, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
    return true;
  }

  return { draw };
}

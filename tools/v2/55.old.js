/* ===== lizi55 · 陨石雨 · meteor —— PHYSICS =====
   陨石从右上砸下来，砸中的位置炸出坑 + 火星，坑连成字；
   字不是"生成"的，是**一颗颗砸出来的**：每颗陨石带速度拉伸的尾迹，落地瞬间白闪 + 定向震动。
   构图：落点铺满画面中部（字形点），上半屏留空给飞行段。                        */

const B55 = 2600;                       /* 尾迹粒子 */
const b55x = new Float32Array(B55), b55y = new Float32Array(B55);
const b55lx = new Float32Array(B55), b55ly = new Float32Array(B55);
const b55l = new Float32Array(B55);
let f55t = 0, f55hit = 0, b55inited = 0;

function m55init() {
  b55inited = 1;
  for (let i = 0; i < B55; i++) {
    b55x[i] = -1; b55l[i] = 0;
  }
}

function mechUpdate(dt, T) {
  if (!b55inited) m55init();
  f55t = T;
  if (f55hit > 0) f55hit = Math.max(0, f55hit - dt * 3.4);
  /* 字：被砸中的点带余温（按 charGlow 依次"落地"） */
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    const wob = 0.9 + 0.10 * Math.sin(T * 3.1 + i * 0.02);
    vx[i] = vtx[i] + (vx[i] - vtx[i]) * Math.pow(0.02, dt) + (1 - gl) * Math.sin(T * 2 + i) * 0.6;
    vy[i] = vty[i] + (vy[i] - vty[i]) * Math.pow(0.02, dt);
    lz[i] = wz55(gl, T, i) * wob;
  }
  /* 火星：从命中点往上抛，重力落回 */
  for (let i = 0; i < B55; i++) {
    if (b55l[i] <= 0) continue;
    b55l[i] -= dt;
    b55ly[i] += 520 * dt;
    b55x[i] += b55lx[i] * dt;
    b55y[i] += b55ly[i] * dt;
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.2);
}

function wz55(gl, T, i) { return (gl - 0.6) * 34 + Math.sin(T * 2 + i * 0.03) * 8; }

function mechElent(k, first) {
  f55hit = 1; vPulse = 1;
  camShake(1, 0.35, first ? 16 : 9);
  /* 在字形上炸一把火星 */
  const n = b55inited ? B55 : 0;
  let spawned = 0;
  for (let i = 0; i < n && spawned < 46; i++) {
    if (b55l[i] > 0) continue;
    const src = (Math.random() * vn) | 0;
    b55x[i] = vtx[src]; b55y[i] = vty[src];
    b55lx[i] = rnd(-150, 190); b55ly[i] = rnd(-460, -180);
    b55l[i] = rnd(0.35, 0.9);
    spawned++;
  }
}

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const yaw = Math.sin(T * 0.29) * 0.26, pit = 0.11 * Math.sin(T * 0.24);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    let X1 = vx[i] * cy + lz[i] * sy, Z1 = -vx[i] * sy + lz[i] * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z1);
    lsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    lsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    lss[i] = s;
    const gl = charGlow[von[i]] || 0;
    const heat = clamp01(gl * 1.15 - 0.1);
    vlum[i] = clamp01(0.24 + 0.54 * heat + 0.10 * Math.sin(T * 4.2 - i * 0.05)) + vPulse * 0.15;
  }
  /* 冷字（未唱）：暗铁色 */
  ctx.globalAlpha = 0.72; ctx.fillStyle = 'rgb(96,104,120)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] > 0.34) continue;
    const r = 3.0 * lss[i];
    ctx.rect(lsx[i] - r, lsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 余温 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55; ctx.fillStyle = 'rgb(255,120,40)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.34 || vlum[i] > 0.62) continue;
    const r = 2.9 * lss[i];
    ctx.rect(lsx[i] - r, lsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 熔亮核心 */
  ctx.globalAlpha = 0.95; ctx.fillStyle = 'rgb(255,236,196)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.62) continue;
    const r = 2.3 * lss[i];
    ctx.rect(lsx[i] - r, lsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  /* 火星尾迹：速度拉伸成短线（用 3 个小 rect 近似） */
  ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgb(255,170,90)';
  ctx.beginPath();
  for (let i = 0; i < B55; i++) {
    if (b55l[i] <= 0) continue;
    const px = pjX(blockGx + b55x[i], blockGy + b55y[i]);
    const py = pjY(blockGx + b55x[i], blockGy + b55y[i]);
    for (let k = 0; k < 3; k++) {
      const t2 = k * 0.4;
      ctx.rect(px - b55lx[i] * 0.012 * t2 - 1, py - b55ly[i] * 0.012 * t2 - 1, 2, 2);
    }
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-oler';
  ctx.globalAlpha = 1;
}





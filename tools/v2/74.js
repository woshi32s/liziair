/* ===== lizi74 · 雨幕折射 · rain-glass —— PHYSICS =====
   雨夜玻璃：外面在下雨，玻璃上挂着水珠，**字是从水珠后面透出来的那一层**——
   字用实体层画（三档 + 暗影 + 光晕），水珠和雨丝在前景，比字更亮更虚，
   再加一层冷色玻璃反光斜条，把"隔着一层玻璃"的空间拉开。命中时雨突然变密。 */

const R74 = 240;
const r74x = new Float32Array(R74), r74y = new Float32Array(R74);
const r74v = new Float32Array(R74), r74r = new Float32Array(R74), r74h = new Float32Array(R74);
const d74x = new Float32Array(90), d74y = new Float32Array(90), d74r = new Float32Array(90);
let inited74 = 0, hit74 = 0;

function mechUpdate(dt, T) {
  if (!inited74) {
    inited74 = 1;
    for (let i = 0; i < R74; i++) {
      r74x[i] = rnd(-W * 0.52, W * 0.52); r74y[i] = rnd(-H * 0.55, H * 0.55);
      r74v[i] = rnd(150, 420); r74r[i] = rnd(0.7, 1.5); r74h[i] = rnd(14, 46);
    }
    for (let i = 0; i < 90; i++) {
      d74x[i] = rnd(-W * 0.45, W * 0.45); d74y[i] = rnd(-H * 0.42, H * 0.42); d74r[i] = rnd(2.2, 6.5);
    }
  }
  if (hit74 > 0) hit74 = Math.max(0, hit74 - dt * 2.0);
  for (let i = 0; i < R74; i++) {
    r74y[i] += r74v[i] * (1 + hit74 * 1.2) * dt;
    if (r74y[i] > H * 0.56) { r74y[i] = -H * 0.56; r74x[i] = rnd(-W * 0.52, W * 0.52); }
  }
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit74 = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = W / 2, cy = H * 0.47;

  /* 玻璃冷反光斜条 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = 'rgb(150,200,255)';
  ctx.beginPath();
  ctx.moveTo(cx - 700, cy + 260); ctx.lineTo(cx - 520, cy + 260);
  ctx.lineTo(cx + 260, cy - 320); ctx.lineTo(cx + 80, cy - 320);
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  /* 雨丝 */
  ctx.globalAlpha = 0.26; ctx.fillStyle = 'rgb(170,205,240)';
  ctx.beginPath();
  for (let i = 0; i < R74; i++) {
    ctx.rect(cx + r74x[i] - r74r[i], cy + r74y[i] - r74h[i], r74r[i] * 2, r74h[i]);
  }
  ctx.fill();
  ctx.globalAlpha = 1;

  /* 实体字 */
  const yaw = Math.sin(T * 0.18) * 0.14, pit = 0.06 * Math.sin(T * 0.15 + 0.7);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.68 + 0.16 * Math.sin(T * 1.0 - X1 / 280) + 0.26 * gl) + hit74 * 0.05;
  }
  ctx.globalAlpha = 0.40; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0 * vss[i]; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.06; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { if (vlum[i] < 0.66) continue; const r = 5.0 * vss[i]; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);

  /* 水珠（前景，比字亮）：暗环 + 亮芯 + 高光点 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgb(120,170,220)';
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const rr = d74r[i] * z;
    ctx.rect(cx + d74x[i] * z - rr, cy + d74y[i] * z - rr, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgb(226,244,255)';
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const rr = d74r[i] * 0.42 * z;
    ctx.rect(cx + d74x[i] * z - rr - 1.5, cy + d74y[i] * z - rr - 1.5, rr * 2, rr * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}


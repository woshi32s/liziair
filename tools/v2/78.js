/* ===== lizi78 · 等离子球 · plasma-globe —— PHYSICS =====
   玻璃球里一根中心电极，电弧从电极爬向球壁，**触壁点连成字**——
   字用实体层画（贴着球面向外微微鼓起），电弧是前景分形折线（每帧抖动），
   球壁有菲涅尔亮边 + 一点玻璃反光。命中时全部电弧同时跳一下。                      */

const A78 = 26, TAB78 = 34;
const a78tgt = new Int16Array(A78);
let inited78 = 0, hit78 = 0, arcs78 = 0;

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2600, Math.round(pc * 0.95)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 26;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  for (let a = 0; a < A78; a++) a78tgt[a] = (Math.random() * Math.max(1, vn)) | 0;
  vCore = 'rgb(232,246,255)';
  vMid = 'rgb(120,190,255)';
  vDim = 'rgb(22,48,80)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  if (hit78 > 0) hit78 = Math.max(0, hit78 - dt * 2.6);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit78 = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const R = 300 * z;

  /* 球壁：暗底 + 菲涅尔亮边 + 高光 */
  ctx.globalAlpha = 0.10; ctx.fillStyle = 'rgb(30,70,120)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 0.55; ctx.strokeStyle = 'rgba(140,205,255,0.45)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
  ctx.globalAlpha = 0.30; ctx.strokeStyle = 'rgba(220,245,255,0.5)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(cx - R * 0.34, cy - R * 0.34, R * 0.42, 2.4, 3.7); ctx.stroke();
  ctx.globalAlpha = 1;

  /* 中心电极 */
  ctx.fillStyle = 'rgb(20,28,40)';
  ctx.beginPath(); ctx.arc(cx, cy, 16 * z, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 0.8; ctx.strokeStyle = 'rgba(180,225,255,0.6)';
  ctx.beginPath(); ctx.arc(cx, cy, 16 * z, 0, 6.2832); ctx.stroke();
  ctx.globalAlpha = 1;

  /* 电弧：电极 → 字位，锯齿折线（每帧抖动） */
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(190,235,255,0.72)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let a = 0; a < A78; a++) {
    const ti = a78tgt[a] % vn;
    const tx = pjX(blockGx + vtx[ti], blockGy + vty[ti]);
    const ty = pjY(blockGx + vtx[ti], blockGy + vty[ti]);
    const dx = tx - cx, dy = ty - cy;
    const segs = 7;
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const jx = k === 0 || k === segs ? 0 : Math.sin(T * 40 + a * 3.1 + k * 2.3) * 10 * Math.sin(u * 3.14);
      const jy = k === 0 || k === segs ? 0 : Math.cos(T * 47 + a * 2.7 + k * 1.9) * 10 * Math.sin(u * 3.14);
      const px2 = cx + dx * u + jx, py2 = cy + dy * u + jy;
      if (k === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
    }
  }
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  /* 实体字 */
  const yaw = Math.sin(T * 0.22) * 0.20, pit = 0.08 * Math.sin(T * 0.18 + 0.6);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.66 + 0.18 * Math.sin(T * 1.1 - X1 / 260) + 0.28 * gl) + hit78 * 0.06;
  }
  ctx.globalAlpha = 0.36; ctx.fillStyle = '#000';
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
  ctx.globalAlpha = 1;
}


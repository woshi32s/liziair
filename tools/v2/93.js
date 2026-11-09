/* ===== lizi93 · 回声 · echo —— PHYSICS =====
   声呐一样的波前一圈圈扩散，撞到画面右侧的"墙"再反射回来，**反射波前经过的地方留下字**。
   波前本身是描边圆弧（2~3 道），粒子在波前经过时点亮并停在字位；命中时打一道更亮的波。
   整体偏冷蓝 + 一点点暖色高光。                                                  */

const E93 = 5;
let e93init = 0, e93t = 0, e93hit = 0;
const e93r = new Float32Array(E93);
const e93own = new Uint8Array(VN);

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2400, Math.round(pc * 0.8)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 16;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  vCore = 'rgb(226,244,255)';
  vMid = 'rgb(96,168,236)';
  vDim = 'rgb(20,46,74)';
  vPulse = 1;
}

function mechUpdate(dt, T) {
  e93t = T;
  if (e93hit > 0) e93hit = Math.max(0, e93hit - dt * 2.6);
  for (let i = 0; i < E93; i++) e93r[i] = ((T * 260 + i * 210) % 1100);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 6);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 6);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.2);
}

function mechEvent(k, first) { e93hit = 1; vPulse = 1; }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx - 60, blockGy), cy = pjY(blockGx - 60, blockGy);

  /* 波前：描边圆弧（右半边被"墙"截断） */
  ctx.strokeStyle = 'rgba(110,180,240,0.35)';
  for (let i = 0; i < E93; i++) {
    const rr = e93r[i] * z;
    ctx.globalAlpha = 0.30 * (1 - e93r[i] / 1200);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();
    /* 反射波：从右墙回传 */
    if (rr > 420) {
      const rx = pjX(blockGx + 620, blockGy);
      ctx.globalAlpha = 0.18 * (1 - (rr - 420) / 900);
      ctx.beginPath();
      ctx.arc(rx, cy, (rr - 420) * 0.9 * z, Math.PI * 0.42, Math.PI * 1.58);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  /* 字粒子：按到"波前圆"的距离点亮 */
  for (let i = 0; i < vn; i++) {
    const X = vx[i], Y = vy[i];
    const d = Math.hypot(X + 60, Y);
    let lit = 0;
    for (let k = 0; k < E93; k++) {
      const dd = Math.abs(d - e93r[k]);
      if (dd < 70) lit = Math.max(lit, 1 - dd / 70);
    }
    vsx[i] = pjX(blockGx + X, blockGy + Y);
    vsy[i] = pjY(blockGx + X, blockGy + Y);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.18 + 0.62 * gl + 0.42 * lit) + e93hit * 0.1;
  }
  ctx.globalAlpha = 0.8; ctx.fillStyle = vDim;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalAlpha = 0.9; ctx.fillStyle = vMid;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.34) continue;
    const r = 2.6;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] < 0.7) continue;
    const r = 1.6;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

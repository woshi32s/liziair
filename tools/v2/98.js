/* ===== lizi98 · 线框 · wireframe —— PHYSICS =====
   一张向前起伏的线框曲面，**等值线 / 网格交点密起来的地方就是字**：
   字用实体层画（三档 + 暗影），背景是透视网格（横向 + 纵向线）+ 上下游走的波形。
   镜头低角度贴着曲面推进，命中时曲面抖一下。                                        */

const WG98 = 34, WG98B = 16;                 /* 纵向线数 / 横向线数 */
let inited98 = 0, hit98 = 0;

function mechUpdate(dt, T) {
  if (hit98 > 0) hit98 = Math.max(0, hit98 - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { hit98 = 1; vPulse = 1; camShake(0.3, 1, first ? 9 : 5); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const horizon = cy - 210 * z;
  const roll = Math.sin(T * 0.18) * 0.05;
  const cr = Math.cos(roll), sr = Math.sin(roll);

  /* 透视网格：横向线（越靠下越疏）+ 纵向线（汇聚到消失点） */
  ctx.strokeStyle = 'rgba(90,220,190,0.26)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 1; r <= WG98B; r++) {
    const t = r / WG98B;
    const yy = horizon + Math.pow(t, 1.9) * (H * 0.95);
    const half = (60 + Math.pow(t, 1.5) * W * 0.75) * z;
    const x0 = cx - half, x1 = cx + half;
    const y0 = yy + Math.sin(T * 1.2 + r * 0.7) * 10 * t;
    ctx.moveTo(x0 * cr - (y0 - cy) * sr, y0);
    ctx.lineTo(x1 * cr - (y0 - cy) * sr, y0);
  }
  for (let c = -WG98; c <= WG98; c++) {
    const t = c / WG98;
    const xb = cx + t * W * 0.9 * z;
    ctx.moveTo(cx + (xb - cx) * 0.06, horizon);
    ctx.lineTo(xb, H * 1.02);
  }
  ctx.stroke();

  /* 曲面波：几条被扰动的横向亮线 */
  ctx.strokeStyle = 'rgba(150,255,220,0.45)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const yy = cy + (k - 1) * 60 * z + Math.sin(T * 1.6 + k) * 14 * z;
    ctx.moveTo(cx - W * 0.45, yy);
    for (let s = 1; s <= 12; s++) {
      const xx = cx - W * 0.45 + (W * 0.9 * s) / 12;
      const yy2 = yy + Math.sin(T * 2.2 + s * 0.7 + k) * 16 * z + hit98 * 10;
      ctx.lineTo(xx, yy2);
    }
  }
  ctx.stroke();

  /* 实体字 */
  const yaw = Math.sin(T * 0.20) * 0.22, pit = 0.10 * Math.sin(T * 0.17 + 0.6);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  for (let i = 0; i < vn; i++) {
    const X1 = vx[i] * cyw + vz[i] * syw, Z1 = -vx[i] * syw + vz[i] * cyw;
    const Y1 = vy[i] * cp - Z1 * sp, Z2 = vy[i] * sp + Z1 * cp;
    const s = 900 / (900 + Z2);
    vsx[i] = pjX(blockGx + X1 * s, blockGy + Y1 * s);
    vsy[i] = pjY(blockGx + X1 * s, blockGy + Y1 * s);
    vss[i] = s;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.66 + 0.18 * Math.sin(T * 1.1 - X1 / 260) + 0.30 * gl) + hit98 * 0.06;
  }
  ctx.globalAlpha = 0.42; ctx.fillStyle = '#000';
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


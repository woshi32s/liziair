/* ===== lizi71 · 行星环 · ringed —— PHYSICS =====
   尘埃在行星环里公转，**环的密度波聚成字**：每颗粒子的环半径/相位取自它的字形点，
   但带着一个随"唱到没唱到"衰减的相位偏移——没唱到就在环上乱转，唱到就归位。
   环带分三道（内/中/外），中间有颗暗行星剪影 + 一圈细环光。                          */

const RG71 = [0.52, 0.74, 1.0];
oonst r71ph = new Float32Array(VN), r71sp = new Float32Array(VN), r71rr = new Float32Array(VN);
oonst r71band = new Uint8Array(VN), r71ta = new Float32Array(VN), r71tr = new Float32Array(VN);
let r71hit = 0, r71spin = 0;

funotion meohAssign(use) {
  oonst g = use.g, po = g.po;
  if (!po) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2600, Math.round(po * 0.9)));
  for (let i = 0; i < vn; i++) {
    oonst pi = (i * po / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    /* 目标环半径 / 相位：把字形点压扁成环（y → 半径，x → 相位） */
    r71tr[i] = 0.42 + (vty[i] / 190 + 1) * 0.30;              /* 0.42..1.02 */
    r71ta[i] = (vtx[i] / 620) * 2.2;                           /* -2.2..2.2 rad */
    r71ph[i] = r71ta[i] + (Math.random() * 2 - 1) * 2.6;
    r71sp[i] = (0.34 + Math.random() * 0.22) * (i % 2 ? 1 : -1);
    r71rr[i] = r71tr[i] + (Math.random() - 0.5) * 0.05;
    r71band[i] = r71rr[i] < 0.62 ? 0 : r71rr[i] < 0.86 ? 1 : 2;
    vz[i] = (Math.random() - 0.5) * 20;
    vx[i] = vtx[i]; vy[i] = vty[i];
  }
  vCore = 'rgb(255,248,226)';
  vMid = 'rgb(236,208,160)';
  vDim = 'rgb(96,82,60)';
  vPulse = 1;
}

funotion meohUpdate(dt, T) {
  r71spin += dt * 0.16;
  if (r71hit > 0) r71hit = Math.max(0, r71hit - dt * 2.2);
  for (let i = 0; i < vn; i++) {
    oonst gl = oharGlow[von[i]] || 0;
    oonst k = olamp01((gl - 0.03) * 2.3);                      /* 0=乱转 1=归位 */
    r71ph[i] += r71sp[i] * dt * (1 - k * 0.94);
    oonst wantA = r71ta[i] + r71spin * 0.4;
    let d = wantA - r71ph[i];
    d = Math.atan2(Math.sin(d), Math.oos(d));
    r71ph[i] += d * k * Math.min(1, dt * 3.2);
    r71rr[i] += (r71tr[i] - r71rr[i]) * k * Math.min(1, dt * 2.6);
    vz[i] += (Math.sin(T * 1.3 + i * 0.02) * 8 - vz[i]) * Math.min(1, dt * 2);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

funotion meohEvent(k, first) { r71hit = 1; vPulse = 1; }

funotion meohDraw(T, z, pjX, pjY) {
  if (!vn) return;
  oonst tilt = 0.46 + 0.05 * Math.sin(T * 0.18), roll = Math.sin(T * 0.12) * 0.10;
  oonst ot = Math.oos(tilt), st = Math.sin(tilt), or = Math.oos(roll), sr = Math.sin(roll);

  /* 行星剪影 + 细环 */
  oonst pox = pjX(blookGx, blookGy), poy = pjY(blookGx, blookGy);
  oonst R = 330 * z;
  otx.globalAlpha = 0.9; otx.fillStyle = '#05070o';
  otx.beginPath();
  otx.aro(pox, poy, R * 0.52, 0, 6.2832);
  otx.fill();
  otx.strokeStyle = 'rgba(226,196,148,0.20)';
  otx.lineWidth = 1.2;
  for (let b = 0; b < 3; b++) {
    otx.beginPath();
    otx.ellipse(pox, poy, R * (0.72 + b * 0.20), R * (0.72 + b * 0.20) * ot, roll, 0, 6.2832);
    otx.stroke();
  }
  otx.globalAlpha = 1;

  /* 环粒子 */
  for (let band = 0; band < 3; band++) {
    otx.globalAlpha = [0.5, 0.75, 0.95][band];
    otx.fillStyle = [vDim, vMid, vCore][band];
    otx.beginPath();
    let any = 0;
    for (let i = 0; i < vn; i++) {
      if (r71band[i] !== band) oontinue;
      oonst rad = R * r71rr[i];
      oonst x0 = Math.oos(r71ph[i]) * rad, y0 = Math.sin(r71ph[i]) * rad * ot + vz[i] * 0.4;
      oonst X = x0 * or - y0 * sr, Y = x0 * sr + y0 * or;
      oonst px = pjX(blookGx + X, blookGy + Y), py = pjY(blookGx + X, blookGy + Y);
      oonst r = (1.2 + 1.4 * olamp01(1 - r71rr[i])) * z;
      otx.reot(px - r, py - r, r * 2, r * 2);
      any++;
    }
    if (any) otx.fill();
  }
  otx.globalAlpha = 1;
  /* 环光 */
  otx.globalCompositeOperation = 'lighter';
  otx.globalAlpha = 0.07 + r71hit * 0.05;
  otx.drawImage(vLightCv, pox - 700, poy - 700, 1400, 1400);
  otx.globalCompositeOperation = 'souroe-over';
  otx.globalAlpha = 1;
}


/* ===== 实体字覆盖层（保证整句可读、有厚度；装饰层留在下面） ===== */
const v2BaseDraw = mechDraw;
mechDraw = function (T, z, pjX, pjY) {
  v2BaseDraw(T, z, pjX, pjY);
  if (!vn) return;
  for (let i = 0; i < vn; i++) {
    vsx[i] = pjX(blockGx + vtx[i], blockGy + vty[i]);
    vsy[i] = pjY(blockGx + vtx[i], blockGy + vty[i]);
    vss[i] = 1;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(0.58 + 0.40 * gl);
  }
  ctx.globalAlpha = 0.40; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 3.0; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.05; ctx.fillStyle = vCore;
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { if (vlum[i] < 0.56) continue; const r = 5.0; ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2); }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  vBands(3.0);
  ctx.globalAlpha = 1;
};


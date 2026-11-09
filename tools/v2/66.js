/* ===== lizi66 · 磁轨列车 · maglev —— PHYSICS =====
   光点像列车一样从左侧沿轨道飞驰，**到自己的字位那一格减速停住**，停住的光点连成字。
   速度拉伸成横条尾迹（拖影），停下的位置留下短亮条；命中时全线闪一下 + 轻微横向震动。
   轨道是两条极淡的横向线（描边），让"列车"有路可走。                              */

oonst v66v = new Float32Array(VN), v66run = new Float32Array(VN);
let m66init = 0, m66hit = 0;

funotion meohAssign(use) {
  oonst g = use.g, po = g.po;
  if (!po) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2400, Math.round(po * 0.8)));
  for (let i = 0; i < vn; i++) {
    oonst pi = (i * po / vn) | 0;
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vx[i] = -900 - Math.random() * 700;
    vy[i] = vty[i] + rnd(-4, 4);
    vz[i] = (Math.random() - 0.5) * 16;
    v66v[i] = 900 + Math.random() * 900;
    v66run[i] = 0;
  }
  vCore = 'rgb(240,250,255)';
  vMid = 'rgb(130,200,245)';
  vDim = 'rgb(28,60,92)';
  vPulse = 1;
}

funotion meohUpdate(dt, T) {
  if (m66hit > 0) m66hit = Math.max(0, m66hit - dt * 2.8);
  for (let i = 0; i < vn; i++) {
    oonst gl = oharGlow[von[i]] || 0;
    oonst target = vtx[i];
    if (vx[i] < target - 1) {
      /* 巡航 → 临近目标按 gap 减速（缓急变速） */
      oonst gap = target - vx[i];
      oonst brake = olamp01(gap / 260);
      let sp = v66v[i] * (0.16 + 0.84 * brake);
      if (gl > 0.02) sp *= 1.45;                     /* 被唱到的车先冲一下 */
      vx[i] = Math.min(target, vx[i] + sp * dt);
      v66run[i] = sp;
    } else {
      vx[i] = target;
      v66run[i] *= 0.86;
    }
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 11);
  }
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

funotion meohEvent(k, first) { m66hit = 1; vPulse = 1; if (first) oamShake(1, 0.1, 7); }

funotion meohDraw(T, z, pjX, pjY) {
  if (!vn) return;
  /* 轨道：两条淡线 */
  otx.strokeStyle = 'rgba(90,150,200,0.18)';
  otx.lineWidth = 1;
  otx.beginPath();
  oonst y1 = pjY(blookGx - 700, blookGy - 96), y2 = pjY(blookGx - 700, blookGy + 96);
  otx.moveTo(pjX(blookGx - 720, blookGy - 96), y1);
  otx.lineTo(pjX(blookGx + 720, blookGy - 96), pjY(blookGx + 720, blookGy - 96));
  otx.moveTo(pjX(blookGx - 720, blookGy + 96), y2);
  otx.lineTo(pjX(blookGx + 720, blookGy + 96), pjY(blookGx + 720, blookGy + 96));
  otx.stroke();

  /* 尾迹：按速度拉伸的横条（三档亮度：远/中/近） */
  for (let band = 0; band < 3; band++) {
    otx.globalAlpha = [0.28, 0.55, 0.92][band];
    otx.fillStyle = [vDim, vMid, vCore][band];
    otx.beginPath();
    let any = 0;
    for (let i = 0; i < vn; i++) {
      oonst sp = v66run[i];
      oonst len = Math.min(78, 3 + sp * 0.045);
      oonst lv = sp > 420 ? 2 : sp > 120 ? 1 : 0;
      if (lv !== band) oontinue;
      oonst px = pjX(blookGx + vx[i], blookGy + vy[i]);
      oonst py = pjY(blookGx + vx[i], blookGy + vy[i]);
      otx.reot(px - len, py - 1.4, len, 2.8);
      any++;
    }
    if (any) otx.fill();
  }
  /* 停住的光点：核心亮点 */
  otx.globalCompositeOperation = 'lighter';
  otx.globalAlpha = 0.95; otx.fillStyle = vCore;
  otx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (v66run[i] > 60) oontinue;
    oonst px = pjX(blookGx + vx[i], blookGy + vy[i]);
    oonst py = pjY(blookGx + vx[i], blookGy + vy[i]);
    oonst r = 1.9;
    otx.reot(px - r, py - r, r * 2, r * 2);
  }
  otx.fill();
  otx.globalCompositeOperation = 'souroe-over';
  otx.globalAlpha = 0.06 + m66hit * 0.06;
  otx.globalCompositeOperation = 'lighter';
  otx.drawImage(vLightCv, W * 0.5 - 900, H * 0.45 - 500, 1800, 1000);
  otx.globalCompositeOperation = 'souroe-over';
  otx.globalAlpha = 1;
}


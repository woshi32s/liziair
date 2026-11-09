/* lizi32 · 蒸汽凝结 · condense
   水汽在冷玻璃上凝结：先是满屏飞的水汽，唱到一个字，那个字的笔画上开始**成核**，
   露珠一颗颗长大、连成字；然后一把"擦"从左往右把字抹掉，下一句再凝。
   AE：焦点滑动（近处露珠大而实、远处虚）+ 微距缓推 + 顿帧。 */

const N32 = 5200;
const vx32 = new Float32Array(N32), vy32 = new Float32Array(N32);
const vvx32 = new Float32Array(N32), vvy32 = new Float32Array(N32);
const vtx32 = new Float32Array(N32), vty32 = new Float32Array(N32);
const vat32 = new Float32Array(N32), vg32 = new Float32Array(N32);
const vown32 = new Int16Array(N32), vsz32 = new Float32Array(N32);
const vdep32 = new Uint8Array(N32);
let n32 = 0, wipeX32 = 0, fogCv32 = null;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N32; i++) {
    vx32[i] = Math.random() * W; vy32[i] = Math.random() * H;
    vvx32[i] = rnd(-40, 40); vvy32[i] = rnd(-30, 30);
    vsz32[i] = 1 + Math.random() * 1.2;
    vdep32[i] = 0; vg32[i] = 0;
  }
  n32 = N32;

  /* 玻璃上的一层雾：预烘，之后只 blit */
  if (!fogCv32) fogCv32 = document.createElement('canvas');
  fogCv32.width = Math.max(2, Math.round(W / 2));
  fogCv32.height = Math.max(2, Math.round(H / 2));
  const fc = fogCv32.getContext('2d');
  const bw = fogCv32.width, bh = fogCv32.height;
  const g = fc.createRadialGradient(bw * 0.5, bh * 0.45, 0, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.8);
  g.addColorStop(0, 'rgba(120,150,170,0.16)');
  g.addColorStop(0.55, 'rgba(70,95,115,0.10)');
  g.addColorStop(1, 'rgba(20,30,40,0.02)');
  fc.fillStyle = g; fc.fillRect(0, 0, bw, bh);
  /* 雾里的细水痕 */
  fc.strokeStyle = 'rgba(200,225,240,0.05)';
  fc.lineWidth = 1;
  for (let k = 0; k < 30; k++) {
    fc.beginPath();
    const x = Math.random() * bw;
    fc.moveTo(x, 0);
    fc.bezierCurveTo(x + rnd(-20, 20), bh * 0.4, x + rnd(-30, 30), bh * 0.7, x + rnd(-10, 10), bh);
    fc.stroke();
  }
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n32 = Math.max(1800, Math.min(N32, Math.round(pc * 1.5)));
  wipeX32 = -W * 0.1;
  for (let i = 0; i < n32; i++) {
    const pi = ((i * pc / n32) | 0) % pc;
    vtx32[i] = blockGx + g.px[pi] + rnd(-1.2, 1.2);
    vty32[i] = blockGy + g.py[pi] + rnd(-1.2, 1.2);
    vown32[i] = g.own[pi];
    vat32[i] = use.at[g.own[pi]] || use.lineT;
    vdep32[i] = 0; vg32[i] = 0;
    vx32[i] = vtx32[i] + rnd(-80, 80);
    vy32[i] = vty32[i] + rnd(-40, 40);
    vvx32[i] = rnd(-30, 30); vvy32[i] = rnd(-20, 20);
  }
}

function mechEvent(k, first) {
  cam.ox = (k % 2 ? -1 : 1) * (first ? 24 : 12);
  cam.tz = Math.max(cam.tz, 1.03);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  cam.ox *= Math.pow(0.03, dt);
  /* 擦：句末从左往右抹一遍 */
  const prog = (T - lineT) / Math.max(1.5, lineDur);
  wipeX32 = prog > 0.86 ? W * ((prog - 0.86) / 0.14) * 1.15 : -W * 0.1;
  for (let i = 0; i < n32; i++) {
    const d = Math.hypot(vtx32[i] - vx32[i], vty32[i] - vy32[i]);
    if (T < vat32[i] - 0.5) {
      /* 水汽还在飘 */
      vvx32[i] += Math.sin(vy32[i] * 0.02 + T) * 20 * dt;
      vvy32[i] += Math.cos(vx32[i] * 0.017 + T * 1.3) * 18 * dt;
      vvx32[i] *= Math.pow(0.6, dt); vvy32[i] *= Math.pow(0.6, dt);
      vx32[i] += vvx32[i] * dt; vy32[i] += vvy32[i] * dt;
      continue;
    }
    const near = d < 70;
    const kk = near ? 26 : 7;
    vvx32[i] += (vtx32[i] - vx32[i]) * kk * dt - vvx32[i] * (near ? 9 : 2.4) * dt;
    vvy32[i] += (vty32[i] - vy32[i]) * kk * dt - vvy32[i] * (near ? 9 : 2.4) * dt;
    const sp = Math.hypot(vvx32[i], vvy32[i]);
    if (sp > 900) { const s = 900 / sp; vvx32[i] *= s; vvy32[i] *= s; }
    vx32[i] += vvx32[i] * dt; vy32[i] += vvy32[i] * dt;
    if (d < 2.2 || T > vat32[i] + 0.9) { vdep32[i] = 1; vx32[i] = vtx32[i]; vy32[i] = vty32[i]; }
    /* 露珠长大（表面张力聚水） */
    if (vdep32[i]) vg32[i] = Math.min(1, vg32[i] + dt * 1.6);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (fogCv32) ctx.drawImage(fogCv32, 0, 0, W, H);

  /* 水汽：很淡的小点 */
  ctx.fillStyle = 'rgba(180,205,220,0.16)';
  ctx.beginPath();
  for (let i = 0; i < n32; i++) {
    if (vdep32[i]) continue;
    const px = pjX(vx32[i], vy32[i]), py = pjY(vx32[i], vy32[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    if (px < wipeX32) continue;
    ctx.rect(px, py, 1.6, 1.6);
  }
  ctx.fill();

  /* 露珠：暗底 + 亮面（两个批次，景深不同大小） */
  for (let pass = 0; pass < 2; pass++) {
    ctx.fillStyle = pass === 0
      ? 'rgba(110,150,175,0.62)'
      : `rgba(${Math.min(255, ar + 30)},${Math.min(255, ag + 40)},${Math.min(255, ab + 60)},0.98)`;
    ctx.beginPath();
    for (let i = 0; i < n32; i++) {
      if (!vdep32[i]) continue;
      const px = pjX(vx32[i], vy32[i]), py = pjY(vx32[i], vy32[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      if (px < wipeX32) continue;           /* 被擦掉 */
      const near = vty32[i] > blockGy;      /* 下半部分算前景 */
      if (near !== (pass === 1)) continue;
      const s = (1.8 + vg32[i] * 2.6) * (near ? 1.5 : 1.1) * z;
      if (pass === 0) ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      else {
        /* 亮面：高光偏左上 */
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
        ctx.rect(px - s * 0.5 + s * 0.18, py - s * 0.5 + s * 0.15, s * 0.34, s * 0.34);
      }
    }
    ctx.fill();
  }
}

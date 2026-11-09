/* lizi17 · 熔岩冷凝 · lava-flow
   字 = 熔岩流里还没冷却的裂缝网络。
   粒子带着温度：被唱到的字 → 那一团熔岩升温、脱离流场、焊到字形上；
   焊上后温度按指数冷却（白热 → 橙 → 暗红 → 黑壳）。
   词团命中时整片熔岩被"顶"一下（相干），镜头横向甩一下，火星被甩出来。 */

const N17 = 7200;
const lx = new Float32Array(N17), ly = new Float32Array(N17);
const lvx = new Float32Array(N17), lvy = new Float32Array(N17);
const ltx = new Float32Array(N17), lty = new Float32Array(N17);
const lat = new Float32Array(N17), ltm = new Float32Array(N17);
const lsz = new Float32Array(N17), lown = new Int16Array(N17);
const ldep = new Uint8Array(N17);
let n17 = 0, heatPulse = 0;
let rockCv = null;

/* 火星：被熔岩甩出来的小亮点 */
const NS17 = 260;
const sx17 = new Float32Array(NS17), sy17 = new Float32Array(NS17);
const svx17 = new Float32Array(NS17), svy17 = new Float32Array(NS17);
const stm17 = new Float32Array(NS17), ssz17 = new Float32Array(NS17);

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N17; i++) {
    lx[i] = rnd(-W * 0.1, W * 0.55);
    ly[i] = rnd(H * 0.6, H + 30);
    lvx[i] = rnd(20, 90); lvy[i] = rnd(-10, 30);
    ldep[i] = 0; ltm[i] = 0;
    lsz[i] = 1.1 + Math.random() * 1.45;
  }
  for (let i = 0; i < NS17; i++) {
    sx17[i] = rnd(0, W); sy17[i] = rnd(H * 0.5, H);
    svx17[i] = rnd(-30, 40); svy17[i] = rnd(-90, -20);
    stm17[i] = Math.random(); ssz17[i] = 1 + Math.random() * 1.6;
  }
  n17 = N17;

  /* 冷却的黑壳地面：预烘一次，之后每帧只 blit */
  if (!rockCv) rockCv = document.createElement('canvas');
  rockCv.width = Math.max(2, Math.round(W / 2));
  rockCv.height = Math.max(2, Math.round(H / 2));
  const rc = rockCv.getContext('2d');
  const bw = rockCv.width, bh = rockCv.height;
  const grd = rc.createLinearGradient(0, 0, 0, bh);
  grd.addColorStop(0, '#0a0807');
  grd.addColorStop(0.55, '#120a07');
  grd.addColorStop(1, '#1e0d06');
  rc.fillStyle = grd; rc.fillRect(0, 0, bw, bh);
  const rg = rc.createRadialGradient(bw * 0.5, bh * 1.02, 0, bw * 0.5, bh, Math.max(bw, bh) * 0.75);
  rg.addColorStop(0, 'rgba(150,52,16,0.30)');
  rg.addColorStop(0.5, 'rgba(90,26,8,0.14)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  rc.fillStyle = rg; rc.fillRect(0, 0, bw, bh);
  rc.strokeStyle = 'rgba(255,120,50,0.09)';
  rc.lineWidth = 1;
  for (let k = 0; k < 16; k++) {
    let x = Math.random() * bw, y = bh * (0.55 + Math.random() * 0.45);
    rc.beginPath(); rc.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += rnd(-26, 26); y += rnd(-10, 6); rc.lineTo(x, y); }
    rc.stroke();
  }
  rc.fillStyle = 'rgba(180,120,90,0.07)';
  rc.beginPath();
  for (let i = 0; i < 1800; i++) rc.rect(Math.random() * bw, Math.random() * bh, 1, 1);
  rc.fill();
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n17 = Math.max(2200, Math.min(N17, Math.round(pc * 1.25)));
  heatPulse = 1;
  for (let i = 0; i < n17; i++) {
    const pi = ((i * pc / n17) | 0) % pc;
    ltx[i] = blockGx + g.px[pi] + rnd(-1.1, 1.1);
    lty[i] = blockGy + g.py[pi] + rnd(-1.1, 1.1);
    lown[i] = g.own[pi];
    lat[i] = use.at[g.own[pi]] || use.lineT;
    ldep[i] = 0;
    ltm[i] = 0;
    if (!(lx[i] >= -40 && lx[i] <= W + 40 && ly[i] >= -40 && ly[i] <= H + 40) || Math.random() < 0.55) {
      lx[i] = rnd(-W * 0.15, W * 0.45);
      ly[i] = rnd(H * 0.56, H + 40);
    }
    lvx[i] = rnd(40, 120); lvy[i] = rnd(-20, 20);
  }
}

function mechEvent(k, first) {
  heatPulse = first ? 1.8 : 1.1;
  cam.ox = (k % 2 ? 1 : -1) * (first ? 46 : 24);
  cam.oy = -8;
  for (let i = 0; i < NS17; i++) {
    if (Math.random() < 0.6) {
      sx17[i] = rnd(W * 0.1, W * 0.9);
      sy17[i] = rnd(H * 0.35, H * 0.72);
      svy17[i] = -rnd(80, 240);
      svx17[i] = rnd(-70, 70);
      stm17[i] = 1;
    }
  }
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  heatPulse *= Math.pow(0.03, dt);
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.02, dt);
  const cd = Math.exp(-dt / 4.6);
  for (let i = 0; i < n17; i++) {
    if (ldep[i]) {
      ltm[i] *= cd;
      const cg = charGlow[lown[i]] || 0;
      if (cg > ltm[i]) ltm[i] = cg;
      continue;
    }
    if (T < lat[i] - 0.35) {
      const curl = Math.sin(ly[i] * 0.022 + T * 1.1) * 40 + Math.sin(lx[i] * 0.014 - T * 0.8) * 26;
      lvx[i] += (95 - lvx[i] * 0.9 + curl) * dt;
      lvy[i] += (26 - lvy[i] * 0.7 + Math.cos(lx[i] * 0.02 + T) * 30) * dt;
      lx[i] += lvx[i] * dt; ly[i] += lvy[i] * dt;
      if (lx[i] > W + 40) { lx[i] = -30; ly[i] = rnd(H * 0.55, H + 20); }
      if (ly[i] > H + 50) { ly[i] = H + 30; lvx[i] += 30; }
      continue;
    }
    const dx = ltx[i] - lx[i], dy = lty[i] - ly[i];
    const d = Math.hypot(dx, dy);
    const near = d < 90;
    const kk = near ? 30 : 8.5;
    lvx[i] += dx * kk * dt - lvx[i] * (near ? 9.2 : 1.8) * dt;
    lvy[i] += dy * kk * dt - lvy[i] * (near ? 9.2 : 1.8) * dt;
    const sp = Math.hypot(lvx[i], lvy[i]);
    if (sp > 900) { const s = 900 / sp; lvx[i] *= s; lvy[i] *= s; }
    lx[i] += lvx[i] * dt; ly[i] += lvy[i] * dt;
    if ((d < 2.6 && sp < 140) || T > lat[i] + 1.6) {
      ldep[i] = 1;
      lx[i] = ltx[i]; ly[i] = lty[i];
      lvx[i] = 0; lvy[i] = 0;
      ltm[i] = 1;
    }
  }

  for (let i = 0; i < NS17; i++) {
    stm17[i] *= Math.pow(0.25, dt);
    sy17[i] += svy17[i] * dt;
    sx17[i] += (svx17[i] + Math.sin(sy17[i] * 0.02 + T * 2) * 30) * dt;
    svy17[i] += 40 * dt;
    if (sy17[i] < -20) { sy17[i] = H + 10; sx17[i] = rnd(0, W); stm17[i] = 0; }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (rockCv) ctx.drawImage(rockCv, 0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(${Math.min(255, ar + 20)},${Math.min(255, ag - 30)},${Math.min(255, ab - 70)},0.07)`;
  ctx.beginPath();
  for (let k = 0; k < 7; k++) {
    const yy = H * (0.6 + k * 0.055) + Math.sin(T * 0.8 + k) * 10;
    const off = (T * (26 + k * 9)) % (W + 300);
    for (let x = -150; x < W + 150; x += 34) {
      const px2 = pjX(x + off - 150, yy), py2 = pjY(x + off - 150, yy + Math.sin(x * 0.01 + T) * 5);
      ctx.rect(px2, py2, 26, 1.8);
    }
  }
  ctx.fill();

  if (L) {
    for (let pass = 0; pass < 4; pass++) {
      if (pass === 0) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(46,20,16,0.5)';
      } else if (pass === 1) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(150,44,26,0.72)';
      } else if (pass === 2) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,116,42,0.55)';
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,236,198,0.95)';
      }
      ctx.beginPath();
      for (let i = 0; i < n17; i++) {
        /* 只有"焊上去并且还热"的才是白热；在途的是橙色 */
        const t = ldep[i] ? ltm[i] : (T >= lat[i] - 0.35 ? 0.5 : 0.3);
        const band = t > 0.68 ? 3 : t > 0.4 ? 2 : t > 0.16 ? 1 : 0;
        if (band !== pass) continue;
        const px = pjX(lx[i], ly[i]), py = pjY(lx[i], ly[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const sp = ldep[i] ? 0 : Math.hypot(lvx[i], lvy[i]);
        const st = Math.min(2.6, sp * 0.0042);
        const s = lsz[i] * (ldep[i] ? 1.3 : 1);
        const w = s * (1 + st), h = s * 0.95;
        ctx.rect(px - w * 0.5, py - h * 0.5, w, h);
      }
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,206,150,0.8)';
  ctx.beginPath();
  for (let i = 0; i < NS17; i++) {
    const a = stm17[i];
    if (a < 0.06) continue;
    const px = pjX(sx17[i], sy17[i]), py = pjY(sx17[i], sy17[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const s = ssz17[i] * 1.2 * z * (0.5 + a);
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 1.8);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/* lizi22 · 棱镜色散 · prism
   白光过棱镜散成光谱，三种波长的粒子各自绕一段弧，最后落在**同一个字形点**上；
   三色在落点叠加成白 —— 字是"重新合白的那些点"，没合上的地方还留着彩色边。
   词团命中：棱镜转一个角、整束光谱被甩一下、镜头横向甩。 */

const N22 = 8400;
const rx = new Float32Array(N22), ry = new Float32Array(N22);
const rvx = new Float32Array(N22), rvy = new Float32Array(N22);
const rtx = new Float32Array(N22), rty = new Float32Array(N22);
const rwl = new Uint8Array(N22), rland = new Uint8Array(N22);
const rat = new Float32Array(N22), rsz = new Float32Array(N22);
let n22 = 0, prismAng = 0, beamY = 0, prismX = 0, prismY = 0;
let prismCv = null;

function mechResize() {
  if (!W || !H) return;
  beamY = H * 0.80; prismX = W * 0.10; prismY = H * 0.735;
  for (let i = 0; i < N22; i++) {
    rx[i] = rnd(-W * 0.2, prismX - 20);
    ry[i] = beamY + rnd(-7, 7);
    rvx[i] = rnd(120, 260); rvy[i] = 0;
    rland[i] = 0; rwl[i] = i % 3;
    rsz[i] = 1.15 + Math.random() * 1.3;
  }
  n22 = N22;

  /* 棱镜的白光核心：预烘一次 */
  if (!prismCv) prismCv = document.createElement('canvas');
  prismCv.width = 220; prismCv.height = 220;
  const pc2 = prismCv.getContext('2d');
  const g = pc2.createRadialGradient(110, 110, 0, 110, 110, 108);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.16, 'rgba(220,236,255,0.5)');
  g.addColorStop(0.5, 'rgba(150,190,255,0.14)');
  g.addColorStop(1, 'rgba(80,120,255,0)');
  pc2.fillStyle = g; pc2.fillRect(0, 0, 220, 220);
}

function mechStep() { return 3; }
function mechAssign(use) {
  const g = use.g, pc = g.pc;
  const want = Math.min(N22, pc * 3);
  n22 = Math.max(2400, want);
  for (let k = 0; k < n22; k++) {
    const pi = ((k / 3) | 0) % pc;
    const wl = k % 3;
    /* 三色落点有 1.5px 的横向色差，落定后重合 → 白 */
    rtx[k] = blockGx + g.px[pi] + (wl === 0 ? -1.6 : wl === 2 ? 1.6 : 0) + rnd(-0.6, 0.6);
    rty[k] = blockGy + g.py[pi] + rnd(-0.8, 0.8);
    rwl[k] = wl;
    rat[k] = use.at[g.own[pi]] || use.lineT;
    rland[k] = 0;
    /* 重新从入射光束上出发 */
    rx[k] = rnd(-W * 0.25, prismX - 30);
    ry[k] = beamY + rnd(-8, 8);
    rvx[k] = rnd(140, 300); rvy[k] = rnd(-20, 20);
  }
}

function mechEvent(k, first) {
  prismAng = (k % 2 ? 1 : -1) * (first ? 0.22 : 0.1);
  cam.ox = (k % 2 ? -1 : 1) * (first ? 38 : 20);
  cam.oy = 6;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  prismAng *= Math.pow(0.02, dt);
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.02, dt);
  const cg = Math.cos(prismAng), sg = Math.sin(prismAng);
  for (let i = 0; i < n22; i++) {
    if (rland[i]) continue;
    if (T < rat[i] - 0.4) {
      /* 在入射光束里往前飘，到棱镜口就被挡住等着 */
      rx[i] += rvx[i] * dt;
      ry[i] += Math.sin(T * 2 + i) * 6 * dt;
      if (rx[i] > prismX - 6) { rx[i] = prismX - 6; rvx[i] *= -0.2; }
      continue;
    }
    const dx = rtx[i] - rx[i], dy = rty[i] - ry[i];
    const d = Math.hypot(dx, dy);
    const near = d < 90;
    const kk = near ? 34 : 11.0;
    rvx[i] += dx * kk * dt - rvx[i] * (near ? 9.2 : 1.5) * dt;
    rvy[i] += dy * kk * dt - rvy[i] * (near ? 9.2 : 1.5) * dt;
    /* 色散：刚出棱镜时三个波长朝不同方向偏一点（沿棱镜旋转方向） */
    if (d > 160) {
      const bias = (rwl[i] - 1) * 34;
      rvx[i] += (-sg * bias - cg * bias * 0.35) * dt;
      rvy[i] += (cg * bias + sg * bias * 0.35) * dt;
    }
    const sp = Math.hypot(rvx[i], rvy[i]);
    if (sp > 900) { const s = 900 / sp; rvx[i] *= s; rvy[i] *= s; }
    rx[i] += rvx[i] * dt; ry[i] += rvy[i] * dt;
    if ((d < 2.2 && sp < 130) || T > rat[i] + 1.2) {
      rland[i] = 1; rx[i] = rtx[i]; ry[i] = rty[i];
      rvx[i] = 0; rvy[i] = 0;
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 入射白光束：一条亮线 + 一层很淡的锥形散光 */
  const bx = pjX(prismX, beamY), by = pjY(prismX, beamY);
  const lx0 = pjX(-40, beamY), ly0 = pjY(-40, beamY);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(226,238,255,0.42)';
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(lx0, ly0); ctx.lineTo(bx, by); ctx.stroke();
  ctx.strokeStyle = 'rgba(226,238,255,0.10)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(lx0, ly0); ctx.lineTo(bx, by); ctx.stroke();

  /* 棱镜（玻璃三角） */
  const ax = pjX(prismX, prismY - 58 * z), ay = pjY(prismX, prismY - 58 * z);
  const bxx = pjX(prismX - 52 * z, prismY + 40 * z), byy = pjY(prismX - 52 * z, prismY + 40 * z);
  const cxx = pjX(prismX + 52 * z, prismY + 40 * z), cyy = pjY(prismX + 52 * z, prismY + 40 * z);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(150,190,230,0.09)';
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bxx, byy); ctx.lineTo(cxx, cyy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(190,220,255,0.35)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  if (prismCv) {
    const gr = 120 * z;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(prismCv, bx - gr * 0.5, by - gr * 0.5, gr, gr);
  }

  /* 光谱扇：从棱镜射向字块的三条（红/绿/蓝）边线 */
  const dir = [-0.66, -0.53, -0.40];
  for (let k = 0; k < 3; k++) {
    const ang = dir[k] + prismAng;
    const ex = pjX(prismX + Math.cos(ang) * W * 0.5, prismY + Math.sin(ang) * W * 0.5);
    const ey = pjY(prismX + Math.cos(ang) * W * 0.5, prismY + Math.sin(ang) * W * 0.5);
    ctx.strokeStyle = k === 0 ? 'rgba(255,120,120,0.13)' : k === 1 ? 'rgba(120,255,170,0.12)' : 'rgba(130,160,255,0.13)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
  }

  /* 粒子：三个波长三档颜色，叠加成白 */
  if (L) {
    const cols = [
      `rgba(255,86,96,ALPHA)`,
      `rgba(96,255,150,ALPHA)`,
      `rgba(110,150,255,ALPHA)`,
    ];
    for (let wl = 0; wl < 3; wl++) {
      ctx.fillStyle = cols[wl].replace('ALPHA', '0.30');
      ctx.beginPath();
      for (let i = wl; i < n22; i += 3) {
        const px = pjX(rx[i], ry[i]), py = pjY(rx[i], ry[i]);
        if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
        const s = rsz[i] * (rland[i] ? 1.6 : 1.2) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
      /* 落定的核心再压一层更实的同色，三色叠起来才够白 */
      ctx.fillStyle = cols[wl].replace('ALPHA', '0.95');
      ctx.beginPath();
      for (let i = wl; i < n22; i += 3) {
        if (!rland[i]) continue;
        const px = pjX(rx[i], ry[i]);
        const py = pjY(rx[i], ry[i]);
        if (px < -8 || px > W + 8 || py < -8 || py > H + 8) continue;
        const s = rsz[i] * 1.45 * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* lizi42 · 激光烧蚀 · ablation
   激光聚焦在材料表面，沿着笔画一路烧过去：烧到的地方瞬间白热、喷出一股等离子羽流，
   然后留下一个**烧穿的孔**（孔缘还在发红）。字 = 那一排烧穿的孔。
   AE：冲击帧 + 白闪 + 后坐（镜头沿光束反向退一下）。 */

const N42 = 5000;
const hx42 = new Float32Array(N42), hy42 = new Float32Array(N42);
const htx42 = new Float32Array(N42), hty42 = new Float32Array(N42);
const htm42 = new Float32Array(N42), hord42 = new Float32Array(N42);
const hsz42 = new Float32Array(N42), hown42 = new Int16Array(N42);
let n42 = 0, burn42 = 0, torch42 = 0;
const PL42 = 300;
const plx42 = new Float32Array(PL42), ply42 = new Float32Array(PL42);
const plvx42 = new Float32Array(PL42), plvy42 = new Float32Array(PL42);
const pll42 = new Float32Array(PL42);
let spotX42 = 0, spotY42 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N42; i++) {
    hx42[i] = Math.random() * W; hy42[i] = Math.random() * H;
    hsz42[i] = 1.1 + Math.random() * 1.5;
  }
  for (let i = 0; i < PL42; i++) pll42[i] = 0;
  n42 = N42;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n42 = Math.max(1800, Math.min(N42, pc));
  for (let i = 0; i < n42; i++) {
    const pi = ((i * pc / n42) | 0) % pc;
    htx42[i] = blockGx + g.px[pi] + rnd(-0.9, 0.9);
    hty42[i] = blockGy + g.py[pi] + rnd(-0.9, 0.9);
    hord42[i] = pi / pc;
    hown42[i] = g.own[pi];
    htm42[i] = 0;
    hx42[i] = htx42[i]; hy42[i] = hty42[i];
  }
  burn42 = 1; torch42 = 0;
}

function mechEvent(k, first) {
  burn42 = first ? 1.8 : 1;
  cam.ox = (first ? 26 : 14);
  cam.oy = -10;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  burn42 *= Math.pow(0.02, dt);
  cam.ox *= Math.pow(0.04, dt);
  cam.oy *= Math.pow(0.03, dt);
  torch42 = clamp01((T - lineT) / Math.max(1.2, lineDur * 0.95));
  const cool = Math.exp(-dt / 1.9);
  for (let i = 0; i < n42; i++) {
    const d = torch42 - hord42[i];
    if (d >= 0) {
      const heat = d < 0.05 ? 1 : Math.exp(-d * 18);
      if (heat > htm42[i]) htm42[i] = heat;
      /* 烧穿：孔缘往外扩一点 */
      const push = 1.2 * Math.min(1, htm42[i]);
      const ox = hx42[i] - htx42[i], oy = hy42[i] - hty42[i];
      const l = Math.hypot(ox, oy) || 1;
      hx42[i] = htx42[i] + ox / l * push;
      hy42[i] = hty42[i] + oy / l * push;
      spotX42 = hx42[i]; spotY42 = hy42[i];
    }
    htm42[i] *= cool;
  }
  for (let i = 0; i < PL42; i++) {
    if (pll42[i] <= 0) continue;
    plvy42[i] -= 260 * dt;
    plvx42[i] *= Math.pow(0.4, dt);
    plx42[i] += plvx42[i] * dt; ply42[i] += plvy42[i] * dt;
    pll42[i] -= dt * 0.9;
  }
  if (burn42 > 0.5) {
    for (let i = 0; i < PL42; i++) {
      if (pll42[i] > 0 || Math.random() > 0.4) continue;
      plx42[i] = spotX42 + rnd(-4, 4); ply42[i] = spotY42 + rnd(-4, 4);
      plvx42[i] = rnd(-160, 160); plvy42[i] = -rnd(120, 420);
      pll42[i] = rnd(0.3, 0.8);
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;

  /* 激光束：从右上角射向烧蚀点 */
  const bx = pjX(spotX42, spotY42), by = pjY(spotX42, spotY42);
  const sx0 = pjX(W * 1.05, -40), sy0 = pjY(W * 1.05, -40);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,90,140,0.35)';
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(bx, by); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,190,220,0.18)';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(bx, by); ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,250,0.5)';
  ctx.beginPath(); ctx.rect(bx - 6, by - 6, 12, 12); ctx.fill();

  /* 烧蚀点：冷材料 / 暗红孔缘 / 橙 / 白热（四档） */
  if (L) {
    for (let pass = 0; pass < 4; pass++) {
      if (pass === 0) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(64,66,74,0.5)'; }
      else if (pass === 1) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(150,40,40,0.7)'; }
      else if (pass === 2) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,110,60,0.7)'; }
      else { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,242,220,0.95)'; }
      ctx.beginPath();
      for (let i = 0; i < n42; i++) {
        const t = htm42[i];
        const band = t > 0.7 ? 3 : t > 0.34 ? 2 : t > 0.1 ? 1 : 0;
        if (band !== pass) continue;
        const px = pjX(hx42[i], hy42[i]), py = pjY(hx42[i], hy42[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const s = hsz42[i] * (t > 0.7 ? 2.1 : 1.3) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }

  /* 等离子羽流 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,170,220,0.75)';
  ctx.beginPath();
  for (let i = 0; i < PL42; i++) {
    if (pll42[i] <= 0) continue;
    const px = pjX(plx42[i], ply42[i]), py = pjY(plx42[i], ply42[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const s = (1 + pll42[i] * 3) * z;
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s * 2.2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/* lizi29 · 电弧焊 · weld-spark
   焊枪沿字形的笔画一路走，走过的地方金属被烧红、留下焊池；
   **字是焊缝上还在发红的熔池**，冷下来的部分变成一道暗色的焊道。
   火花四溅（带重力），命中时整条焊道被电弧照亮一下。 */

const N29 = 5200;
const wx29 = new Float32Array(N29), wy29 = new Float32Array(N29);
const wtx29 = new Float32Array(N29), wty29 = new Float32Array(N29);
const wtm29 = new Float32Array(N29), word29 = new Float32Array(N29);
const wsz29 = new Float32Array(N29), wph29 = new Float32Array(N29);
let n29 = 0, torchP = 0, arcF = 0;
const SP29 = 320;
const sx29 = new Float32Array(SP29), sy29 = new Float32Array(SP29);
const svx29 = new Float32Array(SP29), svy29 = new Float32Array(SP29);
const sl29 = new Float32Array(SP29);
let torchX = 0, torchY = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N29; i++) {
    wx29[i] = Math.random() * W; wy29[i] = Math.random() * H;
    wsz29[i] = 1.1 + Math.random() * 1.4; wph29[i] = Math.random() * 6.283;
  }
  for (let i = 0; i < SP29; i++) sl29[i] = 0;
  n29 = N29;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n29 = Math.max(1800, Math.min(N29, pc));
  for (let i = 0; i < n29; i++) {
    const pi = ((i * pc / n29) | 0) % pc;
    wtx29[i] = blockGx + g.px[pi] + rnd(-0.8, 0.8);
    wty29[i] = blockGy + g.py[pi] + rnd(-0.8, 0.8);
    word29[i] = pi / pc;              /* 笔画顺序：0 字头 → 1 字尾 */
    wtm29[i] = 0;
    wx29[i] = wtx29[i] + rnd(-40, 40);
    wy29[i] = wty29[i] + rnd(-40, 40);
  }
  torchP = 0; arcF = 0;
}

function mechEvent(k, first) {
  arcF = first ? 1.6 : 1;
  cam.ox = (k % 2 ? 1 : -1) * (first ? 30 : 16);
  cam.oy = 5;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  arcF *= Math.pow(0.02, dt);
  cam.ox *= Math.pow(0.02, dt);
  cam.oy *= Math.pow(0.04, dt);
  /* 焊枪进度：按句内时间推到 1 */
  const prog = clamp01((T - lineT) / Math.max(1.2, lineDur * 0.95));
  torchP = prog;
  const cool = Math.exp(-dt / 2.6);
  for (let i = 0; i < n29; i++) {
    /* 焊枪沿笔画顺序推进；枪口附近的点被烧到 1，然后冷却 */
    const d = torchP - word29[i];
    if (d >= 0) {
      const heat = d < 0.045 ? 1 : Math.exp(-d * 22);
      if (heat > wtm29[i]) wtm29[i] = heat;
      /* 刚焊上的地方往落点收一点（焊缝成形） */
      const k = Math.min(1, dt * 6);
      wx29[i] += (wtx29[i] - wx29[i]) * k;
      wy29[i] += (wty29[i] - wy29[i]) * k;
    }
    wtm29[i] *= cool;
    if (wtm29[i] < 0.06 && d > 0.05) {
      /* 冷下来的焊道留一道很淡的灰 */
      wtm29[i] = Math.max(wtm29[i], 0.05);
    }
    if (d >= -0.02 && d < 0.02) { torchX = wx29[i]; torchY = wy29[i]; }
  }

  for (let i = 0; i < SP29; i++) {
    if (sl29[i] <= 0) continue;
    svy29[i] += 720 * dt;
    sx29[i] += svx29[i] * dt; sy29[i] += svy29[i] * dt;
    sl29[i] -= dt * 1.1;
    if (sy29[i] > H + 10) sl29[i] = 0;
  }
  if (arcF > 0.4) {
    for (let i = 0; i < SP29; i++) {
      if (sl29[i] > 0 || Math.random() > 0.35) continue;
      sx29[i] = torchX + rnd(-6, 6); sy29[i] = torchY + rnd(-6, 6);
      svx29[i] = rnd(-220, 220); svy29[i] = rnd(-320, -40);
      sl29[i] = rnd(0.5, 1.1);
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 焊枪的电弧光（预烘的小光斑用 two rect 近似，避免贴图循环） */
  if (L) {
    const tx = pjX(torchX, torchY), ty = pjY(torchX, torchY);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,240,210,0.10)';
    ctx.beginPath();
    ctx.rect(tx - 26 * z, ty - 26 * z, 52 * z, 52 * z);
    ctx.fill();

    /* 三档：冷焊道 / 暗红 / 橙 / 白热 */
    for (let pass = 0; pass < 4; pass++) {
      if (pass === 0) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(96,104,118,0.30)'; }
      else if (pass === 1) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(170,48,30,0.7)'; }
      else if (pass === 2) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,120,40,0.7)'; }
      else { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,244,214,0.95)'; }
      ctx.beginPath();
      for (let i = 0; i < n29; i++) {
        const t = wtm29[i];
        const band = t > 0.7 ? 3 : t > 0.34 ? 2 : t > 0.12 ? 1 : 0;
        if (band !== pass) continue;
        const px = pjX(wx29[i], wy29[i]), py = pjY(wx29[i], wy29[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const s = wsz29[i] * (t > 0.7 ? 1.9 : 1.15) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }

  /* 火花：速度拉伸 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,214,150,0.9)';
  ctx.beginPath();
  for (let i = 0; i < SP29; i++) {
    if (sl29[i] <= 0) continue;
    const px = pjX(sx29[i], sy29[i]), py = pjY(sx29[i], sy29[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const vx = svx29[i] * 0.006, vy = svy29[i] * 0.006;
    const s = 1.2 + sl29[i] * 1.4;
    ctx.rect(px - s * 0.5 - vx * 6, py - s * 0.5 - vy * 6, s + Math.abs(vx) * 8, s + Math.abs(vy) * 8);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

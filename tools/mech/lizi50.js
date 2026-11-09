/* lizi50 · 引力波涟漪 · gravity-wave
   时空被一下一下压出涟漪：一张网格被两道波拉扯，字形上的粒子也被同样的波推着，
   **字是两道涟漪的干涉稳定点** —— 波过去时字在抖，波峰相消的地方字最清楚。
   AE：冲击帧 + 变焦 + 定向震动。 */

const N50 = 5200;
const wx50 = new Float32Array(N50), wy50 = new Float32Array(N50);
const wtx50 = new Float32Array(N50), wty50 = new Float32Array(N50);
const won50 = new Int16Array(N50), wat50 = new Float32Array(N50);
const wsz50 = new Float32Array(N50), wph50 = new Float32Array(N50);
let n50 = 0, wave50 = 0, sx50 = 0, sy50 = 0;
const GW50 = 26, GH50 = 16;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N50; i++) {
    wx50[i] = Math.random() * W; wy50[i] = Math.random() * H;
    wsz50[i] = 1.1 + Math.random() * 1.5;
    wph50[i] = Math.random() * 6.283;
  }
  n50 = N50;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n50 = Math.max(2000, Math.min(N50, Math.round(pc * 1.45)));
  for (let i = 0; i < n50; i++) {
    const pi = ((i * pc / n50) | 0) % pc;
    wtx50[i] = blockGx + g.px[pi] + rnd(-1, 1);
    wty50[i] = blockGy + g.py[pi] + rnd(-1, 1);
    won50[i] = g.own[pi];
    wat50[i] = use.at[g.own[pi]] || use.lineT;
    wx50[i] = wtx50[i]; wy50[i] = wty50[i];
  }
  sx50 = blockGx - W * 0.42; sy50 = blockGy + H * 0.02;
  wave50 = 1;
}

function mechEvent(k, first) {
  wave50 = first ? 1.8 : 1;
  cam.tz = Math.max(cam.tz, 1.02 + (first ? 0.035 : 0.018));
  cam.ox = (k % 2 ? -1 : 1) * (first ? 26 : 14);
  cam.oy = -6;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  wave50 *= Math.pow(0.06, dt);
  cam.ox *= Math.pow(0.03, dt);
  cam.oy *= Math.pow(0.04, dt);
  /* 两道波：一道从左边源点扩散，一道从右边（相位相反） */
  const r1 = T * 320, r2 = T * 320 + 90;
  const s2x = blockGx + W * 0.42, s2y = blockGy - H * 0.02;
  for (let i = 0; i < n50; i++) {
    if (T < wat50[i] - 0.5) continue;
    const d1 = Math.hypot(wtx50[i] - sx50, wty50[i] - sy50);
    const d2 = Math.hypot(wtx50[i] - s2x, wty50[i] - s2y);
    const a1 = Math.sin((d1 - r1) * 0.028) * Math.exp(-Math.abs(d1 - r1) / 260);
    const a2 = Math.sin((d2 - r2) * 0.028 + 3.1416) * Math.exp(-Math.abs(d2 - r2) / 260);
    const amp = (a1 + a2) * 9 * (0.5 + wave50 * 0.5);
    /* 径向位移，字被波推着抖 */
    const ux = (wtx50[i] - sx50) / (d1 + 1), uy = (wty50[i] - sy50) / (d1 + 1);
    wx50[i] += (wtx50[i] + ux * amp - wx50[i]) * Math.min(1, dt * 9);
    wy50[i] += (wty50[i] + uy * amp - wy50[i]) * Math.min(1, dt * 9);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  const r1 = T * 320;
  const s2x = blockGx + W * 0.42;

  /* 时空网格：被波压弯的线 */
  ctx.strokeStyle = 'rgba(130,160,220,0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cw = W / GW50, chh = H / GH50;
  for (let j = 0; j <= GH50; j++) {
    for (let i = 0; i <= GW50; i++) {
      const x = i * cw, y = j * chh;
      const d1 = Math.hypot(x - sx50, y - sy50) + 1;
      const d2 = Math.hypot(x - s2x, y - sy50) + 1;
      const a1 = Math.sin((d1 - r1) * 0.028) * Math.exp(-Math.abs(d1 - r1) / 300);
      const a2 = Math.sin((d2 - r1 - 90) * 0.028 + 3.1416) * Math.exp(-Math.abs(d2 - r1 - 90) / 300);
      const amp = (a1 + a2) * 7;
      const px = x + (x - sx50) / d1 * amp, py = y + (y - sy50) / d1 * amp;
      if (i === 0) ctx.moveTo(pjX(px, py), pjY(px, py));
      else if (i < GW50) ctx.lineTo(pjX(px, py), pjY(px, py));
      if (i === GW50) ctx.lineTo(pjX(px, py), pjY(px, py));
    }
  }
  for (let i = 0; i <= GW50; i++) {
    for (let j = 0; j <= GH50; j++) {
      const x = i * cw, y = j * chh;
      const d1 = Math.hypot(x - sx50, y - sy50) + 1;
      const d2 = Math.hypot(x - s2x, y - sy50) + 1;
      const a1 = Math.sin((d1 - r1) * 0.028) * Math.exp(-Math.abs(d1 - r1) / 300);
      const a2 = Math.sin((d2 - r1 - 90) * 0.028 + 3.1416) * Math.exp(-Math.abs(d2 - r1 - 90) / 300);
      const amp = (a1 + a2) * 7;
      const px = x + (x - sx50) / d1 * amp, py = y + (y - sy50) / d1 * amp;
      if (j === 0) ctx.moveTo(pjX(px, py), pjY(px, py));
      else ctx.lineTo(pjX(px, py), pjY(px, py));
    }
  }
  ctx.stroke();

  /* 字：粒子被波推着抖，靠亮度分两档 */
  if (L) {
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0
        ? `rgba(${Math.min(255, ar - 30)},${Math.min(255, ag - 24)},${Math.min(255, ab + 20)},0.35)`
        : `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 34)},${Math.min(255, ab + 20)},0.95)`;
      ctx.beginPath();
      for (let i = 0; i < n50; i++) {
        if (T < wat50[i] - 0.5) continue;
        if ((i % 2 === 0) !== (pass === 1)) continue;
        const px = pjX(wx50[i], wy50[i]), py = pjY(wx50[i], wy50[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const s = wsz50[i] * (pass ? 1.6 : 1.2) * z;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }
}

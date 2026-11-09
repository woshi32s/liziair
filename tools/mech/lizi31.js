/* lizi31 · 灰烬复燃 · ember-reignite
   烧焦的纸上，余烬按字的位置重新亮起来：每个字被唱到，那一片灰里就有火从内部
   透出来，把笔画烧成金红的裂缝；唱完又慢慢暗回去，只剩一点点暗红在呼吸。
   AE：顿帧 + 呼吸（整片余烬一起明灭）+ 缓推。 */

const N31 = 6400;
const gx31 = new Float32Array(N31), gy31 = new Float32Array(N31);
const gtx31 = new Float32Array(N31), gty31 = new Float32Array(N31);
const gtm31 = new Float32Array(N31), gown31 = new Float32Array(N31);
const gsz31 = new Float32Array(N31), gph31 = new Float32Array(N31);
let n31 = 0, breath31 = 0;
let ashCv31 = null;
const EM31 = 220;
const ex31 = new Float32Array(EM31), ey31 = new Float32Array(EM31);
const evy31 = new Float32Array(EM31), el31 = new Float32Array(EM31);

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N31; i++) {
    gx31[i] = Math.random() * W; gy31[i] = Math.random() * H;
    gsz31[i] = 1.1 + Math.random() * 1.5;
    gph31[i] = Math.random() * 6.283;
    gtm31[i] = 0;
  }
  for (let i = 0; i < EM31; i++) el31[i] = 0;
  n31 = N31;

  /* 烧焦的纸：黑褐底 + 炭化的焦边 + 纸纤维 */
  if (!ashCv31) ashCv31 = document.createElement('canvas');
  ashCv31.width = Math.max(2, Math.round(W / 2));
  ashCv31.height = Math.max(2, Math.round(H / 2));
  const ac = ashCv31.getContext('2d');
  const bw = ashCv31.width, bh = ashCv31.height;
  const g = ac.createRadialGradient(bw * 0.5, bh * 0.48, 0, bw * 0.5, bh * 0.5, Math.max(bw, bh) * 0.78);
  g.addColorStop(0, '#17110d');
  g.addColorStop(0.5, '#100b09');
  g.addColorStop(1, '#070505');
  ac.fillStyle = g; ac.fillRect(0, 0, bw, bh);
  ac.strokeStyle = 'rgba(120,80,50,0.10)';
  ac.lineWidth = 1;
  for (let k = 0; k < 60; k++) {
    let x = Math.random() * bw, y = Math.random() * bh;
    ac.beginPath(); ac.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x += rnd(-24, 24); y += rnd(-12, 12); ac.lineTo(x, y); }
    ac.stroke();
  }
  ac.fillStyle = 'rgba(190,120,70,0.05)';
  ac.beginPath();
  for (let i = 0; i < 2600; i++) ac.rect(Math.random() * bw, Math.random() * bh, 1, 1);
  ac.fill();
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n31 = Math.max(2000, Math.min(N31, Math.round(pc * 1.35)));
  for (let i = 0; i < n31; i++) {
    const pi = ((i * pc / n31) | 0) % pc;
    gtx31[i] = blockGx + g.px[pi] + rnd(-1.0, 1.0);
    gty31[i] = blockGy + g.py[pi] + rnd(-1.0, 1.0);
    gown31[i] = g.own[pi];
    gtm31[i] = use.at[g.own[pi]] || use.lineT;
    gx31[i] = gtx31[i] + rnd(-6, 6);
    gy31[i] = gty31[i] + rnd(-6, 6);
  }
}

function mechEvent(k, first) {
  breath31 = first ? 1.8 : 1.1;
  cam.tz = Math.max(cam.tz, 1.03);
  cam.oy = -4;
  for (let i = 0; i < EM31; i++) {
    if (Math.random() < 0.4) {
      const c = (Math.random() * n31) | 0;
      ex31[i] = gx31[c]; ey31[i] = gy31[c];
      evy31[i] = rnd(-70, -25); el31[i] = rnd(0.5, 1.2);
    }
  }
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  breath31 *= Math.pow(0.07, dt);
  cam.oy *= Math.pow(0.05, dt);
  const br = 0.72 + 0.28 * Math.sin(T * 1.7) + breath31 * 0.5;
  for (let i = 0; i < n31; i++) {
    /* 余烬温度：唱到就 1，之后慢慢灭，但永不完全灭（还有暗红呼吸） */
    const cg = charGlow[gown31[i]] || 0;
    const want = 0.1 + cg * 0.95;
    gtm31[i] += (want - gtm31[i]) * Math.min(1, dt * 3.2);
    /* 余烬在灰下轻轻浮动 */
    gx31[i] += (gtx31[i] - gx31[i]) * Math.min(1, dt * 5) + Math.sin(T * 1.4 + gph31[i]) * 2.2 * dt;
    gy31[i] += (gty31[i] - gy31[i]) * Math.min(1, dt * 5) - 1.6 * dt * gtm31[i];
  }
  for (let i = 0; i < EM31; i++) {
    if (el31[i] <= 0) continue;
    ey31[i] += evy31[i] * dt;
    ex31[i] += Math.sin(T * 2 + i) * 22 * dt;
    evy31[i] += 14 * dt;
    el31[i] -= dt * 0.8;
  }
  void br;
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  if (ashCv31) ctx.drawImage(ashCv31, 0, 0, W, H);

  /* 三档余烬：暗红 / 橙 / 金白 */
  if (L) {
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 0) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(96,30,18,0.55)'; }
      else if (pass === 1) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,96,34,0.52)'; }
      else { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,222,160,0.9)'; }
      ctx.beginPath();
      for (let i = 0; i < n31; i++) {
        const t = gtm31[i];
        const band = t > 0.72 ? 2 : t > 0.34 ? 1 : 0;
        if (band !== pass) continue;
        const px = pjX(gx31[i], gy31[i]), py = pjY(gx31[i], gy31[i]);
        if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
        const fl = 0.75 + 0.25 * Math.sin(T * 7 + gph31[i]);
        const s = gsz31[i] * (t > 0.72 ? 1.7 : 1.15) * z * fl;
        ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
      }
      ctx.fill();
    }
  }

  /* 飘起来的火星 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,180,96,0.8)';
  ctx.beginPath();
  for (let i = 0; i < EM31; i++) {
    if (el31[i] <= 0) continue;
    const px = pjX(ex31[i], ey31[i]), py = pjY(ex31[i], ey31[i]);
    if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
    const s = (1.1 + el31[i] * 1.6) * z;
    ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

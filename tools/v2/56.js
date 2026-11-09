/* ===== lizi56 · 沙漏 · hourglass —— PHYSICS =====
   沙粒从上方落下，按"唱到哪个字"依次落定，在下仓堆成字；上仓的沙面随进度变薄。
   玻璃体是标准沙漏轮廓（上罩 / 上锥 / 颈环 / 下锥 / 下罩），描边 + 一道内部反光。
   命中时颈口一抖（定向震动）。                                                   */

let g56inited = 0, g56shake = 0, g56fall = 0;
const g56x = new Float32Array(VN), g56y = new Float32Array(VN), g56v = new Float32Array(VN);
const g56on = new Uint8Array(VN);

function mechUpdate(dt, T) {
  if (!g56inited) {
    g56inited = 1;
    for (let i = 0; i < VN; i++) { g56x[i] = vtx[i]; g56y[i] = -H * 0.34; g56v[i] = 0; g56on[i] = 0; }
  }
  if (g56shake > 0) g56shake = Math.max(0, g56shake - dt * 3.2);
  const grav = 2100;
  let falling = 0;
  for (let i = 0; i < vn; i++) {
    const gl = charGlow[von[i]] || 0;
    /* 唱到这个字 → 放开这颗粒子（带一点随机延迟，像流沙） */
    if (!g56on[i]) {
      if (gl > 0.05) { g56on[i] = 1; g56y[i] = -H * 0.30 - Math.random() * 40; g56v[i] = 120 + Math.random() * 220; }
      else { g56x[i] = vtx[i] * 0.62; g56y[i] = -H * 0.34 + (i % 53) * 0.7; g56on[i] = 0; continue; }
    }
    /* 自由落体 + 向目标 x 收拢，落到字位停住 */
    if (g56y[i] < vty[i]) {
      g56v[i] += grav * dt;
      g56y[i] += g56v[i] * dt;
      g56x[i] += (vtx[i] - g56x[i]) * Math.min(1, dt * 3.2);
      if (g56y[i] >= vty[i]) { g56y[i] = vty[i]; g56v[i] = 0; }
      falling++;
    } else { g56x[i] = vtx[i]; g56y[i] = vty[i]; }
  }
  g56fall += (falling / Math.max(1, vn) - g56fall) * Math.min(1, dt * 4);
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.4);
}

function mechEvent(k, first) { g56shake = 1; vPulse = 1; if (first) camShake(0.2, 1, 8); }

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  const cx = pjX(blockGx, blockGy), cy = pjY(blockGx, blockGy);
  const sh = g56shake * 2.0 * Math.sin(T * 62);
  const halfW = 150 * z, topY = H * 0.10, botY = H * 0.29, neck = (H * 0.10 + H * 0.29) / 2;

  /* ---------- 玻璃体 ---------- */
  ctx.strokeStyle = 'rgba(146,176,214,0.34)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  /* 上罩 + 上锥 */
  ctx.moveTo(cx - halfW * 0.62, topY - 26 * z); ctx.lineTo(cx + halfW * 0.62, topY - 26 * z);
  ctx.moveTo(cx - halfW, topY); ctx.lineTo(cx - 16 * z, neck);
  ctx.moveTo(cx + halfW, topY); ctx.lineTo(cx + 16 * z, neck);
  /* 下锥 + 下罩 */
  ctx.moveTo(cx - 16 * z, neck); ctx.lineTo(cx - halfW, botY);
  ctx.moveTo(cx + 16 * z, neck); ctx.lineTo(cx + halfW, botY);
  ctx.moveTo(cx - halfW * 0.62, botY + 26 * z); ctx.lineTo(cx + halfW * 0.62, botY + 26 * z);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(190,220,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.70, topY + 10 * z); ctx.lineTo(cx - 34 * z, neck - 20 * z);
  ctx.stroke();

  /* ---------- 上仓残沙（随进度变薄） ---------- */
  const pileY = topY + 16 * z;
  ctx.globalAlpha = 0.35; ctx.fillStyle = 'rgb(206,178,132)';
  ctx.beginPath();
  ctx.rect(cx - halfW * 0.86, pileY, halfW * 1.72, 8 * z);
  ctx.fill();
  ctx.globalAlpha = 1;

  /* ---------- 沙粒 ---------- */
  for (let i = 0; i < vn; i++) {
    vsx[i] = pjX(blockGx + g56x[i], blockGy + g56y[i] + sh);
    vsy[i] = pjY(blockGx + g56x[i], blockGy + g56y[i] + sh);
    vss[i] = 1;
    const landed = g56y[i] >= vty[i] - 0.5;
    const gl = charGlow[von[i]] || 0;
    vlum[i] = landed ? clamp01(0.42 + 0.5 * gl) : 0.20;
  }
  ctx.globalAlpha = 0.45; ctx.fillStyle = 'rgb(160,138,104)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] > 0.3) continue;
    const r = 1.5;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 0.92; ctx.fillStyle = 'rgb(226,200,158)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.3 || vlum[i] > 0.62) continue;
    const r = 2.5;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgb(255,246,224)';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) {
    if (vlum[i] <= 0.62) continue;
    const r = 1.6;
    ctx.rect(vsx[i] - r, vsy[i] - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}




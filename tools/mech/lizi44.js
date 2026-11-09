/* lizi44 · 离心分离 · centrifuge
   混合物在离心机里按密度分层，**字是分层之后的那道界面**：
   字形被卷到一个转动的圆环上，粒子按密度落在不同的半径上，界面处最亮。
   AE：环绕运镜（转子在转）+ 透镜滚转 + 顿帧。 */

const N44 = 6000;
const cx44 = new Float32Array(N44), cy44 = new Float32Array(N44);
const cx0 = new Float32Array(N44), cy0 = new Float32Array(N44);
const crad44 = new Float32Array(N44), cang44 = new Float32Array(N44);
const cden44 = new Float32Array(N44), cown44 = new Float32Array(N44);
const cat44 = new Float32Array(N44), csz44 = new Float32Array(N44);
let n44 = 0, spin44 = 0, baseR44 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N44; i++) {
    cx44[i] = Math.random() * W; cy44[i] = Math.random() * H;
    csz44[i] = 1.1 + Math.random() * 1.5;
  }
  n44 = N44;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n44 = Math.max(2200, Math.min(N44, Math.round(pc * 1.5)));
  baseR44 = Math.min(W, H) * 0.20;
  spin44 = 0;
  for (let i = 0; i < n44; i++) {
    const pi = ((i * pc / n44) | 0) % pc;
    const gx = g.px[pi], gy = g.py[pi];
    /* 粒子按密度分层的偏移量：界面（中密度）正好落在字位上 */
    cang44[i] = Math.atan2(gy, gx) + Math.PI;
    crad44[i] = (cden44[i] - 0.5) * 54;
    cown44[i] = g.own[pi];
    cat44[i] = use.at[g.own[pi]] || use.lineT;
    cx0[i] = blockGx + gx; cy0[i] = blockGy + gy;
    cx44[i] = cx0[i] + Math.cos(cang44[i]) * crad44[i];
    cy44[i] = blockGy + gy + Math.sin(cang44[i]) * crad44[i] * 0.55;
    void cx0; void cy0;
  }
}

function mechEvent(k, first) {
  spin44 += (k % 2 ? 1 : -1) * (first ? 0.5 : 0.22);
  cam.vrot += (k % 2 ? 1 : -1) * (first ? 0.4 : 0.2);
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  spin44 *= Math.pow(0.35, dt);
  const rot = T * 0.5 + spin44;
  for (let i = 0; i < n44; i++) {
    if (T < cat44[i] - 0.5) continue;
    /* 离心：按密度分到不同半径，界面（中密度）最靠里 */
    const a = cang44[i] + spin44 * 0.6 + rot * 0.25;
    const off = crad44[i] * (0.86 + 0.14 * Math.sin(T * 0.8 + i * 0.01));
    const tx = cx0[i] + Math.cos(a) * off;
    const ty = cy0[i] + Math.sin(a) * off * 0.55;
    const k = Math.min(1, dt * 3.4);
    cx44[i] += (tx - cx44[i]) * k;
    cy44[i] += (ty - cy44[i]) * k;
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 转子的刻线 */
  const rot = T * 0.5 + spin44;
  ctx.strokeStyle = 'rgba(150,170,210,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 1; k <= 4; k++) {
    const rr = baseR44 * (0.8 + k * 0.24);
    const cx = pjX(W / 2, H * 0.5), cy = pjY(W / 2, H * 0.5);
    ctx.moveTo(cx + rr * 1.6 * z, cy);
    ctx.ellipse(cx, cy, rr * 1.6 * z, rr * 0.52 * z, 0, 0, 6.2832);
  }
  for (let k = 0; k < 12; k++) {
    const a = rot * 0.35 + k * 0.52;
    const cx = pjX(W / 2, H * 0.5), cy = pjY(W / 2, H * 0.5);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * baseR44 * 2.2 * z, cy + Math.sin(a) * baseR44 * 0.7 * z);
  }
  ctx.stroke();

  /* 粒子：按密度三档（界面亮） */
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 2
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 44)},${Math.min(255, ab + 30)},1)`
      : pass === 1
        ? `rgba(${Math.min(255, ar + 4)},${Math.min(255, ag + 16)},${Math.min(255, ab + 10)},0.62)`
        : 'rgba(70,90,120,0.35)';
    ctx.beginPath();
    for (let i = 0; i < n44; i++) {
      const dd = Math.abs(cden44[i] - 0.5);
      const band = dd < 0.18 ? 2 : dd < 0.34 ? 1 : 0;
      if (band !== pass) continue;
      if (T < cat44[i] - 0.5) continue;
      const px = pjX(cx44[i], cy44[i]), py = pjY(cx44[i], cy44[i]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = csz44[i] * (pass === 2 ? 2.6 : 1.25) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
}

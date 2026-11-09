/* lizi35 · 静电植绒 · flocking
   绒毛躺在底布上。电场一加，绒毛被**立起来**，立得最直的那批正好落在字形笔画上；
   唱完电场撤掉，绒毛又倒回去。字 = 立起来那批绒毛的顶端。
   AE：环绕运镜（相机绕字块缓慢公转）+ 顿帧 + 抽帧。 */

const N35 = 6200;
const nx35 = new Float32Array(N35), ny35 = new Float32Array(N35);
const ntx35 = new Float32Array(N35), nty35 = new Float32Array(N35);
const nup35 = new Float32Array(N35), nown35 = new Float32Array(N35);
const nat35 = new Float32Array(N35), nsz35 = new Float32Array(N35);
const nph35 = new Float32Array(N35);
let n35 = 0, field35 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N35; i++) {
    nx35[i] = Math.random() * W; ny35[i] = Math.random() * H;
    nup35[i] = 0; nsz35[i] = 3.2 + Math.random() * 3.4;
    nph35[i] = Math.random() * 6.283;
  }
  n35 = N35;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n35 = Math.max(2200, Math.min(N35, Math.round(pc * 1.4)));
  for (let i = 0; i < n35; i++) {
    const pi = ((i * pc / n35) | 0) % pc;
    ntx35[i] = blockGx + g.px[pi] + rnd(-1.2, 1.2);
    nty35[i] = blockGy + g.py[pi] + rnd(-1.2, 1.2);
    nown35[i] = g.own[pi];
    nat35[i] = use.at[g.own[pi]] || use.lineT;
    nx35[i] = ntx35[i] + rnd(-6, 6); ny35[i] = nty35[i] + rnd(-6, 6);
    nup35[i] = 0.3 + Math.random() * 0.2;
  }
  field35 = 1;
}

function mechEvent(k, first) {
  field35 = first ? 1.8 : 1.15;
  cam.vrot += (k % 2 ? 1 : -1) * (first ? 0.6 : 0.3);
  cam.oy = 0;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  field35 *= Math.pow(0.05, dt);
  /* 环绕：相机绕字块走一个慢椭圆（公转），同时轻微滚转 */
  const orb = T * 0.17;
  cam.ox = Math.cos(orb) * 22;
  cam.oy = Math.sin(orb * 1.4) * 10;
  const f = 1 + field35 * 0.7;
  for (let i = 0; i < n35; i++) {
    const age = T - nat35[i];
    /* 电场越强、越轮到这个字，绒毛立得越直 */
    const want = age < 0 ? 0.15 : Math.min(1, 0.55 + field35 * 0.35 + (charGlow[nown35[i]] || 0) * 0.4);
    nup35[i] += (want - nup35[i]) * Math.min(1, dt * (3.2 * f));
    /* 立起来的过程中绒毛根部被拉向落点 */
    nx35[i] += (ntx35[i] - nx35[i]) * Math.min(1, dt * 3);
    ny35[i] += (nty35[i] - ny35[i]) * Math.min(1, dt * 3);
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 底布：一层暗绒面 */
  ctx.fillStyle = 'rgba(26,24,30,0.0)';

  /* 绒毛：用"横躺 → 竖立"的矩形插值表现；两档（躺着的暗、立着的亮） */
  for (let pass = 0; pass < 2; pass++) {
    const stand = pass === 1;
    ctx.fillStyle = stand
      ? `rgba(${Math.min(255, ar + 40)},${Math.min(255, ag + 34)},${Math.min(255, ab + 26)},0.9)`
      : 'rgba(70,66,78,0.5)';
    ctx.beginPath();
    for (let i = 0; i < n35; i++) {
      const up = nup35[i];
      if ((up > 0.55) !== stand) continue;
      const px = pjX(nx35[i], ny35[i]), py = pjY(nx35[i], ny35[i]);
      if (px < -14 || px > W + 14 || py < -14 || py > H + 14) continue;
      const L = nsz35[i] * z;
      const lean = Math.sin(T * 1.4 + nph35[i]) * 0.18;
      /* 长度 L 的绒毛：竖直分量 = L*up，水平分量 = L*(1-up) 的横向抖动 */
      const vx2 = (1 - up) * L * 0.9 + lean * L;
      const vy2 = -up * L;
      const x0 = px - vx2 * 0.5, y0 = py;
      const w = Math.max(0.9, Math.abs(vx2) + 1);
      const h = Math.max(0.9, Math.abs(vy2) + 1);
      ctx.rect(x0, Math.min(y0, y0 + vy2), w, h);
    }
    ctx.fill();
  }

  /* 电场：几条竖立的等势线，隔一段时间闪一下（抽帧） */
  if (field35 > 0.15) {
    const q = Math.floor(T * 16) % 2;
    ctx.strokeStyle = `rgba(${Math.min(255, ar + 60)},${Math.min(255, ag + 70)},${Math.min(255, ab + 90)},${(0.06 + q * 0.04) * Math.min(1, field35)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 7; k++) {
      const x = W * (0.15 + k * 0.117);
      ctx.moveTo(pjX(x, H * 0.05), pjY(x, H * 0.05));
      ctx.lineTo(pjX(x + 10, H * 0.95), pjY(x + 10, H * 0.95));
    }
    ctx.stroke();
  }
}

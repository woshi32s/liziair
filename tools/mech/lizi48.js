/* lizi48 · 定格悬浮 · bullet-time
   粒子从四周飞向字位，在**某一瞬间全部定格**，镜头绕着这团静止的粒子飞一圈；
   定格解除，粒子继续落位。字 = 半空中被冻结的那一层粒子。
   AE：子弹时间环绕（相机在三维里绕）+ 抽帧 + 冲击帧。 */

const N48 = 5200;
const bx48 = new Float32Array(N48), by48 = new Float32Array(N48);
const bz48 = new Float32Array(N48), bvx48 = new Float32Array(N48);
const bvy48 = new Float32Array(N48), bvz48 = new Float32Array(N48);
const btx48 = new Float32Array(N48), bty48 = new Float32Array(N48);
const bat48 = new Float32Array(N48), bsz48 = new Float32Array(N48);
const bst48 = new Uint8Array(N48);
let n48 = 0, freeze48 = 0, orbit48 = 0;

function mechResize() {
  if (!W || !H) return;
  for (let i = 0; i < N48; i++) {
    bx48[i] = Math.random() * W; by48[i] = Math.random() * H;
    bz48[i] = rnd(-1, 1);
    bvx48[i] = 0; bvy48[i] = 0; bvz48[i] = 0;
    bsz48[i] = 1.1 + Math.random() * 1.5;
    bst48[i] = 0;
  }
  n48 = N48;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  n48 = Math.max(2200, Math.min(N48, Math.round(pc * 1.4)));
  for (let i = 0; i < n48; i++) {
    const pi = ((i * pc / n48) | 0) % pc;
    btx48[i] = blockGx + g.px[pi] + rnd(-1, 1);
    bty48[i] = blockGy + g.py[pi] + rnd(-1, 1);
    bat48[i] = use.at[g.own[pi]] || use.lineT;
    bst48[i] = 0;
    /* 从画外飞进来 */
    const a = Math.random() * 6.283;
    bx48[i] = W / 2 + Math.cos(a) * W * 0.52;
    by48[i] = H * 0.46 + Math.sin(a) * H * 0.55;
    bz48[i] = rnd(-1, 1);
  }
}

function mechEvent(k, first) {
  /* 每句只在第一个词团命中时定格一次：逐字触发会让时间永远停住 */
  /* 在最后一批字落位时定格：字已经成形，镜头再绕着它飞 */
  if (k >= spans.length - 2) freeze48 = 0.7;
  orbit48 = 0;
  cam.oy = -4;
}

function mechUpdate(dt, T) {
  if (!L || dt <= 0) return;
  /* 定格：时间停住，镜头继续绕 */
  if (freeze48 > 0) {
    freeze48 -= dt;
    orbit48 += dt * 0.85;
    cam.rot = Math.sin(orbit48) * 0.22;
    cam.ox = Math.cos(orbit48 * 0.9) * 26;
    cam.oy = -4 + Math.sin(orbit48 * 1.3) * 8;
    return;
  }
  orbit48 *= Math.pow(0.4, dt);
  cam.rot *= Math.pow(0.3, dt);
  cam.ox *= Math.pow(0.1, dt);
  cam.oy *= Math.pow(0.1, dt);
  for (let i = 0; i < n48; i++) {
    if (bst48[i]) continue;
    if (T < bat48[i] - 0.6) continue;
    const dx = btx48[i] - bx48[i], dy = bty48[i] - by48[i];
    const d = Math.hypot(dx, dy);
    const near = d < 80;
    const kk = near ? 36 : 12;
    bvx48[i] += dx * kk * dt - bvx48[i] * (near ? 9.2 : 2) * dt;
    bvy48[i] += dy * kk * dt - bvy48[i] * (near ? 9.2 : 2) * dt;
    const sp = Math.hypot(bvx48[i], bvy48[i]);
    if (sp > 900) { const s = 900 / sp; bvx48[i] *= s; bvy48[i] *= s; }
    bx48[i] += bvx48[i] * dt; by48[i] += bvy48[i] * dt;
    bz48[i] += bvz48[i] * dt * 0.2;
    if ((d < 2.4 && sp < 120) || T > bat48[i] + 1.6) {
      bst48[i] = 1; bx48[i] = btx48[i]; by48[i] = bty48[i];
    }
  }
}

function mechDraw(T, z, pjX, pjY) {
  const [ar, ag, ab] = accent;
  /* 三维环绕：绕竖轴旋转，带一点透视 */
  const ca = Math.cos(cam.rot), sa = Math.sin(cam.rot);
  const proj = (x, y, zz) => {
    const dx = x - W / 2, dz = zz * 90;
    const rx = dx * ca + dz * sa;
    const rz = -dx * sa + dz * ca;
    const persp = 1 / (1 + rz * 0.00035);
    return [W / 2 + rx * persp, y + rz * 0.02];
  };

  /* 定格时的"时间切片"：一圈很淡的环 */
  if (freeze48 > 0) {
    ctx.strokeStyle = 'rgba(200,220,255,0.10)';
    ctx.lineWidth = 1.4;
    const cx = pjX(W / 2, H * 0.46), cy = pjY(W / 2, H * 0.46);
    ctx.beginPath();
    ctx.ellipse(cx, cy, W * 0.3 * z, H * 0.16 * z, 0, 0, 6.2832);
    ctx.stroke();
  }

  for (let pass = 0; pass < 2; pass++) {
    const near = pass === 1;
    ctx.fillStyle = near
      ? `rgba(${Math.min(255, ar + 44)},${Math.min(255, ag + 36)},${Math.min(255, ab + 22)},0.95)`
      : `rgba(${Math.min(255, ar - 40)},${Math.min(255, ag - 30)},${Math.min(255, ab + 6)},0.22)`;
    ctx.beginPath();
    for (let i = 0; i < n48; i++) {
      if (bst48[i] || T < bat48[i] - 0.6) continue;
      if ((bz48[i] > 0) !== near) continue;
      const p = proj(bx48[i], by48[i], bz48[i]);
      const px = pjX(p[0], p[1]), py = pjY(p[0], p[1]);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      const s = bsz48[i] * (near ? 1.6 : 1.2) * z;
      ctx.rect(px - s * 0.5, py - s * 0.5, s, s);
    }
    ctx.fill();
  }
}

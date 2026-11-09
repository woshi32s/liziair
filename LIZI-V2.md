# LIZI · 第二批重做规格（视觉升级）

> 这份是「第二批 lizi51-100 重做」的统一标准。写之前先读这一份 + `LIZI-PLAN.md` 里自己那一行。
> 现有 51-92 的机制方向可以保留，但**执行必须重做**：那批是 110-130 行的薄实现，
> 用户的原话是「有的效果不好」「不要省事」。参考标杆：`lizi02-arc-etch`（实体字 + 电弧 + 火花）、
> `lizi52-aurora`（层次 + 体积光）、`lizi51-relief`（3D 厚度）。

---

## 0 硬指标（checker 之外，缺一条就算没做完）

| # | 标准 | 怎么算过 |
|---|---|---|
| 1 | **整句一眼读完** | 看 `shots/lizi/<id>-3.png`：整行歌词能读出来，不缺笔画、不糊成团、不和背景同色 |
| 2 | **有重量/有打光** | 笔画至少 3 档明暗（核心亮/中间/暗边），有掠射光或体积光，不是一片均匀点阵 |
| 3 | **有明显镜头运动** | 3D 环绕（yaw/pitch 在变）或甩镜/滑动变焦/锁定追踪；对比 -2 和 -3 两帧，构图必须不同 |
| 4 | **有物理过程** | 中段帧能看出过程（飞溅/湍流/生长/轨道/冷凝），不是"字在原地抖" |
| 5 | **背景有层次** | 预烘的渐变 + 星尘/雾/光斑，不是纯黑画布 |
| 6 | **构图不塌** | 字在画面内、不贴边；行数多时自动换行后仍然完整 |

---

## 1 渲染配方（用 `tools/lizi-base.js` 提供的东西）

骨架已经给了：`W/H/ctx`、`cam`（x/y/z/tz/vz/rot/shake）、`AE`（freeze/flash）、`hitStop/flash/camShake`、
`L`（字形采样：`L.px/L.py/L.own/L.pc/L.n/L.charCx/L.charCy`）、`spans/charGlow/blockGx/blockGy/lineT/lineDur`、
`pjX(x,y)/pjY(x,y)`（相机平移+缩放+滚转+震动）、`accent`、`rnd/clamp01/now`。
机制文件只写 `mechResize / mechAssign / mechUpdate / mechDraw / mechEvent`（可选 `mechFs/mechStep`）。

### 1.1 实心笔画 + 三档明暗（解决"点阵感"）

```js
/* 每颗字粒子算一个光照值 lum 0..1，再分 3 档 batch 画 */
const B1 = 0.78, B2 = 0.52;              // 档位阈值
/* 档 0（核）: lum > B1, 亮色 + 大半径
   档 1（中）: lum > B2
   档 2（暗）: 其余
   每档：一次 beginPath + N 个 rect + 一次 fill */
```

- 点半径 `r = 1.5~2.4`（1440×810 下笔画才实）；`step` 保持 2（需要更实就让 `mechStep()` 返回 1.6）。
- **绝不逐颗改 `fillStyle`**（BRIEF §3A：掉到 18fps）。每帧 `fillStyle` 总数 ≤ 10。
- 字粒子和氛围粒子分开批：字用 `source-over`，火星/辉光用 `'lighter'`。

### 1.2 厚度：先画一层暗影再画亮面

```js
/* 阴影层：同批点整体偏移 (dx,dy)，暗色 alpha 0.3，一次 batch */
/* 亮面层：原位置按光照分档 */
```
一个偏移 2~4px 的暗层，立刻从"贴纸"变成"有厚度"。3D 类（浮雕/立方/隧道）用真 z 投影，不要用偏移凑。

### 1.3 2.5D 深度（3D 类必须）

```js
function p3(x, y, z, yaw, pit, f) {          // 返回 [X, Y, 缩放]
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  let X = x * cy + z * sy, Z = -x * sy + z * cy;
  const cp = Math.cos(pit), sp = Math.sin(pit);
  let Y = y * cp - Z * sp; Z = y * sp + Z * cp;
  const s = f / (f + Z);
  return [X * s, Y * s, s];
}
/* 用法：const [X, Y, s] = p3(gx, gy, pz[i], yaw, pit, 900);
        const sx = pjX(blockGx + X, blockGy + Y);
        const sy = pjY(blockGx + X, blockGy + Y);
        尺寸 = 基础尺寸 * s * camZ（camZ 用传入 mechDraw 的 z） */
```
每个字形点给一个 `pz`：由笔画 x 位置或低频噪声决定（±40 左右），加上每帧缓慢起伏 → 有体积。

### 1.4 打光

- **掠射扫光**：`mechResize` 里预烘一张白→透明的 linear gradient 贴图，每帧按 `T` 平移 `drawImage`，
  `globalCompositeOperation='lighter'`、`globalAlpha=0.10~0.18`。这一条最便宜、提升最明显。
- **边缘亮**：`lum` 里加 `0.35 * clamp01(朝光方向的法向)`，例如 `+0.3 * clamp01((gx*cos(k) + gy*sin(k)) / 320 + 0.5)`。
- **发光底色**：允许用 BRIEF §3G 的办法，把整行字 `fillText` 到离屏画布 + `shadowBlur` 一次，做柔光层垫在粒子**下面**，
  之后每帧只 blit 一次。字的主体仍然必须是粒子堆出来的。

### 1.5 背景

`mechResize()` 里预烘一张 1/2 分辨率画布：径向渐变（深底 + 中心微亮）+ 120~300 颗远景星尘 + 1~2 团柔光，
每帧 `drawImage` 一次铺满。**不要**在 `frame()` 里 `createRadialGradient`。

### 1.6 镜头

```js
/* 常驻慢环绕（3D 类）：*/
yaw += dt * 0.32;  pit = 0.16 * Math.sin(T * 0.21);
/* 命中时（mechEvent）：cam.tz = 1.10; cam.vrot += 0.6; camShake(1, .2, 12); hitStop(.04); */
/* 收尾回落：cam.tz += (1 - cam.tz) * dt * 2.4;（base 已经做了一部分） */
```
非 3D 类也要有镜头：视差层（远/中/近三层粒子按不同速率漂）+ 弹簧变焦。

### 1.7 事件与次级动作

`mechEvent(k, first)`：命中那一刻给字一次**径向冲击脉冲**（`pulse = 1` → 每帧衰减，粒子沿法向外推再弹回），
同时甩出火星/碎屑/雪/气泡（10~60 颗），并让背景粒子反向轻推。这是"次级动作"，比字自己抖高级得多。

---

### 1.8 可直接抄的「三档实心字」画法

```js
/* 每帧：先把字粒子算成屏幕坐标 + 光照 lit(0..1)，再分 3 档各画一次 */
function drawGlyphBands(sx, sy, sz, lit, n, r, rgb) {
  const bands = [
    { th: 0.80, a: 1.00, k: 1.00 },   /* 核：最亮、半径最大 */
    { th: 0.52, a: 0.55, k: 0.86 },
    { th: -1,   a: 0.26, k: 0.72 },   /* 暗边 */
  ];
  for (let b = 0; b < 3; b++) {
    const bd = bands[b], hi = b === 0 ? 1.01 : bands[b - 1].th;
    ctx.globalAlpha = bd.a;
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < n; i++) {
      const l = lit[i];
      if (l < bd.th || l >= hi) continue;
      const rr = r * bd.k * (sz ? sz[i] : 1);
      ctx.rect(sx[i] - rr, sy[i] - rr, rr * 2, rr * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
}
```
配合 §1.2 的暗影层（先 `ctx.globalAlpha=0.28; fillStyle='#000'` 偏移画一遍）→ 立刻有厚度。
每帧这是 3~4 次 `fillStyle`，远低于预算。

### 1.9 换句不能双描（实测 bug）

换句时**必须把旧句的粒子全部回收**（复用成新句的点，或把它们放到"消散/飞出"分支并且画得很淡）。
现在多张 `-2.png` 里中文出现**重影/双描**，就是旧粒子没回收、和新字形叠在一起。
验收时专门看 `-2.png`：不该有两层可读的字。

### 1.10 起手模板（整段拷到你的 mech 顶部，再改 PHYSICS）

这套已经把「实心笔画 + 厚度 + 扫光 + 3D 环绕 + 换句回收」都做好了，**你只改粒子的运动学**（按你的机制）。
名字都带 `v` 前缀，避免和 base 的 `cam/L/ctx` 等撞车。

```js
/* ===== v2 通用起手：实心字 + 厚度 + 扫光 + 环绕 ===== */
const VN = 5600;                                  /* 2000~9000 */
const vx = new Float32Array(VN), vy = new Float32Array(VN);   /* 当前设计坐标 */
const vz = new Float32Array(VN), vsc = new Float32Array(VN);
const vtx = new Float32Array(VN), vty = new Float32Array(VN); /* 目标字形点 */
const von = new Int16Array(VN);                   /* 归属字（0..L.n-1） */
const vlum = new Float32Array(VN);
const vsx = new Float32Array(VN), vsy = new Float32Array(VN), vss = new Float32Array(VN);
let vn = 0, vYaw = 0, vPit = 0, vPulse = 0, vLightCv = null;

function mechResize() {
  vLightCv = document.createElement('canvas');
  vLightCv.width = 512; vLightCv.height = 512;
  const g = vLightCv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 512, 512);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.48, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  vn = 0;
}

function mechAssign(use) {
  const g = use.g, pc = g.pc;
  if (!pc) { vn = 0; return; }
  vn = Math.min(VN, Math.max(2400, Math.round(pc * 1.25)));
  for (let i = 0; i < vn; i++) {
    const pi = (i * pc / vn) | 0;                  /* 等间隔，别用 i % pc */
    vtx[i] = g.px[pi]; vty[i] = g.py[pi];
    von[i] = g.own[pi];
    vz[i] = (Math.random() - 0.5) * 46;            /* 厚度 */
    vsc[i] = 1;
    vx[i] = vtx[i]; vy[i] = vty[i];                /* 旧粒子直接复用 → 不会双描 */
  }
  vPulse = 1;
}

function vBands(rgb, rBase) {
  const bands = [[0.78, 1.00, 1.00], [0.50, 0.55, 0.86], [-1, 0.26, 0.72]];
  for (let b = 0; b < 3; b++) {
    const lo = bands[b][0], al = bands[b][1], kk = bands[b][2], hi = b === 0 ? 1.01 : bands[b - 1][0];
    ctx.globalAlpha = al;
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.beginPath();
    let any = 0;
    for (let i = 0; i < vn; i++) {
      const l = vlum[i];
      if (l < lo || l >= hi) continue;
      const rr = rBase * kk * vss[i];
      ctx.rect(vsx[i] - rr, vsy[i] - rr, rr * 2, rr * 2);
      any++;
    }
    if (any) ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function mechUpdate(dt, T) {                       /* 物理：按机制改这里 */
  if (vPulse > 0) vPulse = Math.max(0, vPulse - dt * 2.6);
  for (let i = 0; i < vn; i++) {
    /* 默认：弹簧回到字形点，带一点过冲 */
    vx[i] += (vtx[i] - vx[i]) * Math.min(1, dt * 9);
    vy[i] += (vty[i] - vy[i]) * Math.min(1, dt * 9);
  }
}

function mechDraw(T, z, pjX, pjY) {
  if (!vn) return;
  vYaw = Math.sin(T * 0.31) * 0.32;
  vPit = 0.13 * Math.sin(T * 0.22 + 0.7);
  const cy = Math.cos(vYaw), sy = Math.sin(vYaw), cp = Math.cos(vPit), sp = Math.sin(vPit);
  for (let i = 0; i < vn; i++) {
    const Z0 = vz[i] * (1 + 0.2 * Math.sin(T * 1.6 + i * 0.013));
    let X1 = vx[i] * cy + Z0 * sy, Z1 = -vx[i] * sy + Z0 * cy;
    let Y1 = vy[i] * cp - Z1 * sp; Z1 = vy[i] * sp + Z1 * cp;
    const s = 820 / (820 + Z1);
    const dx = blockGx + X1 * s, dy = blockGy + Y1 * s;
    vsx[i] = pjX(dx, dy); vsy[i] = pjY(dx, dy); vss[i] = s;
    const lit = 0.42 + 0.34 * Math.sin(T * 0.85 - X1 / 230) + 0.24 * clamp01(-Z1 / 60);
    const gl = charGlow[von[i]] || 0;
    vlum[i] = clamp01(lit) * (0.62 + 0.38 * gl) + vPulse * 0.18;
  }
  /* 厚度：暗影层 */
  ctx.globalAlpha = 0.30; ctx.fillStyle = '#000';
  ctx.beginPath();
  for (let i = 0; i < vn; i++) { const r = 2.0 * vss[i]; ctx.rect(vsx[i] + 3, vsy[i] + 4, r * 2, r * 2); }
  ctx.fill();
  /* 实心三档 */
  vBands(accent.map((v) => Math.min(255, v * 0.55 + 190)), 2.1);
  /* 扫光 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.13;
  const ox = ((T * 110) % (W + 900)) - 700;
  const oz = 1 + (z - 1) * 0.5;
  ctx.drawImage(vLightCv, ox, -120, 760, 1000 * oz);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function mechEvent(k, first) {                     /* 命中：冲击脉冲 + 火星（按机制换） */
  vPulse = 1;
}
```

**改机制时**：只动 `mechUpdate`（运动学）、`mechDraw` 里粒子怎么组织（层/丝/轨道/帘）、配色和背景。
别把上面这套「三档 + 暗影 + 扫光 + 环绕」删掉 —— 那正是这一版要补的东西。
**每个形态必须有自己的性格**：配色、镜头路径（有的甩、有的滚、有的贴地飞）、背景意象都要不同，
不能大家都变成"同一套东西换了个运动"。

## 2 性能铁律（违反就掉帧，BRIEF §3 全部实测过）

- 粒子 **2000~9000**；全用 `rect`，**永远不用 `arc`**（19fps）。
- 每帧 `fillStyle` ≤ 10 次；不能逐颗设色。
- `getImageData / createRadialGradient / createLinearGradient / shadowBlur / ctx.filter` **不在 frame 里出现**。
- 逐颗 `drawImage` 禁止（软光斑一律预烘 + 少量 blit）。
- 总着墨面积 ≤ 3 个画布（粗算 `数量 × (2r)²`，想加颗数就减半径，平方关系）。
- 用 W/H 撒点的数组必须在 `mechResize()` 之后初始化（BRIEF §"三条最容易返工的坑"）。
- 索引单调（换句只前进）、`timing()` 里的重活提前 `lead` 秒做（base 已封装 `prepLine`，别自己再算）。

---

## 3 流程（每个形态都必须走完）

```powershell
cd E:\DSHdesktop\work\music-player
# 1) 写/改机制文件 tools/mech/liziNN.js
# 2) 构建（short/中文名 用 LIZI-PLAN.md 那一行）
node tools/lizi-make.mjs liziNN <short> <中文名> tools/mech/liziNN.js
# 3) 验收（会重新出 5 张截图）
node lizi-check.mjs liziNN
# 4) 必须肉眼验收
#    read_image shots/lizi/liziNN-<short>-3.png   ← 整句可读？有打光？有镜头？
#    read_image shots/lizi/liziNN-<short>-2.png   ← 中段有没有物理过程？
# 5) 不达标就改，回到 2)，**至少迭代 2 轮**
```

**判 fps 要看基线**：机器上还有别的会话在跑，基线会掉到 40 出头；判据是 `fps ≥ 基线 × 0.88`，
不要因为绝对 35fps 就以为写崩了（先看基线那一列）。

## 4 纪律

- **只碰** `tools/mech/liziNN.js` 和它构建出的 `public/stages/liziNN-<short>.html`。
- **不许改** `tools/lizi-base.js` / `tools/lizi-make.mjs` / `lizi-check.mjs` / `public/app.js` /
  `LIZI-PLAN.md` / 别的编号的 mech（注册和打 ✅ 由主会话统一做）。
- 不许起/停服务器（server 已在跑，端口看 `.port`）。
- 不许改机制概念（PLAN 表里那一行的机制要保持），要改的是**表现力**。
- 交付时报告：checker 最后一行 + 两张截图的真实画面描述 + 这一版比上一版强在哪。

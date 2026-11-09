# LIZI 系列 · 50 个新粒子歌词特效 · 开发手册

> 给每个会话读这一份就够了。看完直接开工，不要读 HANDOFF.md（30KB，白烧上下文）。

---

## 0. 一句话

`public/stages/liziNN-<英文短名>.html`，**一个文件一个效果**，50 个互不雷同。
粒子组成歌词、先用 YRC 逐字 + 中文分词驱动节奏、全程用镜头运镜制造动感。

---

## 1. 硬规矩（违反就是白干）

| ✅ 必须 | ❌ 禁止 |
|---|---|
| 单文件自包含（一个 canvas + 内联 JS） | 引 CDN / 外部字体 / 图片 |
| 图标用内联 SVG 或纯几何 | 用 emoji |
| 长句（30~40 字）要能自动折行 | 只按 7 个字的测试句排版 |
| 粒子**组成的是歌词字形** | 粒子只是背景装饰、字是 DOM/fillText 画上去的 |
| 每个文件机制不同 | 换个配色/换个数就当新效果 |

**特别强调**：字数必须由**粒子本身**堆出来。允许叠一层烘焙的文字辉光（见 §3 性能铁律 G），
但主体轮廓必须是粒子的形状。验收时我会数粒子，字是 fillText 直接画的一律打回。

---

## 2. 通信协议（照抄）

```js
const ping = () => { try { parent.postMessage({ __c100: 1, type: 'activity' }, '*'); } catch (_) {} };
addEventListener('pointermove', ping, { passive: true });
addEventListener('pointerdown', ping, { passive: true });
addEventListener('wheel', ping, { passive: true });
addEventListener('keydown', ping);
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') { e.preventDefault();
    try { parent.postMessage({ __c100: 1, type: 'key', payload: { key: 'Space' } }, '*'); } catch (_) {} }
}, true);

addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__c100 !== 1) return;
  if (d.type === 'init') {                       // {lines, accent}
    const p = d.payload || {};
    lines = (p.lines || []).slice().sort((a, b) => a.t - b.t);
    if (p.accent) accent = p.accent;             // [r,g,b] 封面主色
    /* 清掉你所有粒子/结构，重置时钟 */
  } else if (d.type === 'tick') {                // 每 66ms
    clockT = d.payload.time; clockAt = performance.now(); playing = !!d.payload.playing;
  } else if (d.type === 'beat') {                // {level, bpm}
    /* 踩拍必须**相干**（整场一起动），不要逐颗随机方向踢 */
  } else if (d.type === 'live') {                // {bpm, energy, bass, mid, treble} 可选
  }
});
try { parent.postMessage({ __c100: 1, type: 'ready' }, '*'); } catch (_) {}
```

`lines` 结构：`{ t, dur, text, chars? }`，`chars[i] = { t, c, d }` 是 **YRC 逐字绝对秒**。

---

## 3. 性能铁律（这一节最值钱，全部实测）

在 1440×810、`--disable-gpu` 软件渲染下量的真实数字：

| 做法 | 8400 颗粒子耗时 | 结论 |
|---|---|---|
| 逐颗粒子 `drawImage(软光斑)` | **78.3 ms** | ☠️ 绝对不能这样写 |
| 逐颗粒子 `drawImage`，降到 3000 颗 | 7.7 ms | 还是贵，且粒子不够 |
| **一次 `beginPath` + 8400 个 `rect` + 一次 `fill`** | **1.38 ms** | ✅ 唯一正解 |
| 全屏 `drawImage` 一张同尺寸贴图（blit） | 0.03 ms | ✅ 随便用 |
| `fillText` 一整行 84px 汉字 | 0.02 ms | ✅ 真免费，可以每帧画 |

### 所以：

**A. 粒子必须批处理。** 同一颜色/同一 alpha → 一次 `beginPath()`，几千个 `rect()`，一次 `fill()`。
按 2~4 个"色调档"分批（暗/中/亮），**绝不能逐颗设 `fillStyle`**（字符串拼接 + CSS 颜色解析 =
掉到 18fps，这是 001 踩过的坑）。`fillStyle` 每帧只允许设常量次（< 10 次）。

**B. 绝不要逐颗 `drawImage`。** 软光斑/光晕一律"预烘精灵 → 少量贴图"或改用 `rect`。
真要光晕，用 §G 的做法。

**C. 发光/雾/光斑这类"大而软"的东西**，全部**一次性预烘到离屏画布**，之后每帧只 `drawImage` 贴图。
预烘发生在：resize / 换句 / 换歌，**不在 frame() 里**。

**D. `getImageData` / `createRadialGradient` / `createLinearGradient` / `shadowBlur`
绝不出现在 frame() 里。** 三个都是毫秒级起步。

**E. 每帧 JS 总预算 ~6ms，rAF 目标 60fps。**
写完必须量：`node lizi-check.mjs liziNN`，**fps ≥ 50 才算过**。

**F. 索引单调 + 显示/酝酿分离**（三条铁律，001-065 全部踩过）：

```js
let curIdx = -1, brewIdx = -1, lastT = -1;
function timing(T) {
  if (!lines.length) return;
  if (T < lastT - 0.6) { curIdx = -1; brewIdx = -1; /* 清粒子 */ }   // 只有拖进度条才重置
  lastT = T;
  let c = curIdx;
  while (c + 1 < lines.length && T >= lines[c + 1].t) c++;            // 索引只前进
  if (c !== curIdx) {
    if (curIdx >= 0) releaseOld();      // 换句必须**释放**旧句占用的粒子
    curIdx = c; brewIdx = -1;
    if (curIdx >= 0) setupLine(curIdx);
  }
  /* 酝酿下一句：只在 lines[nx].t - lead 之后开始，别提前顶掉当前句 */
}
```

**G. 想要柔光/辉光，用这个（0.02ms，白送）：**
先 `fillText` 一整行字到离屏画布，`shadowBlur` 一次做出柔光，之后每帧 blit 这张贴图当"光晕层"，
上面再用粒子的 `rect` 堆出实体字形。**粒子仍然是字的形状**，光晕只是垫在下面的一层氛围。
这是唯一允许的"文字图层"，且必须叠在粒子层**下面**。

**I. 需要"墨累积变深 / 永久留痕"的效果时，别用逐颗 `drawImage` 往离屏画布上盖。**
实测（`_lizibench2.mjs`，1440×810 软件渲染，含真实合成）：
```
仅 blit 一张静态离屏贴图             0.29 ms
逐颗 drawImage 210 颗 + blit          3.70 ms   ← 慢，还会让 blit 变贵
逐颗 drawImage 210 颗（不 blit）       0.74 ms
batched rect 210 颗 + blit            1.46 ms   ← 正解
主画布直接 batch 9000 个 rect          2.15 ms
```
原因是逐颗 `drawImage` 进离屏 canvas 会触发**整张纹理重传**，后面 blit 它的时候就一起变贵。
所以"墨点/粉末/留痕"一律：**攒进数组 → 一帧一次 `beginPath` + N 个 `rect` + 一次 `fill`**，
颜色浓淡靠**分 2~4 个 alpha 档**（一个 `fill` 一个色），不靠逐颗设色。
多条 `rect` 重叠时自然加深，正好是湿墨/粉末该有的样子。

**J. 生成字形/布局这种一次性重活（`fillText` + `getImageData` + 上千次 `measureText`），
不要放在换句那一帧。** 实测一次 `sampleGlyph` 要 6~23ms，那就是一次肉眼可见的卡顿（p95 会到 100ms+）。
做法：提前 `lead` 秒（1.5s 左右）在**一个空闲帧**里把它算好存起来，换句时只做指针切换。
最简单的实现：在 `timing()` 的酝酿分支里调一次 `prepLine(next)`，结果放 `prepCache`，`curIdx` 切换时直接取。

**H. 粒子数 2000~9000 之间选。** 少于 2000 字会空，多于 9000 没意义（`rect` 便宜但物理循环不便宜）。

### 最重要的一条：真正的瓶颈是**填充面积（overdraw）**，不是绘制调用数

用真实 rAF 帧率量的（`_lizibench4.mjs`，1440×810 软件渲染，无其他负载）：

```
空帧                          61.7 fps   ← 天花板
blit 一张小贴图铺满屏           59.1 fps
3000 个 rect（主画布）          59.5 fps
6200 个 rect（主画布）          30.4 fps   ← 面积翻倍 → 帧率腰斩
6200 个 rect（1/4 小画布）       49.9 fps
6200 个 arc（1/4 小画布）        19.4 fps   ← arc 是灾难，永远不要用
物理 4000 次 sin/cos/sqrt       60.0 fps   ← 纯计算几乎免费
```

**结论：**
1. **算得再多也不卡，画得面积大才卡。** 物理循环里怎么写都行，绘制面积要抠。
2. 一帧的"总着墨面积"控制在 **2~3 个画布面积**以内就不掉帧（1440×810 约 3.5M 像素）。
   粗算：`个数 × (2r)²`。想加个数就减半径，两者是平方关系。
3. **`arc` 永远不要用**（19fps），一律 `rect`。
4. 粒子/墨点每帧重画的，**粒子数 × 单颗面积** 必须压住；能"画一次就永久留着"的
   （留痕、累积、堆积类）一律**烘到离屏画布**，之后每帧只 blit 一张。
5. `ctx.filter='blur()'` 也是逐帧全屏处理，实测吃掉 10 帧，**不要用**。
   要柔边就"画小 + 放大插值"，或者两级放大（低分辨率 → 中间分辨率 → 屏幕）插值两次。
6. `'lighter'` 混合模式比 `source-over` 贵；字的主体用 `source-over`，只给火星/辉光用 `lighter`。

### 验收时 fps 要按"当时的机器负载"折算

并行开工时会有好几个 headless Chrome 抢 CPU，同一份代码可能从 60 掉到 45。
`lizi-check.mjs` 会先量一个"空 rAF 基线"，判据是 `形态 fps ≥ 基线 × 0.88`。
如果你看到 `fps低` 但基线也只有 40 出头，那多半是隔壁会话在跑测试，不是你的问题。

---

## 4. 字形采样（自动折行 + 逐字归属）—— 直接抄

```js
const offCv = document.createElement('canvas');
const octx = offCv.getContext('2d', { willReadFrequently: true });
const FONT = (px, wt) => `${wt || 800} ${px}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`;

function wrapText(text, fs, maxW, wt) {
  octx.font = FONT(fs, wt);
  const rows = []; let start = 0, w = 0;
  for (let i = 0; i < text.length; i++) {
    const cw = octx.measureText(text[i]).width;
    if (!cw) continue;
    if (w + cw > maxW && i > start) { rows.push({ i0: start, i1: i, w }); start = i; w = 0; }
    w += cw;
  }
  rows.push({ i0: start, i1: text.length, w });
  return rows;
}

/** 返回 {px,py,own,pc,n,charCx,charCy,fs,w,h,rows} —— 点坐标相对文本块中心 */
function sampleGlyph(text, opt) {
  opt = opt || {};
  const wt = opt.weight || 800;
  let fs = opt.fs || 88;
  const maxW = opt.maxW || Math.min(W * 0.74, 1180);
  const maxH = opt.maxH || H * 0.50;
  let rows = wrapText(text, fs, maxW, wt);
  let lh = fs * 1.14;
  if (rows.length * lh > maxH) { fs *= maxH / (rows.length * lh); rows = wrapText(text, fs, maxW, wt); lh = fs * 1.14; }
  octx.font = FONT(fs, wt);
  const widest = Math.max(1, ...rows.map((r) => octx.measureText(text.slice(r.i0, r.i1)).width));
  const padW = Math.ceil(widest) + 20, padH = Math.ceil(lh * rows.length) + 10;
  offCv.width = padW; offCv.height = padH;
  octx.font = FONT(fs, wt);
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillStyle = '#fff';
  octx.clearRect(0, 0, padW, padH);
  const n = text.length;
  const charCx = new Float32Array(n), charCy = new Float32Array(n);
  const rowMaps = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], str = text.slice(row.i0, row.i1);
    const cy = padH / 2 + (r - (rows.length - 1) / 2) * lh;
    octx.fillText(str, padW / 2, cy);
    const x0 = (padW - row.w) / 2, map = new Int16Array(padW).fill(-1);
    let acc = 0;
    for (let i = row.i0; i < row.i1; i++) {
      const cw = octx.measureText(text[i]).width;
      charCx[i] = x0 + acc + cw / 2 - padW / 2; charCy[i] = cy - padH / 2;
      for (let x = Math.max(0, Math.floor(x0 + acc)); x < Math.min(padW, Math.ceil(x0 + acc + cw)); x++) map[x] = i;
      acc += cw;
    }
    rowMaps.push({ y0: cy - lh / 2, y1: cy + lh / 2, map });
  }
  const d = octx.getImageData(0, 0, padW, padH).data;
  const pxA = [], pyA = [], ownA = [];
  const step = opt.step || 2;          // 步长必须 ≤ 颗粒直径，否则笔画是点阵不是实心
  for (let y = 0; y < padH; y += step) {
    let rm = null;
    for (let r = 0; r < rowMaps.length; r++) { const m = rowMaps[r]; if (y >= m.y0 && y < m.y1) { rm = m; break; } }
    if (!rm) continue;
    for (let x = 0; x < padW; x += step) {
      if (d[(y * padW + x) * 4 + 3] <= 128) continue;
      const c = rm.map[x]; if (c < 0) continue;
      pxA.push(x - padW / 2); pyA.push(y - padH / 2); ownA.push(c);
    }
  }
  return { px: Float32Array.from(pxA), py: Float32Array.from(pyA), own: Int16Array.from(ownA),
           pc: pxA.length, n, charCx, charCy, fs, w: widest, h: lh * rows.length, rows: rows.length };
}
```

**派活时必须等间隔取样**：`const pi = (k * pc / K) | 0;`
写成 `k % pc` 字会被压扁成一条带。

---

## 5. 中文分词 + YRC 逐字（直接用，别重写）

词典在 `public/segdict.bin`（33 万个 2~4 字词的 32 位哈希，1.26 MB）。
`fetch('/segdict.bin')` → `new Uint32Array(buf)`。拿不到就退回规则切分，绝不能崩。

```js
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function isWord(s, i, L) {                    // FNV-1a + 二分
  if (!DICT) return false;
  const h = fnv(s.substr(i, L));
  let lo = 0, hi = DICT.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = DICT[m]; if (v === h) return true; if (v < h) lo = m + 1; else hi = m - 1; }
  return false;
}
function segWords(text) {                      // 双向最大匹配，取词数少的
  const fwd = [];
  for (let i = 0; i < text.length;) {
    let hit = 0;
    for (let L = Math.min(4, text.length - i); L >= 2; L--) if (isWord(text, i, L)) { hit = L; break; }
    if (hit) { fwd.push(text.substr(i, hit)); i += hit; } else { fwd.push(text[i]); i++; }
  }
  const bwd = [];
  for (let j = text.length; j > 0;) {
    let hit = 0;
    for (let L = Math.min(4, j); L >= 2; L--) if (isWord(text, j - L, L)) { hit = L; break; }
    if (hit) { bwd.unshift(text.substr(j - hit, hit)); j -= hit; } else { bwd.unshift(text[j - 1]); j--; }
  }
  return fwd.length <= bwd.length ? fwd : bwd;
}
const MAXG = 3;                                // 中文一团最多 3 个汉字
const SUFFIX = /^[的了着过地得吗呢吧啊嘛]$/;     // 的/了/着 → 挂**前**
const PREFIX = /^[但还就才又也都把被在从向对和与而却很不没最更将已曾让给]$/;  // 但/还/就 → 留给**后**
// 标点并进本团并收尾（不这么做逗号会被吞掉）
// 拉丁行按**整词**成团（撇号、连字符不算标点）
```

完整的 `groupByWords / groupByRule / latinSpans / spansForLine` 见
`public/stages/lizi01-thrown-splat.html`（纯函数，直接抄）。

**用 YRC 的地方：**
```js
const chars = line.chars && line.chars.length === text.length ? line.chars : null;   // 长度不等就别用
const onset = chars ? chars[span.i0].t : line.t + (line.dur||4) * (span.i0 / text.length);
for (let c = 0; c < n; c++) glow[c] = chars ? clamp01((T - chars[c].t) / 0.2)     // 逐字点亮
                                            : clamp01((T - lt - dur*0.85*c/n) / 0.3);
```

---

## 6. 每句都要动的 5 条（否则就是"静态图在闪"）

1. **镜头必须动**：至少有平移 + 一个弹簧变焦（`vz += (tz-z)*k - vz*c`，会回弹才像镜头）。
2. **逐字有节奏**：YRC 来了就按字给亮度/位移/爆发，别整句一个时间。
3. **命中/换句要有事件**：顿帧（物理 dt 归零 40~80ms）+ 白闪 + 定向震动。
4. **要有次级动作**：背景粒子/光斑被主运动带着动（反向漂、被推开）。
5. **构图不能塌**：字必须在画面内（`lizi-check` 的"贴边/出界"就是查这个）。

---

## 7. AE 动效词汇表（至少用一种，别全用同一种）

抽帧与顿帧 Step-Printing / Hit-Stop ｜ 缓急变速 Speed Ramping（ease-in-expo 砸进去）｜
焦距突变与滑动变焦 Crash Zoom & Dolly Zoom ｜ 动态模糊与形变残影 Smear Frames ｜
镜头锁定追踪 Object-Locked Camera ｜ 冲击帧 / 负片闪白 Impact Frames ｜
多层级视差位移 Multi-Plane Parallax ｜ 定向镜头震动 Directional Camera Shake ｜
预备动作反向拉伸 Anticipation ｜ 环境粒子与流体受迫反馈 Secondary Action

## 8. 粒子动效词汇表（至少用一种，别全用同一种）

挂点拖尾 / 条带粒子 Ribbon-Trail ｜ 翻转序列帧 Flipbook Sub-UV ｜ 三维网格粒子 Mesh ｜
速度拉伸火星 Velocity-Stretched Sparks ｜ 体积烟雾流体 Volumetric Smoke ｜
卷曲噪波湍流 Curl Noise ｜ 屏幕朝向光晕 Camera-Facing Glow ｜
屏幕空间折射热浪 Heat Haze ｜ 碰撞反弹碎屑 Collision Debris ｜
顶点动画溶解 Vertex Dissolve ｜ 吸引子向心聚拢 Attractor Implosion ｜
贴花投射残留 Decal Residue ｜ 分形电弧闪电链 Fractal Lightning ｜
冲击波环状扩散 Shockwave Torus ｜ 群体智能集群 Boids Swarming

---

## 9. 验收（每个都要过）

```powershell
cd E:\DSHdesktop\work\music-player
node lizi-check.mjs liziNN            # 6 项全过才算完
```

它检查：运行时异常 / fps≥50 / p95 帧时间 / 画面有内容且在动 / 有没有贴边出界 /
反向 seek 会不会崩。截图落在 `shots/lizi/liziNN-1..5.png`。

**改完一定用 `read_image` 真的看一眼截图。** fps 过 ≠ 好看；构图塌了、字被裁了、
一片全白、粒子太少像星点，这些只有眼睛能看出来。

---

## 10. 已占用机制（你的必须和这些都不一样，彼此也不能重）

| 编号 | 机制 |
|---|---|
| lizi01 | 泼墨黏墙：词团从画外沿弧线砸上墙面，砸中黏住，墨点累积加深，逐字烧亮，换句被风扫走 |

**已排给并行会话的 50 个概念（下面的编号请不要重）** —— 见 `LIZI-PLAN.md`。
开工前扫一眼那张表，确认自己的编号和机制，也顺便确认没有和邻居撞车。

---

## 11. 一句话

> **粒子堆出字形，YRC 给节奏，分词给呼吸，镜头给动感，批处理给帧率。**

### 折行：拉丁行必须按整词断（实际踩到过）

`sampleGlyph` 里的 `wrapText` 如果按**字符**断，英文行会被切成 `say g` / `oodbye`，
读起来像打错字。正确做法：拉丁行折行时往回找最近的空格再断；中文没有空格，仍然任意字断开。
`public/stages/lizi04-chladni-sand.html` 里的 `wrapText` 是改好的版本，直接抄。

### 画布尺寸被改动会重置整个 2d 上下文

`offCv.width = padW` 之后 `font` 会被重置成默认 10px —— 后面所有 `measureText` 都是错的，
字会挤成一团。**改完尺寸一定要重新设一遍 `font / textAlign / textBaseline`**。
同理，预烘画布不能在 `resize()` 之前建（那时 W/H 还是 0，会得到 0 宽画布，
`drawImage` 直接抛 InvalidStateError）。

### 用 W/H 预撒点的数组，必须在 resize() 之后初始化（踩了两次）

模块顶层执行时 `W = H = 0`。如果你在这个位置写

```js
for (let i = 0; i < N; i++) { x[i] = Math.random() * W; y[i] = Math.random() * H; }
```

所有点都会落在 (0,0)，画面上一颗都看不到 —— 而且**不报错**，最难查。
lizi12 的星场、lizi04 的金属板画布都是踩这个坑。

正确写法：

```js
function initX() { if (!W || !H) return; for (...) {...} }
function resize() { ...; initX(); }
resize();   // 启动时调一次
```

# LIZI 重做 · 一页纸（子代理只读这一份）

## 你要做的
重做一个粒子歌词特效的**机制片段** `tools/mech/liziNN.js`（单文件、只写
`mechResize / mechAssign / mechUpdate / mechDraw / mechEvent` 这几个函数）。
机制概念不许换（看 `LIZI-PLAN.md` 里你那一行），要换的是**表现力**。

## 起手：先拷模板
`tools/mech/_v2-template.js` —— 整段拷到你的 mech 顶部，再把 PHYSICS（`mechUpdate` + `mechDraw` 里
粒子怎么组织）改成本形态的运动。模板已经给了：

- 字形点等间隔映射到粒子（`vtx/vty/von`，换句自动复用 → 不会双描）
- 三档实心笔画（`vBands`）+ 暗影层（厚度）+ 预烘扫光贴图（打光）
- 3D 环绕（`vYaw/vPit` + 透视缩放）+ 每颗粒子的光照值 `vlum`
- `blockGx/blockGy`（字块中心）、`pjX/pjY`（相机）、`charGlow`（YRC 逐字点亮）、`clamp01/accent/rnd`

## 硬指标（缺一条＝没做完）

1. `shots/lizi/<id>-<slug>-3.png`：**整句歌词一眼读完**，笔画实、不糊成团、不与背景同色、不贴边不出界
2. 有厚度（暗影层）和打光（掠射扫光或体积光），不是一片均匀点阵
3. 有明显镜头运动（3D 环绕 / 甩镜 / 变焦 / 视差），`-2` 和 `-3` 两帧构图不同
4. 有物理过程（飞溅/湍流/生长/轨道/冷凝），`-2` 中段帧看得出来
5. 背景有层次（预烘渐变 + 星尘/雾/光斑），不是纯黑
6. 换句时旧粒子必须回收复用，**不能残留成第二层字（双描）**

## 性能铁律
- 粒子 2000~9000，全用 `rect`，**不用 `arc`**
- 每帧 `fillStyle` ≤ 10 次（不能逐颗设色）；字用 `source-over`，火星/辉光才用 `'lighter'`
- `getImageData / createRadialGradient / createLinearGradient / shadowBlur / ctx.filter` 不许出现在 frame 里
- 逐颗 `drawImage` 禁止；软光斑一律预烘 + 少量 blit
- 用 W/H 撒点的数组必须在 `mechResize()` 里初始化（顶层执行时 W=H=0，会全部堆到 (0,0) 且不报错）
- 总着墨面积 ≈ `数量 × (2r)²` ≤ 3 个画布

## 流程（必须走完，至少迭代 2 轮）
```powershell
cd E:\DSHdesktop\work\music-player
# 1) 改 tools/mech/liziNN.js
# 2) 构建（短名/中文名照 LIZI-PLAN.md，别改文件名）
node tools/lizi-make.mjs liziNN <short> <中文名> tools/mech/liziNN.js
# 3) 验收
node lizi-check.mjs liziNN
# 4) 肉眼验收（必须）
#    read_image shots/lizi/liziNN-<short>-3.png   整句可读？有打光？有镜头？
#    read_image shots/lizi/liziNN-<short>-2.png   中段有物理过程？
# 5) 不达标 → 回到 1)，至少再来一轮
```

**fps 判据**：`fps ≥ 基线 × 0.88`。机器上有别的会话在跑，基线可能只有 40 出头，别因 35fps 就以为写崩了（先看基线列）。

## 纪律
- 只改 `tools/mech/liziNN.js` 和它构建出的 `public/stages/liziNN-<short>.html`
- 不改 `tools/lizi-base.js` / `lizi-make.mjs` / `lizi-check.mjs` / `public/app.js` / `LIZI-PLAN.md` / 别的编号
- 不启停服务器（端口看 `.port`）
- 不要读 `HANDOFF.md`、`LIZI-BRIEF.md`、别的 `public/stages/*.html`（白烧上下文，实例证明会把上下文烧光）

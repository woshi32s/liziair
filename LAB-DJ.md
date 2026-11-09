# LAB-DJ 规格：音乐实验室 DJ 台（对标 Mixxx 2.5.6）

> 给子代理的执行规格。用户原话：「精准复刻 mixxx 该有的功能，并加入可以自己接歌曲的功能，之前的功能太垃圾了，UI 一定要偏专业点，可以纯白。」
> 结论先行：**这不是"做个好看的搓碟玩具"，是把实验室里那块手搓面板换成一台能用的双 deck 播放器。**
> 目标文件：`public/index.html`（`#view-lab` 内）、`public/app.js`、`public/app.css`、新建 `public/lab/dj.js`、新建 `public/vendor/`（已就位）。

---

## 0. 已有资产（别重复造）

| 资产 | 说明 |
|---|---|
| `public/vendor/soundtouch.js` | **ESM**，`export { SoundTouch, getWebAudioNode, PitchShifter, RateTransposer, WebAudioBufferSource }`。变速不变调（keylock）就靠它。必须 `import` 用，不能当 classic script。 |
| `public/vendor/soundtouch.LICENSE` | LGPL-2.1+，留着，别删 |
| `public/app.js` | 现有 `Lab` 模块（~2006 行起）：双 deck + 混音台 + 自动过渡 + 插件。**搓碟那套要整体替换**，`xfade`/`vst` 两个分页保留。 |
| `public/tokens.css` | 设计令牌：纸白、墨黑、字阶、圆角、4pt 间距、缓动。**不许自己发明颜色**。 |
| `public/beat.js` | 现有实时 BPM 检测。它的算法有已知毛病（见 §5），**离线 BPM 检测要自己写**，别复用它。 |

---

## 1. 功能清单（对照 Mixxx，按"必须/可选/不做"）

### A. Deck（A/B 各一台，必须）
1. **载入曲目**：① 本地文件（文件选择器 + 拖放，多选）② 网易云队列里的下一首/当前曲 ③ 曲库列表双击或拖到 deck
2. **播放/暂停**、**CUE**（设暂存点；播放中按下回跳到 cue 并暂停 —— Mixxx 行为）
3. **转盘搓碟**：拖转盘改变播放速率（正反都行），松手回 1.0 并继续；静止时轻微拖动 = pitch bend（Mixxx 行为）
4. **速度推子**：±8% / ±16% / ±50% 三档可切，双击回 0
5. **Keylock 开关**：开 = 变速不变调（走 soundtouchjs），关 = 变速变调（普通 playbackRate 行为）
6. **BPM 显示 + 拍网格**：载入后离线检测 BPM 与首拍相位；波形上画拍线
7. **SYNC**：按当前 master deck 的 BPM 对齐，并对齐相位（拍网格对齐）；master 可手动指定（A/B 一个按钮）
8. **Hotcue 1~8**：单击设置/跳转，右键或 Shift+单击清除；按曲目持久化（localStorage，`lizi.dj.cues.<trackKey>`）
9. **Loop**：in/out 设点、按拍长一键 loop（1/4、1/2、1、2、4、8、16、32 拍）、×2 / ÷2、loop 开关、beatjump ±1/±4 拍
10. **波形**：① 滚动细节波形（每 deck 一条，居中播放头）② 全曲概览（含已播进度、cue/loop/hotcue 标记）
11. **时间**：已播时间 + 剩余时间（`-1:23` 形式），tab 键不参与

### B. Mixer（必须）
12. 每 deck：**trim**、**3 段 EQ**（high/mid/low，旋到最小 = kill 到 -inf）、**filter**（单旋钮：中点关闭，左 = LPF，右 = HPF）
13. **通道推子**、**等功率横推**（居中两边 -3dB，可切 sharp/linear）、**master** 推子
14. **电平表**：每 deck 与 master 的 L/R 峰值表（带峰值保持 ~1s），60fps 更新
15. **PFL/耳机**：能做到就做 cue 混音（master + 选中 deck 的 PFL），做不到就在 UI 上如实标灰并写清原因

### C. 效果（可选，做就做干净）
16. 每 deck 一个 FX：echo / reverb / delay 三选一，dry/wet + 一个参数旋钮。**做不干净就整块别放**，别放半成品。

### D. 曲库（必须）
17. 表格列：`#`（序号）、标题、艺人、BPM、时长；等宽数字右对齐
18. 搜索过滤（标题/艺人，即时）、行内 `A`/`B` 载入按钮、拖行到 deck
19. 数据源：**本地文件**（拖入后暂存内存/IndexedDB）、**网易云当前队列**（`Player` 的队列）、**搜索结果**（复用现有 `API`）
20. 载入后 BPM 与热键缓存，二次载入不重算（localStorage）

### E. 键盘（必须，写进 UI 提示）
21. `Space` = A 播放/暂停，`Shift+Space` = B，`C`/`Shift+C` = A/B cue，`1..8` = A 热键，`Shift+1..8` = B 热键，`[`/`]` = A/B loop 开关，`\` = 横推居中

### F. 不做（明确剔除，别浪费时间）
- 录音、Auto DJ、4 deck、FX 链、vinyl/timecode、MIDI 控制器映射、调性检测（key detection 太重）
- 任何需要新 npm 运行时依赖的东西

---

## 2. 视觉规范（用户要求：专业，可以纯白）

一句话：**像一台白色硬件的说明书，不像一个网页玩具。**

- 底色 **纯白 `#fff`**；次级面 `#fdfcfa`；分割线 **1px** `#e8e5df`（hairline，别用阴影代替）
- 墨色 `#17171a`；次级文字 `#6b6b70`；微弱 `#a8a8ad`
- **不要**：圆角卡片、投影、渐变、发光、玻璃、emoji
- 圆角只用 2px（面板）/ 999px（胶囊）；旋钮/推子允许 1~2px
- 数字一律 **等宽 + tabular-nums**；时间、BPM、dB 全部右对齐对齐小数位
- 字号只用 9.5 / 10.5 / 12.5 / 15 / clamp(24~34)；小标签 9.5 + `letter-spacing:.08em` + 大写
- 布局用**细线分栏**（竖线/横线），deck | mixer | deck 三栏，曲库在底部通栏
- 唯一的强调色：网易云红 `oklch(62% .22 12)`，只给热键已设置、loop 激活、SYNC 激活
- 波形配色：已播 `#17171a`、未播 `#cdc9c2`、拍线 `#ddd9d2`（弱）、cue 白三角、loop 区间淡墨底
- 旋钮画成**真旋钮**：圆弧刻度 + 指示线 + 中点刻度线，不要用 input[type=range] 的默认样式
- 推子画成**细槽 + 实心块**，轨道宽 2px
- 状态如实：没载入就写"未载入"，不要假装有数据

**红线**（HANDOFF §2）：`view-lab` 必须 `top:0` + `padding-top: calc(--topbar-h + --sp-5)` + 背景白，这样内容从玻璃顶栏下面滚过被折射；顶栏、窗口圆角、背景光斑**一行都不许动**。

---

## 3. 技术约定

- **零运行时依赖**：不碰 `package.json`。新库只能 vendor 单文件到 `public/vendor/`
- **音频图**：一个 `AudioContext` 单例；每 deck：
  `source → [keylock: soundtouch getWebAudioNode] → trim → EQ(h/m/l) → filter → chFader → xfader → master → destination`
  电平表从 `chFader` 后、`xfader` 前各接一个 `AnalyserNode`
- **搓碟**：`AudioBufferSourceNode.playbackRate` 不接受负值（HANDOFF §4⑦），所以搓碟必须走**颗粒合成**（每帧从播放头切一小片播，正放用原 buffer、倒放用预反转 buffer）。现有 `makeDeck` 里已有可用实现，别推翻重写，改成 class 收编
- **Keylock**：`getWebAudioNode(ctx, bufferSource, filter)` 把 `PitchShifter` 串进去。注意它的 `tempo`/`pitch` 语义：变速不变调时 `tempo = rate, pitch = 1`（**先写个 5 行小页面验证再往上装**，别猜）
- **离线 BPM**：对 `AudioBuffer` 做"能量谱通量 → 自相关"（不要用实时 `getByteFrequencyData`）：
  1. 单声道下混 → 10ms 帧、hop 10ms
  2. 每帧只取 **低频段**（≈30~180Hz）能量，求正半波差分得 onset 包络
  3. 包络去均值 → 在 60~200 BPM 对应的 lag 区间做自相关 → 取峰 → 抛物线插值细化
  4. 首拍相位 = 用 BPM 网格对 onset 包络做相位扫描，取能量最大处
  自测：拿一首已知 BPM 的歌，误差必须 **< 1 BPM**；对着 120/128/140 BPM 的合成节拍器音频（自己造）必须精确命中
- **性能**：波形用 canvas，按 DPR 缩放；每帧只重画必要区域；`requestAnimationFrame` 单循环驱动（**不要在多个 rAF 里各画各的**）。目标：1440×900 下稳定 60fps
- **内存**：解码后的 `AudioBuffer` 每首约 `时长 × 44100 × 2ch × 4B`（5 分钟 ≈ 106MB）。曲库只保留**当前载入的两首**的 AudioBuffer，其余只留波形峰值 + 元数据

---

## 4. 文件边界（谁可以改什么）

**可以改**：`public/index.html`（只动 `#view-lab` 内部）、`public/app.js`（只动 `Lab` 模块）、`public/app.css`（只追加 lab 相关）
**可以新建**：`public/lab/dj.js`（主模块，ESM）、`public/lab/dj-engine.js`、`public/lab/dj-ui.js`、`public/lab/dj.css`、`_djlab.mjs`（验收脚本）
**绝对不碰**：
- `public/stages/**`（尤其 `039-morph-blob-lyrics.html`，另一条会话正在改）
- `public/stages/lizi*.html`、`LIZI-BRIEF.md`、`LIZI-PLAN.md`、`LIZI-NEXT.md`、`LIZI-POLISH.md`、`lizi-*.mjs`、`_lizi*.mjs`、`_fix*.py`
- `desktop/main.js` 的窗口外观、`server.mjs`
- `package.json`

**改共享文件前先 `git status`**。`app.js` 可能被别人同时改：用 `edit` 前先重读，锚点必须唯一；报错"文件已变"就重读再改，**绝不整文件覆盖**。

**别跑 `node smoke-all.mjs`**（116 个形态、11 分钟、必须串行，会和形态会话打架）。只测 lab。

---

## 5. 已知坑（HANDOFF 里踩过的，别重踩）

1. `stub()` 是 Proxy，`$()` 找不到元素不报错、只返回替身 —— **界面没反应先怀疑 id 写错**
2. `#stage-menu-list` 不能删（播放页抽屉抄它的 innerHTML）
3. 新视图必须在 `bindTopbarScroll()` 里加一行，否则没有 logo 收缩 + 玻璃下沿暗部
4. `ELECTRON_RUN_AS_NODE` 不清，`npm start` 会退化成纯 Node
5. 端口以 `.port` 为准（现在是 11701），**别写死**
6. 波形用 `max` 归一化会画成一堵灰墙 → 用 **95 分位 + 幂压缩 0.62**
7. 固定 `sleep` 等不到页面就绪 → 轮询判断（等 `#dj-lib tbody tr` 出现）
8. 半透明面板会透出下层网格线 → DJ 台不要半透明

---

## 6. 验收（做不到这些不许交）

写 `_djlab.mjs`，用仓库里既有的 CDP 无头 Chrome 套路（参考 `_djcheck.mjs` / `_hallshot.mjs`），自己起 profile、自己清理。必须断言并打印数字：

| # | 断言 | 通过标准 |
|---|---|---|
| 1 | lab 页面能开、无 console error | 0 error |
| 2 | DOM 齐全 | 2 deck、2 转盘、2 细节波形、2 概览、16 热键、12 旋钮、3 推子、2 电平表、曲库表 |
| 3 | 载入网易云曲目（用 `API` 搜一首） | 得到时长 > 30s、BPM 在 60~200 |
| 4 | 真出声 | 接 analyser 量 RMS，播放 2s 内 **max RMS > 0.02** |
| 5 | 波形不是空白 | 波形 canvas 非背景色像素 **> 15%** |
| 6 | 变速不变调 | 同一段音频 rate=1.0 vs 1.08，频谱质心差 **< 3%**；关 keylock 后差 **> 3%** |
| 7 | SYNC | 两 deck 载入不同 BPM，按 sync 后 BPM 相对误差 **< 0.2%** |
| 8 | Loop | 设 4 拍 loop，2s 内播放位置始终在区间内 |
| 9 | 热键 | 设 3 号热键→seek 到别处→点击跳回，误差 **< 50ms** |
| 10 | 横推 | -1/0/+1 三个位置，A 通道增益单调递减、B 单调递增，居中 ≈ -3dB（±0.3dB） |
| 11 | 本地文件 | 构造 `File`（自己生成 2s WAV）派发 drop，deck 能播、时长 ≈ 2s |
| 12 | 截图 | `shots/review/dj-*.png` 至少 3 张：整体、A deck 特写、曲库 |

截图自己看一遍再交：**波形是不是一堵墙、文字有没有挤、对齐有没有歪**。

---

## 7. 交付报告格式

```
## 做了什么
（按 §1 编号逐条：必须项 ✅ / 可选做了 ✅ / 没做 ⛔ + 原因）

## 实测数字
（§6 表里每一项的真实数值，不要写"通过"两个字）

## 截图
shots/review/dj-*.png

## 与 Mixxx 的差距
（诚实列：哪些行为 Mixxx 有、我们模拟得不一样）

## 留给下一个人的坑
```

**不要 git commit**，改动留在工作区，包工头来复查提交。

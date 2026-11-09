# LIZI · 包工头交接文档

> 最后更新：2026-10-27 16:30（大厅 V4 落地 + 音乐实验室接线之后）
> LIZI = 网易云歌单 + 116 个歌词可视化形态的 Electron 桌面应用（零依赖 Node 服务 + 纯前端）。
> 本文档是**包工头（协调会话）**的交接。形态会话读 `PARALLEL.md`（很短），不要读本文档。
> 上一版交接（10-25，含 20 条形态开发坑、60 形态机制表）归档在 `HANDOFF-archive-1025.md`，需要时再翻。
> 工作目录：`E:\DSHdesktop\work\music-player`

---

## 0. 一句话现状

服务在跑（**端口 11701，以 `.port` 为准**），应用窗口已关。68 个提交。
工作区只剩并行会话在改的 `public/stages/039-morph-blob-lyrics.html`（**别碰**）。

这一轮（10-26 ~ 10-27）做完：**大厅重做成 V4 巨幅封面并接成入口视图**、
顶栏那套滚动态修回来、**音乐实验室**（Mixxx 式双 deck 搓碟台 / 等功率自动过渡 / VST3 结论页）。

**安装包是 10-25 17:08 打的，之后又提了 6 个 commit —— 需要重打。**

用户当前诉求（原话）：「咱自己做的台子太不专业了 为啥不能直接搬出很成熟的呢」
→ 见 **§6 待办①**，库的版本、体积、可行性都已经查好，直接照做即可。

---

## 1. 怎么跑

| 想干什么 | 命令 |
|---|---|
| 起网页服务 | `node server.mjs` → 真实端口写进 `.port` |
| 开 LIZI 窗口 | **先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`**，再 `npm start` |
| 打安装包 | `npm run dist` → `dist\LIZI Setup 1.0.0.exe`（约 2 分钟，80MB） |
| 单测一个形态 | `node smoke-all.mjs 005` |
| 全量验收（必须串行） | `node smoke-all.mjs`（116 个，约 11 分钟） |
| 形态截图 | `node shot.mjs 005` |
| 帧率对比 | `node _fps.mjs 013 006` |
| 重建形态注册表 | `node register-stages.mjs`（**只有新增形态文件才需要**） |

### ⚠️ 端口别写死 5456

服务端逻辑（`server.mjs` 的 `preferredPort()`）：读 `.port` → **立刻删掉** → 用这个端口试绑，
绑不上就退回系统分配。所以端口**每次重启都可能变**。

这次重启就踩了：Windows 保留段变成了 **5358–5457**，把 5456 圈进去了，服务于是落到 **11701**。

```powershell
# 查当前保留段
netsh int ipv4 show excludedportrange protocol=tcp
```

**端口一律以 `.port` 文件为准。** 桌面壳 `desktop/main.js` 也是读 `.port`，会自动跟上。
给用户地址时先 `Get-Content .port`，别凭记忆。

- 用户不会自己启动应用 → 他要看效果时，**你帮他 `npm start`**（`Start-Process ... -WindowStyle Hidden` 后台跑）
- 服务已在跑时**别再起第二个**；停服务按端口找 PID，**禁止** `Stop-Process -Name node`
- 起完验证一下 `http://127.0.0.1:<port>/` 返回 200

---

## 2. 架构（30 秒版）

```
desktop/main.js      Electron 主进程：找/起服务 → BrowserWindow；窗口三键自己画
server.mjs           零依赖 HTTP 服务：静态文件 + 网易云 weapi 转发 + 封面代理
public/
  index.html  45KB   单页外壳：玻璃顶栏 + 5 个 view + 播放栏 + 播放页抽屉
  app.js     146KB   全部交互：视图切换 / 大厅 / 实验室(DJ台) / 播放页 / 抽屉 / 设置
  app.css    131KB   全部样式（含大厅、实验室、DJ 面板）
  tokens.css         设计令牌（OKLCH 纸/墨、字阶、圆角、4pt 间距、缓动）
  player.js          Player 单例：**单** <audio>、队列、歌词 YRC/LRC、封面取色
  beat.js            实时 BPM 检测（谱通量法，见 §8①）
  api.js             前端 API 层（都走 /api/*，封面走 /api/img 代理）
  assets/liquid-glass.js   液态玻璃引擎（SVG 位移贴图 + 折射）
public/stages/       116 个形态（**不是包工头的**，并行会话各占一个文件）
public/*.html        lab 页：layout-lab / controls-lab / lobby-5 / cube-menu …
```

### 视图（`show(next)` 切换）

| view | 作用 | 顶栏左键 |
|---|---|---|
| `view-hall` | **入口**。巨幅封面（上次播放的歌）+ 四块各占一行 + 推荐歌单墙 | 齿轮（只有这里能开设置） |
| `view-browse` | 只放搜索结果和歌单曲目 | 液化成返回箭头 → 回大厅 |
| `view-lab` | 音乐实验室（搓碟 / 自动过渡 / 插件） | 返回箭头 |
| `view-now` | 播放页（暗场、歌词、抽屉里切形态） | — |
| `view-stage` | 形态全屏 | — |

**关键布局约定**：`view-hall` / `view-lab` / `view-browse` 都是
`top:0` + `padding-top: calc(--topbar-h + --sp-5)` + 背景 `#fff`。
这样内容往上滚时会**从玻璃顶栏下面经过并被折射**。
**顶栏、窗口圆角、背景光斑一行都不能动** —— 用户明确要求过。

---

## 3. 这一轮做了什么（6 个提交）

| commit | 内容 |
|---|---|
| `aed213a` | 大厅接入主界面：V4 巨幅封面版成为入口视图（新增 `/api/top/playlist` 路由） |
| `b2fba62` | 修回大厅的灵魂：logo 收缩 / 玻璃下沿暗部 / 设置只在大厅 / 搜索后液化成返回键 |
| `7d986cb` | 大厅排版改版：四块各占一行、整体放大、去掉无意义小字 |
| `0e101b4` | 工具箱接入音乐实验室：搓碟 / 自动过渡 / 插件 |
| `d9d9070` | 搓碟改成 Mixxx 式双 deck 混音台 |
| 本次 | 交接文档重写 + 归档旧版 + 清理过期脚本 |

### 大厅 `#view-hall`
- 上半：**巨幅封面 = 上一首播放的歌**，存 `localStorage['lizi.hall.lastTrack']`，
  带「上次听到 · 47 分钟前」+ 大标题 + 副题 + 播放键（点了重播那首）
- 中：四块**各占一行**——本日推荐（3 列，名在上歌手在下）/ 精选（4 张大封面）/
  工具箱（4 项横排）/ 我的（头像 + 统计右对齐）
- 下滑：网易云推荐歌单，5~6 列封面墙，滚到底出「已经到底了」
- 点歌单 → 切 `browse` 载入曲目（实测 195 首）
- 工具箱四项：音乐实验室 / 自动过渡 / 形态长廊 / 歌词样式

### 音乐实验室 `#view-lab`
- **搓碟**：Mixxx 式双 deck + 混音台。每台 deck 的信号链
  ```
  [颗粒 / 循环源] → in → lowShelf(220) → peaking(1.1k) → highShelf(4.2k)
                  → 通道推子 → 横推 → master → destination
  ```
  横推等功率：`gainA=cos(θ)`、`gainB=sin(θ)`，`θ=((x+1)/2)·π/2`，居中两边都 −3dB。
  A 装当前曲、B 装队列下一首，进页面自动解码。搓碟颗粒接在 `in` 节点上，所以 EQ/推子照样生效。
- **自动过渡**：等功率曲线（`cos²+sin²≡1`，误差 <1e-6）用真音频跑一遍，
  可调时长 2~16s、平台 0~0.8，页面实时画两条曲线。
  **只是实验室演示，没接进正式播放**（要接先改双 deck）。
- **插件**：VST3 结论页，明确写了不能跑的三条硬限制（见 §8③）。

---

## 4. 运行/开发坑（都真踩过）

1. **`ELECTRON_RUN_AS_NODE=1` 不清理，`electron .` 会退化成纯 Node**，窗口起不来
2. **Google Fonts 的 `<link rel=stylesheet>` 会阻塞内联脚本**——lab 页引外链字体，网络一慢整页白屏，
   而且会把自动化验证全搞坏（脚本读到的状态是错的）。要用就 `media="print" onload="this.media='all'"`
3. **`is-stuck`（logo 收缩 + 玻璃下沿暗部）是绑在具体滚动容器上的**。新加视图忘了绑，
   用户第一句就是「我的灵魂呢」。新视图必须在 `bindTopbarScroll()` 里加一行
4. **半透明卡片会透出下层网格线**（池核那版栽在这：网格缝从半透明瓷砖底下透上来，
   一块大瓷砖被切成好几格）。网格线只在拖拽时显示
5. **`#stage-menu-list` 不能删**。播放页抽屉的形态下拉是抄它的 `innerHTML`，删了抽屉会空掉。
   删设置里的 UI 时要把它移到面板外面留着
6. **波形用 `max` 归一化会画成一堵灰墙**（整首歌都响时每根柱子都顶满）。要用 95 分位 + 幂压缩(0.62)
7. **`AudioBufferSourceNode.playbackRate` 不接受负值**，倒放只能预先反转 buffer。
   想搓碟就得走「解码 + 颗粒合成」，`<audio>` 的 playbackRate 做不出来
8. **VST3 的 `.vst3` 可能是目录（bundle）**，真二进制在 `<name>.vst3\Contents\x86_64-win\`，不递归会扫不到
9. **VST3 批量加载会把整个进程崩掉**（WIBU/iLok），必须每个插件独立子进程 + 超时
10. **`stub()` 是个 Proxy**（`$()` 找不到元素就返回它），删 HTML 不会让 JS 崩；
    反过来——**界面没反应时先怀疑 id 写错被 stub 吞了**

---

## 5. 别碰的东西

- `public/stages/039-morph-blob-lyrics.html`（正在被改）
- `public/stages/lizi*.html` + `LIZI-BRIEF.md` / `LIZI-PLAN.md` / `LIZI-NEXT.md` / `LIZI-POLISH.md`
  + `lizi-register.mjs` / `_lizi*.mjs` / `_fix*.py`（另一条「lizi 系列」会话的产出，未跟踪）
- 形态文件一律不是包工头的；**只有新增形态文件出现**时才跑 `register-stages.mjs`

**改共享文件前先 `git status`。** `public/app.js` 曾被别的会话边写边追加 STAGES，
`edit` 工具会因「文件已变」报错 → 改用毫秒级单次 `[IO.File]::WriteAllText` 替换（锚点先验唯一）。

---

## 6. 待办（按性价比排序）

### ①【用户当前诉求】把 DJ 台换成成熟件

用户嫌手搓的台子不专业。**Mixxx 搬不进来**（理由见 §8④），但下面这些查过能装、能用：

| 我手搓的 | 成熟替代 | 版本 | 体积(unpacked) | 解决什么 |
|---|---|---|---|---|
| 变速 = 改 playbackRate | **soundtouchjs** | 0.3.0 | 1825 KB（`dist/soundtouch.js`） | **变速不变调**。它就是 Mixxx 用的 SoundTouch 的 JS 移植（Mixxx 里是 `SoundTouch.dll`）——**这是「业余感」最大来源** |
| 40 行 canvas 波形 | **wavesurfer.js** | 8.0.3 | 1619 KB | 真波形、缩放、拖动定位 |
| 没有 BPM / 拍网格 / SYNC | **web-audio-beat-detector** | 8.2.39 | **41 KB** | BPM + 拍点，便宜 |
| | **essentia.js**（MTG 学术级 WASM） | 0.1.3 | 9906 KB | 更准的节拍/调性，太大，非必要不上 |
| rAF 自己算时间 | **tone** | 15.1.22 | — | 采样级调度 |

`npm pack` 实测能下载（registry 通；沙箱里 `web_fetch` 到 GitHub raw 会超时，用 npm 就没事）。
应用是「零运行时依赖」，做法是**把 dist 单文件 vendor 进 `public/vendor/`**，不改 `package.json`。

**建议顺序**：soundtouchjs（变速不变调）→ beat-detector（BPM + SYNC）→ wavesurfer（波形）→ essentia 暂缓。

### ② 插件真正接入
两条路：**外部宿主进程**（Python/pedalboard 加载 VST3 + 虚拟声卡环回），或停在结论页。**要用户拍板。**

### ③ 自动过渡接进正式播放
现在只有实验室演示。接进去要**先把播放器改成双 deck**（`player.js` 单 `<audio>` 单例，做不了交叉淡化）。

### ④ 重打安装包 + 全量验收
`npm run dist`；`node smoke-all.mjs` 必须**串行**跑（约 11 分钟），别和形态会话同时。

### ⑤ 大厅小尾巴
点推荐歌单进 `browse` 后**顶部没有歌单名**（当初主界面刻意删了「歌单头」）。
三个选项：加一个会滚走的标题 / 保持不动 / 在大厅就地展开。**用户还没选。**

### ⑥ 设计稿遗留
- `public/layout-lab.html` 20 种播放页排版，用户一直没选
- `public/lobby-5.html` 5 版大厅排版（用户选了 **V4**，已落地）；
  `lobby-cards.html`（卡片）和 `lobby-pool.html`（池核）是**被否掉的**，留着当反例

---

## 7. 验收工具（都在仓库根，跑完自己看结论）

| 脚本 | 验什么 |
|---|---|
| `_djcheck.mjs` | DJ 面板：2 deck/2 转盘/8 旋钮/2 波形、A/B 解码、播放、搓碟、横排、EQ 旋钮、波形像素 |
| `_hallshot.mjs` | 大厅：视图、封面数据、四块行数、歌单数、滚到底、点歌单进 browse |
| `_hallcover.mjs` / `_hallplay.mjs` | 大厅封面用真图渲染 / 换歌后 hero 自动同步 |
| `_settingscheck.mjs` | 顶栏 logo 收缩、玻璃暗部、设置面板内容、搜索后液化返回、非大厅不误开设置 |
| `_five.mjs` | `lobby-5.html` 五版排版逐版截图 |
| `_cardsshot/_cardsdrag/_poolshot/_pooldrag.mjs` | 卡片版/池核版截图与拖拽（已否，留档） |
| `_cubeprobe/_cubesweep/_cubestate/_cubecheck.mjs` | 点阵立方体菜单 |
| `_drumbeat-test.mjs` / `_crossfade-lab.mjs` | 鼓组节拍 A/B、交叉淡化曲线 |
| `lizi-check.mjs` / `e2e-stages.mjs` / `smoke-all.mjs` | 形态验收 |

**截图都落在 `shots/review/`。** 脚本自己起无头 Chrome（CDP），跑完自己清理临时 profile。

一个反复踩的测试坑：**固定 `sleep` 等不到页面就绪**。init 里要先 `await API.session()` 和搜索，
大厅可能 4~5 秒才挂载。**要轮询判断**（例如等 `#hall-tools .hrow` 出现），不要写死时间。

---

## 8. 四项调研结论（10-26，报告在 `_research/`）

**① 鼓组节拍检测**（`folia-major/mods/visualizer52hz/beatDetector.mjs`，70 行）
只取低频段（`LOW_BIN_START=1, LOW_BIN_END=12`），阈值 `max(FLOOR, mean + 1.8/sensitivity·deviation)`。
A/B 实测：**F1 0.918 vs 现版 0.229**，召回 **100% vs 20%**，平均误差 14.3 vs 17.5 ms。
现版 `beat.js` 的毛病：谱通量用了**全部频段**且除以 `freq.length`，被高频摊薄。
> 时间戳注意：`getByteFrequencyData` 反映的是**最近 FFT_SIZE 个采样**，
> 时间戳应取窗口**末端** `(s+FFT)/SR`，取起点会偏早 ~30ms。

**② 智能过渡**：需要双 deck；`buildCrossfadeCurves` 60 行纯数学可移植。
等功率 `cos²+sin²≡1`；`BLEND_HEADROOM_DB=1.5` 的钟形头要**先除掉再比较**，否则会误判曲线错了。
（测功率不要用两个同相正弦，会相干叠加，看起来像曲线有纹波。）

**③ VST3**：本机 107 个商业插件，**101 个能加载并处理音频（94%）**，中位 **32.4× 实时**。
但 **AudioWorklet 调不了原生模块**（没有 require/module/window）；npm 上没有可用的 Node VST3 宿主
（`node-vst3-host`/`vst3-host`/`vst3-js` 全 404，`node-vst` 停在 0.0.1 VST2）；
SDK 是 GPLv3 或 Steinberg 专有双许可。**真正的死结是 GUI**：Saturn 2 有 956 个参数、Timeless 3 有 1012 个。

**④ Mixxx 为什么搬不进来**
Qt6/C++ GPLv2+ 的**独立桌面程序，不是库**；**没有 OSC/HTTP/WS/DBus/socket 给外部程序**，
2.5.6 只有**单向 MIDI 遥控**；**不能指定播放哪首歌**（没有 track injection），音频也回不到我们这边。
所以「搬 Mixxx 界面」只有一条路：**另开 Mixxx 窗口 + 装自定义 MIDI mapping 遥控它**
（`Web MIDI` 在 Electron 33 里可用，`http://127.0.0.1` 下实测正常）。
真要「像 Mixxx」，正确做法是**借它的零件**——SoundTouch 就是 Mixxx 在用的时伸缩算法（见 §6①）。

---

## 9. 设计语言（别自己发明）

取自 `tokens.css` + 播放页 + `lobby-concept.html`：

- 纸白 `#fdfcfa`、墨黑 `#17171a`、四档灰 `--ink-2/3/4`
- **不用卡片盒子**，靠 **1px 细线** 和**留白**建立秩序
- 圆角极小（封面 3px，胶囊 999px，面板 4px），阴影**只给封面**，且极柔
- 小字 12.5 / 10.5 / 9.5；只有标题放大（`clamp(28~64)`，字距 `-.035em`）
- 等宽字体**只**给序号、时长、英文小标
- 深色只出现在播放页和 **DJ 面板**（读作硬件）
- 网易云红 `oklch(62% .22 12)` 是唯一强调色

**用户口味记录**：**拒绝了**卡片大厅（iOS 小组件味）和池核版（超现实但不像他），
**选了** V4 巨幅封面（编辑部/印刷品气质）。
他没说清楚要什么时——**一次给 4~5 个具体方案让他挑**，别只给一版。

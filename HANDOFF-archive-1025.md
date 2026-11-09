# LIZI · 交接文档（新会话从这里开始）

> 最后更新：2026-10-25 18:55（包工头交接：播放页改版收尾 + 窗口圆角 + 液态玻璃设置弹层）
> LIZI = 网易云歌单 + 60+ 个歌词可视化形态的 Electron 桌面应用。
> 本文档是**包工头（协调会话）**的交接。形态会话读 `PARALLEL.md`（很短），不要读本文档。
> 旧的形态开发教训（20 条坑、60 形态机制表）仍在 git 里，用法见文末"附录索引"。

---

## 0. 一句话现状

**42 个提交，工作区干净**（只有 `039-morph-blob-lyrics.html` 还在被某个形态会话改，别碰）。
65 个形态、0 报错、59/65 fps≥50。播放页这一轮刚做完大改并**正在运行**（pid 见任务管理器，
窗口标题会变成当前歌名）。安装包是 17:08 打的，**之后又提了 6 个 commit，需要重打**。

---

## 1. 怎么跑

| 想干什么 | 命令 |
|---|---|
| 起网页服务 | `node server.mjs` → 端口写进 `.port`（当前 **5456**） |
| 开 LIZI 窗口 | **先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`**，再 `npm start` |
| 打安装包 | `npm run dist` → `dist\LIZI Setup x.x.x.exe`（约 2 分钟） |
| 单测一个形态 | `node smoke-all.mjs 005` |
| 全量验收（必须串行） | `node smoke-all.mjs`（65 个，约 11 分钟） |
| 形态截图 | `node shot.mjs 005` |
| 形态页帧率对比（带父页面操作条/玻璃/渲染档位） | `node _fps.mjs 013 006` |
| 重建形态注册表 | `node register-stages.mjs`（**只有新增形态文件才需要**） |

- 浏览器入口 `http://127.0.0.1:5456`；深链 `?stage=005`
- **两个实验室**（用户挑设计用）：
  - `http://127.0.0.1:5456/layout-lab.html` —— 20 种播放页排版
  - `http://127.0.0.1:5456/controls-lab.html` —— 12 种传输排（用户已选 **01**，已落地）
- 服务已在跑时**别再起第二个**（会搅动 `.port`）；停服务按端口找 PID，**禁止** `Stop-Process -Name node`
- 用户不会自己启动应用 → 他要看效果时，**你帮他 `npm start`**（后台跑）

---

## 2. 架构（30 秒版）

```
LIZI.exe (desktop/main.js)
   ├─ 复用 .port 的服务（活着就不重启）；死了用 ELECTRON_RUN_AS_NODE=1 起 server.mjs
   ├─ BrowserWindow：frame:false + transparent:true + hasShadow:false（大圆角靠页面裁）
   ├─ 托盘 / 全局媒体键 / 关窗到托盘 / 单实例
   └─ preload.js → window.__desktop（媒体键 + winControls）

server.mjs（零依赖）
   ├─ 网易云 weapi 代理（登录态 .session.json；匿名没有 YRC 逐字歌词）
   ├─ /api/img 图片代理、/segdict.bin 分词词典（1.26MB）
   └─ 静态文件 public/

public/
   ├─ index.html / app.css / app.js / tokens.css / player.js / beat.js / api.js
   ├─ stages/            65 个形态（自包含单文件，见 PARALLEL.md）
   ├─ win-controls.css   桌面壳窗口三键 + 登录位（浏览器版不挂载）
   └─ layout-lab.html / controls-lab.html   两个设计实验室
```

- 前端改文件 → **Ctrl+R 生效**；`desktop/` 改动 → **必须关掉应用重开**

---

## 3. 最近完成（10-25，别重复做）

| 事项 | 关键点 |
|---|---|
| **播放页排版** | 歌词窗口固定 **5.2 行**（`--ly-row` 按字号算），当前行锚定**歌词列正中**；左列（封面+歌名+传输）由 `alignArtToLyrics()` 下移让**封面中心贴上去**（实测 420/420/420）；进页面 700ms 后复算一次 + `ResizeObserver` 兜底 |
| **等比例缩放** | JS 算 `--ui-scale = clamp(.8, min(vw/1192, vh/910), 2.2)`，乘到封面列宽/歌词字号/间距/传输/标题上。用户窗口 **1192×910**，全屏 2560×1400 → 1.54 倍 |
| **播放键** | 三角 ⇄ 双条用 CSS `d` 形变（两个四边形 path，点数一致才可插值）；双杠间隙 2.6 |
| **传输排** | Apple 基准（实验室 01）：纯字形、无底板；悬停铺 15px 圆角淡底；按下 `scale(.86)`；播放键图标 34px |
| **播放模式** | 四种：顺序 / 列表循环 / 单曲 / 随机；`player.js` 的 next/prev 支持 loop 回绕与 shuffle；**两处按钮同步**（播放条 `#btn-mode` + 播放页 `#ntr-mode`），存 localStorage |
| **点歌词跳转** | `.ly` 带 `dataset.t`，点击 → `Player.seek(t)` 并滚到该句 |
| **进度条** | 播放头 = 2px 发亮细线（原来是 140px 径向白光，"太假"）；轨道加内阴影 |
| **窗口大圆角** | `main.js`：`frame:false + transparent:true + hasShadow:false`；页面：`body` 自身背景透明，白色底交给 **`body::before`**（见坑 #10） |
| **设置弹层** | 真液态玻璃：`.lg-surface` + 首次展开时 `LiquidGlass.mount` + `refresh`；`--lg-tint` 0.84 |
| **抽屉** | DIY 改下拉（「调整参数」）；进入形态改**两列**（66 项）；**节拍检测行已删** |
| **删除的功能** | 收起歌词（顶栏按钮 + 面板按钮 + 监听全删，面板常开）、播放页音量滑杆（"音量键"）、播放条封面的音符占位 |
| **文字提亮** | 非当前歌词 0.52 / 译文 0.58 / 副标题 0.72 / 抽屉标签 0.88 |
| **全量验收** | 10-25 跑过：65 形态 0 报错，59/65 ≥50fps（6 个不达标见 §4） |
| **播放页去标签** | 删掉歌词面板顶部那行小灰字「歌词」（它是绝对定位，删了不影响歌词列仍在正中）；顺带清掉已死掉的 `.now__tabs` / `.now__tab` 样式（HTML 里早就没这两个标签，`.queue` 容器保留为隐藏） |
| **禁止文本选择** | `app.css` 的 `body` 加 `user-select: none`（拖选歌名/时间戳会带蓝底），`input, textarea` 单独放行 `text` |
| **形态页操作条** | 底部那条播放条（`.stage__bar`）**整条删掉**。顶部换成和播放页 `.now__bar` 同款的一条 `.stagebar`：左「← 返回」（→ `show('now')`），右「当前歌曲 + ▦ 形态」。按钮 = `.btn--ghost.lg-surface.lg-sheen` + 播放页暗色参数（tint .12 / edge .26）。返回/离开形态时 `leave()` 清掉 iframe 的 `src`（隐藏的形态还在跑 rAF，白烧 CPU），下次 `enter()` 自动装回来 |
| **形态页迷你播放器** | 右侧那块平时只有 **1:1 封面砖（64×64）**，指针靠近右侧那一簇（`.sbar-right::before` 往左扩 300px 隐形热区，靠近不是压准）就横向展开 288px：歌名 / 歌手·专辑 + **上一首 / 播放 / 下一首** + **可拖的时间轴**（`#stage-track`，pointer capture 拖动）。全部代理到 `Player`，状态只有一份。静止 2.6s 整条淡出（悬停在条上不淡出）。折射贴图第一次展开才 `LiquidGlass.mount`（坑 #14） |
| **形态下拉** | 「形态」按钮**不再跳整屏画廊**，就地展开 `.smenu`（两列 66 项，暗玻璃，可滚、当前项高亮、Esc/点外面关）。点一项就地换，走原来的圆形蒙版 `irisSwitch`。整屏画廊 `layout` 只在设置面板那条路径里还留着 |
| **全窗口拖动** | 原来只有播放页有 14px 拖动带。改成全局 `.drag-strip`（`win-controls.css`，`body.is-desktop` 时 14px 高、z-index 70），主页/播放页/形态页顶部都能拖窗口；窗口三键 z 80 仍在上层 |
| **形态渲染画质** | 设置面板新增「画质 · 形态渲染」100/85/70/55%（存 localStorage `lizi.stageQuality`）。实现：`:root --stage-scale` → `.stage__frame` 布局尺寸 ×s、`transform: scale(1/s)` 铺回满屏，形态按缩小视口建 canvas，**像素数按 s² 掉**。这是不改形态文件就能降负载的唯一通用开关 |

**封面飞行转场的关键参数**（改前先懂为什么）：
切页那一帧给 `.view--now` 加 `no-layout-anim` 关掉 `grid-template-columns` 过渡，终点 rect 立刻是最终值
（不关的话终点会在 150ms 内滑 310px，旧版就是因此被迫等 700ms 才起飞）；
`body.from-track` 关掉 disc 的 `nowRise`（否则终点差 14px）；飞行期间 `body.is-cover-flying` 让 disc `opacity:0`，
落地 + 真封面 load 后交叉淡出；旧视图淡出压到 110ms，避免起飞头 100ms 叠影。

---

## 4. 已知问题 / 未完事项

- **6 个形态 <50fps**（归形态会话修，包工头不改形态文件）：
  `013 涟漪 34.6`、`006 风 34.9`、`020 网格地平线 44.8`、`007 铁屑磁场 46.1`、`012 洞穴 47.6`、`035 黏糊 48.3`
  - 026/038 报"全黑/静止"是 DOM 形态误报（smoke 只采样 canvas），不用管
  - 062 两次测 41.7 / 55.4，波动大，暂算过线
- **安装包过期**：`dist\LIZI Setup 1.0.0.exe` 是 17:08 的，之后又有 6 个 commit → **需要重跑 `npm run dist`**
- **排版实验室 20 版用户还没挑**（`layout-lab.html`）；挑完要把那套落地到真实播放页
- **100fps 目标（10-25 结论）**：父页面这层能榨的就三样 ——
  ① **形态渲染档位**（`--stage-scale`，像素数按 s² 掉；fill-bound 的形态立竿见影，006 在 70% 时 mean 67→139）；
  ② **形态页里不画节拍频谱**（已改：`beatUI.onFrame/onBeat` 在非 now 视图直接 return）；
  ③ 操作条的液态玻璃（在动画布上做 SVG 位移滤镜，013 实测差 ~10fps，但条 2.6s 就淡出，收益有限）。
  **剩下的差距在形态自己**：013 把 canvas 钉死 792×495，改视口尺寸一点不动（82~92 波动）；
  006 是满画布 1440×900，缩放立刻见效。真要人人 100+，得逐个改形态的渲染方式
  （WebGL/实例化、固定低分辨率、去掉每帧分配、别用 shadowBlur），那是形态会话的活。
  测量工具：`node _fps.mjs 013 006`（在父页面里跑、解除 vsync 上限、中位帧间隔、同一档跑两遍）。
  **并行会话在跑时数字全是噪声**，别拿单次结果下结论。
- `039-morph-blob-lyrics.html` 仍在被形态会话改动，别碰、别提交
- 004 参数（每字 650 只、"抽细"节奏）等用户审美反馈
- YRC 逐字时间需要登录；匿名时 003/004 按字数比例均分（预期行为）
- **大厅「点阵立方体」：两个 bug 已修好（10-26 v8），接入暂缓**：
  - 概念稿：`public/cube-menu.html`（独立 lab 页，**未接入应用**），`node _cubemenushot.mjs` 出截图。
  - **v8 已修好用户判定"三版都没修好"的两个 bug**，根因是同一处数学错误的两面：
    ① `CELL` 写成 `1/(N-1)`，实际格距是 `2*HALF/(N-1)` → 每格只画一半宽，面永远拼不成实心
      （覆盖 25%，75% 是洞），白字压在洞上就是「一坨白块」。
    ② 圆点用**屏幕像素**半径画 → 近乎侧对时 15 行点挤进 1~2px、alpha 叠加 → 棱上「深色锯齿条」。
    v8 改法：格距改对 + 每格四角逐个真实投影 + 外圈点朝面内收边（六面在棱处各占一半、永不越界）
    + 颜色预混到纸色、alpha 恒 1（半透明叠半透明会压深，那正是深色带成因）
    + 圆点改成沿面基的椭圆（随面压扁）+ **全场只出最朝前那一面的白字**。
  - **验证手段（三个探针，都留在根目录）**：
    `_cubesweep.mjs` pitch 全扫 37 个角度 → **白字面数恒为 1、无缺字角度**；
    `_cubeart.mjs` 216 个姿态扫暗像素 → 最暗 98.7（v7 的黑带接近 0）；
    `_cubeprobe.mjs` / `_cubestate.mjs` 单姿态诊断。帧率 164~167fps。
  - **用户 10-26 明确说「先不接了」**，大厅接入不做。要接时按 v8 视觉，方式同原计划（六面入口）。
  - 踩到的坑（值得记）：`cube-menu.html` 原来引了 Google Fonts 的 `<link rel=stylesheet>`，
    **它会阻塞内联脚本执行**，网络一慢整页白屏 —— 更坑的是让所有自动化验证结果失真
    （`yaw/pitch` 设完过 400ms 被主体脚本重置回默认值，截图全拍的是错姿态）。lab 页必须自包含。
- **四项可行性调研已完成（10-26，全部隐藏式实验，报告在 `_research/`）**：

  | # | 项目 | 结论 | 报告 |
  |---|---|---|---|
  | ① | 鼓组节拍检测（复现 Folia） | 🟢 能搬，F1 **0.918 vs 0.229** | `drumbeat-ab.md` |
  | ② | 智能过渡（复现 Folia） | 🟢 曲线能原样搬，前提是双 deck | `folia-automix.md` + `crossfade-light.md` |
  | ④ | Mixxx DJ 台接入 | 🔴 **不能嵌入，只能 MIDI 遥控** | `mixxx-feasibility.md` |
  | ③ | VST3 调音台 | 🟡 能加载（101/107），但 GUI 是死结 | `vst3-experiment.md` + `vst3-feasibility.md` |

  - **① 是唯一"立刻能看到效果"的一项**：Folia 的 `mods/visualizer52hz/beatDetector.mjs`（70 行纯 DSP），
    差异只有一处 —— flux 只统计低频 12 个 bin（21~260Hz），LIZI 现在统计全频段（~1000 bin），
    kick 被和声/噪声稀释 6 倍以上（90BPM 反拍场景 LIZI 召回 0）。改 `beat.js` 一行循环范围即可。
  - ② 必须先解决「单 Audio 单例」（`player.js:12`），双 deck 涉及 30+ 处引用，本身是一个独立会话。
  - ④ 的意外好消息：Web MIDI 在 Electron 33 里可用（`http://127.0.0.1` 下实测通过），不需原生模块。
  - ③ 的实测：本机 107 个真实商业插件，101 个成功加载并处理音频（94%），性能中位 32.4 倍实时。
    但 npm 上**没有任何可用的 Node VST3 宿主库**；GUI（Saturn 2 有 956 个参数）是真正的死结。
- 定位共识：**不做全能播放器，做最好看的歌词演出器**

---

## 5. 血泪坑（每条都真踩过）

| # | 坑 | 规则 |
|---|---|---|
| 1 | 会话堆到 17.8 万 tokens 后 LLM 开始空响应/超时，重试 3 次，用户消息全卡在 inbox | 一个会话只干一件事；大事拆多个会话 |
| 2 | 思考档位 max → 单步 10 万字符，撞输出上限/连接超时 | 档位用 **high** |
| 3 | 并发太多把请求推过超时线 | 同时跑的会话 ≤3~4 |
| 4 | `ELECTRON_RUN_AS_NODE=1` 在 DSH 环境里，`electron .` 退化纯 Node | 启动前先 `Remove-Item Env:ELECTRON_RUN_AS_NODE` |
| 5 | `.port` 被搅动 = 所有标签页作废 | 不起第二个服务；停服务按端口找 PID |
| 6 | `Get-Process node \| Stop-Process` 杀过用户其他项目 | 禁止 |
| 7 | 形态必须自包含单文件（无 CDN/外部字体/图片/emoji） | 见 PARALLEL.md §4 |
| 8 | smoke 的 fps 是当下机器帧率，并行跑全是噪声 | 只测一个编号；要准就空载 |
| 9 | git 命令并行会话不要跑 | 提交只由包工头做 |
| 10 | **CSS 背景传播**：`html` 没背景时 `body` 的 `background` 会铺满画布、**无视 border-radius** → 透明窗口四角发白 | 圆角背景用 `body::before`（fixed + inset:0 + radius）单独画，`body` 自身保持透明 |
| 11 | **批量 PowerShell 替换 CSS 把 `calc(` 括号改坏**，整页样式直接失效（用户正开着会看到白底裸页） | 改 CSS 用 `edit` 工具逐处改，或"末尾追加覆盖块"；改完数一遍 `{` `}` 和 `(` `)` 是否配平 |
| 12 | 透明窗口在 Windows 上会被 DWM 画一圈白边/阴影 | `frame:false + hasShadow:false + backgroundColor:'#00000000'` |
| 13 | `position:fixed` 在带 `transform` 的祖先里会退化成"相对该祖先" | 播放页音量滑杆就被 `.now__art` 的下移 transform 坑过（已删） |
| 14 | 面板 0×0 时挂载液态玻璃会生成 1×1 位移贴图，展开后折射跑位 | 首次展开时才 `LiquidGlass.mount` + `refresh` |

---

## 6. 文件地图

```
LIZI/
├── server.mjs                网易云代理 + 静态服务（零依赖）
├── desktop/main.js           Electron 主进程（窗口/托盘/媒体键/服务管理）
├── desktop/preload.js        window.__desktop 窄口子
├── public/
│   ├── index.html app.css app.js tokens.css player.js beat.js api.js
│   ├── stages/               65 个形态（自包含单文件）
│   ├── segdict.bin           分词词典 1.26MB
│   ├── win-controls.css      窗口三键 + 登录位（仅桌面壳）
│   ├── layout-lab.html       20 种播放页排版（等用户挑）
│   └── controls-lab.html     12 种传输排（已选 01）
├── build/icon.{ico,png}      LIZI 图标（Logo 已定稿）
├── dist/                     安装包输出（gitignore）
├── PARALLEL.md               形态会话规矩（形态会话第一读物）
├── DESKTOP.md                桌面壳细节
├── AGENT-BRIEF.md            形态开发规范（写新形态才读）
├── BRIEF-NEW-STAGES-2.md     061–070 第二轮任务书
└── gen-segdict.py            重新生成 segdict.bin
```

---

## 7. 新会话开工姿势

- **精修某个形态** → 发 `按 PARALLEL.md 做 0XX`（形态会话，别读本文档）
- **改共享文件 / 打包 / 验收 / 主界面** → 包工头（协调会话）
- 每次大改完：更新本文档 §3/§4，然后 git 提交（commit message 按编号/主题写清）
- 开新会话前：档位 **high**、一轮只干一件事

### 包工头交接（换协调会话时，整段粘给新会话）

```
读 HANDOFF.md 和 PARALLEL.md。你现在是 LIZI 的包工头（协调会话），接管这些职责：
① 改共享文件：public/index.html、app.css、app.js、tokens.css、player.js、server.mjs、desktop/
② 跑 register-stages.mjs（只有新增形态文件时）
③ git 提交（并行会话的产出由你收编，按编号整理 commit message）
④ 全量验收和帧率复测（必须串行，不能和形态会话同时跑）
⑤ 打安装包（npm run dist）

铁律：形态文件 public/stages/0XX-*.html 不归你管（别的会话在改）；
思考档位用 high；一次只干一件事；改共享文件前先 git status 确认没人在改。

当前已知待办（HANDOFF §4）：6 个形态 <50fps、安装包过期要重打、
用户还没挑 layout-lab.html 的 20 版排版。
```

### 主界面/播放页精修模板（发给包工头会话）

```
（接上面包工头交接那段）
第一个任务：<描述>。文件是 public/index.html + public/app.css（必要时 app.js）。
改前 git status 确认没人改；改完 node smoke-all.mjs 00 确认无报错，
并截图给我看（截图放 shots/review/）。
窗口相关的改动（desktop/main.js）要提醒我：必须重启应用才生效，Ctrl+R 没用。
```

---

## 附录：形态开发历史教训索引

```powershell
git show 71295db:HANDOFF.md   # 第 6 节 = 20 条坑（时间状态/字形采样/渲染性能/数学坐标）
                              # 第 7 节 = 60 形态机制清单 + "别重复设计"表
```

写新形态前**必读**第 6 节；改老形态前先查第 7 节避免机制撞车。

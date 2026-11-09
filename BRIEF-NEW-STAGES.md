# 补做 4 个缺失形态 · 任务说明（本轮）

项目根：`E:\DSHdesktop\work\music-player`
所有形态：`public\stages\`

**先完整读 `AGENT-BRIEF.md`**（协议 / 节奏模块 / 字形采样 / 锚点 / 16 条坑 / 性能目标都在里面）。
这份文件只写它没覆盖的、以及本轮必须注意的差异。

---

## 一、你负责一个形态（每人只做一个）

| 编号 | 文件名 | 中文名 | 源作品（只读参考） | 机制方向 |
|---|---|---|---|---|
| 046 | `046-hyperbolic-lyrics.html` | 双曲空间 | `E:\proiects\OPode\creative-100\sites\046-hyperbolic.html` | 庞加莱圆盘双曲镶嵌：圆盘内自相似地长满越靠边越小的多边形，歌词在镶嵌里穿行 |
| 048 | `048-sierpinski-lyrics.html` | 谢尔宾斯基 | `E:\proiects\OPode\creative-100\sites\048-sierpinski.html` | 谢尔宾斯基三角「无尽放大」：递归三角形，镜头不断下潜/句与句之间换层 |
| 049 | `049-double-pendulum-lyrics.html` | 双摆 | `E:\proiects\OPode\creative-100\sites\049-double-pendulum.html` | 双摆混沌轨迹：摆臂运动画出长曝光痕迹，轨迹本身构成画面，歌词附着在摆/轨迹上 |
| 050 | `050-superformula-lyrics.html` | 超公式 | `E:\proiects\OPode\creative-100\sites\050-superformula.html` | Gielis 超公式 `r(θ)` 变形：一组参数变形出无数轮廓，轮廓随歌词/踩拍变形 |

源作品是**视觉与算法的参考**，不是要复制。它们没有歌词系统，你要把它变成「把歌词演出来」的形态。

## 二、必须先读的实现范例（都已达标，风格基准）

- `public\stages\043-lissajous-lyrics.html` —— 数学曲线类，最接近你的题材
- `public\stages\045-voronoi-lyrics.html` —— 数学几何 + 歌词文本结合
- `public\stages\042-phyllotaxis-lyrics.html` —— 逐颗粒子生长
- `public\stages\057-truchet-dots-lyrics.html` —— 进度/节奏驱动 + 性能处理

看它们怎么：接协议、写 `timing()`、做背景/暗角/hint、控帧率、处理 `init` 重置。

## 三、硬要求（验收就在这几条上）

1. **自包含单文件**：不引 CDN / 字体 / 图片。
2. **不用 emoji**，图标用内联 SVG 或几何图形。
3. **协议完整**：`init` / `tick` / `beat` / 子→父 `ready` / `error`；并且**必须**转发
   `activity`（pointermove/pointerdown/wheel）和空格 `key`。少了这两条播放器控制条会藏死。
4. **节奏模块照抄 AGENT-BRIEF 第三节**：`curIdx` / `brewIdx` / `lastT` 分离，索引单调，
   时间倒退才清场。不要自己发明。
5. **歌词必须真的被演出来**：每一句都要在画面里可读地出现（可以是字形粒子、沿路径排布、
   逐字点亮，但不能只画抽象几何、歌词只是个摆设）。`init` 的 `lines[i].text` 是整句，
   `chars` 是逐字时间。
6. **换歌/重置**：`init` 时必须清掉上一首的所有粒子/状态并把 `lastT` 归 -1。
7. **性能 60fps**：目标是无头 Chrome（`--disable-gpu`，1440×810）实测 ≥ 50fps。
   避开 AGENT-BRIEF 第 ⑨⑩⑪⑯ 条：逐颗拼颜色字符串、逐颗 beginPath、逐帧 createRadialGradient、
   网格加速切太细。
8. **标题** `<title>` 用中文名，`<body data-chrome="off">`，有一个 `#hint`。

## 四、风格基准（这几条决定"像不像这个项目"）

- 背景不要纯黑一块：用 `radial-gradient` 或 canvas 的径向辉光做纵深。
- 加一层暗角 `#vig`（radial-gradient 到边缘变暗），可选加一层极淡的扫描线/噪点。
- 主色从 `init` 的 `accent`（封面主色 `[r,g,b]`）派生，**不要写死颜色**；用 HSL 或
  对 accent 做提亮/降饱和派生出一组色，形态整体色调跟着封面走。
- `#hint` 用 `ui-monospace` 11px、`letter-spacing:.08em`、低透明度，唱起来后淡出。
- 中文排版用系统字体栈：`"PingFang SC","Microsoft YaHei",system-ui,sans-serif`。

## 五、验证（必须做，按顺序）

```powershell
cd E:\DSHdesktop\work\music-player

# 1) 语法（必须 OK）
node -e "const fs=require('fs');const h=fs.readFileSync('public/stages/046-hyperbolic-lyrics.html','utf8');const m=h.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);try{new Function(m[1]);console.log('OK')}catch(e){console.log('FAIL '+e.message)}"

# 2) 运行时 + 帧率 + 画面（服务器已在跑，端口见 .port；只测你自己这个）
node smoke-all.mjs 046

# 3) 截图看观感（用 read_image 打开看到的 png 自己判断）
node shot.mjs 046
```

`smoke-all.mjs` 的验收：报错「无」、fps ≥ 50、画面「有内容/在动」。
**如果 fps 偏低**：先看是不是自己跑着别的东西、以及是否命中了上面第 7 条；
重跑一次确认。最终以我这边串行的复测为准。

截图要**真的用 `read_image` 看一眼**：字是不是可读、是不是被裁、是不是全黑、构图有没有纵深。
不满意就改，别只靠脚本的「有内容」判定。

## 六、绝对不要做

| ❌ | 原因 |
|---|---|
| 改 `public\app.js` | 注册表由我统一跑 `register-stages.mjs` 重建 |
| 跑 `register-stages.mjs` | 多个代理同时跑会写坏 app.js |
| 改别的形态文件 / `server.mjs` | 不是你的范围 |
| 启动或重启服务器 | 已经在 5456 跑着，重启端口会变、用户标签页全废 |
| `Get-Process node \| Stop-Process` | 会杀掉用户**其他项目**的 node 进程 |
| 动 `E:\proiects\OPode\creative-100\` | 用户原始素材，只读 |
| 用 emoji / 引外部资源 | 硬要求 |

## 七、返回格式

用 JSON 返回（不要贴整段代码）：

- `file`：绝对路径
- `mechanism`：一句话说明核心机制与歌词怎么结合
- `syntax`：语法检查结果
- `smoke`：`{ fps, motion, error }`（smoke-all 实测）
- `shot`：截图路径 + 你从图里看到的一句话评价
- `notes`：不确定的地方 / 已知不足

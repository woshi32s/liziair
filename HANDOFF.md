# LIZI · 包工头交接文档

> 最后更新：2026-10-28 03:30（多音源 + 音效 EQ + DJ 台换代 + 歌手/专辑页 + 大厅两个交互重做之后）
> LIZI = 网易云歌单 + 116 个歌词可视化形态的 Electron 桌面应用（零依赖 Node 服务 + 纯前端）。
> 本文档是**包工头（协调会话）**的交接。形态会话读 `PARALLEL.md`（很短），不要读本文档。
> 上一版交接（10-27，含大厅 V4 + 音乐实验室）归档在 `HANDOFF-archive-1027.md`。
> 工作目录：`E:\DSHdesktop\work\music-player`

---

## 0. 一句话现状

服务在跑（**端口 11701，以 `.port` 为准**），**74 个提交**，最近三笔：`75c7f35`（B 组第三批 249+270-279）、`0312bc1`/`6163064`（A 组 230-239、C 组 250-259）、`018dec7`（大厅头像被白雾洗掉 + 顶栏只留小人图标）。

**用户已登录成功**（uid 8498237749 / `King-8I4`，走 `services/netease-api` 边车）。形态总数 **235**（原有 65 + 新增 70 + lizi 系列 100）。

已交付待用户验收的：**DJ 台换代**、**6 个音源边车**（QQ/酷狗/汽水/波点/Spotify/网易云）、**音效设置**、**歌手页/专辑页**、**大厅个人卡（吸底 + 6 平台轮播 + 主页背景三态）**、**大厅海报（悬停实时歌词 + FLIP 飞入播放页）**、**设置整页**、**我的专辑（侧立 3D / 正面 Cover Flow）**、**70 个新形态**、**宣传片素材包**（`promo/`）。

**还没做/没定**：形态还可再扩（A 组 260-269、C 组 280-289）；安装包是否带 `services/**`（`npm run dist` 现在会漏掉音源）；静态背景验证待用户操作。详见 §6。


---

## 1. 怎么跑

| 想干什么 | 命令 |
|---|---|
| 起网页服务 | `node server.mjs` → 真实端口写进 `.port` |
| 开 LIZI 窗口 | **先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`**，再 `npm start`（或 `electron .`） |
| 打安装包 | `npm run dist` → `dist\LIZI Setup 1.0.0.exe`（**现在会漏掉 services/**，见 §6①**） |
| 单测一个形态 | `node smoke-all.mjs 005` |
| 全量验收（必须串行） | `node smoke-all.mjs`（116 个，约 11 分钟） |
| 形态截图 | `node shot.mjs 005` |
| 重建形态注册表 | `node register-stages.mjs`（**只有新增形态文件才需要**） |

### 边车（音源服务）

| 平台 | 端口 | 手动起 |
|---|---|---|
| QQ 音乐 | 3210 | `node services/qq-api/start.mjs` |
| 酷狗 | 3211 | `node services/kugou-api/start.mjs` |
| 汽水 | 3212 | `node services/qishui-api/start.mjs` |
| 波点 | 3213 | `node services/bodian-api/start.mjs` |
| Spotify | 3214（+ OAuth 回调 **固定** 5588） | `node services/spotify-api/start.mjs` |
| **网易云（登录用）** | **3215** | `node services/netease-api/start.mjs` |

> 网易云这个边车是 `@neteasecloudmusicapienhanced/api@4.41.1`（Folia 同款），**只用来登录**；登录成功拿到 `MUSIC_U` 后写进我们自己的 `.session.json`，数据接口仍走我们自己的 weapi。
> 它带了一个 IP 补丁：`randomCNIP` + `global.cnIp`，不让请求把 `127.0.0.1` 当来源 IP（Folia 那个 patch 的等价物）——**没有这个补丁，扫码会被 8821 风控**。
>
> ⚠️ **不要再跑 `register-stages.mjs`**：它的过滤器只认 `/^\d{3}-/`，会**删掉 STAGES 里 100 个 `lizi*` 条目**（另一条会话的作品）。新增形态用根目录的 `_merge-stages.mjs`（增量、只加不删）。

**平时不用管**：第一次请求 `/api/<源>/*` 时 `server.mjs` 自动 spawn（cwd = 对应 services 目录），进程死了下次请求自动重起；主服务退出后 ≤5s 自己收工（盯父进程 pid）。
端口优先级：`<NAME>_API_PORT` → 上次的 `.port` → 固定缺省；被占/落进 Windows 保留段就退回系统分配并回写 `.port`。**全部只绑 127.0.0.1**。

### ⚠️ 端口别写死 5456

`server.mjs` 的 `preferredPort()`：读 `.port` → **立刻删掉** → 试绑，绑不上退回系统分配。所以端口**每次重启都可能变**。
Windows 保留段实测扩过：`5358–5457`、`12684–13083`、`5358–5457`（含 3200/3210 附近要小心）。

```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```

**端口一律以 `.port` 为准**，`desktop/main.js` 也读它。给用户地址前先 `Get-Content .port`。

- 用户不会自己启动应用 → 要看效果时**你帮他起**（`Start-Process ... -WindowStyle Hidden`）
- 服务已在跑时**别再起第二个**；停服务按端口找 PID，**禁止** `Stop-Process -Name node`
- ⚠️ Electron 用 `ELECTRON_RUN_AS_NODE` 起的服务跑在 **Node 20.18.3**，手动 `node server.mjs` 是 **24.11.1**。汽水/波点要求 **≥24**，`server.mjs` 会先探版本，不够就不 spawn 并让 UI 置灰。

---

## 2. 架构（30 秒版）

```
desktop/main.js      Electron 主进程：找/起服务 → BrowserWindow；窗口三键自己画
server.mjs   ~1400行 零依赖 HTTP 服务：静态文件 + 网易云 weapi 转发 + 封面代理
                     + 5 个边车管理器（按需 spawn/重起/健康检查）+ 音源音频代理（转发 Range）
services/
  qq-api/ kugou-api/ qishui-api/ bodian-api/ spotify-api/
                     各带 package.json（钉死版本）+ start.mjs + .gitignore + README
                     node_modules 全部被自己的 .gitignore 挡住（不进仓库）
public/
  index.html   ~70KB  单页外壳：玻璃顶栏 + 8 个 view + 播放栏 + 播放页抽屉 + 设置面板
  app.js      ~4250行 全部交互：视图/大厅/实验室/播放页/抽屉/设置/登录/音源
  app.css      —      全部样式（含大厅、实验室、吸底卡、海报动画）
  tokens.css          设计令牌（OKLCH 纸/墨、字阶、圆角、4pt 间距、缓动）
  player.js            Player 单例：**单** <audio>、队列、歌词 YRC/LRC、封面取色
  beat.js             实时 BPM 检测 + **音频图的持有者**（见下）
  api.js              前端 API 层（都走 /api/*，封面走 /api/img 代理）
  vendor/soundtouch.js  soundtouchjs 0.3.0 dist（**ESM**，24.5KB，keylock 用）
  lab/      dj-engine.js(931行) dj.js(1366) dj.css(382)      DJ 台（对标 Mixxx）
  pages/    nav.js artist.js album.js util.js pages.css      歌手页/专辑页（ESM，按需 import）
  audio/    eq-engine.js eq-ui.js eq.css                    音效（7 段 EQ + Pro-Q 式高级）
  hall/     accounts.js                                     大厅个人卡的多平台注册表
  stages/   116 个形态（**不是包工头的**）
```

### 关键：音频图在 `beat.js` 里，不在 `player.js` 里

`player.js` 是**裸 `<audio>`**，没有 Web Audio 图；`beat.js` 才调 `ctx.createMediaElementSource(el)`（**同一个 `<audio>` 只能调一次**）。
所以 EQ 是这么插进去的：

```
srcNode → 7×BiquadFilter → 前级 → M/S 宽度 → analyser → destination
                                              └→ Beat 的 BPM/频谱都吃这个 analyser
```

`beat.js` 只加了一个钩子 `Beat.onGraph(cb)`（+27 行，其中 17 行是注释），在 `srcNode.connect(analyser)` 之后 fire，把 `{ctx, src, analyser}` 交出去。
**动音频链的人必须保住这个 analyser 的信号**，否则 BPM 检测和 116 个形态的可视化一起死。

### 视图（`show(next)` 切换）

| view | 作用 | 顶栏左键 |
|---|---|---|
| `view-hall` | **入口**。巨幅海报（上次播放）+ 工具箱 + 我的卡 + 本日推荐 + 精选 + 推荐歌单墙 | 齿轮（只有这里能开设置） |
| `view-browse` | 搜索结果/歌单曲目（顶部有音源切换：全部/网易云/QQ/酷狗/汽水/波点/Spotify） | 液化成返回箭头 → 回大厅 |
| `view-lab` | 音乐实验室：DJ 台 / 自动过渡 / 插件 | 返回箭头 |
| `view-now` | 播放页（暗场、歌词、抽屉里切形态） | — |
| `view-stage` | 形态全屏 | — |
| `view-artist` | 歌手页（头像+统计+热门+专辑墙+全部歌曲） | 返回（按访问栈） |
| `view-album` | 专辑页（380px 大封面 + 信息 + 曲目，**曲目行无封面**） | 返回 |
| `view-audio` | 音效整页（从设置进；播放页里是半页覆盖，52%） | 返回 |

**关键布局约定**：`view-hall` / `view-lab` / `view-browse` / `view-artist` / `view-album` / `view-audio` 都是
`top:0` + `padding-top: calc(--topbar-h + --sp-5)` + 背景 `#fff`，这样内容往上滚时会**从玻璃顶栏下面经过并被折射**。
**顶栏、窗口圆角、背景光斑一行都不能动**，新视图**必须**进 `bindTopbarScroll()`。

---

## 3. 这一批做了什么

### ① DJ 台（`public/lab/`，对标 Mixxx 2.5.6）
双 deck + 混音台 + 曲库。载入（本地文件/队列/搜索/**拖行**）、CUE、转盘搓碟（颗粒合成，**中央嵌专辑封面**跟盘转）、pitch ±8/16/50、**keylock**（soundtouch）、离线 BPM + 首拍 + 拍网格、**SYNC**、热键 1~8、loop（按拍长 + ×2/÷2 + beatjump）、滚动细节波形 + 概览、trim/3 段 EQ（真 kill）/filter、通道推子、等功率横推、master、L/R 峰值表、每 deck 一个 FX、键盘全套。
**离开碟机 = 暂停**（三条路径都覆盖，退出后 `maxRMS=0`）。

### ② 多音源（5 个边车）
统一 `{code, ...}` 形状 + 统一 `{ id, source, name, artists, album, cover, duration }` 曲目形状。
| 平台 | 搜索 | 播放 | 硬限制 |
|---|---|---|---|
| QQ | ✅ 998 首 | 试听片段 | 无会员只有 30~60s；`preview=1` |
| 酷狗 | ✅ 480 首 | ❌ 需登录 | 匿名恒 `20028 本次请求需要验证`（天御风控），换设备/试听模式都没用 |
| 汽水 | ✅ | ✅ 真出声 | 30s 试听；**仅中国大陆网络**；`qishui-music-api` 要 **Node ≥24** |
| 波点 | ✅ | ✅ 真出声 | 30s 试听；仅大陆；包是 **AGPL-3.0** |
| Spotify | 需自备 Client ID | 🚫 恒 `drm` | 音频要 librespot 原生二进制 + Premium，本期只做骨架 |

### ③ 音效（`public/audio/`）
- 大厅设置 → 音效 = **整页**；播放页 = **半页覆盖**（实测 52%，同一套 DOM 实例）
- 音质：标准/较高/极高/无损/Hi-Res，`server.mjs` 按 level 切 `encodeType`
- **7 段 EQ**：60 / 150 / 400 / 1k / 2.4k / 6k / 12k，±12dB，滑杆
- **10 套预设**：平直/流行/人声突出/低音增强/电子/摇滚/古典/沉浸现场/3D 立体环绕/夜间
- **高级模式**（照 Pro-Q 4 的交互，不嵌 VST3）：对数轴 20Hz–20kHz、±24dB、7 个可拖节点、滚轮改 Q、双击旁通、右键切 Bell/Shelf/Pass/Notch、背后实时频谱、曲线用 `getFrequencyResponse()` 画**真实响应**

### ④ 歌手页 / 专辑页（`public/pages/`）
歌手：120px 头像 + `45 张专辑 · 582 首歌` + 简介 + 热门 10 首 + 专辑墙（12/批，加载更多）+ 全部歌曲（先拉 100 首、页内过滤、热度/时间排序）。
专辑：**左边 380px 大封面、右边信息**，曲目行 `#/标题/艺人/时长`，**整页只有那一张封面**（用户明确要求）。
全站入口：搜索结果/队列/播放页/大厅 hero/DJ 曲库的艺人名 → 歌手页，专辑名/封面 → 专辑页，顶栏返回按**访问栈**回退。

### ⑤ 大厅个人卡（吸底 + 6 平台轮播）
- **吸底**：卡片 `position: sticky`，行程 = 封面从 150 长到 330（跑道 180px）
- **跑道不留白**：`.me-wrap` 用负 margin 把下一节提进跑道，卡片白底 + `z-index:2` 就地压住它（早期版本留 180px 纯白，像布局塌了，已修）
- **虚化减弱**：`blur(14px)` → **`blur(5px)`**
- **6 平台轮播**：`public/hall/accounts.js` 是可扩展注册表（`check()` / `detail(key)`），右侧细线箭头横向切换，每张卡带平台标记色；**只有一个平台时箭头隐藏**，零平台退化成示例卡（uid 1）；记平台用 **id** 不用索引

### ⑥ 大厅宽幅海报（悬停展开歌词 + FLIP 飞入播放页）
- 悬停：封面缩成 **344×344 贴左下角**（left/bottom 误差 0px），右侧让出的空白显示歌词，**字号/行距与播放页完全一致**（52.752px / 65.4125px）
- 点击：**FLIP 替身层**（`position:fixed`）承接飞行，封面 translate + 等比 scale、歌词只 translate，420ms；落位 **ΔX=0 / ΔY=0.1px**
- `prefers-reduced-motion` → 飞行 0ms；`Tab` 聚焦 = 悬停，`Enter` = 点击
- 无歌词不留空框（给一行提示）、无历史曲目点击不飞、快速连点有锁、悬停中滚走自动收起

---

## 4. 运行/开发坑（都真踩过）

1. **`ELECTRON_RUN_AS_NODE=1` 不清理，`electron .` 会退化成纯 Node**，窗口起不来
2. **Google Fonts 的 `<link rel=stylesheet>` 会阻塞内联脚本** → 用 `media="print" onload="this.media='all'"`
3. **`is-stuck` 绑在具体滚动容器上**，新视图忘了绑，用户第一句就是「我的灵魂呢」
4. **半透明卡片会透出下层网格线**；DJ 台/大厅卡都不要半透明
5. **`#stage-menu-list` 不能删**（播放页抽屉抄它的 innerHTML）
6. **波形用 `max` 归一化会画成一堵灰墙** → 95 分位 + 幂压缩 0.62；DJ 台每格要用窗口 **RMS**（压死的母带 p95=1.0，量过）
7. **`AudioBufferSourceNode.playbackRate` 不接受负值**，倒放/搓碟必须走颗粒合成
8. **`createMediaElementSource` 对同一个 `<audio>` 只能调一次** —— EQ 必须插进 `beat.js` 已有的图
9. **`soundtouchjs` 的 `PitchShifter.percentagePlayed`：setter 要 0..1，getter 返回 0..100**（库自己的不对称）。传错 → 整条 master 链变 NaN
10. **`AudioParam.setTargetAtTime` 之后 `.value` 读不到自动化值**（读回 intrinsic），要自己记命令值
11. **不要用「shelf 后面串增益」做 EQ kill**（会把整条信号置零）；kill = shelf 打到 −80dB
12. **Chrome 的 sticky `top` 是相对滚动容器内容盒算的**：`#view-hall` 有 84px padding，写 `top:80` 会落到 164
13. **必须 `overflow-anchor: none`**：封面长高会触发 scroll anchoring，实测「滚 100px」被放大成「滚 370px」
14. **汽水 CDN 带 Referer 反而 403**（不带 → 206），`AUDIO_REFERER.qishui = ''`
15. **汽水封面不带模板会 400**，必须拼 `~tplv-b829550vbb-image.image`
16. **酷狗那个包在 npm 上不存在**（`npm i kugoumusicapi` 404），要用 GitHub tag 归档 URL 装
17. **QQ 边车别绕过 `start.mjs` 直接跑包的 app.js**：包默认 `listen(port)` 绑 `0.0.0.0`，`start.mjs` 靠给 `net.Server.prototype.listen` 打补丁才只绑回环
18. **Node 20 的 `console.log` 在 stdout 关闭时抛 EPIPE 会把进程打死**，`start.mjs` 已吞
19. **`_djcheck.mjs` 已失效**（找的是旧深色面板），DJ 台一律用 `_djlab.mjs`
20. **`stub()` 是个 Proxy**，`$()` 找不到元素不报错 —— 界面没反应先怀疑 id 写错

---

## 5. 别碰的东西

- `public/stages/**`（尤其 `039-morph-blob-lyrics.html`，另一条会话在改）
- `public/stages/lizi*.html` + `LIZI-BRIEF.md` / `LIZI-PLAN.md` / `LIZI-NEXT.md` / `LIZI-POLISH.md`
  + `lizi-register.mjs` / `_lizi*.mjs` / `_fix*.py`（另一条「lizi 系列」会话的产出，未跟踪）
- 形态文件一律不是包工头的；**只有新增形态文件出现**时才跑 `register-stages.mjs`
- 根 `package.json` 的 `build.files`（见 §6①）—— 要改先跟用户确认

**改共享文件前先 `git status`。** 这一批有 5 个代理并发改过 `app.js` / `index.html` / `app.css` / `server.mjs`，
`app.js` 里能同时看到大厅卡、海报动画、音源分流三拨人的改动。
规矩：**改前重读、用唯一锚点、绝不整文件覆盖、改完 `node --check`**。

---

## 6. 待办（按性价比排序）

### ①【要用户拍板】安装包要不要带 `services/**`
`npm run dist` 的 `build.files` 里**没有** `services/**`，所以装完 QQ/酷狗/汽水/波点/Spotify **全部不可用**（UI 会显示「边车没安装」）。
带上要多 ~13MB（5 份 node_modules）+ 需要把 `services/*/node_modules` 从 `.gitignore` 之外单独打包。**要改根 `package.json`，等用户点头。**

### ②【要用户拍板】队列入口
新版播放页把 `#now-tabs` 删了，而 `$()` 的 stub 让它「看起来还在」—— `#queue` 现在**没有任何 UI 入口**，`renderQueue` 是死代码。

### ③【要用户拍板】DJ 转盘静止时要不要回正 0°
现在是物理正确的（46s ≈ 4.25 圈，停任意角度）。回正是 `--rot` 只在 `playing||scratching` 时写，**一行的事**。

### ④ QQ / 汽水 / 波点 / 酷狗 的登录都还没真扫过
二维码、轮询、过期换码（180s TTL + 15s 冷却）都验过，但**真实扫码要用户本人**。
登录后的收益：QQ 全曲、汽水/波点从 30s 升整首、酷狗解锁播放。

### ⑤ 无损音质是上游限制，不是我们的 bug
匿名请求 `lossless`/`hires`，上游**静默降级**成 `exhigh/320k`；`encodeType` 改 `flac` 与 `mp3` 返回**一字不差**。代码路径已按 flac 写对，登录会员才会真给。
**匿名还拿不到 VIP 曲（fee=1）的直链**，只能播免费曲（fee=8）—— 这解释了「周杰伦搜出来点不响」。

### ⑥ 形态全量验收
`node smoke-all.mjs` 必须串行（约 11 分钟）。这一批改过 `beat.js`（加了钩子）和 `api.js`，**跑之前先确认形态没被连累**。

### ⑦ DJ 台与 Mixxx 的已知差距（如实）
搓碟绕过 keylock（搓的时候会变调）· keylock + loop 接缝有 ~85ms 顿挫 · SYNC 是一次性对齐（没有 sync-lock/quantize）· PFL 没有独立耳机口（本机只有一路输出，是混进主输出的，UI 已写明）· BPM 做了「往 88–190 折」的取舍，真慢歌会报成两倍且没有 ×2/÷2 手动纠正 · 曲库没有封面之外的排序/标签编辑 · FX 单槽 · 电平只有峰值档。

---

## 7. 验收工具（都在仓库根，跑完自己看结论）

| 脚本 | 验什么 |
|---|---|
| `_djlab.mjs` | **DJ 台**：12 条主断言 + 12 条附加（含 keylock 频谱差、SYNC 误差、横移 −3.01dB、热键 10.7ms、转盘封面、退出即暂停、拖行载入、xfade 演示音退出即停） |
| `_pages.mjs` | **歌手/专辑页**：入口、统计、专辑墙 12→24、专辑页曲目 `img=0`、访问栈、页内搜索、排序 |
| `_eqcheck.mjs` | **音效**：11 条（频响误差 0.043dB、Q 带宽 11.44×、画布误差 0.075dB、半页 52%、音质真实降级） |
| `_sources.mjs` | **5 个音源**：59 条（health/端口/二维码/搜索/播放/回归），可 `node _sources.mjs kugou` 单跑 |
| `_qqcheck.mjs` | QQ 单源 23 条；`_qqexpire.mjs` 真等 3 分钟验过期换码 |
| `_hero.mjs` | **海报交互**：16 条（悬停贴角 0px、同字号 0.00px、FLIP ΔY 0.1px、reduced-motion 0ms、无歌词兜底、键盘） |
| `_mesticky.mjs` | **吸底卡**：7 条（静止 80px 间距、吸底 80、封面 150→330、松手、可逆） |
| `_mecard.mjs` | 吸底卡 + 6 平台轮播（数值已同步到 330/180） |
| `_hallshot.mjs` / `_settingscheck.mjs` / `_hallcover.mjs` / `_hallplay.mjs` | 大厅与设置面板 |
| `_five.mjs` / `_cards*` / `_pool*` / `_cube*` | 被否掉的两个大厅版本与点阵立方体菜单（留档） |
| `lizi-check.mjs` / `e2e-stages.mjs` / `smoke-all.mjs` | 形态验收 |

**截图都落在 `shots/review/`。** 脚本自己起无头 Chrome（CDP），跑完自己清理临时 profile。

一个反复踩的测试坑：**固定 `sleep` 等不到页面就绪**。要轮询判断（等 `#dj-lib tbody tr`、`#hall-me .me-wrap` 之类出现），不要写死时间。
另一个：**无头 Chrome 里 `AudioContext` 是 48000Hz**（不是 44100），`decodeAudioData` 会重采样；离线 BPM 另外用 11025Hz 的 OfflineAudioContext 低通后再算。

---

## 8. 调研结论（都实测过，别再重查）

**① 鼓组节拍检测**（`folia-major/mods/visualizer52hz/beatDetector.mjs`，70 行）
只取低频段（`LOW_BIN_START=1, LOW_BIN_END=12`），阈值 `max(FLOOR, mean + 1.8/sensitivity·deviation)`。
A/B 实测：**F1 0.918 vs 现版 0.229**。现版 `beat.js` 的毛病：谱通量用了全部频段且除以 `freq.length`，被高频摊薄。
> 时间戳要取窗口**末端** `(s+FFT)/SR`，取起点会偏早 ~30ms。

**② VST3 / FabFilter Pro-Q 4**：本机 107 个商业插件，**101 个能加载并处理音频（94%）**，中位 32.4× 实时。
但 **AudioWorklet 调不了原生模块**（没有 require/module/window）；npm 上没有可用的 Node VST3 宿主。**真正的死结是 GUI**（Saturn 2 有 956 个参数）。
所以「高级 EQ」是**照 Pro-Q 4 的交互复刻**，不是嵌插件。

**③ Mixxx 为什么搬不进来**：Qt6/C++ GPLv2+ 的独立桌面程序；**2.5.6 没有 OSC / 没有 Ableton Link**（exe 和所有 .qm 里 "Ableton" 出现 0 次，PR #10999 仍未合并）；只有单向 MIDI 遥控，且 Windows 没有内置虚拟 MIDI 口（要 loopMIDI）。
实测：`SetParent` 把 Mixxx 主窗口挂进 Electron **失败**（Qt 窗口立刻 `GetParent` 回 0）；内存 **1.52GB 稳态 / 1.93GB 私有 / 80~88 线程**，磁盘 344MB。
**结论：不内嵌界面，改为照它的水准重做（已落地）。**

**④ 音频接入的实测结论**（当时为「接 Mixxx」探的，对将来接任何外部播放器都适用）
- Electron 回环采集（`getDisplayMedia` + `audio:'loopback'`）**能用**：抓到另一个进程的 880Hz、FFT 峰 879Hz；约束 `echoCancellation/autoGainControl/noiseSuppression:false` + `channelCount:2`
- 但**ASIO4ALL 一起，整个默认端点被独占**，回环连对照 WAV 都听不见 → 要么 Mixxx 输出改 WASAPI 共享，要么走它的直播推流（引擎级取流，不受声卡影响）
- 网易云个人主页：`weapi /v1/user/detail/{uid}` **匿名就能拿到**头像/背景图/签名/等级/听歌量/关注粉丝；`/v1/play/record`、`/v1/event/get` 要登录。背景图**不吃 `?param=`**（937×832 固定），头像吃。

---

## 9. 设计语言（别自己发明）

取自 `tokens.css` + 播放页 + 大厅：

- 纸白 `#fdfcfa`、墨黑 `#17171a`、四档灰 `--ink-2/3/4`
- **不用卡片盒子**，靠 **1px 细线** 和**留白**建立秩序
- 圆角极小（封面 2~3px，胶囊 999px，面板 4px），阴影**只给封面**，且极柔
- 小字 12.5 / 10.5 / 9.5；只有标题放大（`clamp(28~64)`，字距 `-.035em`）
- 等宽字体**只**给序号、时长、英文小标；数字一律 `tabular-nums`
- 深色只出现在播放页和 DJ 面板的暗色控件
- 网易云红 `oklch(62% .22 12)` 是唯一强调色；各音源的品牌色**只**用于那枚平台标记的文字/1px 边框
- 动效只用 `--ease-out` / `--ease-inout` / `--ease-apple`，360–520ms；**只动 transform/opacity**；`prefers-reduced-motion` 必须有兜底

**用户口味记录**：**拒绝了**卡片大厅（iOS 小组件味）和池核版（超现实但不像他），**选了** V4 巨幅封面（编辑部/印刷品气质）。
DJ 台明确要**纯白专业**（像白色硬件说明书），不要玩具感。
他没说清楚要什么时——**一次给 4~5 个具体方案让他挑**，别只给一版。

---

## 10. 10-29 增量（形态 39 个 + 设置整页 + 我的专辑 + 主页背景 + 登录打通）

### 形态：新增 39 个（200-209 / 210-219 / 220-229 / 240-248）
- 三组风格：**A 字形与排版**、**B 材质与光影**、**C 空间与场**；B 组第二批差 `249`
- 协议与质量门槛写在 **`STAGES-BATCH.md`**（父→子 `init/tick/beat/live`，子→父 `ready/error/activity/key`，自查 `window.__stage()`）
- 验收：`_stageverify-new.mjs`（可传逗号分隔前缀只测某几个），逐项 ready<2s / tick 推进 / 跳 5 秒 / 空歌词 / 暂停冻结 / resize / reduced-motion / 0 console error
- **注册用 `_merge-stages.mjs`**（增量、只加不删）。⚠️ 别跑 `register-stages.mjs`，它会删掉 100 个 `lizi*` 条目

### 设置改成整页
- `#view-settings`（账号 / 音源 / 音效 / 外观 / 关于），齿轮进页、顶栏左键变返回
- 旧 `#settings-panel` 连玻璃挂载一起删；**`#stage-menu-list` 必须保留**（播放页抽屉复制它的 innerHTML）
- 行 id 全部沿用（`qq-*`、四家音源三件套、`row-audio`、`row-maform`…），所以接线没动

### 我的专辑（两形态）
- **侧立 3D**（默认，照用户给的 `3d_cd_cover_flow.html` 移植）/ **正面 Cover Flow**，设置里切
- 封面 `clamp(360, min(vw*0.62, vh*0.78), 1400)`（1440×900 → 702px，占短边 78%）
- 立脊：**封面取色**（色相直方图）+ **脊顶小标**；背景三层（主色晕 0.38 / 落地光 0.18 / 轻暗角）
- 玩法：拖拽/横滚转整排、`←→` 选、`Enter` 或点击 = **特写开合**（56% 滑出黑胶 + spinVinyl），`Esc` 收回，特写内「查看专辑」才进专辑页

### 大厅「我的」卡的主页背景（三态）
- 网易云返回**公用默认图**（`2zSNIqTcpHL2jIvU6hG0EA==` 等 2 张，3 个账号同图）→ **不画**，改用**头像色相的动态渐变**
- 自定义：粘 URL / 本地文件（`blob:`，刷新失效）/ 清除；视频 3s 内没 `loadeddata` 退回渐变
- 优先级：自定义 > 网易云非默认背景 > 头像色渐变

### 网易云登录（终于通了）
- 走 `services/netease-api`（Folia 同款包 + IP 补丁），803 时**当场**把 `body.cookie` 写进 `.session.json` 并校验
- 兜底：设置 → 账号 → 「或粘贴 Cookie」，粘 `MUSIC_U` 即可

### 这一轮踩到的坑（新加的，别再踩）
1. **`video/timeline/all` 是"视频时间线"（关注+推荐混合），不是"我发布的视频"** —— 我据此做的「从我的视频里挑背景」列表里全是别人的视频，已整块拆除（`c662b63`）
2. **网易云个人主页的"动态视频背景"在接口侧拿不到**：weapi/eapi 两套 detail 的 `profile` 里 0 个 video 字段；用真 cookie 开网页版主页抓包 **0 个 media 请求**
3. **边车 803 的响应里 `cookie` 字段就是唯一一次登录态**，拿到就写；**不要用同一个 key 重查**（二维码 key 一次性，必回 800「已过期」）—— 这就是用户看到的"803 800 什么的"
4. **那张星空是公用默认背景**（采集 8 个 uid 得出：4 个各有自己的图、4 个共用它），别当用户自定义图
5. **`_maforms.mjs` 已过时**（还按 864px 断言），我的专辑现在以 `_mabig.mjs` 为准
6. **`.btn { display:inline-flex }` 会盖掉 `[hidden]`** —— 内置弹窗里新加的按钮要 `hidden + style.display` 双写
7. **跑真实 Electron 做窗口验收会把用户机器搞崩**（有代理反复最大化/最小化），窗口类改动一律静态检查 + 无头验证，最后让用户点一下

---

## 11. 10-30 增量（形态补齐到 235 + 两个 UI bug + 宣传片素材）

### 形态：这一轮合计新增 70 个（编号 200-279 区间，分 7 批）
- A 字形排版：200-209、230-239　B 材质光影：210-219、240-249、270-279　C 空间与场：220-229、250-259
- 还有空档：A 组 260-269、C 组 280-289（想继续扩就派代理，规范见 `STAGES-BATCH.md`）
- 验收脚本：`_stageverify-new.mjs`（通用，可传逗号分隔前缀）、`_stageverify-b.mjs`（B 组专用、走 template 管线）、`_stageverify-a/c.mjs`
- 注册一律 `node _merge-stages.mjs`（增量）。**⚠️ 仍不要跑 `register-stages.mjs`**，会删 100 个 `lizi*` 条目

### 两个 UI bug（都已修 + 回归）
1. **大厅头像被白雾洗掉一半**：`.me__banner::after`（底部白渐隐 + `blur(5px)`）是 `z-index: 2`，头像 `.me__ava` 是 `1`，同一层叠上下文里被压住 → 头像提到 `3`。验收 `_avatarfix.mjs`
2. **顶栏登录位**：用户不要真人头像，只留小人 SVG → `#user-avatar` 恒隐藏、`#user-ico` 恒显示（`afterLogin` 与会话恢复两处都要改）；`paintAccount()` 改为直接读 `profile.avatar`，否则设置页账号头像会跟着丢

### 宣传片素材（给外部工具用，不是给我们做的）
- `promo/PROMPT.md`：提示词（25s 16:9 / 15s 9:16 两版）+ 素材清单 + 可选文案
- `promo/assets/`：23 张 1440×900（logo、8 张界面、14 张形态），从 `shots/review/` 精选复制
- 提示词只给**事实 + 视觉底线 + 素材**，镜头/剪辑/节奏**不要**写死（用户明确说过：那工具比我专业，别瞎指挥）

### 一个已知运维隐患（建议做但还没做）
**服务会无声退出**（这一轮挂过 3 次，都是 node 进程消失，`.port` 还在但没监听），表现是页面白屏 + 形态/登录全挂。
`desktop/main.js` 已有"轮询 `.port` 直到就绪"的逻辑，但**服务中途死掉没人拉起**。要根治就在 main.js 里加看门狗（发现端口不通 → 重新 spawn `server.mjs`），或用 `node --watch`。目前只能人工 `Start-Process node server.mjs`。

---

## 12. 10-31 增量（形态全量重排 + 窗口三键根因 + 官网 + 歌单搬运）

### ⚠️ 形态编号换成 001–235 连号，**旧的 200–279 和 liziNN 已经不存在了**
用户要求「只留数字编号」，于是把 100 个 `lizi*` 也并进数字序列，**按原来菜单里的顺序**重排：

| 原来 | 现在 |
|---|---|
| `001–065` | `001–065`（没动） |
| `lizi01–lizi100` | **`066–165`** |
| `200–259`、`270–279`（本来就是混序） | **`166–235`** |

- 共 **235 个**；`STAGES` 里 236 条 = 235 + `classic`；下一个新形态从 **236** 开始
- `lizi*` 前缀在磁盘上已清零，所以「`register-stages.mjs` 会删掉 100 个 lizi 条目」这个坑**自动消失**了
- 菜单顺序与编号顺序一致（重排是按 `STAGES` 数组顺序映射的，**不是**按文件名排序——`STAGES` 里 lizi 原本夹在 065 和 200 之间）
- 深链照旧：`?stage=066` / `?stage=235`
- 剩下 6 个 `_bench*.html` / `_wip-*.html` 是草稿，没进 `STAGES`

### 窗口三键在主界面点不动的根因（已修）
`body.is-now .topbar{display:none}`，所以播放页一直正常；**主界面顶栏那条 64px 宽的 `-webkit-app-region: drag` 把右上角三键也圈成了「标题栏」**——真实鼠标按下变成拖窗口，页面收不到任何事件（实测 click = 0，而 CDP 注入的点击却能点中）。
修法：顶栏整体 `no-drag`，拖动交给 `.topbar__grip`（右边界停在 138px，永远不覆盖三键）+ 14px 的 `.drag-strip`（同样止于 138px）；`.win-controls` 提到 `z-index: 900`，任何浮层都盖不住。
> 教训：**CDP 注入的点击会绕过非客户区命中测试**，所以用 `Input.dispatchMouseEvent` 验证「按钮能不能点」是假阳性。要验证就查两件事：`elementFromPoint` 命中谁 + 那个点是否落在 drag 区域里。

### 新东西
- **官网** `public/site/`：单屏展厅（左索引 / 中纸 / 右粒子舞台，切区块粒子换形），`http://127.0.0.1:<port>/site/`
  - 安装包放在 `public/site/download/`（已 gitignore，111MB 不进库）
  - 素材里**不能出现用户账号**（头像 / 昵称 / 歌单数），截图只用播放页、碟机、我的专辑
- **歌单搬运** `public/migrate.js`：工具箱里。源=网易云歌单，目标五家任选；打分（歌名 .55 / 歌手 .30 / 时长 .15），≥0.86 自动、0.50–0.86 待确认；目标不能写就导出 CSV / M3U8
- **窗口动画** `public/win-anim.js`：最大化/还原/最小化给 body 挂 transform 动画，k 用前后视口宽度比算
- **`server.mjs` 静态服务支持目录索引**：`/site/` 这种带尾斜杠的路径以前一律 404

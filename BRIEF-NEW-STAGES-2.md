# 新增形态 061–070 · 任务说明（第二轮）

项目根：`E:\DSHdesktop\work\music-player`
形态目录：`public\stages\`
源站（**只读参考，不是拷贝**）：`E:\proiects\OPode\creative-100\sites\0NN-*.html`

**开工前先读**：`AGENT-BRIEF.md`（协议 / 节奏模块 / 字形采样 / 坑 / 性能）+ 三个已达标样本
`public\stages\043-lissajous-lyrics.html`、`045-voronoi-lyrics.html`、`057-truchet-dots-lyrics.html`。
本文件只写本轮差异。

---

## 一、每个代理负责 5 个形态

| 编号 | 文件名 | 中文名 | 源作品 | 机制方向（把歌词"演"出来） |
|---|---|---|---|---|
| 061 | `061-verlet-cloth-lyrics.html` | 布料 | 061-verlet-cloth | 字形采样点当"缝针"把布拽出形状：唱到哪字哪块布被提起，唱完松手回弹 |
| 062 | `062-spring-chain-lyrics.html` | 弹簧链 | 062-spring-chain | 链条按字形轨迹被甩动，弹性滞后的链条影子构成字；逐字按 YRC 甩到位 |
| 063 | `063-ribbon-trail-lyrics.html` | 丝带 | 063-ribbon-trail | 字是丝带的长曝光轨迹：笔尖沿笔画走，唱到哪写到哪，颜色跟 accent |
| 064 | `064-ball-pit-lyrics.html` | 球池 | 064-ball-pit | 小球落进字形的凹槽里排成字，唱完被搅动浮起再落下 |
| 065 | `065-domino-lyrics.html` | 多米诺 | 065-dominoes | 字形是倒下的多米诺序列，逐字按 YRC 推倒，句末整排倒下 |
| 066 | `066-stamp-factory-lyrics.html` | 印章工厂 | 066-stamp-factory | 逐字盖章压进画面（墨迹扩散 + 压印回弹），盖章时刻 = 字时间 |
| 067 | `067-paint-flow-lyrics.html` | 颜料流动 | 067-paint-flow | 字是颜料在纸上的流动边界：逐字被"画"出来，边缘有洇染 |
| 068 | `068-elastic-grid-lyrics.html` | 弹性网格 | 068-elastic-grid | 网格被字形吸成凹陷/凸起，字是网格的形变场 |
| 069 | `069-shatter-lyrics.html` | 碎裂 | 069-shatter | 字由玻璃碎片拼合，唱完碎裂飞散，下一句重新拼 |
| 070 | `070-gravity-sandbox-lyrics.html` | 重力沙盒 | 070-gravity-sandbox | 沙粒在字形约束下堆积又坍塌（与 004 的区别：真正的盒子碰撞 + 泼洒感） |

---

## 二、硬要求（同上一轮，逐条验收）

1. 自包含单文件、不引 CDN/字体/图片、无 emoji、内联 SVG。
2. 协议完整：`init`/`tick`/`beat`；子→父 `ready`；必须转发 `activity`（pointermove/down/wheel/keydown）与空格 `key`。
3. 节奏模块照抄 AGENT-BRIEF 第三节：`curIdx/brewIdx/lastT` 分离、索引单调、时间倒退 >0.6s 才清场。
4. **YRC 逐字**：第 k 字"成立/点亮/落位"时刻压在 `chars[k].t`（可提前 0.1~0.4s 预备）；无 chars 按 `t + dur*i/n` 均分；`window.__stage()` 返回 `yrc:<bool>`。
5. **长句完整**：30~40 字必须完整可见、可读（折行 2~3 行或自适应缩放，不许细线/溢出/截断）。
6. 时间：呈现不早于开唱前 1.5s、不晚于开唱后 0.3s；句尾 0.3s 内仍可见。
7. 观感：accent 派生主色、背景纵深（radial-gradient 辉光）、暗角 `#vig`、`#hint` 样式同现有、加镜头漂移/聚焦与 beat 相干脉冲。
8. **分词**：可选。逐字太碎时用 004 的 `isWord/segWords/groupByWords/groupByRule/latinSpans/spansForLine` + `fetch('/segdict.bin')`（DICT 判空回退规则切分），团时间 = 团首字 `chars[i0].t`。用没用都在文件头注释写理由。
9. 性能：无头 Chrome 1440×810 ≥50fps（并行测试 40+ 可接受，最终以主会话串行复测为准）；绘制合批。
10. `<title>` 用中文名、`<body data-chrome="off">`、有 `#hint`。

## 三、文件头注释（注册表会读）

`register-stages.mjs` 会从脚本开头 `/* ... */` 里提取**第一行有内容的说明**当菜单描述（≤40 字）。所以文件头这样写：

```js
/* ============================================================================
   061 · 布料 —— 一句话机制（≤40字，会进菜单）
   ----------------------------------------------------------------------------
   后面随便写细节。
   ========================================================================== */
```

## 四、验证（每文件必须）

```powershell
cd E:\DSHdesktop\work\music-player

# 1) 语法
node C:\Users\86186\AppData\Local\Temp\syntax-check.mjs 061

# 2) 运行时 + fps + 画面
node smoke-all.mjs 061

# 3) 短句截图 + 长句(41字)双喂法截图
node shot.mjs 061
node C:\Users\86186\AppData\Local\Temp\ll-probe.mjs 061
```

`read_image` 看 `shots/review/061-*.png`、`LL-061.png`、`LL-061-nochars.png`：
两种喂法下约 4s 的截图里，整句 41 字完整、可读、字是画面主体。不满意就改。

## 五、绝对不要做

| ❌ | 原因 |
|---|---|
| 改 `public\app.js` / 跑 `register-stages.mjs` | 注册由主会话统一做一次 |
| 改别的形态文件 / `server.mjs` / 重启服务器 | 共享单点 |
| 动 `E:\proiects\OPode\creative-100\` | 只读参考 |
| `Get-Process node \| Stop-Process` | 会杀别的项目 |
| 用 emoji / 外链资源 | 硬要求 |

## 六、返回格式（每个文件，不要贴大段代码）

```
061 | mechanism 一句话 | YRC 接法 | 分词(是/否+理由) | 动效 | smoke {fps,motion,err} | 语法 OK/FAIL | 截图路径 + 一句话观感评价
```

# 音效设置（音质 + 7 段 EQ + 10 套预设 + 高级曲线）

> 交付于 2026-10-27。验收脚本：`node _eqcheck.mjs`（**11/11 通过，0 console error**，日志 `_eqcheck.log`）。
> 截图：`shots/review/eq-1-simple.png` · `eq-2-advanced.png` · `eq-3-sheet.png` · `eq-4-quality.png`。

---

## 1. 做了什么

| 文件 | 行数 | 作用 |
|---|---|---|
| `public/audio/eq-engine.js` | ~470 | **纯音频，零 DOM**。7 个 BiquadFilter、10 套预设、M/S 宽度 + Haas、前级补偿、A/B、localStorage 持久化、`getFrequencyResponse` 取真实响应 |
| `public/audio/eq-ui.js` | ~700 | DOM + canvas。整页/半页**共用一个 `.eqx` 根节点**，切换入口只是 `append` 到另一个宿主；高级模式照 Pro-Q 4 的交互 |
| `public/audio/eq.css` | ~470 | 自注入 `<link data-eq-css>`（和 `public/lab/dj.css` 同款做法），含 `.view--audio` 的视图约定 |
| `public/beat.js` | **+27 / −1** | 加 `Beat.onGraph(cb)` 钩子（其中 17 行是说明为什么必须走钩子的注释，代码 10 行） |
| `public/app.js` | **+34 / −1** | `viewAudio` 映射、`show('audio')` 分支、`bindTopbarScroll`、设置行接线、半页入口接线 |
| `public/index.html` | **+13 / −0** | `#view-audio` 空壳 7 行、设置面板「音效」一行 5 行、播放页抽屉入口 5 行、两个 `<script>` |
| `public/api.js` | **+6 / −1** | `songUrl(ids, level)` 带上 `window.LIZI_QUALITY`（这样 `player.js` 一行都不用改） |
| `server.mjs` | **+9 / −2** | 只改 `song/url` 一个 case：level 白名单 + `encodeType` 跟着 level 走（lossless↑ → flac） |

### 信号链（插进 Beat 已经建好的那张图）

```
原始： src(MediaElementSource) → analyser →（可选 mute tap）→ destination
ON  ： src → 7×BiquadFilter → preamp → M/S 宽度(+Haas) → analyser → …
OFF ： src → analyser                    ← 真直通，滤波器不在路径上
```

`createMediaElementSource` 对同一个 `<audio>` 只能调一次，所以 EQ **绝不新建 source**：
`beat.js` 在建图后把 `{ctx, src, analyser}` 交出来，EQ 自己 `src.disconnect()` 再重接。
链条末端永远回到 **analyser**，BPM 检测和播放页频谱因此不受影响（实测见验收 9）。

---

## 2. 十条验收的真实数值

### ① 两个入口
- 大厅设置 →「音效」→ `#view-audio`：`active=true`、`background=rgb(255,255,255)`、`padding-top=84px`（= 顶栏 64 + 20，和 hall/lab 同款）；顶栏左键 `is-back=true`、`aria-label="返回大厅"`，点击回大厅 `true`。
- 播放页抽屉 →「音效 / 均衡器」→ 半页覆盖：面板 **520px / 视口 1000px = 0.520**（要求 0.45~0.60），顶部圆角 14px、底部 0，白底，遮罩 opacity 1，宿主 `eq-host-sheet`，**`.eqx` 全文档只有 1 个实例**（`sameNode=true`）。

### ② 7 段滑杆 + 粉噪实测（每段都测）
用真实鼠标把第 1 段拖到顶：`gains[0]=12`、读数「+12.0」、`BiquadFilterNode.gain === 12`（freq 60 / Q 1.10）。
然后逐段把**只有这一段**推到 +12dB，粉噪过 `OfflineAudioContext`（65536 帧 @44.1k，Hann 窗单频复增益估计 H=Σwet·e^{-jωi}/Σdry·e^{-jωi}），在 **1kHz** 取增益：

| 段 | 节点 gain | 粉噪实测 @1kHz | getFrequencyResponse 预测 | 误差 |
|---|---|---|---|---|
| 60 Hz | 12 | +0.047 dB | +0.048 dB | **0.001 dB** |
| 150 Hz | 12 | +0.300 dB | +0.302 dB | **0.002 dB** |
| 400 Hz | 12 | +2.213 dB | +2.214 dB | **0.001 dB** |
| 1 kHz | 12 | **+12.043 dB** | +12.000 dB | **0.043 dB** |
| 2.4 kHz | 12 | +2.366 dB | +2.376 dB | **0.010 dB** |
| 6 kHz | 12 | +0.327 dB | +0.331 dB | **0.003 dB** |
| 12 kHz | 12 | +0.050 dB | +0.052 dB | **0.001 dB** |

最大误差 **0.043 dB**（要求 <1dB）；1kHz 段实测 +12.04dB 与设定 +12dB 差 **0.04dB**。

### ③ Q vs 带宽
| Q | −3dB 带宽（中心 1kHz，+12dB） |
|---|---|
| 0.7 | **761.8 Hz**（689.2 ~ 1451.0 Hz） |
| 8.0 | **66.6 Hz**（967.7 ~ 1034.3 Hz） |
| 比值 | **11.44 ×**（要求 >3×） |

### ④ 10 套预设
10 套全部应用成功、10 条互不相同的曲线；最大增益差 ≥6dB 的预设对 **6 对**（最大 9.5dB：低音增强 vs 平直）。

| # | 预设 | 60 | 150 | 400 | 1k | 2.4k | 6k | 12k | width | haas | 自动前级 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 平直 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.00 | 0 | 0 dB |
| 2 | 流行 | +1.5 | +2.5 | +1.0 | −0.5 | +1.5 | +3.0 | +2.0 | 1.05 | 0 | −2.2 dB |
| 3 | 人声突出 | −3.0 | −1.5 | +1.5 | +4.0 | +4.5 | +2.0 | −1.0 | 1.00 | 0 | −3.2 dB |
| 4 | 低音增强 | **+9.5** | +7.0 | +3.0 | −1.0 | −2.0 | −3.0 | −3.5 | 1.00 | 0 | −6.7 dB |
| 5 | 电子 | +6.5 | +4.0 | −1.5 | +1.0 | +3.0 | +5.5 | +4.5 | 1.15 | 0 | −4.8 dB |
| 6 | 摇滚 | +4.5 | +2.0 | −1.5 | +0.5 | +2.5 | +5.0 | +4.0 | 1.10 | 0 | −3.6 dB |
| 7 | 古典 | +2.0 | +1.0 | −1.0 | 0 | +1.5 | +2.0 | −1.5 | 1.20 | 0 | −1.7 dB |
| 8 | 沉浸现场 | +3.0 | +2.0 | +1.0 | +1.5 | +2.0 | +2.5 | +1.0 | **1.45** | **8 ms** | −2.6 dB |
| 9 | 3D 立体环绕 | +1.0 | +0.5 | 0 | −1.0 | +1.0 | +1.5 | +0.5 | **1.90** | **12 ms** | −2.0 dB |
| 10 | 夜间（等响度） | +4.0 | +2.5 | +0.5 | −1.0 | −1.5 | +0.5 | +1.5 | 1.00 | 0 | −2.8 dB |

前级 = `−0.7 × 最大正增益 − 1.0·log₂(width)`，夹在 −14~0dB。
「3D 立体环绕」的**空间感不是 EQ 段做的**：`width` 是 M/S 侧信号增益，`haas` 是右声道延迟（ms），
在 `ChannelSplitter → mid/side → ChannelMerger` 里实现；width=1 时数学上恒等于原信号（完全透明）。

### ⑤ 高级模式交互（全部用 CDP 真鼠标事件）
- 拖节点：1400Hz/+5.0dB → **2755.8Hz/+14.9dB**，真节点 `2755.8Hz/14.9dB` 同步；读数「Bell · 2.76kHz · +14.9dB · Q 3.10」。
- 滚轮：Q 3.10 → **13.09**，节点 Q 13.09。
- 双击：`bypass=true`，该段 `gain=0dB`、`type` 收回 peaking（就是这么实现"旁通"的：不同类型对"零增益"的语义不一样，Low Pass 的 gain 根本不参与运算）。
- 右键：`peaking → lowshelf`，节点类型同步。
- 键盘：←/→ 改频率、↑/↓ 改 ±0.1dB（Shift ×10）、Enter 旁通、Delete 归零。

### ⑥ 曲线 = 真实响应
画布 1178×328（dpr 1），对数轴 20Hz–20kHz、纵轴 ±24dB。随机 5 个频点扫像素列、取墨色像素带中点反算 dB，与 `getFrequencyResponse` 对比：

| 频率 | 画布 y → dB | 真实响应 | 误差 |
|---|---|---|---|
| 681.6 Hz | 149 → +1.66 | +1.58 | **0.075 dB** |
| 17145.2 Hz | 158 → +0.08 | +0.05 | **0.028 dB** |
| 214.7 Hz | 184 → −4.22 | −4.25 | **0.034 dB** |
| 161.8 Hz | 168 → −1.49 | −1.50 | **0.015 dB** |
| 5058.6 Hz | 174 → −2.57 | −2.62 | **0.052 dB** |

最大误差 **0.075 dB**（要求 <0.5dB）。

### ⑦ 音质（真实返回，匿名会话）
| 请求 level | url | 实际 level | br | size |
|---|---|---|---|---|
| standard | ✅ | standard | **128 kbps** | 3 071 626 B |
| higher | ✅ | higher | 192 kbps | 4 607 417 B |
| exhigh | ✅ | exhigh | **320 kbps** | 7 678 999 B |
| lossless | ✅ | **exhigh** | **320 kbps** | 7 678 999 B |
| hires | ✅ | **exhigh** | 320 kbps | 7 678 999 B |

UI 文案（点「无损」后）：「**实际拿到 极高 320 kbps · 请求的是 无损，被上游降级**」；
格子 `lossless[需会员]`、`hires[需会员]`。端到端抓包：切到 standard 后重载当前曲，
`/api/song/url` 请求体里 `level=["standard","standard","standard"]` —— 选项真的下发了。

**无损结论：匿名拿不到。** 详情见 §4。

### ⑧ 持久化
改 7 段为 `[9, -3.5, 0, 4.5, -6, 2.5, -1.5]` → `Page.reload` →
刷新后 `[9, -3.5, 0, 4.5, -6, 2.5, -1.5]`、滤波器节点同样一致、`version=1`。
存 `localStorage['lizi.eq.v1']`，`version` 不认就整份回默认（宁可用户重调一次，也不拿旧结构渲染新界面）。

### ⑨ 回归
- 真出声：EQ 链上的 analyser `maxRMS = 0.2152`（要求 >0.02），avgRMS 0.10。
- BPM 仍在测：`189.83`（detected）。频谱帧 24/24 在变，`level=0.88`。
- 开关重接线不炸：OFF `maxRMS=0.1823`、ON `0.1746`。
- **EQ 真的在信号路径上**：把 60/150Hz 砍 −12dB，analyser 低频 bin 均值 `118.1 → 42.5 = −8.88dB`（不是画着好看）。
- DJ 台能打开：`view-lab` active、`lab-pane-dj` on、2 deck / 2 转盘（`dj.js` 有自己的 AudioContext，一行没动）。
- **console error = 0**。

### ⑩ 截图
`shots/review/eq-1-simple.png`（整页 + 低音增强，7 段与左侧 dB 标尺对齐、读数在顶端）
`shots/review/eq-2-advanced.png`（整页 + 高级，频谱在曲线背后，选中节点红 + 读数标签）
`shots/review/eq-3-sheet.png`（播放页 + 半页覆盖 52%，歌词/抽屉没被压坏）
`shots/review/eq-4-quality.png`（音质五档 + 「需会员」+ 「实际拿到…降级」，2× 截图）

---

## 3. 与 FabFilter Pro-Q 4 的差距（诚实清单）

有的：可拖节点改 频率/增益、滚轮或 Shift+拖改 Q、双击旁通、右键切 6 种类型、
选中高亮 + 节点旁读数、键盘微调、对数频率轴 ±24dB、1/2/5 网格、实时频谱背景、
真实响应曲线、A/B 对比、节点数显示。

没有的（照重要性）：
1. **动态 EQ**（每段 threshold / ratio / attack / release）—— Pro-Q 4 的主打，这次没做。
2. **任意增删节点 / 节点数上限 > 7**：固定 7 个（简单模式的 7 段就是这 7 个）。
3. **线性相位 / 最小相位切换、过采样**：BiquadFilter 只有最小相位，没有 4× oversampling。
4. **频谱抓取（spectrum grab）与钢琴卷帘**：没有把频谱上的峰一键变节点。
5. **自动增益是固定比例**（−0.7×最大提升），不是 Pro-Q 那种按整体响度算的。
6. **每段独立声像 / solo / 智能独奏**：没有。
7. **预设库导入导出**：只有内置 10 套 + localStorage。
8. **VST3 加载：技术上不行**（见 §5），所以"用本机那个 Pro-Q 4"做不到。

视觉是项目自己的语言（纯白、1px hairline、墨线），不是 Pro-Q 的深色渐变面板。

---

## 4. 无损音质的真实结论

1. **匿名（现在这台机的状态，`.session.json` 里只有 NMTID）拿不到无损**。
   请求 `level=lossless` / `hires`，上游**不报错**，直接把 `level` 改成 `exhigh`、`br` 给 320000 —— 静默降级。
2. **`encodeType` 单独改没用**。我用独立的 weapi 直连脚本（`_eqprobe3.mjs`，绕开本机服务）对比过：
   同一首歌 `encodeType=mp3` 与 `encodeType=flac`，5 个 level 的返回 **`br` / `size` / `type` 完全一致**（`type` 仍是 mp3）。
   所以"把 encodeType 改成 flac 就能拿无损"是**假的**。
3. **VIP 曲目（fee=1）**：`url=null`、`code=-110`、`reason=vip` —— 连 128k 都不给。
   界面会显示「该曲需会员（fee=1）· 上游没有返回地址，播放器会用演示音」。
4. 按 code path 仍然写对了：`lossless/hires/jymaster/jyeffect → encodeType=flac`，
   登录会员后同一条路就会返回真 FLAC；但**当前环境实测拿不到**，所以 UI 一律标注
   「实际拿到 X」+「需会员」，不给假选项。

`_eqprobe3.json` 保留了逐条原始返回（3 首 × 2 种 encodeType × 5 档 level）。

---

## 5. VST3 为什么不能加载（结论沿用 HANDOFF §8③）

- **AudioWorklet 里没有 `require` / `module` / `window`**，拿不到原生模块；官方 SDK 也不允许在 worklet 里跑。
- npm 上没有可用的 Node VST3 宿主（`node-vst3-host` / `vst3-host` / `vst3-js` 全 404，`node-vst` 停在 VST2 0.0.1）。
- 真正的死结还有 GUI：Saturn 2 有 956 个参数、Timeless 3 有 1012 个。

所以本机装的 FabFilter Pro-Q 4 **不会被嵌进来**，我们只复刻它的交互；
界面上也明写了这句（高级模式下方那行小灰字）。真正在出声的是 7 个 `BiquadFilterNode`。

---

## 6. 这一轮新踩的坑

1. **曲线不能把前级算进去**。第一版 `responseDb()` 把 preamp 乘进去了，测试立刻报
   **5.5dB 的系统偏差**（正好是 `−0.7×8dB`）。结论：曲线画"你设的 EQ 形状"，前级单独标数字
   （Pro-Q 也是这么分的），没动过的频段才会老实落在 0dB 线上。
2. **`[hidden]` 会被 `display: inline-flex` 顶掉**。高级模式下想收起「预设」下拉，
   `hidden=true` 完全没反应 —— 必须补 `.eqx__sel[hidden] { display: none }`。
3. **`.view--audio` 的样式忘了写**（我把它放进 `eq.css` 而不是 `app.css`）。
   验收第 1 条一条就抓出来了：`bg=rgba(0,0,0,0)`、`padding-top=0px`。
4. **`src.disconnect()` 要用无参版本**：`disconnect(analyser)` 只断一条，
   但 Beat 以后可能再加 mute tap，无参全断再重接才稳。
5. **`OfflineAudioContext` 里的 BiquadFilterNode 可以直接 `getFrequencyResponse`**，
   不需要 `startRendering` —— 这是"曲线=真实响应"最省的做法，
   比把节点搬出真图便宜得多（真图里的节点参数由同一个 `applyFilters()` 写，不会漂）。
6. **半页覆盖收起时要延迟 `hidden`**（280ms），否则过渡根本看不见；
   下滑关闭按"位移 > 110px 或速度 > 0.9px/ms"判定，回弹用 CSS transition 复位。
7. **网易云偶发空 `data`**（冷连接超时/限流）。一次空响应不代表拿不到，
   UI 现在会重试一次再下结论：「查询失败 · 上游两次都没有返回」。
   这一点是验收跑的时候真的撞到的（同一条用例第一次跑挂在这里）。
8. **CDP 的右键不一定派发 `contextmenu`**（测试里补了一次合成 `MouseEvent` 兜底，报告里注明）。
   真实浏览器里右键正常。

---

## 7. 怎么验

```powershell
node _eqcheck.mjs        # 11/11，约 2~3 分钟，自己起无头 Chrome，输出 _eqcheck.log
node _eqprobe3.mjs       # 直连上游验 encodeType（只读，会写 _eqprobe3.json）
```

服务已用新 `server.mjs` 重启（端口仍是 **11701**，以 `.port` 为准）。
**没有 commit。**

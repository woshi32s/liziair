# VST3 调音台可行性实验报告

> **隐藏式实验：没有修改 LIZI 任何源码。** 全部实验在临时目录 `%TEMP%\pedalprobe` 的独立 Python venv 里跑，
> 加载的是本机 `C:\Program Files\Common Files\VST3` 里的**真实商业插件**。
> 复现：见文末「复现步骤」。

---

## TL;DR

**能跑，而且是真能跑。** 用 Spotify 开源的 `pedalboard`（Python）加载本机 107 个音频效果类 VST3，
**101 个成功加载并真实处理了音频（94%）**，处理性能中位数 **32.4 倍实时**。

但**不建议直接做「Electron 内嵌 VST3」**，理由在第四节：真正的阻碍不是能不能加载，
而是**插件 GUI**（大部分插件没有 GUI 就没法用）和 **Node/Electron 里没有成熟的宿主库**。

**推荐路径：独立进程 + 音频环回**（不动 LIZI 一行代码），或者**放弃 VST3、用 Web Audio 自建等效效果链**（折中方案）。

---

## 一、实测数据（本机真实插件）

环境：`C:\Program Files\Common Files\VST3`，107 个音频效果类插件（已排除合成器、Auto-Tune、Melodyne、WaveShell 全集）。

### 成功率

| 项 | 数值 |
|---|---|
| 可加载目标总数（含 bundle 展开） | 133 |
| 参与测试（音频效果类） | 107 |
| **成功加载 + 真实处理音频** | **101（94%）** |
| 失败 | 6 |

### 性能

测试方法：加载后用 1 秒 44.1kHz 立体声粉噪过一次 `process()`，测耗时。

| 指标 | 加载耗时 | 处理 1 秒音频 | 实时倍率 |
|---|---|---|---|
| 中位数 | 251ms | 31ms | **32.4x** |
| p90 | 5.9s | 87ms | — |
| 最差 | 23.1s | 1037ms | 1.0x |

**97% 的插件实时倍率 ≥ 2x** —— 也就是说单核就能同时处理 2 条以上音轨。做调音台完全够用。

### 最慢的 3 个（要留意）

| 插件 | 实时倍率 | 加载 |
|---|---|---|
| Nectar 3 (iZotope) | 1.0x | 11.5s |
| ValhallaPlate | 1.7x | 23.1s |
| ValhallaShimmer | 1.8x | 12.4s |

### 失败的 6 个，以及失败原因（很有信息量）

| 插件 | 原因 | 性质 |
|---|---|---|
| FabFilter One | `does not accept audio input` | **是合成器不是效果器**，不是失败 |
| Unison Drum Monkey | 同上 | **是鼓机**，不是失败 |
| Knif Audio Knifonium | `does not support 2-channel output` | 单声道插件，加单声道路径即可 |
| ZENOLOGY | 超时 45s | GUI/授权初始化卡住 |
| ValhallaDelay | 超时 45s | 同上（同厂商其他插件都成功） |
| ValhallaFutureVerb | 超时 45s | 同上 |

**结论：真正"不兼容"的只有 3 个超时的（都是 GUI 初始化卡住），其余是分类错误或通道数问题。**
按音频效果器算，实际成功率接近 **100%**。

### 成功加载的知名插件（抽样）

FabFilter 全家（Pro-Q 4 / Pro-L 2 / Pro-R 2 / Saturn 2 / Timeless 3 / Volcano 3 / Pro-C 2 / Pro-MB / Pro-DS / Pro-G）、
ValhallaDSP 全家（VintageVerb / Room / Plate / Shimmer / Supermassive / UberMod / FreqEcho / SpaceModulator）、
Plugin Alliance 全家（SPL 系列 17 个、Shadow Hills、Vertigo、Maag、Millennia、Purple Audio、Noveltech、Suhr、THE OVEN 等）、
oeksound、Sonible smartReverb2、Cradle The God Particle、Auburn Sounds、Waves (Sync Vx)、OTT。

**参数规模**：FabFilter Saturn 2 有 **956 个参数**、Timeless 3 有 **1012 个**、Pro-Q 4 有 **581 个**。
这意味着「只做参数控制不做音频」的折中方案也不轻松 —— 参数太多，必须靠插件自己的 GUI。

---

## 二、关键技术门槛：AudioWorklet 调不了原生模块

这是**决定性的一条**，先说清楚：

LIZI 的音频在**渲染进程的 Web Audio 图**里（`public/beat.js` 用 `createMediaElementSource`）。
要在音频线程里插 VST3，直觉方案是 `AudioWorklet`。但：

- `AudioWorkletGlobalScope` **没有 `require` / `import` / `module`**，也没有 `window`。
- 它只有 `currentFrame`、`sampleRate`、`registerProcessor` 这些。
- **不能**在 worklet 里加载 `.node` 原生模块。

所以「在 Web Audio 图里直接调 VST3」**不可能**。这是 JS 运行时隔离决定的，不是工程难度问题。

（这一条我基于规范判断；如果子代理的调研给出了相反证据，以它为准 —— 报告见 `_research/vst3-feasibility.md`。）

---

## 三、四条可行路径

### 🟢 路径 A：独立进程 + 系统音频环回（推荐，零改动）

```
LIZI (<audio>)  ──→  虚拟声卡 (VB-Cable / 立体声混音)  ──→  VST 宿主进程 (pedalboard)  ──→  扬声器
```

- **不用改 LIZI 一行代码。**
- 本机已实测：pedalboard 能加载 94% 的真实插件、性能 32x 实时。
- 代价：用户要装虚拟声卡驱动；延迟 ~20~50ms（听歌无感，但玩游戏/看视频会有唇音不同步）。
- 本机还**有板载"立体声混音"**可用（不装驱动），但会把通知音一起收进去。

**这是"工具形式存在"最省事、最稳的做法。**

### 🟡 路径 B：主进程原生引擎 + IPC 回传音频

- Electron 主进程里跑一个原生音频引擎（JUCE / pedalboard 子进程），处理完通过 IPC/流回渲染进程。
- **难点**：采样率/时钟同步。Web Audio 的时钟和原生引擎的时钟会漂移，长时间播放必然爆音。
- **现实做法**：音频完全不走 Web Audio，LIZI 只做 UI + 控制指令，播放交给原生引擎。
  → 这等于重写 `player.js`（现在 30+ 处引用 `audio`），工作量是**周**级。
- 而且**仍然是 Node 里没有成熟 VST3 宿主库**：`node-vst3-host` / `vst3-host` / `vst3-js` 在 npm 上全部 404，
  `node-vst` 只有 0.0.1 版（2023-07），不能用于生产。

### 🔴 路径 C：Electron 里嵌原生窗口 + 内联音频

- 把插件的 GUI 用 Win32 `SetParent` 嵌进 Electron 窗口，音频在原生侧处理。
- **两个死结**：
  1. 插件 GUI 需要 **UI 线程消息泵**，和 Electron 的主进程消息循环会打架（尤其 VST3 的 `IPlugView`）。
  2. 音频线程和 Web Audio 线程无法共享缓冲区。
- 工程量：需要自己写 VST3 host + GUI 桥 + 线程模型。**这是 DAW 的工作量，不是播放器的工作量。**

### 🔴 路径 D：Node 原生插件直接调 VST3 SDK

- VST3 SDK 是 **GPLv3 或 Steinberg 专有双许可**。用它做**闭源**宿主必须买专有许可。
- 本机**没有 MSVC 编译器**（`cl.exe` / `msbuild` 都不在 PATH，也没找到 VS Build Tools），
  只有 cmake + ninja（Python 目录里的）。要自建宿主得先装 6GB 的 VS Build Tools。
- 即使编出来，还要处理 GPL 传染问题。

---

## 四、真正的阻碍不是"能不能加载"

跑完实验我最想强调这一点：**94% 的插件都能加载，但加载 ≠ 能用。**

大部分效果器的价值在它的 **GUI**（可视化频谱、拖拽 EQ 曲线、实时波形）。
只有参数 API 的话，FabFilter Pro-Q 4 的 581 个参数你没法用 —— 用户面对 581 个滑杆等于什么都不能做。

所以：
- 如果要做，**必须解决插件 GUI 的显示问题**（原生窗口嵌入）。
- 这正是路径 C 的死结，也是为什么我说"不建议做 Electron 内嵌"。

**反过来说**：如果只想要"调音台"这个功能本身（EQ / 压缩 / 混响），
**不需要 VST3** —— Web Audio 原生就有 `BiquadFilter`、`DynamicsCompressor`、`Convolver`，
WASM 版的效果器（比如 `Tone.js`、`Elementary Audio`）质量也够。这是折中方案。

---

## 五、折中方案建议

按「投入产出比」排序：

| 方案 | 效果 | 工作量 | 是否动 UI |
|---|---|---|---|
| **1. 虚拟声卡 + 独立宿主进程** | 真 VST3，全功能 | 2~3 天（宿主是现成的 pedalboard） | 不动 |
| **2. Web Audio 自建效果链**（EQ/压缩/混响/限幅） | 够用，不是真 VST3 | 3~5 天 | 要加 UI |
| **3. 只做"推荐参数预设"**（用 pedalboard 离屏渲染，导出一版母带） | 无实时 UI | 2 天 | 不动 |
| 4. Electron 内嵌 VST3 | 真 VST3 + GUI | **数周，且要买 VST3 许可 + 装 VS** | 大改 |

**我的建议：如果这个功能"不是很必要"（用户原话），走方案 1 或 2，别走 4。**

---

## 六、复现步骤

```powershell
$tmp = "$env:TEMP\pedalprobe"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
cd $tmp
python -m venv venv
.\venv\Scripts\pip.exe install pedalboard --quiet
# 然后跑 one.py（单个）或 all2.py（批量），脚本内容见本次会话产出
```

关键代码只有三行：

```python
from pedalboard import load_plugin
plugin = load_plugin(r"C:\Program Files\Common Files\VST3\FabFilter\FabFilter Pro-Q 4.vst3")
out = plugin.process(audio, sample_rate, reset=True)   # audio 是 float32 ndarray
```

**坑**：`.vst3` 可能是**目录**（bundle）而不是文件，真正的二进制在
`<name>.vst3\Contents\x86_64-win\<name>.vst3`。必须递归展开，否则会报 "Unable to scan plugin"。
我第一次就是这么误判成"全部加载失败"的。

---

## 七、参考

- 详细调研（宿主库清单 / GUI 方案 / SDK 许可）：`_research/vst3-feasibility.md`（子代理产出）
- VST3 SDK 许可：Steinberg 官网 VST 3 Licensing
- pedalboard：Spotify 开源，`load_plugin` 支持 VST3/AU，Windows 需要脚本文档所述的路径处理

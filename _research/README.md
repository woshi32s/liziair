# LIZI 四项可行性调研 · 总报告

> 全部为**隐藏式实验**：没有修改 `public/` 下任何界面文件，没有加功能，没有改动现有形态。
> 四项按用户指定顺序排列。每项都有独立的详细报告，本文件只做总览与决策建议。

---

## 总览

| # | 项目 | 结论 | 证据 | 详细报告 |
|---|---|---|---|---|
| 1 | 鼓组节拍检测（复现 Folia） | 🟢 **能搬，且立竿见影** | A/B 实测 F1 **0.918 vs 0.229** | [drumbeat-ab.md](drumbeat-ab.md) |
| 2 | 智能过渡（复现 Folia） | 🟢 **曲线能原样搬**，前提是先做双 deck | 曲线数学实测 1e-6 精度 | [folia-automix.md](folia-automix.md) · [crossfade-light.md](crossfade-light.md) |
| 4 | Mixxx DJ 台接入 | 🔴 **不能嵌入，只能遥控** | 无 OSC/HTTP/socket，仅 MIDI | [mixxx-feasibility.md](mixxx-feasibility.md) |
| 3 | VST3 调音台 | 🟡 **能加载，但 GUI 是死结** | 101/107 真实插件跑通 | [vst3-experiment.md](vst3-experiment.md) · [vst3-feasibility.md](vst3-feasibility.md) |

> 注：③ 的「宿主库生态 / SDK 许可 / GUI」部分原由一个子代理负责，它中途失败未交付；
> 这部分由包工头在本机核实后补齐（`vst3-feasibility.md`）。
> 核心事实：**npm 上没有任何可用的 Node VST3 宿主库** —— `node-vst3-host` / `vst3-host` /
> `vst3-js` 全部 404，`node-vst` 只有 0.0.1 且是 VST2。唯一现成可用的是 Python 的 `pedalboard`。

---

## ① 鼓组节拍检测

**问题**：Folia 的鼓点检测怎么做的？能不能搬到 LIZI？

**答案**：Folia 有**两条**路线，找到的是对的那条：
- 神经网络路线（`beatThis.ts`，Beat This! ONNX 模型）—— 重，LIZI 用不上
- **纯 DSP 路线（`mods/visualizer52hz/beatDetector.mjs`，70 行）** —— 这才是能搬的

**它比 LIZI 现版准得多**（合成鼓组 A/B，6 个场景）：

| | LIZI 现版 | Folia 版 |
|---|---|---|
| 平均 F1 | 0.229 | **0.918** |
| 平均召回 | 0.202 | **1.000** |
| 平均误差 | 17.5ms | **14.3ms** |

**差在哪**：只有一个改动 —— 频谱通量只统计**低频 12 个 bin**（21~260Hz），而不是全频段。
LIZI 现在把 1000 个 bin 都算进去，kick 的能量被和声/人声/噪声稀释掉 6 倍以上。
90BPM 反拍场景 LIZI **一条都没检出**（召回 0）。

**代价**：纯贝斯无鼓的场景，两家误报都在 ~1 次/秒（同量级，不是退化）。

**落地成本**：改 `beat.js` 里一行循环范围。**这是四项里投入产出比最高的。**

---

## ② 智能过渡

**问题**：Folia 的两首歌自动过渡怎么做的？能不能复现？

**答案**：Folia 是三层 —— 离线全曲分析（ONNX 拍点 + htdemucs 分轨）→ 纯函数乐理决策 → Web Audio 采样级调度。

**能搬的**：曲线数学（`buildCrossfadeCurves`，60 行纯函数）。实测：
- 去掉 headroom 后 `cos²+sin²≡1` **误差 < 1e-6**
- 曲线起止精确等于 1（结束不用"还 headroom"）
- `setValueCurveAtTime` 忠实执行（离散度 3.6%）

![曲线](../shots/review/_crossfade-curves.png)

**搬不了的**：htdemucs 分轨（166MB 模型）、Beat This! 全曲 bar grid（83MB）、整曲 LUFS。

**必须先解决的前提**：LIZI 现在是**单 `Audio` 单例**（`player.js:12`），交叉淡化需要双 deck。
这个改造涉及 30+ 处引用，**本身就是一个独立会话的工作量**。

**两个我踩过、值得记的坑**：
1. 曲线的 RMS 在中点**本来就会掉 15.9%**（headroom 钟形故意压 1.5dB）。等功率指"除掉 headroom 后"仍满足 cos²+sin²≡1，不是输出 RMS 恒定。
2. **别用同频同相正弦测功率** —— 会相干叠加。第一版这么测出 22.8% 起伏，误以为是曲线错了。

---

## ④ Mixxx DJ 台（比 #3 先做）

**问题**：能不能把 Mixxx 完全接入 LIZI，作为工具形式存在？

**答案**：**不能嵌入，只能遥控。**

关键事实（子代理三重确认）：
- Mixxx 是独立 Qt6/C++ 应用，**没有 HTTP / JSON / WebSocket / DBus / 本地 socket 接口**
- **2.5.6 完全不支持 OSC**（CHANGELOG 全文 0 处 "OSC"）
- 唯一可用的双向接口是 **MIDI**
- `--midiDebug` 只是 `--controller-debug` 的遗留别名（写日志，不能订阅）；`--controller` 选项根本不存在
- **Mixxx 不能播 URL**（音源是文件型 provider 表），所以"把网易云直链交给 Mixxx"不成立

| 方案 | 判定 |
|---|---|
| A. MIDI 外部遥控 | 🟡 有条件可行 7/10 |
| B. 嵌原生窗口 | 🔴 不可行 2/10 |
| C. 复用引擎库 | 🔴 不可行 1/10（GPLv2 传染 + 单体构建） |
| D. Web Audio 自建 DJ 台 | 🟢 可行 8/10（终局） |

**两个会决定成败的风险**：
1. **曲目注入能力缺失** —— Mixxx 没有任何"外部指定某首歌"的入口。这是 A 无法成为终局的根本原因。
2. **独占音频设备冲突** —— 本机 Mixxx 配置为 ASIO4ALL（ASIO 通常独占），Mixxx 占住设备后 LIZI 可能直接发不出声。

**一个意外的好消息**：**Web MIDI 在 LIZI 的 Electron 33 里可用**（在 `http://127.0.0.1` 下测试通过，sysex 也启用了），不需要原生模块。

---

## ③ VST3 调音台

**问题**：能不能在播放器里加一个能加载 VST3 的调音台？

**答案**：**能加载，但"能加载"≠"能用"。**

实测（本机 107 个真实商业插件）：

| 指标 | 结果 |
|---|---|
| 成功加载 + 真实处理音频 | **101 / 107（94%）** |
| 处理性能中位数 | **32.4 倍实时** |
| 实时倍率 ≥ 2x 的 | 97% |

知名插件全部跑通：FabFilter 全家、ValhallaDSP 全家、Plugin Alliance 全家（SPL 17 个）、oeksound、Sonible、Cradle、OTT。

**但真正的阻碍不是加载**：
- `AudioWorklet` **调不了原生模块**（没有 require/module），所以没法在 Web Audio 图里直接插 VST3
- npm 上**没有可用的 Node VST3 宿主库**（`node-vst3-host` / `vst3-host` / `vst3-js` 全部 404）
- VST3 SDK 是 **GPLv3 或专有双许可**，闭源宿主要买许可
- 本机**没有 MSVC**（只有 cmake + ninja），自建宿主得先装 6GB VS Build Tools
- **最要命的是 GUI**：FabFilter Saturn 2 有 956 个参数、Timeless 3 有 1012 个。
  没有插件自己的 GUI，给用户 956 个滑杆等于什么都不能做

**推荐**：如果这功能"不是很必要"（用户原话），走**虚拟声卡 + 独立宿主进程**（2~3 天，零改动），
或**放弃 VST3 用 Web Audio 自建等效效果链**。别走 Electron 内嵌（数周 + 买许可 + 装 VS）。

---

## 决策建议（按投入产出比）

| 优先级 | 做什么 | 为什么 |
|---|---|---|
| **1** | 鼓组节拍检测（改 `beat.js` 一行循环范围） | 一小时的工作量，F1 从 0.229 → 0.918。**唯一"立刻能看到效果"的一项** |
| 2 | Web Audio 自建调音台（EQ/压缩/混响） | 3~5 天，真能用，不碰 VST3 的所有坑 |
| 3 | Mixxx MIDI 遥控（Phase 1） | 5~8 天，先验证手感；别指望它能成终局 |
| — | 双 deck + 交叉淡化 | 前提条件（30+ 处引用改造），**单独一个会话** |
| ✗ | Electron 内嵌 VST3 | 数周 + 许可 + 装 VS，且 GUI 是死结 |
| ✗ | Mixxx 嵌入 / OSC | 物理上不存在这个接口 |

---

## 附录：本轮的实验脚本（都在项目根目录）

| 脚本 | 作用 |
|---|---|
| `_drumbeat-test.mjs` | 鼓组检测 A/B（合成鼓组，7 场景） |
| `_crossfade-lab.mjs` | 等功率曲线数学验证 + OfflineAudioContext 实测 |
| `_cubeprobe.mjs` / `_cubesweep.mjs` / `_cubeart.mjs` / `_cubestate.mjs` | 立方体菜单姿态/伪影扫描（上一轮成果） |
| `%TEMP%\pedalprobe\one.py` / `all2.py` | VST3 加载测试（临时目录，不在项目里） |

全部**不修改应用行为**，随时可删。

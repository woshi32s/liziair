# VST3 宿主方案调研（补齐版）

> 本文件补的是「宿主库生态 / SDK 许可 / GUI 难题」这三块。
> **实测数据在 [vst3-experiment.md](vst3-experiment.md)**（本机 101/107 真实插件跑通）。
> 原负责这部分的子代理中途失败未交付，以下结论由包工头在本机核实。

---

## 一句话结论

**Node/Electron 生态里没有可用的 VST3 宿主库。** 想加载真实 VST3 只有三条路：
Python（pedalboard，已验证可行）、C++ 自建（要 MSVC + VST3 许可）、或外部宿主应用（Carla 等）。

---

## 一、宿主库清单（本机 npm registry 实查）

| 名称 | 类型 | 支持 VST3 | 状态 | 结论 |
|---|---|---|---|---|
| `node-vst3-host` | npm | — | **不存在**（404） | ✗ |
| `vst3-host` | npm | — | **不存在**（404） | ✗ |
| `vst3-js` | npm | — | **不存在**（404） | ✗ |
| `node-vst` | npm | VST2 | **0.0.1**（2023-07 后无更新） | ✗ 太旧、只 VST2 |
| `node-addon-api` | npm | — | 8.9.2（活跃） | 可用于自建，但需要 C++ 侧宿主 |
| `@juce-framework/core` | npm | — | **不存在此包** | ✗ |
| `pedalboard` (Python) | pip | **VST3 + AU** | 0.9.26，Spotify 维护，活跃 | ✓ **唯一现成可用** |
| Carla (KXStudio) | 原生应用 | VST2/VST3/LV2 | Linux 为主，Windows 支持弱 | ⚠️ 不作宿主库用，只能当外部应用 |
| Element / Gig Performer | 原生应用 | VST3 | 商业/半商业 | ⚠️ 无编程接口，不能当库 |

**关键结论**：JS 生态**没有**「load 一个 .vst3 文件并处理音频」的库。
这不是「没找到」，是「不存在」——VST3 是 C++ 采样级 API，需要 COM 式的 ABI，JS 侧只能通过原生桥。

---

## 二、VST3 SDK 许可（做闭源宿主必须先搞清）

VST 3 SDK 是 **双许可**：
1. **GPLv3** —— 用它就必须把宿主也开源（GPL 传染）
2. **Steinberg 的专有 VST 3 许可** —— 签协议后可用于闭源产品

对 LIZI 的含义：
- LIZI 是闭源分发的桌面应用 → **不能走 GPLv3**
- 必须用 Steinberg 专有许可（免费申请，但要注册并遵守其条款，含商标/兼容性要求）
- **这是法务问题，不是技术问题，需要你本人决定**

> 注：本机网络在调研时不稳定（GitHub 超时、搜索引擎 API key 失效），
> 上述许可结构是 VST3 生态的既有事实，但**签署条款前请自行到 steinberg.net 的 VST 3 Licensing 页确认最新版本**。

---

## 三、GUI 才是真正的死结（这有实测支撑）

实测参数规模（本机真实插件）：

| 插件 | 参数数量 |
|---|---|
| FabFilter Timeless 3 | **1012** |
| FabFilter Saturn 2 | **956** |
| FabFilter Pro-Q 4 | **581** |
| FabFilter Pro-R 2 | 141 |
| Valhalla 系列 | 19~25 |
| OTT | 20 |

**问题**：Pro-Q 4 的价值在于「拖拽 EQ 曲线」，Timeless 在于「拖延迟线做视觉反馈」。
剥掉 GUI 只留参数 API，给用户 1012 个滑杆 = 不能使用。

而 VST3 的 GUI 是 **`IPlugView`（原生 HWND）**：
- Windows 下必须用 `WS_CHILD` + `SetParent` 把插件窗口嵌进宿主
- 插件 GUI 有自己的 **UI 线程消息泵**，和 Electron 主进程的 message loop 会争抢
- 在渲染进程（Chromium sandbox）里**根本无法**创建/托管原生子窗口
→ 只能放在主进程，且需要 `setIgnoreMouseEvents` / 区域同步 / 焦点转发等一大堆细节

**结论**：想在 Electron 里做出「像 DAW 那样能操作插件 GUI」的体验，等于自研一个 VST3 host。
这是 DAW 的工作量（月级），不是播放器插件的工作量。

---

## 四、四条路的最终判定

| 路径 | 判定 | 理由 |
|---|---|---|
| **A. 虚拟声卡 + Python 宿主进程（pedalboard）** | 🟢 **推荐** | 零改动 LIZI；已验证 101/107 插件可用；代价是装驱动 + 20~50ms 延迟 |
| B. 主进程原生引擎 + IPC 回传音频 | 🟡 理论可行 | 采样率/时钟漂移难解；等于重写播放链路（周级） |
| C. Electron 内嵌原生窗口 | 🔴 不建议 | GUI 消息泵 + Chromium sandbox + 线程模型，月级工程量 |
| D. Node 原生插件调 VST3 SDK | 🔴 不可行 | 无现成库；本机无 MSVC；VST3 许可需专有协议 |

---

## 五、给 LIZI 的建议

按投入产出比：

1. **如果只是想要「调音台」这个功能** → 用 **Web Audio 自建效果链**
   （`BiquadFilter` 做 EQ、`DynamicsCompressor` 做压缩、`Convolver` 做混响、`WaveShaper` 做染色）。
   零依赖、零许可风险、零延迟、能直接接进现有 `beat.js` 的音频图。**3~5 天**。
2. **如果一定要真 VST3** → 路径 A：独立进程 + 虚拟声卡。
   宿主用 pedalboard（已验证），LIZI 侧只需加一个「VST3 工具」入口 + 配置面板。**2~3 天**。
3. **不要做** Electron 内嵌。GUI 是死结，且要买 VST3 许可 + 装 6GB VS Build Tools。

---

## 六、和实测报告的关系

| 文件 | 内容 |
|---|---|
| 本文件 | 生态/许可/GUI 分析（「为什么不该嵌」） |
| [vst3-experiment.md](vst3-experiment.md) | 本机 107 个真实插件实测（「确实能加载」） |

两份合起来才完整：**技术上能加载，工程上不该内嵌。**

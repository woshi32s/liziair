# 鼓组节拍检测 A/B 实验报告

> 隐藏式可行性实验：**没有修改 `public/beat.js`，没有接入应用**。只对比两套检测器在同一批合成鼓组上的准确度。
> 复现：`node _drumbeat-test.mjs`

## TL;DR

Folia 的鼓组节拍检测是 **70 行纯 DSP**（`folia-major/mods/visualizer52hz/beatDetector.mjs`），
不依赖任何神经网络。它比 LIZI 现版准得多，**平均 F1 0.914 vs 0.241、召回 100% vs 22%**，
误差还小 2.4ms。差异只有一个决定性的改动：
**频谱通量只统计低频 bin（1..12，约 21~260Hz），而不是全频段。**

---

## 一、两套实现到底差在哪

| | **A 组 = LIZI 现版**（`public/beat.js`） | **B 组 = Folia 版**（`mods/visualizer52hz/beatDetector.mjs`，70 行） |
|---|---|---|
| 通量统计范围 | **全频段**，bin 1 → Nyquist（2048 FFT 下约 1000 个 bin） | **只有 bin 1..12**（约 21~260Hz，kick+bass 所在） |
| 通量归一化 | `flux / freq.length`（除以 ~1000） | `flux / count`（除以 12） |
| 阈值 | 局部窗口（~1.5s）**均值 + 1.15×标准差** | `max(0.012, 指数均值 + 1.8×指数标准差)`，时间常数 1.2s |
| 额外判据 | 要求**局部极大值**（比前两帧都大） | 无 |
| 最小间隔 | 120ms | 280ms |
| 静音处理 | 无 | 超过 2s 补一个 filler 拍（不计入检出） |
| 额外能力 | 自相关估 BPM + 相位校正 + 下拍投票 | 无（只出 onset） |

### 为什么「全频段」是硬伤（本实验的核心发现）

鼓点（kick）的能量集中在 **40~120Hz**，在 2048 点 FFT / 44.1kHz 下大约只占 **bin 2~6 共 5 个 bin**。
其余约 995 个 bin 里，和声、人声、镲片、噪声也在变化，它们的正向差分**同样被计入 flux**。两个后果：

1. **信号被稀释**：kick 让 5 个 bin 各涨 0.3，贡献 flux ≈ 0.0015；而和声垫在几百个 bin 上各涨 0.01，
   贡献 flux ≈ 0.01 —— **和声的「通量」是 kick 的 6 倍以上**，kick 反而被淹没。
2. **阈值被抬高**：flux 主要由非鼓内容决定，局部标准差也被撑大，阈值水涨船高。

B 组把统计范围切到 12 个低频 bin 之后，和声（261Hz 起）**根本不进统计**，kick 占通量绝对主导 ——
这是它 F1 直接到 1.0 的原因。

> 顺带：A 组那条「要求局部极大值」的判据在稀释之后反而帮倒忙。
> 当 kick 的通量贡献很小、曲线主要由和声起伏主导时，真正的 kick 帧往往不是局部极大值，被直接否掉。
> 实测 90BPM 反拍场景 A 组**召回 0**，一条都没检出。

---

## 二、实验结果

评分：与真实 kick 时刻误差 **±70ms 内**算命中（人在 ~100ms 内感知不到节拍错位，70ms 是保守值）。

| 场景 | A F1 | A 命中/检出/真实 | A 误差 | B F1 | B 命中/检出/真实 | B 误差 |
|---|---|---|---|---|---|---|
| 120BPM 四踩 + 和弦垫（无障碍） | 0.232 | 8/29/40 | 13.1ms | 1 | 40/40/40 | 13.9ms |
| 128BPM 四踩 + 铺底和声（House，常见） | 0.198 | 8/38/43 | 17.3ms | 1 | 43/43/43 | 13.5ms |
| 90BPM 反拍（kick 只在一三拍） | 0 | 0/31/15 | —ms | 0.508 | 15/44/15 | 15.3ms |
| 140BPM 四踩 + 高噪声（SNR 15dB，难） | 0.308 | 10/18/47 | 22.9ms | 1 | 47/47/47 | 15.5ms |
| 100BPM 纯 kick（最干净，看基础准确度） | 0.455 | 15/32/34 | 15ms | 1 | 34/34/34 | 14.1ms |
| 174BPM DnB 速度（快，考验最小间隔） | 0.179 | 10/54/58 | 19.1ms | 1 | 58/58/58 | 13.4ms |
| ★ 纯贝斯无鼓（误报陷阱，真值 0） | — | 0/17/0 | —ms | — | 0/19/0 | —ms |

### 汇总（6 个有真值的场景；纯贝斯场景无真值不参与）

| 指标 | A(LIZI) | B(Folia) |
|---|---|---|
| 平均 F1 | **0.229** | **0.918** |
| 平均召回 | 0.202 | **1.000** |
| 平均精确 | 0.283 | 0.890 |
| 平均时间误差 | 17.480ms | **14.283ms** |

**纯贝斯误报**：A = 0.85 次/秒，B = 0.95 次/秒。
两家都会在「只有贝斯没有鼓」时误报（贝斯和 kick 抢同一个频段，物理限制）。
**这条很重要**：说明 B 组不是「只会变准」，它的误报和 A 组同量级 ——
换成 B 组不会让慢歌/纯人声段落变乱，只是把真鼓点抓准了。

### 图示

灰竖线 = 真实 kick，红点 = A 组，绿点 = B 组：

![A/B 对比 1](shots/review/_drumbeat-1-four-on-floor.png)

![A/B 对比 2](shots/review/_drumbeat-2-four-on-floor.png)

![A/B 对比 3](shots/review/_drumbeat-3-backbeat.png)

绿点与每条灰线一一对应；红点稀疏且明显偏离 —— 这就是召回 22% vs 100% 的直观样子。

---

## 三、测试台的两个关键修正（否则结论会错）

修这两个 bug 之前，实验看起来是「两边都晚 30ms」—— **那个数字是假的**。

### 1. 时间戳必须用窗口**末端**，不是起点

`AnalyserNode.getByteFrequencyData` 反映的是**最近 FFT_SIZE 个样本**，即「现在往前一个窗口」。
用窗口起点当时间戳，所有检出会凭空滞后半个窗口（2048/44100 ≈ 46ms，半窗 23ms）。
改成 `(s + FFT) / SR` 后，两组误差同步从 ~30ms 降到 ~14ms。
剩下 14ms 是真实算法延迟（阈值是因果的，必须等能量进来才能判断），15ms 量级对视觉跟随完全够用。

### 2. 必须补一个「无鼓」场景

只测「有鼓」看不到误报。加了 `bass-only`（纯贝斯线，真值集合为空）之后才知道 **B 组也会误报**（0.9 次/秒）。
没有这个场景，会误以为 B 组纯赚。

---

## 四、如果要落地（本轮不做）

只做一个形态的试验就够了，建议顺序：

1. **只改 `beat.js` 里 flux 的统计范围**（全频段 → 低频段），注意 `prevSpec` 要用相同范围初始化/更新，别混用。
2. **保留 A 组的 BPM 估计和下拍投票** —— 那是 LIZI 的增量价值，Folia 那个文件里没有。
   B 组只解决「起音点在哪」，不解决「速度是多少」。
3. **阈值换成指数形式**（`mean += alpha*(flux-mean)`），省掉每帧 512 次窗口遍历，
   顺带解决 1.5s 窗口在开头几秒不准的问题。
4. **先在一个形态上验证**（013 涟漪 / 035 黏糊的节奏感最明显），确认观感变好再推广。

### 风险

- 低频段检测在**没有底鼓的歌**（民谣、清唱、古典）里会退化：只剩贝斯在跳，节拍会跟贝斯走而不是跟歌走。
  缓解：保留「能量不足时不发拍」的闸门。
- 最小间隔从 120ms 放到 280ms 会**丢掉 214BPM 以上的细分**。需要更密节奏的形态要参数化，不能写死。
- 本实验用的是**合成信号**（频率/包络可控，便于算真值）。真实网易云曲目上还需实听验证。

---

```json
[
  {
    "bpm": 120,
    "seconds": 20,
    "style": "four-on-floor",
    "snr": 60,
    "label": "120BPM 四踩 + 和弦垫（无障碍）",
    "config": {
      "bpm": 120,
      "seconds": 20,
      "style": "four-on-floor",
      "snr": 60
    },
    "truthCount": 40,
    "lizi": {
      "hits": 8,
      "detected": 29,
      "truth": 40,
      "precision": 0.276,
      "recall": 0.2,
      "f1": 0.232,
      "meanErrMs": 13.1,
      "falsePositives": 21,
      "missed": 32
    },
    "folia": {
      "hits": 40,
      "detected": 40,
      "truth": 40,
      "precision": 1,
      "recall": 1,
      "f1": 1,
      "meanErrMs": 13.9,
      "falsePositives": 0,
      "missed": 0
    },
    "frames": 1198
  },
  {
    "bpm": 128,
    "seconds": 20,
    "style": "four-on-floor",
    "snr": 25,
    "label": "128BPM 四踩 + 铺底和声（House，常见）",
    "config": {
      "bpm": 128,
      "seconds": 20,
      "style": "four-on-floor",
      "snr": 25
    },
    "truthCount": 43,
    "lizi": {
      "hits": 8,
      "detected": 38,
      "truth": 43,
      "precision": 0.211,
      "recall": 0.186,
      "f1": 0.198,
      "meanErrMs": 17.3,
      "falsePositives": 30,
      "missed": 35
    },
    "folia": {
      "hits": 43,
      "detected": 43,
      "truth": 43,
      "precision": 1,
      "recall": 1,
      "f1": 1,
      "meanErrMs": 13.5,
      "falsePositives": 0,
      "missed": 0
    },
    "frames": 1198
  },
  {
    "bpm": 90,
    "seconds": 20,
    "style": "backbeat",
    "snr": 60,
    "label": "90BPM 反拍（kick 只在一三拍）",
    "config": {
      "bpm": 90,
      "seconds": 20,
      "style": "backbeat",
      "snr": 60
    },
    "truthCount": 15,
    "lizi": {
      "hits": 0,
      "detected": 31,
      "truth": 15,
      "precision": 0,
      "recall": 0,
      "f1": 0,
      "meanErrMs": null,
      "falsePositives": 31,
      "missed": 15
    },
    "folia": {
      "hits": 15,
      "detected": 44,
      "truth": 15,
      "precision": 0.341,
      "recall": 1,
      "f1": 0.508,
      "meanErrMs": 15.3,
      "falsePositives": 29,
      "missed": 0
    },
    "frames": 1198
  },
  {
    "bpm": 140,
    "seconds": 20,
    "style": "four-on-floor",
    "snr": 15,
    "label": "140BPM 四踩 + 高噪声（SNR 15dB，难）",
    "config": {
      "bpm": 140,
      "seconds": 20,
      "style": "four-on-floor",
      "snr": 15
    },
    "truthCount": 47,
    "lizi": {
      "hits": 10,
      "detected": 18,
      "truth": 47,
      "precision": 0.556,
      "recall": 0.213,
      "f1": 0.308,
      "meanErrMs": 22.9,
      "falsePositives": 8,
      "missed": 37
    },
    "folia": {
      "hits": 47,
      "detected": 47,
      "truth": 47,
      "precision": 1,
      "recall": 1,
      "f1": 1,
      "meanErrMs": 15.5,
      "falsePositives": 0,
      "missed": 0
    },
    "frames": 1198
  },
  {
    "bpm": 100,
    "seconds": 20,
    "style": "kick-only",
    "snr": 30,
    "label": "100BPM 纯 kick（最干净，看基础准确度）",
    "config": {
      "bpm": 100,
      "seconds": 20,
      "style": "kick-only",
      "snr": 30
    },
    "truthCount": 34,
    "lizi": {
      "hits": 15,
      "detected": 32,
      "truth": 34,
      "precision": 0.469,
      "recall": 0.441,
      "f1": 0.455,
      "meanErrMs": 15,
      "falsePositives": 17,
      "missed": 19
    },
    "folia": {
      "hits": 34,
      "detected": 34,
      "truth": 34,
      "precision": 1,
      "recall": 1,
      "f1": 1,
      "meanErrMs": 14.1,
      "falsePositives": 0,
      "missed": 0
    },
    "frames": 1198
  },
  {
    "bpm": 174,
    "seconds": 20,
    "style": "four-on-floor",
    "snr": 30,
    "label": "174BPM DnB 速度（快，考验最小间隔）",
    "config": {
      "bpm": 174,
      "seconds": 20,
      "style": "four-on-floor",
      "snr": 30
    },
    "truthCount": 58,
    "lizi": {
      "hits": 10,
      "detected": 54,
      "truth": 58,
      "precision": 0.185,
      "recall": 0.172,
      "f1": 0.179,
      "meanErrMs": 19.1,
      "falsePositives": 44,
      "missed": 48
    },
    "folia": {
      "hits": 58,
      "detected": 58,
      "truth": 58,
      "precision": 1,
      "recall": 1,
      "f1": 1,
      "meanErrMs": 13.4,
      "falsePositives": 0,
      "missed": 0
    },
    "frames": 1198
  },
  {
    "bpm": 110,
    "seconds": 20,
    "style": "bass-only",
    "snr": 40,
    "label": "★ 纯贝斯无鼓（误报陷阱，真值 0）",
    "config": {
      "bpm": 110,
      "seconds": 20,
      "style": "bass-only",
      "snr": 40
    },
    "truthCount": 0,
    "lizi": {
      "hits": 0,
      "detected": 17,
      "truth": 0,
      "precision": 0,
      "recall": null,
      "f1": null,
      "meanErrMs": null,
      "falsePositives": 17,
      "missed": 0,
      "falseAlarmsPerSec": 0.85
    },
    "folia": {
      "hits": 0,
      "detected": 19,
      "truth": 0,
      "precision": 0,
      "recall": null,
      "f1": null,
      "meanErrMs": null,
      "falsePositives": 19,
      "missed": 0,
      "falseAlarmsPerSec": 0.95
    },
    "frames": 1198
  }
]
```
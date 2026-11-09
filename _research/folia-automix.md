# Folia Automix 调研报告：两手歌曲智能过渡的实现与移植可行性

> 调研对象：`E:\DSHdesktop\work\folia-major`（Folia，TypeScript + Electron）
> 目标：判断能否复现到 LIZI（`E:\DSHdesktop\work\music-player`，`<audio>` + 网易云流）
> 约束：纯调研，未修改任何文件。所有引用均为真实代码位置。

---

## 一句话结论

Folia 的 automix 本质是**「离线全曲分析（ONNX 拍点 + htdemucs 分轨）→ 纯函数乐理决策 → Web Audio 采样级调度」**三层架构；真正决定听感的不是曲线数学（那部分只有约 60 行，可整段抄），而是**证据层**（Beat This! 的 bar grid 与 4 轨 stems）。LIZI **可以复现轻量版**：因为没有 `decodeAudioData` 但有实时 `AnalyserNode`（`beat.js` 已在跑），所以只能做「实时估计 BPM+相位 + 等功率交叉淡化 + 三频段交接」，做不到分轨、降 BPM 对齐、按乐句定长度；且**音频 ArrayBuffer 在 LIZI 目前拿不到**（`audio.src` 直连网易云 CDN，`server.mjs` 只有图片代理，无音频代理），要做离线分析必须先补一个同源音频代理。

---

## 架构流程图

### Folia 全链路（四层）

```
┌─ 预取阶段（播放前数分钟）──────────────────────────────────────────────┐
│ prefetchService.ensureTrackProfile()        src/services/prefetchService.ts
│   └─ ensureTrackProfile(request)            profileService.ts:369
│        ├─ readPrefix()  fetch(Range: bytes=0-1572863)   profileService.ts:230
│        │     └─ 非 206 就放弃（不整段下载）              profileService.ts:232
│        ├─ decodeAtProfileRate()  OfflineAudioContext @22050  profileService.ts:178
│        ├─ analyseBeatGrid(melSpectrogram)   beatThis.ts:444
│        │     └─ window.electron.runBeatThis → utilityProcess → beat_this.onnx (83MB)
│        └─ analyseTrack(pcm)                 trackProfile.ts
│              → TrackProfile{bpm,outroBpm,beatOffset,downbeatOffset,lufs,key,
│                              sections,leadOut,bodyOut,startsHot,tailDb,...}
│
├─ 准备阶段（当前曲目开播时）───────────────────────────────────────────────┤
│ ensureStems({song, role:'tail'|'head'})     stems.ts
│   └─ window.electron.separateStems → Python 旁挂 → htdemucs-v2.onnx (108MB)
│         → 首/尾各 30s，4 轨 drums/bass/other/vocals，Int16 存储
│
├─ 排程阶段（距歌尾 25+1 秒内，每次 timeupdate 检查）───────────────────────┤
│ useAutomixDecks.checkTransitionPoint(time)  useAutomixDecks.ts:530
│   ├─ 早退：duration-time > 25+1 → return                 :542
│   └─ session.requestTransition()            automixSession.ts:751
│        └─ planForMode(settings,...)         transitionStrategy.ts:116
│             ├─ planCrossfade()              crossfadePlanner.ts:56   ← Crossfade 模式
│             └─ planTransition()             transitionPlanner.ts:320 ← Automix 模式
│                  ├─ chooseTransitionStyle()  transitionChooser.ts:175
│                  │    ├─ keyRelation()       → compatible/adjacent/neutral/clashing
│                  │    ├─ tempoMatch(settledBpm(),…) musicalTime.ts:101
│                  │    └─ toneTilt()          signalAnalysis.ts:584
│                  ├─ quantiseToMusic()        musicalTime.ts:188（乐句/小节/拍取整）
│                  ├─ snapToGrid + sections    transitionPlanner.ts:639-642
│                  └─ alignEntry()             musicalTime.ts:261（进场点对齐）
│        → TransitionPlan (transitionPlanner.ts:57)
│   ├─ phase='armed'，rampGain(incoming,0)，seekTo(inStart)
│   ├─ onAutoplayHoldChange(true)  ← 只压 play()，允许缓冲
│   └─ advanceTrack()              ← 队列提前推进
│
└─ 执行阶段（到点，incoming 元素真的开始出声）──────────────────────────────┤
  handleActiveDeckPlaying()               automixSession.ts:864
    ├─ tailClock.positionAt(now)          deckClock.ts:134（最小二乘拟合，亚毫秒）
    ├─ phase='fading'                                        :926
    ├─ resolveOverlap(plan, remaining)    transitionPlanner.ts:748（二次闸门）
    ├─ applyTempoBend(tailEl, stretch)    tempoBend.ts:17（playbackRate+preservesPitch）
    ├─ waitToGrid()/analyser.nextBeatIn() → nextBeatIn       :1015
    ├─ planBlendShape()                   signalAnalysis.ts:371（crossover+拍对齐）
    ├─ shapeBlend()                       transitionChooser.ts:320（style→hold/overlap）
    │
    ├─ useStems ? ──► scheduleStemGesture()                  :357
    │     ├─ planVocalExit() + planStemHandover()  stemGesture.ts:260 / :521
    │     ├─ outgoingCurves()/incomingCurves()     stemGesture.ts:717 / :731
    │     ├─ connectStemBus()  softLimit 软限幅     crossfadeGraph.ts:381
    │     ├─ connectStemDeck() ×2                   crossfadeGraph.ts:427
    │     └─ scheduleStemWindow()                   crossfadeGraph.ts:538
    │
    └─ 否 ──► scheduleBandBlend()  三频段交接        crossfadeGraph.ts:213
              scheduleEchoThrow()  回声抛掷（可选）  crossfadeGraph.ts:277
              scheduleCrossfade()  等功率主曲线      crossfadeGraph.ts:622
              startBalanceCorrection() 响度配平      automixSession.ts:279
    └─ announceTransition(cue)                      transitionCue.ts:70
    └─ setTimeout(settle)  所有结局必经             automixSession.ts:686
```

### 一句话链路

`checkTransitionPoint → requestTransition → planForMode → planTransition → TransitionPlan → handleActiveDeckPlaying → planBlendShape/shapeBlend → scheduleCrossfade | scheduleStemWindow → settle`

---

## 六个子问题逐条回答

### 1. 整体架构：从「决定切歌」到「切完」经过哪几步

四层分离，README §2 有完整职责表（`src/services/automix/README.md:30-66`）。关键点是**证据层与决策层都是纯函数**，只有执行层碰 Web Audio。

**证据层**：`trackProfile.ts`（离线分析）、`signalAnalysis.ts`（数学）、`profileService.ts`（I/O）、`beatThis.ts`（拍点模型前处理）、`stems.ts`（分离窗口管理）、`stemGesture.ts`（分轨手势纯算术）、`deckAnalyser.ts`（实时分析器）、`deckClock.ts`（播放位置拟合）。

**决策层**：`musicalTime.ts`、`transitionChooser.ts`、`transitionPlanner.ts`、`crossfadePlanner.ts`、`transitionStrategy.ts`。

**执行层**：`automixSession.ts`（状态机 `idle→armed→fading`）、`crossfadeGraph.ts`（节点图）、`tempoBend.ts`。

**绑定层**：`useAutomixDecks.ts`（两个 `<audio>` 元素）。

核心契约是 `TransitionPlan`（`transitionPlanner.ts:57`），两个规划器返回同一结构，执行层不关心是谁写的：

```ts
// transitionPlanner.ts:57-95（节选）
export interface TransitionPlan {
    kind: TransitionKind;      // 'hardCut' | 'fade'
    style: TransitionStyle;    // beatCut | bassSwap | tailRide | plainBlend
    relation: KeyRelation;
    tempo: TempoRelation;
    stretch: number;           // 出场曲 playbackRate，1 = 不变速
    tiltDb: [number, number];  // 进场曲中/高频修正
    echoThrow: boolean;
    outStart: number; inStart: number;
    overlap: number; minOverlap: number;
    reason: string;            // 打进控制台，非装饰
    expansion?: number | null;
}
```

**四次状态转移**：

1. `requestTransition`（`automixSession.ts:751`）——只在 `phase === 'idle'` 时工作；算完 plan 后，若 `time >= outStart - AUTOMIX_ARM_LEAD_SEC(=1)` 才真的 arm（`:800`）。arm 时把进场 deck 静音、seek 到 `inStart`、`onAutoplayHoldChange(true)`、`advanceTrack()`（`:816-859`）。
2. `handleActiveDeckPlaying`（`:864`）——进场 deck 真正出声的那一刻，是**最后一刻还能反悔的地方**；二次闸门 `resolveOverlap`（`:918`）按剩余时长裁剪，`overlap <= 0` 或队列变了就退化成 50ms 硬切（`:946-961`）。
3. `phase = 'fading'`（`:926`），随后按 `useStems` 分叉。
4. `settle`（`:686`）——**所有结局的唯一出口**：停 stem 链、释放软限幅总线、解除 autoplay hold、两路 gain/trim/tone/throw/tempo 全部复位到 unity、`announceTransition(null)`。

```ts
// automixSession.ts:686-694
const settle = (options: { pauseTail: boolean; harvest?: boolean }) => {
    diagMark(`settle (pauseTail=${options.pauseTail})`);
    clearTimers();
    expansionStop?.(); expansionStop = null;
    stemChains.forEach(chain => chain.stop());
    stemChains = [];
    stemBus?.stop(); stemBus = null;
```

驱动方式：**定时器不是 rAF**（`useAutomixDecks.ts:72`，`ANALYSER_INTERVAL_MS = 25`），因为「rAF 在窗口隐藏时就停了，而音乐播放器大部分时间在后台」。

---

### 2. 过渡点（cue/beat）怎么选

**先纠正一个前提**：`transitionCue.ts` 与过渡点选择**无关**。它是给 UI 的广播通道（全屏过渡环 / 现在播放卡片边框 / Remote 窗口），`TransitionCue` 只含 `seconds / crossover / periodSec / plain / preview`（`transitionCue.ts:23-50`）。**真正的 cue 点由 `transitionPlanner.ts` + `musicalTime.ts` 决定。**

对齐用三层证据，优先级从高到低：

**(a) 结构边界优先于小节线**——`SECTION_SNAP_SEC = 2`，`GRID_SNAP_BEATS = 1`：

```ts
// transitionPlanner.ts:636-645
const lowest = Math.min(anchor, latest);
const withinRange = (value: number) => value >= lowest - 1e-6 && value <= latest + 1e-6;
// A structural boundary first, because it is the stronger claim: a bar line says the count
// restarts, a section edge says the music does.
const boundary = nearestWithin(from.profile?.sections, anchor, SECTION_SNAP_SEC, withinRange);
const grid = entryGrid(bpm, from.profile?.beatOffset);
const snapped = snapToGrid(boundary ?? anchor, grid, beat === null ? 0 : beat * GRID_SNAP_BEATS);
const outStart = withinRange(snapped) ? snapped : boundary ?? anchor;
```

**(b) 对齐用「拍网格」而不是「小节网格」**——这是一次实测纠正，注释里带 30 首曲库的对比数据：

```ts
// transitionPlanner.ts:247-250
const entryGrid = (
    bpm: number | null | undefined,
    beatOffset: number | null | undefined,
) => barGrid(bpm, beatOffset, 1);   // beatsPerBar = 1，即拍网格
```

同文件 `:234-237` 给出对比：「bar line, else no alignment 0.255 beats（15/58）／the beat grid, both sides 0.118（30/58）／no alignment 0.250（chance）」。即**小节线方案等于随机**，因为 `estimateDownbeat` 的投票在 30 首里只答对约 20%。

**(c) 进场点对齐（唯一能真正 beat-match 的杠杆）**——`alignEntry`：

```ts
// musicalTime.ts:261-274
export const alignEntry = (
    earliest: number,
    incoming: Grid | null,
    /** Seconds from the handover to the outgoing track's next bar line. */
    outgoingBarPhase: number | null,
): number => {
    if (!incoming || outgoingBarPhase === null || !(incoming.period > 0)) return earliest;
    const barsIn = Math.ceil((earliest - incoming.offset) / incoming.period);
    const line = incoming.offset + Math.max(0, barsIn) * incoming.period;
    const entry = line - outgoingBarPhase;
    return entry >= earliest ? entry : entry + incoming.period;
};
```

注释（`:248-259`）说明了为什么这是「gain curve 永远无法替代的那一半」：两首同速但小节错开四分音符的曲子，无论怎么调音量都一直错开四分音符，唯一杠杆是**从第二首的第几秒开始播**。

**(d) crossover 落点再用拍网格吸附一次**（执行期，`planBlendShape`）：

```ts
// signalAnalysis.ts:382-390
const target = input.overlap * crossover;
const beat = nextBeatIn + Math.round((target - nextBeatIn) / periodSec) * periodSec;
if (!(beat > 0)) return shape;
const overlap = beat / crossover;
if (overlap < low || overlap > high) return shape;
return { overlap, crossover, snappedToBeat: true };
```

**Phrase / 8-bar**：`BEATS_PER_PHRASE = 4 × 4 = 16`（`musicalTime.ts:11`），用在**长度**而非落点上——`AUTOMIX_DEFAULT_OVERLAP_BEATS = BEATS_PER_PHRASE * 2`（= 8 小节，`transitionPlanner.ts:146`），再经 `quantiseToMusic` 按乐句/小节/拍三级降档取整（`musicalTime.ts:188-210`）。

---

### 3. 增益/滤波曲线怎么做（含完整公式）

#### 3.1 `buildCrossfadeCurves` —— 等功率余弦 + 可选平台

```ts
// signalAnalysis.ts:435-469
export const buildCrossfadeCurves = (
    crossover: number,
    /** 0 is a pure crossfade, which is what a crossfade should be. Up to 0.8 of held middle. */
    together = 0,
    points = 64,
): { out: Float32Array; in: Float32Array } => {
    const pivot = clamp(crossover, 0.15, 0.85);
    const held = clamp(together, 0, 0.8);
    const lead = pivot * (1 - held);
    const trail = pivot + (1 - pivot) * held;
    const out = new Float32Array(points);
    const incoming = new Float32Array(points);

    for (let index = 0; index < points; index += 1) {
        const progress = index / (points - 1);
        // Piecewise linear through (0,0) (lead,0.5) (trail,0.5) (1,1)
        const warped = progress <= lead
            ? (progress / Math.max(1e-3, lead)) * 0.5
            : progress >= trail
                ? 0.5 + ((progress - trail) / Math.max(1e-3, 1 - trail)) * 0.5
                : 0.5;
        const angle = warped * (Math.PI / 2);
        const headroom = dbToGain(-BLEND_HEADROOM_DB * headroomBell(progress));
        out[index] = Math.cos(angle) * headroom;
        incoming[index] = Math.sin(angle) * headroom;
    }

    return { out, in: incoming };
};
```

数学写法：

```
warped(p) = 0.5·p/lead                   p ≤ lead
          = 0.5                          lead < p < trail
          = 0.5 + 0.5·(p−trail)/(1−trail) p ≥ trail
angle(p)  = warped(p) · π/2
g_out(p)  = cos(angle(p)) · 10^(−1.5·sin(πp)/20)
g_in(p)   = sin(angle(p)) · 10^(−1.5·sin(πp)/20)
```

其中 `lead = pivot·(1−held)`，`trail = pivot + (1−pivot)·held`，`held ∈ [0, 0.8]`。

**关键性质（注释 `:414-433` 明确论证）**：

- 两侧读同一个 `warped(p)`，故 `cos² + sin² ≡ 1`——**移动 crossover 只改变两曲的换手速率，不会让中段塌陷或鼓起**。
- 平台段停在 `cos(π/4) = sin(π/4) = 0.7071`，**不消耗任何 headroom**，中段合成功率与其它时刻逐点相同。
- `headroomBell(p) = sin(πp)`（`:410`），两端为 0、中间为 1，故曲线**起止都精确等于 1**，无需在过渡结束时「还回去」（否则进场曲独奏时会听到 1.5dB 鼓包）。
- `BLEND_HEADROOM_DB = 1.5`（`:401`）：等功率保证的是恒定**功率**而非恒定**峰值**，两张现代母带叠加会过满刻度。

**`together` 是「混音」与「淡化」的唯一区别**（`transitionChooser.ts:307-312`）：

```ts
const TOGETHER: Record<TransitionStyle, number> = {
    beatCut: 0, bassSwap: 0.55, tailRide: 0.5, plainBlend: 0,
};
```

#### 3.2 `crossoverFor` —— 换手点由出场曲响度决定

```ts
// signalAnalysis.ts:320-329
export const crossoverFor = (outgoingDb: number | null): number => {
    if (outgoingDb === null || !Number.isFinite(outgoingDb)) {
        return (CROSSOVER_EARLY + CROSSOVER_LATE) / 2;
    }
    // Not monotonic on purpose. A quiet tail is worth waiting for; a track that has already faded
    // to nothing is not, and holding the incoming one back for it leaves an audible hole.
    if (outgoingDb <= SILENT_TAIL_DB) return CROSSOVER_EARLY;
    const loudness = clamp((outgoingDb - QUIET_OUTRO_DB) / (LOUD_OUTRO_DB - QUIET_OUTRO_DB), 0, 1);
    return CROSSOVER_LATE + (CROSSOVER_EARLY - CROSSOVER_LATE) * loudness;
};
```

常量：`CROSSOVER_EARLY = 0.35`、`CROSSOVER_LATE = 0.55`（`:21-22`）、`LOUD_OUTRO_DB = -14`、`QUIET_OUTRO_DB = -30`、`SILENT_TAIL_DB = -45`（`:16-20`）。

即：**响而密的尾奏 → 0.35（早让位）；安静的衰减尾 → 0.55（让它多跑一会儿）；已静音 → 0.35**。

#### 3.3 `trimForBalance` —— 只压出场曲

```ts
// signalAnalysis.ts:338-339
export const trimForBalance = (outgoingDb: number, incomingDb: number): number =>
    clamp(outgoingDb - incomingDb, 0, MAX_TRIM_DB);   // MAX_TRIM_DB = 6
```

只做衰减、只对离开的那一首、且单调不回退（`automixSession.ts:279-297` 每 100ms 检查一次、每次最多 0.75dB、0.4s 斜坡）——「单调的单向 trim 不会振荡」。

#### 3.4 `planBlendShape` —— 长度与 crossover 的联立

```ts
// signalAnalysis.ts:371-391（核心）
const low = Math.max(input.minOverlap, input.overlap * (1 - BEAT_SNAP_TOLERANCE));
const high = Math.min(input.maxOverlap, input.overlap * (1 + BEAT_SNAP_TOLERANCE));
if (low > high) return shape;
const target = input.overlap * crossover;
const beat = nextBeatIn + Math.round((target - nextBeatIn) / periodSec) * periodSec;
if (!(beat > 0)) return shape;
const overlap = beat / crossover;          // ← 反解：overlap = beat/crossover
if (overlap < low || overlap > high) return shape;
return { overlap, crossover, snappedToBeat: true };
```

`BEAT_SNAP_TOLERANCE = 0.25`（`:28`）——允许多达 ±25% 的长度偏差去换取 crossover 落在拍上；超了就不要这个吸附。

#### 3.5 `buildBandCurves` —— 三频段各有时序（这是「频段交接」的数学）

```ts
// signalAnalysis.ts:539-574
export const buildBandCurves = (request: BandBlendRequest): BandBlendCurves => {
    const points = request.points ?? 64;
    const seam = clamp(request.crossover, 0.15, 0.85);
    const width = Math.max(0.02, Math.min(BASS_SWAP_WIDTH, seam, 1 - seam));
    const tiltMid = clamp(request.tiltDb[0], -MAX_TILT_DB, MAX_TILT_DB);
    const tiltHigh = clamp(request.tiltDb[1], -MAX_TILT_DB, MAX_TILT_DB);
    ...
    for (let index = 0; index < points; index += 1) {
        const progress = index / (points - 1);
        const handover = clamp((progress - (seam - width / 2)) / width, 0, 1);
        const leaving = clamp((progress - seam) / Math.max(1e-3, 1 - seam), 0, 1) ** 2;
        const settling = clamp(1 - progress / Math.max(1e-3, seam), 0, 1);

        if (request.swapBass) {
            out[0][index] = -BASS_KILL_DB * handover;
            incoming[0][index] = -BASS_KILL_DB * (1 - handover);
        }
        if (request.sweepOut) {
            out[2][index] = -SWEEP_OUT_HIGH_DB * leaving;
        }
        incoming[1][index] = tiltMid * settling;
        incoming[2][index] = tiltHigh * settling;
    }
    return { out, in: incoming };
};
```

公式（`seam` = crossover，`w = BASS_SWAP_WIDTH = 0.12` 且被夹在 `[0.02, min(w, seam, 1−seam)]`）：

```
handover(p) = clamp((p − (seam − w/2)) / w, 0, 1)        // 低频换手，宽度仅 12% 全程
leaving(p)  = clamp((p − seam) / (1 − seam), 0, 1)²      // 二次曲线，接缝处不动，之后加速
settling(p) = clamp(1 − p / seam, 0, 1)                  // 进场曲音色：从 bent 回到 flat

低频： out.low = −24·handover dB      in.low  = −24·(1−handover) dB   （BASS_KILL_DB = 24）
高频： out.high = −9·leaving dB                                       （SWEEP_OUT_HIGH_DB = 9）
中/高： in.mid  = tiltMid·settling dB  in.high = tiltHigh·settling dB （MAX_TILT_DB = 3）
```

三个频段的边界（`signalAnalysis.ts:482-484`）：

```ts
export const TONE_EDGE_HZ = [250, 4000] as const;
export const TONE_MID_HZ = Math.round(Math.sqrt(TONE_EDGE_HZ[0] * TONE_EDGE_HZ[1]));  // = 1000
```

即 `lowshelf@250Hz` / `peaking@1000Hz (Q=0.8)` / `highshelf@4000Hz`（`crossfadeGraph.ts:118-122`、`MID_BELL_Q = 0.8` 于 `:59`）。

**为什么要三频段**（`:525-537` 注释）：单一 gain 曲线意味着过渡中每一个频率两首都在，「两套编曲、两条贝斯线、两套镲同时叠着」；低频几乎全部是糊的来源，所以**同一时刻只有一个低端**；高频让出场方提前离开，读起来是「被拉走」而不是「被关小」。

#### 3.6 三频段如何落到 Web Audio

```ts
// crossfadeGraph.ts:241-253
([[bands(outgoing), curves.out], [bands(incoming), curves.in]] as const).forEach(
    ([filters, shapes]) => filters.forEach((filter, band) => {
        filter.gain.cancelScheduledValues(begins);
        filter.gain.setValueCurveAtTime(shapes[band], begins, seconds);
        filter.gain.setValueAtTime(shapes[band][shapes[band].length - 1], resetAt);
        filter.gain.linearRampToValueAtTime(0, resetAt + TONE_RESET_SEC);
    }),
);
```

注意 `begins = Math.max(startAt, context.currentTime)`（`:234`）——**一个起点已过去的曲线不会从过去开始，它只是变长了**（`:225-233`），所以整段调度必须锚在夹过之后的起点上，复位事件再往后让 `CURVE_TAIL_GUARD_SEC = 0.006`。

#### 3.7 `softLimit` —— 两路求和后的软限幅

```ts
// crossfadeGraph.ts:331-361
const LIMIT_KNEE = 0.95;
const LIMIT_RANGE = 4;
export const softLimit = (x: number): number => {
    const level = x < 0 ? -x : x;
    if (level <= LIMIT_KNEE) return x;
    const room = 1 - LIMIT_KNEE;
    const held = LIMIT_KNEE + room * Math.tanh((level - LIMIT_KNEE) / room);
    return x < 0 ? -held : held;
};
```

转折点 0.95 以下是**恒等**（不是近似），之上 `tanh` 单调、奇对称、无拐角、渐近于 1。用 `WaveShaper`（8192 点）+ 前置 `1/LIMIT_RANGE` 缩放实现（`:381-402`），`oversample = 'none'`（不让整体重采样破坏直线段）。

---

### 4. 分轨（stems）用了吗？用的是什么模型？

**用了，而且是 Folia 最核心的差异点。** `stems.ts` 不是自己跑推理，而是**窗口管理与缓存**，推理在 Electron 主进程之外的 Python 旁挂进程里。

**模型**（`MODELS.md:10-17`）：

| | beat_this | htdemucs |
|---|---|---|
| 文件 | `beat_this.onnx` | `htdemucs-v2.onnx` |
| 上游 | mosynthkey/beat_this_cpp | itamiArika/htdemucs-int8-memory（Meta htdemucs 叠加改动） |
| 下载体积 | **83.1 MB** | **107.9 MB** |
| 授权 | MIT | MIT |
| 运行时 | onnxruntime-node，**WebGPU** | 独立 Python 进程，**CPU**；STFT/iSTFT 在 numpy |

**不是 WASM，是 ONNX**；且 htdemucs **不在 Node 里跑**，走一个自带裁剪版 CPython 的旁挂进程（35–61MB，随平台），唯一理由是 `enable_mem_reuse = False` 这个开关只有 Python pybind 能拨（`MODELS.md:171-174`，该开关把 2543MB 降到 790MB）。模型文件**不进 git、不进安装包**，设置页按需下载 + sha256 校验（`MODELS.md:3-5`、README `:216-222`）。

**用法**：

- 只分离首/尾 **各 30 秒**（`STEM_SAMPLE_RATE = 44100`、`STEM_WINDOW_SEC = 30`，`stems.ts:38,61`），四轨 `drums / bass / other / vocals`（`STEM_NAMES`，`:35`）。
- 30 秒由「规划器可要求的最大重叠 25s」锁定，**不可为省内存缩短**（`:47-51`）。
- Int16 存储 + 每轨峰值除数，单窗口 42MB → 21MB；最多缓存 4 个窗口（`MODELS.md:184-189`）。
- **`other` 由相减得出**（`mix − vocals − drums − bass`），使四轨相加精确等于原曲（−400 dB）——这是「整轨→四轨」切换成为 no-op 的前提。

**怎么用（这才是重点）**：不是「淡出鼓」，而是**每个 stem 各有自己的换手时刻**（`stemGesture.ts` 纯算术，`automixSession.ts:357` 排程）：

```ts
// stemGesture.ts:717-742
export const outgoingCurves = (windowSec: number, plan: StemHandover) =>
    ({
        vocals: curveOf(windowSec, at => fall(plan.exit.from, plan.exit.to, at)),
        drums:  curveOf(windowSec, at => fall(plan.swap, plan.swap + SWAP_EDGE_SEC, at)),
        bass:   curveOf(windowSec, at => fall(plan.bassAt, plan.bassAt + SWAP_EDGE_SEC, at)),
        other:  curveOf(windowSec, at => fall(windowSec * 0.92, windowSec, at)),
    });
```

时序（`planStemHandover`，`stemGesture.ts:521-558`）：**鼓先换手，贝斯晚一小节，进场人声在鼓之后一小节到达**（`:516-519`）。`SWAP_EDGE_SEC = 0.006`（`stemGesture.ts:714`）——6 毫秒直切，「淡了半秒的鼓就是两套鼓」。

`fall()` 故意**不是** `rise()` 的等功率补数（`stemGesture.ts:686-695`）：`fall = cos(rise·π/2)`，两者中点会掉 1.6dB，注释明确说这是听测过来的、不要「修正」。

`other`（pad / 吉他床）不换手而是**被高通扫走**：`OTHER_SWEEP_HZ = [25, 2200]`、`OTHER_SWEEP_END = 0.92`（`stemGesture.ts:745-747`），指数扫频（`crossfadeGraph.ts:561-568`）。

---

### 5. 变速/对齐（tempoBend）用的什么算法

**答案是：什么都不用——只设两个属性。** 曾经的 150 行 WSOLA worklet 被删除了，因为前提错了：

```ts
// tempoBend.ts:17-33
export const applyTempoBend = (element: HTMLAudioElement, rate: number): number => {
    if (!(rate > 0) || Math.abs(rate - 1) < 0.001) {
        resetTempoBend(element);
        return 1;
    }
    element.preservesPitch = true;
    element.playbackRate = rate;
    return rate;
};
```

原因（`tempoBend.ts:4-8`）：**媒体元素的 `preservesPitch` 规范默认就是 `true`**，元素自带时间伸缩器，且运行在浏览器音频渲染层、位于 Web Audio 取音**之前**。之前那个 worklet 假设「`playbackRate` 是重采样器」——这对重采样器成立、对媒体元素不成立，结果校正做两遍，0.75 倍速的出场曲整体升高四度。

**BPM 对齐策略**（`tempoMatch`，`musicalTime.ts:101-117`）：

```ts
const ratio = foldRatio(toBpm / fromBpm);          // 八度折叠：90 vs 180 是同一速度
const deviation = Math.abs(ratio - 1);
if (deviation < LOCKED_DEVIATION) return { relation: 'locked',       stretch: 1,     ratio };
if (deviation <= RAW_RATE_LIMIT)  return { relation: 'near',         stretch: ratio, ratio };
if (deviation <= STRETCH_LIMIT)   return { relation: 'stretchable',  stretch: ratio, ratio };
if (deviation <= DRIFT_LIMIT)     return { relation: 'drifting',     stretch: 1,     ratio };
return                                   { relation: 'far',          stretch: 1,     ratio };
```

常量：`LOCKED_DEVIATION = 0.015`、`RAW_RATE_LIMIT = 0.0594`（一个半音）、`STRETCH_LIMIT = 0.12`、`DRIFT_LIMIT = 0.25`（`musicalTime.ts:31,40,56,68`）。

**「能弯到一起」和「能叠在一起」是两个阈值**（README `:319-327`）：0.12 是伸缩器涂抹感边界，0.25 是重叠上限。中间地带 `drifting` 不变速但照常重叠，只是更短（`TEMPO_LENGTH_SCALE.drifting = 0.6`，`musicalTime.ts:169-178`）。

**只弯出场曲，永不弯进场曲**（`musicalTime.ts:72-81`）：DJ 相反（不能动全场正在跳的那张），但这里出场曲只剩几秒、没有未来可错，而进场曲即将被听三分钟，弯了它得在它独奏时扳回来——「那是整段过渡中唯一没有东西可以遮掩的时刻」。

**且分轨一旦启用就不变速**（`automixSession.ts:992-994`）：stems 是 buffer、element 是流，弯一个不弯另一个会在窗口内滑开；弯两个则要两个时钟锁 25 秒。

**相位精度的来源不是变速而是 `deckClock.ts`**：`currentTime` 是阶梯读数，但阶梯底下是严格直线（斜率即 `playbackRate`），最小二乘拟合 1.5 秒读数可把相位压到亚毫秒（`deckClock.ts:50-80`）。这让对齐**不需要 `AudioBufferSourceNode`、不需要整曲解码**。

---

### 6. 降级路径：stems 不可用时退化成什么

**降级是分层的，不是单点 switch。**

**第 0 层 · 能力判定**——问的是**权重是否在磁盘上**，不是「是不是 Electron」：

```ts
// stems.ts:194-197
export const canSeparateStems = (): boolean =>
    typeof window !== 'undefined'
    && typeof window.electron?.separateStems === 'function'
    && modelCanRun('htdemucs');
```

（`beatThis.ts:423-426` 的 `canRunBeatThis` 同构。）`modelAvailability.ts` 整个文件就是讲「Electron」和「有 weight」是两件事（`:1-16`）。

**第 1 层 · Stems 缺失 → 主交叉淡化 + 三频段**：

```ts
// automixSession.ts:982-984
const useStems = Boolean(fromStems && toStems)
    && plan.style !== 'beatCut'
    && overlap >= AUTOMIX_MIN_OVERLAP_SEC;
```

```ts
// automixSession.ts:1109-1112
const rendering = stemmed ? ', four stems'
    : fromStems && toStems ? `${shape.shapeBands ? ', three bands' : ''}`
        : `, no stems (${!fromStems && !toStems ? 'neither end' : fromStems ? 'the incoming end' : 'the outgoing end'}`
            + ` is not separated yet)${shape.shapeBands ? ', three bands' : ''}`;
```

具体退化行为：`scheduleBandBlend` + `scheduleCrossfade`（`automixSession.ts:1170-1190`）。**没有 stems 时 `sweepOut` 仍可开**（`bassSwap` 风格），但**人声无法被单独按住**——这是唯一的实质损失。

**第 2 层 · 窗口盖不住 → 再退一步**：

```ts
// automixSession.ts:398-406
if (offset < 0 || inOffset < 0
    || offset + length > fromStems.buffers.vocals.length
    || inOffset + length > toStems.buffers.vocals.length) {
    console.log(`[Automix] stems do not cover this ${wall.toFixed(2)}s window`
        + ` (…), using the master crossfade`);
    return false;
}
```

原因是规划可以早于分离完成：「半个窗口的 stems 后接静音，远差于它所替代的交叉淡化」（`:395-396`）。

**第 3 层 · Beat This! 缺失 → 内置估算器**：`estimateTempo` / `estimateDownbeat` 原样保留作回退（README `:212-214`），「两套估计不得混用——相位只在它被测出的那个网格上有意义」。

**第 4 层 · 引擎拒绝 → 兜底硬切**（所有 `try/catch` 都写成「改善项，不是前置条件」）：

```ts
// crossfadeGraph.ts:645-649
} catch (error) {
    console.warn('[Automix] Crossfade rejected by the audio engine, cutting instead', error);
    rampGain(context, outgoing, 0, 0.05);
    rampGain(context, incoming, 1, 0.05);
    return false;
}
```

**第 5 层 · 队列变了 / 时长耗尽 → 50ms 硬切**（`automixSession.ts:946-961`，`CUT_SECONDS = 0.05`）。

**第 6 层 · 完全无证据 → 直接走 crossfade 规划器**：

```ts
// transitionStrategy.ts:126-146
if (hasEvidence(from, to, bpm)) { ... }
const plan = planCrossfade(from, to, CROSSFADE_DEFAULT_SEC, at);
return { ...plan, reason: `automix has no evidence here, ${plan.reason} instead` };
```

`hasEvidence` 三选一（`:95-104`）：任一侧的 profile / 任何来源的 bpm / 出场曲的歌词。注释（`:83-93`）说这条曾把 21.3s 的乐句过渡误降成 5s 交叉淡化。

**浏览器构建的实际表现**（README `:409-417`）：htdemucs ❌ →「每次过渡退回 `scheduleCrossfade` + 三频段接缝」；Beat This! ❌ → 退回内置估计器；其余（曲目分析、变速、软限幅、全套规划）✅。

---

## 7. 能不能搬到 LIZI

### 7.1 先钉死 LIZI 的现状（源码证据）

| 事实 | 证据 |
|---|---|
| **只有一个 `<audio>` 元素** | `public/player.js:12` `const audio = new Audio();`；全文无第二个音频元素（`index.html` 无 `<audio>` 标签） |
| **没有 `decodeAudioData` / `OfflineAudioContext` / `AudioBuffer`** | 全仓 grep `public/*.js`、`public/*.html`、`server.mjs`：**零命中** |
| 有 Web Audio，但仅实时分析 | `public/beat.js:85-113`：`new AC()` → `createAnalyser()` → `createMediaElementSource(el)` → `analyser.connect(destination)` |
| **音频 src 直连网易云 CDN，无本地代理** | `public/player.js:404` `audio.src = url;`，`url` 来自 `API.songUrl(track.id)`（`:381`）直接透传；`server.mjs` 路由只有 `/api/img`、`/api/*`（weapi 转发）、`/creative/*`、静态文件（`:505-621`），**没有 `/api/audio`** |
| 已有实时 BPM + 相位 + 下拍估计 | `beat.js`：onset 检测（`:138-209`）、`pickTempo` 自相关（`:278+`）、拍时钟（`:211-222`）、4 槽下拍投票（`:237-259`） |
| BPM 元数据可锁速 | `player.js:229-248` `applyWikiBpm` → `Beat.lockTempo(w.bpm)`；`beat.js:492-503` |
| 音量走元素属性，未接 GainNode | `player.js:495` `setVolume(v){ audio.volume = ... }` |

### 7.2 三条硬结论

**结论 A：LIZI 现在拿不到音频 ArrayBuffer——但这是可修的，且比想象中便宜。**

我实测了网易云 CDN 的响应头（用 LIZI 自己的 `/api/song/url` 拿真实地址）：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: DNT,...,Range
Access-Control-Expose-Headers: *
Content-Type: audio/mpeg
Content-Length: 5214920        （≈5.2MB / 128kbps）
```

并且 Range 请求真的返回 206：

```
STATUS 206
Content-Range: bytes 0-1572863/5214920
Content-Length: 1572864
```

**这意味着两件事**：
1. **不需要补 `/api/audio` 代理**——`fetch(cdnUrl, {headers:{Range:'bytes=0-1572863'}})` 在浏览器里就能跑（`player.js:17` 已经设了 `crossOrigin='anonymous'`）。Folia 的 `readPrefix`（`profileService.ts:230-237`）可以**原样搬**。
2. **但整曲解码的成本是真的**：`exhigh` 实测 `br=320000, size=13037236`（≈13MB / 326 秒）。`PREFIX_BYTES = 1572864` 只覆盖约 **40 秒 @320kbps**。所以「首段分析」可行（约 1.5MB），「尾段分析」**不可行**——Folia 自己在 `profileService.ts:223-225` 说明：尾部 range 没有容器头，任何解码器都不吃。

**结论 B：轻量版必须放弃「全曲 offline profile」这个前提**，因为 LIZI 的音频是流、而且拿到的不对称（有头无尾）。但 LIZI 有一件 Folia 只在兜底时才用的武器：**实时 AnalyserNode 已经在跑**（`beat.js`），Folia 的 `deckAnalyser.ts` 与它结构几乎一致（`deckAnalyser.ts:63-155`）。

**结论 C：`transitionCue.ts` 不要搬**——它是 UI 广播通道（过渡环 / 卡片边框 / Remote 快照同步），LIZI 没有这些渲染器。可以在需要时抄它的 `active` vs `announcement` 分离思路，但代码本身与过渡实现无关。

### 7.3 哪些部分只依赖实时 AnalyserNode（轻量版）

| Folia 模块 | 能否轻量化 | 依据 |
|---|---|---|
| `estimateTempo`（`signalAnalysis.ts:165`） | ✅ **已经在做** | `beat.js:278` `pickTempo` 是同一套自相关 + 谐波和 + 抛物线细化；Folia 用 4 次谐波和压制 3:2 / 4:3 误判（`:147`），LIZI 目前只有 ±1 八度先验 |
| 拍相位 / `nextBeatIn` | ✅ **已经在做** | `beat.js:211-222` 拍时钟 + `:202-207` 起音相位轻推（0.22 增益）；Folia 等价物是 `deckAnalyser.ts:147-155` |
| 实时响度（K 计权） | ✅ 可加 | `deckAnalyser.ts:81-95` 两个 biquad（`highshelf@1681.974 +4dB`、`highpass@38.135 Q=0.5003`）→ Analyser → `rmsDb`；LIZI 现在只用 `bandAvg`（`beat.js:132-136`） |
| `buildCrossfadeCurves` | ✅ **纯数学，60 行** | `signalAnalysis.ts:435-469`，零依赖，可整段抄 |
| `buildBandCurves` | ✅ **纯数学** | `signalAnalysis.ts:539-574`，只需 3 个 biquad + `setValueCurveAtTime` |
| `crossoverFor` / `trimForBalance` / `planBlendShape` | ✅ 纯数学 | `signalAnalysis.ts:320-391` |
| `quantiseToMusic` / `snapToGrid` / `barGrid` / `tempoMatch` | ✅ 纯数学 | `musicalTime.ts` 全文件，无 I/O |
| `shapeBlend` / `TOGETHER` / `chooseTransitionStyle` | ⚠️ 部分 | `transitionChooser.ts:175` 依赖 `TrackProfile` 字段（`startsHot` / `leadIn` / `outroSlope` / `tailDb` / `outroKey`），缺一半会走进 `plainBlend` 兜底 |
| `applyTempoBend` | ✅ **2 行** | `tempoBend.ts:17-28`，`preservesPitch` + `playbackRate` 是平台能力 |
| `softLimit` | ✅ 纯数学 | `crossfadeGraph.ts:355-361` + WaveShaper |
| `deckClock` | ✅ **建议抄** | `deckClock.ts` 全文件 151 行，纯最小二乘，无依赖；这是把过渡放到拍上的关键传感器 |
| `scheduleCrossfade` / `scheduleBandBlend` | ✅ 可适配 | `crossfadeGraph.ts:622` / `:213`，但需要 LIZI 先建 GainNode 链 |
| **htdemucs stems** | ❌ **不可能** | 108MB ONNX + Python 旁挂 + `enable_mem_reuse` 开关；`MODELS.md:171-174`。浏览器里无对应物 |
| **Beat This! 全曲 bar grid** | ❌ 不可能 | 83MB ONNX + `window.electron` 桥（`beatThis.ts:423`）；推理在 utilityProcess |
| **整曲 LUFS / `sections` / `leadOut` / `bodyOut`** | ❌ 需要整曲（或至少尾段）解码 | `trackProfile.ts` / `profileService.ts`；尾段 range 明确不可解码（`:223-225`） |
| **`vocalEnd`（人声结束时刻）** | ❌ 依赖 stems | `stems.ts` 的 `vocalEnd` 只在 `tail` 窗口上测 |
| **build-up / `expansionGesture`** | ❌ 依赖 stems 渲染 | README `:399-401`：浏览器构建该开关直接置灰 |

### 7.4 LIZI 轻量版最小设计（不要求分轨、不要求降 BPM）

目标：**节拍对齐 + 等功率交叉淡化 + 频段交接**。约 400–500 行，4 个新模块。

#### 前置改造（必须，约 120 行）

**① 双 deck：把 `new Audio()` 变成两个并存的音频元素。**
现在 `player.js:11-17` 是单例。需要 `deckA` / `deckB`，并保留 `audio` 作为「当前活动 deck」的别名，否则 `player.js` 里 30+ 处 `audio.xxx` 全要改。最小侵入写法：让 `audio` 变成一个 getter，指向 `activeDeck.el`。

**② GainNode 链（每个 deck 一条）。** 直接抄 `crossfadeGraph.ts:100-151` 的结构，但精简掉 stem/throw：

```
MediaElementSource → replayGain → trim → low(lowshelf 250) → mid(peaking 1k Q0.8)
                    → high(highshelf 4k) → fade → mixNode → destination
```

**关键陷阱**：`createMediaElementSource` 对同一个元素**只能调一次**（`beat.js:20` 注释已经踩过）。所以 `beat.js` 的 `attach()` 必须改成接在 `fade` 之后（分析器要读「这首曲子本身」还是「混合后」取决于用途——Folia 明确选择读在 fade **之前**，`crossfadeGraph.ts:139-148`，否则配平会追自己的输出）。两路 deck 接进同一个 `mixNode`，`beat.js` 的分析器接在 `mixNode` 之后只能分析「混合结果」，做不了单曲响度配平——**这是 LIZI 必须接受的取舍**：要么给每个 deck 各建一个分析器（推荐，抄 `deckAnalyser.ts`），要么放弃配平。

**③ 播放位置传感器（强烈建议）。** 抄 `deckClock.ts` 全文件。LIZI 现在用 `audio.currentTime` 直接读（`player.js:437`），精度是阶梯；要「把过渡放到拍上」需要亚毫秒相位。这个文件零依赖，直接可用。

#### 轻量版核心（3 个模块）

**模块 1 · `transitionPlan.js`（约 120 行）——纯函数决策**

输入只需要 LIZI 现在就有 + 实时能测的：`{ duration, currentTime, bpm, nextBeatIn, outgoingDb }`（出场曲）与 `{ duration, bpm, leadIn }`（进场曲，`leadIn` 可先用 0）。

```js
// 直接搬 signalAnalysis.ts:320-391 + musicalTime.ts:188-210
const crossover = crossoverFor(outgoingDb);                    // 0.35..0.55
const overlap   = quantiseToMusic(wanted, beatSec, ceiling);   // 乐句/小节/拍取整
const shape     = planBlendShape({ overlap, outgoingDb, nextBeatIn, periodSec, ... });
const style     = 'bassSwap';                                  // 轻量版固定这一种
const together  = 0.55;                                        // TOGETHER.bassSwap
```

长度公式（`transitionChooser.ts:205-206`）：

```js
lengthScale = clamp(0.25, 1 * 1 * TEMPO_LENGTH_SCALE[relation] * energyScale);
// 轻量版 relation 用 tempoMatch(出场bpm, 进场bpm)，energyScale 默认 1（无 headDb/tailDb）
overlap = min(16拍 × beatSec, ceiling) × lengthScale;   // ceiling 建议 8~12s
```

`ceiling` 三项取 min：`AUTOMIX_MAX_OVERLAP_SEC`（Folia 25，轻量版建议 8–12）、`duration/4`、以及**距歌尾的剩余时间**。

**模块 2 · `transitionGraph.js`（约 180 行）——Web Audio 调度**

- 两路 `fade` gain 用 `setValueCurveAtTime(curves.out/in, startAt, seconds)`，曲线来自 `buildCrossfadeCurves(crossover, together)`。
- 三路 tone filter 用 `setValueCurveAtTime`，曲线来自 `buildBandCurves({crossover, swapBass:true, sweepOut:true, tiltDb:[0,0]})`。
- **务必守 Folia 的两条不变量**（README `:520-530`）：
  - 改跑着的曲线用 `cancelAndHoldAtTime`，不要 `cancelScheduledValues`；
  - 曲线起点已过去时，锚点用 `Math.max(startAt, ctx.currentTime)`，复位事件再往后让 `CURVE_TAIL_GUARD_SEC`，否则复位事件会落进运行中曲线内部并被整体拒绝。
- 软限幅：`mixNode` 后接 `WaveShaper`，曲线用 `softLimit` 采样 8192 点，前置 `1/LIMIT_RANGE`。

**模块 3 · `transitionSession.js`（约 150 行）——状态机**

照抄 Folia 的 `idle → armed → fading`，但简化：

```
armed:   提前 1s（AUTOMIX_ARM_LEAD_SEC）把进场 deck 载好、fade=0、seek 到 inStart
         ★ 关键：只压 play()，允许缓冲 —— 「装好下一首」和「开始淡入淡出」是两件事
fading:  进场 deck 的 'playing' 事件 → 二次闸门 resolveOverlap(plan, remaining)
         → 若 overlap < 0.8s 则退化为 50ms 硬切（CUT_SECONDS）
settle:  唯一出口，两路 fade/trim/tone 全复位到 unity
```

**beat 对齐靠 `nextBeatIn`**：LIZI 的 `beat.js:211-222` 已经有 `nextBeatAt`，露出来即可；把它接到 `planBlendShape` 的 `nextBeatIn`，crossover 就会落在拍上。

**频段交接用 `bassSwap`**：`buildBandCurves` 的 `swapBass: true` 会让低频在 crossover 前后 12% 的窗口内换手（`−24dB` 斜坡），这正是「同一时刻只有一个低端」。

#### 需要 LIZI 补的能力清单

| # | 要补什么 | 为什么 | 成本 |
|---|---|---|---|
| 1 | **双 `<audio>` deck** | 交叉淡化需要两路同时出声 | 中（`player.js` 单例改双例，30+ 处引用） |
| 2 | **每 deck 一条 GainNode 链** | `setValueCurveAtTime` 的载体 | 中（抄 `crossfadeGraph.ts:100-151`） |
| 3 | **Analyser 移到每 deck（fade 之前）** | 配平要用「曲子本身」的响度，不是混合后的 | 低（抄 `deckAnalyser.ts`） |
| 4 | **`nextBeatIn` 从 `beat.js` 导出** | 拍对齐的唯一输入 | 低（`nextBeatAt` 已在，加一行 getter） |
| 5 | **`deckClock`（可选但建议）** | 把过渡放到拍上而非拍附近 | 低（`deckClock.ts` 151 行零依赖） |
| 6 | **队列提前推进** | armed 阶段就要载入下一首 | 中（`player.js:453` `next()` 需要不影响 UI 的预载路径） |
| 7 | **`bpm` 双曲同时可得** | `tempoMatch` 需要两首的 BPM | 低（`player.js:229` 已有 `applyWikiBpm`，进场曲提前调一次即可） |
| 8 | ~~音频 ArrayBuffer~~ | 轻量版**不需要** | — |

**注意第 7 项**：LIZI 的 `Beat` 是单例，`lockTempo` 会覆盖当前曲目的 BPM。轻量版要么把 `Beat` 实例化两份，要么把「进场曲 BPM」单独存一个变量（从 `API.songWiki` 提前拉，`player.js:237`）。**不要**让进场曲的 `lockTempo` 污染正在播的那首。

### 7.5 风险

| 风险 | 严重度 | 说明与缓解 |
|---|---|---|
| **`createMediaElementSource` 只能调一次** | 高 | `beat.js:20` 已记录此坑。若 deck 元素被复用于多首歌，source 节点可复用（元素不变即可）；**不要**在换歌时重建元素。 |
| **CORS 依赖 CDN 行为** | 中 | 实测当前 CDN 返回 `ACAO: *` 且 Range 可用；但这是网易云的单方面行为，可能变。`beat.js:20-23` 已注明「跨域音频必须带 CORS 才能被分析」。**缓解**：`fetch` 失败时静默降级（Folia 全程这个模式，`profileService.ts:232-235`）。 |
| **无 stems → 人声会叠** | 中 | 这是 Folia 存在 stems 的**唯一理由**（`stems.ts:19-21`）。轻量版只能靠 `together` 平台段 + 低频换手减轻糊感，无法真正「按住人声」。**必须向用户说明这是轻量版**。 |
| **单曲 BPM 元数据缺失** | 中 | `applyWikiBpm` 匿名可用、实测 9/9（`player.js:206`），但非保证。缺了就退到实时检测，而实时检测有倍速歧义（`beat.js:265-266` 注释、`:492-500` 的 `scaleTempo` 手动校正）。**缓解**：`tempoMatch` 的 `foldRatio`（`musicalTime.ts:94-99`）已处理 2× / 0.5×。 |
| **进场曲 `leadIn` 未知** | 低 | Folia 用它决定「砍还是短叠」（`transitionChooser.ts:226`）。轻量版设 0 即固定走 `bassSwap`，行为可预测。 |
| **两个规划器语义漂移** | 低 | Folia 用 `TransitionPlan` 单一契约（`transitionPlanner.ts:57`）隔离。**抄这个契约**，别让 UI 直接读内部字段。 |
| **`beat.js` 的相位在换歌时归零** | 低 | `player.js:401` `Beat.reset()` 会清空 `nextBeatAt`。进场 deck 需要自己的相位估计，不能用活动 deck 的。 |
| **长度无乐句证据** | 低 | 没有 `sections`，只能按拍/小节取整（`quantiseToMusic` 三级降档已在），不会落在乐句上。听感上「长度对但不换气」。 |

---

## 参考文件清单

### Folia（`E:\DSHdesktop\work\folia-major`）

**文档（先读，价值最高）**
- `src/services/automix/README.md` — 571 行，四层架构、§3 完整流程图、§6 关键技术、§9 不变量
- `src/services/automix/MODELS.md` — 229 行，两个模型的来历/体积/四层手术/内存数字

**证据层**
- `src/services/automix/trackProfile.ts` — 离线分析主体（`PROFILE_SAMPLE_RATE = 22050` @:35，`TrackProfile` @:132）
- `src/services/automix/signalAnalysis.ts` — 846 行，全部数学：`estimateTempo` @:165、`crossoverFor` @:320、`trimForBalance` @:338、`planBlendShape` @:371、`buildCrossfadeCurves` @:435、`buildBandCurves` @:539、`toneTilt` @:584、`kWeight` @:626、`estimateDownbeat` @:822
- `src/services/automix/profileService.ts` — `decodeAtProfileRate` @:178、`PREFIX_BYTES` @:213、`readPrefix` @:230、`ensureTrackProfile` @:369
- `src/services/automix/beatThis.ts` — 前处理契约（22050/1024/441/128mel/30–11000Hz @:20-30）、`canRunBeatThis` @:423、`analyseBeatGrid` @:444
- `src/services/automix/stems.ts` — `STEM_NAMES` @:35、`STEM_WINDOW_SEC` @:61、`canSeparateStems` @:194、`transitionCapabilities` @:734
- `src/services/automix/stemGesture.ts` — `planVocalExit` @:260、`planStemHandover` @:521、`rise`/`fall` @:679/694、`SWAP_EDGE_SEC` @:714、`outgoingCurves` @:717、`incomingCurves` @:731、`OTHER_SWEEP_HZ` @:745
- `src/services/automix/expansionGesture.ts` — build-up（本次未深读，`chooseExpansionIntensity` 被 `transitionStrategy.ts:134` 调用）
- `src/services/automix/deckAnalyser.ts` — 175 行，实时 tap + K 计权 biquad @:81-95 + `nextBeatIn` @:147
- `src/services/automix/deckClock.ts` — 151 行，`fitClock` @:50、`createDeckClock` @:108
- `src/services/automix/modelAvailability.ts` — 「Electron ≠ 有 weights」@:1-16

**决策层**
- `src/services/automix/musicalTime.ts` — `BEATS_PER_PHRASE` @:11、`tempoMatch` @:101、`settledBpm` @:137、`TEMPO_LENGTH_SCALE` @:169、`quantiseToMusic` @:188、`barGrid` @:220、`snapToGrid` @:238、`alignEntry` @:261
- `src/services/automix/transitionChooser.ts` — `TransitionStyle` @:20、`keyRelation` @:122、`chooseTransitionStyle` @:175、`TOGETHER` @:307、`shapeBlend` @:320
- `src/services/automix/transitionPlanner.ts` — `AUTOMIX_MAX_OVERLAP_SEC` @:117、`AUTOMIX_DEFAULT_OVERLAP_BEATS` @:146、`endsOf` @:200、`entryGrid` @:247、`planTransition` @:320、`resolveOverlap` @:748
- `src/services/automix/crossfadePlanner.ts` — 99 行，`planCrossfade` @:56
- `src/services/automix/transitionStrategy.ts` — `planForMode` @:116、`hasEvidence` @:95、`canAnalyseTracks` @:73

**执行层**
- `src/services/automix/automixSession.ts` — 1302 行：`AUTOMIX_ARM_LEAD_SEC` @:86、`sampleDecks` @:218、`waitToGrid` @:232、`seekTo` @:247、`startBalanceCorrection` @:279、`scheduleStemGesture` @:357、`settle` @:686、`requestTransition` @:751、`handleActiveDeckPlaying` @:864
- `src/services/automix/crossfadeGraph.ts` — 651 行：`connectAutomixDeck` @:100、`scheduleBandBlend` @:213、`scheduleEchoThrow` @:277、`softLimit` @:355、`connectStemBus` @:381、`connectStemDeck` @:427、`scheduleStemWindow` @:538、`scheduleCrossfade` @:622
- `src/services/automix/tempoBend.ts` — 33 行全部
- `src/services/automix/transitionCue.ts` — 135 行（⚠️ **UI 广播通道，与过渡点选择无关**）

**绑定层**
- `src/services/automix/useAutomixDecks.ts` — `ANALYSER_INTERVAL_MS = 25` @:72、`connectDecks` @:496、`checkTransitionPoint` @:530、25ms 定时器 @:672-686

### LIZI（`E:\DSHdesktop\work\music-player`）

- `public\player.js` — `new Audio()` @:12、`crossOrigin` @:17、`applyWikiBpm` @:229、`audio.src = url` @:404、`next()` @:453、`setVolume` @:495
- `public\beat.js` — 539 行：`createMediaElementSource` 只能一次 @:20、音频图 @:81-121、onset @:138-209、拍时钟 @:211-222、下拍投票 @:237-259、`pickTempo` @:278、`lockTempo` @:492、API @:531-538
- `public\app.js` — `Beat.on('frame'/'beat')` @:837-838、`Beat.scaleTempo` @:855
- `public\index.html` — script 顺序 @:510-514（`beat.js` 在 `player.js` 之前）
- `server.mjs` — 路由表 @:501-621（`/api/img` @:505、`/api/*` @:521、无音频代理）
- `public\api.js` — `songUrl` @:42、`img` 代理 @:28

### 实测数据（本次调研新取得）

- 网易云 CDN 响应头：`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: ...,Range`、`Content-Type: audio/mpeg`、`Content-Length: 5214920`
- Range 请求：`STATUS 206`、`Content-Range: bytes 0-1572863/5214920`
- `exhigh` 音质：`br=320000`、`size=13037236`（≈13MB / 326s）
- LIZI 本地服务：`http://127.0.0.1:5456`（`.port`），`/api/session` → `{"loggedIn":false}`

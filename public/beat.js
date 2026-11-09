/**
 * 节拍检测器（Beat Detector）
 *
 * 参考 folia 那类"全屏歌词播放器"的思路做的实时音频分析：
 * 把音频接进 Web Audio 图，逐帧算频谱，靠起音（onset）+ 自相关估出 BPM，
 * 再把节拍相位喂给界面做跟拍效果。
 *
 * 三段式：
 *   1) 起音检测 —— 频谱通量（spectral flux）：把相邻两帧频谱的正向差值累加。
 *      鼓点、拨弦这类瞬态会让通量突然抬高，用「局部均值 + 标准差」做自适应阈值，
 *      再要求是局部极大值且距上次起音够远，避免一声音被拆成好几个 onset。
 *   2) 速度估计 —— 对起音强度包络做自相关，在 60~200 BPM 对应的延迟里找峰。
 *      乘一个以 120 BPM 为中心的对数先验，压制"半速/倍速"误判。
 *   3) 拍相位 —— 按 BPM 推进节拍时钟；每次检测到起音就朝最近的预测拍轻推一下相位，
 *      这样即使 BPM 有零头也能慢慢对齐，而不是越跑越偏。
 *
 * 下拍（小节第 1 拍）是估的，不是听出来的：把每拍强度按 4 个槽位累加，
 * 取平均最强的槽当第 1 拍。简单但有效，界面上会标明这是估计值。
 *
 * 注意：createMediaElementSource 对同一个 <audio> 只能调一次，
 * 而且跨域音频必须带 CORS 才能被分析（否则分析器拿到的全是 0）。
 * 网易云 CDN 返回 Access-Control-Allow-Origin: *，所以只要在设 src 之前
 * 把 audio.crossOrigin = 'anonymous' 设上就能用。
 */
const Beat = (() => {
  const FFT = 2048;
  /* 起音包络的环形缓冲长度。这个值直接决定 BPM 的分辨率：
     窗口越长，自相关在延迟轴上的峰越尖，抛物线插值才插得准。
     256 帧（约 4.3 秒）只有 8 个拍，峰很钝，实测同一个 120 BPM 素材
     会在延迟 30 和 31 之间来回跳（差 4 BPM）；
     512 帧（约 8.6 秒）后峰明显变尖，稳定落在正确延迟上。
     代价：每 0.9 秒做一次 60×512 的乘加，可忽略。 */
  const HISTORY = 512;
  const MIN_BPM = 60, MAX_BPM = 200;
  const MIN_ONSET_GAP = 0.12;       // 秒，两次起音的最小间隔（对应最快 500 BPM 的瞬态）

  let audio = null;                 // 当前活动元素（节拍时钟读它的 currentTime）
  let ctx = null, analyser = null;
  /* 双 deck 之后不再有"唯一的 srcNode"：每个 <audio> 各自一个 MediaElementSource
     （同一个元素只能调一次），先进各自的 Gain，再汇到 busIn。
     EQ 钩子拿到的 src 是 busIn，所以换 deck 不需要重新接线。 */
  let busIn = null;
  const deckNodes = new WeakMap();  // <audio> → { src, gain }
  let graphSent = false;
  let freq = null, timeArr = null;
  let prevSpec = null;
  let failed = false;               // Web Audio 不可用时降级成"无节拍"，不影响播放

  const env = new Float32Array(HISTORY);   // 环形：起音强度
  let envIdx = 0, envFilled = 0;

  let frameDt = 1 / 60;             // 帧间隔（秒）的指数平均，仅作兜底
  let lastTs = 0;
  let lastOnsetAt = -1;

  /* 包络的采样率不能只靠 rAF 的帧间隔去估：rAF 会掉帧，而且掉帧时我们并没有
     补采样，用"平均帧间隔"换算出的 fs 会偏，BPM 就系统性偏掉几个点
     （实测 120 BPM 会测成 117）。
     改用**音频时钟**当基准：节拍本来就是在 audio.currentTime 上排的，
     用「已推入的样本数 ÷ 对应的音频时间跨度」算 fs，和节拍时钟同源，误差自然消掉。 */
  let pushCount = 0;
  let firstAudioAt = null;

  const state = {
    bpm: 0, confidence: 0,
    level: 0,                       // 综合能量 0~1（驱动封面脉动）
    bass: 0, mid: 0, treble: 0,
    beatInBar: -1, bar: 0, playing: false,
    // 'metadata' = 网易云百科给的权威值 / 'detected' = 实时检测 / 'manual' = 用户校正
    tempoSource: 'detected',
  };

  // 节拍时钟
  let nextBeatAt = 0;               // audio.currentTime 上的下一个预测拍
  let beatStrength = 0;             // 当前这拍的强度（用于判定下拍）
  const slotSum = [0, 0, 0, 0];     // 4 个槽位的累计强度
  const slotCount = [0, 0, 0, 0];
  let downbeatSlot = 0;

  const listeners = {};
  const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
  const emit = (evt, data) => (listeners[evt] || []).forEach((f) => f(data));

  /* ------------------------------------------------------------------ *
   * 图钩子：把建好的 Web Audio 图交出去
   *
   * createMediaElementSource 对同一个 <audio> **只能调一次**，所以音效（EQ）
   * 不能自己新建 source，只能改这张图里的接线。这里在 src → analyser 连好之后
   * 把 { ctx, src, analyser } 交给订阅者，由它决定插什么进去。
   * 要点：**analyser 必须继续收到信号** —— BPM 检测和播放页的形态可视化都靠它，
   * 所以 EQ 的链条末端要接回 analyser，而不是 destination。
   * 已经建过图的话（EQ 晚于播放器初始化）onGraph 会立刻回调一次。
   * ------------------------------------------------------------------ */
  const graphHooks = [];
  function onGraph(cb) {
    if (typeof cb !== 'function') return;
    if (ctx && busIn && analyser) {
      try { cb({ ctx, src: busIn, analyser }); } catch (e) { console.warn('[beat] graph hook', e); }
      return;
    }
    graphHooks.push(cb);
  }
  function fireGraph() {
    if (!ctx || !busIn || !analyser) return;
    for (const cb of graphHooks.splice(0)) {
      try { cb({ ctx, src: busIn, analyser }); } catch (e) { console.warn('[beat] graph hook', e); }
    }
  }

  /* ------------------------------------------------------------------ *
   * 音频图
   * ------------------------------------------------------------------ */
  function attach(el) {
    if (!el || failed) return false;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('AudioContext 不可用');
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = FFT;
        analyser.smoothingTimeConstant = 0.55;
        /* 所有 deck 先汇到 busIn，再由 EQ 决定 busIn → analyser 还是
           busIn → 滤波器链 → analyser。analyser 永远在末端，
           节拍检测和形态可视化拿到的始终是真正在响的混合信号。 */
        busIn = ctx.createGain();
        busIn.connect(analyser);        // EQ 不在时的默认直通
        /* 测试模式：window.__BEAT_SILENT = true 时插一个 gain=0 再接到输出。
         *
         * 为什么不能直接不接 destination：Web Audio 只处理"最终能到达 destination"的节点，
         * 断开之后整张图不再被拉动，分析器读出来全是 0，检测直接失效。
         * 为什么要这个开关：自动化测试要在用户机器上跑，不能真的出声。
         * 试过 Chrome 的 --mute-audio，它会静音输出流，但也让分析器间歇性读到全 0
         * （BPM 能测出来、频谱检查却报"全是 0"），不可靠。
         * 用 gain=0 是图内静音：链路照常渲染，分析器拿到真实数据，扬声器一声不响。 */
        const silent = typeof window !== 'undefined' && window.__BEAT_SILENT;
        if (silent) {
          const mute = ctx.createGain();
          mute.gain.value = 0;
          analyser.connect(mute);
          mute.connect(ctx.destination);
        } else {
          analyser.connect(ctx.destination);
        }
        freq = new Uint8Array(analyser.frequencyBinCount);
        timeArr = new Uint8Array(analyser.fftSize);
        prevSpec = new Float32Array(analyser.frequencyBinCount);
      }

      /* 每个元素只建一次 source。第二条 deck 也走同一张图，
         这样过渡期间两首歌都会被 EQ 处理、也都会进 analyser。 */
      if (!deckNodes.has(el)) {
        const src = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        gain.gain.value = 1;
        src.connect(gain);
        gain.connect(busIn);
        deckNodes.set(el, { src, gain });
      }
      if (!audio) audio = el;           // 第一条 attach 的元素默认当节拍时钟
      if (!graphSent) { graphSent = true; fireGraph(); }   // 让音效模块接管 busIn → … → analyser
      return true;
    } catch (e) {
      // 拿不到分析能力也要能正常放歌
      failed = true;
      console.warn('[beat] Web Audio 不可用，节拍检测已关闭：', e.message);
      return false;
    }
  }

  /** 某条 deck 的音量增益（交叉淡化在这里做，样本级精确，不是定时器调 volume）。
   *  还没 attach 过（或 Web Audio 不可用）时返回 null。 */
  function deckGain(el) {
    const d = el && deckNodes.get(el);
    return d ? d.gain : null;
  }

  /** 切换"当前活动元素"：节拍时钟、BPM 相位都读它。
   *  图形不需要重接 —— 两条 deck 都一直挂在 busIn 上。 */
  function setClock(el) {
    if (el) audio = el;
  }

  /** 浏览器要求音频上下文在用户手势后才能跑起来 */
  async function resume() {
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* 忽略 */ } }
  }

  /* ------------------------------------------------------------------ *
   * 每帧分析
   * ------------------------------------------------------------------ */
  const bandAvg = (from, to) => {
    let s = 0;
    for (let i = from; i < to; i++) s += freq[i];
    return s / ((to - from) * 255);
  };

  function analyse(ts) {
    if (!analyser) return;
    const now = audio ? audio.currentTime : 0;

    // 帧间隔的指数平均（rAF 并不稳定，自相关要用真实的采样率）
    if (lastTs) {
      const dt = Math.min(0.1, (ts - lastTs) / 1000);
      if (dt > 0) frameDt = frameDt * 0.9 + dt * 0.1;
    }
    lastTs = ts;

    analyser.getByteFrequencyData(freq);

    // --- 1) 频谱通量 ---
    let flux = 0;
    for (let i = 0; i < freq.length; i++) {
      const v = freq[i] / 255;
      const d = v - prevSpec[i];
      if (d > 0) flux += d;                 // 只算上升沿：能量衰减不算起音
      prevSpec[i] = v;
    }
    flux /= freq.length;

    env[envIdx] = flux;
    envIdx = (envIdx + 1) % HISTORY;
    if (envFilled < HISTORY) envFilled++;
    pushCount++;
    if (firstAudioAt === null) firstAudioAt = now;

    // --- 频段能量（低音用来驱动脉动，最跟手）---
    const bins = freq.length;
    const bass = bandAvg(1, Math.max(2, Math.round(bins * 0.02)));      // ~0.2kHz 以下
    const mid = bandAvg(Math.round(bins * 0.02), Math.round(bins * 0.15));
    const treble = bandAvg(Math.round(bins * 0.15), Math.round(bins * 0.5));

    // 快攻慢放：鼓点瞬间抬起来，然后缓慢回落，视觉上才像"心跳"
    const target = Math.min(1, bass * 1.6);
    state.level = target > state.level ? target : state.level * 0.88;
    state.bass = bass; state.mid = mid; state.treble = treble;

    // --- 2) 自适应阈值起音检测 ---
    // 阈值窗口取 ~1.5 秒：太短的话窗口里就剩鼓点自己，均值和标准差都被峰值抬高，
    // 阈值跟着水涨船高，反而把一半的拍子漏掉（实测 0.5s 一个 kick 只认出一半）。
    const local = Math.min(envFilled, Math.round(1.5 / frameDt));
    let mean = 0;
    for (let i = 1; i <= local; i++) mean += env[(envIdx - i + HISTORY * 2) % HISTORY];
    mean /= Math.max(1, local);

    let varsum = 0;
    for (let i = 1; i <= local; i++) {
      const d = env[(envIdx - i + HISTORY * 2) % HISTORY] - mean;
      varsum += d * d;
    }
    const std = Math.sqrt(varsum / Math.max(1, local));
    const threshold = mean + std * 1.15 + 1e-5;

    const prev1 = env[(envIdx - 2 + HISTORY * 2) % HISTORY];
    const prev2 = env[(envIdx - 3 + HISTORY * 2) % HISTORY];
    const cur = flux;
    const isLocalMax = cur > prev1 && prev1 >= prev2;
    const isOnset = cur > threshold && isLocalMax && (now - lastOnsetAt) > MIN_ONSET_GAP;

    if (isOnset) {
      lastOnsetAt = now;
      // 相位校正：朝最近的预测拍轻推（不直接跳，避免被错拍带跑）
      const period = state.bpm > 0 ? 60 / state.bpm : 0.5;
      const err = now - nextBeatAt;
      if (Math.abs(err) < period * 0.28) {
        nextBeatAt += err * 0.22;
      }
      emit('onset', cur);
    }

    // --- 3) 节拍时钟 ---
    if (state.bpm > 0) {
      const period = 60 / state.bpm;
      if (nextBeatAt === 0) nextBeatAt = now;
      // while 而不是 if：标签页切回来时 currentTime 可能一下跳很多
      let guard = 0;
      while (now >= nextBeatAt && guard++ < 8) {
        onBeat(nextBeatAt);
        nextBeatAt += period;
        if (nextBeatAt < now - period * 2) nextBeatAt = now + period;
      }
    }

    // --- 速度估计：每 ~0.9 秒算一次就够，别每帧都跑自相关 ---
    // 被元数据锁速时直接跳过：BPM 已经是权威值，没必要再算（也省 CPU）。
    // 注意只是不估速度，起音检测和相位校正照常跑 —— 跟拍要用相位。
    if (!tempoLocked && envFilled > 64 && ts - lastTempoTs > 900) {
      lastTempoTs = ts;
      estimateTempo();
    }

    emit('frame', state);
  }

  let lastTempoTs = 0;

  function onBeat(at) {
    state.beatInBar = (state.beatInBar + 1) % 4;
    if (state.beatInBar === 0) state.bar++;

    // 记录这一拍的强度，用来估下拍
    slotSum[state.beatInBar] += beatStrength;
    slotCount[state.beatInBar]++;

    // 每 4 小节重估一次"第 1 拍"落在哪个槽
    if (state.bar > 0 && state.bar % 4 === 0 && state.beatInBar === 3) {
      let best = 0, bestAvg = -1;
      for (let i = 0; i < 4; i++) {
        const avg = slotCount[i] ? slotSum[i] / slotCount[i] : 0;
        if (avg > bestAvg) { bestAvg = avg; best = i; }
      }
      downbeatSlot = best;
      for (let i = 0; i < 4; i++) { slotSum[i] = 0; slotCount[i] = 0; }
      state.downbeat = true;
    }

    beatStrength = state.level;
    emit('beat', { at, index: state.beatInBar, offset: (state.beatInBar - downbeatSlot + 4) % 4, level: state.level });
  }

  const tempoHist = [];
  // 用户手动校正的倍率。自动估计继续跑（速度可能本来就在飘），
  // 只是在结果上乘这个系数，这样手动校正不会被下一轮估计冲掉。
  let octaveScale = 1;
  let baseBpm = 0;                  // 未经倍率校正的平滑速度
  let tempoLocked = false;          // 被元数据锁速后，检测不再改 BPM（相位照旧）

  /**
   * 纯函数：从一段起音强度包络里挑出速度。
   * 抽出来是为了能脱离浏览器单独做单测（node tempo-unit.mjs）——
   * 之前靠"改参数→跑浏览器→看数字"调参，结果在 ±1 和 ±17 BPM 之间来回摆，
   * 根本分不清是算法问题还是浏览器计时问题。定死输入才测得准。
   *
   * @param {Float32Array} envRaw 起音强度（已去均值前的原始值）
   * @param {number} fs 该包络的采样率（Hz）
   * @returns {{bpm:number, conf:number, debug:object}|null}
   */
  function pickTempo(envRaw, fs) {
    const n = envRaw.length;
    if (n < 64 || !(fs > 0)) return null;

    const buf = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += envRaw[i];
    mean /= n;
    for (let i = 0; i < n; i++) buf[i] = envRaw[i] - mean;

    const minLag = Math.max(2, Math.floor(fs * 60 / MAX_BPM));
    const maxLag = Math.min(n - 8, Math.ceil(fs * 60 / MIN_BPM));
    if (maxLag <= minLag) return null;

    const acMax = Math.min(Math.floor(n / 2), maxLag * 3);
    if (acMax <= minLag) return null;

    /* 自相关的分数延迟用**三次插值**取，而且插值对象是"自相关曲线"而不是原始信号。
     *
     * 这里绕了一圈弯路，记下来免得重蹈：
     * 起因是真实速度的周期往往不是整数帧（160 BPM 在 60Hz 包络上周期正好 22.5 帧），
     * 于是 ac[22] 和 ac[23] 各分到半个峰，而 ac[45] 踩在整数格点上拿到完整的峰，
     * 报出来就减半。第一版解法是"对信号做分数位移再算自相关"，
     * 结果更糟：对信号做线性插值相当于一个低通，半个采样的位移把高频削掉一大截，
     * 实测 ac(22.5)=0.0277 反而**低于** ac(45)=0.0339 —— 证据本身被插值带偏了。
     *
     * 自相关曲线本身是平滑的，对它插值不会引入这种随延迟变化的衰减，
     * 而且只需算一遍整数延迟的自相关（O(n·L)），比逐候选点重算快得多。 */
    const acI = new Float32Array(acMax + 2);
    for (let lag = 1; lag <= acMax + 1 && lag < n; lag++) {
      let acc = 0;
      for (let i = lag; i < n; i++) acc += buf[i] * buf[i - lag];
      acI[lag] = acc / n;
    }
    const acAt = (lagF) => {
      if (!(lagF >= 1)) return 0;
      const i = Math.floor(lagF), f = lagF - i;
      const p0 = acI[Math.max(0, i - 1)];
      const p1 = acI[i];
      const p2 = acI[Math.min(acMax + 1, i + 1)];
      const p3 = acI[Math.min(acMax + 1, i + 2)];
      // Catmull-Rom
      return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
    };

    const scores = [];
    let sum = 0;
    const STEP = 0.25;
    for (let lagF = minLag; lagF <= maxLag; lagF += STEP) {
      // 谐波求和：真实节拍周期在 2×/3× 延迟上也该有能量
      let score = acAt(lagF) + 0.6 * acAt(lagF * 2) + 0.4 * acAt(lagF * 3);
      const bpm = 60 * fs / lagF;
      /* 对数先验只当**平局裁决**，不能盖过证据本身。
       *
       * 基频和倍频的得分差只来自自相关的窗口衰减，量级是 (n-P)/(n-2P)，
       * 512 帧、周期 22.5 时只有 4.8%。而 prior 用 σ=0.8、整强度施加时，
       * 180BPM 罚 0.77、90BPM 罚 0.87，差 14% —— 直接压过证据，
       * 干净的 180 BPM 会被硬判成 90。这就是半速错误的真正来源。
       * 强度降到 0.25 后先验差约 3.4%，稳定低于那 4.8%，判断权回到证据手里。
       * （试过 0.5：160 BPM 仍会掉到 80，因为 0.5 时先验差 6.1% > 4.8%。） */
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.8, 2));
      score *= 1 + 0.25 * (prior - 1);
      scores.push({ lagF, score });
      sum += score;
    }
    if (!scores.length) return null;
    const avg = sum / scores.length;

    let best = scores[0];
    for (const s of scores) if (s.score > best.score) best = s;
    // 判据用 best.score > 0：去均值后自相关有负值，用平均值当门槛会让检测器开头几秒直接罢工
    if (!(best.score > 0)) return null;

    const bpm = 60 * fs / best.lagF;
    if (bpm < MIN_BPM || bpm > MAX_BPM) return null;

    // 置信度可能算出 NaN（个别采样率下满分/平均分同时异常），
    // 直接漏到界面上会让置信条莫名其妙地空掉，这里兜一下
    const rawConf = best.score / Math.max(1e-9, Math.abs(avg)) - 1;
    const conf = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf / 4)) : 0;
    const peaks = [...scores].sort((a, b) => b.score - a.score).slice(0, 5)
      .map((p) => ({ lag: +p.lagF.toFixed(2), bpm: +(60 * fs / p.lagF).toFixed(1), score: +p.score.toFixed(6) }));

    return {
      bpm, conf,
      debug: { fs, n, minLag, maxLag, acMax, bestLag: +best.lagF.toFixed(2), refinedLag: best.lagF, bestScore: best.score, avg, peaks },
    };
  }

  /** 自相关求 BPM：取一段包络交给 pickTempo，再做时间上的平滑 */
  function estimateTempo() {
    const n = envFilled;
    if (n < 64) return;

    // 把环形缓冲摊平成时间序
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = env[(envIdx - n + i + HISTORY * 2) % HISTORY];

    // fs 用音频时钟算（见文件上方注释）。
    const span = firstAudioAt === null ? 0 : (audio.currentTime - firstAudioAt);
    const fs = (span > 1 && pushCount > 2) ? (pushCount - 1) / span : 1 / frameDt;

    // 采样率太低就没有分辨率可言，宁可不出数字也别给个错的
    if (fs < 24) { state.lowRate = true; return; }
    state.lowRate = false;

    const r = pickTempo(raw, fs);
    if (!r) return;
    const { bpm, conf } = r;

    tempoHist.push(bpm);
    if (tempoHist.length > 5) tempoHist.shift();

    // 中位数：倍速误判是离群值，中位数直接把它滤掉
    const sorted = [...tempoHist].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];

    if (baseBpm === 0) {
      baseBpm = median;
      nextBeatAt = 0;
    } else {
      const jump = Math.abs(median - baseBpm);
      // 差得不多就平滑跟；差很多要连续几轮都指向新值才接受，避免被一段间奏带跑
      if (jump < baseBpm * 0.06) baseBpm = baseBpm * 0.5 + median * 0.5;
      else if (tempoHist.length >= 5 && jump > baseBpm * 0.15) baseBpm = median;
    }

    state.bpm = baseBpm * octaveScale;
    state.confidence = conf;
    state.debug = r.debug;
    emit('tempo', { bpm: state.bpm, confidence: conf });
  }

  /** 取分数最高的几个延迟，用来判断是不是倍频/半频在打架 */
  function topPeaks(scores, lo, hi, k) {
    const out = [];
    for (let lag = lo; lag <= hi; lag++) out.push({ lag, s: scores[lag] });
    out.sort((a, b) => b.s - a.s);
    return out.slice(0, k).map((p) => ({ lag: p.lag, score: +p.s.toFixed(6) }));
  }

  /* ------------------------------------------------------------------ *
   * 循环
   *
   * 分析与渲染分开跑，这一点很关键：
   * 起音包络的采样率直接决定 BPM 的分辨率 —— fs=60 时相邻延迟差约 4 BPM，
   * fs=10 时相邻延迟差到 15 BPM，120 BPM 会落在两个整数延迟中间，
   * 自相关只能给出 146 或 97 这种荒唐值（实测就是这样）。
   * 而 rAF 的帧率是不可控的：无 GPU 的无头环境只有 ~10fps，慢设备/省电模式也会掉。
   * 所以分析用固定间隔的定时器（与渲染帧率解耦），rAF 只负责把结果画出来。
   * 采样率再用音频时钟实测（见上），定时器抖动也能自动补偿掉。
   * ------------------------------------------------------------------ */
  const TICK_MS = 16;               // ~60Hz，和 60fps 的 rAF 等效
  let running = false, rafId = 0, timerId = 0;

  function frame() {
    if (!running) return;
    emit('frame', state);           // 只做绘制，不做信号处理
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (failed || !analyser || running) return;
    running = true;
    state.playing = true;
    lastTs = 0;
    timerId = setInterval(analyseTick, TICK_MS);
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    state.playing = false;
    state.level = 0;
    if (rafId) cancelAnimationFrame(rafId);
    if (timerId) clearInterval(timerId);
    rafId = 0; timerId = 0;
  }

  function analyseTick() {
    if (!running) return;
    analyse(performance.now());
  }

  /** 换歌时重置节拍时钟（BPM 保留，同一首歌里通常不变） */
  function reset() {
    env.fill(0); envIdx = 0; envFilled = 0;
    pushCount = 0; firstAudioAt = null;
    tempoHist.length = 0;
    octaveScale = 1; baseBpm = 0;      // 换歌后倍率归位
    tempoLocked = false;               // 换歌后解锁，等新的元数据或重新检测
    state.tempoSource = 'detected';
    // 必须把 BPM 清零：否则新歌如果没有元数据，界面会一直挂着上一首的数字，
    // 直到实时检测收敛（几秒）——那期间显示的是错的
    state.bpm = 0;
    state.confidence = 0;
    if (prevSpec) prevSpec.fill(0);
    nextBeatAt = 0;
    lastOnsetAt = -1;
    state.beatInBar = -1;
    state.bar = 0;
    state.downbeat = true;
    for (let i = 0; i < 4; i++) { slotSum[i] = 0; slotCount[i] = 0; }
  }

  /**
   * 用外部来源锁定速度（网易云百科的 BPM）。
   *
   * 分工是这样的：**速度**用元数据 —— 它是权威值，即时可用，而且没有倍速歧义
   * （实测《自由的你》百科写 84，实时检测报 169 = 2×84，正是那个歧义）。
   * **相位**仍然靠实时检测 —— 元数据只给速度，不给"第一拍在哪"，
   * 而封面脉动、拍点跳动这些跟拍效果必须知道相位。
   * 所以锁速之后检测不关，只是不再改 BPM，继续用起音把节拍时钟对齐。
   */
  function lockTempo(bpm, source = 'metadata') {
    if (!(bpm > 0)) return;
    tempoLocked = true;
    baseBpm = bpm;
    octaveScale = 1;
    state.bpm = bpm;
    state.tempoSource = source;
    state.confidence = 1;
    nextBeatAt = 0;                 // 用新速度重新对齐相位
    emit('tempo', { bpm, confidence: 1, source });
  }

  /** 回到纯检测模式（元数据缺失时） */
  function unlockTempo() {
    if (!tempoLocked) return;
    tempoLocked = false;
    baseBpm = 0;
    tempoHist.length = 0;
    state.tempoSource = 'detected';
  }

  /**
   * 手动倍速修正。
   *
   * 元数据缺失时，"这首歌到底是 86 还是 172 BPM"在信号层面没有唯一答案 ——
   * 自相关在基频和倍频上都有峰，人耳靠和声/律动判断，算法只能猜。
   * 与其硬调参数把某一类歌调准、另一类调歪，不如把这个歧义交给用户。
   */
  function scaleTempo(factor) {
    if (!(state.bpm > 0)) return;
    const next = (baseBpm || state.bpm) * (tempoLocked ? octaveScale : 1) * factor;
    if (next < 40 || next > 300) return;
    octaveScale *= factor;
    state.bpm = (baseBpm || state.bpm) * octaveScale;
    state.tempoSource = 'manual';
    nextBeatAt = 0;                       // 让节拍时钟重新对齐
    emit('tempo', { bpm: state.bpm, confidence: state.confidence, manual: true, source: 'manual' });
  }

  return {
    attach, start, stop, reset, resume, on, scaleTempo, lockTempo, unlockTempo, onGraph,
    deckGain, setClock,
    state,
    get available() { return !failed && !!analyser; },
    get audioFailed() { return failed; },
    get context() { return ctx; },
    get spectrum() { return freq; },
    // 给单测用（node tempo-unit.mjs）：把纯计算部分暴露出去
    _pickTempo: pickTempo,
  };
})();

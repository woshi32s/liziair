/**
 * kick.js —— 专用的底鼓（KICK）检测
 *
 * 和 beat.js 并存，不替换它的起音 / BPM 检测：
 *   beat = 全频段频谱通量的宽带起音 + 自相关估速 + 拍相位
 *   kick = 只保留 ~120Hz 以下的低频，用「时域 RMS + 峰值」算能量，
 *          靠「能量阈值 + 上升沿 + 冷却」判底鼓
 *
 * 算法照搬参考实现 kickpulse_pro.html（低通 → 1024 点时域 → RMS/峰值 →
 * 阈值/上升沿/冷却 → 触发时刻中位数算 BPM），只保留检测部分，
 * UI / Canvas / Tailwind 都没有搬。
 *
 * 接线（关键，不要自己新建 AudioContext，也不要碰 <audio>）：
 * createMediaElementSource 对同一个 <audio> 只能调一次，整张图已经在 beat.js
 * 里建好了。这里用 Beat.onGraph 拿到 busIn（EQ 之前），从它并行分出一条支路：
 *
 *   busIn ─┬─→ （EQ / 主 analyser，原样不动）
 *          └─→ lowpass(120Hz, Q=1.4) → analyser(1024) → gain(0) → destination
 *
 * 两个坑：
 *   1) 末端必须有一个能到达 destination 的节点（gain=0 的静音 sink）。
 *      Web Audio 只处理「最终能到达 destination」的分支，analyser 悬空时
 *      getFloatTimeDomainData 读到的是全 0 —— beat.js 里静音测试那一段
 *      已经踩过同样的坑。
 *   2) 这条支路**不能**接回主 analyser，否则底鼓信号会叠进 beat.js 的
 *      全频段输入，把现有节拍检测污染掉。
 *
 * EQ 的 route() 会调用 busIn.disconnect() 重接整张图，那会顺手拆掉这条
 * 并行支路。eq-engine 每次重接完都会发 'graph' 事件，这里订阅它，在
 * 事件里重新接一次（先断后连，避免同一对节点出现两条连接导致信号叠加）。
 *
 * 循环：不自己开 setInterval / rAF，订阅 Beat.on('frame')（分析 tick 和
 * rAF 两处都会发，约 120Hz），回调里用 performance.now() 做 16ms 节流。
 * 暂停时 beat 不再发 frame，这里自然就停了。
 *
 * 对外接口：window.LIZI_KICK（见文件末尾 return）。
 */
const LIZI_KICK = (() => {
  /* 默认参数（和参考实现一致） */
  const DEFAULTS = {
    cutoffHz: 120,        // 低通截止频率
    threshold: 0.60,      // 触发能量阈值
    minSlope: 0.012,      // 触发所需的最小上升量
    cooldownMs: 130,      // 两次触发的最小间隔
  };

  const FFT = 1024;               // 参考实现同款
  const SMOOTHING = 0.25;
  const Q = 1.4;
  const THROTTLE_MS = 16;         // ~60Hz
  const LEVEL_DECAY = 0.88;       // 和 beat.js 的「快攻慢放」一致
  const STALE_MS = 2500;          // 超时清空触发时刻表
  const MAX_TRIGGERS = 10;        // BPM 统计窗口
  const MIN_INTERVAL = 240;       // 间隔过滤（对应最快 250 BPM）
  const MAX_INTERVAL = 1600;      // 对应最慢 37.5 BPM
  const MIN_BPM = 55, MAX_BPM = 220;

  const BeatRef = (typeof Beat !== 'undefined') ? Beat : null;

  const listeners = new Set();
  const params = { ...DEFAULTS };

  const state = {
    available: false,
    get playing() { return !!(BeatRef && BeatRef.state && BeatRef.state.playing); },
    energy: 0,
    level: 0,
    bpm: 0,
    count: 0,
    lastAt: 0,
  };

  let ctx = null, srcRef = null, lowpass = null, analyser = null, timeData = null;
  let built = false;
  let warned = false;

  const triggerTimes = [];
  let lastTriggerAt = 0;
  let prevEnergy = 0;
  let resync = true;              // 暂停恢复后第一帧只同步 prevEnergy，不判触发
  let lastTickAt = 0;

  function warnOnce(msg, err) {
    if (warned) return;
    warned = true;
    console.warn('[kick] ' + msg, err || '');
  }

  /* ------------------------------------------------------------------ *
   * 音频图：从 busIn 并行分出一条低通支路
   * ------------------------------------------------------------------ */
  function connectTap() {
    if (!ctx || !srcRef || !lowpass) return;
    /* EQ 重接时会 busIn.disconnect()，把这条支路一起拆掉；这里先 try 断开
       自己的连接（没连着会抛 InvalidAccessError），再重连，保证永远只有一条。 */
    try { srcRef.disconnect(lowpass); } catch { /* 本来就没连 */ }
    try {
      srcRef.connect(lowpass);
      state.available = true;
    } catch (e) {
      warnOnce('接线失败，KICK 检测不可用', e);
    }
  }

  function hookEq() {
    /* eq-engine.js 是顶层 `const EqEngine = (() => {...})()`，顶层 const 只进
       全局词法环境，**不会**变成 window 属性。这里必须直接引用裸标识符，
       否则订阅永远挂不上，EQ 的 route() 一 src.disconnect() 就把支路拆掉。 */
    let EQ = null;
    try {
      EQ = (typeof EqEngine !== 'undefined') ? EqEngine : (window.EqEngine || null);
    } catch { EQ = null; }
    if (!EQ || typeof EQ.on !== 'function') return;
    try { EQ.on('graph', connectTap); } catch { /* 忽略 */ }
  }

  function build(graph) {
    if (built) return;
    try {
      ctx = graph.ctx;
      srcRef = graph.src;
      if (!ctx || !srcRef) throw new Error('音频图不完整');

      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = params.cutoffHz;
      lowpass.Q.value = Q;

      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = SMOOTHING;
      timeData = new Float32Array(analyser.fftSize);

      lowpass.connect(analyser);

      /* 静音 sink：让这条支路能到达 destination，否则整条链不被渲染，
         analyser 读出来全是 0。gain=0 是图内静音，扬声器听不到。 */
      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(ctx.destination);

      built = true;

      /* 先挂 EQ 的 'graph' 订阅，再接线：万一 EQ 的 route() 在我们的
         onGraph 回调之后立刻执行，它发完事件我们还能把支路接回来。 */
      hookEq();
      connectTap();
    } catch (e) {
      warnOnce('初始化失败，KICK 检测不可用', e);
    }
  }

  function hookGraph() {
    if (!BeatRef || typeof BeatRef.onGraph !== 'function') {
      warnOnce('Beat.onGraph 不可用，KICK 检测已关闭');
      return;
    }
    try {
      BeatRef.onGraph(build);     // 图已建好会立刻回调一次
    } catch (e) {
      warnOnce('订阅音频图失败，KICK 检测已关闭', e);
    }
  }

  /* ------------------------------------------------------------------ *
   * 检测：每 16ms 一次
   * ------------------------------------------------------------------ */
  function emitTrigger(energy, now) {
    const evt = { energy, level: 1, bpm: state.bpm, count: state.count, at: now };
    for (const fn of [...listeners]) {
      try { fn(evt); } catch (e) { console.warn('[kick]', e); }
    }
  }

  function trigger(energy, now) {
    lastTriggerAt = now;
    state.count += 1;
    state.lastAt = now;

    triggerTimes.push(now);
    if (triggerTimes.length > MAX_TRIGGERS) triggerTimes.shift();

    /* 触发时刻表也要截断：暂停/换歌之后旧的时刻还在，间隔会跨越很大一段，
       所以超过 2.5 秒没触发就整表清空（见 tick 开头）。 */
    if (triggerTimes.length >= 3) {
      const intervals = [];
      for (let i = 1; i < triggerTimes.length; i++) {
        const d = triggerTimes[i] - triggerTimes[i - 1];
        if (d >= MIN_INTERVAL && d <= MAX_INTERVAL) intervals.push(d);
      }
      if (intervals.length >= 2) {
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        const bpm = Math.round(60000 / median);
        if (bpm >= MIN_BPM && bpm <= MAX_BPM) state.bpm = bpm;
      }
    }

    state.energy = energy;
    state.level = 1;
    emitTrigger(energy, now);
  }

  function tick() {
    const now = performance.now();
    if (now - lastTickAt < THROTTLE_MS) return;
    lastTickAt = now;

    /* 超过 2.5 秒没触发：清空时刻表，避免换歌后 BPM 被旧间隔拖住。
       放在 playing 判断之前，暂停再恢复时也会走到。 */
    if (triggerTimes.length && lastTriggerAt > 0 && now - lastTriggerAt > STALE_MS) {
      triggerTimes.length = 0;
    }

    if (!state.playing) {
      resync = true;              // 恢复播放时第一帧只同步，不拿暂停前的能量算上升沿
      state.level = 0;            // 暂停后别把暂停前的高值留在对外 state 里
      state.energy = 0;
      return;
    }
    if (!state.available || !analyser) return;

    analyser.getFloatTimeDomainData(timeData);

    let sumSquares = 0, peak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = Math.abs(timeData[i]);
      sumSquares += v * v;
      if (v > peak) peak = v;
    }
    const rms = Math.sqrt(sumSquares / timeData.length);
    const energy = Math.min(1, rms * 2.3 + peak * 0.65);

    const resumed = resync;
    resync = false;

    const slope = energy - prevEnergy;
    prevEnergy = energy;
    state.energy = energy;

    // 快攻慢放：触发时置 1，其余时间逐帧衰减
    state.level *= LEVEL_DECAY;
    if (state.level < 0.001) state.level = 0;

    if (resumed) return;          // 恢复播放的第一帧不判触发

    if (
      energy >= params.threshold &&
      slope > params.minSlope &&
      now - lastTriggerAt >= params.cooldownMs
    ) {
      trigger(energy, now);
    }
  }

  /* ------------------------------------------------------------------ *
   * 对外 API
   * ------------------------------------------------------------------ */
  function on(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function off(fn) {
    listeners.delete(fn);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, Number(v))); }

  /** 改参数，立即生效；cutoff 直接写 BiquadFilter.frequency */
  function configure(patch) {
    if (!patch || typeof patch !== 'object') return { ...params };
    if (Number.isFinite(patch.cutoffHz)) params.cutoffHz = clamp(patch.cutoffHz, 20, 400);
    if (Number.isFinite(patch.threshold)) params.threshold = clamp(patch.threshold, 0, 1);
    if (Number.isFinite(patch.minSlope)) params.minSlope = clamp(patch.minSlope, 0, 0.5);
    if (Number.isFinite(patch.cooldownMs)) params.cooldownMs = clamp(patch.cooldownMs, 30, 2000);

    if (lowpass && ctx) {
      try {
        lowpass.frequency.setTargetAtTime(params.cutoffHz, ctx.currentTime, 0.015);
      } catch {
        lowpass.frequency.value = params.cutoffHz;
      }
    }
    return { ...params };
  }

  /* 启动：脚本顺序保证 beat.js 已经定义；订阅不上就只报一次 warn。 */
  hookGraph();
  if (BeatRef && typeof BeatRef.on === 'function') BeatRef.on('frame', tick);

  return {
    on,
    off,
    state,
    get options() { return { ...params }; },
    configure,
  };
})();

if (typeof window !== 'undefined') window.LIZI_KICK = LIZI_KICK;

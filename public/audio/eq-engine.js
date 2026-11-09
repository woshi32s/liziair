/**
 * eq-engine.js —— 音效引擎（纯音频，零 DOM）
 *
 * 为什么需要这个文件：`player.js` 是裸 <audio>，`beat.js` 已经对这个元素调过
 * `createMediaElementSource`（**同一个元素只能调一次**），所以 EQ 只能插进
 * Beat 已经建好的那张图里。beat.js 为此加了一个 10 行的钩子 `Beat.onGraph(cb)`：
 * 建图完成时把 `{ ctx, src, analyser }` 交出来。
 *
 * 原始链路：       src → analyser →（可选 mute tap）→ destination
 * 插入之后（ON）： src → 7×BiquadFilter → preamp → 立体声宽度 → analyser → …
 * 插入之后（OFF）：src → analyser（真·直通，滤波器不在路径上）
 *
 * 关键约束：**analyser 必须继续收到信号**。BPM 检测和播放页的形态可视化都靠它，
 * 所以链条的末端永远接回 analyser，而不是 destination。
 *
 * 高级模式不用另画一条公式曲线：`getFrequencyResponse()` 取的是真滤波器的响应。
 * 由于取响应要求节点在某张图里，这里在 OfflineAudioContext 里建了一组"影子滤波器"
 * （128 帧，不渲染），每次改参数同步过去；曲线从影子滤波器读，声音走图里的真滤波器。
 * 两套参数由同一个 applyFilters() 写，不会漂。
 *
 * VST3 说明：AudioWorklet 里没有 require / module，官方 SDK 也不允许，
 * 所以本机装的 FabFilter Pro-Q 4 **不能**被嵌进来 —— 这里只照它的交互做。
 */
const EqEngine = (() => {
  const VERSION = 1;
  const KEY = 'lizi.eq.v1';

  /* 7 段中心频率。简单模式下不可改；高级模式下可拖成任意值。 */
  const BANDS = [60, 150, 400, 1000, 2400, 6000, 12000];
  const SIMPLE_Q = 1.1;             // 图形均衡器常用的 1.1：相邻段刚好叠一点，不糊
  const TYPES = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'notch'];
  const TYPE_LABEL = {
    peaking: 'Bell', lowshelf: 'Low Shelf', highshelf: 'High Shelf',
    lowpass: 'Low Pass', highpass: 'High Pass', notch: 'Notch',
  };

  /* 音质档位。`vip: true` 是**网易云的规定**，不是我们的推测：
     未登录时请求 lossless / hires，上游会静默降级到 exhigh（实测见 _eqprobe3.json）。 */
  const QUALITIES = [
    { id: 'standard', label: '标准', br: '128 kbps', vip: false },
    { id: 'higher', label: '较高', br: '192 kbps', vip: false },
    { id: 'exhigh', label: '极高', br: '320 kbps', vip: false },
    { id: 'lossless', label: '无损', br: 'FLAC', vip: true },
    { id: 'hires', label: 'Hi-Res', br: '24bit/96k', vip: true },
  ];

  /* ------------------------------------------------------------------ *
   * 10 套预设
   *
   * 设计原则：**能听出区别**。每套至少有一处 ≥5dB 的搬动，并且刻意让
   * 几套的方向相反（低音增强 vs 人声突出），这样切预设不会像同一堆东西换名字。
   * 3D 环绕那种"空间感"不是 EQ 段做得出来的，靠 width（M/S 侧信号增益）
   * 和 haas（左右几毫秒差）两个额外参数实现 —— 见 STEREO 一段。
   * ------------------------------------------------------------------ */
  const PRESETS = [
    { id: 'flat', name: '平直', gains: [0, 0, 0, 0, 0, 0, 0], width: 1, haas: 0 },
    { id: 'pop', name: '流行', gains: [1.5, 2.5, 1.0, -0.5, 1.5, 3.0, 2.0], width: 1.05, haas: 0 },
    { id: 'vocal', name: '人声突出', gains: [-3.0, -1.5, 1.5, 4.0, 4.5, 2.0, -1.0], width: 1, haas: 0 },
    { id: 'bass', name: '低音增强', gains: [9.5, 7.0, 3.0, -1.0, -2.0, -3.0, -3.5], width: 1, haas: 0 },
    { id: 'edm', name: '电子', gains: [6.5, 4.0, -1.5, 1.0, 3.0, 5.5, 4.5], width: 1.15, haas: 0 },
    { id: 'rock', name: '摇滚', gains: [4.5, 2.0, -1.5, 0.5, 2.5, 5.0, 4.0], width: 1.1, haas: 0 },
    { id: 'classical', name: '古典', gains: [2.0, 1.0, -1.0, 0, 1.5, 2.0, -1.5], width: 1.2, haas: 0 },
    { id: 'live', name: '沉浸现场', gains: [3.0, 2.0, 1.0, 1.5, 2.0, 2.5, 1.0], width: 1.45, haas: 8 },
    { id: '3d', name: '3D 立体环绕', gains: [1.0, 0.5, 0, -1.0, 1.0, 1.5, 0.5], width: 1.9, haas: 12 },
    { id: 'night', name: '夜间（等响度）', gains: [4.0, 2.5, 0.5, -1.0, -1.5, 0.5, 1.5], width: 1, haas: 0 },
  ];

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const band = (i) => ({
    freq: BANDS[i], gain: 0, q: SIMPLE_Q, type: 'peaking', bypass: false,
  });
  const defaults = () => ({
    version: VERSION,
    on: true,
    mode: 'simple',                  // simple | advanced
    quality: 'exhigh',
    simple: {
      preset: 'flat',
      gains: BANDS.map(() => 0),
      width: 1,
      haas: 0,
    },
    advanced: {
      nodes: BANDS.map((_, i) => band(i)),
      ab: 'A',
      slots: { A: null, B: null },
    },
  });

  const state = defaults();
  let actual = null;                  // { level, br, size, fee, type, url } —— 上游真实返回
  let graph = null;                   // { ctx, src, analyser }（Beat 交出来的）
  let probe = null, shadow = [];      // OfflineAudioContext + 7 个影子滤波器
  let nodes = null;                   // 图里的真节点
  let installed = false;
  let inited = false;

  const listeners = {};
  const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
  const emit = (evt, data) => {
    (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.warn('[eq]', e); } });
  };

  /* ------------------------------------------------------------------ *
   * 持久化
   *
   * 版本对不上就整份丢回默认 —— 宁可用户重调一次，也不要拿旧结构去渲染
   * 新界面（那会得到一堆 undefined 的滑杆）。
   * ------------------------------------------------------------------ */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || s.version !== VERSION) { console.info('[eq] 版本不符，已回默认'); return; }
      const def = defaults();
      state.on = typeof s.on === 'boolean' ? s.on : def.on;
      state.mode = s.mode === 'advanced' ? 'advanced' : 'simple';
      state.quality = QUALITIES.some((q) => q.id === s.quality) ? s.quality : def.quality;

      if (s.simple && Array.isArray(s.simple.gains) && s.simple.gains.length === 7) {
        state.simple.gains = s.simple.gains.map((v) => clamp(Number(v) || 0, -12, 12));
        state.simple.preset = typeof s.simple.preset === 'string' ? s.simple.preset : 'flat';
        state.simple.width = clamp(Number(s.simple.width) || 1, 0.5, 2.5);
        state.simple.haas = clamp(Number(s.simple.haas) || 0, 0, 30);
      }
      if (s.advanced && Array.isArray(s.advanced.nodes) && s.advanced.nodes.length === 7) {
        state.advanced.nodes = s.advanced.nodes.map((n, i) => ({
          freq: clamp(Number(n && n.freq) || BANDS[i], 20, 20000),
          gain: clamp(Number(n && n.gain) || 0, -24, 24),
          q: clamp(Number(n && n.q) || SIMPLE_Q, 0.1, 24),
          type: TYPES.includes(n && n.type) ? n.type : 'peaking',
          bypass: !!(n && n.bypass),
        }));
        if (s.advanced.slots) {
          state.advanced.slots.A = Array.isArray(s.advanced.slots.A) ? s.advanced.slots.A : null;
          state.advanced.slots.B = Array.isArray(s.advanced.slots.B) ? s.advanced.slots.B : null;
        }
      }
    } catch { /* 坏数据当没有 */ }
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 配额满了就算了 */ }
    }, 120);
  }

  const clamp = (v, a, b) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);

  /* ------------------------------------------------------------------ *
   * 当前生效的参数（模式决定用哪一组）
   * ------------------------------------------------------------------ */
  function activeParams() {
    if (state.mode === 'advanced') return state.advanced.nodes;
    return state.simple.gains.map((g, i) => ({
      freq: BANDS[i], gain: g, q: SIMPLE_Q, type: 'peaking', bypass: false,
    }));
  }

  /** 前级补偿：按这一组参数里最大的正增益反向压一点，避免 boost 完就削波。
   *  0.7 而不是 1.0 是刻意的：EQ 的峰值很少落在同一频点上，压满会整体偏轻。 */
  function preampDb() {
    const ps = activeParams();
    let max = 0;
    for (const p of ps) if (!p.bypass && p.gain > max) max = p.gain;
    let db = -0.7 * max;
    const w = state.simple.width;
    if (w > 1) db -= 1.0 * Math.log2(w);     // 侧信号拉宽会抬电平，顺手补掉
    return clamp(db, -14, 0);
  }

  /* ------------------------------------------------------------------ *
   * 影子滤波器：只用来取频响（画曲线），不出声
   * ------------------------------------------------------------------ */
  function ensureProbe() {
    if (probe) return true;
    try {
      const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OC) return false;
      probe = new OC(1, 128, 44100);
      shadow = BANDS.map(() => probe.createBiquadFilter());
      return true;
    } catch (e) {
      console.warn('[eq] 影子滤波器建不起来，曲线将退化成直线：', e.message);
      probe = null; shadow = [];
      return false;
    }
  }

  function writeFilter(f, p) {
    if (!f) return;
    try {
      /* 旁通：不同类型的"零增益"语义不一样（Bell 的 gain=0 就是直通，
         Low Pass 的 gain 根本不参与运算）。所以旁通时把类型也一起收回 peaking，
         这样 getFrequencyResponse 给出的就是 1.0 的平线，和无声学旁通一致。 */
      f.type = p.bypass ? 'peaking' : p.type;
      f.frequency.value = clamp(p.freq, 20, 20000);
      f.gain.value = p.bypass ? 0 : clamp(p.gain, -24, 24);
      f.Q.value = clamp(p.q, 0.1, 24);
    } catch { /* 类型不支持就算了 */ }
  }

  /** 把当前参数写进真滤波器 + 影子滤波器 + 立体声/前级 */
  function applyFilters() {
    const ps = activeParams();
    ensureProbe();
    for (let i = 0; i < 7; i++) {
      writeFilter(shadow[i], ps[i]);
      if (nodes) writeFilter(nodes.filters[i], ps[i]);
    }
    if (nodes) {
      const db = preampDb();
      nodes.preamp.gain.value = Math.pow(10, db / 20);
      const w = clamp(state.simple.width, 0.5, 2.5);
      nodes.sideL.gain.value = w;
      nodes.sideR.gain.value = -w;
      nodes.delayR.delayTime.value = clamp(state.simple.haas, 0, 30) / 1000;
    }
    emit('change', snapshot());
  }

  /* ------------------------------------------------------------------ *
   * 音频图
   * ------------------------------------------------------------------ */
  function build(ctx) {
    const preamp = ctx.createGain();
    const filters = BANDS.map(() => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = 1000;
      f.gain.value = 0;
      f.Q.value = SIMPLE_Q;
      return f;
    });
    const split = ctx.createChannelSplitter(2);

    const mk = (count = 1) => {
      const g = ctx.createGain();
      g.channelCount = count;
      g.channelCountMode = 'explicit';
      g.channelInterpretation = 'speakers';
      return g;
    };
    /* M/S 矩阵：mid = .5(L+R)，side = .5(L−R)
       outL = mid + w·side，outR = mid − w·side
       w=1 时恒等于原信号（.5(L+R)+.5(L−R)=L），所以"宽度 1"是完全透明的。 */
    const gLm = mk(); gLm.gain.value = 0.5;
    const gRm = mk(); gRm.gain.value = 0.5;
    const gLs = mk(); gLs.gain.value = 0.5;
    const gRs = mk(); gRs.gain.value = -0.5;
    const mid = mk();
    const side = mk();
    const sideL = mk(); sideL.gain.value = 1;
    const sideR = mk(); sideR.gain.value = -1;
    const outL = mk();
    const outR = mk();
    const delayR = ctx.createDelay(0.1);
    const merge = ctx.createChannelMerger(2);

    /* 串联：f0 → f1 → … → f6 → preamp → 宽度矩阵。
       preamp 放在 7 段之后（"链条末尾"），这样它才是对整条 EQ 的总补偿。 */
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(preamp);
    preamp.connect(split);
    split.connect(gLm, 0); split.connect(gRm, 1);
    split.connect(gLs, 0); split.connect(gRs, 1);
    gLm.connect(mid); gRm.connect(mid);
    gLs.connect(side); gRs.connect(side);
    mid.connect(outL); mid.connect(outR);
    side.connect(sideL); side.connect(sideR);
    sideL.connect(outL); sideR.connect(outR);
    outL.connect(merge, 0, 0);
    outR.connect(delayR); delayR.connect(merge, 0, 1);

    nodes = { preamp, filters, split, merge, delayR, sideL, sideR, outL, outR };
    return nodes;
  }

  /** 重新接线：ON 走滤波器，OFF 直通（真直通，不是"全零增益"） */
  function route() {
    if (!graph) return;
    const { ctx, src, analyser } = graph;
    if (!installed) { build(ctx); installed = true; }
    try { src.disconnect(); } catch { /* 从没连过 */ }
    try {
      if (state.on) {
        src.connect(nodes.filters[0]);
        nodes.merge.disconnect();
        nodes.merge.connect(analyser);
      } else {
        nodes.merge.disconnect();
        src.connect(analyser);
      }
    } catch (e) { console.warn('[eq] 接线失败', e); }
    applyFilters();
    emit('graph', { on: state.on });
  }

  /** Beat 建好图就交过来；如果 EQ 晚于播放器初始化，onGraph 会立刻回调 */
  function hook() {
    if (typeof Beat === 'undefined' || typeof Beat.onGraph !== 'function') return false;
    Beat.onGraph((g) => { graph = g; route(); });
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 对外 API
   * ------------------------------------------------------------------ */
  function setEnabled(v) { state.on = !!v; save(); route(); emit('change', snapshot()); }
  function setMode(m) { state.mode = m === 'advanced' ? 'advanced' : 'simple'; save(); applyFilters(); }
  function setBandGain(i, db) {
    if (i < 0 || i > 6) return;
    state.simple.gains[i] = clamp(Math.round(Number(db) * 10) / 10, -12, 12);
    state.simple.preset = 'custom';
    save(); applyFilters();
  }
  function setPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    state.simple.preset = p.id;
    state.simple.gains = p.gains.slice();
    state.simple.width = p.width;
    state.simple.haas = p.haas;
    save(); applyFilters();
  }
  function resetSimple() {
    state.simple.gains = BANDS.map(() => 0);
    state.simple.preset = 'flat';
    state.simple.width = 1;
    state.simple.haas = 0;
    save(); applyFilters();
  }
  function resetAdvanced() {
    state.advanced.nodes = BANDS.map((_, i) => band(i));
    save(); applyFilters();
  }
  function setWidth(w) { state.simple.width = clamp(Number(w) || 1, 0.5, 2.5); save(); applyFilters(); }
  function setHaas(ms) { state.simple.haas = clamp(Number(ms) || 0, 0, 30); save(); applyFilters(); }

  function setNode(i, patch) {
    const n = state.advanced.nodes[i];
    if (!n) return;
    if (patch.freq != null) n.freq = clamp(Number(patch.freq), 20, 20000);
    if (patch.gain != null) n.gain = clamp(Math.round(Number(patch.gain) * 10) / 10, -24, 24);
    if (patch.q != null) n.q = clamp(Math.round(Number(patch.q) * 100) / 100, 0.1, 24);
    if (patch.type && TYPES.includes(patch.type)) n.type = patch.type;
    if (patch.bypass != null) n.bypass = !!patch.bypass;
    save(); applyFilters();
  }
  function cycleType(i) {
    const n = state.advanced.nodes[i];
    if (!n) return null;
    const next = TYPES[(TYPES.indexOf(n.type) + 1) % TYPES.length];
    setNode(i, { type: next });
    return next;
  }

  /** A/B：把当前状态存进当前槽，切到另一槽并套用 */
  function toggleAB() {
    const A = state.advanced;
    const cur = A.ab;
    A.slots[cur] = clone(A.nodes);
    const other = cur === 'A' ? 'B' : 'A';
    A.ab = other;
    if (Array.isArray(A.slots[other]) && A.slots[other].length === 7) {
      state.advanced.nodes = clone(A.slots[other]);
    }
    save(); applyFilters();
    return other;
  }

  function setQuality(id) {
    if (!QUALITIES.some((q) => q.id === id)) return;
    state.quality = id;
    /* api.js 的 songUrl() 读这个全局决定 level —— 这样不用改 player.js，
       player.js 里那一行 `API.songUrl(track.id)` 自动就带上当前音质。 */
    window.LIZI_QUALITY = id;
    save();
    emit('quality', id);
  }

  /** 上游真实返回值。UI 必须如实显示，不许把"请求了无损"当成"拿到了无损"。 */
  function setActual(item) {
    actual = item ? {
      level: item.level || null,
      br: item.br || 0,
      size: item.size || 0,
      fee: item.fee == null ? null : item.fee,
      type: item.type || null,
      code: item.code == null ? null : item.code,
      url: !!item.url,
      trial: !!item.freeTrialInfo,
    } : null;
    emit('actual', actual);
  }

  /** 频响：用影子滤波器（参数与真滤波器逐字同步）取真实响应，返回 dB 数组。
   *  **不含前级**：曲线画的是"你设的 EQ 形状"，前级补偿单独在界面上标数字
   *  （Pro-Q 也是这么分的）。这样没动过的频段就老老实实落在 0dB 线上。 */
  function responseDb(freqs) {
    const n = freqs.length;
    const out = new Float32Array(n);
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) f32[i] = clamp(freqs[i], 10, 22000);
    const mag = new Float32Array(n);
    const pha = new Float32Array(n);
    if (ensureProbe() && shadow.length === 7) {
      out.fill(1);
      for (let k = 0; k < 7; k++) {
        shadow[k].getFrequencyResponse(f32, mag, pha);
        for (let i = 0; i < n; i++) out[i] *= mag[i];
      }
    } else {
      out.fill(1);
    }
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) db[i] = 20 * Math.log10(Math.max(1e-6, out[i]));
    return db;
  }

  function snapshot() {
    return {
      version: VERSION,
      on: state.on,
      mode: state.mode,
      quality: state.quality,
      gains: state.simple.gains.slice(),
      preset: state.simple.preset,
      width: state.simple.width,
      haas: state.simple.haas,
      nodes: clone(state.advanced.nodes),
      ab: state.advanced.ab,
      preampDb: Math.round(preampDb() * 100) / 100,
      installed,
      params: activeParams().map((p) => ({ ...p })),
    };
  }

  /** 图里的真滤波器当前值（测试和调试用；没有图就返回影子那组） */
  function liveFilters() {
    const src = nodes ? nodes.filters : shadow;
    return src.map((f) => ({
      type: f.type,
      freq: f.frequency.value,
      gain: f.gain.value,
      q: f.Q.value,
    }));
  }

  function init() {
    if (inited) { applyFilters(); return; }
    inited = true;
    load();
    window.LIZI_QUALITY = state.quality;
    ensureProbe();
    /* Beat 是同步定义的全局（beat.js 在 app.js 之前），但 EQ 可能比播放器先初始化，
       所以两条路都试：能立刻挂上就挂，挂不上就等 init() 的下一拍。 */
    if (!hook()) setTimeout(hook, 0);
    applyFilters();
    emit('ready', snapshot());
  }

  return {
    VERSION, KEY, BANDS, TYPES, TYPE_LABEL, QUALITIES, PRESETS, SIMPLE_Q,
    on, init, snapshot, responseDb, liveFilters,
    setEnabled, setMode, setBandGain, setPreset, resetSimple, resetAdvanced,
    setWidth, setHaas, setNode, cycleType, toggleAB, setQuality, setActual,
    get state() { return state; },
    get actual() { return actual; },
    get quality() { return state.quality; },
    get graphReady() { return !!graph; },
    get sampleRate() { return graph ? graph.ctx.sampleRate : (probe ? probe.sampleRate : 44100); },
    /** 测试用：把图交出来（只读） */
    get _graph() { return graph; },
    get _nodes() { return nodes; },
  };
})();

/* 立刻初始化：持久化的音质/均衡必须在**第一次 Player.load() 之前**生效，
   所以不能等用户打开面板才初始化。 */
if (typeof window !== 'undefined') EqEngine.init();

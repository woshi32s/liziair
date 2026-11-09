/**
 * glide.js —— 自动过渡（双 deck 交叉淡化）引擎 + 实验室试听入口
 *
 * 参考 janakchoudharydev/spicetify-glide（v3.2.0）的**触发层**：
 *   · 剩余时长 ≤ 过渡时长时提前切下一首（Glide 叫 early skip）
 *   · onprogress + 400ms 心跳双保险
 *   · hasSkipped / lastSkippedUri 防同一首重复触发
 *   · 前 3 秒不触发、时长不足 2×过渡时长的短歌不触发
 *   · 单曲循环（Repeat One）不在提前切歌范围内
 *
 * 但它和 Glide 有一个根本区别，必须说清楚：
 *   Glide **自己不混音**。它把 Spotify 的 native crossfade 打开（ConfigAPI /
 *   PlayerAPI / Cosmos），然后提前调用 Player.next()，由 Spotify 的内建音频引擎
 *   完成真正的重叠。那套内建接口是 Spotify 专属，浏览器里没有。
 *
 *   所以这里移植的是「什么时候切、切之前预载什么、失败怎么退」，混音换成我们
 *   自己的双 deck：两条 <audio> 同时播放，各自的 GainNode 按等功率曲线交错。
 *   Glide 源码里没有任何交叉淡化曲线函数，默认就用等功率 cos/sin
 *   （cos²+sin²≡1，和实验室原来的演示一致）。
 *
 * 音频图：每个 <audio> → MediaElementSource → 自己的 Gain → beat.js 的 busIn
 *         →（EQ 开则 7 段滤波 / 关则直通）→ analyser → destination
 * 两条 deck 的 Gain 由这里用 setValueCurveAtTime 调度，样本级精确。
 */
const Glide = (() => {
  const VERSION = 1;
  const KEY = 'lizi.audio.glide';
  const MIN_LEN = 4;
  const MAX_LEN = 12;
  const PREFETCH_LEAD = 3;      // 离曲尾 fade+3s 开始预载第二条 deck
  const HEARTBEAT_MS = 400;     // Glide 的 400ms 心跳，补 timeupdate 不够密的情况
  const MIN_FADE = 0.7;         // 极端情况下最少留这么多秒做淡化

  /* 默认关闭：没写过 localStorage['lizi.audio.glide'] 的用户，切歌保持原来的硬切。
     开关在播放页「控制」抽屉里（和音效 / 播放队列同一层）。 */
  const DEFAULTS = { version: VERSION, enabled: false, duration: 6, curve: 'equal' };

  /* 曲线：equal = 等功率（cos/sin），linear = 线性，smooth = smoothstep。
     equal 是默认；Glide 本身没有曲线实现，这是等功率交叉淡化的标准解。 */
  const CURVES = {
    equal: { label: '等功率' },
    linear: { label: '线性' },
    smooth: { label: 'S 曲线' },
  };

  const cfg = { ...DEFAULTS };

  const listeners = {};
  const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
  const emit = (evt, data) => {
    (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.warn('[glide]', e); } });
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const trackName = (tr) => (tr && (tr.name || tr.title)) || '未知曲目';

  let transition = null;        // { fromIndex,toIndex,fromTrack,toTrack,outgoing,element,prepared,dur,timer }
  let prefetch = null;          // { fromIndex,toIndex,element,prepared,ready,queueRef }
  let starting = false;         // startFade 是异步的，防止心跳和 timeupdate 并发开两次
  let cancelSeq = 0;            // 取消代次：等待预载期间用户暂停/切歌，就不能再开声
  let retryAfter = 0;           // 预载失败后的冷却，避免每个 timeupdate 都重试
  /* 随机模式必须把"这一首的下一首"定住：每次 peekNext 都重新抽，
     心跳每 400ms 抽一次会把预载反复作废。 */
  let shufflePick = null;       // { fromIndex, index }
  let status = { kind: 'idle', text: '空闲' };

  /* ================================================================== *
   * 设置持久化
   * ================================================================== */
  function normDuration(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULTS.duration;
    return Math.round(clamp(n, MIN_LEN, MAX_LEN) * 2) / 2;
  }

  function loadCfg() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || s.version !== VERSION) return;   // 版本不符回默认，别拿旧结构渲染
      cfg.enabled = typeof s.enabled === 'boolean' ? s.enabled : DEFAULTS.enabled;
      cfg.duration = normDuration(s.duration);
      cfg.curve = CURVES[s.curve] ? s.curve : DEFAULTS.curve;
    } catch { /* 隐私模式 / 坏数据都当没有 */ }
  }

  function saveCfg() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: VERSION, enabled: cfg.enabled, duration: cfg.duration, curve: cfg.curve,
      }));
    } catch { /* 配额满了就算了，设置不持久也不影响播放 */ }
  }

  /* ================================================================== *
   * 能力检测
   *
   * 没有 Web Audio 就没有双 deck 的样本级增益，不能假装有动效 ——
   * 面板会把开关置灰并说明原因，播放器回退成普通切歌。
   * ================================================================== */
  function capability() {
    if (typeof window === 'undefined') return { ok: false, reason: '当前环境没有浏览器音频能力' };
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { ok: false, reason: '浏览器不支持 Web Audio（AudioContext），无法做双轨交叉淡化' };
    if (typeof Beat !== 'undefined' && Beat.audioFailed) {
      return { ok: false, reason: 'Web Audio 初始化失败，已回退普通切歌' };
    }
    return { ok: true, reason: '' };
  }

  function snapshot() {
    const cap = capability();
    return {
      version: VERSION,
      enabled: cfg.enabled,
      duration: cfg.duration,
      curve: cfg.curve,
      curves: Object.entries(CURVES).map(([id, c]) => ({ id, label: c.label })),
      minDuration: MIN_LEN,
      maxDuration: MAX_LEN,
      supported: cap.ok,
      reason: cap.reason,
      transitioning: !!transition,
      prefetching: !!(prefetch && !prefetch.ready),
      nextName: prefetch && prefetch.prepared ? trackName(prefetch.prepared.track) : '',
      statusKind: status.kind,
      status: status.text,
    };
  }

  function setStatus(kind, text) {
    if (status.kind === kind && status.text === text) return;
    status = { kind, text };
    emit('status', snapshot());
    updateLabState();
  }

  /* ================================================================== *
   * 曲线
   * ================================================================== */
  function buildCurve(kind, points = 128) {
    const out = new Float32Array(points);
    const inc = new Float32Array(points);
    for (let i = 0; i < points; i++) {
      const p = i / (points - 1);
      if (kind === 'linear') {
        out[i] = 1 - p;
        inc[i] = p;
      } else if (kind === 'smooth') {
        const s = p * p * (3 - 2 * p);
        out[i] = 1 - s;
        inc[i] = s;
      } else {
        // 等功率：power = cos² + sin² ≡ 1
        const a = p * Math.PI / 2;
        out[i] = Math.cos(a);
        inc[i] = Math.sin(a);
      }
    }
    return { out, inc };
  }

  /* ================================================================== *
   * 预载
   * ================================================================== */
  function clearPrefetch() { prefetch = null; }

  function ensurePrefetch(nextIndex) {
    if (typeof Player === 'undefined' || !Player.prepareIncoming || !Player.decks) return null;
    const st = Player.state;
    const current = Player.decks.idle;
    if (prefetch && prefetch.fromIndex === st.index && prefetch.toIndex === nextIndex && prefetch.element === current) {
      return prefetch;
    }
    if (Date.now() < retryAfter) return null;

    const p = {
      fromIndex: st.index,
      toIndex: nextIndex,
      element: current,
      queueRef: st.queue,
      ready: false,
      prepared: null,
    };
    prefetch = p;
    setStatus('next', '正在预载下一首…');

    Player.prepareIncoming(nextIndex).then((prepared) => {
      if (prefetch !== p) return null;                 // 期间切歌/取消，作废
      if (!prepared) { prefetch = null; retryAfter = Date.now() + 1500; setStatus('idle', '预载失败，本次不交叉'); return null; }
      p.prepared = prepared;
      p.ready = true;
      setStatus('next', '下一首 · ' + trackName(prepared.track));
      check();                                          // 可能已经进入淡化窗口，立刻开始
      return prepared;
    }).catch(() => {
      if (prefetch !== p) return;
      prefetch = null;
      retryAfter = Date.now() + 1500;
      setStatus('idle', '预载失败，本次不交叉');
    });
    return p;
  }

  /* ================================================================== *
   * 监测：什么时候开始预载 / 开始淡化
   *
   * 规则和 Glide 的 checkProgress 对齐：
   *   前 3 秒不触发；短于 2×过渡时长不触发；单曲循环不提前切。
   * 区别是 Glide 直接 next()，这里先预载第二条 deck，再按曲线淡化。
   * ================================================================== */
  function syncMute() {
    if (!transition) return;
    const { outgoing, element } = transition;
    if (!outgoing || !element) return;
    // app.js 是直接改 Player.audio.muted 的：活动元素改了以后，进场那条也要跟上
    if (element.muted !== outgoing.muted) element.muted = outgoing.muted;
    if (element.volume !== outgoing.volume) element.volume = outgoing.volume;
  }

  /** 自动过渡的下一首：随机模式在换歌前固定住抽取结果，其余模式直接问 Player。 */
  function autoNextIndex() {
    if (typeof Player === 'undefined' || !Player.peekNext) return null;
    if (Player.state.mode === 'shuffle') {
      if (!shufflePick || shufflePick.fromIndex !== Player.state.index) {
        shufflePick = { fromIndex: Player.state.index, index: Player.peekNext(true) };
      }
      return shufflePick.index;
    }
    return Player.peekNext(true);
  }

  function check() {
    if (transition) { syncMute(); return; }
    if (!cfg.enabled) return;
    const cap = capability();
    if (!cap.ok) { setStatus('off', cap.reason); return; }
    if (typeof Player === 'undefined' || !Player.decks || !Player.state) return;

    const st = Player.state;
    if (!st.playing || !st.queue || !st.queue.length) return;
    if (st.mode === 'single') return;                   // 单曲循环：跳过交叉淡化

    const active = Player.decks.active;
    if (!active || active.paused || !active.src) return;
    const dur = active.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;

    const cur = active.currentTime;
    if (cur < 3) return;                                // Glide：开头 3 秒不判断
    if (dur < cfg.duration * 2) return;                 // 太短的歌不切
    const remaining = dur - cur;
    if (remaining <= 0) return;

    const nextIndex = autoNextIndex();
    if (nextIndex == null) {
      if (remaining <= cfg.duration + PREFETCH_LEAD) setStatus('tail', '顺序播放到队尾，不接歌');
      return;
    }

    if (remaining <= cfg.duration + PREFETCH_LEAD) {
      if (!prefetch || prefetch.fromIndex !== st.index || prefetch.toIndex !== nextIndex) {
        ensurePrefetch(nextIndex);
      }
    }

    /* 多留 0.25s 的启动余量：心跳/事件有粒度，晚 0.3s 就会把用户设的
       6.0s 变成 5.7s。提前一点触发、曲线仍按 cfg.duration 跑满。 */
    if (remaining <= cfg.duration + 0.25 && prefetch && prefetch.ready) {
      startFade({ prepared: prefetch.prepared }).catch(() => {
        clearPrefetch();
        retryAfter = Date.now() + 2000;
        setStatus('idle', '过渡启动失败，已回退普通切歌');
      });
    }
  }

  /* ================================================================== *
   * 开始淡化
   * ================================================================== */
  async function startFade(opts = {}) {
    if (transition || starting) return false;
    starting = true;
    try {
      return await runStartFade(opts);
    } finally {
      starting = false;
    }
  }

  async function runStartFade(opts = {}) {
    const cap = capability();
    if (!cap.ok) { setStatus('off', cap.reason); return false; }
    const seq = cancelSeq;
    if (typeof Player === 'undefined' || !Player.decks || !Player.state) return false;

    const active = Player.decks.active;
    if (!active) return false;
    const fromIndex = Player.state.index;
    const fromTrack = Player.state.queue[fromIndex];

    let prepared = opts.prepared || null;
    if (!prepared) {
      const idx = opts.index != null ? opts.index : Player.peekNext(!!opts.auto);
      if (idx == null) { setStatus('tail', '没有下一首可过渡'); return false; }
      if (!opts.manual) setStatus('next', '正在预载下一首…');
      try { prepared = await Player.prepareIncoming(idx); } catch { prepared = null; }
      if (!prepared) { setStatus('idle', '预载失败，本次不交叉'); return false; }
    }

    /* 预载是异步的：期间用户可能切歌 / 暂停 / 换队列。
       下标、活动元素、token、取消代次任何一个变了都不能开声。 */
    if (seq !== cancelSeq || active.paused) return false;
    if (Player.state.index !== fromIndex || Player.decks.active !== active) { clearPrefetch(); return false; }
    if (prepared.token !== Player.state.token) { clearPrefetch(); return false; }
    if (prepared.element !== Player.decks.idle) { clearPrefetch(); return false; }

    const incoming = prepared.element;
    const gOut = Beat.deckGain(active);
    const gIn = Beat.deckGain(incoming);
    const ctx = Beat.context;
    if (!gOut || !gIn || !ctx) {
      clearPrefetch();
      retryAfter = Date.now() + 2000;
      setStatus('off', 'Web Audio 图未就绪，已回退普通切歌');
      return false;
    }

    await Beat.resume();                                // 必须在用户手势后恢复上下文
    if (seq !== cancelSeq || active.paused) return false;
    try {
      incoming.muted = active.muted;
      incoming.volume = active.volume;

      const now = ctx.currentTime;
      gOut.gain.cancelScheduledValues(now);
      gIn.gain.cancelScheduledValues(now);
      gOut.gain.setValueAtTime(1, now);
      gIn.gain.setValueAtTime(0, now);

      await incoming.play();
    } catch (e) {
      // 移动端 / 自动播放策略可能拒绝第二条元素：不伪造过渡，回退普通切歌
      try { gIn.gain.cancelScheduledValues(ctx.currentTime); gIn.gain.setValueAtTime(0, ctx.currentTime); } catch { /* ignore */ }
      try { incoming.pause(); } catch { /* ignore */ }
      clearPrefetch();
      retryAfter = Date.now() + 2000;
      setStatus('idle', '进场音轨无法播放，本曲结束再切');
      return false;
    }

    if (seq !== cancelSeq || Player.state.index !== fromIndex || Player.state.token !== prepared.token || Player.decks.active !== active) {
      try { incoming.pause(); } catch { /* ignore */ }
      try { gIn.gain.cancelScheduledValues(ctx.currentTime); gIn.gain.setValueAtTime(0, ctx.currentTime); } catch { /* ignore */ }
      clearPrefetch();
      return false;
    }

    /* 时长以实际剩余时间为准（时钟触发有最多一个心跳的误差），
       但不超过用户设的时长；手动试听时同理。 */
    const remaining = Math.max(0, (active.duration || 0) - active.currentTime);
    const dur = clamp(remaining, MIN_FADE, cfg.duration);
    const t0 = ctx.currentTime + 0.02;
    const { out, inc } = buildCurve(cfg.curve, 128);

    /* 初始值在 play() 之前已经设在 now 上了；这里不要再在 t0 插一个
       setValueAtTime —— 和同起点的 setValueCurveAtTime 叠在一起会踩到
       Web Audio 的「事件重叠」限制。曲线自己的第一个点就是 t0 的值。 */
    try {
      gOut.gain.cancelScheduledValues(t0);
      gIn.gain.cancelScheduledValues(t0);
      gOut.gain.setValueCurveAtTime(out, t0, dur);
      gIn.gain.setValueCurveAtTime(inc, t0, dur);
    } catch (e) {
      // 个别实现不支持 setValueCurveAtTime：宁可回退普通切歌，也不留半条曲线
      try {
        gOut.gain.cancelScheduledValues(ctx.currentTime); gOut.gain.setValueAtTime(1, ctx.currentTime);
        gIn.gain.cancelScheduledValues(ctx.currentTime); gIn.gain.setValueAtTime(0, ctx.currentTime);
        incoming.pause();
      } catch { /* ignore */ }
      clearPrefetch();
      retryAfter = Date.now() + 2000;
      setStatus('idle', '曲线调度失败，已回退普通切歌');
      return false;
    }

    const t = {
      fromIndex, toIndex: prepared.index,
      fromTrack, toTrack: prepared.track,
      outgoing: active, element: incoming,
      prepared, dur, timer: 0,
    };
    transition = t;
    clearPrefetch();
    setStatus('transition', '过渡中 · ' + trackName(fromTrack) + ' → ' + trackName(prepared.track));
    // 曲线走完（外加一点调度余量）再切活动元素；提前切会让进度条跳得太早
    t.timer = setTimeout(commitTransition, (dur + 0.08) * 1000);
    return true;
  }

  /* ================================================================== *
   * 淡化结束：把活动元素交给新歌
   * ================================================================== */
  function commitTransition() {
    const t = transition;
    if (!t) return;
    transition = null;
    if (t.timer) clearTimeout(t.timer);

    const ctx = Beat.context;
    const now = ctx ? ctx.currentTime : 0;
    const gOut = Beat.deckGain(t.outgoing);
    const gIn = Beat.deckGain(t.element);
    try {
      if (gOut) { gOut.gain.cancelScheduledValues(now); gOut.gain.setValueAtTime(0, now); }
      if (gIn) { gIn.gain.cancelScheduledValues(now); gIn.gain.setValueAtTime(1, now); }
    } catch { /* ignore */ }

    let ok = false;
    try { ok = Player.commitIncoming(t.prepared); } catch (e) { console.warn('[glide] commit', e); }

    if (!ok) {
      // 落点失败：把出场曲的增益还回去，进场那条静音。
      // 如果出场曲已经自然结束，才走普通下一首，避免多跳一首。
      try {
        if (gOut) { gOut.gain.cancelScheduledValues(now); gOut.gain.setValueAtTime(1, now); }
        if (gIn) { gIn.gain.cancelScheduledValues(now); gIn.gain.setValueAtTime(0, now); }
        t.element.pause();
      } catch { /* ignore */ }
      if (t.outgoing.ended) { try { Player.next(true); } catch { /* ignore */ } }
      setStatus('idle', '切歌落点失败');
      return;
    }
    clearPrefetch();
    setStatus('idle', '空闲');
  }

  /* ================================================================== *
   * 取消（手动切歌 / 暂停 / 拖动 / 关开关）
   * ================================================================== */
  function cancel(reason) {
    cancelSeq++;
    clearPrefetch();
    retryAfter = 0;
    const t = transition;
    if (!t) {
      if (reason !== 'lab') setStatus('idle', '空闲');
      return;
    }
    transition = null;
    if (t.timer) clearTimeout(t.timer);

    const ctx = Beat.context;
    const now = ctx ? ctx.currentTime : 0;
    try {
      const gOut = Beat.deckGain(t.outgoing);
      const gIn = Beat.deckGain(t.element);
      if (gOut) { gOut.gain.cancelScheduledValues(now); gOut.gain.setValueAtTime(1, now); }
      if (gIn) { gIn.gain.cancelScheduledValues(now); gIn.gain.setValueAtTime(0, now); }
      t.element.pause();
    } catch { /* ignore */ }
    setStatus('idle', '空闲');
  }

  /* ================================================================== *
   * 实验室：用当前队列手动试听一次真实过渡
   * ================================================================== */
  async function preview() {
    if (transition) return false;
    const cap = capability();
    if (!cap.ok) { setStatus('off', cap.reason); return false; }
    if (typeof Player === 'undefined' || !Player.state || !Player.decks) {
      setStatus('idle', '播放器还没准备好');
      return false;
    }
    const st = Player.state;
    if (!st.queue || !st.queue.length) { setStatus('idle', '队列是空的'); return false; }
    if (st.queue.length < 2) { setStatus('idle', '队列里至少要有两首歌'); return false; }

    let active = Player.decks.active;
    if (!active.src) {
      try { await Player.playAt(st.index); } catch { /* 下面统一报 */ }
      active = Player.decks.active;
    }
    if (!active.src) { setStatus('idle', '当前曲目没有可播放的地址'); return false; }

    if (active.paused) {
      try { Beat.resume(); await active.play(); } catch (e) {
        setStatus('idle', '无法开始播放：' + (e && e.message ? e.message : '被浏览器拦截'));
        return false;
      }
    }

    const idx = Player.peekNext(false);      // 手动试听按"手点下一首"的规则
    if (idx == null) { setStatus('idle', '没有下一首可试听'); return false; }
    setStatus('next', '正在准备试听…');
    return startFade({ index: idx, manual: true }).catch(() => {
      setStatus('idle', '试听启动失败');
      return false;
    });
  }

  /* ================================================================== *
   * 对外设置
   * ================================================================== */
  function setEnabled(v) {
    cfg.enabled = !!v;
    saveCfg();
    if (!cfg.enabled) {
      cancel('disabled');
      setStatus('off', '已关闭');
    } else {
      retryAfter = 0;
      if (!transition) setStatus('idle', '空闲');
      check();
    }
    emit('change', snapshot());
  }

  function setDuration(v) {
    cfg.duration = normDuration(v);
    saveCfg();
    emit('change', snapshot());
  }

  function setCurve(k) {
    if (!CURVES[k]) return;
    cfg.curve = k;
    saveCfg();
    emit('change', snapshot());
  }

  /* ================================================================== *
   * 实验室分页注入
   *
   * 只往 #lab-pane-xfade 的右栏塞一个按钮和一行状态，不改 index.html、
   * 不改 app.js；原来的等功率曲线演示照旧。
   * ================================================================== */
  function updateLabState() {
    const el = document.getElementById('glide-lab-state');
    if (!el) return;
    const cap = capability();
    el.textContent = cap.ok ? status.text : '不可用：' + cap.reason;
  }

  function injectLab() {
    const pane = document.getElementById('lab-pane-xfade');
    if (!pane || pane.querySelector('[data-glide-lab]')) return;
    const side = pane.querySelector('.lab-side');
    if (!side) return;

    const box = document.createElement('div');
    box.dataset.glideLab = '1';
    box.innerHTML = `
      <div class="lab-btns">
        <button class="lab-btn" id="glide-lab-run" type="button">用当前队列试听真实过渡</button>
        <button class="lab-btn lab-btn--ghost" id="glide-lab-cancel" type="button">取消过渡</button>
      </div>
      <p class="lab-hint" id="glide-lab-state">真双 deck：两条 &lt;audio&gt; 同时出声，按等功率曲线淡化；和播放页「音效 / 自动过渡」是同一个引擎。</p>`;
    side.appendChild(box);

    const run = box.querySelector('#glide-lab-run');
    const stop = box.querySelector('#glide-lab-cancel');
    run.addEventListener('click', async () => {
      run.disabled = true;
      try { await preview(); } finally { setTimeout(() => { run.disabled = false; }, 320); }
    });
    stop.addEventListener('click', () => cancel('lab'));
    updateLabState();
  }

  /* ================================================================== *
   * 播放页「控制」抽屉入口
   *
   * 入口和「音效 / 均衡器」「播放队列」放在同一排 drawer__tile 里。
   * DOM 由这里注入、不写进 index.html：安卓侧的 index.html 会被 sync.js
   * 再加工（viewport / 触屏命中区），单文件推设备时不能用桌面版覆盖它。
   * 样式在 app.css 的「歌曲过渡」段。
   * ================================================================== */
  let drawer = null;

  function syncDrawer() {
    if (!drawer) return;
    const s = snapshot();
    const usable = s.supported;
    drawer.badge.textContent = !usable ? '不可用' : (s.enabled ? '开' : '关');
    drawer.sw.disabled = !usable;
    drawer.sw.setAttribute('aria-checked', String(usable && s.enabled));
    drawer.len.disabled = !usable;
    drawer.len.value = String(s.duration);
    drawer.lenVal.textContent = s.duration.toFixed(1) + ' s';
    drawer.state.textContent = !usable ? '不可用' : s.status;
    drawer.note.textContent = usable
      ? `默认关闭。离曲尾 ${(s.duration + PREFETCH_LEAD).toFixed(0)} 秒预载下一首，按等功率曲线重叠 ${s.duration.toFixed(1)} 秒；关闭时切歌保持原来的硬切。设置存于 localStorage['${KEY}']。`
      : `不可用：${s.reason}。播放器回退为普通切歌，不会伪造过渡。`;
  }

  function injectDrawer() {
    const tiles = document.querySelector('#drawer .drawer__tiles');
    if (!tiles || document.getElementById('btn-xfade')) return;

    const btn = document.createElement('button');
    btn.className = 'drawer__row drawer__tile drawer__tile--wide';
    btn.id = 'btn-xfade';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'drawer-xfade');
    btn.innerHTML = `
      <span class="drawer__ico"><svg class="ico" aria-hidden="true"><use href="#i-pulse"/></svg></span>
      <span class="drawer__label">歌曲过渡</span>
      <span class="drawer__desc">交叉淡入淡出</span>
      <span class="drawer__val" id="xfade-badge">关</span>
      <svg class="ico drawer__caret" aria-hidden="true"><use href="#i-chevron"/></svg>`;
    tiles.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'drawer__sub xfade-panel';
    panel.id = 'drawer-xfade';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="xfade-row">
        <span class="xfade-row__t">交叉淡入淡出</span>
        <span class="xfade-row__s" id="xfade-state">已关闭</span>
        <button class="drawer__sw" id="xfade-on" type="button" role="switch" aria-checked="false" aria-label="歌曲过渡总开关"><i></i></button>
      </div>
      <div class="diy">
        <div class="diy__head"><span>过渡时长</span><span class="diy__val" id="xfade-dur-val">6.0 s</span></div>
        <input class="sl" id="xfade-dur" type="range" min="${MIN_LEN}" max="${MAX_LEN}" step="0.5" value="6" aria-label="过渡时长">
      </div>
      <p class="xfade-note" id="xfade-note"></p>`;
    tiles.insertAdjacentElement('afterend', panel);

    drawer = {
      btn, panel,
      badge: btn.querySelector('#xfade-badge'),
      sw: panel.querySelector('#xfade-on'),
      state: panel.querySelector('#xfade-state'),
      len: panel.querySelector('#xfade-dur'),
      lenVal: panel.querySelector('#xfade-dur-val'),
      note: panel.querySelector('#xfade-note'),
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    drawer.sw.addEventListener('click', () => setEnabled(!cfg.enabled));
    drawer.len.addEventListener('input', () => setDuration(Number(drawer.len.value)));

    on('change', syncDrawer);
    on('status', syncDrawer);
    syncDrawer();
  }

  /* ================================================================== *
   * 启动
   * ================================================================== */
  function init() {
    if (typeof Player !== 'undefined' && Player.on) {
      Player.on('time', check);
      Player.on('playstate', (playing) => { if (playing) check(); });
      Player.on('trackchange', () => {
        clearPrefetch();
        shufflePick = null;
        retryAfter = 0;
        if (!transition) setStatus('idle', '空闲');
      });
    }
    setInterval(() => { check(); }, HEARTBEAT_MS);
    injectLab();
    setStatus(cfg.enabled ? 'idle' : 'off', cfg.enabled ? '空闲' : '已关闭');
    emit('change', snapshot());
  }

  /* 先读设置、挂抽屉入口，再等 Player 起来接事件。
     入口本身不依赖播放器：Player 一直没起来时也看得到开关和持久化状态。 */
  loadCfg();
  injectDrawer();

  let attempts = 0;
  function boot() {
    if (typeof Player === 'undefined' || !Player.on) {
      if (attempts++ < 60) setTimeout(boot, 200);
      return;
    }
    init();
  }
  boot();

  return {
    VERSION, KEY, CURVES,
    on, snapshot, preview,
    setEnabled, setDuration, setCurve,
    cancel,
    isTransitioning: () => !!transition,
    get config() { return { ...cfg }; },
  };
})();

/* 挂到 window 上：player.js / eq-ui.js 里用 window.Glide 判断，
   避免两边脚本执行顺序不同时踩到顶层 const 的 TDZ。 */
if (typeof window !== 'undefined') window.Glide = Glide;

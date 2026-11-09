/* ==========================================================================
   LIZI · 360° 空间音频（大厅「工具箱」里的一个工具）
   --------------------------------------------------------------------------
   做什么：
     一个有纵深的 3D 舞台：听者在原点，1–4 个立体音响可以放在任意方位、
     任意远近、任意仰角上。把音响拖到哪儿，耳机里听到的声音就来自哪儿。

   音频链路（完全不碰主播放器）：
     自己的 AudioContext
       AudioBufferSourceNode（内置测试循环 / 当前歌曲解码后的 buffer）
         ├─ PannerNode × N（HRTF / inverse 距离模型）
         │    └─ GainNode × N（单个音响音量 × 数量补偿）
         └─ 都汇到 masterGain → AnalyserNode → destination
     分析节点放在 masterGain 之后：舞台上波环的强弱跟「真正送进耳朵的电平」
     一致，总音量拧到 0，波环也会跟着消失。

   角度约定（俯视，正前方 = 0°，角度向左增大，和单子里的「左 90° / 右 270°」一致）：
     世界坐标：X 向右、Y 向上、Z 向前是 -Z（Web Audio 听者默认朝向 -Z）
       x = -sin(θ) * d
       y = sin(仰角) * d        ← 高度；水平半径仍是 d，拖动时落点才和鼠标对得上
       z = -cos(θ) * d
     所以 0° 在前、90° 在左、180° 在后、270° 在右。

   3D 投影（canvas 2D，不用 WebGL）：
     相机在半径 7.4m 的球面上绕原点转：yaw 绕 Y 轴、pitch 是俯角、zoom 只改焦距。
     project(x, y, z) 把世界点投到屏幕；groundPoint(clientX, clientY) 反着来：
     屏幕点 → 相机射线 → 与 y=0 平面求交，拖动音响时角度和距离就是这么算的，
     所以视角转过之后拖拽方向依然正确。
     为什么不用 WebGL：透明窗口里 WebGL 的合成开销大（大厅那边已经踩过
     WebGL 铺色 + 大面积模糊一起卡的坑），几百条透视折线用 2D canvas 完全够，
     还能直接读 CSS 变量里的墨色，和浮层是同一套颜色。

   边界：
     · HRTF 只有戴耳机才容易听出前后；外放只能听出左右。
     · 「当前歌曲」走 fetch + decodeAudioData，跨域或链接失效时会明确提示并退回内置音。
     · 音响高度用 sin 而不是 tan：tan(60°)×3.4m ≈ 5.9m 会顶出舞台；sin 最高约 3m，
       而且 Panner 的 positionY 和画面用的是同一个 y，不会出现「看得见、听不见」。
   ========================================================================== */

window.LIZI_SPATIAL = (() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量
   * ------------------------------------------------------------------ */
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const MAX_SPEAKERS = 4;
  const MIN_DIST = 0.9;          // 最近 0.9 m
  const MAX_DIST = 3.4;          // 最远 3.4 m
  const MAX_ELEV = 60;           // 仰角上限 60°
  const DIRS = ['前', '左前', '左', '左后', '后', '右后', '右', '右前'];

  const FONT_BODY = '"Geist", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const FONT_MONO = '"Geist Mono", ui-monospace, "SFMono-Regular", monospace';

  /** 主播放器的取值入口。player.js 顶层写的是 `const Player = (() => …)()`，
      那是一个全局词法绑定，不是 window 的属性 —— 直接读 window.Player 永远
      是 undefined，于是「当前歌曲」一直被判成不可用。先按标识符取（同一页的
      普通脚本之间可见），取不到再退回 window（兼容以后换成别的加载方式）。 */
  function mainPlayer() {
    try { return (typeof Player !== 'undefined' && Player) || window.Player || null; } catch { return window.Player || null; }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normDeg = (a) => ((a % 360) + 360) % 360;

  /** 角度 → 人话方位。45° = 左前，90° = 左，270° = 右 */
  function dirName(a) {
    return DIRS[Math.round(normDeg(a) / 45) % 8];
  }

  function angleText(a) {
    return `${Math.round(normDeg(a)) % 360}°`;
  }

  function placementText(sp) {
    return `${dirName(sp.angle)} ${angleText(sp.angle)} · ${sp.distance.toFixed(1)} m · 仰 ${Math.round(sp.elevation)}°`;
  }

  let REDUCED = false;
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    REDUCED = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', (e) => { REDUCED = e.matches; });
  } catch { /* 老内核没有 matchMedia 事件 */ }

  /* ------------------------------------------------------------------ *
   * 样式：index.html 只加一行 script，CSS 由这里注入
   * ------------------------------------------------------------------ */
  (function injectCss() {
    if (document.querySelector('link[data-lizi-spatial-css]')) return;
    const current = document.currentScript ||
      document.querySelector('script[src*="tools/spatial/spatial.js"]');
    const href = current
      ? new URL('spatial.css', current.src).href
      : 'tools/spatial/spatial.css';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-lizi-spatial-css', '');
    document.head.appendChild(link);
  })();

  const CLOSE_SVG = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18"/>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 相机 / 投影
   * ------------------------------------------------------------------ */
  const CAM_R = 7.4;             // 相机离原点的距离（米）
  const PITCH_MIN = 0.30;        // 俯角下限 ≈ 17°，再平地面就压成一条线
  const PITCH_MAX = 1.02;        // 俯角上限 ≈ 58°，再陡后圈会把舞台撑破
  const PITCH_DEF = 0.64;        // 默认俯角 ≈ 37°，一个舒服的「看桌面」角度
  const ZOOM_MIN = 0.7;
  const ZOOM_MAX = 1.35;         // 再往里推，最外圈会切出舞台

  const CAM = { yaw: 0, pitch: PITCH_DEF, zoom: 1 };
  const CAM_T = { yaw: 0, pitch: PITCH_DEF, zoom: 1 };
  const camVel = { yaw: 0, pitch: 0 };

  /** 每帧算一次：相机位置、三根基向量、焦距、屏幕中心 */
  const view = {
    w: 0, h: 0, dpr: 1, focal: 0, cx: 0, cy: 0,
    cam: null, f: null, right: null, up: null,
  };

  function updateViewSpace(W, H) {
    const yaw = CAM.yaw;
    const phi = CAM.pitch;
    const sy = Math.sin(yaw), cyw = Math.cos(yaw);
    const sp = Math.sin(phi), cp = Math.cos(phi);

    view.cam = {
      x: sy * CAM_R * cp,
      y: CAM_R * sp,
      z: cyw * CAM_R * cp,
    };
    // 相机看向原点；三根轴都是单位向量
    view.f = { x: -sy * cp, y: -sp, z: -cyw * cp };
    view.right = { x: cyw, y: 0, z: -sy };
    view.up = { x: -sy * sp, y: cp, z: -cyw * sp };

    view.focal = Math.min(W, H) * 0.72 * CAM.zoom;
    view.cx = W / 2;
    view.cy = H * 0.56;
    view.w = W;
    view.h = H;
  }

  /** 世界坐标 → 屏幕像素。返回 null 表示在相机后面 */
  function project(x, y, z) {
    if (!view.f) return null;
    const vx = x - view.cam.x;
    const vy = y - view.cam.y;
    const vz = z - view.cam.z;
    const zc = vx * view.f.x + vy * view.f.y + vz * view.f.z;
    if (zc < 0.08) return null;
    const k = view.focal / zc;
    return {
      x: view.cx + (vx * view.right.x + vy * view.right.y + vz * view.right.z) * k,
      y: view.cy - (vx * view.up.x + vy * view.up.y + vz * view.up.z) * k,
      z: zc,
      k,
    };
  }

  /** 屏幕点 → 地面交点。拖音响全靠它，所以视角转过之后拖拽仍然跟手 */
  function groundPoint(clientX, clientY) {
    if (!view.f || !els || !els.stage) return null;
    const rect = els.stage.getBoundingClientRect();
    const nx = (clientX - rect.left - view.cx) / view.focal;
    const ny = (view.cy - (clientY - rect.top)) / view.focal;
    const d = {
      x: view.f.x + nx * view.right.x + ny * view.up.x,
      y: view.f.y + nx * view.right.y + ny * view.up.y,
      z: view.f.z + nx * view.right.z + ny * view.up.z,
    };
    if (d.y > -0.02) return null;         // 射线朝上，永远够不着地面
    const t = -view.cam.y / d.y;
    if (!(t > 0)) return null;
    return { x: view.cam.x + d.x * t, z: view.cam.z + d.z * t };
  }

  /* ------------------------------------------------------------------ *
   * 几何
   * ------------------------------------------------------------------ */
  let nextId = 1;

  function makeSpeaker(angle, distance, elevation) {
    return {
      id: nextId++,
      angle: normDeg(angle),
      distance: clamp(distance, MIN_DIST, MAX_DIST),
      elevation: clamp(elevation || 0, 0, MAX_ELEV),
      vol: 0.85,
    };
  }

  function resetSpeakers() {
    // 单子约定：左 90° / 右 270°
    state.speakers = [makeSpeaker(90, 2.2, 0), makeSpeaker(270, 2.2, 0)];
    state.selected = state.speakers[0].id;
  }

  function findSpeaker(id) {
    return state.speakers.find((s) => s.id === id) || null;
  }

  /** 极坐标 + 仰角 → 世界坐标。音频和画面共用这一份，不会对不上 */
  function worldPos(sp) {
    const a = sp.angle * DEG;
    const e = sp.elevation * DEG;
    return {
      x: -Math.sin(a) * sp.distance,
      y: Math.sin(e) * sp.distance,
      z: -Math.cos(a) * sp.distance,
    };
  }

  /** 新音响找空闲方位：优先 0 / 90 / 180 / 270，其次找最大空隙的中点 */
  function nextFreeAngle() {
    const used = state.speakers.map((s) => normDeg(s.angle));
    const candidates = [0, 90, 180, 270];
    const free = candidates.filter((c) =>
      used.every((a) => Math.min(Math.abs(a - c), 360 - Math.abs(a - c)) > 20));
    if (free.length) return free[0];

    const sorted = used.slice().sort((a, b) => a - b);
    let bestAt = 0;
    let bestGap = -1;
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const next = sorted[(i + 1) % sorted.length] + (i === sorted.length - 1 ? 360 : 0);
      const gap = next - cur;
      if (gap > bestGap) { bestGap = gap; bestAt = cur + gap / 2; }
    }
    return normDeg(bestAt);
  }

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const state = {
    open: false,
    speakers: [],
    selected: null,
    source: 'test',          // 'test' | 'song'
    master: 0.8,
    playing: false,
    songBuffer: null,
    songSrc: '',
  };

  let root = null;
  let els = null;
  let built = false;
  let lastFocus = null;
  let drag = null;             // 拖音响
  let orbit = null;            // 拖空白处转视角
  const nodeEls = new Map();   // speaker id → 舞台节点

  /* ------------------------------------------------------------------ *
   * 音频
   * ------------------------------------------------------------------ */
  let ctx = null;
  let masterGain = null;
  let analyser = null;
  let analyserBuf = null;
  let level = 0;               // 0–1，舞台上的声波/电平晕都读它
  let sourceNode = null;
  let sourceConnected = new Set();
  const audioSpk = new Map();  // speaker id → { panner, gain }
  let testBuffer = null;
  let activeBuffer = null;
  let playOffset = 0;
  let playStartedAt = 0;
  let mainWasPlaying = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('这个浏览器不支持 Web Audio');
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = state.master;

    // 分析节点放在 masterGain 之后：读到的就是真正送出去的信号
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;              // 128/256 足够取 RMS，越小越省
    analyser.smoothingTimeConstant = 0.78;
    analyserBuf = new Uint8Array(analyser.fftSize);

    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
    setupListener();
    return ctx;
  }

  /** 听者在原点、面朝 -Z（屏幕上方 = 正前），与 Panner 的角度约定一致 */
  function setupListener() {
    const L = ctx.listener;
    if (!L) return;
    if (L.positionX) {
      L.positionX.value = 0;
      L.positionY.value = 0;
      L.positionZ.value = 0;
      L.forwardX.value = 0;
      L.forwardY.value = 0;
      L.forwardZ.value = -1;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else if (L.setPosition) {
      L.setPosition(0, 0, 0);
      L.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  /** 每个音响的音量再除以 √N：加音响时总响度大致不变，不会越加越吵 */
  function speakerTarget(sp) {
    return clamp(sp.vol, 0, 1) / Math.sqrt(Math.max(1, state.speakers.length));
  }

  function setPannerPos(panner, sp, immediate) {
    const { x, y, z } = worldPos(sp);
    if (panner.positionX) {
      if (immediate) {
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
      } else {
        const t = ctx ? ctx.currentTime : 0;
        // 拖动时平滑追过去，避免爆音和拉链噪声
        panner.positionX.setTargetAtTime(x, t, 0.035);
        panner.positionY.setTargetAtTime(y, t, 0.035);
        panner.positionZ.setTargetAtTime(z, t, 0.035);
      }
    } else if (panner.setPosition) {
      // 老 Safari 兜底：没有 AudioParam 版本，只能直接设
      panner.setPosition(x, y, z);
    }
  }

  function updateGain(sp) {
    const rec = audioSpk.get(sp.id);
    if (!rec || !ctx) return;
    try {
      rec.gain.gain.setTargetAtTime(speakerTarget(sp), ctx.currentTime, 0.03);
    } catch { /* 上下文正在关闭 */ }
  }

  function createSpeakerAudio(sp) {
    if (!ctx) return;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 20;
    panner.rolloffFactor = 0.8;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    setPannerPos(panner, sp, true);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    panner.connect(gain);
    gain.connect(masterGain);

    const rec = { panner, gain };
    audioSpk.set(sp.id, rec);
    updateGain(sp);   // 从 0 平滑到目标，避免新音响“啪”一声

    if (sourceNode) {
      try {
        sourceNode.connect(panner);
        sourceConnected.add(panner);
      } catch { /* 已经连过或上下文关闭 */ }
    }
  }

  function removeSpeakerAudio(id) {
    const rec = audioSpk.get(id);
    if (!rec || !ctx) return;
    audioSpk.delete(id);
    try {
      rec.gain.gain.cancelScheduledValues(ctx.currentTime);
      rec.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    } catch { /* noop */ }
    const oldSource = sourceNode;
    sourceConnected.delete(rec.panner);
    // 留 80ms 让增益落下去再断开（连去 source 的连接也留到这时），避免删音响时爆音
    setTimeout(() => {
      if (oldSource) {
        try { oldSource.disconnect(rec.panner); } catch { /* noop */ }
      }
      try { rec.panner.disconnect(); } catch { /* noop */ }
      try { rec.gain.disconnect(); } catch { /* noop */ }
    }, 80);
  }

  function syncSpeakerAudio() {
    if (!ctx) return;
    const keep = new Set(state.speakers.map((s) => s.id));
    for (const id of Array.from(audioSpk.keys())) {
      if (!keep.has(id)) removeSpeakerAudio(id);
    }
    for (const sp of state.speakers) {
      if (!audioSpk.has(sp.id)) createSpeakerAudio(sp);
      else {
        const rec = audioSpk.get(sp.id);
        setPannerPos(rec.panner, sp, true);
        updateGain(sp);
      }
    }
  }

  /** 内置测试循环：8 秒无缝循环，和弦 + 琶音 + 每 0.5 秒一个宽带“沙锤”
      沙锤是给 HRTF 定位用的 —— 纯音很难判断前后。 */
  function makeTestBuffer() {
    if (testBuffer) return testBuffer;
    const sr = ctx.sampleRate;
    const dur = 8;
    const n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);

    let seed = 0x1a2b3c4d;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const chords = [
      [220.00, 277.18, 329.63],
      [196.00, 246.94, 293.66],
      [174.61, 220.00, 261.63],
      [164.81, 207.65, 246.94],
    ];
    const notes = [523.25, 587.33, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33];

    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const chord = chords[Math.floor(t / 2) % chords.length];
      let v = 0;

      for (const f of chord) {
        v += Math.sin(2 * Math.PI * f * t) * 0.055;
        v += Math.sin(2 * Math.PI * f * 1.003 * t) * 0.03;   // 轻微失谐
      }

      // 每 0.5 秒一个琶音，帮助听清方向
      const step = Math.floor(t / 0.5);
      const ph = t % 0.5;
      v += Math.sin(2 * Math.PI * notes[step % notes.length] * t) * Math.exp(-ph * 9) * 0.16;

      // 每 0.5 秒一个短促的宽带噪声，HRTF 对宽带声更敏感
      const noiseEnv = Math.exp(-ph * 70);
      v += (rnd() - 0.5) * noiseEnv * 0.2;

      // 首尾各 30ms 淡入淡出，循环接缝不爆音
      const fade = Math.min(1, t / 0.03, (dur - t) / 0.03);
      d[i] = clamp(v * fade, -1, 1);
    }

    testBuffer = buf;
    return buf;
  }

  function stopSource() {
    const node = sourceNode;
    sourceNode = null;
    sourceConnected.clear();
    if (!node) return;
    node.onended = null;
    try { node.stop(); } catch { /* 还没 start 或已停 */ }
    try { node.disconnect(); } catch { /* noop */ }
  }

  function startSource(buffer, loop, offset) {
    stopSource();
    if (!ctx || !buffer) return;

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = !!loop;
    node.loopStart = 0;
    node.loopEnd = buffer.duration;
    sourceNode = node;

    sourceConnected.clear();
    for (const rec of audioSpk.values()) {
      try {
        node.connect(rec.panner);
        sourceConnected.add(rec.panner);
      } catch { /* noop */ }
    }

    node.onended = () => {
      if (sourceNode !== node) return;      // 我们主动停的，不处理
      sourceNode = null;
      sourceConnected.clear();
      state.playing = false;
      playOffset = 0;
      updateTransport();
      setMsg('播放结束');
    };

    playStartedAt = ctx.currentTime;
    playOffset = clamp(offset || 0, 0, Math.max(0, buffer.duration - 0.01));
    try {
      node.start(0, playOffset);
    } catch {
      stopSource();
      throw new Error('音频启动失败');
    }
  }

  function currentOffset() {
    if (!ctx || !state.playing || !activeBuffer) return playOffset;
    const elapsed = Math.max(0, ctx.currentTime - playStartedAt);
    if (!activeBuffer.loop) {
      return Math.min(playOffset + elapsed, activeBuffer.duration);
    }
    return activeBuffer.duration > 0
      ? (playOffset + elapsed) % activeBuffer.duration
      : 0;
  }

  async function loadSong() {
    const P = mainPlayer();
    const a = P && P.audio;
    const src = a && a.src;
    if (!src) throw new Error('播放器里还没有歌曲，先用内置测试循环');

    if (state.songBuffer && state.songSrc === src) return state.songBuffer;

    ensureCtx();
    setMsg('正在读取当前歌曲…');

    let res;
    try {
      res = await fetch(src);
    } catch {
      throw new Error('读不到当前歌曲（跨域或链接已失效），请改用内置测试音');
    }
    if (!res.ok) throw new Error(`读取当前歌曲失败（HTTP ${res.status}）`);

    let ab;
    try { ab = await res.arrayBuffer(); }
    catch { throw new Error('读取当前歌曲失败'); }

    if (!state.open || !ctx) return null;

    let buf;
    try { buf = await ctx.decodeAudioData(ab); }
    catch { throw new Error('当前歌曲解码失败，可能不是可解码的音频，请改用内置测试音'); }

    if (!state.open) return null;   // 解码期间工具被关了，不要留住几十 MB

    state.songBuffer = buf;
    state.songSrc = src;
    setMsg(`已载入当前歌曲 · ${buf.duration.toFixed(1)} 秒`);
    return buf;
  }

  function pauseMainForSong() {
    const P = mainPlayer();
    const a = P && P.audio;
    if (!a || a.paused) return;
    mainWasPlaying = true;
    try { a.pause(); } catch { /* noop */ }
  }

  function restoreMainPlayer() {
    if (!mainWasPlaying) return;
    mainWasPlaying = false;
    const P = mainPlayer();
    const a = P && P.audio;
    if (!a) return;
    try {
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* 用户手势限制之类的，忽略 */ }
  }

  async function play() {
    if (!state.open) return;
    try {
      ensureCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!state.open) return;

      if (state.source === 'song') {
        await loadSong();
        if (!state.open) return;
        if (!state.songBuffer) throw new Error('当前歌曲没准备好');
        pauseMainForSong();
        activeBuffer = state.songBuffer;
      } else {
        activeBuffer = makeTestBuffer();
      }

      if (playOffset >= activeBuffer.duration) playOffset = 0;
      syncSpeakerAudio();

      state.playing = true;
      startSource(activeBuffer, state.source === 'test', playOffset);
      waveAcc = 0;
      updateTransport();
      setMsg(state.source === 'song' ? '主播放器已暂停；关闭工具后会恢复' : '');
    } catch (e) {
      state.playing = false;
      updateTransport();
      setMsg((e && e.message) || '播放失败', true);
    }
  }

  function pause() {
    if (!state.playing) return;
    playOffset = currentOffset();
    state.playing = false;
    stopSource();
    updateTransport();
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  async function switchSource(v) {
    if (v === state.source) return;
    const was = state.playing;
    if (was) {
      state.playing = false;
      stopSource();
      playOffset = 0;
      updateTransport();
    }

    state.source = v;
    if (v === 'song') {
      try {
        await loadSong();
      } catch (e) {
        if (!state.open) return;
        state.source = 'test';
        els.src.value = 'test';
        setMsg(e.message, true);
        if (was) play();
        updateSourceHint();
        return;
      }
      if (!state.open) return;
    }

    if (was) play();
    else setMsg(v === 'song' ? '当前歌曲已就绪，按播放' : '');
    updateSourceHint();
  }

  /** 关闭时：先把总增益拉下去，再停源、断节点、关上下文 */
  function teardownAudio() {
    const oldCtx = ctx;
    const oldMaster = masterGain;
    const oldAnalyser = analyser;
    const oldSource = sourceNode;
    const oldSpk = Array.from(audioSpk.values());

    ctx = null;
    masterGain = null;
    analyser = null;
    analyserBuf = null;
    sourceNode = null;
    sourceConnected.clear();
    audioSpk.clear();
    testBuffer = null;
    activeBuffer = null;
    playOffset = 0;
    level = 0;
    waves.length = 0;
    waveAcc = 0;
    // 整首歌的 AudioBuffer 可能几十 MB，关闭就放掉
    state.songBuffer = null;
    state.songSrc = '';

    if (!oldCtx) return;

    try {
      if (oldMaster) oldMaster.gain.setTargetAtTime(0, oldCtx.currentTime, 0.02);
    } catch { /* noop */ }

    setTimeout(() => {
      if (oldSource) {
        try { oldSource.onended = null; } catch { /* noop */ }
        try { oldSource.stop(); } catch { /* noop */ }
        try { oldSource.disconnect(); } catch { /* noop */ }
      }
      for (const rec of oldSpk) {
        try { rec.panner.disconnect(); } catch { /* noop */ }
        try { rec.gain.disconnect(); } catch { /* noop */ }
      }
      try { if (oldAnalyser) oldAnalyser.disconnect(); } catch { /* noop */ }
      try { oldCtx.close(); } catch { /* noop */ }
    }, 80);
  }

  /* ------------------------------------------------------------------ *
   * 画布：地面 / 声波 / 听者 / 音响
   * ------------------------------------------------------------------ */
  let cvs = null;
  let g = null;
  // 舞台只用黑白灰：层级靠 alpha / 线宽区分，和浮层的纸白 + 墨色是一套。
  let PAL = {
    paper: 'rgb(255,255,255)',
    ink: 'rgb(21,20,28)',
    ink2: 'rgb(93,90,102)',
    ink3: 'rgb(128,125,138)',
  };

  /** 从 tokens.css 读墨色。canvas 对 oklch 的支持比 CSS 晚，读不到就退回 sRGB */
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const probe = document.createElement('canvas').getContext('2d');
    const pick = (name, fallback) => {
      const raw = cs.getPropertyValue(name).trim();
      if (!raw) return fallback;
      probe.fillStyle = '#010203';
      probe.fillStyle = raw;
      return probe.fillStyle === '#010203' ? fallback : raw;
    };
    PAL = {
      paper: pick('--paper-2', '#ffffff'),
      ink: pick('--ink', 'rgb(21,20,28)'),
      ink2: pick('--ink-2', 'rgb(93,90,102)'),
      ink3: pick('--ink-3', 'rgb(128,125,138)'),
    };
  }

  const BOX = { HW: 0.21, HD: 0.15, HH: 0.24 };   // 半宽 / 半深 / 半高（米）

  const waves = [];
  let waveAcc = 0;
  const anim = { on: false, raf: 0, last: 0, camText: '', level: -1 };

  function resizeCanvas() {
    if (!cvs || !g || !els) return;
    const w = Math.max(1, els.stage.clientWidth);
    const h = Math.max(1, els.stage.clientHeight);
    if (w <= 1 || h <= 1) return;            // 浮层还没显示，等下一次
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    view.dpr = dpr;
    view.w = w;
    view.h = h;
    if (state.open) drawScene();
  }

  function circlePoints(cx, cz, r, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      const p = project(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
      if (!p) return null;
      pts.push(p);
    }
    return pts;
  }

  function pathRing(pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
  }

  function strokeRing(pts, color, alpha, width) {
    if (!pts) return;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width || 1;
    pathRing(pts);
    g.stroke();
    g.restore();
  }

  function textAt(str, p, font, color, alpha, align) {
    if (!p) return;
    g.save();
    g.globalAlpha = alpha;
    g.font = font;
    g.fillStyle = color;
    g.textAlign = align || 'center';
    g.textBaseline = 'middle';
    g.shadowColor = PAL.paper;
    g.shadowBlur = 3;
    g.fillText(str, p.x, p.y);
    g.restore();
  }

  function drawGround() {
    const plate = circlePoints(0, 0, 3.55, 72);
    if (!plate) return;

    // 地台：中心 4% 的墨，往外淡到 0 —— 有实体感但不出现灰块
    const o = project(0, 0, 0);
    if (o) {
      const grad = g.createRadialGradient(o.x, o.y, 2, o.x, o.y, Math.min(view.w, view.h) * 0.62);
      grad.addColorStop(0, PAL.ink);
      grad.addColorStop(1, 'transparent');
      g.save();
      g.globalAlpha = 0.055;
      g.fillStyle = grad;
      pathRing(plate);
      g.fill();
      g.restore();
    }

    // 每 0.5m 一圈；1/2/3m 加重并标字
    for (let r = 0.5; r <= 3.5; r += 0.5) {
      const major = r % 1 === 0;
      const pts = circlePoints(0, 0, r, 64);
      strokeRing(pts, PAL.ink, major ? 0.16 : 0.07, major ? 1 : 1);
      if (major && r <= 3) {
        const p = project(0.82 * r, 0, -0.57 * r);
        textAt(`${r}m`, p, `10px ${FONT_MONO}`, PAL.ink3, 0.85);
      }
    }

    // 每 30° 一根方位线；0/90/180/270 加重
    for (let d = 0; d < 360; d += 30) {
      const a = d * DEG;
      const major = d % 90 === 0;
      const p1 = project(-Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      const p2 = project(-Math.sin(a) * 3.5, 0, -Math.cos(a) * 3.5);
      if (!p1 || !p2) continue;
      g.save();
      g.globalAlpha = major ? 0.14 : 0.06;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.stroke();
      g.restore();
    }
  }

  function drawCompass() {
    const words = [
      { a: 0, t: '前' }, { a: 90, t: '左' },
      { a: 180, t: '后' }, { a: 270, t: '右' },
    ];
    for (const w of words) {
      const a = w.a * DEG;
      const p = project(-Math.sin(a) * 3.26, 0, -Math.cos(a) * 3.26);
      const t0 = project(-Math.sin(a) * 3.02, 0, -Math.cos(a) * 3.02);
      const t1 = project(-Math.sin(a) * 3.44, 0, -Math.cos(a) * 3.44);
      if (t0 && t1) {
        g.save();
        g.globalAlpha = 0.3;
        g.strokeStyle = PAL.ink;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(t0.x, t0.y);
        g.lineTo(t1.x, t1.y);
        g.stroke();
        g.restore();
      }
      textAt(w.t, p, `600 13px ${FONT_BODY}`, PAL.ink2, 0.9);
    }
  }

  /** 每个音响脚下扩散的同心波：从实际电平里取强弱。
      暂停时不再发新波，靠 level 自然衰减 + 各自的 ttl 收尾，不会啪一下消失。 */
  function drawWaves() {
    if (!waves.length) return;
    for (const w of waves) {
      const t = w.age / w.ttl;
      if (t >= 1) continue;
      const r = 0.1 + t * 1.15;
      const a = Math.pow(1 - t, 1.6) * level * w.strength * 0.6;
      if (a < 0.012) continue;
      strokeRing(circlePoints(w.x, w.z, r, 44), PAL.ink, a, 1.1);
    }
  }

  function drawListenerHalo() {
    const lv = state.playing ? level : 0;
    if (lv < 0.02) return;
    const r = REDUCED ? 0.42 : 0.34 + lv * 0.26;
    strokeRing(circlePoints(0, 0, r, 44), PAL.ink, 0.08 + lv * 0.28, 1.2);

    const o = project(0, 0, 0);
    if (!o) return;
    const rad = Math.max(6, (0.7 + lv * 0.6) * view.focal / o.z);
    const grad = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, rad);
    grad.addColorStop(0, PAL.ink);
    grad.addColorStop(1, 'transparent');
    g.save();
    g.globalAlpha = lv * 0.12;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(o.x, o.y, rad, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawGroundLabel() {
    const p = project(0, 0, 0.62);
    textAt('你', p, `500 11px ${FONT_BODY}`, PAL.ink3, 0.85);
  }

  function drawListener() {
    const head = project(0, 0.98, 0);
    const bodyB = project(0, 0.04, 0);
    const bodyT = project(0, 0.80, 0);
    if (!head || !bodyB || !bodyT) return;
    const bw = 0.19 * bodyB.k;
    const tw = 0.25 * bodyT.k;
    const hr = 0.14 * head.k;

    g.save();
    g.globalAlpha = 0.82;
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.moveTo(bodyB.x - bw, bodyB.y);
    g.lineTo(bodyT.x - tw, bodyT.y);
    g.lineTo(bodyT.x + tw, bodyT.y);
    g.lineTo(bodyB.x + bw, bodyB.y);
    g.closePath();
    g.fill();

    g.beginPath();
    g.arc(head.x, head.y, hr, 0, TAU);
    g.fill();

    // 鼻尖朝前（-Z），一眼能看出听者面朝哪儿；和小人同是墨色，
    // 靠轮廓伸出头部来识别，不再用强调色。
    const nose = project(0, 0.98, -0.16);
    if (nose) {
      g.fillStyle = PAL.ink;
      g.globalAlpha = 0.95;
      g.beginPath();
      g.moveTo(head.x - hr * 0.45, head.y);
      g.lineTo(nose.x, nose.y);
      g.lineTo(head.x + hr * 0.45, head.y);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** 音响脚下的投影 + 高度垂线，先画，再叠立体块 */
  function drawSpeakerGround(sp) {
    const w = worldPos(sp);
    const on = sp.id === state.selected;
    // 选中态只加粗、加深，颜色仍是墨色 —— 不用强调色来区分。
    strokeRing(circlePoints(w.x, w.z, 0.25, 36), PAL.ink, on ? 0.34 : 0.11, on ? 1.6 : 1);

    if (w.y > 0.1) {
      const a = project(w.x, 0, w.z);
      const b = project(w.x, w.y, w.z);
      if (a && b) {
        g.save();
        g.globalAlpha = 0.16;
        g.strokeStyle = PAL.ink;
        g.lineWidth = 1;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.restore();
      }
    }
  }

  function drawSpeakerBox(sp) {
    const w = worldPos(sp);
    const on = sp.id === state.selected;
    const len = Math.hypot(w.x, w.z) || 1;
    const nx = -w.x / len;           // 朝向听者（单位向量）
    const nz = -w.z / len;
    const tx = -nz;                  // 水平切向
    const tz = nx;

    const cy = w.y + BOX.HH;
    const { HW, HD, HH } = BOX;

    const vert = (sx, sy, sd) => ({
      x: w.x + tx * (sx * HW) + nx * (sd * HD),
      y: cy + sy * HH,
      z: w.z + tz * (sx * HW) + nz * (sd * HD),
    });
    const V = {};
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sd of [-1, 1]) V[`${sx},${sy},${sd}`] = vert(sx, sy, sd);
      }
    }

    // 六个面，每个面四个顶点按环序写，法线朝外
    const faces = [
      { n: { x: 0, y: 1, z: 0 }, v: ['-1,1,-1', '1,1,-1', '1,1,1', '-1,1,1'] },       // 顶
      { n: { x: 0, y: -1, z: 0 }, v: ['-1,-1,-1', '1,-1,-1', '1,-1,1', '-1,-1,1'] }, // 底
      { n: { x: tx, y: 0, z: tz }, v: ['1,-1,-1', '1,-1,1', '1,1,1', '1,1,-1'] },     // 切向 +
      { n: { x: -tx, y: 0, z: -tz }, v: ['-1,-1,-1', '-1,-1,1', '-1,1,1', '-1,1,-1'] },// 切向 -
      { n: { x: nx, y: 0, z: nz }, v: ['-1,-1,1', '1,-1,1', '1,1,1', '-1,1,1'] },      // 朝听者
      { n: { x: -nx, y: 0, z: -nz }, v: ['-1,-1,-1', '1,-1,-1', '1,1,-1', '-1,1,-1'] },// 背向听者
    ];

    const toCam = (p) => {
      const dx = view.cam.x - p.x;
      const dy = view.cam.y - p.y;
      const dz = view.cam.z - p.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      return { x: dx / l, y: dy / l, z: dz / l };
    };

    const visible = [];
    for (const f of faces) {
      const vs = f.v.map((k) => V[k]).filter(Boolean);
      if (vs.length < 3) continue;
      const c = { x: 0, y: 0, z: 0 };
      for (const p of vs) { c.x += p.x; c.y += p.y; c.z += p.z; }
      c.x /= vs.length; c.y /= vs.length; c.z /= vs.length;
      const dir = toCam(c);
      const facing = f.n.x * dir.x + f.n.y * dir.y + f.n.z * dir.z;
      if (facing <= 0) continue;
      const pp = vs.map((p) => project(p.x, p.y, p.z));
      if (pp.some((p) => !p)) continue;
      const depth = pp.reduce((s, p) => s + p.z, 0) / pp.length;
      visible.push({ pts: pp, facing, depth, top: f.n.y > 0.5 });
    }
    visible.sort((a, b) => b.depth - a.depth);   // 远的先画，近的盖上去

    g.save();
    for (const f of visible) {
      // 选中的箱体整体再压深一点（约黑/10% 的填充感），不靠颜色区分
      g.globalAlpha = (f.top ? 0.05 + f.facing * 0.03 : 0.05 + f.facing * 0.1)
        + (on ? 0.06 : 0);
      g.fillStyle = PAL.ink;
      g.beginPath();
      g.moveTo(f.pts[0].x, f.pts[0].y);
      for (let i = 1; i < f.pts.length; i++) g.lineTo(f.pts[i].x, f.pts[i].y);
      g.closePath();
      g.fill();
      g.globalAlpha = on ? 0.75 : 0.3;
      g.strokeStyle = PAL.ink;
      g.lineWidth = on ? 1.4 : 1;
      g.stroke();
    }
    g.restore();

    // 顶面朝向箭头：指向听者，让「音响朝哪儿」一眼可见
    const topY = cy + HH;
    const tip = project(w.x + nx * 0.30, topY, w.z + nz * 0.30);
    const b1 = project(w.x - nx * 0.13 + tx * 0.09, topY, w.z - nz * 0.13 + tz * 0.09);
    const b2 = project(w.x - nx * 0.13 - tx * 0.09, topY, w.z - nz * 0.13 - tz * 0.09);
    if (tip && b1 && b2) {
      g.save();
      g.globalAlpha = on ? 0.75 : 0.32;
      g.fillStyle = PAL.ink;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(b1.x, b1.y);
      g.lineTo(b2.x, b2.y);
      g.closePath();
      g.fill();
      g.restore();
    }

    // 选中的音响再加一点朝听者的辐射束，别的时候保持干净
    if (on) {
      const fc = { x: w.x + nx * HD, y: cy, z: w.z + nz * HD };
      g.save();
      g.globalAlpha = 0.16;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 1;
      for (const off of [-0.16, 0, 0.16]) {
        const a = project(fc.x + nx * 0.62 + tx * off, fc.y, fc.z + nz * 0.62 + tz * off);
        const b = project(fc.x, fc.y, fc.z);
        if (!a || !b) continue;
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(a.x, a.y);
        g.stroke();
      }
      g.restore();
    }
  }

  function drawScene() {
    if (!g || !cvs || !view.w) return;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, view.w, view.h);
    updateViewSpace(view.w, view.h);

    drawGround();
    drawWaves();
    drawListenerHalo();
    drawGroundLabel();

    // 听者和音响按深度排序：近的盖住远的
    const items = [];
    const lp = project(0, 0.9, 0);
    items.push({ kind: 'you', depth: lp ? lp.z : 1e6 });
    for (const sp of state.speakers) {
      const w = worldPos(sp);
      const p = project(w.x, w.y + BOX.HH, w.z);
      items.push({ kind: 'spk', sp, depth: p ? p.z : 1e6 });
    }
    items.sort((a, b) => b.depth - a.depth);

    for (const it of items) {
      if (it.kind === 'you') drawListener();
      else {
        drawSpeakerGround(it.sp);
        drawSpeakerBox(it.sp);
      }
    }

    drawCompass();
    placeSpeakerNodes();
    updateCamReadout();
  }

  /** 把 HTML 音响按钮放到投影后的位置上；画布负责块体，按钮负责点选 / 键盘 */
  function placeSpeakerNodes() {
    if (!view.w || !view.h) return;
    for (const sp of state.speakers) {
      const node = nodeEls.get(sp.id);
      if (!node) continue;
      const w = worldPos(sp);
      const p = project(w.x, w.y + BOX.HH, w.z);
      if (!p) {
        node.hidden = true;
        continue;
      }
      node.hidden = false;
      node.style.left = `${(p.x / view.w) * 100}%`;
      node.style.top = `${(p.y / view.h) * 100}%`;
      node.style.zIndex = String(1000 - Math.round(p.z * 20));
    }
  }

  function updateCamReadout() {
    if (!els || !els.camV) return;
    const text = `俯角 ${Math.round(CAM.pitch / DEG)}° · ${Math.round(CAM.zoom * 100)}%`;
    if (text === anim.camText) return;
    anim.camText = text;
    els.camV.textContent = text;
  }

  /* ------------------------------------------------------------------ *
   * 电平 / 声波
   * ------------------------------------------------------------------ */
  function readRms() {
    if (!analyser || !analyserBuf) return 0;
    try { analyser.getByteTimeDomainData(analyserBuf); }
    catch { return 0; }
    let sum = 0;
    for (let i = 0; i < analyserBuf.length; i++) {
      const v = (analyserBuf[i] - 128) / 128;
      sum += v * v;
    }
    return clamp(Math.sqrt(sum / analyserBuf.length) * 3.4, 0, 1);
  }

  function stepLevel() {
    const target = state.playing ? readRms() : 0;
    level += (target - level) * (target > level ? 0.35 : 0.12);
    if (level < 0.002) level = 0;
  }

  function stepWaves(dt) {
    if (state.playing && !REDUCED) {
      waveAcc += dt;
      if (waveAcc >= 0.6) {
        waveAcc = 0;
        // 每个音响各发一圈，强度跟它自己的增益走；音量为 0 的音响不发波
        for (const sp of state.speakers) {
          const strength = clamp(speakerTarget(sp) * 1.6, 0, 1);
          if (strength < 0.04) continue;
          const w = worldPos(sp);
          waves.push({ x: w.x, z: w.z, age: 0, ttl: 1.9, strength });
        }
        if (waves.length > 64) waves.splice(0, waves.length - 64);
      }
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      waves[i].age += dt;
      if (waves[i].age >= waves[i].ttl) waves.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   * 相机动画 / rAF
   * ------------------------------------------------------------------ */
  function stepCamera(dt) {
    if (REDUCED) {
      CAM.yaw = CAM_T.yaw;
      CAM.pitch = CAM_T.pitch;
      CAM.zoom = CAM_T.zoom;
      return;
    }
    // 松手后的惯性：速度指数衰减，继续把目标角往前推
    if (!orbit && (Math.abs(camVel.yaw) > 0.002 || Math.abs(camVel.pitch) > 0.002)) {
      CAM_T.yaw += camVel.yaw * dt;
      CAM_T.pitch = clamp(CAM_T.pitch + camVel.pitch * dt, PITCH_MIN, PITCH_MAX);
      const decay = Math.pow(0.06, dt);
      camVel.yaw *= decay;
      camVel.pitch *= decay;
    }
    // 帧率无关的缓动：每帧追上一部分目标
    const k = 1 - Math.pow(0.0009, dt);
    CAM.yaw += (CAM_T.yaw - CAM.yaw) * k;
    CAM.pitch += (CAM_T.pitch - CAM.pitch) * k;
    CAM.zoom += (CAM_T.zoom - CAM.zoom) * k;
  }

  function frame(ts) {
    if (!anim.on) return;
    const dt = clamp((ts - anim.last) / 1000, 0, 0.06);
    anim.last = ts;
    stepCamera(dt);
    stepWaves(dt);
    stepLevel();
    drawScene();

    if (els && els.level) {
      const v = Math.round(level * 1000) / 1000;
      if (v !== anim.level) {
        anim.level = v;
        els.level.style.transform = `scaleX(${v})`;
      }
    }
    anim.raf = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (anim.on) return;
    if (!state.open) return;
    anim.on = true;
    anim.last = performance.now();
    anim.raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    anim.on = false;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.raf = 0;
  }

  function resetCamera() {
    CAM_T.yaw = 0;
    CAM_T.pitch = PITCH_DEF;
    CAM_T.zoom = 1;
    camVel.yaw = 0;
    camVel.pitch = 0;
    if (REDUCED) {
      CAM.yaw = 0; CAM.pitch = PITCH_DEF; CAM.zoom = 1;
    }
  }

  /* ------------------------------------------------------------------ *
   * UI 构建
   * ------------------------------------------------------------------ */
  function build() {
    readPalette();

    root = document.createElement('div');
    root.className = 'spz';
    root.id = 'lizi-spatial';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'spz-title');
    root.innerHTML = `
      <div class="spz__sheet">
        <header class="spz__head">
          <div>
            <h2 class="spz__title" id="spz-title">360° 空间音频</h2>
            <p class="spz__sub">中间是你。把音响拖到任意方位、任意远近和高度，耳机里听到的方向会跟着变。</p>
          </div>
          <button class="spz__x" id="spz-x" type="button" aria-label="关闭空间音频">${CLOSE_SVG}</button>
        </header>

        <div class="spz__body">
          <div class="spz__stage-wrap">
            <div class="spz__stage" id="spz-stage">
              <canvas class="spz__canvas" id="spz-canvas" aria-hidden="true"></canvas>
              <div class="spz__spks" id="spz-spks"></div>
              <div class="spz__cam">
                <span class="spz__cam-v" id="spz-cam-v" aria-hidden="true"></span>
                <button class="spz__cam-r" id="spz-reset" type="button">复位视角</button>
              </div>
            </div>
            <p class="spz__stage-hint">拖动空白处旋转视角 · 滚轮缩放 · 拖动音响改方位与远近 · 双击复位</p>
          </div>

          <aside class="spz__side">
            <section class="spz__sec">
              <div class="spz__sec-h">
                <h3>音源</h3>
                <span class="spz__small" id="spz-src-hint"></span>
              </div>
              <select class="spz__sel" id="spz-src" aria-label="音源">
                <option value="test">内置测试循环</option>
                <option value="song">当前歌曲</option>
              </select>
              <div class="spz__transport">
                <button class="spz__btn--play" id="spz-play" type="button" aria-pressed="false">
                  <svg class="spz__i-play" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.2v13.6L19 12z"/>
                  </svg>
                  <svg class="spz__i-pause" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <rect x="7" y="5" width="3.6" height="14" rx="1"/>
                    <rect x="13.4" y="5" width="3.6" height="14" rx="1"/>
                  </svg>
                  <span id="spz-play-txt">播放</span>
                </button>
                <label class="spz__master">
                  <span>总音量</span>
                  <input id="spz-master" type="range" min="0" max="100" step="1" value="80">
                </label>
              </div>
              <div class="spz__meter" aria-hidden="true"><i id="spz-level"></i></div>
              <p class="spz__msg" id="spz-msg" role="status"></p>
            </section>

            <section class="spz__sec">
              <div class="spz__sec-h">
                <h3>音响</h3>
                <button class="spz__btn--sm" id="spz-add" type="button">+ 加音响</button>
              </div>
              <ul class="spz__list" id="spz-list"></ul>
              <p class="spz__small spz__count" id="spz-count"></p>
            </section>

            <p class="spz__hint">
              HRTF 只有戴耳机才容易听出前后；外放音箱只能分辨左右。
              左右声道不是 3D，前后感来自头部相关传输函数。
            </p>
          </aside>
        </div>
      </div>`;

    document.body.appendChild(root);

    cvs = root.querySelector('#spz-canvas');
    g = cvs.getContext('2d');

    els = {
      stage: root.querySelector('#spz-stage'),
      spks: root.querySelector('#spz-spks'),
      list: root.querySelector('#spz-list'),
      src: root.querySelector('#spz-src'),
      srcHint: root.querySelector('#spz-src-hint'),
      play: root.querySelector('#spz-play'),
      playTxt: root.querySelector('#spz-play-txt'),
      master: root.querySelector('#spz-master'),
      msg: root.querySelector('#spz-msg'),
      add: root.querySelector('#spz-add'),
      count: root.querySelector('#spz-count'),
      level: root.querySelector('#spz-level'),
      camV: root.querySelector('#spz-cam-v'),
      reset: root.querySelector('#spz-reset'),
    };

    root.querySelector('#spz-x').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    els.play.addEventListener('click', togglePlay);
    els.add.addEventListener('click', addSpeaker);
    els.src.addEventListener('change', () => switchSource(els.src.value));
    els.master.addEventListener('input', () => {
      state.master = Number(els.master.value) / 100;
      if (masterGain && ctx) {
        try { masterGain.gain.setTargetAtTime(state.master, ctx.currentTime, 0.03); } catch { /* noop */ }
      }
    });

    els.list.addEventListener('click', (e) => {
      const li = e.target.closest('.spz__item');
      if (!li) return;
      const id = Number(li.dataset.id);
      if (e.target.closest('.spz__del')) {
        removeSpeaker(id);
        return;
      }
      if (e.target.closest('.spz__item-main')) selectSpeaker(id);
    });

    // 四个滑杆走同一套事件：角度 / 距离 / 仰角 / 音量
    els.list.addEventListener('input', (e) => {
      const li = e.target.closest('.spz__item');
      if (!li) return;
      const sp = findSpeaker(Number(li.dataset.id));
      if (!sp) return;
      const t = e.target;
      if (t.classList.contains('spz__vol')) {
        sp.vol = Number(t.value) / 100;
        updateGain(sp);
        const out = li.querySelector('[data-out="vol"]');
        if (out) out.textContent = `${Math.round(sp.vol * 100)}%`;
        return;
      }
      selectSpeaker(sp.id);
      if (t.classList.contains('spz__ang')) sp.angle = normDeg(Number(t.value));
      else if (t.classList.contains('spz__dis')) sp.distance = clamp(Number(t.value), MIN_DIST, MAX_DIST);
      else if (t.classList.contains('spz__elv')) sp.elevation = clamp(Number(t.value), 0, MAX_ELEV);
      else return;
      syncSpeaker(sp.id);
    });

    // 舞台：空白处拖动 = 转视角
    els.stage.addEventListener('pointerdown', onStageDown);
    els.stage.addEventListener('pointermove', onStageMove);
    els.stage.addEventListener('pointerup', onStageUp);
    els.stage.addEventListener('pointercancel', onStageUp);
    els.stage.addEventListener('wheel', onWheel, { passive: false });
    els.stage.addEventListener('dblclick', (e) => {
      if (e.target.closest('.spz__spk, .spz__cam')) return;
      resetCamera();
    });
    els.reset.addEventListener('pointerdown', (e) => e.stopPropagation());
    els.reset.addEventListener('click', resetCamera);

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(els.stage);
    }

    built = true;
  }

  function createSpeakerNode(sp) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spz__spk';
    btn.dataset.id = String(sp.id);
    btn.innerHTML = `
      <span class="spz__spk-lb" aria-hidden="true"><b></b><i></i></span>`;

    btn.addEventListener('pointerdown', (e) => beginDrag(e, sp.id));
    btn.addEventListener('pointermove', onDragMove);
    btn.addEventListener('pointerup', endDrag);
    btn.addEventListener('pointercancel', endDrag);
    btn.addEventListener('keydown', (e) => onNodeKey(e, sp.id));
    btn.addEventListener('click', (e) => {
      // 键盘 Enter/Space 触发 click（detail=0）时选中；鼠标拖动已在 pointerdown 选中
      if (e.detail === 0) selectSpeaker(sp.id);
    });

    return btn;
  }

  function ensureStageNodes() {
    const ids = new Set(state.speakers.map((s) => s.id));
    for (const [id, node] of Array.from(nodeEls.entries())) {
      if (!ids.has(id)) {
        node.remove();
        nodeEls.delete(id);
      }
    }
    for (const sp of state.speakers) {
      let node = nodeEls.get(sp.id);
      if (!node) {
        node = createSpeakerNode(sp);
        nodeEls.set(sp.id, node);
        els.spks.appendChild(node);
      }
    }
  }

  function updateSpeakerNode(node, sp, index) {
    const label = placementText(sp);
    const b = node.querySelector('.spz__spk-lb b');
    const i = node.querySelector('.spz__spk-lb i');
    if (b) b.textContent = `音响 ${index + 1} · ${dirName(sp.angle)}`;
    if (i) i.textContent = `${angleText(sp.angle)} · ${sp.distance.toFixed(1)} m · 仰 ${Math.round(sp.elevation)}°`;

    const on = sp.id === state.selected;
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-pressed', String(on));
    node.setAttribute('aria-label',
      `音响 ${index + 1}：${label}。左右方向键调角度，上下方向键调远近，PageUp / PageDown 调仰角。`);
  }

  function updateSpeakerDomAll() {
    state.speakers.forEach((sp, i) => {
      const node = nodeEls.get(sp.id);
      if (node) updateSpeakerNode(node, sp, i);
      const li = els.list.querySelector(`.spz__item[data-id="${sp.id}"]`);
      if (li) updateListItem(li, sp, i);
    });
  }

  function updateListItem(li, sp, index) {
    const n = li.querySelector('.spz__item-n');
    const d = li.querySelector('.spz__item-d');
    if (n) n.textContent = `音响 ${index + 1}`;
    if (d) d.textContent = placementText(sp);

    const ang = li.querySelector('.spz__ang');
    const dis = li.querySelector('.spz__dis');
    const elv = li.querySelector('.spz__elv');
    const vol = li.querySelector('.spz__vol');
    // 用 floor 而不是 round：359.7° 落在滑杆最右端，别绕回 0 让手柄跳一下
    if (ang) ang.value = String(Math.floor(normDeg(sp.angle)) % 360);
    if (dis) dis.value = sp.distance.toFixed(2);
    if (elv) elv.value = String(Math.round(sp.elevation));
    if (vol) vol.value = String(Math.round(sp.vol * 100));

    const oa = li.querySelector('[data-out="angle"]');
    const od = li.querySelector('[data-out="dist"]');
    const oe = li.querySelector('[data-out="elev"]');
    const ov = li.querySelector('[data-out="vol"]');
    if (oa) oa.textContent = angleText(sp.angle);
    if (od) od.textContent = `${sp.distance.toFixed(1)} m`;
    if (oe) oe.textContent = `${Math.round(sp.elevation)}°`;
    if (ov) ov.textContent = `${Math.round(sp.vol * 100)}%`;
  }

  function rebuildList() {
    const n = state.speakers.length;
    els.list.innerHTML = state.speakers.map((sp, i) => `
      <li class="spz__item" data-id="${sp.id}">
        <div class="spz__item-top">
          <button class="spz__item-main" type="button">
            <span class="spz__item-n">音响 ${i + 1}</span>
            <span class="spz__item-d">${placementText(sp)}</span>
          </button>
          <button class="spz__del" type="button" aria-label="删除音响 ${i + 1}"${n <= 1 ? ' disabled' : ''}>×</button>
        </div>
        <div class="spz__ctrls">
          <label class="spz__ctr"><span>方位</span>
            <input class="spz__ang" type="range" min="0" max="359" step="1"
              value="${Math.floor(normDeg(sp.angle)) % 360}" aria-label="音响 ${i + 1} 方位角">
            <span class="spz__val" data-out="angle">${angleText(sp.angle)}</span></label>
          <label class="spz__ctr"><span>距离</span>
            <input class="spz__dis" type="range" min="${MIN_DIST}" max="${MAX_DIST}" step="0.05"
              value="${sp.distance.toFixed(2)}" aria-label="音响 ${i + 1} 距离">
            <span class="spz__val" data-out="dist">${sp.distance.toFixed(1)} m</span></label>
          <label class="spz__ctr"><span>仰角</span>
            <input class="spz__elv" type="range" min="0" max="${MAX_ELEV}" step="1"
              value="${Math.round(sp.elevation)}" aria-label="音响 ${i + 1} 仰角">
            <span class="spz__val" data-out="elev">${Math.round(sp.elevation)}°</span></label>
          <label class="spz__ctr"><span>音量</span>
            <input class="spz__vol" type="range" min="0" max="100" step="1"
              value="${Math.round(sp.vol * 100)}" aria-label="音响 ${i + 1} 音量">
            <span class="spz__val" data-out="vol">${Math.round(sp.vol * 100)}%</span></label>
        </div>
      </li>`).join('');
    updateSelection();
  }

  function updateSelection() {
    nodeEls.forEach((node, id) => {
      const on = id === state.selected;
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-pressed', String(on));
    });
    els.list.querySelectorAll('.spz__item').forEach((li) => {
      li.classList.toggle('is-on', Number(li.dataset.id) === state.selected);
    });
  }

  function updateCount() {
    const n = state.speakers.length;
    els.add.disabled = n >= MAX_SPEAKERS;
    els.count.textContent = `${n} / ${MAX_SPEAKERS} · 拖动音响调方位，滑杆可精调`;
  }

  function updateTransport() {
    els.play.classList.toggle('is-on', state.playing);
    els.play.setAttribute('aria-pressed', String(state.playing));
    els.playTxt.textContent = state.playing ? '暂停' : '播放';
    els.stage.classList.toggle('is-live', state.playing);
  }

  function setMsg(text, isErr) {
    if (!els || !els.msg) return;
    els.msg.textContent = text || '';
    els.msg.classList.toggle('is-err', !!isErr);
  }

  function currentTrackInfo() {
    const P = mainPlayer();
    const a = P && P.audio;
    // 判据不变：活动 deck 上必须真的有 src，fetch + decodeAudioData 才有东西可解。
    if (!a || !a.src) return null;
    const q = P.state && P.state.queue;
    const tr = q && q[P.state.index];
    return {
      src: a.src,
      name: tr && (tr.name || tr.title) || '',
      artist: tr && (tr.artists || tr.artist) || '',
    };
  }

  /* 浮层开着时，主播放器换歌 / 换源，提示要自己刷新。
     player.js 的 on() 只是把回调塞进内部数组，没有返回取消函数，也没有 off()，
     所以这里用一个 active 标记做「软解除」：close() 置 false，回调先看标记。
     回调只挂一次，之后再打开浮层只是把同一个标记重新点亮，不会越积越多。 */
  let hintToken = null;
  function subscribePlayerHints() {
    if (hintToken) { hintToken.active = true; return; }
    const P = mainPlayer();
    if (!P || typeof P.on !== 'function') return;   // 播放器还没就绪，下次打开再试
    const token = hintToken = { active: true };
    const refresh = () => {
      if (!token.active || !state.open) return;
      updateSourceHint();
      // 只更新提示，不自动开播 —— 播放始终交给用户点「播放」。
      if (state.source === 'song' && !state.playing && currentTrackInfo()) {
        setMsg('当前歌曲已就绪。');
      }
    };
    try { P.on('trackchange', refresh); } catch { /* noop */ }
    try { P.on('source', refresh); } catch { /* noop */ }
  }
  function unsubscribePlayerHints() {
    if (hintToken) hintToken.active = false;
  }

  function updateSourceHint() {
    const info = currentTrackInfo();
    const opt = els.src.querySelector('option[value="song"]');
    if (opt) {
      opt.disabled = !info;
      opt.textContent = info ? '当前歌曲' : '当前歌曲（播放器里没有歌）';
    }
    if (!info && state.source === 'song') {
      state.source = 'test';
      els.src.value = 'test';
    }
    els.srcHint.textContent = info
      ? (info.name ? `《${info.name}》` : '已就绪')
      : '没有可用的当前歌曲';
    els.srcHint.title = info ? [info.name, info.artist].filter(Boolean).join(' · ') : '';
  }

  /** 一处改动 → 同步 Panner / 舞台标签 / 列表读数，拖动和滑杆都走这里 */
  function syncSpeaker(id) {
    const sp = findSpeaker(id);
    if (!sp) return;
    const rec = audioSpk.get(sp.id);
    if (rec && ctx) setPannerPos(rec.panner, sp, false);
    const index = state.speakers.indexOf(sp);
    const node = nodeEls.get(sp.id);
    if (node) updateSpeakerNode(node, sp, index);
    const li = els.list.querySelector(`.spz__item[data-id="${sp.id}"]`);
    if (li) updateListItem(li, sp, index);
  }

  /* ------------------------------------------------------------------ *
   * 转动视角
   * ------------------------------------------------------------------ */
  function onStageDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('.spz__spk, .spz__cam')) return;
    orbit = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
    };
    camVel.yaw = 0;
    camVel.pitch = 0;
    try { els.stage.setPointerCapture(e.pointerId); } catch { /* noop */ }
    els.stage.classList.add('is-rot');
    e.preventDefault();
  }

  function onStageMove(e) {
    if (!orbit || e.pointerId !== orbit.pointerId) return;
    const now = performance.now();
    const dt = Math.max(0.008, (now - orbit.lastT) / 1000);
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.lastT = now;

    // 手往右拖 = 场景往右转 = 相机往左绕
    const dYaw = -dx * 0.0068;
    const dPitch = -dy * 0.0042;
    CAM_T.yaw += dYaw;
    CAM_T.pitch = clamp(CAM_T.pitch + dPitch, PITCH_MIN, PITCH_MAX);
    camVel.yaw = clamp(dYaw / dt * 0.5, -3, 3);
    camVel.pitch = clamp(dPitch / dt * 0.5, -2, 2);

    if (REDUCED) {
      CAM.yaw = CAM_T.yaw;
      CAM.pitch = CAM_T.pitch;
    }
    e.preventDefault();
  }

  function onStageUp(e) {
    if (!orbit) return;
    if (e && e.pointerId != null && e.pointerId !== orbit.pointerId) return;
    try { els.stage.releasePointerCapture(orbit.pointerId); } catch { /* noop */ }
    els.stage.classList.remove('is-rot');
    orbit = null;
    if (REDUCED) {
      camVel.yaw = 0;
      camVel.pitch = 0;
    }
  }

  function onWheel(e) {
    if (!state.open) return;
    e.preventDefault();
    CAM_T.zoom = clamp(CAM_T.zoom * Math.exp(-e.deltaY * 0.0014), ZOOM_MIN, ZOOM_MAX);
    if (REDUCED) CAM.zoom = CAM_T.zoom;
  }

  /* ------------------------------------------------------------------ *
   * 拖动音响 / 键盘
   * ------------------------------------------------------------------ */
  function selectSpeaker(id) {
    if (!findSpeaker(id)) return;
    state.selected = id;
    updateSelection();
  }

  function beginDrag(e, id) {
    e.stopPropagation();               // 不和舞台的旋转抢手势
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sp = findSpeaker(id);
    if (!sp) return;
    selectSpeaker(id);
    drag = { id, pointerId: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    e.currentTarget.classList.add('is-drag');
    try { e.currentTarget.focus({ preventScroll: true }); } catch { /* noop */ }
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const sp = findSpeaker(drag.id);
    if (!sp) return;

    // 屏幕点反投到地面：视角转过之后，拖拽方向依然跟着地面走
    const hit = groundPoint(e.clientX, e.clientY);
    if (hit) {
      let deg = Math.atan2(-hit.x, -hit.z) / DEG;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;   // Shift 吸附 15°
      sp.angle = normDeg(deg);
      sp.distance = clamp(Math.hypot(hit.x, hit.z), MIN_DIST, MAX_DIST);
      syncSpeaker(sp.id);
    }
    e.preventDefault();
  }

  function endDrag(e) {
    if (!drag) return;
    if (e && e.pointerId != null && e.pointerId !== drag.pointerId) return;
    const node = nodeEls.get(drag.id);
    if (node) {
      node.classList.remove('is-drag');
      try { node.releasePointerCapture(drag.pointerId); } catch { /* noop */ }
    }
    drag = null;
  }

  function onNodeKey(e, id) {
    const sp = findSpeaker(id);
    if (!sp) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (state.speakers.length > 1) removeSpeaker(id);
      return;
    }

    // 角度向左增大，所以左方向键是 +step（屏幕上是逆时针）
    const step = e.shiftKey ? 15 : 5;
    let handled = true;
    if (e.key === 'ArrowLeft') sp.angle = normDeg(sp.angle + step);
    else if (e.key === 'ArrowRight') sp.angle = normDeg(sp.angle - step);
    else if (e.key === 'ArrowUp') sp.distance = clamp(sp.distance + 0.15, MIN_DIST, MAX_DIST);
    else if (e.key === 'ArrowDown') sp.distance = clamp(sp.distance - 0.15, MIN_DIST, MAX_DIST);
    else if (e.key === 'PageUp') sp.elevation = clamp(sp.elevation + 6, 0, MAX_ELEV);
    else if (e.key === 'PageDown') sp.elevation = clamp(sp.elevation - 6, 0, MAX_ELEV);
    else handled = false;
    if (!handled) return;

    e.preventDefault();
    selectSpeaker(id);
    syncSpeaker(id);
  }

  /* ------------------------------------------------------------------ *
   * 增删音响
   * ------------------------------------------------------------------ */
  function addSpeaker() {
    if (state.speakers.length >= MAX_SPEAKERS) {
      setMsg('最多 4 个音响');
      return;
    }
    const sp = makeSpeaker(nextFreeAngle(), 2.2, 0);
    state.speakers.push(sp);
    state.selected = sp.id;

    if (ctx) syncSpeakerAudio();
    ensureStageNodes();
    rebuildList();
    updateSpeakerDomAll();
    updateSelection();
    updateCount();
    setMsg(`已加入音响 ${state.speakers.length} · 拖到想放的位置`);

    const node = nodeEls.get(sp.id);
    if (node) try { node.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function removeSpeaker(id) {
    if (state.speakers.length <= 1) return;
    const i = state.speakers.findIndex((s) => s.id === id);
    if (i < 0) return;

    state.speakers.splice(i, 1);
    if (state.selected === id) {
      state.selected = state.speakers[Math.max(0, i - 1)].id;
    }

    if (ctx) {
      removeSpeakerAudio(id);
      syncSpeakerAudio();   // 剩余音响的 1/√N 补偿重新算
    }
    ensureStageNodes();
    rebuildList();
    updateSpeakerDomAll();
    updateSelection();
    updateCount();
    setMsg(`已删除音响，剩余 ${state.speakers.length} 个`);

    const node = nodeEls.get(state.selected);
    if (node) try { node.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  /* ------------------------------------------------------------------ *
   * 打开 / 关闭
   * ------------------------------------------------------------------ */
  function open() {
    if (!built) build();
    if (state.open) {
      els.play.focus({ preventScroll: true });
      return;
    }

    state.open = true;
    lastFocus = document.activeElement;
    root.hidden = false;
    document.addEventListener('keydown', onDocKey, true);

    if (!state.speakers.length) resetSpeakers();
    if (!findSpeaker(state.selected)) state.selected = state.speakers[0].id;

    ensureStageNodes();
    rebuildList();
    updateSpeakerDomAll();
    updateSelection();
    updateCount();

    els.master.value = String(Math.round(state.master * 100));
    updateSourceHint();
    subscribePlayerHints();   // 打开期间主播放器换歌/开始播放 → 提示自己刷新
    updateTransport();
    setMsg('按「播放」开始。拖动空白处转视角，拖动音响改方位。');
    els.play.focus({ preventScroll: true });

    // 浮层隐藏时 stage 尺寸是 0，必须等显示后再量一次
    resizeCanvas();
    drawScene();
    startLoop();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.playing = false;

    stopLoop();
    root.hidden = true;
    unsubscribePlayerHints();
    document.removeEventListener('keydown', onDocKey, true);
    if (drag) {
      const node = nodeEls.get(drag.id);
      try {
        if (node && node.hasPointerCapture && node.hasPointerCapture(drag.pointerId)) {
          node.releasePointerCapture(drag.pointerId);
        }
      } catch { /* noop */ }
    }
    if (orbit) {
      try { els.stage.releasePointerCapture(orbit.pointerId); } catch { /* noop */ }
      els.stage.classList.remove('is-rot');
    }
    drag = null;
    orbit = null;
    camVel.yaw = 0;
    camVel.pitch = 0;
    nodeEls.forEach((node) => node.classList.remove('is-drag'));

    restoreMainPlayer();
    teardownAudio();
    updateTransport();

    const back = lastFocus && lastFocus.isConnected && !lastFocus.closest('[hidden]')
      ? lastFocus
      : document.querySelector('[data-tool="box"]');
    if (back) try { back.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function onDocKey(e) {
    if (e.key !== 'Escape' || !state.open) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // 浮层被切到后台时停掉 rAF：转场景的持续绘制不该在看不见的时候跑
  document.addEventListener('visibilitychange', () => {
    if (!state.open) return;
    if (document.hidden) stopLoop();
    else startLoop();
  });

  /* ------------------------------------------------------------------ *
   * 对外
   * ------------------------------------------------------------------ */
  return { open, close };
})();

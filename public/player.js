/**
 * 播放器引擎
 *
 * 三件事值得说明：
 *  1) 队列播放 + 播放模式（顺序 / 单曲 / 随机）
 *  2) 歌词：解析 LRC（含翻译行），按时间滚动并高亮
 *  3) 降级：网易云对大量歌曲返回 url:null（VIP/无版权）。这时不报错卡住，
 *     而是生成一段「演示音轨」继续放 —— 界面、歌词、进度条全都能正常走完，
 *     并在播放条上打一个「演示音轨」角标说明这不是真歌。
 */
const Player = (() => {
  /* ------------------------------------------------------------------ *
   * 双 deck
   *
   * 自动过渡需要两条真实音频同时出声：一条淡出、一条淡入。
   * 所以这里不再只有单个 Audio 单例，而是两条元素轮流当「活动元素」：
   *   audio    —— 当前活动元素。进度、歌词、暂停、拖动、上一首/下一首都作用在它身上。
   *   idleDeck —— 空闲元素，预载下一首；过渡时它是进场那条。
   * 过渡结束（Glide.commitIncoming）才交换两者，对外看到的仍然是同一个 Player。
   * 两条元素各自只会 createMediaElementSource 一次，见 beat.js 的 deckNodes。
   * ------------------------------------------------------------------ */
  function makeDeck() {
    const el = new Audio();
    el.preload = 'metadata';
    // 必须在设 src 之前设 crossOrigin：跨域音频没有 CORS 时，
    // Web Audio 的分析器会拿到全 0（画布/音频图被"污染"），节拍检测就废了。
    // 网易云 CDN 返回 Access-Control-Allow-Origin: *，所以这条路走得通。
    el.crossOrigin = 'anonymous';
    return el;
  }
  const deckA = makeDeck();
  const deckB = makeDeck();
  let audio = deckA;                 // 活动元素（外部读到的是它）
  let idleDeck = deckB;              // 空闲 / 预载 / 进场元素
  let prepareSeq = 0;                // 预载代次：自动预取和实验室试听撞车时，只保留最后一次

  const state = {
    queue: [],        // 当前曲目数组
    index: -1,        // 当前下标
    playing: false,
    mode: 'order',    // order | single | shuffle
    lyric: [],        // [{ t, text, tr }]
    lyricIndex: -1,
    objectUrl: null,  // 演示音轨的 blob url，切换时要 revoke
    token: 0,         // 异步竞态令牌：快速切歌时丢弃过期回调
  };

  const listeners = {};
  const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
  const emit = (evt, data) => (listeners[evt] || []).forEach((f) => f(data));

  /* ------------------------------------------------------------------ *
   * 队列持久化
   *
   * 以前队列只在内存里：退出 / 刷新后 state.queue 是空的，大厅冷启动
   * 又只把「上次那首」塞回队列（app.js 的 playQueue([last])），于是
   * 下一首 / 上一首永远停在那一首上。这里把队列本身写进 localStorage，
   * 启动时恢复，但**不自动播放**（浏览器 / WebView 有自动播放限制，
   * 也尊重用户没点播放）。
   *
   * 只存曲目元数据：播放地址由 fetchTrackUrl 每次按 id 重新解析，
   * 所以网易云 / QQ 的临时直链过期不会把整个队列带坏。
   * ------------------------------------------------------------------ */
  const QUEUE_KEY = 'lizi.queue.v1';
  const QUEUE_VERSION = 1;
  const QUEUE_MODES = ['order', 'loop', 'single', 'shuffle'];

  /** 曲目的稳定身份：同 id 不同平台不能算同一首（酷我 / 网易云都是数字 id） */
  function trackIdentity(t) {
    if (!t || typeof t !== 'object') return '';
    const key = t.id != null ? t.id : (t.mid != null ? t.mid : t.hash);
    if (key == null || key === '') return '';
    return `${t.source || 'netease'}:${key}`;
  }

  /** 临时直链不落盘：恢复后 fetchTrackUrl 会按 id 重新取址 */
  function storableTrack(t) {
    const out = { ...t };
    delete out.url;
    delete out.audioUrl;
    delete out.playUrl;
    delete out.srcUrl;
    return out;
  }

  function saveQueue() {
    try {
      const q = state.queue;
      if (!Array.isArray(q) || !q.length) {
        localStorage.removeItem(QUEUE_KEY);
        return;
      }
      const cur = q[state.index];
      localStorage.setItem(QUEUE_KEY, JSON.stringify({
        v: QUEUE_VERSION,
        queue: q.map(storableTrack),
        index: state.index,
        mode: state.mode,
        current: trackIdentity(cur),
        at: Date.now(),
      }));
    } catch { /* 隐私模式 / 配额满：只影响下次启动 */ }
  }

  function restoreQueue() {
    let raw = null;
    try { raw = localStorage.getItem(QUEUE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (!data || data.v !== QUEUE_VERSION || !Array.isArray(data.queue)) throw new Error('bad shape');
      /* 坏条目（缺 id / 不是对象）单独跳过，不能让一条脏数据废掉整个队列 */
      const q = data.queue.filter((t) => !!trackIdentity(t));
      if (!q.length) throw new Error('empty');
      let idx = Number.isInteger(data.index) ? data.index : 0;
      if (idx < 0 || idx >= q.length) idx = 0;
      /* 按当前曲目 id 再定位一次：过滤掉坏条目后下标可能已经漂了 */
      if (data.current) {
        const j = q.findIndex((t) => trackIdentity(t) === data.current);
        if (j >= 0) idx = j;
      }
      state.queue = q;
      state.index = idx;
      state.playing = false;                 // 恢复队列 ≠ 恢复播放
      if (QUEUE_MODES.includes(data.mode)) state.mode = data.mode;
    } catch {
      /* 旧版本 / 数据结构变了 / 存储损坏：静默清掉，不影响启动 */
      try { localStorage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
    }
  }

  /* 演示音轨是 blob URL，按元素分开记：过渡期间两条 deck 可能各有一个。
     替换某条元素的 src 前必须先 revoke 它自己的旧 blob。 */
  const deckBlobs = new WeakMap();   // element → blob url
  function revokeDeckBlob(el) {
    const u = deckBlobs.get(el);
    if (u) { URL.revokeObjectURL(u); deckBlobs.delete(el); }
    if (el === audio) state.objectUrl = null;
  }

  /** 交叉淡化用的 deck 增益。Beat 还没建图时返回 null，调用方要能接受。 */
  function setDeckGain(el, v) {
    try {
      const g = Beat.deckGain && Beat.deckGain(el);
      if (!g) return;
      g.gain.cancelScheduledValues(0);
      g.gain.value = v;
    } catch { /* 图还没建好就算了，下一次再设 */ }
  }

  function normalizeIndex(i) {
    return ((i % state.queue.length) + state.queue.length) % state.queue.length;
  }

  /** 用户手动操作（切歌/暂停/拖动）要先把进行中的过渡收掉，别让两条 deck 打架 */
  function cancelGlide(reason) {
    if (typeof window === 'undefined' || !window.Glide) return;
    try { window.Glide.cancel(reason); } catch { /* 过渡引擎自己的异常不能拦住播放 */ }
  }

  /* ------------------------------------------------------------------ *
   * 演示音轨：用 WebAudio 离线渲染一段和弦琶音，转成 wav blob
   * 只在拿不到真实播放地址时使用
   * ------------------------------------------------------------------ */
  function makeDemoTrack(seconds = 40, seed = 1) {
    const sr = 22050;
    const n = Math.floor(sr * seconds);
    const buf = new Float32Array(n);

    // 用歌曲 id 当种子，不同的歌听起来不一样
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

    // 简单和弦进行（A 小调味道），每 2 秒换一次
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 207.65, 246.94]];
    const barLen = 2;

    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const bar = Math.floor(t / barLen) % chords.length;
      const chord = chords[bar];
      let v = 0;
      for (let k = 0; k < chord.length; k++) {
        v += Math.sin(2 * Math.PI * chord[k] * t) * 0.13;
        // 轻微失谐，听起来更像乐器而不是纯音
        v += Math.sin(2 * Math.PI * chord[k] * 1.004 * t) * 0.07;
      }
      // 每 0.5 秒一个琶音点缀
      const step = Math.floor(t / 0.5);
      const note = chord[step % chord.length] * 2;
      const env = Math.max(0, 1 - ((t % 0.5) / 0.5)) ** 3;
      v += Math.sin(2 * Math.PI * note * t) * 0.18 * env;

      // 整体包络：淡入淡出，避免爆音
      const fade = Math.min(1, t / 1.5, (seconds - t) / 2);
      v *= Math.max(0, fade);
      // 加一点噪声当"空气感"
      v += (rnd() - 0.5) * 0.006;
      buf[i] = Math.max(-1, Math.min(1, v));
    }

    // 打包成 16-bit PCM WAV
    const bytes = n * 2;
    const ab = new ArrayBuffer(44 + bytes);
    const dv = new DataView(ab);
    const wr = (o, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); wr(8, 'WAVE');
    wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, 'data'); dv.setUint32(40, bytes, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, buf[i] * 32767, true);

    return URL.createObjectURL(new Blob([ab], { type: 'audio/wav' }));
  }

  /* ------------------------------------------------------------------ *
   * 从封面取色
   * 取色必须走 canvas，而网易云封面有防盗链（缺 CORS 头），
   * 直接用原图会污染 canvas、getImageData 抛 SecurityError。
   * 所以走自己的 /api/img 代理：同源，画布不会被污染。
   * ------------------------------------------------------------------ */
  const colorCache = new Map();
  const pendingPalette = new Map();
  const COLOR_SIDE = 32;

  /* ------------------------------------------------------------------ *
   * 封面取色（2026-11-08 起全站统一用「OKLCH 聚类 k=4」）
   *
   * 和 color-lab.html 的 C 算法逐行一致：
   *   1. 32×32 采样，丢掉低透明度和纯白高光；
   *   2. 所有有效像素转成真实 OKLCH（不是 RGB 欧氏距离）；
   *   3. k=4，初始中心按明度四分位给；最多迭代 10 次；
   *   4. 4 个中心按明度排好，沿折线均匀取 5 档；
   *   5. 墨色按中间三档的平均相对亮度选深/浅场。
   *
   * 旧版 30° 色相桶 + RGB 平均色已经删掉。三条取色结果（行渐变 / 播放页 /
   * 大厅铺色）必须来自同一张封面、同一次聚类，才能保证转场不变色。
   * ------------------------------------------------------------------ */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const normHue = (h) => ((h % 360) + 360) % 360;
  const hueDelta = (a, b) => ((a - b + 540) % 360) - 180;

  const srgbToLin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  const rgbToHex = (rgb) =>
    '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const hexToRgb = (hex) => {
    const h = String(hex || '').replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  };

  /** 真实 OKLab/OKLCH 转换（标准矩阵）。纯转换，不夹明度/彩度。 */
  function rgbToOklch(rgb) {
    const r = srgbToLin(rgb[0]);
    const g = srgbToLin(rgb[1]);
    const b = srgbToLin(rgb[2]);
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);
    const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    const C = Math.sqrt(A * A + B * B);
    const H = C > 1e-7 ? normHue((Math.atan2(B, A) * 180) / Math.PI) : 0;
    return { L, C, H };
  }

  function oklchToRgbRaw(L, C, H) {
    const hr = (H * Math.PI) / 180;
    const A = C * Math.cos(hr);
    const B = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return [linToSrgb(r), linToSrgb(g), linToSrgb(b)];
  }

  const inGamut = (rgb) =>
    rgb[0] >= -0.0006 && rgb[0] <= 1.0006 &&
    rgb[1] >= -0.0006 && rgb[1] <= 1.0006 &&
    rgb[2] >= -0.0006 && rgb[2] <= 1.0006;

  /** OKLCH -> #hex。超出 sRGB 色域只降彩度（二分），不粗暴截断 RGB。 */
  function oklchToHex(L, C, H) {
    L = clamp(L, 0, 1);
    C = Math.max(0, C);
    H = normHue(H);
    let c = C;
    if (!inGamut(oklchToRgbRaw(L, c, H))) {
      let lo = 0;
      let hi = C;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToRgbRaw(L, mid, H))) lo = mid;
        else hi = mid;
      }
      c = lo;
    }
    return rgbToHex(oklchToRgbRaw(L, c, H).map((v) => v * 255));
  }

  const relLum = (rgb) => {
    const r = srgbToLin(rgb[0]);
    const g = srgbToLin(rgb[1]);
    const b = srgbToLin(rgb[2]);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const la = relLum(a);
    const lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  /** OKLCH 距离：明度 + 彩度 + 加权色相差。 */
  function oklchDist(a, b) {
    const dL = a.L - b.L;
    const dC = a.C - b.C;
    const dh = (hueDelta(a.H, b.H) * Math.PI) / 180;
    const dH = 2 * Math.sqrt(Math.max(a.C, 0) * Math.max(b.C, 0)) * Math.sin(dh / 2);
    return dL * dL + dC * dC + dH * dH;
  }

  /** 簇中心：L/C 算术平均，色相按彩度加权走圆周平均。 */
  function centroidOf(points) {
    if (!points.length) return { L: 0.5, C: 0, H: 0 };
    let L = 0;
    let C = 0;
    let sin = 0;
    let cos = 0;
    for (const p of points) {
      const o = p.ok;
      L += o.L;
      C += o.C;
      const w = Math.max(o.C, 0.0001);
      sin += Math.sin((o.H * Math.PI) / 180) * w;
      cos += Math.cos((o.H * Math.PI) / 180) * w;
    }
    return {
      L: L / points.length,
      C: C / points.length,
      H: C > 1e-6 ? normHue((Math.atan2(sin, cos) * 180) / Math.PI) : 0,
    };
  }

  /** 4 个中心按明度排好后，沿折线均匀取 count 档。 */
  function rampFromCenters(centers, count = 5) {
    const cs = centers.slice().sort((a, b) => a.L - b.L);
    if (!cs.length) {
      return Array.from({ length: count }, (_, i) => ({ L: 0.2 + i * 0.17, C: 0.08, H: 0 }));
    }
    if (cs.length === 1) {
      const c = cs[0];
      return Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1);
        return {
          L: clamp(c.L + (t - 0.5) * 0.34, 0.03, 0.97),
          C: c.C * (0.55 + 0.45 * Math.sin(Math.PI * t)),
          H: c.H,
        };
      });
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const pos = t * (cs.length - 1);
      const seg = Math.min(cs.length - 2, Math.floor(pos));
      const f = pos - seg;
      const a = cs[seg];
      const b = cs[seg + 1];
      out.push({
        L: a.L + (b.L - a.L) * f,
        C: a.C + (b.C - a.C) * f,
        H: normHue(a.H + hueDelta(b.H, a.H) * f),
      });
    }
    return out;
  }

  const stopsFromRamp = (ramp) => ramp.map((c) => oklchToHex(c.L, c.C, c.H));

  /** 墨色跟明暗方案走：深场白字，亮场深字；对比不足再退到纯黑/纯白。 */
  function pickInk(stops) {
    const rgbStops = stops.map(hexToRgb);
    const fieldLum =
      (relLum(rgbStops[1]) + relLum(rgbStops[2]) + relLum(rgbStops[3])) / 3;
    const field = fieldLum < 0.30 ? 'dark' : 'light';
    let ink = field === 'dark' ? '#F7F7FA' : '#121216';
    const c = contrast(hexToRgb(ink), rgbStops[2]);
    if (c < 3.0) ink = field === 'dark' ? '#FFFFFF' : '#08080A';
    // 2026-11-08：额外带出 fieldLum，铺色面板要按实际亮度分档决定白字/深字
    return { ink, field, fieldLum };
  }

  /** 一组 RGB 色（兼容旧 rememberColors 调用）摊成完整色板。 */
  function paletteFromColors(colors) {
    const ok = colors.slice(0, 3).map(rgbToOklch);
    const stops = stopsFromRamp(rampFromCenters(ok, 5));
    const inkInfo = pickInk(stops);
    const rgbStops = stops.map(hexToRgb);
    return {
      stops,
      ink: inkInfo.ink,
      field: inkInfo.field,
      // 2026-11-08：透传 fieldLum 供铺色面板判断中亮底白字
      fieldLum: inkInfo.fieldLum,
      main: rgbToHex(colors[0] || [138, 138, 138]),
      mainPct: 100,
      accent: rgbToHex(colors[0] || [138, 138, 138]),
      colors: colors.slice(0, 3).map((c) => c.slice(0, 3)),
    };
  }

  /**
   * 像素 -> 完整色板。
   * 返回 { stops[5], ink, field, main, mainPct, accent, colors[3] }。
   * colors 取 5 档里的 [2]、[3]、[4]（中间到亮端）——
   * 深端两档在播放页背景上容易接近纯黑，三色接口只给能看见的层次。
   */
  function paletteFromData(data, side) {
    const pts = [];
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      if (l > 246) continue;               // 纯白高光没有色彩信息
      ar += r; ag += g; ab += b; an++;
      pts.push({ r, g, b, ok: rgbToOklch([r, g, b]) });
    }

    // 全空（透明 / 纯白）也必须给出可用的 5 档，绝不能把 null 抛给大厅。
    const avg = an ? [ar / an, ag / an, ab / an] : [96, 116, 190];
    if (!pts.length) {
      const stops = stopsFromRamp(rampFromCenters([rgbToOklch(avg)], 5));
      const inkInfo = pickInk(stops);
      const rgbStops = stops.map(hexToRgb);
      return {
        stops,
        ink: inkInfo.ink,
        field: inkInfo.field,
        // 2026-11-08：透传 fieldLum 供铺色面板判断中亮底白字
        fieldLum: inkInfo.fieldLum,
        main: rgbToHex(avg),
        mainPct: 100,
        accent: rgbToHex(avg),
        colors: [rgbStops[2], rgbStops[3], rgbStops[4]],
        fallback: true,
      };
    }

    const k = 4;
    const sorted = pts.slice().sort((a, b) => a.ok.L - b.ok.L);
    const initial = [];
    for (let i = 0; i < k; i++) {
      const start = Math.floor((i * sorted.length) / k);
      const end = Math.floor(((i + 1) * sorted.length) / k);
      initial.push(centroidOf(sorted.slice(start, Math.max(start + 1, end))));
    }

    let centers = initial;
    let groups = [];
    let assigns = [];
    for (let iter = 0; iter < 10; iter++) {
      groups = Array.from({ length: k }, () => []);
      const nextAssign = new Array(pts.length);
      let changed = false;
      for (let i = 0; i < pts.length; i++) {
        let best = 0;
        let bestD = Infinity;
        for (let j = 0; j < k; j++) {
          const d = oklchDist(pts[i].ok, centers[j]);
          if (d < bestD) { bestD = d; best = j; }
        }
        nextAssign[i] = best;
        if (assigns[i] !== best) changed = true;
        groups[best].push(pts[i]);
      }
      assigns = nextAssign;
      centers = groups.map((g, j) => (g.length ? centroidOf(g) : centers[j]));
      if (!changed) break;
    }

    const clusters = centers.map((c, i) => ({
      ...c,
      n: groups[i].length,
      pct: (groups[i].length / an) * 100,
      score: groups[i].length * Math.max(c.C, 0.005),
    }));
    const main = clusters.slice().sort((a, b) => b.score - a.score)[0];
    const mainHex = main ? oklchToHex(main.L, main.C, main.H) : '#8a8a8a';
    const stops = stopsFromRamp(rampFromCenters(centers, 5));
    const inkInfo = pickInk(stops);
    const rgbStops = stops.map(hexToRgb);

    return {
      stops,
      ink: inkInfo.ink,
      field: inkInfo.field,
      // 2026-11-08：透传 fieldLum 供铺色面板判断中亮底白字
      fieldLum: inkInfo.fieldLum,
      main: mainHex,
      mainPct: main ? main.pct : 100,
      accent: mainHex,
      colors: [rgbStops[2], rgbStops[3], rgbStops[4]],
    };
  }

  function analyzeImage(img) {
    const n = COLOR_SIDE;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    return paletteFromData(ctx.getImageData(0, 0, n, n).data, n);
  }

  /** 已经加载好的图片直接取色（不再发一次请求）。返回 3 个 RGB 数组。 */
  function colorsFromImage(img) {
    try {
      return analyzeImage(img).colors;
    } catch {
      return null;   // 跨域或解码失败都不能影响列表
    }
  }

  const cachedPalette = (entry) => {
    if (!entry) return null;
    return Array.isArray(entry) ? paletteFromColors(entry) : entry;
  };

  /** 把完整色板（或旧的 3 色数组）塞进缓存，键就是图片 URL。
   *  同一个 URL 的 3 色接口和 5 档接口都从这里读，保证是一次聚类的结果。 */
  function rememberColors(url, palette) {
    if (!url || !palette) return;
    colorCache.set(url, Array.isArray(palette) ? paletteFromColors(palette) : palette);
  }

  function loadPalette(url) {
    if (pendingPalette.has(url)) return pendingPalette.get(url);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const pal = analyzeImage(img);
          colorCache.set(url, pal);
          resolve(pal);
        } catch {
          resolve(null);   // 取色失败就让 CSS 用默认色，不能影响播放
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }).finally(() => pendingPalette.delete(url));
    pendingPalette.set(url, p);
    return p;
  }

  /** 3 色兼容接口：返回 [RGB, RGB, RGB]，来自 stops[2]/[3]/[4]。 */
  function extractColors(url) {
    if (!url) return Promise.resolve(null);
    const cached = colorCache.get(url);
    if (cached) {
      const pal = cachedPalette(cached);
      return Promise.resolve(pal ? pal.colors : null);
    }
    return loadPalette(url).then((pal) => (pal ? pal.colors : null));
  }

  /**
   * 完整色板接口。
   *   paletteFromCover(URL)      -> Promise<{stops, ink, field, main, mainPct, ...}>
   *   paletteFromCover(已加载 img, 别名URL) -> 同步返回同一个对象（失败返回 null）
   * 大厅海报的图已经解码好，走同步分支；队列封面只有 URL，走异步分支。
   * 别名 URL 是同一张封面的另一档尺寸（例如播放页的 400px）：已经有缓存就直接用，
   * 保证大厅海报和播放页拿到的是**同一次聚类**，而不是 1200px/400px 各算一遍。
   */
  function paletteFromCover(input, aliasUrl) {
    if (typeof input === 'string') {
      const cached = colorCache.get(input);
      if (cached) return Promise.resolve(cachedPalette(cached));
      return loadPalette(input);
    }
    const img = input;
    const url = img && (img.currentSrc || img.src) || '';
    if (aliasUrl) {
      const aliasCached = colorCache.get(aliasUrl);
      if (aliasCached) return cachedPalette(aliasCached);
    }
    if (url) {
      const cached = colorCache.get(url);
      if (cached) return cachedPalette(cached);
    }
    try {
      const pal = analyzeImage(img);
      if (url) colorCache.set(url, pal);
      if (aliasUrl) colorCache.set(aliasUrl, pal);
      return pal;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * BPM：优先用网易云百科的元数据，拿不到再靠实时检测
   *
   * 网易云的常规歌曲接口**没有** BPM 字段（v3/song/detail 的全部键逐个看过），
   * 只有「歌曲百科」这个接口有：/song/play/about/block/page 的
   * SONG_PLAY_ABOUT_SONG_BASIC block 里 creativeType === 'bpm' 那条。
   * 匿名就能用，实测覆盖 9/9，而且没有实时检测的倍速歧义
   * （《自由的你》百科写 84，检测报 169 = 2×84）。
   *
   * 所以分工是：元数据给**速度**，实时检测给**相位** ——
   * 跟拍效果必须知道"第一拍落在哪"，光有速度不够。
   * 结果按歌曲 id 缓存进 localStorage，重播瞬间就有，不用再等检测收敛。
   * ------------------------------------------------------------------ */
  const BPM_CACHE_KEY = 'bpmCache';

  const readBpmCache = () => {
    try { return JSON.parse(localStorage.getItem(BPM_CACHE_KEY) || '{}'); } catch { return {}; }
  };
  function writeBpmCache(id, bpm) {
    try {
      const c = readBpmCache();
      c[id] = bpm;
      // 只留最近 300 首，别把 localStorage 撑爆
      const keys = Object.keys(c);
      if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete c[k];
      localStorage.setItem(BPM_CACHE_KEY, JSON.stringify(c));
    } catch { /* 隐私模式下写不了，忽略 */ }
  }

  async function applyWikiBpm(track, token) {
    const cached = readBpmCache()[track.id];
    if (cached) {
      Beat.lockTempo(cached, 'metadata');
      emit('bpmsource', { bpm: cached, source: 'metadata', cached: true });
      return cached;
    }
    try {
      const w = await API.songWiki(track.id);
      if (token !== state.token) return null;      // 期间又切歌了，丢弃
      if (w.bpm) {
        writeBpmCache(track.id, w.bpm);
        Beat.lockTempo(w.bpm, 'metadata');
        emit('bpmsource', { bpm: w.bpm, source: 'metadata', language: w.language, tags: w.tags || [] });
        return w.bpm;
      }
    } catch { /* 拿不到就走检测 */ }
    emit('bpmsource', { bpm: null, source: 'detected' });
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 歌词解析
   *
   * 两种格式：
   *   LRC —— 每行一个时间戳：[00:12.34]今天我 寒夜里看雪飘
   *   YRC —— 逐字，行首是 [整行起点,整行时长]，每个字后面跟 (字起点,字时长)：
   *            [12000,3000](12000,500,0)今(12500,500,0)天(13000,500,0)…
   *
   * 返回统一结构，每行：{ t, text, tr, chars? }
   *   chars 存在即表示这行有逐字时间，每项 { c, t, d }。
   * ------------------------------------------------------------------ */

  /** 解析 YRC 一行 → { t, dur, text, chars }（时间统一转成秒） */
  function parseYrcLine(line) {
    const head = line.match(/^\[(\d+),(\d+)\]/);
    if (!head) return null;
    const lineStart = +head[1];
    const lineDur = +head[2];
    const rest = line.slice(head[0].length);

    // 字与时间：(起点毫秒,时长毫秒,0)字
    const chars = [];
    const re = /\((\d+),(\d+),\d+\)([^()]*)/g;
    let m;
    while ((m = re.exec(rest))) {
      const text = m[3];
      // 全部换算成秒，和 LRC 的时间轴保持同一单位
      if (text) chars.push({ c: text, t: +m[1] / 1000, d: +m[2] / 1000 });
    }
    const text = chars.map((c) => c.c).join('').trim();
    if (!text) return null;
    return { t: lineStart / 1000, dur: lineDur / 1000, text, chars };
  }

  /** 解析普通 LRC（一行可能有多个时间戳） */
  function parseLrcLines(lrc, trMap) {
    const out = [];
    for (const line of lrc.split('\n')) {
      const stamps = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!text) continue;
      for (const m of stamps) {
        const key = `${+m[1]}:${parseFloat(m[2].replace(':', '.'))}`;
        out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text, tr: trMap.get(key) || '' });
      }
    }
    return out;
  }

  /** 翻译映射表：时间戳 → 译文 */
  function buildTrMap(tlyric) {
    const map = new Map();
    if (!tlyric) return map;
    for (const line of tlyric.split('\n')) {
      const m = line.match(/^\[(\d+):(\d+(?:[.:]\d+)?)\](.*)$/);
      if (m) map.set(`${+m[1]}:${parseFloat(m[2].replace(':', '.'))}`, m[3].trim());
    }
    return map;
  }

  /**
   * 统一入口：优先用 YRC（逐字），没有就退回 LRC。
   * @returns {{ lines: Array, format: 'yrc'|'lrc'|'none' }}
   */
  function parseLyrics({ lyric, yrc, tlyric, ytlrc }) {
    const trMap = buildTrMap(tlyric || ytlrc);

    if (yrc) {
      const lines = [];
      for (const raw of yrc.split('\n')) {
        const o = parseYrcLine(raw);
        if (!o) continue;
        // 逐字行的翻译：翻译表是按 [mm:ss.xx] 建的，用同一套 key 去找
        const total = Math.round(o.t * 100) / 100;
        const mm = Math.floor(total / 60);
        const ss = total - mm * 60;
        o.tr = trMap.get(`${mm}:${ss}`) || trMap.get(`${mm}:${ss.toFixed(2)}`) || '';
        lines.push(o);
      }
      if (lines.length) {
        lines.sort((a, b) => a.t - b.t);
        return { lines, format: 'yrc' };
      }
    }

    if (lyric) {
      const lines = parseLrcLines(lyric, trMap);
      if (lines.length) return { lines, format: 'lrc' };
    }
    return { lines: [], format: 'none' };
  }

  /** 兼容旧签名（只传 lrc 字符串） */
  function parseLRC(lrc, tlyric) {
    return parseLyrics({ lyric: lrc, tlyric }).lines;
  }

  /* ------------------------------------------------------------------ *
   * 解析播放地址
   *
   * 原 load() 里的取址逻辑原样搬出来：正常切歌和「预载下一首」都走这里，
   * 保证两条路径对 QQ / 边车 / 演示音轨的判断完全一致，不各写一套。
   * ------------------------------------------------------------------ */
  async function fetchTrackUrl(track) {
    /* 非网易云的曲目（QQ / 酷狗 / 汽水 / 波点 / Spotify）：id 和直链都在各自边车上。
       这里只做分支，具体形状由 api.js 抹平（srcLyric / srcSongUrl / srcAudio）。 */
    const src = track.source || 'netease';
    const isQQ = src === 'qq';
    const isOther = !isQQ && src !== 'netease';
    let url = null;
    let demo = false;
    let reason = '';
    let preview = false;
    let clipStartMs = 0;
    try {
      if (isQQ) {
        /* QQ 给的是 http 的 vkey 直链（会过期、CDN 挑 referer），统一走本机代理；
           没登录/没会员时上游只给试听片段，如实标 preview，不假装能放全曲。 */
        const d = await API.qqSongUrl(track.mid || track.id);
        if (d.url) {
          url = API.qqAudio(d.url);
          preview = !!d.preview;
        } else {
          reason = d.reason === 'login' ? 'vip' : 'qq-unavailable';
        }
      } else if (isOther) {
        /* 酷狗 / 汽水 / 波点 / Spotify：一样走各自代理。
           reason 原样从服务端来（login / region / drm / unavailable），
           界面据此说清楚「为什么没声音」，绝不用假音轨冒充。 */
        const d = await API.srcSongUrl(track);
        if (d && d.url) {
          url = API.srcAudio(src, d.url);
          preview = !!d.preview;
          clipStartMs = d.clipStartMs || 0;
        } else {
          reason = (d && d.reason) || 'unavailable';
        }
      } else {
        const d = await API.songUrl(track.id);
        const item = (d.data || [])[0];
        if (item?.url) url = API.neteaseAudio(item.url);
        // code -110 = 未授权。绝大多数是 VIP 专属（fee=1），登录后就能播。
        // 把这个原因带出去，界面才能告诉用户"为什么放不了"，而不是默默放演示音。
        else if (item?.code === -110) reason = 'vip';
        else reason = 'unavailable';
      }
    } catch { reason = 'network'; }

    if (!url) {
      demo = true;
      url = makeDemoTrack(40, track.id);
    }
    return { url, demo, reason, preview, clipStartMs };
  }

  /** 换歌时统一的元数据入口：trackchange + 清空歌词 + 异步拉歌词 / BPM。
   *  正常切歌和交叉淡化落点（commitIncoming）共用，避免两边显示的歌词不同步。 */
  function startTrackMeta(track, index, token) {
    const src = track.source || 'netease';
    const isQQ = src === 'qq';
    const isOther = !isQQ && src !== 'netease';

    emit('trackchange', { track, index });
    state.lyric = [];
    state.lyricIndex = -1;
    emit('lyric', { lines: [], active: -1 });

    // 歌词先拉，别等音频（QQ 认 songmid，其它边车认自己的 id）
    const lyricReq = isQQ
      ? API.qqLyric(track.mid || track.id)
      : isOther
        ? API.srcLyric(track)
        : API.lyric(track.id);
    lyricReq
      .then((d) => {
        if (token !== state.token) return;
        const { lines, format } = parseLyrics(d);
        state.lyric = lines;
        state.lyricFormat = format;
        emit('lyric', { lines, active: -1, format });
      })
      .catch(() => {});

    // BPM 元数据也并行拉：比等实时检测收敛快得多，而且没有倍速歧义
    // （只有网易云有百科接口；实时检测照常工作）
    if (src === 'netease') applyWikiBpm(track, token);
  }

  /* ------------------------------------------------------------------ *
   * 加载并播放某一首
   * ------------------------------------------------------------------ */
  async function load(i, autoplay = true) {
    cancelGlide('load');                 // 手动切歌/重载：先把进行中的过渡收掉
    if (!state.queue.length) return;
    prepareSeq++;                        // 让还在路上的预载作废
    const token = ++state.token;
    state.index = normalizeIndex(i);
    saveQueue();                         // 下一首 / 上一首 / 点队列行都会走到这里
    const track = state.queue[state.index];

    // 空闲 deck 上如果还预载着下一首，先停掉；活动元素才是这次要换的
    try { idleDeck.pause(); } catch { /* 还没开始播 */ }
    setDeckGain(idleDeck, 0);
    setDeckGain(audio, 1);

    // 节拍检测：换歌时把节拍时钟归零。
    // 必须先 reset 再 startTrackMeta —— 百科 BPM 命中缓存时会在同步阶段 lockTempo，
    // 反过来会把刚锁上的速度清掉。
    Beat.reset();
    Beat.attach(audio);
    if (Beat.setClock) Beat.setClock(audio);

    startTrackMeta(track, state.index, token);

    const data = await fetchTrackUrl(track);

    if (token !== state.token) {         // 期间又切歌了
      if (data.demo) URL.revokeObjectURL(data.url);
      return;
    }

    revokeDeckBlob(audio);
    if (data.demo) { deckBlobs.set(audio, data.url); state.objectUrl = data.url; }

    audio.preload = 'metadata';
    audio.src = data.url;
    emit('source', { demo: data.demo, track, reason: data.reason, preview: data.preview, clipStartMs: data.clipStartMs });

    if (autoplay) {
      try {
        await audio.play();
        // 音频上下文要等用户手势后才能跑，放歌时顺手续上
        Beat.resume();
        Beat.start();
        state.playing = true;
        emit('playstate', true);
      } catch {
        state.playing = false;
        emit('playstate', false);
      }
    }
    return { demo: data.demo };
  }

  /* ------------------------------------------------------------------ *
   * 交叉淡化（由 audio/glide.js 驱动）
   *
   * 职责分界：Player 管队列、地址解析、活动元素切换；Glide 管触发时机与增益曲线。
   * 预载只动 idleDeck，不改 state.index / 歌词，所以预载失败或用户切歌都不会串台。
   * ------------------------------------------------------------------ */

  /** 自动播放时下一首的下标；没有下一首返回 null。
   *  auto=true 时要和 ended → next(true) 的规则完全一致：
   *   单曲循环不交叉；顺序播放到队尾不凭空接歌；列表循环回到第一首；随机随便挑。 */
  function peekNext(auto = true) {
    const n = state.queue.length;
    if (!n) return null;
    if (auto && state.mode === 'single') return null;
    if (state.mode === 'shuffle') return Math.floor(Math.random() * n);
    if (state.index >= n - 1) {
      if (auto && state.mode === 'order') return null;
      return 0;
    }
    return state.index + 1;
  }

  /** 把第 i 首解析好并预载到空闲 deck（不播放、不改当前曲目）。
   *  返回的对象交给 commitIncoming；期间用户切歌会让 token 失配，自动作废。 */
  async function prepareIncoming(i) {
    if (!state.queue.length) return null;
    if (typeof Beat === 'undefined' || typeof Beat.attach !== 'function' || typeof Beat.deckGain !== 'function') return null;
    const token = state.token;
    const seq = ++prepareSeq;
    const index = normalizeIndex(i);
    const track = state.queue[index];
    const incoming = idleDeck;

    try { incoming.pause(); } catch { /* 正常，本来就没在播 */ }
    const data = await fetchTrackUrl(track);

    if (seq !== prepareSeq || token !== state.token || state.queue[index] !== track) {
      if (data.demo) URL.revokeObjectURL(data.url);
      return null;
    }

    revokeDeckBlob(incoming);
    incoming.preload = 'auto';           // 预取：离曲尾 fade+3s 就把数据拉起来
    incoming.src = data.url;
    if (data.demo) deckBlobs.set(incoming, data.url);
    try { incoming.load(); } catch { /* 老浏览器没有 load() 也能自动加载 */ }

    const ok = Beat.attach(incoming);
    if (!ok) { try { incoming.pause(); } catch { /* ignore */ } return null; }
    setDeckGain(incoming, 0);            // 先静音，等 Glide 调度淡入
    incoming.muted = audio.muted;
    incoming.volume = audio.volume;

    return { ...data, index, track, token, element: incoming };
  }

  /** 过渡结束时把活动元素换到进场 deck。
   *  之后 audio 指向新歌 —— 进度、歌词、暂停/拖动、上一首/下一首都作用在它上面。 */
  function commitIncoming(prepared) {
    if (!prepared || prepared.token !== state.token) return false;
    if (prepared.element !== idleDeck) return false;
    if (state.queue[prepared.index] !== prepared.track) return false;

    prepareSeq++;                        // 落点之后不允许别的预载再改这条元素
    const incoming = prepared.element;
    const outgoing = audio;
    audio = incoming;
    idleDeck = outgoing;
    state.index = prepared.index;
    saveQueue();                         // 交叉淡化落点也要记住当前曲目

    // 先 reset 再 startTrackMeta（理由同 load：缓存 BPM 会同步 lockTempo）
    Beat.reset();
    Beat.attach(audio);
    if (Beat.setClock) Beat.setClock(audio);
    setDeckGain(incoming, 1);
    setDeckGain(outgoing, 0);
    try { outgoing.pause(); } catch { /* 可能已经自然结束 */ }
    incoming.preload = 'metadata';

    const token = ++state.token;
    startTrackMeta(prepared.track, prepared.index, token);

    state.objectUrl = deckBlobs.get(incoming) || null;
    emit('source', {
      demo: prepared.demo, track: prepared.track, reason: prepared.reason,
      preview: prepared.preview, clipStartMs: prepared.clipStartMs,
    });
    state.playing = !audio.paused;
    if (state.playing) { Beat.resume(); Beat.start(); }
    emit('playstate', state.playing);
    emit('time', { cur: audio.currentTime, total: audio.duration || 0 });
    return true;
  }

  /* ------------------------------------------------------------------ *
   * audio 事件
   * ------------------------------------------------------------------ */
  /* 两条 deck 都绑同一套事件，但只有「活动元素」的事件才对外。
     过渡期间进场元素也在播，它的 play/timeupdate 不能冒充当前曲目。 */
  function bindDeck(el) {
    el.addEventListener('play', () => {
      if (el !== audio) return;
      state.playing = true;
      Beat.resume();
      Beat.start();
      emit('playstate', true);
    });
    el.addEventListener('pause', () => {
      if (el !== audio) return;
      state.playing = false;
      Beat.stop();
      emit('playstate', false);
    });
    el.addEventListener('timeupdate', () => {
      if (el !== audio) return;
      emit('time', { cur: el.currentTime, total: el.duration || 0 });
    });
    el.addEventListener('loadedmetadata', () => {
      if (el !== audio) return;
      emit('time', { cur: el.currentTime, total: el.duration || 0 });
    });
    el.addEventListener('progress', () => {
      if (el !== audio) return;
      try {
        if (el.buffered.length) emit('buffer', el.buffered.end(el.buffered.length - 1));
      } catch { /* ignore */ }
    });
    el.addEventListener('ended', () => {
      if (el !== audio) return;
      /* 过渡中出场曲自然结束是正常现象，真正的切歌在 Glide 的 commit 里；
         这里再 next() 会跳过进场曲。 */
      if (window.Glide && window.Glide.isTransitioning && window.Glide.isTransitioning()) return;
      if (state.mode === 'single') { el.currentTime = 0; el.play(); }
      else next(true);
    });
    el.addEventListener('error', () => {
      if (el !== audio) return;
      if (el.src) emit('sourceerror', {});
    });
  }
  bindDeck(deckA);
  bindDeck(deckB);

  /* ------------------------------------------------------------------ *
   * 对外 API
   * ------------------------------------------------------------------ */
  function next(auto = false) {
    if (!state.queue.length) return;
    cancelGlide('next');
    if (state.mode === 'shuffle') return load(Math.floor(Math.random() * state.queue.length));
    // 顺序播放：到底了就停，不自动回到第一首（用户手点下一首才回）
    if (state.index >= state.queue.length - 1) {
      if (auto && state.mode === 'order') { state.playing = false; emit('playstate', false); return; }
      return load(0);                  // 列表循环：回到第一首
    }
    return load(state.index + 1);
  }

  function prev() {
    if (!state.queue.length) return;
    cancelGlide('prev');
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }   // 先回到本曲开头，符合直觉
    if (state.mode === 'shuffle') return load(Math.floor(Math.random() * state.queue.length));
    // 列表循环/顺序：第一首再往前 = 最后一首
    return load((state.index - 1 + state.queue.length) % state.queue.length);
  }

  /* 启动时把上次的队列装回来。只恢复状态，不碰 audio.src、不自动播放；
     用户点播放 / 下一首时才由 load() 按 id 重新解析播放地址。 */
  restoreQueue();

  return {
    state, on,
    /* 对外仍然只有一个 audio：始终指向当前活动元素。
       app.js 里读 Player.audio.currentTime / duration / paused / muted 的地方不用改。 */
    get audio() { return audio; },
    parseLRC, parseLyrics, makeDemoTrack,
    extractColors, colorsFromImage, rememberColors, paletteFromCover,

    /** 设置整个队列并从第 i 首开始 */
    playQueue(tracks, i = 0, autoplay = true) {
      state.queue = tracks.slice();
      state.index = i;
      saveQueue();                       // 队列一换就落盘，刷新 / 重开还能按整张列表走
      return load(i, autoplay);
    },
    playAt: (i) => load(i),
    next, prev,

    /* 交叉淡化用的低层接口（audio/glide.js 调用）。
       decks：活动 / 空闲元素；peekNext / prepareIncoming / commitIncoming 见上。 */
    get decks() { return { active: audio, idle: idleDeck }; },
    peekNext, prepareIncoming, commitIncoming,

    toggle() {
      cancelGlide('toggle');
      if (!audio.src) { if (state.queue.length) load(Math.max(0, state.index)); return; }
      if (audio.paused) { Beat.resume(); audio.play(); } else audio.pause();
    },

    seek(sec) {
      if (!isFinite(sec)) return;
      cancelGlide('seek');
      audio.currentTime = Math.max(0, sec);
      Beat.reset();          // 跳转后节拍相位要重新对齐
    },
    setVolume(v) {
      const vol = Math.max(0, Math.min(1, v));
      audio.volume = vol;
      if (idleDeck) idleDeck.volume = vol;   // 过渡期间两条 deck 的音量保持一致
    },
    get volume() { return audio.volume; },

    setMode(m) { cancelGlide('mode'); state.mode = m; saveQueue(); emit('mode', m); },
    cycleMode() {
      cancelGlide('mode');
      const order = ['order', 'loop', 'single', 'shuffle'];
      state.mode = order[(order.indexOf(state.mode) + 1) % order.length];
      saveQueue();
      emit('mode', state.mode);
      return state.mode;
    },

    /** 按当前播放时间找歌词行。返回 { index, charIndex } —— charIndex 是
     *  逐字格式下"当前唱到第几个字"，非逐字时为 -1。
     *  注意单位：t 是秒（audio.currentTime），YRC/LRC 里的时间戳统一按秒存，
     *  避免两套单位混用（混用会导致中文/日文歌永远停在第一行）。 */
    lyricAt(t) {
      const lines = state.lyric;
      let lo = 0, hi = lines.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].t <= t) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }

      // 逐字高亮：在已定位到的行里二分找当前字
      let charIndex = -1;
      if (found >= 0 && lines[found].chars) {
        const chars = lines[found].chars;
        let a = 0, b = chars.length - 1, cf = -1;
        while (a <= b) {
          const mid = (a + b) >> 1;
          if (chars[mid].t <= t) { cf = mid; a = mid + 1; }
          else b = mid - 1;
        }
        charIndex = cf;
      }

      if (found !== state.lyricIndex || charIndex !== state.charIndex) {
        state.lyricIndex = found;
        state.charIndex = charIndex;
        emit('lyric', { lines, active: found, charIndex, format: state.lyricFormat });
      }
      return { index: found, charIndex };
    },
  };
})();

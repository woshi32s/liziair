/**
 * dj-engine.js —— 音乐实验室 DJ 台的纯音频引擎（无 DOM 依赖）
 *
 * 信号链（每台 deck 一条，顺序即规格 §3）：
 *   [颗粒 / 缓冲源 / SoundTouch] → in
 *     → trim → low(220 ls) → mid(1.1k peak) → high(4.2k hs)
 *     → lp → hp            （FILTER 单旋钮：中点 = 全开，左 LPF，右 HPF）
 *     → [dry / FX] → chan(通道推子) → postChan ─┬→ xf(横推) → masterIn → masterFader → destination
 *                                              ├→ analyse（推子后、横推前）
 *                                              └→ pfl(0/1) → cueBus → cueMix → destination
 *
 * 关键事实（都实测过，别改回去）：
 *   · AudioBufferSourceNode.playbackRate 不接受负值 → 倒放/搓碟一律走颗粒合成。
 *   · soundtouch：tempo = 播放速度，pitch = 音高倍率。
 *     变速不变调 → tempo = rate、pitch = 1（440Hz 正弦实测：tempo 1.08 后仍是 440.3Hz）。
 *   · BPM 用「离线渲染 11.025kHz 低频段 → 10ms 能量包络 → 自相关」，不用实时 FFT。
 */

/* ================================================================== *
 * 小工具
 * ================================================================== */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-6, g));

export function fmtTime(sec, withMinus) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return (withMinus ? '-' : '') + m + ':' + String(s).padStart(2, '0');
}

/** 曲目 key：同一首歌再来一次还能命中缓存 */
export function trackKeyOf(t) {
  if (!t) return '';
  if (t.kind === 'file') return 'file:' + (t.name || '') + ':' + (t.size || 0);
  if (t.id != null) return 'nc:' + t.id;
  return 'x:' + (t.name || t.title || '');
}

const LS_META = 'lizi.dj.meta.';
const LS_CUES = 'lizi.dj.cues.';

function lsGet(k) {
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 配额满了就算了 */ }
}

/* ================================================================== *
 * 离线分析：峰值 + BPM + 首拍
 * ================================================================== */

/** 峰值包络：每秒 100 个点（10ms 一格），95 分位归一化 + 幂压缩 0.62（否则是一堵灰墙）
 *
 * 每格取的是 **RMS** 不是 max(|sample|)：母带压得很死的歌 max 几乎每格都顶到 1.0，
 * 实测 p95 就是 1.0，归一化之后整条波形全满 —— 那还是灰墙。
 * RMS 才不会饱和（同一首歌 p95≈0.3），起伏看得出来。 */
export function peaksOf(buffer, perSec = 100) {
  const sr = buffer.sampleRate;
  const step = sr / perSec;
  const n = Math.max(1, Math.floor(buffer.length / step));
  const out = new Float32Array(n);
  const chs = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chs.push(buffer.getChannelData(c));
  const stride = 2;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * step), e = Math.min(buffer.length, Math.floor((i + 1) * step));
    let acc = 0, cnt = 0;
    for (let j = s; j < e; j += stride) {
      let v = 0;
      for (let c = 0; c < chs.length; c++) v += chs[c][j] * chs[c][j];
      acc += v / chs.length;
      cnt++;
    }
    out[i] = Math.sqrt(acc / Math.max(1, cnt));
  }
  const tmp = Float32Array.from(out).sort();
  const p95 = tmp[Math.floor(tmp.length * 0.95)] || tmp[tmp.length - 1] || 1;
  for (let i = 0; i < n; i++) out[i] = Math.pow(Math.min(1, out[i] / p95), 0.62);
  return out;
}

/**
 * 离线 BPM：低通到 30~180Hz → 10ms 帧能量 → 正半波差分 → 自相关 → 抛物线细化
 * 返回 { bpm, firstBeat }；测不出来返回 bpm=0（UI 显示 —，不许瞎填）
 */
export async function detectBpm(buffer) {
  const SR = 11025;
  const dur = buffer.duration;
  if (!(dur > 4)) return { bpm: 0, firstBeat: 0 };
  const frames = Math.ceil(dur * SR);
  let lowPass;
  try {
    const off = new OfflineAudioContext(1, frames, SR);
    const src = off.createBufferSource();
    src.buffer = buffer;
    const hp = off.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.6;
    const lp1 = off.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 180; lp1.Q.value = 0.7;
    const lp2 = off.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 180; lp2.Q.value = 0.7;
    src.connect(hp); hp.connect(lp1); lp1.connect(lp2); lp2.connect(off.destination);
    src.start();
    lowPass = (await off.startRendering()).getChannelData(0);
  } catch {
    return { bpm: 0, firstBeat: 0 };
  }

  /* 10ms 帧能量（110.25 采样/帧） */
  const step = SR / 100;
  const F = Math.floor(lowPass.length / step);
  if (F < 300) return { bpm: 0, firstBeat: 0 };
  const eng = new Float32Array(F);
  for (let i = 0; i < F; i++) {
    const s = Math.floor(i * step), e = Math.min(lowPass.length, Math.floor((i + 1) * step));
    let acc = 0;
    for (let j = s; j < e; j++) acc += lowPass[j] * lowPass[j];
    eng[i] = Math.sqrt(acc / Math.max(1, e - s));
  }
  /* 正半波差分 = onset 包络 */
  const env = new Float32Array(F);
  for (let i = 1; i < F; i++) env[i] = Math.max(0, eng[i] - eng[i - 1]);
  /* 去均值 */
  let mean = 0;
  for (let i = 0; i < F; i++) mean += env[i];
  mean /= F;
  for (let i = 0; i < F; i++) env[i] -= mean;

  /* 自相关：60~200 BPM → lag 30~100 帧 */
  const lagMin = Math.floor(100 * 60 / 200), lagMax = Math.ceil(100 * 60 / 60);
  const ac = new Float32Array(lagMax + 2);
  for (let lag = lagMin; lag <= lagMax + 1; lag++) {
    let s = 0;
    const N = F - lag;
    for (let i = 0; i < N; i++) s += env[i] * env[i + lag];
    ac[lag] = s / Math.max(1, N);
  }
  /* 音乐上 100~160 更常见：加一个很轻的先验，只用来选八度，不改 lag 精度 */
  const prior = (bpm) => 1 + 0.18 * Math.exp(-Math.pow((bpm - 128) / 46, 2));
  let bestLag = 0, bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const score = ac[lag] * prior(6000 / lag);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag) return { bpm: 0, firstBeat: 0 };
  /* 抛物线插值细化 */
  const y0 = ac[bestLag - 1], y1 = ac[bestLag], y2 = ac[bestLag + 1];
  const denom = y0 - 2 * y1 + y2;
  const delta = denom !== 0 ? clamp(0.5 * (y0 - y2) / denom, -0.5, 0.5) : 0;
  let period = bestLag + delta;
  let bpm = 6000 / period;

  /* 八度折叠：自相关在倍/半周期上几乎一样强，会把 133 报成 66。
     规则：低于 118 BPM 的候选，如果双速落在 88~190 且相关度 ≥ 峰值的 62%，取双速；
     高于 175 BPM 的候选，如果半速相关度明显更强，取半速。 */
  const acAt = (p) => ac[Math.round(p)] || 0;
  if (bpm < 118) {
    const dbl = bpm * 2;
    if (dbl >= 88 && dbl <= 190 && acAt(period / 2) > acAt(period) * 0.62) { bpm = dbl; period /= 2; }
  } else if (bpm > 175) {
    const half = bpm / 2;
    if (half >= 60 && acAt(period * 2) > acAt(period) * 1.15) { bpm = half; period *= 2; }
  }

  /* 首拍相位：用 BPM 网格扫一遍 offset，取包络能量最大处 */
  let bestOff = 0, bestE = -Infinity;
  const pInt = Math.round(period);
  const offMax = Math.max(1, pInt);
  for (let off = 0; off < offMax; off++) {
    let s = 0;
    for (let i = off; i < F; i += pInt) s += Math.max(0, env[i]);
    if (s > bestE) { bestE = s; bestOff = off; }
  }
  /* 细化到 1ms：在 bestOff 附近 ±1 帧内按 0.1 帧扫 */
  let fineOff = bestOff;
  let fineE = -Infinity;
  for (let k = -10; k <= 10; k++) {
    const off = bestOff + k * 0.1;
    if (off < 0) continue;
    let s = 0;
    for (let t = off; t < F; t += period) s += Math.max(0, env[Math.round(t)] || 0);
    if (s > fineE) { fineE = s; fineOff = off; }
  }
  return { bpm: +bpm.toFixed(2), firstBeat: +(fineOff / 100).toFixed(3) };
}

/* ================================================================== *
 * keylock 节点（deck 和离线测试共用同一段构造，别写两份）
 * ================================================================== */
let _stMod = null;
export async function loadSoundtouch() {
  if (!_stMod) _stMod = await import('../vendor/soundtouch.js');
  return _stMod;
}

/**
 * 造一个 SoundTouch 节点。rate = 播放速度倍率（keylock：tempo=rate, pitch=1）
 * onPos(sec) 每个处理块回调一次源位置；onEnd 到底了
 */
export function makeKeylockNode(ST, ctx, buffer, rate, onPos, onEnd) {
  const sh = new ST.PitchShifter(ctx, buffer, 4096, onEnd || (() => {}));
  sh.tempo = clamp(rate, 0.25, 4);
  sh.pitch = 1;
  if (onPos) sh.on('play', (d) => onPos(d.timePlayed));
  return sh;
}

/* ================================================================== *
 * 反向缓冲（懒造，只在第一次倒搓时生成）
 * ================================================================== */
export function reverseBuffer(ctx, buf) {
  const rev = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c), d = rev.getChannelData(c);
    for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i];
  }
  return rev;
}

/* ================================================================== *
 * Deck
 * ================================================================== */
const SCRATCH_MAX = 3.2;

export class Deck {
  constructor(engine, key) {
    this.eng = engine;
    this.key = key;
    this.buf = null;
    this.rev = null;
    this.dur = 0;
    this.track = null;         // {title, artist, key, kind, id, file, size}
    this.status = '未载入';
    this.err = '';
    this.loading = false;

    this.playing = false;
    this.pos = 0;
    this.rate = 1;             // 1 + pitch/100
    this.pitchPct = 0;
    this.range = 8;            // ±8 / ±16 / ±50
    this.keylock = true;

    this.src = null; this.srcCtx = 0; this.srcPos = 0;
    this.shifter = null; this.shiftPos = 0; this.shiftAt = 0; this.shiftLive = false;
    this.bending = false; this.bendRate = 1;

    this.peaks = null;
    this.bpmBase = 0;
    this.firstBeat = 0;
    this.cue = 0;
    this.hotcues = new Array(8).fill(null);
    this.loop = { on: false, a: 0, b: 0 };

    this.scratching = false;
    this.scrRate = 0;
    this.wasPlaying = false;
    this.grainLeft = 0;

    this.nodes = null;
    this.eqDb = { low: 0, mid: 0, high: 0 };
    this.analysers = null;
    this.meter = { l: 0, r: 0, hl: 0, hr: 0, th: 0 };
  }

  get ctx() { return this.eng.ctx; }

  /* ---------- 图 ---------- */
  buildChain() {
    const c = this.ctx;
    const g = () => c.createGain();
    const n = {
      in: g(), trim: g(),
      low: c.createBiquadFilter(),
      mid: c.createBiquadFilter(),
      high: c.createBiquadFilter(),
      lp: c.createBiquadFilter(), hp: c.createBiquadFilter(),
      fxIn: g(), dry: g(), wet: g(), fxOut: g(),
      chan: g(), post: g(), pfl: g(), xf: g(),
    };
    n.low.type = 'lowshelf'; n.low.frequency.value = 220;
    n.mid.type = 'peaking'; n.mid.frequency.value = 1100; n.mid.Q.value = 0.9;
    n.high.type = 'highshelf'; n.high.frequency.value = 4200;
    n.lp.type = 'lowpass'; n.lp.frequency.value = 22050; n.lp.Q.value = 0.7;
    n.hp.type = 'highpass'; n.hp.frequency.value = 20; n.hp.Q.value = 0.7;
    n.trim.gain.value = 1;
    n.dry.gain.value = 1; n.wet.gain.value = 0;
    n.chan.gain.value = 0.85;
    n.post.gain.value = 1;
    n.pfl.gain.value = 0;
    n.xf.gain.value = Math.SQRT1_2;

    n.in.connect(n.trim); n.trim.connect(n.low); n.low.connect(n.mid);
    n.mid.connect(n.high); n.high.connect(n.lp); n.lp.connect(n.hp);
    n.hp.connect(n.fxIn);
    n.fxIn.connect(n.dry); n.dry.connect(n.fxOut);
    n.fxOut.connect(n.chan); n.chan.connect(n.post);
    n.post.connect(n.xf); n.xf.connect(this.eng.masterIn);
    n.post.connect(n.pfl); n.pfl.connect(this.eng.cueBus);

    /* 电平表：推子后、横推前（规格 §3） */
    const sp = c.createChannelSplitter(2);
    n.post.connect(sp);
    const al = c.createAnalyser(), ar = c.createAnalyser();
    al.fftSize = 1024; ar.fftSize = 1024;
    sp.connect(al, 0); sp.connect(ar, 1);
    al.connect(this.eng.meterSink); ar.connect(this.eng.meterSink);
    this.analysers = { l: al, r: ar };
    this.bufL = new Float32Array(al.fftSize);
    this.bufR = new Float32Array(ar.fftSize);
    this.nodes = n;
    return n;
  }

  ensure() {
    if (!this.eng.ctx) this.eng.init();
    if (!this.nodes) this.buildChain();
    return this.eng.ctx;
  }

  /* ---------- 载入 ---------- */
  async load(track) {
    const ctx = this.ensure();
    this.loading = true;
    this.err = '';
    this.status = '解码中…';
    this.stop(true);
    try {
      const buf = await this.eng.decode(track);
      this.buf = buf;
      this.rev = null;
      this.dur = buf.duration;
      this.pos = 0;
      this.cue = 0;
      this.hotcues = new Array(8).fill(null);
      this.loop = { on: false, a: 0, b: 0 };
      this.bpmBase = 0;
      this.firstBeat = 0;
      this.track = { ...track, key: trackKeyOf(track) };
      this.peaks = peaksOf(buf);
      /* 缓存命中就不重算 BPM（§1-D20） */
      const cached = lsGet(LS_META + this.track.key);
      if (cached && cached.bpm > 0) {
        this.bpmBase = cached.bpm;
        this.firstBeat = cached.first || 0;
        this.status = '就绪';
      } else {
        this.status = '分析节拍…';
        const r = await detectBpm(buf);
        this.bpmBase = r.bpm;
        this.firstBeat = r.firstBeat;
        this.status = '就绪';
        if (r.bpm > 0) lsSet(LS_META + this.track.key, { bpm: r.bpm, first: r.firstBeat, dur: +this.dur.toFixed(3) });
      }
      const cues = lsGet(LS_CUES + this.track.key);
      if (cues) {
        if (Array.isArray(cues.cues)) this.hotcues = cues.cues.slice(0, 8).map((v) => (typeof v === 'number' ? v : null));
        if (cues.loop && isFinite(cues.loop.a) && isFinite(cues.loop.b)) this.loop = { on: !!cues.loop.on, a: cues.loop.a, b: cues.loop.b };
        if (typeof cues.cue === 'number') this.cue = cues.cue;
      }
      this.shifter = null;
      return true;
    } catch (e) {
      this.err = '载入失败：' + (e.message || e);
      this.status = this.err;
      return false;
    } finally {
      this.loading = false;
    }
  }

  saveCues() {
    if (!this.track) return;
    lsSet(LS_CUES + this.track.key, { cues: this.hotcues, loop: this.loop, cue: this.cue });
  }

  /* ---------- 位置 ---------- */
  get beatDur() { return this.bpmBase > 0 ? 60 / this.bpmBase : 0.5; }
  get bpmNow() { return this.bpmBase > 0 ? this.bpmBase * this.rate : 0; }

  _wrap(p) {
    if (!this.dur) return 0;
    if (this.loop.on && this.loop.b > this.loop.a + 0.02) {
      const L = this.loop.b - this.loop.a;
      if (p >= this.loop.b) p = this.loop.a + ((p - this.loop.a) % L);
      if (p < this.loop.a - 0.001 && p > 0) p = this.loop.a;
    }
    return clamp(p, 0, this.dur);
  }

  /** 当前播放位置（秒）。keylock 走 SoundTouch 上报的源位置，普通走时间推算 */
  audioPos() {
    if (this.scratching) return this.pos;
    if (!this.playing) return this.pos;
    const c = this.ctx;
    if (this.shiftLive) {
      const est = this.shiftPos + Math.max(0, c.currentTime - this.shiftAt) * (this.bending ? this.bendRate : this.rate);
      return this._wrap(Math.max(this.shiftPos, est));
    }
    if (!this.src) return this.pos;
    return this._wrap(this.srcPos + Math.max(0, c.currentTime - this.srcCtx) * (this.bending ? this.bendRate : this.rate));
  }

  /* ---------- 传输 ---------- */
  _stopSrc() {
    if (this.src) {
      const s = this.src;
      this.src = null;
      try { s.onended = null; s.stop(); } catch { /* 已停 */ }
      try { s.disconnect(); } catch { /* 已断 */ }
    }
    if (this.shifter && this.shiftLive) {
      this.shiftLive = false;
      try { this.shifter.disconnect(); } catch { /* 已断 */ }
    }
  }

  _startFrom(from) {
    const c = this.ctx;
    from = clamp(from, 0, Math.max(0, this.dur - 0.01));
    if (this.keylock && this.eng.ST) {
      if (!this.shifter) {
        this.shifter = makeKeylockNode(this.eng.ST, c, this.buf, this.rate,
          (t) => this._onShiftPos(t),
          () => { if (this.playing && !this.loop.on) { this.playing = false; this.pos = this.dur; this._stopSrc(); } });
      }
      this.shifter.tempo = clamp(this.rate, 0.25, 4);
      /* 注意：PitchShifter.percentagePlayed 的 setter 要 0..1 的**比例**，
         而它的 getter 返回 0..100 —— 这个库自己的不对称。
         传百分比会让 sourcePosition 越界 → Float32Array 读到 undefined → 整条链变 NaN（实测过）。 */
      this.shifter.percentagePlayed = clamp(from / this.dur, 0, 0.999);
      this.shiftPos = from;
      this.shiftAt = c.currentTime;
      this.shifter.connect(this.nodes.in);
      this.shiftLive = true;
      return;
    }
    const s = c.createBufferSource();
    s.buffer = this.buf;
    s.playbackRate.value = this.rate;
    if (this.loop.on && this.loop.b > this.loop.a + 0.02) {
      s.loop = true; s.loopStart = this.loop.a; s.loopEnd = this.loop.b;
    }
    s.connect(this.nodes.in);
    s.start(0, from);
    s.onended = () => {
      if (this.src !== s) return;
      this.src = null;
      this.playing = false;
      this.pos = this.dur;
    };
    this.src = s;
    this.srcCtx = c.currentTime;
    this.srcPos = from;
  }

  _onShiftPos(sec) {
    this.shiftPos = sec;
    this.shiftAt = this.ctx.currentTime;
    /* keylock 下的 loop：源位置越过 out 就把读头拉回 in（SoundTouch 不支持内部 loop） */
    if (this.playing && this.loop.on && this.loop.b > this.loop.a + 0.02 && sec >= this.loop.b) {
      this.seek(this.loop.a);
    }
  }

  play() {
    if (!this.buf || this.loading) return false;
    this.ensure();
    this.eng.resume();
    this.scratching = false;
    this._stopSrc();
    this._startFrom(this._startPoint());
    this.playing = true;
    this.status = '播放中';
    return true;
  }

  /** loop 开着而当前位置在区间外 → 从 loop in 起播 */
  _startPoint() {
    if (this.pos >= this.dur - 0.02) this.pos = 0;
    if (this.loop.on && this.loop.b > this.loop.a) {
      if (this.pos < this.loop.a || this.pos >= this.loop.b) return this.loop.a;
    }
    return this.pos;
  }

  pause() {
    if (!this.playing) { this.status = this.buf ? '暂停' : '未载入'; return; }
    this.pos = this.audioPos();
    this.playing = false;
    this._stopSrc();
    this.status = '暂停';
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  /** 离开 DJ 台时用：停下来但**保住播放位置**，回来还是暂停在原位。
   *  和 stop() 的区别是这里额外清掉搓碟 / bend 的临时态，
   *  保证退出之后没有任何声源还在后面响（颗粒是一次性 source，也会自然结束）。 */
  pauseKeep() {
    const at = this.audioPos();
    this.scratching = false;
    this.scrRate = 0;
    this.wasPlaying = false;
    this.bending = false;
    this.bendRate = 1;
    this.playing = false;
    this._stopSrc();
    if (this.shifter) {
      /* 复位 time-stretch 的读头记录，回来重连时不会从旧位置接着跑 */
      this.shiftPos = at;
      this.shiftAt = this.ctx ? this.ctx.currentTime : 0;
    }
    this.pos = clamp(at, 0, this.dur || 0);
    this.status = this.buf ? '暂停' : '未载入';
  }

  stop(quiet) {
    if (this.playing || this.src || this.shiftLive) this.pos = this.audioPos();
    this.playing = false;
    this.scratching = false;
    this._stopSrc();
    if (!quiet) this.status = this.buf ? '暂停' : '未载入';
  }

  seek(sec) {
    if (!this.buf) return;
    const was = this.playing;
    const p = clamp(sec, 0, Math.max(0, this.dur - 0.01));
    this.playing = false;
    this._stopSrc();
    this.pos = p;
    if (was) { this.playing = true; this._startFrom(this._startPoint()); }
  }

  /** CUE：暂停时设点；播放时回跳到 cue 并暂停（Mixxx 行为） */
  cuePress() {
    if (!this.buf) return;
    if (this.playing) {
      this.pause();
      this.seek(this.cue);
      this.pos = this.cue;
      this.status = 'CUE 回跳';
    } else {
      this.cue = this.pos;
      this.saveCues();
      this.status = 'CUE 已设 ' + fmtTime(this.cue);
    }
  }

  /* ---------- 速度 / 音高 ---------- */
  setPitchPct(p) {
    const lim = this.range;
    this.pitchPct = clamp(p, -lim, lim);
    this.rate = 1 + this.pitchPct / 100;
    if (this.playing) {
      const at = this.audioPos();
      this.pos = at;
      if (this.shiftLive && this.shifter) {
        this.shifter.tempo = clamp(this.rate, 0.25, 4);
        this.shiftPos = at;
        this.shiftAt = this.ctx.currentTime;
      } else if (this.src) {
        this.src.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.01);
        this.srcPos = at;
        this.srcCtx = this.ctx.currentTime;
      }
    }
  }

  setRange(r) {
    this.range = r;
    if (Math.abs(this.pitchPct) > r) this.setPitchPct(Math.sign(this.pitchPct) * r);
  }

  setKeylock(on) {
    if (this.keylock === !!on) return;
    const at = this.playing ? this.audioPos() : this.pos;
    const was = this.playing;
    this._stopSrc();
    this.playing = false;
    this.keylock = !!on;
    this.pos = at;
    if (was) this.play();
  }

  /** SYNC：对齐 master 的 BPM 与拍相位 */
  syncTo(master) {
    if (!master || !master.bpmNow || !this.bpmBase) return;
    const need = master.bpmNow / this.bpmBase;      // 需要的 rate
    /* 档位放不下就自动换更大的档（Mixxx 也是按档位钳制） */
    const pct = (need - 1) * 100;
    if (Math.abs(pct) > this.range) {
      const r = Math.abs(pct) <= 16 ? 16 : 50;
      if (Math.abs(pct) > r) return;                 // ±50% 也放不下：放弃（如实不动作）
      this.setRange(r);
    }
    this.setPitchPct(pct);
    /* 相位对齐：把本 deck 的拍点挪到 master 的拍相位上 */
    const mb = master.firstBeat || 0;
    const myPeriod = 60 / this.bpmNow;
    const mp = master.bpmNow ? (60 / master.bpmNow) : myPeriod;
    const mPhase = ((master.audioPos() - mb) % mp + mp) % mp;
    const at = this.audioPos();
    let want = this.firstBeat + Math.round((at - this.firstBeat - mPhase) / myPeriod) * myPeriod + mPhase;
    if (!isFinite(want)) want = at;
    if (Math.abs(want - at) > 0.001) this.seek(clamp(want, 0, Math.max(0, this.dur - 0.02)));
  }

  /* ---------- 搓碟 / bend ---------- */
  scratchBegin() {
    if (!this.buf) return false;
    this.ensure();
    this.eng.resume();
    this.wasPlaying = this.playing;
    this.pos = this.audioPos();
    this.playing = false;
    this._stopSrc();
    this.scratching = true;
    this.scrRate = 0;
    this.bending = false;
    this.status = '搓碟';
    return true;
  }

  /** rate：手的角速度换算成的播放倍率，±3.x */
  scratchSet(rate) {
    this.scrRate = clamp(rate, -SCRATCH_MAX, SCRATCH_MAX);
    this.status = Math.abs(this.scrRate) < 0.02 ? '搓碟 · 停转' : (this.scrRate > 0 ? '搓碟 · 正转' : '搓碟 · 倒转');
  }

  scratchEnd() {
    if (!this.scratching) return;
    this.scratching = false;
    this.scrRate = 0;
    if (this.wasPlaying) { this.playing = true; this._startFrom(this._startPoint()); this.status = '播放中'; }
    else this.status = this.buf ? '暂停' : '未载入';
    this.wasPlaying = false;
  }

  bendStart() {
    if (!this.playing) return;
    this.bending = true;
  }
  bendSet(f) {
    if (!this.bending) return;
    this.bendRate = clamp(1 + f, 0.6, 1.5);
    if (this.shiftLive && this.shifter) {
      /* 采样位置会随 bend 变化 → 先按 bend 之前的位置落地，再改 tempo */
      this.shiftPos = this.audioPos();
      this.shiftAt = this.ctx.currentTime;
      this.shifter.tempo = clamp(this.rate * this.bendRate, 0.25, 4);
    } else if (this.src) {
      this.srcPos = this.audioPos();
      this.srcCtx = this.ctx.currentTime;
      this.src.playbackRate.setTargetAtTime(this.rate * this.bendRate, this.ctx.currentTime, 0.02);
    }
  }
  bendEnd() {
    if (!this.bending) return;
    this.bending = false;
    this.bendRate = 1;
    if (this.shiftLive && this.shifter) this.shifter.tempo = clamp(this.rate, 0.25, 4);
    else if (this.src) this.src.playbackRate.setTargetAtTime(this.rate, this.ctx.currentTime, 0.02);
  }

  /** 每帧推进一步搓碟（原地推进播放头 + 发颗粒）。moving=false 时手停住 → 转速迅速衰减到 0 */
  scratchTick(dt, moving) {
    if (!this.scratching) return;
    if (!moving) this.scrRate *= Math.pow(0.004, Math.min(0.06, dt));
    const r = this.scrRate;
    this.pos = clamp(this.pos + r * dt, 0, Math.max(0, this.dur - 0.005));
    if (Math.abs(r) < 0.04) return;
    this._grain(r, dt);
  }

  _grain(rate, dt) {
    const c = this.ctx;
    const back = rate < 0;
    if (back && !this.rev) this.rev = reverseBuffer(c, this.buf);
    const src = back ? this.rev : this.buf;
    const D = this.dur;
    let at = back ? D - this.pos : this.pos;
    const len = clamp(Math.abs(rate) * dt * 2.6, 0.035, 0.13);
    const dur = len / Math.abs(rate);
    at = clamp(at, 0, Math.max(0, D - 0.01));
    const s = c.createBufferSource();
    s.buffer = src;
    s.playbackRate.value = Math.abs(rate);
    const g = c.createGain();
    const t0 = c.currentTime;
    const fin = Math.min(0.005, dur * 0.25);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + fin);
    g.gain.setValueAtTime(1, t0 + Math.max(fin, dur - fin));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    s.connect(g); g.connect(this.nodes.in);
    s.start(t0, at, Math.min(len, D - at));
    try { s.stop(t0 + dur + 0.01); } catch { /* 忽略 */ }
  }

  /* ---------- 混音 ---------- */
  setTrim(v) { if (this.nodes) this.nodes.trim.gain.setTargetAtTime(dbToGain((v - 0.5) * 24), this.ctx.currentTime, 0.01); }
  /** v: 0..1，0.5 = 0dB，0 = kill
   *  kill 用「shelf 打到 -80dB」实现，不是串一个增益节点 ——
   *  串增益会把整条信号都置零（第一版就这么错了，EQ 一拧到底整个 deck 都没声）。 */
  setEq(band, v) {
    if (!this.nodes) return;
    const t = this.ctx.currentTime;
    const node = band === 'low' ? this.nodes.low : band === 'mid' ? this.nodes.mid : this.nodes.high;
    const db = v <= 0.004 ? -80 : (v <= 0.5 ? (v - 0.5) * 52 : (v - 0.5) * 12);
    node.gain.setTargetAtTime(db, t, 0.015);
    this.eqDb[band] = db;
  }
  setFilter(v) {
    if (!this.nodes) return;
    const t = this.ctx.currentTime;
    /* 中点 = 全开：lp 22k / hp 20。左 → lp 从 22k 收到 180；右 → hp 从 20 升到 7k */
    const x = clamp(v, 0, 1) * 2 - 1;
    if (x <= 0) {
      this.nodes.lp.frequency.setTargetAtTime(22050 * Math.pow(180 / 22050, -x), t, 0.02);
      this.nodes.hp.frequency.setTargetAtTime(20, t, 0.02);
    } else {
      this.nodes.lp.frequency.setTargetAtTime(22050, t, 0.02);
      this.nodes.hp.frequency.setTargetAtTime(20 * Math.pow(7000 / 20, x), t, 0.02);
    }
  }
  setChan(v) { if (this.nodes) this.nodes.chan.gain.setTargetAtTime(Math.pow(clamp(v, 0, 1), 1.4), this.ctx.currentTime, 0.01); }

  /* ---------- FX：每 deck 一个，echo / delay / reverb ---------- */
  setFx(kind, wet, param) {
    if (!this.nodes) return;
    const n = this.nodes, t = this.ctx.currentTime;
    kind = kind || 'off';
    if (kind !== this.fxKind) {
      this._txFx();
      this.fxKind = kind;
      if (kind !== 'off') this._buildFx(kind);
    }
    const w = kind === 'off' ? 0 : clamp(wet, 0, 1);
    n.dry.gain.setTargetAtTime(1 - w * 0.9, t, 0.02);
    n.wet.gain.setTargetAtTime(w, t, 0.02);
    this.fxParam = clamp(param, 0, 1);
    const fx = this.fxNodes;
    if (!fx) return;
    if (fx.dly) fx.dly.delayTime.setTargetAtTime(0.05 + this.fxParam * 0.45, t, 0.03);
    if (fx.tone) fx.tone.frequency.setTargetAtTime(900 + this.fxParam * 11000, t, 0.03);
  }

  _buildFx(kind) {
    const c = this.ctx, n = this.nodes;
    if (kind === 'reverb') {
      const conv = c.createConvolver();
      conv.buffer = this.eng.impulse ? this.eng.impulse() : this.impulse();
      const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 6000;
      n.fxIn.connect(conv); conv.connect(tone); tone.connect(n.wet);
      this.fxNodes = { entry: conv, conv, tone };
    } else {
      const dly = c.createDelay(1.0);
      dly.delayTime.value = 0.25;
      const fb = c.createGain(); fb.gain.value = kind === 'echo' ? 0.52 : 0.26;
      const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
      n.fxIn.connect(dly); dly.connect(tone); tone.connect(fb); fb.connect(dly); tone.connect(n.wet);
      this.fxNodes = { entry: dly, dly, fb, tone };
    }
  }

  _txFx() {
    if (!this.fxNodes) return;
    const n = this.nodes;
    try { n.fxIn.disconnect(this.fxNodes.entry); } catch { /* 忽略 */ }
    for (const key of ['conv', 'dly', 'fb', 'tone']) {
      const node = this.fxNodes[key];
      if (node) { try { node.disconnect(); } catch { /* 忽略 */ } }
    }
    this.fxNodes = null;
  }

  impulse(sec = 1.6) {
    const e = this.eng;
    if (e._imp) return e._imp;
    const c = e.ctx, sr = c.sampleRate, n = Math.floor(sec * sr);
    const b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    e._imp = b;
    return b;
  }

  setPfl(on) { if (this.nodes) this.nodes.pfl.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01); }
  setXf(g) { if (this.nodes) this.nodes.xf.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01); }

  /* ---------- 电平 ---------- */
  readMeter(now) {
    if (!this.analysers) return this.meter;
    this.analysers.l.getFloatTimeDomainData(this.bufL);
    this.analysers.r.getFloatTimeDomainData(this.bufR);
    let pl = 0, pr = 0;
    for (let i = 0; i < this.bufL.length; i++) {
      const a = Math.abs(this.bufL[i]); if (a > pl) pl = a;
      const b = Math.abs(this.bufR[i]); if (b > pr) pr = b;
    }
    const m = this.meter;
    m.l = pl; m.r = pr;
    m.hl = pl >= m.hl ? pl : m.hl; m.hr = pr >= m.hr ? pr : m.hr;
    if (!m.th || now - m.th > 1000) { m.th = now; m.hl = pl; m.hr = pr; }
    return m;
  }
}

/* ================================================================== *
 * Engine
 * ================================================================== */
export class Engine {
  constructor() {
    this.ctx = null;
    this.ST = null;
    this.decks = { A: new Deck(this, 'A'), B: new Deck(this, 'B') };
    this.masterVol = 0.8;
    this.cross = 0;
    this.crossCurve = 'power';
    this.cueMix = 0;
    this.master = { l: 0, r: 0, hl: 0, hr: 0, th: 0 };
  }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = new AC({ latencyHint: 'interactive' });
    this.ctx = c;
    const g = () => c.createGain();
    this.masterIn = g();
    this.masterFader = g();
    this.masterFader.gain.value = this.masterVol;
    this.masterIn.connect(this.masterFader);
    this.masterFader.connect(c.destination);
    this.cueBus = g();
    this.cueMixGain = g();
    this.cueMixGain.gain.value = 0;
    this.cueBus.connect(this.cueMixGain).connect(c.destination);
    /* 电平表探头必须连到 destination 才会被拉起来，用一个 0 增益汇点保证不发声 */
    this.meterSink = g();
    this.meterSink.gain.value = 0;
    this.meterSink.connect(c.destination);
    const sp = c.createChannelSplitter(2);
    this.masterFader.connect(sp);
    const ml = c.createAnalyser(), mr = c.createAnalyser();
    ml.fftSize = 1024; mr.fftSize = 1024;
    sp.connect(ml, 0); sp.connect(mr, 1);
    ml.connect(this.meterSink); mr.connect(this.meterSink);
    this.mAnalysers = { l: ml, r: mr };
    this.mBufL = new Float32Array(ml.fftSize);
    this.mBufR = new Float32Array(mr.fftSize);
    this.applyCross();
    loadSoundtouch().then((m) => { this.ST = m; }).catch(() => { /* 没 soundtouch 就退化成变速变调 */ });
    return c;
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  async decode(track) {
    if (track.kind === 'file') {
      const ab = await track.file.arrayBuffer();
      return await this.ctx.decodeAudioData(ab);
    }
    /* API 是 app.js 那个老式脚本的顶层 const：在全局词法环境里，模块中能直接按名字拿到，
       但它不挂在 window 上，所以不能写 window.API。 */
    const api = typeof API !== 'undefined' ? API : null;
    if (!api) throw new Error('拿不到 API');
    const r = await api.songUrl(track.id);
    const item = (r.data || [])[0];
    if (!item || !item.url) throw new Error(item && item.code === -110 ? 'VIP 专属，登录后再试' : '拿不到音频直链');
    const res = await fetch(item.url, { mode: 'cors' });
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
    const ab = await res.arrayBuffer();
    return await this.ctx.decodeAudioData(ab);
  }

  /* ---------- 横推 ---------- */
  setCross(x) { this.cross = clamp(x, -1, 1); this.applyCross(); }
  setCrossCurve(k) { this.crossCurve = k === 'sharp' ? 'sharp' : 'power'; this.applyCross(); }
  crossGains() {
    const th = ((this.cross + 1) / 2) * (Math.PI / 2);
    const a = Math.cos(th), b = Math.sin(th);
    if (this.crossCurve === 'sharp') return { a: Math.pow(a, 3), b: Math.pow(b, 3) };
    return { a, b };
  }
  applyCross() {
    if (!this.ctx) return;
    const { a, b } = this.crossGains();
    this.decks.A.setXf(a);
    this.decks.B.setXf(b);
  }

  setMaster(v) {
    this.masterVol = clamp(v, 0, 1);
    if (this.ctx) this.masterFader.gain.setTargetAtTime(Math.pow(this.masterVol, 1.4), this.ctx.currentTime, 0.02);
  }
  setCueMix(v) {
    this.cueMix = clamp(v, 0, 1);
    if (this.ctx) this.cueMixGain.gain.setTargetAtTime(this.cueMix, this.ctx.currentTime, 0.02);
  }

  readMasterMeter(now) {
    if (!this.mAnalysers) return this.master;
    this.mAnalysers.l.getFloatTimeDomainData(this.mBufL);
    this.mAnalysers.r.getFloatTimeDomainData(this.mBufR);
    let pl = 0, pr = 0;
    for (let i = 0; i < this.mBufL.length; i++) {
      const a = Math.abs(this.mBufL[i]); if (a > pl) pl = a;
      const b = Math.abs(this.mBufR[i]); if (b > pr) pr = b;
    }
    const m = this.master;
    m.l = pl; m.r = pr;
    m.hl = Math.max(pl, m.hl); m.hr = Math.max(pr, m.hr);
    if (!m.th || now - m.th > 1000) { m.th = now; m.hl = pl; m.hr = pr; }
    return m;
  }

  /** 暂停/停止所有 deck（离开实验室时用） */
  stopAll() {
    for (const k of ['A', 'B']) this.decks[k].stop();
  }

  /* ---------- 离线渲染（验收用）：和 deck 走同一段构造 ---------- */
  async renderOffline({ deckKey = 'A', from = 0, seconds = 2, rate = 1, keylock = true }) {
    const d = this.decks[deckKey];
    if (!d.buf) throw new Error('没载入缓冲');
    const sr = d.buf.sampleRate;
    const off = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
    if (keylock && this.ST) {
      const sh = new this.ST.PitchShifter(off, d.buf, 4096);
      sh.tempo = rate; sh.pitch = 1;
      sh.connect(off.destination);
      /* 同上：setter 要 0..1 比例 */
      sh.percentagePlayed = clamp(from / d.dur, 0, 0.999);
      const out = await off.startRendering();
      return out;
    }
    const s = off.createBufferSource();
    s.buffer = d.buf; s.playbackRate.value = rate;
    s.connect(off.destination);
    s.start(0, from, seconds * rate);
    return await off.startRendering();
  }
}

export function createEngine() { return new Engine(); }

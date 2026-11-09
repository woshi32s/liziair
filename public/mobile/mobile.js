/**
 * LIZI mobile · 主界面逻辑
 *
 * 只复用桌面的数据层，不复用 app.js：
 *   - api.js      所有 /api 端点
 *   - player.js   队列 / 直链 / 歌词 / 播放
 *   - beat.js     节拍（形态要用）
 *
 * 与桌面共享的只有 localStorage 里的播放记录（lizi.hall.lastTrack），
 * 所以手机上播过什么，桌面的海报也会知道；反过来也一样。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* 和桌面同一条键：大厅海报 / 冷启动队列都靠它 */
  const LAST_KEY = 'lizi.hall.lastTrack';

  /* 形态列表：先取桌面 STAGES 里常用的十个。
     桌面 STAGES 没有导出（app.js 里的模块私有数组），以后要补全时
     直接从 app.js 抄 id/name/desc/url 即可。
     2026-11-09 与桌面同步：504、519 固定最前，其余按原顺序整体倒序。 */
  const STAGES = [
    { id: '504', name: '已发送', desc: '歌词是一条条正在打出来的消息', url: 'stages/504-imessage-lyric.html' },
    { id: '519', name: '琉璃幻境', desc: '极光流体着色器与水晶折射消散的梦境', url: 'stages/519-prism-euphoria.html' },
    { id: '658', name: '壁纸融合', desc: '把本机 Wallpaper Engine 当前壁纸铺满整屏当背景', url: 'stages/658-wallpaper-fusion.html' },
    { id: '588', name: '扳机社闪光帧', desc: '夸张广角透视、十字星爆发与黑白手绘冲击帧', url: 'stages/588-trigger-impact-frames.html' },
    { id: '571', name: '酸性液态镀铬', desc: '90 年代 Rave 酸性流光纹理与扭曲液态银异形雕塑', url: 'stages/571-acid-techno-liquid-metal.html' },
    { id: '359', name: '午夜访客', desc: '1999 年凌晨还亮着灯的个人主页，旋转铬骷髅与星空平铺', url: 'stages/359-midnight-visitor.html' },
    { id: '304', name: '童核', desc: '练习本内页：蜡笔小屋、笑脸太阳、背书包走远的人', url: 'stages/304-kidcore.html' },
    { id: '048', name: '谢尔宾斯基', desc: '镜头一直在往空洞里掉', url: 'stages/048-sierpinski-lyrics.html' },
    { id: '012', name: '光行洞穴', desc: '每句词是一条在洞里向你飞来的弧面字带', url: 'stages/012-cave-lyrics.html' },
    { id: '001', name: '粒子歌词', desc: '粒子在不同地方聚成词，镜头移过去', url: 'stages/001-particle-lyrics.html' },
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const fmtTime = (s) => {
    if (!isFinite(s) || s <= 0) return '0:00';
    const t = Math.floor(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  /* 舞台要的 accent 是原始 RGB；palette 给的是 hex */
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [150, 165, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const state = {
    view: 'hall',          // hall | now | stage
    current: null,         // 当前展示的曲目（可能是上次播放，也可能正在播）
    playing: false,
    palette: null,
    seeking: false,
    stage: null,
    stageReady: false,
  };

  /* DOM 引用（脚本在 body 末尾，元素都已存在） */
  const el = {
    hall: $('m-hall'), now: $('m-now'), stage: $('m-stage'),
    scroll: $('m-scroll'),
    heroImg: $('m-hero-img'), heroPh: $('m-hero-ph'),
    heroTag: $('m-hero-tag'), heroTitle: $('m-hero-title'), heroArtist: $('m-hero-artist'),
    heroPlay: $('m-hero-play'),
    ringView: $('m-ring-view'), ring: $('m-ring'), ringHint: $('m-ring-hint'),
    stageRail: $('m-rail-stage'),
    backdrop: $('m-backdrop-img'),
    bar: $('m-bar'), barPaint: $('m-bar-paint'),
    barImg: $('m-bar-img'), barPh: $('m-bar-ph'),
    barTitle: $('m-bar-title'), barArtist: $('m-bar-artist'),
    barOpen: $('m-bar-open'), barText: $('m-bar-text'),
    barPlay: $('m-bar-play'), barNext: $('m-bar-next'),
    nowBack: $('m-now-back'), nowMode: $('m-now-mode'),
    nowImg: $('m-now-img'), nowTitle: $('m-now-title'), nowArtist: $('m-now-artist'),
    nowLyric: $('m-now-lyric'), nowFmt: $('m-now-fmt'), nowBg: $('m-now-bg'),
    nowPrev: $('m-now-prev'), nowPlay: $('m-now-play'), nowNext: $('m-now-next'),
    dock: $('m-dock'), dockArt: $('m-dock-art'), dockImg: $('m-dock-img'),
    dockBar: $('m-dock-bar'), dockPaint: $('m-dock-paint'), dockHead: $('m-dock-head'),
    dockCur: $('m-dock-cur'), dockTotal: $('m-dock-total'),
    stageFrame: $('m-stage-frame'), stageHud: $('m-stage-hud'),
    stageBack: $('m-stage-back'), stageName: $('m-stage-name'),
    rotate: $('m-rotate'), rotateText: $('m-rotate-text'),
  };

  /* ------------------------------------------------------------------ *
   * 通用：更新界面上的“当前曲目”
   * ------------------------------------------------------------------ */
  function paintTrack(track) {
    state.current = track;
    if (!track) return;

    const cover = track.cover || '';
    const artist = track.artists || '—';

    if (cover) {
      el.heroImg.src = API.img(cover, 900);
      el.heroImg.hidden = false;
      el.heroPh.hidden = true;
      el.backdrop.src = API.img(cover, 800);
      el.barImg.src = API.img(cover, 160);
      el.barImg.hidden = false;
      el.barPh.hidden = true;
      el.nowImg.src = API.img(cover, 700);
      el.nowImg.hidden = false;
      el.dockImg.src = API.img(cover, 200);
      el.nowBg.style.backgroundImage = `url("${API.img(cover, 600)}")`;
    } else {
      el.heroImg.removeAttribute('src');
      el.heroImg.hidden = true;
      el.heroPh.hidden = false;
      el.backdrop.removeAttribute('src');
      el.barImg.removeAttribute('src');
      el.barImg.hidden = true;
      el.barPh.hidden = false;
      el.nowImg.removeAttribute('src');
      el.nowImg.hidden = true;
      el.dockImg.removeAttribute('src');
      el.nowBg.style.backgroundImage = '';
    }

    el.heroTitle.textContent = track.name || '未播放';
    el.heroArtist.textContent = artist;
    el.heroTag.textContent = state.playing ? '正在播放' : '上次播放';
    el.barTitle.textContent = track.name || '未播放';
    el.barArtist.textContent = artist;
    el.nowTitle.textContent = track.name || '未播放';
    el.nowArtist.textContent = artist;
    el.bar.hidden = false;
    document.title = track.name ? `${track.name} · ${artist}` : 'LIZI';

    /* 封面取色：沿用桌面 applyArtwork 的三色映射
       tone-a=stops[2] / tone-b=stops[3] / tone-c=stops[4]，
       色条两端 --bar-a/--bar-b 只取前两档。
       400px 的图另带 500px 别名，桌面同一首已算过就直接命中缓存。 */
    if (cover) {
      Player.paletteFromCover(API.img(cover, 400), API.img(cover, 500))
        .then((pal) => { if (pal && state.current && state.current.id === track.id) applyPalette(pal); })
        .catch(() => {});
    } else {
      applyPalette(null);
    }
  }

  function applyPalette(pal) {
    state.palette = pal;
    const rs = document.documentElement.style;
    if (pal && pal.stops && pal.stops.length >= 5) {
      rs.setProperty('--tone-a', pal.stops[2]);
      rs.setProperty('--tone-b', pal.stops[3]);
      rs.setProperty('--tone-c', pal.stops[4]);
      rs.setProperty('--bar-a', pal.stops[2]);
      rs.setProperty('--bar-b', pal.stops[3]);
    } else {
      rs.removeProperty('--tone-a');
      rs.removeProperty('--tone-b');
      rs.removeProperty('--tone-c');
      rs.removeProperty('--bar-a');
      rs.removeProperty('--bar-b');
    }
    stageInit(false);
  }

  function paintPlaying() {
    document.body.classList.toggle('is-playing', state.playing);
    if (state.current) el.heroTag.textContent = state.playing ? '正在播放' : '上次播放';
  }

  /* ------------------------------------------------------------------ *
   * 播放
   * ------------------------------------------------------------------ */
  function ensureQueueAndPlay(track, list, index) {
    if (list && list.length) return Player.playQueue(list, clamp(index || 0, 0, list.length - 1));
    return Player.playQueue([track], 0);
  }

  function playHero() {
    if (!state.current) return;
    if (Player.state.queue.length && Player.state.queue[Player.state.index]
        && Player.state.queue[Player.state.index].id === state.current.id) {
      Player.toggle();
    } else {
      ensureQueueAndPlay(state.current, null, 0);
    }
  }

  function playDaily(track) {
    const i = daily.findIndex((t) => t.id === track.id);
    ensureQueueAndPlay(track, daily, i >= 0 ? i : 0);
  }

  let daily = [];

  async function loadDaily() {
    let tracks = [];
    try {
      const s = await fetch('/api/netease/recommend/songs').then((r) => r.json());
      const arr = (s && s.data && s.data.dailySongs) || [];
      tracks = arr.map((t) => ({
        id: t.id,
        name: t.name,
        artists: (t.ar || []).map((a) => a.name).join(' / '),
        artistIds: (t.ar || []).map((a) => a.id),
        cover: (t.al && t.al.picUrl) || '',
        album: (t.al && t.al.name) || '',
        albumId: (t.al && t.al.id) || 0,
        duration: t.dt || 0,
      }));
    } catch { /* 未登录 / 边车没起：走下面的匿名兜底 */ }

    if (!tracks.length) {
      try {
        const d = await API.personalized();
        tracks = Array.isArray(d.tracks) ? d.tracks.slice(0, 12) : [];
      } catch { tracks = []; }
    }

    daily = tracks;
    buildRing();
  }

  /* ------------------------------------------------------------------ *
   * 环形推荐：一圈卡片，横向拖动旋转，松手吸附到最近的卡位
   *
   * 半径 R 决定“看得见几张”：R 越大越平；196px 时相邻卡位约 45°，
   * 正前方一张完整、左右各半张，和桌面大厅环形推荐的观感一致。
   * ------------------------------------------------------------------ */
  const ring = {
    angle: 0,
    step: 45,
    R: 196,
    dragging: false,
    moved: 0,
    startX: 0,
    startAngle: 0,
    lastX: 0,
    lastT: 0,
    vel: 0,          // deg/ms
    cards: [],
  };

  function norm180(deg) {
    let d = ((deg + 180) % 360 + 360) % 360 - 180;
    return d;
  }

  function buildRing() {
    el.ring.innerHTML = '';
    el.ringView.querySelector('.m-ring__empty')?.remove();
    ring.cards = [];
    ring.angle = 0;

    if (!daily.length) {
      /* 空态放在 ring-view 上：.m-ring 自己是 0×0 的挂载点，装不下文字 */
      const p = document.createElement('p');
      p.className = 'm-ring__empty';
      p.textContent = '暂无推荐，换歌后会自动补上';
      el.ringView.appendChild(p);
      return;
    }

    /* 卡片不够时循环补满一圈，宁可同一首出现两次，也不要一圈只有三张、
       转到空白处像卡住。 */
    const slots = Math.max(8, daily.length);
    const step = 360 / slots;
    ring.step = step;

    for (let i = 0; i < slots; i++) {
      const track = daily[i % daily.length];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'm-ring__card';
      card.setAttribute('aria-label', track.name || '播放');
      card.innerHTML = `
        ${track.cover
          ? `<img src="${API.img(track.cover, 240)}" alt="" loading="lazy" decoding="async">`
          : `<span class="m-ring__ph"><svg class="m-ico" aria-hidden="true"><use href="#mi-note"/></svg></span>`}
        <span class="m-ring__meta">
          <span class="m-ring__title">${escapeHtml(track.name || '')}</span>
          <span class="m-ring__artist">${escapeHtml(track.artists || '')}</span>
        </span>`;
      card.style.transform = `rotateY(${i * step}deg) translateZ(${ring.R}px)`;
      card.dataset.base = String(i * step);
      card.addEventListener('click', () => {
        if (ring.moved > 8) return;   // 拖动结束后的那次 click 不算点击
        playDaily(track);
      });
      el.ring.appendChild(card);
      ring.cards.push({ el: card, base: i * step });
    }
    updateRing();
  }

  function updateRing() {
    el.ring.style.transform = `rotateY(${ring.angle}deg)`;
    for (const c of ring.cards) {
      const rel = norm180(ring.angle + c.base);
      const a = Math.abs(rel);
      c.el.style.opacity = a > 100 ? '0' : String(Math.max(0.2, 1 - a / 130));
      c.el.style.pointerEvents = a < 26 ? 'auto' : 'none';
    }
  }

  function bindRing() {
    const perPixel = (180 / (Math.PI * ring.R)) * 1.45;   // 和桌面 hcc 同一条换算

    el.ringView.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      ring.dragging = true;
      ring.moved = 0;
      ring.startX = e.clientX;
      ring.startAngle = ring.angle;
      ring.lastX = e.clientX;
      ring.lastT = performance.now();
      ring.vel = 0;
      el.ring.classList.add('is-drag');
    });

    window.addEventListener('pointermove', (e) => {
      if (!ring.dragging) return;
      const dx = e.clientX - ring.startX;
      ring.moved = Math.max(ring.moved, Math.abs(dx));
      ring.angle = ring.startAngle + dx * perPixel;

      const now = performance.now();
      const dt = Math.max(1, now - ring.lastT);
      ring.vel = ((e.clientX - ring.lastX) * perPixel) / dt;
      ring.lastX = e.clientX;
      ring.lastT = now;
      updateRing();
    }, { passive: true });

    const release = () => {
      if (!ring.dragging) return;
      ring.dragging = false;
      el.ring.classList.remove('is-drag');

      /* 惯性最多再走 140ms 的距离，然后吸附到最近卡位 */
      const projected = ring.angle + campVel(ring.vel) * 140;
      const snapped = Math.round(projected / ring.step) * ring.step;
      ring.angle = snapped;
      updateRing();

      if (ring.moved > 8) el.ringHint.textContent = '';
      /* 让下一次真正点击不被这次拖动的残留量拦截 */
      setTimeout(() => { ring.moved = 0; }, 0);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  const campVel = (v) => clamp(v, -0.6, 0.6);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ *
   * 形态列表
   * ------------------------------------------------------------------ */
  function buildStageRail() {
    el.stageRail.innerHTML = '';
    STAGES.forEach((s, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `m-stage-card m-stage-card--g${i % 5}`;
      card.innerHTML = `
        <span class="m-stage-card__bg" aria-hidden="true"></span>
        <span class="m-stage-card__shade" aria-hidden="true"></span>
        <span class="m-stage-card__id">${s.id}</span>
        <span class="m-stage-card__body">
          <span class="m-stage-card__name">${escapeHtml(s.name)}</span>
          <span class="m-stage-card__desc">${escapeHtml(s.desc)}</span>
        </span>`;
      card.addEventListener('click', () => openStage(s));
      el.stageRail.appendChild(card);
    });
  }

  /* ------------------------------------------------------------------ *
   * 视图 / 方向
   * ------------------------------------------------------------------ */
  const mqLandscape = window.matchMedia('(orientation: landscape)');
  const mqCoarse = window.matchMedia('(pointer:coarse)');

  function setView(next) {
    state.view = next;
    document.body.dataset.view = next;
    el.hall.hidden = next !== 'hall';
    el.now.hidden = next !== 'now';
    el.stage.hidden = next !== 'stage';
    orientGate();
  }

  /**
   * 方向引导只对触屏设备生效：
   *   - 形态：必须横屏；竖着拿时盖一层“请横屏观看”。
   *   - 大厅 / 播放页：竖屏设计；横着拿时盖“请转回竖屏”。
   * 桌面浏览器（pointer:fine）不拦截，方便在电脑上预览。
   */
  function orientGate() {
    if (!mqCoarse.matches) { el.rotate.hidden = true; return; }
    const wantLandscape = state.view === 'stage';
    const wrong = wantLandscape ? !mqLandscape.matches : mqLandscape.matches;
    el.rotate.hidden = !wrong;
    if (wrong) el.rotateText.textContent = wantLandscape ? '请横屏观看' : '请转回竖屏';
  }

  /* ------------------------------------------------------------------ *
   * 形态 iframe 协议（宿主 → 作品）
   * 和桌面 StageHost 对齐：ready → init 一次，然后 66ms 一次 tick。
   * ------------------------------------------------------------------ */
  let stageTickTimer = 0;
  let lastInitSig = '';

  function postStage(type, payload) {
    const w = el.stageFrame.contentWindow;
    if (!w) return;
    try { w.postMessage({ __c100: 1, type, payload }, '*'); } catch { /* 忽略 */ }
  }

  function stageLyricSchedule() {
    const ls = Player.state.lyric || [];
    return ls.map((l, i) => ({
      t: l.t,
      dur: l.dur || (ls[i + 1] ? Math.max(0.4, ls[i + 1].t - l.t) : 6),
      text: l.text,
      chars: l.chars ? l.chars.map((c) => ({ c: c.c, t: c.t })) : null,
    }));
  }

  function stageInit(force) {
    if (state.view !== 'stage' || !state.stageReady) return;
    const tr = Player.state.queue[Player.state.index] || state.current;
    const ls = Player.state.lyric || [];
    const accent = state.palette ? hexRgb(state.palette.stops ? state.palette.stops[2] : '') : [150, 165, 255];
    const sig = [
      tr ? tr.id : 0,
      ls.length,
      ls.length ? ls[0].t : 0,
      ls.length ? ls[ls.length - 1].t : 0,
      ls.length && ls[0].chars ? ls[0].chars.length : 0,
      accent.join(','),
    ].join('|');
    if (!force && sig === lastInitSig) return;
    lastInitSig = sig;

    postStage('init', {
      song: tr ? { id: tr.id, name: tr.name, album: tr.album || '', artists: tr.artists, cover: tr.cover } : null,
      accent,
      lines: stageLyricSchedule(),
      duration: Player.audio.duration || 0,
    });
  }

  function startStageTick() {
    stopStageTick();
    stageTickTimer = setInterval(() => {
      if (state.view !== 'stage') return;
      postStage('tick', {
        time: (Player.audio.currentTime || 0) - (window.__lyricDelayMs || 0) / 1000,
        playing: !Player.audio.paused,
      });
    }, 66);
  }

  function stopStageTick() {
    if (stageTickTimer) clearInterval(stageTickTimer);
    stageTickTimer = 0;
  }

  function openStage(s) {
    state.stage = s;
    state.stageReady = false;
    lastInitSig = '';
    el.stageName.textContent = `${s.name} · ${s.id}`;
    el.stageFrame.src = `../${s.url}`;
    setView('stage');
    showHud();
  }

  function exitStage() {
    stopStageTick();
    state.stageReady = false;
    state.stage = null;
    /* 把 iframe 置空：形态里的 WebGL / 音频停了才算真退出，
       不然它会在后台继续跑（桌面同样用 about:blank 收尾）。 */
    el.stageFrame.src = 'about:blank';
    setView('hall');
  }

  let hudTimer = 0;
  function showHud() {
    clearTimeout(hudTimer);
    el.stageHud.classList.remove('is-idle');
    hudTimer = setTimeout(() => el.stageHud.classList.add('is-idle'), 2600);
  }

  /* ------------------------------------------------------------------ *
   * 进度
   * ------------------------------------------------------------------ */
  function paintProgress(cur, total) {
    const r = total > 0 ? clamp(cur / total, 0, 1) : 0;
    const clip = `inset(0 ${(1 - r) * 100}% 0 0)`;
    el.barPaint.style.clipPath = clip;
    el.dockPaint.style.clipPath = clip;
    el.dockHead.style.left = `${r * 100}%`;
    el.dockBar.classList.toggle('is-on', r > 0);
    el.dockCur.textContent = fmtTime(cur);
    el.dockTotal.textContent = fmtTime(total);
  }

  /** 进度条拖动：按下即进入 seeking，松手才真正 seek —— 拖动过程中
   *  time 事件不能回来抢播放头，否则头会跟手指打架。 */
  function bindDockSeek() {
    let dragging = false;

    const ratioAt = (clientX) => {
      const r = el.dockBar.getBoundingClientRect();
      return clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    };

    const preview = (ratio) => {
      const total = Player.audio.duration;
      if (!isFinite(total) || total <= 0) return;
      paintProgress(ratio * total, total);
    };

    el.dockBar.addEventListener('pointerdown', (e) => {
      dragging = true;
      state.seeking = true;
      el.dockBar.setPointerCapture?.(e.pointerId);
      preview(ratioAt(e.clientX));
    });

    el.dockBar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      preview(ratioAt(e.clientX));
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      state.seeking = false;
      const total = Player.audio.duration;
      if (isFinite(total) && total > 0) Player.seek(ratioAt(e.clientX) * total);
    };
    el.dockBar.addEventListener('pointerup', end);
    el.dockBar.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */
  function bindUI() {
    el.heroPlay.addEventListener('click', playHero);
    el.barText.addEventListener('click', () => { if (state.current) setView('now'); });
    el.barOpen.addEventListener('click', () => { if (state.current) setView('now'); });
    el.barPlay.addEventListener('click', playHero);
    el.barNext.addEventListener('click', () => {
      if (Player.state.queue.length) Player.next();
    });

    el.nowBack.addEventListener('click', () => setView('hall'));
    el.nowPrev.addEventListener('click', () => {
      if (Player.state.queue.length) Player.prev();
    });
    el.nowPlay.addEventListener('click', playHero);
    el.nowNext.addEventListener('click', () => {
      if (Player.state.queue.length) Player.next();
    });
    el.dockArt.addEventListener('click', () => Player.toggle());

    /* 播放模式：真接 Player.cycleMode，不是装饰按钮 */
    el.nowMode.addEventListener('click', () => {
      if (!Player.state.queue.length) return;
      Player.cycleMode();
    });

    el.stageBack.addEventListener('click', exitStage);
    el.stageHud.addEventListener('pointerdown', () => showHud());

    bindDockSeek();
    bindRing();

    window.addEventListener('message', (e) => {
      if (!el.stageFrame.contentWindow || e.source !== el.stageFrame.contentWindow) return;
      const d = e.data;
      if (!d || d.__c100 !== 1) return;
      if (d.type === 'ready') {
        state.stageReady = true;
        stageInit(true);
        startStageTick();
        showHud();
      } else if (d.type === 'activity') {
        showHud();
      } else if (d.type === 'key' && d.payload && d.payload.key === 'Space') {
        Player.toggle();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/^(input|textarea)$/i.test(e.target.tagName)) {
        e.preventDefault();
        Player.toggle();
      }
    });

    mqLandscape.addEventListener('change', orientGate);
    window.addEventListener('resize', orientGate, { passive: true });
    if (mqCoarse.addEventListener) mqCoarse.addEventListener('change', orientGate);
  }

  /* ------------------------------------------------------------------ *
   * 播放器事件
   * ------------------------------------------------------------------ */
  function bindPlayer() {
    Player.on('trackchange', ({ track }) => {
      saveTrack(track);
      paintTrack(track);
      paintProgress(0, Player.audio.duration || 0);
      el.nowLyric.textContent = '—';
      el.nowFmt.textContent = '';
      stageInit(true);          // 形态正开着时，换歌要再推一次 init
    });

    Player.on('playstate', (playing) => {
      state.playing = !!playing;
      paintPlaying();
    });

    Player.on('time', ({ cur, total }) => {
      if (state.seeking) return;
      paintProgress(cur, total);
    });

    Player.on('lyric', ({ lines, active, format }) => {
      if (format) el.nowFmt.textContent = format === 'yrc' ? '逐字' : '歌词';
      if (active >= 0 && lines[active]) {
        el.nowLyric.textContent = lines[active].tr
          ? `${lines[active].text}　${lines[active].tr}`
          : lines[active].text;
      } else {
        el.nowLyric.textContent = '—';
      }
      stageInit(false);
    });

    Player.on('mode', (m) => {
      el.nowMode.textContent = { order: '顺序', loop: '循环', single: '单曲', shuffle: '随机' }[m] || '顺序';
    });

    /* 形态的节拍信号：不少形态靠 beat 做脉冲，缺了会显得“没反应”。
       只在舞台打开时转发，大厅/播放页不需要。 */
    if (typeof Beat !== 'undefined' && Beat.on) {
      Beat.on('beat', (b) => {
        if (state.view === 'stage' && state.stageReady) {
          postStage('beat', { index: b.index, level: b.level });
        }
      });
    }
  }

  /* 和桌面 Hall.saveTrack 同一形状：手机播过什么，桌面海报也知道 */
  function saveTrack(track) {
    if (!track || !track.id) return;
    const last = {
      id: track.id,
      source: track.source || 'netease',
      mid: track.mid || '',
      hash: track.hash || '',
      albumIdNum: track.albumIdNum || 0,
      albumAudioId: track.albumAudioId || 0,
      name: track.name || '',
      artists: track.artists || '',
      artistIds: track.artistIds || [],
      album: track.album || '',
      albumId: track.albumId || null,
      cover: track.cover || '',
      duration: track.duration || 0,
      at: Date.now(),
    };
    try { localStorage.setItem(LAST_KEY, JSON.stringify(last)); } catch { /* 隐私模式 */ }
  }

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; }
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function init() {
    document.body.dataset.view = 'hall';
    buildStageRail();
    bindUI();
    bindPlayer();

    const saved = readSaved();
    if (saved && saved.id) {
      paintTrack(saved);
      paintProgress(0, 0);
    } else {
      el.heroTag.textContent = '开始';
      el.heroTitle.textContent = '还没有播放';
    }

    loadDaily();
    orientGate();
  }

  init();
})();

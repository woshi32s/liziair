/**
 * LIZI · 手机大厅
 * --------------------------------------------------------------------------
 * 只复用桌面的数据层和播放引擎：
 *   api.js     /api 端点（登录态在服务端 .session.json）
 *   player.js  队列 / 直链 / 演示音轨 / 封面取色
 *   beat.js    播放时的节拍（player.js 的 toggle 会用它）
 *
 * 不引 app.js / app.css —— 那两套绑死桌面 DOM。
 * 布局（1:1 封面 / 极简导航 / 跑马带 + 按住成环）全在本文件里驱动，
 * 不做 1280 缩放。三个视觉件各管一摊：
 *   nav.js     平台/来源的极简选中态
 *   ring.js    平面跑马带 → 按住展开成桌面同款 3D 圆环
 *   coverfx.js 封面 A→黑→B 的半调网点揭示
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------------ *
   * 存储：新页面自己的键统一 lizi.m.*，不和桌面端已有的键撞
   * ------------------------------------------------------------------ */
  const KEY = {
    plat: 'lizi.m.plat',
    src: 'lizi.m.src',
    motion: 'lizi.m.reduce-motion',
    power: 'lizi.m.low-power',
    updateDismissed: 'lizi.m.update.dismissed',
    searchPlat: 'lizi.m.search.plat',
    searchHist: 'lizi.m.search.hist',
  };
  const readLs = (k, d) => {
    try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; }
  };
  const writeLs = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式 */ } };

  /* ------------------------------------------------------------------ *
   * 平台：和桌面大厅同一套五家（logo 与品牌色都来自 assets/platforms）
   * ------------------------------------------------------------------ */
  const PLATS = [
    { id: 'netease', name: '网易云', nav: '网易', logo: '../assets/platforms/netease.svg', color: '#EA3E3C', bg: '#EA3E3C', ink: '#FFFFFF' },
    { id: 'qq', name: 'QQ 音乐', nav: 'QQ', logo: '../assets/platforms/qq.svg', color: '#F8C913', bg: '#F8C913', ink: '#1A1A1A' },
    { id: 'kugou', name: '酷狗', nav: '酷狗', logo: '../assets/platforms/kugou-mark.svg', color: '#3D8BFA', bg: '#3D8BFA', ink: '#FFFFFF' },
    { id: 'qishui', name: '汽水', nav: '汽水', logo: '../assets/platforms/qishui.svg', color: '#111111', bg: '#111111', ink: '#FFFFFF' },
    { id: 'bodian', name: '波点', nav: '波点', logo: '../assets/platforms/bodian.svg', color: '#04E3B4', bg: '#04E3B4', ink: '#062A24' },
  ];
  const PLAT = (id) => PLATS.find((p) => p.id === id) || PLATS[0];
  const PLAT_NICE = Object.fromEntries(PLATS.map((p) => [p.id, p.name]));

  /* 搜索页签：桌面同款「全部 + 五家」。全部时并行请求，按平台分组列。 */
  const SEARCH_SRCS = [
    { id: 'all', name: '全部' },
    ...PLATS.map((p) => ({ id: p.id, name: p.name })),
  ];
  const SEARCH_NAME = Object.fromEntries(SEARCH_SRCS.map((s) => [s.id, s.name]));

  /* nav 是导航行里用的短名：五个平台 + 五个来源要在两行里同时排下，
     位置固定（星线的锚点依赖这一点），所以不用全名。 */
  const SRC_ITEMS = [
    { id: 'daily', name: '每日推荐', nav: '每日推荐', unit: '首' },
    { id: 'featured', name: '精选', nav: '精选', unit: '个' },
    { id: 'liked', name: '我的喜欢', nav: '我的喜欢', unit: '首' },
    { id: 'playlists', name: '收藏', nav: '收藏', unit: '个' },
    { id: 'radio', name: '电台', nav: '电台', unit: '个' },
  ];
  const SRC_NAME = Object.fromEntries(SRC_ITEMS.map((s) => [s.id, s.name]));

  /* 设置页「平台账号」一行的文案，照桌面设置页；账号状态由 accounts.js 提供 */
  const ACCT_META = {
    netease: { name: '网易云音乐', hint: '登录后可同步歌单与收藏' },
    qq: { name: 'QQ 音乐', hint: '播放需登录 · 第三方协议' },
    kugou: { name: '酷狗音乐', hint: '播放需登录' },
    qishui: { name: '汽水音乐', hint: '未登录只有 30 秒试听 · 要 Node 24' },
    bodian: { name: '波点音乐', hint: '未登录只有 30 秒试听 · 仅大陆网络' },
  };

  /* ------------------------------------------------------------------ *
   * 偏好
   * ------------------------------------------------------------------ */
  let prefMotion = readLs(KEY.motion, '0') === '1';
  let prefPower = readLs(KEY.power, '0') === '1';

  function applyPrefs() {
    document.body.classList.toggle('is-rm', prefMotion);
    document.body.classList.toggle('is-lowpower', prefPower);
    if (el.switchMotion) el.switchMotion.setAttribute('aria-checked', String(prefMotion));
    if (el.switchPower) el.switchPower.setAttribute('aria-checked', String(prefPower));
    if (prefPower) clearTone();
    else if (S.coverItem) paintTone(S.coverItem);
  }

  /* ------------------------------------------------------------------ *
   * DOM
   * ------------------------------------------------------------------ */
  const el = {
    bg: $('m-bg'),
    cover: $('cover'), imgA: $('cover-img-a'), imgB: $('cover-img-b'), coverFx: $('cover-fx'),
    tag: $('cover-tag'), title: $('cover-title'), sub: $('cover-sub'),
    play: $('cover-play'), demo: $('cover-demo'),
    btnMe: $('btn-me'),
    platRow: $('plat-row'), srcRow: $('src-row'),
    strip: $('mstrip'), track: $('mtrack'),
    ringMsg: $('ring-msg'),
    back: $('ring-back'), backLabel: $('ring-back-label'),
    pbar: $('pbar'), pbarFill: $('pbar-fill'),
    search: $('sheet-search'), searchInput: $('search-input'), searchBody: $('search-body'),
    searchSrc: $('search-src'), searchHint: $('search-hint'),
    searchClose: $('search-close'), btnSearch: $('btn-search'),
    me: $('sheet-me'), meBody: $('me-body'), meClose: $('me-close'),
    artist: $('sheet-artist'), artistBody: $('artist-body'), artistClose: $('artist-close'),
    album: $('sheet-album'), albumBody: $('album-body'), albumClose: $('album-close'),
    forms: $('sheet-forms'), formsGrid: $('forms-grid'), formsClose: $('forms-close'),
    stage: $('stage-view'), stageFrame: $('stage-frame'), stageBack: $('stage-back'), stageName: $('stage-name'),
    tools: $('sheet-tools'), toolsClose: $('tools-close'),
    albums: $('sheet-albums'), albumsGrid: $('albums-grid'), albumsClose: $('albums-close'),
    toolForms: $('tool-forms'),
    now: $('sheet-now'), nowClose: $('now-close'), nowForm: $('now-form'),
    nowPhoto: $('now-photo'), nowArtWrap: $('now-art-wrap'),
    nowArt: $('now-art'), nowArtPh: $('now-art-ph'),
    nowTitle: $('now-title'),
    nowGrip: $('now-grip'), nowGripBot: $('now-grip-bot'),
    nowCur: $('now-cur'), nowDur: $('now-dur'),
    nowBar: $('now-bar'), nowFill: $('now-fill'), nowKnob: $('now-knob'),
    nowPlay: $('now-play'), nowPrev: $('now-prev'), nowNext: $('now-next'), nowMode: $('now-mode'),
    nowLyrics: $('now-lyrics'), nowLyrScroll: $('now-lyrics-scroll'),
    settings: $('sheet-settings'), setClose: $('set-close'), btnSettings: $('btn-settings'),
    switchMotion: $('set-motion'), switchPower: $('set-power'),
    setUpdate: $('set-update'), ver: $('set-ver'), setAccounts: $('set-accounts'),
    update: $('sheet-update'), updVer: $('upd-ver'), updNote: $('upd-note'), updClose: $('upd-close'),
    toast: $('toast'),
  };

  const hasPlayer = typeof Player !== 'undefined' && Player && typeof Player.on === 'function';

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const S = {
    plat: PLAT(readLs(KEY.plat, 'netease')).id,
    src: SRC_ITEMS.some((s) => s.id === readLs(KEY.src, '')) ? readLs(KEY.src, '') : 'daily',
    type: 'tracks',          // tracks | collections
    items: [],
    coverItem: null,
    coverKind: 'track',
    drilled: null,           // { kind:'playlist'|'station', item, src, rootKind, rootLabel }
    srcName: '每日推荐',
    empty: '',
    playing: false,
    seq: 0,
  };

  let hallNav = null;                      // 极简导航
  let ring = null;                         // 跑马带 + 按住成环
  let coverFx = null;                      // 半调封面切换

  /* 搜索 */
  const savedSearchPlat = readLs(KEY.searchPlat, S.plat);
  let searchPlat = SEARCH_SRCS.some((p) => p.id === savedSearchPlat) ? savedSearchPlat : S.plat;
  let searchHist = [];
  try {
    const rawHist = JSON.parse(readLs(KEY.searchHist, '[]'));
    searchHist = Array.isArray(rawHist)
      ? rawHist.filter((x) => typeof x === 'string' && x.trim()).slice(0, 8)
      : [];
  } catch { searchHist = []; }

  /* 账号 / 我的 */
  let meOpen = false;
  let meSeq = 0;
  let meList = [];                         // 已登录平台：[{ id, name, accent, nickname, avatar, key, detail }]
  let meSel = null;
  let accountStatus = null;                // { at, rows }
  let accountPromise = null;
  let setAcctSeq = 0;
  let artistOpen = false;
  let albumOpen = false;
  let formsOpen = false;
  let stageOpen = false;
  let toolsOpen = false;
  let albumsOpen = false;
  let nowOpen = false;
  let nowDuration = 0;
  let pendingDrill = -1;                   // 环里选歌单：等环的历史记录先弹掉再下钻
  let coverUrl = '';
  let coverFlip = 0;
  let coverToken = 0;
  let toneToken = 0;

  /* 网易云登录态：只问一次；点赞 / 收藏要靠它拿 uid */
  let sessionP = Promise.resolve({ loggedIn: false });
  try { sessionP = API.session().catch(() => ({ loggedIn: false })); } catch { /* 忽略 */ }

  /* ------------------------------------------------------------------ *
   * 通用 UI
   * ------------------------------------------------------------------ */
  const esc = (s) => String(s == null ? '' : s);

  function mk(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  const fmtBig = (n) => {
    const v = Number(n) || 0;
    return v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(v);
  };

  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('is-on'));
    clearTimeout(toast.t);
    toast.t = setTimeout(() => {
      el.toast.classList.remove('is-on');
      setTimeout(() => { if (!el.toast.classList.contains('is-on')) el.toast.hidden = true; }, 220);
    }, 1900);
  }

  function clearTone() {
    const rs = document.documentElement.style;
    rs.removeProperty('--tone-a');
    rs.removeProperty('--tone-b');
    rs.removeProperty('--tone-c');
  }

  function applyTone(pal) {
    if (!pal || !pal.stops || pal.stops.length < 5) return;
    palette = pal;
    const rs = document.documentElement.style;
    rs.setProperty('--tone-a', pal.stops[2]);
    rs.setProperty('--tone-b', pal.stops[3]);
    rs.setProperty('--tone-c', pal.stops[4]);
  }

  function paintTone(item) {
    if (prefPower || !hasPlayer || !item || !item.cover) return;
    const token = ++toneToken;
    try {
      const p = Player.paletteFromCover(API.img(item.cover, 320), API.img(item.cover, 480));
      Promise.resolve(p).then((pal) => {
        if (token !== toneToken) return;
        if (pal) applyTone(pal); else clearTone();
      }).catch(() => { /* 取色失败就用默认令牌 */ });
    } catch { /* 忽略 */ }
  }

  /* ------------------------------------------------------------------ *
   * 平台选择
   * ------------------------------------------------------------------ */
  function paintPlatform() {
    if (hallNav) hallNav.setActive('plat', S.plat);
    updateLabels();
  }

  function selectPlatform(id) {
    if (id === S.plat) return;
    S.plat = id;
    writeLs(KEY.plat, id);
    paintPlatform();
    clearDrill(false);
    loadSource(S.src);
  }

  /* ------------------------------------------------------------------ *
   * 推荐来源
   * ------------------------------------------------------------------ */
  function paintSources() {
    if (hallNav) hallNav.setActive('src', S.src);
  }

  function selectSource(id) {
    if (id === S.src && !S.drilled) return;
    clearDrill(false);
    loadSource(id);
  }

  /* ------------------------------------------------------------------ *
   * 数据层：映射规则和桌面 app.js 的 rail* 同一套，不另编字段
   * ------------------------------------------------------------------ */
  function ncSong(t) {
    return {
      id: t.id,
      source: 'netease',
      name: t.name,
      artists: (t.ar || []).map((a) => a.name).join(' / '),
      artistIds: (t.ar || []).map((a) => a.id),
      cover: (t.al && t.al.picUrl) || '',
      album: (t.al && t.al.name) || '',
      albumId: (t.al && t.al.id) || 0,
      duration: t.dt || 0,
    };
  }

  function ncProgramTrack(p) {
    const s = p.mainSong || {};
    const ar = s.artists || s.ar || [];
    const al = s.album || s.al || {};
    return {
      id: String(s.id || p.id || ''),
      source: 'netease',
      name: p.name || s.name || '',
      artists: ar.map((a) => a.name).filter(Boolean).join(' / ') || '未知歌手',
      artistIds: ar.map((a) => String(a.id)).filter(Boolean),
      album: al.name || '',
      albumId: al.id ? String(al.id) : '',
      cover: p.coverUrl || al.picUrl || '',
      duration: Number(s.duration || s.dt) || 0,
    };
  }

  const platFail = (d, fb) => (d && Number(d.code) === 404
    ? '接口已接好，重启 LIZI 后生效'
    : ((d && d.error) || fb));

  function railTracks(pid, arr, emptyNote) {
    const items = (arr || [])
      .filter((t) => t && t.id != null && t.name)
      .map((t) => (t.source ? t : { ...t, source: pid }));
    return { type: 'tracks', items, empty: items.length ? '' : (emptyNote || '这一层没有歌曲') };
  }

  function railColls(pid, arr, emptyNote) {
    const items = (arr || [])
      .filter((p) => p && p.id && p.name)
      .map((p) => (p.source ? p : { ...p, source: pid }));
    return { type: 'collections', items, empty: items.length ? '' : (emptyNote || '这一层没有歌单') };
  }

  const railNone = (note) => ({ type: 'tracks', items: [], empty: note });

  /* ---- 每日推荐：每家用自己能给的推荐流（匿名能取的就匿名取） ---- */
  async function railDaily(pid) {
    if (pid === 'netease') {
      let tracks = [];
      try {
        const s = await API.neteaseDaily();
        tracks = ((s && s.data && s.data.dailySongs) || []).map(ncSong);
      } catch { /* 未登录 / 边车没起：走匿名兜底 */ }
      if (!tracks.length) {
        try { const d = await API.personalized(); tracks = (d && d.tracks) || []; } catch { tracks = []; }
      }
      return railTracks('netease', tracks, '网易云「每日推荐」暂时没返回内容');
    }
    if (pid === 'kugou') {
      const d = await API.kugouDaily();
      return railTracks('kugou', (d && d.tracks) || [], (d && d.error) || '酷狗没返回每日推荐');
    }
    if (pid === 'qishui') {
      const d = await API.qishuiFeed(20);
      return railTracks('qishui', (d && d.tracks) || [], (d && d.error) || '汽水没返回推荐流');
    }
    if (pid === 'qq') {
      let t = [];
      try { const d = await API.qqDailySongs(); t = (d && d.tracks) || []; } catch { /* 未登录 */ }
      if (!t.length) {
        try { const r = await API.qqRecommendRadar(1); t = (r && r.tracks) || []; } catch { t = []; }
      }
      return railTracks('qq', t, 'QQ 音乐每日推荐要登录；匿名雷达也没返回歌曲');
    }
    if (pid === 'bodian') {
      const d = await API.bodianDaily(0);
      if (!d || Number(d.code) !== 200) {
        return railTracks('bodian', [], platFail(d, (d && d.error) || '波点日推失败'));
      }
      return railTracks('bodian', (d && d.tracks) || [], '波点日推没返回歌曲');
    }
    return railNone('这一家没有每日推荐接口');
  }

  /* ---- 精选 ---- */
  async function railFeatured(pid) {
    if (pid === 'netease') {
      const d = await API.topPlaylists(12);
      const list = ((d && d.playlists) || []).map((p) => ({
        id: String(p.id), name: p.name, cover: p.cover,
        trackCount: p.tracks || 0, playCount: p.count || 0,
        creator: { nickname: p.creator || '' }, source: 'netease',
      }));
      return railColls('netease', list, '网易云没返回推荐歌单');
    }
    if (pid === 'qq') {
      const d = await API.qqRecommendPlaylists(9);
      return railColls('qq', (d && d.playlists) || [], (d && d.error) || 'QQ 音乐没返回推荐歌单');
    }
    if (pid === 'kugou') {
      const d = await API.kugouTopSongs(1);
      return railTracks('kugou', (d && d.tracks) || [], (d && d.error) || '酷狗没返回新歌');
    }
    if (pid === 'qishui') {
      const d = await API.qishuiFeed(20);
      return railTracks('qishui', (d && d.tracks) || [], (d && d.error) || '汽水没返回推荐流');
    }
    if (pid === 'bodian') {
      const d = await API.bodianRecommendations();
      return railColls('bodian', (d && d.playlists) || [], platFail(d, '波点没返回推荐歌单'));
    }
    return railNone('这一家没有精选接口');
  }

  /* ---- 我的喜欢 ---- */
  async function railLiked(pid) {
    if (pid === 'netease') {
      const sess = await sessionP;
      const profile = sess && sess.profile;
      if (!profile || !profile.userId) return railNone('先在桌面端登录网易云，手机上才能看「我的喜欢」');
      const d = await API.userPlaylists(profile.userId);
      const lists = (d && d.playlists) || [];
      const like = lists.find((p) => p.specialType === 5)
        || lists.find((p) => /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
      if (!like) return railNone('没找到「我喜欢的音乐」歌单');
      const t = await API.playlistDetail(like.id);
      return railTracks('netease', (t && t.tracks) || [], (t && t.error) || '这张歌单没有曲目');
    }
    if (pid === 'qq') {
      const d = await API.qqLikedSongs(100);
      return railTracks('qq', (d && d.tracks) || [], (d && d.error) || 'QQ 音乐的「我喜欢」是空的');
    }
    if (pid === 'kugou') return railNone('酷狗包里没有「我喜欢的音乐」列表接口 —— 不编内容');
    if (pid === 'qishui') {
      const d = await API.qishuiUserPlaylists();
      const list = (d && d.playlists) || [];
      const like = list.find((p) => Number(p.type) === 1)
        || list.find((p) => /我喜欢的音乐|喜欢的音乐/.test(p.name || ''));
      if (!like) return railNone(platFail(d, '没找到汽水的「我喜欢的音乐」歌单'));
      const t = await API.qishuiPlaylistTracks(like.id, 50);
      return railTracks('qishui', (t && t.tracks) || [], (t && t.error) || '这张歌单没有曲目');
    }
    if (pid === 'bodian') {
      const d = await API.bodianLikedSongs();
      return railTracks('bodian', (d && d.tracks) || [], platFail(d, '波点的「我喜欢」是空的'));
    }
    return railNone('这一家没有「我的喜欢」接口');
  }

  /* ---- 收藏的歌单 ---- */
  async function railMyPlaylists(pid) {
    if (pid === 'netease') {
      const sess = await sessionP;
      const profile = sess && sess.profile;
      if (!profile || !profile.userId) return railNone('先在桌面端登录网易云，手机上才能看「我收藏的歌单」');
      const d = await API.userPlaylists(profile.userId);
      const lists = (d && d.playlists) || [];
      const out = [];
      const seen = new Set();
      for (const p of lists) {
        if (!p || !p.id) continue;
        const k = String(p.id);
        if (seen.has(k)) continue;
        seen.add(k);
        if (p.specialType === 5 || /我喜欢的音乐|喜欢的音乐/.test(p.name || '')) continue;
        out.push(p);
      }
      return railColls('netease', out, '还没有收藏或创建任何歌单');
    }
    if (pid === 'qq') {
      const d = await API.qqUserPlaylists();
      return railColls('qq', (d && d.playlists) || [], (d && d.error) || 'QQ 音乐没有返回歌单');
    }
    if (pid === 'kugou') {
      const d = await API.kugouUserPlaylists();
      return railColls('kugou', (d && d.playlists) || [], (d && d.error) || '酷狗没有返回歌单');
    }
    if (pid === 'qishui') {
      const d = await API.qishuiUserPlaylists();
      const list = ((d && d.playlists) || []).filter((p) => Number(p.type) !== 1);
      return railColls('qishui', list, platFail(d, '汽水没有返回歌单'));
    }
    if (pid === 'bodian') {
      const d = await API.bodianUserPlaylists();
      return railColls('bodian', (d && d.playlists) || [], platFail(d, '波点没有返回歌单'));
    }
    return railNone('这一家没有用户歌单接口');
  }

  /* ---- 电台：网易云 / QQ / 酷狗 / 汽水是频道；波点是曲目 ---- */
  async function railRadio(pid) {
    if (pid === 'netease') {
      const d = await API.neteaseDjRecommend(8);
      const list = ((d && d.djRadios) || []).map((r) => ({
        id: String(r.id), name: r.name, cover: r.picUrl,
        trackCount: r.programCount || 0, playCount: r.playCount || 0,
        creator: { nickname: (r.dj && r.dj.nickname) || '' }, source: 'netease',
      }));
      return railColls('netease', list, '网易云没返回推荐电台');
    }
    if (pid === 'qq') {
      const d = await API.qqRadioCategories();
      return railColls('qq', (d && d.stations) || [], platFail(d, 'QQ 音乐没返回电台频道'));
    }
    if (pid === 'kugou') {
      const d = await API.kugouRadioStations();
      return railColls('kugou', (d && d.stations) || [], platFail(d, '酷狗没返回电台频道'));
    }
    if (pid === 'qishui') {
      const d = await API.qishuiFeedModes();
      return railColls('qishui', (d && d.stations) || [], platFail(d, '汽水没返回场景电台'));
    }
    if (pid === 'bodian') {
      const d = await API.bodianPersonalFm();
      return railTracks('bodian', (d && d.tracks) || [], platFail(d, '波点私人 FM 没返回歌曲'));
    }
    return railNone('这一家没有电台接口');
  }

  function railFetch(pid, kind) {
    if (kind === 'daily') return railDaily(pid);
    if (kind === 'featured') return railFeatured(pid);
    if (kind === 'liked') return railLiked(pid);
    if (kind === 'playlists') return railMyPlaylists(pid);
    if (kind === 'radio') return railRadio(pid);
    return Promise.resolve(railNone('未知的内容层级'));
  }

  /* 歌单 / 电台下钻 */
  function playlistApi(pid, p) {
    const src = pid || (p && p.source) || 'netease';
    return src === 'qq' ? API.qqPlaylistDetail(p.id)
      : src === 'kugou' ? API.kugouPlaylistTracks(p.id)
        : src === 'qishui' ? API.qishuiPlaylistTracks(p.id)
          : src === 'bodian' ? API.bodianPlaylistTracks(p.id, 50, p.sourceType)
            : API.playlistDetail(p.id);
  }

  async function loadDrilled() {
    const d = S.drilled;
    if (!d) return;
    if (d.kind === 'playlist') {
      const data = await playlistApi(d.src, d.item);
      return railTracks(d.src, (data && data.tracks) || [], (data && data.error) || '这张歌单没有曲目');
    }
    if (d.src === 'netease') {
      const data = await API.neteaseDjPrograms(d.item.id, 50);
      const tr = ((data && data.programs) || []).map(ncProgramTrack).filter((t) => t.id && t.name);
      return railTracks('netease', tr, '这个电台暂时没有节目');
    }
    if (d.src === 'qq') {
      const data = await API.qqRadioTracks(d.item.id);
      return railTracks('qq', (data && data.tracks) || [], platFail(data, '这个电台暂时没有曲目'));
    }
    if (d.src === 'kugou') {
      const data = await API.kugouRadioTracks(d.item.id, 30);
      return railTracks('kugou', (data && data.tracks) || [], platFail(data, '这个电台暂时没有曲目'));
    }
    if (d.src === 'qishui') {
      const data = await API.qishuiFeed(50, d.item.id);
      return railTracks('qishui', (data && data.tracks) || [], platFail(data, '这个场景暂时没有曲目'));
    }
    return railNone('这个频道暂时没有曲目');
  }

  /* ------------------------------------------------------------------ *
   * 视图
   * ------------------------------------------------------------------ */
  function updateLabels() {
    const p = PLAT(S.plat);
    const label = S.drilled ? S.drilled.item.name : (SRC_NAME[S.src] || '');
    const rootKind = S.drilled ? S.drilled.rootKind : S.src;
    if (S.drilled) {
      el.back.hidden = false;
      el.backLabel.textContent = `返回${SRC_NAME[S.src] || ''}`;
    } else {
      el.back.hidden = true;
    }
  }

  function setLoading(note) {
    if (ring && typeof ring.setItems === 'function') ring.setItems([]);
    el.ringMsg.hidden = false;
    el.ringMsg.textContent = note || '正在载入…';
  }

  /* 跑马带使用的形状：key 必须跨平台唯一；raw 留给播放/下钻时反查原对象 */
  function ringItems() {
    const tag = (S.drilled ? S.drilled.rootKind : S.src) === 'radio' ? '电台' : '歌单';
    return S.items.map((it) => ({
      key: (it.source || (S.drilled ? S.drilled.src : S.plat)) + ':' + String(it.id),
      cover: it.cover ? API.img(it.cover, 240) : '',
      title: it.name || '未命名',
      sub: S.type === 'collections'
        ? ((it.creator && it.creator.nickname) || tag)
        : (it.artists || it.album || '—'),
      raw: it,
    }));
  }

  function applyResult(res, label) {
    S.type = res.type === 'collections' ? 'collections' : 'tracks';
    S.items = (res.items || []).slice(0, 60);
    S.empty = res.empty || '';
    S.srcName = label;
    const first = S.items[0] || null;
    /* 切平台/切来源只换下面的跑马带：上半张封面永远是当前播放的那首。
       只有用户主动下钻歌单时才让封面跟着换（那是他在浏览歌单本身）。 */
    const cur = hasPlayer ? (Player.state.queue[Player.state.index] || null) : null;
    if (cur && !S.drilled) {
      S.coverKind = 'track';
      S.coverItem = cur;
      renderCover(cur);
      paintTone(cur);
    } else {
      S.coverItem = first;
      S.coverKind = S.type === 'collections' ? 'collection' : 'track';
      renderCover(first);
      if (first) paintTone(first);
      else clearTone();
    }
    if (ring && typeof ring.setItems === 'function') ring.setItems(ringItems());
    el.ringMsg.hidden = !!first;
    if (!first) el.ringMsg.textContent = S.empty || '这一层没有内容';
    updateLabels();
    paintSources();
  }

  async function loadSource(kind) {
    S.src = kind;
    writeLs(KEY.src, kind);
    paintSources();
    const seq = ++S.seq;
    setLoading('正在载入…');
    let res;
    try {
      res = S.drilled ? await loadDrilled() : await railFetch(S.plat, kind);
    } catch (e) {
      res = railNone('载入失败：' + ((e && e.message) || e));
    }
    if (seq !== S.seq) return;
    if (!res) res = railNone('没有返回内容');
    applyResult(res, S.drilled ? S.drilled.item.name : (SRC_NAME[kind] || kind));
    paintPlatform();
  }


  function activate(i) {
    const item = S.items[i];
    if (!item) return;
    if (S.type === 'collections') { drill(i); return; }
    playIndex(i);
  }

  function playIndex(i) {
    if (!hasPlayer) return;
    const items = S.items;
    if (!items[i]) return;
    S.coverKind = 'track';
    S.coverItem = items[i];
    renderCover(items[i]);
    Player.playQueue(items, i, true);
    toast(items[i].name ? `正在播放：${items[i].name}` : '正在播放');
  }

  /* ------------------------------------------------------------------ *
   * 封面（上半天那张 1:1，定在布局里不动）
   * ------------------------------------------------------------------ */
  function coverMainText(item) {
    if (!item) {
      return ['这一层没有内容', `${PLAT(S.plat).name} · ${S.drilled ? S.drilled.item.name : (SRC_NAME[S.src] || '')}`];
    }
    if (S.coverKind === 'collection') {
      const extra = item.creator && item.creator.nickname ? item.creator.nickname : '';
      const cnt = item.trackCount ? `${item.trackCount} 首` : (item.playCount ? '' : '');
      const sub = [extra, cnt].filter(Boolean).join(' · ') || (S.drilled && S.drilled.kind === 'station' ? '电台' : '歌单');
      return [item.name || '未命名', sub];
    }
    return [item.name || '未命名', item.artists || item.album || '—'];
  }

  function renderCover(item) {
    const [title, sub] = coverMainText(item);
    el.title.textContent = title;
    el.sub.textContent = sub;

    const cur = hasPlayer ? (Player.state.queue[Player.state.index] || null) : null;
    const isCur = !!(item && cur && S.coverKind === 'track' && sameTrack(item, cur));
    if (isCur && S.playing) el.tag.textContent = '正在播放';
    else if (isCur) el.tag.textContent = '已暂停';
    else if (S.coverKind === 'collection') {
      const rootKind = S.drilled ? S.drilled.rootKind : S.src;
      el.tag.textContent = `${PLAT(S.plat).name} · ${rootKind === 'radio' ? '电台' : '歌单'}`;
    }
    else if (item) el.tag.textContent = `${PLAT(S.plat).name} · ${S.drilled ? S.drilled.item.name : (SRC_NAME[S.src] || '')}`;
    else el.tag.textContent = '为你推荐';

    el.play.setAttribute('aria-label', S.coverKind === 'collection' ? '打开歌单' : '播放');

    const url = item && item.cover ? API.img(item.cover, 700) : '';
    setCoverImage(url);
  }

  /* 半调切换：上一张 A 的网点胀满整块（变黑）→ 在纯黑那一帧换纹理 →
     新图 B 的网点从中心长出来 → 最后恢复清晰彩图。没有 WebGL2 时退回
     原来的双 <img> 交叉淡入。 */
  function setCoverImage(url) {
    el.cover.classList.toggle('is-empty', !url);
    if (url === coverUrl) return;
    coverUrl = url;
    const token = ++coverToken;

    if (coverFx) {
      if (!url) {
        try { coverFx.clear(); } catch { /* 忽略 */ }
        return;
      }
      try {
        const p = coverFx.show(url, { immediate: prefMotion });
        if (p && typeof p.catch === 'function') {
          p.catch(() => { dropCoverFx(); if (token === coverToken && coverUrl === url) crossFadeCover(url, token); });
        }
        return;
      } catch {
        dropCoverFx();
      }
    }
    if (!url) {
      el.imgA.classList.remove('is-on');
      el.imgB.classList.remove('is-on');
      return;
    }
    crossFadeCover(url, token);
  }

  /* 半调画布不可用/报错：摘掉它，别让最后一帧不透明画面盖住 <img> */
  function dropCoverFx() {
    try { if (coverFx) coverFx.clear(); } catch { /* 忽略 */ }
    coverFx = null;
    if (el.coverFx) el.coverFx.style.display = 'none';
  }

  function crossFadeCover(url, token) {
    const incoming = coverFlip ? el.imgB : el.imgA;
    const outgoing = coverFlip ? el.imgA : el.imgB;
    coverFlip ^= 1;
    incoming.classList.remove('is-on');
    incoming.onload = () => {
      if (token !== coverToken) return;
      incoming.classList.add('is-on');
      outgoing.classList.remove('is-on');
    };
    incoming.onerror = () => {
      if (token !== coverToken) return;
      coverUrl = '';
      el.cover.classList.add('is-empty');
      incoming.classList.remove('is-on');
    };
    incoming.src = url;
  }

  function coverAction() {
    const item = S.coverItem;
    if (!item) {
      if (S.items.length) { S.coverItem = S.items[0]; S.coverKind = S.type === 'collections' ? 'collection' : 'track'; renderCover(S.coverItem); }
      return;
    }
    if (S.coverKind === 'collection') {
      const i = S.items.indexOf(item);
      if (i >= 0) drill(i);
      return;
    }
    if (!hasPlayer) return;
    /* 点封面 = 进主播放界面（和桌面点封面一致）；播不播由下面那个播放键管 */
    const cur = Player.state.queue[Player.state.index];
    if (!(cur && sameTrack(item, cur))) {
      const i = S.items.indexOf(item);
      if (i >= 0) playIndex(i);
      else {
        Player.playQueue([item], 0, true);
        toast(item.name ? `正在播放：${item.name}` : '正在播放');
      }
    }
    openNow();
  }

  function togglePlay() {
    if (!hasPlayer) return;
    if (!Player.state.queue.length) {
      if (S.items.length) playIndex(0);
      return;
    }
    Player.toggle();
  }

  function sameTrack(a, b) {
    if (!a || !b) return false;
    return String(a.id) === String(b.id) && String(a.source || 'netease') === String(b.source || 'netease');
  }

  function syncPlaying() {
    const cur = hasPlayer ? (Player.state.queue[Player.state.index] || null) : null;
    if (ring && typeof ring.setPlaying === 'function') {
      ring.setPlaying((item) => sameTrack(item && item.raw, cur));
    }
    el.pbar.hidden = !cur;
  }

  /* ------------------------------------------------------------------ *
   * 下钻 / 返回
   * ------------------------------------------------------------------ */
  let drillNav = false;

  function drill(i) {
    const item = S.items[i];
    if (!item) return;
    const rootKind = S.drilled ? S.drilled.rootKind : S.src;
    S.drilled = {
      kind: rootKind === 'radio' ? 'station' : 'playlist',
      item,
      src: S.plat,
      rootKind,
    };
    drillNav = true;
    navPushed = true;
    try { history.pushState({ lizi: 'drill' }, ''); } catch { navPushed = false; }
    loadSource(S.src);
  }

  function undrill() {
    if (!S.drilled && !drillNav) return;
    S.drilled = null;
    drillNav = false;
    navPushed = false;
    loadSource(S.src);
  }

  function clearDrill(silent) {
    if (!S.drilled) return;
    S.drilled = null;
    if (drillNav) {
      drillNav = false;
      if (!silent) {
        if (navPushed) {
          navPushed = false;
          ignorePop = true;
          try { history.back(); } catch { /* 忽略 */ }
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 搜索
   * ------------------------------------------------------------------ */
  let searchOpen = false;
  let searchTimer = 0;
  let searchSeq = 0;
  let searchResults = [];

  function searchHint(text) {
    el.searchBody.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'sheet__hint';
    p.textContent = text;
    el.searchBody.appendChild(p);
  }

  function openSearch() {
    if (searchOpen) return;
    searchOpen = true;
    renderSearchSources();
    const q = el.searchInput.value.trim();
    if (q && !searchResults.length) runSearch(q);
    else if (!q) showSearchStart();
    el.search.hidden = false;
    requestAnimationFrame(() => el.search.classList.add('is-on'));
    pushNav('search');
    setTimeout(() => { try { el.searchInput.focus(); } catch { /* 忽略 */ } }, 120);
  }

  function hideSearch(silent) {
    if (!searchOpen) return;
    searchOpen = false;
    el.search.classList.remove('is-on');
    setTimeout(() => { if (!searchOpen) el.search.hidden = true; }, 360);
    if (!silent) closeNav('search');
  }

  function closeSheetNow(node, open) {
    node.classList.remove('is-on');
    setTimeout(() => { if (!open()) node.hidden = true; }, 360);
  }

  async function searchTracks(pid, q) {
    if (pid === 'netease') {
      const d = await API.search(q, 20);
      return (d && d.tracks) || [];
    }
    if (pid === 'qq') {
      const d = await API.qqSearch(q, 20);
      return (d && d.tracks) || [];
    }
    const d = await API.srcSearch(pid, q, 20);
    return (d && d.tracks) || [];
  }

  function saveSearchHist(q) {
    if (!q) return;
    searchHist = [q, ...searchHist.filter((x) => x !== q)].slice(0, 8);
    try { writeLs(KEY.searchHist, JSON.stringify(searchHist)); } catch { /* 忽略 */ }
  }

  /* 搜索页顶部的平台页签：照桌面「全部 / 网易云 / QQ 音乐 / 酷狗 / 汽水 / 波点」，
     纯文字、当前项墨色 + 底下一道细线。只影响这次搜索，不改大厅当前平台。 */
  function renderSearchSources() {
    if (!el.searchSrc) return;
    el.searchSrc.innerHTML = '';
    SEARCH_SRCS.forEach((p) => {
      const b = mk('button', 'searchtab' + (p.id === searchPlat ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(p.id === searchPlat));
      b.textContent = p.name;
      b.addEventListener('click', () => {
        if (searchPlat === p.id) return;
        searchPlat = p.id;
        writeLs(KEY.searchPlat, p.id);
        renderSearchSources();
        const q = el.searchInput.value.trim();
        if (q) runSearch(q); else showSearchStart();
      });
      el.searchSrc.appendChild(b);
    });
  }

  function showSearchStart() {
    searchResults = [];
    el.searchBody.innerHTML = '';
    if (el.searchHint) el.searchHint.textContent = '';
    const box = mk('div', 'searchstart');
    const ico = mk('span', 'searchstart__ico');
    ico.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-search"/></svg>';
    box.append(ico, mk('b', null, searchPlat === 'all'
      ? '搜全部平台的歌'
      : '搜 ' + (SEARCH_NAME[searchPlat] || '') + ' 的歌'));
    box.appendChild(mk('p', null, '输入歌名、歌手或专辑，点结果直接播放'));
    el.searchBody.appendChild(box);

    if (searchHist.length) {
      const rec = mk('div', 'recent');
      rec.appendChild(mk('p', 'recent__h', '最近搜索'));
      const list = mk('div', 'recent__list');
      searchHist.forEach((q) => {
        const chip = mk('button', 'recent__chip', q);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          el.searchInput.value = q;
          runSearch(q);
        });
        list.appendChild(chip);
      });
      rec.appendChild(list);
      el.searchBody.appendChild(rec);
    }
  }

  function renderSearchSkeleton() {
    el.searchBody.innerHTML = '';
    for (let i = 0; i < 4; i += 1) {
      const row = mk('div', 'skel');
      row.appendChild(mk('span', 'skel__art'));
      const lines = mk('div', 'skel__lines');
      lines.append(mk('span', 'skel__line'), mk('span', 'skel__line'));
      row.appendChild(lines);
      el.searchBody.appendChild(row);
    }
  }

  const fmtDur = (ms) => {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  /* 歌手 / 专辑入口：只对网易云的数字 id 建链接（和桌面 app.js 的 artistLinks 一致）；
     其它平台没有可用的歌手页接口，保持纯文字，绝不编 id。 */
  function appendArtistLinks(sub, t, pid) {
    const names = String(t.artists || '未知歌手').split(/\s*\/\s*/);
    names.forEach((n, i) => {
      const rawId = Array.isArray(t.artistIds) ? t.artistIds[i] : null;
      if (pid === 'netease' && rawId != null && /^\d+$/.test(String(rawId))) {
        const a = document.createElement('button');
        a.type = 'button';
        a.className = 'srow__a';
        a.textContent = n;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openArtist(Number(rawId), n);
        });
        sub.appendChild(a);
      } else {
        sub.appendChild(document.createTextNode(n));
      }
      if (i < names.length - 1) sub.appendChild(document.createTextNode(' / '));
    });
  }

  function appendAlbumLink(sub, t, pid) {
    if (!t.album) return;
    sub.appendChild(document.createTextNode(' · '));
    if (pid === 'netease' && t.albumId != null && /^\d+$/.test(String(t.albumId))) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'srow__a';
      a.textContent = t.album;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAlbum(Number(t.albumId), t.album);
      });
      sub.appendChild(a);
    } else {
      sub.appendChild(document.createTextNode(t.album));
    }
  }

  /* 行右侧那团从封面渗出来的颜色：只写三档颜色，不加 blur，滚动时不掉帧 */
  function paintRowWash(row, img) {
    const paint = () => {
      if (!hasPlayer || typeof Player.paletteFromCover !== 'function') return;
      let pal = null;
      try { pal = Player.paletteFromCover(img); } catch { pal = null; }
      if (!pal || !Array.isArray(pal.stops) || pal.stops.length < 5) return;
      row.style.setProperty('--c1', pal.stops[2]);
      row.style.setProperty('--c2', pal.stops[3]);
      row.style.setProperty('--c3', pal.stops[4]);
      row.classList.add('has-wash');
    };
    if (img.complete && img.naturalWidth) paint();
    else img.addEventListener('load', paint, { once: true });
  }

  function searchRow(t, pid, i, items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'srow';

    const art = mk('span', 'srow__art');
    if (t.cover) {
      const im = new Image();
      im.src = API.img(t.cover, 400);
      im.alt = '';
      im.loading = 'lazy';
      im.decoding = 'async';
      art.appendChild(im);
      paintRowWash(row, im);
    } else {
      art.innerHTML = '<svg class="ico ico--solid" aria-hidden="true"><use href="#i-note"/></svg>';
    }

    const text = mk('span', 'srow__text');
    text.appendChild(mk('span', 'srow__name', t.name || '未命名'));
    const sub = mk('span', 'srow__sub');
    appendArtistLinks(sub, t, pid);
    appendAlbumLink(sub, t, pid);
    text.appendChild(sub);

    const flag = (t.fee === 1 || t.fee === 4) ? mk('span', 'srow__flag', 'VIP') : null;
    const dur = mk('span', 'srow__dur', fmtDur(t.duration));
    row.append(art, text);
    if (flag) row.appendChild(flag);
    row.appendChild(dur);

    row.addEventListener('click', () => {
      searchResults = items;
      playSearchResult(items, i);
    });
    return row;
  }

  function renderSearchRows(items, pid) {
    el.searchBody.innerHTML = '';
    if (!items.length) {
      searchHint('在' + (SEARCH_NAME[pid] || '这里') + '没有搜到，换个关键词试试');
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((t, i) => frag.appendChild(searchRow(t, pid, i, items)));
    el.searchBody.appendChild(frag);
  }

  /* 全部平台：按平台分组列，和桌面「全部」一样不混排 */
  function renderSearchGroups(groups) {
    el.searchBody.innerHTML = '';
    const nonEmpty = groups.filter((g) => g.items.length);
    if (!nonEmpty.length) {
      searchHint('所有平台都没有搜到，换个关键词试试');
      return;
    }
    const frag = document.createDocumentFragment();
    nonEmpty.forEach((g) => {
      frag.appendChild(mk('p', 'searchgroup', `${g.name} · ${g.items.length} 首`));
      g.items.forEach((t, i) => frag.appendChild(searchRow(t, g.id, i, g.items)));
    });
    el.searchBody.appendChild(frag);
  }

  function playSearchResult(items, i) {
    if (!hasPlayer) return;
    const t = items[i];
    if (!t) return;
    Player.playQueue(items, i, true);
    S.coverKind = 'track';
    S.coverItem = t;
    renderCover(t);
    paintTone(t);
    hideSearch(false);
    toast(t.name ? `正在播放：${t.name}` : '正在播放');
  }

  async function runSearch(q) {
    const term = String(q || '').trim();
    if (!term) { showSearchStart(); return; }
    const pid = searchPlat;
    const seq = ++searchSeq;
    renderSearchSkeleton();
    if (el.searchHint) el.searchHint.textContent = '';

    if (pid === 'all') {
      /* 全部：五家并行，一家挂了不影响其它家。顺序固定按 PLATS 排，和桌面一致。 */
      const groups = await Promise.all(PLATS.map((p) =>
        searchTracks(p.id, term).then(
          (items) => ({ id: p.id, name: p.name, items }),
          () => ({ id: p.id, name: p.name, items: [] })
        )
      ));
      if (seq !== searchSeq || pid !== searchPlat) return;
      const total = groups.reduce((n, g) => n + g.items.length, 0);
      if (total) saveSearchHist(term);
      searchResults = groups.flatMap((g) => g.items);
      if (el.searchHint) el.searchHint.textContent = total ? `全部 · ${total} 首` : '全部 · 无结果';
      renderSearchGroups(groups);
      return;
    }

    try {
      const items = await searchTracks(pid, term);
      if (seq !== searchSeq || pid !== searchPlat) return;
      searchResults = items;
      if (items.length) saveSearchHist(term);
      if (el.searchHint) {
        el.searchHint.textContent = items.length
          ? `${SEARCH_NAME[pid] || ''} · ${items.length} 首`
          : `${SEARCH_NAME[pid] || ''} · 无结果`;
      }
      renderSearchRows(items, pid);
    } catch (e) {
      if (seq !== searchSeq) return;
      searchHint('搜索失败：' + ((e && e.message) || e));
    }
  }

  function bindSearch() {
    el.btnSearch.addEventListener('click', openSearch);
    el.searchClose.addEventListener('click', () => hideSearch(false));
    el.searchInput.addEventListener('input', () => {
      const q = el.searchInput.value.trim();
      clearTimeout(searchTimer);
      if (!q) { showSearchStart(); return; }
      searchTimer = setTimeout(() => runSearch(q), 350);
    });
    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchTimer);
        runSearch(el.searchInput.value.trim());
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 歌手 / 专辑：直接复用桌面的 pages 模块（版式和桌面完全一致）
   * ------------------------------------------------------------------ */
  let artistId = 0;
  let albumId = 0;
  /* 子页盖上来时先收起下层，返回时按「后进先出」还原：
     search → artist → album → artist(B) 这种连续换页也能一层层退回去 */
  const underStack = [];

  function collapseUnder(name) {
    if (name === 'search' && searchOpen) {
      searchOpen = false;
      el.search.classList.remove('is-on');
      el.search.hidden = true;
    }
    if (name === 'artist' && artistOpen) {
      artistOpen = false;
      el.artist.classList.remove('is-on');
      el.artist.hidden = true;
    }
    if (name === 'forms' && formsOpen) {
      formsOpen = false;
      el.forms.classList.remove('is-on');
      el.forms.hidden = true;
    }
    if (name === 'albums' && albumsOpen) {
      albumsOpen = false;
      el.albums.classList.remove('is-on');
      el.albums.hidden = true;
    }
    if (name === 'now' && nowOpen) {
      nowOpen = false;
      el.now.classList.remove('is-on');
      el.now.hidden = true;
    }
  }

  function restoreUnder() {
    const name = underStack.pop();
    if (!name) return;
    if (name === 'search') {
      searchOpen = true;
      el.search.hidden = false;
      requestAnimationFrame(() => el.search.classList.add('is-on'));
      navOpen = 'search';
      navPushed = true;
    } else if (name === 'artist') {
      artistOpen = true;
      el.artist.hidden = false;
      requestAnimationFrame(() => el.artist.classList.add('is-on'));
      navOpen = 'artist';
      navPushed = true;
    } else if (name === 'forms') {
      formsOpen = true;
      el.forms.hidden = false;
      requestAnimationFrame(() => el.forms.classList.add('is-on'));
      navOpen = 'forms';
      navPushed = true;
    } else if (name === 'albums') {
      albumsOpen = true;
      el.albums.hidden = false;
      requestAnimationFrame(() => el.albums.classList.add('is-on'));
      navOpen = 'albums';
      navPushed = true;
    } else if (name === 'now') {
      nowOpen = true;
      el.now.hidden = false;
      requestAnimationFrame(() => {
        el.now.classList.add('is-on');
        paintNowLyrics(Player.state.lyric, Player.state.lyricIndex);
      });
      navOpen = 'now';
      navPushed = true;
    }
  }

  function openArtist(id, name) {
    const n = Number(id);
    if (!n) return;
    /* 从专辑页点歌手：专辑还在最上面，按「换页」处理（沿用同一条历史记录），
       否则新歌手会被压在专辑底下看不见 */
    if (albumOpen) {
      albumOpen = false;
      el.album.classList.remove('is-on');
      el.album.hidden = true;
      if (underStack[underStack.length - 1] === 'artist') underStack.pop();
      if (!artistOpen) {
        artistOpen = true;
        el.artist.hidden = false;
        requestAnimationFrame(() => el.artist.classList.add('is-on'));
        navOpen = 'artist';
        navPushed = true;
      }
      artistId = n;
      const tt = el.artist.querySelector('.sheet__title');
      if (tt) tt.textContent = name || '歌手';
      import('../pages/artist.js').then((mod) => {
        if (!artistOpen || artistId !== n) return;
        mod.mount(el.artistBody, { id: n });
      }).catch((e) => {
        el.artistBody.innerHTML = '';
        el.artistBody.appendChild(mk('p', 'sheet__hint', '歌手页载入失败：' + ((e && e.message) || e)));
      });
      return;
    }
    if (!artistOpen && !albumOpen) {
      if (searchOpen) { underStack.push('search'); collapseUnder('search'); }
      else if (nowOpen) hideNow(true);
      artistOpen = true;
      el.artist.hidden = false;
      requestAnimationFrame(() => el.artist.classList.add('is-on'));
      pushNav('artist');
    }
    artistId = n;
    const t = el.artist.querySelector('.sheet__title');
    if (t) t.textContent = name || '歌手';
    import('../pages/artist.js').then((mod) => {
      if (!artistOpen || artistId !== n) return;
      mod.mount(el.artistBody, { id: n });
    }).catch((e) => {
      el.artistBody.innerHTML = '';
      el.artistBody.appendChild(mk('p', 'sheet__hint', '歌手页载入失败：' + ((e && e.message) || e)));
    });
  }

  function hideArtist(silent) {
    if (!artistOpen) return;
    artistOpen = false;
    closeSheetNow(el.artist, () => artistOpen);
    if (!silent) closeNav('artist');
    restoreUnder();
  }

  function openAlbum(id, name) {
    const n = Number(id);
    if (!n) return;
    if (!albumOpen) {
      if (artistOpen) { underStack.push('artist'); collapseUnder('artist'); }
      else if (albumsOpen) { underStack.push('albums'); collapseUnder('albums'); }
      else if (searchOpen) { underStack.push('search'); collapseUnder('search'); }
      else if (nowOpen) hideNow(true);
      albumOpen = true;
      el.album.hidden = false;
      requestAnimationFrame(() => el.album.classList.add('is-on'));
      pushNav('album');
    }
    albumId = n;
    const t = el.album.querySelector('.sheet__title');
    if (t) t.textContent = name || '专辑';
    import('../pages/album.js').then((mod) => {
      if (!albumOpen || albumId !== n) return;
      mod.mount(el.albumBody, { id: n });
    }).catch((e) => {
      el.albumBody.innerHTML = '';
      el.albumBody.appendChild(mk('p', 'sheet__hint', '专辑页载入失败：' + ((e && e.message) || e)));
    });
  }

  function hideAlbum(silent) {
    if (!albumOpen) return;
    albumOpen = false;
    closeSheetNow(el.album, () => albumOpen);
    if (!silent) closeNav('album');
    restoreUnder();
  }

  /* 桌面的专辑卡是 <div data-alb>，桌面 app.js 用全局委托接的；手机这里自己接 */
  function bindPages() {
    el.artistBody.addEventListener('click', (e) => {
      const card = e.target.closest('[data-alb]');
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      openAlbum(card.dataset.alb, card.getAttribute('title') || '');
    });
    /* 专辑页里的歌手名 → 同样进歌手页（桌面 app.js 也是全局委托 data-aid） */
    el.albumBody.addEventListener('click', (e) => {
      const a = e.target.closest('[data-aid]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      openArtist(a.dataset.aid, (a.textContent || '').trim());
    });
    el.artistClose.addEventListener('click', () => hideArtist(false));
    el.albumClose.addEventListener('click', () => hideAlbum(false));
  }

  /* ------------------------------------------------------------------ *
   * 主播放界面（点封面进）
   * ------------------------------------------------------------------ */
  let nowLyricKey = '';
  let nowSeeking = false;
  let nowLyUserAt = 0;                     // 用户刚滚过歌词：2.5s 内别抢滚动
  let nowLyricsOpen = false;               // 歌词面板实际展开状态（默认收起）
  let nowDrag = null;                      // 播放页下拉手势
  let nowLyPress = null;                   // 歌词面板上的下滑收起
  let nowSwallowClick = false;             // 拖过之后吞掉那一下 click
  let nowSwallowTimer = 0;

  const fmtClock = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function nowTrack() {
    if (!hasPlayer) return S.coverItem || null;
    return Player.state.queue[Player.state.index] || S.coverItem || null;
  }

  const MODE_UI = {
    order: { icon: '#i-list', label: '顺序播放' },
    loop: { icon: '#i-order', label: '列表循环' },
    single: { icon: '#i-single', label: '单曲循环' },
    shuffle: { icon: '#i-shuffle', label: '随机播放' },
  };

  function paintNowMode(mode) {
    const m = MODE_UI[mode] ? mode : 'order';
    const use = el.nowMode.querySelector('use');
    if (use) use.setAttribute('href', MODE_UI[m].icon);
    el.nowMode.setAttribute('aria-label', MODE_UI[m].label);
    el.nowMode.title = MODE_UI[m].label;
    el.nowMode.classList.toggle('is-on', m !== 'order');
  }

  function paintNowMeta(item) {
    const t = item || nowTrack();
    const url = t && t.cover ? API.img(t.cover, 800) : '';
    el.nowTitle.textContent = (t && t.name) || '未播放';
    /* 封面下只留歌名 + 进度：歌手副标题行已从播放页移除 */
    el.nowArtPh.hidden = !!url;
    /* 背景就是这张封面：模糊一次铺满（静态 filter，不逐帧改） */
    el.nowPhoto.style.backgroundImage = url ? `url("${url}")` : 'none';
    if (url) {
      if (el.nowArt.getAttribute('src') !== url) el.nowArt.src = url;
      el.nowArt.hidden = false;
    } else {
      el.nowArt.removeAttribute('src');
      el.nowArt.hidden = true;
    }
    paintNowMode(hasPlayer ? Player.state.mode : 'order');
    paintNowProgress(
      hasPlayer ? Player.audio.currentTime : 0,
      hasPlayer ? (Player.audio.duration || 0) : 0
    );
  }

  function paintNowProgress(cur, total) {
    const d = total > 0 ? total : 0;
    if (d) nowDuration = d;
    const r = d ? clamp(cur / d, 0, 1) : 0;
    el.nowFill.style.transform = `scaleX(${r.toFixed(4)})`;
    el.nowKnob.style.left = (r * 100).toFixed(2) + '%';
    el.nowCur.textContent = fmtClock(cur);
    el.nowDur.textContent = fmtClock(d || nowDuration);
    el.nowBar.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  }

  function paintNowLyrics(lines, active) {
    const list = Array.isArray(lines) ? lines : [];
    const scroll = el.nowLyrScroll;
    if (!scroll) return;
    const key = list.length ? `${list.length}|${list[0] && list[0].t}` : '0';
    if (key !== nowLyricKey) {
      nowLyricKey = key;
      nowLyUserAt = 0;
      scroll.innerHTML = '';
      if (!list.length) {
        scroll.appendChild(mk('p', 'nowlyr__hint', '这首歌还没有歌词'));
      } else {
        list.forEach((l) => {
          const p = mk('p', 'nowlyr__l');
          /* 桌面 ly__main 也是单独一层：当前行只放大这一层，折行位置不变 */
          p.appendChild(mk('span', 'nowlyr__main', l.text || ''));
          if (l.tr) p.appendChild(mk('span', 'nowlyr__tr', l.tr));
          p.dataset.t = String(l.t == null ? '' : l.t);
          p.addEventListener('click', () => {
            const t = Number(p.dataset.t);
            if (!Number.isFinite(t)) return;
            nowLyUserAt = 0;
            try { Player.seek(t); } catch { return; }
            let idx = -1;
            try { idx = Player.lyricAt(t).index; } catch { idx = -1; }
            paintNowProgress(t, Player.audio.duration || nowDuration);
            paintNowLyrics(Player.state.lyric, idx);
          });
          scroll.appendChild(p);
        });
      }
    }
    const rows = scroll.querySelectorAll('.nowlyr__l');
    rows.forEach((r, i) => r.classList.toggle('is-on', i === active));
    const on = active >= 0 ? rows[active] : null;
    /* 只有歌词面板真的展开时才自动滚动；收起状态不做无谓的 scroll 计算 */
    if (on && nowLyricsOpen && performance.now() - nowLyUserAt >= 2500) {
      const top = on.offsetTop - scroll.clientHeight / 2 + on.offsetHeight / 2;
      scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  /* 展开 / 收起歌词面板：只切类名，不动控制键和别的布局 */
  function setNowLyrics(open) {
    if (!el.now) return;
    nowLyricsOpen = !!open;
    el.now.classList.toggle('is-lyr', nowLyricsOpen);
    if (el.nowGrip) el.nowGrip.setAttribute('aria-expanded', String(nowLyricsOpen));
    if (nowLyricsOpen && hasPlayer) {
      nowLyUserAt = 0;
      paintNowLyrics(Player.state.lyric, Player.state.lyricIndex);
    }
  }

  function openNow() {
    if (!hasPlayer) return;
    if (nowOpen) return;
    nowOpen = true;
    /* 每次打开都回到初始形态：歌词收起、清掉上一次下拉留下的内联位移 */
    nowCancelDrag();
    nowLyPress = null;
    nowSwallowClick = false;
    clearTimeout(nowSwallowTimer);
    nowLyricsOpen = false;
    el.now.classList.remove('is-lyr', 'is-drag');
    if (el.nowGrip) el.nowGrip.setAttribute('aria-expanded', 'false');
    el.now.style.transform = '';
    if (el.nowLyrScroll) el.nowLyrScroll.scrollTop = 0;
    const t = nowTrack();
    paintNowMeta(t);
    el.nowArtWrap.classList.toggle('is-playing', hasPlayer && !Player.audio.paused);
    nowLyricKey = '';
    let active = Player.state.lyricIndex;
    if (typeof Player.lyricAt === 'function') {
      try { active = Player.lyricAt(Player.audio.currentTime || 0).index; } catch { /* 忽略 */ }
    }
    paintNowLyrics(Player.state.lyric, active);
    el.now.hidden = false;
    requestAnimationFrame(() => el.now.classList.add('is-on'));
    pushNav('now');
  }

  function hideNow(silent) {
    if (!nowOpen) return;
    nowOpen = false;
    nowCancelDrag();
    nowLyricsOpen = false;
    el.now.classList.remove('is-lyr');
    if (el.nowGrip) el.nowGrip.setAttribute('aria-expanded', 'false');
    el.now.classList.remove('is-on');
    setTimeout(() => { if (!nowOpen) el.now.hidden = true; }, 380);
    if (!silent) closeNav('now');
  }

  /* 取消 / 结束正在进行的播放页下拉手势，恢复过渡与内联 transform */
  function nowCancelDrag() {
    window.removeEventListener('pointermove', onNowDragMove, true);
    window.removeEventListener('pointerup', onNowDragUp, true);
    window.removeEventListener('pointercancel', onNowDragCancel, true);
    nowDrag = null;
    if (el.now) {
      el.now.classList.remove('is-drag');
      el.now.style.transform = '';
    }
  }

  function onNowDragMove(e) {
    const d = nowDrag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      if (dy < 10) return;                 // 还没到阈值：可能是点按
      d.moved = true;
      nowSwallowClick = true;
      clearTimeout(nowSwallowTimer);
      nowSwallowTimer = setTimeout(() => { nowSwallowClick = false; }, 420);
    }
    /* 前 90px 1:1 跟手，之后阻尼 0.5，避免整页被拽飞 */
    const damp = dy > 90 ? 90 + (dy - 90) * 0.5 : dy;
    el.now.style.transform = `translateY(${Math.max(0, damp).toFixed(1)}px)`;
    const tt = performance.now();
    const inst = (e.clientY - d.lastY) / Math.max(1, tt - d.lastT);
    d.v = d.v * 0.75 + inst * 0.25;        // px/ms，正数 = 向下
    d.lastY = e.clientY;
    d.lastT = tt;
    d.dy = dy;
  }

  function onNowDragUp(e) {
    const d = nowDrag;
    if (!d || e.pointerId !== d.id) return;
    const dy = d.dy;
    const v = d.v;
    nowCancelDrag();
    if (d.moved) {
      nowSwallowClick = true;
      clearTimeout(nowSwallowTimer);
      nowSwallowTimer = setTimeout(() => { nowSwallowClick = false; }, 420);
      /* 拉过 110px，或者松手时速度明显向下 → 收起播放页；否则弹回 */
      if (dy > 110 || v > 0.35) hideNow(false);
    }
  }

  function onNowDragCancel(e) {
    const d = nowDrag;
    if (!d || e.pointerId !== d.id) return;
    nowCancelDrag();
    /* 手势被系统取消时不会有 click，别把下一个真实点按也吞掉 */
    nowSwallowClick = false;
    clearTimeout(nowSwallowTimer);
  }

  function seekNowTo(e) {
    const r = el.nowBar.getBoundingClientRect();
    if (!r.width) return;
    const ratio = clamp((e.clientX - r.left) / r.width, 0, 1);
    const total = hasPlayer ? (Player.audio.duration || nowDuration) : 0;
    if (!hasPlayer || !total) return;
    Player.seek(ratio * total);
    paintNowProgress(ratio * total, total);
  }

  let nowCueTimer = 0;

  function blinkNowCue() {
    el.nowArtWrap.classList.add('is-cue');
    clearTimeout(nowCueTimer);
    nowCueTimer = setTimeout(() => el.nowArtWrap.classList.remove('is-cue'), 720);
  }

  function bindNow() {
    el.nowClose.addEventListener('click', () => hideNow(false));
    el.nowForm.addEventListener('click', openForms);
    /* 细条 = 歌词抽屉的抓手：上条展开、面板底部那条收起 */
    el.nowGrip.addEventListener('click', () => setNowLyrics(true));
    if (el.nowGripBot) el.nowGripBot.addEventListener('click', () => setNowLyrics(false));
    /* 用户自己滚歌词时自动滚动让路（桌面同样逻辑，2.5s） */
    const markLyUser = () => { nowLyUserAt = performance.now(); };
    if (el.nowLyrScroll) {
      el.nowLyrScroll.addEventListener('pointerdown', markLyUser, { passive: true });
      el.nowLyrScroll.addEventListener('touchstart', markLyUser, { passive: true });
      el.nowLyrScroll.addEventListener('wheel', markLyUser, { passive: true });
    }
    /* 歌词面板：scrollTop=0 时向下滑收起歌词（不关播放页），否则交给原生滚动 */
    el.nowLyrics.addEventListener('touchstart', (e) => {
      if (!nowLyricsOpen || !e.touches || e.touches.length !== 1) { nowLyPress = null; return; }
      const t = e.touches[0];
      nowLyPress = { y0: t.clientY, x0: t.clientX, top: el.nowLyrScroll.scrollTop };
    }, { passive: true });
    el.nowLyrics.addEventListener('touchmove', (e) => {
      const p = nowLyPress;
      if (!p || !nowLyricsOpen || !e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dy = t.clientY - p.y0;
      const dx = t.clientX - p.x0;
      if (p.top <= 2 && el.nowLyrScroll.scrollTop <= 2 && dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        nowLyPress = null;
        setNowLyrics(false);
      }
    }, { passive: true });
    el.nowLyrics.addEventListener('touchend', () => { nowLyPress = null; }, { passive: true });
    el.nowLyrics.addEventListener('touchcancel', () => { nowLyPress = null; }, { passive: true });
    /* 播放页下拉收起：只从顶栏 / 封面 / 歌名 / 细条这些非滚动、非控件区起手。
       进度条拖动、控制键点击、歌词滚动都不受影响。 */
    el.now.addEventListener('pointerdown', (e) => {
      if (!nowOpen || nowDrag) return;
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const t = e.target;
      if (t && t.closest && (
        t.closest('.nowseek') || t.closest('.nowctl') || t.closest('.nowlyr') ||
        t.closest('.nowsheet__top button')
      )) return;
      nowDrag = {
        id: e.pointerId,
        y0: e.clientY,
        lastY: e.clientY,
        lastT: performance.now(),
        v: 0,
        dy: 0,
        moved: false,
      };
      el.now.classList.add('is-drag');
      window.addEventListener('pointermove', onNowDragMove, true);
      window.addEventListener('pointerup', onNowDragUp, true);
      window.addEventListener('pointercancel', onNowDragCancel, true);
    });
    /* 拖动结束后浏览器还会补一个 click：吞掉它，避免误触封面播放/细条展开 */
    el.now.addEventListener('click', (e) => {
      if (!nowSwallowClick) return;
      nowSwallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    /* 桌面是悬停封面出现播放/暂停；手机没有 hover，点封面就直接切 */
    el.nowArtWrap.addEventListener('click', () => {
      if (!hasPlayer) return;
      Player.toggle();
      blinkNowCue();
    });
    el.nowPlay.addEventListener('click', () => {
      if (!hasPlayer) return;
      if (!Player.state.queue.length && S.items.length) { playIndex(0); return; }
      Player.toggle();
    });
    el.nowPrev.addEventListener('click', () => { if (hasPlayer) Player.prev(); });
    el.nowNext.addEventListener('click', () => { if (hasPlayer) Player.next(); });
    el.nowMode.addEventListener('click', () => {
      if (hasPlayer) paintNowMode(Player.cycleMode());
    });
    el.nowBar.addEventListener('pointerdown', (e) => {
      nowSeeking = true;
      try { el.nowBar.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
      seekNowTo(e);
    });
    el.nowBar.addEventListener('pointermove', (e) => { if (nowSeeking) seekNowTo(e); });
    el.nowBar.addEventListener('pointerup', () => { nowSeeking = false; });
    el.nowBar.addEventListener('pointercancel', () => { nowSeeking = false; });
  }

  /* ------------------------------------------------------------------ *
   * 音乐形态 / 横屏舞台
   * ------------------------------------------------------------------ */
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
  let palette = null;
  let stageReady = false;
  let stageTick = 0;
  let lastInitSig = '';

  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [150, 165, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function postStage(type, payload) {
    const w = el.stageFrame.contentWindow;
    if (!w) return;
    try { w.postMessage({ __c100: 1, type, payload }, '*'); } catch { /* 忽略 */ }
  }

  function stageLines() {
    const ls = (hasPlayer && Player.state.lyric) || [];
    return ls.map((l, i) => ({
      t: l.t,
      dur: l.dur || (ls[i + 1] ? Math.max(0.4, ls[i + 1].t - l.t) : 6),
      text: l.text,
      chars: l.chars ? l.chars.map((c) => ({ c: c.c, t: c.t })) : null,
    }));
  }

  function stageInit(force) {
    if (!stageOpen || !stageReady || !hasPlayer) return;
    const tr = Player.state.queue[Player.state.index] || S.coverItem;
    const ls = Player.state.lyric || [];
    const accent = palette && palette.stops ? hexRgb(palette.stops[2]) : [150, 165, 255];
    const sig = [
      tr ? tr.id : 0, ls.length,
      ls.length ? ls[0].t : 0, ls.length ? ls[ls.length - 1].t : 0,
      ls.length && ls[0].chars ? ls[0].chars.length : 0,
      accent.join(','),
    ].join('|');
    if (!force && sig === lastInitSig) return;
    lastInitSig = sig;
    postStage('init', {
      song: tr ? { id: tr.id, name: tr.name, album: tr.album || '', artists: tr.artists, cover: tr.cover } : null,
      accent,
      lines: stageLines(),
      duration: Player.audio.duration || 0,
    });
  }

  function startStageTick() {
    stopStageTick();
    stageTick = setInterval(() => {
      if (!stageOpen || !hasPlayer) return;
      postStage('tick', {
        time: Player.audio.currentTime || 0,
        playing: !Player.audio.paused,
      });
    }, 66);
  }

  function stopStageTick() {
    if (stageTick) clearInterval(stageTick);
    stageTick = 0;
  }

  /* 方向切换只让画布自己转，不重载 iframe：去抖后补一帧 init，播放和 tick 不停 */
  let stageViewportTimer = 0;
  let stageWasLandscape = null;

  function stageViewportCheck() {
    const landscape = window.innerWidth > window.innerHeight;
    const flipped = stageWasLandscape !== null && landscape !== stageWasLandscape;
    stageWasLandscape = landscape;
    if (!stageOpen || !flipped) return;
    /* 等浏览器按新视口排完版，再让舞台重建几何 */
    requestAnimationFrame(() => {
      if (!stageOpen) return;
      stageInit(true);
      if (hasPlayer) {
        postStage('tick', { time: Player.audio.currentTime || 0, playing: !Player.audio.paused });
      }
    });
  }

  function queueStageViewport() {
    clearTimeout(stageViewportTimer);
    stageViewportTimer = setTimeout(stageViewportCheck, 160);
  }

  function openForms() {
    if (formsOpen) return;
    /* 从播放页点「形态」：先把播放页收起来，关掉形态列表再原样回来 */
    if (nowOpen) {
      underStack.push('now');
      collapseUnder('now');
    }
    formsOpen = true;
    renderForms();
    el.forms.hidden = false;
    requestAnimationFrame(() => el.forms.classList.add('is-on'));
    pushNav('forms');
  }

  function hideForms(silent) {
    if (!formsOpen) return;
    formsOpen = false;
    closeSheetNow(el.forms, () => formsOpen);
    if (!silent) closeNav('forms');
    restoreUnder();
  }

  function renderForms() {
    el.formsGrid.innerHTML = '';
    STAGES.forEach((s) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'formcard';
      const img = new Image();
      img.src = `../forms-labs/previews/${s.id}.jpg`;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.className = 'formcard__img';
      const body = mk('span', 'formcard__body');
      body.append(mk('b', 'formcard__n', s.name), mk('span', 'formcard__d', s.desc || ''));
      body.appendChild(mk('span', 'formcard__id', s.id));
      card.append(img, body);
      card.addEventListener('click', () => openStage(s));
      el.formsGrid.appendChild(card);
    });
  }

  function openStage(s) {
    if (!s) return;
    if (formsOpen) { underStack.push('forms'); collapseUnder('forms'); }
    stageOpen = true;
    stageReady = false;
    lastInitSig = '';
    stageWasLandscape = window.innerWidth > window.innerHeight;
    el.stageName.textContent = `${s.name} · ${s.id}`;
    el.stage.hidden = false;
    el.stage.classList.add('is-on');
    document.body.classList.add('is-stage');
    el.stageFrame.src = `../${s.url}`;
    pushNav('stage');
  }

  function hideStage(silent) {
    if (!stageOpen) return;
    stageOpen = false;
    stopStageTick();
    stageReady = false;
    lastInitSig = '';
    el.stage.classList.remove('is-on');
    setTimeout(() => {
      if (stageOpen) return;
      el.stage.hidden = true;
      try { el.stageFrame.src = 'about:blank'; } catch { /* 忽略 */ }
    }, 320);
    document.body.classList.remove('is-stage');
    if (!silent) closeNav('stage');
    restoreUnder();
  }

  function bindForms() {
    el.toolForms.addEventListener('click', openForms);
    el.formsClose.addEventListener('click', () => hideForms(false));
    el.stageBack.addEventListener('click', () => hideStage(false));
    /* orientationchange 在 iOS 上给值偏早，resize 兜底，统一去抖 */
    window.addEventListener('orientationchange', queueStageViewport);
    window.addEventListener('resize', queueStageViewport);
    window.addEventListener('message', (e) => {
      if (!el.stageFrame.contentWindow || e.source !== el.stageFrame.contentWindow) return;
      const d = e.data;
      if (!d || d.__c100 !== 1) return;
      if (d.type === 'ready') {
        stageReady = true;
        stageInit(true);
        startStageTick();
      } else if (d.type === 'key' && d.payload && d.payload.key === 'Space') {
        if (hasPlayer) Player.toggle();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 工具箱 / 我的专辑
   * ------------------------------------------------------------------ */
  function openTools() {
    if (toolsOpen) return;
    toolsOpen = true;
    el.tools.hidden = false;
    requestAnimationFrame(() => el.tools.classList.add('is-on'));
    pushNav('tools');
  }
  function hideTools(silent) {
    if (!toolsOpen) return;
    toolsOpen = false;
    closeSheetNow(el.tools, () => toolsOpen);
    if (!silent) closeNav('tools');
  }
  function bindTools() {
    el.toolsClose.addEventListener('click', () => hideTools(false));
    el.tools.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        toast(b.dataset.tool === 'migrate' ? '歌单搬运在桌面端使用' : '空间音频在桌面端使用');
      });
    });
  }

  function openAlbums() {
    if (albumsOpen) return;
    albumsOpen = true;
    renderAlbums();
    el.albums.hidden = false;
    requestAnimationFrame(() => el.albums.classList.add('is-on'));
    pushNav('albums');
  }
  function hideAlbums(silent) {
    if (!albumsOpen) return;
    albumsOpen = false;
    closeSheetNow(el.albums, () => albumsOpen);
    if (!silent) closeNav('albums');
  }
  function renderAlbums() {
    el.albumsGrid.innerHTML = '';
    import('../pages/collection.js').then((m) => {
      if (!albumsOpen) return;
      const items = m.list();
      el.albumsGrid.innerHTML = '';
      if (!items.length) {
        el.albumsGrid.appendChild(mk('p', 'sheet__hint', '还没有收藏专辑。在桌面端点专辑上的收藏，就会出现在这里。'));
        return;
      }
      items.forEach((a) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'albumcard';
        const art = mk('span', 'albumcard__art');
        if (a.cover) {
          const im = new Image();
          im.src = API.img(a.cover, 400);
          im.alt = '';
          im.loading = 'lazy';
          im.decoding = 'async';
          art.appendChild(im);
        } else {
          art.innerHTML = '<svg class="ico ico--solid" aria-hidden="true"><use href="#i-note"/></svg>';
        }
        const body = mk('span', 'albumcard__body');
        body.append(mk('b', 'albumcard__n', a.name || '未知专辑'));
        body.appendChild(mk('span', 'albumcard__a', a.artists || '—'));
        card.append(art, body);
        card.addEventListener('click', () => {
          const raw = String(a.id || '');
          const i = raw.indexOf(':');
          const source = i > 0 ? raw.slice(0, i) : (a.source || 'netease');
          const id = i > 0 ? raw.slice(i + 1) : raw;
          if (source === 'netease' && /^\d+$/.test(id)) openAlbum(Number(id), a.name);
          else toast('这个平台的专辑页手机上还没接');
        });
        el.albumsGrid.appendChild(card);
      });
    }).catch(() => {
      el.albumsGrid.innerHTML = '';
      el.albumsGrid.appendChild(mk('p', 'sheet__hint', '我的专辑读取失败'));
    });
  }
  function bindAlbums() {
    el.albumsClose.addEventListener('click', () => hideAlbums(false));
  }

  /* ------------------------------------------------------------------ *
   * 设置
   * ------------------------------------------------------------------ */
  let settingsOpen = false;

  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;
    el.ver.textContent = currentVersion();
    renderSetAccounts(false);
    el.settings.hidden = false;
    requestAnimationFrame(() => el.settings.classList.add('is-on'));
    pushNav('settings');
  }

  function hideSettings(silent) {
    if (!settingsOpen) return;
    settingsOpen = false;
    closeSheetNow(el.settings, () => settingsOpen);
    if (!silent) closeNav('settings');
  }

  function bindSettings() {
    el.btnSettings.addEventListener('click', openSettings);
    el.setClose.addEventListener('click', () => hideSettings(false));
    el.switchMotion.addEventListener('click', () => {
      prefMotion = !prefMotion;
      writeLs(KEY.motion, prefMotion ? '1' : '0');
      applyPrefs();
    });
    el.switchPower.addEventListener('click', () => {
      prefPower = !prefPower;
      writeLs(KEY.power, prefPower ? '1' : '0');
      applyPrefs();
    });
    el.setUpdate.addEventListener('click', () => {
      hideSettings(false);
      checkUpdate(true);
    });
  }

  /* ------------------------------------------------------------------ *
   * 账号状态：我的页与设置页共用；45 秒内复用结果
   * ------------------------------------------------------------------ */
  function loadStatuses(force) {
    const now = Date.now();
    if (!force && accountStatus && now - accountStatus.at < 45000) {
      return Promise.resolve(accountStatus.rows);
    }
    if (accountPromise) return accountPromise;
    accountPromise = (async () => {
      const accs = Array.isArray(window.LIZI_ACCOUNTS) ? window.LIZI_ACCOUNTS : [];
      const rows = await Promise.all(accs.map(async (a) => {
        let c = null;
        try { c = await a.check(); } catch { c = null; }
        return {
          id: a.id,
          name: a.name,
          accent: a.accent,
          loggedIn: !!(c && c.loggedIn),
          nickname: (c && c.nickname) || '',
          avatar: (c && c.avatar) || '',
          key: (c && c.key) || '',
        };
      }));
      accountStatus = { at: Date.now(), rows };
      return rows;
    })().finally(() => { accountPromise = null; });
    return accountPromise;
  }

  /* ------------------------------------------------------------------ *
   * 我的（个人主页）
   * ------------------------------------------------------------------ */
  function openMe() {
    if (meOpen) return;
    meOpen = true;
    if (!meList.length) renderMeLoading();
    else renderMe();
    el.me.hidden = false;
    requestAnimationFrame(() => el.me.classList.add('is-on'));
    pushNav('me');
    loadMe(meList.length === 0);
  }

  function hideMe(silent) {
    if (!meOpen) return;
    meOpen = false;
    meSeq += 1;
    closeSheetNow(el.me, () => meOpen);
    if (!silent) closeNav('me');
  }

  async function loadMe(force) {
    const token = ++meSeq;
    if (!meList.length) renderMeLoading();
    if (!Array.isArray(window.LIZI_ACCOUNTS)) {
      renderMeGuide('账号模块没有加载，刷新页面再试。');
      return;
    }
    try {
      const rows = await loadStatuses(force);
      const logged = rows.filter((r) => r.loggedIn);
      const accs = window.LIZI_ACCOUNTS || [];
      const list = await Promise.all(logged.map(async (row) => {
        const acc = accs.find((a) => a.id === row.id);
        let detail = null;
        if (acc && typeof acc.detail === 'function') {
          try { detail = await acc.detail(row.key); } catch { detail = null; }
        }
        return { ...row, detail };
      }));
      if (token !== meSeq) return;
      meList = list;
      if (!meList.some((x) => x.id === meSel)) {
        meSel = meList.some((x) => x.id === S.plat) ? S.plat : (meList[0] ? meList[0].id : null);
      }
      if (meOpen) renderMe();
      if (settingsOpen) renderSetAccounts(false);
    } catch (e) {
      if (token !== meSeq) return;
      if (meOpen) renderMeGuide('暂时读不到账号状态，检查一下服务是否在运行。');
    }
  }

  function renderMeLoading() {
    if (!el.meBody) return;
    el.meBody.innerHTML = '';
    el.meBody.appendChild(mk('p', 'sheet__hint', '正在读取账号…'));
  }

  function renderMeGuide(message) {
    el.meBody.innerHTML = '';
    const box = mk('div', 'meguide');
    const ico = mk('span', 'meguide__ico');
    ico.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-user"/></svg>';
    box.append(
      ico,
      mk('b', null, message ? '暂时读不到账号' : '还没有登录任何平台'),
      mk('p', null, message || '在桌面端的「设置 → 平台账号」里扫码登录。登录后这里会显示头像、等级、歌单和粉丝。')
    );
    const btn = mk('button', null, message ? '重试' : '重新检查');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      renderMeLoading();
      loadMe(true);
    });
    box.appendChild(btn);
    el.meBody.appendChild(box);
  }

  function renderMe() {
    el.meBody.innerHTML = '';
    if (!meList.length) { renderMeGuide(''); return; }

    const cur = meList.find((x) => x.id === meSel) || meList[0];
    meSel = cur.id;

    if (meList.length > 1) {
      const bar = mk('div', 'mesrc');
      meList.forEach((x) => {
        const p = PLAT(x.id);
        const b = mk('button', 'mesrc__b' + (x.id === cur.id ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(x.id === cur.id));
        if (p.logo) {
          const im = new Image();
          im.src = p.logo;
          im.alt = '';
          im.decoding = 'async';
          b.appendChild(im);
        }
        b.appendChild(mk('span', null, p.name));
        b.addEventListener('click', () => {
          meSel = x.id;
          renderMe();
          el.meBody.scrollTop = 0;
        });
        bar.appendChild(b);
      });
      el.meBody.appendChild(bar);
    }

    const p = PLAT(cur.id);
    const d = cur.detail || {};
    const card = mk('article', 'mehero');
    card.style.setProperty('--me-accent', cur.accent || p.color || '#ea3e3c');

    const banner = mk('div', 'mehero__banner');
    if (d.banner) {
      const im = new Image();
      im.src = API.img(d.banner, 1200);
      im.alt = '';
      im.loading = 'lazy';
      im.decoding = 'async';
      im.addEventListener('error', () => im.remove());
      banner.appendChild(im);
    }

    const body = mk('div', 'mehero__body');
    const ava = mk('div', 'mehero__ava');
    const initial = String(d.nickname || cur.nickname || '?').trim().slice(0, 1).toUpperCase();
    const avaUrl = d.avatar || cur.avatar;
    if (avaUrl) {
      const im = new Image();
      im.src = API.img(avaUrl, 160);
      im.alt = '';
      im.decoding = 'async';
      im.className = 'mehero__avaimg';
      im.addEventListener('error', () => im.remove());
      ava.appendChild(im);
      ava.appendChild(mk('span', 'mehero__avaph', initial));
    } else {
      ava.textContent = initial;
    }

    const line = mk('div', 'mehero__line');
    line.appendChild(mk('h2', 'mehero__name', d.nickname || cur.nickname || '未登录'));
    line.appendChild(mk('span', 'mehero__pl', p.name));
    if (d.level) line.appendChild(mk('span', 'mehero__lv', 'Lv.' + d.level));
    if (d.vip) line.appendChild(mk('span', 'mehero__vip', '黑胶 VIP'));

    const sign = String(d.sign || '').trim();
    body.appendChild(ava);
    body.appendChild(line);
    body.appendChild(mk(
      'p',
      'mehero__sign' + (sign ? '' : ' is-empty'),
      sign || (cur.detail ? '还没写个性签名' : '资料暂时读不到，稍后再来看')
    ));

    const stats = (Array.isArray(d.stats) ? d.stats : []).filter((s) => s && s.n != null);
    if (stats.length) {
      const wrap = mk('div', 'mehero__stats');
      stats.forEach((s) => {
        const cell = mk('div', 'mehero__stat');
        cell.append(mk('b', null, fmtBig(s.n)), mk('span', null, s.label || ''));
        wrap.appendChild(cell);
      });
      body.appendChild(wrap);
    }

    const meta = (Array.isArray(d.meta) ? d.meta : []).filter(Boolean);
    if (meta.length) {
      const m = mk('div', 'mehero__meta');
      meta.forEach((x) => m.appendChild(mk('span', null, x)));
      body.appendChild(m);
    }

    card.append(banner, body);
    el.meBody.appendChild(card);
    el.meBody.appendChild(mk(
      'p',
      'menote',
      '资料来自 ' + p.name + ' · 登录或退出在桌面端完成'
    ));
  }

  /* ------------------------------------------------------------------ *
   * 设置页「平台账号」只读列表
   * ------------------------------------------------------------------ */
  async function renderSetAccounts(force) {
    const box = el.setAccounts;
    if (!box) return;
    const token = ++setAcctSeq;
    box.innerHTML = '';
    box.appendChild(mk('p', 'setgroup__note setaccts__loading', '正在确认登录状态…'));
    if (!Array.isArray(window.LIZI_ACCOUNTS)) {
      box.innerHTML = '';
      box.appendChild(mk('p', 'setaccts__loading', '账号模块没有加载，刷新页面再试'));
      return;
    }
    try {
      const rows = await loadStatuses(force);
      if (token !== setAcctSeq) return;
      box.innerHTML = '';
      if (!rows.length) {
        box.appendChild(mk('p', 'setaccts__loading', '没有可用的平台账号模块'));
        return;
      }
      rows.forEach((r) => {
        const meta = ACCT_META[r.id] || { name: r.name, hint: '' };
        const p = PLAT(r.id);
        const row = mk('div', 'setacct' + (r.loggedIn ? ' is-on' : ''));
        if (p.logo) {
          const im = new Image();
          im.src = p.logo;
          im.alt = '';
          im.decoding = 'async';
          im.className = 'setacct__logo';
          row.appendChild(im);
        }
        const text = mk('div', 'setacct__text');
        text.append(mk('span', 'setacct__name', meta.name));
        text.appendChild(mk(
          'span',
          'setacct__sub',
          r.loggedIn ? (r.nickname || '已连接') : meta.hint
        ));
        const state = mk('span', 'setacct__state');
        state.append(mk('i', 'setacct__dot'), document.createTextNode(r.loggedIn ? '已登录' : '未登录'));
        row.append(text, state);
        box.appendChild(row);
      });
    } catch (e) {
      if (token === setAcctSeq) {
        box.innerHTML = '';
        box.appendChild(mk('p', 'setaccts__loading', '暂时读不到登录状态，稍后再试'));
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 更新检查（和 1.0.3 一致：启动 6 秒后自动查一次，不做 12 小时节流）
   * ------------------------------------------------------------------ */
  const GH_RELEASE = 'https://api.github.com/repos/woshi32s/liziair/releases/latest';
  const DL_LINKS = {
    quark: 'https://pan.quark.cn/s/6c6e65f3ee4c',
    baidu: 'https://pan.baidu.com/s/1crtOz-RxF6YyKLn9uxykWQ?pwd=lizi',
    gh: 'https://github.com/woshi32s/liziair/releases/latest',
  };
  let updating = false;
  let updateTag = '';

  function nativeVersion() {
    try {
      if (window.__liziNative && typeof window.__liziNative.version === 'function') {
        return String(window.__liziNative.version() || '');
      }
    } catch { /* 不在壳里 */ }
    return '';
  }
  function currentVersion() { return nativeVersion() || '1.0.3'; }

  function cmpVer(a, b) {
    const A = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const B = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function openExternal(url) {
    if (!/^https?:\/\//i.test(url)) return;
    try {
      if (window.__liziNative && typeof window.__liziNative.openExternal === 'function') {
        window.__liziNative.openExternal(url);
        return;
      }
    } catch { /* 桥坏了就退回浏览器 */ }
    try { window.open(url, '_blank', 'noopener'); } catch { /* 忽略 */ }
  }

  async function checkUpdate(manual) {
    if (updating) return;
    updating = true;
    if (manual) toast('正在检查更新…');
    try {
      const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
        ? AbortSignal.timeout(8000) : undefined;
      const res = await fetch(GH_RELEASE, {
        headers: { Accept: 'application/vnd.github+json' },
        signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      const tag = String((d && d.tag_name) || '').replace(/^v/i, '');
      if (!tag) throw new Error('no tag');
      const newer = cmpVer(tag, currentVersion()) > 0;
      if (newer) {
        let dismissed = '';
        try { dismissed = sessionStorage.getItem(KEY.updateDismissed) || ''; } catch { /* 忽略 */ }
        if (manual || dismissed !== tag) showUpdate(tag, d);
      } else if (manual) {
        toast(`已是最新版本 ${currentVersion()}`);
      }
    } catch {
      if (manual) toast('检查更新失败，稍后再试');
    } finally {
      updating = false;
    }
  }

  function showUpdate(tag, info) {
    /* 弹层同一时间只开一个；自动检查时如果用户正在搜索/设置，就不插队 */
    if (navOpen) return;
    updateTag = tag;
    el.updVer.textContent = 'v' + tag;
    const name = (info && info.name) ? String(info.name) : '';
    el.updNote.textContent = name && name !== tag ? name : '有更新可用。可以从下面任一入口下载。';
    el.update.hidden = false;
    pushNav('update');
  }

  function hideUpdate(silent) {
    el.update.hidden = true;
    /* 不管是点「稍后」还是按安卓返回键关掉，这次运行内都记住 */
    if (updateTag) {
      try { sessionStorage.setItem(KEY.updateDismissed, updateTag); } catch { /* 忽略 */ }
    }
    if (!silent) closeNav('update');
  }

  function bindUpdate() {
    el.updClose.addEventListener('click', () => {
      try { if (updateTag) sessionStorage.setItem(KEY.updateDismissed, updateTag); } catch { /* 忽略 */ }
      hideUpdate(false);
    });
    el.update.querySelectorAll('[data-link]').forEach((b) => {
      b.addEventListener('click', () => {
        const url = DL_LINKS[b.dataset.link];
        if (url) openExternal(url);
        try { if (updateTag) sessionStorage.setItem(KEY.updateDismissed, updateTag); } catch { /* 忽略 */ }
        hideUpdate(false);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 历史：安卓返回键先关弹层，再退出下钻，最后才让壳退出
   * ------------------------------------------------------------------ */
  let navOpen = '';
  let navPushed = false;
  let ignorePop = false;

  function pushNav(name) {
    navOpen = name;
    navPushed = true;
    try { history.pushState({ lizi: name }, ''); } catch { navPushed = false; }
  }

  function closeNav(name) {
    if (navOpen !== name) return;
    navOpen = '';
    if (!navPushed) return;
    /* 浮层下面如果还有一层下钻记录，它仍然归我们管 */
    navPushed = drillNav;
    ignorePop = true;
    try { history.back(); } catch { navPushed = false; ignorePop = false; }
  }

  function bindHistory() {
    try { history.replaceState({ lizi: 'hall' }, ''); } catch { /* 忽略 */ }
    window.addEventListener('popstate', () => {
      if (ignorePop) {
        ignorePop = false;
        /* 环里点歌单：等「环」这条记录真的弹掉，再 push 下钻记录，
           避免 history.back() 还没落地就 pushState 把栈弄乱 */
        if (pendingDrill >= 0) {
          const i = pendingDrill;
          pendingDrill = -1;
          setTimeout(() => activate(i), 0);
        }
        return;
      }
      if (navOpen) {
        const n = navOpen;
        navOpen = '';
        navPushed = drillNav;
        if (n === 'search') hideSearch(true);
        else if (n === 'settings') hideSettings(true);
        else if (n === 'me') hideMe(true);
        else if (n === 'update') hideUpdate(true);
        else if (n === 'artist') hideArtist(true);
        else if (n === 'album') hideAlbum(true);
        else if (n === 'forms') hideForms(true);
        else if (n === 'stage') hideStage(true);
        else if (n === 'tools') hideTools(true);
        else if (n === 'albums') hideAlbums(true);
        else if (n === 'now') hideNow(true);
        else if (n === 'ring' && ring) ring.close({ silent: true });
        return;
      }
      if (drillNav && S.drilled) {
        drillNav = false;
        navPushed = false;
        undrill();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 播放器事件
   * ------------------------------------------------------------------ */
  function bindPlayer() {
    if (!hasPlayer) return;

    Player.on('trackchange', ({ track }) => {
      if (!track) { el.pbar.hidden = true; return; }
      S.coverKind = 'track';
      S.coverItem = track;
      renderCover(track);
      paintTone(track);
      syncPlaying();
      el.pbar.hidden = false;
      if (nowOpen) {
        nowLyricKey = '';
        paintNowMeta(track);
        paintNowLyrics(Player.state.lyric, Player.state.lyricIndex);
      }
      if (stageOpen) stageInit(true);
    });

    Player.on('playstate', (playing) => {
      S.playing = !!playing;
      document.body.classList.toggle('is-playing', S.playing);
      if (el.nowArtWrap) el.nowArtWrap.classList.toggle('is-playing', S.playing);
      if (S.coverItem) renderCover(S.coverItem);
    });

    Player.on('time', ({ cur, total }) => {
      if (!(total > 0)) { el.pbarFill.style.clipPath = 'inset(0 100% 0 0)'; }
      else {
        const r = clamp(cur / total, 0, 1);
        el.pbarFill.style.clipPath = `inset(0 ${((1 - r) * 100).toFixed(2)}% 0 0)`;
        el.pbar.hidden = false;
      }
      /* 桌面是 app.js 在 time 里调 Player.lyricAt —— 手机如果只监听 lyric 事件，
         永远等不到下一句（事件源就是这次调用），歌词自然不动。 */
      if (typeof Player.lyricAt === 'function') Player.lyricAt(cur);
      if (nowOpen && !nowSeeking) paintNowProgress(cur, total);
    });

    Player.on('lyric', (d) => {
      if (nowOpen) paintNowLyrics(d && d.lines, d ? d.active : -1);
      if (stageOpen) stageInit(false);
    });

    Player.on('mode', (m) => paintNowMode(m));

    Player.on('source', ({ demo }) => {
      el.demo.hidden = !demo;
    });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function bindUI() {
    el.cover.addEventListener('click', (e) => {
      if (e.target.closest('.cover__play')) return;
      coverAction();
    });
    el.play.addEventListener('click', (e) => {
      e.stopPropagation();
      if (S.coverKind === 'collection' && S.coverItem) {
        const i = S.items.indexOf(S.coverItem);
        if (i >= 0) { drill(i); return; }
      }
      togglePlay();
    });

    el.back.addEventListener('click', () => {
      if (drillNav && navPushed) {
        try { history.back(); } catch { undrill(); }
      } else {
        undrill();
      }
    });

    el.btnMe.addEventListener('click', openMe);
    el.meClose.addEventListener('click', () => hideMe(false));

    bindSearch();
    bindSettings();
    bindUpdate();
    bindHistory();
    bindPages();
    bindNow();
    bindForms();
  }

  /* 环里点了卡片：歌曲直接播；歌单/电台等环的历史记录弹掉后再下钻，
     否则连续 pushState 会把层的顺序弄乱。 */
  function onRingPlay(item, index) {
    const raw = item && item.raw;
    const i = raw ? S.items.indexOf(raw) : index;
    if (i < 0 || !S.items[i]) return;
    if (S.type === 'collections') { pendingDrill = i; return; }
    activate(i);
  }

  function onRingOpenChange(open, reason) {
    if (open) { pushNav('ring'); return; }
    if (reason !== 'silent') closeNav('ring');
    /* ignorePop 为 true 说明环的历史记录正在弹，下钻交给 popstate 之后做 */
    if (pendingDrill >= 0 && !ignorePop) {
      const i = pendingDrill;
      pendingDrill = -1;
      activate(i);
    }
  }

  function initCoverFx() {
    if (!el.coverFx || !window.CoverFX) return;
    try { coverFx = window.CoverFX.mount(el.coverFx); } catch { coverFx = null; }
    if (!coverFx) el.coverFx.style.display = 'none';
  }

  function init() {
    applyPrefs();
    initCoverFx();

    if (window.HallNav) {
      hallNav = window.HallNav.create({
        platRow: el.platRow,
        srcRow: el.srcRow,
        plat: S.plat,
        src: S.src,
        plats: PLATS.map((p) => ({ id: p.id, label: p.name, logo: p.logo, bg: p.bg, ink: p.ink })),
        srcs: SRC_ITEMS.map((s) => ({ id: s.id, label: s.nav })),
        onPick: (row, id) => {
          if (row === 'plat') selectPlatform(id);
          else selectSource(id);
        },
      });
    }

    if (window.MobileRing) {
      ring = window.MobileRing.create({
        strip: el.strip,
        track: el.track,
        getItems: ringItems,
        reduced: () => prefMotion,
        onPlay: onRingPlay,
        onOpenChange: onRingOpenChange,
      });
    }

    paintPlatform();
    paintSources();
    bindUI();
    bindPlayer();
    loadSource(S.src);

    document.body.dataset.view = 'hall';
    setTimeout(() => checkUpdate(false), 6000);
  }

  init();
})();

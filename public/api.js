/**
 * 前端 API 层：只跟本机服务端说话，服务端再转发网易云。
 * 图片统一走 /api/img 代理（网易云封面有防盗链，直接 <img src> 会被拒）。
 */
const API = (() => {
  /* 请求超时：服务端连上了却不回包（上游卡死）时，fetch 默认会一直等，
     界面就永远停在“正在载入”。给每个请求一个上限，超时按普通错误处理。 */
  const timeout = (ms) => {
    try { return AbortSignal.timeout(ms); } catch { return undefined; }
  };

  async function call(path, params, method = 'POST') {
    const url = new URL('/api/' + path, location.origin);
    let body;
    if (method === 'POST') {
      body = JSON.stringify(params || {});
    } else {
      for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body,
      signal: timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * 和 call() 一样，但**不因 HTTP 500/502 抛异常** —— 直接把响应体还回来。
   * 边车起不来时服务端会回 502 + { code, error, reason }（例如「本机 node 版本不足」），
   * 界面要能显示这个原因，而不是一句 "HTTP 502"。
   */
  async function callSoft(path, params) {
    const url = new URL('/api/' + path, location.origin);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(url, { signal: timeout(20000) });
    } catch (e) {
      return { code: 0, ok: false, error: String(e.message) };
    }
    try {
      const body = await res.json();
      if (res.ok) return body;
      return { code: res.status, ok: false, ...body };
    } catch {
      return { code: res.status, ok: false, error: `HTTP ${res.status}` };
    }
  }

  /**
   * POST 但**不因 HTTP 400 抛异常**：扫码收尾（/api/login/harvest）和粘贴 cookie
   * （/api/session/import）失败时服务端会回 400 + { ok:false, reason, message }，
   * 界面要显示那句 message（例如「cookie 无效或已过期」），而不是 "HTTP 400"。
   */
  async function postSoft(path, params) {
    let res;
    try {
      res = await fetch(new URL('/api/' + path, location.origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params || {}),
        signal: timeout(20000),
      });
    } catch (e) {
      return { code: 0, ok: false, message: String(e.message) };
    }
    let body;
    try { body = await res.json(); } catch { body = {}; }
    return res.ok ? body : { code: res.status, ok: false, ...body };
  }

  /** 网易云封面多数是 http://，页面是 http:// 本机，混用没问题；统一转为代理地址 */
  const img = (u, size = 200) => {
    if (!u) return '';
    // 网易云支持 ?param=w×h 直接让服务端缩图，省流量
    const withSize = u.includes('?') ? u : `${u}?param=${size}y${size}`;
    return `/api/img?url=${encodeURIComponent(withSize)}`;
  };

  return {
    img,
    session: () => call('session', {}, 'GET'),

    /* 扫码：走网易云边车（services/netease-api/，和 Folia 同一个 API 服务），
       不再用我们手写的那条 weapi/eapi 通道（上游稳定回 8821）。
       服务端已经把边车的形状对齐成 { code, key, qrimg } / { code, message }。 */
    qrKey: () => call('netease/login/qr/key', {}, 'GET'),
    qrCheck: (key) => call('netease/login/qr/check', { key }, 'GET'),
    /** 803 之后收 cookie：服务端只取 MUSIC_U / __csrf 写进 .session.json，响应里没有值 */
    harvest: (key) => postSoft('login/harvest', { key }),
    /** 粘贴 cookie 登录（备用，也是最稳的一条）。成功 { ok:true, profile }，失败 { ok:false, message } */
    importCookie: (cookie) => postSoft('session/import', { cookie }),
    /** 边车存活探测（验收 / 排查用）：{ ok, port } */
    neteaseHealth: () => callSoft('netease/health'),
    logout: () => call('logout'),

    userPlaylists: (uid) => call('user/playlist', { uid }),
    /** 个人主页：头像/背景图/签名/等级/听歌量/关注粉丝。匿名可读公开信息 */
    userDetail: (uid) => call('user/detail', { uid }),
    playlistDetail: (id) => call('playlist/detail', { id }),
    /** 收藏的专辑（铺色态「我的专辑」层）：{ data:[{id,name,picUrl,size,artists:[{name}]}], count, hasMore } */
    neteaseAlbumSublist: (limit = 100, offset = 0) => call('netease/album/sublist', { limit, offset }, 'GET'),
    /* 音质档位由 window.LIZI_QUALITY 决定（public/audio/eq-engine.js 维护、可持久化）。
       调 player.js 那一行 `API.songUrl(track.id)` 因此不用改就能用上新音质。 */
    songUrl: (ids, level) => call('song/url', {
      ids: Array.isArray(ids) ? ids.join(',') : ids,
      level: level || (typeof window !== 'undefined' && window.LIZI_QUALITY) || 'exhigh',
    }),
    songWiki: (id) => call('song/wiki', { id }),
    /* 直链要走本机代理：网易云 CDN 不回 ACAO，而 <audio> 带着 crossOrigin='anonymous'
       （Web Audio 取频谱用），直接挂 CDN 地址会被 CORS 拦成 net::ERR_FAILED。 */
    neteaseAudio: (u) => (u ? `/api/netease/audio?url=${encodeURIComponent(u)}` : ''),
    lyric: (id) => call('lyric', { id }),
    search: (s, limit = 30) => call('search', { s, limit }),
    personalized: () => call('personalized'),
    /** 网易云「每日推荐」歌曲（和桌面大厅同一条路）；未登录时上游回空，调用方自己降级 */
    neteaseDaily: () => call('netease/recommend/songs', {}, 'GET'),
    /** 推荐歌单（大厅下滑那一屏）。返回 { playlists:[{id,name,cover,count,creator,tracks}] } */
    topPlaylists: (limit = 12, cat = '全部', order = 'hot') =>
      call('top/playlist', { limit, cat, order }),

    /* ------------------------------------------------------------------
       QQ 音乐（独立边车，第一次请求时由 server.mjs 自动拉起）
       形状和上面网易云那套保持一致：都回 { code, ... }。
       注意 QQ 的曲目 id 是 songmid（字符串），不是数字。
       ------------------------------------------------------------------ */
    qqHealth: () => call('qq/health', {}, 'GET'),
    qqStatus: () => call('qq/status', {}, 'GET'),
    /** 登录已失效时，本地旧凭据里还能读到的公开身份（uid / nickname / avatar），不是登录态 */
    qqCachedProfile: () => callSoft('qq/cached-profile'),
    /** 拿二维码：一次就回 { key, qrimg }，qrimg 是 data:image/png;base64,... */
    qqQrKey: (channel = 'qqmusic') => call('qq/login/qr/key', { channel }, 'GET'),
    /** 801 等待 / 802 待确认 / 803 成功 / 800 过期 */
    qqQrCheck: (key) => call('qq/login/qr/check', { key }, 'GET'),
    qqLogout: () => call('qq/logout', {}, 'GET'),
    qqSearch: (s, limit = 20) => call('qq/search', { s, limit }, 'GET'),
    qqSongUrl: (mid, quality = '128') => call('qq/song/url', { mid, quality }, 'GET'),
    qqLyric: (mid) => call('qq/lyric', { mid }, 'GET'),
    /* 铺色态的内容（2026-11-06）：推荐歌单 / 新歌 / 歌单详情 / 我的 都是同一个翻译层 */
    qqRecommendPlaylists: (limit = 9) => call('qq/recommend/playlists', { limit }, 'GET'),
    qqNewSongs: (limit = 30) => call('qq/recommend/new-songs', { limit }, 'GET'),
    qqPlaylistDetail: (id) => call('qq/playlist/detail', { id }, 'GET'),
    qqLikedSongs: (limit = 100) => call('qq/user/liked-songs', { limit }, 'GET'),
    qqUserPlaylists: () => call('qq/user/playlists', {}, 'GET'),
    qqDailySongs: () => call('qq/user/daily-songs', {}, 'GET'),
    /** 雷达推荐：匿名可用，未登录时当「每日推荐」的兜底 */
    qqRecommendRadar: (page = 1) => call('qq/recommend/radar', { page }, 'GET'),
    /** 电台频道目录（匿名）；点开频道听歌要登录，见 qqRadioTracks */
    qqRadioCategories: () => call('qq/radio/categories', {}, 'GET'),
    qqRadioTracks: (id) => call('qq/radio/tracks', { id }, 'GET'),
    /** 音频直链要走本机代理：vkey 会过期、CDN 有 referer 策略，也不该把凭证写进 DOM */
    qqAudio: (u) => (u ? `/api/qq/audio?url=${encodeURIComponent(u)}` : ''),

    /* ------------------------------------------------------------------
       其它音源（酷狗 / 汽水 / 波点 / Spotify）
       每个平台一个边车，形状统一是 { code, ... }，所以前端这边也做成一套：
       用 track.source 决定打哪个前缀，调用方（player.js / 搜索）不用 if/else。
       ------------------------------------------------------------------ */
    srcHealth: (src) => callSoft(`${src}/health`),
    srcStatus: (src) => callSoft(`${src}/status`),
    srcQrKey: (src) => callSoft(`${src}/login/qr/key`),
    srcQrCreate: (src, key) => callSoft(`${src}/login/qr/create`, { key }),
    srcQrCheck: (src, key) => callSoft(`${src}/login/qr/check`, { key }),
    srcLogout: (src) => callSoft(`${src}/logout`),
    /** Spotify 骨架：PKCE 授权地址（没有 client_id 时服务端会回 { code:400, error } ） */
    srcLoginUrl: (src) => callSoft(`${src}/login/url`),

    srcSearch: (src, s, limit = 20) => call(`${src}/search`, { s, limit }, 'GET'),

    /* 铺色态的内容（2026-11-06）：各平台能给的推荐 / 歌单都收在这里。
       形状和网易云那套对齐：tracks 是 { id,source,name,artists,... }，playlists 是 { id,name,cover,... } */
    qishuiFeed: (limit = 20, mode = '') => call('qishui/feed', mode ? { limit, mode } : { limit }, 'GET'),
    qishuiFeedModes: () => call('qishui/feed/modes', {}, 'GET'),
    qishuiUserPlaylists: (limit = 100) => call('qishui/user/playlists', { limit }, 'GET'),
    qishuiLikedIds: () => call('qishui/liked_songs', {}, 'GET'),
    qishuiPlaylistTracks: (id, limit = 50) => call('qishui/playlist/tracks', { id, limit }, 'GET'),
    /* 波点用 callSoft：边车起不来 / 老主服务还没重启时，服务端会回 502/404 +
       真实原因；这里不抛 HTTP 错，界面才能把 reason 原样显示出来。 */
    bodianPlaylistTracks: (id, limit = 50, source = 0) => callSoft('bodian/playlist/tracks',
      source ? { id, limit, source } : { id, limit }),
    /** 波点：推荐歌单 / 潮趣日推 / 私人 FM（匿名可用） */
    bodianRecommendations: () => callSoft('bodian/recommendations'),
    bodianDaily: (index = 0) => callSoft('bodian/ai/playlist', { index }),
    bodianPersonalFm: () => callSoft('bodian/personal/fm'),
    bodianUserPlaylists: () => callSoft('bodian/user/playlists'),
    bodianLikedSongs: () => callSoft('bodian/liked_songs'),
    kugouTopSongs: (type = 1) => call('kugou/top/songs', { type }, 'GET'),
    kugouDaily: () => call('kugou/everyday/recommend', {}, 'GET'),
    kugouTopPlaylists: (limit = 12) => call('kugou/top/playlists', { limit }, 'GET'),
    kugouPersonalFm: () => call('kugou/personal/fm', {}, 'GET'),
    /** 酷狗电台：频道目录匿名可读，按 fmid 取歌也匿名 */
    kugouRadioStations: () => call('kugou/fm/class', {}, 'GET'),
    kugouRadioTracks: (fmid, limit = 30) => call('kugou/fm/songs', { fmid, limit }, 'GET'),
    kugouPlaylistTracks: (id, limit = 100) => call('kugou/playlist/tracks', { id, limit }, 'GET'),
    kugouUserPlaylists: () => call('kugou/user/playlists', {}, 'GET'),

    /* 酷我（services/kuwo-api/）：内容接口用 callSoft，边车没起来 / 主服务没重启时
       能把 { code:404|502, error } 原样显示出来，而不是一句 "HTTP 502"。 */
    kuwoRanks: () => callSoft('kuwo/rank/list'),
    kuwoRankTracks: (id, limit = 50) => callSoft('kuwo/rank/tracks', { id, limit }),
    kuwoRecommendPlaylists: (limit = 12) => callSoft('kuwo/recommend/playlists', { limit }),
    kuwoPlaylistTracks: (id, limit = 100) => callSoft('kuwo/playlist/tracks', { id, limit }),
    kuwoDaily: () => callSoft('kuwo/daily'),
    /** 酷我只有 Cookie 登录（没有扫码）：整段 Cookie 走 POST body */
    kuwoCookieLogin: (cookie) => postSoft('kuwo/login/cookie', { cookie }),

    /* 网易云电台：透明转发已有路由，不需要改主服务 */
    neteaseDjRecommend: (limit = 8) => call('netease/dj/recommend', { limit }, 'GET'),
    neteaseDjPrograms: (rid, limit = 50) => call('netease/dj/program', { rid, limit }, 'GET'),

    /**
     * 播放直链。每个平台的必填参数不一样，差异只留在这里：
     *   酷狗认 hash + album_id + album_audio_id；汽水/波点是数字 id；Spotify 本期没有音频。
     * 统一返回 { url, preview, reason, error, clipStartMs?, previewRange? }
     */
    srcSongUrl: (track) => {
      const src = track.source;
      if (src === 'kugou') {
        return call('kugou/song/url', {
          hash: track.hash || track.id,
          albumId: track.albumIdNum || track.albumId || 0,
          albumAudioId: track.albumAudioId || 0,
        }, 'GET');
      }
      if (src === 'spotify') return call('spotify/song/url', { id: track.id }, 'GET');
      return call(`${src}/song/url`, { id: track.id }, 'GET');
    },

    srcLyric: (track) => {
      const src = track.source;
      if (src === 'kugou') return call('kugou/lyric', { hash: track.hash || track.id, s: track.name || '' }, 'GET');
      if (src === 'spotify') return call('spotify/lyric', { id: track.id }, 'GET');
      return call(`${src}/lyric`, { id: track.id }, 'GET');
    },

    /** 所有非网易云音源的音频都走各自代理（服务端按源做域名白名单 + 转发 Range） */
    srcAudio: (src, u) => (u ? `/api/${src}/audio?url=${encodeURIComponent(u)}` : ''),
  };
})();

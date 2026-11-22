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

  /* 服务端默认发「形态大图」，但各平台的尺寸开关不一样：只有网易云认 `?param=WxH`，
     QQ / 汽水 / 酷狗 / 酷我的尺寸写死在 URL 本身（?param= 会被忽略）。所以这里按
     调用方要的尺寸改 URL，列表和播放器小图才不会把 800~1000px 的大图整张拖下来。
     - QQ   y.gtimg.cn/music/photo_new/T002R<w>x<h>M000<mid>.jpg
            实测可用档 150/300/500/800/1200（R1200 实际出 1000×1000；R1000/R1600 是 404）
     - 汽水  p*.douyinpic.com/…~tplv-…-resize:480:480.image（任意尺寸，实测 120~2000）
     - 酷狗  imge.kugou.com/stdmusic/<w>/…、/soft/collection/<w>/…（实测 240~1200）
     - 酷我  img*.kuwo.cn/star/albumcover/<w>/…（实测 120/300/500/800） */
  const QQ_SIZES = [150, 300, 500, 800, 1200];
  const KG_SIZES = [240, 400, 480, 500, 800];
  const KW_SIZES = [120, 300, 500, 800];
  /* 取最接近的一档（等距取小，列表宁可省流量） */
  const nearSize = (sizes, want) => sizes.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));

  const sizedCover = (u, size) => {
    /* QQ：T002R300x300M000… → T002R<档>x<档>M000…（?param= 对 gtimg 无效） */
    if (/y\.gtimg\.cn\/music\/photo_new\/T002R\d+x\d+M000/.test(u)) {
      const s = nearSize(QQ_SIZES, size);
      return u.replace(/T002R\d+x\d+M000/, `T002R${s}x${s}M000`);
    }
    /* 汽水：模板里的 resize 尺寸直接改成请求值 */
    if (/resize:\d+:\d+\.image/.test(u)) {
      const s = Math.max(120, Math.min(1440, Math.round(Number(size) || 200)));
      return u.replace(/resize:\d+:\d+\.image/, `resize:${s}:${s}.image`);
    }
    /* 酷狗：路径里的尺寸段（/stdmusic/240/、/soft/collection/400/、/fmlogov2/240/…） */
    if (/\.(?:kugou|kgimg)\.com\//.test(u)) {
      const s = nearSize(KG_SIZES, size);
      return u.replace(/(\/(?:stdmusic|soft\/collection|collection|custom|fmlogov2)\/)(\d{2,4})(?=\/)/,
        (m, pre) => pre + s);
    }
    /* 酷我：/star/albumcover/<尺寸>/… */
    if (/\.kuwo\.cn\//.test(u)) {
      const s = nearSize(KW_SIZES, size);
      return u.replace(/(\/star\/albumcover\/)(\d{2,4})(?=\/)/, (m, pre) => pre + s);
    }
    // 其余（网易云等）沿用 ?param=，且和以前一样只在 URL 没带查询串时追加
    return u.includes('?') ? u : `${u}?param=${size}y${size}`;
  };

  /** 网易云封面多数是 http://，页面是 http:// 本机，混用没问题；统一转为代理地址 */
  const img = (u, size = 200) => {
    if (!u) return '';
    /* 本地音乐 / DJ 本地曲目的封面是本地 data URL（内嵌图抠出来的），
       不能塞进 /api/img 代理 —— 直接给 <img>。 */
    if (/^(data:|blob:)/i.test(u)) return u;
    return `/api/img?url=${encodeURIComponent(sizedCover(u, size))}`;
  };

  /* 音质档位必须在**播放时**才读 EqEngine：eq-engine.js 的加载顺序不保证，
     用户也可能刚在音效面板里改过档位。顶层 `const EqEngine` 不会自动挂到
     window（eq-engine.js 末尾显式挂了一份），这里两个都兜一下。 */
  const eqEngine = () => {
    try {
      if (typeof window !== 'undefined' && window.EqEngine) return window.EqEngine;
      return typeof EqEngine !== 'undefined' ? EqEngine : null;
    } catch { return null; }
  };
  const eqQualityFor = (src) => {
    try {
      const E = eqEngine();
      return (E && typeof E.qualityFor === 'function' && E.qualityFor(src)) || null;
    } catch { return null; }
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

    /* 高潮 / 副歌节点（2026-11-15）。字段说明见 server.mjs 里 handleChorus 上面那段。
       chorus(plat, id) → { ok:true, start, end, length, unit:'ms' }
                        | { ok:false, reason:'no-chorus' | 'unsupported' }
       chorusCaps()     → { supported:['bodian','netease'], detail:{...} }
       形态开跑前先调 chorusCaps()，就知道当前音源能不能拿到高潮。 */
    chorus: (plat, id) => call('chorus', { plat, id }, 'GET'),
    chorusCaps: () => call('chorus/capabilities', {}, 'GET'),
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
    /* 档位为空时取音效面板给 QQ 存的档位（默认 128）。实际能拿到什么由
       QQ 账号/会员决定，服务端只透传。 */
    qqSongUrl: (mid, quality) => {
      const q = quality || eqQualityFor('qq') || '128';
      return call('qq/song/url', { mid, quality: q }, 'GET');
    },
    qqLyric: (mid) => call('qq/lyric', { mid }, 'GET'),
    /* 铺色态的内容（2026-11-06）：推荐歌单 / 新歌 / 歌单详情 / 我的 都是同一个翻译层 */
    qqRecommendPlaylists: (limit = 9) => call('qq/recommend/playlists', { limit }, 'GET'),
    qqNewSongs: (limit = 30) => call('qq/recommend/new-songs', { limit }, 'GET'),
    /* dirId 可选：用户自己的歌单要带上目录 id，详情才能读到（不公开的歌单尤其需要） */
    qqPlaylistDetail: (id, dirId) => call(
      'qq/playlist/detail',
      dirId ? { id, dirId } : { id },
      'GET'
    ),
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
    /* params 可选：酷狗概念版行靠 { profile: 'lite' } 指定边车和 cookie jar */
    srcHealth: (src, params) => callSoft(`${src}/health`, params),
    /** /status 里的 activeProfile / profileSource / jarWritable 是当前版本诊断字段 */
    srcStatus: (src, params) => callSoft(`${src}/status`, params),
    srcQrKey: (src, params) => callSoft(`${src}/login/qr/key`, params),
    srcQrCreate: (src, key, params) => callSoft(`${src}/login/qr/create`, { key, ...(params || {}) }),
    /** 803 成功时服务端已把 jar 落盘并回读校验（token+userid），active 也切到这一版 */
    srcQrCheck: (src, key, params) => callSoft(`${src}/login/qr/check`, { key, ...(params || {}) }),
    srcLogout: (src, params) => callSoft(`${src}/logout`, params),
    /** 酷狗两版状态：evaluate 强制重算，platform 读 10 分钟缓存。
        版本由「最后成功登录」决定，VIP 只用于显示，不再自动选路。 */
    kugouPlatform: (force = true) => callSoft(force ? 'kugou/platform/evaluate' : 'kugou/platform'),
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
    /* count 是列表里的 musicCount，只用于区分「真空歌单」和「source 传错回空」，
       不参与取曲目；服务端拿到 0 首时会据此返回可显示的 error。 */
    bodianPlaylistTracks: (id, limit = 50, source = 0, count = 0) => callSoft('bodian/playlist/tracks',
      source ? { id, limit, source, count } : { id, limit, count }),
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
    kugouPlaylistTracks: (id, limit = 100, page = 1) => call('kugou/playlist/tracks', { id, limit, page }, 'GET'),
    /** 整张酷狗歌单：服务端按 100/页翻完并去重（大厅跑马带 / 歌单详情用） */
    kugouPlaylistTracksAll: (id) => call('kugou/playlist/tracks', { id, all: 1 }, 'GET'),
    kugouUserPlaylists: () => call('kugou/user/playlists', {}, 'GET'),
    /** 酷狗「我喜欢」＝账号歌单里的系统歌单（collection_…_2_0）；服务端挑出来再翻曲目 */
    kugouLikedSongs: (limit = 100) => callSoft('kugou/liked/songs', { limit }),

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
     * 统一返回 { url, preview, reason, error, clipStartMs?, previewRange? }；
     * 没有地址时 url 为空串 + reason（登录 / 版权 / 地区等），player 不会再合成演示音。
     */
    srcSongUrl: (track, quality) => {
      const src = track.source;
      /* 档位由音效面板按平台保存；没有档位的源（本地 / Spotify / 未知）不传
         quality，免得服务端把 undefined 当字符串。酷狗服务端白名单是
         ['128','320','flac']，传别的会被降成 128。 */
      const q = quality || eqQualityFor(src);
      if (src === 'kugou') {
        const params = {
          hash: track.hash || track.id,
          albumId: track.albumIdNum || track.albumId || 0,
          albumAudioId: track.albumAudioId || 0,
        };
        if (q) params.quality = q;
        return call('kugou/song/url', params, 'GET');
      }
      if (src === 'spotify') return call('spotify/song/url', { id: track.id }, 'GET');
      const params = { id: track.id };
      if (q) params.quality = q;
      return call(`${src}/song/url`, params, 'GET');
    },

    srcLyric: (track) => {
      const src = track.source;
      if (src === 'kugou') {
        /* 酷狗歌词只认 hash 不够：上游对纯音乐/翻唱会回别人的词（见 server.mjs
           kugouLyricPick）。把歌名、歌手、时长一起带上，服务端据此核对候选。 */
        return call('kugou/lyric', {
          hash: track.hash || track.id,
          s: track.name || '',
          singer: track.artists || track.singer || track.artist || '',
          duration: Number(track.duration) || 0,
        }, 'GET');
      }
      if (src === 'spotify') return call('spotify/lyric', { id: track.id }, 'GET');
      return call(`${src}/lyric`, { id: track.id }, 'GET');
    },

    /** 所有非网易云音源的音频都走各自代理（服务端按源做域名白名单 + 转发 Range） */
    srcAudio: (src, u) => (u ? `/api/${src}/audio?url=${encodeURIComponent(u)}` : ''),
  };
})();

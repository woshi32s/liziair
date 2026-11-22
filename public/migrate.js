/* ==========================================================================
   LIZI · 歌单搬运（跨平台迁移）
   --------------------------------------------------------------------------
   做什么：从任意已接入的平台读一张歌单，逐首在目标平台搜索 → 按「歌名 + 歌手 +
   时长」打分 → 三档（自动 / 待确认 / 未找到）→ 人工确认 → 能写的平台直接建歌单
   写进去，不能写的导出 CSV / M3U8。

   来源：网易云 / QQ 音乐 / 酷狗 / 汽水 / 波点 / 酷我（公开歌单）/ 本地曲库。
   目标：网易云 / QQ 音乐 / 酷狗可写入；汽水 / 波点只导出清单。

   保留的旧行为：
     - 匹配算法与阈值逐字不变（歌名 .55 / 歌手 .30 / 时长 .15，8 秒容差）。
     - 3 路并发匹配，单首失败不影响整轮。
     - 面板重开 / 切换来源时丢弃迟到响应。
     - 写入成功后按钮保持置灰，防止重复建歌单。
     - CSV / M3U8 的字段、文件名不变，未找到的曲目不导出。

   不碰 app.js 的视图体系：自己注入浮层，只用工具箱里那一行入口。
   ========================================================================== */

window.MIGRATE = (() => {
  /* ---------------- 平台表 ---------------- */
  const TARGETS = [
    { id: 'netease', name: '网易云', canWrite: true },
    { id: 'qq', name: 'QQ 音乐', canWrite: true },
    { id: 'kugou', name: '酷狗', canWrite: true },
    { id: 'qishui', name: '汽水', canWrite: false },
    { id: 'bodian', name: '波点', canWrite: false },
  ];
  const TARGET_MAP = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

  /* ---------------- 通用小工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /** 从几种常见层级里取数组；取不到就回空数组 */
  function listFrom(d, keys) {
    if (!d || typeof d !== 'object') return [];
    for (const key of keys) {
      let cur = d;
      for (const part of String(key).split('.')) {
        cur = cur && typeof cur === 'object' ? cur[part] : null;
      }
      if (Array.isArray(cur)) return cur;
    }
    return [];
  }

  function errText(d) {
    if (!d || typeof d !== 'object') return '';
    return String(d.error || d.msg || d.message || '').trim();
  }

  /** 第一页/单次请求：空数组 + 错误码时必须抛出去，不能装成「没有歌单 / 没有曲目」 */
  function checkFirst(d, arr, fallback) {
    if (arr.length) return;
    if (!d || typeof d !== 'object') throw new Error(fallback);
    const bad = d.error || d.raw || (d.code != null && Number(d.code) !== 200);
    if (bad) throw new Error(errText(d) || fallback);
  }

  /** 统一曲目形状：所有来源都走这里，兜住各平台字段别名 */
  function normTrack(t, srcId) {
    if (!t || typeof t !== 'object') return null;
    const name = String(t.name || t.title || t.songName || '').trim();
    if (!name) return null;

    let artists = '';
    if (typeof t.artists === 'string') {
      artists = t.artists;
    } else if (Array.isArray(t.artists)) {
      artists = t.artists
        .map((a) => (a && typeof a === 'object') ? (a.name || '') : String(a || ''))
        .filter(Boolean).join(' / ');
    }
    if (!artists && Array.isArray(t.ar)) {
      artists = t.ar.map((a) => (a && a.name) || '').filter(Boolean).join(' / ');
    }
    if (!artists && Array.isArray(t.singer)) {
      artists = t.singer
        .map((a) => (a && typeof a === 'object') ? (a.name || '') : String(a || ''))
        .filter(Boolean).join(' / ');
    }
    if (!artists && typeof t.artist === 'string') artists = t.artist;
    if (!artists && typeof t.singer === 'string') artists = t.singer;

    let album = '';
    if (typeof t.album === 'string') album = t.album;
    else if (t.album && typeof t.album === 'object' && t.album.name) album = t.album.name;
    else if (t.al && t.al.name) album = t.al.name;

    /* duration 优先；没有才用 dt；最后才把 QQ 的 interval（秒）换成毫秒 */
    let duration = 0;
    if (t.duration !== undefined && t.duration !== null) duration = Number(t.duration) || 0;
    else if (t.dt !== undefined && t.dt !== null) duration = Number(t.dt) || 0;
    else if (t.interval) duration = (Number(t.interval) || 0) * 1000;

    const id = t.id !== undefined && t.id !== null
      ? String(t.id)
      : String(t.hash || t.mid || t.songId || '');

    return { id, name, artists, album, duration };
  }

  function dedupeTracks(list) {
    const out = [];
    const seen = new Set();
    for (const t of list || []) {
      if (!t) continue;
      const key = t.id ? String(t.id) : `${t.name}|${t.artists || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  /** 顺序翻页。第一页失败抛错；后续页失败返回已拿到的曲目 + partial=true。
      停止条件：空页、短页、more=false、没有新曲目、20 页 / 2000 首、达到 trackCount。 */
  async function readPages(fetchPage, opts = {}) {
    const limit = Math.max(1, Number(opts.limit) || 100);
    const expected = Math.max(0, Number(opts.expected) || 0);
    const tracks = [];
    const seen = new Set();
    let partial = false;

    for (let page = 0; page < 20; page++) {
      let step;
      try {
        step = await fetchPage(page);
      } catch (e) {
        if (page === 0) throw e;
        partial = true;
        break;
      }

      const items = (step && Array.isArray(step.items)) ? step.items : [];
      if (!items.length) {
        if (step && step.error) {
          if (page === 0) throw new Error(step.error);
          partial = true;
        }
        break;
      }

      let fresh = 0;
      for (const t of items) {
        if (!t || !t.name) continue;
        const key = t.id ? String(t.id) : `${t.name}|${t.artists || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tracks.push(t);
        fresh++;
        if (tracks.length >= 2000) break;
      }

      if (tracks.length >= 2000) break;
      if (expected > 0 && tracks.length >= expected) break;
      if (step.error) { partial = true; break; }
      if (step.more === false) break;
      if (items.length < limit) break;
      if (!fresh) break;
    }

    return { tracks, partial };
  }

  /* ---------------- 网络 ---------------- */
  const J = async (url, opt) => {
    const r = await fetch(url, opt);
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200) }; }
  };

  const LOGO = (id) => `/assets/platforms/${id}.svg`;

  /* ---------------- 来源注册表 ---------------- */
  const SOURCES = [
    {
      id: 'netease', name: '网易云', short: '网易云', logo: LOGO('netease'), kind: 'account',
      async status() {
        const d = await J('/api/session');
        if (!d || d.raw) return { loggedIn: false, failed: true, error: '登录状态接口没有正常响应' };
        return {
          loggedIn: d.loggedIn === true,
          nickname: (d.profile && d.profile.nickname) || '',
          userId: (d.profile && d.profile.userId) || '',
          error: d.error || '',
        };
      },
      async playlists(st) {
        const uid = st && st.userId;
        if (!uid) throw new Error('没拿到网易云账号 id');
        const d = await J(`/api/netease/user/playlist?uid=${encodeURIComponent(uid)}`);
        const arr = listFrom(d, ['playlist', 'playlists', 'data.playlist', 'data.playlists']);
        checkFirst(d, arr, '歌单列表接口返回异常');
        return arr.filter((p) => p && p.id).map((p) => ({
          id: String(p.id),
          name: p.name || '未命名歌单',
          count: Number(p.trackCount ?? (p.tracks && p.tracks.length) ?? 0) || 0,
          cover: p.coverImgUrl || p.cover || '',
        }));
      },
      async tracks(p) {
        const d = await J(`/api/netease/playlist/track/all?id=${encodeURIComponent(p.id)}&limit=500`);
        const arr = listFrom(d, ['songs', 'tracks', 'playlist.tracks', 'data']);
        if (!Array.isArray(arr)) throw new Error(errText(d) || '曲目接口返回异常');
        checkFirst(d, arr, '曲目接口返回异常');
        const tracks = dedupeTracks(arr.map((t) => normTrack(t, 'netease')).filter(Boolean));
        return { tracks, partial: false };
      },
    },
    {
      id: 'qq', name: 'QQ 音乐', short: 'QQ', logo: LOGO('qq'), kind: 'account',
      async status() {
        const d = await J('/api/qq/status');
        if (!d || d.raw) return { loggedIn: false, failed: true, error: '登录状态接口没有正常响应' };
        return {
          loggedIn: d.loggedIn === true,
          nickname: d.nickname || '',
          error: d.error || (d.stale ? '登录已过期，重新扫码' : ''),
        };
      },
      async playlists() {
        const d = await J('/api/qq/user/playlists');
        const arr = listFrom(d, ['playlists', 'playlist', 'data.playlists']);
        checkFirst(d, arr, '取 QQ 歌单失败');
        return arr.filter((p) => p && p.id).map((p) => ({
          id: String(p.id),
          /* dirId 是详情接口要用的目录 id（201 = 我喜欢），必须跟着歌单一起存 */
          dirId: String(p.dirId ?? p.dirid ?? ''),
          name: p.name || '未命名歌单',
          count: Number(p.trackCount) || 0,
          cover: p.cover || p.coverImgUrl || '',
        }));
      },
      async tracks(p) {
        const limit = 100;
        const liked = String(p.dirId) === '201' || /我喜欢/.test(p.name || '');
        return readPages(async (page) => {
          const offset = page * limit;
          const url = liked
            ? `/api/qq/user/liked-songs?limit=${limit}&offset=${offset}`
            : `/api/qq/playlist/detail?id=${encodeURIComponent(p.id)}&dirId=${encodeURIComponent(p.dirId || '')}&limit=${limit}&offset=${offset}`;
          const d = await J(url);
          const arr = listFrom(d, ['tracks', 'songs', 'data.tracks', 'data.songs']);
          const error = errText(d);
          if (!arr.length && d && (error || d.raw || (d.code != null && Number(d.code) !== 200))) {
            return { items: [], error: error || '曲目接口返回异常', more: false };
          }
          const total = Number(d && d.total) || 0;
          return {
            items: arr.map((t) => normTrack(t, 'qq')).filter(Boolean),
            more: d && d.more !== undefined
              ? d.more
              : (total > 0 ? offset + arr.length < total : undefined),
            error,
          };
        }, { limit, expected: Number(p.count) || 0 });
      },
    },
    {
      id: 'kugou', name: '酷狗', short: '酷狗', logo: LOGO('kugou'), kind: 'account',
      async status() {
        const d = await J('/api/kugou/status');
        if (!d || d.raw) return { loggedIn: false, failed: true, error: '登录状态接口没有正常响应' };
        return { loggedIn: d.loggedIn === true, nickname: d.nickname || '', error: d.error || '' };
      },
      async playlists() {
        const d = await J('/api/kugou/user/playlists');
        const arr = listFrom(d, ['playlists', 'playlist', 'data.playlists']);
        checkFirst(d, arr, '取酷狗歌单失败');
        return arr
          .filter((p) => p && p.id)
          /* 收藏专辑混在歌单列表里：raw source=2 或带 musiclib_id 的都不是真歌单 */
          .filter((p) => Number(p.rawSource) !== 2 && !String(p.musiclibId || p.musiclib_id || '').trim())
          .map((p) => ({
            id: String(p.id),
            name: p.name || '未命名歌单',
            count: Number(p.trackCount) || 0,
            cover: p.cover || '',
          }));
      },
      async tracks(p) {
        const limit = 100;
        return readPages(async (page) => {
          const d = await J(`/api/kugou/playlist/tracks?id=${encodeURIComponent(p.id)}&limit=${limit}&page=${page + 1}`);
          const arr = listFrom(d, ['tracks', 'data.tracks']);
          const error = errText(d);
          if (!arr.length && d && (error || d.raw || (d.code != null && Number(d.code) !== 200))) {
            return { items: [], error: error || '曲目接口返回异常', more: false };
          }
          const total = Number(d.trackCount) || Number(p.count) || 0;
          return {
            items: arr.map((t) => normTrack(t, 'kugou')).filter(Boolean),
            more: total > 0 ? (page + 1) * limit < total : undefined,
            error,
          };
        }, { limit, expected: Number(p.count) || 0 });
      },
    },
    {
      id: 'qishui', name: '汽水', short: '汽水', logo: LOGO('qishui'), kind: 'account',
      async status() {
        const d = await J('/api/qishui/status');
        if (!d || d.raw) return { loggedIn: false, failed: true, error: '登录状态接口没有正常响应' };
        return { loggedIn: d.loggedIn === true, nickname: d.nickname || '', error: d.error || '' };
      },
      async playlists() {
        const d = await J('/api/qishui/user/playlists');
        const arr = listFrom(d, ['playlists', 'playlist', 'data.playlists']);
        checkFirst(d, arr, '取汽水歌单失败');
        return arr.filter((p) => p && p.id).map((p) => ({
          id: String(p.id),
          name: p.name || '未命名歌单',
          count: Number(p.trackCount) || 0,
          cover: p.cover || '',
          type: Number(p.type) || 0,
        }));
      },
      async tracks(p) {
        const limit = 100;
        return readPages(async (page) => {
          const d = await J(`/api/qishui/playlist/tracks?id=${encodeURIComponent(p.id)}&limit=${limit}&offset=${page * limit}`);
          const arr = listFrom(d, ['tracks', 'data.tracks']);
          const error = errText(d);
          if (!arr.length && d && (error || d.raw || (d.code != null && Number(d.code) !== 200))) {
            return { items: [], error: error || '曲目接口返回异常', more: false };
          }
          return {
            items: arr.map((t) => normTrack(t, 'qishui')).filter(Boolean),
            more: d && d.more,
            error,
          };
        }, { limit, expected: Number(p.count) || 0 });
      },
    },
    {
      id: 'bodian', name: '波点', short: '波点', logo: LOGO('bodian'), kind: 'account',
      async status() {
        const d = await J('/api/bodian/status');
        if (!d || d.raw) return { loggedIn: false, failed: true, error: '登录状态接口没有正常响应' };
        return { loggedIn: d.loggedIn === true, nickname: d.nickname || '', error: d.error || '' };
      },
      async playlists() {
        const d = await J('/api/bodian/user/playlists');
        const arr = listFrom(d, ['playlists', 'playlist', 'data.playlists']);
        checkFirst(d, arr, '取波点歌单失败');
        return arr.filter((p) => p && p.id).map((p) => ({
          id: String(p.id),
          name: p.name || '未命名歌单',
          count: Number(p.trackCount) || 0,
          cover: p.cover || '',
          /* 取曲目时必须带回 source，传错上游会回 200 + 空列表 */
          sourceType: Number(p.sourceType) || 4,
        }));
      },
      async tracks(p) {
        const limit = 100;
        const expected = Number(p.count) || 0;
        const source = Number(p.sourceType) || 4;
        /* 注意：不要传 count。服务端会拿 count 做「上游 0 首」校验，
           翻到最后一页（0 首）会被判成 502，而不是正常的 more:false。 */
        const res = await readPages(async (page) => {
          const d = await J(`/api/bodian/playlist/tracks?id=${encodeURIComponent(p.id)}&limit=${limit}&offset=${page * limit}&source=${source}`);
          const arr = listFrom(d, ['tracks', 'data.tracks']);
          const error = errText(d);
          if (!arr.length && d && (error || d.raw || (d.code != null && Number(d.code) !== 200))) {
            return { items: [], error: error || '曲目接口返回异常', more: false };
          }
          return {
            items: arr.map((t) => normTrack(t, 'bodian')).filter(Boolean),
            more: d && d.more,
            error,
          };
        }, { limit, expected });

        if (!res.tracks.length && expected > 0 && !res.partial) {
          res.note = '这张歌单读不到曲目，可能是来源类型不匹配';
        }
        return res;
      },
    },
    {
      id: 'kuwo', name: '酷我', short: '酷我', logo: LOGO('kuwo'), kind: 'public',
      async status() {
        return { loggedIn: true, nickname: '公开歌单', hint: '公开歌单，不用登录' };
      },
      async playlists() {
        const d = await J('/api/kuwo/recommend/playlists?limit=12');
        const arr = listFrom(d, ['playlists', 'data.playlists']);
        checkFirst(d, arr, '取酷我推荐歌单失败');
        return mapKuwoPlaylists(arr);
      },
      async search(q) {
        const kw = String(q || '').trim();
        const url = kw
          ? `/api/kuwo/playlist/search?key=${encodeURIComponent(kw)}&limit=30`
          : '/api/kuwo/recommend/playlists?limit=12';
        const d = await J(url);
        const arr = listFrom(d, ['playlists', 'data.playlists']);
        checkFirst(d, arr, kw ? '搜索酷我公开歌单失败' : '取酷我推荐歌单失败');
        return mapKuwoPlaylists(arr);
      },
      async tracks(p) {
        const limit = 200;
        return readPages(async (page) => {
          const d = await J(`/api/kuwo/playlist/tracks?id=${encodeURIComponent(p.id)}&limit=${limit}&page=${page + 1}`);
          const arr = listFrom(d, ['tracks', 'data.tracks']);
          const error = errText(d);
          if (!arr.length && d && (error || d.raw || (d.code != null && Number(d.code) !== 200))) {
            return { items: [], error: error || '曲目接口返回异常', more: false };
          }
          const total = Number(d.total) || Number(p.count) || 0;
          return {
            items: arr.map((t) => normTrack(t, 'kuwo')).filter(Boolean),
            more: total > 0 ? (page + 1) * limit < total : undefined,
            error,
          };
        }, { limit, expected: Number(p.count) || 0 });
      },
    },
    {
      id: 'local', name: '本地曲库', short: '本地', logo: LOGO('local'), kind: 'local',
      async status() {
        const L = window.LIZI_LOCAL;
        if (!L || typeof L.list !== 'function') {
          return { loggedIn: false, error: '本地曲库没加载' };
        }
        let count = 0;
        try { count = typeof L.count === 'function' ? await L.count() : 0; } catch { count = 0; }
        return { loggedIn: true, nickname: '本地曲库', hint: `${count} 首`, count };
      },
      async playlists(st) {
        const n = st && Number.isFinite(Number(st.count)) ? Number(st.count) : 0;
        return [{ id: '__local', name: '全部本地歌曲', count: n, cover: '' }];
      },
      async tracks() {
        const L = window.LIZI_LOCAL;
        if (!L || typeof L.list !== 'function') throw new Error('本地曲库没加载');
        const rows = await L.list();
        const tracks = dedupeTracks((Array.isArray(rows) ? rows : []).map((t) => {
          const n = normTrack(t, 'local');
          if (!n) return null;
          return {
            ...n,
            artists: n.artists || '未知歌手',
            album: n.album || '本地文件',
          };
        }).filter(Boolean));
        return { tracks, partial: false };
      },
    },
  ];
  const SOURCE_MAP = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

  function mapKuwoPlaylists(arr) {
    return (arr || []).filter((p) => p && p.id).map((p) => ({
      id: String(p.id),
      name: p.name || '未命名歌单',
      count: Number(p.trackCount) || 0,
      cover: p.cover || '',
    }));
  }

  /* ---------------- 匹配算法（纯函数，可单测） ---------------- */

  /** 归一化：去掉括号里的版本信息（(Live) / 【伴奏】/ (Remastered)…）、标点、大小写 */
  function normTitle(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）|【[^】]*】/g, ' ')
      .replace(/\b(feat|ft|featuring)\b\.?.*$/g, ' ')
      .replace(/[\s\-_·.,，。!！?？'"“”‘’/\\|&+]+/g, ' ')
      .trim();
  }

  /** 主歌手：取第一个，去掉 feat 之后的部分 */
  function mainArtist(s) {
    return String(s || '')
      .split(/[\/,&、]/)[0]
      .replace(/\b(feat|ft|featuring)\b\.?.*$/gi, '')
      .trim()
      .toLowerCase();
  }

  function bigrams(s) {
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    if (!out.size && s) out.add(s);
    return out;
  }

  /** Dice 系数：中文用 bigram，英文短词也能凑合 */
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return (2 * inter) / (A.size + B.size || 1);
  }

  /** 单条打分：0..1。权重 歌名 .55 / 歌手 .30 / 时长 .15 */
  function score(src, cand) {
    const ns = dice(normTitle(src.name), normTitle(cand.name));
    const as = dice(mainArtist(src.artists), mainArtist(cand.artists));
    let ds = 0;
    if (src.duration > 0 && cand.duration > 0) {
      ds = 1 - Math.min(1, Math.abs(src.duration - cand.duration) / 8000);   // 8 秒容差
      ds = Math.max(0, ds);
    } else ds = 0.5;                                                        // 缺时长时不给满分也不判死
    const total = 0.55 * ns + 0.30 * as + 0.15 * ds;
    return { total: +total.toFixed(3), name: +ns.toFixed(3), artist: +as.toFixed(3), dur: +ds.toFixed(3) };
  }

  /** 给一首源曲在候选里挑最好的三个 */
  function best(src, cands) {
    return (cands || [])
      .map((c) => ({ cand: c, s: score(src, c) }))
      .sort((a, b) => b.s.total - a.s.total)
      .slice(0, 3);
  }

  /* 分档：≥0.86 自动加；0.50~0.86 一律进「待确认」让人自己看。
     0.50 而不是 0.62 —— 实测「翻唱」「同名不同歌」都落在 0.55，
     它们不该被标成「未找到」藏起来（用户至少要知道"有这首，但是别人唱的"）。 */
  const BAND = (v) => (v >= 0.86 ? 'auto' : v >= 0.50 ? 'review' : 'miss');

  /* ---------------- 目标搜索 / 写入 ---------------- */
  async function searchTarget(src, q, limit = 8) {
    const url = src === 'netease'
      ? `/api/search?s=${encodeURIComponent(q)}&limit=${limit}`
      : `/api/${src}/search?s=${encodeURIComponent(q)}&limit=${limit}`;
    const d = await J(url);
    const arr = (d && (d.tracks || d.songs || d.result?.songs)) || [];
    return arr.map((t) => ({
      id: t.id,
      name: t.name,
      artists: typeof t.artists === 'string' ? t.artists
        : (t.ar || t.artists || []).map((a) => a.name).join(' / '),
      album: (t.al && t.al.name) || t.album?.name || t.album || '',
      duration: t.dt || t.duration || 0,
      source: src,
      /* 写入要的目标平台定位字段（只增不改）：酷狗要 hash/专辑id/albumAudioId，
         QQ 要数字 songid；网易云仍然只用 id。 */
      hash: t.hash || '',
      songId: Number(t.songId) > 0 ? Number(t.songId) : 0,
      mid: t.mid || '',
      albumId: t.albumId || '',
      albumIdNum: Number(t.albumIdNum) > 0 ? Number(t.albumIdNum) : 0,
      albumAudioId: Number(t.albumAudioId) > 0 ? Number(t.albumAudioId) : 0,
    }));
  }

  /** 建歌单：按目标平台分派。网易云保持原来的 GET 路径与参数逐字不变。 */
  async function createPlaylist(target, name) {
    if (target === 'netease') {
      return J(`/api/netease/playlist/create?name=${encodeURIComponent(name)}`);
    }
    if (target === 'qq' || target === 'kugou') {
      /* 这两个平台的写接口参数语义完全不同（QQ 只收 {name}，酷狗还要 userid/listid），
         所以走各自服务端的显式写路由，不做透明代理。 */
      return J(`/api/${target}/playlist/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    }
    throw new Error(`${target} 没有写入通道`);
  }

  async function addTracks(target, pid, picks) {
    if (target === 'netease') {
      const ids = picks.map((p) => p.id);
      /* 保留原来的路径与 tracks 参数（调用方/日志都按这个走），但必须补两处兼容：
         1) 边车注册的路由是单数 /playlist/track/add，复数 /tracks/add 会 404；
         2) 边车读的参数名是 ids，不认 tracks（见 module/playlist_track_add.js）。
         先按原路径发（保持逐字不变），确认是 404/非 JSON 再退回单数路径。
         两条都带 ids，避免任何一个版本因为参数名不同而「成功但一首没加」。 */
      const qs = `pid=${encodeURIComponent(pid)}&tracks=${ids.join(',')}&ids=${ids.join(',')}`;
      const r = await J(`/api/netease/playlist/tracks/add?${qs}`);
      if (r && (Number(r.code) === 200 || Number(r.status) === 200)) return r;
      if (r && (Number(r.code) === 404 || Number(r.status) === 404 || r.raw)) {
        return J(`/api/netease/playlist/track/add?${qs}`);   // 边车的真实路由
      }
      return r;                                              // 业务错误原样交给调用方展示
    }
    if (target === 'qq') {
      /* QQ 上游 /user/playlist/tracks 只认数字 songid（body: tid + op:'add' + songs:[{id,type:0}]），
         不认 songmid。songId 来自 /api/qq/search 的映射；缺失时服务端会用 /song/batch 按 mid 解析。 */
      const songs = picks.map((p) => ({
        id: Number(p.songId) > 0 ? Number(p.songId) : 0,
        mid: p.mid || String(p.id || ''),
        type: 0,
      }));
      return J('/api/qq/playlist/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tid: pid, songs }),
      });
    }
    if (target === 'kugou') {
      /* 酷狗 /playlist/tracks/add 的 data 是逗号分隔的「歌名|hash|专辑id|mixsongid」；
         拼串交给服务端做（歌名里的 | 和 , 需要清洗），这里把搜索命中的定位字段整包带过去。 */
      return J('/api/kugou/playlist/tracks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listid: pid,
          picks: picks.map((p) => ({
            name: p.name,
            hash: p.hash || (/^[0-9a-f]{32}$/i.test(String(p.id || '')) ? p.id : ''),
            albumIdNum: Number(p.albumIdNum) || 0,
            albumAudioId: Number(p.albumAudioId) || 0,
          })),
        }),
      });
    }
    throw new Error(`${target} 没有写入通道`);
  }

  /* ---------------- 导出 ---------------- */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  function toCSV(rows) {
    const head = ['歌名', '歌手', '专辑', '时长(秒)', '状态', '目标平台', '目标歌名', '目标歌手'];
    const body = rows.map((r) => [
      r.src.name, r.src.artists, r.src.album, Math.round((r.src.duration || 0) / 1000),
      r.status, r.pick ? r.pick.source : '', r.pick ? r.pick.name : '', r.pick ? r.pick.artists : '',
    ].map(csvCell).join(','));
    return '﻿' + [head.map(csvCell).join(','), ...body].join('\r\n');   // BOM：Excel 不乱码
  }
  function toM3U(rows, name) {
    const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
    for (const r of rows) {
      if (!r.pick) continue;
      const sec = Math.round((r.src.duration || 0) / 1000);
      lines.push(`#EXTINF:${sec},${r.pick.artists} - ${r.pick.name}`);
      lines.push(`lizi://${r.pick.source}/${r.pick.id}`);
    }
    return lines.join('\n');
  }

  /* ======================== UI ======================== */
  let root, els, state = null;
  /* 打开面板 / 选歌单都可能被用户连点：用自增序号丢弃迟到的旧响应，
     否则先点的空歌单后到，会把刚选好的那张覆盖成 0 首。 */
  let openSeq = 0;
  let writing = false;

  const X_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const Q_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6"/><path d="M12 16.8v.1"/></svg>';
  const MISS_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/></svg>';
  const MAG_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></svg>';
  const BOX_SVG = '<svg viewBox="0 0 80 64" width="64" height="52" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 26 40 15l26 11-26 11z"/><path d="M14 26v22l26 11V37z"/><path d="M66 26v22L40 59V37z"/><path d="M14 26l26 11 26-11"/></svg>';
  const TRUCK_SVG = '<svg viewBox="0 0 120 80" width="120" height="80" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="26" width="58" height="30" rx="4"/><path d="M66 36h18l12 12v8H66z"/><path d="M70 40h12l8 8H70z"/><circle cx="30" cy="62" r="8"/><circle cx="88" cy="62" r="8"/><rect x="22" y="14" width="20" height="12" rx="2"/><path d="M22 20h20"/></svg>';
  const BOXES_SVG = '<svg viewBox="0 0 90 70" width="76" height="58" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="26" width="32" height="28" rx="3"/><path d="M10 34h32M26 26v8"/><rect x="46" y="34" width="26" height="22" rx="3"/><path d="M46 41h26M59 34v7"/><path d="M26 34v20"/></svg>';
  const ROAD_SVG = '<svg viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true"><path d="M18 58h964" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="18 16" vector-effect="non-scaling-stroke"/></svg>';
  const ARROW_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v14"/><path d="m6 12 6 6 6-6"/></svg>';
  const STATUS_ICON = { auto: CHECK_SVG, review: Q_SVG, miss: MISS_SVG };

  const FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'auto', label: '自动' },
    { id: 'review', label: '待确认' },
    { id: 'miss', label: '未找到' },
  ];

  const h = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  function setMsg(text) {
    if (els && els.msg) els.msg.textContent = text || '';
  }

  function setProgress(text) {
    if (els && els.progress) els.progress.textContent = text || '';
  }

  function visibleRows() {
    return (state?.rows || []).filter((r) => r.pick || r.status !== 'miss');
  }

  function sourceStatusText(src, st) {
    if (!st) {
      if (src.kind === 'account') return '点开查看';
      return src.kind === 'public' ? '公开歌单' : '本地曲库';
    }
    if (st.loggedIn) {
      if (src.id === 'kuwo') return '公开歌单';
      if (src.id === 'local') return st.hint || `${st.count || 0} 首`;
      return st.nickname || '已登录';
    }
    if (src.kind === 'local') return '未加载';
    if (src.kind === 'public') return '公开歌单';
    return st.failed ? '读取失败' : '未登录';
  }

  function updateSourceCards() {
    if (!els) return;
    for (const [id, b] of Object.entries(els.sourceCards)) {
      const on = !!state && state.source === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const src = SOURCE_MAP[id];
      const st = state && state.statusCache[id];
      const line = b.querySelector('.mig__src-status');
      if (line) line.textContent = sourceStatusText(src, st);
    }
  }

  function updateTargetCards() {
    if (!els) return;
    for (const [id, b] of Object.entries(els.targetCards)) {
      const on = !!state && state.target === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** 只更新筛选胶囊的数量与选中态；行是否显示由 applyFilter / paintRow 负责 */
  function updateFilterCounts() {
    if (!els) return;
    const rows = (state && state.rows) || [];
    const filter = (state && state.filter) || 'all';
    const counts = { all: rows.length, auto: 0, review: 0, miss: 0 };
    for (const r of rows) if (counts[r.status] != null) counts[r.status]++;
    for (const b of els.filters.children) {
      const f = b.dataset.filter;
      const num = b.querySelector('.mig__filter-n');
      if (num) num.textContent = String(counts[f] || 0);
      const on = filter === f;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
    }
  }

  function applyFilter() {
    if (!els) return;
    const filter = (state && state.filter) || 'all';
    for (const el of els.rows.children) {
      const status = el.dataset.status || 'miss';
      el.hidden = filter !== 'all' && status !== filter;
    }
  }

  function updateFilters() {
    updateFilterCounts();
    applyFilter();
  }

  function renderFilters() {
    if (!els) return;
    els.filters.innerHTML = '';
    for (const f of FILTERS) {
      const b = h('button', 'mig__filter');
      b.type = 'button';
      b.dataset.filter = f.id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `${esc(f.label)}<span class="mig__filter-n">0</span>`;
      b.addEventListener('click', () => {
        if (!state) return;
        state.filter = f.id;
        updateFilters();
      });
      els.filters.appendChild(b);
    }
    updateFilters();
  }

  function updateSummary() {
    if (!els || !state) return;
    if (!state.rows.length) { els.sum.textContent = ''; return; }
    const n = (s) => state.rows.filter((r) => r.status === s).length;
    els.sum.textContent = `自动 ${n('auto')} · 待确认 ${n('review')} · 未找到 ${n('miss')}`;
  }

  function moveTruck(pct) {
    if (!els || !els.road || !els.truck) return;
    const p = Math.max(0, Math.min(1, Number(pct) || 0));
    const max = Math.max(0, els.road.clientWidth - els.truck.offsetWidth - 150);
    els.truck.style.transform = `translateX(${Math.round(p * max)}px)`;
  }

  function resetTransfer() {
    if (!els) return;
    els.action.classList.remove('is-run', 'is-done', 'is-err');
    setProgress('选一张歌单，再点开始匹配');
    if (state) state.progressPct = 0;
    moveTruck(0);
  }

  function beginTransfer() {
    if (!els) return;
    els.action.classList.remove('is-done', 'is-err');
    els.action.classList.add('is-run');
  }

  function finishTransfer(text, err) {
    if (!els) return;
    els.action.classList.remove('is-run');
    els.action.classList.add('is-done');
    els.action.classList.toggle('is-err', !!err);
    setProgress(text);
    if (state) state.progressPct = 1;
    moveTruck(1);
  }

  function setBusyUI(on) {
    if (!els) return;
    els.sources.classList.toggle('is-locked', on);
    els.playlists.classList.toggle('is-locked', on);
    els.targets.classList.toggle('is-locked', on);
    for (const b of els.sources.children) b.disabled = on;
    for (const b of els.targets.children) b.disabled = on;
    for (const b of els.playlists.querySelectorAll('button')) b.disabled = on;
  }

  function clearResults() {
    if (!els || !state) return;
    state.rows = [];
    state.written = false;
    state.filter = 'all';
    els.rows.innerHTML = '';
    els.s4.hidden = true;
    els.sum.textContent = '';
    els.write.hidden = true;
    els.write.disabled = false;
    els.write.textContent = '建歌单并写入';
    els.csv.hidden = true;
    els.m3u.hidden = true;
    els.run.disabled = true;
    els.run.textContent = '开始匹配';
    resetTransfer();
    updateFilters();
  }

  function refreshActions() {
    if (!els || !state || state.busy) return;
    const t = TARGET_MAP[state.target] || {};
    const picks = state.rows.filter((r) => r.pick).length;
    els.write.hidden = !t.canWrite || !state.rows.length;
    els.write.disabled = !picks || !!state.written;
    els.csv.hidden = !state.rows.length;
    els.m3u.hidden = !state.rows.length;
  }

  function showPickerLoading(text, keepSearch) {
    if (!els) return;
    if (!keepSearch) {
      els.search.hidden = true;
      els.search.innerHTML = '';
    }
    els.pickerNote.hidden = true;
    els.playlists.innerHTML = '';
    const box = h('div', 'mig__empty');
    box.innerHTML = `<div class="mig__empty-art" aria-hidden="true">${BOX_SVG}</div>`;
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    els.playlists.appendChild(box);
  }

  function showPickerEmpty(text, retryFn, retryLabel) {
    if (!els) return;
    els.playlists.innerHTML = '';
    const box = h('div', 'mig__empty');
    box.innerHTML = `<div class="mig__empty-art" aria-hidden="true">${BOX_SVG}</div>`;
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    if (retryFn) {
      const b = h('button', 'mig__btn mig__btn--retry');
      b.type = 'button';
      b.textContent = retryLabel || '重新载入';
      b.addEventListener('click', retryFn);
      box.appendChild(b);
    }
    els.playlists.appendChild(box);
  }

  function retrySource() {
    if (!state) return;
    state.statusCache[state.source] = null;
    loadSource(state.source);
  }

  function renderKuwoSearch() {
    if (!els) return;
    els.search.innerHTML = `
      <label class="mig__search-box">
        ${MAG_SVG}
        <input id="mig-kuwo-q" type="search" aria-label="搜索酷我公开歌单" placeholder="搜公开歌单，比如「周杰伦」" autocomplete="off" value="${esc(state.kuwoQuery || '')}">
      </label>
      <button class="mig__search-go" id="mig-kuwo-go" type="button">搜索</button>`;
    const input = els.search.querySelector('#mig-kuwo-q');
    const go = els.search.querySelector('#mig-kuwo-go');
    const submit = () => doKuwoSearch(input.value.trim());
    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
  }

  function renderPicker() {
    if (!els || !state) return;
    const src = SOURCE_MAP[state.source];
    const list = state.playlists || [];

    els.search.hidden = state.source !== 'kuwo';
    els.pickerNote.hidden = state.source !== 'kuwo';
    if (state.source === 'kuwo') {
      renderKuwoSearch();
      els.pickerNote.textContent = state.kuwoQuery
        ? `搜索「${state.kuwoQuery}」· ${list.length} 张`
        : `推荐歌单 · ${list.length} 张`;
    } else {
      els.search.innerHTML = '';
    }

    if (state.source === 'local') {
      const st = state.statusCache.local;
      els.srcHint.textContent = `${src.name} · ${(st && st.count) || 0} 首`;
    } else if (state.source === 'kuwo') {
      els.srcHint.textContent = state.kuwoQuery
        ? `酷我 · 搜索「${state.kuwoQuery}」`
        : '酷我 · 公开歌单';
    } else {
      els.srcHint.textContent = `${src.name} · ${list.length} 张歌单`;
    }

    els.playlists.innerHTML = '';
    if (!list.length) {
      const isKuwo = state.source === 'kuwo';
      showPickerEmpty(
        isKuwo ? '没有搜到公开歌单，换个关键词试试。' : '没有找到歌单。',
        isKuwo ? () => doKuwoSearch(state.kuwoQuery) : retrySource,
        isKuwo ? '重新搜索' : '重新载入',
      );
      return;
    }

    for (const p of list) {
      const b = h('button', 'mig__pl');
      b.type = 'button';
      const on = !!(state.playlist && state.playlist.id === p.id);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const name = p.name || '未命名歌单';
      const cover = String(p.cover || '');
      const first = (name || '·').slice(0, 1);
      b.innerHTML = `
        <span class="mig__pl-cv">
          ${cover
            ? `<img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
            : `<i>${esc(first)}</i>`}
          <span class="mig__pl-check" aria-hidden="true">${CHECK_SVG}</span>
          ${Number(p.type) === 1 ? '<span class="mig__pl-tag">我喜欢</span>' : ''}
        </span>
        <b>${esc(name)}</b>
        <span class="mig__pl-n">${Number(p.count) || 0} 首</span>`;
      b.addEventListener('click', () => selectPlaylist(p, b));
      els.playlists.appendChild(b);
    }
  }

  async function doKuwoSearch(q) {
    if (!state || state.source !== 'kuwo') return;
    if (state.busy) { setMsg('传输中，等这一轮跑完再搜索'); return; }
    const my = state;
    const gen = openSeq;
    const seq = ++state.kuwoSeq;
    ++state.srcSeq;                 // 作废可能还在飞的「选歌单读曲目」
    state.kuwoQuery = String(q || '').trim();
    state.playlist = null;
    state.tracks = [];
    state.partial = false;
    state.rows = [];
    clearResults();
    const go = els.search.querySelector('#mig-kuwo-go');
    if (go) { go.disabled = true; go.textContent = '搜索中…'; }
    showPickerLoading('正在搜公开歌单…', true);
    try {
      const list = await SOURCE_MAP.kuwo.search(state.kuwoQuery);
      if (state !== my || openSeq !== gen || seq !== my.kuwoSeq || my.source !== 'kuwo') return;
      state.playlists = list;
      renderPicker();
      setMsg('');
    } catch (e) {
      if (state !== my || openSeq !== gen || seq !== my.kuwoSeq || my.source !== 'kuwo') return;
      renderPicker();
      showPickerEmpty(`搜索失败：${(e && e.message) || e}`, () => doKuwoSearch(state.kuwoQuery), '重试');
      setMsg('酷我搜索失败，可以再试一次');
    }
  }

  async function loadSource(id) {
    if (!state) return;
    const src = SOURCE_MAP[id];
    if (!src) return;
    const my = state;
    const gen = openSeq;
    const seq = ++state.srcSeq;
    ++state.kuwoSeq;                // 作废可能还在飞的酷我搜索
    const stale = () => state !== my || openSeq !== gen || seq !== my.srcSeq;

    state.source = id;
    state.playlist = null;
    state.tracks = [];
    state.partial = false;
    state.kuwoQuery = '';
    state.rows = [];
    clearResults();
    updateSourceCards();
    updateTargetCards();
    els.srcHint.textContent = src.name;
    showPickerLoading(`正在看「${src.name}」…`);

    try {
      let st = state.statusCache[id];
      if (!st || st.failed) {
        st = await src.status();
        if (stale()) return;
        state.statusCache[id] = st;
      }
      updateSourceCards();

      if (!st.loggedIn) {
        if (src.kind === 'account') {
          const text = st.failed
            ? `读不到「${src.name}」的登录状态。检查后端是否在运行，再试一次。`
            : `『${src.name}』还没登录。去侧栏设置 → 账号里登录，再回来。`;
          els.srcHint.textContent = `${src.name} · ${st.failed ? '读取失败' : '未登录'}`;
          showPickerEmpty(text, retrySource, '重新检查');
        } else {
          els.srcHint.textContent = `${src.name} · 不可用`;
          showPickerEmpty(st.error || '这个来源现在不可用。', retrySource, '重新载入');
        }
        return;
      }

      const list = await src.playlists(st);
      if (stale()) return;
      state.playlists = Array.isArray(list) ? list : [];
      renderPicker();
    } catch (e) {
      if (stale()) return;
      if (!state.statusCache[id]) {
        state.statusCache[id] = { loggedIn: false, failed: true, error: String((e && e.message) || e) };
        updateSourceCards();
      }
      els.srcHint.textContent = `${src.name} · 读取失败`;
      showPickerEmpty(`取歌单失败：${(e && e.message) || e}`, retrySource, '重新载入');
    }
  }

  /** 选完歌单后把 02「搬到哪儿」送到视口顶部：用户不用自己往下划。
      只滚弹窗自己的 .mig__scroll，不碰背后的页面。 */
  function goTargets() {
    const sec = els && els.targets && els.targets.closest('.mig__sec');
    const scroller = els && els.sheet && els.sheet.querySelector('.mig__scroll');
    if (!sec || !scroller) return;
    const top = sec.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const reduce = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      scroller.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    } catch {
      scroller.scrollTop = Math.max(0, top);
    }
  }

  async function selectPlaylist(p, btn) {
    if (!state || !p) return;
    if (state.busy) { setMsg('传输中，等这一轮跑完再换歌单'); return; }
    const my = state;
    const gen = openSeq;
    const seq = ++state.srcSeq;

    state.playlist = p;
    state.tracks = [];
    state.partial = false;
    state.rows = [];
    for (const b of els.playlists.querySelectorAll('.mig__pl')) {
      b.classList.toggle('is-on', b === btn);
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    }
    clearResults();
    setMsg('');
    setProgress('读曲目…');
    moveTruck(0);

    try {
      const res = await SOURCE_MAP[state.source].tracks(p);
      if (state !== my || openSeq !== gen || seq !== my.srcSeq) return;
      const tracks = (res && res.tracks) || [];
      state.tracks = tracks;
      state.partial = !!(res && res.partial);

      if (tracks.length) {
        setProgress(`已选《${p.name}》· ${tracks.length} 首`);
        els.run.disabled = false;
        if (state.partial) setMsg(`只读到前 ${tracks.length} 首，后面的没取到。`);
        else if (res && res.note) setMsg(res.note);
        goTargets();
      } else {
        const note = (res && res.note) || `《${p.name}》没有可读取的曲目`;
        setProgress(note);
        setMsg((res && res.note) || '这张歌单是空的，或者曲目接口没返回内容；换一张试试');
        els.run.disabled = true;
      }
    } catch (e) {
      if (state !== my || openSeq !== gen || seq !== my.srcSeq) return;
      state.tracks = [];
      setProgress(`读曲目失败：${(e && e.message) || e}`);
      setMsg('读取失败，可以再点一次这张歌单重试');
      els.run.disabled = true;
    }
  }

  function selectTarget(id) {
    if (!state) return;
    const t = TARGET_MAP[id];
    if (!t) return;
    if (state.busy) { setMsg('传输中，等这一轮跑完再换目标'); return; }
    const changed = state.target !== id;
    state.target = id;
    updateTargetCards();
    if (changed) {
      clearResults();
      if (state.playlist) {
        els.run.disabled = !state.tracks.length;
        setProgress(state.tracks.length
          ? `已选《${state.playlist.name}》· ${state.tracks.length} 首`
          : '这张歌单没有可搬运的曲目');
      }
    }
    setMsg(t.canWrite ? '' : `${t.name}只能导出清单，不能直接写入。`);
  }

  function paintRow(r) {
    let el = els.rows.querySelector(`[data-row="${r.key}"]`);
    if (!el) {
      el = h('div', 'mig__row');
      el.dataset.row = r.key;
      els.rows.appendChild(el);
    }
    const cls = r.status === 'auto' ? 'is-auto' : r.status === 'review' ? 'is-review' : 'is-miss';
    el.className = `mig__row ${cls}`;
    el.dataset.status = r.status;
    const pct = r.conf != null ? Math.round(r.conf * 100) : 0;
    const opts = (r.cands || []).map((c, i) =>
      `<option value="${i}" ${r.pick && r.pick.id === c.cand.id ? 'selected' : ''}>${(c.s.total * 100).toFixed(0)}% · ${esc(c.cand.name)}${c.cand.artists ? ' — ' + esc(c.cand.artists) : ''}</option>`
    ).join('');
    const statusText = r.status === 'auto' ? '自动' : r.status === 'review' ? '待确认' : '未找到';
    el.innerHTML = `
      <div class="mig__row-src"><b>${esc(r.src.name)}</b><span>${esc(r.src.artists || '未知歌手')}</span></div>
      <div class="mig__row-pick">
        ${r.cands && r.cands.length
          ? `<select class="mig__sel" aria-label="为 ${esc(r.src.name)} 选择匹配"><option value="-1" ${r.pick ? '' : 'selected'}>— 跳过这首 —</option>${opts}</select>`
          : '<span class="mig__nomatch">目标平台没搜到</span>'}
      </div>
      <span class="mig__pill mig__pill--${r.status}">${STATUS_ICON[r.status] || ''}${statusText}${r.conf != null ? ` ${pct}%` : ''}</span>`;
    const sel = el.querySelector('.mig__sel');
    if (sel) sel.addEventListener('change', () => {
      const v = Number(sel.value);
      r.pick = v < 0 ? null : r.cands[v].cand;
      r.status = r.pick ? 'review' : 'miss';
      paintRow(r);
      updateSummary();
      updateFilters();
      refreshActions();
    });
    el.hidden = !!state && state.filter !== 'all' && r.status !== state.filter;
  }

  async function runMatch() {
    if (!state || !state.playlist || state.busy) return;
    if (!state.tracks.length) {
      setMsg('这张歌单没有曲目，先换一张');
      els.run.disabled = true;
      return;
    }
    /* 目标在开跑时就固定下来：中途切换目标会让结果混到另一个平台，
       所以 selectTarget 在 busy 期间会拒绝切换，这里再捕获一次更稳。 */
    const target = state.target;
    /* 记下这一轮属于哪次面板会话：中途关掉再打开，旧请求还在飞，
       结果不能画进新面板（也不能把新面板的按钮解锁掉）。 */
    const runState = state;
    const gen = openSeq;
    state.busy = true;
    setBusyUI(true);
    els.run.disabled = true;
    els.run.textContent = '匹配中…';
    setMsg('');
    els.s4.hidden = false;
    els.rows.innerHTML = '';
    els.sum.textContent = '';
    els.write.hidden = true;
    els.write.disabled = false;
    els.csv.hidden = true;
    els.m3u.hidden = true;
    state.filter = 'all';
    state.progressPct = 0;
    renderFilters();
    beginTransfer();
    moveTruck(0);

    /* 用下标做行键：同一首歌在歌单里重复出现时，用歌曲 id 会把两行叠成一行 */
    const rows = state.tracks.map((t, i) => ({ src: t, key: i, cands: [], pick: null, status: 'miss' }));
    state.rows = rows;
    state.written = false;               // 重新匹配 = 允许再写一次
    const total = rows.length;
    let done = 0;
    let errors = 0;

    const render = () => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      state.progressPct = total ? done / total : 0;
      setProgress(`匹配中 ${done} / ${total} · ${pct}%`);
      moveTruck(state.progressPct);
    };
    render();

    const worker = async () => {
      for (;;) {
        if (state !== runState || openSeq !== gen) return;   // 面板已重开，别再往下画
        const i = rows.findIndex((r) => !r.done);
        if (i < 0) return;
        const r = rows[i];
        r.done = true;
        try {
          /* 先用「歌名 + 主歌手」搜；有些平台对这个组合会返回 0 条（实测 QQ），
             这时退回只用歌名再搜一次 —— 宁可多搜一次，也别把能匹配的丢成未找到。 */
          const q = `${r.src.name} ${mainArtist(r.src.artists)}`.trim();
          let cands = await searchTarget(target, q, 8);
          /* 还搜不到就用「去掉括号版本信息」的歌名再试 —— QQ 对 "想你就写信 (Live)"
             这种带括号的词直接回 0 条，换成 "想你就写信" 才有结果（实测）。 */
          if (!cands.length) cands = await searchTarget(target, normTitle(r.src.name) || r.src.name, 8);
          const top = best(r.src, cands);
          r.cands = top;
          const b = top[0];
          if (b && BAND(b.s.total) !== 'miss') {
            r.pick = b.cand;
            r.status = BAND(b.s.total);
            r.conf = b.s.total;
          } else {
            r.pick = null;
            r.status = 'miss';
            r.conf = b ? b.s.total : 0;
          }
        } catch (e) {
          /* 单首出错只影响这一行，不能让整轮停住 */
          r.status = 'miss';
          r.error = String(e.message || e);
          errors++;
        }
        if (state !== runState || openSeq !== gen) return;   // 迟到结果直接丢弃
        done++;
        render();
        paintRow(r);
        updateFilterCounts();
      }
    };

    try {
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      /* 无论怎样都要解锁，否则一次异常就让按钮永远灰着；
         但如果面板已经重开，这轮归新会话管，别动新 UI。 */
      if (state === runState && openSeq === gen) {
        state.busy = false;
        setBusyUI(false);
        els.run.disabled = !state.tracks.length;
        els.run.textContent = '重新匹配';
      }
    }
    if (state !== runState || openSeq !== gen) return;

    updateSummary();
    updateFilters();
    const auto = rows.filter((r) => r.status === 'auto').length;
    const review = rows.filter((r) => r.status === 'review').length;
    const miss = rows.filter((r) => r.status === 'miss').length;
    const summary = `自动 ${auto} · 待确认 ${review} · 未找到 ${miss}`;
    const writes = !!(TARGET_MAP[target] && TARGET_MAP[target].canWrite);
    const picks = rows.filter((r) => r.pick).length;

    els.sum.textContent = summary + (errors ? ` · 出错 ${errors}` : '');
    /* 可写按钮只在「目标可写 + 这一轮已跑完」出现；没选中任何曲目时保留但置灰 */
    els.write.hidden = !writes;
    els.write.disabled = !picks;
    els.write.textContent = '建歌单并写入';
    els.csv.hidden = false;
    els.m3u.hidden = false;
    els.run.textContent = '重新匹配';

    if (errors === total) {
      setMsg('所有曲目都搜索失败，检查网络或目标平台是否可用');
      finishTransfer(`全部 ${total} 首搜索失败`, true);
    } else {
      if (!picks) setMsg('没有选中任何曲目；可以在下表里手动选，或直接导出清单');
      finishTransfer(`匹配完成 · ${summary}`, errors > 0);
    }
  }

  async function doWrite() {
    if (!state || !state.playlist || state.busy) return;
    if (writing) { setMsg('上一轮写入还没结束，稍等'); return; }
    const target = TARGET_MAP[state.target];
    if (!target || !target.canWrite) {
      setMsg('这个平台没有写入通道，请改用导出');
      return;
    }
    const picks = state.rows.filter((r) => r.pick).map((r) => r.pick);
    if (!picks.length) {
      setMsg('没有可写入的曲目');
      els.write.disabled = true;
      return;
    }

    const writeState = state;
    const gen = openSeq;
    writing = true;
    state.busy = true;
    let success = false;
    setBusyUI(true);
    els.write.disabled = true;
    els.write.textContent = '写入中…';
    els.run.disabled = true;
    setMsg('写入中…');
    beginTransfer();
    state.progressPct = 1;
    setProgress(`写入中 · ${picks.length} 首`);
    moveTruck(1);
    try {
      setMsg(`在 ${target.name} 建歌单…`);
      const name = `${state.playlist.name}（来自搬运）`;
      const c = await createPlaylist(target.id, name);
      if (state !== writeState || openSeq !== gen) return;  // 面板已重开，丢弃这次结果
      const pid = c && (c.playlist?.id || c.id || c.body?.playlist?.id || c.listid);
      if (!pid) {
        const reason = (c && (c.error || c.message || c.msg)) || (c && c.raw ? '接口返回异常' : '未知原因');
        setMsg(`${target.name} 建歌单失败：${reason}`);
        finishTransfer(`${target.name} 建歌单失败：${reason}`, true);
        return;
      }
      /* QQ 会把超过 20 字的歌单名截断，成功文案用服务端回读的名字，
         没回读就用本地名字（网易云/酷狗原样）。 */
      const writtenName = (c && (c.playlist?.name || c.name)) || name;

      setMsg(`写入 ${target.name} ${picks.length} 首…`);
      const r = await addTracks(target.id, pid, picks);
      if (state !== writeState || openSeq !== gen) return;  // 同上
      const ok = !!r && (Number(r.code) === 200 || Number(r.status) === 200);
      if (ok) {
        success = true;
        state.written = true;
        setMsg(`完成：${target.name}《${writtenName}》${picks.length} 首`);
        finishTransfer(`写入完成 · ${picks.length} 首`, false);
      } else {
        const reason = (r && (r.error || r.message || r.msg)) || (r && r.raw ? '接口返回异常' : '未知原因');
        setMsg(`${target.name} 写入失败：${reason}`);
        finishTransfer(`${target.name} 写入失败：${reason}`, true);
      }
    } catch (e) {
      if (state !== writeState || openSeq !== gen) return;  // 面板已重开，旧错误不画
      /* 网络异常也必须收束成完成卡 —— 不能把「写入中…」留在界面上 */
      const reason = (e && e.message) || e;
      setMsg(`${target.name} 写入失败：${reason}`);
      finishTransfer(`${target.name} 写入中断：${reason}`, true);
    } finally {
      writing = false;
      if (state === writeState && openSeq === gen) {
        state.busy = false;
        setBusyUI(false);
        els.run.disabled = !state.tracks.length;
        els.write.textContent = '建歌单并写入';
        // 成功后再点一次会建出重复歌单，所以成功后保持置灰；重新匹配会解锁
        els.write.disabled = success || !state.rows.some((r) => r.pick);
      }
    }
  }

  async function open() {
    if (!root) build();
    const seq = ++openSeq;
    root.hidden = false;
    state = {
      source: 'netease',
      statusCache: {},
      playlists: [],
      playlist: null,
      tracks: [],
      partial: false,
      rows: [],
      target: 'netease',
      busy: false,
      written: false,
      filter: 'all',
      srcSeq: 0,
      kuwoSeq: 0,
      kuwoQuery: '',
      progressPct: 0,
    };

    setBusyUI(false);
    els.rows.innerHTML = '';
    els.sum.textContent = '';
    els.s4.hidden = true;
    els.write.hidden = true;
    els.write.disabled = false;
    els.write.textContent = '建歌单并写入';
    els.csv.hidden = true;
    els.m3u.hidden = true;
    els.run.disabled = true;
    els.run.textContent = '开始匹配';
    els.srcHint.textContent = '';
    setMsg('');
    updateSourceCards();
    updateTargetCards();
    renderFilters();
    resetTransfer();
    showPickerLoading('正在载入网易云歌单…');

    await loadSource('netease');
    if (openSeq !== seq) return;
  }

  function close() {
    openSeq++;
    if (root) root.hidden = true;
  }

  function build() {
    root = h('div', 'mig');
    root.id = 'mig';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'mig-title');
    root.innerHTML = `
      <div class="mig__sheet">
        <header class="mig__head">
          <div class="mig__head-tx">
            <h2 class="mig__title" id="mig-title">歌单搬运</h2>
            <p class="mig__sub">选一张歌单，挑个平台，小货车替你搬过去。</p>
          </div>
          <div class="mig__head-art" aria-hidden="true">${TRUCK_SVG}</div>
          <button class="mig__x" id="mig-x" type="button" aria-label="关闭">${X_SVG}</button>
        </header>

        <div class="mig__scroll">
          <section class="mig__sec" aria-labelledby="mig-h1">
            <div class="mig__sec-h">
              <span class="mig__num">01</span>
              <h3 class="mig__sec-t" id="mig-h1">从哪儿搬</h3>
              <span class="mig__hint" id="mig-src-hint"></span>
            </div>
            <div class="mig__pick">
              <div class="mig__pick-left">
                <div class="mig__sources" id="mig-sources"></div>
              </div>
              <div class="mig__picker">
                <div class="mig__search" id="mig-search" hidden></div>
                <p class="mig__picker-note" id="mig-picker-note" hidden></p>
                <div class="mig__plgrid" id="mig-playlists"></div>
              </div>
            </div>
          </section>

          <div class="mig__flow" aria-hidden="true">${ARROW_SVG}</div>

          <section class="mig__sec" aria-labelledby="mig-h2">
            <div class="mig__sec-h">
              <span class="mig__num">02</span>
              <h3 class="mig__sec-t" id="mig-h2">搬到哪儿</h3>
            </div>
            <div class="mig__targets" id="mig-targets"></div>
          </section>

          <section class="mig__sec" aria-labelledby="mig-h3">
            <div class="mig__sec-h">
              <span class="mig__num">03</span>
              <h3 class="mig__sec-t" id="mig-h3">开始搬</h3>
            </div>
            <div class="mig__action" id="mig-action">
              <div class="mig__road" id="mig-road" aria-hidden="true">${ROAD_SVG}</div>
              <div class="mig__truck" id="mig-truck" aria-hidden="true">${TRUCK_SVG}</div>
              <div class="mig__boxes" aria-hidden="true">${BOXES_SVG}</div>
              <p class="mig__progress" id="mig-progress">选一张歌单，再点开始匹配</p>
            </div>
          </section>

          <section class="mig__sec" id="mig-s4" hidden aria-labelledby="mig-h4">
            <div class="mig__sec-h">
              <span class="mig__num">04</span>
              <h3 class="mig__sec-t" id="mig-h4">核对</h3>
              <span class="mig__hint" id="mig-sum"></span>
            </div>
            <div class="mig__filters" id="mig-filters"></div>
            <div class="mig__rows" id="mig-rows"></div>
          </section>
        </div>

        <footer class="mig__foot">
          <div class="mig__foot-btns">
            <button class="mig__btn mig__btn--primary" id="mig-run" type="button">开始匹配</button>
            <button class="mig__btn mig__btn--primary" id="mig-write" type="button" hidden>建歌单并写入</button>
            <button class="mig__btn" id="mig-csv" type="button" hidden>导出 CSV</button>
            <button class="mig__btn" id="mig-m3u" type="button" hidden>导出 M3U8</button>
          </div>
          <span class="mig__msg" id="mig-msg" role="status"></span>
        </footer>
      </div>`;
    document.body.appendChild(root);

    els = {
      sheet: root.querySelector('.mig__sheet'),
      sources: root.querySelector('#mig-sources'),
      srcHint: root.querySelector('#mig-src-hint'),
      search: root.querySelector('#mig-search'),
      pickerNote: root.querySelector('#mig-picker-note'),
      playlists: root.querySelector('#mig-playlists'),
      targets: root.querySelector('#mig-targets'),
      action: root.querySelector('#mig-action'),
      road: root.querySelector('#mig-road'),
      truck: root.querySelector('#mig-truck'),
      progress: root.querySelector('#mig-progress'),
      filters: root.querySelector('#mig-filters'),
      rows: root.querySelector('#mig-rows'),
      sum: root.querySelector('#mig-sum'),
      run: root.querySelector('#mig-run'),
      write: root.querySelector('#mig-write'),
      csv: root.querySelector('#mig-csv'),
      m3u: root.querySelector('#mig-m3u'),
      msg: root.querySelector('#mig-msg'),
      s4: root.querySelector('#mig-s4'),
      sourceCards: {},
      targetCards: {},
    };

    /* 来源：7 张大卡 */
    for (const src of SOURCES) {
      const b = h('button', 'mig__src');
      b.type = 'button';
      b.dataset.src = src.id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `
        <span class="mig__src-check" aria-hidden="true">${CHECK_SVG}</span>
        <img class="mig__src-logo" src="${esc(src.logo)}" alt="" loading="lazy">
        <b>${esc(src.name)}</b>
        <span class="mig__src-status">${esc(sourceStatusText(src, null))}</span>`;
      b.addEventListener('click', () => {
        if (!state) return;
        if (state.busy) { setMsg('传输中，等这一轮跑完再换来源'); return; }
        if (state.source === src.id) return;
        loadSource(src.id);
      });
      els.sourceCards[src.id] = b;
      els.sources.appendChild(b);
    }

    /* 目标：5 张大卡 */
    for (const t of TARGETS) {
      const b = h('button', 'mig__tcard');
      b.type = 'button';
      b.dataset.target = t.id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `
        <span class="mig__tcard-check" aria-hidden="true">${CHECK_SVG}</span>
        <img class="mig__tcard-logo" src="${esc(LOGO(t.id))}" alt="" loading="lazy">
        <b>${esc(t.name)}</b>
        <span class="mig__badge ${t.canWrite ? 'mig__badge--write' : 'mig__badge--export'}">${t.canWrite ? '直接写入' : '导出清单'}</span>
        <span class="mig__tcard-d">${t.canWrite ? '建一张新歌单' : '生成 CSV / M3U8 清单'}</span>`;
      b.addEventListener('click', () => selectTarget(t.id));
      els.targetCards[t.id] = b;
      els.targets.appendChild(b);
    }

    renderFilters();

    root.querySelector('#mig-x').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.hidden) close();
    });

    /* 异步流程自己都 catch 了；这里再兜一层，保证任何漏网异常都能落成可见文案，
       而不是让按钮点了没反应（控制台里一个 unhandled rejection）。 */
    const guarded = (fn) => () => {
      Promise.resolve()
        .then(fn)
        .catch((e) => setMsg(`操作失败：${(e && e.message) || e}`));
    };
    els.run.addEventListener('click', guarded(runMatch));
    els.write.addEventListener('click', guarded(doWrite));
    /* 导出按钮可能在面板重开、state 还没建好时被点到：先判空再取名字，
       否则 TypeError 会直接冒到控制台（用户只看到没反应）。 */
    els.csv.addEventListener('click', () => {
      if (!state || !state.playlist) { setMsg('先选一张歌单'); return; }
      const rows = visibleRows();
      if (!rows.length) { setMsg('还没有可导出的结果，先跑一次匹配'); return; }
      download(`歌单迁移-${state.playlist.name}.csv`, toCSV(rows));
    });
    els.m3u.addEventListener('click', () => {
      if (!state || !state.playlist) { setMsg('先选一张歌单'); return; }
      const rows = visibleRows();
      if (!rows.length) { setMsg('还没有可导出的结果，先跑一次匹配'); return; }
      download(`歌单迁移-${state.playlist.name}.m3u8`, toM3U(rows, state.playlist.name), 'audio/x-mpegurl');
    });

    window.addEventListener('resize', () => {
      if (state) moveTruck(state.progressPct || 0);
    });
  }

  return { open, close, _match: { normTitle, mainArtist, dice, score, best, BAND }, _export: { toCSV, toM3U } };
})();

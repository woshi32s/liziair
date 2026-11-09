/**
 * 大厅「我的」卡 · 多平台账号注册表
 * ==========================================================================
 * 一个平台一条，**只在这里加**，app.js 那边不用动（卡片渲染不认平台，只认 model）。
 * 卡片的轮播、左右箭头、记忆上次平台都由大厅按这个数组自动算。
 *
 * 一条的形状：
 *   {
 *     id:     'netease',        // 唯一 id，同时写进 localStorage['lizi.hall.me.platform']（记 id，不记索引）
 *     name:   '网易云',          // 昵称旁边那枚平台标记的文字
 *     accent: '#c20c0c',        // 平台标记色（文字 + 1px 边框；不贴图标）
 *
 *     // ① 登录态：只回答「谁登录了」。每家的 check 自己带 8s 超时 + catch，
 *     //    任何一家失败/超时只把自己摘掉，绝不影响别家、也不抛到大厅。
 *     //    返回 { loggedIn:false } 或 { loggedIn:true, key, nickname, avatar, vip }
 *     async check() {},
 *
 *     // ② 详情：把平台自己的接口**归一化**成卡片模型（页面只认这个形状）
 *     //    {
 *     //      nickname, avatar, banner,
 *     //      level, vip,
 *     //      stats: [{ n: 813, label: '歌单' }, ...],
 *     //      sign: '个性签名',
 *     //      meta: ['2019 年加入', '认证名']      // 小字，可空
 *     //    }
 *     //    返回 null = 登录态已失效（401/未登录）→ 大厅按 check 的字段兜一张
 *     //
 *     //    背景图多两个字段（大厅据此决定画什么，见 app.js 的 meApplyBanner）：
 *     //      bannerKind:     'netease' 有自己的自定义背景 | 'default' 是公用默认图或没有
 *     //      bannerFallback: 'gradient' —— 没有可用背景时大厅画头像取色的动态渐变
 *     //    网易云**没把「动态视频背景」暴露给 web 接口**（user_detail / user_detail_new 都只有
 *     //    profile.background，拿不到那段 mp4），所以视频只能由用户自己在设置里贴地址。
 *     async detail(key) {},
 *   }
 *
 * 六个边车（QQ/酷狗/汽水/波点/Spotify/酷我）的 /status 都是 { code, loggedIn, nickname, avatar, uid… }，
 * 所以共用 simple() 一套；网易云走 weapi 转发，字段更全（banner/等级/统计/签名），单独一条。
 *
 * 下一个接平台的人：照 simple() 加一条，或者在数组里写一条完整对象。
 * detail 里 stats/meta 没数据就留空数组，**别编数字**。
 */
(function () {
  'use strict';

  const STATUS_TIMEOUT = 8000;              // 边车冷启动可能 1~3s（最坏 25s 就绪超时），8s 足够

  /** 统一取 JSON：带 AbortSignal 超时，非 2xx 抛错（由各 check 自己 catch） */
  async function getJson(path) {
    const res = await fetch(path, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* ==========================================================================
   * 「这是不是网易云的公用默认背景？」
   * --------------------------------------------------------------------------
   * 没设置过主页背景的账号，网易云会给一张**公用图**（实测三个互不相干的账号同图），
   * 直接拿来当大厅卡片的横幅，用户看到的就是「别人的星空」，不是自己的主页。
   * 判定只看 URL 末尾的 `<hash>/<imgId>.jpg`：hash 命中，或图片 id 命中，就算默认。
   *
   * 采样记录（2026-10，本机 GET /api/user/detail?uid=…，逐条核过）：
   *   2zSNIqTcpHL2jIvU6hG0EA== / 109951162868128395.jpg  ← 默认（深色星空）
   *       8498237749「King-8I4」、470487020「代表月亮消灭你哟」、1658987224「成功靳」
   *       三个账号**一模一样** → 公用默认图。
   *   _f8R60U9mZ42sSNvdPn2sQ== / 109951162868126486.jpg  ← 默认（另一张，同批素材，**推断**）
   *       3271481561「用户3271481561」命中：默认昵称、明显没动过主页；图片 id 与上面那张相邻
   *       （…126486 / …128395），所以按「同一批默认素材」处理。只有一个样本，宁可少画一张图。
   * 对照（**不**算默认，都是账号自己的图，全网只出现一次）：
   *   1「网易云音乐」cwi82gitJJ0DfMO4cXbP8A== / 109951166515550955
   *   32953014「binaryify」WLTBvNL_l9ZKlslFwaCM9Q== / 109951163792144631
   *   48353「网易CEO丁磊」ifqMyD-v2RfJ9HiXGJeVJg== / 2812550743861251
   *   99324533「72795」5L9yqWa_UnlHtlp7li5PAg== / 2002210674180204
   *   131892707「ddpp_24」MR7qprvjxApmKZe4NRmlQA== / 109951164523404030
   *
   * 以后发现新的公用图：往 DEFAULT_BG 里加一行 { hash, id } 就行（hash 里的 `==` 照抄）。
   * ========================================================================== */
  const DEFAULT_BG = [
    { hash: '2zSNIqTcpHL2jIvU6hG0EA==', id: '109951162868128395', note: '星空（3 个账号同图）' },
    { hash: '_f8R60U9mZ42sSNvdPn2sQ==', id: '109951162868126486', note: '另一张默认（同批素材）' },
  ];
  const DEFAULT_HASH = new Set(DEFAULT_BG.map((x) => x.hash));
  const DEFAULT_ID = new Set(DEFAULT_BG.map((x) => x.id));

  /** 从 backgroundUrl 拆出 { hash, id }：http://p1.music.126.net/<hash>/<id>.jpg */
  function bgParts(url) {
    const m = /([^/]+?)\/(\d+)\.(?:jpe?g|png|webp)(?:[?#]|$)/i.exec(String(url || ''));
    return m ? { hash: m[1], id: m[2] } : { hash: '', id: '' };
  }

  /** 命中默认图 = 当作「没有背景」。空值不算默认（由调用方自己判空）。 */
  function isDefaultBg(url) {
    const p = bgParts(url);
    return !!(p.hash && (DEFAULT_HASH.has(p.hash) || DEFAULT_ID.has(p.id)));
  }

  /* 各边车字段名不完全一样：uid / userId / uin；昵称头像有的还会套一层 profile */
  function normStatus(s) {
    const p = (s && s.profile) || {};
    return {
      nickname: s.nickname || p.nickname || '',
      avatar: s.avatar || p.avatar || '',
      uid: s.uid || s.userId || s.uin || p.userId || s.id || '',
      vip: !!(s.vip || p.vipType),
    };
  }

  /**
   * 边车型账号：check/detail 都从同一个 /status 来，detail 复用 check 刚拿到的响应，
   * 不重复打请求；没有横幅/等级/统计就留空，页面会优雅退化成「昵称 + 平台标记」。
   */
  function simple(cfg) {
    let last = null;
    const load = async () => {
      const s = await getJson('/api/' + cfg.src + '/status');
      last = s;
      return s;
    };
    return {
      id: cfg.id,
      name: cfg.name,
      accent: cfg.accent,
      async check() {
        let s;
        try { s = await load(); } catch { return { loggedIn: false }; }
        if (!s || !s.loggedIn) return { loggedIn: false };
        /* Spotify 没配 client_id / 读 /me 失败时带 error：视为「未配置」，不进轮播 */
        if (cfg.rejectError && s.error) return { loggedIn: false };
        const n = normStatus(s);
        return {
          loggedIn: true,
          key: String(n.uid || n.nickname || cfg.id),
          nickname: n.nickname,
          avatar: n.avatar,
          vip: n.vip,
        };
      },
      async detail() {
        let s = last;
        if (!s) {
          try { s = await load(); } catch { return null; }
        }
        if (!s || !s.loggedIn) return null;
        if (cfg.rejectError && s.error) return null;
        const n = normStatus(s);
        return {
          nickname: n.nickname || cfg.name + ' 用户',
          avatar: n.avatar,
          banner: '',                        // 边车没给背景图：不编
          bannerKind: 'default',             // 没有背景 → 大厅画默认渐变
          bannerFallback: 'gradient',
          level: 0,
          vip: n.vip,
          stats: [],                         // 没统计数字：不编
          sign: '',
          meta: [
            n.uid ? (cfg.uidLabel || 'UID') + ' ' + n.uid : '',
            s.product ? 'Spotify ' + s.product : '',
          ].filter(Boolean),
        };
      },
    };
  }

  const ACCOUNTS = [
    /* ---------------- 网易云（server.mjs 的 weapi 转发，信息最全） ---------------- */
    {
      id: 'netease',
      name: '网易云',
      accent: '#c20c0c',
      async check() {
        let s;
        try { s = await getJson('/api/session'); } catch { return { loggedIn: false }; }
        if (!s || !s.loggedIn || !s.profile) return { loggedIn: false };
        const p = s.profile;
        return {
          loggedIn: true,
          key: String(p.userId || ''),
          nickname: p.nickname || '',
          avatar: p.avatar || '',
          vip: !!p.vipType,
        };
      },
      async detail(key) {
        /* 401/网络错都往外抛，大厅那边决定是摘牌还是用登录态兜一张 */
        const d = await getJson('/api/user/detail?uid=' + encodeURIComponent(key));
        if (!d || !d.profile || !d.profile.userId) return null;
        const p = d.profile;
        /* weapi 给的是 profile.background；eapi 的 detail 新接口叫 backgroundUrl —— 两个都认 */
        const rawBg = p.background || p.backgroundUrl || '';
        const def = isDefaultBg(rawBg);        // 公用星空图 → 不能当用户自己的背景
        return {
          nickname: p.nickname || '',
          avatar: p.avatar || '',
          banner: def ? '' : rawBg,
          bannerKind: rawBg && !def ? 'netease' : 'default',
          bannerFallback: 'gradient',
          bannerHash: bgParts(rawBg).hash,     // 验收/排查用，渲染不读它
          level: d.level || 0,
          vip: !!p.vipType,
          stats: [
            { n: p.playlistCount, label: '歌单' },
            { n: p.follows, label: '关注' },
            { n: p.followeds, label: '粉丝' },
            { n: d.listenSongs, label: '听歌' },
          ],
          sign: (p.signature || '').trim(),
          meta: [
            p.createTime > 0 ? new Date(p.createTime).getFullYear() + ' 年加入' : '',
            p.auth && p.auth.length ? p.auth[0] : '',
          ].filter(Boolean),
        };
      },
    },

    /* ---------------- 五个边车（/status 一套形状） ---------------- */
    simple({ id: 'qq', name: 'QQ 音乐', accent: '#31c27c', src: 'qq', uidLabel: 'UIN' }),
    simple({ id: 'kugou', name: '酷狗', accent: '#2ca2f9', src: 'kugou' }),
    simple({ id: 'qishui', name: '汽水', accent: '#111111', src: 'qishui', uidLabel: '用户 ID' }),
    simple({ id: 'bodian', name: '波点', accent: '#7b61ff', src: 'bodian' }),
    /* 酷我 / Spotify 已从产品里去掉（2026-11-09 用户要求，桌面和安卓都不再露出）：
       一个只有粘贴 Cookie 的登录方式，一个要 OAuth 回调，两边都不适合这个版本。
       边车服务还在，只是大厅和设置页不再挂它们的行。 */
  ];

  /* 大厅读这个；验收脚本也直接改这里的 check/detail 造假数据（不改产品代码） */
  window.LIZI_ACCOUNTS = ACCOUNTS;
})();

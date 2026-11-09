/* ==========================================================================
   LIZI · 歌单搬运（跨平台迁移）
   --------------------------------------------------------------------------
   做什么：把 A 平台的「我的歌单」搬到 B 平台。逐首在目标平台搜索 →
   按「歌名 + 歌手 + 时长」打分 → 三档（自动 / 待确认 / 未找到）→ 人工确认 →
   能写的平台直接建歌单写进去，不能写的导出 CSV / M3U8 / JSON。

   为什么这么设计（调研结论）：
     GitHub 上跨平台搬运成熟的全在 Spotify ↔ YouTube Music（SpotTransfer ★1054、
     Spotify2YoutubeMusic ★394、PlaySync ★28），算法都是「读源 → 目标逐首搜 →
     打分匹配 → 批量写入 + 未匹配清单」。国内平台之间没有成品，只有导出 CSV 的小工具。
     我们照这套做，但多做了「人工确认」这一档 —— 同名不同版本（Live / 翻唱 / Remaster）
     太多，全自动必然搬错。

   能力边界（真实测过）：
     搜索：网易云 / QQ / 酷狗 / 汽水 / 波点 —— 五家都能搜
     写入：网易云 / QQ 音乐 / 酷狗（都要登录；QQ 歌单名上游限 20 字）
     汽水 / 波点没有写入通道，落地方式自动降级成「导出清单」。

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

  /* ---------------- 网络 ---------------- */
  const J = async (url, opt) => {
    const r = await fetch(url, opt);
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { raw: t.slice(0, 200) }; }
  };

  async function session() { return J('/api/session'); }

  async function myPlaylists(uid) {
    const d = await J(`/api/netease/user/playlist?uid=${encodeURIComponent(uid)}`);
    /* 边车把列表放在 playlist；我们自己的 normalize 放在 playlists。
       两种都认，另外接口报错时**必须抛出去** —— 以前直接当空数组，
       界面会显示「这个账号名下没有歌单」，把真正的失败藏掉了。 */
    const arr = (d && (d.playlist || d.playlists || d.data?.playlist || d.data?.playlists)) || [];
    if (!arr.length && d && (d.error || d.raw || (d.code != null && Number(d.code) !== 200))) {
      throw new Error(d.error || d.msg || d.message || (d.raw ? '歌单列表接口返回异常' : `接口错误 ${d.code}`));
    }
    return arr.filter((p) => p && p.id).map((p) => ({
      id: p.id,
      name: p.name,
      count: p.trackCount ?? (p.tracks && p.tracks.length) ?? 0,
      cover: p.coverImgUrl || p.cover || '',
    }));
  }

  async function playlistTracks(pid) {
    const d = await J(`/api/netease/playlist/track/all?id=${encodeURIComponent(pid)}&limit=500`);
    /* 边车 /playlist/track/all 回 songs；server.mjs 的 normalize 回 tracks。
       两种形状都接，否则「选中歌单永远是 0 首」—— 链路就断在这一步。 */
    const arr = (d && (d.songs || d.tracks || d.playlist?.tracks || d.data)) || [];
    if (!Array.isArray(arr)) {
      throw new Error((d && (d.error || d.msg || d.message)) || '曲目接口返回异常');
    }
    if (!arr.length && d && (d.error || d.raw || (d.code != null && Number(d.code) !== 200))) {
      throw new Error(d.error || d.msg || d.message || (d.raw ? '曲目接口返回异常' : `接口错误 ${d.code}`));
    }
    return arr.map((t) => ({
      id: t.id,
      name: t.name,
      artists: typeof t.artists === 'string' ? t.artists
        : (t.ar || t.artists || []).map((a) => a.name).join(' / '),
      album: (t.al && t.al.name) || t.album?.name || t.album || '',
      duration: t.dt || t.duration || 0,
    })).filter((t) => t.name);
  }

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

  /* ---------------- UI ---------------- */
  let root, els, state = null;
  /* 打开面板 / 选歌单都可能被用户连点：用自增序号丢弃迟到的旧响应，
     否则先点的空歌单后到，会把刚选好的那张覆盖成 0 首。 */
  let openSeq = 0;
  let srcSeq = 0;
  let writing = false;

  const REDUCED = (() => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  })();

  const h = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  const X_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function build() {
    root = h('div', 'mig');
    root.id = 'mig';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="mig__sheet">
        <header class="mig__head">
          <div>
            <h2 class="mig__t">歌单搬运</h2>
            <p class="mig__sub">左边选一张歌单，右边选一个平台，然后开始搬运。搬不动就给你一份清单。</p>
          </div>
          <button class="mig__x" id="mig-x" aria-label="关闭">${X_SVG}</button>
        </header>

        <div class="mig__scroll">
          <div class="mig__board">
            <aside class="mig__col mig__col--src">
              <div class="mig__col-h">
                <span class="mig__k">01</span><b>来源</b>
                <span class="mig__hint" id="mig-src-hint"></span>
              </div>
              <div class="mig__plat">
                <span class="mig__plat-mark" aria-hidden="true">网</span>
                <span class="mig__plat-tx"><b>网易云音乐</b><i>读取「我的歌单」</i></span>
                <span class="mig__plat-tag">来源</span>
              </div>
              <div class="mig__list" id="mig-playlists"><p class="mig__empty">载入中…</p></div>
            </aside>

            <section class="mig__track" id="mig-track" aria-label="传输轨道">
              <div class="mig__track-h">
                <span class="mig__k">02</span><b>传输</b>
              </div>
              <div class="mig__lane" id="mig-lane" aria-hidden="true">
                <div class="mig__rail"><div class="mig__rail-fill" id="mig-fill"></div></div>
              </div>
              <p class="mig__note" id="mig-progress"></p>
              <div class="mig__done" id="mig-done" hidden>
                <span class="mig__done-k">完成</span>
                <span class="mig__done-t" id="mig-done-t"></span>
              </div>
            </section>

            <aside class="mig__col mig__col--dst">
              <div class="mig__col-h">
                <span class="mig__k">03</span><b>搬到</b>
              </div>
              <div class="mig__targets" id="mig-targets"></div>
            </aside>
          </div>

          <section class="mig__step" id="mig-s3" hidden>
            <div class="mig__row-h"><span class="mig__k">04</span><b>核对</b>
              <span class="mig__hint" id="mig-sum"></span>
            </div>
            <div class="mig__table" id="mig-rows"></div>
          </section>
        </div>

        <footer class="mig__foot">
          <button class="mig__btn" id="mig-run">开始匹配</button>
          <button class="mig__btn mig__btn--ghost" id="mig-write" hidden>建歌单并写入</button>
          <button class="mig__btn mig__btn--ghost" id="mig-csv" hidden>导出 CSV</button>
          <button class="mig__btn mig__btn--ghost" id="mig-m3u" hidden>导出 M3U8</button>
          <span class="mig__msg" id="mig-msg"></span>
        </footer>
      </div>`;
    document.body.appendChild(root);

    els = {
      sheet: root.querySelector('.mig__sheet'),
      playlists: root.querySelector('#mig-playlists'),
      srcHint: root.querySelector('#mig-src-hint'),
      targets: root.querySelector('#mig-targets'),
      fill: root.querySelector('#mig-fill'),
      progress: root.querySelector('#mig-progress'),
      rows: root.querySelector('#mig-rows'),
      sum: root.querySelector('#mig-sum'),
      run: root.querySelector('#mig-run'),
      write: root.querySelector('#mig-write'),
      csv: root.querySelector('#mig-csv'),
      m3u: root.querySelector('#mig-m3u'),
      msg: root.querySelector('#mig-msg'),
      s3: root.querySelector('#mig-s3'),
      track: root.querySelector('#mig-track'),
      lane: root.querySelector('#mig-lane'),
      done: root.querySelector('#mig-done'),
      doneT: root.querySelector('#mig-done-t'),
    };

    root.querySelector('#mig-x').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    /* 异步流程自己都 catch 了；这里再兜一层，保证任何漏网异常都能落成可见文案，
       而不是让按钮点了没反应（控制台里一个 unhandled rejection）。 */
    const guarded = (fn) => () => {
      Promise.resolve()
        .then(fn)
        .catch((e) => { if (els) els.msg.textContent = `操作失败：${(e && e.message) || e}`; });
    };
    els.run.addEventListener('click', guarded(runMatch));
    els.write.addEventListener('click', guarded(doWrite));
    /* 导出按钮可能在面板重开、state 还没建好时被点到：先判空再取名字，
       否则 TypeError 会直接冒到控制台（用户只看到没反应）。 */
    els.csv.addEventListener('click', () => {
      if (!state || !state.playlist) { els.msg.textContent = '先选一张歌单'; return; }
      const rows = visibleRows();
      if (!rows.length) { els.msg.textContent = '还没有可导出的结果，先跑一次匹配'; return; }
      download(`歌单迁移-${state.playlist.name}.csv`, toCSV(rows));
    });
    els.m3u.addEventListener('click', () => {
      if (!state || !state.playlist) { els.msg.textContent = '先选一张歌单'; return; }
      const rows = visibleRows();
      if (!rows.length) { els.msg.textContent = '还没有可导出的结果，先跑一次匹配'; return; }
      download(`歌单迁移-${state.playlist.name}.m3u8`, toM3U(rows, state.playlist.name), 'audio/x-mpegurl');
    });

    // 目标平台：大卡、可选中；netease / QQ / 酷狗标「可写入」，其余标「导出」
    for (const t of TARGETS) {
      const b = h('button', 'mig__tcard');
      b.type = 'button';
      b.dataset.target = t.id;
      b.innerHTML = `
        <span class="mig__tcard-n">${t.name}</span>
        <span class="mig__tcard-tag">${t.canWrite ? '可写入' : '导出'}</span>
        <span class="mig__tcard-d">${t.canWrite ? '直接建一张新歌单' : '生成 CSV / M3U8 清单'}</span>`;
      b.addEventListener('click', () => selectTarget(t.id));
      els.targets.appendChild(b);
    }
  }

  function visibleRows() {
    return (state?.rows || []).filter((r) => r.pick || r.status !== 'miss');
  }

  /** 空态/错误文案：一律走 textContent，别把接口返回的字符串塞进 innerHTML */
  function emptyInto(el, text) {
    el.innerHTML = '';
    const p = h('p', 'mig__empty');
    p.textContent = text;
    el.appendChild(p);
  }

  /** 清掉上一轮的匹配结果和按钮。换歌单 / 换目标 / 重新载入都要走这里，
      否则旧结果会挂在新目标下面，看起来「明明没跑却有一张表」。 */
  function clearResults() {
    if (!els || !state) return;
    state.rows = [];
    state.written = false;   // 新的一轮开始，允许再次写入
    els.rows.innerHTML = '';
    els.s3.hidden = true;
    els.sum.textContent = '';
    els.write.hidden = true;
    els.write.disabled = false;
    els.write.textContent = '建歌单并写入';
    els.csv.hidden = true;
    els.m3u.hidden = true;
    els.fill.style.transform = 'scaleX(0)';
    els.track.classList.remove('is-run', 'is-done', 'is-err');
    els.done.hidden = true;
    els.doneT.textContent = '';
    stopBurst();
  }

  /** 匹配 / 写入期间锁住来源和目标；视觉上也有对应（CSS .is-locked / :disabled） */
  function setBusyUI(on) {
    if (!els) return;
    els.targets.classList.toggle('is-locked', on);
    els.playlists.classList.toggle('is-locked', on);
    for (const b of els.targets.children) b.disabled = on;
  }

  function updateSummary() {
    if (!els || !state) return;
    if (!state.rows.length) { els.sum.textContent = ''; return; }
    const n = (s) => state.rows.filter((r) => r.status === s).length;
    els.sum.textContent = `自动 ${n('auto')} · 待确认 ${n('review')} · 未找到 ${n('miss')}`;
  }

  /** 写入按钮只在「目标可写 + 这一轮已跑完 + 至少有 1 首选中」时可点 */
  function refreshActions() {
    if (!els || !state || state.busy) return;
    const writable = !!(TARGETS.find((x) => x.id === state.target) || {}).canWrite;
    const picks = state.rows.filter((r) => r.pick).length;
    els.write.hidden = !writable || !state.rows.length;
    els.write.disabled = !picks || !!state.written;
  }

  function selectTarget(id) {
    if (!state) return;
    const t = TARGETS.find((x) => x.id === id);
    if (!t) return;
    /* 匹配/写入途中换目标会让这一轮的结果混到另一个平台，直接拒绝并提示 */
    if (state.busy) {
      els.msg.textContent = '传输中，等这一轮跑完再换目标';
      return;
    }
    const changed = state.target !== id;
    state.target = id;
    for (const b of els.targets.children) b.classList.toggle('is-on', b.dataset.target === id);
    if (changed) {
      /* 换目标 = 上一轮结果对不上新平台，整轮作废回到空闲态 */
      clearResults();
      resetTransfer();
      if (state.playlist) {
        els.progress.textContent = state.tracks.length
          ? `已选《${state.playlist.name}》· ${state.tracks.length} 首`
          : '这张歌单没有可搬运的曲目';
      }
      els.run.disabled = !state.playlist || !state.tracks.length;
      els.run.textContent = '开始匹配';
    }
    els.msg.textContent = t.canWrite ? '' : `${t.name} 没有写入通道，匹配完可以导出 CSV / M3U8 自己导入`;
  }

  /* ---------------- 传输动画 ---------------- */
  let lastFly = 0;
  let writeTimer = 0;

  /** 空转态：轨道清空、进度归零，提示先选歌单 */
  function resetTransfer() {
    if (!els) return;
    els.track.classList.remove('is-run', 'is-done', 'is-err');
    els.done.hidden = true;
    els.doneT.textContent = '';
    els.lane.querySelectorAll('.mig__file').forEach((n) => n.remove());
    els.progress.textContent = '选一张歌单 → 点开始匹配';
    els.fill.style.transform = 'scaleX(0)';
    stopBurst();
  }

  function beginTransfer() {
    els.track.classList.remove('is-done', 'is-err');
    els.track.classList.add('is-run');
    els.done.hidden = true;
    els.doneT.textContent = '';
  }

  /** 收束成一张完成卡：文字就是这次的结论 */
  function finishTransfer(text, err) {
    els.track.classList.remove('is-run');
    els.track.classList.add('is-done');
    els.track.classList.toggle('is-err', !!err);
    els.done.hidden = false;
    els.doneT.textContent = text;
  }

  /** 一颗小文件块：沿轨道从左飞到右，带一点弧线和尾迹（CSS keyframes） */
  function flyOne() {
    if (REDUCED || !els || !els.lane) return;
    const now = performance.now();
    if (now - lastFly < 60) return;       // 并发 3 路匹配时也别把 DOM 冲爆
    lastFly = now;
    const el = h('span', 'mig__file');
    el.addEventListener('animationend', () => el.remove());
    els.lane.appendChild(el);
    setTimeout(() => el.remove(), 1600);  // 动画被丢帧时兜底
  }

  function stopBurst() {
    if (writeTimer) {
      clearInterval(writeTimer);
      writeTimer = 0;
    }
  }

  /** 写入阶段复用同一套轨道动效：在等接口的时候持续发块 */
  function burstStart() {
    els.track.classList.remove('is-done', 'is-err');
    els.track.classList.add('is-run');
    els.done.hidden = true;
    els.progress.textContent = '写入中…';
    stopBurst();
    if (!REDUCED) writeTimer = setInterval(flyOne, 150);
  }

  /* ---------------- 流程 ---------------- */

  /** 选一张来源歌单：选中态 → 读曲目 → 中间轨道给出「已选」结论。
      任何一步失败都要落到可见文案上，不能停在「读曲目…」。 */
  async function selectPlaylist(p, b) {
    if (!state) return;
    if (state.busy) {
      els.msg.textContent = '传输中，等这一轮跑完再换歌单';
      return;
    }
    const seq = ++srcSeq;
    const playlistState = state;
    const gen = openSeq;
    for (const x of els.playlists.children) x.classList.remove('is-on');
    b.classList.add('is-on');
    state.playlist = p;
    state.tracks = [];
    // 换歌单 = 上一轮结果作废：表、按钮、轨道全部回到空闲态
    clearResults();
    resetTransfer();
    els.progress.textContent = '读曲目…';
    els.msg.textContent = '';
    els.run.disabled = true;
    els.run.textContent = '开始匹配';

    try {
      const tracks = await playlistTracks(p.id);
      // 连点或面板已重开：旧响应直接丢掉
      if (seq !== srcSeq || state !== playlistState || openSeq !== gen) return;
      state.tracks = tracks;
      if (tracks.length) {
        els.progress.textContent = `已选《${p.name}》· ${tracks.length} 首`;
        els.run.disabled = false;
      } else {
        // 明确说清为什么点不了「开始匹配」
        els.progress.textContent = `《${p.name}》没有可读取的曲目`;
        els.msg.textContent = '这张歌单是空的，或者曲目接口没返回内容；换一张试试';
        els.run.disabled = true;
      }
    } catch (e) {
      if (seq !== srcSeq || state !== playlistState || openSeq !== gen) return;
      state.tracks = [];
      els.progress.textContent = `读曲目失败：${(e && e.message) || e}`;
      els.msg.textContent = '读取失败，可以再点一次这张歌单重试';
      els.run.disabled = true;
    }
  }

  async function open() {
    if (!root) build();
    const seq = ++openSeq;
    root.hidden = false;
    /* state.target 先置空，交给 selectTarget 走一遍「初始选中」并清空旧 UI */
    state = { playlist: null, tracks: [], rows: [], target: null, busy: false };
    /* 上一轮匹配/写入可能还在飞：它看到 state 被换掉后不会再解锁，
       所以新面板必须自己把目标卡的 disabled / 锁定类清掉。 */
    setBusyUI(false);
    els.rows.innerHTML = '';
    els.sum.textContent = '';
    els.s3.hidden = true;
    els.write.hidden = true;
    els.write.disabled = false;
    els.write.textContent = '建歌单并写入';
    els.csv.hidden = true;
    els.m3u.hidden = true;
    els.msg.textContent = '';
    els.run.disabled = true;
    els.run.textContent = '开始匹配';
    selectTarget('netease');
    resetTransfer();
    els.playlists.innerHTML = '';
    emptyInto(els.playlists, '载入中…');
    els.srcHint.textContent = '载入中…';
    els.progress.textContent = '载入中…';

    try {
      const s = await session();
      if (seq !== openSeq) return;                // 面板被重新打开过，旧请求作废
      if (!s || s.loggedIn !== true) {
        emptyInto(els.playlists, (!s || s.raw)
          ? '读不到登录状态：后端会话接口没有正常响应。'
          : '没登录。歌单搬运需要先登录网易云 —— 侧栏设置 → 账号。');
        els.srcHint.textContent = (!s || s.raw) ? '会话异常' : '未登录';
        els.progress.textContent = '等待登录';
        els.msg.textContent = (!s || s.raw) ? '检查后端是否在运行' : '先登录网易云再回来';
        return;
      }

      els.srcHint.textContent = s.profile?.nickname || '已登录';
      let list = [];
      try {
        list = await myPlaylists(s.profile?.userId);
      } catch (e) {
        if (seq !== openSeq) return;
        emptyInto(els.playlists, `取歌单失败：${(e && e.message) || e}`);
        els.srcHint.textContent = '取歌单失败';
        els.progress.textContent = '载入失败';
        els.msg.textContent = '歌单列表没拉下来，关掉面板再试一次';
        return;
      }
      if (seq !== openSeq) return;
      els.srcHint.textContent = `${s.profile?.nickname || ''} · ${list.length} 个歌单`;
      if (!list.length) {
        emptyInto(els.playlists, '这个账号名下没有歌单。');
        els.progress.textContent = '没有可用歌单';
        return;
      }
      els.progress.textContent = '选一张歌单 → 点开始匹配';
      els.playlists.innerHTML = '';
      for (const p of list) {
        const b = h('button', 'mig__pl');
        b.type = 'button';
        const safeName = p.name.replace(/[<>&]/g, '');
        const cover = String(p.cover || '').replace(/"/g, '&quot;');
        // 封面下面垫一个字：图挂了 / 没封面时还能认出是哪个歌单
        b.innerHTML = `
          <span class="mig__pl-cv"><i>${(safeName || '·').slice(0, 1)}</i>${cover
            ? `<img src="${cover}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
          <span class="mig__pl-tx"><b>${safeName}</b><span>${p.count} 首</span></span>`;
        b.addEventListener('click', () => selectPlaylist(p, b));
        els.playlists.appendChild(b);
      }
    } catch (e) {
      /* 网络层直接抛（断网 / 后端没起来）也要收束成文案，不能停在「载入中…」 */
      if (seq !== openSeq) return;
      emptyInto(els.playlists, `载入失败：${(e && e.message) || e}`);
      els.srcHint.textContent = '连接失败';
      els.progress.textContent = '载入失败';
      els.msg.textContent = '连不上后端，检查服务是否在运行';
    }
  }

  function close() {
    stopBurst();
    if (root) root.hidden = true;
  }

  /** 并发跑匹配：3 路，边跑边出进度 */
  async function runMatch() {
    if (!state || !state.playlist || state.busy) return;
    if (!state.tracks.length) {
      els.msg.textContent = '这张歌单没有曲目，先换一张';
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
    els.msg.textContent = '';
    els.s3.hidden = false;
    els.rows.innerHTML = '';
    els.sum.textContent = '';
    els.write.hidden = true;
    els.write.disabled = false;
    els.csv.hidden = true;
    els.m3u.hidden = true;
    els.fill.style.transform = 'scaleX(0)';
    els.done.hidden = true;
    els.doneT.textContent = '';
    beginTransfer();

    /* 用下标做行键：同一首歌在歌单里重复出现时，用歌曲 id 会把两行叠成一行 */
    const rows = state.tracks.map((t, i) => ({ src: t, key: i, cands: [], pick: null, status: 'miss' }));
    state.rows = rows;
    state.written = false;               // 重新匹配 = 允许再写一次
    const total = rows.length;
    let done = 0;
    let errors = 0;

    const render = () => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      els.fill.style.transform = `scaleX(${total ? done / total : 0})`;
      els.progress.textContent = `匹配中 ${done} / ${total} · ${pct}%`;
      flyOne();                       // ← 每次进度跳一下，轨道上就飞一块
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
    const auto = rows.filter((r) => r.status === 'auto').length;
    const review = rows.filter((r) => r.status === 'review').length;
    const miss = rows.filter((r) => r.status === 'miss').length;
    const summary = `自动 ${auto} · 待确认 ${review} · 未找到 ${miss}`;
    const writes = !!(TARGETS.find((t) => t.id === target) || {}).canWrite;
    const picks = rows.filter((r) => r.pick).length;

    els.sum.textContent = summary + (errors ? ` · 出错 ${errors}` : '');
    // 可写按钮只在「目标可写 + 这一轮已跑完」出现；没选中任何曲目时保留但置灰
    els.write.hidden = !writes;
    els.write.disabled = !picks;
    els.write.textContent = '建歌单并写入';
    els.csv.hidden = false;
    els.m3u.hidden = false;
    els.progress.textContent = errors ? `匹配完成 · ${errors} 首出错` : '匹配完成';
    if (errors === total) {
      els.msg.textContent = '所有曲目都搜索失败，检查网络或目标平台是否可用';
      finishTransfer(`全部 ${total} 首搜索失败`, true);
    } else {
      if (!picks) els.msg.textContent = '没有选中任何曲目；可以在下表里手动选，或直接导出清单';
      // 轨道收束成一张完成卡，结论直接写在卡里
      finishTransfer(summary + (errors ? ` · 出错 ${errors}` : ''), errors > 0);
    }
  }

  function paintRow(r) {
    let el = els.rows.querySelector(`[data-row="${r.key}"]`);
    if (!el) {
      el = h('div', 'mig__tr');
      el.dataset.row = r.key;
      els.rows.appendChild(el);
    }
    const cls = r.status === 'auto' ? 'is-auto' : r.status === 'review' ? 'is-review' : 'is-miss';
    el.className = `mig__tr ${cls}`;
    const pct = r.conf != null ? Math.round(r.conf * 100) : 0;
    const opts = (r.cands || []).map((c, i) =>
      `<option value="${i}" ${r.pick && r.pick.id === c.cand.id ? 'selected' : ''}>${(c.s.total * 100).toFixed(0)}% · ${c.cand.name}${c.cand.artists ? ' — ' + c.cand.artists : ''}</option>`
    ).join('');
    el.innerHTML = `
      <div class="mig__tr-src"><b>${r.src.name}</b><span>${r.src.artists}</span></div>
      <div class="mig__tr-pick">
        ${r.cands && r.cands.length
          ? `<select class="mig__sel"><option value="-1" ${r.pick ? '' : 'selected'}>— 跳过这首 —</option>${opts}</select>`
          : '<span class="mig__none">目标平台没搜到</span>'}
      </div>
      <div class="mig__tr-tag">${r.status === 'auto' ? '自动' : r.status === 'review' ? '待确认' : '未找到'}${r.conf != null ? ` ${pct}%` : ''}</div>`;
    const sel = el.querySelector('.mig__sel');
    if (sel) sel.addEventListener('change', () => {
      const v = Number(sel.value);
      r.pick = v < 0 ? null : r.cands[v].cand;
      r.status = r.pick ? 'review' : 'miss';
      paintRow(r);
      // 手动改选会改变「可写入」的曲目数量，按钮和汇总要跟着走
      updateSummary();
      refreshActions();
    });
  }

  async function doWrite() {
    if (!state || !state.playlist || state.busy) return;
    if (writing) { els.msg.textContent = '上一轮写入还没结束，稍等'; return; }
    const target = TARGETS.find((t) => t.id === state.target);
    if (!target || !target.canWrite) {
      els.msg.textContent = '这个平台没有写入通道，请改用导出';
      return;
    }
    const picks = state.rows.filter((r) => r.pick).map((r) => r.pick);
    if (!picks.length) {
      els.msg.textContent = '没有可写入的曲目';
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
    els.msg.textContent = '写入中…';
    burstStart();                       // 写入阶段复用同一条轨道动画
    try {
      els.msg.textContent = `在 ${target.name} 建歌单…`;
      const name = `${state.playlist.name}（来自搬运）`;
      const c = await createPlaylist(target.id, name);
      if (state !== writeState || openSeq !== gen) return;  // 面板已重开，丢弃这次结果
      const pid = c && (c.playlist?.id || c.id || c.body?.playlist?.id || c.listid);
      if (!pid) {
        const reason = (c && (c.error || c.message || c.msg)) || (c && c.raw ? '接口返回异常' : '未知原因');
        els.msg.textContent = `${target.name} 建歌单失败：${reason}`;
        els.progress.textContent = '建歌单失败';
        finishTransfer(`${target.name} 建歌单失败：${reason}`, true);
        return;
      }
      /* QQ 会把超过 20 字的歌单名截断，成功文案用服务端回读的名字，
         没回读就用本地名字（网易云/酷狗原样）。 */
      const writtenName = (c && (c.playlist?.name || c.name)) || name;

      els.msg.textContent = `写入 ${target.name} ${picks.length} 首…`;
      const r = await addTracks(target.id, pid, picks);
      if (state !== writeState || openSeq !== gen) return;  // 同上
      const ok = !!r && (Number(r.code) === 200 || Number(r.status) === 200);
      if (ok) {
        success = true;
        state.written = true;
        els.msg.textContent = `完成：${target.name}《${writtenName}》${picks.length} 首`;
        els.progress.textContent = '写入完成';
        finishTransfer(`已写入 ${target.name}《${writtenName}》· ${picks.length} 首`, false);
      } else {
        const reason = (r && (r.error || r.message || r.msg)) || (r && r.raw ? '接口返回异常' : '未知原因');
        els.msg.textContent = `${target.name} 写入失败：${reason}`;
        els.progress.textContent = '写入失败';
        finishTransfer(`${target.name} 写入失败：${reason}`, true);
      }
    } catch (e) {
      if (state !== writeState || openSeq !== gen) return;  // 面板已重开，旧错误不画
      /* 网络异常也必须收束成完成卡 —— 不能把「写入中…」留在界面上 */
      const reason = (e && e.message) || e;
      els.msg.textContent = `${target.name} 写入失败：${reason}`;
      els.progress.textContent = '写入中断';
      finishTransfer(`${target.name} 写入中断：${reason}`, true);
    } finally {
      stopBurst();
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

  return { open, close, _match: { normTitle, mainArtist, dice, score, best, BAND }, _export: { toCSV, toM3U } };
})();

/* ==========================================================================
   LIZI · 小卡（工具箱 → 小卡）
   --------------------------------------------------------------------------
   做什么：
     一个收藏墙。顶部两个来源：
       「专辑」—— 播放器里收藏的专辑，每张封面做成一张 3:4 的小卡；
       「我的卡」—— 用户自己导入的图片，持久化在 IndexedDB。
     点一张卡进入专注视图：一张大卡居中，网格淡出；Esc 或点空白返回。

   数据：
     · 收藏专辑：localStorage['lizi.myAlbums.v1']
         元素 { id, name, artists, cover, publishTime, trackCount, source, addedAt }
         本文件是普通 script，不能 import pages/collection.js（ES module），
         所以直接读 localStorage，只认数组形状和 id，坏数据一律当空。
     · 我的卡：IndexedDB  lizi-holocard / cards / keyPath 'id'
         记录 { id, blob, name, addedAt }
         图片写入前统一压到最长边 ≤ 1200px、JPEG quality 0.86。
         不用 localStorage 存图片：base64 几张就能撑爆配额，同步读写还会卡界面。
     · 界面里的图片一律用 URL.createObjectURL(blob)，关闭浮层时统一 revoke。

   全息材质接口（这里只留钩子，不实现 shader）：
     专注视图建好大卡后，如果 window.LIZI_HOLO_SHADER 存在，调用
       LIZI_HOLO_SHADER.mount(faceEl, imgEl, { preset: 'bursts' })
     返回对象若有 destroy()，离开专注视图 / 关闭浮层时调用。
     模块不存在就什么都不做，CSS 里的 .hc-foil / .hc-glare 继续兜底。
     canvas 由 shader 自己插进 .hc-face（position:absolute; inset:0），本文件不预埋。
     网格里的小卡永远只走 CSS 近似，不挂 shader（性能优先）。

   不碰 app.js / index.html：自己注入浮层和样式，
   只暴露 window.LIZI_HOLOCARD = { open, close }。
   ========================================================================== */

window.LIZI_HOLOCARD = (() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量
   * ------------------------------------------------------------------ */
  const DB_NAME = 'lizi-holocard';
  const DB_VERSION = 1;
  const STORE = 'cards';
  const ALBUM_KEY = 'lizi.myAlbums.v1';
  const ALBUM_PREFIX = 'album:';
  const MAX_EDGE = 1200;
  const JPEG_Q = 0.86;
  const TILT_MAX = 6;              // 网格小卡倾斜上限（度）
  const UNDO_MS = 9000;

  const X_SVG = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18"/>
    </svg>`;

  let reduced = false;
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', (e) => { reduced = e.matches; });
  } catch { /* 老内核没有 matchMedia 事件 */ }

  /* ------------------------------------------------------------------ *
   * 样式：index.html 只加一行 script，CSS 由这里注入
   * ------------------------------------------------------------------ */
  (function injectCss() {
    if (document.querySelector('link[data-lizi-holocard-css]')) return;
    const current = document.currentScript ||
      document.querySelector('script[src*="tools/holocard/holocard.js"]');
    const href = current
      ? new URL('holocard.css', current.src).href
      : 'tools/holocard/holocard.css';
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-lizi-holocard-css', '');
    document.head.appendChild(link);
  })();

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch { /* 老内核 */ }
    return `hc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** 从文件名去掉扩展名，留一个像人名的卡名 */
  function baseName(name) {
    const s = String(name || '').replace(/\.[^./\\]+$/, '').trim();
    return (s || '我的卡').slice(0, 80);
  }

  function formatDate(ts) {
    const n = Number(ts);
    if (!n) return '';
    const d = new Date(n);
    if (isNaN(d.getTime())) return '';
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }

  /* ------------------------------------------------------------------ *
   * IndexedDB：lizi-holocard / cards / keyPath 'id'
   * ------------------------------------------------------------------ */
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('这个环境不支持 IndexedDB'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(new Error(`本地卡片库打不开：${(e && e.message) || e}`));
        return;
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const os = d.createObjectStore(STORE, { keyPath: 'id' });
          try { os.createIndex('addedAt', 'addedAt'); } catch { /* 索引只是加速，失败不影响读取 */ }
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => { try { d.close(); } catch { /* noop */ } };
        resolve(d);
      };
      req.onerror = () => {
        reject(new Error(`本地卡片库打不开：${(req.error && req.error.message) || '未知错误'}`));
      };
      req.onblocked = () => { /* 另一个标签页还占着旧版本，等它关掉 */ };
    });
    // 打开失败后允许下次重试，否则一次隐私模式就把整个会话钉死
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  /** 在事务里执行一次，事务 complete 才 resolve；出错统一 reject */
  async function withStore(mode, fn) {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = d.transaction(STORE, mode); }
      catch (e) { reject(e); return; }

      let req = null;
      try { req = fn(tx.objectStore(STORE)); }
      catch (e) { try { tx.abort(); } catch { /* noop */ } reject(e); return; }

      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject((tx.error) || (req && req.error) || new Error('本地卡片库操作失败'));
      tx.onabort = () => reject(tx.error || new Error('本地卡片库操作中止'));
    });
  }

  const cardsAll = () => withStore('readonly', (os) => os.getAll());
  const cardGet = (id) => withStore('readonly', (os) => os.get(id));
  const cardPut = (rec) => withStore('readwrite', (os) => os.put(rec));
  const cardDelete = (id) => withStore('readwrite', (os) => os.delete(id));

  /* ------------------------------------------------------------------ *
   * 图片：解码 → 缩放 → JPEG
   * ------------------------------------------------------------------ */
  function decodeViaImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h) {
          URL.revokeObjectURL(url);
          reject(new Error('图片解码失败'));
          return;
        }
        resolve({ source: img, width: w, height: h, done: () => URL.revokeObjectURL(url) });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败'));
      };
      img.src = url;
    });
  }

  async function decodeImage(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(blob);
        return {
          source: bmp,
          width: bmp.width,
          height: bmp.height,
          done: () => { try { bmp.close(); } catch { /* noop */ } },
        };
      } catch { /* SVG / 特殊编码退回 <img> */ }
    }
    return decodeViaImage(blob);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('图片编码失败'));
        }, 'image/jpeg', JPEG_Q);
        return;
      }
      // 极老内核兜底：dataURL 再转 Blob
      try {
        const data = canvas.toDataURL('image/jpeg', JPEG_Q);
        const bin = atob(data.split(',')[1] || '');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/jpeg' }));
      } catch (e) {
        reject(new Error('图片编码失败'));
      }
    });
  }

  /** 统一出口：最长边 ≤ 1200、JPEG 0.86。透明 PNG 先铺深色底，避免发黑/发灰 */
  async function compressImage(blob) {
    if (!blob) throw new Error('图片是空的');
    const dec = await decodeImage(blob);
    try {
      const w0 = dec.width || 0;
      const h0 = dec.height || 0;
      if (!w0 || !h0) throw new Error('图片解码失败');

      const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d');
      if (!g) throw new Error('画布不可用');

      g.fillStyle = '#141418';
      g.fillRect(0, 0, w, h);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(dec.source, 0, 0, w, h);

      return await canvasToBlob(canvas);
    } finally {
      try { dec.done(); } catch { /* noop */ }
    }
  }

  /** 抓专辑封面。跨域失败必须明确报「封面不允许保存」，不能静默 */
  async function fetchCover(url) {
    let res;
    try {
      res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      const err = new Error('封面不允许保存（跨域拦截）');
      err.code = 'cors';
      throw err;
    }
    if (!res.ok) throw new Error(`封面不允许保存：读取失败（HTTP ${res.status}）`);
    let blob;
    try { blob = await res.blob(); }
    catch { throw new Error('封面不允许保存：读取数据失败'); }
    if (!blob.type || blob.type.indexOf('image/') !== 0) {
      throw new Error('封面不允许保存：返回的不是图片');
    }
    if (blob.size > 30 * 1024 * 1024) throw new Error('封面不允许保存：文件太大');
    return blob;
  }

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const state = {
    open: false,
    built: false,
    tab: 'albums',              // 'albums' | 'mine'
    albums: [],
    mine: [],
    mineLoading: false,
    importing: false,
    focus: null,                // 专注视图里那张卡的 id
    focusItem: null,
    lastFocus: null,
    urls: new Set(),            // 本模块创建的所有 objectURL
  };

  let root = null;
  let els = null;
  let built = false;
  let shader = null;            // window.LIZI_HOLO_SHADER.mount() 的返回值
  let shaderToken = null;       // 防止上一张卡的 shader 迟到回调影响新卡
  let focusSeq = 0;
  let mineSeq = 0;
  let undoTimer = 0;

  /* ------------------------------------------------------------------ *
   * 数据读取
   * ------------------------------------------------------------------ */
  function readAlbums() {
    let arr = [];
    try {
      const raw = localStorage.getItem(ALBUM_KEY);
      const v = raw ? JSON.parse(raw) : [];
      arr = Array.isArray(v) ? v : [];
    } catch {
      arr = [];
    }
    return arr
      .filter((a) => a && a.id)
      .map((a) => ({
        kind: 'album',
        id: String(a.id),
        name: String(a.name || '未知专辑'),
        meta: String(a.artists || ''),
        src: String(a.cover || ''),
        addedAt: Number(a.addedAt) || 0,
      }))
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  function revokeUrl(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
    state.urls.delete(url);
  }

  function revokeAllUrls() {
    for (const url of Array.from(state.urls)) revokeUrl(url);
  }

  async function loadMine() {
    const seq = ++mineSeq;
    state.mineLoading = true;
    if (state.open && state.tab === 'mine') render();

    let recs;
    try {
      recs = await cardsAll();
    } catch (e) {
      if (seq !== mineSeq || !state.open) return;
      state.mineLoading = false;
      setMsg(`读取我的卡失败：${(e && e.message) || e}`, { error: true });
      if (state.tab === 'mine') render();
      return;
    }
    if (seq !== mineSeq || !state.open) return;

    const prevById = new Map(state.mine.map((m) => [m.id, m]));
    const next = [];
    for (const r of recs) {
      if (!r || !r.id || !(r.blob instanceof Blob)) continue;   // 坏记录直接跳过
      const prev = prevById.get(r.id);
      let url = prev && prev.addedAt === r.addedAt && prev.url ? prev.url : '';
      if (!url) {
        if (prev && prev.url) revokeUrl(prev.url);
        url = URL.createObjectURL(r.blob);
        state.urls.add(url);
      }
      next.push({
        kind: 'mine',
        id: r.id,
        name: String(r.name || '我的卡'),
        meta: formatDate(r.addedAt),
        src: url,
        blob: r.blob,
        addedAt: Number(r.addedAt) || 0,
      });
    }

    // 已经被删掉的记录，URL 也要一并收走
    for (const [id, prev] of prevById) {
      if (prev.url && !next.some((n) => n.id === id)) revokeUrl(prev.url);
    }

    next.sort((a, b) => b.addedAt - a.addedAt);
    state.mine = next;
    state.mineLoading = false;
    if (state.tab === 'mine') render();
  }

  /* ------------------------------------------------------------------ *
   * 提示条（带撤销）
   * ------------------------------------------------------------------ */
  function clearUndoTimer() {
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = 0;
    }
  }

  function setMsg(text, opts) {
    if (!els || !els.msg) return;
    clearUndoTimer();
    els.msg.textContent = '';
    els.msg.classList.toggle('is-err', !!(opts && opts.error));
    if (!text) return;

    const span = document.createElement('span');
    span.textContent = text;               // 一律 textContent，不把外部字符串塞进 innerHTML
    els.msg.appendChild(span);

    if (opts && typeof opts.undo === 'function') {
      const undo = opts.undo;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hc__undo';
      b.textContent = '撤销';
      b.addEventListener('click', () => {
        setMsg('');
        Promise.resolve()
          .then(undo)
          .catch((e) => setMsg(`撤销失败：${(e && e.message) || e}`, { error: true }));
      });
      els.msg.appendChild(b);
      undoTimer = setTimeout(() => {
        undoTimer = 0;
        if (!els || !els.msg) return;
        els.msg.textContent = '';
        els.msg.classList.remove('is-err');
      }, UNDO_MS);
    }
  }

  /* ------------------------------------------------------------------ *
   * 卡面 DOM
   *    固定结构：
      .hc-card > .hc-rotor > .hc-face > img.hc-art + span.hc-foil + span.hc-glare
    caption / 操作按钮是卡片的兄弟层，不塞进 .hc-face，保证卡面插槽干净。
   * ------------------------------------------------------------------ */
  function setArt(face, img, item, big) {
    face.dataset.initial = String(item.name || '·').trim().slice(0, 1) || '·';
    img.alt = item.kind === 'album' ? `${item.name} 封面` : item.name;
    img.decoding = 'async';
    img.loading = big ? 'eager' : 'lazy';
    img.referrerPolicy = 'no-referrer';

    if (!item.src) {
      face.classList.add('is-empty');
      return;
    }
    img.addEventListener('error', () => {
      face.classList.add('is-empty');
      img.removeAttribute('src');
    }, { once: true });
    img.src = item.src;
  }

  function makeCard(item, opts) {
    const o = opts || {};
    const big = !!o.big;

    const card = document.createElement('figure');
    card.className = `hc-card${big ? ' hc-card--big' : ''}`;
    card.dataset.kind = item.kind;
    card.dataset.id = item.id;

    const rotor = document.createElement('div');
    rotor.className = 'hc-rotor';

    const face = document.createElement('div');
    face.className = 'hc-face';

    const img = document.createElement('img');
    img.className = 'hc-art';
    img.draggable = false;

    const foil = document.createElement('span');
    foil.className = 'hc-foil';
    foil.setAttribute('aria-hidden', 'true');

    const glare = document.createElement('span');
    glare.className = 'hc-glare';
    glare.setAttribute('aria-hidden', 'true');

    face.appendChild(img);
    face.appendChild(foil);
    face.appendChild(glare);
    /* 全息材质：后面由 holo-shader.js 接管 .hc-face 的 canvas（position:absolute; inset:0） */

    const cap = document.createElement('figcaption');
    cap.className = 'hc-cap';
    const nameEl = document.createElement('b');
    nameEl.className = 'hc-name';
    nameEl.textContent = item.name || '未命名';
    cap.appendChild(nameEl);
    if (item.meta) {
      const metaEl = document.createElement('span');
      metaEl.className = 'hc-meta';
      metaEl.textContent = item.meta;
      cap.appendChild(metaEl);
    }

    rotor.appendChild(face);
    rotor.appendChild(cap);
    card.appendChild(rotor);

    setArt(face, img, item, big);

    if (!big) {
      if (item.kind === 'mine') {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'hc-del';
        del.textContent = '×';
        del.setAttribute('aria-label', `删除「${item.name}」`);
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteCard(item);
        });
        card.appendChild(del);
      } else if (item.kind === 'album') {
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'hc-keep';
        keep.textContent = '收进我的卡';
        keep.setAttribute('aria-label', `把「${item.name}」收进我的卡`);
        keep.addEventListener('click', (e) => {
          e.stopPropagation();
          keepAlbum(item, keep);
        });
        card.appendChild(keep);
      }

      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${item.name}${item.meta ? '，' + item.meta : ''}，打开专注视图`);
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openFocus(item);
      });
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          openFocus(item);
        }
      });
      bindTilt(card);
    }

    return card;
  }

  /** 很轻的指针倾斜：只改 --rx / --ry / --mx / --my，材质留给 CSS */
  function bindTilt(card) {
    let raf = 0;
    let pending = null;

    const apply = () => {
      raf = 0;
      const ev = pending;
      pending = null;
      if (!ev || !card.isConnected || reduced) return;

      const r = card.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = clamp01((ev.clientX - r.left) / r.width);
      const ny = clamp01((ev.clientY - r.top) / r.height);

      const rx = (0.5 - ny) * 2 * TILT_MAX;
      const ry = (nx - 0.5) * 2 * TILT_MAX;
      card.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
      card.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
      card.style.setProperty('--mx', `${(nx * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${(ny * 100).toFixed(1)}%`);
      card.classList.add('is-tilt');
    };

    card.addEventListener('pointermove', (e) => {
      if (reduced) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      pending = e;
      if (!raf) raf = requestAnimationFrame(apply);
    });

    const reset = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      pending = null;
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--mx', '50%');
      card.style.setProperty('--my', '45%');
      card.classList.remove('is-tilt');
    };

    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);
  }

  /* ------------------------------------------------------------------ *
   * 网格 / 空态
   * ------------------------------------------------------------------ */
  function updateTabUI() {
    if (!els) return;
    const albums = state.tab === 'albums';
    els.tabAlbums.classList.toggle('is-on', albums);
    els.tabAlbums.setAttribute('aria-selected', String(albums));
    els.tabMine.classList.toggle('is-on', !albums);
    els.tabMine.setAttribute('aria-selected', String(!albums));
    els.grid.setAttribute('aria-labelledby', albums ? 'hc-tab-albums' : 'hc-tab-mine');
  }

  function emptyInto(title, text) {
    const box = document.createElement('div');
    box.className = 'hc__empty';
    const b = document.createElement('b');
    b.textContent = title;
    box.appendChild(b);
    if (text) {
      const span = document.createElement('span');
      span.textContent = text;
      box.appendChild(span);
    }
    els.grid.appendChild(box);
  }

  function render() {
    if (!els) return;
    updateTabUI();

    const albums = state.tab === 'albums';
    const list = albums ? state.albums : state.mine;

    els.grid.innerHTML = '';
    els.grid.classList.toggle('is-focusing', !!state.focus);
    els.count.textContent = albums
      ? `${state.albums.length} 张专辑`
      : (state.mineLoading && !state.mine.length ? '读取中…' : `${state.mine.length} 张卡`);

    if (!albums && state.mineLoading && !list.length) {
      emptyInto('正在读取我的卡…', '');
      return;
    }
    if (!list.length) {
      if (albums) {
        emptyInto('还没有收藏专辑', '在「我的专辑」里收一张专辑，它的封面就会出现在这里。');
      } else {
        emptyInto('还没有自己的卡', '点右上角「导入图片」，或把一张专辑卡收进我的卡。');
      }
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of list) frag.appendChild(makeCard(item));
    els.grid.appendChild(frag);
  }

  function setTab(tab, silent) {
    if (tab !== 'albums' && tab !== 'mine') return;
    if (state.focus) closeFocus();
    if (state.tab === tab) {
      if (!silent) setMsg('');
      render();
      return;
    }
    state.tab = tab;
    if (!silent) setMsg('');
    render();
  }

  /* ------------------------------------------------------------------ *
   * 专注视图 + 全息材质钩子
   * ------------------------------------------------------------------ */
  function mountFocusShader() {
    if (!els) return;
    const face = els.focusStage.querySelector('.hc-face');
    const img = els.focusStage.querySelector('img.hc-art');
    if (!face || !img) return;

    const S = window.LIZI_HOLO_SHADER;
    if (!S || typeof S.mount !== 'function') return;   // 模块没接上：保留 CSS 近似

    const token = {};
    shaderToken = token;

    try {
      const handle = S.mount(face, img, {
        preset: 'bursts',
        /* canvas 建立后图片才暴露不可用（比如跨域纹理污染）：shader 会自毁，
           这里把 CSS 近似放回来，别让大卡变成一块空玻璃。 */
        onUnavailable: () => {
          if (shaderToken !== token) return;
          shaderToken = null;
          shader = null;
          face.classList.remove('has-shader');
        },
      }) || null;

      if (shaderToken !== token) return;   // 同步回调里已经作废
      shader = handle;
      // 材质接管后收起 CSS 近似，避免两层膜叠在大卡上
      if (handle) face.classList.add('has-shader');
    } catch (e) {
      if (shaderToken === token) shader = null;
      console.warn('[holocard] 全息材质挂载失败，保留 CSS 近似', e);
    }
  }

  function unmountFocusShader() {
    if (!els) return;
    const face = els.focusStage.querySelector('.hc-face');
    shaderToken = null;

    if (shader) {
      try {
        if (typeof shader.destroy === 'function') shader.destroy();
      } catch (e) {
        console.warn('[holocard] 全息材质销毁失败', e);
      }
      shader = null;
    }

    // 兜底：离开专注视图时，shader 插进卡面的 canvas 必须让位给 img，
    // 不能出现一块残留画布把封面永久盖住。
    if (face) {
      face.classList.remove('has-shader');
      face.querySelectorAll(':scope > canvas').forEach((c) => c.remove());
    }
  }

  function openFocus(item) {
    if (!state.open || !item || !els) return;
    if (state.focus) closeFocus();

    state.focus = item.id;
    state.focusItem = item;
    els.grid.classList.add('is-focusing');

    els.focusStage.innerHTML = '';
    els.focusStage.appendChild(makeCard(item, { big: true }));

    els.focus.setAttribute('aria-hidden', 'false');
    els.focus.classList.add('is-on');
    try { els.focus.focus({ preventScroll: true }); } catch { /* noop */ }

    mountFocusShader();
  }

  function closeFocus() {
    if (!state.focus || !els) return;
    const id = state.focus;

    unmountFocusShader();          // 先销毁材质，再让 DOM 淡出
    state.focus = null;
    state.focusItem = null;

    els.focus.classList.remove('is-on');
    els.focus.setAttribute('aria-hidden', 'true');
    els.grid.classList.remove('is-focusing');

    const seq = ++focusSeq;
    setTimeout(() => {
      if (seq !== focusSeq || state.focus) return;
      els.focusStage.innerHTML = '';
    }, reduced ? 0 : 220);

    // 回到触发专注视图的那张卡
    const back = Array.from(els.grid.querySelectorAll('.hc-card')).find((c) => c.dataset.id === id);
    if (back) {
      try { back.focus({ preventScroll: true }); } catch { /* noop */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * 导入 / 删除 / 收专辑
   * ------------------------------------------------------------------ */
  async function importFiles(files) {
    if (state.importing || !files || !files.length) return;
    state.importing = true;
    els.importBtn.disabled = true;

    const total = files.length;
    let ok = 0;
    let fail = 0;
    let firstErr = '';

    try {
      for (let i = 0; i < total; i++) {
        if (!state.open) break;
        setMsg(`正在处理 ${i + 1} / ${total}…`);
        try {
          const blob = await compressImage(files[i]);
          await cardPut({ id: newId(), blob, name: baseName(files[i].name), addedAt: Date.now() });
          ok++;
        } catch (e) {
          fail++;
          if (!firstErr) firstErr = (e && e.message) || String(e);
          console.warn('[holocard] 导入失败', files[i] && files[i].name, e);
        }
      }
    } finally {
      state.importing = false;
      if (els) els.importBtn.disabled = false;
    }

    if (!state.open) return;

    if (ok) {
      if (state.focus) closeFocus();
      state.tab = 'mine';
      state.mineLoading = true;
      render();
      await loadMine();
    }
    if (!state.open) return;

    if (!fail) setMsg(`已导入 ${ok} 张卡`);
    else if (!ok) setMsg(`导入失败：${firstErr || '这些图片读不了'}`, { error: true });
    else setMsg(`已导入 ${ok} 张，${fail} 张失败：${firstErr}`, { error: true });
  }

  async function deleteCard(item) {
    if (!item || item.kind !== 'mine' || !item.id) return;
    if (state.focus === item.id) closeFocus();

    try {
      await cardDelete(item.id);
    } catch (e) {
      setMsg(`删除失败：${(e && e.message) || e}`, { error: true });
      return;
    }

    const prev = state.mine.find((m) => m.id === item.id);
    if (prev && prev.url) revokeUrl(prev.url);
    state.mine = state.mine.filter((m) => m.id !== item.id);
    render();

    const rec = { id: item.id, blob: item.blob, name: item.name, addedAt: item.addedAt };
    setMsg(`已删除「${item.name}」`, {
      undo: async () => {
        await cardPut(rec);
        await loadMine();
        setMsg(`已恢复「${item.name}」`);
      },
    });
  }

  async function keepAlbum(item, btn) {
    if (!item || item.kind !== 'album') return;
    if (btn && btn.dataset.busy === '1') return;
    if (!item.src) {
      setMsg('这张专辑没有封面，收不进我的卡。', { error: true });
      return;
    }

    if (btn) {
      btn.dataset.busy = '1';
      btn.disabled = true;
      btn.textContent = '保存中…';
    }

    try {
      const srcBlob = await fetchCover(item.src);
      const jpeg = await compressImage(srcBlob);
      const id = ALBUM_PREFIX + item.id;
      const old = await cardGet(id).catch(() => null);
      await cardPut({ id, blob: jpeg, name: item.name, addedAt: Date.now() });
      await loadMine();
      if (btn) btn.textContent = '已收进';
      setMsg(old ? `《${item.name}》的卡已更新，在「我的卡」里` : `《${item.name}》已收进我的卡`);
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '收进我的卡';
        delete btn.dataset.busy;
      }
      setMsg((e && e.message) || '封面不允许保存', { error: true });
    }
  }

  /* ------------------------------------------------------------------ *
   * 构建浮层
   * ------------------------------------------------------------------ */
  function build() {
    root = document.createElement('div');
    root.className = 'hc';
    root.id = 'lizi-holocard';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'hc-title');
    root.innerHTML = `
      <div class="hc__sheet">
        <header class="hc__head">
          <div>
            <h2 class="hc__title" id="hc-title">小卡</h2>
            <p class="hc__sub">收藏的专辑和导入的图片都在这里。点一张卡进入专注视图。</p>
          </div>
          <button class="hc__x" id="hc-x" type="button" aria-label="关闭小卡">${X_SVG}</button>
        </header>

        <div class="hc__bar">
          <div class="hc__tabs" role="tablist" aria-label="卡片来源">
            <button class="hc__tab is-on" id="hc-tab-albums" type="button" role="tab"
              aria-selected="true" aria-controls="hc-grid" data-tab="albums">专辑</button>
            <button class="hc__tab" id="hc-tab-mine" type="button" role="tab"
              aria-selected="false" aria-controls="hc-grid" data-tab="mine">我的卡</button>
          </div>
          <div class="hc__acts">
            <span class="hc__count" id="hc-count"></span>
            <button class="hc__btn" id="hc-import" type="button">导入图片</button>
            <input class="hc__file" id="hc-file" type="file" accept="image/*" multiple
              tabindex="-1" aria-hidden="true">
          </div>
        </div>

        <div class="hc__body">
          <div class="hc__grid" id="hc-grid" role="tabpanel" aria-labelledby="hc-tab-albums"></div>
        </div>
        <p class="hc__msg" id="hc-msg" role="status"></p>
      </div>

      <div class="hc__focus" id="hc-focus" role="dialog" aria-modal="true"
        aria-label="专注视图" aria-hidden="true" tabindex="-1">
        <div class="hc__focus-stage" id="hc-focus-stage"></div>
        <p class="hc__focus-hint">Esc 或点空白返回</p>
      </div>`;

    document.body.appendChild(root);

    els = {
      sheet: root.querySelector('.hc__sheet'),
      grid: root.querySelector('#hc-grid'),
      count: root.querySelector('#hc-count'),
      msg: root.querySelector('#hc-msg'),
      importBtn: root.querySelector('#hc-import'),
      file: root.querySelector('#hc-file'),
      tabAlbums: root.querySelector('#hc-tab-albums'),
      tabMine: root.querySelector('#hc-tab-mine'),
      focus: root.querySelector('#hc-focus'),
      focusStage: root.querySelector('#hc-focus-stage'),
    };

    root.querySelector('#hc-x').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });

    els.tabAlbums.addEventListener('click', () => setTab('albums'));
    els.tabMine.addEventListener('click', () => setTab('mine'));

    els.importBtn.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', () => {
      const files = Array.from(els.file.files || []);
      els.file.value = '';               // 同一张图连选两次也要触发 change
      if (!files.length) return;
      importFiles(files).catch((e) => setMsg(`导入失败：${(e && e.message) || e}`, { error: true }));
    });

    // 点专注视图的空白处返回网格；卡片本身不关闭
    els.focus.addEventListener('click', (e) => {
      if (e.target === els.focus || e.target === els.focusStage) closeFocus();
    });

    built = true;
  }

  /* ------------------------------------------------------------------ *
   * 打开 / 关闭
   * ------------------------------------------------------------------ */
  async function open() {
    if (!built) build();
    if (state.open) {
      try { els.tabAlbums.focus({ preventScroll: true }); } catch { /* noop */ }
      return;
    }

    state.open = true;
    state.lastFocus = document.activeElement;
    state.focus = null;
    state.focusItem = null;
    state.albums = readAlbums();
    state.tab = 'albums';

    root.hidden = false;
    document.addEventListener('keydown', onDocKey, true);

    updateTabUI();
    setMsg('');
    render();

    try { els.tabAlbums.focus({ preventScroll: true }); } catch { /* noop */ }

    await loadMine();
  }

  function close() {
    if (!state.open) return;

    if (state.focus) closeFocus();
    state.open = false;
    mineSeq++;                       // 还在飞的读取结果作废
    state.mineLoading = false;

    document.removeEventListener('keydown', onDocKey, true);
    clearUndoTimer();

    root.hidden = true;
    els.focusStage.innerHTML = '';
    els.grid.innerHTML = '';
    setMsg('');

    // 统一回收所有 objectURL；下次打开时 loadMine 会重新生成
    revokeAllUrls();
    state.mine = [];

    const back = state.lastFocus && state.lastFocus.isConnected
      ? state.lastFocus
      : document.querySelector('[data-tool="holocard"], [data-tool="card"]');
    if (back) {
      try { back.focus({ preventScroll: true }); } catch { /* noop */ }
    }
    state.lastFocus = null;
  }

  function onDocKey(e) {
    if (!state.open || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (state.focus) closeFocus();
    else close();
  }

  /* ------------------------------------------------------------------ *
   * 对外
   * ------------------------------------------------------------------ */
  return { open, close };
})();

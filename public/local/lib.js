/* ==========================================================================
   LIZI · 本地音乐库（/local/lib.js）
   --------------------------------------------------------------------------
   给「设置 → 平台管理 → 自定义音源」和「本地音乐」页共用的一套最底层存储：

     · IndexedDB「lizi-local」，三个 store：
         tracks  { id, name, artists, album, fileName, mime, size, duration,
                   cover, hasLrc, hasYrc, lyricName, createdAt }
         audio   { id, blob, mime }
         lyric   { id, text, format, name, addedAt }
     · 曲目 id 统一是 'local:<随机串>'，source:'local'，和播放器 / 队列里的
       平台曲目同一个形状，只多一个 source —— player.js 按 source 分支取址。
     · 音频用 blob URL 播放：blob URL 只在本次运行有效，所以**存的是 Blob**，
       每次 urlOf() 现造一个并缓存；刷新 / 重启后按 id 重新取，不会断。
     · 2026-11-17 起安卓壳还能「扫描导入」手机里其它 App 的歌曲。这类曲目
       不复制音频（一百首就上 GB），记录里只有 path + ref:true，播放时
       urlOf() 直接回 /api/local-file?path=… 交给本机服务流式读；删除记录
       不会动手机里的原文件。
     · 封面在导入时就抠成 data URL（ID3v2 APIC / FLAC PICTURE / MP4 covr）
       并缩到 360px，否则整张原图塞进 IndexedDB 会把库撑爆。
       2026-11-16 起也能由用户单独给一张图：setCoverFile 走同一个 shrinkCover。
     · 不上传服务器，不做转码：文件多大就存多大。
   对外：window.LIZI_LOCAL = { addFile, addRef, list, get, remove, urlOf, lyricOf,
                              setLyricFile, setCoverFile, search, onChange, count, uid }
   ========================================================================== */
(function () {
  'use strict';

  var DB_NAME = 'lizi-local';
  var DB_VER = 1;
  var S_TRACK = 'tracks';
  var S_AUDIO = 'audio';
  var S_LYRIC = 'lyric';
  var AUDIO_EXT = /\.(mp3|flac|wav|m4a|m4b|ogg|oga|aac|opus|wma|aiff?)$/i;

  /* ------------------------------------------------------------------ *
   * IndexedDB 小封装
   * ------------------------------------------------------------------ */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('这个环境不支持本地存储')); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { rej(e); return; }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(S_TRACK)) d.createObjectStore(S_TRACK, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(S_AUDIO)) d.createObjectStore(S_AUDIO, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(S_LYRIC)) d.createObjectStore(S_LYRIC, { keyPath: 'id' });
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('本地库打开失败')); };
      req.onblocked = function () { rej(new Error('本地库被另一个页面占用，请关掉其它 LIZI 页面再试')); };
    });
    return dbp;
  }

  /** 在一个事务里跑 fn(store)，等事务 complete 再取请求结果 */
  function run(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t;
        try { t = d.transaction(store, mode); } catch (e) { rej(e); return; }
        var req;
        try { req = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(req && 'result' in req ? req.result : undefined); };
        t.onerror = function () { rej(t.error || new Error('本地库读写失败')); };
        t.onabort = function () { rej(t.error || new Error('本地库写入被中断（可能空间不够）')); };
      });
    });
  }

  function isEmpty() {
    return new Promise(function (res) {
      try {
        if (!navigator.storage || !navigator.storage.estimate) { res(false); return; }
        navigator.storage.estimate().then(function (e) {
          res(!e || !e.quota || e.usage / e.quota > 0.9);
        }, function () { res(false); });
      } catch (e) { res(false); }
    });
  }

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */
  function uid() {
    return 'local:' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function emit() {
    try { document.dispatchEvent(new CustomEvent('lizi-local-change')); } catch (e) { /* 忽略 */ }
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* 单个监听器出错不影响别人 */ }
    });
  }
  var listeners = [];

  /** 音频时长（毫秒）；探不出来记 0，界面会显示 --:--，不影响播放 */
  function probeDuration(blob) {
    return new Promise(function (res) {
      var url;
      try { url = URL.createObjectURL(blob); } catch (e) { res(0); return; }
      var el = document.createElement('audio');
      var done = false;
      var timer = setTimeout(function () { fin(0); }, 8000);
      function fin(v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { el.removeAttribute('src'); el.load(); } catch (e) { /* 忽略 */ }
        URL.revokeObjectURL(url);
        res(v > 0 && isFinite(v) ? Math.round(v) : 0);
      }
      el.preload = 'metadata';
      el.addEventListener('loadedmetadata', function () {
        fin((el.duration || 0) * 1000);
      });
      el.addEventListener('error', function () { fin(0); });
      el.src = url;
    });
  }

  /** 「歌手 - 歌名.mp3」→ 歌手 / 歌名；「01. 歌名.mp3」只去掉序号 */
  function metaFromName(fileName) {
    var base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
    if (!base) return { name: '未命名', artists: '未知歌手' };
    var m = base.match(/^(.{1,40}?)\s+-\s+(.{1,80})$/);
    if (m) return { artists: m[1].trim(), name: m[2].trim() };
    return { artists: '未知歌手', name: base.replace(/^\d{1,3}\s*[.\-_、)]\s*/, '').trim() || base };
  }

  /* ---- 内嵌封面：ID3v2(APIC) / FLAC(PICTURE) / MP4(covr) ----
     只读文件头 2 MB，够覆盖 99% 的封面（图都在头部）。
     抠出来的图缩到 360px 存 data URL —— blob URL 刷新就失效。 */
  var be32 = function (u8, i) {
    return ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
  };
  var syncsafe = function (u8, i) {
    return ((u8[i] & 0x7f) << 21) | ((u8[i + 1] & 0x7f) << 14) |
      ((u8[i + 2] & 0x7f) << 7) | (u8[i + 3] & 0x7f);
  };
  var ascii = function (u8, i, n) {
    var s = '';
    for (var k = 0; k < n; k++) s += String.fromCharCode(u8[i + k] || 0);
    return s;
  };

  function id3Pic(u8) {
    var ver = u8[3];
    var flags = u8[5];
    var end = Math.min(u8.length, 10 + syncsafe(u8, 6));
    var p = 10;
    if (flags & 0x40) p += ver === 4 ? syncsafe(u8, p) : be32(u8, p) + 4;
    while (p + 10 <= end) {
      var id = ascii(u8, p, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      var size = ver === 4 ? syncsafe(u8, p + 4) : be32(u8, p + 4);
      var body = p + 10;
      if (id === 'APIC' && size > 32) {
        var q = body + 1;
        while (q < end && u8[q] !== 0) q++;            // mime
        var mime = ascii(u8, body + 1, q - body - 1);
        q += 2;                                         // 0 + picture type
        var enc = u8[body];
        if (enc === 1 || enc === 2) {                   // UTF-16 描述
          while (q + 1 < end && !(u8[q] === 0 && u8[q + 1] === 0)) q++;
          q += 2;
        } else {
          while (q < end && u8[q] !== 0) q++;
          q += 1;
        }
        return { start: q, len: body + size - q, mime: mime };
      }
      p = body + size;
      if (!(size > 0)) break;
    }
    return null;
  }

  function flacPic(u8) {
    var p = 4;
    while (p + 4 <= u8.length) {
      var type = u8[p] & 0x7f;
      var last = (u8[p] & 0x80) !== 0;
      var len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
      if (type === 6) {
        var b = p + 4;
        var mimeLen = be32(u8, b + 4);
        var mime = ascii(u8, b + 8, mimeLen);
        var q = b + 8 + mimeLen;
        var descLen = be32(u8, q);
        q += 4 + descLen + 16;
        var dataLen = be32(u8, q);
        return { start: q + 4, len: dataLen, mime: mime };
      }
      p += 4 + len;
      if (last) break;
    }
    return null;
  }

  function mp4Pic(u8) {
    function find(needle, from, to) {
      var n = needle.length;
      for (var i = from; i + n <= to; i++) {
        var ok = true;
        for (var j = 0; j < n; j++) {
          if (u8[i + j] !== needle.charCodeAt(j)) { ok = false; break; }
        }
        if (ok) return i;
      }
      return -1;
    }
    var covr = find('covr', 0, Math.min(u8.length, 3 << 20));
    if (covr < 0) return null;
    var data = find('data', covr + 4, Math.min(u8.length, covr + 96));
    if (data < 0) return null;
    var atomLen = be32(u8, data - 4);
    return { start: data + 12, len: Math.max(0, atomLen - 16), mime: 'image/jpeg' };
  }

  /** blob → 最长边 360 的 JPEG data URL */
  function shrinkCover(blob) {
    return new Promise(function (res) {
      var url;
      try { url = URL.createObjectURL(blob); } catch (e) { res(''); return; }
      var img = new Image();
      var done = false;
      function fin(v) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        res(v || '');
      }
      img.onload = function () {
        try {
          var nw = img.naturalWidth || img.width;
          var nh = img.naturalHeight || img.height;
          if (!nw || !nh) { fin(''); return; }
          var scale = Math.min(1, 360 / Math.max(nw, nh));
          var w = Math.max(1, Math.round(nw * scale));
          var h = Math.max(1, Math.round(nh * scale));
          var c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0, w, h);
          fin(c.toDataURL('image/jpeg', 0.82));
        } catch (e) { fin(''); }
      };
      img.onerror = function () { fin(''); };
      img.src = url;
    });
  }

  async function coverFromFile(file) {
    if (!file || !file.size) return '';
    var u8;
    try {
      u8 = new Uint8Array(await file.slice(0, Math.min(file.size, 2 << 20)).arrayBuffer());
    } catch (e) { return ''; }
    if (u8.length < 16) return '';
    var hit = null;
    if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) hit = id3Pic(u8);
    else if (ascii(u8, 0, 4) === 'fLaC') hit = flacPic(u8);
    else if (ascii(u8, 4, 4) === 'ftyp') hit = mp4Pic(u8);
    if (!hit) {
      hit = mp4Pic(u8) || id3Pic(u8) || flacPic(u8);
    }
    if (!hit || !(hit.len > 64) || hit.start + hit.len > u8.length) return '';
    var mime = /^image\//.test(hit.mime || '') ? hit.mime : 'image/jpeg';
    try {
      return await shrinkCover(new Blob([u8.subarray(hit.start, hit.start + hit.len)], { type: mime }));
    } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------ *
   * blob URL 缓存（播放用）
   * ------------------------------------------------------------------ */
  var urlCache = new Map();
  function dropUrl(id) {
    var u = urlCache.get(id);
    if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* 忽略 */ } urlCache.delete(id); }
  }

  /* ------------------------------------------------------------------ *
   * 歌词
   * ------------------------------------------------------------------ */
  /** YRC 行是 [毫秒,时长](字起点,字时长,0)字；LRC 是 [mm:ss.xx] */
  function lyricFormat(text) {
    if (/^[ \t]*\[\d{5,},\d+\]/m.test(text)) return 'yrc';
    if (/^[ \t]*\[\d{1,3}:\d{1,2}/m.test(text)) return 'lrc';
    return 'lrc';
  }

  function readText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || '')); };
      r.onerror = function () { rej(r.error || new Error('歌词读取失败')); };
      r.readAsText(file, 'utf-8');
    });
  }

  /* ------------------------------------------------------------------ *
   * 对外 API
   * ------------------------------------------------------------------ */
  async function addFile(file) {
    if (!file) throw new Error('没有文件');
    if (file.size && file.size > 300 * 1024 * 1024) {
      throw new Error('单个文件超过 300 MB，浏览器存储放不下');
    }
    if (await isEmpty()) throw new Error('本机存储快满了，先删掉几首再导入');
    var id = uid();
    var meta = metaFromName(file.name);
    var probe = await Promise.all([probeDuration(file), coverFromFile(file)]);
    var rec = {
      id: id,
      source: 'local',
      kind: 'local',
      name: meta.name,
      artists: meta.artists,
      album: '本地文件',
      fileName: file.name || '',
      mime: file.type || '',
      size: file.size || 0,
      duration: probe[0] || 0,
      cover: probe[1] || '',
      hasLrc: false,
      hasYrc: false,
      lyricName: '',
      createdAt: Date.now(),
    };
    await run(S_AUDIO, 'readwrite', function (s) {
      return s.put({ id: id, blob: file, mime: rec.mime });
    });
    try {
      await run(S_TRACK, 'readwrite', function (s) { return s.put(rec); });
    } catch (e) {
      /* 音频写进去了但曲目没写：回滚，别留孤儿 Blob 占空间 */
      try { await run(S_AUDIO, 'readwrite', function (s) { return s.delete(id); }); } catch (e2) { /* 忽略 */ }
      throw e;
    }
    dropUrl(id);
    emit();
    return rec;
  }

  /** 扫描导入：只写曲目记录（路径引用），不写 audio store，也不碰原文件。
      ref = { path, name, artists, album, duration, size, mime, fileName, folder }
      播放时由 urlOf() 转成 /api/local-file；封面留空，界面走占位图。 */
  async function addRef(ref) {
    if (!ref || !ref.path) throw new Error('没有文件路径');
    var pathStr = String(ref.path);
    var fileName = String(ref.fileName || pathStr.split(/[\\/]/).pop() || '');
    var meta = metaFromName(fileName);
    var rec = {
      id: uid(),
      source: 'local',
      kind: 'local',
      name: ref.name || meta.name,
      artists: ref.artists || meta.artists,
      album: ref.album || '手机导入',
      fileName: fileName,
      mime: ref.mime || '',
      size: Number(ref.size) || 0,
      duration: Number(ref.duration) || 0,
      cover: '',
      path: pathStr,
      folder: ref.folder || '',
      ref: true,
      hasLrc: false,
      hasYrc: false,
      lyricName: '',
      createdAt: Date.now(),
    };
    await run(S_TRACK, 'readwrite', function (s) { return s.put(rec); });
    dropUrl(rec.id);
    emit();
    return rec;
  }

  async function list() {
    var rows = await run(S_TRACK, 'readonly', function (s) { return s.getAll(); });
    return (rows || []).slice().sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  async function get(id) {
    var row = await run(S_TRACK, 'readonly', function (s) { return s.get(id); });
    return row || null;
  }

  async function count() {
    try { return await run(S_TRACK, 'readonly', function (s) { return s.count(); }); }
    catch (e) { return 0; }
  }

  /** 播放地址：路径引用的曲目回 /api/local-file，其余走 blob URL（按 id 缓存）。
      文件被删后调用会拿到 null。 */
  async function urlOf(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    var t = null;
    try { t = await run(S_TRACK, 'readonly', function (s) { return s.get(id); }); }
    catch (e) { t = null; }
    if (t && t.path) {
      return '/api/local-file?path=' + encodeURIComponent(String(t.path));
    }
    var row = await run(S_AUDIO, 'readonly', function (s) { return s.get(id); });
    if (!row || !row.blob) return null;
    var u = URL.createObjectURL(row.blob);
    urlCache.set(id, u);
    return u;
  }

  async function lyricOf(id) {
    var row = await run(S_LYRIC, 'readonly', function (s) { return s.get(id); });
    if (!row || !row.text) return null;
    return { text: row.text, format: row.format || lyricFormat(row.text), name: row.name || '' };
  }

  async function setLyricFile(id, file) {
    if (!file) throw new Error('没有歌词文件');
    var text = await readText(file);
    if (!text.trim()) throw new Error('歌词文件是空的');
    var fmt = lyricFormat(text);
    await run(S_LYRIC, 'readwrite', function (s) {
      return s.put({ id: id, text: text, format: fmt, name: file.name || '', addedAt: Date.now() });
    });
    var t = await get(id);
    if (t) {
      t.hasYrc = fmt === 'yrc';
      t.hasLrc = fmt === 'lrc';
      t.lyricName = file.name || '';
      await run(S_TRACK, 'readwrite', function (s) { return s.put(t); });
    }
    emit();
    return { format: fmt, name: file.name || '' };
  }

  /** 给已有曲目单独换封面（2026-11-16）。
      和导入时抠封面同一套：shrinkCover 缩到最长边 360px 的 JPEG data URL，
      写回曲目的 cover 字段（字段本来就存在，不升 IndexedDB 版本）。
      图片读不出来 / 解码失败直接抛错，调用方把文件名报给用户。 */
  async function setCoverFile(id, file) {
    if (!file) throw new Error('没有封面图片');
    if (!/^image\/(jpeg|png|webp)$/.test(file.type || '') &&
        !/\.(jpe?g|png|webp)$/i.test(file.name || '')) {
      throw new Error('不是图片文件');
    }
    var cover = await shrinkCover(file);
    if (!cover) throw new Error('这张图读不出来，换一张试试');
    var t = await get(id);
    if (!t) throw new Error('没有找到这首歌');
    t.cover = cover;
    await run(S_TRACK, 'readwrite', function (s) { return s.put(t); });
    emit();
    return { cover: cover };
  }

  async function remove(id) {
    if (!id) return false;
    var t = null;
    try { t = await get(id); } catch (e) { t = null; }
    await run(S_TRACK, 'readwrite', function (s) { return s.delete(id); });
    /* 路径引用的曲目没有 audio 记录；就算有也别动，原文件更不会删 */
    if (!t || !t.ref) {
      try { await run(S_AUDIO, 'readwrite', function (s) { return s.delete(id); }); } catch (e) { /* 音频删不掉也不影响曲目 */ }
    }
    try { await run(S_LYRIC, 'readwrite', function (s) { return s.delete(id); }); } catch (e) { /* 没有歌词 */ }
    dropUrl(id);
    emit();
    return true;
  }

  /** 本地搜索：歌名 / 歌手 / 文件名，空关键词返回全部 */
  async function search(q) {
    var kw = String(q == null ? '' : q).trim().toLowerCase();
    var rows = await list();
    if (!kw) return rows;
    return rows.filter(function (t) {
      return (String(t.name || '') + ' ' + String(t.artists || '') + ' ' + String(t.fileName || ''))
        .toLowerCase().indexOf(kw) >= 0;
    });
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  window.LIZI_LOCAL = {
    addFile: addFile,
    addRef: addRef,
    list: list,
    get: get,
    count: count,
    remove: remove,
    urlOf: urlOf,
    lyricOf: lyricOf,
    setLyricFile: setLyricFile,
    setCoverFile: setCoverFile,
    search: search,
    onChange: onChange,
    uid: uid,
    metaFromName: metaFromName,
    isAudio: function (file) {
      return !!file && (AUDIO_EXT.test(file.name || '') || /^audio\//.test(file.type || ''));
    },
  };
})();

/* ============================================================================
   we-bg-pick.js —— 给已有「自定义背景（media）」的形态补一个 Wallpaper Engine 图集
   ----------------------------------------------------------------------------
   504 / 520 用的是 assets/custom-bg.js（自带 bg / scrim / bgpick）。
   519 / 629 / 631 / 672 / 679 / 681 的背景系统是宿主 type:'media' 上传项，只收本地图片/视频；
   这里只往 __stagePanel 里补一个 gallery 项，选完由宿主写回形态自己的
   <key> / <key>Kind / <key>Crop，并额外打开该形态的「自定义背景」开关。
   不碰形态原有渲染，不改宿主协议。

   时序（2026-11-23 修）：
   宿主只在 stage:ready / 打开设置面板时深拷贝一次 __stagePanel，之前这里是
   fetch 回来后才 push —— 壁纸库扫描稍慢（真机上千个 workshop 目录）或用户在
   扫描完成前点开设置，图集就根本不出现，而且已经打开的面板不会自己再读一次。
   现在脚本执行时先挂一个「当前壁纸」项，保证六个形态的设置里始终有
   「Wallpaper Engine 壁纸」这一行；列表回来后再替换 items，并且如果面板正开着，
   用宿主自己的开合按钮触发一次重读（等价于用户关掉再打开，不写宿主数据）。

   宿主 gallery 点击后只改 data、不重绘 UI（开关 / 下拉 / 媒体状态会停在旧值），
   这里在收到回推的设置时把对应行的可见控件同步一下；宿主的正确修法是
   gallery 点击末尾 render() 一次（见交接报告里的 patch）。

   依赖宿主 app.js 里 gallery 项的 apply / onSelect 支持（同一批改动）。
   手机没有 Wallpaper Engine：__liziAndroid 直接不挂这一项。
   ========================================================================== */
(function () {
  'use strict';

  if (window.__liziAndroid) return;
  if (window.LIZI_WE_BG) return;

  /* 每个形态自己的 media 键；extra 是「选了壁纸之后要把哪个开关/档位打开」 */
  var MAP = {
    '519': { key: 'bgImage', kindKey: 'bgImageKind', cropKey: 'bgImageCrop', extra: { bgSource: 'custom' } },
    '629': { key: 'wallImg', kindKey: 'wallImgKind', cropKey: 'wallImgCrop', extra: { bgMode: 'full' } },
    '631': { key: 'bgImg', kindKey: 'bgImgKind', cropKey: 'bgImgCrop', extra: { bgOn: true } },
    '672': { key: 'bgImg', kindKey: 'bgImgKind', cropKey: 'bgImgCrop', extra: { customBg: true } },
    /* 679 / 681 没有独立开关：applyCustomBg 看到 bgImg 非空就把 body.has-bg 打开 */
    '679': { key: 'bgImg', kindKey: 'bgImgKind', cropKey: 'bgImgCrop' },
    '681': { key: 'bgImg', kindKey: 'bgImgKind', cropKey: 'bgImgCrop' }
  };

  function stageId() {
    try {
      if (window.LIZI_STAGE_ID != null && String(window.LIZI_STAGE_ID).trim()) {
        return String(window.LIZI_STAGE_ID).trim();
      }
      var p = String(location.pathname || '').split('/').pop() || '';
      var m = p.match(/^(\d{2,4})/);
      if (m) return m[1];
      m = String(document.title || '').match(/^(\d{2,4})/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  var cfg = MAP[stageId()];
  if (!cfg) return;

  function enc(s) { return encodeURIComponent(String(s)); }

  /* 同步占位项：列表回来之前也能选「当前壁纸」，并且保证设置里一定有这一行。
     缩略图走 /api/wallpaper/thumb：视频预览（mp4）不能塞进 <img>，接口会
     在有封面图时发封面、没有时发占位图，不再出现破图。 */
  var CURRENT_ITEM = {
    v: '/api/wallpaper/preview',
    t: '当前 Wallpaper Engine 壁纸',
    thumb: '/api/wallpaper/thumb',
    kind: 'image'
  };

  var gallery = {
    key: 'weBg',
    label: 'Wallpaper Engine 壁纸',
    type: 'gallery',
    def: '',
    apply: cfg,
    items: [CURRENT_ITEM]
  };

  /* ---- 宿主面板：挂项 / 重读 / 可见控件同步 ---- */
  function hostDoc() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) return window.parent.document;
    } catch (e) { /* 用户自制形态是不透明源 */ }
    return null;
  }

  function addItem() {
    var p = window.__stagePanel;
    if (!p || !Array.isArray(p.items)) return false;
    if (p.items.some(function (it) { return it && it.key === 'weBg'; })) return true;
    p.items.push(gallery);
    return true;
  }

  /* 形态可能晚于本脚本定义 __stagePanel：有限次轮询，不无限跑。 */
  var tries = 0;
  function ensureItem() {
    if (addItem()) return;
    if (++tries > 100) return;
    setTimeout(ensureItem, 50);
  }

  /* 列表回来时面板可能正开着：宿主只在打开面板时 refreshSpec，不会自己重读。
     用宿主自己的设置按钮关→开一次，让它按新 items 重画（不碰它的数据）。 */
  function refreshHostPanel() {
    var doc = hostDoc();
    if (!doc) return;
    var box = doc.getElementById('stage-settings');
    if (!box || !box.classList.contains('is-open')) return;
    /* 用户正在四角取景编辑器里：别把面板关掉 */
    if (doc.querySelector('.spnl-crop')) return;
    var gal = doc.querySelector('#spnl-body .spnl__gal');
    /* 已经有真实卡片（不是只剩占位/空行）就不用折腾 */
    if (gal && gal.querySelectorAll('.spnl__galcard').length > 1) return;
    var btn = doc.getElementById('stage-settings-btn');
    if (!btn || btn.hidden) return;
    btn.click();
    setTimeout(function () { if (!btn.hidden) btn.click(); }, 60);
  }

  function specItem(key) {
    var p = window.__stagePanel;
    var list = (p && Array.isArray(p.items)) ? p.items : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === key) return list[i];
    }
    return null;
  }

  /* 宿主 gallery 点击只改 data + push，不更新按钮/开关的可见状态。
     这里按 label 找到对应行，把 switch / select / segment 的显示同步成新值；
     宿主改成点击后 render() 之后这段就是无害的兜底。 */
  function syncHostControl(key, value) {
    var doc = hostDoc();
    var item = specItem(key);
    if (!doc || !item) return;
    var label = item.label || key;
    var rows = doc.querySelectorAll('#spnl-body .spnl__row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var nameEl = row.querySelector('.spnl__lab span');
      if (!nameEl || nameEl.textContent !== label) continue;

      var sw = row.querySelector('.spnl__sw');
      if (sw) sw.setAttribute('aria-checked', String(!!value));

      var options = Array.isArray(item.options) ? item.options : null;
      if (!options) return;

      var pickLab = row.querySelector('.spnl__picklab');
      if (pickLab) {
        for (var j = 0; j < options.length; j++) {
          if (String(options[j].v) === String(value)) pickLab.textContent = options[j].t;
        }
        var opts = row.querySelectorAll('.spnl__pickopt');
        for (var k = 0; k < opts.length && k < options.length; k++) {
          var on = String(options[k].v) === String(value);
          opts[k].classList.toggle('is-on', on);
          opts[k].setAttribute('aria-selected', on ? 'true' : 'false');
        }
      }

      var segBtns = row.querySelectorAll('.spnl__seg button');
      if (segBtns.length) {
        for (var n = 0; n < segBtns.length && n < options.length; n++) {
          segBtns[n].classList.toggle('is-on', String(options[n].v) === String(value));
        }
      }
      return;
    }
  }

  /* 宿主 media 上传项在 gallery 选中后同样不会刷新自己的状态文本，
     会一直显示「未上传（使用内置默认）」。按当前值把可见状态补上。 */
  function syncHostMedia(key, value) {
    var doc = hostDoc();
    var item = specItem(key);
    if (!doc || !item) return;
    var label = item.label || key;
    var rows = doc.querySelectorAll('#spnl-body .spnl__row');
    for (var i = 0; i < rows.length; i++) {
      var nameEl = rows[i].querySelector('.spnl__lab span');
      if (!nameEl || nameEl.textContent !== label) continue;
      var has = typeof value === 'string' && value.length > 0;
      var st = rows[i].querySelector('.spnl__mediast');
      if (st) {
        st.classList.remove('is-busy');
        st.textContent = has ? '已设自定义壁纸' : '未上传（使用内置默认）';
      }
      var up = rows[i].querySelector('.spnl__mediabtn');
      if (up) up.textContent = has ? '更换'
        : (item.accept === 'image' ? '选择图片' : item.accept === 'video' ? '选择视频' : '选择图片/视频');
      var clr = rows[i].querySelector('.spnl__mediaclr');
      if (clr) clr.disabled = !has;
      var adj = rows[i].querySelector('.spnl__mediaadj');
      if (adj) adj.disabled = !has;
      return;
    }
  }

  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.__c100 !== 1 || d.type !== 'setting' || !d.payload) return;
    var k = d.payload.key;
    if (k === cfg.key) syncHostMedia(k, d.payload.value);
    if (cfg.extra && Object.prototype.hasOwnProperty.call(cfg.extra, k)) {
      syncHostControl(k, d.payload.value);
    }
  }, false);

  /* 先把占位图集挂上：脚本在形态主体之后执行，此时 __stagePanel 已经声明，
     通常一次就成功；万一形态把声明挪得更晚，ensureItem 会继续重试。 */
  addItem();
  ensureItem();

  if (typeof fetch !== 'function') return;

  /* 「当前壁纸」的类型探测和列表扫描并行：列表可能要扫上千个目录，
     不该让当前壁纸的视频/图片判断排在它后面。 */
  var currentP = fetch('/api/wallpaper', { cache: 'no-store', credentials: 'same-origin' })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .catch(function () { return null; });
  currentP.then(function (cur) {
    if (!cur || !cur.ok || String(cur.kind) !== 'video') return;
    /* 列表还没回来时先把同步占位项改成视频，用户马上点「当前壁纸」也是对的 */
    if (gallery.items && gallery.items[0] && gallery.items[0].v === '/api/wallpaper/preview') {
      gallery.items[0].v = '/api/wallpaper/media';
      gallery.items[0].kind = 'video';
      refreshHostPanel();
    }
  });

  fetch('/api/wallpaper/list', { cache: 'no-store', credentials: 'same-origin' })
    .then(function (r) {
      if (!r || !r.ok) throw new Error('list');
      return r.json();
    })
    .then(function (d) {
      if (!d || !d.ok || !Array.isArray(d.items)) throw new Error('list');
      return currentP.then(function (cur) {
        var out = [];
        var ck = cur && cur.ok && String(cur.kind) === 'video' ? 'video' : 'image';
        out.push({
          v: ck === 'video' ? '/api/wallpaper/media' : '/api/wallpaper/preview',
          t: '当前 Wallpaper Engine 壁纸',
          thumb: '/api/wallpaper/thumb',
          kind: ck
        });
        for (var i = 0; i < d.items.length; i++) {
          var it = d.items[i];
          if (!it || it.id == null) continue;
          /* kind:none = 扫描不到正片也没有预览，选了只会得到 404 */
          if (String(it.kind || '') === 'none') continue;
          var k = String(it.kind || 'image') === 'video' ? 'video' : 'image';
          out.push({
            v: '/api/wallpaper/' + (k === 'video' ? 'media' : 'preview') + '?id=' + enc(it.id),
            t: String(it.title || it.id),
            thumb: '/api/wallpaper/thumb?id=' + enc(it.id),
            kind: k
          });
        }
        var before = gallery.items.length;
        gallery.items = out;
        addItem();
        /* 列表是空库时数量没变，不必让面板闪一下 */
        if (out.length !== before) refreshHostPanel();
      });
    })
    .catch(function () {
      /* 没装 WE / 接口没开：保留同步占位项（当前壁纸），形态保持原样 */
    });

  window.LIZI_WE_BG = { gallery: gallery };
})();

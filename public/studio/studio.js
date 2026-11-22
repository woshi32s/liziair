/**
 * AI 自定义工坊（2026-11-15）
 * ---------------------------------------------------------------------------
 * 目的：让不会写代码的用户用网页版 AI 做一个自己的「形态」。
 *
 * 流程：复制提示词 → 丢给任意网页 AI → 把返回的整段 HTML 粘回来 →
 *       本地校验 + 沙箱预览（示例歌词）→ 起个名字保存 → 我的形态列表。
 *
 * 三条硬约束（改代码前先读）：
 *  1) 用户代码是**不可信代码**。预览和正式播放都放在 sandbox="allow-scripts"
 *     的 iframe 里（不透明源，**绝不能加 allow-same-origin**），并且注入 CSP。
 *     CSP 继续禁止一切外链脚本 / 样式 / 字体和全部网络连接（connect-src none），
 *     只有 <img> 图片放行。不透明源本身让 localStorage / cookie 不可用，
 *     所以注入了一段内存版存储 shim（刷新即清空，不持久化），
 *     让 AI 写的 localStorage 代码不会一碰就抛异常。
 *  2) 注入一段错误 / CSP 违规转发脚本：沙箱里的 window.onerror、
 *     unhandledrejection、securitypolicyviolation 统一 postMessage 给宿主。
 *     非技术用户拿到报错代码是没法自救的，「复制自检报告」是他唯一
 *     能拿回去让 AI 改的东西。
 *  3) 形态的通信协议和内置形态完全一致（见 app.js StageHost 的 init/tick/beat/live/kick），
 *     所以用户做的东西和内置形态在同一个 iframe 里跑，宿主不需要第二套逻辑。
 *
 * 存储：IndexedDB `lizi-studio` / store `stages`，一条记录一个形态
 *      { id, name, html, at }。和本地音乐的库（lizi-local）分开，互不影响。
 */

window.LIZI_STUDIO = (() => {
  const DB_NAME = 'lizi-studio';
  const DB_VER = 1;
  const STORE = 'stages';

  /* 单个形态的大小上限（2026-11-17：400KB → 1MB → 6MB）。内置形态基本都在
     100KB 以内；three.js 一个压缩包就 669KB，AI 再内联点库、字体、贴图很容易
     顶到 1MB。6MB 仍远小于浏览器对 srcdoc 的容忍度，而且宿主注入的 three
     （见 THREE_URL）不占用户的这 6MB 额度。
     注意：这里的判据是字符串长度（字符数），不是 UTF-8 字节数；和 check()
     的提示保持一致。 */
  const MAX_BYTES = 6 * 1024 * 1024;

  /* three.js 资源（2026-11-17）：和内置形态用的是同一份 r160 压缩包。
     为什么由宿主注入而不是让 AI 内联：沙箱 CSP 禁止一切外链，用户也不能把
     669KB 的 three 塞进 1MB 的 HTML（塞了就没地方写效果了）。宿主取一次、
     缓存成字符串，再内联进每个预览/播放沙箱 —— 对 CSP 来说是同源内联脚本，
     script-src 'unsafe-inline' 本来就放行，CSP 一个字都不用改。
     路径用绝对路径：手机页有 <base href="/">，相对路径会指错地方。 */
  const THREE_URL = '/stages/assets/508-three.min.js';
  const THREE_ADDONS_URL = '/stages/assets/508-three-addons.js';

  /* 懒加载缓存：'' = 还没取到；threeLoad = 进行中的那次请求，避免并发重复取。 */
  let threeSrc = '';
  let threeAddonsSrc = '';
  let threeLoad = null;

  /* ------------------------------------------------------------------ *
   * 提示词
   * ------------------------------------------------------------------ *
   * 这段文字就是用户复制走的东西，等于我们的公开 API 文档。
   * 改动时注意：里面写死的限制必须和下面的 check()、buildSrcdoc() 一致 ——
   * 提示词里允许、校验器却拒绝，用户会卡住；反过来则会出现"能保存但跑不起来"。
   */
  const PROMPT = [
    "你现在要为一个叫 LIZI 的本地音乐播放器做一个「自定义播放形态」。",
    "它本质上是一个全屏网页：跟着音乐进度实时演出歌词。",
    "",
    "请只输出一个完整的 HTML 文件，不要写任何解释文字。",
    "",
    "==== 硬性规则（违反任意一条都会跑不起来）====",
    "1. 单个 HTML 文件。资源可以内联；也可以尝试 https 外链，以沙箱实际放行为准 ——",
    "   被拦时检测报告会给出 CSP 违规，改成内联即可。整个文件不超过 6MB（6144KB）。",
    "   图片可以用 <img src=\"...\"> 加载。",
    "2. 页面运行在 sandbox iframe 里，是「不透明源」，和宿主不同源：",
    "   - 读不到父页面的 DOM / 变量，唯一通信方式是 postMessage",
    "   - localStorage / sessionStorage 是内存模拟：能用，但刷新就清空，不持久化",
    "   - document.cookie 固定为空；IndexedDB 不可用",
    "   - fetch / XMLHttpRequest / WebSocket 会被 CSP 拦掉；按「不可用」设计",
    "   - data:、blob: 图片可以用；脚本和样式请直接内联",
    "   - 宿主读不到 window.__stagePanel，用户自制形态没有设置面板，也不会收到 setting 消息",
    "3. 歌词时间只能来自消息里的 time 字段。不要用 Date.now()、setInterval 自己数拍子，",
    "   那样迟早和音频对不上。requestAnimationFrame 只负责渲染，不负责计时。",
    "4. 画布铺满窗口并跟随窗口尺寸变化；手机竖屏、横屏、桌面都要能看。",
    "5. 加载完成后必须给父页面发一条 ready 消息，见下面协议。",
    "",
    "==== 环境能力（客观事实）====",
    "- window.THREE 已经预置：three.js r160（UMD，挂全局 THREE），直接 new THREE.Scene() 可用。",
    "  不要再从 CDN 或内联引一份 three，多份 three 会互相打架。",
    "- window.THREEAddons 预置：RoomEnvironment、FontLoader、Font、TextGeometry。",
    "- 没有 OrbitControls，没有任何后处理（EffectComposer / UnrealBloomPass / SSAO / 景深都没有）。",
    "  相机运动自己算 position / lookAt；泛光、发光自己用加法混合、贴图或 shader 实现。",
    "- 还可以用：原生 WebGL shader、Canvas 2D、CSS 3D、SVG，以及任何能内联进来的库。",
    "",
    "==== 通信协议 ====",
    "父页面发来的消息都带 { __c100: 1 }。",
    "",
    "init —— 切歌或歌词到位时发一次：",
    "  { __c100:1, type:\"init\", payload:{",
    "      song:{ id, name, artists, album, cover }, // cover 是图片地址；没有歌时 song 可能为 null",
    "      accent:[r,g,b],                           // 从封面取的主色",
    "      duration: 秒,",
    "      lines:[ { t:秒, dur:秒, text:\"这一句的歌词\", chars:null } ]",
    "  } }",
    "  lines 已按时间排好；chars 通常为 null，偶尔是 [{c:\"字\",t:秒}] 的逐字时间。",
    "",
    "tick —— 大约每 66 毫秒一次：",
    "  { __c100:1, type:\"tick\", payload:{ time: 当前播放到第几秒, playing: 是否在播 } }",
    "",
    "beat —— 每拍一次：{ __c100:1, type:\"beat\", payload:{ index, level } }，level 是 0~1 的强度。",
    "kick —— 低频瞬态，可能比 beat 更密：{ __c100:1, type:\"kick\", payload:{ level, energy, bpm } }。",
    "live —— 约每 120 毫秒一次：",
    "  { __c100:1, type:\"live\", payload:{ bpm, level, bass, mid, treble, playing } }，",
    "  除 bpm 外都是 0~1（bpm 是数值，如 120）。",
    "",
    "必须回给父页面（页面加载完成后发一次）：",
    "  parent.postMessage({ __c100:1, type:\"ready\" }, \"*\");",
    "ready 可以带 { camera:true } 表示画面要拖动转头；普通形态不带 payload。",
    "",
    "==== 性能指标（技术约束）====",
    "- 目标：桌面 60fps，手机 30fps；一帧 JS 不超过 8ms。",
    "- devicePixelRatio 封顶 2；手机可以降到 1.5。",
    "- 粒子 ≤ 20000（手机 ≤ 6000）；三角面 ≤ 15 万（手机 ≤ 5 万）；draw call ≤ 100。",
    "- 粒子用 THREE.Points / InstancedMesh，别一个粒子一个 Mesh。",
    "- 不要在每帧里 new 对象、改材质、重建几何；纹理只生成一次。",
    "- 用 matchMedia(\"(max-width: 700px)\") 或屏幕宽度判断低配，自动减量。",
    "",
    "==== 可读性（功能要求，不是风格要求）====",
    "- 歌词在任意背景上都要读得清；竖屏和横屏都要能完整显示，不许溢出屏幕。",
    "- 中文字体只用系统字体栈或内联字体，不要依赖外部字体。",
    "",
    "==== 风格 ====",
    "效果、配色、字体、构图、动效全部由你决定，这里不规定风格。",
    "",
    "==== 最小可跑骨架（Canvas 2D）====",
    "照抄能跑通协议，但背景、字体、布局都要换成你自己的设计。",
    "<!DOCTYPE html>",
    "<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
    "<style>",
    "html,body{margin:0;height:100%;overflow:hidden;background:/* 自己定 */;}",
    "canvas{position:fixed;inset:0;width:100%;height:100%;display:block}",
    "#lyric{/* 自己定：字号、字体、颜色、位置、描边或阴影 */}",
    "</style></head><body>",
    "<canvas id=\"c\"></canvas>",
    "<div id=\"lyric\"></div>",
    "<script>",
    "var cv = document.getElementById(\"c\"), ctx = cv.getContext(\"2d\");",
    "var lyric = document.getElementById(\"lyric\");",
    "var lines = [], idx = -1, time = 0, playing = false, accent = [150,165,255];",
    "var pulse = 0, bass = 0, mid = 0, treble = 0;",
    "function resize() {",
    "  var dpr = Math.min(2, window.devicePixelRatio || 1);",
    "  cv.width = Math.round(innerWidth * dpr);",
    "  cv.height = Math.round(innerHeight * dpr);",
    "  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);",
    "}",
    "addEventListener(\"resize\", resize);",
    "function lineAt(t) {",
    "  for (var i = lines.length - 1; i >= 0; i--) if (t >= lines[i].t) return i;",
    "  return -1;",
    "}",
    "addEventListener(\"message\", function (e) {",
    "  var d = e.data;",
    "  if (!d || d.__c100 !== 1) return;",
    "  var p = d.payload || {};",
    "  if (d.type === \"init\") {",
    "    lines = (p.lines || []).slice().sort(function (a, b) { return a.t - b.t; });",
    "    if (p.accent) accent = p.accent;",
    "    idx = -1;",
    "  } else if (d.type === \"tick\") {",
    "    time = p.time || 0;",
    "    playing = !!p.playing;",
    "  } else if (d.type === \"beat\") {",
    "    pulse = Math.max(pulse, p.level || 0.5);",
    "  } else if (d.type === \"kick\") {",
    "    pulse = Math.max(pulse, p.level || 0.5);",
    "  } else if (d.type === \"live\") {",
    "    bass = p.bass || 0; mid = p.mid || 0; treble = p.treble || 0;",
    "  }",
    "});",
    "parent.postMessage({ __c100:1, type:\"ready\" }, \"*\");",
    "function frame() {",
    "  var i = lineAt(time);",
    "  if (i !== idx) {",
    "    idx = i;",
    "    lyric.textContent = i >= 0 && lines[i] ? lines[i].text : \"\";",
    "  }",
    "  pulse *= 0.9;",
    "  /* 在这里画你自己的画面：time 是唯一时间源，pulse / bass / mid / treble 已更新。 */",
    "  ctx.clearRect(0, 0, innerWidth, innerHeight);",
    "  requestAnimationFrame(frame);",
    "}",
    "resize();",
    "requestAnimationFrame(frame);",
    "</script></body></html>",
    "",
    "==== 输出 ====",
    "只输出一个 ```html 代码块，从 <!DOCTYPE html> 开始，到 </html> 结束。",
    "不要在代码块前后写任何解释。",
  ].join('\n');

  /* 示例歌词：只用于工坊里的预览，不是真在播。
     故意混了长句和短句，用户一眼就能看出自己的形态能不能处理换行。 */
  const MOCK_LINES = [
    '月亮爬上山坡',
    '风把云一点点吹开',
    '我们站在这里',
    '听一首很慢很慢的歌',
    '灯一盏一盏亮起来',
    '远处的车流像不睡的河',
    '把影子拉长又收回去',
    '这一句比别的都长一些，用来看看你的形态会不会把字挤出屏幕',
    '快听完了',
    '最后一句唱完就结束',
  ];

  /* ------------------------------------------------------------------ *
   * 存储
   * ------------------------------------------------------------------ */
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('打不开本地形态库'));
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      try { out = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('本地形态库操作被中止'));
    }));
  }

  const listStages = () => tx('readonly', (s) => s.getAll())
    .then((rows) => (Array.isArray(rows) ? rows.sort((a, b) => (b.at || 0) - (a.at || 0)) : []))
    .catch(() => []);

  const putStage = (rec) => tx('readwrite', (s) => s.put(rec));
  const delStage = (id) => tx('readwrite', (s) => s.delete(id));

  /* ------------------------------------------------------------------ *
   * 校验：能提前发现的错，就别让用户到播放页才发现
   * ------------------------------------------------------------------ */
  function check(html) {
    const src = String(html || '');
    const problems = [];
    if (!src.trim()) return ['还没粘东西进来'];
    if (src.length > MAX_BYTES) {
      problems.push(`太大了（${Math.round(src.length / 1024)}KB，上限 ${MAX_BYTES / 1024}KB / 6MB）。让 AI 少用点粒子、把注释和没用的库删掉再来`);
    }
    if (!/<html[\s>]/i.test(src) && !/<!doctype/i.test(src)) {
      problems.push('这不像一个完整的 HTML 文件：要 AI 从 <!DOCTYPE html> 开始整段给出来');
    }
    if (!/<script[\s>]/i.test(src)) {
      problems.push('没找到 <script>，这段代码不会动');
    }
    /* 2026-11-17：外链不再是错误。https 资源沙箱放行；http 会被 CSP 拦，
       但不拦保存 —— 只放在下面的 warn() 里提示。 */
    return problems;
  }

  /** 非阻断提示：check() 通过后仍值得告诉用户的事（外链能不能活 / 要不要联网） */
  function warn(html) {
    const src = String(html || '');
    const out = [];
    /* 图片是唯一被 CSP 放行的外部资源；脚本、样式、字体、连接一律会被拦 */
    if (/<script[^>]+src\s*=/i.test(src) || /<link[^>]+href\s*=\s*["']?https?:/i.test(src)
      || /@import\s+url\(\s*["']?https?:/i.test(src) || /@font-face[^}]*url\(\s*["']?https?:/i.test(src)) {
      out.push('里面有外部脚本 / 样式 / 字体。沙箱只允许内联，这些会被拦掉，让 AI 改成内联');
    }
    if (/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(src) || /new\s+WebSocket\s*\(/.test(src)) {
      out.push('里面有 fetch / XHR / WebSocket，沙箱断网（connect-src none），会被拦掉');
    }
    if (/(?:src|poster)\s*=\s*["']?https?:\/\//i.test(src) || /url\(\s*["']?https?:\/\//i.test(src)) {
      out.push('这个形态需要联网：用到外部图片，断网时会缺图');
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * three.js 懒加载（2026-11-17）
   * ------------------------------------------------------------------ *
   * 只在第一次需要时取，成功后整个会话同步复用。buildSrcdoc 是同步的、
   * 还被宿主 app.js 直接调用，不能改成 async —— 所以「等」的逻辑放在
   * 工坊自己的 mountPreview 里（见那边），这里只负责取和缓存。
   * 同源 fetch 发生在宿主页面，不受沙箱 CSP 约束。
   */
  function fetchAsset(url) {
    /* 不指定 force-cache：本地服务给静态资源发的是 no-cache（走 304 校验），
       跟随它的语义才能在应用升级后拿到新的 three，而不是永远吃旧缓存。
       同一会话内不会重复请求 —— 上面 threeSrc / threeLoad 已经兜住了。 */
    return fetch(url).then((r) => {
      if (!r.ok) throw new Error(url + ' 加载失败（' + r.status + '）');
      return r.text();
    });
  }

  /** 取 three.js（+ 离线 addons）。已缓存就直接 resolve，不会重复请求。 */
  function ensureThree() {
    if (threeSrc) return Promise.resolve(threeSrc);
    if (threeLoad) return threeLoad;
    /* 包一层 Promise.resolve：万一运行环境没有 fetch（老内核），
       这里变成一个可 catch 的 rejection，而不是在宿主页面里直接抛同步异常。 */
    threeLoad = Promise.resolve().then(() => fetchAsset(THREE_URL)).then((js) => {
      /* addons 是可选增量（RoomEnvironment / FontLoader / Font / TextGeometry）。
         取不到就只注入 three 本体。等 addons 也有结果了才把 threeSrc 标成
         可用，避免出现「有 THREE 但没 THREEAddons」的中间态 —— 提示词里
         承诺了 THREEAddons 可用。 */
      return fetchAsset(THREE_ADDONS_URL)
        .then((a) => { threeAddonsSrc = a; })
        .catch(() => { /* 可选资源，失败就算了 */ })
        .then(() => { threeSrc = js; return js; });
    }).catch((e) => {
      threeLoad = null;        // 允许下次重试（比如本地服务刚启动）
      throw e;
    });
    return threeLoad;
  }

  /** 已经缓存好才拼注入串；没缓存返回空串。buildSrcdoc 靠它保持同步。 */
  function threeInjection() {
    if (!threeSrc) return '';
    let out = '<!-- lizi:studio-libs:begin（three.js r160，宿主注入，勿手改）-->\n'
      + '<script>/* three.js r160 UMD（508-three.min.js）*/\n'
      + threeSrc
      + '\n<\/script>';
    if (threeAddonsSrc) {
      out += '\n<script>/* three.js addons: RoomEnvironment / FontLoader / Font / TextGeometry */\n'
        + threeAddonsSrc
        + '\n<\/script>';
    }
    return out + '\n<!-- lizi:studio-libs:end -->';
  }

  /* ------------------------------------------------------------------ *
   * 沙箱文档：注入 CSP + 错误转发
   * ------------------------------------------------------------------ */
  function buildSrcdoc(html) {
    /* CSP 说明：
       - default-src 'none' + connect-src 'none'：彻底断网，用户代码不可能把
         任何数据发出去，也不会因为等一个加载不出来的资源卡住
       - img-src 放开：封面走 <img>，这是形态唯一需要的网络资源
       - script/style 只认内联
       注：sandbox 本身已经让这个文档是不透明源，CSP 是第二道锁 ——
       万一以后有人给 iframe 加回 allow-same-origin，这层还在。 */
    const csp = '<meta http-equiv="Content-Security-Policy" content="'
      + "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
      + "img-src * data: blob:; font-src data:; connect-src 'none'; frame-src 'none'"
      + '">';
    /* 错误 / 诊断转发：用户代码的 window.onerror 我们收不到，只能让它自己在里面抓。
       这段必须在任何用户脚本之前执行，所以插在 <head> 最前面。
       2026-11-17 增补：
       - securitypolicyviolation：CSP 拦了哪个指令 / 哪个 URL，一并报给宿主；
       - probe：页面 load 后把 canvas 尺寸报给宿主，检测台据此判断「有没有画东西」
         （不读像素、不做比对）。 */
    const prelude = '<script>(function(){'
      + 'function send(m,s,extra){try{var p={message:String(m||"未知错误"),stack:String(s||"")};if(extra){for(var k in extra){if(Object.prototype.hasOwnProperty.call(extra,k))p[k]=extra[k]}}parent.postMessage({__c100:1,type:"error",payload:p},"*")}catch(_){}}'
      + 'function makeStore(){var m=Object.create(null),ks=[];var a={getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){k=String(k);v=String(v);if(!Object.prototype.hasOwnProperty.call(m,k))ks.push(k);m[k]=v},removeItem:function(k){k=String(k);if(Object.prototype.hasOwnProperty.call(m,k)){delete m[k];var i=ks.indexOf(k);if(i>=0)ks.splice(i,1)}},clear:function(){m=Object.create(null);ks.length=0},key:function(i){i=Number(i);return i>=0&&i<ks.length?ks[i]:null}};try{Object.defineProperty(a,"length",{get:function(){return ks.length}})}catch(_){}return a}'
      + 'function shimStore(n){var s=makeStore();try{Object.defineProperty(window,n,{configurable:true,get:function(){return s}});return}catch(_){}try{window[n]=s}catch(__){}}'
      + 'shimStore("localStorage");shimStore("sessionStorage");'
      + 'try{Object.defineProperty(document,"cookie",{configurable:true,get:function(){return ""},set:function(){}})}catch(_){}'
      + 'window.addEventListener("error",function(e){'
      /* 资源加载失败（封面 404 / 防盗链）不算脚本错，别拿它去糊用户 ——
         只在控制台能看到的那种真·脚本异常才转发 */
      + 'if(e&&e.target&&e.target!==window&&e.target.tagName)return;'
      + 'send((e&&e.message)||"脚本报错",(e&&e.error&&e.error.stack)||"")} ,true);'
      + 'window.addEventListener("unhandledrejection",function(e){'
      + 'var r=e&&e.reason;send((r&&(r.message||r))||"Promise 未处理的拒绝",(r&&r.stack)||"")});'
      + 'window.addEventListener("securitypolicyviolation",function(e){'
      + 'if(!e)return;send("CSP 拦截："+(e.violatedDirective||"")+(e.blockedURI?" "+e.blockedURI:""),"",{kind:"csp",directive:String(e.violatedDirective||""),blockedURI:String(e.blockedURI||""),sourceFile:String(e.sourceFile||""),line:Number(e.lineNumber||0)})});'
      + 'function probe(){try{var cs=document.querySelectorAll("canvas"),arr=[],i,c;for(i=0;i<cs.length&&i<8;i++){c=cs[i];arr.push({w:c.width||0,h:c.height||0})}parent.postMessage({__c100:1,type:"probe",payload:{canvases:arr,nodes:document.querySelectorAll("*").length,at:Date.now()}},"*")}catch(_){}}'
      + 'window.addEventListener("load",function(){probe();setTimeout(probe,800);setTimeout(probe,2500)});'
      + '})();<\/script>';

    let out = String(html || '');
    /* 2026-11-17：顺序固定为 CSP → 错误转发 → three → 用户内容。
       已缓存才注入，没缓存就注入空串：buildSrcdoc 必须保持同步（LIZI_STUDIO.srcdoc
       被 app.js 同步调用来赋 iframe.srcdoc），预热见文件末尾。 */
    const inject = csp + prelude + threeInjection();
    if (/<head[^>]*>/i.test(out)) return out.replace(/<head[^>]*>/i, (m) => m + inject);
    if (/<html[^>]*>/i.test(out)) return out.replace(/<html[^>]*>/i, (m) => m + '<head>' + inject + '</head>');
    return inject + out;
  }

  /* ------------------------------------------------------------------ *
   * 界面（2026-11-16 全屏改版）
   * ------------------------------------------------------------------ *
   * 改版原因：原来是一个 1180×780 的居中弹窗，用户要求「不要用窗口，
   * 直接铺满，再加一个我的形态库」。所以：
   *  - 去掉遮罩 / 圆角卡片 / 右上角 X，root 自己就是占满视口的整页；
   *  - 三栏：左栏制作（01 复制提示词 / 02 贴代码），中间预览台，
   *    右栏「我的形态库」（卡片网格：预览 / 载入编辑 / 应用 / 删除）；
   *  - 返回入口 = 顶部箭头 + Esc；body.studio-open 继续负责锁滚动。
   * 安全边界一个字都没动：预览仍是 sandbox="allow-scripts" + buildSrcdoc
   * 注入的 CSP；这里只重排外壳，不碰校验规则和沙箱属性。
   * 为什么 DOM 还是 JS 自己建：工坊在 index.html 里没有挂载点，而 index.html
   * 不归这个文件管（并行改动多），自己挂 body 是唯一不改宿主的做法。
   */
  let root = null;
  let el = {};
  let previewFrame = null;
  let previewTimer = 0;
  let previewStart = 0;
  let previewHtml = '';          // 预览台当前跑的代码（草稿或库内形态）
  let previewMeta = null;        // { kind: 'draft' | 'lib', id, name }
  let mountSeq = 0;              // 预览挂载序号：等 three 期间又切了预览时，丢弃旧挂载
  let rowsCache = [];            // 形态库最近一次读到的记录
  let selectedId = '';           // 形态库里正在预览的那张卡
  let lastError = '';
  /* 自检（2026-11-17）：预览台的 ready / 消息 / 错误统计。
     4 秒没等到 ready 就红条报「接入失败」；「自检」按钮把这一切整理成
     一段能直接粘给网页 AI 的中文报告。 */
  let readyTimer = 0;
  let readyTimedOut = false;
  let previewStats = null;
  let closeTimer = 0;
  let switchTimer = 0;
  let armTimer = 0;
  let toastTimer = 0;
  let lastFocus = null;
  let switching = false;         // 「应用」进行中：防止连点两次排两条 iris 转场

  /* 内联图标：不用字体、不上 CDN，颜色全部交给 CSS 的 currentColor */
  /* 2026-11-17：图标跟着界面方正化 —— 外框圆角从 3 收到 1.5，放大镜的
     圆形镜片也换成圆角方框；描边端点仍然收圆，免得细线发毛。 */
  const ICON_FRAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8.5 4.5v15"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="4.5" width="13" height="13" rx="2"/><path d="M20 20l-3.6-3.6"/></svg>';
  const ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.3 5.9 5.9 2.3-5.9 2.3L12 20l-2.3-5.9L3.8 11.7l5.9-2.3z"/></svg>';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 把值塞进 CSS 属性选择器的引号里：只转义反斜杠和双引号就够了。
     形态 id 目前是 u+base36，理论上很安全，但别让以后改 id 规则的人踩坑。 */
  const attrSel = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  function mockInit() {
    return {
      song: { name: '示例歌曲', artists: '示例歌手', album: '', cover: '' },
      accent: [150, 165, 255],
      duration: 40,
      lines: MOCK_LINES.map((text, i) => ({ t: i * 4, dur: 4, text, chars: null })),
    };
  }

  function postPreview(type, payload) {
    if (!previewFrame || !previewFrame.contentWindow) return;
    try {
      previewFrame.contentWindow.postMessage({ __c100: 1, type, payload }, '*');
      if (previewStats) previewStats.sent[type] = (previewStats.sent[type] || 0) + 1;
    } catch { /* 忽略 */ }
  }

  function stopPreview() {
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = 0;
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = 0;
  }

  /** UTF-8 字节数：报告里给 AI 看的大小，和 6MB 的字符数判据分开表述 */
  function byteLen(s) {
    const str = String(s || '');
    try {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    } catch { /* 老内核 */ }
    try { return new Blob([str]).size; } catch { return str.length; }
  }

  function createStats(html) {
    return {
      startAt: (window.performance && performance.now) ? performance.now() : Date.now(),
      ready: false, readyMs: null,
      counts: {}, sent: {},
      errors: [], csp: [],
      probe: null,
      bytes: byteLen(html),
      html,
    };
  }

  /** 4 秒内没有 ready：这是「接不上」最常见的样子，直接红条说清楚 */
  function armReadyWatch() {
    clearTimeout(readyTimer);
    readyTimer = 0;
    readyTimedOut = false;
    if (!previewStats || previewStats.ready) return;
    readyTimer = setTimeout(() => {
      readyTimer = 0;
      if (!previewStats || previewStats.ready) return;
      readyTimedOut = true;
      showError('形态没有回应 ready，接入失败。\n\n'
        + '最常见的原因：\n'
        + '1. 没有在加载完成后发送 parent.postMessage({ __c100:1, type:"ready" }, "*")\n'
        + '2. 代码有语法错误，脚本根本没有跑起来\n'
        + '3. 用了被沙箱拦掉的 API（本沙箱仍严格限制外链和网络，见错误列表）');
      setMsg('接入失败：4 秒内没有收到 ready。点「自检」复制报告给 AI', 'bad');
    }, 4000);
  }

  function probeText(p) {
    if (!p) return '没有收到首帧探测';
    const cs = Array.isArray(p.canvases) ? p.canvases : [];
    if (!cs.length) return '页面里没有 canvas（可能是 DOM / CSS 形态）';
    const drawn = cs.filter((c) => Number(c.w) > 0 && Number(c.h) > 0);
    if (!drawn.length) return '有 canvas，但尺寸是 0（可能还没绘制）';
    return 'canvas ' + drawn.map((c) => c.w + '×' + c.h).join(' / ');
  }

  function frameSize() {
    if (!previewFrame) return { w: 0, h: 0 };
    return { w: previewFrame.clientWidth || 0, h: previewFrame.clientHeight || 0 };
  }

  /** 给网页 AI 看的中文自检报告（可直接粘贴） */
  function buildSelfReport() {
    const s = previewStats || createStats(previewHtml);
    const counts = s.counts || {};
    const sent = s.sent || {};
    const fmt = (o) => {
      const ks = Object.keys(o || {});
      return ks.length ? ks.map((k) => k + '×' + o[k]).join('，') : '（没有）';
    };
    const vs = frameSize();
    const out = [];
    out.push('我在给 LIZI 音乐播放器做一个自定义播放形态。下面是我这里的检测结果，请帮我修好它。');
    out.push('');
    out.push('【文件】' + (s.file || '粘贴的代码'));
    out.push('【代码大小】' + (s.bytes / 1024).toFixed(1) + ' KB');
    out.push('【是否 ready】' + (s.ready
      ? '是，用时 ' + s.readyMs + ' ms'
      : '否（等了 4 秒没有收到 ready）'));
    out.push('【收到的消息】' + fmt(counts));
    out.push('【父页发出的消息】' + fmt(sent));
    out.push('【视口】' + vs.w + '×' + vs.h);
    out.push('【首帧】' + probeText(s.probe));
    if (s.errors.length) {
      out.push('【脚本错误】');
      s.errors.slice(0, 5).forEach((e, i) => {
        out.push((i + 1) + '. ' + e.message + (e.stack
          ? '\n   ' + String(e.stack).split('\n').slice(0, 4).join('\n   ') : ''));
      });
    } else {
      out.push('【脚本错误】（没有）');
    }
    if (s.csp.length) {
      out.push('【CSP 违规】');
      s.csp.slice(0, 5).forEach((e, i) => {
        out.push((i + 1) + '. 指令 ' + (e.directive || '未知')
          + (e.blockedURI ? '，被拦 URL：' + e.blockedURI : ''));
      });
    } else {
      out.push('【CSP 违规】（没有）');
    }
    if (!s.ready) {
      out.push('');
      out.push('【最常见原因】');
      out.push('1. 没在页面加载完成后发送 parent.postMessage({ __c100:1, type:"ready" }, "*")');
      out.push('2. 代码有语法错误，脚本没有跑起来');
      out.push('3. 用了被沙箱拦掉的 API（外链脚本 / 样式、fetch / XHR / WebSocket 等，看上面的 CSP 违规）');
    }
    out.push('');
    out.push('请只输出修好的完整 HTML，从 <!DOCTYPE html> 开始，到 </html> 结束。不要写解释。');
    return out.join('\n');
  }

  /** 用示例歌词驱动预览：init 一次，然后 tick 每 66ms、beat 每 0.5s */
  function startPreview() {
    stopPreview();
    previewStart = performance.now();
    const init = mockInit();
    let beatIdx = 0;
    postPreview('init', init);
    previewTimer = setInterval(() => {
      const sec = ((performance.now() - previewStart) / 1000) % 44;
      postPreview('tick', { time: sec, playing: true });
      if (Math.floor(sec * 2) !== beatIdx) {
        beatIdx = Math.floor(sec * 2);
        postPreview('beat', { index: beatIdx, level: 0.6 });
      }
      postPreview('live', { bpm: 120, level: 0.5, bass: 0.4, mid: 0.5, treble: 0.3 });
    }, 66);
  }

  function setMsg(text, tone) {
    el.msg.textContent = text || '';
    if (tone) el.msg.dataset.tone = tone;
    else delete el.msg.dataset.tone;
  }

  function showError(text) {
    lastError = text || '';
    if (!text) { el.err.hidden = true; el.errText.textContent = ''; return; }
    el.err.hidden = false;
    el.errText.textContent = text;
  }

  /** 只负责把「一段代码」装进预览沙箱，草稿和库内形态共用同一条安全路径。
      参数 meta 决定预览台标题：{ kind:'draft' } 或 { kind:'lib', id, name }。
      2026-11-16：抽出来是因为形态库点一下要在中间预览台看，不能再重造 iframe。 */
  function mountPreview(html, meta) {
    stopPreview();          // 旧预览的 tick 循环先停掉，别给新 iframe 乱发时间
    const seq = ++mountSeq;
    previewHtml = String(html || '');
    previewMeta = meta || { kind: 'draft' };
    readyTimedOut = false;
    previewStats = createStats(previewHtml);
    previewStats.file = previewMeta.kind === 'lib'
      ? (previewMeta.name || '我的形态') : '粘贴的代码';
    /* 等 three 期间旧的 iframe 已经要被换掉了：先摘掉引用，
       免得它这几十毫秒里的报错还被当成新预览的错误显示出来。 */
    previewFrame = null;
    el.screen.innerHTML = '';

    const mount = () => {
      /* 等 three 的这段时间里用户可能又点了一张卡，或者把工坊关了：
         序号变了就不要再往 screen 里塞旧代码。 */
      if (seq !== mountSeq) return;
      el.screen.innerHTML = '';
      const f = document.createElement('iframe');
      f.className = 'studio__frame';
      /* allow-scripts 之外一个都不给：不加 allow-same-origin，用户代码就是
         不透明源，读不到我们的 localStorage / cookie，也拿不到同源 API。
         ⚠️ 这一行和 buildSrcdoc 的 CSP 是安全底线，改版时原样保留。 */
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('title', '形态预览');
      f.addEventListener('load', () => startPreview(), { once: true });
      f.srcdoc = buildSrcdoc(previewHtml);
      el.screen.appendChild(f);
      previewFrame = f;
      /* 4 秒从「沙箱挂上」算，不从 load 算：外部图片挂住时 load 可能一直不来，
         而 ready 本来就不该等图片。 */
      armReadyWatch();
    };

    paintPreviewBar();
    /* 2026-11-17：three 还没缓存时先等它，保证工坊里的第一个预览也有 THREE。
       等的是宿主页面的同源请求，不是沙箱里的网络。取失败也继续挂 ——
       不用 THREE 的形态照常能跑。 */
    if (threeSrc) { mount(); return; }
    el.screen.innerHTML = '<div class="studio__ph"><p class="studio__ph-t">正在准备预览…</p></div>';
    ensureThree().catch(() => {}).then(mount);
  }

  /** 把代码装进预览沙箱。校验失败就只显示问题，不动预览。 */
  function preview(html) {
    const problems = check(html);
    if (problems.length) {
      setMsg(problems[0], 'bad');
      showError('');
      el.save.disabled = true;
      return false;
    }
    /* 外链不再阻断保存（2026-11-17），但要提前说清楚运行时可能缺东西 */
    const warns = warn(html);
    setMsg(warns.length ? warns[0] : '正在预览…', warns.length ? '' : 'ok');
    showError('');
    el.save.disabled = !el.name.value.trim();
    mountPreview(html, { kind: 'draft' });
    markSelected('');
    return true;
  }

  /** 预览台顶部那条信息：标题 / 来源 / 按钮显隐 */
  function paintPreviewBar() {
    const m = previewMeta;
    const lib = !!(m && m.kind === 'lib');
    if (el.pkind) {
      el.pkind.hidden = !previewHtml;
      el.pkind.textContent = lib ? '库内' : '草稿';
    }
    if (el.ptitle) {
      el.ptitle.textContent = previewHtml
        ? (lib ? (m.name || '未命名') : '草稿预览')
        : '预览台';
    }
    if (el.psub) {
      el.psub.textContent = previewHtml
        ? '示例歌词驱动，不是真在播'
        : '粘上代码点「检查并预览」，或从形态库点一个';
    }
    if (el.pedit) el.pedit.hidden = !(lib && previewHtml);
    if (el.selfcheck) el.selfcheck.hidden = !previewHtml;
    if (el.replay) el.replay.hidden = !previewHtml;
  }

  function renderPlaceholder() {
    /* 先把 tick 循环停掉：这里会卸掉 iframe，不停的话计时器会一直空转 */
    stopPreview();
    mountSeq++;             // 取消还在等 three 的那次挂载
    previewHtml = '';
    previewMeta = null;
    previewFrame = null;
    previewStats = null;
    readyTimedOut = false;
    el.screen.innerHTML = `
      <div class="studio__ph">
        <span class="studio__ph-ico">${ICON_FRAME}</span>
        <p class="studio__ph-t">这里会显示你的形态</p>
        <p class="studio__ph-s">粘上代码点「检查并预览」，或从形态库点一个</p>
      </div>`;
    paintPreviewBar();
  }

  function markSelected(id) {
    selectedId = id || '';
    if (!el.libgrid) return;
    el.libgrid.querySelectorAll('.lib__card').forEach((c) => {
      const on = c.dataset.id === selectedId;
      c.classList.toggle('is-sel', on);
      c.setAttribute('aria-current', on ? 'true' : 'false');
    });
  }

  function toast(text, tone) {
    if (!el.toast) return;
    el.toast.textContent = text || '';
    el.toast.dataset.tone = tone || '';
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.classList.remove('is-on'); }, 2800);
  }

  /* ------------------------------------------------------------------ *
   * 我的形态库：卡片数据
   * ------------------------------------------------------------------ */
  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  function fmtWhen(at) {
    const t = Number(at) || 0;
    const d = new Date(t);
    if (!t || isNaN(d.getTime())) return '未知时间';
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((day - dd) / 86400000);
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (diff === 0) return '今天 ' + hm;
    if (diff === 1) return '昨天 ' + hm;
    const y = d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '年' : '';
    return y + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function fmtShort(at) {
    const t = Number(at) || 0;
    const d = new Date(t);
    if (!t || isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      : (d.getMonth() + 1) + '/' + d.getDate();
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hexRgb(hex) {
    let s = String(hex || '').replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    if (s.length !== 6 || !/^[0-9a-f]{6}$/i.test(s)) return null;
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* 形态没有可截图的缩略图（沙箱是不透明源，父页面拿不到 canvas 像素），
     所以卡片封面用「形态代码里的配色」生成一张确定性的色卡：
     - 扫 HTML 里的十六进制颜色，跳过过黑 / 过白，取前 3 个
     - 一个颜色都扫不到就按 id+名字哈希出一组色相，保证每张卡颜色不同
     2026-11-16 加。这不是截图，只是让形态库一眼能区分，点开才是真预览。
     2026-11-17：色卡从三团柔光渐变改成三块纯色条 —— 只换封面表现，
     扫描逻辑、缓存键、取色规则一个字没动。 */
  const paintCache = Object.create(null);
  function paintOf(rec) {
    const src = String(rec.html || '');
    /* 缓存键带上 html 长度：一次会话里翻来覆去重画形态库时，
       不必对每条 1MB 的代码反复扫颜色。id 是新建的，删除后残留一点也无所谓。 */
    const ck = String(rec.id || '') + '|' + String(rec.name || '') + '|' + src.length;
    if (paintCache[ck]) return paintCache[ck];
    const seen = Object.create(null);
    const cols = [];
    const re = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
    let m;
    let guard = 0;
    while ((m = re.exec(src)) && guard < 6000 && cols.length < 3) {
      guard++;
      const rgb = hexRgb(m[0]);
      if (!rgb) continue;
      const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (lum < 26 || lum > 232) continue;
      const key = rgb.join(',');
      if (seen[key]) continue;
      seen[key] = 1;
      cols.push(rgb);
    }
    const seed = hashStr(String(rec.id || '') + '|' + String(rec.name || ''));
    const hue = seed % 360;
    const hue2 = (hue + 54) % 360;
    /* 2026-11-17：三块纯色条，不再拼渐变。
       有代码配色就直接用它的 rgb；扫不到就按哈希色相给不透明实色，
       饱和度压到 46%，别在黑白界面里抢眼。 */
    const c1 = cols[0]
      ? `rgb(${cols[0][0]},${cols[0][1]},${cols[0][2]})`
      : `hsl(${hue},46%,62%)`;
    const c2 = cols[1]
      ? `rgb(${cols[1][0]},${cols[1][1]},${cols[1][2]})`
      : `hsl(${hue2},46%,58%)`;
    const c3 = cols[2]
      ? `rgb(${cols[2][0]},${cols[2][1]},${cols[2][2]})`
      : 'rgb(24,27,40)';
    const bars = [c1, c2, c3];
    const glyph = [...String(rec.name || '自定义')].slice(0, 2).join('');
    const out = { bars, glyph };
    paintCache[ck] = out;
    return out;
  }

  function cardHtml(r) {
    const name = esc(r.name || '未命名');
    const kb = Math.max(1, Math.round(String(r.html || '').length / 1024));
    const p = paintOf(r);
    return `<li class="lib__card" data-id="${esc(r.id)}" data-name="${esc(String(r.name || '').toLowerCase())}" aria-current="false">
      <button class="lib__open" type="button" data-act="lib-preview" data-id="${esc(r.id)}" aria-label="预览 ${name}">
        <span class="lib__poster">
          <span class="lib__glyph" aria-hidden="true">${esc(p.glyph)}</span>
          <span class="lib__kind">自定义</span>
          <span class="lib__date">${esc(fmtShort(r.at))}</span>
          <span class="lib__swatches" aria-hidden="true"><i style="background:${p.bars[0]}"></i><i style="background:${p.bars[1]}"></i><i style="background:${p.bars[2]}"></i></span>
        </span>
        <span class="lib__meta">
          <span class="lib__name">${name}</span>
          <span class="lib__sub">${kb} KB · ${esc(fmtWhen(r.at))}</span>
        </span>
      </button>
      <div class="lib__acts">
        <button class="lib__act" type="button" data-act="lib-load" title="载入到左边编辑器">编辑</button>
        <button class="lib__act lib__act--del" type="button" data-act="lib-del" title="删除这个形态">删除</button>
        <button class="lib__act lib__act--go" type="button" data-act="lib-stage" title="把当前播放形态切换成它">应用</button>
      </div>
      <span class="lib__arm" aria-hidden="true">再点一次删除</span>
    </li>`;
  }

  function applyLibraryFilter() {
    if (!el.libgrid) return;
    const q = String(el.libsearch && !el.libsearch.hidden ? el.libsearch.value : '').trim().toLowerCase();
    let shown = 0;
    el.libgrid.querySelectorAll('.lib__card').forEach((c) => {
      const hit = !q || (c.dataset.name || '').indexOf(q) >= 0;
      c.hidden = !hit;
      if (hit) shown++;
    });
    if (el.libnohit) el.libnohit.hidden = !(rowsCache.length && shown === 0);
  }

  async function refreshLibrary(opts) {
    const o = opts || {};
    clearTimeout(armTimer);
    rowsCache = await listStages();
    el.count.textContent = String(rowsCache.length);
    el.libempty.hidden = rowsCache.length > 0;
    el.libgrid.hidden = rowsCache.length === 0;
    el.libsearch.hidden = rowsCache.length < 6;
    if (el.libsearch.hidden) el.libsearch.value = '';
    if (o.clearSearch) el.libsearch.value = '';
    if (!rowsCache.length) {
      el.libgrid.innerHTML = '';
      el.libnohit.hidden = true;
      selectedId = '';
      return;
    }
    el.libgrid.innerHTML = rowsCache.map(cardHtml).join('');
    applyLibraryFilter();
    const keep = o.selectId || (rowsCache.some((r) => r.id === selectedId) ? selectedId : '');
    markSelected(keep);
    /* 新保存的那张单独滚到眼前 + 绿框闪一下；它不一定等于「正在预览的那张」，
       所以只加提示，不抢预览高亮（2026-11-16 改） */
    const focusId = o.selectId || o.justSaved || '';
    if (focusId) {
      const card = el.libgrid.querySelector('.lib__card[data-id="' + attrSel(focusId) + '"]');
      if (card && card.scrollIntoView) {
        try { card.scrollIntoView({ block: 'nearest' }); } catch { /* 老内核 */ }
      }
      if (o.justSaved && card) {
        card.classList.add('is-new');
        setTimeout(() => { if (card.isConnected) card.classList.remove('is-new'); }, 1400);
      }
    }
  }

  async function saveCurrent() {
    const html = el.code.value.trim();
    const name = el.name.value.trim();
    if (!name) { setMsg('先给这个形态起个名字', 'bad'); el.name.focus(); return; }
    const problems = check(html);
    if (problems.length) { setMsg(problems[0], 'bad'); return; }
    const rec = {
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, html, at: Date.now(),
    };
    try {
      await putStage(rec);
    } catch (e) {
      setMsg('保存失败：' + ((e && e.message) || e), 'bad');
      return;
    }
    /* 说清楚去哪儿找：右边形态库 / 形态长廊面 / 播放页抽屉里的形态列表
       都是同一份数据，用户在第一处没看到就会以为没保存成功 */
    const warns = warn(html);
    setMsg(`已保存《${name}》—— 右边形态库里能看到；播放页「形态」菜单和形态长廊里也有`
      + (warns.length ? `（提示：${warns[0]}）` : ''), 'ok');
    el.name.value = '';
    el.save.disabled = true;
    await refreshLibrary({ justSaved: rec.id, clearSearch: true });
    toast(`已保存《${name}》`, 'ok');
    /* 通知宿主：形态列表变了（app.js 监听这个事件重排菜单） */
    try { document.dispatchEvent(new CustomEvent('lizi:studio', { detail: { action: 'save', id: rec.id } })); } catch { /* 忽略 */ }
  }

  /** 在形态库里点一张卡：中间的预览台直接跑它 */
  function previewSaved(rec) {
    if (!rec) return;
    showError('');
    setMsg('', '');
    markSelected(rec.id);
    mountPreview(String(rec.html || ''), { kind: 'lib', id: rec.id, name: rec.name || '未命名' });
  }

  /** 把库里的形态抄进左边编辑器（保存时会存成新的一条，不改原记录） */
  function loadIntoEditor(rec) {
    if (!rec) return;
    el.code.value = String(rec.html || '');
    el.name.value = rec.name || '';
    el.save.disabled = !el.name.value.trim();
    markSelected(rec.id);
    try { el.code.focus(); } catch { /* 忽略 */ }
    setMsg(`已载入《${rec.name || '未命名'}》到左边。改完再保存会存成一个新形态，原来的不动`, 'ok');
  }

  async function removeOne(id) {
    const rec = rowsCache.find((r) => r.id === id);
    try { await delStage(id); } catch (e) { setMsg('删除失败：' + ((e && e.message) || e), 'bad'); return; }
    const wasPreviewing = previewMeta && previewMeta.kind === 'lib' && previewMeta.id === id;
    await refreshLibrary();
    if (wasPreviewing) renderPlaceholder();
    toast(`已删除《${(rec && rec.name) || '未命名'}》`, 'ok');
    try { document.dispatchEvent(new CustomEvent('lizi:studio', { detail: { action: 'delete', id } })); } catch { /* 忽略 */ }
  }

  /* ------------------------------------------------------------------ *
   * 应用形态：借用宿主现有的切形态入口（2026-11-16）
   * ------------------------------------------------------------------ *
   * app.js 没有把 applyStage() 暴露到 window（StageHost 是闭包），能用的公开
   * 入口只有它自己渲染的形态菜单项：`#stage-menu-pop-list .stage-item[data-id]`
   * （播放页抽屉，随 lizi:stages-refresh 重画）和 `#stage-menu-list`
   * （旧下拉，DOM 一直在）。点一下等于用户自己从菜单里选，iris 转场、
   * 记住当前形态、菜单高亮全部由宿主负责，我们不需要也不可能再实现一遍。
   *
   * iris 的 z-index（130）比工坊（1000）低，圆会在工坊底下铺开。所以这里
   * 先点、等 470ms（iris 420ms 盖满）再收起工坊：用户看到的是「暗幕落下 →
   * 新形态淡入」，而不是一闪。找不到菜单项就明确报错，绝不猜测。
   */
  function stageItem(id) {
    const sel = '#stage-menu-pop-list .stage-item[data-id="' + attrSel(id) + '"]'
      + ', #stage-menu-list .stage-item[data-id="' + attrSel(id) + '"]';
    try { return document.querySelector(sel); } catch { return null; }
  }

  function waitStageItem(id, ms) {
    /* 让宿主重读一遍 IndexedDB：刚保存的形态可能还没来得及进 STAGES */
    try { document.dispatchEvent(new CustomEvent('lizi:studio', { detail: { action: 'refresh' } })); } catch { /* 忽略 */ }
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    return new Promise((resolve) => {
      (function tick() {
        const it = stageItem(id);
        if (it) { resolve(it); return; }
        const now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (now - t0 > (ms || 1600)) { resolve(null); return; }
        setTimeout(tick, 80);
      })();
    });
  }

  async function setAsCurrent(rec) {
    if (!rec || switching) return;
    switching = true;
    const stageId = 'user:' + rec.id;
    toast(`正在切换到《${rec.name || '未命名'}》…`);
    const item = await waitStageItem(stageId, 1600);
    if (!item) {
      switching = false;
      toast('宿主里还没出现这个形态，去播放页的「形态」菜单里选一下它', 'bad');
      return;
    }
    item.click();
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => { close(); }, 470);
  }

  /** 一律 resolve 成 true/false —— 调用方只关心复制有没有成功 */
  function copyText(text) {
    const s = String(text || '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(() => true).catch(() => copyFallback(s));
    }
    return Promise.resolve(copyFallback(s));
  }

  function copyFallback(s) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch { return false; }
  }

  /* ------------------------------------------------------------------ *
   * 导入 / 导出 / 独立检测（2026-11-17）
   * ------------------------------------------------------------------ *
   * 只动编辑器里的字符串，不碰校验、沙箱、CSP 任何一处。
   */
  function importFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setMsg(`文件太大了（${Math.round(file.size / 1024)}KB，上限 ${MAX_BYTES / 1024}KB / 6MB）`, 'bad');
      return;
    }
    const rd = new FileReader();
    rd.onload = () => {
      const text = String(rd.result || '').replace(/^\\uFEFF/, '');
      if (text.length > MAX_BYTES) {
        setMsg(`文件太大了（${Math.round(text.length / 1024)}KB，上限 ${MAX_BYTES / 1024}KB / 6MB）`, 'bad');
        return;
      }
      el.code.value = text.trim();
      el.save.disabled = !el.name.value.trim();
      setMsg(`已导入 ${file.name}（${(file.size / 1024).toFixed(1)}KB）。点「检查并预览」看看效果`, 'ok');
    };
    rd.onerror = () => setMsg('读不了这个文件（可能不是文本 / HTML）', 'bad');
    rd.readAsText(file, 'utf-8');
  }

  function exportStage() {
    const html = String(el.code.value || '');
    if (!html.trim()) { setMsg('编辑器里还没有代码，没东西可导出', 'bad'); return; }
    const base = (el.name.value.trim() || 'stage').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'stage';
    const fname = /\.html?$/i.test(base) ? base : base + '.html';
    try {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* 忽略 */ } }, 1500);
      setMsg(`已导出 ${fname}`, 'ok');
      toast(`已导出 ${fname}`);
    } catch (e) {
      setMsg('导出失败：' + ((e && e.message) || e), 'bad');
    }
  }

  /** 独立检测页和工坊同源：sessionStorage 会在 window.open 打开的新标签里继承 */
  function openLab() {
    const html = String(el.code.value || '');
    if (!html.trim()) { setMsg('先把代码贴进来，再打开独立检测', 'bad'); return; }
    try {
      sessionStorage.setItem('lizi.stage.lab', html);
    } catch (e) {
      setMsg('浏览器不让写 sessionStorage，带不过去：' + ((e && e.message) || e), 'bad');
      return;
    }
    const w = window.open('/dev/stage-lab.html', '_blank');
    if (!w) toast('新标签页被拦了，请允许弹窗后重试', 'bad');
    else toast('已在新标签打开独立检测');
  }

  function copySelfReport() {
    copyText(buildSelfReport()).then((ok) => {
      toast(ok ? '自检报告已复制，粘回给 AI 就行' : '复制失败：请手动全选', ok ? 'ok' : 'bad');
    });
  }

  function build() {
    root = document.createElement('div');
    root.className = 'studio';
    root.hidden = true;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'AI 自定义工坊');
    root.innerHTML = `
      <header class="studio__head">
        <button class="studio__back" type="button" data-act="close" aria-label="返回" title="返回（Esc）">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <div class="studio__titles">
          <h2 class="studio__h2">AI 自定义工坊</h2>
          <p class="studio__sub">让网页版 AI 帮你写一个播放形态 · 存在本机，不上传</p>
        </div>
        <span class="studio__esc" aria-hidden="true">Esc 返回</span>
      </header>

      <div class="studio__grid">
        <section class="studio__compose" data-el="compose" aria-label="制作形态">
          <div class="studio__step">
            <div class="studio__stephead">
              <span class="studio__idx">01</span>
              <div class="studio__steptext">
                <h3>复制提示词</h3>
                <p>发给任意网页版 AI（ChatGPT、Claude、豆包都行），在最后那段「你要做的效果」里写你想要的画面。</p>
              </div>
            </div>
            <button class="studio__btn studio__btn--ghost" type="button" data-act="copy-prompt">复制提示词</button>
            <p class="studio__msg" data-el="copy-msg" aria-live="polite"></p>
          </div>

          <div class="studio__step studio__step--grow">
            <div class="studio__stephead">
              <span class="studio__idx">02</span>
              <div class="studio__steptext">
                <h3>把代码粘回来</h3>
                <p>整段 HTML 粘进来，起个名字就能存。</p>
              </div>
            </div>
            <textarea class="studio__code" data-el="code" spellcheck="false"
              placeholder="粘贴 AI 输出的整段 HTML（从 <!DOCTYPE html> 到最后一行），或把 .html 文件拖进来"></textarea>
            <div class="studio__row studio__row--io">
              <button class="studio__btn studio__btn--ghost" type="button" data-act="import">导入 .html</button>
              <button class="studio__btn studio__btn--ghost" type="button" data-act="export">导出 .html</button>
              <button class="studio__btn studio__btn--ghost" type="button" data-act="lab">独立检测</button>
              <input type="file" data-el="file" accept=".html,.htm,text/html" hidden>
            </div>
            <div class="studio__row">
              <button class="studio__btn" type="button" data-act="check">检查并预览</button>
              <input class="studio__input" data-el="name" maxlength="24" placeholder="给这个形态起个名字" aria-label="形态名字">
              <button class="studio__btn studio__btn--primary" type="button" data-act="save" disabled>保存</button>
            </div>
            <p class="studio__msg" data-el="msg" aria-live="polite"></p>
          </div>
        </section>

        <section class="studio__stage" aria-label="预览台">
          <div class="studio__pbar">
            <div class="studio__pinfo">
              <span class="studio__pk" data-el="pkind" hidden></span>
              <b class="studio__pt" data-el="ptitle">预览台</b>
              <span class="studio__ps" data-el="psub"></span>
            </div>
            <div class="studio__pacts">
              <button class="studio__mini" type="button" data-act="pedit" data-el="pedit" hidden>载入编辑</button>
              <button class="studio__mini" type="button" data-act="selfcheck" data-el="selfcheck" hidden>自检</button>
              <button class="studio__mini" type="button" data-act="replay" data-el="replay" hidden>重播</button>
            </div>
          </div>
          <div class="studio__screen" data-el="screen"></div>
          <div class="studio__err" data-el="err" hidden>
            <p class="studio__err-t" data-el="err-text"></p>
            <button class="studio__mini" type="button" data-act="copy-err">复制错误信息</button>
          </div>
        </section>

        <aside class="studio__lib" aria-label="我的形态库">
          <div class="studio__libhead">
            <h3 class="studio__libtitle">我的形态库 <span class="studio__libcount" data-el="count">0</span></h3>
            <p class="studio__libhint">点封面预览 · 「应用」立刻切换过去</p>
            <div class="studio__libsearch">
              ${ICON_SEARCH}
              <input type="search" data-el="lib-search" placeholder="搜索形态" aria-label="搜索我的形态" autocomplete="off" spellcheck="false">
            </div>
          </div>
          <ul class="studio__libgrid" data-el="libgrid"></ul>
          <div class="studio__libempty" data-el="libempty">
            <span class="studio__libempty-ico">${ICON_STAR}</span>
            <b>还没有保存过形态</b>
            <span>按左边 01 / 02 做一个，保存后会出现在这里</span>
          </div>
          <p class="studio__libnohit" data-el="libnohit" hidden>没有匹配的形态</p>
        </aside>
      </div>
      <div class="studio__toast" data-el="toast" role="status" aria-live="polite"></div>`;
    document.body.appendChild(root);

    el = {
      code: root.querySelector('[data-el="code"]'),
      name: root.querySelector('[data-el="name"]'),
      file: root.querySelector('[data-el="file"]'),
      msg: root.querySelector('[data-el="msg"]'),
      copyMsg: root.querySelector('[data-el="copy-msg"]'),
      compose: root.querySelector('[data-el="compose"]'),
      screen: root.querySelector('[data-el="screen"]'),
      err: root.querySelector('[data-el="err"]'),
      errText: root.querySelector('[data-el="err-text"]'),
      save: root.querySelector('[data-act="save"]'),
      back: root.querySelector('.studio__back'),
      count: root.querySelector('[data-el="count"]'),
      libgrid: root.querySelector('[data-el="libgrid"]'),
      libempty: root.querySelector('[data-el="libempty"]'),
      libnohit: root.querySelector('[data-el="libnohit"]'),
      libsearch: root.querySelector('[data-el="lib-search"]'),
      pkind: root.querySelector('[data-el="pkind"]'),
      ptitle: root.querySelector('[data-el="ptitle"]'),
      psub: root.querySelector('[data-el="psub"]'),
      pedit: root.querySelector('[data-el="pedit"]'),
      selfcheck: root.querySelector('[data-el="selfcheck"]'),
      replay: root.querySelector('[data-el="replay"]'),
      toast: root.querySelector('[data-el="toast"]'),
    };
    renderPlaceholder();

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !root.contains(b)) return;
      const act = b.dataset.act;

      if (act === 'close') { close(); return; }

      if (act === 'copy-prompt') {
        copyText(PROMPT).then((ok) => {
          el.copyMsg.textContent = ok ? '已复制，去粘贴给 AI 吧' : '复制失败：请手动全选提示词';
          if (ok) toast('提示词已复制');
        });
        return;
      }

      if (act === 'check') {
        el.code.value = extractHtml(el.code.value);
        preview(el.code.value.trim());
        return;
      }

      if (act === 'import') {
        el.file.value = '';
        try { el.file.click(); } catch { setMsg('这个环境不支持选文件，可以直接把 .html 拖进编辑器', 'bad'); }
        return;
      }
      if (act === 'export') { exportStage(); return; }
      if (act === 'lab') { openLab(); return; }
      if (act === 'selfcheck') { copySelfReport(); return; }

      if (act === 'replay') {
        if (previewHtml) mountPreview(previewHtml, previewMeta);
        return;
      }

      if (act === 'copy-err') {
        copyText(lastError).then((ok) => { if (ok) toast('错误信息已复制'); });
        return;
      }

      if (act === 'save') { saveCurrent(); return; }

      /* 库内预览时的「载入编辑」：把中间预览台上的那条抄进左边 */
      if (act === 'pedit') {
        const rec = previewMeta && previewMeta.kind === 'lib'
          ? rowsCache.find((r) => r.id === previewMeta.id) : null;
        if (rec) loadIntoEditor(rec);
        return;
      }

      const card = b.closest('.lib__card');
      const id = (card && card.dataset.id) || b.dataset.id || '';
      if (act === 'lib-preview') {
        const rec = rowsCache.find((r) => r.id === id);
        if (rec) previewSaved(rec);
        return;
      }
      if (act === 'lib-load') {
        const rec = rowsCache.find((r) => r.id === id);
        if (rec) loadIntoEditor(rec);
        return;
      }
      if (act === 'lib-stage') {
        const rec = rowsCache.find((r) => r.id === id);
        if (rec) setAsCurrent(rec);
        return;
      }
      if (act === 'lib-del') {
        if (!card) return;
        if (card.dataset.arm !== '1') {
          /* 两步确认：第一次只亮红条，3.2s 内再点才真删。不用 window.confirm，
             原生弹窗既难看、又会盖住整页且不可控。2026-11-16 */
          card.dataset.arm = '1';
          b.setAttribute('aria-label', '再点一次确认删除');
          clearTimeout(armTimer);
          armTimer = setTimeout(() => {
            if (card.isConnected) delete card.dataset.arm;
            b.removeAttribute('aria-label');
          }, 3200);
          return;
        }
        delete card.dataset.arm;
        removeOne(id);
        return;
      }
    });

    /* 导入：文件选择器 + 编辑器区域拖放（2026-11-17） */
    el.file.addEventListener('change', () => {
      const f = el.file.files && el.file.files[0];
      if (f) importFile(f);
    });
    ['dragenter', 'dragover'].forEach((evt) => {
      el.code.addEventListener(evt, (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        el.code.classList.add('is-drop');
      });
    });
    ['dragleave', 'dragend'].forEach((evt) => {
      el.code.addEventListener(evt, () => el.code.classList.remove('is-drop'));
    });
    el.code.addEventListener('drop', (e) => {
      el.code.classList.remove('is-drop');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      importFile(files[0]);
    });

    /* 库内搜索：本地过滤，不重读 IndexedDB */
    el.libsearch.addEventListener('input', applyLibraryFilter);

    /* 没名字不给保存；代码有没有问题在保存时再判一次（改完代码还没点检查就保存也行） */
    el.name.addEventListener('input', () => {
      el.save.disabled = !el.name.value.trim();
    });

    /* 沙箱发回来的消息：只认自己那个预览 iframe */
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.__c100 !== 1) return;
      /* 只认自己那个预览 iframe（和原来一样，不能放宽源校验） */
      if (!previewFrame || e.source !== previewFrame.contentWindow) return;
      const type = String(d.type || '');
      if (previewStats) previewStats.counts[type] = (previewStats.counts[type] || 0) + 1;
      if (type === 'ready') {
        if (previewStats && !previewStats.ready) {
          previewStats.ready = true;
          previewStats.readyMs = Math.round(
            ((window.performance && performance.now) ? performance.now() : Date.now())
            - previewStats.startAt);
        }
        if (readyTimer) { clearTimeout(readyTimer); readyTimer = 0; }
        if (readyTimedOut) {
          readyTimedOut = false;
          showError('');
          setMsg('ready 晚到了（超过 4 秒），但已经接上', 'ok');
        }
        return;
      }
      if (type === 'probe') {
        if (previewStats) previewStats.probe = d.payload || null;
        return;
      }
      if (type !== 'error') return;
      const p = d.payload || {};
      const msg = String(p.message || '未知错误');
      const stack = String(p.stack || '');
      const isCsp = p.kind === 'csp' || !!p.directive || !!p.blockedURI;
      if (previewStats) {
        const list = isCsp ? previewStats.csp : previewStats.errors;
        if (list.length < 20) {
          list.push({
            message: msg, stack,
            directive: String(p.directive || ''),
            blockedURI: String(p.blockedURI || ''),
          });
        }
      }
      showError(`${isCsp ? '这个形态被沙箱拦了' : '这个形态报错了'}：${msg}`
        + (stack ? '\n\n' + stack.split('\n').slice(0, 4).join('\n') : ''));
      setMsg('跑起来了，但是报错了 —— 点「自检」复制报告，贴回给 AI 让它修', 'bad');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root && !root.hidden) { e.stopPropagation(); close(); }
    }, true);
  }

  /** 用户常把 ```html 围栏和解释一起粘进来：能剥就剥，别让人自己删 */
  function extractHtml(raw) {
    let s = String(raw || '');
    const fence = s.match(/```(?:html|HTML)?\s*\n([\s\S]*?)```/);
    if (fence) s = fence[1];
    const start = s.search(/<!DOCTYPE|<html[\s>]/i);
    if (start > 0) s = s.slice(start);
    return s.trim();
  }

  /* ------------------------------------------------------------------ *
   * 打开 / 关闭（2026-11-16 全屏改版）
   * ------------------------------------------------------------------ *
   * 从弹窗改成整页后，「打开」就是把 root 这个 fixed 全屏视图显示出来。
   * 入场 / 退场只动 opacity 和 transform；退场期间加 is-closing 关掉点击，
   * 180ms 后才真正 hidden —— 这样既不会突然消失，也不会让两个状态打架。
   */
  function open() {
    if (!root) build();
    clearTimeout(closeTimer);
    clearTimeout(switchTimer);
    switching = false;
    lastFocus = document.activeElement;
    const wasHidden = root.hidden;
    root.hidden = false;
    root.classList.remove('is-closing');
    /* 只有「从隐藏到显示」才重放入场；已经在页面上时再调 open() 不该闪一下 */
    if (wasHidden) {
      root.classList.remove('is-in');
      void root.offsetWidth;        // 强制回流：让 0 → 1 的 opacity 真的走过渡
    }
    root.classList.add('is-in');
    document.body.classList.add('studio-open');
    if (el.toast) el.toast.classList.remove('is-on');

    /* 上次关闭时 iframe 已经卸掉了，这里按上次预览的代码重新挂一次；
       没有预览过就回到占位状态。 */
    if (!previewFrame) {
      if (previewHtml) mountPreview(previewHtml, previewMeta);
      else renderPlaceholder();
    }
    paintPreviewBar();
    refreshLibrary();
    setTimeout(() => {
      try { if (el.back) el.back.focus({ preventScroll: true }); } catch { /* 老内核 */ }
    }, 30);
  }

  function close() {
    if (!root || root.hidden) return;
    clearTimeout(closeTimer);
    clearTimeout(switchTimer);
    clearTimeout(armTimer);
    switching = false;
    stopPreview();
    /* 关闭时把预览 iframe 卸掉：沙箱里的 rAF 不会自己停 */
    mountSeq++;             // 取消还在等 three 的那次挂载，别在关闭后又插回来
    previewFrame = null;
    previewStats = null;
    readyTimedOut = false;
    el.screen.innerHTML = '';
    root.classList.add('is-closing');
    root.classList.remove('is-in');
    closeTimer = setTimeout(() => {
      root.hidden = true;
      root.classList.remove('is-closing');
      document.body.classList.remove('studio-open');
      try {
        if (lastFocus && lastFocus.focus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
      } catch { /* 忽略 */ }
      lastFocus = null;
    }, 180);
  }

  /* 2026-11-17：页面一加载就预热 three，不等用户点预览。
     桌面 index.html 和手机 m/index.html 都是直接 <script src=...studio.js> 引本文件，
     所以这里两条路径都会执行。为什么必须预热：宿主 app.js 的 StageHost 走
     LIZI_STUDIO.srcdoc 是同步调用，我们没法让它等 Promise；而用户从打开页面到
     选一个自建形态，中间至少要读一次 IndexedDB、点开菜单，669KB 同源文件
     在本地服务上早取完了。工坊自己的第一个预览另有等待逻辑（mountPreview），
     所以两条入口都不会缺 THREE。 */
  setTimeout(() => {
    ensureThree().catch(() => { /* 取不到就算了：不用 THREE 的形态照常跑 */ });
  }, 0);

  return {
    open, close,
    list: listStages,
    remove: delStage,
    /* 宿主（app.js StageHost.loadIntoFrame）也走同一份沙箱文档：
       CSP + 错误转发只有一处实现，预览和正式播放不会有行为差异 */
    srcdoc: buildSrcdoc,
    check,
    /** 非阻断提示（需要联网 / http 会被拦），工坊和检测台共用 */
    warn,
    /** 宿主用：把保存的形态变成 STAGES 能用的形状 */
    toStage: (rec) => ({
      id: 'user:' + rec.id,
      name: rec.name || '我做的形态',
      desc: 'AI 工坊 · 我做的',
      url: null,
      user: true,
      html: rec.html,
    }),
    _prompt: PROMPT,
    /* 检测台（public/dev/stage-lab.html）用：示例歌词和大小上限。
       只读，别在外部改这两个值。 */
    _mockLines: MOCK_LINES.slice(),
    _maxBytes: MAX_BYTES,
  };
})();

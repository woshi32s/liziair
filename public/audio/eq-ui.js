/**
 * eq-ui.js —— 音效面板的 DOM 与画布（用 EqEngine 的音频能力）
 *
 * 两个入口共用**同一个 DOM 根节点**：整页（#view-audio 里的 #eq-host-page）
 * 和播放页半页覆盖（#eq-sheet 里的 #eq-host-sheet）。切换入口时只是把
 * 根节点 append 到另一个宿主里 —— 滑杆位置、画布状态、选中节点全都不丢，
 * 不存在"两份界面互相打架"。
 *
 * 高级模式按专业图形 EQ 的交互做：
 *   拖节点 = 频率 + 增益 / 滚轮或 Shift+拖 = Q / 双击 = 旁通
 *   右键 = 切类型（Bell / Low Shelf / High Shelf / Low Pass / High Pass / Notch）
 *   方向键 = 微调（1 Hz / 0.1 dB，按住 Shift ×10）
 * 曲线一律用 `getFrequencyResponse()` 取真响应来画（见 eq-engine.js），
 * 不自己另写一套传递函数 —— 否则会"看着对、听着不对"。
 *
 * 造型：近黑面板、1px hairline 网格、右侧 dB 刻度、琥珀曲线。
 * 没有阴影、没有渐变、没有发光，圆角最大 4px。
 */
const EqUI = (() => {
  const CSS_HREF = (document.currentScript && document.currentScript.src)
    ? new URL('./eq.css', document.currentScript.src).href
    : '/audio/eq.css';

  /* ---- 样式自注入（和 public/lab/dj.css 一样的做法：按需、只注入一次） ---- */
  (function injectCss() {
    if (document.querySelector('link[data-eq-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = CSS_HREF;
    l.dataset.eqCss = '1';
    document.head.appendChild(l);
  })();

  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2).replace(/\.?0+$/, '') + 'k' : Math.round(f));
  const fmtDb = (d) => (d > 0 ? '+' : '') + d.toFixed(1);

  let root = null, sheet = null, sheetOpen = false;
  let mode = 'simple';
  /* 音质区当前在编辑哪个平台的档位。只在 mount() 时按当前曲目重置；
     面板开着时用户切了 tab 就保持，不因换歌自动跳。 */
  let activePlatform = 'netease';
  let selected = 3;                  // 高级模式选中的节点（默认 1kHz 那段）
  let hovered = -1;
  let drag = null;
  let curveCache = null, curveDirty = true;
  let labelBox = null;

  /* ================================================================== *
   * 构建（只跑一次）
   * ================================================================== */
  function build() {
    const box = document.createElement('section');
    box.className = 'eqx';
    box.innerHTML = `
      <header class="eqx__head">
        <h2 class="eqx__title">音效</h2>
        <p class="eqx__sub">7 段均衡器 · 10 套预设 · 高级曲线编辑器（深色专业界面）</p>
      </header>

      <section class="eqx__sec" aria-labelledby="eq-h-quality">
        <div class="eqx__row">
          <h3 class="eqx__h" id="eq-h-quality">音质</h3>
          <span class="eqx__actual" id="eq-actual">—</span>
        </div>
        <div class="eqx__plat-tabs" id="eq-plat" role="group" aria-label="平台"></div>
        <div class="eqx__chips" id="eq-quality" role="group" aria-label="音质"></div>
        <p class="eqx__plathint" id="eq-plathint"></p>

        <div class="eqx__plat">
          <div class="eqx__plat-h">
            <span class="eqx__plat-t">平台支持</span>
            <span class="eqx__plat-lg">各平台档位名不同，按平台分别设置</span>
          </div>
          <div class="eqx__ptable-wrap">
            <table class="eqx__ptable" aria-label="各平台支持的音质档位">
              <thead>
                <tr>
                  <th scope="col">平台</th>
                  <th scope="col">可选档位</th>
                  <th scope="col">说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">网易云</th>
                  <td class="eqx__tiers">标准 128 · 较高 192 · 极高 320 · 无损 FLAC · Hi-Res 24/96</td>
                  <td class="eqx__pdesc">无损 / Hi-Res 需会员</td>
                </tr>
                <tr>
                  <th scope="row">QQ 音乐</th>
                  <td class="eqx__tiers">标准 128 · HQ 320 · SQ 无损</td>
                  <td class="eqx__pdesc">实际档位由 QQ 账号/会员决定</td>
                </tr>
                <tr>
                  <th scope="row">酷狗</th>
                  <td class="eqx__tiers">128 · 320 · FLAC</td>
                  <td class="eqx__pdesc">FLAC 看账号权限</td>
                </tr>
                <tr>
                  <th scope="row">汽水</th>
                  <td class="eqx__tiers">standard · high · lossless · hires</td>
                  <td class="eqx__pdesc">会员也只有 30 秒（取流限制，与档位无关）</td>
                </tr>
                <tr>
                  <th scope="row">波点</th>
                  <td class="eqx__tiers">standard · high · lossless · hires</td>
                  <td class="eqx__pdesc">视账号权限</td>
                </tr>
                <tr>
                  <th scope="row">酷我</th>
                  <td class="eqx__tiers">128 · 320 · FLAC</td>
                  <td class="eqx__pdesc">回退 web 通道时只有 mp3</td>
                </tr>
                <tr>
                  <th scope="row">本地文件</th>
                  <td class="eqx__tiers">跟随文件本身</td>
                  <td class="eqx__pdesc">没有平台档位</td>
                </tr>
                <tr>
                  <th scope="row">Spotify</th>
                  <td class="eqx__tiers">—</td>
                  <td class="eqx__pdesc">无音频直链，不参与音质档位</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="eqx__plat-foot">每个平台的档位独立保存，播放该平台曲目时生效。</p>
        </div>

        <div class="eqx__row eqx__row--end">
          <p class="eqx__note" id="eq-qnote"></p>
          <button class="eqx__btn" id="eq-reload" type="button">用当前音质重载当前曲</button>
        </div>
      </section>

      <section class="eqx__sec" aria-labelledby="eq-h-eq">
        <div class="eqx__row eqx__row--eq">
          <h3 class="eqx__h" id="eq-h-eq">均衡器</h3>
          <button class="eqx__sw" id="eq-on" type="button" role="switch" aria-checked="true" aria-label="均衡器总开关"><i></i></button>
          <span class="eqx__state" id="eq-on-txt">开</span>
          <div class="eqx__ctl">
            <div class="eqx__sel"><span>预设</span>
              <!-- 自绘下拉（2026-11-21）：安卓系统选择器太简陋，和这张调音台不搭 -->
              <div class="eqx__pick" id="eq-preset">
                <button class="eqx__pickbtn" id="eq-preset-btn" type="button"
                        aria-haspopup="listbox" aria-expanded="false">
                  <span id="eq-preset-lab">平直</span><i aria-hidden="true"></i>
                </button>
                <div class="eqx__picklist" id="eq-preset-list" role="listbox" hidden></div>
              </div>
            </div>
            <button class="eqx__btn" id="eq-reset" type="button">重置</button>
            <button class="eqx__btn eqx__btn--mode" id="eq-mode" type="button" aria-pressed="false">高级</button>
          </div>
        </div>

        <div class="eq-simple" id="eq-simple">
          <div class="eqbands-wrap">
            <div class="eqbands__scale" aria-hidden="true">
              <span>+12</span><span>+6</span><span>0</span><span>−6</span><span>−12</span>
            </div>
            <div class="eqbands" id="eq-bands"></div>
          </div>
          <div class="eq-simple__foot">
            <label class="eqw">
              <span class="eqw__lab">立体声宽度</span>
              <input class="eqw__input" id="eq-width" type="range" min="50" max="250" step="5" value="100">
              <span class="eqw__val" id="eq-width-val">1.00</span>
            </label>
            <span class="eqx__preamp" id="eq-preamp">前级 0.0 dB</span>
            <span class="eqx__haas" id="eq-haas" hidden></span>
          </div>
        </div>

        <div class="eq-adv" id="eq-adv" hidden>
          <div class="eq-adv__bar">
            <button class="eqx__btn" id="eq-adv-reset" type="button">全部重置</button>
            <button class="eqx__btn" id="eq-ab" type="button">A/B 对比</button>
            <span class="eq-adv__sp"></span>
            <span class="eq-adv__count" id="eq-count">7 节点</span>
            <span class="eq-adv__sel" id="eq-sel">—</span>
          </div>
          <div class="eq-canvas-wrap" id="eq-canvas-wrap">
            <canvas id="eq-canvas" tabindex="0" aria-label="均衡曲线编辑器：拖动节点改频率与增益，滚轮改 Q，双击旁通，右键切类型"></canvas>
          </div>
          <p class="eq-adv__hint">拖节点 = 频率 / 增益 · 滚轮或 Shift+拖 = Q · 双击 = 旁通 · 右键 = 切类型 · 方向键微调</p>
          <p class="eq-adv__hint eq-adv__hint--dim">曲线取自真实滤波器响应：7 个 BiquadFilterNode 串在播放链上，
            不是另画的公式；不加载 VST3，AudioWorklet 里也没有 require / module。</p>
        </div>
      </section>

      <footer class="eqx__foot">
        <span>信号链：2×&lt;audio&gt; → 每轨 Gain → 总线 → 7×BiquadFilterNode → 前级 → M/S 宽度 → Beat 分析器 → 输出</span>
        <span>设置存在 localStorage['lizi.eq.v1']（version 1，读到别的版本回默认）</span>
      </footer>`;

    /* 7 段滑杆：竖向、对齐到同一基线，值用 CSS 变量驱动位置 */
    const bands = $('#eq-bands', box);
    bands.innerHTML = EqEngine.BANDS.map((f, i) => `
      <div class="eqband" data-band="${i}">
        <span class="eqband__db" data-db="${i}">0.0</span>
        <div class="eqband__track" data-track="${i}" role="slider" tabindex="0"
             aria-label="${f >= 1000 ? f / 1000 + ' kHz' : f + ' Hz'}"
             aria-valuemin="-12" aria-valuemax="12" aria-valuenow="0">
          <i class="eqband__zero" aria-hidden="true"></i>
          <i class="eqband__fill" aria-hidden="true"></i>
          <i class="eqband__thumb" aria-hidden="true"></i>
        </div>
        <span class="eqband__hz">${fmtHz(f)}</span>
      </div>`).join('');

    /* 预设下拉（自绘，见上）：选项用按钮铺开，值仍然是 preset id */
    const presetList = $('#eq-preset-list', box);
    presetList.innerHTML = EqEngine.PRESETS.map((p) =>
      `<button type="button" role="option" aria-selected="false" data-id="${p.id}">${p.name}</button>`
    ).join('') + '<button type="button" role="option" aria-selected="false" data-id="custom">自定义</button>';

    /* 平台 tab（顺序即 PLATFORM_QUALITIES 的定义顺序） */
    $('#eq-plat', box).innerHTML = Object.keys(EqEngine.PLATFORM_QUALITIES).map((src) => `
      <button type="button" data-plat="${src}" aria-pressed="false">${EqEngine.platformLabel(src)}</button>`).join('');

    /* 构建完**先不挂**：整页和半页都靠 mount(host) 挂进去，
       否则面板会在打开之前就出现在文档流末尾。 */
    root = box;
    renderChips();
    wire();
    syncAll();
    resizeCanvas();
    requestAnimationFrame(loop);
    return box;  }

  /* ================================================================== *
   * 事件接线
   * ================================================================== */
  function wire() {
    /* --- 总开关 --- */
    $('#eq-on', root).addEventListener('click', () => {
      EqEngine.setEnabled(!EqEngine.state.on);
      syncAll();
    });

    /* --- 预设（自绘下拉） --- */
    const presetBtn = $('#eq-preset-btn', root);
    const presetListEl = $('#eq-preset-list', root);
    const presetWrap = $('#eq-preset', root);
    function closePreset() {
      presetListEl.hidden = true;
      presetWrap.classList.remove('is-open');
      presetBtn.setAttribute('aria-expanded', 'false');
    }
    presetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = presetListEl.hidden;
      presetListEl.hidden = !open;
      presetWrap.classList.toggle('is-open', open);
      presetBtn.setAttribute('aria-expanded', String(open));
    });
    presetListEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      const v = b.dataset.id;
      closePreset();
      if (v === 'custom') return;
      EqEngine.setPreset(v);
      syncAll();
    });
    document.addEventListener('click', (e) => {
      if (presetListEl.hidden) return;
      if (e.target.closest && e.target.closest('#eq-preset')) return;
      closePreset();
    });
    $('#eq-reset', root).addEventListener('click', () => {
      EqEngine.resetSimple();
      syncAll();
    });

    /* --- 模式切换：同一组 7 个滤波器，只是换编辑界面 --- */
    $('#eq-mode', root).addEventListener('click', () => {
      mode = mode === 'simple' ? 'advanced' : 'simple';
      EqEngine.setMode(mode);
      syncAll();
      if (mode === 'advanced') { resizeCanvas(); curveDirty = true; $('#eq-canvas', root).focus({ preventScroll: true }); }
    });

    /* --- 7 段竖向滑杆：自绘（原生 range 的竖向写法在各版本里表现不一致） --- */
    root.querySelectorAll('[data-track]').forEach((track) => {
      const i = Number(track.dataset.track);
      const valueAt = (clientY) => {
        const r = track.getBoundingClientRect();
        const ratio = clamp((r.bottom - clientY) / r.height, 0, 1);
        return Math.round((ratio * 24 - 12) * 2) / 2;
      };
      track.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        track.setPointerCapture(e.pointerId);
        track.classList.add('is-drag');
        EqEngine.setBandGain(i, valueAt(e.clientY));
        syncBands();
        const move = (ev) => { EqEngine.setBandGain(i, valueAt(ev.clientY)); syncBands(); };
        const up = () => {
          track.classList.remove('is-drag');
          track.removeEventListener('pointermove', move);
          track.removeEventListener('pointerup', up);
          track.removeEventListener('pointercancel', up);
        };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up);
        track.addEventListener('pointercancel', up);
      });
      track.addEventListener('keydown', (e) => {
        const cur = EqEngine.state.simple.gains[i];
        const step = e.shiftKey ? 3 : 0.5;
        let v = null;
        if (e.key === 'ArrowUp') v = cur + step;
        else if (e.key === 'ArrowDown') v = cur - step;
        else if (e.key === 'Home') v = 0;
        if (v === null) return;
        e.preventDefault();
        EqEngine.setBandGain(i, v);
        syncBands();
      });
      track.addEventListener('dblclick', () => {
        EqEngine.setBandGain(i, 0);
        syncBands();
      });
    });

    /* --- 宽度 --- */
    $('#eq-width', root).addEventListener('input', (e) => {
      EqEngine.setWidth(Number(e.target.value) / 100);
      syncSimpleMeta();
      curveDirty = true;
    });

    /* --- 平台 tab：只切面板在看哪个平台的档位，不重载当前曲 --- */
    $('#eq-plat', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-plat]');
      if (!b || b.dataset.plat === activePlatform) return;
      activePlatform = b.dataset.plat;
      renderChips();                 // 各平台档位名不同，chips 整排重画
      syncQuality();
    });

    /* --- 音质 --- */
    $('#eq-quality', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      EqEngine.setQualityFor(activePlatform, b.dataset.q);
      syncQuality();                 // 只更新文案；要听新档位用右边的「重载当前曲」
    });
    $('#eq-reload', root).addEventListener('click', async () => {
      const tr = currentTrack();
      if (!tr) return;
      const b = $('#eq-reload', root);
      b.disabled = true;
      b.textContent = '重载中…';
      try {
        if (typeof Player !== 'undefined') await Player.playAt(Player.state.index);
      } catch { /* 放不了就算了，音质这一格照样显示真实返回 */ }
      await refreshActual();
      b.disabled = false;
      b.textContent = '用当前音质重载当前曲';
    });

    /* --- 高级画布 --- */
    const cv = $('#eq-canvas', root);
    cv.addEventListener('pointerdown', onCanvasDown);
    cv.addEventListener('pointermove', onCanvasMove);
    cv.addEventListener('pointerup', onCanvasUp);
    cv.addEventListener('pointercancel', onCanvasUp);
    cv.addEventListener('pointerleave', () => { hovered = -1; });
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('dblclick', (e) => {
      const i = hitTest(e.offsetX, e.offsetY);
      if (i < 0) return;
      selected = i;
      EqEngine.setNode(i, { bypass: !EqEngine.state.advanced.nodes[i].bypass });
      curveDirty = true; syncAdv();
    });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const i = hitTest(e.offsetX, e.offsetY);
      if (i < 0) return;
      selected = i;
      EqEngine.cycleType(i);
      curveDirty = true; syncAdv();
    });
    cv.addEventListener('keydown', (e) => {
      const n = EqEngine.state.advanced.nodes[selected];
      if (!n) return;
      const fast = e.shiftKey;
      const k = e.key;
      let done = true;
      if (k === 'ArrowLeft') EqEngine.setNode(selected, { freq: n.freq * (fast ? 1.12 : 1.01) });
      else if (k === 'ArrowRight') EqEngine.setNode(selected, { freq: n.freq / (fast ? 1.12 : 1.01) });
      else if (k === 'ArrowUp') EqEngine.setNode(selected, { gain: n.gain + (fast ? 1 : 0.1) });
      else if (k === 'ArrowDown') EqEngine.setNode(selected, { gain: n.gain - (fast ? 1 : 0.1) });
      else if (k === 'Enter' || k === ' ') EqEngine.setNode(selected, { bypass: !n.bypass });
      else if (k === 'Delete' || k === 'Backspace') EqEngine.setNode(selected, { gain: 0 });
      else done = false;
      if (!done) return;
      e.preventDefault();
      curveDirty = true; syncAdv();
    });
    $('#eq-adv-reset', root).addEventListener('click', () => {
      EqEngine.resetAdvanced(); curveDirty = true; syncAdv();
    });
    $('#eq-ab', root).addEventListener('click', () => {
      EqEngine.toggleAB(); curveDirty = true; syncAdv();
    });

    /* --- 换歌：刷新"实际音质" --- */
    if (typeof Player !== 'undefined' && Player.on) {
      Player.on('trackchange', () => refreshActual());
      Player.on('source', () => refreshActual());
    }
    EqEngine.on('change', () => { curveDirty = true; });
    EqEngine.on('quality', () => { if (root) syncQuality(); });
  }

  const hitTest = (x, y) => {
    let best = -1, bestD = 14 * 14;
    const g = geom();
    EqEngine.state.advanced.nodes.forEach((n, i) => {
      const nx = xOf(n.freq, g), ny = yOf(n.bypass ? 0 : n.gain, g);
      const d = (nx - x) * (nx - x) + (ny - y) * (ny - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  function onCanvasDown(e) {
    const i = hitTest(e.offsetX, e.offsetY);
    if (i < 0) return;
    selected = i;
    const n = EqEngine.state.advanced.nodes[i];
    drag = { i, q0: n.q, y0: e.offsetY, shift: e.shiftKey };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    curveDirty = true; syncAdv();
  }

  function onCanvasMove(e) {
    const g = geom();
    if (!drag) {
      const h = hitTest(e.offsetX, e.offsetY);
      if (h !== hovered) { hovered = h; }
      return;
    }
    const n = EqEngine.state.advanced.nodes[drag.i];
    /* Shift + 拖 = 改 Q（向上加、向下减），不碰频率和增益 */
    if (e.shiftKey || drag.shift) {
      const q = clamp(drag.q0 * Math.exp((drag.y0 - e.offsetY) * 0.012), 0.1, 24);
      EqEngine.setNode(drag.i, { q: Math.round(q * 100) / 100 });
    } else {
      const f = clamp(fOf(e.offsetX, g), 20, 20000);
      const db = clamp(dbOf(e.offsetY, g), -24, 24);
      if (n.bypass) EqEngine.setNode(drag.i, { bypass: false });
      EqEngine.setNode(drag.i, { freq: Math.round(f * 10) / 10, gain: Math.round(db * 10) / 10 });
    }
    curveDirty = true; syncAdv(true);
  }

  function onCanvasUp() {
    if (!drag) return;
    drag = null;
    curveDirty = true;
  }

  function onWheel(e) {
    const g = geom();
    const i = hovered >= 0 ? hovered : selected;
    if (i < 0) return;
    e.preventDefault();
    const n = EqEngine.state.advanced.nodes[i];
    const q = clamp(n.q * Math.exp(-e.deltaY * 0.002), 0.1, 24);
    selected = i;
    EqEngine.setNode(i, { q: Math.round(q * 100) / 100 });
    curveDirty = true; syncAdv();
  }

  /* ================================================================== *
   * 同步 UI ← 引擎
   * ================================================================== */
  function syncAll() {
    const s = EqEngine.snapshot();
    mode = s.mode;
    $('#eq-on', root).setAttribute('aria-checked', String(s.on));
    $('#eq-on-txt', root).textContent = s.on ? '开' : '关';
    root.classList.toggle('is-off', !s.on);
    $('#eq-mode', root).textContent = mode === 'advanced' ? '简单' : '高级';
    $('#eq-mode', root).setAttribute('aria-pressed', String(mode === 'advanced'));
    $('#eq-simple', root).hidden = mode !== 'simple';
    $('#eq-adv', root).hidden = mode !== 'advanced';
    /* 预设下拉：标签写当前预设，列表里高亮选中项（改过滑杆后引擎会把
       preset 记成 'custom'，这时标签显示「自定义」）。 */
    const presetLab = $('#eq-preset-lab', root);
    if (presetLab) {
      const p = EqEngine.PRESETS.find((x) => x.id === s.preset);
      presetLab.textContent = p ? p.name : '自定义';
    }
    const presetListSync = $('#eq-preset-list', root);
    if (presetListSync) {
      presetListSync.querySelectorAll('button[data-id]').forEach((b) => {
        const on = b.dataset.id === s.preset;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    /* 高级模式下预设下拉是死的（预设只写 7 段增益，不碰频率/类型/Q），
       留着它只会让人以为切了有反应 —— 直接收起来。 */
    const psel = root.querySelector('.eqx__sel');
    if (psel) psel.hidden = mode === 'advanced';
    syncBands();
    syncSimpleMeta();
    syncQuality();
    syncAdv();
    if (mode === 'advanced') { resizeCanvas(); curveDirty = true; }
  }

  function bandVar(i, gain) {
    const bands = $('#eq-bands', root);
    const el = bands && bands.querySelector(`.eqband[data-band="${i}"]`);
    if (!el) return;
    /* 轨道映射：-12dB → 0%，0dB → 50%，+12dB → 100% */
    const v = (clamp(gain, -12, 12) + 12) / 24;
    el.style.setProperty('--v', v.toFixed(4));
    el.classList.toggle('is-boost', gain > 0.05);
    el.classList.toggle('is-cut', gain < -0.05);
    const dbEl = el.querySelector('.eqband__db');
    dbEl.textContent = fmtDb(gain);
    const tr = el.querySelector('.eqband__track');
    tr.setAttribute('aria-valuenow', String(gain));
    tr.setAttribute('aria-valuetext', fmtDb(gain) + ' dB');
  }

  function syncBands() {
    const g = EqEngine.state.simple.gains;
    for (let i = 0; i < 7; i++) bandVar(i, g[i]);
  }

  function syncSimpleMeta() {
    const s = EqEngine.state;
    $('#eq-width', root).value = String(Math.round(s.simple.width * 100));
    $('#eq-width-val', root).textContent = s.simple.width.toFixed(2);
    const pre = EqEngine.snapshot().preampDb;
    $('#eq-preamp', root).textContent = `前级 ${pre > 0 ? '+' : ''}${pre.toFixed(1)} dB`;
    const haas = $('#eq-haas', root);
    haas.hidden = !s.simple.haas;
    haas.textContent = s.simple.haas ? `Haas ${s.simple.haas} ms` : '';
  }

  /* 每个平台的档位名/权限规则都不一样，说明文案跟着 tab 换 */
  const QUALITY_NOTES = {
    netease: '无损 / Hi-Res 需网易云会员。未登录时上游不会报错，只会「静默降级」：'
      + '实测请求 lossless 返回 exhigh 320kbps，右上角显示实际拿到的档位。',
    qq: '无损（SQ）需 QQ 会员，实际档位由 QQ 账号决定。',
    kugou: 'FLAC 看账号权限，没权限上游会回 320/128。',
    qishui: '无损 / Hi-Res 需会员；会员取流也只有 30 秒（与档位无关）。',
    bodian: '无损 / Hi-Res 视账号权限。',
    kuwo: 'FLAC 看账号权限，回退 web 通道时只有 mp3。',
  };

  /* 音质 chips 按当前 tab 的平台重画；点击仍由 #eq-quality 上的委托处理 */
  function renderChips() {
    if (!root) return;
    const tiers = EqEngine.qualityTiers(activePlatform) || [];
    $('#eq-quality', root).innerHTML = tiers.map((q) => `
      <button type="button" data-q="${q.id}" aria-pressed="false">
        <b>${q.label}</b><em>${q.br}</em>${q.vip ? '<u>需会员</u>' : ''}
      </button>`).join('');
  }

  function syncPlatHint() {
    if (!root) return;
    const el = $('#eq-plathint', root);
    if (!el) return;
    const plat = EqEngine.platformLabel(activePlatform) || activePlatform;
    const tr = currentTrack();
    const curSrc = tr ? (tr.source || 'netease') : null;
    el.textContent = `正在设置「${plat}」的档位 · `
      + (curSrc === activePlatform ? '当前生效' : `播放${plat}曲目时生效`);
  }

  function syncQuality() {
    if (!root) return;
    const q = EqEngine.qualityFor(activePlatform);
    root.querySelectorAll('#eq-quality [data-q]').forEach((b) => {
      const on = b.dataset.q === q;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    root.querySelectorAll('#eq-plat [data-plat]').forEach((b) => {
      const on = b.dataset.plat === activePlatform;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#eq-qnote', root).textContent = QUALITY_NOTES[activePlatform] || '';
    syncPlatHint();
  }

  function syncAdv(light = false) {
    if (!root) return;
    const s = EqEngine.state;
    $('#eq-count', root).textContent = `${s.advanced.nodes.length} 节点`;
    const n = s.advanced.nodes[selected];
    if (n) {
      $('#eq-sel', root).textContent =
        `${EqEngine.TYPE_LABEL[n.type]} · ${fmtHz(n.freq)}Hz · ${fmtDb(n.bypass ? 0 : n.gain)}dB · Q ${n.q.toFixed(2)}`
        + (n.bypass ? ' · 已旁通' : '');
    }
    $('#eq-ab', root).textContent = `A/B 对比（${s.advanced.ab}）`;
    if (!light && mode === 'advanced') curveDirty = true;
  }

  /* ================================================================== *
   * 音质：真实返回
   * ================================================================== */
  function currentTrack() {
    if (typeof Player === 'undefined' || !Player.state || !Player.state.queue) return null;
    return Player.state.queue[Player.state.index] || null;
  }

  let actualSeq = 0;
  async function refreshActual() {
    if (!root) return;
    const tr = currentTrack();
    const box = $('#eq-actual', root);
    const seq = ++actualSeq;             // 换歌/换来源都作废上一次还没回来的查询
    syncPlatHint();                      // tab 不因换歌跳，但「当前生效」这句要跟着换
    if (!tr) { box.textContent = '未播放'; return; }
    const src = tr.source || 'netease';

    /* 按**曲目自己的源**说话，不按 tab。非网易云曲目绝不拿它的 id 去查
       网易云 songUrl —— 那是另一个平台的 id，查回来不是这首歌。 */
    if (src === 'qq') {
      const q = EqEngine.qualityFor('qq');
      const tier = (EqEngine.qualityTiers('qq') || []).find((t) => t.id === q);
      box.textContent = `QQ 音乐 · 当前请求 ${tier ? tier.br : q} · 实际档位由 QQ 账号/会员决定`;
      return;
    }
    if (src === 'local') {
      box.textContent = '本地文件 · 音质跟随文件本身（没有平台档位）';
      return;
    }
    if (src === 'spotify') {
      box.textContent = 'Spotify · 无音频直链，不参与音质档位';
      return;
    }
    if (src !== 'netease') {
      const tiers = EqEngine.qualityTiers(src);
      if (!tiers) { box.textContent = '该来源没有音质档位'; return; }
      const q = EqEngine.qualityFor(src);
      const tier = tiers.find((t) => t.id === q);
      box.textContent = `${EqEngine.platformLabel(src)} · 当前请求 ${tier ? tier.br : q}`;
      return;
    }

    box.textContent = '查询中…';
    /* 网易云偶尔会给一个空 data（冷连接超时/限流），一次失败不代表"拿不到"，
       重试一次再下结论 —— 否则界面会误报"没有地址"。 */
    let item = null, tries = 0;
    while (tries++ < 2) {
      try {
        const d = await API.songUrl(tr.id);
        item = (d.data || [])[0] || null;
      } catch { item = null; }
      if (item) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (seq !== actualSeq || !root) return;
    EqEngine.setActual(item);
    if (!item) {
      box.innerHTML = '<b class="is-warn">查询失败</b> · 上游两次都没有返回（重试一次也没成功）';
      return;
    }
    if (!item.url) {
      box.innerHTML = item.fee === 1
        ? `<b class="is-warn">该曲需会员（fee=1）</b> · 上游没有返回地址，播放器会用演示音`
        : '<b class="is-warn">上游没有返回播放地址</b>';
      return;
    }
    const req = EqEngine.state.quality;
    const got = item.level || '?';
    const degraded = got !== req;
    const gotLabel = (EqEngine.QUALITIES.find((q) => q.id === got) || {}).label || got;
    box.innerHTML =
      `实际拿到 <b>${gotLabel} ${Math.round((item.br || 0) / 1000)} kbps` +
      `${item.type ? ' ' + item.type : ''}</b>`
      + (degraded
        ? ` · 请求的是 <b>${(EqEngine.QUALITIES.find((q) => q.id === req) || {}).label || req}</b>，`
          + `<b class="is-warn">被上游降级${item.fee === 1 ? '（需会员）' : ''}</b>`
        : ' · 与请求一致');
  }

  /* ================================================================== *
   * 画布：几何 + 绘制
   * ================================================================== */
  function geom() {
    const cv = root && $('#eq-canvas', root);
    const dpr = cv ? (cv.width / Math.max(1, cv.clientWidth)) : 1;
    const w = cv ? cv.clientWidth : 1, h = cv ? cv.clientHeight : 1;
    /* 右侧留出 dB 刻度（±24，每 6 dB 一条），左侧只留一点呼吸位。
       所有绘制和命中测试都走同一套 xOf / yOf，改 pad 不会让节点错位。
       纵向范围保持 ±24：拖动上限不能被界面收窄。 */
    const pad = { l: 14, r: 38, t: 14, b: 24 };
    return {
      w, h, dpr,
      l: pad.l, t: pad.t,
      plotW: Math.max(1, w - pad.l - pad.r),
      plotH: Math.max(1, h - pad.t - pad.b),
      fMin: 20, fMax: 20000, dbMin: -24, dbMax: 24,
    };
  }
  const xOf = (f, g = geom()) => g.l + (Math.log10(clamp(f, g.fMin, g.fMax) / g.fMin) / Math.log10(g.fMax / g.fMin)) * g.plotW;
  const fOf = (x, g = geom()) => g.fMin * Math.pow(g.fMax / g.fMin, clamp((x - g.l) / g.plotW, 0, 1));
  const yOf = (db, g = geom()) => g.t + ((g.dbMax - clamp(db, g.dbMin, g.dbMax)) / (g.dbMax - g.dbMin)) * g.plotH;
  const dbOf = (y, g = geom()) => g.dbMax - ((clamp(y, g.t, g.t + g.plotH) - g.t) / g.plotH) * (g.dbMax - g.dbMin);

  function resizeCanvas() {
    if (!root) return;
    const cv = $('#eq-canvas', root);
    if (!cv || $('#eq-adv', root).hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(240, cv.clientWidth), h = Math.max(140, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    curveDirty = true;
  }

  let gridCanvas = null, gridKey = '';
  function drawGrid(ctx, g) {
    const key = `${g.w}x${g.h}x${g.dpr}`;
    if (gridCanvas && gridKey === key) { ctx.drawImage(gridCanvas, 0, 0, g.w, g.h); return; }
    const off = document.createElement('canvas');
    off.width = Math.round(g.w * g.dpr);
    off.height = Math.round(g.h * g.dpr);
    const c = off.getContext('2d');
    c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    c.fillStyle = '#151517';
    c.fillRect(0, 0, g.w, g.h);

    /* 频率网格：1 / 2 / 5 系列（20 50 100 200 500 1k 2k 5k 10k 20k），
       每个十倍程里只有这三条线，读起来是"标尺"，不是"格子布"。 */
    const majors = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    c.font = '9.5px "Geist Mono", ui-monospace, monospace';
    c.textBaseline = 'top';
    for (const f of majors) {
      const x = Math.round(xOf(f, g)) + 0.5;
      c.strokeStyle = f === 1000 ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.055)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, g.t); c.lineTo(x, g.t + g.plotH); c.stroke();
      /* 首尾两个标签不能按中心对齐，否则会被画布边缘裁掉半个字 */
      c.fillStyle = 'rgba(255,255,255,.42)';
      if (f === 20) { c.textAlign = 'left'; c.fillText(fmtHz(f), g.l, g.t + g.plotH + 6); }
      else if (f === 20000) { c.textAlign = 'right'; c.fillText(fmtHz(f), g.l + g.plotW, g.t + g.plotH + 6); }
      else { c.textAlign = 'center'; c.fillText(fmtHz(f), x, g.t + g.plotH + 6); }
    }
    /* 更细的 3/4/6/8 辅助线：只画不标 */
    for (const f of [30, 40, 60, 80, 300, 400, 600, 800, 3000, 4000, 6000, 8000]) {
      const x = Math.round(xOf(f, g)) + 0.5;
      c.strokeStyle = 'rgba(255,255,255,.028)';
      c.beginPath(); c.moveTo(x, g.t); c.lineTo(x, g.t + g.plotH); c.stroke();
    }

    /* dB 网格：刻度在右侧，±24，每 6 dB 一条；0 和 ±24 稍亮 */
    c.textAlign = 'left'; c.textBaseline = 'middle';
    for (const d of [-24, -18, -12, -6, 0, 6, 12, 18, 24]) {
      const y = Math.round(yOf(d, g)) + 0.5;
      const strong = d === 0 || d === -24 || d === 24;
      c.strokeStyle = strong ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.055)';
      c.beginPath(); c.moveTo(g.l, y); c.lineTo(g.l + g.plotW, y); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.42)';
      c.fillText(d > 0 ? '+' + d : String(d).replace('-', '−'), g.l + g.plotW + 8, y);
    }
    gridCanvas = off; gridKey = key;
    ctx.drawImage(off, 0, 0, g.w, g.h);
  }

  /* 画布角标：左上 EQ、右上 ±24 dB。放在数据之后画，避免被曲线压住。 */
  function drawBadges(ctx, g) {
    ctx.font = '9.5px "Geist Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.34)';
    ctx.fillText('EQ', g.l + 8, g.t + 6);

    const txt = '±24 dB';
    const tw = ctx.measureText(txt).width;
    const rx = g.l + g.plotW - 6;
    ctx.fillStyle = 'rgba(21,21,23,.86)';
    ctx.fillRect(rx - tw - 6, g.t + 3, tw + 6, 14);
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.textAlign = 'right';
    ctx.fillText(txt, rx, g.t + 6);
  }

  function drawSpectrum(ctx, g) {
    if (typeof Beat === 'undefined' || !Beat.spectrum) return;
    const spec = Beat.spectrum;
    if (!spec || !spec.length) return;
    const sr = EqEngine.sampleRate || 44100;
    const binHz = sr / 2 / spec.length;
    const floor = -78;                    // dBFS 下限（8bit 频谱 0 → 静音）
    ctx.beginPath();
    ctx.moveTo(g.l, g.t + g.plotH);
    for (let x = 0; x <= g.plotW; x += 2) {
      const f = fOf(g.l + x, g);
      const b0 = Math.max(0, Math.floor(f / binHz)), b1 = Math.max(b0, Math.floor(f * 1.06 / binHz));
      let v = 0;
      for (let b = b0; b <= b1 && b < spec.length; b++) v = Math.max(v, spec[b]);
      const db = v > 0 ? Math.max(floor, 20 * Math.log10(v / 255)) : floor;
      const y = yOf(db, g);
      ctx.lineTo(g.l + x, clamp(y, g.t, g.t + g.plotH));
    }
    ctx.lineTo(g.l + g.plotW, g.t + g.plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.045)';
    ctx.fill();
  }

  function drawCurve(ctx, g) {
    const n = Math.max(2, Math.round(g.plotW));
    const freqs = new Float32Array(n);
    for (let i = 0; i < n; i++) freqs[i] = fOf(g.l + i, g);
    const db = EqEngine.state.on ? EqEngine.responseDb(freqs) : new Float32Array(n);
    if (!curveCache || curveCache.length !== n) curveCache = new Float32Array(n);
    curveCache.set(db);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = g.l + i, y = yOf(db[i], g);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = EqEngine.state.on ? '#f0a63c' : 'rgba(255,255,255,.24)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function drawNodes(ctx, g) {
    const s = EqEngine.state;
    if (s.mode !== 'advanced') { labelBox = null; return; }
    const nodes = s.advanced.nodes;
    /* 先画曲线上的点，再画选中的那个（保证它在最上面） */
    nodes.forEach((n, i) => {
      if (i === selected) return;
      const x = xOf(n.freq, g), y = yOf(n.bypass ? 0 : n.gain, g);
      ctx.beginPath();
      ctx.arc(x, y, i === hovered ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = '#1b1b1f';
      ctx.fill();
      ctx.strokeStyle = n.bypass ? 'rgba(255,255,255,.26)' : 'rgba(240,166,60,.85)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    });
    const n = nodes[selected];
    if (n) {
      const x = xOf(n.freq, g), y = yOf(n.bypass ? 0 : n.gain, g);
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = n.bypass ? '#1b1b1f' : '#f0a63c';
      ctx.fill();
      ctx.strokeStyle = n.bypass ? 'rgba(255,255,255,.34)' : '#f0a63c';
      ctx.lineWidth = 2;
      ctx.stroke();
      /* 节点旁读数：只有选中的那个显示，否则 7 个标签会糊成一片 */
      const label = `${fmtHz(n.freq)}  ${fmtDb(n.bypass ? 0 : n.gain)}dB  Q${n.q.toFixed(2)}`;
      ctx.font = '10px "Geist Mono", ui-monospace, monospace';
      const tw = ctx.measureText(label).width;
      let bx = x + 10, by = y - 24;
      if (bx + tw + 8 > g.l + g.plotW) bx = x - tw - 18;
      if (by < g.t + 2) by = y + 12;
      bx = clamp(bx, g.l, g.l + g.plotW - tw - 8);
      by = clamp(by, g.t + 1, g.t + g.plotH - 18);
      ctx.fillStyle = 'rgba(20,20,22,.94)';
      ctx.fillRect(bx - 3, by - 2, tw + 6, 15);
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 2.5, by - 1.5, tw + 5, 14);
      ctx.fillStyle = n.bypass ? 'rgba(255,255,255,.38)' : '#dcdce0';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(label, bx, by);
      labelBox = { x: bx - 3, y: by - 2, w: tw + 6, h: 15 };
    } else labelBox = null;
  }

  function draw() {
    if (!root) return;
    const cv = $('#eq-canvas', root);
    if (!cv || $('#eq-adv', root).hidden) return;
    if (!cv.width || !cv.height) resizeCanvas();
    const g = geom();
    const ctx = cv.getContext('2d');
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    drawGrid(ctx, g);
    drawSpectrum(ctx, g);
    drawCurve(ctx, g);
    drawNodes(ctx, g);
    drawBadges(ctx, g);
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!root || !root.isConnected) return;
    if (root.offsetParent === null) return;      // 整页没开 / 半页收起：不画
    if ($('#eq-adv', root).hidden) return;
    draw();
  }

  /* ================================================================== *
   * 宿主：整页 / 半页覆盖
   * ================================================================== */
  function mount(target) {
    /* 每次打开面板都默认选中当前曲目的平台（网易云的 source 可能是
       undefined 或 'netease'，都当网易云；没有曲目 / 源不在表里也选网易云）。
       面板开着时用户手动切的 tab 由 wire() 保持 —— trackchange 不会走这里。 */
    const tr = currentTrack();
    const src = tr ? (tr.source || 'netease') : 'netease';
    activePlatform = EqEngine.qualityTiers(src) ? src : 'netease';
    if (!root) build();
    renderChips();
    if (target && root.parentElement !== target) target.appendChild(root);
    resizeCanvas();
    curveDirty = true;
    syncAll();
    refreshActual();
    requestAnimationFrame(() => { resizeCanvas(); draw(); });
  }

  function openPage() {
    const host = document.getElementById('eq-host-page');
    if (!host) return;
    closeSheet(true);
    mount(host);
    root.classList.add('is-page');
    root.classList.remove('is-sheet');
  }

  function openSheet() {
    const host = buildSheet();
    const h = document.getElementById('eq-host-sheet');
    if (!h) return;
    sheet.hidden = false;
    sheet.classList.add('is-open');
    sheetOpen = true;
    document.body.classList.add('is-eqsheet');
    mount(h);
    root.classList.add('is-sheet');
    root.classList.remove('is-page');
    requestAnimationFrame(() => {
      resizeCanvas();
      draw();
      const cv = $('#eq-canvas', root);
      if (mode === 'advanced' && cv) cv.focus({ preventScroll: true });
    });
    host.focus && host.focus({ preventScroll: true });
  }

  function buildSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'eqsheet';
    sheet.id = 'eq-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `
      <div class="eqsheet__scrim" data-eq-close></div>
      <section class="eqsheet__panel" role="dialog" aria-modal="true" aria-label="音效">
        <header class="eqsheet__bar">
          <span class="eqsheet__grip" id="eq-grip" aria-hidden="true"></span>
          <h2 class="eqsheet__t">音效</h2>
          <button class="eqsheet__x" id="eq-sheet-x" type="button" aria-label="关闭音效面板">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>
          </button>
        </header>
        <div class="eqsheet__host" id="eq-host-sheet"></div>
      </section>`;
    document.body.appendChild(sheet);

    sheet.querySelector('[data-eq-close]').addEventListener('click', () => closeSheet());
    $('#eq-sheet-x').addEventListener('click', () => closeSheet());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetOpen) { e.stopPropagation(); closeSheet(); }
    });
    /* 下滑关闭：跟手，松手时按位移和速度决定回弹还是收起 */
    const panel = sheet.querySelector('.eqsheet__panel');
    const grip = $('#eq-grip');
    let d = null;
    const down = (e) => {
      d = { y0: e.clientY, dy: 0, t0: performance.now() };
      panel.style.transition = 'none';
      grip.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!d) return;
      d.dy = Math.max(0, e.clientY - d.y0);
      panel.style.transform = `translateY(${d.dy}px)`;
    };
    const up = () => {
      if (!d) return;
      const v = d.dy / Math.max(1, performance.now() - d.t0);
      panel.style.transition = '';
      panel.style.transform = '';
      if (d.dy > 110 || v > 0.9) closeSheet();
      d = null;
    };
    grip.addEventListener('pointerdown', down);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    return sheet;
  }

  function closeSheet(silent = false) {
    if (!sheet || !sheetOpen) { if (sheet) { sheet.hidden = true; sheet.classList.remove('is-open'); } return; }
    sheetOpen = false;
    sheet.classList.remove('is-open');
    document.body.classList.remove('is-eqsheet');
    const panel = sheet.querySelector('.eqsheet__panel');
    if (panel) { panel.style.transform = ''; panel.style.transition = ''; }
    const hide = () => { if (!sheetOpen && sheet) sheet.hidden = true; };
    if (silent) hide(); else setTimeout(hide, 280);
  }

  /* ================================================================== *
   * 启动
   * ================================================================== */
  /* EqEngine 自己会在脚本末尾 init()（持久化必须在第一次 load 之前生效），
     这里不再重复初始化，只接一个尺寸监听。 */
  /* 画布尺寸变化（窗口缩放、整页/半页切换）都要重新量一遍 */
  window.addEventListener('resize', () => { resizeCanvas(); curveDirty = true; });

  return {
    build, openPage, openSheet, closeSheet, mount,
    get isSheetOpen() { return sheetOpen; },
    get root() { return root; },
    /* 测试用：画布的坐标换算必须是**同一个函数**，否则"曲线和响应一致"就成了自证 */
    debug: {
      geom: () => { const g = geom(); return { ...g, mode }; },
      xOf, yOf, fOf, dbOf,
      nodeXY: (i) => {
        const n = EqEngine.state.advanced.nodes[i];
        const g = geom();
        return { x: xOf(n.freq, g), y: yOf(n.bypass ? 0 : n.gain, g), dpr: g.dpr };
      },
      labelBox: () => labelBox,
      curve: () => curveCache && Array.from(curveCache),
      refreshActual,
    },
  };
})();

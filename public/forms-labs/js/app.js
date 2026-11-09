import { initScene } from './scene.js?v=3';

const DATA = window.LIZI_FORMS;
/* 2026-11-09 与桌面形态菜单同步：504、519 固定最前，其余整体倒序。
   data.js 是生成文件（文件头也写了别手改），所以只在传给场景前重排一份副本。 */
const ITEMS = (() => {
  const fixed = ['504', '519'];
  const head = fixed.map((id) => DATA.items.find((it) => it.id === id)).filter(Boolean);
  return head.concat(DATA.items.filter((it) => it.id !== '504' && it.id !== '519').reverse());
})();
const $ = (s, r = document) => r.querySelector(s);

const body = document.body;
const bootEl = $('#boot');
const captionEl = $('#caption');
const orbitEl = $('#orbit-read');

const capEnterEl = $('#cap-enter');
const capKindEl = $('#cap-kind');

/* 全屏形态层：本页打开真实作品，不依赖父窗口 */
const stageLayerEl = $('#stage-layer');
const stageFrameEl = $('#sl-frame');
const stageIdEl = $('#sl-id');
const stageNameEl = $('#sl-name');
const stageErrorEl = $('#sl-error');
const stageBackBtn = $('#sl-back');
const stageErrorBackBtn = $('#sl-error-back');

const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '');

/* ── 页脚滚动条：只用 LIZI 自己的文案 ───────────────────────────────────── */
function fillTicker() {
  const line = `LIZI AIR · ${DATA.count} FORMS · 形态长廊 · FORM GALLERY · DRAG TO ORBIT · `;
  $('#ticker-track').innerHTML =
    `<span>${line}</span><span aria-hidden="true">${line}</span>`;
}

/* ── 计数 ─────────────────────────────────────────────────────────────── */
function fillCounts() {
  $('#forms-count').textContent = `${DATA.count} FORMS`;
  $('#form-total').textContent = String(DATA.count);
}

/* ── caption：点一格，出形态名 + 描述；不加载 iframe，不实时渲染 ───────── */
let captionItem = null;

function showCaption(item) {
  captionItem = item;
  const idx = ITEMS.indexOf(item);
  $('#cap-id').textContent = item.id;
  $('#cap-index').textContent = `${String(idx + 1).padStart(3, '0')} / ${DATA.count}`;
  $('#cap-name').textContent = plain(item.name);
  $('#cap-desc').textContent = plain(item.desc);

  // 有 url 才能进真实形态；占位/特效类只留一句说明
  const src = stageSrc(item);
  capEnterEl.hidden = !src;
  capKindEl.textContent = src ? '真实形态' : '暂无实时形态';

  captionEl.classList.add('show');
  captionEl.setAttribute('aria-hidden', 'false');
  // 焦点落到 caption 上：再按 Tab 就正好到「进入形态」
  try { captionEl.focus({ preventScroll: true }); } catch { /* 忽略 */ }
}

function hideCaption() {
  captionEl.classList.remove('show');
  captionEl.setAttribute('aria-hidden', 'true');
}

/* ── 格子 → 真实形态：本页全屏 iframe 层 ─────────────────────────────── */
let stageOpen = false;
let stageToken = 0;
let stageTimer = 0;
let stageLoaded = false;
let stageFailed = false;

function stageSrc(item) {
  const u = item && item.url;
  if (!u || !/^stages\/[^"'\\\s]+$/.test(u)) return null;
  // forms-labs/ 往上一级就是 public/，../stages/... 在服务器和 file:// 下都成立
  return `../${u}`;
}

function showStageError() {
  if (!stageOpen) return;
  stageFailed = true;
  stageLoaded = false;
  stopStageDemo();
  clearTimeout(stageTimer);
  stageFrameEl.hidden = true;
  stageErrorEl.hidden = false;
  try { stageFrameEl.src = 'about:blank'; } catch { /* 忽略 */ }
  requestAnimationFrame(() => stageErrorBackBtn.focus());
}

function bindStageKeys() {
  // 焦点进了 iframe 之后父窗口收不到 Esc；同源时直接挂到子文档上
  try {
    const win = stageFrameEl.contentWindow;
    if (!win || win.__liziStageKeys) return;
    win.__liziStageKeys = true;
    win.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && stageOpen) {
        e.preventDefault();
        closeStage();
      }
    });
  } catch { /* 跨源就只靠父窗口的 Esc */ }
}

/* 形态页只画背景、唱词要父页面喂 init / tick / beat（和主应用同一套协议）。
   长廊里没有播放器，就喂一段固定示例，让进入后看到形态真的在动。 */
const STAGE_DEMO_LINES = [
  { t: 0.0, dur: 4.2, text: '风把字吹进夜里' },
  { t: 4.2, dur: 3.8, text: '每一种歌词都有形状' },
  { t: 8.0, dur: 4.2, text: '声音落下，长出轮廓' },
  { t: 12.2, dur: 4.4, text: 'LIZI AIR · 形态长廊' },
];
const STAGE_DEMO_LOOP = 17;        // 一轮示例走完从头再来

let demoTimer = 0;
let demoRun = 0;
let demoStart = 0;
let demoBeatAt = -1;

function postStage(type, payload) {
  if (!stageOpen) return;
  try {
    stageFrameEl.contentWindow.postMessage({ __c100: 1, type, payload }, '*');
  } catch { /* 忽略 */ }
}

function stopStageDemo() {
  demoRun++;
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = 0;
}

function runStageDemo(run) {
  if (!stageOpen || run !== demoRun) return;
  demoStart = performance.now();
  demoBeatAt = -1;
  postStage('init', {
    song: null,
    accent: [150, 165, 255],
    lines: STAGE_DEMO_LINES,
    duration: STAGE_DEMO_LOOP,
  });
  clearInterval(demoTimer);
  demoTimer = setInterval(() => {
    if (!stageOpen || run !== demoRun) return;
    const t = (performance.now() - demoStart) / 1000;
    if (t >= STAGE_DEMO_LOOP) { runStageDemo(run); return; }
    postStage('tick', { time: +t.toFixed(3), playing: true });
    if (t - demoBeatAt >= 0.6) {
      demoBeatAt = t;
      postStage('beat', { level: 0.55, bass: 0.5, treble: 0.45 });
    }
  }, 100);
}

function startStageDemo() {
  stopStageDemo();
  runStageDemo(demoRun);
}

function openStage(item) {
  const src = stageSrc(item);
  if (!src) return;
  const token = ++stageToken;

  stageOpen = true;
  stageLoaded = false;
  stageFailed = false;
  stopStageDemo();
  stageIdEl.textContent = item.id;
  stageNameEl.textContent = plain(item.name);
  stageFrameEl.title = `${item.id} · ${plain(item.name)}`;
  stageFrameEl.hidden = false;
  stageErrorEl.hidden = true;

  stageLayerEl.classList.add('show');
  stageLayerEl.setAttribute('aria-hidden', 'false');

  // 两套 WebGL 不同时跑：画廊 rAF 与指针交互都冻住，角度/滚动位置原样保留
  if (sceneApi && sceneApi.pause) sceneApi.pause();

  clearTimeout(stageTimer);
  stageTimer = setTimeout(() => {
    if (stageOpen && token === stageToken && !stageLoaded) showStageError();
  }, 15000);

  stageFrameEl.src = src;

  // 404 时浏览器仍会触发 iframe load，所以先 HEAD 探一下；file:// 下 fetch 会失败，忽略即可
  fetch(src, { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      if (!res.ok && (res.status === 404 || res.status === 410) &&
          stageOpen && token === stageToken) showStageError();
    })
    .catch(() => { /* 交给 iframe 自己的 load/error */ });

  requestAnimationFrame(() => stageBackBtn.focus());
}

function closeStage() {
  if (!stageOpen) return;
  stageOpen = false;
  stageToken++;
  stopStageDemo();
  clearTimeout(stageTimer);
  stageLayerEl.classList.remove('show');
  stageLayerEl.setAttribute('aria-hidden', 'true');

  // 画廊从原来的角度/滚动位置继续
  if (sceneApi && sceneApi.resume) sceneApi.resume();

  // 等淡出结束再卸掉作品文档
  setTimeout(() => {
    if (!stageOpen) {
      try { stageFrameEl.src = 'about:blank'; } catch { /* 忽略 */ }
    }
  }, 320);

  if (captionEl.classList.contains('show') && !capEnterEl.hidden) {
    requestAnimationFrame(() => capEnterEl.focus());
  }
}

stageFrameEl.addEventListener('load', () => {
  if (!stageOpen) return;
  if (stageFrameEl.getAttribute('src') === 'about:blank') return;
  stageLoaded = true;
  clearTimeout(stageTimer);
  if (!stageFailed) stageErrorEl.hidden = true;
  bindStageKeys();
  startStageDemo();
});

stageFrameEl.addEventListener('error', () => {
  if (stageOpen) showStageError();
});

capEnterEl.addEventListener('click', () => {
  if (captionItem) openStage(captionItem);
});
stageBackBtn.addEventListener('click', closeStage);
stageErrorBackBtn.addEventListener('click', closeStage);

$('#cap-close').addEventListener('click', hideCaption);
$('#logo').addEventListener('click', (e) => {
  e.preventDefault();
  if (stageOpen) closeStage();
  hideCaption();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // 先关形态层，再关 caption；没有形态层时保持原来的 Esc 行为
  if (stageOpen) {
    e.preventDefault();
    closeStage();
    return;
  }
  hideCaption();
});

/* ── curvature control ────────────────────────────────────────────────── */
const bulgeEl = $('#bulge');
const bulgeVal = $('#bulge-val');
let sceneApi = null;
let lastOrbit = '';

function bindBulge() {
  const apply = () => {
    const v = Number(bulgeEl.value) / 100;
    bulgeVal.textContent = bulgeEl.value;
    if (sceneApi) sceneApi.setBulge(v);
  };
  bulgeEl.addEventListener('input', apply);
  apply();
}

/* ── scene ────────────────────────────────────────────────────────────── */
let booted = false;

function finishBoot() {
  if (booted) return;
  booted = true;
  body.classList.add('ready');
  bootEl.classList.add('done');
}

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

fillTicker();
fillCounts();

if (!webglOK()) {
  $('#boot-notice').hidden = false;
  $('.boot-loading').style.display = 'none';
} else {
  let started = false;
  try {
    sceneApi = initScene({
      canvas: $('#gl'),
      items: ITEMS,
      onProgress: (loaded) => { if (loaded >= 10) finishBoot(); },
      onPick: showCaption,
      onFrame: ({ turn }) => {
        const s = `ORBIT ${turn.toFixed(1).padStart(5, '0')}°`;
        if (s !== lastOrbit) {
          lastOrbit = s;
          orbitEl.textContent = s;
        }
      },
    });
    bindBulge();
    started = true;
  } catch (err) {
    console.error(err);
    $('#boot-notice').hidden = false;
    $('.boot-loading').style.display = 'none';
  }
  // 本地图片很多，但别让启动层一直挡着；初始化失败时保留报错
  if (started) setTimeout(finishBoot, 2800);
}

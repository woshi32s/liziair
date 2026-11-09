/**
 * pages/myalbums.js —— 我的专辑 · 3D 专辑陈列架（ESM）
 *
 * 一屏里用 CSS 3D 摆一排收藏的封面。两种形态，共用同一份 DOM、同一套交互：
 *
 *   spine（默认 · 侧立 3D 架）：封面侧着立起来扇开 —— 中间那张只剩一条正对镜头的
 *          立脊，左右两侧各翻出封面 / 封底的一窄条，像唱片店里侧立的碟。
 *   flow （可选 · 正面 Cover Flow）：中间那张正对镜头，两侧按透视后退 + 向外旋开，
 *          就是原来那一版，一个数没改。
 *
 * 拖拽 / 横向滚轮 / ←→ 转动整排，Enter 或点某张 → 打开它的专辑页。
 *
 * 两套几何都出自参考文件 3d_cd_cover_flow.html 的 #stageContainer：
 *   · 「角度 + 扇开 + 间距 + 俯仰」四个参数逐行照搬（见 layoutSpine / TUNE 的注释）
 *   · 六面盒子里的立脊、封面、封底、上下沿厚度也照它的 CSS 搭（见 pages.css .ma-*）
 *   · 但深色玻璃 / Tailwind CDN / 内嵌 base64 图 / 那四组滑杆 / 立脊切换按钮 /
 *     细调 popover **一概不带**（用户明确要求把这些小控件藏起来，只留右上角那颗按钮）
 *
 * 视觉是项目自己的语言：纸白、墨色、1px 细线、封面才有极柔阴影、等宽数字。
 */

import { ensureCss, esc, imgSrc } from './util.js';
import * as collection from './collection.js';

/* ------------------------------------------------------------------ *
 * 可调参数（都是实测值，改这里就行）
 *
 * FLOW —— 正面 Cover Flow（原来那版，一个数没动）
 *   gap   相邻封面中心的水平间距     fan   两侧张角上限
 *   pitch 整架俯仰（rotateX）        z0    中间那张朝观众推近多少（≠0：它要比两侧"近"）
 *   dz    每远离一格往后退多少       persp 舞台 perspective（数值小=透视更凶）
 *
 * REF —— 侧立 3D 架，照参考文件 3d_cd_cover_flow.html 抄下来的四个参数。
 *   参考里的基准是 **420px 封面**（--album-size:420px）。本轮用户要求"跟着窗口变化、
 *   占窗口一大半"，所以封面改成 **视口自适应**：clamp(360, min(vw*0.62, vh*0.78), 1400)
 *   （1440×900 → 702；1920×1080 → 842），间距 / 透视 / 立脊半厚继续按 size/420 等比换算
 *   （q = size/420），观感才和参考一致：
 *     size    420   换算基准（只用来做换算基准，不直接用）
 *     spacing 156   相邻「立脊」的水平间距（参考 customSpacing）
 *     fan     22    扇开角（参考 fanSpreadAngle，tanh 饱和到 ±22°）
 *     damp    0.85  tanh 的阻尼（参考里的 *0.85）
 *     pitch   0     整架俯仰（参考 shelfPitchAngle 默认值；滑杆范围 ±20 没搬）
 *     perspStage 2200 / perspBox 1800  舞台透视 + 每张卡自带的透视（参考原值）
 *   角度基线另外写死在 layoutSpine() 里：参考 defaultViewAngle=90 → rotateY 基线 -90°
 *   （-90° 正是「立脊正对镜头」那一面；中卡的立脊角因此归一后是 0°）。
 *   立脊上的小图：参考 .spine-badge（11px / 420 封面），本项目 = 脊宽的 ~72%，
 *   夹在 20~26px（见 pages.css .ma-item__sbadge）。
 * ------------------------------------------------------------------ */
const MAX = 40;
const FORM_KEY = 'lizi.myAlbums.form';
const BG_KEY = 'lizi.myAlbums.bg';          /* 'ambient'（默认，跟当前专辑封面色）| 'plain'（纯纸白） */
const FORMS = { spine: '侧立 3D', flow: '正面 Cover Flow' };
const FLOW = { size: 300, gap: 196, fan: 26, pitch: 3.5, z0: 44, dz: 118, persp: 1800 };
const REF = { size: 420, spacing: 156, fan: 22, damp: 0.85, pitch: 0, perspStage: 2200, perspBox: 1800 };
/* 特写（openProgress → 1）的几何：第二轮的四个数，都是从实测里调出来的
 *   angle  -18°  正封明显朝侧（原来 -6°，用户嫌"像一个平面"）
 *   tiltX  5.4°  rotateX（原来 2.2°）
 *   slide  0.56  黑胶滑出量（原来 0.38，中心 label 全被正封盖住）
 *   shift  76    q 倍左移：把正封让到左边，滑出来的黑胶才不会顶出舞台右边
 *   z      40    参考 L1086 closeUpZ（朝观众推近），按 q 缩放 */
const CLOSE = { angle: -18, tiltX: 5.4, slide: 0.56, shift: 96, z: 40, rz: -1.4 };
/* 指针微动（3D 视差）：参考文件里没有，是本项目自己加的。
 *   rx 4° 由指针纵向（-ny）驱动，ry 5° 由横向（nx）驱动，每帧缓动 8%。 */
const TILT = { rx: 4, ry: 5, ease: 0.08 };
const REDUCE = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 侧立形态的封面边长 —— 视口自适应（宽 + 高都参与）。
 *     size = clamp(300, min(vw * 0.40, vh * 0.50), 1000)
 *   用户嫌 702 太大（占短边 78%），要「大概占窗口一半、不超出显示区」，所以：
 *   1440×900 → 450（正好半个屏高）、1920×1080 → 540、1280×800 → 400；
 *   窄窗口时由宽度先到顶（vw*0.40）。上限压到 1000，4K 下也不会糊。
 *   正面 Cover Flow 的 300px 不动（用户只说侧立这版大）。 */
function spineSize(vw, vh) {
  const w = vw > 0 ? vw : 1440;
  const h = vh > 0 ? vh : Math.round(w * 0.625);
  return Math.round(Math.max(300, Math.min(1000, Math.min(w * 0.40, h * 0.50))));
}

/** 取图尺寸：目标显示尺寸的 2 倍（DPR 上限 2），100px 取整，夹在 640~2000。
 *   网易云图源实测最大 2000×2000（?param=2000y2000，再大就回 2000），
 *   所以 1920×1080（封面 842）取 1700 —— naturalWidth 是显示宽的 2 倍出头。 */
const IMG_MIN = 640;
const IMG_MAX = 2000;
function imgReqFor(display) {
  const want = Math.ceil((display * 2) / 100) * 100;
  return Math.max(IMG_MIN, Math.min(IMG_MAX, want));
}

/** 按视口缩一版（flow 的 k 分档不动；侧立按 vw + vh 算） */
function tuneFor(w, h) {
  const k = w < 620 ? 0.56 : w < 980 ? 0.74 : w < 1280 ? 0.9 : 1;
  const r = (v) => Math.round(v * k);
  const size = r(FLOW.size);
  const ssize = spineSize(w, h);
  const q = ssize / REF.size;            /* 参考文件是 420px 封面；间距 / 透视全按它等比 */
  return {
    size, ssize, k,
    img: imgReqFor(ssize), fimg: imgReqFor(size),
    /* flow（一个数没动） */
    gap: r(FLOW.gap),
    fan: w < 620 ? 20 : FLOW.fan,
    pitch: FLOW.pitch,
    z0: r(FLOW.z0), dz: r(FLOW.dz), persp: FLOW.persp,
    /* spine（等比换算参考的四个参数） */
    sgap: Math.round(REF.spacing * q),
    sfan: REF.fan,
    spitch: REF.pitch,
    spersp: Math.round(REF.perspStage * q),
    sperspBox: Math.round(REF.perspBox * q),
    /* 参考 L1043 closeUpGap / L1086 closeUpZ：特写时把邻居推开多少 / 朝观众推多近 */
    sclose: Math.round(245 * q),
    scloseZ: Math.round(CLOSE.z * q),
    /* 特写那张整体左移多少（给滑出来的黑胶留地方，见 CLOSE.shift） */
    sopen: Math.round(CLOSE.shift * q),
  };
}

let M = tuneFor(1440, 900);

/** 当前形态下一张封面有多大（两种形态的尺度不同：侧立架更大一档） */
const sizePx = () => (form === 'spine' ? M.ssize : M.size);

/** 当前形态该按多大取图（正封 / 封底 / 黑胶 label 共用） */
const artReq = () => (form === 'spine' ? M.img : M.fimg);
/** 已经下发到 DOM 的取图尺寸（只升不降：窗口变大才换更大的图，来回拖不会反复请求） */
let artReqUsed = 0;

/** 形态：'spine'（默认）| 'flow'。存储键 lizi.myAlbums.form；其它值一律当 spine。 */
function readForm() {
  try { return localStorage.getItem(FORM_KEY) === 'flow' ? 'flow' : 'spine'; } catch (e) { return 'spine'; }
}
let form = readForm();

const S = {
  el: null, root: null, stage: null, world: null,
  items: [], veils: [], keys: '',                      // keys = 当前渲染的 id 序列
  sel: 0, pos: 0, target: 0, vel: 0,
  open: -1, openP: [],                                 // 特写：哪一张开着 + 每张的 0→1 开合进度
  drag: null, raf: 0, bound: false, noteTimer: 0,
  /* 环境色：当前色相 + 补间 rAF */
  ambH: NaN, ambRaf: 0,
  /* 指针微动（3D 视差）：tx/ty = 目标角，x/y = 当前角，都是"叠加在 .ma-world 上"的 deg */
  tx: 0, ty: 0, x: 0, y: 0,
};

const byId = () => document.getElementById('view-myalbums');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const albumIdOf = (a) => String(a.id).slice(String(a.source || 'netease').length + 1);

/* 视图切换计数：openItem() 的兜底用它的变化判断"这次点击有没有人接住"。
   app.js 的 [data-alb] 代理是异步的（要 await import nav.js），单看 data-view 会看漏。 */
let showTick = 0;
document.addEventListener('lizi:show', () => { showTick++; });

/** 视图在前台吗（前台才跑 rAF；不在就停，别在后台空转） */
const active = () => {
  const el = S.el || byId();
  if (!el) return false;
  return document.body.dataset.view === 'myalbums' || el.classList.contains('is-active');
};

/* ==================================================================
 * 0. 立脊配色 + 环境色 —— 参考文件里每张专辑自带的 spineBg / spineText / ambient
 * ==================================================================
 * 参考的数据形状（L738-740 / L749-751 / …）：每项除了 cover，还写死了三个颜色
 *     spineBg: '#39324b'   spineText: '#e2dff0'   ambient: 'rgba(139, 92, 246, 0.25)'
 * 写入处在两处：
 *     L961 / L972  <div class="face-spine-*" style="background-color:${album.spineBg}; color:${album.spineText}">
 *     L1336-1337   document.documentElement.style.setProperty('--ambient-color', album.ambient)
 *
 * ⚠ 参考里**没有**任何"从封面取色"的代码 —— 那 8 组脊色是手写死的。所以我们想要
 *   "绿封面出绿脊"就不能照抄，取色必须自己算，而且必须算对：第一版取"最鲜艳的那一簇"，
 *   被封面上小面积的高饱和红字带跑，绿封面出了红脊（用户第二轮截图打回的就是这个）。
 *   现在改成**整图色相直方图**（见 coverHueHist）：按色相分 12 桶、以彩度为权重累加，
 *   取权重最大的桶 —— 大面积的主色永远压过小面积的点缀色。
 *
 * 三层来源，优先级从高到低：
 *   1) 封面取色（主路）：24×24 canvas → 逐像素 OKLCH → 12 个色相桶 → 主桶加权平均；
 *   2) 预置色板 PT（10 组，按 id 哈希稳定分配）：无封面 / 取色失败 / canvas 污染 /
 *      近灰（主桶彩度 < 0.035）/ 6s 超时，一律回退到这里，一渲染就一定是多色的；
 *   3) 文字色按脊底亮度算对比度：浅底用墨、深底用近白。
 * 脊底 / 环境色的配方（验收按这个量）：
 *   脊底  oklch(34% chromaClamp(0.05,0.13) h)
 *   脊字  近白 oklch(96.8% 0.012 h) 或 墨 oklch(21.5% 0.02 h)，取对比度高的
 *   环境  oklch(72% 0.10 h / 0.38)   （纸白上那层色晕；落地光 / 暗角在 pages.css）
 */

/* 预置色板：{ l: OKLCH 亮度, c: 彩度, h: 色相 }，10 组。
   色相取自参考文件那 8 组手写脊色的实测 OKLCH 色相（#39324b→297°、#46586e→254°、
   #e4e7ec→261°、#27272a→286°、#6e6444→93°、#8c2d19→34°、#375899→263°、#1b2434→262°），
   再补青 / 墨绿 / 砖红三支，铺成 10 组：紫 / 蓝灰 / 浅灰 / 深灰 / 琥珀 / 玫红 / 青 / 墨绿 / 靛蓝 / 砖红。 */
const PT = [
  { l: 0.336, c: 0.070, h: 297 },   /* 紫罗兰（参考 #39324b） */
  { l: 0.445, c: 0.050, h: 254 },   /* 蓝灰（参考 #46586e） */
  { l: 0.840, c: 0.014, h: 261 },   /* 浅灰（参考 #e4e7ec，浅底配墨字） */
  { l: 0.280, c: 0.010, h: 286 },   /* 深灰（参考 #27272a） */
  { l: 0.420, c: 0.075, h: 74 },    /* 琥珀（参考 #6e6444 + rgba(217,119,6)） */
  { l: 0.420, c: 0.115, h: 6 },     /* 玫红（参考 rgba(225,29,72)） */
  { l: 0.430, c: 0.075, h: 196 },   /* 青 */
  { l: 0.345, c: 0.075, h: 150 },   /* 墨绿 */
  { l: 0.330, c: 0.095, h: 268 },   /* 靛蓝（参考 #1b2434 / #375899） */
  { l: 0.400, c: 0.105, h: 33 },    /* 砖红（参考 #8c2d19） */
];

const THEMES = new Map();           /* id → 最终色（预置 / 取色结果），重排时直接复用 */
const PENDING = new Set();          /* 正在取色的 id，别重复发请求 */

const clampL = (v, a, b) => Math.max(a, Math.min(b, v));

function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** OKLCH → CSS（a 省略 = 不透明） */
const lch = (l, c, h, a) =>
  `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)}${a === undefined ? '' : ` / ${a}`})`;

/** sRGB(0-255) → OKLCH（取主色只要有亮度和色相） */
function srgbToOklch(r, g, b) {
  const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const C = Math.hypot(A, Bb);
  let h = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/** 一套脊色。l / c / h 就是最终写进 CSS 的那三个数（验收脚本也读它）。
 *  文字色按脊底亮度算：浅底用墨、深底用近白 —— 两种都算对比度，取高的那个。 */
function themeOf(l, c, h) {
  const bg = clampL(l, 0.24, 0.90);
  const cc = clampL(c, 0.006, 0.14);
  const hh = ((h % 360) + 360) % 360;
  const y = Math.pow(bg, 3);                       /* 近似相对亮度 */
  const cw = 1.05 / (y + 0.05);                    /* 对近白的对比度 */
  const ci = (y + 0.05) / 0.0668;                  /* 对墨色的对比度 */
  return {
    l: bg, c: cc, h: hh,
    bg: lch(bg, cc, hh),
    lo: lch(clampL(bg - 0.075, 0.20, 0.86), cc * 1.06, hh),
    fg: cw >= ci ? lch(0.968, 0.012, hh) : lch(0.215, 0.02, hh),
    amb: lch(0.72, 0.10, hh, 0.38),               /* 纸白上那层色晕：0.22 → 0.38（验收 ≥0.30） */
  };
}

const paletteTheme = (key) => {
  const p = PT[hashOf(String(key)) % PT.length];
  return { ...themeOf(p.l, p.c, p.h), src: 'palette' };
};

/** 封面地址：/api/img 同源代理；data: / blob: 直接给（代理只认白名单域名，data: 会被 403） */
const coverSrc = (u, size) => {
  const s = String(u || '');
  if (/^(data:|blob:)/i.test(s)) return s;
  return imgSrc(s, size);
};

/** 整图色相直方图：封面缩到 24×24 → 逐像素 OKLCH → 12 个 30° 色相桶，以彩度 C 为权重。
 *  返回主桶的加权平均 { h, C, n, share }；一个像素都不够彩 / 全灰 → null。
 *  （share = 主桶权重占全部权重的比例，用来给出"这张封面的主色有多确定"。） */
function coverHueHist(cover) {
  return new Promise((resolve) => {
    const src = coverSrc(cover, 96);
    if (!src) return resolve(null);
    const im = new Image();
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => fin(null), 10000);
    im.onload = () => {
      clearTimeout(timer);
      try {
        const N = 40;
        const cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return fin(null);
        ctx.drawImage(im, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;   /* 跨域污染会在这里抛 SecurityError */

        /* ============================================================
           取色规则（用户定的）：只看**贴着立脊那一条** —— 封面最左边 14% 宽、
           整高的竖带，取里面**像素最多的那个颜色**。
           理由：立脊就贴在封面左边，书脊自然延续那一带的颜色；
           整张图投票会被画面中心的主体抢走（实测「幽默与笑话」认成橙红，而左边是蓝的）。
           量化：每通道 5 bit（32 档）分桶 → 数像素 → 取最多的桶 → 桶内求平均。
           ============================================================ */
        const COLS = Math.max(2, Math.round(N * 0.14));
        const buckets = new Map();
        let stripN = 0;
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < COLS; x++) {
            const i = (y * N + x) * 4;
            if (d[i + 3] < 24) continue;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
            let m = buckets.get(key);
            if (!m) { m = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, m); }
            m.n++; m.r += r; m.g += g; m.b += b;
            stripN++;
          }
        }
        if (!stripN) return fin(null);
        let top = null;
        for (const m of buckets.values()) if (!top || m.n > top.n) top = m;
        fin({
          r: Math.round(top.r / top.n),
          g: Math.round(top.g / top.n),
          b: Math.round(top.b / top.n),
          n: top.n,
          stripN,
          share: top.n / stripN,
        });
      } catch (e) { fin(null); }                       /* 污染 / 被拒 → 回退色板 */
    };
    im.onerror = () => { clearTimeout(timer); fin(null); };
    im.src = src;
  });
}

/** 边缘主色 → 主题。
 *  取到的是封面靠脊那条带的 RGB，这里换到 OKLCH 直接当脊色用：
 *    · 色相 / 彩度：原样（彩度夹一点，保证脊上白字有对比）
 *    · 亮度：原样，但夹在 0.24–0.78 —— 太暗的封面不至于把脊压成黑条，
 *      太亮的也不会和白底糊在一起（themeOf 会按亮度自动把字切成深色/白色）。 */
function themeFromHist(hist) {
  if (!hist) return null;                            /* 图没取到 → 调用方回退预置色板 */
  const { L, C, h } = srgbToOklch(hist.r, hist.g, hist.b);
  return {
    ...themeOf(clampL(L, 0.24, 0.78), clampL(C, 0.012, 0.14), h),
    src: 'cover', share: hist.share,
  };
}

/** 把一套色写到这张卡的 CSS 变量上（pages.css 里只认 --sp-*）。
 *  data-sp-hue / data-sp-src 只是给验收和调试看的，不参与样式。 */
function paintSpine(it, t) {
  if (!it || !t) return;
  it.style.setProperty('--sp-bg', t.bg);
  it.style.setProperty('--sp-lo', t.lo);
  it.style.setProperty('--sp-fg', t.fg);
  it.dataset.amb = t.amb;
  if (t.src) it.dataset.spSrc = t.src;
  if (typeof t.h === 'number') it.dataset.spHue = t.h.toFixed(1);
}

/** 给当前这一屏补色：先上预置色板（同步、立刻多色），再异步换成封面自己的颜色 */
function ensureThemes(shown) {
  for (let i = 0; i < shown.length; i++) {
    const a = shown[i];
    const key = String(a.id);
    const it = S.items[i];
    if (THEMES.has(key)) { paintSpine(it, THEMES.get(key)); continue; }
    paintSpine(it, paletteTheme(key));
    if (!a.cover || PENDING.has(key)) continue;
    PENDING.add(key);
    coverHueHist(a.cover).then((hist) => {
      PENDING.delete(key);
      const t = themeFromHist(hist);
      if (!t) return;                                  /* 回退：预置色板已经写在卡上了 */
      THEMES.set(key, t);
      const at = S.items.findIndex((x) => x.dataset.key === key);
      if (at < 0) return;
      paintSpine(S.items[at], t);
      if (at === S.sel) applyAmbient();
    });
  }
}

/** 背景模式：ambient（默认，跟选中专辑的封面色）/ plain（纯纸白） */
function readBg() {
  try { return localStorage.getItem(BG_KEY) === 'plain' ? 'plain' : 'ambient'; } catch (e) { return 'ambient'; }
}
let bgMode = readBg();

function setBg(v) {
  bgMode = v === 'plain' ? 'plain' : 'ambient';
  try { localStorage.setItem(BG_KEY, bgMode); } catch (e) { /* 写不进去只影响本次会话 */ }
  applyAmbient();
  return bgMode;
}

/* 环境色：主色晕 alpha 0.38（验收区间 0.34~0.42）、落地光 0.18、暗角在 CSS 里。
 *   换专辑 / 拖拽选中时色相沿最短弧补间 420ms —— 直接改 CSS 变量会让
 *   background-image 跳变（Chrome 不插值渐变），所以逐帧写 --ambient-color。 */
const AMB = { alpha: 0.38, soft: 0.18, ms: 420 };

/** 只改色相：亮度 / 彩度 / alpha 固定，computed --ambient-color 永远是 ... / 0.38 */
function ambientCss(h, a) {
  const hh = ((h % 360) + 360) % 360;
  return `oklch(72% 0.100 ${hh.toFixed(1)} / ${a})`;
}

function writeAmbient(h) {
  const el = S.el;
  if (!el) return;
  S.ambH = ((h % 360) + 360) % 360;
  el.style.setProperty('--ambient-color', ambientCss(S.ambH, AMB.alpha));
  el.style.setProperty('--ambient-soft', ambientCss(S.ambH, AMB.soft));
  el.dataset.ambHue = S.ambH.toFixed(1);
}

/** 色相补间（最短弧）；reduce 下直接落值 */
function fadeAmbient(to) {
  cancelAnimationFrame(S.ambRaf);
  if (!Number.isFinite(S.ambH) || REDUCE) { S.ambRaf = 0; writeAmbient(to); return; }
  const from = S.ambH;
  const d = ((to - from + 540) % 360) - 180;
  if (Math.abs(d) < 0.4) { S.ambRaf = 0; writeAmbient(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / AMB.ms);
    const e = 1 - Math.pow(1 - k, 3);
    writeAmbient(from + d * e);
    if (k < 1) S.ambRaf = requestAnimationFrame(step);
    else { S.ambRaf = 0; writeAmbient(to); }
  };
  S.ambRaf = requestAnimationFrame(step);
}

/** 把当前选中专辑的封面色落到视图上（参考 L1336-1337 是挂在 documentElement 上的）。
 *  强度在 themeOf 定（alpha 0.38），这里只负责色相 + 平滑过渡 + 按钮状态。 */
function applyAmbient() {
  const el = S.el;
  if (!el) return;
  const it = S.items[S.sel];
  if (it) {
    const hue = Number(it.dataset.spHue);
    if (Number.isFinite(hue)) fadeAmbient(hue);
  }
  el.dataset.bg = bgMode;
  const b = el.querySelector('[data-bgbtn]');
  if (!b) return;
  b.dataset.mode = bgMode;
  b.setAttribute('aria-pressed', String(bgMode === 'ambient'));
  b.title = bgMode === 'ambient' ? '背景：跟随当前专辑取色（点击切成纯纸白）' : '背景：纯纸白（点击切回取色）';
  b.setAttribute('aria-label', b.title);
}

/* ==================================================================
 * 1. 外壳（只在第一次 mount 时写一次 innerHTML）
 * ================================================================== */
function shell(el) {
  if (el.querySelector('[data-ma]')) return;
  el.innerHTML = `
  <div class="ma" data-ma data-form="${form}">
    <div class="ma-top">
      <button class="ma-drawerbtn ma-bgbtn" type="button" data-bgbtn data-mode="ambient"
              aria-label="背景：跟随当前专辑取色（点击切成纯纸白）" aria-pressed="true"
              title="背景：跟随当前专辑取色（点击切成纯纸白）">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M8 1.7c2.55 2.95 4.35 5.05 4.35 7.15A4.35 4.35 0 0 1 8 13.2a4.35 4.35 0 0 1-4.35-4.35C3.65 6.75 5.45 4.65 8 1.7Z"
                fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
          <path d="M8 13.2a4.35 4.35 0 0 0 3.3-7.2A4.35 4.35 0 0 0 8 4.2Z" fill="currentColor" opacity=".32"/>
        </svg>
      </button>
      <button class="ma-drawerbtn" type="button" data-drawerbtn
              aria-label="打开收藏歌单列表" aria-expanded="false" title="收藏夹 / 专辑架">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M2.6 4.2h10.8M2.6 8h10.8M2.6 11.8h6.4" fill="none"
                stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="ma-drawerbtn" type="button" data-importbtn
              aria-label="从平台导入收藏的专辑" aria-expanded="false" title="从平台导入我收藏的专辑">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M8 2.6v7M5.2 6.9 8 9.7l2.8-2.8M13 11.2v1.4H3v-1.4" fill="none"
                stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <header class="ma-head">
      <div class="ma-headl">
        <p class="ma-kicker">收藏 · 专辑架</p>
        <h1 class="ma-title">我的专辑</h1>
      </div>
      <p class="ma-count"><b data-count>0</b> 张<span data-more></span></p>
    </header>

    <section class="ma-stage" data-stage tabindex="0" aria-label="3D 专辑陈列架">
      <div class="ma-world" data-world></div>
      <button class="ma-cta" type="button" data-cta hidden>
        <span>查看专辑</span>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3.4 8h9M8.7 3.9 12.8 8l-4.1 4.1" fill="none" stroke="currentColor"
                stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </section>

    <p class="ma-note" data-note hidden></p>


    <div class="ma-empty" data-empty hidden>
      <p class="ma-empty__t">架子上还是空的</p>
      <p class="ma-empty__s">在专辑页「播放全部」右边点一下「收纳到我的专辑」，它就会站到这儿来。</p>
      <button class="ma-empty__b" type="button" data-pick>去挑一张专辑</button>
    </div>

    <aside class="ma-drawer" data-drawer aria-label="收藏夹专辑列表">
      <div class="ma-drawer__h"><b>收藏夹</b><span data-drawer-count>0 张</span></div>
      <div class="ma-drawer__list" data-drawer-list></div>
    </aside>

    <!-- 从平台导入：先选平台，再拉该平台的「我收藏的专辑」，挑几张写进本地收藏
         （pages/collection.js）。真接通的只有网易云 / QQ / 波点；其余平台只说明暂不支持，
         不假装有数据。平台切换用一行小字号文字标签，风格跟着 .ma-import__btn 走。 -->
    <aside class="ma-drawer ma-import" data-import aria-label="从平台导入收藏的专辑">
      <div class="ma-drawer__h">
        <b>平台收藏</b><span data-import-count>—</span>
        <button class="ma-import__x" type="button" data-import-close aria-label="关闭导入面板">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="ma-import__tabs" data-import-tabs aria-label="选择导入平台">
        <button class="ma-import__tab is-on" type="button" data-imp-plat="netease" aria-pressed="true">网易云</button>
        <button class="ma-import__tab" type="button" data-imp-plat="qq" aria-pressed="false">QQ</button>
        <button class="ma-import__tab" type="button" data-imp-plat="bodian" aria-pressed="false">波点</button>
        <button class="ma-import__tab" type="button" data-imp-plat="qishui" aria-pressed="false">汽水</button>
        <button class="ma-import__tab" type="button" data-imp-plat="kugou" aria-pressed="false">酷狗</button>
        <button class="ma-import__tab" type="button" data-imp-plat="kuwo" aria-pressed="false">酷我</button>
        <button class="ma-import__tab" type="button" data-imp-plat="spotify" aria-pressed="false">Spotify</button>
      </div>
      <div class="ma-drawer__list ma-import__list" data-import-list></div>
      <div class="ma-import__foot">
        <button class="ma-import__btn" type="button" data-import-all>全选</button>
        <button class="ma-import__btn ma-import__btn--main" type="button" data-import-run disabled>导入 0 张</button>
      </div>
    </aside>
  </div>`;

  S.el = el;
  S.root = el.querySelector('[data-ma]');
  S.stage = el.querySelector('[data-stage]');
  S.world = el.querySelector('[data-world]');

  /* 封面加载失败（防盗链 / 404 / 代理抖动）就换成占位字符，别留一块纯白 —— 
     error 事件不冒泡，所以用捕获阶段挂在容器上。
     侧立形态里一张唱片有正反两面，一面挂了就把这件的两面一起换掉，
     免得侧着的时候一面是字、一面是空白。 */
  el.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const item = img.closest('.ma-item');
    if (!item) return;
    const name = item.getAttribute('aria-label') || '?';
    for (const face of item.querySelectorAll('.ma-item__art, .ma-item__back, .ma-item__vlabel, .ma-item__sbadge')) {
      const bad = face.querySelector('img');
      if (!bad) continue;
      const ph = document.createElement('span');
      ph.className = face.classList.contains('ma-item__sbadge') ? 'ma-item__sbadge-ph' : 'ma-item__ph';
      ph.setAttribute('aria-hidden', 'true');
      ph.textContent = name.trim().slice(0, 1) || '?';
      bad.replaceWith(ph);
    }
  }, true);
}

/* ==================================================================
 * 2. 画（列表变了才重建 DOM；否则只重排）
 * ================================================================== */
/* 一张唱片的六面盒子（参考文件里 .album-box 的那套，L940-985）：
     .ma-item__vinyl 黑胶碟（L292-366 的 .vinyl-disc；特写时从封套里滑出来转）
     .ma-item__art   封面（正面，translateZ(+半个厚度)）
     .ma-item__back  封底（反面，rotateY(180deg) —— 左边几张翻出来的就是它）
     .ma-item__spine 立脊（盒子右侧那面；中卡转到 -90° 时它正对镜头）
   上下沿的厚度用 .ma-item::before / ::after 画（见 pages.css），所以这里只有这几块。
   每张卡自带一组 --sp-*（参考 L961/972 把 spineBg/spineText 写在行内，这里同样写在行内，
   只是先用 id 哈希的预置色板占位，等封面取色回来再换）。
   flow 形态下封底 / 立脊 / 黑胶都是 display:none，看到的就是原来那个正面封面。 */
function faceHtml(a, size) {
  return a.cover
    ? `<img src="${esc(coverSrc(a.cover, size))}" alt="" loading="eager" decoding="async" draggable="false">`
    : `<span class="ma-item__ph" aria-hidden="true">${esc((a.name || '?').trim().slice(0, 1))}</span>`;
}

/** 立脊顶端那颗小封面（参考 .spine-badge，11px / 420 封面）。
 *   取图 96px：显示 20~26px，2 倍屏也够；naturalWidth 一定 > 40（验收要量）。
 *   没封面就用专辑名首字，别在脊上留一个空槽。 */
function badgeHtml(a) {
  const first = esc((a.name || '?').trim().slice(0, 1) || '?');
  return a.cover
    ? `<img src="${esc(coverSrc(a.cover, 96))}" alt="" loading="eager" decoding="async" draggable="false">`
    : `<span class="ma-item__sbadge-ph" aria-hidden="true">${first}</span>`;
}

function itemHtml(a, i) {
  const t = paletteTheme(String(a.id));
  const req = artReq();
  /* data-cover：窗口变大时 upgradeArt() 按它换更大的图（data:/blob: 不换，本来就不经过代理） */
  const remote = /^(data:|blob:)/i.test(String(a.cover || '')) ? '' : String(a.cover || '');
  return `<button class="ma-item" type="button" data-i="${i}" data-key="${esc(a.id)}"
      data-cover="${esc(remote)}"
      data-amb="${esc(t.amb)}" data-sp-hue="${t.h.toFixed(1)}" data-sp-src="palette"
      style="--sp-bg:${t.bg};--sp-lo:${t.lo};--sp-fg:${t.fg}"
      aria-label="${esc(a.name)} · ${esc(a.artists || '未知歌手')}">
    <span class="ma-item__vinyl" aria-hidden="true">
      <span class="ma-item__vlabel">${faceHtml(a, Math.min(req, 700))}</span>
    </span>
    <span class="ma-item__art">${faceHtml(a, req)}<span class="ma-item__veil" aria-hidden="true"></span></span>
    <span class="ma-item__back" aria-hidden="true">${faceHtml(a, req)}<span class="ma-item__veil" aria-hidden="true"></span></span>
    <span class="ma-item__spine" aria-hidden="true">
      <span class="ma-item__sbadge">${badgeHtml(a)}</span>
      <span class="ma-item__stitle">${esc(a.name)}</span>
      <span class="ma-item__sartist">${esc(a.artists || '未知歌手')}</span>
    </span>
  </button>`;
}

function paint(el) {
  const all = collection.list();
  const shown = all.slice(0, MAX);
  const sig = shown.map((a) => a.id).join('|');
  const changed = sig !== S.keys;

  if (changed) {
    /* 重建前记住"现在选中哪张"，重建后尽量还停在它身上 */
    const keepKey = S.items[S.sel] ? S.items[S.sel].dataset.key : '';
    S.keys = sig;
    S.world.innerHTML = shown.map(itemHtml).join('');
    S.items = [...S.world.children];
    S.veils = S.items.map((it) => [...it.querySelectorAll('.ma-item__veil')]);
    artReqUsed = artReq();               /* 这一批图就是按当前尺寸取的，记下来别重复换 */
    /* DOM 重建 = 特写必须收回去（参考的 openProgress 数组也是跟着 ALBUMS 一起重建的，L866-867） */
    S.open = -1;
    S.openP = S.items.map(() => 0);
    const cta0 = el.querySelector('[data-cta]');
    if (cta0) cta0.hidden = true;
    ensureThemes(shown);

    const at = changed && keepKey ? shown.findIndex((a) => a.id === keepKey) : -1;
    if (at >= 0) {
      S.sel = at; S.pos = at; S.target = at;
    } else {
      const mid = Math.floor((shown.length - 1) / 2);
      S.sel = clamp(mid, 0, Math.max(0, shown.length - 1));
      S.pos = S.sel; S.target = S.sel;
    }
  }

  el.querySelector('[data-count]').textContent = String(all.length);
  el.querySelector('[data-more]').textContent = all.length > MAX ? ` ／ 架上 ${MAX} 张` : '';
  el.querySelector('[data-empty]').hidden = shown.length > 0;
  S.root.classList.toggle('is-empty', shown.length === 0);
  const dbtn = el.querySelector('[data-drawerbtn]');
  dbtn.hidden = shown.length === 0;
  if (shown.length === 0 && S.root.classList.contains('is-drawer')) toggleDrawer(el, false);

  paintDrawer(el, shown);
  layout();
  paintSel();
  kick();
}

function paintDrawer(el, shown) {
  el.querySelector('[data-drawer-count]').textContent = `${collection.list().length} 张`;
  el.querySelector('[data-drawer-list]').innerHTML = shown.map((a, i) => `
    <div class="ma-row" data-row="${i}">
      <button class="ma-row__main" type="button" data-goto="${i}">
        <span class="ma-row__pic">${a.cover ? `<img src="${esc(coverSrc(a.cover, 120))}" alt="" loading="lazy" decoding="async">` : ''}</span>
        <span class="ma-row__txt">
          <span class="ma-row__t">${esc(a.name)}</span>
          <span class="ma-row__a">${esc(a.artists || '未知歌手')}</span>
        </span>
      </button>
      <button class="ma-row__x" type="button" data-remove="${esc(a.id)}"
              aria-label="从我的专辑移除「${esc(a.name)}」" title="移除">×</button>
    </div>`).join('');
}

/* ==================================================================
 * 3. 排布 —— 每张卡一个 transform，两种形态各一个函数，共用这一排 item
 * ================================================================== */

/** 形态分发：整个模块只有这一个入口，切形态后调它一次就重排完 */
function layout() {
  if (!S.items.length) return;
  if (form === 'spine') layoutSpine(); else layoutFlow();
}

/* ---- 3a. 正面 Cover Flow（原来那版，一字未改）----
 *    x = (i - pos) * gap
 *    z = z0 - |i - pos| * dz        中间那张 z0 > 0（离观众最近，且 ≠0）
 *    rotateY = -tanh(d 带 0.85 阻尼) * fan   → 中间 0°（正对镜头），两侧越远越旋开并饱和
 *    rotateX = pitch（整架统一俯仰，读起来像相机略高于架子）
 */
function layoutFlow() {
  const n = S.items.length;
  for (let i = 0; i < n; i++) {
    const d = i - S.pos;
    const ad = Math.abs(d);
    const it = S.items[i];
    const ry = -Math.tanh(d * 0.85) * M.fan;
    it.style.transform =
      `translate3d(${(d * M.gap).toFixed(2)}px, 0px, ${(M.z0 - ad * M.dz).toFixed(2)}px) ` +
      `rotateX(${M.pitch.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    it.style.zIndex = String(Math.max(1, 200 - Math.round(ad * 12)));
    /* 立脊那两档量只在侧立形态有意义，切过来就摘掉，别留上一套的数 */
    delete it.dataset.ry; delete it.dataset.ryRaw;
    /* 越远越融进纸白：这是深色参考里那层"灯光衰减"的浅色版 */
    for (const v of S.veils[i] || []) v.style.opacity = Math.min(0.52, ad * 0.085).toFixed(3);
  }
}

/* ---- 3b. 侧立 3D 架：参考文件 renderLoop()（L1045-1126）的几何逐行搬 ----
 *
 *   参考原文（defaultViewAngle=90 / fanSpreadAngle=22 / customSpacing=156）：
 *     baseCenterRotateY = defaultViewAngle - 180        → -90°
 *     shelfRotateY      = baseCenterRotateY + tanh(diff*0.85) * fanSpreadAngle
 *     rotateY  = shelfRotateY * (1 - openAmt) + closeUpAngle * openAmt    (L1076, 参考 -6 → 本项目 -18)
 *     spineRelX =  halfAlbum * cos(rad)
 *     spineRelZ = -halfAlbum * sin(rad)
 *     xOffset   = (diff * shelfSpacing + neighborPushX) - spineRelX * (1 - openAmt)   (L1065/1085)
 *     zOffset   = -spineRelZ * (1 - openAmt) + openAmt * closeUpZ                     (L1087)
 *     rotateX   = shelfPitch * (1 - openAmt) + openAmt * 2.2                          (L1089, → 5.4)
 *     rotateZ   = openAmt * -1.4°                                                     (L1090)
 *     zIndex    = baseStackZ + openAmt * 300                                          (L1111)
 *     shade     = min(.45, |diff|*.09) * (1 - openAmt)                                (L1122)
 *   openAmt 就是 openProgress[i]（L866-867 / L1028-1031：每帧 += (target - cur) * 0.14）。
 *   邻居推开：L1056-1060，closeUpGap 桌面 245。
 *
 *   第二轮改的四处（都写在 CLOSE 里）：开态角 -6°→-18°、rotateX 2.2°→5.4°、
 *   x 额外左移 M.sopen（给 56% 滑出的黑胶留地方）、黑胶滑出量 38%→56%（见 pages.css）。
 *   rotateZ(-1.4°) 与 shade 衰减保持参考原值。
 *
 *   为什么是 -90°：那个盒子的「立脊」是它右侧那一面（rotateY(90deg) translateZ(半个封面)）。
 *   盒子转到 -90° 时，立脊的法线正好对着镜头 —— 中间那张就只剩一条竖向的书脊；
 *   左右各偏 ±tanh 扇开角，把封面 / 封底翻出一窄条。x / z 那两行是把立脊钉在 z=0 的
 *   "架线"上（封面朝 -Z 展开），所以整排读起来像唱片店里侧立的碟，而不是正对着的卡片。
 *
 *   归一：it.dataset.ry 记的是「立脊相对镜头」的角（+90 归零，中卡恒为 0.00），
 *   it.dataset.ryRaw 记参考的原始角（中卡 -90）。
 */
function layoutSpine() {
  const n = S.items.length;
  const half = sizePx() / 2;
  const base = -90;                                     /* 参考 defaultViewAngle(90) - 180 */
  for (let i = 0; i < n; i++) {
    const open = S.openP[i] || 0;
    const d = i - S.pos;
    const ad = Math.abs(d);
    const it = S.items[i];
    const shelfRy = base + Math.tanh(d * REF.damp) * M.sfan;   /* 参考 shelfRotateY */
    const ry = shelfRy * (1 - open) + CLOSE.angle * open;      /* 参考 L1076（角度换成 -18°） */
    const rad = (shelfRy * Math.PI) / 180;                     /* 参考 L1081：rad 用的是架子角 */
    const spineRelX = half * Math.cos(rad);
    const spineRelZ = -half * Math.sin(rad);
    /* 参考 L1056-1060：别人打开了就把我横向推开，别叠在它脸上 */
    let push = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const o = S.openP[j] || 0;
      if (o < 0.001) continue;
      push += (i < j ? -1 : 1) * M.sclose * o;
    }
    const spineTargetX = d * M.sgap + push;                    /* 参考 L1065 */
    /* 参考 L1085 + 我们那条 open * M.sopen：特写那张整体左移，给滑出来的黑胶腾地方
       （否则 864 的封面 + 56% 滑出的黑胶会顶出舞台右边被裁掉） */
    const x = spineTargetX - spineRelX * (1 - open) - open * M.sopen;
    const z = -spineRelZ * (1 - open) + open * M.scloseZ;      /* 参考 L1086-1087 */
    const rx = M.spitch * (1 - open) + open * CLOSE.tiltX;     /* 参考 L1089（2.2 → 5.4） */
    const rz = open * CLOSE.rz;                                /* 参考 L1090：-1.4° */
    it.style.transform =
      `translate3d(${x.toFixed(2)}px, 0px, ${z.toFixed(2)}px) ` +
      `perspective(${M.sperspBox}px) ` +
      `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    it.dataset.ry = (ry - base).toFixed(2);
    it.dataset.ryRaw = ry.toFixed(2);
    /* 参考 baseStackZ：中卡 200，两侧每远一格 -18 —— 左右两边的封面才不会互相压住 */
    it.style.zIndex = String(Math.max(1, 200 - Math.round(ad * 18) + Math.round(open * 300)));
    /* 参考 shade：越远越暗（浅色版就是越远越融进纸白）；打开的那张不压暗 */
    const shade = Math.min(0.45, ad * 0.09) * (1 - open);
    for (const v of S.veils[i] || []) v.style.opacity = shade.toFixed(2);
    /* 参考 L1114：openAmt > 0.75 才算"特写"，黑胶碟这时才滑出来转 */
    it.classList.toggle('is-open', open > 0.75);
  }
  placeCta();
}

/** 特写态那枚「查看专辑」按钮：钉在正封右下角（参考 L125 的正封区域） */
function placeCta() {
  const cta = S.el && S.el.querySelector('[data-cta]');
  if (!cta) return;
  const i = S.open;
  const it = i >= 0 ? S.items[i] : null;
  const p = it ? S.openP[i] || 0 : 0;
  if (!it || p < 0.5) { if (!cta.hidden) cta.hidden = true; return; }
  const st = S.stage.getBoundingClientRect();
  const art = it.querySelector('.ma-item__art').getBoundingClientRect();
  if (!art.width) { if (!cta.hidden) cta.hidden = true; return; }
  if (cta.hidden) cta.hidden = false;
  const w = cta.offsetWidth || 96;
  const h = cta.offsetHeight || 30;
  const left = clamp(art.right - st.left - w - 14, 8, Math.max(8, st.width - w - 8));
  const top = clamp(art.bottom - st.top - h - 14, 6, Math.max(6, st.height - h - 6));
  cta.style.left = left.toFixed(1) + 'px';
  cta.style.top = top.toFixed(1) + 'px';
}

function paintSel() {
  for (let i = 0; i < S.items.length; i++) {
    const on = i === S.sel;
    S.items[i].classList.toggle('is-sel', on);
    S.items[i].setAttribute('aria-current', on ? 'true' : 'false');
  }
  applyAmbient();
}

/* ---------------- 惯性 / 过渡：只有真的在动才开 rAF ---------------- */
function kick() {
  if (S.raf) return;
  S.raf = requestAnimationFrame(tick);
}

/** 指针微动的目标角：只在侧立形态、非 reduce、非拖拽时生效。
 *  nx / ny = 指针相对舞台中心的归一化位置（-1 … 1） */
function tiltTo(nx, ny) {
  if (REDUCE || form !== 'spine' || S.drag) { S.tx = 0; S.ty = 0; return; }
  S.tx = -ny * TILT.rx;              /* rotateX：指针在下 → 负 */
  S.ty = nx * TILT.ry;               /* rotateY：指针在右 → 正 */
}

/** 把当前缓动角写到 .ma-world 上（挂在这一层 = 整架一起轻轻转，不动每张卡自己的几何） */
function applyTilt() {
  const w = S.world;
  if (!w) return;
  /* 小于 0.02° 干脆写成空：收尾时不留下一条 1/100 度的 transform（拖拽结束正好卡在收尾帧） */
  const on = !REDUCE && form === 'spine' && (Math.abs(S.x) >= 0.02 || Math.abs(S.y) >= 0.02);
  w.style.transform = on
    ? `rotateX(${S.x.toFixed(2)}deg) rotateY(${S.y.toFixed(2)}deg)`
    : '';
}

function tick() {
  S.raf = 0;
  if (!active()) return;
  let moving = false;
  if (!S.drag) {
    const d = S.target - S.pos;
    if (Math.abs(d) > 0.0008) { S.pos += d * (REDUCE ? 1 : 0.16); moving = true; }
    else { S.pos = S.target; }
  }
  /* 参考 L1027-1031：每张的 openProgress 每帧 += (target - cur) * 0.14，0 = 在架上，1 = 特写 */
  if (form === 'spine' && S.items.length) {
    for (let i = 0; i < S.items.length; i++) {
      const target = i === S.open ? 1 : 0;
      const cur = S.openP[i] || 0;
      const dv = target - cur;
      if (Math.abs(dv) > 0.0015) { S.openP[i] = cur + dv * (REDUCE ? 1 : 0.14); moving = true; }
      else if (cur !== target) S.openP[i] = target;
    }
  }
  /* 指针微动：每帧追 8% 到目标，停止后收最后一拍（不每帧硬写目标值） */
  const dtx = S.tx - S.x, dty = S.ty - S.y;
  if (Math.abs(dtx) > 0.004 || Math.abs(dty) > 0.004) {
    S.x += dtx * TILT.ease; S.y += dty * TILT.ease;
    applyTilt(); moving = true;
  } else if (S.x !== S.tx || S.y !== S.ty) {
    S.x = S.tx; S.y = S.ty; applyTilt();
  }
  layout();
  if (moving || S.drag) S.raf = requestAnimationFrame(tick);
}

/* ---------------- 特写：展开 / 收回 ---------------- */
/** 展开某一张（参考 L1290 selectAlbumForCloseUp：选中它 + 把它滑到正中） */
function openUp(i) {
  const last = Math.max(0, S.items.length - 1);
  const at = clamp(Number(i) || 0, 0, last);
  S.sel = at;
  S.target = at;                       /* 参考 L1293：targetPos = clamped */
  S.open = at;
  paintSel();
  kick();
}

/** 收回架上（openProgress → 0） */
function closeUp() {
  if (S.open < 0) return;
  S.open = -1;
  for (const it of S.items) it.classList.remove('is-open');
  const cta = S.el && S.el.querySelector('[data-cta]');
  if (cta) cta.hidden = true;
  kick();
}

/** 轻点一张：侧立 = 开特写（再点同一张 = 收回）；flow = 直接进专辑页（行为不变） */
function tapIndex(i) {
  if (form !== 'spine') return openItem(i);
  if (i < 0) return;
  if (S.open === i) return closeUp();
  openUp(i);
}

/* ==================================================================
 * 4. 交互：拖拽 / 滚轮 / 键盘 / 点击
 * ================================================================== */
/** 一格有多宽：拖拽 / 命中都用它。flow 是相邻封面中心的间距，spine 是相邻立脊的间距。 */
const gapPx = () => (form === 'spine' ? M.sgap : M.gap);

/** 点在哪一张上。
    侧立形态不能用 elementFromPoint：每张的盒子还是 420px 宽（只是转到几乎侧对镜头），
    盒子互相压着，DOM 命中会落到隔壁那条看不见的盒子上 —— 所以按"立脊中线"算。
    架子上下那两条留白算空白（返回 -1 = 点空白，收回特写）。
    flow 形态照旧走 DOM 命中（卡片是正着的，看到的就是盒子）。 */
function hitIndex(e) {
  const n = S.items.length;
  if (!n) return -1;
  if (form !== 'spine') {
    const hit = (e.target.closest && e.target.closest('.ma-item'))
      || (document.elementFromPoint(e.clientX, e.clientY) || {}).closest?.('.ma-item');
    return hit ? Number(hit.dataset.i) : -1;
  }
  const b = S.stage.getBoundingClientRect();
  const bandTop = b.top + (b.height - sizePx()) / 2;
  if (e.clientY < bandTop - 6 || e.clientY > bandTop + sizePx() + 6) return -1;
  const i = Math.round(S.pos + (e.clientX - (b.left + b.width / 2)) / gapPx());
  return i < 0 || i > n - 1 ? -1 : i;
}

function bind(el) {
  if (el.dataset.bound) return;
  el.dataset.bound = '1';

  const stage = S.stage;
  const last = () => Math.max(0, S.items.length - 1);

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!S.items.length) return;
    S.drag = { x: e.clientX, from: S.pos, moved: 0, px: e.clientX, t: performance.now() };
    S.vel = 0;
    S.tx = 0; S.ty = 0;                       /* 拖拽期间暂停微动，避免两套手势打架 */
    stage.classList.add('is-dragging');       /* will-change 只在拖拽期间挂上 */
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    const dx = e.clientX - S.drag.x;
    S.drag.moved = Math.max(S.drag.moved, Math.abs(dx));
    /* 参考 L1369：一开始横向拖，就把打开的那张收回架上 */
    if (S.drag.moved > 8 && S.open >= 0) closeUp();
    let raw = S.drag.from - dx / gapPx();
    if (raw < 0) raw *= 0.32;                                  /* 橡皮筋 */
    else if (raw > last()) raw = last() + (raw - last()) * 0.32;
    S.pos = raw; S.target = raw;
    const now = performance.now();
    const dt = Math.max(1, now - S.drag.t);
    S.vel = (S.drag.px - e.clientX) / dt;                       /* px/ms */
    S.drag.px = e.clientX; S.drag.t = now;
    kick();
  });

  /* ⑤ 指针微动（3D 视差）—— 参考文件里没有这段，是本项目自己加的：
     指针在舞台上移动 → 整架（.ma-world）轻轻转 rotateX(-ny*4°) / rotateY(nx*5°)，
     每帧 8% 缓动追上去；指针离开舞台归零；拖拽期间让位给拖拽（目标清 0）。
     reduce / flow 形态整段短路（验收会用 CDP 模拟 prefers-reduced-motion 检查不生效）。 */
  stage.addEventListener('pointermove', (e) => {
    if (REDUCE || form !== 'spine' || S.drag) return;
    const b = stage.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const nx = clamp(((e.clientX - b.left) / b.width) * 2 - 1, -1, 1);
    const ny = clamp(((e.clientY - b.top) / b.height) * 2 - 1, -1, 1);
    tiltTo(nx, ny);
    kick();
  });
  stage.addEventListener('pointerleave', () => { tiltTo(0, 0); kick(); });

  const end = (e) => {
    if (!S.drag) return;
    const moved = S.drag.moved;
    S.drag = null;
    stage.classList.remove('is-dragging');
    try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

    if (moved > 8) {
      /* 惯性：速度(px/ms) × 260ms 得到的是「像素」，必须再除以一格的像素宽
         才能换算成 S.pos 的「第几张」。2026-11-09 修复：原来直接
         `S.pos + S.vel * 260` 混了单位，0.05px/ms 就会加 13 张 ——
         轻轻拖一下直接飞到尽头。 */
      S.target = clamp(Math.round(S.pos + (S.vel * 260) / gapPx()), 0, last());
      S.sel = clamp(Math.round(S.target), 0, last());
      paintSel();
      kick();
      return;
    }
    /* 轻点：侧立 = 原地展开特写（不跳页）；flow = 直接进专辑页（行为不变）。
       指针捕获会把 pointerup 的 target 换成 stage，所以 hitIndex() 用坐标重做命中。 */
    const at = hitIndex(e);
    if (at >= 0) { tapIndex(at); return; }
    if (S.open >= 0) { closeUp(); return; }        /* 点空白 = 收回 */

    S.target = clamp(Math.round(S.pos), 0, last());
    S.sel = clamp(Math.round(S.target), 0, last());
    paintSel();
    kick();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  /* 鼠标点击已经在 pointerup 里处理（detail ≥ 1）；
     这里只接键盘激活 <button> 时那次 detail === 0 的 click。 */
  stage.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const it = e.target.closest && e.target.closest('.ma-item');
    if (it) tapIndex(Number(it.dataset.i));
  });

  /* 特写态那枚「查看专辑」：只在这时进专辑页（用户自己决定）。
     它长在 stage 里，所以要把 stage 的拖拽 / 命中拦掉。 */
  const cta = el.querySelector('[data-cta]');
  cta.addEventListener('pointerdown', (e) => e.stopPropagation());
  cta.addEventListener('pointerup', (e) => e.stopPropagation());
  cta.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const i = S.open >= 0 ? S.open : S.sel;
    closeUp();                       /* 先收回架子，从专辑页返回时还是架子 */
    openItem(i);
  });

  /* 横向滚轮转整排；纵向滚轮留给页面（除非页面本来就滚不动） */
  stage.addEventListener('wheel', (e) => {
    if (!S.items.length) return;
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    const scrollable = el.scrollHeight > el.clientHeight + 4;
    const d = dx || (scrollable ? 0 : e.deltaY);
    if (!d) return;
    e.preventDefault();
    if (S.open >= 0) closeUp();                       /* 滚轮转架子 = 收回特写 */
    S.target = clamp(S.target + d * 0.0038, 0, last());
    S.sel = clamp(Math.round(S.target), 0, last());
    paintSel();
    kick();
  }, { passive: false });

  /* 右上角那颗：背景切换（ambient = 跟当前专辑封面色 / plain = 纯纸白） */
  el.querySelector('[data-bgbtn]').addEventListener('click', (e) => {
    e.stopPropagation();
    setBg(bgMode === 'ambient' ? 'plain' : 'ambient');
  });

  /* 收藏夹列表那颗：开关抽屉 */
  el.querySelector('[data-drawerbtn]').addEventListener('click', () => {
    toggleDrawer(el, !S.root.classList.contains('is-drawer'));
  });

  /* 导入那颗：开关「平台收藏」面板（第一次打开才去拉接口） */
  el.querySelector('[data-importbtn]').addEventListener('click', () => toggleImport(el));
  el.querySelector('[data-import-close]').addEventListener('click', () => toggleImport(el, false));
  el.querySelector('[data-import-all]').addEventListener('click', () => importToggleAll(el));
  el.querySelector('[data-import-run]').addEventListener('click', () => runImport(el));
  /* 切平台：每个平台的数据分开拉，不能把上一个平台的列表留在面板里 */
  el.querySelector('[data-import-tabs]').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-imp-plat]');
    if (tab) setImportPlat(el, tab.dataset.impPlat);
  });
  el.querySelector('[data-import-list]').addEventListener('click', (e) => {
    const row = e.target.closest('[data-imp]');
    if (!row || row.disabled) return;
    const id = row.dataset.imp;
    if (S.imp.done.has(id)) return;
    if (S.imp.picked.has(id)) S.imp.picked.delete(id);
    else S.imp.picked.add(id);
    paintImport(el);
  });

  el.querySelector('[data-drawer-list]').addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]');
    if (x) { e.stopPropagation(); collection.remove(x.dataset.remove); return; }
    const go = e.target.closest('[data-goto]');
    if (!go) return;
    if (S.open >= 0) closeUp();
    S.sel = clamp(Number(go.dataset.goto), 0, last());
    S.target = S.sel;
    paintSel();
    kick();
    toggleDrawer(el, false);
  });

  el.querySelector('[data-pick]').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('lizi:show', { detail: { view: 'hall' } }));
  });
}

function toggleDrawer(el, open) {
  S.root.classList.toggle('is-drawer', open);
  el.querySelector('[data-drawerbtn]').setAttribute('aria-expanded', String(open));
  el.querySelector('[data-drawer]').classList.toggle('is-open', open);
  if (open) toggleImport(el, false);          // 两个抽屉不同时开
}

/* ==================================================================
 * 从平台导入收藏的专辑
 *   · 数据源：网易云 `album/sublist`、QQ `/user/albums`、波点 `/user/albums`。
 *     后两个由 server.mjs 归一成和网易云同一套 { data:[...], hasMore }，
 *     所以前端只有一套渲染逻辑。
 *   · 汽水 / 酷狗 / 酷我 / Spotify 的边车没有「用户收藏专辑」接口：选中时
 *     如实说明，不静默失败，也不弹错误 toast。
 *   · 落地：pages/collection.js，和「专辑页手动收纳」写的是同一份 localStorage
 *   · 已收藏的置灰不可选；选中项一次性写入，收藏层变化会自动重绘架子
 * ================================================================== */

/** 每个平台一个 adapter。只有声明了 fetchList 的才是真接通；
 *  unavailable 是给用户看的原因，needsLogin 让面板先问登录态再拉列表。 */
const IMP_PLATS = [
  {
    id: 'netease', name: '网易云', loginName: '网易云音乐', needsLogin: true,
    async fetchList() { return impFetchPages('/api/netease/album/sublist'); },
  },
  {
    id: 'qq', name: 'QQ', loginName: 'QQ 音乐', needsLogin: true,
    async fetchList() { return impFetchPages('/api/qq/user/albums'); },
  },
  {
    id: 'bodian', name: '波点', loginName: '波点音乐', needsLogin: true,
    async fetchList() {
      /* 服务端这条路由只给第一页：波点边车的 /user/albums 不转发 offset，
         而 services/ 不许改。这里就只请求一次，别按 hasMore 把同一页反复叠进来。 */
      const d = await fetch('/api/bodian/user/albums?limit=100&offset=0').then((r) => r.json());
      if (!d || d.error) return { error: (d && d.error) || '读取失败' };
      return { items: (Array.isArray(d.data) ? d.data : []).map((a) => impAlbum(a)) };
    },
  },
  { id: 'qishui', name: '汽水', unavailable: '汽水音乐只开放了歌单接口' },
  { id: 'kugou', name: '酷狗', unavailable: '酷狗边车没有「用户收藏专辑」接口' },
  { id: 'kuwo', name: '酷我', unavailable: '酷我边车没有「用户收藏专辑」接口' },
  { id: 'spotify', name: 'Spotify', unavailable: 'Spotify 没有 user-library-read 权限' },
];

const IMP_PLAT_BY_ID = new Map(IMP_PLATS.map((p) => [p.id, p]));

/** 当前平台（找不到就退回网易云，别让脏状态把面板卡死） */
function impPlat(id) {
  return IMP_PLAT_BY_ID.get(id) || IMP_PLATS[0];
}

/** 各平台的原始条目 → 前端唯一形状。
 *  artists 既可能是 [{ name }]（网易云）也可能是字符串（服务端已归一），两种都收；
 *  封面/曲目数把网易云和归一后的字段名一起兜住。 */
function impAlbum(a) {
  return {
    id: String(a && a.id != null ? a.id : ''),
    name: (a && a.name) || '未知专辑',
    artists: Array.isArray(a && a.artists)
      ? a.artists.map((x) => (x && x.name) || x || '').filter(Boolean).join(' / ')
      : String((a && a.artists) || ''),
    cover: (a && (a.cover || a.picUrl)) || '',
    publishTime: Number(a && a.publishTime) || 0,
    trackCount: Number(a && (a.trackCount ?? a.size)) || 0,
  };
}

/** 带分页的平台：一直翻到 hasMore=false（最多 400 张，和原来网易云的边界一致）。
 *  任何一页带回 error 就整批当失败，不拿半截列表假装成功。 */
async function impFetchPages(base) {
  const all = [];
  for (let off = 0; off < 400; off += 100) {
    const d = await fetch(`${base}?limit=100&offset=${off}`).then((r) => r.json());
    if (!d || d.error) return { error: (d && d.error) || '读取失败' };
    /* 网易云未登录时可能回 { code:301, msg } 而没有 data；别当成「0 张收藏」 */
    if (!Array.isArray(d.data)) return { error: d.msg || d.message || `接口返回 ${d.code || '异常'}` };
    all.push(...d.data);
    if (!d.hasMore || d.data.length < 100) break;
  }
  return { items: all.map((a) => impAlbum(a)) };
}

/** 已登录？只认服务端明确回的 loggedIn 布尔值：
 *  网络抖动 / 边车还没起来时返回 null，交给真正的列表请求去报错。 */
const IMP_LOGIN_CHECK = {
  netease: '/api/session',
  qq: '/api/qq/status',
  bodian: '/api/bodian/status',
};

async function impLoggedIn(plat) {
  const url = IMP_LOGIN_CHECK[plat.id];
  if (!url) return null;
  try {
    const d = await fetch(url).then((r) => r.json());
    return d && typeof d.loggedIn === 'boolean' ? d.loggedIn : null;
  } catch { return null; }
}

function impState() {
  if (!S.imp) {
    S.imp = {
      open: false, plat: 'netease', loaded: false, busy: false,
      error: '', needLogin: false, items: [], picked: new Set(), done: new Set(),
    };
  }
  return S.imp;
}

function toggleImport(el, force) {
  const st = impState();
  const open = force === undefined ? !st.open : !!force;
  st.open = open;
  el.querySelector('[data-importbtn]').setAttribute('aria-expanded', String(open));
  el.querySelector('[data-import]').classList.toggle('is-open', open);
  if (open) {
    toggleDrawer(el, false);
    if (!st.loaded && !st.busy) loadImport(el);
  }
}

/** 切平台：清掉上一个平台的结果再拉，绝不把网易云的缓存糊到 QQ / 波点上 */
function setImportPlat(el, id) {
  const st = impState();
  const plat = impPlat(id);
  if (st.plat === plat.id) return;
  st.plat = plat.id;
  st.loaded = false;
  st.error = '';
  st.needLogin = false;
  st.items = [];
  st.picked.clear();
  st.done.clear();
  paintImport(el);
  if (st.open) loadImport(el);
}

async function loadImport(el) {
  const st = impState();
  const plat = impPlat(st.plat);
  const who = plat.id;

  st.busy = true;
  st.loaded = false;
  st.error = '';
  st.needLogin = false;
  st.items = [];
  st.picked.clear();
  st.done.clear();
  paintImport(el);

  /* 没有接口的平台不用打网络，直接把原因写在列表区 */
  if (plat.unavailable) {
    st.busy = false;
    st.loaded = true;
    paintImport(el);
    return;
  }

  try {
    if (plat.needsLogin) {
      const ok = await impLoggedIn(plat);
      if (st.plat !== who) return;            /* 期间切走了，旧响应当场丢掉 */
      if (ok === false) {
        st.needLogin = true;
        st.loaded = true;
        st.busy = false;
        paintImport(el);
        return;
      }
    }
    const res = await plat.fetchList();
    if (st.plat !== who) return;              /* 切走后才回来的旧列表不写进当前平台 */
    if (res && res.error) throw new Error(res.error);
    st.items = (res && res.items) || [];
    /* 已收藏判断跟着平台走：同一张专辑在不同音源是两个 key */
    st.done = new Set(st.items.filter((a) => collection.has(`${who}:${a.id}`)).map((a) => a.id));
    st.loaded = true;
  } catch (e) {
    if (st.plat === who) st.error = String((e && e.message) || e);
  } finally {
    if (st.plat === who) {
      st.busy = false;
      /* 失败也算「问过一次」，下次打开面板不自动重打；错误会留在列表区 */
      st.loaded = st.loaded || !!st.error;
      paintImport(el);
    }
  }
}

function paintImport(el) {
  const st = impState();
  const plat = impPlat(st.plat);
  const box = el.querySelector('[data-import-list]');
  const cnt = el.querySelector('[data-import-count]');
  const run = el.querySelector('[data-import-run]');
  const allBtn = el.querySelector('[data-import-all]');
  if (!box) return;

  /* 切换行永远跟当前平台对齐（加载中 / 失败 / 未登录都一样） */
  for (const tab of el.querySelectorAll('[data-imp-plat]')) {
    const on = tab.dataset.impPlat === plat.id;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-pressed', String(on));
  }

  if (plat.unavailable) {
    box.innerHTML = `<p class="ma-import__note ma-import__note--off">该平台暂不提供收藏专辑列表。<br>${esc(plat.unavailable)}。目前只有网易云、QQ 和波点提供。</p>`;
    cnt.textContent = '—';
    run.textContent = '暂不可导入';
    run.disabled = true;
    allBtn.disabled = true;
    return;
  }

  if (st.needLogin) {
    box.innerHTML = `<p class="ma-import__note ma-import__note--off">未登录 ${esc(plat.loginName)}。<br>去「设置 → 平台账号」扫码登录后再回来。</p>`;
    cnt.textContent = '未登录';
    run.textContent = '导入 0 张';
    run.disabled = true;
    allBtn.disabled = true;
    return;
  }

  if (!st.loaded) {
    box.innerHTML = `<p class="ma-import__note">${st.error ? '读取失败：' + esc(st.error) : `正在读取${esc(plat.name)}收藏…`}</p>`;
    cnt.textContent = st.error ? '失败' : '…';
    run.textContent = st.busy ? '读取中…' : '导入 0 张';
    run.disabled = true;
    allBtn.disabled = true;
    return;
  }
  if (!st.items.length) {
    box.innerHTML = `<p class="ma-import__note">${st.error ? '读取失败：' + esc(st.error) : `这个账号在${esc(plat.name)}没有收藏的专辑。`}</p>`;
    cnt.textContent = st.error ? '失败' : '0 张';
    run.textContent = '导入 0 张';
    run.disabled = true;
    allBtn.disabled = true;
    return;
  }

  cnt.textContent = `${st.items.length} 张 · 已收 ${st.done.size}`;
  box.innerHTML = st.items.map((a) => {
    const done = st.done.has(a.id);
    const on = st.picked.has(a.id);
    const art = a.cover ? `<img src="${esc(imgSrc(a.cover, 120))}" alt="" loading="lazy" decoding="async">` : '<span class="ma-imp__ph"></span>';
    return `<button class="ma-imp${done ? ' is-done' : ''}${on ? ' is-on' : ''}" type="button"
              data-imp="${esc(a.id)}" aria-pressed="${on}"${done ? ' disabled' : ''}>
        ${art}
        <span class="ma-imp__t"><b>${esc(a.name)}</b><em>${esc(a.artists || '—')}</em></span>
        <span class="ma-imp__s">${done ? '已收藏' : on ? '✓' : '+'}</span>
      </button>`;
  }).join('');

  const selectable = st.items.filter((a) => !st.done.has(a.id)).length;
  run.textContent = st.busy ? '导入中…' : `导入 ${st.picked.size} 张`;
  run.disabled = st.busy || st.picked.size === 0;
  allBtn.textContent = st.picked.size > 0 && st.picked.size === selectable ? '取消全选' : '全选';
  allBtn.disabled = selectable === 0;
}

function importToggleAll(el) {
  const st = impState();
  const selectable = st.items.filter((a) => !st.done.has(a.id));
  if (st.picked.size === selectable.length) st.picked.clear();
  else selectable.forEach((a) => st.picked.add(a.id));
  paintImport(el);
}

async function runImport(el) {
  const st = impState();
  const plat = impPlat(st.plat);
  if (plat.unavailable || st.needLogin) return;
  const picks = st.items.filter((a) => st.picked.has(a.id) && !st.done.has(a.id));
  if (!picks.length || st.busy) return;
  st.busy = true;
  paintImport(el);
  for (const a of picks) {
    collection.add({
      id: a.id, name: a.name, artists: a.artists, cover: a.cover,
      publishTime: a.publishTime, trackCount: a.trackCount, source: plat.id,
    });
  }
  st.picked.clear();
  st.done = new Set(st.items.filter((a) => collection.has(`${plat.id}:${a.id}`)).map((a) => a.id));
  st.busy = false;
  paintImport(el);
  /* 收藏层 onChange 会自己重绘架子；这里再显式刷一次，保证刚导入的立刻出现在架子上 */
  if (typeof refresh === 'function') refresh();
}

/** 打开某一张的专辑页（走 nav.js 的访问栈，返回键才能回到架子） */
function openItem(i) {
  const a = collection.list().slice(0, MAX)[i];
  if (!a) return;
  if (a.source !== 'netease') {
    note(`「${a.name}」来自 ${a.source}，这个音源还不能在这里打开专辑页`);
    return;
  }
  const id = Number(albumIdOf(a));

  /* 走 app.js 那条全站统一的 [data-alb] 入口：它会把 pages/nav.js 真正 load 起来
     （app.js 的返回键只认自己 load 过的那份模块），并顺手把专辑压进访问栈。
     直接 import('./nav.js').openAlbum 也能开，但顶栏返回键会退到大厅而不是架子。 */
  const link = document.createElement('a');
  link.dataset.alb = String(id);
  link.hidden = true;
  document.body.appendChild(link);
  const tick0 = showTick;
  link.click();
  link.remove();

  /* 兜底：app.js 的 [data-alb] 代理不在（单独引用这个模块）时才自己开。
     但它的 import 是异步的，所以不能只看 data-view —— 用 showTick 判断这 260ms 里
     有没有人接住这次跳转。以前这里无条件排一枪：用户点开专辑后马上按返回，
     260ms 后会被从架子又拽回专辑页（真 bug，顺手修掉）。 */
  if (document.body.dataset.view === 'album' || showTick !== tick0) return;
  setTimeout(() => {
    if (showTick !== tick0) return;                 /* 这期间已经有人切过视图（接住了 / 用户返回了） */
    if (document.body.dataset.view !== 'album') {
      import('./nav.js').then((m) => m.openAlbum(id)).catch(() => {});
    }
  }, 260);
}

/* 一句临时提示（只在"这个音源打不开专辑页"这种场景用）。
   底部那行常驻提示语第二轮已整段删除（用户要求）；这里是一颗 3.2s 自动消失的小气泡，
   绝对定位、不占布局，所以删掉常驻行之后舞台下面不会留空。 */
function note(msg) {
  const h = S.el && S.el.querySelector('[data-note]');
  if (!h) return;
  clearTimeout(S.noteTimer);
  h.textContent = msg;
  h.hidden = false;
  S.noteTimer = setTimeout(() => { h.hidden = true; h.textContent = ''; }, 3200);
}

/* ---------------- 键盘：← → 选，Enter 开，Esc 收列表 ---------------- */
function onKey(e) {
  if (!active() || !S.items.length) return;
  const t = e.target;
  if (t && t.closest && t.closest('.ma-drawer')) return;               /* 列表里回车别开架子上的 */
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;  /* 搜索框里打字别抢 */

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1);
  } else if (e.key === 'Enter') {
    if (t && t.closest && t.closest('.ma-item')) return;   /* 焦点在卡片上时让它自己的 click 处理 */
    const it = S.items[S.sel];
    if (!it) return;
    e.preventDefault();
    if (form === 'spine') {
      /* 侧立：第一次 Enter 展开特写（和点一张一样），已经开着就进专辑页 */
      if (S.open >= 0) { const i = S.open; closeUp(); openItem(i); } else openUp(S.sel);
    } else {
      openItem(Number(it.dataset.i));
    }
  } else if (e.key === 'Escape') {
    if (S.open >= 0) { closeUp(); return; }               /* Esc：先把特写收回架子 */
    if (S.root.classList.contains('is-drawer')) toggleDrawer(S.el, false);
  }
}

function step(d) {
  const last = S.items.length - 1;
  if (S.open >= 0) closeUp();
  S.sel = clamp(S.sel + d, 0, last);
  S.target = S.sel;
  paintSel();
  kick();
}

/* ==================================================================
 * 5. 对外：mount / open / setForm / boot
 * ================================================================== */

/**
 * 把当前形态落到 DOM 上：data-form 决定 pages.css 用哪套面（立脊 / 封底 / 正面），
 * --ma-size 决定卡有多大，--ma-persp 决定舞台透视。形态切换只要重跑一次它 + layout()。
 * 尺寸读 window 的视口（宽 + 高都参与）：1440×900 → 702，窗口一变高封面同步变大。
 */
function applyForm(el) {
  const root = el && el.querySelector('[data-ma]');
  if (!root) return;
  root.dataset.form = form;
  M = tuneFor(window.innerWidth || el.clientWidth || 1440, window.innerHeight || 900);
  el.style.setProperty('--ma-size', sizePx() + 'px');
  if (S.stage) S.stage.style.setProperty('--ma-persp', (form === 'spine' ? M.spersp : M.persp) + 'px');
  /* 换形态 / 换尺寸都要把微动归零：flow 下不启用，spine 下按新的舞台尺寸重新算 */
  S.tx = 0; S.ty = 0; S.x = 0; S.y = 0;
  applyTilt();
  upgradeArt();
  applyAmbient();
}

/** 窗口变大后把正封 / 封底 / 黑胶 label 换成更大的图（只升不降：来回拖窗口不反复请求）。
 *  立脊小标固定 96px，不参与升级。 */
function upgradeArt() {
  const req = artReq();
  if (req <= artReqUsed) return 0;
  let n = 0;
  for (const it of S.items) {
    const cover = it.dataset.cover;
    if (!cover) continue;
    for (const im of it.querySelectorAll('.ma-item__art img, .ma-item__back img, .ma-item__vlabel img')) {
      const next = coverSrc(cover, req);
      if (im.getAttribute('src') === next) continue;
      im.setAttribute('src', next);
      n++;
    }
  }
  artReqUsed = req;
  return n;
}

/**
 * 切形态：写 localStorage → 重排。设置面板那一行（app.js）与 lizi:ma-form 事件都走这里。
 * 正停在「我的专辑」上时是**同步**重排（一次 layout()，不刷新、不跳页、不等 rAF）。
 */
export function setForm(next) {
  const v = next === 'flow' ? 'flow' : 'spine';
  try { localStorage.setItem(FORM_KEY, v); } catch (e) { /* 写不进去就只影响本次会话 */ }
  if (v === form) return form;
  form = v;
  /* 切形态 = 先把特写收干净（flow 里没有黑胶 / 没有开合） */
  S.open = -1;
  S.openP = S.items.map(() => 0);
  for (const it of S.items) it.classList.remove('is-open');
  const cta = S.el && S.el.querySelector('[data-cta]');
  if (cta) cta.hidden = true;
  if (S.el && S.root) {
    applyForm(S.el);
    layout();
    kick();
  }
  return form;
}

export function mount(viewEl) {
  ensureCss();
  const el = viewEl || byId();
  if (!el) return 0;

  shell(el);
  bind(el);

  /* 存储里是新的形态（比如设置面板刚写过）就跟着它走，别让进程内状态和 localStorage 打架 */
  try {
    const saved = localStorage.getItem(FORM_KEY);
    if (saved === 'flow' || saved === 'spine') form = saved;
  } catch (e) { /* 读不到就沿用内存里的 */ }

  applyForm(el);
  paint(el);
  return S.items.length;
}

/** 刷新（外部改了 localStorage / 收藏变化后想让架子立刻对齐） */
export function refresh() {
  if (!S.el) return 0;
  return mount(S.el);
}

/** 从大厅入口进来：压栈，返回键才能逐级回退 */
export function open() {
  return import('./nav.js')
    .then((m) => m.openMyAlbums())
    .catch(() => mount());
}

let booted = false;
/** 静态空壳在 index.html 里；这里把"视图被切过来"的几条路都接住 */
export function boot() {
  if (booted) return;
  booted = true;
  ensureCss();

  document.addEventListener('keydown', onKey);

  /* 抽屉外点一下关掉；特写态点架子外面也收回（"点空白处"） */
  document.addEventListener('click', (e) => {
    if (!S.el || !S.root) return;
    const t = e.target;
    if (S.open >= 0 && !(t.closest && (t.closest('.ma-stage') || t.closest('[data-cta]')))) closeUp();
    if (!S.root.classList.contains('is-drawer')) return;
    if (t.closest && (t.closest('.ma-drawer') || t.closest('[data-drawerbtn]'))) return;
    toggleDrawer(S.el, false);
  }, true);

  let rz = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    /* 防抖 80ms：验收要求 resize 后 120ms 内 --ma-size 更新（实测 ~85ms） */
    rz = setTimeout(() => {
      if (!S.el) return;
      const next = tuneFor(window.innerWidth, window.innerHeight);
      const changed = next.size !== M.size || next.ssize !== M.ssize;
      M = next;
      if (!changed) return;
      S.el.style.setProperty('--ma-size', sizePx() + 'px');
      if (S.stage) S.stage.style.setProperty('--ma-persp', (form === 'spine' ? M.spersp : M.persp) + 'px');
      upgradeArt();
      if (S.items.length) layout();
    }, 80);
  });

  collection.onChange(() => { if (S.el) paint(S.el); });

  /* 设置面板那一行点完会发这个事件（app.js 只做读写，不碰渲染）—— 就地重排，不刷新 */
  document.addEventListener('lizi:ma-form', (e) => {
    setForm(e.detail && e.detail.form);
  });

  /* 三条入口都接住：
     a) nav.js 的 go() → lizi:show
     b) 别处直接 show('myalbums')（app.js 会写 body[data-view]）
     c) 再兜一层：有人直接给 #view-myalbums 加 is-active */
  document.addEventListener('lizi:show', (e) => {
    if (e.detail && e.detail.view === 'myalbums') mount(byId());
  });
  new MutationObserver(() => {
    const v = byId();
    if (v && (document.body.dataset.view === 'myalbums' || v.classList.contains('is-active'))) mount(v);
  }).observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  const v = byId();
  if (v) new MutationObserver(() => { if (v.classList.contains('is-active')) mount(v); })
    .observe(v, { attributes: true, attributeFilter: ['class'] });

  /* 给大厅入口 / 验收脚本用的把手 */
  window.__LIZI_MYALBUMS = {
    open, mount, refresh, setForm,
    form: () => form,
    forms: { ...FORMS },
    list: () => collection.list(),
    index: () => S.sel,
    pos: () => S.pos,
    keys: () => S.items.map((it) => it.dataset.key),
    center: () => S.items[S.sel] || null,
    collection,
    /* 特写 / 背景：验收脚本用 */
    bg: () => bgMode,
    setBg,
    openIndex: () => S.open,
    openP: () => S.openP.slice(),
    closeUp,
    openUp,
    themeOf: (i) => {
      const it = S.items[i];
      if (!it) return null;
      const cs = getComputedStyle(it);
      return {
        key: it.dataset.key,
        bg: cs.getPropertyValue('--sp-bg').trim(),
        fg: cs.getPropertyValue('--sp-fg').trim(),
        amb: it.dataset.amb || '',
        hue: Number(it.dataset.spHue || 'NaN'),
        src: it.dataset.spSrc || '',
      };
    },
    /* 尺寸 / 微动：验收脚本用 */
    size: () => sizePx(),
    metrics: () => ({ ...M }),
    imgReq: () => artReq(),
    imgReqUsed: () => artReqUsed,
    ambHue: () => S.ambH,
    tilt: () => ({ x: S.x, y: S.y, tx: S.tx, ty: S.ty, reduce: REDUCE }),
    tiltTo,
  };
  window.openMyAlbums = open;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}









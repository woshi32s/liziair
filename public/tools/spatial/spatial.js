/* ==========================================================================
   LIZI · 360° 空间音频（大厅「工具箱」里的一个工具）
   --------------------------------------------------------------------------
   做什么：
     一个有纵深的 3D 舞台：听者在原点，1–4 个立体音响可以放在任意方位、
     任意远近、任意仰角上。把音响拖到哪儿，耳机里听到的声音就来自哪儿。

   音频链路（完全不碰主播放器）：
     自己的 AudioContext
       AudioBufferSourceNode（主播放器当前歌曲解码后的 buffer）
         ├─ PannerNode × N（HRTF / inverse 距离模型）
         │    └─ GainNode × N（单个音响音量 × 数量补偿）
         └─ 都汇到 masterGain → AnalyserNode → destination
     分析节点放在 masterGain 之后：舞台上波环的强弱跟「真正送进耳朵的电平」
     一致，总音量拧到 0，波环也会跟着消失。

   角度约定（俯视，正前方 = 0°，角度向左增大，和单子里的「左 90° / 右 270°」一致）：
     世界坐标：X 向右、Y 向上、Z 向前是 -Z（Web Audio 听者默认朝向 -Z）
       x = -sin(θ) * cos(仰角) * d
       y = sin(仰角) * d
       z = -cos(θ) * cos(仰角) * d
     所以 0° 在前、90° 在左、180° 在后、270° 在右；d 是音响到听者的真实距离，
     高度就是 y（0 = 地面，最高 3 m）。XYZ 输入框和极坐标共用这一份几何，
     改 XYZ 时按同样的公式反算回 angle / distance / elevation，不会各说各话。

   3D 投影（canvas 2D，不用 WebGL）：
     相机在半径 7.4m 的球面上绕原点转：yaw 绕 Y 轴、pitch 是俯角、zoom 只改焦距。
     project(x, y, z) 把世界点投到屏幕；groundPoint(clientX, clientY) 反着来：
     屏幕点 → 相机射线 → 与 y=0 平面求交，拖动音响时角度和距离就是这么算的，
     所以视角转过之后拖拽方向依然正确。
     为什么不用 WebGL：透明窗口里 WebGL 的合成开销大（大厅那边已经踩过
     WebGL 铺色 + 大面积模糊一起卡的坑），几百条透视折线用 2D canvas 完全够，
     配色直接写死成和浮层一致的深色 + 琥珀，不依赖浏览器对 oklch 的支持。

   边界：
     · HRTF 只有戴耳机才容易听出前后；外放只能听出左右。
     · 音源固定为主播放器当前歌曲：fetch + decodeAudioData，跨域、链接失效或解码
       失败时如实报错，不会偷偷换成别的测试音。
     · 高度限制在 0–3 m（0 = 地面），避免箱子穿地；高度和仰角是同一件事：
       y = sin(仰角) × 距离，超过当前距离的请求会被钳到 90°。
     · 预设的「全局」只做三件事：持久化、打开工具时自动套用、暴露 API。
       本工具的音频图是自己的 AudioContext，主播放器走 eq-engine.js 的图；
       关掉工具后空间效果不会继续作用在主播放器上（那需要把 panner 插进
       eq-engine 的链路，会和 EQ 的 MediaElementSource 抢节点，另开一轮做）。
   ========================================================================== */

window.LIZI_SPATIAL = (() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 常量
   * ------------------------------------------------------------------ */
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const MAX_SPEAKERS = 4;
  const MIN_DIST = 0.9;          // 最近 0.9 m
  const MAX_DIST = 3.4;          // 最远 3.4 m
  const MAX_ELEV = 90;           // 仰角上限 90°（高度由距离反算，3 m 以内够用）
  const MIN_HEIGHT = 0;          // 高度下限：0 = 地面，避免箱子穿地
  const MAX_HEIGHT = 3.0;        // 高度上限 3 m
  const HEIGHT_STEP = 0.05;      // 高度滑杆 / XYZ 的步进（米）
  const PRESET_KEY = 'lizi.spatial.presets.v1';
  const GLOBAL_KEY = 'lizi.spatial.global.v1';
  const DIRS = ['前', '左前', '左', '左后', '后', '右后', '右', '右前'];
  // track.source → 卡片上的平台标签；undefined / netease 都算网易云
  const SOURCE_LABELS = {
    netease: '网易云',
    qq: 'QQ 音乐',
    kugou: '酷狗',
    qishui: '汽水',
    bodian: '波点',
    kuwo: '酷我',
    local: '本地',
  };

  const AXIS_MIN_PX = 34;        // 选中音响的 XYZ 轴在屏幕上至少这么长
  const AXIS_WORLD = 1.0;        // 轴的默认世界长度（米）
  const AXIS_HIT_SEG = 9;        // 轴线段命中半径（px）
  const AXIS_HIT_TIP = 12;       // 轴端圆点命中半径（px）
  const KF_DUR_DEF = 8;          // 关键帧默认时长（秒）
  const KF_DUR_MIN = 1;
  const KF_DUR_MAX = 60;
  const KF_KEY_GAP = 0.05;       // 同一时间 0.05s 内重复记录就覆盖

  const FONT_BODY = '"Geist", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const FONT_MONO = '"Geist Mono", ui-monospace, "SFMono-Regular", monospace';

  /* 本文件的绝对 URL：spatial.css / kitten3d.js / kitten-100k.glb 都从它派生。
     defer 脚本执行时 currentScript 就是自己；取不到再按 src 反查。 */
  const SCRIPT_URL = (() => {
    const s = document.currentScript ||
      document.querySelector('script[src*="tools/spatial/spatial.js"]');
    if (s && s.src) return s.src;
    try { return new URL('tools/spatial/spatial.js', document.baseURI).href; }
    catch { return 'tools/spatial/spatial.js'; }
  })();

  /** 主播放器的取值入口。player.js 顶层写的是 `const Player = (() => …)()`，
      那是一个全局词法绑定，不是 window 的属性 —— 直接读 window.Player 永远
      是 undefined，于是「当前歌曲」一直被判成不可用。先按标识符取（同一页的
      普通脚本之间可见），取不到再退回 window（兼容以后换成别的加载方式）。 */
  function mainPlayer() {
    try { return (typeof Player !== 'undefined' && Player) || window.Player || null; } catch { return window.Player || null; }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normDeg = (a) => ((a % 360) + 360) % 360;

  /** 角度 → 人话方位。45° = 左前，90° = 左，270° = 右 */
  function dirName(a) {
    return DIRS[Math.round(normDeg(a) / 45) % 8];
  }

  function angleText(a) {
    return `${Math.round(normDeg(a)) % 360}°`;
  }

  /** 高度（米）= sin(仰角) × 距离。音频的 positionY 和画面都用它 */
  function heightOf(sp) {
    return Math.sin(clamp(sp.elevation, 0, MAX_ELEV) * DEG) * sp.distance;
  }

  /** 高度滑杆的上限：不会超过当前距离（sin 最多到 1），也不会超过 3 m */
  function heightMax(sp) {
    const m = Math.min(MAX_HEIGHT, Math.max(HEIGHT_STEP, sp.distance));
    return Math.min(MAX_HEIGHT, Math.ceil((m - 1e-6) / HEIGHT_STEP) * HEIGHT_STEP);
  }

  /** 改高度 → 反算仰角；请求超过当前距离时停在 90°（实际高度 = 距离） */
  function setHeight(sp, h) {
    const d = Math.max(0.001, sp.distance);
    const y = clamp(h, MIN_HEIGHT, Math.min(MAX_HEIGHT, d));
    sp.elevation = clamp(Math.asin(clamp(y / d, -1, 1)) / DEG, 0, MAX_ELEV);
  }

  /** 距离变大时可能把高度撑出 3 m，压回上限 */
  function clampHeight(sp) {
    if (heightOf(sp) > MAX_HEIGHT + 1e-6) setHeight(sp, MAX_HEIGHT);
  }

  /** XYZ 输入框的显示：两位小数，顺手把 -0.00 变成 0.00 */
  function fmtCoord(v) {
    const r = Math.round((Number(v) || 0) * 100) / 100;
    return (Object.is(r, -0) ? 0 : r).toFixed(2);
  }

  function placementText(sp) {
    return `${dirName(sp.angle)} ${angleText(sp.angle)} · ${sp.distance.toFixed(1)} m · 高 ${heightOf(sp).toFixed(2)} m`;
  }

  /** 列表 / 舞台标签用短读数：高度为 0 时不占地方 */
  function shortPlacement(sp) {
    const h = heightOf(sp);
    let s = `${dirName(sp.angle)} ${angleText(sp.angle)} · ${sp.distance.toFixed(1)} m`;
    if (h >= 0.05) s += ` · 高 ${h.toFixed(2)} m`;
    return s;
  }

  let REDUCED = false;
  try {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    REDUCED = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', (e) => { REDUCED = e.matches; });
  } catch { /* 老内核没有 matchMedia 事件 */ }

  /* ------------------------------------------------------------------ *
   * 样式：index.html 只加一行 script，CSS 由这里注入
   * ------------------------------------------------------------------ */
  (function injectCss() {
    if (document.querySelector('link[data-lizi-spatial-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('spatial.css', SCRIPT_URL).href;
    link.setAttribute('data-lizi-spatial-css', '');
    document.head.appendChild(link);
  })();

  const CLOSE_SVG = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18"/>
    </svg>`;

  /* 没有封面时的占位音符（静态 SVG，不依赖图片加载） */
  const NOTE_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 18V5.5l10-2V16"/>
      <circle cx="6.5" cy="18" r="2.5"/>
      <circle cx="16.5" cy="16" r="2.5"/>
    </svg>`;

  /* ------------------------------------------------------------------ *
   * 相机 / 投影
   * ------------------------------------------------------------------ */
  const CAM_R = 7.4;             // 相机离原点的距离（米）
  const PITCH_MIN = 0.30;        // 俯角下限 ≈ 17°，再平地面就压成一条线
  const PITCH_MAX = 1.02;        // 俯角上限 ≈ 58°，再陡后圈会把舞台撑破
  const PITCH_DEF = 0.64;        // 默认俯角 ≈ 37°，一个舒服的「看桌面」角度
  const ZOOM_MIN = 0.7;
  const ZOOM_MAX = 1.35;         // 再往里推，最外圈会切出舞台

  const CAM = { yaw: 0, pitch: PITCH_DEF, zoom: 1 };
  const CAM_T = { yaw: 0, pitch: PITCH_DEF, zoom: 1 };
  const camVel = { yaw: 0, pitch: 0 };

  /** 每帧算一次：相机位置、三根基向量、焦距、屏幕中心 */
  const view = {
    w: 0, h: 0, dpr: 1, focal: 0, cx: 0, cy: 0,
    cam: null, f: null, right: null, up: null,
  };

  function updateViewSpace(W, H) {
    const yaw = CAM.yaw;
    const phi = CAM.pitch;
    const sy = Math.sin(yaw), cyw = Math.cos(yaw);
    const sp = Math.sin(phi), cp = Math.cos(phi);

    view.cam = {
      x: sy * CAM_R * cp,
      y: CAM_R * sp,
      z: cyw * CAM_R * cp,
    };
    // 相机看向原点；三根轴都是单位向量
    view.f = { x: -sy * cp, y: -sp, z: -cyw * cp };
    view.right = { x: cyw, y: 0, z: -sy };
    view.up = { x: -sy * sp, y: cp, z: -cyw * sp };

    view.focal = Math.min(W, H) * 0.72 * CAM.zoom;
    view.cx = W / 2;
    view.cy = H * 0.56;
    view.w = W;
    view.h = H;
  }

  /** 世界坐标 → 屏幕像素。返回 null 表示在相机后面 */
  function project(x, y, z) {
    if (!view.f) return null;
    const vx = x - view.cam.x;
    const vy = y - view.cam.y;
    const vz = z - view.cam.z;
    const zc = vx * view.f.x + vy * view.f.y + vz * view.f.z;
    if (zc < 0.08) return null;
    const k = view.focal / zc;
    return {
      x: view.cx + (vx * view.right.x + vy * view.right.y + vz * view.right.z) * k,
      y: view.cy - (vx * view.up.x + vy * view.up.y + vz * view.up.z) * k,
      z: zc,
      k,
    };
  }

  /** 屏幕点 → 地面交点。拖音响全靠它，所以视角转过之后拖拽仍然跟手 */
  function groundPoint(clientX, clientY) {
    if (!view.f || !els || !els.stage) return null;
    const rect = els.stage.getBoundingClientRect();
    const nx = (clientX - rect.left - view.cx) / view.focal;
    const ny = (view.cy - (clientY - rect.top)) / view.focal;
    const d = {
      x: view.f.x + nx * view.right.x + ny * view.up.x,
      y: view.f.y + nx * view.right.y + ny * view.up.y,
      z: view.f.z + nx * view.right.z + ny * view.up.z,
    };
    if (d.y > -0.02) return null;         // 射线朝上，永远够不着地面
    const t = -view.cam.y / d.y;
    if (!(t > 0)) return null;
    return { x: view.cam.x + d.x * t, z: view.cam.z + d.z * t };
  }

  /* ------------------------------------------------------------------ *
   * 几何
   * ------------------------------------------------------------------ */
  let nextId = 1;

  function makeSpeaker(angle, distance, elevation) {
    const d = clamp(distance, MIN_DIST, MAX_DIST);
    let e = clamp(elevation || 0, 0, MAX_ELEV);
    // 高度上限 3 m：距离不够时把仰角压回来，别让 y 顶出范围
    if (Math.sin(e * DEG) * d > MAX_HEIGHT) {
      e = Math.asin(clamp(MAX_HEIGHT / d, -1, 1)) / DEG;
    }
    return {
      id: nextId++,
      angle: normDeg(angle),
      distance: d,
      elevation: e,
      vol: 0.85,
    };
  }

  function resetSpeakers() {
    // 单子约定：左 90° / 右 270°
    state.speakers = [makeSpeaker(90, 2.2, 0), makeSpeaker(270, 2.2, 0)];
    state.selected = state.speakers[0].id;
  }

  function findSpeaker(id) {
    return state.speakers.find((s) => s.id === id) || null;
  }

  /** 极坐标 + 仰角 → 世界坐标。音频和画面共用这一份，不会对不上。
      distance 是到听者的真实距离，所以水平半径要乘 cos(仰角)。 */
  function worldPos(sp) {
    const a = sp.angle * DEG;
    const e = clamp(sp.elevation, 0, MAX_ELEV) * DEG;
    const horiz = Math.cos(e) * sp.distance;
    return {
      x: -Math.sin(a) * horiz,
      y: Math.sin(e) * sp.distance,
      z: -Math.cos(a) * horiz,
    };
  }

  /** XYZ（米）→ 极坐标真源；和 worldPos 是严格的逆运算 */
  function setFromXyz(sp, x, y, z) {
    const xx = clamp(Number(x) || 0, -MAX_DIST, MAX_DIST);
    const yy = clamp(Number(y) || 0, MIN_HEIGHT, MAX_HEIGHT);
    const zz = clamp(Number(z) || 0, -MAX_DIST, MAX_DIST);
    const d = clamp(Math.hypot(xx, yy, zz), MIN_DIST, MAX_DIST);
    // 水平方向正好在原点时 atan2(-0,-0) 会落到正后方；保留原角度更自然
    if (Math.abs(xx) > 1e-9 || Math.abs(zz) > 1e-9) {
      sp.angle = normDeg(Math.atan2(-xx, -zz) / DEG);
    }
    sp.distance = d;
    sp.elevation = clamp(Math.asin(clamp(yy / d, -1, 1)) / DEG, 0, MAX_ELEV);
  }

  /** 新音响找空闲方位：优先 0 / 90 / 180 / 270，其次找最大空隙的中点 */
  function nextFreeAngle() {
    const used = state.speakers.map((s) => normDeg(s.angle));
    const candidates = [0, 90, 180, 270];
    const free = candidates.filter((c) =>
      used.every((a) => Math.min(Math.abs(a - c), 360 - Math.abs(a - c)) > 20));
    if (free.length) return free[0];

    const sorted = used.slice().sort((a, b) => a - b);
    let bestAt = 0;
    let bestGap = -1;
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const next = sorted[(i + 1) % sorted.length] + (i === sorted.length - 1 ? 360 : 0);
      const gap = next - cur;
      if (gap > bestGap) { bestGap = gap; bestAt = cur + gap / 2; }
    }
    return normDeg(bestAt);
  }

  /* ------------------------------------------------------------------ *
   * 预设：内置 5 套 + 自定义（localStorage）+ 全局默认
   * ------------------------------------------------------------------ */
  const BUILTIN_PRESETS = [
    {
      name: '双声道',
      speakers: [
        { angle: 90, distance: 2.2, elevation: 0, vol: 0.85 },
        { angle: 270, distance: 2.2, elevation: 0, vol: 0.85 },
      ],
      master: 0.8,
    },
    {
      name: '四角环绕',
      speakers: [
        { angle: 45, distance: 2.6, elevation: 0, vol: 0.8 },
        { angle: 135, distance: 2.6, elevation: 0, vol: 0.8 },
        { angle: 225, distance: 2.6, elevation: 0, vol: 0.8 },
        { angle: 315, distance: 2.6, elevation: 0, vol: 0.8 },
      ],
      master: 0.82,
    },
    {
      name: '近场',
      speakers: [
        { angle: 90, distance: 0.9, elevation: 0, vol: 0.9 },
        { angle: 270, distance: 0.9, elevation: 0, vol: 0.9 },
      ],
      master: 0.65,
    },
    {
      name: '宽场',
      speakers: [
        { angle: 90, distance: 3.4, elevation: 0, vol: 1 },
        { angle: 270, distance: 3.4, elevation: 0, vol: 1 },
      ],
      master: 0.9,
    },
    {
      name: '影院',
      speakers: [
        { angle: 35, distance: 2.4, elevation: 25, vol: 0.85 },
        { angle: 325, distance: 2.4, elevation: 25, vol: 0.85 },
        { angle: 135, distance: 2.8, elevation: 5, vol: 0.8 },
        { angle: 225, distance: 2.8, elevation: 5, vol: 0.8 },
      ],
      master: 0.85,
    },
  ];

  let customCache = null;        // 懒加载的自定义预设数组
  let globalCache;               // undefined = 还没读过；null = 没有全局

  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** 一只音响的极坐标姿态：距离 / 仰角 / 音量逐项钳位，高度不超过 3 m */
  function normPose(s) {
    const distance = clamp(num(s && s.distance, 2.2), MIN_DIST, MAX_DIST);
    let elevation = clamp(num(s && s.elevation, 0), 0, MAX_ELEV);
    if (Math.sin(elevation * DEG) * distance > MAX_HEIGHT) {
      elevation = Math.asin(clamp(MAX_HEIGHT / distance, -1, 1)) / DEG;
    }
    return {
      angle: normDeg(num(s && s.angle, 0)),
      distance,
      elevation,
      vol: clamp(num(s && s.vol, 0.85), 0, 1),
    };
  }

  function defaultKf() {
    return { duration: KF_DUR_DEF, loop: true, keys: [] };
  }

  /** 关键帧深拷贝：预设读写、状态初始化都走它，避免共享数组 */
  function cloneKf(raw) {
    const src = raw && typeof raw === 'object' ? raw : defaultKf();
    return {
      duration: clamp(num(src.duration, KF_DUR_DEF), KF_DUR_MIN, KF_DUR_MAX),
      loop: src.loop !== false,
      keys: (Array.isArray(src.keys) ? src.keys : []).map((k) => ({
        t: num(k && k.t, 0),
        master: clamp(num(k && k.master, 0.8), 0, 1),
        speakers: (Array.isArray(k && k.speakers) ? k.speakers : [])
          .slice(0, MAX_SPEAKERS)
          .map((s) => ({ ...normPose(s) })),
      })),
    };
  }

  /** 读回来的关键帧：t 落在 0..duration，按 t 排序，0.05s 内合并 */
  function normalizeKf(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.keys)) return null;
    const duration = clamp(Math.round(num(raw.duration, KF_DUR_DEF)), KF_DUR_MIN, KF_DUR_MAX);
    const keys = [];
    for (const item of raw.keys.slice(0, 200)) {
      if (!item || typeof item !== 'object') continue;
      const t = clamp(num(item.t, 0), 0, duration);
      const key = {
        t,
        master: clamp(num(item.master, 0.8), 0, 1),
        speakers: (Array.isArray(item.speakers) ? item.speakers : [])
          .slice(0, MAX_SPEAKERS)
          .map((s) => normPose(s)),
      };
      const dup = keys.find((k) => Math.abs(k.t - t) <= KF_KEY_GAP);
      if (dup) Object.assign(dup, key);
      else keys.push(key);
    }
    keys.sort((a, b) => a.t - b.t);
    return { duration, loop: raw.loop !== false, keys };
  }

  /** 读回来的预设逐项钳位；名字和内置冲突的丢弃 */
  function normalizePreset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 24) : '';
    if (!name || name === '__current') return null;
    if (BUILTIN_PRESETS.some((p) => p.name === name)) return null;
    const speakers = (Array.isArray(raw.speakers) ? raw.speakers : [])
      .slice(0, MAX_SPEAKERS)
      .map((s) => normPose(s));
    if (!speakers.length) return null;
    return {
      name,
      speakers,
      master: clamp(num(raw.master, 0.8), 0, 1),
      // 旧数据里的 source 字段直接忽略：音源已固定为当前歌曲
      kf: normalizeKf(raw.kf),
    };
  }

  function loadCustomPresets() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      const seen = new Set();
      const out = [];
      for (const item of raw) {
        const p = normalizePreset(item);
        if (!p || seen.has(p.name)) continue;
        seen.add(p.name);
        out.push(p);
      }
      return out.slice(0, 40);
    } catch {
      return [];
    }
  }

  function getCustomPresets() {
    if (!customCache) customCache = loadCustomPresets();
    return customCache;
  }

  function setCustomPresets(list) {
    customCache = list.slice(0, 40);
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(customCache));
    } catch { /* 配额满了就算了 */ }
  }

  function findPreset(name) {
    return BUILTIN_PRESETS.find((p) => p.name === name)
      || getCustomPresets().find((p) => p.name === name)
      || null;
  }

  function readGlobalName() {
    try {
      const raw = JSON.parse(localStorage.getItem(GLOBAL_KEY) || 'null');
      if (typeof raw === 'string') return raw;
      if (raw && typeof raw.name === 'string') return raw.name;
    } catch { /* 旧格式 / 坏数据 */ }
    return null;
  }

  /** 当前全局预设名；存的是已删除的预设时按「没有」处理 */
  function getGlobalPreset() {
    if (globalCache === undefined) globalCache = readGlobalName();
    return globalCache && findPreset(globalCache) ? globalCache : null;
  }

  function setGlobalPreset(name) {
    if (!name) {
      globalCache = null;
      try { localStorage.removeItem(GLOBAL_KEY); } catch { /* noop */ }
      return true;
    }
    if (!findPreset(name)) return false;
    globalCache = name;
    try {
      localStorage.setItem(GLOBAL_KEY, JSON.stringify({ name, at: Date.now() }));
    } catch { /* noop */ }
    return true;
  }

  function presetSnapshot(name) {
    return {
      name,
      speakers: state.speakers.map((s) => ({
        angle: s.angle,
        distance: s.distance,
        elevation: s.elevation,
        vol: s.vol,
      })),
      master: state.master,
      kf: cloneKf(state.kf),   // 关键帧跟着自定义预设走；内置预设没有 kf
    };
  }

  /** 保存当前布局；返回 null 表示成功，字符串是给用户看的错误 */
  function saveCurrentAs(name) {
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return '请输入预设名称';
    if (clean === '__current') return '这个名字不能用';
    if (BUILTIN_PRESETS.some((p) => p.name === clean)) return '内置预设名不能占用';
    if (!state.speakers.length) return '当前还没有音响';

    const list = getCustomPresets();
    const existing = list.findIndex((p) => p.name === clean);
    if (existing < 0 && list.length >= 40) return '自定义预设最多 40 个';
    const preset = presetSnapshot(clean);
    if (existing >= 0) list[existing] = preset;
    else list.push(preset);
    setCustomPresets(list);
    state.preset = clean;
    if (els) refreshPresetSelect(clean);
    return null;
  }

  function deletePreset(name) {
    const list = getCustomPresets();
    const i = list.findIndex((p) => p.name === name);
    if (i < 0) return false;
    list.splice(i, 1);
    setCustomPresets(list);
    if (getGlobalPreset() === name) setGlobalPreset(null);
    if (state.preset === name) state.preset = null;
    if (els) refreshPresetSelect(state.preset);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const state = {
    open: false,
    speakers: [],
    selected: null,
    master: 0.8,
    playing: false,
    preset: null,            // 当前套用的预设名；null = 当前布局未保存
    songBuffer: null,
    songSrc: '',
    // 关键帧动画（v1）：独立时间轴，不跟音源同步
    kf: defaultKf(),
    kfPlaying: false,
    kfTime: 0,
  };

  let root = null;
  let els = null;
  let built = false;
  let lastFocus = null;
  let drag = null;             // 拖音响
  let orbit = null;            // 拖空白处转视角
  let axisDrag = null;         // 拖选中音响的 XYZ 轴
  let axisHover = null;        // 悬停中的轴 key（'x' / 'y' / 'z'）
  let kfPanelOpen = false;
  let kfSel = -1;              // 时间轴上选中的关键帧下标
  let kfScrub = null;          // 正在拖动播放头
  let lastKfFocus = null;
  const secOpen = { preset: false, source: true, speakers: true };   // 抽屉状态：只放内存
  const nodeEls = new Map();   // speaker id → 舞台节点

  /* 3D 听者（100k 面小猫）：kitten3d.js 动态加载。
     kitten 为 null 时 drawKitten() 退回原来的 2D 小人，加载失败也只 warn 一次 */
  let kitten = null;
  let kittenLoading = false;
  let kittenFailed = false;

  /* ------------------------------------------------------------------ *
   * 音频
   * ------------------------------------------------------------------ */
  let ctx = null;
  let masterGain = null;
  let analyser = null;
  let analyserBuf = null;
  let level = 0;               // 0–1，舞台上的声波/电平晕都读它
  let sourceNode = null;
  let sourceConnected = new Set();
  const audioSpk = new Map();  // speaker id → { panner, gain }
  let activeBuffer = null;
  let playOffset = 0;
  let playStartedAt = 0;
  let mainWasPlaying = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('这个浏览器不支持 Web Audio');
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = state.master;

    // 分析节点放在 masterGain 之后：读到的就是真正送出去的信号
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;              // 128/256 足够取 RMS，越小越省
    analyser.smoothingTimeConstant = 0.78;
    analyserBuf = new Uint8Array(analyser.fftSize);

    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
    setupListener();
    return ctx;
  }

  /** 听者在原点、面朝 -Z（屏幕上方 = 正前），与 Panner 的角度约定一致 */
  function setupListener() {
    const L = ctx.listener;
    if (!L) return;
    if (L.positionX) {
      L.positionX.value = 0;
      L.positionY.value = 0;
      L.positionZ.value = 0;
      L.forwardX.value = 0;
      L.forwardY.value = 0;
      L.forwardZ.value = -1;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else if (L.setPosition) {
      L.setPosition(0, 0, 0);
      L.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  /** 每个音响的音量再除以 √N：加音响时总响度大致不变，不会越加越吵 */
  function speakerTarget(sp) {
    return clamp(sp.vol, 0, 1) / Math.sqrt(Math.max(1, state.speakers.length));
  }

  function setPannerPos(panner, sp, immediate) {
    const { x, y, z } = worldPos(sp);
    if (panner.positionX) {
      if (immediate) {
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
      } else {
        const t = ctx ? ctx.currentTime : 0;
        // 拖动时平滑追过去，避免爆音和拉链噪声
        panner.positionX.setTargetAtTime(x, t, 0.035);
        panner.positionY.setTargetAtTime(y, t, 0.035);
        panner.positionZ.setTargetAtTime(z, t, 0.035);
      }
    } else if (panner.setPosition) {
      // 老 Safari 兜底：没有 AudioParam 版本，只能直接设
      panner.setPosition(x, y, z);
    }
  }

  function updateGain(sp) {
    const rec = audioSpk.get(sp.id);
    if (!rec || !ctx) return;
    try {
      rec.gain.gain.setTargetAtTime(speakerTarget(sp), ctx.currentTime, 0.03);
    } catch { /* 上下文正在关闭 */ }
  }

  function createSpeakerAudio(sp) {
    if (!ctx) return;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 20;
    panner.rolloffFactor = 0.8;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    setPannerPos(panner, sp, true);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    panner.connect(gain);
    gain.connect(masterGain);

    const rec = { panner, gain };
    audioSpk.set(sp.id, rec);
    updateGain(sp);   // 从 0 平滑到目标，避免新音响“啪”一声

    if (sourceNode) {
      try {
        sourceNode.connect(panner);
        sourceConnected.add(panner);
      } catch { /* 已经连过或上下文关闭 */ }
    }
  }

  function removeSpeakerAudio(id) {
    const rec = audioSpk.get(id);
    if (!rec || !ctx) return;
    audioSpk.delete(id);
    try {
      rec.gain.gain.cancelScheduledValues(ctx.currentTime);
      rec.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    } catch { /* noop */ }
    const oldSource = sourceNode;
    sourceConnected.delete(rec.panner);
    // 留 80ms 让增益落下去再断开（连去 source 的连接也留到这时），避免删音响时爆音
    setTimeout(() => {
      if (oldSource) {
        try { oldSource.disconnect(rec.panner); } catch { /* noop */ }
      }
      try { rec.panner.disconnect(); } catch { /* noop */ }
      try { rec.gain.disconnect(); } catch { /* noop */ }
    }, 80);
  }

  function syncSpeakerAudio() {
    if (!ctx) return;
    const keep = new Set(state.speakers.map((s) => s.id));
    for (const id of Array.from(audioSpk.keys())) {
      if (!keep.has(id)) removeSpeakerAudio(id);
    }
    for (const sp of state.speakers) {
      if (!audioSpk.has(sp.id)) createSpeakerAudio(sp);
      else {
        const rec = audioSpk.get(sp.id);
        setPannerPos(rec.panner, sp, true);
        updateGain(sp);
      }
    }
  }

  function stopSource() {
    const node = sourceNode;
    sourceNode = null;
    sourceConnected.clear();
    if (!node) return;
    node.onended = null;
    try { node.stop(); } catch { /* 还没 start 或已停 */ }
    try { node.disconnect(); } catch { /* noop */ }
  }

  function startSource(buffer, offset) {
    stopSource();
    if (!ctx || !buffer) return;

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = false;          // 音源固定为当前歌曲，永远不循环
    sourceNode = node;

    sourceConnected.clear();
    for (const rec of audioSpk.values()) {
      try {
        node.connect(rec.panner);
        sourceConnected.add(rec.panner);
      } catch { /* noop */ }
    }

    node.onended = () => {
      if (sourceNode !== node) return;      // 我们主动停的，不处理
      sourceNode = null;
      sourceConnected.clear();
      state.playing = false;
      playOffset = 0;
      updateTransport();
      setMsg('播放结束');
    };

    playStartedAt = ctx.currentTime;
    playOffset = clamp(offset || 0, 0, Math.max(0, buffer.duration - 0.01));
    try {
      node.start(0, playOffset);
    } catch {
      stopSource();
      throw new Error('音频启动失败');
    }
  }

  function currentOffset() {
    if (!ctx || !state.playing || !activeBuffer) return playOffset;
    const elapsed = Math.max(0, ctx.currentTime - playStartedAt);
    return Math.min(playOffset + elapsed, activeBuffer.duration);
  }

  async function loadSong() {
    const P = mainPlayer();
    const a = P && P.audio;
    const src = a && a.src;
    if (!src) throw new Error('播放器里还没有歌曲');

    if (state.songBuffer && state.songSrc === src) return state.songBuffer;

    ensureCtx();
    setMsg('正在读取当前歌曲…');

    let res;
    try {
      res = await fetch(src);
    } catch {
      throw new Error('读不到当前歌曲（链接失效或跨域）');
    }
    if (!res.ok) throw new Error(`读取当前歌曲失败（HTTP ${res.status}）`);

    let ab;
    try { ab = await res.arrayBuffer(); }
    catch { throw new Error('读取当前歌曲失败'); }

    if (!state.open || !ctx) return null;

    let buf;
    try { buf = await ctx.decodeAudioData(ab); }
    catch { throw new Error('当前歌曲解码失败'); }

    if (!state.open) return null;   // 解码期间工具被关了，不要留住几十 MB

    // 解码期间主播放器可能已经换歌：别把旧歌的 buffer 当成当前歌曲
    const now = mainPlayer();
    const nowSrc = now && now.audio && now.audio.src;
    if (nowSrc && nowSrc !== src) throw new Error('歌曲已切换，按播放重新加载');

    state.songBuffer = buf;
    state.songSrc = src;
    setMsg(`已载入当前歌曲 · ${buf.duration.toFixed(1)} 秒`);
    return buf;
  }

  function pauseMainForSong() {
    const P = mainPlayer();
    const a = P && P.audio;
    if (!a || a.paused) return;
    mainWasPlaying = true;
    try { a.pause(); } catch { /* noop */ }
  }

  function restoreMainPlayer() {
    if (!mainWasPlaying) return;
    mainWasPlaying = false;
    const P = mainPlayer();
    const a = P && P.audio;
    if (!a) return;
    try {
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch { /* 用户手势限制之类的，忽略 */ }
  }

  async function play() {
    if (!state.open) return;
    try {
      ensureCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!state.open) return;

      // 音源固定为主播放器当前歌曲；没有歌 / 读不到 / 解码失败都如实报错
      await loadSong();
      if (!state.open) return;
      if (!state.songBuffer) throw new Error('当前歌曲没准备好');
      pauseMainForSong();
      activeBuffer = state.songBuffer;

      if (playOffset >= activeBuffer.duration) playOffset = 0;
      syncSpeakerAudio();

      state.playing = true;
      startSource(activeBuffer, playOffset);
      waveAcc = 0;
      updateTransport();
      setMsg('主播放器已暂停；关闭工具后会恢复');
    } catch (e) {
      state.playing = false;
      restoreMainPlayer();
      const message = (e && e.message) || '播放失败';
      setMsg(message, true);
      updateTransport();
    }
  }

  function pause() {
    if (!state.playing) return;
    playOffset = currentOffset();
    state.playing = false;
    stopSource();
    updateTransport();
  }

  function togglePlay() {
    if (state.playing) pause();
    else play();
  }

  /** 关闭时：先把总增益拉下去，再停源、断节点、关上下文 */
  function teardownAudio() {
    const oldCtx = ctx;
    const oldMaster = masterGain;
    const oldAnalyser = analyser;
    const oldSource = sourceNode;
    const oldSpk = Array.from(audioSpk.values());

    ctx = null;
    masterGain = null;
    analyser = null;
    analyserBuf = null;
    sourceNode = null;
    sourceConnected.clear();
    audioSpk.clear();
    activeBuffer = null;
    playOffset = 0;
    level = 0;
    waves.length = 0;
    waveAcc = 0;
    // 整首歌的 AudioBuffer 可能几十 MB，关闭就放掉
    state.songBuffer = null;
    state.songSrc = '';

    if (!oldCtx) return;

    try {
      if (oldMaster) oldMaster.gain.setTargetAtTime(0, oldCtx.currentTime, 0.02);
    } catch { /* noop */ }

    setTimeout(() => {
      if (oldSource) {
        try { oldSource.onended = null; } catch { /* noop */ }
        try { oldSource.stop(); } catch { /* noop */ }
        try { oldSource.disconnect(); } catch { /* noop */ }
      }
      for (const rec of oldSpk) {
        try { rec.panner.disconnect(); } catch { /* noop */ }
        try { rec.gain.disconnect(); } catch { /* noop */ }
      }
      try { if (oldAnalyser) oldAnalyser.disconnect(); } catch { /* noop */ }
      try { oldCtx.close(); } catch { /* noop */ }
    }, 80);
  }

  /* ------------------------------------------------------------------ *
   * 画布：地面 / 声波 / 听者 / 音响
   * ------------------------------------------------------------------ */
  let cvs = null;
  let g = null;
  // 深色听音室配色：暖白画线条和听者，琥珀只留给「选中的音响 / 声波」。
  // 文字阴影用近黑，压在地面网格上也读得清。
  const PAL = {
    bg: '#0b0e11',
    ink: '#f4efe7',
    ink2: '#cfc6b9',
    ink3: '#a39a8e',
    grid: '#d6cdc2',
    accent: '#f2a65a',
  };

  const BOX = { HW: 0.21, HD: 0.15, HH: 0.24 };   // 半宽 / 半深 / 半高（米）

  const waves = [];
  let waveAcc = 0;
  const anim = { on: false, raf: 0, last: 0, camText: '', level: -1, progress: -1 };

  function resizeCanvas() {
    if (!cvs || !g || !els) return;
    const w = Math.max(1, els.stage.clientWidth);
    const h = Math.max(1, els.stage.clientHeight);
    if (w <= 1 || h <= 1) return;            // 浮层还没显示，等下一次
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    view.dpr = dpr;
    view.w = w;
    view.h = h;
    if (state.open) drawScene();
  }

  function circlePoints(cx, cz, r, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      const p = project(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
      if (!p) return null;
      pts.push(p);
    }
    return pts;
  }

  function pathRing(pts) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
  }

  function strokeRing(pts, color, alpha, width) {
    if (!pts) return;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width || 1;
    pathRing(pts);
    g.stroke();
    g.restore();
  }

  function textAt(str, p, font, color, alpha, align) {
    if (!p) return;
    g.save();
    g.globalAlpha = alpha;
    g.font = font;
    g.fillStyle = color;
    g.textAlign = align || 'center';
    g.textBaseline = 'middle';
    g.shadowColor = PAL.bg;
    g.shadowBlur = 4;
    g.fillText(str, p.x, p.y);
    g.restore();
  }

  function drawGround() {
    const plate = circlePoints(0, 0, 3.55, 72);
    if (!plate) return;

    // 地台：中心一圈很淡的暖光，往外淡到 0 —— 有实体感但不出现灰块
    const o = project(0, 0, 0);
    if (o) {
      const grad = g.createRadialGradient(o.x, o.y, 2, o.x, o.y, Math.min(view.w, view.h) * 0.62);
      grad.addColorStop(0, PAL.accent);
      grad.addColorStop(1, 'transparent');
      g.save();
      g.globalAlpha = 0.07;
      g.fillStyle = grad;
      pathRing(plate);
      g.fill();
      g.restore();
    }

    // 每 0.5m 一圈；1/2/3m 加重并标字
    for (let r = 0.5; r <= 3.5; r += 0.5) {
      const major = r % 1 === 0;
      const pts = circlePoints(0, 0, r, 64);
      strokeRing(pts, PAL.grid, major ? 0.22 : 0.09, major ? 1.2 : 1);
      if (major && r <= 3) {
        const p = project(0.82 * r, 0, -0.57 * r);
        textAt(`${r}m`, p, `12px ${FONT_MONO}`, PAL.ink3, 0.9);
      }
    }

    // 每 30° 一根方位线；0/90/180/270 加重
    for (let d = 0; d < 360; d += 30) {
      const a = d * DEG;
      const major = d % 90 === 0;
      const p1 = project(-Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      const p2 = project(-Math.sin(a) * 3.5, 0, -Math.cos(a) * 3.5);
      if (!p1 || !p2) continue;
      g.save();
      g.globalAlpha = major ? 0.16 : 0.07;
      g.strokeStyle = PAL.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(p1.x, p1.y);
      g.lineTo(p2.x, p2.y);
      g.stroke();
      g.restore();
    }
  }

  function drawCompass() {
    const words = [
      { a: 0, t: '前' }, { a: 90, t: '左' },
      { a: 180, t: '后' }, { a: 270, t: '右' },
    ];
    for (const w of words) {
      const a = w.a * DEG;
      const p = project(-Math.sin(a) * 3.26, 0, -Math.cos(a) * 3.26);
      const t0 = project(-Math.sin(a) * 3.02, 0, -Math.cos(a) * 3.02);
      const t1 = project(-Math.sin(a) * 3.44, 0, -Math.cos(a) * 3.44);
      if (t0 && t1) {
        g.save();
        g.globalAlpha = 0.4;
        g.strokeStyle = PAL.grid;
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(t0.x, t0.y);
        g.lineTo(t1.x, t1.y);
        g.stroke();
        g.restore();
      }
      textAt(w.t, p, `600 15px ${FONT_BODY}`, PAL.ink2, 0.92);
    }
  }

  /** 每个音响脚下扩散的同心波：从实际电平里取强弱。
      暂停时不再发新波，靠 level 自然衰减 + 各自的 ttl 收尾，不会啪一下消失。 */
  function drawWaves() {
    if (!waves.length) return;
    for (const w of waves) {
      const t = w.age / w.ttl;
      if (t >= 1) continue;
      const r = 0.1 + t * 1.15;
      const a = Math.pow(1 - t, 1.6) * level * w.strength * 0.72;
      if (a < 0.012) continue;
      strokeRing(circlePoints(w.x, w.z, r, 44), PAL.accent, a, 1.2);
    }
  }

  function drawListenerHalo() {
    const lv = state.playing ? level : 0;
    if (lv < 0.02) return;
    const r = REDUCED ? 0.42 : 0.34 + lv * 0.26;
    strokeRing(circlePoints(0, 0, r, 44), PAL.accent, 0.10 + lv * 0.34, 1.2);

    const o = project(0, 0, 0);
    if (!o) return;
    const rad = Math.max(6, (0.7 + lv * 0.6) * view.focal / o.z);
    const grad = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, rad);
    grad.addColorStop(0, PAL.accent);
    grad.addColorStop(1, 'transparent');
    g.save();
    g.globalAlpha = lv * 0.18;
    g.fillStyle = grad;
    g.beginPath();
    g.arc(o.x, o.y, rad, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawGroundLabel() {
    const p = project(0, 0, 0.62);
    textAt('你', p, `500 13px ${FONT_BODY}`, PAL.ink3, 0.9);
  }

  function drawListener() {
    const head = project(0, 0.98, 0);
    const bodyB = project(0, 0.04, 0);
    const bodyT = project(0, 0.80, 0);
    if (!head || !bodyB || !bodyT) return;
    const bw = 0.19 * bodyB.k;
    const tw = 0.25 * bodyT.k;
    const hr = 0.14 * head.k;

    g.save();
    g.globalAlpha = 0.92;
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.moveTo(bodyB.x - bw, bodyB.y);
    g.lineTo(bodyT.x - tw, bodyT.y);
    g.lineTo(bodyT.x + tw, bodyT.y);
    g.lineTo(bodyB.x + bw, bodyB.y);
    g.closePath();
    g.fill();

    g.beginPath();
    g.arc(head.x, head.y, hr, 0, TAU);
    g.fill();

    // 鼻尖朝前（-Z），一眼能看出听者面朝哪儿；用唯一的强调色点一下。
    const nose = project(0, 0.98, -0.16);
    if (nose) {
      g.fillStyle = PAL.accent;
      g.globalAlpha = 0.95;
      g.beginPath();
      g.moveTo(head.x - hr * 0.45, head.y);
      g.lineTo(nose.x, nose.y);
      g.lineTo(head.x + hr * 0.45, head.y);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** 听者：100k 面小猫。kitten3d.js 把猫渲染到离屏 WebGL canvas（透明底），
      这里按当前相机 blit 进 2D 舞台；没加载好 / 渲染失败时退回 drawListener()。
      深度排序仍然由 drawScene 的 items 决定，音响该盖就盖、该被盖就被盖。 */
  function drawKitten() {
    if (kitten) {
      try {
        g.save();
        g.globalAlpha = 1;   // 猫是贴图原色，不跟随其他图层的透明度
        const ok = kitten.draw(g, view);
        g.restore();
        if (ok) return;
      } catch (err) {
        try { g.restore(); } catch { /* noop */ }
        kitten = null;
        console.warn('[spatial] 3D 小猫渲染失败，退回 2D 听者：', err);
      }
    }
    drawListener();
  }

  /** 动态加载 3D 听者。只试一次：404 / 没 WebGL / 解析或贴图失败都静默退回 2D 小人 */
  function loadKitten() {
    if (kitten || kittenLoading || kittenFailed) return;
    kittenLoading = true;
    const moduleUrl = new URL('kitten3d.js', SCRIPT_URL).href;
    const glbUrl = new URL('kitten-100k.glb', SCRIPT_URL).href;
    import(moduleUrl)
      .then((mod) => mod.createKitten(glbUrl))
      .then((handle) => {
        kitten = handle;
        kittenLoading = false;
        if (state.open) drawScene();   // 立刻换掉 2D 小人，不用等下一帧
      })
      .catch((err) => {
        kittenLoading = false;
        kittenFailed = true;
        console.warn('[spatial] 3D 小猫不可用，继续用 2D 听者：', err);
      });
  }

  /** 音响脚下的投影 + 高度垂线，先画，再叠立体块 */
  function drawSpeakerGround(sp) {
    const w = worldPos(sp);
    const on = sp.id === state.selected;
    // 选中态用琥珀色描一圈，未选中是低透明度暖灰
    strokeRing(circlePoints(w.x, w.z, 0.25, 36),
      on ? PAL.accent : PAL.grid, on ? 0.62 : 0.22, on ? 2 : 1);

    if (w.y > 0.02) {
      const a = project(w.x, 0, w.z);
      const b = project(w.x, w.y, w.z);
      if (a && b) {
        g.save();
        g.globalAlpha = 0.28;
        g.strokeStyle = PAL.grid;
        g.lineWidth = 1;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
        g.restore();
      }
    }
  }

  function drawSpeakerBox(sp) {
    const w = worldPos(sp);
    const on = sp.id === state.selected;
    const len = Math.hypot(w.x, w.z) || 1;
    const nx = -w.x / len;           // 朝向听者（单位向量）
    const nz = -w.z / len;
    const tx = -nz;                  // 水平切向
    const tz = nx;

    const cy = w.y + BOX.HH;
    const { HW, HD, HH } = BOX;

    const vert = (sx, sy, sd) => ({
      x: w.x + tx * (sx * HW) + nx * (sd * HD),
      y: cy + sy * HH,
      z: w.z + tz * (sx * HW) + nz * (sd * HD),
    });
    const V = {};
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sd of [-1, 1]) V[`${sx},${sy},${sd}`] = vert(sx, sy, sd);
      }
    }

    // 六个面，每个面四个顶点按环序写，法线朝外
    const faces = [
      { n: { x: 0, y: 1, z: 0 }, v: ['-1,1,-1', '1,1,-1', '1,1,1', '-1,1,1'] },       // 顶
      { n: { x: 0, y: -1, z: 0 }, v: ['-1,-1,-1', '1,-1,-1', '1,-1,1', '-1,-1,1'] }, // 底
      { n: { x: tx, y: 0, z: tz }, v: ['1,-1,-1', '1,-1,1', '1,1,1', '1,1,-1'] },     // 切向 +
      { n: { x: -tx, y: 0, z: -tz }, v: ['-1,-1,-1', '-1,-1,1', '-1,1,1', '-1,1,-1'] },// 切向 -
      { n: { x: nx, y: 0, z: nz }, v: ['-1,-1,1', '1,-1,1', '1,1,1', '-1,1,1'] },      // 朝听者
      { n: { x: -nx, y: 0, z: -nz }, v: ['-1,-1,-1', '1,-1,-1', '1,1,-1', '-1,1,-1'] },// 背向听者
    ];

    const toCam = (p) => {
      const dx = view.cam.x - p.x;
      const dy = view.cam.y - p.y;
      const dz = view.cam.z - p.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      return { x: dx / l, y: dy / l, z: dz / l };
    };

    const visible = [];
    for (const f of faces) {
      const vs = f.v.map((k) => V[k]).filter(Boolean);
      if (vs.length < 3) continue;
      const c = { x: 0, y: 0, z: 0 };
      for (const p of vs) { c.x += p.x; c.y += p.y; c.z += p.z; }
      c.x /= vs.length; c.y /= vs.length; c.z /= vs.length;
      const dir = toCam(c);
      const facing = f.n.x * dir.x + f.n.y * dir.y + f.n.z * dir.z;
      if (facing <= 0) continue;
      const pp = vs.map((p) => project(p.x, p.y, p.z));
      if (pp.some((p) => !p)) continue;
      const depth = pp.reduce((s, p) => s + p.z, 0) / pp.length;
      visible.push({ pts: pp, facing, depth, top: f.n.y > 0.5 });
    }
    visible.sort((a, b) => b.depth - a.depth);   // 远的先画，近的盖上去

    g.save();
    for (const f of visible) {
      // 深色地面上：箱体用暖白薄填充；选中的整体染上琥珀，一眼能认出来
      g.globalAlpha = (f.top ? 0.10 + f.facing * 0.05 : 0.07 + f.facing * 0.13)
        + (on ? 0.08 : 0);
      g.fillStyle = on ? PAL.accent : PAL.ink;
      g.beginPath();
      g.moveTo(f.pts[0].x, f.pts[0].y);
      for (let i = 1; i < f.pts.length; i++) g.lineTo(f.pts[i].x, f.pts[i].y);
      g.closePath();
      g.fill();
      g.globalAlpha = on ? 0.95 : 0.42;
      g.strokeStyle = on ? PAL.accent : PAL.grid;
      g.lineWidth = on ? 2 : 1.2;
      g.stroke();
    }
    g.restore();

    // 顶面朝向箭头：指向听者，让「音响朝哪儿」一眼可见
    const topY = cy + HH;
    const tip = project(w.x + nx * 0.30, topY, w.z + nz * 0.30);
    const b1 = project(w.x - nx * 0.13 + tx * 0.09, topY, w.z - nz * 0.13 + tz * 0.09);
    const b2 = project(w.x - nx * 0.13 - tx * 0.09, topY, w.z - nz * 0.13 - tz * 0.09);
    if (tip && b1 && b2) {
      g.save();
      g.globalAlpha = on ? 0.95 : 0.55;
      g.fillStyle = on ? PAL.accent : PAL.ink2;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(b1.x, b1.y);
      g.lineTo(b2.x, b2.y);
      g.closePath();
      g.fill();
      g.restore();
    }

    // 选中的音响再加一点朝听者的辐射束，别的时候保持干净
    if (on) {
      const fc = { x: w.x + nx * HD, y: cy, z: w.z + nz * HD };
      g.save();
      g.globalAlpha = 0.3;
      g.strokeStyle = PAL.accent;
      g.lineWidth = 1.2;
      for (const off of [-0.16, 0, 0.16]) {
        const a = project(fc.x + nx * 0.62 + tx * off, fc.y, fc.z + nz * 0.62 + tz * off);
        const b = project(fc.x, fc.y, fc.z);
        if (!a || !b) continue;
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(a.x, a.y);
        g.stroke();
      }
      g.restore();
    }
  }

  /* ------------------------------------------------------------------ *
   * 选中音响的 XYZ 坐标轴（画在音响之后、罗盘之前）
   * ------------------------------------------------------------------ */
  const AXIS_DEFS = [
    { key: 'x', label: 'X', color: '#d98a82', dx: 1, dy: 0, dz: 0 },
    { key: 'y', label: 'Y', color: '#8fbf8a', dx: 0, dy: 1, dz: 0 },
    { key: 'z', label: 'Z', color: '#89a7dd', dx: 0, dy: 0, dz: 1 },
  ];

  /** 当前选中音响的三根轴：世界长度按屏幕长度至少 34px 放大，拖拽用同一个长度 */
  function axisGeometry() {
    if (!view.f) return null;
    const sp = findSpeaker(state.selected);
    if (!sp) return null;
    const w = worldPos(sp);
    const o = project(w.x, w.y, w.z);
    if (!o) return null;

    const axes = [];
    for (const def of AXIS_DEFS) {
      const p1 = project(w.x + def.dx * AXIS_WORLD, w.y + def.dy * AXIS_WORLD, w.z + def.dz * AXIS_WORLD);
      if (!p1) continue;
      let dx = p1.x - o.x;
      let dy = p1.y - o.y;
      let len = Math.hypot(dx, dy);
      // 轴几乎正对相机时投影退化成一个点，放大倍率会失控，直接不画
      if (len < 2) continue;
      let worldLen = AXIS_WORLD;
      if (len < AXIS_MIN_PX) {
        worldLen = AXIS_WORLD * (AXIS_MIN_PX / len);
        const p2 = project(w.x + def.dx * worldLen, w.y + def.dy * worldLen, w.z + def.dz * worldLen);
        if (!p2) continue;
        dx = p2.x - o.x;
        dy = p2.y - o.y;
        len = Math.hypot(dx, dy);
        if (len < 1e-3) continue;
      }
      axes.push({
        key: def.key, label: def.label, color: def.color,
        ox: o.x, oy: o.y, tx: o.x + dx, ty: o.y + dy,
        dx, dy, len, worldLen,
      });
    }
    return { origin: o, axes };
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    if (l2 < 1e-6) return Math.hypot(px - ax, py - ay);
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  }

  /** 命中测试：轴端 12px 优先，其次整条轴线段 9px。返回轴几何对象 */
  function axisHitTest(clientX, clientY) {
    const geo = axisGeometry();
    if (!geo || !els) return null;
    const rect = els.stage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestD = Infinity;
    for (const a of geo.axes) {
      const dTip = Math.hypot(x - a.tx, y - a.ty);
      if (dTip <= AXIS_HIT_TIP && dTip < bestD) { best = a; bestD = dTip; continue; }
      const dSeg = distToSegment(x, y, a.ox, a.oy, a.tx, a.ty);
      if (dSeg <= AXIS_HIT_SEG && dSeg < bestD) { best = a; bestD = dSeg; }
    }
    return best;
  }

  function drawAxes() {
    const geo = axisGeometry();
    if (!geo) return;
    for (const a of geo.axes) {
      const hot = axisHover === a.key || (axisDrag && axisDrag.axis === a.key);
      const ux = a.dx / a.len;
      const uy = a.dy / a.len;
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = a.color;
      g.fillStyle = a.color;
      g.globalAlpha = hot ? 1 : 0.86;
      g.lineWidth = hot ? 2.8 : 1.9;
      g.shadowColor = 'rgba(0, 0, 0, 0.55)';
      g.shadowBlur = 3;

      g.beginPath();
      g.moveTo(a.ox, a.oy);
      g.lineTo(a.tx, a.ty);
      g.stroke();

      // 箭头
      const ah = 9;
      const aw = 4.5;
      g.beginPath();
      g.moveTo(a.tx, a.ty);
      g.lineTo(a.tx - ux * ah - uy * aw, a.ty - uy * ah + ux * aw);
      g.lineTo(a.tx - ux * ah + uy * aw, a.ty - uy * ah - ux * aw);
      g.closePath();
      g.fill();

      // 可拖拽圆点
      g.globalAlpha = 0.94;
      g.beginPath();
      g.arc(a.tx, a.ty, hot ? 7 : 6, 0, TAU);
      g.fillStyle = '#0f1216';
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.strokeStyle = a.color;
      g.stroke();

      // 轴端字母
      g.shadowBlur = 5;
      g.font = `700 13px ${FONT_MONO}`;
      g.fillStyle = a.color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(a.label, a.tx + ux * 16, a.ty + uy * 16);
      g.restore();
    }
  }

  function drawScene() {
    if (!g || !cvs || !view.w) return;
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, view.w, view.h);
    updateViewSpace(view.w, view.h);

    drawGround();
    drawWaves();
    drawListenerHalo();
    drawGroundLabel();

    // 听者和音响按深度排序：近的盖住远的
    const items = [];
    const lp = project(0, 0.9, 0);
    items.push({ kind: 'you', depth: lp ? lp.z : 1e6 });
    for (const sp of state.speakers) {
      const w = worldPos(sp);
      const p = project(w.x, w.y + BOX.HH, w.z);
      items.push({ kind: 'spk', sp, depth: p ? p.z : 1e6 });
    }
    items.sort((a, b) => b.depth - a.depth);

    for (const it of items) {
      if (it.kind === 'you') drawKitten();
      else {
        drawSpeakerGround(it.sp);
        drawSpeakerBox(it.sp);
      }
    }

    drawAxes();          // 坐标轴画在所有音响之后、罗盘之前，保证在最上层
    drawCompass();
    placeSpeakerNodes();
    updateCamReadout();
  }

  /** 把 HTML 音响按钮放到投影后的位置上；画布负责块体，按钮负责点选 / 键盘 */
  function placeSpeakerNodes() {
    if (!view.w || !view.h) return;
    for (const sp of state.speakers) {
      const node = nodeEls.get(sp.id);
      if (!node) continue;
      const w = worldPos(sp);
      const p = project(w.x, w.y + BOX.HH, w.z);
      if (!p) {
        node.hidden = true;
        continue;
      }
      node.hidden = false;
      node.style.left = `${(p.x / view.w) * 100}%`;
      node.style.top = `${(p.y / view.h) * 100}%`;
      node.style.zIndex = String(1000 - Math.round(p.z * 20));
    }
  }

  function updateCamReadout() {
    if (!els || !els.camV) return;
    const text = `俯角 ${Math.round(CAM.pitch / DEG)}° · ${Math.round(CAM.zoom * 100)}%`;
    if (text === anim.camText) return;
    anim.camText = text;
    els.camV.textContent = text;
  }

  /* ------------------------------------------------------------------ *
   * 电平 / 声波
   * ------------------------------------------------------------------ */
  function readRms() {
    if (!analyser || !analyserBuf) return 0;
    try { analyser.getByteTimeDomainData(analyserBuf); }
    catch { return 0; }
    let sum = 0;
    for (let i = 0; i < analyserBuf.length; i++) {
      const v = (analyserBuf[i] - 128) / 128;
      sum += v * v;
    }
    return clamp(Math.sqrt(sum / analyserBuf.length) * 3.4, 0, 1);
  }

  function stepLevel() {
    const target = state.playing ? readRms() : 0;
    level += (target - level) * (target > level ? 0.35 : 0.12);
    if (level < 0.002) level = 0;
  }

  function stepWaves(dt) {
    if (state.playing && !REDUCED) {
      waveAcc += dt;
      if (waveAcc >= 0.6) {
        waveAcc = 0;
        // 每个音响各发一圈，强度跟它自己的增益走；音量为 0 的音响不发波
        for (const sp of state.speakers) {
          const strength = clamp(speakerTarget(sp) * 1.6, 0, 1);
          if (strength < 0.04) continue;
          const w = worldPos(sp);
          waves.push({ x: w.x, z: w.z, age: 0, ttl: 1.9, strength });
        }
        if (waves.length > 64) waves.splice(0, waves.length - 64);
      }
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      waves[i].age += dt;
      if (waves[i].age >= waves[i].ttl) waves.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   * 相机动画 / rAF
   * ------------------------------------------------------------------ */
  function stepCamera(dt) {
    if (REDUCED) {
      CAM.yaw = CAM_T.yaw;
      CAM.pitch = CAM_T.pitch;
      CAM.zoom = CAM_T.zoom;
      return;
    }
    // 松手后的惯性：速度指数衰减，继续把目标角往前推
    if (!orbit && (Math.abs(camVel.yaw) > 0.002 || Math.abs(camVel.pitch) > 0.002)) {
      CAM_T.yaw += camVel.yaw * dt;
      CAM_T.pitch = clamp(CAM_T.pitch + camVel.pitch * dt, PITCH_MIN, PITCH_MAX);
      const decay = Math.pow(0.06, dt);
      camVel.yaw *= decay;
      camVel.pitch *= decay;
    }
    // 帧率无关的缓动：每帧追上一部分目标
    const k = 1 - Math.pow(0.0009, dt);
    CAM.yaw += (CAM_T.yaw - CAM.yaw) * k;
    CAM.pitch += (CAM_T.pitch - CAM.pitch) * k;
    CAM.zoom += (CAM_T.zoom - CAM.zoom) * k;
  }

  function frame(ts) {
    if (!anim.on) return;
    const dt = clamp((ts - anim.last) / 1000, 0, 0.06);
    anim.last = ts;
    stepCamera(dt);
    stepWaves(dt);
    stepLevel();
    stepKeyframes(dt);
    drawScene();

    if (els && els.level) {
      const v = Math.round(level * 1000) / 1000;
      if (v !== anim.level) {
        anim.level = v;
        els.level.style.transform = `scaleX(${v})`;
      }
    }
    // 正在播放卡片的细进度条：只改 transform，不触发布局
    if (els && els.nowProgress) {
      const p = activeBuffer && activeBuffer.duration > 0
        ? Math.round(clamp(currentOffset() / activeBuffer.duration, 0, 1) * 1000) / 1000
        : 0;
      if (p !== anim.progress) {
        anim.progress = p;
        els.nowProgress.style.transform = `scaleX(${p})`;
      }
    }
    anim.raf = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (anim.on) return;
    if (!state.open) return;
    anim.on = true;
    anim.last = performance.now();
    anim.raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    anim.on = false;
    if (anim.raf) cancelAnimationFrame(anim.raf);
    anim.raf = 0;
  }

  function resetCamera() {
    CAM_T.yaw = 0;
    CAM_T.pitch = PITCH_DEF;
    CAM_T.zoom = 1;
    camVel.yaw = 0;
    camVel.pitch = 0;
    if (REDUCED) {
      CAM.yaw = 0; CAM.pitch = PITCH_DEF; CAM.zoom = 1;
    }
  }

  /* ------------------------------------------------------------------ *
   * UI 构建
   * ------------------------------------------------------------------ */
  function build() {
    root = document.createElement('div');
    root.className = 'spz';
    root.id = 'lizi-spatial';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'spz-title');
    root.innerHTML = `
      <div class="spz__sheet">
        <header class="spz__head">
          <h2 class="spz__title" id="spz-title">360° 空间音频</h2>
          <div class="spz__head-actions">
            <button class="spz__icon-btn" id="spz-help-btn" type="button"
              aria-label="使用提示" aria-expanded="false" aria-controls="spz-help">?</button>
            <button class="spz__icon-btn spz__x" id="spz-x" type="button" aria-label="关闭空间音频">${CLOSE_SVG}</button>
          </div>
          <ul class="spz__help" id="spz-help" hidden>
            <li>拖动音响改方位</li>
            <li>拖动空白处转视角，滚轮缩放</li>
            <li>方向键微调，PageUp / PageDown 调高度</li>
            <li>戴耳机听前后</li>
          </ul>
        </header>

        <div class="spz__body">
          <div class="spz__stage-wrap">
            <div class="spz__stage" id="spz-stage">
              <canvas class="spz__canvas" id="spz-canvas" aria-hidden="true"></canvas>
              <div class="spz__spks" id="spz-spks"></div>
              <div class="spz__phones">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                  stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                  <path d="M4.5 13.5V12a7.5 7.5 0 0 1 15 0v1.5"/>
                  <rect x="3" y="13" width="4" height="6" rx="1.6"/>
                  <rect x="17" y="13" width="4" height="6" rx="1.6"/>
                </svg>
                <span>戴耳机听前后</span>
              </div>
              <div class="spz__cam">
                <span class="spz__cam-v" id="spz-cam-v" aria-hidden="true"></span>
                <button class="spz__cam-r" id="spz-reset" type="button">复位视角</button>
              </div>
            </div>
          </div>

          <aside class="spz__side">
            <section class="spz__sec">
              <button class="spz__sec-h" id="spz-sec-preset-h" type="button"
                aria-expanded="false" aria-controls="spz-sec-preset-body">
                <span class="spz__sec-t">预设</span>
                <span class="spz__small" id="spz-preset-hint"></span>
                <span class="spz__chev" aria-hidden="true"></span>
              </button>
              <div class="spz__sec-body" id="spz-sec-preset-body" hidden>
                <select class="spz__sel" id="spz-preset" aria-label="空间音频预设"></select>
                <div class="spz__preset-actions">
                  <button class="spz__pbtn" id="spz-preset-save" type="button">保存当前</button>
                  <button class="spz__pbtn" id="spz-preset-del" type="button" disabled>删除</button>
                  <button class="spz__pbtn" id="spz-preset-global" type="button"
                    aria-pressed="false" title="标记为全局默认：每次打开空间音频自动套用">设为全局</button>
                </div>
                <button class="spz__kf-entry" id="spz-kf-open" type="button"
                  aria-haspopup="dialog" aria-expanded="false">关键帧动画…</button>
                <form class="spz__preset-form" id="spz-preset-form" hidden>
                  <input class="spz__preset-name" id="spz-preset-name" type="text" maxlength="24"
                    placeholder="预设名称" aria-label="新预设名称" autocomplete="off">
                  <button class="spz__pbtn spz__pbtn--ok" type="submit">保存</button>
                  <button class="spz__pbtn" id="spz-preset-cancel" type="button">取消</button>
                </form>
              </div>
            </section>

            <section class="spz__sec">
              <button class="spz__sec-h" id="spz-sec-source-h" type="button"
                aria-expanded="true" aria-controls="spz-sec-source-body">
                <span class="spz__sec-t">音源</span>
                <span class="spz__small" id="spz-src-hint"></span>
                <span class="spz__chev" aria-hidden="true"></span>
              </button>
              <div class="spz__sec-body" id="spz-sec-source-body">
                <div class="spz__now" id="spz-now">
                  <div class="spz__now-art" id="spz-now-art" aria-hidden="true"></div>
                  <div class="spz__now-meta">
                    <p class="spz__now-name" id="spz-now-name">播放器里没有歌</p>
                    <p class="spz__now-sub" id="spz-now-sub"></p>
                    <span class="spz__now-state" id="spz-now-state">播放器里没有歌</span>
                  </div>
                  <div class="spz__now-bar" aria-hidden="true"><i id="spz-now-progress"></i></div>
                </div>
                <div class="spz__transport">
                  <button class="spz__btn--play" id="spz-play" type="button" aria-pressed="false">
                    <svg class="spz__i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5.2v13.6L19 12z"/>
                    </svg>
                    <svg class="spz__i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="7" y="5" width="3.6" height="14" rx="1"/>
                      <rect x="13.4" y="5" width="3.6" height="14" rx="1"/>
                    </svg>
                    <span class="spz__sr" id="spz-play-txt">播放</span>
                  </button>
                  <label class="spz__master">
                    <span class="spz__master-h"><span>总音量</span><span class="spz__master-v" id="spz-master-v">80%</span></span>
                    <input class="spz__range" id="spz-master" type="range" min="0" max="100" step="1" value="80" aria-label="总音量">
                  </label>
                </div>
                <div class="spz__meter" aria-hidden="true"><i id="spz-level"></i></div>
                <p class="spz__msg" id="spz-msg" role="status"></p>
              </div>
            </section>

            <section class="spz__sec">
              <button class="spz__sec-h" id="spz-sec-spk-h" type="button"
                aria-expanded="true" aria-controls="spz-sec-spk-body">
                <span class="spz__sec-t">音响</span>
                <span class="spz__count" id="spz-count"></span>
                <span class="spz__chev" aria-hidden="true"></span>
              </button>
              <div class="spz__sec-body" id="spz-sec-spk-body">
                <ul class="spz__list" id="spz-list"></ul>
                <button class="spz__add" id="spz-add" type="button">
                  <span class="spz__add-i" aria-hidden="true">+</span>加音响
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>

      <div class="spz__kf" id="spz-kf" hidden>
        <div class="spz__kf-card" role="dialog" aria-modal="true" aria-labelledby="spz-kf-title">
          <header class="spz__kf-head">
            <h3 id="spz-kf-title">关键帧动画</h3>
            <button class="spz__icon-btn spz__x" id="spz-kf-close" type="button"
              aria-label="关闭关键帧面板">${CLOSE_SVG}</button>
          </header>

          <div class="spz__kf-row">
            <label class="spz__kf-dur-lb" for="spz-kf-dur">时长</label>
            <input class="spz__kf-dur" id="spz-kf-dur" type="number" inputmode="numeric"
              min="${KF_DUR_MIN}" max="${KF_DUR_MAX}" step="1" value="${KF_DUR_DEF}"
              aria-label="关键帧时长（秒）">
            <span>秒</span>
            <span class="spz__kf-note">独立时间轴 · 不跟音源同步</span>
          </div>

          <div class="spz__kf-tl">
            <div class="spz__kf-ruler" id="spz-kf-ruler">
              <div class="spz__kf-track" id="spz-kf-track">
                <span class="spz__kf-keys" id="spz-kf-keys"></span>
                <span class="spz__kf-playhead" id="spz-kf-head"></span>
              </div>
            </div>
            <div class="spz__kf-scale"><span>0 s</span><span id="spz-kf-dur-lb">${KF_DUR_DEF} s</span></div>
          </div>

          <div class="spz__kf-transport">
            <button class="spz__pbtn spz__kf-play" id="spz-kf-play" type="button" aria-pressed="false">播放</button>
            <label class="spz__kf-loop"><input id="spz-kf-loop" type="checkbox" checked> 循环</label>
            <span class="spz__kf-time" id="spz-kf-time">0.00 s</span>
          </div>

          <div class="spz__kf-actions">
            <button class="spz__pbtn spz__pbtn--ok" id="spz-kf-record" type="button">记录当前布局</button>
            <button class="spz__pbtn" id="spz-kf-del" type="button" disabled>删除选中</button>
            <button class="spz__pbtn" id="spz-kf-clear" type="button" disabled>清空</button>
          </div>

          <p class="spz__kf-hint" id="spz-kf-hint">至少记录两个关键帧才能播放</p>
        </div>
      </div>`;

    document.body.appendChild(root);

    cvs = root.querySelector('#spz-canvas');
    g = cvs.getContext('2d');

    els = {
      stage: root.querySelector('#spz-stage'),
      spks: root.querySelector('#spz-spks'),
      list: root.querySelector('#spz-list'),
      preset: root.querySelector('#spz-preset'),
      presetHint: root.querySelector('#spz-preset-hint'),
      presetSave: root.querySelector('#spz-preset-save'),
      presetDel: root.querySelector('#spz-preset-del'),
      presetGlobal: root.querySelector('#spz-preset-global'),
      presetForm: root.querySelector('#spz-preset-form'),
      presetName: root.querySelector('#spz-preset-name'),
      presetCancel: root.querySelector('#spz-preset-cancel'),
      srcHint: root.querySelector('#spz-src-hint'),
      now: root.querySelector('#spz-now'),
      nowArt: root.querySelector('#spz-now-art'),
      nowName: root.querySelector('#spz-now-name'),
      nowSub: root.querySelector('#spz-now-sub'),
      nowState: root.querySelector('#spz-now-state'),
      nowProgress: root.querySelector('#spz-now-progress'),
      play: root.querySelector('#spz-play'),
      playTxt: root.querySelector('#spz-play-txt'),
      secSourceBtn: root.querySelector('#spz-sec-source-h'),
      master: root.querySelector('#spz-master'),
      masterV: root.querySelector('#spz-master-v'),
      msg: root.querySelector('#spz-msg'),
      add: root.querySelector('#spz-add'),
      count: root.querySelector('#spz-count'),
      level: root.querySelector('#spz-level'),
      camV: root.querySelector('#spz-cam-v'),
      reset: root.querySelector('#spz-reset'),
      helpBtn: root.querySelector('#spz-help-btn'),
      help: root.querySelector('#spz-help'),
      kfOpen: root.querySelector('#spz-kf-open'),
      kfPanel: root.querySelector('#spz-kf'),
      kfClose: root.querySelector('#spz-kf-close'),
      kfDur: root.querySelector('#spz-kf-dur'),
      kfDurLb: root.querySelector('#spz-kf-dur-lb'),
      kfRuler: root.querySelector('#spz-kf-ruler'),
      kfTrack: root.querySelector('#spz-kf-track'),
      kfKeys: root.querySelector('#spz-kf-keys'),
      kfHead: root.querySelector('#spz-kf-head'),
      kfTime: root.querySelector('#spz-kf-time'),
      kfPlay: root.querySelector('#spz-kf-play'),
      kfLoop: root.querySelector('#spz-kf-loop'),
      kfRecord: root.querySelector('#spz-kf-record'),
      kfDel: root.querySelector('#spz-kf-del'),
      kfClear: root.querySelector('#spz-kf-clear'),
      kfHint: root.querySelector('#spz-kf-hint'),
    };

    // 三个 section 都是抽屉：标题行就是按钮；状态只放内存，不持久化
    const secDefs = [
      { key: 'preset', btn: root.querySelector('#spz-sec-preset-h'), body: root.querySelector('#spz-sec-preset-body') },
      { key: 'source', btn: root.querySelector('#spz-sec-source-h'), body: root.querySelector('#spz-sec-source-body') },
      { key: 'speakers', btn: root.querySelector('#spz-sec-spk-h'), body: root.querySelector('#spz-sec-spk-body') },
    ];
    const applySecState = (d) => {
      const on = !!secOpen[d.key];
      d.btn.setAttribute('aria-expanded', String(on));
      d.body.hidden = !on;
    };
    for (const d of secDefs) {
      applySecState(d);
      d.btn.addEventListener('click', () => {
        secOpen[d.key] = !secOpen[d.key];
        applySecState(d);
      });
    }

    root.querySelector('#spz-x').addEventListener('click', close);
    els.helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setHelp(els.help.hidden);
    });
    root.addEventListener('click', (e) => {
      if (e.target === root) { close(); return; }
      if (!els.help.hidden && !els.help.contains(e.target) && !els.helpBtn.contains(e.target)) {
        setHelp(false);
      }
    });
    els.play.addEventListener('click', togglePlay);
    els.add.addEventListener('click', addSpeaker);
    els.master.addEventListener('input', () => {
      const v = Number(els.master.value);
      state.master = v / 100;
      if (els.masterV) els.masterV.textContent = `${v}%`;
      if (masterGain && ctx) {
        try { masterGain.gain.setTargetAtTime(state.master, ctx.currentTime, 0.03); } catch { /* noop */ }
      }
      markPresetDirty();
    });

    els.preset.addEventListener('change', () => {
      const name = els.preset.value;
      if (name === '__current') { updatePresetButtons(); return; }
      applyPreset(name);
    });
    els.presetSave.addEventListener('click', showPresetForm);
    els.presetDel.addEventListener('click', () => {
      if (!state.preset) return;
      const name = state.preset;
      if (deletePreset(name)) setMsg(`已删除自定义预设「${name}」`);
    });
    els.presetGlobal.addEventListener('click', toggleGlobalPreset);
    els.presetForm.addEventListener('submit', (e) => {
      e.preventDefault();
      commitPresetForm();
    });
    els.presetCancel.addEventListener('click', hidePresetForm);

    els.list.addEventListener('click', (e) => {
      const li = e.target.closest('.spz__item');
      if (!li) return;
      const id = Number(li.dataset.id);
      if (e.target.closest('.spz__del')) {
        removeSpeaker(id);
        return;
      }
      if (e.target.closest('.spz__item-top')) {
        // 点卡片头（名称 / 圆点 / chevron）：没选中 → 选中并展开；已选中 → 收起 / 再展开
        if (state.selected !== id) selectSpeaker(id);
        else setItemOpen(li, !li.classList.contains('is-open'));
      }
    });

    // 调哪只音响的滑杆 / 坐标，就选中哪只，舞台高亮跟着走
    els.list.addEventListener('focusin', (e) => {
      const li = e.target.closest('.spz__item');
      if (!li) return;
      if (e.target.matches('.spz__xyz-in, .spz__vol, .spz__hgt')) {
        selectSpeaker(Number(li.dataset.id));
      }
    });

    // 列表：音量 / 高度滑杆即时生效；XYZ 在 change 时反算回极坐标真源
    els.list.addEventListener('input', (e) => {
      const li = e.target.closest('.spz__item');
      if (!li) return;
      const sp = findSpeaker(Number(li.dataset.id));
      if (!sp) return;
      const t = e.target;

      if (t.classList.contains('spz__vol')) {
        sp.vol = Number(t.value) / 100;
        updateGain(sp);
        const out = li.querySelector('[data-out="vol"]');
        if (out) out.textContent = `${Math.round(sp.vol * 100)}%`;
        markPresetDirty();
        return;
      }
      if (t.classList.contains('spz__hgt')) {
        setHeight(sp, Number(t.value));
        markPresetDirty();
        syncSpeaker(sp.id);
      }
    });

    els.list.addEventListener('change', (e) => {
      if (!e.target.classList.contains('spz__xyz-in')) return;
      const li = e.target.closest('.spz__item');
      if (!li) return;
      const sp = findSpeaker(Number(li.dataset.id));
      if (!sp) return;
      const read = (axis) => {
        const inp = li.querySelector(`.spz__xyz-in[data-axis="${axis}"]`);
        return inp ? Number(inp.value) : 0;
      };
      setFromXyz(sp, read('x'), read('y'), read('z'));
      markPresetDirty();
      syncSpeaker(sp.id);
    });

    // 舞台：空白处拖动 = 转视角
    els.stage.addEventListener('pointerdown', onStageDown);
    els.stage.addEventListener('pointermove', onStageMove);
    els.stage.addEventListener('pointerup', onStageUp);
    els.stage.addEventListener('pointercancel', onStageUp);
    els.stage.addEventListener('wheel', onWheel, { passive: false });
    els.stage.addEventListener('pointerleave', () => {
      if (!axisDrag) {
        axisHover = null;
        els.stage.classList.remove('is-axis-hover');
      }
    });
    els.stage.addEventListener('dblclick', (e) => {
      if (e.target.closest('.spz__spk, .spz__cam')) return;
      if (axisHitTest(e.clientX, e.clientY)) return;   // 双击轴不重置视角
      resetCamera();
    });
    els.reset.addEventListener('pointerdown', (e) => e.stopPropagation());
    els.reset.addEventListener('click', resetCamera);

    // 关键帧面板（v1）：独立时间轴，不跟音源同步
    els.kfOpen.addEventListener('click', openKfPanel);
    els.kfClose.addEventListener('click', closeKfPanel);
    els.kfPanel.addEventListener('click', (e) => {
      if (e.target === els.kfPanel) closeKfPanel();   // 点遮罩关闭
    });
    els.kfDur.addEventListener('change', onKfDurationChange);
    els.kfPlay.addEventListener('click', toggleKfPlay);
    els.kfLoop.addEventListener('change', () => {
      state.kf.loop = !!els.kfLoop.checked;
      markPresetDirty();
    });
    els.kfRecord.addEventListener('click', recordKeyframe);
    els.kfDel.addEventListener('click', deleteSelectedKeyframe);
    els.kfClear.addEventListener('click', clearKeyframes);
    els.kfRuler.addEventListener('pointerdown', onKfScrubDown);
    els.kfRuler.addEventListener('pointermove', onKfScrubMove);
    els.kfRuler.addEventListener('pointerup', onKfScrubUp);
    els.kfRuler.addEventListener('pointercancel', onKfScrubUp);

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(els.stage);
    }

    built = true;

    // 3D 听者只加载一次；失败会自己 warn 并保持 2D 小人，不阻塞浮层
    loadKitten();
  }

  function createSpeakerNode(sp) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spz__spk';
    btn.dataset.id = String(sp.id);
    btn.innerHTML = `
      <span class="spz__spk-lb" aria-hidden="true"><b></b><i></i></span>`;

    btn.addEventListener('pointerdown', (e) => beginDrag(e, sp.id));
    btn.addEventListener('pointermove', onDragMove);
    btn.addEventListener('pointerup', endDrag);
    btn.addEventListener('pointercancel', endDrag);
    btn.addEventListener('keydown', (e) => onNodeKey(e, sp.id));
    btn.addEventListener('click', (e) => {
      // 键盘 Enter/Space 触发 click（detail=0）时选中；鼠标拖动已在 pointerdown 选中
      if (e.detail === 0) selectSpeaker(sp.id);
    });

    return btn;
  }

  function ensureStageNodes() {
    const ids = new Set(state.speakers.map((s) => s.id));
    for (const [id, node] of Array.from(nodeEls.entries())) {
      if (!ids.has(id)) {
        node.remove();
        nodeEls.delete(id);
      }
    }
    for (const sp of state.speakers) {
      let node = nodeEls.get(sp.id);
      if (!node) {
        node = createSpeakerNode(sp);
        nodeEls.set(sp.id, node);
        els.spks.appendChild(node);
      }
    }
  }

  function updateSpeakerNode(node, sp, index) {
    const label = placementText(sp);
    const b = node.querySelector('.spz__spk-lb b');
    const i = node.querySelector('.spz__spk-lb i');
    if (b) b.textContent = `音响 ${index + 1}`;
    if (i) i.textContent = shortPlacement(sp);

    const on = sp.id === state.selected;
    node.classList.toggle('is-on', on);
    node.setAttribute('aria-pressed', String(on));
    node.setAttribute('aria-label',
      `音响 ${index + 1}：${label}。左右方向键调角度，上下方向键调远近，PageUp / PageDown 调高度。`);
  }

  function updateSpeakerDomAll() {
    state.speakers.forEach((sp, i) => {
      const node = nodeEls.get(sp.id);
      if (node) updateSpeakerNode(node, sp, i);
      const li = els.list.querySelector(`.spz__item[data-id="${sp.id}"]`);
      if (li) updateListItem(li, sp, i);
    });
  }

  function updateListItem(li, sp, index) {
    const n = li.querySelector('.spz__item-n');
    const d = li.querySelector('.spz__item-d');
    const vol = li.querySelector('.spz__vol');
    const ov = li.querySelector('[data-out="vol"]');
    const hgt = li.querySelector('.spz__hgt');
    const oh = li.querySelector('[data-out="hgt"]');
    const h = heightOf(sp);
    if (n) n.textContent = `音响 ${index + 1}`;
    if (d) d.textContent = shortPlacement(sp);
    if (vol) vol.value = String(Math.round(sp.vol * 100));
    if (ov) ov.textContent = `${Math.round(sp.vol * 100)}%`;
    if (hgt) {
      hgt.max = heightMax(sp).toFixed(2);
      hgt.value = h.toFixed(2);
    }
    if (oh) oh.textContent = `${h.toFixed(2)} m`;

    // XYZ 只是派生视图：极坐标（angle / distance / elevation）始终是真源
    const w = worldPos(sp);
    li.querySelectorAll('.spz__xyz-in').forEach((inp) => {
      const axis = inp.dataset.axis;
      if (axis === 'x' || axis === 'y' || axis === 'z') inp.value = fmtCoord(w[axis]);
    });
  }

  function speakerItemHtml(sp, i) {
    const h = heightOf(sp);
    const w = worldPos(sp);
    const open = sp.id === state.selected;   // 默认只展开当前选中的那只
    return `
      <li class="spz__item${open ? ' is-open' : ''}" data-id="${sp.id}">
        <div class="spz__item-top">
          <span class="spz__dot" aria-hidden="true"></span>
          <button class="spz__item-main" type="button" aria-expanded="${open}"
            aria-controls="spz-item-body-${sp.id}">
            <span class="spz__item-n">音响 ${i + 1}</span>
            <span class="spz__item-d">${shortPlacement(sp)}</span>
          </button>
          <span class="spz__item-chev" aria-hidden="true"></span>
          <button class="spz__del" type="button" aria-label="删除音响 ${i + 1}"${state.speakers.length <= 1 ? ' disabled' : ''}>×</button>
        </div>
        <div class="spz__item-body" id="spz-item-body-${sp.id}"${open ? '' : ' hidden'}>
          <label class="spz__vol-row">
            <span class="spz__vol-k">音量</span>
            <input class="spz__vol spz__range spz__range--vol" type="range" min="0" max="100" step="1"
              value="${Math.round(sp.vol * 100)}" aria-label="音响 ${i + 1} 音量">
            <span class="spz__val" data-out="vol">${Math.round(sp.vol * 100)}%</span>
          </label>
          <label class="spz__vol-row">
            <span class="spz__vol-k">高度</span>
            <input class="spz__hgt spz__range spz__range--vol" type="range" min="0" max="${heightMax(sp).toFixed(2)}"
              step="${HEIGHT_STEP}" value="${h.toFixed(2)}" aria-label="音响 ${i + 1} 高度（米）"
              title="0 = 地面；最高不超过当前距离">
            <span class="spz__val" data-out="hgt">${h.toFixed(2)} m</span>
          </label>
          <div class="spz__xyz" role="group" aria-label="音响 ${i + 1} 坐标（米）"
            title="XYZ 坐标（米，步进 0.05）">
            <label class="spz__xyz-f"><span>X</span>
              <input class="spz__xyz-in" data-axis="x" type="number" inputmode="decimal" step="${HEIGHT_STEP}"
                min="${-MAX_DIST}" max="${MAX_DIST}" value="${fmtCoord(w.x)}" aria-label="音响 ${i + 1} X 坐标（米）">
            </label>
            <label class="spz__xyz-f"><span>Y</span>
              <input class="spz__xyz-in" data-axis="y" type="number" inputmode="decimal" step="${HEIGHT_STEP}"
                min="${MIN_HEIGHT}" max="${MAX_HEIGHT}" value="${fmtCoord(w.y)}" aria-label="音响 ${i + 1} Y 坐标（米，高度）">
            </label>
            <label class="spz__xyz-f"><span>Z</span>
              <input class="spz__xyz-in" data-axis="z" type="number" inputmode="decimal" step="${HEIGHT_STEP}"
                min="${-MAX_DIST}" max="${MAX_DIST}" value="${fmtCoord(w.z)}" aria-label="音响 ${i + 1} Z 坐标（米）">
            </label>
          </div>
        </div>
      </li>`;
  }

  function rebuildList() {
    els.list.innerHTML = state.speakers.map(speakerItemHtml).join('');
    updateSelection();
  }

  /** 单张音响卡片的折叠：卡片头常显，音量 / 高度 / XYZ 收进 body */
  function setItemOpen(li, on) {
    if (!li) return;
    li.classList.toggle('is-open', !!on);
    const body = li.querySelector('.spz__item-body');
    if (body) body.hidden = !on;
    const main = li.querySelector('.spz__item-main');
    if (main) main.setAttribute('aria-expanded', String(!!on));
  }

  /** 只展开当前选中的那只；手动收起后不会被 updateSelection 强行拉开 */
  function syncListItemOpen() {
    if (!els || !els.list) return;
    els.list.querySelectorAll('.spz__item').forEach((li) => {
      setItemOpen(li, Number(li.dataset.id) === state.selected);
    });
  }

  function updateSelection() {
    nodeEls.forEach((node, id) => {
      const on = id === state.selected;
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-pressed', String(on));
    });
    els.list.querySelectorAll('.spz__item').forEach((li) => {
      li.classList.toggle('is-on', Number(li.dataset.id) === state.selected);
    });
  }

  function updateCount() {
    const n = state.speakers.length;
    els.add.disabled = n >= MAX_SPEAKERS;
    els.count.textContent = `${n} / ${MAX_SPEAKERS}`;
  }

  function updateTransport() {
    els.play.classList.toggle('is-on', state.playing);
    els.play.setAttribute('aria-pressed', String(state.playing));
    els.playTxt.textContent = state.playing ? '暂停' : '播放';
    els.stage.classList.toggle('is-live', state.playing);
    updateNowState(currentTrackInfo());
    updateNowProgress();
  }

  function setMsg(text, isErr) {
    if (!els || !els.msg) return;
    els.msg.textContent = text || '';
    els.msg.classList.toggle('is-err', !!isErr);
  }

  /** 头部「?」帮助卡：默认收起 */
  function setHelp(show) {
    if (!els || !els.help) return;
    els.help.hidden = !show;
    if (els.helpBtn) els.helpBtn.setAttribute('aria-expanded', String(!!show));
  }

  /* ------------------------------------------------------------------ *
   * 预设 UI / 套用
   * ------------------------------------------------------------------ */
  function refreshPresetSelect(preferred) {
    if (!els || !els.preset) return;
    const selected = preferred !== undefined ? preferred : state.preset;
    const global = getGlobalPreset();
    const custom = getCustomPresets();

    els.preset.innerHTML = '';
    const current = document.createElement('option');
    current.value = '__current';
    current.textContent = '当前布局（未保存）';
    els.preset.appendChild(current);

    const addGroup = (label, items) => {
      if (!items.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const p of items) {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name + (p.name === global ? ' · 全局' : '');
        group.appendChild(opt);
      }
      els.preset.appendChild(group);
    };
    addGroup('内置预设', BUILTIN_PRESETS);
    addGroup('自定义预设', custom);

    const exists = selected && Array.from(els.preset.options).some((o) => o.value === selected);
    els.preset.value = exists ? selected : '__current';
    state.preset = exists ? selected : null;
    updatePresetButtons();
  }

  function updatePresetButtons() {
    if (!els || !els.preset) return;
    const selected = els.preset.value;
    const preset = selected !== '__current' ? findPreset(selected) : null;
    const builtin = !!(preset && BUILTIN_PRESETS.some((p) => p.name === preset.name));
    const global = getGlobalPreset();
    if (els.presetDel) els.presetDel.disabled = !preset || builtin;
    if (els.presetGlobal) {
      els.presetGlobal.disabled = !preset;
      els.presetGlobal.textContent = preset && global === preset.name ? '取消全局' : '设为全局';
      els.presetGlobal.setAttribute('aria-pressed', String(!!preset && global === preset.name));
    }
    if (els.presetHint) {
      els.presetHint.textContent = global ? `全局：${global}` : '';
      els.presetHint.title = global ? `每次打开空间音频自动套用「${global}」` : '';
    }
  }

  /** 用户动了布局 / 音量 / 音源：下拉回到「当前布局（未保存）」 */
  function markPresetDirty() {
    state.preset = null;
    if (els && els.preset && els.preset.value !== '__current') {
      els.preset.value = '__current';
      updatePresetButtons();
    }
  }

  function showPresetForm() {
    if (!els || !els.presetForm) return;
    els.presetForm.hidden = false;
    const base = state.preset ? `${state.preset} 副本` : '我的预设';
    els.presetName.value = base.slice(0, 24);
    try {
      els.presetName.focus({ preventScroll: true });
      els.presetName.select();
    } catch { /* noop */ }
  }

  function hidePresetForm() {
    if (!els || !els.presetForm) return;
    const wasOpen = !els.presetForm.hidden;
    els.presetForm.hidden = true;
    if (wasOpen && state.open && els.presetSave) {
      try { els.presetSave.focus({ preventScroll: true }); } catch { /* noop */ }
    }
  }

  function commitPresetForm() {
    const err = saveCurrentAs(els.presetName.value);
    if (err) {
      setMsg(err, true);
      try { els.presetName.focus({ preventScroll: true }); } catch { /* noop */ }
      return;
    }
    hidePresetForm();
    setMsg(`已保存预设「${state.preset}」`);
  }

  function toggleGlobalPreset() {
    if (!state.preset) return;
    const name = state.preset;
    if (getGlobalPreset() === name) {
      setGlobalPreset(null);
      refreshPresetSelect(name);
      setMsg(`已取消全局预设「${name}」`);
      return;
    }
    if (setGlobalPreset(name)) {
      refreshPresetSelect(name);
      setMsg(`「${name}」已设为全局，下次打开自动套用`);
    }
  }

  /** 套用预设：重建 speakers / panner / 舞台节点 / 列表，选中落到第一只 */
  function applyPreset(name, opts) {
    const preset = findPreset(name);
    if (!preset) {
      if (els && state.open) setMsg(`找不到预设「${name}」`, true);
      return false;
    }

    state.speakers = preset.speakers.slice(0, MAX_SPEAKERS).map((s) => {
      const sp = makeSpeaker(s.angle, s.distance, s.elevation);
      sp.vol = clamp(num(s.vol, 0.85), 0, 1);
      return sp;
    });
    if (!state.speakers.length) return false;

    state.selected = state.speakers[0].id;
    state.preset = preset.name;
    state.master = clamp(num(preset.master, 0.8), 0, 1);

    if (masterGain && ctx) {
      try { masterGain.gain.setTargetAtTime(state.master, ctx.currentTime, 0.03); } catch { /* noop */ }
    }
    // 内置预设没有 kf → 清空关键帧；自定义预设载入自己的 kf 并停播、播放头归 0
    loadKf(preset.kf);
    if (els) {
      els.master.value = String(Math.round(state.master * 100));
      if (els.masterV) els.masterV.textContent = `${Math.round(state.master * 100)}%`;
      ensureStageNodes();
      rebuildList();
      updateSpeakerDomAll();
      updateSelection();
      updateCount();
      refreshPresetSelect(preset.name);
    }
    if (ctx) syncSpeakerAudio();
    if (els && state.open && !(opts && opts.silent)) {
      setMsg(`已套用预设「${preset.name}」`);
    }
    return true;
  }

  function currentTrackInfo() {
    const P = mainPlayer();
    const a = P && P.audio;
    // 判据不变：活动 deck 上必须真的有 src，fetch + decodeAudioData 才有东西可解。
    if (!a || !a.src) return null;
    const q = P.state && P.state.queue;
    const tr = q && q[P.state.index];
    return {
      src: a.src,
      name: tr && (tr.name || tr.title) || '',
      artist: tr && (tr.artists || tr.artist) || '',
      album: tr && tr.album || '',
      cover: tr && tr.cover || '',
      source: tr && tr.source || 'netease',
    };
  }

  /** 平台标签：undefined / netease 都算网易云，没见过的源显示「未知」 */
  function sourceLabel(src) {
    return SOURCE_LABELS[src || 'netease'] || '未知';
  }

  /** 封面地址：优先队列里的 cover（走 API.img 代理），
      没有就退回主播放器「正在播放」大图的当前 src（可能已经是代理地址，不再二次包装） */
  function trackCoverUrl(info) {
    const cover = info && info.cover;
    if (cover) {
      if (typeof API !== 'undefined' && API && typeof API.img === 'function') {
        try { return API.img(cover, 160); } catch { /* 退回原图 */ }
      }
      return cover;
    }
    const art = document.getElementById('now-art');
    return (art && art.getAttribute('src')) || '';
  }

  let nowArtKey = null;   // 当前已渲染的封面地址，避免每次刷新都重建 <img>

  function updateNowArt(url) {
    if (!els || !els.nowArt) return;
    const key = url || '';
    if (key === nowArtKey) return;
    nowArtKey = key;
    const box = els.nowArt;
    box.innerHTML = '';
    if (!url) {
      box.innerHTML = NOTE_SVG;
      return;
    }
    const img = document.createElement('img');
    img.className = 'spz__now-img';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (nowArtKey !== key) return;   // 已经换成别的封面了
      nowArtKey = `${key}\n#err`;      // 下次刷新同一首时再试
      box.innerHTML = NOTE_SVG;
    }, { once: true });
    img.src = url;
    box.appendChild(img);
  }

  /** 状态徽标：播放中 > 已载入暂停 > 有歌未载入 > 没有歌 */
  function updateNowState(info) {
    if (!els || !els.nowState) return;
    let text = '按播放载入';
    let kind = 'is-ready';
    if (!info) {
      text = '播放器里没有歌';
      kind = 'is-empty';
    } else if (state.playing) {
      text = '正在播放';
      kind = 'is-playing';
    } else if (activeBuffer) {
      text = '已暂停';
      kind = 'is-paused';
    }
    els.nowState.textContent = text;
    els.nowState.className = `spz__now-state ${kind}`;
  }

  function updateNowProgress() {
    if (!els || !els.nowProgress) return;
    const ratio = activeBuffer && activeBuffer.duration > 0
      ? clamp(currentOffset() / activeBuffer.duration, 0, 1)
      : 0;
    const v = Math.round(ratio * 1000) / 1000;
    anim.progress = v;
    els.nowProgress.style.transform = `scaleX(${v})`;
  }

  /** 音源面板：正在播放卡片（封面 / 歌名 / 歌手 · 平台 / 状态）+ 收起时的标题提示 */
  function updateSourceHint() {
    if (!els || !els.now) return;
    const info = currentTrackInfo();
    updateNowArt(trackCoverUrl(info));
    els.nowName.textContent = info ? (info.name || '未知歌曲') : '播放器里没有歌';
    els.nowSub.textContent = info
      ? [info.artist, sourceLabel(info.source)].filter(Boolean).join(' · ')
      : '';
    updateNowState(info);
    updateNowProgress();
    els.srcHint.textContent = info
      ? (info.name ? `《${info.name}》` : '已就绪')
      : '播放器里没有歌';
    els.srcHint.title = info ? [info.name, info.artist].filter(Boolean).join(' · ') : '';
    return info;
  }

  /* 浮层开着时，主播放器换歌 / 换源，提示要自己刷新。
     player.js 的 on() 只是把回调塞进内部数组，没有返回取消函数，也没有 off()，
     所以这里用一个 active 标记做「软解除」：close() 置 false，回调先看标记。
     回调只挂一次，之后再打开浮层只是把同一个标记重新点亮，不会越积越多。 */
  let hintToken = null;
  function subscribePlayerHints() {
    if (hintToken) { hintToken.active = true; return; }
    const P = mainPlayer();
    if (!P || typeof P.on !== 'function') return;   // 播放器还没就绪，下次打开再试
    const token = hintToken = { active: true };
    const refresh = () => {
      if (!token.active || !state.open) return;
      const info = currentTrackInfo();
      // 已载入的 src 和当前歌曲不一致（或歌没了）→ 旧 buffer 必须失效
      const changed = !info || info.src !== (state.songSrc || '');
      const loaded = !!(state.songSrc || activeBuffer);
      if (changed && loaded) {
        const wasPlaying = state.playing;
        if (wasPlaying) {
          state.playing = false;
          stopSource();
        }
        activeBuffer = null;
        playOffset = 0;
        state.songBuffer = null;
        state.songSrc = '';
        updateTransport();
        updateSourceHint();
        // 只更新提示，不自动开播 —— 播放始终交给用户点「播放」。
        setMsg(wasPlaying ? '歌曲已切换，按播放重新加载' : '');
        return;
      }
      updateSourceHint();
      if (info && !state.playing) setMsg('当前歌曲已就绪，按播放载入');
    };
    try { P.on('trackchange', refresh); } catch { /* noop */ }
    try { P.on('source', refresh); } catch { /* noop */ }
  }
  function unsubscribePlayerHints() {
    if (hintToken) hintToken.active = false;
  }

  /** 一处改动 → 同步 Panner / 舞台标签 / 列表读数，拖动和滑杆都走这里 */
  function syncSpeaker(id) {
    const sp = findSpeaker(id);
    if (!sp) return;
    const rec = audioSpk.get(sp.id);
    if (rec && ctx) setPannerPos(rec.panner, sp, false);
    const index = state.speakers.indexOf(sp);
    const node = nodeEls.get(sp.id);
    if (node) updateSpeakerNode(node, sp, index);
    const li = els.list.querySelector(`.spz__item[data-id="${sp.id}"]`);
    if (li) updateListItem(li, sp, index);
    markPresetDirty();
  }

  /* ------------------------------------------------------------------ *
   * 转动视角
   * ------------------------------------------------------------------ */
  function onStageDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('.spz__spk, .spz__cam')) return;

    // 先于轨道旋转做轴命中：点中选中音响的 XYZ 轴就进入轴拖拽
    const axis = axisHitTest(e.clientX, e.clientY);
    if (axis) {
      beginAxisDrag(e, axis);
      return;
    }

    orbit = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
    };
    camVel.yaw = 0;
    camVel.pitch = 0;
    try { els.stage.setPointerCapture(e.pointerId); } catch { /* noop */ }
    els.stage.classList.add('is-rot');
    e.preventDefault();
  }

  function onStageMove(e) {
    if (axisDrag) {
      onAxisDragMove(e);
      return;
    }
    if (!orbit || e.pointerId !== orbit.pointerId) {
      updateAxisHover(e);
      return;
    }
    const now = performance.now();
    const dt = Math.max(0.008, (now - orbit.lastT) / 1000);
    const dx = e.clientX - orbit.lastX;
    const dy = e.clientY - orbit.lastY;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    orbit.lastT = now;

    // 手往右拖 = 场景往右转 = 相机往左绕
    const dYaw = -dx * 0.0068;
    const dPitch = -dy * 0.0042;
    CAM_T.yaw += dYaw;
    CAM_T.pitch = clamp(CAM_T.pitch + dPitch, PITCH_MIN, PITCH_MAX);
    camVel.yaw = clamp(dYaw / dt * 0.5, -3, 3);
    camVel.pitch = clamp(dPitch / dt * 0.5, -2, 2);

    if (REDUCED) {
      CAM.yaw = CAM_T.yaw;
      CAM.pitch = CAM_T.pitch;
    }
    e.preventDefault();
  }

  function onStageUp(e) {
    if (axisDrag) {
      endAxisDrag(e);
      return;
    }
    if (!orbit) return;
    if (e && e.pointerId != null && e.pointerId !== orbit.pointerId) return;
    try { els.stage.releasePointerCapture(orbit.pointerId); } catch { /* noop */ }
    els.stage.classList.remove('is-rot');
    orbit = null;
    if (REDUCED) {
      camVel.yaw = 0;
      camVel.pitch = 0;
    }
  }

  /** 鼠标悬停在轴上：光标 grab；拖拽中由 .is-axis-drag 改成 grabbing */
  function updateAxisHover(e) {
    if (!els || !state.open) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (e.target.closest && e.target.closest('.spz__spk, .spz__cam')) {
      if (!axisHover) return;
      axisHover = null;
      els.stage.classList.remove('is-axis-hover');
      return;
    }
    const hit = axisHitTest(e.clientX, e.clientY);
    const key = hit ? hit.key : null;
    if (key === axisHover) return;
    axisHover = key;
    els.stage.classList.toggle('is-axis-hover', !!key);
  }

  /* ------------------------------------------------------------------ *
   * 轴拖拽：屏幕位移投影到该轴，再反算回极坐标（setFromXyz 是唯一入口）
   * ------------------------------------------------------------------ */
  function beginAxisDrag(e, axis) {
    const sp = findSpeaker(state.selected);
    if (!sp) return;
    const w = worldPos(sp);
    axisDrag = {
      pointerId: e.pointerId,
      axis: axis.key,
      base: { x: w.x, y: w.y, z: w.z },
      sx: e.clientX,
      sy: e.clientY,
      dx: axis.dx,
      dy: axis.dy,
      len2: Math.max(1, axis.len * axis.len),
      worldLen: axis.worldLen,
    };
    camVel.yaw = 0;
    camVel.pitch = 0;
    try { els.stage.setPointerCapture(e.pointerId); } catch { /* noop */ }
    els.stage.classList.add('is-axis-drag');
    axisHover = axis.key;
    e.preventDefault();
  }

  function onAxisDragMove(e) {
    if (!axisDrag || e.pointerId !== axisDrag.pointerId) return;
    const sp = findSpeaker(state.selected);
    if (!sp) { endAxisDrag(e); return; }
    const px = e.clientX - axisDrag.sx;
    const py = e.clientY - axisDrag.sy;
    // 世界位移 = dot(屏幕位移, 轴屏幕方向) / |轴屏幕方向|² × 轴世界长度
    const delta = ((px * axisDrag.dx + py * axisDrag.dy) / axisDrag.len2) * axisDrag.worldLen;
    const next = { x: axisDrag.base.x, y: axisDrag.base.y, z: axisDrag.base.z };
    next[axisDrag.axis] += delta;
    setFromXyz(sp, next.x, next.y, next.z);   // 内部 clamp 到距离 / 高度范围
    syncSpeaker(sp.id);                       // panner + 舞台标签 + 列表读数
    drawScene();
    e.preventDefault();
  }

  function endAxisDrag(e) {
    if (!axisDrag) return;
    if (e && e.pointerId != null && e.pointerId !== axisDrag.pointerId) return;
    try { els.stage.releasePointerCapture(axisDrag.pointerId); } catch { /* noop */ }
    els.stage.classList.remove('is-axis-drag');
    els.stage.classList.remove('is-axis-hover');
    axisDrag = null;
    axisHover = null;
  }

  function onWheel(e) {
    if (!state.open) return;
    e.preventDefault();
    CAM_T.zoom = clamp(CAM_T.zoom * Math.exp(-e.deltaY * 0.0014), ZOOM_MIN, ZOOM_MAX);
    if (REDUCED) CAM.zoom = CAM_T.zoom;
  }

  /* ------------------------------------------------------------------ *
   * 拖动音响 / 键盘
   * ------------------------------------------------------------------ */
  function selectSpeaker(id) {
    if (!findSpeaker(id)) return;
    const changed = state.selected !== id;
    state.selected = id;
    updateSelection();
    if (changed) syncListItemOpen();   // 新选中的展开，原来的收起
  }

  function beginDrag(e, id) {
    e.stopPropagation();               // 不和舞台的旋转抢手势
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sp = findSpeaker(id);
    if (!sp) return;
    selectSpeaker(id);
    drag = { id, pointerId: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    e.currentTarget.classList.add('is-drag');
    try { e.currentTarget.focus({ preventScroll: true }); } catch { /* noop */ }
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const sp = findSpeaker(drag.id);
    if (!sp) return;

    // 屏幕点反投到地面：视角转过之后，拖拽方向依然跟着地面走
    const hit = groundPoint(e.clientX, e.clientY);
    if (hit) {
      let deg = Math.atan2(-hit.x, -hit.z) / DEG;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;   // Shift 吸附 15°
      sp.angle = normDeg(deg);
      // 距离是真实距离：地面上的水平半径要除以 cos(仰角)，箱子才跟在鼠标下
      const cosE = Math.max(0.12, Math.cos(clamp(sp.elevation, 0, MAX_ELEV) * DEG));
      sp.distance = clamp(Math.hypot(hit.x, hit.z) / cosE, MIN_DIST, MAX_DIST);
      clampHeight(sp);
      syncSpeaker(sp.id);
    }
    e.preventDefault();
  }

  function endDrag(e) {
    if (!drag) return;
    if (e && e.pointerId != null && e.pointerId !== drag.pointerId) return;
    const node = nodeEls.get(drag.id);
    if (node) {
      node.classList.remove('is-drag');
      try { node.releasePointerCapture(drag.pointerId); } catch { /* noop */ }
    }
    drag = null;
  }

  function onNodeKey(e, id) {
    const sp = findSpeaker(id);
    if (!sp) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (state.speakers.length > 1) removeSpeaker(id);
      return;
    }

    // 角度向左增大，所以左方向键是 +step（屏幕上是逆时针）
    const step = e.shiftKey ? 15 : 5;
    const hStep = e.shiftKey ? 0.5 : 0.2;
    let handled = true;
    if (e.key === 'ArrowLeft') sp.angle = normDeg(sp.angle + step);
    else if (e.key === 'ArrowRight') sp.angle = normDeg(sp.angle - step);
    else if (e.key === 'ArrowUp') sp.distance = clamp(sp.distance + 0.15, MIN_DIST, MAX_DIST);
    else if (e.key === 'ArrowDown') sp.distance = clamp(sp.distance - 0.15, MIN_DIST, MAX_DIST);
    else if (e.key === 'PageUp') setHeight(sp, heightOf(sp) + hStep);
    else if (e.key === 'PageDown') setHeight(sp, heightOf(sp) - hStep);
    else handled = false;
    if (!handled) return;

    clampHeight(sp);
    e.preventDefault();
    selectSpeaker(id);
    syncSpeaker(id);
  }

  /* ------------------------------------------------------------------ *
   * 增删音响
   * ------------------------------------------------------------------ */
  function addSpeaker() {
    if (state.speakers.length >= MAX_SPEAKERS) {
      setMsg('最多 4 个音响');
      return;
    }
    const sp = makeSpeaker(nextFreeAngle(), 2.2, 0);
    state.speakers.push(sp);
    state.selected = sp.id;
    markPresetDirty();

    if (ctx) syncSpeakerAudio();
    ensureStageNodes();
    rebuildList();
    updateSpeakerDomAll();
    updateSelection();
    updateCount();
    setMsg(`已加入音响 ${state.speakers.length}`);

    const node = nodeEls.get(sp.id);
    if (node) try { node.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function removeSpeaker(id) {
    if (state.speakers.length <= 1) return;
    const i = state.speakers.findIndex((s) => s.id === id);
    if (i < 0) return;

    state.speakers.splice(i, 1);
    if (state.selected === id) {
      state.selected = state.speakers[Math.max(0, i - 1)].id;
    }
    markPresetDirty();

    if (ctx) {
      removeSpeakerAudio(id);
      syncSpeakerAudio();   // 剩余音响的 1/√N 补偿重新算
    }
    ensureStageNodes();
    rebuildList();
    updateSpeakerDomAll();
    updateSelection();
    updateCount();
    setMsg(`已删除音响，剩余 ${state.speakers.length} 个`);

    const node = nodeEls.get(state.selected);
    if (node) try { node.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  /* ------------------------------------------------------------------ *
   * 关键帧动画（v1）
   * ------------------------------------------------------------------
     独立时间轴：state.kfTime 由 frame() 的 dt 推进，不跟音源同步。
     关键帧按 t 排序；相邻两帧之间线性插值，角度走最短路径。
     音响按数组下标对应，数量不一致时只处理较小的那一批，多出来的保持不动。 */
  function lerpAngle(a, b, u) {
    const d = ((b - a + 540) % 360) - 180;   // -180..180，处理 0/360 环绕
    return normDeg(a + d * u);
  }

  /** 关键帧里的总音量：音频图 + 滑杆读数一起更新 */
  function setMasterValue(v) {
    const m = clamp(Number(v) || 0, 0, 1);
    const changed = Math.abs(m - state.master) > 1e-4;
    state.master = m;
    if (masterGain && ctx) {
      try { masterGain.gain.setTargetAtTime(m, ctx.currentTime, 0.03); } catch { /* noop */ }
    }
    if (els && els.master) {
      const pct = Math.round(m * 100);
      if (Number(els.master.value) !== pct) els.master.value = String(pct);
      if (els.masterV && els.masterV.textContent !== `${pct}%`) els.masterV.textContent = `${pct}%`;
    }
    return changed;
  }

  /** 把播放头 t 的布局算出来并写回 state.speakers；返回实际改动的音响数 */
  function applyKfAt(t) {
    const keys = state.kf.keys;
    if (!keys.length) return 0;
    let a = keys[0];
    let b = keys[0];
    let u = 0;
    if (t <= keys[0].t) {
      a = b = keys[0];
    } else if (t >= keys[keys.length - 1].t) {
      a = b = keys[keys.length - 1];
    } else {
      for (let i = 0; i < keys.length - 1; i++) {
        if (t >= keys[i].t && t <= keys[i + 1].t) {
          a = keys[i];
          b = keys[i + 1];
          const span = b.t - a.t;
          u = span > 1e-6 ? (t - a.t) / span : 1;
          break;
        }
      }
    }

    const n = Math.min(a.speakers.length, b.speakers.length, state.speakers.length);
    for (let i = 0; i < n; i++) {
      const sa = a.speakers[i];
      const sb = b.speakers[i];
      const sp = state.speakers[i];
      sp.angle = lerpAngle(sa.angle, sb.angle, u);
      sp.distance = sa.distance + (sb.distance - sa.distance) * u;
      sp.elevation = sa.elevation + (sb.elevation - sa.elevation) * u;
      sp.vol = sa.vol + (sb.vol - sa.vol) * u;
      clampHeight(sp);
      syncSpeaker(sp.id);   // panner + 舞台标签 + 右侧列表
      updateGain(sp);       // 关键帧里的 vol 要真的作用到增益
    }
    if (setMasterValue(a.master + (b.master - a.master) * u)) markPresetDirty();
    return n;
  }

  function stepKeyframes(dt) {
    if (!state.kfPlaying) return;
    if (state.kf.keys.length < 2) {
      state.kfPlaying = false;
      updateKfTransport();
      return;
    }
    const dur = Math.max(0.1, state.kf.duration);
    let t = state.kfTime + dt;
    if (t >= dur) {
      if (state.kf.loop) t = (t - dur) % dur;
      else {
        t = dur;
        state.kfPlaying = false;
      }
    }
    state.kfTime = clamp(t, 0, dur);
    applyKfAt(state.kfTime);
    updateKfPlayhead();
    if (!state.kfPlaying) updateKfTransport();
  }

  function updateKfPlayhead() {
    if (!els || !els.kfHead) return;
    const d = Math.max(0.001, state.kf.duration);
    const p = clamp(state.kfTime / d, 0, 1);
    els.kfHead.style.left = `${(p * 100).toFixed(3)}%`;
    if (els.kfTime) els.kfTime.textContent = `${state.kfTime.toFixed(2)} s`;
  }

  function renderKfKeys() {
    if (!els || !els.kfKeys) return;
    const d = Math.max(0.001, state.kf.duration);
    els.kfKeys.innerHTML = state.kf.keys.map((k, i) => {
      const left = clamp(k.t / d, 0, 1) * 100;
      return `<span class="spz__kf-key${i === kfSel ? ' is-sel' : ''}" data-i="${i}"
        style="left:${left.toFixed(2)}%" title="${k.t.toFixed(2)} s"></span>`;
    }).join('');
  }

  function updateKfHint() {
    if (!els || !els.kfHint) return;
    const n = state.kf.keys.length;
    els.kfHint.textContent = n < 2
      ? '至少记录两个关键帧才能播放'
      : `共 ${n} 个关键帧 · 点击圆点选中，拖动标尺移动播放头`;
  }

  function updateKfTransport() {
    if (!els || !els.kfPlay) return;
    els.kfPlay.textContent = state.kfPlaying ? '暂停' : '播放';
    els.kfPlay.classList.toggle('is-on', state.kfPlaying);
    els.kfPlay.setAttribute('aria-pressed', String(state.kfPlaying));
    els.kfPlay.disabled = !state.kfPlaying && state.kf.keys.length < 2;
    if (els.kfDel) els.kfDel.disabled = kfSel < 0 || kfSel >= state.kf.keys.length;
    if (els.kfClear) els.kfClear.disabled = !state.kf.keys.length;
    if (els.kfDur) els.kfDur.value = String(state.kf.duration);
    if (els.kfDurLb) els.kfDurLb.textContent = `${state.kf.duration} s`;
    if (els.kfLoop) els.kfLoop.checked = !!state.kf.loop;
    updateKfHint();
  }

  function syncKfPanel() {
    if (!els || !els.kfPanel) return;
    renderKfKeys();
    updateKfPlayhead();
    updateKfTransport();
  }

  /** 套用预设 / 打开工具时载入关键帧：停播、播放头归 0 */
  function loadKf(raw) {
    state.kf = raw ? cloneKf(raw) : defaultKf();
    state.kfPlaying = false;
    state.kfTime = 0;
    kfSel = -1;
    syncKfPanel();
  }

  function openKfPanel() {
    if (!els || !els.kfPanel) return;
    kfPanelOpen = true;
    lastKfFocus = document.activeElement;
    els.kfPanel.hidden = false;
    if (els.kfOpen) els.kfOpen.setAttribute('aria-expanded', 'true');
    syncKfPanel();
    try { els.kfRecord.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function closeKfPanel() {
    if (!els || !els.kfPanel || els.kfPanel.hidden) return;
    kfPanelOpen = false;
    state.kfPlaying = false;
    if (kfScrub) {
      try { els.kfRuler.releasePointerCapture(kfScrub.pointerId); } catch { /* noop */ }
      kfScrub = null;
    }
    els.kfPanel.hidden = true;
    if (els.kfOpen) els.kfOpen.setAttribute('aria-expanded', 'false');
    updateKfTransport();
    if (lastKfFocus && lastKfFocus.isConnected) {
      try { lastKfFocus.focus({ preventScroll: true }); } catch { /* noop */ }
    }
    lastKfFocus = null;
  }

  function kfTimeAt(clientX) {
    const track = els.kfTrack || els.kfRuler;
    const r = track.getBoundingClientRect();
    const x = clamp(clientX - r.left, 0, r.width);
    return (x / Math.max(1, r.width)) * state.kf.duration;
  }

  function onKfScrubDown(e) {
    if (!els || !els.kfRuler) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    state.kfPlaying = false;
    const track = els.kfTrack || els.kfRuler;
    const r = track.getBoundingClientRect();
    const px = e.clientX - r.left;
    const d = Math.max(0.001, state.kf.duration);
    let hit = -1;
    let best = AXIS_HIT_TIP;   // 圆点命中半径 12px
    state.kf.keys.forEach((k, i) => {
      const kx = (k.t / d) * r.width;
      const dist = Math.abs(kx - px);
      if (dist <= best) { best = dist; hit = i; }
    });
    if (hit >= 0) {
      kfSel = hit;
      state.kfTime = state.kf.keys[hit].t;
      renderKfKeys();
    } else {
      state.kfTime = kfTimeAt(e.clientX);
    }
    kfScrub = { pointerId: e.pointerId };
    try { els.kfRuler.setPointerCapture(e.pointerId); } catch { /* noop */ }
    applyKfAt(state.kfTime);
    updateKfPlayhead();
    updateKfTransport();
  }

  function onKfScrubMove(e) {
    if (!kfScrub || e.pointerId !== kfScrub.pointerId) return;
    state.kfTime = kfTimeAt(e.clientX);
    applyKfAt(state.kfTime);
    updateKfPlayhead();
    e.preventDefault();
  }

  function onKfScrubUp(e) {
    if (!kfScrub) return;
    if (e && e.pointerId != null && e.pointerId !== kfScrub.pointerId) return;
    try { els.kfRuler.releasePointerCapture(kfScrub.pointerId); } catch { /* noop */ }
    kfScrub = null;
  }

  function toggleKfPlay() {
    if (state.kfPlaying) {
      state.kfPlaying = false;
      updateKfTransport();
      return;
    }
    if (state.kf.keys.length < 2) {
      updateKfHint();
      return;
    }
    if (state.kfTime >= state.kf.duration) state.kfTime = 0;
    state.kfPlaying = true;
    updateKfTransport();
  }

  function recordKeyframe() {
    state.kfPlaying = false;
    const t = Math.round(clamp(state.kfTime, 0, state.kf.duration) * 100) / 100;
    const key = {
      t,
      speakers: state.speakers.map((s) => ({
        angle: s.angle,
        distance: s.distance,
        elevation: s.elevation,
        vol: s.vol,
      })),
      master: state.master,
    };
    const keys = state.kf.keys;
    const dup = keys.findIndex((k) => Math.abs(k.t - t) <= KF_KEY_GAP);
    if (dup >= 0) keys[dup] = key;
    else keys.push(key);
    keys.sort((a, b) => a.t - b.t);
    kfSel = keys.indexOf(key);
    markPresetDirty();
    renderKfKeys();
    updateKfPlayhead();
    updateKfTransport();
  }

  function deleteSelectedKeyframe() {
    if (kfSel < 0 || kfSel >= state.kf.keys.length) return;
    state.kfPlaying = false;
    state.kf.keys.splice(kfSel, 1);
    kfSel = -1;
    markPresetDirty();
    renderKfKeys();
    updateKfTransport();
  }

  function clearKeyframes() {
    if (!state.kf.keys.length) return;
    state.kfPlaying = false;
    state.kf.keys = [];
    state.kfTime = 0;
    kfSel = -1;
    markPresetDirty();
    renderKfKeys();
    updateKfPlayhead();
    updateKfTransport();
  }

  function onKfDurationChange() {
    if (!els || !els.kfDur) return;
    const v = clamp(Math.round(num(els.kfDur.value, KF_DUR_DEF)), KF_DUR_MIN, KF_DUR_MAX);
    els.kfDur.value = String(v);
    if (v === state.kf.duration) {
      updateKfTransport();
      return;
    }
    state.kf.duration = v;
    // 缩短时长时，超出范围的关键帧移除；落在同一时刻的合并
    const kept = [];
    for (const k of state.kf.keys) {
      if (k.t > v + 1e-6) continue;
      const dup = kept.find((x) => Math.abs(x.t - k.t) <= KF_KEY_GAP);
      if (dup) Object.assign(dup, k);
      else kept.push(k);
    }
    kept.sort((a, b) => a.t - b.t);
    state.kf.keys = kept;
    state.kfTime = clamp(state.kfTime, 0, v);
    state.kfPlaying = false;
    kfSel = -1;
    markPresetDirty();
    renderKfKeys();
    updateKfPlayhead();
    updateKfTransport();
  }

  /* ------------------------------------------------------------------ *
   * 打开 / 关闭
   * ------------------------------------------------------------------ */
  /** 打开时把焦点送进工具：音源抽屉收起时落到它的标题按钮，别聚焦隐藏控件 */
  function focusToolEntry() {
    const target = secOpen.source ? els.play : els.secSourceBtn;
    if (target) try { target.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function open() {
    if (!built) build();
    if (state.open) {
      focusToolEntry();
      return;
    }

    state.open = true;
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('is-spatial-open');   // 隐藏 14px 顶部拖窗带，别盖住工具头部
    document.addEventListener('keydown', onDocKey, true);
    kfPanelOpen = false;
    if (els.kfPanel) els.kfPanel.hidden = true;
    if (els.kfOpen) els.kfOpen.setAttribute('aria-expanded', 'false');

    // 全局预设每次打开自动套用；没有全局 / 全局失效时保留当前布局
    const globalName = getGlobalPreset();
    if (!(globalName && applyPreset(globalName, { silent: true }))) {
      if (!state.speakers.length) resetSpeakers();
    }
    if (!findSpeaker(state.selected)) state.selected = state.speakers[0].id;

    ensureStageNodes();
    rebuildList();
    updateSpeakerDomAll();
    updateSelection();
    updateCount();
    refreshPresetSelect(state.preset);
    syncKfPanel();

    els.master.value = String(Math.round(state.master * 100));
    if (els.masterV) els.masterV.textContent = `${Math.round(state.master * 100)}%`;
    updateSourceHint();
    subscribePlayerHints();   // 打开期间主播放器换歌/开始播放 → 提示自己刷新
    updateTransport();
    setHelp(false);
    hidePresetForm();
    setMsg('');
    focusToolEntry();

    // 浮层隐藏时 stage 尺寸是 0，必须等显示后再量一次
    resizeCanvas();
    drawScene();
    startLoop();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.playing = false;

    stopLoop();
    root.hidden = true;
    setHelp(false);
    hidePresetForm();
    unsubscribePlayerHints();
    document.removeEventListener('keydown', onDocKey, true);
    document.body.classList.remove('is-spatial-open');

    // 关键帧面板：停播、收起，不留后台时间轴
    state.kfPlaying = false;
    kfPanelOpen = false;
    if (els && els.kfPanel) els.kfPanel.hidden = true;
    if (els && els.kfOpen) els.kfOpen.setAttribute('aria-expanded', 'false');
    lastKfFocus = null;

    if (drag) {
      const node = nodeEls.get(drag.id);
      try {
        if (node && node.hasPointerCapture && node.hasPointerCapture(drag.pointerId)) {
          node.releasePointerCapture(drag.pointerId);
        }
      } catch { /* noop */ }
    }
    if (orbit) {
      try { els.stage.releasePointerCapture(orbit.pointerId); } catch { /* noop */ }
      els.stage.classList.remove('is-rot');
    }
    if (axisDrag) {
      try { els.stage.releasePointerCapture(axisDrag.pointerId); } catch { /* noop */ }
      axisDrag = null;
    }
    axisHover = null;
    els.stage.classList.remove('is-axis-drag');
    els.stage.classList.remove('is-axis-hover');
    if (kfScrub) {
      try { els.kfRuler.releasePointerCapture(kfScrub.pointerId); } catch { /* noop */ }
      kfScrub = null;
    }
    drag = null;
    orbit = null;
    camVel.yaw = 0;
    camVel.pitch = 0;
    nodeEls.forEach((node) => node.classList.remove('is-drag'));

    restoreMainPlayer();
    teardownAudio();
    updateTransport();

    const back = lastFocus && lastFocus.isConnected && !lastFocus.closest('[hidden]')
      ? lastFocus
      : document.querySelector('[data-tool="box"]');
    if (back) try { back.focus({ preventScroll: true }); } catch { /* noop */ }
  }

  function onDocKey(e) {
    if (e.key !== 'Escape' || !state.open) return;
    e.preventDefault();
    e.stopPropagation();
    // 关键帧面板打开时，Esc 只关面板，不退出整个工具
    if (kfPanelOpen) {
      closeKfPanel();
      return;
    }
    // 先收命名表单，再收帮助卡，最后才关整个浮层
    if (els && els.presetForm && !els.presetForm.hidden) {
      hidePresetForm();
      return;
    }
    if (els && els.help && !els.help.hidden) {
      setHelp(false);
      return;
    }
    close();
  }

  // 浮层被切到后台时停掉 rAF：转场景的持续绘制不该在看不见的时候跑
  document.addEventListener('visibilitychange', () => {
    if (!state.open) return;
    if (document.hidden) stopLoop();
    else startLoop();
  });

  /* ------------------------------------------------------------------ *
   * 对外
   * ------------------------------------------------------------------ */
  /** 内置 + 自定义预设的只读快照；global 标记当前全局默认 */
  function getPresets() {
    const global = getGlobalPreset();
    const wrap = (p, builtin) => ({
      name: p.name,
      builtin,
      global: p.name === global,
      speakers: p.speakers.map((s) => ({
        angle: s.angle,
        distance: s.distance,
        elevation: s.elevation,
        vol: s.vol,
      })),
      master: p.master,
    });
    return [
      ...BUILTIN_PRESETS.map((p) => wrap(p, true)),
      ...getCustomPresets().map((p) => wrap(p, false)),
    ];
  }

  return {
    open,
    close,
    getPresets,
    applyPreset,
    getGlobalPreset,
    savePreset(name) {
      if (!state.speakers.length) resetSpeakers();
      return saveCurrentAs(name) === null;
    },
    deletePreset,
    setGlobalPreset: (name) => {
      const ok = setGlobalPreset(name);
      if (ok && els) refreshPresetSelect(state.preset);
      return ok;
    },
  };
})();

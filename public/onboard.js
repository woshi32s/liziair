/* ==========================================================================
   开场引导 —— onboard.js
   --------------------------------------------------------------------------
   两幕：

   【第一幕 · 打招呼】粒子先聚成一只挥手的手，文案说「hi，这里是 LIZI 播放器」；
     然后手化开，变成一张只有两只眼睛的小脸，眨眼、转睛、呼吸，一直陪着你到点「开始看看」。
     脸不画嘴、不画轮廓 —— 用户明确说「可以只做两个眼睛」。

   【第二幕 · 指路】景深把该看的地方抠出来，粒子贴着真实控件的边框流动，5 步走完。

   粒子怎么变形的：形状画进离屏 canvas → 采样 alpha 像素得到目标点 →
   粒子按「绕重心的角度」排序后一对一分配（和 GitHub 上那类 particle-morph
   项目的通用做法一致），再用弹簧飞过去。脸的眨眼/转睛/呼吸都不换形状，
   只改矩阵（压扁 / 平移 / 缩放），所以不会每眨一次眼就重排一次粒子。

   没碰 app.js / app.css：本文件自己找 DOM、自己绑设置页那一行。
   ========================================================================== */

const LIZI_TOUR = (() => {
  const KEY = 'lizi.tour.v1';

  /* 指路的 5 步：选择器就是 app.js / index.html 里那几个 id */
  const STEPS = [
    { sel: '#hall-hero', pad: 10, title: '这是你上次听到的歌', desc: '悬停看歌词，点一下封面就飞进播放页。再往下是推荐歌单。' },
    { sel: '#search-wrap', pad: 8, title: '搜歌', desc: '歌名、歌手、专辑都能搜。顶栏下拉可以切网易云 / QQ / 酷狗 / 汽水 / 波点。' },
    { sel: '#hall-tools', firstChild: true, pad: 6, title: '235 个歌词形态', desc: '形态长廊、我的专辑、音乐实验室、工具箱，四个入口排在这一行。' },
    { sel: '#hall-me', pad: 8, title: '你的主页', desc: '头像、等级、听歌量都在这儿；登录多个平台就横着排成一张张卡。' },
    { sel: '#btn-settings', pad: 5, title: '设置', desc: '音质、音效、音源、外观都在这里。想再看一遍这段开场，也在设置里点。' },
  ];

  const INK = '23, 23, 26';
  const ACCENT = '213, 55, 60';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* 形状都在 200×200 的坐标系里画，采样后归一化到 -0.5..0.5 */
  const SS = 340;

  let root, dof, cvs, card, els;
  let ctx = null, dpr = 1, W = 0, H = 0;

  let parts = [];                 // 粒子池（一次建，永远复用）
  let shapePts = null;            // 当前形状的归一化点
  let M = { cx: 0, cy: 0, sx: 1, sy: 1, rot: 0, pivotX: 0, pivotY: 0 };
  let pivX = 0, pivY = 0;         // 缓动的枢轴（换形状时不跳）

  let mode = 'idle';              // idle | intro | steps
  let step = 0;
  let running = false;
  let raf = 0, lastT = 0, lastMeasure = 0, maskKey = '';
  let bloomT0 = 0;
  let introT0 = 0;
  let timers = [];

  /* 脸的表情状态：眨眼 / 转睛 / 呼吸 */
  const face = {
    blinkUntil: 0, nextBlink: 0, blinkDur: 150,
    gazeX: 0, gazeY: 0, gazeTX: 0, gazeTY: 0, nextGaze: 0,
  };

  let R = null;                    // 指路时的景深窗口
  let ring = null;                 // 指路时的归一化边框点
  let shapeKey = '';               // 'hand' | 'eyes'，决定这一帧算什么
  let lastPointer = 0;             // 鼠标最近一次动的时间（脸会跟着看）

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ==========================================================================
     形状：画进离屏 canvas，采样 alpha 像素当目标点
     ========================================================================== */
  const shapeCache = new Map();

  function sampleShape(key, draw) {
    if (shapeCache.has(key)) return shapeCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = cv.height = SS;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.scale(SS / 200, SS / 200);          // 统一在 200×200 里画
    draw(g);
    const d = g.getImageData(0, 0, SS, SS).data;
    const px = [];
    for (let y = 0; y < SS; y++) {
      for (let x = 0; x < SS; x++) {
        if (d[(y * SS + x) * 4 + 3] > 140) px.push(x, y);
      }
    }
    const flat = new Float32Array(px.length);
    for (let i = 0; i < px.length; i++) flat[i] = px[i] / SS - 0.5;
    const out = { pts: flat, n: px.length / 2 };
    shapeCache.set(key, out);
    return out;
  }

  function capsule(g, x, y, w, h, r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  }

  function eyeBall(g, cx, cy, rx, ry) {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    // 高光挖空：眼神才有神
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.ellipse(cx + 9, cy - 11, 7.2, 8.4, -0.35, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  const SHAPES = {
    /* 挥手的手：手掌 + 四根手指 + 一根拇指，全是胶囊拼的 */
    hand(g) {
      g.fillStyle = '#fff';
      capsule(g, 60, 98, 96, 76, 30);        // 手掌
      capsule(g, 62, 52, 21, 64, 10.5);      // 食指
      capsule(g, 86, 38, 21, 78, 10.5);      // 中指
      capsule(g, 110, 46, 21, 70, 10.5);     // 无名指
      capsule(g, 134, 60, 21, 56, 10.5);     // 小指
      g.save();                              // 拇指
      g.translate(64, 140);
      g.rotate(-0.55);
      capsule(g, -11, -8, 21, 54, 10.5);
      g.restore();
    },
    /* 只有两只眼睛的脸 */
    eyes(g) {
      g.fillStyle = '#fff';
      eyeBall(g, 71, 100, 27, 31);
      eyeBall(g, 129, 100, 27, 31);
    },
  };

  /* 指路时的边框：单位矩形（-0.5..0.5）的一圈点，靠矩阵拉伸成实际窗口 */
  function ringPoints(n) {
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 4;
      const side = Math.min(3, Math.floor(t));
      const f = t - side;
      let x, y;
      if (side === 0) { x = -0.5 + f; y = -0.5; }
      else if (side === 1) { x = 0.5; y = -0.5 + f; }
      else if (side === 2) { x = 0.5 - f; y = 0.5; }
      else { x = -0.5; y = 0.5 - f; }
      pts[i * 2] = x;
      pts[i * 2 + 1] = y;
    }
    return { pts, n };
  }

  /* --------------------------------------------------------------------------
     把形状点分给粒子：两边都按「绕重心的角度」排序后一对一，
     这样变形时是一条旋转的涡流，而不是一片乱飞。
     -------------------------------------------------------------------------- */
  function assign(shape) {
    const n = parts.length;
    const tAng = new Float32Array(shape.n);
    for (let i = 0; i < shape.n; i++) tAng[i] = Math.atan2(shape.pts[i * 2 + 1], shape.pts[i * 2]);
    const tOrder = new Array(shape.n);
    for (let i = 0; i < shape.n; i++) tOrder[i] = i;
    tOrder.sort((a, b) => tAng[a] - tAng[b]);

    const pOrder = new Array(n);
    const pAng = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pOrder[i] = i;
      pAng[i] = Math.atan2(parts[i].y - M.cy, parts[i].x - M.cx);
    }
    pOrder.sort((a, b) => pAng[a] - pAng[b]);

    /* 关键：形状的采样点数通常远多于粒子数（手 ≈3.2 万点 / 4600 颗粒子），
       必须按比例均匀抽，不能取前 n 个 —— 按角度排完序后取前 n 个，
       等于只用了「-180° 那一小段」，粒子会全挤在左上角。 */
    for (let k = 0; k < n; k++) {
      const p = parts[pOrder[k]];
      const ti = tOrder[Math.min(shape.n - 1, Math.floor((k * shape.n) / n))];
      p.nx = shape.pts[ti * 2];
      p.ny = shape.pts[ti * 2 + 1];
    }
    shapePts = shape;
  }

  /** 换形状的唯一入口：记住是哪个形状，再分配目标点 */
  function setShape(key, draw) {
    shapeKey = key;
    assign(sampleShape(key, draw));
  }

  /* ==========================================================================
     粒子池
     ========================================================================== */
  function buildParticles() {
    const n = clamp(Math.round((W * H) / 175), 2600, 6000);
    const arr = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.min(W, H) * (0.12 + Math.random() * 0.34);
      arr[i] = {
        x: W / 2 + Math.cos(a) * r,
        y: H * 0.44 + Math.sin(a) * r * 0.8,
        vx: 0, vy: 0, px: 0, py: 0,
        nx: Math.random() - 0.5, ny: Math.random() - 0.5,
        spread: Math.random(),                 // 0..1：往外多铺一点
        phase: Math.random() * Math.PI * 2,
        freq: 0.0007 + Math.random() * 0.0016,
        size: 1.25 + Math.random() * 1.35,      // 点大一点才聚成「形」，不然像撒了一把沙
        alpha: 0.40 + Math.random() * 0.48,
        accent: i % 29 === 0,
      };
    }
    return arr;
  }

  function resizeCanvas() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    cvs.style.width = W + 'px';
    cvs.style.height = H + 'px';
    ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ==========================================================================
     景深遮罩
     ========================================================================== */
  function applyDof(r) {
    const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)},${Math.round(r.r)},${W},${H}`;
    if (key === maskKey) return;
    maskKey = key;
    const soft = Math.round(clamp(Math.min(r.w, r.h) * 0.08, 10, 22));
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        `<defs>` +
          `<filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${soft}"/></filter>` +
          `<mask id="a" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">` +
            `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>` +
            `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${r.r}" fill="#000" filter="url(#s)"/>` +
          `</mask>` +
        `</defs><rect width="${W}" height="${H}" fill="#fff" mask="url(#a)"/></svg>`;
    const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
    dof.style.webkitMaskImage = url;
    dof.style.maskImage = url;
  }

  function measure(s) {
    let el = document.querySelector(s.sel);
    if (!el) return null;
    if (s.firstChild) el = el.firstElementChild || el;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    const pad = s.pad || 8;
    return {
      x: b.left - pad, y: b.top - pad,
      w: b.width + pad * 2, h: b.height + pad * 2,
      r: Math.min(16, (b.height + pad * 2) / 3),
      el,
    };
  }

  function ensureVisible(el) {
    const b = el.getBoundingClientRect();
    if (b.top < 80 || b.bottom > H - 110) {
      try { el.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' }); } catch { /* noop */ }
    }
  }

  /* ==========================================================================
     说明卡定位
     ========================================================================== */
  function placeCard(r, animate) {
    const cw = card.offsetWidth || 372;
    const ch = card.offsetHeight || 190;
    const gap = 30, m = 24;
    let left = clamp(r.x, m, W - cw - m);
    let top;
    const below = r.y + r.h + gap, above = r.y - ch - gap;
    if (below + ch <= H - m) top = below;
    else if (above >= m) top = above;
    else top = clamp(r.y + r.h / 2 - ch / 2, m, H - ch - m);

    const overlapY = top < r.y + r.h && top + ch > r.y;
    const overlapX = left < r.x + r.w && left + cw > r.x;
    if (overlapY && overlapX) {
      const right = r.x + r.w + gap, leftSide = r.x - cw - gap;
      if (right + cw <= W - m) left = right;
      else if (leftSide >= m) left = leftSide;
    }
    if (animate) {
      card.classList.add('is-anim');
      clearTimeout(placeCard._t);
      placeCard._t = setTimeout(() => card.classList.remove('is-anim'), 620);
    }
    card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  /* ==========================================================================
     每帧
     ========================================================================== */
  function frame(now, once) {
    if (!running) return;
    if (!once) raf = requestAnimationFrame(frame);
    const dt = lastT ? clamp(now - lastT, 0, 64) : 16.67;
    lastT = now;
    if (!parts.length) return;

    /* ---------- 两幕的矩阵不同 ---------- */
    let active = parts.length;
    let kx, ky, rot = 0, cx, cy, pivotX = 0, pivotY = 0, spreadAmp = 0.05, wobAmp = 2;

    if (mode === 'intro') {
      const since = now - introT0;
      const S = Math.min(W * 0.52, H * 0.66);
      kx = ky = S;
      cx = W / 2;
      cy = H * 0.43;
      if (shapeKey === 'hand') {
        // 挥手：绕手腕来回摆 3 次，2.6 秒内衰减收住
        const k = clamp((since - 260) / 2600, 0, 1);
        const env = Math.sin(k * Math.PI) ** 0.7;
        rot = Math.sin(since / 1000 * Math.PI * 2 * 1.15) * 0.17 * env;
        pivotX = 0.055;
        pivotY = 0.345;
      } else {
        // 脸：呼吸 + 眨眼 + 转睛
        const breath = 1 + Math.sin((now - introT0) / 1900) * 0.022;
        kx *= breath;
        ky *= breath * (face.blinkUntil > now ? 0.1 : 1);     // 眨眼 = 纵向压扁
        if (face.blinkUntil <= now && now > face.nextBlink) {
          face.blinkUntil = now + face.blinkDur;
          face.nextBlink = now + 2200 + Math.random() * 2400;
        }
        /* 鼠标动过就先看鼠标；两秒多没动才自己乱看 —— 这样「灵动」不是随机抽搐，
           而是有反应的。 */
        if (now - lastPointer > 2400 && now > face.nextGaze) {
          face.gazeTX = (Math.random() - 0.5) * 18;
          face.gazeTY = (Math.random() - 0.5) * 7;
          face.nextGaze = now + 1600 + Math.random() * 2200;
        }
        face.gazeX += (face.gazeTX - face.gazeX) * 0.06;
        face.gazeY += (face.gazeTY - face.gazeY) * 0.06;
        cx += face.gazeX;
        cy += face.gazeY;
        wobAmp = 1.1;
      }
      active = parts.length;
      bloomT0 = 0;
    } else {
      /* ---------- 指路：边框窗口 ---------- */
      /* 只更新景深窗口和卡片位置；归一化目标点不动 ——
         每 100ms 重新 assign 一次会让粒子自己重排，看着像在抖。 */
      if (now - lastMeasure > 100) {
        lastMeasure = now;
        const next = measure(STEPS[step]);
        if (next) {
          R = next;
          applyDof(R);
          placeCard(R, false);
        }
      }
      if (!R) return;
      const b = clamp((now - bloomT0) / 720, 0, 1);
      const bloom = 0.14 + 0.86 * (1 - Math.pow(1 - b, 3));
      kx = R.w * bloom;
      ky = R.h * bloom;
      cx = R.x + R.w / 2;
      cy = R.y + R.h / 2;
      active = Math.min(parts.length, Math.max(80, Math.round((R.w + R.h) * 2 / 5)));
      wobAmp = 2.6;
      spreadAmp = 0.05;
    }

    pivX += (pivotX - pivX) * 0.12;
    pivY += (pivotY - pivY) * 0.12;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const f = Math.min(2.5, dt / 16.67);

    ctx.clearRect(0, 0, W, H);

    /* 指路时先画那圈 1px 细线（「包裹」的壳） */
    if (mode === 'steps' && R) {
      ctx.beginPath();
      ctx.roundRect(R.x, R.y, R.w, R.h, Math.min(R.r, R.w / 2, R.h / 2));
      ctx.strokeStyle = `rgba(${INK}, 0.22)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /* 三档墨色 + 一档强调色：每颗粒子的 alpha 不一样，聚在一起才有厚薄，
       但只画 4 个批次 —— 逐颗改 fillStyle 会把帧率吃光。 */
    const inkPaths = [new Path2D(), new Path2D(), new Path2D()];
    const accPath = new Path2D();
    const trails = [];

    for (let i = 0; i < active; i++) {
      const p = parts[i];
      const nx = p.nx, ny = p.ny;

      const s = 1 + p.spread * spreadAmp * (mode === 'steps' ? 1 : 0.6);
      /* 绕枢轴旋转，再把枢轴加回去 —— 少了「加回去」这一步，
         整只手会被枢轴偏移顶到屏幕外面去（踩过）。 */
      const ox = nx - pivX, oy = ny - pivY;
      const rx = ox * cos - oy * sin + pivX;
      const ry = ox * sin + oy * cos + pivY;
      let tx = cx + rx * kx * s;
      let ty = cy + ry * ky * s;

      const wob = Math.sin(now * p.freq + p.phase) * (wobAmp * (0.5 + p.spread));
      tx += Math.cos(p.phase) * wob;
      ty += Math.sin(p.phase) * wob;

      const k = 0.13, damp = 0.78;
      /* 隔得远就直接落位：换形状时弹簧飞过会在半空留下残影 */
      if (once || (tx - p.x) ** 2 + (ty - p.y) ** 2 > 90000) {
        p.x = tx; p.y = ty; p.vx = 0; p.vy = 0;
      }
      p.px = p.x; p.py = p.y;
      p.vx += (tx - p.x) * k * f;
      p.vy += (ty - p.y) * k * f;
      p.vx *= Math.pow(damp, f);
      p.vy *= Math.pow(damp, f);
      p.x += p.vx * f;
      p.y += p.vy * f;

      if (mode === 'steps' && i % 9 === 0 && Math.hypot(p.x - p.px, p.y - p.py) < 26) {
        trails.push([p.px, p.py, p.x, p.y]);
      }
      if (p.accent) accPath.rect(p.x, p.y, p.size, p.size);
      else inkPaths[p.alpha < 0.58 ? 0 : p.alpha < 0.76 ? 1 : 2].rect(p.x, p.y, p.size, p.size);
    }

    if (trails.length) {
      ctx.strokeStyle = `rgba(${INK}, 0.07)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of trails) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
      ctx.stroke();
    }
    const tint = [0.34, 0.58, 0.84];
    for (let b = 0; b < 3; b++) {
      ctx.fillStyle = `rgba(${INK}, ${tint[b]})`;
      ctx.fill(inkPaths[b]);
    }
    ctx.fillStyle = `rgba(${ACCENT}, 0.82)`;
    ctx.fill(accPath);
  }

  /* ==========================================================================
     第一幕：打招呼
     ========================================================================== */
  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }
  const after = (ms, fn) => { timers.push(setTimeout(fn, ms)); };

  function enterIntro() {
    mode = 'intro';
    root.classList.add('is-intro');
    root.classList.remove('is-steps');
    card.classList.add('is-intro');
    card.style.transform = '';
    els.now.textContent = '01';
    els.total.textContent = String(STEPS.length).padStart(2, '0');
    els.title.textContent = 'hi，这里是 LIZI 播放器';
    els.desc.textContent = '你可以登录你的账号，听你喜欢的音乐。';
    els.next.textContent = '开始看看';
    els.skip.textContent = '跳过';
    els.hint.textContent = '';

    introT0 = performance.now();
    face.blinkUntil = 0;
    face.nextBlink = performance.now() + 1800;
    face.nextGaze = performance.now() + 900;
    face.gazeX = face.gazeY = face.gazeTX = face.gazeTY = 0;

    M.cx = W / 2;
    M.cy = H * 0.43;
    setShape('hand', SHAPES.hand);

    clearTimers();
    if (reduced.matches) {
      // 降级：不挥手、不换脸，直接把两句话和眼睛摆出来
      els.desc.classList.remove('is-hold');
      els.desc.classList.add('is-in');
      after(60, () => {
        setShape('eyes', SHAPES.eyes);
        if (running) frame(performance.now(), true);
      });
      return;
    }

    // 第二句比第一句晚 2.4 秒抬起来
    els.desc.classList.remove('is-in');
    els.desc.classList.add('is-hold');
    after(2400, () => {
      els.desc.classList.remove('is-hold');
      els.desc.classList.add('is-in');
    });
    // 手挥完就化开成一张脸
    after(4200, () => {
      if (mode !== 'intro') return;
      // 手 → 脸：归一化点整体换一套，枢轴由 pivX/pivY 缓动归零，不会跳
      setShape('eyes', SHAPES.eyes);
      face.blinkUntil = 0;
      face.nextBlink = performance.now() + 1500;
      face.nextGaze = performance.now() + 700;
    });
  }

  /* ==========================================================================
     第二幕：指路
     ========================================================================== */
  function paintStep() {
    const s = STEPS[step];
    els.now.textContent = String(step + 1).padStart(2, '0');
    els.total.textContent = String(STEPS.length).padStart(2, '0');
    els.title.textContent = s.title;
    els.desc.textContent = s.desc;
    els.next.textContent = step === STEPS.length - 1 ? '开始用' : '下一步';
    els.hint.textContent = '→ 下一步 · Esc 跳过';
    root.style.setProperty('--tour-progress', String((step + 1) / STEPS.length));
  }

  function enterSteps() {
    clearTimers();
    mode = 'steps';
    root.classList.remove('is-intro');
    root.classList.add('is-steps');
    card.classList.remove('is-intro');
    card.style.transform = 'translate3d(24px, 24px, 0)';
    els.skip.textContent = '跳过';
    go(0);
  }

  function go(i) {
    let k = i, r = null;
    while (k < STEPS.length) {
      r = measure(STEPS[k]);
      if (r) break;
      k++;
    }
    if (!r) return finish();
    step = k;
    paintStep();
    bloomT0 = performance.now();
    ensureVisible(r.el);
    R = r;
    M.cx = r.x + r.w / 2;
    M.cy = r.y + r.h / 2;
    ring = ringPoints(parts.length);
    applyDof(r);
    shapeKey = 'ring';
    assign(ring);
    card.offsetHeight;
    placeCard(r, true);
    lastMeasure = performance.now();
    if (reduced.matches) frame(performance.now(), true);
  }

  function next() {
    if (mode === 'intro') return enterSteps();
    if (step + 1 >= STEPS.length) return finish();
    go(step + 1);
  }

  function finish() {
    try { localStorage.setItem(KEY, '1'); } catch { /* 隐私模式 */ }
    close();
    const row = document.getElementById('set-tour');
    if (row) row.textContent = '已看过 · 可重看';
  }

  function close() {
    if (!root) return;
    running = false;
    mode = 'idle';
    cancelAnimationFrame(raf);
    clearTimers();
    root.classList.remove('is-on', 'is-intro', 'is-steps');
    card.classList.remove('is-intro');
    setTimeout(() => { if (!running) root.hidden = true; }, 460);
    try { els.next.blur(); } catch { /* noop */ }
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointer);
  }

  function onResize() {
    resizeCanvas();
    maskKey = '';
    if (mode === 'steps' && R) { applyDof(R); placeCard(R, false); }
    if (reduced.matches) frame(performance.now(), true);
  }

  /* 脸跟着鼠标看：位移小一点、带缓动，才像「注意你」而不是抽搐 */
  function onPointer(e) {
    if (!running || mode !== 'intro') return;
    lastPointer = performance.now();
    face.gazeTX = clamp((e.clientX - W / 2) / 46, -17, 17);
    face.gazeTY = clamp((e.clientY - H * 0.43) / 62, -10, 10);
  }

  function onKey(e) {
    if (!running) return;
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' && mode === 'steps') { e.preventDefault(); if (step > 0) go(step - 1); }
  }

  /* ==========================================================================
     打开 / 首次自动
     ========================================================================== */
  function open() {
    if (running) return;
    const setView = document.getElementById('view-settings');
    if (setView && setView.classList.contains('is-active')) {
      const back = document.getElementById('btn-settings');
      if (back) { back.click(); setTimeout(open, 560); return; }
    }
    if (!els) return;

    step = 0;
    lastT = 0;
    lastMeasure = 0;
    maskKey = '';
    R = null;
    resizeCanvas();
    parts = buildParticles();
    root.hidden = false;
    root.classList.add('is-on');
    running = true;
    enterIntro();

    requestAnimationFrame(() => {
      if (running && !reduced.matches) raf = requestAnimationFrame(frame);
      try { els.next.focus({ preventScroll: true }); } catch { /* noop */ }
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointer, { passive: true });
  }

  function maybeAutoStart() {
    let done = false;
    try { done = !!localStorage.getItem(KEY); } catch { done = false; }
    if (done) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      const me = document.querySelector('#hall-me .me-wrap') || document.querySelector('#hall-me *');
      if (me || ticks > 60) {
        clearInterval(timer);
        setTimeout(open, 900);
      }
    }, 250);
  }

  function init() {
    root = document.getElementById('tour');
    if (!root) return;
    dof = root.querySelector('.tour__dof');
    cvs = root.querySelector('.tour__fx');
    card = root.querySelector('.tour__card');
    els = {
      meta: root.querySelector('.tour__meta'),
      now: root.querySelector('.tour__now'),
      total: root.querySelector('.tour__total'),
      title: root.querySelector('.tour__title'),
      desc: root.querySelector('.tour__desc'),
      next: root.querySelector('#tour-next'),
      skip: root.querySelector('#tour-skip'),
      hint: root.querySelector('.tour__hint'),
    };
    if (!dof || !cvs || !card || !els.now || !els.next) return;

    els.next.addEventListener('click', (e) => { e.stopPropagation(); next(); });
    els.skip.addEventListener('click', (e) => { e.stopPropagation(); finish(); });

    const row = document.getElementById('row-tour');
    if (row) {
      let seen = false;
      try { seen = !!localStorage.getItem(KEY); } catch { /* noop */ }
      const val = document.getElementById('set-tour');
      if (val) val.textContent = seen ? '已看过 · 可重看' : '还没看过';
      row.addEventListener('click', () => open());
    }
    maybeAutoStart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  /* 临时调试口：只在 ?tourdebug 打开时挂上（查形状采样用） */
  if (location.search.includes('tourdebug')) {
    window.__T = {
      SHAPES, sampleShape,
      parts: () => parts,
      state: () => ({ mode, shapeKey, n: parts.length, M, W, H }),
      bbox: () => {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, nan = 0;
        for (const p of parts) {
          if (Number.isNaN(p.nx) || Number.isNaN(p.ny)) { nan++; continue; }
          x0 = Math.min(x0, p.nx); x1 = Math.max(x1, p.nx);
          y0 = Math.min(y0, p.ny); y1 = Math.max(y1, p.ny);
        }
        return { n: parts.length, x0, y0, x1, y1, nan };
      },
      dumpShape: (key) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 400;
        const g = cv.getContext('2d');
        g.fillStyle = '#eee'; g.fillRect(0, 0, 400, 400);
        g.save(); g.scale(2, 2); SHAPES[key](g); g.restore();
        return cv.toDataURL();
      },
    };
  }

  return { open, close, maybeAutoStart, get running() { return running; }, get step() { return step; }, get mode() { return mode; }, STEPS };
})();

window.LIZI_TOUR = LIZI_TOUR;

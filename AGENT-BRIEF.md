# 歌词可视化形态 · 开发交接说明

你在为一个「网易云音乐播放器」开发**歌词可视化形态**（项目里叫"形态"）。

每个形态是一个**独立的、自包含的 HTML 文件**，在 iframe 里全屏播放，随歌曲进度实时把歌词"演"出来。

已经有 10 个做好了（001-010）。你负责其中的一组（5 个），具体是哪 5 个见你的任务说明。

---

## 一、输出要求

写到 `E:\DSHdesktop\work\music-player\public\stages\` 目录，命名：

```
NNN-<你起的英文短名>-lyrics.html
```

例如 `011-plasma-lyrics.html`、`012-cave-lyrics.html`。

### 文件骨架

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>（中文名）</title>
<style>
  html,body{margin:0;height:100%;background:（你的背景色）;overflow:hidden}
  #c{position:fixed;inset:0;width:100%;height:100%;display:block}
  #hint{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);
        font:500 11px/1.5 ui-monospace,Consolas,monospace;
        color:rgba(...,.30);letter-spacing:.08em;pointer-events:none;transition:opacity .6s}
</style>
</head>
<body data-chrome="off">
<canvas id="c"></canvas>
<div id="hint">等待第一句…</div>
<script>
"use strict";
/* 开头写一段注释：这个形态的核心机制是什么、和已有 10 个的区别在哪 */
...
</script>
</body>
</html>
```

**两条硬规矩：**

1. **不要用 emoji**。要图标就用内联 SVG 或纯几何图形。
2. **不要引任何外部资源**（不要 CDN、不要字体文件、不要图片）。一个 canvas + 内联脚本。

---

## 二、与播放器的通信协议（照抄，不要改）

```js
/* ---- 与播放器通信 ---- */
const ping = () => { try { parent.postMessage({ __c100: 1, type: 'activity' }, '*'); } catch (_) {} };
addEventListener('pointermove', ping, { passive: true });
addEventListener('pointerdown', ping, { passive: true });
addEventListener('wheel', ping, { passive: true });
addEventListener('keydown', ping);
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    try { parent.postMessage({ __c100: 1, type: 'key', payload: { key: 'Space' } }, '*'); } catch (_) {}
  }
}, true);

addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__c100 !== 1) return;
  if (d.type === 'init') {
    const p = d.payload || {};
    lines = (p.lines || []).slice().sort((a, b) => a.t - b.t);
    curIdx = -1; brewIdx = -1; lastT = -1;
    /* p.accent 是从封面提取的主色 [r,g,b]，用它染色 */
    /* 这里清掉你所有的粒子/结构 */
    clockT = 0; clockAt = performance.now();
    hint.textContent = lines.length ? '等待第一句…' : '这首没有歌词';
    hint.style.opacity = lines.length ? '1' : '0.5';
  } else if (d.type === 'tick') {
    clockT = d.payload.time; clockAt = performance.now(); playing = !!d.payload.playing;
  } else if (d.type === 'beat') {
    /* 踩拍：必须**相干**（整场一起动），不要逐颗随机方向踢 */
  }
});
try { parent.postMessage({ __c100: 1, type: 'ready' }, '*'); } catch (_) {}
```

**协议要点：**

- `init`：`payload.lines` 是 `[{t, dur, text, chars}]`，`t` 是这句开唱的秒数
- `tick`：每 66ms 一次，`payload.time` 是当前播放秒数，`payload.playing` 是是否在播
- `beat`：踩拍事件，`payload.level` 是强度 0~1
- **焦点在 iframe 里时父页面收不到键盘事件**，所以 `activity` 和空格的转发是必须的（少了它，播放器的控制条一旦淡出就再也唤不醒）

---

## 三、节奏模块（照抄，把你的逻辑填进注释处）

```js
/* ================= 节奏：1-10 的教训固化在这里 =================
   ① 显示与酝酿分离 —— curIdx 只在句首切换，brewIdx 提前 lead 秒准备
   ② 索引单调不回退 —— 时钟在 tick 之间外推、tick 一来会往回缩一点，
      不锁单调的话句边界来回跳、同一句被反复重建
   ③ 提前量自适应 —— 快歌早开始，慢歌不提前太多
   ④ 只有拖进度条（时间明显倒退）才允许重置
   ================================================================ */
let curIdx = -1, brewIdx = -1, lastT = -1;
const LEAD = 1.3;
function timing(T) {
  if (!lines.length) return;
  if (T < lastT - 0.6) { curIdx = -1; brewIdx = -1; /* 清掉你的粒子/结构 */ }
  lastT = T;
  let ci = curIdx;
  while (ci + 1 < lines.length && T >= lines[ci + 1].t) ci++;
  if (ci !== curIdx) {
    curIdx = ci;
    brewIdx = -1;
    /* 显示切到第 ci 句。**同时把上一句占用的粒子释放回自由池** */
    hint.style.opacity = lines.length ? (ci >= 0 ? '0' : '1') : '0.5';
  }
  const nx = curIdx + 1;
  if (nx < lines.length && brewIdx !== nx) {
    const gap = lines[nx].t - (curIdx >= 0 ? lines[curIdx].t : lines[nx].t - 4);
    const lead = Math.min(LEAD, Math.max(0.45, gap * 0.55));
    if (T >= lines[nx].t - lead) { brewIdx = nx; /* 开始准备第 nx 句 */ }
  }
}

let clockT = 0, clockAt = 0, playing = false;
const now = () => clockT + (playing ? (performance.now() - clockAt) / 1000 : 0);
```

主循环长这样：

```js
let last = performance.now();
let t0 = 0;
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs; t0 += dt;
  const T = now();
  timing(T);
  /* 你的物理 + 绘制 */
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

---

## 四、字形采样（按需使用）

```js
const off = document.createElement('canvas');
const octx = off.getContext('2d', { willReadFrequently: true });

function glyphPoints(text) {
  const F = 96;                                  // 字号
  const maxW = Math.min(W * 0.8, 1300);
  octx.font = '800 ' + F + 'px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  let w = Math.ceil(octx.measureText(text).width) + 8;
  const fs = w > maxW ? F * (maxW / w) : F;
  octx.font = '800 ' + fs + 'px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  w = Math.ceil(octx.measureText(text).width) + 8;
  const h = Math.ceil(fs * 1.35);
  off.width = w; off.height = h;
  octx.clearRect(0, 0, w, h);
  octx.font = '800 ' + fs + 'px "PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillStyle = '#fff';
  octx.fillText(text, w / 2, h / 2);
  const d = octx.getImageData(0, 0, w, h).data;
  const pts = [];
  const step = 2;                                // 必须 ≤ 颗粒直径
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step)
      if (d[(y * w + x) * 4 + 3] > 128) pts.push(x - w / 2, y - h / 2);
  return { pts, w, h };                          // 坐标相对字形中心
}
```

**关键**：返回的点集是**按扫描顺序**的。分配给粒子时必须**等间隔取样**：

```js
const p = (Math.floor(k * pc / K) % pc) * 2;   // 对
const p = (k % pc) * 2;                        // 错 —— 字会被压扁成一条带
```

---

## 五、锚点（每句词落在屏幕哪里）

不要用 `Math.max/min` 夹取。用**归一化 + 按比例重映射**：

```js
const anchors = [];
for (let i = 0; i < 96; i++) {
  const g = i * 2.399963;
  const rr = 0.30 + 0.70 * (((i * 37) % 97) / 97);
  anchors.push({ nx: Math.cos(g) * rr, ny: Math.sin(g) * rr * 0.66 });
}
/** hw/hh = 字形半宽高，gcx/gcy = 字形中心 */
function placeAnchor(a, hw, hh, gcx, gcy) {
  const M = 60;
  const x0 = M + hw - gcx, x1 = W - M - hw - gcx;
  const y0 = M + hh - gcy, y1 = H - M - hh - gcy;
  return {
    x: x1 > x0 ? x0 + (a.nx * 0.5 + 0.5) * (x1 - x0) : W / 2 - gcx,
    y: y1 > y0 ? y0 + (a.ny * 0.5 + 0.5) * (y1 - y0) : H / 2 - gcy,
  };
}
```

也可以选择**固定居中** —— 有些机制（比如形变、螺旋）居中更好看，你自己判断。

---

## 六、必须避开的坑（1-10 全部踩过）

| # | 坑 | 后果 |
|---|---|---|
| ① | 用一个变量同时表示"显示哪句"和"准备哪句" | 下一句在自己开唱前 N 秒就把上一句顶掉（"没念完就切"） |
| ② | 索引不锁单调 | 句边界来回跳、同一句被反复重建（"每句显示两遍"） |
| ③ | 换句时不释放粒子池 | 池子被耗尽（003 曾经每三句的第三句少一半字） |
| ④ | 采样步长 > 颗粒直径 | 笔画是"点阵"不是实心 |
| ⑤ | 粒子数 < 采样点数 | 覆盖率不足，笔画是断的 |
| ⑥ | 按扫描顺序分配字形点 | 字被压扁成一条带 |
| ⑦ | 用 `Math.max/min` 把锚点硬夹回屏幕 | 散布塌掉、每行字挤在一起 |
| ⑧ | 渲染有缩放时没把缩放算进边距 | 字被上下截断 |
| ⑨ | 逐颗粒子拼 rgba 字符串赋给 `fillStyle` | 7000 次字符串构造 + CSS 颜色解析 → 18fps |
| ⑩ | 逐颗粒子 `beginPath/stroke` | 几千次绘制调用 → 掉到个位数帧率 |
| ⑪ | 逐帧 `createRadialGradient` | 很贵，改用**预渲染光斑图** + `drawImage` |
| ⑫ | 哨兵值写成"很久以后"（`1e9`） | `t - sentinel < 0.9` 永远成立（002 整块画布被刷成白色） |
| ⑬ | 踩拍时逐颗随机方向踢 | 字形散掉，且速度远超拖尾阈值、每拍全屏拖尾、整句糊掉 |
| ⑭ | 极坐标"多绕几圈"用了非整数圈 | 每颗粒子残留一个随机角度，合起来糊成圆环（009 踩过） |
| ⑮ | 沿路径跑时拖尾起点没夹在路径内 | 绕回起点时画出横跨整条路径的长线（006 踩过） |
| ⑯ | 网格加速时格子边长 = 影响半径 | 一格塞几百个点，几千万次检查/帧。正解是**距离场**（一次 BFS，之后 O(1)） |

### 性能目标

**60fps**（headless 软件渲染下的实测值）。如果掉到 40 以下，先查上面 ⑨⑩⑪⑯ 四条。

---

## 七、已经用掉的机制 —— 你的 5 个必须都和这些不同，而且彼此也不同

```
001 粒子流场聚字   粒子被吸到字形采样点，镜头在不同落点间移动
002 星际穿越       三槽位同时在场，相机沿 z 轴飞过一句句词
003 萤火虫光绘     光绘层累积辉光，字靠"长曝光显影"出来
004 沙粒重力堆积   沙从上方落到落点堆成字，唱完整堆塌掉
005 粒子原地重构   粒子沿直线滑到新字形，全程不散开
006 风之图         字形轮廓当轨道，粒子沿链跑；背景有流场并绕开文字
007 铁屑磁场       靠**朝向**显形，铁屑转向对齐笔画切向
008 静雪           雪碰到笔画就粘住（接触判定），三层视差，唱完被横风吹散
009 形态演化       粒子住在自转涡环上，沿对数螺线盘旋进去成字
010 余烬           火星从下往上升，经过字形带时驻留点亮，再被吹走
```

**可以借鉴的"机制词汇"**（但要用出你自己的组合）：吸引、排斥、绕流、距离场、轮廓轨道、朝向对齐、接触粘附、驻留、阵风、螺旋、分形递归、噪声场、干涉、元胞自动机、L 系统、傅里叶叠加、Voronoi、摩尔纹、字符化、翻牌、扫描线、故障位移、渐变遮罩、3D 投影……

---

## 八、验证

写完 5 个文件后，对每个文件跑一次语法检查：

```powershell
node -e "const fs=require('fs');const h=fs.readFileSync('文件绝对路径','utf8');const m=h.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);try{new Function(m[1]);console.log('OK')}catch(e){console.log('FAIL '+e.message)}"
```

**5 个都 OK 才算完成。** 语法不过就修到过为止。

---

## 九、绝对不要做的事

- ❌ **不要修改 `public/app.js`** —— 形态的注册由我统一做
- ❌ **不要动 `public/stages/001-010`** 的任何文件
- ❌ **不要启动或重启服务器** —— 现在跑在 1889 端口，别动它
- ❌ **不要用 `Get-Process node | Stop-Process`** —— 那会杀掉用户**其他项目**的 node 进程
- ❌ **不要跑浏览器测试** —— 慢且没必要，语法检查就够
- ❌ **不要修改 `E:\proiects\OPode\creative-100\` 里的任何文件** —— 那是用户的原始素材，只读

---

## 十、返回格式

用 JSON 返回：

- `files`：5 个文件，每个给出 `id`、绝对路径、**一句话说明核心机制**、语法是否通过
- `notes`：遇到的问题、你不确定的地方、需要我注意的事

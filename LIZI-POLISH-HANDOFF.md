# LIZI 第二批精修 · 新会话接手文档

> 你接手的是 `E:\DSHdesktop\work\music-player` 这个项目里的「lizi 粒子歌词特效」第二批（lizi51-lizi100）。
> 一句话现状：**50 个全部已构建、已注册、已过 checker**，但其中 **26 个是「旧机制 + 实体字覆盖层」的过渡版，视觉偏平**，
> 另外有 4 个还留着轻微重影。你的任务是把它们**精修到 lizi02「电蚀刻痕」那一档**：字有重量、有打光、有镜头。
> 用户的原话：「我要精修细改了」「效果不好的可以重新做一遍」。

---

## 0 先跑起来（30 秒）

```powershell
cd E:\DSHdesktop\work\music-player
Get-Content .port                      # 当前端口（现在 11701），一律以这个文件为准
# 服务没起的话（窗口/浏览器打不开）：
Start-Process node -ArgumentList "server.mjs" -WorkingDirectory "E:\DSHdesktop\work\music-player" -WindowStyle Hidden
# 打开应用窗口（二选一，用户要"看效果"时用这个）：
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process cmd -ArgumentList "/c","npm start" -WorkingDirectory "E:\DSHdesktop\work\music-player" -WindowStyle Hidden
```
浏览器逐条看：`http://127.0.0.1:<.port>/?stage=lizi54`

---

## 1 三种形态的代码结构（先认清，再动手）

| 类型 | 数量 | 编号 | 结构 |
|---|---|---|---|
| **v2 版**（我这轮重做/新建） | 24 | 53-57, 60, 62, 63, 65, 66, 68, 70, 71, 72, 74, 76, 78, 93-99 | `tools/mech/_v2-core.js`（渲染核心）+ `tools/v2/NN.js`（本形态物理）→ 由 `tools/lizi2.mjs` 拼成 `tools/mech/liziNN.js` |
| **覆盖层版**（10-27 旧机制） | 26 | 51, 52, 58, 59, 61, 64, 67, 69, 73, 75, 77, 79-92, 100 | 老 mech（110~130 行薄实现）+ 末尾追加的 `tools/v2/_overlay2.js`（实体字覆盖层） |
| 第一批 | 50 | lizi01-50 | 别动，用户已验收 |

### v2 核心给了什么（`_v2-core.js`）
- 实心三档笔画 `vBands()`（核心亮 / 中间 / 暗边）+ 暗影层（厚度）+ 光晕 + 预烘扫光贴图
- 3D 环绕（yaw/pitch + 透视 `s = f/(f+z)`）、逐字点亮 `charGlow`
- 粒子数组 `vx/vy/vz/vtx/vty/von/vlum/vsx/vsy/vss/vn`，颜色 `vCore/vMid/vDim`（按封面 `accent` 生成）
- 末尾 `/*__PHYSICS__*/` 槽位，被各形态的 `tools/v2/NN.js` 替换（物理文件只写
  `mechResize/mechAssign/mechUpdate/mechDraw/mechEvent`，60~90 行）

### 构建 / 验收 / 记账
```powershell
# 1) 改完物理文件后构建（v2 版）
node tools/lizi2.mjs NN <short> <中文名> tools/v2/NN.js --build
# 2) 只改了 mech 的覆盖层版：批量重建（标题从旧 html 读，安全）
node tools/rebuild-all.mjs
# 3) 验收（会重出 5 张截图；**--quiet 不出图**，看图时别加）
node lizi-check.mjs liziNN
#    001-100 那批是三位数编号，checker 现在也认（只有显式点名时才会进来）：
#      node lizi-check.mjs 013   → shots/lizi/013-ripple-lyrics-1..5.png
#    checker 会喂一张本机测试封面 public/_fx/cover-test.jpg（只有用到封面的形态才吃）
# 4) 必看截图（fps 过 ≠ 好看）
#    read_image shots/lizi/liziNN-<short>-3.png    稳定帧：整句能不能一眼读完
#    read_image shots/lizi/liziNN-<short>-2.png    中段帧：有没有物理过程
# 5) 记账（PLAN 打勾 + 进度行）
node tools/lizi-mark.mjs liziNN
# 6) 只有文件名/编号变了才需要重建注册表
node lizi-register.mjs      # 重写 public/app.js 的 STAGES
```

---

## 2 质量红线（用户的验收口径）

1. **整句一眼读完**：稳定帧 `-3.png` 里整行歌词能读；不缺笔画、不糊成团、不和背景同色。
2. **有重量/打光**：至少 3 档明暗 + 暗影或体积光，不是一片均匀点阵。
3. **有明显镜头运动**：3D 环绕/穿行/甩镜/变焦/视差，`-2` 与 `-3` 构图必须不同。
4. **有物理过程**：飞溅/湍流/生长/轨道/冷凝，中段帧看得出来。
5. **不双描**：换句旧粒子必须回收复用。
6. **fps ≥ 基线×0.88**、p95 ≤ 34ms、不贴边（checker 会给基线和 p95）。

三条最容易返工的坑（都真踩过）：
- 用 W/H 撒点的数组必须在 `mechResize()` 里初始化（顶层执行时 W=H=0，全堆在 (0,0) 且不报错）。
- 入场动画**不要绑在 `charGlow`（逐字点亮）上**，否则截图永远只有半句；用 `(T - lineT)/1.1` 这类时间驱动，
  `charGlow` 只负责亮度；未唱到的字也要可见（`vlum` 下限 ~0.55）。
- 装饰不能盖住字：蜂巢/地形/行星环那类"没有字"的形态，必须有一层实体字（学 `_overlay2.js` 的做法）。

---

## 3 逐形态清单（精修队列）

图例：**类型** v2 = 有物理文件可改；OV = 覆盖层版（机制是旧的）；**3D** ○无 ◐轻 ●强；**问题**来自实拍审图。

| 编号 | 短名 | 名称 | 类型 | 3D | 已知问题 / 建议 |
|---|---|---|---|---|---|
| 51 | relief | 立体浮雕 | OV | ◐ | 旧机制平贴、没有侧光；建议按 v2 重做（真 3D 挤出 + 掠射光） |
| 52 | aurora | 极光帷幕 | OV | ◐ | 原本是这批最好的，但字是点阵；覆盖层已叠实心字，检查是否双描 |
| 53 | kaleidoscope | 万花筒 | v2 | ○ | 中央正字可读，六重镜像已推到 2.25×；可再加强"镜片转动"的存在感 |
| 54 | tunnel | 粒子隧道 | v2 | ● | 已修好（12 层环 + 壁面字）；句尾偏暗已抬亮度，可再确认 |
| 55 | meteor | 陨石雨 | v2 | ◐ | 已重做（实体字 + 拖尾陨石）；可加落地冲击火星 |
| 56 | hourglass | 沙漏 | v2 | ○ | 沙漏本体偏弱、玻璃只有线框；建议加内发光 + 可见流沙 |
| 57 | liquid-metal | 液态金属 | v2 | ◐ | 已减噪点；金属镜面感还可以再强（高光带随镜头扫） |
| 58 | polar-storm | 极地风暴 | OV | ◐ | 旧机制：雪流把字冲散；建议重做（风眼 + 平静区里写字） |
| 59 | tornado | 龙卷风 | OV | ◐ | 旧机制：字被撕碎且偏上；重做或收字形 |
| 60 | coronal-loop | 日冕环 | v2 | ● | 已重做（弧在深度里）；可加磁力线细描边 |
| 61 | filaments | 星云丝 | OV | ◐ | 旧机制：丝太淡；重做 |
| 62 | honeycomb | 蜂巢 | v2 | ○ | 已重做（逐格点亮）；格网偏平，可给格子加厚度/内高光 |
| 63 | coral | 珊瑚生长 | v2 | ◐ | 已重做（枝状 + 白梢）；可加水流带走 |
| 64 | print | 粒子印刷 | OV | ○ | 旧机制；重做（墨辊压过 + 转印） |
| 65 | origami | 粒子折纸 | v2 | ◐ | 已重做（翻转三角面）；折面可加平涂色 + 折痕亮边 |
| 66 | maglev | 磁轨列车 | v2 | ○ | 已重做（拖尾收到 20px）；可加轨道金属高光 |
| 67 | raster | 光栅扫描 | OV | ○ | 旧机制：右端被裁、偏暗；重做 |
| 68 | terrain | 全息地形 | v2 | ● | 已重做（低空飞行 + 等高线）；fps 余量小（30~49），优化点密度 |
| 69 | hydrothermal | 深海热泉 | OV | ○ | 旧机制：字太暗；重做 |
| 70 | shatter | 玻璃破碎 | v2 | ● | 已重做（碎片 z 翻飞）；可加碎屑二次崩裂 |
| 71 | ringed | 行星环 | v2 | ● | 已重做（环 + 行星 + 实体字）；环粒子可再密 |
| 72 | slingshot | 引力弹弓 | v2 | ◐ | 昨晚重做（双曲线轨迹 + 行星）；可加被甩出的速度拉伸 |
| 73 | eclipse | 粒子日食 | OV | ◐ | 计划里原是"磁力线拱"，实际做成日食，PLAN 已改；覆盖层版，可重做 |
| 74 | rain-glass | 雨幕折射 | v2 | ◐ | 昨晚重做（雨丝 + 水珠 + 玻璃反光斜条）；珠子可以再虚一点 |
| 75 | spirograph | 拉花曲线 | OV | ○ | 旧机制：星点把字啃薄；重做 |
| 76 | fireflies | 萤火虫群 | v2 | ◐ | 昨晚重做（三级景深 + 同步闪）；可加聚合时的拖尾 |
| 77 | fiber | 光纤束 | OV | ○ | 旧机制：后半句缺失；重做 |
| 78 | plasma-globe | 等离子球 | v2 | ◐ | 昨晚重做（电弧 + 球壁）；电弧可加分形分叉 |
| 79 | loom | 粒子织机 | OV | ◐ | 覆盖层 + 旧字层，轻度重影 |
| 80 | cloud-sea | 云海 | OV | ◐ | 覆盖层版，机制平；云层可分层 |
| 81 | brush | 粒子书法 | OV | ○ | 覆盖层版；旧版笔锋偏等宽，建议重做（起笔/出锋） |
| 82 | pulsar | 脉冲星 | OV | ◐ | 覆盖层版；光束压字，注意亮度 |
| 83 | wind-chime | 风铃 | OV | ◐ | 覆盖层版（已能读）；挂线可加金属高光 |
| 84 | furnace | 熔炉 | OV | ◐ | 覆盖层版；炉栅可加自下而上暖光 |
| 85 | tidal | 粒子潮汐 | OV | ◐ | 覆盖层版，最干净的一个 |
| 86 | sandstorm | 沙暴 | OV | ◐ | **重影最重**；覆盖层暗片边界也被看出来 |
| 87 | electrofluid | 电流体 | OV | ◐ | **重影重** + 蓝色球飘离本体 |
| 88 | ice-float | 冰晶悬浮 | OV | ◐ | **重影重** + 像素化二次采样 |
| 89 | holo-cube | 全息立方 | OV | ● | **整词复制上移一个基线**（know 最明显） |
| 90 | fan | 折扇 | OV | ◐ | 重影：首词双份 |
| 91 | galaxy-collision | 星系碰撞 | OV | ◐ | **重影重**，say 带平移鬼影 |
| 92 | fountain | 粒子喷泉 | OV | ◐ | 轻度重影（don't 那一段双份） |
| 93 | echo | 回声 | v2 | ○ | 新做；波前是平面同心圆，可加反射墙 |
| 94 | constellation | 星座 | v2 | ● | 新做；连线偏细，可加连线流光 |
| 95 | bubble-column | 气泡柱 | v2 | ● | 新做；气泡可加折射高光 |
| 96 | avalanche | 雪崩 | v2 | ◐ | 新做；可加雪檐断裂的预告动作 |
| 97 | waterfall | 瀑布 | v2 | ○ | 新做；水帘可加横向抖动 |
| 98 | wireframe | 线框 | v2 | ● | 新做；线框可加等高线明暗 |
| 99 | feather | 羽毛 | v2 | ◐ | 新做；羽毛可加羽轴细线 |
| 100 | finale | 终章·星环 | OV | ● | 覆盖层版；环的缺口与字的关系可再设计 |

---

## 4 建议的精修顺序

**P0 · 先除重影（26 个覆盖层版，最难看的先做）**
86 → 87 → 88 → 89 → 91 → 90 → 79 → 81 → 82 → 85 → 92。
两种修法：
1. **快**：把该形态**自己画字那一层关掉**（在它的 `mechDraw` 里找 `for (…L.pc…)` / 自己那份点阵 batch，注释或加 `if (0)`），
   只留覆盖层；改完 `node tools/rebuild-all.mjs` + 看图。
2. **好**：直接按 v2 重做这个形态（写 `tools/v2/NN.js`），覆盖层就不需要了（重做后 `lizi2.mjs` 会把覆盖层冲掉）。

**P1 · 把"过渡版"升级成 v2（26 个里剩下的）**
51, 52, 58, 59, 61, 64, 67, 69, 73, 74(已 v2), 75, 77, 80, 83, 84 …每次挑"用户点名的"或"最平的"。

**P2 · 已有 v2 的微调（24 个）**
按各形态"已知问题"栏逐条改：加高光带、加二次动作、给 3D 类加轨道/环绕幅度。

**P3 · 统一性**
- 让 3D 类（54/68/71/98/60/70/94/95/99/100）的镜头运动幅度一致，看起来像一套；
- 平面类（53/56/62/66/93/97）至少给"视差层 + 弹簧变焦"，避免"静止图在闪"。

---

## 5 已踩过的坑（别重复）

1. **子代理会 `ran out of room`**：让它们"先写文件、再构建、最后看一眼图"，别让它们先读一堆文件。
   最稳：**主会话自己写物理文件**（60~90 行），子代理只做看图验收。同时最多 2 个。
2. **PowerShell 改代码会毁文件**：`$变量` 插值会把 `vlum` 变成 `llum`、`const` 变成 `oonst`、`von` 变成 `lon`。
   **改 js 只用 `write`/`edit` 工具**，别用 `.Replace()` 拼字符串。
3. `lizi-check.mjs --quiet` **不写截图**，要看图别加。
4. 机器上开着应用窗口时 checker 基线会掉到 40~50，判据是 `fps ≥ 基线×0.88`，不要拿绝对 60 当标准。
5. **`public/app.js` 是共享文件**：另一个"包工头"会话可能也在改它。注册前先看 `mtime`，写完立刻
   `Select-String -Path public\app.js -Pattern "id: 'lizi" | Measure-Object` 复核是不是 100 条；被覆盖就 `node lizi-register.mjs`。
6. 不要 `Stop-Process -Name node`、不要重启机器；端口一律读 `.port`。
7. 遗留垃圾：`tools/v2/55.old.js`、`tools/v2/71.old.js`、`tools/v2/m55.js`、`tools/v2/m71.js`、
   `tools/v2/_overlay.js`（rev1，已被 `_overlay2.js` 取代）、`public/app.js.bak-*` —— 可以删。

---

## 7 FX 特效库（10-28 新加）

**编号表在 `FX-LIBRARY.md`（FX01~FX66）—— 接需求时先看那张表，按编号调用，不要自己发明名字。**

- 试片台：`public/fx-lab.html` → `http://127.0.0.1:<.port>/fx-lab.html?fx=FX07`
  深链支持编号（`FX07`）也支持 id（`shake-sine`）；`←/→` 切换，顶部两个滑杆 = 强度/速度
- 编号规则：**按添加顺序固定，永不重排、永不复用**；新效果只能往末尾追加，追加后跑
  `node tools/gen-fx-doc.mjs` 重新生成 `FX-LIBRARY.md`（**别手改那张表**）
- 画质列的 `webgl` = Canvas 2D 只能近似（径向模糊、高斯、拉焦、毛玻璃、色差、CRT、色阶、色散、辉光、三棱镜、景深 共 11 个），
  要"剪映级"需要给舞台加 WebGL 后处理
- **鼓点/切句**标 ★ 的可以直接挂到 `onBeat / onDownbeat / onLineEnd`：
  每拍 FX10 竖向鼓点震、小节首拍 FX01 定向冲击震 + FX11 白闪、每 4 拍 FX06 爆震、切句 FX41-FX50

**待办**：规则表落地（`public/fx-presets.json`：形态默认 FX + 每句/每拍事件 FX）→ 播放页设置里做下拉面板 → 给 24 个 v2 形态各配一套默认。
鼓点检测本身还没升级（见 `HANDOFF.md` §8①，现 F1 0.229，Folia 低频版 0.918）。

## 8 现场状态（交接时）

- 服务：`node server.mjs` 在跑，端口 **11701**（HTTP 200），应用窗口已开（Electron）。
- `public/app.js`：STAGES **100 条**（lizi01-lizi100），`node --check` 通过。
- `public/stages/`：100 个 lizi html（含 `_wip-lizi05-ferrofluid.html` 不注册的旧文件）。
- `LIZI-PLAN.md`：51-100 全部 ✅，进度行写明"21 个重做/新建 + 29 个覆盖层"。
- 截图：`shots/lizi/` 每个形态 5 张，最新一轮是 10-28 凌晨。
- 相关文档：`LIZI-V2-SHORT.md`（一页纸规格）、`LIZI-V2.md`（完整规格）、`LIZI-NIGHT.md`（昨夜技术记录）、
  `LIZI-BRIEF.md`（老开发手册，基础协议/性能铁律仍有效）。

## 9 10-28 下午 · 016 极光 修复 + 精修（已验收）

`public/stages/016-aurora-lyrics.html`（WebGL 形态，**黑屏** → 已修好并重做渲染层）。
三处真 bug，别的 WebGL 形态也可能有同类，遇到先查这三点：

1. **着色器里 `smoothstep(大, 小, x)` 边沿写反 = UB**。SwiftShader 返回 NaN，经 RGBA8 转换后**整屏纯白**。
   写成 `1.0 - smoothstep(小, 大, x)`。
2. **`vec2 sky = mix(vec3(...), vec3(...), t)` 维度不匹配** → 星星 program 链接失败 → 整屏黑。
   编译错误只进 `console.error`，`lizi-check.mjs` **抓不到**（它只收 exceptionThrown / Log.error）。
3. **顶点缓冲按"条数"算 float，但每条条带是 6 顶点 × 7~8 float**：`aurCap*7` 只能装 500 条却按 3000 条 draw，
   WebGL 越界 draw 直接 INVALID_OPERATION 丢弃 → 一帧极光都画不出来（不报错）。

精修后结构（丁达尔版，10-28 晚按用户要求重做）：星空+光柱 → fboA → 字形层（叠上去）→ 模糊 → fboB → 合成。

- **不再有"一片片帘子"**。一束**丁达尔光从右上角**斜射下来：屏幕空间以光源为原点的
  放射光轴（`ang*64` 细光束 + 每束用噪声给不同粗细 + 尘埃扰动 + 距离衰减 + 扇面朝向歌词）；
- 歌词固定居中（`W/2, 0.52H`），**一开始是暗的**（`on = 0.18`）；按 YRC 逐字点亮，
  点亮瞬间 `hot` 冲一下 + 5 点膨胀出的光晕 + 泛光，唱过的字停在"亮着"的状态；
- **斗转星移**：不是持续转，是**句尾转一段然后停住**。`starTarget += 0.22`（只累加），
  `starAngle` 缓动追上去 —— 永远从当前位置继续转，不会弹回原位；
  星点沿转动切向做 3 抽样拖尾，拖尾长度跟"当前角速度"走，停下就收短；
- 实测：fps 43~60、p95 ~26ms（1440×810 / SwiftShader），`node lizi-check.mjs 016` 全绿。

改观感主要动这几处：`FS_MASK` 的 `on/hot/halo`（暗度、点亮冲击、光晕）、
`FS_SKY` 里 `spoke/fall/sector`（光柱粗细/衰减/朝向）、`u_light`（光源位置，默认 1.16,1.20 屏幕外右上）、
`FS_COMP` 的 `b*1.05`（泛光）、`timing()` 里的 `starTarget += 0.22`（每句转多少）。

探针工具：`node _glprobe.mjs 016-aurora-lyrics.html` —— 吐着色器链接状态、`__stage()`、fboA 回读亮度、控制台日志，
排查 WebGL 形态黑屏先跑它（默认帧缓冲合成后会被清空，不要直接 readPixels）。


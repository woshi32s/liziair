# player-bar-next —— 「光河」底部播放状态栏

这不是旧播放条的换皮。新栏把整条底栏变成一条可以抓取、拖动、点击的**光河**，
播放/暂停、切歌、拖进度、音量、展开唱片卡都换成了新的操作模型；旧 `footer.player`
只被隐藏，DOM 和 `app.js` 里的事件原样保留。

- 入口：`public/index.html` 里只有一行 `<script src="player-bar-next/player-bar-next.js" defer></script>`
- 样式：`player-bar-next.css`，由脚本按自身 `src` 计算路径后插入 `<link data-pbn-next>`
- 依赖：只读全局 `Player`（`Player.*` / `Player.on(...)`），**没有改 app.js / app.css / player.js**
- 回退：地址加 `?oldbar=1` 时脚本直接 `return`，不挂新栏

---

## 1. 用了哪些 ReactBits 组件，各自负责什么

源码按 <https://github.com/DavidHDev/react-bits> 实际实现读过后移植成原生
Canvas / WebGL2 / CSS，不是截图或预录动画。

| 组件 | ReactBits 页面 | 在新交互里的职责 |
|---|---|---|
| **Aurora** | <https://www.reactbits.dev/backgrounds/aurora> | 光河的底层。全宽 WebGL2 片元着色器：simplex 噪声、三层色带、指针 reach、reveal、dither。拖动时河面流向跟着进度相位走，颜色来自当前封面。播放时缓慢流动，暂停时几乎静止。 |
| **Particles** | <https://www.reactbits.dev/backgrounds/particles> | 河里的悬浮微粒。有深度、上下 bob、twinkle；指针靠近时被斥力推开；拖动松手会从落点扩散一圈冲击波。粒子亮度受播放状态和指针影响，用来提示“这条河是活的、可以碰”。 |
| **Magnet** | <https://www.reactbits.dev/animations/magnet> | 弹簧物理（stiffness 170 / damping 16 / mass 1 + smoothstep reach）。上一首/下一首光球、进度光点、唱片卡倾斜都用它：指针靠近时被吸过去，离开后弹回。 |
| **ClickSpark** | <https://www.reactbits.dev/animations/click-spark> | 点击与拖动松手时的线状火花（ease-out、带轻微辉光）。轻点河面播放/暂停、松手完成 seek、点按钮时触发，是操作反馈而不是装饰。 |
| **SpotlightCard** | <https://www.reactbits.dev/components/spotlight-card> | 唱片卡上的跟随光斑 + 边缘辉光 + 颗粒。光斑跟着指针在卡片表面移动，用来把注意力引到封面和歌词。 |
| **StarBorder** | <https://www.reactbits.dev/animations/star-border> | 唱片卡圆角边框按周长参数化，彗星沿边框跑。展开卡片时星轨加速，收起后停下；播放时保持缓慢巡航。 |

> `prefers-reduced-motion` 下 Aurora 只画静态帧、粒子与星轨不跑、火花不生成，
> 所有 CSS 动画/过渡压到 0.001ms。

---

## 2. 完整操作表

### 常态光河

| 操作 | 结果 |
|---|---|
| 鼠标悬停 / Tab 聚焦 | 底栏从 92px 长到 126px，河面变亮，右侧音量弧带可展开 |
| 轻点河面任意位置（位移 < 7px） | 播放 / 暂停，落点爆一圈火花 |
| 在河面上水平拖动 | 实时 seek：时间气泡跟着走，光点跟手，每 150ms 向 `Player.seek()` 提交一次；松手补一次最终 seek + 涟漪 |
| 在河面上向上拖 > 28px（纵向为主） | 展开唱片卡（不用先找按钮） |
| 在河面上向下拖 | 不触发任何动作（避免误触播放/暂停） |
| 点左侧封面 / 右侧把手 | 展开 / 收起唱片卡 |
| 点上一首 / 下一首光球 | `Player.prev()` / `Player.next()`；光球有磁吸位移和火花 |
| 点播放模式胶囊 | `Player.cycleMode()`，图标与文字同步（顺序 / 列表 / 单曲 / 随机） |
| 在音量按钮上上下拖 | 调整音量（150px 对应 0→100%），弧带实时亮起 |
| 单击音量按钮 | 静音 / 取消静音（图标切换） |
| 滚轮/触摸左右滑 | 不劫持页面滚动；仅指针拖拽 seek |

### 进度条键盘（`role="slider"`，Tab 可聚焦）

| 键 | 结果 |
|---|---|
| `←` / `→` / `↑` / `↓` | ±5 秒 |
| `Shift` + 方向键 | ±15 秒 |
| `PageUp` / `PageDown` | ±10% 时长 |
| `Home` / `End` | 跳到开头 / 结尾 |

音量按钮与卡片音量滑块：方向键 ±5%，`Home`/`End` 到 0/100%，
音量按钮上 `Enter`/`Space` 静音。

### 唱片卡（从右上方浮出）

| 操作 | 结果 |
|---|---|
| 点卡片封面 | 播放 / 暂停 |
| 卡片歌词区 | 当前句、翻译、下一句；随 `lyric` 事件滚动高亮 |
| 卡片音量滑块 / 静音键 | 与主音量同一份状态 |
| 「打开播放页」 | 复用隐藏的 `#btn-open-now`，进入 `#view-now` |
| `Esc` / 点卡片外 / 右上角 × | 收起卡片 |
| 卡片内滚动（窄屏/矮屏） | `touch-action: pan-y`，卡片自身可纵向滚动 |

全局键盘：`Space` 仍由 `app.js` 处理播放/暂停；新栏展开时 `Esc` 由新栏捕获先收卡片。

### 显示范围

- 显示：大厅、浏览、实验室、歌手、专辑、音效、我的专辑等主视图
- 隐藏：`body.is-now`（播放页）、`body.is-stage`（形态页）、`data-view="settings"`（设置整页）
- 设置页隐藏时同时把 `--player-h` 归零，不会在页面底部留 92px 空白

旧栏在所有视图都是 `display:none` + `inert` + `aria-hidden="true"`，不会和新栏抢焦点。

---

## 3. 形态、尺寸与动画

| 项 | 值 |
|---|---|
| 桌面常态 | 92px 高，固定 `bottom: 0`，`z-index: 70` |
| 悬停 / 键盘聚焦 / 展开 | 126px（`height .38s cubic-bezier(.2,.82,.2,1)`） |
| ≤900px | 100px，两行网格：上行封面/标题 + 控件，下行时间与光河 |
| ≤560px | 42px 封面、隐藏把手与徽标，卡片单列缩到 88px 封面 |
| 布局让位 | `body.pbn-on { --player-h: 92px + safe-area }`，视图仍用原来的 `bottom: var(--player-h)` |
| 光河 | WebGL2 全宽画布 + 2D 粒子画布 + 顶部/底部 mask；DPR 上限 2（窄屏 1.5） |
| 唱片卡 | `min(452px, 100vw - 32px)`，右对齐，`perspective: 1000px`，从 `translateY(16px) scale(.965)` 浮出 |
| 安全区 | 高度与内边距都加 `env(safe-area-inset-bottom)` |
| 性能 | 只在可见、未隐藏、有交互或播放时跑 rAF；指针离开/页面隐藏/非光河视图自动停；文本与 aria 值按帧缓存，避免每帧写 DOM |

减少动态（`prefers-reduced-motion: reduce`）：
Aurora 静态帧、粒子/星轨/火花关闭、卡片倾斜与磁吸关闭、所有过渡与旋转动画停止；
布局、进度、音量、键盘操作不受影响。

---

## 4. 和 Player 事件怎么同步

新栏只订阅，不反向改播放器状态：

| 事件 | 新栏反应 |
|---|---|
| `trackchange` | 更新标题/歌手/专辑/封面（条内 + 卡片）、重置进度、按封面 URL 取色（命中 `Player.extractColors` 缓存则直接复用），重绘 Aurora 调色板 |
| `playstate` | `data-playing`、播放/暂停图标、状态文字（播放中/已暂停/待播放），唤醒或停住粒子、唱片旋转 |
| `time` | 更新目标进度与时间；拖动中或松手后的 320ms 锁定期忽略旧 `timeupdate`，避免光点回跳；显示值用缓动追目标 |
| `buffer` | 更新缓冲条宽度 |
| `mode` | 模式图标、中文标签、卡片 kicker，与 `localStorage.playMode` 一起由原逻辑维护 |
| `lyric` | 当前句 / 翻译 / 下一句，卡片内滚动高亮 |
| `source` | demo / 预览源时更新状态徽标与副标题 |
| `sourceerror` | 徽标显示「无法播放」并给出 title 提示 |

初始化时还会主动读 `Player.state.mode / playing / lyric / lyricIndex`、
`Player.volume`、`Player.audio.muted / duration / currentTime`，所以刷新页面后新栏
第一帧就是正确状态，不依赖先触发一次事件。

所有动作都走 `Player.toggle() / prev() / next() / seek(sec) / setVolume(v) / cycleMode()`；
「打开播放页」点的是 app.js 已有的 `#btn-open-now`，不新增路由逻辑。

---

## 5. 回退与文件边界

- **`?oldbar=1`**：`player-bar-next.js` 第 23–24 行直接返回，不插样式、不挂 DOM，
  旧 `footer.player` 完全按原样工作。刷新去掉参数即恢复新栏。
- 新栏代码只在 `public/player-bar-next/`：`player-bar-next.js`、`player-bar-next.css`、本 README。
- `public/index.html` 只加了那一行 `<script>`。
- 未改：`app.js`、`app.css`、`player.js`、`beat.js`、`audio/**`、`hall/**`、`pet/**`、
  `onboard-intro/**`、`tools/**`、`services/**`、`server.mjs`、`stages/**`。
- 初始化抛错时会自动回滚：移除 `body.pbn-on`、删掉 `#pbn`、恢复旧栏的
  `aria-hidden` / `inert`，不会让用户失去播放条。

---

## 6. 用户验收步骤（刷新即可，不用重启服务）

1. 打开 `http://localhost:11407/`，大厅底部应出现 92px 光河，旧播放条消失。
2. 鼠标悬停底栏：高度到 126px，河面变亮，右侧音量弧带出现。
3. 在河面空白处轻点：播放/暂停；水平拖动：气泡显示 `当前时间 / 总时长`，光点跟手，松手后进度停在新位置。
4. 点上一首/下一首光球、模式胶囊、音量按钮上下拖、单击静音，逐项对照。
5. 点封面或向上拖河面：唱片卡浮出，检查封面、歌词、卡片音量、「打开播放页」、`Esc`/点外部收起。
6. 用 Tab 走到进度条：方向键/Shift/PageUp/PageDown/Home/End 是否按表工作。
7. 进播放页 / 形态页 / 设置页：新栏应隐藏；返回大厅应恢复；设置页底部不应留空白条。
8. 地址加 `?oldbar=1`：应回到旧播放条；去掉参数刷新恢复。
9. 系统开启「减少动态效果」后刷新：动画停止，但所有操作和显示仍正常。
10. 窗口缩到 ≤900px、≤560px，或 DevTools 手机视图：两行布局可用，卡片不溢出，安全区不遮挡。

---

## 7. 第一版没做的部分（已知边界）

- 没有在新栏里做播放队列/列表弹层，队列仍走原页面入口。
- 拖拽 seek 只有水平拖动，没有惯性甩动、按住加速、双指手势。
- 唱片卡歌词只展示，不可点某一句跳转（播放页原有能力未搬过来）。
- 新旧两套 UI 没有共享的「形变」过渡：切换视图时是隐藏/显示，不是同一 DOM 变形。
- WebGL2 不可用时回退到 CSS 渐变河面，不是完整 Aurora。
- 未做手动主题/配色选择，颜色完全跟随封面自动提取。
- 未在真实手机、Safari、低端 GPU 上跑过回归（按要求没有自测/截图，等待验收）。

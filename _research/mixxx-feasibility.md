# 把 Mixxx 作为「工具」接入 LIZI 播放器 —— 可行性调研

> 调研日期：2026-10-26 ｜ 本机环境：Windows x64，Mixxx **2.5.6 x64**（`C:\Program Files\Mixxx`），Electron **33.4.11**
> 调研方式：本机安装体反查（exe 字符串 / 官方 mapping / 运行时日志 / SQLite 库结构）+ Mixxx 官方文档与源码原文 + 在本机 Electron 里实跑能力探针
> **本文只做调研，未修改 LIZI / Folia / Mixxx 任何文件；所有下载物落在 `%TEMP%\mixxx-research`。**

---

## 一句话结论

**Mixxx 无法被"嵌进"LIZI，只能被"遥控"。** 它是一个独立的 Qt6/C++ 原生应用，**没有任何 HTTP/JSON/WebSocket/DBus/本地 socket 接口，2.5.6 也完全不支持 OSC**；唯一可用的双向外部接口是 **MIDI**（Mixxx 既收也发）。所以「Mixxx 作为 LIZI 里的一个工具」只有两条真实路径：**(A) LIZI 用 Web MIDI 当遥控器 + Mixxx 独立窗口**（工程量中等、必须装虚拟 MIDI 线），或 **(D) 干脆不用 Mixxx，在 LIZI 内用 Web Audio 自己实现双轨 DJ 台**（工程量最大但体验最"像一个工具"，且零外部依赖）。**C（复用 Mixxx 引擎库/编 Node 插件）不可行**，**B（Win32 把 Mixxx 窗口塞进 Electron）技术上能塞但工程上不可接受**。

---

## 0. 本机基线事实（后续判断都建立在这些实测上）

| 项 | 实测值 | 意义 |
|---|---|---|
| Mixxx 安装 | `C:\Program Files\Mixxx\mixxx.exe`，FileVersion **2.5.6 x64**，3585 个文件 / 343.8 MB | 是完整发行版，含 `mixxx.pdb`（带符号，说明是官方 CI 构建） |
| 应用形态 | `Qt6Core/Qt6Gui/Qt6Widgets/Qt6Qml/Qt6Quick` + `portaudio.dll`/`portmidi.dll`/`hidapi.dll` + `avcodec-60.dll`/`mpg123.dll`/`libmp3lame`/`fdk-aac`/`rubberband-2`/`SoundTouch` | **原生 C++/Qt 应用**，音频解码与变速都是原生库，不是 Web 技术栈 |
| 打包的 Qt 模块 | 无 `Qt6WebEngine*`、无 `Qt6WebSockets`、无 `Qt6DBus` | 既不能内嵌网页 UI，也没有现成的 socket/DBus 通道 |
| 用户数据目录 | `C:\Users\86186\AppData\Local\Mixxx\`（`mixxx.cfg`、`mixxxdb.sqlite`、`soundconfig.xml`、`controllers\`、`effects\`） | 库是 **SQLite**，配置是 **ini**，都可外部读写 |
| 当前音频配置 | `soundconfig.xml`：api=**ASIO**，device=**ASIO4ALL v2**，4 decks，44100 Hz，latency 5 ms，2 buffers | ⚠️ ASIO 常是**独占**的，这是个真实风险（见 §4） |
| 运行时日志 | `mixxx.log` 明示：`Creating ControllerManager`、`Scanning PortMIDI devices` / `HSS1394` / `USB Bulk` / `USB HID` | 控制器子系统是唯一对外通道，共 4 种枚举器 |
| 已装 MIDI/虚拟音频 | `Drivers32` 只有系统自带 `wdmaud.drv`；未装 loopMIDI / rtpMIDI / VB-Cable / Voicemeeter | **虚拟 MIDI 线与虚拟声卡都得用户自己装** |
| 系统 MIDI 端口 | `Microsoft MIDI Mapper`、`Microsoft GS Wavetable Synth`（日志"Found output device #0/#1"） | Windows 原生**没有**可用的软件环回 MIDI 端口 |
| Electron 探针结果 | 在 `http://127.0.0.1`（安全上下文）下：`hasMidi=true`、`midiOk=true`、`sysexEnabled=true`、`hasSetSinkId=true` | ✅ **LIZI 现有 Electron 33 直接能用 Web MIDI 和音频设备路由，不需要任何原生模块** |

> 探针细节：同一份代码在 `data:` URL 下 `navigator.requestMIDIAccess` **不存在**（非安全上下文），换成 `http://127.0.0.1:随机端口` 后立刻可用，并枚举出真实端口 `Donner Livejack MIDI In/Out`。LIZI 正是从 `127.0.0.1` 提供页面（`server.mjs`），所以这条能力**现成可用**。

---

## 1. Mixxx 的接口能力清单（哪些能读状态、哪些能下命令）

### 1.1 总表

| 接口 | 存在？ | 能读状态 | 能下命令 | 证据 |
|---|---|---|---|---|
| **MIDI**（PortMIDI / HID / Bulk） | ✅ **唯一成熟的双向通道** | ✅ LED/旋钮回传 | ✅ 全量 Control Object | `midi-controller-api.d.ts`、`engine-api.d.ts`、`controllermanager.cpp` |
| **OSC** | ❌ **完全没有** | — | — | 2.5 命令行文档无 OSC 选项；`CHANGELOG.md` 全文（含未发布的 2.6/2.7）**0 处** "OSC"；exe 内所有 `osc` 命中都是 `oscillator`/`PlayPosColor`，无 oscpack |
| **JSON / HTTP / WebSocket API** | ❌ | — | — | exe 内无 `QTcpServer`/`QWebSocketServer`；未打包 `Qt6WebSockets` |
| **DBus** | ❌ | — | — | exe 内 `dbus` 命中 **0**（连 Windows 版也没有） |
| **本地 socket / 命名管道** | ❌ | — | — | exe 内无 `QLocalServer`/`QLocalSocket`；源码里无单实例检测（不存在"已有一个实例在跑就转交参数"的机制） |
| **命令行** | ✅ 但仅启动期 | ❌ | ⚠️ 只能**启动时**塞文件/开 AutoDJ | `src/util/cmdlineargs.cpp` L493 `m_musicFiles = parser.positionalArguments()` |
| **SQLite 库文件** | ✅ 但**离线** | ✅ 可直接 SELECT | ⚠️ 直接 INSERT，Mixxx 运行中写有风险 | `mixxxdb.sqlite` 实测含 `library`/`track_locations`/`Playlists`/`PlaylistTracks`/`crates`/`track_analysis` |
| **配置文件**（`.cfg`/`.midi.xml`/`.kbd.cfg`/`effects/chains`） | ✅ 离线 | ✅ | ✅ 但需重启 Mixxx | `%LOCALAPPDATA%\Mixxx\` |
| **Icecast/Shoutcast 推流** | ✅ **反向**输出 | — | — | `livebroadcasting.rst`：支持 Icecast 1/2、Shoutcast 1/2 |
| **引擎 C++ API / SDK** | ❌ 无公开 ABI | — | — | 单体 `mixxx` target，无独立 engine 库；接口随版本变动 |

### 1.2 命令行：真实存在的选项（逐条核对 2.5.6 二进制 + 官方文档）

**A. 官方文档正式列出的选项**（`commandline_dev_tools.rst` 原文逐条）：

```
--resource-path PATH            --start-autodj
--settings-path PATH            --enable-legacy-vumeter
--enable-legacy-spinny          --controller-debug
--controller-abort-on-warning   --developer
--stats                         --safe-mode
--color <auto|always|never>     --locale LOCALE
-f, --full-screen               --log-level LEVEL
--log-flush-level LEVEL         --debug-assert-break
-h, --help
```

**B. 二进制里存在、但文档未列出的**（2.5.6 选项表的实际内容，实测解出）：
`--qml`（改用实验性 QML GUI，替代 QWidget 皮肤）、`--style`、`--level`、`--log-max-file-size`、`--timeline-path`、`--help-all`，以及 `--midiDebug`（`--controller-debug` 的别名）。

**要点（直接影响你的三个疑问）：**

1. **`--midiDebug` 不是文档里的名字**，它是 `--controller-debug` 的**遗留别名**（二进制里两者相邻且指向同一选项）。它在文档中的定义是"记录 Mixxx 收发**全部**控制器数据以及加载的脚本函数"——注意这是**写日志**，不是给你一个可订阅的数据流。抓状态只能靠读 `mixxx.log`（本机该文件已有 628 KB，会滚动）。
2. **`--controller` 不存在**。只有 `--controller-debug` 和 `--controller-abort-on-warning`。
3. **`--start-autodj` 存在**——这是外部让 Mixxx 一起就自动混音的唯一开关，但它需要 AutoDJ 队列里**事先已有曲目**（见 1.4，外部填队列很受限）。
4. **位置参数（音乐文件）真的会加载进 deck**：文档明说"Each file you specify will be loaded into the next virtual deck"，源码 `cmdlineargs.cpp` L493 把 `parser.positionalArguments()` 直接收进 `m_musicFiles`。**这是"外部把指定曲目送进 Mixxx"唯一可靠、且有官方文档背书的路径。**

### 1.3 MIDI 是双向的：能读什么、能写什么

Mixxx 的控制器脚本 API（随安装包发布的 `.d.ts` 就是权威定义）：

```js
// controllers/engine-api.d.ts —— 读写 CO + 订阅
function getValue(group, name): number;
function setValue(group, name, newValue): void;
function getParameter(group, name): number;
function setParameter(group, name, newValue): void;
function makeConnection(group, name, callback): ScriptConnection;   // 推送式订阅
function makeUnbufferedConnection(group, name, callback): ScriptConnection;
function trigger(group, name): void;
function connectControl(group, name, callback, disconnect?): void;  // 旧名别名，随包脚本里用的是它

// controllers/midi-controller-api.d.ts —— 往硬件发字节（= 回传给遥控端）
function sendShortMsg(status, byte1, byte2): void;
function sendSysexMsg(dataList, length?): void;
```

> 回传是**真的在实际使用**：`Wireless-DJ-scripts.js` L19–47 用 `engine.connectControl` 订阅 `vu_meter`/`rate`/`volume`/`filter*`/`crossfader`，再在 L99–172 用 `midi.sendShortMsg` 把它们编成 CC/Note 发出去。**这就是 LIZI 侧要照抄的范式**（把"发回 iPad"换成"发回 LIZI"）。

**能读（`getValue` / `makeConnection` 推送）**——这些足以让 LIZI 画出真实状态：

| Control Object | 含义 | 文档行 |
|---|---|---|
| `[ChannelN],play` / `play_indicator` | 是否在放 | controls.rst L2528 / L2540 |
| `[ChannelN],playposition` | 播放位置（0~1，**不是秒**，要乘 `duration`） | L2576 |
| `[ChannelN],duration` | 曲长（秒） | L1405 |
| `[ChannelN],bpm` / `file_bpm` / `local_bpm` | 当前/文件/局部 BPM | L1081 / L1450 / L1999 |
| `[ChannelN],track_loaded` | 该 deck 有没有歌 | L3113 |
| `[ChannelN],beat_active` | 拍点脉冲（做可视化同步用） | L583 |
| `[ChannelN],file_key` | 调性 | L1460 |
| `[Main],vu_meter_left/right`、`[ChannelN],vu_meter` | 电平 | Wireless-DJ 脚本实例 |
| `[Master],crossfader` | 交叉推子位置 | 同上 |
| `[AutoDJ],enabled` | AutoDJ 开关状态 | L3704 |

**能写（`setValue` / `trigger`）**：

| Control Object | 动作 | 备注 |
|---|---|---|
| `[ChannelN],play` / `start` / `start_stop` / `start_play` | 播放控制 | L2528 / L2987 |
| `[ChannelN],volume` / `rate` / `filterLow/Mid/High` | 推子、变速、EQ | Wireless-DJ mapping 实证 |
| `[Master],crossfader` | 交叉推子 | |
| `[ChannelN],LoadSelectedTrack` / `LoadSelectedTrackAndPlay` | 加载**当前高亮**曲目 | ⚠️ "高亮"= 库里的选中行，外部无法指定行 |
| `[ChannelN],LoadTrackFromDeck` | **deck→deck 复制**（2.4+） | L1217，把某 deck 的歌直接搬到另一 deck |
| `[Library],MoveUp/MoveDown/MoveVertical`、`[Library],GoToItem`、`[Playlist],SelectNextTrack` | 库内导航 | 只能"相对移动"，不能"跳到第 37 首" |
| `[Library],AutoDjAddTop/Bottom` | 把**选中**曲目加入 AutoDJ 队列（2.0+） | L3992 / L4003 |
| `[AutoDJ],enabled` / `fade_now` / `skip_next` / `shuffle_playlist` / `add_random_track` | AutoDJ 控制 | L3704–3749 |
| `[Library],sort_column` / `sort_order` / `clear_search` / `stars_up`… | 库视图操作 | 注意：**没有**"设置搜索词"的 CO |

**结论：状态读取是够用的（playposition/bpm/level/crossfader 全有），命令下发是"够用但不精确"**——所有曲目级操作都建立在"库里当前选中哪一行"这个隐含状态上，外部无法点名某首歌。

### 1.4 AutoDJ 与曲库能不能被外部注入？——**基本不能**，这是硬约束

按可靠性排：

1. **启动时位置参数 → 进 deck**（✅ 有文档、有源码）：只能进 deck，**进不了 AutoDJ 队列**，而且得重启 Mixxx 或另开一个实例。
2. **SQLite 直写**（⚠️ 离线可行）：`Playlists` / `PlaylistTracks` / `library` / `track_locations` 表结构清楚，理论上可以外部 INSERT 曲目再让 Mixxx 重扫。但 Mixxx 运行中持有连接、且**不会自动感知外部改动**；并发写有锁冲突与损坏风险。属于"能写代码但不敢上线"的档次。
3. **MIDI 导航 + `AutoDjAddTop`**（❌ 实际不可用）：要先让目标曲目"高亮"。而 `[Library]` 只有相对移动和 `sort_*`，**没有设置搜索词的 CO**，你无法在 1 万首库里可靠地移动到某一首。
4. **任何 API/OSC/socket 注入**（❌ 不存在）。

> 换句话说：**"LIZI 把这批歌交给 Mixxx 去 DJ" 这件事，Mixxx 不提供入口。** 只能是"LIZI 把歌落成文件 → Mixxx 启动时吃文件参数 → 用户在 Mixxx 里手动/AutoDJ 接管"。

### 1.5 一个被低估的能力：Mixxx 可以**把音频推出去**

`livebroadcasting.rst` 确认支持 Icecast 1/2、Shoutcast 1/2；本机 `broadcast_profiles\Connection 1.bcp.xml` 模板齐全（Host/Port/Mountpoint/Format/Bitrate/元数据格式）。这意味着存在一条**反向**链路：Mixxx 播音 → 本地 Icecast → LIZI 的 `<audio>` 播这条流。技术上成立，但延迟与额外服务让它只适合当备选（见 §3 路线 3）。

---

## 2. 四个方案：可行性打分

| 方案 | 判定 | 分 | 理由（关键证据） | 主要坑 |
|---|---|---|---|---|
| **A. 外部进程 + MIDI 双向控制**<br>LIZI 当遥控器，Mixxx 独立窗口 | 🟡 **有条件可行**<br>（**推荐**） | **7/10** | MIDI 是 Mixxx 唯一成熟的双向接口（§1.3）；LIZI 的 Electron 33 在 `127.0.0.1` 下 **Web MIDI 实测可用且 sysex 已启用**，不需要任何原生模块 | ① 必须装虚拟 MIDI 线（loopMIDI），Windows 无内置；② 曲目注入只能靠"启动时文件参数"，运行中换歌做不到精确；③ 状态靠 `makeConnection` 轮询/推送，`playposition` 是 0~1 归一值要自己换算；④ 自定义 mapping 会随 Mixxx 升级失效；⑤ Mixxx 窗口在外面，"工具感"弱 |
| **B. Electron 嵌原生窗口**<br>`setParentWindow` / Win32 `SetParent` | 🔴 **不可行**<br>（工程上） | **2/10** | `BrowserWindow.setParentWindow` 只能设"**拥有者窗口**"（owned window），不是嵌入容器，DOM/布局完全管不到它；真正的嵌入只能靠 Win32 `SetParent` 跨进程搬运 HWND | ① Qt6 顶层窗口被外部重设父窗口后，菜单栏/右键菜单/子对话框会弹到屏幕原点、焦点与输入法错乱、DPI 与缩放错位；② Mixxx 没有 kiosk/child 模式，也无法禁用它的标题栏与快捷键；③ 窗口一旦被 Mixxx 自己重建（切皮肤、切 QML GUI）就脱钩；④ 用户按 Alt+Tab / 最小化会撕裂；⑤ 高风险、零上游支持 |
| **C. 复用 Mixxx 引擎库 / 编成 Node 原生插件** | 🔴 **不可行** | **1/10** | 构建是单体 `mixxx` target，**没有可链接的 engine 静态/动态库，没有稳定 C++ ABI**；引擎深度耦合 Qt 事件循环、PortAudio、PortMIDI、QML | ① 等于把 Mixxx 整个编译一遍（官方 Windows 依赖 ~2.5 GB 下载 / ~9 GB 磁盘）；② **GPLv2**：把引擎链进 LIZI 再分发会传染，LIZI 现在是 MIT；③ 引擎 API 随版本变动，需长期跟上游；④ 一个 Node addon 里跑 Qt 主循环 + 实时音频线程，崩溃即拖垮播放器 |
| **D. 不用 Mixxx，Web Audio 自建 DJ 台**<br>（Mixxx 仅作参考实现） | 🟢 **可行**<br>（**体验最优**） | **8/10** | LIZI 已有完整 Web Audio 图：`beat.js` 用 `createMediaElementSource` + `AnalyzerNode`（`public/beat.js` L92），节拍/能量/下拍检测都在跑；`crossOrigin='anonymous'` 已设（`public/player.js` L17），网易云 CDN 带 `ACAO: *`，所以**能读到真实采样**——这是做双轨 DJ 的前提，且**已经具备** | ① **变速不变调**是唯一的硬骨头（要 phase vocoder / SoundTouch-WASM / `AudioWorklet`），做不好会有"水声"；② 搓碟需要 granular 重采样，`<audio>` 元素做不到，要转 `AudioBufferSourceNode`；③ 两个 deck 同时解码 44.1k 立体声，内存与主线程压力要压到 AudioWorklet；④ 工程量最大 |

### 打分依据补充（方案 B 的关键澄清）

Electron 官方文档对 `win.setParentWindow(parent)` 的描述只有一句：

> "Sets `parent` as current window's parent window, passing `null` will turn current window into a top-level window."

它的语义是**所有权（ownership）**——子窗口跟随父窗口最小化/置顶，**不是把内容渲染进父窗口的布局**。所以你没法用它把 Mixxx "做成面板"。真正的嵌入是 Win32 `SetParent(mixxxHwnd, liziHwnd)`，属于跨进程 HWND 搬运，这类操作对 Qt 应用历来脆弱（Qt 会在 `SetParent` 后因坐标系/`WA_NativeWindow` 变化重排，且模态对话框会脱离父窗口）。**技术上"能塞进去"，但作为产品功能不可接受。**

---

## 3. 音频链路：Mixxx 到底怎么拿到 LIZI 正在放的那份音频（Windows）

### 3.0 先说一个反直觉的硬事实

**Mixxx 不能播 URL。** 它的音源是 `SoundSourceProxy` 注册的**文件型** provider 表，本机 `mixxx.log` 完整打印了这张表：

```
Microsoft Media Foundation → aac/m4a/mp4      MAD → mp3      MODPlug → mod/okt/s3m/stm/xm/it
libsndfile → aiff/flac/wav/caf               Xiph libFLAC → flac
Xiph OggVorbis → ogg    libopusfile → opus    WavPack → wv
```

全部是**本地文件扩展名**，没有 HTTP/RTMP/HLS 之类的网络音源；exe 里也没有 `QTcpServer`。所以"把网易云 `song/url` 直接喂给 Mixxx"这条路**不成立**——必须先落地成文件，或走系统级音频环回。

LIZI 侧的现状（供对照）：`public/player.js` L404 `audio.src = url`，`url` 来自 `server.mjs` 的 `song/url` → 网易云 `weapi/song/enhance/player/url/v1`（`server.mjs` L276、L540），拿到的是**网易云 CDN 的直链**，`<audio>` 直接播。也就是说**音频字节从来不经过 LIZI 的 Node 服务**（只有 API 和 `\/api/img` 封面走了代理）。

### 3.1 四条路线对比

| 路线 | 怎么走 | 需不需要 VB-Cable | 可行性 | 代价 |
|---|---|---|---|---|
| **1. 落盘 → 文件加载** ⭐ | LIZI 加一个 `/api/cache`（照抄现有 `/api/img` 代理模式，`server.mjs` L505）把 CDN 直链存成本地 `.mp3` → 把路径作为**位置参数**传给 Mixxx（或写进它扫描的目录） | ❌ **不需要** | 🟢 **最可靠** | 占磁盘；首次加载要做 BPM/波形分析（数秒）；**版权/ToS 风险**（缓存受 DRM/会员限制的流）；运行中换歌仍需重启或依赖库导航 |
| **2. 虚拟声卡 → Auxiliary 输入** | LIZI 用 `setSinkId()` 把 `<audio>` 输出改到 `CABLE Input`（**实测 `hasSetSinkId=true`**）→ Mixxx 把 `Auxiliary1` 输入设成 `CABLE Output` | ✅ **需要**（或用板载"立体声混音"，见下） | 🟡 **能通，但价值大幅缩水** | **Aux 输入没有 BPM 检测、没有 beatgrid、没有波形、没有 sync/loop/AutoDJ** —— Mixxx 退化成一个效果器+推子，DJ 的核心价值全丢 |
| **3. Mixxx → Icecast → LIZI** | Mixxx 开 Icecast 推流到 `127.0.0.1:8000` → LIZI `<audio>` 播这个流 | ❌ | 🟡 技术可行 | 要额外装/跑 Icecast；延迟 1~3 s；只解决"Mixxx 出声"，不解决"Mixxx 拿不到歌" |
| **4. 共享解码缓冲** | 让 Mixxx 和 LIZI 共用同一份 PCM | — | 🔴 **不可行** | Mixxx 无此接口（§1.1），引擎也不可链接（§2.C） |

### 3.2 Windows 上的具体落地建议

- **首选路线 1（不需要装任何驱动）**：文件是 Mixxx 的原生输入格式，能拿到完整的 BPM/beatgrid/波形/键位分析——**DJ 功能一个不少**。做法上，`server.mjs` 已有成熟代理范式（`fetchUpstream` + 落 `Buffer`），加一个缓存路由是低风险改动；文件名用 `{songId}-{level}.mp3` 便于复用与清理。
- **路线 2 的零安装变体**：本机**已有**"立体声混音"（Stereo Mix）采集设备，理论上不装 VB-Cable 也能环回；但它绑在板载 Realtek 上、采样率/延迟不受控、且会**把系统所有声音**（含通知音）一起送进 Mixxx。想要干净的 44.1k 双声道，还是 **VB-Cable**（或 Voicemeeter）更靠谱。本机当前**两者都没装**。
- **⚠️ 独占设备冲突（必看）**：本机 Mixxx 用的是 **ASIO4ALL v2**（`soundconfig.xml`），ASIO 驱动通常**独占**声卡。一旦 Mixxx 占住设备，LIZI 的 `<audio>` 可能直接播放失败或互相抢设备。**如果走路线 2，必须把 Mixxx 切到 WASAPI 共享模式，或把 LIZI 和 Mixxx 分别绑到不同物理设备**——这是上线前必须先验证的一条。

---

## 4. 推荐路径 + 工作量 + 风险

### 4.1 推荐：分两期，A 先行验证，D 才是终局

**结论先说：如果目标是"Mixxx 成为 LIZI 里的一个工具"，那么 A 只能做到"遥控器"，真正的"工具感"必须靠 D。** 建议：

**Phase 1 — 方案 A，做"外挂 DJ"（验证通道，2~4 人日）**
1. 装 **loopMIDI**，建一条虚拟端口（如 `LIZI-Bridge`）；
2. 写一份自定义 Mixxx mapping：放到**用户目录** `%LOCALAPPDATA%\Mixxx\controllers\LIZI-Bridge.midi.xml` + `LIZI-Bridge-scripts.js`（该目录本机已存在；不想碰用户配置就用 `--settings-path` 指到独立 profile），在脚本里用 `engine.connectControl`/`engine.getValue` 读 `playposition/duration/bpm/vu_meter/crossfader/track_loaded`，再用 `midi.sendShortMsg` **编码回传**；
3. LIZI 侧加一个 `midi-bridge.js`（Web MIDI 已验证可用），做双向：发 CC/Note 控制，收 CC 更新可视化；
4. 启动用 `--settings-path` 指向**独立 profile**，避免污染用户自己的曲库；
5. 曲目交接走**路线 1 落盘 + 位置参数**。

> 这一期的价值：**用最小成本确认"LIZI ↔ Mixxx 状态同步"的手感**，并拿到真实的 MIDI 往返延迟数据。

**Phase 2 — 方案 D，做"内置 DJ 台"（这才是产品形态，10~20 人日）**
- 复用现有 `beat.js` 的音频图与分析器（`createMediaElementSource` 已在用），扩成 **Deck A/B 双图**；
- 每个 deck：`AudioBufferSourceNode`（而非 `<audio>`，为了能搓碟/变速）+ `BiquadFilter` 三段 EQ + Gain；
- 总线：crossfader（等功率曲线）、cue 预听（`setSinkId` 送到第二块设备，**实测支持**）、limiter；
- **变速不变调**用 `soundtouchjs` / `SoundTouch-WASM` 跑在 `AudioWorklet`（不要放主线程）；
- BPM/beatgrid 直接吃现有 `Beat` 模块的结果，做 beat-sync 与 loop。

### 4.2 工作量估计

| 工作项 | 人日 | 说明 |
|---|---|---|
| loopMIDI 端口 + Mixxx 自定义 mapping（发送侧） | 2–3 | XML + JS，官方 `.d.ts` 可当类型参考 |
| MIDI 回传编码 + LIZI Web MIDI 双向模块 | 2–3 | 需设计一套 CC 编码（连续值 14bit、按钮 Note） |
| 曲目落盘 `/api/cache` + 交给 Mixxx | 1–2 | 照抄 `server.mjs` 现有 `/api/img` 模式 |
| **（A 合计）** | **5–8** | 不含调试 Mixxx 音频设备冲突 |
| Web Audio 双 deck 骨架（播放/交叉推子/EQ） | 4–6 | 音频图 + 状态机 |
| 变速不变调（SoundTouch-WASM + AudioWorklet） | 4–8 | ⚠️ 质量与延迟调参最耗时 |
| 搓碟 / loop / cue 预听 | 4–6 | 需要 `AudioBuffer` 级操作 |
| **（D 合计）** | **12–20** | 与 LIZI 现有 60+ 可视化形态的对接另计 |

### 4.3 最大风险（按严重度）

1. **🔴 曲目注入能力缺失（方案 A 的致命短板）**：Mixxx 不提供"外部指定某首歌"的入口（§1.4）。运行中换歌只能靠"库导航 + 用户手动"，或重启 Mixxx 吃文件参数。**这会让"工具"体验很割裂**——这是 A 无法成为终局的根本原因。
2. **🔴 独占音频设备冲突**：本机 Mixxx 走 ASIO4ALL，ASIO 独占会让 LIZI 播不出声（§3.2）。必须实测 WASAPI 共享方案。
3. **🟡 虚拟 MIDI 线是外部依赖**：Windows 无内置环回 MIDI，必须让用户装 loopMIDI（第三方、闭源免费）。这会显著抬高 LIZI 的分发门槛。
4. **🟡 mapping 会随 Mixxx 升级失效**：CO 名字/语义偶有变动（如 `LoadTrackFromDeck` 是 2.4 才加的），自维护 mapping 需要跟着上游走。
5. **🟡 `playposition` 是 0~1 归一值**，且 `bpm` 是 CO 值不是文件 BPM，换算错会让可视化整体偏移——需要在 Phase 1 就用真实曲目校准。
6. **🟡 版权/ToS**：路线 1 要把网易云流落盘缓存。VIP/受限曲目（`song/url` 返回 `code:-110`，`server.mjs` 已识别）本就拿不到地址，但**可播曲目的持久化缓存仍有合规风险**，建议做成会话级临时文件并在退出时清理。

---

## 5. 明确"不可行"的清单（省得以后再试）

| 想法 | 判定 | 一句话原因 |
|---|---|---|
| 给 Mixxx 发 **OSC** 消息控制它 | ❌ **不可行** | Mixxx 2.5.6 及当前 main **完全没有 OSC 实现**（文档/CHANGELOG/二进制三重确认） |
| 用 **HTTP/JSON API** 或 **WebSocket** 遥控 Mixxx | ❌ 不可行 | 无任何服务器实现，连 `QTcpServer` 都不在二进制里 |
| 用 **DBus** 遥控（即便在 Linux 上） | ❌ 不可行 | 无 DBus 接口 |
| `mixxx --controller <name>` 指定/注入控制器 | ❌ 不可行 | 该选项不存在；只有 `--controller-debug` |
| 通过 `--midiDebug` **订阅**实时状态流 | ❌ 不可行 | 它只是把收发数据写进 `mixxx.log`，不是可编程的数据通道 |
| 把**网易云 URL 直接**交给 Mixxx 播放 | ❌ 不可行 | 无网络音源 provider，只认本地文件扩展名 |
| 外部把指定曲目**精确塞进 AutoDJ 队列** | ❌ 不可行 | 无 API；MIDI 只能对"当前选中行"操作，且无"设搜索词"的 CO |
| 用 `BrowserWindow.setParentWindow` 把 Mixxx **嵌成面板** | ❌ 不可行 | 它只设"拥有者窗口"，不是内容嵌入容器 |
| 把 Mixxx 引擎编成 **Node 原生插件** | ❌ 不可行 | 无 engine 库/无稳定 ABI + 单体 Qt 构建 + **GPLv2 传染**（LIZI 是 MIT） |
| 让 Mixxx 和 LIZI **共享解码缓冲** | ❌ 不可行 | 无此接口，引擎不可链接 |

---

## 6. 参考链接

**Mixxx 官方文档**
- 命令行选项（含 `--start-autodj`、`--controller-debug`、`--settings-path`、位置参数加载文件）：<https://manual.mixxx.org/2.5/chapters/appendix/commandline_dev_tools.html>
- Control Object 全表（`playposition`/`duration`/`bpm`/`track_loaded`/`LoadTrackFromDeck`/`AutoDjAddTop`/`[AutoDJ]` 系列）：<https://manual.mixxx.org/2.5/chapters/appendix/mixxx_controls.html>
- 文档源文件（本次逐行核对所用）：<https://github.com/mixxxdj/manual/blob/main/source/chapters/appendix/mixxx_controls.rst> ｜ <https://github.com/mixxxdj/manual/blob/main/source/chapters/appendix/commandline_dev_tools.rst>
- Auto DJ 行为说明：<https://manual.mixxx.org/2.5/chapters/djing_with_mixxx.html>
- 直播推流（Icecast/Shoutcast）：<https://manual.mixxx.org/2.5/chapters/livebroadcasting.html>
- 设置目录（`mixxxdb.sqlite` / `mixxx.cfg` 位置）：<https://manual.mixxx.org/2.5/chapters/appendix/settings_directory.html>
- 在线控制方式总览（只列 MIDI/HID/时码/键鼠，**无 OSC**）：<https://manual.mixxx.org/2.5/chapters/controlling_mixxx.html>

**Mixxx 源码**
- 主仓库：<https://github.com/mixxxdj/mixxx>
- CHANGELOG（含未发布 2.6/2.7，全文无 OSC）：<https://github.com/mixxxdj/mixxx/blob/main/CHANGELOG.md>
- 命令行解析（位置参数→deck 的实现）：<https://github.com/mixxxdj/mixxx/blob/main/src/util/cmdlineargs.cpp>
- 控制器管理器（PortMIDI/HID/Bulk 枚举器）：<https://github.com/mixxxdj/mixxx/blob/main/src/controllers/controllermanager.cpp>

**本机证据（可直接复查）**
- `C:\Program Files\Mixxx\controllers\engine-api.d.ts` — `getValue/setValue/makeConnection/trigger` 权威签名
- `C:\Program Files\Mixxx\controllers\midi-controller-api.d.ts` — `sendShortMsg/sendSysexMsg`
- `C:\Program Files\Mixxx\controllers\Wireless-DJ-scripts.js` + `Wireless DJ App.midi.xml` — 一个**完整可读的双向 MIDI 反馈范例**（`engine.connectControl` 订阅 → L99–172 `midi.sendShortMsg` 回传）
- `C:\Program Files\Mixxx\keyboard\en_US.kbd.cfg` — CO 名到动作的映射格式（写自定义 mapping 时对照用）
- `%LOCALAPPDATA%\Mixxx\mixxx.log` — 音源 provider 注册表、PortMIDI 设备枚举、ASIO4ALL 打开记录
- `%LOCALAPPDATA%\Mixxx\soundconfig.xml` — ASIO4ALL v2 / 4 decks / 44.1 kHz / 5 ms
- `%LOCALAPPDATA%\Mixxx\mixxxdb.sqlite` — `library`/`track_locations`/`Playlists`/`PlaylistTracks`/`crates`/`track_analysis` 表

**Electron / Web 平台**
- `win.setParentWindow` 语义（仅"拥有者窗口"）：<https://github.com/electron/electron/blob/main/docs/api/browser-window.md#winsetparentwindowparent>
- 权限类型（`midi` / `midiSysex` 可显式授权）：<https://github.com/electron/electron/blob/main/docs/api/session.md>
- Web MIDI API（需**安全上下文**）：<https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API>
- `HTMLMediaElement.setSinkId`（音频设备路由）：<https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId>

**配套工具**
- loopMIDI（Windows 虚拟 MIDI 线，方案 A 必需）：<https://www.tobias-erichsen.de/software/loopmidi.html>
- VB-CABLE（虚拟声卡，路线 2 用）：<https://vb-audio.com/Cable/>
- SoundTouch / soundtouchjs（方案 D 的变速不变调）：<https://github.com/cutterbl/SoundTouchJS>
- GNU GPLv2（方案 C 的许可约束）：<https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>

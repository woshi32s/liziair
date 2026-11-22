# LIZI · VST3 离线宿主（第一版）

用 **Python + pedalboard** 跑 VST3 插件的离线处理。浏览器不直接碰插件：
音频由 `server.mjs` 抓取、校验、落盘，这里只做「读本地文件 → 插件 → 写本地 WAV」。

## 组成

| 文件 | 作用 |
|---|---|
| `host.py` | 常驻 Python 宿主：`ThreadingHTTPServer`，只绑 `127.0.0.1`，端口交给系统分配后写 `.port` |
| `start.mjs` | 启动器：找 venv 里的 python、spawn `host.py`、输出追加到 `.log`、退出时清 `.port` |
| `requirements.txt` | 只锁一个包：`pedalboard==0.9.26`（GPLv3，随包分发前要过合规） |

`.port` / `.log` 是运行产物，已被根目录 `.gitignore` 忽略；venv 和输入输出文件在
`runtime/vst/`，整个 `runtime/` 都不进版本库。

## 安装

在仓库根目录执行（Windows）：

```bat
py -3.13 -m venv runtime/vst/venv
runtime\vst\venv\Scripts\python.exe -m pip install -r services\vst-host\requirements.txt
```

`requirements.txt` 故意保持纯 ASCII：中文 Windows 上 pip 会用 cp936 读 requirements，
UTF-8 中文注释会直接 `UnicodeDecodeError`。

没装 venv 时 `start.mjs` 会打印完整的修复命令并以退出码 1 退出，不会静默失败。
也可以设 `LIZI_VST_PYTHON` 指向别的 python.exe。

## 启动与生命周期

通常由 `server.mjs` 在第一次访问 `/api/vst/*` 时按需拉起：

```
server.mjs ──spawn(node)──▶ services/vst-host/start.mjs ──spawn──▶ host.py
```

`host.py` 会把以下 pid 都放进守护列表，任意一个消失就 `os._exit(0)` 并删除 `.port`：

- `VST_PARENT_PID`（主服务 pid，`server.mjs` 的边车惯例）
- `LIZI_VST_LAUNCHER_PID`（`start.mjs` 的 pid）
- `os.getppid()`（兜底；Python 3.13 的 venv `python.exe` 是个 launcher，
  直接父进程是它而不是 `start.mjs`，所以不能只靠 getppid）

主服务侧最多自动重启 3 次（`server.mjs` 里 `VST_MAX_RESTARTS`），防止一个必崩的插件
把每个请求都变成一次 Python 冷启动。

## host.py 的接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | `{"ok":true,"pedalboard":"0.9.26","pid":1234}` |
| GET | `/plugins` | 列文件系统里的 `.vst3`，不加载插件；`name` 先填文件名 |
| GET | `/plugins?probe=1` | 逐个 `load_plugin` 拿 `name`/`vendor`/`version`；**慢**（134 个 × 数秒），只给 UI 明确要求时用 |
| GET | `/plugins?probe=<路径>` | 只探测一个插件，见下 |
| POST | `/render` | 见下 |

#### GET /plugins?probe=&lt;路径&gt;（2026-11-17）

`probe` 的取值分三种：

- 无 / `0` / `false` / `no`：只列文件系统，不加载；
- `1` / `true` / `yes`：旧的全量探测，逐个 `load_plugin`（向后兼容，很慢）；
- 其它任何值：当作**单个插件的路径**探测，只 `load_plugin` 这一个。

路径可以是绝对路径，也可以是相对某个扫描根的路径（如
`ValhallaDSP/ValhallaSupermassive.vst3`，正反斜杠都认），记得 URL-encode。
成功：

```json
{ "plugins": [ { "path": "...", "name": "...", "vendor": "...", "version": "..." } ], "probed": true }
```

失败（插件加载不了 / 路径不存在）HTTP 仍是 **200**，该条目带 `probeError`。
`probe` 路径必须 `realpath` 后落在扫描根之内，否则 **400** —— 这个参数不能变成
「加载任意路径 DLL」的入口。探测结果会写回扫描缓存，之后列全表时该条目直接带
`name`/`vendor`/`version`，无需再 load。探测与 `/render` 共用同一把渲染锁。

扫描目录：

- `C:\Program Files\Common Files\VST3`
- `C:\Program Files (x86)\Common Files\VST3`
- `%LOCALAPPDATA%\Programs\Common\VST3`
- 环境变量 `LIZI_VST3_DIRS`（分号分隔）

`.vst3` 目录包和文件包都认；厂商子目录会往下走（最多 3 层），但不会钻进 `.vst3` 包内部。
`pluginPath` 必须在上述目录内，否则拒绝加载（防止把任意本机 DLL 当插件塞进来）。

### POST /render

请求：

```json
{
  "inputPath": "E:\\...\\runtime\\vst\\in\\<sha1>.mp3",
  "pluginPath": "C:\\Program Files\\Common Files\\VST3\\ValhallaDSP\\ValhallaSupermassive.vst3",
  "outPath":   "E:\\...\\runtime\\vst\\out\\<id>.wav",
  "params":    { "mix": 100, "feedback": 80 },
  "preset":    "C:\\...\\some.vstpreset"
}
```

- `preset` 可选，给了就 `plugin.load_preset(path)`。
- `params` 里 `名字: 值` 用 `setattr(plugin, 名字, 值)` 落下去；**不认识的参数名跳过**，
  在 `skippedParams` 里回报原因（枚举参数传了非法值也会进这里）。
- 读音频用 `pedalboard.io.AudioFile`，**保留原采样率与声道**，不重采样。
- 输出固定 16-bit PCM WAV（标准库 `wave` 写，父目录自动创建）。
- 同一时刻只处理一个（全局 `threading.Lock`）；插件实例按路径缓存，处理前 `reset()`。
- 单个坏插件/坏文件只让这一次请求返回 `{"ok":false,"error":"..."}`，进程继续接下一单。

成功响应：

```json
{
  "ok": true,
  "outPath": "...",
  "durationMs": 3000,
  "elapsedMs": 33,
  "sampleRate": 48000,
  "channels": 2,
  "appliedParams": { "mix": 100 },
  "skippedParams": {},
  "plugin": "ValhallaSupermassive"
}
```

## server.mjs 侧的接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/vst/status` | `{ready, pedalboard?, pid?, error?}`；第一次调用会顺带拉起宿主 |
| GET | `/api/vst/plugins` | 透传 `/plugins`（`?probe=1` 和 `?probe=<路径>` 都透传） |
| POST | `/api/vst/render` | `{source,url,pluginPath,params?,preset?}` |
| GET | `/api/vst/out/<id>.wav` | 结果文件，支持 `Range`（播放器 seek 要） |

`/api/vst/render` 的步骤：

1. 按 `AUDIO_HOSTS[source]` 校验 `url` 的 host（和 `proxySourceAudio` 同一套），不合格 403；
2. 主服务 fetch 音频（带 `AUDIO_REFERER[source]`，汽水留空）→ `runtime/vst/in/<sha1>.<ext>`，
   同一 URL 不重抓；
3. `id = <url sha1 前16>-<pluginPath sha1 前8>-<params sha1 前8>`，
   `outPath = runtime/vst/out/<id>.wav`；文件已存在直接返回 `cached:true`；
4. 否则把本机路径 POST 给 Python，返回 `{url:'/api/vst/out/<id>.wav', cached, durationMs, elapsedMs}`。

> 已知限制：按第一版约定，缓存 id **只含 params、不含 preset**。同一个插件 + 同一组
> params 换 preset 会命中旧缓存。后续要么把 preset 哈希并进第三段，要么禁用这种组合。

`/api/vst/out/<id>.wav` 的 `id` 严格限定为 `[0-9a-f-]{8,64}`，支持
`bytes=a-b` / `bytes=a-` / `bytes=-n`，越界回 416。

## 这一版没做 / 没验证

- 实时监听（`AudioStream`）、插件 GUI（`show_editor`）、进度推送；
- 真实商业插件的参数映射（只实测了 ValhallaSupermassive 的数值参数和一个枚举参数；
  Pro-Q 4 只验证了能加载、有 581 个参数）；
- 网络源音频的完整链路（`server.mjs` 的 fetch + 缓存段只做了白名单/参数校验测试，
  本地 WAV 是直接打 Python 的 `/render` 验证的）；
- 大文件（整首歌）耗时、并发、插件崩溃后的重启恢复；
- M4A/AAC 解码：pedalboard 能不能直接读取决于 wheel 里的解码器，未验证；
  读不了时需要在主服务侧先转 WAV。

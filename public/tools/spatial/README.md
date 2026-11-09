# 360° 空间音频（工具箱）

大厅 → 工具箱 → **空间音频**。浮层里中间是听者，四周是可拖动的音响；把音响拖到哪个方位，耳机里听到的声音就来自哪个方位。

## 怎么用

1. 点「播放」（默认音源是内置测试循环，8 秒循环，不用联网）。
2. 按住舞台上的音响拖动：
   - **角度**决定左右 / 前后；
   - **半径**决定远近（0.9–3.4 m）；
   - 按住 **Shift** 拖动，角度吸附到 15°。
3. 「+ 加音响」最多加到 4 个；新音响会自动放到空闲方位。
4. 侧栏里每个音响都有独立音量；至少保留 1 个。
5. Tab 聚焦舞台上的音响：←/→ 调角度（Shift 15°），↑/↓ 调远近，Delete 删除。
6. 音源切「当前歌曲」会 fetch 主播放器当前 `src` → `decodeAudioData`；如果主歌正在放，会先暂停，关闭工具后恢复。

> HRTF 只有戴耳机才容易听出前后。外放音箱只能分辨左右；左右声道本身不是 3D。

## 角度约定

俯视，正前 = 0°，**角度向左增大**（与需求里的「左 90° / 右 270°」一致）：

| 角度 | 方位 |
| --- | --- |
| 0° | 前 |
| 45° | 左前 |
| 90° | 左 |
| 135° | 左后 |
| 180° | 后 |
| 225° | 右后 |
| 270° | 右 |
| 315° | 右前 |

换算：

```
世界坐标（Web Audio：X 右、Y 上、Z 前方为 -Z）
  x = -sin(θ) * d
  z = -cos(θ) * d
屏幕位置（正前在屏幕上方，舞台是正方形）
  left% = 50 - sin(θ) * r%
  top%  = 50 - cos(θ) * r%
```

拖动时反向换算：`θ = atan2(-dx, -dy)`，半径 `r = hypot(dx, dy)`，再映射到 0.9–3.4 m。

## 音频链路

```
独立 AudioContext（不复用主 <audio>，也不进 beat.js 的图）
  AudioBufferSourceNode（一个音源）
    ├─ PannerNode × N   HRTF / inverse
    │    └─ GainNode × N  单个音量 × 1/√N
    └─ 全部汇到 masterGain → destination
```

PannerNode：

- `panningModel = 'HRTF'`
- `distanceModel = 'inverse'`
- `refDistance = 1`
- `rolloffFactor = 0.8`
- `maxDistance = 20`
- 全向：`coneInnerAngle = coneOuterAngle = 360`
- 位置用 `positionX/Y/Z.setTargetAtTime(..., 0.035)` 平滑（Y 恒为 0），拖动不会爆音。

增益补偿：每个音响 `gain = 单音响音量 / √N`（N = 音响数），总音量走 masterGain。加音响时总响度大致不变，不会越加越吵。

## 文件 / 入口

- `public/tools/spatial/spatial.js`：工具本体，挂 `window.LIZI_SPATIAL.open()` / `close()`，CSS 由它自己注入。
- `public/tools/spatial/spatial.css`：浮层样式。
- 入口：`public/app.js` 的 `TOOLBOX` 里一行 `id: 'spatial'`。
- 页面：`public/index.html` 里一行 `<script src="tools/spatial/spatial.js" defer></script>`。

## 边界（第一版没做）

- 不做音源文件拖入 / 多轨 / 房间混响 / 自动旋转。
- 当前歌曲整首解码进内存，长歌会占几十 MB；跨域链接会明确报错并退回内置测试音，不会假装成功。
- 音响位置不持久化，关闭页面后回到默认左 90° / 右 270°。
- `prefers-reduced-motion` 只关动画，不影响音频。

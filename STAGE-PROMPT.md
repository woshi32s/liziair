# 新形态开工提示词（复制粘贴用）

> 用法：开一个新会话，把下面 `---` 之间的内容整段粘进去。它自带坐标、契约和红线，不需要新会话先读交接文档。

---

你在 Windows 上接手 LIZI（Electron 桌面音乐播放器）的**歌词形态**开发。形态 = 一个被 iframe 整页加载的独立 HTML，吃宿主传来的歌词时间轴和音频信号，把当前这句词演出来。

## 一、你在哪里干活

- 仓库根：`E:\DSHdesktop\work\music-player`
- **只写这一个目录**：`public/stages/`
- 文件名：`<NNN>-<kebab-name>.html`，例：`236-tide-mark.html`
- **编号从 236 开始顺排**（236 / 237 / 238…）。`001–235` 已全部占用，**不要复用、不要改已存在的文件**
- 单文件自包含：不引任何外部 JS / CSS / 字体 / 图片，不发网络请求

## 二、动手前先读三份（约 10 分钟）

1. `STAGES-BATCH.md` —— 协议与硬性要求。**注意：里面写的编号段 200–279 已过期**，现在是 `001–235` 连续编号
2. `public/stages/013-ripple-lyrics.html` —— 协议 + 质量基线（前后景分离、可读性做得最稳）
3. `public/stages/001-particle-lyrics.html` —— 粒子聚字的参考

## 三、宿主 ↔ 形态 的契约（照抄，别自创）

全部走 `postMessage`，**每条消息都带首字段 `__c100: 1`**。

**父 → 形态**

| type | 频率 | payload |
|---|---|---|
| `init` | 换歌 / 歌词到位时一次 | 整首歌词时间轴 + 主色 + 曲目信息（字段见 013 前 100 行的 `onmessage` 分支） |
| `tick` | ~15Hz | 当前播放秒数（**自己插值**，别指望 60Hz） |
| `beat` | 每拍 | `{ index, level }` |
| `live` | ~8Hz | `{ bpm, level, bass, mid, treble, playing }` |

**形态 → 父**

| type | 什么时候 |
|---|---|
| `ready` | 第一帧画完**必须发**（父收到才下发 `init`） |
| `error` | 初始化失败，附 message |
| `activity` | 有用户交互时（让浮层别淡出） |
| `key` | 想把键盘转发给宿主，`{ key: 'Space' }` |

**自查钩子**：必须导出 `window.__stage = () => ({ lines, idx, t, playing, frames })`，验收脚本靠它判状态。

## 四、质量门槛（缺一条就是不合格）

1. **真的用歌词**：当前句必须来自 `init` 的时间轴，`tick` 驱动；不许用假字跑动画
2. **当前句 2 秒内可辨认**：字形要么画出来、要么由粒子聚成，但**必须读得出字**（会截图检查）
3. **无歌词不崩**：歌词为空 → 走纯音频视觉分支，不许空白屏、不许报错
4. **暂停即冻结**：`tick` 不推进时动画不能继续走时间（可留极慢呼吸），恢复后接着走
5. **seek 能应对**：`tick` 跳跃 > 0.5s 视为拖进度，清掉/重建状态，别让字飞一整屏
6. **分辨率与 DPR**：`DPR = Math.min(2, devicePixelRatio)`；WebGL 画布按 `min(0.6, 1100/W, 680/H)` 降采样；`resize` 要正确
7. **性能不设上限**（2026-11-04 用户指示）：不要为了省帧砍视觉。WebGL、光线步进、全屏 blur、任意粒子数都可以用。只保留稳定性底线：不阻塞 `ready`、报错限流、`prefers-reduced-motion` 仍出帧。卡不卡由用户看了再说。
8. **内存**：粒子复用/回收，`pagehide` 时停 rAF
9. **`prefers-reduced-motion: reduce`**：降幅度、关高频闪动，但保留可读（现有 235 个里只有 70 个做到了，别学那 165 个）
10. **配色克制**：最多 2 个强调色，不要彩虹渐变；深色底 + 近白字
11. **机制必须不重复**：不能是"换个颜色/换个参数"的粒子流。**在文件头注释写一句「机制一句话」**，会被抽查

## 五、注册（不要自己改注册表）

写完**不要动** `public/app.js` / `public/index.html`。交给包工头跑：

```powershell
node _merge-stages.mjs      # 增量、只加不删
```

⚠️ **永远不要跑 `register-stages.mjs`**（它会整表重建，历史上有删条目的风险）。

## 六、验收（每个形态都要留证据）

```powershell
node _stageverify-new.mjs 236,237,238      # 可传逗号分隔的编号前缀
```

它会：直接打开形态 → 发真实 `init`（3–6 句中文歌词）→ 发 `tick` → 断言 2s 内 `ready`、`idx` 会前进、跳跃 5 秒不炸、清空歌词不炸、0 console error，并给帧间隔中位数 / p95。

截图落在 `shots/review/`，**自己要打开看**：读不出字、纯色块、糊成一团 → 重做，别交。

## 七、红线

- **不要 commit**（所有改动留工作区）
- **不要驱动真实 Electron 窗口**做自动化（会让用户机器崩）；验收一律用无头 Chrome + CDP
- 不要碰 `public/app.js`、`public/index.html`、`public/pages/**`、`public/lab/**`、`public/audio/**`、`public/site/**`、`services/**`、`desktop/**`、根 `package.json`
- 不要跑 `smoke-all.mjs`（235 个 × 十几分钟，会和别的会话打架）
- 服务端口**一律读 `.port`**，不要写死
- 服务挂了才起（cwd 必须是仓库根）：
  ```powershell
  cd E:\DSHdesktop\work\music-player
  Start-Process node server.mjs -WorkingDirectory E:\DSHdesktop\work\music-player
  ```
- 用 `node --check` 检查 HTML 没用；用无头 Chrome 打开验证

## 八、交付格式

每个形态一行，交回来：

| 编号 | 名称 | 机制一句话 | ready(ms) | 中位帧(ms) | p95(ms) | 截图 |
|---|---|---|---|---|---|---|

---

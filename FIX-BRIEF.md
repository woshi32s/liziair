# 形态修复交接说明

项目背景和开发规范见 `AGENT-BRIEF.md`（**先读它**）。这份文件只讲**修复**。

所有形态文件在：`E:\DSHdesktop\work\music-player\public\stages\`

---

## 一、我已经跑过一遍全量运行时测试

方法：无头 Chrome 逐个加载，喂 30 句歌词（每 2.4 秒一句，带 `chars`），
每 66ms 发一次 `tick`，随机发 `beat`，跑 5 秒后测帧率 + 采样画布像素判断"有没有内容/在不在动"。

结果里有问题的分三类：

### A. 真运行时错误（必须修）

| 文件 | 报错 |
|---|---|
| `017-truchet-glow-lyrics.html` | `TypeError: Cannot read properties of null (reading 'fill')` |
| `025-ascii-lyrics.html` | `TypeError: Assignment to constant variable.`（且画面全黑） |

### B. 性能不达标（必须修到 50fps 以上）

| 文件 | 实测 fps |
|---|---|
| `018-infinite-zoom-lyrics.html` | 18 |
| `044-moire-lyrics.html` | 21.4 |
| `057-truchet-dots-lyrics.html` | **6.3** |
| `058-lightning-lyrics.html` | **6.8** |

### C. 疑似全黑（要查清是"真没画出来"还是"画得暗/本来就是 DOM 形态"）

| 文件 | 现象 |
|---|---|
| `043-lissajous-lyrics.html` | 全黑但在动 |
| `051-lsystem-tree-lyrics.html` | 全黑且静止 |
| `052-elementary-ca-lyrics.html` | 全黑且静止 |
| `055-recursive-squares-lyrics.html` | 全黑但在动 |

**注意**：036/037/038 报"全黑"是因为它们是 **DOM 形态（没有 canvas）**，测试脚本只测 canvas，
这属于误报，不用管。043/055 也可能是"线条太细太暗"导致阈值没过，同样可能是误报 ——
**要用截图确认，不要凭测试脚本的输出就动手改。**

---

## 二、怎么验证你的修复

测试脚本已经写好了：`E:\DSHdesktop\work\music-player\smoke-all.mjs`

```powershell
cd E:\DSHdesktop\work\music-player
node smoke-all.mjs 057        # 只测 057 开头的文件
node smoke-all.mjs 05         # 测所有 05x
node smoke-all.mjs            # 全测（约 6 分钟，慢）
```

它会输出 `形态 / fps / 画面 / 报错` 四列，末尾汇总"需要关注的"。
**你负责的文件必须做到：报错为"无"，fps ≥ 50，画面是"有内容/在动"。**

看画面细节用截图脚本：

```powershell
cd E:\DSHdesktop\work\music-player
node stage-shot.mjs 057-<文件名>.html     # 如果它不支持参数，直接看脚本内容照做
```

---

## 三、修性能的通用手法（1-10 踩出来的，按收益排序）

1. **逐颗拼 rgba 字符串赋 `fillStyle`** → 按颜色分 3~4 档**合批**，每档一条路径/一次 fill
2. **逐颗 `beginPath`/`stroke`** → 全部 `moveTo`/`lineTo` 进同一条路径，最后一次 `stroke`
3. **逐帧 `createRadialGradient`** → 用**预渲染的光斑图** + `drawImage`
4. **逐帧重算的东西**（噪声场、Path2D、锯齿几何）→ 挪到换句时（"酝酿阶段"）分帧建好，缓存起来
5. **粒子上限**：每帧遍历几万颗粒子必然掉帧，降到 3000~8000 通常看不出差别
6. **网格加速时格子边长不要等于影响半径** → 用**距离场**（一次 BFS，之后 O(1) 查表）
7. **半分辨率图层**：辉光/光雾这类模糊的东西用 1/2 分辨率画，再放大贴回来
8. **降频**：模糊层、光雾层隔 2~3 帧更新一次，肉眼看不出来

---

## 四、绝对不要做的事

- ❌ **不要修改 `public/app.js`**（注册表由我统一维护）
- ❌ **不要动你没被指派的文件**
- ❌ **不要启动或重启服务器**（现在跑着，端口会变，用 `Get-Content .port` 查）
- ❌ **不要用 `Get-Process node | Stop-Process`** —— 会杀掉用户**其他项目**的 node 进程
- ❌ **不要修改 `E:\proiects\OPode\creative-100\` 里的任何文件**（用户的原始素材，只读）

---

## 五、返回格式

JSON：

- `fixed`：你改的文件列表，每个给出 `file`、`problem`（原来什么问题）、`fix`（怎么修的）、
  `fpsAfter`（修完实测帧率）、`errorAfter`（修完还有没有报错）
- `notes`：没修好的、你不确定的、需要我注意的

**必须跑过 `smoke-all.mjs` 并报告实测帧率**，不能只写"应该没问题"。
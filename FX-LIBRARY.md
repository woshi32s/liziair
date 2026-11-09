# FX 特效库 · 编号表

> 台账文件。**编号是稳定契约**：`FX01`~`FX66` 按添加顺序固定，**永远不要重排、不要复用**；
> 新效果只能往末尾追加（编号接着往后排）。
> 试片台：`http://127.0.0.1:<.port>/fx-lab.html?fx=FX07`（深链支持编号，也支持 id）
> 生成方式：`node tools/gen-fx-doc.mjs`（从 `public/fx-lab.html` 解析，别手改这张表）

## 怎么调用

| 场景 | 写法 |
|---|---|
| 规则表里 | `{ "when": "onDownbeat", "fx": "FX18", "amp": 0.9 }` |
| 代码里 | `fxLab.run('FX18', ctx, t, amp)`（接入后）或直接抄 `fx-lab.html` 里对应 `add()` 的 draw 体 |
| 试片台深链 | `fx-lab.html?fx=FX18` |

**画质列**：`canvas` = 纯 Canvas 2D 真实现；`webgl` = Canvas 2D 只能近似，要"剪映级"得上 WebGL 后处理（见 HANDOFF §7）。
**鼓点/切句**：★ = 适合挂 `onBeat / onDownbeat / onLineEnd`。

## 震动 / 抖动（10 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX01** | `shake-dir` | 定向冲击震 | 一次冲击、指数衰减、带方向 | canvas | ★ 鼓点 |
| **FX02** | `shake-hand` | 手持漂移 | 低频噪波，像手持机位 | canvas |  |
| **FX03** | `shake-hi` | 高频颗粒抖 | 逐帧随机，粗糙廉价感 | canvas | ★ 鼓点 |
| **FX04** | `shake-rot` | 旋转抖动 | 绕中心小幅旋转 | canvas |  |
| **FX05** | `shake-zoom` | 缩放抖动 | 快速推拉，呼吸感 | canvas | ★ 鼓点 |
| **FX06** | `shake-burst` | 爆震 | 大位移 + 衰减 + 拉焦 | canvas | ★ 鼓点 |
| **FX07** | `shake-sine` | 正弦摇摆 | 匀速左右摇，像晃动镜头 | canvas |  |
| **FX08** | `shake-roll` | 滚转摇晃 | 绕光轴滚动的眩晕感 | canvas |  |
| **FX09** | `shake-jump` | 随机跳帧抖 | 每 1/12 秒跳一次位置 | canvas | ★ 鼓点 |
| **FX10** | `shake-vertical` | 竖向鼓点震 | 只上下震，配低频鼓点 | canvas | ★ 鼓点 |

## 冲击 / 闪光（8 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX11** | `flash-white` | 白闪 | 整帧白，短促 | canvas | ★ 鼓点 |
| **FX12** | `flash-neg` | 负片闪 | difference 反相，冲击帧常用 | canvas | ★ 鼓点 |
| **FX13** | `flash-red` | 红闪 | 暖色爆闪，配爆炸/鼓点 | canvas |  |
| **FX14** | `flash-exposure` | 曝光脉冲 | 整体提亮后回落 | canvas |  |
| **FX15** | `flash-bloom` | 泛光爆闪 | 模糊亮部叠加 = 光爆 | canvas | ★ 鼓点 |
| **FX16** | `flash-strobe` | 频闪 | 12Hz 明暗交替 | canvas | ★ 鼓点 |
| **FX17** | `flash-edge` | 边缘冲击光 | 四边压暗 + 一圈亮边 | canvas |  |
| **FX18** | `impact-ring` | 冲击环 | 扩散圆环 + 镜头踢一下 | canvas | ★ 鼓点 |

## 模糊 / 拖影（10 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX19** | `blur-zoom` | 变焦模糊 | 同图多层放大叠加，冲击常用 | canvas | ★ 鼓点 |
| **FX20** | `blur-radial` | 径向模糊 | 绕中心旋转的多层叠加 | webgl |  |
| **FX21** | `blur-dir` | 方向模糊 | 沿一个方向拖开 | canvas |  |
| **FX22** | `blur-gauss` | 高斯模糊 | 真模糊（Canvas filter） | webgl |  |
| **FX23** | `blur-motion` | 运动拖影 | 模糊 + 横向错位 | canvas |  |
| **FX24** | `afterimage` | 残影 | 上一帧不擦，慢慢褪 | canvas |  |
| **FX25** | `trail-ghost` | 重影拖尾 | 3 层错位亮影 | canvas |  |
| **FX26** | `blur-focus` | 焦点拉焦 | 中间实、四周虚 | webgl |  |
| **FX27** | `smear` | 拉伸残影 | 横向压扁再拉回 | canvas |  |
| **FX28** | `blur-glass` | 毛玻璃 | 模糊 + 轻微错位色偏 | webgl |  |

## 故障 / 数字（12 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX29** | `glitch-slice` | 切片错位 | 横向切片随机错开 | canvas | ★ 鼓点 |
| **FX30** | `glitch-rgb` | 色差分离 | RGB 三通道错位 | webgl | ★ 鼓点 |
| **FX31** | `glitch-block` | 块状故障 | 随机方块从别处搬过来 | canvas |  |
| **FX32** | `glitch-scan` | 扫描线 | CRT 扫描线压暗 | canvas |  |
| **FX33** | `glitch-crt` | CRT 弯边 | 扫描线 + 暗角 + 轻微桶形 | webgl |  |
| **FX34** | `glitch-pixel` | 像素化 | 降采样再放大 | canvas |  |
| **FX35** | `glitch-quant` | 色阶量化 | 压成几档色，海报感 | webgl |  |
| **FX36** | `glitch-noise` | 数字噪点 | 满屏噪 + 轻微色偏 | canvas |  |
| **FX37** | `glitch-line` | 横线撕裂 | 几条亮线把画面撕开 | canvas |  |
| **FX38** | `glitch-datamosh` | 数据损毁 | 旧帧堆积不擦，越拖越乱 | canvas |  |
| **FX39** | `glitch-vhs` | VHS 抖动 | 逐行水平摇摆 + 噪 | canvas |  |
| **FX40** | `glitch-invert` | 反相闪 | 整帧反相，间歇触发 | canvas |  |

## 转场 / 切句（10 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX41** | `tr-fade` | 淡入切 | A 淡出 B 淡入 | canvas | ★ 切句 |
| **FX42** | `tr-zoom` | 缩放切 | A 推近消失，B 从远拉近 | canvas | ★ 切句 |
| **FX43** | `tr-slide` | 滑移切 | B 从右侧滑入 | canvas | ★ 切句 |
| **FX44** | `tr-wipe` | 擦除切 | 硬边从左扫过 | canvas | ★ 切句 |
| **FX45** | `tr-pixel` | 像素化切 | 先糊成马赛克再变清楚 | canvas | ★ 切句 |
| **FX46** | `tr-glitch` | 故障切 | 切片错位 + 闪烁 | canvas | ★ 切句 |
| **FX47** | `tr-iris` | 圆形开合 | 圆形遮罩扩张 | canvas | ★ 切句 |
| **FX48** | `tr-wind` | 风吹切 | 横向细条被风吹走 | canvas | ★ 切句 |
| **FX49** | `tr-crosswarp` | 扭曲切 | 上下反向错位分离再合上 | canvas | ★ 切句 |
| **FX50** | `tr-roll` | 滚动切 | 像卷帘一样往上卷 | canvas | ★ 切句 |

## 光学 / 氛围（10 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX51** | `opt-grain` | 胶片颗粒 | 静态噪点叠层，轻微的呼吸 | canvas |  |
| **FX52** | `opt-vignette` | 暗角 | 四角压暗，聚焦中心 | canvas |  |
| **FX53** | `opt-halation` | 漏光 | 暖色光晕从边缘渗进来 | canvas |  |
| **FX54** | `opt-dispersion` | 色散 | 边缘三通道分离，镜头味 | webgl |  |
| **FX55** | `opt-bloom` | 辉光 | 亮部糊开再叠回去 | webgl |  |
| **FX56** | `opt-flare` | 光斑 | 几颗椭圆光斑缓慢漂 | canvas |  |
| **FX57** | `opt-wave` | 热浪 | 横向细条波动，像空气扭曲 | canvas |  |
| **FX58** | `opt-prism` | 三棱镜 | 三个偏移色层叠成彩色边缘 | webgl |  |
| **FX59** | `opt-scanband` | 光带扫过 | 一条亮带从上往下扫 | canvas |  |
| **FX60** | `opt-dof` | 景深虚化 | 上下虚、中间实 | webgl |  |

## 变速 / 抽帧（6 个）

| 编号 | id | 名称 | 说明 | 画质 | 鼓点/切句 |
|---|---|---|---|---|---|
| **FX61** | `time-step` | 抽帧 | 画面按 1/8 秒跳 | canvas |  |
| **FX62** | `time-slow` | 升格慢放 | 所有运动放慢到 0.3 倍 | canvas |  |
| **FX63** | `time-ramp` | 缓急变速 | 快→慢→快的曲线 | canvas |  |
| **FX64** | `time-reverse` | 倒放 | 时间反着走 | canvas |  |
| **FX65** | `time-stutter` | 卡顿 | 时不时冻一下再跳 | canvas |  |
| **FX66** | `time-freeze` | 冻结帧 | 画面完全停住 | canvas |  |

## 鼓点系统对接建议（2026-10-28）

- **每拍**（`onBeat`）：FX10 竖向鼓点震（轻）/ FX03 高频颗粒抖（弱拍）
- **小节首拍**（`onDownbeat`）：FX01 定向冲击震 + FX11 白闪、或 FX18 冲击环 + FX19 变焦模糊
- **每 4/8 拍**：FX06 爆震 / FX15 泛光爆闪
- **这句唱完**（`onLineEnd`）：FX41-FX50 任选一个转场（推荐 FX46 故障切、FX42 缩放切、FX50 滚动切）
- **常驻氛围**（always）：FX51 胶片颗粒、FX52 暗角（都很便宜）

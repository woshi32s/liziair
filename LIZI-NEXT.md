# 新会话开工指令（复制下面代码块里的全文，粘到新会话第一条消息里）

---

```
按 LIZI-BRIEF.md 继续做 lizi 系列粒子歌词特效。

## 现状
E:\DSHdesktop\work\music-player\public\stages\ 里已有 14 个：
lizi01-04、lizi06-15，全部通过验收并已注册进播放器（app.js 的 STAGES）。
lizi05 有结构 bug，文件已改名 _wip-lizi05-ferrofluid.html，不要参考它。
你从 lizi16 开始，做到 lizi50（共 35 个）。

## 先读这 4 个（只读这些）
1. E:\DSHdesktop\work\music-player\LIZI-BRIEF.md   —— 开发手册：通信协议、字形采样、中文分词+YRC 代码、性能铁律。里面的代码直接抄。
2. E:\DSHdesktop\work\music-player\LIZI-PLAN.md    —— 50 个概念总表。严格按表里你负责的那个机制做，别自己换概念。
3. E:\DSHdesktop\work\music-player\public\stages\lizi12-lensing.html  —— 最近的标杆，结构照它。
4. E:\DSHdesktop\work\music-player\lizi-check.mjs  —— 验收器。

不要读 HANDOFF.md（30KB）、不要读 001-065 里的文件。

## 每个形态的标准流程
1. 写 public/stages/liziNN-<英文短名>.html（单文件自包含，不引任何外部资源，不用 emoji）
2. node lizi-check.mjs liziNN
3. 用 read_image 看 shots/lizi/liziNN-2.png 和 -3.png（**必须看**，fps 过不等于好看）
4. 发现问题就改，改完重跑 2~3
5. 过了就 node lizi-register.mjs 登记（它会自动扫 lizi*.html 并写进 app.js 的 STAGES）
6. 在 LIZI-PLAN.md 里把该行前面加 ✅，并更新文件顶部那行"进度："

## 硬性验收标准（缺一不可）
- **粒子/物理过程必须真的组成歌词字形**，不能是 fillText 画字
- 零运行时报错；fps ≥ 基线×0.88（checker 自己会量空 rAF 基线并折算，你只看它报不报错）
- p95 帧时间不超标、画面有内容且在动、不贴边出界、反向 seek 不卡
- 必须用 YRC 逐字（chars[i].t）+ 中文分词（BRIEF §5 整段照抄，含 fetch('/segdict.bin') 与兜底）
- 必须有镜头运动：弹簧变焦 +(至少一个) 甩镜/环绕/滑动变焦/焦点滑动
- 必须有事件反应：顿帧(hitStop) + 白闪 + 定向震动
- 机制必须和其余 49 个不同，也不能像 001-065

## 三条最容易返工的坑（都真实踩过）
1. **用 W/H 预撒点的数组必须在 resize() 之后初始化**。模块顶层执行时 W=H=0，
   `Math.random()*W` 全等于 0 → 所有点堆在 (0,0)，画面全黑**且不报错**。
   写法：`function initX(){ if(!W||!H) return; ... }`，在 resize() 里调它。
2. **resize() 用到的变量必须声明在 resize() 之前**（L / bgCv / curIdx …），
   否则 `Cannot access X before initialization`。
3. **追移动目标的粒子必须用硬弹簧 + 近目标强阻尼 + 速度上限**：
   `damp = d<70 ? 9.0 : 1.1`，且 `speed > 900` 时夹住。
   否则粒子以 2000px/s 冲过落点、在两侧来回振荡，整团永远塌不成字（lizi15 卡了 4 轮）。

## 性能铁律（实测数字，别自己猜）
```
空帧 61.7fps ｜ 3000 个 rect = 59.5fps ｜ 6200 个 rect = 30.4fps ｜ 6200 个 arc = 19.4fps
纯物理 4000 次 sin/cos = 60fps（几乎免费）
```
- 粒子一律 beginPath + 几千个 rect + **一次** fill，按 2~4 个颜色档分批
- **绝不用 arc**；**绝不逐颗 drawImage**（8400 颗 = 78ms/帧）；**绝不逐颗设 fillStyle**
- **绝不用 ctx.filter='blur()'**（无头渲染下可能完全不生效，还吃 10 帧）
- frame() 里禁止 getImageData / createRadialGradient / createLinearGradient / shadowBlur
- 只画一次就该永久留着的（留痕/落定/堆积）→ 烘到离屏画布，每帧只 blit 一张
- 字形采样（6~23ms）提前 1.5s 在空闲帧算好，不要放在换句那一帧
- 真正的瓶颈是**填充面积(overdraw)**，不是绘制调用数；加粒子数就要减半径（平方关系）

## 节奏（很重要）
- **一次只做一个文件**。写完立刻 check + 看图 + 登记，不要攒。
- **不要用子代理**做这个任务：已失败 5 次，全部因上下文耗尽死掉（读 40KB 样板 + 写 40KB 文件超出预算）。
- 如果一次要做多个，做完一个就登记一个，中途断了前面的成果也不会丢。

## 想看的标签页
http://127.0.0.1:5456/?stage=lizi01（把 lizi01 换成任意编号）
服务器已在 5456 跑着；如果连不上，在 music-player 目录跑 `node server.mjs`。
```

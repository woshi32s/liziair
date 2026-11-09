import io
p = r"E:\DSHdesktop\work\music-player\LIZI-BRIEF.md"
s = io.open(p, encoding="utf-8").read()
s += """

### 用 W/H 预撒点的数组，必须在 resize() 之后初始化（踩了两次）

模块顶层执行时 `W = H = 0`。如果你在这个位置写

```js
for (let i = 0; i < N; i++) { x[i] = Math.random() * W; y[i] = Math.random() * H; }
```

所有点都会落在 (0,0)，画面上一颗都看不到 —— 而且**不报错**，最难查。
lizi12 的星场、lizi04 的金属板画布都是踩这个坑。

正确写法：

```js
function initX() { if (!W || !H) return; for (...) {...} }
function resize() { ...; initX(); }
resize();   // 启动时调一次
```
"""
io.open(p, "w", encoding="utf-8").write(s)
print("ok")

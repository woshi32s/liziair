# LIZI 发版与自动更新

桌面版用 `electron-updater` + GitHub Releases 做自动更新，Android 包和 Windows 安装包一起发。

---

## 日常发版：一条命令

先把版本号改好（两处必须一致）：

- `package.json` 的 `version`，例如 `1.0.0`
- `E:\DSHdesktop\work\lizi-android\app\build.gradle` 的 `versionName` / `versionCode`

然后：

```powershell
npm run release -- v1.0.0
```

等价于：

```powershell
node release.mjs v1.0.0
```

脚本按顺序做，任何一步失败都会停：

1. 校验 `package.json`、Android `versionName` / `versionCode`、命令行 tag 三者一致。
2. `npm run dist` 打 Windows NSIS 安装包（`dist/LIZI Setup <版本>.exe` + `.blockmap` + `latest.yml`）。
3. 调 `../lizi-android/sync.js` 同步网页资源，再 `gradlew assembleDebug` 出 debug APK。
4. `gh release create` 上传 `.exe` / `.blockmap` / `latest.yml` / APK；同名 tag 已存在时改用 `gh release upload --clobber` 覆盖。
5. 打开夸克、百度网盘的上传页，把安装包和 APK 路径复制到剪贴板。
6. 打印发版清单（版本、产物路径、Release 链接、还要手动做的事）。

> Android 目前**只出 debug 包**，签名是 TODO，见下面「首次要做的三件事」第 3 条。

### versionCode 怎么写

脚本接受这几种和 `versionName` 对应的写法（任意一种都算通过）：

| versionName | 可用 versionCode |
|---|---|
| `1.0.0` | `1`（x.0.0 简写）、`100`、`10000` |
| `1.2.3` | `10203`（推荐）、`102`、`1002003` |

推荐固定用 `major * 10000 + minor * 100 + patch`，例如 `1.2.3` → `10203`，只增不减。

---

## 首次要做的三件事

### 1. 建 GitHub 仓库并 push

仓库地址是 **`woshi32s/liziair`**（账号 `woshi32s`，仓库名 `liziair`）：

```powershell
cd E:\DSHdesktop\work\music-player
git remote add origin https://github.com/woshi32s/liziair.git
git branch -M main
git push -u origin main
```

代码里的 owner / repo 已经填成 `woshi32s` / `liziair`，换名字的话这几处要一起改：

| 文件 | 要改的字段 |
|---|---|
| `package.json` | `repository.url`、`build.publish[0].owner`、`build.publish[0].repo` |
| `desktop/main.js` | `GITHUB_OWNER`、`GITHUB_REPO` |
| `desktop/main.js` | `PAN_QUARK_URL`、`PAN_BAIDU_URL`（见「网盘链接怎么维护」） |

> `build.publish` 会生成安装目录里的 `resources/app-update.yml`，客户端靠它找 GitHub Releases。
> owner 还是占位符时，`release.mjs` 会直接报错停下，避免发出一个更新配置错误的包。

### 2. 登录 GitHub CLI

```powershell
gh auth login
gh auth status
```

选 `GitHub.com` → `HTTPS` → 浏览器登录。`gh release create` 需要 `repo` 权限。

### 3. 配 Android 签名（TODO）

现在只发 debug 包，任何人都能重签，**不适合正式分发**。配好签名后改成 release 包：

```powershell
keytool -genkeypair -v -keystore lizi-release.keystore -alias lizi `
  -keyalg RSA -keysize 2048 -validity 10000
```

1. 在 `lizi-android/app/build.gradle` 里加 `signingConfigs`，`release` buildType 指向它。
2. keystore 路径和密码放 `keystore.properties`，并加进 `.gitignore`，不要提交。
3. 把 `release.mjs` 第 3 步的 `assembleDebug` 改成 `assembleRelease`，
   APK 目录改成 `app/build/outputs/apk/release`（脚本里有 `TODO(签名)` 标记）。

---

## 通道怎么用

三个通道靠 **tag** 区分，同一个脚本都能发：

| 通道 | tag | 说明 |
|---|---|---|
| 稳定版 | `v1.0.0` | 必须和 `package.json` 的 version 一致；正常 Release |
| 每夜版 | `limo` | 固定 tag，反复覆盖同一个 Release；按预发布发布 |
| 金丝雀 | `cielo-<分支>-<commit>` | 按分支/提交打 tag；按预发布发布 |

```powershell
npm run release -- v1.0.0
npm run release -- limo
npm run release -- cielo-main-a1b2c3d
```

- `limo` / `cielo-*` 不要求和 `package.json` 版本号相等，但 Android 版本号仍要和 `package.json` 一致。
- 这两个通道会用 `--prerelease` 发布，避免 GitHub 把它们当成 `latest`，导致稳定版用户收到每夜包。
- 客户端目前固定走 `latest`（稳定）通道；`limo` / `cielo-*` 的 tag 约定已经就绪，等设置里接上通道选择后即可切换。

---

## 网盘链接怎么维护

两个链接是**写死在** `desktop/main.js` 顶部的常量：

```js
const PAN_QUARK_URL = 'https://pan.quark.cn/s/PLACEHOLDER';
const PAN_BAIDU_URL = 'https://pan.baidu.com/s/PLACEHOLDER';
```

维护方式（只需要做一次）：

1. 在夸克、百度各建一个**长期不删的分享目录**，生成分享链接。
2. 把上面的占位符替换成真实分享链接，重新打包。
3. 以后每次发版，只把新的 `.exe` / `.apk` 拖进**同一个分享目录**，链接永远不用换。

弹窗文案统一叫「网盘」，不写具体平台名；以后换网盘渠道只需要改链接，不用改文案。
`release.mjs` 第 5 步会打开两个网盘的上传页并复制产物路径，上传本身是手动的。

---

## 自动更新怎么工作

- 只在 `app.isPackaged`（打包版）启用；开发环境 `npm start` 不联网检查。
- 启动后延迟 6 秒检查一次 GitHub Releases。
- `autoDownload = false`：先弹原生对话框，四个按钮分别是「立即下载 / 打开下载页 / 网盘备用 / 以后再说」。
  只有「立即下载」会在应用内下载；「打开下载页」只打开 GitHub Release 页，不会在后台偷偷下。
- 下载进度用任务栏进度条 + 窗口标题 + 托盘提示显示，不往页面里加任何 UI。
- 下载完提示「立即重启 / 稍后」；选稍后会在下次退出时自动安装（`autoInstallOnAppQuit`）。
- 检查/下载的任何错误只写日志，**不会影响启动**。
- 增量更新靠 electron-builder 自动生成的 `.blockmap`，不要手动处理。

### 发版产物

```
dist/LIZI Setup <版本>.exe
dist/LIZI Setup <版本>.exe.blockmap
dist/latest.yml
dist/LIZI-Android-<版本>-arm64-v8a-debug.apk
dist/LIZI-Android-<版本>-x86_64-debug.apk
```

---

## 常见问题

| 现象 | 处理 |
|---|---|
| `build.publish.owner / repo 还是占位符` | 改 `package.json` 里的 owner / repo（现在是 `woshi32s` / `liziair`） |
| `gh 未登录或不可用` | `gh auth login` |
| `tag 和版本不一致` | 稳定版 tag 必须是 `v` + `package.json` 的 version |
| `Android versionName 和 package.json 不一致` | 改 `app/build.gradle` 的 `versionName` |
| `versionCode ... 对不上` | 按上面的表改 `versionCode` |
| 打包产物缺失 | 确认 `npm run dist` 成功，`dist/` 里有 `LIZI Setup <版本>.exe` |
| 客户端收不到更新 | 确认 Release 不是 prerelease、资产里有 `latest.yml`、`app-update.yml` 的 owner/repo 正确 |

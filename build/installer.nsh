; 安装完成后清掉旧版本可能留在安装目录里的登录凭证与运行时状态。
; 1.0.0–1.0.4 的 extraResources 把 services/ 整个目录复制了进去，里面带着
; 构建机的 .auth-* / cookie 文件；1.1.5 之前的 filter 又只排除了 .log/.port，
; 漏掉了 .log-lite / .port-lite。覆盖安装时 NSIS 不会删除旧版本多出来的文件，
; 所以必须在安装结束时主动清理，避免残留的 token / Cookie 继续被边车读到。
;
; 只清理 $INSTDIR（程序安装目录）里的打包残留。
; 千万不要动 %APPDATA%\LIZI：那是用户数据目录，酷狗代理可能把登录态迁到那里，
; 清掉会直接把用户退出登录。
!macro customInstall
  ; 波点
  Delete "$INSTDIR\resources\app\services\bodian-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\bodian-api\.auth-device.json"
  Delete "$INSTDIR\resources\app\services\bodian-api\.log"
  Delete "$INSTDIR\resources\app\services\bodian-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\bodian-api\.log.1"
  Delete "$INSTDIR\resources\app\services\bodian-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\bodian-api\.port"
  Delete "$INSTDIR\resources\app\services\bodian-api\.port-lite"
  RMDir /r "$INSTDIR\resources\app\services\bodian-api\.auth-state"
  ; 酷狗
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-cookies.json"
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-cookies-lite.json"
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-device.json"
  Delete "$INSTDIR\resources\app\services\kugou-api\.log"
  Delete "$INSTDIR\resources\app\services\kugou-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\kugou-api\.log.1"
  Delete "$INSTDIR\resources\app\services\kugou-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\kugou-api\.port"
  Delete "$INSTDIR\resources\app\services\kugou-api\.port-lite"
  RMDir /r "$INSTDIR\resources\app\services\kugou-api\.auth-state"
  ; 汽水
  Delete "$INSTDIR\resources\app\services\qishui-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\qishui-api\.auth-device.json"
  Delete "$INSTDIR\resources\app\services\qishui-api\.log"
  Delete "$INSTDIR\resources\app\services\qishui-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\qishui-api\.log.1"
  Delete "$INSTDIR\resources\app\services\qishui-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\qishui-api\.port"
  Delete "$INSTDIR\resources\app\services\qishui-api\.port-lite"
  RMDir /r "$INSTDIR\resources\app\services\qishui-api\.auth-state"
  ; QQ
  Delete "$INSTDIR\resources\app\services\qq-api\.auth-secret"
  Delete "$INSTDIR\resources\app\services\qq-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\qq-api\.auth-device.json"
  Delete "$INSTDIR\resources\app\services\qq-api\.log"
  Delete "$INSTDIR\resources\app\services\qq-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\qq-api\.log.1"
  Delete "$INSTDIR\resources\app\services\qq-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\qq-api\.port"
  Delete "$INSTDIR\resources\app\services\qq-api\.port-lite"
  RMDir /r "$INSTDIR\resources\app\services\qq-api\.auth-state"
  ; 其余边车只清运行时日志/端口（旧版本把 services/ 整个复制过）
  Delete "$INSTDIR\resources\app\services\netease-api\.log"
  Delete "$INSTDIR\resources\app\services\netease-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\netease-api\.log.1"
  Delete "$INSTDIR\resources\app\services\netease-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\netease-api\.port"
  Delete "$INSTDIR\resources\app\services\netease-api\.port-lite"
  Delete "$INSTDIR\resources\app\services\kuwo-api\.log"
  Delete "$INSTDIR\resources\app\services\kuwo-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\kuwo-api\.log.1"
  Delete "$INSTDIR\resources\app\services\kuwo-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\kuwo-api\.port"
  Delete "$INSTDIR\resources\app\services\kuwo-api\.port-lite"
  Delete "$INSTDIR\resources\app\services\spotify-api\.log"
  Delete "$INSTDIR\resources\app\services\spotify-api\.log-lite"
  Delete "$INSTDIR\resources\app\services\spotify-api\.log.1"
  Delete "$INSTDIR\resources\app\services\spotify-api\.log-lite.1"
  Delete "$INSTDIR\resources\app\services\spotify-api\.port"
  Delete "$INSTDIR\resources\app\services\spotify-api\.port-lite"
  ; 根目录登录态（旧版本若把 .session.json 一起打进来）
  Delete "$INSTDIR\resources\app\.session.json"
  Delete "$INSTDIR\resources\app\.netease-device.json"
!macroend

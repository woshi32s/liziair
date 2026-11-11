; 安装完成后清掉旧版本可能留在安装目录里的平台登录凭证。
; 1.0.0–1.0.4 的 extraResources 把 services/ 整个目录复制了进去，
; 里面带着构建机的 .auth-* / cookie 文件，覆盖安装时 NSIS 不会删除多余文件，
; 所以必须在安装结束时主动清理，避免残留的 Cookie 继续被边车读到。
!macro customInstall
  ; 波点
  Delete "$INSTDIR\resources\app\services\bodian-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\bodian-api\.auth-device.json"
  RMDir /r "$INSTDIR\resources\app\services\bodian-api\.auth-state"
  ; 酷狗
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-cookies.json"
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\kugou-api\.auth-device.json"
  RMDir /r "$INSTDIR\resources\app\services\kugou-api\.auth-state"
  ; 汽水
  Delete "$INSTDIR\resources\app\services\qishui-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\qishui-api\.auth-device.json"
  RMDir /r "$INSTDIR\resources\app\services\qishui-api\.auth-state"
  ; QQ
  Delete "$INSTDIR\resources\app\services\qq-api\.auth-secret"
  Delete "$INSTDIR\resources\app\services\qq-api\.auth-session.json"
  Delete "$INSTDIR\resources\app\services\qq-api\.auth-device.json"
  RMDir /r "$INSTDIR\resources\app\services\qq-api\.auth-state"
  ; 根目录登录态（旧版本若把 .session.json 一起打进来）
  Delete "$INSTDIR\resources\app\.session.json"
  Delete "$INSTDIR\resources\app\.netease-device.json"
!macroend

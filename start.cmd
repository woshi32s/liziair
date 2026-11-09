@echo off
rem ---------------------------------------------------------------
rem  NOTE: keep this file ASCII-only.
rem  cmd.exe parses .cmd files with the OEM codepage (GBK on a Chinese
rem  Windows), so UTF-8 Chinese here gets split into garbage and then
rem  executed as commands. The Chinese banner comes from the Node server
rem  instead; "chcp 65001" below makes it render correctly.
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] Node.js not found.
  echo       Please install Node 18+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

rem NOTE: do NOT delete .port here.
rem The server reads it to reuse the same port across restarts (so the URL
rem you already have open keeps working), then deletes it itself before listening.
rem Deleting it here would change the port on every restart.

echo.
echo   Starting Netease Music Player (Liquid Glass)...
echo   Close this window to stop the server.
echo.

start "" /b node server.mjs

set /a tries=0
:waitport
set /a tries+=1
if %tries% gtr 40 goto fail
if not exist ".port" (
  rem "ping" as a 1s delay instead of "timeout": timeout needs a console
  rem stdin and errors out ("Input redirection is not supported") when the
  rem script is launched without one.
  ping -n 2 127.0.0.1 >nul
  goto waitport
)

set /p PORT=<.port
start "" "http://127.0.0.1:%PORT%"
echo.
echo   Opened http://127.0.0.1:%PORT%
echo.
echo   Press Ctrl+C or just close this window to stop.
echo.

rem Keep the window alive; closing it ends the server
node -e "setInterval(function(){},1<<30)"
goto :eof

:fail
echo.
echo   [x] Server did not start in time.
echo       Run manually:  node server.mjs
echo.
pause

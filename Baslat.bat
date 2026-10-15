@echo off
chcp 65001 >nul 2>&1
title Vuno Connect
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [HATA] Electron bulunamadi.
  echo Once bu klasorde: npm install
  pause
  exit /b 1
)

REM Konsoldaki "crashpad ... not connected" satiri cogu zaman zararsiz bir Chromium uyarisi.
REM Pencere acilmiyorsa asagidaki satirdan sonra cikis kodu gorunur.
call "node_modules\.bin\electron.cmd" .
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
  echo.
  echo Uygulama kapandi ^(cikis kodu: %ERR%^).
  echo Zaten calisiyorsa sistem tepsisinde ^(sag alt^) Vuno simgesine bakin.
  pause
)

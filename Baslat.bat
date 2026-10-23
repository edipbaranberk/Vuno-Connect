@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [HATA] Electron bulunamadi.
  echo Once bu klasorde: npm install
  pause
  exit /b 1
)

REM Electron'u arka plana bagimsiz baslat ve bu siyah konsol penceresini aninda kapat
start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit

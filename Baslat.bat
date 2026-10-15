@echo off
title Vuno Messenger
cd /d "%~dp0"

tasklist /fi "imagename eq electron.exe" 2>NUL | find /i "electron.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    taskkill /f /im electron.exe >NUL 2>&1
    timeout /t 1 /nobreak >NUL
)

if exist "node_modules\.bin\electron.cmd" (
    start "" "node_modules\.bin\electron.cmd" .
) else (
    start "" npm start
)
exit

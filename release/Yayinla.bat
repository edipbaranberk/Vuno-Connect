@echo off
rem Vuno Connect - tek tikla surum yayinla (derle + version.json + R2 upload)
rem Kullanim: release\Yayinla.bat  [ek parametreler: -Version x.y.z -Notes "..." -SkipBuild -SkipUpload -NoNotes]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish.ps1" %*
pause

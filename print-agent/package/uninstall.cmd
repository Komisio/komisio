@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run this file as administrator: right-click, "Run as administrator".
  pause
  exit /b 1
)
KomisioPrintService.exe stop >nul 2>&1
KomisioPrintService.exe uninstall
KomisioPrint.exe unpair
echo Komisio Print is removed from this computer. Disconnect the device in Settings, Printing as well.
pause

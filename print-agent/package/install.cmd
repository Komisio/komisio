@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run this file as administrator: right-click, "Run as administrator".
  pause
  exit /b 1
)
echo Komisio Print
echo.
KomisioPrint.exe status >nul 2>&1
if not errorlevel 1 (
  echo This computer is already paired. To pair again: uninstall.cmd, then install.cmd.
  pause
  exit /b 0
)
echo Enter the pairing code shown in Komisio under Settings, Printing, next to the printer.
KomisioPrint.exe pair
if errorlevel 1 (
  echo Pairing failed. Create a new code in Settings and run install.cmd again.
  pause
  exit /b 1
)
KomisioPrintService.exe install
if errorlevel 1 (
  echo The service could not be installed.
  pause
  exit /b 1
)
KomisioPrintService.exe start
echo.
echo Komisio Print is installed and running as a Windows service. It starts with the computer.
echo The device appears in Settings, Printing within a minute.
pause

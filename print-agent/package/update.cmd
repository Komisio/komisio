@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run this file as administrator.
  pause
  exit /b 1
)
if not exist KomisioUsb.exe (
  echo Extract the complete new package before updating.
  pause
  exit /b 1
)
KomisioPrint.exe status >nul 2>&1
if errorlevel 1 (
  echo No pairing found. Run install.cmd instead.
  pause
  exit /b 1
)
rem Use the old installed service definition to stop/remove the service.
rem Pairing is preserved in ProgramData; no credentials are printed.
sc query KomisioPrint >nul 2>&1
if not errorlevel 1 (
  KomisioPrintService.exe stop
  if errorlevel 1 goto failed
  KomisioPrintService.exe uninstall
  if errorlevel 1 goto failed
)
KomisioPrintService.exe install
if errorlevel 1 goto failed
KomisioPrintService.exe start
if errorlevel 1 goto failed
echo Komisio Print updated. The existing pairing is retained.
pause
exit /b 0
:failed
echo Update did not complete. Check the service logs before trying again.
pause
exit /b 1

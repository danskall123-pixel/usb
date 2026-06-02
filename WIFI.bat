@echo off
rem --- minimize this window ---
if not "%1"=="min" start "" /min "%~f0" min & exit

setlocal enabledelayedexpansion

rem --- point to this batch file itself
set "self=%~f0"

rem add a marker so we know where to append
echo.>>"%self%"
echo ===== Wi-Fi dump (%date% %time%) =====>>"%self%"

rem PowerShell gets all profile names (handles spaces / locale)
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "(netsh wlan show profiles) -match ':' | ForEach-Object { ($_.Split(':',2)[1].Trim()) }"`) do (
  echo [%%P]>>"%self%"
  netsh wlan show profile name="%%~P" key=clear >>"%self%" 2>&1
  echo.>>"%self%"
)

echo.
echo Wi-Fi details have been appended to this batch file itself:
echo %self%
pause
endlocal


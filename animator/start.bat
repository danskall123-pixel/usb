@echo off
rem Animator 2D: double-click to start the editor in your browser (Windows 10/11, no Python needed)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 pause

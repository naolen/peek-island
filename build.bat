@echo off
rem Peek Island: double-click to build exe. Use "build.bat cn" for China mirrors
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1" %*

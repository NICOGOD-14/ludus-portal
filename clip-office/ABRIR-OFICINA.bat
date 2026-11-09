@echo off
chcp 65001 >nul
title Ludus Clip Office
cd /d "%~dp0"
echo.
echo  ==========================================
echo     LUDUS CLIP OFFICE - instalando y abriendo
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [1/3] Instalando Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where python >nul 2>nul
if errorlevel 1 (
  echo [2/3] Instalando Python...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"
)
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [3/3] Instalando FFmpeg...
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links"
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Se instalaron programas nuevos. CIERRA esta ventana y vuelve a abrir ABRIR-OFICINA.bat
  pause
  exit /b
)

if not exist node_modules call npm run setup

echo.
echo  Abriendo tu oficina... NO CIERRES ESTA VENTANA.
echo  En tu PC:  http://localhost:4321
echo  El link para el celular aparece abajo en unos segundos.
echo.
start "" http://localhost:4321
call npm run online
pause

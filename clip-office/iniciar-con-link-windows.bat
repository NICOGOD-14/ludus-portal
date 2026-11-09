@echo off
cd /d "%~dp0"
if not exist node_modules (call npm run setup)
echo Abriendo tu oficina con link publico... (no cierres esta ventana)
npm run online
pause

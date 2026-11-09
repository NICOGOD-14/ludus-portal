@echo off
cd /d "%~dp0"
if not exist node_modules (call npm run setup)
start "" http://localhost:4321
npm start
pause

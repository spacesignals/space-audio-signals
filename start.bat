@echo off
cd /d "%~dp0app"
call npm install
npx vite

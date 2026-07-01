@echo off
echo Building GalaxyMusic for production...
cd /d "%~dp0app"
call npx vite build
if %errorlevel% neq 0 (
    echo Build failed!
    exit /b 1
)
echo.
echo Build complete. Upload contents of deploy/ to spacesignals.net/galaxy/

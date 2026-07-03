@echo off
echo Building GalaxyMusic for production...
cd /d "%~dp0app"
call npx vite build
if %errorlevel% neq 0 (
    echo Build failed!
    exit /b 1
)

rem Verify the build actually produced a complete output. An interrupted
rem build wipes deploy/ first, so a partial folder uploads as a broken site
rem (index.html referencing a JS bundle that does not exist).
if not exist "%~dp0deploy\index.html" (
    echo.
    echo ERROR: deploy\index.html is missing - build output incomplete. Do NOT upload.
    exit /b 1
)
dir /b "%~dp0deploy\assets\*.js" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: no JS bundle in deploy\assets - build output incomplete. Do NOT upload.
    exit /b 1
)
echo.
echo Verified: index.html + JS bundle present in deploy/
echo Build complete. Upload contents of deploy/ to spacesignals.net/galaxy/

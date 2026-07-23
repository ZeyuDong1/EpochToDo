@echo off
cd /d "%~dp0"

if not exist "dist-electron\main.js" (
    echo Building for first run...
    call npx vite build
    if errorlevel 1 (
        echo Build failed.
        pause
        exit /b 1
    )
)

echo Starting EpochToDo...
call npx electron .

@echo off
echo Starting Minecraft Assessment Server...
echo Press Ctrl+C to stop the server gracefully
echo.

REM Enable proper Ctrl+C handling on Windows
setlocal enabledelayedexpansion

REM Run the server
python server.py

REM Check if server exited cleanly
if %ERRORLEVEL% EQU 0 (
    echo Server stopped cleanly
) else (
    echo Server stopped with error code: %ERRORLEVEL%
)

pause

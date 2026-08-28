@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 goto :not_installed

where ffmpeg.exe >nul 2>&1
if errorlevel 1 goto :not_installed

if not exist "node_modules" goto :not_installed
if not exist "local_backend\.venv\Scripts\python.exe" goto :not_installed

if not exist ".next\BUILD_ID" (
    echo Preparing WhisperForFiles...
    call npm.cmd run build
    if errorlevel 1 goto :failed
)

echo Starting local speaker detection service...
start "WhisperForFiles Speaker Detection" /min "%~dp0local_backend\.venv\Scripts\python.exe" -m uvicorn server:app --app-dir "%~dp0local_backend" --host 127.0.0.1 --port 8001

echo Starting WhisperForFiles at http://127.0.0.1:3000
start "" powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process 'http://127.0.0.1:3000'"
call npm.cmd run start -- -H 127.0.0.1 -p 3000
if errorlevel 1 goto :failed
exit /b 0

:not_installed
echo WhisperForFiles is not installed yet.
echo Run Install-WhisperForFiles-Windows.cmd first.
pause
exit /b 1

:failed
echo.
echo WhisperForFiles could not start. Review the error above.
pause
exit /b 1

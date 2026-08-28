@echo off
setlocal
cd /d "%~dp0"

if not exist "windows\install.ps1" (
    echo ERROR: windows\install.ps1 was not found.
    echo Keep this installer inside the WhisperForFiles project folder.
    pause
    exit /b 1
)

echo Installing WhisperForFiles for Windows...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install.ps1"
set "INSTALL_EXIT=%ERRORLEVEL%"

if not "%INSTALL_EXIT%"=="0" (
    echo.
    echo Installation failed. Review the error above, then run this file again.
    pause
    exit /b %INSTALL_EXIT%
)

echo.
echo Installation completed successfully.
pause
exit /b 0

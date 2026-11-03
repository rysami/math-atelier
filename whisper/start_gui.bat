@echo off
rem  Keep this file pure ASCII - cmd.exe parses .bat with the console codepage.
rem  chcp 65001 makes Python's UTF-8 output display correctly.
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Local Whisper GUI
echo ============================================
echo.
echo   The browser will open automatically.
echo   Close this window to stop the GUI.
echo ============================================
echo.

"%~dp0venv\Scripts\python.exe" "%~dp0app_gui.py" %*

echo.
echo GUI stopped.
pause

@echo off
rem  Keep this file pure ASCII - cmd.exe parses .bat with the console codepage.
rem  chcp 65001 makes Python's UTF-8 output display correctly.
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Local Whisper API server
echo ============================================
echo.
echo   Base URL : http://127.0.0.1:8000/v1
echo   API Key  : sk-anything   (not validated by default)
echo   Model    : large-v3
echo.
echo   Close this window to stop the server.
echo ============================================
echo.

"%~dp0venv\Scripts\python.exe" "%~dp0server.py" --preload %*

echo.
echo Server stopped.
pause

@echo off
rem  Batch files are parsed by cmd.exe using the console codepage, so this file
rem  must stay pure ASCII. chcp 65001 is only here so Python's UTF-8 output
rem  (Chinese transcriptions) renders correctly.
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" goto usage

echo Transcribing %* ...
echo.
"%~dp0venv\Scripts\python.exe" "%~dp0transcribe.py" %* --format all
echo.
goto done

:usage
echo.
echo   Drag audio/video files onto this .bat to transcribe them.
echo   Outputs .txt / .srt / .vtt / .json next to each source file.
echo.

:done
echo Press any key to close.
pause >nul

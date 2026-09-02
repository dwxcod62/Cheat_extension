# restart_whisper_server.bat
# Tắt mọi whisper_server.py đang chạy rồi khởi động lại.
# Chạy từ thư mục gốc project: .\restart_whisper_server.bat
@echo off
chcp 65001 >nul
echo ============================================
echo   KudaVas Whisper Server — Restart Script
echo ============================================

echo.
echo [1/3] Killing all old whisper_server.py processes...
for /f "tokens=2 delims=," %%P in (
  'tasklist /FI "IMAGENAME eq python.exe" /FO CSV /NH'
) do (
  for /f "tokens=*" %%L in ('wmic process where "ProcessId=%%P" get CommandLine /FORMAT:LIST 2^>nul ^| findstr /C:"whisper_server.py"') do (
    echo   Killing PID %%P ...
    taskkill /F /PID %%P >nul 2>&1
  )
)

echo.
echo [2/3] Waiting port 8765 to free up...
timeout /t 2 >nul

echo.
echo [3/3] Starting whisper_server.py in new window...
cd /d "%~dp0"
start "KudaVas Whisper Server" cmd /k "title KudaVas Whisper && python whisper_server.py"

echo.
echo Done! Check the new window for server logs.
pause

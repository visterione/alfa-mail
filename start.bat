@echo off
echo Starting AlfaMail...

start "AlfaMail Server" cmd /k "cd /d %~dp0server && npm run dev"
timeout /t 2 /nobreak > nul
start "AlfaMail Client" cmd /k "cd /d %~dp0client && npm run dev"

echo.
echo Server: http://localhost:3001
echo Client: http://localhost:5173
echo.
pause

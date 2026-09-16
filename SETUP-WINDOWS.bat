@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)
if not exist ".env.local" (
  copy /Y ".env.local.example" ".env.local" >nul
)
echo.
echo Starting My Music...
echo Open http://localhost:3000 after the server starts.
call npm run dev
exit /b %errorlevel%
:error
echo.
echo Dependency installation failed. Make sure Node.js 20+ and npm are installed, then run this file again.
pause
exit /b 1

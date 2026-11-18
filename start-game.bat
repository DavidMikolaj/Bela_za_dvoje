@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js 20.19+ or 22.12+ and reopen this terminal.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found. Reinstall Node.js with npm included.
  exit /b 1
)
if not exist "server\node_modules\express" (
  echo ERROR: Backend dependencies are missing. Run npm install --prefix server.
  exit /b 1
)
if not exist "server\node_modules\socket.io" (
  echo ERROR: Socket.IO is missing. Run npm install --prefix server.
  exit /b 1
)
if not exist "server\dist\index.js" (
  echo ERROR: The production backend build is missing. Run build-game.bat first.
  exit /b 1
)
if not exist "client\dist\index.html" (
  echo ERROR: The production frontend build is missing. Run build-game.bat first.
  exit /b 1
)

if not defined PORT set "PORT=3000"
if not defined HOST set "HOST=127.0.0.1"
set "NODE_ENV=production"

echo Starting Bela za dvoje. Keep this window open while hosting.
echo Local game: http://localhost:%PORT%/
echo For remote access, run cloudflared tunnel --url http://localhost:%PORT% in another terminal.
echo Press Ctrl+C here to stop the game server.
call npm --prefix server start
exit /b %ERRORLEVEL%

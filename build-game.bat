@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found. Install Node.js 20.19+ or 22.12+ and reopen this terminal.
  exit /b 1
)

if not exist "client\node_modules\vite" (
  echo ERROR: Frontend dependencies are missing. Run npm install --prefix client.
  exit /b 1
)
if not exist "client\node_modules\typescript" (
  echo ERROR: Frontend TypeScript is missing. Run npm install --prefix client.
  exit /b 1
)
if not exist "server\node_modules\express" (
  echo ERROR: Backend dependencies are missing. Run npm install --prefix server.
  exit /b 1
)
if not exist "server\node_modules\typescript" (
  echo ERROR: Backend TypeScript is missing. Run npm install --prefix server.
  exit /b 1
)

echo Building the frontend and backend for production...
call npm run build
if errorlevel 1 (
  echo ERROR: Production build failed. Fix the reported build errors and try again.
  exit /b 1
)

echo Production build completed successfully.
exit /b 0

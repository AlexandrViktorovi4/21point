@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [*] Starting game: http://localhost:3456
start "21point-server" cmd /k "npm start"

echo.
echo ============================================================
echo  Public access without Radmin (for friends in Russia):
echo.
echo  Option A - playit.gg (game tunnel)
echo    1) Open playit GUI from Start menu: playit
echo    2) Log in / claim agent in browser
echo    3) Add tunnel: TCP or HTTP -^> local port 3456
echo    4) Copy the public address playit shows
echo       Friends open that address in browser
echo.
echo  Option B - free web host Render.com
echo    Deploy once, get permanent https://....onrender.com
echo    (may sleep on free plan; wake on first open)
echo ============================================================
echo.
pause

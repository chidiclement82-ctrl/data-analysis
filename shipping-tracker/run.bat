@echo off
REM ==========================================================================
REM  Shipping Tracker - Windows launcher
REM
REM  Double-click this file (or run it from PowerShell / Command Prompt) to:
REM    1. create a local Python virtual environment
REM    2. install Flask + gunicorn's Windows-friendly server (waitress)
REM    3. download cloudflared for Windows if it isn't already present
REM    4. start the app and open a free public cloudflared quick tunnel
REM
REM  To set a fixed admin password, either set ADMIN_PASSWORD in your
REM  environment before running, or edit the line just below.
REM ==========================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM --- Admin password ------------------------------------------------------
REM  Leave as-is to be prompted, or replace the "" with your password, e.g.
REM      set "ADMIN_PASSWORD=my-strong-password"
if "%ADMIN_PASSWORD%"=="" (
    set /p ADMIN_PASSWORD="Choose an admin password (press Enter to auto-generate): "
)

set "PORT=8000"

REM --- 1. Find Python ------------------------------------------------------
where python >nul 2>&1
if errorlevel 1 (
    echo [error] Python was not found on your PATH.
    echo         Install it from https://www.python.org/downloads/ and be sure
    echo         to check "Add python.exe to PATH", then run this again.
    pause
    exit /b 1
)

REM --- 2. Virtual environment + dependencies -------------------------------
if not exist ".venv\Scripts\python.exe" (
    echo [setup] Creating virtual environment...
    python -m venv .venv
)
set "VENV_PY=.venv\Scripts\python.exe"

echo [setup] Installing dependencies...
"%VENV_PY%" -m pip install --quiet --upgrade pip
"%VENV_PY%" -m pip install --quiet flask waitress

REM --- 3. Download cloudflared for Windows if needed -----------------------
set "CF=cloudflared.exe"
where cloudflared >nul 2>&1
if not errorlevel 1 (
    set "CF=cloudflared"
) else (
    if not exist "%CF%" (
        echo [setup] Downloading cloudflared for Windows...
        set "CF_URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        powershell -NoProfile -Command "Invoke-WebRequest -Uri '!CF_URL!' -OutFile '%CF%'"
        if errorlevel 1 (
            echo [error] Could not download cloudflared. Check your internet connection.
            pause
            exit /b 1
        )
    )
)

REM --- 4. Start the web server (waitress) in a new window ------------------
echo [run] Starting web server on http://127.0.0.1:%PORT% ...
start "Shipping Tracker - server" "%VENV_PY%" -m waitress --listen=127.0.0.1:%PORT% app:app

REM Give the server a moment to come up.
powershell -NoProfile -Command "Start-Sleep -Seconds 3"

REM --- 5. Open the public tunnel ------------------------------------------
echo.
echo ============================================================
echo   Look below for your public link:
echo     https://<random>.trycloudflare.com
echo.
echo   Customer page:  that link  (the /  home page)
echo   Admin login:    that link + /admin
echo.
echo   Keep this window open. Close it to stop the tunnel,
echo   and close the "server" window to stop the app.
echo ============================================================
echo.
"%CF%" tunnel --no-autoupdate --url http://127.0.0.1:%PORT%

endlocal
pause

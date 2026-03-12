@echo off
:: Wait for Docker Desktop to be ready
:wait_docker
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" info >nul 2>&1
if errorlevel 1 (
    timeout /t 5 /nobreak >nul
    goto wait_docker
)

:: Resurrect PM2 saved processes (includes nanoclaw)
set PATH=C:\Program Files\nodejs;C:\Users\YCR\AppData\Roaming\npm;C:\Program Files\Docker\Docker\resources\bin;%PATH%
call pm2 resurrect --no-daemon-mode 2>nul
call pm2 resurrect

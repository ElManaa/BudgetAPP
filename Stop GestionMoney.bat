@echo off
title Stop GestionMoney
echo Closing every GestionMoney server...
echo.
powershell -NoProfile -Command "$n=0; Get-CimInstance Win32_Process -Filter \"Name='python.exe' OR Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*server.py*' } | ForEach-Object { Write-Host ('  stopping PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; if ($n -eq 0) { Write-Host '  nothing was running' } else { Write-Host ('  closed ' + $n + ' server(s)') }"
echo.
echo Done. You can start GestionMoney again now.
ping -n 4 127.0.0.1 >nul 2>&1

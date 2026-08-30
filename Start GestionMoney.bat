@echo off
title GestionMoney
cd /d "%~dp0"
python server.py
if errorlevel 1 (
  echo.
  echo Could not start. Is Python installed and on PATH?
  pause
)

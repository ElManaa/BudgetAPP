@echo off
title GestionMoney - import spreadsheet
cd /d "%~dp0"
python -m pip install openpyxl
python tools\import_xlsx.py %1 --wipe
pause

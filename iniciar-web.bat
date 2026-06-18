@echo off
title Coral Miguel de Ambiela - Servidor local
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  set PYCMD=python
) else (
  where py >nul 2>nul
  if %errorlevel%==0 (
    set PYCMD=py
  ) else (
    echo No se ha encontrado Python en este ordenador.
    echo Instala Python desde https://www.python.org/downloads/ y vuelve a intentarlo.
    pause
    exit /b 1
  )
)

echo Iniciando servidor local en http://localhost:8000 ...
start "Coral - servidor local (no cerrar)" /min cmd /c "%PYCMD% -m http.server 8000"

timeout /t 2 /nobreak > nul
start "" http://localhost:8000/index.html

echo.
echo La web ya esta abierta en tu navegador.
echo NO cierres la ventana "Coral - servidor local" mientras trabajes:
echo si la cierras, el guardado de fotos dejara de funcionar.
echo.
pause

@echo off
rem Cloud Slicer bridge for Windows, from Command Prompt. Cloud Slicer gives the
rem line with your setup code (Printers ^& bridges, Add a bridge):
rem
rem   curl -fsSL "__RELAY_URL__/install.cmd?code=XXXX-XXXX" -o "%TEMP%\cloud-slicer-bridge.cmd" && "%TEMP%\cloud-slicer-bridge.cmd"
rem
rem Downloads the bridge, adds it to your Cloud Slicer account with the setup code
rem (it works once, within the hour; if it expired, this asks for a new one) and
rem makes it start by itself whenever you sign in to Windows, with no window.
setlocal
set "RELAY=__RELAY_URL__"
set "CODE=__SETUP_CODE__"
set "EXE=%TEMP%\cloud-slicer-bridge-setup.exe"
echo Downloading Cloud Slicer Bridge...
curl -fsSL -o "%EXE%" "%RELAY%/download/windows-x64"
if errorlevel 1 (
  echo The download failed. Check the internet connection and try again.
  goto :end
)
:again
rem A batch file waits for the bridge; it writes to this window and exits with 3 when the setup code didn't work.
if defined CODE ("%EXE%" install --no-browser --code "%CODE%") else ("%EXE%" install --no-browser)
if errorlevel 4 goto :done
if not errorlevel 3 goto :done
set "CODE="
set /p "CODE=Paste the new setup code here: "
if not defined CODE (
  echo Nothing installed.
  goto :done
)
goto :again
:done
del "%EXE%" >nul 2>&1
:end
endlocal
rem This file carried a setup code: it removes itself.
(goto) 2>nul & del "%~f0"

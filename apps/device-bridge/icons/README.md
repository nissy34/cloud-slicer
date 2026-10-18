The bridge app's icon, the same nozzle-and-layers logo as the website (apps/web/public/icon.svg):
icon.ico for Windows, icon.icns for macOS, icon.png for Linux.

build-apps.sh puts them in the apps: the Windows .exe's icon (`--windows-icon`, which bun can only
do on Windows, so CI builds it on a Windows runner), the Mac app's `Cloud Slicer Bridge.app` bundle
(built and signed ad hoc on a macOS runner), and the Linux app, which carries icon.png and gives
itself a menu entry with it on `install`.

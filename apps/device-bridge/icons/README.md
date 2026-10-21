The bridge app's icon, the same nozzle-and-layers logo as the website (apps/web/public/icon.svg):
icon.icns for macOS, icon.png for Windows (made into resources at build time) and Linux.

build.sh puts them in the apps: the Windows .exe's icon and name (resources made with go-winres
from icon.png), the Mac app's `Cloud Slicer Bridge.app` bundle (icon.icns; signed ad hoc on a
macOS runner), and every build carries icon.png, which the Linux app gives its menu entry on
`install`.

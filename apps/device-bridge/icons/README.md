The bridge app's icon, the same nozzle-and-layers logo as the website (apps/web/public/icon.svg):
icon.ico for Windows, icon.icns for macOS, icon.png for Linux.

Not wired into build-apps.sh yet (PR #34, in review, does it): `bun build --compile --windows-icon` only works
when building on Windows, and a Mac icon needs the app wrapped in an .app bundle.

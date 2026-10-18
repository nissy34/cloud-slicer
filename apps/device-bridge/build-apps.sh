#!/bin/sh
# Builds the one-file bridge apps into dist/ (bun build --compile: bridge.mjs
# plus the Bun runtime, so nothing needs installing), named as the relay stores
# them (bridge/<name> in R2), each with the app icon from icons/:
#
#   ./build-apps.sh linux     linux-x64, linux-arm64 (the icon is built in; install puts it in the menu)
#   ./build-apps.sh windows   windows-x64 (on Windows: bun can only set an .exe's icon there)
#   ./build-apps.sh mac       mac-arm64, mac-x64 (on macOS: "Cloud Slicer Bridge.app" in a zip, signed ad hoc)
#
# With no argument it builds what this computer can. The Mac app goes in a zip
# so it keeps its "can run" flag when downloaded; the ad hoc signature (free,
# not Apple's) is what Apple chips need before anything runs, and it has to
# cover the whole .app, or macOS calls a downloaded app damaged.
set -eu
cd "$(dirname "$0")"
VERSION=$(sed -n "s/^export const VERSION = '\(.*\)';/\1/p" bridge.mjs)
case "${1:-}" in
  '') case "$(uname -s)" in Darwin) systems='linux mac' ;; MINGW* | MSYS* | CYGWIN*) systems='linux windows' ;; *) systems=linux ;; esac ;;
  *) systems="$*" ;;
esac
mkdir -p dist
rm -rf dist/tmp
mkdir -p dist/tmp

for system in $systems; do
  case "$system" in
    linux)
      for arch in x64 arm64; do
        # The extra entry point builds icon.png into the app (Bun.embeddedFiles).
        bun build --compile --minify --target="bun-linux-$arch" bridge.mjs icons/icon.png --outfile "dist/linux-$arch"
      done
      ;;
    windows)
      bun build --compile --minify --target=bun-windows-x64 --windows-icon=icons/icon.ico --windows-title='Cloud Slicer Bridge' \
        --windows-description='Lets Cloud Slicer reach printers on this network' --windows-version="$VERSION.0.0.0" bridge.mjs --outfile dist/tmp/windows-x64.exe
      mv dist/tmp/windows-x64.exe dist/windows-x64
      ;;
    mac)
      for arch in arm64 x64; do
        app="dist/tmp/mac-$arch/Cloud Slicer Bridge.app"
        mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
        bun build --compile --minify --target="bun-darwin-$arch" bridge.mjs --outfile "$app/Contents/MacOS/cloud-slicer-bridge"
        cp icons/icon.icns "$app/Contents/Resources/icon.icns"
        # LSUIElement: no Dock icon; opened from Finder the app only sets itself up and opens the pairing link.
        cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Cloud Slicer Bridge</string>
  <key>CFBundleDisplayName</key><string>Cloud Slicer Bridge</string>
  <key>CFBundleIdentifier</key><string>io.qzz.awesomestuff.cloud-slicer-bridge</string>
  <key>CFBundleExecutable</key><string>cloud-slicer-bridge</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
        codesign --force --sign - "$app"
        codesign --verify --strict "$app"
        (cd "dist/tmp/mac-$arch" && ditto -c -k --keepParent "Cloud Slicer Bridge.app" "../../mac-$arch")
      done
      ;;
    *) echo "Unknown system $system (linux, windows or mac)" >&2; exit 1 ;;
  esac
done
rm -rf dist/tmp
ls -l dist

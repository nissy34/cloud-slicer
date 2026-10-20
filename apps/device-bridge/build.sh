#!/bin/sh
# Builds the bridge apps into dist/, one small file per system and chip with
# nothing else needed to run it, named as the relay stores them (bridge/<name>
# in R2):
#
#   ./build.sh                 every Linux chip, plus Windows (with its icon)
#   ./build.sh mac             the two Mac apps (on macOS: signs the .app ad hoc)
#   ./build.sh linux-arm64 ... only these
#
# linux-x64 (PCs, mini PCs), linux-arm64 (64-bit Pi OS, Armbian boards, the
# Snapmaker U1), linux-armv7 (32-bit Pi OS, Sonic Pad), linux-mipsle (Creality
# K1 series; soft float, so it runs on any MIPS32 chip), windows-x64 (no
# window, so nothing in the taskbar), mac-arm64 and mac-x64 ("Cloud Slicer
# Bridge.app" in a zip, no Dock icon).
#
# RELAY_URL and SITE_URL set the relay and site the bridge belongs to (default:
# the live ones).
set -eu
cd "$(dirname "$0")"
VERSION=$(sed -n 's/^const version = "\(.*\)"$/\1/p' main.go)
case "${1:-}" in
  '') targets='linux-x64 linux-arm64 linux-armv7 linux-mipsle windows-x64' ;;
  mac) targets='mac-arm64 mac-x64' ;;
  *) targets="$*" ;;
esac
ldflags="-s -w"
[ -n "${RELAY_URL:-}" ] && ldflags="$ldflags -X main.defaultRelay=$RELAY_URL"
[ -n "${SITE_URL:-}" ] && ldflags="$ldflags -X main.defaultSite=$SITE_URL"
mkdir -p dist
rm -rf dist/tmp
mkdir -p dist/tmp

build() { # <goos> <goarch> <out> [extra ldflags]
  CGO_ENABLED=0 GOOS=$1 GOARCH=$2 GOARM=${GOARM:-} GOMIPS=${GOMIPS:-} \
    go build -trimpath -ldflags "$ldflags ${4:-}" -o "$3" .
}

for target in $targets; do
  case "$target" in
    linux-x64) build linux amd64 dist/linux-x64 ;;
    linux-arm64) build linux arm64 dist/linux-arm64 ;;
    linux-armv7) GOARM=7 build linux arm dist/linux-armv7 ;;
    linux-mipsle) GOMIPS=softfloat build linux mipsle dist/linux-mipsle ;;
    windows-x64)
      # The icon and name Windows shows (Properties, Task Manager), as resources
      # linked into the .exe. -H windowsgui: a program with no window at all.
      go run github.com/tc-hib/go-winres@v0.3.3 simply --arch amd64 --manifest gui --icon icons/icon.png \
        --product-name 'Cloud Slicer Bridge' --file-description 'Lets Cloud Slicer reach printers on this network' \
        --product-version "$VERSION.0.0.0" --file-version "$VERSION.0.0.0" --original-filename cloud-slicer-bridge.exe
      build windows amd64 dist/windows-x64 "-H windowsgui"
      rm -f rsrc_windows_amd64.syso
      ;;
    mac-arm64 | mac-x64)
      arch=${target#mac-}
      [ "$arch" = x64 ] && goarch=amd64 || goarch=arm64
      app="dist/tmp/$target/Cloud Slicer Bridge.app"
      mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
      build darwin "$goarch" "$app/Contents/MacOS/cloud-slicer-bridge"
      cp icons/icon.icns "$app/Contents/Resources/icon.icns"
      # LSUIElement: no Dock icon; opened from Finder the app only sets itself up and opens the pairing link.
      cat > "$app/Contents/Info.plist" <<PLIST
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
PLIST
      # Apple chips run nothing unsigned; the ad hoc signature (free, not Apple's) has
      # to cover the whole .app, or macOS calls a downloaded app damaged.
      if command -v codesign >/dev/null 2>&1; then codesign --force --deep --sign - "$app"; fi
      # In a zip, so it keeps its "can run" flag when downloaded.
      # Off a Mac (no ditto), Python's zip keeps the flag too.
      rm -f "dist/$target"
      if command -v ditto >/dev/null 2>&1; then
        (cd "dist/tmp/$target" && ditto -c -k --keepParent "Cloud Slicer Bridge.app" "../../$target")
      else
        (cd "dist/tmp/$target" && python3 -m zipfile -c "../../$target" "Cloud Slicer Bridge.app")
      fi
      ;;
    *) echo "Unknown target $target" >&2; exit 1 ;;
  esac
  echo "dist/$target: $(wc -c < "dist/$target") bytes"
done
rm -rf dist/tmp

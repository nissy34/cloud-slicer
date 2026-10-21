#!/bin/sh
# Cloud Slicer bridge for macOS, Linux and Raspberry Pi, in one command:
#
#   curl -fsSL __RELAY_URL__/install.sh | sh
#
# Downloads the bridge app for this computer, finds the printers on your
# network, makes the bridge start by itself with the computer (a launch agent
# on macOS, a systemd user service on Linux), and opens or prints the link
# that adds your printers in Cloud Slicer. On a Mac this also avoids the
# "could not verify" block: macOS only checks apps downloaded by a browser.
# Run it again to update. Remove with: cloud-slicer-bridge uninstall
#
# On a Klipper printer itself (a Pi, a Snapmaker U1, a Creality K1 or K2, a Sonic
# Pad...), over SSH:
#
#   curl -fsSL __RELAY_URL__/install.sh | sh -s -- --printer
#
# installs it as a service on the printer that serves that printer (sudo is used
# when needed). Remove it the same way with: sh -s -- --printer --uninstall
set -eu

printer=""
uninstall=""
for a in "$@"; do
  case "$a" in
    --printer) printer=1 ;;
    --uninstall) uninstall=1 ;;
  esac
done

RELAY="__RELAY_URL__"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=mac ;;
  *) echo "This installer is for macOS and Linux. On Windows, download the bridge app from the Device tab." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  armv7* | armv8l) arch=armv7 ;;
  mips) arch=mipsle ;;
  *) echo "There is no bridge app for $(uname -m) yet." >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading the Cloud Slicer bridge ($os-$arch)..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "$tmp/download" "$RELAY/download/$os-$arch"
else
  wget -q -O "$tmp/download" "$RELAY/download/$os-$arch"
fi
if [ "$os" = mac ]; then
  # The Mac app comes zipped (so a browser download keeps it runnable).
  unzip -q "$tmp/download" -d "$tmp"
  app="$tmp/Cloud Slicer Bridge.app/Contents/MacOS/cloud-slicer-bridge"
else
  app="$tmp/cloud-slicer-bridge"
  mv "$tmp/download" "$app"
fi
chmod +x "$app"

if [ -n "$printer" ]; then
  [ "$os" = linux ] || { echo "--printer is for the printer's own Linux computer." >&2; exit 1; }
  cmd=install-printer
  [ -n "$uninstall" ] && cmd=uninstall
  # A service on the printer needs root.
  if [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null 2>&1 || { echo "Run this as root (log in as root, or install sudo)." >&2; exit 1; }
    sudo "$app" "$cmd"
  else
    "$app" "$cmd"
  fi
  exit 0
fi

# install copies the app somewhere stable, starts it with the computer, and
# prints the pairing link.
"$app" install

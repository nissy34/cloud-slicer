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
set -eu

RELAY="__RELAY_URL__"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=mac ;;
  *) echo "This installer is for macOS and Linux. On Windows, download the bridge app from the Device tab." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *)
    echo "There is no bridge app for $(uname -m) (a 32-bit Raspberry Pi OS?)." >&2
    echo "Use the Node.js bridge instead (Node.js 22 or newer): $RELAY/bridge.mjs" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading the Cloud Slicer bridge ($os-$arch)..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "$tmp/download" "$RELAY/download/$os-$arch"
else
  wget -q --show-progress -O "$tmp/download" "$RELAY/download/$os-$arch"
fi
if [ "$os" = mac ]; then
  # The Mac app comes zipped (so a browser download keeps it runnable).
  unzip -q "$tmp/download" -d "$tmp"
  app="$tmp/Cloud Slicer Bridge"
else
  app="$tmp/cloud-slicer-bridge"
  mv "$tmp/download" "$app"
fi
chmod +x "$app"

# install copies the app somewhere stable, starts it with the computer, and
# prints the pairing link.
"$app" install
if [ "$os" = linux ]; then
  # The command itself, for add / list / uninstall later.
  mkdir -p "$HOME/.local/bin"
  ln -sf "$HOME/.local/share/cloud-slicer-bridge/cloud-slicer-bridge" "$HOME/.local/bin/cloud-slicer-bridge"
fi

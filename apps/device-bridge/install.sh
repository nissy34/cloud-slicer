#!/bin/sh
# Cloud Slicer bridge for Linux and Raspberry Pi, in one command:
#
#   curl -fsSL __RELAY_URL__/install.sh | sh
#
# Downloads the bridge app for this computer, finds the printers on your
# network, makes the bridge start by itself with the computer (a systemd user
# service), and prints the link that adds your printers in Cloud Slicer.
# Run it again to update. Remove with: cloud-slicer-bridge uninstall
set -eu

RELAY="__RELAY_URL__"

case "$(uname -s)" in
  Linux) ;;
  *) echo "This installer is for Linux. On Windows and macOS, download the bridge app from the Device tab." >&2; exit 1 ;;
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
echo "Downloading the Cloud Slicer bridge (linux-$arch)..."
if command -v curl >/dev/null 2>&1; then
  curl -fL --progress-bar -o "$tmp/cloud-slicer-bridge" "$RELAY/download/linux-$arch"
else
  wget -q --show-progress -O "$tmp/cloud-slicer-bridge" "$RELAY/download/linux-$arch"
fi
chmod +x "$tmp/cloud-slicer-bridge"

# install copies the app to ~/.local/share/cloud-slicer-bridge, starts it with the computer,
# and prints the pairing link. A link for the command itself goes in ~/.local/bin.
"$tmp/cloud-slicer-bridge" install
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/.local/share/cloud-slicer-bridge/cloud-slicer-bridge" "$HOME/.local/bin/cloud-slicer-bridge"

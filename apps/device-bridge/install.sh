#!/bin/sh
# Cloud Slicer bridge for macOS, Linux and Raspberry Pi, in one command. Cloud
# Slicer gives it with your setup code (Printers & bridges, Add a bridge):
#
#   curl -fsSL "__RELAY_URL__/install.sh?code=XXXX-XXXX" | sh
#
# Downloads the bridge app for this computer, adds the bridge to your Cloud
# Slicer account with the setup code (it works once, within the hour; if it
# expired, this asks for a new one), and makes the bridge start by itself with
# the computer (a launch agent on macOS, a systemd user service on Linux). On a
# Mac this also avoids the "could not verify" block: macOS only checks apps
# downloaded by a browser. Run it again to update. Remove with:
# cloud-slicer-bridge uninstall, or Remove bridge in Cloud Slicer.
#
# On a Klipper printer itself (a Pi, a Snapmaker U1, a Creality K1 or K2, a Sonic
# Pad...), over SSH:
#
#   curl -fsSL "__RELAY_URL__/install.sh?code=XXXX-XXXX" | sh -s -- --printer
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
CODE="__SETUP_CODE__"

# Runs the bridge with the setup code; while the code doesn't work (expired, used,
# mistyped: the bridge exits with 3), asks for a new one. Input comes from the
# terminal, since this script itself arrives on stdin.
with_code() {
  while :; do
    set +e
    if [ -n "$CODE" ]; then "$@" --code "$CODE"; else "$@"; fi
    rc=$?
    set -e
    [ "$rc" = 3 ] && [ -r /dev/tty ] || return "$rc"
    printf 'Paste the new setup code here: ' >/dev/tty
    read -r CODE </dev/tty || return 1
    [ -n "$CODE" ] || { echo "Nothing installed."; return 1; }
  done
}

# Removing (--uninstall, with or without --printer): nothing is downloaded, the
# bridge already installed here removes itself (with sudo for a printer service).
if [ -n "$uninstall" ]; then
  NAME="__BRIDGE_NAME__"
  for d in /usr/data/printer_data "$HOME/printer_data" /home/*/printer_data /root/printer_data; do
    if [ -x "$d/$NAME/$NAME" ]; then
      # The service needs root to remove.
      if [ "$(id -u)" != 0 ] && command -v sudo >/dev/null 2>&1; then
        sudo "$d/$NAME/$NAME" uninstall --printer-data "$d"
      else
        "$d/$NAME/$NAME" uninstall --printer-data "$d"
      fi
      exit $?
    fi
  done
  [ -n "$printer" ] && { echo "There is no Cloud Slicer bridge on this printer."; exit 0; }
  flavor="${NAME#cloud-slicer-bridge-}"
  [ "$flavor" = "$NAME" ] && mac="Cloud Slicer Bridge" || mac="Cloud Slicer Bridge ($flavor)"
  for exe in "$HOME/.local/share/$NAME/$NAME" "$HOME/Library/Application Support/$mac/$NAME"; do
    if [ -x "$exe" ]; then
      "$exe" uninstall
      exit $?
    fi
  done
  echo "There is no Cloud Slicer bridge set up to start with this computer. If one is open, closing its window stops it."
  exit 0
fi

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=mac ;;
  *) echo "This installer is for macOS and Linux. On Windows, use the PowerShell or Command Prompt line from Add a bridge." >&2; exit 1 ;;
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
    set -- sudo "$app" "$cmd"
  else
    set -- "$app" "$cmd"
  fi
  if [ -n "$uninstall" ]; then "$@"; else with_code "$@"; fi
  exit $?
fi

# install adds the bridge to your account, copies the app somewhere stable and
# starts it with the computer.
with_code "$app" install

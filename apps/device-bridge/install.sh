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
# downloaded by a browser. Run it again to update. Remove with Remove bridge in
# Cloud Slicer, or here (a computer, a Pi or a printer alike):
#
#   curl -fsSL "__RELAY_URL__/install.sh" | sh -s -- --uninstall
#
# On a Klipper printer itself (a Pi, a Snapmaker U1, a Creality K1 or K2, a Sonic
# Pad...), over SSH:
#
#   curl -fsSL "__RELAY_URL__/install.sh?code=XXXX-XXXX" | sh -s -- --printer
#
# installs it as a service on the printer that serves that printer (sudo is used
# when needed). Remove it with the --uninstall line above (--printer --uninstall works too).
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

# Removing: one line for a computer, a Pi or a printer. The bridge finds where it
# was installed (on a printer it asks for sudo when it needs root).
if [ -n "$uninstall" ] && [ -z "$printer" ]; then
  "$app" uninstall
  exit $?
fi

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

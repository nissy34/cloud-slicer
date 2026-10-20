#!/bin/sh
# Builds the Go bridge into dist/go/, one small file per system and chip, with
# nothing else needed to run it:
#
#   ./build.sh                 every Linux chip a Klipper printer or a Pi uses
#   ./build.sh linux-arm64 ... only these
#
# linux-x64 (mini PCs), linux-arm64 (64-bit Pi OS, Armbian boards, the
# Snapmaker U1), linux-armv7 (32-bit Pi OS, Sonic Pad), linux-mipsle (Creality
# K1 series; soft float, so it runs on any MIPS32 chip). Also windows-x64,
# mac-arm64 and mac-x64 when named.
#
# RELAY_URL and SITE_URL set the relay and site the bridge belongs to (default:
# the live ones).
set -eu
cd "$(dirname "$0")"
targets="${*:-linux-x64 linux-arm64 linux-armv7 linux-mipsle}"
ldflags="-s -w"
[ -n "${RELAY_URL:-}" ] && ldflags="$ldflags -X main.defaultRelay=$RELAY_URL"
[ -n "${SITE_URL:-}" ] && ldflags="$ldflags -X main.defaultSite=$SITE_URL"
mkdir -p dist/go
for target in $targets; do
  goarm='' gomips=''
  case "$target" in
    linux-x64) goos=linux goarch=amd64 ;;
    linux-arm64) goos=linux goarch=arm64 ;;
    linux-armv7) goos=linux goarch=arm goarm=7 ;;
    linux-mipsle) goos=linux goarch=mipsle gomips=softfloat ;;
    windows-x64) goos=windows goarch=amd64 ;;
    mac-arm64) goos=darwin goarch=arm64 ;;
    mac-x64) goos=darwin goarch=amd64 ;;
    *) echo "Unknown target $target" >&2; exit 1 ;;
  esac
  CGO_ENABLED=0 GOOS=$goos GOARCH=$goarch GOARM=$goarm GOMIPS=$gomips \
    go build -trimpath -ldflags "$ldflags" -o "dist/go/$target" .
  echo "dist/go/$target: $(wc -c < "dist/go/$target") bytes"
done

#!/usr/bin/env bash
# Downloads desktop Snapmaker Orca or OrcaSlicer for Linux, the release of the
# same version as our engine's sources, and prints the path of its launcher
# (AppRun). The command line slices without a screen; it needs these Ubuntu
# packages: libopengl0 libglu1-mesa libegl1 libwebkit2gtk-4.1-0.
#
#   engine/desktop-check/desktop.sh snapmaker|orca
#
# Kept in $DESKTOP_ORCA_DIR (default ~/.cache/desktop-orca). Each download is
# checked against the SHA-256 below; after an engine update, add the new
# version's line (the error prints it). For Snapmaker Orca, Snapmaker's preset
# pack in engine/presets/snapmaker/ (our engine's presets have it) is installed
# into desktop's presets too, as desktop's preset update would: the zip from
# pack.json's url, checked against its sha256.
set -euo pipefail
flavor=${1:?usage: desktop.sh snapmaker|orca}
here=$(cd "$(dirname "$0")" && pwd)
DIR=${DESKTOP_ORCA_DIR:-$HOME/.cache/desktop-orca}

case "$flavor" in
  snapmaker) inc=$here/../orcaslicer/version.inc; var=Snapmaker_VERSION; repo=Snapmaker/OrcaSlicer; file=Snapmaker_Orca ;;
  orca) inc=$here/../orcaslicer-upstream/version.inc; var=SoftFever_VERSION; repo=OrcaSlicer/OrcaSlicer; file=OrcaSlicer ;;
  *) echo "unknown engine $flavor (snapmaker or orca)" >&2; exit 2 ;;
esac
version=$(sed -n "s/^set($var \"\([^\"]*\)\")/\1/p" "$inc")
[ -n "$version" ] || { echo "no $var in $inc (fetch the submodule first)" >&2; exit 1; }

declare -A SHA256=(
  [snapmaker-2.4.1]=2b5117e22d04a3a27bcdfc5a873c55d28ff3b7ce9721946de1f134fa97d2cc06
  [orca-2.4.2]=d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd
  [orca-2.5.0]=d13eb0a9cd618ed080ab6b82c64c0a60c4501aac91e88d5ac2c3b526fb141a7c
)

pack_json=$here/../presets/snapmaker/pack.json
pack=
if [ "$flavor" = snapmaker ] && [ -f "$pack_json" ]; then
  pack=$(node -p "const p=require(process.argv[1]); [p.version,p.url,p.sha256].join(' ')" "$pack_json")
fi
read -r pack_version pack_url pack_sha <<< "$pack"

out=$DIR/$flavor-$version${pack_version:+-presets-$pack_version}
if [ ! -x "$out/squashfs-root/AppRun" ]; then
  url=https://github.com/$repo/releases/download/v$version/${file}_Linux_AppImage_Ubuntu2404_V$version.AppImage
  rm -rf "$out"; mkdir -p "$out"
  echo "Downloading $url" >&2
  curl -fsSL --retry 4 --retry-all-errors -o "$out/app.AppImage" "$url"
  sum=$(sha256sum "$out/app.AppImage" | cut -d' ' -f1)
  want=${SHA256[$flavor-$version]:-}
  if [ "$sum" != "$want" ]; then
    echo "SHA-256 of $flavor $version is $sum; expected ${want:-nothing (new version)}." >&2
    echo "If this is a new release, add  [$flavor-$version]=$sum  to engine/desktop-check/desktop.sh" >&2
    exit 1
  fi
  chmod +x "$out/app.AppImage"
  (cd "$out" && ./app.AppImage --appimage-extract > /dev/null)
  rm "$out/app.AppImage"
  if [ -n "$pack_version" ]; then
    echo "Installing Snapmaker presets $pack_version from $pack_url" >&2
    curl -fsSL --retry 4 --retry-all-errors -o "$out/presets.zip" "$pack_url"
    sum=$(sha256sum "$out/presets.zip" | cut -d' ' -f1)
    if [ "$sum" != "$pack_sha" ]; then
      echo "SHA-256 of Snapmaker presets $pack_version is $sum; engine/presets/snapmaker/pack.json says $pack_sha." >&2
      rm -rf "$out"; exit 1
    fi
    # The zip holds profiles/Snapmaker.json and profiles/Snapmaker/...
    unzip -q -o "$out/presets.zip" -d "$out/squashfs-root/resources"
    rm "$out/presets.zip"
  fi
fi
echo "$out/squashfs-root/AppRun"

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
# version's line (the error prints it).
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
  [orca-2.5.0-beta]=15b0e9f9d577bc7a84cfef4f1ecc6e16ef75bc253e500d772fcaa66f4c25b97e
)

out=$DIR/$flavor-$version
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
fi
echo "$out/squashfs-root/AppRun"

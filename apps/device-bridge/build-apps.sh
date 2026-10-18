#!/bin/sh
# Builds the one-file bridge apps into dist/ (bun build --compile: bridge.mjs
# plus the Bun runtime, so nothing needs installing). One file per system, named
# as the relay stores them (bridge/<name> in R2). The Mac apps go in a zip so
# they keep their "can run" flag when downloaded; bun signs them ad hoc, which
# Apple chips need before anything runs.
set -eu
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist/tmp
for target in linux-x64 linux-arm64 windows-x64 darwin-arm64 darwin-x64; do
  bun build --compile --minify --target="bun-$target" bridge.mjs --outfile "dist/tmp/$target"
done
mv dist/tmp/linux-x64 dist/linux-x64
mv dist/tmp/linux-arm64 dist/linux-arm64
mv dist/tmp/windows-x64.exe dist/windows-x64
for arch in arm64 x64; do
  mkdir -p "dist/tmp/mac-$arch"
  mv "dist/tmp/darwin-$arch" "dist/tmp/mac-$arch/Cloud Slicer Bridge"
  (cd "dist/tmp/mac-$arch" && zip -q -X "../../mac-$arch" "Cloud Slicer Bridge")
  mv "dist/mac-$arch.zip" "dist/mac-$arch"
done
rm -rf dist/tmp
ls -l dist

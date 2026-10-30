#!/usr/bin/env bash
# The extra dependencies the next upstream OrcaSlicer (the orca-next engine, see
# engine/README.md) needs on top of build-deps.sh, kept apart so the two shipped
# engines' dependencies (and their CI cache) stay as they are.
#
#     engine/scripts/build-deps-next.sh     # after build-deps.sh, same WASM_DEPS_* env
#
# cgal6: OrcaSlicer 2.5 asks for CGAL 6.2 (find_package(CGAL 6.2 REQUIRED)); the
# shipped engines build against 5.6. Header-only, so no Emscripten needed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${WASM_DEPS_OUT:-$WASM_DIR/build/deps}"
WORK="${WASM_DEPS_WORK:-$WASM_DIR/build/deps-src}"
mkdir -p "$OUT" "$WORK"

V=6.2.1
if [ ! -d "$WORK/CGAL-$V" ]; then
    (cd "$WORK" && curl -fsSL "https://github.com/CGAL/cgal/releases/download/v$V/CGAL-$V.tar.xz" -o "CGAL-$V.tar" &&
        tar xf "CGAL-$V.tar" && rm "CGAL-$V.tar")
fi
rm -rf "$OUT/cgal6/include"; mkdir -p "$OUT/cgal6/include"
cp -r "$WORK/CGAL-$V/include/CGAL" "$OUT/cgal6/include/"
echo ">>> done: $OUT/cgal6"

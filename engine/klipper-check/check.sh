#!/usr/bin/env bash
# Checks that Klipper accepts sliced G-code, in Klipper's batch mode: Klipper
# reads the file like a print and works out every move against a printer
# config, without a printer. It fails on anything Klipper would stop on
# (a move outside the bed, a bad parameter) and on commands it doesn't know.
#
#   engine/klipper-check/check.sh <printer.cfg> <file.gcode> [...]
#
# The first run sets up Klipper in $KLIPPER_CHECK_DIR (default
# ~/.cache/klipper-check): it needs git, python3-venv, gcc-avr and avr-libc,
# because Klipper's command list comes from building its firmware once.
set -euo pipefail
KLIPPER_SHA=ee2c6fb6b00b2b5d097ef70d0868df7d74943b51 # same as the Docker printers
DIR=${KLIPPER_CHECK_DIR:-$HOME/.cache/klipper-check}
[ $# -ge 2 ] || { echo "usage: $0 <printer.cfg> <file.gcode> [...]" >&2; exit 2; }
cfg=$(realpath "$1"); shift

if [ ! -f "$DIR/klipper/out/klipper.dict" ] || [ "$(git -C "$DIR/klipper" rev-parse HEAD 2>/dev/null)" != "$KLIPPER_SHA" ]; then
  echo "Setting up Klipper $KLIPPER_SHA in $DIR"
  rm -rf "$DIR"; mkdir -p "$DIR/klipper"
  git -C "$DIR/klipper" init -q
  git -C "$DIR/klipper" fetch -q --depth 1 https://github.com/Klipper3d/klipper.git "$KLIPPER_SHA"
  git -C "$DIR/klipper" checkout -q FETCH_HEAD
  # The simulated atmega644p board, as Klipper's own test suite uses.
  printf '%s\n' CONFIG_LOW_LEVEL_OPTIONS=y CONFIG_MACH_AVR=y CONFIG_MACH_atmega644p=y \
    CONFIG_AVR_FREQ_20000000=y CONFIG_SIMULAVR=y CONFIG_SERIAL=y CONFIG_SERIAL_BAUD=250000 > "$DIR/klipper/.config"
  make -C "$DIR/klipper" olddefconfig > /dev/null
  make -C "$DIR/klipper" -j"$(nproc)" > "$DIR/build.log" 2>&1 || { tail -30 "$DIR/build.log"; exit 1; }
  python3 -m venv "$DIR/env"
  "$DIR/env/bin/pip" install -q --disable-pip-version-check -r "$DIR/klipper/scripts/klippy-requirements.txt"
fi

failed=0
for gcode in "$@"; do
  log=$(mktemp)
  status=0
  "$DIR/env/bin/python" "$DIR/klipper/klippy/klippy.py" "$cfg" -i "$gcode" -o /dev/null \
    -d "$DIR/klipper/out/klipper.dict" -l "$log" || status=$?
  # Klipper stops on real errors (non-zero exit) but only reports unknown commands.
  problems=$(grep -E '^(Unknown command|Move out of range|Must home|Extrude (only )?move too long|Error|Internal error)' "$log" | sort | uniq -c | sort -rn | head -20 || true)
  if [ "$status" -ne 0 ] || [ -n "$problems" ]; then
    failed=1
    echo "FAIL $(basename "$gcode") on $(basename "$cfg") (exit $status)"
    if [ -n "$problems" ]; then echo "$problems"; else tail -20 "$log"; fi
  else
    echo "ok   $(basename "$gcode") on $(basename "$cfg"): $(grep -o 'print time [0-9.]*s' "$log" | tail -1)"
  fi
  rm -f "$log"
done
exit $failed

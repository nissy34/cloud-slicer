#!/usr/bin/env python3
"""Structural G-code comparison for engine-parity checks (wasm vs desktop vs Android).

Line diffs are useless across builds: toolpath order, travel placement and
M73 progress lines shift with rounding and tie-breaking. This compares what
matters for the print instead, with small tolerances:

  * layer count and Z heights (exact)
  * filament extruded per feature type (;TYPE:), per layer and in total (--tol %)
  * the estimated print time (--time-tol %), which speeds and accelerations set
  * where the print sits: the bounding box of every extrusion (--mm)
  * tool changes and Klipper object definitions (exact)
  * fans: the same set of speeds, and as many changes to within 1% (a fan
    change sits on a line type whose place in the layer can move)
  * temperatures: every wait (M109/M190) in order, and the set of targets set
    (M104/M140), since when a nozzle is warmed ahead of its turn follows the
    time estimate
  * every setting in the file's config block (exact, minus --ignore-setting)

    compare-gcode.py a.gcode b.gcode [--tol 0.5] [--skip-type "Prime tower"]
                     [--ignore-setting filename_format] [--allow temps] [--json out.json]

Exit status 1 if anything differs beyond its tolerance.
"""
import argparse
import collections
import json
import re
import sys

# Lines only one of two identical slices may have (desktop writes its preset
# bookkeeping, the browser engine has none).
ALWAYS_IGNORED = {"different_settings_to_system", "inherits_group", "compatible_machine_expression_group", "compatible_process_expression_group"}


def seconds(text):
    total = 0
    for n, unit in re.findall(r"(\d+)([dhms])", text):
        total += int(n) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[unit]
    return total


def parse(path):
    feat = collections.defaultdict(float)
    moves = collections.Counter()
    layer_e = []
    zs, waits, temps, fans, tools, objects = [], [], set(), [], collections.Counter(), []
    est, settings = {}, {}
    box = [float("inf"), float("inf"), float("-inf"), float("-inf")]
    cur_type, rel_e, e_last, x, y = "start", False, 0.0, 0.0, 0.0
    in_config = False
    with open(path, encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.strip()
            if in_config:
                if line == "; CONFIG_BLOCK_END":
                    in_config = False
                else:
                    m = re.match(r"; ([a-z0-9_]+) = ?(.*)", line)
                    if m:
                        # "a, b" and "a,b" are the same list (desktop writes thumbnails spaced).
                        settings[m.group(1)] = re.sub(r",\s+", ",", m.group(2))
                continue
            if line == "; CONFIG_BLOCK_START":
                in_config = True
                continue
            if line.startswith(";TYPE:"):
                cur_type = line[6:]
                continue
            if line.startswith(";LAYER_CHANGE"):
                zs.append(None)
                layer_e.append(0.0)
                continue
            if line.startswith(";Z:") and zs and zs[-1] is None:
                zs[-1] = float(line[3:])
                continue
            m = re.match(r"; (estimated printing time|total filament used \[g\]|filament used \[mm\]|total layers count)[^=]*= *(.*)", line)
            if m:
                est.setdefault(m.group(1), m.group(2))
                continue
            if line.startswith("EXCLUDE_OBJECT_DEFINE"):
                objects.append(line)
                continue
            code = line.split(";", 1)[0].strip()
            if not code:
                continue
            if code == "M83":
                rel_e = True
            elif code == "M82":
                rel_e = False
            elif re.fullmatch(r"T\d+", code):
                tools[code] += 1
            elif code.startswith(("M109", "M190")):
                waits.append(code)
            elif code.startswith(("M104", "M140")):
                temps.add(code)
            elif code.startswith(("M106", "M107")):
                fans.append(code)
            elif code.startswith(("G0 ", "G1 ", "G2 ", "G3 ")):
                e = None
                nx, ny = x, y
                for w in code.split()[1:]:
                    if w[0] == "E":
                        e = float(w[1:])
                    elif w[0] == "X":
                        nx = float(w[1:])
                    elif w[0] == "Y":
                        ny = float(w[1:])
                moved = (nx, ny) != (x, y)
                if e is not None:
                    de = e if rel_e else e - e_last
                    if not rel_e:
                        e_last = e
                    if de > 0 and moved:
                        feat[cur_type] += de
                        moves[cur_type] += 1
                        if layer_e:
                            layer_e[-1] += de
                        if cur_type != "Custom":
                            box[0], box[1] = min(box[0], x, nx), min(box[1], y, ny)
                            box[2], box[3] = max(box[2], x, nx), max(box[3], y, ny)
                x, y = nx, ny
            elif code.startswith("G92"):
                for w in code.split()[1:]:
                    if w[0] == "E":
                        e_last = float(w[1:])
    return dict(feat=feat, moves=moves, layer_e=layer_e, zs=zs, waits=waits, temps=sorted(temps), fans=fans, tools=tools,
                objects=objects, est=est, settings=settings, box=box)


def pct(a, b):
    return 0.0 if a == b == 0 else 100.0 * (b - a) / max(abs(a), 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--tol", type=float, default=0.5, help="max %% difference in extrusion per feature")
    ap.add_argument("--layer-tol", type=float, default=2.0, help="max %% difference in one layer's extrusion (and at least 0.5 mm)")
    ap.add_argument("--time-tol", type=float, default=1.0, help="max %% difference in estimated print time")
    ap.add_argument("--mm", type=float, default=0.1, help="max difference in the print's bounding box, mm")
    ap.add_argument("--skip-type", action="append", default=[], help="a ;TYPE: that may differ (shown, not counted); repeatable")
    ap.add_argument("--ignore-setting", action="append", default=[], help="a config key that may differ; repeatable")
    ap.add_argument("--allow", action="append", default=[], choices=["time", "area", "tools", "waits", "temps", "fans", "objects"],
                    help="a check that may differ (shown, not counted); repeatable")
    ap.add_argument("--json", help="also write the differences found as JSON")
    args = ap.parse_args()
    A, B = parse(args.a), parse(args.b)
    problems = []

    def fail(what, check=None):
        if check in args.allow:
            print("  (allowed to differ) " + what)
            return
        problems.append(what)
        print("  <-- " + what)

    print(f"layers: {len(A['zs'])} vs {len(B['zs'])}", "OK" if A["zs"] == B["zs"] else "")
    if A["zs"] != B["zs"]:
        fail("layer heights differ")
    for k in sorted(set(A["est"]) | set(B["est"])):
        print(f"header {k}: {A['est'].get(k)} vs {B['est'].get(k)}")
    ta, tb = seconds(A["est"].get("estimated printing time", "")), seconds(B["est"].get("estimated printing time", ""))
    if abs(pct(ta, tb)) > args.time_tol:
        fail(f"print time {ta}s vs {tb}s ({pct(ta, tb):+.2f}%)", "time")

    print(f"\n{'feature':<28}{'E a (mm)':>12}{'E b (mm)':>12}{'Δ%':>8}{'moves a':>10}{'moves b':>10}")
    total_a = total_b = 0.0
    for k in sorted(set(A["feat"]) | set(B["feat"]), key=lambda k: -A["feat"].get(k, 0)):
        ea, eb = A["feat"].get(k, 0.0), B["feat"].get(k, 0.0)
        total_a += ea
        total_b += eb
        d = pct(ea, eb)
        over = abs(d) > args.tol and max(ea, eb) > 1.0
        note = "  (allowed to differ)" if over and k in args.skip_type else ""
        print(f"{k:<28}{ea:>12.2f}{eb:>12.2f}{d:>8.3f}{A['moves'][k]:>10}{B['moves'][k]:>10}{note}")
        if over and not note:
            fail(f"{k}: {ea:.2f} vs {eb:.2f} mm ({d:+.2f}%)")
    print(f"{'TOTAL':<28}{total_a:>12.2f}{total_b:>12.2f}{pct(total_a, total_b):>8.3f}")

    # Per layer (only when nothing may differ: a skipped type, like a prime
    # tower only one side prints, changes every layer).
    if not args.skip_type and len(A["layer_e"]) == len(B["layer_e"]):
        bad_layers = [(i, a, b) for i, (a, b) in enumerate(zip(A["layer_e"], B["layer_e"]))
                      if abs(a - b) > max(0.5, abs(a) * args.layer_tol / 100)]
        print(f"\nper layer: {len(bad_layers)} of {len(A['layer_e'])} layers differ by more than {args.layer_tol}%")
        for i, a, b in bad_layers[:5]:
            fail(f"layer {i + 1} (Z {A['zs'][i]}): {a:.2f} vs {b:.2f} mm")

    box = max(abs(p - q) for p, q in zip(A["box"], B["box"]))
    fmt = lambda b: "X%.2f-%.2f Y%.2f-%.2f" % (b[0], b[2], b[1], b[3])
    print(f"\nprint area: {fmt(A['box'])} vs {fmt(B['box'])}")
    if box > args.mm:
        fail(f"print area moved by {box:.2f} mm", "area")

    fa, fb = len(A["fans"]), len(B["fans"])
    print(f"\nfan changes: {fa} vs {fb}")
    if abs(fa - fb) > max(1, fa // 100):
        fail(f"fan changes {fa} vs {fb}", "fans")
    A["fan speeds"], B["fan speeds"] = sorted(set(A["fans"])), sorted(set(B["fans"]))
    for key in ("tools", "waits", "temps", "fan speeds", "objects"):
        same = A[key] == B[key]
        print(f"\n{key}: {'identical' if same else 'DIFFER'}")
        if not same:
            seq_a, seq_b = (sorted(A[key].items()), sorted(B[key].items())) if key == "tools" else (A[key], B[key])
            first = next((i for i, (p, q) in enumerate(zip(seq_a, seq_b)) if p != q), min(len(seq_a), len(seq_b)))
            print(f"  {len(seq_a)} vs {len(seq_b)}; first difference at #{first + 1}:")
            print("  a:", seq_a[first:first + 3])
            print("  b:", seq_b[first:first + 3])
            fail(f"{key} differ", key.split()[0])

    ignored = ALWAYS_IGNORED | set(args.ignore_setting)
    keys = sorted(set(A["settings"]) | set(B["settings"]))
    diff = [k for k in keys if k not in ignored and A["settings"].get(k) != B["settings"].get(k)]
    print(f"\nsettings: {len(keys)} compared, {len(diff)} differ" + (f" (ignored: {', '.join(sorted(ignored & set(keys)))})" if ignored & set(keys) else ""))
    for k in diff:
        print(f"  {k}: {A['settings'].get(k, '(missing)')[:80]!r} vs {B['settings'].get(k, '(missing)')[:80]!r}")
        fail(f"setting {k} differs")

    print("\nRESULT:", f"MISMATCH ({len(problems)} differences)" if problems else "match")
    if args.json:
        with open(args.json, "w") as f:
            json.dump({"match": not problems, "problems": problems}, f, indent=1)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

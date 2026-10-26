import { describe, expect, it } from "vitest";
import {
  changesBetween,
  printTagLine,
  readPrintTag,
  withPrintTag,
  fingerprintOf,
  nextStatus,
  OPEN_FOR_MS,
  plateMark,
  plateMarks,
  progressOf,
  sameFile,
  samePrint,
  summarize,
  type PlateFingerprint,
  type PrintRecord,
} from "./prints";

const fp = (
  over: Partial<PlateFingerprint["objects"][0]> = {},
): PlateFingerprint => ({
  objects: [
    {
      name: "Benchy",
      copies: 1,
      shape: "s1",
      place: "p1",
      settings: "o1",
      paint: "n1",
      ...over,
    },
  ],
  plate: "pl1",
});
const config = {
  layer_height: "0.2",
  sparse_infill_density: "15%",
  wipe_tower_x: "10,20",
  print_settings_id: "A",
};
// What the plate prints now (S1), and after a move (S2).
const S1 = summarize(fp(), config, 0);
const S2 = summarize(fp({ place: "p2" }), config, 0);

let n = 0;
const rec = (over: Partial<PrintRecord>): PrintRecord => ({
  id: `r${++n}`,
  projectId: "p",
  plate: 0,
  status: "printed",
  at: n * 1000,
  endedAt: null,
  duration: null,
  progress: null,
  printer: "u1",
  printerName: "U1",
  file: "Benchy_plate_1.gcode",
  fingerprint: fingerprintOf(S1),
  summary: S1,
  ...over,
});

describe("print history", () => {
  it("fingerprints the same plate the same, and anything that prints differently differently", () => {
    const a = fingerprintOf(summarize(fp(), config, 0));
    expect(fingerprintOf(summarize(fp(), { ...config }, 0))).toBe(a);
    expect(fingerprintOf(summarize(fp({ place: "p2" }), config, 0))).not.toBe(
      a,
    );
    expect(
      fingerprintOf(summarize(fp(), { ...config, layer_height: "0.3" }, 0)),
    ).not.toBe(a);
    // Another plate's prime tower, or a renamed preset, isn't this plate's print.
    expect(
      fingerprintOf(summarize(fp(), { ...config, wipe_tower_x: "10,99" }, 0)),
    ).toBe(a);
    expect(
      fingerprintOf(summarize(fp(), { ...config, print_settings_id: "B" }, 0)),
    ).toBe(a);
    expect(
      fingerprintOf(summarize(fp(), { ...config, wipe_tower_x: "11,20" }, 0)),
    ).not.toBe(a);
  });

  it("marks a plate from its newest print or mark", () => {
    const at = 100_000;
    const plateMarkAt = (records: PrintRecord[], now: typeof S1 | undefined) =>
      plateMark(records, now, at);
    expect(plateMarkAt([], S1)).toEqual({ state: "none" });
    expect(plateMarkAt([rec({ status: "printed" })], S1).state).toBe("printed");
    expect(plateMarkAt([rec({ status: "printed" })], S2).state).toBe("changed");
    // Kept before summaries: the fingerprint decides.
    expect(
      plateMarkAt([rec({ status: "printed", summary: null })], S2).state,
    ).toBe("changed");
    expect(
      plateMarkAt([rec({ status: "printed", summary: null })], S1).state,
    ).toBe("printed");
    // A send with no word for a week stops showing as on its way; no word at all decides nothing.
    expect(
      plateMark([rec({ status: "sent", at: 0 })], S1, OPEN_FOR_MS + 1).state,
    ).toBe("none");
    expect(
      plateMarkAt([rec({ status: "printed" }), rec({ status: "unknown" })], S1)
        .state,
    ).toBe("printed");
    expect(
      plateMark([rec({ status: "printed" })], undefined, 100_000).state,
    ).toBe("printed");
    // An upload alone doesn't mark; starting it does.
    expect(plateMark([rec({ status: "uploaded" })], S1, 100_000).state).toBe(
      "none",
    );
    expect(
      plateMark(
        [rec({ status: "printed" }), rec({ status: "sent" })],
        S1,
        100_000,
      ).state,
    ).toBe("sent");
    // A failed print after a good one keeps the plate printed.
    expect(
      plateMark(
        [rec({ status: "printed" }), rec({ status: "failed" })],
        S1,
        100_000,
      ).state,
    ).toBe("printed");
    expect(plateMark([rec({ status: "failed" })], S1, 100_000).state).toBe(
      "none",
    );
    // By hand.
    expect(
      plateMark(
        [
          rec({ status: "printed" }),
          rec({ status: "unmarked", fingerprint: null }),
        ],
        S1,
        100_000,
      ).state,
    ).toBe("none");
    expect(
      plateMark(
        [rec({ status: "sent" }), rec({ status: "marked" })],
        S1,
        100_000,
      ).state,
    ).toBe("printed");
  });

  it("counts printed plates and finds the next one, skipping empty plates", () => {
    const records = [
      rec({ plate: 0 }),
      rec({ plate: 1, summary: S2 }),
      rec({ plate: 3, status: "sent", at: Date.now() }),
    ];
    const marks = plateMarks(records, 5, { 0: S1, 1: S1, 3: S1 });
    expect(marks.map((m) => m.state)).toEqual([
      "printed",
      "changed",
      "none",
      "sent",
      "none",
    ]);
    expect(progressOf(marks, (p) => p === 2)).toEqual({
      printed: 2,
      changed: 1,
      total: 4,
      next: 1,
    });
  });

  it("says what changed in plain words", () => {
    const then = summarize(
      {
        objects: [fp().objects[0], { ...fp().objects[0], name: "Cube" }],
        plate: "pl1",
      },
      config,
      0,
    );
    const now = summarize(
      {
        objects: [
          fp({ place: "p2", settings: "o2" }).objects[0],
          { ...fp().objects[0], name: "Cone" },
        ],
        plate: "pl2",
      },
      { ...config, layer_height: "0.3" },
      0,
    );
    expect(
      changesBetween(then, now, (k) => ({ layer_height: "Layer height" })[k]),
    ).toEqual([
      "Added: Cone",
      "Removed: Cube",
      "Moved: Benchy",
      "Object settings: Benchy",
      "Plate settings, pauses or custom G-code",
      "Settings: Layer height",
    ]);
    expect(changesBetween(then, then, () => undefined)).toEqual([]);
  });

  it("doesn't call a plate changed for settings a newer engine (or the other engine) added or dropped", () => {
    const newer = summarize(fp(), { ...config, brand_new_option: "1" }, 0);
    const older = summarize(
      fp(),
      { layer_height: "0.2", sparse_infill_density: "15%" },
      0,
    );
    expect(samePrint(S1, newer)).toBe(true);
    expect(samePrint(S1, older)).toBe(true);
    expect(changesBetween(S1, newer, () => undefined)).toEqual([]);
    expect(
      samePrint(
        S1,
        summarize(
          fp(),
          { ...config, brand_new_option: "1", layer_height: "0.3" },
          0,
        ),
      ),
    ).toBe(false);
    expect(samePrint(S1, S2)).toBe(false);
  });

  it("follows the printer: printing, then how it ended", () => {
    const job = (
      state: string,
      filename = "gcodes/Benchy_plate_1.gcode",
      totalSeconds = 0,
    ) => ({ state, filename, totalSeconds });
    expect(
      sameFile("Benchy_plate_1.gcode", "/gcodes/benchy_plate_1.gcode"),
    ).toBe(true);
    expect(nextStatus(rec({ status: "sent" }), "u1", job("printing"))).toBe(
      "printing",
    );
    expect(nextStatus(rec({ status: "uploaded" }), "u1", job("printing"))).toBe(
      "printing",
    );
    expect(nextStatus(rec({ status: "printing" }), "u1", job("complete"))).toBe(
      "printed",
    );
    expect(nextStatus(rec({ status: "printing" }), "u1", job("error"))).toBe(
      "failed",
    );
    expect(
      nextStatus(rec({ status: "printing" }), "u1", job("cancelled")),
    ).toBe("cancelled");
    // An earlier finished print of the same file name, another file, another printer: nothing.
    expect(
      nextStatus(rec({ status: "sent" }), "u1", job("complete")),
    ).toBeNull();
    expect(
      nextStatus(
        rec({ status: "printing" }),
        "u1",
        job("complete", "other.gcode"),
      ),
    ).toBeNull();
    expect(
      nextStatus(rec({ status: "printing" }), "ender", job("complete")),
    ).toBeNull();
    expect(
      nextStatus(rec({ status: "printed" }), "u1", job("printing")),
    ).toBeNull();
    // Started from the Send window and over before a page saw it: counts when the job fits in the time since the send.
    const sent = rec({ status: "sent", at: 1_000_000 });
    expect(
      nextStatus(
        sent,
        "u1",
        job("complete", undefined, 3600),
        1_000_000 + 3601_000,
      ),
    ).toBe("printed");
    expect(
      nextStatus(
        sent,
        "u1",
        job("cancelled", undefined, 600),
        1_000_000 + 3601_000,
      ),
    ).toBe("cancelled");
    // The printer's earlier job of that name (longer than the time since the send): not this one.
    expect(
      nextStatus(
        sent,
        "u1",
        job("complete", undefined, 3600),
        1_000_000 + 60_000,
      ),
    ).toBeNull();
    // No length from the printer, or only uploaded from here: nothing.
    expect(
      nextStatus(
        sent,
        "u1",
        job("complete", undefined, 0),
        1_000_000 + 3601_000,
      ),
    ).toBeNull();
    expect(
      nextStatus(
        rec({ status: "uploaded", at: 1_000_000 }),
        "u1",
        job("complete", undefined, 60),
        1_000_000 + 3601_000,
      ),
    ).toBeNull();
  });

  it("tags a G-code with its plate, after the first line, and reads it back", async () => {
    const origin = {
      projectId: "b5c1-x_9",
      plate: 2,
      fingerprint: "0123abcd0123abcd",
      printId: "6f1c2e9a-print",
    };
    expect(printTagLine(origin)).toBe(
      "; cloud_slicer_print = b5c1-x_9/3/0123abcd0123abcd/6f1c2e9a-print\n",
    );
    const tagged = await (
      await withPrintTag(
        new Blob(["; generated by OrcaSlicer — Ø\nG28\nG1 X1\n"]),
        origin,
      )
    ).text();
    expect(tagged).toBe(
      "; generated by OrcaSlicer — Ø\n; cloud_slicer_print = b5c1-x_9/3/0123abcd0123abcd/6f1c2e9a-print\nG28\nG1 X1\n",
    );
    expect(readPrintTag(tagged)).toEqual(origin);
    // Orca's header block (read by the printer's screen) stays whole: the tag goes after it.
    const orca =
      "; HEADER_BLOCK_START\n; generated by OrcaSlicer 2.4.2\n; total layer number: 294\n; HEADER_BLOCK_END\n\n; THUMBNAIL_BLOCK_START\n";
    expect(await (await withPrintTag(new Blob([orca]), origin)).text()).toBe(
      orca.replace(
        "; HEADER_BLOCK_END\n",
        "; HEADER_BLOCK_END\n" + printTagLine(origin),
      ),
    );
    expect(
      readPrintTag("G28\n; cloud_slicer_print = ../3/0123abcd\n"),
    ).toBeNull();
    expect(readPrintTag("; cloud_slicer_print = p/0/0123abcd")).toBeNull();
    expect(readPrintTag("G28\n")).toBeNull();
    // Every tag names its record.
    expect(readPrintTag("; cloud_slicer_print = p/1/0123abcd")).toBeNull();
    expect(
      readPrintTag("; cloud_slicer_print = p/1/0123abcd/short"),
    ).toBeNull();
  });
});

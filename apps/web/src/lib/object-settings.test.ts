import { describe, expect, it } from "vitest";
import type { OptionDef } from "../engine/protocol";
import { objectSettingGroups, objectSettingLabel } from "./object-settings";

const def = (
  category: string,
  scope?: "region" | "object",
  label = "",
): OptionDef => ({
  type: "int",
  label,
  fullLabel: "",
  category,
  tooltip: "",
  sidetext: "",
  mode: "simple",
  scope,
});

const options: Record<string, OptionDef> = {
  layer_height: def("Quality", "object", "Layer height"),
  seam_position: def("Quality", "object", "Seam position"),
  ironing_type: def("Quality", "region", "Ironing type"),
  bridge_density: def("Quality", "region", "Bridge density"),
  wall_loops: def("Strength", "region", "Wall loops"),
  top_shell_layers: def("Strength", "region", "Top shell layers"),
  outer_wall_speed: def("Speed", "region", "Outer wall"),
  support_speed: def("Speed", "object", "Support"),
  enable_support: def("Support", "object", "Enable support"),
  fuzzy_skin: def("Others", "region", "Fuzzy Skin"),
  raft_layers: def("Support", "object", "Raft layers"),
  wall_filament: def("Extruders", "region", "Walls"),
  extruder: def("Extruders", "region", "Extruder"),
  nozzle_temperature: def("Cooling"),
};

const names = (groups: ReturnType<typeof objectSettingGroups>) =>
  groups.map((g) => [g.group, g.settings.map((s) => s.key)]);

describe("objectSettingGroups", () => {
  it("lists desktop's object table, then every other option an object can carry", () => {
    expect(names(objectSettingGroups(options, false, 4))).toEqual([
      [
        "Quality",
        ["bridge_density", "layer_height", "seam_position", "ironing_type"],
      ],
      ["Speed", ["outer_wall_speed", "support_speed"]],
      ["Strength", ["wall_loops", "top_shell_layers"]],
      ["Support", ["enable_support"]],
      ["More: Extruders", ["wall_filament"]],
      ["More: Others", ["fuzzy_skin"]],
      ["More: Support", ["raft_layers"]],
    ]);
  });

  it("gives parts and modifiers only what a part can carry", () => {
    expect(names(objectSettingGroups(options, true, 4))).toEqual([
      ["Quality", ["bridge_density", "ironing_type"]],
      ["Speed", ["outer_wall_speed"]],
      ["Strength", ["wall_loops", "top_shell_layers"]],
      ["More: Extruders", ["wall_filament"]],
      ["More: Others", ["fuzzy_skin"]],
    ]);
  });

  it("leaves out filament choices with one filament, like desktop", () => {
    expect(
      objectSettingGroups(options, false, 1).map((g) => g.group),
    ).not.toContain("More: Extruders");
  });

  it("uses desktop's renamed labels", () => {
    const strength = objectSettingGroups(options, false, 4).find(
      (g) => g.group === "Strength",
    )!;
    expect(
      strength.settings.find((s) => s.key === "top_shell_layers")!.label,
    ).toBe("Top Solid Layers");
    expect(objectSettingLabel("top_shell_layers")).toBe("Top Solid Layers");
    expect(objectSettingLabel("wall_loops")).toBeUndefined();
  });

  it("keeps to the curated lists with an engine that has no scope metadata", () => {
    const old = Object.fromEntries(
      Object.entries(options).map(([k, d]) => [k, { ...d, scope: undefined }]),
    );
    const groups = objectSettingGroups(old, false, 4);
    expect(groups.some((g) => g.group.startsWith("More"))).toBe(false);
    expect(groups.flatMap((g) => g.settings.map((s) => s.key))).toContain(
      "layer_height",
    );
  });
});

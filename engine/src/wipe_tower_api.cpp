// The prime (wipe) tower on a plate before slicing, as desktop's Prepare view
// shows it (GLCanvas3D::reload_scene): whether there is one, where, and how
// big. Snapmaker Orca 2.4.1 sizes it from the plate's filaments and the prime
// volume (PartPlate::estimate_wipe_tower_size); OrcaSlicer 2.5 with its own
// estimate_wipe_tower_footprint. After slicing both use the real tower.
#include "engine.hpp"

#include "libslic3r/GCode/WipeTower.hpp"
#if ENGINE_UPSTREAM
#include "libslic3r/ClipperUtils.hpp"
#include "libslic3r/FilamentMixer.hpp"
#include "libslic3r/GCode/WipeTowerEstimate.hpp"
#include "libslic3r/Geometry.hpp"
#endif
#if ENGINE_HAS_MIXING
#include "libslic3r/MixedFilament.hpp"
#endif
#include "libslic3r/Print.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include <tuple>

using nlohmann::json;
using namespace Slic3r;

namespace {

// An int option of a config (the project's, or an object's own settings).
template <class Config>
int intOpt(const Config& c, const char* key, int fallback = 0) {
    const ConfigOption* o = c.option(key);
    return o ? o->getInt() : fallback;
}

// The filaments `plate` prints with, 1-based, mixes expanded to the filaments
// they mix (PartPlate::get_extruders(true) + expand_plate_extruders). The slice
// counts them the same way (patches/snapmaker/0009).
std::vector<int> plateFilaments(const DynamicPrintConfig& cfg, int plate) {
    const engine::Project& pr = engine::project();
    std::vector<int> ids;
    const int supportIntf = intOpt(cfg, "support_interface_filament"), support = intOpt(cfg, "support_filament");
    const int wall = intOpt(cfg, "wall_filament", 1), sparse = intOpt(cfg, "sparse_infill_filament", 1);
    const int solid = intOpt(cfg, "solid_infill_filament", 1);
    const bool globalSupport = cfg.opt_bool("enable_support") || intOpt(cfg, "raft_layers") > 0;
    for (const ModelObject* mo : pr.model.objects) {
        if (std::none_of(mo->instances.begin(), mo->instances.end(), [&](const ModelInstance* i) { return pr.plateOf(*i) == plate; }))
            continue;
        for (const ModelVolume* mv : mo->volumes) {
            ids.push_back(mv->extruder_id());
            for (size_t e : mv->get_extruders_from_multi_material_painting()) ids.push_back(int(e) + 1);
        }
        for (const auto& range : mo->layer_config_ranges)
            if (range.second.has("extruder"))
                if (const int id = range.second.option("extruder")->getInt(); id > 0) ids.push_back(id);

        const ConfigOption* supportOpt = mo->config.option("enable_support");
        const ConfigOption* raftOpt = mo->config.option("raft_layers");
        bool hasSupport = globalSupport;
        if (supportOpt || raftOpt) hasSupport = (supportOpt && supportOpt->getBool()) || (raftOpt && raftOpt->getInt() > 0);
        if (hasSupport) {
            const int intf = intOpt(mo->config, "support_interface_filament");
            if (intf || supportIntf) ids.push_back(intf ? intf : supportIntf);
            const int sup = intOpt(mo->config, "support_filament");
            if (sup || support) ids.push_back(sup ? sup : support);
        }
        const int w = intOpt(mo->config, "wall_filament", wall);
        if (w != 1) ids.push_back(w);
        const int sp = intOpt(mo->config, "sparse_infill_filament", 0) > 0 ? intOpt(mo->config, "sparse_infill_filament") : sparse;
        if (sp != 1) ids.push_back(sp);
        const int so = intOpt(mo->config, "solid_infill_filament", 1);
        if (so != 1) ids.push_back(so);
        else if (solid != 1) ids.push_back(solid);
    }

    // Filament changes at a layer (desktop's colour change per plate).
    const auto* colours = cfg.option<ConfigOptionStrings>("filament_colour");
    const size_t physical = colours ? colours->values.size() : 1;
#if ENGINE_HAS_MIXING
    MixedFilamentManager mixes;
    if (colours) {
        mixes.auto_generate(colours->values);
        const auto* defs = cfg.option<ConfigOptionString>("mixed_filament_definitions");
        mixes.load_custom_entries(defs ? defs->value : std::string(), colours->values);
    }
    const size_t total = mixes.total_filaments(physical);
#else
    const size_t total = physical;  // this engine has no mixed filaments
#endif
    if (auto it = pr.model.plates_custom_gcodes.find(plate); it != pr.model.plates_custom_gcodes.end())
        for (const auto& item : it->second.gcodes)
            if (item.type == CustomGCode::Type::ToolChange && item.extruder <= int(total))
                ids.push_back(item.extruder);

    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
#if ENGINE_HAS_MIXING
    mixes.expand_virtual_extruder_ids(ids, physical);
#elif ENGINE_UPSTREAM
    // OrcaSlicer 2.5's mixed slots, as the physical filaments they print with.
    if (const auto* mixed = cfg.option<ConfigOptionBools>("filament_is_mixed"); mixed && has_any_mixed_filament(mixed->values)) {
        const auto* parts = cfg.option<ConfigOptionStrings>("filament_mixed_components");
        std::vector<unsigned int> zeroBased;
        for (int id : ids) zeroBased.push_back(unsigned(id - 1));
        ids.clear();
        for (unsigned int id : expand_mixed_filaments(zeroBased, mixed->values, parts ? parts->values : std::vector<std::string>{})) ids.push_back(int(id) + 1);
    }
#endif
    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
    return ids;
}

// WipeTower::min_depth_per_height at `height`, interpolated (as
// PartPlate::estimate_wipe_tower_size does).
float minDepth(double height) {
    const auto& table = WipeTower::min_depth_per_height;
    for (auto it = table.begin(); it != table.end(); ++it) {
        if (it->first >= height) return it->second;
        auto next = std::next(it);
        if (next == table.end()) return it->second;
        if (next->first > height)
            return it->second + float((height - it->first) / (next->first - it->first)) * (next->second - it->second);
    }
    return 0.f;
}

#if !ENGINE_UPSTREAM
// Snapmaker Orca 2.4.1's PartPlate::estimate_wipe_tower_size: the tower's
// width and depth for `n` filaments on the plate, before slicing.
std::pair<double, double> estimateTower(const DynamicPrintConfig& cfg, size_t n) {
    const double layerHeight = cfg.opt_float("layer_height");
    const double wipeVolume = cfg.opt_float("prime_volume");
    const double spacing = cfg.option("wipe_tower_extra_spacing")->getFloat() / 100.;
    double changeVolume = 0.5;
    if (const auto* ramming = cfg.option<ConfigOptionFloats>("filament_multitool_ramming_volume"); ramming && !ramming->values.empty())
        changeVolume = *std::max_element(ramming->values.begin(), ramming->values.end());
    const double volume = wipeVolume * n + changeVolume * (n - 1);
    const auto* wall = cfg.option<ConfigOptionEnum<WipeTowerWallType>>("wipe_tower_wall_type");
    if (wall && wall->value == WipeTowerWallType::wtwRib) {
        double depth = std::sqrt(volume / layerHeight * spacing);
        const double rib = std::min(cfg.opt_float("wipe_tower_rib_width"), depth / 2);
        depth = rib + std::max(depth + cfg.opt_float("wipe_tower_extra_rib_length"), depth);
        return {depth, depth};
    }
    return {cfg.opt_float("prime_tower_width"), volume / (layerHeight * wipeVolume) * spacing};
}
#endif

} // namespace

namespace engine {

// See engine.hpp.
json wipeTowerFor(const DynamicPrintConfig& cfg, int plate, double slicedDepth) {
    const Project& pr = project();
    json out{{"show", false}};
    const auto* colours = cfg.option<ConfigOptionStrings>("filament_colour");
    const size_t filaments = colours ? colours->values.size() : 1;
    const auto* timelapse = cfg.option<ConfigOptionEnum<TimelapseType>>("timelapse_type");
    const bool smooth = timelapse && timelapse->value == TimelapseType::tlSmooth;
    if (!cfg.opt_bool("enable_prime_tower") || !(smooth || filaments > 1)) return out;

    // Printing object by object, a tower only goes with a single object.
    int printable = 0;
    double height = 0;
    for (const ModelObject* mo : pr.model.objects) {
        bool on = false;
        for (const ModelInstance* i : mo->instances)
            if (pr.plateOf(*i) == plate) {
                on = true;
                if (i->printable) ++printable;
            }
        if (on) height = std::max(height, mo->bounding_box_exact().size().z());
    }
    const auto* seq = cfg.option<ConfigOptionEnum<PrintSequence>>("print_sequence");
    if (seq && seq->value == PrintSequence::ByObject && printable != 1) return out;

    const std::vector<int> used = plateFilaments(cfg, plate);
    if (used.empty()) return out;

    // The size Orca plans for before slicing, or the sliced tower's.
    double width = cfg.opt_float("prime_tower_width");
    double depth = slicedDepth;
    double brim = cfg.opt_float("prime_tower_brim_width");
    double plannedWidth = width, plannedDepth = depth;
    [[maybe_unused]] double plannedHeight = height;
#if !ENGINE_UPSTREAM
    // Desktop counts the plate's own filaments (a mix as the ones it mixes);
    // one needs no tower unless timelapse does.
    if (!smooth && used.size() < 2) return out;
    // The planned tower always decides where it stands: the slice keeps it on
    // the bed with this size, so the sliced tower is drawn there too.
    {
        Print print;
        print.apply(Model(), cfg);
        brim = print.wipe_tower_data(used.size()).brim_width;
        std::tie(plannedWidth, plannedDepth) = estimateTower(cfg, used.size());
    }
    if (depth < 0) {
        width = plannedWidth;
        depth = plannedDepth;
    } else {
        // The sliced tower, never shallower than the engine's minimum.
        depth = std::max(double(minDepth(height)), depth);
    }
#else
    {
        // OrcaSlicer 2.5's own pre-slice estimate (GCode/WipeTowerEstimate), fed
        // as PartPlate::estimate_wipe_tower_footprint feeds it: the plate's
        // filaments plus the tower's own filament, the tallest object instance
        // and the thinnest layer of the plate's objects.
        std::vector<unsigned int> ids;
        for (int id : used) ids.push_back(unsigned(id - 1));
        const ConfigOption* towerFilament = cfg.option("wipe_tower_filament");
        const int own = towerFilament ? towerFilament->getInt() : 0;
        if (used.size() > 1 && own > 0 && std::find(used.begin(), used.end(), own) == used.end()) ids.push_back(unsigned(own - 1));
        const double globalLayer = cfg.opt_float("layer_height");
        double layer = std::numeric_limits<double>::max();
        double tallest = 0;
        for (const ModelObject* mo : pr.model.objects) {
            bool on = false;
            for (size_t i = 0; i < mo->instances.size(); ++i)
                if (pr.plateOf(*mo->instances[i]) == plate) {
                    on = true;
                    tallest = std::max(tallest, mo->instance_convex_hull_bounding_box(i, true).size().z());
                }
            if (!on) continue;
            const ConfigOption* own_layer = mo->config.option("layer_height");
            layer = std::min(layer, own_layer ? own_layer->getFloat() : globalLayer);
        }
        if (layer == std::numeric_limits<double>::max()) layer = globalLayer;
        const WipeTowerFootprint fp = estimate_wipe_tower_footprint(cfg, resolve_wipe_tower_type(cfg), ids, layer, tallest);
        plannedWidth = fp.width;
        plannedDepth = fp.depth;
        plannedHeight = fp.height;
        brim = fp.brim_width;
    }
    if (depth < 0) {
        width = plannedWidth;
        depth = plannedDepth;
    } else if (plannedDepth > EPSILON) {
        // The sliced tower, never shallower than the engine's minimum.
        depth = std::max(double(minDepth(height)), depth);
    } else {
        depth = 0;
    }
#endif
    if (depth < 0.01) return out;

    // Kept on the bed, as desktop does whenever it shows the plate.
    const BoundingBoxf bed(cfg.option<ConfigOptionPoints>("printable_area")->values);
    double x = cfg.option<ConfigOptionFloats>("wipe_tower_x")->get_at(plate);
    double y = cfg.option<ConfigOptionFloats>("wipe_tower_y")->get_at(plate);
    bool moved = false, onObject = false;
#if !ENGINE_UPSTREAM
    const double margin = WIPE_TOWER_MARGIN + cfg.opt_float("prime_tower_brim_width");
    if (x + margin + plannedWidth > bed.max.x()) x = bed.max.x() - plannedWidth - margin;
    else if (x < margin) x = margin;
    if (y + margin + plannedDepth > bed.max.y()) y = bed.max.y() - plannedDepth - margin;
    else if (y < margin) y = margin;
#else
    // OrcaSlicer 2.5's PartPlate::estimate_wipe_tower_polygon: a spot just past
    // the edge (a drag) snaps onto it; one far off the plate (a smaller printer,
    // another project) is placed again 15 mm in, and if that lands on an object,
    // at the clear spot nearest where it was. GLCanvas3D::reload_scene saves the
    // new spot and says so; the page does both with `moved`.
    {
        const double w = plannedWidth, d = plannedDepth;
        double brimW = brim;
        // A Type2 stabilization cone bulges past the body like a brim does.
        const BoundingBox cone = get_extents(estimate_wipe_tower_first_layer_outline(cfg, resolve_wipe_tower_type(cfg), w, d, plannedHeight));
        brimW += std::max({0., unscaled(cone.max.x()) - w, unscaled(cone.max.y()) - d, -unscaled(cone.min.x()), -unscaled(cone.min.y())});
        const double plateW = bed.max.x(), plateD = bed.max.y();
        const double margin = WIPE_TOWER_MARGIN + brimW;
        const double xHi = std::max(margin, plateW - w - margin), yHi = std::max(margin, plateD - d - margin);
        const double marginC = WIPE_TOWER_AUTO_MARGIN + brimW;
        double xLoC = marginC, xHiC = plateW - w - marginC, yLoC = marginC, yHiC = plateD - d - marginC;
        if (xLoC > xHiC) { xLoC = margin; xHiC = xHi; }
        if (yLoC > yHiC) { yLoC = margin; yHiC = yHi; }
        const double tol = 5., savedX = x, savedY = y;
        const bool replaceX = x < margin - tol || x > xHi + tol, replaceY = y < margin - tol || y > yHi + tol;
        x = replaceX ? std::clamp(x, xLoC, xHiC) : std::clamp(x, margin, xHi);
        y = replaceY ? std::clamp(y, yLoC, yHiC) : std::clamp(y, margin, yHi);
        if (replaceX || replaceY) {
            moved = true;
            Polygon tower({{scaled(-brimW), scaled(-brimW)}, {scaled(w + brimW), scaled(-brimW)},
                           {scaled(w + brimW), scaled(d + brimW)}, {scaled(-brimW), scaled(d + brimW)}});
            if (const double a = cfg.opt_float("wipe_tower_rotation_angle"); a != 0.) tower.rotate(Geometry::deg2rad(a));
            // PartPlate::wipe_tower_obstacles: each printable object with its brim.
            Polygons objects;
            const Vec2d origin = pr.plateOrigin(plate);
            for (const ModelObject* mo : pr.model.objects)
                for (const ModelInstance* inst : mo->instances) {
                    if (pr.plateOf(*inst) != plate || !inst->printable) continue;
                    Polygon hull = mo->convex_hull_2d(inst->get_matrix());
                    if (hull.size() < 3) continue;
                    hull.translate(-scaled(origin.x()), -scaled(origin.y()));
                    auto optionOf = [&](const char* key) {
                        const ConfigOption* o = mo->config.option(key);
                        return o ? o : cfg.option(key);
                    };
                    const ConfigOption* brimType = optionOf("brim_type");
                    const ConfigOption* brimWidth = optionOf("brim_width");
                    const double objBrim = brimType && brimWidth && brimType->getInt() != int(btNoBrim) ? brimWidth->getFloat() : 0.;
                    append(objects, offset(hull, float(scaled(objBrim + WIPE_TOWER_MARGIN))));
                }
            const Point placed(scaled(x), scaled(y));
            if (!nearest_clear_wipe_tower_anchor(BoundingBox(placed, placed), tower, objects, placed)) {
                const Point saved(scaled(savedX), scaled(savedY));
                std::optional<Point> clear = nearest_clear_wipe_tower_anchor(
                    BoundingBox(Point(scaled(xLoC), scaled(yLoC)), Point(scaled(xHiC), scaled(yHiC))), tower, objects, saved);
                if (!clear)
                    clear = nearest_clear_wipe_tower_anchor(BoundingBox(Point(scaled(margin), scaled(margin)), Point(scaled(xHi), scaled(yHi))),
                                                            tower, objects, saved);
                if (clear) {
                    x = unscaled(clear->x());
                    y = unscaled(clear->y());
                } else {
                    onObject = true;
                }
            }
        }
    }
#endif

    out = {{"show", true},
           {"x", x},
           {"y", y},
           {"width", width},
           {"depth", depth},
           {"height", height > 0 ? height : 0.1},
           {"rotation", cfg.opt_float("wipe_tower_rotation_angle")},
           {"brim", brim},
           {"filaments", used}};
    if (moved) out["moved"] = onObject ? "onObject" : "free";
    return out;
}

} // namespace engine

namespace {

// The tower of `plate` with `configJson` (key -> serialized value: the full
// config the page would slice with). slicedDepth: the depth of the tower the
// last slice of this plate made, or -1 for Orca's estimate. Returns {show}
// or {show: true, x, y (plate mm, front-left corner), width, depth, height,
// rotation (degrees), brim, filaments (1-based, the plate's)}.
std::string wipeTowerJson(const std::string& configJson, int plate, double slicedDepth) {
    try {
        DynamicPrintConfig cfg;
        cfg.apply(FullPrintConfig::defaults());
        engine::applyJsonConfig(cfg, json::parse(configJson));
        engine::applyPlateSettings(cfg, plate);
        return engine::wipeTowerFor(cfg, plate, slicedDepth).dump();
    } catch (const std::exception& e) {
        return json{{"show", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(wipe_tower_api) {
    emscripten::function("wipeTowerJson", &wipeTowerJson);
}

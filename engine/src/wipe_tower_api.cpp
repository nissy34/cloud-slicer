// The prime (wipe) tower on a plate before slicing, as desktop's Prepare view
// shows it (GLCanvas3D::reload_scene): whether there is one, where, and how
// big. Desktop takes the size from PartPlate::estimate_wipe_tower_size, with
// the depth from Print::wipe_tower_data (Orca's estimate before slicing, the
// real depth after); the same steps run here.
#include "engine.hpp"

#include "libslic3r/GCode/WipeTower.hpp"
#if ENGINE_HAS_MIXING
#include "libslic3r/MixedFilament.hpp"
#endif
#include "libslic3r/Print.hpp"

#include <algorithm>

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
// they mix (PartPlate::get_extruders(true) + expand_plate_extruders).
// `assigned`: how many filament numbers before expanding the mixes, which is
// what the slice counts (Print::apply -> normalize_fdm_2).
std::vector<int> plateFilaments(const DynamicPrintConfig& cfg, int plate, size_t* assigned = nullptr) {
    const engine::Project& pr = engine::project();
    std::vector<int> ids;
    const int supportIntf = intOpt(cfg, "support_interface_filament"), support = intOpt(cfg, "support_filament");
    const int wall = intOpt(cfg, "wall_filament", 1), sparse = intOpt(cfg, "sparse_infill_filament", 1);
    const int solid = intOpt(cfg, "solid_infill_filament", 1);
    const bool globalSupport = cfg.opt_bool("enable_support") || intOpt(cfg, "raft_layers") > 0;
    for (const ModelObject* mo : pr.model.objects) {
        if (std::none_of(mo->instances.begin(), mo->instances.end(), [&](const ModelInstance* i) { return pr.plateOf(*i) == plate; }))
            continue;
        for (const ModelVolume* mv : mo->volumes)
            for (int e : mv->get_extruders()) ids.push_back(e);
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
    if (assigned) *assigned = ids.size();
#if ENGINE_HAS_MIXING
    mixes.expand_virtual_extruder_ids(ids, physical);
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

    size_t assigned = 0;
    const std::vector<int> used = plateFilaments(cfg, plate, &assigned);
    if (used.empty()) return out;

    // The depth Orca plans for before slicing (Print::wipe_tower_data with the
    // project's filament count), or the sliced tower's.
    const double width = cfg.opt_float("prime_tower_width");
    double depth = slicedDepth;
    double brim = cfg.opt_float("prime_tower_brim_width");
    if (depth < 0) {
        Print print;
#if ENGINE_UPSTREAM
        // Upstream sizes the tower from the tallest object in the Print (and
        // plans none for an empty one): stand in a block as tall as the plate.
        Model stand_in;
        if (height > EPSILON) {
            ModelObject* block = stand_in.add_object();
            block->add_volume(TriangleMesh(its_make_cube(10., 10., height)));
            block->add_instance();
        }
        print.apply(stand_in, cfg);
#else
        print.apply(Model(), cfg);
#endif
        const WipeTowerData& data = print.wipe_tower_data(filaments);
        depth = data.depth;
        brim = data.brim_width;
    }
    // One filament on the plate: no tower unless timelapse needs it. Desktop
    // counts a mix as the filaments it mixes here, but the slice counts it as
    // one (normalize_fdm_2 turns the tower off), and the view shows what will
    // print: a plate printed with a single mix gets no tower.
    if (used.size() == 1 || assigned == 1) depth = 0;
    if (smooth || depth > EPSILON) depth = std::max(double(minDepth(height)), depth);
    if (depth < 0.01) return out;

    // Kept on the bed, as desktop does whenever it shows the plate.
    const BoundingBoxf bed(cfg.option<ConfigOptionPoints>("printable_area")->values);
    const double margin = WIPE_TOWER_MARGIN + cfg.opt_float("prime_tower_brim_width");
    double x = cfg.option<ConfigOptionFloats>("wipe_tower_x")->get_at(plate);
    double y = cfg.option<ConfigOptionFloats>("wipe_tower_y")->get_at(plate);
    if (x + margin + width > bed.max.x()) x = bed.max.x() - width - margin;
    else if (x < margin) x = margin;
    if (y + margin + depth > bed.max.y()) y = bed.max.y() - depth - margin;
    else if (y < margin) y = margin;

    out = {{"show", true},
           {"x", x},
           {"y", y},
           {"width", width},
           {"depth", depth},
           {"height", height > 0 ? height : 0.1},
           {"rotation", cfg.opt_float("wipe_tower_rotation_angle")},
           {"brim", brim},
           {"filaments", used}};
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

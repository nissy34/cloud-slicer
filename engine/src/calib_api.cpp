// Calibration tests from desktop Orca's Calibration menu: temperature tower,
// flow rate, pressure advance, retraction, max volumetric speed, VFA, input
// shaping and junction deviation.
//
// Desktop sets these up in the GUI (Plater::calib_*): a test model replaces
// the project, its objects get per-object settings, the presets get edited
// and Print::set_calib_params() makes the G-code generator vary temperature,
// PA, speed and so on per layer. This file does the same setup on the open
// project; the preset edits come back to the page as overrides, so they show
// as changed values in Settings like desktop's unsaved preset changes.
#include "engine.hpp"

#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Flow.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/calib.hpp"

#include <algorithm>
#include <clocale>
#include <cmath>
#include <map>

using nlohmann::json;
using namespace Slic3r;

// Upstream OrcaSlicer calls the junction deviation test "cornering" (it also
// covers jerk); its own settings for it are not ported yet.
#if ENGINE_UPSTREAM
constexpr CalibMode CalibJunctionDeviation = CalibMode::Calib_Cornering;
#else
constexpr CalibMode CalibJunctionDeviation = CalibMode::Calib_Junction_Deviation;
#endif

namespace {

engine::Project& pr() { return engine::project(); }

std::string fail(const std::string& error) { return json{{"ok", false}, {"error", error}}.dump(); }

// Sets key in the full config like desktop sets it in one edited preset: a
// one-value vector (one filament or extruder) is widened to every slot.
void set(DynamicPrintConfig& cfg, const std::string& key, ConfigOption* value) {
    std::unique_ptr<ConfigOption> v(value);
    if (const ConfigOption* cur = cfg.option(key); cur && cur->is_vector() && v->is_vector()) {
        const size_t n = static_cast<const ConfigOptionVectorBase*>(cur)->size();
        auto* vec = static_cast<ConfigOptionVectorBase*>(v.get());
        if (vec->size() == 1 && n > 1) {
            std::unique_ptr<ConfigOption> first(v->clone());
            vec->resize(n, first.get());
        }
    }
    cfg.set_key_value(key, v.release());
}

// A number option with one value, in the type Orca declares for `key`:
// Snapmaker Orca keeps speeds and accelerations per nozzle flow type (a
// vector), upstream OrcaSlicer as a single number.
ConfigOption* number(const std::string& key, double value) {
    const ConfigOptionDef* def = print_config_def.get(key);
    if (def && def->type == coFloat) return new ConfigOptionFloat(value);
    return new ConfigOptionFloats{value};
}

// A yes/no option with one value, typed as number() is.
ConfigOption* flag(const std::string& key, bool value) {
    const ConfigOptionDef* def = print_config_def.get(key);
    if (def && def->type == coBool) return new ConfigOptionBool(value);
    return new ConfigOptionBools{value};
}

// The first value of a number option, single or per slot.
double firstValue(const DynamicPrintConfig& cfg, const std::string& key) {
    const ConfigOption* o = cfg.option(key);
    if (const auto* v = dynamic_cast<const ConfigOptionFloats*>(o)) return v->values.empty() ? 0. : v->values.front();
    if (const auto* v = dynamic_cast<const ConfigOptionFloatsNullable*>(o)) return v->values.empty() ? 0. : v->values.front();
    return o ? o->getFloat() : 0.;
}

double nozzleDiameter(const DynamicPrintConfig& cfg) { return firstValue(cfg, "nozzle_diameter"); }

void raiseMaxLayerHeight(DynamicPrintConfig& cfg, double layer_height) {
    auto* max_lh = cfg.option<ConfigOptionFloats>("max_layer_height", true);
    if (max_lh->values.empty() || max_lh->values[0] < layer_height) set(cfg, "max_layer_height", number("max_layer_height", layer_height));
}

// Replaces the project with the test model, its objects centred together on
// plate 1 (multi-object tests like flow rate keep their layout).
void loadTestModel(const std::string& path, double bedWidth, double bedDepth) {
    engine::Project& p = pr();
    p.clear();
    p.plateWidth = bedWidth;
    p.plateDepth = bedDepth;
    Model loaded = Model::read_from_file(path, nullptr, nullptr, LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel);
    if (loaded.objects.empty()) throw std::runtime_error("the test model has no objects");
    BoundingBoxf3 group;
    for (ModelObject* o : loaded.objects) {
        ModelObject* copy = p.model.add_object(*o);
        if (copy->instances.empty()) copy->add_instance();
        copy->ensure_on_bed();
        group.merge(copy->instance_bounding_box(0, false));
    }
    const Vec3d shift(bedWidth / 2 - group.center().x(), bedDepth / 2 - group.center().y(), 0);
    for (ModelObject* o : p.model.objects)
        for (ModelInstance* inst : o->instances) inst->set_offset(inst->get_offset() + shift);
}

// Scales every object together about the group's centre, like scaling the
// whole selection in desktop.
void scaleAll(const Vec3d& factor) {
    BoundingBoxf3 group;
    for (ModelObject* o : pr().model.objects) group.merge(o->instance_bounding_box(0, false));
    const Vec3d c = group.center();
    for (ModelObject* o : pr().model.objects) {
        for (ModelInstance* inst : o->instances) {
            inst->set_scaling_factor(inst->get_scaling_factor().cwiseProduct(factor));
            const Vec3d off = inst->get_offset();
            inst->set_offset(Vec3d(c.x() + (off.x() - c.x()) * factor.x(), c.y() + (off.y() - c.y()) * factor.y(), off.z()));
        }
        o->invalidate_bounding_box();
        o->ensure_on_bed();
    }
}

// Cuts object 0 at height z (mm above the bed), keeping the lower or upper part.
void cutHorizontal(double z, bool keepLower) {
    auto& objs = pr().model.objects;
    if (objs.empty()) return;
    ModelObject* obj = objs[0];
    if (z >= obj->bounding_box_exact().size().z()) return;
    const ModelObjectCutAttributes attrs = (keepLower ? ModelObjectCutAttribute::KeepLower : ModelObjectCutAttribute::KeepUpper) |
                                           (keepLower ? ModelObjectCutAttributes() : ModelObjectCutAttributes(ModelObjectCutAttribute::PlaceOnCutUpper)) |
                                           ModelObjectCutAttribute::InvalidateCutInfo;
    const Vec3d offset = obj->instances[0]->get_offset();
    Cut cut(obj, 0, Geometry::translation_transform(z * Vec3d::UnitZ() - offset), attrs);
    const ModelObjectPtrs& parts = cut.perform_with_plane();
    if (parts.empty()) return;
    std::vector<ModelObject*> added;
    for (const ModelObject* part : parts) added.push_back(pr().model.add_object(*part));
    pr().model.delete_object(size_t(0));
    // The kept part goes back to index 0, where the next step expects it.
    for (ModelObject* a : added) a->ensure_on_bed();
    auto& v = pr().model.objects;
    std::rotate(v.begin(), v.end() - added.size(), v.end());
}

void commonTowerSettings(DynamicPrintConfig& cfg, ModelObject* obj) {
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});
    obj->config.set_key_value("brim_type", new ConfigOptionEnum<BrimType>(btOuterOnly));
    obj->config.set_key_value("brim_width", new ConfigOptionFloat(3.0));
    obj->config.set_key_value("brim_object_gap", new ConfigOptionFloat(0.0));
}

// Plater::calib_temp
void temperatureTower(const Calib_Params& params, DynamicPrintConfig& cfg) {
    ModelObject* obj = pr().model.objects[0];
    const auto start_temp = int(lround(params.start));
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});
    set(cfg, "nozzle_temperature_initial_layer", new ConfigOptionInts(1, start_temp));
    set(cfg, "nozzle_temperature", new ConfigOptionInts(1, start_temp));
    obj->config.set_key_value("brim_type", new ConfigOptionEnum<BrimType>(btOuterOnly));
    obj->config.set_key_value("brim_width", new ConfigOptionFloat(5.0));
    obj->config.set_key_value("brim_object_gap", new ConfigOptionFloat(0.0));
    obj->config.set_key_value("alternate_extra_wall", new ConfigOptionBool(false));
    obj->config.set_key_value("seam_slope_type", new ConfigOptionEnum<SeamScarfType>(SeamScarfType::None));
    // The tower has one 10 mm block per 5 °C from 350 °C down: cut away the
    // blocks above the start and below the end temperature.
    long blocks = lround((350 - params.end) / 5 + 1);
    if (blocks > 0) cutHorizontal(blocks * 10.0 + EPSILON, true);
    blocks = lround((350 - params.start) / 5);
    if (blocks > 0) cutHorizontal(blocks * 10.0 + EPSILON, false);
}

// adjust_settings_for_flowrate_calib + Plater::calib_flowrate
void flowRate(bool linear, int pass, DynamicPrintConfig& cfg) {
    const double nozzle_diameter = nozzleDiameter(cfg);
    const double xyScale = nozzle_diameter / 0.6;
    const double layer_height = nozzle_diameter / 2.0;
    const double first_layer_height = std::max(cfg.opt_float("initial_layer_print_height"), layer_height);
    const double zscale = (first_layer_height + 9 * layer_height) / 2;
    scaleAll(xyScale > 1.2 ? Vec3d(xyScale, xyScale, zscale) : Vec3d(1, 1, zscale));

    const double cur_flowrate = firstValue(cfg, "filament_flow_ratio");
    const Flow infill_flow(float(nozzle_diameter * 1.2), float(layer_height), float(nozzle_diameter));
    const double max_vol = firstValue(cfg, "filament_max_volumetric_speed");
    const double max_infill_speed = linear ? max_vol / (infill_flow.mm3_per_mm() * (cur_flowrate + (pass == 2 ? 0.035 : 0.05)) / cur_flowrate)
                                           : max_vol / (infill_flow.mm3_per_mm() * (pass == 1 ? 1.2 : 1));
    const double internal_solid_speed = std::floor(std::min(firstValue(cfg, "internal_solid_infill_speed"), max_infill_speed));
    const double top_surface_speed = std::floor(std::min(firstValue(cfg, "top_surface_speed"), max_infill_speed));

    for (ModelObject* o : pr().model.objects) {
        o->ensure_on_bed();
        auto& c = o->config;
        c.set_key_value("wall_loops", new ConfigOptionInt(1));
        c.set_key_value("only_one_wall_top", new ConfigOptionBool(true));
        c.set_key_value("thick_internal_bridges", new ConfigOptionBool(false));
        c.set_key_value("enable_extra_bridge_layer", new ConfigOptionEnum<EnableExtraBridgeLayer>(eblDisabled));
        c.set_key_value("internal_bridge_density", new ConfigOptionPercent(100));
        c.set_key_value("sparse_infill_density", new ConfigOptionPercent(35));
        c.set_key_value("min_width_top_surface", new ConfigOptionFloatOrPercent(100, true));
        c.set_key_value("bottom_shell_layers", new ConfigOptionInt(2));
        c.set_key_value("top_shell_layers", new ConfigOptionInt(5));
        c.set_key_value("top_shell_thickness", new ConfigOptionFloat(0));
        c.set_key_value("bottom_shell_thickness", new ConfigOptionFloat(0));
        c.set_key_value("detect_thin_wall", new ConfigOptionBool(true));
        c.set_key_value("filter_out_gap_fill", new ConfigOptionFloat(0));
        c.set_key_value("sparse_infill_pattern", new ConfigOptionEnum<InfillPattern>(ipRectilinear));
        c.set_key_value("top_surface_line_width", new ConfigOptionFloatOrPercent(nozzle_diameter * 1.2, false));
        c.set_key_value("internal_solid_infill_line_width", new ConfigOptionFloatOrPercent(nozzle_diameter * 1.2, false));
        c.set_key_value("top_surface_pattern", new ConfigOptionEnum<InfillPattern>(ipArchimedeanChords));
        c.set_key_value("top_solid_infill_flow_ratio", new ConfigOptionFloat(1.0f));
        c.set_key_value("infill_direction", new ConfigOptionFloat(45));
        c.set_key_value("solid_infill_direction", new ConfigOptionFloat(135));
        c.set_key_value("align_infill_direction_to_model", new ConfigOptionBool(true));
        c.set_key_value("ironing_type", new ConfigOptionEnum<IroningType>(IroningType::NoIroning));
        c.set_key_value("internal_solid_infill_speed", number("internal_solid_infill_speed", internal_solid_speed));
        c.set_key_value("top_surface_speed", number("top_surface_speed", top_surface_speed));
        c.set_key_value("seam_slope_type", new ConfigOptionEnum<SeamScarfType>(SeamScarfType::None));
        c.set_key_value("gap_fill_target", new ConfigOptionEnum<GapFillTarget>(GapFillTarget::gftNowhere));
        c.set_key_value("calib_flowrate_topinfill_special_order", new ConfigOptionBool(true));

        // Each block is named flowrate_<modifier> ("m" for minus).
        std::string name = o->name.size() > 9 ? o->name.substr(9) : "0";
        if (name[0] == 'm') name[0] = '-';
        const std::string loc = std::setlocale(LC_NUMERIC, nullptr);
        std::setlocale(LC_NUMERIC, "C");
        float modifier = 1.0f;
        try {
            modifier = std::stof(name);
        } catch (...) {
        }
        std::setlocale(LC_NUMERIC, loc.c_str());
        c.set_key_value("print_flow_ratio", new ConfigOptionFloat(linear ? (cur_flowrate + modifier) / cur_flowrate : 1.0f + modifier / 100.f));
    }
    set(cfg, "max_volumetric_extrusion_rate_slope", number("max_volumetric_extrusion_rate_slope", 0.));
    set(cfg, "layer_height", new ConfigOptionFloat(layer_height));
    set(cfg, "alternate_extra_wall", new ConfigOptionBool(false));
    set(cfg, "initial_layer_print_height", new ConfigOptionFloat(first_layer_height));
    set(cfg, "reduce_crossing_wall", new ConfigOptionBool(true));
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});
}

// Plater::calib_max_vol_speed; returns the params in mm/s per layer.
Calib_Params maxVolumetricSpeed(Calib_Params params, DynamicPrintConfig& cfg, double bedWidth) {
    ModelObject* obj = pr().model.objects[0];
    const double scale_obj = (bedWidth - 10) / obj->bounding_box_exact().size().x();
    if (scale_obj < 1.0) scaleAll(Vec3d(scale_obj, 1, 1));
    const double nozzle_diameter = nozzleDiameter(cfg);
    const double line_width = nozzle_diameter * 1.75;
    const double layer_height = nozzle_diameter * 0.8;
    raiseMaxLayerHeight(cfg, layer_height);

    set(cfg, "filament_max_volumetric_speed", number("filament_max_volumetric_speed", 200.));
    set(cfg, "slow_down_layer_time", number("slow_down_layer_time", 0.0));
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});
    auto& c = obj->config;
    c.set_key_value("enable_overhang_speed", flag("enable_overhang_speed", false));
    c.set_key_value("wall_loops", new ConfigOptionInt(1));
    c.set_key_value("alternate_extra_wall", new ConfigOptionBool(false));
    c.set_key_value("top_shell_layers", new ConfigOptionInt(0));
    c.set_key_value("bottom_shell_layers", new ConfigOptionInt(0));
    c.set_key_value("sparse_infill_density", new ConfigOptionPercent(0));
    c.set_key_value("overhang_reverse", new ConfigOptionBool(false));
    c.set_key_value("outer_wall_line_width", new ConfigOptionFloatOrPercent(line_width, false));
    c.set_key_value("layer_height", new ConfigOptionFloat(layer_height));
    c.set_key_value("brim_type", new ConfigOptionEnum<BrimType>(btOuterAndInner));
    c.set_key_value("brim_width", new ConfigOptionFloat(5.0));
    c.set_key_value("brim_object_gap", new ConfigOptionFloat(0.0));
    set(cfg, "timelapse_type", new ConfigOptionEnum<TimelapseType>(tlTraditional));
    set(cfg, "spiral_mode", new ConfigOptionBool(true));
    set(cfg, "max_volumetric_extrusion_rate_slope", number("max_volumetric_extrusion_rate_slope", 0.));

    cutHorizontal((params.end - params.start + 1) / params.step, true);

    const double mm3_per_mm = Flow(float(line_width), float(layer_height), float(nozzle_diameter)).mm3_per_mm() *
                              firstValue(cfg, "filament_flow_ratio");
    params.end /= mm3_per_mm;
    params.start /= mm3_per_mm;
    params.step /= mm3_per_mm;
    return params;
}

// Plater::calib_retraction
void retractionTower(const Calib_Params& params, DynamicPrintConfig& cfg) {
    ModelObject* obj = pr().model.objects[0];
    const double layer_height = 0.2;
    raiseMaxLayerHeight(cfg, layer_height);
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});
    set(cfg, "use_firmware_retraction", new ConfigOptionBool(false));
    obj->config.set_key_value("wall_loops", new ConfigOptionInt(2));
    obj->config.set_key_value("top_shell_layers", new ConfigOptionInt(0));
    obj->config.set_key_value("bottom_shell_layers", new ConfigOptionInt(3));
    obj->config.set_key_value("sparse_infill_density", new ConfigOptionPercent(0));
    set(cfg, "initial_layer_print_height", new ConfigOptionFloat(layer_height));
    obj->config.set_key_value("layer_height", new ConfigOptionFloat(layer_height));
    obj->config.set_key_value("alternate_extra_wall", new ConfigOptionBool(false));
    cutHorizontal(1.0 + 0.4 + (params.end - params.start) / params.step, true);
}

// Plater::calib_VFA
void vfaTower(const Calib_Params& params, DynamicPrintConfig& cfg) {
    ModelObject* obj = pr().model.objects[0];
    set(cfg, "slow_down_layer_time", number("slow_down_layer_time", 0.0));
    set(cfg, "enable_overhang_speed", flag("enable_overhang_speed", false));
    set(cfg, "timelapse_type", new ConfigOptionEnum<TimelapseType>(tlTraditional));
    set(cfg, "wall_loops", new ConfigOptionInt(1));
    set(cfg, "alternate_extra_wall", new ConfigOptionBool(false));
    set(cfg, "top_shell_layers", new ConfigOptionInt(0));
    set(cfg, "bottom_shell_layers", new ConfigOptionInt(1));
    set(cfg, "sparse_infill_density", new ConfigOptionPercent(0));
    set(cfg, "overhang_reverse", new ConfigOptionBool(false));
    set(cfg, "detect_thin_wall", new ConfigOptionBool(false));
    set(cfg, "spiral_mode", new ConfigOptionBool(true));
    commonTowerSettings(cfg, obj);
    cutHorizontal(5 * ((params.end - params.start) / params.step + 1), true);
}

// Plater::_calib_pa_tower
void paTower(const Calib_Params& params, DynamicPrintConfig& cfg) {
    ModelObject* obj = pr().model.objects[0];
    const double nozzle_diameter = nozzleDiameter(cfg);
    set(cfg, "slow_down_layer_time", number("slow_down_layer_time", 1.0f));
    auto& c = obj->config;
    c.set_key_value("alternate_extra_wall", new ConfigOptionBool(false));
    const auto wall_speed = CalibPressureAdvance::find_optimal_PA_speed(cfg, cfg.get_abs_value("line_width", nozzle_diameter), cfg.get_abs_value("layer_height"), 0);
    c.set_key_value("outer_wall_speed", number("outer_wall_speed", wall_speed));
    c.set_key_value("inner_wall_speed", number("inner_wall_speed", wall_speed));
    c.set_key_value("seam_position", new ConfigOptionEnum<SeamPosition>(spRear));
    c.set_key_value("wall_loops", new ConfigOptionInt(2));
    c.set_key_value("top_shell_layers", new ConfigOptionInt(0));
    c.set_key_value("bottom_shell_layers", new ConfigOptionInt(0));
    c.set_key_value("sparse_infill_density", new ConfigOptionPercent(0));
    c.set_key_value("brim_type", new ConfigOptionEnum<BrimType>(btEar));
    c.set_key_value("brim_object_gap", new ConfigOptionFloat(.0f));
    c.set_key_value("brim_ears_max_angle", new ConfigOptionFloat(135.f));
    c.set_key_value("brim_width", new ConfigOptionFloat(6.f));
    c.set_key_value("seam_slope_type", new ConfigOptionEnum<SeamScarfType>(SeamScarfType::None));
    set(cfg, "max_volumetric_extrusion_rate_slope", number("max_volumetric_extrusion_rate_slope", 0.));
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});
    cutHorizontal(std::ceil((params.end - params.start) / params.step) + 1, true);
}

// Plater::_calib_pa_pattern. The pattern itself is not a model: each test is
// a small "handle" cube, and the zig-zag walls and numbers around it are
// custom G-code made at slicing time (patternGcodes below). One test per
// speed and acceleration pair, laid out in a grid; tests that don't fit go
// on further plates, as desktop's arrange does.
std::vector<std::string> paPattern(const Calib_Params& params, DynamicPrintConfig& cfg, double bedWidth, double bedDepth) {
    std::vector<std::string> notes;
    std::vector<double> speeds = params.speeds;
    std::vector<double> accels = params.accelerations;
    const double nozzle_diameter = nozzleDiameter(cfg);
    set(cfg, "filament_retract_when_changing_layer", new ConfigOptionBoolsNullable{false});
    set(cfg, "filament_wipe", new ConfigOptionBoolsNullable{false});
    set(cfg, "wipe", new ConfigOptionBools{false});
    set(cfg, "retract_when_changing_layer", new ConfigOptionBools{false});
    set(cfg, "resonance_avoidance", new ConfigOptionBool{false});

    // The outer wall acceleration, else the inner wall's, else the default.
    double accel = firstValue(cfg, "outer_wall_acceleration");
    if (accel == 0) accel = firstValue(cfg, "inner_wall_acceleration");
    if (accel == 0) accel = firstValue(cfg, "default_acceleration");
    if (accels.empty()) {
        accels.assign({accel});
        notes.push_back("No accelerations given, so the test uses the default acceleration of " + std::to_string(long(accel)) + " mm/s².");
    } else {
        // The largest one sizes the pattern.
        accel = *std::max_element(accels.begin(), accels.end());
    }
    set(cfg, "outer_wall_acceleration", number("outer_wall_acceleration", accel));
    set(cfg, "print_sequence", new ConfigOptionEnum<PrintSequence>(PrintSequence::ByLayer));

    if (firstValue(cfg, "default_jerk") > 0) {
        double jerk = firstValue(cfg, "outer_wall_jerk");
        if (jerk == 0) jerk = firstValue(cfg, "inner_wall_jerk");
        if (jerk == 0) jerk = firstValue(cfg, "default_jerk");
        for (const char* key : {"default_jerk", "outer_wall_jerk", "inner_wall_jerk", "top_surface_jerk", "infill_jerk", "travel_jerk"})
            set(cfg, key, number(key, jerk));
    }

    const SuggestedConfigCalibPAPattern suggested;
    for (const auto& [key, value] : suggested.float_pairs) set(cfg, key, new ConfigOptionFloat(value));
    for (const auto& [key, ratio] : suggested.nozzle_ratio_pairs) set(cfg, key, new ConfigOptionFloatOrPercent(nozzle_diameter * ratio / 100, false));
    for (const auto& [key, value] : suggested.int_pairs) set(cfg, key, new ConfigOptionInt(value));
    set(cfg, suggested.brim_pair.first, new ConfigOptionEnum<BrimType>(suggested.brim_pair.second));

    if (speeds.empty()) {
        const double speed = CalibPressureAdvance::find_optimal_PA_speed(cfg, cfg.get_abs_value("line_width", nozzle_diameter), cfg.get_abs_value("layer_height"), 0);
        set(cfg, "outer_wall_speed", number("outer_wall_speed", speed));
        speeds.assign({speed});
        notes.push_back("No speeds given, so the test uses the best speed for it, " + std::to_string(long(speed)) + " mm/s.");
    } else if (speeds.size() == 1) {
        set(cfg, "outer_wall_speed", number("outer_wall_speed", speeds.front()));
    }

    engine::Project& p = pr();
    p.clear();
    p.plateWidth = bedWidth;
    p.plateDepth = bedDepth;
    ModelObject* cube = p.model.add_object();
    cube->add_instance();
    TriangleMesh mesh = engine::shapeMesh("Cube");
    const BoundingBoxf3 mesh_bb = mesh.bounding_box();
    cube->add_volume(std::move(mesh))->name = "Cube";
    cube->config.set_key_value("extruder", new ConfigOptionInt(0));
    cube->invalidate_bounding_box();
    cube->translate(-mesh_bb.center());

    const CalibPressureAdvancePattern pattern(params, cfg, engine::selectedPrinterIsBambu(), *cube, Vec3d::Zero());
    BoundingBoxf3 bb = cube->raw_bounding_box();
    cube->scale(Vec3d(pattern.handle_xy_size() / bb.size().x(), pattern.handle_xy_size() / bb.size().y(), pattern.max_layer_z() / bb.size().z()));

    // Desktop arranges copies of the pattern's outline, 4 mm larger, on the
    // plate less its arrange margin.
    const double cellX = pattern.print_size_x() + 4, cellY = pattern.print_size_y() + 4, margin = 5;
    const int cols = int((bedWidth - 2 * margin) / cellX), rows = int((bedDepth - 2 * margin) / cellY);
    if (cols < 1 || rows < 1)
        throw std::runtime_error("The test pattern (" + std::to_string(long(std::ceil(pattern.print_size_x()))) + " × " +
                                 std::to_string(long(std::ceil(pattern.print_size_y()))) +
                                 " mm) does not fit the plate. Use fewer pressure advance steps.");
    const size_t tests = speeds.size() * accels.size(), perPlate = size_t(cols) * rows;
    p.plateCount = int((tests + perPlate - 1) / perPlate);
    for (size_t t = 0; t < tests; ++t) {
        const int plate = int(t / perPlate), cell = int(t % perPlate);
        const size_t onPlate = std::min(perPlate, tests - plate * perPlate);
        const int usedCols = int(std::min<size_t>(cols, onPlate)), usedRows = int((onPlate + cols - 1) / cols);
        const Vec2d centre = p.plateOrigin(plate) + Vec2d(bedWidth / 2 + (cell % cols - (usedCols - 1) / 2.0) * cellX,
                                                           bedDepth / 2 + ((usedRows - 1) / 2.0 - cell / cols) * cellY);
        const double speed = speeds[t % speeds.size()], acc = accels[t / speeds.size()];
        ModelObject* obj = t == 0 ? cube : p.model.add_object(*cube);
        obj->name = "pa_pattern_" + std::to_string(int(speed)) + "_" + std::to_string(int(acc));
        if (speeds.size() > 1) obj->config.set_key_value("outer_wall_speed", number("outer_wall_speed", speed));
        if (accels.size() > 1) obj->config.set_key_value("outer_wall_acceleration", number("outer_wall_acceleration", acc));
        obj->instances[0]->set_offset(Vec3d(centre.x(), centre.y(), 0) + pattern.handle_pos_offset());
        obj->invalidate_bounding_box();
        obj->ensure_on_bed();
    }
    return notes;
}

// Plater::calib_input_shaping_freq / _damp / calib_junction_deviation
void ringingTower(CalibMode mode, DynamicPrintConfig& cfg) {
    ModelObject* obj = pr().model.objects[0];
    const bool junction = mode == CalibJunctionDeviation;
    set(cfg, "machine_max_junction_deviation", number("machine_max_junction_deviation", junction ? 1.0 : 0.3));
    set(cfg, "slow_down_layer_time", number("slow_down_layer_time", 0.0));
    set(cfg, "slow_down_min_speed", number("slow_down_min_speed", 0.0));
    set(cfg, "slow_down_for_layer_cooling", new ConfigOptionBools{false});
    if (junction) set(cfg, "filament_max_volumetric_speed", number("filament_max_volumetric_speed", 200.));
    set(cfg, "enable_pressure_advance", new ConfigOptionBools{true});
    set(cfg, "pressure_advance", number("pressure_advance", 0.0));
    set(cfg, "adaptive_pressure_advance", new ConfigOptionBools{false});
    set(cfg, "layer_height", new ConfigOptionFloat(0.2));
    set(cfg, "enable_overhang_speed", flag("enable_overhang_speed", false));
    set(cfg, "timelapse_type", new ConfigOptionEnum<TimelapseType>(tlTraditional));
    set(cfg, "wall_loops", new ConfigOptionInt(1));
    set(cfg, "top_shell_layers", new ConfigOptionInt(0));
    set(cfg, "bottom_shell_layers", new ConfigOptionInt(1));
    set(cfg, "sparse_infill_density", new ConfigOptionPercent(0));
    set(cfg, "detect_thin_wall", new ConfigOptionBool(false));
    set(cfg, "spiral_mode", new ConfigOptionBool(true));
    set(cfg, "spiral_mode_smooth", new ConfigOptionBool(false));
    set(cfg, "bottom_surface_pattern", new ConfigOptionEnum<InfillPattern>(ipRectilinear));
    set(cfg, "outer_wall_speed", number("outer_wall_speed", 200.));
    set(cfg, "default_acceleration", number("default_acceleration", 2000.));
    set(cfg, "outer_wall_acceleration", number("outer_wall_acceleration", 2000.));
    set(cfg, "default_junction_deviation", number("default_junction_deviation", junction ? 0.0 : 0.25));
    commonTowerSettings(cfg, obj);
}

const std::map<std::string, CalibMode> MODES = {
    {"temperature", CalibMode::Calib_Temp_Tower},     {"flowRate", CalibMode::Calib_Flow_Rate},
    {"paLine", CalibMode::Calib_PA_Line},             {"paTower", CalibMode::Calib_PA_Tower},
    {"paPattern", CalibMode::Calib_PA_Pattern},
    {"retraction", CalibMode::Calib_Retraction_tower}, {"volumetricSpeed", CalibMode::Calib_Vol_speed_Tower},
    {"vfa", CalibMode::Calib_VFA_Tower},              {"inputShapingFrequency", CalibMode::Calib_Input_shaping_freq},
    {"inputShapingDamping", CalibMode::Calib_Input_shaping_damp}, {"junctionDeviation", CalibJunctionDeviation},
};

// Sets up a calibration test as the project.
//   options: {mode, model (test model path in the wasm FS), start, end, step,
//             printNumbers, pass (flow rate: 1 or 2), linear (flow rate: Orca's
//             YOLO test), freqStartX, freqEndX, freqStartY, freqEndY,
//             speeds, accelerations (PA pattern: one test per pair)}
//   configJson: the full config the test starts from (selected presets plus
//               overrides), key -> value.
// Returns {ok, overrides: {key: value}, notes: [text]}: the settings to change
// on top of that config, as desktop changes them in the presets, and what
// desktop tells the user about the choices it made.
std::string calibrationStart(const std::string& optionsJson, const std::string& configJson, double bedWidth, double bedDepth) {
    try {
        const json opt = json::parse(optionsJson);
        const auto mode = MODES.find(opt.value("mode", ""));
        if (mode == MODES.end()) throw std::runtime_error("unknown calibration " + opt.value("mode", ""));
        DynamicPrintConfig base;
        base.apply(FullPrintConfig::defaults());
        engine::applyJsonConfig(base, json::parse(configJson));
        DynamicPrintConfig cfg = base;

        Calib_Params params;
        params.mode = mode->second;
        params.start = opt.value("start", 0.0);
        params.end = opt.value("end", 0.0);
        params.step = opt.value("step", 0.0);
        params.print_numbers = opt.value("printNumbers", true);
        params.freqStartX = opt.value("freqStartX", 0.0);
        params.freqEndX = opt.value("freqEndX", 0.0);
        params.freqStartY = opt.value("freqStartY", 0.0);
        params.freqEndY = opt.value("freqEndY", 0.0);
        params.test_model = opt.value("testModel", 0);
        // Desktop's lists keep whole numbers above 0 (ParseStringValues).
        for (const auto& [key, list] : {std::pair{"speeds", &params.speeds}, std::pair{"accelerations", &params.accelerations}})
            for (const json& v : opt.value(key, json::array()))
                if (v.is_number() && int(v.get<double>()) > 0) list->push_back(int(v.get<double>()));
        if (params.mode != CalibMode::Calib_Flow_Rate && params.mode != CalibMode::Calib_Input_shaping_freq &&
            params.mode != CalibMode::Calib_Input_shaping_damp && params.mode != CalibJunctionDeviation &&
            params.mode != CalibMode::Calib_PA_Line && params.step <= 0)
            throw std::runtime_error("the step must be more than 0");

        std::vector<std::string> notes;
        if (params.mode == CalibMode::Calib_PA_Pattern) {
            params.print_numbers = true;
            notes = paPattern(params, cfg, bedWidth, bedDepth);
        } else {
            loadTestModel(opt.at("model").get<std::string>(), bedWidth, bedDepth);
        }
        switch (params.mode) {
        case CalibMode::Calib_Temp_Tower: temperatureTower(params, cfg); break;
        case CalibMode::Calib_Flow_Rate:
            flowRate(opt.value("linear", false), opt.value("pass", 1), cfg);
            params.mode = CalibMode::Calib_None;  // desktop sets no calib params for flow rate
            break;
        case CalibMode::Calib_PA_Line: set(cfg, "resonance_avoidance", new ConfigOptionBool{false}); break;
        case CalibMode::Calib_PA_Tower: paTower(params, cfg); break;
        case CalibMode::Calib_PA_Pattern: break;
        case CalibMode::Calib_Retraction_tower: retractionTower(params, cfg); break;
        case CalibMode::Calib_Vol_speed_Tower: params = maxVolumetricSpeed(params, cfg, bedWidth); break;
        case CalibMode::Calib_VFA_Tower: vfaTower(params, cfg); break;
        default: ringingTower(params.mode, cfg); break;
        }
        pr().calib = params;
        pr().fileName = opt.value("name", "");

        json overrides = json::object();
        for (const std::string& key : cfg.keys()) {
            const ConfigOption* now = cfg.option(key);
            const ConfigOption* was = base.option(key);
            if (!was || *now != *was) overrides[key] = now->serialize();
        }
        return json{{"ok", true}, {"overrides", overrides}, {"notes", notes}}.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

// Ends calibration mode: slicing goes back to normal G-code.
void calibrationStop() { pr().calib = Calib_Params(); }

} // namespace

// Plater::_calib_pa_pattern_gen_gcode, run before every slice as desktop does:
// each handle cube's pattern G-code for the plate's full config, merged layer
// by layer into the plate's custom G-code.
void engine::addCalibrationGcodes(Model& model, const DynamicPrintConfig& cfg) {
    const Calib_Params& params = pr().calib;
    if (params.mode != CalibMode::Calib_PA_Pattern || model.objects.empty()) return;
    const bool bbl = engine::selectedPrinterIsBambu();
    CalibPressureAdvancePattern pattern(params, cfg, bbl, *model.objects.front(), Vec3d::Zero());
    CustomGCode::Info merged;
    for (const ModelObject* obj : model.objects) {
        CustomGCode::Info one = pattern.generate_custom_gcodes(cfg, bbl, *obj, Vec3d::Zero());
        if (merged.gcodes.empty()) {
            merged = std::move(one);
            continue;
        }
        for (size_t i = 0; i < merged.gcodes.size() && i < one.gcodes.size(); ++i) merged.gcodes[i].extra += one.gcodes[i].extra;
    }
    model.plates_custom_gcodes[model.curr_plate_index] = std::move(merged);
}

EMSCRIPTEN_BINDINGS(calib_api) {
    emscripten::function("calibrationStart", &calibrationStart);
    emscripten::function("calibrationStop", &calibrationStop);
}

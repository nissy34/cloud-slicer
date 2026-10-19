// Variable layer height, like desktop Orca's layer height editing
// (GLCanvas3D::LayersEditing): an object's layer_height_profile, made
// adaptive from its surface slopes (layer_height_profile_adaptive), smoothed
// (smooth_height_profile), raised or lowered around a height by hand
// (adjust_layer_height_profile) or reset. The profile is saved with the
// project and used by every slice, as on desktop.
#include "engine.hpp"

#include "libslic3r/Print.hpp"
#include "libslic3r/Slicing.hpp"

using nlohmann::json;
using namespace Slic3r;

namespace {

ModelObject* objectAt(int o) {
    auto& objs = engine::project().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

LayerHeightEditActionType actionOf(const std::string& a) {
    if (a == "increase") return LAYER_HEIGHT_EDIT_ACTION_INCREASE;
    if (a == "decrease") return LAYER_HEIGHT_EDIT_ACTION_DECREASE;
    if (a == "reduce") return LAYER_HEIGHT_EDIT_ACTION_REDUCE;
    if (a == "smooth") return LAYER_HEIGHT_EDIT_ACTION_SMOOTH;
    throw std::runtime_error("unknown layer height action " + a);
}

// Edits object o's layer height profile and returns it. configJson is the
// full print config (the presets plus the page's changes); request:
//   {op: "get"}                                   the profile as it is
//   {op: "adaptive", quality: 0..1}               desktop's Adaptive: 0 = quality (thin layers), 1 = speed
//   {op: "smooth", radius: 1..10, keepMin: bool}  desktop's Smooth
//   {op: "adjust", action: "increase" | "decrease" | "reduce" | "smooth",
//    zs: [mm, ...], strength: mm per step, band: mm}  desktop's manual editing, one step per z
//   {op: "reset"}                                 back to the plain layer height
// Returns {ok, custom, profile: [z, height, ...], layers: [bottom, top, ...]
// (the layers a slice will print, generate_object_layers), layerHeight,
// minLayerHeight, maxLayerHeight, firstLayerHeight, height}.
std::string layerHeights(int o, const std::string& configJson, const std::string& requestJson) {
    try {
        ModelObject* obj = objectAt(o);
        DynamicPrintConfig config;
        const std::vector<std::string> errors = engine::applyJsonConfig(config, json::parse(configJson));
        (void)errors;
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "get");

        const SlicingParameters sp = PrintObject::slicing_parameters(config, *obj, float(obj->max_z()), Vec3d::Ones());
        std::vector<coordf_t> profile = obj->layer_height_profile.get();
        if (op == "reset") {
            obj->layer_height_profile.clear();
            profile.clear();
        } else if (op == "adaptive") {
            profile = layer_height_profile_adaptive(sp, *obj, req.value("quality", 0.5f));
            obj->layer_height_profile.set(profile);
        } else if (op == "smooth") {
            PrintObject::update_layer_height_profile(*obj, sp, profile);
            profile = smooth_height_profile(profile, sp, HeightProfileSmoothingParams(std::clamp(req.value("radius", 5), 1, 10), req.value("keepMin", false)));
            obj->layer_height_profile.set(profile);
        } else if (op == "adjust") {
            PrintObject::update_layer_height_profile(*obj, sp, profile);
            const LayerHeightEditActionType action = actionOf(req.value("action", "increase"));
            const double strength = req.value("strength", 0.005), band = req.value("band", 2.0);
            for (const json& z : req.value("zs", json::array()))
                adjust_layer_height_profile(*obj, sp, profile, z.get<double>(), strength, band, action);
            obj->layer_height_profile.set(profile);
        } else if (op != "get") {
            throw std::runtime_error("unknown layer height op " + op);
        }
        const bool custom = !obj->layer_height_profile.empty();
        // An object without its own profile prints at the plain layer height.
        PrintObject::update_layer_height_profile(*obj, sp, profile);
        return json{{"ok", true},
                    {"custom", custom},
                    {"profile", profile},
                    {"layers", generate_object_layers(sp, profile, false)},
                    {"layerHeight", sp.layer_height},
                    {"minLayerHeight", sp.min_layer_height},
                    {"maxLayerHeight", sp.max_layer_height},
                    {"firstLayerHeight", sp.first_object_layer_height},
                    {"height", sp.object_print_z_uncompensated_height()}}
            .dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(layers_api) {
    emscripten::function("layerHeights", &layerHeights);
}

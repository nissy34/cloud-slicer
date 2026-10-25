// Desktop Orca's menus on the plate and the empty space around it
// (MenuFactory::create_plate_menu and create_default_menu): add a primitive
// shape as a new object, delete everything on a plate, and rename a plate.
// Also the items desktop's layer slider adds to a plate (IMSlider): pauses,
// filament changes and custom G-code at a layer.
// The page's other plate menu items (arrange, auto orient, delete plate, add
// models, text and SVG shapes) use the calls those tools already have.
#include "engine.hpp"

#include <algorithm>
#include <cmath>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

// Names of CustomGCode::Type for the page.
constexpr const char* TYPE_NAMES[] = {"colour", "pause", "filament", "template", "custom"};

CustomGCode::Type typeNamed(const std::string& name) {
    for (int t = 0; t < 5; ++t)
        if (name == TYPE_NAMES[t]) return CustomGCode::Type(t);
    throw std::runtime_error("unknown layer item " + name);
}

} // namespace

namespace engine {

// See engine.hpp.
json layerCodesJson(int plate) {
    json out = json::array();
    const auto it = pr().model.plates_custom_gcodes.find(plate);
    if (it == pr().model.plates_custom_gcodes.end()) return out;
    for (const CustomGCode::Item& item : it->second.gcodes) {
        const int t = int(item.type);
        out.push_back({{"z", item.print_z}, {"type", t >= 0 && t < 5 ? TYPE_NAMES[t] : "unknown"},
                       {"filament", item.extruder}, {"colour", item.color}, {"gcode", item.extra}});
    }
    return out;
}

// See engine.hpp.
json plateSettingsJson(int plate) {
    const Project& p = pr();
    if (size_t(plate) >= p.plates.size() || !p.plates[plate]) return json::object();
    return configToJson(p.plates[plate]->config);
}

// See engine.hpp. Desktop merges the plate's whole config, keys it doesn't
// show in the window included (upstream's filament map of a two-nozzle printer).
void applyPlateSettings(DynamicPrintConfig& cfg, int plate) {
    const Project& p = pr();
    if (size_t(plate) < p.plates.size() && p.plates[plate]) cfg.apply(p.plates[plate]->config);
}

} // namespace engine

namespace {

// Desktop's clipboard (Selection::copy_to_clipboard): a copy of what Ctrl+C
// took, so Ctrl+V still works after the original is changed or deleted.
Model& clipboard() {
    static Model m;
    return m;
}

// Plate p's PlateData; plates of a project made here have none until one is needed.
PlateData& plateData(int plate) {
    engine::Project& p = pr();
    while (p.plates.size() <= size_t(plate)) {
        PlateData* d = new PlateData();
        d->plate_index = int(p.plates.size());
        p.plates.push_back(d);
    }
    if (!p.plates[plate]) {
        p.plates[plate] = new PlateData();
        p.plates[plate]->plate_index = plate;
    }
    return *p.plates[plate];
}

// What desktop's Plate settings window sets (Plater::open_platesettings_dialog).
// Each is left out of the plate's config to use the project's.
constexpr const char* PLATE_KEYS[] = {"curr_bed_type", "print_sequence", "spiral_mode", "first_layer_print_sequence",
                                      "other_layers_print_sequence", "other_layers_print_sequence_nums"};

// The settings spiral vase needs, set on each object of a plate whose own
// spiral vase is turned on (PartPlate::set_vase_mode_related_object_config).
// `differ`: those the project's settings don't already have; an object also
// gets any its own settings have otherwise.
void vaseObjectSettings(int plate, const std::vector<std::string>& differ) {
    DynamicPrintConfig vase;
    vase.set_key_value("wall_loops", new ConfigOptionInt(1));
    vase.set_key_value("top_shell_layers", new ConfigOptionInt(0));
    vase.set_key_value("sparse_infill_density", new ConfigOptionPercent(0));
    vase.set_key_value("enable_support", new ConfigOptionBool(false));
    vase.set_key_value("enforce_support_layers", new ConfigOptionInt(0));
    vase.set_key_value("detect_thin_wall", new ConfigOptionBool(false));
    vase.set_key_value("timelapse_type", new ConfigOptionEnum<TimelapseType>(tlTraditional));
    vase.set_key_value("overhang_reverse", new ConfigOptionBool(false));
#if !ENGINE_UPSTREAM
    // Upstream has no automatic wall direction, nor sets one here.
    vase.set_key_value("wall_direction", new ConfigOptionEnum<WallDirection>(WallDirection::Auto));
#endif
    engine::Project& p = pr();
    for (ModelObject* obj : p.model.objects) {
        if (std::none_of(obj->instances.begin(), obj->instances.end(), [&](const ModelInstance* i) { return p.plateOf(*i) == plate; })) continue;
        for (const std::string& key : vase.keys()) {
            const ConfigOption* own = obj->config.option(key);
            const bool needed = std::find(differ.begin(), differ.end(), key) != differ.end() || (own && *own != *vase.option(key));
            if (needed) obj->config.set_key_value(key, vase.option(key)->clone());
        }
    }
}

// Plate p, request:
//   {op: "addShape", shape: Cube|Cylinder|Sphere|Cone|Disc|Torus}
//        a new object (ObjectList::load_shape_object -> load_mesh_object), on
//        the free spot of plate p closest to its centre, on the bed
//   {op: "deleteAll"}   every object on the plate (Plater::remove_curr_plate_all;
//                       an object with copies on other plates keeps those)
//   {op: "rename", name}   the plate's name (desktop's Edit Plate Name)
//   {op: "settings", name?, settings: {key: value | null}, vase?: [keys]}
//        desktop's Plate settings window: the plate's own plate type, print
//        sequence, spiral vase and filament orders (null: the project's), and
//        its name. vase: spiral vase turned on here; the spiral vase settings
//        the project's differ in, set on the plate's objects as desktop does
//   {op: "layerCodes", codes: [{z, type, filament, colour, gcode}], filaments}
//        the plate's layer slider items, replacing them all (see
//        engine::layerCodesJson); filaments: how many the project has, for
//        the mode desktop stores with them (one filament, or one at a time
//        on a printer with several, as desktop's BBS slider always is)
//   {op: "copy", object, instance}   that copy of the object onto the clipboard (Ctrl+C)
//   {op: "copy", items: [{object, instance}]}   several copies (chosen together)
//   {op: "paste"}       the clipboard as new objects on plate p, on the free
//                       spot closest to the centre, several keeping where they
//                       stood from each other (Ctrl+V)
//   {op: "arrangeSelection", objects: [o...]}   those objects' copies on plate p
//                       each on a free spot, around the rest (Arrange selection)
//   {op: "assemble", items: [{object, instance}]}   those copies (two or more,
//                       of different objects) made one object, each part where
//                       it stood (the object menu's Assemble, ObjectList::merge)
// Returns {ok, object?: index of the (first) new object, objects?: all new ones, error?}.
std::string plateAction(int plate, const std::string& requestJson) {
    try {
        engine::Project& p = pr();
        if (plate < 0 || plate >= p.plateCount) throw std::runtime_error("no plate " + std::to_string(plate));
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        json out{{"ok", true}};

        if (op == "addShape") {
            const std::string shape = req.value("shape", "Cube");
            TriangleMesh mesh = engine::shapeMesh(shape);
            const BoundingBoxf3 bb = mesh.bounding_box();
            ModelObject* obj = p.model.add_object();
            obj->name = shape;
            obj->add_instance();
            ModelVolume* v = obj->add_volume(std::move(mesh));
            obj->sort_volumes(true);
            v->name = shape;
            // A default filament value, since the user can't add one by hand.
            obj->config.set_key_value("extruder", new ConfigOptionInt(0));
            obj->invalidate_bounding_box();
            obj->translate(-bb.center());
            engine::placeObject(obj, plate);
            out["object"] = p.model.objects.size() - 1;
        } else if (op == "deleteAll") {
            for (int o = int(p.model.objects.size()) - 1; o >= 0; --o) {
                ModelObject* obj = p.model.objects[o];
                for (int i = int(obj->instances.size()) - 1; i >= 0; --i)
                    if (p.plateOf(*obj->instances[i]) == plate) obj->delete_instance(size_t(i));
                if (obj->instances.empty()) p.model.delete_object(size_t(o));
                else obj->invalidate_bounding_box();
            }
        } else if (op == "rename") {
            plateData(plate).plate_name = req.value("name", "");
        } else if (op == "settings") {
            PlateData& d = plateData(plate);
            if (req.contains("name")) d.plate_name = req.value("name", "");
            DynamicPrintConfig values;
            const json settings = req.value("settings", json::object());  // kept: items() refers to it
            for (const auto& [key, value] : settings.items()) {
                if (std::find_if(std::begin(PLATE_KEYS), std::end(PLATE_KEYS), [&](const char* k) { return key == k; }) == std::end(PLATE_KEYS))
                    throw std::runtime_error("not a plate setting: " + key);
                if (value.is_null()) d.config.erase(key);
                else values.set_deserialize_strict(key, value.is_string() ? value.get<std::string>() : value.dump());
            }
            d.config.apply(values);
            // Desktop keeps the two halves of the other layers' order together.
            if (!d.config.has("other_layers_print_sequence") || !d.config.has("other_layers_print_sequence_nums")) {
                d.config.erase("other_layers_print_sequence");
                d.config.erase("other_layers_print_sequence_nums");
            }
            if (req.contains("vase")) vaseObjectSettings(plate, req["vase"].get<std::vector<std::string>>());
        } else if (op == "layerCodes") {
            CustomGCode::Info info;
            info.mode = req.value("filaments", 1) > 1 ? CustomGCode::MultiAsSingle : CustomGCode::SingleExtruder;
            for (const json& c : req.value("codes", json::array())) {
                CustomGCode::Item item{c.value("z", 0.0), typeNamed(c.value("type", "")), c.value("filament", 1),
                                       c.value("colour", std::string()), c.value("gcode", std::string())};
                if (item.print_z <= 0) throw std::runtime_error("a layer item needs a height");
                if (item.type == CustomGCode::ToolChange && item.extruder < 1) throw std::runtime_error("a filament change needs a filament");
                // One item per layer, like the slider's ticks.
                auto same = std::find_if(info.gcodes.begin(), info.gcodes.end(),
                                         [&](const CustomGCode::Item& i) { return std::abs(i.print_z - item.print_z) < EPSILON; });
                if (same != info.gcodes.end()) *same = item;
                else info.gcodes.push_back(item);
            }
            std::sort(info.gcodes.begin(), info.gcodes.end());
            if (info.gcodes.empty()) p.model.plates_custom_gcodes.erase(plate);
            else p.model.plates_custom_gcodes[plate] = std::move(info);
        } else if (op == "copy") {
            json items = req.contains("items") ? req["items"] : json::array({{{"object", req.value("object", -1)}, {"instance", req.value("instance", 0)}}});
            if (items.empty()) throw std::runtime_error("nothing to copy");
            Model& clip = clipboard();
            clip.clear_objects();
            for (const json& item : items) {
                const int o = item.value("object", -1), i = item.value("instance", 0);
                if (o < 0 || size_t(o) >= p.model.objects.size()) throw std::runtime_error("no object " + std::to_string(o));
                const ModelObject* src = p.model.objects[o];
                if (i < 0 || size_t(i) >= src->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
                ModelObject* copy = clip.add_object(*src);
                // Only the picked copy, as desktop copies the selected instance.
                for (int k = int(copy->instances.size()) - 1; k >= 0; --k)
                    if (k != i) copy->delete_instance(size_t(k));
            }
        } else if (op == "paste") {
            Model& clip = clipboard();
            if (clip.objects.empty()) throw std::runtime_error("nothing copied yet");
            std::vector<ModelObject*> pasted;
            json objects = json::array();
            for (const ModelObject* src : clip.objects) {
                pasted.push_back(p.model.add_object(*src));
                objects.push_back(p.model.objects.size() - 1);
            }
            if (pasted.size() == 1) engine::placeObject(pasted.front(), plate);
            else engine::placeTogether(pasted, plate);
            out["object"] = objects.front();
            out["objects"] = objects;
        } else if (op == "arrangeSelection") {
            std::vector<ModelObject*> objs;
            for (const json& o : req.value("objects", json::array())) {
                const int k = o.get<int>();
                if (k < 0 || size_t(k) >= p.model.objects.size()) throw std::runtime_error("no object " + std::to_string(k));
                objs.push_back(p.model.objects[k]);
            }
            engine::placeApart(objs, plate);
        } else if (op == "assemble") {
            std::vector<ModelInstance*> copies;
            for (const json& item : req.value("items", json::array())) {
                const int o = item.value("object", -1), i = item.value("instance", 0);
                if (o < 0 || size_t(o) >= p.model.objects.size()) throw std::runtime_error("no object " + std::to_string(o));
                ModelObject* obj = p.model.objects[o];
                if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
                copies.push_back(obj->instances[i]);
            }
            out["object"] = engine::joinCopies(copies);
        } else {
            throw std::runtime_error("unknown plate action " + op);
        }
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(plate_api) {
    emscripten::function("plateAction", &plateAction);
}

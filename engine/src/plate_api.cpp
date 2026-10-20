// Desktop Orca's menus on the plate and the empty space around it
// (MenuFactory::create_plate_menu and create_default_menu): add a primitive
// shape as a new object, delete everything on a plate, and rename a plate.
// The page's other plate menu items (arrange, auto orient, delete plate, add
// models, text and SVG shapes) use the calls those tools already have.
#include "engine.hpp"

#include <algorithm>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

// Desktop's clipboard (Selection::copy_to_clipboard): a copy of what Ctrl+C
// took, so Ctrl+V still works after the original is changed or deleted.
Model& clipboard() {
    static Model m;
    return m;
}

// Plate p, request:
//   {op: "addShape", shape: Cube|Cylinder|Sphere|Cone|Disc|Torus}
//        a new object (ObjectList::load_shape_object -> load_mesh_object), on
//        the free spot of plate p closest to its centre, on the bed
//   {op: "deleteAll"}   every object on the plate (Plater::remove_curr_plate_all;
//                       an object with copies on other plates keeps those)
//   {op: "rename", name}   the plate's name (desktop's Edit Plate Name)
//   {op: "copy", object, instance}   that copy of the object onto the clipboard (Ctrl+C)
//   {op: "paste"}       the clipboard as a new object on plate p, on its free
//                       spot closest to the centre (Ctrl+V)
// Returns {ok, object?: index of the new object, error?}.
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
            // Plates of a project made here have no PlateData until one is needed.
            while (p.plates.size() <= size_t(plate)) {
                PlateData* d = new PlateData();
                d->plate_index = int(p.plates.size());
                p.plates.push_back(d);
            }
            if (!p.plates[plate]) p.plates[plate] = new PlateData();
            p.plates[plate]->plate_name = req.value("name", "");
        } else if (op == "copy") {
            const int o = req.value("object", -1), i = req.value("instance", 0);
            if (o < 0 || size_t(o) >= p.model.objects.size()) throw std::runtime_error("no object " + std::to_string(o));
            const ModelObject* src = p.model.objects[o];
            if (i < 0 || size_t(i) >= src->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
            Model& clip = clipboard();
            clip.clear_objects();
            ModelObject* copy = clip.add_object(*src);
            // Only the picked copy, as desktop copies the selected instance.
            for (int k = int(copy->instances.size()) - 1; k >= 0; --k)
                if (k != i) copy->delete_instance(size_t(k));
        } else if (op == "paste") {
            Model& clip = clipboard();
            if (clip.objects.empty()) throw std::runtime_error("nothing copied yet");
            ModelObject* obj = p.model.add_object(*clip.objects.front());
            engine::placeObject(obj, plate);
            out["object"] = p.model.objects.size() - 1;
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

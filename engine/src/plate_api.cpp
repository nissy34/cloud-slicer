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

// Plate p, request:
//   {op: "addShape", shape: Cube|Cylinder|Sphere|Cone|Disc|Torus}
//        a new object (ObjectList::load_shape_object -> load_mesh_object), on
//        the free spot of plate p closest to its centre, on the bed
//   {op: "deleteAll"}   every object on the plate (Plater::remove_curr_plate_all;
//                       an object with copies on other plates keeps those)
//   {op: "rename", name}   the plate's name (desktop's Edit Plate Name)
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

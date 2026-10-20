// Mesh boolean, like desktop Orca's Mesh Boolean tool (GLGizmoMeshBoolean):
// union, difference or intersection of two volumes of one object with mcut
// (MeshBoolean::mcut::make_boolean). The result takes the first volume's
// place, type, settings and filament; the second one goes (always for a
// union, as on desktop, and for the others when asked).
#include "engine.hpp"

#include "libslic3r/MeshBoolean.hpp"

#include <algorithm>

using nlohmann::json;
using namespace Slic3r;

namespace {

ModelObject* objectAt(int o) {
    auto& objs = engine::project().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

void deleteVolume(ModelObject* obj, const ModelVolume* v) {
    const auto it = std::find(obj->volumes.begin(), obj->volumes.end(), v);
    if (it != obj->volumes.end()) obj->delete_volume(size_t(it - obj->volumes.begin()));
}

int volumeIndex(const ModelObject* obj, ObjectID id) {
    for (size_t k = 0; k < obj->volumes.size(); ++k)
        if (obj->volumes[k]->id() == id) return int(k);
    throw std::runtime_error("the part went missing while joining");
}

// Object o, request {op: "union" | "difference" | "intersection", a, b
// (volume indices: a is the one kept and subtracted from), deleteInput}.
// With bObject (another object; b is then its part) the two objects are first
// joined into one, each a part of it, like desktop's Assemble before a boolean:
// instance aInstance of o and bInstance of bObject (0 when left out).
// Returns {ok, object (where the result is), volume (index of the result), triangles, error?}.
std::string meshBoolean(int o, const std::string& requestJson) {
    try {
        ModelObject* obj = objectAt(o);
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        const char* mode = op == "union" ? "UNION" : op == "difference" ? "A_NOT_B" : op == "intersection" ? "INTERSECTION" : nullptr;
        if (!mode) throw std::runtime_error("unknown boolean " + op);
        int a = req.value("a", -1), b = req.value("b", -1);
        const int bObject = req.value("bObject", o);
        ModelObject* other = objectAt(bObject);
        if (a < 0 || a >= int(obj->volumes.size()) || b < 0 || b >= int(other->volumes.size()))
            throw std::runtime_error(other == obj ? "pick two parts of the object" : "pick a part of each object");
        if (other == obj && a == b) throw std::runtime_error("pick two different parts");

        // Both in the object's coordinates, as desktop does; parts of two
        // objects on the bed, so nothing changes if mcut can't combine them.
        const auto placed = [&](ModelObject* from, int v, const char* instanceKey) {
            TriangleMesh m = from->volumes[v]->mesh();
            Transform3d t = from->volumes[v]->get_matrix();
            if (other != obj) {
                const int i = req.value(instanceKey, 0);
                if (i < 0 || size_t(i) >= from->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
                t = from->instances[i]->get_matrix() * t;
            }
            m.transform(t);
            return m;
        };
        TriangleMesh srcMesh = placed(obj, a, "aInstance");
        TriangleMesh toolMesh = placed(other, b, "bInstance");
        std::vector<TriangleMesh> results;
        MeshBoolean::mcut::make_boolean(srcMesh, toolMesh, results, mode);
        if (results.empty() || results.front().empty())
            throw std::runtime_error(op == "intersection" ? "the parts don't overlap, so nothing is left"
                                                          : "these parts can't be combined (they may not be closed meshes)");

        if (other != obj) {
            // Desktop's Assemble first: one object with both objects' parts,
            // then the result goes into its coordinates.
            const ObjectID ida = obj->volumes[a]->id(), idb = other->volumes[b]->id();
            o = engine::joinObjects(o, req.value("aInstance", 0), bObject, req.value("bInstance", 0));
            obj = objectAt(o);
            a = volumeIndex(obj, ida);
            b = volumeIndex(obj, idb);
            results.front().transform(obj->instances.front()->get_matrix().inverse());
        }
        ModelVolume* src = obj->volumes[a];
        ModelVolume* tool = obj->volumes[b];

        // generate_new_volume: the result in the source's place (centred, with
        // its offset set to where it was), the source and maybe the tool gone.
        ModelVolume* result = obj->add_volume(std::move(results.front()));
        result->name = src->name + " - " + op;
        result->config.apply(src->config);
        result->set_type(src->type());
        result->set_material_id(src->material_id());
        const bool dropTool = op == "union" || req.value("deleteInput", false);
        deleteVolume(obj, src);
        if (dropTool) deleteVolume(obj, tool);
        obj->sort_volumes(true);
        obj->invalidate_bounding_box();
        if (result->is_model_part()) obj->ensure_on_bed();
        const auto it = std::find(obj->volumes.begin(), obj->volumes.end(), result);
        return json{{"ok", true}, {"object", o}, {"volume", int(it - obj->volumes.begin())}, {"triangles", result->mesh().its.indices.size()}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(boolean_api) {
    emscripten::function("meshBoolean", &meshBoolean);
}

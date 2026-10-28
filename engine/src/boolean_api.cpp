// Mesh boolean, like desktop Orca's Mesh Boolean tool (GLGizmoMeshBoolean):
// union, difference or intersection of two volumes of one object (or of one
// and all the object's other solid parts) with mcut
// (MeshBoolean::mcut::make_boolean). The result takes the first volume's
// place, type, settings and filament; the others go (always for a union, as
// on desktop, and for the others when asked). When mcut can't do it, the
// error is desktop's warning with the reasons we can find (holes, a mesh
// crossing itself).
#include "engine.hpp"

#include "libslic3r/MeshBoolean.hpp"
#include "libslic3r/TriangleMesh.hpp"

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

// Desktop's warning when the boolean fails (GLGizmoMeshBoolean's warning_text).
const char* const UNABLE = "Unable to perform boolean operation on selected parts";

// A volume's mesh in the object's coordinates, as desktop takes it.
TriangleMesh inObject(const ModelVolume* v) {
    TriangleMesh m = v->mesh();
    m.transform(v->get_matrix());
    return m;
}

// Why mcut may have failed on these meshes: holes, or a mesh crossing itself.
std::string reasons(const std::vector<std::pair<const ModelVolume*, const TriangleMesh*>>& meshes) {
    std::string out;
    for (const auto& [v, m] : meshes) {
        std::string why;
        if (its_num_open_edges(m->its) > 0) why = "has holes (it isn't a closed mesh)";
        else if (MeshBoolean::cgal::does_self_intersect(*m)) why = "crosses itself";
        if (!why.empty()) out += (out.empty() ? "" : " ") + std::string("\"") + v->name + "\" " + why + ".";
    }
    return out;
}

[[noreturn]] void unable(const std::string& why) {
    throw std::runtime_error(std::string(UNABLE) + ": " + why);
}

bool overlap(const TriangleMesh& a, const TriangleMesh& b) {
    BoundingBoxf3 x = a.bounding_box(), y = b.bounding_box();
    return x.min.x() < y.max.x() && y.min.x() < x.max.x() && x.min.y() < y.max.y() && y.min.y() < x.max.y() && x.min.z() < y.max.z() && y.min.z() < x.max.z();
}

// Object o, request {op: "union" | "difference" | "intersection", a, b
// (volume indices: a is the one kept and subtracted from; b = -1: every other
// part of the object, and negative part for a difference), deleteInput}.
// Returns {ok, volume (index of the result), triangles, error?}.
std::string meshBoolean(int o, const std::string& requestJson) {
    try {
        ModelObject* obj = objectAt(o);
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        const char* mode = op == "union" ? "UNION" : op == "difference" ? "A_NOT_B" : op == "intersection" ? "INTERSECTION" : nullptr;
        if (!mode) throw std::runtime_error("unknown boolean " + op);
        const int a = req.value("a", -1), b = req.value("b", -1);
        const int n = int(obj->volumes.size());
        if (a < 0 || a >= n || b < -1 || b >= n) throw std::runtime_error("pick two parts of the object");
        if (a == b) throw std::runtime_error("pick two different parts");
        ModelVolume* src = obj->volumes[a];
        // The second: one volume, or all the object's other parts (and, to cut
        // them out, its negative parts too; never modifiers or support ones).
        std::vector<ModelVolume*> tools;
        if (b >= 0) tools.push_back(obj->volumes[b]);
        else
            for (ModelVolume* v : obj->volumes)
                if (v != src && (v->is_model_part() || (op == "difference" && v->is_negative_volume()))) tools.push_back(v);
        if (tools.empty()) throw std::runtime_error("the object has no other part");

        // One tool at a time, each on what the last one left, as desktop would do them one after another.
        TriangleMesh result = inObject(src);
        for (const ModelVolume* tool : tools) {
            const TriangleMesh before = result;
            const TriangleMesh toolMesh = inObject(tool);
            std::vector<TriangleMesh> results;
            MeshBoolean::mcut::make_boolean(before, toolMesh, results, mode);
            const auto why = [&] { return reasons({{src, &before}, {tool, &toolMesh}}); };
            if (results.empty() || results.front().empty()) {
                const std::string w = why();
                if (!w.empty()) unable(w);
                throw std::runtime_error(op == "intersection" ? "the parts don't overlap, so nothing is left"
                                                              : std::string(UNABLE) + ": the result is empty");
            }
            // mcut gives the input back when it can't cut (a difference) or
            // puts the two side by side (a union); where the parts overlap
            // that is a failure, which desktop doesn't tell.
            const TriangleMesh& got = results.front();
            const size_t tris = got.its.indices.size();
            const bool untouched = op == "difference" && tris == before.its.indices.size() &&
                                   std::abs(its_volume(got.its) - its_volume(before.its)) < 1e-6 * std::max(1.f, std::abs(its_volume(before.its)));
            const bool sideBySide = op == "union" && tris == before.its.indices.size() + toolMesh.its.indices.size();
            if ((untouched || sideBySide) && overlap(before, toolMesh)) {
                const std::string w = why();
                if (!w.empty()) unable(w);
                if (untouched) unable("\"" + tool->name + "\" doesn't cut into \"" + src->name +
                                      "\". If they do overlap, faces lying exactly on each other stop it: move one a little.");
            }
            result = got;
        }

        // generate_new_volume: the result in the source's place (centred, with
        // its offset set to where it was), the source and maybe the tools gone.
        ModelVolume* out = obj->add_volume(std::move(result));
        out->name = src->name + " - " + op;
        out->config.apply(src->config);
        out->set_type(src->type());
        out->set_material_id(src->material_id());
        const bool dropTools = op == "union" || req.value("deleteInput", false);
        deleteVolume(obj, src);
        if (dropTools)
            for (const ModelVolume* tool : tools) deleteVolume(obj, tool);
        obj->sort_volumes(true);
        obj->invalidate_bounding_box();
        if (out->is_model_part()) obj->ensure_on_bed();
        const auto it = std::find(obj->volumes.begin(), obj->volumes.end(), out);
        return json{{"ok", true}, {"volume", int(it - obj->volumes.begin())}, {"triangles", out->mesh().its.indices.size()}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(boolean_api) {
    emscripten::function("meshBoolean", &meshBoolean);
}

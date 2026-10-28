// Simplify, like desktop Orca's Simplify tool (GLGizmoSimplify): fewer
// triangles for an object's parts with Orca's quadric edge collapse
// (its_quadric_edge_collapse), by a detail level (largest error allowed) or a
// decimate ratio (share of triangles to remove). Painting on the parts
// (filament colours, support enforcers/blockers, seam enforcers/blockers and
// fuzzy skin) is remapped onto the simplified mesh so painted models keep their
// colours and painted regions.
#include "engine.hpp"
#include "paint_remap.hpp"

#include "libslic3r/QuadricEdgeCollapse.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <memory>
#include <optional>
#include <vector>

using nlohmann::json;
using namespace Slic3r;
namespace paint = engine::paint;

namespace {

ModelObject* objectAt(int o) {
    auto& objs = engine::project().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

// Desktop's detail levels, Extra high to Extra low: the largest error allowed, mm.
constexpr float LEVEL_ERROR[] = {1e-3f, 1e-2f, 0.1f, 0.5f, 1.f};

// The last preview, so Apply doesn't simplify twice: the object, the request
// and the simplified mesh of each part (by volume ID, so any change to the
// parts makes it stale).
struct Preview {
    ObjectID object;
    std::string request;
    std::vector<std::pair<ObjectID, indexed_triangle_set>> parts;
};
std::unique_ptr<Preview> g_preview;

size_t triangles(const ModelObject& obj) {
    size_t n = 0;
    for (const ModelVolume* v : obj.volumes)
        if (v->is_model_part()) n += v->mesh().its.indices.size();
    return n;
}

bool isPainted(const ModelObject& obj) {
    for (const ModelVolume* v : obj.volumes)
        if (!v->supported_facets.empty() || !v->seam_facets.empty() || !v->mmu_segmentation_facets.empty() || !v->fuzzy_skin_facets.empty())
            return true;
    return false;
}

Preview& simplified(const ModelObject& obj, const json& req) {
    const std::string key = json{{"level", req.value("level", -1)}, {"ratio", req.value("ratio", -1.0)}}.dump();
    bool fresh = g_preview && g_preview->object == obj.id() && g_preview->request == key;
    if (fresh) {
        size_t k = 0;
        for (const ModelVolume* v : obj.volumes)
            if (v->is_model_part()) fresh = fresh && k < g_preview->parts.size() && g_preview->parts[k++].first == v->id();
        fresh = fresh && k == g_preview->parts.size();
    }
    if (fresh) return *g_preview;
    auto p = std::make_unique<Preview>();
    p->object = obj.id();
    p->request = key;
    const int level = req.value("level", -1);
    const double ratio = req.value("ratio", -1.0);
    for (const ModelVolume* v : obj.volumes) {
        if (!v->is_model_part()) continue;
        indexed_triangle_set its = v->mesh().its;
        uint32_t count = 0;
        float maxError = std::numeric_limits<float>::max();
        if (ratio >= 0) {
            // The gizmo's fix_count_by_ratio: what is left after removing ratio %.
            const double r = std::clamp(ratio, 0.0, 100.0);
            count = uint32_t(std::round(its.indices.size() * (100.0 - r) / 100.0));
            if (count == 0) count = std::min<uint32_t>(4, uint32_t(its.indices.size()));
        } else {
            maxError = LEVEL_ERROR[std::clamp(level, 0, 4)];
        }
        if (!(ratio >= 0 && count >= its.indices.size())) its_quadric_edge_collapse(its, count, &maxError);
        p->parts.emplace_back(v->id(), std::move(its));
    }
    g_preview = std::move(p);
    return *g_preview;
}

// request: {op: "get"}                     the object's triangle count
//          {op: "preview" | "apply", level: 0..4}   desktop's detail level (Extra high .. Extra low)
//          {op: "preview" | "apply", ratio: 0..100} desktop's decimate ratio, % of triangles removed
// Returns {ok, triangles (now), after (with this request), painted}.
std::string simplifyObject(int o, const std::string& requestJson) {
    try {
        ModelObject* obj = objectAt(o);
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "get");
        const bool painted = isPainted(*obj);
        json out{{"ok", true}, {"triangles", triangles(*obj)}, {"painted", painted}};
        if (op == "get") return out.dump();
        if (op != "preview" && op != "apply") throw std::runtime_error("unknown simplify op " + op);

        Preview& p = simplified(*obj, req);
        size_t after = 0;
        for (const auto& part : p.parts) after += part.second.indices.size();
        out["after"] = after;
        if (op == "preview") return out.dump();

        size_t k = 0;
        for (ModelVolume* v : obj->volumes) {
            if (!v->is_model_part()) continue;
            // The preview's mesh is used up here (g_preview goes below).
            TriangleMesh newMesh(std::move(p.parts[k++].second));
            if (!v->supported_facets.empty() || !v->seam_facets.empty() || !v->mmu_segmentation_facets.empty() ||
                !v->fuzzy_skin_facets.empty()) {
                const paint::Source src(v->mesh().its);
                paint::remapAnnotation(src, v->supported_facets, v->supported_facets, newMesh);
                paint::remapAnnotation(src, v->seam_facets, v->seam_facets, newMesh);
                paint::remapAnnotation(src, v->mmu_segmentation_facets, v->mmu_segmentation_facets, newMesh);
                paint::remapAnnotation(src, v->fuzzy_skin_facets, v->fuzzy_skin_facets, newMesh);
            }
            v->set_mesh(std::move(newMesh));
            v->calculate_convex_hull();
            v->invalidate_convex_hull_2d();
            v->set_new_unique_id();
        }
        g_preview.reset();
        obj->invalidate_bounding_box();
        obj->ensure_on_bed();
        out["triangles"] = triangles(*obj);
        out["painted"] = isPainted(*obj);
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

void engine::clearSimplifyPreview() { g_preview.reset(); }

EMSCRIPTEN_BINDINGS(simplify_api) {
    emscripten::function("simplifyObject", &simplifyObject);
}

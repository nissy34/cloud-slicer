// Simplify, like desktop Orca's Simplify tool (GLGizmoSimplify): fewer
// triangles for an object's parts with Orca's quadric edge collapse
// (its_quadric_edge_collapse), by a detail level (largest error allowed) or a
// decimate ratio (share of triangles to remove). As on desktop the new mesh
// drops the object's paint, which belonged to the old triangles.
#include "engine.hpp"

#include "libslic3r/QuadricEdgeCollapse.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>

using nlohmann::json;
using namespace Slic3r;

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

const Preview& simplified(const ModelObject& obj, const json& req) {
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
// Returns {ok, triangles (now), after (with this request), painted (apply would
// remove paint)}.
std::string simplifyObject(int o, const std::string& requestJson) {
    try {
        ModelObject* obj = objectAt(o);
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "get");
        bool painted = false;
        for (const ModelVolume* v : obj->volumes)
            painted = painted || !v->supported_facets.empty() || !v->seam_facets.empty() || !v->mmu_segmentation_facets.empty() ||
                      !v->fuzzy_skin_facets.empty();
        json out{{"ok", true}, {"triangles", triangles(*obj)}, {"painted", painted}};
        if (op == "get") return out.dump();
        if (op != "preview" && op != "apply") throw std::runtime_error("unknown simplify op " + op);

        const Preview& p = simplified(*obj, req);
        size_t after = 0;
        for (const auto& part : p.parts) after += part.second.indices.size();
        out["after"] = after;
        if (op == "preview") return out.dump();

        // Desktop's apply_simplify: the new mesh, paint gone (clear_before_change_mesh), back on the bed.
        size_t k = 0;
        for (ModelVolume* v : obj->volumes) {
            v->supported_facets.reset();
            v->seam_facets.reset();
            v->mmu_segmentation_facets.reset();
            v->fuzzy_skin_facets.reset();
            if (!v->is_model_part()) continue;
            v->set_mesh(indexed_triangle_set(p.parts[k++].second));
            v->calculate_convex_hull();
            v->invalidate_convex_hull_2d();
            v->set_new_unique_id();
        }
        g_preview.reset();
        obj->invalidate_bounding_box();
        obj->ensure_on_bed();
        out["triangles"] = triangles(*obj);
        out["painted"] = false;
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(simplify_api) {
    emscripten::function("simplifyObject", &simplifyObject);
}

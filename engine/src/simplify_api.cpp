// Simplify, like desktop Orca's Simplify tool (GLGizmoSimplify): fewer
// triangles for an object's parts with Orca's quadric edge collapse
// (its_quadric_edge_collapse), by a detail level (largest error allowed) or a
// decimate ratio (share of triangles to remove). Painting on the parts
// (filament colours, support enforcers/blockers, seam enforcers/blockers and
// fuzzy skin) is remapped onto the simplified mesh so painted models keep their
// colours and painted regions.
#include "engine.hpp"

#include "libslic3r/AABBMesh.hpp"
#include "libslic3r/QuadricEdgeCollapse.hpp"
#include "libslic3r/TriangleSelector.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <memory>
#include <vector>

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

bool isPainted(const ModelObject& obj) {
    for (const ModelVolume* v : obj.volumes)
        if (!v->supported_facets.empty() || !v->seam_facets.empty() || !v->mmu_segmentation_facets.empty() || !v->fuzzy_skin_facets.empty())
            return true;
    return false;
}

// Remaps one kind of painting (colour, support, seam or fuzzy skin) from `v`'s
// current mesh onto `newMesh` before `newMesh` replaces it.
void remapAnnotation(const ModelVolume& v, FacetsAnnotation& ann, const TriangleMesh& newMesh) {
    if (ann.empty()) return;
    if (newMesh.its.indices.empty()) {
        ann.reset();
        return;
    }

    std::vector<indexed_triangle_set> byState;
    ann.get_facets(v, byState);

    size_t totalVerts = 0, totalTris = 0;
    for (const auto& part : byState) {
        totalVerts += part.vertices.size();
        totalTris += part.indices.size();
    }
    if (totalTris == 0) {
        ann.reset();
        return;
    }

    indexed_triangle_set srcIts;
    std::vector<EnforcerBlockerType> srcStates;
    std::vector<Vec3d> srcNormals;
    srcIts.vertices.reserve(totalVerts);
    srcIts.indices.reserve(totalTris);
    srcStates.reserve(totalTris);
    srcNormals.reserve(totalTris);

    for (size_t s = 0; s < byState.size(); ++s) {
        const auto& part = byState[s];
        if (part.indices.empty()) continue;
        const int offset = int(srcIts.vertices.size());
        srcIts.vertices.insert(srcIts.vertices.end(), part.vertices.begin(), part.vertices.end());
        for (const auto& tri : part.indices) {
            const Vec3i32 idx(tri[0] + offset, tri[1] + offset, tri[2] + offset);
            srcIts.indices.push_back(idx);
            srcStates.push_back(EnforcerBlockerType(s));
            const Vec3d v0 = srcIts.vertices[idx[0]].cast<double>();
            const Vec3d v1 = srcIts.vertices[idx[1]].cast<double>();
            const Vec3d v2 = srcIts.vertices[idx[2]].cast<double>();
            Vec3d n = (v1 - v0).cross(v2 - v0);
            const double len = n.norm();
            srcNormals.push_back(len > 1e-12 ? (n / len) : Vec3d(0., 0., 1.));
        }
    }

    const AABBMesh srcTree(srcIts);

    auto sampleState = [&](const Vec3d& p, const Vec3d& targetNormal) -> EnforcerBlockerType {
        int hitIdx = -1;
        Vec3d hitPoint = Vec3d::Zero();
        const double distSq = srcTree.squared_distance(p, hitIdx, hitPoint);
        if (distSq >= 0. && hitIdx >= 0 && size_t(hitIdx) < srcStates.size() &&
            srcNormals[size_t(hitIdx)].dot(targetNormal) >= -0.1) {
            return srcStates[size_t(hitIdx)];
        }
        double bestT = std::numeric_limits<double>::max();
        EnforcerBlockerType bestState =
            (distSq >= 0. && hitIdx >= 0 && size_t(hitIdx) < srcStates.size()) ? srcStates[size_t(hitIdx)] : EnforcerBlockerType::NONE;
        for (double sign : {1., -1.}) {
            const Vec3d dir = sign * targetNormal;
            for (const AABBMesh::hit_result& h : srcTree.query_ray_hits(p, dir)) {
                const int f = h.face();
                if (h.is_hit() && f >= 0 && size_t(f) < srcStates.size() && std::abs(h.distance()) < bestT &&
                    srcNormals[size_t(f)].dot(targetNormal) > 0.) {
                    bestT = std::abs(h.distance());
                    bestState = srcStates[size_t(f)];
                }
            }
        }
        return bestState;
    };

    TriangleSelector selector(newMesh);
    constexpr size_t MAX_STATES = size_t(EnforcerBlockerType::ExtruderMax) + 1;
    std::array<bool, MAX_STATES> stateAssigned{};

    for (size_t t = 0; t < newMesh.its.indices.size(); ++t) {
        const auto& tri = newMesh.its.indices[t];
        const Vec3d a = newMesh.its.vertices[tri[0]].cast<double>();
        const Vec3d b = newMesh.its.vertices[tri[1]].cast<double>();
        const Vec3d c = newMesh.its.vertices[tri[2]].cast<double>();
        Vec3d n = (b - a).cross(c - a);
        const double len = n.norm();
        n = len > 1e-12 ? (n / len) : Vec3d(0., 0., 1.);

        const Vec3d center = (a + b + c) / 3.;
        const EnforcerBlockerType sCenter = sampleState(center, n);
        const EnforcerBlockerType s0 = sampleState(0.6 * a + 0.2 * b + 0.2 * c, n);
        const EnforcerBlockerType s1 = sampleState(0.2 * a + 0.6 * b + 0.2 * c, n);
        const EnforcerBlockerType s2 = sampleState(0.2 * a + 0.2 * b + 0.6 * c, n);

        EnforcerBlockerType chosen = sCenter;
        if (!(sCenter == s0 && sCenter == s1 && sCenter == s2)) {
            std::array<int, MAX_STATES> votes{};
            votes[size_t(sCenter)] += 2;
            votes[size_t(s0)] += 1;
            votes[size_t(s1)] += 1;
            votes[size_t(s2)] += 1;
            int bestVotes = -1;
            for (size_t s = 0; s < MAX_STATES; ++s) {
                if (votes[s] > bestVotes) {
                    bestVotes = votes[s];
                    chosen = EnforcerBlockerType(s);
                }
            }
        }
        if (chosen != EnforcerBlockerType::NONE) {
            selector.set_facet(int(t), chosen);
            stateAssigned[size_t(chosen)] = true;
        }
    }

    // Ensure a small painted patch smaller than a coarse simplified triangle is still represented.
    std::unique_ptr<AABBMesh> targetTree;
    for (size_t s = 1; s < byState.size() && s < MAX_STATES; ++s) {
        if (byState[s].indices.empty() || stateAssigned[s]) continue;
        if (!targetTree) targetTree = std::make_unique<AABBMesh>(newMesh.its);
        const auto& tri = byState[s].indices.front();
        const Vec3d pt = ((byState[s].vertices[tri[0]] + byState[s].vertices[tri[1]] + byState[s].vertices[tri[2]]) / 3.f).cast<double>();
        int hitIdx = -1;
        Vec3d hitPt = Vec3d::Zero();
        if (targetTree->squared_distance(pt, hitIdx, hitPt) >= 0. && hitIdx >= 0 &&
            size_t(hitIdx) < newMesh.its.indices.size()) {
            selector.set_facet(hitIdx, EnforcerBlockerType(s));
            stateAssigned[s] = true;
        }
    }

    ann.set(selector);
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

        const Preview& p = simplified(*obj, req);
        size_t after = 0;
        for (const auto& part : p.parts) after += part.second.indices.size();
        out["after"] = after;
        if (op == "preview") return out.dump();

        size_t k = 0;
        for (ModelVolume* v : obj->volumes) {
            if (!v->is_model_part()) continue;
            TriangleMesh newMesh(indexed_triangle_set(p.parts[k++].second));
            remapAnnotation(*v, v->supported_facets, newMesh);
            remapAnnotation(*v, v->seam_facets, newMesh);
            remapAnnotation(*v, v->mmu_segmentation_facets, newMesh);
            remapAnnotation(*v, v->fuzzy_skin_facets, newMesh);
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

EMSCRIPTEN_BINDINGS(simplify_api) {
    emscripten::function("simplifyObject", &simplifyObject);
}

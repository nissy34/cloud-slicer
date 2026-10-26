// Simplify, like desktop Orca's Simplify tool (GLGizmoSimplify): fewer
// triangles for an object's parts with Orca's quadric edge collapse
// (its_quadric_edge_collapse), by a detail level (largest error allowed) or a
// decimate ratio (share of triangles to remove). Painting on the parts
// (filament colours, support enforcers/blockers, seam enforcers/blockers and
// fuzzy skin) is remapped onto the simplified mesh so painted models keep their
// colours and painted regions.
#include "engine.hpp"

#include "libslic3r/AABBTreeIndirect.hpp"
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
    std::vector<Vec3f> srcNormals;
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
            const Vec3f& v0 = srcIts.vertices[idx[0]];
            const Vec3f& v1 = srcIts.vertices[idx[1]];
            const Vec3f& v2 = srcIts.vertices[idx[2]];
            Vec3f n = (v1 - v0).cross(v2 - v0);
            const float len = n.norm();
            srcNormals.push_back(len > 1e-12f ? (n / len) : Vec3f(0.f, 0.f, 1.f));
        }
    }

    const AABBTreeIndirect::Tree3f tree =
        AABBTreeIndirect::build_aabb_tree_over_indexed_triangle_set(srcIts.vertices, srcIts.indices);

    std::vector<igl::Hit<float>> hits;
    auto sampleState = [&](const Vec3f& p, const Vec3f& targetNormal) -> EnforcerBlockerType {
        size_t hitIdx = 0;
        Vec3f hitPoint = Vec3f::Zero();
        const float distSq = AABBTreeIndirect::squared_distance_to_indexed_triangle_set(
            srcIts.vertices, srcIts.indices, tree, p, hitIdx, hitPoint);
        if (distSq >= 0.f && hitIdx < srcStates.size() && srcNormals[hitIdx].dot(targetNormal) >= -0.1f) {
            return srcStates[hitIdx];
        }
        float bestT = std::numeric_limits<float>::max();
        EnforcerBlockerType bestState =
            (distSq >= 0.f && hitIdx < srcStates.size()) ? srcStates[hitIdx] : EnforcerBlockerType::NONE;
        for (float sign : {1.f, -1.f}) {
            const Vec3f dir = sign * targetNormal;
            const Vec3f safeDir(
                std::abs(dir.x()) < 1e-7f ? 1e-7f : dir.x(),
                std::abs(dir.y()) < 1e-7f ? 1e-7f : dir.y(),
                std::abs(dir.z()) < 1e-7f ? 1e-7f : dir.z());
            if (AABBTreeIndirect::intersect_ray_all_hits(srcIts.vertices, srcIts.indices, tree, p, safeDir, hits)) {
                for (const auto& h : hits) {
                    if (h.id >= 0 && size_t(h.id) < srcStates.size() && std::abs(h.t) < bestT &&
                        srcNormals[size_t(h.id)].dot(targetNormal) > 0.f) {
                        bestT = std::abs(h.t);
                        bestState = srcStates[size_t(h.id)];
                    }
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
        const Vec3f& a = newMesh.its.vertices[tri[0]];
        const Vec3f& b = newMesh.its.vertices[tri[1]];
        const Vec3f& c = newMesh.its.vertices[tri[2]];
        Vec3f n = (b - a).cross(c - a);
        const float len = n.norm();
        n = len > 1e-12f ? (n / len) : Vec3f(0.f, 0.f, 1.f);

        const Vec3f center = (a + b + c) / 3.f;
        const EnforcerBlockerType sCenter = sampleState(center, n);
        const EnforcerBlockerType s0 = sampleState(0.6f * a + 0.2f * b + 0.2f * c, n);
        const EnforcerBlockerType s1 = sampleState(0.2f * a + 0.6f * b + 0.2f * c, n);
        const EnforcerBlockerType s2 = sampleState(0.2f * a + 0.2f * b + 0.6f * c, n);

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
    AABBTreeIndirect::Tree3f targetTree;
    for (size_t s = 1; s < byState.size() && s < MAX_STATES; ++s) {
        if (byState[s].indices.empty() || stateAssigned[s]) continue;
        if (targetTree.empty()) {
            targetTree = AABBTreeIndirect::build_aabb_tree_over_indexed_triangle_set(
                newMesh.its.vertices, newMesh.its.indices);
        }
        const auto& tri = byState[s].indices.front();
        const Vec3f pt = (byState[s].vertices[tri[0]] + byState[s].vertices[tri[1]] + byState[s].vertices[tri[2]]) / 3.f;
        size_t hitIdx = 0;
        Vec3f hitPt = Vec3f::Zero();
        if (AABBTreeIndirect::squared_distance_to_indexed_triangle_set(
                newMesh.its.vertices, newMesh.its.indices, targetTree, pt, hitIdx, hitPt) >= 0.f &&
            hitIdx < newMesh.its.indices.size()) {
            selector.set_facet(int(hitIdx), EnforcerBlockerType(s));
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

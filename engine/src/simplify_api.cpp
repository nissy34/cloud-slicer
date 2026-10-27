// Simplify, like desktop Orca's Simplify tool (GLGizmoSimplify): fewer
// triangles for an object's parts with Orca's quadric edge collapse
// (its_quadric_edge_collapse), by a detail level (largest error allowed) or a
// decimate ratio (share of triangles to remove). Painting on the parts
// (filament colours, support enforcers/blockers, seam enforcers/blockers and
// fuzzy skin) is remapped onto the simplified mesh so painted models keep their
// colours and painted regions.
#include "engine.hpp"

#include "paint_walk.hpp"

#include "libslic3r/AABBTreeIndirect.hpp"
#include "libslic3r/QuadricEdgeCollapse.hpp"
#include "libslic3r/TriangleSelector.hpp"

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

// The part's current mesh, for reading its paint where the simplified mesh
// lies. The ray-cast tree covers the part's own triangles, not the painted
// facets: those are read from the paint's bitstream at the triangle hit
// (paint_walk.hpp), as rebuilding every facet (FacetsAnnotation::get_facets)
// needs more memory than a 32-bit wasm heap has for a finely painted model.
struct Source {
    const indexed_triangle_set& its;
    AABBTreeIndirect::Tree3f tree;

    explicit Source(const indexed_triangle_set& its)
        : its(its), tree(AABBTreeIndirect::build_aabb_tree_over_indexed_triangle_set(its.vertices, its.indices)) {}

    Vec3d normal(size_t f) const {
        const auto& t = its.indices[f];
        const Vec3d a = its.vertices[t[0]].cast<double>(), b = its.vertices[t[1]].cast<double>(), c = its.vertices[t[2]].cast<double>();
        const Vec3d n = (b - a).cross(c - a);
        const double len = n.norm();
        return len > 1e-12 ? Vec3d(n / len) : Vec3d(0., 0., 1.);
    }
};

#if defined(ENGINE_UPSTREAM) && ENGINE_UPSTREAM
using IglHit = igl::Hit<float>;
#else
using IglHit = igl::Hit;
#endif

// How far inside triangle (a, b, c) point p lies: its smallest barycentric
// coordinate (negative outside).
double insideness(const Vec3d& p, const Vec3f& a3, const Vec3f& b3, const Vec3f& c3) {
    const Vec3d a = a3.cast<double>();
    const Vec3d v0 = b3.cast<double>() - a, v1 = c3.cast<double>() - a, v2 = p - a;
    const double d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1);
    const double denom = d00 * d11 - d01 * d01;
    if (std::abs(denom) < 1e-30) return -std::numeric_limits<double>::max();
    const double v = (d11 * d20 - d01 * d21) / denom, w = (d00 * d21 - d01 * d20) / denom;
    return std::min({1. - v - w, v, w});
}

// Remaps one kind of painting (colour, support, seam or fuzzy skin) from `v`'s
// current mesh (`src`) onto `newMesh` before `newMesh` replaces it.
void remapAnnotation(const Source& src, FacetsAnnotation& ann, const TriangleMesh& newMesh) {
    if (ann.empty()) return;
    if (newMesh.its.indices.empty()) {
        ann.reset();
        return;
    }
    const auto& data = ann.get_data();
    const std::vector<int> start = paint::bitstreamStarts(data, src.its.indices.size());

    // The paint at point p on triangle f of the current mesh.
    auto stateAt = [&](size_t f, const Vec3d& p) {
        if (f >= start.size() || start[f] < 0) return EnforcerBlockerType::NONE;
        const auto& t = src.its.indices[f];
        EnforcerBlockerType best = EnforcerBlockerType::NONE;
        double bestIn = -std::numeric_limits<double>::max();
        paint::forEachFacet(data.bitstream, start[f], src.its.vertices[t[0]], src.its.vertices[t[1]], src.its.vertices[t[2]],
                            [&](const Vec3f& p0, const Vec3f& p1, const Vec3f& p2, EnforcerBlockerType s) {
                                const double in = insideness(p, p0, p1, p2);
                                if (in > bestIn) bestIn = in, best = s;
                            });
        return best;
    };

    std::vector<IglHit> hits;
    auto sampleState = [&](const Vec3d& p, const Vec3d& targetNormal) -> EnforcerBlockerType {
        size_t hitIdx = 0;
        Vec3d hitPoint = Vec3d::Zero();
        const double distSq = AABBTreeIndirect::squared_distance_to_indexed_triangle_set(src.its.vertices, src.its.indices, src.tree, p,
                                                                                         hitIdx, hitPoint);
        const bool near = distSq >= 0. && hitIdx < src.its.indices.size();
        if (near && src.normal(hitIdx).dot(targetNormal) >= -0.1) return stateAt(hitIdx, hitPoint);
        // The nearest surface faces away (a thin wall): the closest one facing
        // the same way along the normal.
        double bestT = std::numeric_limits<double>::max();
        size_t bestFace = 0;
        Vec3d bestPoint = Vec3d::Zero();
        for (double sign : {1., -1.}) {
            const Vec3d dir = sign * targetNormal;
            AABBTreeIndirect::intersect_ray_all_hits(src.its.vertices, src.its.indices, src.tree, p, dir, hits);
            for (const IglHit& h : hits) {
                if (h.id < 0 || size_t(h.id) >= src.its.indices.size() || std::abs(h.t) >= bestT) continue;
                if (src.normal(size_t(h.id)).dot(targetNormal) <= 0.) continue;
                bestT = std::abs(h.t);
                bestFace = size_t(h.id);
                bestPoint = p + dir * h.t;
            }
        }
        if (bestT < std::numeric_limits<double>::max()) return stateAt(bestFace, bestPoint);
        return near ? stateAt(hitIdx, hitPoint) : EnforcerBlockerType::NONE;
    };

    constexpr size_t MAX_STATES = size_t(EnforcerBlockerType::ExtruderMax) + 1;
    std::array<bool, MAX_STATES> stateAssigned{};
    std::vector<EnforcerBlockerType> newStates(newMesh.its.indices.size(), EnforcerBlockerType::NONE);

    for (size_t t = 0; t < newMesh.its.indices.size(); ++t) {
        const auto& tri = newMesh.its.indices[t];
        const Vec3d a = newMesh.its.vertices[tri[0]].cast<double>();
        const Vec3d b = newMesh.its.vertices[tri[1]].cast<double>();
        const Vec3d c = newMesh.its.vertices[tri[2]].cast<double>();
        Vec3d n = (b - a).cross(c - a);
        const double len = n.norm();
        n = len > 1e-12 ? Vec3d(n / len) : Vec3d(0., 0., 1.);

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
        newStates[t] = chosen;
        stateAssigned[size_t(chosen)] = true;
    }

    // Ensure a small painted patch smaller than a coarse simplified triangle is
    // still represented: one facet of each state the paint has that no
    // simplified triangle got, put on the simplified triangle nearest it.
    std::array<bool, MAX_STATES> missing{};
    bool anyMissing = false;
    for (size_t s = 1; s < MAX_STATES && s < data.used_states.size(); ++s)
        if (data.used_states[s] && !stateAssigned[s]) missing[s] = anyMissing = true;
    if (anyMissing) {
        std::array<std::optional<Vec3d>, MAX_STATES> where;
        for (const auto& m : data.triangles_to_split) {
            if (m.triangle_idx < 0 || size_t(m.triangle_idx) >= src.its.indices.size()) continue;
            const auto& t = src.its.indices[size_t(m.triangle_idx)];
            paint::forEachFacet(data.bitstream, m.bitstream_start_idx, src.its.vertices[t[0]], src.its.vertices[t[1]], src.its.vertices[t[2]],
                                [&](const Vec3f& p0, const Vec3f& p1, const Vec3f& p2, EnforcerBlockerType s) {
                                    if (missing[size_t(s)] && !where[size_t(s)]) where[size_t(s)] = ((p0 + p1 + p2) / 3.f).cast<double>();
                                });
        }
        const auto targetTree = AABBTreeIndirect::build_aabb_tree_over_indexed_triangle_set(newMesh.its.vertices, newMesh.its.indices);
        for (size_t s = 1; s < MAX_STATES; ++s) {
            if (!where[s]) continue;
            size_t hitIdx = 0;
            Vec3d hitPt = Vec3d::Zero();
            if (AABBTreeIndirect::squared_distance_to_indexed_triangle_set(newMesh.its.vertices, newMesh.its.indices, targetTree, *where[s],
                                                                           hitIdx, hitPt) >= 0. &&
                hitIdx < newStates.size())
                newStates[hitIdx] = EnforcerBlockerType(s);
        }
    }

    // The simplified mesh has only unsplit base triangles: write their state
    // directly as 3MF hex tokens (FacetsAnnotation::set_triangle_from_string),
    // with no TriangleSelector. TriangleSelector builds face neighbors, face
    // normals and node arrays over the whole simplified mesh, too big for a
    // fine mesh on a 32-bit wasm heap.
    ann.reset();
    size_t paintedCount = 0;
    for (EnforcerBlockerType s : newStates)
        if (s != EnforcerBlockerType::NONE) ++paintedCount;
    if (paintedCount == 0) return;

    ann.reserve(int(paintedCount));
    for (size_t t = 0; t < newStates.size(); ++t) {
        const int s = int(newStates[t]);
        if (s <= 0) continue;
        if (s == 1) {
            ann.set_triangle_from_string(int(t), "4");
        } else if (s == 2) {
            ann.set_triangle_from_string(int(t), "8");
        } else {
            const int d = s - 3;
            const int rem = d % 15;
            std::string code;
            code.push_back(rem < 10 ? char('0' + rem) : char('A' + (rem - 10)));
            code.append(size_t(d / 15), 'F');
            code.push_back('C');
            ann.set_triangle_from_string(int(t), code);
        }
    }
    ann.shrink_to_fit();
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
                const Source src(v->mesh().its);
                remapAnnotation(src, v->supported_facets, newMesh);
                remapAnnotation(src, v->seam_facets, newMesh);
                remapAnnotation(src, v->mmu_segmentation_facets, newMesh);
                remapAnnotation(src, v->fuzzy_skin_facets, newMesh);
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

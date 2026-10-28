#pragma once
// Shared paint remapping utilities: projects annotations (multi-material colour,
// supports, seams, and fuzzy skin) from a source mesh onto a new mesh (used by
// Simplify and Cut).
#include "paint_walk.hpp"
#include "libslic3r/AABBTreeIndirect.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/TriangleMesh.hpp"

#include <algorithm>
#include <array>
#include <functional>
#include <limits>
#include <optional>
#include <vector>

namespace engine::paint {

#if defined(ENGINE_UPSTREAM) && ENGINE_UPSTREAM
using IglHit = igl::Hit<float>;
#else
using IglHit = igl::Hit;
#endif

// The part's source mesh, for reading its paint where the destination mesh
// lies. The ray-cast tree covers the part's base triangles, not the painted
// facets: those are read from the paint's bitstream at the triangle hit
// (paint_walk.hpp), as rebuilding every facet (FacetsAnnotation::get_facets)
// needs more memory than a 32-bit wasm heap has for a finely painted model.
struct Source {
    const indexed_triangle_set& its;
    Slic3r::AABBTreeIndirect::Tree3f tree;

    explicit Source(const indexed_triangle_set& its)
        : its(its), tree(Slic3r::AABBTreeIndirect::build_aabb_tree_over_indexed_triangle_set(its.vertices, its.indices)) {}

    Slic3r::Vec3d normal(size_t f) const {
        const auto& t = its.indices[f];
        const Slic3r::Vec3d a = its.vertices[t[0]].cast<double>(), b = its.vertices[t[1]].cast<double>(), c = its.vertices[t[2]].cast<double>();
        const Slic3r::Vec3d n = (b - a).cross(c - a);
        const double len = n.norm();
        return len > 1e-12 ? Slic3r::Vec3d(n / len) : Slic3r::Vec3d(0., 0., 1.);
    }
};

// How far inside triangle (a, b, c) point p lies: its smallest barycentric
// coordinate (negative outside).
inline double insideness(const Slic3r::Vec3d& p, const Slic3r::Vec3f& a3, const Slic3r::Vec3f& b3, const Slic3r::Vec3f& c3) {
    const Slic3r::Vec3d a = a3.cast<double>();
    const Slic3r::Vec3d v0 = b3.cast<double>() - a, v1 = c3.cast<double>() - a, v2 = p - a;
    const double d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1);
    const double denom = d00 * d11 - d01 * d01;
    if (std::abs(denom) < 1e-30) return -std::numeric_limits<double>::max();
    const double v = (d11 * d20 - d01 * d21) / denom, w = (d00 * d21 - d01 * d20) / denom;
    return std::min({1. - v - w, v, w});
}

// Remaps one kind of painting (colour, support, seam or fuzzy skin) from `srcAnn`
// onto `dstAnn` for `newMesh`. If `isCap` is provided, triangles for which it
// returns true (e.g. cut cross-section planar caps) are treated as unpainted interior faces.
// If `recoverSmallPatches` is true (default, for Simplify), small-patch state recovery
// ensures states from original fine facets that were not sampled onto any new coarse triangle
// are assigned to the nearest triangle. For Cut, this is set to false because triangles
// are not decimated and states from the opposite cut half must not bleed over.
template<typename IsCapPredicate = std::nullptr_t>
inline void remapAnnotation(const Source& src, const Slic3r::FacetsAnnotation& srcAnn, Slic3r::FacetsAnnotation& dstAnn,
                            const Slic3r::TriangleMesh& newMesh,
                            IsCapPredicate isCap = nullptr,
                            bool recoverSmallPatches = true) {
    if (srcAnn.empty()) {
        dstAnn.reset();
        return;
    }
    if (newMesh.its.indices.empty()) {
        dstAnn.reset();
        return;
    }
    const auto& data = srcAnn.get_data();
    const std::vector<int> start = paint::bitstreamStarts(data, src.its.indices.size());

    // The paint at point p on triangle f of the source mesh.
    auto stateAt = [&](size_t f, const Slic3r::Vec3d& p) {
        if (f >= start.size() || start[f] < 0) return Slic3r::EnforcerBlockerType::NONE;
        const auto& t = src.its.indices[f];
        Slic3r::EnforcerBlockerType best = Slic3r::EnforcerBlockerType::NONE;
        double bestIn = -std::numeric_limits<double>::max();
        paint::forEachFacet(data.bitstream, start[f], src.its.vertices[t[0]], src.its.vertices[t[1]], src.its.vertices[t[2]],
                            [&](const Slic3r::Vec3f& p0, const Slic3r::Vec3f& p1, const Slic3r::Vec3f& p2, Slic3r::EnforcerBlockerType s) {
                                const double in = insideness(p, p0, p1, p2);
                                if (in > bestIn) bestIn = in, best = s;
                            });
        return best;
    };

    std::vector<IglHit> hits;
    auto sampleState = [&](const Slic3r::Vec3d& p, const Slic3r::Vec3d& targetNormal) -> Slic3r::EnforcerBlockerType {
        size_t hitIdx = 0;
        Slic3r::Vec3d hitPoint = Slic3r::Vec3d::Zero();
        const double distSq = Slic3r::AABBTreeIndirect::squared_distance_to_indexed_triangle_set(src.its.vertices, src.its.indices, src.tree, p,
                                                                                                 hitIdx, hitPoint);
        const bool near = distSq >= 0. && hitIdx < src.its.indices.size();
        if (near && src.normal(hitIdx).dot(targetNormal) >= -0.1) return stateAt(hitIdx, hitPoint);
        // The nearest surface faces away (a thin wall): the closest one facing
        // the same way along the normal.
        double bestT = std::numeric_limits<double>::max();
        size_t bestFace = 0;
        Slic3r::Vec3d bestPoint = Slic3r::Vec3d::Zero();
        for (double sign : {1., -1.}) {
            const Slic3r::Vec3d dir = sign * targetNormal;
            Slic3r::AABBTreeIndirect::intersect_ray_all_hits(src.its.vertices, src.its.indices, src.tree, p, dir, hits);
            for (const IglHit& h : hits) {
                if (h.id < 0 || size_t(h.id) >= src.its.indices.size() || std::abs(h.t) >= bestT) continue;
                if (src.normal(size_t(h.id)).dot(targetNormal) <= 0.) continue;
                bestT = std::abs(h.t);
                bestFace = size_t(h.id);
                bestPoint = p + dir * h.t;
            }
        }
        if (bestT < std::numeric_limits<double>::max()) return stateAt(bestFace, bestPoint);
        return near ? stateAt(hitIdx, hitPoint) : Slic3r::EnforcerBlockerType::NONE;
    };

    constexpr size_t MAX_STATES = size_t(Slic3r::EnforcerBlockerType::ExtruderMax) + 1;
    std::array<bool, MAX_STATES> stateAssigned{};
    std::vector<Slic3r::EnforcerBlockerType> newStates(newMesh.its.indices.size(), Slic3r::EnforcerBlockerType::NONE);

    for (size_t t = 0; t < newMesh.its.indices.size(); ++t) {
        if constexpr (!std::is_same_v<IsCapPredicate, std::nullptr_t>) {
            if (isCap(t)) {
                newStates[t] = Slic3r::EnforcerBlockerType::NONE;
                continue;
            }
        }
        const auto& tri = newMesh.its.indices[t];
        const Slic3r::Vec3d a = newMesh.its.vertices[tri[0]].cast<double>();
        const Slic3r::Vec3d b = newMesh.its.vertices[tri[1]].cast<double>();
        const Slic3r::Vec3d c = newMesh.its.vertices[tri[2]].cast<double>();
        Slic3r::Vec3d n = (b - a).cross(c - a);
        const double len = n.norm();
        n = len > 1e-12 ? Slic3r::Vec3d(n / len) : Slic3r::Vec3d(0., 0., 1.);

        const Slic3r::Vec3d center = (a + b + c) / 3.;
        const Slic3r::EnforcerBlockerType sCenter = sampleState(center, n);
        const Slic3r::EnforcerBlockerType s0 = sampleState(0.6 * a + 0.2 * b + 0.2 * c, n);
        const Slic3r::EnforcerBlockerType s1 = sampleState(0.2 * a + 0.6 * b + 0.2 * c, n);
        const Slic3r::EnforcerBlockerType s2 = sampleState(0.2 * a + 0.2 * b + 0.6 * c, n);

        Slic3r::EnforcerBlockerType chosen = sCenter;
        if (!(sCenter == s0 && sCenter == s1 && sCenter == s2)) {
            // Count votes among the 4 candidates without 256-element array allocation
            std::array<std::pair<Slic3r::EnforcerBlockerType, int>, 4> c = {{{sCenter, 2}, {s0, 1}, {s1, 1}, {s2, 1}}};
            for (size_t i = 1; i < 4; ++i) {
                for (size_t j = 0; j < i; ++j) {
                    if (c[i].first == c[j].first) {
                        c[j].second += c[i].second;
                        c[i].second = 0;
                        break;
                    }
                }
            }
            int bestVotes = -1;
            for (const auto& [st, v] : c) {
                if (v > bestVotes) {
                    bestVotes = v;
                    chosen = st;
                }
            }
        }
        newStates[t] = chosen;
        stateAssigned[size_t(chosen)] = true;
    }

    // Ensure a small painted patch smaller than a coarse triangle is still represented:
    // one facet of each state the paint has that no new triangle got, put on the
    // triangle nearest it. (Only needed for mesh decimation/simplification).
    if (recoverSmallPatches) {
        std::array<bool, MAX_STATES> missing{};
        bool anyMissing = false;
        for (size_t s = 1; s < MAX_STATES && s < data.used_states.size(); ++s)
            if (data.used_states[s] && !stateAssigned[s]) missing[s] = anyMissing = true;
        if (anyMissing) {
            std::array<std::optional<Slic3r::Vec3d>, MAX_STATES> where;
            for (const auto& m : data.triangles_to_split) {
                if (m.triangle_idx < 0 || size_t(m.triangle_idx) >= src.its.indices.size()) continue;
                const auto& t = src.its.indices[size_t(m.triangle_idx)];
                paint::forEachFacet(data.bitstream, m.bitstream_start_idx, src.its.vertices[t[0]], src.its.vertices[t[1]], src.its.vertices[t[2]],
                                    [&](const Slic3r::Vec3f& p0, const Slic3r::Vec3f& p1, const Slic3r::Vec3f& p2, Slic3r::EnforcerBlockerType s) {
                                        if (missing[size_t(s)] && !where[size_t(s)]) where[size_t(s)] = ((p0 + p1 + p2) / 3.f).cast<double>();
                                    });
            }
            const auto targetTree = Slic3r::AABBTreeIndirect::build_aabb_tree_over_indexed_triangle_set(newMesh.its.vertices, newMesh.its.indices);
            for (size_t s = 1; s < MAX_STATES; ++s) {
                if (!where[s]) continue;
                size_t hitIdx = 0;
                Slic3r::Vec3d hitPt = Slic3r::Vec3d::Zero();
                const double distSq = Slic3r::AABBTreeIndirect::squared_distance_to_indexed_triangle_set(
                    newMesh.its.vertices, newMesh.its.indices, targetTree, *where[s], hitIdx, hitPt);
                if (distSq >= 0. && hitIdx < newStates.size()) {
                    if constexpr (!std::is_same_v<IsCapPredicate, std::nullptr_t>) {
                        if (isCap(hitIdx)) continue;
                    }
                    newStates[hitIdx] = Slic3r::EnforcerBlockerType(s);
                }
            }
        }
    }

    // Write triangle states directly as 3MF hex tokens (FacetsAnnotation::set_triangle_from_string),
    // with no TriangleSelector instantiation.
    dstAnn.reset();
    size_t paintedCount = 0;
    for (Slic3r::EnforcerBlockerType s : newStates)
        if (s != Slic3r::EnforcerBlockerType::NONE) ++paintedCount;
    if (paintedCount == 0) return;

    dstAnn.reserve(int(paintedCount));
    for (size_t t = 0; t < newStates.size(); ++t) {
        const int s = int(newStates[t]);
        if (s <= 0) continue;
        if (s == 1) {
            dstAnn.set_triangle_from_string(int(t), "4");
        } else if (s == 2) {
            dstAnn.set_triangle_from_string(int(t), "8");
        } else {
            const int d = s - 3;
            const int rem = d % 15;
            std::string code;
            code.push_back(rem < 10 ? char('0' + rem) : char('A' + (rem - 10)));
            code.append(size_t(d / 15), 'F');
            code.push_back('C');
            dstAnn.set_triangle_from_string(int(t), code);
        }
    }
    dstAnn.shrink_to_fit();
}

} // namespace engine::paint

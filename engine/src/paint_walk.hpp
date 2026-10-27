// Reads painted facets (FacetsAnnotation's TriangleSplittingData) straight
// from their bitstream, without TriangleSelector::deserialize.
//
// Deserializing builds every split node of every painted triangle at once: for
// a finely painted model that is hundreds of MB in single blocks (a 1.8M
// triangle model painted to 7.3M facets asks for one 523 MB block), which a
// 32-bit wasm heap can't give, and mimalloc aborts ("RuntimeError:
// unreachable"). Walking the bitstream one base triangle at a time visits the
// same leaf facets, with the same vertices, using a few KB.
#pragma once

#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleSelector.hpp"

#include <algorithm>
#include <array>
#include <vector>

namespace engine::paint {

using Slic3r::EnforcerBlockerType;
using Slic3r::Vec3f;
using SplitData = Slic3r::TriangleSelector::TriangleSplittingData;

// Bitstream start of each base triangle that has paint, -1 for the rest.
inline std::vector<int> bitstreamStarts(const SplitData& data, size_t triangles) {
    std::vector<int> start(triangles, -1);
    for (const auto& m : data.triangles_to_split)
        if (m.triangle_idx >= 0 && size_t(m.triangle_idx) < triangles) start[size_t(m.triangle_idx)] = m.bitstream_start_idx;
    return start;
}

namespace detail {
struct Reader {
    const std::vector<bool>& bits;
    size_t i;
    int nibble() {
        int n = 0;
        for (int k = 0; k < 4; ++k, ++i)
            if (i < bits.size() && bits[i]) n |= 1 << k;
        return n;
    }
    // A leaf's state, as TriangleSelector::deserialize reads it.
    EnforcerBlockerType state(int code) {
        int s = code >> 2;
        if ((code & 0b1100) == 0b1100) {
            int next = nibble(), num = 0;
            while (next == 0b1111 && i < bits.size()) {
                ++num;
                next = nibble();
            }
            s = next + 15 * num + 3;
        }
        return s > int(EnforcerBlockerType::ExtruderMax) ? EnforcerBlockerType::NONE : EnforcerBlockerType(s);
    }
};
inline Vec3f mid(const Vec3f& a, const Vec3f& b) { return 0.5f * (a + b); }
} // namespace detail

// Calls fn(p0, p1, p2, state) for each leaf facet of base triangle (a, b, c)
// whose paint starts at bit `start`, with the vertices TriangleSelector makes
// (TriangleSelector::perform_split), in deserialize's order.
template <class Fn>
void forEachFacet(const std::vector<bool>& bits, int start, const Vec3f& a, const Vec3f& b, const Vec3f& c, Fn&& fn) {
    if (start < 0 || size_t(start) >= bits.size()) return;
    detail::Reader r{bits, size_t(start)};
    // Depth first; deserialize reads a split node's children last to first.
    std::vector<std::array<Vec3f, 3>> stack;
    stack.reserve(64);
    stack.push_back({a, b, c});
    while (!stack.empty()) {
        if (r.i >= bits.size()) break;  // a truncated stream: stop rather than read past it
        const std::array<Vec3f, 3> t = stack.back();
        stack.pop_back();
        const int code = r.nibble();
        const int sides = code & 0b11;
        if (sides == 0) {
            fn(t[0], t[1], t[2], r.state(code));
            continue;
        }
        const int s = sides == 3 ? 0 : std::min(code >> 2, 2);
        const Vec3f v0 = t[s], v1 = t[(s + 1) % 3], v2 = t[(s + 2) % 3];
        if (sides == 1) {
            const Vec3f m = detail::mid(v2, v1);
            stack.push_back({v0, v1, m});
            stack.push_back({m, v2, v0});
        } else if (sides == 2) {
            const Vec3f m01 = detail::mid(v1, v0), m02 = detail::mid(v0, v2);
            stack.push_back({v0, m01, m02});
            stack.push_back({m01, v1, m02});
            stack.push_back({v1, v2, m02});
        } else {
            const Vec3f m01 = detail::mid(v1, v0), m12 = detail::mid(v2, v1), m02 = detail::mid(v0, v2);
            stack.push_back({v0, m01, m02});
            stack.push_back({m01, v1, m12});
            stack.push_back({m12, v2, m02});
            stack.push_back({m01, m12, m02});
        }
    }
}

// Leaf facets of the base triangle whose paint starts at bit `start`.
inline size_t countFacets(const std::vector<bool>& bits, int start) {
    if (start < 0 || size_t(start) >= bits.size()) return 1;
    detail::Reader r{bits, size_t(start)};
    size_t leaves = 0, open = 1;
    while (open > 0 && r.i < bits.size()) {
        --open;
        const int code = r.nibble();
        const int sides = code & 0b11;
        if (sides == 0) {
            r.state(code);
            ++leaves;
        } else {
            open += size_t(sides) + 1;
        }
    }
    return leaves;
}

// Leaf facets of a whole painted mesh: what get_facets would return, counted.
inline size_t countFacets(const SplitData& data, size_t triangles) {
    size_t n = triangles;
    for (const auto& m : data.triangles_to_split)
        if (m.triangle_idx >= 0 && size_t(m.triangle_idx) < triangles) n += std::max<size_t>(1, countFacets(data.bitstream, m.bitstream_start_idx)) - 1;
    return n;
}

} // namespace engine::paint

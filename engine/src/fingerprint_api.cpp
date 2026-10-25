// What a plate prints, as short fingerprints, for the page's print history:
// a plate printed earlier shows "Changed since printed" once any of these
// differ. Everything the engine holds that goes into the plate's G-code is
// in one of them; the presets' values are added by the page, which has them.
//
//   plateFingerprint(plate) -> {objects: [{name, shape, place, settings, paint}], plate}
//
//   shape     the parts, modifiers, negative volumes and so on: their meshes,
//             kinds and where they sit in the object
//   place     where the object's copies on this plate stand (from the plate's
//             corner, so a plate moving in the grid changes nothing)
//   settings  the object's and its parts' own settings, height range
//             settings and the variable layer height
//   paint     colour, support, seam and fuzzy skin paint, brim ears
//   plate     the plate's own settings, pauses, colour changes and custom G-code
//
// Each is 16 hex digits. They only say "same" or "different": names and
// counts the page compares itself.
#include "engine.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

using nlohmann::json;
using namespace Slic3r;

namespace {

// 64-bit FNV-1a, a word at a time: the same input gives the same digits in
// every build, which std::hash doesn't promise.
struct Hash {
    uint64_t h = 1469598103934665603ULL;
    void word(uint64_t w) {
        h ^= w;
        h *= 1099511628211ULL;
        h ^= h >> 29;
    }
    void bytes(const void* data, size_t n) {
        const auto* p = static_cast<const unsigned char*>(data);
        word(n);
        size_t i = 0;
        for (; i + 8 <= n; i += 8) {
            uint64_t w;
            std::memcpy(&w, p + i, 8);
            word(w);
        }
        uint64_t rest = 0;
        for (size_t k = 0; i < n; ++i, ++k) rest |= uint64_t(p[i]) << (8 * k);
        word(rest);
    }
    void text(const std::string& s) { bytes(s.data(), s.size()); }
    // Positions and angles to a hundred-thousandth: an undo that gives back
    // the same place in slightly different bits is still the same place.
    void number(double v) { word(uint64_t(std::llround(v * 1e5))); }
    void transform(const Transform3d& t) {
        for (int i = 0; i < 16; ++i) number(t.matrix().data()[i]);
    }
    void config(const DynamicPrintConfig& cfg) {
        const t_config_option_keys keys = cfg.keys();
        word(keys.size());
        for (const std::string& k : keys) {
            text(k);
            text(cfg.opt_serialize(k));
        }
    }
    void facets(const FacetsAnnotation& a) {
        const TriangleSelector::TriangleSplittingData& d = a.get_data();
        word(d.triangles_to_split.size());
        for (const auto& m : d.triangles_to_split) word((uint64_t(uint32_t(m.triangle_idx)) << 32) | uint32_t(m.bitstream_start_idx));
        word(d.bitstream.size());
        uint64_t w = 0;
        for (size_t i = 0; i < d.bitstream.size(); ++i) {
            if (d.bitstream[i]) w |= uint64_t(1) << (i % 64);
            if (i % 64 == 63) {
                word(w);
                w = 0;
            }
        }
        word(w);
    }
    std::string hex() const {
        char out[17];
        std::snprintf(out, sizeof out, "%016llx", static_cast<unsigned long long>(h));
        return out;
    }
};

std::string plateFingerprint(int plate) {
    try {
        const engine::Project& pr = engine::project();
        if (plate < 0 || plate >= pr.plateCount) throw std::runtime_error("no plate " + std::to_string(plate));
        const Vec2d origin = pr.plateOrigin(plate);
        json objects = json::array();
        for (const ModelObject* obj : pr.model.objects) {
            Hash place;
            int copies = 0;
            for (const ModelInstance* inst : obj->instances) {
                if (pr.plateOf(*inst) != plate) continue;
                ++copies;
                Transform3d t = inst->get_matrix();
                t.translation() -= Vec3d(origin.x(), origin.y(), 0);
                place.transform(t);
                place.word(inst->printable ? 1 : 0);
            }
            if (!copies) continue;
            Hash shape, settings, paint;
            settings.config(obj->config.get());
            settings.word(obj->layer_config_ranges.size());
            for (const auto& [range, cfg] : obj->layer_config_ranges) {
                settings.number(range.first);
                settings.number(range.second);
                settings.config(cfg.get());
            }
            for (const coordf_t v : obj->layer_height_profile.get()) settings.number(v);
            for (const ModelVolume* v : obj->volumes) {
                const indexed_triangle_set& its = v->mesh().its;
                shape.word(uint64_t(v->type()));
                shape.bytes(its.vertices.data(), its.vertices.size() * sizeof(its.vertices[0]));
                shape.bytes(its.indices.data(), its.indices.size() * sizeof(its.indices[0]));
                shape.transform(v->get_matrix());
                settings.word(uint64_t(v->extruder_id() + 1));
                settings.config(v->config.get());
                paint.facets(v->mmu_segmentation_facets);
                paint.facets(v->supported_facets);
                paint.facets(v->seam_facets);
                paint.facets(v->fuzzy_skin_facets);
            }
            paint.word(obj->brim_points.size());
            for (const BrimPoint& b : obj->brim_points) {
                paint.number(b.pos.x());
                paint.number(b.pos.y());
                paint.number(b.pos.z());
                paint.number(b.head_front_radius);
            }
            objects.push_back({{"name", obj->name}, {"copies", copies}, {"shape", shape.hex()}, {"place", place.hex()},
                               {"settings", settings.hex()}, {"paint", paint.hex()}});
        }
        Hash own;
        if (size_t(plate) < pr.plates.size() && pr.plates[plate]) own.config(pr.plates[plate]->config);
        const auto codes = pr.model.plates_custom_gcodes.find(plate);
        if (codes != pr.model.plates_custom_gcodes.end()) {
            own.word(uint64_t(codes->second.mode));
            for (const CustomGCode::Item& item : codes->second.gcodes) {
                own.number(item.print_z);
                own.word(uint64_t(item.type));
                own.word(uint64_t(item.extruder));
                own.text(item.color);
                own.text(item.extra);
            }
        }
        return json{{"objects", objects}, {"plate", own.hex()}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(fingerprint_api) {
    emscripten::function("plateFingerprint", &plateFingerprint);
}

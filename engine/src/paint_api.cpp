// Painting, like desktop Orca's paint tools: filament colours, support
// enforcers/blockers, seam enforcers/blockers and fuzzy skin, on the faces of
// each part. It uses Orca's own TriangleSelector, so brushes split triangles
// the way desktop does and the result is saved in 3MF projects the same way.
//
// The page sends rays in plate coordinates (from the camera through the
// pointer); the engine finds the part they hit and paints there.
#include "engine.hpp"

#include "libslic3r/AABBMesh.hpp"
#include "libslic3r/TriangleSelector.hpp"

#include <algorithm>
#include <map>
#include <memory>
#include <optional>

using nlohmann::json;
using namespace Slic3r;

// Ray-casting the parts, shared with the Measure tool (measure_api.cpp).
namespace engine {
namespace {

// Ray-cast trees, one per part mesh, kept while the mesh lives.
struct Tree {
    std::weak_ptr<const TriangleMesh> mesh;
    std::unique_ptr<AABBMesh> aabb;
};
std::map<size_t, Tree> g_trees;

} // namespace

const AABBMesh& treeOf(const ModelVolume& v) {
    const auto& mesh = v.get_mesh_shared_ptr();
    Tree& t = g_trees[v.id().id];
    if (!t.aabb || t.mesh.lock() != mesh) {
        t.aabb = std::make_unique<AABBMesh>(*mesh);
        t.mesh = mesh;
    }
    return *t.aabb;
}

// Nearest part on `plate` hit by the ray from s along dir (plate coordinates).
std::optional<RayHit> castRay(int plate, Vec3d s, const Vec3d& dir, const std::vector<int>& only) {
    Project& p = project();
    const Vec2d origin = p.plateOrigin(plate);
    s += Vec3d(origin.x(), origin.y(), 0);
    std::optional<RayHit> best;
    for (size_t o = 0; o < p.model.objects.size(); ++o) {
        if (!only.empty() && std::find(only.begin(), only.end(), int(o)) == only.end()) continue;
        ModelObject* obj = p.model.objects[o];
        for (ModelInstance* inst : obj->instances) {
            if (p.plateOf(*inst) != plate) continue;
            for (ModelVolume* v : obj->volumes) {
                if (!v->is_model_part()) continue;
                const Transform3d m = inst->get_matrix() * v->get_matrix();
                const Transform3d inv = m.inverse();
                const Vec3d ms = inv * s;
                const Vec3d md = (inv.linear() * dir).normalized();
                const AABBMesh::hit_result h = treeOf(*v).query_ray_hit(ms, md);
                if (!h.is_hit()) continue;
                const double d = (m * h.position() - s).norm();
                if (best && best->distance <= d) continue;
                best = RayHit{int(o), inst, v, h.face(), h.position().cast<float>(), ms.cast<float>(), m, d};
            }
        }
    }
    return best;
}

} // namespace engine

namespace {

engine::Project& pr() { return engine::project(); }

std::string fail(const std::string& error) { return json{{"ok", false}, {"error", error}}.dump(); }

// kind: "color" (filament), "support", "seam" or "fuzzy".
FacetsAnnotation& facetsOf(ModelVolume& v, const std::string& kind) {
    if (kind == "color") return v.mmu_segmentation_facets;
    if (kind == "support") return v.supported_facets;
    if (kind == "seam") return v.seam_facets;
    if (kind == "fuzzy") return v.fuzzy_skin_facets;
    throw std::runtime_error("unknown paint kind " + kind);
}

// The selector of the part painted last, so a stroke doesn't rebuild it for
// every dab. It is reused only while its facets are unchanged since.
struct Selector {
    size_t volume = 0;
    std::string kind;
    std::weak_ptr<const TriangleMesh> mesh;
    uint64_t stamp = 0;
    std::unique_ptr<TriangleSelector> sel;
};
Selector g_selector;

} // namespace

void engine::clearPaintCaches() {
    g_selector = Selector();
    g_trees.clear();
}

namespace {

TriangleSelector& selectorOf(ModelVolume& v, const std::string& kind) {
    Selector& s = g_selector;
    FacetsAnnotation& f = facetsOf(v, kind);
    const auto& mesh = v.get_mesh_shared_ptr();
    if (!s.sel || s.volume != v.id().id || s.kind != kind || s.mesh.lock() != mesh || s.stamp != f.timestamp()) {
        s.sel = std::make_unique<TriangleSelector>(*mesh);
        if (!f.empty()) s.sel->deserialize(f.get_data(), false);
        s.volume = v.id().id;
        s.kind = kind;
        s.mesh = mesh;
        s.stamp = f.timestamp();
    }
    return *s.sel;
}

void commit(ModelVolume& v, const std::string& kind) {
    FacetsAnnotation& f = facetsOf(v, kind);
    f.set(*g_selector.sel);
    g_selector.stamp = f.timestamp();
}

using Hit = engine::RayHit;
using engine::castRay;

// Paints along a stroke on `plate`. options:
//   kind:   "color" | "support" | "seam" | "fuzzy"
//   state:  filament number for colour (1..), 1 enforce / 2 block for
//           support and seam, 1 for fuzzy skin; 0 erases
//   tool:   "circle" | "sphere" (brushes), "fill" (smart fill: faces up to
//           `angle` degrees apart) or "bucket" (the painted area under the hit)
//   radius: brush radius in mm; angle: smart fill angle in degrees
//   rays:   [[x, y, z, dx, dy, dz], ...] in plate coordinates, one per dab
// Returns {ok, objects: [object indices painted]}.
std::string paint(int plate, const std::string& optionsJson) {
    try {
        const json opt = json::parse(optionsJson);
        const std::string kind = opt.value("kind", "color");
        const std::string tool = opt.value("tool", "circle");
        const int state = opt.value("state", 1);
        const float radius = opt.value("radius", 2.0f);
        const float angle = opt.value("angle", 30.0f);
        const int maxState = kind == "color" ? int(EnforcerBlockerType::ExtruderMax) : kind == "fuzzy" ? 1 : 2;
        if (state < 0 || state > maxState) throw std::runtime_error("bad paint state " + std::to_string(state));
        const auto newState = EnforcerBlockerType(state);
        const TriangleSelector::ClippingPlane noClip;

        std::vector<int> painted;
        std::optional<Hit> last;  // previous dab, joined to the next by a capsule
        for (const json& r : opt.at("rays")) {
            const Vec3d s(r[0].get<double>(), r[1].get<double>(), r[2].get<double>());
            const Vec3d dir = Vec3d(r[3].get<double>(), r[4].get<double>(), r[5].get<double>()).normalized();
            std::optional<Hit> hit = castRay(plate, s, dir);
            if (!hit) {
                last.reset();
                continue;
            }
            TriangleSelector& sel = selectorOf(*hit->volume, kind);
            const Transform3d noTranslate = hit->inst->get_matrix_no_offset() * hit->volume->get_matrix_no_offset();
            if (tool == "fill" || tool == "bucket") {
                if (tool == "fill")
                    sel.seed_fill_select_triangles(hit->point, hit->facet, noTranslate, noClip, angle, 0.f, true);
                else
                    sel.bucket_fill_select_triangles(hit->point, hit->facet, noClip, angle, true, true);
                sel.seed_fill_apply_on_triangles(newState);
            } else {
                const auto type = tool == "sphere" ? TriangleSelector::CursorType::SPHERE : TriangleSelector::CursorType::CIRCLE;
                std::unique_ptr<TriangleSelector::Cursor> cursor;
                if (last && last->volume == hit->volume && last->inst == hit->inst)
                    cursor = TriangleSelector::DoublePointCursor::cursor_factory(last->point, hit->point, hit->camera, radius, type, hit->trafo, noClip);
                else
                    cursor = TriangleSelector::SinglePointCursor::cursor_factory(hit->point, hit->camera, radius, type, hit->trafo, noClip);
                sel.select_patch(hit->facet, std::move(cursor), newState, noTranslate, true);
            }
            commit(*hit->volume, kind);
            if (std::find(painted.begin(), painted.end(), hit->object) == painted.end()) painted.push_back(hit->object);
            last = hit;
        }
        return json{{"ok", true}, {"objects", painted}}.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

// Removes one kind of paint from every part of object o ("all" for every kind).
std::string clearPaint(int o, const std::string& kind) {
    try {
        auto& objs = pr().model.objects;
        if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
        for (ModelVolume* v : objs[o]->volumes) {
            if (kind == "all") {
                for (const char* k : {"color", "support", "seam", "fuzzy"}) facetsOf(*v, k).reset();
            } else {
                facetsOf(*v, kind).reset();
            }
        }
        return json{{"ok", true}}.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

// Support, seam or fuzzy skin paint on `plate`, to draw over the parts:
// {positions: Float32Array (9 floats / triangle, plate coordinates),
//  states: Uint8Array (1 enforce / 2 block per triangle)}.
emscripten::val paintOverlay(int plate, const std::string& kind) {
    engine::Project& p = pr();
    const Vec2d origin = p.plateOrigin(plate);
    std::vector<float> pos;
    std::vector<uint8_t> states;
    for (ModelObject* obj : p.model.objects)
        for (ModelInstance* inst : obj->instances) {
            if (p.plateOf(*inst) != plate) continue;
            for (ModelVolume* v : obj->volumes) {
                if (!v->is_model_part()) continue;
                const FacetsAnnotation& f = facetsOf(*v, kind);
                if (f.empty()) continue;
                const Transform3d m = inst->get_matrix() * v->get_matrix();
                for (int st : {1, 2}) {
                    const indexed_triangle_set its = f.get_facets_strict(*v, EnforcerBlockerType(st));
                    for (const auto& tri : its.indices) {
                        for (int k = 0; k < 3; ++k) {
                            const Vec3d w = m * its.vertices[tri[k]].cast<double>();
                            pos.push_back(float(w.x() - origin.x()));
                            pos.push_back(float(w.y() - origin.y()));
                            pos.push_back(float(w.z()));
                        }
                        states.push_back(uint8_t(st));
                    }
                }
            }
        }
    emscripten::val out = emscripten::val::object();
    out.set("positions", engine::typedCopy(pos));
    out.set("states", engine::typedCopy(states));
    return out;
}

} // namespace

EMSCRIPTEN_BINDINGS(paint_api) {
    emscripten::function("paint", &paint);
    emscripten::function("clearPaint", &clearPaint);
    emscripten::function("paintOverlay", &paintOverlay);
}

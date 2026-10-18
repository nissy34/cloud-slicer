// The Measure tool, like desktop Orca's (GLGizmoMeasure): Orca's own
// Measure::Measuring finds the feature under the pointer (a point, an edge, a
// circle or a plane of the part's mesh), and Measure::get_measurement gives
// the distance and angle between two of them.
//
// The page sends a ray in plate coordinates; features come back in plate
// coordinates too, with an id the page passes back to measure between two.
#include "engine.hpp"

#include "libslic3r/Measure.hpp"

#include <map>
#include <memory>
#include <set>

using nlohmann::json;
using namespace Slic3r;
using Measure::SurfaceFeature;
using Measure::SurfaceFeatureType;

namespace {

std::string fail(const std::string& error) { return json{{"ok", false}, {"error", error}}.dump(); }

json vec(const Vec3d& v) { return json::array({v.x(), v.y(), v.z()}); }

// Orca's measuring data of each part mesh (its planes and their edges and
// circles), built on the first hover and kept while the mesh lives.
struct Cached {
    std::weak_ptr<const TriangleMesh> mesh;
    std::unique_ptr<Measure::Measuring> measuring;
};
std::map<size_t, Cached> g_measuring;

Measure::Measuring& measuringOf(const ModelVolume& v) {
    const auto& mesh = v.get_mesh_shared_ptr();
    Cached& c = g_measuring[v.id().id];
    if (!c.measuring || c.mesh.lock() != mesh) {
        c.measuring = std::make_unique<Measure::Measuring>(mesh->its);
        c.mesh = mesh;
    }
    return *c.measuring;
}

// Features handed to the page, by id, so it can measure between two of them.
std::map<int, SurfaceFeature> g_features;
int g_nextId = 1;

json featureJson(int id, int object, const SurfaceFeature& f, const Measure::Measuring& m, const Transform3d& trafo) {
    json out{{"id", id}, {"object", object}};
    switch (f.get_type()) {
    case SurfaceFeatureType::Point:
        out["type"] = "point";
        out["point"] = vec(f.get_point());
        break;
    case SurfaceFeatureType::Edge: {
        const auto [a, b] = f.get_edge();
        out["type"] = "edge";
        out["start"] = vec(a);
        out["end"] = vec(b);
        break;
    }
    case SurfaceFeatureType::Circle: {
        const auto [centre, radius, normal] = f.get_circle();
        out["type"] = "circle";
        out["centre"] = vec(centre);
        out["radius"] = radius;
        out["normal"] = vec(normal);
        break;
    }
    case SurfaceFeatureType::Plane: {
        const auto [idx, normal, origin] = f.get_plane();
        out["type"] = "plane";
        out["normal"] = vec(normal);
        out["origin"] = vec(origin);
        // The plane's triangles, to highlight it like desktop does.
        const indexed_triangle_set& its = m.get_its();
        std::vector<float> tris;
        for (int t : m.get_plane_triangle_indices(idx))
            for (int k = 0; k < 3; ++k) {
                const Vec3d w = trafo * its.vertices[its.indices[t][k]].cast<double>();
                tris.insert(tris.end(), {float(w.x()), float(w.y()), float(w.z())});
            }
        out["triangles"] = tris;
        break;
    }
    default: out["type"] = "none";
    }
    return out;
}

// The feature under a ray on `plate`. options:
//   ray:       [x, y, z, dx, dy, dz] in plate coordinates
//   onlyPlane: pick whole planes only (desktop's "Select plane" mode)
//   keep:      ids of features the page still uses; others are forgotten once
//              they are no longer among the latest few
// Returns {ok, feature: {id, object, type, ...} | null}. Points, edges and
// circles are in plate coordinates (mm); a plane has its normal, a point on it
// and its triangles (9 floats each).
std::string measureFeature(int plate, const std::string& optionsJson) {
    try {
        const json opt = json::parse(optionsJson);
        // The latest few stay too: a pick may be on its way while the page
        // asks about the next hover.
        std::set<int> keep;
        for (const json& id : opt.value("keep", json::array())) keep.insert(id.get<int>());
        for (auto it = g_features.begin(); it != g_features.end();)
            it = keep.count(it->first) || it->first > g_nextId - 64 ? std::next(it) : g_features.erase(it);

        const json& r = opt.at("ray");
        const Vec3d s(r[0].get<double>(), r[1].get<double>(), r[2].get<double>());
        const Vec3d dir = Vec3d(r[3].get<double>(), r[4].get<double>(), r[5].get<double>()).normalized();
        const std::optional<engine::RayHit> hit = engine::castRay(plate, s, dir);
        if (!hit) return json{{"ok", true}, {"feature", nullptr}}.dump();

        const Vec2d origin = engine::project().plateOrigin(plate);
        const Transform3d trafo = Geometry::translation_transform(Vec3d(-origin.x(), -origin.y(), 0)) * hit->trafo;
        Measure::Measuring& m = measuringOf(*hit->volume);
        std::optional<SurfaceFeature> f = m.get_feature(size_t(hit->facet), hit->point.cast<double>(), trafo, opt.value("onlyPlane", false));
        if (!f) return json{{"ok", true}, {"feature", nullptr}}.dump();
        if (f->get_type() == SurfaceFeatureType::Plane) {
            // Orca measures from an edge or circle to a plane through the
            // plane's own edges, in the same coordinates.
            const auto [idx, normal, at] = f->get_plane();
            f->world_plane_features = std::make_shared<std::vector<SurfaceFeature>>();
            for (const SurfaceFeature& pf : m.get_plane_features(unsigned(idx))) {
                SurfaceFeature w(pf);
                w.translate(trafo);
                f->world_plane_features->push_back(std::move(w));
            }
        }
        const int id = g_nextId++;
        g_features.emplace(id, *f);
        return json{{"ok", true}, {"feature", featureJson(id, hit->object, *f, m, trafo)}}.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

json distanceJson(const Measure::DistAndPoints& d) { return json{{"distance", d.dist}, {"from", vec(d.from)}, {"to", vec(d.to)}}; }

// Distance and angle between two features from measureFeature, like the
// figures desktop's Measure tool shows. Returns {ok, distance?, perpendicular?,
// angle?, xyz?}: distance is the shortest distance between them, perpendicular
// the distance between their infinite lines or planes, angle {degrees, centre,
// e1: [from, to], e2: [from, to], radius}, xyz the distance along each axis.
std::string measureBetween(int a, int b) {
    try {
        const auto fa = g_features.find(a), fb = g_features.find(b);
        if (fa == g_features.end() || fb == g_features.end()) throw std::runtime_error("unknown feature");
        const Measure::MeasurementResult r = Measure::get_measurement(fa->second, fb->second, true);
        json out{{"ok", true}};
        if (r.distance_strict) out["distance"] = distanceJson(*r.distance_strict);
        if (r.distance_infinite) out["perpendicular"] = distanceJson(*r.distance_infinite);
        if (r.distance_xyz) out["xyz"] = vec(r.distance_xyz->cwiseAbs());
        if (r.angle)
            out["angle"] = json{{"degrees", r.angle->angle * 180.0 / M_PI},
                                {"centre", vec(r.angle->center)},
                                {"e1", json::array({vec(r.angle->e1.first), vec(r.angle->e1.second)})},
                                {"e2", json::array({vec(r.angle->e2.first), vec(r.angle->e2.second)})},
                                {"radius", r.angle->radius}};
        return out.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(measure_api) {
    emscripten::function("measureFeature", &measureFeature);
    emscripten::function("measureBetween", &measureBetween);
}

// The Measure tool, like desktop Orca's (GLGizmoMeasure): Orca's own
// Measure::Measuring finds the feature under the pointer (a point, an edge, a
// circle or a plane of the part's mesh), and Measure::get_measurement gives
// the distance and angle between two of them.
//
// The page sends a ray in plate coordinates; features come back in plate
// coordinates too, with an id the page passes back to measure between two.
//
// Desktop's Assemble tool (GLGizmoAssembly) is the same tool picking two faces
// or two points: assembleAction moves the second one's part or object onto the
// first, like its Parallel, Center coincidence, Flip, Parallel distance and
// Rotate around center, or joins the two objects into one (the object list's
// Assemble), and the picked features follow the parts they are on.
#include "engine.hpp"

#include "libslic3r/Measure.hpp"

#include <algorithm>
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

// Features handed to the page, by id, so it can measure between two of them,
// with the part they are on and where it stood (plate coordinates).
struct Picked {
    SurfaceFeature feature;
    int object;
    ObjectID volume;
    int instance;
    Transform3d trafo;
};
std::map<int, Picked> g_features;
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
        const ModelObject* obj = engine::project().model.objects[hit->object];
        const int instance = int(std::find(obj->instances.begin(), obj->instances.end(), hit->inst) - obj->instances.begin());
        g_features.emplace(id, Picked{*f, hit->object, hit->volume->id(), instance, trafo});
        return json{{"ok", true}, {"feature", featureJson(id, hit->object, *f, m, trafo)}}.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

json distanceJson(const Measure::DistAndPoints& d) { return json{{"distance", d.dist}, {"from", vec(d.from)}, {"to", vec(d.to)}}; }

// Distance and angle between two features, like the figures desktop's
// Measure tool shows, and what Assemble can do with them: {distance?,
// perpendicular?, angle?, xyz?, assembly}. distance is the shortest distance
// between them, perpendicular the distance between their infinite lines or
// planes, angle {degrees, centre, e1: [from, to], e2: [from, to], radius}, xyz
// the distance along each axis; assembly {parallel, centre, aroundCentre,
// parallelDistance?, sameObject, samePart}.
json measurementJson(const Picked& a, const Picked& b) {
    const Measure::MeasurementResult r = Measure::get_measurement(a.feature, b.feature, true);
    json out = json::object();
    if (r.distance_strict) out["distance"] = distanceJson(*r.distance_strict);
    if (r.distance_infinite) out["perpendicular"] = distanceJson(*r.distance_infinite);
    if (r.distance_xyz) out["xyz"] = vec(r.distance_xyz->cwiseAbs());
    if (r.angle)
        out["angle"] = json{{"degrees", r.angle->angle * 180.0 / M_PI},
                            {"centre", vec(r.angle->center)},
                            {"e1", json::array({vec(r.angle->e1.first), vec(r.angle->e1.second)})},
                            {"e2", json::array({vec(r.angle->e2.first), vec(r.angle->e2.second)})},
                            {"radius", r.angle->radius}};
    const Measure::AssemblyAction act = Measure::get_assembly_action(a.feature, b.feature);
    json assembly{{"parallel", act.can_set_to_parallel},
                  {"centre", act.can_set_to_center_coincidence},
                  {"aroundCentre", act.can_around_center_of_faces},
                  {"sameObject", a.object == b.object},
                  {"samePart", a.volume == b.volume}};
    if (act.has_parallel_distance) assembly["parallelDistance"] = act.parallel_distance;
    out["assembly"] = assembly;
    return out;
}

const Picked& pickedAt(int id) {
    const auto it = g_features.find(id);
    if (it == g_features.end()) throw std::runtime_error("unknown feature");
    return it->second;
}

std::string measureBetween(int a, int b) {
    try {
        json out = measurementJson(pickedAt(a), pickedAt(b));
        out["ok"] = true;
        return out.dump();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

// Where a picked feature's part is now: its object (found by the part, as
// objects come and go), instance and the part's transformation onto the plate.
struct Where {
    int object;
    ModelObject* obj;
    ModelInstance* inst;
    ModelVolume* volume;
    Transform3d plate;  // bed -> plate coordinates
    Transform3d trafo;  // mesh -> plate coordinates
};

Where locate(const Picked& p) {
    engine::Project& pr = engine::project();
    for (size_t o = 0; o < pr.model.objects.size(); ++o)
        for (ModelVolume* v : pr.model.objects[o]->volumes)
            if (v->id() == p.volume) {
                ModelObject* obj = pr.model.objects[o];
                ModelInstance* inst = obj->instances[std::clamp<size_t>(p.instance, 0, obj->instances.size() - 1)];
                const Vec2d origin = pr.plateOrigin(std::max(pr.plateOf(*inst), 0));
                const Transform3d plate = Geometry::translation_transform(Vec3d(-origin.x(), -origin.y(), 0));
                return {int(o), obj, inst, v, plate, plate * inst->get_matrix() * v->get_matrix()};
            }
    throw std::runtime_error("the picked part is gone; pick again");
}

// The feature where its part stands now.
void follow(Picked& p) {
    const Where w = locate(p);
    const Transform3d moved = w.trafo * p.trafo.inverse();
    p.feature.translate(moved);
    if (p.feature.world_plane_features) {
        auto features = std::make_shared<std::vector<SurfaceFeature>>(*p.feature.world_plane_features);
        for (SurfaceFeature& f : *features) f.translate(moved);
        p.feature.world_plane_features = features;
    }
    p.object = w.object;
    p.trafo = w.trafo;
}

json pickedJson(int id, const Picked& p) {
    const Where w = locate(p);
    return featureJson(id, p.object, p.feature, measuringOf(*w.volume), w.trafo);
}

std::tuple<Vec3d, Vec3d> planeOf(const Picked& p) {
    if (p.feature.get_type() != SurfaceFeatureType::Plane) throw std::runtime_error("pick two faces first");
    const auto [idx, normal, origin] = p.feature.get_plane();
    return {normal, origin};
}

Vec3d pointOf(const Picked& p) {
    if (p.feature.get_type() == SurfaceFeatureType::Point) return p.feature.get_point();
    if (p.feature.get_type() == SurfaceFeatureType::Circle) return std::get<0>(p.feature.get_circle());
    throw std::runtime_error("pick two points or circle centres first");
}

Transform3d around(const Vec3d& at, const Transform3d& r) {
    return Geometry::translation_transform(at) * r * Geometry::translation_transform(-at);
}

// set_to_parallel: the second face turned to face the first (normals opposite), about its own middle.
Transform3d toParallel(const Picked& a, const Picked& b) {
    const auto [n1, p1] = planeOf(a);
    const auto [n2, p2] = planeOf(b);
    if (n1.dot(n2) <= -1 + 1e-3) return Transform3d::Identity();
    Vec3d axis;
    double angle;
    Matrix3d r;
    Geometry::rotation_from_two_vectors(n2, -n1, axis, angle, &r);
    return around(p2, Transform3d(r));
}

// Moves what the second feature is on by `t` (plate coordinates): its part
// when both are on one object, else its object (desktop's Selection::Volume /
// Selection::Instance). An object stays on the bed, as on desktop.
void moveSecond(const Picked& a, const Picked& b, const Transform3d& t) {
    const Where wa = locate(a), w = locate(b);
    if (w.volume == wa.volume) throw std::runtime_error("pick features on two different parts");
    const Transform3d inPlate = w.plate.inverse() * t * w.plate;
    if (wa.object == w.object) {
        const Transform3d m = w.inst->get_matrix();
        w.volume->set_transformation(Geometry::Transformation(m.inverse() * inPlate * m * w.volume->get_matrix()));
    } else {
        w.inst->set_transformation(Geometry::Transformation(inPlate * w.inst->get_matrix()));
    }
    w.obj->invalidate_bounding_box();
    w.obj->ensure_on_bed();
}

// ObjectList::merge(true), the object menu's Assemble: the two objects as the
// parts of one new object, each part where it stood.
int joinObjects(const Picked& a, const Picked& b) {
    engine::Project& pr = engine::project();
    const Where wa = locate(a), wb = locate(b);
    if (wa.object == wb.object) throw std::runtime_error("both are on one object already");
    ModelObject* joined = pr.model.add_object();
    joined->name = "Assembly";
    joined->add_instance();
    for (const Where* w : {&wa, &wb}) {
        const ModelObject* from = w->obj;
        for (const ModelVolume* v : from->volumes) {
            ModelVolume* nv = joined->add_volume(*v);  // keeps the part's id, so the picks follow it
            nv->set_transformation(Geometry::Transformation(w->inst->get_matrix() * v->get_matrix()));
            if (!nv->config.option("extruder"))
                if (const ConfigOption* e = from->config.option("extruder")) nv->config.set_key_value("extruder", new ConfigOptionInt(e->getInt()));
        }
        for (const std::string& key : from->config.keys())
            if (!joined->config.has(key)) joined->config.set_key_value(key, from->config.option(key)->clone());
        for (const auto& range : from->layer_config_ranges) joined->layer_config_ranges.emplace(range);
    }
    joined->sort_volumes(true);
    joined->ensure_on_bed();
    joined->center_around_origin();
    joined->translate_instances(-joined->origin_translation);
    joined->origin_translation = Vec3d::Zero();
    // The picked copies leave their objects; an object with no other copy goes.
    std::vector<int> gone;
    for (const Where* w : {&wa, &wb}) {
        if (w->obj->instances.size() == 1) gone.push_back(w->object);
        else w->obj->delete_instance(size_t(std::find(w->obj->instances.begin(), w->obj->instances.end(), w->inst) - w->obj->instances.begin()));
    }
    std::sort(gone.rbegin(), gone.rend());
    for (int o : gone) pr.model.delete_object(size_t(o));
    return int(pr.model.objects.size()) - 1;
}

// Desktop's Assemble on features a and b from measureFeature (two faces, or
// two points or circles). request:
//   {op: "parallel"}           the second face turned to face the first
//   {op: "centre"}             ...and moved onto it, middle on middle (Center coincidence)
//   {op: "flip"}               the second part turned over about its face (Flip by Face 2)
//   {op: "distance", value}    the second face moved to this distance from the first, along its normal
//   {op: "rotate", degrees}    the second part turned about its face's normal (Rotate around center)
//   {op: "move", by: [x,y,z]}  the second part moved (point and point assembly)
//   {op: "join"}               both objects made one, their parts kept where they are
// The second feature's part moves when both are on one object, else its object.
// Returns {ok, first, second, object?, ...measurementJson}: the two features where they are now.
std::string assembleAction(int a, int b, const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        Picked& pa = g_features.at(a);
        Picked& pb = g_features.at(b);
        follow(pa);
        follow(pb);
        json out{{"ok", true}};
        if (op == "parallel") {
            moveSecond(pa, pb, toParallel(pa, pb));
        } else if (op == "centre") {
            const Transform3d turn = toParallel(pa, pb);
            const Vec3d p1 = std::get<1>(planeOf(pa)), p2 = std::get<1>(planeOf(pb));
            moveSecond(pa, pb, Geometry::translation_transform(p1 - turn * p2) * turn);
        } else if (op == "flip") {
            // set_to_reverse_rotation: half a turn about a line in the face.
            const auto [n, p] = planeOf(pb);
            const Vec3d axis = (Measure::get_one_point_in_plane(p, n) - p).normalized();
            moveSecond(pa, pb, around(p, Transform3d(Eigen::AngleAxisd(PI, axis))));
        } else if (op == "distance") {
            const auto [n1, p1] = planeOf(pa);
            const Vec3d p2 = std::get<1>(planeOf(pb));
            Vec3d onPlane;
            Measure::get_point_projection_to_plane(p2, p1, n1, onPlane);
            moveSecond(pa, pb, Geometry::translation_transform(onPlane + n1 * req.at("value").get<double>() - p2));
        } else if (op == "rotate") {
            const auto [n, p] = planeOf(pb);
            moveSecond(pa, pb, around(p, Transform3d(Eigen::AngleAxisd(req.at("degrees").get<double>() * PI / 180, n))));
        } else if (op == "move") {
            const json& by = req.at("by");
            pointOf(pa);
            pointOf(pb);
            moveSecond(pa, pb, Geometry::translation_transform(Vec3d(by[0].get<double>(), by[1].get<double>(), by[2].get<double>())));
        } else if (op == "join") {
            out["object"] = joinObjects(pa, pb);
        } else {
            throw std::runtime_error("unknown assemble action " + op);
        }
        follow(pa);
        follow(pb);
        out.update(measurementJson(pa, pb));
        out["first"] = pickedJson(a, pa);
        out["second"] = pickedJson(b, pb);
        return out.dump();
    } catch (const std::out_of_range&) {
        return fail("unknown feature");
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(measure_api) {
    emscripten::function("measureFeature", &measureFeature);
    emscripten::function("measureBetween", &measureBetween);
    emscripten::function("assembleAction", &assembleAction);
}

// Brim ears, like desktop Orca's Brim Ears gizmo (GLGizmoBrimEars): round
// pads of brim on the bed under an object's corners, placed by hand or
// generated from the corners of its first layer. They are kept in
// ModelObject::brim_points (object coordinates, at the bed), saved with the
// project, and printed when the object's brim type is "Painted".
#include "engine.hpp"

#include "libslic3r/ClipperUtils.hpp"
#include "libslic3r/ExPolygon.hpp"
#include "libslic3r/TriangleMeshSlicer.hpp"

#include <set>

using nlohmann::json;
using namespace Slic3r;

namespace {

ModelObject* objectAt(int o) {
    auto& objs = engine::project().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

// The object's first layer on the bed (bed coordinates, scaled), sliced at
// 0.1 mm like the gizmo's first_layer_slicer: its parts minus negative volumes.
ExPolygons firstLayer(const ModelObject& obj, const ModelInstance& inst) {
    MeshSlicingParamsEx params;
    params.mode = MeshSlicingParams::SlicingMode::Regular;
    params.closing_radius = 0.1f;
    params.extra_offset = 0.05f;
    params.resolution = 0.01;
    ExPolygons parts, negative;
    for (const ModelVolume* v : obj.volumes) {
        if (!v->is_model_part() && !v->is_negative_volume()) continue;
        indexed_triangle_set its = v->mesh().its;
        if (its.indices.empty()) continue;
        MeshSlicingParamsEx p(params);
        p.trafo = inst.get_matrix() * v->get_matrix();
        if (p.trafo.matrix().block<3, 3>(0, 0).determinant() < 0.) its_flip_triangles(its);
        ExPolygons layer = slice_mesh_ex(its, {0.1f}, p).front();
        if (v->is_model_part())
            parts = union_ex(parts, layer);
        else
            negative = union_ex(negative, layer);
    }
    return diff_ex(parts, negative);
}

// The gizmo's generate_points: the outline simplified by the detection
// length, then its sharp corners (convex on the outline, concave in holes).
Points corners(Polygon poly, float detection, float maxAngle, bool outer) {
    const double threshold = (180 - maxAngle) * PI / 180.0;
    if (detection > 0) {
        Points pts = poly.points;
        pts.push_back(pts.front());
        pts = MultiPoint::_douglas_peucker(pts, detection / SCALING_FACTOR);
        if (pts.size() > 4) pts.pop_back();
        poly.points = pts;
    }
    return outer ? poly.convex_points(threshold) : poly.concave_points(threshold);
}

ExPolygon disc(const Vec3d& world, double radius) {
    ExPolygon d;
    const coord_t r = scale_(radius);
    for (int i = 0; i < 20; ++i) {
        const double a = 2.0 * PI * i / 20;
        d.contour.points.emplace_back(coord_t(r * cos(a)) + scale_(world.x()), coord_t(r * sin(a)) + scale_(world.y()));
    }
    return d;
}

// Which ears reach the first layer, directly or through other ears: the
// gizmo's find_single marks the rest red, since they print as loose pads.
std::vector<bool> attached(const ExPolygons& layer, const std::vector<Vec3d>& at, const BrimPoints& pts) {
    std::vector<bool> out(pts.size(), false);
    ExPolygons grown = layer;
    for (bool changed = true; changed;) {
        changed = false;
        for (size_t i = 0; i < pts.size(); ++i) {
            if (out[i]) continue;
            const ExPolygon d = disc(at[i], pts[i].head_front_radius);
            if (overlaps(grown, d)) {
                out[i] = changed = true;
                grown.push_back(d);
                grown = union_ex(grown);
            }
        }
    }
    return out;
}

// The effective brim type: the object's own setting, else the print's.
std::string brimType(const ModelObject& obj, const DynamicPrintConfig& config) {
    const ConfigOption* o = obj.config.option("brim_type");
    if (!o) o = config.option("brim_type");
    return o ? o->serialize() : "auto_brim";
}

// Edits object o's brim ears, seen from instance `inst` (the ears are object
// coordinates, so every instance gets them). configJson is the full print
// config; request:
//   {op: "get"}
//   {op: "auto", diameter, maxAngle, detection}  ears on the first layer's corners, added to those there
//   {op: "add", x, y, diameter}                  one ear at x, y (plate coordinates)
//   {op: "remove", indices: [...]}
//   {op: "resize", indices: [...], diameter}
//   {op: "clear"}
// Returns {ok, ears: [{x, y, diameter, attached}] in plate coordinates,
// brimType, defaultDiameter}.
std::string brimEars(int o, int i, const std::string& configJson, const std::string& requestJson) {
    try {
        engine::Project& p = engine::project();
        ModelObject* obj = objectAt(o);
        if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
        const ModelInstance& inst = *obj->instances[i];
        DynamicPrintConfig config;
        (void)engine::applyJsonConfig(config, json::parse(configJson));
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "get");

        // The gizmo's default: 16 first-layer lines across.
        double nozzle = 0.4;
        if (auto* n = config.option<ConfigOptionFloats>("nozzle_diameter"); n && !n->values.empty()) nozzle = n->values.front();
        double line = nozzle;
        if (config.has("initial_layer_line_width")) line = config.get_abs_value("initial_layer_line_width", nozzle);
        if (line <= 0) line = nozzle;
        const double defaultDiameter = line * 16;

        const int plate = std::max(p.plateOf(inst), 0);
        const Vec2d origin = p.plateOrigin(plate);
        const Transform3d trafo = inst.get_matrix();
        const Transform3d toObject = trafo.inverse();
        const ExPolygons layer = firstLayer(*obj, inst);
        BrimPoints& pts = obj->brim_points;
        const float radius = float(req.value("diameter", defaultDiameter) / 2);

        auto add = [&](double wx, double wy) {
            const BrimPoint b((toObject * Vec3d(wx, wy, -0.0001)).cast<float>(), radius);
            if (std::find(pts.begin(), pts.end(), b) == pts.end()) pts.push_back(b);
        };
        auto indices = [&] {
            std::set<size_t> s;
            for (const json& k : req.value("indices", json::array())) {
                const int v = k.get<int>();
                if (v >= 0 && size_t(v) < pts.size()) s.insert(size_t(v));
            }
            return s;
        };

        if (op == "auto") {
            const float detection = req.value("detection", 1.f), maxAngle = req.value("maxAngle", 125.f);
            for (const ExPolygon& ex : layer) {
                for (const Point& c : corners(ex.contour, detection, maxAngle, true)) add(unscale<double>(c.x()), unscale<double>(c.y()));
                for (Polygon hole : ex.holes) {
                    hole.reverse();
                    for (const Point& c : corners(hole, detection, maxAngle, false)) add(unscale<double>(c.x()), unscale<double>(c.y()));
                }
            }
        } else if (op == "add") {
            add(req.at("x").get<double>() + origin.x(), req.at("y").get<double>() + origin.y());
        } else if (op == "remove") {
            const std::set<size_t> drop = indices();
            BrimPoints kept;
            for (size_t k = 0; k < pts.size(); ++k)
                if (!drop.count(k)) kept.push_back(pts[k]);
            pts = kept;
        } else if (op == "resize") {
            for (size_t k : indices()) pts[k].head_front_radius = radius;
        } else if (op == "clear") {
            pts.clear();
        } else if (op != "get") {
            throw std::runtime_error("unknown brim ears op " + op);
        }

        std::vector<Vec3d> world;
        for (const BrimPoint& b : pts) world.push_back(trafo * b.pos.cast<double>());
        const std::vector<bool> ok = attached(layer, world, pts);
        json ears = json::array();
        for (size_t k = 0; k < pts.size(); ++k)
            ears.push_back({{"x", world[k].x() - origin.x()},
                            {"y", world[k].y() - origin.y()},
                            {"diameter", pts[k].head_front_radius * 2},
                            {"attached", bool(ok[k])}});
        return json{{"ok", true},
                    {"ears", ears},
                    {"brimType", brimType(*obj, config)},
                    {"defaultDiameter", defaultDiameter}}
            .dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(brim_api) {
    emscripten::function("brimEars", &brimEars);
}

// Text shapes, like desktop Orca's Text tool (GLGizmoEmboss): text in a
// TrueType font made into a part, negative part or modifier of an object, or
// a new object of its own, and edited later. The text and its font settings
// stay on the volume (ModelVolume::text_configuration and emboss_shape), so a
// 3MF keeps them for desktop and for this page. The placing and meshing of
// a shape is shared with SVG shapes (svg_api.cpp).
#include "engine.hpp"

#include "libslic3r/Emboss.hpp"
#include "libslic3r/TriangleMesh.hpp"

#include <boost/nowide/convert.hpp>

#include <algorithm>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

ModelVolumeType typeOf(const std::string& kind) {
    if (kind == "part") return ModelVolumeType::MODEL_PART;
    if (kind == "negative") return ModelVolumeType::NEGATIVE_VOLUME;
    if (kind == "modifier") return ModelVolumeType::PARAMETER_MODIFIER;
    throw std::runtime_error("text can be a part, negative part or modifier, not " + kind);
}

// The style the request asks for: font settings as desktop keeps them.
TextConfiguration configFrom(const json& req) {
    TextConfiguration tc;
    tc.text = req.value("text", "");
    EmbossStyle& style = tc.style;
    style.name = req.value("font", "");
    style.path = style.name;
    style.type = EmbossStyle::Type::file_path;
    FontProp& fp = style.prop;
    fp.size_in_mm = std::clamp(req.value("size", 10.f), 0.1f, 1000.f);
    if (req.contains("boldness") && req["boldness"].get<float>() != 0) fp.boldness = req["boldness"].get<float>();
    if (req.contains("skew") && req["skew"].get<float>() != 0) fp.skew = req["skew"].get<float>();
    if (req.contains("charGap") && req["charGap"].get<int>() != 0) fp.char_gap = req["charGap"].get<int>();
    if (req.contains("lineGap") && req["lineGap"].get<int>() != 0) fp.line_gap = req["lineGap"].get<int>();
    const std::string h = req.value("align", "center");
    fp.align.first = h == "left" ? FontProp::HorizontalAlign::left : h == "right" ? FontProp::HorizontalAlign::right : FontProp::HorizontalAlign::center;
    const std::string vert = req.value("valign", "center");
    fp.align.second = vert == "top" ? FontProp::VerticalAlign::top : vert == "bottom" ? FontProp::VerticalAlign::bottom : FontProp::VerticalAlign::center;
    fp.per_glyph = req.value("perGlyph", false);
    fp.face_name = style.name;
    return tc;
}

// TextDataBase::create_shape: the letters' outlines in the font, into shape
// (its depth and surface setting kept). Returns the font, which per glyph needs.
Emboss::FontFileWithCache textOutlines(const std::string& fontPath, const TextConfiguration& tc, EmbossShape& shape) {
    if (fontPath.empty()) throw std::runtime_error("this text's font isn't on this device; pick a font in the Text tool first");
    std::unique_ptr<Emboss::FontFile> file = Emboss::create_font_file(fontPath.c_str());
    if (!file) throw std::runtime_error("this font can't be read; pick another one (TrueType or OpenType)");
    Emboss::FontFileWithCache font(std::move(file));
    const FontProp& fp = tc.style.prop;
    shape.scale = Emboss::get_text_shape_scale(fp, *font.font_file);
    shape.shapes_with_ids = Emboss::text2vshapes(font, boost::nowide::widen(tc.text), fp);
    shape.final_shape = {};
    return font;
}

// The text's mesh where volume v stands (flat on a new volume).
TriangleMesh textMesh(const ModelVolume* v, const Emboss::FontFileWithCache& font, const TextConfiguration& tc, bool outside, EmbossShape& shape) {
    TriangleMesh mesh = v ? engine::shapeMesh(*v, shape, outside, &font, &tc) : engine::embossMesh(shape, shape.projection.depth, outside);
    if (mesh.empty()) throw std::runtime_error("the text has no letters this font can draw");
    return mesh;
}

std::string volumeName(std::string text) {
    std::replace(text.begin(), text.end(), '\n', ' ');
    return text;
}

// Object o (or -1 for a new object on `plate`), request:
//   {op: "add", type: part|negative|modifier, text, font, fontPath, size, depth,
//    boldness?, skew?, charGap?, lineGap?, align: left|center|right,
//    valign: top|center|bottom, useSurface?, perGlyph?,
//    camera?: [x, y, z]}   on object o: onto the surface the camera sees, else in front of it
//   {op: "update", volume, ...the same}   new text or style for a text volume, where it stands
// font is the font's name (kept with the text); fontPath the font file in the engine's files.
// useSurface: the text follows the object's surface (desktop's "Use surface");
// perGlyph: each letter is set on the surface on its own ("Per glyph").
// Returns {ok, object, volume, error?}.
std::string textVolume(int o, int plate, const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        const TextConfiguration tc = configFrom(req);
        if (tc.text.find_first_not_of(" \n\t") == std::string::npos) throw std::runtime_error("type some text first");
        const double depth = std::clamp(req.value("depth", 1.0), 0.01, 1e4);
        const std::string fontPath = req.value("fontPath", "");
        auto& objs = pr().model.objects;

        if (op == "update") {
            if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
            ModelObject* obj = objs[o];
            const int index = req.value("volume", -1);
            if (index < 0 || size_t(index) >= obj->volumes.size()) throw std::runtime_error("no part " + std::to_string(index));
            ModelVolume* v = obj->volumes[index];
            engine::unfixShape(*v);
            EmbossShape shape;
            shape.projection.depth = depth;
            const bool usedSurface = v->emboss_shape && v->emboss_shape->projection.use_surface;
            shape.projection.use_surface = req.value("useSurface", usedSurface);
            const Emboss::FontFileWithCache font = textOutlines(fontPath, tc, shape);
            // start_update_volume: newly following the surface, the text first moves onto it.
            const Geometry::Transformation was = v->get_transformation();
            if (shape.projection.use_surface && !usedSurface) engine::moveOntoSurface(*v);
            TriangleMesh mesh;
            try {
                mesh = textMesh(v, font, tc, v->is_model_part(), shape);
            } catch (...) {
                v->set_transformation(was);
                throw;
            }
            engine::updateEmbossVolume(obj, v, std::move(mesh), volumeName(tc.text));
            v->text_configuration = tc;
            v->emboss_shape = std::move(shape);
            return json{{"ok", true}, {"object", o}, {"volume", index}}.dump();
        }
        if (op != "add") throw std::runtime_error("unknown text action " + op);

        const ModelVolumeType type = typeOf(req.value("type", "part"));
        EmbossShape shape;
        shape.projection.depth = depth;
        const Emboss::FontFileWithCache font = textOutlines(fontPath, tc, shape);
        const bool onSurface = req.value("useSurface", false);
        TriangleMesh mesh = textMesh(nullptr, font, tc, type == ModelVolumeType::MODEL_PART, shape);

        if (o < 0) {
            // CreateObjectJob without a surface: the text alone, lying on the bed.
            if (type != ModelVolumeType::MODEL_PART) throw std::runtime_error("only a text part can be an object of its own");
            TextConfiguration alone = tc;
            alone.style.prop.per_glyph = false;
            const int object = engine::addEmbossObject(plate, std::move(mesh), volumeName(tc.text), std::move(shape), alone);
            return json{{"ok", true}, {"object", object}, {"volume", 0}}.dump();
        }

        const int volume = engine::addEmbossVolume(o, plate, req, std::move(mesh), type, volumeName(tc.text), std::move(shape), tc);
        if (onSurface || tc.style.prop.per_glyph) {
            // start_create_volume_on_surface_job: made again to follow the
            // surface it landed on; flat and plain when there is none.
            ModelObject* obj = objs[o];
            ModelVolume* v = obj->volumes[volume];
            v->emboss_shape->projection.use_surface = onSurface;
            try {
                engine::updateEmbossVolume(obj, v, textMesh(v, font, tc, v->is_model_part(), *v->emboss_shape), volumeName(tc.text));
            } catch (const std::exception&) {
                v->emboss_shape->projection.use_surface = false;
                v->text_configuration->style.prop.per_glyph = false;
            }
        }
        return json{{"ok", true}, {"object", o}, {"volume", volume}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

namespace engine {

namespace {

// Where a shape on object o goes when the request has the camera's position
// (plate coordinates): its transformation in the object, onto the surface a
// ray from the camera to the middle of the object meets first (desktop aims
// at the selected object from the view), or nothing when it misses.
std::optional<Transform3d> surfaceSeenFrom(ModelObject* obj, int o, int plate, const json& req) {
    if (!req.contains("camera") || obj->instances.empty()) return std::nullopt;
    const json& cam = req["camera"];
    const Vec3d s(cam[0].get<double>(), cam[1].get<double>(), cam[2].get<double>());
    const ModelInstance* inst = obj->instances.front();
    for (const ModelInstance* i : obj->instances)
        if (project().plateOf(*i) == plate) inst = i;
    const Vec2d origin = project().plateOrigin(plate);
    const BoundingBoxf3 box = obj->instance_bounding_box(*inst, false);
    const Vec3d centre = box.center() - Vec3d(origin.x(), origin.y(), 0);
    // The middle can be a hole (a Benchy's cabin windows), so then try points
    // around it, nearest first.
    std::optional<RayHit> hit;
    for (double r : {0., 0.2, 0.35}) {
        for (int k = 0; k < (r == 0 ? 1 : 8) && !hit; ++k) {
            const double a = k * PI / 4;
            const Vec3d at = centre + Vec3d(r * box.size().x() * std::cos(a), r * box.size().y() * std::sin(a), r * box.size().z() * std::sin(a));
            hit = castRay(plate, s, (at - s).normalized());
            if (hit && (hit->object != o || hit->facet < 0)) hit.reset();
        }
        if (hit) break;
    }
    if (!hit) return std::nullopt;
    const indexed_triangle_set& its = hit->volume->mesh().its;
    const stl_triangle_vertex_indices& f = its.indices[hit->facet];
    const Vec3d a = its.vertices[f[0]].cast<double>(), b = its.vertices[f[1]].cast<double>(), c = its.vertices[f[2]].cast<double>();
    const Vec3d normal = (hit->trafo.linear().inverse().transpose() * (b - a).cross(c - a)).normalized();
    const Vec3d position = hit->trafo * hit->point.cast<double>();
    constexpr double UP_LIMIT = 0.9;  // desktop's SurfaceDrag.hpp
    const Transform3d onto = Emboss::create_transformation_onto_surface(position, normal, UP_LIMIT);
    return hit->inst->get_matrix().inverse() * onto;
}

int indexOf(const ModelObject* obj, const ModelVolume* v) {
    const auto it = std::find(obj->volumes.begin(), obj->volumes.end(), v);
    return it == obj->volumes.end() ? -1 : int(it - obj->volumes.begin());
}

} // namespace

TriangleMesh embossMesh(EmbossShape& shape, double depth, bool outside) {
    // try_create_mesh: healed outlines, projected along z (SHAPE_SCALE is applied in ProjectZ).
    shape.projection.depth = depth;
    const ExPolygons shapes = union_with_delta(shape, Emboss::UNION_DELTA, Emboss::UNION_MAX_ITERATIN);
    if (shapes.empty()) return {};
    Emboss::ProjectTransform project(std::make_unique<Emboss::ProjectZ>(depth / shape.scale),
                                     Eigen::Translation<double, 3>(0., 0., outside ? -embossSurfaceOffset : embossSurfaceOffset - depth) *
                                         Eigen::Scaling(shape.scale));
    return TriangleMesh(Emboss::polygons2model(shapes, project));
}

int addEmbossObject(int plate, TriangleMesh&& mesh, const std::string& name, EmbossShape&& shape, const std::optional<TextConfiguration>& text) {
    Project& p = project();
    ModelObject* obj = p.model.add_object();
    obj->name = name;
    ModelVolume* v = obj->add_volume(std::move(mesh));
    v->name = name;
    v->source.is_from_builtin_objects = true;
    v->text_configuration = text;
    v->emboss_shape = std::move(shape);
    obj->add_instance();
    obj->invalidate_bounding_box();
    placeObject(obj, std::clamp(plate, 0, p.plateCount - 1));
    return int(p.model.objects.size()) - 1;
}

int addEmbossVolume(int o, int plate, const json& req, TriangleMesh&& mesh, ModelVolumeType type, const std::string& name, EmbossShape&& shape,
                    const std::optional<TextConfiguration>& text) {
    auto& objs = project().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    ModelObject* obj = objs[o];
    ModelVolume* v = obj->add_volume(make_cube(1., 1., 1.), type);
    v->set_mesh(std::move(mesh));  // after add_volume, so the shape keeps its own origin
    v->calculate_convex_hull();
    v->config.set_key_value("extruder", new ConfigOptionInt(0));
    v->source.is_from_builtin_objects = true;
    v->name = name;
    if (const std::optional<Transform3d> onSurface = surfaceSeenFrom(obj, o, plate, req)) {
        // start_create_volume_on_surface_job: on the object's surface facing
        // the camera, standing out of it, kept upright.
        v->set_transformation(*onSurface);
    } else {
        // create_volume without a position: flat, in front of the object, on the bed.
        const ModelInstance* inst = obj->instances.front();
        const BoundingBoxf3 instanceBox = obj->instance_bounding_box(*inst, false);
        const BoundingBoxf3 box = v->mesh().bounding_box();
        const Vec3d at(instanceBox.center().x(), instanceBox.min.y() - box.size().y() / 2, instanceBox.min.z() - box.min.z());
        v->set_transformation(inst->get_matrix().inverse() * Eigen::Translation3d(at));
    }
    v->text_configuration = text;
    v->emboss_shape = std::move(shape);
    obj->sort_volumes(true);
    obj->invalidate_bounding_box();
    if (v->is_model_part()) obj->ensure_on_bed();
    return indexOf(obj, v);
}

void remakeShape(ModelObject* obj, ModelVolume* v, const std::string& fontPath) {
    if (!v->emboss_shape) return;
    EmbossShape& shape = *v->emboss_shape;
    if (v->text_configuration) {
        const Emboss::FontFileWithCache font = textOutlines(fontPath, *v->text_configuration, shape);
        updateEmbossVolume(obj, v, textMesh(v, font, *v->text_configuration, v->is_model_part(), shape), v->name);
        return;
    }
    if (shape.shapes_with_ids.empty()) svgOutlines(*v);
    TriangleMesh mesh = shapeMesh(*v, shape, v->is_model_part(), nullptr, nullptr);
    if (mesh.empty()) throw std::runtime_error("the shape has no paths to make it from");
    updateEmbossVolume(obj, v, std::move(mesh), v->name);
}

void updateEmbossVolume(ModelObject* obj, ModelVolume* v, TriangleMesh&& mesh, const std::string& name) {
    v->set_mesh(std::move(mesh));
    v->set_new_unique_id();
    v->calculate_convex_hull();
    v->name = name;
    // update_name_in_list: a shape that is the whole object names it too.
    if (obj->volumes.size() == 1) obj->name = name;
    obj->invalidate_bounding_box();
    if (v->is_model_part()) obj->ensure_on_bed();
}

} // namespace engine

EMSCRIPTEN_BINDINGS(text_api) {
    emscripten::function("textVolume", &textVolume);
}

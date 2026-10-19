// SVG shapes, like desktop Orca's SVG tool (GLGizmoSVG): the paths of an .svg
// file made into a part, negative part or modifier of an object, or a new
// object of its own, then given another depth or size. The file stays on the
// volume (emboss_shape.svg_file) and goes into a 3MF, as desktop stores it.
#include "engine.hpp"

#include "libslic3r/Emboss.hpp"
#include "libslic3r/NSVGUtils.hpp"
#include "libslic3r/TriangleMesh.hpp"

#include <boost/filesystem/path.hpp>

#include <algorithm>
#include <set>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

ModelVolumeType typeOf(const std::string& kind) {
    if (kind == "part") return ModelVolumeType::MODEL_PART;
    if (kind == "negative") return ModelVolumeType::NEGATIVE_VOLUME;
    if (kind == "modifier") return ModelVolumeType::PARAMETER_MODIFIER;
    throw std::runtime_error("an SVG shape can be a part, negative part or modifier, not " + kind);
}

// get_tesselation_tolerance: curves split into lines about 0.1 mm long at
// the size the shape is drawn.
double tolerance(double scale) {
    const double mm = .1;
    return mm * mm / SCALING_FACTOR / SCALING_FACTOR / scale / scale;
}

// select_shape: the file's filled and stroked paths, centred.
void readShape(EmbossShape::SvgFile& svg, EmbossShape& shape, double scale) {
    if (svg.image == nullptr && init_image(svg) == nullptr) throw std::runtime_error("this file can't be read as an SVG");
    shape.shapes_with_ids = create_shape_with_ids(*svg.image, NSVGLineParams{tolerance(scale)});
    if (shape.shapes_with_ids.empty()) throw std::runtime_error("the SVG has no paths to make a shape from");
}

// get_file_name / volume_name: the file's name without folder or extension.
std::string nameOf(const std::string& path) {
    const std::string stem = boost::filesystem::path(path).stem().string();
    return stem.empty() ? "SVG shape" : stem;
}

// Plater's create_unique_3mf_filepath: where the file goes in a 3MF.
std::string pathIn3mf(const std::string& name) {
    std::set<std::string> taken;
    for (const ModelObject* obj : pr().model.objects)
        for (const ModelVolume* v : obj->volumes)
            if (v->emboss_shape && v->emboss_shape->svg_file) taken.insert(v->emboss_shape->svg_file->path_in_3mf);
    std::string path = "3D/" + name + ".svg";
    for (int n = 2; taken.count(path); ++n) path = "3D/" + name + "_" + std::to_string(n) + ".svg";
    return path;
}

// The shape's size across its face, as the size boxes show it.
json sizeOf(const ModelVolume* v) {
    const Vec3d size = v->mesh().bounding_box().size().cwiseProduct(v->get_scaling_factor());
    return {{"width", size.x()}, {"height", size.y()}};
}

// Object o (or -1 for a new object on `plate`), request:
//   {op: "add", type: part|negative|modifier, path, name, depth, camera?: [x, y, z]}
//       path is the .svg in the engine's files, name the file's name
//   {op: "update", volume, depth?, useSurface?, width?, height?}
//       a new depth remakes the shape; width and height (mm) scale it across,
//       like the size boxes of desktop's SVG tool; useSurface: it follows the
//       object's surface (desktop's "Use surface")
// Returns {ok, object, volume, width, height, error?}.
std::string svgVolume(int o, int plate, const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        auto& objs = pr().model.objects;

        if (op == "update") {
            if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
            ModelObject* obj = objs[o];
            const int index = req.value("volume", -1);
            if (index < 0 || size_t(index) >= obj->volumes.size()) throw std::runtime_error("no part " + std::to_string(index));
            ModelVolume* v = obj->volumes[index];
            if (!v->emboss_shape || !v->emboss_shape->svg_file) throw std::runtime_error("that part isn't an SVG shape");
            EmbossShape& shape = *v->emboss_shape;
            engine::unfixShape(*v);
            const bool usedSurface = shape.projection.use_surface;
            if (req.contains("depth") || req.contains("useSurface")) {
                if (req.contains("depth")) shape.projection.depth = std::clamp(req["depth"].get<double>(), 0.01, 1e4);
                shape.projection.use_surface = req.value("useSurface", usedSurface);
                // Shapes loaded from a 3MF come back as the file only.
                if (shape.shapes_with_ids.empty()) engine::svgOutlines(*v);
                // start_update_volume: newly following the surface, the shape first moves onto it.
                const Geometry::Transformation was = v->get_transformation();
                if (shape.projection.use_surface && !usedSurface) engine::moveOntoSurface(*v);
                TriangleMesh mesh;
                try {
                    mesh = engine::shapeMesh(*v, shape, v->is_model_part(), nullptr, nullptr);
                } catch (...) {
                    v->set_transformation(was);
                    shape.projection.use_surface = usedSurface;
                    throw;
                }
                if (mesh.empty()) throw std::runtime_error("the SVG has no paths to make a shape from");
                engine::updateEmbossVolume(obj, v, std::move(mesh), v->name);
            }
            if (req.contains("width") || req.contains("height")) {
                // draw_size: the volume scaled across its face, its depth kept.
                const BoundingBoxf3 box = v->mesh().bounding_box();
                Vec3d scale = v->get_scaling_factor();
                if (req.contains("width") && box.size().x() > 0) scale.x() = std::clamp(req["width"].get<double>(), 0.1, 1e4) / box.size().x();
                if (req.contains("height") && box.size().y() > 0) scale.y() = std::clamp(req["height"].get<double>(), 0.1, 1e4) / box.size().y();
                v->set_scaling_factor(scale);
                obj->invalidate_bounding_box();
                if (v->is_model_part()) obj->ensure_on_bed();
            }
            // A shape that follows the surface is cut again at its new size.
            if ((req.contains("width") || req.contains("height")) && shape.projection.use_surface) engine::remakeShape(obj, v, "");
            json out{{"ok", true}, {"object", o}, {"volume", index}};
            out.update(sizeOf(v));
            return out.dump();
        }
        if (op != "add") throw std::runtime_error("unknown SVG action " + op);

        const ModelVolumeType type = typeOf(req.value("type", "part"));
        const std::string name = nameOf(req.value("name", ""));
        EmbossShape shape;
        shape.projection.use_surface = false;
        EmbossShape::SvgFile svg;
        svg.path = req.value("name", "");
        svg.file_data = read_from_disk(req.value("path", ""));
        if (!svg.file_data) throw std::runtime_error("the SVG file is missing");
        readShape(svg, shape, 1.);
        svg.path_in_3mf = pathIn3mf(name);
        shape.svg_file = std::move(svg);
        const double depth = std::clamp(req.value("depth", 2.0), 0.01, 1e4);
        TriangleMesh mesh = engine::embossMesh(shape, depth, type == ModelVolumeType::MODEL_PART);
        if (mesh.empty()) throw std::runtime_error("the SVG has no paths to make a shape from");

        int object = o, volume = 0;
        if (o < 0) {
            if (type != ModelVolumeType::MODEL_PART) throw std::runtime_error("only an SVG part can be an object of its own");
            object = engine::addEmbossObject(plate, std::move(mesh), name, std::move(shape), std::nullopt);
        } else {
            volume = engine::addEmbossVolume(o, plate, req, std::move(mesh), type, name, std::move(shape), std::nullopt);
        }
        json out{{"ok", true}, {"object", object}, {"volume", volume}};
        out.update(sizeOf(objs[object]->volumes[volume]));
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

namespace engine {

void svgOutlines(ModelVolume& v) {
    if (!v.emboss_shape || !v.emboss_shape->svg_file) throw std::runtime_error("that part isn't an SVG shape");
    readShape(*v.emboss_shape->svg_file, *v.emboss_shape, v.get_scaling_factor().x());
}

} // namespace engine

EMSCRIPTEN_BINDINGS(svg_api) {
    emscripten::function("svgVolume", &svgVolume);
}

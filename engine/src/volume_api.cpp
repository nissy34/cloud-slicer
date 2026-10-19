// Parts, negative parts, modifiers and support enforcers/blockers of an object,
// like desktop Orca's object menu "Add part / Negative part / Add modifier /
// Support blocker / Support enforcer" (ObjectList::load_generic_subobject and
// load_modifier), and what its object list does to one of them: rename,
// delete, change type, move, rotate and scale.
#include "engine.hpp"

#include "libslic3r/TriangleMesh.hpp"

#include <algorithm>
#include <cmath>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

ModelObject* objectAt(int o) {
    auto& objs = pr().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

ModelVolume* volumeAt(ModelObject* obj, int v) {
    if (v < 0 || size_t(v) >= obj->volumes.size()) throw std::runtime_error("no part " + std::to_string(v));
    return obj->volumes[v];
}

ModelVolumeType typeOf(const std::string& kind) {
    if (kind == "part") return ModelVolumeType::MODEL_PART;
    if (kind == "negative") return ModelVolumeType::NEGATIVE_VOLUME;
    if (kind == "modifier") return ModelVolumeType::PARAMETER_MODIFIER;
    if (kind == "supportEnforcer") return ModelVolumeType::SUPPORT_ENFORCER;
    if (kind == "supportBlocker") return ModelVolumeType::SUPPORT_BLOCKER;
    throw std::runtime_error("unknown part type " + kind);
}

// ObjectList's create_mesh: shapes sized by the bed (a tenth of its larger side).
TriangleMesh shapeMesh(const std::string& shape) {
    const double side = 0.1 * std::max(pr().plateWidth, pr().plateDepth);
    if (shape == "Cube") return TriangleMesh(its_make_cube(side, side, side));
    if (shape == "Cylinder") return TriangleMesh(its_make_cylinder(0.5 * side, side));
    if (shape == "Sphere") return TriangleMesh(its_make_sphere(0.5 * side, PI / 90));
    if (shape == "Cone") return TriangleMesh(its_make_cone(0.5 * side, side));
    if (shape == "Disc") return TriangleMesh(its_make_cylinder(0.5 * side, 0.2f));
    if (shape == "Torus") return TriangleMesh(its_make_torus(0.5 * side, 0.125 * side, PI / 60));
    throw std::runtime_error("unknown shape " + shape);
}

int indexOf(const ModelObject* obj, const ModelVolume* v) {
    const auto it = std::find(obj->volumes.begin(), obj->volumes.end(), v);
    return it == obj->volumes.end() ? -1 : int(it - obj->volumes.begin());
}

size_t partCount(const ModelObject* obj) {
    return size_t(std::count_if(obj->volumes.begin(), obj->volumes.end(), [](const ModelVolume* v) { return v->is_model_part(); }));
}

// Desktop's last steps after adding one: the filament, the volume order
// (parts first) and the object back on the bed.
int finishAdded(ModelObject* obj, ModelVolume* v) {
    int extruder = 0;
    if (v->is_model_part() && obj->config.has("extruder")) extruder = obj->config.opt_int("extruder");
    v->config.set_key_value("extruder", new ConfigOptionInt(extruder));
    obj->sort_volumes(true);
    obj->invalidate_bounding_box();
    if (v->is_model_part()) obj->ensure_on_bed();
    return indexOf(obj, v);
}

// load_generic_subobject: the shape lies square to the bed whatever the
// object's rotation, at the right front corner of instance i, on the bed.
ModelVolume* addShape(ModelObject* obj, int i, ModelVolumeType type, const std::string& shape) {
    if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
    const ModelInstance* inst = obj->instances[i];
    const BoundingBoxf3 instanceBox = obj->instance_bounding_box(i);
    ModelVolume* v = obj->add_volume(shapeMesh(shape), type);
    const Transform3d inverse = inst->get_transformation().get_matrix_no_offset().inverse();
    v->set_transformation(Geometry::Transformation(inverse));
    const BoundingBoxf3 meshBox = v->mesh().bounding_box();
    const Vec3d offset = Vec3d(instanceBox.max.x(), instanceBox.min.y(), instanceBox.min.z()) + 0.5 * meshBox.size() - inst->get_offset();
    v->set_offset(inverse * offset);
    v->name = "Generic-" + shape;
    v->source.is_from_builtin_objects = true;
    return v;
}

// load_modifier for a file: all of its meshes as one, placed relative to the
// object's first part as the files were exported.
ModelVolume* addFile(ModelObject* obj, ModelVolumeType type, const std::string& path, const std::string& name) {
    Model model = Model::read_from_file(path, nullptr, nullptr, LoadStrategy::LoadModel);
    if (model.objects.empty()) throw std::runtime_error("the file has no model");
    for (ModelObject* other : model.objects)
        if (obj->origin_translation != Vec3d::Zero()) {
            other->center_around_origin();
            const Vec3d delta = obj->origin_translation - other->origin_translation;
            for (ModelVolume* v : other->volumes) v->translate(delta);
        }
    model.add_default_instances();
    TriangleMesh mesh = model.mesh();
    if (mesh.empty()) throw std::runtime_error("the file has no triangles");
    ModelVolume* v = obj->add_volume(std::move(mesh), type);
    v->name = name.empty() ? "Part" : name;
    v->source.input_file = name;
    if (model.objects.size() == 1 && model.objects.front()->volumes.size() == 1)
        v->source.mesh_offset = model.objects.front()->volumes.front()->source.mesh_offset;
    // Where the file put it relative to the object's first part, carried
    // through that part's own placement (desktop assumes it sits at the origin).
    const ModelVolume* first = obj->volumes.front();
    const Vec3d at = first->get_matrix() * (v->source.mesh_offset - first->source.mesh_offset);
    v->set_transformation(first->get_transformation());
    v->set_offset(at);
    return v;
}

// Object o, request:
//   {op: "add", type, shape: Cube|Cylinder|Sphere|Cone|Disc|Torus, instance}
//   {op: "add", type, path, name}            a mesh file (STL, OBJ, 3MF...) as the new one
//   {op: "rename", volume, name}
//   {op: "delete", volume}                   not the object's last part
//   {op: "type", volume, type}               part, negative, modifier, supportEnforcer or supportBlocker
//   {op: "transform", volume, instance, matrix}   matrix: 16 numbers, column major: what to do to
//                                            the volume in its plate's coordinates (as seen on instance i)
// type is part, negative, modifier, supportEnforcer or supportBlocker.
// Returns {ok, volume?: index of the new or changed volume, error?}.
std::string volumeAction(int o, const std::string& requestJson) {
    try {
        ModelObject* obj = objectAt(o);
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        json out{{"ok", true}};

        if (op == "add") {
            const ModelVolumeType type = typeOf(req.value("type", "part"));
            ModelVolume* v = req.contains("path") ? addFile(obj, type, req.at("path").get<std::string>(), req.value("name", ""))
                                                  : addShape(obj, req.value("instance", 0), type, req.value("shape", "Cube"));
            out["volume"] = finishAdded(obj, v);
        } else if (op == "rename") {
            ModelVolume* v = volumeAt(obj, req.value("volume", -1));
            const std::string name = req.value("name", "");
            if (name.empty()) throw std::runtime_error("the name is empty");
            v->name = name;
            out["volume"] = req.value("volume", -1);
        } else if (op == "delete") {
            const int index = req.value("volume", -1);
            ModelVolume* v = volumeAt(obj, index);
            if (v->is_model_part() && partCount(obj) == 1) throw std::runtime_error("an object keeps at least one part");
            obj->delete_volume(size_t(index));
            obj->invalidate_bounding_box();
            obj->ensure_on_bed();
        } else if (op == "type") {
            ModelVolume* v = volumeAt(obj, req.value("volume", -1));
            const ModelVolumeType type = typeOf(req.value("type", ""));
            if (v->is_model_part() && type != ModelVolumeType::MODEL_PART && partCount(obj) == 1)
                throw std::runtime_error("an object keeps at least one part");
            v->set_type(type);
            // A part takes the object's filament; the others have none (desktop's change_part_type).
            if (type == ModelVolumeType::MODEL_PART && !v->config.has("extruder")) v->config.set_key_value("extruder", new ConfigOptionInt(0));
            obj->sort_volumes(true);
            obj->invalidate_bounding_box();
            obj->ensure_on_bed();
            out["volume"] = indexOf(obj, v);
        } else if (op == "transform") {
            ModelVolume* v = volumeAt(obj, req.value("volume", -1));
            const int i = req.value("instance", 0);
            if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
            const json& m = req.at("matrix");
            if (!m.is_array() || m.size() != 16) throw std::runtime_error("matrix needs 16 numbers");
            Transform3d world = Transform3d::Identity();
            for (int c = 0; c < 4; ++c)
                for (int r = 0; r < 4; ++r) world.matrix()(r, c) = m[c * 4 + r].get<double>();
            // The page works in plate coordinates (the preview's); the model in the bed's.
            const Vec2d origin = pr().plateOrigin(std::max(pr().plateOf(*obj->instances[i]), 0));
            const Transform3d toBed(Eigen::Translation3d(origin.x(), origin.y(), 0));
            world = toBed * world * toBed.inverse();
            const Transform3d inst = obj->instances[i]->get_matrix();
            v->set_transformation(Geometry::Transformation(inst.inverse() * world * inst * v->get_matrix()));
            obj->invalidate_bounding_box();
            obj->ensure_on_bed();
            out["volume"] = req.value("volume", -1);
        } else {
            throw std::runtime_error("unknown part action " + op);
        }
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(volume_api) {
    emscripten::function("volumeAction", &volumeAction);
}

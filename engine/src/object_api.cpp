// The object menu, like desktop Orca's right-click menu on an object
// (MenuFactory::create_extra_object_menu): clone, center, rename, printable,
// scale to fit the build volume, unit conversion, replace with STL and
// export as STL. The other items (split, mirror, delete, orient, simplify...)
// call the tools that already exist.
#include "engine.hpp"

#include "libslic3r/Format/STL.hpp"

#include <algorithm>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

ModelObject* objectAt(int o) {
    auto& objs = pr().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

ModelInstance* instanceAt(ModelObject* obj, int i) {
    if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
    return obj->instances[i];
}

// Moves the instance so its bounding box is centred on its plate (desktop's
// Selection::center), keeping its height.
void centre(ModelObject* obj, ModelInstance* inst) {
    const int plate = std::max(pr().plateOf(*inst), 0);
    const Vec2d middle = pr().plateOrigin(plate) + Vec2d(pr().plateWidth, pr().plateDepth) / 2;
    const Vec3d c = obj->instance_bounding_box(*inst, false).center();
    inst->set_offset(inst->get_offset() + Vec3d(middle.x() - c.x(), middle.y() - c.y(), 0));
}

// Desktop's unit conversions (ModelObject::convert_units): the factor, and
// whether the parts then count as converted from inches / meters.
struct Conversion { float factor; int inch, meter; };  // -1 leave, 0 clear, 1 set
Conversion conversion(const std::string& to) {
    if (to == "fromInch") return {25.4f, 1, -1};
    if (to == "toInch") return {0.0393700787f, 0, -1};
    if (to == "fromMeter") return {1000.f, -1, 1};
    if (to == "toMeter") return {0.001f, -1, 0};
    throw std::runtime_error("unknown conversion " + to);
}

// The instance's model parts as one mesh, placed as on the bed (desktop's
// export_stl_obj for one selected instance; negative parts are not cut out).
TriangleMesh instanceMesh(const ModelObject& obj, const ModelInstance& inst) {
    TriangleMesh mesh;
    for (const ModelVolume* v : obj.volumes)
        if (v->is_model_part()) {
            TriangleMesh m(v->mesh());
            m.transform(inst.get_matrix() * v->get_matrix(), true);
            mesh.merge(m);
        }
    return mesh;
}

// Object o (instance i where it matters), request:
//   {op: "rename", name}
//   {op: "printable", value}                   instance i prints or not
//   {op: "center"}                             instance i to the middle of its plate
//   {op: "scaleToFit", height}                 instance i as large as the plate (and height) allows, centred
//   {op: "clone", count}                       count new objects like it, beside it (the page arranges after)
//   {op: "convert", to: fromInch|toInch|fromMeter|toMeter}   every part scaled by 25.4, 1/25.4, 1000 or 1/1000
//   {op: "replace", volume, path}              the part's mesh from an STL file, keeping its place
//   {op: "exportStl", path}                    instance i's parts written to path as binary STL
// Returns {ok, error?}.
std::string objectAction(int o, int i, const std::string& requestJson) {
    try {
        engine::Project& p = pr();
        ModelObject* obj = objectAt(o);
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        json out{{"ok", true}};

        if (op == "rename") {
            const std::string name = req.value("name", "");
            if (name.empty()) throw std::runtime_error("the name is empty");
            obj->name = name;
            // A single part carries the object's name, as on desktop.
            if (obj->volumes.size() == 1) obj->volumes.front()->name = name;
        } else if (op == "printable") {
            instanceAt(obj, i)->printable = req.value("value", true);
        } else if (op == "center") {
            centre(obj, instanceAt(obj, i));
        } else if (op == "scaleToFit") {
            // Selection::scale_to_fit_print_volume: a uniform scale with a hair
            // of room on every side, then centred on the plate.
            ModelInstance* inst = instanceAt(obj, i);
            const Vec3d size = obj->instance_bounding_box(*inst, false).size() + 0.02 * Vec3d::Ones();
            const double height = req.value("height", 0.0) > 0 ? req.value("height", 0.0) : 1e9;
            const double s = std::min({p.plateWidth / size.x(), p.plateDepth / size.y(), height / size.z()});
            if (!(s > 0) || !std::isfinite(s)) throw std::runtime_error("the object has no size");
            inst->set_scaling_factor(inst->get_scaling_factor() * s);
            obj->invalidate_bounding_box();
            obj->ensure_on_bed();
            centre(obj, inst);
        } else if (op == "clone") {
            // CloneDialog: copies of the object, as new objects.
            const int count = std::clamp(req.value("count", 1), 1, 1000);
            const double step = obj->instance_bounding_box(0, false).size().x() + 5;
            for (int k = 0; k < count; ++k) {
                ModelObject* copy = p.model.add_object(*obj);
                for (ModelInstance* inst : copy->instances) inst->set_offset(inst->get_offset() + Vec3d(step * (k + 1), 0, 0));
            }
            out["objects"] = count;
        } else if (op == "convert") {
            // ModelObject::convert_units, done in place so the object keeps
            // its spot in the list and its instances.
            const Conversion c = conversion(req.value("to", ""));
            for (ModelVolume* v : obj->volumes) {
                if (v->mesh().empty()) continue;
                const Vec3d offset = v->get_offset();
                v->scale_geometry_after_creation(c.factor);
                v->set_offset(double(c.factor) * offset);
                if (c.inch >= 0) v->source.is_converted_from_inches = c.inch == 1;
                if (c.meter >= 0) v->source.is_converted_from_meters = c.meter == 1;
            }
            obj->invalidate_bounding_box();
            obj->ensure_on_bed();
        } else if (op == "replace") {
            // Plater::priv::replace_volume_with_stl.
            const int v = req.value("volume", -1);
            if (v < 0 || size_t(v) >= obj->volumes.size()) throw std::runtime_error("no part " + std::to_string(v));
            Model loaded = Model::read_from_file(req.at("path").get<std::string>(), nullptr, nullptr,
                                                 LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel);
            if (loaded.objects.empty()) throw std::runtime_error("the file has no model");
            if (loaded.objects.size() > 1 || loaded.objects.front()->volumes.size() > 1)
                throw std::runtime_error("the file has more than one part, so it can't replace one");
            ModelObject* src = loaded.objects.front();
            src->center_around_origin();
            src->ensure_on_bed();
            ModelVolume* old = obj->volumes[v];
            ModelVolume* fresh = obj->add_volume(*src->volumes.front());
            fresh->set_new_unique_id();
            fresh->config.apply(old->config);
            fresh->set_type(old->type());
            fresh->set_material_id(old->material_id());
            fresh->set_transformation(old->get_transformation());
            fresh->translate(fresh->get_transformation().get_matrix_no_offset() * (fresh->source.mesh_offset - old->source.mesh_offset));
            if (old->source.is_converted_from_inches) fresh->convert_from_imperial_units();
            else if (old->source.is_converted_from_meters) fresh->convert_from_meters();
            // Desktop copies the old paint over, but it belongs to the old
            // triangles; the new mesh starts unpainted instead.
            std::swap(obj->volumes[v], obj->volumes.back());
            obj->delete_volume(obj->volumes.size() - 1);
            obj->invalidate_bounding_box();
            obj->ensure_on_bed();
            obj->sort_volumes(true);
            if (obj->volumes.size() == 1) obj->name = obj->volumes.front()->name;
        } else if (op == "exportStl") {
            TriangleMesh mesh = instanceMesh(*obj, *instanceAt(obj, i));
            if (mesh.empty()) throw std::runtime_error("the object has no parts");
            if (!store_stl(req.at("path").get<std::string>().c_str(), &mesh, true)) throw std::runtime_error("could not write the STL");
        } else {
            throw std::runtime_error("unknown object action " + op);
        }
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(object_api) {
    emscripten::function("objectAction", &objectAction);
}

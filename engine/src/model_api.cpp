// The open project: model loading (Orca's own STL/OBJ/AMF/STEP and Orca/Bambu
// 3MF readers), plates, object edits and the Prepare preview mesh.
//
// Coordinates the page sees are plate-local millimetres: (0, 0) is the front
// left corner of the plate, like the desktop Prepare view of one plate.
#include "engine.hpp"

#include "libslic3r/BoundingBox.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/TriangleSelector.hpp"

#include <boost/algorithm/string/predicate.hpp>

#include <algorithm>
#include <cmath>

using nlohmann::json;
using namespace Slic3r;

namespace engine {

namespace {
Project g_project;
constexpr double PLATE_GAP = 1.0 / 5.0;  // PartPlate.cpp LOGICAL_PART_PLATE_GAP
constexpr double DEG = 180.0 / M_PI;

// PartPlate.hpp compute_colum_count
int columnCount(int count) {
    const float value = std::sqrt(float(count));
    const float rounded = std::round(value);
    return value > rounded ? int(rounded) + 1 : int(rounded);
}

BoundingBoxf areaBox(const DynamicPrintConfig& cfg) {
    BoundingBoxf box;
    if (const auto* area = cfg.option<ConfigOptionPoints>("printable_area"))
        for (const Vec2d& p : area->values) box.merge(p);
    return box;
}

// Mesh of one volume in world space as positions (9 floats / triangle).
void appendTriangles(const indexed_triangle_set& its, const Transform3d& m, const Vec2d& origin,
                     std::vector<float>& pos, std::vector<uint8_t>& ext, uint8_t extruder) {
    for (const stl_triangle_vertex_indices& f : its.indices) {
        for (int k = 0; k < 3; ++k) {
            const Vec3d v = m * its.vertices[f[k]].cast<double>();
            pos.push_back(float(v.x() - origin.x()));
            pos.push_back(float(v.y() - origin.y()));
            pos.push_back(float(v.z()));
        }
        ext.push_back(extruder);
    }
}

template <typename T>
emscripten::val typedCopy(const std::vector<T>& v) {
    // typed_memory_view aliases wasm memory; slice() copies it out before v dies.
    return emscripten::val(emscripten::typed_memory_view(v.size(), v.data())).template call<emscripten::val>("slice");
}

std::string optString(const DynamicPrintConfig& c, const char* key) {
    const ConfigOption* o = c.option(key);
    return o ? o->serialize() : std::string();
}

ModelObject* objectAt(int i) {
    auto& objs = g_project.model.objects;
    if (i < 0 || size_t(i) >= objs.size()) throw std::runtime_error("no object " + std::to_string(i));
    return objs[i];
}

ModelInstance* instanceAt(int o, int i) {
    ModelObject* obj = objectAt(o);
    if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
    return obj->instances[i];
}

json ok(json extra = json::object()) {
    extra["ok"] = true;
    return extra;
}
json fail(const std::string& error) { return json{{"ok", false}, {"error", error}}; }

// Centre a freshly read geometry object on plate `plate` and drop it on the bed.
void placeOnPlate(ModelObject* obj, int plate) {
    if (obj->instances.empty()) obj->add_instance();
    const Vec2d origin = g_project.plateOrigin(plate);
    const Vec2d centre = origin + Vec2d(g_project.plateWidth / 2, g_project.plateDepth / 2);
    for (ModelInstance* inst : obj->instances) {
        const BoundingBoxf3 bb = obj->instance_bounding_box(*inst, false);
        const Vec3d off = inst->get_offset();
        inst->set_offset(Vec3d(off.x() + centre.x() - bb.center().x(), off.y() + centre.y() - bb.center().y(), off.z()));
    }
    obj->ensure_on_bed();
}

} // namespace

Project& project() { return g_project; }

int Project::columns() const { return columnCount(std::max(1, plateCount)); }

Vec2d Project::plateOrigin(int plate) const {
    const int cols = columns();
    return Vec2d((plate % cols) * plateWidth * (1 + PLATE_GAP), -(plate / cols) * plateDepth * (1 + PLATE_GAP));
}

int Project::plateOf(const ModelInstance& inst) const {
    const Vec3d c = inst.get_object()->instance_bounding_box(inst, false).center();
    for (int p = 0; p < plateCount; ++p) {
        const Vec2d o = plateOrigin(p);
        if (c.x() >= o.x() && c.x() <= o.x() + plateWidth && c.y() >= o.y() && c.y() <= o.y() + plateDepth) return p;
    }
    return -1;
}

void Project::clear() {
    model.clear_objects();
    model.clear_materials();
    release_PlateData_list(plates);
    fileConfig.clear();
    fileName.clear();
    fromBambu = false;
    plateCount = 1;
}

} // namespace engine

using engine::g_project;
using namespace engine;

namespace {

// Load a model file into the project.
//   path: file in the wasm FS. Geometry files (STL, OBJ, AMF, STEP) are added
//   to the current project on plate `plate`; a 3MF replaces the project.
//   bedWidth/bedDepth: the selected printer's bed, used for the plate grid of
//   geometry projects (a 3MF brings its own).
// Returns {ok, error, objectsAdded, isProject}.
std::string loadModel(const std::string& path, int plate, double bedWidth, double bedDepth) {
    try {
        const bool is3mf = boost::iends_with(path, ".3mf");
        if (is3mf) {
            g_project.clear();
            DynamicPrintConfig config;
            ConfigSubstitutionContext subs(ForwardCompatibilitySubstitutionRule::Enable);
            En3mfType type = En3mfType::From_BBS;
            std::vector<Preset*> projectPresets;
            Semver version;
            g_project.model = Model::read_from_archive(path, &config, &subs, type,
                                                       LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel | LoadStrategy::LoadConfig,
                                                       &g_project.plates, &projectPresets, &version);
            for (Preset* p : projectPresets) delete p;
            g_project.fileConfig = std::move(config);
            g_project.fileName = path.substr(path.find_last_of('/') + 1);
            g_project.plateCount = std::max<int>(1, int(g_project.plates.size()));
            const BoundingBoxf area = areaBox(g_project.fileConfig);
            g_project.plateWidth = area.defined ? area.size().x() : bedWidth;
            g_project.plateDepth = area.defined ? area.size().y() : bedDepth;
            const std::string printer = optString(g_project.fileConfig, "printer_settings_id") + optString(g_project.fileConfig, "printer_model");
            g_project.fromBambu = printer.find("Bambu") != std::string::npos;
            return ok({{"objectsAdded", g_project.model.objects.size()}, {"isProject", true}}).dump();
        }

        if (g_project.model.objects.empty()) {
            g_project.clear();
            g_project.plateWidth = bedWidth;
            g_project.plateDepth = bedDepth;
        }
        Model loaded = Model::read_from_file(path, nullptr, nullptr, LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel);
        const size_t added = loaded.objects.size();
        for (ModelObject* o : loaded.objects) {
            ModelObject* copy = g_project.model.add_object(*o);
            placeOnPlate(copy, std::clamp(plate, 0, g_project.plateCount - 1));
        }
        if (added == 0) return fail("the file has no objects").dump();
        return ok({{"objectsAdded", added}, {"isProject", false}}).dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

void clearModel() { g_project.clear(); }

// Everything the page shows about the project:
// {fileName, plates: [{index, name, objects: [objectIndex...]}],
//  objects: [{name, size, volumes: [{name, kind, extruder, painted}],
//             instances: [{plate, offset, rotation, scale, printable}]}],
//  file: {bambu, printer, filamentColours, filamentTypes, filamentPresets}}.
std::string modelInfoJson() {
    const Project& pr = g_project;
    json objects = json::array();
    json plates = json::array();
    for (int p = 0; p < pr.plateCount; ++p) {
        std::string name;
        if (size_t(p) < pr.plates.size() && pr.plates[p]) name = pr.plates[p]->plate_name;
        plates.push_back({{"index", p}, {"name", name}, {"objects", json::array()}});
    }
    for (size_t o = 0; o < pr.model.objects.size(); ++o) {
        const ModelObject* obj = pr.model.objects[o];
        json volumes = json::array();
        for (const ModelVolume* v : obj->volumes) {
            const char* kind = v->is_model_part() ? "part" : v->is_negative_volume() ? "negative" : v->is_modifier() ? "modifier"
                             : v->is_support_enforcer() ? "supportEnforcer" : v->is_support_blocker() ? "supportBlocker" : "other";
            volumes.push_back({{"name", v->name}, {"kind", kind}, {"extruder", v->extruder_id()},
                               {"painted", !v->mmu_segmentation_facets.empty()}});
        }
        json instances = json::array();
        for (const ModelInstance* inst : obj->instances) {
            const int plate = pr.plateOf(*inst);
            const Vec2d origin = pr.plateOrigin(std::max(plate, 0));
            const Vec3d off = inst->get_offset();
            const Vec3d rot = inst->get_rotation() * DEG;
            const Vec3d scl = inst->get_scaling_factor();
            instances.push_back({{"plate", plate},
                                 {"offset", {off.x() - origin.x(), off.y() - origin.y(), off.z()}},
                                 {"rotation", {rot.x(), rot.y(), rot.z()}},
                                 {"scale", {scl.x(), scl.y(), scl.z()}},
                                 {"printable", inst->printable}});
            if (plate >= 0) {
                auto &list = plates[plate]["objects"];
                if (std::find(list.begin(), list.end(), json(o)) == list.end()) list.push_back(o);
            }
        }
        const Vec3d size = obj->instance_bounding_box(0, false).size();
        objects.push_back({{"name", obj->name}, {"size", {size.x(), size.y(), size.z()}},
                           {"extruder", obj->config.has("extruder") ? obj->config.opt_int("extruder") : 0},
                           {"volumes", volumes}, {"instances", instances}});
    }
    const DynamicPrintConfig& fc = pr.fileConfig;
    return json{{"fileName", pr.fileName},
                {"plateWidth", pr.plateWidth},
                {"plateDepth", pr.plateDepth},
                {"plates", plates},
                {"objects", objects},
                {"file", {{"bambu", pr.fromBambu},
                          {"hasConfig", !fc.empty()},
                          {"printer", optString(fc, "printer_settings_id")},
                          {"filamentColours", optString(fc, "filament_colour")},
                          {"filamentTypes", optString(fc, "filament_type")},
                          {"filamentPresets", optString(fc, "filament_settings_id")},
                          {"process", optString(fc, "print_settings_id")}}}}
        .dump();
}

// The 3MF's own settings (project_settings.config), key -> value; {} if none.
std::string fileConfigJson() { return configToJson(g_project.fileConfig).dump(); }

// Prepare preview of one plate: {positions: Float32Array (9 floats / triangle,
// plate-local mm), filaments: Uint8Array (1-based filament per triangle; paint
// is resolved per facet), objectTriangles: Int32Array (triangles per object,
// in object order; objects not on the plate have 0)}. Only model parts are
// included; modifiers and negative volumes are not drawn.
emscripten::val previewMesh(int plate) {
    std::vector<float> pos;
    std::vector<uint8_t> fil;
    std::vector<int> perObject;
    const Vec2d origin = g_project.plateOrigin(plate);
    for (const ModelObject* obj : g_project.model.objects) {
        const size_t before = fil.size();
        for (const ModelInstance* inst : obj->instances) {
            if (g_project.plateOf(*inst) != plate) continue;
            for (const ModelVolume* v : obj->volumes) {
                if (!v->is_model_part()) continue;
                const Transform3d m = inst->get_matrix() * v->get_matrix();
                const uint8_t base = uint8_t(std::clamp(v->extruder_id(), 1, 255));
                if (v->mmu_segmentation_facets.empty()) {
                    appendTriangles(v->mesh().its, m, origin, pos, fil, base);
                } else {
                    std::vector<indexed_triangle_set> perState;
                    v->mmu_segmentation_facets.get_facets(*v, perState);
                    for (size_t s = 0; s < perState.size(); ++s)
                        appendTriangles(perState[s], m, origin, pos, fil, s == 0 ? base : uint8_t(std::min<size_t>(s, 255)));
                }
            }
        }
        perObject.push_back(int(fil.size() - before));
    }
    emscripten::val out = emscripten::val::object();
    out.set("positions", typedCopy(pos));
    out.set("filaments", typedCopy(fil));
    out.set("objectTriangles", typedCopy(perObject));
    return out;
}

// Move / rotate / scale one instance. Any field may be omitted:
// {offset: [x, y] (plate-local, of the instance origin), plate, rotation: [x, y, z] deg, scale: [x, y, z]}.
std::string setInstanceTransform(int o, int i, const std::string& changesJson) {
    try {
        ModelInstance* inst = instanceAt(o, i);
        const json c = json::parse(changesJson);
        if (c.contains("rotation")) inst->set_rotation(Vec3d(c["rotation"][0].get<double>(), c["rotation"][1].get<double>(), c["rotation"][2].get<double>()) / DEG);
        if (c.contains("scale")) inst->set_scaling_factor(Vec3d(c["scale"][0].get<double>(), c["scale"][1].get<double>(), c["scale"][2].get<double>()));
        if (c.contains("offset")) {
            const int plate = c.value("plate", std::max(0, g_project.plateOf(*inst)));
            const Vec2d origin = g_project.plateOrigin(plate);
            const Vec3d off = inst->get_offset();
            inst->set_offset(Vec3d(origin.x() + c["offset"][0].get<double>(), origin.y() + c["offset"][1].get<double>(), off.z()));
        }
        objectAt(o)->ensure_on_bed();
        return ok().dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

// Filament (1-based) of a whole object (volume < 0) or one volume; 0 = default.
std::string setExtruder(int o, int volume, int filament) {
    try {
        ModelObject* obj = objectAt(o);
        if (volume < 0) {
            obj->config.set_key_value("extruder", new ConfigOptionInt(filament));
        } else {
            if (size_t(volume) >= obj->volumes.size()) throw std::runtime_error("no volume " + std::to_string(volume));
            obj->volumes[volume]->config.set_key_value("extruder", new ConfigOptionInt(filament));
        }
        return ok().dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

std::string deleteObject(int o) {
    try {
        objectAt(o);
        g_project.model.delete_object(size_t(o));
        return ok().dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

// Adds a copy of instance i of object o, offset by (dx, dy) mm. Returns {ok, instance}.
std::string addInstance(int o, int i, double dx, double dy) {
    try {
        ModelObject* obj = objectAt(o);
        ModelInstance* copy = obj->add_instance(*instanceAt(o, i));
        copy->set_offset(copy->get_offset() + Vec3d(dx, dy, 0));
        return ok({{"instance", obj->instances.size() - 1}}).dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

std::string deleteInstance(int o, int i) {
    try {
        ModelObject* obj = objectAt(o);
        instanceAt(o, i);
        if (obj->instances.size() == 1) g_project.model.delete_object(size_t(o));
        else obj->delete_instance(size_t(i));
        return ok().dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(model_api) {
    emscripten::function("loadModel", &loadModel);
    emscripten::function("clearModel", &clearModel);
    emscripten::function("modelInfoJson", &modelInfoJson);
    emscripten::function("fileConfigJson", &fileConfigJson);
    emscripten::function("previewMesh", &previewMesh);
    emscripten::function("setInstanceTransform", &setInstanceTransform);
    emscripten::function("setExtruder", &setExtruder);
    emscripten::function("deleteObject", &deleteObject);
    emscripten::function("addInstance", &addInstance);
    emscripten::function("deleteInstance", &deleteInstance);
}

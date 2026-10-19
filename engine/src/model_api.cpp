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
#include <limits>

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

// An object's or part's own settings, without the filament assignment.
json settingsJson(const DynamicPrintConfig& cfg) {
    json out = configToJson(cfg);
    out.erase("extruder");
    return out;
}

// Bounding boxes (XY) of every instance on `plate` except `skip`'s.
std::vector<BoundingBoxf> plateBoxes(int plate, const ModelObject* skip) {
    std::vector<BoundingBoxf> boxes;
    for (const ModelObject* obj : g_project.model.objects) {
        if (obj == skip) continue;
        for (const ModelInstance* inst : obj->instances) {
            if (g_project.plateOf(*inst) != plate) continue;
            const BoundingBoxf3 bb = obj->instance_bounding_box(*inst, false);
            boxes.emplace_back(Vec2d(bb.min.x(), bb.min.y()), Vec2d(bb.max.x(), bb.max.y()));
        }
    }
    return boxes;
}

// Puts a freshly read geometry object on plate `plate` and drops it on the
// bed: in the centre when the plate is empty, otherwise on the free spot
// closest to the centre, SPACING mm clear of what is already there (desktop
// arranges added objects around the ones on the plate the same way). When
// nothing fits it goes in the centre, for the user to sort out.
void placeOnPlate(ModelObject* obj, int plate) {
    constexpr double SPACING = 6, STEP = 2;
    if (obj->instances.empty()) obj->add_instance();
    const Vec2d origin = g_project.plateOrigin(plate);
    const Vec2d centre = origin + Vec2d(g_project.plateWidth / 2, g_project.plateDepth / 2);
    std::vector<BoundingBoxf> taken = plateBoxes(plate, obj);
    for (ModelInstance* inst : obj->instances) {
        const BoundingBoxf3 bb = obj->instance_bounding_box(*inst, false);
        const Vec2d half(bb.size().x() / 2, bb.size().y() / 2);
        Vec2d best = centre;
        if (!taken.empty()) {
            double bestDist = std::numeric_limits<double>::max();
            for (double y = origin.y() + half.y(); y <= origin.y() + g_project.plateDepth - half.y() + 1e-6; y += STEP)
                for (double x = origin.x() + half.x(); x <= origin.x() + g_project.plateWidth - half.x() + 1e-6; x += STEP) {
                    const double dist = (Vec2d(x, y) - centre).squaredNorm();
                    if (dist >= bestDist) continue;
                    const BoundingBoxf me(Vec2d(x, y) - half - Vec2d(SPACING, SPACING), Vec2d(x, y) + half + Vec2d(SPACING, SPACING));
                    if (std::none_of(taken.begin(), taken.end(), [&](const BoundingBoxf& t) { return t.overlap(me); })) {
                        best = Vec2d(x, y);
                        bestDist = dist;
                    }
                }
        }
        const Vec3d off = inst->get_offset();
        inst->set_offset(Vec3d(off.x() + best.x() - bb.center().x(), off.y() + best.y() - bb.center().y(), off.z()));
        taken.emplace_back(best - half, best + half);
    }
    obj->invalidate_bounding_box();
    obj->ensure_on_bed();
}

} // namespace

void placeObject(ModelObject* obj, int plate) { placeOnPlate(obj, plate); }

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
    calib = Slic3r::Calib_Params();
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
// Opens a 3MF as the project (its plates, settings and filaments replace
// the open project), or adds a model file's objects to the project on
// `plate`. geometryOnly adds a 3MF's objects like a model file, which is
// desktop's "Import geometry only".
std::string loadModel(const std::string& path, int plate, double bedWidth, double bedDepth, bool geometryOnly) {
    try {
        const bool is3mf = boost::iends_with(path, ".3mf");
        if (is3mf && !geometryOnly) {
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
        Model loaded;
        if (is3mf) {
            DynamicPrintConfig config;
            ConfigSubstitutionContext subs(ForwardCompatibilitySubstitutionRule::Enable);
            En3mfType type = En3mfType::From_BBS;
            PlateDataPtrs plates;
            loaded = Model::read_from_archive(path, &config, &subs, type, LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel, &plates);
            release_PlateData_list(plates);
        } else {
            loaded = Model::read_from_file(path, nullptr, nullptr, LoadStrategy::AddDefaultInstances | LoadStrategy::LoadModel);
        }
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
//  objects: [{name, size, units ("", "inch" or "meter": converted from), volumes: [{name, kind, extruder, painted, text?}],
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
                               {"painted", !v->mmu_segmentation_facets.empty()},
                               {"paint", {{"support", !v->supported_facets.empty()}, {"seam", !v->seam_facets.empty()},
                                          {"fuzzy", !v->fuzzy_skin_facets.empty()}}},
                               {"settings", settingsJson(v->config.get())}});
            if (v->text_configuration) {
                // A text shape (text_api.cpp): what the Text tool edits.
                const TextConfiguration& tc = *v->text_configuration;
                const FontProp& fp = tc.style.prop;
                const auto align = fp.align.first;
                volumes.back()["text"] = {{"text", tc.text}, {"font", fp.face_name.value_or(tc.style.name)},
                                          {"size", fp.size_in_mm},
                                          {"depth", v->emboss_shape ? v->emboss_shape->projection.depth : 1.0},
                                          {"boldness", fp.boldness.value_or(0.f)}, {"skew", fp.skew.value_or(0.f)},
                                          {"charGap", fp.char_gap.value_or(0)}, {"lineGap", fp.line_gap.value_or(0)},
                                          {"align", align == FontProp::HorizontalAlign::left ? "left" : align == FontProp::HorizontalAlign::right ? "right" : "center"}};
            } else if (v->emboss_shape && v->emboss_shape->svg_file) {
                // An SVG shape (svg_api.cpp): what the SVG tool edits, its size across its face.
                const Vec3d size = v->mesh().bounding_box().size().cwiseProduct(v->get_scaling_factor());
                volumes.back()["svg"] = {{"depth", v->emboss_shape->projection.depth}, {"width", size.x()}, {"height", size.y()}};
            }
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
        // Parts converted from inches or meters (desktop then offers to convert back).
        const char* units = "";
        for (const ModelVolume* v : obj->volumes)
            units = v->source.is_converted_from_inches ? "inch" : v->source.is_converted_from_meters ? "meter" : units;
        objects.push_back({{"name", obj->name}, {"size", {size.x(), size.y(), size.z()}}, {"units", units},
                           {"extruder", obj->config.has("extruder") ? obj->config.opt_int("extruder") : 0},
                           {"settings", settingsJson(obj->config.get())},
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
// in object order; objects not on the plate have 0), and the other volumes
// (negative parts, modifiers, support enforcers and blockers), drawn see-through:
// volumePositions (9 floats / triangle) and volumeList: Int32Array of
// [object, volume, kind (1 negative, 2 modifier, 3 support enforcer,
// 4 support blocker), triangles] per volume of each instance}; partList:
// Int32Array of [object, volume, first triangle, triangles] for each model part
// of each instance, so a part can be drawn on its own.
emscripten::val previewMesh(int plate) {
    std::vector<float> pos;
    std::vector<uint8_t> fil;
    std::vector<int> perObject;
    std::vector<float> extraPos;
    std::vector<uint8_t> extraFil;
    std::vector<int> extraList;
    std::vector<int> partList;
    const Vec2d origin = g_project.plateOrigin(plate);
    for (size_t o = 0; o < g_project.model.objects.size(); ++o) {
        const ModelObject* obj = g_project.model.objects[o];
        const size_t before = fil.size();
        for (const ModelInstance* inst : obj->instances) {
            if (g_project.plateOf(*inst) != plate) continue;
            for (size_t k = 0; k < obj->volumes.size(); ++k) {
                const ModelVolume* v = obj->volumes[k];
                const Transform3d m = inst->get_matrix() * v->get_matrix();
                if (!v->is_model_part()) {
                    const int kind = v->is_negative_volume() ? 1 : v->is_modifier() ? 2 : v->is_support_enforcer() ? 3 : 4;
                    const size_t start = extraFil.size();
                    appendTriangles(v->mesh().its, m, origin, extraPos, extraFil, 0);
                    extraList.insert(extraList.end(), {int(o), int(k), kind, int(extraFil.size() - start)});
                    continue;
                }
                const size_t first = fil.size();
                const uint8_t base = uint8_t(std::clamp(v->extruder_id(), 1, 255));
                if (v->mmu_segmentation_facets.empty()) {
                    appendTriangles(v->mesh().its, m, origin, pos, fil, base);
                } else {
                    std::vector<indexed_triangle_set> perState;
                    v->mmu_segmentation_facets.get_facets(*v, perState);
                    for (size_t s = 0; s < perState.size(); ++s)
                        appendTriangles(perState[s], m, origin, pos, fil, s == 0 ? base : uint8_t(std::min<size_t>(s, 255)));
                }
                partList.insert(partList.end(), {int(o), int(k), int(first), int(fil.size() - first)});
            }
        }
        perObject.push_back(int(fil.size() - before));
    }
    emscripten::val out = emscripten::val::object();
    out.set("positions", typedCopy(pos));
    out.set("filaments", typedCopy(fil));
    out.set("objectTriangles", typedCopy(perObject));
    out.set("volumePositions", typedCopy(extraPos));
    out.set("volumeList", typedCopy(extraList));
    out.set("partList", typedCopy(partList));
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
        // The object's cached bounding box is stale after a rotation or scale
        // (desktop invalidates it too); dropping to the bed reads it.
        objectAt(o)->invalidate_bounding_box();
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

// Changes the plate size (after switching to a printer with a different bed),
// keeping every instance at the same place relative to its plate's centre, as
// desktop does when the bed changes. Instances off every plate stay put.
std::string resizePlates(double width, double depth) {
    try {
        if (width <= 0 || depth <= 0) throw std::runtime_error("bad plate size");
        Project& pr = g_project;
        struct Move { ModelInstance* inst; int plate; Vec2d fromCentre; };
        std::vector<Move> moves;
        for (ModelObject* obj : pr.model.objects)
            for (ModelInstance* inst : obj->instances) {
                const int plate = pr.plateOf(*inst);
                if (plate < 0) continue;
                const Vec2d centre = pr.plateOrigin(plate) + Vec2d(pr.plateWidth / 2, pr.plateDepth / 2);
                const Vec3d c = obj->instance_bounding_box(*inst, false).center();
                moves.push_back({inst, plate, Vec2d(c.x(), c.y()) - centre});
            }
        std::vector<Vec2d> oldCentres;
        for (const Move& m : moves) oldCentres.push_back(pr.plateOrigin(m.plate) + Vec2d(pr.plateWidth / 2, pr.plateDepth / 2));
        pr.plateWidth = width;
        pr.plateDepth = depth;
        for (size_t k = 0; k < moves.size(); ++k) {
            const Vec2d newCentre = pr.plateOrigin(moves[k].plate) + Vec2d(width / 2, depth / 2);
            const Vec2d d = newCentre - oldCentres[k];
            moves[k].inst->set_offset(moves[k].inst->get_offset() + Vec3d(d.x(), d.y(), 0));
        }
        return ok().dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

// Save the project as an Orca 3MF project, the way desktop's Save project does
// (Plater::export_3mf -> store_bbs_3mf): geometry, plates, object and part
// settings, every kind of paint, and configJson (the full config of the
// selected presets plus the user's changes) as project_settings.config.
//   thumbnail: null, or {plate, width, height, pixels: Uint8Array RGBA, rows
//   top to bottom}, written as that plate's Metadata/plate_N.png.
// Returns {ok, error?}; the file is at `path` in the wasm FS.
std::string saveProject(const std::string& path, const std::string& configJson, emscripten::val thumbnail) {
    PlateDataPtrs plates;
    try {
        Project& pr = g_project;
        DynamicPrintConfig cfg;
        cfg.apply(FullPrintConfig::defaults());
        applyJsonConfig(cfg, json::parse(configJson));

        // PartPlateList::store_to_3mf_structure: one PlateData per plate with the
        // (object, instance) pairs on it; a loaded 3MF's plate names, locks and
        // plate settings are kept.
        const std::string nozzles = optString(cfg, "nozzle_diameter");
        for (int p = 0; p < pr.plateCount; ++p) {
            PlateData* d = new PlateData();
            plates.push_back(d);
            d->plate_index = p;
            if (size_t(p) < pr.plates.size() && pr.plates[p]) {
                d->plate_name = pr.plates[p]->plate_name;
                d->locked = pr.plates[p]->locked;
                d->config.apply(pr.plates[p]->config);
            }
            d->nozzle_diameters = nozzles;
        }
        for (size_t o = 0; o < pr.model.objects.size(); ++o)
            for (size_t i = 0; i < pr.model.objects[o]->instances.size(); ++i) {
                const int p = pr.plateOf(*pr.model.objects[o]->instances[i]);
                if (p >= 0) plates[p]->objects_and_instances.emplace_back(int(o), int(i));
            }

        // The exporter writes PNGs bottom row first (OpenGL's order); the page
        // sends canvas rows top first.
        std::vector<ThumbnailData> thumbs(plates.size());
        if (thumbnail.typeOf().as<std::string>() == "object" && !thumbnail.isNull()) {
            const int plate = thumbnail["plate"].as<int>();
            const unsigned w = thumbnail["width"].as<unsigned>(), h = thumbnail["height"].as<unsigned>();
            const std::vector<unsigned char> px = emscripten::convertJSArrayToNumberVector<unsigned char>(thumbnail["pixels"]);
            if (plate >= 0 && size_t(plate) < thumbs.size() && w && h && px.size() == size_t(w) * h * 4) {
                ThumbnailData& t = thumbs[plate];
                t.set(w, h);
                for (unsigned y = 0; y < h; ++y)
                    std::copy_n(px.begin() + size_t(h - 1 - y) * w * 4, size_t(w) * 4, t.pixels.begin() + size_t(y) * w * 4);
            }
        }
        std::vector<ThumbnailData*> thumbPtrs;
        for (ThumbnailData& t : thumbs) thumbPtrs.push_back(&t);

        StoreParams params;
        params.path = path.c_str();
        params.model = &pr.model;
        params.plate_data_list = plates;
        params.config = &cfg;
        params.thumbnail_data = thumbPtrs;
        params.strategy = SaveStrategy::Zip64;
        const bool saved = store_bbs_3mf(params);
        release_PlateData_list(plates);
        if (!saved) return fail("the project could not be written").dump();
        return ok().dump();
    } catch (const std::exception& e) {
        release_PlateData_list(plates);
        return fail(e.what()).dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(model_api) {
    emscripten::function("saveProject", &saveProject);
    emscripten::function("resizePlates", &resizePlates);
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

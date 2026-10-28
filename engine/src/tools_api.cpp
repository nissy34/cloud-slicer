// Object tools from desktop Orca's Prepare toolbar, on the open project:
// arrange a plate, auto-orient, split to objects or parts, cut, mirror, and adding or
// removing plates. Each returns {ok, error?}; the page re-reads modelInfoJson().
#include "engine.hpp"

#include "paint_remap.hpp"

#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/Orient.hpp"

#include <algorithm>
#include <map>
#include <optional>

using nlohmann::json;
using namespace Slic3r;
namespace paint = engine::paint;

namespace {

engine::Project& pr() { return engine::project(); }

std::string ok(json extra = json::object()) {
    extra["ok"] = true;
    return extra.dump();
}
std::string fail(const std::string& error) { return json{{"ok", false}, {"error", error}}.dump(); }

ModelObject* objectAt(int o) {
    auto& objs = pr().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    return objs[o];
}

template<class F> std::string guarded(F&& f) {
    try {
        return f();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

void relayout(int newCount);

// Arranges every instance on `plate`: rows of bounding boxes, `spacing` mm
// apart, tallest-first, the whole layout centred on the plate. What does not
// fit goes onto new plates after the last one.
//
// `tall` > 0 arranges for printing object by object, as desktop's ArrangeJob
// does then: the objects go down in the order they print (the object list),
// and a row ends after any object taller than `tall` (the printer's
// extruder_clearance_height_to_rod), so the tool head's rod never passes over
// it: it is the last of its row to print.
//
// Desktop uses libnest2d's no-fit-polygon packer (arrangement::arrange); in
// this build it places every item on the same spot, so until that is tracked
// down the page gets this simpler packer.
std::string arrangePlate(int plate, double spacing, double tall) {
    return guarded([&] {
        engine::Project& p = pr();
        if (plate < 0 || plate >= p.plateCount) throw std::runtime_error("no plate " + std::to_string(plate));
        spacing = std::max(0.0, spacing);
        struct Box { ModelInstance* inst; Vec2d centre, size; double height; int plate = 0; Vec2d at; };
        std::vector<Box> boxes;
        for (ModelObject* obj : p.model.objects)
            for (ModelInstance* inst : obj->instances) {
                if (p.plateOf(*inst) != plate) continue;
                const BoundingBoxf3 bb = obj->instance_bounding_box(*inst, false);
                boxes.push_back({inst, Vec2d(bb.center().x(), bb.center().y()), Vec2d(bb.size().x(), bb.size().y()), bb.max.z() - std::max(0.0, bb.min.z())});
            }
        if (boxes.empty()) return ok();
        const bool byObject = tall > 0;
        if (!byObject) std::stable_sort(boxes.begin(), boxes.end(), [](const Box& a, const Box& b) { return a.size.y() > b.size.y(); });

        // Shelf packing: fill a row left to right, start a new row when it is
        // full, and a new plate when the rows run out of depth.
        const double W = p.plateWidth, D = p.plateDepth;
        int target = plate, extra = 0;
        double x = 0, y = 0, rowDepth = 0;
        for (Box& b : boxes) {
            if (x > 0 && x + b.size.x() > W) { x = 0; y += rowDepth + spacing; rowDepth = 0; }
            if (y > 0 && y + b.size.y() > D) {
                target = target == plate ? p.plateCount + extra : target + 1;
                extra += 1;
                x = y = rowDepth = 0;
            }
            b.plate = target;
            b.at = Vec2d(x + b.size.x() / 2, y + b.size.y() / 2);
            x += b.size.x() + spacing;
            rowDepth = std::max(rowDepth, b.size.y());
            if (byObject && b.height > tall) x = W;  // the next object starts a new row
        }
        if (extra) {
            // New plates first, so the plate origins used below are final.
            relayout(p.plateCount + extra);
            for (Box& b : boxes) {
                const BoundingBoxf3 bb = b.inst->get_object()->instance_bounding_box(*b.inst, false);
                b.centre = Vec2d(bb.center().x(), bb.center().y());
            }
        }
        // Centre each plate's layout on the plate.
        std::map<int, BoundingBoxf> layouts;
        for (const Box& b : boxes) {
            layouts[b.plate].merge(b.at - b.size / 2);
            layouts[b.plate].merge(b.at + b.size / 2);
        }
        for (const Box& b : boxes) {
            const BoundingBoxf& l = layouts[b.plate];
            const Vec2d shift = Vec2d(W, D) / 2 - l.center();
            const Vec2d want = p.plateOrigin(b.plate) + b.at + shift;
            const Vec2d d = want - b.centre;
            b.inst->set_offset(b.inst->get_offset() + Vec3d(d.x(), d.y(), 0));
        }
        for (ModelObject* obj : p.model.objects) obj->invalidate_bounding_box();
        return ok({{"newPlates", extra}});
    });
}

// Auto-orient (desktop's Orient): turns the object so it prints with the least
// overhang, then drops it on the bed.
std::string orientObject(int o) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        orientation::orient(obj);
        obj->invalidate_bounding_box();
        obj->ensure_on_bed();
        return ok();
    });
}

// Split to objects: every separate piece becomes its own object.
std::string splitObject(int o) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        auto& objs = pr().model.objects;
        const size_t before = objs.size();
        ModelObjectPtrs pieces;
#if ENGINE_UPSTREAM
        obj->split(&pieces, true);  // upstream can keep the paint ("keep painting", on by default)
#else
        obj->split(&pieces);
#endif
        if (pieces.size() < 2) {
            while (objs.size() > before) pr().model.delete_object(objs.size() - 1);
            throw std::runtime_error("the object is a single piece");
        }
        pr().model.delete_object(size_t(o));
        for (ModelObject* piece : pieces) piece->ensure_on_bed();
        return ok({{"objects", pieces.size()}});
    });
}

// Split to parts: every separate piece of the object's parts becomes a part of
// its own, keeping the part's filament (desktop's ModelVolume::split). Paint
// on a split part is dropped, as on desktop.
std::string splitParts(int o) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        const size_t before = obj->volumes.size();
        std::vector<ModelVolume*> parts;
        for (ModelVolume* v : obj->volumes)
            if (v->is_model_part()) parts.push_back(v);
#if ENGINE_UPSTREAM
        for (ModelVolume* v : parts) v->split(1, true);
#else
        for (ModelVolume* v : parts) v->split(1);
#endif
        if (obj->volumes.size() == before) throw std::runtime_error("the parts are single pieces");
        obj->invalidate_bounding_box();
        obj->ensure_on_bed();
        return ok({{"parts", obj->volumes.size()}});
    });
}

constexpr double CUT_PLANE_TOLERANCE = 2e-3;        // 2 microns
constexpr double CUT_PLANE_NORMAL_TOLERANCE = 0.99; // cos(angle) > 0.99 (~8 deg)

// The connector shapes, as desktop's GLGizmoCut3D::get_connector_mesh makes them
// (a unit shape, scaled by radius and depth when placed).
indexed_triangle_set connectorMesh(const CutConnectorAttributes& a, float space, float bulge) {
    const int sectors = a.shape == CutConnectorShape::Triangle ? 3
                        : a.shape == CutConnectorShape::Square ? 4
                        : a.shape == CutConnectorShape::Hexagon ? 6
                                                                : 360;
    if (a.type == CutConnectorType::Snap) return its_make_snap(1.0, 1.0, space, bulge);
    if (a.style == CutConnectorStyle::Prism) return its_make_cylinder(1.0, 1.0, 2 * PI / sectors);
    if (a.type == CutConnectorType::Plug) return its_make_frustum(1.0, 1.0, 2 * PI / sectors);
    return its_make_frustum_dowel(1.0, 1.0, sectors);
}

template<class T> T pickName(const json& c, const char* key, std::initializer_list<std::pair<const char*, T>> names) {
    const std::string v = c.value(key, std::string(names.begin()->first));
    for (const auto& [name, value] : names)
        if (v == name) return value;
    throw std::runtime_error(std::string("bad connector ") + key + " " + v);
}

// Adds the request's connectors to obj as negative volumes, like desktop's
// apply_connectors_in_model + apply_cut_connectors: each at [u, v] mm on the
// plane (along the plane's turned X and Y from its middle), turned with the
// plane; plugs and snaps are lifted half their depth into the upper half.
// `centre` is the plane's middle in the instance's frame without its offset,
// where Cut works. Returns how many dowels there are.
int addConnectors(ModelObject& obj, const json& connectors, const Vec3d& centre, const Transform3d& rotation) {
    using namespace Geometry;
    const Vec3d normal = rotation.linear() * Vec3d::UnitZ();
    int dowels = 0, n = 0;
    for (const json& c : connectors) {
        const std::vector<double> at = c.value("at", std::vector<double>{0, 0});
        if (at.size() != 2) throw std::runtime_error("a connector needs [u, v]");
        CutConnectorAttributes attribs(pickName<CutConnectorType>(c, "type", {{"plug", CutConnectorType::Plug}, {"dowel", CutConnectorType::Dowel}, {"snap", CutConnectorType::Snap}}),
                                       pickName<CutConnectorStyle>(c, "style", {{"prism", CutConnectorStyle::Prism}, {"frustum", CutConnectorStyle::Frustum}}),
                                       pickName<CutConnectorShape>(c, "shape",
                                                                   {{"circle", CutConnectorShape::Circle},
                                                                    {"square", CutConnectorShape::Square},
                                                                    {"hexagon", CutConnectorShape::Hexagon},
                                                                    {"triangle", CutConnectorShape::Triangle}}));
        const float radius = 0.5f * c.value("size", 5.f), sizeGap = 0.5f * c.value("sizeGap", 0.f), depthGap = c.value("depthGap", 0.1f);
        float height = c.value("depth", 3.f);
        if (radius <= 0 || height <= 0) throw std::runtime_error("a connector needs a size and a depth");
        Vec3d pos = centre + rotation.linear() * Vec3d(at[0], at[1], 0);
        if (attribs.type == CutConnectorType::Dowel) {
            if (attribs.style == CutConnectorStyle::Prism) height *= 2;
            ++dowels;
        } else
            pos += normal * 0.5 * double(height);
        TriangleMesh mesh(connectorMesh(attribs, c.value("space", 0.3f), c.value("bulge", 0.15f)));
        // Mesh will be centered when loading.
        ModelVolume* v = obj.add_volume(std::move(mesh), ModelVolumeType::NEGATIVE_VOLUME);
        v->set_transformation(translation_transform(pos) * rotation * scale_transform(Vec3f(radius, radius, height).cast<double>()));
        v->cut_info = {attribs.type, sizeGap, depthGap};
        v->name = "Connector-" + std::to_string(++n);
    }
    return dowels;
}

// The Cut tool's plane for instance i of obj, from a cut request (see cutObject).
struct CutPlane {
    Transform3d rotation;
    Vec3d normal;
    Vec3d centre; // the plane's middle, on the bed's axes
};

CutPlane cutPlaneOf(const ModelObject& obj, int i, const json& req) {
    const double position = req.value("position", 0.0);
    const std::vector<double> deg = req.value("rotation", std::vector<double>{0, 0, 0});
    if (deg.size() != 3) throw std::runtime_error("rotation needs three angles");
    CutPlane p;
    p.rotation = Geometry::rotation_transform(Vec3d(deg[0], deg[1], deg[2]) * (PI / 180.0));
    p.normal = (p.rotation.linear() * Vec3d::UnitZ()).normalized();
    // The plane's middle: the instance's middle, slid along the arrow onto the plane.
    const Vec3d middle = obj.instance_bounding_box(size_t(i)).center();
    const Vec3d base(middle.x(), middle.y(), 0);
    p.centre = middle - (p.normal.dot(middle - base) - position) * p.normal;
    return p;
}

// The pieces the plane cuts obj into, like desktop's PartSelection: obj cut and
// kept as parts, every part split into its separate pieces, each piece above
// the plane (true) or below it. `model` holds the cut object (its only one).
struct CutPieces {
    Model model;
    std::vector<Cut::Part> parts;
};

std::unique_ptr<CutPieces> cutIntoPieces(const ModelObject& obj, int i, const CutPlane& plane) {
    auto out = std::make_unique<CutPieces>();
    const Vec3d offset = obj.instances[i]->get_offset();
    Cut cut(&obj, i, Geometry::translation_transform(plane.centre - offset) * plane.rotation);
    const ModelObjectPtrs& cutObjects = cut.perform_with_plane();
    if (cutObjects.empty()) throw std::runtime_error("the cut plane misses the object");
    ModelObject* mo = out->model.add_object(*cutObjects.front());
    for (int id = int(mo->volumes.size()) - 1; id >= 0; --id)
        if (mo->volumes[id]->is_splittable())
#if ENGINE_UPSTREAM
            mo->volumes[id]->split(1, false);
#else
            mo->volumes[id]->split(1);
#endif
    for (const ModelVolume* v : mo->volumes) {
        Cut::Part part{true, !v->is_model_part()};
        const Transform3d tr = (mo->instances[i]->get_matrix() * v->get_matrix()).inverse();
        const Vec3f pos = (tr * plane.centre).cast<float>();
        const Vec3f norm = (tr.linear().inverse().transpose() * plane.normal).cast<float>();
        for (const Vec3f& p : v->mesh().its.vertices) {
            const double d = (p - pos).dot(norm);
            if (std::abs(d) > EPSILON) {
                part.selected = d > 0.;
                break;
            }
        }
        out->parts.push_back(part);
    }
    return out;
}

// The pieces the Cut tool's plane cuts instance i of object o into, for the page
// to show and swap from one side to the other (desktop's right-click on a part):
// {positions: Float32Array (9 floats / triangle, plate-local mm),
// pieceTriangles: Int32Array (triangles per piece), above: Uint8Array (1 for a
// piece above the plane)}. Not-printing pieces (modifiers) have 0 triangles.
// cutObject's `pieces` lists, in this order, which pieces go with the upper half.
emscripten::val cutPieces(int o, int i, const std::string& requestJson) {
    emscripten::val out = emscripten::val::object();
    try {
        const ModelObject* obj = objectAt(o);
        if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
        const std::unique_ptr<CutPieces> pieces = cutIntoPieces(*obj, i, cutPlaneOf(*obj, i, json::parse(requestJson)));
        const ModelObject* mo = pieces->model.objects.front();
        const Vec2d origin = pr().plateOrigin(pr().plateOf(*obj->instances[i]));
        std::vector<float> pos;
        std::vector<int> counts;
        std::vector<uint8_t> above;
        for (size_t k = 0; k < mo->volumes.size(); ++k) {
            const ModelVolume* v = mo->volumes[k];
            above.push_back(pieces->parts[k].selected ? 1 : 0);
            if (pieces->parts[k].is_modifier) {
                counts.push_back(0);
                continue;
            }
            const Transform3d m = mo->instances[i]->get_matrix() * v->get_matrix();
            const indexed_triangle_set& its = v->mesh().its;
            for (const auto& f : its.indices)
                for (int c = 0; c < 3; ++c) {
                    const Vec3d w = m * its.vertices[f[c]].cast<double>();
                    pos.insert(pos.end(), {float(w.x() - origin.x()), float(w.y() - origin.y()), float(w.z())});
                }
            counts.push_back(int(its.indices.size()));
        }
        out.set("positions", engine::typedCopy(pos));
        out.set("pieceTriangles", engine::typedCopy(counts));
        out.set("above", engine::typedCopy(above));
    } catch (const std::exception& e) {
        out.set("error", std::string(e.what()));
    }
    return out;
}

// Cuts instance i of object o with a plane, like desktop's Cut tool. The request
// (JSON): {position, rotation: [x, y, z] degrees, upper, lower, asParts}. The
// plane starts flat and turns by `rotation` (X, then Y, then Z, about the bed's
// axes); its arrow (normal) is the turned +Z. `position` is how far the plane
// is along its arrow from the bed under the middle of the instance, so a flat
// plane's position is its height above the bed. upper / lower: "keep" (as it
// stands), "place" (turned so the cut face lies on the bed), "flip" (turned
// upside down) or "drop" (thrown away). asParts keeps both halves as parts of one object, where they stand.
// Painting on the parts (filament colours, support enforcers/blockers, seam
// enforcers/blockers and fuzzy skin) is preserved on the cut objects.
std::string cutObject(int o, int i, const std::string& requestJson) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
        const json req = json::parse(requestJson);
        const std::string upperDo = req.value("upper", std::string("keep")), lowerDo = req.value("lower", std::string("keep"));
        for (const std::string* d : {&upperDo, &lowerDo})
            if (*d != "keep" && *d != "place" && *d != "flip" && *d != "drop") throw std::runtime_error("bad part choice " + *d);
        const json connectors = req.value("connectors", json::array());
        // Connectors join the two halves: both are kept, as separate objects (like desktop).
        const bool asParts = connectors.empty() && req.value("asParts", false) && !req.contains("groove");
        const bool upper = asParts || !connectors.empty() || upperDo != "drop";
        const bool lower = asParts || !connectors.empty() || lowerDo != "drop";
        if (!upper && !lower) throw std::runtime_error("keep at least one part");
        ModelObjectCutAttributes attrs = only_if(upper, ModelObjectCutAttribute::KeepUpper) |
                                         only_if(lower, ModelObjectCutAttribute::KeepLower) |
                                         only_if(asParts, ModelObjectCutAttribute::KeepAsParts) |
                                         only_if(!asParts && upperDo == "place", ModelObjectCutAttribute::PlaceOnCutUpper) |
                                         only_if(!asParts && lowerDo == "place", ModelObjectCutAttribute::PlaceOnCutLower) |
                                         only_if(!asParts && upperDo == "flip", ModelObjectCutAttribute::FlipUpper) |
                                         only_if(!asParts && lowerDo == "flip", ModelObjectCutAttribute::FlipLower) |
                                         only_if(!req.contains("groove"), ModelObjectCutAttribute::InvalidateCutInfo);
        // A dovetail (desktop's Dovetail mode): a tongue on the lower half in a
        // groove of the upper, along the plane's Y, centred at `spot` on the plane.
        const bool dovetail = req.contains("groove");
        Cut::Groove groove;
        if (dovetail) {
            if (!connectors.empty()) throw std::runtime_error("a dovetail cut takes no connectors");
            const json& g = req["groove"];
            groove.depth = groove.depth_init = g.value("depth", 0.f);
            groove.width = groove.width_init = g.value("width", 0.f);
            groove.flaps_angle = groove.flaps_angle_init = float(g.value("flapAngle", 60.0) * PI / 180.0);
            groove.angle = groove.angle_init = float(g.value("angle", 0.0) * PI / 180.0);
            groove.depth_tolerance = g.value("depthTolerance", 0.1f);
            groove.width_tolerance = g.value("widthTolerance", 0.1f);
            if (groove.depth <= 0.f || groove.width <= 0.f) throw std::runtime_error("the dovetail needs a depth and a width");
            if (-2.f * groove.depth / std::tan(groove.flaps_angle) > groove.width)
                throw std::runtime_error("the dovetail is too narrow for its flap angle");
        }
        CutPlane plane = cutPlaneOf(*obj, i, req);
        if (dovetail) {
            const std::vector<double> spot = req.value("spot", std::vector<double>{0, 0});
            if (spot.size() != 2) throw std::runtime_error("spot needs two numbers");
            plane.centre += plane.rotation.linear() * Vec3d(spot[0], spot[1], 0);
            // Both of its faces must cross the object, or a half comes out empty.
            const BoundingBoxf3 box = obj->instance_bounding_box(size_t(i));
            double lo = INFINITY, hi = -INFINITY;
            for (int k = 0; k < 8; ++k) {
                const Vec3d corner((k & 1 ? box.max : box.min).x(), (k & 2 ? box.max : box.min).y(), (k & 4 ? box.max : box.min).z());
                const double d = plane.normal.dot(corner - plane.centre);
                lo = std::min(lo, d);
                hi = std::max(hi, d);
            }
            if (lo > -0.5 * groove.depth || hi < 0.5 * groove.depth) throw std::runtime_error("the dovetail misses the object: move the plane or make it shallower");
        }
        const Transform3d& rotation = plane.rotation;
        const Vec3d& normal = plane.normal;
        const Vec3d& centre = plane.centre;
        const Vec3d offset = obj->instances[i]->get_offset();
        const Transform3d instance_matrix = obj->instances[i]->get_transformation().get_matrix_no_offset();

        // Prepare paint sources before cutting. Tag each volume with a unique suffix
        // in its name so that volumes on cut parts can be unambiguously mapped back
        // to their source volume, even if multiple volumes have identical names or
        // only some volumes have paint.
        struct VolumeSource {
            const ModelVolume* orig;
            std::unique_ptr<paint::Source> src;
            bool hasPaint = false;
        };
        std::vector<VolumeSource> sources;
        std::vector<std::string> origNames;
        origNames.reserve(obj->volumes.size());
        sources.reserve(obj->volumes.size());

        for (size_t idx = 0; idx < obj->volumes.size(); ++idx) {
            ModelVolume* v = obj->volumes[idx];
            origNames.push_back(v->name);
            v->name = v->name + "__srcvol_" + std::to_string(idx);

            const bool hasPaint = v->is_model_part() && !v->mesh().empty() &&
                (!v->supported_facets.empty() || !v->seam_facets.empty() ||
                 !v->mmu_segmentation_facets.empty() || !v->fuzzy_skin_facets.empty());

            std::unique_ptr<paint::Source> src;
            if (hasPaint) {
                src = std::make_unique<paint::Source>(v->mesh().its);
            }
            sources.push_back({v, std::move(src), hasPaint});
        }

        // Connectors go into the object as negative volumes for Cut to share out;
        // Cut works on its own copy, so they come straight back out of obj.
        const size_t volumesBefore = obj->volumes.size();
        const auto takeOutConnectors = [&] {
            while (obj->volumes.size() > volumesBefore) obj->delete_volume(obj->volumes.size() - 1);
        };
        int dowels = 0;
        try {
            dowels = addConnectors(*obj, connectors, centre - offset, rotation);
        } catch (...) {
            takeOutConnectors();
            for (size_t idx = 0; idx < obj->volumes.size(); ++idx) obj->volumes[idx]->name = origNames[idx];
            throw;
        }
        if (dowels > 0) attrs = attrs | ModelObjectCutAttribute::CreateDowels; // (enum_bitmask's |= does not compile)
        const Transform3d cutMatrix = Geometry::translation_transform(centre - offset) * rotation;
        // With `pieces`, each separate piece goes to the side the page chose
        // (desktop's cut by contour); otherwise the plane decides.
        std::unique_ptr<CutPieces> pieces;
        std::optional<Cut> cut;
        if (req.contains("pieces") && !asParts && !dovetail) {
            takeOutConnectors();
            try {
                pieces = cutIntoPieces(*obj, i, plane);
                const std::vector<bool> chosen = req["pieces"].get<std::vector<bool>>();
                if (chosen.size() != pieces->parts.size()) throw std::runtime_error("the pieces changed: try again");
                for (size_t k = 0; k < chosen.size(); ++k) pieces->parts[k].selected = chosen[k];
                addConnectors(*pieces->model.objects.front(), connectors, centre - offset, rotation);
            } catch (...) {
                for (size_t idx = 0; idx < obj->volumes.size(); ++idx) obj->volumes[idx]->name = origNames[idx];
                throw;
            }
            cut.emplace(pieces->model.objects.front(), i, cutMatrix, attrs);
        } else {
            cut.emplace(obj, i, cutMatrix, attrs);
            takeOutConnectors();
        }
#if ENGINE_UPSTREAM
        const float radius = float(obj->instance_bounding_box(size_t(i)).radius());
        const ModelObjectPtrs& parts = dovetail ? cut->perform_with_groove(groove, rotation, 1, 10.f, radius)
                                       : pieces ? cut->perform_by_contour(obj, pieces->parts, dowels) : cut->perform_with_plane();
#else
        const ModelObjectPtrs& parts = dovetail ? cut->perform_with_groove(groove, rotation)
                                       : pieces ? cut->perform_by_contour(pieces->parts, dowels) : cut->perform_with_plane();
#endif
        if (parts.empty()) {
            for (size_t idx = 0; idx < obj->volumes.size(); ++idx) obj->volumes[idx]->name = origNames[idx];
            throw std::runtime_error("the cut plane misses the object");
        }

        std::vector<ModelObject*> added;
        for (const ModelObject* part : parts) added.push_back(pr().model.add_object(*part));

        // Remap paint annotations onto each added part's volumes before deleting obj
        for (ModelObject* a : added) {
            for (ModelVolume* cutVol : a->volumes) {
                // Find and strip __srcvol_K tag
                const std::string tag = "__srcvol_";
                const size_t tagPos = cutVol->name.find(tag);
                int srcIdx = -1;
                if (tagPos != std::string::npos) {
                    const size_t numStart = tagPos + tag.size();
                    size_t numEnd = numStart;
                    while (numEnd < cutVol->name.size() && std::isdigit(cutVol->name[numEnd])) ++numEnd;
                    if (numEnd > numStart) {
                        srcIdx = std::stoi(cutVol->name.substr(numStart, numEnd - numStart));
                        cutVol->name = cutVol->name.substr(0, tagPos) + cutVol->name.substr(numEnd);
                    }
                }

                if (srcIdx < 0 || size_t(srcIdx) >= sources.size()) continue;
                const VolumeSource& vs = sources[srcIdx];
                if (!vs.hasPaint || !cutVol->is_model_part() || cutVol->mesh().empty()) continue;

                // Transform cutVol mesh into original volume's local coordinates
                const Transform3d T_cut_to_orig = vs.orig->get_matrix().inverse() * cutVol->get_matrix();
                TriangleMesh localMesh(cutVol->mesh());
                localMesh.transform(T_cut_to_orig);

                // Detect cut cap triangles: vertices on the cut plane with normal facing along cut plane normal
                const Transform3d world_matrix = instance_matrix * cutVol->get_matrix();
                auto isCap = [&](size_t t) -> bool {
                    const auto& tri = cutVol->mesh().its.indices[t];
                    const Vec3d va = world_matrix * cutVol->mesh().its.vertices[tri[0]].cast<double>() + offset;
                    const Vec3d vb = world_matrix * cutVol->mesh().its.vertices[tri[1]].cast<double>() + offset;
                    const Vec3d vc = world_matrix * cutVol->mesh().its.vertices[tri[2]].cast<double>() + offset;
                    for (const Vec3d* v : {&va, &vb, &vc})
                        if (std::abs(normal.dot(*v - centre)) > CUT_PLANE_TOLERANCE) return false;
                    const Vec3d n = (vb - va).cross(vc - va);
                    const double len = n.norm();
                    return len > 1e-12 && (std::abs(n.dot(normal)) / len) > CUT_PLANE_NORMAL_TOLERANCE;
                };

                // recoverSmallPatches is false for Cut (mesh density is preserved; avoids bleeding from other cut half)
                if (!vs.orig->supported_facets.empty())
                    paint::remapAnnotation(*vs.src, vs.orig->supported_facets, cutVol->supported_facets, localMesh, isCap, false);
                if (!vs.orig->seam_facets.empty())
                    paint::remapAnnotation(*vs.src, vs.orig->seam_facets, cutVol->seam_facets, localMesh, isCap, false);
                if (!vs.orig->mmu_segmentation_facets.empty())
                    paint::remapAnnotation(*vs.src, vs.orig->mmu_segmentation_facets, cutVol->mmu_segmentation_facets, localMesh, isCap, false);
                if (!vs.orig->fuzzy_skin_facets.empty())
                    paint::remapAnnotation(*vs.src, vs.orig->fuzzy_skin_facets, cutVol->fuzzy_skin_facets, localMesh, isCap, false);
            }
        }

        pr().model.delete_object(size_t(o));
        for (ModelObject* a : added) a->ensure_on_bed();
        return ok({{"objects", added.size()}});
    });
}

// Mirrors instance i of object o along axis 0 (X), 1 (Y) or 2 (Z).
std::string mirrorInstance(int o, int i, int axis) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
        if (axis < 0 || axis > 2) throw std::runtime_error("bad axis");
        ModelInstance* inst = obj->instances[i];
        inst->set_mirror(Axis(axis), -inst->get_mirror(Axis(axis)));
        obj->invalidate_bounding_box();
        obj->ensure_on_bed();
        return ok();
    });
}

// Plates are laid out on a grid whose column count depends on the number of
// plates; changing the count moves every instance along with its plate.
void relayout(int newCount) {
    engine::Project& p = pr();
    struct Move { ModelInstance* inst; int plate; };
    std::vector<Move> moves;
    for (ModelObject* obj : p.model.objects)
        for (ModelInstance* inst : obj->instances) moves.push_back({inst, p.plateOf(*inst)});
    std::vector<Vec2d> before;
    for (const Move& m : moves) before.push_back(m.plate >= 0 ? p.plateOrigin(m.plate) : Vec2d::Zero());
    p.plateCount = newCount;
    for (size_t k = 0; k < moves.size(); ++k) {
        if (moves[k].plate < 0) continue;
        const Vec2d d = p.plateOrigin(moves[k].plate) - before[k];
        moves[k].inst->set_offset(moves[k].inst->get_offset() + Vec3d(d.x(), d.y(), 0));
    }
}

// Adds an empty plate after the last one.
std::string addPlate() {
    return guarded([&] {
        relayout(pr().plateCount + 1);
        return ok({{"plate", pr().plateCount - 1}});
    });
}

// Deletes plate `plate` and everything on it; later plates move up one place.
std::string deletePlate(int plate) {
    return guarded([&] {
        engine::Project& p = pr();
        if (p.plateCount <= 1) throw std::runtime_error("the last plate can't be deleted");
        if (plate < 0 || plate >= p.plateCount) throw std::runtime_error("no plate " + std::to_string(plate));
        // Delete the plate's instances (and objects left with none).
        for (int o = int(p.model.objects.size()) - 1; o >= 0; --o) {
            ModelObject* obj = p.model.objects[o];
            for (int i = int(obj->instances.size()) - 1; i >= 0; --i)
                if (p.plateOf(*obj->instances[i]) == plate) obj->delete_instance(size_t(i));
            if (obj->instances.empty()) p.model.delete_object(size_t(o));
        }
        // Every later plate moves one place back; all instances follow their
        // plate to its spot on the (smaller) grid.
        struct Move { ModelInstance* inst; int to; Vec2d from; };
        std::vector<Move> moves;
        for (ModelObject* obj : p.model.objects)
            for (ModelInstance* inst : obj->instances) {
                const int q = p.plateOf(*inst);
                if (q >= 0) moves.push_back({inst, q > plate ? q - 1 : q, p.plateOrigin(q)});
            }
        p.plateCount -= 1;
        for (const Move& m : moves) {
            const Vec2d d = p.plateOrigin(m.to) - m.from;
            m.inst->set_offset(m.inst->get_offset() + Vec3d(d.x(), d.y(), 0));
        }
        // The layer slider items go with their plate too.
        std::map<int, CustomGCode::Info> codes;
        for (auto& [q, info] : p.model.plates_custom_gcodes)
            if (q != plate) codes[q > plate ? q - 1 : q] = std::move(info);
        p.model.plates_custom_gcodes = std::move(codes);
        if (size_t(plate) < p.plates.size()) {
            delete p.plates[plate];
            p.plates.erase(p.plates.begin() + plate);
        }
        return ok();
    });
}

// Per-object (volume < 0) or per-part settings, like desktop's object list
// "Add settings": a JSON object of Orca option key -> value, where null removes
// the setting. Filament assignment ("extruder") has its own call.
std::string setObjectSettings(int o, int volume, const std::string& valuesJson) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        if (volume >= int(obj->volumes.size())) throw std::runtime_error("no part " + std::to_string(volume));
        ModelConfig& cfg = volume < 0 ? static_cast<ModelConfig&>(obj->config) : obj->volumes[volume]->config;
        const json values = json::parse(valuesJson);
        ConfigSubstitutionContext subs(ForwardCompatibilitySubstitutionRule::Disable);
        json errors = json::array();
        for (auto& [key, value] : values.items()) {
            if (key == "extruder") continue;
            if (value.is_null()) {
                cfg.erase(key);
                continue;
            }
            if (!print_config_def.get(key)) {
                errors.push_back(key + ": unknown option");
                continue;
            }
            try {
                cfg.set_deserialize(key, value.is_string() ? value.get<std::string>() : value.dump(), subs);
            } catch (const std::exception& e) {
                errors.push_back(key + ": " + e.what());
            }
        }
        return ok({{"errors", errors}});
    });
}

} // namespace

EMSCRIPTEN_BINDINGS(tools_api) {
    emscripten::function("setObjectSettings", &setObjectSettings);
    emscripten::function("arrangePlate", &arrangePlate);
    emscripten::function("orientObject", &orientObject);
    emscripten::function("splitObject", &splitObject);
    emscripten::function("splitParts", &splitParts);
    emscripten::function("cutObject", &cutObject);
    emscripten::function("cutPieces", &cutPieces);
    emscripten::function("mirrorInstance", &mirrorInstance);
    emscripten::function("addPlate", &addPlate);
    emscripten::function("deletePlate", &deletePlate);
}

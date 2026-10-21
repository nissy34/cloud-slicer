// Object tools from desktop Orca's Prepare toolbar, on the open project:
// arrange a plate, auto-orient, split to objects or parts, cut, mirror, and adding or
// removing plates. Each returns {ok, error?}; the page re-reads modelInfoJson().
#include "engine.hpp"

#include "libslic3r/CutUtils.hpp"
#include "libslic3r/Geometry.hpp"
#include "libslic3r/Orient.hpp"

#include <algorithm>
#include <map>

using nlohmann::json;
using namespace Slic3r;

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
// Desktop uses libnest2d's no-fit-polygon packer (arrangement::arrange); in
// this build it places every item on the same spot, so until that is tracked
// down the page gets this simpler packer.
std::string arrangePlate(int plate, double spacing) {
    return guarded([&] {
        engine::Project& p = pr();
        if (plate < 0 || plate >= p.plateCount) throw std::runtime_error("no plate " + std::to_string(plate));
        spacing = std::max(0.0, spacing);
        struct Box { ModelInstance* inst; Vec2d centre, size; int plate = 0; Vec2d at; };
        std::vector<Box> boxes;
        for (ModelObject* obj : p.model.objects)
            for (ModelInstance* inst : obj->instances) {
                if (p.plateOf(*inst) != plate) continue;
                const BoundingBoxf3 bb = obj->instance_bounding_box(*inst, false);
                boxes.push_back({inst, Vec2d(bb.center().x(), bb.center().y()), Vec2d(bb.size().x(), bb.size().y())});
            }
        if (boxes.empty()) return ok();
        std::stable_sort(boxes.begin(), boxes.end(), [](const Box& a, const Box& b) { return a.size.y() > b.size.y(); });

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

// Cuts instance i of object o with a horizontal plane at height z (mm above
// the bed), like desktop's Cut tool. keep: "both", "upper" or "lower";
// flipUpper turns the upper part over so its cut face lies on the bed.
std::string cutObject(int o, int i, double z, const std::string& keep, bool flipUpper) {
    return guarded([&] {
        ModelObject* obj = objectAt(o);
        if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
        const bool upper = keep != "lower", lower = keep != "upper";
        ModelObjectCutAttributes attrs = only_if(upper, ModelObjectCutAttribute::KeepUpper) |
                                         only_if(lower, ModelObjectCutAttribute::KeepLower) |
                                         only_if(upper && flipUpper, ModelObjectCutAttribute::FlipUpper) |
                                         only_if(upper && !flipUpper, ModelObjectCutAttribute::PlaceOnCutUpper) |
                                         ModelObjectCutAttribute::InvalidateCutInfo;
        const Vec3d offset = obj->instances[i]->get_offset();
        Cut cut(obj, i, Geometry::translation_transform(z * Vec3d::UnitZ() - offset), attrs);
        const ModelObjectPtrs& parts = cut.perform_with_plane();
        if (parts.empty()) throw std::runtime_error("the cut plane misses the object");
        std::vector<ModelObject*> added;
        for (const ModelObject* part : parts) added.push_back(pr().model.add_object(*part));
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
    emscripten::function("mirrorInstance", &mirrorInstance);
    emscripten::function("addPlate", &addPlate);
    emscripten::function("deletePlate", &deletePlate);
}

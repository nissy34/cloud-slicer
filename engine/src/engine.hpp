// Shared state of the JS-facing engine API (presets_api.cpp, model_api.cpp,
// slice_api.cpp). Everything here is Orca's own types; the page talks to them
// through embind functions that take and return JSON.
#pragma once

#include "libslic3r/calib.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"

#include <emscripten/bind.h>
#include <emscripten/threading.h>
#include <nlohmann/json.hpp>

#include <optional>
#include <string>
#include <vector>

namespace Slic3r {
class AABBMesh;
namespace Emboss { struct FontFileWithCache; }
}

namespace engine {

// The open project: every object on every plate, as Orca keeps it in the
// desktop Plater. Plates are laid out on a grid exactly like desktop
// (PartPlateList): plate i sits at column i % cols, row i / cols, with a gap of
// 1/5 of the plate size between plates, and an instance belongs to the plate
// that contains its centre.
struct Project {
    Slic3r::Model model;
    Slic3r::PlateDataPtrs plates;            // from a 3MF; empty otherwise
    Slic3r::DynamicPrintConfig fileConfig;   // project_settings.config of a 3MF
    std::string fileName;
    bool fromBambu = false;
    int plateCount = 1;
    double plateWidth = 270, plateDepth = 270;  // plate grid cell, from the file or the printer
    Slic3r::Calib_Params calib;              // calibration test being printed, set by calib_api

    int columns() const;
    Slic3r::Vec2d plateOrigin(int plate) const;
    // Plate index the instance's centre falls on, or -1 when off every plate.
    int plateOf(const Slic3r::ModelInstance& inst) const;
    void clear();
};

Project& project();

// Puts a new object on `plate`, on the free spot closest to the centre, on the
// bed, as an added model is placed (model_api.cpp).
void placeObject(Slic3r::ModelObject* obj, int plate);

// A pressure advance pattern test's G-code, put into the plate model's custom
// G-code before slicing (calib_api.cpp). Does nothing for other tests.
void addCalibrationGcodes(Slic3r::Model& model, const Slic3r::DynamicPrintConfig& cfg);

// Whether part of the object is below the bed (model_api.cpp).
bool isSunk(const Slic3r::ModelObject* obj);
// Puts an object back on the bed after an edit; with `sinking`, one that is
// below the bed stays sunk into it (desktop's sinking objects) (model_api.cpp).
void settleOnBed(Slic3r::ModelObject* obj, bool sinking);

// A primitive shape as desktop's ObjectList::create_mesh makes it, sized by the
// bed (a tenth of its larger side): Cube, Cylinder, Sphere, Cone, Disc or Torus
// (volume_api.cpp).
Slic3r::TriangleMesh shapeMesh(const std::string& shape);

// Calls a JS progress callback (percent, text) when it is a function. Orca
// reports some stages from worker threads, and an emscripten::val may only be
// touched on the thread that created it, so off-main-thread updates are dropped.
inline void report(const emscripten::val& cb, int pct, const std::string& text) {
    if (emscripten_is_main_runtime_thread() && cb.typeOf().as<std::string>() == "function") cb(pct, text);
}

// Parses a JSON object of Orca option key -> value (strings as Orca serializes
// them; numbers and booleans are accepted too) into cfg. Keys the engine does
// not know are skipped; values it cannot parse are returned as messages.
std::vector<std::string> applyJsonConfig(Slic3r::DynamicPrintConfig& cfg, const nlohmann::json& values);

nlohmann::json configToJson(const Slic3r::DynamicPrintConfig& cfg);

// A JS typed array holding a copy of v (typed_memory_view aliases wasm memory;
// slice() copies it out before v dies).
template <typename T>
emscripten::val typedCopy(const std::vector<T>& v) {
    return emscripten::val(emscripten::typed_memory_view(v.size(), v.data())).template call<emscripten::val>("slice");
}

// Whether the selected printer preset is a Bambu Lab printer (desktop sets
// Print::is_BBL_printer() from this before every slice).
bool selectedPrinterIsBambu();

// A ray from the page (the camera through the pointer) hitting a part.
struct RayHit {
    int object = -1;
    Slic3r::ModelInstance* inst = nullptr;
    Slic3r::ModelVolume* volume = nullptr;
    int facet = -1;
    Slic3r::Vec3f point;      // mesh coordinates
    Slic3r::Vec3f camera;     // ray origin, mesh coordinates
    Slic3r::Transform3d trafo;  // mesh -> world
    double distance = 0;
};

// Nearest model part on `plate` hit by the ray from s along dir (plate
// coordinates), through a ray-cast tree per part mesh (paint_api.cpp).
std::optional<RayHit> castRay(int plate, Slic3r::Vec3d s, const Slic3r::Vec3d& dir);
// The part's ray-cast tree, kept while its mesh lives (paint_api.cpp).
const Slic3r::AABBMesh& treeOf(const Slic3r::ModelVolume& v);

// Desktop's SAFE_SURFACE_OFFSET (EmbossJob.cpp): an emboss part starts this
// far into the surface it stands on, a negative part or modifier stops this far out.
constexpr float embossSurfaceOffset = 0.015f;

// Emboss shapes (text_api.cpp, svg_api.cpp): the shape's outlines, healed,
// extruded `depth` mm down from z = 0 for a part (outside) or up to it.
Slic3r::TriangleMesh embossMesh(Slic3r::EmbossShape& shape, double depth, bool outside);
// A new shape volume on object o: onto the surface the request's camera sees
// ({camera: [x, y, z]}), else flat in front of the object on the bed. Returns
// its index after the object's volumes are sorted.
int addEmbossVolume(int o, int plate, const nlohmann::json& req, Slic3r::TriangleMesh&& mesh, Slic3r::ModelVolumeType type,
                    const std::string& name, Slic3r::EmbossShape&& shape, const std::optional<Slic3r::TextConfiguration>& text);
// A shape that is a new object of its own, lying on `plate`. Returns the object's index.
int addEmbossObject(int plate, Slic3r::TriangleMesh&& mesh, const std::string& name, Slic3r::EmbossShape&& shape,
                    const std::optional<Slic3r::TextConfiguration>& text);
// The shape volume's new mesh where the old one stood (desktop's UpdateJob::update_volume).
void updateEmbossVolume(Slic3r::ModelObject* obj, Slic3r::ModelVolume* v, Slic3r::TriangleMesh&& mesh, const std::string& name);

// Shapes on a surface (surface_api.cpp). The fix a 3MF store bakes into a
// shape's transformation, put back into the volume's transformation.
void unfixShape(Slic3r::ModelVolume& v);
// Shape volume v's mesh as desktop makes it for where v stands: flat, cut out
// of the object's other parts (shape.projection.use_surface), or for a text
// set letter by letter along them (per glyph; needs the font).
Slic3r::TriangleMesh shapeMesh(const Slic3r::ModelVolume& v, Slic3r::EmbossShape& shape, bool outside,
                               const Slic3r::Emboss::FontFileWithCache* font, const Slic3r::TextConfiguration* text);
// The shape's origin moved onto the object's surface behind it (desktop's calc_surface_offset).
void moveOntoSurface(Slic3r::ModelVolume& v);
// Shape volume v remade where it stands from its text (with the font file at
// fontPath) or its SVG file (text_api.cpp).
void remakeShape(Slic3r::ModelObject* obj, Slic3r::ModelVolume* v, const std::string& fontPath);
// An SVG shape's outlines read again from its file (svg_api.cpp).
void svgOutlines(Slic3r::ModelVolume& v);

// Pauses, filament changes and custom G-code at layers of `plate` (desktop's
// layer slider items, Model::plates_custom_gcodes; plate_api.cpp):
// [{z, type: "pause"|"filament"|"custom"|"template"|"colour", filament, colour, gcode}].
nlohmann::json layerCodesJson(int plate);

// The prime tower desktop's Prepare view shows on `plate` with `cfg`, kept on
// the bed (wipe_tower_api.cpp): {show} or {show: true, x, y, width, depth,
// height, rotation, brim, filaments}. slicedDepth < 0: Orca's estimate.
nlohmann::json wipeTowerFor(const Slic3r::DynamicPrintConfig& cfg, int plate, double slicedDepth = -1);

} // namespace engine

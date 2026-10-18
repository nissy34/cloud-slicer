// Shared state of the JS-facing engine API (presets_api.cpp, model_api.cpp,
// slice_api.cpp). Everything here is Orca's own types; the page talks to them
// through embind functions that take and return JSON.
#pragma once

#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/Model.hpp"
#include "libslic3r/PrintConfig.hpp"

#include <emscripten/bind.h>
#include <emscripten/threading.h>
#include <nlohmann/json.hpp>

#include <string>
#include <vector>

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

    int columns() const;
    Slic3r::Vec2d plateOrigin(int plate) const;
    // Plate index the instance's centre falls on, or -1 when off every plate.
    int plateOf(const Slic3r::ModelInstance& inst) const;
    void clear();
};

Project& project();

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

} // namespace engine

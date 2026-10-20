// Flushing volumes: how much filament a single-nozzle printer purges when it
// changes from one filament to another (desktop's "Flushing volumes" window).
//
// Desktop keeps the table (flush_volumes_matrix, row = from, column = to) in
// the project config and fills it from the filaments' colours every time a
// filament or its colour changes (Sidebar::auto_calc_flushing_volumes, on by
// default). The engine does the same after every selection, with each engine's
// own formula: Snapmaker Orca's FlushVolCalculator, or upstream OrcaSlicer's,
// which also reads its measured colour-pair data (resources/flush, bundled into
// the upstream build) and keeps one table per nozzle. The page keeps a user's
// own values as a setting of the project on top.
#include "engine.hpp"

#include "libslic3r/Color.hpp"
#include "libslic3r/FlushVolCalc.hpp"
#include "libslic3r/PresetBundle.hpp"
#if ENGINE_UPSTREAM
#include "libslic3r/FlushVolPredictor.hpp"
#endif

#include <algorithm>
#include <cmath>

using nlohmann::json;
using namespace Slic3r;

namespace {

size_t nozzleCount(PresetBundle& b) {
#if ENGINE_UPSTREAM
    return size_t(std::max(1, b.get_printer_extruder_count()));
#else
    (void) b;
    return 1;
#endif
}

// Desktop's get_min_flush_volumes (Plater.cpp): the nozzle's volume, less what
// a long retraction when cutting already pulls out, per filament.
std::vector<int> minFlushVolumes(const DynamicPrintConfig& cfg, size_t nozzle) {
#if ENGINE_UPSTREAM
    const auto* volume = cfg.option<ConfigOptionFloatsNullable>("nozzle_volume");
    const int nozzleVolume = volume && !volume->values.empty() ? int(volume->get_at(nozzle)) : 0;
#else
    const ConfigOption* volume = cfg.option("nozzle_volume");
    const int nozzleVolume = volume ? int(volume->getFloat()) : 0;
    nozzle = 0;
#endif
    const auto* level = cfg.option<ConfigOptionInt>("enable_long_retraction_when_cut");
    const int machineLevel = level ? level->value : 0;
    const auto* machineOn = cfg.option<ConfigOptionBools>("long_retractions_when_cut");
    const bool machineActivated = machineOn && nozzle < machineOn->values.size() && machineOn->values[nozzle] == 1;
    const size_t n = cfg.option<ConfigOptionFloats>("filament_diameter")->values.size();
    auto at = [](const auto* opt, size_t i, auto fallback) {
        return opt && i < opt->values.size() ? opt->values[i] : fallback;
    };
    const auto* filamentLength = cfg.option<ConfigOptionFloats>("filament_retraction_distances_when_cut");
    const auto* printerLength = cfg.option<ConfigOptionFloats>("retraction_distances_when_cut");
    const auto* filamentOn = cfg.option<ConfigOptionBools>("filament_long_retractions_when_cut");
    const double printerRetract = at(printerLength, nozzle, 18.0);
    std::vector<int> out;
    for (size_t i = 0; i < n; ++i) {
        int retract = machineLevel && machineActivated ? int(printerRetract) : 0;
        const unsigned char activated = at(filamentOn, i, (unsigned char) 0);
        const double length = at(filamentLength, i, 18.0);
        if (activated == 0)
            retract = 0;
        else if (activated == 1 && machineLevel == LongRectrationLevel::EnableFilament)
            retract = !std::isnan(length) ? int(length) : int(printerRetract);
        out.push_back(int(nozzleVolume - PI * 1.75 * 1.75 / 4 * retract));
    }
    return out;
}

bool isSupport(PresetBundle& b, size_t filament) {
    if (filament >= b.filament_presets.size()) return false;
    const Preset* p = b.filaments.find_preset(b.filament_presets[filament]);
    const auto* opt = p ? p->config.option<ConfigOptionBools>("filament_is_support") : nullptr;
    return opt && !opt->values.empty() && opt->get_at(0);
}

} // namespace

// Whether the selected printer purges between filaments, as desktop decides
// whether to show its Flushing volumes button: a single-extruder multi-material
// printer (an AMS, MMU, CFS...) or a Bambu Lab one. Printers with a tool head
// per filament (the Snapmaker U1, tool changers, IDEX) don't flush.
bool engine::printerFlushes(PresetBundle& b) {
    const DynamicPrintConfig& printer = b.printers.get_edited_preset().config;
    const auto* semm = printer.option<ConfigOptionBool>("single_extruder_multi_material");
    return (semm && semm->value) || b.is_bbl_vendor();
}

// Fills the project's flushing volumes from the filament colours, as desktop's
// auto-calculation does, when the printer flushes. Returns what the page's
// Flushing volumes window needs: {flushes, nozzles, min: [per nozzle], max}.
json engine::autoFlushVolumes(PresetBundle& b) {
    const bool flushes = printerFlushes(b);
    const size_t nozzles = nozzleCount(b);
    json info{{"flushes", flushes}, {"nozzles", nozzles}, {"min", json::array()}, {"max", g_max_flush_volume}};
    const DynamicPrintConfig cfg = b.full_config();
    const auto* colourOpt = b.project_config.option<ConfigOptionStrings>("filament_colour");
    const std::vector<std::string> colours = colourOpt ? colourOpt->values : std::vector<std::string>{};
    const size_t n = colours.size();
    std::vector<ColorRGBA> rgba(n);
    for (size_t i = 0; i < n; ++i)
        if (!decode_color(colours[i], rgba[i])) rgba[i] = ColorRGBA::WHITE();
    auto byte = [](float v) { return (unsigned char) std::clamp(int(std::lround(v * 255.f)), 0, 255); };
    std::vector<double> matrix(n * n * nozzles, 0.0);
    for (size_t nozzle = 0; nozzle < nozzles; ++nozzle) {
        const std::vector<int> min = n ? minFlushVolumes(cfg, nozzle) : std::vector<int>{};
#if ENGINE_UPSTREAM
        const auto* datasets = cfg.option<ConfigOptionIntsNullable>("nozzle_flush_dataset");
        const int dataset = datasets && !datasets->values.empty() ? datasets->get_at(nozzle) : 0;
        // As desktop's window says: the smallest of the nozzle's and the colour data's minimum.
        const int fromData = GenericFlushPredictor(dataset).get_min_flush_volume();
        info["min"].push_back(std::min(fromData, min.empty() ? fromData : *std::min_element(min.begin(), min.end())));
#else
        info["min"].push_back(min.empty() ? 0 : *std::min_element(min.begin(), min.end()));
#endif
        if (!flushes) continue;
        for (size_t from = 0; from < n; ++from)
            for (size_t to = 0; to < n; ++to) {
                if (from == to) continue;
                int volume = 0;
                if (isSupport(b, to))
                    volume = g_flush_volume_to_support;
                else {
#if ENGINE_UPSTREAM
                    FlushVolCalculator calc(from < min.size() ? min[from] : 0, g_max_flush_volume, dataset);
#else
                    FlushVolCalculator calc(from < min.size() ? min[from] : 0, g_max_flush_volume);
#endif
                    const ColorRGBA& a = rgba[from];
                    const ColorRGBA& c = rgba[to];
                    volume = calc.calc_flush_vol(byte(a.a()), byte(a.r()), byte(a.g()), byte(a.b()), byte(c.a()), byte(c.r()), byte(c.g()), byte(c.b()));
                    if (isSupport(b, from)) volume = std::max(volume, g_min_flush_volume_from_support);
                }
                matrix[nozzle * n * n + from * n + to] = volume;
            }
    }
    if (flushes && n > 0) {
        b.project_config.option<ConfigOptionFloats>("flush_volumes_matrix", true)->values = std::move(matrix);
#if ENGINE_UPSTREAM
        // One multiplier per nozzle, as desktop keeps them.
        auto* multiplier = b.project_config.option<ConfigOptionFloats>("flush_multiplier", true);
        if (multiplier->values.size() != nozzles) multiplier->values.resize(nozzles, multiplier->values.empty() ? 1.0 : multiplier->values.back());
#endif
    }
    return info;
}

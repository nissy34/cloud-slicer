// Slicing one plate of the open project with a complete Orca config: the same
// Print::apply / process / export_gcode sequence desktop's background slicing
// runs, with nothing substituted in between.
#include "engine.hpp"

#include "libslic3r/BuildVolume.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/Print.hpp"

#include <cmath>

using nlohmann::json;
using namespace Slic3r;

namespace {

// Orca's wipe tower reads flush_volumes_matrix as N x N for N filaments without
// bounds checks; desktop keeps it sized as filaments are added. A config
// assembled outside desktop (or edited by hand) may not be, so pad it the way
// desktop seeds new entries.
void padFlushMatrix(DynamicPrintConfig& cfg) {
    const auto* colours = cfg.option<ConfigOptionStrings>("filament_colour");
    const size_t n = colours ? std::max<size_t>(1, colours->values.size()) : 1;
    auto* m = cfg.option<ConfigOptionFloats>("flush_volumes_matrix", true);
    if (m->values.size() >= n * n) return;
    const size_t old = size_t(std::lround(std::sqrt(double(m->values.size()))));
    const bool square = old * old == m->values.size();
    std::vector<double> v(n * n, 0.0);
    for (size_t i = 0; i < n; ++i)
        for (size_t j = 0; j < n; ++j)
            v[i * n + j] = i == j ? 0.0 : (square && i < old && j < old) ? m->values[i * old + j] : 280.0;
    m->values = std::move(v);
}

// Copy of the project holding only `plate`'s instances, moved so the plate's
// front-left corner is the origin (what desktop's PartPlate hands to Print).
Model plateModel(int plate) {
    const engine::Project& pr = engine::project();
    Model m(pr.model);
    const Vec2d origin = pr.plateOrigin(plate);
    for (int o = int(m.objects.size()) - 1; o >= 0; --o) {
        ModelObject* obj = m.objects[o];
        const ModelObject* src = pr.model.objects[o];
        for (int i = int(obj->instances.size()) - 1; i >= 0; --i) {
            if (pr.plateOf(*src->instances[i]) != plate) obj->delete_instance(size_t(i));
            else obj->instances[i]->set_offset(obj->instances[i]->get_offset() - Vec3d(origin.x(), origin.y(), 0));
        }
        if (obj->instances.empty()) m.delete_object(size_t(o));
    }
    return m;
}

// Slice `plate` with `configJson` (key -> serialized value, e.g. from
// presetsFullConfig plus edits) and write the G-code to outputPath.
// Returns {success, cancelled, error, warnings, gcodePath, totalLayers,
// estimatedTimeSeconds, filamentMm: {"<1-based filament>": mm}, totalFilamentMm,
// totalFilamentGrams, objectsOutside}.
std::string sliceWithConfig(const std::string& configJson, int plate, const std::string& outputPath, emscripten::val onProgress) {
    json res{{"success", false}, {"cancelled", false}, {"error", ""}};
    json warnings = json::array();
    try {
        Model model = plateModel(plate);
        if (model.objects.empty()) throw std::runtime_error("This plate is empty.");

        DynamicPrintConfig cfg;
        cfg.apply(FullPrintConfig::defaults());
        for (const std::string& w : engine::applyJsonConfig(cfg, json::parse(configJson))) warnings.push_back(w);
        padFlushMatrix(cfg);

        for (ModelObject* o : model.objects) o->ensure_on_bed();
        const BuildVolume volume(cfg.option<ConfigOptionPoints>("printable_area")->values, cfg.opt_float("printable_height"));
        model.update_print_volume_state(volume);
        json outside = json::array();
        for (const ModelObject* o : model.objects)
            for (const ModelInstance* i : o->instances)
                if (i->print_volume_state != ModelInstancePVS_Inside) outside.push_back(o->name);
        res["objectsOutside"] = outside;
        if (!outside.empty()) throw std::runtime_error("Some objects are outside the printable area: " + outside.dump());

        engine::report(onProgress, 2, "Preparing");
        Print print;
        print.is_BBL_printer() = engine::selectedPrinterIsBambu();  // as desktop does before slicing
        print.set_calib_params(engine::project().calib);
        print.apply(model, cfg);
        const StringObjectException err = print.validate();
        if (!err.string.empty()) throw std::runtime_error(err.string);

        int high = 2;
        print.set_status_callback([&](const PrintBase::SlicingStatus& s) {
            const int pct = 2 + int(s.percent * 0.9);
            if (pct > high) high = pct;
            engine::report(onProgress, high, s.text);
        });
        print.process();

        engine::report(onProgress, 93, "Generating G-code");
        GCodeProcessorResult result;
        print.export_gcode(outputPath, &result, nullptr);

        int layers = 0;
        for (const PrintObject* o : print.objects()) layers = std::max(layers, int(o->total_layer_count()));
        const PrintStatistics& stats = print.print_statistics();
        const float seconds = result.print_statistics.modes[size_t(PrintEstimatedStatistics::ETimeMode::Normal)].time;
        json mm = json::object();
        // filament_stats holds volumes (mm^3); report length like totalFilamentMm.
        const auto* diameters = cfg.option<ConfigOptionFloats>("filament_diameter");
        for (const auto& [id, volume] : stats.filament_stats) {
            const double d = diameters && !diameters->values.empty() ? diameters->get_at(id) : 1.75;
            mm[std::to_string(id + 1)] = volume / (M_PI * d * d / 4.);
        }
        res["success"] = true;
        res["gcodePath"] = outputPath;
        res["totalLayers"] = layers;
        res["estimatedTimeSeconds"] = std::isfinite(seconds) ? seconds : 0.f;
        res["filamentMm"] = mm;
        res["totalFilamentMm"] = stats.total_used_filament;
        res["totalFilamentGrams"] = stats.total_weight;
        engine::report(onProgress, 100, "Done");
    } catch (const CanceledException&) {
        res["cancelled"] = true;
        res["error"] = "cancelled";
    } catch (const std::exception& e) {
        res["error"] = e.what();
    }
    res["warnings"] = warnings;
    return res.dump();
}

} // namespace

EMSCRIPTEN_BINDINGS(slice_api) {
    emscripten::function("sliceWithConfig", &sliceWithConfig);
}

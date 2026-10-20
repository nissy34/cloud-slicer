// Slicing one plate of the open project with a complete Orca config: the same
// Print::apply / process / export_gcode sequence desktop's background slicing
// runs, with nothing substituted in between.
#include "engine.hpp"

#include "libslic3r/BuildVolume.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/GCode/ThumbnailData.hpp"
#include "libslic3r/Print.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <thread>

using nlohmann::json;
using namespace Slic3r;

namespace {

// Cancelling a running slice. Desktop's UI thread calls Print::cancel() while
// the background thread slices; here the slice runs on the engine worker's
// thread, which nothing can reach while it is busy. So the page writes to
// these two cells, which live in the engine's shared memory
// (sliceCancelFlag): [0] the request id the page wants cancelled, [1] the id
// of the slice now running (the worker sets it). A watcher thread stands in
// for desktop's UI thread: it calls Print::cancel() once the page asks, and
// slicing stops at Orca's own next throw_if_canceled(), on whichever thread
// gets there.
std::atomic<int32_t> cancelCells[2];
static_assert(sizeof(cancelCells) == 2 * sizeof(int32_t) && std::atomic<int32_t>::is_always_lock_free);

bool cancelRequested() {
    const int32_t running = cancelCells[1].load(std::memory_order_acquire);
    return running != 0 && cancelCells[0].load(std::memory_order_acquire) == running;
}

// Watches the cancel cells for the length of a slice.
class CancelWatch {
public:
    explicit CancelWatch(Print& print)
        : m_thread([this, &print] {
              while (!m_done.load(std::memory_order_acquire)) {
                  if (cancelRequested()) print.cancel();
                  std::this_thread::sleep_for(std::chrono::milliseconds(20));
              }
          }) {}
    ~CancelWatch() {
        m_done.store(true, std::memory_order_release);
        m_thread.join();
    }

private:
    std::atomic<bool> m_done{false};
    std::thread m_thread;
};

emscripten::val sliceCancelFlag() {
    return emscripten::val(emscripten::typed_memory_view(2, reinterpret_cast<int32_t*>(cancelCells)));
}

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

// Plate pictures the page rendered (desktop draws them with OpenGL; the engine
// has none). Each is {width, height, pixels}: RGBA rows bottom to top, as
// glReadPixels returns them and Orca's thumbnail encoders expect.
ThumbnailsList readThumbnails(const emscripten::val& images) {
    ThumbnailsList out;
    if (images.isUndefined() || images.isNull()) return out;
    const unsigned n = images["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i) {
        const emscripten::val img = images[i];
        ThumbnailData t;
        t.set(img["width"].as<unsigned>(), img["height"].as<unsigned>());
        std::vector<unsigned char> px = emscripten::convertJSArrayToNumberVector<unsigned char>(img["pixels"]);
        if (px.size() != t.pixels.size()) continue;
        t.pixels = std::move(px);
        out.push_back(std::move(t));
    }
    return out;
}

// Desktop renders each size the printer's `thumbnails` option asks for. The
// page renders the same list, so a size is normally there as is; otherwise the
// largest picture is resampled (bilinear), so a size never goes missing.
ThumbnailData thumbnailAt(const ThumbnailsList& images, unsigned w, unsigned h) {
    const ThumbnailData* best = nullptr;
    for (const ThumbnailData& t : images) {
        if (t.width == w && t.height == h) return t;
        if (!best || t.width * t.height > best->width * best->height) best = &t;
    }
    ThumbnailData out;
    if (!best || w == 0 || h == 0) return out;
    out.set(w, h);
    for (unsigned y = 0; y < h; ++y)
        for (unsigned x = 0; x < w; ++x) {
            const double sx = std::clamp((x + 0.5) * best->width / w - 0.5, 0.0, best->width - 1.0);
            const double sy = std::clamp((y + 0.5) * best->height / h - 0.5, 0.0, best->height - 1.0);
            const unsigned x0 = unsigned(sx), y0 = unsigned(sy);
            const unsigned x1 = std::min(x0 + 1, best->width - 1), y1 = std::min(y0 + 1, best->height - 1);
            const double fx = sx - x0, fy = sy - y0;
            for (int c = 0; c < 4; ++c) {
                auto at = [&](unsigned px, unsigned py) { return double(best->pixels[(py * best->width + px) * 4 + c]); };
                const double v = (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
                out.pixels[(y * w + x) * 4 + c] = (unsigned char) std::lround(v);
            }
        }
    return out;
}

// Orca's SlicingErrors holds one error per object that can't be printed; its
// own text is just "Errors". Desktop shows each, on the object it names.
std::string explain(const SlicingErrors& e, const Print& print) {
    std::string all;
    for (const SlicingError& one : e.errors_) {
        std::string name;
        for (const PrintObject* o : print.objects())
            if (o->id().id == one.objectId()) name = o->model_object()->name;
        all += (all.empty() ? "" : "\n") + (name.empty() ? std::string(one.what()) : name + ": " + one.what());
    }
    return all.empty() ? std::string(e.what()) : all;
}

// Slice `plate` with `configJson` (key -> serialized value, e.g. from
// presetsFullConfig plus edits) and write the G-code to outputPath.
// Returns {success, cancelled, error, warnings, gcodePath, totalLayers,
// estimatedTimeSeconds, filamentMm: {"<1-based filament>": mm}, totalFilamentMm,
// totalFilamentGrams, objectsOutside, wipeTowerDepth (when it made a prime tower)}.
// `thumbnails` (optional) holds the plate pictures for the G-code; Orca's own
// GCode export encodes and places them, in the formats `thumbnails` asks for.
std::string sliceWithConfig(const std::string& configJson, int plate, const std::string& outputPath, emscripten::val onProgress,
                            emscripten::val thumbnails) {
    json res{{"success", false}, {"cancelled", false}, {"error", ""}};
    json warnings = json::array();
    try {
        const ThumbnailsList pictures = readThumbnails(thumbnails);
        Model model = plateModel(plate);
        if (model.objects.empty()) throw std::runtime_error("This plate is empty.");

        DynamicPrintConfig cfg;
        cfg.apply(FullPrintConfig::defaults());
        for (const std::string& w : engine::applyJsonConfig(cfg, json::parse(configJson))) warnings.push_back(w);
        padFlushMatrix(cfg);
        // wipe_tower_x/y hold one position per plate. The Print below slices as
        // plate 0, so it gets this plate's, kept on the bed the way desktop
        // keeps it whenever it shows the plate.
        const json tower = engine::wipeTowerFor(cfg, plate);
        for (const char* axis : {"x", "y"}) {
            const std::string key = std::string("wipe_tower_") + axis;
            auto* opt = cfg.option<ConfigOptionFloats>(key, true);
            const double v = tower.value("show", false) ? tower[axis].get<double>() : opt->get_at(plate);
            opt->values = {v};
        }

        for (ModelObject* o : model.objects) o->ensure_on_bed();
#if ENGINE_UPSTREAM
        // Upstream also takes each extruder's own area (none here: the whole bed).
        const BuildVolume volume(cfg.option<ConfigOptionPoints>("printable_area")->values, cfg.opt_float("printable_height"), {}, {});
#else
        const BuildVolume volume(cfg.option<ConfigOptionPoints>("printable_area")->values, cfg.opt_float("printable_height"));
#endif
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
        // Desktop's PartPlate sets this; Print leaves it uninitialised (brim and
        // skirt read it). plateModel already put the plate's corner at the origin.
        print.set_plate_origin(Vec3d::Zero());
        print.set_calib_params(engine::project().calib);
        print.apply(model, cfg);
        const StringObjectException err = print.validate();
        if (!err.string.empty()) throw std::runtime_error(err.string);

        const CancelWatch cancelWatch(print);
        if (cancelRequested()) throw CanceledException();
        int high = 2;
        // Orca reports some stages from its worker threads; only the engine's
        // own thread may call into the page.
        print.set_status_callback([&](const PrintBase::SlicingStatus& s) {
            if (!emscripten_is_main_runtime_thread()) return;
            const int pct = 2 + int(s.percent * 0.9);
            if (pct > high) high = pct;
            engine::report(onProgress, high, s.text);
        });
        try {
            print.process();
        } catch (const SlicingErrors& e) {
            throw std::runtime_error(explain(e, print));
        }

        engine::report(onProgress, 93, "Generating G-code");
        GCodeProcessorResult result;
        ThumbnailsGeneratorCallback thumbnailCb = nullptr;
        if (!pictures.empty())
            thumbnailCb = [&pictures](const ThumbnailsParams& params) {
                ThumbnailsList list;
                for (const Vec2d& size : params.sizes) list.push_back(thumbnailAt(pictures, unsigned(size.x()), unsigned(size.y())));
                return list;
            };
        try {
            print.export_gcode(outputPath, &result, thumbnailCb);
        } catch (const SlicingErrors& e) {
            throw std::runtime_error(explain(e, print));
        }
        // A cancel that landed in code which caught the exception itself.
        if (cancelRequested()) throw CanceledException();

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
        // The tower this slice made, for the Prepare view (desktop shows its
        // real depth once the plate is sliced).
        if (print.has_wipe_tower() && print.is_step_done(psWipeTower) && !print.wipe_tower_data().tool_changes.empty())
            res["wipeTowerDepth"] = print.wipe_tower_data().depth;
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
    emscripten::function("sliceCancelFlag", &sliceCancelFlag);
}

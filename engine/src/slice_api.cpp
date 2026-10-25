// Slicing one plate of the open project with a complete Orca config: the same
// Print::apply / process / export_gcode sequence desktop's background slicing
// runs, with nothing substituted in between.
#include "engine.hpp"

#include "libslic3r/BuildVolume.hpp"
#include "libslic3r/ClipperUtils.hpp"
#include "libslic3r/Format/bbs_3mf.hpp"
#include "libslic3r/GCode/GCodeProcessor.hpp"
#include "libslic3r/GCode/ThumbnailData.hpp"
#include "libslic3r/Layer.hpp"
#include "libslic3r/Print.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <mutex>
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
// desktop seeds new entries. Upstream OrcaSlicer keeps one N x N block per
// entry of flush_multiplier (per nozzle group) and refuses any other size.
void padFlushMatrix(DynamicPrintConfig& cfg) {
#if ENGINE_UPSTREAM
    // Upstream sizes painted-colour layers by filament_colour and reads them by
    // filament_diameter; a page that sends fewer colours than filaments (it
    // keeps one filament per tool head) would read past the end. Pad them.
    if (const auto* diameters = cfg.option<ConfigOptionFloats>("filament_diameter"))
        for (const char* key : {"filament_colour", "filament_multi_colour"})
            if (auto* c = cfg.option<ConfigOptionStrings>(key); c && !c->values.empty() && c->values.size() < diameters->values.size())
                c->values.resize(diameters->values.size(), c->values.back());
#endif
    const auto* colours = cfg.option<ConfigOptionStrings>("filament_colour");
    const size_t n = colours ? std::max<size_t>(1, colours->values.size()) : 1;
#if ENGINE_UPSTREAM
    const auto* multiplier = cfg.option<ConfigOptionFloats>("flush_multiplier");
    const size_t blocks = multiplier ? std::max<size_t>(1, multiplier->values.size()) : 1;
#else
    const size_t blocks = 1;
#endif
    auto* m = cfg.option<ConfigOptionFloats>("flush_volumes_matrix", true);
    if (blocks == 1 ? m->values.size() >= n * n : m->values.size() == n * n * blocks) return;
    // The old matrix, as one square block (or the first of several).
    size_t old = size_t(std::lround(std::sqrt(double(m->values.size()) / double(blocks))));
    if (old * old * blocks != m->values.size()) old = size_t(std::lround(std::sqrt(double(m->values.size()))));
    const bool square = old > 0 && old * old <= m->values.size();
    std::vector<double> v(n * n * blocks, 0.0);
    for (size_t b = 0; b < blocks; ++b) {
        const size_t from = (square && (b + 1) * old * old <= m->values.size()) ? b * old * old : 0;
        for (size_t i = 0; i < n; ++i)
            for (size_t j = 0; j < n; ++j)
                v[b * n * n + i * n + j] = i == j ? 0.0 : (square && i < old && j < old) ? m->values[from + i * old + j] : 280.0;
    }
    m->values = std::move(v);
}

// Upstream OrcaSlicer prints filament N with extruder N on a printer with
// several heads (desktop fixes one filament per head there) and reads the
// extruder settings past their end when a project has more filaments, so a
// slice crashed. Give it one extruder per filament, as desktop's printer
// "Extruders" count does (the extra ones copy the last head). Snapmaker Orca
// slices such projects too; the U1 maps the file's tools onto its heads when
// the print is sent (SET_PRINT_EXTRUDER_MAP).
void extruderPerFilament(DynamicPrintConfig& cfg) {
#if ENGINE_UPSTREAM
    const auto* nozzles = cfg.option<ConfigOptionFloats>("nozzle_diameter");
    const auto* filaments = cfg.option<ConfigOptionFloats>("filament_diameter");
    if (!nozzles || !filaments || nozzles->values.size() <= 1 || cfg.opt_bool("single_extruder_multi_material")) return;
    if (filaments->values.size() > nozzles->values.size()) cfg.set_num_extruders(unsigned(filaments->values.size()));
#endif
}

// Copy of the project holding only `plate`'s instances, moved so the plate's
// front-left corner is the origin (what desktop's PartPlate hands to Print).
// It is marked as that plate, as desktop does before slicing a plate, so Print
// uses that plate's pauses, colour changes and custom G-code.
Model plateModel(int plate) {
    const engine::Project& pr = engine::project();
    Model m(pr.model);
    m.curr_plate_index = plate;
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

// Desktop's Print, with the G-code export marked as the running step. Orca's
// export adds warnings (empty layers, priming regions) to the active Print
// step, and neither desktop nor Print::export_gcode starts one, so they would
// land in m_state[-1]: past the array, onto the Print's other fields.
class SlicePrint : public Print {
public:
    std::string exportGcode(const std::string& path, GCodeProcessorResult* result, ThumbnailsGeneratorCallback thumbnails) {
        set_started(psGCodeExport);
        std::string out = export_gcode(path, result, thumbnails);
        set_done(psGCodeExport);
        return out;
    }
    // Desktop's G-code file name: filename_format through Orca's template
    // language, with this slice's statistics ({total_weight}, {print_time} ...),
    // dates, {if} and sums, as plate `plate` of the project. `base` is
    // {input_filename_base}. Call after the export.
    std::string fileName(const std::string& base, int plate, const std::string& plateName) {
        set_plate_index(plate);
        set_plate_name(plateName);
        const std::string name = output_filename(base);
        set_plate_index(0);
        return name;
    }
};

// Warnings for the user from one slice, the ones desktop shows as
// notifications: validation's warning, each Print / PrintObject step's
// warnings (Orca reports them through the status callback, from whichever
// thread runs the step, including the G-code export), the G-code path
// conflict check, and settings that could not be read. Each is
// {text, level: "warning" | "serious", object?: name, option?: key}.
class Warnings {
public:
    void add(const std::string& text, bool serious, const std::string& object = {}, const std::string& option = {}) {
        if (text.empty()) return;
        std::scoped_lock lock(m_mutex);
        for (const json& w : m_list)
            if (w["text"] == text && w.value("object", "") == object) return;
        json w{{"text", text}, {"level", serious ? "serious" : "warning"}};
        if (!object.empty()) w["object"] = object;
        if (!option.empty()) w["option"] = option;
        m_list.push_back(std::move(w));
    }
    // A step warning from the status callback. Desktop shows empty layers
    // (and the first layers they replace) as serious, the rest as warnings.
    void add(const PrintBase::SlicingStatus& s, const Print& print) {
        std::string object;
        if (s.flags & PrintBase::SlicingStatus::UPDATE_PRINT_OBJECT_STEP_WARNINGS)
            for (const PrintObject* o : print.objects())
                if (o->id() == s.warning_object_id) object = o->model_object()->name;
        add(s.text, s.message_type == PrintStateBase::SlicingEmptyGcodeLayers || s.message_type == PrintStateBase::SlicingReplaceInitEmptyLayers,
            object);
    }
    json list() const {
        std::scoped_lock lock(m_mutex);
        return m_list;
    }

private:
    mutable std::mutex m_mutex;
    json m_list = json::array();
};

// Desktop's text for a G-code path conflict (GLCanvas3D, EWarning::GCodeConflict).
// Its layer number counts the G-code's layers up to the conflict's height.
std::string conflictText(const ConflictResult& c, const Print& print) {
    std::vector<double> zs;
    for (const PrintObject* o : print.objects()) {
        for (const Layer* l : o->layers()) zs.push_back(l->print_z);
        for (const SupportLayer* l : o->support_layers()) zs.push_back(l->print_z);
    }
    std::sort(zs.begin(), zs.end());
    zs.erase(std::unique(zs.begin(), zs.end(), [](double a, double b) { return std::abs(a - b) < EPSILON; }), zs.end());
    const long layer = std::distance(zs.begin(), std::upper_bound(zs.begin(), zs.end(), c._height + EPSILON));
    char text[512];
    std::snprintf(text, sizeof text,
                  "Conflicts of G-code paths have been found at layer %ld, z = %.2lf mm. Please separate the conflicted objects farther (%s <-> %s).",
                  layer, c._height, c._objName1.c_str(), c._objName2.c_str());
    return text;
}

// The sliced plate as a .gcode.3mf, the file desktop downloads and sends to a
// Bambu Lab printer, or when the printer's use_3mf is on (Plater::send_gcode:
// export_3mf with Silence | SkipModel | WithGcode | SkipAuxiliary): every
// plate's entry, this one with
// its G-code, time, weight and filaments (slice_info.config) and the largest
// plate picture, as Metadata/plate_<plate + 1>.*.
bool writeGcode3mf(const std::string& path, int plate, const std::string& gcodePath, DynamicPrintConfig& cfg, GCodeProcessorResult& result,
                   const Print& print, const ThumbnailsList& pictures) {
    engine::Project& pr = engine::project();
    PlateDataPtrs plates;
    const std::string nozzles = cfg.has("nozzle_diameter") ? cfg.opt_serialize("nozzle_diameter") : std::string();
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
    PlateData* d = plates[plate];
    d->gcode_file = gcodePath;
    d->is_sliced_valid = true;
    d->gcode_prediction = std::to_string(int(result.print_statistics.modes[size_t(PrintEstimatedStatistics::ETimeMode::Normal)].time));
    d->toolpath_outside = result.toolpath_outside;
    d->is_label_object_enabled = result.label_object_enabled;
    if (print.print_statistics().total_weight != 0.0) {
        char weight[32];
        std::snprintf(weight, sizeof weight, "%.2f", print.print_statistics().total_weight);
        d->gcode_weight = weight;
    }
    d->is_support_used = print.is_support_used();
    d->parse_filament_info(&result);

    std::vector<ThumbnailData> thumbs(plates.size());
    const ThumbnailData* largest = nullptr;
    for (const ThumbnailData& t : pictures)
        if (t.is_valid() && (!largest || t.width * t.height > largest->width * largest->height)) largest = &t;
    if (largest) thumbs[plate] = *largest;
    std::vector<ThumbnailData*> thumbPtrs;
    for (ThumbnailData& t : thumbs) thumbPtrs.push_back(&t);

    StoreParams params;
    params.path = path.c_str();
    params.model = &pr.model;
    params.plate_data_list = plates;
    params.export_plate_idx = plate;
    params.config = &cfg;
    params.thumbnail_data = thumbPtrs;
    params.strategy = SaveStrategy::Silence | SaveStrategy::SkipModel | SaveStrategy::WithGcode | SaveStrategy::SkipAuxiliary | SaveStrategy::Zip64;
    const bool saved = store_bbs_3mf(params);
    release_PlateData_list(plates);
    return saved;
}

// Slice `plate` with `configJson` (key -> serialized value, e.g. from
// presetsFullConfig plus edits) and write the G-code to outputPath.
// Returns {success, cancelled, error, warnings (see Warnings), gcodePath, totalLayers,
// estimatedTimeSeconds, prepareSeconds, filamentMm: {"<1-based filament>": mm}, totalFilamentMm,
// totalFilamentGrams, totalCost, filamentParts: {"<1-based filament>": {model|support|tower|flushed:
// {mm, g}}}, objectsOutside, wipeTowerDepth (when it made a prime tower)}.
// `thumbnails` (optional) holds the plate pictures for the G-code; Orca's own
// GCode export encodes and places them, in the formats `thumbnails` asks for.
// `name` is the project or model name for the file name: with it, the result
// has `fileName` (desktop's, from filename_format), and a template that can't
// be read adds a warning instead. When the printer's use_3mf is on, or it is a
// Bambu Lab printer, the plate is also written as a .gcode.3mf at outputPath +
// ".3mf" (result.gcode3mfPath).
std::string sliceWithConfig(const std::string& configJson, int plate, const std::string& outputPath, emscripten::val onProgress,
                            emscripten::val thumbnails, std::string name) {
    json res{{"success", false}, {"cancelled", false}, {"error", ""}};
    Warnings warnings;
    try {
        const ThumbnailsList pictures = readThumbnails(thumbnails);
        Model model = plateModel(plate);
        if (model.objects.empty()) throw std::runtime_error("This plate is empty.");

        DynamicPrintConfig cfg;
        cfg.apply(FullPrintConfig::defaults());
        for (const std::string& w : engine::applyJsonConfig(cfg, json::parse(configJson))) warnings.add("A setting could not be used: " + w, false);
        // The plate's own settings (desktop's Plate settings) over the project's.
        engine::applyPlateSettings(cfg, plate);
        extruderPerFilament(cfg);
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

        // Sunk objects stay sunk; Orca slices only what is above the bed.
        for (ModelObject* o : model.objects) engine::settleOnBed(o, true);
        engine::addCalibrationGcodes(model, cfg);
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
        SlicePrint print;
        print.is_BBL_printer() = engine::selectedPrinterIsBambu();  // as desktop does before slicing
        // Desktop's PartPlate sets this; Print leaves it uninitialised (brim and
        // skirt read it). plateModel already put the plate's corner at the origin.
        print.set_plate_origin(Vec3d::Zero());
        print.set_calib_params(engine::project().calib);
        print.apply(model, cfg);
        StringObjectException warning;
        const StringObjectException err = print.validate(&warning);
        if (!err.string.empty()) throw std::runtime_error(err.string);
        {
            const auto* po = dynamic_cast<const PrintObjectBase*>(warning.object);
            const ModelObject* mo = po ? po->model_object() : dynamic_cast<const ModelObject*>(warning.object);
            warnings.add(warning.string, false, mo ? mo->name : std::string(), warning.opt_key);
        }

        const CancelWatch cancelWatch(print);
        if (cancelRequested()) throw CanceledException();
        int high = 2;
        // Orca reports some stages from its worker threads; only the engine's
        // own thread may call into the page. Warnings come from any of them.
        print.set_status_callback([&](const PrintBase::SlicingStatus& s) {
            if (s.flags & (PrintBase::SlicingStatus::UPDATE_PRINT_STEP_WARNINGS | PrintBase::SlicingStatus::UPDATE_PRINT_OBJECT_STEP_WARNINGS)) {
                warnings.add(s, print);
                return;
            }
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
            print.exportGcode(outputPath, &result, thumbnailCb);
        } catch (const SlicingErrors& e) {
            throw std::runtime_error(explain(e, print));
        }
        // A cancel that landed in code which caught the exception itself.
        if (cancelRequested()) throw CanceledException();
        if (result.conflict_result) warnings.add(conflictText(*result.conflict_result, print), true);

        // Layers as the G-code has them ("; total layer number"), counted as
        // GCode::_do_export does: one per height printed, so object and
        // support layers at the same height count once (total_layer_count()
        // adds them up); printed object by object, each object's layers.
        const auto heights = [](const PrintObject* o, std::vector<coordf_t>& zs) {
            for (const Layer* l : o->layers()) zs.push_back(l->print_z);
            for (const SupportLayer* l : o->support_layers()) zs.push_back(l->print_z);
        };
        const auto distinct = [](std::vector<coordf_t> zs) {
            std::sort(zs.begin(), zs.end());
            int n = 0;
            for (size_t i = 0; i < zs.size(); ++i)
                if (i == 0 || zs[i] - zs[i - 1] >= EPSILON) ++n;
            return n;
        };
        int layers = 0;
        if (print.config().print_sequence == PrintSequence::ByObject) {
            for (const PrintObject* o : print.objects()) {
                std::vector<coordf_t> zs;
                heights(o, zs);
                layers += int(o->instances().size()) * distinct(zs);
            }
        } else {
            std::vector<coordf_t> zs;
            for (const PrintObject* o : print.objects()) heights(o, zs);
            layers = distinct(zs);
        }
        const PrintStatistics& stats = print.print_statistics();
        const auto& normal = result.print_statistics.modes[size_t(PrintEstimatedStatistics::ETimeMode::Normal)];
        const float seconds = normal.time;
        json mm = json::object();
        // filament_stats holds volumes (mm^3); report length like totalFilamentMm.
        const auto* diameters = cfg.option<ConfigOptionFloats>("filament_diameter");
        for (const auto& [id, volume] : stats.filament_stats) {
            const double d = diameters && !diameters->values.empty() ? diameters->get_at(id) : 1.75;
            mm[std::to_string(id + 1)] = volume / (M_PI * d * d / 4.);
        }
        // Each filament's use split as desktop's Filament view splits it (model,
        // support, prime tower, flushed), from the G-code the slice wrote: length
        // and weight per part, parts the filament has none of left out.
        const auto* densities = cfg.option<ConfigOptionFloats>("filament_density");
        json parts = json::object();
        const auto addPart = [&](const char* part, const std::map<size_t, double>& volumes) {
            for (const auto& [id, volume] : volumes) {
                if (volume <= 0) continue;
                const double d = diameters && !diameters->values.empty() ? diameters->get_at(id) : 1.75;
                const double density = densities && !densities->values.empty() ? densities->get_at(id) : 0.;
                parts[std::to_string(id + 1)][part] = {{"mm", volume / (M_PI * d * d / 4.)}, {"g", volume * density / 1000.}};
            }
        };
        const PrintEstimatedStatistics& used = result.print_statistics;
        addPart("model", used.model_volumes_per_extruder);
        addPart("support", used.support_volumes_per_extruder);
        addPart("tower", used.wipe_tower_volumes_per_extruder);
        addPart("flushed", used.flush_per_filament);
        res["success"] = true;
        res["gcodePath"] = outputPath;
        res["totalLayers"] = layers;
        res["estimatedTimeSeconds"] = std::isfinite(seconds) ? seconds : 0.f;
        // Desktop's "Prepare time": the start G-code (heating, levelling, purge line).
        res["prepareSeconds"] = std::isfinite(normal.prepare_time) ? normal.prepare_time : 0.f;
        res["filamentMm"] = mm;
        res["filamentParts"] = parts;
        res["totalFilamentMm"] = stats.total_used_filament;
        res["totalFilamentGrams"] = stats.total_weight;
        // Desktop's Cost: the filaments' price plus the printer's time cost per hour
        // (the G-code's "total filament cost" leaves the time out).
        res["totalCost"] = stats.total_cost;
        // The tower this slice made, for the Prepare view (desktop shows its
        // real depth once the plate is sliced).
        if (print.has_wipe_tower() && print.is_step_done(psWipeTower) && !print.wipe_tower_data().tool_changes.empty())
            res["wipeTowerDepth"] = print.wipe_tower_data().depth;
        // Desktop always sends a Bambu Lab printer the plate as a .gcode.3mf
        // (its "Print plate", unless it goes through a print host instead).
        const bool bambuSend = engine::selectedPrinterIsBambu() && !(cfg.has("bbl_use_printhost") && cfg.opt_bool("bbl_use_printhost"));
        if ((cfg.has("use_3mf") && cfg.opt_bool("use_3mf")) || bambuSend) {
            const std::string bundle = outputPath + ".3mf";
            if (writeGcode3mf(bundle, plate, outputPath, cfg, result, print, pictures)) res["gcode3mfPath"] = bundle;
            else warnings.add("The .gcode.3mf file for this printer couldn't be made, so the plain G-code is used.", true, {}, "use_3mf");
        }
        if (!name.empty()) {
            const engine::Project& pr = engine::project();
            const std::string plateName = size_t(plate) < pr.plates.size() && pr.plates[plate] ? pr.plates[plate]->plate_name : std::string();
            try {
                res["fileName"] = print.fileName(name, plate, plateName);
            } catch (const std::exception& e) {
                warnings.add(std::string("The file name format couldn't be used, so the file is named after the project. ") + e.what(), false, {},
                             "filename_format");
            }
        }
        engine::report(onProgress, 100, "Done");
    } catch (const CanceledException&) {
        res["cancelled"] = true;
        res["error"] = "cancelled";
    } catch (const std::exception& e) {
        res["error"] = e.what();
    }
    res["warnings"] = warnings.list();
    return res.dump();
}

} // namespace

namespace {

json pointsJson(const Polygon& poly) {
    json pts = json::array();
    for (const Point& pt : poly.points) pts.push_back({unscale<double>(pt.x()), unscale<double>(pt.y())});
    return pts;
}

} // namespace

// Desktop's tool head clearance for printing object by object, before slicing:
// the outline GLCanvas3D draws round each object (its outline from above
// grown by half the printer's extruder_clearance_radius, plus the skirt), and
// Print::sequential_print_clearance_valid, the check the slice runs, with the
// outlines that collide and the objects too tall for their place in the
// order. `configJson` is the config the page would slice `plate` with; the
// plate's own settings go over it. Returns {byObject: false} when the plate
// prints layer by layer, else {byObject: true, radius, rod, lid, short,
// outlines: [{object, instance, order, points: [[x, y]...]}] (plate mm, the
// order it prints in), spacing (the gap Arrange keeps between objects),
// collisions: [[[x, y]...]], tall: [{points, height}]
// (outline, height it may reach), error: the slice's message or ""}.
std::string clearanceJson(const std::string& configJson, int plate) {
    try {
        DynamicPrintConfig cfg;
        cfg.apply(FullPrintConfig::defaults());
        engine::applyJsonConfig(cfg, json::parse(configJson));
        engine::applyPlateSettings(cfg, plate);
        const auto* seq = cfg.option<ConfigOptionEnum<PrintSequence>>("print_sequence");
        if (!seq || seq->value != PrintSequence::ByObject) return json{{"byObject", false}}.dump();
        json out{{"byObject", true},
                 {"radius", cfg.opt_float("extruder_clearance_radius")},
                 {"rod", cfg.opt_float("extruder_clearance_height_to_rod")},
                 {"lid", cfg.opt_float("extruder_clearance_height_to_lid")},
                 {"short", false},
                 {"outlines", json::array()},
                 {"collisions", json::array()},
                 {"tall", json::array()},
                 {"error", ""}};
        // Which object and copy of the project each of the plate model's is.
        const engine::Project& pr = engine::project();
        std::vector<std::vector<std::pair<int, int>>> source;
        for (size_t o = 0; o < pr.model.objects.size(); ++o) {
            std::vector<std::pair<int, int>> copies;
            for (size_t i = 0; i < pr.model.objects[o]->instances.size(); ++i)
                if (pr.plateOf(*pr.model.objects[o]->instances[i]) == plate) copies.emplace_back(int(o), int(i));
            if (!copies.empty()) source.push_back(std::move(copies));
        }
        Model model = plateModel(plate);
        if (model.objects.empty()) return out.dump();
        extruderPerFilament(cfg);
        padFlushMatrix(cfg);
        for (ModelObject* o : model.objects) engine::settleOnBed(o, true);

        SlicePrint print;
        print.is_BBL_printer() = engine::selectedPrinterIsBambu();
        print.set_plate_origin(Vec3d::Zero());
        print.apply(model, cfg);
        Polygons collisions;
        std::vector<std::pair<Polygon, float>> tall;
        out["error"] = Print::sequential_print_clearance_valid(print, &collisions, &tall).string;
        for (const Polygon& c : collisions) out["collisions"].push_back(pointsJson(c));
        for (const auto& [poly, height] : tall) out["tall"].push_back({{"points", pointsJson(poly)}, {"height", height}});

        // The outlines as GLCanvas3D draws them while objects move.
        const bool allShort = print.is_all_objects_are_short();
        const double skirt = std::get<0>(print.object_skirt_offset());
        const double grow = allShort ? std::max(0.5 * MAX_OUTER_NOZZLE_DIAMETER, skirt) - 0.1
                                     : 0.5 * cfg.opt_float("extruder_clearance_radius") + skirt - 0.1;
        out["short"] = allShort;
        // The distance Arrange keeps between objects' outlines from above so their grown outlines don't touch.
        out["spacing"] = 2 * (grow + 0.1) + 0.5;
        const ModelObjectPtrs& printed = print.model().objects;
        for (size_t k = 0; k < printed.size() && k < source.size(); ++k)
            for (size_t i = 0; i < printed[k]->instances.size() && i < source[k].size(); ++i) {
                const ModelInstance* inst = printed[k]->instances[i];
                const Polygon hull = printed[k]->convex_hull_2d(inst->get_matrix());
                const Polygons grown = offset(hull, float(scale_(grow)), jtRound, scale_(0.1));
                out["outlines"].push_back({{"object", source[k][i].first},
                                           {"instance", source[k][i].second},
                                           {"order", inst->arrange_order},
                                           {"points", pointsJson(grown.empty() ? hull : grown.front())}});
            }
        return out.dump();
    } catch (const std::exception& e) {
        return json{{"byObject", false}, {"error", e.what()}}.dump();
    }
}

EMSCRIPTEN_BINDINGS(slice_api) {
    emscripten::function("sliceWithConfig", &sliceWithConfig);
    emscripten::function("clearanceJson", &clearanceJson);
    emscripten::function("sliceCancelFlag", &sliceCancelFlag);
}

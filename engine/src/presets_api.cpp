// Orca's preset system (libslic3r PresetBundle), the same code desktop
// Snapmaker Orca runs.
//
// The page writes Orca's profile folder into the wasm FS as
//   <dataDir>/system/<Vendor>.json + <Vendor>/...           (system presets, read-only)
//   <dataDir>/user/default/{machine,filament,process}/*.json  (user presets)
// and calls presetsLoad(dataDir). Loading goes through PresetBundle::load_presets,
// exactly like desktop start-up, so inheritance, compatibility conditions and
// user-preset diffs behave the same.
#include "engine.hpp"

#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Preset.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"

#include <boost/algorithm/string/predicate.hpp>

#include <climits>
#include <memory>

using nlohmann::json;
using namespace Slic3r;

namespace engine {

std::vector<std::string> applyJsonConfig(DynamicPrintConfig& cfg, const json& values) {
    std::vector<std::string> errors;
    ConfigSubstitutionContext ctx(ForwardCompatibilitySubstitutionRule::EnableSilent);
    for (const auto& [key, value] : values.items()) {
        if (print_config_def.get(key) == nullptr) continue;  // GUI-only or retired keys
        try {
            std::string text = value.is_string() ? value.get<std::string>()
                             : value.is_boolean() ? (value.get<bool>() ? "1" : "0")
                             : value.dump();
            cfg.set_deserialize(key, text, ctx);
        } catch (const std::exception& e) {
            errors.push_back(key + ": " + e.what());
        }
    }
    return errors;
}

json configToJson(const DynamicPrintConfig& cfg) {
    json out = json::object();
    for (const std::string& key : cfg.keys()) out[key] = cfg.opt_serialize(key);
    return out;
}

} // namespace engine

using engine::applyJsonConfig;
using engine::configToJson;

namespace {

std::unique_ptr<PresetBundle> g_bundle;
std::unique_ptr<AppConfig> g_app_config;

PresetBundle& bundle() {
    if (!g_bundle) throw std::runtime_error("presets are not loaded (call presetsLoad first)");
    return *g_bundle;
}

const char* typeName(Preset::Type t) {
    switch (t) {
    case Preset::TYPE_PRINTER: return "printer";
    case Preset::TYPE_FILAMENT: return "filament";
    case Preset::TYPE_PRINT: return "process";
    default: return "other";
    }
}

std::string optString(const DynamicPrintConfig& c, const char* key) {
    const ConfigOption* o = c.option(key);
    return o ? o->serialize() : std::string();
}

json presetJson(const Preset& p) {
    json j{{"name", p.name},
           {"label", p.label(false)},
           {"type", typeName(p.type)},
           {"system", p.is_system},
           {"user", p.is_user()},
           {"visible", p.is_visible},
           {"compatible", p.is_compatible},
           {"inherits", p.inherits()},
           {"vendor", p.vendor ? p.vendor->name : std::string()}};
    if (p.type == Preset::TYPE_PRINTER) {
        j["model"] = optString(p.config, "printer_model");
        j["variant"] = optString(p.config, "printer_variant");
        j["nozzle"] = optString(p.config, "nozzle_diameter");
    } else if (p.type == Preset::TYPE_FILAMENT) {
        j["filamentType"] = optString(p.config, "filament_type");
        j["filamentVendor"] = optString(p.config, "filament_vendor");
        j["colour"] = optString(p.config, "default_filament_colour");
        j["filamentId"] = p.filament_id;
    } else if (p.type == Preset::TYPE_PRINT) {
        j["layerHeight"] = optString(p.config, "layer_height");
    }
    return j;
}

json collectionJson(const PresetCollection& c, bool onlyCompatible) {
    json out = json::array();
    for (auto it = c.begin(); it != c.end(); ++it) {
        if (!it->is_visible) continue;
        if (onlyCompatible && !it->is_compatible) continue;
        out.push_back(presetJson(*it));
    }
    return out;
}

// A printer's default_print_profile / default_filament_profile entry as a
// compatible preset name; entries may be old names (renamed_from) or aliases.
std::string compatibleName(PresetBundle& b, PresetCollection& c, Preset::Type type, const std::string& name) {
    if (name.empty()) return {};
    auto ok = [&c](const std::string& n) -> const Preset* {
        const Preset* p = c.find_preset(n, false);
        return p && p->is_compatible ? p : nullptr;
    };
    if (const Preset* p = ok(name)) return p->name;
    if (const std::string* renamed = c.get_preset_name_renamed(name))
        if (const Preset* p = ok(*renamed)) return p->name;
    if (const Preset* p = ok(b.get_preset_name_by_alias(type, name))) return p->name;
    // A family name ("Snapmaker PLA") with no preset of its own: its Basic
    // member, else the first compatible member.
    if (const Preset* p = ok(b.get_preset_name_by_alias(type, name + " Basic"))) return p->name;
    for (const Preset& p : c)
        if (p.is_visible && p.is_compatible && boost::starts_with(p.name, name + " ")) return p.name;
    return {};
}

bool g_selected_before = false;

json selectionJson(PresetBundle& b) {
    const auto* colours = b.project_config.option<ConfigOptionStrings>("filament_colour");
    return json{{"printer", b.printers.get_selected_preset_name()},
                {"process", b.prints.get_selected_preset_name()},
                {"filaments", b.filament_presets},
                {"colours", colours ? colours->values : std::vector<std::string>{}}};
}

// --- exported -----------------------------------------------------------------

// Load every preset under dataDir (see the header). Returns
// {ok, error, counts, selection}; an empty system/ folder is an error.
std::string presetsLoad(const std::string& dataDir) {
    try {
        set_data_dir(dataDir);
        g_app_config = std::make_unique<AppConfig>();
        g_bundle = std::make_unique<PresetBundle>();
        g_bundle->setup_directories();
        PresetsConfigSubstitutions subs = g_bundle->load_presets(*g_app_config, ForwardCompatibilitySubstitutionRule::EnableSilent);
        PresetBundle& b = *g_bundle;
        // Desktop shows only the printers installed through its setup wizard
        // (AppConfig vendors). Every bundled printer counts as installed here.
        for (const auto& [id, vendor] : b.vendors)
            for (const auto& model : vendor.models)
                for (const auto& variant : model.variants)
                    g_app_config->set_variant(id, model.id, variant.name, true);
        b.load_selections(*g_app_config);
        auto count = [](const PresetCollection& c) {
            size_t n = 0;
            for (auto it = c.begin(); it != c.end(); ++it) n += it->is_visible ? 1 : 0;
            return n;
        };
        const size_t printers = count(b.printers);
        if (printers == 0) return json{{"ok", false}, {"error", "no printer presets found under " + dataDir + "/system"}}.dump();
        return json{{"ok", true},
                    {"counts", {{"printers", printers}, {"filaments", count(b.filaments)}, {"processes", count(b.prints)}}},
                    {"substitutions", subs.size()},
                    {"selection", selectionJson(b)}}
            .dump();
    } catch (const std::exception& e) {
        g_bundle.reset();
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

// All visible printer presets.
std::string presetsPrinters() { return collectionJson(bundle().printers, false).dump(); }

// Select a printer (and optionally a process and filaments) the way the desktop
// sidebar does: incompatible process/filament selections fall back to a
// compatible one. Returns the compatible processes and filaments plus the
// resulting selection.
//   {printer, process?, filaments?: [name per slot], colours?: ["#RRGGBB" per slot]}
std::string presetsSelect(const std::string& selectionJsonText) {
    try {
        PresetBundle& b = bundle();
        const json sel = json::parse(selectionJsonText);
        const std::string printer = sel.value("printer", std::string());
        const bool printerChanged = !printer.empty() && (!g_selected_before || printer != b.printers.get_selected_preset_name());
        g_selected_before = true;
        if (!printer.empty() && !b.printers.select_preset_by_name(printer, true))
            return json{{"ok", false}, {"error", "unknown printer preset: " + printer}}.dump();
        b.update_compatible(PresetSelectCompatibleType::Always);
        const DynamicPrintConfig& printerCfg = b.printers.get_selected_preset().config;

        // Like desktop: a newly chosen printer brings its default process and
        // filament unless the caller names them.
        std::string process = sel.value("process", std::string());
        if (process.empty() && printerChanged)
            process = compatibleName(b, b.prints, Preset::TYPE_PRINT, printerCfg.opt_string("default_print_profile"));
        if (!process.empty()) b.prints.select_preset_by_name(process, true);
        std::string defaultFilament;
        if (const auto* d = printerCfg.option<ConfigOptionStrings>("default_filament_profile"))
            for (const std::string& n : d->values)
                if (!(defaultFilament = compatibleName(b, b.filaments, Preset::TYPE_FILAMENT, n)).empty()) break;

        if (sel.contains("filaments") && sel["filaments"].is_array() && !sel["filaments"].empty()) {
            const std::vector<std::string> names = sel["filaments"].get<std::vector<std::string>>();
            // Same steps as adding/removing filaments in the desktop sidebar:
            // resizes every per-filament project setting (colours, maps) too.
            b.set_num_filaments(unsigned(names.size()));
            for (size_t i = 0; i < names.size(); ++i) b.set_filament_preset(i, names[i]);
            b.filaments.select_preset_by_name(names.front(), true);
        }
        if (sel.contains("colours") && sel["colours"].is_array()) {
            auto* colours = b.project_config.option<ConfigOptionStrings>("filament_colour", true);
            const std::vector<std::string> values = sel["colours"].get<std::vector<std::string>>();
            for (size_t i = 0; i < values.size() && i < colours->values.size(); ++i) colours->values[i] = values[i];
        }
        b.update_compatible(PresetSelectCompatibleType::Always);
        // Any filament slot naming an unknown or incompatible preset (every slot,
        // for a newly chosen printer with no filaments given) takes the
        // printer's default filament, else the first compatible one.
        const bool filamentsGiven = sel.contains("filaments") && sel["filaments"].is_array() && !sel["filaments"].empty();
        std::string fallback = defaultFilament;
        if (fallback.empty())
            if (const Preset* first = b.filaments.find_preset(b.filaments.get_selected_preset_name(), true)) fallback = first->name;
        for (std::string& name : b.filament_presets) {
            const Preset* p = b.filaments.find_preset(name, false);
            if (!fallback.empty() && ((printerChanged && !filamentsGiven) || p == nullptr || !p->is_compatible)) name = fallback;
        }
        if (!fallback.empty() && !b.filament_presets.empty()) b.filaments.select_preset_by_name(b.filament_presets.front(), true);

        return json{{"ok", true},
                    {"selection", selectionJson(b)},
                    {"processes", collectionJson(b.prints, true)},
                    {"filaments", collectionJson(b.filaments, true)}}
            .dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

// One preset's own resolved config (after inheritance), key -> serialized value.
std::string presetConfig(const std::string& type, const std::string& name) {
    PresetBundle& b = bundle();
    PresetCollection& c = type == "printer" ? static_cast<PresetCollection&>(b.printers) : type == "filament" ? b.filaments : b.prints;
    const Preset* p = c.find_preset(name, false);
    if (p == nullptr) return "";
    return configToJson(p->config).dump();
}

// The merged config of the current selection (printer + process + one filament
// per slot), exactly what desktop slices with, with `overrides` (key -> value)
// applied on top. Returns {ok, config: {key: value}, errors: [...]}.
std::string presetsFullConfig(const std::string& overridesJson) {
    try {
        DynamicPrintConfig cfg = bundle().full_config();
        std::vector<std::string> errors;
        if (!overridesJson.empty()) errors = applyJsonConfig(cfg, json::parse(overridesJson));
        return json{{"ok", true}, {"config", configToJson(cfg)}, {"errors", errors}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

const char* optionTypeName(ConfigOptionType t) {
    switch (t) {
    case coFloat: return "float";
    case coFloats: return "floats";
    case coInt: return "int";
    case coInts: return "ints";
    case coString: return "string";
    case coStrings: return "strings";
    case coPercent: return "percent";
    case coPercents: return "percents";
    case coFloatOrPercent: return "floatOrPercent";
    case coFloatsOrPercents: return "floatsOrPercents";
    case coPoint: return "point";
    case coPoints: return "points";
    case coPoint3: return "point3";
    case coBool: return "bool";
    case coBools: return "bools";
    case coEnum: return "enum";
    case coEnums: return "enums";
    default: return "none";
    }
}

// Metadata of every option the engine knows, for building settings UIs:
// {key: {type, label, fullLabel, category, tooltip, sidetext, mode, min, max,
//        enumValues, enumLabels, default, nullable, multiline, readonly, flow}}.
// flow is "process" or "filament" for Snapmaker's flow-variant options: one
// value per flow variant (standard / high flow) in the order of the
// *_flow_support list, which desktop edits one variant at a time.
std::string configOptionsJson() {
    json out = json::object();
    for (const auto& [key, def] : print_config_def.options) {
        json o{{"type", optionTypeName(def.type)},
               {"label", def.label},
               {"fullLabel", def.full_label},
               {"category", def.category},
               {"tooltip", def.tooltip},
               {"sidetext", def.sidetext},
               {"mode", def.mode == comSimple ? "simple" : def.mode == comAdvanced ? "advanced" : "develop"}};
        if (def.min != INT_MIN) o["min"] = def.min;
        if (def.max != INT_MAX) o["max"] = def.max;
        if (!def.enum_values.empty()) o["enumValues"] = def.enum_values;
        if (!def.enum_labels.empty()) o["enumLabels"] = def.enum_labels;
        if (def.type == coEnums) {
            // The default of an enum-list option can lack its keys map (the
            // filament_* copies of extruder options), and serialize() then walks
            // a null map. Name the values through the definition's map instead.
            const auto* v = dynamic_cast<const ConfigOptionVector<int>*>(def.default_value.get());
            if (v && def.enum_keys_map) {
                std::string text;
                for (int i : v->values)
                    for (const auto& [name, id] : *def.enum_keys_map)
                        if (id == i) { text += (text.empty() ? "" : ",") + name; break; }
                o["default"] = text;
            }
        } else if (def.default_value) {
            o["default"] = def.default_value->serialize();
        }
        if (def.nullable) o["nullable"] = true;
        if (def.multiline) o["multiline"] = true;
        if (def.readonly) o["readonly"] = true;
        if (is_process_flow_variant_option(key)) o["flow"] = "process";
        else if (is_filament_flow_variant_option(key)) o["flow"] = "filament";
        out[key] = std::move(o);
    }
    return out.dump();
}

// Filaments that work with one printer, without selecting it (the setup
// wizard lists them for every printer the user installs). Returns
// {filaments: [preset summaries], defaults: [the printer's default filament names]}.
std::string presetsFilamentsFor(const std::string& printerName) {
    try {
        PresetBundle& b = bundle();
        const Preset* printer = b.printers.find_preset(printerName, false);
        if (!printer) throw std::runtime_error("no printer preset " + printerName);
        const PresetWithVendorProfile active = b.printers.get_preset_with_vendor_profile(*printer);
        json names = json::array(), list = json::array();
        for (auto it = b.filaments.begin(); it != b.filaments.end(); ++it) {
            if (!it->is_visible || it->is_default) continue;
            if (!is_compatible_with_printer(b.filaments.get_preset_with_vendor_profile(*it), active)) continue;
            names.push_back(it->name);
            list.push_back(presetJson(*it));
        }
        json defaults = json::array();
        // Profiles may name a filament family ("Snapmaker PLA"): take its
        // member for this printer, as compatibleName does for the selection.
        if (const auto* d = printer->config.option<ConfigOptionStrings>("default_filament_profile"))
            for (const std::string& n : d->values) {
                auto it = std::find(names.begin(), names.end(), n);
                if (it == names.end())
                    it = std::find_if(names.begin(), names.end(), [&](const json& f) { return boost::starts_with(f.get<std::string>(), n + " "); });
                if (it != names.end()) defaults.push_back(*it);
            }
        return json{{"ok", true}, {"filaments", list}, {"defaults", defaults}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

bool engine::selectedPrinterIsBambu() { return g_bundle && g_bundle->is_bbl_vendor(); }

EMSCRIPTEN_BINDINGS(presets_api) {
    emscripten::function("presetsLoad", &presetsLoad);
    emscripten::function("presetsPrinters", &presetsPrinters);
    emscripten::function("presetsSelect", &presetsSelect);
    emscripten::function("presetsFilamentsFor", &presetsFilamentsFor);
    emscripten::function("presetConfig", &presetConfig);
    emscripten::function("presetsFullConfig", &presetsFullConfig);
    emscripten::function("configOptionsJson", &configOptionsJson);
}

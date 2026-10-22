// Colour mixing (Snapmaker Orca's "mixed filaments"): virtual filaments made of
// two or more physical ones, numbered after them (5, 6, ... on a 4-filament
// U1). The list lives in the project setting `mixed_filament_definitions`;
// Print::apply reads it when slicing, so slicing needs nothing from here. This
// file is what desktop's Color Mixing panel does around that string: read and
// edit the rows with Orca's MixedFilamentManager (the same load sequence as
// Print::apply), give each row its colour, move painted and assigned filament
// IDs when a row or a physical filament goes away (Plater's remap), and find a
// recipe for a target colour (the dialog's Match mode).
#include "engine.hpp"

#include "libslic3r/MixedFilament.hpp"
#include "libslic3r/TriangleSelector.hpp"
#include "libslic3r/filament_mixer.h"
#include "libslic3r/libslic3r.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <queue>
#include <sstream>
#include <tuple>
#include <unordered_map>

using nlohmann::json;
using namespace Slic3r;

namespace {

json fail(const std::string& error) { return json{{"ok", false}, {"error", error}}; }

bool compatible(const std::vector<std::string>& types, const std::vector<unsigned>& ids);

// Physical filaments a row mixes (is_filament_compatible(const MixedFilament&)).
std::vector<unsigned> rowFilaments(const MixedFilament& mf, size_t physical) {
    std::vector<unsigned> ids;
    const std::string norm = MixedFilamentManager::normalize_manual_pattern(mf.manual_pattern);
    if (!norm.empty()) {
        for (const std::string& group : MixedFilamentManager::split_pattern_groups(norm))
            for (const std::string& token : MixedFilamentManager::split_pattern_group_to_tokens(group, physical)) {
                const unsigned id = MixedFilamentManager::physical_filament_from_token(token, mf, physical);
                if (id >= 1 && id <= physical) ids.push_back(id);
            }
        return ids;
    }
    if (mf.component_a >= 1) ids.push_back(mf.component_a);
    if (mf.component_b >= 1) ids.push_back(mf.component_b);
    for (unsigned id : MixedFilamentManager::decode_gradient_component_ids(mf.gradient_component_ids)) ids.push_back(id);
    return ids;
}

// What desktop's update_color_mix_panel reads from the project config to build
// the display context (Plater.cpp), plus the gradient settings Print::apply uses.
struct Settings {
    std::vector<std::string> colours;
    std::vector<double> nozzles;
    std::vector<std::string> types;  // filament_type per physical filament, for the material check
    float lower = 0.04f, upper = 0.16f;
    bool localZ = false, bias = false, heightWeighted = false, advancedDithering = false;
};

Settings readSettings(const json& req) {
    Settings s;
    for (const auto& c : req.value("colours", json::array())) s.colours.push_back(c.get<std::string>());
    for (const auto& d : req.value("nozzles", json::array())) s.nozzles.push_back(d.get<double>());
    for (const auto& t : req.value("types", json::array())) s.types.push_back(t.get<std::string>());
    const json st = req.value("settings", json::object());
    s.lower = std::max(0.01f, st.value("lowerBound", 0.04f));
    s.upper = std::max(s.lower, st.value("upperBound", 0.16f));
    s.localZ = st.value("localZ", false);
    s.bias = st.value("bias", false);
    s.heightWeighted = st.value("heightWeighted", false);
    s.advancedDithering = st.value("advancedDithering", false);
    return s;
}

MixedFilamentDisplayContext displayContext(const Settings& s) {
    const size_t n = s.colours.size();
    std::vector<double> nozzles(n, 0.4);
    for (size_t i = 0; i < n && !s.nozzles.empty(); ++i) nozzles[i] = std::max(0.05, s.nozzles[std::min(i, s.nozzles.size() - 1)]);
    const MixedFilamentPreviewSettings preview{0.2f, s.lower, s.upper, 0.f, 0.f, s.localZ, false, 1};
    return MixedFilamentDisplayContext{n, s.colours, nozzles, preview, s.bias};
}

// The rows as Print::apply builds them before slicing.
void loadManager(MixedFilamentManager& mgr, const std::string& definitions, const Settings& s) {
    mgr.clear_custom_entries();
    mgr.auto_generate(s.colours);
    mgr.load_custom_entries(definitions, s.colours);
    mgr.apply_gradient_settings(s.heightWeighted ? 1 : 0, s.lower, s.upper, s.advancedDithering);
    mgr.set_display_context(displayContext(s));
}

json rowJson(const MixedFilament& mf, unsigned virtualId, const MixedFilamentDisplayContext& ctx, const std::vector<std::string>& types) {
    json ids = json::array();
    for (unsigned id : MixedFilamentManager::decode_gradient_component_ids(mf.gradient_component_ids, 0)) ids.push_back(id);
    return {
        {"virtualId", virtualId},
        {"stableId", std::to_string(mf.stable_id)},
        {"componentA", mf.component_a},
        {"componentB", mf.component_b},
        {"mixBPercent", mf.mix_b_percent},
        {"ratioA", mf.ratio_a},
        {"ratioB", mf.ratio_b},
        {"pattern", MixedFilamentManager::normalize_manual_pattern(mf.manual_pattern)},
        {"gradientIds", mf.gradient_component_ids},
        {"gradientIdList", ids},
        {"gradientWeights", mf.gradient_component_weights},
        {"distributionMode", mf.distribution_mode},
        {"gradientEnabled", mf.gradient_enabled},
        {"gradientStart", mf.gradient_start},
        {"gradientEnd", mf.gradient_end},
        {"localZMaxSublayers", mf.local_z_max_sublayers},
        {"enabled", mf.enabled},
        {"deleted", mf.deleted},
        {"custom", mf.custom},
        {"uiMode", mf.ui_mode},
        {"colour", compute_mixed_filament_display_color(mf, ctx)},
        {"compatible", compatible(types, rowFilaments(mf, ctx.num_physical))},
    };
}

// A row's recipe from the page, as desktop's dialog result (MixedFilamentDialog::collect_result).
void applyRecipe(MixedFilament& mf, const json& r) {
    mf.component_a = r.value("componentA", mf.component_a);
    mf.component_b = r.value("componentB", mf.component_b);
    mf.mix_b_percent = std::clamp(r.value("mixBPercent", mf.mix_b_percent), 0, 100);
    mf.ratio_a = r.value("ratioA", mf.ratio_a);
    mf.ratio_b = r.value("ratioB", mf.ratio_b);
    mf.manual_pattern = MixedFilamentManager::normalize_manual_pattern(r.value("pattern", std::string()));
    mf.gradient_component_ids = MixedFilamentManager::normalize_gradient_component_ids(r.value("gradientIds", std::string()));
    mf.gradient_component_weights = r.value("gradientWeights", std::string());
    mf.distribution_mode = std::clamp(r.value("distributionMode", int(MixedFilament::Simple)), int(MixedFilament::LayerCycle), int(MixedFilament::Simple));
    mf.gradient_enabled = r.value("gradientEnabled", false);
    mf.gradient_start = r.value("gradientStart", MixedFilament::k_default_gradient_dominant);
    mf.gradient_end = r.value("gradientEnd", MixedFilament::k_default_gradient_minority);
    mf.local_z_max_sublayers = std::max(0, r.value("localZMaxSublayers", 0));
    mf.ui_mode = r.value("uiMode", -1);
    mf.custom = true;
}

// Virtual IDs of the enabled rows by stable id.
std::unordered_map<uint64_t, unsigned> virtualIds(const std::vector<MixedFilament>& rows, size_t physical) {
    std::unordered_map<uint64_t, unsigned> out;
    unsigned next = unsigned(physical) + 1;
    for (const MixedFilament& mf : rows)
        if (mf.enabled) out.emplace(mf.stable_id, next++);
    return out;
}

// Moves object, part and painted filament IDs through `remap` (old 1-based ID
// -> new, 0 = gone), as desktop's Plater::on_filament_deleted does with the
// PresetBundle's remap: paint on a removed filament is erased, an object or
// part set to one falls back to the default.
void applyRemap(const std::vector<unsigned>& remap, size_t newTotal) {
    EnforcerBlockerStateMap states;
    for (size_t i = 0; i < states.size(); ++i) states[i] = EnforcerBlockerType(i);
    bool changes = false;
    for (size_t i = 1; i < states.size(); ++i) {
        const unsigned to = i < remap.size() ? remap[i] : 0;
        if (i >= remap.size()) continue;
        states[i] = to == 0 || to >= states.size() || to > newTotal ? EnforcerBlockerType::NONE : EnforcerBlockerType(to);
        changes |= states[i] != EnforcerBlockerType(i);
    }
    if (!changes) return;
    auto move = [&](ModelConfigObject& cfg) {
        if (!cfg.has("extruder")) return;
        const int id = cfg.opt_int("extruder");
        if (id <= 0 || size_t(id) >= remap.size()) return;
        if (remap[id] == 0) cfg.erase("extruder");
        else cfg.set_key_value("extruder", new ConfigOptionInt(int(remap[id])));
    };
    for (ModelObject* obj : engine::project().model.objects) {
        move(obj->config);
        for (ModelVolume* v : obj->volumes) {
            move(v->config);
            v->remap_extruder_ids(newTotal, states);
        }
    }
}

// mixedFilaments(request): the mixed rows of `definitions` for physical
// filaments `colours`, after an optional edit. Request:
//   {definitions, colours: ["#RRGGBB"...], nozzles: [mm...],
//    settings: {lowerBound, upperBound, localZ, bias, heightWeighted, advancedDithering},
//    op?: {kind: "add", row} | {kind: "update", index, row} | {kind: "delete", index}
//         | {kind: "removePhysical", filament (1-based)}
//         | {kind: "replacePhysical", colours, types?, remap: [new 1-based ID per old filament, 0 = gone], dropMixes?}
//         | {kind: "flatten", to: [physical 1-based ID per mix in use]},
//    types?: [filament_type...],     for each row's `compatible` (desktop's material check)
//    draft?: row}                    a recipe to preview, not stored
// Returns {definitions, rows: [...], draftColour?, draftCompatible?}. Rows keep their order in
// the list (deleted ones too, as desktop keeps them); virtualId is 0 for rows
// that are not in use. "delete", "removePhysical", "replacePhysical" and "flatten" also move the IDs the
// open project's objects, parts and paint use.
std::string mixedFilaments(const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        const Settings s = readSettings(req);
        const size_t physical = s.colours.size();
        MixedFilamentManager mgr;
        loadManager(mgr, req.value("definitions", std::string()), s);
        auto& rows = mgr.mixed_filaments();

        bool changed = false;
        if (req.contains("op")) {
            const json& op = req["op"];
            const std::string kind = op.value("kind", "");
            const auto index = [&]() {
                const int i = op.value("index", -1);
                if (i < 0 || size_t(i) >= rows.size()) throw std::runtime_error("no mixed filament " + std::to_string(i));
                return size_t(i);
            };
            if (kind == "add") {
                if (physical < 2) throw std::runtime_error("Colour mixing needs at least two filaments.");
                if (mgr.total_filaments(physical) >= MAXIMUM_FILAMENT_NUMBER)
                    throw std::runtime_error("No more filaments can be added.");
                const json& r = op.at("row");
                mgr.add_custom_filament(r.value("componentA", 1u), r.value("componentB", 2u), r.value("mixBPercent", 50), s.colours);
                applyRecipe(rows.back(), r);
            } else if (kind == "update") {
                applyRecipe(rows[index()], op.at("row"));
            } else if (kind == "delete") {
                // Plater's Delete: the row is kept as deleted; paint and
                // assignments on it go, higher virtual IDs move down.
                const size_t i = index();
                std::vector<unsigned> deleted;
                if (rows[i].enabled) deleted.push_back(virtualIds(rows, physical).at(rows[i].stable_id));
                const size_t oldTotal = mgr.total_filaments(physical);
                rows[i].deleted = true;
                rows[i].enabled = false;
                if (!deleted.empty())
                    applyRemap(MixedFilamentManager::build_mixed_deletion_painting_remap(physical, oldTotal, deleted), mgr.total_filaments(physical));
            } else if (kind == "removePhysical") {
                // Deleting physical filament f (1-based): later ones move down,
                // mixes that use f go (MixedFilamentManager::remove_physical_filament)
                // and the rest keep their row by stable id (PresetBundle::build_filament_id_remap).
                const unsigned f = op.value("filament", 0u);
                if (f < 1 || f > physical) throw std::runtime_error("no filament " + std::to_string(f));
                const std::vector<MixedFilament> old = rows;
                const auto oldIds = virtualIds(old, physical);
                const size_t oldTotal = mgr.total_filaments(physical);
                mgr.remove_physical_filament(f);
                const auto newIds = virtualIds(rows, physical - 1);
                std::vector<unsigned> remap(oldTotal + 1, 0);
                for (unsigned id = 1; id <= physical; ++id) remap[id] = id == f ? 0 : id > f ? id - 1 : id;
                for (const auto& [stable, id] : oldIds) {
                    const auto it = newIds.find(stable);
                    remap[id] = it == newIds.end() ? 0 : it->second;
                }
                applyRemap(remap, mgr.total_filaments(physical - 1));
                Settings after = s;
                after.colours.erase(after.colours.begin() + (f - 1));
                if (f <= after.types.size()) after.types.erase(after.types.begin() + (f - 1));
                mgr.set_display_context(displayContext(after));
                const std::string defs = mgr.serialize_custom_entries();
                json out{{"definitions", defs}, {"rows", json::array()}};
                const MixedFilamentDisplayContext ctx = displayContext(after);
                for (const MixedFilament& mf : rows) out["rows"].push_back(rowJson(mf, newIds.count(mf.stable_id) && mf.enabled ? newIds.at(mf.stable_id) : 0, ctx, after.types));
                return out.dump();
            } else if (kind == "replacePhysical") {
                // Desktop's Sync filament (Plater show_sync_filament_dialog): the
                // physical filaments become `colours` (op.colours, op.types); old
                // filament i (1-based) moves to remap[i - 1] (0 = gone).
                // dropMixes (Direct Override) deletes every mix in use, as their
                // components changed; otherwise mixes stay and move to their new
                // virtual IDs (filaments only added at the end).
                Settings after = s;
                after.colours.clear();
                after.types.clear();
                for (const auto& c : op.at("colours")) after.colours.push_back(c.get<std::string>());
                for (const auto& t : op.value("types", json::array())) after.types.push_back(t.get<std::string>());
                const size_t newPhysical = after.colours.size();
                if (newPhysical < 1) throw std::runtime_error("a project needs at least one filament");
                const std::vector<unsigned> to = op.value("remap", std::vector<unsigned>{});
                const auto oldIds = virtualIds(rows, physical);
                const size_t oldTotal = mgr.total_filaments(physical);
                const bool drop = op.value("dropMixes", false);
                if (drop)
                    for (MixedFilament& mf : rows)
                        if (mf.enabled && !mf.deleted) {
                            mf.deleted = true;
                            mf.enabled = false;
                        }
                // With fewer than two filaments Orca reads no rows: keep the
                // project's list as it came unless it was meant to go.
                const std::string defs = drop || physical >= 2 ? mgr.serialize_custom_entries() : req.value("definitions", std::string());
                MixedFilamentManager next;
                loadManager(next, defs, after);
                const auto newIds = virtualIds(next.mixed_filaments(), newPhysical);
                std::vector<unsigned> remap(oldTotal + 1, 0);
                for (unsigned id = 1; id <= physical; ++id) remap[id] = id - 1 < to.size() && to[id - 1] <= newPhysical ? to[id - 1] : 0;
                for (const auto& [stable, id] : oldIds) {
                    const auto it = newIds.find(stable);
                    remap[id] = it == newIds.end() ? 0 : it->second;
                }
                applyRemap(remap, next.total_filaments(newPhysical));
                json out{{"definitions", defs}, {"rows", json::array()}};
                const MixedFilamentDisplayContext ctx = displayContext(after);
                for (const MixedFilament& mf : next.mixed_filaments())
                    out["rows"].push_back(rowJson(mf, mf.enabled && newIds.count(mf.stable_id) ? newIds.at(mf.stable_id) : 0, ctx, after.types));
                return out.dump();
            } else if (kind == "flatten") {
                // Switching the project to an engine without colour mixing
                // (apps/web/src/lib/engine-switch.ts): the k-th mix in use
                // (filament physical + 1 + k) becomes physical filament
                // op.to[k] (1-based) on objects, parts, paint and layer
                // filament changes, and every mix goes from the list.
                const std::vector<unsigned> to = op.value("to", std::vector<unsigned>{});
                const auto ids = virtualIds(rows, physical);
                const size_t oldTotal = mgr.total_filaments(physical);
                std::vector<unsigned> remap(oldTotal + 1, 0);
                for (unsigned id = 1; id <= physical; ++id) remap[id] = id;
                for (const auto& [stable, id] : ids) {
                    const size_t k = id - physical - 1;
                    remap[id] = k < to.size() && to[k] >= 1 && to[k] <= physical ? to[k] : 0;
                }
                for (MixedFilament& mf : rows)
                    if (!mf.deleted) {
                        mf.deleted = true;
                        mf.enabled = false;
                    }
                applyRemap(remap, physical);
                for (auto& [plate, info] : engine::project().model.plates_custom_gcodes)
                    for (CustomGCode::Item& item : info.gcodes)
                        if (item.extruder > int(physical) && size_t(item.extruder) < remap.size() && remap[item.extruder])
                            item.extruder = int(remap[item.extruder]);
            } else {
                throw std::runtime_error("unknown mixed filament edit " + kind);
            }
            changed = true;
        }

        const MixedFilamentDisplayContext ctx = displayContext(s);
        // Unedited definitions go back as they came: with fewer than two
        // filaments Orca reads no rows, and the project keeps its mixes for
        // when a second filament is back.
        const std::string defs = changed ? mgr.serialize_custom_entries() : req.value("definitions", std::string());
        json out{{"definitions", defs}, {"rows", json::array()}};
        const auto ids = virtualIds(rows, physical);
        for (const MixedFilament& mf : rows) out["rows"].push_back(rowJson(mf, mf.enabled ? ids.at(mf.stable_id) : 0, ctx, s.types));
        if (req.contains("draft") && physical >= 2) {
            MixedFilament mf;
            applyRecipe(mf, req["draft"]);
            out["draftColour"] = compute_mixed_filament_display_color(mf, ctx);
            out["draftCompatible"] = compatible(s.types, rowFilaments(mf, physical));
        }
        return out.dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

// mixedBlend({colours, weights: [[w, ...], ...]}): FilamentMixer blends of
// `colours` for each weight list, as "#RRGGBB" (the dialog's preview strips).
std::string mixedBlend(const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        std::vector<std::string> colours;
        for (const auto& c : req.at("colours")) colours.push_back(c.get<std::string>());
        json out = json::array();
        for (const auto& w : req.at("weights")) {
            std::vector<std::pair<std::string, int>> parts;
            for (size_t i = 0; i < colours.size() && i < w.size(); ++i) parts.emplace_back(colours[i], w[i].get<int>());
            out.push_back(MixedFilamentManager::blend_color_multi(parts));
        }
        return json{{"colours", out}}.dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

// ---------------------------------------------------------------------------
// Match mode: the closest recipe for a target colour. A port of
// build_best_color_match_recipe and its helpers from Orca's
// src/slic3r/GUI/MixedColorMatchHelpers.cpp (and RGB2Lab / DeltaE00 from
// src/slic3r/Utils/ColorSpaceConvert.cpp), which live in the wxWidgets GUI and
// can't be compiled here. The search is unchanged; wxColour became Rgb.
// ---------------------------------------------------------------------------

struct Rgb {
    unsigned char r = 0x26, g = 0xA6, b = 0x9A;  // Orca's fallback #26A69A
};
struct Lab {
    double L, a, b;
};

Rgb parseRgb(const std::string& hex) {
    std::string h = hex;
    if (!h.empty() && h[0] == '#') h.erase(0, 1);
    if (h.size() < 6) return {};
    try {
        return {(unsigned char) std::stoi(h.substr(0, 2), nullptr, 16), (unsigned char) std::stoi(h.substr(2, 2), nullptr, 16),
                (unsigned char) std::stoi(h.substr(4, 2), nullptr, 16)};
    } catch (...) {
        return {};
    }
}
std::string hexOf(const Rgb& c) {
    char buf[8];
    std::snprintf(buf, sizeof(buf), "#%02X%02X%02X", c.r, c.g, c.b);
    return buf;
}

double pivotRgb(double n) { return (n > 0.04045 ? std::pow((n + 0.055) / 1.055, 2.4) : n / 12.92) * 100.0; }
double pivotXyz(double n) { return n > 0.008856 ? std::cbrt(n) : 7.787 * n + 16.0 / 116.0; }

Lab toLab(const Rgb& c) {
    const float R = float(pivotRgb(c.r / 255.0)), G = float(pivotRgb(c.g / 255.0)), B = float(pivotRgb(c.b / 255.0));
    const float X = 0.412453f * R + 0.357580f * G + 0.180423f * B;
    const float Y = 0.212671f * R + 0.715160f * G + 0.072169f * B;
    const float Z = 0.019334f * R + 0.119193f * G + 0.950227f * B;
    const double x = pivotXyz(X / 95.047), y = pivotXyz(Y / 100.0), z = pivotXyz(Z / 108.883);
    return {float(116.0 * y - 16.0), float(500.0 * (x - y)), float(200.0 * (y - z))};
}

double deltaE00(const Lab& p, const Lab& q) {
    const float l1 = float(p.L), a1 = float(p.a), b1 = float(p.b), l2 = float(q.L), a2 = float(q.a), b2 = float(q.b);
    auto rad2deg = [](float rad) { return 360.0 * rad / (2.0 * M_PI); };
    auto deg2rad = [](float deg) { return (2.0 * M_PI * deg) / 360.0; };
    float avgL = (l1 + l2) / 2.0;
    float c1 = std::sqrt(std::pow(a1, 2) + std::pow(b1, 2));
    float c2 = std::sqrt(std::pow(a2, 2) + std::pow(b2, 2));
    float avgC = (c1 + c2) / 2.0;
    float g = (1.0 - std::sqrt(std::pow(avgC, 7) / (std::pow(avgC, 7) + std::pow(25.0, 7)))) / 2.0;
    float a1p = a1 * (1.0 + g), a2p = a2 * (1.0 + g);
    float c1p = std::sqrt(std::pow(a1p, 2) + std::pow(b1, 2));
    float c2p = std::sqrt(std::pow(a2p, 2) + std::pow(b2, 2));
    float avgCp = (c1p + c2p) / 2.0;
    float h1p = rad2deg(std::atan2(b1, a1p));
    if (h1p < 0.0) h1p += 360.0;
    float h2p = rad2deg(std::atan2(b2, a2p));
    if (h2p < 0.0) h2p += 360;
    float avghp = std::abs(h1p - h2p) > 180.0 ? (h1p + h2p + 360.0) / 2.0 : (h1p + h2p) / 2.0;
    float t = 1.0 - 0.17 * std::cos(deg2rad(avghp - 30.0)) + 0.24 * std::cos(deg2rad(2.0 * avghp)) +
              0.32 * std::cos(deg2rad(3.0 * avghp + 6.0)) - 0.2 * std::cos(deg2rad(4.0 * avghp - 63.0));
    float deltahp = h2p - h1p;
    if (std::abs(deltahp) > 180.0) deltahp += h2p <= h1p ? 360.0 : -360.0;
    float deltalp = l2 - l1, deltacp = c2p - c1p;
    deltahp = 2.0 * std::sqrt(c1p * c2p) * std::sin(deg2rad(deltahp) / 2.0);
    float sl = 1.0 + ((0.015 * std::pow(avgL - 50.0, 2)) / std::sqrt(20.0 + std::pow(avgL - 50.0, 2)));
    float sc = 1.0 + 0.045 * avgCp;
    float sh = 1.0 + 0.015 * avgCp * t;
    float deltaro = 30.0 * std::exp(-(std::pow((avghp - 275.0) / 25.0, 2)));
    float rc = 2.0 * std::sqrt(std::pow(avgCp, 7) / (std::pow(avgCp, 7) + std::pow(25.0, 7)));
    float rt = -rc * std::sin(2.0 * deg2rad(deltaro));
    return std::sqrt(std::pow(deltalp / sl, 2) + std::pow(deltacp / sc, 2) + std::pow(deltahp / sh, 2) + double(rt) * (deltacp / sc) * (deltahp / sh));
}

Rgb blendPair(const Rgb& l, const Rgb& r, float t) {
    Rgb out = l;
    filament_mixer_lerp(l.r, l.g, l.b, r.r, r.g, r.b, std::clamp(t, 0.f, 1.f), &out.r, &out.g, &out.b);
    return out;
}

Rgb blendMulti(const std::vector<Rgb>& colors, const std::vector<double>& weights) {
    Rgb out;
    double acc = 0.0;
    bool has = false;
    for (size_t i = 0; i < colors.size() && i < weights.size(); ++i) {
        const double w = std::max(0.0, weights[i]);
        if (w <= 0.0) continue;
        if (!has) {
            out = colors[i];
            acc = w;
            has = true;
            continue;
        }
        const double total = acc + w;
        filament_mixer_lerp(out.r, out.g, out.b, colors[i].r, colors[i].g, colors[i].b, float(w / total), &out.r, &out.g, &out.b);
        acc = total;
    }
    return has ? out : Rgb{};
}

Lab blendWeightedLab(const std::vector<Rgb>& palette, const std::vector<unsigned>& ids, const std::vector<int>& weights) {
    std::vector<std::pair<unsigned, int>> sorted;
    for (size_t i = 0; i < ids.size(); ++i) sorted.emplace_back(ids[i], weights[i]);
    std::sort(sorted.begin(), sorted.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    std::vector<Rgb> colors;
    std::vector<double> w;
    for (const auto& [id, wt] : sorted) {
        if (id == 0 || id > palette.size()) continue;
        colors.push_back(palette[id - 1]);
        w.push_back(double(std::max(0, wt)));
    }
    return toLab(blendMulti(colors, w));
}

// Material compatibility (MixedColorMatchHelpers.cpp, with the matrix from
// resources/profiles/Snapmaker/filament/filament_compatibility.json).
enum Category { PLA, PETG, TPU, PET, ABS, ASA, PC, PA, SUPPORT, UNKNOWN };

Category categoryOf(std::string type) {
    type.erase(0, type.find_first_not_of(" \t\r\n"));
    type.erase(type.find_last_not_of(" \t\r\n") + 1);
    std::transform(type.begin(), type.end(), type.begin(), [](unsigned char c) { return std::toupper(c); });
    static const std::unordered_map<std::string, Category> m = {
        {"PLA", PLA}, {"PLA-CF", PLA}, {"ABS", ABS}, {"ASA", ASA}, {"PETG", PETG}, {"PETG-CF", PETG}, {"PCTG", PETG},
        {"TPU", TPU}, {"PET", PET}, {"PA", PA}, {"PA-CF", PA}, {"PC", PC}, {"BVOH", SUPPORT}, {"PVA", SUPPORT},
    };
    const auto it = m.find(type);
    return it == m.end() ? UNKNOWN : it->second;
}

bool categoriesCompatible(Category a, Category b) {
    if (a == UNKNOWN || b == UNKNOWN) return false;
    if (a == b) return true;
    static const std::vector<std::vector<Category>> partners = {
        /*PLA*/ {PC}, /*PETG*/ {TPU, PET, ABS, ASA, PC}, /*TPU*/ {PETG, PET}, /*PET*/ {PETG, TPU, ABS, ASA, PC},
        /*ABS*/ {PETG, PET, ASA, PC, PA}, /*ASA*/ {PETG, PET, ABS, PC, PA}, /*PC*/ {PLA, PETG, PET, ABS, ASA, PA},
        /*PA*/ {ABS, ASA, PC}, /*SUPPORT*/ {},
    };
    const auto& p = partners[a];
    return std::find(p.begin(), p.end(), b) != p.end();
}

// is_filament_compatible: every pair compatible; an unknown type is not.
bool compatible(const std::vector<std::string>& types, const std::vector<unsigned>& ids) {
    if (ids.size() <= 1 || types.empty()) return true;
    std::vector<Category> cats;
    for (unsigned id : ids)
        if (id >= 1 && id <= types.size()) cats.push_back(categoryOf(types[id - 1]));
    for (Category c : cats)
        if (c == UNKNOWN) return false;
    for (size_t i = 0; i < cats.size(); ++i)
        for (size_t j = i + 1; j < cats.size(); ++j)
            if (!categoriesCompatible(cats[i], cats[j])) return false;
    return true;
}

struct Recipe {
    bool valid = false;
    unsigned a = 1, b = 2;
    int mixB = 50;
    std::string ids, weights;
    Rgb preview;
    double deltaE = std::numeric_limits<double>::infinity();
};

std::string encodeWeights(const std::vector<int>& w) {
    std::ostringstream ss;
    for (size_t i = 0; i < w.size(); ++i) ss << (i ? "/" : "") << w[i];
    return ss.str();
}

Recipe bestRecipe(const std::vector<std::string>& colours, const std::vector<std::string>& types, const Rgb& target, int minPct, int maxPct) {
    Recipe best;
    const size_t n = colours.size();
    if (n < 2 || maxPct < 50 || maxPct > 100) return best;
    std::vector<Rgb> palette;
    std::vector<Lab> paletteLab;
    for (const std::string& h : colours) {
        palette.push_back(parseRgb(h));
        paletteLab.push_back(toLab(palette.back()));
    }
    const Lab targetLab = toLab(target);
    const int minW = std::max(1, std::clamp(minPct, 0, 50));
    std::vector<std::vector<bool>> compat(n, std::vector<bool>(n, true));
    for (size_t i = 0; i < n; ++i)
        for (size_t j = i + 1; j < n; ++j) compat[i][j] = compat[j][i] = compatible(types, {unsigned(i + 1), unsigned(j + 1)});

    // Pair LUT (polynomial mixing -> Lab).
    std::vector<std::vector<std::array<Lab, 101>>> lut(n);
    for (size_t a = 0; a < n; ++a) {
        lut[a].resize(n);
        for (size_t b = a + 1; b < n; ++b)
            for (int p = 0; p <= 100; ++p) lut[a][b][p] = toLab(blendPair(palette[a], palette[b], p / 100.f));
    }
    auto updatePair = [&](unsigned a, unsigned b, int pct, double de) {
        if (!best.valid || de + 1e-6 < best.deltaE) {
            best = Recipe{true, a, b, pct, "", "", blendPair(palette[a - 1], palette[b - 1], pct / 100.f), de};
        }
    };

    // Pair coarse scan (5%), keeping the 30 best for a 1% refinement.
    constexpr int kCoarse = 5, kTopCoarse = 30;
    using Entry = std::tuple<double, unsigned, unsigned, int>;
    auto cmp = [](const Entry& x, const Entry& y) { return std::get<0>(x) < std::get<0>(y); };
    std::priority_queue<Entry, std::vector<Entry>, decltype(cmp)> heap(cmp);
    for (size_t a = 0; a < n; ++a)
        for (size_t b = a + 1; b < n; ++b) {
            if (!compat[a][b]) continue;
            for (int p = std::max(minW, 100 - maxPct); p <= std::min(100 - minW, maxPct); p += kCoarse) {
                const double de = deltaE00(targetLab, lut[a][b][p]);
                updatePair(unsigned(a + 1), unsigned(b + 1), p, de);
                if (heap.size() < kTopCoarse) heap.emplace(de, unsigned(a + 1), unsigned(b + 1), p);
                else if (de < std::get<0>(heap.top())) {
                    heap.pop();
                    heap.emplace(de, unsigned(a + 1), unsigned(b + 1), p);
                }
            }
        }
    while (!heap.empty()) {
        auto [de, a, b, cp] = heap.top();
        heap.pop();
        const int lo = std::max(std::max(minW, 100 - maxPct), cp - kCoarse + 1);
        const int hi = std::min(std::min(100 - minW, maxPct), cp + kCoarse - 1);
        for (int p = lo; p <= hi; ++p) {
            if ((p - minW) % kCoarse == 0) continue;
            updatePair(a, b, p, deltaE00(targetLab, lut[a - 1][b - 1][p]));
        }
    }
    Recipe bestPair = best;
    if (bestPair.valid && bestPair.deltaE <= 0.5) return bestPair;

    // Triples among the 8 filaments closest to the target.
    std::vector<std::pair<double, unsigned>> ranked;
    for (size_t i = 0; i < n; ++i) ranked.emplace_back(deltaE00(targetLab, paletteLab[i]), unsigned(i + 1));
    std::sort(ranked.begin(), ranked.end());
    std::vector<unsigned> pool;
    for (size_t i = 0; i < std::min<size_t>(n, 8); ++i) pool.push_back(ranked[i].second);
    if (pool.size() >= 3) {
        std::sort(pool.begin(), pool.end());
        constexpr int kTripleCoarse = 10, kTopTriple = 20;
        struct Triple {
            double de;
            unsigned a, b, c;
            int wa, wb;
            bool operator<(const Triple& o) const { return de < o.de; }
        };
        std::priority_queue<Triple> theap;
        auto updateTriple = [&](unsigned a, unsigned b, unsigned c, int wa, int wb, int wc, double de) {
            if (!best.valid || de + 1e-6 < best.deltaE) {
                best = Recipe{true, a, b, wa + wb > 0 ? int(std::lround(100.0 * wb / (wa + wb))) : 50,
                              MixedFilamentManager::encode_gradient_component_ids({a, b, c}), encodeWeights({wa, wb, wc}),
                              blendMulti({palette[a - 1], palette[b - 1], palette[c - 1]}, {double(wa), double(wb), double(wc)}), de};
            }
        };
        for (size_t i = 0; i + 2 < pool.size(); ++i)
            for (size_t j = i + 1; j + 1 < pool.size(); ++j)
                for (size_t k = j + 1; k < pool.size(); ++k) {
                    const unsigned a = pool[i], b = pool[j], c = pool[k];
                    if (!compat[a - 1][b - 1] || !compat[b - 1][c - 1] || !compat[a - 1][c - 1]) continue;
                    for (int wa = minW; wa <= std::min(100 - 2 * minW, maxPct); wa += kTripleCoarse)
                        for (int wb = minW; wb <= std::min(100 - wa - minW, maxPct); wb += kTripleCoarse) {
                            const int wc = 100 - wa - wb;
                            if (wc < minW || wc > maxPct) continue;
                            const double de = deltaE00(targetLab, blendWeightedLab(palette, {a, b, c}, {wa, wb, wc}));
                            updateTriple(a, b, c, wa, wb, wc, de);
                            if (theap.size() < kTopTriple) theap.push({de, a, b, c, wa, wb});
                            else if (de < theap.top().de) {
                                theap.pop();
                                theap.push({de, a, b, c, wa, wb});
                            }
                        }
                }
        while (!theap.empty()) {
            const Triple te = theap.top();
            theap.pop();
            for (int wa = std::max(minW, te.wa - kTripleCoarse + 1); wa <= std::min(std::min(100 - 2 * minW, maxPct), te.wa + kTripleCoarse - 1); ++wa) {
                if ((wa - minW) % kTripleCoarse == 0) continue;
                for (int wb = std::max(minW, te.wb - kTripleCoarse + 1); wb <= std::min(std::min(100 - wa - minW, maxPct), te.wb + kTripleCoarse - 1); ++wb) {
                    if ((wb - minW) % kTripleCoarse == 0) continue;
                    const int wc = 100 - wa - wb;
                    if (wc < minW || wc > maxPct) continue;
                    updateTriple(te.a, te.b, te.c, wa, wb, wc, deltaE00(targetLab, blendWeightedLab(palette, {te.a, te.b, te.c}, {wa, wb, wc})));
                }
            }
        }
    }

    // Re-evaluate both on the final colours; prefer the pair unless the triple is visibly closer.
    if (best.valid) best.deltaE = deltaE00(targetLab, toLab(best.preview));
    if (bestPair.valid) {
        bestPair.deltaE = deltaE00(targetLab, toLab(bestPair.preview));
        if (!best.valid || bestPair.deltaE + 1e-6 < best.deltaE) best = bestPair;
        else if (!best.ids.empty() && bestPair.deltaE <= best.deltaE + 0.5) best = bestPair;
    }
    return best;
}

// mixedMatch({colours, types, target: "#RRGGBB", minPercent, maxPercent}):
// the closest mix of the physical filaments to `target`, as desktop's Match
// mode finds it. Returns {valid, componentA, componentB, mixBPercent,
// gradientIds, gradientWeights, colour, deltaE}.
std::string mixedMatch(const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        std::vector<std::string> colours, types;
        for (const auto& c : req.at("colours")) colours.push_back(c.get<std::string>());
        for (const auto& t : req.value("types", json::array())) types.push_back(t.get<std::string>());
        const Recipe r = bestRecipe(colours, types, parseRgb(req.value("target", std::string("#808080"))), req.value("minPercent", 15),
                                    req.value("maxPercent", 100));
        return json{{"valid", r.valid},
                    {"componentA", r.a},
                    {"componentB", r.b},
                    {"mixBPercent", r.mixB},
                    {"gradientIds", r.ids},
                    {"gradientWeights", r.weights},
                    {"colour", hexOf(r.preview)},
                    {"deltaE", std::isfinite(r.deltaE) ? r.deltaE : -1.0}}
            .dump();
    } catch (const std::exception& e) {
        return fail(e.what()).dump();
    }
}

} // namespace

EMSCRIPTEN_BINDINGS(mixed_api) {
    emscripten::function("mixedFilaments", &mixedFilaments);
    emscripten::function("mixedBlend", &mixedBlend);
    emscripten::function("mixedMatch", &mixedMatch);
}

// Undo and redo of project edits, like desktop's Ctrl+Z / Ctrl+Y.
//
// Desktop (slic3r/Utils/UndoRedo.cpp) keeps snapshots of the Model, sharing
// the meshes between them. A Model copy here does the same: ModelVolume
// copies share their TriangleMesh, so a snapshot costs the object tree,
// transforms, settings and paint, not the geometry. Object and volume IDs are
// kept by the copy, so the paint caches keyed on them stay valid.
//
// The page takes a snapshot (with a label such as "Move") before each edit;
// opening a project or a calibration test clears the history.
#include "engine.hpp"

#include <memory>

using namespace Slic3r;
using json = nlohmann::json;

namespace {

struct State {
    std::string label;  // the edit made after this state was taken
    Model model;
    std::vector<PlateData> plates;
    int plateCount = 1;
};

constexpr size_t LIMIT = 50;
std::vector<std::unique_ptr<State>> g_undo, g_redo;

std::unique_ptr<State> capture(const std::string& label) {
    const engine::Project& p = engine::project();
    auto s = std::make_unique<State>();
    s->label = label;
    s->model = p.model;
    for (const PlateData* d : p.plates) s->plates.push_back(*d);
    s->plateCount = p.plateCount;
    return s;
}

void restore(State& s) {
    engine::Project& p = engine::project();
    p.model = std::move(s.model);
    release_PlateData_list(p.plates);
    for (const PlateData& d : s.plates) p.plates.push_back(new PlateData(d));
    p.plateCount = s.plateCount;
}

std::string status() {
    json out{{"ok", true}, {"undo", nullptr}, {"redo", nullptr}};
    if (!g_undo.empty()) out["undo"] = g_undo.back()->label;
    if (!g_redo.empty()) out["redo"] = g_redo.back()->label;
    return out.dump();
}

std::string fail(const std::string& error) { return json{{"ok", false}, {"error", error}}.dump(); }

// Remembers the project as it is now, before an edit called `label`.
std::string snapshot(const std::string& label) {
    try {
        g_undo.push_back(capture(label));
        if (g_undo.size() > LIMIT) g_undo.erase(g_undo.begin());
        g_redo.clear();
        return status();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

// Drops the last snapshot, when the edit it was taken for failed.
std::string dropSnapshot() {
    if (!g_undo.empty()) g_undo.pop_back();
    return status();
}

// Moves one step between the stacks: the current project goes on `to`, the
// top of `from` becomes the project.
std::string step(std::vector<std::unique_ptr<State>>& from, std::vector<std::unique_ptr<State>>& to, const char* empty) {
    try {
        if (from.empty()) return fail(empty);
        std::unique_ptr<State> target = std::move(from.back());
        from.pop_back();
        to.push_back(capture(target->label));
        restore(*target);
        return status();
    } catch (const std::exception& e) {
        return fail(e.what());
    }
}

std::string undo() { return step(g_undo, g_redo, "nothing to undo"); }
std::string redo() { return step(g_redo, g_undo, "nothing to redo"); }

std::string clearHistory() {
    g_undo.clear();
    g_redo.clear();
    return status();
}

} // namespace

void engine::clearUndoHistory() { clearHistory(); }

EMSCRIPTEN_BINDINGS(history_api) {
    emscripten::function("snapshot", &snapshot);
    emscripten::function("dropSnapshot", &dropSnapshot);
    emscripten::function("undo", &undo);
    emscripten::function("redo", &redo);
    emscripten::function("clearHistory", &clearHistory);
    emscripten::function("historyStatus", &status);
}

// Text shapes, like desktop Orca's Text tool (GLGizmoEmboss): text in a
// TrueType font made into a part, negative part or modifier of an object, or
// a new object of its own, and edited later. The text and its font settings
// stay on the volume (ModelVolume::text_configuration and emboss_shape), so a
// 3MF keeps them for desktop and for this page. The placing and meshing of
// a shape is shared with SVG shapes (svg_api.cpp).
#include "engine.hpp"

#include "libslic3r/Emboss.hpp"
#include "libslic3r/TriangleMesh.hpp"

#include <boost/nowide/convert.hpp>

#include <algorithm>
#include <cwctype>

using nlohmann::json;
using namespace Slic3r;

namespace {

engine::Project& pr() { return engine::project(); }

ModelVolumeType typeOf(const std::string& kind) {
    if (kind == "part") return ModelVolumeType::MODEL_PART;
    if (kind == "negative") return ModelVolumeType::NEGATIVE_VOLUME;
    if (kind == "modifier") return ModelVolumeType::PARAMETER_MODIFIER;
    throw std::runtime_error("text can be a part, negative part or modifier, not " + kind);
}

// The style the request asks for: font settings as desktop keeps them.
TextConfiguration configFrom(const json& req) {
    TextConfiguration tc;
    tc.text = req.value("text", "");
    EmbossStyle& style = tc.style;
    style.name = req.value("font", "");
    style.path = style.name;
    style.type = EmbossStyle::Type::file_path;
    FontProp& fp = style.prop;
    fp.size_in_mm = std::clamp(req.value("size", 10.f), 0.1f, 1000.f);
    if (req.contains("boldness") && req["boldness"].get<float>() != 0) fp.boldness = req["boldness"].get<float>();
    if (req.contains("skew") && req["skew"].get<float>() != 0) fp.skew = req["skew"].get<float>();
    if (req.contains("charGap") && req["charGap"].get<int>() != 0) fp.char_gap = req["charGap"].get<int>();
    if (req.contains("lineGap") && req["lineGap"].get<int>() != 0) fp.line_gap = req["lineGap"].get<int>();
    const std::string h = req.value("align", "center");
    fp.align.first = h == "left" ? FontProp::HorizontalAlign::left : h == "right" ? FontProp::HorizontalAlign::right : FontProp::HorizontalAlign::center;
    const std::string vert = req.value("valign", "center");
    fp.align.second = vert == "top" ? FontProp::VerticalAlign::top : vert == "bottom" ? FontProp::VerticalAlign::bottom : FontProp::VerticalAlign::center;
    fp.per_glyph = req.value("perGlyph", false);
    fp.face_name = style.name;
    return tc;
}

// Right-to-left writing (Hebrew, Arabic). Orca's Emboss lays the characters
// out left to right in the order they were typed, so Hebrew came out
// backwards (desktop does the same). Each line is put into the order it is
// read on the page first: a small version of the Unicode bidirectional
// algorithm (strong letters, numbers, neutrals between them, and marks kept
// with their letter), enough for words, numbers and punctuation. The text
// itself is kept as typed. Arabic letters are not joined (no shaping).
namespace bidi {

enum class Kind { L, R, Number, Neutral, Mark };

bool isRtl(wchar_t c) {
    return (c >= 0x05BE && c <= 0x05FF && c != 0x05BF && c != 0x05C1 && c != 0x05C2 && c != 0x05C4 && c != 0x05C5 && c != 0x05C7) ||  // Hebrew letters
           (c >= 0x0600 && c <= 0x07BF && !(c >= 0x064B && c <= 0x065F) && c != 0x0670 && !(c >= 0x0660 && c <= 0x0669)) ||  // Arabic, Syriac, Thaana
           (c >= 0x0860 && c <= 0x08FF && c < 0x08D3) || (c >= 0xFB1D && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF) || (c >= 0x10800 && c <= 0x10FFF);
}
bool isMark(wchar_t c) {
    return (c >= 0x0591 && c <= 0x05C7 && !isRtl(c)) || (c >= 0x064B && c <= 0x065F) || c == 0x0670 || (c >= 0x0300 && c <= 0x036F) || (c >= 0xFE00 && c <= 0xFE0F) ||
           c == 0x200D || c == 0x200C;
}
Kind kindOf(wchar_t c) {
    if (isMark(c)) return Kind::Mark;
    if (isRtl(c)) return Kind::R;
    if ((c >= '0' && c <= '9') || (c >= 0x0660 && c <= 0x0669) || (c >= 0x06F0 && c <= 0x06F9)) return Kind::Number;
    if (c < 0x80) return ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) ? Kind::L : Kind::Neutral;
    if ((c >= 0x00A0 && c <= 0x00BF) || c == 0x00D7 || c == 0x00F7 || (c >= 0x2000 && c <= 0x2BFF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0xFE10 && c <= 0xFE6F) ||
        (c >= 0xFF00 && c <= 0xFF20))
        return Kind::Neutral;
    return Kind::L;
}
wchar_t mirrored(wchar_t c) {
    switch (c) {
    case '(': return ')'; case ')': return '(';
    case '[': return ']'; case ']': return '[';
    case '{': return '}'; case '}': return '{';
    case '<': return '>'; case '>': return '<';
    case 0x00AB: return 0x00BB; case 0x00BB: return 0x00AB;
    default: return c;
    }
}

std::wstring line(const std::wstring& text) {
    const size_t n = text.size();
    std::vector<Kind> kinds(n);
    bool anyRtl = false;
    for (size_t i = 0; i < n; ++i) anyRtl |= (kinds[i] = kindOf(text[i])) == Kind::R;
    if (!anyRtl) return text;
    // The line's own direction: its first letter's.
    bool rtl = false;
    for (Kind k : kinds)
        if (k == Kind::L || k == Kind::R) {
            rtl = k == Kind::R;
            break;
        }
    const int base = rtl ? 1 : 0;
    std::vector<int> level(n, base);
    // Letters, and numbers (always read left to right, inside right-to-left words a level up).
    Kind lastStrong = rtl ? Kind::R : Kind::L;
    for (size_t i = 0; i < n; ++i) {
        if (kinds[i] == Kind::L) level[i] = rtl ? 2 : 0, lastStrong = Kind::L;
        else if (kinds[i] == Kind::R) level[i] = 1, lastStrong = Kind::R;
        else if (kinds[i] == Kind::Number) level[i] = lastStrong == Kind::R ? 2 : (rtl ? 2 : 0);
    }
    // Neutrals between two runs of the same direction take it (numbers count as
    // right to left there), the rest the line's; marks go with their letter.
    auto dir = [&](size_t i) { return kinds[i] == Kind::L ? 0 : 1; };
    for (size_t i = 0; i < n;) {
        if (kinds[i] != Kind::Neutral && kinds[i] != Kind::Mark) {
            ++i;
            continue;
        }
        size_t j = i;
        while (j < n && (kinds[j] == Kind::Neutral || kinds[j] == Kind::Mark)) ++j;
        const int before = i == 0 ? base : dir(i - 1);
        const int after = j == n ? base : dir(j);
        for (size_t k = i; k < j; ++k) {
            if (kinds[k] == Kind::Mark && k > 0) level[k] = level[k - 1];
            else level[k] = before == after ? (before == 1 ? 1 : (rtl ? 2 : 0)) : base;
        }
        i = j;
    }
    // Marks follow their letter: a letter and its marks move as one.
    std::vector<std::pair<size_t, size_t>> units;  // [start, end)
    for (size_t i = 0; i < n; ++i) {
        if (kinds[i] == Kind::Mark && !units.empty()) units.back().second = i + 1;
        else units.push_back({i, i + 1});
    }
    std::vector<int> unitLevel(units.size());
    for (size_t u = 0; u < units.size(); ++u) unitLevel[u] = level[units[u].first];
    std::vector<size_t> order(units.size());
    for (size_t u = 0; u < order.size(); ++u) order[u] = u;
    // From the highest level down to 1, each run at or above it turns round.
    const int top = *std::max_element(unitLevel.begin(), unitLevel.end());
    for (int lv = top; lv >= 1; --lv)
        for (size_t i = 0; i < order.size();) {
            if (unitLevel[order[i]] < lv) {
                ++i;
                continue;
            }
            size_t j = i;
            while (j < order.size() && unitLevel[order[j]] >= lv) ++j;
            std::reverse(order.begin() + i, order.begin() + j);
            i = j;
        }
    std::wstring out;
    out.reserve(n);
    for (size_t u : order)
        for (size_t k = units[u].first; k < units[u].second; ++k) out.push_back(level[k] % 2 ? mirrored(text[k]) : text[k]);
    return out;
}

} // namespace bidi

// The text in the order it is read on the page, line by line.
std::wstring visualOrder(const std::wstring& text) {
    std::wstring out;
    size_t start = 0;
    while (true) {
        const size_t end = text.find(L'\n', start);
        out += bidi::line(text.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start));
        if (end == std::wstring::npos) break;
        out += L'\n';
        start = end + 1;
    }
    return out;
}

// TextDataBase::create_shape: the letters' outlines in the font, into shape
// (its depth and surface setting kept). Returns the font, which per glyph needs.
Emboss::FontFileWithCache textOutlines(const std::string& fontPath, const TextConfiguration& tc, EmbossShape& shape) {
    if (fontPath.empty()) throw std::runtime_error("this text's font isn't on this device; pick a font in the Text tool first");
    std::unique_ptr<Emboss::FontFile> file = Emboss::create_font_file(fontPath.c_str());
    if (!file) throw std::runtime_error("this font can't be read; pick another one (TrueType or OpenType)");
    Emboss::FontFileWithCache font(std::move(file));
    const FontProp& fp = tc.style.prop;
    shape.scale = Emboss::get_text_shape_scale(fp, *font.font_file);
    shape.shapes_with_ids = Emboss::text2vshapes(font, visualOrder(boost::nowide::widen(tc.text)), fp);
    shape.final_shape = {};
    return font;
}

// The characters of the text the font has no letter for (desktop warns of
// them too; Emboss leaves them out), each once.
std::string missingLetters(const Emboss::FontFileWithCache& font, const std::string& text) {
    const std::wstring known = boost::nowide::widen(Emboss::create_range_text(text, *font.font_file, 0));
    std::wstring missing;
    for (wchar_t c : boost::nowide::widen(text))
        if (!std::iswspace(c) && known.find(c) == std::wstring::npos && missing.find(c) == std::wstring::npos) missing.push_back(c);
    return boost::nowide::narrow(missing);
}

// The text's mesh where volume v stands (flat on a new volume).
TriangleMesh textMesh(const ModelVolume* v, const Emboss::FontFileWithCache& font, const TextConfiguration& tc, bool outside, EmbossShape& shape) {
    TriangleMesh mesh = v ? engine::shapeMesh(*v, shape, outside, &font, &tc) : engine::embossMesh(shape, shape.projection.depth, outside);
    if (mesh.empty()) throw std::runtime_error("the text has no letters this font can draw");
    return mesh;
}

std::string volumeName(std::string text) {
    std::replace(text.begin(), text.end(), '\n', ' ');
    return text;
}

// Object o (or -1 for a new object on `plate`), request:
//   {op: "add", type: part|negative|modifier, text, font, fontPath, size, depth,
//    boldness?, skew?, charGap?, lineGap?, align: left|center|right,
//    valign: top|center|bottom, useSurface?, perGlyph?,
//    camera?: [x, y, z]}   on object o: onto the surface the camera sees, else in front of it
//   {op: "update", volume, ...the same}   new text or style for a text volume, where it stands
// font is the font's name (kept with the text); fontPath the font file in the engine's files.
// useSurface: the text follows the object's surface (desktop's "Use surface");
// perGlyph: each letter is set on the surface on its own ("Per glyph").
// Returns {ok, object, volume, error?}.
std::string textVolume(int o, int plate, const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        const TextConfiguration tc = configFrom(req);
        if (tc.text.find_first_not_of(" \n\t") == std::string::npos) throw std::runtime_error("type some text first");
        const double depth = std::clamp(req.value("depth", 1.0), 0.01, 1e4);
        const std::string fontPath = req.value("fontPath", "");
        auto& objs = pr().model.objects;

        if (op == "update") {
            if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
            ModelObject* obj = objs[o];
            const int index = req.value("volume", -1);
            if (index < 0 || size_t(index) >= obj->volumes.size()) throw std::runtime_error("no part " + std::to_string(index));
            ModelVolume* v = obj->volumes[index];
            engine::unfixShape(*v);
            EmbossShape shape;
            shape.projection.depth = depth;
            const bool usedSurface = v->emboss_shape && v->emboss_shape->projection.use_surface;
            shape.projection.use_surface = req.value("useSurface", usedSurface);
            const Emboss::FontFileWithCache font = textOutlines(fontPath, tc, shape);
            // start_update_volume: newly following the surface, the text first moves onto it.
            const Geometry::Transformation was = v->get_transformation();
            if (shape.projection.use_surface && !usedSurface) engine::moveOntoSurface(*v);
            TriangleMesh mesh;
            try {
                mesh = textMesh(v, font, tc, v->is_model_part(), shape);
            } catch (...) {
                v->set_transformation(was);
                throw;
            }
            engine::updateEmbossVolume(obj, v, std::move(mesh), volumeName(tc.text));
            v->text_configuration = tc;
            v->emboss_shape = std::move(shape);
            return json{{"ok", true}, {"object", o}, {"volume", index}, {"missing", missingLetters(font, tc.text)}}.dump();
        }
        if (op != "add") throw std::runtime_error("unknown text action " + op);

        const ModelVolumeType type = typeOf(req.value("type", "part"));
        EmbossShape shape;
        shape.projection.depth = depth;
        const Emboss::FontFileWithCache font = textOutlines(fontPath, tc, shape);
        const bool onSurface = req.value("useSurface", false);
        TriangleMesh mesh = textMesh(nullptr, font, tc, type == ModelVolumeType::MODEL_PART, shape);

        if (o < 0) {
            // CreateObjectJob without a surface: the text alone, lying on the bed.
            if (type != ModelVolumeType::MODEL_PART) throw std::runtime_error("only a text part can be an object of its own");
            TextConfiguration alone = tc;
            alone.style.prop.per_glyph = false;
            const int object = engine::addEmbossObject(plate, std::move(mesh), volumeName(tc.text), std::move(shape), alone);
            return json{{"ok", true}, {"object", object}, {"volume", 0}, {"missing", missingLetters(font, tc.text)}}.dump();
        }

        const int volume = engine::addEmbossVolume(o, plate, req, std::move(mesh), type, volumeName(tc.text), std::move(shape), tc);
        if (onSurface || tc.style.prop.per_glyph) {
            // start_create_volume_on_surface_job: made again to follow the
            // surface it landed on; flat and plain when there is none.
            ModelObject* obj = objs[o];
            ModelVolume* v = obj->volumes[volume];
            v->emboss_shape->projection.use_surface = onSurface;
            try {
                engine::updateEmbossVolume(obj, v, textMesh(v, font, tc, v->is_model_part(), *v->emboss_shape), volumeName(tc.text));
            } catch (const std::exception&) {
                v->emboss_shape->projection.use_surface = false;
                v->text_configuration->style.prop.per_glyph = false;
            }
        }
        return json{{"ok", true}, {"object", o}, {"volume", volume}, {"missing", missingLetters(font, tc.text)}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

namespace engine {

namespace {

// Where a shape on object o goes when the request has the camera's position
// (plate coordinates): its transformation in the object, onto the surface a
// ray from the camera to the middle of the object meets first (desktop aims
// at the selected object from the view), or nothing when it misses.
std::optional<Transform3d> surfaceSeenFrom(ModelObject* obj, int o, int plate, const json& req) {
    if (!req.contains("camera") || obj->instances.empty()) return std::nullopt;
    const json& cam = req["camera"];
    const Vec3d s(cam[0].get<double>(), cam[1].get<double>(), cam[2].get<double>());
    const ModelInstance* inst = obj->instances.front();
    for (const ModelInstance* i : obj->instances)
        if (project().plateOf(*i) == plate) inst = i;
    const Vec2d origin = project().plateOrigin(plate);
    const BoundingBoxf3 box = obj->instance_bounding_box(*inst, false);
    const Vec3d centre = box.center() - Vec3d(origin.x(), origin.y(), 0);
    // The middle can be a hole (a Benchy's cabin windows), so then try points
    // around it, nearest first.
    std::optional<RayHit> hit;
    for (double r : {0., 0.2, 0.35}) {
        for (int k = 0; k < (r == 0 ? 1 : 8) && !hit; ++k) {
            const double a = k * PI / 4;
            const Vec3d at = centre + Vec3d(r * box.size().x() * std::cos(a), r * box.size().y() * std::sin(a), r * box.size().z() * std::sin(a));
            hit = castRay(plate, s, (at - s).normalized());
            if (hit && (hit->object != o || hit->facet < 0)) hit.reset();
        }
        if (hit) break;
    }
    if (!hit) return std::nullopt;
    const indexed_triangle_set& its = hit->volume->mesh().its;
    const stl_triangle_vertex_indices& f = its.indices[hit->facet];
    const Vec3d a = its.vertices[f[0]].cast<double>(), b = its.vertices[f[1]].cast<double>(), c = its.vertices[f[2]].cast<double>();
    const Vec3d normal = (hit->trafo.linear().inverse().transpose() * (b - a).cross(c - a)).normalized();
    const Vec3d position = hit->trafo * hit->point.cast<double>();
    constexpr double UP_LIMIT = 0.9;  // desktop's SurfaceDrag.hpp
    const Transform3d onto = Emboss::create_transformation_onto_surface(position, normal, UP_LIMIT);
    return hit->inst->get_matrix().inverse() * onto;
}

int indexOf(const ModelObject* obj, const ModelVolume* v) {
    const auto it = std::find(obj->volumes.begin(), obj->volumes.end(), v);
    return it == obj->volumes.end() ? -1 : int(it - obj->volumes.begin());
}

} // namespace

TriangleMesh embossMesh(EmbossShape& shape, double depth, bool outside) {
    // try_create_mesh: healed outlines, projected along z (SHAPE_SCALE is applied in ProjectZ).
    shape.projection.depth = depth;
    const ExPolygons shapes = union_with_delta(shape, Emboss::UNION_DELTA, Emboss::UNION_MAX_ITERATIN);
    if (shapes.empty()) return {};
    Emboss::ProjectTransform project(std::make_unique<Emboss::ProjectZ>(depth / shape.scale),
                                     Eigen::Translation<double, 3>(0., 0., outside ? -embossSurfaceOffset : embossSurfaceOffset - depth) *
                                         Eigen::Scaling(shape.scale));
    return TriangleMesh(Emboss::polygons2model(shapes, project));
}

int addEmbossObject(int plate, TriangleMesh&& mesh, const std::string& name, EmbossShape&& shape, const std::optional<TextConfiguration>& text) {
    Project& p = project();
    ModelObject* obj = p.model.add_object();
    obj->name = name;
    ModelVolume* v = obj->add_volume(std::move(mesh));
    v->name = name;
    v->source.is_from_builtin_objects = true;
    v->text_configuration = text;
    v->emboss_shape = std::move(shape);
    obj->add_instance();
    obj->invalidate_bounding_box();
    placeObject(obj, std::clamp(plate, 0, p.plateCount - 1));
    return int(p.model.objects.size()) - 1;
}

int addEmbossVolume(int o, int plate, const json& req, TriangleMesh&& mesh, ModelVolumeType type, const std::string& name, EmbossShape&& shape,
                    const std::optional<TextConfiguration>& text) {
    auto& objs = project().model.objects;
    if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
    ModelObject* obj = objs[o];
    ModelVolume* v = obj->add_volume(make_cube(1., 1., 1.), type);
    v->set_mesh(std::move(mesh));  // after add_volume, so the shape keeps its own origin
    v->calculate_convex_hull();
    v->config.set_key_value("extruder", new ConfigOptionInt(0));
    v->source.is_from_builtin_objects = true;
    v->name = name;
    if (const std::optional<Transform3d> onSurface = surfaceSeenFrom(obj, o, plate, req)) {
        // start_create_volume_on_surface_job: on the object's surface facing
        // the camera, standing out of it, kept upright.
        v->set_transformation(*onSurface);
    } else {
        // create_volume without a position: flat, in front of the object, on the bed.
        const ModelInstance* inst = obj->instances.front();
        const BoundingBoxf3 instanceBox = obj->instance_bounding_box(*inst, false);
        const BoundingBoxf3 box = v->mesh().bounding_box();
        const Vec3d at(instanceBox.center().x(), instanceBox.min.y() - box.size().y() / 2, instanceBox.min.z() - box.min.z());
        v->set_transformation(inst->get_matrix().inverse() * Eigen::Translation3d(at));
    }
    v->text_configuration = text;
    v->emboss_shape = std::move(shape);
    obj->sort_volumes(true);
    obj->invalidate_bounding_box();
    if (v->is_model_part()) obj->ensure_on_bed();
    return indexOf(obj, v);
}

void remakeShape(ModelObject* obj, ModelVolume* v, const std::string& fontPath) {
    if (!v->emboss_shape) return;
    EmbossShape& shape = *v->emboss_shape;
    if (v->text_configuration) {
        const Emboss::FontFileWithCache font = textOutlines(fontPath, *v->text_configuration, shape);
        updateEmbossVolume(obj, v, textMesh(v, font, *v->text_configuration, v->is_model_part(), shape), v->name);
        return;
    }
    if (shape.shapes_with_ids.empty()) svgOutlines(*v);
    TriangleMesh mesh = shapeMesh(*v, shape, v->is_model_part(), nullptr, nullptr);
    if (mesh.empty()) throw std::runtime_error("the shape has no paths to make it from");
    updateEmbossVolume(obj, v, std::move(mesh), v->name);
}

void updateEmbossVolume(ModelObject* obj, ModelVolume* v, TriangleMesh&& mesh, const std::string& name) {
    v->set_mesh(std::move(mesh));
    v->set_new_unique_id();
    v->calculate_convex_hull();
    v->name = name;
    // update_name_in_list: a shape that is the whole object names it too.
    if (obj->volumes.size() == 1) obj->name = name;
    obj->invalidate_bounding_box();
    if (v->is_model_part()) obj->ensure_on_bed();
}

} // namespace engine

EMSCRIPTEN_BINDINGS(text_api) {
    emscripten::function("textVolume", &textVolume);
    emscripten::function("textVisualOrder", +[](const std::string& text) { return boost::nowide::narrow(visualOrder(boost::nowide::widen(text))); });
}

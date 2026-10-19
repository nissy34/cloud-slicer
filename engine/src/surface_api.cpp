// Text and SVG shapes on an object's surface, like desktop Orca's Text and SVG
// tools: sliding a shape over the surface (SurfaceDrag.cpp), turning it about
// its own axis, its distance from the surface, facing the camera, and the
// meshes that follow the surface: "Use surface" cuts the outlines out of the
// object's surface (EmbossJob's cut_surface), "Per glyph" sets each letter on
// the surface on its own (TextLines.cpp, create_mesh_per_glyph).
#include "engine.hpp"

#include "libslic3r/AABBMesh.hpp"
#include "libslic3r/AABBTreeLines.hpp"
#include "libslic3r/ClipperUtils.hpp"
#include "libslic3r/CutSurface.hpp"
#include "libslic3r/Emboss.hpp"
#include "libslic3r/ExPolygonsIndex.hpp"
#include "libslic3r/TriangleMesh.hpp"
#include "libslic3r/TriangleMeshSlicer.hpp"

#include <algorithm>
#include <cmath>

using nlohmann::json;
using namespace Slic3r;
using namespace Slic3r::Emboss;

namespace {

// SurfaceDrag.hpp / EmbossJob.cpp constants.
constexpr double UP_LIMIT = 0.9;
constexpr float SAFE_EXTENSION = 1.0f;          // safe_extension
constexpr double SURFACE_DISTANCE_MIN_SQ = 1e-4;  // surface_distance_sq
constexpr double SURFACE_DISTANCE_MAX_SQ = 10.;
constexpr double ASCENT_RATIO_OFFSET = 1 / 3.;  // TextLinesModel::ascent_ratio_offset

// The object's other parts, the surface a shape lies on (create_sources,
// prepare_volumes_to_slice): model parts only, in object coordinates.
std::vector<const ModelVolume*> surfaceParts(const ModelVolume& v) {
    std::vector<const ModelVolume*> out;
    for (const ModelVolume* p : v.get_object()->volumes)
        if (p != &v && p->is_model_part() && !p->mesh().its.empty()) out.push_back(p);
    return out;
}

// create_projection_for_cut
OrthoProject projectionForCut(Transform3d tr, double shapeScale, const std::pair<float, float>& zRange) {
    const double minZ = zRange.first - SAFE_EXTENSION, maxZ = zRange.second + SAFE_EXTENSION;
    const Vec3d direction = tr.linear() * Vec3d(0., 0., maxZ - minZ);
    tr.translate(Vec3d(0., 0., minZ));
    tr.scale(shapeScale);
    return OrthoProject(tr, direction);
}

// create_emboss_projection
OrthoProject3d embossProjection(bool outside, float depth, Transform3d tr, SurfaceCut& cut) {
    const float front = outside ? depth : engine::embossSurfaceOffset;
    const float back = -(outside ? engine::embossSurfaceOffset : depth);
    its_transform(cut, tr.pretranslate(Vec3d(0., 0., front)));
    return OrthoProject3d(Vec3d(0., 0., back - front));
}

// cut_surface_to_its: the outlines `shapes` placed by tr (volume in object
// coordinates) cut out of the parts' surface and given depth along it.
indexed_triangle_set cutToSurface(const ExPolygons& shapes, const Transform3d& tr, const std::vector<const ModelVolume*>& parts, double shapeScale,
                                  double depth, bool outside) {
    if (parts.empty()) return {};
    const BoundingBox bb = get_extents(shapes);
    const ModelVolume* biggest = parts.front();
    size_t biggestCount = 0;
    std::vector<size_t> toItss(parts.size(), std::numeric_limits<size_t>::max());
    std::vector<indexed_triangle_set> itss;
    for (size_t s = 0; s < parts.size(); ++s) {
        const Transform3d cutTr = parts[s]->get_matrix().inverse() * tr;
        indexed_triangle_set its = its_cut_AoI(parts[s]->mesh().its, bb, projectionForCut(cutTr, shapeScale, {0.f, 1.f}));
        if (its.indices.empty()) continue;
        if (biggestCount < its.vertices.size()) {
            biggestCount = its.vertices.size();
            biggest = parts[s];
        }
        toItss[s] = itss.size();
        itss.emplace_back(std::move(its));
    }
    if (itss.empty()) return {};

    const Transform3d trInv = biggest->get_matrix().inverse();
    const Transform3d cutTr = trInv * tr;
    const size_t biggestIndex = std::find(parts.begin(), parts.end(), biggest) - parts.begin();
    BoundingBoxf3 meshBox = bounding_box(itss[toItss[biggestIndex]]);
    for (size_t s = 0; s < parts.size(); ++s) {
        if (toItss[s] == std::numeric_limits<size_t>::max() || s == biggestIndex) continue;
        indexed_triangle_set& its = itss[toItss[s]];
        its_transform(its, Transform3d(parts[s]->get_matrix() * trInv), true);
        meshBox.merge(bounding_box(its));
    }

    const Transform3d embossTr = cutTr.inverse();
    const BoundingBoxf3 boxInText = meshBox.transformed(embossTr);
    const std::pair<float, float> zRange{float(boxInText.min.z()), float(boxInText.max.z())};
    const OrthoProject projection = projectionForCut(cutTr, shapeScale, zRange);
    const float ratio = (-zRange.first + SAFE_EXTENSION) / (zRange.second - zRange.first + 2 * SAFE_EXTENSION);

    ExPolygons reversed;
    const ExPolygons* use = &shapes;
    const bool reflected = has_reflection(tr);
    if (reflected) {
        reversed = shapes;
        for (ExPolygon& shape : reversed) {
            shape.contour.reverse();
            for (Slic3r::Polygon& hole : shape.holes) hole.reverse();
        }
        use = &reversed;
    }
    SurfaceCut cut = cut_surface(*use, itss, projection, ratio);
    if (reflected) {
        for (SurfaceCut::Contour& c : cut.contours) std::reverse(c.begin(), c.end());
        for (Vec3i32& t : cut.indices) std::swap(t[0], t[1]);
    }
    if (cut.empty()) return {};
    const OrthoProject3d emboss = embossProjection(outside, float(depth), embossTr, cut);
    return cut2model(cut, emboss);
}

inline Eigen::AngleAxis<double> lineRotation() { return Eigen::AngleAxis(-M_PI_2, Vec3d::UnitX()); }

// select_closest_contour
TextLines closestContours(const std::vector<Polygons>& lineContours) {
    TextLines result;
    for (const Polygons& polygons : lineContours) {
        if (polygons.empty()) {
            result.emplace_back();
            continue;
        }
        const ExPolygons expolygons = union_ex(polygons);
        const std::vector<Linef> lines = to_linesf(expolygons);
        const AABBTreeIndirect::Tree2d tree = AABBTreeLines::build_aabb_tree_over_indexed_lines(lines);
        size_t lineIndex = 0;
        Vec2d hit;
        AABBTreeLines::squared_distance_to_indexed_lines(lines, tree, Vec2d(0., 0.), lineIndex, hit);
        const ExPolygonsIndices cvt(expolygons);
        const ExPolygonsIndex index = cvt.cvt(static_cast<uint32_t>(lineIndex));
        const Slic3r::Polygon& polygon = index.is_contour() ? expolygons[index.expolygons_index].contour
                                                            : expolygons[index.expolygons_index].holes[index.hole_index()];
        result.push_back(TextLine{polygon, PolygonPoint{index.point_index, hit.cast<Point::coord_type>()}});
    }
    return result;
}

// TextLinesModel::init: each line of text's path over the object, the
// object's outline in the plane through the line's middle.
TextLines textLines(const Transform3d& textTr, const std::vector<const ModelVolume*>& parts, const FontFile& ff, const FontProp& fp,
                    unsigned countLines) {
    const double lineHeight = get_line_height(ff, fp) * get_text_shape_scale(fp, ff);
    if (lineHeight <= 0 || countLines == 0) return {};
    const double first = fp.size_in_mm * ASCENT_RATIO_OFFSET + get_align_y_offset_in_mm(fp.align.second, countLines, ff, fp);
    std::vector<float> centres(countLines);
    for (size_t i = 0; i < countLines; ++i) centres[i] = float(first - i * lineHeight);

    const Transform3d contourInv = (textTr * lineRotation()).inverse();
    const auto sliceAt = [&](float z, Polygons& contours) {
        for (const ModelVolume* part : parts) {
            MeshSlicingParams params;
            params.trafo = contourInv * part->get_matrix();
            const Polygons polys = slice_mesh(part->mesh().its, z, params);
            contours.insert(contours.end(), polys.begin(), polys.end());
        }
    };
    std::vector<Polygons> contours(countLines);
    for (size_t i = 0; i < countLines; ++i) sliceAt(centres[i], contours[i]);
    // A line off the object: its middle's outline instead.
    for (Polygons& c : contours)
        if (c.empty()) sliceAt(0.f, c);

    TextLines lines = closestContours(contours);
    for (size_t i = 0; i < countLines; ++i) lines[i].y = centres[i];
    return lines;
}

// create_line_bounds
std::vector<BoundingBoxes> lineBounds(const ExPolygonsWithIds& shapes, size_t countLines) {
    std::vector<BoundingBoxes> result(countLines);
    size_t line = 0;
    for (const ExPolygonsWithId& s : shapes) {
        BoundingBox bb;
        if (!s.expoly.empty()) bb = get_extents(s.expoly);
        result[std::min(line, countLines - 1)].push_back(bb);
        if (s.id == ENTER_UNICODE) ++line;
    }
    return result;
}

// create_mesh_per_glyph and cut_per_glyph_surface: each letter stood on the
// object's outline along its line, turned to face out of it, flat or cut
// out of the surface.
indexed_triangle_set perGlyphMesh(const EmbossShape& shape, const TextLines& lines, const Transform3d& tr,
                                  const std::vector<const ModelVolume*>& parts, bool useSurface, bool outside) {
    const std::vector<BoundingBoxes> bbs = lineBounds(shape.shapes_with_ids, lines.size());
    const double em2mm = 5.;  // desktop's "TODO: fix it" value
    const coord_t em2polygon = static_cast<coord_t>(std::round(scale_(em2mm)));
    indexed_triangle_set result;
    size_t offset = 0;
    for (size_t l = 0; l < lines.size(); ++l) {
        const BoundingBoxes& lineBbs = bbs[l];
        const TextLine& line = lines[l];
        if (line.polygon.empty()) {
            offset += lineBbs.size();
            continue;
        }
        const PolygonPoints samples = sample_slice(line, lineBbs, shape.scale);
        const std::vector<double> angles = calculate_angles(em2polygon, samples, line.polygon);
        for (size_t i = 0; i < lineBbs.size(); ++i) {
            const BoundingBox& bb = lineBbs[i];
            if (!bb.defined) continue;
            const Eigen::AngleAxisd rotate(angles[i] + M_PI_2, Vec3d::UnitY());
            const Vec2d at = unscale(samples[i].point);
            const Eigen::Translation<double, 3> offsetTr(at.x(), 0., -at.y());
            if (useSurface) {
                ExPolygons glyph = shape.shapes_with_ids[offset + i].expoly;
                const Point shift(-bb.center().x(), 0);
                for (ExPolygon& s : glyph) s.translate(shift);
                const Transform3d modify = offsetTr * rotate;
                indexed_triangle_set its = cutToSurface(glyph, Transform3d(tr * modify), parts, shape.scale, shape.projection.depth, outside);
                its_transform(its, modify);
                its_merge(result, std::move(its));
            } else {
                const Vec2d toZero = bb.center().cast<double>() * shape.scale;
                const float surfaceOffset = outside ? -engine::embossSurfaceOffset : float(-shape.projection.depth + engine::embossSurfaceOffset);
                const Eigen::Translation<double, 3> zero(-toZero.x(), 0., double(surfaceOffset));
                const Transform3d glyphTr = offsetTr * rotate * zero * Eigen::Scaling(shape.scale);
                ProjectTransform project(std::make_unique<ProjectZ>(shape.projection.depth / shape.scale), glyphTr);
                its_merge(result, polygons2model(shape.shapes_with_ids[offset + i].expoly, project));
            }
        }
        offset += lineBbs.size();
    }
    return result;
}

engine::Project& pr() { return engine::project(); }

// The volume's transformation in the world (bed coordinates) on instance i.
Transform3d worldOf(const ModelVolume& v, const ModelInstance& inst) { return inst.get_matrix() * v.get_matrix(); }

// A ray hitting the object's other parts on instance inst (RaycastManager with
// the shape skipped): world position and the face's world normal.
struct SurfaceHit {
    Vec3d position, normal;
    double distance;
};
std::optional<SurfaceHit> hitParts(const ModelVolume& v, const ModelInstance& inst, const Vec3d& s, const Vec3d& dir) {
    std::optional<SurfaceHit> best;
    for (const ModelVolume* part : surfaceParts(v)) {
        const Transform3d m = inst.get_matrix() * part->get_matrix();
        const Transform3d inv = m.inverse();
        const AABBMesh::hit_result h = engine::treeOf(*part).query_ray_hit(inv * s, (inv.linear() * dir).normalized());
        if (!h.is_hit()) continue;
        const Vec3d position = m * h.position();
        const double d = (position - s).norm();
        if (best && best->distance <= d) continue;
        const Vec3d normal = (m.linear().inverse().transpose() * h.normal()).normalized();
        best = SurfaceHit{position, normal, d};
    }
    return best;
}

// The surface point nearest p on the line through it along dir, either side,
// parts placed by outer * their matrix. From a point already on the surface a
// ray from p itself finds the wall's far side, so the ray starts outside.
std::optional<Vec3d> nearestAlong(const ModelVolume& v, const Transform3d& outer, const Vec3d& p, const Vec3d& dir) {
    std::optional<Vec3d> best;
    double bestSq = 0;
    for (const ModelVolume* part : surfaceParts(v)) {
        const Transform3d m = outer * part->get_matrix(), inv = m.inverse();
        const BoundingBoxf3 box = part->mesh().bounding_box().transformed(m);
        const double reach = box.size().norm() + (p - box.center()).norm();
        for (const AABBMesh::hit_result& h : engine::treeOf(*part).query_ray_hits(inv * (p - dir * reach), (inv.linear() * dir).normalized())) {
            if (!h.is_hit()) continue;
            const Vec3d at = m * h.position();
            const double sq = (at - p).squaredNorm();
            if (!best || sq < bestSq) best = at, bestSq = sq;
        }
    }
    return best;
}

// calc_distance: how far the shape's origin is from the surface behind it,
// along its own axis (null: on the surface, or no surface near).
std::optional<float> distanceOf(const ModelVolume& v, const ModelInstance& inst) {
    const Transform3d w = worldOf(v, inst);
    const Vec3d p = w.translation();
    const Vec3d dir = -w.linear().col(2).normalized();
    const std::optional<Vec3d> hit = nearestAlong(v, inst.get_matrix(), p, dir);
    if (!hit) return std::nullopt;
    const Vec3d toHit = *hit - p;
    const double sq = toHit.squaredNorm();
    if (sq < SURFACE_DISTANCE_MIN_SQ) return std::nullopt;
    const BoundingBoxf3 box = v.mesh().bounding_box().transformed(w);
    if (sq > std::max(std::pow(2 * box.size().z(), 2), SURFACE_DISTANCE_MAX_SQ)) return std::nullopt;
    return float((toHit.dot(dir) > 0 ? 1. : -1.) * std::sqrt(sq));
}

// get_volume_transformation: the shape turned so its axis points along
// worldDir and moved to worldPosition, kept upright when angle is set.
Transform3d volumeTransformation(Transform3d world, const Vec3d& worldDir, const Vec3d& worldPosition, const Transform3d& instanceInv,
                                 std::optional<float> angle, const std::optional<double>& upLimit) {
    Matrix3d linear = world.linear();
    {
        const Vec3d oldZ = linear.col(2), newZ = linear.col(0).cross(linear.col(1));
        linear.col(2) = newZ * (oldZ.dot(newZ) / newZ.squaredNorm());
    }
    const auto zRotation = Eigen::Quaternion<double, Eigen::DontAlign>::FromTwoVectors(Vec3d(linear.col(2)), worldDir);
    Transform3d worldNew = zRotation * world;
    Matrix3d newLinear = worldNew.linear();
    if (upLimit) {
        const Vec3d z = newLinear.col(2).normalized();
        const Vec3d wantedUp = suggest_up(z, *upLimit);
        const auto yRotation = Eigen::Quaternion<double, Eigen::DontAlign>::FromTwoVectors(Vec3d(newLinear.col(1)), wantedUp);
        worldNew = yRotation * worldNew;
        newLinear = worldNew.linear();
    }
    Transform3d volumeNew{Eigen::Translation<double, 3>(instanceInv * worldPosition)};
    volumeNew.linear() = instanceInv.linear() * newLinear;
    if (volumeNew.matrix()(0, 0) != volumeNew.matrix()(0, 0)) return Transform3d::Identity();
    apply_transformation(angle, {}, volumeNew);
    return volumeNew;
}

// The shape's turn about its axis from upright (calc_angle), mirrored with the shape.
std::optional<float> angleOf(const Transform3d& world) {
    std::optional<float> a = calc_up(world, UP_LIMIT);
    if (a && has_reflection(world)) a = -*a;
    return a;
}

json matrixJson(const Transform3d& m, const Vec2d& origin) {
    const Transform3d plate = Eigen::Translation3d(-origin.x(), -origin.y(), 0) * m;
    json out = json::array();
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r) out.push_back(plate.matrix()(r, c));
    return out;
}

Vec3d vec3(const json& a, size_t from = 0) { return Vec3d(a[from].get<double>(), a[from + 1].get<double>(), a[from + 2].get<double>()); }

// Object o, its instance on the page, and request:
//   {op: "state", volume, instance}
//       -> {matrix, angle, distance, surface}: where the shape is (16 numbers,
//          column major, plate coordinates), its turn from upright in degrees
//          clockwise (desktop's Rotation), how far it stands off the surface
//          (null: on it), whether there is another part to stand on
//   {op: "drag", volume, instance, ray: [x, y, z, dx, dy, dz], keepUp, commit?, fontPath?}
//       slides the shape to where the ray meets the object's other parts
//       -> {hit, matrix}; commit moves it there (and remakes a shape that follows the surface)
//   {op: "rotate", volume, instance, angle, fontPath?}   turns it to `angle` (degrees clockwise)
//   {op: "distance", volume, instance, distance}          stands it this far off the surface
//   {op: "face", volume, instance, camera: [x, y, z], keepUp, fontPath?}   turns it to the camera
// Rays and the camera are in plate coordinates. fontPath: the text's font in
// the engine's files, to remake a text that follows the surface.
std::string shapePlace(int o, int plate, const std::string& requestJson) {
    try {
        const json req = json::parse(requestJson);
        const std::string op = req.value("op", "");
        auto& objs = pr().model.objects;
        if (o < 0 || size_t(o) >= objs.size()) throw std::runtime_error("no object " + std::to_string(o));
        ModelObject* obj = objs[o];
        const int index = req.value("volume", -1);
        if (index < 0 || size_t(index) >= obj->volumes.size()) throw std::runtime_error("no part " + std::to_string(index));
        ModelVolume* v = obj->volumes[index];
        if (!v->emboss_shape) throw std::runtime_error("that part isn't a text or SVG shape");
        const int i = req.value("instance", 0);
        if (i < 0 || size_t(i) >= obj->instances.size()) throw std::runtime_error("no instance " + std::to_string(i));
        const ModelInstance& inst = *obj->instances[i];
        const Vec2d origin = pr().plateOrigin(std::max(pr().plateOf(inst), 0));
        const Vec3d toBed(origin.x(), origin.y(), 0);
        const bool keepUp = req.value("keepUp", true);
        const std::optional<double> upLimit = keepUp ? std::optional<double>(UP_LIMIT) : std::nullopt;
        engine::unfixShape(*v);
        const Transform3d world = worldOf(*v, inst);
        const bool alone = v->is_the_only_one_part();

        if (op == "state") {
            const std::optional<float> angle = angleOf(world);
            const std::optional<float> distance = alone ? std::nullopt : distanceOf(*v, inst);
            return json{{"ok", true},
                        {"matrix", matrixJson(world, origin)},
                        {"angle", -angle.value_or(0.f) * 180. / M_PI},
                        {"distance", distance ? json(*distance) : json(nullptr)},
                        {"surface", !alone && !surfaceParts(*v).empty()}}
                .dump();
        }

        Transform3d volumeNew = v->get_matrix();
        if (op == "drag") {
            // start_dragging / dragging: onto the face under the ray, keeping
            // the turn it had from upright.
            if (alone) throw std::runtime_error("a shape that is the whole object moves with the Move tool");
            const json& ray = req.at("ray");
            const std::optional<SurfaceHit> hit = hitParts(*v, inst, vec3(ray) + toBed, vec3(ray, 3).normalized());
            if (!hit) return json{{"ok", true}, {"hit", false}}.dump();
            std::optional<float> start;
            if (upLimit) start = angleOf(world);
            volumeNew = volumeTransformation(world, hit->normal, hit->position, inst.get_matrix().inverse(), start, upLimit);
            if (!req.value("commit", false))
                return json{{"ok", true}, {"hit", true}, {"matrix", matrixJson(inst.get_matrix() * volumeNew, origin)}}.dump();
        } else if (op == "rotate") {
            // do_local_z_rotate by the difference from the current turn.
            double target = -req.at("angle").get<double>() * M_PI / 180.;
            Geometry::to_range_pi_pi(target);
            double rel = target - angleOf(world).value_or(0.f);
            if (has_reflection(world)) rel = -rel;
            volumeNew = v->get_matrix() * Eigen::AngleAxisd(rel, Vec3d::UnitZ());
        } else if (op == "distance") {
            // do_local_z_move
            if (alone) throw std::runtime_error("a shape that is the whole object has no surface under it");
            const double want = std::clamp(req.at("distance").get<double>(), -1e3, 1e3);
            volumeNew = v->get_matrix() * Eigen::Translation3d(0., 0., want - distanceOf(*v, inst).value_or(0.f));
        } else if (op == "face") {
            // face_selected_volume_to_camera (perspective camera)
            const Vec3d position = world.translation();
            const Vec3d dir = vec3(req.at("camera")) + toBed - position;
            std::optional<float> start;
            if (upLimit) start = calc_up(world, *upLimit);
            volumeNew = volumeTransformation(world, dir, position, inst.get_matrix().inverse(), start, upLimit);
        } else {
            throw std::runtime_error("unknown placing action " + op);
        }

        if (alone) {
            // An object that is only the shape turns as a whole (is_embossed_object).
            ModelInstance& editable = *obj->instances[i];
            editable.set_transformation(Geometry::Transformation(inst.get_matrix() * volumeNew * v->get_matrix().inverse()));
        } else {
            const Geometry::Transformation was = v->get_transformation();
            v->set_transformation(Geometry::Transformation(volumeNew));
            // A shape that follows the surface is remade where it now stands.
            if (v->emboss_shape->projection.use_surface || (v->text_configuration && v->text_configuration->style.prop.per_glyph)) {
                try {
                    engine::remakeShape(obj, v, req.value("fontPath", ""));
                } catch (...) {
                    v->set_transformation(was);
                    throw;
                }
            }
        }
        obj->invalidate_bounding_box();
        if (v->is_model_part() || alone) obj->ensure_on_bed();
        return json{{"ok", true}, {"changed", true}}.dump();
    } catch (const std::exception& e) {
        return json{{"ok", false}, {"error", e.what()}}.dump();
    }
}

} // namespace

namespace engine {

void unfixShape(ModelVolume& v) {
    // GLGizmoSVG::volume_transformation_changed / update_volume: the fix a 3MF
    // store baked in goes back into the volume's transformation.
    if (v.emboss_shape && v.emboss_shape->fix_3mf_tr) {
        v.set_transformation(v.get_matrix() * v.emboss_shape->fix_3mf_tr->inverse());
        v.emboss_shape->fix_3mf_tr.reset();
    }
}

TriangleMesh shapeMesh(const ModelVolume& v, EmbossShape& shape, bool outside, const FontFileWithCache* font, const TextConfiguration* text) {
    const bool alone = v.is_the_only_one_part() || v.get_object()->volumes.size() < 2;
    const std::vector<const ModelVolume*> parts = alone ? std::vector<const ModelVolume*>{} : surfaceParts(v);
    const bool useSurface = shape.projection.use_surface && !parts.empty();
    const bool perGlyph = text && text->style.prop.per_glyph && font && font->has_value() && !parts.empty();
    if (!useSurface && !perGlyph) return embossMesh(shape, shape.projection.depth, outside);

    if (perGlyph) {
        const TextLines lines = textLines(v.get_matrix(), parts, *font->font_file, text->style.prop, get_count_lines(text->text));
        indexed_triangle_set its = perGlyphMesh(shape, lines, v.get_matrix(), parts, useSurface, outside);
        if (its.empty()) throw std::runtime_error(useSurface ? "there is no surface under the letters to put them on" : "the letters can't be set along this surface");
        return TriangleMesh(std::move(its));
    }
    const ExPolygons shapes = union_with_delta(shape, UNION_DELTA, UNION_MAX_ITERATIN);
    if (shapes.empty()) return {};
    indexed_triangle_set its = cutToSurface(shapes, v.get_matrix(), parts, shape.scale, shape.projection.depth, outside);
    if (its.empty()) throw std::runtime_error("there is no surface under the shape to follow; move it onto the object first");
    return TriangleMesh(std::move(its));
}

void moveOntoSurface(ModelVolume& v) {
    // calc_surface_offset: the origin moved onto the surface nearest it along
    // its own axis, or the nearest point of the surface when that misses.
    const Transform3d tr = v.get_matrix();
    const Vec3d point = tr.translation();
    const Vec3d dir = -tr.linear().col(2).normalized();
    std::optional<Vec3d> best = nearestAlong(v, Transform3d::Identity(), point, dir);
    double bestSq = best ? (*best - point).squaredNorm() : 0;
    if (!best) {
        for (const ModelVolume* part : surfaceParts(v)) {
            const Transform3d m = part->get_matrix(), inv = m.inverse();
            int idx = 0;
            Vec3d closest;
            treeOf(*part).squared_distance(inv * point, idx, closest);
            const Vec3d at = m * closest;
            const double sq = (at - point).squaredNorm();
            if (!best || sq < bestSq) best = at, bestSq = sq;
        }
    }
    if (!best || bestSq < EPSILON) return;
    v.set_transformation(Geometry::Transformation(Eigen::Translation3d(*best - point) * tr));
}

} // namespace engine

EMSCRIPTEN_BINDINGS(surface_api) {
    emscripten::function("shapePlace", &shapePlace);
}

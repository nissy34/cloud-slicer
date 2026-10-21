// Stand-in for Format/DRC.cpp (Draco-compressed meshes, upstream OrcaSlicer
// only) in the browser build, which leaves out the Draco library. Opening a
// .drc file fails with a message instead.
#include "libslic3r/Format/DRC.hpp"

#include <stdexcept>

namespace Slic3r {

static bool no_draco() { throw std::runtime_error("Draco (.drc) files are not supported in the browser"); }

bool load_drc(const char*, TriangleMesh*) { return no_draco(); }
bool load_drc(const char*, Model*, const char*) { return no_draco(); }
bool store_drc(const char*, TriangleMesh*, int, int) { return no_draco(); }
bool store_drc(const char*, ModelObject*, int, int) { return no_draco(); }
bool store_drc(const char*, Model*, int, int) { return no_draco(); }

} // namespace Slic3r

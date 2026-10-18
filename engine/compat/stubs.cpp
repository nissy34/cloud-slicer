// Stand-ins for the few libslic3r entry points whose implementations need a
// library the wasm engine leaves out (OCCT for STEP and SVG, FreeType for text).
#include "libslic3r/Polygon.hpp"
#include <string>

namespace Slic3r {
class Model;

#ifndef ENGINE_WITH_STEP
// STEP import (Format/STEP.cpp, needs OCCT). Declared by compat/nostep/Format/STEP.hpp.
Step::Step(std::string, ImportStepProgressFn, StepIsUtf8Fn) {}
bool Step::load() { return false; }
bool load_step(const char*, Model*, bool&, double, double, bool, ImportStepProgressFn, StepIsUtf8Fn, long&) { return false; }
#endif

// SVG import (Format/svg.cpp, needs OCCT).
bool load_svg(const char*, Model*, std::string&) { return false; }
} // namespace Slic3r

// Thread naming (Thread.cpp, built as Linux). Emscripten declares these but
// doesn't implement them; thread names only matter for debuggers.
#include <pthread.h>
#include <cstring>
extern "C" int pthread_setname_np(pthread_t, const char *) { return 0; }
extern "C" int pthread_getname_np(pthread_t, char *buf, size_t len)
{
    if (len) buf[0] = '\0';
    return 0;
}

// The serial TBB shims' cancellation point (tbb_serial/tbb/serial_cancel.h).
#include <tbb/serial_cancel.h>
namespace tbb { namespace detail { namespace d1 {
void (*serial_cancel_point)() = nullptr;
}}} // namespace tbb::detail::d1

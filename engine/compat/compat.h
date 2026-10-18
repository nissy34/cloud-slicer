// Force-included into every C++ translation unit of the wasm engine
// (see cmake/libslic3r.cmake).
#pragma once

// LocalesUtils.cpp needs <sstream>, libnest2d needs <iostream>; desktop builds
// get them transitively through precompiled headers.
#include <sstream>
#include <iostream>

// Orca names tbb::spin_mutex, which oneTBB 2021+ only declares in tbb::detail::d1.
#include <tbb/spin_mutex.h>
namespace tbb {
    using spin_mutex = detail::d1::spin_mutex;
}

// Without OCCT (STEP import off), shadow Format/STEP.hpp with an OCCT-free
// declaration of the same API before Model.hpp includes the real one.
#if defined(__cplusplus) && !defined(ENGINE_WITH_STEP)
#include "nostep/Format/STEP.hpp"
#endif

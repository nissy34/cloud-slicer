// Stands in for <mmintrin.h> (MMX). With -msse2, Eigen 3.4 includes it before the
// SSE headers but uses nothing from it; Emscripten has SSE headers but no MMX, so
// clang's own x86 one would be found and fail. engine/CMakeLists.txt puts this
// folder on the include path.
#pragma once

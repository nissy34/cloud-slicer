# =============================================================================
# Snapmaker Orca's engine compiled to WebAssembly, with a JS API over its own
# presets, model loading and slicing (src/*.cpp). See engine/README.md.
#
#   source <emsdk>/emsdk_env.sh
#   engine/scripts/build-deps.sh                     # once
#   emcmake cmake -S engine -B engine/build/engine -G Ninja -DCMAKE_BUILD_TYPE=Release
#   cmake --build engine/build/engine                # -> orca-engine.js + .wasm
# =============================================================================
cmake_minimum_required(VERSION 3.22)
project(orca_engine LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Configure with emcmake (see the header of this file).")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(ORCA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/orcaslicer")
set(EXTERN_DIR "${CMAKE_CURRENT_SOURCE_DIR}/build/deps" CACHE PATH "Output of engine/scripts/build-deps.sh")
# STEP import via OCCT 7.6 (engine/scripts/build-deps.sh occt). Off by default:
# it adds several MB to the module.
option(ENGINE_WITH_STEP "Real STEP import (needs the occt dep)" OFF)

# Must match engine/scripts/build-deps.sh: every object in the link shares one
# exception model and the shared-memory (pthread) ABI.
add_compile_options(-pthread -fwasm-exceptions)
add_link_options(-pthread -fwasm-exceptions)
# wasm32 has a 32-bit size_t. Orca initialises size_t sentinels from
# numeric_limits<coord_t /* int64 */>::max() (GCode.hpp LayerResult); the value
# truncates to SIZE_MAX, which is still the "no layer" sentinel. Clang makes
# that narrowing a hard error by default; keep it a warning.
add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-Wno-c++11-narrowing>)
# Emscripten's clang rejects `x.template foo` without an argument list in
# Boost.QVM / CGAL headers.
add_compile_options($<$<COMPILE_LANGUAGE:CXX>:-Wno-missing-template-arg-list-after-template-kw>)
# WebAssembly cannot change the FPU rounding mode, which CGAL's interval
# arithmetic (the filter behind every Epick predicate) relies on. Without this,
# NDEBUG builds silently compute unsound intervals, so exact-predicate results
# (VoronoiUtilsCgal, MeshBoolean, CutSurface) can be wrong. CGAL's supported
# fallback widens each bound by one ulp via nextafter().
add_compile_definitions(CGAL_ALWAYS_ROUND_TO_NEAREST=1)

# Engine source patches (engine/patches/*.patch, paths relative to the
# orcaslicer submodule). The submodule itself stays untouched: each patched file
# is copied into the build tree, patched there, and swapped into libslic3r's
# source list. Only bugs the browser build exposes belong here.
set(ENGINE_PATCHED_DIR "${CMAKE_BINARY_DIR}/patched-engine")
set(ENGINE_SOURCE_OVERRIDES "")
file(GLOB ENGINE_PATCHES "${CMAKE_CURRENT_SOURCE_DIR}/patches/*.patch")
foreach(patch ${ENGINE_PATCHES})
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${patch})
    file(STRINGS ${patch} touched REGEX "^\\+\\+\\+ b/")
    foreach(line ${touched})
        string(REGEX REPLACE "^\\+\\+\\+ b/" "" rel "${line}")
        list(APPEND ENGINE_SOURCE_OVERRIDES ${rel})
    endforeach()
endforeach()
list(REMOVE_DUPLICATES ENGINE_SOURCE_OVERRIDES)
# Patch fresh originals in a staging dir, then copy the results over only where
# they changed, so a re-configure does not touch the patched files' timestamps
# and rebuild everything that includes them.
set(ENGINE_PATCH_STAGE "${CMAKE_BINARY_DIR}/patched-engine-stage")
file(REMOVE_RECURSE "${ENGINE_PATCH_STAGE}")
foreach(rel ${ENGINE_SOURCE_OVERRIDES})
    configure_file("${ORCA_DIR}/${rel}" "${ENGINE_PATCH_STAGE}/${rel}" COPYONLY)
endforeach()
foreach(patch ${ENGINE_PATCHES})
    execute_process(COMMAND patch -p1 --forward --silent -d "${ENGINE_PATCH_STAGE}" -i "${patch}"
                    RESULT_VARIABLE rc)
    if(NOT rc EQUAL 0)
        message(FATAL_ERROR "Engine patch failed to apply: ${patch}")
    endif()
endforeach()
foreach(rel ${ENGINE_SOURCE_OVERRIDES})
    configure_file("${ENGINE_PATCH_STAGE}/${rel}" "${ENGINE_PATCHED_DIR}/${rel}" COPYONLY)
endforeach()

include(cmake/libslic3r.cmake)

add_executable(orca-engine src/presets_api.cpp src/model_api.cpp src/slice_api.cpp src/tools_api.cpp src/paint_api.cpp src/calib_api.cpp src/history_api.cpp src/mixed_api.cpp src/measure_api.cpp src/object_api.cpp)
target_link_libraries(orca-engine PRIVATE libslic3r embind)
set_target_properties(orca-engine PROPERTIES SUFFIX ".js")
target_link_options(orca-engine PRIVATE
    -sMODULARIZE=1
    -sEXPORT_NAME=createOrcaEngine
    -sENVIRONMENT=web,worker,node
    -sEXPORTED_RUNTIME_METHODS=FS
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=256MB
    -sMAXIMUM_MEMORY=4GB
    -sSTACK_SIZE=8MB
    -sPTHREAD_POOL_SIZE=0
)
option(ENGINE_WASM_DEBUG "Runtime assertions + symbolised stacks" OFF)
if(ENGINE_WASM_DEBUG)
    target_link_options(orca-engine PRIVATE -sASSERTIONS=2 --profiling-funcs -sSAFE_HEAP=1 -sSTACK_OVERFLOW_CHECK=2)
endif()

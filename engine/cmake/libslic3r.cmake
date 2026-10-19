# =============================================================================
# libslic3r (Snapmaker Orca's slicing core) for WebAssembly.
#
# The source list is read from the engine's own src/libslic3r/CMakeLists.txt,
# so an engine upgrade picks up new files without edits here. The few files
# that need a library the browser build leaves out are excluded below, and
# compat/stubs.cpp stands in for their entry points.
#
# Inputs (set by engine/CMakeLists.txt): ORCA_DIR, EXTERN_DIR, ENGINE_PATCHED_DIR,
# ENGINE_SOURCE_OVERRIDES, ENGINE_WITH_STEP.
# =============================================================================
set(LIBSLIC3R_DIR "${ORCA_DIR}/src/libslic3r")
set(BUNDLED_DIR "${ORCA_DIR}/deps_src")
set(COMPAT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/compat")

# --- dependency search paths (engine/scripts/build-deps.sh layout) ------------
set(EXTERN_DEPS boost tbb gmp mpfr cgal eigen cereal nlohmann zlib expat nlopt libpng libjpeg libnoise)
if(ENGINE_WITH_STEP)
    list(APPEND EXTERN_DEPS occt)
endif()
foreach(dep ${EXTERN_DEPS})
    include_directories("${EXTERN_DIR}/${dep}/include")
    link_directories("${EXTERN_DIR}/${dep}/lib/wasm32")
endforeach()

# Serial TBB algorithms (parallel_for & co. run inline). Slicing in the browser
# is single-threaded for now; real TBB threads on wasm pthreads are a later
# speed-up that needs its own validation.
include_directories(BEFORE "${COMPAT_DIR}/tbb_serial")

set(ENGINE_INCLUDES
    ${COMPAT_DIR}
    ${BUNDLED_DIR}
    ${ORCA_DIR}/src
    ${BUNDLED_DIR}/admesh
    ${BUNDLED_DIR}/semver
    ${BUNDLED_DIR}/miniz
    ${BUNDLED_DIR}/glu-libtess/include
    ${BUNDLED_DIR}/fast_float
    ${BUNDLED_DIR}/ankerl
    ${BUNDLED_DIR}/libigl
    ${BUNDLED_DIR}/nanosvg
    ${BUNDLED_DIR}/qoi
    ${BUNDLED_DIR}/libnest2d/include
    ${BUNDLED_DIR}/mcut/include
    ${BUNDLED_DIR}/qhull/src
    ${BUNDLED_DIR}/qhull/src/libqhull_r
    ${BUNDLED_DIR}/boost/nowide
    ${BUNDLED_DIR}/clipper
    ${LIBSLIC3R_DIR}
)

add_compile_definitions(NDEBUG SLIC3R_GUI=0 SLIC3R_OPENVDB=0)
if(ENGINE_WITH_STEP)
    add_compile_definitions(ENGINE_WITH_STEP=1)
endif()
add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:-include${COMPAT_DIR}/compat.h>")

# --- bundled libraries (deps_src) --------------------------------------------
add_library(admesh STATIC
    ${BUNDLED_DIR}/admesh/connect.cpp ${BUNDLED_DIR}/admesh/normals.cpp ${BUNDLED_DIR}/admesh/shared.cpp
    ${BUNDLED_DIR}/admesh/stl_io.cpp ${BUNDLED_DIR}/admesh/stlinit.cpp ${BUNDLED_DIR}/admesh/util.cpp)
target_include_directories(admesh PUBLIC ${ENGINE_INCLUDES})

add_library(semver STATIC ${BUNDLED_DIR}/semver/semver.c)
target_include_directories(semver PUBLIC ${BUNDLED_DIR}/semver)

add_library(miniz STATIC ${BUNDLED_DIR}/miniz/miniz.c)
target_include_directories(miniz PUBLIC ${BUNDLED_DIR}/miniz)

file(GLOB GLU_LIBTESS_SOURCES ${BUNDLED_DIR}/glu-libtess/src/*.c)
list(FILTER GLU_LIBTESS_SOURCES EXCLUDE REGEX "priorityq-heap\\.c$")  # #included by priorityq.c
add_library(glu-libtess STATIC ${GLU_LIBTESS_SOURCES})
target_include_directories(glu-libtess PRIVATE ${BUNDLED_DIR}/glu-libtess PUBLIC ${BUNDLED_DIR}/glu-libtess/include)

add_library(qoi STATIC ${BUNDLED_DIR}/qoi/qoilib.c)
target_include_directories(qoi PUBLIC ${BUNDLED_DIR}/qoi)

add_library(clipper STATIC ${BUNDLED_DIR}/clipper/clipper.cpp ${BUNDLED_DIR}/clipper/clipper_z.cpp)
target_include_directories(clipper PUBLIC ${ENGINE_INCLUDES})

file(GLOB QHULL_C_SOURCES ${BUNDLED_DIR}/qhull/src/libqhull_r/*.c)
list(FILTER QHULL_C_SOURCES EXCLUDE REGEX "userprintf_r\\.c$")  # QhullQh.cpp provides qh_fprintf
file(GLOB QHULL_CPP_SOURCES ${BUNDLED_DIR}/qhull/src/libqhullcpp/*.cpp)
list(FILTER QHULL_CPP_SOURCES EXCLUDE REGEX "(qt-qhull|usermem_r-cpp)\\.cpp$")
add_library(qhull STATIC ${QHULL_C_SOURCES} ${QHULL_CPP_SOURCES})
target_include_directories(qhull PUBLIC ${BUNDLED_DIR}/qhull/src ${BUNDLED_DIR}/qhull/src/libqhull_r ${BUNDLED_DIR}/qhull/src/libqhullcpp)

file(GLOB MCUT_SOURCES ${BUNDLED_DIR}/mcut/source/*.cpp ${BUNDLED_DIR}/mcut/source/*.c)
add_library(mcut STATIC ${MCUT_SOURCES})
target_include_directories(mcut PUBLIC ${BUNDLED_DIR}/mcut/include)
# A patched mcut header (engine/patches) comes ahead of its original.
if("deps_src/mcut/include/mcut/internal/frontend.h" IN_LIST ENGINE_SOURCE_OVERRIDES)
    target_include_directories(mcut BEFORE PRIVATE ${ENGINE_PATCHED_DIR}/deps_src/mcut/include)
endif()
# No MCUT_WITH_COMPUTE_HELPER_THREADPOOL: mcut checks it with #if defined, so
# even =0 turns on its helper threads, and a page can't start those while it
# waits for them (the boolean hung in the browser; Node starts them fine).

# --- libslic3r sources, from the engine's own list ----------------------------
file(READ "${LIBSLIC3R_DIR}/CMakeLists.txt" _upstream)
string(REGEX MATCH "set\\(lisbslic3r_sources([^)]*)\\)" _block "${_upstream}")
if(NOT _block)
    message(FATAL_ERROR "libslic3r source list not found in ${LIBSLIC3R_DIR}/CMakeLists.txt")
endif()
string(REGEX REPLACE "#[^\n]*" "" _block "${CMAKE_MATCH_1}")  # drop commented-out entries
string(REGEX MATCHALL "[A-Za-z0-9_/.+-]+\\.(cpp|c)" _rel "${_block}")

set(LIBSLIC3R_EXCLUDE
    pchheader.cpp           # precompiled-header TU
    GCodeSender.cpp         # USB serial printing (boost::asio serial ports)
    Format/svg.cpp          # SVG import, needs OCCT (compat/stubs.cpp)
    Shape/TextShape.cpp     # text embossing, needs OCCT + FreeType
)
if(NOT ENGINE_WITH_STEP)
    list(APPEND LIBSLIC3R_EXCLUDE Format/STEP.cpp)  # compat/stubs.cpp
endif()
# CGAL-dependent units build in their own library (upstream does the same).
set(LIBSLIC3R_CGAL_REL CutSurface.cpp IntersectionPoints.cpp MeshBoolean.cpp TryCatchSignal.cpp Triangulation.cpp)

set(LIBSLIC3R_SOURCES "")
foreach(rel ${_rel})
    list(FIND LIBSLIC3R_EXCLUDE "${rel}" _x)
    list(FIND LIBSLIC3R_CGAL_REL "${rel}" _c)
    if(_x EQUAL -1 AND _c EQUAL -1)
        list(APPEND LIBSLIC3R_SOURCES "${LIBSLIC3R_DIR}/${rel}")
    endif()
endforeach()
list(REMOVE_DUPLICATES LIBSLIC3R_SOURCES)
list(APPEND LIBSLIC3R_SOURCES
    ${COMPAT_DIR}/stubs.cpp
    ${COMPAT_DIR}/boost_locale_stub.cpp
    ${COMPAT_DIR}/nanosvg_impl.c)

# Patched copies (engine/patches) replace their originals; each copy keeps its
# original directory for file-relative #includes.
foreach(rel ${ENGINE_SOURCE_OVERRIDES})
    list(FIND LIBSLIC3R_SOURCES "${ORCA_DIR}/${rel}" idx)
    if(idx GREATER -1)
        list(REMOVE_AT LIBSLIC3R_SOURCES ${idx})
        list(INSERT LIBSLIC3R_SOURCES ${idx} "${ENGINE_PATCHED_DIR}/${rel}")
        get_filename_component(orig_dir "${ORCA_DIR}/${rel}" DIRECTORY)
        set_source_files_properties("${ENGINE_PATCHED_DIR}/${rel}" PROPERTIES INCLUDE_DIRECTORIES "${orig_dir}")
        message(STATUS "libslic3r: patched ${rel}")
    endif()
endforeach()

set(LIBSLIC3R_CGAL_SOURCES "")
foreach(rel ${LIBSLIC3R_CGAL_REL})
    list(APPEND LIBSLIC3R_CGAL_SOURCES "${LIBSLIC3R_DIR}/${rel}")
endforeach()
add_library(libslic3r_cgal STATIC ${LIBSLIC3R_CGAL_SOURCES})
target_include_directories(libslic3r_cgal PRIVATE ${ENGINE_INCLUDES})

add_library(libslic3r STATIC ${LIBSLIC3R_SOURCES})
target_compile_definitions(libslic3r PUBLIC USE_TBB TBB_USE_CAPTURED_EXCEPTION=0)
target_include_directories(libslic3r PUBLIC ${ENGINE_INCLUDES})
# Platform.cpp static_asserts on unknown OSes; Emscripten is POSIX enough to
# take the Linux branch (its /proc/version probe just fails).
set_source_files_properties(${LIBSLIC3R_DIR}/Platform.cpp PROPERTIES COMPILE_DEFINITIONS "__linux__=1")

set(OCCT_LIBS "")
if(ENGINE_WITH_STEP)
    set(OCCT_LIBS
        TKXDESTEP TKSTEP TKSTEP209 TKSTEPAttr TKSTEPBase TKXCAF TKXSBase TKVCAF TKCAF TKLCAF
        TKCDF TKV3d TKService TKMesh TKBO TKPrim TKHLR TKShHealing TKTopAlgo TKGeomAlgo
        TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel)
endif()

target_link_libraries(libslic3r PRIVATE admesh clipper glu-libtess qoi libslic3r_cgal miniz qhull mcut)
target_link_libraries(libslic3r PUBLIC
    semver
    boost_log_setup boost_log boost_filesystem boost_thread boost_regex boost_iostreams
    boost_nowide boost_chrono boost_atomic boost_system boost_date_time
    ${OCCT_LIBS}
    tbb tbbmalloc gmpxx gmp mpfr nlopt png jpeg libnoise_static z expat)

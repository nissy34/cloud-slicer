// Stand-in for boost/numeric/interval/hw_rounding.hpp in the browser build.
// Boost.Interval knows no rounding control for WebAssembly (which can't change
// the FPU rounding mode; Boost's wasm config also turns fenv off), so that
// header stops with "Please specify rounding control mechanism". CGAL 6 pulls
// it in through Surface_sweep_2 (its rational-function traits), which
// OrcaSlicer 2.5's Geometry/VoronoiUtilsCgal.cpp includes without using those
// traits. This is the same header with Boost's own no-op rounding control:
// rounding stays to nearest, as CGAL's own intervals do here
// (CGAL_ALWAYS_ROUND_TO_NEAREST in engine/CMakeLists.txt). Force-included only
// into the files that need it (engine/cmake/libslic3r.cmake).
#pragma once
#define BOOST_NUMERIC_INTERVAL_HW_ROUNDING_HPP

#include <boost/config.hpp>
#include <boost/numeric/interval/rounding.hpp>
#include <boost/numeric/interval/rounded_arith.hpp>

namespace boost {
namespace numeric {
namespace interval_lib {

template<> struct rounded_math<float> : save_state<rounded_arith_opp<float>> {};
template<> struct rounded_math<double> : save_state<rounded_arith_opp<double>> {};
template<> struct rounded_math<long double> : save_state<rounded_arith_opp<long double>> {};

} // namespace interval_lib
} // namespace numeric
} // namespace boost

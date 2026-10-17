#ifndef SAPIL_INTERNAL_H
#define SAPIL_INTERNAL_H

#include "../include/sapil.h"
#include "libslic3r/PrintConfig.hpp"
#include <string>

namespace sapil {

struct SlicerEngine::Impl {
    std::string last_gcode_path;
    std::string last_gcode_content;
    Slic3r::DynamicPrintConfig print_config;
    Slic3r::DynamicPrintConfig printer_config;
    Slic3r::DynamicPrintConfig filament_config;
};

} // namespace sapil

#endif // SAPIL_INTERNAL_H

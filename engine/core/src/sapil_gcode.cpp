#include "../include/sapil.h"
#include "sapil_internal.h"
#include <fstream>

// =============================================================================
// sapil_gcode.cpp — G-code output and preview
// =============================================================================

namespace sapil {

std::string SlicerEngine::getGcodePreview(int max_lines) const {
    if (!pImpl || pImpl->last_gcode_content.empty()) {
        return "; No G-code generated yet\n";
    }

    // Return first N lines of the generated G-code
    std::string result;
    int line_count = 0;
    size_t pos = 0;

    while (pos < pImpl->last_gcode_content.size() && line_count < max_lines) {
        size_t end = pImpl->last_gcode_content.find('\n', pos);
        if (end == std::string::npos) {
            result += pImpl->last_gcode_content.substr(pos);
            break;
        }
        result += pImpl->last_gcode_content.substr(pos, end - pos + 1);
        pos = end + 1;
        line_count++;
    }

    if (line_count >= max_lines) {
        result += "; ... (truncated)\n";
    }

    return result;
}

} // namespace sapil

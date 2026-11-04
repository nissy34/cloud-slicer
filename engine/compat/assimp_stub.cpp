// Stand-in for Format/AssimpImport.cpp (glTF, GLB and FBX import through the
// Assimp library, OrcaSlicer 2.5 and later) in the browser build, which leaves
// out Assimp. Opening such a file fails with a message instead.
#include "libslic3r/Format/AssimpImport.hpp"

namespace Slic3r {

bool load_assimp_textured_model(const std::string&, TexturedMesh&, std::string* error_message)
{
    if (error_message)
        *error_message = "glTF, GLB and FBX files are not supported in the browser";
    return false;
}

} // namespace Slic3r

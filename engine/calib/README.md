# Calibration models made for the browser

Orca's calibration test models live in `orcaslicer/resources/calib/`. The
browser engine has no STEP reader (OpenCASCADE isn't in the wasm build), so the
one STEP model is converted to STL here:

- `SpeedTestStructure.stl`: `resources/calib/volumetric_speed/SpeedTestStructure.step`,
  meshed with OpenCASCADE the way desktop Orca loads STEP files
  (`BRepMesh_IncrementalMesh(shape, 0.003, false, 0.5, true)`, see `STEP.cpp`):

  ```python
  # pip install cadquery-ocp
  from OCP.STEPControl import STEPControl_Reader
  from OCP.BRepMesh import BRepMesh_IncrementalMesh
  from OCP.StlAPI import StlAPI_Writer
  r = STEPControl_Reader(); r.ReadFile('SpeedTestStructure.step'); r.TransferRoots(); s = r.OneShape()
  BRepMesh_IncrementalMesh(s, 0.003, False, 0.5, True)
  w = StlAPI_Writer(); w.ASCIIMode = False; w.Write(s, 'SpeedTestStructure.stl')
  ```

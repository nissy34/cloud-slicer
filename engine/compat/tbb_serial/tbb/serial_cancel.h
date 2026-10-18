/*
    TBB Serial Shim: serial_cancel.h

    Cancellation point for the serial shims. With real TBB, desktop Orca's UI
    thread cancels a slice by calling Print::cancel() while worker threads run
    the parallel bodies. In the browser the slice runs on the engine's only
    thread, which nothing else can reach while it is busy, so the shims call
    this hook before every chunk, item and index. engine/src/slice_api.cpp sets
    it for the length of a slice, to throw Slic3r::CanceledException once the
    page has asked to cancel; otherwise it is null. Defined in compat/stubs.cpp.
*/
#ifndef __TBB_serial_cancel_H
#define __TBB_serial_cancel_H

namespace tbb {
namespace detail {
namespace d1 {

extern void (*serial_cancel_point)();

inline void serial_check_cancel() {
    if (serial_cancel_point) serial_cancel_point();
}

} // namespace d1
} // namespace detail
} // namespace tbb

#endif

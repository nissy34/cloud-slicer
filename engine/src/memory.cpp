// How the engine's threads get memory. The engine links mimalloc (see
// CMakeLists.txt), which gives every thread its own heap, but two of its
// defaults suit a 64-bit desktop, not wasm, and together they made a big slice
// need more than twice the memory, more than a phone's browser allows.
#include <cstdlib>
#include <mimalloc.h>

// mimalloc reserves memory in arenas. Without virtual memory it reserves 16 MB
// at a time, and aligning each one to 16 MB doubles its cost; from 64 MB up it
// can align them for free. 512 MB here means 128 MB arenas (mimalloc divides
// by 4 in wasm). Set before the first allocation so the first arena is one.
__attribute__((constructor(101))) static void setUpMalloc()
{
    mi_option_set(mi_option_arena_reserve, 512 * 1024); // KiB
}

// TBB's scalable allocator, which Orca's polygon vectors use. tbbmalloc takes
// its memory from mmap in 3-4 MB regions it never gives back, and mimalloc pads
// every one of those to a 16 MB boundary. Plain malloc is just as fast under
// mimalloc, so tbbmalloc isn't linked.
extern "C" void *scalable_malloc(size_t size) { return std::malloc(size); }
extern "C" void scalable_free(void *ptr) { std::free(ptr); }

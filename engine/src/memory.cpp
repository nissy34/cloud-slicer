// How the engine's threads get memory. The engine links mimalloc (see
// CMakeLists.txt), which gives every thread its own heap, but some of its
// defaults suit a 64-bit desktop, not wasm: they made a big model need several
// times its memory, more than a browser page has.
#include <cstdlib>
#include <emscripten/bind.h>
#include <emscripten/heap.h>
#include <mimalloc.h>

// mimalloc reserves memory in arenas. Without virtual memory it reserves 16 MB
// at a time, and aligning each one to 16 MB doubles its cost; from 64 MB up it
// can align them for free. 512 MB here means 128 MB arenas (mimalloc divides
// by 4 in wasm). Set before the first allocation so the first arena is one.
//
// Blocks over 1 MB (a model's mesh, a layer's paths) skip the arenas and come
// from Emscripten's own allocator, which mimalloc runs on. In wasm an arena
// can't hand freed space back or join it up, so big blocks there left gaps
// nothing else fitted in: opening a 1.1 million triangle model twice took
// 3.7 GB of the 4 GB a page can have, slicing it ran out ("unreachable").
// From the plain allocator the same took 0.76 GB, at the same slicing speed:
// the many small blocks, where mimalloc's speed is, stay in its arenas.
__attribute__((constructor(101))) static void setUpMalloc()
{
    mi_option_set(mi_option_arena_reserve, 512 * 1024);      // KiB
    mi_option_set(mi_option_arena_max_object_size, 1024);    // KiB
}

// The engine's memory, which only grows, for the tests: a wasm page can't
// give memory back, so this is the most it ever needed at once.
static double heapSize() { return double(emscripten_get_heap_size()); }

EMSCRIPTEN_BINDINGS(memory_api) {
    emscripten::function("heapSize", &heapSize);
}

// TBB's scalable allocator, which Orca's polygon vectors use. tbbmalloc takes
// its memory from mmap in 3-4 MB regions it never gives back, and mimalloc pads
// every one of those to a 16 MB boundary. Plain malloc is just as fast under
// mimalloc, so tbbmalloc isn't linked.
extern "C" void *scalable_malloc(size_t size) { return std::malloc(size); }
extern "C" void scalable_free(void *ptr) { std::free(ptr); }

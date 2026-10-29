// How the engine's threads get memory. The engine links mimalloc (see
// CMakeLists.txt), which gives every thread its own heap, but some of its
// defaults suit a 64-bit desktop, not wasm: they made a big model need several
// times its memory, more than a browser page has.
#include <cstdlib>
#include <new>
#include <emscripten/bind.h>
#include <emscripten/heap.h>
#include <mimalloc.h>

// mimalloc reserves memory in arenas. Without virtual memory it reserves 16 MB
// at a time, and aligning each one to 16 MB doubles its cost; from 64 MB up it
// can align them for free. 512 MB here means 128 MB arenas (mimalloc divides
// by 4 in wasm). Set before the first allocation so the first arena is one.
__attribute__((constructor(101))) static void setUpMalloc()
{
    mi_option_set(mi_option_arena_reserve, 512 * 1024); // KiB
}

// Big blocks (a model's mesh, a layer's paths: 1 MB and up) don't go to
// mimalloc but straight to Emscripten's own allocator, which mimalloc itself
// runs on. In wasm an arena can't hand freed space back or join it up, so big
// blocks there left gaps nothing else fitted in: a 1.1 million triangle model
// opened twice took 3.7 GB of the 4 GB a page can have, then slicing it ran
// out ("unreachable"). mimalloc's own way round that (arena_max_object_size)
// pads each big block it hands out to its page size, so many medium objects
// ran out instead. Emscripten's allocator joins freed neighbours and pads
// nothing; big blocks are few, so its one lock costs nothing, and the many
// small ones, where mimalloc's speed is, stay in its per-thread arenas.
extern "C" void* emmalloc_memalign(size_t alignment, size_t size);
extern "C" void emmalloc_free(void* ptr);

namespace {

constexpr size_t BIG = 1 << 20;

void* take(size_t size, size_t alignment = 16)
{
    if (size >= BIG) return emmalloc_memalign(alignment < 16 ? 16 : alignment, size);
    return alignment > 16 ? mi_malloc_aligned(size, alignment) : mi_malloc(size);
}

// Big blocks lie outside mimalloc's arenas, which are never handed back.
void give(void* ptr)
{
    if (!ptr) return;
    if (mi_is_in_heap_region(ptr)) mi_free(ptr);
    else emmalloc_free(ptr);
}

void* takeOrThrow(size_t size)
{
    void* ptr = take(size ? size : 1);
    if (!ptr) throw std::bad_alloc();
    return ptr;
}

} // namespace

// Emscripten's mimalloc defines new and delete itself, so the link wraps the
// plain ones (CMakeLists.txt: -Wl,--wrap) and every call comes here. The
// aligned and nothrow ones stay mimalloc's; give() frees their blocks too.
extern "C" {
void* __wrap__Znwm(size_t size) { return takeOrThrow(size); }  // new
void* __wrap__Znam(size_t size) { return takeOrThrow(size); }  // new[]
void __wrap__ZdlPv(void* ptr) noexcept { give(ptr); }          // delete
void __wrap__ZdaPv(void* ptr) noexcept { give(ptr); }          // delete[]
void __wrap__ZdlPvm(void* ptr, size_t) noexcept { give(ptr); } // sized delete
void __wrap__ZdaPvm(void* ptr, size_t) noexcept { give(ptr); } // sized delete[]
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
// mimalloc, so tbbmalloc isn't linked. Its blocks go the same way as new's.
extern "C" void *scalable_malloc(size_t size) { return take(size ? size : 1); }
extern "C" void scalable_free(void *ptr) { give(ptr); }

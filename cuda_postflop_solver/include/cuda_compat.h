// ════════════════════════════════════════════════════════════════════════
// cuda_compat.h — CUDA builtins shims for CPU-only builds (dual-build layer)
// ════════════════════════════════════════════════════════════════════════
// When nvcc is unavailable, we compile the same .cu files with a regular
// C++ compiler. This header provides CPU implementations of CUDA builtins so
// the kernels run on the host (single physical thread emulating the CUDA
// thread/block/grid hierarchy, deterministic and exactly reproducible).
//
// Usage: any .cu file that wants to compile both ways does
//   #include "cuda_compat.h"
// at the top, then uses __device__/__host__/__global__ normally and launches
// kernels exclusively via the KERNEL_LAUNCH / KERNEL_LAUNCH_SM macros:
//
//   KERNEL_LAUNCH(my_kernel<N>, grid, block, arg1, arg2);
//   // On CUDA: expands to my_kernel<N><<<grid, block>>>(arg1, arg2);
//   // On CPU : loops blockIdx/threadIdx over grid/block and calls the body.
//
// When compiled by nvcc:  KERNEL_LAUNCH is defined, everything else no-op.
// When compiled by g++:   full shim set below.
// ════════════════════════════════════════════════════════════════════════
#ifndef CUDA_COMPAT_H
#define CUDA_COMPAT_H

#ifdef __CUDACC__
// ── Real CUDA build — define launch macros only ────────────────────────
#define KERNEL_LAUNCH(kernel, grid, block, ...)     kernel<<<grid, block>>>(__VA_ARGS__)
#define KERNEL_LAUNCH_SM(kernel, grid, block, smem, ...) \
    kernel<<<grid, block, smem>>>(__VA_ARGS__)
#else
// ── CPU fallback build — shim everything ───────────────────────────────

#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <stdexcept>
#include <vector>
#include <string>
#include <algorithm>
#include <type_traits>
#include <atomic>

// ── Execution space annotations ─────────────────────────────────────────
#define __device__
#define __host__
#define __global__
#define __managed__
#define __shared__ static
#define __constant__
#define __restrict__
#define __builtin_assume(x)
#define __forceinline__ inline
#define __launch_bounds__(x)

// ── CUDA vector types (subset) ──────────────────────────────────────────
struct dim3 {
    unsigned int x, y, z;
    dim3(unsigned int vx=1, unsigned int vy=1, unsigned int vz=1)
        : x(vx), y(vy), z(vz) {}
};

// ── Thread hierarchy state (set by KERNEL_LAUNCH before each body call) ─
// CPU emulation model: each block is executed by ONE emulated thread
// (blockDim.x is forced to 1), iterating blockIdx over the grid. Kernels
// written in either of the two canonical CUDA idioms execute correctly:
//
//   1. Per-block strided loop (barrier-safe cooperative code):
//        int tid = threadIdx.x;
//        for (int h = tid; h < N; h += blockDim.x) { ... }
//      CPU: tid=0, stride=1 → the single thread performs all work of the
//      block, so __shared__ accumulation + __syncthreads() sequences are
//      trivially correct.
//
//   2. Grid-stride global index (flat kernels):
//        int idx = blockIdx.x * blockDim.x + threadIdx.x;
//        for (; idx < N; idx += gridDim.x * blockDim.x) { ... }
//      CPU: idx walks blockIdx + k*gridDim.x → covers [0, N) for any grid.
//      (Plain `if (idx >= N) return;` WITHOUT the stride loop is NOT
//      emulation-safe and must not be used in dual-build kernels.)
//
// All four CUDA built-in index variables are emulated as dim3-typed globals
// whose values are set by KERNEL_LAUNCH before each emulated thread call.
inline dim3 g_cpu_threadIdx = dim3(0, 0, 0);
inline dim3 g_cpu_blockIdx  = dim3(0, 0, 0);
inline dim3 g_cpu_blockDim  = dim3(1, 1, 1);
inline dim3 g_cpu_gridDim   = dim3(1, 1, 1);
#define threadIdx g_cpu_threadIdx
#define blockIdx  g_cpu_blockIdx
#define blockDim  g_cpu_blockDim
#define gridDim   g_cpu_gridDim

inline void __syncthreads() {}   // single-threaded emulation: no-op

// ── Builtins ────────────────────────────────────────────────────────────
inline int __popc(unsigned int x) { return __builtin_popcount(x); }
inline int __popcll(unsigned long long x) { return __builtin_popcountll(x); }
inline int __clz(unsigned int x) { return __builtin_clz(x); }
inline int __clzll(unsigned long long x) { return __builtin_clzll(x); }
inline int __ffs(unsigned int x) { return __builtin_ffs(x); }
inline int __ffsll(unsigned long long x) { return __builtin_ffsll(x); }
inline unsigned int __brev(unsigned int x) {
    x = ((x & 0xAAAAAAAA) >> 1) | ((x & 0x55555555) << 1);
    x = ((x & 0xCCCCCCCC) >> 2) | ((x & 0x33333333) << 2);
    x = ((x & 0xF0F0F0F0) >> 4) | ((x & 0x0F0F0F0F) << 4);
    x = ((x & 0xFF00FF00) >> 8) | ((x & 0x00FF00FF) << 8);
    return (x >> 16) | (x << 16);
}
inline unsigned long long __brevll(unsigned long long x) {
    return ((unsigned long long)__brev((unsigned int)x) << 32)
         | (unsigned long long)__brev((unsigned int)(x >> 32));
}

// Fast-math intrinsics (degrade to standard math on CPU)
inline float __fdividef(float a, float b) { return a / b; }
inline float __sinf(float x)   { return sinf(x); }
inline float __cosf(float x)   { return cosf(x); }
inline float __expf(float x)   { return expf(x); }
inline float __logf(float x)   { return logf(x); }
inline float __powf(float x, float y) { return powf(x, y); }
inline float fmaf_(float a, float b, float c) { return fmaf(a, b, c); }
inline int   __float2int_rn(float x) { return (int)lrintf(x); }
inline int   __float_as_int(float x) { int v; std::memcpy(&v, &x, sizeof(int)); return v; }
inline float __int_as_float(int x)   { float v; std::memcpy(&v, &x, sizeof(float)); return v; }

// __ldg read-only cache hint → plain load on CPU
template <typename T> inline T __ldg(const T* p) { return *p; }

// Atomic ops — CPU fallback uses std::atomic_ref (C++20) for thread-safety.
// On GPU, these resolve to native CUDA atomic intrinsics.
inline float atomicAdd(float* addr, float val) {
    std::atomic_ref<float> a(*addr);
    float old = a.load(std::memory_order_relaxed);
    while (!a.compare_exchange_weak(old, old + val, std::memory_order_relaxed)) {}
    return old;
}
inline double atomicAdd(double* addr, double val) {
    std::atomic_ref<double> a(*addr);
    double old = a.load(std::memory_order_relaxed);
    while (!a.compare_exchange_weak(old, old + val, std::memory_order_relaxed)) {}
    return old;
}
inline int atomicAdd(int* addr, int val) {
    std::atomic_ref<int> a(*addr);
    return a.fetch_add(val, std::memory_order_relaxed);
}
inline unsigned int atomicAdd(unsigned int* addr, unsigned int val) {
    std::atomic_ref<unsigned int> a(*addr);
    return a.fetch_add(val, std::memory_order_relaxed);
}
inline unsigned int atomicCAS(unsigned int* addr, unsigned int cmp, unsigned int val) {
    std::atomic_ref<unsigned int> a(*addr);
    unsigned int old = a.load(std::memory_order_relaxed);
    a.compare_exchange_strong(old, val, std::memory_order_relaxed);
    return old;
}
inline int atomicCAS(int* addr, int cmp, int val) {
    std::atomic_ref<int> a(*addr);
    int old = a.load(std::memory_order_relaxed);
    a.compare_exchange_strong(old, val, std::memory_order_relaxed);
    return old;
}

// min/max / clamp
template<typename T> inline T min(T a, T b) { return a < b ? a : b; }
template<typename T> inline T max(T a, T b) { return a > b ? a : b; }

// ── Kernel launch emulation ────────────────────────────────────────────
// KERNEL_LAUNCH(kernel, grid, block, args...)
//   CPU: forces blockDim = (1,1,1) (one emulated thread per block) and
//   iterates blockIdx over the grid, invoking the kernel body once per
//   block. Deterministic, race-free, and byte-identical across runs.
//   Kernels must use one of the two idioms documented above.
#define KERNEL_LAUNCH(kernel, grid, block, ...)                                   \
    do {                                                                          \
        g_cpu_gridDim  = (grid);                                                  \
        g_cpu_blockDim = dim3(1, 1, 1);                                           \
        g_cpu_threadIdx = dim3(0, 0, 0);                                          \
        for (unsigned int gby_ = 0; gby_ < g_cpu_gridDim.y; ++gby_) {             \
            for (unsigned int gbx_ = 0; gbx_ < g_cpu_gridDim.x; ++gbx_) {         \
                g_cpu_blockIdx = dim3(gbx_, gby_, 0);                             \
                kernel(__VA_ARGS__);                                              \
            }                                                                     \
        }                                                                         \
    } while (0)

#define KERNEL_LAUNCH_SM(kernel, grid, block, smem, ...) \
    KERNEL_LAUNCH(kernel, grid, block, __VA_ARGS__)
// (dynamic shared memory is not supported by the CPU shim: kernels must use
//  fixed-size __shared__ arrays; the smem argument is ignored)

// ── cudaError_t / runtime API shims ─────────────────────────────────────
enum cudaError_t { cudaSuccess = 0, cudaErrorInvalidValue = 1 };
enum cudaMemcpyKind {
    cudaMemcpyHostToHost, cudaMemcpyHostToDevice,
    cudaMemcpyDeviceToHost, cudaMemcpyDeviceToDevice
};
inline const char* cudaGetErrorString(cudaError_t) { return "no error (CPU shim)"; }

// NOTE: statement-expression macros below are GNU extensions (fine for g++).
// cudaMalloc is type-correct: remove_reference_t<decltype(*(ptr))> yields the
// pointed-to type (e.g. int* for &gpu.d_num_hands), so the cast target is
// ShdT_ itself — NOT ShdT_* (which would double-pointer it).
#define cudaMalloc(ptr, size)                                                    \
    ({                                                                           \
        using ShdT_ = std::remove_reference_t<decltype(*(ptr))>;                 \
        void* p_ = malloc(size);                                                 \
        *(ptr) = static_cast<ShdT_>(p_);                                         \
        cudaSuccess;                                                             \
    })
#define cudaFree(ptr)          ({ free((void*)(ptr)); cudaSuccess; })
#define cudaMemcpy(dst, src, n, kind)  ({ std::memcpy((void*)(dst), (const void*)(src), (size_t)(n)); cudaSuccess; })
#define cudaMemcpyAsync(dst, src, n, kind, stream) \
    ({ (void)(stream); std::memcpy((void*)(dst), (const void*)(src), (size_t)(n)); cudaSuccess; })
#define cudaMemset(ptr, val, n)        ({ std::memset((void*)(ptr), (val), (size_t)(n)); cudaSuccess; })
#define cudaMemsetAsync(ptr, val, n, stream) \
    ({ (void)(stream); std::memset((void*)(ptr), (val), (size_t)(n)); cudaSuccess; })
#define cudaDeviceSynchronize()        cudaSuccess
#define cudaGetLastError()             cudaSuccess
#define cudaStream_t   int
#define cudaStreamCreate(s)            ({ *(s) = 0; cudaSuccess; })
#define cudaStreamDestroy(s)           cudaSuccess
#define cudaEvent_t    int
#define cudaEventCreate(e)             ({ *(e) = 0; cudaSuccess; })
#define cudaEventDestroy(e)            cudaSuccess
#define cudaEventRecord(e, s)          cudaSuccess
#define cudaEventSynchronize(e)        cudaSuccess
#define cudaEventElapsedTime(ms, a, b) ({ *(ms) = 0.0f; cudaSuccess; })

// Device management shims: the CPU build reports exactly one "virtual
// device" so that the gpu_solver_init fast-path is exercisable on hosts
// without a GPU (this is what makes the CUDA kernel code unit-testable
// under plain g++ with CPU_ONLY=1).
inline cudaError_t cudaGetDeviceCount(int* count) { *count = 1; return cudaSuccess; }
inline cudaError_t cudaSetDevice(int device)      { (void)device; return cudaSuccess; }
inline cudaError_t cudaGetDevice(int* device)     { *device = 0; return cudaSuccess; }

// cudaMemcpyToSymbol: on the CPU shim there is no device symbol table —
// kernels read the host-side HAND_TABLE directly, so this is a checked no-op
// memcpy into the (possibly dummy) destination.
#define cudaMemcpyToSymbol(sym, src, n, ...) \
    ({ if ((void*)&(sym) != nullptr) std::memcpy((void*)&(sym), (const void*)(src), (size_t)(n)); cudaSuccess; })

// GPU properties (CPU shim returns T4-like values)
struct cudaDeviceProp {
    char name[256];
    int  major, minor;
    size_t totalGlobalMem;
    int  multiProcessorCount;
    int  maxThreadsPerBlock;
    int  warpSize;
    size_t sharedMemPerBlock;
};
inline cudaError_t cudaGetDeviceProperties(cudaDeviceProp* p, int) {
    *p = cudaDeviceProp{};
    strcpy(p->name, "CPU shim (T4-targeted source build)");
    p->major = 7; p->minor = 5;          // Tesla T4 = compute 7.5
    p->totalGlobalMem = 16ULL * 1024 * 1024 * 1024;  // 16 GB
    p->multiProcessorCount = 40;          // T4 = 40 SMs
    p->maxThreadsPerBlock = 1024;
    p->warpSize = 32;
    p->sharedMemPerBlock = 48 * 1024;     // 48 KB
    return cudaSuccess;
}

// ── Device-side printf (CPU shim) ──────────────────────────────────────
#define cuPrintf(...)  printf(__VA_ARGS__)

#endif // __CUDACC__

// ── [V8] Unified CUDA_CHECK macro (both build modes) ───────────────────
// Defined OUTSIDE the __CUDACC__ branch so it is available identically to
// real nvcc translation units (cudaError_t / cudaGetErrorString from the
// implicitly included cuda_runtime.h) and to plain g++ builds (the CPU
// shims above). Shared by src/gpu_solver.cu, tools/gen_preflop_3way.cpp
// and any host code touching the runtime API. Non-fatal by design: errors
// are reported to stderr and the pipeline falls back (gpu_solver_init
// returns false; callers route to the CPU path).
#ifndef CUDA_CHECK
#define CUDA_CHECK(call)                                                          \
    do {                                                                          \
        cudaError_t _cuda_check_err_ = (call);                                    \
        if (_cuda_check_err_ != cudaSuccess) {                                    \
            fprintf(stderr, "[CUDA ERROR] %s:%d: %s -> %s\n",                    \
                    __FILE__, __LINE__, #call,                                    \
                    cudaGetErrorString(_cuda_check_err_));                        \
        }                                                                         \
    } while (0)
#endif

#endif // CUDA_COMPAT_H

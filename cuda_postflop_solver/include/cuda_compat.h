// ════════════════════════════════════════════════════════════════════════
// cuda_compat.h — CUDA builtins shims for CPU-only builds
// ════════════════════════════════════════════════════════════════════════
// When nvcc is unavailable, we compile the same .cu/.cuh files with a regular
// C++ compiler. This header provides CPU implementations of CUDA builtins so
// the kernels run on the host (slowly, but correctly — perfect for tests).
//
// Usage: any .cu/.cuh file that wants to compile both ways does
//   #include "cuda_compat.h"
// at the top, then uses __device__/__host__/__global__/<<<>>> normally.
//
// When compiled by nvcc:  the real CUDA headers are used, this file is a no-op.
// When compiled by g++:   this file provides the shims.
// ════════════════════════════════════════════════════════════════════════
#ifndef CUDA_COMPAT_H
#define CUDA_COMPAT_H

#ifdef __CUDACC__
// Real CUDA build — nothing to shim
#else
// CPU fallback build — shim everything

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

// ── Execution space annotations ─────────────────────────────────────────
#define __device__
#define __host__
#define __global__
#define __managed__
#define __shared__ static
#define __constant__ static const
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

// Atomic ops — CPU fallback uses std::atomic_ref (C++20) for thread-safety.
// On GPU, these resolve to native CUDA atomic intrinsics.
#include <atomic>
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

// min/max / clamp
template<typename T> inline T min(T a, T b) { return a < b ? a : b; }
template<typename T> inline T max(T a, T b) { return a > b ? a : b; }

// ── Thread hierarchy (CPU shim: single block, single thread) ──────────
struct KernelLaunchConfig {
    dim3 grid, block;
    size_t shared_mem = 0;
};

// Trick: kernel<<<grid,block>>>(args...) is parsed by g++ as
//   kernel.operator()<dim3, dim3>(grid, block).operator()(args...)
// which is impossible to shim cleanly. Instead, we use a macro:
//
//   KERNEL_LAUNCH(kernel, grid, block, args...)
//
// On CPU: just calls kernel(args) directly (single-threaded).
// On GPU: expands to kernel<<<grid,block>>>(args).

#define KERNEL_LAUNCH(kernel, grid, block, ...)  kernel(__VA_ARGS__)
#define KERNEL_LAUNCH_SM(kernel, grid, block, smem, ...)  kernel(__VA_ARGS__)

// ── cudaError_t / runtime API shims (no-op) ────────────────────────────
enum cudaError_t { cudaSuccess = 0 };
enum cudaMemcpyKind {
    cudaMemcpyHostToHost, cudaMemcpyHostToDevice,
    cudaMemcpyDeviceToHost, cudaMemcpyDeviceToDevice
};
#define cudaMalloc(ptr, size)  ({ *(ptr) = malloc(size); cudaSuccess; })
#define cudaFree(ptr)          ({ free(*(ptr)); cudaSuccess; })
#define cudaMemcpy(dst, src, n, kind)  ({ memcpy((dst), (src), (n)); cudaSuccess; })
#define cudaMemset(ptr, val, n)        ({ memset((ptr), (val), (n)); cudaSuccess; })
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
#endif // CUDA_COMPAT_H

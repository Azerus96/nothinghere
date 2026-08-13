# ════════════════════════════════════════════════════════════════════════
# CMakeLists.txt — CUDA postflop solver build system
# ════════════════════════════════════════════════════════════════════════
cmake_minimum_required(VERSION 3.16)
project(cuda_postflop_solver LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_compile_options(
    -Wall -Wno-unused-function -Wno-unused-variable
    -Wno-unused-parameter -Wno-sign-compare
    -O3
    -march=native
    -ffast-math
    -funroll-loops
)

option(USE_CUDA "Build with CUDA support (otherwise CPU-only fallback)" OFF)

if(NOT DEFINED USE_CUDA)
    find_package(CUDA QUIET)
    if(CUDA_FOUND)
        set(USE_CUDA ON CACHE BOOL "CUDA detected" FORCE)
        message(STATUS "CUDA detected: ${CUDA_TOOLKIT_ROOT_DIR}")
    else()
        set(USE_CUDA OFF CACHE BOOL "No CUDA" FORCE)
        message(STATUS "CUDA not found — building CPU-only fallback.")
    endif()
endif()

include_directories(${CMAKE_SOURCE_DIR}/include)

# ── CPU-only build ──────────────────────────────────────────────────────
if(NOT USE_CUDA)
    add_library(postflop_core STATIC
        src/hand_evaluator.cpp
        src/range.cpp
        src/action_tree.cpp
        src/game.cpp
        src/solver.cpp
        src/gpu_solver_stub.cpp
    )
    target_compile_definitions(postflop_core PUBLIC CPU_ONLY=1)

# ── CUDA build ──────────────────────────────────────────────────────────
else()
    enable_language(CUDA)
    set(CMAKE_CUDA_STANDARD 17)
    set(CMAKE_CUDA_STANDARD_REQUIRED ON)
    
    set(CMAKE_CUDA_SEPARABLE_COMPILATION ON)

    if(NOT DEFINED CUDA_ARCH)
        set(CUDA_ARCH 75)   # Tesla T4
    endif()
    set(CMAKE_CUDA_ARCHITECTURES ${CUDA_ARCH})

    add_library(postflop_core STATIC
        src/hand_evaluator.cpp
        src/hand_evaluator.cu
        src/range.cpp
        src/action_tree.cpp
        src/game.cpp
        src/solver.cpp
        src/solver_kernels.cu
        src/gpu_solver.cu
    )
    target_compile_definitions(postflop_core PUBLIC CUDA_BUILD=1)
    target_compile_options(postflop_core PRIVATE
        $<$<COMPILE_LANGUAGE:CUDA>:
            -O3 --use_fast_math
            --extra-device-vectorization
            -Xptxas=-v
        >
    )
endif()

# ── Tests ───────────────────────────────────────────────────────────────
enable_testing()

add_executable(test_evaluator tests/test_evaluator.cpp)
target_link_libraries(test_evaluator PRIVATE postflop_core)
add_test(NAME evaluator COMMAND test_evaluator)

add_executable(test_real_poker tests/test_real_poker.cpp)
target_link_libraries(test_real_poker PRIVATE postflop_core)
add_test(NAME real_poker COMMAND test_real_poker)

add_executable(test_dcfr tests/test_dcfr_correctness.cpp)
target_link_libraries(test_dcfr PRIVATE postflop_core)
add_test(NAME dcfr COMMAND test_dcfr)

add_executable(test_bfs tests/test_bfs_layout.cpp)
target_link_libraries(test_bfs PRIVATE postflop_core)
add_test(NAME bfs COMMAND test_bfs)

add_executable(test_gpu tests/test_gpu_solver.cpp)
target_link_libraries(test_gpu PRIVATE postflop_core)
add_test(NAME gpu COMMAND test_gpu)

add_executable(test_v5 tests/test_v5_fixes.cpp)
target_link_libraries(test_v5 PRIVATE postflop_core)
add_test(NAME v5 COMMAND test_v5)

add_executable(test_v6 tests/test_v6_multi_game.cpp)
target_link_libraries(test_v6 PRIVATE postflop_core)
add_test(NAME v6 COMMAND test_v6)

add_executable(bench_solver bench/bench_solver.cpp)
target_link_libraries(bench_solver PRIVATE postflop_core)

# ── 4-Way Experiment ────────────────────────────────────────────────────
add_executable(experiment_4way tests/experiment_4way.cpp)
target_link_libraries(experiment_4way PRIVATE postflop_core)

add_executable(experiment_2way tests/experiment_2way.cpp)
target_link_libraries(experiment_2way PRIVATE postflop_core)

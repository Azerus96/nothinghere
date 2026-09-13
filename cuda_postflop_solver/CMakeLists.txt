# ════════════════════════════════════════════════════════════════════════
# CMakeLists.txt — CUDA postflop solver build system (dual-build)
# ════════════════════════════════════════════════════════════════════════
# CPU_ONLY build (default, no nvcc required):
#   The .cu kernel sources are compiled by plain g++/clang through the
#   cuda_compat.h abstraction layer (CPU_ONLY=1). The compat layer emulates
#   the CUDA thread/block/grid hierarchy deterministically, so the entire
#   GPU pipeline (down/up passes, terminal/rollout kernels) is compiled AND
#   executed on hosts without a GPU — this is the regression-test path.
#
# CUDA build (staging server, 2x Tesla T4, sm_75):
#   cmake -DUSE_CUDA=ON -DCUDA_ARCH=75 .. && make -j8
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
    -Wno-unknown-pragmas -Wno-format-truncation
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
        message(STATUS "CUDA not found — building CPU-only dual-build (kernels compiled via cuda_compat.h).")
    endif()
endif()

include_directories(${CMAKE_SOURCE_DIR}/include)

# ── CPU-only dual-build (g++ compiles the .cu kernel sources) ───────────
if(NOT USE_CUDA)
    # .cu files are plain C++ under the cuda_compat.h abstraction layer.
    set_source_files_properties(
        src/hand_evaluator.cu src/solver_kernels.cu src/gpu_solver.cu
        PROPERTIES LANGUAGE CXX
    )
    add_library(postflop_core STATIC
        src/hand_evaluator.cpp
        src/hand_evaluator.cu
        src/range.cpp
        src/action_tree.cpp
        src/game.cpp
        src/solver.cpp
        src/solver_kernels.cu
        src/gpu_solver.cu
        src/preflop_engine.cpp
        src/bayesian_range.cpp
        src/bet_translation.cpp
        src/node_locking.cpp
    )
    target_compile_definitions(postflop_core PUBLIC CPU_ONLY=1)

# ── CUDA build (Tesla T4, sm_75) ─────────────────────────────────────────
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
        src/preflop_engine.cpp
        src/bayesian_range.cpp
        src/bet_translation.cpp
        src/node_locking.cpp
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

# ── Live solver daemon (persistent, JSON-over-stdio) ─────────────────────
add_executable(live_solver src/live_solver.cpp)
target_link_libraries(live_solver PRIVATE postflop_core)

# ── Preflop table generator (run once; ships preflop_table.bin) ─────────
add_executable(gen_preflop_table tools/gen_preflop_table.cpp)
target_link_libraries(gen_preflop_table PRIVATE postflop_core)

# ── Tests and benchmarks ────────────────────────────────────────────────
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

# ── Section 4 automated regression suite ────────────────────────────────
add_executable(test_reg_payoffs tests/test_regression_payoffs.cpp)
target_link_libraries(test_reg_payoffs PRIVATE postflop_core)
add_test(NAME regression_payoffs COMMAND test_reg_payoffs)

add_executable(test_reg_no_fake_cards tests/test_regression_no_fake_cards.cpp)
target_link_libraries(test_reg_no_fake_cards PRIVATE postflop_core)
add_test(NAME regression_no_fake_cards COMMAND test_reg_no_fake_cards)

add_executable(test_reg_dcfr_negatives tests/test_regression_dcfr_negatives.cpp)
target_link_libraries(test_reg_dcfr_negatives PRIVATE postflop_core)
add_test(NAME regression_dcfr_negatives COMMAND test_reg_dcfr_negatives)

add_executable(test_reg_locking tests/test_regression_locking_semantics.cpp)
target_link_libraries(test_reg_locking PRIVATE postflop_core)
add_test(NAME regression_locking_semantics COMMAND test_reg_locking)

add_executable(test_reg_blockers tests/test_regression_blockers_multiway.cpp)
target_link_libraries(test_reg_blockers PRIVATE postflop_core)
add_test(NAME regression_blockers_multiway COMMAND test_reg_blockers)

add_executable(test_reg_subgame tests/test_regression_subgame_hu_vs_mw.cpp)
target_link_libraries(test_reg_subgame PRIVATE postflop_core)
add_test(NAME regression_subgame_hu_vs_mw COMMAND test_reg_subgame)

add_executable(test_reg_preflop tests/test_regression_preflop_169.cpp)
target_link_libraries(test_reg_preflop PRIVATE postflop_core)
add_test(NAME regression_preflop_169 COMMAND test_reg_preflop)

add_executable(test_cpu_gpu_consistency tests/test_cpu_gpu_consistency.cpp)
target_link_libraries(test_cpu_gpu_consistency PRIVATE postflop_core)
add_test(NAME cpu_gpu_consistency COMMAND test_cpu_gpu_consistency)

add_executable(bench_solver bench/bench_solver.cpp)
target_link_libraries(bench_solver PRIVATE postflop_core)

add_executable(experiment_4way tests/experiment_4way.cpp)
target_link_libraries(experiment_4way PRIVATE postflop_core)

add_executable(experiment_2way tests/experiment_2way.cpp)
target_link_libraries(experiment_2way PRIVATE postflop_core)

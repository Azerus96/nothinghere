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
    # LANGUAGE CXX routes them to the C++ compiler; the explicit "-x c++"
    # forces the driver to compile (g++ would otherwise treat .cu as a
    # linker input on this toolchain).
    set_source_files_properties(
        src/hand_evaluator.cu src/solver_kernels.cu src/gpu_solver.cu
        PROPERTIES LANGUAGE CXX
    )
    # Explicit "-x c++" (two separate list entries): the driver would
    # otherwise treat .cu as a linker input on this toolchain.
    set_property(SOURCE src/hand_evaluator.cu src/solver_kernels.cu src/gpu_solver.cu
                 APPEND PROPERTY COMPILE_OPTIONS -x c++)
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
# [V8] registered with WORKING_DIRECTORY = source dir at the end of this
# file (the artifact preflop_table.bin ships next to the sources).

add_executable(test_cpu_gpu_consistency tests/test_cpu_gpu_consistency.cpp)
target_link_libraries(test_cpu_gpu_consistency PRIVATE postflop_core)
add_test(NAME cpu_gpu_consistency COMMAND test_cpu_gpu_consistency)

add_executable(bench_solver bench/bench_solver.cpp)
target_link_libraries(bench_solver PRIVATE postflop_core)

add_executable(experiment_4way tests/experiment_4way.cpp)
target_link_libraries(experiment_4way PRIVATE postflop_core)

add_executable(experiment_2way tests/experiment_2way.cpp)
target_link_libraries(experiment_2way PRIVATE postflop_core)

# ════════════════════════════════════════════════════════════════════════
# [V8] Master Technical Specification — 8-Max MTT Modernization
# ════════════════════════════════════════════════════════════════════════

# ── V8 artifact generators (heavy compute runs on the 2x Tesla T4 staging
#    cluster; --dry-run sanity paths run anywhere in < 5 s) ───────────────

# Module 3: 169^3 x 3 three-way preflop tensor (P3TB, ~57.9 MB).
# Deterministic GPU Monte Carlo (5000 samples/cell) — exact enumeration
# would cost ~8.26e13 operations (~4 days).
add_executable(gen_preflop_3way tools/gen_preflop_3way.cpp)
target_link_libraries(gen_preflop_3way PRIVATE postflop_core)

# Module 6: MTT preflop anchor table (MTTA) over the 27-point stack grid,
# 8 positions x 169 classes x 4 actions, uint8 probabilities, driven by the
# embedded 184-flop NNLS-weighted subset.
add_executable(gen_mtt_anchors tools/gen_mtt_anchors.cpp)
target_link_libraries(gen_mtt_anchors PRIVATE postflop_core)

# ── V8 regression suite ─────────────────────────────────────────────────

# Module 1: 8-max scaling & memory integrity (24 assertions).
add_executable(test_reg_8max tests/test_regression_8max.cpp)
target_link_libraries(test_reg_8max PRIVATE postflop_core)
add_test(NAME regression_8max COMMAND test_reg_8max)

# Module 2: exact 820-board JIT flop engine (8 assertions).
add_executable(test_reg_exact_820 tests/test_regression_exact_820.cpp)
target_link_libraries(test_reg_exact_820 PRIVATE postflop_core)
add_test(NAME regression_exact_820 COMMAND test_reg_exact_820)

# Module 4: tournament ICM engine — Malmuth-Harville + bubble factor (17
# assertions).
add_executable(test_reg_icm tests/test_regression_icm.cpp)
target_link_libraries(test_reg_icm PRIVATE postflop_core)
add_test(NAME regression_icm COMMAND test_reg_icm)

# Module 5: dynamic HUD node-locking (19 assertions).
add_executable(test_reg_dynamic_locking tests/test_regression_dynamic_locking.cpp)
target_link_libraries(test_reg_dynamic_locking PRIVATE postflop_core)
add_test(NAME regression_dynamic_locking COMMAND test_reg_dynamic_locking)

# Modules 3 + 6: 3-way tensor + MTT anchors — binary I/O, generator E2E
# dry-runs, and live_solver daemon wiring (32 assertions). Runs from the
# BUILD directory: the dry-run artifacts and the staged anchor file are
# bin-relative, and the daemon subprocesses resolve them via CWD.
add_executable(test_reg_preflop_3way tests/test_regression_preflop_3way.cpp)
target_link_libraries(test_reg_preflop_3way PRIVATE postflop_core)
target_compile_definitions(test_reg_preflop_3way PRIVATE
    SOURCE_ROOT="${CMAKE_SOURCE_DIR}"
    POSTFLOP_TEST_BIN_DIR="${CMAKE_BINARY_DIR}"
)
add_test(NAME regression_preflop_3way COMMAND test_reg_preflop_3way)
set_tests_properties(regression_preflop_3way PROPERTIES
    WORKING_DIRECTORY "${CMAKE_BINARY_DIR}"
)

# TEST-7 (re-registered): the 169x169x3 RVR engine loads preflop_table.bin
# from the SOURCE directory where the shipped artifact lives.
add_test(NAME regression_preflop_169 COMMAND test_reg_preflop)
set_tests_properties(regression_preflop_169 PROPERTIES
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
)

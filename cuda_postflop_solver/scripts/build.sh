#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
# build.sh — CPU-only dual-build of cuda_postflop_solver (g++ / C++20)
# ════════════════════════════════════════════════════════════════════════
# Compiles the full tree (including the .cu kernel sources) with plain g++
# through the cuda_compat.h dual-build abstraction layer, CPU_ONLY=1.
# Usage: scripts/build.sh [asan|ubsan]   (optimization via OPT env, default -O2)
# ════════════════════════════════════════════════════════════════════════
set -e
# Repo root = parent of this script's directory (works from any checkout
# path; also survives invocation via symlink or from a foreign cwd).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src"
INC="$ROOT/include"
OUT="$ROOT/build_cpu"
mkdir -p "$OUT"

OPT="${OPT:--O2}"
MODE="${1:-}"
case "$MODE" in
  asan)  SAN="-fsanitize=address -fno-omit-frame-pointer -g" ;;
  ubsan) SAN="-fsanitize=undefined -fno-omit-frame-pointer -g" ;;
  *)     SAN="" ;;
esac

CXXFLAGS="-std=c++20 $OPT -march=native -ffast-math -funroll-loops -Wall -Wno-unused-parameter -Wno-unknown-pragmas -Wno-sign-compare -Wno-format-truncation -I$INC -DCPU_ONLY=1 $SAN"

echo "[build] repo root: $ROOT"
echo "[build] flags: $CXXFLAGS"

# ── Core library objects ────────────────────────────────────────────────
compile() {
  local srcfile="$1"; local obj="$2"
  case "$srcfile" in
    *.cu) g++ $CXXFLAGS -x c++ -c "$srcfile" -o "$obj" ;;
    *)    g++ $CXXFLAGS -c "$srcfile" -o "$obj" ;;
  esac
}

LIB_OBJS=""
for unit in hand_evaluator.cpp range.cpp action_tree.cpp game.cpp solver.cpp \
            hand_evaluator.cu solver_kernels.cu gpu_solver.cu preflop_engine.cpp \
            bayesian_range.cpp bet_translation.cpp node_locking.cpp; do
  srcfile="$SRC/$unit"
  if [ ! -f "$srcfile" ]; then continue; fi   # optional modules (built later)
  obj="$OUT/$(basename "$unit" .cpp).o"
  obj="${obj%.o}.o"
  if [ "$unit" = "hand_evaluator.cu" ]; then obj="$OUT/hand_evaluator_cu.o"; fi
  if [ "$unit" = "hand_evaluator.cpp" ]; then obj="$OUT/hand_evaluator_cpp.o"; fi
  if [ "$unit" = "solver_kernels.cu" ]; then obj="$OUT/solver_kernels_cu.o"; fi
  if [ "$unit" = "gpu_solver.cu" ]; then obj="$OUT/gpu_solver_cu.o"; fi
  echo "[build] CC $unit -> $(basename $obj)"
  compile "$srcfile" "$obj"
  LIB_OBJS="$LIB_OBJS $obj"
done

ar rcs "$OUT/libpostflop_core.a" $LIB_OBJS
echo "[build] static lib: $OUT/libpostflop_core.a"

# ── Tests & tools ───────────────────────────────────────────────────────
build_bin() {
  local name="$1"; local src2="$2"
  echo "[build] LD $name"
  g++ $CXXFLAGS "$src2" "$OUT/libpostflop_core.a" -o "$OUT/$name" -pthread
}

for t in test_evaluator test_real_poker test_dcfr_correctness test_bfs_layout \
         test_gpu_solver test_v5_fixes test_v6_multi_game \
         test_regression_payoffs test_regression_no_fake_cards \
         test_regression_dcfr_negatives test_regression_locking_semantics \
         test_regression_blockers_multiway test_regression_subgame_hu_vs_mw \
         test_regression_preflop_169 test_cpu_gpu_consistency; do
  src2="$ROOT/tests/$t.cpp"
  if [ -f "$src2" ]; then build_bin "$t" "$src2"; fi
done

build_bin live_solver "$SRC/live_solver.cpp"
[ -f "$ROOT/tools/gen_preflop_table.cpp" ] && build_bin gen_preflop_table "$ROOT/tools/gen_preflop_table.cpp"
[ -f "$ROOT/bench/bench_solver.cpp" ] && build_bin bench_solver "$ROOT/bench/bench_solver.cpp"

echo "[build] DONE -> $OUT"

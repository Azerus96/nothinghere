// ════════════════════════════════════════════════════════════════════════
// hand_evaluator.cpp — Host-side evaluator instance
// ════════════════════════════════════════════════════════════════════════
// All evaluator functions are inline in hand_evaluator.h.
// This .cpp file exists only to define the HAND_TABLE global symbol
// for CPU-only builds. On CUDA builds, hand_evaluator.cu defines it.
// ════════════════════════════════════════════════════════════════════════
#include "hand_evaluator.h"

#ifndef __CUDACC__
// CPU-only build: include the HAND_TABLE data here.
#include "hand_table_data.inc"
#endif

// ════════════════════════════════════════════════════════════════════════
// flop_subset_184.h — [Module 6.1, V8] embedded 184-flop Pio subset + NNLS
// weights (sum = 529.28)
// ════════════════════════════════════════════════════════════════════════
// The 184-flop canonical subset is embedded DIRECTLY into a C++ header so
// no runtime filesystem lookup can fail on Kaggle / staging servers
// (preflop_anchors_mtt.bin generation and any weighted postflop EV
// aggregation read these constants; the weights are the NNLS solution of
// the subset-fitting problem, normalized to the historical 529.28 total).
//
// Weighted aggregation formula (Module 8.3):
//   EV_preflop = Σ_{i=1..184} EV_i × w_i / 529.28
// ════════════════════════════════════════════════════════════════════════
#ifndef FLOP_SUBSET_184_H
#define FLOP_SUBSET_184_H

#include <cstdint>
#include <array>

namespace postflop {

struct FlopSubsetEntry {
    const char* cards_str;
    float weight;
};

constexpr int NUM_FLOP_SUBSET_184 = 184;
constexpr float FLOP_SUBSET_184_WEIGHT_SUM = 529.28f;

inline const std::array<FlopSubsetEntry, 184> FLOP_SUBSET_184 = {{
    {"TsTdTc", 0.47f}, {"AsAdAc", 2.16f}, {"2s2d6c", 3.26f}, {"2s2dTc", 1.26f},
    {"3s3d8s", 4.57f}, {"3s3dJc", 3.16f}, {"4s4d3c", 4.02f}, {"4s4dKc", 1.60f},
    {"5s5d7c", 6.28f}, {"6s6d8s", 0.15f}, {"6s6d9s", 2.99f}, {"6s6d9c", 0.54f},
    {"6s6dJs", 4.11f}, {"7s7dTs", 3.22f}, {"7s7dQc", 2.21f}, {"8s8d3s", 1.97f},
    {"8s8dTc", 4.28f}, {"9s9d3s", 3.86f}, {"9s9d3c", 1.15f}, {"9s9dAc", 2.75f},
    {"TsTd5c", 4.95f}, {"JsJd4c", 4.26f}, {"JsJd5c", 1.31f}, {"JsJd7c", 1.86f},
    {"QsQd3c", 0.45f}, {"QsQd8s", 4.82f}, {"KsKd4s", 2.32f}, {"KsKd6c", 0.36f},
    {"KsKd9c", 3.16f}, {"KsKdTc", 0.09f}, {"KsKdAs", 0.75f}, {"AsAd5c", 1.37f},
    {"AsAdJs", 2.83f}, {"2s3s4s", 3.17f}, {"2s3d5c", 2.71f}, {"2s3d6c", 2.75f},
    {"2s3d7c", 1.11f}, {"2s3d7s", 1.40f}, {"2s3s9d", 1.55f}, {"2s3dQc", 3.37f},
    {"2s3dKs", 4.08f}, {"2d3sAs", 2.40f}, {"2s4d5c", 0.73f}, {"2s4s7d", 3.81f},
    {"2d4s8s", 1.75f}, {"2s4d9c", 6.87f}, {"2d4sAs", 1.77f}, {"2s5d6s", 3.40f},
    {"2d5s6s", 2.24f}, {"2s5dTc", 1.97f}, {"2s5dJs", 3.74f}, {"2d5sJs", 2.09f},
    {"2s6s8d", 2.91f}, {"2s6dJc", 3.79f}, {"2s6sQd", 1.12f}, {"2s7d9s", 5.75f},
    {"2s7dTc", 0.91f}, {"2d7sTs", 1.03f}, {"2s7dAs", 5.52f}, {"2s8dTc", 0.27f},
    {"2s8sTs", 3.39f}, {"2d8sQs", 0.27f}, {"2s8dKc", 5.09f}, {"2d8sKs", 2.63f},
    {"2s8dAc", 3.92f}, {"2sTdQc", 6.29f}, {"2dTsQs", 4.79f}, {"2dTsAs", 2.75f},
    {"2sJdQs", 3.93f}, {"2sQsKd", 3.93f}, {"3d4s5s", 2.47f}, {"3s4s6s", 2.66f},
    {"3s4dJc", 1.82f}, {"3s4dKs", 2.99f}, {"3s4dAc", 3.62f}, {"3d5s8s", 3.91f},
    {"3s5sJd", 2.81f}, {"3s5dAc", 4.53f}, {"3s6s9d", 5.39f}, {"3s6dKc", 2.44f},
    {"3d6sAs", 2.68f}, {"3s7d8c", 5.78f}, {"3s7d8s", 0.35f}, {"3s7sJs", 3.45f},
    {"3s7dQc", 4.39f}, {"3s7dAc", 0.43f}, {"3s7sAd", 0.59f}, {"3s8d9c", 0.75f},
    {"3d8sJs", 5.20f}, {"3s9dTc", 5.46f}, {"3s9sQs", 1.51f}, {"3sTsKd", 5.87f},
    {"3sTdAc", 0.98f}, {"3dJsAs", 4.43f}, {"3dQsKs", 1.35f}, {"3sQsAs", 2.02f},
    {"4d5sTs", 6.97f}, {"4s5dKc", 0.92f}, {"4s5sKd", 2.62f}, {"4s5dKs", 4.42f},
    {"4d5sAs", 1.67f}, {"4s6d7s", 2.70f}, {"4d6s8s", 1.15f}, {"4s6d9c", 0.47f},
    {"4s6sJs", 1.45f}, {"4s6dQc", 6.13f}, {"4s6dKc", 4.53f}, {"4s6dAc", 1.75f},
    {"4s7d8c", 4.42f}, {"4s7sTd", 3.99f}, {"4d7sQs", 1.77f}, {"4d8s9s", 1.52f},
    {"4s8dJc", 2.94f}, {"4s8dQc", 3.62f}, {"4d9sJs", 2.47f}, {"4s9sJs", 2.41f},
    {"4s9dQc", 1.78f}, {"4sTdJc", 2.91f}, {"4sTsAd", 4.74f}, {"4sJdQc", 3.23f},
    {"5d6s7s", 1.19f}, {"5s6d8s", 0.17f}, {"5d6s8s", 4.14f}, {"5s6dJc", 1.16f},
    {"5s6sKs", 0.08f}, {"5s6dAc", 4.06f}, {"5d7s8s", 1.73f}, {"5s7d9s", 1.65f},
    {"5d7s9s", 1.18f}, {"5s7sQd", 3.90f}, {"5s7sAs", 1.31f}, {"5s8d9c", 1.88f},
    {"5s8sAs", 2.40f}, {"5s9sTd", 0.40f}, {"5s9sQd", 3.38f}, {"5s9dQs", 4.65f},
    {"5s9dKc", 5.75f}, {"5sTdQc", 0.99f}, {"5sTsQd", 1.78f}, {"5sTdKs", 5.36f},
    {"5sTdAc", 0.83f}, {"5dJsQs", 3.11f}, {"5sJsAd", 3.41f}, {"6s7dTc", 3.75f},
    {"6s7sKd", 5.66f}, {"6s7dAc", 2.14f}, {"6s8d9c", 4.36f}, {"6s8dTs", 1.70f},
    {"6s8dQs", 5.18f}, {"6s9dTs", 3.85f}, {"6s9sAs", 1.80f}, {"6sTdJc", 6.90f},
    {"6dTsAs", 2.40f}, {"6sJdKs", 4.48f}, {"6sQsKs", 0.39f}, {"6sQdAc", 3.39f},
    {"7s8sTd", 2.85f}, {"7s8dJc", 2.16f}, {"7s9dJc", 5.73f}, {"7s9sKs", 3.63f},
    {"7sTdAc", 0.29f}, {"7sQsKd", 4.06f}, {"7dQsKs", 2.34f}, {"7sQsAd", 1.96f},
    {"7sQdAs", 3.81f}, {"7dKsAs", 2.31f}, {"8s9dTs", 3.29f}, {"8s9sAd", 6.03f},
    {"8sTdJs", 0.93f}, {"8sJdKc", 7.03f}, {"8sKsAd", 2.85f}, {"8dKsAs", 2.25f},
    {"9dTsJs", 3.49f}, {"9sTsAd", 3.80f}, {"9sJdQc", 2.65f}, {"9sQsKd", 2.08f},
    {"9sQsAd", 4.05f}, {"9sKdAs", 3.27f}, {"TdJsQs", 1.70f}, {"TsJsKs", 2.31f},
    {"JsQdKc", 1.98f}, {"JdQsAs", 2.03f}, {"JsKsAd", 7.06f}, {"QsKdAs", 2.63f}
}};

} // namespace postflop

#endif // FLOP_SUBSET_184_H

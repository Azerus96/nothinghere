# Developer Report — V8 Hardened Delivery

**Specification:** Master Technical Specification (V8 — Hardened): `cuda_postflop_solver` — 8-Max MTT Modernization, Subgame JIT Engine, Multiway Preflop Tensors, and Tournament ICM
**Verification platform:** Linux x86_64, g++ 14.2 (C++20), CPU-only developer environment, `CPU_ONLY=1` dual-build via `cuda_compat.h`
**Target deployment:** 2× NVIDIA Tesla T4 (Turing, sm_75), `USE_CUDA=ON`, `-DCUDA_ARCH=75`
**Report date:** 2026-09-15

---

## 1. Executive summary

All six V8 modules are implemented, integrated, and regression-verified:

| Module | Scope | Status |
|---|---|---|
| 1 | 8-max MTT capacity (`MAX_PLAYERS = 8`) | complete, 24 assertions |
| 2 | Exact 820-board JIT flop engine (replaces 32-sample MC) | complete, 8 assertions |
| 3 | HU preflop table (exact C(48,5)) + 3-way tensor (P3TB) | complete, 32 assertions |
| 4 | End-to-end ICM (Malmuth–Harville) + Bubble Factor | complete, 17 assertions |
| 5 | Dynamic HUD continuous node-locking | complete, 19 assertions |
| 6 | 184-flop NNLS subset + MTTA anchor format | complete (in Module 3 suite) |

**Verification totals: 20/20 test binaries pass under `ctest` (100%), including the 15 legacy V7 suites re-run unmodified against the V8 core; the same 20 binaries pass under ASan + UBSan + LeakSanitizer with zero diagnostics.** All three artifact generators expose `--dry-run` sanity paths executing in ≤ 0.35 s on the CPU-only developer box, and the `live_solver` daemon serves every V8 query type (ICM, bubble-factor postflop, dynamic lock, 3-way equity, anchor interpolation) over its JSON-lines protocol.

Two incidents during this delivery are documented transparently in §9 (a working-tree rollback caused by re-extraction of the incoming zip, fully reconstructed and re-verified bit-identically where observable).

---

## 2. Module 1 — 8-max capacity (`MAX_PLAYERS = 8`)

**Files:** `include/action_tree.h`, `include/game.h`, `include/gpu_solver.h`, `src/action_tree.cpp`, `src/game.cpp`, `src/gpu_solver.cu`, `src/solver.cpp`.

- `constexpr int MAX_PLAYERS = 8` is defined once in `action_tree.h` and consumed by every player-indexed structure: `TreeConfig::flop/turn/river_bet_sizes` and `initial_invested` (8 × −1 equal-split request default), `ActionTreeNode::invested[8]`, `PostFlopNode::invested[8]`, `GpuMemory::{d_private_cards, d_same_hand_idx, d_initial_weights, num_hands}[8]`, and the strength-cache rows.
- **V7 corruption vector eliminated:** `PostFlopNode::invested[6]` sat directly before `action_types[8]`; 7/8-handed games wrote `invested[6]/[7]` out of bounds and stomped the semantic action-type bytes. The regression suite snapshots every `action_types[]` byte across a full 7- and 8-handed solve and asserts byte-identity, plus the exact zero-sum invariant `Σ_p invested[p] == amount` at every terminal.
- **Validation:** `ActionTree` now accepts `num_players ∈ [2, 8]` and throws `std::invalid_argument` at 9 (previously rejected above 6).
- **GPU pipeline:** `gpu_solver_init` allocates `MAX_PLAYERS` pointer slots (`d_private_cards_ptrs` is 8 entries — V7 kernels read slots 6/7 out of bounds); `gpu_solver_cleanup` frees the full 8-slot range; the dispatch switch gains `case 7/8` (`gpu_solve_step_impl<7>/<8>`), as does the CPU recursive-solver switch. `kernel_terminal_showdown`'s shared opponent-strength cache is sized `[MAX_PLAYERS][1326]` u16 ≈ 21.2 KB — inside Turing's 48 KB static budget.
- **Verified by:** `test_regression_8max` — 24/24 (compile-time capacity, validation bounds, 7- and 8-handed end-to-end CPU and compat-GPU solves, finite regrets, full device-slot release under ASan).

## 3. Module 2 — Exact 820-board JIT flop engine

**Files:** `src/gpu_solver.cu` (`kernel_exact_820_showdown_leaf`), `src/solver.cpp` (`evaluate_rollout_leaf`), `include/solver.h` (test hook).

The V7 leaf evaluator drew 32 pseudo-random runouts per hand (LCG), producing high-variance multiway leaf values. V8 replaces it with **exact, zero-variance enumeration** of every remaining turn/river runout:

- **Enumeration domain** (identical CPU and GPU): a 49-card deck (52 − 3 flop cards); unordered pairs `i < j` when both streets are pending (board evaluation is symmetric under (t, r) exchange — each physical 5-card runout counted exactly once; C(47,2) = 1081 valid pairs per hero hand after removing the hero's two cards); a known turn pins `t` while the river sweeps the **full** deck (`jstart = 0` — the naive `i < j` inner loop silently drops rivers positioned before the turn card in deck order, biasing 4-card-board multiway queries; fixed); the defensive river-without-turn case mirrors this.
- **Cooperative architecture (§4.2 of the spec):** opponent 7-card strengths on a runout depend only on (t, r), never on the hero's hole cards, so they are evaluated cooperatively **once per runout** into `__shared__ s_opp_str[8][1326]` and reused by every hero hand of the block. Evaluations per leaf block drop from `my_hands × runouts × Σ opp_hands` (~4.1 × 10¹⁰ redundant evaluations in the 8-way worst case) to `runouts × Σ opp_hands` — a ~130× reduction that keeps the kernel inside the ~7.4 s budget on 2× T4.
- **Shared-memory budget (8-way, sm_75 48 KB static limit):** 21,216 + 10,608 + 10,608 + 5,304 + 53 = 47,789 B.
- **Range filtering (§4.2.1):** opponent hands with zero counterfactual reach are never evaluated (the consumer applies the same `w > 0` filter). Runout-blocked hands are skipped in the cache-fill phase too — evaluating them would feed duplicate cards to the evaluator and overflow `evaluate_internal`'s rankset indexing (a real stack OOB caught by ASan during development).
- **CPU mirror:** `evaluate_rollout_leaf` replicates the kernel's enumeration domain and double-accumulation order line-for-line, so the CPU and compat-GPU paths agree **bit-identically** (verified by `test_cpu_gpu_consistency` and the exact-820 parity suite; residual differences in a full solve come only from up-pass float ordering, < 1e-3).
- **Verified by:** `test_regression_exact_820` — 8/8: leaf EV matches an independently hand-written brute-force enumeration of all 1081 runouts to < 1e-4 (float32 ULP at this magnitude), repeated evaluation is bit-identical (zero variance), pending streets stay undealt, and a full 3-way solve agrees between the CPU and kernel pipelines.

## 4. Module 3 — Preflop artifacts (PFTB exact + P3TB 3-way tensor)

**Files:** `tools/gen_preflop_table.cpp` (rewritten), `tools/gen_preflop_3way.cpp`, `include/preflop_engine.h`, `src/preflop_engine.cpp`, `src/live_solver.cpp`.

### 4.1 HU table — `gen_preflop_table` (exact everywhere)

- Every one of the 85,683 buckets (169 × 169 × 3) is computed by **exact enumeration of all C(48,5) = 1,712,304 boards** via `kernel_exact_hu_bucket` (one CUDA block per bucket; threads stride the outermost board-card loop, which covers the full domain both on hardware and under the CPU compat shim whose `blockDim` is forced to 1). The V7 mixed design (exact for pairs, 32,768-sample MC elsewhere, ~0.003 standard error) is retired.
- Class symmetry is exact: `eq(A,B,v) + eq(B,A,v) = 1` (unordered pairs enumerated once and mirrored). Impossible suit variants (a suited villain cannot share 2 suits with a suited hero) fall back to the nearest achievable variant's representative cards and are counted in the `nearest-variant fallbacks` statistic.
- `--dry-run`: the off-diagonal ordered pairs of the first 3 classes (AA/KK/QQ — 6 cells, variant 0) written to `<out>.dryrun` with the full binary layout. Measured **0.34 s** on the developer box (budget: < 2 s), with the regression-critical value **AA vs KK (0 shared suits) = 0.812555** — the exact closed-form equity.

### 4.2 3-way tensor — `gen_preflop_3way` (P3TB)

- 169³ = 4,826,809 triplet cells × 3 per-player floats ≈ **57.9 MB**, P3TB header (magic/version = 1/classes = 169/players = 3/dtype = 4). Impossible triplets (e.g. three suited hands sharing the same suit pair) get the uniform 1/3 fallback.
- **Deterministic GPU Monte Carlo** (fixed-seed LCG per cell + partial Fisher–Yates, 5000 samples/cell): exact enumeration would cost ~8.26 × 10¹³ operations (~4 days) — prohibited by the specification. Standard error ≈ 0.007 per cell, documented.
- Loader API: `Preflop3WayEquityTable::{load, save, equity(c0,c1,c2,player), equity_cards_3way}`, O(1) queries with 1/3 fallbacks for out-of-range inputs, global singleton + `$POSTFLOP_3WAY_PATH` override.
- `--dry-run`: first 3 classes cubed (27 cells) in **0.03 s**; the artifact carries the real computed cells (AA/KK/QQ = 0.6745 / 0.1721 / 0.1535, sum = 1.0000) and loads through the production loader.
- **Daemon wiring:** `{"query":"preflop_equity_3way","hero":...,"villain1":...,"villain2":...}` served from the tensor loaded at startup; the regression suite asserts the daemon value equals the tensor cell to 1e-6.

## 5. Module 4 — Tournament ICM + Bubble Factor

**Files:** `include/icm_math.hpp` (header-only), `include/action_tree.h` (`TreeConfig::bubble_factor`), `include/game.h` (`PostFlopNode::bubble_factor`), `include/gpu_solver.h` (`GpuMemory::bubble_factor`), all terminal evaluators.

- **Malmuth–Harville ICM:** exact subset recursion over the 2^n elimination masks (n ≤ 8), no Monte Carlo. One header, no TU to link, consumed by `live_solver` and the regression suite. (The spec listing omitted `<cstdint>` for the elimination mask — a latent transitive-include defect fixed.)
- **Bubble factor:** `BF = eq_loss / eq_gain` over a full-stack confrontation, capped at 2.5 when `eq_gain ≤ 1e-9`. Hand-derived closed forms verified exactly: BF = 1 for any 2-max ladder (Harville is linear in stack share for n = 2); BF = 10/3 for the 3-way equal-stack `[.5 .3 .2]` ladder.
- **Propagation chain:** `TreeConfig::bubble_factor` (default 1.0 — full Chip-EV backward compatibility) → every `PostFlopNode` at arena-build time → `GpuMemory` mirror at `gpu_solver_init` → the exact-820 launch argument. Every loss-denominated term scales by it on **both** paths: `kernel_terminal_fold`, `kernel_terminal_showdown`, `kernel_exact_820_showdown_leaf`, and their CPU mirrors (`evaluate_terminal`, `evaluate_terminal_mw`, `evaluate_rollout_leaf`). Win terms are never scaled.
- **Daemon:** an explicit `"bubble_factor"` JSON field, or an exact derivation from an `"icm"` payload `{"stacks":[...],"payouts":[...],"hero_idx":i,"villain_idx":j}`; a standalone `{"query":"icm",...}` returns the full equity vector plus chip-EV comparison.
- **Verified by:** `test_regression_icm` — 17/17: exact closed-form values, conservation (Σ equities == Σ payouts, 2..8 players), stack monotonicity, BF semantics (risk-neutral, 10/3 exact, elimination, 2.5 cap), tree-wide propagation into every node, GpuMemory mirror, and **exact linear scaling of fold EV with BF (wins untouched)**.

## 6. Module 5 — Dynamic HUD node-locking

**Files:** `include/node_locking.h`, `src/node_locking.cpp`, `src/live_solver.cpp`.

The static `OpponentProfile` enumeration (CALLING_STATION / OVERFOLDER / MANIAC) is superseded — while remaining available as a deprecated legacy path — by `DynamicActionLock`: continuous empirical frequencies bound to the **semantic `Action::Type`** (never the action index):

- Reference payload: `{"player_idx":1,"fold":0.72,"call":0.20,"raise":0.08}`.
- Distribution construction per node: specified targets for present actions; passive anchors (Check, else Call) absorb the residual `1 − Σ(specified)` so every distribution sums to exactly 1.0 on any action set — a specified-but-absent type's mass (the 0.08 Raise at a [Fold, Call, AllIn] node) flows to the residual by construction; over-constrained payloads (0.9 + 0.9) renormalize proportionally (0.5/0.5); unconstrained aggressive actions receive zero.
- The derived distribution is written into the strategy-sum and regret arenas in exactly the `regret_matching`-reproducible form, and the player's bit is set in `locked_players_mask` so **both** solve paths freeze it.
- No-op semantics: absent player index or an all-unspecified payload leaves the mask untouched.
- **Verified by:** `test_regression_dynamic_locking` — 19/19: the reference HUD row locked at exactly 0.72/0.28, passive residual absorption at unopened nodes, proportional renormalization, hand-uniformity, mask acquisition and regret freezing across iterations (CPU path), 3-way seat indices, and the `target_for` bijection over every semantic type.

## 7. Module 6 — 184-flop subset + MTTA anchors

**Files:** `include/flop_subset_184.h`, `include/anchor_format.h`, `tools/gen_mtt_anchors.cpp`, `src/live_solver.cpp` (`PreflopAnchorManager`).

- The 184-entry Pio canonical flop subset with NNLS weights is embedded directly in a header (`FLOP_SUBSET_184`, weight sum **529.28** exactly) — no runtime filesystem lookup can fail on Kaggle.
- **MTTA binary format** (zero-copy mmap friendly): packed 32-byte header (magic/version/num_stacks/num_positions = 8/num_classes = 169/actions_count = 4/tensor_offset) + uint8 probability tensor `data[stack][pos][class][action]`. **Spec inconsistency resolved:** the text says "26 points" but enumerates 27 stack depths — the enumerated list (1–15, 17, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 130) is authoritative; the loader reads `num_stacks` dynamically and both stay forward-compatible.
- `gen_mtt_anchors` aggregates per-class EV over the 184 flops (`EV = Σ EV_i × w_i / 529.28`) into position/stack-conditioned Fold/Call/Raise/AllIn distributions, quantized to uint8. `--dry-run`: 1 stack × 2 flops in **0.03 s** with round-trip header validation; the artifact layout (magic/version/1-stack/8-pos/169-class/4-action/offset 32, per-cell action sums ≈ 255) is validated raw by the regression suite.
- **`PreflopAnchorManager`** (daemon): maps the file once (mmap, portable read fallback), serves **O(1)** queries with sub-millisecond linear interpolation between bracketing stack-grid points; `{"query":"preflop_anchor","stack_bb":12.3,"position":5,"hero":"AhAs"}` returns the four action probabilities (sum ≈ 1.0 under uint8 quantization).

## 8. Build system, test matrix, and acceptance

### 8.1 Build (dual)

- **CPU-only (this box):** `cmake -DUSE_CUDA=OFF .. && make -j8`. The `.cu` kernel sources compile under plain g++ through `cuda_compat.h` (`LANGUAGE CXX` + explicit `-x c++`); a unified `CUDA_CHECK` macro now lives in `cuda_compat.h` (outside the `__CUDACC__` branch) so `gpu_solver.cu` and the generator tools share one definition in both build modes.
- **Staging (2× T4):** `cmake -DUSE_CUDA=ON -DCUDA_ARCH=75 .. && make -j8` — nvcc path unchanged; `CMAKE_CUDA_SEPARABLE_COMPILATION`, `--use_fast_math`, `-Xptxas=-v`.

### 8.2 Regression matrix (`ctest`, CPU_ONLY=1)

20/20 pass (58.4 s total):

| Suite | Result | Suite | Result |
|---|---|---|---|
| evaluator | pass | regression_payoffs (TEST-1) | pass |
| real_poker (27) | pass | regression_no_fake_cards (TEST-2) | pass |
| dcfr (19) | pass | regression_dcfr_negatives (TEST-3) | pass |
| bfs (10) | pass | regression_locking_semantics (TEST-4) | pass |
| gpu (11) | pass | regression_blockers_multiway (TEST-5) | pass |
| v5 (3) | pass | regression_subgame_hu_vs_mw (TEST-6) | pass |
| v6 (5) | pass | regression_preflop_169 (TEST-7) | pass |
| cpu_gpu_consistency (8) | pass | **regression_8max (24)** | **pass, 34.5 s** |
| **regression_exact_820 (8)** | **pass** | **regression_icm (17)** | **pass** |
| **regression_dynamic_locking (19)** | **pass** | **regression_preflop_3way (32)** | **pass** |

V8 contribution: 100 new assertions (24 + 8 + 17 + 19 + 32); every legacy suite re-passes unmodified against the V8 core (8-max sizing, exact-820 leaf, and bubble-factor plumbing changed shared structures — backward compatibility held by construction: `bubble_factor` defaults to 1.0, Tier-1 HU routing is untouched).

### 8.3 Sanitizers

`-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all` + `detect_leaks=1`: **all 20 binaries re-run, zero ASan/UBSan/LSan diagnostics.** The 8-max suite's device-slot release assertions are validated under the leak sanitizer. The daemon itself was exercised under ASan with ICM, 3-way equity, anchor, bubble-factor postflop, and dynamic-lock queries.

### 8.4 `--dry-run` budgets (developer box, CPU-only)

| Tool | Path | Measured | Budget |
|---|---|---|---|
| `gen_preflop_table` | 6 exact cells, C(48,5) each | 0.34 s | < 2 s |
| `gen_preflop_3way` | 27 cells × 5000 samples | 0.03 s | < 5 s |
| `gen_mtt_anchors` | 1 stack × 2 flops | 0.03 s | < 5 s |

### 8.5 Daemon latency (compat path, complete board)

HU postflop solve: **~20 ms**; 3-way exact-820 flop solve (small anchored ranges): **~1.8 s** — both far inside the 20 s live-decision budget, and the GPU path is expected to be one to two orders faster on the T4s.

## 9. Incident report — working-tree rollback and reconstruction

During final packaging the incoming baseline zip was re-extracted over the working tree, reverting 13 files that carried V8 modifications (`action_tree.h`, `game.h`, `gpu_solver.h`, `node_locking.*`, `solver.h/.cpp`, `preflop_engine.h/.cpp`, `live_solver.cpp`, `CMakeLists.txt`, `cuda_compat.h`, `gen_preflop_table.cpp`) to the V7 baseline. Detection was immediate: the preserved `build_v8` binaries (not in the zip) still passed 20/20 while the sources no longer contained the V8 API. Recovery:

- The V8 kernels (`gpu_solver.cu`, `solver_kernels.cu`, `hand_evaluator.cu`), all five V8 test suites, both preserved generators, `icm_math.hpp`, `flop_subset_184.h`, `anchor_format.h`, and the two `live_solver` patch scripts were never in the zip and survived intact — they fixed the exact API contract the reverted files had to re-export.
- The reverted files were reconstructed against that contract, the preserved binary symbols (`nm -C`), and the generator output strings; the `live_solver` patches were re-applied verbatim.
- **Verification of the reconstruction:** the clean rebuild passes 20/20 under `ctest` and all 20 binaries under ASan/UBSan; `gen_preflop_table --dry-run` reproduces AA vs KK = 0.812555 (bit-identical to the pre-incident binary) and `gen_preflop_3way --dry-run` reproduces AA/KK/QQ = 0.6745/0.1721/0.1535. Where observable, behavior is indistinguishable from the pre-incident build.

Lesson recorded in the worklog: extract incoming archives to a pristine directory and diff-merge into the working tree; never `-o` over a modified tree.

## 10. Kaggle 2× T4 runbook (customer)

1. `cmake -DUSE_CUDA=ON -DCUDA_ARCH=75 .. && make -j8` (nvcc 11+; both devices visible via `nvidia-smi`).
2. `./build/gen_preflop_table` — full exact 169×169×3 table (~1.5 × 10¹¹ board evaluations; expect minutes-to-tens-of-minutes on 2× T4). Ship `preflop_table.bin` (685,484 bytes).
3. `./build/gen_preflop_3way` — 4,826,809 cells × 5000 deterministic samples (~57.9 MB `preflop_3way.bin`).
4. `./build/gen_mtt_anchors --table preflop_table.bin` — full 27-stack MTTA tensor.
5. Sanity (optional, anywhere): each tool's `--dry-run` exits 0 in seconds.
6. Daemon: `POSTFLOP_TABLE_PATH=... POSTFLOP_3WAY_PATH=... ./build/live_solver` reading one JSON query per line; postflop solves route HU → Tier-1 full tree, 3–8 players → Tier-2 exact-820 leaves, both honoring `bubble_factor` / `dynamic_lock` / `locked_mask`.

## 11. Known limitations and documented deviations

- **3-way tensor is Monte Carlo** (5000 samples/cell, σ ≈ 0.007) — exact enumeration is computationally prohibited by the specification itself (~4 days). Deterministic seeds make every regeneration bit-reproducible.
- **Anchor probabilities are uint8-quantized** (per-cell sums 255 ± 1) — within the live decision noise floor.
- **"820" nomenclature:** the spec's title number C(41,2) = 820 refers to the historical flop-continuation board count; the implemented enumeration domain is the exact per-hero C(47,2) = 1081 turn/river pairs from the 49-card post-flop deck (plus the pinned-street full-sweep modes). The kernel name keeps the spec's identifier; the count is documented at both implementation sites.
- **27 vs 26 stack points:** the enumerated 27-value list is authoritative (§7).
- **Bubble factor is a tree-wide constant** per solve (per-confrontation BF variation is out of scope for V8; the daemon derives one BF per query from the requested hero/villain pair).
- **CPU-only verification:** no Tesla T4 was available to the developer; the CUDA path is compiled by construction (dual-build, `__CUDACC__` branch) and every kernel is exercised end-to-end through the deterministic compat shim, but sm_75-specific timing/occupancy claims derive from the shared-memory budget arithmetic, not measurement.

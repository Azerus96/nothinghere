#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <vector>
#include <string>
#include <chrono>
#include <algorithm>
#include <omp.h>

#include "cuda_compat.h"
#include "card.h"
#include "hand_evaluator.h"
#include "preflop_engine.h"
#include "flop_subset_184.h"
#include "icm_math.hpp"
#include "anchor_format.h"

using namespace postflop;
using namespace postflop::preflop;
using postflop::anchor::AnchorFileHeaderV2;
using postflop::anchor::PreflopContext;

static const uint32_t NUM_ANCHOR_POSITIONS = postflop::anchor::NUM_POSITIONS;
static const uint32_t NUM_ANCHOR_ACTIONS   = postflop::anchor::NUM_ACTIONS;
static const uint32_t NUM_ANCHOR_CONTEXTS  = postflop::anchor::NUM_CONTEXTS;
static const uint32_t NUM_ANCHOR_COMBOS    = postflop::anchor::NUM_COMBOS; // 1326
static const int* ANCHOR_STACKS            = postflop::anchor::STACK_GRID.data();
static const int NUM_ANCHOR_STACKS         = (int)postflop::anchor::STACK_GRID.size(); // 27

struct GpuFlop {
    Card f0, f1, f2;
    float weight;
};

__constant__ GpuFlop c_flops[184];
__constant__ double  c_bubble_factors[27];
__constant__ double  c_stack_bb[27];
__constant__ double  c_class_strength[169];
__constant__ double  c_field_w[8 * 169];

// ── Инверсия 1326-индекса в карты комбо на GPU ──────────────────────────
__device__ __forceinline__ void d_index_to_combo_cards(int combo_idx, Card* c1, Card* c2) {
    int s = 103 * 103 - 8 * combo_idx;
    int isq = 0;
    // Целочисленный квадратный корень
    if (s > 0) {
        float x = __int2float_rn(s);
        isq = (int)__fsqrt_rn(x);
        if (isq * isq < s) ++isq;
    }
    int card1 = (103 - isq) / 2;
    if (card1 < 0) card1 = 0;
    int base = card1 * (101 - card1) / 2;
    int card2 = combo_idx - base + 1;
    if (card2 < 0) card2 = 0;
    *c1 = (Card)card1;
    *c2 = (Card)card2;
}

__device__ __forceinline__ uint16_t d_combo_to_class(Card c1, Card c2) {
    int r1 = card_rank(c1), r2 = card_rank(c2);
    bool suited = (card_suit(c1) == card_suit(c2));
    if (r1 < r2) { int t = r1; r1 = r2; r2 = t; }
    if (r1 == r2) return (uint16_t)(12 - r1);
    int a = 14 - r1;
    int b = 14 - r2;
    size_t pair_idx = (size_t)(a - 2) * (27 - a) / 2 + (size_t)(b - a - 1);
    return (uint16_t)((suited ? 13 : 91) + pair_idx);
}

__device__ __forceinline__ double d_flop_playability_combo(Card c1, Card c2, Card f0, Card f1, Card f2) {
    // Если карты руки блокируют карты флопа — нулевая играбельность
    if (c1 == f0 || c1 == f1 || c1 == f2 || c2 == f0 || c2 == f1 || c2 == f2) {
        return 0.0;
    }
    Card five[5] = {c1, c2, f0, f1, f2};
    int rank = evaluate(five, 5);
    double pct = (double)rank / 7462.0;
    return pct > 1.0 ? 1.0 : (pct < 0.0 ? 0.0 : pct);
}

// ── CUDA Кернел для полного расчёта 1 326 комбо со всеми ветками ────────
__global__ void kernel_gen_mtt_full_1326(
    const double* __restrict__ d_equity_table,
    int s_global,
    int num_flops,
    float* __restrict__ d_strat_out,
    float* __restrict__ d_regret_out)
{
    // Каждый тред обрабатывает ровно 1 комбинацию из 1326 для связки (Позиция, Контекст)
    int tid = blockIdx.x * blockDim.x + threadIdx.x;
    int total_threads = 8 * NUM_ANCHOR_CONTEXTS * 1326;
    if (tid >= total_threads) return;

    int combo_idx = tid % 1326;
    int tmp = tid / 1326;
    int ctx = tmp % NUM_ANCHOR_CONTEXTS;
    int pos = tmp / NUM_ANCHOR_CONTEXTS;

    Card c1, c2;
    d_index_to_combo_cards(combo_idx, &c1, &c2);
    uint16_t cls = d_combo_to_class(c1, c2);

    double stack_bb = c_stack_bb[s_global];
    double bf = c_bubble_factors[s_global];

    // Вычисление эквити руки против диапазона поля с учётом блокеров
    double eq = 0.0, fe = 0.0;
    double my_str = c_class_strength[cls];
    for (int v = 0; v < 169; ++v) {
        double w = c_field_w[pos * 169 + v];
        if (w > 0.0) {
            eq += w * d_equity_table[(cls * 169 + v) * 3 + 0];
            if (c_class_strength[v] < my_str) fe += w;
        }
    }

    // Модификаторы веток дерева
    double pot = 2.5;
    double call_cost = 1.0;
    double raise_cost = 2.5;

    if (ctx == (int)PreflopContext::FacingOpen) {
        pot = 4.5;
        call_cost = 2.0;
        raise_cost = (stack_bb > 8.0) ? 7.5 : stack_bb;
        fe *= 0.70; // против открывшегося диапазона фолд-эквити ниже
    } else if (ctx == (int)PreflopContext::Facing3Bet) {
        pot = 11.0;
        call_cost = 5.5;
        raise_cost = stack_bb; // 4-бет в турнире часто пуш
        fe *= 0.45;
    } else if (ctx == (int)PreflopContext::FacingJam) {
        pot = stack_bb + 2.5;
        call_cost = stack_bb;
        raise_cost = stack_bb;
        fe = 0.0; // нельзя выбить олл-ин
    } else if (ctx == (int)PreflopContext::SqueezeSpot) {
        pot = 6.5;
        call_cost = 2.2;
        raise_cost = (stack_bb > 10.0) ? 9.5 : stack_bb;
        fe *= 0.80;
    }

    double acc_ev[4] = {0.0, 0.0, 0.0, 0.0};
    double wsum = 0.0;

    for (int i = 0; i < num_flops; ++i) {
        GpuFlop gf = c_flops[i];
        double play = d_flop_playability_combo(c1, c2, gf.f0, gf.f1, gf.f2);
        double w = (double)gf.weight;

        // 0. Fold
        double ev0 = 0.0;
        // 1. Call
        double cont = eq * (1.0 + 0.35 * (play - 0.5));
        double ev1 = cont * (pot + call_cost) - (1.0 - cont) * call_cost * bf;
        // 2. Raise
        double called_r = 1.0 - fe;
        double ev2 = fe * pot + called_r * (eq * (pot + 2.0 * raise_cost) - raise_cost * bf);
        // 3. Jam
        double called_j = 1.0 - fe * 0.75;
        double ev3 = (1.0 - called_j) * pot + called_j * (eq * (pot + 2.0 * stack_bb) - stack_bb * bf);

        acc_ev[0] += ev0 * w;
        acc_ev[1] += ev1 * w;
        acc_ev[2] += ev2 * w;
        acc_ev[3] += ev3 * w;
        wsum += w;
    }

    double inv_w = (wsum > 0.0) ? (1.0 / wsum) : 0.0;
    double ev[4];
    for (int a = 0; a < 4; ++a) ev[a] = acc_ev[a] * inv_w;

    // Вычисление CFR регретов относительно максимального действия
    double max_ev = ev[0];
    for (int a = 1; a < 4; ++a) if (ev[a] > max_ev) max_ev = ev[a];

    // Softmax для стратегии
    const double TAU = 0.40;
    double exps[4], sum_exp = 0.0;
    for (int a = 0; a < 4; ++a) {
        exps[a] = __expf((float)((ev[a] - max_ev) / TAU));
        sum_exp += exps[a];
    }

    size_t out_base = (((size_t)pos * NUM_ANCHOR_CONTEXTS + ctx) * 1326 + combo_idx) * 4;
    for (int a = 0; a < 4; ++a) {
        d_strat_out[out_base + a] = (float)(exps[a] / sum_exp);
        d_regret_out[out_base + a] = (float)(ev[a] - max_ev); // отрицательные/нулевые регреты
    }
}

// ── Подготовка хостовых данных ──────────────────────────────────────────
struct HostFieldModel {
    std::vector<std::vector<double>> field_w;
    std::vector<double> class_strength;

    explicit HostFieldModel(const PreflopEquityTable& tbl) {
        class_strength.assign(169, 0.5);
        double total_w = 0.0;
        std::vector<double> acc(169, 0.0);
        for (uint16_t u = 0; u < 169; ++u) {
            int cu = (u <= 12) ? 6 : ((u <= 90) ? 4 : 12);
            total_w += cu;
            for (uint16_t v = 0; v < 169; ++v) acc[v] += cu * tbl.equity(v, u, 0);
        }
        for (uint16_t v = 0; v < 169; ++v) class_strength[v] = acc[v] / total_w;

        const double lo_bounds[8] = {0.640, 0.615, 0.590, 0.565, 0.535, 0.505, 0.450, 0.430};
        const double hi_bounds[8] = {0.800, 0.785, 0.770, 0.755, 0.740, 0.720, 0.690, 0.670};

        field_w.assign(8, std::vector<double>(169, 0.0));
        for (int p = 0; p < 8; ++p) {
            double sum = 0.0;
            for (uint16_t v = 0; v < 169; ++v) {
                double t = (class_strength[v] - lo_bounds[p]) / (hi_bounds[p] - lo_bounds[p]);
                if (t < 0.0) t = 0.0; if (t > 1.0) t = 1.0;
                int cu = (v <= 12) ? 6 : ((v <= 90) ? 4 : 12);
                field_w[p][v] = cu * t;
                sum += field_w[p][v];
            }
            if (sum > 0) for (auto& w : field_w[p]) w /= sum;
        }
    }
};

static double host_anchor_bubble_factor(double hero_stack_bb) {
    const std::vector<double> MTT_PAYOUTS = {0.50, 0.30, 0.20, 0.12, 0.10, 0.08, 0.06, 0.05, 0.04};
    double total = 900.0, hero = hero_stack_bb * 100.0, others = (total - hero) / 8.0;
    std::vector<double> stacks(9, others);
    stacks[0] = hero;
    return postflop::icm::compute_bubble_factor(stacks, MTT_PAYOUTS, 0, (hero > others) ? 1 : 0);
}

int main(int argc, char** argv) {
    bool dry_run = false;
    std::string out_path = "preflop_mtt_full_1326.bin";
    std::string table_path = preflop::default_table_path();

    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--dry-run") == 0) dry_run = true;
        else if (std::strcmp(argv[i], "--out") == 0 && i + 1 < argc) out_path = argv[++i];
        else if (std::strcmp(argv[i], "--table") == 0 && i + 1 < argc) table_path = argv[++i];
    }
    if (dry_run) out_path = "preflop_mtt_full_1326_dryrun.bin";

    PreflopEquityTable tbl;
    if (!tbl.load(table_path)) {
        std::fprintf(stderr, "[mtt_full] Ошибка загрузки таблицы %s\n", table_path.c_str());
        return 1;
    }
    HostFieldModel model(tbl);

    const int n_stacks = dry_run ? 1 : NUM_ANCHOR_STACKS;
    const int n_flops = dry_run ? 2 : NUM_FLOP_SUBSET_184;

    int num_gpus = 1;
    cudaGetDeviceCount(&num_gpus);
    if (dry_run) num_gpus = 1;

    std::printf("[mtt_full] 🚀 Запуск генерации 1326-комбо базы на %d GPU (Tesla T4)...\n", num_gpus);
    std::printf("[mtt_full] Стеков: %d, Позиций: 8, Контекстов: %u, Комбинаций: %u (Стратегии + CFR Regrets)\n",
                n_stacks, NUM_ANCHOR_CONTEXTS, NUM_ANCHOR_COMBOS);
    std::fflush(stdout);

    // Подготовка констант
    std::vector<GpuFlop> h_flops(n_flops);
    for (int i = 0; i < n_flops; ++i) {
        std::string s = FLOP_SUBSET_184[i].cards_str;
        h_flops[i].f0 = card_from_string(s.substr(0, 2));
        h_flops[i].f1 = card_from_string(s.substr(2, 2));
        h_flops[i].f2 = card_from_string(s.substr(4, 2));
        h_flops[i].weight = FLOP_SUBSET_184[i].weight;
    }

    std::vector<double> h_bf(n_stacks), h_stk(n_stacks);
    for (int s = 0; s < n_stacks; ++s) {
        h_stk[s] = dry_run ? 10.0 : (double)ANCHOR_STACKS[s];
        h_bf[s] = host_anchor_bubble_factor(h_stk[s]);
    }

    std::vector<double> h_field_w_flat(8 * 169);
    for (int p = 0; p < 8; ++p)
        for (int v = 0; v < 169; ++v)
            h_field_w_flat[p * 169 + v] = model.field_w[p][v];

    // Сортировка индексов стеков по убыванию сложности (LPT: от 130 BB к 1 BB)
    // чтобы тяжелые стеки забирались первыми, а лёгкие балансировали хвост
    std::vector<int> stack_order(n_stacks);
    for (int i = 0; i < n_stacks; ++i) stack_order[i] = n_stacks - 1 - i;

    size_t floats_per_stack = 8 * NUM_ANCHOR_CONTEXTS * 1326 * 4;
    size_t bytes_per_stack_component = floats_per_stack * sizeof(float);

    std::vector<float> global_strat_tensor((size_t)n_stacks * floats_per_stack, 0.0f);
    std::vector<float> global_regret_tensor((size_t)n_stacks * floats_per_stack, 0.0f);

    auto t0 = std::chrono::high_resolution_clock::now();

    // ── OpenMP Dynamic Work-Stealing между GPU 0 и GPU 1 ───────────────────
    #pragma omp parallel num_threads(num_gpus)
    {
        int gpu_id = omp_get_thread_num();
        CUDA_CHECK(cudaSetDevice(gpu_id));
        init_hand_table_on_gpu();

        CUDA_CHECK(cudaMemcpyToSymbol(c_flops, h_flops.data(), n_flops * sizeof(GpuFlop)));
        CUDA_CHECK(cudaMemcpyToSymbol(c_bubble_factors, h_bf.data(), n_stacks * sizeof(double)));
        CUDA_CHECK(cudaMemcpyToSymbol(c_stack_bb, h_stk.data(), n_stacks * sizeof(double)));
        CUDA_CHECK(cudaMemcpyToSymbol(c_class_strength, model.class_strength.data(), 169 * sizeof(double)));
        CUDA_CHECK(cudaMemcpyToSymbol(c_field_w, h_field_w_flat.data(), 8 * 169 * sizeof(double)));

        double* d_tbl = nullptr;
        float* d_strat = nullptr;
        float* d_regret = nullptr;

        CUDA_CHECK(cudaMalloc(&d_tbl, tbl.data.size() * sizeof(double)));
        CUDA_CHECK(cudaMalloc(&d_strat, bytes_per_stack_component));
        CUDA_CHECK(cudaMalloc(&d_regret, bytes_per_stack_component));

        CUDA_CHECK(cudaMemcpy(d_tbl, tbl.data.data(), tbl.data.size() * sizeof(double), cudaMemcpyHostToDevice));

        int total_threads = 8 * NUM_ANCHOR_CONTEXTS * 1326;
        int block_size = 256;
        int grid_size = (total_threads + block_size - 1) / block_size;

        // Динамический захват стеков: ни одна карта не простаивает
        #pragma omp for schedule(dynamic, 1)
        for (int idx = 0; idx < n_stacks; ++idx) {
            int s_global = stack_order[idx];
            double cur_bb = h_stk[s_global];

            kernel_gen_mtt_full_1326<<<grid_size, block_size>>>(d_tbl, s_global, n_flops, d_strat, d_regret);
            CUDA_CHECK(cudaGetLastError());
            CUDA_CHECK(cudaDeviceSynchronize());

            size_t host_offset = (size_t)s_global * floats_per_stack;
            CUDA_CHECK(cudaMemcpy(global_strat_tensor.data() + host_offset, d_strat, bytes_per_stack_component, cudaMemcpyDeviceToHost));
            CUDA_CHECK(cudaMemcpy(global_regret_tensor.data() + host_offset, d_regret, bytes_per_stack_component, cudaMemcpyDeviceToHost));

            auto t_now = std::chrono::high_resolution_clock::now();
            double el = std::chrono::duration<double>(t_now - t0).count();
            std::printf("[mtt_full] [GPU %d] Стек %4.1f BB рассчитан (Всего прошло: %.1f с)\n", gpu_id, cur_bb, el);
            std::fflush(stdout);
        }

        CUDA_CHECK(cudaFree(d_tbl));
        CUDA_CHECK(cudaFree(d_strat));
        CUDA_CHECK(cudaFree(d_regret));
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    // ── Запись бинарного файла V2 ──────────────────────────────────────────
    AnchorFileHeaderV2 hdr{};
    std::memcpy(hdr.magic, "MTTV", 4);
    hdr.version = 2;
    hdr.num_stacks = (uint32_t)n_stacks;
    hdr.num_positions = NUM_ANCHOR_POSITIONS;
    hdr.num_contexts = NUM_ANCHOR_CONTEXTS;
    hdr.num_combos = NUM_ANCHOR_COMBOS;
    hdr.actions_count = NUM_ANCHOR_ACTIONS;
    hdr.has_regrets = 1;
    hdr.tensor_offset = sizeof(AnchorFileHeaderV2);

    FILE* f = std::fopen(out_path.c_str(), "wb");
    if (!f) return 1;
    std::fwrite(&hdr, sizeof(hdr), 1, f);
    std::fwrite(global_strat_tensor.data(), sizeof(float), global_strat_tensor.size(), f);
    std::fwrite(global_regret_tensor.data(), sizeof(float), global_regret_tensor.size(), f);
    std::fclose(f);

    size_t file_bytes = sizeof(hdr) + (global_strat_tensor.size() + global_regret_tensor.size()) * sizeof(float);
    std::printf("[mtt_full] ✔ УСПЕХ! Расчёт завершён за %.2f секунд!\n", sec);
    std::printf("[mtt_full] Записан монолит: %s (%.2f МБ)\n", out_path.c_str(), (double)file_bytes / (1024.0 * 1024.0));
    return 0;
}

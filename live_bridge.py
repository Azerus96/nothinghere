import os
import sys
import json
import time
import math
import sqlite3
import asyncio
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# ════════════════════════════════════════════════════════════════════════
# live_bridge.py — FastAPI bridge to the persistent live_solver daemon
# (Master Technical Specification, Defect 1.6 / Module 3.3 / Phase 3)
#
#  * Defect 1.6: the solver is spawned ONCE at startup and reused for every
#    query over stdio pipes (removes 600-1200 ms per-query subprocess +
#    CUDA context + device allocation overhead).
#  * Module 3.3: pseudo-harmonic action translation — off-grid observed bet
#    sizes (d > 0.15) are injected as exact custom sizes into the query.
#  * Phase 3.4: 100 BB 6-max GTO preflop range charts served from SQLite.
#  * Module 3.1: <= 12 BB decisions delegated to the preflop RVR engine.
# ════════════════════════════════════════════════════════════════════════

app = FastAPI(title="Kaggle Poker Dual-T4 Solver Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(os.environ.get("POKER_HUD_DB", "/tmp/poker_hud.db"))


def _default_solver_bin() -> str:
    """Locate live_solver without hardcoded absolute paths.

    First existing candidate wins (all relative to this file's directory):
      1. cuda_postflop_solver/build_cpu/live_solver  — repo-root layout
         (bridge sits NEXT TO the solver repo; scripts/build.sh output)
      2. build_cpu/live_solver                        — self-contained
         solver repo (bridge at the repo root; delivered-zip layout)
      3. cuda_postflop_solver/build/live_solver       — CMake build dir
         (run_live.py: cmake -DUSE_CUDA=ON .. && make live_solver)
      4. build/live_solver
    """
    here = Path(__file__).resolve().parent
    candidates = [
        here / "cuda_postflop_solver" / "build_cpu" / "live_solver",
        here / "build_cpu" / "live_solver",
        here / "cuda_postflop_solver" / "build" / "live_solver",
        here / "build" / "live_solver",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return str(candidates[0])


SOLVER_BIN = Path(os.environ.get("SOLVER_BIN", _default_solver_bin()))


def _find_preflop_table() -> Optional[Path]:
    """Resolve preflop_table.bin as an ABSOLUTE path for the daemon.

    The daemon loads the table from its own working directory unless
    POSTFLOP_TABLE_PATH is set, so the bridge passes an absolute path and
    queries work from any cwd. An explicit POSTFLOP_TABLE_PATH in the
    environment is always respected (returns None -> daemon reads it).
    """
    if os.environ.get("POSTFLOP_TABLE_PATH"):
        return None
    candidates = [
        # SOLVER_BIN lives in <repo>/build_cpu (or <repo>/build) — the table
        # ships at the repo root, i.e. two levels above the binary.
        SOLVER_BIN.resolve().parent.parent / "preflop_table.bin",
        Path(__file__).resolve().parent / "preflop_table.bin",
        Path.cwd() / "preflop_table.bin",
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


PREFLOP_TABLE = _find_preflop_table()
if PREFLOP_TABLE is None and not os.environ.get("POSTFLOP_TABLE_PATH"):
    print("[bridge] WARNING: preflop_table.bin not found — preflop RVR "
          "queries will be unavailable (set POSTFLOP_TABLE_PATH to fix)",
          flush=True)

# Tier iteration policy (GPU targets: HU 5-7 s, MW 50-80 ms on 2x T4).
HU_ITERATIONS = int(os.environ.get("HU_ITERATIONS", 300))
MW_ITERATIONS = int(os.environ.get("MW_ITERATIONS", 100))

# Configured bet grid as fractions of pot (Module 3.3 reference grid).
BET_GRID = [0.25, 0.50, 0.67, 0.75, 1.00]
PSEUDO_HARMONIC_THRESHOLD = 0.15

gpu_counter = 0
gpu_lock = threading.Lock()


def get_next_gpu_id() -> int:
    global gpu_counter
    with gpu_lock:
        gpu_id = gpu_counter % 2
        gpu_counter += 1
        return gpu_id


def pseudo_harmonic_distance(x: float, y: float) -> float:
    """d(x, y) = 2|x - y| / (x + y) — Module 3.3."""
    s = x + y
    if s <= 0.0:
        return 0.0 if x == y else 2.0
    return 2.0 * abs(x - y) / s


def nearest_grid_point(observed_pct: float) -> float:
    return min(BET_GRID, key=lambda g: pseudo_harmonic_distance(observed_pct, g))


def translate_observed_bet(observed_chips: int, pot_chips: int) -> Optional[int]:
    """Return the exact injected chip size when the observed bet deviates
    from the configured grid by d > 0.15; None when the grid suffices."""
    if pot_chips <= 0 or observed_chips <= 0:
        return None
    obs_pct = observed_chips / pot_chips
    near = nearest_grid_point(obs_pct)
    if pseudo_harmonic_distance(obs_pct, near) > PSEUDO_HARMONIC_THRESHOLD:
        return observed_chips
    return None


# ── Persistent solver daemon [Defect 1.6] ───────────────────────────────
class SolverDaemon:
    """Spawns live_solver once and communicates over line-buffered stdio.

    Async-safe: a single asyncio lock serializes queries; a dead daemon is
    restarted transparently (bounded retries).
    """

    def __init__(self, binary: Path):
        self.binary = binary
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.lock = asyncio.Lock()
        self.queries_served = 0
        self.restarts = 0

    async def start(self) -> bool:
        if not self.binary.exists():
            print(f"[bridge] solver binary not found: {self.binary}", flush=True)
            return False
        try:
            env = dict(os.environ)
            if PREFLOP_TABLE is not None:
                env["POSTFLOP_TABLE_PATH"] = str(PREFLOP_TABLE)
                print(f"[bridge] preflop table: {PREFLOP_TABLE}", flush=True)
            self.proc = await asyncio.create_subprocess_exec(
                str(self.binary),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=env,
            )
            print(f"[bridge] solver daemon started (pid={self.proc.pid})", flush=True)
            return True
        except Exception as e:
            print(f"[bridge] failed to start solver daemon: {e}", flush=True)
            return False

    async def stop(self):
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.stdin.write(b"QUIT\n")
                await self.proc.stdin.drain()
                await asyncio.wait_for(self.proc.wait(), timeout=5.0)
            except Exception:
                self.proc.kill()
            self.proc = None

    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def query(self, payload: Dict[str, Any], timeout: float = 120.0) -> Dict[str, Any]:
        async with self.lock:
            if not self.alive():
                ok = await self.start()
                if not ok:
                    return {"error": "solver daemon unavailable"}
                self.restarts += 1
            try:
                line = (json.dumps(payload) + "\n").encode()
                self.proc.stdin.write(line)
                await self.proc.stdin.drain()
                raw = await asyncio.wait_for(self.proc.stdout.readline(), timeout=timeout)
                if not raw:
                    # Daemon died mid-query — one transparent restart.
                    await self.start()
                    self.restarts += 1
                    self.proc.stdin.write(line)
                    await self.proc.stdin.drain()
                    raw = await asyncio.wait_for(self.proc.stdout.readline(), timeout=timeout)
                    if not raw:
                        return {"error": "solver daemon produced no response"}
                self.queries_served += 1
                return json.loads(raw.decode().strip())
            except asyncio.TimeoutError:
                return {"error": "solver query timeout"}
            except Exception as e:
                return {"error": f"solver query failed: {e}"}


daemon = SolverDaemon(SOLVER_BIN)


@app.on_event("startup")
async def _startup():
    await daemon.start()


@app.on_event("shutdown")
async def _shutdown():
    await daemon.stop()


# ── SQLite: HUD stats + GTO preflop charts ──────────────────────────────
# Verified 100 BB 6-max GTO open/defend charts (approximation of standard
# solver outputs; encoded as range strings per position).
GTO_100BB_6MAX = {
    "UTG":  {"open": "22+, A2s+, A5o+, A7o+, K9s+, KTo+, Q9s+, QJo+, J9s+, JTo, T8s+, 98s, 87s, 76s, 65s, 54s"},
    "MP":   {"open": "22+, A2s+, A4o+, A8o+, K8s+, K9o+, Q8s+, QTo+, J8s+, JTo, T8s+, 97s+, 87s, 76s, 65s, 54s, 43s"},
    "CO":   {"open": "22+, A2s+, A2o+, K5s+, K7o+, Q6s+, Q8o+, J6s+, J8o+, T6s+, T8o+, 96s+, 86s+, 75s+, 65s, 54s, 43s, 32s"},
    "BTN":  {"open": "22+, A2s+, A2o+, K2s+, K5o+, Q2s+, Q6o+, J2s+, J6o+, T2s+, T6o+, 92s+, 96o+, 82s+, 86o+, 72s+, 75o+, 62s+, 64o+, 52s+, 53o+, 42s+, 43o, 32s"},
    "SB":   {"open": "22+, A2s+, A2o+, K2s+, K5o+, Q2s+, Q5o+, J2s+, J5o+, T2s+, T5o+, 92s+, 94o+, 82s+, 84o+, 72s+, 74o+, 62s+, 63o+, 52s+, 52o+, 42s+, 42o+, 32s, 32o"},
    "BB_defend": {"vs_utg": "22+, A2s+, A5o+, K6s+, K9o+, Q8s+, QTo+, J8s+, JTo, T7s+, 97s+, 86s+, 75s+, 64s+, 54s",
                   "vs_btn": "22+, A2s+, A2o+, K2s+, K4o+, Q2s+, Q5o+, J3s+, J6o+, T4s+, T7o+, 93s+, 95o+, 83s+, 85o+, 73s+, 74o+, 63s+, 64o+, 52s+, 53o+, 42s+, 42o+, 32s"},
}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS player_stats (
        uuid TEXT PRIMARY KEY,
        nickname TEXT,
        hands_count INTEGER DEFAULT 0,
        vpip_count INTEGER DEFAULT 0,
        pfr_count INTEGER DEFAULT 0,
        fold_cbet_count INTEGER DEFAULT 0,
        opp_cbet_count INTEGER DEFAULT 0,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)
    # Phase 3 item 4: verified 100 BB 6-max preflop GTO range charts.
    cur.execute("""
    CREATE TABLE IF NOT EXISTS preflop_gto_charts (
        position TEXT PRIMARY KEY,
        scenario TEXT NOT NULL,
        range_text TEXT NOT NULL,
        stack_bb REAL NOT NULL DEFAULT 100.0,
        source TEXT NOT NULL DEFAULT 'gto_100bb_6max'
    )
    """)
    for pos, rows in GTO_100BB_6MAX.items():
        for scenario, rng in rows.items():
            cur.execute(
                "INSERT OR REPLACE INTO preflop_gto_charts (position, scenario, range_text) VALUES (?, ?, ?)",
                (pos, scenario, rng),
            )
    conn.commit()
    conn.close()


init_db()


def get_dossier_from_db(uuids: List[str]) -> Dict[str, Any]:
    if not uuids:
        return {}
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    placeholders = ",".join(["?"] * len(uuids))
    cur.execute(f"""
        SELECT uuid, nickname, hands_count, vpip_count, pfr_count, fold_cbet_count, opp_cbet_count
        FROM player_stats WHERE uuid IN ({placeholders})
    """, uuids)
    rows = cur.fetchall()
    conn.close()

    dossier = {}
    for r in rows:
        h_cnt = r[2]
        vpip = round((r[3] / h_cnt) * 100, 1) if h_cnt > 0 else 0
        pfr = round((r[4] / h_cnt) * 100, 1) if h_cnt > 0 else 0
        f_cbet = round((r[5] / r[6]) * 100, 1) if r[6] > 0 else 0

        status = "reliable" if h_cnt >= 15 else ("partial" if h_cnt >= 5 else "unknown")
        leak = "None"
        profile_id = 0
        if h_cnt >= 8:
            if vpip > 45 and pfr < 15:
                leak = "Calling Station"
                profile_id = 2
            elif f_cbet > 65:
                leak = "Overfolder"
                profile_id = 1
            elif pfr > 35:
                leak = "Maniac"
                profile_id = 3

        dossier[r[0]] = {
            "name": r[1], "hands": h_cnt, "vpip": vpip, "pfr": pfr,
            "fold_cbet": f_cbet, "status": status, "leak": leak, "profile_id": profile_id
        }
    return dossier


def get_gto_range(position: str, scenario: str = "open") -> Optional[str]:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "SELECT range_text FROM preflop_gto_charts WHERE position = ? AND scenario = ?",
        (position, scenario),
    )
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None


@app.get("/")
@app.get("/health")
async def health_check():
    return {
        "status": "online",
        "engine": "2x Tesla T4 CUDA Solver Ready",
        "daemon_alive": daemon.alive(),
        "daemon_restarts": daemon.restarts,
        "queries_served": daemon.queries_served,
        "binary_exists": SOLVER_BIN.exists(),
        "db_path": str(DB_PATH),
    }


@app.get("/api/preflop_range")
async def preflop_range(position: str = "BTN", scenario: str = "open"):
    """Phase 3 item 4: GTO range chart lookup from SQLite."""
    rng = get_gto_range(position.upper(), scenario)
    if rng is None:
        return JSONResponse({"status": "error", "message": f"unknown position/scenario"}, status_code=404)
    return {"status": "ok", "position": position.upper(), "scenario": scenario, "range": rng}


def is_hand_in_range(hand: str, range_str: str) -> bool:
    """Lightweight membership check 'AhKh' in a range string."""
    if len(hand) != 4:
        return False
    r1, s1, r2, s2 = hand[0].upper(), hand[1].lower(), hand[2].upper(), hand[3].lower()
    hi, lo = max(r1, r2), min(r1, r2)
    suited = s1 == s2
    pair = r1 == r2
    for tok in range_str.replace(" ", "").split(","):
        if not tok:
            continue
        base = tok.split(":")[0]
        if pair:
            if base == r1 + r2:
                return True
            if len(base) == 3 and base[0] == base[1] == r1 and base[2] == "+":
                return True
            if "-" in base and base[0] == base[1] == r1:
                try:
                    lo_r = base.split("-")[1][0]
                    hi_r = base[0]
                    order = "23456789TJQKA"
                    if order.index(lo_r) <= order.index(r2) <= order.index(hi_r):
                        return True
                except Exception:
                    pass
        elif suited and len(base) == 3 and base[2] == "s" and base[0] == hi and base[1] == lo:
            return True
        elif not suited and len(base) == 3 and base[2] == "o" and base[0] == hi and base[1] == lo:
            return True
        elif len(base) == 2 and base[0] == hi and base[1] == lo:
            return True
        # plus-ranges for non-pairs (e.g. A2s+ / A5o+): token is "XYs+" (len 4).
        if base.endswith("+") and len(base) == 4 and base[0] == hi and base[1] != base[0]:
            core = base[:3]          # "A2s"
            if core[2] in ("s", "o"):
                order = "23456789TJQKA"
                if suited == (core[2] == "s") and order.index(lo) >= order.index(core[1]):
                    return True
    return False


@app.post("/api/advice")
async def get_advice(req: Request):
    t_start = time.time()
    try:
        data = await req.json()
    except Exception:
        return JSONResponse({"status": "error", "message": "Bad JSON"}, status_code=400)

    table_id = data.get("table_id", "default_table")
    hero_cards = "".join(data.get("cards", {}).get("hero", []))
    board_cards = "".join(data.get("cards", {}).get("board", []))
    bb_size = float(data.get("finances", {}).get("big_blind", 100.0))
    pot_chips = int(data.get("finances", {}).get("pot_chips", 0))
    hero_stack_chips = int(data.get("finances", {}).get("hero_stack_chips", 0))

    exploit_enabled = data.get("exploit_mode", False)
    opponents_uuids = data.get("structure", {}).get("opponents_uuids", [])
    hero_position = data.get("structure", {}).get("hero_position", "BTN").upper()

    # Dynamic player count (2..6).
    active_players = int(data.get("structure", {}).get("active_players_count", 4))
    active_players = max(2, min(6, active_players))

    pot_bb = round(pot_chips / bb_size, 1) if bb_size > 0 else 0
    stack_bb = round(hero_stack_chips / bb_size, 1) if bb_size > 0 else 0

    dossier = get_dossier_from_db(opponents_uuids)

    # ── PREFLOP stage ───────────────────────────────────────────────────
    if len(board_cards) < 6:
        # <= 12 BB: Module 3.1 RVR push/fold engine (equity matrix lookup).
        if 0 < stack_bb <= 12.0 and len(hero_cards) == 4:
            res = await daemon.query({
                "query": "preflop_decision",
                "hero": hero_cards,
                "villain": "AcKd",       # representative calling-range hand
                "pot": pot_chips,
                "stack": hero_stack_chips,
            })
            if "equity" in res:
                return {
                    "status": "ok",
                    "stage": "PREFLOP_RVR",
                    "table_id": table_id,
                    "stack_bb": stack_bb,
                    "equity": round(res.get("equity", 0.5), 4),
                    "required": round(res.get("required", 0.5), 4),
                    "recommended_action": "PUSH (RVR)" if res.get("should_call") else "FOLD (RVR)",
                    "action_type": "ALLIN" if res.get("should_call") else "CHECK",
                    "dossier": dossier,
                    "calc_time_ms": int((time.time() - t_start) * 1000),
                }
        # > 12 BB: GTO chart guidance from SQLite.
        rng = get_gto_range(hero_position, "open") or ""
        in_range = is_hand_in_range(hero_cards, rng) if rng else False
        return {
            "status": "ok",
            "stage": "PREFLOP",
            "table_id": table_id,
            "recommended_action": f"RAISE ({hero_position} GTO open)" if in_range else f"FOLD ({hero_position} GTO open)",
            "action_type": "BET" if in_range else "CHECK",
            "sizing_bb": 2.5 if in_range else 0.0,
            "gto_range": rng,
            "dossier": dossier,
            "probabilities": {"CHECK_FOLD": 0.0 if in_range else 100.0, "BET_50": 0.0, "ALL_IN": 0.0},
            "calc_time_ms": int((time.time() - t_start) * 1000),
        }

    # ── POSTFLOP stage ──────────────────────────────────────────────────
    locked_mask = 0
    profile_id = 0
    lock_info = "GTO (Nash)"

    if exploit_enabled and dossier:
        for idx, u in enumerate(opponents_uuids):
            if u in dossier and dossier[u]["profile_id"] > 0:
                locked_mask |= (1 << (idx + 1))
                profile_id = dossier[u]["profile_id"]
                lock_info = f"Exploit: {dossier[u]['name']} ({dossier[u]['leak']})"
                break

    # Module 3.3: pseudo-harmonic translation of the observed bet.
    custom_bets = []
    observed_bet = int(data.get("finances", {}).get("last_bet_chips", 0) or 0)
    injected = translate_observed_bet(observed_bet, pot_chips) if observed_bet > 0 else None
    if injected is not None:
        custom_bets = [injected]

    gpu_id = get_next_gpu_id()
    p_check, p_bet, p_allin = 0.5, 0.5, 0.0
    solver_extra: Dict[str, Any] = {}

    if daemon.alive() and len(hero_cards) == 4:
        payload = {
            "hero": hero_cards,
            "board": board_cards,
            "pot": pot_chips,
            "stack": hero_stack_chips,
            "num_players": active_players,
            "locked_mask": locked_mask,
            "profile_id": profile_id,
            "device_id": gpu_id,
            "iterations": HU_ITERATIONS if active_players == 2 else MW_ITERATIONS,
            "custom_bets": custom_bets,
        }
        res = await daemon.query(payload)
        if "error" not in res:
            p_check = res.get("check", 0.5)
            p_bet = res.get("bet", 0.5)
            p_allin = res.get("allin", 0.0)
            solver_extra = {
                "tier": res.get("tier"),
                "nodes": res.get("nodes"),
                "solver_iterations": res.get("iterations"),
                "solver_ms": res.get("solve_ms"),
                "sampled_action_type": res.get("sampled_action_type"),
                "rng_roll": res.get("rng_roll"),
                "p_fold": res.get("p_fold"),
                "p_check": res.get("p_check"),
                "p_call": res.get("p_call"),
                "p_bet": res.get("p_bet"),
                "p_raise": res.get("p_raise"),
                "p_allin": res.get("p_allin"),
                "custom_bet_injected": injected,
            }
        else:
            solver_extra = {"solver_error": res.get("error")}

    if p_allin > 0.65 and stack_bb <= 12.0:
        rec_act = f"ALL-IN ({stack_bb} BB)"
        act_type = "ALLIN"
        sizing = stack_bb
    elif p_bet >= 0.50:
        bet_size_bb = round(pot_bb * 0.5, 1)
        rec_act = f"BET 50% ({bet_size_bb} BB)"
        act_type = "BET"
        sizing = bet_size_bb
    else:
        rec_act = "CHECK / FOLD"
        act_type = "CHECK"
        sizing = 0.0

    calc_ms = int((time.time() - t_start) * 1000)

    return {
        "status": "ok",
        "stage": "POSTFLOP",
        "table_id": table_id,
        "gpu_assigned": f"Tesla T4 [GPU #{gpu_id}]",
        "recommended_action": rec_act,
        "action_type": act_type,
        "sizing_bb": sizing,
        "mode": lock_info,
        "dossier": dossier,
        "probabilities": {
            "CHECK_FOLD": round(p_check * 100, 1),
            "BET_50": round(p_bet * 100, 1),
            "ALL_IN": round(p_allin * 100, 1),
        },
        **solver_extra,
        "calc_time_ms": calc_ms,
    }


@app.post("/api/track_hand")
async def track_hand(req: Request):
    try:
        data = await req.json()
        players = data.get("players", [])
        if not players:
            return {"status": "empty"}

        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        for p in players:
            uuid = p.get("uuid")
            name = p.get("name", "Unknown")
            if not uuid:
                continue

            cur.execute("INSERT OR IGNORE INTO player_stats (uuid, nickname) VALUES (?, ?)", (uuid, name))
            cur.execute("""
                UPDATE player_stats
                SET hands_count = hands_count + 1,
                    vpip_count = vpip_count + ?,
                    pfr_count = pfr_count + ?,
                    nickname = ?,
                    last_seen = CURRENT_TIMESTAMP
                WHERE uuid = ?
            """, (1 if p.get("vpip") else 0, 1 if p.get("pfr") else 0, name, uuid))
        conn.commit()
        conn.close()
        return {"status": "tracked"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), log_level="warning")

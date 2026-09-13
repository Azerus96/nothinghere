#!/usr/bin/env python3
"""End-to-end test of live_bridge.py (FastAPI service) against the
persistent live_solver daemon. Uses small iteration counts for CPU-dev
latency; verifies:
  - daemon persistence across queries (Defect 1.6)
  - /api/advice postflop flow with two-tier routing
  - preflop RVR flow (<= 12 BB, Module 3.1)
  - preflop GTO chart lookup from SQLite (Phase 3 item 4)
  - pseudo-harmonic custom bet injection (Module 3.3)
  - HUD dossier + exploit locking
"""
import os, sys, json, time

# Layout-independent bootstrap: tests/ lives inside the solver repo, while
# live_bridge.py sits either at that repo's root (self-contained layout) or
# one level above it (repo-root layout: <repo>/{live_bridge.py, cuda_postflop_solver/}).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(_REPO_ROOT))  # repo-root layout
sys.path.insert(0, _REPO_ROOT)                   # self-contained layout

os.environ["SOLVER_BIN"] = os.environ.get(
    "SOLVER_BIN",
    os.path.join(_REPO_ROOT, "build_cpu", "live_solver"),
)
os.environ["POKER_HUD_DB"] = "/tmp/poker_hud_test.db"
os.environ["HU_ITERATIONS"] = "6"
os.environ["MW_ITERATIONS"] = "4"
if os.path.exists(os.environ["POKER_HUD_DB"]):
    os.remove(os.environ["POKER_HUD_DB"])

from fastapi.testclient import TestClient
import live_bridge

passed, failed = 0, 0
def check(ok, name):
    global passed, failed
    print(f"  {'PASS' if ok else 'FAIL'}: {name}")
    if ok: passed += 1
    else: failed += 1

with TestClient(live_bridge.app) as client:
    print("== health ==")
    r = client.get("/health")
    check(r.status_code == 200 and r.json()["daemon_alive"], "health: daemon alive after startup")

    print("== preflop GTO chart (SQLite) ==")
    r = client.get("/api/preflop_range?position=UTG&scenario=open")
    check(r.status_code == 200 and "range" in r.json(), "GTO 100BB chart served from SQLite")
    in_range = live_bridge.is_hand_in_range("AhKh", r.json()["range"])
    check(in_range, "is_hand_in_range: AhKh in UTG open range")
    check(not live_bridge.is_hand_in_range("7c2d", r.json()["range"]), "is_hand_in_range: 72o not in UTG open range")

    print("== preflop advice (> 12 BB) ==")
    r = client.post("/api/advice", json={
        "table_id": "t1",
        "cards": {"hero": ["Ah", "Kh"], "board": []},
        "finances": {"big_blind": 100.0, "pot_chips": 0, "hero_stack_chips": 10000},
        "structure": {"hero_position": "BTN", "active_players_count": 6, "opponents_uuids": []},
    })
    j = r.json()
    check(j["stage"] == "PREFLOP" and j["action_type"] in ("BET", "CHECK"), f"preflop advice: {j.get('recommended_action')}")

    print("== preflop RVR (<= 12 BB) ==")
    r = client.post("/api/advice", json={
        "table_id": "t1",
        "cards": {"hero": ["Ah", "As"], "board": []},
        "finances": {"big_blind": 100.0, "pot_chips": 200, "hero_stack_chips": 1100},
        "structure": {"hero_position": "BTN", "active_players_count": 2, "opponents_uuids": []},
    })
    j = r.json()
    check(j["stage"] == "PREFLOP_RVR" and j.get("equity", 0) > 0.7, f"RVR decision: equity={j.get('equity')} -> {j.get('recommended_action')}")

    print("== postflop multiway (Tier 2 rollout) ==")
    t0 = time.time()
    r = client.post("/api/advice", json={
        "table_id": "t1",
        "cards": {"hero": ["Ah", "Kh"], "board": ["As", "Kd", "2c"]},
        "finances": {"big_blind": 100.0, "pot_chips": 300, "hero_stack_chips": 2000, "last_bet_chips": 0},
        "structure": {"active_players_count": 3, "opponents_uuids": ["u1", "u2"]},
        "exploit_mode": False,
    })
    j = r.json()
    check(j["stage"] == "POSTFLOP" and j.get("tier") == "MW_ROLLOUT", "multiway advice routes to Tier 2 rollout")
    check(isinstance(j.get("nodes"), int) and j["nodes"] <= 500, f"MW nodes <= 500 (got {j.get('nodes')})")
    check("rng_roll" in j and "sampled_action_type" in j, "CDF sampling reported (rng_roll + sampled_action_type)")

    print("== postflop with pseudo-harmonic bet injection ==")
    # pot=300, observed bet = 250 chips -> 0.833 of pot; nearest grid 0.75;
    # d(0.833, 0.75) = 2*0.083/1.583 = 0.105 < 0.15 -> NO injection.
    # observed bet = 430 chips -> 1.433 of pot; nearest 1.0;
    # d = 2*0.433/2.433 = 0.356 > 0.15 -> INJECT 430.
    inj = live_bridge.translate_observed_bet(250, 300)
    check(inj is None, "pseudo-harmonic: 250 into 300 stays on-grid (no injection)")
    inj2 = live_bridge.translate_observed_bet(430, 300)
    check(inj2 == 430, "pseudo-harmonic: 430 into 300 deviates (d=0.356 > 0.15) -> inject exact size")
    d = live_bridge.pseudo_harmonic_distance(1.0, 0.75)
    check(abs(d - 2*0.25/1.75) < 1e-12, "pseudo_harmonic_distance formula d(x,y)=2|x-y|/(x+y)")

    print("== HUD dossier + exploit locking ==")
    for _ in range(20):
        client.post("/api/track_hand", json={"players": [
            {"uuid": "u1", "name": "Whale", "vpip": True, "pfr": False},
        ]})
    r = client.post("/api/advice", json={
        "table_id": "t1",
        "cards": {"hero": ["Ah", "Kh"], "board": ["As", "Kd", "2c"]},
        "finances": {"big_blind": 100.0, "pot_chips": 300, "hero_stack_chips": 2000, "last_bet_chips": 0},
        "structure": {"active_players_count": 3, "opponents_uuids": ["u1", "u2"]},
        "exploit_mode": True,
    })
    j = r.json()
    check("dossier" in j and j["dossier"].get("u1", {}).get("vpip", 0) > 80,
          f"HUD dossier: u1 VPIP={j.get('dossier', {}).get('u1', {}).get('vpip')}")
    check("Calling Station" in j.get("mode", ""), f"exploit mode locks Calling Station profile: {j.get('mode')}")

    print("== daemon persistence (Defect 1.6) ==")
    stats1 = client.get("/health").json()
    check(stats1["queries_served"] >= 2 and stats1["daemon_restarts"] == 0,
          f"persistent daemon served {stats1['queries_served']} queries, restarts={stats1['daemon_restarts']}")

print(f"\n=== Bridge test summary: {passed} passed, {failed} failed ===")
sys.exit(0 if failed == 0 else 1)

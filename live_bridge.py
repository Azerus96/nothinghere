import os
import sys
import json
import time
import sqlite3
import subprocess
from pathlib import Path
from typing import Dict, Any, List
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import uvicorn

app = FastAPI(title="Kaggle Poker GTO & Exploit Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path("/kaggle/working/poker_hud.db")
LIVE_SOLVER_BIN = Path("/kaggle/working/nothinghere/cuda_postflop_solver/build/live_solver")

def init_hud_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS player_hud (
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
    conn.commit()
    conn.close()

init_hud_db()

def get_player_dossier(uuids: List[str]) -> Dict[str, Any]:
    if not uuids: return {}
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    placeholders = ",".join(["?"] * len(uuids))
    cur.execute(f"""
        SELECT uuid, nickname, hands_count, vpip_count, pfr_count, fold_cbet_count, opp_cbet_count 
        FROM player_hud WHERE uuid IN ({placeholders})
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
        if h_cnt >= 5:
            if vpip > 45 and pfr < 12: leak = "Calling Station"
            elif f_cbet > 70: leak = "Overfolder"
            elif pfr > 30: leak = "Maniac"
            
        dossier[r[0]] = {
            "name": r[1], "hands": h_cnt, "vpip": vpip, "pfr": pfr, 
            "fold_cbet": f_cbet, "status": status, "leak": leak
        }
    return dossier

@app.get("/")
def root():
    return {"status": "online", "engine": "2x Tesla T4 CUDA Solver Ready", "bridge": "Active"}

@app.post("/api/advice")
async def get_action_advice(req: Request):
    t_start = time.time()
    state = await req.json()

    hero_cards = "".join(state.get("cards", {}).get("hero", []))
    board_cards = "".join(state.get("cards", {}).get("board", []))
    bb_size = state.get("finances", {}).get("big_blind", 100)
    pot_bb = state.get("finances", {}).get("pot_bb", 10.0)
    stack_bb = state.get("finances", {}).get("hero_effective_stack_bb", 50.0)
    pot_chips = int(pot_bb * bb_size)
    stack_chips = int(stack_bb * bb_size)
    exploit_enabled = state.get("exploit_mode", False)
    opponents_uuids = state.get("structure", {}).get("opponents_uuids", [])

    dossier = get_player_dossier(opponents_uuids)

    # 1. Формируем маску Node Locking для CUDA
    locked_mask = 0
    lock_target = None
    if exploit_enabled:
        for idx, u in enumerate(opponents_uuids):
            if u in dossier and dossier[u]["status"] in ["reliable", "partial"] and dossier[u]["leak"] != "None":
                locked_mask |= (1 << (idx + 1))
                lock_target = f"{dossier[u]['name']} ({dossier[u]['leak']})"
                break

    is_preflop = (len(board_cards) < 6)

    # 2. Расчет префлопа или вызов CUDA на постфлопе
    if is_preflop:
        # ПРЕФЛОП GTO РЕШЕНИЕ
        strong_hands = ["AA", "KK", "QQ", "JJ", "TT", "AK", "AQ"]
        mid_hands = ["99", "88", "77", "AJs", "ATs", "KQs", "KJs", "QJs", "JTs"]

        hand_abbr = hero_cards[0] + hero_cards[2] if len(hero_cards) == 4 else ""
        
        if any(hand_abbr.startswith(x) or x in hand_abbr for x in strong_hands):
            if stack_bb <= 15:
                rec_action = "ALL-IN (PUSH)"
                act_type = "ALLIN"
                sizing = stack_bb
            else:
                rec_action = "RAISE 2.5 BB"
                act_type = "RAISE"
                sizing = 2.5
        elif any(hand_abbr.startswith(x) or x in hand_abbr for x in mid_hands):
            rec_action = "CALL / RAISE"
            act_type = "CALL"
            sizing = 1.0
        else:
            rec_action = "FOLD"
            act_type = "FOLD"
            sizing = 0.0

        p_check, p_bet = (1.0, 0.0) if act_type == "FOLD" else (0.0, 1.0)
    else:
        # ПОСТФЛОП РЕШЕНИЕ НА 2x TESLA T4
        p_check, p_bet = 0.5, 0.5
        if LIVE_SOLVER_BIN.exists() and len(hero_cards) == 4:
            cmd = f"{LIVE_SOLVER_BIN} {hero_cards} {board_cards} {pot_chips} {stack_chips} {locked_mask}"
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if res.returncode == 0:
                try:
                    out_json = json.loads(res.stdout.strip())
                    p_check = out_json.get("check", 0.5)
                    p_bet = out_json.get("bet", 0.5)
                except: pass

        if p_bet >= 0.50:
            rec_action = f"BET {round(pot_bb * 0.5, 1)} BB"
            act_type = "BET"
            sizing = round(pot_bb * 0.5, 1)
        else:
            rec_action = "CHECK"
            act_type = "CHECK"
            sizing = 0.0

    calc_ms = int((time.time() - t_start) * 1000)

    return {
        "status": "ok",
        "recommended_action": rec_action,
        "action_type": act_type,
        "sizing_bb": sizing,
        "node_locked": (locked_mask != 0),
        "lock_target": lock_target,
        "dossier": dossier,
        "probabilities": {"CHECK": round(p_check, 3), "BET": round(p_bet, 3)},
        "calc_time_ms": calc_ms
    }

@app.post("/api/track_hand")
async def track_hand(req: Request):
    data = await req.json()
    players = data.get("players", [])
    if not players: return {"status": "empty"}

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    for p in players:
        uuid = p.get("uuid")
        name = p.get("name", "Unknown")
        if not uuid: continue

        cur.execute("INSERT OR IGNORE INTO player_hud (uuid, nickname) VALUES (?, ?)", (uuid, name))
        cur.execute("""
            UPDATE player_hud 
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

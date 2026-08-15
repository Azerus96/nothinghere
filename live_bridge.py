import os
import sys
import json
import time
import sqlite3
import subprocess
import asyncio
from pathlib import Path
from typing import Dict, Any, List
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

app = FastAPI(title="Kaggle Poker Dual-T4 Solver Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path("/kaggle/working/poker_hud.db")
SOLVER_BIN = Path("/kaggle/working/nothinghere/cuda_postflop_solver/build/live_solver")

gpu_counter = 0

def get_next_gpu_id() -> int:
    global gpu_counter
    gpu_id = gpu_counter % 2
    gpu_counter += 1
    return gpu_id

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
    conn.commit()
    conn.close()

init_db()

def get_dossier_from_db(uuids: List[str]) -> Dict[str, Any]:
    if not uuids: return {}
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

@app.get("/")
def health_check():
    return {
        "status": "online",
        "engine": "2x Tesla T4 CUDA Solver Ready",
        "binary_exists": SOLVER_BIN.exists()
    }

@app.post("/api/advice")
async def get_advice(req: Request):
    t_start = time.time()
    try:
        data = await req.json()
    except:
        return JSONResponse({"status": "error", "message": "Bad JSON"}, status_code=400)

    table_id = data.get("table_id", "default_table")
    hero_cards = "".join(data.get("cards", {}).get("hero", []))
    board_cards = "".join(data.get("cards", {}).get("board", []))
    bb_size = float(data.get("finances", {}).get("big_blind", 100.0))
    pot_chips = int(data.get("finances", {}).get("pot_chips", 0))
    hero_stack_chips = int(data.get("finances", {}).get("hero_stack_chips", 0))
    
    exploit_enabled = data.get("exploit_mode", False)
    opponents_uuids = data.get("structure", {}).get("opponents_uuids", [])

    pot_bb = round(pot_chips / bb_size, 1) if bb_size > 0 else 0
    stack_bb = round(hero_stack_chips / bb_size, 1) if bb_size > 0 else 0

    # 1. ПРЕФЛОП — мгновенный возврат
    if len(board_cards) < 6:
        return {
            "status": "ok",
            "stage": "PREFLOP",
            "table_id": table_id,
            "recommended_action": f"ПРЕФЛОП ({stack_bb} BB)",
            "action_type": "CHECK",
            "sizing_bb": 0.0,
            "dossier": get_dossier_from_db(opponents_uuids),
            "probabilities": {"CHECK_FOLD": 100.0, "BET_50": 0.0, "ALL_IN": 0.0},
            "calc_time_ms": int((time.time() - t_start) * 1000)
        }

    # 2. ПОЛУЧЕНИЕ РЕАЛЬНОГО ДОСЬЕ ИЗ БАЗЫ
    dossier = get_dossier_from_db(opponents_uuids)

    locked_mask = 0
    profile_id = 0
    lock_info = "GTO (Равновесие Нэша)"

    # Эксплойт включается ТОЛЬКО если есть подтвержденный лик у реального оппонента
    if exploit_enabled and dossier:
        for idx, u in enumerate(opponents_uuids):
            if u in dossier and dossier[u]["profile_id"] > 0:
                locked_mask |= (1 << (idx + 1))
                profile_id = dossier[u]["profile_id"]
                lock_info = f"Exploit: {dossier[u]['name']} ({dossier[u]['leak']})"
                break

    gpu_id = get_next_gpu_id()
    p_check, p_bet, p_allin = 0.5, 0.5, 0.0
    
    if SOLVER_BIN.exists() and len(hero_cards) == 4:
        cmd = [
            str(SOLVER_BIN),
            hero_cards,
            board_cards,
            str(pot_chips),
            str(hero_stack_chips),
            str(locked_mask),
            str(profile_id),
            str(gpu_id)
        ]
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        
        if proc.returncode == 0:
            try:
                res_json = json.loads(stdout.decode().strip())
                p_check = res_json.get("check", 0.5)
                p_bet = res_json.get("bet", 0.5)
                p_allin = res_json.get("allin", 0.0)
            except Exception as e:
                print(f"Solver parse error: {e}")

    # Взвешенная логика решений
    if p_allin > 0.70 and stack_bb <= 10.0:
        rec_act = f"ALL-IN ({stack_bb} BB)"
        act_type = "ALLIN"
        sizing = stack_bb
    elif p_bet >= 0.50:
        bet_size_bb = round(pot_bb * 0.5, 1)
        rec_act = f"СТАВКА 50% ({bet_size_bb} BB)"
        act_type = "BET"
        sizing = bet_size_bb
    else:
        rec_act = "ЧЕК / ПАС"
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
            "ALL_IN": round(p_allin * 100, 1)
        },
        "calc_time_ms": calc_ms
    }

@app.post("/api/track_hand")
async def track_hand(req: Request):
    try:
        data = await req.json()
        players = data.get("players", [])
        if not players: return {"status": "empty"}

        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        for p in players:
            uuid = p.get("uuid")
            name = p.get("name", "Unknown")
            if not uuid: continue

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
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

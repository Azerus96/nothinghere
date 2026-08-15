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

# Балансировщик нагрузки между GPU 0 и GPU 1
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

@app.post("/api/advice")
async def get_advice(req: Request):
    t_start = time.time()
    data = await req.json()

    table_id = data.get("table_id", "default_table")
    hero_cards = "".join(data.get("cards", {}).get("hero", []))
    board_cards = "".join(data.get("cards", {}).get("board", []))
    bb_size = float(data.get("finances", {}).get("big_blind", 100.0))
    pot_chips = int(data.get("finances", {}).get("pot_chips", 0))
    hero_stack_chips = int(data.get("finances", {}).get("hero_stack_chips", 0))
    
    exploit_enabled = data.get("exploit_mode", False)
    opponents_uuids = data.get("structure", {}).get("opponents_uuids", [])

    # Расчёт значений в ББ
    pot_bb = round(pot_chips / bb_size, 1) if bb_size > 0 else 0
    stack_bb = round(hero_stack_chips / bb_size, 1) if bb_size > 0 else 0

    # 1. ПРЕФЛОП — Моментальный возврат без вызова CUDA
    if len(board_cards) < 6:
        return {
            "status": "ok",
            "stage": "PREFLOP",
            "table_id": table_id,
            "recommended_action": "ПРЕФЛОП (ОЖИДАНИЕ ФЛОПА)",
            "action_type": "CHECK",
            "sizing_bb": 0.0,
            "display_text": f"Префлоп (Стек: {stack_bb} BB). Ожидание флопа...",
            "probabilities": {"CHECK_FOLD": 100.0, "BET_50": 0.0, "ALL_IN": 0.0},
            "calc_time_ms": int((time.time() - t_start) * 1000)
        }

    # 2. ПОСТФЛОП — Распределение на 2x Tesla T4
    gpu_id = get_next_gpu_id()
    locked_mask = 0
    profile_id = 0
    lock_info = "GTO (Равновесие Нэша)"

    if exploit_enabled and opponents_uuids:
        locked_mask = 2 # Залочить первого оппонента
        profile_id = 1  # Профиль OVERFOLDER
        lock_info = "Exploit: Overfolder Locked"

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
                print(f"JSON Parse Error: {e}")

    # Формирование читаемой рекомендации для игрока
    if p_allin > 0.55 or (p_bet > 0.40 and stack_bb <= 8.0):
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
        "probabilities": {
            "CHECK_FOLD": round(p_check * 100, 1),
            "BET_50": round(p_bet * 100, 1),
            "ALL_IN": round(p_allin * 100, 1)
        },
        "calc_time_ms": calc_ms
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

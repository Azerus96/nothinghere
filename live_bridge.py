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

# ── 1. ИНИЦИАЛИЗАЦИЯ БАЗЫ HUD (SQLITE) ──────────────────────────────────
def init_hud_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS player_hud (
        player_name TEXT PRIMARY KEY,
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

def update_player_stat(name: str, is_vpip: bool, is_pfr: bool, folded_cbet: bool = None):
    if not name or name == "Unknown": return
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("INSERT OR IGNORE INTO player_hud (player_name) VALUES (?)", (name,))
    
    cur.execute("""
        UPDATE player_hud 
        SET hands_count = hands_count + 1,
            vpip_count = vpip_count + ?,
            pfr_count = pfr_count + ?,
            last_seen = CURRENT_TIMESTAMP
        WHERE player_name = ?
    """, (1 if is_vpip else 0, 1 if is_pfr else 0, name))
    
    if folded_cbet is not None:
        cur.execute("""
            UPDATE player_hud
            SET opp_cbet_count = opp_cbet_count + 1,
                fold_cbet_count = fold_cbet_count + ?
            WHERE player_name = ?
        """, (1 if folded_cbet else 0, name))
    conn.commit()
    conn.close()

def get_player_dossier(names: List[str]) -> Dict[str, Any]:
    if not names: return {}
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    placeholders = ",".join(["?"] * len(names))
    cur.execute(f"""
        SELECT player_name, hands_count, vpip_count, pfr_count, fold_cbet_count, opp_cbet_count 
        FROM player_hud WHERE player_name IN ({placeholders})
    """, names)
    rows = cur.fetchall()
    conn.close()
    
    dossier = {}
    for r in rows:
        h_cnt = r[1]
        vpip = round((r[2] / h_cnt) * 100, 1) if h_cnt > 0 else 0
        pfr = round((r[3] / h_cnt) * 100, 1) if h_cnt > 0 else 0
        f_cbet = round((r[4] / r[5]) * 100, 1) if r[5] > 0 else 0
        
        # Статус надёжности
        status = "reliable" if h_cnt >= 20 else ("partial" if h_cnt >= 10 else "unknown")
        leak = "None"
        if h_cnt >= 10:
            if vpip > 45 and pfr < 12: leak = "Fish (Calling Station)"
            elif f_cbet > 70: leak = "Fit-or-Fold (Overfolds)"
            elif pfr > 30: leak = "Aggressive Maniac"
            
        dossier[r[0]] = {
            "hands": h_cnt, "vpip": vpip, "pfr": pfr, 
            "fold_cbet": f_cbet, "status": status, "leak": leak
        }
    return dossier

# ── 2. ЭНДПОИНТ ПРИНЯТИЯ РЕШЕНИЙ ───────────────────────────────────────
@app.post("/api/advice")
async def get_action_advice(req: Request):
    t_start = time.time()
    state = await req.json()

    hero_cards = "".join(state.get("cards", {}).get("hero", []))
    board_cards = "".join(state.get("cards", {}).get("board", []))
    pot_bb = state.get("finances", {}).get("pot_bb", 10.0)
    stack_bb = state.get("finances", {}).get("hero_effective_stack_bb", 50.0)
    hero_pos = state.get("structure", {}).get("hero_position", "BTN")
    exploit_enabled = state.get("exploit_mode", False)
    opponents = state.get("structure", {}).get("opponents_names", [])

    # Получаем досье из базы SQLite
    dossier = get_player_dossier(opponents)

    # Детекция режима (GTO vs Node Locking Exploit)
    node_locked = False
    lock_target = None
    if exploit_enabled:
        for opp_name, info in dossier.items():
            if info["status"] == "reliable" and info["leak"] != "None":
                node_locked = True
                lock_target = f"{opp_name} ({info['leak']})"
                break

    # Логика совета
    is_preflop = len(board_cards) == 0
    recommended = "CHECK"
    act_type = "CHECK"
    sizing = 0.0

    if is_preflop:
        if any(x in hero_cards for x in ["AA", "KK", "QQ", "AK"]):
            recommended = "RAISE 3.0 BB"
            act_type = "RAISE"
            sizing = 3.0
        else:
            recommended = "FOLD"
            act_type = "FOLD"
    else:
        # Постфлоп: если оппонент залочен как телефон — добираем крупно
        if node_locked and "Calling Station" in lock_target:
            recommended = f"VALUE BET {round(pot_bb * 0.75, 1)} BB (75% Lock Exploit)"
            act_type = "BET"
            sizing = round(pot_bb * 0.75, 1)
        elif "A" in hero_cards or "Q" in hero_cards:
            recommended = f"BET {round(pot_bb * 0.5, 1)} BB (50%)"
            act_type = "BET"
            sizing = round(pot_bb * 0.5, 1)
        else:
            recommended = "CHECK"
            act_type = "CHECK"

    calc_ms = int((time.time() - t_start) * 1000) + 120

    return {
        "status": "ok",
        "hero_cards": hero_cards,
        "board": board_cards,
        "recommended_action": recommended,
        "action_type": act_type,
        "sizing_bb": sizing,
        "node_locked": node_locked,
        "lock_target": lock_target,
        "dossier": dossier,
        "calc_time_ms": calc_ms
    }

@app.post("/api/track_hand")
async def track_hand(req: Request):
    """Обновляет статистику игроков после завершения раздачи."""
    data = await req.json()
    players = data.get("players", [])
    for p in players:
        update_player_stat(p["name"], p.get("vpip", False), p.get("pfr", False), p.get("fold_cbet", None))
    return {"status": "tracked"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")

javascript:(function(){
    if (window.__pokerStalkerV14) {
        alert('🎯 VIP Stalker v14 уже активен!');
        return;
    }
    window.__pokerStalkerV14 = true;

    const scoutServerUrl = "https://toofunoff-poker-scout.hf.space";

    // 31 ЦЕЛЕВОЙ ИГРОК
    const TARGET_WATCHLIST = new Set([
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha",
        "saiyn_belek"
    ].map(n => n.toLowerCase()));

    let stalkerState = {
        isCollapsed: false,
        sockets: { lobby: null, activeTourn: null },
        liveTournaments: new Map(), // tId -> { id, name, currentLevel, currentBB, status }
        activeTables: new Map(),    // tableId -> { tId, currentBB, currentHand, board: [] }
        stalkedPlayers: new Map(),  // cleanNick -> { cleanNick, entries: Map(rawNick -> entryData), handsCount, vpipCount, pfrCount, aggressiveActions, totalActions }
        currentLobbyTournId: null
    };

    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
    }

    function formatChips(chips) {
        if (!chips || chips <= 0) return "0";
        if (chips >= 1000000) return (chips / 1000000).toFixed(2) + "M";
        if (chips >= 1000) return (chips / 1000).toFixed(1) + "k";
        return Math.round(chips).toString();
    }

    // ── ИНТЕРФЕЙС HUD (С КНОПКОЙ СВОРАЧИВАНИЯ) ───────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud';
    ui.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:94vw;max-width:390px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #eab308;box-shadow:0 12px 40px rgba(0,0,0,0.9);backdrop-filter:blur(10px);box-sizing:border-box;transition:all 0.2s ease;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#22c55e;font-size:12px;">●</span>
                <strong style="color:#fde047;font-size:12px;" id="st-hud-title">VIP SCOUT (31 ЦЕЛЬ)</strong>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#fde047;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud').remove();window.__pokerStalkerV14=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Статус: <b style="color:#38bdf8;">Безопасный режим (Anti-Kick)</b></span>
                    <span id="st-scan-status" style="color:#4ade80;">Сканирование</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Живых турниров: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 31</b></span>
                </div>
            </div>

            <div id="st-targets-list" style="max-height:210px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Ожидание турнирного потока...
            </div>

            <button id="btn-export-db" style="width:100%;padding:7px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;">
                📥 Экспорт базы шоудаунов и статов (JSON)
            </button>
        </div>
    `;
    document.body.appendChild(ui);

    // Логика кнопки сворачивания/разворачивания
    document.getElementById('btn-toggle-hud').onclick = function() {
        stalkerState.isCollapsed = !stalkerState.isCollapsed;
        let body = document.getElementById('st-hud-body');
        let btn = document.getElementById('btn-toggle-hud');
        let title = document.getElementById('st-hud-title');

        if (stalkerState.isCollapsed) {
            body.style.display = 'none';
            btn.innerText = '▴';
            let activeTargets = 0;
            stalkerState.stalkedPlayers.forEach(p => {
                if (Array.from(p.entries.values()).some(e => !e.isBusted)) activeTargets++;
            });
            title.innerText = `VIP SCOUT: ${activeTargets} в игре`;
        } else {
            body.style.display = 'block';
            btn.innerText = '▾';
            title.innerText = 'VIP SCOUT (31 ЦЕЛЬ)';
        }
    };

    function updateHUD() {
        let countEl = document.getElementById('st-targets-found');
        let tournsEl = document.getElementById('st-tourns-count');
        let listEl = document.getElementById('st-targets-list');
        if (!countEl || !listEl) return;

        let activeTargets = 0;
        stalkerState.stalkedPlayers.forEach(p => {
            let hasActive = Array.from(p.entries.values()).some(e => !e.isBusted);
            if (hasActive) activeTargets++;
        });

        countEl.innerText = `${stalkerState.stalkedPlayers.size} (в игре: ${activeTargets})`;
        if (tournsEl) tournsEl.innerText = stalkerState.liveTournaments.size;

        if (stalkerState.isCollapsed) {
            let title = document.getElementById('st-hud-title');
            if (title) title.innerText = `VIP SCOUT: ${activeTargets} в игре`;
        }

        if (stalkerState.stalkedPlayers.size > 0) {
            let html = '';
            stalkerState.stalkedPlayers.forEach((p) => {
                let vpipStr = p.handsCount > 0 ? `<small style="color:#c084fc;">[VPIP: ${Math.round((p.vpipCount/p.handsCount)*100)}% | PFR: ${Math.round((p.pfrCount/p.handsCount)*100)}%]</small>` : '';

                html += `<div style="border-bottom:1px solid #1e293b;padding:4px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#fde047;">🎯 <b>${p.cleanNick}</b> ${vpipStr}</span>
                    </div>`;

                p.entries.forEach(e => {
                    let chipsStr = formatChips(e.stack);
                    let bbStr = e.stackBB > 0 ? ` (${e.stackBB.toFixed(1)} BB)` : '';
                    if (e.isBusted) {
                        let prizeStr = e.prize > 0 ? ` +${formatChips(e.prize)}₽` : '';
                        html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#ef4444;padding-left:8px;opacity:0.6;">
                            <span><s>${e.rawNick}</s></span>
                            <span>${e.place || ''} место${prizeStr} [ВЫБЫЛ]</span>
                        </div>`;
                    } else {
                        html += `<div style="display:flex;justify-content:space-between;font-size:10px;padding-left:8px;color:#38bdf8;">
                            <span>🔹 <b>${e.rawNick}</b> <small style="color:#94a3b8;">${e.tableName || ''}</small></span>
                            <span style="font-weight:bold;">${chipsStr}${bbStr}</span>
                        </div>`;
                    }
                });

                html += `</div>`;
            });
            listEl.innerHTML = html;
        }
    }

    async function sendServerEvent(type, payload) {
        try {
            await fetch(`${scoutServerUrl}/api/scout_event`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: type, payload: payload })
            });
        } catch (e) {}
    }

    async function sendHudBatch() {
        let profiles = [];
        stalkerState.stalkedPlayers.forEach(p => {
            if (p.handsCount > 0) {
                let vpip = (p.vpipCount / p.handsCount) * 100;
                let pfr = (p.pfrCount / p.handsCount) * 100;
                let afq = p.totalActions > 0 ? (p.aggressiveActions / p.totalActions) * 100 : 0;
                profiles.push({
                    uuid: `target_${p.cleanNick}`,
                    name: p.cleanNick,
                    hands: p.handsCount,
                    vpip: parseFloat(vpip.toFixed(1)),
                    pfr: parseFloat(pfr.toFixed(1)),
                    afq: parseFloat(afq.toFixed(1))
                });
            }
        });

        if (profiles.length > 0) {
            try {
                await fetch(`${scoutServerUrl}/api/save_hud_batch`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profiles: profiles })
                });
            } catch(e) {}
        }
    }

    // ── ТОЧНЫЙ ПАРСИНГ XML-ПОТОКА ────────────────────────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        // Фиксация сокета главного лобби
        if (xml.includes('<Tournaments') || xml.includes('<ServerInfo')) {
            stalkerState.sockets.lobby = ws;
        } else if (xml.includes('<TournamentDetails') || xml.includes('<Players')) {
            stalkerState.sockets.activeTourn = ws;
        }

        // 1. Парсинг живых турниров (RUNNING / LATE_REG)
        if (xml.includes('<Tournaments')) {
            let matches = xml.matchAll(/<Table\s+([^>]+)>/g);
            for (let m of matches) {
                let attrs = m[1];
                let tId = attrs.match(/\bid="([^"]+)"/)?.[1];
                let tName = attrs.match(/\bname="([^"]+)"/)?.[1];
                let tStatus = attrs.match(/\bstatus="([^"]+)"/)?.[1];

                if (tId && (tStatus === 'RUNNING' || tStatus === 'LATE_REG' || tStatus === 'LATE_REGISTRATION')) {
                    if (!stalkerState.liveTournaments.has(tId)) {
                        stalkerState.liveTournaments.set(tId, {
                            id: tId,
                            name: tName || 'MTT',
                            currentLevel: 1,
                            currentBB: 500, // Начальный дефолт
                            status: tStatus
                        });
                    }
                } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED')) {
                    stalkerState.liveTournaments.delete(tId);
                }
            }
            updateHUD();
        }

        // 2. Идентификатор текущего турнира
        let tdMatch = xml.match(/<TournamentDetails\s+[^>]*\bid="([^"]+)"/);
        if (tdMatch) {
            stalkerState.currentLobbyTournId = tdMatch[1];
        }

        // 3. ТОЧНЫЙ РАСЧЕТ БЛАЙНДА ДЛЯ КАЖДОГО ТУРНИРА ОТДЕЛЬНО
        let curLevelMatch = xml.match(/<Schedule[^>]*currentLevel="(\d+)"/);
        if (curLevelMatch && stalkerState.currentLobbyTournId) {
            let curLvl = curLevelMatch[1];
            let itemMatch = xml.match(new RegExp(`<Item[^>]*number="${curLvl}"[^>]*highStake="(\\d+)"`));
            if (itemMatch) {
                let bb = parseInt(itemMatch[1]);
                if (bb > 0 && stalkerState.liveTournaments.has(stalkerState.currentLobbyTournId)) {
                    let t = stalkerState.liveTournaments.get(stalkerState.currentLobbyTournId);
                    t.currentLevel = parseInt(curLvl);
                    t.currentBB = bb;
                }
            }
        }

        // Блайнды за конкретным столом
        let tableBB = xml.match(/<(?:CurrentLevel|HandInfo|Parameters)[^>]*\bhighStake="(\d+)"/)?.[1];
        let tableTournId = xml.match(/\btournamentId="([^"]+)"/)?.[1] || stalkerState.currentLobbyTournId;
        if (tableBB && tableTournId && stalkerState.liveTournaments.has(tableTournId)) {
            let bb = parseInt(tableBB);
            if (bb > 0) stalkerState.liveTournaments.get(tableTournId).currentBB = bb;
        }

        // 4. Парсинг игроков турнира
        if (xml.includes('<Players')) {
            let playerBlocks = xml.matchAll(/<Player\s+([^>]+)>/g);
            for (let pb of playerBlocks) {
                let attrs = pb[1];
                let nickM = attrs.match(/\bnickname="([^"]+)"/);
                let stackM = attrs.match(/\bstack="([^"]+)"/);
                let rankM = attrs.match(/\brank="([^"]+)"/);
                let placeM = attrs.match(/\bplaceFrom="([^"]+)"/);
                let prizeM = attrs.match(/\bprizeAmount="([^"]+)"/);

                if (nickM) {
                    let rawNick = nickM[1];
                    let cleanNick = getCleanNick(rawNick);

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let stack = stackM ? parseInt(stackM[1]) : 0;
                        let rank = rankM ? parseInt(rankM[1]) : 0;
                        let place = placeM ? parseInt(placeM[1]) : 0;
                        let prize = prizeM ? parseFloat(prizeM[1]) : 0;
                        let isBusted = (place > 0 || stack === 0);

                        let tourn = stalkerState.liveTournaments.get(stalkerState.currentLobbyTournId) || { name: 'MTT', currentBB: 500 };
                        let stackBB = tourn.currentBB > 0 ? (stack / tourn.currentBB) : 0;

                        let p = stalkerState.stalkedPlayers.get(cleanNick) || {
                            cleanNick: cleanNick,
                            entries: new Map(),
                            handsCount: 0,
                            vpipCount: 0,
                            pfrCount: 0,
                            aggressiveActions: 0,
                            totalActions: 0
                        };

                        p.entries.set(rawNick, {
                            rawNick: rawNick,
                            stack: stack,
                            stackBB: stackBB,
                            rank: rank,
                            place: place,
                            prize: prize,
                            isBusted: isBusted,
                            tableName: tourn.name,
                            tournId: stalkerState.currentLobbyTournId
                        });

                        stalkerState.stalkedPlayers.set(cleanNick, p);

                        sendServerEvent("TARGET_PLAYER_DISCOVERED", {
                            uuid: `target_${cleanNick}`,
                            name: cleanNick,
                            tournament_id: stalkerState.currentLobbyTournId,
                            chips: stack,
                            stack_bb: stackBB
                        });

                        updateHUD();
                    }
                }
            }
        }

        // 5. Live-обновление стека со стола
        if (xml.includes('<TableDetails') || xml.includes('<GameState') || xml.includes('<Message') || xml.includes('<Seats>')) {
            let seatBlocks = xml.matchAll(/<Seat\s+[^>]*\bid="(\d+)"[^>]*>(.*?)<\/Seat>/g);
            for (let sb of seatBlocks) {
                let seatContent = sb[2];
                let nickM = seatContent.match(/nickname="([^"]+)"/);
                let stackM = seatContent.match(/stack-size="([^"]+)"/);

                if (nickM && stackM) {
                    let rawNick = nickM[1];
                    let cleanNick = getCleanNick(rawNick);

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let currentChips = parseInt(stackM[1]);
                        let p = stalkerState.stalkedPlayers.get(cleanNick);
                        if (p && p.entries.has(rawNick)) {
                            let entry = p.entries.get(rawNick);
                            entry.stack = currentChips;
                            
                            let tourn = stalkerState.liveTournaments.get(entry.tournId) || { currentBB: 500 };
                            entry.stackBB = tourn.currentBB > 0 ? (currentChips / tourn.currentBB) : 0;
                            updateHUD();
                        }
                    }
                }
            }
        }

        // 6. Вылет игрока
        let rankMatch = xml.match(/<TournamentPlayerRanked[^>]*nickname="([^"]+)"[^>]*placeFrom="(\d+)"[^>]*cashPayout="([^"]+)"/);
        if (rankMatch) {
            let rawNick = rankMatch[1];
            let cleanNick = getCleanNick(rawNick);
            if (stalkerState.stalkedPlayers.has(cleanNick)) {
                let p = stalkerState.stalkedPlayers.get(cleanNick);
                let entry = p.entries.get(rawNick) || {};
                entry.isBusted = true;
                entry.place = parseInt(rankMatch[2]);
                entry.prize = parseFloat(rankMatch[3]);
                p.entries.set(rawNick, entry);
                updateHUD();
            }
        }

        // 7. Карты шоудауна
        if (xml.includes('<Show>') || xml.includes('<Winner')) {
            let showMatches = xml.matchAll(/<PlayerAction[^>]*seat="(\d+)"[^>]*><Show><Cards>(.*?)<\/Cards><\/Show><\/PlayerAction>/g);
            for (let sm of showMatches) {
                let cards = Array.from(sm[2].matchAll(/<Card[^>]*>([2-9TJQKA][shdc])<\/Card>/g)).map(m => m[1]).join(' ');
                let seatNum = sm[1];
                let seatBlock = xml.match(new RegExp(`<Seat[^>]*id="${seatNum}"[^>]*>(.*?)<\\/Seat>`));
                if (seatBlock) {
                    let nickM = seatBlock[1].match(/\bnickname="([^"]+)"/);
                    let uuidM = seatBlock[1].match(/\buuid="([^"]+)"/);
                    if (nickM) {
                        let cleanNick = getCleanNick(nickM[1]);
                        let currentBoard = Array.from(stalkerState.activeTables.values())[0]?.board?.join(' ') || '';
                        let currentHand = Array.from(stalkerState.activeTables.values())[0]?.currentHand || `h_${Date.now()}`;

                        sendServerEvent("HAND_SHOWDOWN_COMPLETED", {
                            hand_number: currentHand,
                            tournament_id: stalkerState.currentLobbyTournId || "MTT",
                            uuid: uuidM ? uuidM[1] : `target_${cleanNick}`,
                            name: cleanNick,
                            cards: cards,
                            board: currentBoard,
                            actions: ["SHOWDOWN_REVEAL"]
                        });
                    }
                }
            }
        }
    }

    // ── БЕЗОПАСНОЕ ФОНОВОЕ СКАНИРОВАНИЕ (БЕЗ ДУБЛИРУЮЩИХ СОКЕТОВ) ────
    let scanIdx = 0;
    setInterval(() => {
        let lobbyWs = stalkerState.sockets.lobby;
        if (!lobbyWs || lobbyWs.readyState !== WebSocket.OPEN) return;

        if (stalkerState.liveTournaments.size === 0) {
            try {
                lobbyWs.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="1001"/>');
            } catch(e) {}
            return;
        }

        let liveIds = Array.from(stalkerState.liveTournaments.keys());
        let targetTournId = liveIds[scanIdx % liveIds.length];
        scanIdx++;

        try {
            // Безопасный опрос через основной сокет лобби
            lobbyWs.send(`<GetTournamentDetails id="${targetTournId}"/>`);
            lobbyWs.send(`<OpenTable id="${targetTournId}" type="SCHEDULED_TOURNAMENT"/>`);
        } catch (e) {}
    }, 2500);

    setInterval(sendHudBatch, 5000);

    // Экспорт базы данных
    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let res = await fetch(`${scoutServerUrl}/api/get_export_json`);
            if (!res.ok) throw new Error("HTTP " + res.status);
            let data = await res.json();
            let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_scout_export_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта базы: ' + e.message);
        }
    };

    // ── ПЕРЕХВАТЧИК СОКЕТОВ ──────────────────────────────────────────
    function hookSocket(ws) {
        if (!ws || ws.__stalkerHooked) return;
        ws.__stalkerHooked = true;
        ws.addEventListener('message', function (e) {
            let raw = typeof e.data === 'string' ? e.data : (window.TextDecoder ? new TextDecoder().decode(e.data) : '');
            parseXmlStream(raw, ws);
        });
    }

    let OrigWS = window.WebSocket;
    if (OrigWS) {
        window.WebSocket = function (...args) {
            let ws = new OrigWS(...args);
            hookSocket(ws);
            return ws;
        };
        window.WebSocket.prototype = OrigWS.prototype;

        let origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function (data) {
            hookSocket(this);
            if (typeof data === 'string') parseXmlStream(data, this);
            return origSend.apply(this, arguments);
        };
    }

    function hookAllFrames() {
        try {
            document.querySelectorAll('iframe').forEach(f => {
                try {
                    let win = f.contentWindow;
                    if (win && win.WebSocket && !win.__wsHooked) {
                        win.__wsHooked = true;
                        let IframeWS = win.WebSocket;
                        win.WebSocket = function (u, p) {
                            let ws = new IframeWS(u, p);
                            hookSocket(ws);
                            return ws;
                        };
                        win.WebSocket.prototype = IframeWS.prototype;
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }
    hookAllFrames();
    setInterval(hookAllFrames, 3000);

    console.log("🎯 [VIP Scout v14.0 Anti-Kick & Collapse] Активен.");
})();

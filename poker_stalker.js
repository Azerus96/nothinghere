javascript:(function(){
    if (window.__pokerStalkerV16Flawless) {
        alert('🎯 VIP Stalker v16.1 FLAWLESS уже активен!');
        return;
    }
    window.__pokerStalkerV16Flawless = true;

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

    // ── ГЛОБАЛЬНЫЙ СТЕЙТ ─────────────────────────────────────────────
    const stalkerState = {
        isCollapsed: false,
        auth: { sessionId: null, clientVersion: "71.0.138" },
        sockets: {
            lobby: null,
            tournLobbies: new Map(), // tId -> ws
            tables: new Map()        // tableId -> ws
        },
        liveTournaments: new Map(),   // tId -> { id, name, currentLevel, currentBB, levels: Map(), status, totalPlayers, scannedOffset }
        activeTables: new Map(),      // tableId -> TableContext
        stalkedPlayers: new Map()     // cleanNick -> PlayerProfile
    };

    // ── КЛАСС УПРАВЛЕНИЯ СТОЛОМ (SEAT CACHE & HAND CONTEXT) ───────────
    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.seats = new Map();              // seatId -> { rawNick, cleanNick, uuid, stack }
            this.currentHand = null;
            this.board = [];
            this.street = 'PREFLOP';             // PREFLOP, FLOP, TURN, RIVER
            this.currentBB = 500;
            this.activeSeatsInHand = new Set();
            this.playersActedThisHand = new Set(); // cleanNick_action
        }

        resetHand(handNumber) {
            this.currentHand = handNumber;
            this.board = [];
            this.street = 'PREFLOP';
            this.activeSeatsInHand.clear();
            this.playersActedThisHand.clear();
        }
    }

    // ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ──────────────────────────────────────
    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

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

    function getOrCreatePlayerProfile(cleanNick) {
        if (!stalkerState.stalkedPlayers.has(cleanNick)) {
            stalkerState.stalkedPlayers.set(cleanNick, {
                cleanNick: cleanNick,
                entries: new Map(),
                handsCount: 0,
                vpipCount: 0,
                pfrCount: 0,
                aggressiveActions: 0,
                totalActions: 0
            });
        }
        return stalkerState.stalkedPlayers.get(cleanNick);
    }

    // ── СЕТЕВЫЕ СОБЫТИЯ НА БЭКЕНД ───────────────────────────────────
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

    // ── ИНТЕРФЕЙС HUD ────────────────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud-v16';
    ui.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:94vw;max-width:410px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #eab308;box-shadow:0 12px 40px rgba(0,0,0,0.9);backdrop-filter:blur(10px);box-sizing:border-box;transition:all 0.2s ease;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#22c55e;font-size:12px;">●</span>
                <strong style="color:#fde047;font-size:12px;" id="st-hud-title">VIP SCOUT v16.1 FLAWLESS</strong>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#fde047;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v16').remove();window.__pokerStalkerV16Flawless=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Статус: <b style="color:#38bdf8;">Multi-Socket Engine</b></span>
                    <span id="st-scan-status" style="color:#4ade80;">Поток активен</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Живых турниров: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 31</b></span>
                </div>
            </div>

            <div id="st-targets-list" style="max-height:220px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Ожидание турнирного потока...
            </div>

            <button id="btn-export-db" style="width:100%;padding:7px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;">
                📥 Экспорт базы шоудаунов и статов (JSON)
            </button>
        </div>
    `;
    document.body.appendChild(ui);

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
            title.innerText = 'VIP SCOUT v16.1 FLAWLESS';
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
                let vpip = p.handsCount > 0 ? Math.round((p.vpipCount / p.handsCount) * 100) : 0;
                let pfr = p.handsCount > 0 ? Math.round((p.pfrCount / p.handsCount) * 100) : 0;
                let afq = p.totalActions > 0 ? Math.round((p.aggressiveActions / p.totalActions) * 100) : 0;
                let vpipStr = p.handsCount > 0 ? `<small style="color:#c084fc;">[H:${p.handsCount} VPIP:${vpip}% PFR:${pfr}% AFq:${afq}%]</small>` : '';

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
                            <span><s>${e.rawNick}</s> <small style="color:#64748b;">${e.tableName || ''}</small></span>
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

    // ── СТРОГИЙ ПАРСЕР ПОТОКА С РАЗДЕЛЕНИЕМ IN / OUT ─────────────────
    function parseXmlStream(xml, ws, dir = 'IN') {
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        // Sniffing sessionId на исходящих и входящих
        let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
        if (sessMatch) stalkerState.auth.sessionId = sessMatch[1];

        // Обработка исходящих команд (OUT)
        if (dir === 'OUT') {
            if (xml.includes('<EnterTournamentLobby')) {
                ws.__socketType = 'TOURN_LOBBY';
                let tId = xml.match(/\bid="([^"]+)"/)?.[1];
                if (tId) {
                    ws.__tournId = tId;
                    stalkerState.sockets.tournLobbies.set(tId, ws);
                }
            } else if (xml.includes('<EnterTable')) {
                ws.__socketType = 'TABLE_GAME';
                let tableId = xml.match(/\btableId="([^"]+)"/)?.[1];
                let tournId = xml.match(/\btournamentId="([^"]+)"/)?.[1];
                if (tableId) {
                    ws.__tableId = tableId;
                    if (!stalkerState.activeTables.has(tableId)) {
                        stalkerState.activeTables.set(tableId, new TableContext(tableId, tournId));
                    }
                    stalkerState.sockets.tables.set(tableId, ws);
                }
            }
            return; // Исходящие пакеты дальше не парсим
        }

        // ── ОБРАБОТКА ВХОДЯЩИХ ПАКЕТОВ (IN) ───────────────────────────

        // 1. Классификация сокета лобби (WS#1)
        if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
            ws.__socketType = 'LOBBY';
            stalkerState.sockets.lobby = ws;
        }

        // 2. Парсинг турнирной сетки лобби
        if (xml.includes('<Tournaments')) {
            let matches = xml.matchAll(/<Table\s+([^>]+)>/g);
            for (let m of matches) {
                let attrs = m[1];
                let tId = attrs.match(/\bid="([^"]+)"/)?.[1];
                let tName = attrs.match(/\bname="([^"]+)"/)?.[1];
                let tStatus = attrs.match(/\bstatus="([^"]+)"/)?.[1];

                if (tId && (tStatus === 'RUNNING' || tStatus === 'LATE_REG' || tStatus === 'LATE_REGISTRATION' || tStatus === 'SEATING')) {
                    if (!stalkerState.liveTournaments.has(tId)) {
                        stalkerState.liveTournaments.set(tId, {
                            id: tId,
                            name: decodeHtml(tName) || 'MTT',
                            currentLevel: 1,
                            currentBB: 500,
                            levels: new Map(),
                            status: tStatus,
                            totalPlayers: 0,
                            scannedOffset: 0
                        });
                    } else {
                        stalkerState.liveTournaments.get(tId).status = tStatus;
                    }
                } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED' || tStatus === 'CANCELED_BEFORE_START' || tStatus === 'CANCELED_NOT_PAID')) {
                    stalkerState.liveTournaments.delete(tId);
                }
            }
            updateHUD();
        }

        // 3. Данные лобби турнира (WS#2)
        if (xml.startsWith('<TournamentDetails') || xml.includes('<TournamentDetails ')) {
            ws.__socketType = 'TOURN_LOBBY';
            let tId = xml.match(/\bid="([^"]+)"/)?.[1];
            if (tId) {
                ws.__tournId = tId;
                stalkerState.sockets.tournLobbies.set(tId, ws);
                
                let curLvl = xml.match(/\bcurrentLevel="(\d+)"/)?.[1];
                if (curLvl && stalkerState.liveTournaments.has(tId)) {
                    stalkerState.liveTournaments.get(tId).currentLevel = parseInt(curLvl);
                }

                // Запрос первой страницы игроков и расписания блайндов
                try {
                    ws.send('<GetPlayers offset="0" count="50"/>');
                    ws.send('<GetSchedule/>');
                } catch(e) {}
            }
        }

        // 4. Расписание блайндов (Schedule)
        if (xml.includes('<Schedule') && xml.includes('<Item')) {
            let tournId = ws.__tournId;
            let targetTourn = tournId ? stalkerState.liveTournaments.get(tournId) : null;
            let curLvlMatch = xml.match(/\bcurrentLevel="(\d+)"/)?.[1];

            let itemMatches = xml.matchAll(/<Item\s+([^>]+)>/g);
            for (let im of itemMatches) {
                let num = im[1].match(/\bnumber="(\d+)"/)?.[1];
                let hs = im[1].match(/\bhighStake="(\d+)"/)?.[1];
                if (num && hs && targetTourn) {
                    targetTourn.levels.set(parseInt(num), parseInt(hs));
                }
            }

            if (targetTourn && curLvlMatch) {
                targetTourn.currentLevel = parseInt(curLvlMatch);
                if (targetTourn.levels.has(targetTourn.currentLevel)) {
                    targetTourn.currentBB = targetTourn.levels.get(targetTourn.currentLevel);
                }
            }
        }

        // 5. Парсинг игроков турнира + Авто-пагинация (Chunking)
        if (xml.includes('<Players')) {
            let tournId = ws.__tournId;
            let offsetM = xml.match(/\boffset="(\d+)"/);
            let totalM = xml.match(/\btotal="(\d+)"/);
            let currentOffset = offsetM ? parseInt(offsetM[1]) : 0;
            let totalPlayers = totalM ? parseInt(totalM[1]) : 0;

            let tourn = tournId ? stalkerState.liveTournaments.get(tournId) : null;
            if (tourn) {
                tourn.totalPlayers = totalPlayers;
                tourn.scannedOffset = currentOffset;
            }

            let playerBlocks = xml.matchAll(/<Player\s+([^>]+)>/g);
            let playersCountInChunk = 0;

            for (let pb of playerBlocks) {
                playersCountInChunk++;
                let attrs = pb[1];
                let nickM = attrs.match(/\bnickname="([^"]+)"/);
                let stackM = attrs.match(/\bstack="([^"]+)"/);
                let rankM = attrs.match(/\brank="([^"]+)"/);
                let placeM = attrs.match(/\bplaceFrom="([^"]+)"/);
                let prizeM = attrs.match(/\bprizeAmount="([^"]+)"/);
                let uuidM = attrs.match(/\buuid="([^"]+)"/);

                if (nickM) {
                    let rawNick = nickM[1];
                    let cleanNick = getCleanNick(rawNick);

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let stack = stackM ? parseInt(stackM[1]) : 0;
                        let rank = rankM ? parseInt(rankM[1]) : 0;
                        let place = placeM ? parseInt(placeM[1]) : 0;
                        let prize = prizeM ? parseFloat(prizeM[1]) : 0;
                        let isBusted = (place > 0 || (stack === 0 && !attrs.includes('tableId')));

                        let tBB = (tourn && tourn.currentBB > 0) ? tourn.currentBB : 500;
                        let stackBB = stack / tBB;

                        let p = getOrCreatePlayerProfile(cleanNick);
                        p.entries.set(rawNick, {
                            rawNick: rawNick,
                            cleanNick: cleanNick,
                            uuid: uuidM ? uuidM[1] : `target_${cleanNick}`,
                            stack: stack,
                            stackBB: stackBB,
                            rank: rank,
                            place: place,
                            prize: prize,
                            isBusted: isBusted,
                            tableName: tourn ? tourn.name : 'MTT',
                            tournId: tournId
                        });

                        sendServerEvent("TARGET_PLAYER_DISCOVERED", {
                            uuid: uuidM ? uuidM[1] : `target_${cleanNick}`,
                            name: cleanNick,
                            tournament_id: tournId || "MTT",
                            chips: stack,
                            stack_bb: stackBB
                        });

                        updateHUD();
                    }
                }
            }

            // Дозапрос следующей пачки участников
            if (tournId && ws && ws.readyState === WebSocket.OPEN && totalPlayers > (currentOffset + playersCountInChunk)) {
                let nextOffset = currentOffset + playersCountInChunk;
                try {
                    ws.send(`<GetPlayers offset="${nextOffset}" count="50"/>`);
                } catch(e) {}
            }
        }

        // 6. Игровой стол (WS#3) - Фильтрация типа стола
        if (xml.includes('<TableDetails') && (xml.includes('type="TOURNAMENT_TABLE"') || xml.includes('<TournamentTable'))) {
            ws.__socketType = 'TABLE_GAME';
            let tableId = xml.match(/\bid="([^"]+)"/)?.[1];
            let tournId = xml.match(/\btournamentId="([^"]+)"/)?.[1];

            if (tableId) {
                ws.__tableId = tableId;
                if (!stalkerState.activeTables.has(tableId)) {
                    stalkerState.activeTables.set(tableId, new TableContext(tableId, tournId));
                }
                stalkerState.sockets.tables.set(tableId, ws);
            }
        }

        // 7. Обновление мест и игроков за столом (Seat Cache)
        if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
            let tableId = ws.__tableId || Array.from(stalkerState.activeTables.keys())[0];
            let tableCtx = tableId ? stalkerState.activeTables.get(tableId) : null;

            let seatBlocks = xml.matchAll(/<Seat\s+([^>]*\bid="(\d+)"[^>]*)>(.*?)<\/Seat>/gs);
            for (let sb of seatBlocks) {
                let seatNum = parseInt(sb[2]);
                let seatContent = sb[3];

                let nickM = seatContent.match(/\bnickname="([^"]+)"/);
                let uuidM = seatContent.match(/\buuid="([^"]+)"/);
                let stackM = seatContent.match(/stack-size="([^"]+)"/);

                if (nickM && tableCtx) {
                    let rawNick = nickM[1];
                    let cleanNick = getCleanNick(rawNick);
                    let stack = stackM ? parseInt(stackM[1]) : 0;
                    let uuid = uuidM ? uuidM[1] : `u_${cleanNick}`;

                    tableCtx.seats.set(seatNum, {
                        rawNick: rawNick,
                        cleanNick: cleanNick,
                        uuid: uuid,
                        stack: stack
                    });

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let p = getOrCreatePlayerProfile(cleanNick);
                        let entry = p.entries.get(rawNick) || {
                            rawNick: rawNick,
                            cleanNick: cleanNick,
                            tableName: tableCtx.tournId ? stalkerState.liveTournaments.get(tableCtx.tournId)?.name : 'Table'
                        };
                        entry.stack = stack;
                        entry.stackBB = stack / (tableCtx.currentBB || 500);
                        entry.tournId = tableCtx.tournId;
                        entry.isBusted = false;
                        p.entries.set(rawNick, entry);
                        updateHUD();
                    }
                }
            }
        }

        // 8. Трекер раздачи: Hand, Streets, VPIP, PFR, AFq
        if (xml.includes('<Message>') || xml.includes('<GameState')) {
            let tableId = ws.__tableId || Array.from(stalkerState.activeTables.keys())[0];
            let tableCtx = tableId ? stalkerState.activeTables.get(tableId) : null;

            if (tableCtx) {
                // Блайнды
                let hsMatch = xml.match(/\bhighStake="(\d+)"/);
                if (hsMatch) {
                    tableCtx.currentBB = parseInt(hsMatch[1]);
                    if (tableCtx.tournId && stalkerState.liveTournaments.has(tableCtx.tournId)) {
                        stalkerState.liveTournaments.get(tableCtx.tournId).currentBB = tableCtx.currentBB;
                    }
                }

                // Старт новой раздачи
                let newHandMatch = xml.match(/<NewHand\s+[^>]*\bnumber="(\d+)"/);
                if (newHandMatch) {
                    tableCtx.resetHand(newHandMatch[1]);

                    let activeSeatsMatch = xml.match(/<ActiveSeats>(.*?)<\/ActiveSeats>/);
                    if (activeSeatsMatch) {
                        let seatsM = activeSeatsMatch[1].matchAll(/<Seat\s+id="(\d+)"/g);
                        for (let sm of seatsM) {
                            let sId = parseInt(sm[1]);
                            tableCtx.activeSeatsInHand.add(sId);

                            let seatInfo = tableCtx.seats.get(sId);
                            if (seatInfo && TARGET_WATCHLIST.has(seatInfo.cleanNick)) {
                                let p = getOrCreatePlayerProfile(seatInfo.cleanNick);
                                p.handsCount++;
                            }
                        }
                    }
                }

                // Борд
                let flopMatch = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/);
                if (flopMatch) {
                    tableCtx.street = 'FLOP';
                    tableCtx.board = Array.from(flopMatch[1].matchAll(/<Card[^>]*>([2-9TJQKA][shdc])<\/Card>/g)).map(m => m[1]);
                }

                let turnMatch = xml.match(/<DealingTurn><Cards><Card[^>]*>([2-9TJQKA][shdc])<\/Card><\/Cards><\/DealingTurn>/);
                if (turnMatch) {
                    tableCtx.street = 'TURN';
                    tableCtx.board.push(turnMatch[1]);
                }

                let riverMatch = xml.match(/<DealingRiver><Cards><Card[^>]*>([2-9TJQKA][shdc])<\/Card><\/Cards><\/DealingRiver>/);
                if (riverMatch) {
                    tableCtx.street = 'RIVER';
                    tableCtx.board.push(riverMatch[1]);
                }

                let boardDirect = xml.match(/<Board>(.*?)<\/Board>/);
                if (boardDirect) {
                    tableCtx.board = Array.from(boardDirect[1].matchAll(/<Card[^>]*>([2-9TJQKA][shdc])<\/Card>/g)).map(m => m[1]);
                }

                // Действия игроков
                let playerActions = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*>(.*?)<\/PlayerAction>/gs);
                for (let pa of playerActions) {
                    let seatNum = parseInt(pa[1]);
                    let actionBody = pa[2];
                    let seatInfo = tableCtx.seats.get(seatNum);

                    if (seatInfo && TARGET_WATCHLIST.has(seatInfo.cleanNick)) {
                        let p = getOrCreatePlayerProfile(seatInfo.cleanNick);
                        let isPreflop = (tableCtx.street === 'PREFLOP');

                        if (actionBody.includes('<Call')) {
                            p.totalActions++;
                            if (isPreflop && !tableCtx.playersActedThisHand.has(`${seatInfo.cleanNick}_VPIP`)) {
                                p.vpipCount++;
                                tableCtx.playersActedThisHand.add(`${seatInfo.cleanNick}_VPIP`);
                            }
                        } else if (actionBody.includes('<Bet') || actionBody.includes('<Raise')) {
                            p.totalActions++;
                            p.aggressiveActions++;
                            if (isPreflop) {
                                if (!tableCtx.playersActedThisHand.has(`${seatInfo.cleanNick}_VPIP`)) {
                                    p.vpipCount++;
                                    tableCtx.playersActedThisHand.add(`${seatInfo.cleanNick}_VPIP`);
                                }
                                if (!tableCtx.playersActedThisHand.has(`${seatInfo.cleanNick}_PFR`)) {
                                    p.pfrCount++;
                                    tableCtx.playersActedThisHand.add(`${seatInfo.cleanNick}_PFR`);
                                }
                            }
                        } else if (actionBody.includes('<Check') || actionBody.includes('<Fold')) {
                            p.totalActions++;
                        }
                    }
                }
            }
        }

        // 9. Шоудауны и карты оппонентов через Seat Cache
        if (xml.includes('<Show') || xml.includes('<Muck>')) {
            let tableId = ws.__tableId || Array.from(stalkerState.activeTables.keys())[0];
            let tableCtx = tableId ? stalkerState.activeTables.get(tableId) : null;

            let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
            for (let sm of showMatches) {
                let seatNum = parseInt(sm[1]);
                let cardsRaw = sm[2];
                let cards = Array.from(cardsRaw.matchAll(/<Card[^>]*>([2-9TJQKA][shdc])<\/Card>/g)).map(m => m[1]).join(' ');

                let seatInfo = tableCtx ? tableCtx.seats.get(seatNum) : null;
                if (seatInfo && cards) {
                    let cleanNick = seatInfo.cleanNick;
                    let currentBoard = tableCtx?.board?.join(' ') || '';
                    let currentHand = tableCtx?.currentHand || `h_${Date.now()}`;

                    sendServerEvent("HAND_SHOWDOWN_COMPLETED", {
                        hand_number: currentHand,
                        tournament_id: tableCtx?.tournId || "MTT",
                        uuid: seatInfo.uuid || `target_${cleanNick}`,
                        name: cleanNick,
                        cards: cards,
                        board: currentBoard,
                        actions: ["SHOWDOWN_REVEAL"]
                    });
                }
            }
        }

        // 10. Вылет игрока из турнира (Ranked)
        if (xml.includes('<TournamentPlayerRanked')) {
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
        }
    }

    // ── ФОНОВОЕ ОБНОВЛЕНИЕ И ТАЙМЕРЫ ─────────────────────────────────
    // Обновление сетки турниров в главном лобби (каждые 35 сек)
    setInterval(() => {
        let lobbyWs = stalkerState.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments type="REGULAR|GUARANTEED|FREEROLL" tournament="SCHEDULED|LIVE" games="TEXAS_6PLUS|OMAHA6PLUS|BADUGI|TEXAS_HOLDEM|OMAHA|OMAHA_HIGH_LOW|OMAHA5CARD|OMAHA5CARD_HIGH_LOW|OMAHA6CARD|OMAHA6CARD_HIGH_LOW|OMAHA7CARD|OMAHA7CARD_HIGH_LOW|OFC_PINEAPPLE_OH|JOKER_PINEAPPLE_OH" id="99999"/>');
            } catch(e) {}
        }
    }, 35000);

    // Отправка батчей статов на сервер (каждые 5 сек)
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
            a.download = `pokerdom_stalker_v16_1_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта базы: ' + e.message);
        }
    };

    // ── ПЕРЕХВАТЧИК СОКЕТОВ (DECODER + PROTOTYPE HOOK) ───────────────
    async function decodeSocketPayload(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            let buffer;
            if (data instanceof ArrayBuffer) {
                buffer = data;
            } else if (data instanceof Blob) {
                buffer = await data.arrayBuffer();
            } else if (ArrayBuffer.isView(data)) {
                buffer = data.buffer;
            } else {
                return String(data);
            }

            let uint8 = new Uint8Array(buffer);
            if (uint8.length > 2 && ((uint8[0] === 0x1f && uint8[1] === 0x8b) || (uint8[0] === 0x78))) {
                try {
                    let ds = new DecompressionStream(uint8[0] === 0x1f ? 'gzip' : 'deflate');
                    let stream = new Response(buffer).body.pipeThrough(ds);
                    return await new Response(stream).text();
                } catch(e) {}
            }
            return new TextDecoder('utf-8').decode(buffer);
        } catch(e) {
            return String(data);
        }
    }

    function hookSocketInstance(ws) {
        if (!ws || ws.__stalkerHookedV16) return;
        ws.__stalkerHookedV16 = true;

        ws.addEventListener('message', async function (e) {
            let text = await decodeSocketPayload(e.data);
            parseXmlStream(text, ws, 'IN');
        });
    }

    let OrigWS = window.WebSocket;
    if (OrigWS) {
        window.WebSocket = function (...args) {
            let ws = new OrigWS(...args);
            hookSocketInstance(ws);
            return ws;
        };
        window.WebSocket.prototype = OrigWS.prototype;

        let origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function (data) {
            hookSocketInstance(this);
            decodeSocketPayload(data).then(text => {
                parseXmlStream(text, this, 'OUT');
            });
            return origSend.apply(this, arguments);
        };
    }

    console.log("🎯 [VIP Scout v16.1 FLAWLESS] Полностью активирован и готов.");
})();

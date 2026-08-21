javascript:(function(){
    if (window.__pokerStalkerV17Active) {
        alert('🎯 VIP Stalker v17.2 ACTIVE SCOUT уже запущен!');
        return;
    }
    window.__pokerStalkerV17Active = true;

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
        auth: { sessionId: null, wssUrl: null, clientVersion: "71.0.138" },
        sockets: {
            lobby: null,
            tables: new Map()
        },
        liveTournaments: new Map(), // tId -> { id, name, status }
        activeTables: new Map(),    // tableId -> TableContext
        stalkedPlayers: new Map(),  // cleanNick -> PlayerProfile
        scannerQueue: [],
        isScanningActive: false
    };

    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.seats = new Map();
            this.currentHand = null;
            this.board = [];
            this.street = 'PREFLOP';
            this.currentBB = 500;
            this.activeSeatsInHand = new Set();
            this.playersActedThisHand = new Set();
        }

        resetHand(handNumber) {
            this.currentHand = handNumber;
            this.board = [];
            this.street = 'PREFLOP';
            this.activeSeatsInHand.clear();
            this.playersActedThisHand.clear();
        }
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    // Очистка никнейма от #2, #3 при ре-энтри
    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
    }

    // Безопасный поиск атрибута в XML
    function getAttr(tagStr, attrName) {
        let m = tagStr.match(new RegExp(`(?:\\b|\\s)${attrName}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
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
    ui.id = 'stalker-hud-v17';
    ui.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:94vw;max-width:420px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #38bdf8;box-shadow:0 12px 40px rgba(0,0,0,0.9);backdrop-filter:blur(10px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#38bdf8;font-size:12px;">🌀</span>
                <strong style="color:#38bdf8;font-size:12px;" id="st-hud-title">ACTIVE SCOUT v17.2</strong>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-force-scan" style="background:#0284c7;border:none;color:#fff;cursor:pointer;font-size:10px;padding:2px 6px;border-radius:4px;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#38bdf8;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v17').remove();window.__pokerStalkerV17Active=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Авто-краулер: <b id="st-scanner-state" style="color:#38bdf8;">Поиск сокета лобби...</b></span>
                    <span id="st-scan-status" style="color:#4ade80;">В сети</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Живых турниров: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 31</b></span>
                </div>
            </div>

            <div id="st-targets-list" style="max-height:220px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Ожидание данных лобби...
            </div>

            <button id="btn-export-db" style="width:100%;padding:7px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;">
                📥 Экспорт базы данных (JSON)
            </button>
        </div>
    `;
    document.body.appendChild(ui);

    document.getElementById('btn-toggle-hud').onclick = function() {
        stalkerState.isCollapsed = !stalkerState.isCollapsed;
        let body = document.getElementById('st-hud-body');
        let btn = document.getElementById('btn-toggle-hud');
        if (stalkerState.isCollapsed) {
            body.style.display = 'none';
            btn.innerText = '▴';
        } else {
            body.style.display = 'block';
            btn.innerText = '▾';
        }
    };

    // Принудительный скан по кнопке
    document.getElementById('btn-force-scan').onclick = function() {
        stalkerState.liveTournaments.forEach((t, tId) => {
            if (!stalkerState.scannerQueue.includes(tId)) {
                stalkerState.scannerQueue.push(tId);
            }
        });
        triggerLobbyTournamentRefresh();
        processScannerQueue();
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

    // ── ФОНОВЫЙ АВТО-КРАУЛЕР ТУРНИРОВ (BACKGROUND CRAWLER) ────────────
    function triggerLobbyTournamentRefresh() {
        let lobbyWs = stalkerState.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments type="REGULAR|GUARANTEED|FREEROLL" tournament="SCHEDULED|LIVE" games="TEXAS_6PLUS|OMAHA6PLUS|BADUGI|TEXAS_HOLDEM|OMAHA|OMAHA_HIGH_LOW|OMAHA5CARD|OMAHA5CARD_HIGH_LOW|OMAHA6CARD|OMAHA6CARD_HIGH_LOW|OMAHA7CARD|OMAHA7CARD_HIGH_LOW|OFC_PINEAPPLE_OH|JOKER_PINEAPPLE_OH" id="99999"/>');
                let st = document.getElementById('st-scanner-state');
                if (st) st.innerText = 'Запрос списка турниров...';
            } catch(e) {}
        }
    }

    async function processScannerQueue() {
        if (stalkerState.isScanningActive || stalkerState.scannerQueue.length === 0) return;
        if (!stalkerState.auth.sessionId || !stalkerState.auth.wssUrl) return;

        stalkerState.isScanningActive = true;
        let st = document.getElementById('st-scanner-state');
        if (st) st.innerText = `Скан: ${stalkerState.scannerQueue.length} в очереди`;

        while (stalkerState.scannerQueue.length > 0) {
            let chunk = stalkerState.scannerQueue.splice(0, 3);
            await Promise.all(chunk.map(tId => scanSingleTournamentBackground(tId)));
            if (st) st.innerText = `Осталось: ${stalkerState.scannerQueue.length}`;
        }

        stalkerState.isScanningActive = false;
        if (st) st.innerText = 'Скан завершен';
        updateHUD();
    }

    function scanSingleTournamentBackground(tournId) {
        return new Promise((resolve) => {
            let tourn = stalkerState.liveTournaments.get(tournId);
            let wsUrl = stalkerState.auth.wssUrl;
            let sid = stalkerState.auth.sessionId;
            if (!tourn || !wsUrl || !sid) return resolve();

            let bgWs = new OrigWS(wsUrl);
            let finished = false;
            let currentBB = 500;

            function cleanup() {
                if (!finished) {
                    finished = true;
                    try { bgWs.close(); } catch(e) {}
                    resolve();
                }
            }

            setTimeout(cleanup, 8000);

            bgWs.onopen = function() {
                bgWs.send(`<EnterTournamentLobby id="${tournId}" sessionId="${sid}" client="html5mobile" clientFace="pokerdom" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                bgWs.send('<GetSchedule/>');
                bgWs.send('<GetPlayers offset="0" count="50"/>');
            };

            bgWs.onmessage = async function(e) {
                let text = await decodeSocketPayload(e.data);
                if (!text) return;

                // Парсинг блайндов
                if (text.includes('<Schedule')) {
                    let curLvl = getAttr(text, 'currentLevel');
                    let items = text.matchAll(/<Item\s+([^>]+)>/g);
                    for (let im of items) {
                        let num = getAttr(im[1], 'number');
                        let hs = getAttr(im[1], 'highStake');
                        if (num === curLvl && hs) {
                            currentBB = parseInt(hs);
                            break;
                        }
                    }
                }

                // Парсинг игроков и проверка целей
                if (text.includes('<Players')) {
                    let offset = parseInt(getAttr(text, 'offset') || '0');
                    let total = parseInt(getAttr(text, 'total') || '0');
                    let playerBlocks = text.matchAll(/<Player\s+([^>]+)>/g);
                    let countInChunk = 0;

                    for (let pb of playerBlocks) {
                        countInChunk++;
                        let attrs = pb[1];
                        let rawNick = getAttr(attrs, 'nickname');
                        let cleanNick = getCleanNick(rawNick);

                        if (TARGET_WATCHLIST.has(cleanNick)) {
                            let stack = parseInt(getAttr(attrs, 'stack') || '0');
                            let rank = parseInt(getAttr(attrs, 'rank') || '0');
                            let place = parseInt(getAttr(attrs, 'placeFrom') || '0');
                            let prize = parseFloat(getAttr(attrs, 'prizeAmount') || '0');
                            let uuid = getAttr(attrs, 'uuid') || `target_${cleanNick}`;
                            let isBusted = (place > 0 || (stack === 0 && !attrs.includes('tableId')));
                            let stackBB = stack / currentBB;

                            let p = getOrCreatePlayerProfile(cleanNick);
                            let existingEntry = p.entries.get(rawNick);
                            let isNewEntry = !existingEntry;
                            let statusChanged = existingEntry && (existingEntry.isBusted !== isBusted);

                            p.entries.set(rawNick, {
                                rawNick: rawNick,
                                cleanNick: cleanNick,
                                uuid: uuid,
                                stack: stack,
                                stackBB: stackBB,
                                rank: rank,
                                place: place,
                                prize: prize,
                                isBusted: isBusted,
                                tableName: tourn.name,
                                tournId: tournId
                            });

                            // Отправляем событие только при новом обнаружении или смене статуса (вылет)
                            if (isNewEntry || statusChanged) {
                                sendServerEvent(isBusted ? "TARGET_PLAYER_BUSTED" : "TARGET_PLAYER_DISCOVERED", {
                                    uuid: uuid,
                                    name: cleanNick,
                                    raw_nick: rawNick,
                                    tournament_id: tournId,
                                    tournament_name: tourn.name,
                                    chips: stack,
                                    stack_bb: stackBB,
                                    place: place,
                                    prize: prize
                                });
                            }

                            updateHUD();
                        }
                    }

                    if (total > (offset + countInChunk) && countInChunk > 0) {
                        try {
                            bgWs.send(`<GetPlayers offset="${offset + countInChunk}" count="50"/>`);
                        } catch(e) { cleanup(); }
                    } else {
                        cleanup();
                    }
                }
            };

            bgWs.onerror = cleanup;
            bgWs.onclose = cleanup;
        });
    }

    // ── ОСНОВНОЙ ПАРСЕР ПОТОКА КЛИЕНТА ───────────────────────────────
    function parseXmlStream(xml, ws, dir = 'IN') {
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        // Перехват sessionId
        let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
        if (sessMatch) {
            let wasEmpty = !stalkerState.auth.sessionId;
            stalkerState.auth.sessionId = sessMatch[1];
            if (wasEmpty && stalkerState.sockets.lobby) {
                triggerLobbyTournamentRefresh();
            }
        }

        // Исходящие команды
        if (dir === 'OUT') {
            if (xml.includes('<EnterTable')) {
                let tableId = getAttr(xml, 'tableId');
                let tournId = getAttr(xml, 'tournamentId');
                if (tableId) {
                    ws.__tableId = tableId;
                    ws.__tableContext = new TableContext(tableId, tournId);
                    stalkerState.activeTables.set(tableId, ws.__tableContext);
                    stalkerState.sockets.tables.set(tableId, ws);
                }
            }
            return;
        }

        // ── ВХОДЯЩИЕ СООБЩЕНИЯ (IN) ──────────────────────────────────

        // 1. Главное лобби (WS#1)
        if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
            ws.__socketType = 'LOBBY';
            let firstTime = !stalkerState.sockets.lobby;
            stalkerState.sockets.lobby = ws;
            if (firstTime && stalkerState.auth.sessionId) {
                triggerLobbyTournamentRefresh();
            }
        }

        // 2. Парсинг турнирной сетки лобби + Динамическое наполнение очереди
        if (xml.includes('<Tournaments')) {
            let matches = xml.matchAll(/<Table\s+([^>]+)>/g);

            for (let m of matches) {
                let attrs = m[1];
                let tId = getAttr(attrs, 'id');
                let tName = getAttr(attrs, 'name');
                let tStatus = getAttr(attrs, 'status');

                if (tId && (tStatus === 'RUNNING' || tStatus === 'LATE_REG' || tStatus === 'LATE_REGISTRATION' || tStatus === 'SEATING' || tStatus === 'REGISTERING')) {
                    stalkerState.liveTournaments.set(tId, {
                        id: tId,
                        name: decodeHtml(tName) || 'MTT',
                        status: tStatus
                    });

                    // Добавляем в очередь без дублирования
                    if (!stalkerState.scannerQueue.includes(tId)) {
                        stalkerState.scannerQueue.push(tId);
                    }
                } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED')) {
                    stalkerState.liveTournaments.delete(tId);
                    let qIdx = stalkerState.scannerQueue.indexOf(tId);
                    if (qIdx !== -1) stalkerState.scannerQueue.splice(qIdx, 1);
                }
            }

            processScannerQueue();
            updateHUD();
        }

        // 3. Привязка контекста стола (WS#3)
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
            let tableId = getAttr(xml, 'id') || getAttr(xml, 'tableId');
            let tournId = getAttr(xml, 'tournamentId');
            if (tableId) {
                ws.__tableId = tableId;
                if (!ws.__tableContext) {
                    ws.__tableContext = new TableContext(tableId, tournId);
                }
                stalkerState.activeTables.set(tableId, ws.__tableContext);
                stalkerState.sockets.tables.set(tableId, ws);
            }
        }

        // 4. Обработка стола через жестко привязанный контекст сокета
        let tableCtx = ws.__tableContext;
        if (!tableCtx) return;

        // Seat Cache
        if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
            let seatBlocks = xml.matchAll(/<Seat\s+([^>]*\bid="(\d+)"[^>]*)>(.*?)<\/Seat>/gs);
            for (let sb of seatBlocks) {
                let seatNum = parseInt(sb[2]);
                let seatContent = sb[3];

                let rawNick = getAttr(seatContent, 'nickname');
                let uuid = getAttr(seatContent, 'uuid');
                let stackM = seatContent.match(/stack-size="([^"]+)"/);
                let stack = stackM ? parseInt(stackM[1]) : 0;

                if (rawNick) {
                    let cleanNick = getCleanNick(rawNick);
                    tableCtx.seats.set(seatNum, {
                        rawNick: rawNick,
                        cleanNick: cleanNick,
                        uuid: uuid || `u_${cleanNick}`,
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

        // Жизненный цикл раздачи
        if (xml.includes('<Message>') || xml.includes('<GameState')) {
            let hs = getAttr(xml, 'highStake');
            if (hs) tableCtx.currentBB = parseInt(hs);

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
                            getOrCreatePlayerProfile(seatInfo.cleanNick).handsCount++;
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

        // Шоудаун и Muck Leak
        if (xml.includes('<Show') || xml.includes('<Muck>')) {
            let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
            for (let sm of showMatches) {
                let seatNum = parseInt(sm[1]);
                let cardsRaw = sm[2];
                let cards = Array.from(cardsRaw.matchAll(/<Card[^>]*>([2-9TJQKA][shdc])<\/Card>/g)).map(m => m[1]).join(' ');
                let seatInfo = tableCtx.seats.get(seatNum);

                if (seatInfo && cards) {
                    sendServerEvent("HAND_SHOWDOWN_COMPLETED", {
                        hand_number: tableCtx.currentHand || `h_${Date.now()}`,
                        tournament_id: tableCtx.tournId || "MTT",
                        uuid: seatInfo.uuid || `target_${seatInfo.cleanNick}`,
                        name: seatInfo.cleanNick,
                        cards: cards,
                        board: tableCtx.board.join(' '),
                        actions: ["SHOWDOWN_REVEAL"]
                    });
                }
            }
        }
    }

    // Автообновление лобби каждые 60 секунд (перескан поздней реги)
    setInterval(triggerLobbyTournamentRefresh, 60000);
    // Отправка батчей статов каждые 5 секунд
    setInterval(sendHudBatch, 5000);

    // Экспорт базы
    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let res = await fetch(`${scoutServerUrl}/api/get_export_json`);
            if (!res.ok) throw new Error("HTTP " + res.status);
            let data = await res.json();
            let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_active_scout_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
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

    function hookSocketInstance(ws, explicitUrl) {
        if (!ws || ws.__stalkerHookedV17) return;
        ws.__stalkerHookedV17 = true;

        let targetUrl = explicitUrl || ws.url || ws._url;
        if (targetUrl && typeof targetUrl === 'string' && (targetUrl.includes('/ws') || targetUrl.startsWith('ws'))) {
            stalkerState.auth.wssUrl = targetUrl;
        }

        ws.addEventListener('message', async function (e) {
            let text = await decodeSocketPayload(e.data);
            parseXmlStream(text, ws, 'IN');
        });

        ws.addEventListener('close', function() {
            if (ws.__tableId) {
                stalkerState.activeTables.delete(ws.__tableId);
                stalkerState.sockets.tables.delete(ws.__tableId);
            }
        });
    }

    var OrigWS = window.WebSocket;
    if (OrigWS) {
        window.WebSocket = function (url, ...args) {
            let ws = new OrigWS(url, ...args);
            hookSocketInstance(ws, url);
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

    console.log("🎯 [VIP Scout v17.2 ULTIMATE AUTO-SCOUT] Полностью готов к работе.");
})();

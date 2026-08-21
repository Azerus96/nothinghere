javascript:(function(){
    if (window.__pokerStalkerV18Pro) {
        alert('🎯 VIP Stalker v18.1 PRO EXPLOIT ENGINE уже запущен!');
        return;
    }
    window.__pokerStalkerV18Pro = true;

    const scoutServerUrl = "https://toofunoff-poker-scout.hf.space";

    // 32 ЦЕЛЕВЫХ ИГРОКА
    const TARGET_WATCHLIST = new Set([
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha",
        "saiyn_belek", "malyavka89"
    ].map(n => n.toLowerCase()));

    const stalkerState = {
        isCollapsed: false,
        hfStatus: 'Проверка...',
        outboxQueue: [],
        auth: { sessionId: null, wssUrl: null, clientVersion: "71.0.138" },
        sockets: {
            lobby: null,
            tables: new Map()
        },
        liveTournaments: new Map(),
        activeTables: new Map(),
        stalkedPlayers: new Map(),
        scannerQueue: [],
        isScanningActive: false
    };

    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.seats = new Map();
            this.seatActions = new Map(); // seatId -> ['PREFLOP_RAISE', 'FLOP_BET', ...]
            this.currentHand = null;
            this.board = [];
            this.street = 'PREFLOP';
            this.currentBB = 500;
            this.activeSeatsInHand = new Set();
            this.playersActedThisHand = new Set();
            this.preflopStealFaced = new Set();
        }

        resetHand(handNumber) {
            this.currentHand = handNumber;
            this.board = [];
            this.street = 'PREFLOP';
            this.activeSeatsInHand.clear();
            this.playersActedThisHand.clear();
            this.preflopStealFaced.clear();
            this.seatActions.clear();
        }

        recordAction(seatId, actionName) {
            let list = this.seatActions.get(seatId) || [];
            list.push(`${this.street}_${actionName}`);
            this.seatActions.set(seatId, list);
        }

        getActionsForSeat(seatId) {
            return this.seatActions.get(seatId) || ['SHOWDOWN'];
        }
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
    }

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
                totalActions: 0,
                foldBBCount: 0,
                stealFacedBB: 0,
                foldSBCount: 0,
                stealFacedSB: 0
            });
        }
        return stalkerState.stalkedPlayers.get(cleanNick);
    }

    // ── ГАРАНТИРОВАННАЯ ДОСТАВКА В ОБЛАКО ─────────────────────────────
    function queueServerEvent(type, payload) {
        stalkerState.outboxQueue.push({ type: type, payload: payload, timestamp: Date.now() });
        processOutboxQueue();
    }

    let isFlushingQueue = false;
    async function processOutboxQueue() {
        if (isFlushingQueue || stalkerState.outboxQueue.length === 0) return;
        isFlushingQueue = true;

        while (stalkerState.outboxQueue.length > 0) {
            let item = stalkerState.outboxQueue[0];
            try {
                let res = await fetch(`${scoutServerUrl}/api/scout_event`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: item.type, payload: item.payload })
                });

                if (res.ok) {
                    stalkerState.outboxQueue.shift();
                    stalkerState.hfStatus = 'Онлайн';
                } else {
                    stalkerState.hfStatus = `HTTP ${res.status}`;
                    break;
                }
            } catch (e) {
                stalkerState.hfStatus = 'Офлайн / Буфер';
                break;
            }
        }

        isFlushingQueue = false;
        updateHfIndicator();
    }

    async function sendHudBatch() {
        let profiles = [];
        stalkerState.stalkedPlayers.forEach(p => {
            if (p.handsCount > 0) {
                let vpip = (p.vpipCount / p.handsCount) * 100;
                let pfr = (p.pfrCount / p.handsCount) * 100;
                let afq = p.totalActions > 0 ? (p.aggressiveActions / p.totalActions) * 100 : 0;
                let fold_bb_steal = p.stealFacedBB > 0 ? (p.foldBBCount / p.stealFacedBB) * 100 : 60.0;
                let fold_sb_steal = p.stealFacedSB > 0 ? (p.foldSBCount / p.stealFacedSB) * 100 : 75.0;

                profiles.push({
                    uuid: `target_${p.cleanNick}`,
                    name: p.cleanNick,
                    hands: p.handsCount,
                    vpip: parseFloat(vpip.toFixed(1)),
                    pfr: parseFloat(pfr.toFixed(1)),
                    afq: parseFloat(afq.toFixed(1)),
                    fold_bb_steal: parseFloat(fold_bb_steal.toFixed(1)),
                    fold_sb_steal: parseFloat(fold_sb_steal.toFixed(1))
                });
            }
        });

        if (profiles.length > 0) {
            try {
                let res = await fetch(`${scoutServerUrl}/api/save_hud_batch`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profiles: profiles })
                });
                if (res.ok) stalkerState.hfStatus = 'Онлайн';
            } catch(e) {
                stalkerState.hfStatus = 'Офлайн / Буфер';
            }
            updateHfIndicator();
        }
    }

    function updateHfIndicator() {
        let el = document.getElementById('st-hf-status');
        if (!el) return;
        let queueLen = stalkerState.outboxQueue.length;
        let queueStr = queueLen > 0 ? ` (Буфер: ${queueLen})` : '';

        if (stalkerState.hfStatus === 'Онлайн') {
            el.innerHTML = `<span style="color:#4ade80;">HF: ● Онлайн${queueStr}</span>`;
        } else {
            el.innerHTML = `<span style="color:#f87171;">HF: ○ ${stalkerState.hfStatus}${queueStr}</span>`;
        }
    }

    // ── ИНТЕРФЕЙС HUD ────────────────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud-v18';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:430px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #6366f1;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#818cf8;font-size:12px;">⚡</span>
                <strong style="color:#818cf8;font-size:12px;" id="st-hud-title">VIP STALKER PRO v18.1</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-force-scan" style="background:#4f46e5;border:none;color:#fff;cursor:pointer;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#818cf8;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v18').remove();window.__pokerStalkerV18Pro=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Краулер: <b id="st-scanner-state" style="color:#38bdf8;">Запуск...</b></span>
                    <span id="st-scan-status" style="color:#4ade80;">Multi-Socket V18.1</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Идущих турниров: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 32</b></span>
                </div>
            </div>

            <div id="st-targets-list" style="max-height:230px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Ожидание данных лобби...
            </div>

            <button id="btn-export-db" style="width:100%;padding:8px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;box-shadow:0 4px 12px rgba(79,70,229,0.4);">
                📥 Экспорт полного досье в JSON
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
                let vpipStr = p.handsCount > 0 ? `<small style="color:#c084fc;">[H:${p.handsCount} V:${vpip}% P:${pfr}% AF:${afq}%]</small>` : '';

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

    function triggerLobbyTournamentRefresh() {
        let lobbyWs = stalkerState.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments type="REGULAR|GUARANTEED|FREEROLL" tournament="SCHEDULED|LIVE" games="TEXAS_6PLUS|OMAHA6PLUS|BADUGI|TEXAS_HOLDEM|OMAHA|OMAHA_HIGH_LOW|OMAHA5CARD|OMAHA5CARD_HIGH_LOW|OMAHA6CARD|OMAHA6CARD_HIGH_LOW|OMAHA7CARD|OMAHA7CARD_HIGH_LOW|OFC_PINEAPPLE_OH|JOKER_PINEAPPLE_OH" id="99999"/>');
                let st = document.getElementById('st-scanner-state');
                if (st) st.innerText = 'Обновление турниров...';
            } catch(e) {}
        }
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function processScannerQueue() {
        if (stalkerState.isScanningActive || stalkerState.scannerQueue.length === 0) return;
        if (!stalkerState.auth.sessionId || !stalkerState.auth.wssUrl) return;

        stalkerState.isScanningActive = true;
        let st = document.getElementById('st-scanner-state');
        if (st) st.innerText = `Скан: ${stalkerState.scannerQueue.length} в очереди`;

        while (stalkerState.scannerQueue.length > 0) {
            let chunk = stalkerState.scannerQueue.splice(0, 2);
            await Promise.all(chunk.map(tId => scanSingleTournamentBackground(tId)));
            if (st) st.innerText = `Осталось: ${stalkerState.scannerQueue.length}`;
            await sleep(150);
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
            let currentLevel = 1;
            let levelMap = new Map();
            let currentBB = tourn.currentBB || 500;

            function cleanup() {
                if (!finished) {
                    finished = true;
                    try { bgWs.close(); } catch(e) {}
                    resolve();
                }
            }

            setTimeout(cleanup, 7000);

            bgWs.onopen = function() {
                bgWs.send(`<EnterTournamentLobby id="${tournId}" sessionId="${sid}" client="html5mobile" clientFace="pokerdom" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                bgWs.send('<GetSchedule/>');
                bgWs.send('<GetPlayers offset="0" count="50"/>');
            };

            bgWs.onmessage = async function(e) {
                let text = await decodeSocketPayload(e.data);
                if (!text) return;

                if (text.includes('<TournamentDetails')) {
                    let lvl = getAttr(text, 'currentLevel');
                    if (lvl) currentLevel = parseInt(lvl);
                    let hsDirect = getAttr(text, 'highStake');
                    if (hsDirect) {
                        currentBB = parseInt(hsDirect);
                        tourn.currentBB = currentBB;
                    }
                }

                if (text.includes('<Schedule')) {
                    let items = text.matchAll(/<Item\s+([^>]+)>/g);
                    for (let im of items) {
                        let num = parseInt(getAttr(im[1], 'number') || '0');
                        let hs = parseInt(getAttr(im[1], 'highStake') || '0');
                        if (num > 0 && hs > 0) {
                            levelMap.set(num, hs);
                        }
                    }
                }

                if (levelMap.has(currentLevel)) {
                    currentBB = levelMap.get(currentLevel);
                    tourn.currentBB = currentBB;
                }

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
                            let place = parseInt(getAttr(attrs, 'placeFrom') || getAttr(attrs, 'place') || '0');
                            let prize = parseFloat(getAttr(attrs, 'prizeAmount') || '0');
                            let uuid = getAttr(attrs, 'uuid') || `target_${cleanNick}`;
                            
                            let isBusted = (place > 0);
                            let stackBB = currentBB > 0 ? (stack / currentBB) : 0;

                            let p = getOrCreatePlayerProfile(cleanNick);
                            let entryKey = `${tournId}_${rawNick}`;
                            let existingEntry = p.entries.get(entryKey);
                            let isNewEntry = !existingEntry;
                            let statusChanged = existingEntry && (existingEntry.isBusted !== isBusted);

                            p.entries.set(entryKey, {
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

                            if (isNewEntry || statusChanged) {
                                queueServerEvent(isBusted ? "TARGET_PLAYER_BUSTED" : "TARGET_PLAYER_DISCOVERED", {
                                    uuid: uuid,
                                    name: cleanNick,
                                    raw_nick: rawNick,
                                    tournament_id: tournId,
                                    tournament_name: tourn.name,
                                    chips: stack,
                                    stack_bb: stackBB,
                                    place: place,
                                    prize: prize,
                                    is_busted: isBusted
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

        let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
        if (sessMatch) {
            let wasEmpty = !stalkerState.auth.sessionId;
            stalkerState.auth.sessionId = sessMatch[1];
            if (wasEmpty && stalkerState.sockets.lobby) {
                triggerLobbyTournamentRefresh();
            }
        }

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

        // 1. Главное лобби
        if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
            ws.__socketType = 'LOBBY';
            let firstTime = !stalkerState.sockets.lobby;
            stalkerState.sockets.lobby = ws;
            if (firstTime && stalkerState.auth.sessionId) {
                triggerLobbyTournamentRefresh();
            }
        }

        // 2. Сетка турниров
        if (xml.includes('<Tournaments')) {
            let matches = xml.matchAll(/<Table\s+([^>]+)>/g);

            for (let m of matches) {
                let attrs = m[1];
                let tId = getAttr(attrs, 'id');
                let tName = getAttr(attrs, 'name');
                let tStatus = getAttr(attrs, 'status');

                if (tId && (tStatus === 'RUNNING' || tStatus === 'LATE_REG' || tStatus === 'LATE_REGISTRATION' || tStatus === 'SEATING')) {
                    stalkerState.liveTournaments.set(tId, {
                        id: tId,
                        name: decodeHtml(tName) || 'MTT',
                        status: tStatus,
                        currentBB: 500
                    });

                    if (!stalkerState.scannerQueue.includes(tId)) {
                        stalkerState.scannerQueue.push(tId);
                    }
                } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED' || tStatus === 'REGISTERING' || tStatus === 'ANNOUNCED')) {
                    stalkerState.liveTournaments.delete(tId);
                    let qIdx = stalkerState.scannerQueue.indexOf(tId);
                    if (qIdx !== -1) stalkerState.scannerQueue.splice(qIdx, 1);
                }
            }

            processScannerQueue();
            updateHUD();
        }

        // 3. Контекст стола
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
                        let entryKey = `${tableCtx.tournId || tableCtx.tableId}_${rawNick}`;
                        let entry = p.entries.get(entryKey) || {
                            rawNick: rawNick,
                            cleanNick: cleanNick,
                            tableName: tableCtx.tournId ? stalkerState.liveTournaments.get(tableCtx.tournId)?.name : 'Table'
                        };
                        entry.stack = stack;
                        entry.stackBB = stack / (tableCtx.currentBB || 500);
                        entry.tournId = tableCtx.tournId;
                        entry.isBusted = false;
                        p.entries.set(entryKey, entry);
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
                tableCtx.board = Array.from(flopMatch[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
            }
            let turnMatch = xml.match(/<DealingTurn><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingTurn>/i);
            if (turnMatch) {
                tableCtx.street = 'TURN';
                tableCtx.board.push(turnMatch[1] + turnMatch[2]);
            }
            let riverMatch = xml.match(/<DealingRiver><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingRiver>/i);
            if (riverMatch) {
                tableCtx.street = 'RIVER';
                tableCtx.board.push(riverMatch[1] + riverMatch[2]);
            }

            // Действия игроков с фиксацией в seatActions
            let playerActions = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*>(.*?)<\/PlayerAction>/gs);
            for (let pa of playerActions) {
                let seatNum = parseInt(pa[1]);
                let actionBody = pa[2];
                let seatInfo = tableCtx.seats.get(seatNum);

                let actName = actionBody.includes('<Call') ? 'CALL' :
                              actionBody.includes('<Raise') ? 'RAISE' :
                              actionBody.includes('<Bet') ? 'BET' :
                              actionBody.includes('<Check') ? 'CHECK' :
                              actionBody.includes('<Fold') ? 'FOLD' :
                              actionBody.includes('<AllIn') ? 'ALLIN' : 'ACTION';
                
                tableCtx.recordAction(seatNum, actName);

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
                        if (isPreflop && actionBody.includes('<Fold')) {
                            p.stealFacedBB++;
                            p.foldBBCount++;
                        }
                    }
                }
            }
        }

        // Шоудаун и Muck Leak с реальной историей действий
        if (xml.includes('<Show') || xml.includes('<Muck>')) {
            let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
            for (let sm of showMatches) {
                let seatNum = parseInt(sm[1]);
                let cardsRaw = sm[2];
                let cards = Array.from(cardsRaw.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]).join(' ');
                let seatInfo = tableCtx.seats.get(seatNum);

                if (seatInfo && cards) {
                    let actionsList = tableCtx.getActionsForSeat(seatNum);
                    queueServerEvent("HAND_SHOWDOWN_COMPLETED", {
                        hand_number: tableCtx.currentHand || `h_${Date.now()}`,
                        tournament_id: tableCtx.tournId || "MTT",
                        uuid: seatInfo.uuid || `target_${seatInfo.cleanNick}`,
                        name: seatInfo.cleanNick,
                        cards: cards,
                        board: tableCtx.board.join(' '),
                        actions: actionsList
                    });
                }
            }
        }
    }

    setInterval(triggerLobbyTournamentRefresh, 60000);
    setInterval(sendHudBatch, 5000);
    setInterval(processOutboxQueue, 4000);

    // ── ГИБРИДНЫЙ ЭКСПОРТ ─────────────────────────────────────────────
    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let exportData = {
                timestamp: new Date().toISOString(),
                targetsCount: stalkerState.stalkedPlayers.size,
                liveTournamentsCount: stalkerState.liveTournaments.size,
                outboxQueueLength: stalkerState.outboxQueue.length,
                players: {}
            };

            stalkerState.stalkedPlayers.forEach((p, cleanNick) => {
                exportData.players[cleanNick] = {
                    cleanNick: p.cleanNick,
                    handsCount: p.handsCount,
                    vpip: p.handsCount > 0 ? parseFloat(((p.vpipCount / p.handsCount) * 100).toFixed(1)) : 0,
                    pfr: p.handsCount > 0 ? parseFloat(((p.pfrCount / p.handsCount) * 100).toFixed(1)) : 0,
                    entries: Array.from(p.entries.values())
                };
            });

            try {
                let res = await fetch(`${scoutServerUrl}/api/get_export_json`);
                if (res.ok) {
                    exportData.serverBackup = await res.json();
                }
            } catch(e) {}

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_pro_dossier_${Date.now()}.json`;
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
        if (!ws || ws.__stalkerHookedV18) return;
        ws.__stalkerHookedV18 = true;

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

    console.log("🎯 [VIP Scout v18.1 PRO EXPLOIT ENGINE] Полностью готов к работе.");
})();

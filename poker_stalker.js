javascript:(function(){
    if (window.__pokerStalkerV19Ultra) {
        alert('🎯 VIP Stalker v19.0 ULTRA RAW TELEMETRY уже запущен!');
        return;
    }
    window.__pokerStalkerV19Ultra = true;

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

    function autoDetectSessionId() {
        if (stalkerState.auth.sessionId) return stalkerState.auth.sessionId;
        try {
            for (let storage of [sessionStorage, localStorage]) {
                for (let i = 0; i < storage.length; i++) {
                    let k = storage.key(i);
                    let v = storage.getItem(k);
                    if (v && typeof v === 'string' && /^[a-f0-9]{16}-[a-f0-9]{16}$/i.test(v.trim())) {
                        stalkerState.auth.sessionId = v.trim();
                        return stalkerState.auth.sessionId;
                    }
                }
            }
        } catch(e) {}
        return null;
    }
    autoDetectSessionId();

    // Расчет точных покерных позиций (BTN, SB, BB, UTG, CO...)
    function calculatePositions(activeSeatsList, dealerSeatNum) {
        let seats = [...activeSeatsList].sort((a, b) => a - b);
        let n = seats.length;
        if (n === 0) return {};
        let dIdx = seats.indexOf(dealerSeatNum);
        if (dIdx === -1) dIdx = 0;

        let ordered = [];
        for (let i = 0; i < n; i++) {
            ordered.push(seats[(dIdx + i) % n]);
        }

        let posMap = {};
        if (n === 2) {
            posMap[ordered[0]] = 'BTN/SB';
            posMap[ordered[1]] = 'BB';
        } else if (n === 3) {
            posMap[ordered[0]] = 'BTN';
            posMap[ordered[1]] = 'SB';
            posMap[ordered[2]] = 'BB';
        } else {
            posMap[ordered[0]] = 'BTN';
            posMap[ordered[1]] = 'SB';
            posMap[ordered[2]] = 'BB';
            let remaining = n - 3;
            let standardPos = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
            for (let i = 0; i < remaining; i++) {
                let seat = ordered[3 + i];
                if (i === remaining - 1) {
                    posMap[seat] = 'CO';
                } else if (i < standardPos.length) {
                    posMap[seat] = standardPos[i];
                } else {
                    posMap[seat] = `MP+${i}`;
                }
            }
        }
        return posMap;
    }

    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.seats = new Map(); // seatNum -> { rawNick, cleanNick, uuid, stack, stackStart }
            this.seatActions = new Map(); // seatNum -> Array of action records
            this.sittingOutSeats = new Set();
            this.currentHand = null;
            this.board = [];
            this.street = 'PREFLOP';
            this.dealerSeat = 0;
            this.currentSB = 250;
            this.currentBB = 500;
            this.currentAnte = 0;
            this.potTotal = 0;
            this.potOnFlop = 0;
            this.potOnTurn = 0;
            this.potOnRiver = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
            this.activeSeatsInHand = new Set();
            this.positionsMap = {};
            this.playersActedThisHand = new Set();
        }

        resetHand(handNumber, dealerSeat) {
            this.currentHand = handNumber;
            this.dealerSeat = dealerSeat || 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.potTotal = 0;
            this.potOnFlop = 0;
            this.potOnTurn = 0;
            this.potOnRiver = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
            this.activeSeatsInHand.clear();
            this.playersActedThisHand.clear();
            this.seatActions.clear();

            // Сохраняем начальные стеки игроков на начало руки
            this.seats.forEach(s => {
                s.stackStart = s.stack || 0;
            });
        }

        recordAction(seatId, actionType, amount = 0) {
            let potBefore = this.potTotal;
            let potPct = potBefore > 0 && amount > 0 ? Math.round((amount / potBefore) * 100) : 0;
            let pctStr = potPct > 0 ? `(${potPct}%pot)` : '';
            let amtStr = amount > 0 ? `:${amount}${pctStr}` : '';

            let list = this.seatActions.get(seatId) || [];
            list.push(`${this.street}_${actionType}${amtStr}`);
            this.seatActions.set(seatId, list);

            if (amount > 0) {
                this.potTotal += amount;
            }
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

    // ── ГАРАНТИРОВАННАЯ ДОСТАВКА В ОБЛАКО (/SCOUT_API/) ───────────────
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
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 3000);

                let res = await fetch(`${scoutServerUrl}/scout_api/event`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: item.type, payload: item.payload }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

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
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 3000);

                let res = await fetch(`${scoutServerUrl}/scout_api/hud_batch`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profiles: profiles }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

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
    ui.id = 'stalker-hud-v19';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:430px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #6366f1;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#818cf8;font-size:12px;">⚡</span>
                <strong style="color:#818cf8;font-size:12px;" id="st-hud-title">VIP STALKER v19.0 ULTRA</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-force-scan" style="background:#4f46e5;border:none;color:#fff;cursor:pointer;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#818cf8;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v19').remove();window.__pokerStalkerV19Ultra=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Краулер: <b id="st-scanner-state" style="color:#38bdf8;">Запуск...</b></span>
                    <span id="st-scan-status" style="color:#4ade80;">Ultra-Telemetry V19</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Холдем-турниров: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
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
        autoDetectSessionId();
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

    // ── ФОНОВЫЙ КРАУЛЕР ──────────────────────────────────────────────
    function triggerLobbyTournamentRefresh() {
        let lobbyWs = stalkerState.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments type="REGULAR|GUARANTEED|FREEROLL" tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM|TEXAS_6PLUS" id="99999"/>');
                let st = document.getElementById('st-scanner-state');
                if (st) st.innerText = 'Обновление Холдем-сетки...';
            } catch(e) {}
        }
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function processScannerQueue() {
        if (stalkerState.isScanningActive || stalkerState.scannerQueue.length === 0) return;
        autoDetectSessionId();
        if (!stalkerState.auth.sessionId || !stalkerState.auth.wssUrl) return;

        stalkerState.isScanningActive = true;
        let st = document.getElementById('st-scanner-state');
        if (st) st.innerText = `Скан: ${stalkerState.scannerQueue.length} в очереди`;

        while (stalkerState.scannerQueue.length > 0) {
            let tId = stalkerState.scannerQueue.shift();
            await scanSingleTournamentBackground(tId);
            if (st) st.innerText = `Осталось: ${stalkerState.scannerQueue.length}`;
            await sleep(350);
        }

        stalkerState.isScanningActive = false;
        if (st) st.innerText = 'Скан завершен';
        updateHUD();
    }

    function scanSingleTournamentBackground(tournId) {
        return new Promise((resolve) => {
            let tourn = stalkerState.liveTournaments.get(tournId);
            let wsUrl = stalkerState.auth.wssUrl;
            let sid = stalkerState.auth.sessionId || autoDetectSessionId();
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

            setTimeout(cleanup, 6000);

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
                } else if (levelMap.has(1) && currentBB === 500) {
                    currentBB = levelMap.get(1);
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

    // ── ОСНОВНОЙ ПАРСЕР ПОТОКА КЛИЕНТА (С ПОЛНОЙ ТЕЛЕМЕТРИЕЙ) ─────────
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

        let versMatch = xml.match(/\bclientVersion="([^"]+)"/);
        if (versMatch) stalkerState.auth.clientVersion = versMatch[1];

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
            autoDetectSessionId();
            if (firstTime && stalkerState.auth.sessionId) {
                triggerLobbyTournamentRefresh();
            }
        }

        // 2. Сетка турниров — ТОЛЬКО ХОЛДЕМ
        if (xml.includes('<Tournaments')) {
            let matches = xml.matchAll(/<Table\s+([^>]+)>/g);

            for (let m of matches) {
                let attrs = m[1];
                let tId = getAttr(attrs, 'id');
                let tName = getAttr(attrs, 'name') || '';
                let tStatus = getAttr(attrs, 'status');
                let tGame = getAttr(attrs, 'game') || '';

                let isHoldem = tGame.includes('TEXAS_HOLDEM') || tGame.includes('HOLDEM') || (!tGame.includes('OMAHA') && !tGame.includes('PINEAPPLE') && !tName.toLowerCase().includes('омаха') && !tName.toLowerCase().includes('ананас'));

                if (isHoldem && tId && (tStatus === 'RUNNING' || tStatus === 'LATE_REG' || tStatus === 'LATE_REGISTRATION' || tStatus === 'SEATING')) {
                    stalkerState.liveTournaments.set(tId, {
                        id: tId,
                        name: decodeHtml(tName) || 'MTT',
                        status: tStatus,
                        currentBB: 500
                    });

                    if (!stalkerState.scannerQueue.includes(tId)) {
                        stalkerState.scannerQueue.push(tId);
                    }
                } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED' || tStatus === 'REGISTERING' || tStatus === 'ANNOUNCED' || !isHoldem)) {
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

        // Seat Cache + АФК / Ситаут Детектор
        if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
            let seatBlocks = xml.matchAll(/<Seat\s+([^>]*\bid="(\d+)"[^>]*)>(.*?)<\/Seat>/gs);
            for (let sb of seatBlocks) {
                let seatAttrs = sb[1];
                let seatNum = parseInt(sb[2]);
                let seatContent = sb[3];

                let rawNick = getAttr(seatContent, 'nickname');
                let uuid = getAttr(seatContent, 'uuid');
                let stackM = seatContent.match(/stack-size="([^"]+)"/);
                let stack = stackM ? parseInt(stackM[1]) : 0;
                
                let isSittingOut = seatAttrs.includes('sittingOut="true"') || seatContent.includes('sittingOut="true"');
                if (isSittingOut) {
                    tableCtx.sittingOutSeats.add(seatNum);
                } else {
                    tableCtx.sittingOutSeats.delete(seatNum);
                }

                if (rawNick) {
                    let cleanNick = getCleanNick(rawNick);
                    tableCtx.seats.set(seatNum, {
                        rawNick: rawNick,
                        cleanNick: cleanNick,
                        uuid: uuid || `u_${cleanNick}`,
                        stack: stack,
                        stackStart: stack
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

        // Жизненный цикл раздачи (Полная поуличная телеметрия)
        if (xml.includes('<Message>') || xml.includes('<GameState')) {
            let hs = getAttr(xml, 'highStake');
            if (hs) tableCtx.currentBB = parseInt(hs);
            let ls = getAttr(xml, 'lowStake');
            if (ls) tableCtx.currentSB = parseInt(ls);

            // Старт новой раздачи
            let newHandMatch = xml.match(/<NewHand\s+[^>]*\bnumber="(\d+)"/);
            if (newHandMatch) {
                let dealerSeat = parseInt(getAttr(newHandMatch[0], 'dealer') || '0');
                tableCtx.resetHand(newHandMatch[1], dealerSeat);

                let activeSeatsMatch = xml.match(/<ActiveSeats>(.*?)<\/ActiveSeats>/);
                if (activeSeatsMatch) {
                    let seatsM = activeSeatsMatch[1].matchAll(/<Seat\s+id="(\d+)"/g);
                    for (let sm of seatsM) {
                        let sId = parseInt(sm[1]);
                        tableCtx.activeSeatsInHand.add(sId);
                        let seatInfo = tableCtx.seats.get(sId);
                        
                        if (seatInfo && TARGET_WATCHLIST.has(seatInfo.cleanNick) && !tableCtx.sittingOutSeats.has(sId)) {
                            getOrCreatePlayerProfile(seatInfo.cleanNick).handsCount++;
                        }
                    }

                    // Вычисляем точные покерные позиции каждого игрока за столом
                    tableCtx.positionsMap = calculatePositions(Array.from(tableCtx.activeSeatsInHand), dealerSeat);
                }
            }

            // Постинг анте и блайндов (Точный расчет ББ)
            let anteMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><PostAnte\s+amount="(\d+)"/g);
            for (let am of anteMatches) {
                let amt = parseInt(am[2]);
                tableCtx.currentAnte = amt;
                tableCtx.potTotal += amt;
            }

            let sbMatch = xml.match(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><PostSmallBlind\s+amount="(\d+)"/);
            if (sbMatch) {
                let amt = parseInt(sbMatch[2]);
                tableCtx.currentSB = amt;
                tableCtx.potTotal += amt;
            }

            let bbMatch = xml.match(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><PostBigBlind\s+amount="(\d+)"/);
            if (bbMatch) {
                let amt = parseInt(bbMatch[2]);
                tableCtx.currentBB = amt; // 100% точный ББ стола!
                tableCtx.potTotal += amt;
                if (tableCtx.tournId && stalkerState.liveTournaments.has(tableCtx.tournId)) {
                    stalkerState.liveTournaments.get(tableCtx.tournId).currentBB = amt;
                }
            }

            // Флоп
            let flopMatch = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/);
            if (flopMatch) {
                tableCtx.street = 'FLOP';
                tableCtx.board = Array.from(flopMatch[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                tableCtx.potOnFlop = tableCtx.potTotal;
                tableCtx.playersOnFlop = tableCtx.activeSeatsInHand.size;
            }

            // Терн
            let turnMatch = xml.match(/<DealingTurn><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingTurn>/i);
            if (turnMatch) {
                tableCtx.street = 'TURN';
                tableCtx.board.push(turnMatch[1] + turnMatch[2]);
                tableCtx.potOnTurn = tableCtx.potTotal;
            }

            // Ривер
            let riverMatch = xml.match(/<DealingRiver><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingRiver>/i);
            if (riverMatch) {
                tableCtx.street = 'RIVER';
                tableCtx.board.push(riverMatch[1] + riverMatch[2]);
                tableCtx.potOnRiver = tableCtx.potTotal;
                tableCtx.playersOnRiver = tableCtx.activeSeatsInHand.size;
            }

            // Действия игроков с точным учетом сайзинга и пота
            let playerActions = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*>(.*?)<\/PlayerAction>/gs);
            for (let pa of playerActions) {
                let seatNum = parseInt(pa[1]);
                let actionBody = pa[2];
                let seatInfo = tableCtx.seats.get(seatNum);
                let currentStack = seatInfo ? seatInfo.stack : 0;
                let actionAmount = parseInt(getAttr(actionBody, 'amount') || '0');

                let actName = 'ACTION';

                if (actionBody.includes('<Call')) {
                    if (actionAmount >= currentStack && currentStack > 0) {
                        actName = 'CALL_ALLIN';
                    } else {
                        actName = 'CALL';
                    }
                    if (seatInfo) seatInfo.stack = Math.max(0, currentStack - actionAmount);
                } else if (actionBody.includes('<AllIn')) {
                    actName = 'SHOVE_ALLIN';
                    if (seatInfo) seatInfo.stack = 0;
                } else if (actionBody.includes('<Raise') || actionBody.includes('<Bet')) {
                    if (actionAmount >= currentStack && currentStack > 0) {
                        actName = 'SHOVE_ALLIN';
                        if (seatInfo) seatInfo.stack = 0;
                    } else {
                        actName = actionBody.includes('<Raise') ? 'RAISE' : 'BET';
                        if (seatInfo) seatInfo.stack = Math.max(0, currentStack - actionAmount);
                    }
                } else if (actionBody.includes('<Check')) {
                    actName = 'CHECK';
                } else if (actionBody.includes('<Fold')) {
                    actName = 'FOLD';
                    tableCtx.activeSeatsInHand.delete(seatNum);
                }

                tableCtx.recordAction(seatNum, actName, actionAmount);

                if (seatInfo && TARGET_WATCHLIST.has(seatInfo.cleanNick) && !tableCtx.sittingOutSeats.has(seatNum)) {
                    let p = getOrCreatePlayerProfile(seatInfo.cleanNick);
                    let isPreflop = (tableCtx.street === 'PREFLOP');

                    if (actName.includes('CALL')) {
                        p.totalActions++;
                        if (isPreflop && !tableCtx.playersActedThisHand.has(`${seatInfo.cleanNick}_VPIP`)) {
                            p.vpipCount++;
                            tableCtx.playersActedThisHand.add(`${seatInfo.cleanNick}_VPIP`);
                        }
                    } else if (actName.includes('RAISE') || actName.includes('BET') || actName.includes('SHOVE')) {
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
                    } else if (actName === 'CHECK' || actName === 'FOLD') {
                        p.totalActions++;
                        if (isPreflop && actName === 'FOLD') {
                            p.stealFacedBB++;
                            p.foldBBCount++;
                        }
                    }
                }
            }
        }

        // Шоудаун и Muck Leak с полной гранулярной телеметрией
        if (xml.includes('<Show') || xml.includes('<Muck>')) {
            let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
            for (let sm of showMatches) {
                let seatNum = parseInt(sm[1]);
                let cardsRaw = sm[2];
                let cardsParsed = Array.from(cardsRaw.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                
                if (cardsParsed.length === 2) {
                    let cards = cardsParsed.join(' ');
                    let seatInfo = tableCtx.seats.get(seatNum);

                    if (seatInfo) {
                        let actionsList = tableCtx.getActionsForSeat(seatNum);
                        let position = tableCtx.positionsMap[seatNum] || 'N/A';
                        let stackStart = seatInfo.stackStart || seatInfo.stack || 0;
                        let stackBB = tableCtx.currentBB > 0 ? (stackStart / tableCtx.currentBB) : 0;
                        let isMuckLeak = sm[0].includes('<Muck');

                        queueServerEvent("HAND_SHOWDOWN_COMPLETED", {
                            hand_number: tableCtx.currentHand || `h_${Date.now()}`,
                            tournament_id: tableCtx.tournId || "MTT",
                            tournament_name: tableCtx.tournId && stalkerState.liveTournaments.has(tableCtx.tournId) ? stalkerState.liveTournaments.get(tableCtx.tournId).name : 'MTT',
                            uuid: seatInfo.uuid || `target_${seatInfo.cleanNick}`,
                            name: seatInfo.cleanNick,
                            position: position,
                            stack_start: stackStart,
                            stack_bb: parseFloat(stackBB.toFixed(1)),
                            sb_level: tableCtx.currentSB,
                            bb_level: tableCtx.currentBB,
                            pot_total: tableCtx.potTotal,
                            players_on_flop: tableCtx.playersOnFlop,
                            players_on_river: tableCtx.playersOnRiver,
                            cards: cards,
                            board: tableCtx.board.join(' '),
                            actions: actionsList,
                            is_muck_leak: isMuckLeak ? 1 : 0
                        });
                    }
                }
            }
        }
    }

    setInterval(triggerLobbyTournamentRefresh, 60000);
    setInterval(sendHudBatch, 5000);
    setInterval(processOutboxQueue, 4000);

    // ── МГНОВЕННЫЙ ЭКСПОРТ (0.1 СЕКУНДЫ) ─────────────────────────────
    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let exportData = {
                timestamp: new Date().toISOString(),
                discipline: "TEXAS_HOLDEM_ONLY",
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
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 1500);

                let res = await fetch(`${scoutServerUrl}/scout_api/export`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    exportData.serverBackup = await res.json();
                }
            } catch(e) {}

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_ultra_dossier_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ПЕРЕХВАТЧИК СОКЕТОВ ──────────────────────────────────────────
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
        if (!ws || ws.__stalkerHookedV19) return;
        ws.__stalkerHookedV19 = true;

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

    console.log("🎯 [VIP Scout v19.0 ULTRA RAW TELEMETRY] Готов к работе.");
})();

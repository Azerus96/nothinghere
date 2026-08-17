javascript:(function(){
    if (window.__pokerTargetStalker) {
        alert('Сталкер уже активен на этой странице!');
        return;
    }
    window.__pokerTargetStalker = true;

    let scoutServerUrl = "https://toofunoff-poker-scout.hf.space";

    // 30 ЦЕЛЕВЫХ ИГРОКОВ
    const TARGET_WATCHLIST = new Set([
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha"
    ].map(name => name.toLowerCase()));

    let stalkerState = {
        activeTournaments: new Map(), // tournId -> {name, buyIn, currentBB}
        stalkedPlayers: new Map(),     // targetKey -> {name, displayName, chips, stack_bb, tournName, place, isBusted}
        isAutoScanning: true,
        isRecordingHands: true,
        ws: null
    };

    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
    }

    function formatChips(chips) {
        if (!chips || chips <= 0) return "0";
        if (chips >= 1000000) return (chips / 1000000).toFixed(2) + "M";
        if (chips >= 1000) return (chips / 1000).toFixed(0) + "k";
        return chips.toString();
    }

    // ── 1. АДАПТИВНЫЙ ИНТЕРФЕЙС (100% ПО ЦЕНТРУ ЭКРАНА) ────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud';
    ui.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;margin:0 auto;width:calc(100vw - 20px);max-width:350px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:12px;border-radius:10px;border:2px solid #eab308;box-shadow:0 10px 30px rgba(0,0,0,0.9);backdrop-filter:blur(8px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#22c55e;font-size:12px;">●</span>
                <strong style="color:#fde047;font-size:12px;">VIP SCOUT (30 ЦЕЛЕЙ)</strong>
            </div>
            <button onclick="document.getElementById('stalker-hud').remove();window.__pokerTargetStalker=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
        </div>

        <div style="background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                <span>Сервер: <b style="color:#38bdf8;">HF 24/7</b></span>
                <span id="st-scan-status" style="color:#4ade80;">Поиск по всем турнирам...</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                <span>Турниров в сети: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 30</b></span>
            </div>
        </div>

        <div id="st-targets-list" style="max-height:160px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
            Поиск игроков по всей сетке Покердома...
        </div>

        <div style="display:flex;gap:6px;margin-bottom:6px;">
            <button id="btn-toggle-scan" style="flex:1;padding:6px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:10px;cursor:pointer;">
                🔄 Авто-поиск: ВКЛ
            </button>
            <button id="btn-toggle-rec" style="flex:1;padding:6px;background:#059669;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:10px;cursor:pointer;">
                🔴 Запись стола: ВКЛ
            </button>
        </div>

        <button id="btn-export-db" style="width:100%;padding:6px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;">
            📥 Скачать отчёт базы данных (JSON)
        </button>
    `;
    document.body.appendChild(ui);

    function updateHUD() {
        let countEl = document.getElementById('st-targets-found');
        let tournsEl = document.getElementById('st-tourns-count');
        let listEl = document.getElementById('st-targets-list');
        if (!countEl || !listEl) return;

        let activeCount = 0;
        stalkerState.stalkedPlayers.forEach(p => { if (!p.isBusted) activeCount++; });

        countEl.innerText = `${stalkerState.stalkedPlayers.size} / 30 (${activeCount} в игре)`;
        if (tournsEl) tournsEl.innerText = stalkerState.activeTournaments.size;

        if (stalkerState.stalkedPlayers.size > 0) {
            let html = '';
            stalkerState.stalkedPlayers.forEach((p) => {
                let chipsStr = formatChips(p.chips);
                let bbStr = p.stack_bb > 0 ? ` (${p.stack_bb.toFixed(1)} BB)` : '';
                
                if (p.isBusted) {
                    html += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111827;padding:3px 0;opacity:0.6;">
                        <span style="color:#ef4444;">❌ <s>${p.displayName}</s></span>
                        <span style="color:#ef4444;font-size:10px;">ВЫБЫЛ (${p.place} место)</span>
                    </div>`;
                } else {
                    html += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111827;padding:3px 0;align-items:center;">
                        <span style="color:#fde047;">🎯 <b>${p.displayName}</b></span>
                        <span style="color:#38bdf8;font-weight:bold;">${chipsStr}${bbStr}</span>
                        <span style="color:#94a3b8;font-size:10px;">${p.tournName ? p.tournName.substring(0, 10) : 'MTT'}</span>
                    </div>`;
                }
            });
            listEl.innerHTML = html;
        }
    }

    async function sendScoutEvent(type, payload) {
        try {
            await fetch(`${scoutServerUrl}/api/scout_event`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: type, payload: payload })
            });
        } catch (e) {}
    }

    // ── 2. ГЛОБАЛЬНЫЙ ПАРСЕР ТУРНИРОВ И ИГРОКОВ ─────────────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;
        stalkerState.ws = ws;

        // 1. Поиск ВСЕХ турниров в лобби (включая теги <Game> и <Contest>)
        let tournMatches = xml.matchAll(/<(?:Game|Table|Tournament|Contest)\s+[^>]*\bid="([^"]+)"[^>]*\bname="([^"]+)"/g);
        for (let tm of tournMatches) {
            let tId = tm[1];
            let tName = tm[2];
            if (tId && tName && !stalkerState.activeTournaments.has(tId)) {
                stalkerState.activeTournaments.set(tId, {
                    id: tId,
                    name: tName,
                    currentBB: 100
                });
            }
        }

        // Блайнды турнира
        let curLevel = xml.match(/<CurrentLevel[^>]*highStake="(\d+)"/);
        let curTournId = xml.match(/tournamentId="([^"]+)"/)?.[1] || xml.match(/<TournamentDetails[^>]*id="([^"]+)"/)?.[1];
        if (curLevel && curTournId && stalkerState.activeTournaments.has(curTournId)) {
            stalkerState.activeTournaments.get(curTournId).currentBB = parseInt(curLevel[1]);
        }

        // 2. Сканирование списков игроков турниров (с поддержкой #2, #3 и любого порядка полей)
        let playerBlocks = xml.matchAll(/<Player\s+([^>]+)>/g);
        for (let pb of playerBlocks) {
            let attrs = pb[1];
            let nickM = attrs.match(/\bnickname="([^"]+)"/);
            let chipsM = attrs.match(/\bchips="([^"]+)"/);
            let placeM = attrs.match(/\bplace="([^"]+)"/);

            if (nickM) {
                let rawNick = nickM[1];
                let cleanNick = getCleanNick(rawNick);

                if (TARGET_WATCHLIST.has(cleanNick)) {
                    let chips = chipsM ? parseInt(chipsM[1]) : 0;
                    let place = placeM ? parseInt(placeM[1]) : 0;
                    let tourn = stalkerState.activeTournaments.get(curTournId) || { name: "Турнир", currentBB: 100 };
                    let stackBB = tourn.currentBB > 0 ? (chips / tourn.currentBB) : 0;

                    let targetKey = `${cleanNick}_${curTournId || 'tourn'}`;
                    let existing = stalkerState.stalkedPlayers.get(targetKey) || {};

                    // Объединение данных без затирания фишек
                    stalkerState.stalkedPlayers.set(targetKey, Object.assign(existing, {
                        name: cleanNick,
                        displayName: rawNick,
                        chips: chips > 0 ? chips : (existing.chips || chips),
                        stack_bb: stackBB > 0 ? stackBB : (existing.stack_bb || stackBB),
                        place: place,
                        tournId: curTournId,
                        tournName: tourn.name,
                        isBusted: (chips === 0 && place > 0)
                    }));

                    sendScoutEvent("TARGET_PLAYER_DISCOVERED", {
                        uuid: `target_${cleanNick}`,
                        name: rawNick,
                        tournament_id: curTournId,
                        chips: chips,
                        stack_bb: stackBB
                    });

                    updateHUD();
                }
            }
        }

        // 3. Отслеживание выбывания игроков
        let rankedMatches = xml.matchAll(/<TournamentPlayerRanked[^>]*nickname="([^"]+)"[^>]*placeFrom="(\d+)"/g);
        for (let rm of rankedMatches) {
            let rawNick = rm[1];
            let cleanNick = getCleanNick(rawNick);
            let place = parseInt(rm[2]);

            stalkerState.stalkedPlayers.forEach((p, key) => {
                if (p.name === cleanNick) {
                    p.isBusted = true;
                    p.place = place;
                    p.chips = 0;
                    p.stack_bb = 0;
                }
            });
            updateHUD();
        }

        // 4. Запись шоудаунов и вскрытий
        if (stalkerState.isRecordingHands && (xml.includes('<Show') || xml.includes('<Winners'))) {
            let showMatches = xml.matchAll(/<PlayerAction seat="(\d+)"><Show combination="([^"]+)"><Cards>(.*?)<\/Cards>/gs);
            let activeTableId = xml.match(/<TableDetails\s+[^>]*\bid="([^"]+)"/)?.[1] || "table";

            for (let sm of showMatches) {
                let seat = sm[1];
                let comb = sm[2];
                let cards = sm[3].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g)?.map(c => c.replace(/<[^>]+>/g, '')).join(' ');
                let board = xml.match(/<Cards>(.*?)<\/Cards>/)?.[1] || "";

                stalkerState.stalkedPlayers.forEach((p) => {
                    if (p.seat == seat) {
                        sendScoutEvent("HAND_SHOWDOWN_COMPLETED", {
                            hand_number: xml.match(/number="(\d+)"/)?.[1] || `${Date.now()}`,
                            tournament_id: p.tournId || "tourn",
                            uuid: p.uuid || `target_${p.name}`,
                            cards: cards,
                            board: board,
                            actions: [comb],
                            showdown: true
                        });
                    }
                });
            }
        }
    }

    // ── 3. ЦИКЛ АВТО-ОПРОСА ВСЕХ ТУРНИРОВ ПОКЕРДОМА ─────────────────────
    let tournIdx = 0;
    setInterval(() => {
        if (!stalkerState.ws || !stalkerState.isAutoScanning) return;

        // Если список турниров пуст — запрашиваем каталог лобби
        if (stalkerState.activeTournaments.size === 0) {
            try {
                stalkerState.ws.send('<GetQuickSeatGamesList id="952-43"/>');
                stalkerState.ws.send('<EnterLobby name="POKER"/>');
            } catch(e) {}
            return;
        }

        let tournIds = Array.from(stalkerState.activeTournaments.keys());
        let targetTournId = tournIds[tournIdx % tournIds.length];
        tournIdx++;

        try {
            // Опрашиваем участников очередного турнира из сети
            stalkerState.ws.send(`<EnterTournamentLobby id="${targetTournId}"/>`);
            stalkerState.ws.send(`<GetTournamentPlayers tournamentId="${targetTournId}"/>`);
        } catch (e) {}
    }, 2000);

    // Управление кнопками
    document.getElementById('btn-toggle-scan').onclick = function() {
        stalkerState.isAutoScanning = !stalkerState.isAutoScanning;
        this.innerText = stalkerState.isAutoScanning ? "🔄 Авто-поиск: ВКЛ" : "⏸ Авто-поиск: ВЫКЛ";
        this.style.background = stalkerState.isAutoScanning ? "#0284c7" : "#475569";
    };

    document.getElementById('btn-toggle-rec').onclick = function() {
        stalkerState.isRecordingHands = !stalkerState.isRecordingHands;
        this.innerText = stalkerState.isRecordingHands ? "🔴 Запись стола: ВКЛ" : "⚪ Запись стола: ВЫКЛ";
        this.style.background = stalkerState.isRecordingHands ? "#059669" : "#475569";
    };

    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let res = await fetch(`${scoutServerUrl}/api/get_export_json`);
            let data = await res.json();
            let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `poker_scout_report_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Сервер Hugging Face временно недоступен.');
        }
    };

    // ── 4. ХУК ВСЕХ WEBSOCKET СОЕДИНЕНИЙ ────────────────────────────────
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

    console.log("🎯 [Pokerdom Global Scout v3.0] Активен. Полный охват рума включен.");
})();

javascript:(function(){
    if (window.__pokerTargetStalker) {
        alert('Сталкер уже активен на этой странице!');
        return;
    }
    window.__pokerTargetStalker = true;

    // Постоянный адрес вашего сервера на Hugging Face
    let scoutServerUrl = "https://toofunoff-poker-scout.hf.space";

    // СПИСОК 30 ЦЕЛЕВЫХ ИГРОКОВ
    const TARGET_WATCHLIST = new Set([
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha"
    ].map(name => name.toLowerCase()));

    let stalkerState = {
        activeTournamentId: null,
        tournamentName: "Ожидание турнира в лобби...",
        activeTournaments: new Map(),
        tablesPool: [],
        stalkedPlayers: new Map(),
        stalkedTables: new Set(),
        isScanning: false,
        ws: null
    };

    // ── 1. ИНТЕРФЕЙС СТАЛКЕРА ──────────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud';
    ui.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:monospace;font-size:11px;padding:12px;border-radius:10px;border:2px solid #eab308;width:360px;box-shadow:0 10px 30px rgba(0,0,0,0.9);backdrop-filter:blur(8px);';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">
            <strong style="color:#fde047;font-size:12px;">🎯 POKERDOM VIP STALKER (30 ЦЕЛЕЙ)</strong>
            <button onclick="document.getElementById('stalker-hud').remove();window.__pokerTargetStalker=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;">✕</button>
        </div>
        <div style="background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
            <div style="color:#94a3b8;font-size:10px;">Сервер HF: <b style="color:#38bdf8;">toofunoff-poker-scout</b></div>
            <div id="st-tourn-title" style="color:#fde047;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Ожидание лобби...</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
            <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 30</b></span>
            <span>Столов в пуле: <b id="st-tables-count" style="color:#38bdf8;">0</b></span>
        </div>
        <div id="st-targets-list" style="max-height:130px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
            Откройте турнир в лобби Покердома...
        </div>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
            <button id="btn-start-stalker" style="flex:1;padding:6px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
                ▶ Начать обход столов
            </button>
            <button id="btn-stop-stalker" style="display:none;flex:1;padding:6px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
                ⏹ Стоп
            </button>
        </div>
        <button id="btn-export-db" style="width:100%;padding:6px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
            📥 Экспорт отчета из базы (JSON)
        </button>
    `;
    document.body.appendChild(ui);

    function updateHUD() {
        let countEl = document.getElementById('st-targets-found');
        let tablesEl = document.getElementById('st-tables-count');
        let listEl = document.getElementById('st-targets-list');
        let titleEl = document.getElementById('st-tourn-title');
        
        if (titleEl && stalkerState.tournamentName) titleEl.innerText = stalkerState.tournamentName;
        if (countEl) countEl.innerText = `${stalkerState.stalkedPlayers.size} / 30`;
        if (tablesEl) tablesEl.innerText = stalkerState.tablesPool.length;

        if (listEl && stalkerState.stalkedPlayers.size > 0) {
            let html = '';
            stalkerState.stalkedPlayers.forEach((p) => {
                html += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111827;padding:2px 0;">
                    <span style="color:#fde047;">🎯 <b>${p.name}</b></span>
                    <span style="color:#38bdf8;">${(p.stack_bb || 0).toFixed(1)} BB</span>
                    <span style="color:#94a3b8;">${p.tournName ? p.tournName.substring(0, 12) : 'Турнир'}</span>
                </div>`;
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

    async function sendHudBatch(profiles) {
        if (!profiles || profiles.length === 0) return;
        try {
            await fetch(`${scoutServerUrl}/api/save_hud_batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profiles: profiles })
            });
        } catch (e) {}
    }

    // ── 2. БЕЗОШИБОЧНЫЙ ПАРСИНГ XML ────────────────────────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;
        stalkerState.ws = ws;

        // 1. Поиск открытого турнира
        if (xml.includes('<TournamentDetails')) {
            let tId = xml.match(/\bid="([^"]+)"/)?.[1];
            let tName = xml.match(/\bname="([^"]+)"/)?.[1];
            if (tId && tName) {
                stalkerState.activeTournamentId = tId;
                stalkerState.tournamentName = tName;

                let tableMatches = xml.matchAll(/<Table\s+[^>]*\bid="([^"]+)"/g);
                stalkerState.tablesPool = [];
                for (let tm of tableMatches) {
                    if (tm[1] !== stalkerState.activeTournamentId) {
                        stalkerState.tablesPool.push(tm[1]);
                    }
                }
                updateHUD();
            }
        }

        // 2. Сканирование списка участников турнира (НЕЗАВИСИМО ОТ ПОРЯДКА АТРИБУТОВ)
        let playerBlocks = xml.matchAll(/<Player\s+([^>]+)>/g);
        for (let pb of playerBlocks) {
            let attrs = pb[1];
            let nickM = attrs.match(/\bnickname="([^"]+)"/);
            let chipsM = attrs.match(/\bchips="([^"]+)"/);

            if (nickM) {
                let nick = nickM[1];
                let chips = chipsM ? parseInt(chipsM[1]) : 0;

                if (TARGET_WATCHLIST.has(nick.toLowerCase())) {
                    let uuid = `target_${nick.toLowerCase()}`;
                    stalkerState.stalkedPlayers.set(uuid, {
                        name: nick,
                        uuid: uuid,
                        chips: chips,
                        stack_bb: chips / 200,
                        tournId: stalkerState.activeTournamentId,
                        tournName: stalkerState.tournamentName
                    });

                    sendScoutEvent("TARGET_PLAYER_DISCOVERED", {
                        uuid: uuid,
                        name: nick,
                        tournament_id: stalkerState.activeTournamentId,
                        chips: chips,
                        stack_bb: chips / 200
                    });
                    updateHUD();
                }
            }
        }

        // 3. Обнаружение мест за конкретными столами
        let seatBlocks = xml.matchAll(/<Seat id="(\d+)">.*?<PlayerInfo\s+([^>]+)>/gs);
        let activeTableId = xml.match(/<TableDetails\s+[^>]*\bid="([^"]+)"/)?.[1] || "table";

        for (let sm of seatBlocks) {
            let seat = sm[1];
            let pAttrs = sm[2];
            let nickM = pAttrs.match(/\bnickname="([^"]+)"/);
            let uuidM = pAttrs.match(/\buuid="([^"]+)"/);

            if (nickM && uuidM) {
                let nick = nickM[1];
                let uuid = uuidM[1];

                if (TARGET_WATCHLIST.has(nick.toLowerCase())) {
                    stalkerState.stalkedPlayers.set(uuid, {
                        name: nick,
                        uuid: uuid,
                        tableId: activeTableId,
                        seat: seat,
                        tournName: stalkerState.tournamentName
                    });
                    updateHUD();
                }
            }
        }

        // 4. Сбор официальных HUD-статов Покердома
        if (xml.includes('<HudChange')) {
            let hudBlocks = xml.matchAll(/<HudChange[^>]*seat="(\d+)">(.*?)<\/HudChange>/gs);
            let profiles = [];

            for (let hb of hudBlocks) {
                let seatId = hb[1];
                let rawStats = hb[2];

                let vpipM = rawStats.match(/type="VPIP"\s+value="([^"]+)"/);
                let pfrM  = rawStats.match(/type="PFR"\s+value="([^"]+)"/);
                let afqM  = rawStats.match(/type="AFQ"\s+value="([^"]+)"/);
                let handsM = rawStats.match(/type="HANDS"\s+value="([^"]+)"/);

                let playerM = xml.match(new RegExp(`<Seat id="${seatId}">.*?<PlayerInfo\s+([^>]+)>`, 's'));
                if (playerM) {
                    let pAttrs = playerM[1];
                    let nickM = pAttrs.match(/\bnickname="([^"]+)"/);
                    let uuidM = pAttrs.match(/\buuid="([^"]+)"/);

                    if (nickM && uuidM && TARGET_WATCHLIST.has(nickM[1].toLowerCase())) {
                        profiles.push({
                            uuid: uuidM[1],
                            name: nickM[1],
                            vpip: vpipM ? parseFloat(vpipM[1]) : 0,
                            pfr: pfrM ? parseFloat(pfrM[1]) : 0,
                            afq: afqM ? parseFloat(afqM[1]) : 0,
                            hands: handsM ? parseInt(handsM[1]) : 1
                        });
                    }
                }
            }

            if (profiles.length > 0) {
                sendHudBatch(profiles);
            }
        }

        // 5. Вскрытия карт целевых игроков
        if (xml.includes('<Show') || xml.includes('<Winners')) {
            let showMatches = xml.matchAll(/<PlayerAction seat="(\d+)"><Show combination="([^"]+)"><Cards>(.*?)<\/Cards>/gs);
            for (let sm of showMatches) {
                let seat = sm[1];
                let comb = sm[2];
                let cards = sm[3].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g)?.map(c => c.replace(/<[^>]+>/g, '')).join(' ');
                let board = xml.match(/<Cards>(.*?)<\/Cards>/)?.[1] || "";

                stalkerState.stalkedPlayers.forEach((p) => {
                    if (p.seat == seat && p.tableId == activeTableId) {
                        sendScoutEvent("HAND_SHOWDOWN_COMPLETED", {
                            hand_number: xml.match(/number="(\d+)"/)?.[1] || `${Date.now()}`,
                            tournament_id: p.tournId || "tourn",
                            uuid: p.uuid,
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

    // ── 3. ФОНОВЫЙ ОБХОД СТОЛОВ ─────────────────────────────────────────
    let scanInterval = null;

    document.getElementById('btn-start-stalker').onclick = function () {
        if (!stalkerState.activeTournamentId || stalkerState.tablesPool.length === 0) {
            alert('Сначала откройте окно любого турнира в Покердоме!');
            return;
        }

        stalkerState.isScanning = true;
        document.getElementById('btn-start-stalker').style.display = 'none';
        document.getElementById('btn-stop-stalker').style.display = 'block';

        let tableIndex = 0;
        scanInterval = setInterval(() => {
            if (!stalkerState.isScanning || !stalkerState.ws) return;

            let targetTable = stalkerState.tablesPool[tableIndex % stalkerState.tablesPool.length];
            tableIndex++;

            if (targetTable) {
                let openXml = `<OpenTournamentTable id="${targetTable}" tournamentId="${stalkerState.activeTournamentId}" observer="true"/>`;
                let obsXml = `<Observe/>`;
                try {
                    stalkerState.ws.send(openXml);
                    stalkerState.ws.send(obsXml);
                } catch (e) {}
            }
        }, 4000);
    };

    document.getElementById('btn-stop-stalker').onclick = function () {
        stalkerState.isScanning = false;
        clearInterval(scanInterval);
        document.getElementById('btn-start-stalker').style.display = 'block';
        document.getElementById('btn-stop-stalker').style.display = 'none';
    };

    // Экспорт базы прямо с сервера Hugging Face
    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let res = await fetch(`${scoutServerUrl}/api/get_export_json`);
            let data = await res.json();
            let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `poker_vip_scout_report_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Не удалось подключиться к серверу Hugging Face.');
        }
    };

    // ── 4. ХУК WEBSOCKET ВО ВСЕХ IFRAME ─────────────────────────────────
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

    console.log("🎯 [Pokerdom VIP Stalker] Полностью обновлён и готов к работе.");
})();

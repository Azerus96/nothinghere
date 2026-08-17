javascript:(function(){
    if (window.__pokerTargetStalker) {
        alert('Сталкер уже активен на этой странице!');
        return;
    }
    window.__pokerTargetStalker = true;

    let scoutServerUrl = "https://toofunoff-poker-scout.hf.space";

    // 30 ЦЕЛЕВЫХ ИГРОКОВ (Базовые имена)
    const TARGET_WATCHLIST = new Set([
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha"
    ].map(name => name.toLowerCase()));

    let stalkerState = {
        activeTournaments: new Map(), // tournId -> {name, buyIn, currentBB, tables: []}
        stalkedPlayers: new Map(),     // targetKey -> {name, displayName, chips, stack_bb, tournName, place}
        isAutoScanning: true,
        ws: null
    };

    // Очистка никнейма от суффиксов мульти-энтри (#2, #3, #4...)
    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+$/, '').trim().toLowerCase();
    }

    // ── 1. ИНТЕРФЕЙС СТАЛКЕРА ──────────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud';
    ui.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:monospace;font-size:11px;padding:12px;border-radius:10px;border:2px solid #eab308;width:370px;box-shadow:0 10px 30px rgba(0,0,0,0.9);backdrop-filter:blur(8px);';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;border-bottom:1px solid #334155;padding-bottom:6px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#22c55e;">●</span>
                <strong style="color:#fde047;font-size:12px;">GLOBAL SCOUT (30 ЦЕЛЕЙ)</strong>
            </div>
            <button onclick="document.getElementById('stalker-hud').remove();window.__pokerTargetStalker=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
        </div>
        <div style="background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                <span>Сервер: <b style="color:#38bdf8;">Hugging Face 24/7</b></span>
                <span id="st-scan-status" style="color:#4ade80;">Поиск по всем турнирам...</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                <span>Турниров в сети: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 30</b></span>
            </div>
        </div>
        <div id="st-targets-list" style="max-height:160px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
            Сканирование всех активных турниров лобби...
        </div>
        <button id="btn-export-db" style="width:100%;padding:6px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">
            📥 Скачать отчёт базы данных (JSON)
        </button>
    `;
    document.body.appendChild(ui);

    function updateHUD() {
        let countEl = document.getElementById('st-targets-found');
        let tournsEl = document.getElementById('st-tourns-count');
        let listEl = document.getElementById('st-targets-list');
        if (!countEl || !listEl) return;

        countEl.innerText = `${stalkerState.stalkedPlayers.size} / 30`;
        if (tournsEl) tournsEl.innerText = stalkerState.activeTournaments.size;

        if (stalkerState.stalkedPlayers.size > 0) {
            let html = '';
            stalkerState.stalkedPlayers.forEach((p) => {
                let stackText = p.chips ? `${(p.chips / 1000).toFixed(0)}k` : '—';
                let bbText = p.stack_bb > 0 ? ` (${p.stack_bb.toFixed(1)} BB)` : '';
                html += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111827;padding:3px 0;align-items:center;">
                    <span style="color:#fde047;">🎯 <b>${p.displayName}</b></span>
                    <span style="color:#38bdf8;font-weight:bold;">${stackText}${bbText}</span>
                    <span style="color:#94a3b8;font-size:10px;">${p.tournName ? p.tournName.substring(0, 10) : 'MTT'}</span>
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

    // ── 2. ПАРСИНГ XML ПОТОКА ВСЕГО РУМА ────────────────────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;
        stalkerState.ws = ws;

        // 1. Сбор всех турниров лобби
        let tournMatches = xml.matchAll(/<(?:Table|Tournament)\s+[^>]*\bid="([^"]+)"[^>]*\bname="([^"]+)"/g);
        for (let tm of tournMatches) {
            let tId = tm[1];
            let tName = tm[2];
            if (tId && tName && !stalkerState.activeTournaments.has(tId)) {
                stalkerState.activeTournaments.set(tId, {
                    id: tId,
                    name: tName,
                    currentBB: 100,
                    tables: []
                });
            }
        }

        // Блайнды турнира
        let curLevel = xml.match(/<CurrentLevel[^>]*highStake="(\d+)"/);
        let currentTournId = xml.match(/<TournamentInfo[^>]*tournamentId="([^"]+)"/)?.[1] || xml.match(/<TournamentDetails[^>]*id="([^"]+)"/)?.[1];
        if (curLevel && currentTournId && stalkerState.activeTournaments.has(currentTournId)) {
            stalkerState.activeTournaments.get(currentTournId).currentBB = parseInt(curLevel[1]);
        }

        // 2. Сканирование списков игроков турниров (УЧИТЫВАЕТ #2, #3 и любой порядок атрибутов)
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
                    let tourn = stalkerState.activeTournaments.get(currentTournId) || { name: "Хайроллер / Турнир", currentBB: 100000 };
                    let stackBB = tourn.currentBB > 0 ? (chips / tourn.currentBB) : 0;

                    let targetKey = `${cleanNick}_${currentTournId}`;
                    let existing = stalkerState.stalkedPlayers.get(targetKey) || {};

                    // БЕЗОПАСНОЕ ОБЪЕДИНЕНИЕ ДАННЫХ (Ничего не стирается!)
                    stalkerState.stalkedPlayers.set(targetKey, Object.assign(existing, {
                        name: cleanNick,
                        displayName: rawNick,
                        chips: chips > 0 ? chips : (existing.chips || 0),
                        stack_bb: stackBB > 0 ? stackBB : (existing.stack_bb || 0),
                        place: place,
                        tournId: currentTournId,
                        tournName: tourn.name
                    }));

                    sendScoutEvent("TARGET_PLAYER_DISCOVERED", {
                        uuid: `target_${cleanNick}`,
                        name: rawNick,
                        tournament_id: currentTournId,
                        chips: chips,
                        stack_bb: stackBB
                    });

                    updateHUD();
                }
            }
        }

        // 3. Сканирование столов и мест игроков
        let seatBlocks = xml.matchAll(/<Seat id="(\d+)">.*?<PlayerInfo\s+([^>]+)>/gs);
        let activeTableId = xml.match(/<TableDetails\s+[^>]*\bid="([^"]+)"/)?.[1] || "table";

        for (let sm of seatBlocks) {
            let seat = sm[1];
            let pAttrs = sm[2];
            let nickM = pAttrs.match(/\bnickname="([^"]+)"/);
            let uuidM = pAttrs.match(/\buuid="([^"]+)"/);

            if (nickM) {
                let rawNick = nickM[1];
                let cleanNick = getCleanNick(rawNick);

                if (TARGET_WATCHLIST.has(cleanNick)) {
                    let uuid = uuidM ? uuidM[1] : `target_${cleanNick}`;
                    let targetKey = `${cleanNick}_${activeTableId}`;
                    let existing = stalkerState.stalkedPlayers.get(targetKey) || {};

                    stalkerState.stalkedPlayers.set(targetKey, Object.assign(existing, {
                        name: cleanNick,
                        displayName: rawNick,
                        uuid: uuid,
                        tableId: activeTableId,
                        seat: seat
                    }));
                    updateHUD();
                }
            }
        }

        // 4. Вскрытия карт на шоудауне
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

    // ── 3. ГЛОБАЛЬНЫЙ АВТО-ОБХОД ВСЕХ ТУРНИРОВ В СЕТИ (24/7) ───────────
    let tournIterator = 0;
    setInterval(() => {
        if (!stalkerState.ws || stalkerState.activeTournaments.size === 0) {
            // Если список пуст — запрашиваем турнирное лобби
            if (stalkerState.ws) {
                try {
                    stalkerState.ws.send('<GetQuickSeatGames/>');
                    stalkerState.ws.send('<EnterLobby name="POKER"/>');
                } catch(e) {}
            }
            return;
        }

        let tournIds = Array.from(stalkerState.activeTournaments.keys());
        let currentTId = tournIds[tournIterator % tournIds.length];
        tournIterator++;

        try {
            // Опрашиваем игроков турнира
            stalkerState.ws.send(`<EnterTournamentLobby id="${currentTId}"/>`);
            stalkerState.ws.send(`<GetTournamentPlayers tournamentId="${currentTId}"/>`);
        } catch (e) {}
    }, 2500);

    // Экспорт базы
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

    console.log("🎯 [Global VIP Scout v2.0] Запущен. Мониторинг всех турниров активен.");
})();

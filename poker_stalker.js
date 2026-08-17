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
        activeTournaments: new Map(), // id -> {name, buyIn, currentBB}
        stalkedPlayers: new Map(),     // targetKey -> {name, displayName, stack, stack_bb, tournName, place, rank, isBusted, prize}
        isAutoScanning: true,
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
    ui.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);width:92vw;max-width:360px;z-index:999999999;background:rgba(10,15,25,0.97);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:12px;border-radius:10px;border:2px solid #eab308;box-shadow:0 10px 30px rgba(0,0,0,0.9);backdrop-filter:blur(8px);box-sizing:border-box;';
    
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
                <span id="st-scan-status" style="color:#4ade80;">Поиск по всей сети...</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                <span>Турниров в сети: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0 / 30</b></span>
            </div>
        </div>

        <div id="st-targets-list" style="max-height:170px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
            Поиск игроков по всей турнирной сетке...
        </div>

        <button id="btn-export-db" style="width:100%;padding:7px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;">
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
                let chipsStr = formatChips(p.stack);
                let bbStr = p.stack_bb > 0 ? ` (${p.stack_bb.toFixed(1)} BB)` : '';
                let rankStr = p.rank > 0 ? `[${p.rank} место]` : '';
                
                if (p.isBusted) {
                    let prizeStr = p.prize > 0 ? ` +${formatChips(p.prize)}₽` : '';
                    html += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111827;padding:3px 0;opacity:0.55;font-size:10px;">
                        <span style="color:#ef4444;">❌ <s>${p.displayName}</s></span>
                        <span style="color:#ef4444;">${p.place} место${prizeStr} [ВЫБЫЛ]</span>
                    </div>`;
                } else {
                    html += `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111827;padding:3px 0;align-items:center;">
                        <span style="color:#fde047;">🎯 <b>${p.displayName}</b> <small style="color:#64748b;">${rankStr}</small></span>
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

    // ── 2. ТОЧНЫЙ ПАРСЕР ПОТОКА POKERDOM ────────────────────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;
        stalkerState.ws = ws;

        // 1. Поиск турниров лобби (тег <Table> внутри <Tournaments>)
        let tournMatches = xml.matchAll(/<Table\s+[^>]*\bid="([^"]+)"[^>]*\bname="([^"]+)"/g);
        for (let tm of tournMatches) {
            let tId = tm[1];
            let tName = tm[2];
            if (tId && tName && !stalkerState.activeTournaments.has(tId)) {
                stalkerState.activeTournaments.set(tId, {
                    id: tId,
                    name: tName,
                    currentBB: 100000 // Дефолт для хайроллеров до прихода расписания
                });
            }
        }

        // Блайнды турнира из Schedule / CurrentLevel
        let scheduleMatch = xml.match(/<Schedule[^>]*currentLevel="(\d+)"/);
        let curLevelNum = scheduleMatch ? scheduleMatch[1] : null;
        let curTournId = xml.match(/<TournamentDetails[^>]*id="([^"]+)"/)?.[1];

        if (curLevelNum && curTournId) {
            let levelItem = xml.match(new RegExp(`<Item[^>]*number="${curLevelNum}"[^>]*highStake="(\\d+)"`));
            if (levelItem && stalkerState.activeTournaments.has(curTournId)) {
                stalkerState.activeTournaments.get(curTournId).currentBB = parseInt(levelItem[1]);
            }
        }

        // 2. Сбор игроков: считываем СТЕКИ (stack="...") и ВЫБЫВАНИЕ (placeFrom="...")
        let playerBlocks = xml.matchAll(/<Player\s+([^>]+)>/g);
        for (let pb of playerBlocks) {
            let attrs = pb[1];
            let nickM = attrs.match(/\bnickname="([^"]+)"/);
            let stackM = attrs.match(/\bstack="([^"]+)"/);
            let rankM = attrs.match(/\brank="([^"]+)"/);
            let placeFromM = attrs.match(/\bplaceFrom="([^"]+)"/);
            let prizeM = attrs.match(/\bprizeAmount="([^"]+)"/);

            if (nickM) {
                let rawNick = nickM[1];
                let cleanNick = getCleanNick(rawNick);

                if (TARGET_WATCHLIST.has(cleanNick)) {
                    let stack = stackM ? parseInt(stackM[1]) : 0;
                    let rank = rankM ? parseInt(rankM[1]) : 0;
                    let placeFrom = placeFromM ? parseInt(placeFromM[1]) : 0;
                    let prize = prizeM ? parseFloat(prizeM[1]) : 0;

                    let tourn = stalkerState.activeTournaments.get(curTournId) || { name: "Вечерний Хайроллер", currentBB: 200000 };
                    let stackBB = tourn.currentBB > 0 ? (stack / tourn.currentBB) : 0;

                    let targetKey = `${cleanNick}_${rawNick}`;
                    let isBusted = (placeFrom > 0 || stack === 0);

                    stalkerState.stalkedPlayers.set(targetKey, {
                        name: cleanNick,
                        displayName: rawNick,
                        stack: stack,
                        stack_bb: stackBB,
                        rank: rank,
                        place: placeFrom,
                        prize: prize,
                        tournName: tourn.name,
                        isBusted: isBusted
                    });

                    sendScoutEvent("TARGET_PLAYER_DISCOVERED", {
                        uuid: `target_${cleanNick}`,
                        name: rawNick,
                        tournament_id: curTournId,
                        chips: stack,
                        stack_bb: stackBB
                    });

                    updateHUD();
                }
            }
        }
    }

    // ── 3. ЦИКЛ АВТО-ОПРОСА ВСЕХ ТУРНИРОВ СЕТИ (24/7) ───────────────────
    let tournIdx = 0;
    setInterval(() => {
        if (!stalkerState.ws || !stalkerState.isAutoScanning) return;

        // 1. Если турниры не загружены — запрашиваем список
        if (stalkerState.activeTournaments.size === 0) {
            try {
                stalkerState.ws.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="1001"/>');
            } catch(e) {}
            return;
        }

        // 2. Опрашиваем игроков каждого идущего турнира по очереди
        let tournIds = Array.from(stalkerState.activeTournaments.keys());
        let targetTournId = tournIds[tournIdx % tournIds.length];
        tournIdx++;

        try {
            stalkerState.ws.send(`<EnterTournamentLobby id="${targetTournId}"/>`);
            stalkerState.ws.send(`<GetPlayers offset="0" count="50"/>`);
        } catch (e) {}
    }, 2000);

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

    // ── 4. ПЕРЕХВАТ WEBSOCKET ───────────────────────────────────────────
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

    console.log("🎯 [Global VIP Scout v4.0 Final] Запущен.");
})();

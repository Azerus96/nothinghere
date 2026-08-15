(function () {
    var oldHud = document.getElementById('gto-cuda-hud');
    if (oldHud) oldHud.remove();

    let serverUrl = localStorage.getItem('GTO_SERVER_URL') || "https://f8caa9b826c452.lhr.life";
    console.log('🚀 GTO CUDA Engine v15.0 (Real HUD Dossier + Real Node Locking) loaded!');

    var hud = document.createElement('div');
    hud.id = 'gto-cuda-hud';
    hud.style.cssText = 'position:fixed;top:30px;left:10px;z-index:999999999;background:rgba(10,15,25,0.96);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:10px;border-radius:10px;border:2px solid #6366f1;width:320px;box-shadow:0 10px 30px rgba(0,0,0,0.85);user-select:none;backdrop-filter:blur(6px);';
    
    hud.innerHTML = `
        <div id="gto-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="gto-dot">🟢</span>
                <strong style="color:#818cf8;font-size:13px;">⚡ GTO CUDA BOT (2x T4)</strong>
            </div>
            <div>
                <span id="gto-settings-btn" style="font-size:13px;margin-right:6px;cursor:pointer;" title="Настройки туннеля">⚙️</span>
                <span id="gto-arrow" style="font-size:14px;color:#818cf8;">🔼</span>
            </div>
        </div>

        <div id="gto-settings-box" style="display:none;background:#0f172a;padding:6px;border-radius:6px;margin-bottom:8px;border:1px solid #334155;">
            <div style="font-size:10px;color:#94a3b8;margin-bottom:2px;">URL туннеля Kaggle:</div>
            <input type="text" id="gto-url-input" value="${serverUrl}" style="width:100%;background:#1e293b;color:#fde047;border:1px solid #475569;border-radius:4px;padding:4px;font-size:11px;box-sizing:border-box;">
            <button id="gto-save-url" style="margin-top:4px;width:100%;background:#6366f1;color:#fff;border:none;border-radius:4px;padding:4px;font-size:10px;cursor:pointer;font-weight:bold;">Сохранить URL</button>
        </div>

        <div id="gto-body">
            <div id="gto-tables-bar" style="display:none;gap:4px;margin-bottom:8px;overflow-x:auto;padding-bottom:2px;"></div>

            <div style="display:flex;gap:6px;margin-bottom:8px;">
                <label style="flex:1;display:flex;align-items:center;gap:6px;background:rgba(99,102,241,0.15);padding:5px 8px;border-radius:6px;border:1px solid rgba(99,102,241,0.3);cursor:pointer;">
                    <input type="checkbox" id="gto-exploit-toggle" checked style="accent-color:#6366f1;">
                    <span style="color:#a5b4fc;font-size:10px;font-weight:bold;">🎯 Node Locking</span>
                </label>
                <label style="flex:1;display:flex;align-items:center;gap:6px;background:rgba(234,179,8,0.15);padding:5px 8px;border-radius:6px;border:1px solid rgba(234,179,8,0.3);cursor:pointer;">
                    <input type="checkbox" id="gto-automove" style="accent-color:#eab308;">
                    <span style="color:#fde047;font-size:10px;font-weight:bold;">⚡ Auto-Play</span>
                </label>
            </div>
            
            <div id="gto-hand-info" style="background:#1e293b;padding:8px;border-radius:6px;margin-bottom:6px;border:1px solid #334155;">
                <div style="color:#94a3b8;font-size:10px;display:flex;justify-content:space-between;margin-bottom:2px;">
                    <span>Позиция: <b id="gto-pos" style="color:#60a5fa">MP</b></span>
                    <span>Стек: <b id="gto-stack" style="color:#fde047">0.0 BB</b></span>
                </div>
                <div>Рука: <b id="gto-cards" style="color:#fde047;font-size:13px;">—</b> | Доска: <b id="gto-board" style="color:#60a5fa">—</b></div>
                <div id="gto-advice" style="margin-top:6px;padding-top:4px;border-top:1px dashed #475569;font-size:13px;font-weight:bold;color:#10b981;">
                    Ожидание раздачи...
                </div>
            </div>

            <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;font-weight:bold;">👥 ДОСЬЕ ОППОНЕНТОВ (HUD):</div>
            <div id="gto-dossier-list" style="max-height:110px;overflow-y:auto;background:#0f172a;padding:6px;border-radius:6px;border:1px solid #1e293b;font-size:10px;color:#cbd5e1;">
                <div style="color:#64748b;text-align:center;">Ожидание активных мест...</div>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    let isCollapsed = false;
    document.getElementById('gto-arrow').onclick = function (e) {
        e.stopPropagation();
        isCollapsed = !isCollapsed;
        document.getElementById('gto-body').style.display = isCollapsed ? 'none' : 'block';
        document.getElementById('gto-arrow').textContent = isCollapsed ? '🔽' : '🔼';
    };

    document.getElementById('gto-settings-btn').onclick = function (e) {
        e.stopPropagation();
        let box = document.getElementById('gto-settings-box');
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
    };

    document.getElementById('gto-save-url').onclick = function () {
        let val = document.getElementById('gto-url-input').value.trim().replace(/\/$/, "");
        localStorage.setItem('GTO_SERVER_URL', val);
        serverUrl = val;
        document.getElementById('gto-settings-box').style.display = 'none';
        alert('✅ URL сохранён: ' + val);
    };

    window.pokerdomMultiTable = {
        tables: new Map(),
        activeTableId: "table_main",

        getTable(tableId) {
            if (!this.tables.has(tableId)) {
                this.tables.set(tableId, {
                    id: tableId,
                    name: "Стол " + tableId.slice(-4),
                    mySeat: -1,
                    dealerSeat: 0,
                    bbSize: 100,
                    myStack: 0,
                    potChips: 0,
                    holeCards: [],
                    board: [],
                    activeSeatsCount: 8,
                    players: {}, // seat -> {name, uuid, vpip, pfr}
                    stage: 'PREFLOP',
                    lastAdviceHtml: 'Ожидание раздачи...',
                    ws: null,
                    isHeroTurn: false
                });
                this.activeTableId = tableId;
            }
            return this.tables.get(tableId);
        },

        setActiveTable(tableId) {
            this.activeTableId = tableId;
            updateUI();
        }
    };

    function calculatePosition(dealer, mySeat, totalSeats) {
        if (mySeat === -1) return 'MP';
        let diff = (mySeat - dealer + totalSeats) % totalSeats;
        if (diff === 0) return 'BTN';
        if (diff === 1) return 'SB';
        if (diff === 2) return 'BB';
        if (diff === 3) return 'UTG';
        if (diff === totalSeats - 1) return 'CO';
        return 'MP';
    }

    function parseXml(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        // Фильтрация ТОЛЬКО реальных столов Hero
        let tableMatch = xml.match(/<TableDetails[^>]*id="([^"]+)"/) || 
                         xml.match(/<OpenTournamentTable[^>]*id="([^"]+)"/) ||
                         xml.match(/<EnterTable[^>]*tableId="([^"]+)"/);

        let tableId = tableMatch ? tableMatch[1] : (window.pokerdomMultiTable.activeTableId || "table_main");
        let table = window.pokerdomMultiTable.getTable(tableId);
        table.ws = ws;

        // Блайнды
        let bbM = xml.match(/highStake="(\d+)"/) || xml.match(/PostBigBlind amount="(\d+)"/);
        if (bbM) table.bbSize = parseInt(bbM[1]);

        // Место героя и Дилер
        let meM = xml.match(/<Seats[^>]*me="(\d+)"/);
        if (meM) table.mySeat = parseInt(meM[1]);

        let dM = xml.match(/dealer="(\d+)"/);
        if (dM) table.dealerSeat = parseInt(dM[1]);

        // Сбор РЕАЛЬНЫХ UUID игроков за столом
        let playerMatches = xml.matchAll(/<Seat id="(\d+)">.*?<PlayerInfo[^>]*nickname="([^"]+)"[^>]*uuid="([^"]+)"/gs);
        for (let pm of playerMatches) {
            let sId = parseInt(pm[1]);
            if (!table.players[sId]) table.players[sId] = { vpip: false, pfr: false };
            table.players[sId].name = pm[2];
            table.players[sId].uuid = pm[3];
        }

        // Стеки
        let chipMatches = xml.matchAll(/<Seat[^>]*id="(\d+)".*?<Chips[^>]*stack-size="(\d+)"/gs);
        for (let cm of chipMatches) {
            let sId = parseInt(cm[1]);
            let st = parseInt(cm[2]);
            if (sId === table.mySeat) table.myStack = st;
        }

        // Банк
        let potM = xml.matchAll(/<Pot change="(\d+)"/g);
        for (let pm of potM) table.potChips += parseInt(pm[1]);

        // Отслеживание VPIP / PFR для HUD базы
        let betActions = xml.matchAll(/<PlayerAction seat="(\d+)"><(Bet|Raise|Call)/g);
        for (let ba of betActions) {
            let sId = parseInt(ba[1]);
            let act = ba[2];
            if (table.players[sId]) {
                table.players[sId].vpip = true;
                if (act === 'Raise') table.players[sId].pfr = true;
            }
        }

        // Новая раздача
        if (xml.includes('<NewHand')) {
            table.board = [];
            table.holeCards = [];
            table.potChips = 0;
            table.stage = 'PREFLOP';
            table.isHeroTurn = false;
            for (let s in table.players) {
                table.players[s].vpip = false;
                table.players[s].pfr = false;
            }
            table.lastAdviceHtml = `<span style="color:#38bdf8;">Префлоп. Ожидание флопа...</span>`;
            updateUI();
        }

        // Карты Героя
        if (xml.includes('<DealingCards')) {
            let seatCards = xml.matchAll(/<Seat id="(\d+)"><Cards>(.*?)<\/Cards><\/Seat>/gs);
            for (let sc of seatCards) {
                let sId = parseInt(sc[1]);
                let cMatches = sc[2].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (cMatches) {
                    let cards = cMatches.map(c => c.replace(/<[^>]+>/g, '').trim()).filter(c => c.toLowerCase() !== 'xx');
                    if (cards.length === 2) {
                        table.mySeat = sId;
                        table.holeCards = cards;
                        updateUI();
                    }
                }
            }
        }

        // Карты доски
        let boardChanged = false;
        if (xml.includes('<DealingFlop>')) {
            let flopCards = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/s);
            if (flopCards) {
                let c = flopCards[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (c) { 
                    table.board = c.map(x => x.replace(/<[^>]+>/g, '').trim()); 
                    table.stage = 'FLOP';
                    boardChanged = true;
                }
            }
        }
        if (xml.includes('<DealingTurn>')) {
            let turnCard = xml.match(/<DealingTurn><Cards><Card id="3">([A-Za-z0-9]+)<\/Card><\/Cards><\/DealingTurn>/);
            if (turnCard && !table.board.includes(turnCard[1])) {
                table.board.push(turnCard[1]);
                table.stage = 'TURN';
                boardChanged = true;
            }
        }
        if (xml.includes('<DealingRiver>')) {
            let riverCard = xml.match(/<DealingRiver><Cards><Card id="4">([A-Za-z0-9]+)<\/Card><\/Cards><\/DealingRiver>/);
            if (riverCard && !table.board.includes(riverCard[1])) {
                table.board.push(riverCard[1]);
                table.stage = 'RIVER';
                boardChanged = true;
            }
        }

        // Завершение руки -> отправка статов в базу на Kaggle
        if (xml.includes('<EndHand')) {
            sendHandStatsToDb(table);
            table.board = [];
            table.holeCards = [];
            table.stage = 'PREFLOP';
            table.isHeroTurn = false;
            table.lastAdviceHtml = `<span style="color:#64748b;">Раздача завершена.</span>`;
            updateUI();
        }

        // Ход Героя
        if (table.mySeat !== -1 && xml.includes('<ActiveChange') && xml.includes(`seat="${table.mySeat}"`)) {
            table.isHeroTurn = true;
            window.pokerdomMultiTable.activeTableId = tableId;
            requestGtoAdvice(table);
        } else if (boardChanged && table.isHeroTurn) {
            requestGtoAdvice(table);
        } else {
            updateUI();
        }
    }

    async function sendHandStatsToDb(table) {
        let playersPayload = [];
        for (let s in table.players) {
            let p = table.players[s];
            if (p.uuid && parseInt(s) !== table.mySeat) {
                playersPayload.push({
                    uuid: p.uuid,
                    name: p.name || "Opponent",
                    vpip: p.vpip,
                    pfr: p.pfr
                });
            }
        }
        if (playersPayload.length === 0) return;

        try {
            let currentUrl = localStorage.getItem('GTO_SERVER_URL') || serverUrl;
            await fetch(`${currentUrl}/api/track_hand`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ players: playersPayload })
            });
        } catch (e) {}
    }

    async function requestGtoAdvice(table) {
        let stackBB = table.bbSize > 0 ? (table.myStack / table.bbSize).toFixed(1) : "0.0";

        if (table.board.length < 3) {
            table.lastAdviceHtml = `<span style="color:#38bdf8;">Префлоп (${stackBB} BB). Ожидание флопа...</span>`;
            updateUI();
            return;
        }

        table.lastAdviceHtml = `<span style="color:#fbbf24;animation:pulse 1s infinite;">⚡ Расчёт 2x Tesla T4 DCFR...</span>`;
        updateUI();

        let pos = calculatePosition(table.dealerSeat, table.mySeat, table.activeSeatsCount);

        // Собираем РЕАЛЬНЫЕ UUID оппонентов
        let oppUuids = [];
        for (let s in table.players) {
            if (parseInt(s) !== table.mySeat && table.players[s].uuid) {
                oppUuids.push(table.players[s].uuid);
            }
        }

        let payload = {
            table_id: table.id,
            cards: { hero: table.holeCards, board: table.board },
            finances: { 
                big_blind: table.bbSize, 
                pot_chips: table.potChips || (table.bbSize * 10),
                hero_stack_chips: table.myStack || (table.bbSize * 25)
            },
            structure: { hero_position: pos, active_players_count: 4, opponents_uuids: oppUuids },
            exploit_mode: document.getElementById('gto-exploit-toggle')?.checked || false
        };

        try {
            let currentUrl = localStorage.getItem('GTO_SERVER_URL') || serverUrl;
            let res = await fetch(`${currentUrl}/api/advice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            let data = await res.json();

            if (data.status === "ok") {
                let lockBadge = data.mode.includes("Exploit") ? `<span style="color:#ef4444;font-size:10px;">[🎯 Lock: ${data.mode}]</span><br>` : '';
                let actColor = data.action_type === "BET" || data.action_type === "ALLIN" ? "#f87171" : (data.action_type === "FOLD" ? "#94a3b8" : "#4ade80");
                
                table.lastAdviceHtml = `${lockBadge}<span style="color:${actColor};font-size:14px;">👉 ${data.recommended_action}</span> <span style="font-size:10px;color:#64748b;">(${data.calc_time_ms}ms)</span>`;
                
                renderDossier(data.dossier);
                updateUI();

                if (document.getElementById('gto-automove')?.checked && table.ws) {
                    setTimeout(() => { executeAction(data.action_type, data.sizing_bb, table); }, 1000);
                }
            }
        } catch (e) {
            table.lastAdviceHtml = `<span style="color:#ef4444;">Ошибка связи с Kaggle</span>`;
            updateUI();
        }
    }

    function renderDossier(dossier) {
        let el = document.getElementById('gto-dossier-list');
        if (!el) return;
        if (!dossier || Object.keys(dossier).length === 0) {
            el.innerHTML = `<div style="color:#64748b;text-align:center;">Оппоненты: сбор статистики раздач...</div>`;
            return;
        }

        let html = '';
        for (let uuid in dossier) {
            let p = dossier[uuid];
            let dot = p.status === 'reliable' ? '🟢' : (p.status === 'partial' ? '🟡' : '⚪');
            let leakTag = p.leak !== "None" ? `<span style="color:#f87171;font-weight:bold;">[${p.leak}]</span>` : '';
            html += `<div style="display:flex;justify-content:space-between;margin-bottom:3px;border-bottom:1px solid #1e293b;padding-bottom:2px;">
                <span>${dot} <b>${p.name.substring(0,9)}</b> ${leakTag}</span>
                <span><b>${p.hands}</b>р | V:<b>${p.vpip}%</b> P:<b>${p.pfr}%</b></span>
            </div>`;
        }
        el.innerHTML = html;
    }

    function executeAction(type, sizingBB, table) {
        if (!table.ws || table.mySeat === -1) return;
        let xml = `<PlayerAction seat="${table.mySeat}">`;
        if (type === 'FOLD') {
            xml += `<Fold/>`;
        } else if (type === 'CHECK') {
            xml += `<Check/>`;
        } else if (type === 'CALL') {
            xml += `<Call/>`;
        } else if (type === 'BET' || type === 'ALLIN') {
            let chips = Math.round(sizingBB * table.bbSize);
            xml += `<Bet amount="${chips}"/>`;
        }
        xml += `</PlayerAction>`;
        try { table.ws.send(xml); } catch (e) {}
    }

    function updateUI() {
        let table = window.pokerdomMultiTable.getTable(window.pokerdomMultiTable.activeTableId || "table_main");

        let posEl = document.getElementById('gto-pos');
        let cardsEl = document.getElementById('gto-cards');
        let boardEl = document.getElementById('gto-board');
        let stackEl = document.getElementById('gto-stack');
        let adviceEl = document.getElementById('gto-advice');
        let tablesBar = document.getElementById('gto-tables-bar');

        if (posEl) posEl.innerText = calculatePosition(table.dealerSeat, table.mySeat, table.activeSeatsCount);
        if (cardsEl) cardsEl.innerText = table.holeCards.length ? table.holeCards.join(' ') : '—';
        if (boardEl) boardEl.innerText = table.board.length ? table.board.join(' ') : '—';
        if (stackEl) stackEl.innerText = (table.bbSize > 0 ? (table.myStack / table.bbSize).toFixed(1) : "0.0") + ' BB';
        if (adviceEl) adviceEl.innerHTML = table.lastAdviceHtml;

        if (tablesBar) {
            if (window.pokerdomMultiTable.tables.size > 1) {
                let html = '';
                window.pokerdomMultiTable.tables.forEach((t, tid) => {
                    let isAct = (tid === window.pokerdomMultiTable.activeTableId);
                    html += `<button onclick="window.pokerdomMultiTable.setActiveTable('${tid}')" style="background:${isAct ? '#6366f1' : '#1e293b'};color:#fff;border:1px solid #475569;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;white-space:nowrap;">${t.name}</button>`;
                });
                tablesBar.innerHTML = html;
                tablesBar.style.display = 'flex';
            } else {
                tablesBar.style.display = 'none';
            }
        }
    }

    if (!window.__gtoHooked) {
        window.__gtoHooked = true;
        const OrigWS = window.WebSocket;
        window.WebSocket = function (...args) {
            const ws = new OrigWS(...args);
            ws.addEventListener('message', (e) => {
                let raw = typeof e.data === 'string' ? e.data : (window.TextDecoder ? new TextDecoder().decode(e.data) : '');
                parseXml(raw, ws);
            });
            return ws;
        };
        window.WebSocket.prototype = OrigWS.prototype;
    }
})();

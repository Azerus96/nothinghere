(function () {
    var oldHud = document.getElementById('gto-cuda-hud');
    if (oldHud) oldHud.remove();

    // Загружаем сохраненный URL сервера из памяти браузера
    let serverUrl = localStorage.getItem('GTO_SERVER_URL') || "https://89dd72a020cb0.lhr.life";

    console.log('🚀 GTO CUDA Engine v12.0 (Multi-Table + Dynamic URL + 2x T4 Balanced) loaded!');

    // ── 1. СОЗДАНИЕ ИНТЕРФЕЙСА (HUD) ────────────────────────────────────
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

        <!-- Настройка ссылки туннеля -->
        <div id="gto-settings-box" style="display:none;background:#0f172a;padding:6px;border-radius:6px;margin-bottom:8px;border:1px solid #334155;">
            <div style="font-size:10px;color:#94a3b8;margin-bottom:2px;">URL туннеля Kaggle (localhost.run):</div>
            <input type="text" id="gto-url-input" value="${serverUrl}" style="width:100%;background:#1e293b;color:#fde047;border:1px solid #475569;border-radius:4px;padding:4px;font-size:11px;box-sizing:border-box;">
            <button id="gto-save-url" style="margin-top:4px;width:100%;background:#6366f1;color:#fff;border:none;border-radius:4px;padding:4px;font-size:10px;cursor:pointer;font-weight:bold;">Сохранить URL</button>
        </div>

        <div id="gto-body">
            <!-- Табы открытых столов при мультитейблинге -->
            <div id="gto-tables-bar" style="display:flex;gap:4px;margin-bottom:8px;overflow-x:auto;padding-bottom:2px;"></div>

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
            <div id="gto-dossier-list" style="max-height:100px;overflow-y:auto;background:#0f172a;padding:6px;border-radius:6px;border:1px solid #1e293b;font-size:10px;color:#cbd5e1;">
                <div style="color:#64748b;text-align:center;">Ожидание активных мест...</div>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    // Сворачивание HUD
    let isCollapsed = false;
    document.getElementById('gto-arrow').onclick = function (e) {
        e.stopPropagation();
        isCollapsed = !isCollapsed;
        document.getElementById('gto-body').style.display = isCollapsed ? 'none' : 'block';
        document.getElementById('gto-arrow').textContent = isCollapsed ? '🔽' : '🔼';
    };

    // Открытие окна настройки URL
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

    // ── 2. СИСТЕМА УПРАВЛЕНИЯ СТОЛАМИ (ИЗОЛЯЦИЯ МУЛЬТИТЕЙБЛИНГА) ────────
    window.pokerdomMultiTable = {
        tables: new Map(),
        activeTableId: null,

        getTable(tableId) {
            if (!this.tables.has(tableId)) {
                this.tables.set(tableId, {
                    id: tableId,
                    name: "Стол " + tableId.slice(-4),
                    mySeat: -1,
                    dealerSeat: 0,
                    bbSize: 100,
                    myStack: 0,
                    holeCards: [],
                    board: [],
                    activeSeatsCount: 8,
                    players: {},
                    stage: 'WAITING',
                    lastAdviceHtml: 'Ожидание раздачи...',
                    ws: null
                });
                if (!this.activeTableId) this.activeTableId = tableId;
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

    // ── 3. ПАРСЕР XML СООБЩЕНИЙ ─────────────────────────────────────────
    function parseXml(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        // Определяем, к какому столу относится пакет
        let tableIdMatch = xml.match(/tournamentId="([^"]+)"/) || 
                           xml.match(/lowestStackTableId="([^"]+)"/) || 
                           xml.match(/tableId="([^"]+)"/) ||
                           xml.match(/<Table id="([^"]+)"/);
        
        let tableId = tableIdMatch ? tableIdMatch[1] : (window.pokerdomMultiTable.activeTableId || "table_main");
        let table = window.pokerdomMultiTable.getTable(tableId);
        table.ws = ws;

        // 1. Блайнды из CurrentLevel / HandInfo
        let bbM = xml.match(/highStake="(\d+)"/) || xml.match(/bb="(\d+)"/);
        if (bbM) table.bbSize = parseInt(bbM[1]);

        // 2. Место Героя и Дилер
        let meM = xml.match(/<Seats[^>]*me="(\d+)"/);
        if (meM) table.mySeat = parseInt(meM[1]);

        let dM = xml.match(/<NewHand[^>]*dealer="(\d+)"/) || xml.match(/<Seats[^>]*dealer="(\d+)"/);
        if (dM) table.dealerSeat = parseInt(dM[1]);

        // 3. Игроки, UUID и Стеки
        let seatBlocks = xml.matchAll(/<Seat id="(\d+)">.*?<PlayerInfo[^>]*nickname="([^"]+)"[^>]*uuid="([^"]+)"/gs);
        for (let sm of seatBlocks) {
            let sId = parseInt(sm[1]);
            if (!table.players[sId]) table.players[sId] = {};
            table.players[sId].name = sm[2];
            table.players[sId].uuid = sm[3];
        }

        let chipMatches = xml.matchAll(/<Seat[^>]*id="(\d+)".*?<Chips[^>]*stack-size="(\d+)"/gs);
        for (let cm of chipMatches) {
            let sId = parseInt(cm[1]);
            let st = parseInt(cm[2]);
            if (table.players[sId]) table.players[sId].chips = st;
            if (sId === table.mySeat) table.myStack = st;
        }

        // 4. Сброс / Новая раздача: <NewHand>
        if (xml.includes('<NewHand')) {
            table.board = [];
            table.holeCards = [];
            table.stage = 'PREFLOP';
            table.lastAdviceHtml = `<span style="color:#94a3b8;">Префлоп. Ожидание флопа...</span>`;
            updateUI();
        }

        // 5. Карты Героя: ищем карты без "xx"
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

        // 6. Флоп / Тёрн / Ривер
        if (xml.includes('<DealingFlop>')) {
            let flopCards = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/s);
            if (flopCards) {
                let c = flopCards[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (c) { 
                    table.board = c.map(x => x.replace(/<[^>]+>/g, '').trim()); 
                    table.stage = 'FLOP';
                    updateUI(); 
                }
            }
        }
        if (xml.includes('<DealingTurn>')) {
            let turnCard = xml.match(/<DealingTurn><Cards><Card id="3">([A-Za-z0-9]+)<\/Card><\/Cards><\/DealingTurn>/);
            if (turnCard && !table.board.includes(turnCard[1])) {
                table.board.push(turnCard[1]);
                table.stage = 'TURN';
                updateUI();
            }
        }
        if (xml.includes('<DealingRiver>')) {
            let riverCard = xml.match(/<DealingRiver><Cards><Card id="4">([A-Za-z0-9]+)<\/Card><\/Cards><\/DealingRiver>/);
            if (riverCard && !table.board.includes(riverCard[1])) {
                table.board.push(riverCard[1]);
                table.stage = 'RIVER';
                updateUI();
            }
        }

        // 7. Очистка по завершению руки: <EndHand>
        if (xml.includes('<EndHand')) {
            table.board = [];
            table.holeCards = [];
            table.stage = 'WAITING';
            table.lastAdviceHtml = `<span style="color:#64748b;">Раздача завершена. Ожидание...</span>`;
            updateUI();
        }

        // 8. Наступил наш ход (<ActiveChange seat="Hero">)
        if (table.mySeat !== -1 && xml.includes('<ActiveChange') && xml.includes(`seat="${table.mySeat}"`)) {
            window.pokerdomMultiTable.activeTableId = tableId; // Автопереключение на активный стол
            handleActiveTurn(table);
        }
    }

    // ── 4. ОБРАБОТКА ХОДА (ПРЕФЛОП VS ПОСТФЛОП) ─────────────────────────
    async function handleActiveTurn(table) {
        // А) НА ПРЕФЛОПЕ — Моментальный вывод статуса без запроса к CUDA
        if (table.board.length < 3) {
            let stackBB = table.bbSize > 0 ? (table.myStack / table.bbSize).toFixed(1) : "0.0";
            table.lastAdviceHtml = `<span style="color:#38bdf8;">Префлоп (${stackBB} BB). Ожидание флопа...</span>`;
            updateUI();
            return;
        }

        // Б) НА ПОСТФЛОПЕ — Запуск полноценного DCFR на 2x Tesla T4
        table.lastAdviceHtml = `<span style="color:#fbbf24;animation:pulse 1s infinite;">⚡ Расчёт 2x Tesla T4 DCFR...</span>`;
        updateUI();

        let pos = calculatePosition(table.dealerSeat, table.mySeat, table.activeSeatsCount);
        let myStackBB = table.bbSize > 0 ? parseFloat((table.myStack / table.bbSize).toFixed(1)) : 25.0;

        let oppUuids = [];
        for (let s in table.players) {
            if (parseInt(s) !== table.mySeat && table.players[s].uuid) {
                oppUuids.push(table.players[s].uuid);
            }
        }

        // Исправлена запятая после board
        let payload = {
            table_id: table.id,
            cards: { hero: table.holeCards, board: table.board },
            finances: { 
                big_blind: table.bbSize, 
                pot_bb: 10.0, 
                hero_effective_stack_bb: myStackBB,
                pot_chips: table.bbSize * 10,
                hero_stack_chips: table.myStack
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
                let lockBadge = data.node_locked ? `<span style="color:#ef4444;font-size:10px;">[🎯 Lock: ${data.lock_target || 'Overfolder'}]</span><br>` : '';
                let actColor = data.action_type === "BET" || data.action_type === "RAISE" || data.action_type === "ALLIN" ? "#f87171" : (data.action_type === "FOLD" ? "#94a3b8" : "#4ade80");
                
                table.lastAdviceHtml = `${lockBadge}<span style="color:${actColor};font-size:14px;">👉 ${data.recommended_action}</span> <span style="font-size:10px;color:#64748b;">(${data.calc_time_ms}ms)</span>`;
                
                renderDossier(data.dossier);
                updateUI();

                if (document.getElementById('gto-automove')?.checked && table.ws) {
                    setTimeout(() => { executeAction(data.action_type, data.sizing_bb, table.mySeat, table.bbSize, table.ws); }, 1000);
                }
            }
        } catch (e) {
            table.lastAdviceHtml = `<span style="color:#ef4444;">Ошибка связи с Kaggle</span>`;
            updateUI();
        }
    }

    function renderDossier(dossier) {
        let el = document.getElementById('gto-dossier-list');
        if (!el || !dossier || Object.keys(dossier).length === 0) return;

        let html = '';
        for (let uuid in dossier) {
            let p = dossier[uuid];
            let dot = p.status === 'reliable' ? '🟢' : (p.status === 'partial' ? '🟡' : '⚪');
            html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                <span>${dot} <b>${p.name.substring(0,10)}</b> (${p.hands}р)</span>
                <span>VPIP:<b>${p.vpip}%</b> | PFR:<b>${p.pfr}%</b></span>
            </div>`;
        }
        el.innerHTML = html;
    }

    function executeAction(type, sizingBB, mySeat, bbSize, ws) {
        if (!ws || mySeat === -1) return;
        let xml = `<PlayerAction seat="${mySeat}">`;
        if (type === 'FOLD') xml += `<Fold/>`;
        else if (type === 'CHECK' || type === 'CALL') xml += `<Call/>`;
        else if (type === 'BET' || type === 'RAISE' || type === 'ALLIN') {
            let chips = Math.round(sizingBB * bbSize);
            xml += `<Raise amount="${chips}"/>`;
        }
        xml += `</PlayerAction>`;
        try { ws.send(xml); } catch (e) {}
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

        // Отрисовка табов для переключения столов
        if (tablesBar && window.pokerdomMultiTable.tables.size > 1) {
            let html = '';
            window.pokerdomMultiTable.tables.forEach((t, tid) => {
                let isAct = (tid === window.pokerdomMultiTable.activeTableId);
                html += `<button onclick="window.pokerdomMultiTable.setActiveTable('${tid}')" style="background:${isAct ? '#6366f1' : '#1e293b'};color:#fff;border:1px solid #475569;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;white-space:nowrap;">${t.name}</button>`;
            });
            tablesBar.innerHTML = html;
        }
    }

    // ── 5. ПЕРЕХВАТ WEBSOCKET ───────────────────────────────────────────
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

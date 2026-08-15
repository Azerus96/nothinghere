javascript:(function () {
    var oldHud = document.getElementById('gto-cuda-hud');
    if (oldHud) oldHud.remove();

    const SERVER_URL = "https://682eaa73dbce53.lhr.life"; // Ваш туннель Serveo

    console.log('🚀 GTO CUDA Engine v9.0 (Full HUD + Node Locking) loaded!');

    // ── 1. СОЗДАНИЕ ИНТЕРФЕЙСА (HUD) ────────────────────────────────────
    var hud = document.createElement('div');
    hud.id = 'gto-cuda-hud';
    hud.style.cssText = 'position:fixed;top:40px;left:10px;z-index:999999999;background:rgba(10,15,25,0.96);color:#fff;font-family:-apple-system,sans-serif;font-size:12px;padding:10px;border-radius:10px;border:2px solid #6366f1;width:310px;box-shadow:0 10px 30px rgba(0,0,0,0.85);user-select:none;backdrop-filter:blur(6px);';
    
    hud.innerHTML = `
        <div id="gto-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;border-bottom:1px solid #333;padding-bottom:6px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="gto-dot">🟢</span>
                <strong style="color:#818cf8;font-size:13px;">⚡ GTO CUDA BOT (2x T4)</strong>
            </div>
            <span id="gto-arrow" style="font-size:14px;color:#818cf8;">🔼</span>
        </div>
        <div id="gto-body">
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
            
            <!-- Инфо о раздаче -->
            <div id="gto-hand-info" style="background:#1e293b;padding:8px;border-radius:6px;margin-bottom:6px;border:1px solid #334155;">
                <div style="color:#94a3b8;font-size:10px;display:flex;justify-content:space-between;margin-bottom:2px;">
                    <span>Позиция: <b id="gto-pos" style="color:#60a5fa">MP</b></span>
                    <span>Стек: <b id="gto-stack" style="color:#fde047">0 BB</b></span>
                </div>
                <div>Рука: <b id="gto-cards" style="color:#fde047;font-size:13px;">—</b> | Доска: <b id="gto-board" style="color:#60a5fa">—</b></div>
                <div id="gto-advice" style="margin-top:6px;padding-top:4px;border-top:1px dashed #475569;font-size:13px;font-weight:bold;color:#10b981;">
                    Ожидание раздачи...
                </div>
            </div>

            <!-- Досье на оппонентов -->
            <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;font-weight:bold;">👥 ДОСЬЕ ОППОНЕНТОВ (HUD):</div>
            <div id="gto-dossier-list" style="max-height:110px;overflow-y:auto;background:#0f172a;padding:6px;border-radius:6px;border:1px solid #1e293b;font-size:10px;color:#cbd5e1;">
                <div style="color:#64748b;text-align:center;">Ожидание активных мест...</div>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    // Сворачивание панели
    let isCollapsed = false;
    document.getElementById('gto-header').onclick = function () {
        isCollapsed = !isCollapsed;
        document.getElementById('gto-body').style.display = isCollapsed ? 'none' : 'block';
        document.getElementById('gto-arrow').textContent = isCollapsed ? '🔽' : '🔼';
    };

    // ── 2. STATE MACHINE И ПАРСИНГ XML ──────────────────────────────────
    let tableState = {
        mySeat: -1,
        dealerSeat: 0,
        bbSize: 100,
        myStack: 0,
        holeCards: [],
        board: [],
        activeSeatsCount: 6,
        players: {},
        allowedActions: { fold: true, call: 0, minRaise: 0, maxRaise: 0 }
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
        if (!xml || typeof xml !== 'string') return;

        // 1. Блайнды и дилер
        let bbM = xml.match(/highStake="(\d+)"/) || xml.match(/bb="(\d+)"/);
        if (bbM) tableState.bbSize = parseInt(bbM[1]);

        let dM = xml.match(/dealer="(\d+)"/) || xml.match(/<Button seat="(\d+)"/);
        if (dM) tableState.dealerSeat = parseInt(dM[1]);

        // 2. Игроки и никнеймы
        let seatMatches = xml.matchAll(/<Seat id="(\d+)"[^>]*name="([^"]+)"[^>]*chips="(\d+)"/g);
        for (let sm of seatMatches) {
            tableState.players[parseInt(sm[1])] = { name: sm[2], chips: parseInt(sm[3]) };
        }

        // 3. Карты игрока (без мусора 'xx')
        if (xml.includes('<DealingCards') || xml.includes('<NewHand')) {
            let seatCards = xml.matchAll(/<Seat id="(\d+)"><Cards>(.*?)<\/Cards><\/Seat>/g);
            for (let sc of seatCards) {
                let sId = parseInt(sc[1]);
                let cMatches = sc[2].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (cMatches) {
                    let cards = cMatches.map(c => c.replace(/<[^>]+>/g, '').trim()).filter(c => c.toLowerCase() !== 'xx');
                    if (cards.length === 2) {
                        tableState.mySeat = sId;
                        tableState.holeCards = cards;
                        tableState.board = [];
                        updateUI();
                    }
                }
            }
        }

        // 4. Борд (Флоп / Тёрн / Ривер)
        if (xml.includes('<DealingFlop>')) {
            let flopCards = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/);
            if (flopCards) {
                let c = flopCards[1].match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/g);
                if (c) { tableState.board = c.map(x => x.replace(/<[^>]+>/g, '').trim()); updateUI(); }
            }
        }
        if (xml.includes('<DealingTurn>') || xml.includes('<DealingRiver>')) {
            let turnCard = xml.match(/<Card id="\d+">([A-Za-z0-9]+)<\/Card>/);
            if (turnCard && !tableState.board.includes(turnCard[1])) {
                tableState.board.push(turnCard[1]);
                updateUI();
            }
        }

        // 5. Очередь хода (<ActiveChange>)
        if (tableState.mySeat !== -1 && xml.includes('<ActiveChange') && xml.includes(`seat="${tableState.mySeat}"`)) {
            requestGtoAdvice(ws);
        }
    }

    // ── 3. ЗАПРОС К KAGGLE (GTO + NODE LOCKING) ─────────────────────────
    async function requestGtoAdvice(ws) {
        let adviceEl = document.getElementById('gto-advice');
        if (adviceEl) adviceEl.innerHTML = `<span style="color:#fbbf24;">● Расчёт 2x Tesla T4...</span>`;

        let pos = calculatePosition(tableState.dealerSeat, tableState.mySeat, tableState.activeSeatsCount);
        let myStackBB = tableState.bbSize > 0 ? (tableState.myStack / tableState.bbSize) : 50;

        let oppNames = [];
        for (let s in tableState.players) {
            if (parseInt(s) !== tableState.mySeat) oppNames.push(tableState.players[s].name);
        }

        let payload = {
            cards: { hero: tableState.holeCards, board: tableState.board },
            finances: { big_blind: tableState.bbSize, pot_bb: 10.0, hero_effective_stack_bb: myStackBB },
            structure: { hero_position: pos, active_players_count: Object.keys(tableState.players).length, opponents_names: oppNames },
            exploit_mode: document.getElementById('gto-exploit-toggle').checked
        };

        try {
            let res = await fetch(`${SERVER_URL}/api/advice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            let data = await res.json();

            if (data.status === "ok") {
                let lockBadge = data.node_locked ? `<span style="color:#ef4444;font-size:10px;">[🎯 Lock: ${data.lock_target}]</span><br>` : '';
                let actColor = data.action_type === "BET" || data.action_type === "RAISE" ? "#f87171" : (data.action_type === "FOLD" ? "#94a3b8" : "#4ade80");
                
                adviceEl.innerHTML = `${lockBadge}<span style="color:${actColor};font-size:14px;">👉 ${data.recommended_action}</span> <span style="font-size:10px;color:#64748b;">(${data.calc_time_ms}ms)</span>`;
                
                // Обновляем список досье
                renderDossier(data.dossier);

                // Авто-ход если включен чекбокс
                if (document.getElementById('gto-automove').checked) {
                    setTimeout(() => { executeAction(data.action_type, data.sizing_bb, ws); }, 1000);
                }
            }
        } catch (e) {
            adviceEl.innerHTML = `<span style="color:#ef4444;">Ошибка связи с Kaggle</span>`;
        }
    }

    function renderDossier(dossier) {
        let el = document.getElementById('gto-dossier-list');
        if (!el || !dossier || Object.keys(dossier).length === 0) return;

        let html = '';
        for (let name in dossier) {
            let p = dossier[name];
            let dot = p.status === 'reliable' ? '🟢' : (p.status === 'partial' ? '🟡' : '⚪');
            html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px;">
                <span>${dot} <b>${name.substring(0,10)}</b> (${p.hands}р)</span>
                <span>VPIP:<b>${p.vpip}%</b> | PFR:<b>${p.pfr}%</b></span>
            </div>`;
        }
        el.innerHTML = html;
    }

    function executeAction(type, sizingBB, ws) {
        let xml = `<PlayerAction seat="${tableState.mySeat}">`;
        if (type === 'FOLD') xml += `<Fold/>`;
        else if (type === 'CHECK' || type === 'CALL') xml += `<Call/>`;
        else if (type === 'BET' || type === 'RAISE') {
            let chips = Math.round(sizingBB * tableState.bbSize);
            xml += `<Raise amount="${chips}"/>`;
        }
        xml += `</PlayerAction>`;
        try { ws.send(xml); } catch (e) {}
    }

    function updateUI() {
        let posEl = document.getElementById('gto-pos');
        let cardsEl = document.getElementById('gto-cards');
        let boardEl = document.getElementById('gto-board');
        let stackEl = document.getElementById('gto-stack');

        if (posEl) posEl.innerText = calculatePosition(tableState.dealerSeat, tableState.mySeat, tableState.activeSeatsCount);
        if (cardsEl) cardsEl.innerText = tableState.holeCards.length ? tableState.holeCards.join(' ') : '—';
        if (boardEl) boardEl.innerText = tableState.board.length ? tableState.board.join(' ') : '—';
        if (stackEl) stackEl.innerText = (tableState.bbSize > 0 ? Math.round(tableState.myStack / tableState.bbSize) : 0) + ' BB';
    }

    // ── 4. WEBSOCKET HOOK ────────────────────────────────────────────────
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

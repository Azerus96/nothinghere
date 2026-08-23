javascript:(function(){
    if (window.__pokerLiveBBRecorderV22) {
        alert('🎯 LIVE BB HUD & RECORDER v22.0 уже активен!');
        return;
    }
    window.__pokerLiveBBRecorderV22 = true;

    const ftState = {
        isCollapsed: false,
        handsArchive: [],
        activeTables: new Map()
    };

    function calculatePositions(activeSeatsList, dealerSeatNum) {
        let seats = [...activeSeatsList].sort((a, b) => a - b);
        let n = seats.length;
        if (n === 0) return {};
        let dIdx = seats.indexOf(dealerSeatNum);
        if (dIdx === -1) dIdx = 0;

        let ordered = [];
        for (let i = 0; i < n; i++) ordered.push(seats[(dIdx + i) % n]);

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
                posMap[seat] = (i === remaining - 1) ? 'CO' : (i < standardPos.length ? standardPos[i] : `MP+${i}`);
            }
        }
        return posMap;
    }

    function getAttr(tagStr, attrName) {
        let m = tagStr.match(new RegExp(`(?:\\b|\\s)${attrName}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.tableName = 'Финальный Стол';
            this.seats = new Map();
            this.seatActions = new Map();
            this.showdownHands = new Map();
            this.currentHand = null;
            this.board = [];
            this.street = 'PREFLOP';
            this.dealerSeat = 0;
            this.currentSB = 0;
            this.currentBB = 0;
            this.currentAnte = 0;
            this.potTotal = 0;
            this.winnerPotSum = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
            this.activeSeatsInHand = new Set();
            this.positionsMap = {};
            this.streetCommitted = new Map();
        }

        resetHand(handNumber, dealerSeat) {
            this.currentHand = handNumber;
            this.dealerSeat = dealerSeat || 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.potTotal = 0;
            this.winnerPotSum = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
            this.activeSeatsInHand.clear();
            this.seatActions.clear();
            this.showdownHands.clear();
            this.streetCommitted.clear();

            this.seats.forEach(s => {
                s.stackStart = s.currentStack || 0;
            });
            updateFTUI();
        }

        setStreet(newStreet) {
            if (this.street !== newStreet) {
                this.street = newStreet;
                this.streetCommitted.clear();
            }
        }

        updateBoard(xml) {
            let boardDirect = xml.match(/<Board>(.*?)<\/Board>/i);
            if (boardDirect) {
                let c = Array.from(boardDirect[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (c.length >= 3) {
                    this.board = c.slice(0, 5);
                    if (this.board.length >= 3 && !this.playersOnFlop) this.playersOnFlop = this.activeSeatsInHand.size;
                    if (this.board.length === 5 && !this.playersOnRiver) this.playersOnRiver = this.activeSeatsInHand.size;
                    return;
                }
            }
            let f = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/i);
            if (f && this.board.length === 0) {
                let fc = Array.from(f[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (fc.length >= 3) {
                    this.board = fc.slice(0, 3);
                    this.setStreet('FLOP');
                    this.playersOnFlop = this.activeSeatsInHand.size;
                }
            }
            let t = xml.match(/<DealingTurn><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingTurn>/i);
            if (t && this.board.length === 3) {
                this.board.push(t[1] + t[2]);
                this.setStreet('TURN');
            }
            let r = xml.match(/<DealingRiver><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingRiver>/i);
            if (r && this.board.length === 4) {
                this.board.push(r[1] + r[2]);
                this.setStreet('RIVER');
                this.playersOnRiver = this.activeSeatsInHand.size;
            }
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
                let prev = this.streetCommitted.get(seatId) || 0;
                let add = (actionType === 'RAISE') ? Math.max(0, amount - prev) : amount;
                this.potTotal += add;
                this.streetCommitted.set(seatId, (actionType === 'RAISE') ? amount : (prev + amount));
            }
        }

        finalizeAndSaveHand() {
            if (!this.currentHand || this.seatActions.size === 0) return;

            let allSeats = new Set([...this.activeSeatsInHand, ...this.seatActions.keys(), ...this.seats.keys()]);
            let playersSummary = [];

            allSeats.forEach(seatNum => {
                if (this.activeSeatsInHand.has(seatNum) || this.seatActions.has(seatNum)) {
                    let seatInfo = this.seats.get(seatNum) || { nick: `Seat_${seatNum}`, stackStart: 0, currentStack: 0 };
                    let sCards = this.showdownHands.get(seatNum);
                    let stkStart = seatInfo.stackStart || 0;
                    let stkBB = this.currentBB > 0 ? parseFloat((stkStart / this.currentBB).toFixed(1)) : 0;

                    playersSummary.push({
                        seat: seatNum,
                        nick: seatInfo.nick || `Seat_${seatNum}`,
                        position: this.positionsMap[seatNum] || 'N/A',
                        stack_start: stkStart,
                        stack_bb: stkBB,
                        cards: sCards ? sCards.cards : 'xx xx',
                        is_muck_leak: sCards ? (sCards.isMuck ? 1 : 0) : 0,
                        actions: this.seatActions.get(seatNum) || []
                    });
                }
            });

            playersSummary.sort((a, b) => a.seat - b.seat);
            let finalPot = this.winnerPotSum > 0 ? this.winnerPotSum : this.potTotal;

            let fullHandObject = {
                hand_number: this.currentHand,
                tournament_name: this.tableName,
                tournament_id: this.tournId || 'MTT',
                table_id: this.tableId,
                timestamp: new Date().toISOString(),
                sb_level: this.currentSB,
                bb_level: this.currentBB,
                ante_level: this.currentAnte,
                pot_total: finalPot,
                board: this.board.join(' '),
                players_on_flop: this.playersOnFlop,
                players_on_river: this.playersOnRiver,
                players: playersSummary
            };

            let alreadyExists = ftState.handsArchive.some(h => h.hand_number === this.currentHand && h.table_id === this.tableId);
            if (!alreadyExists) {
                ftState.handsArchive.push(fullHandObject);
                updateFTUI();
            }
        }
    }

    // ── HUD С РЕАЛ-ТАЙМ СТЕКАМИ В ББ ──────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'ft-recorder-hud';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:96vw;max-width:440px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #22c55e;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="ft-dot" style="color:#22c55e;font-size:12px;">●</span>
                <strong style="color:#22c55e;font-size:12px;">LIVE BB HUD & RECORDER v22.0</strong>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-toggle-ft" style="background:transparent;border:1px solid #475569;color:#22c55e;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('ft-recorder-hud').remove();window.__pokerLiveBBRecorderV22=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="ft-hud-body" style="margin-top:8px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;background:#030712;padding:5px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:6px;">
                <span>Столов: <b id="ft-tables-count" style="color:#38bdf8;">0</b></span>
                <span>Записано: <b id="ft-hands-count" style="color:#22c55e;">0</b></span>
            </div>

            <!-- ЗДЕСЬ В РЕАЛЬНОМ ВРЕМЕНИ ОТОБРАЖАЮТСЯ СТЕКИ В ББ -->
            <div id="ft-live-tables" style="max-height:260px;overflow-y:auto;margin-bottom:8px;">
                <div style="color:#94a3b8;font-size:10px;text-align:center;padding:8px;">Ожидание активных раздач...</div>
            </div>

            <button id="btn-export-ft-json" style="width:100%;padding:8px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;">
                📥 Скачать JSON архив раздач
            </button>
        </div>
    `;
    document.body.appendChild(ui);

    document.getElementById('btn-toggle-ft').onclick = function() {
        ftState.isCollapsed = !ftState.isCollapsed;
        let body = document.getElementById('ft-hud-body');
        let btn = document.getElementById('btn-toggle-ft');
        if (ftState.isCollapsed) {
            body.style.display = 'none';
            btn.innerText = '▴';
        } else {
            body.style.display = 'block';
            btn.innerText = '▾';
        }
    };

    function updateFTUI() {
        let handsEl = document.getElementById('ft-hands-count');
        let tablesEl = document.getElementById('ft-tables-count');
        let liveEl = document.getElementById('ft-live-tables');
        if (!handsEl || !tablesEl || !liveEl) return;

        handsEl.innerText = ftState.handsArchive.length;
        tablesEl.innerText = ftState.activeTables.size;

        if (ftState.activeTables.size === 0) {
            liveEl.innerHTML = `<div style="color:#94a3b8;font-size:10px;text-align:center;padding:8px;">Ожидание столов...</div>`;
            return;
        }

        let html = '';
        ftState.activeTables.forEach(t => {
            let bbVal = t.currentBB || 1;
            html += `<div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;font-weight:bold;color:#38bdf8;border-bottom:1px solid #1e293b;padding-bottom:3px;margin-bottom:4px;">
                    <span>🟢 ${t.tableName}</span>
                    <span style="color:#f59e0b;">1 ББ = ${(bbVal).toLocaleString()}</span>
                </div>`;

            let sortedSeats = Array.from(t.seats.keys()).sort((a, b) => a - b);
            if (sortedSeats.length === 0) {
                html += `<div style="color:#64748b;font-size:10px;">Загрузка игроков...</div>`;
            } else {
                sortedSeats.forEach(sNum => {
                    let s = t.seats.get(sNum);
                    let stChips = s.currentStack || 0;
                    let stBB = bbVal > 0 ? (stChips / bbVal).toFixed(1) : '0.0';
                    let pos = t.positionsMap[sNum] || '—';
                    let inHand = t.activeSeatsInHand.has(sNum);
                    let sCards = t.showdownHands.get(sNum);

                    // Цветовая градация стека
                    let bbColor = parseFloat(stBB) < 15 ? '#ef4444' : (parseFloat(stBB) < 30 ? '#f59e0b' : '#22c55e');
                    let dot = inHand ? '🟢' : '⚪';
                    let cardsStr = sCards ? `<span style="color:#a855f7;font-weight:bold;">[${sCards.cards}]</span>` : '';

                    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:10.5px;">
                        <span>${dot} <b>${s.nick}</b> <span style="color:#94a3b8;">(${pos})</span> ${cardsStr}</span>
                        <span><b style="color:${bbColor};font-size:12px;">${stBB} BB</b> <span style="color:#64748b;font-size:9.5px;">(${(stChips).toLocaleString()})</span></span>
                    </div>`;
                });
            }
            html += `</div>`;
        });
        liveEl.innerHTML = html;
    }

    document.getElementById('btn-export-ft-json').onclick = function() {
        try {
            let exportData = {
                recorder_version: "v22.0_LIVE_BB_RECORDER",
                export_time: new Date().toISOString(),
                total_hands_recorded: ftState.handsArchive.length,
                recorded_hands: ftState.handsArchive
            };
            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_live_bb_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch(e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ПАРСЕР XML СОКЕТОВ ────────────────────────────────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable') || xml.includes('<Tables')) {
            let tableId = getAttr(xml, 'id') || getAttr(xml, 'tableId');
            let tournId = getAttr(xml, 'tournamentId');
            let tName = getAttr(xml, 'name') || getAttr(xml, 'tournamentName');

            if (tableId) {
                ws.__tableId = tableId;
                if (!ftState.activeTables.has(tableId)) {
                    let ctx = new TableContext(tableId, tournId);
                    if (tName) ctx.tableName = decodeHtml(tName);
                    ftState.activeTables.set(tableId, ctx);
                    ws.__tableContext = ctx;
                } else if (tName) {
                    ftState.activeTables.get(tableId).tableName = decodeHtml(tName);
                }
                updateFTUI();
            }
        }

        let tableCtx = ws.__tableContext || (ws.__tableId ? ftState.activeTables.get(ws.__tableId) : null);
        if (!tableCtx) {
            if (ftState.activeTables.size === 1) tableCtx = ftState.activeTables.values().next().value;
            else return;
        }

        let nameMatch = xml.match(/<TableDetails[^>]*\bname="([^"]*)"/i);
        if (nameMatch) tableCtx.tableName = decodeHtml(nameMatch[1]);

        // Считывание мест и стеков
        if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
            let seatBlocks = xml.matchAll(/<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>(.*?)<\/Seat>)/gs);
            for (let sb of seatBlocks) {
                let seatNum = parseInt(sb[2]);
                let seatBody = sb[3] || '';
                let rawNick = getAttr(seatBody, 'nickname');
                let stackM = seatBody.match(/stack-size="([^"]+)"/);
                let stack = stackM ? parseInt(stackM[1]) : 0;

                if (rawNick) {
                    let existing = tableCtx.seats.get(seatNum);
                    if (!existing) {
                        tableCtx.seats.set(seatNum, { nick: rawNick, currentStack: stack, stackStart: stack });
                    } else {
                        existing.nick = rawNick;
                        if (stack > 0) existing.currentStack = stack;
                    }
                }
            }
            updateFTUI();
        }

        // Обновление стеков из фишек
        if (xml.includes('<Chips ')) {
            let chipMatches = xml.matchAll(/<Seat\s+[^>]*\bid="(\d+)"[^>]*>.*?<Chips\s+[^>]*stack-size="(\d+)"/gs);
            for (let cm of chipMatches) {
                let sNum = parseInt(cm[1]);
                let stVal = parseInt(cm[2]);
                let sObj = tableCtx.seats.get(sNum);
                if (sObj && stVal > 0) sObj.currentStack = stVal;
            }
            updateFTUI();
        }

        // Уровень блайндов и раздачи
        if (xml.includes('<Message>') || xml.includes('<GameState')) {
            let hs = getAttr(xml, 'highStake');
            if (hs) tableCtx.currentBB = parseInt(hs);
            let ls = getAttr(xml, 'lowStake');
            if (ls) tableCtx.currentSB = parseInt(ls);

            let newHandMatch = xml.match(/<NewHand\s+[^>]*\bnumber="(\d+)"/);
            if (newHandMatch) {
                let dealerSeat = parseInt(getAttr(newHandMatch[0], 'dealer') || '0');
                tableCtx.resetHand(newHandMatch[1], dealerSeat);

                let activeSeatsMatch = xml.match(/<ActiveSeats>(.*?)<\/ActiveSeats>/);
                if (activeSeatsMatch) {
                    let seatsM = activeSeatsMatch[1].matchAll(/<Seat\s+id="(\d+)"/g);
                    for (let sm of seatsM) tableCtx.activeSeatsInHand.add(parseInt(sm[1]));
                    tableCtx.positionsMap = calculatePositions(Array.from(tableCtx.activeSeatsInHand), dealerSeat);
                }
                updateFTUI();
            }

            // Анте и блайнды
            let anteMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><PostAnte\s+amount="(\d+)"/g);
            for (let am of anteMatches) {
                let sNum = parseInt(am[1]);
                let amt = parseInt(am[2]);
                tableCtx.currentAnte = amt;
                tableCtx.potTotal += amt;
                let sObj = tableCtx.seats.get(sNum);
                if (sObj) sObj.currentStack = Math.max(0, sObj.currentStack - amt);
            }

            let sbMatch = xml.match(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><PostSmallBlind\s+amount="(\d+)"/);
            if (sbMatch) {
                let sNum = parseInt(sbMatch[1]);
                let amt = parseInt(sbMatch[2]);
                tableCtx.currentSB = amt;
                tableCtx.potTotal += amt;
                tableCtx.streetCommitted.set(sNum, amt);
                let sObj = tableCtx.seats.get(sNum);
                if (sObj) sObj.currentStack = Math.max(0, sObj.currentStack - amt);
            }

            let bbMatch = xml.match(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><PostBigBlind\s+amount="(\d+)"/);
            if (bbMatch) {
                let sNum = parseInt(bbMatch[1]);
                let amt = parseInt(bbMatch[2]);
                tableCtx.currentBB = amt;
                tableCtx.potTotal += amt;
                tableCtx.streetCommitted.set(sNum, amt);
                let sObj = tableCtx.seats.get(sNum);
                if (sObj) sObj.currentStack = Math.max(0, sObj.currentStack - amt);
            }

            tableCtx.updateBoard(xml);

            // Действия
            let playerActions = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*>(.*?)<\/PlayerAction>/gs);
            for (let pa of playerActions) {
                let seatNum = parseInt(pa[1]);
                let actionBody = pa[2];
                let seatInfo = tableCtx.seats.get(seatNum);
                let currentStack = seatInfo ? seatInfo.currentStack : 0;
                let actionAmount = parseInt(getAttr(actionBody, 'amount') || '0');

                if (actionBody.includes('<PostAnte') || actionBody.includes('<PostSmallBlind') || actionBody.includes('<PostBigBlind') || actionBody.includes('<Muck') || actionBody.includes('<Show') || actionBody.includes('<UseTimeBank')) continue;

                if (actionBody.includes('<UncalledBet')) {
                    if (seatInfo) seatInfo.currentStack += actionAmount;
                    updateFTUI();
                    continue;
                }

                let actName = 'ACTION';
                if (actionBody.includes('<Call')) {
                    actName = (actionAmount >= currentStack && currentStack > 0) ? 'CALL_ALLIN' : 'CALL';
                    if (seatInfo) seatInfo.currentStack = Math.max(0, currentStack - actionAmount);
                } else if (actionBody.includes('<AllIn')) {
                    actName = 'SHOVE_ALLIN';
                    if (seatInfo) seatInfo.currentStack = 0;
                } else if (actionBody.includes('<Raise')) {
                    actName = (actionAmount >= currentStack && currentStack > 0) ? 'SHOVE_ALLIN' : 'RAISE';
                    let prevComm = tableCtx.streetCommitted.get(seatNum) || 0;
                    let addChips = Math.max(0, actionAmount - prevComm);
                    if (seatInfo) seatInfo.currentStack = Math.max(0, currentStack - addChips);
                } else if (actionBody.includes('<Bet')) {
                    actName = (actionAmount >= currentStack && currentStack > 0) ? 'SHOVE_ALLIN' : 'BET';
                    if (seatInfo) seatInfo.currentStack = Math.max(0, currentStack - actionAmount);
                } else if (actionBody.includes('<Check')) {
                    actName = 'CHECK';
                } else if (actionBody.includes('<Fold')) {
                    actName = 'FOLD';
                    tableCtx.activeSeatsInHand.delete(seatNum);
                }

                tableCtx.recordAction(seatNum, actName, actionAmount);
                updateFTUI();
            }
        }

        // Вскрытия
        if (xml.includes('<Show') || xml.includes('<Muck>')) {
            let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
            for (let sm of showMatches) {
                let seatNum = parseInt(sm[1]);
                let cardsRaw = sm[2];
                let cardsParsed = Array.from(cardsRaw.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (cardsParsed.length === 2) {
                    tableCtx.showdownHands.set(seatNum, { cards: cardsParsed.join(' '), isMuck: sm[0].includes('<Muck') });
                }
            }
            updateFTUI();
        }

        // Победители
        if (xml.includes('<Winners>')) {
            let winnerMatches = xml.matchAll(/<Winner\s+[^>]*amount="(\d+)"[^>]*seat="(\d+)"/g);
            for (let wm of winnerMatches) {
                let winAmt = parseInt(wm[1]);
                let winSeat = parseInt(wm[2]);
                tableCtx.winnerPotSum += winAmt;
                let sObj = tableCtx.seats.get(winSeat);
                if (sObj) sObj.currentStack += winAmt;
            }
            updateFTUI();
        }

        // Вылет игрока
        if (xml.includes('<Knockout ') || xml.includes('<TournamentPlayerRanked')) {
            let koMatch = xml.match(/<Knockout\s+[^>]*busted="(\d+)"/i);
            let rankedMatch = xml.match(/<TournamentPlayerRanked\s+[^>]*seat="(\d+)"/i);
            let bustedSeat = koMatch ? parseInt(koMatch[1]) : (rankedMatch ? parseInt(rankedMatch[1]) : null);
            if (bustedSeat !== null) {
                let bObj = tableCtx.seats.get(bustedSeat);
                if (bObj) bObj.currentStack = 0;
            }
            updateFTUI();
        }

        if (xml.includes('<EndHand')) {
            tableCtx.finalizeAndSaveHand();
        }
    }

    // ── ПЕРЕХВАТ WEBSOCKET ────────────────────────────────────────────
    async function decodePayload(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            let buffer = data instanceof ArrayBuffer ? data : (data instanceof Blob ? await data.arrayBuffer() : data.buffer);
            let uint8 = new Uint8Array(buffer);
            if (uint8.length > 2 && ((uint8[0] === 0x1f && uint8[1] === 0x8b) || (uint8[0] === 0x78))) {
                let ds = new DecompressionStream(uint8[0] === 0x1f ? 'gzip' : 'deflate');
                let stream = new Response(buffer).body.pipeThrough(ds);
                return await new Response(stream).text();
            }
            return new TextDecoder('utf-8').decode(buffer);
        } catch(e) { return String(data); }
    }

    function hookWs(ws) {
        if (!ws || ws.__ftHooked) return;
        ws.__ftHooked = true;
        ws.addEventListener('message', async function (e) {
            let text = await decodePayload(e.data);
            parseXmlStream(text, ws);
        });
        ws.addEventListener('close', function() {
            if (ws.__tableId) {
                ftState.activeTables.delete(ws.__tableId);
                updateFTUI();
            }
        });
    }

    var OrigWS = window.WebSocket;
    if (OrigWS) {
        window.WebSocket = function (...args) {
            let ws = new OrigWS(...args);
            hookWs(ws);
            return ws;
        };
        window.WebSocket.prototype = OrigWS.prototype;

        let origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function (data) {
            hookWs(this);
            return origSend.apply(this, arguments);
        };
    }

    console.log("🟢 [LIVE BB HUD v22.0] Запущен. Стеки в ББ отображаются в реальном времени!");
})();

javascript:(function(){
    if (window.__pokerFTRecorderV21) {
        alert('🎯 FINAL TABLE RECORDER v21.0 уже активен и записывает столы!');
        return;
    }
    window.__pokerFTRecorderV21 = true;

    // ── ГЛОБАЛЬНЫЙ АРХИВ РАЗДАЧ (В ПАМЯТИ ТЕЛЕФОНА) ───────────────────
    const ftState = {
        isCollapsed: false,
        handsArchive: [], // Сюда складываются 100% полных раздач
        activeTables: new Map() // tableId -> TableContext
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

    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.tableName = 'Финальный Стол';
            this.seats = new Map(); // seatNum -> { nick, stackStart, currentStack }
            this.seatActions = new Map();
            this.showdownHands = new Map(); // seatNum -> { cards, isMuck }
            this.currentHand = null;
            this.board = [];
            this.street = 'PREFLOP';
            this.dealerSeat = 0;
            this.currentSB = 0;
            this.currentBB = 0;
            this.currentAnte = 0;
            this.potTotal = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
            this.activeSeatsInHand = new Set();
            this.positionsMap = {};
        }

        resetHand(handNumber, dealerSeat) {
            this.currentHand = handNumber;
            this.dealerSeat = dealerSeat || 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.potTotal = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
            this.activeSeatsInHand.clear();
            this.seatActions.clear();
            this.showdownHands.clear();

            this.seats.forEach(s => {
                s.stackStart = s.currentStack || 0;
            });
        }

        updateBoard(xml) {
            // 1. Прямой тег <Board> (Префлоп олл-ин)
            let boardDirect = xml.match(/<Board>(.*?)<\/Board>/i);
            if (boardDirect) {
                let c = Array.from(boardDirect[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (c.length >= 3) {
                    this.board = c.slice(0, 5);
                    return;
                }
            }
            // 2. Флоп (строго 3 карты)
            let f = xml.match(/<DealingFlop><Cards>(.*?)<\/Cards><\/DealingFlop>/i);
            if (f && this.board.length === 0) {
                let fc = Array.from(f[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (fc.length >= 3) {
                    this.board = fc.slice(0, 3);
                    this.playersOnFlop = this.activeSeatsInHand.size;
                }
            }
            // 3. Терн (4-я карта)
            let t = xml.match(/<DealingTurn><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingTurn>/i);
            if (t && this.board.length === 3) {
                this.board.push(t[1] + t[2]);
            }
            // 4. Ривер (5-я карта)
            let r = xml.match(/<DealingRiver><Cards><Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card><\/Cards><\/DealingRiver>/i);
            if (r && this.board.length === 4) {
                this.board.push(r[1] + r[2]);
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

            if (amount > 0) this.potTotal += amount;
        }

        finalizeAndSaveHand() {
            if (!this.currentHand || this.seatActions.size === 0) return;

            let playersSummary = [];
            this.seats.forEach((seatInfo, seatNum) => {
                if (this.activeSeatsInHand.has(seatNum) || this.seatActions.has(seatNum)) {
                    let sCards = this.showdownHands.get(seatNum);
                    playersSummary.push({
                        seat: seatNum,
                        nick: seatInfo.nick,
                        position: this.positionsMap[seatNum] || 'N/A',
                        stack_start: seatInfo.stackStart || 0,
                        stack_bb: this.currentBB > 0 ? parseFloat(((seatInfo.stackStart || 0) / this.currentBB).toFixed(1)) : 0,
                        cards: sCards ? sCards.cards : 'xx xx',
                        is_muck_leak: sCards ? (sCards.isMuck ? 1 : 0) : 0,
                        actions: this.seatActions.get(seatNum) || []
                    });
                }
            });

            let fullHandObject = {
                hand_number: this.currentHand,
                tournament_name: this.tableName,
                tournament_id: this.tournId || 'MTT',
                table_id: this.tableId,
                timestamp: new Date().toISOString(),
                sb_level: this.currentSB,
                bb_level: this.currentBB,
                ante_level: this.currentAnte,
                pot_total: this.potTotal,
                board: this.board.join(' '),
                players_on_flop: this.playersOnFlop,
                players_on_river: this.playersOnRiver,
                players: playersSummary
            };

            // Проверка на дубликаты
            let alreadyExists = ftState.handsArchive.some(h => h.hand_number === this.currentHand && h.table_id === this.tableId);
            if (!alreadyExists) {
                ftState.handsArchive.push(fullHandObject);
                updateFTUI();
            }
        }
    }

    function getAttr(tagStr, attrName) {
        let m = tagStr.match(new RegExp(`(?:\\b|\\s)${attrName}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    // ── ИНТЕРФЕЙС HUD ────────────────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'ft-recorder-hud';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:420px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #22c55e;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="ft-dot" style="color:#22c55e;font-size:12px;">●</span>
                <strong style="color:#22c55e;font-size:12px;">FINAL TABLE RECORDER v21.0</strong>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-toggle-ft" style="background:transparent;border:1px solid #475569;color:#22c55e;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('ft-recorder-hud').remove();window.__pokerFTRecorderV21=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="ft-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Открытых столов: <b id="ft-tables-count" style="color:#38bdf8;">0</b></span>
                    <span style="color:#4ade80;">100% Запись в RAM</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#cbd5e1;margin-top:4px;">
                    <span>Записано раздач: <b id="ft-hands-count" style="color:#22c55e;font-size:13px;">0</b></span>
                </div>
            </div>

            <div id="ft-tables-list" style="max-height:160px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;font-size:10px;">
                Откройте финальные столы в Покердоме...
            </div>

            <button id="btn-export-ft-json" style="width:100%;padding:9px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:12px;cursor:pointer;box-shadow:0 4px 14px rgba(22,163,74,0.4);">
                📥 Скачать полный JSON (Все раздачи)
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
        let listEl = document.getElementById('ft-tables-list');
        if (!handsEl || !tablesEl) return;

        handsEl.innerText = ftState.handsArchive.length;
        tablesEl.innerText = ftState.activeTables.size;

        if (ftState.activeTables.size > 0 && listEl) {
            let html = '';
            ftState.activeTables.forEach(t => {
                html += `<div style="border-bottom:1px solid #1e293b;padding:3px 0;display:flex;justify-content:space-between;">
                    <span>🟢 <b>${t.tableName}</b></span>
                    <span style="color:#38bdf8;">ББ: ${t.currentBB || '...'}</span>
                </div>`;
            });
            listEl.innerHTML = html;
        }
    }

    // ── СКАЧИВАНИЕ JSON (0.01 СЕКУНДЫ) ────────────────────────────────
    document.getElementById('btn-export-ft-json').onclick = function() {
        try {
            let exportData = {
                recorder_version: "v21.0_FINAL_TABLE_RECORDER",
                export_time: new Date().toISOString(),
                total_hands_recorded: ftState.handsArchive.length,
                recorded_hands: ftState.handsArchive
            };

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_final_tables_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch(e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ПАССИВНЫЙ ПЕРЕХВАТЧИК СОКЕТОВ (0% НАГРУЗКИ) ───────────────────
    function parseXmlStream(xml, ws) {
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        // Привязка стола
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
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
        if (!tableCtx) return;

        // Места и игроки за столом
        if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
            let seatBlocks = xml.matchAll(/<Seat\s+([^>]*\bid="(\d+)"[^>]*)>(.*?)<\/Seat>/gs);
            for (let sb of seatBlocks) {
                let seatNum = parseInt(sb[2]);
                let seatContent = sb[3];
                let rawNick = getAttr(seatContent, 'nickname');
                let stackM = seatContent.match(/stack-size="([^"]+)"/);
                let stack = stackM ? parseInt(stackM[1]) : 0;

                if (rawNick) {
                    tableCtx.seats.set(seatNum, {
                        nick: rawNick,
                        currentStack: stack,
                        stackStart: stack
                    });
                }
            }
        }

        // Жизненный цикл раздачи
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
                        tableCtx.activeSeatsInHand.add(parseInt(sm[1]));
                    }
                    tableCtx.positionsMap = calculatePositions(Array.from(tableCtx.activeSeatsInHand), dealerSeat);
                }
            }

            // Постинг анте и блайндов
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
                tableCtx.currentBB = amt;
                tableCtx.potTotal += amt;
            }

            // Обновление доски
            tableCtx.updateBoard(xml);

            // Действия игроков
            let playerActions = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*>(.*?)<\/PlayerAction>/gs);
            for (let pa of playerActions) {
                let seatNum = parseInt(pa[1]);
                let actionBody = pa[2];
                let seatInfo = tableCtx.seats.get(seatNum);
                let currentStack = seatInfo ? seatInfo.currentStack : 0;
                let actionAmount = parseInt(getAttr(actionBody, 'amount') || '0');

                let actName = 'ACTION';
                if (actionBody.includes('<Call')) {
                    actName = (actionAmount >= currentStack && currentStack > 0) ? 'CALL_ALLIN' : 'CALL';
                    if (seatInfo) seatInfo.currentStack = Math.max(0, currentStack - actionAmount);
                } else if (actionBody.includes('<AllIn')) {
                    actName = 'SHOVE_ALLIN';
                    if (seatInfo) seatInfo.currentStack = 0;
                } else if (actionBody.includes('<Raise') || actionBody.includes('<Bet')) {
                    actName = (actionAmount >= currentStack && currentStack > 0) ? 'SHOVE_ALLIN' : (actionBody.includes('<Raise') ? 'RAISE' : 'BET');
                    if (seatInfo) seatInfo.currentStack = Math.max(0, currentStack - actionAmount);
                } else if (actionBody.includes('<Check')) {
                    actName = 'CHECK';
                } else if (actionBody.includes('<Fold')) {
                    actName = 'FOLD';
                    tableCtx.activeSeatsInHand.delete(seatNum);
                }

                tableCtx.recordAction(seatNum, actName, actionAmount);
            }
        }

        // Вскрытия и Muck Leak
        if (xml.includes('<Show') || xml.includes('<Muck>')) {
            let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
            for (let sm of showMatches) {
                let seatNum = parseInt(sm[1]);
                let cardsRaw = sm[2];
                let cardsParsed = Array.from(cardsRaw.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                
                if (cardsParsed.length === 2) {
                    let isMuck = sm[0].includes('<Muck');
                    tableCtx.showdownHands.set(seatNum, {
                        cards: cardsParsed.join(' '),
                        isMuck: isMuck
                    });
                }
            }
        }

        // Конец раздачи — моментальное сохранение в архив
        if (xml.includes('<EndHand') || xml.includes('<Winners>')) {
            tableCtx.finalizeAndSaveHand();
        }
    }

    // ── ХУК WEBSOCKET (ТОЛЬКО ПРОСЛУШКА) ──────────────────────────────
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

    console.log("🟢 [FINAL TABLE RECORDER v21.0] Готов к перехвату раздач.");
})();

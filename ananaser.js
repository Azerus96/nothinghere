javascript:(function(){
    if (window.__ofcStalkerV1Master) {
        alert('🍍 OFC Pineapple Stalker v1.0 уже запущен!');
        return;
    }
    window.__ofcStalkerV1Master = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE SCALPEL v1.0 — ORACLE & CFR DATA ENGINE
       ══════════════════════════════════════════════════════════════════ */

    const ofcState = {
        activeTables: new Map(),
        completedHands: [],
        chatLogs: [],
        recordedHandNumbers: new Set()
    };

    function attr(str, name) {
        if (!str || typeof str !== 'string') return null;
        let m = str.match(new RegExp(`(?:\\b|\\s)${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function iattr(str, name) {
        let v = attr(str, name);
        if (!v) return null;
        let n = parseInt(v, 10);
        return isNaN(n) ? null : n;
    }

    class OFCTableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.tableName = 'OFC Стол ' + (tableId ? String(tableId).substr(-4) : '');
            this.pointScore = 100;
            this.fantasyMode = 'NONE';
            this.seats = new Map();
            this.handNumber = null;
            this.dealer = 0;
            this.streets = new Map(); // seat -> array of streets
            this.discards = new Map(); // seat -> array of dead cards
            this.finalLayouts = new Map(); // seat -> { front: [], middle: [], back: [] }
            this.royalties = new Map(); // seat -> { front: 0, middle: 0, back: 0 }
            this.fouls = new Set();
            this.winners = [];
            this.showdowns = [];
        }

        ensureSeat(seatNum, rawNick) {
            if (!this.seats.has(seatNum)) {
                this.seats.set(seatNum, {
                    seat: seatNum,
                    rawNick: rawNick || `Seat ${seatNum}`,
                    cleanNick: (rawNick || `seat_${seatNum}`).toLowerCase().trim()
                });
            }
            return this.seats.get(seatNum);
        }

        beginHand(handNum, dealerSeat, pointScore) {
            this.handNumber = handNum;
            this.dealer = dealerSeat;
            this.pointScore = pointScore || this.pointScore;
            this.streets.clear();
            this.discards.clear();
            this.finalLayouts.clear();
            this.royalties.clear();
            this.fouls.clear();
            this.winners = [];
            this.showdowns = [];

            this.seats.forEach((s, sn) => {
                this.streets.set(sn, []);
                this.discards.set(sn, []);
                this.finalLayouts.set(sn, { front: [], middle: [], back: [] });
                this.royalties.set(sn, { front: 0, middle: 0, back: 0 });
            });
        }

        recordPlacement(seatNum, streetNum, layoutXml) {
            let discM = layoutXml.match(/<Discarded>(.*?)<\/Discarded>/);
            if (discM) {
                let dCards = Array.from(discM[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (dCards.length) {
                    let curD = this.discards.get(seatNum) || [];
                    curD.push(...dCards);
                    this.discards.set(seatNum, curD);
                }
            }

            let lay = this.finalLayouts.get(seatNum) || { front: [], middle: [], back: [] };
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let rM = layoutXml.match(new RegExp(`<Hand\\s+name="${row}">([\\s\\S]*?)<\\/Hand>`, 'i'));
                if (rM) {
                    let rCards = Array.from(rM[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                    lay[row.toLowerCase()] = rCards;
                }
            });
            this.finalLayouts.set(seatNum, lay);
        }

        finalize() {
            if (!this.handNumber) return null;

            let players = [];
            this.seats.forEach((s, sn) => {
                let lay = this.finalLayouts.get(sn) || { front: [], middle: [], back: [] };
                let win = this.winners.find(w => w.seat === sn) || { score: 0, amount: 0 };
                let roy = this.royalties.get(sn) || { front: 0, middle: 0, back: 0 };

                players.push({
                    seat: sn,
                    nick: s.rawNick,
                    cleanNick: s.cleanNick,
                    is_foul: this.fouls.has(sn),
                    discarded_dead_cards: this.discards.get(sn) || [],
                    final_board: lay,
                    royalties: roy,
                    score_points: win.score || 0,
                    chips_delta: win.amount || 0
                });
            });

            return {
                hand_number: this.handNumber,
                game_type: "OFC_PINEAPPLE",
                fantasy_mode: this.fantasyMode,
                point_score_rub: this.pointScore,
                table_id: this.tableId,
                table_name: this.tableName,
                timestamp: new Date().toISOString(),
                dealer_seat: this.dealer,
                showdowns: this.showdowns,
                players: players
            };
        }
    }

    function parseOfcXml(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        // Контекст турнира / стола
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
            let tableId = attr(xml, 'id') || attr(xml, 'tableId');
            let tournId = attr(xml, 'tournamentId');
            let tName = attr(xml, 'name') || attr(xml, 'tournamentName');
            let pScore = iattr(xml, 'pointScore') || 100;
            let fant = attr(xml, 'fantasy') || 'PROGRESSIVE';

            if (tableId) {
                let ctx = new OFCTableContext(tableId, tournId);
                ctx.tableName = tName || ctx.tableName;
                ctx.pointScore = pScore;
                ctx.fantasyMode = fant;
                ofcState.activeTables.set(tableId, ctx);
                ws.__ofcTable = ctx;
            }
        }

        let ctx = ws.__ofcTable;
        if (!ctx) return;

        // Синхронизация мест
        if (xml.includes('<Seat ') && xml.includes('<PlayerInfo')) {
            let seatMatches = xml.matchAll(/<Seat\s+[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<PlayerInfo[^>]*nickname="([^"]+)"/g);
            for (let sm of seatMatches) {
                ctx.ensureSeat(parseInt(sm[1], 10), sm[2]);
            }
        }

        // Старт новой раздачи
        let nhM = xml.match(/<NewHand\s+([^>]*)\/>/);
        if (nhM) {
            let hNum = attr(nhM[1], 'number');
            let dealer = iattr(nhM[1], 'dealer') || 0;
            let pScore = iattr(nhM[1], 'pointScore') || ctx.pointScore;
            ctx.beginHand(hNum, dealer, pScore);
        }

        // Фиксация раскладки и сбросов карт игроком
        let actMatches = xml.matchAll(/<PlayerAction\s+seat="(\d+)"[^>]*>([\s\S]*?)<\/PlayerAction>/g);
        for (let am of actMatches) {
            let seatNum = parseInt(am[1], 10);
            let body = am[2];
            if (body.includes('<LayOut')) {
                ctx.recordPlacement(seatNum, 0, body);
            }
        }

        // Фиксация фолов и роялти
        let combMatches = xml.matchAll(/<CombinationChange\s+([^>]*?)>([\s\S]*?)<\/CombinationChange>/g);
        for (let cm of combMatches) {
            let cAttr = cm[1];
            let seatNum = iattr(cAttr, 'seat');
            if (cAttr.includes('dead="true"')) {
                ctx.fouls.add(seatNum);
            }

            let royObj = ctx.royalties.get(seatNum) || { front: 0, middle: 0, back: 0 };
            let handMatches = cm[2].matchAll(/<Hand\s+name="(\w+)"\s+royalty="(\d+)"/g);
            for (let hm of handMatches) {
                let row = hm[1].toLowerCase();
                royObj[row] = parseInt(hm[2], 10);
            }
            ctx.royalties.set(seatNum, royObj);
        }

        // Перехват шоудаунов и скупов
        let sdMatches = xml.matchAll(/<Showdown\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Showdown>)/g);
        for (let sm of sdMatches) {
            let sAttr = sm[1];
            ctx.showdowns.push({
                first_seat: iattr(sAttr, 'firstSeat'),
                second_seat: iattr(sAttr, 'secondSeat'),
                points: iattr(sAttr, 'points'),
                is_scoop: (iattr(sAttr, 'scoop') || 0) > 0,
                cash_delta: iattr(sAttr, 'cash') || 0
            });
        }

        // Итоги раздачи
        let winMatches = xml.matchAll(/<Winner\s+([^>]*)\/>/g);
        for (let wm of winMatches) {
            let wAttr = wm[1];
            ctx.winners.push({
                seat: iattr(wAttr, 'seat'),
                score: iattr(wAttr, 'score'),
                amount: iattr(wAttr, 'amount')
            });
        }

        // Завершение раздачи и архивация в JSON
        if (xml.includes('<EndHand')) {
            let finalized = ctx.finalize();
            if (finalized && !ofcState.recordedHandNumbers.has(finalized.hand_number)) {
                ofcState.recordedHandNumbers.add(finalized.hand_number);
                ofcState.completedHands.push(finalized);
                console.log("%c🍍 [OFC Hand Archived] #" + finalized.hand_number + " | " + finalized.table_name, "color:#10b981;font-weight:bold;");
            }
            ctx.handNumber = null;
        }

        // Фильтрация и перехват чата (без дилерского спама)
        let chatM = xml.match(/<ChatMessage\s+([^>]*)\/>/);
        if (chatM) {
            let cAttr = chatM[1];
            let type = attr(cAttr, 'type');
            let sender = attr(cAttr, 'from');
            let text = attr(cAttr, 'text');

            if (type === 'USER' && sender && text && !/Dealer|Дилер|Система/i.test(sender)) {
                ofcState.chatLogs.push({
                    time: new Date().toLocaleTimeString(),
                    table_name: ctx.tableName,
                    sender: sender,
                    message: text
                });
            }
        }
    }

    // Перехват WebSocket
    let OrigWS = window.WebSocket;
    if (OrigWS && !window.__ofcWsHooked) {
        window.__ofcWsHooked = true;
        window.WebSocket = new Proxy(OrigWS, {
            construct: function(target, args) {
                let ws = Reflect.construct(target, args);
                ws.addEventListener('message', async function(e) {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    parseOfcXml(text, ws);
                });
                return ws;
            }
        });
    }

    // Создание плавающей кнопки экспорта
    let btn = document.createElement('button');
    btn.id = 'btn-ofc-export';
    btn.innerText = '🍍 Экспорт OFC JSON (' + ofcState.completedHands.length + ')';
    btn.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:999999999;background:linear-gradient(90deg,#06b6d4,#10b981);color:#000;font-weight:800;font-size:12px;padding:10px 16px;border:none;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.8);cursor:pointer;';
    
    btn.onclick = function() {
        let dump = {
            discipline: "OFC_PINEAPPLE",
            timestamp: new Date().toISOString(),
            total_hands: ofcState.completedHands.length,
            recorded_hands: ofcState.completedHands,
            chat_logs: ofcState.chatLogs
        };
        let blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_pineapple_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    document.body.appendChild(btn);

    setInterval(() => {
        let b = document.getElementById('btn-ofc-export');
        if (b) b.innerText = `🍍 Экспорт OFC JSON (${ofcState.completedHands.length})`;
    }, 2000);

    console.log("%c🍍 [OFC Scalpel v1.0] Запущен. Перехват раскладок, сбросов и роялти активирован.", "color:#10b981;font-weight:bold;");
})();

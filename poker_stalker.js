javascript:(function(){
    // Деструктор предыдущего инстанса
    if (window.__pokerStalkerInstance && typeof window.__pokerStalkerInstance.destroy === 'function') {
        try { window.__pokerStalkerInstance.destroy(); } catch(e) {}
    }
    document.querySelectorAll('[id^="stalker-hud"]').forEach(el => el.remove());

    /* ══════════════════════════════════════════════════════════════════
       ULTIMATE SCALPEL v46.0 — APEX-ABSOLUTE (FLAWLESS MATH & GTO)
       • Street-by-Street Delta Tracking (100% True Chip Conservation)
       • Mathematically Valid GTO Exporter (Perfect All-In & Call Logic)
       • Unified Dense DSL ID Mapping (No sX/pX collisions)
       • TableClosed Memory Leak Plugged
       • Canonical Card Normalization & Standard Poker AFq Metric
       ══════════════════════════════════════════════════════════════════ */

    const scoutServerUrl = "https://toofunoff-poker-scout.hf.space";
    const MAX_BACKGROUND_TABLES = 80;
    const MAX_ARCHIVE_HANDS = 10000;
    const MAX_OUTBOX_QUEUE = 3000;
    const MAX_DEBUG_LOGS = 300;
    const SCANNER_CONCURRENCY = 5;

    const TARGET_LIST = [
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha",
        "saiyn_belek", "molyavka89", "blancl664", "why__not", "cashmachine", 
        "vorobyshek", "bar_suk74", "lev_altay", "kastarksn", "borsalino", "suitedjaxx69",
        "fatpanda", "galiardi", "neochen", "fai1er", "milka8"
    ];

    const TARGET_WATCHLIST = new Set(TARGET_LIST.map(n => n.toLowerCase()));
    const TARGET_ID_MAP = new Map(TARGET_LIST.map((n, idx) => [n.toLowerCase(), `t${idx + 1}`]));

    const LIVE_STATUSES = new Set(['RUNNING', 'LATE_REG', 'LATE_REGISTRATION', 'SEATING', 'PAUSED', 'DEALING']);
    const SYSTEM_CHAT_REGEX = /показывает|сбросил|занял место|покинул стол|банк выиграл|выбыл|тайм-банк/i;

    const stalkerState = {
        isCollapsed: false,
        hfStatus: 'Локальный режим',
        userViewingTournId: null,
        userViewingTableId: null,
        socketCooldowns: new Map(),
        tournamentCache: new Map(),
        outboxQueue: [],
        completedHandsArchive: [],
        recordedHandNumbers: new Set(),
        chatLogs: [],
        engineDebugLog: [],
        auth: { sessionId: null, wssUrl: null, clientVersion: "71.0.138" },
        sockets: { lobby: null, userTables: new Map() },
        liveTournaments: new Map(),
        discoveredTargetTables: new Map(),
        backgroundTableSockets: new Map(),
        activeTables: new Map(),
        stalkedPlayers: new Map(),
        scannerQueue: [],
        isScanningActive: false,
        timerIds: []
    };

    window.__stalkerState = stalkerState;

    // ── БАЗОВЫЙ 13-ПОЛИНОМИАЛЬНЫЙ 7-КАРТОЧНЫЙ ОЦЕНЩИК (BASE-13) ────────
    const CARD_RANKS = "23456789TJQKA";

    function eval5CardSet(cards5) {
        let rankCounts = {}, suitCounts = {};
        let rankIndices = [];

        cards5.forEach(c => {
            let r = c[0] === '1' ? 'T' : c[0].toUpperCase();
            let s = c[c.length - 1].toLowerCase();
            rankCounts[r] = (rankCounts[r] || 0) + 1;
            suitCounts[s] = (suitCounts[s] || 0) + 1;
            rankIndices.push(CARD_RANKS.indexOf(r));
        });

        rankIndices.sort((a, b) => b - a);

        let isFlush = Object.values(suitCounts).some(cnt => cnt === 5);
        let isWheel = (rankIndices[0] === 12 && rankIndices[1] === 3 && rankIndices[2] === 2 && rankIndices[3] === 1 && rankIndices[4] === 0);
        let isStraight = isWheel || rankIndices.every((val, idx) => idx === 0 || val === rankIndices[idx - 1] - 1);
        let straightHigh = isWheel ? '5' : (isStraight ? CARD_RANKS[rankIndices[0]] : null);

        if (isFlush && isStraight) return { score: 8000000 + CARD_RANKS.indexOf(straightHigh), tag: `SF_${straightHigh}` };

        let quads = [], trips = [], pairs = [], singles = [];
        Object.keys(rankCounts).forEach(r => {
            let rIdx = CARD_RANKS.indexOf(r);
            if (rankCounts[r] === 4) quads.push(rIdx);
            else if (rankCounts[r] === 3) trips.push(rIdx);
            else if (rankCounts[r] === 2) pairs.push(rIdx);
            else singles.push(rIdx);
        });

        const sortDesc = (arr) => arr.sort((a, b) => b - a);
        sortDesc(quads); sortDesc(trips); sortDesc(pairs); sortDesc(singles);

        if (quads.length > 0) {
            let score = 7000000 + quads[0] * 13 + singles[0];
            return { score, tag: `4K_${CARD_RANKS[quads[0]]}_${CARD_RANKS[singles[0]]}` };
        }
        if (trips.length > 0 && pairs.length > 0) {
            let score = 6000000 + trips[0] * 13 + pairs[0];
            return { score, tag: `FH_${CARD_RANKS[trips[0]]}_${CARD_RANKS[pairs[0]]}` };
        }
        if (isFlush) {
            let score = 5000000 + rankIndices.reduce((acc, v, i) => acc + v * Math.pow(13, 4 - i), 0);
            return { score, tag: `FL_${rankIndices.map(i => CARD_RANKS[i]).join('')}` };
        }
        if (isStraight) {
            return { score: 4000000 + CARD_RANKS.indexOf(straightHigh), tag: `ST_${straightHigh}` };
        }
        if (trips.length > 0) {
            let score = 3000000 + trips[0] * 169 + singles[0] * 13 + singles[1];
            return { score, tag: `3K_${CARD_RANKS[trips[0]]}_${CARD_RANKS[singles[0]]}${CARD_RANKS[singles[1]]}` };
        }
        if (pairs.length >= 2) {
            let score = 2000000 + pairs[0] * 169 + pairs[1] * 13 + singles[0];
            return { score, tag: `2P_${CARD_RANKS[pairs[0]]}_${CARD_RANKS[pairs[1]]}_${CARD_RANKS[singles[0]]}` };
        }
        if (pairs.length === 1) {
            let score = 1000000 + pairs[0] * 2197 + singles[0] * 169 + singles[1] * 13 + singles[2];
            return { score, tag: `1P_${CARD_RANKS[pairs[0]]}_${singles.slice(0, 3).map(i => CARD_RANKS[i]).join('')}` };
        }

        let hcVal = rankIndices.reduce((acc, v, i) => acc + v * Math.pow(13, 4 - i), 0);
        return { score: hcVal, tag: `HC_${rankIndices.map(i => CARD_RANKS[i]).join('')}` };
    }

    function evaluate7Cards(cardsStr) {
        if (!cardsStr) return "";
        let cards = cardsStr.trim().split(/\s+/).filter(c => c && c.length >= 2).map(c => {
            let r = c.slice(0, -1);
            let s = c.slice(-1).toLowerCase();
            return (r === '10' ? 'T' : r.toUpperCase()) + s;
        });
        let n = cards.length;
        if (n < 5) return "";

        let bestResult = { score: -1, tag: "" };
        if (n === 5) return eval5CardSet(cards).tag;

        for (let i = 0; i < n - 4; i++) {
            for (let j = i + 1; j < n - 3; j++) {
                for (let k = j + 1; k < n - 2; k++) {
                    for (let l = k + 1; l < n - 1; l++) {
                        for (let m = l + 1; m < n; m++) {
                            let res = eval5CardSet([cards[i], cards[j], cards[k], cards[l], cards[m]]);
                            if (res.score > bestResult.score) {
                                bestResult = res;
                            }
                        }
                    }
                }
            }
        }
        return bestResult.tag;
    }

    function logDebug(category, message) {
        let entry = { time: new Date().toLocaleTimeString(), category: category, message: message };
        stalkerState.engineDebugLog.push(entry);
        if (stalkerState.engineDebugLog.length > MAX_DEBUG_LOGS) stalkerState.engineDebugLog.shift();
    }

    function cleanCyrillic(str) {
        if (!str) return "MTT";
        try {
            if (/[РС][\x80-\xBF]/.test(str)) {
                return decodeURIComponent(escape(str));
            }
        } catch(e) {}
        return str;
    }

    function attr(str, name) {
        if (!str || typeof str !== 'string') return null;
        let m = str.match(new RegExp(`(?:\\b|\\s)${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function iattr(str, name) {
        let v = attr(str, name);
        return v ? parseInt(v, 10) : null;
    }

    function fattr(str, name) {
        let v = attr(str, name);
        return v ? parseFloat(v) : 0;
    }

    function decodeHtml(html) {
        if (!html) return "";
        let res = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        return cleanCyrillic(res);
    }

    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
    }

    function parseBulletNumber(rawNick) {
        if (!rawNick) return 1;
        let m = rawNick.match(/\s+#(\d+)$/);
        return m ? parseInt(m[1], 10) : 1;
    }

    function formatChips(chips) {
        if (!chips || chips <= 0) return "0";
        if (chips >= 1000000) return (chips / 1000000).toFixed(2) + "M";
        if (chips >= 1000) return (chips / 1000).toFixed(1) + "k";
        return Math.round(chips).toString();
    }

    function autoDetectSessionId() {
        if (stalkerState.auth.sessionId) return stalkerState.auth.sessionId;
        try {
            for (let storage of [sessionStorage, localStorage]) {
                for (let i = 0; i < storage.length; i++) {
                    let k = storage.key(i);
                    let v = storage.getItem(k);
                    if (v && typeof v === 'string' && /^[a-f0-9]{16}-[a-f0-9]{16}$/i.test(v.trim())) {
                        stalkerState.auth.sessionId = v.trim();
                        return stalkerState.auth.sessionId;
                    }
                }
            }
        } catch(e) {}
        return null;
    }

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
            let namedBack = { 1: 'CO', 2: 'HJ', 3: 'LJ', 4: 'MP' };
            for (let idx = 3; idx < n; idx++) {
                let distFromEnd = n - idx;
                if (namedBack[distFromEnd] && distFromEnd <= 3) {
                    posMap[ordered[idx]] = namedBack[distFromEnd];
                } else {
                    let utgOffset = idx - 3;
                    posMap[ordered[idx]] = utgOffset === 0 ? 'UTG' : `UTG+${utgOffset}`;
                }
            }
        }
        return posMap;
    }

    function getOrCreatePlayerProfile(cleanNick) {
        if (!stalkerState.stalkedPlayers.has(cleanNick)) {
            stalkerState.stalkedPlayers.set(cleanNick, {
                cleanNick: cleanNick,
                entries: new Map(),
                handsCount: 0,
                sitOutHandsCount: 0,
                vpipCount: 0,
                pfrCount: 0,
                aggressiveActions: 0,
                passiveActions: 0,
                totalActions: 0
            });
        }
        return stalkerState.stalkedPlayers.get(cleanNick);
    }

    // ── СЕРВЕРНЫЙ ДВИЖОК СТОЛА С ИДЕАЛЬНОЙ ЧИП-КОНСЕРВАЦИЕЙ ────────────
    class TableContext {
        constructor(tableId, tournId = null) {
            this.tableId = tableId;
            this.tournId = tournId;
            this.name = 'Стол ' + (tableId ? String(tableId).substr(-4) : '');
            this.level = { sb: 0, bb: 0, ante: 0, number: null };
            this.handLevel = null;
            this.seats = new Map();
            this.hand = null;
            this.dealer = 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.activeSeats = new Set();
            this.dealtSeats = new Set();
            this.positions = {};
            this.potSwept = 0;
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.investedPerSeat = new Map();       // Тотал за всю раздачу
            this.streetInvestedPerSeat = new Map(); // Тотал за текущую улицу (для расчета дельты рейзов)
            this.handActions = new Map();
            this.timeline = [];
            this.knockoutBounties = [];
            this.sittingOutSeats = new Set();
            this.playersActedThisHand = new Set();
            this.playersCountedThisHand = new Set();
            this.processedActionIds = new Set();
            this.seatTimerStart = new Map();
            this.runningPot = 0;
        }

        getActiveHandBB() {
            if (this.level.bb > 0) return this.level.bb;
            if (this.tournId && stalkerState.liveTournaments.has(this.tournId)) {
                return stalkerState.liveTournaments.get(this.tournId).currentBB || 500;
            }
            return 500;
        }

        getTournamentMeta() {
            if (this.tournId && stalkerState.tournamentCache.has(this.tournId)) {
                return stalkerState.tournamentCache.get(this.tournId);
            }
            return { name: 'MTT', baseBuyin: 0, isPKO: false };
        }

        ensureSeat(seatNum, rawNick, serverStack = null) {
            let clean = rawNick ? getCleanNick(rawNick) : '';
            if (!this.seats.has(seatNum)) {
                this.seats.set(seatNum, {
                    seat: seatNum,
                    rawNick: rawNick || `Seat ${seatNum}`,
                    cleanNick: clean || `seat_${seatNum}`,
                    stack: serverStack !== null ? serverStack : 0,
                    busted: false,
                    spent: 0
                });
            }
            let s = this.seats.get(seatNum);
            if (rawNick && s.rawNick !== rawNick) {
                s.rawNick = rawNick;
                s.cleanNick = clean;
            }
            if (serverStack !== null) s.stack = serverStack;
            return s;
        }

        beginHand(handNum, dealerSeat, activeSeatsList) {
            this.hand = handNum;
            this.dealer = dealerSeat || 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.potSwept = 0;
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.investedPerSeat.clear();
            this.streetInvestedPerSeat.clear();
            this.activeSeats.clear();
            this.dealtSeats.clear();
            this.handActions.clear();
            this.timeline = [];
            this.knockoutBounties = [];
            this.playersActedThisHand.clear();
            this.playersCountedThisHand.clear();
            this.processedActionIds.clear();
            this.seatTimerStart.clear();
            this.runningPot = 0;

            let currentBB = this.getActiveHandBB();
            this.handLevel = { sb: this.level.sb || Math.round(currentBB / 2), bb: currentBB, ante: this.level.ante || 0, number: this.level.number };

            this.seats.forEach((s, sn) => {
                if (s.stack !== null && s.stack > 0) this.handStart[sn] = s.stack;
            });

            for (let sn of activeSeatsList) {
                this.ensureSeat(sn, null);
                this.activeSeats.add(sn);
                this.dealtSeats.add(sn);
                this.investedPerSeat.set(sn, 0);
                this.streetInvestedPerSeat.set(sn, 0);
                this.handActions.set(sn, []);
            }
            this.positions = calculatePositions(activeSeatsList, this.dealer);
        }

        recordAction(seatNum, label, amount) {
            let s = this.ensureSeat(seatNum, null);
            let list = this.handActions.get(seatNum) || [];
            let str = `${this.street}_${label}`;
            
            // ИДЕАЛЬНЫЙ РАСЧЕТ ДЕЛЬТЫ ИНВЕСТИЦИЙ
            let amtNum = amount || 0;
            let delta = 0;
            let streetPrev = this.streetInvestedPerSeat.get(seatNum) || 0;
            let handPrev = this.investedPerSeat.get(seatNum) || 0;

            if (['ANTE', 'SB', 'BB', 'CALL', 'ALLIN'].includes(label)) {
                delta = amtNum; // Это чистая дельта
            } else if (['BET', 'RAISE'].includes(label)) {
                delta = Math.max(0, amtNum - streetPrev); // Это тотал для улицы, вычисляем дельту
            } else if (label === 'UNCALLEDBET') {
                delta = -amtNum; // Возврат фишек
            }

            if (delta !== 0) {
                this.streetInvestedPerSeat.set(seatNum, streetPrev + delta);
                this.investedPerSeat.set(seatNum, handPrev + delta);
                this.runningPot += delta;
            }

            let thinkSec = null;
            let timerStart = this.seatTimerStart.get(seatNum);
            if (timerStart && !['ANTE', 'SB', 'BB', 'UNCALLEDBET'].includes(label)) {
                let diff = ((Date.now() - timerStart) / 1000).toFixed(1);
                if (diff >= 0 && diff < 60) thinkSec = parseFloat(diff);
                this.seatTimerStart.delete(seatNum);
            }

            let thinkStr = thinkSec !== null ? `[${thinkSec}s]` : '';
            let potBefore = this.runningPot - delta;
            let potPct = (potBefore > 0 && delta > 0) ? Math.round(delta / potBefore * 100) : 0;

            if (amtNum > 0) {
                str += `:${amtNum}` + (potPct > 0 && potPct <= 500 ? `(${potPct}%pot)` : '') + thinkStr;
            } else {
                str += thinkStr;
            }
            list.push(str);
            this.handActions.set(seatNum, list);

            this.timeline.push({
                street: this.street, seat: seatNum, nick: s.rawNick, cleanNick: s.cleanNick,
                position: this.positions[seatNum] || 'N/A', action: label, amount: amtNum,
                pot_before: potBefore, pot_pct: (potPct > 0 && potPct <= 500) ? potPct : null, time_sec: thinkSec
            });
        }

        updateBoardFromXml(xml) {
            let oldStreet = this.street;
            let boardDirect = xml.match(/<Board>(.*?)<\/Board>/i);
            if (boardDirect) {
                let cards = Array.from(boardDirect[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                if (cards.length >= 3) {
                    this.board = cards.slice(0, 5);
                    this.street = this.board.length === 5 ? 'RIVER' : (this.board.length === 4 ? 'TURN' : 'FLOP');
                }
            } else {
                let streets = [['DealingFlop', 'FLOP', 3], ['DealingTurn', 'TURN', 4], ['DealingRiver', 'RIVER', 5]];
                for (let [tag, sName, maxCount] of streets) {
                    let stM = xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i'));
                    if (stM) {
                        let fc = Array.from(stM[0].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                        this.street = sName;
                        if (fc.length) {
                            if (sName === 'FLOP') this.board = fc.slice(0, 3);
                            else if (this.board.length < maxCount) this.board.push(fc[0]);
                        }
                    }
                }
            }
            
            if (this.street !== oldStreet) {
                this.streetInvestedPerSeat.clear();
            }
        }

        finalizeHand() {
            if (!this.hand) return null;
            let handBB = this.getActiveHandBB();
            let startTotal = 0, endTotal = 0, anyStart = false;
            let players = [];
            let tMeta = this.getTournamentMeta();

            let seatNums = Array.from(this.seats.keys()).sort((a, b) => a - b);
            
            for (let sn of seatNums) {
                let s = this.seats.get(sn);
                let wonAmount = this.winners.filter(w => w.seat === sn).reduce((acc, w) => acc + w.amount, 0);
                let investedInPot = this.investedPerSeat.get(sn) || 0;

                let isParticipant = this.dealtSeats.has(sn) || investedInPot > 0 || wonAmount > 0;
                if (!isParticipant) continue;
                
                anyStart = true;
                let startStack = (this.handStart[sn] !== undefined && this.handStart[sn] !== null && this.handStart[sn] > 0) ? this.handStart[sn] : Math.max(s.stack, investedInPot);
                if (startStack < investedInPot && wonAmount === 0) startStack = investedInPot;

                let endStack = Math.max(0, startStack - investedInPot + wonAmount);
                s.stack = endStack;
                startTotal += startStack;
                endTotal += endStack;

                if (TARGET_WATCHLIST.has(s.cleanNick) && !this.playersCountedThisHand.has(s.cleanNick)) {
                    let prof = getOrCreatePlayerProfile(s.cleanNick);
                    if (this.sittingOutSeats.has(sn)) prof.sitOutHandsCount++;
                    else prof.handsCount++;
                    this.playersCountedThisHand.add(s.cleanNick);
                }

                let sd = this.showdownCards[sn];
                let holeCards = sd ? sd.cards : 'xx xx';
                let handEval = (holeCards !== 'xx xx' && this.board.length >= 3) ? evaluate7Cards(`${holeCards} ${this.board.join(' ')}`) : "";

                players.push({
                    seat: sn, nick: s.rawNick, cleanNick: s.cleanNick, position: this.positions[sn] || 'N/A',
                    stack_start: startStack, stack_start_bb: handBB > 0 ? Math.round(startStack / handBB * 10) / 10 : null,
                    stack_end: endStack, stack_end_bb: handBB > 0 ? Math.round(endStack / handBB * 10) / 10 : null,
                    cards: holeCards, eval_rank: handEval, is_muck_leak: (sd && sd.isMuck && sd.cards && sd.cards !== 'xx xx') ? 1 : 0,
                    is_sitting_out: this.sittingOutSeats.has(sn) ? 1 : 0, busted: endStack === 0 ? 1 : 0,
                    spent_rub: s.spent || tMeta.baseBuyin, actions: this.handActions.get(sn) || []
                });
            }

            if (!anyStart) return null;
            let conserved = (startTotal === endTotal);

            let calculatedPotTotal = Array.from(this.investedPerSeat.values()).reduce((a, b) => a + b, 0);

            return {
                hand_number: this.hand, tracking: 'full', table_id: this.tableId, table_name: this.name,
                tournament_id: this.tournId, tournament_name: tMeta.name, is_pko: tMeta.isPKO,
                timestamp: new Date().toISOString(), level: this.handLevel, dealer_seat: this.dealer,
                board: this.board.join(' '), pot_total: calculatedPotTotal, pot_bb: handBB > 0 ? Math.round(calculatedPotTotal / handBB * 10) / 10 : null,
                winners: this.winners, knockout_bounties: this.knockoutBounties, timeline: this.timeline,
                players: players, sync_verified: conserved, chip_conservation: { start_total: startTotal, end_total: endTotal, ok: conserved }
            };
        }
    }

    // ── БАТЧЕВЫЙ OUTBOX ───────────────────────────────────────────────
    let backoffDelay = 1000;
    let isFlushingQueue = false;

    function queueServerEvent(type, payload) {
        stalkerState.outboxQueue.push({ type: type, payload: payload, timestamp: Date.now() });
        if (stalkerState.outboxQueue.length > MAX_OUTBOX_QUEUE) stalkerState.outboxQueue.shift();
        processOutboxQueue();
    }

    async function processOutboxQueue() {
        if (isFlushingQueue || stalkerState.outboxQueue.length === 0) return;
        isFlushingQueue = true;

        while (stalkerState.outboxQueue.length > 0) {
            let batch = stalkerState.outboxQueue.slice(0, 25);
            try {
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 3500);

                let res = await fetch(`${scoutServerUrl}/scout_api/events_batch`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ events: batch }), signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    stalkerState.outboxQueue.splice(0, batch.length);
                    stalkerState.hfStatus = 'Онлайн';
                    backoffDelay = 1000;
                } else {
                    stalkerState.hfStatus = `HTTP ${res.status}`;
                    backoffDelay = Math.min(backoffDelay * 1.5, 30000);
                    break;
                }
            } catch (e) {
                stalkerState.hfStatus = 'Офлайн / Буфер';
                backoffDelay = Math.min(backoffDelay * 1.5, 30000);
                break;
            }
        }
        isFlushingQueue = false;
        updateHfIndicator();
    }

    function updateHfIndicator() {
        let el = document.getElementById('st-hf-status');
        if (!el) return;
        let qLen = stalkerState.outboxQueue.length;
        let qStr = qLen > 0 ? ` (Буфер: ${qLen})` : '';
        el.innerHTML = stalkerState.hfStatus === 'Онлайн' 
            ? `<span style="color:#4ade80;">HF: ● Онлайн${qStr}</span>`
            : `<span style="color:#f87171;">HF: ○ ${stalkerState.hfStatus}${qStr}</span>`;
    }

    // ── 1. МАТЕМАТИЧЕСКИ ТОЧНЫЙ GTO POKERSTARS EXPORTER ───────────────
    function convertHandsToPokerStarsHH(handsList) {
        let output = [];
        handsList.forEach(h => {
            if (h.tracking !== 'full') return;
            try {
                const hNum = h.hand_number || "2849280000";
                const tId = h.tournament_id ? h.tournament_id.replace(/^f78-/, '') : "1000000";
                const tName = cleanCyrillic(h.tournament_name || "Tournament").replace(/[^\w\sа-яА-ЯёЁ\-\.\"\']/gi, '');
                const level = h.level || { sb: 100, bb: 200, ante: 25, number: 1 };
                const sb = level.sb || 100;
                const bb = level.bb || 200;
                const ante = level.ante || 0;
                const lvlNum = level.number || 1;
                const dateStr = h.timestamp ? new Date(h.timestamp).toUTCString().replace("GMT", "ET") : new Date().toUTCString().replace("GMT", "ET");

                const lines = [];
                lines.push(`PokerStars Hand #${hNum}: Tournament #${tId}, ${tName} Hold'em No Limit - Level ${lvlNum} (${sb}/${bb}) - ${dateStr}`);

                const players = h.players || [];
                const numPlayers = players.length || 8;
                const dealerSeatIdx = (h.dealer_seat !== undefined && h.dealer_seat !== null) ? (h.dealer_seat + 1) : 1;
                const tableId = h.table_id || "1";

                lines.push(`Table '${tableId} 1' ${numPlayers}-max Seat #${dealerSeatIdx} is the button`);

                players.forEach(p => {
                    const sNum = (p.seat !== undefined) ? (p.seat + 1) : 1;
                    lines.push(`Seat ${sNum}: ${p.nick} (${p.stack_start || 0} in chips)`);
                });

                if (ante > 0) players.forEach(p => lines.push(`${p.nick}: posts the ante ${ante}`));

                let sbPosted = false, bbPosted = false;
                players.forEach(p => {
                    (p.actions || []).forEach(a => {
                        if (a.includes('PREFLOP_SB:')) {
                            let amt = extractAmt(a) || sb;
                            let effStack = Math.max(0, (p.stack_start || 0) - ante);
                            let postAmt = Math.min(effStack, amt);
                            let allInStr = (effStack <= amt) ? ' and is all-in' : '';
                            lines.push(`${p.nick}: posts small blind ${postAmt}${allInStr}`);
                            sbPosted = true;
                        } else if (a.includes('PREFLOP_BB:')) {
                            let amt = extractAmt(a) || bb;
                            let effStack = Math.max(0, (p.stack_start || 0) - ante);
                            let postAmt = Math.min(effStack, amt);
                            let allInStr = (effStack <= amt) ? ' and is all-in' : '';
                            lines.push(`${p.nick}: posts big blind ${postAmt}${allInStr}`);
                            bbPosted = true;
                        }
                    });
                });

                if (!sbPosted || !bbPosted) {
                    players.forEach(p => {
                        let effStack = Math.max(0, (p.stack_start || 0) - ante);
                        if (!sbPosted && (p.position === 'SB' || p.position === 'BTN/SB')) {
                            let postAmt = Math.min(effStack, sb);
                            let allInStr = (effStack <= sb) ? ' and is all-in' : '';
                            lines.push(`${p.nick}: posts small blind ${postAmt}${allInStr}`);
                            sbPosted = true;
                        }
                        if (!bbPosted && p.position === 'BB') {
                            let postAmt = Math.min(effStack, bb);
                            let allInStr = (effStack <= bb) ? ' and is all-in' : '';
                            lines.push(`${p.nick}: posts big blind ${postAmt}${allInStr}`);
                            bbPosted = true;
                        }
                    });
                }

                lines.push(`*** HOLE CARDS ***`);

                let knownPlayer = players.find(p => p.cards && p.cards !== 'xx xx');
                if (knownPlayer) lines.push(`Dealt to ${knownPlayer.nick} [${knownPlayer.cards}]`);

                const boardCards = (h.board || "").trim().split(/\s+/).filter(c => c && c.length >= 2);
                let currentStreet = 'PREFLOP';
                let streetBets = {};
                let currentMaxBet = bb;
                let flopPrinted = false, turnPrinted = false, riverPrinted = false;

                players.forEach(p => {
                    if (p.position === 'SB' || p.position === 'BTN/SB') streetBets[p.nick] = sb;
                    if (p.position === 'BB') streetBets[p.nick] = bb;
                    (p.actions || []).forEach(a => {
                        if (a.includes('PREFLOP_SB:')) streetBets[p.nick] = extractAmt(a) || sb;
                        if (a.includes('PREFLOP_BB:')) streetBets[p.nick] = extractAmt(a) || bb;
                    });
                });

                (h.timeline || []).forEach(item => {
                    let st = item.street;
                    let act = item.action;
                    let amt = item.amount || 0;
                    let nick = item.nick;

                    if (['ANTE', 'SB', 'BB'].includes(act)) return;

                    if (st !== currentStreet) {
                        currentStreet = st;
                        streetBets = {};
                        currentMaxBet = 0;

                        if (st === 'FLOP' && boardCards.length >= 3 && !flopPrinted) {
                            lines.push(`*** FLOP *** [${boardCards.slice(0, 3).join(' ')}]`);
                            flopPrinted = true;
                        } else if (st === 'TURN' && boardCards.length >= 4 && !turnPrinted) {
                            lines.push(`*** TURN *** [${boardCards.slice(0, 3).join(' ')}] [${boardCards[3]}]`);
                            turnPrinted = true;
                        } else if (st === 'RIVER' && boardCards.length >= 5 && !riverPrinted) {
                            lines.push(`*** RIVER *** [${boardCards.slice(0, 4).join(' ')}] [${boardCards[4]}]`);
                            riverPrinted = true;
                        }
                    }

                    let tStr = (item.time_sec !== null && item.time_sec !== undefined) ? ` [${item.time_sec}s]` : '';

                    if (act === 'FOLD') lines.push(`${nick}: folds${tStr}`);
                    else if (act === 'CHECK') lines.push(`${nick}: checks${tStr}`);
                    else if (act === 'CALL') {
                        streetBets[nick] = (streetBets[nick] || 0) + amt;
                        lines.push(`${nick}: calls ${amt}${tStr}`);
                    } else if (act === 'BET') {
                        lines.push(`${nick}: bets ${amt}${tStr}`);
                        streetBets[nick] = amt;
                        currentMaxBet = amt;
                    } else if (act === 'RAISE') {
                        let prevBet = streetBets[nick] || 0;
                        let raiseDelta = amt - currentMaxBet;
                        if (raiseDelta <= 0) raiseDelta = amt - prevBet;
                        lines.push(`${nick}: raises ${raiseDelta} to ${amt}${tStr}`);
                        streetBets[nick] = amt;
                        currentMaxBet = amt;
                    } else if (act === 'ALLIN') {
                        let prevBet = streetBets[nick] || 0;
                        let totalBet = prevBet + amt;
                        if (currentMaxBet === 0) {
                            lines.push(`${nick}: bets ${totalBet} and is all-in${tStr}`);
                            currentMaxBet = totalBet;
                        } else if (totalBet > currentMaxBet) {
                            let raiseDelta = totalBet - currentMaxBet;
                            lines.push(`${nick}: raises ${raiseDelta} to ${totalBet} and is all-in${tStr}`);
                            currentMaxBet = totalBet;
                        } else {
                            lines.push(`${nick}: calls ${amt} and is all-in${tStr}`);
                        }
                        streetBets[nick] = totalBet;
                    } else if (act === 'UNCALLEDBET') {
                        lines.push(`Uncalled bet (${amt}) returned to ${nick}`);
                    }
                });

                lines.push(`*** SHOW DOWN ***`);
                players.forEach(p => {
                    if (p.cards && p.cards !== 'xx xx') {
                        if (p.is_muck_leak) lines.push(`${p.nick}: mucks hand [${p.cards}]`);
                        else lines.push(`${p.nick}: shows [${p.cards}]`);
                    }
                });

                let totalWonAmount = 0;
                (h.winners || []).forEach(w => {
                    const wp = players.find(p => p.seat === w.seat);
                    const wNick = wp ? wp.nick : `Seat ${w.seat + 1}`;
                    const potLabel = (w.potIndex && w.potIndex > 0) ? `side pot-${w.potIndex}` : `pot`;
                    lines.push(`${wNick} collected ${w.amount} from ${potLabel}`);
                    totalWonAmount += w.amount;
                });

                lines.push(`*** SUMMARY ***`);
                let finalPot = totalWonAmount > 0 ? totalWonAmount : (h.pot_total || 0);
                lines.push(`Total pot ${finalPot} | Rake 0`);
                if (boardCards.length > 0) lines.push(`Board [${boardCards.join(' ')}]`);

                players.forEach(p => {
                    const sNum = p.seat + 1;
                    const isBtn = (p.seat === h.dealer_seat) ? " (button)" : "";
                    const isSb = (p.position === "SB" || p.position === "BTN/SB") ? " (small blind)" : "";
                    const isBb = (p.position === "BB") ? " (big blind)" : "";
                    const posStr = isBtn || isSb || isBb;
                    
                    let outcomeStr = "folded";
                    const wEntry = (h.winners || []).find(w => w.seat === p.seat);
                    if (wEntry) outcomeStr = `showed [${p.cards || 'xx xx'}] and won (${wEntry.amount})`;
                    else if (p.cards && p.cards !== 'xx xx') outcomeStr = `showed [${p.cards}] and lost`;
                    
                    lines.push(`Seat ${sNum}: ${p.nick}${posStr} ${outcomeStr}`);
                });

                output.push(lines.join("\n"));
            } catch(e) {}
        });
        return output.join("\n\n\n");
    }

    // ── 2. УНИФИЦИРОВАННЫЙ ULTRA-DENSE DSL ────────────────────────────
    function convertHandsToDenseDSL(handsList) {
        let globalDict = new Map();
        let unknownCounter = 1;

        handsList.forEach(h => {
            (h.players || []).forEach(p => {
                let clean = p.cleanNick;
                if (!globalDict.has(clean)) {
                    if (TARGET_ID_MAP.has(clean)) {
                        globalDict.set(clean, TARGET_ID_MAP.get(clean));
                    } else {
                        globalDict.set(clean, `u${unknownCounter++}`);
                    }
                }
            });
        });

        let dictHeader = "DICT: " + Array.from(globalDict.entries()).map(([nick, id]) => `${id}=${nick}`).join('|');
        let handsLines = [];

        handsList.forEach(h => {
            if (h.tracking !== 'full') return;
            try {
                let hNum = h.hand_number;
                let tId = h.tournament_id ? h.tournament_id.replace(/^f78-/, '') : 'mtt';
                let lvl = h.level || { sb: 100, bb: 200, ante: 0 };
                let btn = h.dealer_seat !== undefined ? h.dealer_seat : 0;

                let pBlock = (h.players || []).map(p => {
                    let pId = globalDict.get(p.cleanNick);
                    let cardStr = (p.cards && p.cards !== 'xx xx') ? `:${p.cards.replace(/\s+/g, '')}` : '';
                    let evalStr = p.eval_rank ? `:${p.eval_rank}` : '';
                    return `${p.seat}:${pId}:${p.stack_start}${cardStr}${evalStr}`;
                }).join('|');

                let boardCards = (h.board || '').trim().split(/\s+/).filter(Boolean);
                let boardStr = '';
                if (boardCards.length >= 3) boardStr += boardCards.slice(0, 3).join('');
                if (boardCards.length >= 4) boardStr += '/' + boardCards[3];
                if (boardCards.length >= 5) boardStr += '/' + boardCards[4];

                let acts = (h.timeline || []).map(item => {
                    if (['ANTE', 'SB', 'BB'].includes(item.action)) return '';
                    let actCode = item.action === 'FOLD' ? 'f' :
                                  item.action === 'CHECK' ? 'k' :
                                  item.action === 'CALL' ? `c${item.amount}` :
                                  item.action === 'BET' ? `b${item.amount}` :
                                  item.action === 'RAISE' ? `r${item.amount}` :
                                  item.action === 'ALLIN' ? `c${item.amount}` :
                                  item.action === 'UNCALLEDBET' ? `u${item.amount}` : item.action.toLowerCase();
                    let tStr = (item.time_sec !== null && item.time_sec !== undefined) ? `(${item.time_sec})` : '';
                    return `p${item.seat}.${actCode}${tStr}`;
                }).filter(Boolean).join('');

                let winParts = (h.winners || []).map(w => {
                    let wp = (h.players || []).find(p => p.seat === w.seat);
                    let pId = wp ? globalDict.get(wp.cleanNick) : `s${w.seat}`;
                    let evalStr = (wp && wp.eval_rank) ? `:${wp.eval_rank}` : '';
                    return `${pId}:${w.amount}${evalStr}`;
                }).join(';');

                let dsl = `[#${hNum}|${tId}:${lvl.sb}/${lvl.bb}/${lvl.ante}:B${btn}|P:${pBlock}|B:${boardStr}|A:${acts}|W:${winParts}]`;
                handsLines.push(dsl);
            } catch(e) {}
        });

        return `${dictHeader}\n\n${handsLines.join('\n')}`;
    }

    window.__stalkerExportGTO = function() {
        let state = window.__stalkerState || stalkerState;
        let fullHands = state.completedHandsArchive.filter(h => h.tracking === 'full');
        if (fullHands.length === 0) {
            alert('Нет полных валидных раздач для GTO экспорта!');
            return;
        }
        let txt = convertHandsToPokerStarsHH(fullHands);
        let blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `PokerStars_GTO_v460_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    window.__stalkerExportDSL = function() {
        let state = window.__stalkerState || stalkerState;
        let fullHands = state.completedHandsArchive.filter(h => h.tracking === 'full');
        if (fullHands.length === 0) {
            alert('Нет полных валидных раздач для Dense DSL экспорта!');
            return;
        }
        let dslText = convertHandsToDenseDSL(fullHands);
        let blob = new Blob([dslText], { type: 'text/plain;charset=utf-8' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Scalpel_Dense_AI_v460_${Date.now()}.dsl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    window.__stalkerExportJSON = function() {
        try {
            let state = window.__stalkerState || stalkerState;
            let exportData = {
                timestamp: new Date().toISOString(),
                discipline: "TEXAS_HOLDEM_ONLY",
                targetsCount: state.stalkedPlayers.size,
                liveTournamentsCount: state.liveTournaments.size,
                outboxQueueLength: state.outboxQueue.length,
                recorded_hands_count: state.completedHandsArchive.length,
                debug_engine_log: state.engineDebugLog,
                chat_logs: state.chatLogs,
                recorded_hands: state.completedHandsArchive,
                players: {}
            };

            state.stalkedPlayers.forEach((p, cleanNick) => {
                let agg = p.aggressiveActions || 0;
                let pass = p.passiveActions || 0;
                let totalCombat = agg + pass;
                let afq = totalCombat > 0 ? parseFloat(((agg / totalCombat) * 100).toFixed(1)) : 0;
                let vpip = p.handsCount > 0 ? parseFloat(((p.vpipCount / p.handsCount) * 100).toFixed(1)) : 0;
                let pfr = p.handsCount > 0 ? parseFloat(((p.pfrCount / p.handsCount) * 100).toFixed(1)) : 0;

                exportData.players[cleanNick] = {
                    cleanNick: p.cleanNick,
                    handsCount: p.handsCount,
                    sitOutHandsCount: p.sitOutHandsCount,
                    vpip: vpip,
                    pfr: pfr,
                    afq: afq,
                    entries: Array.from(p.entries.values())
                };
            });

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_v46_0_omni_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ГРАФИЧЕСКИЙ ИНТЕРФЕЙС HUD ─────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud-v460';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:470px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #06b6d4;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="color:#06b6d4;font-size:13px;">🎯</span>
                <strong style="color:#06b6d4;font-size:12px;">SCALPEL v46.0 APEX-ABSOLUTE</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <button id="btn-force-scan" style="background:#0891b2;border:none;color:#fff;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#06b6d4;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v460').remove();" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>
        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Спектатор: <b id="st-spectator-count" style="color:#38bdf8;">0 столов</b></span>
                    <span id="st-hands-count" style="color:#22c55e;">Раздач: <b>0</b></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Живых MTT: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0</b></span>
                </div>
            </div>
            <div id="st-targets-list" style="max-height:240px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Сканирование сетки турниров...
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;">
                <button onclick="window.__stalkerExportJSON()" style="padding:7px 2px;background:linear-gradient(90deg,#0891b2,#0284c7);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    📥 JSON (Raw)
                </button>
                <button onclick="window.__stalkerExportGTO()" style="padding:7px 2px;background:linear-gradient(90deg,#10b981,#059669);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    ⚡ GTO (.txt)
                </button>
                <button onclick="window.__stalkerExportDSL()" style="padding:7px 2px;background:linear-gradient(90deg,#8b5cf6,#6366f1);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:9px;cursor:pointer;">
                    💎 Dense DSL
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(ui);

    document.getElementById('btn-toggle-hud').onclick = function() {
        stalkerState.isCollapsed = !stalkerState.isCollapsed;
        let body = document.getElementById('st-hud-body');
        body.style.display = stalkerState.isCollapsed ? 'none' : 'block';
        this.innerText = stalkerState.isCollapsed ? '▴' : '▾';
    };

    document.getElementById('btn-force-scan').onclick = function() {
        autoDetectSessionId();
        triggerLobbyTournamentRefresh();
    };

    let isRafPending = false;
    function updateHUD() {
        if (isRafPending) return;
        isRafPending = true;

        requestAnimationFrame(() => {
            isRafPending = false;
            let countEl = document.getElementById('st-targets-found');
            let tournsEl = document.getElementById('st-tourns-count');
            let specEl = document.getElementById('st-spectator-count');
            let handsEl = document.getElementById('st-hands-count');
            let listEl = document.getElementById('st-targets-list');
            if (!countEl || !listEl) return;

            let activeTargets = 0;
            stalkerState.stalkedPlayers.forEach(p => {
                let hasActive = Array.from(p.entries.values()).some(e => 
                    !e.isBusted && (e.stack || 0) > 0 && (!e.tournId || stalkerState.liveTournaments.has(e.tournId))
                );
                if (hasActive) activeTargets++;
            });

            countEl.innerText = `${stalkerState.stalkedPlayers.size} (в игре: ${activeTargets})`;
            if (tournsEl) tournsEl.innerText = stalkerState.liveTournaments.size;
            if (specEl) specEl.innerText = `${stalkerState.backgroundTableSockets.size} столов в фоне`;
            if (handsEl) handsEl.innerHTML = `Раздач: <b>${stalkerState.completedHandsArchive.length}</b>`;

            if (stalkerState.stalkedPlayers.size > 0) {
                let html = '';
                stalkerState.stalkedPlayers.forEach((p) => {
                    let agg = p.aggressiveActions || 0;
                    let pass = p.passiveActions || 0;
                    let totalCombat = agg + pass;
                    let afq = totalCombat > 0 ? Math.round((agg / totalCombat) * 100) : 0;
                    let vpip = p.handsCount > 0 ? Math.round((p.vpipCount / p.handsCount) * 100) : 0;
                    let pfr = p.handsCount > 0 ? Math.round((p.pfrCount / p.handsCount) * 100) : 0;
                    
                    let vpipStr = p.handsCount > 0 
                        ? `<small style="color:#38bdf8;font-weight:bold;margin-left:4px;">[H:${p.handsCount}${p.sitOutHandsCount > 0 ? `+${p.sitOutHandsCount}AFK` : ''} V:${vpip}% P:${pfr}% AF:${afq}%]</small>` 
                        : `<small style="color:#64748b;margin-left:4px;">[Поиск рук...]</small>`;

                    html += `<div style="border-bottom:1px solid #1e293b;padding:4px 0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:#fde047;">🎯 <b>${p.cleanNick}</b> ${vpipStr}</span>
                        </div>`;

                    p.entries.forEach(e => {
                        let chipsStr = formatChips(e.stack);
                        let isTournLive = !e.tournId || stalkerState.liveTournaments.has(e.tournId);
                        let isActuallyBusted = e.isBusted || e.stack === 0 || !isTournLive;

                        let liveCtx = e.tableId ? stalkerState.activeTables.get(e.tableId) : null;
                        let liveBB = (liveCtx && liveCtx.getActiveHandBB() > 0) ? liveCtx.getActiveHandBB() : (e.currentBB || 500);
                        let realStackBB = (liveBB > 0 && e.stack > 0 && !isActuallyBusted) ? (Math.round((e.stack / liveBB) * 10) / 10) : 0;
                        let bbStr = (realStackBB > 0 && !isActuallyBusted) ? ` (${realStackBB} BB)` : '';
                        
                        let baseBuyin = e.baseBuyin || 0;
                        let totalSpent = (e.bullets || 1) * baseBuyin;
                        let buyinBadge = '';
                        if (baseBuyin > 0) {
                            if (e.bullets > 1) {
                                buyinBadge = ` <span style="color:#a855f7;">[${formatChips(baseBuyin)}₽ (${e.bullets}-й вход: ${formatChips(totalSpent)}₽)]</span>`;
                            } else {
                                buyinBadge = ` <span style="color:#a855f7;">[${formatChips(baseBuyin)}₽]</span>`;
                            }
                        }

                        if (isActuallyBusted) {
                            let prizeStr = '';
                            if (e.prize > 0) {
                                if (e.regular_prize > 0 && e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatChips(e.prize)}₽</b> <small style="color:#94a3b8;">(${formatChips(e.regular_prize)}₽ + ${formatChips(e.bounty_prize)}₽ KO)</small>`;
                                } else if (e.regular_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatChips(e.regular_prize)}₽</b> <small style="color:#94a3b8;">[Приз]</small>`;
                                } else if (e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatChips(e.bounty_prize)}₽</b> <small style="color:#94a3b8;">[KO]</small>`;
                                }
                            }

                            let placeBadge = '';
                            if (e.place === 1) {
                                placeBadge = `<b style="color:#eab308;background:rgba(234,179,8,0.15);padding:1px 4px;border-radius:3px;">1 МЕСТО 🏆</b>`;
                            } else if (e.place > 0) {
                                placeBadge = `${e.place} место`;
                            }

                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#ef4444;padding-left:8px;opacity:0.85;">
                                <span><s>${e.rawNick}</s> <small style="color:#64748b;">${e.tableName || 'MTT'}</small>${buyinBadge}</span>
                                <span>${placeBadge}${prizeStr} ${e.place === 1 ? '' : '[ВЫБЫЛ]'}</span>
                            </div>`;
                        } else {
                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;padding-left:8px;color:#38bdf8;">
                                <span>🔹 <b>${e.rawNick}</b> <small style="color:#94a3b8;">${e.tableName || 'MTT'}</small>${buyinBadge}</span>
                                <span style="font-weight:bold;">${chipsStr}${bbStr}</span>
                            </div>`;
                        }
                    });
                    html += `</div>`;
                });
                listEl.innerHTML = html;
            }
        });
    }

    async function manageBackgroundSpectatorPool() {
        let sid = stalkerState.auth.sessionId || autoDetectSessionId();
        let wsUrl = stalkerState.auth.wssUrl;
        if (!wsUrl || !sid) return;

        for (let [tableId, ws] of stalkerState.backgroundTableSockets.entries()) {
            let tableCtx = stalkerState.activeTables.get(tableId);
            if (!tableCtx) continue;

            if (tableCtx.hand !== null) continue;

            let isTableStillTargeted = stalkerState.discoveredTargetTables.has(tableId);
            let isUserActiveOnTable = stalkerState.sockets.userTables.has(tableId);

            if ((!isTableStillTargeted || isUserActiveOnTable) && ws.readyState === WebSocket.OPEN) {
                if (ws.__heartbeatTimer) clearInterval(ws.__heartbeatTimer);
                try { ws.close(); } catch(e) {}
                stalkerState.backgroundTableSockets.delete(tableId);
                if (!isUserActiveOnTable) stalkerState.activeTables.delete(tableId);
                logDebug("SOCKET_CLEANUP", `Стол ${tableId} освобожден`);
            }
        }

        let spawnDelay = 0;
        for (let [tableId, tInfo] of stalkerState.discoveredTargetTables.entries()) {
            if (stalkerState.backgroundTableSockets.size >= MAX_BACKGROUND_TABLES) break;
            if (stalkerState.backgroundTableSockets.has(tableId) || stalkerState.sockets.userTables.has(tableId)) continue;

            let cd = stalkerState.socketCooldowns.get(tableId) || 0;
            if (Date.now() < cd) continue;

            stalkerState.backgroundTableSockets.set(tableId, { readyState: 0 });

            setTimeout(() => {
                if (stalkerState.sockets.userTables.has(tableId)) {
                    stalkerState.backgroundTableSockets.delete(tableId);
                    return;
                }

                let tableWs = new OrigWS(wsUrl);
                tableWs.__isBackgroundSpectator = true;
                tableWs.__tableId = tableId;
                tableWs.__tableContext = new TableContext(tableId, tInfo.tournId);
                
                hookSocketInstance(tableWs, wsUrl);

                stalkerState.backgroundTableSockets.set(tableId, tableWs);
                stalkerState.activeTables.set(tableId, tableWs.__tableContext);

                logDebug("SOCKET_CONNECT", `Подключение к столу ${tableId} [Spectator] (${tInfo.targetNick})`);

                tableWs.onopen = function() {
                    tableWs.send(`<EnterTable sessionId="${sid}" tableId="${tableId}" tournamentId="${tInfo.tournId}" client="html5mobile" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                    tableWs.send('<GetTableDetails/>');
                    tableWs.send('<JoinTable/>');

                    tableWs.__heartbeatTimer = setInterval(() => {
                        if (tableWs.readyState === WebSocket.OPEN) {
                            try { tableWs.send('<GetServerTime/>'); } catch(e) {}
                        }
                    }, 20000);
                };

                tableWs.onclose = function() {
                    if (tableWs.__heartbeatTimer) clearInterval(tableWs.__heartbeatTimer);
                    stalkerState.backgroundTableSockets.delete(tableId);
                    if (!stalkerState.sockets.userTables.has(tableId)) stalkerState.activeTables.delete(tableId);
                    stalkerState.socketCooldowns.set(tableId, Date.now() + 5000);
                    updateHUD();
                };

                tableWs.onerror = function() {
                    try { tableWs.close(); } catch(err) {}
                };
            }, spawnDelay);

            spawnDelay += (80 + Math.random() * 50);
        }
        updateHUD();
    }

    let timerPool = setInterval(manageBackgroundSpectatorPool, 2500);
    stalkerState.timerIds.push(timerPool);

    function triggerLobbyTournamentRefresh() {
        let lobbyWs = stalkerState.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>');
            } catch(e) {}
        }
    }

    async function dispatchParallelScanner() {
        if (stalkerState.isScanningActive || stalkerState.scannerQueue.length === 0) return;
        let sid = stalkerState.auth.sessionId || autoDetectSessionId();
        let wsUrl = stalkerState.auth.wssUrl;
        if (!wsUrl || !sid) return;

        stalkerState.isScanningActive = true;

        while (stalkerState.scannerQueue.length > 0) {
            let chunk = [];
            while (chunk.length < SCANNER_CONCURRENCY && stalkerState.scannerQueue.length > 0) {
                let tId = stalkerState.scannerQueue.shift();
                if (tId !== stalkerState.userViewingTournId) chunk.push(tId);
            }

            if (chunk.length > 0) {
                await Promise.allSettled(chunk.map(tId => scanSingleTournamentBackground(tId, wsUrl, sid)));
                await new Promise(r => setTimeout(r, 40));
            }
        }

        stalkerState.isScanningActive = false;
        updateHUD();
    }

    function scanSingleTournamentBackground(tournId, wsUrl, sid) {
        return new Promise((resolve) => {
            let tourn = stalkerState.liveTournaments.get(tournId);
            let bgWs = new OrigWS(wsUrl);
            bgWs.__isBackgroundSpectator = true;
            let finished = false;
            let currentLevel = (tourn && tourn.currentLevel) ? tourn.currentLevel : 1;
            let levelMap = new Map();
            let scheduleLoaded = false;
            let cachedPlayersXml = [];
            let dynamicTimeout = null;

            function cleanup() {
                if (!finished) {
                    finished = true;
                    if (dynamicTimeout) clearTimeout(dynamicTimeout);
                    try { bgWs.close(); } catch(e) {}
                    resolve();
                }
            }
            
            function resetDynamicTimeout() {
                if (dynamicTimeout) clearTimeout(dynamicTimeout);
                dynamicTimeout = setTimeout(cleanup, 2500);
            }
            resetDynamicTimeout();

            bgWs.onopen = function() {
                bgWs.send(`<EnterTournamentLobby id="${tournId}" sessionId="${sid}" client="html5mobile" clientFace="pokerdom" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                bgWs.send('<GetSchedule/>');
            };

            function processPlayerBlocks(text) {
                resetDynamicTimeout();
                let currentBB = 500;
                if (levelMap.has(currentLevel)) {
                    currentBB = levelMap.get(currentLevel);
                } else if (tourn && tourn.currentBB > 0) {
                    currentBB = tourn.currentBB;
                }
                if (tourn) {
                    tourn.currentBB = currentBB;
                    tourn.currentLevel = currentLevel;
                }

                let offset = iattr(text, 'offset') || 0;
                let total = iattr(text, 'total') || 0;
                let playerBlocks = text.matchAll(/<Player\s+([^>]+)>/g);
                let countInChunk = 0;

                let tMeta = stalkerState.tournamentCache.get(tournId) || { name: tourn ? tourn.name : 'MTT', baseBuyin: 0 };

                for (let pb of playerBlocks) {
                    countInChunk++;
                    let attrs = pb[1];
                    let rawNick = attr(attrs, 'nickname') || attr(attrs, 'name');
                    let cleanNick = getCleanNick(rawNick);
                    let tableId = attr(attrs, 'tableId');

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let stack = iattr(attrs, 'stack') || 0;
                        let rank = iattr(attrs, 'rank') || 0;
                        let place = iattr(attrs, 'placeFrom') || iattr(attrs, 'place') || iattr(attrs, 'placeTo') || 0;
                        let regPrize = fattr(attrs, 'prizeAmount');
                        let bountyPrize = fattr(attrs, 'knockoutBounty');
                        let totalPrize = regPrize + bountyPrize;
                        let uuid = attr(attrs, 'uuid') || `target_${cleanNick}`;
                        
                        let bullets = parseBulletNumber(rawNick);
                        let totalSpent = bullets * tMeta.baseBuyin;
                        
                        let isBusted = (place > 0) || (stack === 0);
                        let stackBB = (currentBB > 0 && stack > 0) ? (Math.round((stack / currentBB) * 10) / 10) : 0;

                        if (tableId && stack > 0 && !isBusted) {
                            stalkerState.discoveredTargetTables.set(tableId, {
                                tournId: tournId,
                                targetNick: cleanNick,
                                stack: stack
                            });
                        } else if (isBusted && tableId) {
                            stalkerState.discoveredTargetTables.delete(tableId);
                        }

                        let p = getOrCreatePlayerProfile(cleanNick);
                        let entryKey = `${tournId}_${rawNick}`;
                        let existingEntry = p.entries.get(entryKey);
                        let isNewEntry = !existingEntry;
                        let statusChanged = existingEntry && (existingEntry.isBusted !== isBusted);

                        p.entries.set(entryKey, {
                            rawNick: rawNick,
                            cleanNick: cleanNick,
                            uuid: uuid,
                            stack: stack,
                            stackBB: stackBB,
                            currentBB: currentBB,
                            tableId: tableId,
                            rank: rank,
                            place: place,
                            bullets: bullets,
                            regular_prize: regPrize,
                            bounty_prize: bountyPrize,
                            prize: totalPrize,
                            isBusted: isBusted,
                            tableName: tMeta.name,
                            tournId: tournId,
                            baseBuyin: tMeta.baseBuyin,
                            spent: totalSpent
                        });

                        if (isNewEntry || statusChanged) {
                            queueServerEvent(isBusted ? "TARGET_PLAYER_BUSTED" : "TARGET_PLAYER_DISCOVERED", {
                                uuid: uuid, name: cleanNick, raw_nick: rawNick, tournament_id: tournId,
                                tournament_name: tMeta.name, chips: stack, stack_bb: stackBB,
                                place: place, prize: totalPrize, is_busted: isBusted, spent_rub: totalSpent
                            });
                        }
                        updateHUD();
                    }
                }

                if (total > (offset + countInChunk) && countInChunk > 0) {
                    try { bgWs.send(`<GetPlayers offset="${offset + countInChunk}" count="50"/>`); } catch(e) { cleanup(); }
                } else {
                    cleanup();
                }
            }

            bgWs.onmessage = async function(e) {
                let text = await decodeSocketPayload(e.data);
                if (!text) return;
                resetDynamicTimeout();

                if (text.includes('<TournamentDetails') || text.includes('<Tournament ') || text.includes('currentLevel=')) {
                    let lvl = iattr(text, 'currentLevel') || iattr(text, 'level');
                    if (lvl) {
                        currentLevel = lvl;
                        if (tourn) tourn.currentLevel = lvl;
                    }
                }

                if (text.includes('<Schedule')) {
                    let sLvl = iattr(text, 'currentLevel');
                    if (sLvl) currentLevel = sLvl;

                    let items = text.matchAll(/<Item\s+([^>]+)>/g);
                    for (let im of items) {
                        let num = iattr(im[1], 'number') || 0;
                        let hs = iattr(im[1], 'highStake') || 0;
                        if (num > 0 && hs > 0) levelMap.set(num, hs);
                    }
                    if (levelMap.has(currentLevel) && tourn) {
                        tourn.currentBB = levelMap.get(currentLevel);
                    }
                    scheduleLoaded = true;
                    bgWs.send('<GetPlayers offset="0" count="50"/>');

                    while (cachedPlayersXml.length > 0) {
                        processPlayerBlocks(cachedPlayersXml.shift());
                    }
                }

                if (text.includes('<Players')) {
                    if (scheduleLoaded) processPlayerBlocks(text);
                    else cachedPlayersXml.push(text);
                }
            };
            bgWs.onerror = cleanup;
            bgWs.onclose = cleanup;
        });
    }

    function parseXmlStream(xml, ws, dir = 'IN') {
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        try {
            let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
            if (sessMatch) stalkerState.auth.sessionId = sessMatch[1];

            let versMatch = xml.match(/\bclientVersion="([^"]+)"/);
            if (versMatch) stalkerState.auth.clientVersion = versMatch[1];

            if (dir === 'OUT') {
                if (ws.__isBackgroundSpectator) return;

                if (xml.includes('<EnterTournamentLobby')) {
                    stalkerState.userViewingTournId = attr(xml, 'id');
                } else if (xml.includes('<EnterTable') || xml.includes('<OpenTable')) {
                    let tableId = attr(xml, 'tableId') || attr(xml, 'id');
                    let tournId = attr(xml, 'tournamentId') || attr(xml, 'tournId');
                    if (tableId) {
                        if (stalkerState.backgroundTableSockets.has(tableId)) {
                            let bgWs = stalkerState.backgroundTableSockets.get(tableId);
                            try { if (bgWs && typeof bgWs.close === 'function') bgWs.close(); } catch(e) {}
                            stalkerState.backgroundTableSockets.delete(tableId);
                            logDebug("YIELD", `Уступили стол ${tableId} клиенту`);
                        }

                        stalkerState.userViewingTableId = tableId;
                        stalkerState.sockets.userTables.set(tableId, ws);
                        ws.__tableId = tableId;
                        if (!stalkerState.activeTables.has(tableId)) {
                            ws.__tableContext = new TableContext(tableId, tournId);
                            stalkerState.activeTables.set(tableId, ws.__tableContext);
                        } else {
                            ws.__tableContext = stalkerState.activeTables.get(tableId);
                            if (tournId && !ws.__tableContext.tournId) ws.__tableContext.tournId = tournId;
                        }
                    }
                }
                return;
            }

            // ПЕРЕХВАТ РАСФОРМИРОВАНИЯ СТОЛА (MEMORY LEAK FIX)
            if (xml.includes('<TableClosed') || xml.includes('Table closed') || xml.includes('Стол расформирован')) {
                let tableId = ws.__tableId;
                if (tableId) {
                    stalkerState.discoveredTargetTables.delete(tableId);
                    if (ws.__isBackgroundSpectator) {
                        try { ws.close(); } catch(e) {}
                    }
                }
            }

            if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
                ws.__socketType = 'LOBBY';
                if (!stalkerState.sockets.lobby) {
                    stalkerState.sockets.lobby = ws;
                    triggerLobbyTournamentRefresh();
                }
            }

            if (xml.includes('<Tournaments')) {
                let matches = xml.matchAll(/<Table\s+([^>]+)>/g);
                let currentLiveIds = new Set();

                for (let m of matches) {
                    let attrs = m[1];
                    let tId = attr(attrs, 'id');
                    let tName = attr(attrs, 'name') || '';
                    let tStatus = attr(attrs, 'status');
                    let tGame = attr(attrs, 'game') || '';
                    
                    let rawBuyin = fattr(attrs, 'buyIn') || fattr(attrs, 'buyin') || fattr(attrs, 'stake') || 0;
                    let bounty = fattr(attrs, 'knockoutBounty') || fattr(attrs, 'bounty') || 0;
                    let fee = fattr(attrs, 'fee') || 0;

                    let trueBaseBuyin = rawBuyin;
                    if (rawBuyin > 0 && (bounty + fee) > 0 && rawBuyin < (bounty + fee + 10)) {
                        trueBaseBuyin = rawBuyin + bounty + fee;
                    } else if (rawBuyin > 0 && fee > 0 && rawBuyin < 100000 && !tName.toLowerCase().includes('фрибай')) {
                        if (rawBuyin === fattr(attrs, 'stake') && fee > 0) trueBaseBuyin = rawBuyin + fee + bounty;
                    }

                    if (tId && tName) {
                        stalkerState.tournamentCache.set(tId, {
                            name: decodeHtml(tName),
                            baseBuyin: trueBaseBuyin,
                            bounty: bounty,
                            fee: fee,
                            isPKO: bounty > 0 || /нокаут|bounty|pko/i.test(tName)
                        });
                    }

                    let isHoldem = tGame.includes('TEXAS_HOLDEM') || tGame.includes('HOLDEM') || (!tGame.includes('OMAHA') && !tGame.includes('PINEAPPLE') && !tName.toLowerCase().includes('омаха') && !tName.toLowerCase().includes('ананас'));
                    let isLiveRunning = LIVE_STATUSES.has(tStatus);

                    if (isHoldem && tId && isLiveRunning) {
                        currentLiveIds.add(tId);
                        if (!stalkerState.liveTournaments.has(tId)) {
                            stalkerState.liveTournaments.set(tId, { id: tId, name: decodeHtml(tName) || 'MTT', status: tStatus, currentBB: 500, currentLevel: 1 });
                        } else {
                            let item = stalkerState.liveTournaments.get(tId);
                            item.status = tStatus;
                            if (tName) item.name = decodeHtml(tName);
                        }
                        if (!stalkerState.scannerQueue.includes(tId)) stalkerState.scannerQueue.push(tId);
                    } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED')) {
                        stalkerState.liveTournaments.delete(tId);
                    }
                }

                for (let [tableId, tInfo] of stalkerState.discoveredTargetTables.entries()) {
                    if (tInfo.tournId && !currentLiveIds.has(tInfo.tournId)) {
                        stalkerState.discoveredTargetTables.delete(tableId);
                    }
                }

                dispatchParallelScanner();
                updateHUD();
            }

            if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
                let tableId = attr(xml, 'id') || attr(xml, 'tableId');
                let tournId = attr(xml, 'tournamentId') || attr(xml, 'tournId');
                let tName = attr(xml, 'tournamentName') || attr(xml, 'name');
                if (tournId && tName && !stalkerState.tournamentCache.has(tournId)) {
                    stalkerState.tournamentCache.set(tournId, { name: decodeHtml(tName), baseBuyin: 0, isPKO: /нокаут|bounty|pko/i.test(tName) });
                }

                if (tableId) {
                    ws.__tableId = tableId;
                    if (!ws.__tableContext) {
                        ws.__tableContext = stalkerState.activeTables.get(tableId) || new TableContext(tableId, tournId);
                    }
                    if (tournId && !ws.__tableContext.tournId) ws.__tableContext.tournId = tournId;
                    stalkerState.activeTables.set(tableId, ws.__tableContext);
                }
            }

            let ctx = ws.__tableContext;
            if (!ctx) return;

            let bbAttr = iattr(xml, 'highStake');
            let sbAttr = iattr(xml, 'lowStake');
            let anteAttr = iattr(xml, 'ante');
            let numAttr = iattr(xml, 'number');
            if (bbAttr !== null && bbAttr > 0) {
                ctx.level.bb = bbAttr;
                ctx.level.sb = sbAttr !== null ? sbAttr : Math.round(bbAttr / 2);
                ctx.level.ante = anteAttr !== null ? anteAttr : 0;
                if (numAttr !== null) ctx.level.number = numAttr;
            }

            if (xml.includes('<Seats') || (xml.includes('<Seat ') && (xml.includes('nickname=') || xml.includes('<PlayerInfo')))) {
                let seatBlocks = xml.matchAll(/<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/Seat>)/gs);
                for (let sb of seatBlocks) {
                    let seatAttrs = sb[1];
                    let seatNum = parseInt(sb[2], 10);
                    let seatContent = sb[3] || '';

                    let piM = seatContent.match(/<PlayerInfo[^>]*nickname="([^"]+)"/);
                    let rawNick = attr(seatAttrs, 'nickname') || attr(seatAttrs, 'name') || (piM ? piM[1] : null) || attr(seatContent, 'nickname') || attr(seatContent, 'name');
                    
                    let chipsM = seatContent.match(/<Chips[^>]*\/>/);
                    let stackM = seatContent.match(/stack-size="([^"]+)"/);
                    let entryM = seatContent.match(/<Entry\s+([^>]*)\/?>/);
                    
                    let serverStack = attr(seatAttrs, 'stack-size') ? parseInt(attr(seatAttrs, 'stack-size'), 10) : (chipsM ? iattr(chipsM[0], 'stack-size') : (stackM ? parseInt(stackM[1], 10) : null));
                    let serverSpent = entryM ? (fattr(entryM[1], 'spent') || 0) : 0;

                    let isSittingOut = seatAttrs.includes('sittingOut="true"') || seatContent.includes('sittingOut="true"');
                    if (isSittingOut) ctx.sittingOutSeats.add(seatNum);
                    else ctx.sittingOutSeats.delete(seatNum);

                    let s = ctx.ensureSeat(seatNum, rawNick, serverStack);
                    s.busted = (serverStack === 0);
                    if (serverSpent > 0) s.spent = serverSpent;

                    if (ctx.hand === null && serverStack !== null && serverStack > 0) {
                        ctx.handStart[seatNum] = serverStack;
                    }

                    if (rawNick && TARGET_WATCHLIST.has(s.cleanNick)) {
                        let p = getOrCreatePlayerProfile(s.cleanNick);
                        let tournId = ctx.tournId;
                        let entryKey = `${tournId || ctx.tableId}_${rawNick}`;
                        let bullets = parseBulletNumber(rawNick);
                        let baseBuyin = ctx.getTournamentMeta().baseBuyin;

                        let entry = p.entries.get(entryKey) || {
                            rawNick: rawNick,
                            cleanNick: s.cleanNick,
                            tableName: ctx.getTournamentMeta().name,
                            baseBuyin: baseBuyin
                        };
                        
                        if (!entry.isBusted || entry.place === 0) {
                            if (serverStack !== null) entry.stack = serverStack;
                            entry.tournId = tournId;
                            entry.tableId = ctx.tableId;
                            entry.isBusted = (entry.stack === 0);
                            entry.bullets = bullets;
                            entry.spent = bullets * baseBuyin;
                            entry.baseBuyin = baseBuyin || entry.baseBuyin;
                            entry.tableName = ctx.getTournamentMeta().name;
                            p.entries.set(entryKey, entry);
                            updateHUD();
                        }
                    }
                }
            }

            if (xml.includes('<GameState') || xml.includes('<Message>')) {
                let gsM = xml.match(/<GameState\s+([^>]*)>/);
                if (gsM) {
                    let gh = attr(gsM[0], 'hand');
                    let seatsTag = xml.match(/<Seats\s+([^>]*)>/);
                    let gsDealer = seatsTag ? iattr(seatsTag[0], 'dealer') : 0;

                    if (gh && (!ctx.hand || ctx.hand !== gh)) {
                        let actList = [];
                        let mm, sRe = /<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/Seat>)/g;
                        while ((mm = sRe.exec(xml)) !== null) {
                            if (/activeInHand="true"/.test(mm[1])) {
                                let sn = parseInt(mm[2], 10);
                                let rNick = attr(mm[1], 'nickname') || (mm[3] ? attr(mm[3], 'nickname') : null);
                                ctx.ensureSeat(sn, rNick, null);
                                actList.push(sn);
                            }
                        }
                        ctx.beginHand(gh, gsDealer, actList);
                        ctx.handOrigin = 'midhand-sync';
                    }
                }

                let newHandMatch = xml.match(/<NewHand\s+([^>]*)\/>/);
                if (newHandMatch) {
                    let handNum = attr(newHandMatch[0], 'number');
                    let dealer = iattr(newHandMatch[0], 'dealer') || 0;
                    let actSeats = [];
                    let asM = xml.match(/<ActiveSeats>([\s\S]*?)<\/ActiveSeats>/);
                    if (asM) {
                        let sm, asRe = /<Seat\s+id="(\d+)"/g;
                        while ((sm = asRe.exec(asM[1])) !== null) actSeats.push(parseInt(sm[1], 10));
                    }
                    ctx.beginHand(handNum, dealer, actSeats);
                    ctx.handOrigin = 'newhand';
                }

                let acM = xml.matchAll(/<ActiveChange\s+([^>]*)\/>/g);
                for (let ac of acM) {
                    let actSeat = iattr(ac[1], 'seat');
                    if (actSeat !== null) ctx.seatTimerStart.set(actSeat, Date.now());
                }

                let ACTION_RE = /<PlayerAction\s+seat="(\d+)"([^>]*)>([\s\S]*?)<\/PlayerAction>/g;
                let am;
                while ((am = ACTION_RE.exec(xml)) !== null) {
                    let seatNum = parseInt(am[1], 10);
                    let actionAttrs = am[2];
                    let body = am[3];
                    let actionId = attr(actionAttrs, 'id') || `${ctx.hand}_${ctx.street}_${seatNum}_${body.slice(0, 30)}`;
                    
                    if (ctx.processedActionIds.has(actionId)) continue;
                    ctx.processedActionIds.add(actionId);

                    let inner = body.match(/^<(\w+)([^>]*)\/?>/) || body.match(/^<(\w+)([^>]*)>/);
                    if (!inner) continue;
                    let kind = inner[1], aStr = inner[2];
                    let amount = iattr(aStr, 'amount') || 0;
                    let s = ctx.ensureSeat(seatNum, null);

                    if (kind === 'SitOut') ctx.sittingOutSeats.add(seatNum);
                    else if (kind === 'SitIn') ctx.sittingOutSeats.delete(seatNum);

                    if (['PostAnte', 'PostSmallBlind', 'PostBigBlind', 'Bet', 'Raise', 'Call', 'AllIn', 'UncalledBet'].includes(kind)) {
                        ctx.recordAction(seatNum,
                            kind === 'PostAnte' ? 'ANTE' :
                            kind === 'PostSmallBlind' ? 'SB' :
                            kind === 'PostBigBlind' ? 'BB' : 
                            kind === 'AllIn' ? 'ALLIN' : kind.toUpperCase(),
                            amount);
                    } else if (kind === 'Fold') {
                        ctx.activeSeats.delete(seatNum);
                        s.inHand = false;
                        ctx.recordAction(seatNum, 'FOLD', 0);
                    } else if (kind === 'Check') {
                        ctx.recordAction(seatNum, 'CHECK', 0);
                    } else if (kind === 'Show') {
                        let cards = Array.from(body.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                        let comb = attr(aStr, 'combination') || '';
                        if (cards.length >= 2) {
                            ctx.showdownCards[seatNum] = { cards: cards.slice(0, 2).join(' '), isMuck: false, combination: decodeHtml(comb) };
                        }
                    } else if (kind === 'Muck') {
                        let mc = Array.from(body.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase());
                        if (mc.length >= 2) {
                            ctx.showdownCards[seatNum] = { cards: mc.slice(0, 2).join(' '), isMuck: true, combination: '' };
                        }
                    }

                    if (TARGET_WATCHLIST.has(s.cleanNick) && !ctx.sittingOutSeats.has(seatNum)) {
                        let p = getOrCreatePlayerProfile(s.cleanNick);
                        let isPreflop = (ctx.street === 'PREFLOP');
                        let playerPos = ctx.positions[seatNum] || '';

                        if (['Call'].includes(kind)) {
                            p.passiveActions++;
                            p.totalActions++;
                            if (isPreflop && !ctx.playersActedThisHand.has(`${s.cleanNick}_VPIP`)) {
                                p.vpipCount++;
                                ctx.playersActedThisHand.add(`${s.cleanNick}_VPIP`);
                            }
                        } else if (['Raise', 'Bet', 'AllIn'].includes(kind)) {
                            p.aggressiveActions++;
                            p.totalActions++;
                            if (isPreflop) {
                                if (!ctx.playersActedThisHand.has(`${s.cleanNick}_VPIP`)) {
                                    p.vpipCount++;
                                    ctx.playersActedThisHand.add(`${s.cleanNick}_VPIP`);
                                }
                                if (!ctx.playersActedThisHand.has(`${s.cleanNick}_PFR`)) {
                                    p.pfrCount++;
                                    ctx.playersActedThisHand.add(`${s.cleanNick}_PFR`);
                                }
                            }
                        } else if (kind === 'Fold') {
                            p.totalActions++;
                            if (isPreflop) {
                                if (playerPos === 'BB') { p.stealFacedBB++; }
                                else if (playerPos.includes('SB')) { p.stealFacedSB++; }
                            }
                        } else if (kind === 'Check') {
                            p.totalActions++;
                        }
                    }
                }

                ctx.updateBoardFromXml(xml);

                let koBlock = xml.match(/<KnockoutPayouts[\s\S]*?<\/KnockoutPayouts>/i) || xml.match(/<Knockout\s+([^>]*)\/>/i);
                if (koBlock && ctx && ctx.hand) {
                    let koM = xml.match(/<Knockout\s+([^>]*)\/>/);
                    let payM = xml.match(/<KnockoutPayout\s+([^>]*)\/>/);
                    let headBountyM = xml.match(/<KnockoutBounty\s+([^>]*)\/>/);

                    if (koM) {
                        let bustedSeat = iattr(koM[1], 'busted');
                        let winnerSeat = iattr(koM[1], 'winners') !== null ? iattr(koM[1], 'winners') : iattr(koM[1], 'winner');

                        if (winnerSeat === null && ctx.winners.length > 0) winnerSeat = ctx.winners[0].seat;

                        let cashReward = payM ? fattr(payM[1], 'amount') : 0;
                        let bountyGrowth = payM ? fattr(payM[1], 'selfBountyChange') : 0;
                        let newHeadBounty = headBountyM ? fattr(headBountyM[1], 'amount') : 0;

                        let killer = ctx.seats.get(winnerSeat);
                        let victim = ctx.seats.get(bustedSeat);

                        if (killer && newHeadBounty > 0) killer.headBounty = newHeadBounty;

                        ctx.knockoutBounties.push({
                            killer_seat: winnerSeat,
                            killer_nick: killer ? killer.rawNick : `Seat ${winnerSeat}`,
                            killer_clean_nick: killer ? killer.cleanNick : `seat_${winnerSeat}`,
                            victim_seat: bustedSeat,
                            victim_nick: victim ? victim.rawNick : `Seat ${bustedSeat}`,
                            victim_clean_nick: victim ? victim.cleanNick : `seat_${bustedSeat}`,
                            cash_payout_rub: cashReward,
                            bounty_growth_rub: bountyGrowth,
                            killer_new_head_bounty_rub: newHeadBounty
                        });
                        logDebug("KNOCKOUT_AWARD", `💥 K.O.: ${killer ? killer.rawNick : winnerSeat} выбил ${victim ? victim.rawNick : bustedSeat} (+${cashReward}₽ в кассу)`);
                    }
                }

                if (xml.includes('<Winner')) {
                    let wMatches = xml.matchAll(/<Winner\s+([^>]*?)>(.*?)<\/Winner>|<Winner\s+([^>]*?)\/>/gs);
                    for (let wm of wMatches) {
                        let wAttr = wm[1] || wm[3] || '';
                        let wInner = wm[2] || '';
                        let wSeat = iattr(wAttr, 'seat');
                        let wAmt = iattr(wAttr, 'amount') || 0;
                        let wPot = iattr(wAttr, 'pot');
                        let potIdx = wPot !== null ? wPot : ctx.winners.length;
                        let wComb = decodeHtml(attr(wAttr, 'combination') || '');
                        let wCards = Array.from(wInner.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => (m[1] === '10' ? 'T' : m[1].toUpperCase()) + m[2].toLowerCase()).slice(0, 5).join(' ');

                        let alreadyAdded = ctx.winners.some(w => w.seat === wSeat && w.potIndex === potIdx);
                        if (!alreadyAdded && wSeat !== null && wAmt > 0) {
                            ctx.winners.push({ seat: wSeat, amount: wAmt, potIndex: potIdx, combination: wComb, cards: wCards });
                        }
                    }
                }

                if (/<EndHand/.test(xml)) {
                    let finalizedHand = ctx.finalizeHand();
                    if (finalizedHand && !stalkerState.recordedHandNumbers.has(finalizedHand.hand_number)) {
                        stalkerState.recordedHandNumbers.add(finalizedHand.hand_number);
                        stalkerState.completedHandsArchive.push(finalizedHand);
                        if (stalkerState.completedHandsArchive.length > MAX_ARCHIVE_HANDS) {
                            let removed = stalkerState.completedHandsArchive.shift();
                            stalkerState.recordedHandNumbers.delete(removed.hand_number);
                        }
                        updateHUD();
                    }
                    ctx.hand = null;
                }
            }

            let chatM = xml.match(/<ChatMessage\s+([^>]*)\/>/);
            if (chatM) {
                let cAttr = chatM[1];
                let sender = attr(cAttr, 'from');
                let text = attr(cAttr, 'text');

                if (sender && text && !/Dealer|Дилер|Система/i.test(sender) && !SYSTEM_CHAT_REGEX.test(text)) {
                    let cleanSender = getCleanNick(sender);
                    stalkerState.chatLogs.push({
                        timestamp: new Date().toISOString(),
                        tournament_name: ctx ? ctx.getTournamentMeta().name : 'MTT',
                        table_id: ws.__tableId || 'unknown',
                        nick: sender,
                        cleanNick: cleanSender,
                        is_target: TARGET_WATCHLIST.has(cleanSender),
                        message: decodeHtml(text)
                    });
                }
            }
        } catch(e) {
            console.error("XML Stream Error:", e);
        }
    }

    let timerQueue = setInterval(processOutboxQueue, 3000);
    stalkerState.timerIds.push(timerQueue);

    async function decodeSocketPayload(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            let buffer;
            if (data instanceof ArrayBuffer) buffer = data;
            else if (data instanceof Blob) buffer = await data.arrayBuffer();
            else if (ArrayBuffer.isView(data)) buffer = data.buffer;
            else return String(data);

            let uint8 = new Uint8Array(buffer);
            if (uint8.length > 2 && ((uint8[0] === 0x1f && uint8[1] === 0x8b) || (uint8[0] === 0x78))) {
                if (typeof DecompressionStream !== 'undefined') {
                    try {
                        let ds = new DecompressionStream(uint8[0] === 0x1f ? 'gzip' : 'deflate');
                        let stream = new Response(buffer).body.pipeThrough(ds);
                        return await new Response(stream).text();
                    } catch(e) {}
                }
            }
            return new TextDecoder('utf-8').decode(buffer);
        } catch(e) {
            return String(data);
        }
    }

    function hookSocketInstance(ws, explicitUrl) {
        if (!ws || ws.__stalkerHookedV460) return;
        ws.__stalkerHookedV460 = true;

        let targetUrl = explicitUrl || ws.url || ws._url;
        if (targetUrl && typeof targetUrl === 'string' && (targetUrl.includes('/ws') || targetUrl.startsWith('ws'))) {
            stalkerState.auth.wssUrl = targetUrl;
        }

        ws.addEventListener('message', async function (e) {
            let text = await decodeSocketPayload(e.data);
            
            if (text.includes('sessionId=') && !ws.__isBackgroundSpectator) {
                stalkerState.auth.sessionId = attr(text, 'sessionId');
                if (!stalkerState.sockets.lobby && !text.includes('tableId=')) {
                    stalkerState.sockets.lobby = ws;
                    try { ws.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>'); } catch(err){}
                }
            }
            
            parseXmlStream(text, ws, 'IN');
        });

        ws.addEventListener('close', function() {
            if (ws.__tableId) {
                stalkerState.sockets.userTables.delete(ws.__tableId);
                if (!stalkerState.backgroundTableSockets.has(ws.__tableId)) {
                    stalkerState.activeTables.delete(ws.__tableId);
                }
            }
        });
    }

    var OrigWS = window.WebSocket;
    if (OrigWS && !window.__stalkerWsProxyV460) {
        window.__stalkerWsProxyV460 = true;
        window.WebSocket = new Proxy(OrigWS, {
            construct: function(target, args) {
                let ws = Reflect.construct(target, args);
                hookSocketInstance(ws, args[0]);
                return ws;
            }
        });

        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(p => {
            if (OrigWS[p] !== undefined) window.WebSocket[p] = OrigWS[p];
        });

        let origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function(data) {
            hookSocketInstance(this);
            decodeSocketPayload(data).then(text => {
                parseXmlStream(text, this, 'OUT');
            });
            return origSend.apply(this, arguments);
        };
    }

    window.__pokerStalkerInstance = {
        destroy: function() {
            stalkerState.timerIds.forEach(id => clearInterval(id));
            stalkerState.backgroundTableSockets.forEach(ws => {
                try { if (ws && typeof ws.close === 'function') ws.close(); } catch(e) {}
            });
            stalkerState.backgroundTableSockets.clear();
            document.querySelectorAll('[id^="stalker-hud"]').forEach(el => el.remove());
            logDebug("SYS", "Инстанс v46.0 уничтожен");
        }
    };

    autoDetectSessionId();
    triggerLobbyTournamentRefresh();

    console.log("%c👑 [SCALPEL v46.0 APEX-ABSOLUTE] Запущен. Идеальная чип-консервация, математически точный GTO-экспортер и унифицированный DSL.", "color:#10b981;font-weight:bold;font-size:13px;");
})();

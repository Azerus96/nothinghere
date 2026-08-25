javascript:(function(){
    if (window.__pokerStalkerV29Swiss) {
        alert('🎯 VIP Stalker v29.0 SWISS-DIAGNOSTIC уже запущен!');
        return;
    }
    window.__pokerStalkerV29Swiss = true;

    /* ══════════════════════════════════════════════════════════════════
       ULTIMATE SCALPEL v29.0 — ZERO-THRASHING SWISS DIAGNOSTIC ENGINE
       ══════════════════════════════════════════════════════════════════ */

    const scoutServerUrl = "https://toofunoff-poker-scout.hf.space";
    const MAX_BACKGROUND_TABLES = 40;
    const MAX_ARCHIVE_HANDS = 3000;
    const MAX_OUTBOX_QUEUE = 1000;
    const MAX_DEBUG_LOGS = 300;

    const TARGET_WATCHLIST = new Set([
        "vesnushka", "bagzik", "nogano777", "dostigatel", "bankiir", 
        "mushroomless", "xasiknolook", "riverpomojet", "donkmaster", "kavsan", 
        "deepmind", "biglebowski77", "imbonoob", "badbeat71", "mike_scott", 
        "foldmi", "fedorav", "grenadinec", "nedenegradi", "legilemens", 
        "thestudent", "anarhisttt", "belarusftw", "sgeeeee", "master3anosov", 
        "kirov999", "donskikh", "bumblebee", "karanebesnaya", "anacreosha",
        "saiyn_belek", "molyavka89", "blancl664", "why__not", "cashmachine", 
        "vorobyshek", "bar_suk74", "lev_altay", "kastarksn", "borsalino", "suitedjaxx69"
    ].map(n => n.toLowerCase()));

    const LIVE_STATUSES = new Set(['RUNNING', 'LATE_REG', 'LATE_REGISTRATION', 'SEATING', 'PAUSED', 'DEALING']);

    const stalkerState = {
        isCollapsed: false,
        hfStatus: 'Инициализация...',
        userViewingTournId: null,
        outboxQueue: [],
        completedHandsArchive: [],
        recordedHandNumbers: new Set(),
        engineDebugLog: [],
        auth: { sessionId: null, wssUrl: null, clientVersion: "71.0.138" },
        sockets: { lobby: null, tables: new Map() },
        liveTournaments: new Map(),
        discoveredTargetTables: new Map(),
        backgroundTableSockets: new Map(),
        activeTables: new Map(),
        stalkedPlayers: new Map(),
        scannerQueue: [],
        isScanningActive: false
    };

    function logDebug(category, message) {
        let entry = {
            time: new Date().toLocaleTimeString(),
            category: category,
            message: message
        };
        stalkerState.engineDebugLog.push(entry);
        if (stalkerState.engineDebugLog.length > MAX_DEBUG_LOGS) {
            stalkerState.engineDebugLog.shift();
        }
    }

    function attr(str, name) {
        if (!str || typeof str !== 'string') return null;
        let m = str.match(new RegExp(`(?:\\b|\\s)${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function iattr(str, name) {
        let v = attr(str, name);
        if (v === null || v === undefined || v === '') return null;
        let n = parseInt(v, 10);
        return isNaN(n) ? null : n;
    }

    function decodeHtml(html) {
        if (!html) return "";
        return html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    function getCleanNick(rawNick) {
        if (!rawNick) return "";
        return rawNick.replace(/\s*#\d+.*$/, '').trim().toLowerCase();
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
    autoDetectSessionId();

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
                vpipCount: 0,
                pfrCount: 0,
                aggressiveActions: 0,
                totalActions: 0,
                foldBBCount: 0,
                stealFacedBB: 0,
                foldSBCount: 0,
                stealFacedSB: 0
            });
        }
        return stalkerState.stalkedPlayers.get(cleanNick);
    }

    // ── ЧИСТЫЙ МАТЕМАТИЧЕСКИЙ ДВИЖОК СТОЛА ─────────────────────────────
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
            this.winnerSum = 0;
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.totalChipsContributed = new Map();
            this.handActions = new Map();
            this.recordedShowdownSeats = new Set();
            this.sittingOutSeats = new Set();
            this.playersActedThisHand = new Set();
            this.processedActionIds = new Set();
            this.handOrigin = null;
            this.potOnFlop = 0;
            this.potOnTurn = 0;
            this.potOnRiver = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;
        }

        getActiveHandBB() {
            if (this.handLevel && this.handLevel.bb > 0) return this.handLevel.bb;
            if (this.level.bb > 0) return this.level.bb;
            if (this.tournId && stalkerState.liveTournaments.has(this.tournId)) {
                return stalkerState.liveTournaments.get(this.tournId).currentBB || 500;
            }
            return 500;
        }

        getLiveStackBB(chips) {
            let bb = this.getActiveHandBB();
            return (bb > 0 && chips !== null && chips !== undefined) ? Math.round((chips / bb) * 100) / 100 : null;
        }

        streetBetTotal() {
            let t = 0;
            this.seats.forEach(s => { if (s.streetBet > 0) t += s.streetBet; });
            return t;
        }

        displayPot() {
            return this.potSwept + this.streetBetTotal();
        }

        ensureSeat(seatNum, rawNick, initialStack = null) {
            let clean = rawNick ? getCleanNick(rawNick) : '';
            if (!this.seats.has(seatNum)) {
                this.seats.set(seatNum, {
                    seat: seatNum,
                    rawNick: rawNick || `Seat ${seatNum}`,
                    cleanNick: clean || `seat_${seatNum}`,
                    uuid: clean ? `u_${clean}` : `seat_${seatNum}`,
                    stack: initialStack !== null ? initialStack : 0,
                    streetBet: 0,
                    inHand: false,
                    busted: false,
                    vacated: false
                });
            }

            let s = this.seats.get(seatNum);
            if (rawNick && s.rawNick !== rawNick) {
                s.rawNick = rawNick;
                s.cleanNick = clean;
                s.uuid = `u_${clean}`;
                if (initialStack !== null) s.stack = initialStack;
            } else if (initialStack !== null && (s.stack === 0 || s.stack === null)) {
                s.stack = initialStack;
            }
            return s;
        }

        beginHand(handNum, dealerSeat, activeSeatsList) {
            this.hand = handNum;
            this.dealer = dealerSeat || 0;
            this.board = [];
            this.street = 'PREFLOP';
            this.potSwept = 0;
            this.winnerSum = 0;
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.totalChipsContributed.clear();
            this.activeSeats.clear();
            this.dealtSeats.clear();
            this.handActions.clear();
            this.recordedShowdownSeats.clear();
            this.playersActedThisHand.clear();
            this.processedActionIds.clear();
            this.potOnFlop = 0;
            this.potOnTurn = 0;
            this.potOnRiver = 0;
            this.playersOnFlop = 0;
            this.playersOnRiver = 0;

            let currentBB = this.getActiveHandBB();
            this.handLevel = { 
                sb: this.level.sb || Math.round(currentBB / 2), 
                bb: currentBB, 
                ante: this.level.ante || 0, 
                number: this.level.number 
            };

            this.seats.forEach(s => {
                s.streetBet = 0;
                s.inHand = false;
            });

            for (let sn of activeSeatsList) {
                let s = this.ensureSeat(sn, null);
                this.activeSeats.add(sn);
                this.dealtSeats.add(sn);
                s.inHand = true;
                this.handStart[sn] = (s.stack !== null && s.stack > 0) ? s.stack : 0;
                this.totalChipsContributed.set(sn, 0);
                this.handActions.set(sn, []);

                if (TARGET_WATCHLIST.has(s.cleanNick) && !this.sittingOutSeats.has(sn)) {
                    getOrCreatePlayerProfile(s.cleanNick).handsCount++;
                }
            }

            this.positions = calculatePositions(activeSeatsList, this.dealer);
        }

        applyChipAction(seatNum, kind, amount) {
            let s = this.ensureSeat(seatNum, null);
            if (amount === null || amount === undefined || isNaN(amount)) return;
            if (s.stack === null || isNaN(s.stack)) s.stack = 0;

            let curContrib = this.totalChipsContributed.get(seatNum) || 0;

            if (kind === 'UncalledBet') {
                let actualRefund = curContrib > 0 ? Math.min(amount, curContrib) : amount;
                s.stack += actualRefund;
                s.streetBet = Math.max(0, (s.streetBet || 0) - actualRefund);
                this.totalChipsContributed.set(seatNum, Math.max(0, curContrib - actualRefund));
                return;
            }

            let actualDelta = amount;
            let startSt = this.handStart[seatNum] || 0;
            if (startSt > 0) {
                actualDelta = Math.min(amount, Math.max(0, s.stack));
            }

            s.stack -= actualDelta;
            s.streetBet = (s.streetBet || 0) + actualDelta;

            if (kind === 'PostAnte' && !this.handLevel.ante) this.handLevel.ante = amount;
            if (kind === 'PostSmallBlind' && !this.handLevel.sb) this.handLevel.sb = amount;
            if (kind === 'PostBigBlind' && !this.handLevel.bb) this.handLevel.bb = amount;

            this.totalChipsContributed.set(seatNum, curContrib + actualDelta);
        }

        recordAction(seatNum, label, amount) {
            let s = this.ensureSeat(seatNum, null);
            let list = this.handActions.get(seatNum) || [];
            let str = `${this.street}_${label}`;
            if (amount && amount > 0) {
                let pot = this.displayPot();
                let potPct = pot > 0 ? Math.round(amount / pot * 100) : 0;
                str += `:${amount}` + (potPct > 0 && potPct <= 1000 ? `(${potPct}%pot)` : '');
            }
            list.push(str);
            this.handActions.set(seatNum, list);
        }

        updateBoardFromXml(xml) {
            let boardDirect = xml.match(/<Board>(.*?)<\/Board>/i);
            if (boardDirect) {
                let cards = Array.from(boardDirect[1].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                if (cards.length >= 3) {
                    this.board = cards.slice(0, 5);
                    this.street = this.board.length === 5 ? 'RIVER' : (this.board.length === 4 ? 'TURN' : 'FLOP');
                    return;
                }
            }

            let streets = [['DealingFlop', 'FLOP', 3], ['DealingTurn', 'TURN', 4], ['DealingRiver', 'RIVER', 5]];
            for (let [tag, sName, maxCount] of streets) {
                let stM = xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i'));
                if (stM) {
                    let fc = Array.from(stM[0].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                    this.street = sName;
                    this.seats.forEach(s => { s.streetBet = 0; });
                    if (fc.length) {
                        if (sName === 'FLOP') {
                            this.board = fc.slice(0, 3);
                            this.potOnFlop = this.displayPot();
                            this.playersOnFlop = this.activeSeats.size;
                        } else if (this.board.length < maxCount) {
                            while (this.board.length < maxCount - 1) this.board.push('??');
                            this.board.push(fc[fc.length - 1]);
                            if (sName === 'TURN') this.potOnTurn = this.displayPot();
                            if (sName === 'RIVER') {
                                this.potOnRiver = this.displayPot();
                                this.playersOnRiver = this.activeSeats.size;
                            }
                        }
                    }
                }
            }
        }

        finalizeHand() {
            if (!this.hand) return null;
            let handBB = this.getActiveHandBB();
            let startTotal = 0, endTotal = 0, anyStart = false;
            let players = [];

            let seatNums = Array.from(this.seats.keys()).sort((a, b) => a - b);
            for (let sn of seatNums) {
                let s = this.seats.get(sn);
                if (!this.dealtSeats.has(sn)) continue;
                anyStart = true;
                
                let wonAmount = this.winners.filter(w => w.seat === sn).reduce((acc, w) => acc + w.amount, 0);
                let contributed = this.totalChipsContributed.get(sn) || 0;
                let startStack = (this.handStart[sn] !== undefined && this.handStart[sn] !== null) ? this.handStart[sn] : 0;
                let endStack = Math.max(0, s.stack || 0);

                if (wonAmount > 0 && endStack === 0) {
                    endStack = Math.max(0, wonAmount - contributed + startStack);
                    s.stack = endStack;
                }

                if (startStack === 0 && (endStack > 0 || contributed > 0 || wonAmount > 0)) {
                    startStack = Math.max(0, endStack + contributed - wonAmount);
                }

                startTotal += startStack;
                endTotal += endStack;

                let sd = this.showdownCards[sn];
                players.push({
                    seat: sn,
                    nick: s.rawNick,
                    cleanNick: s.cleanNick,
                    position: this.positions[sn] || 'N/A',
                    stack_start: startStack,
                    stack_start_bb: handBB > 0 ? Math.round(startStack / handBB * 100) / 100 : null,
                    stack_end: endStack,
                    stack_end_bb: handBB > 0 ? Math.round(endStack / handBB * 100) / 100 : null,
                    cards: sd ? sd.cards : ((this.holeCardsNow && this.holeCardsNow[sn]) || 'xx xx'),
                    is_muck_leak: sd ? (sd.isMuck ? 1 : 0) : 0,
                    busted: endStack === 0 ? 1 : 0,
                    actions: this.handActions.get(sn) || []
                });
            }

            if (!anyStart) return null;
            let partial = this.handOrigin === 'midhand-sync' || startTotal === 0;
            let conserved = partial ? null : (startTotal === endTotal);
            let potTotal = this.winnerSum > 0 ? this.winnerSum : this.potSwept;

            let handObj = {
                hand_number: this.hand,
                tracking: partial ? 'partial' : 'full',
                table_id: this.tableId,
                table_name: this.name,
                tournament_id: this.tournId,
                tournament_name: this.tournId && stalkerState.liveTournaments.has(this.tournId) ? stalkerState.liveTournaments.get(this.tournId).name : 'MTT',
                timestamp: new Date().toISOString(),
                level: this.handLevel,
                dealer_seat: this.dealer,
                board: this.board.join(' '),
                pot_total: potTotal,
                pot_bb: handBB > 0 ? Math.round(potTotal / handBB * 100) / 100 : null,
                winners: this.winners,
                players: players,
                sync_verified: partial ? null : conserved,
                chip_conservation: { start_total: startTotal, end_total: endTotal, ok: conserved }
            };

            this.seats.forEach(s => { s.streetBet = 0; });
            this.holeCardsNow = null;
            return handObj;
        }
    }

    // ── ОЧЕРЕДЬ И СИНХРОНИЗАЦИЯ ───────────────────────────────────────
    function queueServerEvent(type, payload) {
        let eventObj = { type: type, payload: payload, timestamp: Date.now() };
        stalkerState.outboxQueue.push(eventObj);
        if (stalkerState.outboxQueue.length > MAX_OUTBOX_QUEUE) {
            stalkerState.outboxQueue.shift();
        }
        processOutboxQueue();
    }

    let isFlushingQueue = false;
    async function processOutboxQueue() {
        if (isFlushingQueue || stalkerState.outboxQueue.length === 0) return;
        isFlushingQueue = true;

        while (stalkerState.outboxQueue.length > 0) {
            let item = stalkerState.outboxQueue[0];
            try {
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 2000);

                let res = await fetch(`${scoutServerUrl}/scout_api/event`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: item.type, payload: item.payload }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    stalkerState.outboxQueue.shift();
                    stalkerState.hfStatus = 'Онлайн';
                } else {
                    stalkerState.hfStatus = `HTTP ${res.status}`;
                    break;
                }
            } catch (e) {
                stalkerState.hfStatus = 'Офлайн / Буфер';
                break;
            }
        }

        isFlushingQueue = false;
        updateHfIndicator();
    }

    async function sendHudBatch() {
        let profiles = [];
        stalkerState.stalkedPlayers.forEach(p => {
            if (p.handsCount > 0) {
                let vpip = (p.vpipCount / p.handsCount) * 100;
                let pfr = (p.pfrCount / p.handsCount) * 100;
                let afq = p.totalActions > 0 ? (p.aggressiveActions / p.totalActions) * 100 : 0;
                let fold_bb_steal = p.stealFacedBB > 0 ? (p.foldBBCount / p.stealFacedBB) * 100 : 60.0;
                let fold_sb_steal = p.stealFacedSB > 0 ? (p.foldSBCount / p.stealFacedSB) * 100 : 75.0;

                profiles.push({
                    uuid: `target_${p.cleanNick}`,
                    name: p.cleanNick,
                    hands: p.handsCount,
                    vpip: parseFloat(vpip.toFixed(1)),
                    pfr: parseFloat(pfr.toFixed(1)),
                    afq: parseFloat(afq.toFixed(1)),
                    fold_bb_steal: parseFloat(fold_bb_steal.toFixed(1)),
                    fold_sb_steal: parseFloat(fold_sb_steal.toFixed(1))
                });
            }
        });

        if (profiles.length > 0) {
            try {
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 2500);

                let res = await fetch(`${scoutServerUrl}/scout_api/hud_batch`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ profiles: profiles }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) stalkerState.hfStatus = 'Онлайн';
            } catch(e) {
                stalkerState.hfStatus = 'Офлайн / Буфер';
            }
            updateHfIndicator();
        }
    }

    function updateHfIndicator() {
        let el = document.getElementById('st-hf-status');
        if (!el) return;
        let queueLen = stalkerState.outboxQueue.length;
        let queueStr = queueLen > 0 ? ` (Буфер: ${queueLen})` : '';

        if (stalkerState.hfStatus === 'Онлайн') {
            el.innerHTML = `<span style="color:#4ade80;">HF: ● Онлайн${queueStr}</span>`;
        } else {
            el.innerHTML = `<span style="color:#f87171;">HF: ○ ${stalkerState.hfStatus}${queueStr}</span>`;
        }
    }

    // ── ГРАФИЧЕСКИЙ ИНТЕРФЕЙС HUD ─────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud-v29';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:440px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #06b6d4;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="st-dot" style="color:#06b6d4;font-size:12px;">🎯</span>
                <strong style="color:#06b6d4;font-size:12px;" id="st-hud-title">ULTIMATE SCALPEL v29.0 SWISS</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-force-scan" style="background:#0891b2;border:none;color:#fff;cursor:pointer;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#06b6d4;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v29').remove();window.__pokerStalkerV29Swiss=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
            </div>
        </div>

        <div id="st-hud-body" style="margin-top:8px;">
            <div style="background:#030712;padding:6px 8px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;">
                    <span>Спектатор столов: <b id="st-spectator-count" style="color:#38bdf8;">0 в фоне</b></span>
                    <span id="st-hands-count" style="color:#22c55e;">Раздач: <b>0</b></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;margin-top:4px;">
                    <span>Живых MTT: <b id="st-tourns-count" style="color:#38bdf8;">0</b></span>
                    <span>Найдено целей: <b id="st-targets-found" style="color:#4ade80;">0</b></span>
                </div>
            </div>

            <div id="st-targets-list" style="max-height:260px;overflow-y:auto;background:#030712;padding:6px;border-radius:6px;border:1px solid #1e293b;margin-bottom:8px;color:#cbd5e1;">
                Ожидание данных лобби...
            </div>

            <button id="btn-export-db" style="width:100%;padding:8px;background:linear-gradient(90deg,#0891b2,#16a34a);color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:11px;cursor:pointer;box-shadow:0 4px 12px rgba(8,145,178,0.4);">
                📥 Экспорт досье + 100% ВЕРИФИЦИРОВАННЫХ РАЗДАЧ в JSON
            </button>
        </div>
    `;
    document.body.appendChild(ui);

    document.getElementById('btn-toggle-hud').onclick = function() {
        stalkerState.isCollapsed = !stalkerState.isCollapsed;
        let body = document.getElementById('st-hud-body');
        let btn = document.getElementById('btn-toggle-hud');
        if (stalkerState.isCollapsed) {
            body.style.display = 'none';
            btn.innerText = '▴';
        } else {
            body.style.display = 'block';
            btn.innerText = '▾';
        }
    };

    document.getElementById('btn-force-scan').onclick = function() {
        autoDetectSessionId();
        stalkerState.liveTournaments.forEach((t, tId) => {
            if (!stalkerState.scannerQueue.includes(tId)) {
                stalkerState.scannerQueue.push(tId);
            }
        });
        triggerLobbyTournamentRefresh();
        processScannerQueue();
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
                    let vpip = p.handsCount > 0 ? Math.round((p.vpipCount / p.handsCount) * 100) : 0;
                    let pfr = p.handsCount > 0 ? Math.round((p.pfrCount / p.handsCount) * 100) : 0;
                    let afq = p.totalActions > 0 ? Math.round((p.aggressiveActions / p.totalActions) * 100) : 0;
                    
                    let vpipStr = p.handsCount > 0 
                        ? `<small style="color:#38bdf8;font-weight:bold;margin-left:4px;">[H:${p.handsCount} V:${vpip}% P:${pfr}% AF:${afq}%]</small>` 
                        : `<small style="color:#64748b;margin-left:4px;">[Поиск рук...]</small>`;

                    html += `<div style="border-bottom:1px solid #1e293b;padding:4px 0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:#fde047;">🎯 <b>${p.cleanNick}</b> ${vpipStr}</span>
                        </div>`;

                    p.entries.forEach(e => {
                        let chipsStr = formatChips(e.stack);
                        let isTournLive = !e.tournId || stalkerState.liveTournaments.has(e.tournId);
                        let isActuallyBusted = e.isBusted || e.stack === 0 || !isTournLive;

                        let bbStr = (e.stackBB > 0 && !isActuallyBusted) ? ` (${e.stackBB.toFixed(1)} BB)` : '';
                        if (isActuallyBusted) {
                            let prizeStr = e.prize > 0 ? ` +${formatChips(e.prize)}₽` : '';
                            let placeStr = e.place > 0 ? `${e.place} место ` : '';
                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#ef4444;padding-left:8px;opacity:0.6;">
                                <span><s>${e.rawNick}</s> <small style="color:#64748b;">${e.tableName || ''}</small></span>
                                <span><s>${placeStr}${prizeStr} [ВЫБЫЛ]</s></span>
                            </div>`;
                        } else {
                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;padding-left:8px;color:#38bdf8;">
                                <span>🔹 <b>${e.rawNick}</b> <small style="color:#94a3b8;">${e.tableName || ''}</small></span>
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

    // ── АДАПТИВНЫЙ СПЕКТАТОР СТОЛОВ (БЕЗ МИГАНИЯ И ПЕРЕОТКРЫТИЙ) ───────
    async function manageBackgroundSpectatorPool() {
        let sid = stalkerState.auth.sessionId || autoDetectSessionId();
        let wsUrl = stalkerState.auth.wssUrl;
        if (!sid || !wsUrl) return;

        let now = Date.now();
        for (let [tableId, ws] of stalkerState.backgroundTableSockets.entries()) {
            if (now - (ws.__createdAt || 0) < 15000) continue;

            let tableCtx = stalkerState.activeTables.get(tableId);
            let hasActiveTarget = false;
            if (tableCtx && tableCtx.seats.size > 0) {
                tableCtx.seats.forEach(s => {
                    if (TARGET_WATCHLIST.has(s.cleanNick) && (s.stack || 0) > 0) hasActiveTarget = true;
                });
            }

            if (!hasActiveTarget && ws.readyState === WebSocket.OPEN) {
                try { ws.close(); } catch(e) {}
                stalkerState.backgroundTableSockets.delete(tableId);
                stalkerState.activeTables.delete(tableId);
                stalkerState.discoveredTargetTables.delete(tableId); // 🔥 ФИКС: Удаляем мертвый стол из очереди навсегда
                logDebug("SOCKET_CLEANUP", `Стол ${tableId} закрыт и удален из очереди (нет активных целей)`);
            }
        }

        for (let [tableId, tInfo] of stalkerState.discoveredTargetTables.entries()) {
            if (stalkerState.backgroundTableSockets.size >= MAX_BACKGROUND_TABLES) break;
            if (stalkerState.backgroundTableSockets.has(tableId)) continue;
            if (tInfo.tournId === stalkerState.userViewingTournId) continue;

            let tableWs = new OrigWS(wsUrl);
            tableWs.__createdAt = Date.now();
            stalkerState.backgroundTableSockets.set(tableId, tableWs);

            tableWs.__tableId = tableId;
            tableWs.__tableContext = new TableContext(tableId, tInfo.tournId);
            stalkerState.activeTables.set(tableId, tableWs.__tableContext);

            logDebug("SOCKET_CONNECT", `Подключение к столу ${tableId} (турнир ${tInfo.tournId}, цель ${tInfo.targetNick})`);

            tableWs.onopen = function() {
                tableWs.send(`<EnterTable sessionId="${sid}" tableId="${tableId}" tournamentId="${tInfo.tournId}" client="html5mobile" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                tableWs.send('<GetTableDetails/>');
                tableWs.send('<JoinTable/>');
            };

            tableWs.onmessage = async function(e) {
                let text = await decodeSocketPayload(e.data);
                parseXmlStream(text, tableWs, 'IN');
            };

            tableWs.onclose = function() {
                stalkerState.backgroundTableSockets.delete(tableId);
                stalkerState.activeTables.delete(tableId);
                updateHUD();
            };

            tableWs.onerror = function() {
                try { tableWs.close(); } catch(err) {}
            };
        }
        updateHUD();
    }
    setInterval(manageBackgroundSpectatorPool, 3000);

    // ── ФОНОВЫЙ КРАУЛЕР ТУРНИРОВ ─────────────────────────────────────
    function triggerLobbyTournamentRefresh() {
        let lobbyWs = stalkerState.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>');
            } catch(e) {}
        }
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function processScannerQueue() {
        if (stalkerState.isScanningActive || stalkerState.scannerQueue.length === 0) return;
        autoDetectSessionId();
        if (!stalkerState.auth.sessionId || !stalkerState.auth.wssUrl) return;

        stalkerState.isScanningActive = true;

        while (stalkerState.scannerQueue.length > 0) {
            let tId = stalkerState.scannerQueue.shift();
            if (tId === stalkerState.userViewingTournId) continue;

            await scanSingleTournamentBackground(tId);
            await sleep(200);
        }

        stalkerState.isScanningActive = false;
        updateHUD();
    }

    function scanSingleTournamentBackground(tournId) {
        return new Promise((resolve) => {
            let tourn = stalkerState.liveTournaments.get(tournId);
            let wsUrl = stalkerState.auth.wssUrl;
            let sid = stalkerState.auth.sessionId || autoDetectSessionId();
            if (!tourn || !wsUrl || !sid) return resolve();

            let bgWs = new OrigWS(wsUrl);
            let finished = false;
            let currentLevel = 1;
            let levelMap = new Map();
            let scheduleLoaded = false;
            let cachedPlayersXml = [];

            function cleanup() {
                if (!finished) {
                    finished = true;
                    try { bgWs.close(); } catch(e) {}
                    resolve();
                }
            }

            setTimeout(cleanup, 12000);

            bgWs.onopen = function() {
                bgWs.send(`<EnterTournamentLobby id="${tournId}" sessionId="${sid}" client="html5mobile" clientFace="pokerdom" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                bgWs.send('<GetSchedule/>');
            };

            function processPlayerBlocks(text) {
                let currentBB = tourn.currentBB || 500;
                if (levelMap.has(currentLevel)) {
                    currentBB = levelMap.get(currentLevel);
                    tourn.currentBB = currentBB;
                }

                let offset = iattr(text, 'offset') || 0;
                let total = iattr(text, 'total') || 0;
                let playerBlocks = text.matchAll(/<Player\s+([^>]+)>/g);
                let countInChunk = 0;

                for (let pb of playerBlocks) {
                    countInChunk++;
                    let attrs = pb[1];
                    let rawNick = attr(attrs, 'nickname');
                    let cleanNick = getCleanNick(rawNick);
                    let tableId = attr(attrs, 'tableId');

                    if (TARGET_WATCHLIST.has(cleanNick)) {
                        let stack = iattr(attrs, 'stack') || 0;
                        let rank = iattr(attrs, 'rank') || 0;
                        let place = iattr(attrs, 'placeFrom') || iattr(attrs, 'place') || iattr(attrs, 'placeTo') || 0;
                        let prize = parseFloat(attr(attrs, 'prizeAmount') || '0');
                        let uuid = attr(attrs, 'uuid') || `target_${cleanNick}`;
                        
                        let isBusted = (place > 0) || (stack === 0);
                        let stackBB = (currentBB > 0 && stack > 0) ? (stack / currentBB) : 0;

                        if (tableId && stack > 0 && !isBusted) {
                            stalkerState.discoveredTargetTables.set(tableId, {
                                tournId: tournId,
                                targetNick: cleanNick,
                                stack: stack
                            });
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
                            rank: rank,
                            place: place,
                            prize: prize,
                            isBusted: isBusted,
                            tableName: tourn.name,
                            tournId: tournId
                        });

                        if (isNewEntry || statusChanged) {
                            queueServerEvent(isBusted ? "TARGET_PLAYER_BUSTED" : "TARGET_PLAYER_DISCOVERED", {
                                uuid: uuid,
                                name: cleanNick,
                                raw_nick: rawNick,
                                tournament_id: tournId,
                                tournament_name: tourn.name,
                                chips: stack,
                                stack_bb: Math.round(stackBB * 100) / 100,
                                place: place,
                                prize: prize,
                                is_busted: isBusted
                            });
                        }

                        updateHUD();
                    }
                }

                if (total > (offset + countInChunk) && countInChunk > 0) {
                    try {
                        bgWs.send(`<GetPlayers offset="${offset + countInChunk}" count="50"/>`);
                    } catch(e) { cleanup(); }
                } else {
                    cleanup();
                }
            }

            bgWs.onmessage = async function(e) {
                let text = await decodeSocketPayload(e.data);
                if (!text) return;

                if (text.includes('<TournamentDetails') || text.includes('<Schedule')) {
                    let lvl = iattr(text, 'currentLevel');
                    if (lvl) currentLevel = lvl;
                }

                if (text.includes('<Schedule')) {
                    let items = text.matchAll(/<Item\s+([^>]+)>/g);
                    for (let im of items) {
                        let num = iattr(im[1], 'number') || 0;
                        let hs = iattr(im[1], 'highStake') || 0;
                        if (num > 0 && hs > 0) levelMap.set(num, hs);
                    }
                    if (levelMap.has(currentLevel)) {
                        tourn.currentBB = levelMap.get(currentLevel);
                    }
                    scheduleLoaded = true;
                    bgWs.send('<GetPlayers offset="0" count="50"/>');

                    while (cachedPlayersXml.length > 0) {
                        processPlayerBlocks(cachedPlayersXml.shift());
                    }
                }

                if (text.includes('<Players')) {
                    if (scheduleLoaded) {
                        processPlayerBlocks(text);
                    } else {
                        cachedPlayersXml.push(text);
                    }
                }
            };

            bgWs.onerror = cleanup;
            bgWs.onclose = cleanup;
        });
    }

    // ── ГЛАВНЫЙ ПАРСЕР XML-ПОТОКА ─────────────────────────────────────
    function parseXmlStream(xml, ws, dir = 'IN') {
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        try {
            let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
            if (sessMatch) {
                let wasEmpty = !stalkerState.auth.sessionId;
                stalkerState.auth.sessionId = sessMatch[1];
                if (wasEmpty && stalkerState.sockets.lobby) {
                    triggerLobbyTournamentRefresh();
                }
            }

            let versMatch = xml.match(/\bclientVersion="([^"]+)"/);
            if (versMatch) stalkerState.auth.clientVersion = versMatch[1];

            if (dir === 'OUT') {
                if (xml.includes('<EnterTournamentLobby')) {
                    stalkerState.userViewingTournId = attr(xml, 'id');
                } else if (xml.includes('<EnterTable')) {
                    let tableId = attr(xml, 'tableId');
                    let tournId = attr(xml, 'tournamentId');
                    if (tableId) {
                        ws.__tableId = tableId;
                        ws.__tableContext = new TableContext(tableId, tournId);
                        stalkerState.activeTables.set(tableId, ws.__tableContext);
                        stalkerState.sockets.tables.set(tableId, ws);
                    }
                }
                return;
            }

            // 1. Лобби
            if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
                ws.__socketType = 'LOBBY';
                let firstTime = !stalkerState.sockets.lobby;
                stalkerState.sockets.lobby = ws;
                autoDetectSessionId();
                if (firstTime && stalkerState.auth.sessionId) {
                    triggerLobbyTournamentRefresh();
                }
            }

            // 2. Сетка турниров
            if (xml.includes('<Tournaments')) {
                let matches = xml.matchAll(/<Table\s+([^>]+)>/g);

                for (let m of matches) {
                    let attrs = m[1];
                    let tId = attr(attrs, 'id');
                    let tName = attr(attrs, 'name') || '';
                    let tStatus = attr(attrs, 'status');
                    let tGame = attr(attrs, 'game') || '';

                    let isHoldem = tGame.includes('TEXAS_HOLDEM') || tGame.includes('HOLDEM') || (!tGame.includes('OMAHA') && !tGame.includes('PINEAPPLE') && !tName.toLowerCase().includes('омаха') && !tName.toLowerCase().includes('ананас'));

                    let isLiveRunning = LIVE_STATUSES.has(tStatus);

                    if (isHoldem && tId && isLiveRunning) {
                        if (!stalkerState.liveTournaments.has(tId)) {
                            stalkerState.liveTournaments.set(tId, {
                                id: tId,
                                name: decodeHtml(tName) || 'MTT',
                                status: tStatus,
                                currentBB: 500
                            });
                        } else {
                            let item = stalkerState.liveTournaments.get(tId);
                            item.status = tStatus;
                            if (tName) item.name = decodeHtml(tName);
                        }

                        if (!stalkerState.scannerQueue.includes(tId)) {
                            stalkerState.scannerQueue.push(tId);
                        }
                    } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED' || tStatus === 'CANCELED_NOT_PAID' || tStatus === 'ANNOUNCED' || tStatus === 'REGISTERING' || !isHoldem)) {
                        stalkerState.stalkedPlayers.forEach(p => {
                            p.entries.forEach(entry => {
                                if (entry.tournId === tId && !entry.isBusted) {
                                    entry.isBusted = true;
                                    entry.stack = 0;
                                    entry.stackBB = 0;
                                    if (!entry.place || entry.place === 0) entry.place = 2;
                                }
                            });
                        });

                        stalkerState.liveTournaments.delete(tId);
                        let qIdx = stalkerState.scannerQueue.indexOf(tId);
                        if (qIdx !== -1) stalkerState.scannerQueue.splice(qIdx, 1);
                    }
                }

                processScannerQueue();
                updateHUD();
            }

            // 3. Контекст стола
            if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
                let tableId = attr(xml, 'id') || attr(xml, 'tableId');
                let tournId = attr(xml, 'tournamentId');
                if (tableId) {
                    ws.__tableId = tableId;
                    if (!ws.__tableContext) {
                        ws.__tableContext = new TableContext(tableId, tournId);
                    }
                    stalkerState.activeTables.set(tableId, ws.__tableContext);
                }
            }

            let ctx = ws.__tableContext;
            if (!ctx) return;

            // Синхронизация уровня блайндов
            let bbAttr = iattr(xml, 'highStake');
            let sbAttr = iattr(xml, 'lowStake');
            let anteAttr = iattr(xml, 'ante');
            let numAttr = iattr(xml, 'number');
            if (bbAttr !== null && bbAttr > 0) {
                ctx.level.bb = bbAttr;
                ctx.level.sb = sbAttr !== null ? sbAttr : Math.round(bbAttr / 2);
                ctx.level.ante = anteAttr !== null ? anteAttr : 0;
                if (numAttr !== null) ctx.level.number = numAttr;
                if (!ctx.handLevel || !ctx.handLevel.bb) {
                    ctx.handLevel = { sb: ctx.level.sb, bb: ctx.level.bb, ante: ctx.level.ante, number: ctx.level.number };
                }
            }

            // Синхронизация мест
            if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
                let seatBlocks = xml.matchAll(/<Seat\s+([^>]*\bid="(\d+)"[^>]*)>(.*?)<\/Seat>/gs);
                for (let sb of seatBlocks) {
                    let seatAttrs = sb[1];
                    let seatNum = parseInt(sb[2], 10);
                    let seatContent = sb[3];

                    let rawNick = attr(seatContent, 'nickname');
                    let uuid = attr(seatContent, 'uuid');
                    let stackM = seatContent.match(/stack-size="([^"]+)"/);
                    let stack = stackM ? parseInt(stackM[1], 10) : 0;
                    let betM = seatContent.match(/bet="([^"]+)"/);
                    let bet = betM ? parseInt(betM[1], 10) : 0;

                    let isSittingOut = seatAttrs.includes('sittingOut="true"') || seatContent.includes('sittingOut="true"');
                    if (isSittingOut) {
                        ctx.sittingOutSeats.add(seatNum);
                    } else {
                        ctx.sittingOutSeats.delete(seatNum);
                    }

                    let s = ctx.ensureSeat(seatNum, rawNick, stack);
                    s.uuid = uuid || `u_${s.cleanNick}`;
                    s.stack = stack;
                    s.streetBet = bet;
                    s.busted = (stack === 0);
                    s.vacated = false;
                    s.inHand = seatAttrs.includes('activeInHand="true"') || bet > 0;

                    if ((ctx.handStart[seatNum] === 0 || ctx.handStart[seatNum] === undefined) && stack > 0) {
                        ctx.handStart[seatNum] = stack + bet;
                    }

                    if (rawNick && TARGET_WATCHLIST.has(s.cleanNick)) {
                        let p = getOrCreatePlayerProfile(s.cleanNick);
                        let tournId = ctx.tournId;
                        
                        let matchingKey = null;
                        if (tournId) {
                            for (let [k, e] of p.entries.entries()) {
                                if (e.tournId === tournId && !e.isBusted && e.stack > 0) {
                                    matchingKey = k;
                                    break;
                                }
                            }
                        }
                        
                        let entryKey = matchingKey || `${tournId || ctx.tableId}_${rawNick}`;
                        let entry = p.entries.get(entryKey) || {
                            rawNick: rawNick,
                            cleanNick: s.cleanNick,
                            tableName: tournId && stalkerState.liveTournaments.has(tournId) ? stalkerState.liveTournaments.get(tournId).name : 'Table'
                        };
                        
                        if (!entry.isBusted || entry.place === 0) {
                            entry.stack = stack;
                            entry.stackBB = ctx.getLiveStackBB(stack) || 0;
                            entry.tournId = tournId;
                            entry.isBusted = (stack === 0);
                            p.entries.set(entryKey, entry);
                            updateHUD();
                        }
                    }
                }
            }

            // Жизненный цикл раздачи
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
                            if (/activeInHand="true"/.test(mm[1]) && mm[3] && /<PlayerInfo/.test(mm[3])) {
                                let sn = parseInt(mm[2], 10);
                                let sM = mm[3].match(/stack-size="([^"]+)"/);
                                let st = sM ? parseInt(sM[1], 10) : 0;
                                let rNick = attr(mm[3], 'nickname');
                                ctx.ensureSeat(sn, rNick, st);
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

                let koM = xml.match(/<Knockout\s+[^>]*busted="(\d+)"/);
                if (koM) {
                    let bSeat = parseInt(koM[1], 10);
                    let bs = ctx.seats.get(bSeat);
                    if (bs) bs.busted = true;
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

                    if (['PostAnte', 'PostSmallBlind', 'PostBigBlind', 'Bet', 'Raise', 'Call', 'AllIn', 'UncalledBet'].includes(kind)) {
                        ctx.applyChipAction(seatNum, kind, amount);
                        ctx.recordAction(seatNum,
                            kind === 'PostAnte' ? 'ANTE' :
                            kind === 'PostSmallBlind' ? 'SB' :
                            kind === 'PostBigBlind' ? 'BB' : kind.toUpperCase(),
                            amount);
                    } else if (kind === 'Fold') {
                        ctx.activeSeats.delete(seatNum);
                        s.inHand = false;
                        ctx.recordAction(seatNum, 'FOLD', 0);
                    } else if (kind === 'Check') {
                        ctx.recordAction(seatNum, 'CHECK', 0);
                    } else if (kind === 'Show') {
                        let cards = Array.from(body.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                        let comb = attr(aStr, 'combination') || '';
                        if (cards.length >= 2) {
                            ctx.showdownCards[seatNum] = { cards: cards.slice(0, 2).join(' '), isMuck: false, combination: decodeHtml(comb) };
                        }
                    } else if (kind === 'Muck') {
                        let mc = Array.from(body.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                        ctx.showdownCards[seatNum] = ctx.showdownCards[seatNum] ||
                            { cards: mc.length >= 2 ? mc.slice(0, 2).join(' ') : null, isMuck: true, combination: '' };
                        if (ctx.showdownCards[seatNum] && !ctx.showdownCards[seatNum].isMuck) ctx.showdownCards[seatNum].isMuck = true;
                    }

                    if (TARGET_WATCHLIST.has(s.cleanNick) && !ctx.sittingOutSeats.has(seatNum)) {
                        let p = getOrCreatePlayerProfile(s.cleanNick);
                        let isPreflop = (ctx.street === 'PREFLOP');
                        let playerPos = ctx.positions[seatNum] || '';

                        if (['Call', 'AllIn'].includes(kind)) {
                            p.totalActions++;
                            if (isPreflop && !ctx.playersActedThisHand.has(`${s.cleanNick}_VPIP`)) {
                                p.vpipCount++;
                                ctx.playersActedThisHand.add(`${s.cleanNick}_VPIP`);
                            }
                        } else if (['Raise', 'Bet'].includes(kind)) {
                            p.totalActions++;
                            p.aggressiveActions++;
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
                                if (playerPos === 'BB') {
                                    p.stealFacedBB++;
                                    p.foldBBCount++;
                                } else if (playerPos.includes('SB')) {
                                    p.stealFacedSB++;
                                    p.foldSBCount++;
                                }
                            }
                        } else if (kind === 'Check') {
                            p.totalActions++;
                        }
                    }
                }

                let pcM, pcRe = /<PotsChange>([\s\S]*?)<\/PotsChange>/g;
                while ((pcM = pcRe.exec(xml)) !== null) {
                    let potM, potEntryRe = /<Pot\s+([^>]*)\/>/g;
                    while ((potM = potEntryRe.exec(pcM[1])) !== null) {
                        let pSeat = iattr(potM[1], 'seat'), pChange = iattr(potM[1], 'change');
                        if (pChange === null || pChange <= 0) continue;
                        ctx.potSwept += pChange;
                        let ps = ctx.seats.get(pSeat);
                        if (ps && ps.streetBet === pChange) ps.streetBet = 0;
                    }
                }

                ctx.updateBoardFromXml(xml);

                if (xml.includes('<Winner')) {
                    let wMatches = xml.matchAll(/<Winner\s+([^>]*?)>(.*?)<\/Winner>|<Winner\s+([^>]*?)\/>/gs);
                    for (let wm of wMatches) {
                        let wAttr = wm[1] || wm[3] || '';
                        let wInner = wm[2] || '';
                        let wSeat = iattr(wAttr, 'seat');
                        let wAmt = iattr(wAttr, 'amount') || 0;
                        let wComb = decodeHtml(attr(wAttr, 'combination') || '');
                        let wCards = Array.from(wInner.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]).slice(0, 5).join(' ');

                        let alreadyAdded = ctx.winners.some(w => w.seat === wSeat && w.amount === wAmt);
                        if (!alreadyAdded && wSeat !== null && wAmt > 0) {
                            let ws2 = ctx.ensureSeat(wSeat, null);
                            ws2.stack = (ws2.stack || 0) + wAmt;
                            ctx.winnerSum += wAmt;
                            ctx.winners.push({ seat: wSeat, amount: wAmt, combination: wComb, cards: wCards });
                        }
                    }
                }

                if (xml.includes('<Show') || xml.includes('<Muck>')) {
                    let showMatches = xml.matchAll(/<PlayerAction\s+[^>]*seat="(\d+)"[^>]*><(?:Show|Muck)[^>]*><Cards>(.*?)<\/Cards>/g);
                    for (let sm of showMatches) {
                        let seatNum = parseInt(sm[1], 10);
                        if (ctx.recordedShowdownSeats.has(seatNum)) continue;
                        ctx.recordedShowdownSeats.add(seatNum);

                        let cardsParsed = Array.from(sm[2].matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]);
                        if (cardsParsed.length === 2) {
                            let cards = cardsParsed.join(' ');
                            let s = ctx.seats.get(seatNum);
                            if (s) {
                                let isMuckLeak = sm[0].includes('<Muck');
                                let isTarget = TARGET_WATCHLIST.has(s.cleanNick);
                                let leakType = isTarget ? (isMuckLeak ? "TARGET_MUCK_LEAK" : "TARGET_SHOWDOWN") : (isMuckLeak ? "OPPONENT_MUCK_LEAK" : "OPPONENT_SHOWDOWN");
                                let handBB = ctx.getActiveHandBB();

                                queueServerEvent("HAND_SHOWDOWN_COMPLETED", {
                                    hand_number: ctx.hand || `h_${Date.now()}`,
                                    tournament_id: ctx.tournId || "MTT",
                                    tournament_name: ctx.tournId && stalkerState.liveTournaments.has(ctx.tournId) ? stalkerState.liveTournaments.get(ctx.tournId).name : 'MTT',
                                    uuid: s.uuid,
                                    name: s.cleanNick,
                                    is_target_player: isTarget,
                                    leak_type: leakType,
                                    position: ctx.positions[seatNum] || 'N/A',
                                    stack_start: ctx.handStart[seatNum] || s.stack,
                                    stack_bb: handBB > 0 ? Math.round((ctx.handStart[seatNum] || s.stack || 0) / handBB * 100) / 100 : null,
                                    sb_level: ctx.handLevel ? ctx.handLevel.sb : ctx.level.sb,
                                    bb_level: handBB,
                                    pot_total: ctx.displayPot(),
                                    players_on_flop: ctx.playersOnFlop,
                                    players_on_river: ctx.playersOnRiver,
                                    cards: cards,
                                    board: ctx.board.join(' '),
                                    actions: ctx.handActions.get(seatNum) || [],
                                    is_muck_leak: isMuckLeak ? 1 : 0
                                });
                            }
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
                }
            }
        } catch(e) {
            console.error("XML Stream Error:", e);
        }
    }

    setInterval(triggerLobbyTournamentRefresh, 30000);
    setInterval(sendHudBatch, 5000);
    setInterval(processOutboxQueue, 3000);

    // ── ЭКСПОРТ ДАННЫХ В JSON ─────────────────────────────────────────
    document.getElementById('btn-export-db').onclick = async function() {
        try {
            let exportData = {
                timestamp: new Date().toISOString(),
                discipline: "TEXAS_HOLDEM_ONLY",
                targetsCount: stalkerState.stalkedPlayers.size,
                liveTournamentsCount: stalkerState.liveTournaments.size,
                outboxQueueLength: stalkerState.outboxQueue.length,
                recorded_hands_count: stalkerState.completedHandsArchive.length,
                debug_engine_log: stalkerState.engineDebugLog,
                recorded_hands: stalkerState.completedHandsArchive,
                players: {}
            };

            stalkerState.stalkedPlayers.forEach((p, cleanNick) => {
                let vpip = p.handsCount > 0 ? parseFloat(((p.vpipCount / p.handsCount) * 100).toFixed(1)) : 0;
                let pfr = p.handsCount > 0 ? parseFloat(((p.pfrCount / p.handsCount) * 100).toFixed(1)) : 0;
                let afq = p.totalActions > 0 ? parseFloat(((p.aggressiveActions / p.totalActions) * 100).toFixed(1)) : 0;

                exportData.players[cleanNick] = {
                    cleanNick: p.cleanNick,
                    handsCount: p.handsCount,
                    vpip: vpip,
                    pfr: pfr,
                    afq: afq,
                    entries: Array.from(p.entries.values())
                };
            });

            try {
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 1500);

                let res = await fetch(`${scoutServerUrl}/scout_api/export`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (res.ok) {
                    exportData.serverBackup = await res.json();
                }
            } catch(e) {}

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pokerdom_swiss_v29_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ПЕРЕХВАТЧИК СОКЕТОВ (ПРОКСИ-АРХИТЕКТУРА) ──────────────────────
    async function decodeSocketPayload(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            let buffer;
            if (data instanceof ArrayBuffer) {
                buffer = data;
            } else if (data instanceof Blob) {
                buffer = await data.arrayBuffer();
            } else if (ArrayBuffer.isView(data)) {
                buffer = data.buffer;
            } else {
                return String(data);
            }

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
        if (!ws || ws.__stalkerHookedV29) return;
        ws.__stalkerHookedV29 = true;

        let targetUrl = explicitUrl || ws.url || ws._url;
        if (targetUrl && typeof targetUrl === 'string' && (targetUrl.includes('/ws') || targetUrl.startsWith('ws'))) {
            stalkerState.auth.wssUrl = targetUrl;
        }

        ws.addEventListener('message', async function (e) {
            let text = await decodeSocketPayload(e.data);
            parseXmlStream(text, ws, 'IN');
        });

        ws.addEventListener('close', function() {
            if (ws.__tableId) {
                stalkerState.activeTables.delete(ws.__tableId);
                stalkerState.backgroundTableSockets.delete(ws.__tableId);
            }
        });
    }

    var OrigWS = window.WebSocket;
    if (OrigWS && !window.__stalkerWsProxyV29) {
        window.__stalkerWsProxyV29 = true;
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

    console.log("%c🎯 [VIP Scout v29.0 SWISS-DIAGNOSTIC] Запущен. Без фликеринга сокетов + кольцевой лог отладки.", "color:#06b6d4;font-weight:bold;");
})();

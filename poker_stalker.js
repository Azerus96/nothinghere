javascript:(function(){
    if (window.__pokerStalkerV320Master) {
        alert('🎯 VIP Stalker v32.0 PSYCHO & BOUNTY уже запущен!');
        return;
    }
    window.__pokerStalkerV320Master = true;

    /* ══════════════════════════════════════════════════════════════════
       ULTIMATE SCALPEL v32.0 — PSYCHO & BOUNTY EDITION (HOLDEM)
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
    const SYSTEM_CHAT_REGEX = /показывает|сбросил|занял место|покинул стол|банк выиграл|выбыл|тайм-банк/i;

    const stalkerState = {
        isCollapsed: false,
        hfStatus: 'Локальный режим',
        userViewingTournId: null,
        userViewingTableId: null,
        socketCooldowns: new Map(),
        tournamentNamesCache: new Map(),
        outboxQueue: [],
        completedHandsArchive: [],
        recordedHandNumbers: new Set(),
        chatLogs: [], // Архив чата и психологии
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
        let entry = { time: new Date().toLocaleTimeString(), category: category, message: message };
        stalkerState.engineDebugLog.push(entry);
        if (stalkerState.engineDebugLog.length > MAX_DEBUG_LOGS) stalkerState.engineDebugLog.shift();
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
                sitOutHandsCount: 0,
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

    // ── ГИБРИДНЫЙ СЕРВЕРНЫЙ ДВИЖОК СТОЛА ──────────────────────────────
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
            this.sweptInvestedPerSeat = new Map();
            this.handActions = new Map();
            this.timeline = []; 
            this.knockoutBounties = []; // Движок нокаутов
            this.recordedShowdownSeats = new Set();
            this.sittingOutSeats = new Set();
            this.playersActedThisHand = new Set();
            this.playersCountedThisHand = new Set();
            this.processedActionIds = new Set();
            this.handRebuyEvents = [];
            this.seatTimerStart = new Map();
            this.handOrigin = null;
            this.runningPot = 0;
            this.tournamentRules = {
                rebuyChips: 0, rebuyCost: 0,
                addonChips: 0, addonCost: 0, addonCost2x: 0
            };
        }

        getActiveHandBB() {
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

        getTournamentName() {
            if (this.tournId && stalkerState.tournamentNamesCache.has(this.tournId)) {
                return stalkerState.tournamentNamesCache.get(this.tournId);
            }
            if (this.tournId && stalkerState.liveTournaments.has(this.tournId)) {
                return stalkerState.liveTournaments.get(this.tournId).name;
            }
            return 'MTT';
        }

        ensureSeat(seatNum, rawNick, serverStack = null) {
            let clean = rawNick ? getCleanNick(rawNick) : '';
            if (!this.seats.has(seatNum)) {
                this.seats.set(seatNum, {
                    seat: seatNum,
                    rawNick: rawNick || `Seat ${seatNum}`,
                    cleanNick: clean || `seat_${seatNum}`,
                    uuid: clean ? `u_${clean}` : `seat_${seatNum}`,
                    stack: serverStack !== null ? serverStack : 0,
                    streetBet: 0,
                    inHand: false,
                    busted: false,
                    spent: 0,
                    rebuys: 0,
                    addons: 0
                });
            }

            let s = this.seats.get(seatNum);
            if (rawNick && (s.rawNick.startsWith('Seat ') || s.rawNick !== rawNick)) {
                s.rawNick = rawNick;
                s.cleanNick = clean;
                s.uuid = `u_${clean}`;
            }
            if (serverStack !== null) {
                s.stack = serverStack;
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
            this.sweptInvestedPerSeat.clear();
            this.activeSeats.clear();
            this.dealtSeats.clear();
            this.handActions.clear();
            this.timeline = [];
            this.knockoutBounties = [];
            this.recordedShowdownSeats.clear();
            this.playersActedThisHand.clear();
            this.playersCountedThisHand.clear();
            this.processedActionIds.clear();
            this.handRebuyEvents = [];
            this.seatTimerStart.clear();
            this.runningPot = 0;

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

            this.seats.forEach((s, sn) => {
                if (s.stack !== null && s.stack > 0) {
                    this.handStart[sn] = s.stack;
                }
            });

            for (let sn of activeSeatsList) {
                let s = this.ensureSeat(sn, null);
                this.activeSeats.add(sn);
                this.dealtSeats.add(sn);
                s.inHand = true;
                if (!this.handStart[sn] && s.stack > 0) {
                    this.handStart[sn] = s.stack;
                }
                this.sweptInvestedPerSeat.set(sn, 0);
                this.handActions.set(sn, []);
            }

            this.positions = calculatePositions(activeSeatsList, this.dealer);
        }

        recordAction(seatNum, label, amount) {
            let s = this.ensureSeat(seatNum, null);
            let list = this.handActions.get(seatNum) || [];
            let str = `${this.street}_${label}`;
            
            let thinkSec = null;
            let timerStart = this.seatTimerStart.get(seatNum);
            if (timerStart && !['ANTE', 'SB', 'BB', 'UNCALLEDBET'].includes(label)) {
                let diff = ((Date.now() - timerStart) / 1000).toFixed(1);
                if (diff >= 0 && diff < 60) thinkSec = parseFloat(diff);
            }

            let thinkStr = thinkSec !== null ? `[${thinkSec}s]` : '';
            let potBefore = this.runningPot;
            let potPct = (potBefore > 0 && amount > 0) ? Math.round(amount / potBefore * 100) : 0;

            if (amount && amount > 0) {
                str += `:${amount}` + (potPct > 0 && potPct <= 500 ? `(${potPct}%pot)` : '') + thinkStr;
            } else {
                str += thinkStr;
            }
            list.push(str);
            this.handActions.set(seatNum, list);

            this.timeline.push({
                street: this.street,
                seat: seatNum,
                nick: s.rawNick,
                cleanNick: s.cleanNick,
                position: this.positions[seatNum] || 'N/A',
                action: label,
                amount: amount || 0,
                pot_before: potBefore,
                pot_pct: (potPct > 0 && potPct <= 500) ? potPct : null,
                time_sec: thinkSec
            });
        }

        processPotsChange(potsXml) {
            let potEntryRe = /<Pot\s+([^>]*)\/>/g;
            let m;
            while ((m = potEntryRe.exec(potsXml)) !== null) {
                let seatNum = iattr(m[1], 'seat');
                let change = iattr(m[1], 'change');
                if (seatNum !== null && change !== null && change > 0) {
                    this.potSwept += change;
                    this.runningPot += change;
                    let cur = this.sweptInvestedPerSeat.get(seatNum) || 0;
                    this.sweptInvestedPerSeat.set(seatNum, cur + change);
                }
            }
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
                    if (fc.length) {
                        if (sName === 'FLOP') {
                            this.board = fc.slice(0, 3);
                        } else if (this.board.length < maxCount) {
                            if (this.board.length === 3 && sName === 'TURN') this.board.push(fc[0]);
                            else if (this.board.length === 4 && sName === 'RIVER') this.board.push(fc[0]);
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

            let calculatedPotTotal = this.potSwept;

            let seatNums = Array.from(this.seats.keys()).sort((a, b) => a - b);
            for (let sn of seatNums) {
                let s = this.seats.get(sn);
                let wonAmount = this.winners.filter(w => w.seat === sn).reduce((acc, w) => acc + w.amount, 0);
                let investedInPot = this.sweptInvestedPerSeat.get(sn) || 0;

                let isParticipant = this.dealtSeats.has(sn) || investedInPot > 0 || wonAmount > 0;
                if (!isParticipant) continue;
                
                anyStart = true;
                let startStack = (this.handStart[sn] !== undefined && this.handStart[sn] !== null) ? this.handStart[sn] : 0;
                
                if (startStack < investedInPot && wonAmount === 0) {
                    startStack = investedInPot;
                }

                let endStack = startStack - investedInPot + wonAmount;
                if (endStack < 0) endStack = 0;
                s.stack = endStack;

                startTotal += startStack;
                endTotal += endStack;

                if (TARGET_WATCHLIST.has(s.cleanNick) && !this.playersCountedThisHand.has(s.cleanNick)) {
                    let prof = getOrCreatePlayerProfile(s.cleanNick);
                    if (this.sittingOutSeats.has(sn)) {
                        prof.sitOutHandsCount++;
                    } else {
                        prof.handsCount++;
                    }
                    this.playersCountedThisHand.add(s.cleanNick);
                }

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
                    cards: sd ? sd.cards : 'xx xx',
                    is_muck_leak: (sd && sd.isMuck && sd.cards && sd.cards !== 'xx xx') ? 1 : 0,
                    is_sitting_out: this.sittingOutSeats.has(sn) ? 1 : 0,
                    busted: endStack === 0 ? 1 : 0,
                    spent_rub: s.spent || 0,
                    rebuys_count: s.rebuys || 0,
                    addons_count: s.addons || 0,
                    actions: this.handActions.get(sn) || []
                });
            }

            if (!anyStart) return null;
            let partial = this.handOrigin === 'midhand-sync' || startTotal === 0;
            let conserved = partial ? null : (startTotal === endTotal);

            let handObj = {
                hand_number: this.hand,
                tracking: partial ? 'partial' : 'full',
                table_id: this.tableId,
                table_name: this.name,
                tournament_id: this.tournId,
                tournament_name: this.getTournamentName(),
                timestamp: new Date().toISOString(),
                level: this.handLevel,
                dealer_seat: this.dealer,
                board: this.board.join(' '),
                pot_total: calculatedPotTotal,
                pot_bb: handBB > 0 ? Math.round(calculatedPotTotal / handBB * 100) / 100 : null,
                winners: this.winners,
                knockout_bounties: this.knockoutBounties,
                rebuy_events: this.handRebuyEvents,
                timeline: this.timeline,
                players: players,
                sync_verified: partial ? null : conserved,
                chip_conservation: { start_total: startTotal, end_total: endTotal, ok: conserved }
            };

            return handObj;
        }
    }

    // ── ОЧЕРЕДЬ ОТПРАВКИ ──────────────────────────────────────────────
    function queueServerEvent(type, payload) {
        stalkerState.outboxQueue.push({ type: type, payload: payload, timestamp: Date.now() });
        if (stalkerState.outboxQueue.length > MAX_OUTBOX_QUEUE) stalkerState.outboxQueue.shift();
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
    ui.id = 'stalker-hud-v320';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:440px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #06b6d4;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="color:#06b6d4;font-size:12px;">🎯</span>
                <strong style="color:#06b6d4;font-size:12px;">ULTIMATE SCALPEL v32.0 PSYCHO</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button id="btn-force-scan" style="background:#0891b2;border:none;color:#fff;cursor:pointer;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#06b6d4;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="document.getElementById('stalker-hud-v320').remove();window.__pokerStalkerV320Master=false;" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
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
        body.style.display = stalkerState.isCollapsed ? 'none' : 'block';
        this.innerText = stalkerState.isCollapsed ? '▴' : '▾';
    };

    document.getElementById('btn-force-scan').onclick = function() {
        autoDetectSessionId();
        stalkerState.liveTournaments.forEach((t, tId) => {
            if (!stalkerState.scannerQueue.includes(tId)) stalkerState.scannerQueue.push(tId);
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

                        let bbStr = (e.stackBB > 0 && !isActuallyBusted) ? ` (${e.stackBB.toFixed(1)} BB)` : '';
                        let spentInfo = e.spent > 0 ? ` <span style="color:#a855f7;">[${formatChips(e.spent)}₽]</span>` : '';

                        if (isActuallyBusted) {
                            let prizeStr = '';
                            if (e.prize > 0) {
                                if (e.regular_prize > 0 && e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatChips(e.prize)}₽</b> <small style="color:#94a3b8;">(${formatChips(e.regular_prize)}₽ Приз + ${formatChips(e.bounty_prize)}₽ Баунти)</small>`;
                                } else if (e.regular_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatChips(e.regular_prize)}₽</b> <small style="color:#94a3b8;">[Приз]</small>`;
                                } else if (e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatChips(e.bounty_prize)}₽</b> <small style="color:#94a3b8;">[Баунти K.O.]</small>`;
                                }
                            }

                            let placeBadge = '';
                            if (e.place === 1) {
                                placeBadge = `<b style="color:#eab308;background:rgba(234,179,8,0.15);padding:1px 4px;border-radius:3px;">1 МЕСТО 🏆</b>`;
                            } else if (e.place > 0) {
                                placeBadge = `${e.place} место`;
                            }

                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#ef4444;padding-left:8px;opacity:0.85;">
                                <span><s>${e.rawNick}</s> <small style="color:#64748b;">${e.tableName || 'MTT'}</small>${spentInfo}</span>
                                <span>${placeBadge}${prizeStr} ${e.place === 1 ? '' : '[ВЫБЫЛ]'}</span>
                            </div>`;
                        } else {
                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;padding-left:8px;color:#38bdf8;">
                                <span>🔹 <b>${e.rawNick}</b> <small style="color:#94a3b8;">${e.tableName || 'MTT'}</small>${spentInfo}</span>
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

    // ── БЕЗОПАСНЫЙ СПЕКТАТОР СТОЛОВ ───────────────────────────────────
    async function manageBackgroundSpectatorPool() {
        let sid = stalkerState.auth.sessionId || autoDetectSessionId();
        let wsUrl = stalkerState.auth.wssUrl;
        if (!sid || !wsUrl) return;

        let now = Date.now();

        for (let [tableId, ws] of stalkerState.backgroundTableSockets.entries()) {
            let tableCtx = stalkerState.activeTables.get(tableId);
            if (tableCtx && tableCtx.hand !== null) continue;

            let hasActiveTarget = false;
            if (tableCtx && tableCtx.seats.size > 0) {
                tableCtx.seats.forEach(s => {
                    if (TARGET_WATCHLIST.has(s.cleanNick) && (s.stack || 0) > 0 && !s.busted) {
                        hasActiveTarget = true;
                    }
                });
            }

            let isUserWatchingThisTable = (tableId === stalkerState.userViewingTableId);

            if ((!hasActiveTarget || isUserWatchingThisTable) && ws.readyState === WebSocket.OPEN) {
                if (ws.__heartbeatTimer) clearInterval(ws.__heartbeatTimer);
                try { ws.close(); } catch(e) {}
                stalkerState.backgroundTableSockets.delete(tableId);
                stalkerState.activeTables.delete(tableId);
                stalkerState.discoveredTargetTables.delete(tableId);
                logDebug("SOCKET_CLEANUP", `Стол ${tableId} закрыт (${isUserWatchingThisTable ? 'пользователь открыл руками' : 'целей нет'})`);
            }
        }

        for (let [tableId, tInfo] of stalkerState.discoveredTargetTables.entries()) {
            if (stalkerState.backgroundTableSockets.size >= MAX_BACKGROUND_TABLES) break;
            if (stalkerState.backgroundTableSockets.has(tableId)) continue;
            if (tableId === stalkerState.userViewingTableId || tInfo.tournId === stalkerState.userViewingTournId) continue;

            let cd = stalkerState.socketCooldowns.get(tableId) || 0;
            if (now < cd) continue;

            let tableWs = new OrigWS(wsUrl);
            tableWs.__tableId = tableId;
            tableWs.__tableContext = new TableContext(tableId, tInfo.tournId);
            stalkerState.backgroundTableSockets.set(tableId, tableWs);
            stalkerState.activeTables.set(tableId, tableWs.__tableContext);

            logDebug("SOCKET_CONNECT", `Подключение к столу ${tableId} (турнир ${tInfo.tournId}, цель ${tInfo.targetNick})`);

            tableWs.onopen = function() {
                tableWs.send(`<EnterTable sessionId="${sid}" tableId="${tableId}" tournamentId="${tInfo.tournId}" client="html5mobile" clientVersion="${stalkerState.auth.clientVersion}"/>`);
                tableWs.send('<GetTableDetails/>');
                tableWs.send('<JoinTable/>');

                tableWs.__heartbeatTimer = setInterval(() => {
                    if (tableWs.readyState === WebSocket.OPEN) {
                        try { tableWs.send('<GetServerTime/>'); } catch(e) {}
                    }
                }, 15000);
            };

            tableWs.onclose = function() {
                if (tableWs.__heartbeatTimer) clearInterval(tableWs.__heartbeatTimer);
                stalkerState.backgroundTableSockets.delete(tableId);
                stalkerState.activeTables.delete(tableId);
                stalkerState.socketCooldowns.set(tableId, Date.now() + 20000);
                updateHUD();
            };

            tableWs.onerror = function() {
                try { tableWs.close(); } catch(err) {}
            };
        }
        updateHUD();
    }
    setInterval(manageBackgroundSpectatorPool, 2500);

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
            if (!wsUrl || !sid) return resolve();

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
                let currentBB = (tourn && tourn.currentBB) ? tourn.currentBB : 500;
                if (levelMap.has(currentLevel)) {
                    currentBB = levelMap.get(currentLevel);
                    if (tourn) tourn.currentBB = currentBB;
                }

                let offset = iattr(text, 'offset') || 0;
                let total = iattr(text, 'total') || 0;
                let remaining = iattr(text, 'remaining') || 0;
                let playerBlocks = text.matchAll(/<Player\s+([^>]+)>/g);
                let countInChunk = 0;

                let cachedName = stalkerState.tournamentNamesCache.get(tournId);
                let liveName = (tourn && tourn.name) ? tourn.name : null;

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
                        
                        let regPrize = parseFloat(attr(attrs, 'prizeAmount') || '0');
                        let bountyPrize = parseFloat(attr(attrs, 'knockoutBounty') || '0');
                        let totalPrize = regPrize + bountyPrize;

                        let uuid = attr(attrs, 'uuid') || `target_${cleanNick}`;
                        
                        if (place === 0 && remaining === 1) place = 1;
                        if (place === 0 && rank === 1 && remaining === 0) place = 1;

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

                        let prevName = existingEntry ? existingEntry.tableName : null;
                        let finalTournName = liveName || cachedName || prevName || 'MTT';

                        p.entries.set(entryKey, {
                            rawNick: rawNick,
                            cleanNick: cleanNick,
                            uuid: uuid,
                            stack: stack,
                            stackBB: stackBB,
                            rank: rank,
                            place: place,
                            regular_prize: regPrize,
                            bounty_prize: bountyPrize,
                            prize: totalPrize,
                            isBusted: isBusted,
                            tableName: finalTournName,
                            tournId: tournId
                        });

                        if (isNewEntry || statusChanged) {
                            queueServerEvent(isBusted ? "TARGET_PLAYER_BUSTED" : "TARGET_PLAYER_DISCOVERED", {
                                uuid: uuid,
                                name: cleanNick,
                                raw_nick: rawNick,
                                tournament_id: tournId,
                                tournament_name: finalTournName,
                                chips: stack,
                                stack_bb: Math.round(stackBB * 100) / 100,
                                place: place,
                                prize: totalPrize,
                                is_busted: isBusted
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

                if (text.includes('<TournamentDetails') || text.includes('<Schedule')) {
                    let lvl = iattr(text, 'currentLevel');
                    if (lvl) currentLevel = lvl;

                    let tdName = attr(text, 'name');
                    if (tdName) {
                        stalkerState.tournamentNamesCache.set(tournId, decodeHtml(tdName));
                    }
                }

                if (text.includes('<Schedule')) {
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
                if (wasEmpty && stalkerState.sockets.lobby) triggerLobbyTournamentRefresh();
            }

            let versMatch = xml.match(/\bclientVersion="([^"]+)"/);
            if (versMatch) stalkerState.auth.clientVersion = versMatch[1];

            if (dir === 'OUT') {
                if (xml.includes('<EnterTournamentLobby')) {
                    stalkerState.userViewingTournId = attr(xml, 'id');
                } else if (xml.includes('<EnterTable') || xml.includes('<OpenTable')) {
                    let tableId = attr(xml, 'tableId') || attr(xml, 'id');
                    let tournId = attr(xml, 'tournamentId');
                    if (tableId) {
                        stalkerState.userViewingTableId = tableId;
                        ws.__tableId = tableId;
                        if (!stalkerState.activeTables.has(tableId)) {
                            ws.__tableContext = new TableContext(tableId, tournId);
                            stalkerState.activeTables.set(tableId, ws.__tableContext);
                        } else {
                            ws.__tableContext = stalkerState.activeTables.get(tableId);
                        }
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
                if (firstTime && stalkerState.auth.sessionId) triggerLobbyTournamentRefresh();
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

                    if (tId && tName) {
                        stalkerState.tournamentNamesCache.set(tId, decodeHtml(tName));
                    }

                    let isHoldem = tGame.includes('TEXAS_HOLDEM') || tGame.includes('HOLDEM') || (!tGame.includes('OMAHA') && !tGame.includes('PINEAPPLE') && !tName.toLowerCase().includes('омаха') && !tName.toLowerCase().includes('ананас'));
                    let isLiveRunning = LIVE_STATUSES.has(tStatus);

                    if (isHoldem && tId && isLiveRunning) {
                        if (!stalkerState.liveTournaments.has(tId)) {
                            stalkerState.liveTournaments.set(tId, { id: tId, name: decodeHtml(tName) || 'MTT', status: tStatus, currentBB: 500 });
                        } else {
                            let item = stalkerState.liveTournaments.get(tId);
                            item.status = tStatus;
                            if (tName) item.name = decodeHtml(tName);
                        }
                        if (!stalkerState.scannerQueue.includes(tId)) stalkerState.scannerQueue.push(tId);
                    } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED' || tStatus === 'CANCELED_NOT_PAID')) {
                        scanSingleTournamentBackground(tId).then(() => {
                            stalkerState.liveTournaments.delete(tId);
                            updateHUD();
                        });

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
                let tName = attr(xml, 'tournamentName') || attr(xml, 'name');
                if (tournId && tName) {
                    stalkerState.tournamentNamesCache.set(tournId, decodeHtml(tName));
                }

                if (tableId) {
                    ws.__tableId = tableId;
                    if (!ws.__tableContext) {
                        ws.__tableContext = stalkerState.activeTables.get(tableId) || new TableContext(tableId, tournId);
                    }
                    stalkerState.activeTables.set(tableId, ws.__tableContext);

                    let addonM = xml.match(/<Addon\s+([^>]*)\/>/);
                    if (addonM) {
                        ws.__tableContext.tournamentRules.addonChips = iattr(addonM[1], 'chips') || 0;
                        ws.__tableContext.tournamentRules.addonCost = iattr(addonM[1], 'cost') || 0;
                        ws.__tableContext.tournamentRules.addonCost2x = iattr(addonM[1], 'cost2x') || 0;
                    }
                    let rebuyM = xml.match(/<Rebuy\s+([^>]*)\/>/);
                    if (rebuyM) {
                        ws.__tableContext.tournamentRules.rebuyChips = iattr(rebuyM[1], 'chips') || 0;
                        ws.__tableContext.tournamentRules.rebuyCost = iattr(rebuyM[1], 'cost') || 0;
                    }
                }
            }

            let ctx = ws.__tableContext;
            if (!ctx) return;

            if (xml.includes('description="Table is already closed"')) {
                let cTableId = ws.__tableId || attr(xml, 'id');
                if (cTableId) {
                    stalkerState.activeTables.delete(cTableId);
                    stalkerState.backgroundTableSockets.delete(cTableId);
                    logDebug("TABLE_CLOSED", `Стол ${cTableId} закрыт сервером`);
                }
            }

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

            // РЕБАИ, ДОКУПКИ И АДДОНЫ
            let rebuyMatches = xml.matchAll(/<ChipsRebuy\s+([^>]*)\/>/g);
            for (let rm of rebuyMatches) {
                let rSeat = iattr(rm[1], 'seat');
                let rAmt = iattr(rm[1], 'amount') || 0;
                let rReason = attr(rm[1], 'reason') || 'REBUY';

                if (rSeat !== null && rAmt > 0) {
                    let s = ctx.ensureSeat(rSeat, null);
                    s.stack = (s.stack || 0) + rAmt;
                    s.busted = false;

                    let is2x = (rReason === 'ADDON' && ctx.tournamentRules.addonChips > 0 && rAmt >= ctx.tournamentRules.addonChips * 2);

                    ctx.handRebuyEvents.push({
                        seat: rSeat,
                        nick: s.rawNick,
                        reason: rReason,
                        amount: rAmt,
                        is_double: is2x
                    });

                    logDebug("REBUY_ADDON", `Игрок ${s.rawNick} (место ${rSeat}) получил ${rAmt} фишек [${rReason}${is2x ? ' 2X' : ''}]`);
                }
            }

            // СЕРВЕРНАЯ СИНХРОНИЗАЦИЯ МЕСТ, СТЕКОВ И ФИНАНСОВ
            if (xml.includes('<Seats') || (xml.includes('<Seat ') && xml.includes('<PlayerInfo'))) {
                let seatBlocks = xml.matchAll(/<Seat\s+([^>]*?\bid="(\d+)"[^>]*?)(?:\/>|>([\s\S]*?)<\/Seat>)/gs);
                for (let sb of seatBlocks) {
                    let seatAttrs = sb[1];
                    let seatNum = parseInt(sb[2], 10);
                    let seatContent = sb[3] || '';

                    let piM = seatContent.match(/<PlayerInfo[^>]*nickname="([^"]+)"/);
                    let rawNick = piM ? piM[1] : attr(seatContent, 'nickname');
                    let chipsM = seatContent.match(/<Chips[^>]*\/>/);
                    let stackM = seatContent.match(/stack-size="([^"]+)"/);
                    let entryM = seatContent.match(/<Entry\s+([^>]*)\/?>/);
                    
                    let serverStack = chipsM ? iattr(chipsM[0], 'stack-size') : (stackM ? parseInt(stackM[1], 10) : null);
                    let serverSpent = entryM ? (iattr(entryM[1], 'spent') || 0) : 0;
                    let serverRebuys = entryM ? (iattr(entryM[1], 'rebuys') || 0) : 0;
                    let serverAddons = entryM ? (iattr(entryM[1], 'addons') || 0) : 0;

                    let isSittingOut = seatAttrs.includes('sittingOut="true"') || seatContent.includes('sittingOut="true"');
                    if (isSittingOut) ctx.sittingOutSeats.add(seatNum);
                    else ctx.sittingOutSeats.delete(seatNum);

                    let s = ctx.ensureSeat(seatNum, rawNick, serverStack);
                    s.busted = (serverStack === 0);
                    s.spent = serverSpent;
                    s.rebuys = serverRebuys;
                    s.addons = serverAddons;

                    if (ctx.hand === null && serverStack !== null && serverStack > 0) {
                        ctx.handStart[seatNum] = serverStack;
                    }

                    if (rawNick && TARGET_WATCHLIST.has(s.cleanNick)) {
                        let p = getOrCreatePlayerProfile(s.cleanNick);
                        let tournId = ctx.tournId;
                        let entryKey = `${tournId || ctx.tableId}_${rawNick}`;
                        let entry = p.entries.get(entryKey) || {
                            rawNick: rawNick,
                            cleanNick: s.cleanNick,
                            tableName: ctx.getTournamentName()
                        };
                        
                        if (!entry.isBusted || entry.place === 0) {
                            if (serverStack !== null) entry.stack = serverStack;
                            entry.stackBB = ctx.getLiveStackBB(entry.stack) || 0;
                            entry.tournId = tournId;
                            entry.isBusted = (entry.stack === 0);
                            entry.spent = serverSpent;
                            entry.rebuys = serverRebuys;
                            entry.addons = serverAddons;
                            entry.tableName = ctx.getTournamentName();
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

                let acM = xml.matchAll(/<ActiveChange\s+([^>]*)\/>/g);
                for (let ac of acM) {
                    let actSeat = iattr(ac[1], 'seat');
                    if (actSeat !== null) {
                        ctx.seatTimerStart.set(actSeat, Date.now());
                    }
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

                    if (kind === 'SitOut') {
                        ctx.sittingOutSeats.add(seatNum);
                    } else if (kind === 'SitIn') {
                        ctx.sittingOutSeats.delete(seatNum);
                    }

                    if (['PostAnte', 'PostSmallBlind', 'PostBigBlind', 'Bet', 'Raise', 'Call', 'AllIn', 'UncalledBet'].includes(kind)) {
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
                        if (mc.length >= 2) {
                            ctx.showdownCards[seatNum] = { cards: mc.slice(0, 2).join(' '), isMuck: true, combination: '' };
                        }
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
                                if (playerPos === 'BB') { p.stealFacedBB++; p.foldBBCount++; }
                                else if (playerPos.includes('SB')) { p.stealFacedSB++; p.foldSBCount++; }
                            }
                        } else if (kind === 'Check') {
                            p.totalActions++;
                        }
                    }
                }

                // ЧИПСЫ В БАНК (SSOT SWEPT POTS)
                let pcM, pcRe = /<PotsChange>([\s\S]*?)<\/PotsChange>/g;
                while ((pcM = pcRe.exec(xml)) !== null) {
                    ctx.processPotsChange(pcM[1]);
                }

                ctx.updateBoardFromXml(xml);

                // ПЕРЕХВАТ НОКАУТОВ (REAL-TIME BOUNTY ENGINE)
                let koM = xml.match(/<Knockout\s+([^>]*)\/>/);
                if (koM && ctx.hand) {
                    let bustedSeat = iattr(koM[1], 'busted');
                    let winnerSeat = iattr(koM[1], 'winner');
                    let prize = iattr(koM[1], 'prize', 0);
                    let bounty = iattr(koM[1], 'bounty', 0);
                    
                    let killer = ctx.seats.get(winnerSeat);
                    let victim = ctx.seats.get(bustedSeat);
                    
                    ctx.knockoutBounties.push({
                        killer_nick: killer ? killer.rawNick : `Seat ${winnerSeat}`,
                        killer_seat: winnerSeat,
                        victim_nick: victim ? victim.rawNick : `Seat ${bustedSeat}`,
                        victim_seat: bustedSeat,
                        cash_payout_rub: prize,
                        bounty_growth_rub: bounty
                    });
                }

                // ПЕРЕХВАТ ПОБЕДИТЕЛЕЙ (С ПОДДЕРЖКОЙ POT-INDEX)
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
                        let wCards = Array.from(wInner.matchAll(/<Card[^>]*>([2-9TJQKA]|10)([shdc])<\/Card>/gi)).map(m => m[1] + m[2]).slice(0, 5).join(' ');

                        let alreadyAdded = ctx.winners.some(w => w.seat === wSeat && w.potIndex === potIdx);
                        if (!alreadyAdded && wSeat !== null && wAmt > 0) {
                            ctx.winnerSum += wAmt;
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

            // ПЕРЕХВАТ ЧАТА И ПСИХОЛОГИИ (CHAT LOGGER)
            let chatM = xml.match(/<ChatMessage\s+([^>]*)\/>/);
            if (chatM) {
                let cAttr = chatM[1];
                let type = attr(cAttr, 'type');
                let sender = attr(cAttr, 'from');
                let text = attr(cAttr, 'text');

                if (type === 'USER' && sender && text && !/Dealer|Дилер|Система/i.test(sender) && !SYSTEM_CHAT_REGEX.test(text)) {
                    let cleanSender = getCleanNick(sender);
                    if (TARGET_WATCHLIST.has(cleanSender)) {
                        stalkerState.chatLogs.push({
                            timestamp: new Date().toISOString(),
                            tournament_name: ctx ? ctx.getTournamentName() : 'MTT',
                            table_id: ws.__tableId || 'unknown',
                            nick: sender,
                            cleanNick: cleanSender,
                            message: decodeHtml(text),
                            type: 'TEXT'
                        });
                    }
                }
            }

            let emojiM = xml.match(/<SendEmoji\s+([^>]*)\/>/);
            if (emojiM && ctx) {
                let senderSeat = iattr(emojiM[1], 'sender');
                let emoji = attr(emojiM[1], 'emoji');
                let p = ctx.seats.get(senderSeat);
                if (p && TARGET_WATCHLIST.has(p.cleanNick)) {
                    stalkerState.chatLogs.push({
                        timestamp: new Date().toISOString(),
                        tournament_name: ctx.getTournamentName(),
                        table_id: ws.__tableId,
                        nick: p.rawNick,
                        cleanNick: p.cleanNick,
                        message: `[EMOJI: ${emoji}]`,
                        type: 'EMOJI'
                    });
                }
            }

            let throwM = xml.match(/<Throw\s+([^>]*)\/>/);
            if (throwM && ctx) {
                let fromSeat = iattr(throwM[1], 'from');
                let toSeat = iattr(throwM[1], 'to');
                let item = attr(throwM[1], 'item');
                let pFrom = ctx.seats.get(fromSeat);
                let pTo = ctx.seats.get(toSeat);
                if (pFrom && TARGET_WATCHLIST.has(pFrom.cleanNick)) {
                    stalkerState.chatLogs.push({
                        timestamp: new Date().toISOString(),
                        tournament_name: ctx.getTournamentName(),
                        table_id: ws.__tableId,
                        nick: pFrom.rawNick,
                        cleanNick: pFrom.cleanNick,
                        message: `[THROW: ${item} -> ${pTo ? pTo.rawNick : 'Seat '+toSeat}]`,
                        type: 'THROW'
                    });
                }
            }

        } catch(e) {
            console.error("XML Stream Error:", e);
        }
    }

    setInterval(triggerLobbyTournamentRefresh, 30000);
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
                chat_logs: stalkerState.chatLogs,
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
            a.download = `pokerdom_v32_0_psycho_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ПЕРЕХВАТЧИК СОКЕТОВ (ЕДИНСТВЕННЫЙ СЛУШАТЕЛЬ) ───────────────────
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
        if (!ws || ws.__stalkerHookedV320) return;
        ws.__stalkerHookedV320 = true;

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
    if (OrigWS && !window.__stalkerWsProxyV320) {
        window.__stalkerWsProxyV320 = true;
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

    console.log("%c🎯 [VIP Scout v32.0 PSYCHO] Запущен. Чат, Эмодзи и Нокауты активированы.", "color:#06b6d4;font-weight:bold;");
})();

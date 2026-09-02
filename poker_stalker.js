javascript:(function(){
    /* ══════════════════════════════════════════════════════════════════
       ULTIMATE SCALPEL v64.0 — APEX-IMPERIOR (HARDENED MONOLITH)
       • v64 F1 (BUG-BUYIN-DISTORTION): номинальный бай-ин = buyIn + bounty
         БЕЗ рейка (fee) — эвристика «buyIn уже включает всё» раздувала номинал
         2500+2500+400 → 5400₽; полный вход хранится отдельно (entryCost)
       • v64 F2 (BUG-POT-DESYNC): amount у ВСЕХ тегов действий протокола —
         ДЕЛЬТА (прирост фишек), а не тотал улицы: SB 150k + Raise 450k = 600k
         тотал; прежняя трактовка теряла 150k на каждом рейзе поверх блайнда
         (chip_conservation 6/13 рук, GTO «raises 150000 to 450000»);
         C7-агрессивность олл-ина переведена на итог улицы (streetBetAfter)
       • v64 F3 (BUG-REBUY-BADGE): бейдж HUD считает входы как
         max(bullets, rebuys+1) и берёт сумму из e.spent — суффикс #N в
         лобби-строке часто отсутствует, ребаи жили только в e.rebuys
       • v64 F4 (BUG-BUYIN-ROUNDING): деньги (₽) форматирует formatRub —
         группировка разрядов с копейками, без принудительного «k»-округления
         (1080₽ больше не превращается в «1.1k₽»)
       • v64 F5 (BUG-MUCK-MARKER): Dense DSL помечает карты, слитые через
         утечку протокола, маркером «!» (As7d → !As7d) — отличимо от
         добровольного шоудауна
       • v64 F6 (BUG-KO-SUMMARY): GTO-экспорт добавляет каноническую строку
         PokerStars «X wins the tournament and receives Y in bounty» —
         PT4/HM3 теперь видят баунти-выплаты при импорте
       • v62 B1 (BUG-ZOMBIE-TABLE): bust rows без tableId теперь чистят устаревшую
         запись discoveredTargetTables («зомби»-спектаторы больше не держат слот
         80-столового пула весь турнир); записи профиля переключены на ключ cleanNick
         — ребай-переименование (Vasya → Vasya #2) не рвёт цепочку очистки
       • v62 B2 (BUG-STREET-DESYNC): разбор кадра в порядке документа (streaming)
         для PlayerAction + Dealing/Board — склеенные кадры «действие+сдача»
         атрибутируются корректно в ЛЮБОМ порядке следования в кадре
       • v62 B3 (BUG-STEAL-METRICS): stealFacedBB/SB считаются только против
         реальной попытки кражи (единственный префлоп-рейз от CO/BTN/SB);
         в экспорт добавлены знаменатели stealFaced*Opp и foldToSteal*Pct
       • v62 B4 (BUG-SPENT): детерминированные bullets × baseBuyin — единый
         источник во всех трёх местах; серверный `spent` сохраняется как
         spent_server (аудит) + фолбэк при промахе кэша; fee-ветка исправлена
         в v62 (330+30 = 360), в v64 F1 номинал = 330 (рейк в номинал не входит)
       • v62 B5: dead-button fallback не изменён — проверен как корректный
         (TDA rule 32); внешнее сообщение опровергнуто в раунде-2
       • v63 C1: HU-сводка печатает ОБА тега — "(button) (small blind)"
         (цепочка || теряла тег SB на совмещённом месте BTN/SB)
       • v63 C2: посты блайндов «0» устранены в ОБОИХ циклах эмиттера +
         анте ограничен стеком ('posts the ante N and is all-in')
       • v63 C3: заголовок SHOW DOWN только при наличии карт — неконтести-
         рованные банки идут сразу к collected/SUMMARY
       • v63 C5: дошедшие до вскрытия без показа помечаются 'mucked'
         (последняя запись таймлайна ≠ FOLD), а не 'folded'
       • v63 C7: кража = НЕРАСКРЫТЫЙ банк (без лимперов; limp-all-in тоже
         закрывает) + сброс счётчика в beginHand — патч автора регрессил
         трекинг навсегда, исправленная версия сохраняет B3-семантику
       • v63 C9: ключ записи профиля разрешается с миграцией — гонка
         «Seats раньше TableDetails» больше не создаёт двойников
       • v63 отклонённые: C4 (формула патча ломает многоуличные олл-ины),
         C8 (схема DSL консистентна, ломать обратную совместимость нельзя),
         C10 (патч неэффективен + течёт контекстами)
       • Fix 1: Eliminated ReferenceError in handleOutgoing (Clean User Open)
       • Fix 2: Strict Deduplication in finalizeHand (VPIP <= 100% Guaranteed)
       • Fix 3: Safe Fallback for Folding Stacks (0 Discarded Valid Hands)
       • Fix 4: Accurate Delta Accounting for All-In Re-raises
       • Fix 5: Normalized Aggression Factor (99.0 instead of Inf)
       • v61 F1 (BUG-MEMORY): URL.revokeObjectURL in all 3 exporters
       • v61 F2 (BUG-PLACEHOLDER): spawn-timer tracking + closeable placeholder
         + releaseBackgroundSocket() + destroy() cancels pending spawns
       • v61 F3 (BUG-CHAT): paired <ChatMessage>…</ChatMessage> + all messages per frame
       • v61 F4 (BUG-RAISE-DELTA/GTO-RAISE): single bet-accounting source of truth
         (timeline.street_bet_after) — GTO/DSL totals now match the engine
       • v61 F5 (BUG-SEATS): auto seat-base calibration (0/1-based) + true table max
       • v61 F6 (BUG-DEFLATE): raw deflate + zlib + gzip, correct typed-array
         slicing, pure-JS inflate fallback (no DecompressionStream needed)
       • v61 F7 (BUG-SCANNER-QUEUE): bounded queue + O(1) dedupe + state maintenance
         (stale liveTournaments, tournamentCache, socketCooldowns, chatLogs)
       • v61 F8: per-table hand dedup key (no cross-table collisions),
         isDestroyed zombie guards, HTML-escaped HUD, all-in raise stats fix
       • Base-13 Polynomial Evaluator | Exact Integer DSL | 80 Tables Max
       ══════════════════════════════════════════════════════════════════ */

    // 1. БЕЗОПАСНЫЙ ЗАХВАТ ИСХОДНОГО WEBSOCKET
    if (!window.__SCALPEL_ORIG_WS) {
        window.__SCALPEL_ORIG_WS = window.WebSocket;
    }
    const OrigWS = window.__SCALPEL_ORIG_WS;

    // 2. ДЕСТРУКТОР ПРЕДЫДУЩЕГО ИНСТАНСА
    if (window.__SCALPEL && typeof window.__SCALPEL.destroy === 'function') {
        try { window.__SCALPEL.destroy(); } catch(e) {}
    }
    document.querySelectorAll('[id^="stalker-hud"]').forEach(el => el.remove());

    const scoutServerUrl = "https://toofunoff-poker-scout.hf.space";
    const MAX_BACKGROUND_TABLES = 80;
    const MAX_ARCHIVE_HANDS = 10000;
    const MAX_OUTBOX_QUEUE = 3000;
    const MAX_DEBUG_LOGS = 300;
    const SCANNER_CONCURRENCY = 3;
    const MAX_SCANNER_QUEUE = 500;
    const MAX_CHAT_LOGS = 2000;
    const MAX_TOURNAMENT_CACHE = 3000;
    const STALE_TOURNAMENT_MS = 15 * 60 * 1000;

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

    window.__SCALPEL = {
        state: {
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
            scannerQueued: new Set(),
            isScanningActive: false,
            timerIds: [],
            isDestroyed: false,
            serverSeatBase: 0,
            serverSeatBaseLocked: false
        }
    };

    let state = window.__SCALPEL.state;
    const CARD_RANKS = "23456789TJQKA";

    // ── БАЗОВЫЙ 13-ПОЛИНОМИАЛЬНЫЙ 7-КАРТОЧНЫЙ ОЦЕНЩИК (BASE-13) ────────
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

        if (quads.length > 0) return { score: 7000000 + quads[0] * 13 + singles[0], tag: `4K_${CARD_RANKS[quads[0]]}_${CARD_RANKS[singles[0]]}` };
        if (trips.length > 0 && pairs.length > 0) return { score: 6000000 + trips[0] * 13 + pairs[0], tag: `FH_${CARD_RANKS[trips[0]]}_${CARD_RANKS[pairs[0]]}` };
        if (isFlush) return { score: 5000000 + rankIndices.reduce((acc, v, i) => acc + v * Math.pow(13, 4 - i), 0), tag: `FL_${rankIndices.map(i => CARD_RANKS[i]).join('')}` };
        if (isStraight) return { score: 4000000 + CARD_RANKS.indexOf(straightHigh), tag: `ST_${straightHigh}` };
        if (trips.length > 0) return { score: 3000000 + trips[0] * 169 + singles[0] * 13 + singles[1], tag: `3K_${CARD_RANKS[trips[0]]}_${CARD_RANKS[singles[0]]}${CARD_RANKS[singles[1]]}` };
        if (pairs.length >= 2) return { score: 2000000 + pairs[0] * 169 + pairs[1] * 13 + singles[0], tag: `2P_${CARD_RANKS[pairs[0]]}_${CARD_RANKS[pairs[1]]}_${CARD_RANKS[singles[0]]}` };
        if (pairs.length === 1) return { score: 1000000 + pairs[0] * 2197 + singles[0] * 169 + singles[1] * 13 + singles[2], tag: `1P_${CARD_RANKS[pairs[0]]}_${singles.slice(0, 3).map(i => CARD_RANKS[i]).join('')}` };

        return { score: rankIndices.reduce((acc, v, i) => acc + v * Math.pow(13, 4 - i), 0), tag: `HC_${rankIndices.map(i => CARD_RANKS[i]).join('')}` };
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
                            if (res.score > bestResult.score) bestResult = res;
                        }
                    }
                }
            }
        }
        return bestResult.tag;
    }

    function logDebug(category, message) {
        let entry = { time: new Date().toLocaleTimeString(), category: category, message: message };
        state.engineDebugLog.push(entry);
        if (state.engineDebugLog.length > MAX_DEBUG_LOGS) state.engineDebugLog.shift();
    }

    function cleanCyrillic(str) {
        if (!str) return "MTT";
        try {
            if (/[РС][\x80-\xBF]/.test(str)) return decodeURIComponent(escape(str));
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

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function parseBulletNumber(rawNick) {
        if (!rawNick) return 1;
        let m = rawNick.match(/#(\d+)\s*$/) || rawNick.match(/#(\d+)\b/);
        return m ? parseInt(m[1], 10) : 1;
    }

    function formatChips(chips) {
        if (!chips || chips <= 0) return "0";
        if (chips >= 1000000) return (chips / 1000000).toFixed(2) + "M";
        if (chips >= 1000) return (chips / 1000).toFixed(1) + "k";
        return Math.round(chips).toString();
    }

    // v64 F4 (BUG-BUYIN-ROUNDING): деньги (₽) форматируются отдельно от
    // фишек. formatChips(1080) давал «1.1k₽», formatChips(5000) — «5.0k₽»:
    // принудительное k-округление искажало номинал бай-ина. formatRub
    // печатает полное число с неразрывными разделителями разрядов,
    // копейки сохраняются (14 932.61₽), целые — без дробной части.
    function formatRub(amount) {
        if (amount === null || amount === undefined || isNaN(amount)) return "0";
        let n = Number(amount);
        if (n <= 0) return "0";
        let hasCents = Math.abs(n - Math.round(n)) > 1e-9;
        let str = hasCents ? n.toFixed(2) : Math.round(n).toString();
        let dot = str.indexOf('.');
        let intPart = dot === -1 ? str : str.slice(0, dot);
        let fracPart = dot === -1 ? '' : str.slice(dot);
        let grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
        return grouped + fracPart;
    }

    function extractAmt(str) {
        let m = str.match(/:(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function autoDetectSessionId() {
        if (state.auth.sessionId) return state.auth.sessionId;
        try {
            for (let storage of [sessionStorage, localStorage]) {
                for (let i = 0; i < storage.length; i++) {
                    let k = storage.key(i);
                    let v = storage.getItem(k);
                    if (v && typeof v === 'string' && /^[a-f0-9]{16}-[a-f0-9]{16}$/i.test(v.trim())) {
                        state.auth.sessionId = v.trim();
                        return state.auth.sessionId;
                    }
                }
            }
        } catch(e) {}
        return null;
    }

    const POSITION_SCHEMES = {
        2: ['BTN/SB', 'BB'],
        3: ['BTN', 'SB', 'BB'],
        4: ['BTN', 'SB', 'BB', 'CO'],
        5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
        6: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO'],
        7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
        8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
        9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO']
    };

    function calculatePositions(activeSeatsList, dealerSeatNum) {
        let seats = [...activeSeatsList].sort((a, b) => a - b);
        let n = seats.length;
        if (n === 0) return {};

        let dIdx = seats.indexOf(dealerSeatNum);
        if (dIdx === -1) {
            let lower = seats.filter(s => s <= dealerSeatNum);
            dIdx = lower.length > 0 ? seats.indexOf(Math.max(...lower)) : seats.length - 1;
        }

        let ordered = [];
        for (let i = 0; i < n; i++) ordered.push(seats[(dIdx + i) % n]);

        let scheme = POSITION_SCHEMES[n] || POSITION_SCHEMES[9];
        let posMap = {};
        for (let i = 0; i < n; i++) {
            posMap[ordered[i]] = scheme[i] || `UTG+${i}`;
        }
        return posMap;
    }

    function getOrCreatePlayerProfile(cleanNick) {
        if (!state.stalkedPlayers.has(cleanNick)) {
            state.stalkedPlayers.set(cleanNick, {
                cleanNick: cleanNick,
                entries: new Map(),
                handsCount: 0,
                sitOutHandsCount: 0,
                vpipCount: 0,
                pfrCount: 0,
                aggressiveActions: 0,
                passiveActions: 0,
                totalActions: 0,
                stealFacedBB: 0,
                stealFacedSB: 0,
                // v62 B3: знаменатели fold-to-steal — «слепой встретил попытку
                // кражи» (один префлоп-рейз от CO/BTN/SB). Вместе с числителями
                // дают foldToSteal*Pct в экспорте.
                stealFacedBBOpp: 0,
                stealFacedSBOpp: 0
            });
        }
        return state.stalkedPlayers.get(cleanNick);
    }

    // ── СЕРВЕРНЫЙ ДВИЖОК СТОЛА ─────────────────────────────────────────
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
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.investedPerSeat = new Map();       
            this.streetBetsPerSeat = new Map();     
            this.currentMaxBet = 0;                 
            this.handActions = new Map();
            this.timeline = [];
            this.knockoutBounties = [];
            this.sittingOutSeats = new Set();
            this.handPendingStats = new Map();
            this.playersCountedThisHand = new Set();
            this.processedActionIds = new Set();
            this.seatTimerStart = new Map();
            this.runningPot = 0;
            this.handOrigin = null;
            this.maxSeatId = 0;
            this.observedSeatCount = 0;
            // v62 B3: трекер попытки кражи текущей руки
            this.preflopRaises = 0;
            this.preflopStealAttempt = false;
            // v63 C7: счётчик лимперов (открытый банк = без лимперов)
            this.preflopCallers = 0;
        }

        getActiveHandBB() {
            if (this.level.bb > 0) return this.level.bb;
            if (this.tournId && state.liveTournaments.has(this.tournId)) {
                return state.liveTournaments.get(this.tournId).currentBB || 500;
            }
            return 500;
        }

        getTournamentMeta() {
            if (this.tournId && state.tournamentCache.has(this.tournId)) {
                return state.tournamentCache.get(this.tournId);
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
            this.winners = [];
            this.showdownCards = {};
            this.handStart = {};
            this.investedPerSeat.clear();
            this.streetBetsPerSeat.clear();
            this.activeSeats.clear();
            this.dealtSeats.clear();
            this.handActions.clear();
            this.timeline = [];
            this.knockoutBounties = [];
            this.handPendingStats.clear();
            this.playersCountedThisHand.clear();
            this.processedActionIds.clear();
            this.seatTimerStart.clear();
            this.runningPot = 0;
            // v62 B3: сброс трекера кражи руки
            this.preflopRaises = 0;
            this.preflopStealAttempt = false;
            // v63 C7: сброс счётчика лимперов — БЕЗ него счётчик протекал бы
            // через все последующие руки (фатальный регресс предложенного патча)
            this.preflopCallers = 0;

            let currentBB = this.getActiveHandBB();
            this.handLevel = { sb: this.level.sb || Math.round(currentBB / 2), bb: currentBB, ante: this.level.ante || 0, number: this.level.number };
            this.currentMaxBet = currentBB;

            this.seats.forEach((s, sn) => {
                if (s.stack !== null && s.stack > 0) this.handStart[sn] = s.stack;
            });

            for (let sn of activeSeatsList) {
                this.ensureSeat(sn, null);
                this.activeSeats.add(sn);
                this.dealtSeats.add(sn);
                this.investedPerSeat.set(sn, 0);
                this.handActions.set(sn, []);
            }
            this.positions = calculatePositions(activeSeatsList, this.dealer);
        }

        recordAction(seatNum, label, amount) {
            let s = this.ensureSeat(seatNum, null);
            let list = this.handActions.get(seatNum) || [];
            let str = `${this.street}_${label}`;
            
            let amtNum = amount || 0;
            let delta = 0;
            let prevStreetBet = (label !== 'ANTE') ? (this.streetBetsPerSeat.get(seatNum) || 0) : 0;
            let streetBetAfter = prevStreetBet;
            // v63 C7: максимум улицы ДО действия — агрессивность олл-ина
            // определяется против него, а не против собственной прошлой ставки
            let preMaxBet = this.currentMaxBet;

            // v64 F2 (BUG-POT-DESYNC): в протоколе Pokerdom / Connective Games
            // атрибут amount у ВСЕХ тегов действий (<Raise>, <Call>, <Bet>,
            // <AllIn>, <PostSmallBlind>, <PostAnte>) — это ДЕЛЬТА: прирост фишек
            // игрока именно в этот момент, а не суммарная ставка на улице.
            // Трактовка v61-F4 «RAISE/ALLIN amount = тотал улицы» вычитала
            // prevStreetBet из каждого рейза поверх блайнда и теряла фишки:
            // SB 150k → <Raise amount="450000"> = 600k тотал (2 BB), движок
            // считал 450k и ронял chip_conservation на 6/13 реальных рук,
            // банк занижался на 150k–450k, GTO писал «raises 150000 to 450000».
            // Экспортёры по-прежнему потребляют timeline.street_bet_after —
            // итог улицы теперь восстановлен корректно из дельт.
            if (['ANTE', 'SB', 'BB', 'CALL', 'BET', 'RAISE', 'ALLIN'].includes(label)) {
                delta = amtNum;
            } else if (label === 'UNCALLEDBET') {
                // возврат неколлированной части ставки — отрицательная дельта
                delta = -amtNum;
            }

            if (delta !== 0) {
                let handPrev = this.investedPerSeat.get(seatNum) || 0;
                this.investedPerSeat.set(seatNum, Math.max(0, handPrev + delta));
                this.runningPot += delta;

                if (label !== 'ANTE') {
                    let newStreetBet = Math.max(0, prevStreetBet + delta);
                    this.streetBetsPerSeat.set(seatNum, newStreetBet);
                    streetBetAfter = newStreetBet;
                    if (newStreetBet > this.currentMaxBet) {
                        this.currentMaxBet = newStreetBet;
                    }
                }
            }

            // v62 B3 (BUG-STEAL-METRICS): трекинг префлоп-рейзов руки. Попытка
            // кражи = ЕДИНСТВЕННЫЙ рейз префлоп, сделанный из поздней позиции
            // (CO/BTN/SB; в HU — BTN/SB). Второй рейз (3-бет) снимает флаг:
            // фолд блайнда против 3-бета — уже не fold-to-steal. Агрессивный
            // ALL-IN считается рейзом (пуш из CO в нераскрытом банке — та же
            // кража); неагрессивный (колл-олл-ин) — нет.
            // v63 C7 (UNOPENED POT): кража требует банк без лимперов — рейз
            // поверх лимпера это изоляция, не кража (PT4/H2N). Лимп = префлоп
            // CALL или неагрессивный олл-ин-колл (total ≤ максимума улицы);
            // блайнд-посты лимпами НЕ являются (SB-комплит — является, и это
            // верно: рейз BB поверх SB-комплита — не кража). Порядок: счётчик
            // инкрементируется до классификации рейза, поэтому лимпер раньше
            // рейзера закрывает банк автоматически.
            if (this.street === 'PREFLOP') {
                // v64 F2: amount олл-ина теперь дельта, поэтому агрессивность
                // сравнивает ИТОГ улицы (streetBetAfter = prev + delta) с
                // максимумом ДО действия — семантика v63 сохранена: короткий
                // all-in-рейз 250k поверх своей 200k (итог 450k > 300k) — рейз,
                // а не лимп; неагрессивный all-in-колл (итог ≤ max) — лимп.
                if (label === 'CALL' || (label === 'ALLIN' && streetBetAfter <= preMaxBet)) {
                    this.preflopCallers++;
                }
                if (label === 'RAISE' || (label === 'ALLIN' && streetBetAfter > preMaxBet)) {
                    this.preflopRaises++;
                    if (this.preflopRaises === 1) {
                        let rp = this.positions[seatNum] || '';
                        let unopened = (this.preflopCallers === 0);
                        this.preflopStealAttempt = unopened && (rp === 'CO' || rp === 'BTN' || rp.includes('SB'));
                    } else {
                        this.preflopStealAttempt = false;
                    }
                }
            }

            let thinkSec = null;
            let timerStart = this.seatTimerStart.get(seatNum);
            if (timerStart && !['ANTE', 'SB', 'BB', 'UNCALLEDBET'].includes(label)) {
                let diff = ((Date.now() - timerStart) / 1000).toFixed(1);
                if (diff >= 0 && diff < 60) thinkSec = parseFloat(diff);
                this.seatTimerStart.delete(seatNum);
            }

            let thinkStr = thinkSec !== null ? `[${thinkSec}s]` : '';
            let potBefore = Math.max(0, this.runningPot - delta);
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
                pot_before: potBefore, pot_pct: (potPct > 0 && potPct <= 500) ? potPct : null, time_sec: thinkSec,
                street_bet_after: streetBetAfter
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
                this.streetBetsPerSeat.clear();
                this.currentMaxBet = 0;
            }
        }

        finalizeHand() {
            if (!this.hand) return null;
            if (this.handOrigin === 'midhand-sync') return null;

            let handBB = this.getActiveHandBB();
            let startTotal = 0, endTotal = 0, anyStart = false;
            let players = [];
            let tMeta = this.getTournamentMeta();
            let seatNums = Array.from(this.seats.keys()).sort((a, b) => a - b);
            
            let targetUpdates = [];
            let processedNicksThisHand = new Set(); // ИСПРАВЛЕНИЕ: Дедупликация целей (VPIP <= 100%)

            for (let sn of seatNums) {
                let s = this.seats.get(sn);
                let wonAmount = this.winners.filter(w => w.seat === sn).reduce((acc, w) => acc + w.amount, 0);
                let investedInPot = this.investedPerSeat.get(sn) || 0;

                let isParticipant = this.dealtSeats.has(sn) || investedInPot > 0 || wonAmount > 0;
                if (!isParticipant) continue;
                
                // ИСПРАВЛЕНИЕ: Безопасный расчет стека фолдеров без отбрасывания раздач
                let startStack = (this.handStart[sn] !== undefined && this.handStart[sn] !== null && this.handStart[sn] > 0) 
                    ? this.handStart[sn] 
                    : Math.max(investedInPot, (s.stack !== null ? s.stack : 0) + investedInPot);

                if (!startStack || startStack <= 0) {
                    startStack = Math.max(investedInPot, handBB);
                }

                anyStart = true;
                let endStack = Math.max(0, startStack - investedInPot + wonAmount);
                s.stack = endStack;
                startTotal += startStack;
                endTotal += endStack;

                if (TARGET_WATCHLIST.has(s.cleanNick) && !processedNicksThisHand.has(s.cleanNick)) {
                    processedNicksThisHand.add(s.cleanNick);
                    let pStats = this.handPendingStats.get(sn) || { vpip: false, pfr: false, agg: 0, pass: 0, tot: 0, stealBB: 0, stealSB: 0, stealBBOpp: 0, stealSBOpp: 0 };
                    targetUpdates.push({ cleanNick: s.cleanNick, isSitOut: this.sittingOutSeats.has(sn), pStats });
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
                    // v62 B4: единая формула с профилем/сканером — bullets × baseBuyin;
                    // серверное s.spent остаётся фолбэком при неизвестном baseBuyin,
                    // чтобы при промахе кэша не рапортовать 0₽.
                    spent_rub: (tMeta.baseBuyin > 0) ? (parseBulletNumber(s.rawNick) * tMeta.baseBuyin) : (s.spent || 0),
                    actions: this.handActions.get(sn) || []
                });
            }

            if (!anyStart) return null;

            for (let up of targetUpdates) {
                let prof = getOrCreatePlayerProfile(up.cleanNick);
                if (up.isSitOut) {
                    prof.sitOutHandsCount++;
                } else {
                    prof.handsCount++;
                    if (up.pStats.vpip) prof.vpipCount++;
                    if (up.pStats.pfr) prof.pfrCount++;
                    prof.aggressiveActions += up.pStats.agg;
                    prof.passiveActions += up.pStats.pass;
                    prof.totalActions += up.pStats.tot;
                    prof.stealFacedBB += up.pStats.stealBB;
                    prof.stealFacedSB += up.pStats.stealSB;
                    prof.stealFacedBBOpp += (up.pStats.stealBBOpp || 0);
                    prof.stealFacedSBOpp += (up.pStats.stealSBOpp || 0);
                }
                this.playersCountedThisHand.add(up.cleanNick);
            }

            let conserved = (startTotal === endTotal);
            let calculatedPotTotal = Array.from(this.investedPerSeat.values()).reduce((a, b) => a + b, 0);

            // v61 F5: seat-base calibration snapshot for the exporters
            let maxSeatNum = 0;
            players.forEach(p => { if (p.seat > maxSeatNum) maxSeatNum = p.seat; });
            let seatBase = state.serverSeatBase;
            let tableMax = Math.max(players.length, this.observedSeatCount, maxSeatNum + (seatBase === 0 ? 1 : 0));

            return {
                hand_number: this.hand, tracking: 'full', table_id: this.tableId, table_name: this.name,
                tournament_id: this.tournId, tournament_name: tMeta.name, is_pko: tMeta.isPKO,
                timestamp: new Date().toISOString(), level: this.handLevel, dealer_seat: this.dealer,
                seat_base: seatBase, table_max: tableMax,
                board: this.board.join(' '), pot_total: calculatedPotTotal, pot_bb: handBB > 0 ? Math.round(calculatedPotTotal / handBB * 10) / 10 : null,
                winners: this.winners, knockout_bounties: this.knockoutBounties, timeline: this.timeline,
                players: players, sync_verified: conserved, chip_conservation: { start_total: startTotal, end_total: endTotal, ok: conserved }
            };
        }
    }

    // ── OUTBOX EXPONENTIAL BACKOFF ────────────────────────────────────
    let isFlushingQueue = false;
    let outboxBackoffDelay = 3000;
    let nextAllowedOutboxTime = 0;

    function queueServerEvent(type, payload) {
        state.outboxQueue.push({ type: type, payload: payload, timestamp: Date.now() });
        if (state.outboxQueue.length > MAX_OUTBOX_QUEUE) state.outboxQueue.shift();
        processOutboxQueue();
    }

    async function processOutboxQueue() {
        if (isFlushingQueue || state.outboxQueue.length === 0 || Date.now() < nextAllowedOutboxTime) return;
        isFlushingQueue = true;

        while (state.outboxQueue.length > 0) {
            let batch = state.outboxQueue.slice(0, 25);
            try {
                let controller = new AbortController();
                let timeoutId = setTimeout(() => controller.abort(), 3500);

                let res = await fetch(`${scoutServerUrl}/scout_api/events_batch`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ events: batch }), signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    state.outboxQueue.splice(0, batch.length);
                    state.hfStatus = 'Онлайн';
                    outboxBackoffDelay = 3000;
                } else {
                    state.hfStatus = `HTTP ${res.status}`;
                    outboxBackoffDelay = Math.min(outboxBackoffDelay * 1.5, 30000);
                    nextAllowedOutboxTime = Date.now() + outboxBackoffDelay;
                    break;
                }
            } catch (e) {
                state.hfStatus = 'Офлайн / Буфер';
                outboxBackoffDelay = Math.min(outboxBackoffDelay * 1.5, 30000);
                nextAllowedOutboxTime = Date.now() + outboxBackoffDelay;
                break;
            }
        }
        isFlushingQueue = false;
        updateHfIndicator();
    }

    function updateHfIndicator() {
        let el = document.getElementById('st-hf-status');
        if (!el) return;
        let qLen = state.outboxQueue.length;
        let qStr = qLen > 0 ? ` (Буфер: ${qLen})` : '';
        el.innerHTML = state.hfStatus === 'Онлайн' 
            ? `<span style="color:#4ade80;">HF: ● Онлайн${qStr}</span>`
            : `<span style="color:#f87171;">HF: ○ ${state.hfStatus}${qStr}</span>`;
    }

    // ── GTO POKERSTARS EXPORTER ───────────────────────────────────────
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
                // v61 F5: seat numbering is calibrated against the detected server seat base
                // (0-based → +1 for PokerStars format, 1-based → as-is). Fallback: 0-based.
                const seatBase = (h.seat_base === 0 || h.seat_base === 1) ? h.seat_base : 0;
                const seatOffset = seatBase === 0 ? 1 : 0;
                const numPlayers = h.table_max || players.length || 8;
                const dealerSeatIdx = (h.dealer_seat !== undefined && h.dealer_seat !== null) ? (h.dealer_seat + seatOffset) : 1;
                const tableId = h.table_id || "1";

                lines.push(`Table '${tableId} 1' ${numPlayers}-max Seat #${dealerSeatIdx} is the button`);

                players.forEach(p => {
                    const sNum = (p.seat !== undefined) ? (p.seat + seatOffset) : 1;
                    lines.push(`Seat ${sNum}: ${p.nick} (${p.stack_start || 0} in chips)`);
                });

                // v63 C2: ante не больше стека игрока; стек ≤ анте → ' and is all-in'
                if (ante > 0) players.forEach(p => {
                    let anteAmt = Math.min(ante, p.stack_start || 0);
                    if (anteAmt > 0) {
                        let anteAllIn = (p.stack_start || 0) <= ante ? ' and is all-in' : '';
                        lines.push(`${p.nick}: posts the ante ${anteAmt}${anteAllIn}`);
                    }
                });

                let sbPosted = false, bbPosted = false;
                players.forEach(p => {
                    (p.actions || []).forEach(a => {
                        if (a.includes('PREFLOP_SB:')) {
                            // v63 C2: стек, съеденный анте, не порождает пост «0»
                            let amt = extractAmt(a) || sb;
                            let effStack = Math.max(0, (p.stack_start || 0) - ante);
                            if (effStack > 0) {
                                let postAmt = Math.min(effStack, amt);
                                let allInStr = (effStack <= amt) ? ' and is all-in' : '';
                                lines.push(`${p.nick}: posts small blind ${postAmt}${allInStr}`);
                                sbPosted = true;
                            }
                        } else if (a.includes('PREFLOP_BB:')) {
                            let amt = extractAmt(a) || bb;
                            let effStack = Math.max(0, (p.stack_start || 0) - ante);
                            if (effStack > 0) {
                                let postAmt = Math.min(effStack, amt);
                                let allInStr = (effStack <= amt) ? ' and is all-in' : '';
                                lines.push(`${p.nick}: posts big blind ${postAmt}${allInStr}`);
                                bbPosted = true;
                            }
                        }
                    });
                });

                // v63 C2: запасной цикл — тот же guard: реальный эмиттер нулевой
                // строки был именно здесь (игрок, чей стек целиком ушёл в анте,
                // не имеет SB-действия для основного цикла).
                if (!sbPosted || !bbPosted) {
                    players.forEach(p => {
                        let effStack = Math.max(0, (p.stack_start || 0) - ante);
                        if (effStack <= 0) return;
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
                    let effStack = Math.max(0, (p.stack_start || 0) - ante);
                    if (p.position === 'SB' || p.position === 'BTN/SB') streetBets[p.nick] = Math.min(effStack, sb);
                    if (p.position === 'BB') streetBets[p.nick] = Math.min(effStack, bb);
                    (p.actions || []).forEach(a => {
                        if (a.includes('PREFLOP_SB:')) streetBets[p.nick] = Math.min(effStack, extractAmt(a) || sb);
                        if (a.includes('PREFLOP_BB:')) streetBets[p.nick] = Math.min(effStack, extractAmt(a) || bb);
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
                    let prevBet = streetBets[nick] || 0;
                    // v61 F4: street_bet_after (engine truth) is the single source for the
                    // player's total street commitment; legacy fallback keeps old semantics
                    // for CALL (increment) and BET/RAISE (total).
                    let totalBet = (item.street_bet_after !== undefined && item.street_bet_after !== null)
                        ? item.street_bet_after
                        : ((act === 'CALL') ? (prevBet + amt) : amt);

                    if (act === 'FOLD') lines.push(`${nick}: folds${tStr}`);
                    else if (act === 'CHECK') lines.push(`${nick}: checks${tStr}`);
                    else if (act === 'CALL') {
                        lines.push(`${nick}: calls ${Math.max(0, totalBet - prevBet)}${tStr}`);
                        streetBets[nick] = totalBet;
                    } else if (act === 'BET') {
                        lines.push(`${nick}: bets ${totalBet}${tStr}`);
                        streetBets[nick] = totalBet;
                        currentMaxBet = totalBet;
                    } else if (act === 'RAISE' || act === 'ALLIN') {
                        let targetBet = totalBet;
                        if (currentMaxBet === 0) {
                            lines.push(`${nick}: bets ${targetBet}${act === 'ALLIN' ? ' and is all-in' : ''}${tStr}`);
                            currentMaxBet = targetBet;
                        } else if (targetBet > currentMaxBet) {
                            let raiseDelta = targetBet - currentMaxBet;
                            lines.push(`${nick}: raises ${raiseDelta} to ${targetBet}${act === 'ALLIN' ? ' and is all-in' : ''}${tStr}`);
                            currentMaxBet = targetBet;
                        } else {
                            // all-in short of the current bet → call for what's left
                            let callAmt = Math.max(0, targetBet - prevBet);
                            lines.push(`${nick}: calls ${callAmt}${act === 'ALLIN' ? ' and is all-in' : ''}${tStr}`);
                        }
                        streetBets[nick] = targetBet;
                    } else if (act === 'UNCALLEDBET') {
                        lines.push(`Uncalled bet (${amt}) returned to ${nick}`);
                    }
                });

                let isAllInShowdown = players.some(p => p.cards && p.cards !== 'xx xx');
                if (isAllInShowdown) {
                    if (boardCards.length >= 3 && !flopPrinted) {
                        lines.push(`*** FLOP *** [${boardCards.slice(0, 3).join(' ')}]`);
                        flopPrinted = true;
                    }
                    if (boardCards.length >= 4 && !turnPrinted) {
                        lines.push(`*** TURN *** [${boardCards.slice(0, 3).join(' ')}] [${boardCards[3]}]`);
                        turnPrinted = true;
                    }
                    if (boardCards.length >= 5 && !riverPrinted) {
                        lines.push(`*** RIVER *** [${boardCards.slice(0, 4).join(' ')}] [${boardCards[4]}]`);
                        riverPrinted = true;
                    }
                }

                // v63 C3: заголовок SHOW DOWN — только если есть карты;
                // неконтестированный банк (все фолды) идёт сразу к collected+SUMMARY
                let hasShowdownCards = players.some(p => p.cards && p.cards !== 'xx xx');
                if (hasShowdownCards) {
                    lines.push(`*** SHOW DOWN ***`);
                    players.forEach(p => {
                        if (p.cards && p.cards !== 'xx xx') {
                            if (p.is_muck_leak) lines.push(`${p.nick}: mucks hand [${p.cards}]`);
                            else lines.push(`${p.nick}: shows [${p.cards}]`);
                        }
                    });
                }

                let totalWonAmount = 0;
                let hasSidePots = (h.winners || []).some(w => w.potIndex && w.potIndex > 0);

                (h.winners || []).forEach(w => {
                    const wp = players.find(p => p.seat === w.seat);
                    const wNick = wp ? wp.nick : `Seat ${w.seat + seatOffset}`;
                    let potLabel = 'pot';
                    if (hasSidePots) {
                        potLabel = (w.potIndex && w.potIndex > 0) ? `side pot-${w.potIndex}` : `main pot`;
                    }
                    lines.push(`${wNick} collected ${w.amount} from ${potLabel}`);
                    totalWonAmount += w.amount;
                });

                // v64 F6 (BUG-KO-SUMMARY): каноническая строка PokerStars для
                // PKO-наускаута — «X wins the tournament and receives Y in
                // bounty» — стоит в настоящем HH сразу после collected-строк,
                // перед SUMMARY. PT4/HM3 парсят её при импорте, чтобы учесть
                // баунти-выплаты; без неё трекеры не видели баунти вовсе.
                (h.knockout_bounties || []).forEach(ko => {
                    let kNick = ko.killer_nick;
                    let kp = players.find(p => p.seat === ko.killer_seat);
                    if (kp) kNick = kp.nick;
                    let bountyCash = ko.cash_payout_rub || 0;
                    if (kNick && bountyCash > 0) {
                        lines.push(`${kNick} wins the tournament and receives ${bountyCash} in bounty`);
                    }
                });

                lines.push(`*** SUMMARY ***`);
                let finalPot = totalWonAmount > 0 ? totalWonAmount : (h.pot_total || 0);
                lines.push(`Total pot ${finalPot} | Rake 0`);
                if (boardCards.length > 0) lines.push(`Board [${boardCards.join(' ')}]`);

                players.forEach(p => {
                    const sNum = p.seat + seatOffset;
                    const isBtn = (p.seat === h.dealer_seat) ? " (button)" : "";
                    const isSb = (p.position === "SB" || p.position === "BTN/SB") ? " (small blind)" : "";
                    const isBb = (p.position === "BB") ? " (big blind)" : "";
                    // v63 C1: в HU BTN совпадает с SB — канонический PS выводит ОБА тега
                    // ("(button) (small blind)"). Цепочка `a || b || c` возвращала первый
                    // truthy-операнд и теряла "(small blind)".
                    const posStr = (isBtn && (p.position === "BTN/SB" || p.position === "SB"))
                        ? `${isBtn}${isSb}`
                        : (isBtn || isSb || isBb);
                    
                    let outcomeStr = "folded";
                    // v63 C5: дошедший до вскрытия без показа — 'mucked', не 'folded'.
                    // Последняя запись таймлайна места: фолдер всегда заканчивается
                    // FOLD; non-FOLD в конце = игрок был жив на финале (речной колл
                    // ИЛИ олл-ин до ривера — покрытие остаточного пробела патча).
                    let lastTl = (h.timeline || []).filter(it => it.seat === p.seat).pop();
                    let muckedAtShowdown = lastTl && lastTl.action !== 'FOLD';
                    const wEntry = (h.winners || []).find(w => w.seat === p.seat);
                    if (wEntry) outcomeStr = `showed [${p.cards || 'xx xx'}] and won (${wEntry.amount})`;
                    else if (p.cards && p.cards !== 'xx xx') outcomeStr = `showed [${p.cards}] and lost`;
                    else if (muckedAtShowdown) outcomeStr = "mucked";
                    
                    lines.push(`Seat ${sNum}: ${p.nick}${posStr} ${outcomeStr}`);
                });

                output.push(lines.join("\n"));
            } catch(e) {}
        });
        return output.join("\n\n\n");
    }

    // ── DENSE DSL EXPORTER ────────────────────────────────────────────
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
                    let pId = globalDict.get(p.cleanNick) || `p${p.seat}`;
                    // v64 F5 (BUG-MUCK-MARKER): карты оппонента, слитые в открытую
                    // через утечку протокола (is_muck_leak), помечаются «!» перед
                    // кодом карт: :!As7d. Без маркера их невозможно отличить от
                    // добровольного шоудауна/показа при пост-обработке DSL.
                    let cardStr = '';
                    if (p.cards && p.cards !== 'xx xx') {
                        let cleanCards = p.cards.replace(/\s+/g, '');
                        cardStr = p.is_muck_leak ? `:!${cleanCards}` : `:${cleanCards}`;
                    }
                    let evalStr = p.eval_rank ? `:${p.eval_rank}` : '';
                    return `${p.seat}:${pId}:${p.stack_start}${cardStr}${evalStr}`;
                }).join('|');

                let boardCards = (h.board || '').trim().split(/\s+/).filter(Boolean);
                let boardStr = '';
                if (boardCards.length >= 3) boardStr += boardCards.slice(0, 3).join('');
                if (boardCards.length >= 4) boardStr += '/' + boardCards[3];
                if (boardCards.length >= 5) boardStr += '/' + boardCards[4];

                let dslStreetBets = {};
                let currentStreetIndex = 1;
                let actsParts = [];

                (h.timeline || []).forEach(item => {
                    if (['ANTE', 'SB', 'BB'].includes(item.action)) {
                        if (item.action === 'SB' || item.action === 'BB') {
                            dslStreetBets[item.seat] = item.amount;
                        }
                        return;
                    }

                    let itemStreetIndex = item.street === 'RIVER' ? 4 : (item.street === 'TURN' ? 3 : (item.street === 'FLOP' ? 2 : 1));
                    while (currentStreetIndex < itemStreetIndex) {
                        actsParts.push('/');
                        currentStreetIndex++;
                        dslStreetBets = {};
                    }

                    let prevBet = dslStreetBets[item.seat] || 0;
                    // v61 F4: engine-truth street total; legacy fallback for old data
                    let totalCommit = (item.street_bet_after !== undefined && item.street_bet_after !== null)
                        ? item.street_bet_after
                        : ((item.action === 'CALL') ? (prevBet + item.amount) : item.amount);
                    dslStreetBets[item.seat] = totalCommit;

                    let actCode = '';
                    if (item.action === 'FOLD') actCode = 'f';
                    else if (item.action === 'CHECK') actCode = 'k';
                    else if (item.action === 'CALL') actCode = `c${item.amount}`;
                    else if (item.action === 'BET') actCode = `b${totalCommit}`;
                    else if (item.action === 'RAISE' || item.action === 'ALLIN') actCode = `r${totalCommit}`;
                    else if (item.action === 'UNCALLEDBET') actCode = `u${item.amount}`;
                    else actCode = item.action.toLowerCase();

                    if (!actCode) return;
                    let tStr = (item.time_sec !== null && item.time_sec !== undefined) ? `(${item.time_sec})` : '';
                    actsParts.push(`p${item.seat}.${actCode}${tStr}`);
                });

                let isAllInShowdown = (h.players || []).some(p => p.cards && p.cards !== 'xx xx');
                if (isAllInShowdown) {
                    let maxBoardStreetIndex = boardCards.length >= 5 ? 4 : (boardCards.length >= 4 ? 3 : (boardCards.length >= 3 ? 2 : 1));
                    while (currentStreetIndex < maxBoardStreetIndex) {
                        actsParts.push('/');
                        currentStreetIndex++;
                    }
                }

                let acts = actsParts.join('');

                let winParts = (h.winners || []).map(w => {
                    let wp = (h.players || []).find(p => p.seat === w.seat);
                    let pId = wp ? (globalDict.get(wp.cleanNick) || `p${w.seat}`) : `p${w.seat}`;
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
        let fullHands = state.completedHandsArchive.filter(h => h.tracking === 'full');
        if (fullHands.length === 0) {
            alert('Нет полных валидных раздач для GTO экспорта!');
            return;
        }
        let txt = convertHandsToPokerStarsHH(fullHands);
        let blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = `PokerStars_GTO_v640_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // v61 F1 (BUG-MEMORY): release the blob reference — the download has started.
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
    };

    window.__stalkerExportDSL = function() {
        let fullHands = state.completedHandsArchive.filter(h => h.tracking === 'full');
        if (fullHands.length === 0) {
            alert('Нет полных валидных раздач для Dense DSL экспорта!');
            return;
        }
        let dslText = convertHandsToDenseDSL(fullHands);
        let blob = new Blob([dslText], { type: 'text/plain;charset=utf-8' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = `Scalpel_Dense_AI_v640_${Date.now()}.dsl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // v61 F1 (BUG-MEMORY): release the blob reference — the download has started.
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
    };

    // ── ТОЧНЫЙ ЭКСПОРТ JSON ───────────────────────────────────────────
    window.__stalkerExportJSON = function() {
        try {
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
                let totalActs = p.totalActions || (agg + pass);
                let afq = totalActs > 0 ? parseFloat(((agg / totalActs) * 100).toFixed(1)) : 0;
                let af = pass > 0 ? parseFloat((agg / pass).toFixed(2)) : (agg > 0 ? 99.0 : 0.0);
                let vpip = p.handsCount > 0 ? parseFloat(((p.vpipCount / p.handsCount) * 100).toFixed(1)) : 0;
                let pfr = p.handsCount > 0 ? parseFloat(((p.pfrCount / p.handsCount) * 100).toFixed(1)) : 0;

                exportData.players[cleanNick] = {
                    cleanNick: p.cleanNick,
                    handsCount: p.handsCount,
                    sitOutHandsCount: p.sitOutHandsCount,
                    vpip: vpip,
                    pfr: pfr,
                    af: af,
                    afq: afq,
                    stealFacedBB: p.stealFacedBB || 0,
                    stealFacedSB: p.stealFacedSB || 0,
                    // v62 B3: знаменатели и проценты fold-to-steal
                    stealFacedBBOpp: p.stealFacedBBOpp || 0,
                    stealFacedSBOpp: p.stealFacedSBOpp || 0,
                    foldToStealBBPct: (p.stealFacedBBOpp || 0) > 0 ? parseFloat(((p.stealFacedBB || 0) / (p.stealFacedBBOpp || 1) * 100).toFixed(1)) : 0,
                    foldToStealSBPct: (p.stealFacedSBOpp || 0) > 0 ? parseFloat(((p.stealFacedSB || 0) / (p.stealFacedSBOpp || 1) * 100).toFixed(1)) : 0,
                    entries: Array.from(p.entries.values())
                };
            });

            let blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = `pokerdom_v64_0_omni_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // v61 F1 (BUG-MEMORY): release the blob reference — the download has started.
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 10000);
        } catch (e) {
            alert('Ошибка экспорта: ' + e.message);
        }
    };

    // ── ГРАФИЧЕСКИЙ ИНТЕРФЕЙС HUD ─────────────────────────────────────
    let ui = document.createElement('div');
    ui.id = 'stalker-hud-v640';
    ui.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);width:95vw;max-width:470px;z-index:999999999;background:rgba(10,15,25,0.98);color:#fff;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;padding:10px 12px;border-radius:10px;border:2px solid #06b6d4;box-shadow:0 12px 40px rgba(0,0,0,0.95);backdrop-filter:blur(12px);box-sizing:border-box;';
    
    ui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span style="color:#06b6d4;font-size:13px;">🎯</span>
                <strong style="color:#06b6d4;font-size:12px;">SCALPEL v64.0 APEX-IMPERATOR</strong>
                <small id="st-hf-status" style="font-size:9px;margin-left:4px;color:#94a3b8;">HF: Иниц...</small>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <button id="btn-force-scan" style="background:#0891b2;border:none;color:#fff;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:4px;font-weight:bold;">🔄 Скан</button>
                <button id="btn-toggle-hud" style="background:transparent;border:1px solid #475569;color:#06b6d4;cursor:pointer;font-size:11px;padding:1px 6px;border-radius:4px;">▾</button>
                <button onclick="window.__SCALPEL.destroy();" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:0 2px;">✕</button>
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
        state.isCollapsed = !state.isCollapsed;
        let body = document.getElementById('st-hud-body');
        body.style.display = state.isCollapsed ? 'none' : 'block';
        this.innerText = state.isCollapsed ? '▴' : '▾';
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
            state.stalkedPlayers.forEach(p => {
                let hasActive = Array.from(p.entries.values()).some(e => 
                    !e.isBusted && (e.stack || 0) > 0 && (!e.tournId || state.liveTournaments.has(e.tournId))
                );
                if (hasActive) activeTargets++;
            });

            countEl.innerText = `${state.stalkedPlayers.size} (в игре: ${activeTargets})`;
            if (tournsEl) tournsEl.innerText = state.liveTournaments.size;
            
            let openSpectators = Array.from(state.backgroundTableSockets.values()).filter(ws => ws && ws.readyState === WebSocket.OPEN).length;
            if (specEl) specEl.innerText = `${openSpectators} столов в фоне`;
            
            if (handsEl) handsEl.innerHTML = `Раздач: <b>${state.completedHandsArchive.length}</b>`;

            if (state.stalkedPlayers.size > 0) {
                let html = '';
                state.stalkedPlayers.forEach((p) => {
                    let agg = p.aggressiveActions || 0;
                    let pass = p.passiveActions || 0;
                    let totalActs = p.totalActions || (agg + pass);
                    let afq = totalActs > 0 ? Math.round((agg / totalActs) * 100) : 0;
                    let afStr = pass > 0 ? (agg / pass).toFixed(1) : (agg > 0 ? '99.0' : '0.0');
                    let vpip = p.handsCount > 0 ? Math.round((p.vpipCount / p.handsCount) * 100) : 0;
                    let pfr = p.handsCount > 0 ? Math.round((p.pfrCount / p.handsCount) * 100) : 0;
                    
                    let statsStr = p.handsCount > 0 
                        ? `<small style="color:#38bdf8;font-weight:bold;margin-left:4px;">[H:${p.handsCount}${p.sitOutHandsCount > 0 ? `+${p.sitOutHandsCount}AFK` : ''} V:${vpip}% P:${pfr}% AF:${afStr} AFq:${afq}%]</small>` 
                        : `<small style="color:#64748b;margin-left:4px;">[Поиск рук...]</small>`;

                    html += `<div style="border-bottom:1px solid #1e293b;padding:4px 0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:#fde047;">🎯 <b>${escapeHtml(p.cleanNick)}</b> ${statsStr}</span>
                        </div>`;

                    p.entries.forEach(e => {
                        let chipsStr = formatChips(e.stack);
                        let isTournLive = !e.tournId || state.liveTournaments.has(e.tournId);
                        let isActuallyBusted = e.isBusted || e.stack === 0 || !isTournLive;

                        let liveCtx = e.tableId ? state.activeTables.get(e.tableId) : null;
                        let liveBB = (liveCtx && liveCtx.getActiveHandBB() > 0) ? liveCtx.getActiveHandBB() : (e.currentBB || 500);
                        let realStackBB = (liveBB > 0 && e.stack > 0 && !isActuallyBusted) ? (Math.round((e.stack / liveBB) * 10) / 10) : 0;
                        let bbStr = (realStackBB > 0 && !isActuallyBusted) ? ` (${realStackBB} BB)` : '';
                        
                        let baseBuyin = e.baseBuyin || 0;
                        // v64 F3 (BUG-REBUY-BADGE): e.bullets парсится ТОЛЬКО из
                        // суффикса «#N» ника; лобби-строка нередко теряет суффикс
                        // (mike_scott → bullets=1), тогда реальные ре-энтри живут
                        // в e.rebuys, а готовая сумма — в e.spent (сканер уже
                        // посчитал max(bullets, rebuys+1) × baseBuyin). Прежний
                        // код при bullets=1 молча пропускал бейдж ребаев и
                        // рендерил только номинал.
                        let bulletCount = Math.max(e.bullets || 1, (e.rebuys || 0) + 1);
                        let totalSpent = e.spent || (bulletCount * baseBuyin);
                        let buyinBadge = '';
                        if (baseBuyin > 0) {
                            if (bulletCount > 1) {
                                buyinBadge = ` <span style="color:#a855f7;">[${formatRub(baseBuyin)}₽ (#${bulletCount}: ${formatRub(totalSpent)}₽)]</span>`;
                            } else {
                                buyinBadge = ` <span style="color:#a855f7;">[${formatRub(baseBuyin)}₽]</span>`;
                            }
                        }

                        if (isActuallyBusted) {
                            let prizeStr = '';
                            if (e.prize > 0) {
                                if (e.regular_prize > 0 && e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatRub(e.prize)}₽</b> <small style="color:#94a3b8;">(${formatRub(e.regular_prize)}₽ + ${formatRub(e.bounty_prize)}₽ KO)</small>`;
                                } else if (e.regular_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatRub(e.regular_prize)}₽</b> <small style="color:#94a3b8;">[Приз]</small>`;
                                } else if (e.bounty_prize > 0) {
                                    prizeStr = ` <b style="color:#22c55e;">+${formatRub(e.bounty_prize)}₽</b> <small style="color:#94a3b8;">[KO]</small>`;
                                }
                            }

                            let placeBadge = '';
                            if (e.place === 1) {
                                placeBadge = `<b style="color:#eab308;background:rgba(234,179,8,0.15);padding:1px 4px;border-radius:3px;">1 МЕСТО 🏆</b>`;
                            } else if (e.place > 0) {
                                placeBadge = `${e.place} место`;
                            }

                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#ef4444;padding-left:8px;opacity:0.85;">
                                <span><s>${escapeHtml(e.rawNick)}</s> <small style="color:#64748b;">${escapeHtml(e.tableName || 'MTT')}</small>${buyinBadge}</span>
                                <span>${placeBadge}${prizeStr} ${e.place === 1 ? '' : '[ВЫБЫЛ]'}</span>
                            </div>`;
                        } else {
                            html += `<div style="display:flex;justify-content:space-between;font-size:10px;padding-left:8px;color:#38bdf8;">
                                <span>🔹 <b>${escapeHtml(e.rawNick)}</b> <small style="color:#94a3b8;">${escapeHtml(e.tableName || 'MTT')}</small>${buyinBadge}</span>
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

    // ── СПЕКТАТОР СТОЛОВ ───────────────────────────────────────────────
    // v61 F2 (BUG-PLACEHOLDER): единственная точка освобождения фонового сокета стола.
    // Гасит отложенный spawn-таймер, heartbeat, закрывает сокет и вычищает карты.
    function releaseBackgroundSocket(tableId, keepContext) {
        let ws = state.backgroundTableSockets.get(tableId);
        if (!ws) return;
        if (ws.__spawnTimer) {
            clearTimeout(ws.__spawnTimer);
            ws.__spawnTimer = null;
        }
        if (ws.__heartbeatTimer) {
            clearInterval(ws.__heartbeatTimer);
            ws.__heartbeatTimer = null;
        }
        if (typeof ws.close === 'function') {
            try { ws.close(); } catch (e) {}
        }
        state.backgroundTableSockets.delete(tableId);
        if (!keepContext && !state.sockets.userTables.has(tableId)) {
            state.activeTables.delete(tableId);
        }
    }

    async function manageBackgroundSpectatorPool() {
        if (state.isDestroyed) return;
        let sid = state.auth.sessionId || autoDetectSessionId();
        let wsUrl = state.auth.wssUrl;
        if (!wsUrl || !sid) return;

        for (let [tableId, ws] of state.backgroundTableSockets.entries()) {
            let tableCtx = state.activeTables.get(tableId);
            if (!tableCtx) continue;
            if (tableCtx.hand !== null) continue;

            let tInfo = state.discoveredTargetTables.get(tableId);
            let isTableStillTargeted = tInfo && tInfo.targets && tInfo.targets.size > 0;
            let isUserActiveOnTable = state.sockets.userTables.has(tableId);

            if (!isTableStillTargeted || isUserActiveOnTable) {
                releaseBackgroundSocket(tableId, isUserActiveOnTable);
                logDebug("SOCKET_CLEANUP", `Стол ${tableId} освобожден`);
            }
        }

        let spawnDelay = 0;
        for (let [tableId, tInfo] of state.discoveredTargetTables.entries()) {
            if (!tInfo || !tInfo.targets || tInfo.targets.size === 0) continue;
            if (state.backgroundTableSockets.size >= MAX_BACKGROUND_TABLES) break;
            if (state.backgroundTableSockets.has(tableId) || state.sockets.userTables.has(tableId)) continue;

            let cd = state.socketCooldowns.get(tableId) || 0;
            if (Date.now() < cd) continue;

            // v61 F2: плейсхолдер с close() и трекингом spawn-таймера (раньше его
            // было невозможно отменить → утечка сокета после destroy/очистки).
            let placeholder = { readyState: 0, __isPlaceholder: true, close: function() {} };
            state.backgroundTableSockets.set(tableId, placeholder);

            placeholder.__spawnTimer = setTimeout(function() {
                try {
                    // generation guard: выполняемся только если наш плейсхолдер ещё актуален
                    if (state.backgroundTableSockets.get(tableId) !== placeholder) return;
                    if (state.sockets.userTables.has(tableId)) {
                        state.backgroundTableSockets.delete(tableId);
                        return;
                    }

                    let curTargetInfo = state.discoveredTargetTables.get(tableId);
                    if (!curTargetInfo || !curTargetInfo.targets || curTargetInfo.targets.size === 0) {
                        state.backgroundTableSockets.delete(tableId);
                        return;
                    }

                    // v61 UR-1 (ultrareview): tournId/sessionId берём из СВЕЖЕГО состояния,
                    // а не из замыкания tInfo — стол мог быть переоткрыт под другим турниром
                    // за время spawn-задержки (старый вариант привязывал контекст стола
                    // к неверному турниру → неверные уровни/имена в экспортированных руках).
                    let freshTournId = curTargetInfo.tournId;
                    let freshSid = state.auth.sessionId || sid;

                    let tableWs = new OrigWS(wsUrl);
                    tableWs.__isBackgroundSpectator = true;
                    tableWs.__tableId = tableId;
                    tableWs.__tableContext = new TableContext(tableId, freshTournId);
                    
                    window.__SCALPEL.hookSocket(tableWs, wsUrl);

                    state.backgroundTableSockets.set(tableId, tableWs);
                    state.activeTables.set(tableId, tableWs.__tableContext);

                    let firstTarget = Array.from(curTargetInfo.targets)[0] || 'targets';
                    logDebug("SOCKET_CONNECT", `Подключение к столу ${tableId} [Spectator] (${firstTarget})`);

                    tableWs.onopen = function() {
                        tableWs.send(`<EnterTable sessionId="${freshSid}" tableId="${tableId}" tournamentId="${freshTournId}" client="html5mobile" clientVersion="${state.auth.clientVersion}"/>`);
                        tableWs.send('<GetTableDetails/>');
                        tableWs.send('<JoinTable/>');

                        tableWs.__heartbeatTimer = setInterval(() => {
                            if (tableWs.readyState === WebSocket.OPEN) {
                                try { tableWs.send('<GetServerTime/>'); } catch(e) {}
                            }
                        }, 20000);
                    };

                    tableWs.onclose = function() {
                        releaseBackgroundSocket(tableId);
                        state.socketCooldowns.set(tableId, Date.now() + 15000);
                        updateHUD();
                    };

                    tableWs.onerror = function() {
                        try { tableWs.close(); } catch(err) {}
                    };
                } catch(err) {
                    state.backgroundTableSockets.delete(tableId);
                    state.socketCooldowns.set(tableId, Date.now() + 5000);
                }
            }, spawnDelay);

            spawnDelay += (80 + Math.random() * 50);
        }
        updateHUD();
    }

    let timerPool = setInterval(manageBackgroundSpectatorPool, 2500);
    state.timerIds.push(timerPool);

    function triggerLobbyTournamentRefresh() {
        let lobbyWs = state.sockets.lobby;
        if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
            try {
                lobbyWs.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>');
            } catch(e) {}
        }
    }

    async function dispatchParallelScanner() {
        if (state.isScanningActive || state.scannerQueue.length === 0) return;
        let sid = state.auth.sessionId || autoDetectSessionId();
        let wsUrl = state.auth.wssUrl;
        if (!wsUrl || !sid) return;

        state.isScanningActive = true;

        try {
            while (state.scannerQueue.length > 0) {
                let chunk = [];
                while (chunk.length < SCANNER_CONCURRENCY && state.scannerQueue.length > 0) {
                    let tId = state.scannerQueue.shift();
                    state.scannerQueued.delete(tId);
                    if (tId !== state.userViewingTournId) chunk.push(tId);
                }

                if (chunk.length > 0) {
                    await Promise.allSettled(chunk.map(tId => scanSingleTournamentBackground(tId, wsUrl, sid)));
                    await new Promise(r => setTimeout(r, 60));
                }
            }
        } finally {
            state.isScanningActive = false;
            updateHUD();
        }
    }

    function scanSingleTournamentBackground(tournId, wsUrl, sid) {
        return new Promise((resolve) => {
            let tourn = state.liveTournaments.get(tournId);
            let bgWs = new OrigWS(wsUrl);
            bgWs.__isBackgroundSpectator = true;
            let finished = false;
            let currentLevel = (tourn && tourn.currentLevel) ? tourn.currentLevel : 1;
            let levelMap = new Map();
            let dynamicTimeout = null;

            let scheduleLoaded = false;
            let pendingPlayersChunks = [];

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
                bgWs.send(`<EnterTournamentLobby id="${tournId}" sessionId="${sid}" client="html5mobile" clientFace="pokerdom" clientVersion="${state.auth.clientVersion}"/>`);
                bgWs.send('<GetSchedule/>');
                bgWs.send('<GetPlayers offset="0" count="50"/>');
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

                let tMeta = state.tournamentCache.get(tournId) || { name: tourn ? tourn.name : 'MTT', baseBuyin: 0 };

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
                        let isBusted = (place > 0) || (stack === 0);
                        let stackBB = (currentBB > 0 && stack > 0) ? (Math.round((stack / currentBB) * 10) / 10) : 0;

                        let p = getOrCreatePlayerProfile(cleanNick);
                        // v62 B1: записи профиля ключуются по cleanNick — суффикс #N
                        // меняется при ребае (Vasya → Vasya #2) и в v60/v61 рвал цепочку
                        // очистки: existingEntry становился undefined и старый стол
                        // никогда не чистился. rawNick остаётся полем записи.
                        let entryKey = `${tournId}_${cleanNick}`;
                        let existingEntry = p.entries.get(entryKey);
                        let isNewEntry = !existingEntry;
                        let statusChanged = existingEntry && (existingEntry.isBusted !== isBusted);

                        let serverSpent = fattr(attrs, 'spent');
                        let serverRebuys = (existingEntry && existingEntry.rebuys !== undefined) ? existingEntry.rebuys : Math.max(0, bullets - 1);
                        // v62 B4: детерминированное значение — первичный источник.
                        // Семантика лоббийного атрибута `spent` не документирована
                        // (наблюдались 370₽/414₽, не кратные цене входа), поэтому
                        // серверная цифра сохраняется отдельным полем spent_server
                        // для аудита и служит фолбэком только при промахе кэша
                        // турнира (baseBuyin неизвестен), чтобы цель не рапортовала 0₽.
                        let bulletCount = Math.max(bullets, serverRebuys + 1);
                        let totalSpent = (tMeta.baseBuyin > 0) ? (bulletCount * tMeta.baseBuyin) : (serverSpent > 0 ? serverSpent : 0);

                        // v62 B1: чистим СТАРЫЙ стол даже когда строка лобби не несёт
                        // tableId — так выглядят строки выбывших (стол уже не назначен).
                        // В v60/v61 оба guard'а требовали truthy tableId: устаревшая цель
                        // навсегда оставалась в discoveredTargetTables, и «зомби»-
                        // спектатор держал слот 80-столового пула весь турнир.
                        // Активная строка с транзиентно потерянным tableId НЕ чистится
                        // (иначе churn: освобождение/respawn сокета стола).
                        let oldTableId = existingEntry ? existingEntry.tableId : null;
                        if (oldTableId && (isBusted || (tableId && oldTableId !== tableId))) {
                            let oldEntry = state.discoveredTargetTables.get(oldTableId);
                            if (oldEntry && oldEntry.targets) {
                                oldEntry.targets.delete(cleanNick);
                                if (oldEntry.targets.size === 0) {
                                    state.discoveredTargetTables.delete(oldTableId);
                                }
                            }
                        }

                        // v62 B1: регистрируем цель только когда она реально в игре.
                        if (tableId && stack > 0 && !isBusted) {
                            if (!state.discoveredTargetTables.has(tableId)) {
                                state.discoveredTargetTables.set(tableId, { tournId: tournId, targets: new Set() });
                            }
                            state.discoveredTargetTables.get(tableId).targets.add(cleanNick);
                        }

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
                            rebuys: serverRebuys,
                            regular_prize: regPrize,
                            bounty_prize: bountyPrize,
                            prize: totalPrize,
                            isBusted: isBusted,
                            tableName: tMeta.name,
                            tournId: tournId,
                            baseBuyin: tMeta.baseBuyin,
                            spent: totalSpent,
                            spent_server: serverSpent > 0 ? serverSpent : null
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

                let anyLvl = iattr(text, 'currentLevel') || iattr(text, 'level');
                if (anyLvl && anyLvl > currentLevel) {
                    currentLevel = anyLvl;
                    if (tourn) tourn.currentLevel = anyLvl;
                    if (levelMap.has(currentLevel) && tourn) {
                        tourn.currentBB = levelMap.get(currentLevel);
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

                    while (pendingPlayersChunks.length > 0) {
                        processPlayerBlocks(pendingPlayersChunks.shift());
                    }
                }

                if (text.includes('<Players')) {
                    if (scheduleLoaded) {
                        processPlayerBlocks(text);
                    } else {
                        pendingPlayersChunks.push(text);
                    }
                }
            };
            bgWs.onerror = cleanup;
            bgWs.onclose = cleanup;
        });
    }

    window.__SCALPEL.handleIncoming = function(ws, xml) {
        if (state.isDestroyed) return;
        if (!xml || typeof xml !== 'string') return;
        xml = xml.trim();
        if (!xml.startsWith('<')) return;

        try {
            if (!ws.__isBackgroundSpectator) {
                let sessMatch = xml.match(/\bsessionId="([^"]+)"/);
                if (sessMatch && sessMatch[1]) state.auth.sessionId = sessMatch[1];
            }

            let versMatch = xml.match(/\bclientVersion="([^"]+)"/);
            if (versMatch) state.auth.clientVersion = versMatch[1];

            // v61 F3 (BUG-CHAT): чат обрабатывается до guard'а таблицы (ловится и на
            // лобби-сокете), поддерживаются обе формы тега и ВСЕ сообщения в кадре.
            {
                let chatRegex = /<ChatMessage\s+([^>]*?)\/>|<ChatMessage\s+([^>]*?)>([\s\S]*?)<\/ChatMessage>/g;
                let chatM;
                while ((chatM = chatRegex.exec(xml)) !== null) {
                    let cAttr = (chatM[1] !== undefined) ? chatM[1] : (chatM[2] || '');
                    let sender = attr(cAttr, 'from');
                    let text = attr(cAttr, 'text');

                    if (sender && text && !/Dealer|Дилер|Система/i.test(sender) && !SYSTEM_CHAT_REGEX.test(text)) {
                        let cleanSender = getCleanNick(sender);
                        state.chatLogs.push({
                            timestamp: new Date().toISOString(),
                            tournament_name: (ws.__tableContext ? ws.__tableContext.getTournamentMeta().name : 'MTT'),
                            table_id: ws.__tableId || 'unknown',
                            nick: sender,
                            cleanNick: cleanSender,
                            is_target: TARGET_WATCHLIST.has(cleanSender),
                            message: decodeHtml(text)
                        });
                        // v61 F7: чат ограничен по объёму (раньше рос бесконечно)
                        if (state.chatLogs.length > MAX_CHAT_LOGS) state.chatLogs.shift();
                    }
                }
            }

            if (xml.includes('<TableClosed') || xml.includes('Table closed') || xml.includes('Стол расформирован')) {
                let tableId = ws.__tableId || attr(xml, 'tableId') || attr(xml, 'id');
                if (tableId) {
                    state.discoveredTargetTables.delete(tableId);
                    releaseBackgroundSocket(tableId);
                    state.activeTables.delete(tableId);
                }
            }

            if (xml.includes('<Tournaments') || xml.includes('<LobbyInfo') || xml.includes('<ServerInfo')) {
                ws.__socketType = 'LOBBY';
                if (!state.sockets.lobby || state.sockets.lobby.readyState !== WebSocket.OPEN) {
                    state.sockets.lobby = ws;
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

                    // v64 F1 (BUG-BUYIN-DISTORTION): лобби PKO присылает ТРИ
                    // раздельных атрибута: buyIn — доля в основной призовой фонд,
                    // knockoutBounty — доля в баунти-фонде, fee — рейк рума.
                    // Эвристика v60–v63 (rawBuyin <= bounty+fee+10 ⇒ «buyIn уже
                    // включает bounty и fee») втягивала рейк в номинал бай-ина:
                    // 2500 + 2500 + 400 кэшировалось как baseBuyin=5400₽,
                    // 1250+1250+200 — как 2700₽, 500+500+80 — как 1080₽.
                    // Номинальный бай-ин (взнос в призовой фонд) = buyIn + bounty
                    // БЕЗ рейка; полный вход (с рейком) хранится отдельно в
                    // entryCost — для аудита и отображения полной цены.
                    let nominalBuyin = rawBuyin + bounty;      // взнос в призовой фонд
                    let totalEntryCost = nominalBuyin + fee;   // полный вход с рейком

                    if (tId && tName) {
                        state.tournamentCache.set(tId, {
                            name: decodeHtml(tName),
                            baseBuyin: nominalBuyin,
                            bounty: bounty,
                            fee: fee,
                            entryCost: totalEntryCost,
                            isPKO: bounty > 0 || /нокаут|bounty|pko/i.test(tName)
                        });
                    }

                    let isHoldem = tGame.includes('TEXAS_HOLDEM') || tGame.includes('HOLDEM') || (!tGame.includes('OMAHA') && !tGame.includes('PINEAPPLE') && !tName.toLowerCase().includes('омаха') && !tName.toLowerCase().includes('ананас'));
                    let isLiveRunning = LIVE_STATUSES.has(tStatus);

                    if (isHoldem && tId && isLiveRunning) {
                        currentLiveIds.add(tId);
                        if (!state.liveTournaments.has(tId)) {
                            state.liveTournaments.set(tId, { id: tId, name: decodeHtml(tName) || 'MTT', status: tStatus, currentBB: 500, currentLevel: 1, lastSeen: Date.now() });
                        } else {
                            let item = state.liveTournaments.get(tId);
                            item.status = tStatus;
                            item.lastSeen = Date.now();
                            if (tName) item.name = decodeHtml(tName);
                        }
                        // v61 F7 (BUG-SCANNER-QUEUE): O(1) дедупликация + ограничение длины
                        if (!state.scannerQueued.has(tId)) {
                            state.scannerQueued.add(tId);
                            state.scannerQueue.push(tId);
                            if (state.scannerQueue.length > MAX_SCANNER_QUEUE) {
                                let droppedT = state.scannerQueue.shift();
                                state.scannerQueued.delete(droppedT);
                            }
                        }
                    } else if (tId && (tStatus === 'COMPLETED' || tStatus === 'CANCELED')) {
                        state.liveTournaments.delete(tId);
                    }
                }

                for (let [tableId, tInfo] of state.discoveredTargetTables.entries()) {
                    if (tInfo.tournId && !currentLiveIds.has(tInfo.tournId)) {
                        state.discoveredTargetTables.delete(tableId);
                    }
                }

                dispatchParallelScanner();
                updateHUD();
            }

            if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
                let tableId = attr(xml, 'id') || attr(xml, 'tableId');
                let tournId = attr(xml, 'tournamentId') || attr(xml, 'tournId');
                let tName = attr(xml, 'tournamentName') || attr(xml, 'name');
                if (tournId && tName && !state.tournamentCache.has(tournId)) {
                    state.tournamentCache.set(tournId, { name: decodeHtml(tName), baseBuyin: 0, isPKO: /нокаут|bounty|pko/i.test(tName) });
                }

                if (tableId) {
                    ws.__tableId = tableId;
                    if (!ws.__tableContext) {
                        ws.__tableContext = state.activeTables.get(tableId) || new TableContext(tableId, tournId);
                    }
                    if (tournId && !ws.__tableContext.tournId) ws.__tableContext.tournId = tournId;
                    state.activeTables.set(tableId, ws.__tableContext);
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
                let seatBlocksSeen = 0;
                for (let sb of seatBlocks) {
                    let seatAttrs = sb[1];
                    let seatNum = parseInt(sb[2], 10);
                    let seatContent = sb[3] || '';
                    seatBlocksSeen++;

                    // v61 F5 (BUG-SEATS): автокалибровка базы нумерации мест сервера.
                    // Место 0 существует → база 0; maxSeatId == кол-ву мест → база 1.
                    if (seatNum === 0) {
                        state.serverSeatBase = 0;
                        state.serverSeatBaseLocked = true;
                    }
                    if (seatNum > ctx.maxSeatId) ctx.maxSeatId = seatNum;

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
                        // v62 B1: ключ по cleanNick — синхронно со сканером, ребай-
                        // переименование (#N) не создаёт вторую запись и не теряет
                        // старый стол из очистки.
                        // v63 C9 (дубли записей): разрешение ключа в три шага —
                        // (1) прямой ключ tournId; (2) tournId ещё null → принимаем
                        // существующую запись этого ника на ЭТОМ столе под любым
                        // ключом (ключ сканера t1_… ИЛИ фолбэк 555_…) и обновляем её;
                        // (3) tournId опоздал → МИГРАЦИЯ записи из фолбэк-ключа
                        // tableId в канонический ключ tournId. v62 никогда не
                        // мигрировал: гонка «Seats раньше TableDetails» на
                        // пользовательском сокете рождала двойников 555_nick+t9_nick.
                        let entryKey = tournId ? `${tournId}_${s.cleanNick}` : null;
                        let entry = entryKey ? (p.entries.get(entryKey) || null) : null;
                        if (!entry) {
                            for (let [k, e] of p.entries) {
                                if (e.cleanNick === s.cleanNick && e.tableId === ctx.tableId) {
                                    entry = e;
                                    if (tournId && k !== entryKey) {
                                        p.entries.delete(k);   // миграция: убрать устаревший ключ
                                    } else {
                                        entryKey = k;          // tournId ещё нет — обновляем под старым ключом
                                    }
                                    break;
                                }
                            }
                            if (!entry) {
                                entryKey = tournId ? `${tournId}_${s.cleanNick}` : `${ctx.tableId}_${s.cleanNick}`;
                            }
                        }
                        let bullets = parseBulletNumber(rawNick);
                        let baseBuyin = ctx.getTournamentMeta().baseBuyin;

                        if (!entry) {
                            entry = {
                                rawNick: rawNick,
                                cleanNick: s.cleanNick,
                                tableName: ctx.getTournamentMeta().name,
                                baseBuyin: baseBuyin
                            };
                        }
                        
                        if (!entry.isBusted || entry.place === 0) {
                            if (serverStack !== null) entry.stack = serverStack;
                            entry.tournId = tournId;
                            entry.tableId = ctx.tableId;
                            entry.isBusted = (entry.stack === 0);
                            entry.bullets = bullets;
                            entry.rebuys = Math.max(0, bullets - 1);
                            // v62 B4: та же формула, что и в сканере/экспорте —
                            // детерминированные bullets × baseBuyin; серверное
                            // значение — аудит + фолбэк при неизвестном baseBuyin.
                            let bulletCount = Math.max(bullets, (entry.rebuys || 0) + 1);
                            entry.spent = (baseBuyin > 0) ? (bulletCount * baseBuyin) : (serverSpent > 0 ? serverSpent : (entry.spent || 0));
                            entry.spent_server = serverSpent > 0 ? serverSpent : (entry.spent_server || null);
                            entry.baseBuyin = baseBuyin || entry.baseBuyin;
                            entry.tableName = ctx.getTournamentMeta().name;
                            p.entries.set(entryKey, entry);
                            updateHUD();
                        }
                    }
                }
                // v61 F5: фиксируем наблюдаемое число мест стола
                if (seatBlocksSeen > ctx.observedSeatCount) ctx.observedSeatCount = seatBlocksSeen;
                if (!state.serverSeatBaseLocked && ctx.observedSeatCount > 1 && ctx.maxSeatId === ctx.observedSeatCount) {
                    state.serverSeatBase = 1;
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

                // v62 B2 (BUG-STREET-DESYNC): разбор кадра в порядке документа
                // (streaming). Сервер может склеить в один кадр действие и сдачу
                // следующей улицы в ЛЮБОМ порядке. v61 применял updateBoardFromXml
                // ДО всех действий: кадры «действие → сдача» портились (флоп-колл
                // становился TURN_CALL, у префлоп-колла терялся VPIP, улица
                // «загрязнялась» чужими ставками); глобальный перенос «сначала все
                // действия» ломает зеркальные кадры «сдача → действие» (доказано
                // на патч-копии в раунде-2). Корректно применять события по мере их
                // появления в XML: действия — при текущей улице, сдачу — сразу на
                // месте. Одиночные кадры без склейки не меняют поведение (эквивалентно
                // старому порядку). Отдельные парсеры (чат, Winners, KO) не затронуты.
                let EVENT_RE = /<PlayerAction\s+seat="(\d+)"([^>]*)>([\s\S]*?)<\/PlayerAction>|<(DealingFlop|DealingTurn|DealingRiver)>[\s\S]*?<\/\4>|<Board>[\s\S]*?<\/Board>/gi;
                let am;
                while ((am = EVENT_RE.exec(xml)) !== null) {
                    // событие сдачи/борда — применяем на месте, улица меняется здесь
                    if (am[1] === undefined) {
                        ctx.updateBoardFromXml(am[0]);
                        continue;
                    }
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
                    // v61 F8: максимум банка ДО действия — для корректной классификации
                    // агрессивных all-in (короткий all-in-рейз и 3-бет all-in считались
                    // коллами в v60 → занижались PFR/AGG).
                    let preActionMaxBet = ctx.currentMaxBet;
                    // v62 B3: фиксируем состояние «против кражи» ДО действия: рейз самого
                    // игрока (3-бет блайндом против кражи) — уже ответ на кражу, поэтому
                    // снимаем показания до того, как recordAction обновит трекер.
                    let facedStealPreflop = (ctx.street === 'PREFLOP') && (ctx.preflopRaises === 1) && ctx.preflopStealAttempt;

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
                        let isPreflop = (ctx.street === 'PREFLOP');
                        let playerPos = ctx.positions[seatNum] || '';
                        // v61 F8: all-in агрессивен, если ПОСЛЕ действия ставка игрока
                        // превышает максимум банка ДО действия
                        let isAggressiveAllIn = (kind === 'AllIn') && ((ctx.streetBetsPerSeat.get(seatNum) || 0) > preActionMaxBet);

                        let pStats = ctx.handPendingStats.get(seatNum) || { vpip: false, pfr: false, agg: 0, pass: 0, tot: 0, stealBB: 0, stealSB: 0, stealBBOpp: 0, stealSBOpp: 0 };

                        // v62 B3: знаменатель — «слепой встретил попытку кражи» (один
                        // раз за руку): и фолды, и защиты (колл/3-бет) считаются
                        // возможностями fold-to-steal. Блайнд-посты не считаются:
                        // на момент поста рейзов еще нет.
                        if (facedStealPreflop && (playerPos === 'BB' || playerPos.includes('SB'))) {
                            if (playerPos === 'BB') pStats.stealBBOpp = 1;
                            else pStats.stealSBOpp = 1;
                        }

                        if (kind === 'Call' || (kind === 'AllIn' && !isAggressiveAllIn)) {
                            if (isPreflop) {
                                pStats.vpip = true;
                            } else {
                                pStats.pass++;
                                pStats.tot++;
                            }
                        } else if (kind === 'Raise' || kind === 'Bet' || isAggressiveAllIn) {
                            if (isPreflop) {
                                pStats.vpip = true;
                                pStats.pfr = true;
                            } else {
                                pStats.agg++;
                                pStats.tot++;
                            }
                        } else if (kind === 'Check') {
                            if (!isPreflop) {
                                pStats.tot++;
                            }
                        } else if (kind === 'Fold') {
                            if (isPreflop) {
                                // v62 B3: фолд в блайндах считается fold-to-steal
                                // ТОЛЬКО против реальной попытки кражи (единственный
                                // префлоп-рейз от CO/BTN/SB). В v60/v61 любой префлоп-
                                // фолд блайнда инкрементировал счётчик — фолд против
                                // UTG-опена или 3-бета тоже, метрика была «префлоп-
                                // фолды в блайндах» под чужим именем.
                                if (facedStealPreflop) {
                                    if (playerPos === 'BB') pStats.stealBB++;
                                    else if (playerPos.includes('SB')) pStats.stealSB++;
                                }
                            } else {
                                pStats.tot++;
                            }
                        }
                        ctx.handPendingStats.set(seatNum, pStats);
                    }
                }

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
                    if (finalizedHand) {
                        // v61 F8: дедупликация по (стол + номер руки) — номера рук у
                        // разных столов совпадают, в v60 это молча отбрасывало валидные раздачи
                        let dedupKey = `${finalizedHand.table_id}#${finalizedHand.hand_number}`;
                        if (!state.recordedHandNumbers.has(dedupKey)) {
                            state.recordedHandNumbers.add(dedupKey);
                            state.completedHandsArchive.push(finalizedHand);
                            if (state.completedHandsArchive.length > MAX_ARCHIVE_HANDS) {
                                let removed = state.completedHandsArchive.shift();
                                state.recordedHandNumbers.delete(`${removed.table_id}#${removed.hand_number}`);
                            }
                            updateHUD();
                        }
                    }
                    ctx.hand = null;
                }
            }
        } catch(e) {
            console.error("XML Stream Error:", e);
        }
    };

    window.__SCALPEL.handleOutgoing = function(ws, data) {
        if (state.isDestroyed) return;
        decodeSocketPayload(data).then(text => {
            if (state.isDestroyed) return;
            if (!text || typeof text !== 'string') return;
            
            if (!ws.__isBackgroundSpectator) {
                let sessMatch = text.match(/\bsessionId="([^"]+)"/);
                if (sessMatch && sessMatch[1]) state.auth.sessionId = sessMatch[1];
            } else {
                return;
            }

            if (text.includes('<EnterTournamentLobby')) {
                state.userViewingTournId = attr(text, 'id');
            } else if (text.includes('<EnterTable') || text.includes('<OpenTable')) {
                let tableId = attr(text, 'tableId') || attr(text, 'id');
                // ИСПРАВЛЕНИЕ 1: Устранен ReferenceError xml
                let tournId = attr(text, 'tournamentId') || attr(text, 'tournId');
                if (tableId) {
                    // v61 F2: освобождаем фоновый сокет стола (с отменой spawn-таймера)
                    releaseBackgroundSocket(tableId, true);

                    state.userViewingTableId = tableId;
                    state.sockets.userTables.set(tableId, ws);
                    ws.__tableId = tableId;
                    if (!state.activeTables.has(tableId)) {
                        ws.__tableContext = new TableContext(tableId, tournId);
                        state.activeTables.set(tableId, ws.__tableContext);
                    } else {
                        ws.__tableContext = state.activeTables.get(tableId);
                        if (tournId && !ws.__tableContext.tournId) ws.__tableContext.tournId = tournId;
                    }
                }
            }
        });
    };

    window.__SCALPEL.handleClose = function(ws) {
        if (state.isDestroyed) return;
        if (ws.__tableId) {
            state.sockets.userTables.delete(ws.__tableId);
            if (!state.backgroundTableSockets.has(ws.__tableId)) {
                state.activeTables.delete(ws.__tableId);
            }
        }
        if (ws === state.sockets.lobby) {
            state.sockets.lobby = null;
            for (let uWs of state.sockets.userTables.values()) {
                if (uWs && uWs.readyState === WebSocket.OPEN) {
                    state.sockets.lobby = uWs;
                    break;
                }
            }
        }
    };

    window.__SCALPEL.hookSocket = function(ws, explicitUrl) {
        if (!ws || ws.__scalpelHooked) return;
        ws.__scalpelHooked = true;

        let targetUrl = explicitUrl || ws.url || ws._url;
        if (targetUrl && typeof targetUrl === 'string' && (targetUrl.includes('/ws') || targetUrl.startsWith('ws'))) {
            state.auth.wssUrl = targetUrl;
        }

        let onOpenHandler = function() {
            if (state.isDestroyed) return;
            if (!ws.__isBackgroundSpectator && !ws.__tableId && !ws.__isTournamentLobby) {
                if (!state.sockets.lobby || state.sockets.lobby.readyState !== WebSocket.OPEN) {
                    state.sockets.lobby = ws;
                    try { ws.send('<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>'); } catch(e) {}
                }
            }
        };

        if (ws.readyState === WebSocket.OPEN) {
            onOpenHandler();
        } else {
            ws.addEventListener('open', onOpenHandler, { once: true });
        }

        ws.addEventListener('message', async function (e) {
            if (window.__SCALPEL && window.__SCALPEL.handleIncoming && !window.__SCALPEL.state.isDestroyed) {
                let text = await decodeSocketPayload(e.data);
                window.__SCALPEL.handleIncoming(ws, text);
            }
        });

        ws.addEventListener('close', function() {
            if (window.__SCALPEL && window.__SCALPEL.handleClose && !window.__SCALPEL.state.isDestroyed) {
                window.__SCALPEL.handleClose(ws);
            }
        });
    };

    window.__SCALPEL.destroy = function() {
        // v61 F8: флаг зомби-режима — все хуки перестают мутировать состояние
        state.isDestroyed = true;
        state.timerIds.forEach(id => clearInterval(id));
        // v61 F2: отменяем отложенные spawn-таймеры и закрываем все фоновые сокеты
        Array.from(state.backgroundTableSockets.keys()).forEach(tid => releaseBackgroundSocket(tid));
        state.backgroundTableSockets.clear();
        state.scannerQueue.length = 0;
        state.scannerQueued.clear();
        document.querySelectorAll('[id^="stalker-hud"]').forEach(el => el.remove());
        console.log("%c[SCALPEL] Инстанс v64.0 уничтожен.", "color:#f59e0b;");
    };

    // v61 F7: периодическое обслуживание состояния — очистка устаревших/растущих структур
    function performStateMaintenance() {
        let nowMs = Date.now();

        // турниры, которых больше нет в лобби (без явного COMPLETED/CANCELED)
        for (let [tid, tItem] of state.liveTournaments) {
            if (tItem.lastSeen && nowMs - tItem.lastSeen > STALE_TOURNAMENT_MS) {
                state.liveTournaments.delete(tid);
            }
        }

        // ограничение кэша турниров (вытесняем не-живые)
        if (state.tournamentCache.size > MAX_TOURNAMENT_CACHE) {
            let excess = state.tournamentCache.size - MAX_TOURNAMENT_CACHE;
            for (let tid of state.tournamentCache.keys()) {
                if (excess <= 0) break;
                if (!state.liveTournaments.has(tid)) {
                    state.tournamentCache.delete(tid);
                    excess--;
                }
            }
        }

        // истёкшие кулдауны сокетов
        for (let [tid, cd] of state.socketCooldowns) {
            if (nowMs >= cd) state.socketCooldowns.delete(tid);
        }
    }

    let timerQueue = setInterval(() => { processOutboxQueue(); performStateMaintenance(); }, 3000);
    state.timerIds.push(timerQueue);

    // ── v61 F6 (BUG-DEFLATE): ПОЛНЫЙ ДЕКОДЕР ПАКЕТОВ ─────────────────────────
    // Поддержка: plain UTF-8, gzip, zlib-deflate, RAW deflate (без заголовка).
    // Плюс корректная нарезка типизированных view (byteOffset/byteLength) и
    // чистый JS-inflate как fallback, если DecompressionStream недоступен.

    async function inflateViaStream(format, buffer) {
        if (typeof DecompressionStream === 'undefined') return null;
        let timerId = null;
        try {
            let ds = new DecompressionStream(format);
            let stream = new Response(buffer).body.pipeThrough(ds);
            let textPromise = new Response(stream).text();
            // v61 F6: стрим может зависнуть (наблюдалось в дикой природе) — гонка
            // с таймаутом гарантирует деградацию до синхронного JS-inflate.
            let guarded = textPromise.then(v => v, () => null);
            let timeoutPromise = new Promise(resolve => { timerId = setTimeout(() => resolve(null), 1500); });
            let result = await Promise.race([guarded, timeoutPromise]);
            if (timerId !== null) clearTimeout(timerId);
            return result;
        } catch (e) {
            if (timerId !== null) clearTimeout(timerId);
            return null;
        }
    }

    // Компактный inflate (алгоритм в стиле zlib "puff", public domain Mark Adler).
    // Возвращает массив байт или null при ошибке.
    function puffInflate(bytes, pos) {
        let bitbuf = 0, bitcnt = 0, out = [];
        function bits(need) {
            let val = bitbuf;
            while (bitcnt < need) {
                if (pos >= bytes.length) throw new Error('eof');
                val |= bytes[pos++] << bitcnt;
                bitcnt += 8;
            }
            bitbuf = val >>> need;
            bitcnt -= need;
            return val & ((1 << need) - 1);
        }
        function buildHuff(lengths) {
            let count = new Array(16).fill(0);
            for (let i = 0; i < lengths.length; i++) count[lengths[i]]++;
            count[0] = 0;
            let left = 1;
            for (let len = 1; len <= 15; len++) {
                left <<= 1;
                left -= count[len];
                if (left < 0) throw new Error('over');
            }
            let offs = new Array(16).fill(0);
            for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
            let symbol = new Array(lengths.length);
            for (let sym = 0; sym < lengths.length; sym++) {
                if (lengths[sym]) symbol[offs[lengths[sym]]++] = sym;
            }
            return { count: count, symbol: symbol };
        }
        function decodeSym(h) {
            let code = 0, first = 0, index = 0;
            for (let len = 1; len <= 15; len++) {
                code |= bits(1);
                let cnt = h.count[len];
                if (code - cnt < first) return h.symbol[index + (code - first)];
                index += cnt;
                first += cnt;
                first <<= 1;
                code <<= 1;
            }
            throw new Error('bad code');
        }
        const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
        const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
        const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
        const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
        function inflateBlock(lc, dc) {
            for (;;) {
                let sym = decodeSym(lc);
                if (sym === 256) return;
                if (sym < 256) out.push(sym);
                else {
                    sym -= 257;
                    let len = LBASE[sym] + bits(LEXT[sym]);
                    let dsym = decodeSym(dc);
                    let dist = DBASE[dsym] + bits(DEXT[dsym]);
                    let from = out.length - dist;
                    if (from < 0) throw new Error('bad dist');
                    for (let k = 0; k < len; k++) out.push(out[from++]);
                }
            }
        }
        let last, type;
        do {
            last = bits(1);
            type = bits(2);
            if (type === 0) {
                // stored block: выравниваемся по байту
                bitbuf = 0; bitcnt = 0;
                if (pos + 4 > bytes.length) throw new Error('eof');
                let len = bytes[pos] | (bytes[pos + 1] << 8);
                pos += 4;
                if (pos + len > bytes.length) throw new Error('eof');
                for (let i = 0; i < len; i++) out.push(bytes[pos++]);
            } else if (type === 1) {
                let lens = new Array(288);
                let i;
                for (i = 0; i < 144; i++) lens[i] = 8;
                for (; i < 256; i++) lens[i] = 9;
                for (; i < 280; i++) lens[i] = 7;
                for (; i < 288; i++) lens[i] = 8;
                let distLens = new Array(30).fill(5);
                inflateBlock(buildHuff(lens), buildHuff(distLens));
            } else if (type === 2) {
                let hlen = bits(5) + 257, hdist = bits(5) + 1, hcode = bits(4) + 4;
                let order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                let clLens = new Array(19).fill(0);
                for (let i = 0; i < hcode; i++) clLens[order[i]] = bits(3);
                let clHuff = buildHuff(clLens);
                let lens = new Array(hlen + hdist).fill(0);
                let i = 0;
                while (i < hlen + hdist) {
                    let sym = decodeSym(clHuff);
                    if (sym < 16) lens[i++] = sym;
                    else {
                        let rep = 0, val = 0;
                        if (sym === 16) { val = lens[i - 1]; rep = 3 + bits(2); }
                        else if (sym === 17) { rep = 3 + bits(3); }
                        else { rep = 11 + bits(7); }
                        while (rep-- && i < hlen + hdist) lens[i++] = val;
                    }
                }
                inflateBlock(buildHuff(lens.slice(0, hlen)), buildHuff(lens.slice(hlen)));
            } else {
                throw new Error('bad block');
            }
        } while (!last);
        return out;
    }

    // wrapper: 0 = raw, 2 = zlib, 3 = gzip. Возвращает строку или null.
    function inflateJS(uint8, wrapper) {
        try {
            let pos = 0;
            if (wrapper === 2) pos = 2;
            else if (wrapper === 3) {
                if (uint8.length < 18 || uint8[0] !== 0x1f || uint8[1] !== 0x8b || uint8[2] !== 8) return null;
                let flg = uint8[3];
                pos = 10;
                if (flg & 4) { let xl = uint8[pos] | (uint8[pos + 1] << 8); pos += 2 + xl; }
                if (flg & 8) { while (pos < uint8.length && uint8[pos]) pos++; pos++; }
                if (flg & 16) { while (pos < uint8.length && uint8[pos]) pos++; pos++; }
                if (flg & 2) pos += 2;
            }
            let out = puffInflate(uint8, pos);
            if (!out) return null;
            return new TextDecoder('utf-8').decode(new Uint8Array(out));
        } catch (e) {
            return null;
        }
    }

    async function decodeSocketPayload(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        try {
            let buffer;
            if (data instanceof ArrayBuffer) buffer = data;
            else if (typeof Blob !== 'undefined' && data instanceof Blob) buffer = await data.arrayBuffer();
            else if (ArrayBuffer.isView(data)) {
                // v61 F6: берем только видимый срез (раньше декодировался весь
                // базовый буфер — при byteOffset>0 приходил мусор)
                buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            }
            else return String(data);

            let uint8 = new Uint8Array(buffer);
            if (uint8.length === 0) return '';

            let isGzip = (uint8[0] === 0x1f && uint8[1] === 0x8b);
            let isZlib = (uint8.length > 1 && (uint8[0] & 0x0f) === 8 && (((uint8[0] << 8) | uint8[1]) % 31) === 0);

            if (isGzip || isZlib) {
                let viaStream = await inflateViaStream(isGzip ? 'gzip' : 'deflate', buffer);
                if (viaStream !== null) return viaStream;
                let js = inflateJS(uint8, isGzip ? 3 : 2);
                if (js !== null) return js;
                return '';
            }

            // обычный текст? (fatal: невалидный UTF-8 ⇒ вероятно сырой deflate)
            try {
                return new TextDecoder('utf-8', { fatal: true }).decode(uint8);
            } catch (e) {}

            // v61 F6 (BUG-DEFLATE): сырой deflate без заголовка — раньше не
            // поддерживался вообще и превращался в mojibake-мусор
            let viaStream = await inflateViaStream('deflate-raw', buffer);
            if (viaStream !== null) return viaStream;
            let js = inflateJS(uint8, 0);
            if (js !== null) return js;
            return '';
        } catch (e) {
            return String(data);
        }
    }

    // v61: отладочный доступ к декодеру (полезно для диагностики протокола)
    window.__SCALPEL.decodePayload = decodeSocketPayload;

    if (!window.__SCALPEL_WS_PROXY_INSTALLED) {
        window.__SCALPEL_WS_PROXY_INSTALLED = true;
        
        window.WebSocket = new Proxy(OrigWS, {
            construct: function(target, args) {
                let ws = Reflect.construct(target, args);
                if (window.__SCALPEL && window.__SCALPEL.hookSocket) {
                    window.__SCALPEL.hookSocket(ws, args[0]);
                }
                return ws;
            }
        });

        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(p => {
            if (OrigWS[p] !== undefined) window.WebSocket[p] = OrigWS[p];
        });

        const origSend = OrigWS.prototype.send;
        OrigWS.prototype.send = function(data) {
            if (window.__SCALPEL && !window.__SCALPEL.state.isDestroyed && window.__SCALPEL.hookSocket) {
                window.__SCALPEL.hookSocket(this);
            }

            let isTournamentLobbySocket = typeof data === 'string' && data.includes('<EnterTournamentLobby');
            let isTableSocket = this.__isBackgroundSpectator || this.__tableId || isTournamentLobbySocket || (typeof data === 'string' && (data.includes('<EnterTable') || data.includes('<OpenTable') || data.includes('<JoinTable') || data.includes('<PlayerAction')));

            // v61 F8: после destroy больше не инжектим GetTournaments в чужие сокеты
            let alive = window.__SCALPEL && !window.__SCALPEL.state.isDestroyed;
            if (alive && !isTableSocket && (!window.__SCALPEL.state.sockets.lobby || window.__SCALPEL.state.sockets.lobby.readyState !== WebSocket.OPEN)) {
                window.__SCALPEL.state.sockets.lobby = this;
                if (this.readyState === WebSocket.OPEN) {
                    try { origSend.call(this, '<GetTournaments tournament="SCHEDULED|LIVE" games="TEXAS_HOLDEM" id="99999"/>'); } catch(e) {}
                }
            }
            if (window.__SCALPEL && !window.__SCALPEL.state.isDestroyed && window.__SCALPEL.handleOutgoing) {
                window.__SCALPEL.handleOutgoing(this, data);
            }
            return origSend.apply(this, arguments);
        };
    }

    autoDetectSessionId();
    triggerLobbyTournamentRefresh();

    console.log("%c👑 [SCALPEL v64.0 APEX-IMPERATOR] Запущен. v60 + v61 F1–F8 + v62 B1–B4 + v63 C-раунд устранено; v64 — раунд-4: F1 номинал бай-ина = buyIn + bounty (рейк в entryCost), F2 amount = дельта во всех действиях (chip_conservation восстановлен), F3 бейдж ре-энтрий max(bullets, rebuys+1) из e.spent, F4 formatRub для денег, F5 маркер «!» утекших карт в DSL, F6 строка баунти в GTO SUMMARY; C7-агрессивность олл-ина переведена на итог улицы.", "color:#10b981;font-weight:bold;font-size:13px;");
})();

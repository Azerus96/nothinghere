javascript:(function(){
    if (window.__ofcGodEngineV84) {
        alert('🍍 OFC God Engine v8.4 (Autonomous Daemon) уже запущен!');
        return;
    }
    window.__ofcGodEngineV84 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE GOD ENGINE v8.4 — AUTONOMOUS LOBBY DAEMON
       • Persistent Dedicated Lobby: Own background socket never dies on window close
       • Auto-Reconnect Daemon: Automatic self-healing of lobby & table connections
       • Full Mid-Hand Extraction: 100% cards guaranteed from <GameState>
       • Local OFC Combinator: Evaluates combinations even if server packet was missed
       • Bounded Concurrency: Strict 16 ghost sockets limit
       ══════════════════════════════════════════════════════════════════ */

    const MAX_GHOST_SOCKETS = 16;
    const GHOST_TABLE_TIMEOUT_MS = 60000;

    window.OFC_DB = window.OFC_DB || {
        tables: new Map(),
        ghostSockets: new Map(),
        knownTournamentTables: new Map(),
        heroTables: new Set(),
        socketCooldowns: new Map(),
        dedicatedLobbyWs: null,
        hands: [],
        handIds: new Set(),
        selectedTournamentId: null,
        selectedTournamentName: 'Не выбран',
        heroNickname: 'Taisiya888',
        sessionId: null,
        deviceToken: null,
        wsUrl: null,
        fantasyStreaks: new Map(),
        playerNickCache: new Map(),
        lobbyPollTimer: null,
        tablePruneTimer: null
    };

    const DB = window.OFC_DB;

    try {
        let saved = sessionStorage.getItem('ofc_hands_backup_v84') || sessionStorage.getItem('ofc_hands_backup_v83');
        if (saved) {
            let parsed = JSON.parse(saved);
            DB.hands = parsed;
            parsed.forEach(h => DB.handIds.add(h.hand_id));
            console.log(`[OFC v8.4] Восстановлено ${DB.hands.length} раздач из кэша.`);
        }
    } catch(e) {}

    function saveToStorage() {
        try { sessionStorage.setItem('ofc_hands_backup_v84', JSON.stringify(DB.hands)); } catch(e) {}
    }

    function attr(xml, name) {
        if (!xml) return null;
        let m = xml.match(new RegExp(`(?:\\b|\\s)${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function iattr(xml, name, def = null) {
        let v = attr(xml, name);
        if (v === null || v === undefined) return def;
        let n = parseInt(v, 10);
        return isNaN(n) ? def : n;
    }

    function parseCards(xmlStr) {
        if (!xmlStr) return [];
        let res = [];
        let re = /<Card[^>]*>([^<]+)<\/Card>/gi;
        let m;
        while ((m = re.exec(xmlStr)) !== null) {
            res.push(m[1].trim());
        }
        return res;
    }

    /* ── БАЗОВЫЙ ОПРЕДЕЛИТЕЛЬ РОЯЛТИ И КОМБИНАЦИЙ (FALLBACK) ──────── */
    const CARD_ORDER = "23456789TJQKA";
    function getCardVal(c) {
        if (!c || c === 'xx') return -1;
        let r = c[0] === '1' ? 'T' : c[0].toUpperCase();
        return CARD_ORDER.indexOf(r);
    }

    function evaluateLocalRoyalty(frontCards) {
        if (!frontCards || frontCards.length < 3 || frontCards.some(c => c === 'xx')) return { name: '', royalty: 0 };
        let vals = frontCards.map(getCardVal).sort((a, b) => b - a);
        // Тройка
        if (vals[0] === vals[1] && vals[1] === vals[2]) {
            let rChar = CARD_ORDER[vals[0]];
            return { name: `Тройка, ${rChar}${rChar}${rChar}`, royalty: 10 + vals[0] };
        }
        // Пара
        if (vals[0] === vals[1] || vals[1] === vals[2] || vals[0] === vals[2]) {
            let pVal = (vals[0] === vals[1] || vals[0] === vals[2]) ? vals[0] : vals[1];
            let rChar = CARD_ORDER[pVal];
            let royalty = pVal >= 4 ? (pVal - 3) : 0; // 66=1, 77=2 ... AA=9
            return { name: `Пара, ${rChar}${rChar}`, royalty };
        }
        return { name: `Старшая карта, ${CARD_ORDER[vals[0]]}`, royalty: 0 };
    }

    /* ── СЕССИЯ СТОЛА ──────────────────────────────────────────────── */
    class TableSession {
        constructor(tableId) {
            this.tableId = tableId;
            this.tableName = 'Стол #' + String(tableId).slice(-4);
            this.tournamentName = DB.selectedTournamentName || 'OFC Pineapple';
            this.tournamentId = DB.selectedTournamentId || null;
            this.gameType = 'OFC_PINEAPPLE_OH';
            this.fantasyMode = 'UNLIMITED_PROGRESSIVE';
            this.pointScoreChips = 70000;
            this.heroSeat = null;
            this.isHeroTable = false;
            this.seats = new Map();
            this.hand = null;
            this.isOFC = true;
            this.lastActiveTime = Date.now();
            this.actionCounter = 0;
            this.seatTurnTimerStart = new Map();
        }

        updatePlayer(seat, nick, uuid = null, stack = null) {
            if (!nick || typeof nick !== 'string') return;
            let cleanNick = nick.trim();
            let cacheKey = `${this.tableId}_${seat}`;

            if (cleanNick.startsWith('Seat ') && DB.playerNickCache.has(cacheKey)) {
                cleanNick = DB.playerNickCache.get(cacheKey);
            } else if (!cleanNick.startsWith('Seat ')) {
                DB.playerNickCache.set(cacheKey, cleanNick);
            }

            let existing = this.seats.get(seat) || {};
            let currentStack = stack !== null ? stack : (existing.stack || 0);

            this.seats.set(seat, { seat, nickname: cleanNick, uuid, stack: currentStack });

            let isHeroNick = DB.heroNickname && cleanNick.toLowerCase() === DB.heroNickname.toLowerCase();
            if (isHeroNick) {
                this.heroSeat = seat;
                this.isHeroTable = true;
                DB.heroTables.add(this.tableId);
                if (DB.ghostSockets.has(this.tableId)) closeGhostSocket(this.tableId);
            }

            if (this.hand && this.hand.players) {
                let p = this.hand.players[seat];
                if (p) {
                    p.nickname = cleanNick;
                    if (isHeroNick || this.heroSeat === seat) {
                        p.is_hero = true;
                        this.hand.context.hero_seat = seat;
                    }
                    if (stack !== null && p.stack_start === 0) {
                        p.stack_start = stack;
                        p.stack_current = stack;
                    }
                }
            }
        }

        startHand(handId, dealer, gameNum = 1, gamesCount = 1) {
            if (!this.isOFC) return;
            let isFantasyRound = (gameNum > 1);
            let hasJokers = this.gameType.includes('JOKER') || (DB.selectedTournamentName && DB.selectedTournamentName.includes('Джокер'));
            this.actionCounter = 0;
            this.seatTurnTimerStart.clear();

            let activeSeatList = Array.from(this.seats.keys()).sort((a, b) => a - b);
            let dealerNick = (this.seats.get(dealer) || {}).nickname || `Seat ${dealer}`;

            let turnOrderNicks = [];
            if (activeSeatList.length > 0) {
                let dIdx = activeSeatList.indexOf(dealer);
                let startIdx = (dIdx !== -1) ? (dIdx + 1) % activeSeatList.length : 0;
                for (let i = 0; i < activeSeatList.length; i++) {
                    let s = activeSeatList[(startIdx + i) % activeSeatList.length];
                    turnOrderNicks.push((this.seats.get(s) || {}).nickname || `Seat ${s}`);
                }
            }

            this.hand = {
                hand_id: String(handId),
                timestamp: new Date().toISOString(),
                tournament: {
                    tournament_id: this.tournamentId,
                    tournament_name: this.tournamentName,
                    table_id: this.tableId,
                    table_name: this.tableName,
                    game_type: this.gameType,
                    fantasy_mode: this.fantasyMode,
                    has_jokers: hasJokers,
                    point_score_chips: this.pointScoreChips
                },
                context: {
                    dealer_seat: dealer,
                    dealer_nickname: dealerNick,
                    hero_seat: this.heroSeat,
                    is_fantasy_round: isFantasyRound,
                    game_round: gameNum,
                    total_rounds: gamesCount,
                    active_seats: activeSeatList,
                    turn_order: turnOrderNicks
                },
                action_timeline: [],
                players: {},
                showdowns: [],
                winners: [],
                bustouts: []
            };

            this.seats.forEach((p, s) => {
                let isHero = (s === this.heroSeat) || (DB.heroNickname && p.nickname && p.nickname.toLowerCase() === DB.heroNickname.toLowerCase());
                let streakKey = `${this.tableId}_${s}`;
                let currentStreak = DB.fantasyStreaks.get(streakKey) || 0;

                this.hand.players[s] = {
                    seat: s,
                    nickname: p.nickname || `Seat ${s}`,
                    is_hero: isHero,
                    is_dealer: (s === dealer),
                    stack_start: p.stack || 0,
                    stack_current: p.stack || 0,
                    stack_end: 0,
                    chips_delta: 0,
                    score_points: 0,
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    fantasy_streak: isFantasyRound ? Math.max(1, currentStreak) : 0,
                    qualified_for_next_fantasy: false,
                    is_foul: false,
                    is_busted: false,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 }
                };
            });
        }

        parseGameStateBoard(xml) {
            if (!this.hand) return;
            let seatBlocks = xml.matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>([\s\S]*?)<\/Seat>/gi);
            for (let sb of seatBlocks) {
                let sId = parseInt(sb[1], 10);
                let sBody = sb[2];
                let p = this.getPlayer(sId);
                if (!p) continue;

                let stackM = sBody.match(/stack-size="(\d+)"/i);
                if (stackM) {
                    let st = parseInt(stackM[1], 10);
                    if (p.stack_start === 0) p.stack_start = st;
                    p.stack_current = st;
                }

                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rM = sBody.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"[^>]*?>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rM) {
                        let cards = parseCards(rM[1]);
                        let rowKey = row.toLowerCase();
                        let realCards = cards.filter(c => c !== 'xx');
                        if (realCards.length > 0) {
                            realCards.forEach(c => {
                                if (!p.final_board[rowKey].includes(c)) p.final_board[rowKey].push(c);
                            });
                        }
                    }
                });

                // Fallback авто-оценка Front, если CombinationChange не пришёл
                if (!p.combinations.front && p.final_board.front.length === 3) {
                    let ev = evaluateLocalRoyalty(p.final_board.front);
                    p.combinations.front = ev.name;
                    if (p.royalties.front === 0) p.royalties.front = ev.royalty;
                }
            }
        }

        getPlayer(seat) {
            if (!this.hand) return null;
            if (!this.hand.players[seat]) {
                let p = this.seats.get(seat) || { nickname: `Seat ${seat}`, stack: 0 };
                let isHero = (seat === this.heroSeat) || (DB.heroNickname && p.nickname && p.nickname.toLowerCase() === DB.heroNickname.toLowerCase());
                this.hand.players[seat] = {
                    seat: seat,
                    nickname: p.nickname,
                    is_hero: isHero,
                    is_dealer: (seat === this.hand.context.dealer_seat),
                    stack_start: p.stack || 0,
                    stack_current: p.stack || 0,
                    stack_end: 0,
                    chips_delta: 0,
                    score_points: 0,
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    fantasy_streak: 0,
                    qualified_for_next_fantasy: false,
                    is_foul: false,
                    is_busted: false,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 }
                };
            }
            return this.hand.players[seat];
        }

        finalize() {
            if (!this.hand || !this.hand.hand_id || !this.isOFC) {
                this.hand = null;
                return;
            }
            let h = this.hand;

            let hasValidData = h.showdowns.length > 0 || Object.values(h.players).some(p => 
                p.final_board.front.length > 0 || p.final_board.middle.length > 0 || p.final_board.back.length > 0 || p.is_foul
            );

            if (!hasValidData) {
                this.hand = null;
                return;
            }

            let exactShowdown = h.showdowns.find(s => s.points > 0 && s.chips_delta > 0 && (s.chips_delta % s.points === 0));
            if (exactShowdown) {
                h.tournament.point_score_chips = Math.round(exactShowdown.chips_delta / exactShowdown.points);
            }

            Object.values(h.players).forEach(p => {
                let streakKey = `${this.tableId}_${p.seat}`;
                p.stack_end = Math.max(0, (p.stack_start || p.stack_current) + (p.chips_delta || 0));

                if (p.stack_end === 0 && (p.stack_start > 0 || p.chips_delta < 0)) {
                    p.is_busted = true;
                    h.bustouts.push({ seat: p.seat, nickname: p.nickname, chips_lost: Math.abs(p.chips_delta) });
                }

                if (p.qualified_for_next_fantasy) {
                    DB.fantasyStreaks.set(streakKey, (DB.fantasyStreaks.get(streakKey) || 0) + 1);
                } else {
                    DB.fantasyStreaks.delete(streakKey);
                }

                let sObj = this.seats.get(p.seat);
                if (sObj) sObj.stack = p.stack_end;
            });

            // Очищаем фантомные пустые места, не участвовавшие в раздаче
            let validPlayers = Object.values(h.players).filter(p => 
                h.context.active_seats.includes(p.seat) || p.final_board.front.length > 0 || p.chips_delta !== 0
            );
            h.players = validPlayers;

            if (!DB.handIds.has(h.hand_id)) {
                DB.handIds.add(h.hand_id);
                DB.hands.push(h);
                saveToStorage();
                updateUI();
                let tag = this.isHeroTable ? '⭐ [HERO HAND]' : '👁 [SPECTATOR]';
                console.log(`%c🍍 [OFC v8.4] ${tag} #${h.hand_id} сохранена!`, this.isHeroTable ? 'color:#a855f7;font-weight:bold;' : 'color:#10b981;');
            }
            this.hand = null;
        }
    }

    function getOrCreateTable(tId) {
        if (!DB.tables.has(tId)) {
            DB.tables.set(tId, new TableSession(tId));
        }
        let t = DB.tables.get(tId);
        t.lastActiveTime = Date.now();
        return t;
    }

    function getSessionForSocket(ws, xml) {
        if (ws.__ofcSession) return ws.__ofcSession;
        let tId = attr(xml, 'id') || attr(xml, 'tableId') || ws.__tableId;
        if (tId && tId.startsWith('f54-')) {
            ws.__ofcSession = getOrCreateTable(tId);
            return ws.__ofcSession;
        }
        return null;
    }

    /* ── ГЛАВНЫЙ ОБРАБОТЧИК СООБЩЕНИЙ ──────────────────────────────── */
    function parseMessage(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        // 1. Лобби турнира
        if (xml.includes('<TournamentDetails') || xml.includes('<ScheduledTournament')) {
            let tId = attr(xml, 'id');
            let tName = attr(xml, 'name');
            let gType = attr(xml, 'game') || '';
            if (tId && (gType.includes('OFC') || gType.includes('PINEAPPLE') || xml.includes('PINEAPPLE') || xml.includes('Ананас'))) {
                DB.selectedTournamentId = tId;
                if (tName) DB.selectedTournamentName = tName;
                
                // ЗАПУСК НЕУБИВАЕМОГО ДЕМОНА ЛОББИ:
                ensureDedicatedLobbySocket();
                startTablePruningTimer();
                updateUI();
            }
        }

        // 2. Обнаружение столов
        if (xml.includes('<Tables') && DB.selectedTournamentId) {
            let tMatches = Array.from(xml.matchAll(/<Table\s+[^>]*?\bid="(f54-[^"]+)"/gi));
            let now = Date.now();

            if (tMatches.length > 0) {
                for (let tm of tMatches) {
                    let tId = tm[1];
                    DB.knownTournamentTables.set(tId, now);

                    if (!DB.heroTables.has(tId) && !DB.ghostSockets.has(tId)) {
                        if (DB.ghostSockets.size < MAX_GHOST_SOCKETS) {
                            launchGhostSpectator(tId);
                        }
                    }
                }
                updateUI();
            }
        }

        // 3. Закрытие стола
        if (xml.includes('description="Table is already closed"') || xml.includes('<CloseTable') || xml.includes('<LeaveTable')) {
            let cTableId = ws.__tableId || attr(xml, 'id') || attr(xml, 'tableId');
            if (cTableId) {
                if (DB.heroTables.has(cTableId)) DB.heroTables.delete(cTableId);
                DB.knownTournamentTables.delete(cTableId);
                closeGhostSocket(cTableId);
            }
        }

        // 4. Детали стола
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
            let tId = attr(xml, 'id') || attr(xml, 'tableId');
            if (tId && tId.startsWith('f54-')) {
                let table = getOrCreateTable(tId);
                ws.__ofcSession = table;
                ws.__tableId = tId;

                let gType = attr(xml, 'game') || '';
                table.isOFC = gType.includes('OFC') || gType.includes('PINEAPPLE') || xml.includes('PINEAPPLE') || xml.includes('Ананас');
                if (!table.isOFC) {
                    closeGhostSocket(tId);
                    return;
                }

                table.tournamentName = attr(xml, 'tournamentName') || attr(xml, 'name') || DB.selectedTournamentName || table.tournamentName;
                table.tournamentId = attr(xml, 'tournamentId') || DB.selectedTournamentId || table.tournamentId;
                table.tableName = attr(xml, 'name') || table.tableName;
                table.gameType = gType || table.gameType;
                table.fantasyMode = attr(xml, 'fantasy') || table.fantasyMode;
                table.pointScoreChips = iattr(xml, 'pointScore', table.pointScoreChips);

                let seatBlocks = xml.matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>([\s\S]*?)<\/Seat>/gi);
                for (let sb of seatBlocks) {
                    let sId = parseInt(sb[1], 10);
                    let sBody = sb[2];
                    let nickM = sBody.match(/\bnickname="([^"]+)"/i) || sBody.match(/\bname="([^"]+)"/i);
                    let uuidM = sBody.match(/\buuid="([^"]+)"/i);
                    let stackM = sBody.match(/stack-size="(\d+)"/i);
                    let stack = stackM ? parseInt(stackM[1], 10) : null;
                    if (nickM) {
                        table.updatePlayer(sId, nickM[1], uuidM ? uuidM[1] : null, stack);
                    }
                }
                updateUI();
            }
        }

        let table = getSessionForSocket(ws, xml);
        if (!table || !table.isOFC) return;

        if (ws.__isGhostSocket && table.isHeroTable) {
            closeGhostSocket(table.tableId);
            return;
        }

        // 5. Стоимость куша
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*?\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let ps = parseInt(scoreMatch[1], 10);
            table.pointScoreChips = ps;
            if (table.hand) table.hand.tournament.point_score_chips = ps;
        }

        // 6. Определение Hero
        let meMatch = xml.match(/<Seats\s+[^>]*?\bme="(\d+)"/i) || xml.match(/<Seat\s+[^>]*?\bme="true"[^>]*?\bid="(\d+)"/i);
        if (meMatch) {
            table.heroSeat = parseInt(meMatch[1], 10);
            table.isHeroTable = true;
            DB.heroTables.add(table.tableId);
            if (DB.ghostSockets.has(table.tableId)) closeGhostSocket(table.tableId);

            if (table.hand) {
                table.hand.context.hero_seat = table.heroSeat;
                if (table.hand.players[table.heroSeat]) table.hand.players[table.heroSeat].is_hero = true;
            }
        }

        // 7. Обновление игроков
        let directPlayers = xml.matchAll(/<(?:NewPlayer|PlayerInfo|Player|PlayerState|User)\s+[^>]*?(?:\bseat="(\d+)"|\bid="(\d+)")[^>]*?\bnickname="([^"]+)"/gi);
        for (let dp of directPlayers) {
            let sId = parseInt(dp[1] || dp[2], 10);
            let nick = dp[3];
            let stM = dp[0].match(/stack-size="(\d+)"/i) || dp[0].match(/stack="(\d+)"/i);
            let st = stM ? parseInt(stM[1], 10) : null;
            if (!isNaN(sId) && nick) {
                table.updatePlayer(sId, nick, null, st);
            }
        }

        // 8. Раздача карт
        let nhM = xml.match(/<NewHand\s+([^>]*?)\/>/i);
        let gsM = xml.match(/<GameState\s+([^>]*?)\bhand="(\d+)"/i);
        if (nhM || gsM) {
            let hId = nhM ? attr(nhM[1], 'number') : gsM[2];
            if (hId && (!table.hand || table.hand.hand_id !== String(hId))) {
                let dealer = nhM ? iattr(nhM[1], 'dealer', 0) : iattr(xml, 'dealer', 0);
                let gNum = nhM ? iattr(nhM[1], 'gameNumber', 1) : 1;
                let gCnt = nhM ? iattr(nhM[1], 'gamesCount', 1) : 1;
                table.startHand(hId, dealer, gNum, gCnt);
            }

            if (xml.includes('<GameState')) {
                table.parseGameStateBoard(xml);
            }
        }

        if (!table.hand) return;

        // 9. Таймер хода
        let actChangeM = xml.match(/<ActiveChange\s+[^>]*?\bseat="(\d+)"/i);
        if (actChangeM) {
            let activeSeat = parseInt(actChangeM[1], 10);
            table.seatTurnTimerStart.set(activeSeat, Date.now());
        }

        // 10. Улицы сдачи
        let dealMatches = xml.matchAll(/<DealingCards(?:\s+[^>]*?\bstreet="(\d+)")?[^>]*?>([\s\S]*?)<\/DealingCards>/gi);
        for (let dm of dealMatches) {
            let stNum = dm[1] ? parseInt(dm[1], 10) : 1;
            let sMatches = dm[2].matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>\s*<Cards>([\s\S]*?)<\/Cards>\s*<\/Seat>/gi);
            for (let sm of sMatches) {
                let sn = parseInt(sm[1], 10);
                let cards = parseCards(sm[2]);
                let p = table.getPlayer(sn);
                if (p) {
                    if (cards.length > 5) {
                        p.is_fantasy = true;
                        p.fantasy_cards_count = cards.length;
                        stNum = 0;
                    }
                    let existingStreet = p.streets.find(s => s.street === stNum);
                    if (!existingStreet) {
                        p.streets.push({
                            street: stNum,
                            street_name: p.is_fantasy ? `fantasy_deal_${cards.length}_cards` : `street_${stNum}`,
                            dealt_cards: cards,
                            placed: { front: [], middle: [], back: [] },
                            discarded: []
                        });
                    } else {
                        let hasRealCards = cards.some(c => c !== 'xx');
                        let hadOnlyMasked = existingStreet.dealt_cards.every(c => c === 'xx');
                        if (hasRealCards && hadOnlyMasked) existingStreet.dealt_cards = cards;
                    }
                }
            }
        }

        // 11. Раскладка карт и таймлайн
        let paMatches = xml.matchAll(/<PlayerAction\s+[^>]*?\bseat="(\d+)"[^>]*?>([\s\S]*?)<\/PlayerAction>/gi);
        for (let pam of paMatches) {
            let sn = parseInt(pam[1], 10);
            let body = pam[2];
            let p = table.getPlayer(sn);
            if (p && body.includes('<LayOut')) {
                let discM = body.match(/<Discarded>([\s\S]*?)<\/Discarded>/i);
                let discards = discM ? parseCards(discM[1]) : [];
                
                if (discards.length > 0) {
                    discards.forEach(c => {
                        if (c !== 'xx') {
                            if (!p.discards.includes(c)) p.discards.push(c);
                        } else {
                            let maxDiscardsAllowed = p.is_fantasy ? Math.max(0, p.fantasy_cards_count - 13) : 4;
                            if (p.discards.length < maxDiscardsAllowed) p.discards.push(c);
                        }
                    });
                }

                let placedDelta = { front: [], middle: [], back: [] };
                let newCardsCount = 0;

                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rM = body.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"[^>]*?>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rM) {
                        let cList = parseCards(rM[1]);
                        let rowKey = row.toLowerCase();

                        if (p.is_fantasy) {
                            placedDelta[rowKey] = cList;
                            if (cList.some(c => c !== 'xx')) p.final_board[rowKey] = cList;
                        } else {
                            placedDelta[rowKey] = cList;
                            newCardsCount += cList.length;
                            let realCards = cList.filter(c => c !== 'xx');
                            realCards.forEach(c => {
                                if (!p.final_board[rowKey].includes(c)) p.final_board[rowKey].push(c);
                            });
                        }
                    }
                });

                let thinkSec = null;
                if (table.seatTurnTimerStart.has(sn)) {
                    thinkSec = parseFloat(((Date.now() - table.seatTurnTimerStart.get(sn)) / 1000).toFixed(1));
                    table.seatTurnTimerStart.delete(sn);
                }

                table.actionCounter++;
                table.hand.action_timeline.push({
                    step: table.actionCounter,
                    seat: sn,
                    nickname: p.nickname,
                    street: p.is_fantasy ? 0 : (p.streets.length > 0 ? p.streets[p.streets.length - 1].street : 1),
                    placed: placedDelta,
                    discarded: discards,
                    time_sec: thinkSec
                });

                if (p.streets.length > 0) {
                    if (p.is_fantasy) {
                        p.streets[0].placed = placedDelta;
                        if (discards.length > 0) p.streets[0].discarded = discards;
                    } else if (newCardsCount > 0 && newCardsCount <= 5) {
                        let target = p.streets.find(st => st.placed.front.length === 0 && st.placed.middle.length === 0 && st.placed.back.length === 0) || p.streets[p.streets.length - 1];
                        if (target) {
                            target.placed = placedDelta;
                            if (discards.length > 0) target.discarded = discards;
                        }
                    }
                }
            }
        }

        // 12. Роялти и комбинации
        let ccMatches = xml.matchAll(/<CombinationChange\s+([^>]*?)>([\s\S]*?)<\/CombinationChange>/gi);
        for (let ccm of ccMatches) {
            let cAttr = ccm[1];
            let cBody = ccm[2];
            let sn = iattr(cAttr, 'seat');
            let p = table.getPlayer(sn);
            if (p) {
                if (cAttr.includes('dead="true"')) p.is_foul = true;

                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rowM = cBody.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"[^>]*?>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rowM) {
                        let hAttr = rowM[1];
                        let cards = parseCards(rowM[2]);
                        let rowKey = row.toLowerCase();
                        if (cards.length > 0 && cards.some(c => c !== 'xx')) {
                            p.final_board[rowKey] = cards;
                        }
                        p.royalties[rowKey] = iattr(hAttr, 'royalty', 0);
                        let str = attr(hAttr, 'strength');
                        if (str) p.combinations[rowKey] = str;
                    }
                });
                p.royalties.total = p.royalties.front + p.royalties.middle + p.royalties.back;
            }
        }

        // 13. Шоудауны
        let sdMatches = xml.matchAll(/<Showdown\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Showdown>)/gi);
        for (let sdm of sdMatches) {
            let sAttr = sdm[1];
            let sBody = sdm[2] || '';
            let lineDetails = {};
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let lm = sBody.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/Hand>)`, 'i'));
                if (lm) {
                    lineDetails[row.toLowerCase()] = {
                        points: iattr(lm[1], 'points', 0),
                        royalty: iattr(lm[1], 'royalty', 0)
                    };
                }
            });

            table.hand.showdowns.push({
                winner_seat: iattr(sAttr, 'firstSeat'),
                loser_seat: iattr(sAttr, 'secondSeat'),
                points: iattr(sAttr, 'points', 0),
                is_scoop: (iattr(sAttr, 'scoop', 0) || 0) > 0,
                chips_delta: iattr(sAttr, 'cash', 0),
                lines: lineDetails
            });
        }

        // 14. Победители
        let winMatches = xml.matchAll(/<Winner\s+([^>]*?)\/>/gi);
        for (let wm of winMatches) {
            let wAttr = wm[1];
            let sn = iattr(wAttr, 'seat');
            let score = iattr(wAttr, 'score', 0);
            let amt = iattr(wAttr, 'amount', 0);
            let isFant = wAttr.includes('fantasy="true"');

            let p = table.getPlayer(sn);
            if (p) {
                p.score_points = score;
                p.chips_delta = amt;
                p.qualified_for_next_fantasy = isFant;
            }

            table.hand.winners.push({
                seat: sn,
                score_points: score,
                chips_delta: amt,
                fantasy_qualified: isFant
            });
        }

        // 15. Завершение
        if (xml.includes('<EndHand')) {
            table.finalize();
        }
    }

    /* ── НЕУБИВАЕМЫЙ АВТОНОМНЫЙ СОКЕТ ЛОББИ ──────────────────────────── */
    function ensureDedicatedLobbySocket() {
        if (!DB.wsUrl || !DB.sessionId || !DB.selectedTournamentId) return;

        let ws = DB.dedicatedLobbyWs;
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            let lws = new NativeWebSocket(DB.wsUrl);
            DB.dedicatedLobbyWs = lws;
            lws.__isDedicatedLobby = true;

            lws.onopen = function() {
                let ua = navigator.userAgent || "Mozilla/5.0";
                lws.send(`<EnterTournamentLobby id="${DB.selectedTournamentId}" sessionId="${DB.sessionId}" userAgent="${ua}" client="html5mobile" clientFace="pokerdom" clientVersion="71.0.138" deviceToken="${DB.deviceToken || ''}"/>`);
                
                // Периодический опрос списка столов турнира
                if (DB.lobbyPollTimer) clearInterval(DB.lobbyPollTimer);
                DB.lobbyPollTimer = setInterval(() => {
                    if (lws.readyState === WebSocket.OPEN) {
                        try { lws.send('<GetTables count="500"/>'); } catch(e) {}
                    }
                }, 4000);
            };

            lws.onmessage = function(e) {
                let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                parseMessage(text, lws);
            };

            lws.onclose = function() {
                DB.dedicatedLobbyWs = null;
                // Авто-реконнект через 3 секунды, если турнир ещё выбран
                if (DB.selectedTournamentId) {
                    setTimeout(ensureDedicatedLobbySocket, 3000);
                }
            };

            lws.onerror = function() {
                try { lws.close(); } catch(e) {}
            };
        } catch(err) {
            console.error('[Dedicated Lobby Error]', err);
        }
    }

    /* ── ФОНОВЫЙ МАЙНЕР СТОЛОВ ───────────────────────────────────────── */
    function launchGhostSpectator(tableId) {
        if (!DB.wsUrl || !DB.sessionId || !DB.selectedTournamentId) return;
        if (DB.heroTables.has(tableId) || DB.ghostSockets.has(tableId)) return;
        if (DB.ghostSockets.size >= MAX_GHOST_SOCKETS) return;

        let now = Date.now();
        let cd = DB.socketCooldowns.get(tableId) || 0;
        if (now < cd) return;

        try {
            let table = getOrCreateTable(tableId);
            let gws = new NativeWebSocket(DB.wsUrl);
            gws.__tableId = tableId;
            gws.__isGhostSocket = true;
            gws.__ofcSession = table;
            gws.__state = 'CONNECTING';
            
            DB.ghostSockets.set(tableId, gws);

            gws.onopen = function() {
                let ua = navigator.userAgent || "Mozilla/5.0";
                let enterMsg = `<EnterTable sessionId="${DB.sessionId}" tableId="${tableId}" tournamentId="${DB.selectedTournamentId}" userAgent="${ua}" client="html5mobile" clientFace="pokerdom" clientVersion="71.0.138" deviceToken="${DB.deviceToken || ''}"/>`;
                
                gws.send(enterMsg);
                gws.__state = 'WAITING_TABLE_DETAILS';

                gws.__heartbeat = setInterval(() => {
                    if (gws.readyState === WebSocket.OPEN) {
                        try { 
                            gws.send('<GetServerTime/>');
                            if (Date.now() - table.lastActiveTime > 15000) {
                                gws.send('<GetGameState/>');
                            }
                        } catch(e) {}
                    }
                }, 8000);
            };

            gws.onmessage = function(e) {
                let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                
                if (gws.__state === 'WAITING_TABLE_DETAILS' && text.includes('<TableDetails')) {
                    gws.__state = 'SPECTATING';
                    gws.send(`<GetTableDetails id="${DB.selectedTournamentId}" type="SCHEDULED_TOURNAMENT"/>`);
                    gws.send('<JoinTable/>');
                }

                parseMessage(text, gws);
            };

            gws.onclose = function() { closeGhostSocket(tableId); };
            gws.onerror = function() { closeGhostSocket(tableId); };

            updateUI();
        } catch(err) {
            console.error('[Ghost Launch Error]', err);
        }
    }

    function closeGhostSocket(tableId) {
        let ws = DB.ghostSockets.get(tableId);
        if (ws) {
            if (ws.__heartbeat) clearInterval(ws.__heartbeat);
            try { ws.close(); } catch(e) {}
            DB.ghostSockets.delete(tableId);
        }
        DB.socketCooldowns.set(tableId, Date.now() + 4000);
        updateUI();
    }

    function stopAllMining() {
        DB.ghostSockets.forEach((ws, tId) => closeGhostSocket(tId));
        if (DB.dedicatedLobbyWs) {
            try { DB.dedicatedLobbyWs.close(); } catch(e) {}
            DB.dedicatedLobbyWs = null;
        }
        DB.selectedTournamentId = null;
        DB.selectedTournamentName = 'Остановлено';
        if (DB.lobbyPollTimer) clearInterval(DB.lobbyPollTimer);
        if (DB.tablePruneTimer) clearInterval(DB.tablePruneTimer);
        updateUI();
        alert('🛑 Майнинг остановлен. Все сокеты закрыты.');
    }

    function clearDatabase() {
        if (confirm('Вы уверены, что хотите очистить всю базу раздач OFC?')) {
            DB.hands = [];
            DB.handIds.clear();
            saveToStorage();
            updateUI();
        }
    }

    function startTablePruningTimer() {
        if (DB.tablePruneTimer) clearInterval(DB.tablePruneTimer);
        DB.tablePruneTimer = setInterval(() => {
            let now = Date.now();
            for (let [tId, ws] of DB.ghostSockets.entries()) {
                let lastSeenLobby = DB.knownTournamentTables.get(tId) || 0;
                let tableSession = DB.tables.get(tId);
                let lastActive = tableSession ? tableSession.lastActiveTime : 0;

                // Если стол не обновлялся больше минуты — освобождаем слот
                if (now - lastSeenLobby > GHOST_TABLE_TIMEOUT_MS && now - lastActive > GHOST_TABLE_TIMEOUT_MS) {
                    closeGhostSocket(tId);
                    DB.knownTournamentTables.delete(tId);
                }
            }
            updateUI();
        }, 20000);
    }

    /* ── WEBSOCKET PROXY ───────────────────────────────────────────── */
    let NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            if (args[0]) DB.wsUrl = args[0];

            if (!ws.__isGhostSocket && !ws.__isDedicatedLobby) {
                ws.__isHeroSocket = true;
            }

            const originalSend = ws.send;
            ws.send = function(data) {
                try {
                    let text = typeof data === 'string' ? data : new TextDecoder().decode(data);
                    if (text.includes('sessionId=')) {
                        let sid = attr(text, 'sessionId');
                        if (sid) DB.sessionId = sid;
                    }
                    if (text.includes('deviceToken=')) {
                        let dt = attr(text, 'deviceToken');
                        if (dt) DB.deviceToken = dt;
                    }
                } catch(e) {}
                return originalSend.apply(this, arguments);
            };

            ws.addEventListener('message', function(e) {
                try {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    parseMessage(text, ws);
                } catch(err) {
                    console.error('[OFC Proxy Error]', err);
                }
            });

            return ws;
        }
    });

    /* ── МОБИЛЬНЫЙ HUD UI ──────────────────────────────────────────── */
    let hud = document.createElement('div');
    hud.id = 'ofc-god-hud-v84';
    hud.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999999;background:rgba(15,23,42,0.98);backdrop-filter:blur(12px);border:1px solid #a855f7;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.9);color:#f8fafc;font-family:monospace;font-size:11px;user-select:none;width:290px;';

    hud.innerHTML = `
        <div id="ofc-hud-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;gap:8px;background:linear-gradient(135deg,rgba(168,85,247,0.25),transparent);border-radius:12px 12px 0 0;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="ofc-hud-toggle-icon" style="color:#a855f7;font-weight:900;font-size:13px;">▾</span>
                <strong style="color:#a855f7;font-size:12px;">🍍 OFC DAEMON v8.4</strong>
            </div>
            <span id="ofc-badge-hands-84" style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:999px;font-weight:700;font-size:10px;">${DB.hands.length} рук</span>
        </div>
        <div id="ofc-hud-body" style="padding:10px 14px 12px 14px;display:block;">
            <div style="font-size:10.5px;color:#94a3b8;margin-bottom:10px;line-height:1.6;">
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Турнир: <b id="ofc-tourn-name-84" style="color:#fde047;">${DB.selectedTournamentName}</b></div>
                <div style="display:flex;justify-content:space-between;margin-top:4px;">
                    <span>Hero: <b style="color:#c084fc;">${DB.heroNickname}</b></span>
                    <span>Пул столов: <b id="ofc-badge-ghosts-84" style="color:#38bdf8;">0 / ${MAX_GHOST_SOCKETS}</b></span>
                </div>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:6px;">
                <button id="ofc-btn-save-84" style="flex:1;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;padding:8px 10px;border-radius:6px;font-weight:800;cursor:pointer;">💾 Скачать JSON</button>
                <button id="ofc-btn-clip-84" style="background:#334155;color:#fff;border:none;padding:8px 10px;border-radius:6px;font-weight:700;cursor:pointer;">📋 Копия</button>
            </div>
            <div style="display:flex;gap:6px;">
                <button id="ofc-btn-stop-84" style="flex:1;background:#b91c1c;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">🛑 Стоп</button>
                <button id="ofc-btn-clear-84" style="flex:1;background:#475569;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">🗑 Очистить</button>
            </div>
        </div>
    `;
    document.body.appendChild(hud);

    let isCollapsed = false;
    document.getElementById('ofc-hud-header').onclick = function() {
        isCollapsed = !isCollapsed;
        let body = document.getElementById('ofc-hud-body');
        let icon = document.getElementById('ofc-hud-toggle-icon');
        body.style.display = isCollapsed ? 'none' : 'block';
        icon.innerText = isCollapsed ? '▸' : '▾';
    };

    document.getElementById('ofc-btn-stop-84').onclick = stopAllMining;
    document.getElementById('ofc-btn-clear-84').onclick = clearDatabase;

    function updateUI() {
        let bHands = document.getElementById('ofc-badge-hands-84');
        let bGhosts = document.getElementById('ofc-badge-ghosts-84');
        let tName = document.getElementById('ofc-tourn-name-84');
        
        if (bHands) bHands.innerText = `${DB.hands.length} рук`;
        if (bGhosts) bGhosts.innerText = `${DB.ghostSockets.size} / ${MAX_GHOST_SOCKETS}`;
        if (tName) tName.innerText = DB.selectedTournamentName;
    }

    function exportPayload() {
        return {
            version: '8.4-OFC-AUTONOMOUS-DATASET',
            currency: 'TOURNAMENT_CHIPS',
            exported_at: new Date().toISOString(),
            tournament_id: DB.selectedTournamentId,
            tournament_name: DB.selectedTournamentName,
            hero_nickname: DB.heroNickname,
            total_hands_count: DB.hands.length,
            hands: DB.hands
        };
    }

    document.getElementById('ofc-btn-save-84').onclick = function(e) {
        e.stopPropagation();
        let blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_v84_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    document.getElementById('ofc-btn-clip-84').onclick = function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2)).then(() => {
            alert('🍍 OFC-датасет v8.4 скопирован в буфер обмена!');
        });
    };

    console.log('%c🍍 [OFC God Engine v8.4] Автономный демон запущен. Выход из лобби больше не остановит сбор!', 'color:#a855f7;font-weight:bold;font-size:13px;');
})();

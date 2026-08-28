javascript:(function(){
    if (window.__ofcGodEngineV80) {
        alert('🍍 OFC God Engine v8.0 (Dual-Core Architecture) уже запущен!');
        return;
    }
    window.__ofcGodEngineV80 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE GOD ENGINE v8.0 — DUAL-CORE INDEPENDENT ARCHITECTURE
       Core 1: Hero Interactive Interceptor (100% Private Cards & Discards)
       Core 2: Ghost Spectator Miner (Background Parallel Table Scraper)
       ══════════════════════════════════════════════════════════════════ */

    window.OFC_DB = window.OFC_DB || {
        tables: new Map(),
        ghostSockets: new Map(),
        heroTables: new Set(),
        socketCooldowns: new Map(),
        lobbySocket: null,
        hands: [],
        handIds: new Set(),
        selectedTournamentId: null,
        selectedTournamentName: 'Не выбран',
        heroNickname: 'Taisiya888',
        sessionId: null,
        deviceToken: null,
        wsUrl: null,
        lobbyPollTimer: null
    };

    const DB = window.OFC_DB;

    try {
        let saved = sessionStorage.getItem('ofc_hands_backup_v80') || sessionStorage.getItem('ofc_hands_backup_v75');
        if (saved) {
            let parsed = JSON.parse(saved);
            DB.hands = parsed;
            parsed.forEach(h => DB.handIds.add(h.hand_id));
            console.log(`[OFC v8.0] Восстановлено ${DB.hands.length} рук из кэша.`);
        }
    } catch(e) {}

    function saveToStorage() {
        try { sessionStorage.setItem('ofc_hands_backup_v80', JSON.stringify(DB.hands)); } catch(e) {}
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

    /* ── СЕССИЯ СТОЛА ──────────────────────────────────────────────── */
    class TableSession {
        constructor(tableId) {
            this.tableId = tableId;
            this.tableName = 'Стол #' + String(tableId).slice(-4);
            this.tournamentName = DB.selectedTournamentName || 'OFC Pineapple';
            this.tournamentId = DB.selectedTournamentId || null;
            this.gameType = 'OFC_PINEAPPLE_OH';
            this.fantasyMode = 'ULTIMATE_UNLIMITED';
            this.pointScoreChips = 100;
            this.heroSeat = null;
            this.isHeroTable = false;
            this.seats = new Map();
            this.hand = null;
            this.isOFC = true;
            this.lastActiveTime = Date.now();
        }

        updatePlayer(seat, nick, uuid = null) {
            if (!nick || typeof nick !== 'string') return;
            let cleanNick = nick.trim();
            if (cleanNick.startsWith('Seat ') && this.seats.has(seat) && !this.seats.get(seat).nickname.startsWith('Seat ')) {
                return;
            }

            this.seats.set(seat, { seat, nickname: cleanNick, uuid });

            let isHeroNick = DB.heroNickname && cleanNick.toLowerCase() === DB.heroNickname.toLowerCase();
            if (isHeroNick) {
                this.heroSeat = seat;
                this.isHeroTable = true;
                DB.heroTables.add(this.tableId);
                if (DB.ghostSockets.has(this.tableId)) {
                    closeGhostSocket(this.tableId);
                }
            }

            if (this.hand && this.hand.players) {
                let p = this.hand.players[seat];
                if (p) {
                    p.nickname = cleanNick;
                    if (isHeroNick || this.heroSeat === seat) {
                        p.is_hero = true;
                        this.hand.context.hero_seat = seat;
                    }
                }
            }
        }

        startHand(handId, dealer, gameNum = 1, gamesCount = 1) {
            if (!this.isOFC) return;
            let isFantasyRound = (gameNum > 1);
            let hasJokers = this.gameType.includes('JOKER') || (DB.selectedTournamentName && DB.selectedTournamentName.includes('Джокер'));

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
                    hero_seat: this.heroSeat,
                    is_fantasy_round: isFantasyRound,
                    game_round: gameNum,
                    total_rounds: gamesCount,
                    active_seats: Array.from(this.seats.keys())
                },
                players: {},
                showdowns: [],
                winners: []
            };

            this.seats.forEach((p, s) => {
                let isHero = (s === this.heroSeat) || (DB.heroNickname && p.nickname && p.nickname.toLowerCase() === DB.heroNickname.toLowerCase());
                if (isHero) {
                    this.heroSeat = s;
                    this.isHeroTable = true;
                    DB.heroTables.add(this.tableId);
                }

                this.hand.players[s] = {
                    seat: s,
                    nickname: p.nickname || `Seat ${s}`,
                    is_hero: isHero,
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 },
                    is_foul: false,
                    score_points: 0,
                    chips_delta: 0,
                    qualified_for_next_fantasy: false
                };
            });

            if (this.heroSeat !== null) {
                this.hand.context.hero_seat = this.heroSeat;
            }
        }

        getPlayer(seat) {
            if (!this.hand) return null;
            if (!this.hand.players[seat]) {
                let p = this.seats.get(seat) || { nickname: `Seat ${seat}` };
                let isHero = (seat === this.heroSeat) || (DB.heroNickname && p.nickname && p.nickname.toLowerCase() === DB.heroNickname.toLowerCase());
                if (isHero) {
                    this.heroSeat = seat;
                    this.isHeroTable = true;
                    DB.heroTables.add(this.tableId);
                }

                this.hand.players[seat] = {
                    seat: seat,
                    nickname: p.nickname,
                    is_hero: isHero,
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 },
                    is_foul: false,
                    score_points: 0,
                    chips_delta: 0,
                    qualified_for_next_fantasy: false
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
            } else if (this.pointScoreChips && this.pointScoreChips > 0) {
                h.tournament.point_score_chips = this.pointScoreChips;
            }

            h.players = Object.values(h.players);

            if (!DB.handIds.has(h.hand_id)) {
                DB.handIds.add(h.hand_id);
                DB.hands.push(h);
                saveToStorage();
                updateUI();
                let tag = this.isHeroTable ? '⭐ [HERO HAND]' : '👁 [SPECTATOR]';
                console.log(`%c🍍 [OFC v8.0] ${tag} Раздача #${h.hand_id} (${h.tournament.table_name}) сохранена!`, this.isHeroTable ? 'color:#a855f7;font-weight:bold;' : 'color:#10b981;');
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

        // 1. Турнир и лобби
        if (xml.includes('<TournamentDetails') || xml.includes('<ScheduledTournament')) {
            let tId = attr(xml, 'id');
            let tName = attr(xml, 'name');
            let gType = attr(xml, 'game') || '';
            if (tId && (gType.includes('OFC') || gType.includes('PINEAPPLE') || xml.includes('PINEAPPLE') || xml.includes('Ананас'))) {
                DB.selectedTournamentId = tId;
                if (tName) DB.selectedTournamentName = tName;
                DB.lobbySocket = ws;
                startLobbyPoller();
                updateUI();
            }
        }

        // 2. ДВУХСТОРОННЯЯ СИНХРОНИЗАЦИЯ (Исключаем Hero-стол из призраков!)
        if (xml.includes('<Tables') && DB.selectedTournamentId) {
            let tMatches = Array.from(xml.matchAll(/<Table\s+[^>]*?\bid="(f54-[^"]+)"/gi));
            let currentTableIds = new Set(tMatches.map(m => m[1]));

            for (let tId of currentTableIds) {
                if (!DB.heroTables.has(tId) && !DB.ghostSockets.has(tId)) {
                    launchGhostSpectator(tId);
                }
            }

            for (let existingTableId of Array.from(DB.ghostSockets.keys())) {
                if (!currentTableIds.has(existingTableId) || DB.heroTables.has(existingTableId)) {
                    closeGhostSocket(existingTableId);
                }
            }
            updateUI();
        }

        // 3. Закрытие отдельного стола / выход Hero
        if (xml.includes('description="Table is already closed"') || xml.includes('<CloseTable') || xml.includes('<LeaveTable')) {
            let cTableId = ws.__tableId || attr(xml, 'id') || attr(xml, 'tableId');
            if (cTableId) {
                if (DB.heroTables.has(cTableId)) DB.heroTables.delete(cTableId);
                closeGhostSocket(cTableId);
            }
        }

        // 4. Детали стола и рассадка
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
                    if (nickM) {
                        table.updatePlayer(sId, nickM[1], uuidM ? uuidM[1] : null);
                    }
                }
                updateUI();
            }
        }

        let table = getSessionForSocket(ws, xml);
        if (!table || !table.isOFC) return;

        // ЗАЩИТА: Игнорируем сокеты-призраки на столе Героя
        if (ws.__isGhostSocket && table.isHeroTable) {
            closeGhostSocket(table.tableId);
            return;
        }

        // 5. Стоимость куша
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*?\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let ps = parseInt(scoreMatch[1], 10);
            table.pointScoreChips = ps;
            if (table.hand && !table.hand.context.is_fantasy_round) {
                table.hand.tournament.point_score_chips = ps;
            }
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
                if (table.hand.players[table.heroSeat]) {
                    table.hand.players[table.heroSeat].is_hero = true;
                }
            }
        }

        // 7. Обновление игроков
        let directPlayers = xml.matchAll(/<(?:NewPlayer|PlayerInfo|Player|PlayerState|User)\s+[^>]*?(?:\bseat="(\d+)"|\bid="(\d+)")[^>]*?\bnickname="([^"]+)"/gi);
        for (let dp of directPlayers) {
            let sId = parseInt(dp[1] || dp[2], 10);
            let nick = dp[3];
            if (!isNaN(sId) && nick) {
                table.updatePlayer(sId, nick);
            }
        }

        // 8. Новая раздача
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
        }

        if (!table.hand) return;

        // 9. Раздача карт по улицам (С СОХРАНЕНИЕМ ВСЕХ РЕАЛЬНЫХ КАРТ ДЛЯ HERO)
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
                        // Обновляем реальными картами, если до этого была маска 'xx'
                        let hasRealCards = cards.some(c => c !== 'xx');
                        let hadOnlyMasked = existingStreet.dealt_cards.every(c => c === 'xx');
                        if (hasRealCards && hadOnlyMasked) {
                            existingStreet.dealt_cards = cards;
                        }
                    }
                }
            }
        }

        // 10. Раскладка карт и сбросы Hero (Discards)
        let paMatches = xml.matchAll(/<PlayerAction\s+[^>]*?\bseat="(\d+)"[^>]*?>([\s\S]*?)<\/PlayerAction>/gi);
        for (let pam of paMatches) {
            let sn = parseInt(pam[1], 10);
            let body = pam[2];
            let p = table.getPlayer(sn);
            if (p && body.includes('<LayOut')) {
                let discM = body.match(/<Discarded>([\s\S]*?)<\/Discarded>/i);
                let discards = discM ? parseCards(discM[1]) : [];
                if (discards.length > 0) p.discards.push(...discards);

                let placedDelta = { front: [], middle: [], back: [] };
                let newCardsCount = 0;

                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rM = body.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"[^>]*?>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rM) {
                        let cList = parseCards(rM[1]);
                        let rowKey = row.toLowerCase();

                        if (p.is_fantasy) {
                            placedDelta[rowKey] = cList;
                            p.final_board[rowKey] = cList;
                        } else {
                            let newCards = cList.filter(c => !p.final_board[rowKey].includes(c));
                            placedDelta[rowKey] = newCards;
                            newCardsCount += newCards.length;
                            newCards.forEach(c => p.final_board[rowKey].push(c));
                        }
                    }
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

        // 11. Комбинации и фолы
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
                        if (cards.length > 0) p.final_board[rowKey] = cards;
                        
                        p.royalties[rowKey] = iattr(hAttr, 'royalty', 0);
                        let str = attr(hAttr, 'strength');
                        if (str) p.combinations[rowKey] = str;
                    }
                });
                p.royalties.total = p.royalties.front + p.royalties.middle + p.royalties.back;
            }
        }

        // 12. Шоудауны
        let sdMatches = xml.matchAll(/<Showdown\s+([^>]*?)(?:\\/>|>([\s\S]*?)<\/Showdown>)/gi);
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

        // 13. Победители
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

        // 14. Завершение
        if (xml.includes('<EndHand')) {
            table.finalize();
        }
    }

    /* ── ФОНОВЫЙ МАЙНЕР СТОЛОВ ОППОНЕНТОВ ────────────────────────────── */
    function launchGhostSpectator(tableId) {
        if (!DB.wsUrl || !DB.sessionId || !DB.selectedTournamentId) return;
        if (DB.heroTables.has(tableId) || DB.ghostSockets.has(tableId)) return;

        let now = Date.now();
        let cd = DB.socketCooldowns.get(tableId) || 0;
        if (now < cd) return;

        try {
            let table = getOrCreateTable(tableId);
            let gws = new NativeWebSocket(DB.wsUrl);
            gws.__tableId = tableId;
            gws.__isGhostSocket = true; // Метка призрака
            gws.__ofcSession = table;
            gws.__state = 'CONNECTING';
            
            DB.ghostSockets.set(tableId, gws);

            gws.onopen = function() {
                let ua = navigator.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
                let enterMsg = `<EnterTable sessionId="${DB.sessionId}" tableId="${tableId}" tournamentId="${DB.selectedTournamentId}" userAgent="${ua}" client="html5mobile" clientFace="pokerdom" clientVersion="71.0.138" deviceToken="${DB.deviceToken || ''}"/>`;
                
                gws.send(enterMsg);
                gws.__state = 'WAITING_TABLE_DETAILS';

                gws.__heartbeat = setInterval(() => {
                    if (gws.readyState === WebSocket.OPEN) {
                        try { 
                            gws.send('<GetServerTime/>');
                            if (Date.now() - table.lastActiveTime > 20000) {
                                gws.send('<GetGameState/>');
                            }
                        } catch(e) {}
                    }
                }, 10000);
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
        DB.socketCooldowns.set(tableId, Date.now() + 5000);
        updateUI();
    }

    function stopAllMining() {
        DB.ghostSockets.forEach((ws, tId) => closeGhostSocket(tId));
        DB.selectedTournamentId = null;
        DB.selectedTournamentName = 'Остановлено';
        if (DB.lobbyPollTimer) clearInterval(DB.lobbyPollTimer);
        updateUI();
        alert('🛑 Майнинг остановлен. Все фоновые столы закрыты.');
    }

    function clearDatabase() {
        if (confirm('Вы уверены, что хотите удалить все собранные раздачи?')) {
            DB.hands = [];
            DB.handIds.clear();
            saveToStorage();
            updateUI();
        }
    }

    /* ── САМОВОССТАНАВЛИВАЮЩИЙСЯ ОПРОС ЛОББИ ────────────────────────── */
    function startLobbyPoller() {
        if (DB.lobbyPollTimer) clearInterval(DB.lobbyPollTimer);
        function poll() {
            if (!DB.selectedTournamentId) return;

            let activeWs = (DB.lobbySocket && DB.lobbySocket.readyState === WebSocket.OPEN) ? DB.lobbySocket : null;
            if (!activeWs) {
                for (let ws of DB.ghostSockets.values()) {
                    if (ws.readyState === WebSocket.OPEN) {
                        activeWs = ws;
                        break;
                    }
                }
            }

            if (activeWs) {
                try { activeWs.send('<GetTables count="500"/>'); } catch(e) {}
            }
        }
        poll();
        DB.lobbyPollTimer = setInterval(poll, 4000);
    }

    /* ── WEBSOCKET PROXY С МЕТКОЙ HERO-СОКЕТОВ ─────────────────────── */
    let NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            if (args[0]) DB.wsUrl = args[0];

            if (!ws.__isGhostSocket) {
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

    /* ── СВОРАЧИВАЕМЫЙ МОБИЛЬНЫЙ HUD UI ────────────────────────────── */
    let hud = document.createElement('div');
    hud.id = 'ofc-god-hud-v80';
    hud.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999999;background:rgba(15,23,42,0.98);backdrop-filter:blur(12px);border:1px solid #a855f7;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.9);color:#f8fafc;font-family:monospace;font-size:11px;user-select:none;width:280px;';

    hud.innerHTML = `
        <div id="ofc-hud-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;gap:8px;background:linear-gradient(135deg,rgba(168,85,247,0.25),transparent);border-radius:12px 12px 0 0;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="ofc-hud-toggle-icon" style="color:#a855f7;font-weight:900;font-size:13px;">▾</span>
                <strong style="color:#a855f7;font-size:12px;">🍍 OFC DUAL-CORE v8.0</strong>
            </div>
            <span id="ofc-badge-hands-80" style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:999px;font-weight:700;font-size:10px;">${DB.hands.length} рук</span>
        </div>
        <div id="ofc-hud-body" style="padding:10px 14px 12px 14px;display:block;">
            <div style="font-size:10.5px;color:#94a3b8;margin-bottom:10px;line-height:1.6;">
                <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Турнир: <b id="ofc-tourn-name-80" style="color:#fde047;">${DB.selectedTournamentName}</b></div>
                <div style="display:flex;justify-content:space-between;margin-top:4px;">
                    <span>Hero: <b style="color:#c084fc;">${DB.heroNickname}</b></span>
                    <span>Фон столов: <b id="ofc-badge-ghosts-80" style="color:#38bdf8;">0</b></span>
                </div>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:6px;">
                <button id="ofc-btn-save-80" style="flex:1;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;padding:8px 10px;border-radius:6px;font-weight:800;cursor:pointer;">💾 Скачать JSON</button>
                <button id="ofc-btn-clip-80" style="background:#334155;color:#fff;border:none;padding:8px 10px;border-radius:6px;font-weight:700;cursor:pointer;">📋 Копия</button>
            </div>
            <div style="display:flex;gap:6px;">
                <button id="ofc-btn-stop-80" style="flex:1;background:#b91c1c;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">🛑 Стоп</button>
                <button id="ofc-btn-clear-80" style="flex:1;background:#475569;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">🗑 Очистить</button>
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

    document.getElementById('ofc-btn-stop-80').onclick = stopAllMining;
    document.getElementById('ofc-btn-clear-80').onclick = clearDatabase;

    function updateUI() {
        let bHands = document.getElementById('ofc-badge-hands-80');
        let bGhosts = document.getElementById('ofc-badge-ghosts-80');
        let tName = document.getElementById('ofc-tourn-name-80');
        
        if (bHands) bHands.innerText = `${DB.hands.length} рук`;
        if (bGhosts) bGhosts.innerText = `${DB.ghostSockets.size}`;
        if (tName) tName.innerText = DB.selectedTournamentName;
    }

    function exportPayload() {
        return {
            version: '8.0-OFC-DUAL-CORE-DATASET',
            currency: 'TOURNAMENT_CHIPS',
            exported_at: new Date().toISOString(),
            tournament_id: DB.selectedTournamentId,
            tournament_name: DB.selectedTournamentName,
            hero_nickname: DB.heroNickname,
            total_hands_count: DB.hands.length,
            hands: DB.hands
        };
    }

    document.getElementById('ofc-btn-save-80').onclick = function(e) {
        e.stopPropagation();
        let blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_v80_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    document.getElementById('ofc-btn-clip-80').onclick = function(e) {
        e.stopPropagation();
        navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2)).then(() => {
            alert('🍍 Датасет скопирован в буфер обмена!');
        });
    };

    console.log('%c🍍 [OFC God Engine v8.0] Запущен. Dual-Core архитектура активна для Hero: ' + DB.heroNickname, 'color:#a855f7;font-weight:bold;font-size:13px;');
})();

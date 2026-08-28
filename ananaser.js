javascript:(function(){
    if (window.__ofcTitanEngineV52) {
        alert('🍍 OFC Titan Engine v5.2 уже активен!');
        return;
    }
    window.__ofcTitanEngineV52 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE TITAN ENGINE v5.2 — ULTIMATE TOURNAMENT MINER
       ══════════════════════════════════════════════════════════════════ */

    const MAX_GHOST_TABLES = 30;

    const OFC_DB = {
        tables: new Map(),           // tableId -> TableSession
        ghostSockets: new Map(),     // tableId -> WebSocket
        lobbySocket: null,
        hands: [],
        handIds: new Set(),
        selectedTournamentId: null,
        selectedTournamentName: 'Не выбран (откройте лобби турнира)',
        sessionId: null,
        deviceToken: null,
        wsUrl: null,
        autoScanEnabled: true,
        lobbyPollTimer: null
    };

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
            this.tournamentName = OFC_DB.selectedTournamentName || 'OFC Pineapple';
            this.tournamentId = OFC_DB.selectedTournamentId || null;
            this.gameType = 'OFC_PINEAPPLE_OH';
            this.fantasyMode = 'UNLIMITED_PROGRESSIVE';
            this.pointScoreChips = 100;
            this.heroSeat = null;
            this.seats = new Map();
            this.hand = null;
            this.isOFC = true;
            this.isOpen = true;
            this.lastActiveTime = Date.now();
        }

        updatePlayer(seat, nick, uuid = null) {
            if (nick && !nick.startsWith('Seat ')) {
                this.seats.set(seat, { seat, nickname: nick, uuid });
                if (this.hand && this.hand.players[seat]) {
                    this.hand.players[seat].nickname = nick;
                    if (uuid) this.hand.players[seat].uuid = uuid;
                }
            }
        }

        startHand(handId, dealer, gameNum = 1, gamesCount = 1) {
            if (!this.isOpen || !this.isOFC) return;
            let isFantasyRound = (gameNum > 1);
            let hasJokers = this.gameType.includes('JOKER') || (OFC_DB.selectedTournamentName && OFC_DB.selectedTournamentName.includes('Джокер'));

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
                this.hand.players[s] = {
                    seat: s,
                    nickname: p.nickname || `Seat ${s}`,
                    uuid: p.uuid,
                    is_hero: (s === this.heroSeat),
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 },
                    is_foul: false,
                    foul_reason: null,
                    score_points: 0,
                    chips_delta: 0,
                    qualified_for_next_fantasy: false
                };
            });
        }

        getPlayer(seat) {
            if (!this.hand) return null;
            if (!this.hand.players[seat]) {
                let p = this.seats.get(seat) || { nickname: `Seat ${seat}`, uuid: null };
                this.hand.players[seat] = {
                    seat: seat,
                    nickname: p.nickname,
                    uuid: p.uuid,
                    is_hero: (seat === this.heroSeat),
                    is_fantasy: false,
                    fantasy_cards_count: 0,
                    streets: [],
                    discards: [],
                    final_board: { front: [], middle: [], back: [] },
                    combinations: { front: '', middle: '', back: '' },
                    royalties: { front: 0, middle: 0, back: 0, total: 0 },
                    is_foul: false,
                    foul_reason: null,
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

            /* Авто-калибровка куша по математике шоудауна */
            let firstValid = h.showdowns.find(s => s.points > 0 && s.chips_delta > 0);
            if (firstValid) {
                let actualKush = Math.round(firstValid.chips_delta / firstValid.points);
                if (actualKush > 0) h.tournament.point_score_chips = actualKush;
            }

            h.players = Object.values(h.players);

            if (!OFC_DB.handIds.has(h.hand_id)) {
                OFC_DB.handIds.add(h.hand_id);
                OFC_DB.hands.push(h);
                updateUI();
                console.log(`%c🍍 [OFC Engine v5.2] Раздача #${h.hand_id} сохранена (${h.tournament.table_name})!`, 'color:#10b981;font-weight:bold;');
            }
            this.hand = null;
        }
    }

    function getOrCreateTable(tId) {
        if (!OFC_DB.tables.has(tId)) {
            OFC_DB.tables.set(tId, new TableSession(tId));
        }
        let t = OFC_DB.tables.get(tId);
        t.isOpen = true;
        t.lastActiveTime = Date.now();
        return t;
    }

    function getSessionForSocket(ws, xml) {
        if (ws.__ofcSession) {
            ws.__ofcSession.lastActiveTime = Date.now();
            return ws.__ofcSession;
        }
        let tId = attr(xml, 'id') || attr(xml, 'tableId');
        if (tId && tId.startsWith('f54-')) {
            ws.__ofcSession = getOrCreateTable(tId);
            return ws.__ofcSession;
        }
        return null;
    }

    /* ── ГЛАВНЫЙ ОБРАБОТЧИК СООБЩЕНИЙ ──────────────────────────────── */
    function parseMessage(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        /* Перехват авторизационных токенов */
        if (xml.includes('sessionId=')) OFC_DB.sessionId = attr(xml, 'sessionId') || OFC_DB.sessionId;
        if (xml.includes('deviceToken=')) OFC_DB.deviceToken = attr(xml, 'deviceToken') || OFC_DB.deviceToken;

        /* Отслеживание турнирного лобби */
        if (xml.includes('<TournamentDetails') || xml.includes('<ScheduledTournament')) {
            let tId = attr(xml, 'id');
            let tName = attr(xml, 'name');
            let gType = attr(xml, 'game') || '';
            if (tId && (gType.includes('OFC') || gType.includes('PINEAPPLE') || xml.includes('PINEAPPLE') || xml.includes('Ананас'))) {
                OFC_DB.selectedTournamentId = tId;
                if (tName) OFC_DB.selectedTournamentName = tName;
                OFC_DB.lobbySocket = ws;
                startLobbyPoller();
                updateUI();
            }
        }

        /* Обнаружение столов турнира */
        if (xml.includes('<Tables')) {
            let tMatches = xml.matchAll(/<Table\s+[^>]*?\bid="(f54-[^"]+)"/gi);
            for (let tm of tMatches) {
                let foundTableId = tm[1];
                if (!OFC_DB.ghostSockets.has(foundTableId)) {
                    launchGhostSpectator(foundTableId);
                }
            }
        }

        /* Закрытие стола */
        if (xml.includes('description="Table is already closed"') || xml.includes('<CloseTable') || xml.includes('<LeaveTable')) {
            let cTableId = ws.__tableId || attr(xml, 'id') || attr(xml, 'tableId');
            if (cTableId) {
                closeTableSession(cTableId);
            }
        }

        /* 1. Детали стола */
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
            let tId = attr(xml, 'id') || attr(xml, 'tableId');
            if (tId && tId.startsWith('f54-')) {
                let table = getOrCreateTable(tId);
                ws.__ofcSession = table;
                ws.__tableId = tId;

                let gType = attr(xml, 'game') || '';
                table.isOFC = gType.includes('OFC') || gType.includes('PINEAPPLE') || xml.includes('PINEAPPLE') || xml.includes('Ананас');
                if (!table.isOFC) return;

                table.tournamentName = attr(xml, 'tournamentName') || attr(xml, 'name') || OFC_DB.selectedTournamentName || table.tournamentName;
                table.tournamentId = attr(xml, 'tournamentId') || OFC_DB.selectedTournamentId || table.tournamentId;
                table.tableName = attr(xml, 'name') || table.tableName;
                table.gameType = gType || table.gameType;
                table.fantasyMode = attr(xml, 'fantasy') || table.fantasyMode;
                table.pointScoreChips = iattr(xml, 'pointScore', table.pointScoreChips);

                let seatMatches = xml.matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>[\s\S]*?<PlayerInfo\s+[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
                for (let sm of seatMatches) {
                    table.updatePlayer(parseInt(sm[1], 10), sm[2], sm[3]);
                }
                updateUI();
            }
        }

        let table = getSessionForSocket(ws, xml);
        if (!table || !table.isOFC || !table.isOpen) return;

        /* 2. Обновление куша */
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*?\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let ps = parseInt(scoreMatch[1], 10);
            table.pointScoreChips = ps;
            if (table.hand && !table.hand.context.is_fantasy_round) {
                table.hand.tournament.point_score_chips = ps;
            }
        }

        /* 3. Hero Seat */
        let meMatch = xml.match(/<Seats\s+[^>]*?\bme="(\d+)"/i);
        if (meMatch) {
            table.heroSeat = parseInt(meMatch[1], 10);
            if (table.hand) table.hand.context.hero_seat = table.heroSeat;
        }

        /* 4. Захват никнеймов игроков */
        let npMatches = xml.matchAll(/(?:<NewPlayer|<PlayerInfo|<Player)\s+[^>]*?\bseat="(\d+)"[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
        for (let npm of npMatches) {
            table.updatePlayer(parseInt(npm[1], 10), npm[2], npm[3]);
        }

        /* 5. Старт руки */
        let nhM = xml.match(/<NewHand\s+([^>]*?)\/>/i);
        let gsM = xml.match(/<GameState\s+([^>]*?)\bhand="(\d+)"/i);
        if (nhM || gsM) {
            let hId = nhM ? attr(nhM[1], 'number') : gsM[2];
            let dealer = nhM ? iattr(nhM[1], 'dealer', 0) : iattr(xml, 'dealer', 0);
            let gNum = nhM ? iattr(nhM[1], 'gameNumber', 1) : 1;
            let gCnt = nhM ? iattr(nhM[1], 'gamesCount', 1) : 1;
            table.startHand(hId, dealer, gNum, gCnt);
        }

        if (!table.hand) return;

        /* 6. Сдача карт (Street 1: 5 карт; Streets 2-5: 3 карты; Fantasy: 14-17 карт) */
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
                    p.streets.push({
                        street: stNum,
                        street_name: p.is_fantasy ? `fantasy_deal_${cards.length}_cards` : `street_${stNum}`,
                        dealt_cards: cards,
                        placed: { front: [], middle: [], back: [] },
                        discarded: []
                    });
                }
            }
        }

        /* 7. Выставление карт на доску и сбросы (2 на доску, 1 в сброс; в Фантазии: 13 на доску, 1-4 в сброс) */
        let paMatches = xml.matchAll(/<PlayerAction\s+[^>]*?\bseat="(\d+)"[^>]*?>([\s\S]*?)<\/PlayerAction>/gi);
        for (let pam of paMatches) {
            let sn = parseInt(pam[1], 10);
            let body = pam[2];
            let p = table.getPlayer(sn);
            if (p && body.includes('<LayOut')) {
                let discM = body.match(/<Discarded>([\s\S]*?)<\/Discarded>/i);
                let discards = discM ? parseCards(discM[1]) : [];
                if (discards.length > 0) p.discards.push(...discards);

                let placed = { front: [], middle: [], back: [] };
                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rM = body.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"[^>]*?>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rM) {
                        let cList = parseCards(rM[1]);
                        let rowKey = row.toLowerCase();
                        placed[rowKey] = cList;

                        if (p.is_fantasy) {
                            p.final_board[rowKey] = cList;
                        } else {
                            cList.forEach(c => {
                                if (!p.final_board[rowKey].includes(c)) {
                                    p.final_board[rowKey].push(c);
                                }
                            });
                        }
                    }
                });

                if (p.streets.length > 0) {
                    let latest = p.streets[p.streets.length - 1];
                    latest.placed = placed;
                    latest.discarded = discards;
                }
            }
        }

        /* 8. Комбинации, Роялти, Джокеры и Фолы */
        let ccMatches = xml.matchAll(/<CombinationChange\s+([^>]*?)>([\s\S]*?)<\/CombinationChange>/gi);
        for (let ccm of ccMatches) {
            let cAttr = ccm[1];
            let cBody = ccm[2];
            let sn = iattr(cAttr, 'seat');
            let p = table.getPlayer(sn);
            if (p) {
                if (cAttr.includes('dead="true"')) {
                    p.is_foul = true;
                    p.foul_reason = 'Misplacement: Row strength hierarchy violation (Top <= Middle <= Bottom)';
                }

                ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                    let rowM = cBody.match(new RegExp(`<Hand\\s+([^>]*?\\bname="${row}"[^>]*?)>([\\s\\S]*?)<\\/Hand>`, 'i'));
                    if (rowM) {
                        let hAttr = rowM[1];
                        let cards = parseCards(rowM[2]);
                        let rowKey = row.toLowerCase();
                        if (cards.length > 0) p.final_board[rowKey] = cards;
                        
                        let roy = iattr(hAttr, 'royalty', 0);
                        let str = attr(hAttr, 'strength') || '';
                        p.royalties[rowKey] = roy;
                        if (str) p.combinations[rowKey] = str;
                    }
                });
                p.royalties.total = p.royalties.front + p.royalties.middle + p.royalties.back;
            }
        }

        /* 9. Шоудаун и построчные результаты */
        let sdMatches = xml.matchAll(/<Showdown\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Showdown>)/gi);
        for (let sdm of sdMatches) {
            let sAttr = sdm[1];
            let sBody = sdm[2] || '';
            let lineDetails = {};
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let lm = sBody.match(new RegExp(`<Hand\\s+[^>]*?\\bname="${row}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/Hand>)`, 'i'));
                if (lm) {
                    let lhAttr = lm[1];
                    lineDetails[row.toLowerCase()] = {
                        points: iattr(lhAttr, 'points', 0),
                        royalty: iattr(lhAttr, 'royalty', 0)
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

        /* 10. Победители и квалификация в Фантазию */
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

        /* 11. Финализация раздачи */
        if (xml.includes('<EndHand')) {
            table.finalize();
        }
    }

    /* ── ФОНОВЫЙ МАЙНЕР СТОЛОВ ТУРНИРА (GHOST SPECTATOR) ───────────── */
    function launchGhostSpectator(tableId) {
        if (!OFC_DB.wsUrl || !OFC_DB.sessionId || OFC_DB.ghostSockets.has(tableId)) return;
        if (OFC_DB.ghostSockets.size >= MAX_GHOST_TABLES) return;

        try {
            let table = getOrCreateTable(tableId);
            let gws = new NativeWebSocket(OFC_DB.wsUrl);
            gws.__tableId = tableId;
            gws.__ofcSession = table;
            OFC_DB.ghostSockets.set(tableId, gws);

            gws.onopen = function() {
                let enterMsg = `<EnterTable sessionId="${OFC_DB.sessionId}" tableId="${tableId}" tournamentId="${OFC_DB.selectedTournamentId || ''}" client="html5mobile" clientFace="pokerdom" deviceToken="${OFC_DB.deviceToken || ''}"/>`;
                gws.send(enterMsg);
                gws.send('<GetTableDetails/>');
                gws.send('<JoinTable/>');

                gws.__heartbeat = setInterval(() => {
                    if (gws.readyState === WebSocket.OPEN) {
                        try { gws.send('<GetServerTime/>'); } catch(e) {}
                    }
                }, 15000);
            };

            gws.onmessage = function(e) {
                let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                parseMessage(text, gws);
            };

            gws.onclose = function() {
                closeTableSession(tableId);
            };

            gws.onerror = function() {
                closeTableSession(tableId);
            };

            updateUI();
        } catch(err) {
            console.error('[Ghost Launch Error]', err);
        }
    }

    function closeTableSession(tableId) {
        let ws = OFC_DB.ghostSockets.get(tableId);
        if (ws) {
            if (ws.__heartbeat) clearInterval(ws.__heartbeat);
            try { ws.close(); } catch(e) {}
            OFC_DB.ghostSockets.delete(tableId);
        }
        if (OFC_DB.tables.has(tableId)) {
            OFC_DB.tables.get(tableId).isOpen = false;
        }
        updateUI();
    }

    /* ── АВТО-ОПРОС ЛОББИ ТУРНИРА ──────────────────────────────────── */
    function startLobbyPoller() {
        if (OFC_DB.lobbyPollTimer) clearInterval(OFC_DB.lobbyPollTimer);
        
        function poll() {
            if (OFC_DB.lobbySocket && OFC_DB.lobbySocket.readyState === WebSocket.OPEN) {
                try {
                    OFC_DB.lobbySocket.send('<GetTables count="50"/>');
                } catch(e) {}
            }
        }
        
        poll();
        OFC_DB.lobbyPollTimer = setInterval(poll, 6000);
    }

    /* ── WEBSOCKET PROXY ───────────────────────────────────────────── */
    let NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            if (args[0]) OFC_DB.wsUrl = args[0];

            ws.addEventListener('message', function(e) {
                try {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    parseMessage(text, ws);
                } catch(err) {
                    console.error('[OFC Proxy Error]', err);
                }
            });

            ws.addEventListener('close', function() {
                if (ws.__tableId) {
                    closeTableSession(ws.__tableId);
                }
            });

            return ws;
        }
    });

    /* ── СВОРАЧИВАЕМЫЙ МОБИЛЬНЫЙ HUD UI ────────────────────────────── */
    let hud = document.createElement('div');
    hud.id = 'ofc-god-hud-v52';
    hud.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999999;background:rgba(15,23,42,0.98);backdrop-filter:blur(12px);border:1px solid #10b981;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.9);color:#f8fafc;font-family:monospace;font-size:11px;user-select:none;max-width:340px;';

    hud.innerHTML = `
        <div id="ofc-hud-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;gap:8px;background:linear-gradient(135deg,rgba(16,185,129,0.2),transparent);border-radius:12px 12px 0 0;">
            <div style="display:flex;align-items:center;gap:6px;">
                <span id="ofc-hud-toggle-icon" style="color:#10b981;font-weight:900;font-size:13px;">▾</span>
                <strong style="color:#10b981;font-size:12px;">🍍 OFC TITAN v5.2</strong>
            </div>
            <span id="ofc-badge-hands-52" style="background:#059669;color:#fff;padding:2px 8px;border-radius:999px;font-weight:700;font-size:10px;">0 рук</span>
        </div>
        <div id="ofc-hud-body" style="padding:10px 14px 12px 14px;display:block;">
            <div style="font-size:10.5px;color:#94a3b8;margin-bottom:10px;line-height:1.6;">
                <div>Турнир: <b id="ofc-tourn-name-52" style="color:#fde047;">Не выбран</b></div>
                <div style="display:flex;justify-content:space-between;">
                    <span>Фоновых столов: <b id="ofc-badge-ghosts-52" style="color:#38bdf8;">0</b></span>
                    <span>Активных OFC: <b id="ofc-badge-tables-52" style="color:#a78bfa;">0</b></span>
                </div>
            </div>
            <div style="display:flex;gap:6px;">
                <button id="ofc-btn-save-52" style="flex:1;background:linear-gradient(135deg,#059669,#10b981);color:#000;border:none;padding:8px 10px;border-radius:6px;font-weight:800;cursor:pointer;">💾 Скачать JSON</button>
                <button id="ofc-btn-scan-52" style="background:#0891b2;color:#fff;border:none;padding:8px 10px;border-radius:6px;font-weight:700;cursor:pointer;">🔄 Скан</button>
                <button onclick="document.getElementById('ofc-god-hud-v52').remove();window.__ofcTitanEngineV52=false;" style="background:transparent;border:1px solid #475569;color:#94a3b8;padding:0 8px;border-radius:6px;cursor:pointer;">✕</button>
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

    document.getElementById('ofc-btn-scan-52').onclick = function(e) {
        e.stopPropagation();
        if (OFC_DB.lobbySocket && OFC_DB.lobbySocket.readyState === WebSocket.OPEN) {
            OFC_DB.lobbySocket.send('<GetTables count="50"/>');
        }
    };

    function updateUI() {
        let bHands = document.getElementById('ofc-badge-hands-52');
        let bGhosts = document.getElementById('ofc-badge-ghosts-52');
        let bTables = document.getElementById('ofc-badge-tables-52');
        let tName = document.getElementById('ofc-tourn-name-52');
        
        let activeOFC = Array.from(OFC_DB.tables.values()).filter(t => t.isOpen && t.isOFC).length;
        if (bHands) bHands.innerText = `${OFC_DB.hands.length} рук`;
        if (bGhosts) bGhosts.innerText = `${OFC_DB.ghostSockets.size}`;
        if (bTables) bTables.innerText = `${activeOFC}`;
        if (tName) tName.innerText = OFC_DB.selectedTournamentName;
    }

    document.getElementById('ofc-btn-save-52').onclick = function(e) {
        e.stopPropagation();
        let dump = {
            version: '5.2-OFC-OMNI-DATASET',
            currency: 'TOURNAMENT_CHIPS',
            exported_at: new Date().toISOString(),
            tournament_id: OFC_DB.selectedTournamentId,
            tournament_name: OFC_DB.selectedTournamentName,
            total_hands_count: OFC_DB.hands.length,
            hands: OFC_DB.hands
        };
        let blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_titan_v52_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    console.log('%c🍍 [OFC Titan Engine v5.2] Активирован. Точная пошаговая сборка 13 карт и сбросов запущена.', 'color:#10b981;font-weight:bold;font-size:13px;');
})();

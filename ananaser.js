javascript:(function(){
    if (window.__ofcEngineV33) {
        alert('🍍 OFC Engine v3.3 (Multi-Table Isolation) уже активен!');
        return;
    }
    window.__ofcEngineV33 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE MASTER ENGINE v3.3 — MULTI-TABLE ISOLATED
       ══════════════════════════════════════════════════════════════════ */

    const OFC_DB = {
        tables: new Map(),
        hands: [],
        handIds: new Set()
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

    class TableSession {
        constructor(tableId) {
            this.tableId = tableId;
            this.tableName = 'Table';
            this.tournamentName = 'OFC Pineapple';
            this.tournamentId = null;
            this.gameType = 'OFC_PINEAPPLE_OH';
            this.fantasyMode = 'UNLIMITED_PROGRESSIVE';
            this.pointScoreChips = 100;
            this.heroSeat = null;
            this.seats = new Map();
            this.hand = null;
            this.isOFC = true;
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
            if (!this.isOFC) return;
            let isFantasy = (gameNum > 1);
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
                    has_jokers: this.gameType.includes('JOKER'),
                    point_score_chips: this.pointScoreChips
                },
                context: {
                    dealer_seat: dealer,
                    hero_seat: this.heroSeat,
                    is_fantasy_round: isFantasy,
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

            /* Фильтрация фантомных не-OFC раздач (проверка наличия досок или шоудаунов) */
            let hasValidOFCData = h.showdowns.length > 0 || Object.values(h.players).some(p => 
                p.final_board.front.length > 0 || p.final_board.middle.length > 0 || p.final_board.back.length > 0 || p.is_foul
            );

            if (!hasValidOFCData) {
                this.hand = null;
                return;
            }

            /* Авто-коррекция куша по математике шоудауна */
            let firstValid = h.showdowns.find(s => s.points > 0 && s.chips_delta > 0);
            if (firstValid) {
                let actualKush = Math.round(firstValid.chips_delta / firstValid.points);
                if (actualKush > 0) {
                    h.tournament.point_score_chips = actualKush;
                }
            }

            h.players = Object.values(h.players);

            if (!OFC_DB.handIds.has(h.hand_id)) {
                OFC_DB.handIds.add(h.hand_id);
                OFC_DB.hands.push(h);
                updateUI();
                console.log(`%c🍍 [OFC Engine v3.3] Раздача #${h.hand_id} сохранена (Стол: ${h.tournament.table_name})!`, 'color:#10b981;font-weight:bold;');
            }
            this.hand = null;
        }
    }

    function getSessionForSocket(ws, xml) {
        if (ws.__ofcSession) return ws.__ofcSession;

        let tId = attr(xml, 'id') || attr(xml, 'tableId');
        if (tId) {
            if (!OFC_DB.tables.has(tId)) {
                OFC_DB.tables.set(tId, new TableSession(tId));
            }
            ws.__ofcSession = OFC_DB.tables.get(tId);
            return ws.__ofcSession;
        }
        return ws.__ofcSession || null;
    }

    function parseMessage(xml, ws) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        let table = getSessionForSocket(ws, xml);

        /* 1. Обработка деталей стола */
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable')) {
            let tId = attr(xml, 'id') || attr(xml, 'tableId');
            if (tId) {
                table = getSessionForSocket(ws, xml);
                let gType = attr(xml, 'game') || '';
                table.isOFC = gType.includes('OFC') || gType.includes('PINEAPPLE');
                if (!table.isOFC) return;

                table.tournamentName = attr(xml, 'tournamentName') || attr(xml, 'name') || table.tournamentName;
                table.tournamentId = attr(xml, 'tournamentId') || table.tournamentId;
                table.tableName = attr(xml, 'name') || table.tableName;
                table.gameType = gType || table.gameType;
                table.fantasyMode = attr(xml, 'fantasy') || table.fantasyMode;
                table.pointScoreChips = iattr(xml, 'pointScore', table.pointScoreChips);

                let seatMatches = xml.matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>[\s\S]*?<PlayerInfo\s+[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
                for (let sm of seatMatches) {
                    table.updatePlayer(parseInt(sm[1], 10), sm[2], sm[3]);
                }
            }
        }

        if (!table || !table.isOFC) return;

        /* 2. Обновление куша */
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*?\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let ps = parseInt(scoreMatch[1], 10);
            table.pointScoreChips = ps;
            if (table.hand && !table.hand.context.is_fantasy_round) {
                table.hand.tournament.point_score_chips = ps;
            }
        }

        /* 3. Определение Hero */
        let meMatch = xml.match(/<Seats\s+[^>]*?\bme="(\d+)"/i);
        if (meMatch) {
            table.heroSeat = parseInt(meMatch[1], 10);
            if (table.hand) table.hand.context.hero_seat = table.heroSeat;
        }

        /* 4. Подсадка игроков */
        let npMatches = xml.matchAll(/<NewPlayer\s+[^>]*?\bseat="(\d+)"[^>]*?>[\s\S]*?<PlayerInfo\s+[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
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

        /* 6. Сдача карт */
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

        /* 7. Выставление карт */
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
                    if (rM) placed[row.toLowerCase()] = parseCards(rM[1]);
                });

                if (p.streets.length > 0) {
                    let latest = p.streets[p.streets.length - 1];
                    latest.placed = placed;
                    latest.discarded = discards;
                }
            }
        }

        /* 8. Комбинации, Роялти и Фолы */
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

        /* 9. Шоудаун */
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
                is_scoop: iattr(sAttr, 'scoop', 0) > 0,
                chips_delta: iattr(sAttr, 'cash', 0),
                lines: lineDetails
            });
        }

        /* 10. Победители */
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

        /* 11. Завершение раздачи */
        if (xml.includes('<EndHand')) {
            table.finalize();
        }
    }

    /* WebSocket Hook с привязкой сессии */
    let NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            ws.addEventListener('message', function(e) {
                try {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    parseMessage(text, ws);
                } catch(err) {
                    console.error('[OFC v3.3 Error]', err);
                }
            });
            return ws;
        }
    });

    /* HUD UI */
    let hud = document.createElement('div');
    hud.id = 'ofc-hud-v33';
    hud.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999999;background:rgba(15,23,42,0.95);backdrop-filter:blur(10px);border:1px solid rgba(16,185,129,0.5);border-radius:12px;padding:12px 16px;box-shadow:0 12px 32px rgba(0,0,0,0.85);color:#f8fafc;font-family:ui-monospace,monospace;font-size:12px;min-width:250px;';
    hud.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:900;color:#10b981;font-size:13px;">🍍 OFC ENGINE v3.3</span>
            <span id="ofc-badge-hands-33" style="background:#047857;color:#ecfdf5;padding:2px 8px;border-radius:999px;font-weight:700;">0 рук</span>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">
            <div>OFC Столы: <b id="ofc-badge-tables-33" style="color:#38bdf8;">0</b></div>
            <div>Статус: <b id="ofc-badge-status-33" style="color:#a78bfa;">Изоляция активна</b></div>
        </div>
        <div style="display:flex;gap:6px;">
            <button id="ofc-btn-save-33" style="flex:1;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">💾 Скачать JSON</button>
            <button id="ofc-btn-clip-33" style="background:#334155;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">📋 Копия</button>
        </div>
    `;
    document.body.appendChild(hud);

    function updateUI() {
        let bHands = document.getElementById('ofc-badge-hands-33');
        let bTables = document.getElementById('ofc-badge-tables-33');
        if (bHands) bHands.innerText = `${OFC_DB.hands.length} рук`;
        if (bTables) bTables.innerText = `${Array.from(OFC_DB.tables.values()).filter(t => t.isOFC).length}`;
    }

    function exportPayload() {
        return {
            version: '3.3-OFC-AI-DATASET',
            currency: 'TOURNAMENT_CHIPS',
            exported_at: new Date().toISOString(),
            total_hands_count: OFC_DB.hands.length,
            hands: OFC_DB.hands
        };
    }

    document.getElementById('ofc-btn-save-33').onclick = function() {
        let blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_clean_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    document.getElementById('ofc-btn-clip-33').onclick = function() {
        navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2)).then(() => {
            alert('🍍 Чистый OFC датасет скопирован в буфер обмена!');
        });
    };

    console.log('%c🍍 [OFC Engine v3.3] Запущен с защитой от кросс-столового загрязнения.', 'color:#10b981;font-weight:bold;font-size:13px;');
})();

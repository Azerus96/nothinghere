javascript:(function(){
    if (window.__ofcEngineV32) {
        alert('🍍 OFC Master Engine v3.2 уже запущен!');
        return;
    }
    window.__ofcEngineV32 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE MASTER ENGINE v3.2 (CHIPS & ATTRIBUTE-ORDER FIX)
       ══════════════════════════════════════════════════════════════════ */

    const STORE = {
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
            let isFantasyRound = (gameNum > 1);
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
            if (!this.hand || !this.hand.hand_id) return;
            let h = this.hand;

            /* Авто-коррекция куша по шоудауну, если была рассинхронизация */
            if (h.showdowns.length > 0) {
                let firstValid = h.showdowns.find(s => s.points > 0 && s.chips_delta > 0);
                if (firstValid) {
                    let actualKush = Math.round(firstValid.chips_delta / firstValid.points);
                    if (actualKush > 0) {
                        h.tournament.point_score_chips = actualKush;
                    }
                }
            }

            h.players = Object.values(h.players);

            if (!STORE.handIds.has(h.hand_id)) {
                STORE.handIds.add(h.hand_id);
                STORE.hands.push(h);
                updateUI();
                console.log(`%c🍍 [OFC Engine v3.2] Раздача #${h.hand_id} успешно записана!`, 'color:#10b981;font-weight:bold;');
            }
            this.hand = null;
        }
    }

    function getTable(id) {
        if (!STORE.tables.has(id)) {
            STORE.tables.set(id, new TableSession(id));
        }
        return STORE.tables.get(id);
    }

    function parseMessage(xml) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        /* 1. Метаданные стола и турнира */
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable') || xml.includes('<TournamentDetails')) {
            let tId = attr(xml, 'id') || attr(xml, 'tableId');
            if (tId) {
                let t = getTable(tId);
                t.tournamentName = attr(xml, 'tournamentName') || attr(xml, 'name') || t.tournamentName;
                t.tournamentId = attr(xml, 'tournamentId') || t.tournamentId;
                t.tableName = attr(xml, 'name') || t.tableName;
                t.gameType = attr(xml, 'game') || t.gameType;
                t.fantasyMode = attr(xml, 'fantasy') || t.fantasyMode;
                t.pointScoreChips = iattr(xml, 'pointScore', t.pointScoreChips);

                let seatMatches = xml.matchAll(/<Seat\s+[^>]*?\bid="(\d+)"[^>]*?>[\s\S]*?<PlayerInfo\s+[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
                for (let sm of seatMatches) {
                    t.updatePlayer(parseInt(sm[1], 10), sm[2], sm[3]);
                }
            }
        }

        /* 2. Обновление куша из игровых пакетов */
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*?\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let ps = parseInt(scoreMatch[1], 10);
            STORE.tables.forEach(t => {
                t.pointScoreChips = ps;
                if (t.hand && !t.hand.context.is_fantasy_round) {
                    t.hand.tournament.point_score_chips = ps;
                }
            });
        }

        /* 3. Определение Hero Seat */
        let meMatch = xml.match(/<Seats\s+[^>]*?\bme="(\d+)"/i);
        if (meMatch) {
            let hs = parseInt(meMatch[1], 10);
            STORE.tables.forEach(t => { t.heroSeat = hs; });
        }

        /* 4. Обновление игроков (NewPlayer, Entry, Seats) */
        let npMatches = xml.matchAll(/<NewPlayer\s+[^>]*?\bseat="(\d+)"[^>]*?>[\s\S]*?<PlayerInfo\s+[^>]*?\bnickname="([^"]+)"(?:[^>]*?\buuid="([^"]+)")?/gi);
        for (let npm of npMatches) {
            let sn = parseInt(npm[1], 10);
            STORE.tables.forEach(t => t.updatePlayer(sn, npm[2], npm[3]));
        }

        /* 5. Инициализация раздачи */
        let nhM = xml.match(/<NewHand\s+([^>]*?)\/>/i);
        let gsM = xml.match(/<GameState\s+([^>]*?)\bhand="(\d+)"/i);
        if (nhM || gsM) {
            let t = STORE.tables.values().next().value;
            if (t) {
                let hId = nhM ? attr(nhM[1], 'number') : gsM[2];
                let dealer = nhM ? iattr(nhM[1], 'dealer', 0) : iattr(xml, 'dealer', 0);
                let gNum = nhM ? iattr(nhM[1], 'gameNumber', 1) : 1;
                let gCnt = nhM ? iattr(nhM[1], 'gamesCount', 1) : 1;
                t.startHand(hId, dealer, gNum, gCnt);
            }
        }

        let table = STORE.tables.values().next().value;
        if (!table || !table.hand) return;

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

        /* 8. Комбинации, Роялти и Доска (Парсинг без зависимости от порядка атрибутов) */
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

        /* 9. Шоудаун (Самозакрывающиеся и парные теги) */
        let sdMatches = xml.matchAll(/<Showdown\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Showdown>)/gi);
        for (let sdm of sdMatches) {
            let sAttr = sdm[1];
            let sBody = sdm[2] || '';
            let lineDetails = {};
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let lm = sBody.match(new RegExp(`<Hand\\s+([^>]*?\\bname="${row}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/Hand>)`, 'i'));
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

        /* 11. Завершение раздачи */
        if (xml.includes('<EndHand')) {
            table.finalize();
        }
    }

    /* WebSocket Proxy */
    let NativeWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            ws.addEventListener('message', function(e) {
                try {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    parseMessage(text);
                } catch(err) {
                    console.error('[OFC Master Error]', err);
                }
            });
            return ws;
        }
    });

    /* HUD UI */
    let hud = document.createElement('div');
    hud.id = 'ofc-hud-v32';
    hud.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999999;background:rgba(15,23,42,0.95);backdrop-filter:blur(10px);border:1px solid rgba(16,185,129,0.5);border-radius:12px;padding:12px 16px;box-shadow:0 12px 32px rgba(0,0,0,0.85);color:#f8fafc;font-family:ui-monospace,monospace;font-size:12px;min-width:250px;';
    hud.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:900;color:#10b981;font-size:13px;">🍍 OFC ENGINE v3.2</span>
            <span id="ofc-badge-hands" style="background:#047857;color:#ecfdf5;padding:2px 8px;border-radius:999px;font-weight:700;">0 рук</span>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">
            <div>Куш: <b id="ofc-badge-kush" style="color:#38bdf8;">-- фишек</b></div>
            <div>Статус: <b id="ofc-badge-status" style="color:#a78bfa;">Ожидание...</b></div>
        </div>
        <div style="display:flex;gap:6px;">
            <button id="ofc-btn-save" style="flex:1;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">💾 Скачать JSON</button>
            <button id="ofc-btn-clip" style="background:#334155;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">📋 Копия</button>
        </div>
    `;
    document.body.appendChild(hud);

    function updateUI() {
        let bHands = document.getElementById('ofc-badge-hands');
        let bKush = document.getElementById('ofc-badge-kush');
        let bStatus = document.getElementById('ofc-badge-status');
        if (bHands) bHands.innerText = `${STORE.hands.length} рук`;
        let t = STORE.tables.values().next().value;
        if (t && bKush) bKush.innerText = `${t.pointScoreChips} фишек`;
        if (t && bStatus) bStatus.innerText = t.hand ? `Раздача #${t.hand.hand_id}` : 'В ожидании';
    }

    function exportPayload() {
        return {
            version: '3.2-OFC-AI-DATASET',
            currency: 'TOURNAMENT_CHIPS',
            exported_at: new Date().toISOString(),
            total_hands_count: STORE.hands.length,
            hands: STORE.hands
        };
    }

    document.getElementById('ofc-btn-save').onclick = function() {
        let blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_chips_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    document.getElementById('ofc-btn-clip').onclick = function() {
        navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2)).then(() => {
            alert('🍍 Датасет (в фишках) скопирован в буфер обмена!');
        });
    };

    console.log('%c🍍 [OFC Engine v3.2] Запущен. Чистый захват фишек, ников и роялти активен.', 'color:#10b981;font-weight:bold;font-size:13px;');
})();

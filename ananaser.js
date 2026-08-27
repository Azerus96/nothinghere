javascript:(function(){
    if (window.__ofcMasterTrackerV3) {
        alert('🍍 OFC Pineapple Master Tracker v3.0 уже активен!');
        return;
    }
    window.__ofcMasterTrackerV3 = true;

    /* ══════════════════════════════════════════════════════════════════
       OFC PINEAPPLE MASTER TRACKER v3.0 — AI & CFR READY ENGINE
       ══════════════════════════════════════════════════════════════════ */

    const OFC_STORAGE = {
        tables: new Map(),
        hands: [],
        handNumbers: new Set()
    };

    function getAttr(xml, attrName) {
        if (!xml || typeof xml !== 'string') return null;
        let m = xml.match(new RegExp(`(?:\\b|\\s)${attrName}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
    }

    function getIntAttr(xml, attrName, defVal = null) {
        let v = getAttr(xml, attrName);
        if (v === null || v === undefined) return defVal;
        let n = parseInt(v, 10);
        return isNaN(n) ? defVal : n;
    }

    function parseCards(xmlSubStr) {
        if (!xmlSubStr) return [];
        let cards = [];
        let re = /<Card[^>]*>([^<]+)<\/Card>/gi;
        let m;
        while ((m = re.exec(xmlSubStr)) !== null) {
            cards.push(m[1].trim());
        }
        return cards;
    }

    class TableSession {
        constructor(tableId) {
            this.tableId = tableId;
            this.tableName = `Table #${tableId.slice(-4)}`;
            this.tournamentName = 'OFC Tournament';
            this.tournamentId = null;
            this.gameType = 'OFC_PINEAPPLE_OH';
            this.fantasyMode = 'UNLIMITED_PROGRESSIVE';
            this.hasJokers = false;
            this.currentPointScore = 100;
            this.heroSeat = null;
            this.seats = new Map();
            this.activeHand = null;
        }

        updateSeat(seatId, nickname, uuid = null) {
            this.seats.set(seatId, {
                seat: seatId,
                nickname: nickname || `Seat ${seatId}`,
                uuid: uuid
            });
        }

        startHand(handNumber, dealerSeat, gameNum = 1, gamesCount = 1) {
            let isFantasyRound = (gameNum > 1);
            this.activeHand = {
                hand_id: String(handNumber),
                timestamp: new Date().toISOString(),
                tournament: {
                    tournament_id: this.tournamentId,
                    tournament_name: this.tournamentName,
                    table_id: this.tableId,
                    table_name: this.tableName,
                    game_type: this.gameType,
                    fantasy_mode: this.fantasyMode,
                    has_jokers: this.hasJokers,
                    point_score_rub: this.currentPointScore
                },
                context: {
                    dealer_seat: dealerSeat,
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

            this.seats.forEach((player, seatId) => {
                this.activeHand.players[seatId] = {
                    seat: seatId,
                    nickname: player.nickname,
                    uuid: player.uuid,
                    is_hero: (seatId === this.heroSeat),
                    is_fantasy: isFantasyRound,
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

        ensurePlayer(seatId) {
            if (!this.activeHand) return null;
            if (!this.activeHand.players[seatId]) {
                let p = this.seats.get(seatId) || { nickname: `Seat ${seatId}`, uuid: null };
                this.activeHand.players[seatId] = {
                    seat: seatId,
                    nickname: p.nickname,
                    uuid: p.uuid,
                    is_hero: (seatId === this.heroSeat),
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
            return this.activeHand.players[seatId];
        }

        recordDealing(streetNum, seatId, cards) {
            let p = this.ensurePlayer(seatId);
            if (!p) return;

            if (cards.length > 5) {
                p.is_fantasy = true;
                p.fantasy_cards_count = cards.length;
                this.activeHand.context.is_fantasy_round = true;
            }

            p.streets.push({
                street: streetNum,
                street_name: p.is_fantasy ? `fantasy_deal_${cards.length}_cards` : `street_${streetNum}`,
                dealt_cards: cards,
                placed: { front: [], middle: [], back: [] },
                discarded: []
            });
        }

        recordAction(seatId, bodyXml) {
            let p = this.ensurePlayer(seatId);
            if (!p) return;

            let discM = bodyXml.match(/<Discarded>([\s\S]*?)<\/Discarded>/i);
            let discards = discM ? parseCards(discM[1]) : [];
            if (discards.length > 0) {
                p.discards.push(...discards);
            }

            let placed = { front: [], middle: [], back: [] };
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let rowM = bodyXml.match(new RegExp(`<Hand\\s+name="${row}"[^>]*>([\\s\\S]*?)<\\/Hand>`, 'i'));
                if (rowM) {
                    placed[row.toLowerCase()] = parseCards(rowM[1]);
                }
            });

            if (p.streets.length > 0) {
                let curStreet = p.streets[p.streets.length - 1];
                curStreet.placed = placed;
                curStreet.discarded = discards;
            }
        }

        recordCombination(seatId, cAttr, bodyXml) {
            let p = this.ensurePlayer(seatId);
            if (!p) return;

            if (cAttr.includes('dead="true"')) {
                p.is_foul = true;
                p.foul_reason = 'Misplacement: Row strength hierarchy violation (Top <= Middle <= Bottom)';
            }

            let roySum = 0;
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let rowM = bodyXml.match(new RegExp(`<Hand\\s+name="${row}"(?:\s+royalty="(\\d+)")?(?:\s+strength="([^"]+)")?[^>]*>([\\s\\S]*?)<\\/Hand>`, 'i'));
                if (rowM) {
                    let cards = parseCards(rowM[3]);
                    let rowKey = row.toLowerCase();
                    if (cards.length > 0) {
                        p.final_board[rowKey] = cards;
                    }
                    if (rowM[1]) {
                        let r = parseInt(rowM[1], 10);
                        p.royalties[rowKey] = r;
                        roySum += r;
                    }
                    if (rowM[2]) {
                        p.combinations[rowKey] = rowM[2];
                    }
                }
            });
            p.royalties.total = roySum;
        }

        finalizeHand() {
            if (!this.activeHand || !this.activeHand.hand_id) return null;
            let hand = this.activeHand;
            hand.players = Object.values(hand.players);

            if (!OFC_STORAGE.handNumbers.has(hand.hand_id)) {
                OFC_STORAGE.handNumbers.add(hand.hand_id);
                OFC_STORAGE.hands.push(hand);
                updateHudUI();
                console.log(`%c🍍 [OFC Master Tracker] Раздача #${hand.hand_id} успешно записана!`, 'color:#10b981;font-weight:bold;');
            }
            this.activeHand = null;
        }
    }

    function getOrCreateTable(tableId) {
        if (!OFC_STORAGE.tables.has(tableId)) {
            OFC_STORAGE.tables.set(tableId, new TableSession(tableId));
        }
        return OFC_STORAGE.tables.get(tableId);
    }

    function processMessage(xml) {
        if (!xml || typeof xml !== 'string' || !xml.startsWith('<')) return;

        /* 1. Обработка стола и турнира */
        if (xml.includes('<TableDetails') || xml.includes('<TournamentTable') || xml.includes('<TournamentDetails')) {
            let tableId = getAttr(xml, 'id') || getAttr(xml, 'tableId');
            if (tableId) {
                let table = getOrCreateTable(tableId);
                table.tournamentName = getAttr(xml, 'tournamentName') || getAttr(xml, 'name') || table.tournamentName;
                table.tournamentId = getAttr(xml, 'tournamentId') || table.tournamentId;
                table.tableName = getAttr(xml, 'name') || table.tableName;
                table.gameType = getAttr(xml, 'game') || table.gameType;
                table.hasJokers = table.gameType.includes('JOKER');
                table.fantasyMode = getAttr(xml, 'fantasy') || table.fantasyMode;
                table.currentPointScore = getIntAttr(xml, 'pointScore', table.currentPointScore);

                let seatRe = /<Seat\s+[^>]*\bid="(\d+)"[^>]*>[\s\S]*?<PlayerInfo[^>]*\bnickname="([^"]+)"(?:[^>]*\buuid="([^"]+)")?/gi;
                let sm;
                while ((sm = seatRe.exec(xml)) !== null) {
                    table.updateSeat(parseInt(sm[1], 10), sm[2], sm[3]);
                }
            }
        }

        /* 2. Обновление куша уровня */
        let scoreMatch = xml.match(/(?:<CurrentLevel|<PlayerStackAdjusted|<Parameters|<HandInfo)\s+[^>]*\bpointScore="(\d+)"/i);
        if (scoreMatch) {
            let newScore = parseInt(scoreMatch[1], 10);
            OFC_STORAGE.tables.forEach(t => {
                t.currentPointScore = newScore;
                if (t.activeHand) t.activeHand.tournament.point_score_rub = newScore;
            });
        }

        /* 3. Определение Hero Seat */
        let heroSeatMatch = xml.match(/<Seats\s+[^>]*\bme="(\d+)"/i);
        if (heroSeatMatch) {
            let hs = parseInt(heroSeatMatch[1], 10);
            OFC_STORAGE.tables.forEach(t => { t.heroSeat = hs; });
        }

        /* 4. Смена/подсадка игроков */
        let npRe = /<NewPlayer\s+[^>]*\bseat="(\d+)"[^>]*>[\s\S]*?<PlayerInfo[^>]*\bnickname="([^"]+)"(?:[^>]*\buuid="([^"]+)")?/gi;
        let npm;
        while ((npm = npRe.exec(xml)) !== null) {
            let sn = parseInt(npm[1], 10);
            let nick = npm[2];
            let uuid = npm[3];
            OFC_STORAGE.tables.forEach(t => t.updateSeat(sn, nick, uuid));
        }

        /* 5. Инициализация раздачи */
        let nhM = xml.match(/<NewHand\s+([^>]*)\/>/i);
        let gsM = xml.match(/<GameState\s+([^>]*)\bhand="(\d+)"/i);
        if (nhM || gsM) {
            let t = OFC_STORAGE.tables.values().next().value;
            if (t) {
                let hNum = nhM ? getAttr(nhM[1], 'number') : gsM[2];
                let dealer = nhM ? getIntAttr(nhM[1], 'dealer', 0) : getIntAttr(xml, 'dealer', 0);
                let gameNum = nhM ? getIntAttr(nhM[1], 'gameNumber', 1) : 1;
                let gamesCount = nhM ? getIntAttr(nhM[1], 'gamesCount', 1) : 1;
                t.startHand(hNum, dealer, gameNum, gamesCount);
            }
        }

        let table = OFC_STORAGE.tables.values().next().value;
        if (!table || !table.activeHand) return;

        /* 6. Раздача карт по улицам */
        let dealRe = /<DealingCards(?:\s+street="(\d+)")?>([\s\S]*?)<\/DealingCards>/gi;
        let dm;
        while ((dm = dealRe.exec(xml)) !== null) {
            let streetNum = dm[1] ? parseInt(dm[1], 10) : (table.activeHand.context.is_fantasy_round ? 0 : 1);
            let dBody = dm[2];
            let seatDealRe = /<Seat\s+id="(\d+)">\s*<Cards>([\s\S]*?)<\/Cards>\s*<\/Seat>/gi;
            let sdm;
            while ((sdm = seatDealRe.exec(dBody)) !== null) {
                let sn = parseInt(sdm[1], 10);
                let cards = parseCards(sdm[2]);
                table.recordDealing(streetNum, sn, cards);
            }
        }

        /* 7. Действия игроков на доске */
        let actRe = /<PlayerAction\s+seat="(\d+)"[^>]*>([\s\S]*?)<\/PlayerAction>/gi;
        let am;
        while ((am = actRe.exec(xml)) !== null) {
            let sn = parseInt(am[1], 10);
            let pBody = am[2];
            if (pBody.includes('<LayOut')) {
                table.recordAction(sn, pBody);
            }
        }

        /* 8. Изменение комбинаций / Доска / Роялти */
        let combRe = /<CombinationChange\s+([^>]*?)>([\s\S]*?)<\/CombinationChange>/gi;
        let cm;
        while ((cm = combRe.exec(xml)) !== null) {
            let cAttr = cm[1];
            let cBody = cm[2];
            let sn = getIntAttr(cAttr, 'seat');
            if (sn !== null) {
                table.recordCombination(sn, cAttr, cBody);
            }
        }

        /* 9. Сравнение комбинаций на шоудауне (Showdown) */
        let sdRe = /<Showdown\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Showdown>)/gi;
        let sdm;
        while ((sdm = sdRe.exec(xml)) !== null) {
            let sAttr = sdm[1];
            let sBody = sdm[2] || '';
            let lineDetails = {};
            ['FRONT', 'MIDDLE', 'BACK'].forEach(row => {
                let lm = sBody.match(new RegExp(`<Hand\\s+name="${row}"(?:\s+points="([^"]+)")?(?:\s+royalty="([^"]+)")?`, 'i'));
                if (lm) {
                    lineDetails[row.toLowerCase()] = {
                        points: lm[1] ? parseInt(lm[1], 10) : 0,
                        royalty: lm[2] ? parseInt(lm[2], 10) : 0
                    };
                }
            });
            table.activeHand.showdowns.push({
                winner_seat: getIntAttr(sAttr, 'firstSeat'),
                loser_seat: getIntAttr(sAttr, 'secondSeat'),
                points: getIntAttr(sAttr, 'points', 0),
                is_scoop: getIntAttr(sAttr, 'scoop', 0) > 0,
                cash_delta: getIntAttr(sAttr, 'cash', 0),
                lines: lineDetails
            });
        }

        /* 10. Победители и Фантазия */
        let winRe = /<Winner\s+([^>]*)\/>/gi;
        let wm;
        while ((wm = winRe.exec(xml)) !== null) {
            let wAttr = wm[1];
            let sn = getIntAttr(wAttr, 'seat');
            let score = getIntAttr(wAttr, 'score', 0);
            let amt = getIntAttr(wAttr, 'amount', 0);
            let isFant = wAttr.includes('fantasy="true"');

            let p = table.ensurePlayer(sn);
            if (p) {
                p.score_points = score;
                p.chips_delta = amt;
                p.qualified_for_next_fantasy = isFant;
            }

            table.activeHand.winners.push({
                seat: sn,
                score_points: score,
                chips_delta: amt,
                fantasy_qualified: isFant
            });
        }

        /* 11. Финализация раздачи */
        if (xml.includes('<EndHand')) {
            table.finalizeHand();
        }
    }

    /* ══════════════════════════════════════════════════════════════════
       WEBSOCKET PROXY INTERCEPTOR
       ══════════════════════════════════════════════════════════════════ */
    let RealWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(RealWebSocket, {
        construct(target, args) {
            let ws = Reflect.construct(target, args);
            ws.addEventListener('message', function(e) {
                try {
                    let text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
                    processMessage(text);
                } catch(err) {
                    console.error('[OFC Tracker Error]', err);
                }
            });
            return ws;
        }
    });

    /* ══════════════════════════════════════════════════════════════════
       INTERACTIVE HUD UI OVERLAY
       ══════════════════════════════════════════════════════════════════ */
    let hud = document.createElement('div');
    hud.id = 'ofc-master-hud';
    hud.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999999;background:rgba(15,23,42,0.92);backdrop-filter:blur(8px);border:1px solid rgba(16,185,129,0.4);border-radius:12px;padding:12px 16px;box-shadow:0 12px 32px rgba(0,0,0,0.8);color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;min-width:240px;';
    hud.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-weight:900;color:#10b981;font-size:13px;">🍍 OFC MASTER v3.0</span>
            <span id="ofc-hud-hands" style="background:#047857;color:#ecfdf5;padding:2px 8px;border-radius:999px;font-weight:700;">0 рук</span>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">
            <div>Куш: <b id="ofc-hud-kush" style="color:#38bdf8;">-- RUB</b></div>
            <div>Статус: <b id="ofc-hud-status" style="color:#a78bfa;">Ожидание...</b></div>
        </div>
        <div style="display:flex;gap:6px;">
            <button id="ofc-btn-dl" style="flex:1;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">💾 JSON</button>
            <button id="ofc-btn-copy" style="background:#334155;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-weight:700;cursor:pointer;">📋 Копия</button>
        </div>
    `;
    document.body.appendChild(hud);

    function updateHudUI() {
        let handsBadge = document.getElementById('ofc-hud-hands');
        let kushBadge = document.getElementById('ofc-hud-kush');
        let statusBadge = document.getElementById('ofc-hud-status');
        if (handsBadge) handsBadge.innerText = `${OFC_STORAGE.hands.length} рук`;
        let t = OFC_STORAGE.tables.values().next().value;
        if (t && kushBadge) kushBadge.innerText = `${t.currentPointScore} RUB`;
        if (statusBadge) statusBadge.innerText = t && t.activeHand ? `Раздача #${t.activeHand.hand_id}` : 'Ожидание раздачи';
    }

    document.getElementById('ofc-btn-dl').onclick = function() {
        let dump = {
            version: '3.0-OFC-AI-DATASET',
            exported_at: new Date().toISOString(),
            total_hands_count: OFC_STORAGE.hands.length,
            hands: OFC_STORAGE.hands
        };
        let blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pokerdom_ofc_dataset_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    document.getElementById('ofc-btn-copy').onclick = function() {
        let dump = {
            version: '3.0-OFC-AI-DATASET',
            exported_at: new Date().toISOString(),
            total_hands_count: OFC_STORAGE.hands.length,
            hands: OFC_STORAGE.hands
        };
        navigator.clipboard.writeText(JSON.stringify(dump, null, 2)).then(() => {
            alert('🍍 Датасет скопирован в буфер обмена!');
        });
    };

    console.log('%c🍍 [OFC Master Tracker v3.0] Активен. Полный захват раздач, фантазий, улиц и кушей запущен.', 'color:#10b981;font-weight:bold;font-size:13px;');
})();
